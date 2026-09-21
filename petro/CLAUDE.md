# Petro — Project Memory (read this first)

**What it is (so far):** Petro is meant to be a mobile-money investment platform —
same category as this repo's other apps: deposits/withdrawals via mobile money,
tiered investment products, referral commissions — themed around **petroleum /
oil & gas**. That theme was chosen by the owner in the session that created this
fork; **no palette, fonts, icons, product names, or copy have been decided yet.**
Nothing in this file above the "Status" section should be read as design already
signed off — it is the mechanical fork, not the product.

## Fixed decisions (owner-stated, do not re-ask, do not re-derive)

- **Design/layout will be genuinely distinct from Chipz** — new colors,
  typography, screen arrangement, visual identity. NOT a reskin, and
  explicitly **not assumed to be Chipz's Doritos red/orange either**. The
  owner will supply the actual direction (palette, fonts, mockups/references,
  product names and pricing) when that stage starts. Until then: do not
  invent any of it unprompted. This sharpens (doesn't contradict) the
  "Everything inherited from Chipz, unchanged" section below.
- **Inner functions and logic carry over unchanged.** Money-safety invariants
  (in-process locks, atomic increments, idempotent credits), the
  region/multi-country model, the i18n engine, the admin panel's structure,
  the deposit/withdrawal/referral/turntable mechanics, the build pipeline
  (`build-core.js`/`build-admin.js`) — all of it stays as Chipz built it.
  This is a skin change, not a rewrite. Backend/frontend logic gets touched
  only when something is genuinely broken (example: the `CORS_ALLOWED_ORIGINS`
  fix below — a real bug, not a design choice) or Petro's use case
  structurally requires it (e.g. a new payment gateway) — never to "improve"
  something along the way.
- **Hosting is a Hostinger VPS, KVM1 plan** — not Railway, not Render. A real
  server under direct SSH control, not a PaaS with git-triggered autoDeploy.
  See "Hosting: Hostinger VPS (KVM1)" below for the pipeline this implies
  (process manager, reverse proxy/TLS, scripted deploy).
- **Firebase for auth.** A real Firebase project must be created for Petro —
  the deliberately-broken `REPLACE_WITH_PETRO_...` placeholders in both
  `-src/index.html` files exist so nobody's Petro sign-in can land in
  Chipz's real user pool. When the project exists, stamp its config into
  both files and **verify it survived the rebuild** by grepping the built
  `user/index.html`/`admin/index.html` for it (the way the fork verified the
  *old* key's absence — same check, opposite direction).
- **MongoDB, same `db.js` layer, Petro's own connection string.** No
  structural change needed. Still undecided with the owner: share Chipz's
  Atlas cluster under Petro's own database (the pattern Chipz itself uses
  for Snow), or a separate cluster entirely.

**How this fork was made:** a plain file copy of `chipz/` at its commit `7c52305`,
on a **new branch `claude/petro-platform-build`**, in the same repo
(`loganmore282-debug/X-engine-developments`) — the identical pattern Chipz itself
used when it was forked from Snow. Not a git-history fork: `petro/` is a fresh
directory tree with its own commit history from here on. Chipz's own
`docs/`, `CLAUDE.md`, and its `translations/`/`test-fixtures/` scratch dirs were
**not** carried over (the first because it's Chipz's own 176-round history, not
Petro's; the latter two because nothing in the live pipeline reads them — dead
scratch files that were tracked by accident).

**Read `chipz/CLAUDE.md`** (read-only reference, never edit it from a Petro
session) if you need to understand *why* a piece of inherited code is shaped the
way it is — money-safety locks, the region/i18n layer, the PesaJet/MarzPay/LipaPay
integrations, the build pipeline's obfuscation step, all of it. That history is
real and applies to Petro's copy of the same code; it just isn't re-narrated here.
Never edit `chipz/`, `snow/`, `voltra/`, `space8/`, or other sibling project
folders from a Petro session.

## What already happened in the fork (mechanical, done)

A plain copy carries hundreds of comments narrating *Chipz's* development
history ("Owner: ...", "Round 152", "the owner reported..."). Those were
**deliberately left alone** — rewriting them into fictional "Petro" history would
corrupt real reasoning into invented narrative, which is worse than leaving
Chipz's name in a comment. The renames below are the ones that are either
load-bearing (would misbehave or leak into a live Chipz system if left alone) or
trivially safe (a label with no behavioural consequence). Everything else —
CSS variable names (`--chipz-*`), the product catalog, colours, fonts, icon
artwork, the referral-share wording, the whole visual design — is **still
Chipz's**, unchanged, and is real work for a session to do deliberately with the
owner's actual decisions, not a `sed` pass.

**Renamed (load-bearing or trivially safe):**
- `package.json` → `"name": "petro-server"`
- `render.yaml` → the three service `name:` labels (`petro-server`/`petro-app`/`petro-admin`).
  The CSP's `connect-src` line inside it still says `chipz-server.onrender.com` —
  left alone because `render.yaml` is dead documentation even in Chipz now (it
  moved to Railway); fix it if this project ever actually deploys via Render.
- `server.js` / `user-src/original_module.js`: the synthetic auth-email domain
  (`@chipz-platform.com` → `@petro-platform.com`, changed **identically in both
  files** — they must agree, see "Money-safety invariants" below), the
  `baseDomain` default and `DEFAULT_SETTINGS.baseDomain`, and
  `DEFAULT_SETTINGS.brandName` (`'Chipz'` → `'Petro'`).
- `user-src/index.html` / `admin-src/index.html`: `<title>`, `og:title`,
  `twitter:title`, and — **the one that actually matters** — the Firebase web
  config block. It held Chipz's real, live project (`chipz-23a4c`, a real API
  key). Replaced with obvious `REPLACE_WITH_PETRO_...` placeholders in both
  files, **deliberately broken** rather than left pointing at Chipz's project:
  a copy-pasted deploy must fail loudly at sign-in, not silently authenticate
  Petro's members into Chipz's real user pool. Verified: neither the real key
  nor the real project id survives anywhere in the rebuilt `user/index.html` /
  `admin/index.html` (checked directly — the obfuscator hides strings, it does
  not remove them, so this had to be checked by grepping the built output, not
  assumed from having edited the source).
