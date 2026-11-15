#!/usr/bin/env bash
# MOVE EVERYTHING from THIS (old) server to a NEW server with ONE command. Run it as root on the OLD server:
#
#   bash /srv/beer-src/beer/deploy/move/migrate.sh NEW_SERVER_ADDRESS            the whole move (asks the new server's root password once, and one YES before the switch)
#   bash /srv/beer-src/beer/deploy/move/migrate.sh NEW_SERVER_ADDRESS back       undo: apps and DNS go back to this old server
#   bash /srv/beer-src/beer/deploy/move/migrate.sh NEW_SERVER_ADDRESS finish     when all is well for some days: removes this server's key from the new one
#   bash /srv/beer-src/beer/deploy/move/migrate.sh NEW_SERVER_ADDRESS status     where things stand
#
# What it does, in order. Until the question "SWITCH" nothing changes for your members (this server keeps serving as normal):
#   1 connects to the new server (password once, then a key)           2 lowers the DNS timer so the switch is quick
#   3 installs the same programs on the new server (node, pm2, nginx, certbot, firewall, fail2ban ...)
#   4 copies /srv (all apps, their secrets), nginx, HTTPS certificates, pm2 list, cron, firewall rules, fail2ban, ssh deploy key
#   5 checks the new server can reach every app's MongoDB (Atlas must allow its address) and that nginx accepts the copied files
#   6 asks you to type SWITCH. Then: stops the apps HERE, syncs the last changes, starts them THERE, checks every app answers, checks every web address
#     through the new server, moves the DNS records, and puts everything back by itself if an app does not come up.
# The same app NEVER runs on both servers (their money locks live inside one process). Run the command again any time: copying is incremental.
# It runs inside "screen": if your phone connection drops, log in again and type:  screen -r migrate
set -u
NEW="${1:-}"; MODE="${2:-move}"
usage() { echo "Usage:  bash $0 NEW_SERVER_ADDRESS [back|finish|status]     (e.g.  bash $0 161.97.98.107)"; exit 1; }
[ "$(id -u)" = 0 ] || { echo "Run this as root."; exit 1; }
printf '%s' "$NEW" | grep -Eq '^[0-9]{1,3}(\.[0-9]{1,3}){3}$' || usage
case "$MODE" in move|back|finish|status) ;; *) usage ;; esac
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SELF="$HERE/$(basename "${BASH_SOURCE[0]}")"

# ---- run inside screen so a dropped connection cannot stop a half-finished copy ----
if [ -z "${STY:-}" ] && [ -z "${MIGRATE_NO_SCREEN:-}" ] && [ -t 0 ]; then
  command -v screen >/dev/null 2>&1 || { DEBIAN_FRONTEND=noninteractive apt-get install -y -qq screen >/dev/null 2>&1; }
  if command -v screen >/dev/null 2>&1; then
    if screen -ls 2>/dev/null | grep -q '\.migrate[[:space:]]'; then echo "A move is already running here. Reconnect to it with:   screen -r migrate"; exit 1; fi
    exec screen -S migrate bash "$SELF" "$@"
  fi
fi

STATE=/root/.migrate-state; LOG=/root/migrate.log
exec > >(tee -a "$LOG") 2>&1
KEY=/root/.ssh/migrate_key; KNOWN=/root/.ssh/migrate_known_hosts
SSHOPTS="-p ${MIGRATE_SSH_PORT:-22} -i $KEY -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=$KNOWN -o ServerAliveInterval=30 -o ServerAliveCountMax=40 -o ConnectTimeout=20"
R() { ssh -n $SSHOPTS "root@$NEW" "$@"; }        # no input (never swallows the keyboard or a list read by a loop)
RI() { ssh $SSHOPTS "root@$NEW" "$@"; }       # reads what is piped in
RS() { rsync -aH --numeric-ids -e "ssh $SSHOPTS" "$@"; }
# where a check runs: old = here, new = over ssh
WHERE=old
X() { if [ "$WHERE" = new ]; then R "$@"; else bash -c "$*"; fi; }
say()  { printf '\n==> %s\n' "$*"; }
note() { printf '    %s\n' "$*"; }
warn() { printf '    !! %s\n' "$*"; }
fail() { printf '\n!! %s\n' "$*"; exit 1; }
ask()  { local a; printf '%s' "$1" >/dev/tty; IFS= read -r a </dev/tty; printf '%s' "$a" | tr -d '[:space:]' | tr '[:lower:]' '[:upper:]'; }   # spaces and letter case ignored (phone keyboards add a space after a word)
asks() { local a; printf '%s' "$1" >/dev/tty; IFS= read -r -s a </dev/tty; printf '\n' >/dev/tty; printf '%s' "$a"; }
st_get() { sed -n "s/^$1=//p" "$STATE" 2>/dev/null | tail -1; }
st_set() { (umask 077; touch "$STATE"; { grep -v "^$1=" "$STATE" 2>/dev/null; printf '%s=%s\n' "$1" "$2"; } > "$STATE.t"; mv "$STATE.t" "$STATE"); }
trap '[ -n "${STY:-}" ] && { printf "\n(the log is saved in %s)  Press Enter to close this screen: " "$LOG" >/dev/tty; read -r _ </dev/tty; }' EXIT

