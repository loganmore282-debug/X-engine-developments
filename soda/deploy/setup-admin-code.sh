#!/usr/bin/env bash
# Run as root:  bash /srv/soda-src/soda/deploy/setup-admin-code.sh        (turn the admin 6-digit code on)
#               bash /srv/soda-src/soda/deploy/setup-admin-code.sh off    (turn it off)
set -u
SODA=${SODA_DIR:-/srv/soda-src/soda}
[ "${1:-}" = off ] || { command -v qrencode >/dev/null 2>&1 || apt-get install -y qrencode >/dev/null 2>&1; }
node "$SODA/deploy/setup-admin-code.js" "$@" || exit $?
cd "$SODA/deploy" && pm2 reload ecosystem.config.js --update-env 2>&1 | tail -2
sleep 3; echo "Soda restarted."
