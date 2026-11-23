#!/usr/bin/env bash
# ONE-TIME setup of PersonalCare's backend on the VPS, next to Soda. It never touches Soda: PersonalCare has its own folder (/srv/personalcare-src), its own
# secrets (/srv/personalcare-secrets), its own process (pm2 "personalcare-server") and its own port (3008, loopback only, so nothing outside can reach it).
# PersonalCare has NO MongoDB: its database is a folder on this VPS (/srv/personalcare-data) with nightly backups (/srv/personalcare-backups).
# It creates those folders, asks for the admin password with hidden typing, saves the secrets, starts the server and tests /health.
# Run as root, from the fresh clone (see the one command in personalcare/CLAUDE.md "Hosting"):   bash /srv/personalcare-src/personalcare/deploy/first-setup.sh
set -u
say() { printf '\n==> %s\n' "$*"; }
[ "$(id -u)" = 0 ] || { echo "Run this as root."; exit 1; }
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PERSONALCARE=${PERSONALCARE_DIR:-$(dirname "$HERE")}
SECRETS_DIR=${PERSONALCARE_SECRETS_DIR:-/srv/personalcare-secrets}
FILE=${PERSONALCARE_SECRETS_FILE:-$SECRETS_DIR/secrets.local.js}
PORT_WANTED=${PERSONALCARE_PORT:-3008}
export PERSONALCARE_SECRETS_FILE="$FILE"
command -v node >/dev/null || { echo "Node is not installed."; exit 1; }
command -v pm2  >/dev/null || { echo "pm2 is not installed (it is, if Soda runs here)."; exit 1; }

say "1/6  Packages"
cd "$PERSONALCARE" || exit 1
npm install --omit=dev --no-audit --no-fund 2>&1 | tail -1

say "2/6  Secrets folder (root only, outside git)"
mkdir -p "$SECRETS_DIR"; chmod 700 "$SECRETS_DIR"
[ -f "$FILE" ] || (umask 077; : > "$FILE")
chmod 600 "$FILE"
has() { grep -q "^module\.exports\.$1 *=" "$FILE"; }
put() { PERSONALCARE_SECRET_VALUE="$2" node "$PERSONALCARE/deploy/set-secret.js" "$1" >/dev/null || { echo "Could not save $1"; exit 1; }; }

say "3/6  The database (it lives on this VPS, no MongoDB)"
DATA_DIR=${PERSONALCARE_DATA_DIR:-/srv/personalcare-data}
BACKUP_DIR=${PERSONALCARE_BACKUP_DIR:-/srv/personalcare-backups}
mkdir -p "$DATA_DIR" "$BACKUP_DIR"; chmod 700 "$DATA_DIR" "$BACKUP_DIR"
has PERSONALCARE_DATA_DIR || put PERSONALCARE_DATA_DIR "$DATA_DIR"
has PERSONALCARE_BACKUP_DIR || put PERSONALCARE_BACKUP_DIR "$BACKUP_DIR"
echo "    data folder:    $DATA_DIR   (every member, balance and record; keep it on this disk, never delete it)"
echo "    backup folder:  $BACKUP_DIR   (a dated, compressed copy is made every night at 03:30; the newest 14 are kept)"
echo "    Take a backup right now any time:  bash $PERSONALCARE/deploy/backup-now.sh"

say "4/6  Admin password and the other settings"
if has ADMIN_KEY; then echo "    admin password already saved"; else
  while :; do
    read -r -s -p "    Choose the PersonalCare admin password (at least 16 characters, nothing is shown): " AK; echo
    [ "${#AK}" -ge 16 ] && break || echo "    Too short."
  done
  put ADMIN_KEY "$AK"; unset AK
fi
has PORT || put PORT "$PORT_WANTED"
if has DEPLOY_WEBHOOK_SECRET; then :; else put DEPLOY_WEBHOOK_SECRET "$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"; fi

say "5/6  Start PersonalCare (pm2 name: personalcare-server) -- Soda is not touched"
cd "$PERSONALCARE/deploy" || exit 1
if pm2 describe personalcare-server >/dev/null 2>&1; then pm2 reload ecosystem.config.js --only personalcare-server --update-env 2>&1 | tail -2
else pm2 start ecosystem.config.js --only personalcare-server 2>&1 | tail -3; fi
pm2 save >/dev/null 2>&1

say "6/6  Health check"
OK=""
for i in 1 2 3 4 5 6 7 8 9 10; do
  H=$(curl -s -m 5 "http://127.0.0.1:$PORT_WANTED/health" || true)
  case "$H" in *'"status":"ok"'*|*'"ok":true'*) OK=1; break ;; esac
  sleep 2
done
echo "    /health -> ${H:-(no answer)}"
if [ -n "$OK" ]; then
  echo; echo "DONE. PersonalCare's backend is running (port $PORT_WANTED, local only) and using its own database in $DATA_DIR."
  echo "Check the log any time:  pm2 logs personalcare-server --lines 40 --nostream     (look for: PersonalCare database opened)"
else
  echo; echo "NOT healthy yet. Send me the output of:  pm2 logs personalcare-server --lines 40 --nostream"
fi
