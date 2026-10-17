#!/usr/bin/env bash
# Deploy Mint to the Hostinger KVM1 VPS over SSH.
#
# WHY A SCRIPT INSTEAD OF autoDeploy. Railway/Render redeployed on every git
# push; a plain VPS has no such hook by default. This is the manual/scripted
# step that replaces it -- run it by hand after building, or wire it to a
# CI job later if the owner wants that (not set up yet, on purpose: no CI
# runner has this VPS's SSH key).
#
# BEFORE RUNNING: rebuild both bundles so what ships matches -src/:
#   cd mint && node build-core.js && node build-admin.js
# and if the backend origin just changed:
#   node set-backend-url.js https://api.MINT_DOMAIN && node build-core.js && node build-admin.js
#
# Required environment (set these, do not hardcode them here -- this file
# is committed):
#   MINT_VPS_HOST   e.g. root@203.0.113.10 or a ~/.ssh/config alias
#   MINT_VPS_PATH   remote deploy root, default /srv/mint
#
# What this does NOT do: create the VPS user, install node/nginx/certbot/
# pm2, request the TLS cert, or write the .env file with MONGODB_URI /
# FIREBASE_SERVICE_ACCOUNT / ADMIN_KEY / the payment-gateway keys. Those are
# real, once-per-server setup steps -- see mint/CLAUDE.md, "Hosting:
# Hostinger VPS (KVM1)" for the full checklist. This script only pushes a
# build and restarts the process, the part that repeats every deploy.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MINT_DIR="$(dirname "$HERE")"

: "${MINT_VPS_HOST:?Set MINT_VPS_HOST, e.g. root@203.0.113.10}"
MINT_VPS_PATH="${MINT_VPS_PATH:-/srv/mint}"

echo "==> Verifying local builds are up to date"
for f in "$MINT_DIR/user/index.html" "$MINT_DIR/admin/index.html"; do
  [ -f "$f" ] || { echo "Missing $f -- run build-core.js/build-admin.js first"; exit 1; }
done

echo "==> Syncing backend (server.js, db.js, service-account.js, package files)"
rsync -az --delete \
  "$MINT_DIR/server.js" "$MINT_DIR/db.js" "$MINT_DIR/service-account.js" \
  "$MINT_DIR/package.json" "$MINT_DIR/package-lock.json" \
  "$MINT_VPS_HOST:$MINT_VPS_PATH/"

echo "==> Syncing frontend bundles (user/, admin/)"
rsync -az --delete "$MINT_DIR/user/"  "$MINT_VPS_HOST:$MINT_VPS_PATH/user/"
rsync -az --delete "$MINT_DIR/admin/" "$MINT_VPS_HOST:$MINT_VPS_PATH/admin/"

echo "==> Syncing deploy/ (ecosystem.config.js, this script)"
rsync -az "$HERE/ecosystem.config.js" "$MINT_VPS_HOST:$MINT_VPS_PATH/deploy/"

echo "==> Installing production deps and reloading the backend"
# shellcheck disable=SC2029
ssh "$MINT_VPS_HOST" "cd '$MINT_VPS_PATH' && npm install --omit=dev && \
  (pm2 reload deploy/ecosystem.config.js --update-env || pm2 start deploy/ecosystem.config.js)"

echo "==> Reloading nginx (config test first, no downtime on success)"
ssh "$MINT_VPS_HOST" "nginx -t && systemctl reload nginx"

echo "==> Done. Backend: https://api.MINT_DOMAIN/health"
