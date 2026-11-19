#!/usr/bin/env bash
# Step 1 of a deploy. Runs as the unprivileged user "shule-deploy": gets the
# new code, installs its dependencies and RUNS THE TESTS. Nothing live changes
# here. Only if everything passes does it ask apply.sh (the one command the
# user may run as root) to put the result live.
set -euo pipefail
. /etc/shule-notes/deploy.conf          # REPO_URL BRANCH API_DOMAIN NODE_DIR
WORK=/var/lib/shule-deploy
REPO=$WORK/repo
STAGE=$WORK/stage
export PATH="$NODE_DIR:$PATH"
log() { echo "[$(date -u +%FT%TZ)] $*" | tee -a "$WORK/deploy.log"; }

exec 9>"$WORK/lock"
flock -n 9 || { log "another deploy is running; skipping"; exit 0; }
trap 'log "deploy FAILED (the live site was not changed unless it says otherwise above)"' ERR

if [ ! -d "$REPO/.git" ]; then
  log "first run: cloning only the shule-notes folder"
  git clone --quiet --filter=blob:none --no-checkout --depth=1 --branch "$BRANCH" "$REPO_URL" "$REPO"
  git -C "$REPO" sparse-checkout init --cone
  git -C "$REPO" sparse-checkout set shule-notes
  git -C "$REPO" checkout --quiet
fi
git -C "$REPO" fetch --quiet --depth=1 origin "$BRANCH"
NEW="$(git -C "$REPO" rev-parse FETCH_HEAD)"
git -C "$REPO" reset --quiet --hard FETCH_HEAD

BTREE="$(git -C "$REPO" rev-parse HEAD:shule-notes/backend)"
ATREE="$(git -C "$REPO" rev-parse HEAD:shule-notes/admin)"
rm -rf "$STAGE"; mkdir -p "$STAGE"
NEED=""
if [ "$BTREE" != "$(cat "$WORK/backend.tree" 2>/dev/null || true)" ]; then NEED="$NEED backend"; fi
if [ "$ATREE" != "$(cat "$WORK/admin.tree" 2>/dev/null || true)" ]; then NEED="$NEED admin"; fi
if [ -z "$NEED" ]; then
  echo "$NEW" > "$WORK/deployed.sha"
  log "${NEW:0:7}: nothing changed in the backend or the admin panel; live site left as it is"
  exit 0
fi
log "${NEW:0:7}: changed:$NEED"

if [[ "$NEED" == *backend* ]]; then
  rsync -a --no-links --exclude node_modules "$REPO/shule-notes/backend/" "$STAGE/backend/"
  cd "$STAGE/backend"
  # No install scripts: nothing from the internet runs code during the install.
  npm install --omit=dev --no-audit --no-fund --ignore-scripts >> "$WORK/deploy.log" 2>&1
  log "running the tests"
  npm test >> "$WORK/deploy.log" 2>&1 || { log "TESTS FAILED: nothing was deployed (see $WORK/deploy.log)"; exit 1; }
  touch "$STAGE/.backend"
fi
if [[ "$NEED" == *admin* ]]; then
  cp "$REPO/shule-notes/admin/index.html" "$STAGE/admin.html"
  touch "$STAGE/.admin"
fi

sudo -n /usr/local/lib/shule-deploy/apply.sh
[[ "$NEED" == *backend* ]] && echo "$BTREE" > "$WORK/backend.tree"
[[ "$NEED" == *admin* ]] && echo "$ATREE" > "$WORK/admin.tree"
echo "$NEW" > "$WORK/deployed.sha"
rm -rf "$STAGE"
log "${NEW:0:7}: DEPLOYED"
