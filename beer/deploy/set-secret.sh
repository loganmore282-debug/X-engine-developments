#!/usr/bin/env bash
# Run as root:  bash /srv/beer-src/beer/deploy/set-secret.sh SECRET_NAME
set -u
BEER=${BEER_DIR:-/srv/beer-src/beer}
node "$BEER/deploy/set-secret.js" "$@" || exit $?
cd "$BEER/deploy" && pm2 reload ecosystem.config.js --update-env 2>&1 | tail -2
sleep 4; curl -s http://127.0.0.1:3007/health; echo; echo "Beer restarted with the new value."
