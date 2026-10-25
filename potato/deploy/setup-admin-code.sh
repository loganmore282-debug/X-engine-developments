#!/usr/bin/env bash
# Run as root:  bash /srv/potato-src/potato/deploy/setup-admin-code.sh        (turn the admin 6-digit code on)
#               bash /srv/potato-src/potato/deploy/setup-admin-code.sh off    (turn it off)
set -u
POTATO=${POTATO_DIR:-/srv/potato-src/potato}
[ "${1:-}" = off ] || { command -v qrencode >/dev/null 2>&1 || apt-get install -y qrencode >/dev/null 2>&1; }
node "$POTATO/deploy/setup-admin-code.js" "$@" || exit $?
cd "$POTATO/deploy" && pm2 reload ecosystem.config.js --update-env 2>&1 | tail -2
sleep 3; echo "Potato restarted."
