#!/usr/bin/env bash
# Run as root:  bash /srv/chocolate-src/chocolate/deploy/copy-secret.sh FIREBASE_SERVICE_ACCOUNT
# Copies that secret from Soda's secrets file (or a file you name second) into Chocolate's, then restarts ONLY Chocolate.
set -u
CHOCOLATE=${CHOCOLATE_DIR:-/srv/chocolate-src/chocolate}
node "$CHOCOLATE/deploy/copy-secret.js" "$@" || exit $?
cd "$CHOCOLATE/deploy" && pm2 reload ecosystem.config.js --update-env 2>&1 | tail -2
sleep 4; curl -s http://127.0.0.1:3005/health; echo
if pm2 logs chocolate-server --lines 40 --nostream 2>/dev/null | grep -q "Admin push (FCM) disabled"; then echo "!! Chocolate says admin push is still disabled: run  pm2 logs chocolate-server --lines 40 --nostream  and read the line."; else echo "Chocolate restarted with the new value. Now open the admin panel once and turn on notifications."; fi
