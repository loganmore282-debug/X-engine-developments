#!/usr/bin/env bash
# READ-ONLY survey of the server. It changes nothing; it only prints what is
# already here, so you can see (and send me) what the setup would live next to:
#
#   sudo ./preflight.sh
set -uo pipefail
echo "== System"; . /etc/os-release; echo "$PRETTY_NAME  ($(uname -m))"
echo "RAM:  $(free -h | awk '/^Mem:/ {print $2" total, "$7" available"}')"
echo "Disk: $(df -h / | awk 'NR==2 {print $4" free of "$2}')"
echo
echo "== Listening ports (who is using what)"
ss -ltnpH 2>/dev/null | awk '{print $4"  "$6}' | sed 's/users:((//; s/))//' | sort -u
echo
echo "== Web server"
for p in 80 443; do
  o="$(ss -ltnpH "( sport = :$p )" 2>/dev/null | grep -o '"[^"]*"' | head -1)"
  echo "port $p: ${o:-free}"
done
command -v nginx >/dev/null && { echo "nginx: installed"; ls /etc/nginx/sites-enabled 2>/dev/null | sed 's/^/  site: /'; ls /etc/nginx/conf.d 2>/dev/null | sed 's/^/  conf.d: /'; } || echo "nginx: not installed"
echo
echo "== Runtimes"
command -v node >/dev/null && echo "node: $(node -v)  npm: $(npm -v 2>/dev/null || echo none)" || echo "node: not installed"
command -v pm2 >/dev/null && { echo "pm2 processes:"; pm2 jlist 2>/dev/null | python3 -c "import sys,json;[print('  ',p['name'],p['pm2_env']['status']) for p in json.load(sys.stdin)]" 2>/dev/null; }
command -v docker >/dev/null && { echo "docker containers:"; docker ps --format '  {{.Names}}  {{.Ports}}' 2>/dev/null; }
echo
echo "== MongoDB"
command -v mongod >/dev/null && echo "mongod binary: $(mongod --version 2>/dev/null | head -1)" || echo "mongod binary: none"
systemctl list-units --type=service --all 2>/dev/null | grep -i mongo | sed 's/^/  /' || true
echo
echo "== Firewall"
command -v ufw >/dev/null && ufw status | head -12 || echo "ufw: not installed"
echo
echo "== systemd services you run (non-system)"
systemctl list-units --type=service --state=running --no-legend 2>/dev/null | awk '{print $1}' | grep -vE '^(systemd|dbus|ssh|cron|rsyslog|getty|serial|user@|polkit|multipathd|udisks|unattended|networkd|resolved|ModemManager|snapd|chrony|qemu|irqbalance|packagekit|accounts|fwupd|lvm|apparmor|ufw|cloud|containerd|nginx|apache|fail2ban|atd|open-vm|haveged|rsyslogd|thermald)' | sed 's/^/  /'
