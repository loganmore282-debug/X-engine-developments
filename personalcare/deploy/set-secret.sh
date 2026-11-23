#!/usr/bin/env bash
# Run as root:  bash /srv/personalcare-src/personalcare/deploy/set-secret.sh PESAJET_API_KEY
set -u
PERSONALCARE=${PERSONALCARE_DIR:-/srv/personalcare-src/personalcare}
node "$PERSONALCARE/deploy/set-secret.js" "$@" || exit $?
cd "$PERSONALCARE/deploy" && pm2 reload ecosystem.config.js --update-env 2>&1 | tail -2
sleep 4; curl -s http://127.0.0.1:3008/health; echo; echo "PersonalCare restarted with the new value."
