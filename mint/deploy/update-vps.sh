#!/usr/bin/env bash
# ONE command that brings the VPS fully up to date after a push: pulls the code, installs packages, regenerates and tests the nginx file
# (puts the old file back by itself if the new one is refused), restores HTTPS, restarts Mint, applies the VPS hardening and checks the site.
# Safe to run again and again. Run as root:   bash /srv/mint-src/mint/deploy/update-vps.sh
set -u
# Files written by the git pull below must stay readable by nginx (www-data); a caller's umask 077 (set-secret / change-app-host) would make them 0600 and the site 403.
umask 022
say() { printf '\n==> %s\n' "$*"; }
[ "$(id -u)" = 0 ] || { echo "Run this as root."; exit 1; }
SRC=${MINT_SRC:-/srv/mint-src}
MINT=$SRC/mint
APP_HOST=${MINT_APP_HOST:-app.mint.example.com}
ADMIN_HOST=${MINT_ADMIN_HOST:-admin.mint.example.com}
ADMIN_PATH=${MINT_ADMIN_PATH:-Desk4mx9}
CONF=${MINT_NGINX_CONF:-/etc/nginx/conf.d/mint.conf}
BAK=/root/mint.conf.bak

say "1/7  Latest code"
cd "$SRC" || { echo "Cannot find $SRC"; exit 1; }
git pull --ff-only 2>&1 | tail -2 || true
cd "$MINT" || exit 1
git log -1 --format='    now at: %h %s'

say "2/7  Packages"
npm install --omit=dev --no-audit --no-fund 2>&1 | tail -1

# The member app's host can be changed with deploy/change-app-host.sh: the new host is kept in a file (never in git) and the OLD host stays
# as an extra address of the same app, so installed apps, old links and webhooks keep working.
APP_HOST_FILE=${MINT_APP_HOST_FILE:-/srv/mint-secrets/app-host}
ALSO_FILE=${MINT_ALSO_HOSTS_FILE:-/srv/mint-secrets/also-hosts}
[ -s "$APP_HOST_FILE" ] && APP_HOST=$(tr -d '[:space:]' < "$APP_HOST_FILE")
ADMIN_HOST_FILE=${MINT_ADMIN_HOST_FILE:-/srv/mint-secrets/admin-host}
[ -s "$ADMIN_HOST_FILE" ] && ADMIN_HOST=$(tr -d '[:space:]' < "$ADMIN_HOST_FILE")
# No real domain yet (the built-in names are placeholders): stop here, changing nothing.
case "$APP_HOST" in *.example.com|"") echo; echo "    No domain is set yet. After you buy one and add its DNS records, run:"; echo "      bash $MINT/deploy/set-domain.sh yourdomain.com"; exit 1 ;; esac
ALSO_HOSTS=""; [ -s "$ALSO_FILE" ] && ALSO_HOSTS=$(tr -d '[:space:]' < "$ALSO_FILE")
echo "    member app host: $APP_HOST${ALSO_HOSTS:+   also answers on: $ALSO_HOSTS}"

# Secret PesaJet webhook address: the token lives only on this server (made by deploy/make-hook-url.sh), never in git.
HOOK_FILE=${MINT_HOOK_FILE:-/srv/mint-secrets/hook-token}
HOOK_HOST_FILE=${MINT_HOOK_HOST_FILE:-/srv/mint-secrets/hook-host}
if [ -s "$HOOK_FILE" ]; then MINT_HOOK_TOKEN=$(tr -d '[:space:]' < "$HOOK_FILE"); export MINT_HOOK_TOKEN; echo "    (secret PesaJet webhook address is ON)"; fi
if [ -s "$HOOK_FILE" ] && [ -s "$HOOK_HOST_FILE" ]; then MINT_HOOK_HOST=$(tr -d '[:space:]' < "$HOOK_HOST_FILE"); export MINT_HOOK_HOST; echo "    (webhook-only host: $MINT_HOOK_HOST)"; fi

say "3/7  nginx: new walls (the old file is kept at $BAK and put back if the new one is refused)"
[ -f "$CONF" ] && cp "$CONF" "$BAK"
if (umask 077; node deploy/make-nginx.js prod "$APP_HOST" "$ADMIN_PATH" "$ADMIN_HOST" ${ALSO_HOSTS:+--also="$ALSO_HOSTS"} > /tmp/mint.conf.new) && cp /tmp/mint.conf.new "$CONF" && nginx -t >/tmp/mint.nginxtest 2>&1; then
  echo "    new nginx file accepted"
else
  echo "    !! nginx refused the new file: putting the old one back"
  [ -f "$BAK" ] && cp "$BAK" "$CONF"
  tail -3 /tmp/mint.nginxtest 2>/dev/null
  echo "    Nothing was changed on the live site. Send me the lines above."
  exit 1
fi

