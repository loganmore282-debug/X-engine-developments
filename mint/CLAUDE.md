# Mint — project memory (read this first)

**What it is:** Mint is a second app built from **Soda** (same code, same functionality, same money rules, same admin panel). It was
copied from `soda/` at the end of the weekend-rest work (Soda commit 3261fdc) and renamed with `node set-brand.js "Mint"`. The owner
will send screenshots of Mint's pages; the look is changed to match them. **Everything about money, auth, payouts and the admin panel
works exactly as in Soda** — the full Soda history (every rule and why) is in `docs/SODA-LOG.md`; read the "Money-safety" and
"Status log" parts of it before touching payment, payout or withdrawal code.

The owner speaks plainly, wants things done (not lots of questions), keeps answers short, hates abbreviations ("UGX 23,000", never
"23k"), and does not want features nobody asked for.

## Where things are (all under `mint/`)
- `server.js` (backend, MongoDB only, no Firebase), `db.js`, `session-policy.js`, `service-account.js`, `totp.js`
- `user-src/` (member app: `index.html`, `original_module.js`) -> `node build-core.js` -> `user/`
- `admin-src/index.html` -> `node build-admin.js` -> `admin/`
- Always rebuild after editing `-src`, bump the cache name in `user/sw.js` (`mint-shell-vN`) and `admin/sw.js` (`mint-admin-shell-vN`),
  run `npm run test:audit` (4-9 minutes; wait for exit 0), commit, push to **`claude/mint-build`**.
- Install dev tools with `npm install --include=dev` (acorn, jsdom, javascript-obfuscator are needed by the tests/build).
- `node set-brand.js "Name"` renames the app everywhere again if the name ever changes.

## Hosting (same Hostinger VPS as Soda, completely separate)
| | Soda | Mint |
|---|---|---|
| code | `/srv/soda-src/soda` (branch `claude/soda-build`) | `/srv/mint-src/mint` (branch **`claude/mint-build`**) |
| secrets | `/srv/soda-secrets/secrets.local.js` | `/srv/mint-secrets/secrets.local.js` |
| process | pm2 `soda-server`, port 3001 | pm2 **`mint-server`**, port **3002** (loopback only) |
| database | Atlas db `soda`, user `sodaapp` | Atlas db **`mint`**, user **`mintapp`** (readWrite on `mint` only) |
| nginx file | `/etc/nginx/conf.d/soda.conf` | `/etc/nginx/conf.d/mint.conf` (zones `mint_*`, never clash) |
| dev ports | 8090 / 8091 | 8092 / 8093 |
Never run `pm2 reload all`, `pm2 restart all` or `pm2 delete all` on this VPS: it would restart Soda too. Use the names.

### One-time backend setup (owner runs it on the VPS as root)
1. Atlas: Database Access -> add user `mintapp` (readWrite on database `mint` only); Network Access already allows the VPS.
2. One command: `git clone --filter=blob:none --no-checkout --branch claude/mint-build "$(git -C /srv/soda-src remote get-url origin)" /srv/mint-src && cd /srv/mint-src && git sparse-checkout set mint && git checkout && bash mint/deploy/first-setup.sh`
   It installs packages, asks (hidden) for the MongoDB connection string and CHECKS it connects, asks for the admin password, writes
   `/srv/mint-secrets/secrets.local.js`, starts pm2 `mint-server`, and tests `/health`.
