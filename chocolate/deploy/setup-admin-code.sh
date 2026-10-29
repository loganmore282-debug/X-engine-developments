#!/usr/bin/env bash
# Run as root:  bash /srv/chocolate-src/chocolate/deploy/setup-admin-code.sh        (turn the admin 6-digit code on)
#               bash /srv/chocolate-src/chocolate/deploy/setup-admin-code.sh off    (turn it off)
set -u
CHOCOLATE=${CHOCOLATE_DIR:-/srv/chocolate-src/chocolate}
[ "${1:-}" = off ] || { command -v qrencode >/dev/null 2>&1 || apt-get install -y qrencode >/dev/null 2>&1; }
node "$CHOCOLATE/deploy/setup-admin-code.js" "$@" || exit $?
cd "$CHOCOLATE/deploy" && pm2 reload ecosystem.config.js --update-env 2>&1 | tail -2
sleep 3; echo "Chocolate restarted."
