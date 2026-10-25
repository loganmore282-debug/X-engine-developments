#!/usr/bin/env bash
# Brings Potato up to date from git and restarts ONLY Potato (never Soda). Use it until Potato has its own domain and nginx
# (after that, deploy/update-vps.sh does this and more). Run as root:   bash /srv/potato-src/potato/deploy/quick-update.sh
set -u
[ "$(id -u)" = 0 ] || { echo "Run this as root."; exit 1; }
SRC=${POTATO_SRC:-/srv/potato-src}
cd "$SRC" || { echo "Cannot find $SRC"; exit 1; }
git pull --ff-only 2>&1 | tail -2
git log -1 --format='    now at: %h %s'
cd "$SRC/potato" && npm install --omit=dev --no-audit --no-fund 2>&1 | tail -1
cd "$SRC/potato/deploy" && pm2 reload ecosystem.config.js --only potato-server --update-env 2>&1 | tail -2
sleep 4; curl -s -m 8 "http://127.0.0.1:${POTATO_PORT:-3004}/health"; echo
