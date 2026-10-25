#!/usr/bin/env bash
# Puts a bought domain on Potato: nginx, the HTTPS certificate and the payment callback address, in one command.
#   bash /srv/potato-src/potato/deploy/set-domain.sh yourdomain.com
# The member app goes on  app.yourdomain.com  and the hidden admin panel on a random-looking address (shown at the end).
# FIRST add two DNS "A" records at the place the domain is managed, both pointing to this server (the command prints them, and changes
# NOTHING until they exist):   app   and   the admin label it shows.      Nothing here touches Soda or Cookie.
set -u
[ "$(id -u)" = 0 ] || { echo "Run this as root."; exit 1; }
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
POTATO=${POTATO_DIR:-$(dirname "$HERE")}
APP_HOST_FILE=${POTATO_APP_HOST_FILE:-/srv/potato-secrets/app-host}
ADMIN_HOST_FILE=${POTATO_ADMIN_HOST_FILE:-/srv/potato-secrets/admin-host}
RAW=${1:-}
if [ -z "$RAW" ]; then
  # No domain on the command line: ask for it. A run that already chose the hidden admin address remembers the domain, so the second run only needs Enter.
  SAVED=""; [ -s "$ADMIN_HOST_FILE" ] && SAVED=$(tr -d '[:space:]' < "$ADMIN_HOST_FILE" | sed -E 's/^[^.]+\.//')
  if [ -n "$SAVED" ]; then printf 'Your domain [%s] (press Enter to keep it): ' "$SAVED"; else printf 'Type the domain you bought (like yourdomain.com): '; fi
  read -r RAW || RAW=""
  [ -n "$RAW" ] || RAW=$SAVED
  [ -n "$RAW" ] || { echo "No domain entered. NOTHING was changed."; exit 1; }
fi
DOM=$(printf '%s' "$RAW" | tr 'A-Z' 'a-z' | sed -E 's#^https?://##; s#/.*$##; s#^www\.##')
printf '%s' "$DOM" | grep -Eq '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' || { echo "Not understood: $RAW   (write it like  yourdomain.com)"; exit 1; }
LABEL=${2:-app}
printf '%s' "$LABEL" | grep -Eq '^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$' || { echo "The first word must be letters/digits, e.g.  app"; exit 1; }
APP="$LABEL.$DOM"
CURADMIN=""; [ -s "$ADMIN_HOST_FILE" ] && CURADMIN=$(tr -d '[:space:]' < "$ADMIN_HOST_FILE")
case "$CURADMIN" in *".$DOM") ADMIN=$CURADMIN ;; *) ADMIN="${POTATO_ADMIN_LABEL:-$(head -c 4 /dev/urandom | od -An -tx1 | tr -d ' \n' | cut -c1-6)}.$DOM" ;; esac
# The admin address is chosen once and remembered, so the DNS record you add is the one the next run expects.
if [ "$ADMIN" != "$CURADMIN" ]; then mkdir -p "$(dirname "$ADMIN_HOST_FILE")"; (umask 077; printf '%s' "$ADMIN" > "$ADMIN_HOST_FILE"); fi
ADMIN_PATH=$(sed -n 's/^ADMIN_PATH=\${POTATO_ADMIN_PATH:-\([A-Za-z0-9]*\)}.*/\1/p' "$POTATO/deploy/update-vps.sh" | head -1)

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
[ "${POTATO_SET_DOMAIN_DRY:-}" = 1 ] && { echo; echo "(dry run: DNS is fine, stopping here)"; exit 0; }

PREV_APP=""; [ -s "$APP_HOST_FILE" ] && PREV_APP=$(tr -d '[:space:]' < "$APP_HOST_FILE")
mkdir -p "$(dirname "$APP_HOST_FILE")"
(umask 077; printf '%s' "$APP" > "$APP_HOST_FILE")
echo; echo "Setting up nginx and HTTPS for $APP and $ADMIN ..."
if bash "$POTATO/deploy/update-vps.sh" > /tmp/potato.domain-update.log 2>&1 && grep -q "^DONE\." /tmp/potato.domain-update.log; then
  POTATO_SECRET_VALUE="https://$APP/k7x2" node "$POTATO/deploy/set-secret.js" PUBLIC_URL >/dev/null
  (cd "$POTATO/deploy" && pm2 reload ecosystem.config.js --only potato-server --update-env 2>&1 | tail -1)
  sleep 4
  echo; echo "DONE."
  echo "  Member app : https://$APP/"
  echo "  Admin panel: https://$ADMIN/$ADMIN_PATH/      (keep this address private)"
  echo "  Health     : $(curl -s -m 10 "https://$APP/k7x2/health")"
  echo; echo "Still to do once: GitHub -> repo Settings -> Webhooks -> Add webhook"
  echo "  Payload URL: https://$APP/k7x2/deploy/webhook    Content type: application/json"
  echo "  Secret: the value of DEPLOY_WEBHOOK_SECRET, shown by:  grep DEPLOY_WEBHOOK_SECRET /srv/potato-secrets/secrets.local.js"
  echo "  (this makes every push to branch claude/potato-build update Potato by itself)"
else
  echo "The update did not finish. Putting the old setting back."
  if [ -n "$PREV_APP" ]; then (umask 077; printf '%s' "$PREV_APP" > "$APP_HOST_FILE"); else rm -f "$APP_HOST_FILE"; fi
  tail -15 /tmp/potato.domain-update.log
fi
