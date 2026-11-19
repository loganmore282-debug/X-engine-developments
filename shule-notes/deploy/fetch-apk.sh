#!/usr/bin/env bash
# Keeps the download page's APK in step with the newest build on GitHub.
# Runs every 10 minutes (installed by publish-apk.sh). It downloads only when the
# file on GitHub has actually changed, and replaces the old file in one step so
# nobody ever downloads a half-written one.
set -euo pipefail
URL="${APK_URL:-https://github.com/loganmore282-debug/X-engine-developments/releases/download/shule-notes-live/shule-notes-live.apk}"
DIR="${DOWNLOAD_DIR:-/var/www/shule-download}"
STATE="$DIR/.signature"
mkdir -p "$DIR"

# Identify the current file from its response headers (the last hop, after redirects).
SIG="$(curl -fsSIL --max-time 30 "$URL" | tr -d '\r' | tr 'A-Z' 'a-z' | awk '/^(etag|last-modified|content-length):/ {h[$1]=$2" "$3" "$4" "$5" "$6" "$7} /^http/ {delete h} END {print h["etag:"] "|" h["last-modified:"] "|" h["content-length:"]}')"
if [ -f "$STATE" ] && [ "$SIG" = "$(cat "$STATE")" ] && [ -s "$DIR/shule-notes.apk" ]; then
  echo "up to date"; exit 0
fi

TMP="$(mktemp "$DIR/.download.XXXXXX")"
trap 'rm -f "$TMP"' EXIT
curl -fsSL --max-time 600 -o "$TMP" "$URL"
# An APK is a zip file: refuse anything else (an error page, a half download).
[ "$(head -c 2 "$TMP")" = "PK" ] || { echo "downloaded file is not an APK; keeping the old one"; exit 1; }
SIZE="$(stat -c %s "$TMP")"
chmod 644 "$TMP"
mv -f "$TMP" "$DIR/shule-notes.apk"
printf '%s' "$SIG" > "$STATE"
# The build number, published beside the APK. The server reads version.json to tell
# students when a newer version exists. An older release without it is simply skipped.
VERSION="$(curl -fsS --max-time 20 "${URL%/*}/shule-notes-live.version.txt" 2>/dev/null | tr -dc '0-9' | head -c 9 || true)"
if [ -n "$VERSION" ]; then
  printf '{"versionCode":%s}\n' "$VERSION" > "$DIR/version.json"
  chmod 644 "$DIR/version.json"
  printf '{"size":%s,"updated":"%s","versionCode":%s}\n' "$SIZE" "$(date -u +%FT%TZ)" "$VERSION" > "$DIR/info.json"
else
  printf '{"size":%s,"updated":"%s"}\n' "$SIZE" "$(date -u +%FT%TZ)" > "$DIR/info.json"
fi
chmod 644 "$DIR/info.json"
echo "updated: $SIZE bytes"
