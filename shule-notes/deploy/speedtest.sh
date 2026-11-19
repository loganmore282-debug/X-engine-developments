#!/usr/bin/env bash
# Measures how fast the Shule Notes server answers, from this machine, split into
# its parts, so you can tell server time from network time. Changes nothing.
#
#   ./speedtest.sh [https://api.example.com]
URL="${1:-}"
if [ -z "$URL" ]; then
  D="$(grep -m1 server_name /etc/nginx/conf.d/shule-api.conf 2>/dev/null | awk '{print $2}' | tr -d ';')"
  [ -n "$D" ] && URL="https://$D" || { echo "usage: speedtest.sh https://api.example.com"; exit 1; }
fi
ms() { awk -v t="$1" 'BEGIN { printf "%.1f", t * 1000 }'; }
echo "Testing $URL/health (5 separate requests, each opens a new connection):"
printf '%-4s %-9s %-9s %-9s %-12s %s\n' "#" "connect" "https" "reply" "server-only" "total"
for i in 1 2 3 4 5; do
  read -r c t s T < <(curl -s -o /dev/null -w '%{time_connect} %{time_appconnect} %{time_starttransfer} %{time_total}\n' "$URL/health")
  printf '%-4s %-9s %-9s %-9s %-12s %s\n' "$i" "$(ms "$c") ms" "$(ms "$t") ms" "$(ms "$s") ms" "$(awk -v a="$s" -v b="$t" 'BEGIN{printf "%.1f ms", (a-b)*1000}')" "$(ms "$T") ms"
done
echo
echo "Many requests on ONE connection (what the app does after the first one):"
curl -s -o /dev/null -w '%{time_total}\n' "$URL/health" "$URL/health" "$URL/health" "$URL/health" "$URL/health" "$URL/health" "$URL/health" "$URL/health" "$URL/health" "$URL/health" \
  | awk '{ s += $1; n++ } END { printf "average %.1f ms per request over %d requests\n", s / n * 1000, n }'
echo
echo "'server-only' is the time the server itself spent answering (nginx + the app)."
echo "From a phone, add the distance to the server: ping 161.97.98.107 from any ping app shows it."
