#!/usr/bin/env bash
# Run as root:  bash /srv/smartai-src/smartai/deploy/setup-admin-code.sh        (turn the admin 6-digit code on)
#               bash /srv/smartai-src/smartai/deploy/setup-admin-code.sh off    (turn it off)
set -u
SMARTAI=${SMARTAI_DIR:-/srv/smartai-src/smartai}
[ "${1:-}" = off ] || { command -v qrencode >/dev/null 2>&1 || apt-get install -y qrencode >/dev/null 2>&1; }
node "$SMARTAI/deploy/setup-admin-code.js" "$@" || exit $?
cd "$SMARTAI/deploy" && pm2 reload ecosystem.config.js --update-env 2>&1 | tail -2
sleep 3; echo "Smart AI restarted."
