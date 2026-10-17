#!/usr/bin/env bash
# ONE-TIME setup of Mint's backend on the VPS, next to Soda. It never touches Soda: Mint has its own folder (/srv/mint-src), its own
# secrets (/srv/mint-secrets), its own process (pm2 "mint-server") and its own port (3002, loopback only, so nothing outside can reach it).
# It asks for the MongoDB connection string with hidden typing, CHECKS that it really connects, saves it, starts the server and tests /health.
# Run as root, from the fresh clone (see the one command in mint/CLAUDE.md "Hosting"):   bash /srv/mint-src/mint/deploy/first-setup.sh
set -u
say() { printf '\n==> %s\n' "$*"; }
[ "$(id -u)" = 0 ] || { echo "Run this as root."; exit 1; }
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MINT=${MINT_DIR:-$(dirname "$HERE")}
SECRETS_DIR=${MINT_SECRETS_DIR:-/srv/mint-secrets}
FILE=${MINT_SECRETS_FILE:-$SECRETS_DIR/secrets.local.js}
PORT_WANTED=${MINT_PORT:-3002}
export MINT_SECRETS_FILE="$FILE"
command -v node >/dev/null || { echo "Node is not installed."; exit 1; }
command -v pm2  >/dev/null || { echo "pm2 is not installed (it is, if Soda runs here)."; exit 1; }

say "1/6  Packages"
cd "$MINT" || exit 1
npm install --omit=dev --no-audit --no-fund 2>&1 | tail -1

say "2/6  Secrets folder (root only, outside git)"
mkdir -p "$SECRETS_DIR"; chmod 700 "$SECRETS_DIR"
[ -f "$FILE" ] || (umask 077; : > "$FILE")
chmod 600 "$FILE"
has() { grep -q "^module\.exports\.$1 *=" "$FILE"; }
put() { MINT_SECRET_VALUE="$2" node "$MINT/deploy/set-secret.js" "$1" >/dev/null || { echo "Could not save $1"; exit 1; }; }

say "3/6  MongoDB connection string"
if has MONGODB_URI; then
  echo "    already saved (keeping it). To replace it:  bash $MINT/deploy/set-secret.sh MONGODB_URI"
else
  echo "    Paste the connection string from Atlas (Connect -> Drivers). It must contain your database user's password and end with /mint before the ?"
  echo "    Example shape:  mongodb+srv://mintapp:PASSWORD@cluster0.xxxxx.mongodb.net/mint?retryWrites=true&w=majority"
  while :; do
    read -r -s -p "    Paste it here (nothing is shown), then press Enter: " URI; echo
    URI=$(printf '%s' "$URI" | tr -d '[:space:]')
    case "$URI" in mongodb://*|mongodb+srv://*) ;; *) echo "    That does not start with mongodb+srv:// or mongodb://. Try again."; continue ;; esac
    DBN=$(printf '%s' "$URI" | sed -E 's#^[^/]+//[^/]+/([^?]*).*#\1#')
    [ "$DBN" = mint ] || { echo "    The database name in it is '${DBN:-(none)}', it must be exactly: mint   (…mongodb.net/mint?retryWrites…). Try again."; continue; }
    echo "    Testing the connection (up to 20 seconds)..."
    if MINT_TEST_URI="$URI" node -e '
      const { MongoClient } = require("mongodb");
      const c = new MongoClient(process.env.MINT_TEST_URI, { serverSelectionTimeoutMS: 20000 });
      c.connect().then(() => c.db("mint").command({ ping: 1 })).then(() => c.close()).then(() => process.exit(0))
        .catch(e => { console.error("    Could not connect: " + e.message.split("\n")[0]); process.exit(1); });' ; then
      echo "    Connected."; put MONGODB_URI "$URI"; break
    else
      echo "    Check: the password (special characters such as @ : / must be written as %40 %3A %2F), the user has readWrite on database mint,"
      echo "    and Atlas > Network Access allows this server's IP address. Try again (Ctrl+C to stop)."
    fi
  done
fi

say "4/6  Admin password and the other settings"
if has ADMIN_KEY; then echo "    admin password already saved"; else
  while :; do
    read -r -s -p "    Choose the Mint admin password (at least 16 characters, nothing is shown): " AK; echo
    [ "${#AK}" -ge 16 ] && break || echo "    Too short."
  done
  put ADMIN_KEY "$AK"; unset AK
fi
has PORT || put PORT "$PORT_WANTED"
if has DEPLOY_WEBHOOK_SECRET; then :; else put DEPLOY_WEBHOOK_SECRET "$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"; fi

say "5/6  Start Mint (pm2 name: mint-server) -- Soda is not touched"
cd "$MINT/deploy" || exit 1
if pm2 describe mint-server >/dev/null 2>&1; then pm2 reload ecosystem.config.js --only mint-server --update-env 2>&1 | tail -2
else pm2 start ecosystem.config.js --only mint-server 2>&1 | tail -3; fi
pm2 save >/dev/null 2>&1

say "6/6  Health check"
OK=""
for i in 1 2 3 4 5 6 7 8 9 10; do
  H=$(curl -s -m 5 "http://127.0.0.1:$PORT_WANTED/health" || true)
  case "$H" in *'"ok":true'*) OK=1; break ;; esac
  sleep 2
done
echo "    /health -> ${H:-(no answer)}"
if [ -n "$OK" ]; then
  echo; echo "DONE. Mint's backend is running (port $PORT_WANTED, local only) and connected to MongoDB database 'mint'."
  echo "Check the log any time:  pm2 logs mint-server --lines 40 --nostream     (look for: MongoDB connected (mint))"
else
  echo; echo "NOT healthy yet. Send me the output of:  pm2 logs mint-server --lines 40 --nostream"
fi
