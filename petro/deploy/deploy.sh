#!/usr/bin/env bash
# Deploy Petro to the Hostinger KVM1 VPS over SSH.
#
# WHY A SCRIPT INSTEAD OF autoDeploy. Railway/Render redeployed on every git
# push; a plain VPS has no such hook by default. This is the manual/scripted
# step that replaces it -- run it by hand after building, or wire it to a
# CI job later if the owner wants that (not set up yet, on purpose: no CI
# runner has this VPS's SSH key).
#
# BEFORE RUNNING: rebuild both bundles so what ships matches -src/:
#   cd petro && node build-core.js && node build-admin.js
# and if the backend origin just changed:
#   node set-backend-url.js https://api.PETRO_DOMAIN && node build-core.js && node build-admin.js
#
# Required environment (set these, do not hardcode them here -- this file
# is committed):
#   PETRO_VPS_HOST   e.g. root@203.0.113.10 or a ~/.ssh/config alias
#   PETRO_VPS_PATH   remote deploy root, default /srv/petro
#
# What this does NOT do: create the VPS user, install node/nginx/certbot/
# pm2, request the TLS cert, or write the .env file with MONGODB_URI /
# FIREBASE_SERVICE_ACCOUNT / ADMIN_KEY / the payment-gateway keys. Those are
# real, once-per-server setup steps -- see petro/CLAUDE.md, "Hosting:
# Hostinger VPS (KVM1)" for the full checklist. This script only pushes a
# build and restarts the process, the part that repeats every deploy.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PETRO_DIR="$(dirname "$HERE")"

: "${PETRO_VPS_HOST:?Set PETRO_VPS_HOST, e.g. root@203.0.113.10}"
PETRO_VPS_PATH="${PETRO_VPS_PATH:-/srv/petro}"

echo "==> Verifying local builds are up to date"
for f in "$PETRO_DIR/user/index.html" "$PETRO_DIR/admin/index.html"; do
  [ -f "$f" ] || { echo "Missing $f -- run build-core.js/build-admin.js first"; exit 1; }
done

echo "==> Syncing backend (server.js, db.js, service-account.js, package files)"
rsync -az --delete \
  "$PETRO_DIR/server.js" "$PETRO_DIR/db.js" "$PETRO_DIR/service-account.js" \
  "$PETRO_DIR/package.json" "$PETRO_DIR/package-lock.json" \
  "$PETRO_VPS_HOST:$PETRO_VPS_PATH/"

echo "==> Syncing frontend bundles (user/, admin/)"
rsync -az --delete "$PETRO_DIR/user/"  "$PETRO_VPS_HOST:$PETRO_VPS_PATH/user/"
rsync -az --delete "$PETRO_DIR/admin/" "$PETRO_VPS_HOST:$PETRO_VPS_PATH/admin/"

echo "==> Syncing deploy/ (ecosystem.config.js, this script)"
rsync -az "$HERE/ecosystem.config.js" "$PETRO_VPS_HOST:$PETRO_VPS_PATH/deploy/"

echo "==> Installing production deps and reloading the backend"
# shellcheck disable=SC2029
ssh "$PETRO_VPS_HOST" "cd '$PETRO_VPS_PATH' && npm install --omit=dev && \
  (pm2 reload deploy/ecosystem.config.js --update-env || pm2 start deploy/ecosystem.config.js)"

echo "==> Reloading nginx (config test first, no downtime on success)"
ssh "$PETRO_VPS_HOST" "nginx -t && systemctl reload nginx"

echo "==> Done. Backend: https://api.PETRO_DOMAIN/health"
