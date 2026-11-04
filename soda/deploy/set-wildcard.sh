#!/usr/bin/env bash
# Random 4-character addresses for the member app:  h6re.yourdomain.com , suag.yourdomain.com , 7wht.yourdomain.com ...  A new one every time a member opens Share or taps Copy.
#   bash /srv/soda-src/soda/deploy/set-wildcard.sh yourdomain.com
# For a domain whose DNS is at HOSTINGER (the default for a domain bought there). What it does, in order (each step says what it did; running it again is safe):
#   1  asks once for a Hostinger API token (hidden; hPanel -> API) and keeps it in /srv/soda-secrets/hostinger.token (root only)
#   2  makes the wildcard DNS record  *.yourdomain.com -> this server  (so any four-character name reaches Soda)
#   3  gets ONE wildcard HTTPS certificate (*.yourdomain.com); certbot proves the domain through the Hostinger API, now and at every renewal, by itself
#   4  tells Soda the domain (SHARE_DOMAIN) and runs update-vps.sh, which rebuilds nginx so every random 4-character address serves the app
# Only the single record named in each step is changed; the rest of the DNS zone (website, email) is never touched. Nothing here touches Soda or Mint.
set -u
[ "$(id -u)" = 0 ] || { echo "Run this as root."; exit 1; }
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SODA=${SODA_DIR:-$(dirname "$HERE")}
SECRETS=${SODA_SECRETS_DIR:-/srv/soda-secrets}
TOKEN_FILE=${SODA_HOSTINGER_TOKEN_FILE:-$SECRETS/hostinger.token}
WILD_FILE=${SODA_WILD_FILE:-$SECRETS/wildcard-domain}
RAW=${1:-}
if [ -z "$RAW" ]; then
  SAVED=""; [ -s "$WILD_FILE" ] && SAVED=$(tr -d '[:space:]' < "$WILD_FILE")
  if [ -n "$SAVED" ]; then printf 'Your domain [%s] (press Enter to keep it): ' "$SAVED"; else printf 'Type the domain you bought (like yourdomain.com): '; fi
  read -r RAW || RAW=""; [ -n "$RAW" ] || RAW=$SAVED
  [ -n "$RAW" ] || { echo "No domain entered. NOTHING was changed."; exit 1; }
fi
DOM=$(printf '%s' "$RAW" | tr 'A-Z' 'a-z' | sed -E 's#^https?://##; s#^\*\.##; s#/.*$##; s#^www\.##')
printf '%s' "$DOM" | grep -Eq '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' || { echo "Not understood: $RAW   (write it like  yourdomain.com)"; exit 1; }
mkdir -p "$SECRETS"
NODE=$(command -v node) || { echo "Node is not installed."; exit 1; }
HDNS="$NODE $SODA/deploy/hostinger-dns.js"

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
  case "$OUT" in *"said 401"*|*"said 403"*) rm -f "$TOKEN_FILE" ;; esac; exit 1
fi
echo "     $OUT"

echo "2/4  Wildcard DNS record  *.$DOM"
MYIP=$(curl -4 -sf --max-time 8 https://ifconfig.me || true); printf '%s' "$MYIP" | grep -Eq '^[0-9]{1,3}(\.[0-9]{1,3}){3}$' || MYIP=$(curl -4 -sf --max-time 8 https://icanhazip.com | tr -d '[:space:]' || true); printf '%s' "$MYIP" | grep -Eq '^[0-9]{1,3}(\.[0-9]{1,3}){3}$' || MYIP=""
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
  -d "*.$DOM" --cert-name soda-wild --keep-until-expiring --non-interactive --agree-tos --register-unsafely-without-email \
  --deploy-hook "systemctl reload nginx" 2>&1 | tail -5
[ -f /etc/letsencrypt/live/soda-wild/fullchain.pem ] || { echo "     !! the certificate was not made (lines above). NOTHING else was changed."; exit 1; }
echo "     certificate ready; certbot renews it by itself (it uses the same token file)"

echo "4/4  Telling Soda and rebuilding nginx"
(umask 077; printf '%s' "$DOM" > "$WILD_FILE")
SODA_SECRET_VALUE="$DOM" node "$SODA/deploy/set-secret.js" SHARE_DOMAIN >/dev/null && echo "     SHARE_DOMAIN saved"
bash "$SODA/deploy/update-vps.sh" || { echo "     !! update-vps.sh stopped (lines above). The wildcard DNS and certificate are in place; run this again after fixing that."; exit 1; }
echo
T="$(head -c 2 /dev/urandom | od -An -tx1 | tr -d ' \n').$DOM"
H=$(curl -s -m 15 "https://$T/k7x2/health")
case "$H" in
  *'"status":"ok"'*) echo "Test on a random address ($T):  $H"
     echo "Done. Open Share in the app: every open and every Copy makes a new address like https://h6re.$DOM/share.html?..." ;;
  *) echo "!! The random address ($T) did not answer yet (got: ${H:-nothing}). The certificate and DNS are in place; wait a minute and run this same command again."; exit 1 ;;
esac
