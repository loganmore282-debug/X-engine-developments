#!/usr/bin/env bash
# Shows how PersonalCare's database is doing: is it up, how big is it, are the backups there, how much disk is left.   Run as root.
DATA_DIR=${PERSONALCARE_DATA_DIR:-/srv/personalcare-data}; BACKUP_DIR=${PERSONALCARE_BACKUP_DIR:-/srv/personalcare-backups}
echo "health:   $(curl -s -m 5 http://127.0.0.1:${PERSONALCARE_PORT:-3008}/health)"
echo "data:     $(du -sh "$DATA_DIR" 2>/dev/null | cut -f1)  in $DATA_DIR"; ls -lh "$DATA_DIR" 2>/dev/null | grep -E "snapshot|journal" | awk '{print "          " $5 "  " $9}'
echo "backups:  $(ls "$BACKUP_DIR" 2>/dev/null | wc -l) file(s) in $BACKUP_DIR, newest:"; ls -lht "$BACKUP_DIR" 2>/dev/null | sed -n 2,4p | awk '{print "          " $5 "  " $6 " " $7 " " $8 "  " $9}'
echo "disk:     $(df -h "$DATA_DIR" 2>/dev/null | awk 'NR==2{print $4 " free of " $2}')"
