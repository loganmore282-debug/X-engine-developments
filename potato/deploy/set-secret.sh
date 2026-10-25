#!/usr/bin/env bash
# Run as root:  bash /srv/potato-src/potato/deploy/set-secret.sh PESAJET_API_KEY
set -u
POTATO=${POTATO_DIR:-/srv/potato-src/potato}
node "$POTATO/deploy/set-secret.js" "$@" || exit $?
cd "$POTATO/deploy" && pm2 reload ecosystem.config.js --update-env 2>&1 | tail -2
sleep 4; curl -s http://127.0.0.1:3004/health; echo; echo "Potato restarted with the new value."
