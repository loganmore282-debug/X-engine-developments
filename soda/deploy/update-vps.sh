#!/usr/bin/env bash
# ONE command that brings the VPS fully up to date after a push: pulls the code, installs packages, regenerates and tests the nginx file
# (puts the old file back by itself if the new one is refused), restores HTTPS, restarts Soda, applies the VPS hardening and checks the site.
# Safe to run again and again. Run as root:   bash /srv/soda-src/soda/deploy/update-vps.sh
set -u
say() { printf '\n==> %s\n' "$*"; }
[ "$(id -u)" = 0 ] || { echo "Run this as root."; exit 1; }
SRC=${SODA_SRC:-/srv/soda-src}
SODA=$SRC/soda
APP_HOST=${SODA_APP_HOST:-app.p-colasoda.com}
ADMIN_HOST=${SODA_ADMIN_HOST:-sv37ah.p-colasoda.com}
ADMIN_PATH=${SODA_ADMIN_PATH:-Panel7x9k}
CONF=${SODA_NGINX_CONF:-/etc/nginx/conf.d/soda.conf}
BAK=/root/soda.conf.bak

say "1/7  Latest code"
cd "$SRC" || { echo "Cannot find $SRC"; exit 1; }
git pull --ff-only 2>&1 | tail -2 || true
cd "$SODA" || exit 1
git log -1 --format='    now at: %h %s'

say "2/7  Packages"
npm install --omit=dev --no-audit --no-fund 2>&1 | tail -1

# The member app's host can be changed with deploy/change-app-host.sh: the new host is kept in a file (never in git) and the OLD host stays
# as an extra address of the same app, so installed apps, old links and webhooks keep working.
APP_HOST_FILE=${SODA_APP_HOST_FILE:-/srv/soda-secrets/app-host}
ALSO_FILE=${SODA_ALSO_HOSTS_FILE:-/srv/soda-secrets/also-hosts}
[ -s "$APP_HOST_FILE" ] && APP_HOST=$(tr -d '[:space:]' < "$APP_HOST_FILE")
ALSO_HOSTS=""; [ -s "$ALSO_FILE" ] && ALSO_HOSTS=$(tr -d '[:space:]' < "$ALSO_FILE")
echo "    member app host: $APP_HOST${ALSO_HOSTS:+   also answers on: $ALSO_HOSTS}"

# Secret PesaJet webhook address: the token lives only on this server (made by deploy/make-hook-url.sh), never in git.
HOOK_FILE=${SODA_HOOK_FILE:-/srv/soda-secrets/hook-token}
HOOK_HOST_FILE=${SODA_HOOK_HOST_FILE:-/srv/soda-secrets/hook-host}
if [ -s "$HOOK_FILE" ]; then SODA_HOOK_TOKEN=$(tr -d '[:space:]' < "$HOOK_FILE"); export SODA_HOOK_TOKEN; echo "    (secret PesaJet webhook address is ON)"; fi
if [ -s "$HOOK_FILE" ] && [ -s "$HOOK_HOST_FILE" ]; then SODA_HOOK_HOST=$(tr -d '[:space:]' < "$HOOK_HOST_FILE"); export SODA_HOOK_HOST; echo "    (webhook-only host: $SODA_HOOK_HOST)"; fi

say "3/7  nginx: new walls (the old file is kept at $BAK and put back if the new one is refused)"
[ -f "$CONF" ] && cp "$CONF" "$BAK"
if node deploy/make-nginx.js prod "$APP_HOST" "$ADMIN_PATH" "$ADMIN_HOST" ${ALSO_HOSTS:+--also="$ALSO_HOSTS"} > /tmp/soda.conf.new && cp /tmp/soda.conf.new "$CONF" && nginx -t >/tmp/soda.nginxtest 2>&1; then
  echo "    new nginx file accepted"
else
  echo "    !! nginx refused the new file: putting the old one back"
  [ -f "$BAK" ] && cp "$BAK" "$CONF"
  tail -3 /tmp/soda.nginxtest 2>/dev/null
  echo "    Nothing was changed on the live site. Send me the lines above."
  exit 1
fi

say "4/7  HTTPS (one certificate for every address; an address whose DNS does not point here yet is skipped, never allowed to break the others)"
MYIP=$(curl -4 -s --max-time 8 https://ifconfig.me || true)
CERT_ARGS=(); SKIPPED=""
for H in "$APP_HOST" "$ADMIN_HOST" ${ALSO_HOSTS//,/ } ${SODA_HOOK_HOST:-}; do
  [ -n "$H" ] || continue
  HIP=$(getent ahostsv4 "$H" 2>/dev/null | awk '{print $1; exit}')
  if [ -n "$MYIP" ] && [ "$HIP" = "$MYIP" ]; then CERT_ARGS+=(-d "$H"); else SKIPPED="$SKIPPED $H(${HIP:-no record})"; fi
done
if [ -n "$SKIPPED" ]; then
  echo "    !! not pointing to this server yet, so no certificate for:$SKIPPED   (this server is $MYIP)"
  echo "       Check the A record in Hostinger, wait a few minutes and run this again. The other addresses are not affected."
fi
if [ "${#CERT_ARGS[@]}" -gt 0 ]; then
  certbot --nginx --cert-name "${SODA_CERT_NAME:-app.p-colasoda.com}" --expand "${CERT_ARGS[@]}" --non-interactive --agree-tos --register-unsafely-without-email --redirect --reinstall 2>&1 | tail -3
fi
# HTTP/2 lets a phone fetch many files over ONE connection (a big gain on long-distance links). Added only if missing, and undone if nginx refuses it.
cp "$CONF" /tmp/soda.conf.pre-h2
sed -i -E '/^[[:space:]]*listen .*443 ssl/{/http2/!s/443 ssl/443 ssl http2/}' "$CONF"
if nginx -t >/dev/null 2>&1; then echo "    HTTP/2 on: $(grep -c 'ssl http2' "$CONF") listen line(s)"; else echo "    (HTTP/2 not accepted by this nginx, left as it was)"; cp /tmp/soda.conf.pre-h2 "$CONF"; fi
if nginx -t >/dev/null 2>&1; then systemctl reload nginx && echo "    nginx reloaded"; else echo "    !! nginx test failed after certbot, putting the old file back"; cp "$BAK" "$CONF"; nginx -t 2>&1 | tail -1; systemctl reload nginx; exit 1; fi

say "5/7  Restart Soda (secrets re-read)"
cd "$SODA/deploy" || exit 1
if pm2 describe soda-server >/dev/null 2>&1; then pm2 reload ecosystem.config.js --update-env 2>&1 | tail -3; else pm2 start ecosystem.config.js 2>&1 | tail -3; fi
pm2 save >/dev/null 2>&1 || true
sleep 4

say "6/7  Firewall, fail2ban, automatic updates"
bash "$SODA/deploy/harden-vps.sh"

say "7/7  Is the site healthy?"
code=$(curl -s -o /tmp/soda.health -w '%{http_code}' "https://$APP_HOST/k7x2/health" || true)
echo "    https://$APP_HOST/k7x2/health -> HTTP $code  $(head -c 120 /tmp/soda.health 2>/dev/null)"
code2=$(curl -s -o /dev/null -w '%{http_code}' -A 'sqlmap/1.7' "https://$APP_HOST/" || true)
echo "    a 'sqlmap' visitor gets HTTP $code2   (expected 403 or 444: the wall works)"
code3=$(curl -s -o /dev/null -w '%{http_code}' "https://$APP_HOST/.env" || true)
echo "    /.env gets HTTP $code3   (expected 403/404)"
echo; echo "DONE."
