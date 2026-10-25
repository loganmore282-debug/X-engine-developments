# Potato — project memory (read this first)

**What it is:** Potato is the third app built from the same code family (Soda -> Mint -> **Potato**). It was copied from **Mint** (`mint/`, branch
`claude/mint-build`, Mint commit `f1a4e60`) and renamed with `node set-brand.js "Potato"`. **Everything about money, auth, payouts, the admin
panel and the member screens is Mint's, unchanged**; the owner will send Potato's own screenshots and the look is changed to match them. Mint's full
history of rules and reasons is in `../mint/CLAUDE.md` (status log 1-4aw) and `docs/SODA-LOG.md`: read the "Money-safety" parts before touching payment,
payout or withdrawal code. Also in this copy: Products / New Products on Home, TavuPay as a recharge gateway (recharges only), the admin
"remove saved withdrawal account" button, random 5-digit account ids, 5-character referral codes.

The owner speaks plainly, wants things done (not lots of questions), keeps answers short, hates abbreviations ("UGX 23,000", never "23k"), wants
SVG icons, exact match to his screenshots, everything configurable from admin, and does not want features nobody asked for. **Never tell him to upload
files or run quick-update.sh by hand: a push to `claude/potato-build` deploys by itself through the GitHub webhook.**

## Where things are (all under `potato/`)
- `server.js` (backend, MongoDB only), `db.js`, `captcha.js`, `session-policy.js`, `service-account.js`, `totp.js`
- `user-src/` (member app) -> `node build-core.js` -> `user/`;  `admin-src/index.html` -> `node build-admin.js` -> `admin/`
- Always rebuild after editing `-src`, bump the cache names (`user/sw.js` `potato-shell-vN`, `admin/sw.js` `potato-admin-shell-vN`), run
  `npm run test:audit` (wait for exit 0, run it in the background and read the `EXIT` line; the chain stops at the first failing test), commit, push
  to **`claude/potato-build`**. `npm install --include=dev` for the dev tools.
- `node set-brand.js "Name"` renames the app everywhere again.

## Hosting (same Hostinger VPS as Soda, Mint and Cookie, completely separate)
| | Soda | Mint | Cookie | Potato |
|---|---|---|---|---|
| code | `/srv/soda-src/soda` | `/srv/mint-src/mint` | `/srv/cookie-src/cookie` | `/srv/potato-src/potato` (branch **`claude/potato-build`**) |
| secrets | `/srv/soda-secrets` | `/srv/mint-secrets` | `/srv/cookie-secrets` | `/srv/potato-secrets/secrets.local.js` |
| process | pm2 `soda-server` 3001 | `mint-server` 3002 | `cookie-server` 3003 | pm2 **`potato-server`**, port **3004** (loopback only) |
| database | Atlas `soda` / `sodaapp` | `mint` / `mintapp` | `cookie` / `cookieapp` | Atlas db **`potato`**, user **`potatoapp`** (readWrite on `potato` only) |
| nginx | `soda.conf` | `mint.conf` | `cookie.conf` | `/etc/nginx/conf.d/potato.conf` (zones `potato_*`) |
| dev ports | 8090/8091 | 8092/8093 | 8094/8095 | **8096 / 8097** |
Never run `pm2 reload all`, `pm2 restart all` or `pm2 delete all`: use the names. Hosts in the code (`app.potato.example.com`) are placeholders until
`deploy/set-domain.sh` is run with the real domain. Admin path `Tq5m8zr`; API prefix `/k7x2` (same as the others).

### One-time backend setup (owner runs it on the VPS as root, from Termux with `ssh`)
1. Atlas: Database Access -> add user `potatoapp` (readWrite on database `potato` only); Network Access already allows the VPS.
2. `git clone --filter=blob:none --no-checkout --branch claude/potato-build "$(git -C /srv/mint-src remote get-url origin)" /srv/potato-src && cd /srv/potato-src && git sparse-checkout set potato && git checkout && bash potato/deploy/first-setup.sh`
   (installs packages, asks for the MongoDB connection string and CHECKS it, asks for the admin password, writes the secrets file, starts pm2
   `potato-server`, tests `/health`.)
3. GitHub webhook (repo -> Settings -> Webhooks): Payload URL `http://<vps ip>:8096/k7x2/deploy/webhook` until a domain exists (then
   `https://<app host>/k7x2/deploy/webhook`), content type JSON, the secret is `DEPLOY_WEBHOOK_SECRET` from `/srv/potato-secrets/secrets.local.js`
   (`bash potato/deploy/show-links.sh github` prints all three), event: push. The server pulls its own branch, runs npm install, reloads `potato-server`.
4. Domain later: `bash /srv/potato-src/potato/deploy/set-domain.sh` (asks for the domain), then `make-hook-url.sh` for the secret payment-webhook address,
   `set-secret.sh PESAJET_API_KEY` / `TAVUPAY_API_KEY` / ... for payment keys, `copy-secret.sh FIREBASE_SERVICE_ACCOUNT` to reuse the push key.
5. Temporary preview by IP: `bash /srv/potato-src/potato/deploy/preview.sh on` serves the app at `http://<vps ip>:8096/` and the hidden admin at
   `http://<vps ip>:8096/Tq5m8zr/` (plain HTTP, design work only, never real members or money).

## Status
1. (done) Copied from Mint, renamed to Potato, ports 3004/8096/8097, own secrets/process/fail2ban/nginx names, placeholder hosts, new admin path.
2. (rule, owner) **Potato contains ONLY what is in the owner's screenshots.** Anything not shown (screen, tab, button, field, wording, admin option, setting) is removed COMPLETELY: its code, its admin setting and its tests, never just hidden. Kept without a screen: whatever keeps money and accounts safe (payment confirmation and locks, duplicate-payment protection, login security, captcha). Borderline items are listed for the owner to decide before removal.
3. (rule, owner) **Icons are uploaded in the admin panel** (home / orders / promotion / team / salary / profile nav icons, deposit, withdraw, download app, customer service, channel, and the rest as the screenshots show), and the system removes the background and cuts each icon out cleanly (server or browser side, PNG with transparent background).
4. (done) VPS first setup, port 3004, pm2 `potato-server`, preview on 8096, GitHub webhook added (owner).
5. (next) VPS first setup, GitHub webhook, then the owner's Potato screenshots: compare against renders (Playwright, 360x701 at 2x) before saying it matches.
   Until then the app still looks like Mint (green/cream design, products "Potato A" to "Potato J" placeholders).
