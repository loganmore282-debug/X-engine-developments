#!/usr/bin/env bash
# MOVE TO A NEW SERVER, step 1 of 3: a READ-ONLY report of what runs on THIS (old) server.
# It changes nothing and prints no password, key or connection string. Run it as root on the OLD server and send the output:
#     bash /srv/beer-src/beer/deploy/move/1-report.sh
set -u
[ "$(id -u)" = 0 ] || { echo "Run this as root."; exit 1; }
say() { printf '\n== %s\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }

say "1. Server"
. /etc/os-release 2>/dev/null; echo "system      : ${PRETTY_NAME:-unknown}  ($(uname -m))"
echo "address     : $(curl -4 -s --max-time 8 https://ifconfig.me 2>/dev/null || echo unknown)"
echo "processors  : $(nproc)    memory: $(free -m | awk '/^Mem:/{print $2" MB, used "$3" MB"}')    swap: $(free -m | awk '/^Swap:/{print $2" MB"}')"
echo "disk        : $(df -h / | awk 'NR==2{print $3" used of "$2}')"
echo "time zone   : $(timedatectl show -p Timezone --value 2>/dev/null || cat /etc/timezone 2>/dev/null)"

say "2. Programs"
echo "node        : $(node -v 2>/dev/null || echo MISSING)   at $(command -v node || echo -)"
echo "npm         : $(npm -v 2>/dev/null || echo MISSING)"
echo "pm2         : $(pm2 -v 2>/dev/null | tail -1 || echo MISSING)   at $(command -v pm2 || echo -)"
echo "nginx       : $(nginx -v 2>&1 | sed 's/^nginx version: //')"
echo "nginx parts : $(dpkg -l 2>/dev/null | awk '/^ii/ && ($2 ~ /^nginx/ || $2 ~ /^libnginx/){printf "%s ", $2}')"
echo "certbot     : $(certbot --version 2>/dev/null || echo MISSING)   at $(command -v certbot || echo -)"
echo "git         : $(git --version 2>/dev/null | awk '{print $3}')    rsync: $(have rsync && echo yes || echo NO)    ufw: $(have ufw && echo yes || echo NO)    fail2ban: $(have fail2ban-client && echo yes || echo NO)"
echo "database on this server (should be none): $(ss -ltnH 2>/dev/null | awk '{print $4}' | grep -E ':(27017|3306|5432|6379)$' | tr '\n' ' ')"

say "3. Apps kept running by pm2"
if have pm2; then
  pm2 jlist 2>/dev/null | node -e '
    let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
      let a = []; try { a = JSON.parse(s); } catch (e) { console.log("could not read the pm2 list"); return; }
      for (const p of a) { const e = p.pm2_env || {}, env = e.env || {};
        console.log([p.name, e.status, "port " + (env.PORT || e.PORT || "?"), "restarts " + e.restart_time, "memory " + Math.round(((p.monit || {}).memory || 0) / 1048576) + " MB", "folder " + (e.pm_cwd || "?")].join(" | ")); }
      console.log("total: " + a.length + " app(s)"); });'
  echo "starts by itself after a reboot: $(systemctl is-enabled pm2-root 2>/dev/null || echo no)"
fi

say "4. Folders in /srv"
for d in /srv/*; do [ -e "$d" ] || continue
  if [ -d "$d/.git" ]; then echo "$(du -sh "$d" 2>/dev/null | cut -f1) | $d | code, branch $(git -C "$d" rev-parse --abbrev-ref HEAD 2>/dev/null), from $(git -C "$d" remote get-url origin 2>/dev/null | sed -E 's#//[^@/]*@#//***@#')"
  else echo "$(du -sh "$d" 2>/dev/null | cut -f1) | $d | $(ls -A "$d" 2>/dev/null | wc -l) file(s): $(ls -A "$d" 2>/dev/null | tr '\n' ' ' | cut -c1-200)"; fi
done
echo "secret files inside the code folders: $(ls /srv/*-src/*/deploy/secrets.local.js 2>/dev/null | tr '\n' ' ')"

say "5. Databases the apps use (the cluster name only, never the password)"
for f in /srv/*-secrets/secrets.local.js /srv/*-src/*/deploy/secrets.local.js; do [ -f "$f" ] || continue
  node -e '
    let s = {}; try { s = require(process.argv[1]); } catch (e) { console.log(process.argv[1] + " | could not be read"); process.exit(0); }
    const u = String(s.MONGODB_URI || ""), m = /@([^/?]+)\/([^?]*)/.exec(u);
    console.log(process.argv[1] + " | " + (m ? "cluster " + m[1] + ", database " + (m[2] || "?") : "no database address") + " | port " + (s.PORT || "?") + " | settings: " + Object.keys(s).join(", "));' "$f"
