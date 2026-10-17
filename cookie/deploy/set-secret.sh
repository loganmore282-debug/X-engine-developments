#!/usr/bin/env bash
# Run as root:  bash /srv/cookie-src/cookie/deploy/set-secret.sh PESAJET_API_KEY
set -u
COOKIE=${COOKIE_DIR:-/srv/cookie-src/cookie}
node "$COOKIE/deploy/set-secret.js" "$@" || exit $?
cd "$COOKIE/deploy" && pm2 reload ecosystem.config.js --update-env 2>&1 | tail -2
sleep 4; curl -s http://127.0.0.1:3003/health; echo; echo "Cookie restarted with the new value."
