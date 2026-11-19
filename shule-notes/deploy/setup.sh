#!/usr/bin/env bash
# Sets up the Shule Notes backend and admin panel on a Contabo VPS (Ubuntu
# 22.04 or 24.04) that may ALREADY be running other projects. It only ADDS
# things; it never removes, replaces or reconfigures what is there:
#
#   - its own user (shule), folders (/opt/shule-notes, /etc/shule-notes,
#     /var/lib/shule-notes) and one systemd service (shule-notes);
#   - two new nginx files in /etc/nginx/conf.d (shule-api, shule-admin); your other sites are not touched;
#   - the first free port from 4000 up (not a fixed 4000);
#   - its own Node 20 inside /opt/shule-notes unless the server already has Node 20+,
#     so the Node other projects use is never changed;
#   - the firewall: if ufw is active it only ADDS the web ports; it is never switched on or reset.
#
# Run it as root, from this folder:
#   sudo ./setup.sh api.example.com admin.example.com you@example.com
# No domain yet (free addresses built from the server's IP, fine for testing):
#   sudo ./setup.sh --no-domain [you@example.com]
# Look around first, changing nothing:  sudo ./preflight.sh
# Safe to run again (also to switch to a real domain later).
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Run this as root (sudo)."; exit 1; }

USAGE="usage: setup.sh <api-domain> <admin-domain> [email]
       setup.sh --no-domain [email]"
if [ "${1:-}" = "--no-domain" ]; then
  CERT_EMAIL="${2:-}"
  command -v curl >/dev/null || { apt-get update -y >/dev/null; apt-get install -y curl >/dev/null; }
  IP="$(curl -4fsS https://api.ipify.org)" || { echo "Could not find this server's public IP."; exit 1; }
  DASHED="${IP//./-}"
  API_DOMAIN="api.$DASHED.sslip.io"       # sslip.io answers <anything>.<ip-with-dashes>.sslip.io with that IP
  ADMIN_DOMAIN="admin.$DASHED.sslip.io"
  echo "==> No domain: using $API_DOMAIN and $ADMIN_DOMAIN"
else
  API_DOMAIN="${1:?$USAGE}"; ADMIN_DOMAIN="${2:?$USAGE}"; CERT_EMAIL="${3:-}"
fi

HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$(dirname "$HERE")"
APP=/opt/shule-notes
ENV_DIR=/etc/shule-notes
UPLOADS=/var/lib/shule-notes/uploads
WEB=/var/www/shule-admin

owner_of_port() { ss -ltnpH "( sport = :$1 )" 2>/dev/null | grep -o '"[^"]*"' | head -1 | tr -d '"' || true; }
port_in_use() { [ -n "$(ss -ltnH "( sport = :$1 )" 2>/dev/null)" ]; }
set_env() { # set_env KEY VALUE  (rewrites one line; safe for values containing & or /)
  grep -v "^$1=" "$ENV_DIR/.env" > "$ENV_DIR/.env.tmp" || true
  echo "$1=$2" >> "$ENV_DIR/.env.tmp"; cat "$ENV_DIR/.env.tmp" > "$ENV_DIR/.env"; rm -f "$ENV_DIR/.env.tmp"
}

echo "==> Checking that ports 80 and 443 are free for nginx (or already nginx)"
for p in 80 443; do
  o="$(owner_of_port $p)"
  if [ -n "$o" ] && [ "$o" != "nginx" ]; then
    echo "Port $p is already used by '$o', not nginx. Nothing has been changed."
    echo "Your options: put Shule Notes behind that server instead (see README, 'Another web server is already running')."
    exit 1
  fi
done

echo "==> Installing only what is missing"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y >/dev/null
NEED=""
for pkg in curl ca-certificates openssl rsync xz-utils; do dpkg -s "$pkg" >/dev/null 2>&1 || NEED="$NEED $pkg"; done
command -v nginx >/dev/null || NEED="$NEED nginx"
command -v certbot >/dev/null || NEED="$NEED certbot python3-certbot-nginx"
[ -z "$NEED" ] || apt-get install -y $NEED

echo "==> Node 20"
NODE_BIN=""
if command -v node >/dev/null && command -v npm >/dev/null && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ]; then
  NODE_BIN="$(command -v node)"; echo "    using the server's Node $(node -v)"
else
  case "$(uname -m)" in x86_64) NA=x64 ;; aarch64) NA=arm64 ;; *) echo "Unsupported CPU $(uname -m)"; exit 1 ;; esac
  if [ ! -x "$APP/node/bin/node" ]; then
    BASE=https://nodejs.org/dist/latest-v20.x
    FILE="$(curl -fsSL "$BASE/SHASUMS256.txt" | grep "linux-$NA.tar.xz" | awk '{print $2}')"
    mkdir -p "$APP/node"; curl -fsSL "$BASE/$FILE" | tar -xJ -C "$APP/node" --strip-components=1
  fi
  NODE_BIN="$APP/node/bin/node"; echo "    installed a private Node $("$NODE_BIN" -v) in $APP/node (the server's own Node is untouched)"
fi
NODE_DIR="$(dirname "$NODE_BIN")"

echo "==> Service user and folders"
id shule >/dev/null 2>&1 || useradd --system --home "$APP" --shell /usr/sbin/nologin shule
mkdir -p "$APP" "$ENV_DIR" "$UPLOADS" "$WEB"
chown -R shule:shule "$UPLOADS"