NODE=$(command -v node) || fail "node is not installed on this server."
export DEBIAN_FRONTEND=noninteractive
OLDIP=$(curl -4 -s --max-time 8 https://ifconfig.me 2>/dev/null); printf '%s' "$OLDIP" | grep -Eq '^[0-9]{1,3}(\.[0-9]{1,3}){3}$' || OLDIP=$(curl -4 -s --max-time 8 https://icanhazip.com 2>/dev/null | tr -d '[:space:]')
printf '%s' "$OLDIP" | grep -Eq '^[0-9]{1,3}(\.[0-9]{1,3}){3}$' || OLDIP=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src") print $(i+1)}' | head -1)
[ -n "$OLDIP" ] || fail "could not find this server's own address."
[ "$OLDIP" != "$NEW" ] || fail "$NEW is THIS server. Give the address of the NEW server."
HOSTS=/root/migrate-hosts.txt; BACKUP=/root/migrate-dns-backup.json
TOKENS=$(ls /srv/*-secrets/hostinger.token /srv/*/hostinger.token /srv/*-src/*/deploy/hostinger.token 2>/dev/null | sort -u | paste -sd, -)
OLD6=$(ip -6 -o addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | paste -sd, -)
DNSM() { "$NODE" "$HERE/dns-move.js" "$1" --old "$OLDIP" --new "$NEW" --hosts "$HOSTS" --tokens "$TOKENS" --old6 "$OLD6" --backup "$BACKUP" "${@:2}"; }
RT=/root/migrate-tools      # the helper scripts, copied to the new server in step 3
tools() { if [ "$WHERE" = new ]; then echo "$RT"; else echo "$HERE"; fi; }
pm2apps() { X "pm2 jlist 2>/dev/null | node $(tools)/pm2-list.js"; }
bad_code() { case "$1" in 000|5??) return 0 ;; *) return 1 ;; esac; }

echo "Move  $OLDIP (old, this server)  ->  $NEW (new)        $(date '+%Y-%m-%d %H:%M')"

# =====================================================================  status / finish
if [ "$MODE" = status ]; then
  say "State"; cat "$STATE" 2>/dev/null | sed 's/^/    /' || note "(nothing yet)"
  say "Apps here (old)"; WHERE=old; pm2apps | sed 's/^/    /'
  say "Apps there (new)"; WHERE=new; pm2apps | sed 's/^/    /' || note "cannot reach the new server"
  exit 0
fi
if [ "$MODE" = finish ]; then
  R "sed -i '/migrate-from-old/d' /root/.ssh/authorized_keys" && note "this server's key is removed from $NEW" || warn "could not remove the key"
  st_set FINISHED yes; echo "Done. Cancel the old server at the provider only when you are sure you do not need it (keep it a few days)."; exit 0
fi

# =====================================================================  back
if [ "$MODE" = back ]; then
  say "Putting everything back on this old server"
  [ "$(st_get SWITCHED)" = yes ] || fail "the switch was never done (nothing to undo)."
  ONLINE=$(st_get ONLINE)
  WHERE=new; for n in $ONLINE; do R "pm2 stop $n >/dev/null 2>&1"; done; R "systemctl disable pm2-root >/dev/null 2>&1"; note "apps stopped on $NEW (and they will not start by themselves there)"
  systemctl enable --now cron >/dev/null 2>&1; systemctl enable pm2-root >/dev/null 2>&1
  for n in $ONLINE; do pm2 start "$n" >/dev/null 2>&1 || warn "could not start $n here"; done; pm2 save --force >/dev/null 2>&1
  WHERE=old; sleep 15; pm2apps | sed 's/^/    here: /'
  if [ -f "$BACKUP" ]; then DNSM back; else warn "no DNS backup file ($BACKUP): change the records back by hand"; fi
  st_set SWITCHED no; echo; echo "Back on the old server. DNS answers return as the timers (300 seconds) run out."; exit 0
