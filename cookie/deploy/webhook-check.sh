#!/usr/bin/env bash
# READ-ONLY check of the payment-callback (webhook) path on this server. Changes nothing, prints no secret values.
# Run as root:  bash /srv/cookie-src/cookie/deploy/webhook-check.sh
set -u
SECRETS=${COOKIE_SECRETS_FILE:-/srv/cookie-secrets/secrets.local.js}
HOOK_FILE=/srv/cookie-secrets/hook-token; HOOK_HOST_FILE=/srv/cookie-secrets/hook-host; APP_FILE=/srv/cookie-secrets/app-host
APP=$(cat "$APP_FILE" 2>/dev/null | tr -d '[:space:]'); APP=${APP:-app.cookie.example.com}
HH=$(cat "$HOOK_HOST_FILE" 2>/dev/null | tr -d '[:space:]'); TOKEN=$(cat "$HOOK_FILE" 2>/dev/null | tr -d '[:space:]')
say() { printf '\n==> %s\n' "$*"; }
has() { grep -Eq "^[[:space:]]*module\.exports\.$1[[:space:]]*=[[:space:]]*['\"][^'\"]+['\"]" "$SECRETS" 2>/dev/null && echo "set" || echo "NOT SET"; }

say "1/6  Settings the callbacks depend on (values hidden, except the public address)"
echo "    PUBLIC_URL             : $(grep -E "^[[:space:]]*module\.exports\.PUBLIC_URL" "$SECRETS" 2>/dev/null | sed -E "s/.*=[[:space:]]*['\"]([^'\"]*)['\"].*/\1/" | head -1)   (must be https://$APP/k7x2 : MarzPay calls back here)"
echo "    PESAJET_API_KEY        : $(has PESAJET_API_KEY)"
echo "    PESAJET_WEBHOOK_SECRET : $(has PESAJET_WEBHOOK_SECRET)   (a wrong one makes every PesaJet callback answer 401 and PesaJet retries only after 1, 5, 15 minutes)"
echo "    MARZPAY_KEY            : $(has MARZPAY_KEY)"

say "2/6  The webhook address PesaJet must have in its dashboard"
if [ -n "$TOKEN" ] && [ -n "$HH" ]; then echo "    https://$HH/h-<secret>/pesajet   (the secret part is printed by: bash /srv/cookie-src/cookie/deploy/make-hook-url.sh)"; elif [ -n "$TOKEN" ]; then echo "    https://$APP/k7x2/h-<secret>/pesajet"; else echo "    !! no secret webhook address is set up (run make-hook-url.sh)"; fi

say "3/6  Does each callback address answer, and how fast? (tested from this server, with a deliberately WRONG signature, so nothing is credited)"
t() { curl -s -o /dev/null --max-time 15 -w "    %-52s HTTP %{http_code}  %{time_total}s\n" "$@"; }
if [ -n "$TOKEN" ] && [ -n "$HH" ]; then
  URL="https://$HH/h-$TOKEN/pesajet"; printf '    '; curl -s -o /dev/null --max-time 15 -w "PesaJet hook host (expect 401 = reachable, wrong signature refused): HTTP %{http_code}  %{time_total}s\n" -X POST -H 'Content-Type: application/json' -H 'X-Webhook-Signature: 0000' -A 'PesaJet-Webhooks/1.0' -d '{"event":"ping"}' "$URL"
fi
printf '    '; curl -s -o /dev/null --max-time 15 -w "MarzPay deposit callback (expect 200): HTTP %{http_code}  %{time_total}s\n" -X POST -H 'Content-Type: application/json' -d '{}' "https://$APP/k7x2/deposit/callback"
printf '    '; curl -s -o /dev/null --max-time 15 -w "plain PesaJet path (expect 404 = closed): HTTP %{http_code}\n" -X POST -H 'Content-Type: application/json' -d '{}' "https://$APP/k7x2/pesajet/webhook"
printf '    '; curl -s -o /dev/null --max-time 15 -w "http:// (not https) POST redirect check (a 301 would lose the body): HTTP %{http_code}  ->%{redirect_url}\n" -X POST -d '{}' "http://${HH:-$APP}/k7x2/deposit/callback"

say "4/6  What the gateways actually sent in the last hours (nginx log): time, status, sender name, source address"
LOG=/var/log/nginx/access.log
if [ -r "$LOG" ]; then
  grep -a -E '/pesajet|/deposit/callback|/withdraw/callback|/h-' "$LOG" | grep -a -v 'deposit/callback.*curl' | tail -25 | sed -E 's#/h-[A-Za-z0-9]+/#/h-<hidden>/#g' | awk '{print "    " $0}' | cut -c1-230
  echo "    --- status counts for those requests:"
  grep -a -E '"POST [^"]*(/pesajet|/deposit/callback|/withdraw/callback)' "$LOG" | awk '{print $9}' | sort | uniq -c | awk '{print "      HTTP " $2 ": " $1}'
else echo "    (cannot read $LOG)"; fi

say "5/6  What Cookie logged about payments (last 300 lines)"
pm2 logs cookie-server --nostream --lines 300 2>/dev/null | grep -a -E "signature mismatch|Deposit .* credited|PesaJet webhook|MarzPay webhook|callback" | tail -15 | cut -c1-220 | awk '{print "    " $0}'
echo "    (a line 'credited X s after it was submitted, Y s after PesaJet accepted it -- confirmed by: ...' tells who found the payment first and how long it really took)"

say "6/6  Does the certificate cover the webhook host?"
certbot certificates 2>/dev/null | grep -E "Certificate Name|Domains|Expiry" | awk '{print "    " $0}'
if [ -n "$HH" ]; then
  if certbot certificates 2>/dev/null | grep -E "Domains:" | grep -qw "$HH"; then echo "    OK: the certificate covers the webhook host $HH"; else echo "    !! the certificate does NOT cover $HH: the gateway cannot deliver over https. Check its DNS A record, then run update-vps.sh again."; fi
fi
echo; echo "DONE (nothing was changed)."
