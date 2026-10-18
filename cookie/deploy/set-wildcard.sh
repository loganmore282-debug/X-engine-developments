#!/usr/bin/env bash
# Random, endless invite-link addresses:  gs6fy.yourdomain.com , gsrt.yourdomain.com , ...  A new one every time a member opens Share or taps Copy.
#   bash /srv/cookie-src/cookie/deploy/set-wildcard.sh yourdomain.com
# What it does, in order (each step says what it did; running it again is safe):
#   1  asks once for a Cloudflare API token (hidden) and keeps it in /srv/cookie-secrets/cloudflare.ini (root only)
#   2  makes the wildcard DNS record  *.yourdomain.com -> this server  (so ANY first word reaches Cookie)
#   3  gets ONE wildcard HTTPS certificate (*.yourdomain.com) and renews it by itself
#   4  tells Cookie the domain (SHARE_DOMAIN) and runs set-domain.sh, which rebuilds nginx so every random address serves the app
# The domain's DNS has to be on Cloudflare (free): a wildcard certificate can only be issued by proving the DNS, and Cloudflare is what lets this
# command do that by itself, forever. See "Cloudflare, one time" in cookie/CLAUDE.md. Nothing here touches Soda or Mint.
set -u
[ "$(id -u)" = 0 ] || { echo "Run this as root."; exit 1; }
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COOKIE=${COOKIE_DIR:-$(dirname "$HERE")}
SECRETS=${COOKIE_SECRETS_DIR:-/srv/cookie-secrets}
CRED=${COOKIE_CF_CRED:-$SECRETS/cloudflare.ini}
WILD_FILE=${COOKIE_WILD_FILE:-$SECRETS/wildcard-domain}
RAW=${1:-}
[ -n "$RAW" ] || { echo "Say the domain, e.g.:  bash $0 yourdomain.com"; exit 1; }
DOM=$(printf '%s' "$RAW" | tr 'A-Z' 'a-z' | sed -E 's#^https?://##; s#^\*\.##; s#/.*$##; s#^www\.##')
printf '%s' "$DOM" | grep -Eq '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' || { echo "Not understood: $RAW   (write it like  yourdomain.com)"; exit 1; }
mkdir -p "$SECRETS"
cf() { curl -s -m 25 -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" "$@"; }
jget() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);const v=(new Function("j","return "+process.argv[1]))(j);process.stdout.write(v==null?"":String(v));}catch(e){}})' "$1"; }

echo "1/4  Cloudflare token"
if [ ! -s "$CRED" ]; then
  echo "     Cloudflare dashboard -> My Profile -> API Tokens -> Create Token -> template \"Edit zone DNS\" -> Zone Resources: $DOM -> Create."
  printf "     Paste the token (nothing shows as you type), then Enter: "; read -rs TOKEN; echo
  TOKEN=$(printf '%s' "$TOKEN" | tr -d '[:space:]')
  [ -n "$TOKEN" ] || { echo "Nothing entered. NOTHING was changed."; exit 1; }
else
  TOKEN=$(sed -n 's/^dns_cloudflare_api_token *= *//p' "$CRED" | tr -d '[:space:]')
