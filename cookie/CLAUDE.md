# Cookie — project memory (read this first)

**What it is:** Cookie is an app built from **Soda** (via Mint, which is also a Soda copy) (same code, same functionality, same money rules, same admin panel). It was
copied from `mint/` (itself Soda at commit 3261fdc) and renamed with `node set-brand.js "Cookie"`. The owner
will send screenshots of Cookie's pages; the look is changed to match them. **Everything about money, auth, payouts and the admin panel
works exactly as in Soda** — the full Soda history (every rule and why) is in `docs/SODA-LOG.md`; read the "Money-safety" and
"Status log" parts of it before touching payment, payout or withdrawal code.

The owner speaks plainly, wants things done (not lots of questions), keeps answers short, hates abbreviations ("UGX 23,000", never
"23k"), and does not want features nobody asked for.

## Where things are (all under `cookie/`)
- `server.js` (backend, MongoDB only, no Firebase), `db.js`, `session-policy.js`, `service-account.js`, `totp.js`
- `user-src/` (member app: `index.html`, `original_module.js`) -> `node build-core.js` -> `user/`
- `admin-src/index.html` -> `node build-admin.js` -> `admin/`
- Always rebuild after editing `-src`, bump the cache name in `user/sw.js` (`cookie-shell-vN`) and `admin/sw.js` (`cookie-admin-shell-vN`),
  run `npm run test:audit` (4-9 minutes; wait for exit 0), commit, push to **`claude/cookie-build`**.
- Install dev tools with `npm install --include=dev` (acorn, jsdom, javascript-obfuscator are needed by the tests/build).
- `node set-brand.js "Name"` renames the app everywhere again if the name ever changes.

## Hosting (same Hostinger VPS as Soda, completely separate)
| | Soda | Mint | Cookie |
|---|---|---|---|
| code | `/srv/soda-src/soda` | `/srv/mint-src/mint` | `/srv/cookie-src/cookie` (branch **`claude/cookie-build`**) |
| secrets | `/srv/soda-secrets/` | `/srv/mint-secrets/` | `/srv/cookie-secrets/secrets.local.js` |
| process / port | pm2 `soda-server`, 3001 | pm2 `mint-server`, 3002 | pm2 **`cookie-server`**, **3003** (loopback only) |
| database | Atlas `soda`, user `sodaapp` | `mint`, `mintapp` | Atlas db **`cookie`**, user **`cookieapp`** (readWrite on `cookie` only) |
| nginx file | `soda.conf` | `mint.conf` | `/etc/nginx/conf.d/cookie.conf` (zones `cookie_*`) |
| dev ports | 8090 / 8091 | 8092 / 8093 | 8094 / 8095 |
Never run `pm2 reload all`, `pm2 restart all` or `pm2 delete all` on this VPS: it would restart Soda too. Use the names.

### One-time backend setup (owner runs it on the VPS as root)
1. Atlas: Database Access -> add user `cookieapp` (readWrite on database `cookie` only); Network Access already allows the VPS.
2. One command: `git clone --filter=blob:none --no-checkout --branch claude/cookie-build "$(git -C /srv/soda-src remote get-url origin)" /srv/cookie-src && cd /srv/cookie-src && git sparse-checkout set cookie && git checkout && bash cookie/deploy/first-setup.sh`
   It installs packages, asks (hidden) for the MongoDB connection string and CHECKS it connects, asks for the admin password, writes
   `/srv/cookie-secrets/secrets.local.js`, starts pm2 `cookie-server`, and tests `/health`.
3. Later, updates until Cookie has its own domain: `bash /srv/cookie-src/cookie/deploy/quick-update.sh` (restarts only Cookie).
4. **Domain `orroe-cookie.com` (bought by the owner).** Same layout as Soda: root domain parked, member app on **`app.orroe-cookie.com`**, hidden admin panel on **`m5ze9b.orroe-cookie.com/Bake7qz3/`**, future PesaJet-only host `p2c8d.orroe-cookie.com` (`deploy/make-hook-url.sh p2c8d`). DNS: A records `app` and `m5ze9b` -> 179.198.197.114 (no apex, no www). Then on the VPS: `bash /srv/cookie-src/cookie/deploy/update-vps.sh` (nginx file `cookie.conf`, certificate named `app.orroe-cookie.com`, restart of Cookie only, hardening). Afterwards: GitHub webhook to `https://app.orroe-cookie.com/k7x2/deploy/webhook` with `DEPLOY_WEBHOOK_SECRET` from `/srv/cookie-secrets/secrets.local.js`; secret `PUBLIC_URL=https://app.orroe-cookie.com/k7x2`.

## Status
1. (done) Copied from Soda, renamed to Cookie, ports 3003/8094/8095, own secrets/process/fail2ban/nginx names, placeholder hosts, new admin path.
   `npm run test:audit` passes. Design is still Soda's look (renamed) until the owner sends screenshots.
2. (waiting on owner) Atlas user + connection string, VPS first-setup, domain, payment keys (PesaJet/MarzPay), then screenshots.
