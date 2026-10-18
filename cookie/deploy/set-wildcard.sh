#!/usr/bin/env bash
# Random, endless invite-link addresses:  mt3c.yourdomain.com , mcqk.yourdomain.com , once.yourdomain.com ...  A new one every time a member opens Share or taps Copy.
#   bash /srv/cookie-src/cookie/deploy/set-wildcard.sh yourdomain.com
# For a domain whose DNS is at HOSTINGER (the default for a domain bought there). What it does, in order (each step says what it did; running it again is safe):
#   1  asks once for a Hostinger API token (hidden; hPanel -> API) and keeps it in /srv/cookie-secrets/hostinger.token (root only)
#   2  makes the wildcard DNS record  *.yourdomain.com -> this server  (so ANY first word reaches Cookie)
#   3  gets ONE wildcard HTTPS certificate (*.yourdomain.com); certbot proves the domain through the Hostinger API, now and at every renewal, by itself
#   4  tells Cookie the domain (SHARE_DOMAIN) and runs set-domain.sh, which rebuilds nginx so every random address serves the app
# Only the single record named in each step is changed; the rest of the DNS zone (website, email) is never touched. Nothing here touches Soda or Mint.
set -u
[ "$(id -u)" = 0 ] || { echo "Run this as root."; exit 1; }
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COOKIE=${COOKIE_DIR:-$(dirname "$HERE")}
SECRETS=${COOKIE_SECRETS_DIR:-/srv/cookie-secrets}
TOKEN_FILE=${COOKIE_HOSTINGER_TOKEN_FILE:-$SECRETS/hostinger.token}
WILD_FILE=${COOKIE_WILD_FILE:-$SECRETS/wildcard-domain}
RAW=${1:-}
[ -n "$RAW" ] || { echo "Say the domain, e.g.:  bash $0 yourdomain.com"; exit 1; }
DOM=$(printf '%s' "$RAW" | tr 'A-Z' 'a-z' | sed -E 's#^https?://##; s#^\*\.##; s#/.*$##; s#^www\.##')
printf '%s' "$DOM" | grep -Eq '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' || { echo "Not understood: $RAW   (write it like  yourdomain.com)"; exit 1; }
mkdir -p "$SECRETS"
NODE=$(command -v node) || { echo "Node is not installed."; exit 1; }
HDNS="$NODE $COOKIE/deploy/hostinger-dns.js"

echo "1/4  Hostinger token"
if [ ! -s "$TOKEN_FILE" ]; then
  echo "     hPanel (hpanel.hostinger.com) -> your profile (top right) -> API -> create a token (any name, no expiry) and copy it."
  printf "     Paste the token (nothing shows as you type), then Enter: "; read -rs T; echo
  T=$(printf '%s' "$T" | tr -d '[:space:]')
  [ -n "$T" ] || { echo "Nothing entered. NOTHING was changed."; exit 1; }
  (umask 077; printf '%s\n' "$T" > "$TOKEN_FILE"); chmod 600 "$TOKEN_FILE"
fi
if ! OUT=$($HDNS check "$DOM" 2>&1); then
  echo "     !! $OUT"
  echo "     The token was refused, or $DOM is not in this Hostinger account. Make the token again (hPanel -> API) and run this command again."
  rm -f "$TOKEN_FILE"; exit 1
fi
echo "     $OUT"

echo "2/4  Wildcard DNS record  *.$DOM"
MYIP=$(curl -4 -s --max-time 8 https://ifconfig.me || true); [ -n "$MYIP" ] || MYIP=$(curl -4 -s --max-time 8 https://icanhazip.com | tr -d '[:space:]' || true)
[ -n "$MYIP" ] || { echo "     !! could not find this server's address"; exit 1; }
OUT=$($HDNS wild-a "$DOM" "$MYIP" 2>&1) || { echo "     !! $OUT"; exit 1; }
echo "     $OUT"
printf "     waiting for it to answer"
for i in $(seq 1 60); do
  H=$(getent ahostsv4 "zz$RANDOM$RANDOM.$DOM" 2>/dev/null | awk '{print $1; exit}')
  [ "$H" = "$MYIP" ] && { echo " ... answers"; break; }
  printf "."; sleep 5
  [ "$i" = 60 ] && { echo; echo "     !! a random address of $DOM does not point here yet. Look at Hostinger -> Domains -> DNS: the *  A record should show $MYIP. Wait a few minutes and run this again."; exit 1; }
done

echo "3/4  Wildcard HTTPS certificate (about 1-3 minutes)"
command -v certbot >/dev/null 2>&1 || { echo "     !! certbot is not installed (it is, if Soda runs here with HTTPS)."; exit 1; }
certbot certonly --manual --preferred-challenges dns \
  --manual-auth-hook "$HDNS auth" --manual-cleanup-hook "$HDNS cleanup" \
  -d "*.$DOM" --cert-name cookie-wild --keep-until-expiring --non-interactive --agree-tos --register-unsafely-without-email \
  --deploy-hook "systemctl reload nginx" 2>&1 | tail -5
[ -f /etc/letsencrypt/live/cookie-wild/fullchain.pem ] || { echo "     !! the certificate was not made (lines above). NOTHING else was changed."; exit 1; }
echo "     certificate ready; certbot renews it by itself (it uses the same token file)"

echo "4/4  Telling Cookie and rebuilding nginx"
(umask 077; printf '%s' "$DOM" > "$WILD_FILE")
COOKIE_SECRET_VALUE="$DOM" node "$COOKIE/deploy/set-secret.js" SHARE_DOMAIN >/dev/null && echo "     SHARE_DOMAIN saved"
bash "$COOKIE/deploy/set-domain.sh" "$DOM" || { echo "     !! set-domain.sh stopped (lines above). The wildcard DNS and certificate are in place; run this again after fixing that."; exit 1; }
echo
T="$(head -c 2 /dev/urandom | od -An -tx1 | tr -d ' \n')x.$DOM"
H=$(curl -s -m 15 "https://$T/k7x2/health")
# The payment page's address must open the app on a reload (nginx has to serve /payment/<number> as the app): tested on the app address and the random one.
APPH=$(tr -d '[:space:]' < "${COOKIE_APP_HOST_FILE:-$SECRETS/app-host}" 2>/dev/null)
for HH in "$APPH" "$T"; do
  [ -n "$HH" ] || continue
  C=$(curl -s -o /dev/null -m 15 -w '%{http_code}' "https://$HH/payment/12345678901")
  if [ "$C" = 200 ]; then echo "Payment page address on $HH: opens (HTTP 200)"; else echo "!! Payment page address on $HH answers HTTP $C (should be 200). Send me this line."; fi
done
case "$H" in
  *'"status":"ok"'*) echo "Test on a random address ($T):  $H"
     echo "Done. Open Share in the app: every open and every Copy makes a new address like https://mt3c.$DOM/h5/#/pages/login/reset?inviteCode=..." ;;
  *) echo "!! The random address ($T) did not answer yet (got: ${H:-nothing}). The certificate and DNS are in place; wait a minute and run this same command again."; exit 1 ;;
esac
