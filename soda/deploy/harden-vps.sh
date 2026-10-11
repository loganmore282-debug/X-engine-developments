#!/usr/bin/env bash
# Hardens the VPS that runs Soda: a firewall that lets only SSH/HTTP/HTTPS in, automatic bans for password guessing and scanning (fail2ban),
# automatic security updates, a locked-down secrets file, and a report of everything that is listening to the internet.
# Safe to run more than once. It never closes port 22 (you cannot lock yourself out) and it only removes the firewall holes that belong to
# Soda (3001 and 8090); it NEVER touches Petro's ports. Run as root:   bash /srv/soda-src/soda/deploy/harden-vps.sh
set -u
say() { printf '\n==> %s\n' "$*"; }
[ "$(id -u)" = 0 ] || { echo "Run this as root."; exit 1; }
SODA=${SODA_DIR:-/srv/soda-src/soda}
SECRETS=${SODA_SECRETS_DIR:-/srv/soda-secrets}
export DEBIAN_FRONTEND=noninteractive

say "1/6  Firewall (ufw): only SSH, HTTP and HTTPS may come in from outside"
apt-get install -y ufw >/dev/null 2>&1 || true
ufw allow 22/tcp >/dev/null          # SSH first, always, so enabling the firewall can never lock you out
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
for p in 3001 8090; do ufw delete allow "$p/tcp" >/dev/null 2>&1; ufw delete allow "$p" >/dev/null 2>&1; done   # Soda's own old holes
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw --force enable | tail -1
ufw status | sed 's/^/    /'

say "2/6  fail2ban: bans an address that guesses SSH passwords, scans the site or guesses the admin key"
apt-get install -y fail2ban >/dev/null 2>&1 || echo "    (could not install fail2ban: check your internet connection and run this again)"
if [ -d /etc/fail2ban ]; then
  for f in soda-probe soda-badua soda-adminlogin; do install -m 644 "$SODA/deploy/fail2ban/$f.conf" "/etc/fail2ban/filter.d/$f.conf"; done
  mkdir -p /etc/fail2ban/jail.d
  # keep a hand-edited ignoreip (your own address) when the file already exists
  if [ -f /etc/fail2ban/jail.d/soda.local ]; then
    OLDIGN=$(grep -E '^ignoreip' /etc/fail2ban/jail.d/soda.local | head -1)
    install -m 644 "$SODA/deploy/fail2ban/soda.local" /etc/fail2ban/jail.d/soda.local
    [ -n "$OLDIGN" ] && sed -i "0,/^ignoreip.*/s||$OLDIGN|" /etc/fail2ban/jail.d/soda.local
  else
    install -m 644 "$SODA/deploy/fail2ban/soda.local" /etc/fail2ban/jail.d/soda.local
  fi
  systemctl enable fail2ban >/dev/null 2>&1; systemctl restart fail2ban; sleep 2
  fail2ban-client status 2>/dev/null | sed 's/^/    /'
fi

say "3/6  Automatic security updates"
apt-get install -y unattended-upgrades >/dev/null 2>&1 || true
dpkg-reconfigure -f noninteractive unattended-upgrades >/dev/null 2>&1 || true
systemctl is-enabled unattended-upgrades 2>/dev/null | sed 's/^/    unattended-upgrades: /'

say "4/6  Secrets file: readable by root only"
if [ -d "$SECRETS" ]; then chmod 700 "$SECRETS"; chmod 600 "$SECRETS"/* 2>/dev/null; ls -ld "$SECRETS" "$SECRETS"/* | sed 's/^/    /'; else echo "    $SECRETS not found, skipped"; fi

say "5/6  What is listening on the internet (anything unexpected here deserves a question)"
ss -ltnH | awk '{print $4}' | sed 's/^/    /' | sort -u
echo "    Expected: :22 (SSH), :80, :443, and loopback-only (127.0.0.1) addresses for the apps."
echo "    Soda's own server must show 127.0.0.1:3001 (NOT 0.0.0.0:3001 or *:3001)."
ss -ltnH | awk '{print $4}' | grep -E '(^|:)3001$' | grep -vE '^(127\.0\.0\.1|\[::1\])' | sed 's/^/    WARNING: Soda is listening on /' | sed 's/$/ -- update the code (git pull) and reload pm2/'

say "6/6  Restart needed?"
if [ -f /var/run/reboot-required ]; then
  echo "    YES: a security update (the system said 'System restart required') only takes effect after a restart."
  echo "    Do it at a quiet time:  reboot      (about a minute; check afterwards that pm2 started the apps:  pm2 status)"
else echo "    No."; fi
if systemctl is-enabled pm2-root >/dev/null 2>&1; then echo "    pm2 starts the apps again after a reboot: yes"; else echo "    pm2 does NOT start by itself after a reboot yet. Run:  pm2 startup  (and the command it prints)  then  pm2 save"; fi
echo; echo "Done."
