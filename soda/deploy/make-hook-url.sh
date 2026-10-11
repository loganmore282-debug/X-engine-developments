#!/usr/bin/env bash
# Makes (once) a secret address for the PesaJet webhook, switches it on in nginx and prints the URL to paste into PesaJet's dashboard.
# Run as root:  bash /srv/soda-src/soda/deploy/make-hook-url.sh       (run it again any time: it keeps the same address)
#               bash /srv/soda-src/soda/deploy/make-hook-url.sh new   (make a NEW address; the old one stops working at once)
set -u
SODA=${SODA_DIR:-/srv/soda-src/soda}
HOOK_FILE=${SODA_HOOK_FILE:-/srv/soda-secrets/hook-token}
HOST=${SODA_APP_HOST:-app.p-colasoda.com}
[ "$(id -u)" = 0 ] || { echo "Run this as root."; exit 1; }
if [ "${1:-}" = new ] || [ ! -s "$HOOK_FILE" ]; then
  umask 077; head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n' > "$HOOK_FILE"; chmod 600 "$HOOK_FILE"; echo "Made a new secret address."
fi
bash "$SODA/deploy/update-vps.sh" > /tmp/soda.hook-update.log 2>&1
if grep -q "^DONE\." /tmp/soda.hook-update.log; then
  TOKEN=$(tr -d '[:space:]' < "$HOOK_FILE")
  echo; echo "Paste this into PesaJet as the webhook URL (keep it private; do not post it or screenshot it):"; echo
  echo "    https://$HOST/k7x2/h-$TOKEN/pesajet"; echo
  echo "The old public address (/k7x2/pesajet/webhook) is now closed."
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST -d '{}' "https://$HOST/k7x2/pesajet/webhook" || true); echo "check: the old address answers HTTP $code (expected 404)"
else
  echo "The update did not finish. Last lines:"; tail -12 /tmp/soda.hook-update.log
fi
