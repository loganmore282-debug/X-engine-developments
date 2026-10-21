#!/usr/bin/env bash
# READ-ONLY check of everything Chrome (and Google's app-building server) fetches when a member installs the app. Changes nothing.
# Run as root:  bash /srv/mint-src/mint/deploy/pwa-check.sh
set -u
APP=$(tr -d '[:space:]' < "${MINT_APP_HOST_FILE:-/srv/mint-secrets/app-host}" 2>/dev/null)
[ -n "$APP" ] || { echo "No domain is set up yet."; exit 1; }
UA_PHONE='Mozilla/5.0 (Linux; Android 13; Phone) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36'
UA_G='Mozilla/5.0 (compatible; GoogleOther)'
say() { printf '\n==> %s\n' "$*"; }
get() { # url, user-agent, label
  local out; out=$(curl -s -o /tmp/mint.pwa.body -m 20 -A "$2" -w '%{http_code} %{content_type} %{size_download}B %{time_total}s' "https://$APP$1" 2>&1)
  printf '    %-34s %-12s %s\n' "$1" "$3" "$out"
}
say "1/4  Files Chrome needs (expect 200 for each; the icons must be image/png)"
for u in /manifest.json /k7x2/public/app-icon-192.png /k7x2/public/app-icon-512.png /sw.js /; do get "$u" "$UA_PHONE" "phone"; done
say "2/4  The same files as Google's server might ask for them (a 403 or an empty answer here would stall the install)"
for u in /manifest.json /k7x2/public/app-icon-192.png /k7x2/public/app-icon-512.png; do get "$u" "$UA_G" "google"; done
say "3/4  What the icons really are (must be square PNGs: 192x192 and 512x512)"
for s in 192 512; do
  curl -s -m 20 -A "$UA_PHONE" -o /tmp/mint.pwa.icon "https://$APP/k7x2/public/app-icon-$s.png"
  SIG=$(head -c 8 /tmp/mint.pwa.icon | od -An -tx1 | tr -d ' \n')
  W=$(od -An -tu1 -j16 -N4 /tmp/mint.pwa.icon | awk '{print $1*16777216+$2*65536+$3*256+$4}'); H=$(od -An -tu1 -j20 -N4 /tmp/mint.pwa.icon | awk '{print $1*16777216+$2*65536+$3*256+$4}')
  if [ "$SIG" = "89504e470d0a1a0a" ]; then echo "    app-icon-$s.png: a PNG, ${W}x${H} pixels"; else echo "    !! app-icon-$s.png is NOT a PNG (starts with $SIG)"; fi
done
say "4/4  The manifest as Chrome reads it"
curl -s -m 20 -A "$UA_PHONE" "https://$APP/manifest.json" | head -c 700; echo
echo; echo "If every line above is fine, the server side is healthy: a stuck 'Installing' is then on the phone (see the advice I sent)."
