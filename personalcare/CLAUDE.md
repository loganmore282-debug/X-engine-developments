# PersonalCare — project memory (read this first)

**What it is:** PersonalCare is a copy of **Cookie** (itself Soda -> Mint -> Cookie): same app, same look, same money rules, same admin panel; only the name changed
(`node set-brand.js "PersonalCare"`). The ONE real difference is the database (see below).

## The database: NO MongoDB, it lives on the VPS (owner: "vps will work as server and database, so no using mongodb since we have strong vps")
- `localstore.js` is the whole database: every collection is held in memory (instant reads) and every change is written to an append-only journal on the VPS disk and
  forced to disk. Default mode `fast` (env `PERSONALCARE_SYNC`): a change is answered as soon as it is in the OS file cache (survives the program being killed, kill -9 included) and the fsync follows within
  a moment, off the request path; only a power cut / VM crash in that moment can lose the last few milliseconds. `PERSONALCARE_SYNC=strict` answers only after the disk confirmed (slower). Sorted+limited reads keep only the top rows. `db.js` keeps the exact Firestore-style API server.js always used
  (`connectMongo()` is still the function name, it now opens the folder). Nothing in server.js's money logic changed.
- Folder `/srv/personalcare-data` (env `PERSONALCARE_DATA_DIR`, kept in `/srv/personalcare-secrets/secrets.local.js`): `snapshot-N.jsonl` + `journal-N.jsonl` + `LOCK`. A restart
  replays the journal; a half-written last line (power cut) is cut off; a compaction that died half way is ignored (the last complete snapshot wins).
- **Backups:** every night at 03:30 (server time) the journal is folded into a new snapshot and a dated `backup-YYYYMMDD-HHMMSS.jsonl.gz` is written to
  `/srv/personalcare-backups` (newest 14 kept). Now: `bash deploy/backup-now.sh` (sends SIGUSR2). Restore: `bash deploy/restore-backup.sh <file>` (the current data is renamed, never deleted).
  Status: `bash deploy/db-status.sh`. A backup on the SAME disk does not survive the disk: copy one off the server now and then (`scp`).
- ONE server process only (the LOCK file refuses a second one; `instances: 1` in pm2 stays). Memory: the whole database is in RAM (500,000 documents ~ 450 MB). Compaction
  (nightly, or when the journal passes 64 MB) pauses the server for about 1.5 s per 500,000 documents.
- Supported query/update features are the ones db.js uses ($ne $gt $gte $lt $lte $in $nin $exists $not $regex $size $all $type, $and $or $nor; $set $inc $unset $addToSet $pull $push
  $setOnInsert; unique + partial-unique + TTL indexes). An operator it does not know THROWS. If you add a query feature, add it to `localstore.js` and `test-localstore.js`.
- A write that cannot reach the disk is never acknowledged; the store then reports unhealthy (`/health` db:false) until the server is restarted after the disk problem is fixed.
- Tests: `test-localstore.js` (semantics, indexes = scan, unique, TTL, crash/torn line/half-written snapshot, lock, disk failure, backup+restore), `test-localdb-e2e.js` (the REAL server on a temp folder:
  sign-ups, referral, admin credit, 5 simultaneous purchases with money for 2, kill -9 + restart, clean stop).

The owner speaks plainly, wants things done (not lots of questions), keeps answers short, hates abbreviations ("UGX 23,000", never
"23k"), and does not want features nobody asked for.

## Where things are (all under `personalcare/`)
- `server.js` (backend; its own local database `localstore.js`, no MongoDB, no Firebase), `db.js`, `localstore.js`, `session-policy.js`, `service-account.js`, `totp.js`
- `user-src/` (member app: `index.html`, `original_module.js`) -> `node build-core.js` -> `user/`
- `admin-src/index.html` -> `node build-admin.js` -> `admin/`
- Always rebuild after editing `-src`, bump the cache name in `user/sw.js` (`personalcare-shell-vN`) and `admin/sw.js` (`personalcare-admin-shell-vN`),
  run `npm run test:audit` (4-9 minutes; wait for exit 0), commit, push to **`claude/personalcare-build`**.
