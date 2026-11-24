#!/usr/bin/env bash
# Shows which database potato is using and how it is doing.   bash /srv/potato-src/potato/deploy/db-status.sh
DATA_DIR=${POTATO_DATA_DIR:-/srv/potato-data}; BACKUP_DIR=${POTATO_BACKUP_DIR:-/srv/potato-backups}
if [ -f "$DATA_DIR/ENGINE.json" ] && grep -q '"engine": *"local"' "$DATA_DIR/ENGINE.json"; then echo "database: the VPS ($DATA_DIR)  [moved $(grep -o '"migratedAt": *"[^"]*"' "$DATA_DIR/ENGINE.json" | cut -d'"' -f4)]"; else echo "database: MongoDB (not moved yet: run deploy/migrate-to-vps-db.sh)"; fi
echo "health:   $(curl -s -m 5 http://127.0.0.1:${POTATO_PORT:-3004}/health)"
echo "data:     $(du -sh "$DATA_DIR" 2>/dev/null | cut -f1)  in $DATA_DIR"; ls -lh "$DATA_DIR" 2>/dev/null | grep -E "snapshot|journal" | awk '{print "          " $5 "  " $9}'
echo "backups:  $(ls "$BACKUP_DIR" 2>/dev/null | wc -l) file(s) in $BACKUP_DIR, newest:"; ls -lht "$BACKUP_DIR" 2>/dev/null | sed -n 2,4p | awk '{print "          " $5 "  " $6 " " $7 " " $8 "  " $9}'
echo "disk:     $(df -h "$DATA_DIR" 2>/dev/null | awk 'NR==2{print $4 " free of " $2}')"