fi

# =====================================================================  the move
[ "$(st_get SWITCHED)" = yes ] && fail "this move was already switched. To check:  bash $SELF $NEW status      To undo:  bash $SELF $NEW back"
WHERE=old
ONLINE=$(pm2apps | awk -F'|' '$2=="online"{print $1}' | tr '\n' ' ')
[ -n "${ONLINE// /}" ] || fail "no app is running under pm2 on this server (is this the old server?)."
note "apps running here: $ONLINE"
[ "$(uname -m)" = x86_64 ] || [ "$(uname -m)" = aarch64 ] || fail "unexpected processor type $(uname -m)."

say "1/7  Tools and the connection to the new server"
for p in rsync sshpass screen curl; do command -v "$p" >/dev/null 2>&1 || { note "installing $p here"; apt-get install -y -qq "$p" >/dev/null 2>&1; }; done
command -v rsync >/dev/null && command -v sshpass >/dev/null || fail "could not install rsync / sshpass on this server."
[ -f "$KEY" ] || ssh-keygen -q -t ed25519 -N '' -f "$KEY" -C migrate-from-old
if ! R true 2>/dev/null; then
  note "the new server needs its root password once (the one you chose when ordering; nothing is shown as you type)"
  for try in 1 2 3; do
    SSHPASS=$(asks "    Root password of $NEW: " | tr -d '\r\n'); export SSHPASS
    sshpass -e ssh -p "${MIGRATE_SSH_PORT:-22}" -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile="$KNOWN" -o PreferredAuthentications=password -o PubkeyAuthentication=no -o ConnectTimeout=20 \
      "root@$NEW" 'umask 077; mkdir -p ~/.ssh; cat >> ~/.ssh/authorized_keys' < "$KEY.pub"; rc=$?
    unset SSHPASS
    [ $rc = 0 ] && break
    case $rc in 5) warn "wrong password, try again" ;; 255) warn "could not connect to $NEW (is it finished starting? wait 5 minutes and run this again)"; exit 1 ;; *) warn "login failed (code $rc)" ;; esac
    [ $try = 3 ] && fail "no access to the new server."
  done
  R true 2>/dev/null || fail "the key was not accepted by the new server."
fi
note "connected to $NEW"
NEWARCH=$(R uname -m); [ "$NEWARCH" = "$(uname -m)" ] || fail "the new server is $NEWARCH, this one is $(uname -m): the move would not work."
R 'grep -q "^ID=ubuntu" /etc/os-release' && note "new server: $(R '. /etc/os-release; echo $PRETTY_NAME')" || warn "the new server is not Ubuntu (the script expects Ubuntu 24.04)"
NEEDMB=$(( $(du -sm /srv 2>/dev/null | cut -f1) * 13 / 10 + 2000 )); HAVEMB=$(R "df -m --output=avail / | tail -1" | tr -d ' ')
[ "${HAVEMB:-0}" -gt "$NEEDMB" ] || fail "the new server has ${HAVEMB} MB free but about ${NEEDMB} MB are needed."
note "disk space on the new server: ${HAVEMB} MB free (needs about ${NEEDMB} MB)"

say "2/7  DNS timer (so that the switch takes minutes, not hours)"
grep -rhoE '(^|[[:space:]{;])server_name[[:space:]]+[^;]+' /etc/nginx/conf.d /etc/nginx/sites-enabled 2>/dev/null | sed -E 's/^.*server_name[[:space:]]+//' | tr -s ' \t' '\n\n' | grep '\.' | grep -v '^\*' | grep -vE '^[0-9.]+$' | sort -u > "$HOSTS"
note "web addresses served here: $(wc -l < "$HOSTS")"
DNSM plan | grep -v '^MAXTTL=' | sed 's/^/    /'
if [ -z "$(st_get TTL_AT)" ] || [ "$(st_get MAXTTL)" = 0 ]; then
  OUT=$(DNSM ttl); rc=$?; echo "$OUT" | grep -E '^(timer|zones)' | sed 's/^/    /'
  MAXTTL=$(echo "$OUT" | sed -n 's/^MAXTTL=//p' | tail -1)
  if [ $rc = 1 ]; then warn "could not lower the DNS timer (the move still works, but the switch may take longer to reach everyone)"; st_set TTL_AT "$(date +%s)"; st_set MAXTTL "${MAXTTL:-14400}"
  elif echo "$OUT" | grep -q '^timer '; then st_set TTL_AT "$(date +%s)"; st_set MAXTTL "${MAXTTL:-0}"; fi
  if echo "$OUT" | grep -q '^timer '; then note "timer lowered to 300 seconds (it was up to ${MAXTTL:-0} seconds, so members who looked the address up before may keep the old answer that long)"; else note "no DNS record to lower (the DNS is not at Hostinger, or no token was found): the DNS must be changed by hand at the switch"; fi
