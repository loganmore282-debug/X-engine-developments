#!/usr/bin/env bash
# Put a newer copy of the code live. Run as root from this folder after
# pulling the repository:  sudo ./update.sh api.example.com
set -euo pipefail
API_DOMAIN="${1:?usage: update.sh <api-domain>}"
HERE="$(cd "$(dirname "$0")" && pwd)"; SRC="$(dirname "$HERE")"
NODE_DIR=""; [ -x /opt/shule-notes/node/bin/node ] && NODE_DIR=/opt/shule-notes/node/bin
rsync -a --delete --exclude node_modules --exclude uploads --exclude .env "$SRC/backend/" /opt/shule-notes/backend/
(cd /opt/shule-notes/backend && PATH="${NODE_DIR:+$NODE_DIR:}$PATH" npm install --omit=dev --no-audit --no-fund)
chown -R root:shule /opt/shule-notes && chmod -R g+rX /opt/shule-notes
sed "s|http://localhost:4000|https://$API_DOMAIN|" "$SRC/admin/index.html" > /var/www/shule-admin/index.html
systemctl restart shule-notes
sleep 2
systemctl --no-pager status shule-notes | head -5
