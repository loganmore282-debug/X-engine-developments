#!/usr/bin/env bash
# Step 2 of a deploy. Runs as root, but ONLY through sudo for the "shule-deploy"
# user, takes no arguments, and only copies what build.sh already staged and
# tested into the live folders. If the app does not come back healthy it puts
# the previous version back.
set -euo pipefail
. /etc/shule-notes/deploy.conf
STAGE=/var/lib/shule-deploy/stage
PREV=/var/lib/shule-deploy/previous
LIVE=/opt/shule-notes/backend
[ -d "$STAGE" ] || { echo "nothing staged"; exit 1; }

if [ -f "$STAGE/.admin" ]; then
  sed "s|http://localhost:4000|https://$API_DOMAIN|" "$STAGE/admin.html" > /var/www/shule-admin/index.html.new
  chmod 644 /var/www/shule-admin/index.html.new
  mv /var/www/shule-admin/index.html.new /var/www/shule-admin/index.html
  echo "admin panel updated"
fi

if [ -f "$STAGE/.web" ] && [ -d /var/www/shule-web ]; then
  # Copied in beside the live folder and swapped in, so a visitor never sees half a website.
  rm -rf /var/www/shule-web.new; cp -a "$STAGE/web" /var/www/shule-web.new
  chmod -R go+rX /var/www/shule-web.new
  rm -rf /var/www/shule-web.old; mv /var/www/shule-web /var/www/shule-web.old; mv /var/www/shule-web.new /var/www/shule-web
  rm -rf /var/www/shule-web.old
  echo "website updated"
fi

if [ -f "$STAGE/.backend" ]; then
  PORT="$(grep -m1 '^PORT=' /etc/shule-notes/.env | cut -d= -f2)"; PORT="${PORT:-4000}"
  rm -rf "$PREV"; cp -a "$LIVE" "$PREV"
  rsync -rtp --no-links --delete --exclude .env --exclude uploads "$STAGE/backend/" "$LIVE/"
  chown -R root:shule "$LIVE"; chmod -R g+rX,go-w "$LIVE"
  systemctl restart shule-notes
  ok=""
  for _ in $(seq 1 25); do
    if curl -fsS --max-time 3 "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then ok=1; break; fi
    sleep 1
  done
  if [ -z "$ok" ]; then
    echo "the new version did not start: putting the previous one back"
    rsync -rtp --no-links --delete "$PREV/" "$LIVE/"
    chown -R root:shule "$LIVE"; chmod -R g+rX,go-w "$LIVE"
    systemctl restart shule-notes
    exit 1
  fi
  echo "backend updated and healthy"
fi
