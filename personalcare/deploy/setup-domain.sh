#!/usr/bin/env bash
# ONE command for putting a bought domain on PersonalCare. It asks for the domain, then does everything (the same work as set-domain.sh).
#   bash /srv/personalcare-src/personalcare/deploy/setup-domain.sh
# If the DNS records are not there yet it prints them and stops without changing anything: add them, wait 5-15 minutes, run this same command again
# (it remembers the domain you typed, so you can just press Enter).
set -u
[ "$(id -u)" = 0 ] || { echo "Run this as root."; exit 1; }
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SECRETS=${PERSONALCARE_SECRETS_DIR:-/srv/personalcare-secrets}
MEMORY="$SECRETS/last-domain"
LAST=""; [ -s "$MEMORY" ] && LAST=$(tr -d '[:space:]' < "$MEMORY")
echo
echo "=============================================="
echo "   PersonalCare: put your domain on the app"
echo "=============================================="
echo
if [ -n "$LAST" ]; then read -r -p "Type your domain [$LAST]: " DOM; DOM=${DOM:-$LAST}; else read -r -p "Type your domain (for example mybusiness.com): " DOM; fi
DOM=$(printf '%s' "$DOM" | tr 'A-Z' 'a-z' | sed -E 's#^https?://##; s#/.*$##; s#^www\.##; s/[[:space:]]//g')
[ -n "$DOM" ] || { echo "No domain typed. Run the command again and type it."; exit 1; }
read -r -p "Name for the app address, so members use  <name>.$DOM  [ug]: " LABEL
LABEL=$(printf '%s' "${LABEL:-ug}" | tr 'A-Z' 'a-z' | sed -E 's/[[:space:]]//g')
echo
echo "Domain : $DOM"
echo "App    : $LABEL.$DOM"
echo
read -r -p "Is that right? Press Enter to continue, or Ctrl+C to stop: " _
mkdir -p "$SECRETS" 2>/dev/null; (umask 077; printf '%s' "$DOM" > "$MEMORY") 2>/dev/null
echo
echo "--- Step 1 of 2: bringing PersonalCare up to date ---"
bash "$HERE/quick-update.sh" 2>&1 | tail -6
echo
echo "--- Step 2 of 2: the domain ---"
bash "$HERE/set-domain.sh" "$DOM" "$LABEL"
RC=$?
echo
if [ "$RC" != 0 ]; then
  echo "Nothing is finished yet. Read the lines above: add the DNS records it lists (or fix what it says), wait 5-15 minutes, then run this same command again:"
  echo "    bash $HERE/setup-domain.sh"
  exit "$RC"
fi
echo
read -r -p "Show the PesaJet and GitHub webhook details now? (they are private: do not post or screenshot them) [y/N]: " SHOW
case "$SHOW" in y|Y|yes|YES)
  echo; bash "$HERE/show-links.sh" pesajet; echo; bash "$HERE/show-links.sh" github ;; esac
echo; echo "All done."
