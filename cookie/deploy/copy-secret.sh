#!/usr/bin/env bash
# Run as root:  bash /srv/cookie-src/cookie/deploy/copy-secret.sh FIREBASE_SERVICE_ACCOUNT
# Copies that secret from Soda's secrets file (or a file you name second) into Cookie's, then restarts ONLY Cookie.
set -u
COOKIE=${COOKIE_DIR:-/srv/cookie-src/cookie}
node "$COOKIE/deploy/copy-secret.js" "$@" || exit $?
cd "$COOKIE/deploy" && pm2 reload ecosystem.config.js --update-env 2>&1 | tail -2
sleep 4; curl -s http://127.0.0.1:3003/health; echo
if pm2 logs cookie-server --lines 40 --nostream 2>/dev/null | grep -q "Admin push (FCM) disabled"; then echo "!! Cookie says admin push is still disabled: run  pm2 logs cookie-server --lines 40 --nostream  and read the line."; else echo "Cookie restarted with the new value. Now open the admin panel once and turn on notifications."; fi