- Install dev tools with `npm install --include=dev` (acorn, jsdom, javascript-obfuscator are needed by the tests/build).
- `node set-brand.js "Name"` renames the app everywhere again if the name ever changes.

## Hosting (same Contabo VPS as the other apps, completely separate)
| | Cookie | PersonalCare |
|---|---|---|
| code | `/srv/cookie-src/cookie` | `/srv/personalcare-src/personalcare` (branch **`claude/personalcare-build`**) |
| secrets | `/srv/cookie-secrets/` | `/srv/personalcare-secrets/secrets.local.js` |
| process / port | pm2 `cookie-server`, 3003 | pm2 **`personalcare-server`**, **3008** (loopback only) |
| database | Atlas `cookie` | **folder `/srv/personalcare-data`** (no MongoDB), backups `/srv/personalcare-backups` |
| nginx file | `cookie.conf` | `/etc/nginx/conf.d/personalcare.conf` (zones `personalcare_*`) |
| dev ports | 8094 / 8095 | 8104 / 8105 |
Never run `pm2 reload all`, `pm2 restart all` or `pm2 delete all` on this VPS: it would restart the other apps too. Use the names.

### One-time backend setup (owner runs it on the VPS as root)
1. One command: `git clone --filter=blob:none --no-checkout --branch claude/personalcare-build "$(git -C /srv/potato-src remote get-url origin)" /srv/personalcare-src && cd /srv/personalcare-src && git sparse-checkout set personalcare && git checkout && bash personalcare/deploy/first-setup.sh`
   It installs packages, creates `/srv/personalcare-data` and `/srv/personalcare-backups`, asks (hidden) for the admin password, writes `/srv/personalcare-secrets/secrets.local.js`, starts pm2 `personalcare-server`, tests `/health`.
2. Updates: `bash /srv/personalcare-src/personalcare/deploy/quick-update.sh` (restarts only PersonalCare), or the GitHub webhook (`show-links.sh github`).
3. Domain (not decided yet): `bash /srv/personalcare-src/personalcare/deploy/set-domain.sh yourdomain.com` prints the DNS A records to add (same flow as the other apps); `deploy/preview.sh on` serves a preview at `http://<vps ip>:8104/`.
4. Everything about money, auth and the admin panel is documented in the Cookie/Soda history below (read it before touching payments).

## Status
1. (done) Copied from Soda, renamed to PersonalCare, ports 3003/8094/8095, own secrets/process/fail2ban/nginx names, placeholder hosts, new admin path.
   `npm run test:audit` passes. Design is still Soda's look (renamed) until the owner sends screenshots.