3. Later, updates until Mint has its own domain: `bash /srv/mint-src/mint/deploy/quick-update.sh` (restarts only Mint).
4. **Domain (not bought yet; names are NOT decided).** The hosts inside the code (`app.mint.example.com` ...) are placeholders and `update-vps.sh` refuses to run until a real domain is set. When the owner has one:
   `bash /srv/mint-src/mint/deploy/set-domain.sh yourdomain.com` -- it prints the two DNS A records to add (`app` and a random hidden admin label, remembered in `/srv/mint-secrets/admin-host`), changes NOTHING until they point at the VPS, then writes `/srv/mint-secrets/app-host`, runs `update-vps.sh` (nginx `mint.conf`, HTTPS certificate named after the app host, Mint restart, hardening), sets `PUBLIC_URL`, and prints the app and admin addresses (admin path `Desk4mx9`). Root domain is not served (Soda layout). The admin panel's "allowed domains" setting only matters for cross-origin calls; the app and panel call `/k7x2` on their own origin, so nginx + certificate (this command) is what makes a domain work. Afterwards: GitHub webhook to `https://<app host>/k7x2/deploy/webhook` with `DEPLOY_WEBHOOK_SECRET`, and PesaJet via `deploy/make-hook-url.sh`.

5. **Temporary preview by IP (no domain needed):** `bash /srv/mint-src/mint/deploy/preview.sh on` serves the member app at `http://<vps ip>:8092/` and the hidden admin panel at `http://<vps ip>:8092/Desk4mx9/` (one nginx file `mint-preview.conf`, firewall port 8092, plain HTTP -- design work only, never real members or money). `preview.sh off` removes it; `update-vps.sh` removes it automatically when a domain is set up. New design reaches the VPS with `deploy/quick-update.sh`.

## Status
1. (done) Copied from Soda, renamed to Mint, ports 3002/8092/8093, own secrets/process/fail2ban/nginx names, placeholder hosts, new admin path.
   `npm run test:audit` passes.
2. (done, owner confirmed) Atlas user `mintapp` (readWrite on `mint` only) and its connection string; VPS first-setup ran, pm2 `mint-server` is online and
   `/health` answers `{"status":"ok","db":true}`; temporary IP preview on port 8092 (admin `/Desk4mx9/`); GitHub deploy webhook added through the preview port.
   Chosen domain: `dble-mint.com` (not wired in; run `deploy/set-domain.sh dble-mint.com` when the owner has pointed DNS).
3. (done) Login + Sign Up built from the owner's batch-1 screenshots (tab bar, admin banner `authhero`, circle logo `authlogo`, green fields/icons/scrollbar,
   server captcha `captcha.js`, +256, UGX, password min 6 with no weak-password list). Loader unchanged ("Loading..." + admin background).
4. (done) All of the owner's screens (batches 2-4: `docs/SCREENS-BATCH2.md`, `SCREENS-BATCH3.md`, `SCREENS-BATCH4.md`, pictures in `design-ref/`) are built: green/cream design (`/* MG-START */ ... /* MG-END */` block of
   `user-src/index.html`), six tabs (Home, Orders, Promotion, Team, Salary, Profile), Home with message icon + site name + bouncing chest, Treasure Chest page and win card, Wallet, Withdraw, Deposit (+ redirect overlay),
   Balance Record, Messages (with pictures), password pages, Download page, welcome dialog, red-OK notice dialog. Salary is new (see SCREENS-BATCH4.md); Task Center is removed.
4b. (done) Scrollbar: phone browsers hide the page-level scrollbar, so `mgScrollbarInit()` in `original_module.js` draws a green 4px bar (`#mgSb`, plus `#mgSbList` for the bank list) that follows the open sheet, the Login/Sign Up scroller or the document; the native bars on those scrollers are hidden in the MG block. Pages that overflow by under 24px show no bar.
4c. (done) Notices (`notify`) close by themselves after 2.6 s + 40 ms per character (max 5.5 s; OK or a tap outside closes sooner; auto-close does not run the OK callback). Nav icons bounce like a tapped product card (`navTapSignal`, `.42s cubic-bezier(.34,1.56,.64,1)`). Signing up never shows the startup loader.
5. (next) Anything the owner sends after this is a change to these screens; compare against `design-ref/` with side-by-side renders (Playwright, 360x701 at 2x) before saying it matches.
   Payment keys (PesaJet/MarzPay) are set later by the owner.
