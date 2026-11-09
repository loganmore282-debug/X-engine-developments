#!/usr/bin/env bash
# Run as root:  bash /srv/smartai-src/smartai/deploy/copy-secret.sh FIREBASE_SERVICE_ACCOUNT
# Copies that secret from Soda's secrets file (or a file you name second) into Smart AI's, then restarts ONLY Smart AI.
set -u
SMARTAI=${SMARTAI_DIR:-/srv/smartai-src/smartai}
node "$SMARTAI/deploy/copy-secret.js" "$@" || exit $?
cd "$SMARTAI/deploy" && pm2 reload ecosystem.config.js --update-env 2>&1 | tail -2
sleep 4; curl -s http://127.0.0.1:3006/health; echo
if pm2 logs smartai-server --lines 40 --nostream 2>/dev/null | grep -q "Admin push (FCM) disabled"; then echo "!! Smart AI says admin push is still disabled: run  pm2 logs smartai-server --lines 40 --nostream  and read the line."; else echo "Smart AI restarted with the new value. Now open the admin panel once and turn on notifications."; fi
