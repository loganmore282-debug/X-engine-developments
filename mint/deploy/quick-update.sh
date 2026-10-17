#!/usr/bin/env bash
# Brings Mint up to date from git and restarts ONLY Mint (never Soda). Use it until Mint has its own domain and nginx
# (after that, deploy/update-vps.sh does this and more). Run as root:   bash /srv/mint-src/mint/deploy/quick-update.sh
set -u
[ "$(id -u)" = 0 ] || { echo "Run this as root."; exit 1; }
SRC=${MINT_SRC:-/srv/mint-src}
cd "$SRC" || { echo "Cannot find $SRC"; exit 1; }
git pull --ff-only 2>&1 | tail -2
git log -1 --format='    now at: %h %s'
cd "$SRC/mint" && npm install --omit=dev --no-audit --no-fund 2>&1 | tail -1
cd "$SRC/mint/deploy" && pm2 reload ecosystem.config.js --only mint-server --update-env 2>&1 | tail -2
sleep 4; curl -s -m 8 "http://127.0.0.1:${MINT_PORT:-3002}/health"; echo
