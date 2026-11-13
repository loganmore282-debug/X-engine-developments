#!/usr/bin/env bash
# Brings Beer up to date from git and restarts ONLY Beer (never Soda). Use it until Beer has its own domain and nginx
# (after that, deploy/update-vps.sh does this and more). Run as root:   bash /srv/beer-src/beer/deploy/quick-update.sh
set -u
[ "$(id -u)" = 0 ] || { echo "Run this as root."; exit 1; }
SRC=${BEER_SRC:-/srv/beer-src}
cd "$SRC" || { echo "Cannot find $SRC"; exit 1; }
git pull --ff-only 2>&1 | tail -2; [ "${PIPESTATUS[0]}" = 0 ] || echo "    !! git pull failed (see above): carrying on with the code that is already here"
git log -1 --format='    now at: %h %s'
cd "$SRC/beer" && npm install --omit=dev --no-audit --no-fund 2>&1 | tail -1
cd "$SRC/beer/deploy" && pm2 reload ecosystem.config.js --only beer-server --update-env 2>&1 | tail -2
# The preview's nginx file is rebuilt from the new code too (it is what lets /payment/<number> open on a reload); a bad file is put back by preview.sh itself.
# A real domain's file is rebuilt by deploy/update-vps.sh instead.
if [ -f /etc/nginx/conf.d/beer-preview.conf ] && [ ! -f /etc/nginx/conf.d/beer.conf ]; then bash "$SRC/beer/deploy/preview.sh" on 2>&1 | head -3; fi
sleep 4; curl -s -m 8 "http://127.0.0.1:${BEER_PORT:-3007}/health"; echo
