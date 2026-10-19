#!/usr/bin/env bash
# Brings Cookie up to date from git and restarts ONLY Cookie (never Soda). Use it until Cookie has its own domain and nginx
# (after that, deploy/update-vps.sh does this and more). Run as root:   bash /srv/cookie-src/cookie/deploy/quick-update.sh
set -u
[ "$(id -u)" = 0 ] || { echo "Run this as root."; exit 1; }
SRC=${COOKIE_SRC:-/srv/cookie-src}
cd "$SRC" || { echo "Cannot find $SRC"; exit 1; }
git pull --ff-only 2>&1 | tail -2; [ "${PIPESTATUS[0]}" = 0 ] || echo "    !! git pull failed (see above): carrying on with the code that is already here"
git log -1 --format='    now at: %h %s'
cd "$SRC/cookie" && npm install --omit=dev --no-audit --no-fund 2>&1 | tail -1
cd "$SRC/cookie/deploy" && pm2 reload ecosystem.config.js --only cookie-server --update-env 2>&1 | tail -2
# The preview's nginx file is rebuilt from the new code too (it is what lets /payment/<number> open on a reload); a bad file is put back by preview.sh itself.
# A real domain's file is rebuilt by deploy/update-vps.sh instead.
if [ -f /etc/nginx/conf.d/cookie-preview.conf ] && [ ! -f /etc/nginx/conf.d/cookie.conf ]; then bash "$SRC/cookie/deploy/preview.sh" on 2>&1 | head -3; fi
sleep 4; curl -s -m 8 "http://127.0.0.1:${COOKIE_PORT:-3003}/health"; echo
