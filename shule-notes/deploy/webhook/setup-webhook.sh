#!/usr/bin/env bash
# Sets up automatic deploys: when you push to GitHub, this server fetches the
# new code, runs the tests and, only if they pass, puts it live.
#
#   sudo ./webhook/setup-webhook.sh [branch]
#
# Run deploy/setup.sh first. It only ADDS things (a user "shule-deploy", one
# service, one sudo rule for ONE fixed script, one nginx location); nothing
# belonging to your other projects is touched. Safe to run again.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Run this as root (sudo)."; exit 1; }

HERE="$(cd "$(dirname "$0")" && pwd)"
BRANCH="${1:-claude/space8-rename-frontend-rebuild-juurd7}"
REPO_URL=https://github.com/loganmore282-debug/X-engine-developments.git
LIB=/usr/local/lib/shule-deploy
WORK=/var/lib/shule-deploy
CONF=/etc/shule-notes/deploy.conf
HOOKENV=/etc/shule-notes/webhook.env
NGINX_API=/etc/nginx/conf.d/shule-api.conf
HOOK_LOC=/etc/nginx/shule-hook-location.conf

[ -f /etc/shule-notes/.env ] && [ -f "$NGINX_API" ] || { echo "Run deploy/setup.sh first."; exit 1; }
port_in_use() { [ -n "$(ss -ltnH "( sport = :$1 )" 2>/dev/null)" ]; }
API_DOMAIN="$(grep -m1 'server_name' "$NGINX_API" | awk '{print $2}' | tr -d ';')"
if [ -x /opt/shule-notes/node/bin/node ]; then NODE_DIR=/opt/shule-notes/node/bin; else NODE_DIR="$(dirname "$(command -v node)")"; fi

echo "==> Packages (only what is missing)"
NEED=""; for p in git rsync curl sudo openssl; do command -v "$p" >/dev/null || NEED="$NEED $p"; done
[ -z "$NEED" ] || { apt-get update -y >/dev/null; DEBIAN_FRONTEND=noninteractive apt-get install -y $NEED; }

echo "==> Deploy user and folders"
id shule-deploy >/dev/null 2>&1 || useradd --system --home "$WORK" --shell /usr/sbin/nologin shule-deploy
mkdir -p "$WORK" "$LIB"
chown -R shule-deploy:shule-deploy "$WORK"
# The scripts the hook runs (and the one run as root) are owned by root, so the deploy user cannot alter them.
install -m 755 -o root -g root "$HERE/server.js" "$HERE/build.sh" "$HERE/apply.sh" "$LIB/"

echo "==> Settings"
cat > "$CONF" <<CONFIG
REPO_URL=$REPO_URL
BRANCH=$BRANCH
API_DOMAIN=$API_DOMAIN
NODE_DIR=$NODE_DIR
CONFIG
chown root:shule-deploy "$CONF"; chmod 640 "$CONF"
if [ -f "$HOOKENV" ] && grep -q '^WEBHOOK_SECRET=' "$HOOKENV"; then
  SECRET="$(grep -m1 '^WEBHOOK_SECRET=' "$HOOKENV" | cut -d= -f2)"
  HOOK_PORT="$(grep -m1 '^HOOK_PORT=' "$HOOKENV" | cut -d= -f2)"
else
  SECRET="$(openssl rand -hex 32)"
  HOOK_PORT=4100; while port_in_use "$HOOK_PORT"; do HOOK_PORT=$((HOOK_PORT + 1)); done
fi
cat > "$HOOKENV" <<HOOK
WEBHOOK_SECRET=$SECRET
HOOK_PORT=$HOOK_PORT
BRANCH=$BRANCH
DEPLOY_CMD=$LIB/build.sh
HOOK
chown root:shule-deploy "$HOOKENV"; chmod 640 "$HOOKENV"

echo "==> sudo rule (one fixed script, nothing else)"
echo "shule-deploy ALL=(root) NOPASSWD: $LIB/apply.sh" > /etc/sudoers.d/shule-deploy.tmp
visudo -cf /etc/sudoers.d/shule-deploy.tmp >/dev/null
chmod 440 /etc/sudoers.d/shule-deploy.tmp; mv /etc/sudoers.d/shule-deploy.tmp /etc/sudoers.d/shule-deploy

echo "==> Service"
sed "s|__NODE__|$NODE_DIR/node|" "$HERE/shule-deploy-hook.service" > /etc/systemd/system/shule-deploy-hook.service
systemctl daemon-reload
systemctl enable shule-deploy-hook >/dev/null
systemctl restart shule-deploy-hook

echo "==> nginx: expose the hook at /_hooks/github (existing sites untouched)"
cp "$NGINX_API" "$NGINX_API.before-hook"
cat > "$HOOK_LOC" <<LOC
# GitHub deploy hook (written by deploy/webhook/setup-webhook.sh)
location /_hooks/ {
    proxy_pass http://127.0.0.1:$HOOK_PORT/;
    proxy_set_header Host \$host;
    proxy_read_timeout 30s;
    client_max_body_size 1m;
}
LOC
sed -i '/shule-hook-location.conf/d' "$NGINX_API"
sed -i '/client_max_body_size 55m;/a\    include /etc/nginx/shule-hook-location.conf;' "$NGINX_API"
if nginx -t 2>/dev/null; then
  systemctl reload nginx
  rm -f "$NGINX_API.before-hook"
else
  echo "nginx rejected the change; putting the previous file back. Nothing else was changed."
  nginx -t || true
  mv "$NGINX_API.before-hook" "$NGINX_API"
  exit 1
fi

sleep 2
if curl -fsS --max-time 8 "https://$API_DOMAIN/_hooks/" | grep -q running; then HEALTH="reachable"; else HEALTH="NOT reachable yet (see: journalctl -u shule-deploy-hook -n 30)"; fi

cat <<MSG

==> Done. The hook is $HEALTH.

Now add it on GitHub (once):
  Repository  ->  Settings  ->  Webhooks  ->  Add webhook
    Payload URL   https://$API_DOMAIN/_hooks/github
    Content type  application/json
    Secret        $SECRET
    Events        "Just the push event"
    Active        ticked
Then press "Add webhook". GitHub sends a test ("ping"); it should show a green tick.

Watching the branch: $BRANCH
Deploy log:        tail -f $WORK/deploy.log
To see the secret again: sudo grep WEBHOOK_SECRET $HOOKENV
MSG
