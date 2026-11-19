#!/usr/bin/env bash
# One-time setup of the Shule Notes backend and admin panel on a fresh
# Contabo VPS running Ubuntu 22.04 or 24.04. Run as root, from this folder:
#
#   sudo ./setup.sh api.example.com admin.example.com you@example.com
#
# Both domains must already point at the VPS's IP address (an A record each),
# or the certificate step cannot work. Safe to run again: it never overwrites
# your .env, and it re-copies the code.
set -euo pipefail

API_DOMAIN="${1:?usage: setup.sh <api-domain> <admin-domain> <email-for-certificates>}"
ADMIN_DOMAIN="${2:?usage: setup.sh <api-domain> <admin-domain> <email-for-certificates>}"
CERT_EMAIL="${3:?usage: setup.sh <api-domain> <admin-domain> <email-for-certificates>}"
[ "$(id -u)" -eq 0 ] || { echo "Run this as root (sudo)."; exit 1; }

HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$(dirname "$HERE")"
APP=/opt/shule-notes
ENV_DIR=/etc/shule-notes
UPLOADS=/var/lib/shule-notes/uploads
WEB=/var/www/shule-admin

echo "==> Installing packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl ca-certificates gnupg nginx certbot python3-certbot-nginx ufw openssl rsync
if ! command -v node >/dev/null || [ "$(node -v | sed 's/v\([0-9]*\).*/\1/')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

echo "==> Creating the service user and folders"
id shule >/dev/null 2>&1 || useradd --system --home "$APP" --shell /usr/sbin/nologin shule
mkdir -p "$APP" "$ENV_DIR" "$UPLOADS" "$WEB"
chown -R shule:shule "$UPLOADS"

echo "==> Copying the backend and installing its dependencies"
rsync -a --delete --exclude node_modules --exclude uploads --exclude .env "$SRC/backend/" "$APP/backend/"
(cd "$APP/backend" && npm install --omit=dev --no-audit --no-fund)
chown -R root:shule "$APP"
chmod -R g+rX "$APP"

echo "==> Settings file"
if [ ! -f "$ENV_DIR/.env" ]; then
  cp "$SRC/backend/.env.example" "$ENV_DIR/.env"
  ADMIN_KEY="$(openssl rand -hex 24)"
  sed -i "s|^ADMIN_KEY=.*|ADMIN_KEY=$ADMIN_KEY|" "$ENV_DIR/.env"
  sed -i "s|^ALLOWED_ORIGINS=.*|ALLOWED_ORIGINS=https://$ADMIN_DOMAIN|" "$ENV_DIR/.env"
  sed -i "s|^UPLOAD_DIR=.*|UPLOAD_DIR=$UPLOADS|" "$ENV_DIR/.env"
  echo "    Created $ENV_DIR/.env with a new admin key: $ADMIN_KEY"
  echo "    (write it down: it is the password for the admin panel)"
fi
chown root:shule "$ENV_DIR/.env"
chmod 640 "$ENV_DIR/.env"

echo "==> Admin panel files"
sed "s|http://localhost:4000|https://$API_DOMAIN|" "$SRC/admin/index.html" > "$WEB/index.html"

echo "==> Service"
cp "$HERE/shule-notes.service" /etc/systemd/system/shule-notes.service
systemctl daemon-reload
systemctl enable shule-notes >/dev/null

echo "==> nginx"
sed "s|__API_DOMAIN__|$API_DOMAIN|g" "$HERE/nginx-api.conf" > /etc/nginx/sites-available/shule-api
sed "s|__ADMIN_DOMAIN__|$ADMIN_DOMAIN|g" "$HERE/nginx-admin.conf" > /etc/nginx/sites-available/shule-admin
ln -sf /etc/nginx/sites-available/shule-api /etc/nginx/sites-enabled/shule-api
ln -sf /etc/nginx/sites-available/shule-admin /etc/nginx/sites-enabled/shule-admin
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

echo "==> Firewall (SSH, HTTP, HTTPS only)"
ufw allow OpenSSH >/dev/null
ufw allow 'Nginx Full' >/dev/null
ufw --force enable >/dev/null

echo "==> HTTPS certificates"
certbot --nginx --non-interactive --agree-tos -m "$CERT_EMAIL" --redirect -d "$API_DOMAIN" -d "$ADMIN_DOMAIN" \
  || echo "    Certificates failed. Check that both domains point at this server, then run this script again."

if grep -Eq '^(MONGODB_URI=mongodb\+srv://user:pass@|ANTHROPIC_API_KEY=sk-ant-\.\.\.)' "$ENV_DIR/.env"; then
  cat <<MSG

==> Almost done. Edit $ENV_DIR/.env and set:
      MONGODB_URI        your MongoDB connection string (database name at the end)
      ANTHROPIC_API_KEY  your Claude API key
    then start the server:
      sudo systemctl start shule-notes
      sudo journalctl -u shule-notes -f
MSG
else
  systemctl restart shule-notes
  echo "==> Started. Check it: curl https://$API_DOMAIN/health"
fi
