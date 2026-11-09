#!/usr/bin/env bash
# Brings Smart AI up to date from git and restarts ONLY Smart AI (never Soda). Use it until Smart AI has its own domain and nginx
# (after that, deploy/update-vps.sh does this and more). Run as root:   bash /srv/smartai-src/smartai/deploy/quick-update.sh
set -u
[ "$(id -u)" = 0 ] || { echo "Run this as root."; exit 1; }
SRC=${SMARTAI_SRC:-/srv/smartai-src}
cd "$SRC" || { echo "Cannot find $SRC"; exit 1; }
git pull --ff-only 2>&1 | tail -2
git log -1 --format='    now at: %h %s'
cd "$SRC/smartai" && npm install --omit=dev --no-audit --no-fund 2>&1 | tail -1
cd "$SRC/smartai/deploy" && pm2 reload ecosystem.config.js --only smartai-server --update-env 2>&1 | tail -2
sleep 4; curl -s -m 8 "http://127.0.0.1:${SMARTAI_PORT:-3006}/health"; echo
