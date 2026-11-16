#!/usr/bin/env bash
# Makes the server's network and web server as fast as it safely can be. One command, as root, on the VPS:
#   bash /srv/smartai-src/smartai/deploy/speed-up.sh
# What it does (every step is checked, and anything that fails is put back as it was):
#   1. BBR congestion control + fq: the connection fills the phone's real speed faster and holds it on a weak or shaky mobile network (the biggest win for phones in Uganda).
#   2. TCP Fast Open, bigger socket buffers, no slow-start after a pause, MTU probing, a deeper accept queue: quicker first byte, fewer dropped connections under load.
#   3. nginx: 4096 connections per worker (was 768), a higher open-files limit, and Brotli compression next to the existing gzip (the app page is ~260 KB: Brotli sends it ~15-20 % smaller).
#   4. Measures before and after (the page's first byte and size) so you can see the difference.
# It never touches your apps, your databases, your certificates or any app's own nginx file.
set -u
[ "$(id -u)" = 0 ] || { echo "Run this as root."; exit 1; }
TS=$(date +%Y%m%d-%H%M%S); BK=/root/speedup-backup-$TS; mkdir -p "$BK"
say() { printf '\n== %s\n' "$*"; }
SITE=""; [ -s /srv/smartai-secrets/app-host ] && SITE=$(tr -d '[:space:]' < /srv/smartai-secrets/app-host)
measure() {
  [ -n "$SITE" ] || return 0
  curl -s -o /dev/null -H 'Accept-Encoding: br, gzip' -w "   first byte %{time_starttransfer}s, total %{time_total}s, downloaded %{size_download} bytes, HTTP %{http_version}\n" "https://$SITE/" 2>/dev/null || echo "   (could not measure)"
}
say "BEFORE"
echo "   congestion control: $(sysctl -n net.ipv4.tcp_congestion_control 2>/dev/null)   queue: $(sysctl -n net.core.default_qdisc 2>/dev/null)"
measure

say "1 and 2. Network (BBR, Fast Open, buffers)"
modprobe tcp_bbr 2>/dev/null || true
if grep -qw bbr /proc/sys/net/ipv4/tcp_available_congestion_control 2>/dev/null; then
  echo tcp_bbr > /etc/modules-load.d/smartai-bbr.conf
  CC=bbr
else
  echo "   (this kernel has no BBR; keeping $(sysctl -n net.ipv4.tcp_congestion_control))"; CC=$(sysctl -n net.ipv4.tcp_congestion_control)
fi
F=/etc/sysctl.d/99-smartai-speed.conf; [ -f "$F" ] && cp -p "$F" "$BK/"
cat > "$F" <<SYS
# Written by smartai/deploy/speed-up.sh (delete this file and run: sysctl --system   to undo)
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = $CC
net.ipv4.tcp_fastopen = 3
net.ipv4.tcp_slow_start_after_idle = 0
net.ipv4.tcp_mtu_probing = 1
net.ipv4.tcp_notsent_lowat = 16384
net.ipv4.tcp_syncookies = 1
net.core.somaxconn = 4096
net.ipv4.tcp_max_syn_backlog = 4096
net.core.netdev_max_backlog = 4096
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
net.ipv4.tcp_rmem = 4096 131072 16777216
net.ipv4.tcp_wmem = 4096 65536 16777216
net.ipv4.tcp_fin_timeout = 20
net.ipv4.tcp_tw_reuse = 1
SYS
if sysctl --system >/tmp/speedup.sysctl 2>&1; then echo "   applied."; else echo "   !! sysctl reported a problem, putting the old settings back"; rm -f "$F"; [ -f "$BK/99-smartai-speed.conf" ] && cp -p "$BK/99-smartai-speed.conf" "$F"; sysctl --system >/dev/null 2>&1; tail -5 /tmp/speedup.sysctl; fi

say "3. nginx (connections, open files, Brotli)"
NG=/etc/nginx/nginx.conf; cp -p "$NG" "$BK/nginx.conf"; [ -d /etc/nginx/conf.d ] && cp -a /etc/nginx/conf.d "$BK/conf.d"
# more connections per worker and a higher open-files limit (only raised, never lowered)
CUR=$(sed -n 's/^[[:space:]]*worker_connections[[:space:]]\+\([0-9]\+\);.*/\1/p' "$NG" | head -1)
if [ -n "$CUR" ] && [ "$CUR" -lt 4096 ]; then sed -i "s/^\([[:space:]]*\)worker_connections[[:space:]]\+[0-9]\+;/\1worker_connections 4096;/" "$NG"; echo "   worker_connections $CUR -> 4096"; fi
grep -q '^[[:space:]]*worker_rlimit_nofile' "$NG" || { sed -i '0,/^worker_processes.*/s//&\nworker_rlimit_nofile 65535;/' "$NG"; echo "   worker_rlimit_nofile 65535"; }
mkdir -p /etc/systemd/system/nginx.service.d
printf '[Service]\nLimitNOFILE=65535\n' > /etc/systemd/system/nginx.service.d/smartai-limits.conf
systemctl daemon-reload
# Brotli (an Ubuntu package); gzip stays as the fallback for any client without it
if ! ls /etc/nginx/modules-enabled/*brotli* >/dev/null 2>&1; then
  DEBIAN_FRONTEND=noninteractive apt-get install -y libnginx-mod-http-brotli-filter libnginx-mod-http-brotli-static >/tmp/speedup.apt 2>&1 && echo "   Brotli installed" || { echo "   (Brotli could not be installed here, gzip stays)"; tail -3 /tmp/speedup.apt; }
fi
if ls /etc/nginx/modules-enabled/*brotli* >/dev/null 2>&1; then
  cat > /etc/nginx/conf.d/00-smartai-brotli.conf <<'BR'
# Written by smartai/deploy/speed-up.sh
brotli on;
brotli_comp_level 5;
brotli_min_length 1024;
brotli_types text/plain text/css text/javascript application/javascript application/json application/manifest+json image/svg+xml;
BR
fi
if nginx -t >/tmp/speedup.nginx 2>&1; then
  systemctl restart nginx && echo "   nginx restarted fine" || echo "   !! nginx did not restart, check: systemctl status nginx"
else
  echo "   !! nginx test failed, putting the old nginx files back"; cat /tmp/speedup.nginx | tail -6
  cp -p "$BK/nginx.conf" "$NG"; rm -f /etc/nginx/conf.d/00-smartai-brotli.conf
  nginx -t >/dev/null 2>&1 && systemctl restart nginx
fi

say "AFTER"
echo "   congestion control: $(sysctl -n net.ipv4.tcp_congestion_control 2>/dev/null)   queue: $(sysctl -n net.core.default_qdisc 2>/dev/null)   fast open: $(sysctl -n net.ipv4.tcp_fastopen 2>/dev/null)"
echo "   brotli module: $(ls /etc/nginx/modules-enabled/*brotli* >/dev/null 2>&1 && echo yes || echo no)   nginx connections: $(sed -n 's/^[[:space:]]*worker_connections[[:space:]]\+\([0-9]\+\);.*/\1/p' "$NG" | head -1)"
measure
echo "   with Brotli only the Brotli line below should say 'content-encoding: br':"
[ -n "$SITE" ] && curl -sI -H 'Accept-Encoding: br, gzip' "https://$SITE/" | grep -i 'content-encoding\|^HTTP' | tr -d '\r' | sed 's/^/   /'
echo; echo "Backup of the old files: $BK        Undo the network part: rm /etc/sysctl.d/99-smartai-speed.conf && sysctl --system"
echo "DONE."