say "4/7  HTTPS (one certificate for every address; an address whose DNS does not point here yet is skipped, never allowed to break the others)"
MYIP=$(curl -4 -s --max-time 8 https://ifconfig.me || true)
[ -n "$MYIP" ] || MYIP=$(curl -4 -s --max-time 8 https://icanhazip.com | tr -d '[:space:]' || true)
[ -n "$MYIP" ] || MYIP=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src") print $(i+1)}' | head -1)
CERT_ARGS=(); SKIPPED=""
for H in "$APP_HOST" "$ADMIN_HOST" ${ALSO_HOSTS//,/ } ${MINT_HOOK_HOST:-}; do
  [ -n "$H" ] || continue
  HIP=$(getent ahostsv4 "$H" 2>/dev/null | awk '{print $1; exit}')
  if [ -n "$MYIP" ] && [ "$HIP" = "$MYIP" ]; then CERT_ARGS+=(-d "$H"); else SKIPPED="$SKIPPED $H(${HIP:-no record})"; fi
done
if [ -n "$SKIPPED" ]; then
  echo "    !! not pointing to this server yet, so no certificate for:$SKIPPED   (this server is $MYIP)"
  echo "       Check the A record in Hostinger, wait a few minutes and run this again. The other addresses are not affected."
fi
if [ "${#CERT_ARGS[@]}" -gt 0 ]; then
  certbot --nginx --cert-name "${MINT_CERT_NAME:-$APP_HOST}" --expand "${CERT_ARGS[@]}" --non-interactive --agree-tos --register-unsafely-without-email --redirect --reinstall 2>&1 | tail -3
fi
# An address that was dropped (deploy/change-app-host.sh drop-old) must also leave the certificate, or the certificate could not be renewed once its
# DNS record is deleted. Names the certificate has but we no longer serve are removed by re-issuing it for exactly the wanted names.
CERT_NAME=${MINT_CERT_NAME:-$APP_HOST}
HAVE=$(certbot certificates --cert-name "$CERT_NAME" 2>/dev/null | sed -n 's/^ *Domains: //p' | head -1)
WANT=" $APP_HOST $ADMIN_HOST ${ALSO_HOSTS//,/ } ${MINT_HOOK_HOST:-} "
EXTRA=""; for H in $HAVE; do case "$WANT" in *" $H "*) ;; *) EXTRA="$EXTRA $H" ;; esac; done
if [ -n "$EXTRA" ] && [ "${#CERT_ARGS[@]}" -gt 0 ]; then
  echo "    removing no-longer-served names from the certificate:$EXTRA"
  certbot --nginx --cert-name "$CERT_NAME" "${CERT_ARGS[@]}" --non-interactive --agree-tos --register-unsafely-without-email --redirect --reinstall 2>&1 | tail -3
  HAVE2=$(certbot certificates --cert-name "$CERT_NAME" 2>/dev/null | sed -n 's/^ *Domains: //p' | head -1)
  echo "    certificate now covers: $HAVE2"
fi
# certbot's http->https redirect answers 301, and a client that follows a 301 re-sends a POST as a GET WITHOUT its body: a payment callback registered
# with an http:// address would silently arrive empty. 308 keeps the method and the body (browsers treat it like 301 for a normal page).
sed -i -E 's#return 301 https://#return 308 https://#' "$CONF"
# The regenerated file has no HTTPS sections until certbot adds them. If the old file had them and this one does not (certbot skipped or failed), put
# the old file back: reloading port-80-only nginx would lock every browser out (the site sends HSTS).
if [ -f "$BAK" ] && grep -q ssl_certificate "$BAK" && ! grep -q ssl_certificate "$CONF"; then
  echo "    !! HTTPS sections are missing after the certificate step: putting the previous nginx file back"
  cp "$BAK" "$CONF"; nginx -t >/dev/null 2>&1 && systemctl reload nginx
  echo "    Check the DNS records (see above) and run this again."; exit 1
fi
# HTTP/2 lets a phone fetch many files over ONE connection (a big gain on long-distance links). Added only if missing, and undone if nginx refuses it.
(umask 077; cp "$CONF" /tmp/mint.conf.pre-h2)   # the file holds the secret webhook address: keep the copy private
sed -i -E '/^[[:space:]]*listen .*443 ssl/{/http2/!s/443 ssl/443 ssl http2/}' "$CONF"
if nginx -t >/dev/null 2>&1; then echo "    HTTP/2 on: $(grep -c 'ssl http2' "$CONF") listen line(s)"; else echo "    (HTTP/2 not accepted by this nginx, left as it was)"; cp /tmp/mint.conf.pre-h2 "$CONF"; fi
if nginx -t >/dev/null 2>&1; then systemctl reload nginx && echo "    nginx reloaded"; else echo "    !! nginx test failed after certbot, putting the old file back"; cp "$BAK" "$CONF"; nginx -t 2>&1 | tail -1; systemctl reload nginx; exit 1; fi

say "5/7  Restart Mint (secrets re-read)"
cd "$MINT/deploy" || exit 1
if pm2 describe mint-server >/dev/null 2>&1; then pm2 reload ecosystem.config.js --update-env 2>&1 | tail -3; else pm2 start ecosystem.config.js 2>&1 | tail -3; fi
pm2 save >/dev/null 2>&1 || true
sleep 4

say "6/7  Firewall, fail2ban, automatic updates"
bash "$MINT/deploy/harden-vps.sh"

say "7/7  Is the site healthy?"
code=$(curl -s -o /tmp/mint.health -w '%{http_code}' "https://$APP_HOST/k7x2/health" || true)
echo "    https://$APP_HOST/k7x2/health -> HTTP $code  $(head -c 120 /tmp/mint.health 2>/dev/null)"
code2=$(curl -s -o /dev/null -w '%{http_code}' -A 'sqlmap/1.7' "https://$APP_HOST/" || true)
echo "    a 'sqlmap' visitor gets HTTP $code2   (expected 403 or 444: the wall works)"
code3=$(curl -s -o /dev/null -w '%{http_code}' "https://$APP_HOST/.env" || true)
echo "    /.env gets HTTP $code3   (expected 403/404)"
echo; echo "DONE."
