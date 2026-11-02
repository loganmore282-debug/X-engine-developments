#!/usr/bin/env bash
# Random 4-character addresses for the member app:  h6re.petro-cchnug.com , suag.petro-cchnug.com , 7wht.petro-cchnug.com ...
# The old  app.  address is dropped. A new random address is made every time a member opens Share or taps Copy.
#   bash /srv/petro-src/petro/deploy/set-wildcard.sh petro-cchnug.com
# DNS is at HOSTINGER. In order (each step says what it did; running it again is safe):
#   1  asks once for a Hostinger API token (hPanel -> your profile -> API) and keeps it in /srv/petro-secrets/hostinger.token (root only)
#   2  makes the wildcard DNS record  *.petro-cchnug.com -> this server
#   3  gets ONE wildcard HTTPS certificate (*.petro-cchnug.com); certbot proves the domain through the Hostinger API now and at every renewal
#   4  writes the nginx file for the random addresses, takes the old app. block out, tells the server (SHARE_DOMAIN) and restarts it
# api. and qumx. keep their own certificates and are never touched. Only the single DNS record named in step 2 is changed.
set -u
[ "$(id -u)" = 0 ] || { echo "Run this as root."; exit 1; }
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SECRETS=${PETRO_SECRETS_DIR:-/srv/petro-secrets}
TOKEN_FILE=${PETRO_HOSTINGER_TOKEN_FILE:-$SECRETS/hostinger.token}
RAW=${1:-petro-cchnug.com}
DOM=$(printf '%s' "$RAW" | tr 'A-Z' 'a-z' | sed -E 's#^https?://##; s#^\*\.##; s#/.*$##; s#^www\.##')
printf '%s' "$DOM" | grep -Eq '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' || { echo "Not understood: $RAW   (write it like  petro-cchnug.com)"; exit 1; }
mkdir -p "$SECRETS"
NODE=$(command -v node) || { echo "Node is not installed."; exit 1; }
HDNS="$NODE $HERE/hostinger-dns.js"
TEMPLATE="$HERE/nginx-petro.conf.template"
LIVE=/etc/nginx/sites-available/petro
WILD=/etc/nginx/sites-available/petro-wild
CERT=/etc/letsencrypt/live/petro-wild

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
  [ "$i" = 60 ] && { echo; echo "     !! a random address of $DOM does not point here yet. Hostinger -> Domains -> DNS: the *  A record should show $MYIP. Wait a few minutes and run this again."; exit 1; }
done

echo "3/4  Wildcard HTTPS certificate (about 1-3 minutes)"
command -v certbot >/dev/null 2>&1 || { echo "     !! certbot is not installed."; exit 1; }
certbot certonly --manual --preferred-challenges dns \
  --manual-auth-hook "$HDNS auth" --manual-cleanup-hook "$HDNS cleanup" \
  -d "*.$DOM" --cert-name petro-wild --keep-until-expiring --non-interactive --agree-tos --register-unsafely-without-email \
  --deploy-hook "systemctl reload nginx" 2>&1 | tail -5
[ -f "$CERT/fullchain.pem" ] || { echo "     !! the certificate was not made (lines above). NOTHING else was changed."; exit 1; }
echo "     certificate ready; certbot renews it by itself (it uses the same token file)"

echo "4/4  nginx, the server, and the old app. address"
# The member-app block of the template, made for any 4-character name (api. and qumx. have exact names of their own, which nginx always prefers).
awk '/^# .* app\.PETRO_DOMAIN ->/{on=1} /^# .* qumx\.PETRO_DOMAIN ->/{on=0} on' "$TEMPLATE" \
  | sed -e "s#server_name app\.PETRO_DOMAIN;#server_name \"~^[a-z0-9]{4}\\\\.${DOM//./\\\\.}\$\";#" \
        -e "s#PETRO_DOMAIN#$DOM#g" \
        -e "s#listen 443 ssl http2;#listen 443 ssl http2;\n    ssl_certificate $CERT/fullchain.pem;\n    ssl_certificate_key $CERT/privkey.pem;#" > "$WILD.new"
grep -q 'server_name "~' "$WILD.new" || { echo "     !! could not build the nginx file from the template."; rm -f "$WILD.new"; exit 1; }
cat > "$WILD" <<EOT
# Random 4-character addresses of $DOM (made by deploy/set-wildcard.sh). http goes to https; https serves the member app with the wildcard certificate.
server {
    listen 80;
    listen [::]:80;
    server_name "~^[a-z0-9]{4}\\.${DOM//./\\.}\$";
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 308 https://\$host\$request_uri; }
}

EOT
cat "$WILD.new" >> "$WILD"; rm -f "$WILD.new"
ln -sf "$WILD" /etc/nginx/sites-enabled/petro-wild
# Take the old app. block out of the live file (only when it is still there), keeping a copy to go back to.
if grep -q 'server_name app\.' "$LIVE" 2>/dev/null; then
  cp "$LIVE" "$LIVE.before-wildcard"
  awk '/^# .* app\.'"$DOM"' ->/{skip=1} /^# .* qumx\.'"$DOM"' ->/{skip=0} !skip' "$LIVE.before-wildcard" | sed -E "s# app\.$DOM##" > "$LIVE"
fi
if ! nginx -t 2>&1 | tail -3 | grep -q 'successful'; then
  nginx -t 2>&1 | tail -5
  [ -f "$LIVE.before-wildcard" ] && cp "$LIVE.before-wildcard" "$LIVE"
  rm -f /etc/nginx/sites-enabled/petro-wild
  echo "     !! nginx refused the new files; everything was put back as it was."; exit 1
fi
systemctl reload nginx || { echo "     !! nginx did not reload"; exit 1; }
echo "     nginx reloaded"
# Tell the server the domain (SHARE_DOMAIN in deploy/secrets.local.js, which is never committed), then restart it with the new value.
SECFILE="$HERE/secrets.local.js"
[ -f "$SECFILE" ] || echo "module.exports = {};" > "$SECFILE"
SECFILE="$SECFILE" DOM="$DOM" "$NODE" -e '
const fs=require("fs"),f=process.env.SECFILE;let s=fs.readFileSync(f,"utf8");const line="  SHARE_DOMAIN: "+JSON.stringify(process.env.DOM)+",";
if(/^\s*SHARE_DOMAIN\s*:.*$/m.test(s)) s=s.replace(/^\s*SHARE_DOMAIN\s*:.*$/m,line); else s=s.replace(/module\.exports\s*=\s*\{/, "module.exports = {\n"+line);
fs.writeFileSync(f,s);' && echo "     SHARE_DOMAIN saved"
( cd "$HERE" && pm2 reload ecosystem.config.js --only petro-server --update-env >/dev/null 2>&1 || pm2 restart petro-server --update-env >/dev/null 2>&1 ) && echo "     server restarted"
echo
T="$(head -c 2 /dev/urandom | od -An -tx1 | tr -d ' \n').$DOM"
C=$(curl -s -m 15 -o /dev/null -w '%{http_code}' "https://$T/")
H=$(curl -s -m 15 "https://api.$DOM/health")
case "$C" in
  200) echo "Test on a random address (https://$T): the app answered (200). Server: ${H:-no answer}"
       echo "Done. Open Share in the app: every open and every Copy makes a new address like https://h6re.$DOM/share.html?..." ;;
  *) echo "!! The random address (https://$T) answered ${C:-nothing}. The certificate and DNS are in place; wait a minute and run this same command again."; exit 1 ;;
esac
