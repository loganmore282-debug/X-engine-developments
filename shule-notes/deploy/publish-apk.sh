#!/usr/bin/env bash
# Puts the Android app on YOUR server so people can download it from a link:
#
#   https://<your api address>/download/
#
#   sudo ./publish-apk.sh
#
# It only ADDS: a folder, one nginx location, one cron file. The app file is refreshed
# from the newest GitHub build every 10 minutes. Safe to run again.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Run this as root (sudo)."; exit 1; }
HERE="$(cd "$(dirname "$0")" && pwd)"
NGINX_API=/etc/nginx/conf.d/shule-api.conf
LOC=/etc/nginx/shule-download-location.conf
DIR=/var/www/shule-download
[ -f "$NGINX_API" ] || { echo "Run deploy/setup.sh first."; exit 1; }
API_DOMAIN="$(grep -m1 server_name "$NGINX_API" | awk '{print $2}' | tr -d ';')"

echo "==> Files"
mkdir -p "$DIR"
install -m 644 "$HERE/download/index.html" "$DIR/index.html"
[ -f "$HERE/download/logo.png" ] && install -m 644 "$HERE/download/logo.png" "$DIR/logo.png"
install -m 755 "$HERE/fetch-apk.sh" /usr/local/sbin/shule-fetch-apk

echo "==> nginx: serve it at /download/ (other sites untouched)"
cp "$NGINX_API" "$NGINX_API.before-download"
cat > "$LOC" <<LOCATION
# The app download page (written by deploy/publish-apk.sh)
location = /download { return 301 /download/; }
# The app file itself: sent as an Android package, resumable.
location = /download/shule-notes.apk {
    alias $DIR/shule-notes.apk;
    default_type application/vnd.android.package-archive;
    add_header Cache-Control "no-cache";
}
# The page and its small files keep nginx's normal file types (html, json, png).
location /download/ {
    alias $DIR/;
    index index.html;
    add_header Cache-Control "no-cache";
}
LOCATION
sed -i '/shule-download-location.conf/d' "$NGINX_API"
if grep -q 'shule-hook-location.conf' "$NGINX_API"; then
  sed -i '/shule-hook-location.conf/a\    include /etc/nginx/shule-download-location.conf;' "$NGINX_API"
else
  sed -i '/client_max_body_size 55m;/a\    include /etc/nginx/shule-download-location.conf;' "$NGINX_API"
fi
if nginx -t 2>/dev/null; then
  systemctl reload nginx; rm -f "$NGINX_API.before-download"
else
  echo "nginx rejected the change; putting the previous file back. Nothing else was changed."
  nginx -t || true
  mv "$NGINX_API.before-download" "$NGINX_API"; exit 1
fi

echo "==> Fetching the newest app now, and every 10 minutes after"
echo '*/10 * * * * root /usr/local/sbin/shule-fetch-apk >> /var/log/shule-fetch-apk.log 2>&1' > /etc/cron.d/shule-fetch-apk
chmod 644 /etc/cron.d/shule-fetch-apk
/usr/local/sbin/shule-fetch-apk

echo
echo "Done. Send people this link:"
echo "   https://$API_DOMAIN/download/"
echo "Direct file:  https://$API_DOMAIN/download/shule-notes.apk"
