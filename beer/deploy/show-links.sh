#!/usr/bin/env bash
# Shows Beer's addresses and webhook values, read from this server (nothing is changed except: a GitHub webhook secret is made if there is none yet).
#   bash /srv/beer-src/beer/deploy/show-links.sh            all three
#   bash /srv/beer-src/beer/deploy/show-links.sh app        the member app address
#   bash /srv/beer-src/beer/deploy/show-links.sh admin      the hidden admin address
#   bash /srv/beer-src/beer/deploy/show-links.sh github     GitHub webhook: Payload URL, content type and Secret
# The GitHub secret is private: do not post or screenshot it.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BEER=${BEER_DIR:-$(dirname "$HERE")}
SECRETS=${BEER_SECRETS_DIR:-/srv/beer-secrets}
rd() { [ -s "$1" ] && tr -d '[:space:]' < "$1"; }
APP=$(rd "${BEER_APP_HOST_FILE:-$SECRETS/app-host}")
ADMIN=$(rd "${BEER_ADMIN_HOST_FILE:-$SECRETS/admin-host}")
ADMIN_PATH=$(sed -n 's/^ADMIN_PATH=\${BEER_ADMIN_PATH:-\([A-Za-z0-9]*\)}.*/\1/p' "$BEER/deploy/update-vps.sh" | head -1)
want=${1:-all}
secret() { node -e 'try{process.stdout.write(String(require(process.argv[1])[process.argv[2]]||""))}catch(e){}' "${BEER_SECRETS_FILE:-$SECRETS/secrets.local.js}" "$1"; }
[ -n "$APP" ] || { echo "No domain is set up yet (run set-domain.sh first)."; exit 1; }

app()   { echo "Member app  : https://$APP/"; }
admin() { echo "Admin panel : https://${ADMIN:-$APP}/$ADMIN_PATH/     (keep private)"; }
github() {
  local S; S=$(secret DEPLOY_WEBHOOK_SECRET)
  if [ -z "$S" ]; then
    S=$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')
    BEER_SECRET_VALUE="$S" node "$BEER/deploy/set-secret.js" DEPLOY_WEBHOOK_SECRET >/dev/null && echo "(no GitHub webhook secret existed, so one was made and saved)"
    (cd "$BEER/deploy" && pm2 reload ecosystem.config.js --only beer-server --update-env >/dev/null 2>&1)
  fi
  echo "GitHub webhook  (repo -> Settings -> Webhooks -> Add webhook)"
  echo "  Payload URL : https://$APP/k7x2/deploy/webhook"
  echo "  Content type: application/json"
  echo "  Secret      : $S"
  echo "  Events      : Just the push event"
}
case "$want" in
  app) app ;; admin) admin ;; github) github ;;
  all) app; admin; echo; github ;;
  *) echo "usage: show-links.sh [app|admin|github|all]"; exit 1 ;;
esac
