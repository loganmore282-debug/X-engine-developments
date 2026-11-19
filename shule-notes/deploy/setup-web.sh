#!/usr/bin/env bash
# Adds the Shule Notes WEBSITE to the server (the same app as on the phone, in the browser):
#
#   sudo ./setup-web.sh [web-address]
#
# With no address it uses  web.<server-ip-with-dashes>.sslip.io  (a free address that points at this server).
# Run deploy/setup.sh first. This only ADDS things: one folder (/var/www/shule-web), one nginx file
# (shule-web.conf), one HTTPS certificate for the web address, and one entry in the API's list of allowed websites.
# Nothing belonging to your other projects is touched. Safe to run again.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Run this as root (sudo)."; exit 1; }

HERE="$(cd "$(dirname "$0")" && pwd)"
ENV_DIR=/etc/shule-notes
NGINX_API=/etc/nginx/conf.d/shule-api.conf
CONF=/etc/nginx/conf.d/shule-web.conf
WEBROOT=/var/www/shule-web
DEPLOY_CONF=$ENV_DIR/deploy.conf

[ -f "$ENV_DIR/.env" ] && [ -f "$NGINX_API" ] || { echo "Run deploy/setup.sh first."; exit 1; }
API_DOMAIN="$(grep -m1 'server_name' "$NGINX_API" | awk '{print $2}' | tr -d ';')"
WEB_DOMAIN="${1:-}"
if [ -z "$WEB_DOMAIN" ]; then
  case "$API_DOMAIN" in
    api.*) WEB_DOMAIN="web.${API_DOMAIN#api.}" ;;
    *) echo "Give the web address:  sudo ./setup-web.sh www.example.com"; exit 1 ;;
  esac
fi
echo "==> The website will be at https://$WEB_DOMAIN  (it talks to https://$API_DOMAIN)"

echo "==> Folder"
mkdir -p "$WEBROOT"
if [ ! -f "$WEBROOT/index.html" ]; then
  cat > "$WEBROOT/index.html" <<'HTML'
<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Shule Notes</title>
<body style="font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0;background:#f7f5f0;color:#1c1b16"><p>The Shule Notes website is being set up. Back in a minute.</p>
HTML
fi
chmod -R go+rX "$WEBROOT"

echo "==> nginx (a new file only; yours are not touched)"
[ -f "$CONF" ] && cp "$CONF" "$CONF.before"
sed -e "s|__WEB_DOMAIN__|$WEB_DOMAIN|g" -e "s|__API_DOMAIN__|$API_DOMAIN|g" "$HERE/nginx-web.conf" > "$CONF"
if ! nginx -t 2>/dev/null; then
  echo "nginx rejected the new file; putting things back. Nothing else was changed."
  nginx -t || true
  if [ -f "$CONF.before" ]; then mv "$CONF.before" "$CONF"; else rm -f "$CONF"; fi
  exit 1
fi
rm -f "$CONF.before"
systemctl reload nginx

echo "==> HTTPS certificate (only for $WEB_DOMAIN)"
if command -v certbot >/dev/null; then
  certbot --nginx --non-interactive --agree-tos --register-unsafely-without-email --redirect -d "$WEB_DOMAIN" \
    || echo "    The certificate failed. Check that $WEB_DOMAIN points at this server, then run this script again."
else
  echo "    certbot is not installed (deploy/setup.sh installs it)."
fi

echo "==> Let the API accept the website"
CURRENT="$(grep -m1 '^ALLOWED_ORIGINS=' "$ENV_DIR/.env" | cut -d= -f2- || true)"
if [[ ",$CURRENT," != *",https://$WEB_DOMAIN,"* ]]; then
  NEXT="${CURRENT:+$CURRENT,}https://$WEB_DOMAIN"
  grep -v '^ALLOWED_ORIGINS=' "$ENV_DIR/.env" > "$ENV_DIR/.env.tmp" || true
  echo "ALLOWED_ORIGINS=$NEXT" >> "$ENV_DIR/.env.tmp"; cat "$ENV_DIR/.env.tmp" > "$ENV_DIR/.env"; rm -f "$ENV_DIR/.env.tmp"
  systemctl restart shule-notes
  echo "    added https://$WEB_DOMAIN to ALLOWED_ORIGINS and restarted the server"
else
  echo "    already allowed"
fi

echo "==> Tell the automatic deploy about the website"
if [ -f "$DEPLOY_CONF" ]; then
  grep -v '^WEB_DOMAIN=' "$DEPLOY_CONF" > "$DEPLOY_CONF.tmp" || true
  echo "WEB_DOMAIN=$WEB_DOMAIN" >> "$DEPLOY_CONF.tmp"
  cat "$DEPLOY_CONF.tmp" > "$DEPLOY_CONF"; rm -f "$DEPLOY_CONF.tmp"
  echo "    done"
else
  echo "    (automatic deploy is not set up yet: run webhook/setup-webhook.sh, then this script again)"
fi

cat <<MSG

==> The web address is ready: https://$WEB_DOMAIN
Next (once), so the website is built and put live from GitHub:
  1. sudo ./webhook/setup-webhook.sh        (updates the deploy scripts; keeps your webhook secret)
  2. sudo ./setup-web.sh                    (run this once more, so the deploy knows the web address)
  3. sudo -u shule-deploy /usr/local/lib/shule-deploy/build.sh
     (builds and publishes the website now; after that every push to GitHub does it by itself)
Watch it:  tail -f /var/lib/shule-deploy/deploy.log
MSG