done

say "6. Web addresses (nginx)"
for f in /etc/nginx/conf.d/*.conf /etc/nginx/sites-enabled/*; do [ -f "$f" ] || continue
  echo "$f : $(grep -hE '^\s*server_name' "$f" | sed -E 's/^\s*server_name\s+//; s/;.*$//' | tr ' ' '\n' | grep -v '^_$' | sort -u | tr '\n' ' ')"
done
echo "nginx.conf changed from the standard one: $(dpkg --verify nginx-common 2>/dev/null | grep -c 'nginx.conf' | sed 's/^0$/no/; s/^[1-9].*$/YES/')"
echo "nginx test: $(nginx -t 2>&1 | tail -1)"

say "7. Where each address points today"
MYIP=$(curl -4 -s --max-time 8 https://ifconfig.me 2>/dev/null)
grep -hE '^\s*server_name' /etc/nginx/conf.d/*.conf /etc/nginx/sites-enabled/* 2>/dev/null | sed -E 's/^\s*server_name\s+//; s/;.*$//' | tr ' ' '\n' | grep -E '\.' | grep -v '^\*' | sort -u | while read -r h; do
  ip=$(getent ahostsv4 "$h" 2>/dev/null | awk '{print $1; exit}')
  echo "$h -> ${ip:-no record}$([ "$ip" = "$MYIP" ] && echo '  (this server)' || echo '  (NOT this server)')"
done

say "8. HTTPS certificates"
if have certbot; then certbot certificates 2>/dev/null | grep -E 'Certificate Name|Domains|Expiry' | sed -E 's/^\s+//' | paste - - - 2>/dev/null; fi
echo "renewal settings: $(ls /etc/letsencrypt/renewal/*.conf 2>/dev/null | wc -l) file(s); automatic renewal: $( { systemctl is-enabled certbot.timer 2>/dev/null | grep -qx enabled && echo 'yes (certbot.timer)'; } || { systemctl is-enabled snap.certbot.renew.timer 2>/dev/null | grep -qx enabled && echo 'yes (snap)'; } || echo 'not found')"
echo "Hostinger DNS tokens saved for: $(ls /srv/*-secrets/hostinger.token 2>/dev/null | tr '\n' ' ')"

say "9. Timed jobs and extra services"
echo "root crontab:"; crontab -l 2>/dev/null | grep -vE '^\s*(#|$)' | sed 's/^/    /' | cut -c1-200; [ -n "$(crontab -l 2>/dev/null | grep -vE '^\s*(#|$)')" ] || echo "    (none)"
echo "files in /etc/cron.d: $(ls /etc/cron.d 2>/dev/null | tr '\n' ' ')"
echo "own services: $(find /etc/systemd/system -maxdepth 1 -type f -name '*.service' 2>/dev/null | xargs -r -n1 basename | tr '\n' ' ')"
echo "extra programs in /usr/local/bin: $(ls /usr/local/bin 2>/dev/null | tr '\n' ' ' | cut -c1-300)"

say "10. Firewall and bans"
have ufw && ufw status 2>/dev/null | sed 's/^/    /' | head -20
echo "fail2ban files: $(ls /etc/fail2ban/jail.d 2>/dev/null | tr '\n' ' ')$( [ -f /etc/fail2ban/jail.local ] && echo ' jail.local')"
echo "listening on the internet: $(ss -ltnH 2>/dev/null | awk '{print $4}' | grep -vE '^(127\.|\[::1\])' | sort -u | tr '\n' ' ')"

say "11. Other things that may hold the old address"
echo "ssh keys of root: $(ls /root/.ssh 2>/dev/null | grep -vE '^(authorized_keys|known_hosts.*)$' | tr '\n' ' ')    git sign-in file: $([ -f /root/.git-credentials ] && echo yes || echo no)"
echo "the old address written inside settings (file names only): $(grep -rlF "${MYIP:-0.0.0.0}" /etc/nginx /srv/*-secrets 2>/dev/null | tr '\n' ' ' | cut -c1-400)"
echo
echo "END OF REPORT. Nothing was changed. Copy everything above and send it."
