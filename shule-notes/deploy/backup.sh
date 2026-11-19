#!/usr/bin/env bash
# Backs up Shule Notes: the database and the uploaded PDFs.
#
#   - db-DATE.archive.gz      every collection in the database (students, notes, subjects, ...)
#   - uploads-DATE.tar.gz     every uploaded PDF
# Both files are checked after writing. Copies older than KEEP_DAYS (14) are deleted.
# Any problem makes this script exit with an error and say why, so a broken
# backup is never mistaken for a good one.
#
# Installed and scheduled by deploy/install-backup.sh. Run it by hand any time:
#   sudo /usr/local/sbin/shule-backup
set -euo pipefail
ENV_FILE="${ENV_FILE:-/etc/shule-notes/.env}"
DEST="${DEST:-/var/backups/shule-notes}"
UPLOADS_DIR="${UPLOADS_DIR:-/var/lib/shule-notes/uploads}"
KEEP_DAYS="${KEEP_DAYS:-14}"

umask 077
STAMP="$(date +%F-%H%M)"
mkdir -p "$DEST"
say() { echo "[$(date -u +%FT%TZ)] $*"; }
fail() { say "BACKUP FAILED: $*"; exit 1; }

# The connection string is read from the settings file (it is not sourced: it contains "&").
URI="$(grep -m1 '^MONGODB_URI=' "$ENV_FILE" | cut -d= -f2- || true)"
[ -n "$URI" ] || fail "no MONGODB_URI in $ENV_FILE"
command -v mongodump >/dev/null || fail "mongodump is not installed (sudo apt-get install -y mongodb-database-tools)"

DB_FILE="$DEST/db-$STAMP.archive.gz"
mongodump --uri "$URI" --gzip --archive="$DB_FILE" --quiet || { rm -f "$DB_FILE"; fail "mongodump could not read the database"; }
[ -s "$DB_FILE" ] && gzip -t "$DB_FILE" || { rm -f "$DB_FILE"; fail "the database backup file is empty or damaged"; }

UP_FILE="$DEST/uploads-$STAMP.tar.gz"
if [ -d "$UPLOADS_DIR" ]; then
  tar -czf "$UP_FILE" -C "$(dirname "$UPLOADS_DIR")" "$(basename "$UPLOADS_DIR")" || { rm -f "$UP_FILE"; fail "could not pack the uploaded PDFs"; }
  gzip -t "$UP_FILE" || { rm -f "$UP_FILE"; fail "the PDF backup file is damaged"; }
else
  say "no uploads folder yet ($UPLOADS_DIR): nothing to back up there"
fi

find "$DEST" -maxdepth 1 -type f \( -name 'db-*.archive.gz' -o -name 'uploads-*.tar.gz' \) -mtime +"$KEEP_DAYS" -delete
date -u +%FT%TZ > "$DEST/last-success"
say "OK: $(basename "$DB_FILE") $(du -h "$DB_FILE" | cut -f1)$( [ -f "$UP_FILE" ] && echo ", $(basename "$UP_FILE") $(du -h "$UP_FILE" | cut -f1)" ). Kept: $(find "$DEST" -maxdepth 1 -name 'db-*' | wc -l) database copies."