else note "timer already lowered earlier"; fi

say "3/7  Installing the same programs on the new server"
NODE_V=$(node -v); PM2_V=$(pm2 -v 2>/dev/null | tail -1)
NGX=$(dpkg -l 2>/dev/null | awk '/^ii/ && ($2 ~ /^nginx/ || $2 ~ /^libnginx/){printf "%s ", $2}'); [ -n "$NGX" ] || NGX=nginx
CERT_APT=$(dpkg -l 2>/dev/null | awk '/^ii/ && $2 ~ /certbot/{printf "%s ", $2}')
CERT_SNAP=$(snap list 2>/dev/null | awk 'NR>1 && $1=="certbot"{print "yes"}')
[ -n "$CERT_APT$CERT_SNAP" ] || warn "certbot was not found on this server: HTTPS certificates are copied, but renewal needs certbot on the new one"
{ printf 'NODE_V=%q\nPM2_V=%q\nTZONE=%q\nNGX=%q\nCERT_APT=%q\nCERT_SNAP=%q\nOLD_NODE=%q\nOLD_PM2=%q\n' \
    "$NODE_V" "$PM2_V" "$(timedatectl show -p Timezone --value 2>/dev/null || cat /etc/timezone 2>/dev/null)" "$NGX" "$CERT_APT" "$CERT_SNAP" "$(command -v node)" "$(command -v pm2)"
  cat <<'EOS'
set -u
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a
APT="apt-get -o DPkg::Lock::Timeout=900 -y -qq"
for i in 1 2 3 4 5 6; do $APT update >/dev/null 2>&1 && break; sleep 10; done
echo "    installing packages (a few minutes)"
$APT install git rsync curl ca-certificates ufw fail2ban unattended-upgrades logrotate cron xz-utils $NGX $CERT_APT >/tmp/migrate-apt.log 2>&1 || { tail -8 /tmp/migrate-apt.log; echo "package install failed"; exit 1; }
if [ -n "$CERT_SNAP" ]; then $APT install snapd >/dev/null 2>&1; snap install core >/dev/null 2>&1; snap install --classic certbot >/dev/null 2>&1; ln -sf /snap/bin/certbot /usr/bin/certbot; fi
case "$(uname -m)" in x86_64) A=x64 ;; aarch64) A=arm64 ;; *) echo "unknown processor"; exit 1 ;; esac
if [ "$(/usr/local/bin/node -v 2>/dev/null)" != "$NODE_V" ]; then
  echo "    installing node $NODE_V (the same version as the old server)"
  curl -fsSL "https://nodejs.org/dist/$NODE_V/node-$NODE_V-linux-$A.tar.xz" | tar -xJ -C /usr/local --strip-components=1 --exclude='*/CHANGELOG.md' --exclude='*/LICENSE' --exclude='*/README.md' || { echo "node download failed"; exit 1; }
fi
hash -r
for t in node npm npx; do [ -e "/usr/bin/$t" ] || ln -s "/usr/local/bin/$t" "/usr/bin/$t"; done
if [ "$(pm2 -v 2>/dev/null | tail -1)" != "$PM2_V" ]; then echo "    installing pm2 $PM2_V"; npm install -g "pm2@$PM2_V" --no-audit --no-fund >/tmp/migrate-npm.log 2>&1 || { tail -5 /tmp/migrate-npm.log; echo "pm2 install failed"; exit 1; }; fi
[ -e /usr/bin/pm2 ] || ln -s "$(command -v pm2)" /usr/bin/pm2
[ -n "$TZONE" ] && timedatectl set-timezone "$TZONE" 2>/dev/null
pm2 startup systemd -u root --hp /root >/dev/null 2>&1; systemctl enable pm2-root >/dev/null 2>&1
echo "    node $(node -v), pm2 $(pm2 -v | tail -1), $(nginx -v 2>&1 | sed 's/nginx version: //'), $(command -v certbot >/dev/null && certbot --version 2>&1 | tail -1 || echo no certbot)"
EOS
} | RI bash -s || fail "installing on the new server failed (lines above)."

