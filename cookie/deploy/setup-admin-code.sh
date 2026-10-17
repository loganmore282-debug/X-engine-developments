#!/usr/bin/env bash
# Run as root:  bash /srv/cookie-src/cookie/deploy/setup-admin-code.sh        (turn the admin 6-digit code on)
#               bash /srv/cookie-src/cookie/deploy/setup-admin-code.sh off    (turn it off)
set -u
COOKIE=${COOKIE_DIR:-/srv/cookie-src/cookie}
[ "${1:-}" = off ] || { command -v qrencode >/dev/null 2>&1 || apt-get install -y qrencode >/dev/null 2>&1; }
node "$COOKIE/deploy/setup-admin-code.js" "$@" || exit $?
cd "$COOKIE/deploy" && pm2 reload ecosystem.config.js --update-env 2>&1 | tail -2
sleep 3; echo "Cookie restarted."
