#!/usr/bin/env bash
# Run as root:  bash /srv/mint-src/mint/deploy/set-secret.sh PESAJET_API_KEY
set -u
MINT=${MINT_DIR:-/srv/mint-src/mint}
node "$MINT/deploy/set-secret.js" "$@" || exit $?
cd "$MINT/deploy" && pm2 reload ecosystem.config.js --update-env 2>&1 | tail -2
sleep 4; curl -s http://127.0.0.1:3002/health; echo; echo "Mint restarted with the new value."
