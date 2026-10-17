#!/usr/bin/env bash
# Run as root:  bash /srv/mint-src/mint/deploy/setup-admin-code.sh        (turn the admin 6-digit code on)
#               bash /srv/mint-src/mint/deploy/setup-admin-code.sh off    (turn it off)
set -u
MINT=${MINT_DIR:-/srv/mint-src/mint}
[ "${1:-}" = off ] || { command -v qrencode >/dev/null 2>&1 || apt-get install -y qrencode >/dev/null 2>&1; }
node "$MINT/deploy/setup-admin-code.js" "$@" || exit $?
cd "$MINT/deploy" && pm2 reload ecosystem.config.js --update-env 2>&1 | tail -2
sleep 3; echo "Mint restarted."