R "mkdir -p $RT" && RS "$HERE/" "root@$NEW:$RT/" || fail "could not copy the helper scripts to the new server."

say "4/7  Copying everything (the apps here keep running)"
rs_check() { local rc=$1 what=$2; [ "$rc" = 0 ] || [ "$rc" = 24 ] || fail "copying $what failed (rsync code $rc)."; }
pm2 save --force >/dev/null 2>&1
note "/srv (apps, secrets, packages)"
RS --stats /srv/ "root@$NEW:/srv/" | grep -E 'Number of (regular )?files transferred|Total transferred file size' | sed 's/^/      /'; rs_check "${PIPESTATUS[0]}" /srv
note "nginx, HTTPS certificates, web files"
RS --delete /etc/nginx/ "root@$NEW:/etc/nginx/"; rs_check $? nginx
if [ -d /etc/letsencrypt ]; then RS --delete /etc/letsencrypt/ "root@$NEW:/etc/letsencrypt/"; rs_check $? certificates; else warn "no /etc/letsencrypt here (no HTTPS certificates to copy)"; fi
[ -d /var/www ] && { RS /var/www/ "root@$NEW:/var/www/"; rs_check $? /var/www; }
note "ssh deploy key, pm2 list, cron, firewall, fail2ban, services"
RS --exclude authorized_keys --exclude 'known_hosts*' --exclude 'migrate_*' /root/.ssh/ "root@$NEW:/root/.ssh/"; rs_check $? ssh-keys
R 'mkdir -p /root/.pm2'
for f in dump.pm2 module_conf.json; do [ -f "/root/.pm2/$f" ] && { RS "/root/.pm2/$f" "root@$NEW:/root/.pm2/$f"; rs_check $? "pm2 $f"; }; done
for m in /root/.pm2/modules/*; do [ -d "$m" ] || continue; m=$(basename "$m"); R "pm2 install $m >/dev/null 2>&1" && note "pm2 module $m installed there"; done
if crontab -l 2>/dev/null | grep -qvE '^\s*(#|$)'; then crontab -l | RI 'crontab -' && note "crontab copied"; fi
[ -d /usr/local/lib/node_modules ] && { RS --ignore-existing --exclude /pm2 --exclude /npm --exclude /corepack /usr/local/lib/node_modules/ "root@$NEW:/usr/local/lib/node_modules/"; rs_check $? "global npm packages"; }
for d in /etc/cron.d /etc/logrotate.d /etc/sysctl.d /usr/local/bin /etc/fail2ban/filter.d /etc/fail2ban/action.d; do [ -d "$d" ] && { RS --ignore-existing "$d/" "root@$NEW:$d/"; rs_check $? "$d"; }; done
[ -d /etc/fail2ban/jail.d ] && RS /etc/fail2ban/jail.d/ "root@$NEW:/etc/fail2ban/jail.d/"; [ -f /etc/fail2ban/jail.local ] && RS /etc/fail2ban/jail.local "root@$NEW:/etc/fail2ban/jail.local"
find /etc/systemd/system -maxdepth 1 -type f \( -name '*.service' -o -name '*.timer' \) ! -name 'pm2-root.service' 2>/dev/null | while read -r u; do
  RS "$u" "root@$NEW:$u" </dev/null && { b=$(basename "$u"); note "own service $b copied"; systemctl is-enabled "$b" >/dev/null 2>&1 && R "systemctl daemon-reload; systemctl enable $b >/dev/null 2>&1"; }
done
# the old address written inside nginx files (e.g. the "by address" site) -> the new address, on the NEW server only
R "grep -rlF '$OLDIP' /etc/nginx 2>/dev/null | xargs -r sed -i 's/$OLDIP/$NEW/g'"
OTHER=$(grep -rlF "$OLDIP" /srv/*-secrets /srv/*-src/*/deploy/secrets.local.js 2>/dev/null | tr '\n' ' '); [ -n "$OTHER" ] && warn "the old address is written in these settings files (check them by hand): $OTHER"
# the firewall: same rules as here (22, 80 and 443 always)
{ echo 'ufw allow 22/tcp >/dev/null'; ufw show added 2>/dev/null | grep '^ufw ' | sed 's#$# >/dev/null#'; echo 'ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw default deny incoming >/dev/null; ufw default allow outgoing >/dev/null; ufw --force enable | tail -1'; } | RI bash -s | sed 's/^/    firewall: /'
# fail2ban refuses to start when a log file named in a jail does not exist yet: create the empty files first
R 'for f in $(grep -rhE "^[[:space:]]*logpath" /etc/fail2ban/jail.d /etc/fail2ban/jail.local 2>/dev/null | sed "s/^[^=]*=//"); do case "$f" in /*\**|/*\?*|"") ;; /*) mkdir -p "$(dirname "$f")"; [ -e "$f" ] || : > "$f" ;; esac; done; mkdir -p /root/.pm2/logs'
R 'nginx -t 2>&1 | tail -2' | sed 's/^/    nginx on the new server: /'
R 'nginx -t >/dev/null 2>&1' || fail "nginx on the new server refuses the copied files (lines above)."
R 'systemctl enable nginx >/dev/null 2>&1; systemctl restart nginx; systemctl enable --now fail2ban >/dev/null 2>&1; systemctl restart fail2ban; systemctl enable --now certbot.timer >/dev/null 2>&1; true'
R 'fail2ban-client status 2>/dev/null | head -3' | sed 's/^/    /'
note "installed here but not there (for your information): $(comm -23 <(apt-mark showmanual | sort) <(R 'apt-mark showmanual' | sort) | grep -vE '^(linux-|grub|cloud-|snapd|qemu|open-vm|hostinger|nodejs$|npm$)' 2>/dev/null | head -30 | tr '\n' ' ')"

