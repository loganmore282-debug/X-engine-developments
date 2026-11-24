#!/usr/bin/env bash
# One-time speed tuning for this VPS (all apps share it). Safe to run again; every change can be undone (printed at the end).
#   bash /srv/potato-src/potato/deploy/speed-boost.sh          apply
#   bash /srv/potato-src/potato/deploy/speed-boost.sh --dry    only show what it would do
# 1. Network (kernel): BBR congestion control + fq queue (much better throughput on the long, lossy mobile paths to Africa), TCP Fast Open,
#    no slow-start restart after idle, bigger queues. Only applied if this kernel supports them.
# 2. nginx (http level): sendfile/tcp_nopush/tcp_nodelay, long keep-alive, open-file cache, reset of dead connections. Only the directives that
#    are not already set somewhere in your nginx config are added, then `nginx -t` must pass or the file is removed again.
set -u
DRY=0; [ "${1:-}" = "--dry" ] && DRY=1
[ "$DRY" = 1 ] || [ "$(id -u)" = 0 ] || { echo "Run this as root."; exit 1; }
say() { echo; echo "== $*"; }
SYS=/etc/sysctl.d/99-speed.conf; NG=/etc/nginx/conf.d/00-speed.conf
say "1/2  Network (kernel)"
echo "now: congestion=$(sysctl -n net.ipv4.tcp_congestion_control 2>/dev/null)  qdisc=$(sysctl -n net.core.default_qdisc 2>/dev/null)  kernel=$(uname -r)"
[ "$DRY" = 1 ] || modprobe tcp_bbr 2>/dev/null
AVAIL=$(sysctl -n net.ipv4.tcp_available_congestion_control 2>/dev/null)
LINES=""
case " $AVAIL " in *" bbr "*) LINES="$LINES
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = bbr" ;; *) echo "BBR is not available on this kernel (available: ${AVAIL:-none}); skipping it." ;; esac
LINES="$LINES
net.ipv4.tcp_fastopen = 3
net.ipv4.tcp_slow_start_after_idle = 0
net.ipv4.tcp_notsent_lowat = 16384
net.core.somaxconn = 4096
net.core.netdev_max_backlog = 8192
net.ipv4.tcp_max_syn_backlog = 8192
net.ipv4.tcp_mtu_probing = 1"
echo "will write $SYS:"; echo "$LINES" | sed '/^$/d;s/^/    /'
if [ "$DRY" = 0 ]; then printf '# written by speed-boost.sh\n%s\n' "$LINES" | sed '/^$/d' > "$SYS"; sysctl --system >/dev/null 2>&1; echo "now: congestion=$(sysctl -n net.ipv4.tcp_congestion_control 2>/dev/null)  qdisc=$(sysctl -n net.core.default_qdisc 2>/dev/null)"; fi
say "2/2  nginx"
if ! command -v nginx >/dev/null 2>&1; then echo "nginx is not installed here; skipping."; else
  ALL=$(nginx -T 2>/dev/null | grep -vE '^\s*#' )
  has() { echo "$ALL" | grep -Eq "^\s*$1[[:space:]]"; }
  OUT=""
  add() { if has "$1"; then echo "    already set somewhere: $1"; else OUT="$OUT
    $1 $2;"; fi; }
  add sendfile on
  add tcp_nopush on
  add tcp_nodelay on
  add keepalive_timeout 75s
  add keepalive_requests 1000
  add reset_timedout_connection on
  add open_file_cache "max=5000 inactive=60s"
  add open_file_cache_valid 60s
  add open_file_cache_min_uses 1
  add open_file_cache_errors on
  if [ -z "$(echo "$OUT" | tr -d ' \n')" ]; then echo "nothing to add: nginx already has all of these."; else
    echo "will write $NG:"; echo "$OUT" | sed '/^$/d;s/^/  /'
    if [ "$DRY" = 0 ]; then
      printf '# written by speed-boost.sh (http level)\n%s\n' "$OUT" | sed '/^$/d' > "$NG"
      if nginx -t >/tmp/speed-boost.nginx 2>&1; then systemctl reload nginx && echo "nginx reloaded."; else echo "nginx refused the file, removing it:"; tail -3 /tmp/speed-boost.nginx; rm -f "$NG"; fi
    fi
  fi
  echo "nginx: $(nginx -v 2>&1)   http2 on all sites: $(grep -rl 'http2' /etc/nginx/conf.d 2>/dev/null | wc -l) file(s)   http3: $(nginx -V 2>&1 | grep -c http_v3)   brotli: $(nginx -V 2>&1 | grep -c brotli)"
fi
echo; echo "Done. To undo:  rm -f $SYS $NG && sysctl --system >/dev/null && systemctl reload nginx"
