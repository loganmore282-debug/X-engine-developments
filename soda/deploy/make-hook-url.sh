#!/usr/bin/env bash
# Makes (once) a secret address for the PesaJet webhook, switches it on in nginx and prints the URL to paste into PesaJet's dashboard.
# Run as root:  bash /srv/soda-src/soda/deploy/make-hook-url.sh                 (secret path on app.p-colasoda.com)
#               bash /srv/soda-src/soda/deploy/make-hook-url.sh q7m2x           (a webhook-only host q7m2x.p-colasoda.com: its A record must exist first)
#               bash /srv/soda-src/soda/deploy/make-hook-url.sh new             (a NEW secret path; the old one stops working at once)
# Running it again keeps the same address.
set -u
SODA=${SODA_DIR:-/srv/soda-src/soda}
HOOK_FILE=${SODA_HOOK_FILE:-/srv/soda-secrets/hook-token}
HOOK_HOST_FILE=${SODA_HOOK_HOST_FILE:-/srv/soda-secrets/hook-host}
BASE=${SODA_BASE_DOMAIN:-p-colasoda.com}
HOST=${SODA_APP_HOST:-app.p-colasoda.com}
[ -s "${SODA_APP_HOST_FILE:-/srv/soda-secrets/app-host}" ] && HOST=$(tr -d "[:space:]" < "${SODA_APP_HOST_FILE:-/srv/soda-secrets/app-host}")
[ "$(id -u)" = 0 ] || { echo "Run this as root."; exit 1; }
NEWTOKEN=0
for a in "$@"; do
  case "$a" in
    new) NEWTOKEN=1 ;;
    off) rm -f "$HOOK_HOST_FILE"; echo "Webhook-only host switched off (the secret path on $HOST is used again)." ;;
    *.*) umask 077; printf '%s' "$a" > "$HOOK_HOST_FILE"; chmod 600 "$HOOK_HOST_FILE" ;;
    *) if printf '%s' "$a" | grep -Eq '^[a-z0-9][a-z0-9-]{1,40}$'; then umask 077; printf '%s.%s' "$a" "$BASE" > "$HOOK_HOST_FILE"; chmod 600 "$HOOK_HOST_FILE"; else echo "Not understood: $a"; exit 1; fi ;;
  esac
done
if [ "$NEWTOKEN" = 1 ] || [ ! -s "$HOOK_FILE" ]; then
  umask 077; head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n' > "$HOOK_FILE"; chmod 600 "$HOOK_FILE"; echo "Made a new secret address."
fi
bash "$SODA/deploy/update-vps.sh" > /tmp/soda.hook-update.log 2>&1
if grep -q "^DONE\." /tmp/soda.hook-update.log; then
  TOKEN=$(tr -d '[:space:]' < "$HOOK_FILE")
  grep -E "does not point|Check the A record" /tmp/soda.hook-update.log
  if [ -s "$HOOK_HOST_FILE" ]; then
    HH=$(tr -d '[:space:]' < "$HOOK_HOST_FILE"); URL="https://$HH/h-$TOKEN/pesajet"
    c1=$(curl -s -o /dev/null -w '%{http_code}' "https://$HH/" || true); echo "check: https://$HH/ answers HTTP $c1 (expected 404: it shows nothing)"
  else URL="https://$HOST/k7x2/h-$TOKEN/pesajet"; fi
  echo; echo "Paste this into PesaJet as the webhook URL (keep it private; do not post it or screenshot it):"; echo
  echo "    $URL"; echo
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST -d '{}' "https://$HOST/k7x2/pesajet/webhook" || true); echo "check: the old public address answers HTTP $code (expected 404)"
else
  echo "The update did not finish. Last lines:"; tail -12 /tmp/soda.hook-update.log
fi
