#!/usr/bin/env bash
# Gives Shule Notes its OWN MongoDB on this server, without touching any MongoDB
# you already run:
#   - a separate service (shule-mongod), config (/etc/shule-mongod.conf), data
#     folder (/var/lib/shule-mongodb) and port (27018, or the next free one);
#   - listens on 127.0.0.1 only and requires a password;
#   - uses the mongod program already on the server if there is one (it is not
#     upgraded or reconfigured), otherwise installs only the MongoDB 8.0 server
#     package and holds it so a routine "apt upgrade" never jumps versions.
#
#   sudo ./setup-mongodb.sh        (run deploy/setup.sh first)
# Safe to run again: existing users and data are left alone.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Run this as root (sudo)."; exit 1; }

HERE="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE=/etc/shule-notes/.env
CRED=/root/shule-mongodb-credentials.txt
DATA=/var/lib/shule-mongodb
[ -d /opt/shule-notes/backend/node_modules/mongodb ] || { echo "Run deploy/setup.sh first (it installs the app and its database driver)."; exit 1; }
NODE=/opt/shule-notes/node/bin/node; [ -x "$NODE" ] || NODE="$(command -v node)"
export NODE_PATH=/opt/shule-notes/backend/node_modules
port_in_use() { [ -n "$(ss -ltnH "( sport = :$1 )" 2>/dev/null)" ]; }

echo "==> The MongoDB program"
MONGOD="$(command -v mongod || true)"
if [ -n "$MONGOD" ]; then
  echo "    found $("$MONGOD" --version | head -1) at $MONGOD: using it as it is (not upgraded)"
else
  . /etc/os-release
  case "$VERSION_CODENAME" in jammy|noble) ;; *) echo "Unsupported Ubuntu release $VERSION_CODENAME."; exit 1 ;; esac
  export DEBIAN_FRONTEND=noninteractive
  apt-get install -y curl gnupg ca-certificates >/dev/null
  curl -fsSL https://www.mongodb.org/static/pgp/server-8.0.asc | gpg --dearmor --yes -o /usr/share/keyrings/mongodb-server-8.0.gpg
  echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-8.0.gpg ] https://repo.mongodb.org/apt/ubuntu $VERSION_CODENAME/mongodb-org/8.0 multiverse" > /etc/apt/sources.list.d/mongodb-org-8.0.list
  apt-get update -y >/dev/null
  apt-get install -y mongodb-org-server mongodb-database-tools
  apt-mark hold mongodb-org-server >/dev/null
  # The package ships a default "mongod" service; we do not use or start it.
  systemctl disable --now mongod >/dev/null 2>&1 || true
  MONGOD="$(command -v mongod)"
fi

echo "==> Its own port (27018 or the next free one)"
PORT=27018
if [ -f /etc/shule-mongod.conf ] && systemctl is-active --quiet shule-mongod; then
  PORT="$(grep -m1 'port:' /etc/shule-mongod.conf | awk '{print $2}')"
else
  while port_in_use "$PORT"; do PORT=$((PORT + 1)); done
fi
echo "    $PORT"

echo "==> Its own user, folders, config and service"
id shule-mongo >/dev/null 2>&1 || useradd --system --home "$DATA" --shell /usr/sbin/nologin shule-mongo
mkdir -p "$DATA" /var/log/shule-mongodb
chown -R shule-mongo:shule-mongo "$DATA" /var/log/shule-mongodb
sed "s|__MONGOD__|$MONGOD|" "$HERE/shule-mongod.service" > /etc/systemd/system/shule-mongod.service
systemctl daemon-reload
systemctl enable shule-mongod >/dev/null

if [ ! -f "$CRED" ]; then
  echo "==> Creating the users (this instance has no login for these few seconds, and listens on localhost only)"
  sed "s|__PORT__|$PORT|; s|__AUTH__|disabled|" "$HERE/mongod.conf" > /etc/shule-mongod.conf
  systemctl restart shule-mongod
  for i in $(seq 1 40); do "$NODE" -e "
    const {MongoClient}=require('mongodb');
    new MongoClient('mongodb://127.0.0.1:$PORT/?directConnection=true',{serverSelectionTimeoutMS:1000}).connect().then(c=>c.close()).then(()=>process.exit(0),()=>process.exit(1))" && break; sleep 1; done
  ROOT_PASS="$(openssl rand -hex 20)"; APP_PASS="$(openssl rand -hex 20)"   # hex: safe inside a connection string
  "$NODE" "$HERE/create-users.js" create "$PORT" "$ROOT_PASS" "$APP_PASS"
  umask 077
  cat > "$CRED" <<CREDS
Shule Notes MongoDB credentials (keep this file private)

App connection string (already put into $ENV_FILE):
  mongodb://shule_app:$APP_PASS@127.0.0.1:$PORT/shulenotesdb?authSource=shulenotesdb

Full-control login, for you only:
  mongodb://shule_root:$ROOT_PASS@127.0.0.1:$PORT/admin
CREDS
else
  echo "==> Users already exist ($CRED), leaving them as they are"
fi

echo "==> Switching on the password requirement"
sed "s|__PORT__|$PORT|; s|__AUTH__|enabled|" "$HERE/mongod.conf" > /etc/shule-mongod.conf
systemctl restart shule-mongod
sleep 3

URI="$(grep -m1 '^  mongodb://shule_app' "$CRED" | sed 's/^  //')"
if [ -f "$ENV_FILE" ]; then
  grep -v '^MONGODB_URI=' "$ENV_FILE" > "$ENV_FILE.tmp" || true
  echo "MONGODB_URI=$URI" >> "$ENV_FILE.tmp"; cat "$ENV_FILE.tmp" > "$ENV_FILE"; rm -f "$ENV_FILE.tmp"
  echo "==> MONGODB_URI written to $ENV_FILE"
fi
echo "==> Checking the app login works"
"$NODE" "$HERE/create-users.js" check "$URI" || { echo "The check failed. See: journalctl -u shule-mongod -n 50"; exit 1; }
echo "    Local-only on 127.0.0.1:$PORT. Credentials are in $CRED"
