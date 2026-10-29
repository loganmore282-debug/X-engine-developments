#!/usr/bin/env bash
# Moves the member app to a new address. The OLD address keeps answering as an extra address of the same app, so installed apps, old links and
# the GitHub / payment webhooks keep working while you switch over. Nothing is changed unless the new name already points at this server.
# Run as root:  bash /srv/chocolate-src/chocolate/deploy/change-app-host.sh app        (app -> app.chocolate.example.com; a full host name also works)
#               bash /srv/chocolate-src/chocolate/deploy/change-app-host.sh drop-old    (later: stop answering on the old address)
set -u
CHOCOLATE=${CHOCOLATE_DIR:-/srv/chocolate-src/chocolate}
BASE=${CHOCOLATE_BASE_DOMAIN:-chocolate.example.com}
APP_HOST_FILE=${CHOCOLATE_APP_HOST_FILE:-/srv/chocolate-secrets/app-host}
ALSO_FILE=${CHOCOLATE_ALSO_HOSTS_FILE:-/srv/chocolate-secrets/also-hosts}
[ "$(id -u)" = 0 ] || { echo "Run this as root."; exit 1; }
ARG=${1:-}
[ -n "$ARG" ] || { echo "Say the new name, e.g.:  bash $0 app"; exit 1; }
CUR=${CHOCOLATE_APP_HOST:-app.chocolate.example.com}; [ -s "$APP_HOST_FILE" ] && CUR=$(tr -d '[:space:]' < "$APP_HOST_FILE")

if [ "$ARG" = drop-old ]; then
  OLD=""; [ -s "$ALSO_FILE" ] && OLD=$(tr -d '[:space:]' < "$ALSO_FILE")
  cp "$ALSO_FILE" /tmp/chocolate.also.bak 2>/dev/null
  rm -f "$ALSO_FILE"; echo "The old address ($OLD) is dropped from nginx and from the certificate. Updating..."
  if bash "$CHOCOLATE/deploy/update-vps.sh" > /tmp/chocolate.host-update.log 2>&1 && grep -q "^DONE\." /tmp/chocolate.host-update.log; then
    grep -E "removing no-longer-served|certificate now covers" /tmp/chocolate.host-update.log
    echo "Done: only $CUR answers now."
    echo; echo "Before you delete the old address's DNS record in Hostinger, check BOTH:"
    echo "  1. the line 'certificate now covers' above no longer lists the old address (otherwise the certificate could not renew later);"
    echo "  2. the GitHub webhook points at https://$CUR/k7x2/deploy/webhook (the old address used to receive it; auto-deploy stops silently if it still points there)."
  else
    echo "Update did not finish. Putting the old address back:"; [ -f /tmp/chocolate.also.bak ] && cp /tmp/chocolate.also.bak "$ALSO_FILE"; tail -12 /tmp/chocolate.host-update.log
  fi
  exit 0
fi

case "$ARG" in *.*) NEW=$ARG ;; *) printf '%s' "$ARG" | grep -Eq '^[a-z0-9][a-z0-9-]{1,40}$' || { echo "Not understood: $ARG"; exit 1; }; NEW="$ARG.$BASE" ;; esac
[ "$NEW" != "$CUR" ] || { echo "The app already uses $NEW."; exit 0; }

MYIP=$(curl -4 -s --max-time 8 https://ifconfig.me || true); NEWIP=$(getent ahostsv4 "$NEW" 2>/dev/null | awk '{print $1; exit}')
if [ -z "$MYIP" ] || [ "$NEWIP" != "$MYIP" ]; then
  echo "!! $NEW does not point to this server yet (it points to '${NEWIP:-nothing}', this server is '$MYIP')."
  echo "   In Hostinger DNS add an A record: Name = ${NEW%%.*}   Points to = $MYIP   then wait a few minutes and run this again."
  echo "   NOTHING was changed."; exit 1
fi

echo "Moving the app from $CUR to $NEW (the old address stays as an extra address)..."
umask 077
printf '%s' "$NEW" > "$APP_HOST_FILE"; chmod 600 "$APP_HOST_FILE"
OLDLIST=""; [ -s "$ALSO_FILE" ] && OLDLIST=$(tr -d '[:space:]' < "$ALSO_FILE")
LIST=$(printf '%s\n' ${OLDLIST//,/ } "$CUR" | grep -v "^$NEW\$" | sort -u | paste -sd, -)
printf '%s' "$LIST" > "$ALSO_FILE"; chmod 600 "$ALSO_FILE"

if bash "$CHOCOLATE/deploy/update-vps.sh" > /tmp/chocolate.host-update.log 2>&1 && grep -q "^DONE\." /tmp/chocolate.host-update.log; then
  grep -E "not pointing|Check the A record" /tmp/chocolate.host-update.log
  # callbacks the server sends to payment gateways follow the new address
  CHOCOLATE_SECRET_VALUE="https://$NEW/k7x2" node "$CHOCOLATE/deploy/set-secret.js" PUBLIC_URL
  (cd "$CHOCOLATE/deploy" && pm2 reload ecosystem.config.js --update-env 2>&1 | tail -1); sleep 4
  h1=$(curl -s -m 10 "https://$NEW/k7x2/health" || true); h2=$(curl -s -m 10 -o /dev/null -w '%{http_code}' "https://$CUR/k7x2/health" || true)
  echo; echo "NEW address  https://$NEW/   health: $h1"
  echo "OLD address  https://$CUR/   health HTTP $h2 (still works on purpose)"
  echo; echo "What changes for members: they open $NEW. Logins are kept per address, so they sign in once on the new address;"
  echo "an app already installed from the old address keeps working. Referral links follow whichever address was opened."
  echo "Later, when everyone has moved:  bash $0 drop-old"
else
  echo "The update did not finish. Putting the old setting back."
  printf '%s' "$CUR" > "$APP_HOST_FILE"; printf '%s' "$OLDLIST" > "$ALSO_FILE"; [ -s "$ALSO_FILE" ] || rm -f "$ALSO_FILE"
  tail -12 /tmp/chocolate.host-update.log
fi