echo "==> Backend code"
rsync -a --delete --exclude node_modules --exclude uploads --exclude .env "$SRC/backend/" "$APP/backend/"
(cd "$APP/backend" && PATH="$NODE_DIR:$PATH" npm install --omit=dev --no-audit --no-fund)
chown -R root:shule "$APP"; chmod -R g+rX "$APP"

echo "==> Settings file ($ENV_DIR/.env)"
if [ ! -f "$ENV_DIR/.env" ]; then
  cp "$SRC/backend/.env.example" "$ENV_DIR/.env"
  ADMIN_KEY="$(openssl rand -hex 24)"
  set_env ADMIN_KEY "$ADMIN_KEY"
  echo "    New admin key: $ADMIN_KEY"
  echo "    (write it down: it is the password for the admin panel)"
fi
set_env UPLOAD_DIR "$UPLOADS"
set_env ALLOWED_ORIGINS "https://$ADMIN_DOMAIN"
# The first free port from 4000, so a project already using 4000 is not disturbed.
PORT="$(grep -m1 '^PORT=' "$ENV_DIR/.env" | cut -d= -f2 || true)"; PORT="${PORT:-4000}"
if ! systemctl is-active --quiet shule-notes && port_in_use "$PORT"; then
  while port_in_use "$PORT"; do PORT=$((PORT + 1)); done
  echo "    Port 4000 is taken here, using $PORT instead"
fi
set_env PORT "$PORT"
chown root:shule "$ENV_DIR/.env"; chmod 640 "$ENV_DIR/.env"

echo "==> Admin panel files"
sed "s|http://localhost:4000|https://$API_DOMAIN|" "$SRC/admin/index.html" > "$WEB/index.html"

echo "==> Service"
sed "s|__NODE__|$NODE_BIN|" "$HERE/shule-notes.service" > /etc/systemd/system/shule-notes.service
systemctl daemon-reload
systemctl enable shule-notes >/dev/null

echo "==> nginx (two new sites in conf.d; your others are not touched)"
# conf.d is read by every standard nginx (and is where this server's other sites live).
mkdir -p /etc/nginx/conf.d
API_CONF=/etc/nginx/conf.d/shule-api.conf; ADMIN_CONF=/etc/nginx/conf.d/shule-admin.conf
sed "s|__API_DOMAIN__|$API_DOMAIN|g; s|__PORT__|$PORT|g" "$HERE/nginx-api.conf" > "$API_CONF"
sed "s|__ADMIN_DOMAIN__|$ADMIN_DOMAIN|g" "$HERE/nginx-admin.conf" > "$ADMIN_CONF"
rollback() { rm -f "$API_CONF" "$ADMIN_CONF"; }
if ! nginx -t 2>/dev/null; then
  echo "nginx rejected the new configuration, so I removed my two files. Nothing else was changed:"
  nginx -t || true; rollback; exit 1
fi
# Make sure nginx really loads them (a customised nginx.conf might not read conf.d).
# (Capture the dump first: piping it straight into "grep -q" makes nginx die of SIGPIPE and
# "pipefail" would then report a false "not found".)
NGINX_DUMP="$(nginx -T 2>&1 || true)"
if ! grep -q "server_name $API_DOMAIN" <<<"$NGINX_DUMP"; then
  echo "This nginx does not read /etc/nginx/conf.d, so my files would do nothing. I removed them; nothing was changed."
  rollback; exit 1
fi
systemctl enable nginx >/dev/null 2>&1 || true
systemctl reload nginx 2>/dev/null || systemctl start nginx

echo "==> Firewall"
UFW_STATUS="$(ufw status 2>/dev/null || true)"
if command -v ufw >/dev/null && grep -q "Status: active" <<<"$UFW_STATUS"; then
  ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
  echo "    ufw is active: ports 80 and 443 allowed (existing rules untouched)"
else
  echo "    ufw is not active; left exactly as it is. (Contabo has its own firewall option in the customer panel.)"
fi

echo "==> HTTPS certificates (only for $API_DOMAIN and $ADMIN_DOMAIN)"
if [ -n "$CERT_EMAIL" ] && [ "$CERT_EMAIL" != "none" ]; then EMAIL_ARGS=(-m "$CERT_EMAIL"); else EMAIL_ARGS=(--register-unsafely-without-email); fi
certbot --nginx --non-interactive --agree-tos "${EMAIL_ARGS[@]}" --redirect -d "$API_DOMAIN" -d "$ADMIN_DOMAIN" \
  || echo "    Certificates failed. Check that both names point at this server, then run this script again."

echo
if grep -Eq '^(MONGODB_URI=mongodb\+srv://user:pass@|MONGODB_URI=$|ANTHROPIC_API_KEY=sk-ant-\.\.\.)' "$ENV_DIR/.env"; then
  cat <<MSG
==> Almost done. Next:
      sudo ./mongodb/setup-mongodb.sh         (its own MongoDB, separate from any you already run)
      sudo nano $ENV_DIR/.env                 (set ANTHROPIC_API_KEY)
      sudo systemctl start shule-notes
      curl https://$API_DOMAIN/health
MSG
else
  systemctl restart shule-notes
  echo "==> Started. Check it: curl https://$API_DOMAIN/health"
fi
echo
echo "Your addresses:  API   https://$API_DOMAIN   (app on 127.0.0.1:$PORT)"
echo "                 Admin https://$ADMIN_DOMAIN"