fi
OK=$(cf https://api.cloudflare.com/client/v4/user/tokens/verify | jget 'j.success && j.result.status')
[ "$OK" = "active" ] || { echo "     !! Cloudflare did not accept that token ($OK). Make it again and run this command again. NOTHING was changed."; rm -f "$CRED"; exit 1; }
if [ ! -s "$CRED" ]; then (umask 077; printf 'dns_cloudflare_api_token = %s\n' "$TOKEN" > "$CRED"); chmod 600 "$CRED"; fi
echo "     token accepted and saved ($CRED)"

echo "2/4  Wildcard DNS record  *.$DOM"
ZONE=$(cf "https://api.cloudflare.com/client/v4/zones?name=$DOM" | jget 'j.result && j.result[0] && j.result[0].id')
[ -n "$ZONE" ] || { echo "     !! $DOM is not on this Cloudflare account yet. Add it in Cloudflare (Add a site, Free plan), change the nameservers where you bought the domain to the two Cloudflare gives you, wait until Cloudflare says Active, then run this again."; exit 1; }
MYIP=$(curl -4 -s --max-time 8 https://ifconfig.me || true); [ -n "$MYIP" ] || MYIP=$(curl -4 -s --max-time 8 https://icanhazip.com | tr -d '[:space:]' || true)
[ -n "$MYIP" ] || { echo "     !! could not find this server's address"; exit 1; }
REC=$(cf "https://api.cloudflare.com/client/v4/zones/$ZONE/dns_records?type=A&name=*.$DOM")
RID=$(printf '%s' "$REC" | jget 'j.result && j.result[0] && j.result[0].id')
BODY="{\"type\":\"A\",\"name\":\"*.$DOM\",\"content\":\"$MYIP\",\"ttl\":300,\"proxied\":false}"
if [ -n "$RID" ]; then R=$(cf -X PUT "https://api.cloudflare.com/client/v4/zones/$ZONE/dns_records/$RID" --data "$BODY" | jget 'j.success'); else R=$(cf -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE/dns_records" --data "$BODY" | jget 'j.success'); fi
[ "$R" = "true" ] || { echo "     !! Cloudflare would not save the record (does the token have Edit zone DNS for $DOM?)"; exit 1; }
echo "     *.$DOM -> $MYIP  (DNS only, not proxied)"
printf "     waiting for it to answer"
for i in $(seq 1 36); do
  T="zz$RANDOM$RANDOM.$DOM"; H=$(getent ahostsv4 "$T" 2>/dev/null | awk '{print $1; exit}')
  [ "$H" = "$MYIP" ] && { echo " ... answers"; break; }
  printf "."; sleep 5
  [ "$i" = 36 ] && { echo; echo "     !! a random address of $DOM does not point here yet. Check Cloudflare shows the *.$DOM record, wait a few minutes and run this again."; exit 1; }
done

echo "3/4  Wildcard HTTPS certificate"
if ! certbot plugins 2>/dev/null | grep -qi dns-cloudflare; then
  echo "     installing the Cloudflare plugin for certbot ..."
  DEBIAN_FRONTEND=noninteractive apt-get install -y python3-certbot-dns-cloudflare >/tmp/cookie.cfplugin.log 2>&1 || true
  if ! certbot plugins 2>/dev/null | grep -qi dns-cloudflare && command -v snap >/dev/null 2>&1; then
    snap set certbot trust-plugin-with-root=ok >/dev/null 2>&1; snap install certbot-dns-cloudflare >>/tmp/cookie.cfplugin.log 2>&1; snap connect certbot:plugin certbot-dns-cloudflare >>/tmp/cookie.cfplugin.log 2>&1
  fi
  certbot plugins 2>/dev/null | grep -qi dns-cloudflare || { echo "     !! could not install the plugin. Last lines:"; tail -4 /tmp/cookie.cfplugin.log; exit 1; }
fi
certbot certonly --dns-cloudflare --dns-cloudflare-credentials "$CRED" --dns-cloudflare-propagation-seconds 40 -d "*.$DOM" \
  --cert-name cookie-wild --keep-until-expiring --non-interactive --agree-tos --register-unsafely-without-email \
  --deploy-hook "systemctl reload nginx" 2>&1 | tail -4
[ -f /etc/letsencrypt/live/cookie-wild/fullchain.pem ] || { echo "     !! the certificate was not made (lines above). NOTHING else was changed."; exit 1; }
echo "     certificate ready; certbot renews it by itself"

echo "4/4  Telling Cookie and rebuilding nginx"
(umask 077; printf '%s' "$DOM" > "$WILD_FILE")
COOKIE_SECRET_VALUE="$DOM" node "$COOKIE/deploy/set-secret.js" SHARE_DOMAIN >/dev/null && echo "     SHARE_DOMAIN saved"
bash "$COOKIE/deploy/set-domain.sh" "$DOM" || { echo "     !! set-domain.sh stopped (lines above). The wildcard DNS and certificate are in place; run it again after fixing that."; exit 1; }
echo
T="$(head -c 3 /dev/urandom | od -An -tx1 | tr -d ' \n')x.$DOM"
echo "Test on a random address ($T):  $(curl -s -m 12 "https://$T/k7x2/health")"
echo "Done. Open Share in the app: every open and every Copy makes a new address like https://<random>.$DOM/h5/#/pages/login/reset?inviteCode=..."
