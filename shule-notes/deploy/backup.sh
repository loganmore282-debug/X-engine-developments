#!/usr/bin/env bash
# Nightly backup of the uploaded PDFs and (when MONGODB_URI is reachable) the
# database. Keeps the last 7 days in /var/backups/shule-notes.
#
#   sudo cp backup.sh /usr/local/bin/shule-backup && sudo chmod +x /usr/local/bin/shule-backup
#   echo '30 3 * * * root /usr/local/bin/shule-backup' | sudo tee /etc/cron.d/shule-backup
#
# The database part needs MongoDB's command line tools:
#   sudo apt-get install -y mongodb-database-tools
# MongoDB Atlas's free tier (M0) has NO backups of its own, so this matters there.
set -euo pipefail
DEST=/var/backups/shule-notes
STAMP="$(date +%F)"
mkdir -p "$DEST"
# Read the one value we need; sourcing the file would break on the "&" in a connection string.
MONGODB_URI="$(grep -m1 '^MONGODB_URI=' /etc/shule-notes/.env | cut -d= -f2-)"

tar -czf "$DEST/uploads-$STAMP.tar.gz" -C /var/lib/shule-notes uploads
if command -v mongodump >/dev/null; then
  mongodump --uri "$MONGODB_URI" --gzip --archive="$DEST/mongo-$STAMP.archive.gz" --quiet
else
  echo "mongodump is not installed, so the database was not backed up."
fi
find "$DEST" -type f -mtime +7 -delete
