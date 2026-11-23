#!/usr/bin/env bash
# Shows PersonalCare's addresses and webhook values, read from this server (nothing is changed except: a GitHub webhook secret is made if there is none yet).
#   bash /srv/personalcare-src/personalcare/deploy/show-links.sh            all four
#   bash /srv/personalcare-src/personalcare/deploy/show-links.sh app        the member app address
#   bash /srv/personalcare-src/personalcare/deploy/show-links.sh admin      the hidden admin address
#   bash /srv/personalcare-src/personalcare/deploy/show-links.sh github     GitHub webhook: Payload URL, content type and Secret
#   bash /srv/personalcare-src/personalcare/deploy/show-links.sh pesajet    PesaJet webhook URL
# The secret and the PesaJet address are private: do not post or screenshot them.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PERSONALCARE=${PERSONALCARE_DIR:-$(dirname "$HERE")}
SECRETS=${PERSONALCARE_SECRETS_DIR:-/srv/personalcare-secrets}
rd() { [ -s "$1" ] && tr -d '[:space:]' < "$1"; }
APP=$(rd "${PERSONALCARE_APP_HOST_FILE:-$SECRETS/app-host}")
ADMIN=$(rd "${PERSONALCARE_ADMIN_HOST_FILE:-$SECRETS/admin-host}")
ADMIN_PATH=$(sed -n 's/^ADMIN_PATH=\${PERSONALCARE_ADMIN_PATH:-\([A-Za-z0-9]*\)}.*/\1/p' "$PERSONALCARE/deploy/update-vps.sh" | head -1)
want=${1:-all}
secret() { node -e 'try{process.stdout.write(String(require(process.argv[1])[process.argv[2]]||""))}catch(e){}' "${PERSONALCARE_SECRETS_FILE:-$SECRETS/secrets.local.js}" "$1"; }
# No domain yet: the GitHub webhook can still use the temporary address (http://<server ip>:8104, see preview.sh). Everything else needs the domain.
PREVIEW_IP=""
if [ -z "$APP" ]; then
  if [ "$want" = github ] && [ -f "${PERSONALCARE_PREVIEW_CONF:-/etc/nginx/conf.d/personalcare-preview.conf}" ]; then
    PREVIEW_IP=$(curl -4 -s --max-time 8 https://ifconfig.me || true); [ -n "$PREVIEW_IP" ] || PREVIEW_IP=$(hostname -I | awk '{print $1}')
  else
    echo "No domain is set up yet (run set-domain.sh first). For the GitHub webhook only, turn the temporary address on with preview.sh on, then run:  bash $0 github"; exit 1
  fi
fi

app()   { echo "Member app  : https://$APP/"; }
admin() { echo "Admin panel : https://${ADMIN:-$APP}/$ADMIN_PATH/     (keep private)"; }
github() {
  local S; S=$(secret DEPLOY_WEBHOOK_SECRET)
  if [ -z "$S" ]; then
    S=$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')
    PERSONALCARE_SECRET_VALUE="$S" node "$PERSONALCARE/deploy/set-secret.js" DEPLOY_WEBHOOK_SECRET >/dev/null && echo "(no GitHub webhook secret existed, so one was made and saved)"
    (cd "$PERSONALCARE/deploy" && pm2 reload ecosystem.config.js --only personalcare-server --update-env >/dev/null 2>&1)
  fi
  echo "GitHub webhook  (repo -> Settings -> Webhooks -> Add webhook)"
  if [ -n "$PREVIEW_IP" ]; then echo "  Payload URL : http://$PREVIEW_IP:8104/k7x2/deploy/webhook    (temporary address; the signature secret below is what protects it)"
  else echo "  Payload URL : https://$APP/k7x2/deploy/webhook"; fi
  echo "  Content type: application/json"
  echo "  Secret      : $S"
  echo "  Events      : Just the push event"
}
pesajet() {
  local T HH
  T=$(rd "${PERSONALCARE_HOOK_FILE:-$SECRETS/hook-token}"); HH=$(rd "${PERSONALCARE_HOOK_HOST_FILE:-$SECRETS/hook-host}")
  if [ -n "$T" ]; then
    if [ -n "$HH" ]; then echo "PesaJet webhook URL: https://$HH/h-$T/pesajet"; else echo "PesaJet webhook URL: https://$APP/k7x2/h-$T/pesajet"; fi
  else
    echo "PesaJet webhook URL (the plain one): https://$APP/k7x2/pesajet/webhook"
    echo "  For a secret address instead, run:  bash $PERSONALCARE/deploy/make-hook-url.sh"
  fi
}
case "$want" in
  app) app ;; admin) admin ;; github) github ;; pesajet) pesajet ;;
  all) app; admin; echo; github; echo; pesajet ;;
  *) echo "usage: show-links.sh [app|admin|github|pesajet|all]"; exit 1 ;;
esac