2. (waiting on owner) VPS first-setup, domain, payment keys (PesaJet/MarzPay), then screenshots.

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
  time Share opens and every time Copy is tapped. VPS (domain's DNS at Hostinger): `bash /srv/personalcare-src/personalcare/deploy/set-wildcard.sh yourdomain.com`
  (asks once for a Hostinger API token; `deploy/hostinger-dns.js` makes the `*.domain` A record and answers certbot's DNS check, so ONE wildcard
  certificate `personalcare-wild` renews by itself; then the `SHARE_DOMAIN` secret and the nginx `--wild=` block via `update-vps.sh`). Without `SHARE_DOMAIN`
  (or on the IP preview) the link keeps the address the app is open on. Each address is its own browser origin, so a member signed in on one address is not
  signed in on another; invite links are only for new people. Tests: `test-wildcard.js`.
- The payment page's phone box is `type=text`, `autocomplete=off`, and the app's password boxes are switched off while the page is open, so Chrome does not
  offer "Use saved password?" on it.
- nginx files are generated by `deploy/make-nginx.js` and checked by `test-nginx-config.js` (runs the real `nginx -t` when nginx is installed). A regex with
  braces such as `{8,14}` MUST be in double quotes, or nginx reads the brace as a block and refuses the whole file (this happened once on the VPS).
- The random-address nginx file is `/etc/nginx/conf.d/personalcare.wild.conf`, written by `update-vps.sh` AFTER certbot (`make-nginx.js ... --wild-only`) and removed
  before it. Reason (reproduced with certbot 2.9): certbot's nginx installer treats a wildcard server block that already has HTTPS as the home of any name it
  matches and overwrites its wildcard certificate with the app's, so every random address failed the certificate check.
- `deploy/show-links.sh [app|admin|github|pesajet|all]` prints the app/admin addresses and the GitHub and PesaJet webhook values from the server.
- **Purchase crash safety:** `/invest/create` writes a note (`purchaseIntents/<investmentId>`) BEFORE debiting the wallet; the debit carries the token
  `debitedInvestmentIds`. If the server dies between the debit and the investment, `reconcilePurchaseIntents()` (30 s sweep) refunds once
  (`refundedInvestmentIds`). A failed instant refund leaves the note in place. Test: `test-first-purchase-reward.js`.
- Withdraw-request push: the lock-screen Approve button is offered only when payouts are automatic; `/admin/withdraw/quick-approve` answers 409 in manual mode.
- **Payment Initiated page:** the green tick stays 2 seconds, then the twelve-blade loader (`PG_SPINNER`, dark newest blade, 12 steps) replaces it. Polling starts straight away (`pgPoll`), the swap is only visual; a result or another view cancels the swap (`_pgSwapTimer`). Test: `test-bug-hunt-fixes.js`.
- **Analytics > Plans card** (admin, same as Mint's): active plans (count, invested, cashback still to pay, plans past their last payment time), most purchased products (times purchased, active now, total invested), maturity dates per Uganda day (a plan matures at its LAST payment, `payoutDueAtMs(created, total, payoutFirstAt)`) and the next 25 plans to mature. Server: `plans` in the `/admin/analytics` reply. Test: `test-admin-plans.js` (the older `test-admin-analytics.js` is stale on this branch and not in the suite). Admin cache v150. Server change: redeploy.
- **Admin can remove a member's saved withdrawal account** (same as Mint): member panel > Saved withdrawal accounts has a red Remove button per account (owner only) -> `POST /admin/user/remove-bank-account` {userId, accountId}: deletes that `bankAccounts` row under the `bank-save:<userId>` lock, refuses another member's account (404), audit `bank_account_removed`; withdrawals already requested are untouched. Test: `test-admin-remove-bank.js`. Admin cache v151. Server change: redeploy.

## Product payout rules (owner, Nov 2026): Hourly income and Locking
- A product's total payout INCLUDES the purchase price (5,000 for 2 days with total 5,400 = 400 profit = 200 a day). `planSchedule()` in server.js is the one place that works it out.
- Hourly income (stored category `income`): the profit is paid in equal shares every hour (cycle x 24 payments) straight into the wallet; the purchase price comes back with the very last share. The price coming back is its own ledger row of type `investment_return` and is not counted as earned.
- Locking (stored category `wage`, formerly "Daily wage" task products): bought by members like any other product; nothing is paid along the way; profit + price are released together when the cycle ends (one payment). The admin can no longer activate these for a member.
- A purchase stores `payoutModel:'principal-last'`, `periodMs`, `principal`, `earnings`. Rows without `payoutModel` (bought before this rule) keep the old schedule exactly (the whole total paid daily, no price back). A product the admin gives free pays its hourly profit only (principal 0).
- The "first purchase pays at once" admin switch is gone. The member app tabs read "Hourly Income" and "Locking". Caches: `personalcare-shell-v430`, `personalcare-admin-shell-v155`.
- The withdrawal limit is per month (`maxWithdrawalsPerMonth`, 0 = no limit), no longer per day.

## Deposit flow (owner, Nov 2026): no separate payment page
- The Deposit page has the deposit number (starts as the member's own number) and the MTN / Airtel pick (chosen from the first digits of the number; the member can change it). Pay sends ONE sealed request to `/deposit/marzpay` with amount, phone and network (no order is made first) and opens the polling screen (`openDepositPolling`, the `#payScreen` overlay: "Payment Initiated", then success / failed / still waiting). Back to Home reads the new balance.
- Gone from the member app: the order page form, its 10-minute countdown, the `/payment/<number>` address, pull-down refresh. The server routes `/deposit/order/*` and the `/payment/` nginx rule are still there but nothing in the app calls them. Test: `test-deposit-number.js`. Cache `personalcare-shell-v430`.
