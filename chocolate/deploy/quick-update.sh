#!/usr/bin/env bash
# Brings Chocolate up to date from git and restarts ONLY Chocolate (never Soda). Use it until Chocolate has its own domain and nginx
# (after that, deploy/update-vps.sh does this and more). Run as root:   bash /srv/chocolate-src/chocolate/deploy/quick-update.sh
set -u
[ "$(id -u)" = 0 ] || { echo "Run this as root."; exit 1; }
SRC=${CHOCOLATE_SRC:-/srv/chocolate-src}
cd "$SRC" || { echo "Cannot find $SRC"; exit 1; }
git pull --ff-only 2>&1 | tail -2
git log -1 --format='    now at: %h %s'
cd "$SRC/chocolate" && npm install --omit=dev --no-audit --no-fund 2>&1 | tail -1
cd "$SRC/chocolate/deploy" && pm2 reload ecosystem.config.js --only chocolate-server --update-env 2>&1 | tail -2
sleep 4; curl -s -m 8 "http://127.0.0.1:${CHOCOLATE_PORT:-3005}/health"; echo
