#!/usr/bin/env bash
# Brings PersonalCare up to date from git and restarts ONLY PersonalCare (never Soda). Use it until PersonalCare has its own domain and nginx
# (after that, deploy/update-vps.sh does this and more). Run as root:   bash /srv/personalcare-src/personalcare/deploy/quick-update.sh
set -u
[ "$(id -u)" = 0 ] || { echo "Run this as root."; exit 1; }
SRC=${PERSONALCARE_SRC:-/srv/personalcare-src}
cd "$SRC" || { echo "Cannot find $SRC"; exit 1; }
git pull --ff-only 2>&1 | tail -2; [ "${PIPESTATUS[0]}" = 0 ] || echo "    !! git pull failed (see above): carrying on with the code that is already here"
git log -1 --format='    now at: %h %s'
cd "$SRC/personalcare" && npm install --omit=dev --no-audit --no-fund 2>&1 | tail -1
cd "$SRC/personalcare/deploy" && pm2 reload ecosystem.config.js --only personalcare-server --update-env 2>&1 | tail -2
# The preview's nginx file is rebuilt from the new code too (it is what lets /payment/<number> open on a reload); a bad file is put back by preview.sh itself.
# A real domain's file is rebuilt by deploy/update-vps.sh instead.
if [ -f /etc/nginx/conf.d/personalcare-preview.conf ] && [ ! -f /etc/nginx/conf.d/personalcare.conf ]; then bash "$SRC/personalcare/deploy/preview.sh" on 2>&1 | head -3; fi
sleep 4; curl -s -m 8 "http://127.0.0.1:${PERSONALCARE_PORT:-3008}/health"; echo
