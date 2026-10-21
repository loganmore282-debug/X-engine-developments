#!/usr/bin/env bash
# Run as root:  bash /srv/mint-src/mint/deploy/copy-secret.sh FIREBASE_SERVICE_ACCOUNT
# Copies that secret from Soda's secrets file (or a file you name second) into Mint's, then restarts ONLY Mint.
set -u
MINT=${MINT_DIR:-/srv/mint-src/mint}
node "$MINT/deploy/copy-secret.js" "$@" || exit $?
cd "$MINT/deploy" && pm2 reload ecosystem.config.js --update-env 2>&1 | tail -2
sleep 4; curl -s http://127.0.0.1:3002/health; echo
if pm2 logs mint-server --lines 40 --nostream 2>/dev/null | grep -q "Admin push (FCM) disabled"; then echo "!! Mint says admin push is still disabled: run  pm2 logs mint-server --lines 40 --nostream  and read the line."; else echo "Mint restarted with the new value. Now open the admin panel once and turn on notifications."; fi
