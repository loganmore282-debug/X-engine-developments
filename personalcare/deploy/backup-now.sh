#!/usr/bin/env bash
# Takes a dated, compressed backup of PersonalCare's whole database RIGHT NOW (the server also does it by itself every night at 03:30).
# It asks the running server to do it (a consistent copy of one moment), then shows the newest backups.   Run as root:  bash /srv/personalcare-src/personalcare/deploy/backup-now.sh
set -u
BACKUP_DIR=${PERSONALCARE_BACKUP_DIR:-/srv/personalcare-backups}
pm2 sendSignal SIGUSR2 personalcare-server >/dev/null 2>&1 || { echo "personalcare-server is not running (pm2 list)."; exit 1; }
sleep 4
echo "Newest backups in $BACKUP_DIR:"; ls -lh "$BACKUP_DIR" | tail -4
echo; pm2 logs personalcare-server --lines 4 --nostream 2>/dev/null | grep -i "backup" | tail -2
echo; echo "Copy one OFF this server too (a backup on the same disk does not survive the disk). From your own computer or phone:"
echo "  scp root@<this server's IP>:$BACKUP_DIR/<file>.jsonl.gz ."
