#!/usr/bin/env bash
# Installs the nightly backup (03:17 server time, every day) and runs it once now.
#
#   sudo ./install-backup.sh
# Safe to run again. It only adds: /usr/local/sbin/shule-backup, one cron file, one log file.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Run this as root (sudo)."; exit 1; }
HERE="$(cd "$(dirname "$0")" && pwd)"

command -v mongodump >/dev/null || { echo "==> Installing mongodump (the database backup tool)"; apt-get update -y >/dev/null; DEBIAN_FRONTEND=noninteractive apt-get install -y mongodb-database-tools || { echo "Could not install mongodump. Run deploy/mongodb/setup-mongodb.sh first."; exit 1; }; }
command -v cron >/dev/null || { apt-get update -y >/dev/null; DEBIAN_FRONTEND=noninteractive apt-get install -y cron; systemctl enable --now cron >/dev/null 2>&1 || true; }

install -m 700 -o root -g root "$HERE/backup.sh" /usr/local/sbin/shule-backup
mkdir -p /var/backups/shule-notes; chmod 700 /var/backups/shule-notes
echo '17 3 * * * root /usr/local/sbin/shule-backup >> /var/log/shule-backup.log 2>&1' > /etc/cron.d/shule-backup
chmod 644 /etc/cron.d/shule-backup

echo "==> Running the first backup now"
/usr/local/sbin/shule-backup | tee -a /var/log/shule-backup.log
echo
ls -lh /var/backups/shule-notes
echo
echo "Done. A backup now runs every night at 03:17 (server time) and keeps 14 days."
echo "Check any time:  cat /var/backups/shule-notes/last-success   and   tail /var/log/shule-backup.log"
