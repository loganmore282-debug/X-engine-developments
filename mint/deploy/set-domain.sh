#!/usr/bin/env bash
# Puts a bought domain on Mint: nginx, the HTTPS certificate and the payment callback address, in one command.
#   bash /srv/mint-src/mint/deploy/set-domain.sh yourdomain.com
# The member app goes on  app.yourdomain.com  and the hidden admin panel on a random-looking address (shown at the end).
# FIRST add two DNS "A" records at the place the domain is managed, both pointing to this server (the command prints them, and changes
# NOTHING until they exist):   app   and   the admin label it shows.      Nothing here touches Soda or Cookie.
set -u
[ "$(id -u)" = 0 ] || { echo "Run this as root."; exit 1; }
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MINT=${MINT_DIR:-$(dirname "$HERE")}
APP_HOST_FILE=${MINT_APP_HOST_FILE:-/srv/mint-secrets/app-host}
ADMIN_HOST_FILE=${MINT_ADMIN_HOST_FILE:-/srv/mint-secrets/admin-host}
RAW=${1:-}
[ -n "$RAW" ] || { echo "Say the domain you bought, e.g.:  bash $0 yourdomain.com"; exit 1; }
DOM=$(printf '%s' "$RAW" | tr 'A-Z' 'a-z' | sed -E 's#^https?://##; s#/.*$##; s#^www\.##')
printf '%s' "$DOM" | grep -Eq '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' || { echo "Not understood: $RAW   (write it like  yourdomain.com)"; exit 1; }
LABEL=${2:-app}
printf '%s' "$LABEL" | grep -Eq '^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$' || { echo "The first word must be letters/digits, e.g.  app"; exit 1; }
APP="$LABEL.$DOM"
CURADMIN=""; [ -s "$ADMIN_HOST_FILE" ] && CURADMIN=$(tr -d '[:space:]' < "$ADMIN_HOST_FILE")
case "$CURADMIN" in *".$DOM") ADMIN=$CURADMIN ;; *) ADMIN="$(head -c 4 /dev/urandom | od -An -tx1 | tr -d ' \n' | cut -c1-6).$DOM" ;; esac
# The admin address is chosen once and remembered, so the DNS record you add is the one the next run expects.
if [ "$ADMIN" != "$CURADMIN" ]; then mkdir -p "$(dirname "$ADMIN_HOST_FILE")"; (umask 077; printf '%s' "$ADMIN" > "$ADMIN_HOST_FILE"); fi
ADMIN_PATH=$(sed -n 's/^ADMIN_PATH=\${MINT_ADMIN_PATH:-\([A-Za-z0-9]*\)}.*/\1/p' "$MINT/deploy/update-vps.sh" | head -1)

MYIP=$(curl -4 -s --max-time 8 https://ifconfig.me || true)
[ -n "$MYIP" ] || MYIP=$(curl -4 -s --max-time 8 https://icanhazip.com | tr -d '[:space:]' || true)
echo "This server's address: ${MYIP:-unknown}"
echo; echo "DNS records needed at your domain's DNS page (type A, pointing to ${MYIP:-this server}):"
echo "    Name: ${APP%%.$DOM}        (that is $APP)"
echo "    Name: ${ADMIN%%.$DOM}      (that is $ADMIN, the hidden admin address)"
echo "    No record is needed for the bare domain or www."
MISSING=""
for H in "$APP" "$ADMIN"; do
  HIP=$(getent ahostsv4 "$H" 2>/dev/null | awk '{print $1; exit}')
  if [ -z "$MYIP" ] || [ "$HIP" != "$MYIP" ]; then MISSING="$MISSING $H(${HIP:-no record})"; fi
done
if [ -n "$MISSING" ]; then
  echo; echo "!! Not pointing to this server yet:$MISSING"
  echo "   Add the records above, wait 5-15 minutes, then run this same command again. NOTHING was changed."
  exit 1
fi
[ "${MINT_SET_DOMAIN_DRY:-}" = 1 ] && { echo; echo "(dry run: DNS is fine, stopping here)"; exit 0; }

PREV_APP=""; [ -s "$APP_HOST_FILE" ] && PREV_APP=$(tr -d '[:space:]' < "$APP_HOST_FILE")
mkdir -p "$(dirname "$APP_HOST_FILE")"
(umask 077; printf '%s' "$APP" > "$APP_HOST_FILE")
echo; echo "Setting up nginx and HTTPS for $APP and $ADMIN ..."
if bash "$MINT/deploy/update-vps.sh" > /tmp/mint.domain-update.log 2>&1 && grep -q "^DONE\." /tmp/mint.domain-update.log; then
  MINT_SECRET_VALUE="https://$APP/k7x2" node "$MINT/deploy/set-secret.js" PUBLIC_URL >/dev/null
  (cd "$MINT/deploy" && pm2 reload ecosystem.config.js --only mint-server --update-env 2>&1 | tail -1)
  sleep 4
  echo; echo "DONE."
  echo "  Member app : https://$APP/"
  echo "  Admin panel: https://$ADMIN/$ADMIN_PATH/      (keep this address private)"
  echo "  Health     : $(curl -s -m 10 "https://$APP/k7x2/health")"
  echo; echo "Still to do once: GitHub -> repo Settings -> Webhooks -> Add webhook"
  echo "  Payload URL: https://$APP/k7x2/deploy/webhook    Content type: application/json"
  echo "  Secret: the value of DEPLOY_WEBHOOK_SECRET, shown by:  grep DEPLOY_WEBHOOK_SECRET /srv/mint-secrets/secrets.local.js"
  echo "  (this makes every push to branch claude/mint-build update Mint by itself)"
else
  echo "The update did not finish. Putting the old setting back."
  if [ -n "$PREV_APP" ]; then (umask 077; printf '%s' "$PREV_APP" > "$APP_HOST_FILE"); else rm -f "$APP_HOST_FILE"; fi
  tail -15 /tmp/mint.domain-update.log
fi