say "5/7  Checks on the new server (nothing is started there yet)"
FAILED=""
for f in /srv/*-secrets/secrets.local.js /srv/*-src/*/deploy/secrets.local.js; do
  [ -f "$f" ] || continue
  case "$f" in /srv/*-secrets/*) nm=$(basename "$(dirname "$f")"); nm=${nm%-secrets}; dir=$(ls -d /srv/$nm-src/*/ 2>/dev/null | head -1) ;; *) dir=$(dirname "$(dirname "$f")") ;; esac
  OUT=$(R "node $RT/mongo-check.js $f ${dir:-/srv}" 2>&1); rc=$?
  case $rc in 0) note "database ok : $f" ;; 3) warn "could not test : $f ($OUT)" ;; *) warn "DATABASE NOT REACHABLE from the new server: $f ($OUT)"; FAILED=1 ;; esac
done
if [ -n "$FAILED" ]; then
  echo
  echo "    MongoDB Atlas does not let the new server in yet. Do this, then run the same command again (it continues where it stopped):"
  echo "      Atlas -> your project -> Security -> Network Access -> Add IP Address -> $NEW -> Confirm. Wait until it says Active (about a minute)."
  exit 1
fi
OLDPORTS=$(ss -ltnH 2>/dev/null | awk '{n=split($4,a,":"); print a[n]}' | sort -un | tr '\n' ' ')
note "everything is copied and checked. The apps are still running here, and NOT started there."

say "6/7  Ready to switch"
PLAN=$(DNSM plan 2>&1)
NCH=$(echo "$PLAN" | grep -c '^would change'); NMAN=$(echo "$PLAN" | grep -cE '^  [a-z0-9]')
note "DNS: $NCH record(s) at Hostinger will be moved to $NEW by this script automatically."
[ "$NMAN" -gt 0 ] && { warn "DNS: $NMAN address(es) are NOT at Hostinger (or have no token). You must change them by hand at the switch:"; echo "$PLAN" | grep -E '^  [a-z0-9]' | sed 's/^/        /'; }
T0=$(st_get TTL_AT); MT=$(st_get MAXTTL); LEFT=$(( ${T0:-0} + ${MT:-0} - $(date +%s) ))
if [ "$LEFT" -gt 60 ]; then
  warn "the old DNS timer is still running for about $(( LEFT / 60 )) more minutes (until $(date -d "@$(( $(date +%s) + LEFT ))" '+%H:%M')). If you switch now, members whose phone still remembers the old address cannot open the app until then."
  note "the best time: wait until that, at a quiet hour, then run the same command again."
else note "the DNS timer has run out: the switch will reach everyone within minutes."; fi
echo
echo "    The switch stops the apps here and starts them on $NEW. Members cannot use the apps for a few minutes. It undoes itself if an app does not come up."
[ -t 0 ] || { echo "(not an interactive terminal: stopping here)"; exit 0; }
WORD=SWITCH
if [ "${NCH:-0}" = 0 ]; then
  echo
  warn "NO DNS RECORD WAS FOUND TO MOVE. If you switch now, the apps stop here and start there, but the addresses keep pointing at THIS server: your members cannot open the apps until you change the DNS by hand."
  warn "Do not switch yet. Tell Claude what this says. (Only if you will change every record by hand right after, type SWITCHANYWAY.)"
  WORD=SWITCHANYWAY
