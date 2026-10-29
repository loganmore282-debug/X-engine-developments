#!/usr/bin/env bash
# Run as root:  bash /srv/chocolate-src/chocolate/deploy/set-secret.sh PESAJET_API_KEY
set -u
CHOCOLATE=${CHOCOLATE_DIR:-/srv/chocolate-src/chocolate}
node "$CHOCOLATE/deploy/set-secret.js" "$@" || exit $?
cd "$CHOCOLATE/deploy" && pm2 reload ecosystem.config.js --update-env 2>&1 | tail -2
sleep 4; curl -s http://127.0.0.1:3005/health; echo; echo "Chocolate restarted with the new value."
