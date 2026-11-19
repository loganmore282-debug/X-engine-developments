#!/usr/bin/env bash
# Installs MongoDB 8.0 on the Contabo VPS (Ubuntu 22.04 or 24.04), locks it
# down, creates the database user the app needs, and puts the connection
# string into /etc/shule-notes/.env.
#
#   sudo ./setup-mongodb.sh
#
# Run deploy/setup.sh first (it creates /etc/shule-notes/.env). Safe to run
# again: it will not create the users twice or change their passwords.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Run this as root (sudo)."; exit 1; }

HERE="$(cd "$(dirname "$0")" && pwd)"
DB=shule_notes
APP_USER=shule_app
CRED=/root/shule-mongodb-credentials.txt
ENV_FILE=/etc/shule-notes/.env

. /etc/os-release
case "$VERSION_CODENAME" in
  jammy|noble) ;;
  *) echo "This script supports Ubuntu 22.04 (jammy) and 24.04 (noble); this is $VERSION_CODENAME."; exit 1 ;;
esac

echo "==> Installing MongoDB 8.0"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl gnupg ca-certificates openssl
if [ ! -f /usr/share/keyrings/mongodb-server-8.0.gpg ]; then
  curl -fsSL https://www.mongodb.org/static/pgp/server-8.0.asc | gpg --dearmor -o /usr/share/keyrings/mongodb-server-8.0.gpg
fi
echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-8.0.gpg ] https://repo.mongodb.org/apt/ubuntu $VERSION_CODENAME/mongodb-org/8.0 multiverse" \
  > /etc/apt/sources.list.d/mongodb-org-8.0.list
apt-get update -y
apt-get install -y mongodb-org

if [ ! -f "$CRED" ]; then
  echo "==> Creating the database users (MongoDB is local-only and has no login yet, for these few seconds)"
  # Start from a plain local-only config with no login, create the users, then lock it.
  sed 's/authorization: enabled/authorization: disabled/' "$HERE/mongod.conf" > /etc/mongod.conf
  systemctl enable mongod >/dev/null
  systemctl restart mongod
  for i in $(seq 1 30); do mongosh --quiet --eval 'db.runCommand({ping:1}).ok' >/dev/null 2>&1 && break; sleep 1; done

  ROOT_PASS="$(openssl rand -hex 20)"
  APP_PASS="$(openssl rand -hex 20)"
  # Passwords are hex, so they are safe to put in a connection string as they are.
  mongosh --quiet --eval "
    const admin = db.getSiblingDB('admin');
    admin.createUser({ user: 'shule_root', pwd: '$ROOT_PASS', roles: [{ role: 'root', db: 'admin' }] });
    const app = db.getSiblingDB('$DB');
    app.createUser({ user: '$APP_USER', pwd: '$APP_PASS', roles: [{ role: 'readWrite', db: '$DB' }] });
  "
  umask 077
  cat > "$CRED" <<CREDS
Shule Notes MongoDB credentials (keep this file private)

App connection string (already put into $ENV_FILE):
  mongodb://$APP_USER:$APP_PASS@127.0.0.1:27017/$DB?authSource=$DB

Maintenance login (full control, for you only):
  mongosh "mongodb://shule_root:$ROOT_PASS@127.0.0.1:27017/admin"
CREDS
else
  echo "==> Users already exist ($CRED), leaving them as they are"
fi

echo "==> Locking MongoDB down (local only, login required)"
install -m 644 "$HERE/mongod.conf" /etc/mongod.conf
systemctl restart mongod
for i in $(seq 1 30); do systemctl is-active --quiet mongod && break; sleep 1; done

URI="$(grep -m1 -A0 '^  mongodb://' "$CRED" | sed 's/^  //')"
if [ -f "$ENV_FILE" ]; then
  # Rewrite the line without sed, because the "&" in a connection string means something to it.
  grep -v '^MONGODB_URI=' "$ENV_FILE" > "$ENV_FILE.tmp" || true
  echo "MONGODB_URI=$URI" >> "$ENV_FILE.tmp"
  cat "$ENV_FILE.tmp" > "$ENV_FILE" && rm -f "$ENV_FILE.tmp"
  echo "==> MONGODB_URI written to $ENV_FILE"
else
  echo "==> $ENV_FILE does not exist yet. Run deploy/setup.sh, then put this line in it:"
  echo "    MONGODB_URI=$URI"
fi

echo "==> Checking the login works"
if mongosh --quiet "$URI" --eval "db.runCommand({ping:1}).ok" | grep -q 1; then
  echo "    OK: the app user can log in to $DB"
else
  echo "    The check failed. Look at: journalctl -u mongod -n 50"; exit 1
fi
echo "    Not reachable from outside: MongoDB listens on 127.0.0.1 only."
echo "    Credentials are saved in $CRED"
