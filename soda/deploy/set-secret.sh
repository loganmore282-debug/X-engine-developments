#!/usr/bin/env bash
# Run as root:  bash /srv/soda-src/soda/deploy/set-secret.sh PESAJET_API_KEY
set -u
SODA=${SODA_DIR:-/srv/soda-src/soda}
node "$SODA/deploy/set-secret.js" "$@" || exit $?
cd "$SODA/deploy" && pm2 reload ecosystem.config.js --update-env 2>&1 | tail -2
sleep 4; curl -s http://127.0.0.1:3001/health; echo; echo "Soda restarted with the new value."
