#!/usr/bin/env bash
# Run as root:  bash /srv/beer-src/beer/deploy/setup-admin-code.sh        (turn the admin 6-digit code on)
#               bash /srv/beer-src/beer/deploy/setup-admin-code.sh off    (turn it off)
set -u
BEER=${BEER_DIR:-/srv/beer-src/beer}
[ "${1:-}" = off ] || { command -v qrencode >/dev/null 2>&1 || apt-get install -y qrencode >/dev/null 2>&1; }
node "$BEER/deploy/setup-admin-code.js" "$@" || exit $?
cd "$BEER/deploy" && pm2 reload ecosystem.config.js --update-env 2>&1 | tail -2
sleep 3; echo "Beer restarted."
