#!/bin/bash
# Short invite links (https://app.<domain>/code=<code>): one-time patch of the LIVE nginx files. Run as root on the VPS:
#   bash /srv/petro-src/petro/deploy/short-links.sh
# 1. adds   location ^~ /code= { ... }   next to the existing /refCode= rule (so the path is answered with the member app instead of 404)
# 2. if the random-address (wildcard) file exists, makes it accept app.<domain> as well as the 4-character addresses
# Safe to run twice. nginx is tested first; if the test fails everything is put back exactly as it was.
set -u
DIR1=/etc/nginx/sites-available; DIR2=/etc/nginx/conf.d
FILES=$(grep -l 'location \^~ /refCode=' $DIR1/* $DIR2/* 2>/dev/null)
[ -n "$FILES" ] || { echo "No nginx file with the member app was found. Nothing changed."; exit 1; }
STAMP=$(date +%s); changed=0
for f in $FILES; do
  cp "$f" "$f.before-shortlinks.$STAMP"
  if ! grep -q 'location \^~ /code=' "$f"; then
    awk '
      /location \^~ \/refCode= \{/ && !done {
        print "    location ^~ /code= {"
        print "        try_files $petro_bot_html /index.html;"
        print "        add_header Cache-Control \"no-cache\";"
        print "    }"
        print ""
        done=1
      }
      { print }' "$f.before-shortlinks.$STAMP" > "$f"
    changed=1
  fi
  if grep -q '\[a-z0-9\]{4}' "$f" && ! grep -q '(app|\[a-z0-9\]{4})' "$f"; then
    sed -i 's/\[a-z0-9\]{4}/(app|[a-z0-9]{4})/g' "$f"; changed=1
  fi
done
if ! nginx -t 2>&1 | tail -3 | grep -q 'successful'; then
  nginx -t 2>&1 | tail -5
  for f in $FILES; do [ -f "$f.before-shortlinks.$STAMP" ] && cp "$f.before-shortlinks.$STAMP" "$f"; done
  echo "!! nginx refused the change; everything was put back as it was."; exit 1
fi
systemctl reload nginx && echo "Done: https://app.<your domain>/code=<code> now opens the app (nginx reloaded, $changed file change(s))."
