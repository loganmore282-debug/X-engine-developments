#!/usr/bin/env bash
# Run as root:  bash /srv/beer-src/beer/deploy/copy-secret.sh FIREBASE_SERVICE_ACCOUNT
# Copies that secret from Soda's secrets file (or a file you name second) into Beer's, then restarts ONLY Beer.
set -u
BEER=${BEER_DIR:-/srv/beer-src/beer}
node "$BEER/deploy/copy-secret.js" "$@" || exit $?
cd "$BEER/deploy" && pm2 reload ecosystem.config.js --update-env 2>&1 | tail -2
sleep 4; curl -s http://127.0.0.1:3007/health; echo
if pm2 logs beer-server --lines 40 --nostream 2>/dev/null | grep -q "Admin push (FCM) disabled"; then echo "!! Beer says admin push is still disabled: run  pm2 logs beer-server --lines 40 --nostream  and read the line."; else echo "Beer restarted with the new value. Now open the admin panel once and turn on notifications."; fi
