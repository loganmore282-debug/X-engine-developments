#!/usr/bin/env bash
# Run as root:  bash /srv/smartai-src/smartai/deploy/set-secret.sh PESAJET_API_KEY
set -u
SMARTAI=${SMARTAI_DIR:-/srv/smartai-src/smartai}
node "$SMARTAI/deploy/set-secret.js" "$@" || exit $?
cd "$SMARTAI/deploy" && pm2 reload ecosystem.config.js --update-env 2>&1 | tail -2
sleep 4; curl -s http://127.0.0.1:3006/health; echo; echo "Smart AI restarted with the new value."
