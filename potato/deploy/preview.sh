#!/usr/bin/env bash
# TEMPORARY preview of Potato by IP address (no domain needed), for looking at the design only:
#   bash /srv/potato-src/potato/deploy/preview.sh on       member app + admin panel at  http://<server ip>:8096
#   bash /srv/potato-src/potato/deploy/preview.sh off      remove it (also done automatically when a real domain is set up)
#   bash /srv/potato-src/potato/deploy/preview.sh          show whether it is on
# It is plain HTTP (not encrypted): do not let real members, real money or a password you care about go through it.
# It adds ONE nginx file (potato-preview.conf) and opens ONE firewall port (8096); Soda and the other apps are not touched.
set -u
[ "$(id -u)" = 0 ] || { echo "Run this as root."; exit 1; }
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
POTATO=${POTATO_DIR:-$(dirname "$HERE")}
CONF=${POTATO_PREVIEW_CONF:-/etc/nginx/conf.d/potato-preview.conf}
PROD=${POTATO_NGINX_CONF:-/etc/nginx/conf.d/potato.conf}
ADMIN_PATH=$(sed -n 's/^ADMIN_PATH=\${POTATO_ADMIN_PATH:-\([A-Za-z0-9]*\)}.*/\1/p' "$POTATO/deploy/update-vps.sh" | head -1)
PORT=8096
ip() { local i; i=$(curl -4 -s --max-time 8 https://ifconfig.me || true); [ -n "$i" ] || i=$(hostname -I | awk '{print $1}'); printf '%s' "$i"; }
links() { local i; i=$(ip); echo "  Member app : http://$i:$PORT/"; echo "  Admin panel: http://$i:$PORT/$ADMIN_PATH/    (keep private; plain HTTP, so use it for design work only)"; }
case "${1:-status}" in
  on)
    if [ -f "$PROD" ]; then echo "A real domain is already set up for Potato (potato.conf exists). Use that address; the preview would clash with it."; exit 1; fi
    curl -s -m 5 "http://127.0.0.1:3004/health" | grep -q '"status":"ok"' || { echo "Potato's server is not answering on port 3004. Check:  pm2 logs potato-server --lines 30 --nostream"; exit 1; }
    [ -f "$CONF" ] && cp "$CONF" /root/potato-preview.conf.bak
    (cd "$POTATO" && node deploy/make-nginx.js dev "$ADMIN_PATH" > /tmp/potato-preview.conf.new) || { echo "Could not build the nginx file."; exit 1; }
    cp /tmp/potato-preview.conf.new "$CONF"
    if ! nginx -t >/tmp/potato-preview.nginxtest 2>&1; then
      echo "nginx refused the file. Putting things back."; tail -4 /tmp/potato-preview.nginxtest
      if [ -f /root/potato-preview.conf.bak ]; then cp /root/potato-preview.conf.bak "$CONF"; else rm -f "$CONF"; fi
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
