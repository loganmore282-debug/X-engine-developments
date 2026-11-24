#!/usr/bin/env bash
# Takes a dated, compressed backup of potato's VPS database RIGHT NOW (the server also does it by itself every night at 03:30).
#   bash /srv/potato-src/potato/deploy/backup-now.sh
set -u
BACKUP_DIR=${POTATO_BACKUP_DIR:-/srv/potato-backups}
pm2 sendSignal SIGUSR2 potato-server >/dev/null 2>&1 || { echo "potato-server is not running (pm2 list)."; exit 1; }
sleep 4
echo "Newest backups in $BACKUP_DIR:"; ls -lh "$BACKUP_DIR" 2>/dev/null | tail -4
echo; pm2 logs potato-server --lines 6 --nostream 2>/dev/null | grep -iE "backup|not in use" | tail -2
echo; echo "A backup on the same disk does not survive the disk. Copy one OFF this server too, from your own computer:"
echo "  scp root@<this server's IP>:$BACKUP_DIR/<file>.jsonl.gz ."
