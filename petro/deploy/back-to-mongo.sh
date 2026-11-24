#!/usr/bin/env bash
# Puts petro back on MongoDB (the copy from before the move). Records made on the VPS database since the move are NOT in MongoDB.
# The VPS database folder is kept (nothing is deleted). Run as root:  bash /srv/petro-src/petro/deploy/back-to-mongo.sh
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; APPDIR="$(dirname "$HERE")"; NAME=petro-server
[ "$(id -u)" = 0 ] || { echo "Run this as root."; exit 1; }
echo "This puts petro back on MongoDB. Anything members did since the move stays only in the VPS folder."
read -r -p "Type BACK and press Enter to continue: " A; [ "$A" = "BACK" ] || { echo "Nothing was changed."; exit 1; }
pm2 stop "$NAME" >/dev/null 2>&1
cd "$APPDIR" && node -e "const e=require('./dbengine'); const r=e.disableMarker('petro'); console.log(r?('ENGINE.json renamed to '+r):'There was no ENGINE.json (already on MongoDB).')"
pm2 start "$NAME" >/dev/null 2>&1 || pm2 restart "$NAME" >/dev/null 2>&1
sleep 6; pm2 logs "$NAME" --lines 40 --nostream 2>/dev/null | grep -E "Database:" | tail -2