fi
A=$(ask "    Type  $WORD  to move now, or just press Enter to stop here: ")
[ "$A" = "$WORD" ] || { echo; echo "Stopped before the switch. Nothing changed for your members. Run the same command again when you want to switch."; exit 0; }

# =====================================================================  the switch
say "7/7  Switching"
rollback() {
  echo; echo "!! $1"; echo "!! Putting the apps back on this old server."
  WHERE=new; for n in $ONLINE; do R "pm2 stop $n >/dev/null 2>&1"; done; R "systemctl disable pm2-root >/dev/null 2>&1"
  for n in $ONLINE; do pm2 start "$n" >/dev/null 2>&1; done; systemctl enable --now cron >/dev/null 2>&1; systemctl enable pm2-root >/dev/null 2>&1; pm2 save --force >/dev/null 2>&1
  WHERE=old; sleep 10; pm2apps | sed 's/^/    here: /'
  echo "!! Rolled back. DNS was not changed (or was restored). On the new server, look at:  ssh root@$NEW 'pm2 logs --lines 40 --nostream'"; exit 1
}
# the answer of every web address, before
BEFORE=/tmp/migrate-before.txt; : > "$BEFORE"
while read -r h; do [ -n "$h" ] && echo "$h $(curl -s -o /dev/null -m 8 -w '%{http_code}' "https://$h/" 2>/dev/null)" >> "$BEFORE"; done < "$HOSTS"
OLDPORTS=$(ss -ltnH 2>/dev/null | awk '{n=split($4,a,":"); print a[n]}' | sort -un | tr '\n' ' ')
st_set ONLINE "$ONLINE"
note "stopping the apps on this server"
for n in $ONLINE; do pm2 stop "$n" >/dev/null 2>&1; done
sleep 3
pm2apps | awk -F'|' '$2=="online"{print $1}' | grep -qxFf <(echo "$ONLINE" | tr ' ' '\n' | grep .) && rollback "an app is still running here after the stop command (not moving it)."
systemctl disable --now cron >/dev/null 2>&1; systemctl disable pm2-root >/dev/null 2>&1
note "last sync of the files"
RS --delete --stats /srv/ "root@$NEW:/srv/" | grep -E 'Total transferred file size' | sed 's/^/      /'; rc=${PIPESTATUS[0]}; { [ "$rc" = 0 ] || [ "$rc" = 24 ]; } || rollback "the last file sync failed (code $rc)."
note "starting the apps on the new server"
WHERE=new
R 'pm2 resurrect 2>&1 | tail -1' | sed 's/^/      /'
sleep 5
for n in $ONLINE; do R "pm2 jlist 2>/dev/null | node $RT/pm2-list.js" | awk -F'|' -v n="$n" '$1==n && $2=="online"{f=1} END{exit !f}' || R "pm2 start $n >/dev/null 2>&1"; done
for n in $(R "pm2 jlist 2>/dev/null | node $RT/pm2-list.js" | awk -F'|' '$2=="online"{print $1}'); do case " $ONLINE " in *" $n "*) ;; *) R "pm2 stop $n >/dev/null 2>&1"; note "(an app that was not running before was left stopped on the new server: $n)" ;; esac; done
note "checking that every app answers"
BADAPP=""
for n in $ONLINE; do
  deadline=$((SECONDS + 120)); ok=""
  while [ $SECONDS -lt $deadline ]; do
    line=$(pm2apps | awk -F'|' -v n="$n" '$1==n{print; exit}'); st=$(echo "$line" | cut -d'|' -f2); port=$(echo "$line" | cut -d'|' -f3)
    if [ "$st" = online ]; then
      [ -z "$port" ] && { ok=1; break; }
      code=$(R "curl -s -o /dev/null -m 5 -w '%{http_code}' http://127.0.0.1:$port/health"); [ -n "$code" ] && [ "$code" != 000 ] && { ok=1; break; }
    fi
    sleep 3
  done
  [ -n "$ok" ] || BADAPP="$BADAPP $n"
