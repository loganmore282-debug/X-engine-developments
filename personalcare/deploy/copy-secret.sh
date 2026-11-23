#!/usr/bin/env bash
# Run as root:  bash /srv/personalcare-src/personalcare/deploy/copy-secret.sh FIREBASE_SERVICE_ACCOUNT
# Copies that secret from Soda's secrets file (or a file you name second) into PersonalCare's, then restarts ONLY PersonalCare.
set -u
PERSONALCARE=${PERSONALCARE_DIR:-/srv/personalcare-src/personalcare}
node "$PERSONALCARE/deploy/copy-secret.js" "$@" || exit $?
cd "$PERSONALCARE/deploy" && pm2 reload ecosystem.config.js --update-env 2>&1 | tail -2
sleep 4; curl -s http://127.0.0.1:3008/health; echo
if pm2 logs personalcare-server --lines 40 --nostream 2>/dev/null | grep -q "Admin push (FCM) disabled"; then echo "!! PersonalCare says admin push is still disabled: run  pm2 logs personalcare-server --lines 40 --nostream  and read the line."; else echo "PersonalCare restarted with the new value. Now open the admin panel once and turn on notifications."; fi
