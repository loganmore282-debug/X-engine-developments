# Beer — project memory (read this first)

**What it is:** Beer is the next app of the same code family. The owner's words: "Now build another called beer, you will reuse cookie design, you will use those
colours so that color of second is button the other is color" (two pictures: a flat khaki `#a29060`, and a photo of beer glass droplets in amber).
So Beer is an exact copy of **Cookie** (`cookie/`, branch `claude/cookie-build`, Cookie commit `e891a04`: same server, money rules, admin panel, pages and layout)
renamed with `node set-brand.js "Beer"`, with ONE change of look: **the main colour is khaki (first picture) and the buttons are amber (second picture)**.
It inherits Cookie's whole history below: where it says "Cookie", read Beer. Cookie's own notes about being a Soda/Mint copy still apply.

## The colours (decided by the owner, keep them)
- **Main colour = khaki `#a29060`** (the first picture): title bars, headers, cards' accents, tabs, nav pill, login background (`--ck-auth`), loader. Text that used to be the
  blue is a darker khaki (`#5e5332`-ish) so it stays readable on white.
- **Buttons = the beer picture itself** (owner: "I wanted buttons to look exactly like this"): the droplet photo is the background of every button (`--bt-img`, a base64 JPEG in the last block of `user-src/index.html`, white text with a dark shadow). Before that they were a flat amber
  gradient. The old amber variables `--bt-grad` / `--bt-solid` remain for the admin panel. (Original note:) **Buttons = amber** (from the beer picture, `#e3992f -> #c86715 -> #983e10`): Login / Create Account, Buy now, Pay, Confirm, Withdraw / Deposit action buttons,
  copy buttons, the active pay-method pill. Variables `--bt-grad` and `--bt-solid` (end of the member app's last `<style>`, and the admin's first one).
