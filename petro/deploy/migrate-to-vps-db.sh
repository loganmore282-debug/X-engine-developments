#!/usr/bin/env bash
# Moves petro's database from MongoDB to this VPS (one time). Run as root:
#   bash /srv/petro-src/petro/deploy/migrate-to-vps-db.sh
# What happens: petro-server is stopped (about a minute), every record is copied and CHECKED against MongoDB, then petro starts again on the VPS
# database. If any check fails, nothing is switched and petro starts again on MongoDB. MongoDB itself is never changed or deleted.
# To go back later: bash /srv/petro-src/petro/deploy/back-to-mongo.sh   (records made after the move stay only on the VPS)
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; APPDIR="$(dirname "$HERE")"
NAME=petro-server
[ "$(id -u)" = 0 ] || { echo "Run this as root."; exit 1; }
command -v pm2 >/dev/null 2>&1 && command -v node >/dev/null 2>&1 || { echo "pm2 and node are needed on this server."; exit 1; }
# the port the running server really listens on (from pm2), else from the ecosystem file, else the usual one
PORT=$(pm2 jlist 2>/dev/null | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const p=JSON.parse(s).find(x=>x.name==='$NAME');process.stdout.write(String((p&&p.pm2_env&&p.pm2_env.PORT)||''))}catch(e){}})" 2>/dev/null)
[ -n "$PORT" ] || PORT=$(cd "$HERE" && node -e "try{const e=require('./ecosystem.config.js').apps[0].env||{};process.stdout.write(String(e.PORT||''))}catch(e){}" 2>/dev/null)
[ -n "$PORT" ] || PORT=3000
if [ "${1:-}" != "--yes" ]; then
  echo "This moves petro's database from MongoDB to this VPS."
  echo "  - petro stops for about a minute (members cannot use it during that time)"
  echo "  - everything is copied and checked; MongoDB is not touched"
  echo "  - if a check fails, petro starts again on MongoDB as before"
  read -r -p "Type MOVE and press Enter to continue: " A; [ "$A" = "MOVE" ] || { echo "Nothing was changed."; exit 1; }
fi
cd "$APPDIR" || exit 1
echo "Stopping $NAME ..."; pm2 stop "$NAME" >/dev/null 2>&1
node deploy/migrate-to-vps-db.js; RC=$?
if [ $RC -ne 0 ]; then
  echo; echo "The move did NOT finish. Starting $NAME again exactly as before (MongoDB)."
  pm2 start "$NAME" >/dev/null 2>&1 || pm2 restart "$NAME" >/dev/null 2>&1
  exit 1
fi
pm2 start "$NAME" >/dev/null 2>&1 || pm2 restart "$NAME" >/dev/null 2>&1
echo "Starting $NAME on the VPS database ..."
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  H=$(curl -s -m 4 "http://127.0.0.1:$PORT/health" || true)
  case "$H" in *'"db":true'*) echo "Health: $H"; break ;; esac; sleep 3
done
pm2 logs "$NAME" --lines 60 --nostream 2>/dev/null | grep -E "Database:|database|ENGINE" | tail -3
case "${H:-}" in *'"db":true'*) echo; echo "DONE. petro now runs on the VPS database. Backups: nightly at 03:30 in /srv/petro-backups (newest 14 kept)."; echo "Keep the MongoDB data untouched for a few days as a safety copy.";;
  *) echo; echo "petro did not answer healthy yet. Look at:  pm2 logs $NAME --lines 60 --nostream"; echo "To go back to MongoDB right now:  bash $HERE/back-to-mongo.sh";; esac
