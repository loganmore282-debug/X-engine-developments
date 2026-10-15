#!/usr/bin/env bash
# Changes the secret admin-panel address. The OLD address stops working at once (nginx answers 404 for it).
# Run as root:  bash /srv/soda-src/soda/deploy/change-admin-path.sh            (makes a new random 32-character path)
#               bash /srv/soda-src/soda/deploy/change-admin-path.sh MyNewPath  (your own: 6-32 letters/digits only)
set -u
SODA=${SODA_DIR:-/srv/soda-src/soda}
ADMIN_PATH_FILE=${SODA_ADMIN_PATH_FILE:-/srv/soda-secrets/admin-path}
ADMIN_HOST_FILE=${SODA_ADMIN_HOST_FILE:-/srv/soda-secrets/admin-host}
[ "$(id -u)" = 0 ] || { echo "Run this as root."; exit 1; }
NEW=${1:-}
[ -n "$NEW" ] || NEW=$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')
printf '%s' "$NEW" | grep -Eq '^[A-Za-z0-9]{6,32}$' || { echo "The path must be 6 to 32 letters or digits (no symbols or spaces)."; exit 1; }
OLD=""; [ -s "$ADMIN_PATH_FILE" ] && OLD=$(tr -d '[:space:]' < "$ADMIN_PATH_FILE")
[ "$NEW" != "$OLD" ] || { echo "That is already the admin path."; exit 0; }
mkdir -p "$(dirname "$ADMIN_PATH_FILE")"
(umask 077; printf '%s' "$NEW" > "$ADMIN_PATH_FILE"; chmod 600 "$ADMIN_PATH_FILE")
if bash "$SODA/deploy/update-vps.sh" > /tmp/soda.adminpath-update.log 2>&1 && grep -q "^DONE\." /tmp/soda.adminpath-update.log; then
  H=sv37ah.p-colasoda.com; [ -s "$ADMIN_HOST_FILE" ] && H=$(tr -d '[:space:]' < "$ADMIN_HOST_FILE")
  echo "Done. The admin panel is now at:  https://$H/$NEW/"
  echo "(the host above is the usual one; use whichever admin host you normally open)"
  echo "The old address no longer works. Open the new one and sign in again; delete the old bookmark / home-screen icon and save the new link."
else
  echo "The update did not finish. Putting the old path back."
  if [ -n "$OLD" ]; then (umask 077; printf '%s' "$OLD" > "$ADMIN_PATH_FILE"); else rm -f "$ADMIN_PATH_FILE"; fi
  tail -12 /tmp/soda.adminpath-update.log
fi