done
[ -z "$BADAPP" ] || rollback "these apps did not start on the new server:$BADAPP"
R1=$(pm2apps); sleep 25; R2=$(pm2apps)
for n in $ONLINE; do
  a=$(echo "$R1" | awk -F'|' -v n="$n" '$1==n{print $4}'); b=$(echo "$R2" | awk -F'|' -v n="$n" '$1==n{print $4}'); s=$(echo "$R2" | awk -F'|' -v n="$n" '$1==n{print $2}')
  { [ "$s" = online ] && [ "${b:-0}" = "${a:-0}" ]; } || BADAPP="$BADAPP $n"
done
[ -z "$BADAPP" ] || rollback "these apps keep restarting on the new server:$BADAPP"
pm2apps | sed 's/^/      there: /'
note "checking every web address through the new server (before any DNS change)"
WHERE=old; MISMATCH=""
while read -r h; do
  [ -n "$h" ] || continue
  was=$(awk -v h="$h" '$1==h{print $2}' "$BEFORE"); now=$(curl -s -o /dev/null -m 10 --resolve "$h:443:$NEW" -w '%{http_code}' "https://$h/" 2>/dev/null)
  if bad_code "${now:-000}" && ! bad_code "${was:-000}"; then MISMATCH="$MISMATCH $h"; warn "$h answered $was here but answers ${now:-nothing} on the new server"; fi
done < "$HOSTS"
if [ -n "$MISMATCH" ]; then
  A=$(ask "    Some addresses do not answer on the new server yet (above). Type YES to carry on anyway, anything else puts everything back: ")
  [ "$A" = YES ] || rollback "stopped at your request (addresses not answering on the new server:$MISMATCH)."
fi
R 'pm2 save --force >/dev/null 2>&1; systemctl restart fail2ban >/dev/null 2>&1; true'
note "moving the DNS records"
rm -f "$BACKUP"; OUT=$(DNSM switch); rc=$?; echo "$OUT" | grep -vE '^MAXTTL=' | sed 's/^/    /'
if [ $rc = 1 ]; then DNSM back >/dev/null 2>&1; rollback "the DNS change failed (see above)."; fi
st_set SWITCHED yes; st_set SWITCHED_AT "$(date +%s)"
echo
echo "================  THE APPS NOW RUN ON THE NEW SERVER  ================"
if [ $rc = 2 ]; then
  echo "!!  THE DNS RECORDS LISTED ABOVE ('NOT at Hostinger') WERE NOT CHANGED BY THIS SCRIPT. Until you change them, those addresses still point at the OLD server"
  echo "!!  (where the apps are now stopped) and members cannot open them. Do it NOW at the place that hosts that domain's DNS: set the A record of each to $NEW."
  echo "!!  (If you want it undone instead:  bash $SELF $NEW back)"
else
  echo "DNS is changed. Members reach the new server as their phones refresh the DNS answer (minutes${MT:+; at most $MT seconds for the slowest})."
fi
NEWPORTS=$(R "ss -ltnH | awk '{n=split(\$4,a,\":\"); print a[n]}' | sort -un | tr '\n' ' '")
MISSING=$(for p in $OLDPORTS; do case " $NEWPORTS " in *" $p "*) ;; *) printf '%s ' "$p" ;; esac; done)
[ -n "$MISSING" ] && warn "ports that listened on the old server and do not on the new one: $MISSING  (a program that is not run by pm2 or nginx? tell me)"
echo
echo "Now do these by hand:"
echo "  1. Petro's GitHub webhook uses the server ADDRESS: change its Payload URL from http://$OLDIP:3000/deploy/webhook to http://$NEW:3000/deploy/webhook (GitHub -> repository -> Settings -> Webhooks)."
echo "  2. Anything that allows only the old address (a payment gateway's IP list, MongoDB Atlas after some days): add $NEW. Atlas: leave $OLDIP for now, remove it after you cancel the old server."
echo "  3. Open each app and each admin panel and try a login."
echo "  4. A few days later, when all is well:   bash $SELF $NEW finish     then cancel the old server."
echo "  If anything is wrong:   bash $SELF $NEW back"
echo
note "public DNS check:"; DNSM verify | sed 's/^/      /'
note "HTTPS renewal test on the new server (information only; it can fail until the DNS has spread, then run it again later:  ssh root@$NEW 'certbot renew --dry-run')"
R 'command -v certbot >/dev/null && timeout 600 certbot renew --dry-run 2>&1 | tail -4 || echo "(certbot is not installed there)"' | sed 's/^/      /'
echo; echo "Finished $(date '+%H:%M')."
