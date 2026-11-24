#!/usr/bin/env bash
# Puts a backup back as soda's VPS database. The CURRENT data folder is kept (renamed) first, nothing is deleted.
#   bash /srv/soda-src/soda/deploy/restore-backup.sh /srv/soda-backups/backup-20261123-033000.jsonl.gz
# Run as root. soda is stopped while it restores and started again afterwards.
set -u
FILE=${1:-}
[ -n "$FILE" ] && [ -f "$FILE" ] || { echo "Give the backup file:  bash $0 /srv/soda-backups/backup-....jsonl.gz"; ls -1 "${SODA_BACKUP_DIR:-/srv/soda-backups}" 2>/dev/null | tail -5; exit 1; }
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; APP="$(dirname "$HERE")"
DATA_DIR=${SODA_DATA_DIR:-/srv/soda-data}
echo "Stopping soda-server..."; pm2 stop soda-server >/dev/null 2>&1
if [ -d "$DATA_DIR" ]; then KEEP="$DATA_DIR.before-restore-$(date +%Y%m%d-%H%M%S)"; mv "$DATA_DIR" "$KEEP" && echo "Old data kept at $KEEP"; fi
mkdir -p "$DATA_DIR"; chmod 700 "$DATA_DIR"
node -e 'const { LocalStore } = require(process.argv[1] + "/localstore.js"); const r = LocalStore.restoreFromBackup(process.argv[2], process.argv[3]); console.log("Restored " + r.docs + " documents.");' "$APP" "$FILE" "$DATA_DIR" || { echo "RESTORE FAILED. Your old data is untouched at ${KEEP:-$DATA_DIR}. Put it back with:  rm -rf $DATA_DIR; mv ${KEEP:-X} $DATA_DIR"; exit 1; }
# the restored folder must keep telling the server to use the VPS database
(cd "$APP" && node -e 'require("./dbengine").writeMarker("soda", { restoredFrom: process.argv[1], migratedAt: new Date().toISOString() })' "$FILE")
pm2 start soda-server >/dev/null 2>&1 || pm2 restart soda-server >/dev/null 2>&1
sleep 5; curl -s -m 6 "http://127.0.0.1:${SODA_PORT:-3001}/health"; echo
