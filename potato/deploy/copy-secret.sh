#!/usr/bin/env bash
# Run as root:  bash /srv/potato-src/potato/deploy/copy-secret.sh FIREBASE_SERVICE_ACCOUNT
# Copies that secret from Soda's secrets file (or a file you name second) into Potato's, then restarts ONLY Potato.
set -u
POTATO=${POTATO_DIR:-/srv/potato-src/potato}
node "$POTATO/deploy/copy-secret.js" "$@" || exit $?
cd "$POTATO/deploy" && pm2 reload ecosystem.config.js --update-env 2>&1 | tail -2
sleep 4; curl -s http://127.0.0.1:3004/health; echo
if pm2 logs potato-server --lines 40 --nostream 2>/dev/null | grep -q "Admin push (FCM) disabled"; then echo "!! Potato says admin push is still disabled: run  pm2 logs potato-server --lines 40 --nostream  and read the line."; else echo "Potato restarted with the new value. Now open the admin panel once and turn on notifications."; fi
