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
4. With a domain: `deploy/update-vps.sh` (nginx + HTTPS + hardening), `deploy/make-hook-url.sh` (PesaJet webhook), and the GitHub
   webhook to `https://<app host>/k7x2/deploy/webhook` with `DEPLOY_WEBHOOK_SECRET` from the secrets file. Hosts are placeholders
   (`app.mint.example.com`, `admin.mint.example.com`, `hook.mint.example.com`) until the owner buys the domain; admin path `Desk4mx9`.
   Set real hosts via `MINT_APP_HOST` / `MINT_ADMIN_HOST` (see `update-vps.sh`) or `deploy/change-app-host.sh`.

## Status
1. (done) Copied from Soda, renamed to Mint, ports 3002/8092/8093, own secrets/process/fail2ban/nginx names, placeholder hosts, new admin path.
   `npm run test:audit` passes. Design is still Soda's look (renamed) until the owner sends screenshots.
2. (waiting on owner) Atlas user + connection string, VPS first-setup, domain, payment keys (PesaJet/MarzPay), then screenshots.