- `user/manifest.json`, `admin/manifest.json`: `name`/`short_name`/`description`.
  Static files, not read from `brandName` at runtime — this is one of the two
  places a rename never reaches without a rebuild (the other is the share-card
  `og:`/`twitter:` tags, also done above). See Chipz's own CLAUDE.md, "The name
  is remembered on the device" section, for the full reasoning.
- `sms-forwarder-app/` (the Android SMS-forwarder companion app): renamed the
  whole package from `com.chipzplatform.smsforwarder` to
  `com.petroplatform.smsforwarder` — **directory move, not just a string
  replace** (Java requires the path to match the package declaration) — across
  `build.gradle` and all 11 source files. This is not cosmetic: Chipz's own
  history records this exact collision happening with Snow — two apps sharing
  one Android package id are, to Android, **the same app**, so installing
  either on a phone that already has the other silently repoints that phone's
  SMS forwarding. Also renamed the GitHub release tag it polls
  (`chipz-sms-app` → `petro-sms-app`, so a Petro admin's phone can never be
  offered Chipz's next build as an "update"), and blanked the hardcoded
  backend URL to an obvious placeholder (it was posting real deposit SMS text
  straight at `chipz-server.onrender.com` — left as-is it would have silently
  handed Petro members' payment SMS to Chipz's backend).
- `db.js` needed **no change** — its boot-time check only requires *a*
  non-empty database name in `MONGODB_URI`, not literally `/chipz`. As long as
  the owner sets a real `MONGODB_URI` ending in `/petro` (or any name of their
  choosing) when Petro gets a deploy, it already refuses to boot rather than
  silently sharing a database with anything else on the Atlas cluster. That
  refusal is inherited for free.

**Verified after the renames:** `node --check` on `server.js`/`db.js`/
`static-server.js`; both `node build-core.js` and `node build-admin.js`
round-trip clean; the real Firebase key and project id do not appear anywhere
in the rebuilt `user/index.html` or `admin/index.html`.

**Not done, and this is the important warning:** the test suite (`test-*.js`,
`test-*.py`, the `verify-*-discriminates.py` mutation harnesses — over 30
files) is **Chipz's**, copied as-is. Several assert exact literal values that
just changed — `brandName === 'Chipz'`, `baseDomain === 'chipz-platform.com'`,
the Firebase config fields, the forwarder app's old package id — and **will
fail** until a session works through them deliberately. **Do not "fix" a
failing test by reverting a rename to match old the test expectation** — read
which side is actually right first. Do not attempt a bulk rename across the
test files either; this project's own history (in `chipz/CLAUDE.md`) records
repeated, costly mistakes from exactly that shortcut — a scanner's own comment
containing the string it scans for, an anchor silently matching zero or many
times, a mutation harness aborting because a test file was hand-copied instead
of read. Treat each test file the way Chipz's own history treats one: read it,
understand what property it's actually defending, then decide whether the
property still holds under Petro's identity or the assertion needs rewriting.

## Everything inherited from Chipz, unchanged (the real remaining work)

Because this is a plain-file fork, Petro currently *is* Chipz with a different
name in a handful of places. All of the following are still exactly Chipz's,
and are real product/design decisions for a session to work through with the
owner — not something to invent unprompted (this codebase's own standing rule,
stated in `chipz/CLAUDE.md`'s product-config section: never invent a themed
product name or number unprompted):

- **Design language.** Doritos-red/orange gradient on cream/paper
  (`'Playfair Display'` headings, `'Barlow Condensed'` body), the whole
  CSS custom-property system prefixed `--chipz-*` (`--chipz-grad`,
  `--chipz-orange`, `--chipz-red`, etc. — a value-only token swap is how Chipz
  itself was distinguished from Snow; the same approach applies here, but the
  actual oil/gas palette needs deciding first). The bottom-nav icons, action
  icons, settings-row icons, spin wheel, treasure chest, door icon, copy-clip
  icon under `user/` are all the **owner's own uploaded artwork for Chipz** —
  none of it belongs to Petro and all of it needs replacing before Petro looks
  like a distinct product, matching the standing rule in both Chipz's and
  Voltra's own memory files: a fork must not resemble the project it came
  from.
- **Product catalog.** Still Chipz's inherited placeholder ladder
  (`Product-1`..`Product-12`, ×30 over 150 days). Chipz's own catalog is
  *also* still placeholder-named for the same reason — the owner hadn't
  supplied real names yet when that was last touched. Petro needs its own
  numbers before real money can move on it; do not invent oil/gas-themed
  product names without the owner's say-so.
- **The whole backend architecture**: multi-country regions, the i18n engine
  and its six languages (en/lg/sw/fr/rw/nyn — Petro almost certainly doesn't
  want Uganda's Bantu languages as defaults; this needs a decision), the
  MarzPay/PesaJet gateway integrations (both still wired to **Uganda-area
  currencies and, per the most recent Chipz round, MarzPay's twelve real
  markets** — irrelevant unless Petro also launches in one of those markets),
  the turntable/spin mechanic, referral commissions, the whole admin panel.
  All real, all functional, all still speaking Chipz's product in its
  comments and defaults.

## Removed from Petro: LipaPay, QuotaGuard, the SMS-forwarder app (owner decision)

The owner explicitly asked for these three OUT, not carried over — a real
exception to "everything inherited, unchanged" above, not an invented
cleanup. Removed from `server.js`, `db.js`, `admin-src/index.html`,
`user-src/original_module.js`, `package.json`, and `sms-forwarder-app/`
deleted outright:

- **LipaPay** (the 2nd automatic payment gateway) — every route
  (`/deposit/lipapay/callback`, `/withdraw/lipapay/callback`), every helper
  (`lipaCollect`/`lipaDisburse`/`lipaOrderQuery`/`lipaSign`/etc.), every
  branch in `depositProvider()`/`withdrawProvider()`/`GATEWAY_DIAL_CODES`,
  the reconciler sweeps, the `LIPAPAY_MCHID`/`LIPAPAY_PRIVATE_KEY`/
  `LIPAPAY_SANDBOX` env vars, the Settings radio buttons, and its two unique
  Mongo indexes (`lipaOutTradeNo`). **MarzPay and PesaJet are untouched** —
  Petro now has two automatic gateways, not three. If MarzPay/PesaJet also
  turn out to be wrong for Petro's actual markets, that's still open (see
  above) — LipaPay was removed because the owner said so directly, not
  because of that.
- **QuotaGuard** (the outbound static-IP proxy, `proxyFetch()`/
  `QUOTAGUARDSTATIC_URL`) — its *only* caller anywhere in the codebase was
  LipaPay's own HTTP client (`_lipaPost()`); confirmed by grep before
  deleting, not assumed. Gone with LipaPay. The `undici` dependency (only
  needed for `ProxyAgent`) came out of `package.json`/`package-lock.json`
  too, confirmed unused elsewhere first.
- **The SMS-forwarder Android app** (`sms-forwarder-app/`, deleted) and its
  server-side surface: `/deposit/manual/sms-forwarder` (the phone's webhook),
  `/deposit/manual/forwarder-unlock` (screen-lock check), `/deposit/manual/
  forwarder-heartbeat`, `/deposit/manual/verify-number`, the
  `MANUAL_SMS_SECRET`/`FORWARDER_PASSWORD` shared secrets, the MTN
  reversal-fraud detector (`parseReversalSms`/`applyDepositReversal` — its
  only caller was the forwarder route), and the two admin endpoints that
  existed solely to review forwarder-sourced `manualSmsLog` rows
  (`/admin/manual-sms-log/resolve`, `/admin/manual-reversals/list`).
  **What stayed, deliberately**: manual deposits themselves are not gone —
  `/deposit/manual/init`, `/deposit/manual/status`, and
  `/deposit/manual/paste-sms` (the member pastes their own confirmation SMS,
  an admin reviews and approves/rejects in Needs Review) are the owner's
  own already-established replacement flow (see the "no use of forwarder
  sms app, only the sent message ... should appear to admin panel" quote
  already in the code) and were carefully kept intact — same for
  `parseMoMoSms()`/`parseSentMoMoSms()` (the SMS-parsing engine, shared by
  paste-sms) and `trackManual()`/number-activity stats (still fed by
  'assigned'/'expired' events from the kept manual-deposit flow).
  `manualNumberHealth()` and the admin's per-number "Payment number
  activity" analytics panel (Analytics tab) were **left in place but not
  actively cleaned up** — they degrade gracefully to permanently
  "Never checked in"/zero counts now that nothing calls the heartbeat
  endpoint, which is honest and non-breaking, just cosmetically stale; a
  real follow-up if it bothers the owner, not urgent.

**Known follow-up, not done (low-risk, cosmetic, deliberately not touched this
round):** a handful of **admin-panel i18n translation strings** (the
lg/sw/fr/rw/nyn tooltip text, e.g. "automatic (MarzPay or LipaPay)" in the
deposits-tab help text) still mention LipaPay/the forwarder. Left alone on
purpose rather than hand-edited: these are matched positionally across 6
languages in one array, and editing the English source without also
correctly re-translating the other 5 risks desyncing the lookup for every
non-English admin — a worse outcome than a stale tooltip. Needs a session
with real translation review, not a guess. Also: `test-manual-review.js`,
`test-manualpay-matches-snow.js`, and any other test file asserting the
removed LipaPay/forwarder code paths are now failing — expected, and covered
by this file's existing "work through the inherited test suite file by
file" item below; do not bulk-fix them.

## OTP verification (MarzSms) — registration, forgot-password, add-wallet

Owner-specified, built this session. Uses **MarzSms** (sms.wearemarz.com), a
SEPARATE MarzPay product from the wallet API (`MARZSMS_KEY`, its own
dashboard/API key — **not the same secret as `MARZPAY_KEY`**). Real SMS costs
30 UGX each, so every send is rate-limited per phone number, resetting daily.

**Flows (all client-side in `user-src/original_module.js`, backed by three
new `server.js` routes):**
- **Registration**: phone → OTP → password → confirm password (the PIN/
  referral-code fields that already existed stay on the same final step,
  unchanged — the owner's spec named phone/OTP/password/confirm, not a
  reason to drop what was already there). `#registerPane` is now three field
  groups (`regStepPhone`/`regStepOtp`/`regStepPassword`) toggled by
  `showRegStep()` with plain `style.display` — never re-rendered, so nothing
  typed on an earlier step is lost moving to the next one.
- **Login** is unchanged (phone/password), with a new **"Forgot password?"**
  link that opens `#forgotPane` — its own three-step phone → OTP → new
  password flow, reached with NO Firebase session (that's the whole point:
  the member cannot sign in). Identity is proven by the OTP ticket alone;
  the password itself is changed via `admin.auth().updateUser()` — the same
  Admin SDK call `/admin/user/reset-password` already used for an
  owner-driven reset, just self-served here once a ticket backs it.
- **Adding/changing the payout wallet** (`openWalletSheet`'s Edit Wallet
  panel) also requires OTP. The code is sent to the **member's own phone on
  file** (resolved server-side from their account, never from the request
  body), not to the new payout number being entered — proving it's really
  the account holder adding this destination, not verifying the destination
  itself (which could legitimately belong to someone else, e.g. a family
  member's mobile money). `submitWallet()` now sends the OTP and swaps
  `#walFormGroup`/`#walOtpGroup` via `style.display` (not a re-render, so the
  typed provider/phone/holder aren't lost); `confirmWalletOtp()` verifies and
  only then calls `/bank/save` with the ticket.

**Backend (`server.js`):**
- `POST /auth/otp/send` — `{purpose: 'register'|'reset'|'bank', phone?}`.
  'register'/'reset' take `phone` in the body and need no session (a phone
  verifying itself before an account exists, or while its owner can't sign
  in, is exactly what OTP is for). 'bank' requires a session and ignores any
  phone in the body — it resolves the phone from `req`'s own account, so a
  logged-in member can't use this to spam an arbitrary number. Refuses with
  503 if `MARZSMS_KEY` is unset.
- `POST /auth/otp/verify` — `{otpId, code}` → `{ticket}` on success. The code
  itself (hashed with the same `scryptHash`/`scryptVerify` a PIN or admin
  password uses) is never touched again after this; the ticket is what the
  next step actually spends.
- `POST /auth/reset/confirm` — `{phone, ticket, newPassword}`, no session.
- `consumeOtpTicket(ticket, phone, purpose)` — the shared one-time-use check,
  via `updateIf()`'s atomic conditional match (same idempotency pattern as
  `creditedDepositIds`/`refundedWithdrawalIds`), wired into `/register`
  (skipped on a retry of an ALREADY-completed registration — the ticket from
  the original successful call is already spent, and re-demanding one would
  fail a registration that in fact already succeeded) and `/bank/save`.
- Rate limits: `otpDailyLimitRegister` (2), `otpDailyLimitReset` (3),
  `otpDailyLimitBank` (2, no explicit number from the owner — admin-editable
  like the other two, adjust if it's ever measured wrong) — all in
  `DEFAULT_SETTINGS`/`SETTINGS_CRITICAL_RANGES`, editable from the admin
  panel's Settings tab (Rates & limits card). **0 means "send none", not
  "unlimited"** — unlike most numeric settings in this file, these gate a
  paid SMS send and must fail closed. Counted per phone+purpose+day
  (`otpSendLog`, doc id `phone:purpose:day`) via the same `withLock` +
  atomic-increment pattern every other counter here uses.
- New Mongo collection `otpCodes` (phone, purpose, codeHash, attempts,
  ticket, ticketExpiresAt, consumedAt, expiresAt), indexed on `{ticket:1}`
  and `{phone:1,purpose:1}` in `db.js`. Codes expire in 10 minutes, tickets
  in 15, max 5 wrong-code attempts before a fresh code is required.

**What's still needed before this actually works**: the owner has the
`MARZSMS_KEY` value and hasn't pasted it yet — until it's set as an env var
(same place as every other secret, `deploy/secrets.local.js` on the VPS,
never committed), every `/auth/otp/send` call returns a clean 503 rather than
silently pretending to send. **The withdrawal-request admin SMS alert was
removed** in the same round (owner: "remove sms sending on withdrawals") —
`sendAdminPush` (a separate Firebase push, unrelated) still fires on a new
withdrawal; `marzSmsSend()` itself was kept, now used only by OTP.

## Money-safety invariants (do not regress — inherited from Chipz verbatim)

- `db.js`'s `runTransaction` is a **fake that does not lock**. Money-crediting
  paths rely on in-process `withLock()` + atomic `FieldValue.increment` +
  conditional `updateIf()`. **Never introduce a real `runTransaction`** into a
  money path without understanding why Chipz's own history treats this as the
  single most load-bearing rule in the codebase.
- Webhooks are **hints, never authority** — every credit decision re-reads the
  provider independently before crediting.
- `phoneToEmail()` exists in **two places** (`server.js` and
  `user-src/original_module.js`) and **must produce the same string** in both
  — this was just edited in both for the domain rename; any future edit to
  either must touch both. `test-regions.js` (inherited, not yet re-verified
  post-rename) is what checks this.
- Never put secrets (Mongo URI, Firebase service account, admin key, any
  payment-provider key) in this repo or in chat. They live only in the
  eventual host's environment variables. **None exist for Petro yet** — there
  is no live deploy, no real Firebase project, no real Mongo database. The
  Firebase web config currently in the source is a deliberately-broken
  placeholder, not a secret to protect — see above.
- Never put a model identifier in commit messages, PR titles/bodies, code
  comments, or anything pushed to the repo — chat replies only.

## Build & deploy pipeline (mechanically identical to Chipz's — see chipz/CLAUDE.md for the reasoning behind each step)

1. Edit `user-src/original_module.js` / `user-src/index.html` (member app) or
   `admin-src/index.html` (admin panel).
2. `cd petro && node build-core.js` and `node build-admin.js` — obfuscate +
   deflate + base64 the readable sources into the deployed `user/index.html`
   and `admin/index.html`. Both print `round-trip : OK` when valid. **Always
   rebuild after editing a `-src` file** — the deployed artifact is a separate
   committed file, not generated at request time.
3. `node set-backend-url.js https://<petro-backend-domain>` once Petro has a
   real backend deployed, then rebuild both — this rewrites the backend
   origin in every one of the ~13 places it's baked in (inherited unchanged
   from Chipz, including the fixes from Chipz's own Round 174d/176b — the
   service-worker files and `static-server.js`'s fallback are in its list).
   `node set-backend-url.js --check` shows where everything currently points
   (still Chipz's Railway domain — harmless until Petro is actually deployed
   pointed at that origin, which must not happen for real: it is a live
   backend serving live Chipz members).
4. Bump the cache version in `user/sw.js` / `admin/sw.js`
   (`const CACHE = 'chipz-shell-v109'` etc. — still says `chipz-shell`,
   worth renaming alongside a real design pass, not urgent before that) on
   every deploy so phones pull the fresh build.
5. `node -e` / the `find-*.py`, `test-*.py` diagnostic sweeps and the whole
   Playwright suite are inherited and **not yet re-verified against Petro's
   identity** — see "Not done" above.

## Hosting: Hostinger VPS (KVM1) — LIVE

**The VPS exists and the backend is running on it.** IP `179.198.197.114`,
hostname `srv1994126.hstgr.cloud`, Ubuntu 24.04 LTS, Germany–Düsseldorf,
KVM1 (1 vCPU / 4GB RAM / 50GB disk). Provisioned and brought up in-session,
by hand, via Hostinger's browser web console at first (unreliable — it
silently dropped mid-paste more than once) and then Termux (SSH client on
the owner's own Android phone) once that was installed, which is now the
reliable way in.

**Important correction to the plan below: a Claude Code session in this
environment cannot SSH out.** Its outbound network is HTTPS-through-a-proxy
only; raw TCP on port 22 is not reachable, confirmed against the proxy's own
diagnostics rather than assumed from a timeout. So `deploy.sh`'s original
design (rsync FROM the assistant's sandbox TO the VPS) **cannot run from a
Claude session** — it's left in the repo as a reference/for a human running
it from their own machine, but the pipeline that's actually in use is
different, and is what's live right now:

- **Process manager: pm2**, running as a systemd service. `pm2 startup
  systemd -u root --hp /root` registered `pm2-root.service` (enabled), and
  `pm2 save` froze the process list — the backend survives a reboot.
- **Code delivery: the VPS pulls from GitHub itself**, not pushed via rsync.
  The repo (`loganmore282-debug/X-engine-developments`) is **public**, so no
  deploy key was even needed — plain HTTPS clone. Set up as a sparse
  checkout of `petro/*` only, at `/srv/petro-src/petro`:
  ```
  cd /srv/petro-src && git pull origin claude/petro-platform-build
  ```
  is the entire redeploy step for code changes (run on the VPS, via
  Termux/SSH — a Claude session can push commits to GitHub but cannot run
  this `git pull` itself, for the same reason it cannot rsync). Follow with
  `cd petro && npm install --omit=dev` if `package.json` changed, then
  `pm2 reload petro-server` (or `pm2 restart` — `reload`'s zero-downtime
  handoff needs the app already running).
- **Secrets: `petro/deploy/secrets.local.js`**, created directly on the VPS
  (gitignored — see `.gitignore`'s comment on that line), never committed.
  `ecosystem.config.js` try-requires it and spreads its keys into the pm2
  process env; the process boots fine with an empty object if the file is
  ever missing (verified both ways). Currently holds the real `MONGODB_URI`
  (Atlas `cluster0.wblvntm.mongodb.net`, user `chnpetrol`, database `petro`),
  `ADMIN_KEY`, and `FIREBASE_SERVICE_ACCOUNT` (project `chnpetrol`).
- **Confirmed live**: `pm2 logs` shows `MongoDB connected (petro)`, `Chipz
  backend listening on :3000` (inherited log string, cosmetic, left alone),
  `MongoDB indexes ensured (69/69)`; `curl http://127.0.0.1:3000/health`
  returns `{"status":"ok","db":true}`.
- **`ecosystem.config.js`'s `instances` must stay `1`** — the in-process
  locking that makes money crediting safe (see "Money-safety invariants"
  below) only works within a single Node process; pm2 cluster mode would
  silently reopen the exact race those locks close.

**Not done yet — this is the real next step, not a detail:**
1. **nginx is installed but has no site config for Petro yet** — the backend
   is only reachable on `127.0.0.1:3000` (or `179.198.197.114:3000` if the
   firewall's tested for it — `ufw` currently allows OpenSSH + Nginx Full
   only, port 3000 isn't opened). `petro/deploy/nginx-petro.conf.template`
   is written and ready (three server blocks, security headers/CSP ported
   from `static-server.js`/the old `render.yaml`) but every `PETRO_DOMAIN`
   in it needs a real domain substituted in, and it hasn't been dropped into
   `/etc/nginx/sites-available/` yet.
2. **No domain pointed at the VPS yet** — without one, certbot cannot issue
   a TLS cert (Let's Encrypt does not certify bare IPs), and nginx's
   `server_name` in the template has nothing real to bind to. This is
   server config, not app config — it cannot come from the admin panel's
   `baseDomain`/`allowedOrigins` settings the way the app-level domain can;
   see "Fixed decisions" above.
3. **`set-backend-url.js` has not been run** — the shipped `user/`/`admin/`
   bundles still point at whatever backend origin they inherited from the
   fork, not this VPS. The frontends will not work end-to-end until this
   runs and both bundles are rebuilt, which needs a real origin (the
   domain from step 2, or `http://179.198.197.114:3000` as a temporary
   stand-in for local testing only — never a real deploy target, since it's
   unencrypted).
4. Payment-provider credentials, once a gateway is chosen (still open, see
   "Everything inherited from Chipz" below) — nothing blocks on this yet.

**Removed from this fork** (were Railway/Render artifacts, actively
misleading once hosting moved to a VPS): `railway.json`, `railway.app.json`,
`railway.admin.json`, `render.yaml`. Their content (env var list, CSP/header
set) isn't lost — it's carried into `nginx-petro.conf.template` and this
section.

**Bugs fixed while building this** (real bugs, not design choices — see
"Fixed decisions" above on the bar for touching inherited logic):
- `CORS_ALLOWED_ORIGINS` in `server.js` still hardcoded
  `https://chipz-platform.com`/`https://www.chipz-platform.com`, even though
  `_baseDomain`'s default was already renamed to `petro-platform.com` in the
  mechanical fork. Now reads `petro-platform.com`/`www.petro-platform.com`;
  update again once the real domain is chosen. `CORS_ALLOWED_SUFFIXES`
  (EdgeOne/Railway/Render suffixes) was left alone — unused on a VPS but
  harmless, not broken.
- `admin-src/index.html`'s `VAPID_KEY` constant (admin push-notification
  registration for deposit/withdrawal alerts) was still **Chipz's real, live
  key**, not a placeholder — missed by the mechanical fork's Firebase-config
  pass. Left alone it would have silently failed `getToken()` once pointed
  at Petro's own Firebase project (VAPID keys are project-scoped). Replaced
  with the real Petro key the owner supplied alongside the Firebase config.
- `package-lock.json`'s `name` field was still `"chipz-server"` (the
  `package.json` rename didn't touch the lockfile). Fixed to `petro-server`.

## Status

**Fork complete, mechanically.** Boots as "Petro" in name (title, manifest,
brand-name default) and cannot accidentally authenticate against or write into
Chipz's live Firebase/Mongo (verified, not assumed). The CORS origin miss
(`chipz-platform.com` left in `CORS_ALLOWED_ORIGINS`) is fixed.

**VPS is live and the backend is running real traffic-ready infrastructure.**
IP `179.198.197.114`, code pulled via git (not rsync — a Claude session
cannot SSH out, see "Hosting" above for the corrected pipeline), backend
under pm2 as a systemd service, connected to the real `chnpetrol` Firebase
project and the real Mongo Atlas `petro` database, `/health` returns
`{"status":"ok","db":true}`. Both frontend bundles carry the real Firebase
web config and the real VAPID key (rebuilt and pushed this session).

**Both bundles now point at the live VPS backend** — `set-backend-url.js` has
run, against `http://179.198.197.114:3000` (a deliberate, throwaway
bare-IP/plain-HTTP config since there's still no domain — see "Not done yet"
above). `set-backend-url.js --check` confirms one consistent origin across
all ~13 places it lives. nginx serves the member app on port 8080 and the
admin panel on 8081 (port 80 hit mobile-carrier interference on the owner's
phone, not a server problem — see the port-8080 fix noted in the numbered
list above), backend itself directly reachable on 3000. **Still the real
next step:** buy `petrol-chn.com`, point it at the VPS, then replace this
bare-IP config with the real `nginx-petro.conf.template` + certbot TLS and
re-run `set-backend-url.js` against the real HTTPS origin.

**LipaPay, QuotaGuard, and the SMS-forwarder app are fully removed** (owner
decision, not inherited default) — see "Removed from Petro" above for the
full list of what came out and what was deliberately kept (manual deposits
via member-pasted SMS still work).

**OTP verification (registration / forgot-password / add-wallet) is built**
— see "OTP verification (MarzSms)" above for the full design. Both bundles
rebuild clean (round-trip OK) and carry the new three-step Sign Up/forgot-
password panes and the wallet OTP step. **Not live yet**: `MARZSMS_KEY` is
still unset (owner has it, hasn't pasted it in) — every `/auth/otp/send`
call returns a clean 503 until it's added to `deploy/secrets.local.js` on
the VPS, same as every other secret.

**The VPS is still running the code from BEFORE this session's changes** —
none of the LipaPay/QuotaGuard/forwarder removal, the bare-IP backend
pointing, or the new OTP feature has reached it yet. **The code in this
branch needs `git pull` + `npm install --omit=dev` (package.json changed,
LipaPay's `undici` dependency came out) + rebuild + `pm2 reload petro-server`
on the VPS to actually take effect there** — same redeploy step as any other
code change, per the "Hosting" section above. OTP additionally needs
`MARZSMS_KEY` added to `secrets.local.js` before it will do anything but
refuse with 503.

Everything else — design, product catalog, which countries/languages/gateways
actually apply, the test suite's own correctness — is real, undone work for
the next session, laid out below in the order it probably needs doing:

1. ~~Confirm/adjust the fork's mechanical renames~~ — done (the CORS miss,
   the VAPID key, the lockfile name).
2. ~~Stand up the VPS, wire up real Firebase + Mongo~~ — done this session,
   see "Hosting" above. Remaining: a domain, nginx, TLS, the real (non-bare-IP)
   `set-backend-url.js` run.
2a. ~~Build OTP verification (registration/forgot-password/add-wallet)~~ —
   built this session, see "OTP verification (MarzSms)" above. Remaining:
   paste in `MARZSMS_KEY`, then `git pull` + redeploy on the VPS so any of
   this session's changes (OTP included) actually take effect there.
3. Decide the actual oil/gas visual identity — palette, typography, iconography
   — with the owner, the same deliberate way Chipz's own `CLAUDE.md` records
   getting its own red/orange identity right (see "Design language / decisions
   already made" in `chipz/CLAUDE.md` for the *process*, not the *values* —
   the values are Chipz's). **Waiting on the owner's direction, per "Fixed
   decisions" above — do not invent this unprompted.**
4. Decide the product catalog: real names, prices, cycle lengths.
5. Decide which countries/currencies/languages/payment gateways actually apply
   to Petro — do not assume Uganda/UGX/MarzPay just because the code defaults
   to it.
6. Work through the inherited test suite file by file, per the warning above.