- How it was done (so it can be redone if Cookie's design changes): `tools` are not kept; the rule was "every blue in `user-src/index.html`, `user-src/original_module.js` and
  `admin-src/index.html` is mapped to the khaki hue with the same lightness, and the rules of the button classes (`.va-btn .v-btn .v-solid .v-cta .v-buy .ck-pay .ck-confirm
  .ck-ann-join .v-ann-join .v-logout .v-help-close .v-me-wit .ck-copyrow button .v-share-box button .v-bind .ck-pays button.on .v-pays button.on .dep-chip.sel .btn ...)
  use amber (`var(--bt-grad)` / `var(--bt-solid)`)". Check by opening the app in a phone-size browser: nothing blue may be left.
- App icon = a white beer mug on the amber gradient (`user/` and `admin/` `icon-192.png`, `icon-512.png`), link preview picture `user/link-preview.jpg` (BEER + the tagline).
- Everything else (UGX, +256, English, Cookie's pages and rules) is unchanged from Cookie.

## Daily wage removed (owner: "Remove daily wage category")
There is ONE kind of product now. The Home and Income pages have no "Daily Income / Daily wage" tabs; the admin Products page has no "Task products" section or button;
the server treats every product as `category: 'income'` (a product that costs nothing is never offered or bought; `/invest/create` has no "sold out" task branch;
admin "Give product" always counts as a real purchase). Tests `test-task-products.js` and `test-income-categories.js` were deleted. Caches: user v4, admin v3.

## Bottom-bar icons use the beer picture too (owner: "let svg also take same, those navigation svgs should be that colour like buttons")
The five tab icons are filled with the same droplet photo as the buttons: one hidden SVG pattern `#beerPat` (a 200 px copy of the picture) sits above `#app` in `user-src/index.html`, and the last CSS block fills every `fill="currentColor"` / `stroke="currentColor"` icon of `.navitem .nav-ic` with it. The open tab's icon is full strength on a light cream pill; the others are the same picture faded and half grey. Cache v16 (Share page laid out like the owner's picture: card with My QR code, big code, dashed cut with two notches (CSS mask), QR drawn by the SERVER (GET /share/qr?text=<invitation link>, npm package qrcode, so the webhook's npm install must run), link + Copy, commission panel with Level rows; the page background is the picture). Cache v15 (Team page laid out like the owner's picture: big round picture (admin 'Team page picture') + Team Recharge / Team size, level tabs, member cards with the admin 'Member picture' as a round image on the right; the loader circle shows the admin-uploaded image again (the beer picture only when none) - never put a !important background on an element that carries an admin image in an inline style). Cache v14 (RULE FROM THE OWNER: everything that was BLUE in Cookie is the beer picture (login page, banner, product images, team boxes, share page, My hero, avatars, frames and side bars, active nav pill); everything that was WHITE is khaki. Last CSS block of user-src/index.html holds it. Cache v13 (TWO COLOURS ONLY: the couch khaki #a29060 is every surface (page, cards #b3a47c, rows and inputs #988753, nav bar), the beer picture is every accent; text is dark wine #2c1105 (white only on the picture); Deposit and Withdraw circles untouched. Done by `/tmp/claude-0/beer-tools/whiteout.py` plus the last CSS block, do not re-run it. Cache v12 (the Deposit circle shows the owner's own currency sign picture instead of the UGX text; every page header bar is the picture too; the Service and Group buttons on Home are the picture too; every action button incl. Confirm / Cancel / Bind Wallet Card and the selected tab fills; the balance board of the My page too; also the My page icons and the bar that marks the open tab use the picture).

## Where things are (all under `beer/`)
- `server.js` (backend, MongoDB only, no Firebase), `db.js`, `session-policy.js`, `service-account.js`, `totp.js`
- `user-src/` (member app: `index.html`, `original_module.js`) -> `node build-core.js` -> `user/`
- `admin-src/index.html` -> `node build-admin.js` -> `admin/`
- Always rebuild after editing `-src`, bump the cache name in `user/sw.js` (`beer-shell-vN`) and `admin/sw.js` (`beer-admin-shell-vN`),
  run `npm run test:audit` (4-9 minutes; wait for exit 0), commit, push to **`claude/beer-build`**.
- Install dev tools with `npm install --include=dev` (acorn, jsdom, javascript-obfuscator are needed by the tests/build).
- `node set-brand.js "Name"` renames the app everywhere again if the name ever changes.

## Before giving anything to the owner (he said so, firmly)
1. `npm run test:audit` must pass.
2. `npm run test:live` must pass: it drives the real app in a real browser with real taps (login, Buy + confirm and the purchase really happens, every tab, Deposit -> Pay -> payment pages, Withdraw, personal info, wallet, language, Share QR) and fails on any script error. Run it after EVERY change, not only after big ones. It also runs `test-admin-live.js`: the built admin panel in a real browser (login, every tab opens, a real withdrawal is made and **Mark as paid** records it by hand, no gateway words, no script errors).
3. Look at the screenshots it saves. Never delete CSS, animations or rules the owner did not ask to remove.

## Hosting (same Hostinger VPS as Soda, Mint, Cookie, Potato, Chocolate and Smart AI, completely separate)
| | Cookie | Beer |
|---|---|---|
| code | `/srv/cookie-src/cookie` (`claude/cookie-build`) | `/srv/beer-src/beer` (branch **`claude/beer-build`**) |
| secrets | `/srv/cookie-secrets/secrets.local.js` | `/srv/beer-secrets/secrets.local.js` |
| process / port | pm2 `cookie-server`, 3003 | pm2 **`beer-server`**, port **3007** (loopback only) |
| database | Atlas db `cookie`, user `cookieapp` | Atlas db **`beer`**, user **`beerapp`** (readWrite on `beer` only) |
| nginx file | `/etc/nginx/conf.d/cookie.conf` | `/etc/nginx/conf.d/beer.conf` (zones `beer_*`) |
| dev ports | 8094 / 8095 | 8102 / 8103 |
| admin path | `Bake7qz3` | **`Hq4vN8rt`** |
Port plan: Soda 3001/8090/8091, Mint 3002/8092/8093, Cookie 3003/8094/8095, Potato 3004/8096/8097, Chocolate 3005/8098/8099, Smart AI 3006/8100/8101, **Beer 3007/8102/8103**. API prefix `/k7x2`.
**The VPS address is `179.198.197.114`.** Never run `pm2 reload all`, `pm2 restart all` or `pm2 delete all`: use the names.

### One-time backend setup (owner runs it on the VPS as root)
1. Atlas: Database Access -> add user `beerapp` (readWrite on database `beer` only); Network Access already allows the VPS.
2. One command: `git clone --filter=blob:none --no-checkout --branch claude/beer-build "$(git -C /srv/soda-src remote get-url origin)" /srv/beer-src && cd /srv/beer-src && git sparse-checkout set beer && git checkout && bash beer/deploy/first-setup.sh`
   It installs packages, asks (hidden) for the MongoDB connection string and CHECKS it connects, asks for the admin password, writes
   `/srv/beer-secrets/secrets.local.js`, starts pm2 `beer-server`, and tests `/health`.
3. Later, updates until Beer has its own domain: `bash /srv/beer-src/beer/deploy/quick-update.sh` (restarts only Beer).
4. **Domain (not bought yet; names are NOT decided).** The hosts inside the code (`app.beer.example.com` ...) are placeholders and `update-vps.sh` refuses to run until a real domain is set. When the owner has one:
   `bash /srv/beer-src/beer/deploy/set-domain.sh yourdomain.com` -- it prints the two DNS A records to add (`app` and a random hidden admin label, remembered in `/srv/beer-secrets/admin-host`), changes NOTHING until they point at the VPS, then writes `/srv/beer-secrets/app-host`, runs `update-vps.sh` (nginx `beer.conf`, HTTPS certificate named after the app host, Beer restart, hardening), and prints the app and admin addresses (admin path `Hq4vN8rt`). Root domain is not served (Soda layout). The admin "allowed domains" setting only matters for cross-origin calls; nginx + certificate (this command) is what makes a domain work. Afterwards: GitHub webhook to `https://<app host>/k7x2/deploy/webhook` with `DEPLOY_WEBHOOK_SECRET`, and PesaJet via `deploy/make-hook-url.sh`.

5. **Temporary preview by IP (no domain needed):** `bash /srv/beer-src/beer/deploy/preview.sh on` serves the member app at `http://<vps ip>:8102/` and the hidden admin panel at `http://<vps ip>:8102/Hq4vN8rt/` (one nginx file `beer-preview.conf`, firewall port 8102, plain HTTP -- design work only, never real members or money). `preview.sh off` removes it; `update-vps.sh` removes it automatically when a domain is set up. New design reaches the VPS with `deploy/quick-update.sh`.

## Ethiopia (owner: "change to Br Ethiopia, also the payment page that of Ethiopia like in Potato")
Beer is an ETHIOPIA app now: region `et` (+251, nine digits starting 9 or 7), currency code ETB written **Br** (`currencyLabel()` on the server, `cur()` in the app reads `REGION.currencySymbol`), admin panel labels Br.
- **Recharge** = bank / Telebirr payment numbers, ported from Potato: admin tab **Payment Numbers** (name, Bank or Wallet, account name, account number, logo with background cut out) -> `/admin/pay-channels/*`; members: Deposit -> amount -> Pay -> pages "Please choose payment" -> pay page (copy account, 30 minute clock, paste the SMS) -> `/deposit/manual/order` + `/deposit/manual/submit` -> the claim sits in admin **Deposits** (status review) where **Force-credit** approves it (the only thing that credits money). Picking/switching an address makes a NEW order with a fresh clock; coming back after leaving (`resumeManualPay`, localStorage `mp_resume`) resumes the same open order. `settings.manualPay` is true as soon as one payment number exists. The old Uganda gateway code is gone (see the last section).
- **Withdrawal accounts** (Wallet page): Telebirr (+251 phone) and Commercial Bank of Ethiopia (account number, 4-64 letters/digits). Payouts are always manual: an admin sends the money by hand, then taps **Mark as paid** (`/admin/withdraw/process`); `payoutManual` is always true.
- The payment pages are Potato's, coloured with the two Beer colours (khaki page/cards, beer picture for the pay-page background, buttons and clock boxes). CSS block `MANUAL BANK / WALLET PAYMENT PAGES` at the end of `user-src/index.html`.
- Test: `test-ethiopia.js` (real server on the fake MongoDB in `test-helpers/`): region, order/resume/new order, SMS parsing, duplicate transfer refused, approve credits once, withdrawal accounts.

- **Transition of flow (owner):** an uploaded picture never ends in a hard edge. Login/Create Account: `#authHeroBg` has a bottom mask so the uploaded image melts into the beer picture under it; My page: `.ck-me::after` fades the hero into the khaki page. Do not set `display:none` on those fades.

- The Share page has no banner and no admin upload for one (slot `sharehero` removed from server, app and admin).

- The Team page has no banner upload either (slot `teamhero` removed): its big circle and every member's round picture both come from the one admin 'Member picture' (`avatar`), the beer picture when none is uploaded.

- **Beer picture enhanced (cache v21):** the owner's 578x296 beer photo is the only source; `--bt-img` is now a 1300 px version (median-filtered to remove JPEG blocks, Lanczos upscale, mild unsharp, contrast +7%, colour +8%) and the nav-icon pattern `#beerPat` a 260 px copy of it. Do not re-encode the already enhanced copy again. **The automatic CSS 'dead rule' cleanup was REVERTED (cache v23): it deleted the `.confirm-bg` rules (the Buy confirm dialog drew itself 2700 px down the page, so Buy froze), animations (ckPop, ckSheetIn, toastIn ...) and other rules the app really needs, because those rules are reached by id or in ways a word search cannot see. NEVER delete CSS automatically.**

- **Amharic (cache v22):** second language of the Ethiopia app. `LANGS` has `am`; the region's `languages` is `['en','am']` (server `DEFAULT_REGION` and the app's `REGION`); every row of `LANG_ROWS`/`LANG_PATTERNS` has a 7th cell (Amharic) - words came from Petro's dictionary (`/tmp/claude-0/am`, 696 phrases) plus Beer-specific ones typed by hand (Team, Share, Deposit pages). Fonts: Noto Sans Ethiopic is loaded from Google Fonts and named in the body font stack (Nyala / Abyssinica as fallbacks). A new screen string reads English until a row (English first, 7 cells, empty cells fall back) is added. Test: `test-amharic.js`.

## Status
1. (done) Copied from Cookie, renamed to Beer, ports 3007/8102/8103, own secrets/process/fail2ban/nginx names, placeholder hosts, new admin path `Hq4vN8rt`.
2. (done) Khaki + amber colours, mug icon, link preview, caches `beer-shell-v23` / `beer-admin-shell-v8`. `npm run test:audit` passes.
3. (done by owner) GitHub webhook `http://179.198.197.114:8102/k7x2/deploy/webhook` (push event, branch claude/beer-build) auto-deploys the VPS; a webhook only reacts to pushes made AFTER it was added. (waiting on owner) Atlas user `beerapp` + connection string, VPS first-setup (the command in "One-time backend setup" with `beer`), domain, payment keys. Nothing of Beer is on the VPS yet.

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
- **Login boxes keep this device's last member's number and password** after sign-out and after an ended session (`beer_saved_login`, light
  encoding in localStorage). Nothing signs in by itself; a wrong password forgets the saved password; typing another number clears it.
  Test: `test-saved-login.js`.
- Backing out of Deposit/Withdraw to Home shows the loading box (a real read), then the announcement dialog.

- **Random invite-link addresses** (`https://mt3c.yourdomain.com/h5/#/pages/login/reset?inviteCode=...`, always 4 random characters): a new address every
  time Share opens and every time Copy is tapped. VPS (domain's DNS at Hostinger): `bash /srv/beer-src/beer/deploy/set-wildcard.sh yourdomain.com`
  (asks once for a Hostinger API token; `deploy/hostinger-dns.js` makes the `*.domain` A record and answers certbot's DNS check, so ONE wildcard
  certificate `beer-wild` renews by itself; then the `SHARE_DOMAIN` secret and the nginx `--wild=` block via `update-vps.sh`). Without `SHARE_DOMAIN`
  (or on the IP preview) the link keeps the address the app is open on. Each address is its own browser origin, so a member signed in on one address is not
  signed in on another; invite links are only for new people. Tests: `test-wildcard.js`.
- nginx files are generated by `deploy/make-nginx.js` and checked by `test-nginx-config.js` (runs the real `nginx -t` when nginx is installed). A regex with
  braces such as `{8,14}` MUST be in double quotes, or nginx reads the brace as a block and refuses the whole file (this happened once on the VPS).
- The random-address nginx file is `/etc/nginx/conf.d/beer.wild.conf`, written by `update-vps.sh` AFTER certbot (`make-nginx.js ... --wild-only`) and removed
  before it. Reason (reproduced with certbot 2.9): certbot's nginx installer treats a wildcard server block that already has HTTPS as the home of any name it
  matches and overwrites its wildcard certificate with the app's, so every random address failed the certificate check.
- `deploy/show-links.sh [app|admin|github|all]` prints the app/admin addresses and the GitHub webhook values from the server.
- **Purchase crash safety:** `/invest/create` writes a note (`purchaseIntents/<investmentId>`) BEFORE debiting the wallet; the debit carries the token
  `debitedInvestmentIds`. If the server dies between the debit and the investment, `reconcilePurchaseIntents()` (30 s sweep) refunds once
  (`refundedInvestmentIds`). A failed instant refund leaves the note in place. Test: `test-first-purchase-reward.js`.
- Withdraw-request push: no lock-screen Approve button (payouts are manual); `/admin/withdraw/quick-approve` always answers 409.
- **Analytics > Plans card** (admin, same as Mint's): active plans (count, invested, cashback still to pay, plans past their last payment time), most purchased products (times purchased, active now, total invested), maturity dates per Uganda day (a plan matures at its LAST payment, `payoutDueAtMs(created, total, payoutFirstAt)`) and the next 25 plans to mature. Server: `plans` in the `/admin/analytics` reply. Test: `test-admin-plans.js` (the older `test-admin-analytics.js` is stale on this branch and not in the suite). Admin cache v150. Server change: redeploy.
- **Admin can remove a member's saved withdrawal account** (same as Mint): member panel > Saved withdrawal accounts has a red Remove button per account (owner only) -> `POST /admin/user/remove-bank-account` {userId, accountId}: deletes that `bankAccounts` row under the `bank-save:<userId>` lock, refuses another member's account (404), audit `bank_account_removed`; withdrawals already requested are untouched. Test: `test-admin-remove-bank.js`. Admin cache v151. Server change: redeploy.

## Uganda payment gateways removed (2026-11-14)
Owner: "it is still having Uganda payment methods and withdrawals, remove them completely", then "remove" the CSS, the tick/cross art and the old database fields too.
Gone from server, member app, admin, deploy scripts, tests and docs: MarzPay, PesaJet (deposits, payouts, webhooks, reconcilers, balance/summary cards, hook-token
nginx address, `pay-seal.js`, card/mobile-money payment page and status polling, the tick/cross and phone-to-wallet art, MTN/Airtel names, automatic withdrawals,
Recharge-gateway and Withdrawal-method settings, `depositMethod`/`withdrawMethod`/`autoApprove*`). The CSS of those pages (`#payScreen`, `.pg-*`, `.pay-page`,
`.dep-flow*`, `.dep-status-icon`, their keyframes) was removed with a selector-targeted tool (comments are stripped before splitting selectors: an apostrophe in a
comment once made it drop an unrelated scroll-lock rule), checked by pixel-comparing screenshots before and after (identical).
Old database leftovers are removed ONCE at start-up by `removeGatewayLeftovers()` in `db.js` (marker row `meta/gatewayLeftoversRemoved`): gateway fields on withdrawals /
deposits / ledger rows, the gateway settings and the gateway indexes. Test: `test-gateway-cleanup.js`.
What is left: recharge = manual bank/Telebirr orders (admin Payment Numbers, then admin Deposits > Force-credit); withdrawals = request -> admin **Mark as paid**
or **Reject** (refund).
Bug hunt after it (HTTP, money, auth, layout, operations; scripts were throw-away): the Buy confirm text no longer breaks in the middle of a word (`.ck-prompt-msg` used
`word-break:break-all`, now `overflow-wrap:anywhere`). No money, HTTP or layout bug was found.
