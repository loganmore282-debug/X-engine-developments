#!/usr/bin/env bash
# TEMPORARY preview of Beer by IP address (no domain needed), for looking at the design only:
#   bash /srv/beer-src/beer/deploy/preview.sh on       member app + admin panel at  http://<server ip>:8102
#   bash /srv/beer-src/beer/deploy/preview.sh off      remove it (also done automatically when a real domain is set up)
#   bash /srv/beer-src/beer/deploy/preview.sh          show whether it is on
# It is plain HTTP (not encrypted): do not let real members, real money or a password you care about go through it.
# It adds ONE nginx file (beer-preview.conf) and opens ONE firewall port (8102); Soda and the other apps are not touched.
set -u
[ "$(id -u)" = 0 ] || { echo "Run this as root."; exit 1; }
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BEER=${BEER_DIR:-$(dirname "$HERE")}
CONF=${BEER_PREVIEW_CONF:-/etc/nginx/conf.d/beer-preview.conf}
PROD=${BEER_NGINX_CONF:-/etc/nginx/conf.d/beer.conf}
ADMIN_PATH=$(sed -n 's/^ADMIN_PATH=\${BEER_ADMIN_PATH:-\([A-Za-z0-9]*\)}.*/\1/p' "$BEER/deploy/update-vps.sh" | head -1)
PORT=8102
ip() { local i; i=$(curl -4 -s --max-time 8 https://ifconfig.me || true); [ -n "$i" ] || i=$(hostname -I | awk '{print $1}'); printf '%s' "$i"; }
links() { local i; i=$(ip); echo "  Member app : http://$i:$PORT/"; echo "  Admin panel: http://$i:$PORT/$ADMIN_PATH/    (keep private; plain HTTP, so use it for design work only)"; }
case "${1:-status}" in
  on)
    if [ -f "$PROD" ]; then echo "A real domain is already set up for Beer (beer.conf exists). Use that address; the preview would clash with it."; exit 1; fi
    curl -s -m 5 "http://127.0.0.1:3007/health" | grep -q '"status":"ok"' || { echo "Beer's server is not answering on port 3007. Check:  pm2 logs beer-server --lines 30 --nostream"; exit 1; }
    [ -f "$CONF" ] && cp "$CONF" /root/beer-preview.conf.bak
    (cd "$BEER" && node deploy/make-nginx.js dev "$ADMIN_PATH" > /tmp/beer-preview.conf.new) || { echo "Could not build the nginx file."; exit 1; }
    cp /tmp/beer-preview.conf.new "$CONF"
    if ! nginx -t >/tmp/beer-preview.nginxtest 2>&1; then
      echo "nginx refused the file. Putting things back."; tail -4 /tmp/beer-preview.nginxtest
      if [ -f /root/beer-preview.conf.bak ]; then cp /root/beer-preview.conf.bak "$CONF"; else rm -f "$CONF"; fi
      exit 1
    fi
    command -v ufw >/dev/null 2>&1 && ufw allow "$PORT/tcp" >/dev/null 2>&1
    systemctl reload nginx && echo "Preview is ON." && links
    ;;
  off)
    rm -f "$CONF"; command -v ufw >/dev/null 2>&1 && { ufw delete allow "$PORT/tcp" >/dev/null 2>&1; ufw delete allow "$PORT" >/dev/null 2>&1; }
    nginx -t >/dev/null 2>&1 && systemctl reload nginx; echo "Preview is OFF (port $PORT closed)." ;;
  *)
    if [ -f "$CONF" ]; then echo "Preview is ON."; links; else echo "Preview is OFF. Turn it on with:  bash $0 on"; fi ;;
esac
