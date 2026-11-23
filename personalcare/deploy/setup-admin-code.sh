#!/usr/bin/env bash
# Run as root:  bash /srv/personalcare-src/personalcare/deploy/setup-admin-code.sh        (turn the admin 6-digit code on)
#               bash /srv/personalcare-src/personalcare/deploy/setup-admin-code.sh off    (turn it off)
set -u
PERSONALCARE=${PERSONALCARE_DIR:-/srv/personalcare-src/personalcare}
[ "${1:-}" = off ] || { command -v qrencode >/dev/null 2>&1 || apt-get install -y qrencode >/dev/null 2>&1; }
node "$PERSONALCARE/deploy/setup-admin-code.js" "$@" || exit $?
cd "$PERSONALCARE/deploy" && pm2 reload ecosystem.config.js --update-env 2>&1 | tail -2
sleep 3; echo "PersonalCare restarted."
