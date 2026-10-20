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
4. **Domain (not bought yet; names are NOT decided).** The hosts inside the code (`app.cookie.example.com` ...) are placeholders and `update-vps.sh` refuses to run until a real domain is set. When the owner has one:
   `bash /srv/cookie-src/cookie/deploy/set-domain.sh yourdomain.com` -- it prints the two DNS A records to add (`app` and a random hidden admin label, remembered in `/srv/cookie-secrets/admin-host`), changes NOTHING until they point at the VPS, then writes `/srv/cookie-secrets/app-host`, runs `update-vps.sh` (nginx `cookie.conf`, HTTPS certificate named after the app host, Cookie restart, hardening), sets `PUBLIC_URL`, and prints the app and admin addresses (admin path `Bake7qz3`). Root domain is not served (Soda layout). The admin "allowed domains" setting only matters for cross-origin calls; nginx + certificate (this command) is what makes a domain work. Afterwards: GitHub webhook to `https://<app host>/k7x2/deploy/webhook` with `DEPLOY_WEBHOOK_SECRET`, and PesaJet via `deploy/make-hook-url.sh`.

5. **Temporary preview by IP (no domain needed):** `bash /srv/cookie-src/cookie/deploy/preview.sh on` serves the member app at `http://<vps ip>:8094/` and the hidden admin panel at `http://<vps ip>:8094/Bake7qz3/` (one nginx file `cookie-preview.conf`, firewall port 8094, plain HTTP -- design work only, never real members or money). `preview.sh off` removes it; `update-vps.sh` removes it automatically when a domain is set up. New design reaches the VPS with `deploy/quick-update.sh`.

## Status
1. (done) Copied from Soda, renamed to Cookie, ports 3003/8094/8095, own secrets/process/fail2ban/nginx names, placeholder hosts, new admin path.
   `npm run test:audit` passes. Design is still Soda's look (renamed) until the owner sends screenshots.
2. (waiting on owner) Atlas user + connection string, VPS first-setup, domain, payment keys (PesaJet/MarzPay), then screenshots.

## Rules the owner has decided (keep these)
- **Referral reward = the referred member's FIRST PURCHASE** (not the first deposit). Level 1 / 2 / 3 are paid once, as a percentage of that
  product's price, at the moment of purchase (`/invest/create` -> `creditReferralCommission`; the 30 s reconciler retries a failed one). A deposit
  pays nothing. A product the admin activates (`granted`) is not a purchase. Test: `test-first-purchase-reward.js` (runs the real route).
- **Cashback every 24 hours** (owner changed it from midnight): a product pays its first cashback 24 hours after the purchase and then every 24 hours
  (`payoutFirstAt` on the investment; same number of payments, same total). A member's FIRST purchase pays its first cashback AT ONCE (at the moment
  of purchase, `/invest/create` settles it before answering), the rest follow every 24 hours. A product the admin gives (`granted`) pays 24 hours after
  it was given. Investments without `payoutFirstAt` (bought before this rule) keep the old midnight schedule. The Income card's "Settlement countdown"
  counts to that product's own next payment (`nextPayoutMs`) on the SERVER clock (`serverNow`, `ckNow()`). Tests: `test-settlement-engine.js`,
  `test-settlement-countdown.js`, `test-first-purchase-reward.js`.
- **Member passwords: at least 6 characters** (`MEMBER_PASSWORD_MIN`, app, server and admin reset all agree; owner corrected an inherited 10). The word "at least N characters" appears only in the error message when a password is too short, never inside a password box (placeholders stay plain: "New password").
- **No gift codes (treasure chest) and no Task Center**: they are not in the owner's screenshots, so the app pages, the server routes (`/redeem`, `/team/task/claim`) and the admin screens/routes are removed. Old `promocode` / `team_reward` rows stay in Records with their labels. Do not bring them back unless the owner sends a screenshot.
- **Login boxes keep this device's last member's number and password** after sign-out and after an ended session (`cookie_saved_login`, light
  encoding in localStorage). Nothing signs in by itself; a wrong password forgets the saved password; typing another number clears it.
  Test: `test-saved-login.js`.
- Backing out of Deposit/Withdraw to Home shows the loading box (a real read), then the announcement dialog.

- **Random invite-link addresses** (`https://mt3c.yourdomain.com/h5/#/pages/login/reset?inviteCode=...`, always 4 random characters): a new address every
  time Share opens and every time Copy is tapped. VPS (domain's DNS at Hostinger): `bash /srv/cookie-src/cookie/deploy/set-wildcard.sh yourdomain.com`
  (asks once for a Hostinger API token; `deploy/hostinger-dns.js` makes the `*.domain` A record and answers certbot's DNS check, so ONE wildcard
  certificate `cookie-wild` renews by itself; then the `SHARE_DOMAIN` secret and the nginx `--wild=` block via `update-vps.sh`). Without `SHARE_DOMAIN`
  (or on the IP preview) the link keeps the address the app is open on. Each address is its own browser origin, so a member signed in on one address is not
  signed in on another; invite links are only for new people. Tests: `test-wildcard.js`.
- The payment page's phone box is `type=text`, `autocomplete=off`, and the app's password boxes are switched off while the page is open, so Chrome does not
  offer "Use saved password?" on it.
- nginx files are generated by `deploy/make-nginx.js` and checked by `test-nginx-config.js` (runs the real `nginx -t` when nginx is installed). A regex with
  braces such as `{8,14}` MUST be in double quotes, or nginx reads the brace as a block and refuses the whole file (this happened once on the VPS).
- The random-address nginx file is `/etc/nginx/conf.d/cookie.wild.conf`, written by `update-vps.sh` AFTER certbot (`make-nginx.js ... --wild-only`) and removed
  before it. Reason (reproduced with certbot 2.9): certbot's nginx installer treats a wildcard server block that already has HTTPS as the home of any name it
  matches and overwrites its wildcard certificate with the app's, so every random address failed the certificate check.
- `deploy/show-links.sh [app|admin|github|pesajet|all]` prints the app/admin addresses and the GitHub and PesaJet webhook values from the server.
- **Purchase crash safety:** `/invest/create` writes a note (`purchaseIntents/<investmentId>`) BEFORE debiting the wallet; the debit carries the token
  `debitedInvestmentIds`. If the server dies between the debit and the investment, `reconcilePurchaseIntents()` (30 s sweep) refunds once
  (`refundedInvestmentIds`). A failed instant refund leaves the note in place. Test: `test-first-purchase-reward.js`.
- Withdraw-request push: the lock-screen Approve button is offered only when payouts are automatic; `/admin/withdraw/quick-approve` answers 409 in manual mode.
- **Payment Initiated page:** the green tick stays 2 seconds, then the twelve-blade loader (`PG_SPINNER`, dark newest blade, 12 steps) replaces it. Polling starts straight away (`pgPoll`), the swap is only visual; a result or another view cancels the swap (`_pgSwapTimer`). Test: `test-bug-hunt-fixes.js`.
- **Analytics > Plans card** (admin, same as Mint's): active plans (count, invested, cashback still to pay, plans past their last payment time), most purchased products (times purchased, active now, total invested), maturity dates per Uganda day (a plan matures at its LAST payment, `payoutDueAtMs(created, total, payoutFirstAt)`) and the next 25 plans to mature. Server: `plans` in the `/admin/analytics` reply. Test: `test-admin-plans.js` (the older `test-admin-analytics.js` is stale on this branch and not in the suite). Admin cache v150. Server change: redeploy.
