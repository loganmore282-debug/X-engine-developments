# Petro — Project Memory (read this first)

**What it is (so far):** Petro is meant to be a mobile-money investment platform —
same category as this repo's other apps: deposits/withdrawals via mobile money,
tiered investment products, referral commissions — themed around **petroleum /
oil & gas**. That theme was chosen by the owner in the session that created this
fork; **no palette, fonts, icons, product names, or copy have been decided yet.**
Nothing in this file above the "Status" section should be read as design already
signed off — it is the mechanical fork, not the product.

## Fixed decisions (owner-stated, do not re-ask, do not re-derive)

- **Design/layout is genuinely distinct from Chipz — now underway, palette
  decided.** NOT a reskin: new colors, typography, screen arrangement, visual
  identity, explicitly **not Chipz's Doritos red/orange**. The owner supplied
  real mockups and an explicit palette this round — see "Design system:
  Premium Industrial Energy" below for the decision and what's built so far.
  Anything the owner has NOT shown a mockup for yet (Assets/Network/Account
  screens, product catalog, etc.) is still undecided — do not invent those
  unprompted, same rule as before, just narrower now that Home/Login/Sign Up
  are settled.
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
- **Hosting is a Hostinger VPS, KVM1 plan — not Railway, not Render, not
  EdgeOne, not anything else.** A real server under direct SSH control, not
  a PaaS with git-triggered autoDeploy or a separate static host. See
  "Hosting: Hostinger VPS (KVM1)" below for the pipeline this implies
  (process manager, reverse proxy/TLS, scripted deploy). Follow-up 11
  (2026-09-28) is the owner catching a session end a reply with "usual
  EdgeOne zip upload, no Railway redeploy needed" — those instructions are
  Voltra's (a DIFFERENT app in this same repo, under `voltra/`), not
  Petro's, and had leaked in by mistake. **Never end a Petro round with
  Railway/EdgeOne/Render deploy instructions of any kind.** The real,
  ONLY next step after a Petro build is: `bash deploy/deploy.sh` (or the
  manual rsync + `pm2 reload` + `nginx -t && systemctl reload nginx` it
  wraps) against this VPS. If in doubt which app's rules apply, check
  which directory you are editing in — `petro/` is this file; `voltra/`
  has its own, separate CLAUDE.md with its own separate (EdgeOne+Railway)
  pipeline that must never be quoted here.
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

## Design system: "Premium Industrial Energy" (owner-specified, in progress)

The owner sent real mockups (Home, Sign Up, Log In) and an explicit palette —
this is the real direction "Fixed decisions" above used to say was still
pending. Quoted verbatim because it's the spec, not a summary:

- 🔴 **Corporate Red** `#E30613` — primary: headers, main buttons, active nav,
  important icons/highlights.
- ⚪ **Clean White** `#FFFFFF` — main dashboard/background.
- 🟡 **Golden Orange** `#F5A000`–`#FFB000` — secondary accent, off the logo
  and sunset/industrial lighting.
- ⚫ **Charcoal** `#25262B` — auth glass panels, text, secondary UI.
- 🟢 **Green** — functional only (successful transactions, completed
  status), explicitly NOT a theme color. Left as Chipz's own green tokens,
  untouched.

Login/Sign Up use the darker half: sunset-refinery photo background +
charcoal translucent glass panel + red buttons + white text + warm golden
lighting. The inner dashboard uses the brighter half: white background + red
cards/buttons + golden-orange accents + dark text + petroleum/industrial
photography. Explicitly **not** the typical blue/green fintech look —
confirmed by removing the one remaining blue token (`--chipz-link`, used for
in-app links) in favor of the deep red.

**What's built (this round):**
- **Every color token re-themed** in both `user-src/index.html` and
  `admin-src/index.html` — `--snow-*`/`--chipz-*` in the user app,
  `--gold`/`--ink`/`--bg`/etc. in the admin panel. This is the highest-leverage
  change possible here: the whole codebase already reads colors through these
  tokens (hundreds of rules), so swapping ~15 root values recolors the entire
  app without touching component code — the exact same low-risk convention
  admin-src.html's own comments already document from its Chipz→(older
  admin re-theme). `--chipz-grad` (the old red→orange button/card gradient)
  is now a **flat** `#E30613` — the mockups show solid red, not a blend.
  A handful of hardcoded (non-variable) hex literals were also caught and
  fixed: the scrollbar thumb in both apps, the `<meta theme-color>` and
  `manifest.json` background/theme colors in both apps, the loading-screen
  gradient, the product-card placeholder gradient, the account-screen wallet
  card art, a warning-triangle icon fill, and an alternating team-avatar
  gradient.
- **Logo and auth-screen background are admin-uploadable — and already
  were.** Chipz already had this exact mechanism (`CHIPZ_IMAGE_SLOTS` in
  server.js: `logo`/`authhero`/`authcard`/etc., `/admin/chipz-image/set`,
  wired to admin-src's Brand tab as `brandLogoFile`/`authHeroFile`/
  `authCardFile`) — nothing new had to be built for the owner to upload the
  real logo and a sunset-refinery photo right now. `authHeroOpacity`/
  `authHeroBlur`/`authCardOpacity`/`authCardBlur` settings already control
  how strongly each blends behind the glass panel.

**Home screen layout — built this round, matches the mockup:**
`paintHome()` (user-src/original_module.js) now renders: a red top bar with
the admin-uploadable logo + `brandTagline` heading ("Energy for a Better
Tomorrow" by default) + "Reliable · Sustainable · Together" + Notifications
bell + Support headset; a **banner carousel** with dot indicators (slide 1 is
the pre-existing Home banner/video slot, slides 2/3 are new `banner2`/
`banner3` admin uploads — carousel only activates with 2+ image slides and no
video, which keeps the original single-banner/video behavior completely
untouched in every other case); the 4-action row relabeled Deposit/Withdraw/
**Invite**/**Support** (was Channel/Service — same underlying handlers, just
the mockup's own words) with real inline SVG icons (`ICONS.cardPlus`/
`arrowDownTray`/`peoplePlus`/`headset`) replacing the old Chipz raster PNGs
in these four tiles specifically; a **Total Wallet Balance** card with an
eye toggle (`toggleBalanceVisibility()`, a per-device localStorage
preference, not account data) and a "View Details" button to Account; a
**3-stat row** (Cumulative Earnings / Total Deposits / Total Withdrawals,
real `totalEarned`/`totalDeposited`/`totalWithdrawn` figures); an inline
**Daily Check-in** card (a gift-box teaser that opens the existing, fully
working check-in sheet — the streak/cooldown/countdown logic itself was not
duplicated, just given a launcher on Home); and an inline **Latest
Announcement** row (only rendered when `annEnabled && annBody`, tapping
"More" reopens the existing announcement dialog via the new
`window.openAnnounceDialog()` — a plain function needed a `window.` wrapper
to be callable from an inline `onclick`, same requirement as every other
inline handler in this file). A new `annUpdatedAt` field (stamped by
`/admin/settings/update` whenever `annTitle`/`annBody` are saved) backs the
row's date so it's real, not invented. The existing activity ticker, spin
banner, profile-GIF strip and treasure chest button are kept, below the new
content — the mockup doesn't show them but nothing asked to remove them.
An optional `homefooter` image (new admin upload) renders at the very
bottom of Home, matching the mockup's "Clean Energy Stronger Communities"
band — hidden entirely when unset.

**Still the old Chipz raster PNGs**: the bottom-nav icons, the activity
ticker's bell (`/act-bell.png`) and the treasure chest/gift-code art are
still the owner's own uploaded artwork **for Chipz**, not swapped — only the
4 action-tile icons and the new Daily Check-in gift box got real SVG this
round (the ones the mockup actually specified). Same "owner's Chipz artwork,
needs replacing" flag as before for the rest, see "Everything inherited from
Chipz, unchanged" below.

**Not built yet:**
- **Assets / Network / Account screens** — owner said mockups for these are
  coming; nothing to build against yet, per "do not invent unprompted." The
  bottom nav is still Chipz's original 6 tabs (Home/Products/My Products/
  Referral/Team/Account) — the owner's own message names 4
  (Home/Assets/Network/Account), implying Products+My Products consolidate
  into "Assets" and Referral+Team into "Network", but that's an inference,
  not confirmed — **do not restructure the nav until the owner's own
  Assets/Network mockups make the consolidation explicit.**
- **Admin panel** got the same color-token retheme (so it visually matches
  the app now) plus the 3 new banner-slot upload rows, but not a layout
  rebuild — the owner only asked for its *theme* to change, not its
  structure.
- `window.switchHomeProductTab`/`_homeProductTab` (a Hot Products/New
  Arrivals segmented control) were already dead code in the pre-mockup
  `paintHome()` — computed but never actually rendered into the returned
  HTML, confirmed by reading the function before touching it. Left alone
  (still callable, just inert), not cleaned up as part of this round.

**notify() redesigned, announcement removed entirely (owner follow-up round):**
- `notify()` (the app-wide toast, called from dozens of places) is now a
  small dark bottom-sliding toast, auto-dismissing, replacing the old
  centred white card + dimmed backdrop + amber warning-triangle emoji.
  Same `notify(message, onClose)`/`closeNotify()` signatures and the same
  `#notifyBg`/`#notifyMsg` ids as before — **every call site needed zero
  changes**, only the CSS/markup behind those ids changed.
- The announcement feature (pop-up dialog firing on every Home visit, the
  inline Home row built earlier this same round, and the admin panel's
  whole "Home announcement dialog" settings section) is **removed
  entirely**, per an explicit later instruction. `maybeShowAnnouncement()`
  was kept as a deliberate no-op function (not deleted) because
  `maybeAnnounceAfterSheet()` still calls it from five separate
  deposit/withdraw sheet-closing code paths — turning it into a no-op was
  the lower-risk way to make the feature disappear everywhere without
  editing five spots in money-adjacent code. **Real bug caught and fixed
  while removing the admin UI**: two of the admin panel's announcement
  event-wiring lines (`$('saveAnn').addEventListener(...)`,
  `$('annImageFile').addEventListener(...)`) had no null-check, unlike
  every sibling handler in that file — deleting only the HTML and leaving
  those would have thrown on `renderSettings()` and broken every OTHER
  settings control wired after them in the same function. Backend fields
  (`annEnabled`/`annTitle`/`annBody`/`annUpdatedAt` in `DEFAULT_SETTINGS`,
  the `/admin/announcement-image` endpoints) were deliberately left alone —
  inert, unreachable from any UI, lower risk than restructuring
  `getSettings()`/a positional `Promise.all` for a purely cosmetic cleanup.

**Account screen rebuilt to the owner's 2nd mockup round** (`renderAccount()`
in user-src/original_module.js): red top bar (logo/tagline/bell/gear), a
profile card over an admin-uploadable refinery photo (new `profilecard`
image slot, same `CHIPZ_IMAGE_SLOTS` mechanism), a 3-stat row (wallet
balance/earnings/deposits), and a plain white row list with real coloured-
circle SVG icons (`acctRowHtml()`, a new helper — kept separate from the old
`settingRowHtml()` rather than changing it in place, since nothing else uses
it this round and a shared helper's visual contract shouldn't change under
call sites that aren't being touched). Row mapping: My Assets → the existing
"My Products" page (interim — the real consolidated Assets page is the next
piece), My Team → the existing Team page (same interim reasoning for
Network), Deposit/Withdrawal/Earnings Records → `openBalanceRecordSheet()`
with its existing tab param, Gift Codes → the existing treasure-chest sheet,
**Bind Bank Account → the existing `openWalletSheet()`** (the OTP-gated
wallet-link flow built earlier this session — just a new row/label, the
underlying flow is untouched), Security Settings → a new small sheet listing
the two password-change sheets that already existed as separate rows.

**Deliberately not built this round** (flagged, not invented): a per-member
profile PHOTO upload (the mockup's camera badge) and phone-number editing
(the mockup's pencil icon) are both real new backend features — per-member
file storage, and a changed phone re-derives the synthetic auth email (see
`phoneToEmail()`'s own "must match server.js exactly" warning) — not a
visual swap, and nothing in this round's instructions asked for them
specifically; the header shows a plain placeholder avatar and the phone as
read-only for now. Same reasoning for the mockup's "Membership Level / VIP 1"
card: there is no tier system anywhere in this codebase (thresholds,
benefits, what "View Benefits" would show), so it was not invented here.

**Real bug caught and fixed while touching this file again**:
`updateMessageBadge()` (the unread-message dot on the top bar's bell) still
queried `.home-topbar .icon-btn` — the class names from BEFORE the Home
re-theme (`.home-topbar-v2`/`.htb-icon-btn`) — so it had been silently
no-op'ing (a null check swallowed the miss, nothing crashed) since that
earlier commit. Fixed, and also fixed to insert the dot into `.htb-ic`
specifically rather than the button itself, matching where `paintHome()`'s
own markup actually expects it (the CSS that positions `.dot` is scoped to
`.htb-ic .dot`).

**Bottom nav collapsed to the mockup's 4 tabs** (Home/Assets/Network/
Account, down from Chipz's original 6) — real SVG nav icons (`ICONS.navHome`/
`layers`/`peopleGroup`/`navPerson`) replacing the raster `/nav-*.png` set,
recolored via plain CSS `color` (muted gray inactive, red active) instead of
the old `filter:grayscale` hack, which only ever made sense for photographic
PNGs. `'catalog'/'products'/'referral'/'team'` are still real, dispatchable
`STATE.page` values (`renderCatalog`/`renderProducts`/`renderReferral`/
`renderTeam` are untouched) — just no longer linked from the bottom bar,
absorbed into the two new pages below. Found and fixed one stale link while
sweeping for others: a successful purchase used to `showPage('products')`,
which would have dropped a member onto a page with no way back to it from
the nav; now lands on Assets' My Assets tab instead.

**Network screen built** (`renderNetwork()`/`paintNetwork()`): combines what
used to be the separate Referral tab (code/link/commission rates) and Team
tab (stats/level-switcher/member list) into the one screen the mockup shows
— same underlying data (`STATE.teamStats`, `/team/members`) and helpers
(`maskPhone()`, `joinedStamp()`), reused rather than duplicated.
`renderTeam()`/`paintTeam()`/`switchTeamLevel()` are unchanged and still work
standalone (just unreachable from the nav) — "View Details"/"View All" on
the new screen opens a sheet built from the exact same level-switcher +
member-list markup `paintTeam()` used, via a new `openAllReferralsSheet()`.
"Recent Referrals" fetches all 3 levels once, merges and sorts by join date,
shows the top 4.

**Assets screen built** (`renderAssets()`/`paintAssets()`): an All Assets /
My Assets segmented control. **All Assets** is a genuinely new compact row
layout (`assetRowHtml()`) per the owner's explicit "avoid using the same
architecture" instruction — built fresh rather than reusing
`productCardHtml()`'s larger card, though it still calls the same
`planFigures()`/`productCtaHtml()`/`openInvestConfirm()` for the figures and
the buy button/open-soon-countdown states, so nothing about how a purchase
actually works changed. **My Assets reuses `paintProducts()`'s existing
investment-list rendering unstyled** — refactored its content into
`myProductsInnerHtml()` (returns the HTML string) so both the old page and
the new tab can use it without one clobbering the other's container; this
is a deliberate scope boundary, not an oversight — the owner's mockups only
ever show "All Assets" selected, so there is no reference for what "My
Assets" should look like in the new style, and guessing would be exactly the
unprompted design this project's rules warn against.

**Known gap, not fixed this round**: the "quietly refresh while the app
sits open" live loop (`startLiveRefresh()`) still only recognizes the OLD
page names (`'products'`/`'catalog'`/`'team'`/`'referral'`) for its
background patches — `'assets'`/`'network'` aren't wired into it, so those
two screens refresh fully on every visit but don't get quiet in-place
updates while just sitting open the way the old pages did. Low priority
(both still fetch fresh data every time they're opened), flagged rather
than silently left for someone to rediscover.

**Auth screens rebuilt single-screen, Trade Password removed app-wide, and
the un-mockuped Home extras taken off (owner follow-up round):** owner sent
Register/Log In mockups showing ONE screen each (not the old 3-step wizard)
with no Trade Password field, then, asked directly about the missing PIN
field, answered with a sweeping instruction, quoted verbatim because it set
the scope for the whole round: *"What l am giving you is what you should
put, so what l didn't mention remove it, so remove trade passwords, your
treasure chest box, spin, all stuff l never mentioned remove them."*
Treated as: remove Trade Password/PIN everywhere (not just the auth forms),
and remove the Home extras the design-system section above had previously
noted as deliberately kept (paragraph above, now superseded) — the activity
ticker, spin banner, profile-GIF strip, and the treasure-chest float — since
none of them are in any mockup sent.

- **`user-src/index.html`**: the whole `#authScreen` markup replaced —
  dropped the two-part hero-band + white-card split, the wordmark/triangle
  motifs, the dot-divider headings, the static `+256` dial-code chips
  (`loginDial`/`regDial`/`forgotDial` — `paintRegionChrome()` already wrote
  to these through null-safe `$(id)` lookups, so removing the ids is not a
  crash, just a silently-dropped display feature), and the "Remember me"
  checkbox (`doLogin()`'s own `if (!remember || remember.checked)` already
  treated a missing checkbox as always-checked, so this is a real behavior
  change — credentials are now always saved locally on login, not opt-in —
  not something new introduced by this edit). New `.auth-screen-v2` is ONE
  continuous full-bleed photo (still the existing admin-uploadable
  `authhero` slot / `--auth-hero-img` var — `applyAuthBackgrounds()` needed
  no changes since `#authHeroBg`/`#authHero` ids were kept on purpose) with
  flat `.af-v2` glass-pill fields directly on it, real inline SVG icons
  (person/lock+eye/shield-plus/person-plus), a solid red "Log In"/"Register"
  button, an "or" divider, and an outlined "Create New Account" button on
  the Log In pane — matching the two mockups. The separate `authcard`
  admin-upload slot (`#authCardBg`/`--auth-card-*`) is no longer referenced
  by any markup; its admin upload row still exists but now has nothing to
  apply to. New CSS added: `.auth-screen-v2`, `.auth-scroll-v2`, `.af-v2`
  (+ `.with-btn`), `.af-ic`, `.af-eye`, `.af-inline-btn`, `.af-forgot`,
  `.af-btn-v2`, `.af-or`, `.af-btn-outline`. The old hero/card CSS
  (`.auth-hero`/`.auth-card`/`.auth-wordmark`/`.mark-row`/`.auth-tri`/
  `.dot-divider`/`.auth-field`/`.row-check`/`.auth-switch`) is left in
  place, unreferenced — same "leave it, nothing else depends on it"
  precedent as the announcement removal above.
- **`user-src/original_module.js`**: Sign Up and Forgot Password rewritten
  from the old 3-step wizard (`showRegStep`/`doRegVerifyOtp`/
  `showForgotStep`/`doForgotVerifyOtp`) into single-screen flows — Send Code
  fills an OTP id, the actual `/auth/otp/verify` call now happens inline
  inside `doRegister()`/`doForgotSubmit()` at submit time. No PIN field is
  read anywhere in either flow. `showAuthTab()` now resets
  `window._regOtp`/`window._forgotOtp` directly instead of calling the
  deleted step functions. `startOtpResendCooldown()` gained an optional
  3rd `idleLabel` param (default `'Send Code'`) so the one other caller
  (the wallet-bind OTP step, `'Resend code'`) keeps its own wording.
- **Trade Password/PIN removed from the withdraw sheet**: `paintWithdrawSheet()`
  no longer renders the "Trade Password" field, `submitWithdraw()` no longer
  reads/validates `witPin` or sends `pin` to `/withdraw/request` — matches
  the server no longer requiring it (see "Money-safety invariants"/server.js
  changes below).
- **Security Settings sheet**: `openSecuritySettingsSheet()` now lists only
  Login Password. `openChangeTradePasswordSheet()` is left defined but
  unreachable (same dead-code precedent as elsewhere this session).
- **Home (`paintHome()`)**: removed the activity-ticker card, `spinBannerHtml()`,
  `homeGifHtml()`, and the floating treasure-chest button. Their functions
  (`startActivityTicker`, `spinBannerHtml`, `homeGifHtml`, `fitHomeGif`,
  `openTurntableSheet`) are left defined but unreached — none error, all
  their `$(id)`/`querySelector` lookups were already null-safe. The Account
  screen's **"Gift Codes" row is kept** (it's an explicit row in the Account
  mockup, `openChestSheet()`) — only the Home floating "treasure chest"
  visual is what the owner meant by "treasure chest box"; gift-code
  redemption itself is a real, mockup-named feature, not a leftover.
- **`server.js`**: `completeRegistrationCore()` no longer validates a PIN or
  writes `transactionPinHash` on signup (the `INVALID_PIN`/`WEAK_PIN` checks
  are gone, not just skipped). `/withdraw/request` no longer calls
  `pinCheck()`. `pinCheck()`/`transactionPinHash`/the admin's own
  set-a-user's-PIN endpoints are left in place, unreachable from the member
  app — OTP-at-bind-time (the existing wallet-link flow) is now the sole
  authorization boundary for withdrawals, same as Bind Bank Account already
  was for adding a payout wallet in the first place.
- **Verified**: `node -c user-src/original_module.js`, `node --check
  server.js`, and `node build-core.js` (round-trip OK) all pass clean after
  every edit in this round.

**Auth screen correction round (owner reviewed the live deploy against the
mockup):** the round above shipped, then the owner compared it to what was
actually sent and pushed back — quoted because it's a real correction, not
a vague complaint: *"my tabs are boxed and these are round and login is
raised up and no navigation back to login after pressing create account...
please everything or design or term which was chipz don't use it here."*

- **Boxed, not round**: `.af-v2`/`.af-btn-v2`/`.af-btn-outline`/
  `.af-inline-btn` were built with `--r-pill` (999px, a full capsule) —
  wrong radius family for this mockup. Switched to `--r-ctl` (12px, the
  same "boxed" radius every button/input/chip elsewhere in the app already
  uses) — a mechanical fix, not a guess, once named correctly.
- **"Login is raised up"**: `.auth-scroll-v2` top-padded every pane by the
  same fixed amount regardless of how many fields it held, so the 2-field
  Log In pane sat pinned near the top with a dead gap below it while the
  6-field Register pane filled the screen — reads as "raised" relative to
  a design where the form should sit centred. Fixed with
  `justify-content:center` on the scroll container, which centres whichever
  single pane is visible; a pane too tall to fit still scrolls normally.
- **No way back to Log In from Register**: real gap, not a design opinion —
  the Forgot Password pane had "Back to Log In" but Register never got the
  equivalent. Added "Already have an account? Log In" under the Register
  button (new `.af-switch` class).
- **"Everything which was chipz don't use it here" — real audit, not just
  the auth screen**: `brandName()` (the sentence-form brand-name getter,
  used in dozens of places) fell back to the literal string `'Chipz'`
  whenever `STATE.settings.brandName` wasn't loaded yet — a real bug, not a
  style choice: on a fresh Petro deploy before the owner opens Admin ->
  Settings, or on a connection where the settings fetch hasn't landed yet,
  every one of those call sites would have rendered the word "Chipz" onto
  the screen. Fixed to fall back to `'Petro'` instead (this app's own real
  name, matching `server.js`'s own `DEFAULT_SETTINGS.brandName: 'Petro'` —
  it was only ever the client-side fallback that still said Chipz). Same
  bug, same fix, in `admin-src/index.html`'s `applyAdminBrandName()` (fell
  back to `'Chipz Admin'`) and its two static `data-brandadmin` placeholder
  headings (literally shipped as `Chipz Admin` in the markup, painted over
  once JS runs but visible for a frame on a slow load) — the admin
  `<title>` tag itself already said "Petro Admin", so only the two heading
  spans had drifted.
- **The wordmark's Playfair-Display-serif + `skewX(-6deg)` treatment, and
  its "last letter in accent colour" CHIP+Z split**, were Chipz's own
  bespoke typographic identity (their owner's specific request, name-pun
  included), carried into the fork unmodified and still live on the
  loading screen, the pre-launch countdown gate, the compact brand-mark
  badge (manual-deposit/download screens), and the fallback avatar/profile
  initials. Replaced everywhere with the app's own body font (Barlow
  Condensed, `font-weight:800`, no skew) and a plain name with no
  letter-split. `brandWordmarkHtml()` (module) and the pre-core boot
  script's own duplicate of the same logic (`index.html`'s inline
  `<script>`, which has to exist standalone since it paints before the
  module loads) were both updated to match — they have to stay identical,
  same as before.
- **The loading screen's letter-by-letter "wave" animation** (one `<i>` per
  character of "Loading......", each with its own staggered
  `animation-delay`) was also part of that same Chipz-specific
  choreography (a real, deliberate request from Chipz's own owner, per the
  comment history) — replaced with a single translatable text node and a
  plain opacity pulse on the whole word. This is a strict simplification of
  the translation fix already in place (the per-letter split existed only
  to drive the wave, never for translation — a single node was already the
  better match for how the translator replaces whole text nodes), so
  nothing about the "loader showed English on a fresh device" fix
  regressed.
- **Not touched this round** (flagged, not silently skipped): the
  still-Chipz raster PNG artwork (bottom-nav icons before the SVG
  replacement already done, `/act-bell.png`, `/treasure-chest.png`,
  `/turntable.png`, `/pay-success.png`, `/pay-failed.png`,
  `/logout-door.png`, the `/set-*.png` settings-row icons, etc. — see
  `user/sw.js`'s own `SHELL` precache list for the full inherited set) is
  still the owner's own uploaded artwork **for Chipz**, not Petro's. It
  wasn't touched here because it needs new artwork, not a code change —
  same flag this file has carried since the Home-screen round, not
  forgotten, just a different kind of work than a design/CSS/copy fix.
- **Verified**: `node -c user-src/original_module.js`, `node --check
  server.js`, `node build-core.js`, and `node build-admin.js` (round-trip
  OK on both) all pass clean after every edit in this round.

**Loading screen rebuilt from scratch, from a reference GIF (owner still not
satisfied with the loader after the round above):** owner: *"remove it even
it has background image like that of chipz, remove it entirely, only put
that loader everywhere for loading pages, make the best thing... check that
loader in gif carefully how it works and use it."* Sent a screenshot of the
live loader (dark red gradient backdrop, "PETRO" + "Loading..." text) next
to a reference GIF of a glowing circular percentage loader on pure black.

Read the GIF's actual frames (167 frames, `PIL`) rather than guessing from
the single still Claude Code normally sees, since the owner specifically
asked for the mechanism to be understood, not just the look copied:
- Three concentric rings, red at the bottom of the circle fading to
  blue/violet at the top -- a gradient FIXED in screen space, not rotating
  with the ring.
- The visible arc continuously grows and shrinks (nearly-full at frame 0,
  down to a sliver by frame ~20, back to nearly-full by frame ~40, etc.)
  while its gap also travels around the circle -- not a fixed spinner and
  not simple rotation, both together.
- A plain numeric counter in the centre climbs 0 → 100 over the loop and
  wraps back to 0 -- cosmetic, not tied to real progress (same as this
  screen always was; boot time genuinely varies).

Rebuilt `#loadingScreen` in `user-src/index.html` to match that mechanism
using standard SVG, not an embedded GIF (a raster asset can't recolor or
scale cleanly, and 167 frames is unnecessary weight for a boot screen):
- Background is flat `#000` -- no gradient, no image, no admin-configurable
  backdrop of any kind. (The old CSS comment referenced an
  `applyLoadingBackground()` admin-image feature for this screen that, on
  inspection, never actually existed anywhere in the codebase -- a stale
  comment from Chipz's own history, not a real feature that needed
  removing. There was never anything to unwire.)
- Three `<circle>` elements, each with `pathLength="100"` (SVG2, normalises
  every ring's dash math to a 0-100 scale regardless of its real radius) so
  all three share ONE `stroke-dasharray`/`stroke-dashoffset` keyframe
  animation and stay in lockstep instead of spiralling apart -- matching
  how the reference's three rings move together.
- `stroke-dashoffset` animating alone (deliberately no `transform:rotate`)
  is what makes the gap travel around the ring while the `linearGradient`
  (red low, violet high) stays fixed in screen space, matching the
  reference exactly -- a transform-based spinner would have dragged the
  gradient around with it instead.
- `filter:drop-shadow(...)` (two stacked, red + violet) for the glow halo.
- A plain `#lsPercent` div, climbing 0-100 in uneven random steps every
  110ms and wrapping to 0, driven by a small IIFE in the pre-core
  `<script>` block (has to run before the module exists, same as the old
  brand-name/loading-word painters it replaces). A `MutationObserver` on
  `#loadingScreen`'s own `style` attribute starts/stops the interval
  automatically, rather than editing the ~10 existing call sites that show
  and hide the loading screen mid-session (login, sign-up, returning to
  the app, etc.).
- **No wordmark on this screen at all now** -- the reference has none, and
  the owner has corrected two rounds in a row for anything added beyond
  what was actually sent, so nothing was guessed back in. `brandWordmarkHtml()`
  and `[data-brandmark]` are unchanged and still paint the pre-launch
  countdown gate's own mark; the loading screen simply no longer has one
  of those elements to paint into.
- Old, Chipz-derived CSS/markup/JS actually deleted, not left as dead code,
  since the owner's ask this round was specifically to stop seeing it
  anywhere, not just stop rendering it: `.ls-wordmark`, `.ls-text`, the
  `loadWave` keyframe, the per-letter `<i>` markup, and the entire
  `LOADING_WORD_KEY`/`rememberLoadingWord()`/`__paintLoadingWord()`
  pre-core-translation-caching system (no longer needed -- a numeric
  counter has nothing to translate).
- **Verified**: `node -c user-src/original_module.js`, `node
  build-core.js` (round-trip OK). Also rendered the new loader standalone
  in a headless Chromium (Playwright) and screenshotted it mid-animation to
  visually confirm the arc-pulse/gradient/glow/counter behavior actually
  matches the reference before shipping, rather than trusting the CSS math
  alone.

**Admin panel audit round: real Chipz logos found and replaced, dead
settings sections removed, subdomain UI removed, auth phone prefix
restored.** Owner: *"admin panel still have chipz logos... please orgase
those tabs very well banners or images should have it category too not
putting in settings, remove unnecessary words in settings those
sentences... turntable, regulations, etc there are useless things
there... this time no using subdomains, so remove stuffs of subdomains,
only on signup or login one selects country code besides the number area
ie 256|... look for designs and architecture from internet cloud."*

- **The literal Chipz logo, found and replaced.** `user/icon-192.png` /
  `user/icon-512.png` / `admin/icon-192.png` / `admin/icon-512.png` were
  never actually replaced since the fork -- opening them showed the literal
  "CHIPZ" wordmark on the old red-orange gradient. This is not a cosmetic
  detail: `server.js`'s `bundledBrandAsset()` serves `user/icon-*.png` as
  the fallback for the `/public/app-icon-*.png` route BOTH apps' favicon,
  PWA install icon and manifest icon use whenever no custom logo is
  uploaded -- so every visitor's browser tab and every phone that installs
  the app has been getting the Chipz logo, this whole time, until the owner
  uploads their own. `admin/icon-192.png` separately backs the admin
  panel's own visible `#brandMarkLogin`/`#brandMarkTop` marks (a same-origin
  `<img src="/icon-192.png">`, not the backend route). Generated a real
  replacement -- red-to-gold diagonal gradient (the established Corporate
  Red -> Golden Orange palette), bold white "P" monogram, no serif, no skew
  -- and wrote it to all four paths. This is a default, not a final brand
  mark -- the owner can still override it any time via Admin -> Settings ->
  App icon / Brand logo, which take priority.
- **Literal "Chipz"/"CHIPZ" text throughout admin-src's Settings copy**,
  found by grep and fixed one string at a time (not a blanket find/replace,
  to avoid touching CSS var names, localStorage keys, or historical code
  comments that are legitimate documentation, not residue): the "CHIPZ
  wordmark" fallback-state labels on 3 different image-upload rows, "Built-in
  Chipz icon", "Reverted to the CHIPZ wordmark" toasts (x2), the App
  name field's own hardcoded `'Chipz'` default (a real bug, same class as
  the client-side `brandName()` bug fixed last round -- now `'Petro'`,
  matching `server.js`'s own `DEFAULT_SETTINGS.brandName`), placeholder
  examples ("Welcome to Chipz", "Chipz MTN 1"), and 4 translation-table rows
  that were orphaned anyway once their English source text changed (deleted,
  not re-translated -- the phrases no longer exist to translate).
- **"Login & Sign Up screen" admin section rewritten** -- it still described
  the OLD two-part hero-band + white-card auth layout ("1. Top band (behind
  the CHIPZ logo)... 2. The form card") that the single-photo redesign two
  rounds ago replaced. This directly answers "where is the option for
  uploading background images of authentication screens" -- it was always
  there, just describing a screen that no longer existed. The now-dead
  second upload slot (`authCardImage`/`authCardFile`/`authCardOp`/
  `authCardBlur` -- nothing in the current auth markup reads
  `--auth-card-*` any more, confirmed two rounds ago) is removed, not just
  relabeled -- **a real bug caught while removing it**: the "Save opacity &
  blur" button's own handler read `$('authCardOp').value`/`$('authCardBlur').value`
  unconditionally, which would have thrown the moment those inputs were
  deleted, breaking the whole button. Fixed by dropping those two keys from
  the save payload, same as the auth-card upload wiring itself.
- **Turntable (spin wheel) removed from Settings and Products**, matching
  the feature's removal from the user app 2 rounds ago (`paintHome()` no
  longer renders it) -- the "Turntable (spin wheel)" settings section
  (daily-spin min/max, enabled toggle), the duplicate "Home spin banner"
  image slot, and the per-product "Turntable spins from this product"
  fields (spin count/min/max win, on every product's edit form) are all
  gone -- they configured a feature members can no longer reach at all.
  **A second real bug caught while removing it**: `$('saveTurntable')` had
  no null-check (unlike its siblings), which would have thrown and broken
  every settings handler registered after it the moment the section's HTML
  came out -- same failure shape as the announcement-removal bug from
  several rounds ago, caught the same way (grep for the id's every use
  before deleting the markup, not after). Also found and closed a live gap
  in the user app itself while tracing this: Balance Record's "Turntable"
  filter tab was still a real, reachable tab (`_balTab`) even though nothing
  could ever populate it any more -- removed from the tab list; the
  now-unreachable `TURNTABLE_TX_TYPES`/`balTabMatch()` branch is left in
  place, inert.
- **"Regulation page" settings section removed -- confirmed genuinely dead,
  not just redundant.** Its `rulesText` fed `window.openInfoSheet('rules')`
  in the user app, which turned out to have **zero call sites anywhere** --
  entirely unreachable, so nothing the admin ever typed there was ever
  shown to a member. (The real "Rules & Terms" content members actually see
  lives inside the About Us article now, a different, live, working
  system -- confirmed separately and left untouched.) **A third real bug
  caught the same way**: `$('saveReg')` also had no null-check.
- **"About page" section checked and left alone** -- confirmed live and
  correctly branded (its own empty-state fallback already reads through
  `brandName()`, which now defaults to 'Petro', not hardcoded 'Chipz').
  Real, working content management, not residue -- not every section
  flagged this round turned out to be dead, and this one was verified
  rather than assumed.
- **Subdomain/multi-country admin UI removed**: the "Countries" tab
  (region CRUD, short-address minting, base-domain/host-matching tools --
  ~300 lines) and the "Where the app may be opened from" Settings section
  (base domain, root-domain blocking, strict-host matching, retired
  addresses, arrival-rotation) are gone from the UI the owner can reach.
  Deliberately **not** a deep rip-out of the underlying region data model
  (`ADMIN_REGIONS`/`currentRegion()`/`phoneToEmail()`/`regionByKeyAdmin()`
  in both server.js and admin-src) -- that infrastructure is threaded
  through Settings/Products/Messages/Users for legitimate non-subdomain
  reasons (currency labelling, per-country rate/product overrides if a
  country is ever added again) and, per its own code comments, was already
  built to hide every multi-region affordance the moment only one region
  (`_regionsSnapshot = [DEFAULT_REGION]`, Uganda) is configured -- which it
  already is; nothing has ever added a second country. Ripping that out
  under time pressure risked exactly the kind of auth breakage this file's
  own money-safety section warns about (`phoneToEmail()` must keep
  producing byte-identical addresses for any account that already exists).
  What actually made "subdomain stuff" visible to the owner was the tab and
  the settings section, both entry points now gone -- not the dormant
  data model behind them. **A fourth null-check bug avoided by tracing
  first**: removed `regionsTab` from the two places (`openShell()`'s
  role-visibility array, `VALID_TABS`) that referenced it by id before
  deleting the button itself, instead of after.
- **Country-code prefix restored on the auth phone fields** -- a real
  regression from the single-screen auth rebuild 2 rounds ago, now that the
  owner named it directly: `#loginDial`/`#regDial`/`#forgotDial` were
  removed from the markup along with the old two-part layout, but
  `paintRegionChrome()` (`dialPlus()` -> `$(id).textContent`) was **never
  actually removed** -- it kept null-safely no-op'ing every boot, waiting
  for elements that no longer existed. Re-added all three as a `.af-prefix`
  chip in the exact slot the leading icon used to sit (matching the
  existing `.dep-phone .prefix` chip the deposit screen already uses, not
  a new pattern), wired to zero new JS -- the mechanism was already there
  and already correct, it just had nothing left to paint into.
- **Verified**: `node -c`, `node --check server.js`, `node build-core.js` +
  `node build-admin.js` (both round-trip OK) all pass clean. Also rendered
  the actual built `user/index.html` standalone in headless Chromium,
  forced the auth screen visible offline, and screenshotted the Log In and
  Sign Up panes to visually confirm the boxed fields, centred layout, the
  restored "+256" chip and the new "Already have an account?" link all
  render correctly together -- not just checked in isolation.
- **Not done this round** (flagged, scope was already very large): the
  still-Chipz raster PNG artwork (nav/activity/pay-result/chest/spin-wheel
  clipart -- none of it carries literal Chipz text/logo, confirmed by
  actually opening several of the files, so lower urgency than the logo
  fix above) is unchanged; a dedicated "Media"/"Banners" admin tab pulling
  every image-upload section out of Settings (owner: "banners or images
  should have it category too not putting in settings") was not built this
  round -- Settings is shorter now (Turntable, Home spin banner, Regulation
  page, the old auth-card slot, and the whole subdomain section are gone),
  but the reorganization itself is still open.

**Admin panel deep cleanup: bank OTP made optional, Settings gutted down to
what's real, a new Banners tab, Products renamed to Assets, asset renaming
fixed.** The still-open items flagged in the round above (the Banners tab,
verbose copy) are done now. Owner's message this round, verbatim, since it's
long and specific: *"remove otp on withdrawal bank account please, also
remove require code option in admin panel, it should be optional... remove
those explanations in admin panel those all sentences, l line is enough
simple summarized, remove appearance settings, remove countdown settings,
remove multiplier of with multiples of withdrawal settings, remove product,
these are assets please, make sure all 2 asset name fields are editable in
admin, remove spin rewards in them... remove all images in settings, we
should create a new category call banners, so everything lives there, and
let's remove auto approve settings, profile animation settings... remove
brand logo, help center banner, support contacts only put group field and
customer service tg contact link, and WhatsApp group or channel, referral
banner, push notification settings."*

- **OTP on adding a bank/payout account is now optional, off by default**
  (`bankOtpRequired` setting, new admin toggle under Rates & limits ->
  Withdrawals). `/bank/save` only calls `consumeOtpTicket()` when the
  setting is on. Client-side, `submitWallet()` branches: off saves straight
  away, on keeps the exact same two-phase OTP flow as before -- extracted
  the shared post-save tail (dedupe to one wallet, refresh state, notify)
  into `finishWalletSave()` so both paths call the same code instead of
  duplicating it.
- **Owner asked about OTP security directly, sent MarzSMS's real API docs.**
  Checked against them rather than assumed: the system already matched
  every property asked for -- `OTP_EXPIRES_MS = 10 * 60 * 1000` (exactly
  10 minutes), `codeHash: scryptHash(code)` (the raw code is never stored,
  same as a password), server-generated via `crypto.randomInt`, 5-attempt
  cap, daily per-phone throttling. `marzSmsSend()` was also already
  correctly wired to the real API -- right base URL, right endpoint, right
  body shape, and the response-shape comment already correctly notes
  MarzSMS's `{success,message,error}` envelope (no `status` field) has no
  bearing on `resp.ok`, which is what the code actually branches on. Nothing
  needed changing; the only real gap is `MARZSMS_KEY` itself, still unset.
- **Settings gutted to what's real**, each confirmed dead or genuinely
  redundant before removal, not assumed:
  - **Appearance** (number/digit font, home activity-ticker speed) --
    removed. The ticker speed setting was already controlling a UI element
    (the activity ticker) removed from Home 3 rounds ago -- doubly dead.
  - **Opening countdown** -- admin toggle and date/time removed (defaults
    to off already, so the pre-launch gate is now permanently unreachable
    from the UI, same "leave the dormant code, remove the only way to turn
    it on" pattern as Turntable/subdomains in the round above).
  - **Withdrawal multiple** -- admin field removed; `DEFAULT_SETTINGS.withdrawMultiple`
    changed from 5000 to 0 (0 = any amount above the minimum). **Caveat**: this
    only changes the default for a *fresh* settings document -- if a
    non-zero multiple was ever actually saved live, it stays in the
    database until cleared by hand (no DB access from this session to
    confirm either way; low risk since no real config work has happened
    yet per this file's own status notes).
  - **Auto-approve withdrawals** -- section, its confirm-before-enabling
    guard, and its save handler all removed (`autoApproveWithdrawalsEnabled`
    already defaults to false, so this is permanently off now).
  - **Profile animation** (the GIF slot) -- section and its raw-bytes
    upload/clear handlers removed.
  - **Brand logo**, **Help Centre banner**, **Referral banner** -- sections
    and handlers removed outright (not moved to Banners) -- the owner named
    these specifically as "not talked about yet."
  - **Support contacts** cut from 6 fields to 3: Telegram group, Customer
    Service (Telegram), WhatsApp group or channel. Telegram channel,
    WhatsApp contact and Support hours dropped.
  - **"Regulation page"** and the old **auth-card** slot were already
    removed in the round above; this round's own sweep found and removed 3
    more real crash bugs of the exact same shape (`$('saveTurntable')`,
    `$('saveReg')`, `$('sAutoApproveOn')`/`$('saveAutoApprove')`, `$('pushClearAllBtn')`
    was already null-checked) -- an unguarded `.addEventListener` on an id
    whose markup this same round deleted, which would have thrown and
    broken every settings handler wired after it. Every removal in this
    round was traced (grep the id's every use) before the markup came out,
    specifically to keep from repeating this.
  - Every remaining `<p class="muted">` explanation across Rates & limits,
    Manual payments, Withdrawals, Payment numbers, Payment reminder, App
    name and About page cut to one line, dropping the backstory/rationale
    (kept in code comments, just not shown to the admin).
- **New "Banners" tab** -- every image/video upload pulled out of Settings:
  Home banner (+ video), Home banner slides 2 & 3, Home footer banner,
  Account screen header photo, Login & Sign Up background, App icon, Link
  preview, Download screen background, Manual payment screen images. Own
  `renderBanners()` + `wireBannerHandlers()`, own small `Promise.all` (self-
  contained, same pattern every other tab already uses, rather than sharing
  `renderSettings()`'s closure) -- one extra small fetch round-trip on
  switching tabs, in exchange for not threading one function's state across
  two. Every handler moved verbatim, with `renderSettings()` calls inside
  them swapped for `renderBanners()` so a save/clear correctly repaints the
  tab it's actually on.
- **Products renamed to Assets everywhere it's visible** -- the tab label,
  every heading/button/toast/confirm text ("New asset", "Edit asset",
  "Delete this asset?", "No assets yet", etc.). Internal identifiers
  (`data-tab="products"`, `renderProducts()`, `/admin/products/*` routes)
  deliberately left alone -- renaming code identifiers this deep for a
  label change is unnecessary churn/risk with zero user-visible benefit.
- **"Make sure all 2 asset name fields are editable"** -- read as Name and
  Key, the two text-identifier fields on the asset editor; Key was disabled
  once an asset existed. Re-enabling it naively would have reintroduced the
  exact bug this file's own history already fixed once (editing "product-1"
  silently creating a second "product1" doc) -- so this is a real rename
  feature, not just an unlocked input:
  - Client (`editProduct()`): the Key field is no longer disabled. On save,
    a *typed* Key value is slugified and used; an untouched/blank Key box
    falls back to the original key unchanged (never re-derived from Name --
    that fallback is exactly what caused the original bug). `oldKey` is
    sent only when the key actually changed.
  - Server (`/admin/products/save`): a rename is a delete-old + set-new in
    the same batch, not a second `set` alongside the old key. Refuses
    outright if the new key already belongs to a *different* existing
    asset (would otherwise silently overwrite it) or if `oldKey` doesn't
    correspond to a real existing document. Rename is only accepted when
    saving to the founding region -- a region-scoped save only ever patches
    a `regions.<key>` sub-object on a document it does not own the identity
    of, so it has nothing to rename.
  - **"Remove spin rewards in them"**: already fully done last round
    (the per-product Turntable fields removed from the editor) -- verified
    while investigating the rename feature that `sanitizeProductInput()`
    unconditionally writes `spinMin`/`spinMax`/`spinCount` into the
    sanitized object (null/0 when absent from the payload), so every save
    of an existing asset already clears any old spin config to nothing.
    No further action needed, confirmed rather than assumed.
- **Verified**: `node -c`, `node --check server.js`, `node build-core.js` +
  `node build-admin.js` (both round-trip OK) all pass clean. A script
  cross-checked every unguarded `$('id').addEventListener/.value/...` in
  admin-src against every id that still actually exists in the file's own
  markup, to catch any other landmine of the same shape before shipping,
  not just the ones caught by hand. Both service-worker caches bumped.

**Auth screens had their own second error pattern, found live from a
screenshot; notify() moved from bottom to centre.** Owner sent a
screenshot of a "SMS verification is not available right now" message
sitting as a light-pink box inline in the Register form, asked *"why
this"* and said *"l nolonger need such notifies of in page, l need it to
appear like as l said, all notifies in middle not bottom."*

- **The "why"**: `/auth/otp/send` correctly refuses with 503 whenever
  `MARZSMS_KEY` is unset (see the OTP round above) -- expected server
  behaviour, not a bug. What WAS wrong is how the error reached the
  screen: `regError()`/`forgotError()` and two spots in `doLogin()` wrote
  their own `<div class="auth-error">` (a light pink box, `--snow-wine-soft`)
  straight into `#regError`/`#forgotError`/`#loginError` -- a second,
  auth-screen-only error UI that existed alongside the app-wide `notify()`
  toast every other screen already uses. Not a design choice anyone
  remembers making on purpose -- it predates this session's own auth
  rebuild and just never got reconciled with `notify()` when everything
  else did.
- **Fixed by routing through `notify()`, not by patching the old pattern**:
  `regError(msg)`/`forgotError(msg)` are now one-line wrappers
  (`if (msg) notify(msg);`) so every existing call site
  (`doRegSendOtp`/`doRegister`/`doForgotSendOtp`/`doForgotSubmit`) needed no
  changes at all. `doLogin()`'s two inline writes became direct `notify()`
  calls. The now-permanently-empty `#loginError`/`#regError`/`#forgotError`
  containers are removed from the markup (not just left inert -- nothing
  writes into them any more, so there was nothing to preserve), and the
  now-fully-unused `.auth-error` CSS rule is deleted outright, same "the
  owner said stop using this, so it's actually gone" standard as the
  Chipz-design sweep two rounds back.
- **`notify()` repositioned from bottom-anchored to screen-centre** --
  `.notify-bg` was `position:fixed;...bottom:calc(var(--nav-h) + 14px)`
  (a deliberate earlier decision, "open/appear from down", kept until now);
  it's `inset:0;display:flex;align-items:center;justify-content:center`
  now. The entrance animation changed from a slide-up (`translateY`, which
  only made sense anchored to an edge) to a scale+fade
  (`transform:scale(.9)->scale(1)`), still small and dark, still no
  backdrop/OK button, still auto-dismissing on its own timer -- only the
  position and the matching entrance motion changed, not the toast's own
  visual language from 2 rounds ago.
- **Verified**: `node -c` passes, `build-core.js` round-trip OK, and
  rendered the actual built bundle standalone in headless Chromium with the
  Register pane forced open and `notify()` called with the owner's exact
  screenshot message, to confirm the toast now centres correctly over the
  auth background rather than trusting the CSS math alone. sw.js cache
  bumped.

**`.sheet-head` (every sub-page's header) was still Chipz's, verbatim, and
had never been re-themed — owner sent screenshots of About, Balance
Record, and Messages all showing a peach band and a cyan-to-blue gradient
back-chevron, called it out hard: *"still seeing chipz elements... same
blue navigation arrow... you mixed faeces and food."* Fair — this wasn't a
subtle miss. `.sheet-head`'s own CSS comment literally claimed the peach
band + blue chevron was "in the approved mockups", which was simply false;
nothing in this file's design-system section ever specified that, and the
SVG ids were named `chipzBack`/`chipzBackPay`, an honest label nobody had
acted on.

- **Why this was the single highest-leverage fix available**: every
  sub-page that opens via `openSheet()` — About, all 3 Balance Record tabs,
  My Team, Gift Codes, Security Settings, Messages, and more — shares this
  one `.sheet-head` rule. One CSS fix corrects all of them at once, the
  same "swap the token, not each screen" leverage the original color-token
  retheme used.
- Background changed from `linear-gradient(180deg,#ffe3d1,var(--snow-canvas))`
  (Chipz's peach) to a solid `var(--snow-wine)` (this app's own Corporate
  Red, `#e30613`) — reusing the same red the Home/Account top bars already
  established, not inventing a second header style. Title text set to
  white (`.sheet-head h2{color:#fff}`) to stay legible on it.
  `#depStatusBg .pay-head` (the deposit-poll page's own header, which
  intentionally reuses `.sheet-head` byte-for-byte, per its own comment)
  is fixed for free by the same rule.
- Both back-chevron `<svg>`s (the sheet header's and the deposit-status
  page's) had their own duplicated `chipzBack`/`chipzBackPay` cyan-to-blue
  `<linearGradient>` defs — removed entirely, replaced with a plain
  `stroke="#fff"` path, since the icon now sits on a solid red background
  rather than a light peach one.
- **The bold/condensed font complaint is real and separate**: `body`'s
  `font-family` was still `'Barlow Condensed'`, Chipz's own inherited
  choice (see "Design language" above — this was flagged as unrevisited
  back at the fork, never actually acted on). Because nearly every other
  rule in this file reads `font-family:inherit`, this was a second
  single-point fix: swapped to `'Inter'` (normal-width, not condensed —
  Barlow Condensed's narrowness compounding with this file's many
  `font-weight:700/800` rules is what read as "chunky/bold"). Also
  deleted, from the Google Fonts `<link>`, five families that turned out
  to be dead imports entirely (`Playfair Display`, `Bodoni Moda`,
  `DM Serif Display`, `Roboto Mono`, `JetBrains Mono`, `Orbitron`) —
  confirmed by grep that none of them were referenced by any active CSS
  rule anywhere else in the file before removing them, not assumed.
  `--number-font` (referenced by `.mono`/`.p-stat .v`/etc.) was never
  actually *set* anywhere in `:root`, so it was already silently falling
  back to `inherit` — fixed for free by the same body-font swap, nothing
  extra needed there.
- **Not fixed this round, flagged rather than guessed at**: the owner also
  named the bottom-nav tab-switch animation and the Bind Bank Account
  card's design ("still shows the one of chipz") as unconvincing. The nav
  icons/colors were already re-themed (see "Bottom nav collapsed..."
  above) — what's left is the transition *motion* itself, inherited
  unchanged from Chipz and never audited. The wallet/bank card
  (`.wallet-card`, `user-src/index.html`) already uses this app's own
  red-to-gold gradient, not Chipz's colors — CLAUDE.md's own Account-screen
  section already flagged its layout (bank-card metaphor, chip icon,
  sheen animation) as "the underlying flow is untouched" from Chipz, which
  is exactly what's now being pointed at. Both are real, undone design
  work — no mockup has specified what either should look like instead, and
  guessing at a new nav-transition feel or a new bank-card design without
  one is exactly the "do not invent unprompted" mistake this file warns
  against elsewhere. Needs the owner's direction (or explicit permission to
  design freely), not a guess.
- **Verified**: `node -c user-src/original_module.js`, `node
  build-core.js` (round-trip OK). Headless-Chromium visual verification
  was not run this round (no local Playwright install in this sandbox,
  unlike prior rounds) — confirmed by reading the changed CSS/SVG directly
  instead; the owner's own next look at the live deploy is the real check.
  sw.js cache bumped (v123 -> v124).

**Real Android rendering bug found immediately after the round above shipped
— Home's own text was bleeding through underneath the Deposit/Withdraw
sheets.** Owner sent screenshots: "Energy for a Better Tomorrow" (Home's
topbar tagline) visible through the Deposit amount grid, the 3-stat row and
"Daily Check-in" visible through Withdraw's wallet card — not cosmetic, a
real defect, and not the peach-header bug (that was already fixed; these
screenshots show the new solid-red header rendering correctly, the ghosting
is a separate issue underneath it).

- **Root cause, not just a description**: `.sheet-bg`'s background
  (`var(--snow-canvas)`) is fully opaque and its z-index (200) is above
  Home's content — this is NOT a stacking/opacity bug, confirmed by reading
  every `position:fixed` rule in the file and finding nothing above it
  except `.bottom-nav` (z-index 210, correctly still visible). It's a
  known Android Chrome/WebView compositing bug: a `position:sticky` child
  (`.sheet-head`) inside an `overflow-y:auto` container that's just been
  toggled `display:none -> block` can leave the PREVIOUS screen's
  already-painted pixels on screen wherever the new content doesn't touch
  every pixel (grid gaps, the space around text), until something forces a
  full repaint.
- **Fix**: `transform:translateZ(0);will-change:transform;` on `.sheet-bg`
  and `.pay-page` (the deposit-poll page, which reuses `.sheet-head` the
  same way) — promotes each to its own GPU compositing layer, which forces
  a full repaint on open instead of a partial one. Purely a paint-layer
  hint; no visual/layout change.
- **Verified**: `node -c`, `build-core.js` round-trip OK. This class of bug
  is specifically a mobile-WebView compositing quirk that does not
  reproduce in a desktop-style headless browser, so the real test is the
  owner's own phone after this deploy — noted here rather than claimed as
  confirmed. sw.js cache bumped (v124 -> v125).

**Owner pushed back again, harder, immediately after the round above:
"remove all red headers... build a different page of everything, not
copying... withdrawal page... not a must to put the card of wallet...
not a must to put many quick amounts... put network boxes 2 of them such
that one can select mtn or airtel also images of logos of network will be
uploaded from admin panel."** Screenshots showed the solid-red
`.sheet-head` fix from the round above with a hand-drawn circle around
Home's OWN top bar too, plus the still-unconfirmed compositing fix (same
old Deposit/Withdraw screenshots re-sent, not fresh ones — whether that
bug is actually gone hasn't been re-verified live yet). Treated
"remove all red headers" as covering both, since it's explicit and Home's
top bar was circled directly.

- **`.sheet-head` and `.home-topbar-v2`** (the latter shared by Home,
  Account, Network, and My Assets — one more high-leverage single-class
  fix) both dropped their solid Corporate Red fill entirely, in favor of a
  plain white bar with dark text/icons and a thin bottom rule. Chipz's own
  owner independently reached the identical conclusion once already, for
  the manual-pay overlay specifically (see the long comment above
  `depositChipsHtml()` in original_module.js: *"don't expect header bars
  or red colors, just fresh well sized screen"*) — this is that same call,
  generalized to every other header. Red is now reserved for buttons,
  active states, and real emphasis, not page furniture. The PETRO mark in
  `.htb-logo` became a solid red circle (was translucent-white-on-red) so
  the brand color survives even though the bar itself no longer carries
  it. Both back-chevron SVGs recolored from white to charcoal to match.
- **`.wallet-card` (the glossy bank-card tile with the sheen-sweep
  animation) replaced with a plain 3-row info panel** (`.wallet-info`,
  `walletCardHtml()` in original_module.js) — same provider/number/holder
  data, no bank-card metaphor, no animation. Real reversal of a genuine
  owner-requested feature from an earlier round (the sheen sweep was a
  specific, deliberate ask, quoted in the CSS comment it replaced) — not a
  bug fix, a direction change, and treated as one (old CSS deleted
  outright, not left as dead code, matching this file's "when told to stop
  using something, actually remove it" standard).
- **Not done this round, flagged rather than rushed**: the "many quick
  amounts" chip grid on Deposit (`depositChipsHtml()`) shows one chip per
  distinct asset price — currently 12, one per product, which is WHY it's
  dense, not a bug in the chip logic itself. Capping it to an arbitrary
  smaller number would silently hide real asset prices a member might
  want, which is a real product-catalog-size question, not a quick visual
  fix — needs the owner's call on whether they want fewer PRESET amounts
  (decoupled from the asset list) or the catalog itself trimmed, not a
  guess. The network-selector ask ("2 boxes, MTN or Airtel, admin-
  uploadable logos") is a real, separate feature: an MTN/Airtel 2-box
  picker with logos already exists (`.mp-method`, `MTN_LOGO_DATA_URI`/
  `AIRTEL_LOGO_DATA_URI`, `manualPayChooseMethod()`) but only inside the
  manual-payment (PAY-B) sub-flow, reached after Deposit's own amount/
  method step, not on the Deposit page itself, and its logos are hardcoded
  data URIs, not admin-uploadable. Moving/duplicating this to the top of
  Deposit touches real payment-routing logic (`_manDepChosenMethod`,
  which network's admin numbers get shown) — genuinely the "build a
  different page of everything" work the owner asked for, needs its own
  careful pass (plus a new admin-panel upload slot + asset-serving route
  for the logos, real backend work) rather than a rushed change to a
  money path under time pressure. Flagged here as the next concrete step,
  not silently skipped.
- **Verified**: `node -c`, `build-core.js` round-trip OK. sw.js cache
  bumped (v125 -> v126). Not yet re-confirmed live: whether the previous
  round's compositing-layer fix actually resolved the Home-bleed-through
  bug (the owner's screenshots this round were the same ones from before
  that fix shipped, not fresh) — worth explicitly asking about on the next
  check-in rather than assuming either way.

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
- **Auto-deploy webhook (`POST /deploy/webhook`), built this session** — the
  owner called the manual Termux loop above "tiresome" (fair — three
  commands, every single change), so this closes it: GitHub calls this route
  on every push to `claude/petro-platform-build`, and the VPS does the exact
  three commands above **by itself** (git pull → npm install --omit=dev →
  `pm2 reload petro-server`), all fire-and-forget in the background so
  GitHub's own 10-second webhook timeout is never at risk. Authenticated by
  HMAC-SHA256 over the raw request body (`DEPLOY_WEBHOOK_SECRET`, GitHub's
  own recommended mechanism, same pattern this file already uses for
  PesaJet's webhook) — nothing from the request body is ever interpolated
  into a shell command, every command is a fixed literal argv array via
  `execFile`, so there's no injection surface even though the route's whole
  job is running commands. Only redeploys on a push to the exact branch
  above; a `ping` (GitHub sends one automatically when the webhook is first
  created) is answered without doing anything.
  **One-time setup is done, per the owner (2026-09-22) — the webhook is
  live.** Both sides (`DEPLOY_WEBHOOK_SECRET` in the VPS's
  `secrets.local.js`, and the GitHub repo webhook pointed at
  `http://179.198.197.114:3000/deploy/webhook`) are wired up, so **every
  push to `claude/petro-platform-build` now reaches the VPS with zero
  manual steps** — this doc's older "the code in this commit needs `git
  pull` + rebuild + `pm2 reload` on the VPS" notes elsewhere in this file
  are from before this was wired up and no longer apply. **Caveat: a
  Claude session cannot verify a delivery actually landed** — this
  environment's outbound network is HTTPS-through-a-proxy only (see the
  correction above), so it cannot curl the VPS's bare-HTTP `:3000` or
  check `pm2 logs` itself; confirm on GitHub → repo → Settings → Webhooks
  → the delivery log if a push and the live app ever seem out of sync.
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

## 2026-09-22 — fresh Petro visual rebuild / Chipz inheritance audit

Owner direction for this round was explicit: **build the member/admin visual
identity afresh rather than continuing to patch the Chipz fork.** The current
Petro design system is therefore no longer an open question:

- Corporate Red **#E30613**
- Clean White
- Golden Orange **#F5A000–#FFB000**
- Charcoal **#25262B**
- **Inter** for member UI/body/numbers; do not reintroduce Barlow Condensed.
- Interaction motion is restrained and functional. Do not restore Chipz's
  spring/squash/overshoot tab motion, perpetual CTA sheen, wallet sheen, or
  treasure-chest bounce.

### What was verified, not assumed

The current branch was audited directly against `chipz/user/`. Blob hashes
confirmed that these Petro files were still **byte-for-byte identical to
Chipz artwork**: `treasure-chest.png`, `turntable.png`,
`spin-wheel.png`, `copy-clip.png`, `pay-success.png`,
`pay-failed.png`, `logout-door.png`, all legacy `nav-*.png`,
`act-*.png`, and `set-*.png`. Only `icon-192.png` and
`icon-512.png` were already Petro-specific. The identical Chipz artwork is
now removed from `petro/user/`, and there are no live static references to
it in member source or the user service worker.

### Member UI rebuild completed

- Bottom navigation is now a clean white industrial rail with a restrained
  red top indicator and a short signal-dip tap response. The inherited
  `navBoxBounce` / `navIconBounce` choreography is gone.
- The old perpetual filled-button highlight sweep is gone.
- The payout-account screen no longer imitates a plastic bank card: no EMV
  chip, no card-number treatment, no animated sheen. It is a mobile-money
  **Payout Wallet** status panel with provider, linked state, number, holder,
  and network. Account navigation also says **Payout Wallet** rather than
  **Bind Bank Account**.
- Gift Codes no longer uses Chipz treasure-chest artwork/metaphor. Redemption
  and reward-result UI are Petro red/gold vector treatments while the same
  backend redeem flow remains intact.
- Team, copy, payment success/failure, settings helper, and payout-wallet
  visuals no longer depend on inherited raster artwork; inline Petro SVGs are
  used instead.
- The dead Home treasure float / `chestBounce` CSS is deleted. Home must
  carry **zero** inherited treasure/turntable reward floats.
- The unreachable old Turntable presentation code and old Home “Go spin”
  banner were removed. **Turntable transaction-history types are retained**
  so historical ledger records still render; no money ledger semantics were
  removed.
- The configurable “System default” number font no longer points back to
  Barlow Condensed; it uses Inter/system sans.
- Static page description / OpenGraph branding says Petro rather than Chipz.
- Existing sheet-header Corporate Red + white-chevron treatment, Inter body
  font, and Android Chrome `translateZ(0)` sheet compositing fix remain in
  place.

### Admin / shell cleanup completed

- Admin theme color is Corporate Red; inherited brown/pink gradient logo and
  button treatments were replaced by the Petro palette.
- Admin default/example domains now use Petro naming rather than
  `chipz-platform.com`.
- **Real fork bug fixed:** `admin/sw.js` was still initialized against
  Chipz Firebase (`chipz-23a4c`) and labeled background pushes “Chipz
  Admin”. It now uses Petro's public `chnpetrol` Firebase web config and
  “Petro Admin”.
- User SW cache is now **`petro-shell-v126`** (real-change cache bump);
  vendor/brand cache names are Petro-specific and the shell precache contains
  only the actual app shell + Petro icons, not the removed Chipz raster pack.
- Admin SW cache is `petro-admin-shell-v36`.
- Old-browser build fallbacks now say Petro / Petro Admin.

### Build / verification result for this round

Both generated bundles were rebuilt from their real source folders with the
repository's own scripts. **Both printed `round-trip OK`** and passed
source/obfuscated syntax checks.

The final verification run passed:
- source syntax checks for member module, server, user SW, admin SW
- guard asserting no live legacy Chipz raster references
- `node build-core.js`
- `node build-admin.js`
- `test-code-security.js`
- updated Petro branding regression test
- `test-visible-text.py` in Chromium: all main screens visible, no
  opacity-zero text offenders, no page errors, rendered region nonblank
- updated `test-nav-sheets.py` in Chromium

Two inherited tests are explicitly **not valid release gates as written**:
- `test-audit-money-regressions.js` requires a source anchor
  `async function _lipaParse(` that is already absent on the untouched
  pre-redesign target branch.
- `test-csp-runtime.py` treats the current bare-HTTP VPS test icon
  `http://179.198.197.114:3000/public/app-icon-192.png` as a legitimate
  image while the unchanged baseline CSP intentionally allows images from
  self/data/blob/HTTPS only. That mismatch predates this redesign; do not
  loosen CSP merely to make that fixture pass. Revisit together with the
  planned real HTTPS domain/backend-origin cutover.

The navigation test was also updated to match product decisions already in
this file: the announcement dialog has been removed, Home has no reward
floats, and the unreachable Turntable screen is not a navigation contract.

## Manual payment collection removed entirely; deposit chips, sheet nav, and a shared loading mark

Owner, verbatim, since it's long and specific: *"remove option for payment
methods, remove manual payment in the whole codes even if in server or what
remove them all bro, please see its not a mist that quick amounts will be
always big, cards, please change positions and designs please, in
withdrawal page still when tapped the nav icons still remain why? Remove
them please, it's not a must that withdrawal page will be looking like
that... also bro l need the other start up loader to be in navigation of
loading so it will be smaller even."* Four separate asks, all done this
round:

**1. The PAY-A/PAY-B choice and manual (admin-number, SMS-matched) deposit
collection are gone — client, server, and admin, not disabled.** This is a
real reversal of the earlier "What stayed, deliberately" note under
"Removed from Petro" above, which had kept manual deposits as the owner's
own established replacement for the SMS-forwarder app. That flow is now
named directly for removal too, so it came out completely rather than
staying behind a flag:
- **`server.js`**: `depositPayAEnabled`/`depositPayBEnabled` and the two
  manual-pay reminder fields dropped from `DEFAULT_SETTINGS`;
  `getSettings()`'s ~14-line legacy PAY-A/PAY-B migration block removed;
  `payAAvailable()` simplified to just a region-serviceability check (no
  more enable/disable toggle); `/public/settings`'s `depositPayAEnabled`
  field renamed to `depositAvailable`. The entire `// ═══ MANUAL DEPOSITS
  ═══` section (698 lines) is gone: `trackManual`, `parseMoMoSms`/
  `parseSentMoMoSms`, `/deposit/manual/init`, `/deposit/manual/status`,
  `/deposit/manual/paste-sms`, `manualNumberHealth`, every
  `/admin/manual-numbers/*` and `/admin/deposit/manual/reject` route, the
  manual-pay-image slots and their two `/admin/manual-pay-image/*` routes,
  `MANUAL_DEPOSIT_WINDOW_MS`, `recordManualNumberEvent`. **Caught before
  shipping**: `/deposit/marzpay`'s own gate,
  `if (!sett.depositPayAEnabled) return res.status(400)...`, would have
  permanently blocked every deposit once that field was deleted — removed
  along with the field, not left behind pointing at nothing.
- **`db.js`**: the manual-numbers/SMS-log Mongo index definitions removed
  (~24 lines).
- **`user-src/original_module.js`**: `openDepositSheet()`/
  `openDepositFormSheet()` rewritten — no PAY-A/PAY-B radio rows, straight
  to amount → phone → confirm, one screen, no method choice to make. The
  entire manual-pay overlay block (571 lines —
  `openManualPayFlow`/`manualPayChooseMethod`/`presentManualPayCodeScreen`/
  `submitManualPasteSms`/etc.) is deleted, along with
  `pickDepositPayMethod`/`submitDepositChoice` (validation folded into the
  existing `submitDeposit()`, itself unchanged).
- **`user-src/index.html`**: `.pay-row`/`.pay-radio` CSS and the entire
  `#manualPayFlow`-scoped block (292 lines of `.mp-*` rules) removed —
  carefully, since `.mp-*` is *also* the unrelated "My Products" list's own
  prefix (kept, untouched) — plus the `#manualPayBg` markup itself.
- **`admin-src/index.html`**: the Settings "Manual payments" section (PAY-A/
  PAY-B checkboxes, payment-number round-robin editor, payment-reminder
  panel) replaced by a plain "Payments" card — one deposit-gateway radio
  pair, the withdrawal-method radios (4th option, "Always manual", kept —
  see below). `renderManualNumbersEditor()`, `NETWORK_OPTIONS`, the whole
  "── PAYMENT-NUMBER ACTIVITY ──" analytics block (126 lines), the deposits
  tab's manual-reject button and `data-smsresolve` handler, the Banners
  tab's "Manual payment screen images" upload row and `uploadManualPayLogo()`
  + its 4 handlers, and the dead logo-cutout canvas utilities
  (`removeDarkBackdrop`/`trimTransparentEdges`/`fileToLogoPng`, used only by
  that upload) are all gone. **10 now-orphaned i18n translation-table rows**
  (their English source text described PAY-A/PAY-B or the manual-deposit
  flow, verified by grep that none of that exact text is used anywhere in
  the rebuilt file any more) were deleted outright, not re-translated —
  same convention this file has followed every other time a translated
  string's English source stopped existing.
- **Three dangling-reference crash bugs caught before shipping**, each
  found by grepping every use of an identifier before its definition/markup
  came out, not after: `setInterval(reconcileManualDeposits, 60*1000)` in
  `server.js` (would have crashed the whole process on boot — the function
  no longer existed); the phone back-button's `popstate` handler in
  `original_module.js` calling the now-deleted `manualPayOverlayOpen()`
  (would have thrown on every single Android back-button press); and
  admin-src's `$('mpSelectorImgFile').addEventListener('change', ...)` with
  no null-check (would have thrown and broken every settings/banner handler
  registered after it the moment its markup came out) — the same failure
  shape this file's own history has now caught five separate times.
- **Deliberately kept, confirmed still legitimate, not touched**: the
  withdrawal side's own "Always manual" payout mode
  (`withdrawMethod:'manual'`, `payoutIsManual()`, `_witManualPayouts`, "Mark
  as paid" on the Withdrawals tab) — a real, separate safety fallback where
  an admin sends payouts by hand and marks them paid, nothing to do with
  collecting deposits. Also kept: `needsManualCredit` (an unrelated
  money-safety error-recovery flag), `manual_credit`/`manual_debit` (the
  unrelated admin wallet-adjustment feature), and the passive
  `d.method==='manual'` display labels + `manual_sms_log_resolved`/
  `manual_pay_image_set` audit-log label-map entries that only ever format
  **historical** deposit rows already sitting in the database — harmless,
  since nothing can create a new one of these rows any more.

**2. Deposit's quick-amount chips redesigned** — owner: *"its not a must
that quick amounts will always be big, cards, please change positions and
designs."* The old 3-column grid of tall (17px padding), heavily
green-shadowed chips read as a wall of big cards. Rebuilt as a flat,
wrapping row of small pill chips (9px padding, 13px text, no card shadow)
— `.dep-chips` went from a fixed 3-column `grid` to `flex-wrap`, so each
chip is only as wide as its own number and up to 4-5 fit per row depending
on digit count, rather than every chip stretching to fill a column. Same
underlying price list, same `pickDepositAmount()`/`syncDepositQuickAmt()`
wiring — only the chip's own look and layout changed.

**3. Bottom nav now hides behind every `openSheet()` sub-page** (Deposit,
Withdraw, About, Balance Record, Messages, My Team, Gift Codes, Security
Settings, ...) — owner: *"in withdrawal page still when tapped the nav
icons still remain why? Remove them please, it's not a must that
withdrawal page will be looking like that."* Rather than the larger
sheet-vs-real-page architecture rewrite this file has flagged (and
deferred) twice before, this is the small, low-risk fix that actually
answers what was asked: `openSheet()` now adds `sheet-open` to
`document.body`, and `closeSheet()` plus the phone-back `popstate` handler
both remove it — the one flag reaches every sheet at once, the same
"swap one token" leverage the `.sheet-head` retheme used. CSS:
`body.sheet-open .bottom-nav{display:none}`, and `.sheet-bg` extends to
`bottom:0` while that class is set, so the sheet fills the space the nav
used to occupy instead of leaving a dead gap behind it. The larger "make
Deposit/Withdraw real `STATE.page` navigations instead of sheets"
question from two rounds ago is still open and still not what was asked
for this time — this fix directly answers "the nav icons still remain",
without touching the sheet/page architecture at all.

**4. A shared small loading mark, reused instead of inventing a third
spinner design** — owner: *"l need the other start up loader to be in
navigation of loading so it will be smaller even."* Read as: reuse the
boot screen's own three-ring SVG mark (red-to-violet gradient, pulsing
arc, see `#loadingScreen` above) — small — for in-app loading states,
rather than the separate `.ring-spin` plain-CSS ring that Network's
team/referral list-loading state (`teamLoadingHtml()`) had been using
since an earlier round. `.ring-spin`/`@keyframes ringSpin` removed
outright (its only caller was this one function, now switched over) — new
`MINI_RING_LOADER` (a 34px version of the same `.ring-arc`/`ringSweep`
markup) is a plain JS string constant so any future loading state can
reuse it without duplicating the SVG. **A real render bug found and fixed
while building this, not before shipping it blind**: pointing the mini
mark's `<circle>` strokes at the boot screen's existing `#ringGrad`
gradient def seemed like the more obviously "shared" approach, but
rendering it standalone in headless Chromium showed the ring paint with NO
stroke at all — a paint-server def does not reliably resolve for an
element outside it once its own ancestor (`#loadingScreen`) is
`display:none`, which is exactly the boot screen's normal resting state
after the app has loaded. Fixed by giving the mini mark its own
self-contained `#miniRingGrad` def (identical stops) instead of pointing
at the boot screen's — confirmed by re-rendering after the fix that the
ring now paints with its full red-to-violet gradient.

**Verified**: `node -c` on every touched file, `node build-core.js` +
`node build-admin.js` (both round-trip OK). A full grep sweep for every
manual-deposit/PAY-A/PAY-B identifier across `server.js`, `db.js`,
`user-src/`, and `admin-src/` turned up zero dangling references after the
three bugs above were fixed. Rendered the actual built `user/index.html`
standalone in headless Chromium (Playwright, the same rig this file's
other rounds have used) with STATE force-populated offline: opened
Deposit (screenshot confirms the new pill chips, no payment-method
section, bottom nav gone), opened Withdraw (bottom nav confirmed gone via
`getComputedStyle`), and rendered `teamLoadingHtml()`'s output directly
(confirmed the `.mini-ring-loader` paints with its gradient). Zero page
errors in any of it. `user/sw.js` bumped v129→v130, `admin/sw.js` bumped
v36→v37.

**Not run this round**: the legacy Python/Playwright test suite
(`test-nav-sheets.py`, `test-visible-text.py`, etc.) — its own fixture
data still references `depositPayAEnabled`/`depositPayBEnabled`, which is
exactly the kind of file this document's own "work through the inherited
test suite file by file" item (see Status below) already calls out as
undone, not a new gap introduced here.


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
3. ~~Decide the actual oil/gas visual identity~~ — done 2026-09-22. Petro's
   fixed system is Corporate Red #E30613 / Clean White / Golden Orange
   #F5A000–#FFB000 / Charcoal #25262B with Inter and restrained industrial
   motion. See the fresh-rebuild section immediately above; do not re-import
   Chipz visuals or interaction choreography.
4. Decide the product catalog: real names, prices, cycle lengths.
5. Decide which countries/currencies/languages/payment gateways actually apply
   to Petro — do not assume Uganda/UGX/MarzPay just because the code defaults
   to it.
6. Work through the inherited test suite file by file, per the warning above.

**Merge note (2026-09-22):** two separate sessions pushed to this branch
concurrently — this session's `.sheet-head`/`.home-topbar-v2` red-header
removal + Android compositing-layer fix, and a second session's (Codex)
much larger fresh-redesign pass (raster artwork removed, wallet card
redesigned as an "industrial status panel", admin visual refresh, test
suite updates — see the fresh-rebuild section above for the full account).
Merged via `git merge`, not a force-push — both sides' work is intact.
The one real overlap (both sessions independently redesigned the wallet
card in the same round, for the same owner complaint) was resolved in
favor of Codex's version — a more complete redesign (status badge, meta
grid, real icon) than this session's plain 3-row placeholder. Rebuilt and
verified (`node -c`, both `build-core.js`/`build-admin.js` round-trip OK)
after resolving. If two sessions end up working this branch at once again,
`git fetch` + read the incoming log before pushing, the way this merge
did — not `git push --force`.

**CORRECTION to the round above: the "Android compositing bug" diagnosis
for the Deposit/Withdraw bleed-through was wrong.** The owner reported the
exact same bleed-through again after that round shipped, hard enough
("you failed to remove that... l am opening deposit, it triggers the
other old code") that this time it was actually reproduced locally
instead of guessed at a third time — got Playwright running against the
pre-installed Chromium (`/opt/pw-browsers/chromium`, `npm install
playwright-core` in the scratch dir), and the bug reproduced identically
on a plain desktop headless browser. That alone disproves "Android-only
compositing quirk" — it was never mobile-specific.

**Real root cause, found by inspecting computed styles**:
`getComputedStyle(sheetBg).backgroundColor` was `rgba(0,0,0,0)` --
fully transparent -- despite `.sheet-bg{background:var(--snow-canvas)}`
being the only matching rule (confirmed via `document.styleSheets`, no
override). `getComputedStyle(document.documentElement).getPropertyValue
('--snow-canvas')` came back **empty on `:root` itself** -- every color
custom property in the entire app was failing to resolve, not just this
one background. Traced with a brace/comment-balance script
(`/* ` vs `*/` counts) and found the actual bug: inside the `:root{}`
token block's own explanatory comment (written during the fresh-redesign
round), one sentence read `Variable NAMES are kept (--snow-*/--chipz-*)`
-- which contains the literal two characters `*/`, the CSS comment
CLOSE token, sitting inside the comment's own prose. That closes the
comment early; everything after it in the same sentence becomes raw,
invalid CSS the parser can't recover into declarations from, and the
browser drops the entire `:root{}` rule as a result -- so literally
every `--snow-*`/`--chipz-*` token app-wide silently resolved to nothing
for this whole round, which is why the `.sheet-head`/`.home-topbar-v2`
red-removal fix from earlier in this same file still displayed correctly
(those use literal fallback-free `var()` too, but happened to read as
"blank" in a way that coincidentally looked like "removed the red" rather
than obviously broken) while `.sheet-bg`'s "opaque" background silently
became fully transparent, letting Home show through underneath Deposit/
Withdraw exactly as screenshotted. The GPU-compositing-layer fix from the
round before this one was real CSS, harmless, but was never actually the
cause -- left in place since promoting scrollable overlays to their own
layer is still a reasonable performance/paint hint on its own merits, not
reverted.

**Fix**: one space, `--snow-* / --chipz-*` instead of `--snow-*/--chipz-*`,
in that single comment. Verified properly this time, not just asserted:
re-ran the same Playwright reproduction after the fix -- `--snow-canvas`
now resolves to `#f7f7f8` on `:root`, `#sheetBg`'s computed background is
opaque, and the Deposit sheet screenshot shows zero bleed-through. Also
swept the entire stylesheet (both `user-src/index.html` and
`admin-src/index.html`) with the same brace/comment-balance script for
any OTHER stray `*/` of this same shape -- none found, this was the only
one. **Lesson for next time this class of bug is suspected**: don't
re-guess from a screenshot a third time -- `getComputedStyle()` +
`document.styleSheets` inspection via a real (even headless, even
desktop) browser finds the actual cause in minutes; CSS custom-property
cascade bugs are invisible from reading source text alone once a stray
comment-closer is involved, since the source LOOKS correct at every
individual rule -- the damage is a side effect several hundred lines
away. Playwright is not preinstalled in a fresh sandbox -- `npm install
playwright-core --no-save` against the already-present
`/opt/pw-browsers/chromium` binary gets a working headless browser in
seconds without a full Playwright reinstall.

**Immediately after that fix confirmed working, a large new instruction
list** (owner, verbatim, since it's long and specific): *"it's not a
mistake to put wallet card, a number only can get saved as bank
account, remove notification bell and support svgs in top right
everywhere, also let the navigation bar remain on parent pages, ie when
l tap deposit, it should be fresh page... the background banner on
authentication will appear even in the pages everywhere in the website
as background such that the card matches like that on authentication
screens, please take a look on loaders in network, same 4 triangles
still doing, why they should be removed, remove also those logo of
petrol everywhere and those words of energy for better tomorrow should
be removed completely."*

**Done this round** (the bounded, mechanical parts):
- **Notification bell removed from every top bar** (`.home-topbar-v2`,
  reused by Home x2 render paths, Network, and Account) — Account keeps
  its Settings gear (not named for removal, a distinct icon from "bell"/
  "support"). Since this was the ONLY way to reach `openMessagesSheet()`
  from anywhere, and the owner only asked to remove the icon, not the
  feature, added a **new "Messages" row to Account's row list**
  (`acctRowHtml(ICONS.bell, ..., 'Messages', ...)`) — same pattern
  Customer Support already used to stay reachable after ITS own top-bar
  icon was never there in the first place on some screens. `Support`
  icon removed from Home's top bar too (was only ever there, not on the
  other screens) — Customer Support was already reachable via Account's
  own row, so nothing new needed there.
- **`updateMessageBadge()` neutered to a deliberate no-op**, not left
  broken: it used to find "the first `.htb-icon-btn` on the page" and
  paint an unread dot onto it — with the bell gone everywhere, that
  selector would have matched Account's Settings gear instead and
  wrongly painted a message-unread dot onto a Settings icon. Same
  no-op-not-deleted precedent as `maybeShowAnnouncement()` elsewhere in
  this file, so none of its 5+ call sites needed individual guards.
- **Petro logo mark (`.htb-logo`) and the "Energy for a Better Tomorrow"
  tagline (`.htb-title`) removed from all 5 top-bar occurrences**, and
  from the Home banner's own fallback caption (`hb-cap`, shown when no
  banner image/video is uploaded — now just the diagonal-stripe
  placeholder, no text). `.htb-sub` (the smaller "Reliable · Sustainable
  · Together" / "Your Account · Our Priority" line) was NOT named for
  removal, left in place.
- **Network's team/referral-list loading spinner swapped off PLAN_SPIN**
  (the "4 triangle chips orbiting" mark) — this one was flagged by name,
  repeatedly, this round. `teamLoadingHtml()` now renders a plain CSS
  ring spinner (`.ring-spin`, a single rotating border) instead. PLAN_SPIN
  itself is UNTOUCHED everywhere else it's used (ongoing-plan progress
  rows, the payment-poll page) — those weren't named, and per this file's
  own earlier note, that spinner was itself a real, explicit owner request
  in an earlier round ("I wanted the other which has 4 triangle chips
  rotating"), not Chipz residue — reversing it everywhere without being
  asked would be guessing at a second reversal on top of the first.
- **Verified**: `node -c`, `build-core.js` round-trip OK. Rendered Home,
  Account, and Network standalone in headless Chromium after the change
  (same Playwright rig from the fix above) — zero JS errors on any of the
  three, logo/tagline/bell/support confirmed gone from the screenshots,
  Settings gear still present and correctly alone on Account's bar.

**Not done this round, flagged rather than rushed** (both large,
genuinely architectural, and risky to guess at right after today's
one-character outage):
- **"Background banner on authentication should appear everywhere as
  the page background, cards matching the auth-screen look, we no
  longer use white"** — this is a full reversal of the established split
  in "Design system: Premium Industrial Energy" above (dark photo
  backdrop for auth vs. white dashboard elsewhere was itself an explicit
  earlier owner decision, quoted there). A real, large redesign: every
  page's canvas background, every card's contrast treatment against a
  photo backdrop instead of a flat color, readability of red/gold text
  over a photo in dozens of screens — not a token swap this time, since
  cards over a photo need actual glass/blur treatment to stay legible,
  which the current card components don't have. Needs to be built
  deliberately, screen by screen, and verified visually (the same
  Playwright rig now available) before shipping, not guessed at in the
  same pass as everything else.
- **"Deposit/Withdraw should be a fresh page, not override the parent"**
  — currently both open via `openSheet()`/`.sheet-bg` (a full-screen
  overlay stacked on top of whatever page is open underneath, same
  mechanism as About/Balance Record/Messages/etc.). The bottom nav
  already stays visible during this (`.sheet-bg{bottom:var(--nav-h)}`),
  so the literal complaint from earlier rounds (Home content bleeding
  through) is now fixed — but the owner's ask here reads as wanting
  Deposit/Withdraw to be genuine `STATE.page` navigations (like Assets/
  Network/Account) rather than sheets, which is a real architecture
  change: `openSheet()`'s single shared `#sheetBody`/history-stack
  model vs. `showPage()`'s per-page render functions are two different
  systems in this file, and Deposit/Withdraw's own forms (amount/method/
  phone) would need to become real page-render functions. Money-adjacent
  code (the same file's own "money-safety invariants" section applies to
  the surrounding flow, if not the exact credit logic) — needs its own
  careful pass and verification, not a rushed change appended to an
  already-large round.
- **"A number only can get saved as bank account"** — read as the owner
  accepting/justifying the wallet card feature (walking back an earlier
  "not a must to put the card of wallet" from 2 rounds ago), not a
  request to simplify the bind-wallet form's fields (provider + number +
  holder name, unchanged). If that reading is wrong, say so directly
  next round rather than this file guessing further.

## 2026-09-22 — Deposit / Withdraw visual reframing

Owner supplied live screenshots of both transaction screens and asked for a
different, cleaner approach based on current mobile-finance patterns, with an
important constraint: **do not add new elements**. The specific direction was
to remove the stacked-card feel from both pages, while keeping the payout
wallet itself as the one intentional hero card on Withdraw; the saved mobile
money number should be the hero value inside that card.

Implemented without changing any deposit/withdraw business logic:
- **Deposit** is now a flat, amount-first form. The amount field sits before
  the product-price shortcuts; the shortcuts are lightweight text/underline
  controls rather than pill cards; Payment Phone uses a flat underline field;
  Deposit Instructions are no longer boxed in their own card.
- **Withdraw** now leads with the existing payout wallet as the single hero
  card. The wallet hero uses Charcoal with the established red→gold Petro
  accent and makes the saved phone number the dominant value. The
  Bind/Change Wallet action is a lightweight text action below it.
- The old gradient **Available Balance** card is removed: balance is now plain
  page-level information, followed by a flat amount input. Fee and withdrawal
  instructions are also unboxed/page-level.
- No transaction fields, settings, routes, validation, payout behavior,
  gateway logic, or money-safety code changed. This was markup ordering +
  CSS only.
- `user/sw.js` bumped `petro-shell-v130` → `petro-shell-v131`.
- `node build-core.js` ran in a clean GitHub Actions environment and completed
  successfully, including its source syntax check and `round-trip : OK`; the
  generated `petro/user/index.html` was committed from that build. The
  temporary build workflow was removed before merge.
- Work was done from a temporary branch based on current
  `claude/petro-platform-build`, then merged with a normal merge (PR #4),
  not force-pushed.

Still unchanged/open from the prior note: Deposit and Withdraw are still
implemented through `openSheet()`; this round reframed the pages visually
only and did **not** convert them into new `STATE.page` routes.

## 2026-09-22 — Assets / Network / Wallet cleanup; Android wallet-input delay

Owner sent live screenshots showing three remaining user-panel problems: the Assets
tab, the Network tab, and a wallet-linking input that lagged badly on Android.

Changes made this round (topic sentences only — see "CLAUDE.md corruption incident,
2026-09-27" below for why the fuller detail this section originally had is gone):
- **My Assets is now a Petro-native renderer**, not `myProductsInnerHtml()`.
- Assets no longer carries the extra top slogan/header band.
- **Network was reduced to essentials**: invitation code, invitation link, Level
  structure.
- The `Reliable · Sustainable · Together` strip was removed from Home/Assets/Network.
- **Wallet linked state now renders only the local mobile-money number** (not a full
  synthetic account string).
- Delete uses the existing `/bank/delete` endpoint and refreshes `STATE.bankAccounts`.
- **Keyboard/input-delay root cause found in the page lifecycle**, tied to a cached
  empty state on this screen.
- Also removed a stale `transform:translateZ(0); will-change:transform` that was
  part of the input-lag fix.
- The inherited orange/yellow scrollbar thumb was changed to Petro Corporate Red.
- Network/Assets cold-load states now use the existing small Petro ring loader
  (verified still present: `MINI_RING_LOADER`/`.ring-spin`-successor usage in
  `original_module.js`).
- `user/sw.js` bumped `petro-shell-v131` → `petro-shell-v132`.

## 2026-09-22 — Chipz residue removal pass

Owner explicitly asked to remove the remaining Chipz functions/visuals so Petro
carries none of the fork's dead weight forward.

Completed after tracing callers before deletion (topic sentences only, same
corruption caveat as the section above):
- Removed retired standalone **Products / Catalog / Referral / Team** member pages.
- Removed the dead **My Products** renderer and its large legacy CSS block.
- Removed dead Home product-tab code and the removed simulated activity ticker
  client.
- Removed old Team summary-card styles while preserving the lower-level
  member-list.
- Removed the unused simulated `/public/activity-feed` backend, its cache/builder.
- Renamed active fork-era identifiers throughout member source, admin source,
  backend.
- Renamed the old `chipz_test_api.py` file to `petro_test_api.py` (verified
  current: `petro_test_api.py` exists, `chipz_test_api.py` does not).
- Renamed the generic image API to `/public/petro-images`, `/admin/petro-images`
  (verified current: both routes exist in `server.js`, backed by
  `getPetroImage()`).
- Existing uploaded images are not discarded: `getPetroImage()` performs a
  one-time migration read.
- Removed obsolete Referral-banner and Home-spin-banner image slots/translations.
- Preserved inherited implementation only where it is still **active Petro
  behavior**.
- `user/sw.js` bumped `petro-shell-v132` → `petro-shell-v133`.

## 2026-09-22 — Account cleanup + Transaction Statement

Owner marked Account rows for removal and asked for the separate Deposit /
Withdrawal / Earnings record entries to become one professional transaction
statement rather than more decorative cards.

Implemented:
- Removed Account rows: **My Assets**, **Deposit Records**, **Withdrawal Records**,
  **Earnings Records**, **My Team**, and **Messages**.
- Added one Account row: **Transaction Statement**.
- Transaction Statement replaces the old Balance Record presentation. It has
  exactly three horizontal categories at the top: **Income | Deposits | Withdrawals**.
  The control is a restrained underline tab row, not cards/pills.
- Statement rows are flat ledger rows separated by hairlines. Each row shows a
  stable public transaction reference, date/time, concise description, amount,
  and status. The old balance hero, avatar discs, record cards and status pills
  are gone from this screen.
- Income includes current earning-credit types (cashback, referral commission,
  team reward, gift code, check-in, welcome bonus, historical mission rewards,
  turntable/spin rewards, and owner/admin credits). Deposits and withdrawals
  remain their own categories.
- New transaction rows receive a **server-generated `B2...` statement ID** in
  the shape `B2 + YYMMDDHHMMSS + 4 digits` (example style:
  `B2609220514561788`). The suffix is generated server-side with crypto randomness.
- Historical rows that predate `statementId` receive a stable server-derived B2
  reference based on their immutable transaction document ID plus stored
  timestamp/date fields; the reference does not change on reload.
- `/transactions` returns the member-facing `statementId` for every row.
- Existing `openBalanceRecordSheet()` is kept only as a compatibility wrapper so
  older post-deposit/post-withdraw call sites land in Transaction Statement
  instead of reopening the retired screen.
- Live refresh recognizes `Transaction Statement` and repaints its current
  category when new ledger rows arrive.
- `user/sw.js` bumped `petro-shell-v133` -> `petro-shell-v134`.
- Verification in a clean GitHub Actions environment passed: `node --check
  server.js`, member source syntax OK, obfuscated syntax OK, and `round-trip : OK`.
  Generated `petro/user/index.html` was committed; temporary workflow removed.

## 2026-09-27 — Retire multi-country and LipaPay surfaces for Uganda-only Petro

A real, large removal (`server.js` ~10087 lines touched, `admin-src/index.html`
~4094 lines touched) — the multi-country/region abstraction layer and the
remaining LipaPay-adjacent surfaces (LipaPay itself was already removed
earlier, per "Removed from Petro" above; this was residue: dead branches,
comments, admin fields referencing it) are gone, and the app/admin now assume
Uganda-only rather than carrying the region machinery CLAUDE.md previously
flagged as still-open ("do not assume Uganda/UGX/MarzPay just because the code
defaults to it" — the owner has since made that call explicitly). `admin/sw.js`
bumped. **This session did not author this change and has not independently
re-verified every corner of it** — `node -c server.js` and a full
`build-admin.js` round-trip both pass clean post-merge, which confirms the
result is syntactically sound and builds, not that every region-dependent code
path was audited line by line. Worth a closer look before assuming the
multi-country data model (`ADMIN_REGIONS`/`currentRegion()`/`phoneToEmail()`)
that earlier rounds deliberately left dormant-but-intact is still behaving the
same way now that so much around it moved.

## CLAUDE.md corruption incident, 2026-09-27 — real data loss, found and repaired

The owner asked for an audit of Codex's recent work ("good critical changes,
but design and accuracy is low") — while updating this file for an unrelated
round, this file itself turned out to be the accuracy problem. Two distinct,
sequential failures in whatever process was writing to this file, both in
commits with plain "Document ..." messages (pure-documentation commits, no
code changes):

1. **`0a39792` and `e6af39a`** each inserted real new section headers and
   topic-sentence bullets, but every WRAPPED CONTINUATION line of those bullets
   was replaced with the literal text `NaN` — 33 occurrences, then 58 — instead
   of the actual words. Mechanical signature of a text-wrapping step that
   computed `NaN` (an arithmetic bug, not a content bug) and stringified it
   instead of failing loudly.
2. **`9a94abb`** (the large Uganda-only/LipaPay-residue commit above)
   overwrote the ENTIRE file — including `e1758b6`'s own fully-intact addition
   — with 90KB of unrecognizable binary data (confirmed not gzip/zlib/any
   known compressed format; `file` reports plain "data"). Total loss of
   everything written to this file since the last clean commit, not a partial
   corruption.

**Found by**: `wc -l`/`file` on this document itself reading as binary "data"
instead of text, while preparing to add this round's own entry — not
something a build or test would ever catch, since CLAUDE.md is never executed
or parsed by the app.

**Fixed by**: `git log --oneline --follow -- CLAUDE.md` plus a per-commit `NaN`
count to find exactly where the corruption started (`0a39792`, right after the
last clean commit `d5b5eee`) and how it progressed. Restored this file from
`d5b5eee` (the last commit with zero `NaN` occurrences and valid UTF-8 text).
The one fully-intact addition since then (`e1758b6`'s "Account cleanup +
Transaction Statement" section) was re-appended verbatim, confirmed clean by
diff. The two partially-corrupted sections (Assets/Network/wallet-input,
Chipz residue removal) are reconstructed above from their surviving topic
sentences plus independent verification of the concrete, checkable claims in
them (`petro_test_api.py`, `/public/petro-images`, `getPetroImage()`, the
`user/sw.js` version numbers) — their original fuller prose is genuinely lost,
not recoverable from this repo, and is presented here honestly as a
reconstruction rather than passed off as the original text.

**Lesson, stated plainly for whatever writes to this file next**: verify this
document is valid UTF-8 text (or at minimum non-empty readable prose) as the
very last step before committing a change to it, the same discipline this
file's own CSS-corruption incident (see the `:root{}`/`*/` story above)
already established for source files — a file that is never parsed or
executed by the app (CLAUDE.md, same as a `.md` comment) can sit silently
corrupted for multiple commits with nothing anywhere flagging it, because
nothing ever reads it except a future session's own eyes.

## 2026-09-28 — Deposit poll/redirect screens matched to the photo-backdrop redesign; loader recoloured off blue; three real i18n gaps closed

Owner, three things in one message: *"the deposit poll screen is very ugly, it
is showing a background white and the page is very not matching with current
page. Also the loader or startup loader of startup should be having red, and
Yellow-orange colour"* — plus a question about how the language system works,
suggesting it "should stimulate Google language because language only changes
small things."

- **`.pay-page`/`.dep-redirect` (the deposit-status poll screen and its brief
  "Redirecting to payment…" handoff) never picked up the refinery-wallpaper +
  dark-glass treatment `.sheet-bg`/`.sheet-head`/`.sheet-body` got everywhere
  else in an earlier round (see "fresh Petro visual rebuild" history above —
  this was the deferred "background banner everywhere" redesign, which
  Codex has since actually built). Their header looked right, because it
  reuses `.sheet-head` verbatim; the plain-white body underneath it is what
  read as broken. Given the same `::before` wallpaper `.sheet-bg` uses and the
  same glass-panel numbers `.sheet-body` uses (`rgba(20,12,8,.46)` background,
  `rgba(255,255,255,.14)` border, `blur(9px)`, white/`rgba(255,255,255,.62)`
  text) — matched to the existing pattern, not a new one.
- **Boot-loader gradient recoloured off blue.** The reference GIF this loader
  was built from (see "Loading screen rebuilt from scratch" above) had a
  blue/violet top stop, kept for fidelity to that reference through several
  rounds — but blue was never part of this app's actual palette (the one blue
  token, `--chipz-link`, was removed outright early in the design-system
  work), and the owner named the mismatch directly. Top stop changed from
  `#6b4cff` to `#ffb000` (Golden Orange, the same token the rest of the app
  uses) in both the boot screen's own `#ringGrad` and the small reused
  `#miniRingGrad` (`MINI_RING_LOADER`, the mini version built for in-app
  navigation loading a few rounds ago) — one color decision, two SVG defs,
  since the mini mark carries its own gradient rather than pointing at the
  boot screen's (see that round's own comment for why: a paint-server def
  does not resolve reliably from outside a `display:none` ancestor).
- **Found and fixed in the same CSS block**: its own comment had "petro"
  where the owner's actual quoted words said "chipz" — a leftover from some
  earlier global rename pass that went inside a quoted owner message, not
  just identifiers. Restored to what was actually said, same as this file's
  own standing rule against rewriting real quotes into invented narrative.
- **The language question, answered with real evidence, not a guess**: this
  app does NOT use Google Translate or any live translation API. It's a
  hand-curated table (`LANG_ROWS`/`LANG_PATTERNS` in `original_module.js`),
  keyed on the exact English sentence, with a DOM sweep (`translateTree()`)
  that finds matching text nodes/blocks already rendered and swaps them —
  deliberately, not an oversight: this file's own header comment on that
  table states the reasoning directly ("a wrong word on a money screen is
  worse than an English one... where the right word was not certain the
  cell is left empty rather than filled with a guess"). Switching to a live
  MT API would translate everything, including sentences nobody has
  reviewed for a money app, which is exactly the risk this design avoids.
  **"Only changes small things" had a real, verifiable cause, not just a
  design limitation**: the deposit-status screen (the one in the owner's own
  complaint) had 3 of its 4 status titles, and its step-1 sentence (the one
  carrying the actual amount and phone number), missing from the table
  entirely — confirmed by grep, not assumed — meaning that screen fell back
  to 100% English under every non-English language regardless of anything
  else being translated. Added: `'Payment confirmed'`, `'Payment not
  completed'`, `'Still waiting for the provider'`, and the pattern `'A
  payment request for {0} has been sent to {1}.'` — French and Swahili
  filled with real translations built from vocabulary already vetted
  elsewhere in this exact table (the `'Confirm'`/`'Failed'`/`'Not confirmed
  yet.'` families); Luganda/Kinyarwanda/Runyankole filled only where a
  direct, confident extension of already-existing rows was possible (2 of
  the 4 rows), left blank on the other 2 rather than guessed, matching this
  table's own stated policy — same discipline as the rest of the table, not
  an exception made for this round. Verified live: switched `LANG` to each
  of `fr`/`sw`/`lg` in a real headless-Chromium render of the built bundle,
  confirmed the title and both steps translate correctly for French/Swahili,
  and Luganda correctly shows its own two now-translated rows while falling
  back to English only on the one row deliberately left blank — the
  fallback working as designed, not a bug.
- **Also found and fixed while working in this exact file**: see "CLAUDE.md
  corruption incident, 2026-09-27" above — a real, separate, more serious
  accuracy problem than any of the above, found by accident while trying to
  add this very entry.
- **Verified**: `node -c user-src/original_module.js`, `node build-core.js`
  (round-trip OK). Rendered the built bundle in headless Chromium: the boot
  loader screenshot confirms red-to-gold with no blue, the deposit-status
  screen (forced open with the pending-state steps) confirms the dark glass
  card/wallpaper treatment with legible white/muted text, zero page errors.
  `user/sw.js` bumped `petro-shell-v174` → `petro-shell-v175`.

## 2026-09-28 (follow-up) — Language switcher removed entirely, per owner's own choice

Immediately after the round above, owner: *"language changing should
stimulate google language translator, or else remove it."* Given a clean
three-way choice (real Google Cloud Translation API — cost + new dependency;
Google's free page-translate widget — no cost but known-unreliable and risky
on a money app; or remove the switcher), the owner chose removal.

- **The `.lang-btn` pill** (top-right on the auth hero, the entry point to
  `openLangPicker()`) is deleted from `user-src/index.html`'s markup, along
  with its CSS (`.lang-btn`, `.lang-btn:active`, `.auth-screen-v2 .lang-btn`)
  — no element carries that class any more, so nothing was left half-alive.
- **Deliberately NOT a deep rip-out**: `LANG_ROWS`/`LANG_PATTERNS`/
  `translateTree()`/`t()`/`setLang()`/`openLangPicker()`/`closeLangPicker()`/
  `paintLangButton()`/`applyRegionLanguages()`/`resolveLang()` are all left
  exactly as they were, now simply unreachable — same "leave the machinery,
  remove the entry point" precedent this file already has for Turntable,
  subdomains, Trade Password, and others. `paintLangButton()`'s own
  `$('langBtn')`/`$('langRow')` lookups are already null-safe, so removing
  the markup does not crash it — confirmed live, not assumed (see
  Verified below). Kept dormant rather than deleted in case a real
  translation method (the Google Cloud API option, most likely) is chosen
  later — resurrecting a working, already-built table is a re-add of one
  button, not a rewrite.
- **`DEFAULT_REGION.languages` in `server.js` was already `['en']`-only**
  (see the Uganda-only retirement round above) — that already hid the old
  button via `paintLangButton()`'s own existing "hidden when only one
  language is allowed" rule, but only as long as that region config stays
  set that way. Removing the markup on top of that makes the switcher gone
  unconditionally, not dependent on a config value nobody is watching.
- **Why the owner's screenshot still showed a working "Luganda" picker
  right before this round**, despite `DEFAULT_REGION.languages` already
  being English-only in the code: almost certainly the same class of stale-
  deploy/stale-service-worker gap this project has hit more than once this
  week (see the git-divergence and CSS-corruption incidents above) — the
  live site had not caught up to the Uganda-only commit yet. Not
  re-investigated further this round since the fix (an unconditional markup
  removal) makes the question moot either way.
- **Verified**: `node -c user-src/original_module.js`, `node build-core.js`
  (round-trip OK). Rendered the built bundle in headless Chromium with the
  auth screen forced visible: confirmed `#langBtn`/`.lang-btn` do not exist
  anywhere in the DOM, `paintLangButton()` runs with zero errors against the
  now-missing elements, and the auth screen renders cleanly with no
  top-right button of any kind. `user/sw.js` bumped `petro-shell-v175` →
  `petro-shell-v176`.

## 2026-09-28 (follow-up 2) — Transaction Statement icon fixed, server-generated PDF statement download built

Owner, two asks in one message: fix the Transaction Statement row icon
("it is having a light box frames background, this you can see it clearly")
and build a real download-statement feature — *"put a server side advanced
feature called download statement, so it downloads statement of the account
as pdf very well organized statement with all data... check how the
statement looks you can check the branch of voltrapower, it was downloading
a good account statement so do it."*

**Icon fix, root cause found by decoding the actual bytes, not guessed from
the screenshot**: `SUPPLIED_MEMBER_ICON_ASSETS.accountStatement` was a
72x72 raster PNG with its alpha channel ~255 (fully opaque) across almost
the entire square — confirmed with a Python/Pillow histogram, not assumed.
This icon system renders through a CSS mask
(`.supplied-icon{background:currentColor;mask:var(--supplied-icon)...}`),
which reads ONLY alpha, never RGB — so a fully-opaque square becomes one
solid filled block regardless of what colors the pixels actually are,
exactly the "light box" the owner is describing. The two icons that *were*
already fixed this way (`CLEAN_ACCOUNT_ABOUT_ICON`/`CLEAN_NAV_CART_ICON`)
turned out to still be raster PNGs too, just properly background-removed
ones (mostly alpha=0) — meaning the established fix pattern for this file
is "process the raster," not "convert to SVG." `accountStatement` broke
that pattern instead: rather than re-processing a raster that was never
cut out to begin with, it's now a real inline outline SVG
(`ICONS.receiptLg`, same family/stroke-width as every other `*Lg` icon in
this file), with `suppliedMemberIcon()` special-cased to return it directly
rather than routing through the mask/`--supplied-icon` mechanism at all —
same "route around it" pattern `accountAbout`/`navAssets` already use for
their own special cases in that same function.

**Download Statement, server-side per the owner's explicit instruction**
(Voltra's own equivalent, read for reference — `voltra/original_module.js`'s
`downloadStatement()` — builds its PDF **client-side** with jsPDF from a
CDN; this one is deliberately different, generated entirely on the server):
- **New dependency**: `pdfkit` (`^0.20.2`, pure JS, no native/browser
  dependency) added to `package.json`/`package-lock.json`. Picked up
  automatically by the existing auto-deploy webhook's `npm install
  --omit=dev` step — no extra VPS action needed beyond the normal push.
- **`GET /statement/pdf`** (`server.js`) — authenticated via the same
  `verifyAuth()` every other member route uses. Settles any due cashback
  first (`settleAllForUser()`, same as `GET /account`) so the wallet
  balance and any freshly-due transaction are current. Queries the same
  `transactions` collection the in-app Transaction Statement screen reads
  (same 2000-row cap as `GET /transactions`), builds the PDF in memory with
  `pdfkit`, and streams it back with `Content-Type: application/pdf` +
  `Content-Disposition: attachment`. Category/status labels
  (`statementRowLabel()`/`statementRowStatus()`) are a **deliberate
  re-implementation** of the exact same logic the in-app screen's
  `statementDescription()`/`statementStatus()` already use — duplicated on
  purpose so a downloaded PDF and the in-app screen can never disagree
  about what a transaction is called, same "must match in two places"
  precedent `phoneToEmail()` already established in this file.
- **Layout**: Corporate Red header band with a Golden Orange accent stripe,
  account metadata (holder, account ID, wallet balance, total
  deposited/withdrawn, generation timestamp), a REFERENCE/DATE-TIME/
  DESCRIPTION/STATUS/AMOUNT table (statement IDs in the same `B2...` format
  the app itself shows, status color-coded exactly like the in-app screen —
  green/completed, gold/pending, red/failed), running totals (received,
  paid out, current balance), a brand tagline footer, and real multi-page
  pagination with the column headers repeating on every new page.
- **Real bug caught by actually rendering the output, not just reading the
  code**: the amount column's minus sign was written as the Unicode MINUS
  SIGN character (U+2212), which is not in PDFKit's standard Helvetica
  font's WinAnsi glyph table — it rendered as a stray `"` instead of a
  minus, confirmed by generating a real PDF with mock data (45 transactions,
  multiple types/statuses, enough rows to force a page break) and rendering
  it to PNG with PyMuPDF for visual inspection, not trusted from the
  drawing code alone. Fixed by using a plain ASCII hyphen instead, which
  WinAnsi does support; re-rendered and confirmed both the minus sign and
  the footer's em-dash (U+2014, which WinAnsi *does* support) render
  correctly.
- **Client side** (`user-src/original_module.js`/`index.html`): a red pill
  "Download Statement" button (`ICONS.download`, top-right of the sheet,
  above the Income/Deposits/Withdrawals tabs). `downloadStatementPdf()`
  deliberately does NOT go through this file's own `api()`/`post()`
  helpers — `api()` always calls `resp.json()` on the response (see its own
  comment on why every other endpoint here answers JSON), which would throw
  on a real binary PDF body. A raw `fetch()` attaches the same Bearer token
  `api()` gets internally (`window.fbAuth.currentUser.getIdToken()`), reads
  the response as a `blob()`, and triggers the browser's native save via a
  temporary anchor with a `download` attribute — the object URL is revoked
  30 seconds later rather than immediately, since some Android WebViews
  hand the file off to the OS asynchronously after `.click()`.
- **Verified**: `node -c` on both touched files, `node build-core.js`
  (round-trip OK). The PDF generation itself was verified by literally
  running it (a standalone copy of the exact drawing code, since this
  sandbox has no live Mongo/Firebase to hit the real route through) against
  45 mock transactions spanning every type/status this app has, rendering
  the real output to PNG and inspecting it — not just reading the pdfkit
  calls and assuming they're right, which is what let the minus-sign bug
  get caught before shipping instead of after. The button and its
  no-auth/error fallback path were verified in headless Chromium against
  the actual built bundle: button renders, `downloadStatementPdf()` runs to
  completion with zero uncaught errors and shows the expected `notify()`
  message when there's no session to authenticate with. `user/sw.js`
  bumped `petro-shell-v176` → `petro-shell-v177`.

## 2026-09-28 (follow-up 3) — Statement icon size bug fixed properly, PDF polish, two confirmed-dead image slots removed

Owner reviewed the round above and corrected one thing directly, then added
several smaller asks in the same message. Quoted because the correction
matters: *"you changed the size of svg and you made a different one, please
use the svg codes which were existing and size but just make it proper it
had a light white background."*

**The icon fix from the round above was real but incomplete** -- it fixed
the light-box background, but introduced a NEW bug in the process: routing
`ICONS.receiptLg` through `suppliedMemberIcon('accountStatement')` as raw
markup (bypassing the `.supplied-icon` `<span>`/mask wrapper entirely) meant
it no longer picked up the SIZE CLASS every sibling icon gets from its
context (`.acct-list-icon .supplied-icon{width:34px;height:34px}`) -- it
rendered at a fixed 26px instead, visibly smaller than the icons next to it
in the owner's own screenshot. Fixed properly this time: the SAME glyph is
now encoded as an `image/svg+xml` base64 data URI and set as
`SUPPLIED_MEMBER_ICON_ASSETS.accountStatement`'s value, going through the
IDENTICAL raster/mask pathway every other supplied icon already uses --
"use the svg codes which were existing and size," not a new delivery
mechanism.

**A second, real bug caught while fixing the first one, not shipped
blind**: the SVG rendered nothing at all once routed through the mask --
`getComputedStyle` confirmed the mask-image URL and background-color were
both set correctly, but the icon was still invisible. Root cause: `<svg>`
markup inserted inline via `innerHTML` (every other `ICONS.*` use in this
file) doesn't need an `xmlns` attribute, because the HTML parser already
knows it's looking at SVG content -- but an SVG referenced as an EXTERNAL
image resource (a CSS `mask-image: url(data:image/svg+xml;base64,...)`,
same as an `<img src>`) must be a well-formed, standalone XML document, and
silently fails to parse into anything without the namespace declaration.
Added `xmlns="http://www.w3.org/2000/svg"` to `ICONS.receiptLg` specifically
(the only `ICONS.*` entry ever reused this way) and confirmed live in
headless Chromium that it now renders, and at the identical 34px both it and
a sibling icon compute to.

**PDF statement polish**, all from the owner's own list:
- **Profile logo added** -- the same admin-uploaded `'logo'` slot the app
  already shows on Home/Account/Auth (`STATE.brandLogo`) is fetched
  server-side (`getPetroImage('logo')`), decoded from its stored data: URI
  into real bytes, and drawn top-left of the PDF header via `doc.image()`
  -- one upload already covers the app AND the statement, nothing new to
  manage. The header text shifts right only when a logo is actually set, so
  a fresh deploy with none uploaded yet still looks intentional rather than
  leaving a gap.
- **"Account ID" removed** from the metadata block (the only place this
  round's own audit found it actually shown to a member -- confirmed by
  grep across user-src, not assumed).
- **East African Time**, not UTC -- `eatNow()` (the exact same
  region-wall-clock helper `server.js` already uses for every stored
  transaction's own `date`/`time` fields) now backs the "Statement
  generated" stamp too, so the generation timestamp and every row beneath
  it read off the identical clock instead of two different ones.
- **Footer changed** to "`<Brand>` — Clean Energy, Green Development",
  replacing the earlier round's own "generated automatically" line, per the
  owner's exact wording.
- **Brand name confirmed already fully dynamic** in the PDF
  (`sett.brandName`, read live from admin settings on every request) --
  the one place that WASN'T dynamic was the client's own download
  filename (`downloadStatementPdf()`'s `a.download`), hardcoded to
  `'Petro-Statement.pdf'`. Fixed to `brandName() + '-Statement.pdf'`, the
  same client-side brand getter every other screen already uses -- so a
  future rename in Admin -> Settings now reaches the statement everywhere,
  including the saved filename, not just the PDF's own header text.
- **Verified**: rebuilt the exact route's drawing code standalone again
  (same method as the round above -- a real mock logo image, 26+
  transactions, rendered to PNG via PyMuPDF) and visually confirmed the
  logo, missing Account ID row, EAT-stamped generation time, and new
  footer text all render correctly together, not each checked in
  isolation.

**Two image slots removed outright, confirmed genuinely dead, not just
unused-for-now** (owner: *"every idle code which has no function it is
really doing should be removed"*):
- **`profilegif`** -- an animated brand-mark gif slot. Its own consumers
  (`homeGifHtml()`/`fitHomeGif()`) were already fully deleted in an earlier
  round; all that was left was a `STATE.profileGif` assignment on every
  single boot that nothing anywhere ever read again, plus a wasted Mongo
  read behind it on every `/public/petro-images` and `/admin/petro-images`
  call (both endpoints fetched all 10 slots every time, unconditionally).
  Confirmed dead by grep before removing, not assumed: zero references
  anywhere in `admin-src/index.html` (no upload row has existed for it in
  several rounds) and zero remaining consumers in `user-src/`.
- **`authcard`** -- the second half of the OLD two-part auth hero+card
  layout, replaced by the single continuous photo backdrop two rounds ago.
  Its own CSS comment already said so directly ("`#authCardBg`/
  `--auth-card-*` are no longer referenced by this markup"). Removed
  `STATE.authCardImage`, the dead `set('card', STATE.authCardImage, ...)`
  call (writing CSS custom properties nothing reads), and the two
  `#authCardBg`-targeting CSS rules that matched a element no longer in
  the markup.
- Both slots removed from `PETRO_IMAGE_SLOTS` and both `Promise.all([...])`
  fetch blocks in `server.js` (`/public/petro-images`,
  `/admin/petro-images`) -- an admin can no longer even attempt to set
  either, not just "nothing currently reads the result."
- **Deliberately NOT removed, flagged rather than assumed**: the Home
  banner's own VIDEO capability (`STATE.homeBannerVideo`,
  `/public/banner-video`, the admin's real "Home banner (+ video)" upload
  row) is extensively wired, actively maintained (preload timing,
  cache-busting, live-refresh swap-in-place) -- a real, working, currently
  documented feature, not idle code with nothing behind it. The owner's
  "video banner gifs... should be removed" could mean either "the dead gif
  slot" (done above) or "stop offering video banners as a concept" (a much
  larger removal touching Home's rendering path, live-refresh, and the
  admin upload UI) -- left alone this round rather than guessed at, needs
  the owner to say which was meant.
- **Also deliberately NOT done**: a full codebase sweep for every other
  piece of idle/dormant code. This file's own history already documents
  plenty of it left in place on purpose (PLAN_SPIN's unused branches,
  `openChangeTradePasswordSheet()`, `maybeShowAnnouncement()`'s no-op,
  `TURNTABLE_TX_TYPES`, the whole language-picker engine as of two rounds
  ago) under an explicit "leave dormant code as a safety margin, remove
  only the reachable entry point" precedent -- this round only removed the
  two slots above because they were independently confirmed dead by grep,
  not as the start of a wider purge. A real full audit is its own,
  separately-scoped piece of work.
- **Verified**: `node -c` on both touched files, `node build-core.js`
  round-trip OK. Re-ran the account-list-icon size check in headless
  Chromium after the xmlns fix: `accountStatement` and `accountWallet`
  (an existing, working sibling icon) both compute to the exact same
  34px×34px, confirmed by `getComputedStyle`, not just assumed from the
  CSS. `user/sw.js` bumped `petro-shell-v177` → `petro-shell-v178`
  (`admin/sw.js` NOT bumped -- `admin-src/index.html` was not touched this
  round, and a stray obfuscation-noise-only rebuild of `admin/index.html`
  was reverted rather than shipped for zero real change).

## 2026-09-28 (follow-up 4) — PDF document reference + human-readable timestamp + centered footer; referral/gift code formats redesigned again

Owner: *"Let's put also document reference bro like l can put Ref:
STMT-261777970567-20260901-EAE9H2 / Generated Sep 28, 2026 at 11:12 EAT ...
That is my example reference, l am not saying to use that format so look
for other format. And this word should be middle bottom not aside 'Petro
— Clean Energy, Green Development'. And please change the format of
referral codes and format of giftcodes use other ways."*

**PDF statement (`GET /statement/pdf` in `server.js`), four changes:**
- **Document reference added.** A `Reference:` row now leads the metadata
  block, above `Account holder`. Deliberately does NOT copy the owner's
  own example shape (a huge raw timestamp + date + random tail) -- instead
  reuses the same unambiguous alphabet (`GIFTCODE_CHARS`, no I/l/O/0/1)
  already used for gift/referral codes, formatted as `REF-XXX-XXX-XXX`
  (three groups of three). Its 3-3-3 shape is intentionally distinct from
  gift codes' 4-4-4 and referral codes' flat 5, so the three can't be
  confused for each other. Generated fresh per download and not stored or
  looked up anywhere -- it's a display label for that one PDF, not an
  identifier, so no uniqueness check is needed.
- **Timestamp reformatted.** `Statement generated: 2026-09-28 11:02:44
  EAT` → `Generated: Sep 28, 2026 at 11:30 EAT` (month name, no leading
  zeros on day/year, seconds dropped) -- matches the shape of the owner's
  own example line, still built from the same `eatNow()` clock every
  transaction row already uses, so the document and its rows never
  disagree about what "now" was.
- **Footer centered.** `Petro — Clean Energy, Green Development` at
  `doc.page.height - 50` gained `align: 'center'` on its existing
  full-width text box (was left-aligned by default) -- owner: *"this word
  should be middle bottom not aside."*
- Verified by rendering a full mock statement (26 transactions, mock logo,
  same script pattern as prior rounds) to PDF with `pdfkit` directly (not
  through the app, no DB needed) and to PNG via PyMuPDF -- confirmed
  visually: `Reference: REF-U6X-UDV-GQQ`, `Generated: Sep 28, 2026 at
  11:30 EAT`, and the footer centered under the table, all alongside the
  still-working logo/no-Account-ID/EAT changes from the previous round.

**Referral and gift code formats redesigned again (owner: "use other
ways"), both in `server.js`:**
- **Gift codes**: still 12 meaningful characters from the same
  unambiguous alphabet, but now dash-segmented into three groups of four
  --  `XXXX-XXXX-XXXX` (was one contiguous 12-character block) -- the
  same readability convention product keys commonly use, easier to read
  aloud or copy correctly than one long block. `/redeem`'s input regex
  already allowed dashes before this round; it now ALSO tolerates a member
  typing the same code without dashes (or with them elsewhere): if
  stripping non-alphanumerics from the typed code leaves exactly 12
  characters, it re-segments them into the canonical dashed form and
  retries the lookup before giving up. Client `#chestKey` input's
  `maxlength` bumped `12` → `14` to fit the two added dashes.
- **Referral codes**: dropped the mixed-case alphabet, now uppercase-only
  (same alphabet as gift codes) -- a referral code gets read aloud over a
  phone call far more often than a gift code (almost always
  copy-pasted) ever does, and "capital G or lowercase g?" is real friction
  voice sharing has that copy-paste doesn't. Length bumped `4` → `5` to
  keep the code space comfortably larger despite dropping lowercase
  (30^5 = 24,300,000 vs. the old 54^4 = 8,503,056). The collision-retry
  safety-valve escalation in `generateUniqueReferralCode()` updated to
  match: `[5, 6]` → `[6, 7]` (its first step was redundant at the old
  `[5, 6]` now that the base length is itself 5), comment text rewritten
  to match.
- Every already-issued code of either kind keeps working untouched --
  nothing is migrated, only the shape of NEWLY generated codes changed.
  `findUserByReferralCode()` and `/redeem`'s existing lookups are
  case-insensitive fallbacks that don't assume a fixed length or alphabet,
  so neither needed changes beyond the dash-tolerant re-segmentation above.
- **A real bug caught before shipping, not user-reported**: while
  rewriting `genGiftCode()`, grep turned up a SECOND, stale
  `function genGiftCode() { return randFromAlphabet(GIFTCODE_CHARS,
  GIFTCODE_LENGTH); }` declaration later in the file, left over from an
  earlier round, right before `generateUniqueGiftCode()`. Because
  JavaScript allows silent function redeclaration (the later one wins),
  this stale duplicate would have completely overridden the new
  dash-segmented generator, making the whole format change a silent no-op
  with no error anywhere. Caught by `grep -n "function genGiftCode"
  server.js` returning two line numbers before any test was run; the
  duplicate was deleted. This is exactly the "grep every usage before
  shipping" discipline this file has documented catching real bugs with
  before (the icon special-case regression two rounds ago, several
  Codex-caught referral-locking races) -- caught proactively this time,
  not reported by anyone.
- Verified in isolation with a standalone script (same alphabet/length
  constants copied out, no DB needed): sample gift codes
  (`699E-D35P-MFWS`, `B3HX-ZBBV-DYF3`, ...), sample referral codes
  (`WSFM3`, `EAYWC`, ...), sample doc references (`REF-N7H-VRU-7SU`, ...),
  and confirmed a generated gift code survives dash-stripping and
  re-segmentation back to its exact original form (the same logic
  `/redeem`'s fallback performs).
- Checked `admin-src/` for any gift-code/referral-code length or format
  assumption -- none found (admin never sets or validates a code's shape,
  only displays it).
- `node -c server.js` clean. `user-src/original_module.js` had no new
  edits this round (only its already-built-but-unshipped changes from
  follow-up 3 -- the icon fix, dynamic filename, `#chestKey` maxlength --
  were sitting unbuilt); `node build-core.js` run now, round-trip OK.
  `user/sw.js` bumped `petro-shell-v178` → `petro-shell-v179` (covers both
  this round's `#chestKey` maxlength/filename carry-over and the PDF/code
  changes below it in `server.js`, which don't need a client cache bump on
  their own but ship in the same push). `admin/sw.js` not touched --
  nothing admin-facing changed.

## 2026-09-28 (follow-up 5) — Fixed the wallpaper "shake" at scroll boundaries; downloaded statements now logged and listed in Admin under Transactions

Owner (on the wallpaper shake, after asking him to clarify): *"when l am
scrolling on products, the background image has a tendency of shaking or
going away from position when l reach the end of the image on scroll...
when you scroll hardly, the image feels like being forcefully separated
from code and starts moving... l think the image should nolonger be
responsive to touch of the system since it is background static."*
Separately, same message: *"also bro the statement should be saved in
admin panel under transactions so as l see the downloaded statements and
their references."*

**Wallpaper shake — real root cause identified, not just another CSS
patch on top of the last five.** The owner's description (shakes
specifically AT the top/bottom edge, worse on a hard/fast scroll) is
textbook mobile rubber-band/overscroll-bounce: scrolling past the top or
bottom of the page triggers the browser's own elastic bounce-back
animation, and because the refinery backdrop (`#app::before`) is
`position:fixed` (needed so it stays pinned as wallpaper while `#pageHost`
content scrolls over it), that bounce visibly drags it along on some
Android WebView/browser builds. `overscroll-behavior-y:none` (already on
`html,body,#app` since the 2026-09-23 "stabilize Petro wallpaper" round)
asks the browser not to do this, but isn't honoured consistently
everywhere -- which is exactly why the shake was still happening five
rounds of CSS-only mitigation later (oversized negative-inset backdrop,
`translateZ(0)`, `100lvh`, `backface-visibility:hidden`, all still in
place, none of them the actual cause).
- **Fixed** with the standard belt-and-suspenders fix for this exact
  failure mode: a `touchmove` listener (new IIFE in `user-src/index.html`'s
  existing plain, non-obfuscated `<script>` block, not run through
  `build-core.js`) that itself blocks the page from being dragged past its
  own top/bottom edge, so there's nothing left for the browser to bounce.
  Deliberately narrow, not a blanket "kill all scrolling" hammer:
  - Only intercepts a touch that starts already at the top edge and is
    dragged further down, or at the bottom edge dragged further up --
    every other scroll gesture on the page is completely untouched.
  - Skips entirely when the touch starts inside an element with its own
    internal scroller (`hasOwnScroller()` walks up checking
    `scrollHeight > clientHeight` + computed `overflow-y`), so it never
    fights a sheet/page-overlay/modal's own scrolling -- every text input
    in this app lives inside one of those, never directly on the bare
    document, so there is no IME/keyboard interaction risk at all (the
    thing that made the earlier "restructure the whole scroll model" idea
    too risky to attempt blind).
  - Verified in headless Chromium with real dispatched `TouchEvent`s (not
    just read from the code): confirmed `preventDefault()` fires exactly
    when at the top edge being pulled down, does NOT fire for an ordinary
    mid-page drag, and does NOT fire for a touch that starts inside a
    test element with its own `overflow-y:auto` scroller -- three
    separate assertions, not one happy-path check. Zero page errors.

**Downloaded statements now visible in Admin, under Transactions.**
- `GET /statement/pdf` (`server.js`) now writes one row to a NEW
  `statementDownloads` collection every time a member actually downloads
  their PDF (`userId`, `phone`, `ref` -- the `REF-XXX-XXX-XXX` document
  reference from the previous round -- `createdAt`). Deliberately its OWN
  collection, not folded into the `transactions` money ledger: a
  statement download is not a wallet movement, and mixing it in would
  risk it silently getting summed into `totalIn`/`totalOut` or any other
  money total somewhere down the line -- exactly the kind of money-safety
  regression this file's own invariants section exists to prevent. The
  write is wrapped so a logging failure can NEVER block the member's own
  already-generated PDF from downloading.
- New `POST /admin/statements/list` (admin-auth'd, same shape/cap
  convention as `/admin/transactions/list`: honors the caller's `limit`,
  clamped, with a `truncated` flag).
- Admin's existing Transactions tab (`admin-src/index.html`) now fetches
  both lists in parallel and merges them client-side, re-sorted by time
  (`normalizeStatementRow()`/`sortByCreatedAtDesc()`), tagged
  `type:'statement'` so it gets its own new "Statements" subtab and its
  Amount column renders as `—` instead of a misleading `+UGX 0` (a
  download has no amount). Description shows `Downloaded by <phone>` when
  known. Rows are still clickable through to the user detail modal, same
  as every other transaction row. `TX_LABELS` gained a `statement` entry.
  Deliberately reused the SAME tab/table rather than a new one -- the
  owner said "under transactions," not "a new tab."
- `node build-admin.js` round-trip OK. `admin/sw.js` bumped
  `petro-admin-shell-v41` → `v42` (admin-src actually changed this round,
  unlike the reverted no-op two rounds ago).
- `node build-core.js` round-trip OK (only `user-src/index.html`'s plain
  script changed this round, not `original_module.js`, but the build was
  still run since it's what copies that change into the deployed
  `user/index.html`). `user/sw.js` bumped `petro-shell-v179` → `v180`.
- Verified the new merge/sort/normalize logic in isolation with a
  standalone Node script (mixed sample transaction + statement rows,
  confirmed correct interleaved chronological order and the
  `Downloaded by <phone>` / `Statement downloaded` description fallback).

**Correction, same day, by a concurrent session (commit `f2abb13`,
"Fix mobile wallpaper sizing and scroll-edge gesture reversal"):** the
touchmove guard above had a real bug -- it tracked `dy` from a fixed
`startY` captured once at `touchstart`, so reversing direction mid-gesture
(pull past the top edge, correctly blocked, then pull back the other way)
did not correctly un-block within that same continuous touch. Fixed by
tracking `lastY` instead (updated every `touchmove`, so `dy` is the
delta since the last frame, not since the gesture began), plus an
`e.cancelable` guard before `preventDefault()` and `touchend`/
`touchcancel` listeners resetting `blocking`. That same commit also
replaced the negative-inset oversized-layer wallpaper sizing with a
`--wallpaper-height` custom property (`100lvh` where supported, a JS
`window.innerHeight` fallback that deliberately ignores height-only
resize events -- address bar/keyboard -- and only recalculates on a real
width change) applied to both `#app::before` and `.sheet-bg.show::after`
together. Owner confirmed fixed after this landed. Left as-is rather than
reverted or re-explained at length here -- this note exists so the
"Fixed the wallpaper shake" claim two paragraphs up is read against the
code that actually shipped, not the first draft of it.

## 2026-09-28 (follow-up 6) — USDT (TRC20) crypto deposits: a third deposit rail alongside MarzPay/PesaJet

Owner: *"let's put other payment methods on deposits, look at choco mcc,
had crypto check the branch... l want that way of deposit"* — after
looking through `choco-mcc/` (a sibling fork on branch
`claude/voltra-session-continue-mk95gw`, not this branch) for how it built
a USDT deposit rail, ported the same real feature into Petro — adapted to
Petro's own, considerably more hardened deposit/settings architecture
rather than copied verbatim (ChocoMCC's version predates several
money-safety audit rounds this codebase has already been through; Petro's
own `creditDeposit()`/`markDepositFailed()` are the locked, claim-before-
credit, concurrent-credit-safe versions, not ChocoMCC's simpler ones).

**How it works, end to end:**
- A member sends USDT to the admin's own TRC20 wallet address OUTSIDE the
  app, then submits the transaction hash (TXID) in-app.
- If `TRONGRID_API_KEY` is set (a free API key from trongrid.io -- the
  owner already has one, named "Petro" on their dashboard, and knows NOT
  to commit it: it goes only into `secrets.local.js` on the VPS, same as
  every other secret), the server checks the real TRON blockchain right at
  submission: right contract (the one official USDT TRC20 contract,
  hardcoded, never admin-settable), right destination address, amount at
  least what was claimed. A clean match auto-credits instantly through the
  exact same `creditDeposit()` every other deposit path uses -- this never
  adds a second way to move money, only a second way to decide to. A
  transaction that's confirmed on-chain but plainly wrong (wrong token,
  wrong address, short amount) auto-declines instantly too, through the
  same `markDepositFailed()` every other deposit path uses.
- Without a TronGrid key configured, every claim just waits as "Awaiting
  Review" for the admin's own Approve (the existing Force-credit
  button)/Reject (new) in the Deposits tab -- nothing forces automatic
  mode on.
- Handles TRON's three different address text encodings (base58 "T...",
  TRON hex "41...", bare EVM-style "0x...") by decoding all of them down
  to the same 20-byte core before comparing -- a naive string comparison
  between a base58 address and TronGrid's hex-formatted event data would
  never match, silently breaking auto-verification.
- A TXID can only ever back one open-or-credited claim (prevents the same
  real payment being submitted by multiple accounts, or resubmitted after
  being credited, to farm repeat credits) -- but a previously-DECLINED
  claim doesn't block a resubmission, so a member who mistyped the amount
  can correct it against the same real transfer.
- A 30s background reconciler (added to the existing `runReconciler()`
  chain and `/admin/payments/sync`) retries anything still unresolved, and
  gives up to Declined after 15 minutes unresolved -- every claim reaches
  a definitive outcome on its own, never sits forever. A no-op entirely
  when no TronGrid key is configured (pure-manual mode is untouched).

**server.js**: `DEFAULT_SETTINGS.usdtEnabled/usdtWalletAddress/usdtRate`
(off by default); `usdtEnabled` added to `SETTINGS_BOOLEAN_FIELDS`,
`usdtRate` range-checked in `SETTINGS_CRITICAL_RANGES`; a new
`usdtWalletAddress` validator in `/admin/settings/update` (must look like
a real TRC20 address -- `T` + 33 base58 characters -- or be blank; refused
outright rather than silently shown to every member as a place to send
real money, on a typo). New `TRONGRID_BASE/API_KEY/TIMEOUT`,
`USDT_TRC20_CONTRACT`, `base58Decode()`/`addrCore()`/`verifyUsdtTx()`,
`resolveUsdtDeposit()` (the one function that decides a claim's fate,
shared by the synchronous submit-time check, the client's status poll,
and the reconciler sweep), `reconcileUsdtDeposits()`. New routes:
`POST /deposit/usdt/submit`, `POST /deposit/usdt/status`,
`POST /admin/deposit/usdt/reject` (owner-gated, mirrors the existing
withdrawal-reject pattern). Pending-deposit rows use a new pre-credit
status, `awaiting_verification` -- safe by construction, since
`depositFullyCredited()` only ever checks for `'matched'`, never switches
on the pre-credit value. Ledger rows carry the same
`commissionBasis:'deposit'`/`commissionPending`/`commissionPaidLevels`
fields the MarzPay path stamps, so referral commissions fire identically
regardless of which rail a deposit came through. Ref prefix `'U'` (vs
MarzPay's `'S'`), so the two are visually distinguishable in Records/
admin without needing to check the `method` field.

**admin-src/index.html**: new "Crypto deposits (USDT TRC20)" settings
panel (enable toggle, wallet address, exchange rate, its own save button
-- `/admin/settings/update` again, same as every other settings section).
Deposits tab: `DEP_GROUPS.pending` now includes `awaiting_verification`
(the existing `statusPill()` already had an `'awaiting_verification'` →
"Awaiting Review" branch from some earlier lineage -- a lucky, confirming
match, not something added this round); USDT rows show "USDT (TRC20)" +
an Auto/Auto-declined badge + a direct Tronscan link to the TXID; a
Reject button (owner-only, same gate as Force-credit) appears only for a
USDT claim still genuinely open.

**user-src/original_module.js**: the existing Deposit sheet
(`openDepositFormSheet()`) gains a method-selector row (reusing the
`.statement-tabs`/`.on` underline-tab style Transaction Statement already
established, not a new tab component) -- Mobile Money / USDT (TRC20) --
shown ONLY when `usdtEnabled` is on; with it off, the sheet renders
exactly as before, byte-for-byte the same Mobile Money panel. The USDT
panel: live UGX conversion as the amount is typed, the wallet address
with a Copy button (routed through the existing `copyText()`/
`writeClipboard()` helpers, not a new clipboard implementation), a TXID
field, and its own submit flow. Deliberately NOT routed through the
Mobile Money status modal (`openDepositStatusModal()` and friends) --
that modal's copy (USSD fallback codes, "check your phone for the
prompt") is written for a push-payment a member approves on their phone,
which a crypto transfer they already sent before opening the form simply
isn't. USDT gets its own light submit → toast → poll flow instead
(mirrors ChocoMCC's own pattern), so the heavily-tuned, owner-worded
MarzPay status modal is completely untouched.

**Verified, not just read**: `node -c` on both touched files; `node
build-core.js`/`build-admin.js` both round-trip OK. Full diff of the new
`server.js` code re-read end to end for correctness (lock/claim-before-
credit reuse, status-value safety, TXID dedupe logic) before shipping.
Live headless-Chromium checks against the real built `user/index.html`
(not just the source): confirmed the method tabs render and toggle panels
correctly with `usdtEnabled:true`, confirmed the tabs DON'T render at all
with `usdtEnabled:false` (default -- nothing changes for anyone until an
admin turns it on), confirmed the live UGX conversion math, and confirmed
the Copy button actually writes the real address to the clipboard (read
back via `navigator.clipboard.readText()`). Isolated the merge-sort logic
from a previous round's pattern to sanity-check the settings-boolean-
field and critical-range wiring by reading every call site rather than
assuming.

`user/sw.js` bumped `v180` → `v181`, `admin/sw.js` bumped `v42` → `v43`
(both source files changed this round). **Not yet done, and not blocking
shipping this**: the owner's separate ask for MarzPay CARD payments as a
fourth rail -- waiting on documentation the owner said they'd send
separately; this round only covers the USDT/crypto rail.

## 2026-09-28 (follow-up 7) — MARZPAY_KEY was never set on the VPS (real deposits were failing); MarzPay card payments added as a fourth deposit rail

**Real production bug found and fixed, not part of the plan.** Scrolling
`pm2 logs petro-server` while adding the TronGrid key above (owner's own
Termux session) turned up `MarzPay collect-money rejected: "Missing or
invalid API credentials"`, repeated from 2026-09-27 through the moment it
was found -- `MARZPAY_KEY` (`server.js`: `process.env.MARZPAY_KEY`, sent
as `Authorization: Basic ${MARZPAY_KEY}` on every collect-money call) was
never set in `secrets.local.js` on the VPS. Every real mobile-money
deposit attempt on the live app had been failing at the gateway itself
the whole time the VPS has been up. Fixed the same way as the TronGrid
key: owner pulled the ready-to-use base64 `key:secret` string straight
from the MarzPay dashboard and added it via the same one-shot `node -e`
pattern, then `pm2 reload petro-server`. Confirmed via the resulting
`pm2 logs` tail: clean restart, no further rejections. **Lesson for next
time a payment gateway "isn't working": check `pm2 logs` for the actual
rejection reason before assuming it's an app bug** -- this one was a
missing credential, not a code defect, and the code itself was already
correct.

**MarzPay card payments — a fourth deposit rail**, owner: *"we shall use
MarzPay cards payment, so even if payment for mobile money is on
pesajet, cards payment on MarzPay will do as another 3 payment method"*
(their own count; USDT crypto above made it four in the end). Owner
supplied MarzPay's own `marzpay-integration` skill doc and its Card
Payments + Webhooks pages directly.

**How it actually works, and why almost none of the money-crediting
machinery is new:**
- Same `POST /collect-money` mobile money already calls, `method: 'card'`
  instead of `phone_number` -- MarzPay returns a `redirect_url` to its own
  hosted card-gateway page, not a push prompt. The member's browser leaves
  the app entirely to pay there, unlike mobile money.
- MarzPay's own docs describe `callback_url` as doing double duty for
  card specifically: the URL the CUSTOMER'S browser lands back on after
  paying, AND the URL the real server-to-server result gets POSTed to
  (same as mobile money's per-request `callback_url`). Split cleanly by
  HTTP method on the exact same path (`/deposit/callback`): the existing
  `POST` handler (the real webhook -- unchanged, not touched this round)
  handles the money; a new `GET` handler serves a small static "you can
  return to the app" page for the browser leg. A `GET` never carries the
  real webhook (MarzPay's own webhook is always a `POST`), so crediting
  never depends on a member's browser making it back there at all.
- **Everything that actually moves money is 100% reused, unmodified**:
  `creditDeposit()`/`markDepositFailed()` (money-safety core), the
  existing `POST /deposit/callback` webhook (already keyed purely on
  `marzReference`/`marzTxUuid`, never on HOW a `pendingDeposits` row was
  created), `POST /deposit/marzpay/status` (the client poll -- read
  fully before reuse, confirmed it never assumes a phone number or
  MoMo-specific field), and `reconcilePendingDeposits()`'s own 30s sweep
  (`where('marzTxUuid','>','')`, provider-agnostic by construction). A
  card `pendingDeposits` row is invisible to all four by nothing more
  than coincidence of shape (`marzReference`/`marzTxUuid`/`status`
  matching mobile money's exact convention) -- none of them needed a
  single line changed to pick up card deposits. Verified this by reading
  every one of the four in full before reusing rather than assuming.
- New, card-specific: `marzCollectCard()` (no `phone_number`, `method:
  'card'`), `POST /deposit/card/submit` (creates the row, calls MarzPay,
  returns `redirectUrl` to the client), the `GET /deposit/callback`
  return page, `cardDepositEnabled` setting (off by default -- MarzPay
  refuses with `SERVICE_NOT_SUBSCRIBED` until the owner's business has an
  active Card Payments subscription, so this must never turn itself on),
  `CARD_MIN_UGX`/`CARD_MAX_UGX` (500/10,000,000, MarzPay's own stated
  range, enforced as a floor/ceiling independent of the admin's own
  `minDeposit`). Ref prefix `'C'`, distinct from MoMo's `'S'` and USDT's
  `'U'`.
- **The PWA-reload problem, and how it's solved.** A full-page navigation
  to MarzPay's hosted page and back reloads the whole app from scratch --
  any in-memory JS (the pending deposit id) is gone. Persisted to
  `localStorage` (`petro_pending_card_deposit`) right before the
  navigation; `resumePendingCardDeposit()` (called from `enterApp()`,
  fire-and-forget, on every app open) checks for it and resumes polling
  the same `/deposit/marzpay/status` mobile money already uses -- clears
  the key on `matched`/`failed`, leaves it in place while still pending
  (the background reconciler and the next app open keep trying). Verified
  in headless Chromium with a blocked-network navigation (real
  `location.href` assignment, confirmed the browser actually attempts to
  leave the page) that the id survives into a fresh page load of the same
  origin, and that `resumePendingCardDeposit()` correctly clears the key
  on a matched result and preserves it on a still-pending one.
- **Deposit sheet**: method tabs are now built dynamically from whichever
  rails are actually on (`Mobile Money` always; `USDT` and `Card` each
  add their own tab only when enabled) -- zero tabs shown (today's exact
  original single-form sheet) with both off, up to three. Verified all
  four combinations (0/1/2 extra tabs, and switching between them) live
  in headless Chromium against the real built bundle.
- **Admin panel**: new "Card deposits (MarzPay)" settings panel (a single
  enable toggle -- no wallet address or rate needed, MarzPay hosts the
  whole payment page). Deposits tab: `methodLabel` gained a `'Card
  (MarzPay)'` branch; Force-credit already covered card's `stuck`
  states (`initiating`/`pending`/`failed`) with no changes needed, since
  card never introduces a new status value the way USDT's
  `awaiting_verification` did.
- **Not yet configured, flagged rather than assumed**: whether
  `PUBLIC_URL` is actually set in `secrets.local.js` on the VPS. Without
  it, `callbackUrl` is omitted from both the mobile-money AND card
  collect-money calls (matches the existing, already-accepted MoMo
  behavior: `PUBLIC_URL ? PUBLIC_URL + '/deposit/callback' : undefined`)
  -- MoMo still resolves fine either way (the reconciler and the
  member's own poll cover for a missing webhook), but a card payment
  gains real value from it: without a `callback_url`, MarzPay's hosted
  page may have nowhere to send the member's browser back to after they
  pay. Given the VPS has no real domain yet (bare IP only, see
  "Hosting" above), the honest interim value is `http://<VPS-IP>:3000`
  -- set `PUBLIC_URL` in `secrets.local.js` to that (or the real domain,
  once one exists) if it is not already there.
- `node -c` clean on both rounds of changes; `build-core.js`/
  `build-admin.js` both round-trip OK. `user/sw.js` bumped `v183` →
  `v184`, `admin/sw.js` bumped `v43` → `v44`.

## 2026-09-28 (follow-up 8) — Mobile-money status screen: Verify button removed, success screen redesigned with an auto-redirect countdown; PWA-reload gotcha found on `pm2 reload`; a real card-gateway 404 traced to MarzPay/Pegasus's own side

**A second live-testing round on the VPS, after wiring `MARZPAY_KEY`,
`TRONGRID_API_KEY` and `PUBLIC_URL` in one at a time.** Each of those
three `secrets.local.js` additions had been applied with `pm2 reload
petro-server` (by process NAME) -- which does NOT actually re-read the
file. PM2 caches whatever environment a process started with; reloading
by name just restarts it with that same stale cached environment. Only
reloading THROUGH the ecosystem file itself, with `--update-env`
(`pm2 reload ecosystem.config.js --update-env`, run from `deploy/`),
forces it to re-run `require('./secrets.local.js')` fresh and actually
push the new values in. All three additions looked like they'd worked
(clean restart, no crash in the logs) right up until a real test deposit
still hit "Missing or invalid API credentials" -- the process restarting
cleanly proves nothing about which env vars it restarted WITH. One
`--update-env` reload through the file fixed all three at once. **Any
future secrets.local.js change on this VPS must reload this way, not
by process name**, or it will look successful and silently not apply.

**Once genuinely live**: a real mobile-money deposit correctly sent a
push prompt to the owner's phone (confirms `MARZPAY_KEY` was the real,
sole blocker all along -- the card/USDT code from the last two rounds
needed nothing further). A real card-payment attempt got as far as a
genuine MarzPay `redirect_url`, landed on Pegasus's own hosted card
gateway (MarzPay's underlying card processor), and hit a 404 there --
`/LivePaymentsCardGateway/pegasusgateway.aspx` not found on
`pegasus.co.ug`. That confirms this app's own side of the card flow is
working correctly end to end (real credentials, real API call, real
redirect) -- the failure is on MarzPay/Pegasus's own infrastructure
(their Card Payments subscription/service not fully provisioned, or a
broken path on their gateway), not something fixable in this codebase.
Left as a known external blocker for the owner to raise with MarzPay
support, not "fixed" here.

**Mobile-money deposit status screen, owner feedback from watching a
real test deposit:**
- *"remove verify button, so this is automatic verification"* -- the
  autopoll (`pollDepositStatus()`) was already checking on its own the
  whole time; the manual Verify button next to it was a second way to
  do the same thing, not a needed one. `setDepositStatusPending()` and
  `setDepositStatusUnknown()` both now call `setDepButtons(false, ...)`
  -- Verify never shows again, in either state. The button and
  `verifyDepositNow()` are left in the markup/module (same "leave
  dormant code, remove only the reachable entry point" precedent this
  file has followed before), just never displayed.
- *"on payment success it says congratulations, payment has been
  received (added to your wallet), redirecting back home in 5 seconds
  or you can say so back the button should be available"* --
  `setDepositStatusSuccess()` rewritten: title is now "Congratulations!
  🎉", body reads "Payment received — `<amount>` has been added to your
  wallet.", and a countdown line ("Returning to Home in 5…4…3…") ticks
  down via `setInterval`. The Close button is relabelled "Back to Home"
  and shown IMMEDIATELY (not gated behind the countdown), so a member
  who doesn't want to wait can leave right away -- exactly the "or you
  can say so back the button should be available" alternative asked
  for. At 0 the countdown fires the identical `closeDepositStatusModal()`
  the button itself calls. Tapping Close manually clears the interval
  (`_depSuccessRedirectTimer`) so it can never fire a moment later
  against an already-closed modal. `setDepositStatusFailed()`/
  `setDepositStatusUnknown()` both explicitly reset the Close button's
  label back to plain "Close" -- otherwise a member who saw one
  successful deposit's "Back to Home" label earlier in the same session
  would see that same label on an unrelated LATER failed/pending one,
  since the button element is reused across attempts without a fresh
  page load in between. Verified the whole sequence in headless
  Chromium against the real built bundle: pending shows neither button;
  success shows the new copy/countdown/immediate Close; the countdown
  actually decrements and auto-closes the modal at 5s when left alone;
  manually closing early cancels the timer with no stray reopen even
  after waiting past the original 5s window; and a failed/unknown state
  reached AFTER a prior success correctly shows plain "Close", not a
  leftover "Back to Home".
- *"check down bro on poll animation, it shows things of other
  screens"* -- couldn't fully pin down the exact mechanism from the
  screenshot alone (`.pay-page`'s own `::before` wallpaper layer and the
  element itself both already use viewport-relative `position:fixed`,
  which should be robust to the same mobile-browser-chrome-resize class
  of bug the wallpaper itself had two rounds ago). Applied one cheap,
  safe hardening regardless of the exact cause: `.pay-page`'s own
  `background` changed from `transparent` (relying ENTIRELY on the
  `::before` pseudo-element painting over it) to a solid `#1d130f` (the
  same base canvas color `#app` itself uses) -- so the element can never
  be genuinely see-through to whatever sits behind it, whatever the
  reason the wallpaper layer might not be fully covering it. Flagged,
  not claimed fixed -- ask the owner for another screenshot (ideally
  full-screen, scrolled to show the exact spot) if it's still visible
  after this ships, rather than guessing further blind.
- `node -c` clean, `build-core.js` round-trip OK. `user/sw.js` bumped
  `v184` → `v185`.

## Follow-up 9 (confetti + poll audit + minDeposit + default phone + live instructions)

Owner, one message, five asks: *"l also need high quality confetti
sparklings bursting and dropping down allover the page on payment
success on all methods you need to ensure payment poll please and
configured Minimum deposit should be ensured, also let the registered
number also appear as a default deposit number for mobile money, also
make sure that instructions fetch configured values please ie minimum
deposit, withdrawal amount, withdraw number, also bro on usdt
payments."* Sent with a reference PNG of colourful confetti pieces.

- **Confetti** — new `fireConfetti()` in `user-src/original_module.js`,
  plain `<canvas>`, zero dependencies (matches this codebase's own
  standing rule). A fixed, full-viewport, `pointer-events:none` overlay
  so it never blocks a tap underneath. Two particle sets under one
  gravity sim: ~140 pieces already falling from above the top edge
  ("dropping down allover the page") plus a ~70-piece burst fired
  upward from bottom-center ("bursting"), so the burst arcs over and
  joins the rain before both fade out together over ~4.2s. Petro's own
  palette (amber/red/gold/green/blue/white), not generic party colours.
  Respects `prefers-reduced-motion` (skips entirely), self-removes the
  canvas and its resize listener when the animation ends, and tears
  down any still-running instance before starting a new one (a rapid
  second success restarts clean rather than layering two loops). Wired
  into all three rails' actual success paths, not just one shared
  place, since USDT never uses the deposit-status modal at all:
  `setDepositStatusSuccess()` (covers Mobile Money AND Card, which
  share this one modal), `doUsdtDeposit()`'s in-app `matched` branch,
  `pollUsdtDepositStatus()`'s polled `matched` branch, and
  `resumePendingCardDeposit()`'s `matched` branch (see below — this one
  needed a bigger fix than just adding the call). Verified live in
  headless Chromium against the real built bundle: canvas appears on
  `fireConfetti()`, confetti visibly rains + bursts mid-animation
  (screenshot confirmed), and the canvas cleans itself up afterward with
  no leftover DOM node or listener.

- **Payment poll audit** — went through all three rails looking for
  real gaps, not just re-confirming what already worked:
  - Mobile Money's `pollDepositStatus()` (24 attempts, ~60s budget,
    single-flight via `depositStatusCheck()`, correctly abandons a
    superseded poll if the member starts a second deposit mid-poll) —
    already solid, nothing changed.
  - USDT's `pollUsdtDepositStatus()` (6 attempts × 5s) — already solid,
    nothing changed beyond the confetti call above.
  - **Card had a real gap**: `resumePendingCardDeposit()` was a
    single check-and-forget on app boot, not a poll. If the MarzPay
    webhook hadn't landed in the exact instant the member reopened the
    app after paying on the hosted card gateway, they'd see nothing at
    all until the NEXT full app restart — no retry in between, unlike
    every other rail. Rewritten to poll on the same shape/cadence as
    USDT's own poll (6 attempts × 5s via `setInterval`), clearing on a
    resolved `matched`/`failed` state and giving up quietly after ~30s
    (still leaves the localStorage key in place for the next app open
    and the server's own `reconcilePendingDeposits()` sweep, exactly as
    before — never declared failed just because this one window didn't
    resolve it).
  - Withdrawals don't poll anywhere in this app (admin-approved /
    auto-approved server-side, surfaced via Transaction Statement, not
    a gateway callback a client needs to chase) — confirmed there's
    nothing to audit there; the owner's "ensure payment poll" reads
    as deposits, grouped with the minDeposit ask right next to it.

- **minDeposit enforcement** — Card and USDT already checked this
  client-side before hitting the network; Mobile Money's
  `submitDeposit()` didn't, so a below-minimum MoMo deposit round-
  tripped to the server before the member found out. Added the same
  check Card/USDT already had, right after the existing amount>0 check.

- **Registered number as default deposit phone** — `depPhone`'s `value`
  now pre-fills from `localDigits((STATE.account || {}).phone) || ''`
  (the same parser `phoneToEmail()` already uses, so a stored number
  that doesn't match this region's shape just falls back to blank
  rather than shoving something malformed into the field). This
  explicitly REVERSES an earlier, deliberate round's choice to leave
  the field blank — the owner's latest instruction is unambiguous, and
  it's a pre-fill, not a lock: the field stays fully editable, since a
  deposit can genuinely come from a different mobile-money number than
  the one the account registered with.

- **Instructions pulling live configured values** — Withdraw's own
  instructions already pulled `minWithdraw`/`maxWithdraw`/
  `withdrawMultiple`/opening-hours from live settings and pointed at
  the member's own bound wallet for the "withdraw number" (nothing to
  fix there). Deposit side had two stale spots, both fixed: Mobile
  Money's step 3 still said "use Verify" — misleading since follow-up 8
  removed that button — reworded to "Wait for confirmation -- this
  checks itself automatically. If money leaves your phone but the
  balance has not updated, keep the transaction reference and contact
  Customer Support." USDT's step 1 didn't mention the minimum at all —
  now reads "Minimum `<minDeposit>` (about `<X>` USDT), on the TRC20
  (Tron) network only, to the address above." (USDT-amount conversion
  only shown when `usdtRate` is actually set, so it never divides by
  zero or prints a bogus figure on a fresh deploy).

`node -c` clean, `build-core.js` round-trip OK, confetti verified live
in headless Chromium against the real built bundle (screenshot-
confirmed rendering, clean teardown). The default-phone pre-fill and
minDeposit check were verified by direct code reading against the same
already-proven pattern Card/USDT use (not separately driven through a
live login in this round — a full Firebase-auth session isn't
reachable from this sandbox). `user/sw.js` bumped `v185` → `v186`.

## Follow-up 10 (Wallet form text invisible on the refinery photo)

Owner, with a screenshot of the "Bind Wallet" screen: *"also bro, some
words are looking black when you write."*

Root cause: `.wallet-line-field` (the network/phone/account-holder
fields in `openWalletSheet()`'s add-wallet form) styles itself with
`--snow-ink`/`--snow-border`/`--snow-muted` — near-black text, a
near-white underline, all meant for a white card. A separate, deliberate
rule (`.sheet-body:has(.wallet-minimal){background:transparent;...}`)
strips this specific sheet's card entirely so the refinery wallpaper
photo shows straight through behind it — Withdraw's fields (`.wit-*`)
and the password-change form (`.pw-form`) already got white-text
overrides for that same treatment, but the add-wallet form never did,
so typed/placeholder text and the field's own underline rendered
near-invisible against the dark photo. Added
`.wallet-add-form .wallet-line-field`/`input`/`::placeholder`/
`.prov-caret` overrides in `user-src/index.html` forcing white text,
a visible light underline, and a visible caret — matching the pattern
already used for `.wit-*`/`.pw-form`. Left `.prov-list`/`.prov-opt` (the
network dropdown's own popup) untouched — that already sits on its own
opaque white card, dark text on white is already legible there.

**Caught and fixed a self-inflicted bug while verifying this**: the
first version of this fix's own explanatory CSS comment accidentally
contained the literal characters `*/` mid-sentence (writing
`.wit-*/.pw-form` in prose), which closed the CSS comment early. The
browser then treated the rest of the comment's English prose as
malformed CSS, discarding tokens up to the next `}` — which silently
ate the FIRST of the four new rules
(`.wallet-add-form .wallet-line-field{border-bottom-color:...}`,
the underline color) while its three neighbors parsed fine, since CSS
error recovery is per-rule. Caught by enumerating
`document.styleSheets[…].cssRules` in headless Chromium and diffing
against the raw served text rather than trusting a computed-style
check alone — the border-bottom-color came back as the OLD near-white
value even though the correct rule text was visibly present in the
HTML source, which is what surfaced the mis-closed comment. Reworded
the comment to avoid the accidental `*/` and confirmed all four rules
now parse and apply (`getComputedStyle` on injected field markup: text
`rgb(255,255,255)`, placeholder `rgba(255,255,255,.55)`, underline
`rgba(255,255,255,.22)`). Lesson for any future CSS comment in this
file: never write `*/ ` as a literal substring in prose, even split
across a word boundary like `wit-*` immediately followed by `/`.

`node -c`/`build-core.js` unaffected (pure CSS, no JS touched). Verified
via injected-markup + `cssRules` enumeration in headless Chromium
against the real built bundle rather than a full login (no reachable
backend from this sandbox) — a real-device check after deploy is still
worthwhile. `user/sw.js` bumped `v186` → `v187`.

## Follow-up 11 (Card quick-amount tap dead, chip styling, stray "--", perf check)

Owner, with two screenshots (Card tab, USDT tab): *"bro l can't tap a
quick amount in cards ,why???????,also another thing let the amounts
be buttons not being just underline, stop using hyphen ,check all the
code ,l don't need hyphen please. also make sure that callbacks, are
very faster and database acces ie read and write is also very fast
even loading should be very fast since we are using a powerful vps"*

- **Card quick-amount tap did nothing — real bug, found and fixed.**
  `depositChipsHtml(s)` is shared by Mobile Money's `#depChips` and
  Card's `#cardChips`, but every chip it generated called
  `onclick="pickDepositAmount(${a})"` unconditionally, and
  `pickDepositAmount()` was hardcoded to always write into `#depAmount`
  (Mobile Money's own field) and refresh `#depChips`'s `.sel` state.
  Tapping a Card quick amount therefore silently updated the OTHER,
  hidden field and did nothing visible on the Card tab -- exactly the
  bug reported. `depositChipsHtml(s, inputId)` and
  `pickDepositAmount(amt, inputId)` are now both parameterized by which
  field/chip-group they target (`'depAmount'` or `'cardAmount'`), and
  the two call sites (`#depChips`/`#cardChips`) each pass their own id.
  `_cardChosenAmount` (already declared, previously unused for the
  chips' own selected-state check) is now what `depositChipsHtml`
  reads for Card's highlight, so switching tabs no longer cross-
  contaminates which chip shows selected. Verified in headless
  Chromium by invoking the real `pickDepositAmount()` against injected
  chip markup for both panels: tapping Card's chip sets `cardAmount`
  only (leaves `depAmount` untouched, marks the Card chip `.sel`, not
  the MoMo one) and vice versa.

- **Quick-amount chips restyled from underline text to real pill
  buttons.** `.dep-chip` was deliberately flat before (`border:0`,
  `border-bottom:2px solid transparent`, text-only, no fill) -- a past
  round's mockup-matching choice, not a bug, but the owner now
  explicitly wants buttons. Rewrote `.dep-chip`/`.dep-chips` in
  `user-src/index.html`: `border-radius:999px`, a visible outline,
  9px/16px padding, filled wine-red background + white text when
  `.sel`. Added `.sheet-body .dep-chip{color:#fff}` to the sheet's own
  dark-context override list (same pattern as `.dep-amt input`/
  `.dep-phone input` right above it) since the base `--snow-ink` token
  is near-black, meant for a white card -- same class of bug as Follow-
  up 10's wallet-field fix, caught before shipping this time. Verified
  via `getComputedStyle` on injected markup: `border-radius:999px`,
  selected chip `background:rgb(227,6,19)` (the wine accent) with white
  text, unselected chip text `rgb(255,255,255)` (visible, not near-black).

- **Stray literal "--" in user-facing copy.** Swept `user-src/
  original_module.js` for ` -- ` occurring in actual UI strings (not
  code comments, which use "--" as this codebase's own established
  comment-dash convention throughout and were left alone -- the owner's
  complaint was about what renders on screen, and the app's existing,
  deliberate em-dash usage elsewhere in UI copy, e.g. the PWA-install
  hint strings and empty-value "—" placeholders, is a different,
  intentional character and was NOT touched). Found and fixed exactly
  two real hits: the referral-code-invalid toast ("continuing without
  it" -- now two sentences) and the Mobile Money instructions' step 3
  (added in Follow-up 9, "checks itself automatically" -- also now two
  sentences). Scoped to the member-facing app only; server.js's admin-
  facing error messages (reject/repair/upload-validation routes) still
  use "--" in a few places -- flagged, not touched, since those are
  seen only inside the admin panel, not the screens the owner
  screenshotted.

- **Performance ask** ("callbacks very fast, DB read/write very fast,
  loading very fast, powerful VPS") -- checked rather than assumed.
  `db.js`'s `ensureIndexes()` already carries ~30 compound/unique
  indexes with per-index reasoning tied to specific hot queries (dated
  "Round 104"/"Round 106" comments), a tuned connection pool
  (`maxPoolSize:50`, `minPoolSize:3`, retryReads/retryWrites),
  `/deposit/callback` already `res.json()`s success back to the webhook
  sender as its very FIRST line before touching the database at all,
  and the client's own `bootFromNetwork()`/`enterApp()` already do an
  instant cache-hit paint plus a fully parallel `Promise.all()`
  prefetch of every tab's data, each with its own dated comment tied to
  a past exact complaint about slow loading. This is not new work
  needed now -- it is the product of several already-completed
  performance rounds. Checked the two routes THIS session actually
  added (`/deposit/card/submit`, `/deposit/marzpay/status`'s card
  branch) against that same bar and found nothing sub-par: parallel
  user+settings fetch, direct by-id lookups, no redundant round trips,
  the only per-poll network call is the live MarzPay re-check a status
  poll cannot skip without becoming unsafe. Did not make speculative
  performance changes on top of an already this-carefully-tuned system
  without a concrete slow spot to point at -- that risks a real
  regression in exchange for no measurable gain. Told the owner this
  plainly and asked which SCREEN or ACTION actually feels slow in
  practice, to profile that exact path next round instead of guessing
  across the whole app again.

`node -c` clean, `build-core.js` round-trip OK. Chip routing/styling
verified live in headless Chromium (see above); the two dash rewrites
are plain string edits, no behavior to verify beyond the syntax check.
`user/sw.js` bumped `v187` → `v188`.

## Follow-up 11.5 — Railway/EdgeOne fully removed, not just "harmless to leave"

Owner, after this same session's reply ended with EdgeOne/Railway deploy
instructions that belong to Voltra, not Petro: *"how many times will l
say that everything is on our vps,please clean up things of railway and
EdgeOne, everything is on our hostinger vps"*, then, mid-investigation:
*"l said clean your memory stop thinking about railway or EdgeOne, our
work is on our vps."*

A prior round (the original Chipz→Petro fork audit) already removed
`railway.json`/`railway.app.json`/`railway.admin.json`/`render.yaml` and
called the remaining `CORS_ALLOWED_SUFFIXES` entries (`.edgeone.*`,
`.onrender.com`, `.up.railway.app`, `.railway.app`) "unused on a VPS but
harmless, not broken." The owner's instruction this round is that
"harmless to leave" is not good enough — actually remove it. Done:

- **`server.js`**: `CORS_ALLOWED_SUFFIXES` emptied to `[]` (was 7 PaaS
  suffixes) — the mechanism stays (still used by `isInfraHost`/the CORS
  origin check, and kept as a place to add a real suffix back through if
  this ever moves off a single fixed VPS again), just nothing populates
  it anymore. `PUBLIC_URL`'s fallback chain dropped `RENDER_EXTERNAL_URL`/
  `RAILWAY_PUBLIC_DOMAIN` (platform-injected env vars that only exist on
  those PaaS's own runtimes — dead on a VPS, where `PUBLIC_URL` is always
  set explicitly in `secrets.local.js`). Rewrote every comment that
  explained CORS/CORP/PUBLIC_URL in terms of "the frontend is on EdgeOne,
  the backend is on Render" — that architecture does not exist anymore;
  api./app./admin.PETRO_DOMAIN are one VPS behind nginx now.
- **`admin-src/index.html`**: the CSP-explainer comment ("this page does
  not only ship from Render... also deployed to EdgeOne") rewritten to
  describe the real reason the meta CSP exists (defense in depth against
  a header-less serving path, e.g. local testing) rather than a second
  real host that no longer exists. The Allowed-domains field's own
  on-screen help text ("Render/EdgeOne addresses are always allowed")
  was actively wrong (those suffixes are gone) — now names the real
  built-ins (`petro-platform.com` + this VPS's own address). A SEPARATE
  admin setting's help text (parked-host exemption, all 6 languages)
  had the same wrong claim — reworded to "your own server address" in
  each language rather than naming a specific former platform.
- **`user-src/index.html`**: same CSP-explainer rewrite.
- **`user-src/original_module.js`**: the file's own header comment
  ("Render web service... Tencent EdgeOne Pages... cross-origin") was
  describing a two-host architecture that stopped being true the moment
  hosting moved to the VPS — `API_BASE`'s actual VALUE was already
  correct (`http://179.198.197.114:3000`), only the comment above it lied
  about why.
- **`build-admin.js`**: header claimed "EdgeOne runs this file on every
  deployment" — false; nothing auto-runs it, the owner runs it by hand
  before every VPS deploy per the Build & deploy pipeline section.
- **`docs/railway-deploy.md`** (279 lines, a full Railway three-service
  deploy guide) — deleted outright. Zero remaining value once hosting is
  one fixed VPS; keeping it around as "just docs" is exactly the kind of
  thing that gets pasted back in by mistake later.
- **`set-backend-url.js`**: its own `--check`/error-message example URL
  was still a Railway `*.up.railway.app` address — changed to
  `https://api.petro-platform.com`. Its historical prose explaining WHY
  the script has such a paranoid verification sweep ("found by the
  Render → Railway move pointing at a dead host") was left alone —
  accurate past-tense history justifying present-day code, not a current
  operational claim.
- **Tests — found genuinely broken by this cleanup, not just cosmetically
  stale, and fixed for real rather than left to bit-rot**:
  - `test-cors-origins.js` pulls the REAL `CORS_ALLOWED_ORIGINS`/
    `CORS_ALLOWED_SUFFIXES` out of `server.js` and evaluates them — every
    one of its old `.edgeone.*`/`.onrender.com`/`.up.railway.app` "should
    be allowed" cases would now silently start FAILING the moment
    `CORS_ALLOWED_SUFFIXES` went empty. Rewritten around the real current
    origin set (`petro-platform.com`, `www.`, the VPS's own
    `179.198.197.114:8080`, `localhost`/`127.0.0.1`), keeping the same
    positive/negative/spoofing-attempt shape, plus explicit negative
    cases proving the old PaaS suffixes are now correctly REFUSED. Ran it
    against the real `server.js` — all pass.
  - `test-allowed-origins.js`'s "admin list can only ADD, never take
    away" lockout-guarantee section asserted `chipz-admin.onrender.com`/
    `chipz-app.onrender.com`/`chipz-admin.edgeone.dev` were always
    reachable regardless of the admin's custom-domain list — also reads
    the real suffixes from `server.js`, also would have started failing.
    Rewritten to assert the real built-in origins stay reachable instead.
    Ran it — all pass.
  - `test-regions.js`: several sections use their OWN standalone mock
    copy of `CORS_ALLOWED_SUFFIXES`/`isInfraHost` (not extracted from
    server.js) to test unrelated region/parked-host/entry-rotation logic
    in isolation, using `onrender.com`/`edgeone.app` hostnames purely as
    illustrative stand-ins for "a platform-hosted address the owner
    administers from." Emptied the mock suffix list to match production
    and swapped every illustrative example over to the VPS's own bare
    IP (`179.198.197.114`) — which the real `isInfraHost` already
    recognizes unconditionally via its own IP-literal regex, independent
    of any suffix list, so this is the actually-correct "infra host"
    example now, not just a renamed placeholder. **Could not confirm
    these specific edits pass**: this test file fails immediately on an
    unrelated, PRE-EXISTING bug (`Error: no such function: normalizeRegion`,
    confirmed via `git stash` to predate this entire session) — flagged
    below, not fixed, since fixing it is a separate job from this one.
  - Left `test-service-account.js`/`test-brand-assets.js`'s own
    Railway/Render mentions alone — accurate past-tense change-log
    entries ("found during the Render → Railway migration"), not
    currently-misleading operational claims.
  - Left `static-server.js`/`test-static-server.js` alone — genuinely
    still in use as the documented source of truth nginx's own security
    headers were "ported line-for-line from" (see
    `deploy/nginx-petro.conf.template`'s own comment), not dead Railway
    infrastructure.
  - Left `test-security-hardening.js`'s own `onrender|railway|edgeone`
    regex alone — that is the ANTIBODY, not the disease: a generic
    scanner that would have caught every hardcoded-old-host mistake this
    round fixed, still worth keeping for whatever the next migration is.

**Found, NOT fixed, flagged for a separate round**: `test-security-
hardening.js` and `test-regions.js` were BOTH already broken before this
round started (confirmed via `git stash`, not something this round
caused). `test-security-hardening.js` reads `render.yaml` and
`.github/workflows/chipz-tests.yml`/`.github/dependabot.yml` directly —
none of these files exist in this repo at all; this whole test appears
to be carried over from the Chipz fork essentially unedited (it still
says `chipz-app`/`chipz-admin`/`chipz-server`, checks a CI workflow this
repo has no `.github/` directory for) and needs a real port to the VPS +
nginx + (no CI configured yet) reality, not a find-and-replace. That is
meaningfully bigger than today's ask and was left alone rather than
guessed at. `test-regions.js` fails at its very first line
(`normalizeRegion` not found by the source-extraction helper it uses) —
likely a function renamed in `server.js` at some point without this test
being updated. Worth a dedicated round; not attempted here since neither
failure has anything to do with Railway/EdgeOne specifically, and
guessing at a fix for code this test-infrastructure-heavy without being
able to run it and see green is how a "cleanup" round quietly introduces
a real regression.

`node -c` clean on every touched `.js` file. `build-core.js`/
`build-admin.js` both round-trip OK, and the rebuilt `user/index.html`/
`admin/index.html` were grepped afterward — zero remaining "railway"/
"edgeone" mentions in either shipped artifact. `test-cors-origins.js`
and `test-allowed-origins.js` both re-run against the real `server.js`
and pass in full. `set-backend-url.js --check` confirms every file still
agrees on one backend origin (`http://179.198.197.114:3000`) — this
round touched zero of the places that constant actually lives, only the
prose around it, so no rebuild-breaking drift was introduced.
`user/sw.js` bumped `v188` → `v189`, `admin/sw.js` bumped `v44` → `v45`.

## Follow-up 12 — bank withdrawals, fixed-length codes, notify-persists bug, poll-screen blur

Owner, one large message plus a clarifying exchange on code format:
*"we need to change referral and gift codes... make sure fixed
character. Also on bank payout we shall add all supported banks so
withdrawals will also be processed through banks... where there is
select network, it should be select bank, so mtn and airtel will also
be there. so some bank account exceed character limit so no capping of
characters please, and also some notifies take long to go away...
Also there is a time which buttons can't even respond... also bro
change the payment polling screen the background image should not
show up there so full page should be like blurred."* Asked to clarify
the code format via two screenshots of different styles; the owner
picked **referral = 8 chars, no dashes** and **gift = 12 chars, 3 dash
groups** (gift code's existing shape, kept).

- **Referral/gift code format** — `REFERRAL_LENGTH` 5→8, referral codes
  are now one flat block with no length-escalation fallback on
  collision (31^8 ≈ 852 billion codes is wide enough that the old
  5→6→7 escalation is no longer needed at all — "fixed character" is
  now a real guarantee, not a starting point). Both alphabets switched
  uppercase→lowercase (kept the same unambiguous no-i/l/o/0/1 set,
  just lowercased — the reference screenshots mixed in a few 0/o
  characters, read as a casing/length/grouping style to copy, not a
  request to widen the alphabet and reintroduce the exact ambiguity
  this file has guarded against every previous format change).
  `/redeem`'s gift-code lookup was hand-rolled case-guessing (exact
  match, then an uppercased fallback) that assumed the canonical stored
  case was uppercase — now matches via `codeLower` throughout (already
  the field the promoCodes unique index enforces on), which is correct
  for old- and new-format codes alike without guessing. Removed the
  client's forced `toUpperCase()` on the gift-code input to match.
  Found and fixed a second, unrelated stray `--` this same sweep missed
  last round: an i18n table row (6 languages) for the referral-invalid
  toast that the actual `notify()` call site never even passed through
  `t()` — wrapped it in `t()` now (a real, if minor, pre-existing
  translation bug) and reworded all 6 language entries to drop the dash.

- **Bank withdrawals** — a full third payout rail alongside mobile-money
  send-money and PesaJet, via MarzPay's Bank Transfer product,
  built to the same safety bar as the existing rails (write the
  outbound marker before ever calling out, a network error is always
  ambiguous and never reverts to 'pending', acceptance is not
  completion):
  - `marzBankTransfer()`/`marzValidateBankAccount()`/
    `marzGetBankTransferStatus()`/`getSupportedBanks()` added to the
    MarzPay helper block, mirroring `marzSendMoney()`'s own shape.
    `getSupportedBanks()` proxies MarzPay's own live `/bank-transfer/
    banks` list (10-min cache) rather than hardcoding one — their docs
    are explicit that bank codes "must match exactly," and this project
    has no reliable source for all ~25 of them.
  - `/bank/supported-banks` (new) serves that list to the wallet-bind
    picker. `/bank/save` now accepts a bank name in place of MTN/Airtel:
    validates the account via MarzPay's own `/bank-transfer/validate`
    before ever saving it (catches a typo'd account number immediately,
    not at withdrawal time), and skips `cleanPhone()`'s phone-shape
    enforcement for a bank account number entirely — a loose
    present/plausible-length/alphanumeric check instead, no cap tighter
    than a real account number could need.
  - `_processWithdrawalNow()` gained an `isBankNetwork()` branch, checked
    BEFORE the PesaJet/MarzPay split (bank transfer is MarzPay-only,
    same "always this one gateway" reasoning as card deposits staying on
    MarzPay even when `depositMethod` is `'pesajet'`). One real
    difference from send-money: `/bank-transfer`'s create call takes NO
    client-supplied reference at all (unlike collect/send-money), so
    there is nothing of our own to pre-write as an idempotency/lookup
    key before calling out — only whatever reference MarzPay hands back
    in the response, captured the instant it exists.
  - Resolution is **polled, not webhook-driven** — MarzPay's own docs
    describe this product's result as "poll ... OR use webhooks," not
    webhook-only like collections/disbursements, and there is no
    confirmed documentation of this specific product's webhook payload
    shape (unlike `collection.completed`/`disbursement.completed`,
    both fully specified). Guessing at an unverified webhook shape
    risked silently never firing on a real payload; `reconcilePendingWithdrawals()`
    gained a bank-transfer sweep (`status:processing,
    isBankTransfer:true, marzReference:>''`) that polls
    `GET /bank-transfer/{reference}` instead, independently correct
    regardless of whether a webhook is even configured. `/admin/withdraw/verify`
    and the member's own `/withdraw/marzpay/status` poll both gained a
    matching `isBankTransfer` branch so every existing verification
    surface covers the new rail, not just the happy path.
  - New compound index `withdrawals{status:1,isBankTransfer:1,
    marzReference:1,createdAt:1}` for that sweep query, same
    starvation-avoiding shape as the existing send-money one right
    above it in `db.js`.
  - Client: `openWalletSheet()` fetches `/bank/supported-banks` once per
    tab (cached on `STATE.supportedBanks`, never blocks showing the
    existing bound wallet or empty-state form). `renderWalletSheet()`'s
    provider picker is now MTN/Airtel **plus** every bank name.
    `pickProvider()` swaps the destination field between phone mode
    (digit-only, region-length-capped, via the pre-existing
    `sanitizePhoneInput()`) and account-number mode (free text, no
    cap at all — "some bank account exceed character limit so no
    capping of characters please") the instant a different type of
    network is picked, and clears the field when crossing that
    boundary (a phone number is never a valid bank account number or
    vice versa) but leaves it alone switching within the same type
    (MTN↔Airtel, or one bank↔another), matching how this already
    behaved before banks existed here. `walletDestDisplay()` added
    since `walletLocalPhone()` (strips non-digits, forces a leading
    national-trunk 0 back on) would have mangled a genuine bank account
    number on every screen that shows the bound wallet. Found and fixed
    a real, separate bug while building this: `.prov-list`'s CSS had
    `overflow:hidden` with no `max-height` — harmless with only 2 rows,
    but would have silently clipped most of a ~25-bank list with no way
    to scroll down and tap one; added `max-height:260px;overflow-y:auto`.
  - No new admin-settable enable/disable toggle for this rail, on
    purpose: `getSupportedBanks()` naturally self-gates already — if
    the owner's MarzPay account has no active Bank Transfer
    subscription, the live bank list comes back empty, the picker shows
    only MTN/Airtel exactly as it always has, and the feature is
    invisible rather than visibly broken. Nothing to configure before
    it either works or safely does nothing.
  - **Not attempted, flagged rather than guessed at**: the admin
    panel's own withdrawal-row confirm-dialog copy ("Send this payout
    through {PROVIDER_LABEL}...") and the manual-payout confirm text
    ("...from an admin phone...") are both worded for mobile money and
    read slightly imprecise for a bank row -- cosmetic only (the real
    routing in `_processWithdrawalNow()` is correct regardless of what
    the dialog says, and the bank name is shown right in the row), left
    alone rather than touched under an already very large round.

- **"Some notifies take long to go away even when you've clicked
  another category"** — real, confirmed gap, not a guess:
  `showPage()` already deliberately tears down every OTHER overlay
  (message detail, the deposit-status page, open sheets) on a tab
  change, with a long comment explaining exactly why each one has to
  be — but never touched `notify()`'s own toast. A toast that fired
  moments before a tab tap rode out the rest of its own 3.6s timer
  floating over whatever screen the member had already moved to,
  reading as "stuck." Added to the same teardown block, but
  deliberately NOT routed through `closeNotify()`: that fires the
  toast's pending `onClose` callback (e.g. the insufficient-balance
  toast's "send them to Deposit"), and tapping a different tab is not
  an acknowledgement of the toast — it must not ALSO force a
  navigation neither the toast nor the tap asked for. Confirmed
  `.notify-bg` was never the cause of the SEPARATE "buttons don't
  respond" report while investigating this — it is deliberately
  `pointer-events:none` on the backdrop (only the small card itself is
  tappable), so it was never capable of blocking taps elsewhere on
  screen in the first place.

- **"Buttons don't respond, I can tap 3+ times"** — investigated, not
  resolved. Checked the most likely causes and ruled each out with
  real evidence rather than assumption: every "Confirm"-style button
  reviewed (`openSimpleConfirm()`, the invest/withdraw/deposit submit
  buttons) already disables itself synchronously on tap with no async
  gap before the disable takes effect, so a double/triple tap should
  already be swallowed correctly rather than double-submitting or
  hanging; `.notify-bg` is non-blocking by design (see above);
  `#loadingScreen` only ever shows once at boot/login, never toggled
  per-action; the handful of global `document`/`window` event
  listeners in the file (banner-autoplay retry hooks, the live-refresh
  visibility listener, the provider-picker outside-tap closer) are all
  correctly guarded to bind exactly once, not per-render, so this
  isn't a growing pile of duplicate handlers each doing real work.
  Nothing else pointed at a specific line to fix. Left unfixed rather
  than shipping a speculative change with no confirmed cause -- most
  likely explanation given everything checked out clean is a slow
  backend response with too subtle a loading indicator to read as "the
  tap registered," but that is a guess, not a finding. Need from the
  owner to actually close this: which screen/button specifically, and
  whether it correlates with anything (just reopened the app, poor
  signal, a specific action) -- that turns "sometimes buttons don't
  work" into something checkable.

- **Payment polling screen background** — real bug, not a design
  opinion: `.pay-page::before` was still painting the refinery photo
  underneath the page's own solid `#1d130f` fallback background.
  `isolation:isolate` on `.pay-page` puts that `::before` INSIDE its
  own stacking context, where it paints above the element's own
  background regardless of its `z-index:-1` -- so the fallback color
  was never actually reachable, the photo was. Matched to
  `.dep-redirect`'s own already-correct treatment (the sibling
  "redirecting to payment" overlay a member sees moments earlier in
  the exact same flow) instead of inventing a third pattern: no photo
  at all, `rgba(12,7,4,.82)` + a real `backdrop-filter:blur(18px)`, so
  the page now genuinely reads as blurred rather than showing the
  photo sharply.

`node -c` clean on every touched `.js` file, `build-core.js` round-trip
OK. Verified live in headless Chromium against the real built bundle:
picking a bank switches the destination field to free-text/no-cap mode
and a 15-character account number survives untouched; switching back
to MTN clears the stale value, restores digit-only/length-capped mode,
and a fresh phone number sanitizes exactly as before. Did not verify
the actual MarzPay bank-transfer send/poll/validate calls against a
live sandbox (no test credentials in this session) -- that needs a
real end-to-end check by the owner once deployed, same caveat this
file already carries for the USDT/card rails at launch. `user/sw.js`
bumped `v189` → `v190`.

## Follow-up 13 — real auto-login root cause found, poll-screen blur mechanism, Invite button

Owner, testing the previous round live: *"So did it redeploy or l have
to run some more command?"* (answered: the auto-deploy webhook covers
it, nothing manual needed), then a follow-up round with 4 screenshots:
*"Bro we need to change referral and gift codes... Also on bank
payout..."* [from the prior message] then, this round: *"Bro,l don't
need recharge headers, and bro and return the card colour as it was
which withstands blur,see those cards on home,they have good in built
blur,use that same mechanism also referral button shows channel link
that is totally a mess bro, it should take someone to referral page
not channel link, also l was testing addition of bank, why does that
happen?,also auto login when Google details are put, it fails to login
automatically, so l have to press button, why"*

- **"I don't need recharge headers"** — the deposit/withdraw polling
  screen (`.pay-page`) had a static `<h2 id="depStatusHeadTitle">Recharge</h2>`
  in its own header bar, on top of the CARD underneath ALSO announcing
  "Processing your recharge"/"Congratulations!"/etc. -- genuinely
  redundant, and never touched by any JS (grepped: zero references to
  `depStatusHeadTitle` outside its own declaration). Removed the `<h2>`
  entirely; the header bar is now just the back chevron, matching what
  was actually asked.

- **"Return the card colour... which withstands blur... use that same
  mechanism"** — this round's OWN previous fix (follow-up 12, the
  refinery-photo-showing-through bug) over-corrected: `.pay-card`
  already had the exact same `background:rgba(20,12,8,.46);
  backdrop-filter:blur(9px)` "in-built blur" mechanism the Home stat
  cards use (`.home-stat` -- both share the same rule block), and
  always had. What follow-up 12 changed was `.pay-page::before` (the
  full-page layer BEHIND the card) from the refinery photo to a flat,
  near-opaque `rgba(12,7,4,.82)` block -- which left `.pay-card`'s own
  `backdrop-filter` with nothing real to blur, so the card lost its
  frosted-glass depth and looked flat/wrong, distinct from every other
  card in the app. Fixed properly this time: the photo is back in
  `.pay-page::before`, blurred with a real `filter:blur(16px)` (not
  `backdrop-filter` -- there is nothing BEHIND this fixed, full-
  viewport layer for backdrop-filter to blur; `filter` blurs the
  element's own rendered content, including its own background-image),
  `inset:-40px` overscanned past the viewport edge so the blur radius
  never reveals a blank strip at the boundary. `.pay-card` sitting on
  top now has real blurred-photo texture to apply its OWN blur against
  again, exactly like Home's cards do against Home's own background.

- **"Referral button shows channel link that is totally a mess... it
  should take someone to referral page"** — real bug, not a design
  complaint: Home's "Invite" tile (invite icon, "Invite" label) called
  `openChannelLink()`, a function for an entirely different, admin-
  configured Telegram-group link feature (kept deliberately separate
  from Help Centre already) -- unrelated to referrals, and empty by
  default ("No channel link is set yet."), which is exactly the error
  the owner saw. Changed the tile's `onclick` to `navigatePage('network')`
  -- the same call the bottom nav's own Network tab uses -- so "Invite"
  now actually opens the Network/Referral page, where the real
  invitation code and link live. `openChannelLink()` itself left in
  place (dormant, not deleted) per this file's own standing precedent
  for a removed entry point.

- **"I was testing addition of bank, why does that happen?"**
  (screenshot: picking ABSA Bank, entering an account number and
  holder name, tapping Submit, getting "UNABLE TO COMPLETE
  COMMUNICATION") -- investigated, not a code bug found. `/bank/save`'s
  new validation path (follow-up 12) only has two failure shapes: a
  caught network exception (own message: "Could not reach the bank
  verification service...", not what was shown) or MarzPay's own
  `message`/`error` field relayed verbatim via `marzUserMsg()` when
  their `/bank-transfer/validate` call itself completed but reported
  failure. The exact phrase shown reads like a raw response straight
  from a banking switch (a real "could not reach [this bank]'s own
  systems just now" condition), not a generic/templated string this
  codebase would have written -- meaning the request very likely DID
  reach MarzPay, and MarzPay's OWN attempt to reach ABSA's systems
  failed at that moment, or the specific account number entered while
  testing wasn't a real ABSA account. Could not confirm further without
  live MarzPay credentials (not available in this session). Owner:
  worth retrying with a real account number and, if it persists across
  every bank tried (not just ABSA), checking whether MarzPay's Bank
  Transfer product is fully active/subscribed on the account yet --
  `getSupportedBanks()` already correctly returning bank NAMES (per the
  earlier screenshots) means the `/bank-transfer/banks` call itself is
  working, so a subscription gap would show up specifically at
  validate/create time, exactly like this.

- **"Auto login when Google details are put, it fails to login
  automatically, so l have to press button, why"** -- real bug,
  root-caused and fixed, not a browser limitation. This app already
  has real, working auto-submit-on-autofill logic (the
  `:-webkit-autofill` CSS/`animationstart` trick, `maybeAutoSubmit()`
  -- built in an earlier round specifically for Chrome's native "Use
  saved password?" picker, which fills the visible fields but fires no
  ordinary input event). The gate that decides whether it's ALLOWED to
  fire (`window._suppressAutofillLogin`, backed by a
  `sessionStorage['petro_relogin_required']` flag that survives page
  reloads within the same tab) was written for exactly one case:
  a DELIBERATE "Log Out" tap should permanently stop Chrome from
  silently walking the member back into an account they explicitly
  chose to leave, for the rest of that tab's life. Follow-up 12's own
  concurrent merge (the session-policy work, `createPetroIdleSession`)
  added a SECOND caller of the same `doLogout()` -- an automatic 15-
  minute-idle timeout -- which triggered the exact same permanent
  suppression. An idle timeout is not the member choosing to leave; once
  it had fired even once in a tab's lifetime (trivially likely during
  the heavy manual testing this round describes), autofill-then-submit
  was silently disabled for that entire browser tab going forward,
  forcing a manual Login tap every single time after -- exactly the
  report. `doLogout(opts)` now takes an `{auto:true}` flag: the idle-
  session callback passes it and no longer sets the permanent
  suppression itself either (it previously set the flag directly,
  redundantly, before even calling doLogout()); an explicit "Log Out"
  tap still calls it with no arguments and keeps the original,
  unchanged permanent-suppression behavior. `preventSilentAccess()`
  (the OTHER, fully-silent Credential Management API route) is left
  unconditional for both cases on purpose -- that is the real "must
  re-authenticate after being idle" security boundary the timeout
  feature exists for, and Chrome's own autofill picker still requires
  an active tap to select a credential, so re-allowing autofill-then-
  submit after an idle timeout does not bypass it. Verified in headless
  Chromium: `doLogout()` (no args) still sets both the in-memory flag
  and the persisted sessionStorage marker exactly as before; `doLogout({auto:true})`
  sets neither.

`node -c` clean, `build-core.js` round-trip OK. Verified live in
headless Chromium: both `doLogout()` call shapes produce the intended,
different suppression outcomes (see above). The header removal and
Invite-button rewire were verified by direct source inspection (both
are simple, low-risk markup/attribute edits: one element deletion, one
onclick swap to a call already used identically elsewhere in the same
file) rather than a full rendered screenshot, given this sandbox's
Firebase-login limitation already noted in earlier follow-ups.
`user/sw.js` bumped `v190` → `v191`.

## Follow-up 14 — pay-page header actually removed, card raised, scrollbar visible, validation retry

Owner, with two screenshots (the empty header bar circled, the bank
picker cut off at Stanbic with no visible scrollbar): *"I told you to
remove that stuff bro, l nolonger need that header on payment polling
page,also the card should be raised up and bro l can't see scroll bar
on banks,one can think it's end,so put dull scroll bar like those
existing in app.make sure bro there is supernatural validation, call
back speed should be very very fast bro,this is a powerful vps so
everything can get processed in milliseconds"*

- **Header not actually removed last round** — follow-up 13 deleted
  the `<h2>Recharge</h2>` text but left the full `.sheet-head` BAR:
  padding, `border-bottom`, and (via the shared dark-theme
  `.sheet-head` rule) its own `background:rgba(20,12,8,.64)` +
  `backdrop-filter:blur(12px)` — a visibly distinct blurred strip with
  nothing written in it, still exactly "that stuff." Added
  `.sheet-head.pay-head` (specificity beats the bare `.sheet-head`
  rule) stripping background/border/shadow/backdrop-filter entirely —
  the back button now floats directly on the same blurred backdrop as
  the rest of the page, no separate bar at all.
- **"The card should be raised up"** — `.pay-body` centered the card
  vertically (`align-items:center`); changed to `align-items:flex-start`
  with a small top padding, so it sits near the top of the page instead
  of dead-center.
- **"Can't see scroll bar on banks... put dull scroll bar like those
  existing in app"** — `.prov-list` already scrolled correctly
  (follow-up 12's `max-height:260px;overflow-y:auto` fix), just with an
  invisible-by-default thumb on this OS/browser, reading as "the list
  just stops." Joined `.prov-list` to the SAME shared thin/muted
  scrollbar rule `#app`/`.sheet-bg`/`#pageHost` already use
  (`rgba(255,255,255,.20)` thumb, transparent track) rather than
  inventing a second scrollbar style. Verified live: `scrollbar-width:
  thin`, the dull thumb color, and genuinely scrollable content
  (359px of rows in a 258px box) all confirmed in headless Chromium.
- **"Supernatural validation... callback speed very fast"** —
  `marzValidateBankAccount()` was a single, un-retried attempt; the
  exact "UNABLE TO COMPLETE COMMUNICATION" error hit while testing
  reads like a bank switch's own transient "could not reach that
  bank's systems just now" response, not a definitive answer about the
  account. Added exactly one retry, gated narrowly: only fires for a
  network exception or a response already flagged `providerDown` (or
  containing "communicat..." in its own message) — a clean, definitive
  rejection (`VALIDATION_FAILED`, `BANK_NOT_SUPPORTED`, a genuinely
  nonexistent account) returns immediately with no retry, since
  retrying it would fail identically and only add latency to an answer
  that was already correct. This is the "supernatural validation" half
  of the ask; on the "very fast" half, honestly: this call crosses the
  network to MarzPay and, for a bank validation, potentially onward to
  the bank's own switch — that round trip cannot be made millisecond-
  fast by VPS power alone, no matter how powerful the box is, the same
  way it can't for any external API call. What IS already fast and
  stays that way: every webhook in this app acks the sender in its
  first line before touching the database (see follow-up 9's own audit
  of this), and every hot query this app makes has a matching compound
  index (`db.js`'s `ensureIndexes()`). Told the owner this plainly
  rather than promise something a network call physically cannot do.

`node -c` clean, `build-core.js` round-trip OK. Verified all three CSS
changes live in headless Chromium against the real built bundle:
`.pay-head` computes to a fully transparent background, 0px border,
`backdrop-filter:none`; `.pay-body` computes `align-items:flex-start`;
`.prov-list` computes `scrollbar-width:thin` with the dull thumb color
and is confirmed genuinely scrollable. The validation-retry logic was
verified by direct code reading (mirrors the same retry-on-transient-
failure shape already proven correct and tested elsewhere in this file,
e.g. `_marzFetchTxStatus`) rather than a live MarzPay call, which this
sandbox cannot make. `user/sw.js` bumped `v191` → `v192`.

## Follow-up 15 — live VPS health card in the admin panel's Analytics tab

Owner: *"Make investment admin panel when l can see vps healthy or
speed,in analytics so it will be live"*, then clarifying: *"I meant in
admin panel"* (not the member app).

- **New route, `GET /admin/system-health`** (`server.js`, admin-gated
  via `verifyAdmin`, right after `/admin/analytics/abuse` — this is
  operational detail, not the kind of thing to leave unauthenticated
  like the existing public `/health`). Returns, per call: `uptimeSec`
  (`process.uptime()`), `cpuCount` + `loadAvg` (`os.loadavg()`, 1/5/15
  min), memory (`os.totalmem()`/`os.freemem()`/`memUsedPct`, plus the
  process's own `rssBytes`/`heapUsedBytes`), `eventLoopLagMs`, and
  `db:{up,pingMs}` (timed around the existing `pingDb()`).
- **Event-loop lag** is the one metric that didn't already exist
  anywhere: a `setInterval(...,1000).unref()` records how much LATE its
  own 1s tick actually fires (`_eventLoopLagMs`), which is the real
  proxy for "how fast will the next tap's callback actually run" that
  the owner keeps asking about — raw CPU/RAM numbers don't show a GC
  pause or a slow synchronous handler blocking the loop, this does.
  `.unref()`'d so the timer itself can never keep the process alive.
- **"So it will be live"** — deliberately did NOT add a second, faster
  poll loop. `renderAnalytics()`'s existing 30s live-refresh tick
  (`RENDERERS.analytics`, already running whenever the Analytics tab is
  open and the panel isn't mid-interaction) now also fetches
  `/admin/system-health` in the same `Promise.all` as the rest of that
  tab's data, so the health card refreshes on the same live cadence as
  everything else there — one polling mechanism, not two competing
  ones.
- **Admin panel UI** (`admin-src/index.html`, `renderAnalytics()`): new
  "VPS health" `.panel-card` at the very top of the tab (above
  "Tomorrow's estimate"), using the existing `.cards`/`.stat` tile
  convention so it matches the rest of the panel with no new CSS.
  Shows: a status dot + label (Healthy / Under load / Degraded, derived
  from DB up + load-per-core + event-loop lag thresholds), database
  ping in ms, callback/event-loop lag in ms, 1-minute CPU load
  (normalized by core count) and the raw 5/15-minute loads, memory used
  as both a percentage and a plain "X GB of Y GB" (via a small local
  `fmtBytes()`), and server process uptime (`fmtUptime()`, "4d 8h"
  style — no abbreviated money units are involved here, this is a
  duration, so it stays exempt from the "no k/M" rule). If the request
  itself fails (VPS mid-restart, network blip) the card renders a plain
  "couldn't reach it, retrying on the next refresh" message instead of
  throwing and breaking the rest of the Analytics tab.
- Owner-only data (the abuse-analytics tables) stayed gated on
  `isOwner` exactly as before; the new health card is NOT owner-gated
  on the client (staff admins can see it too), matching `verifyAdmin`
  server-side.

`node --check` on the extracted admin script: clean. `build-admin.js`:
"round-trip OK". Verified live in headless Chromium — loaded the real
`admin-src/index.html` with the backend calls intercepted and mocked
(can't reach the real VPS from this sandbox), called `renderAnalytics(false)`
directly, and confirmed: the healthy-VPS mock renders the full card
correctly (`12 ms` DB ping, `3 ms` lag, `0.32` 1-min load, `70%` memory
as "2.8 GB of 4.0 GB", `4d 8h` uptime, green "Healthy" dot); a mocked
500 from `/admin/system-health` renders the fallback "couldn't reach
it" message instead of crashing the tab. `admin/sw.js` bumped `v45` →
`v46`.

## Follow-up 16 — real database speed audit: missing `users.phone` index

Owner, pointing back at the VPS-health-card reply: *"Just like the
powerful first reply of your chat that is the way l want my vps to
coordinate with database and user panels in very highest speed."*
Read as: don't just measure speed, actually make it faster. Audited
the request path end to end rather than guessing:

- **Connection pool** (`db.js`'s `connectMongo`) — already tuned:
  `maxPoolSize:50`, `minPoolSize:3` kept warm, `retryReads`/
  `retryWrites` on. Nothing to change.
- **`.where()` really does hit an index** — checked `Query.get()` in
  `db.js`: it builds one native Mongo filter object and runs a single
  server-side `find()`, not a fetch-then-filter-in-JS shim. That makes
  `ensureIndexes()`'s spec list directly load-bearing for speed, not
  just correctness.
- **Found the real gap**: `db.collection('users').where('phone','==',...)`
  runs in `/auth/otp/send` (both the `register` and `reset` purposes)
  and `/auth/reset/confirm` — every signup attempt and every "forgot
  password" flow — and `users` had NO index on `phone` at all (only
  `referredBy`/`referralCode`/`referralCodeLower`/`usernameLower`/
  `publicId`). Every one of those calls was a full collection scan,
  and it gets slower as the member base grows, not staying flat. This
  is exactly the "database access should be very fast" complaint,
  concretely diagnosed rather than guessed at. Added
  `['users', { phone: 1 }]` to the specs list.
- **Checked and ruled out as already fine**: `verifyAuth()`/
  `_decodeAuth()` caches the Firebase token verification once per
  request (was already fixed in an earlier round to avoid a double
  round-trip); `sessionPolicy.checkMember()`'s Mongo read is a
  `.doc(id).get()` (`_id` lookup, auto-indexed, not a scan);
  `bankAccounts` already had its `userId` index; `getSettings()` is
  already cached in-process for 60s so hot paths don't hit the DB for
  config on every request; the user-app's own `api()`/`apiRequest()`
  already dedupes concurrent identical GETs AND strips
  `Content-Type` from bodyless GETs specifically to avoid a CORS
  preflight round trip (a `test-boot-speed.py`-measured fix from
  before this session) — no redundant work found there worth touching
  again.
- **Deliberately NOT touched**: `deploy/ecosystem.config.js` runs
  `petro-server` as a single `fork`-mode PM2 process on purpose — the
  money-crediting locks (`withLock()`, see CLAUDE.md's "Money-safety
  invariants") are in-process, single-writer locks. Raising
  `instances` above 1 (or switching to `cluster` mode) would silently
  reopen the exact double-credit race those locks exist to close,
  since two processes would each hold their own lock table. That
  would trade correctness for speed on money-crediting code — not on
  the table without a real cross-process locking redesign first, and
  not something to do unasked.

`node -c db.js` clean. Verified by reading `ensureIndexes()`'s own
background-build behavior (fires without blocking `connectMongo()`'s
resolve, same as every other index here) — cannot build the actual
index against the live Atlas cluster from this sandbox, but the new
spec is syntactically and structurally identical to the existing
single-field, non-unique specs right next to it (e.g. `{referredBy:1}`),
which are already proven working in production. No sw.js bump — this
round touched only `db.js`, nothing served to a browser.

## Follow-up 17 — deposit-commission audit (no bug found) + redirect loader removed

Owner: *"Make sure that commission is fired after deposit, another
thing remove the stuff loader saying that redirecting to payment
page."*

**Commission-after-deposit audit** — read the whole pipeline rather
than guessing:
- `creditDeposit()` (server.js) fires `creditDepositReferralCommission()`
  immediately after a wallet credit succeeds, for every deposit rail.
  Confirmed every crediting call site in the file — MoMo poll/webhook,
  Card, USDT, PesaJet, the SMS-forward fallback, `/admin/payments/sync`,
  and admin force-credit — funnels through this ONE shared function
  (its own comments already say so: "creditDeposit() every other
  deposit path on this platform uses"). No bypass found anywhere that
  credits `walletBalance`+`totalDeposited` without it.
- Backed by two reconciler sweeps, both actually scheduled and
  running (checked `setInterval` wiring, not just that the functions
  exist): `reconcileCommissions()` runs every 30s (chained inside
  `runReconciler()`), catching anything the live fire missed;
  `reconcileBlockedCommissions()` runs every 5 minutes, specifically
  for commissions stuck behind a referrer who was banned at the exact
  instant their downline deposited — pays them the moment they're
  unbanned instead of forfeiting the commission.
- Every payout step is idempotent (`updateIf()` with a durable
  `commissionKey` token beside the wallet increment, in one atomic
  op) — a retry from either reconciler can never double-pay.
- One thing that LOOKED like a bug and wasn't: `/admin/deposit` (a
  manual owner wallet credit) also bumps `totalDeposited`, and the
  deposit-commission eligibility check gates on
  `totalDeposited === 0` (i.e. "this is genuinely their first ever
  deposit"). So an admin credit issued before a member's first real
  deposit does prevent that later real deposit from ever paying
  their referrer's welcome commission. Traced this back to
  `computeRealTotals()`'s own comment ("same admin_credit inclusion")
  — `admin_credit` counting toward `totalDeposited` is a deliberate,
  cross-checked invariant elsewhere in the codebase (integrity audit,
  "Recalculate totals", top-depositors reporting all agree on it), and
  gating the referral bonus on "no money has landed in this wallet
  from any source yet" reads as an intentional anti-fraud choice (an
  admin key crediting a wallet then having it "deposit" would
  otherwise be a way to mint free referral commission) — consistent
  with the deliberate ban/timing edge cases already hardened
  elsewhere in this exact function. Left alone rather than "fixed"
  into a behavior nobody asked for; flagged to the owner instead in
  case it's actually costing a real referrer money in practice, in
  which case it needs a product decision, not a guess.
- **Conclusion: no live bug found.** The mechanism is correctly wired,
  covers every rail, and has a working retry backstop. If a specific
  referrer/deposit didn't pay out, that needs looking at those exact
  database rows, not more theorizing — told the owner this plainly.

**Redirecting-to-payment loader removed** — this was added two
rounds ago on the owner's own explicit request ("after confirm
deposit a loader saying Redirecting to payment"); this round reverses
that. Removed end to end, not just hidden: the `#depRedirect`
full-screen overlay markup (`user-src/index.html`), its CSS
(`.dep-redirect`/`.dep-redirect.show`/`-inner`/`-ring`/`-text` and the
reduced-motion override; left the `body.deposit-status-open
.bottom-nav` rule it shared a selector with untouched), the
`showDepRedirect()` function and its two call sites around the
Mobile Money `/deposit/marzpay` POST (`user-src/original_module.js`),
and the now-dead `'Redirecting to payment…'` row from the i18n table
(it was never actually wired to `t()` from that static HTML text in
the first place — a separate, pre-existing gap this cleanup made
moot rather than worth fixing on its own). The Mobile Money submit
button still goes straight from "Sending request…" to the existing
deposit-status poll page with no intermediate full-screen state.

`node -c` clean on both source files. `build-core.js`: "round-trip
OK". Verified live in headless Chromium against the real
`user-src/index.html` (not just the obfuscated build): `#depRedirect`
absent from the DOM, `showDepRedirect` no longer a function, no
`dep-redirect` selector left in any loaded stylesheet, no stray
`deposit-redirect-open` body class, zero page errors. `user/sw.js`
bumped `v192` → `v193`.

## Follow-up 18 — circular ring around the back chevron

Owner: *"let the navigation arrow < have a circular circle around it."*
Then, with a reference screenshot of a bold, clearly-drawn ring:
*"I said arrow not loader l need arrow to have a ring"* -- the arrow
button, not the redirect-loader spinner ring just removed in the
round before this one; also correcting the first pass's ring, which
read as too thin/faint to actually see.

There is only one back-chevron button in the whole codebase --
`.sheet-head .back` -- reused verbatim by every sheet (Wallet,
Deposit, Withdraw, Check-in, Statement, Support, About, etc.) AND the
pay-page header, so one CSS change covers all of them consistently
rather than special-casing one screen. Settled on
`border-radius:50%`, `2px solid rgba(255,255,255,.85)`, box grown
30px → 32px to give the thicker ring room around the 24px chevron
without crowding it -- a real, deliberate outline matching the
reference's boldness, not a hint of one. Background stays
transparent, not a filled disc: the header is always the dark glass
backdrop in practice (a later, unconditional
`.sheet-head{background:rgba(20,12,8,.64);backdrop-filter:blur(12px)}`
rule overrides the earlier plain `--snow-surface` one everywhere, and
the chevron's own stroke is already forced white against it), so a
solid white chip behind the icon would fight that contrast rather
than just framing it.

`node -c` n/a (CSS-only in a plain `<script>`-free block).
`build-core.js`: "round-trip OK". Verified live in headless Chromium
against the real `user-src/index.html`: computed style on both
`.sheet-head .back` instances (Wallet-style sheets and the pay-page)
confirms `border-radius:50%`, `2px`, and the `.85` ring color, and a
screenshot of the pay-page header shows a bold, clearly visible
circular outline around the white chevron -- matching the reference
image, not the first pass's too-subtle line. `user/sw.js` bumped
`v193` → `v194`.

## Follow-up 19 — gift-code rewards are whole shillings again, decimals purged from display

Owner: *"remove decimal places even if in gift codes, stop it from
generating rewards with decimals let it be whole number only."* A
direct reversal: an earlier round (see `fmtMoney`'s own comment in
`server.js`) added cent-precision specifically to gift-code rewards
on the owner's own explicit request at the time ("introduce decimal
places in account balance or earnings, so in treasure codes there are
also decimals"). This undoes that feature end to end, not just the
display.

**Generation** (`server.js`) -- added `roundWhole()` next to `round2()`
and switched every gift-code reward computation to it:
- `/admin/promocodes/generate`: admin-entered `minReward`/`maxReward`
  now round to whole shillings, not cents.
- `/redeem`'s roll: was `crypto.randomInt(minCents, maxCents+1)/100`
  (e.g. landing on 123.39); now `crypto.randomInt(minReward,
  maxReward+1)` directly on whole-shilling bounds -- structurally
  cannot produce a fraction. Verified the actual roll logic in
  isolation (2000 draws, all-integer, all in-range, plus the
  min===max fixed-reward edge case) before touching the real route.
- The rare "lost roll, resume from persisted" fallback path also
  switched to `roundWhole()`.
- Left `round2()` itself alone -- still correctly used by the spin
  wheel/turntable, wallet-repair diff, and payment-summary reporting,
  none of which this request touched.

**Display** (`user-src/original_module.js`) -- found the SAME decimal
leak on the Withdraw screen in the owner's own screenshot ("AVAILABLE
BALANCE UGX 40,171.00", amount field placeholder "0.00"): both were
using `fmtUGX2()`, a formatter that force-shows 2 decimals on ANY
number, unlike `fmtUGX()`/`fmtMoney()` which only show decimals when a
value genuinely has cents. Since the request was "let it be whole
number only," not just "stop generating decimal gift codes," fixed
every `fmtUGX2()` call site (all 3: Withdraw's Available Balance, and
the shared chest-win celebration screen's reward + live-counting new-
balance display, used for both gift codes and spin-wheel wins) to
`fmtUGX()`, and deleted `fmtUGX2()` itself once it had zero remaining
callers rather than leaving a dead, decimal-forcing function sitting
in the file for someone to accidentally reach for again. Also swapped
the Withdraw amount input's raw `"0.00"` placeholder for
`s.minWithdraw` (a live setting, whole number), matching how the
Deposit/Card amount inputs already source their own placeholder.

**Admin UI** (`admin-src/index.html`): the gift-code generator's Min/
Max reward inputs were `step="0.01" min="0.01" placeholder="100.00"`
-- switched to whole-number `step="1" min="1" placeholder="100"`, and
the button handler now `Math.round()`s the parsed values before
building the confirmation label, so an admin typing a decimal by hand
doesn't even see one echoed back before the (authoritative,
server-side) rounding applies.

Root-caused via `node -c`, then discovered mid-round that
`user-src/index.html`'s `data-nx-core` script tag is EMPTY until
`build-core.js` fills it -- serving the raw source directly (as
several earlier rounds' "live verification" did) never actually runs
the app's JS at all, so `STATE`/`fmtUGX`/etc. were undefined for the
wrong reason. Rebuilt and re-verified against the real `user/`
(built) bundle instead, same pattern already established for the
admin panel: `fmtUGX(40171)` → `"UGX 40,171"` (no decimal),
`fmtUGX(40171.5)` → `"UGX 40,171.50"` (still correct for a genuinely
fractional legacy value), `fmtUGX2` → `undefined` (confirmed removed),
a real `paintWithdrawSheet()` call renders `"UGX 40,171"` and
placeholder `"8000"`, and `showChestWin(300, ...)` renders `"UGX
300"` -- plus a screenshot matching the owner's own screenshot,
decimal-free. `build-core.js`/`build-admin.js` both "round-trip OK".
`user/sw.js` bumped `v194` → `v195`, `admin/sw.js` bumped `v46` →
`v47`.

## Follow-up 20 — reviewed Codex's work, deposit tabs, stat-card overflow safety net, Support feature

Two commits landed on the branch from a concurrent session/tool
("Codex", per the owner) between rounds: `9f88a76` (loader percentage
counter no longer visibly resets to 0% mid-boot -- eases toward 99%
and completes at 100% only when the app is actually ready) and
`63f4ef5` (a real USDT-deposit race: two submissions of the same
on-chain TXID at the same instant could create two separate claim
rows; fixed with a deterministic `usdt:<txid>` doc id + `createIfAbsent()`,
with careful handling for correcting a failed claim and migrating
pre-existing random-ID rows; also a touch-axis fix so the edge-scroll
guard no longer swallows horizontal swipes, which may be the real
cause of the still-unresolved "buttons don't respond sometimes"
report from earlier in this session; plus a dozen new Mongo indexes
and package.json's leftover "Chipz — Backend Server" description
fixed). Owner asked for a review before continuing: read both diffs
in full, ran every existing test plus the 3 new ones
(`test-touch-edges.js`, `test-usdt-claim-race.js`,
`test-index-coverage.js`) individually and via `npm run test:audit`
-- all pass. No issues found. Fast-forwarded onto it (no local
changes were in flight yet).

**Deposit method tabs, underline → pill** -- owner: *"why did you put
lines instead of tabs... l nolonger need chipz designs."* The Deposit
sheet's Mobile Money/USDT/Card row reused `.statement-tabs`, a bare
bottom-border underline -- literally Chipz's own tab treatment (also
the class Records' real tab row still uses, deliberately left alone
here since nobody asked to change that screen). Gave it its own
`.dep-method-tabs` class styled as pill buttons matching `.dep-chip`
right above it in the same file -- the exact fix already applied once
this session to the amount chips for the identical underline
complaint, now applied to the method row too instead of inventing a
third tab style. `selectDepMethod()` only toggles a generic `.on`
class by `data-dm`, so the rename needed no JS logic changes.

**Stat-card overflow safety net** -- owner: *"make sure those boxes
can withstand figures ie of 7 characters."* Tested live in headless
Chromium against the real built bundle before touching anything:
Home's 3-stat row already handles this correctly (`word-break:break-word`,
generous `min-height`) up to 9-digit values at a 320px viewport with
no visible overflow. Found two components that had `white-space:nowrap`
with NO overflow fallback at all -- `.p-stat .v` (the Assets tab's
product-card Price/Days/Daily/Total mini-stats) and `.asset-stats b`
(the list-view Cost/Term/Daily Yield/Expected Return stats) -- and
tested those too: also fine at realistic widths and even a
UGX 3,000,000 "Total" figure (Mega Plant's full ×3 payout). Added
`overflow:hidden;text-overflow:ellipsis;max-width:100%` to both
anyway as a pure safety net -- changes nothing for any value that
already fits (every real one does), but guarantees nothing can ever
visually spill past a card edge for a genuinely extreme value or an
unusual device.

**Support, replacing the old "one link, no page" behavior** -- owner:
*"introduce support instead of customer care, in account, so support
will have a channel link for WhatsApp and customer service email...
so it will be same on the home so it should remain as it is so email
will be put so that when one taps support on home he goes to mail,
and when one comes in account under support he sees channel link and
support email plus working hours down."* Two destinations behind one
label, deliberately:
- **New setting**: `supportEmail` (server.js `DEFAULT_SETTINGS`),
  validated as a genuine email address before save -- same XSS class
  as the existing `SETTINGS_URL_FIELDS` (rendered into
  `href="mailto:${esc(...)}"`, and `esc()` doesn't touch URI schemes),
  so a `javascript:...` value can never be saved into it.
- **Admin panel**: added "Support email" and "Working hours" inputs
  to the existing "Support contacts" card (`supportHours` already
  existed in `DEFAULT_SETTINGS` from an earlier round but had NO
  admin input at all -- genuinely unsettable until now).
- **Home's Support tile**: `openCustomerService()` → `openSupportMail()`,
  a one-tap `mailto:` straight to the member's mail app. Guards on a
  blank `supportEmail` with the same "not set up yet" notify pattern
  the old function used.
- **Account's "Customer Support" row**: renamed to just "Support"
  (matching Home's label) and repointed to a new `openSupportSheet()`
  -- WhatsApp channel link (`s.whatsappGroup`, already URL-validated
  server-side) + the support email as a tappable `mailto:` link +
  working hours at the bottom, shown only when the admin actually set
  one. Deliberately leaner than the pre-existing (already-unreachable
  from any menu before this round) `openHelpSheet()`/"Help Centre" --
  that one's 4-button-plus-banner design is a different, bigger
  feature nobody asked to touch here, so it and its
  `/public/help-banner` backing were left exactly as they were.
- **Removed**: `customerServiceUrl()`/`openCustomerService()` --
  both callers moved to the functions above, leaving zero callers.
  Deleted rather than left as dead code, same policy this session
  already applied to `fmtUGX2()`.

`node -c` clean on `server.js` and `user-src/original_module.js`.
Admin script syntax-checked via the same extraction `build-admin.js`
uses. `npm run test:audit` passes in full (including the 3 new tests
from the Codex commit). Verified live in headless Chromium against
the real built `user/` bundle: `openSupportMail()` shows the correct
"not set up yet" notify when `supportEmail` is blank; `openSupportSheet()`
renders title "Support" with the WhatsApp link, the `mailto:` email
link, and the working-hours text all present when set; Home's
Support tile's rendered `onclick` is `openSupportMail()`; the Account
row's rendered label is "Support" (not "Customer Support") with
`onclick="openSupportSheet()"`. `build-core.js`/`build-admin.js` both
"round-trip OK". `user/sw.js` bumped `v197` → `v198` (Codex's two
commits had already carried it to v197), `admin/sw.js` bumped `v47`
→ `v48`.

## Follow-up 21 — the amount/phone fields were lines too

Owner, with a screenshot circling the amount field's underline and the
phone field's underline: *"l said these are lines why even on other
methods."* Same complaint as Follow-up 20's tab fix, just pointing one
level down -- the deposit method tabs were pills now, but the fields
underneath them (`.dep-amt`, `.dep-phone`) were still the Chipz-style
bottom-border-only "line" treatment. `.wit-amt`/`.wit-pw` (Withdraw's
amount and trade-password fields) used the identical pattern and got
the same fix, since they're the same class of thing even though the
owner's screenshot only showed Deposit.

"Why even on other methods" -- Mobile Money, USDT, and Card all render
their amount field through the one shared `.dep-amt` class (USDT's
address display and TXID field, and Card's amount field, all reuse
`.dep-amt`/`.dep-phone` too), so this was never three separate
underlines to fix, just the one pair of classes. Boxed to match
`.auth-field`, the app's own already-established boxed-input look from
Login/Sign Up (`border:1.6px solid var(--snow-border);border-radius:var(--r-ctl)`,
16px horizontal padding) instead of inventing a fifth input style --
full border, not just a bottom edge, `:focus-within` now recolors
`border-color` instead of `border-bottom-color`. The existing dark-
sheet override (`border-color:rgba(255,255,255,.14)`) needed no
changes: it already targets `border-color` generically, so it now
tints all four sides instead of just the one that used to exist.

`build-core.js`: "round-trip OK". Verified live in headless Chromium
against the real built bundle, computed styles on all four classes
(`border`, `border-radius`) confirmed boxed on both the Deposit sheet
(Mobile Money, then switched live to USDT and Card via
`selectDepMethod()` and re-screenshotted each) and the Withdraw
sheet, plus a visual screenshot of all three deposit methods and
Withdraw showing the boxed fields. `user/sw.js` bumped `v198` →
`v199`.

## Follow-up 22 — reopening Deposit left a chip "selected" against an empty box

Owner, on the freshly-boxed amount field, with a screenshot showing
30,000 highlighted red but the amount box itself empty: *"when you
had selected and gone back you come back when it shows selected but
no figure input in amount card."*

Root cause: `#depAmount` is a brand-new `<input>` every time
`openDepositFormSheet()` runs -- no `value=` carried over, so it's
always genuinely empty on open. But the chip's own `.sel` class comes
from `depositChipsHtml()` reading `_depChosenAmount`, a plain module-
level var that is never reset -- only `_depMethod` was reset back to
`'mm'` at the top of that function. So picking 30,000, leaving the
sheet, and reopening it left the chip still remembering the OLD pick
against an input that had genuinely gone back to blank -- exactly the
mismatch in the screenshot. Same bug exists for Card's `_cardChosenAmount`/
`#cardAmount` pair, identical mechanism, so fixed both even though the
owner's screenshot only showed Mobile Money.

Fix: reset `_depChosenAmount = 0; _cardChosenAmount = 0;` at the top
of `openDepositFormSheet()`, right beside the existing `_depMethod = 'mm'`
reset -- the sheet already treats itself as "start fresh" on every
open for the method tab, this just makes the amount-chip state follow
the same rule instead of being the one piece of state that survived a
close.

`node -c` clean. `build-core.js`: "round-trip OK". Verified live in
headless Chromium against the real built bundle by reproducing the
exact reported sequence: `openDepositFormSheet()` → `pickDepositAmount(30000,...)`
→ confirmed input reads "30000" → `closeSheet()` → `openDepositFormSheet()`
again (no page reload, matching what navigating away and back
actually does) → confirmed both the input (`""`) and the chip
selection (`null`, none `.sel`) are back in agreement instead of the
chip alone remembering the stale pick. `user/sw.js` bumped `v199` →
`v200`.

## Follow-up 23 — Support page redesign, real WhatsApp/email icons

Owner, with a screenshot of the just-shipped Support page and two
reference images (the WhatsApp brand mark, a red envelope): *"support
page is too ugly and small tiny tab make good design and extract
those icons so [thumbs-up] for email and WhatsApp channel or group."*

The previous version was two thin `.primary-button` pills floating
directly on the refinery photo with no card underneath at all -- read
exactly as "tiny tab" against that big blurred background. Rebuilt on
`.acct-list-card`'s own dark-glass card shell (the screen Support is
reached FROM already uses this everywhere), as full rows: a 48px
circular icon badge (WhatsApp brand green `#25d366`, email the app's
own `--snow-wine` red -- matching the reference images' colors, not
arbitrary ones), a title, a subtitle (a one-line "Chat with us" /
the actual email address), and a chevron implying "tap to open" the
same way every other Account row already does.

Added `ICONS.whatsapp` -- a real WhatsApp glyph (single `currentColor`
path, same convention as the existing `ICONS.telegram`), not the
generic outlined `ICONS.envelope` reused twice. `ICONS.envelope`
(already in the file) covers email. New `supportRowHtml()` helper
builds each row consistently rather than hand-duplicating the markup
per contact method; a `.support-hours-card` in the same card language
(dimmer background, clock icon) replaces the previous plain gray
paragraph for the hours line.

One real bug caught before shipping: the title/subtitle spans
(`.t1`/`.t2`) rendered inline on the same line on first pass (e.g.
"WhatsApp ChannelChat with us" run together) -- missing `display:block`
on both, unlike every other title+subtitle pattern already in this
file which sets that inline on the element. Fixed in the CSS class
itself instead of copying that inline-style workaround a third time.

`node -c` clean. `build-core.js`: "round-trip OK" (twice -- caught
the inline/block bug on the first live screenshot, fixed, rebuilt).
`npm run test:audit` still passes in full. Verified live in headless
Chromium against the real built bundle: `openSupportSheet()` with
mock `whatsappGroup`/`supportEmail`/`supportHours` renders exactly 2
`.support-row` elements with the right `href`s (`https://chat.whatsapp.com/...`,
`mailto:support@...`), correct icon classes (`whatsapp`/`mail`), and
the hours card present with the right text -- plus a screenshot
confirming the title/subtitle now stack correctly and the icons match
the owner's reference colors. `user/sw.js` bumped `v200` → `v201`.

## Follow-up 24 -- Download App row replaces the old download screen; the announcement dialog is rebuilt

Owner, one message, two asks: *"introduce another tab here of download app,
so app icon will be uploaded from admin panel name, and also remove that
stuff of download app background, here, one just taps on and it stimulates
downloading, no going inside, so remove download app back image input, also
remove stuffs of link preview, here there will be no link preview."* Then,
in the same message: *"another thing we are going to introduce announcement
dialog, so it will have channel and email buttons shaking and glowing, the
cancel X sign will be top right please put all your experience and skills
in it and it opens from middle as usual and also just like mechanism of
previous chipz clicking back to home stimulates it, and let it have a good
appearing animation not just appearing abruptly."*

**Download App / link preview removal.** The `downloadbg` image slot and
`linkPreviewEnabled`/og:image machinery are gone server-side (routes,
`DEFAULT_SETTINGS` fields, `PETRO_IMAGE_SLOTS`/`BRAND_ASSET_SLOTS`),
client-side (`og:image`/`twitter:image` meta tags removed from
`user-src/index.html`), and from the admin panel (the Link preview and
Download screen background upload sections removed from `admin-src/
index.html`) -- all from a prior round in this same session. This round
finished the client half: `openDownloadSheet()` (the old full-screen
"Download APP" overlay with its admin-uploadable backdrop) is deleted from
`user-src/original_module.js`, replaced by an explanatory comment directly
above the unchanged `promptInstallApp()` (the actual PWA-install trigger,
which the screen only ever wrapped). Its dead `.dl-screen`/`.dl-bg`/
`.dl-scrim`/`.dl-body`/`.dl-top`/`.dl-mark`/`.dl-title`/`.dl-sub`/`.dl-btn`/
`.dl-note` CSS is removed from `user-src/index.html`. Account's row list
(`renderAccount()`) gained a new **Download App** row (`downloadAppRowHtml()`),
after About Us, calling `promptInstallApp()` directly -- "one just taps on
and it stimulates downloading, no going inside." server.js's own comment
above `PETRO_IMAGE_SLOTS` (which used to point at a not-yet-written
`openDownloadApp()`) was corrected to name the functions that actually
ship: `downloadAppRowHtml()`/`promptInstallApp()`.

**A real bug caught before shipping, not guessed at**: the new row's icon
is the app's own uploaded icon (`${API_BASE}/public/app-icon-192.png`),
the first `<img>` in this codebase to reference the backend's bare-HTTP
address directly rather than through a `data:` URI. Rendering it live in
headless Chromium showed the browser silently refusing to load it --
`user-src/index.html`'s own CSP `img-src` is deliberately kept
`'self' data: blob: https:` only, and CLAUDE.md's own "Hosting" section
already names this exact tradeoff (`test-csp-runtime.py`'s note: do not
loosen the CSP to accommodate the bare-HTTP VPS icon URL; wait for the
real HTTPS domain cutover). Rather than either break that rule or ship a
visibly broken image, the row's `<img>` now has an `onerror` fallback to
a plain `ICONS.download` glyph -- the exact same pattern `renderAccount()`'s
own `accountBrandLogo`/`accountBrandFallback` pair already uses two lines
above it. Degrades gracefully today, and will start showing the real icon
on its own the moment the real domain/HTTPS cutover happens (the CSP's
existing `https:` allowance already covers it then) -- no code change
needed at that point.

**Announcement dialog, reintroduced.** Was removed entirely several rounds
ago on an explicit earlier instruction (see "Design system" above);
`maybeShowAnnouncement()` was deliberately kept as a no-op rather than
deleted specifically so this round could give it a real body again without
touching `maybeAnnounceAfterSheet()`'s five call sites -- exactly what
happened. The trigger mechanism the owner asked to reuse ("just like
mechanism of previous chipz clicking back to home stimulates it") was
never removed in the first place: `maybeAnnounceAfterSheet()` +
`ANNOUNCE_AFTER_SHEETS` (`['Recharge','Deposit','Withdraw','Wallet']`)
still fire on the phone Back button or tapping back to Home from those
four sheets, unchanged.

- **CSS** (`user-src/index.html`): `.ann-bg`/`.ann-sheet` reuse the exact
  centred scale+fade "gentle settle" entrance `.confirm-sheet`/`.chest-modal`
  already established (same `cubic-bezier(.22,1,.36,1)` curve, same 520ms/
  100ms-delay timing) -- "opens from middle as usual" is literally this
  existing pattern, not a new one. `.ann-close` (top-right, `ICONS.x`),
  `.ann-mark` (a red circular badge with `ICONS.megaphone`), `.ann-title`/
  `.ann-body` follow. The CTA buttons (`.ann-cta a.whatsapp`/`.mail`) carry
  a periodic wiggle+glow (`annShake`/`annGlow` keyframes, a `--ann-glow`
  custom property so one shared keyframe pair serves both brand colors) --
  deliberately a short pulse near the end of each ~2.6s cycle rather than
  constant jitter the whole time, which would be unreadable on a button
  carrying real text; the email button is offset half a cycle
  (`animation-delay`) so the two never pulse in lockstep. Respects
  `prefers-reduced-motion` (animation disabled entirely).
- **Markup**: `<div class="ann-bg" id="annBg">` was already stubbed as an
  empty HTML comment from the earlier removal round, marking exactly where
  to add it back -- replaced with the real `#annBg`/`#annSheet` pair,
  tap-outside-to-close wired the same way `#confirmBg`/`#msgDetailBg`
  already do.
- **JS** (`user-src/original_module.js`): `maybeShowAnnouncement()` now
  reads `STATE.settings.annEnabled`/`annTitle`/`annBody` (no-ops if
  disabled or both are empty) and builds the WhatsApp/email CTAs from
  `whatsappGroup`/`supportEmail` -- the exact same two settings and the
  same `esc()`-guarded `href`/`mailto:` pattern `openSupportSheet()`
  already established two rounds ago, not a second contact-info system.
  New `window.closeAnnouncement()` mirrors `closeSheet()`'s own
  `isAnyOverlayOpen()`-gated `unlockBodyScroll()` call. `isAnyOverlayOpen()`
  gained an `#annBg` check so a second trigger firing while the dialog is
  already open can never stack a duplicate on top.
- **Backend**: needed zero changes. `annEnabled`/`annTitle`/`annBody`/
  `annUpdatedAt` were already live in `DEFAULT_SETTINGS`,
  `SETTINGS_BOOLEAN_FIELDS`, and `/admin/settings/update`'s
  `annUpdatedAt`-stamping logic from when the feature first existed --
  left in place, unreachable, the whole time it was removed from the UI
  (same "leave the dormant code, remove only the entry point" precedent
  this file documents for Turntable/subdomains/Trade Password/etc.).
- **Admin panel** (`admin-src/index.html`): a new "Home announcement
  dialog" panel-card (enable checkbox, Title input, Message textarea, its
  own Save button) added right after Support contacts, reusing the
  `Support contacts`-card's own `v()`/`esc()`/`api('/admin/settings/update')`
  pattern verbatim. Its own i18n translation-table row (`'Home announcement
  dialog'`) was deliberately kept, unused, when the section was removed
  several rounds ago specifically "for reuse" -- confirmed still present
  and correct in all 6 languages, needed no new translation work.

**Verified, not assumed**: `node -c`/`node --check` clean on both touched
`.js`-bearing files; `build-core.js`/`build-admin.js` both "round-trip OK".
`npm run test:audit` passes in full. Live in headless Chromium against the
real built `user/index.html`: the new Account row renders with the correct
`onclick="promptInstallApp()"`, the old `.dl-screen`/"Download APP" markup
is completely absent from the DOM, and the icon's `onerror` fallback
correctly swaps to the generic glyph under the current bare-HTTP CSP
(confirmed via `getComputedStyle` on both the `<img>` and its fallback
`<span>`, not just read from the code). For the announcement dialog:
`maybeShowAnnouncement()` renders the right title/body/CTAs and shows the
dialog; `maybeAnnounceAfterSheet('Withdraw')` (the real Chipz-mechanism
trigger) fires it exactly the same way a direct call does; it does NOT
fire for an unrelated sheet title or when `annEnabled` is false;
`closeAnnouncement()` correctly hides it and `isAnyOverlayOpen()` correctly
reports `true` while it's shown; both CTA buttons carry the `annShake`/
`annGlow` animations (checked via `getComputedStyle().animationName`); a
screenshot confirms the centred card, top-right X, megaphone mark, and
both brand-colored CTA buttons render together correctly. The admin
panel's new section was verified the same way an earlier round verified
Analytics's VPS-health card: loaded `admin-src/index.html` directly (not
the obfuscated `admin/index.html` build, which doesn't expose its
functions as bare globals), drove it through the real `switchTab('settings')`
call with `api()` intercepted/mocked, and confirmed via both DOM
assertions and a screenshot that the enable checkbox, title, and message
fields all populate correctly from mock settings and the Save button is
present. `user/sw.js` bumped `v201` → `v202`, `admin/sw.js` bumped `v48`
→ `v49` (both source files changed this round).

## Follow-up 25 -- real cause found for "buttons tend to freeze": a stale, invisible notify() toast was swallowing taps

Owner: *"l saw, when a notify appears buttons tend to freeze, what causes
that??"* Follow-up 12 investigated a vaguer version of this same report
("buttons don't respond, I can tap 3+ times") and came up empty --
`.notify-bg` looked correctly non-blocking from reading the CSS alone, and
nothing else pointed at a specific line. This round's report gave a much
sharper clue (it correlates with a notify appearing at all), which was
enough to actually reproduce and root-cause it, not just re-read the same
CSS a second time.

**Root cause**: `.notify-card` (the small dark toast bubble `notify()`
shows) had `pointer-events:auto` set unconditionally in its base rule, not
scoped to only while `.notify-bg.show` is actually applied. Before any
notify() ever fires, `#notifyMsg`'s `textContent` is empty, so the
invisible resting card is tiny (about 36×25px, just its own padding) --
easy to miss in practice. But `notify()` never clears that text back out
when the toast closes (`closeNotify()` only toggles the `.show` class), so
the moment ANY notify() call fires once with a real message, the invisible
card is permanently resized to fit whatever that message needed (a
realistic error message measured ~300×60px in testing) and stays
`pointer-events:auto` forever after -- sitting dead-centre of the
viewport, on top of whatever happens to be there, for the rest of the
session. Confirmed directly with `elementFromPoint()` in headless
Chromium: a real tap at a centred button's own on-screen coordinates
resolved to `notifyMsg` (the ghost toast), not the button -- exactly the
"freeze" being reported, and exactly why it reads as starting "when a
notify appears": before the first one, the phantom hitbox is too small to
matter; after, it is not. This explains why it was unreproducible from
static reading alone in Follow-up 12 -- the bug only exists in the DOM's
runtime state (`textContent` left over from a past call), never visible
in the source.

Auth screens (Login/Sign Up/Forgot Password) are hit hardest: they're
explicitly centred (`justify-content:center`, from the "login is raised
up" fix several rounds back) and route every validation error through
`notify()` (`regError()`/`forgotError()`/`doLogin()`, from the "auth
screens had their own second error pattern" round) -- meaning a single
failed login attempt is enough to leave a phantom hitbox parked right
where the Login button itself sits.

**Fix** (`user-src/index.html`): `.notify-card`'s base rule is now
`pointer-events:none`; `pointer-events:auto` moved onto the existing
`.notify-bg.show .notify-card` rule (which already exists, for the
scale/opacity transition) so the card can only ever intercept a tap while
it is genuinely visible -- fixes the whole class of it regardless of the
leftover message's size, rather than needing to also remember to clear
`notifyMsg.textContent` on every close path (`closeNotify()`, the 3.6s
auto-dismiss timer, and any future caller that closes it another way).

**Verified, not assumed**: reproduced the bug live first (a real
`getBoundingClientRect()`/`elementFromPoint()` check in headless Chromium
showed the ghost card's `pointer-events` reading `auto` and swallowing a
tap on a centred test button after one `notify()` call, before the fix),
then confirmed the same script passes after the fix (`pointer-events:none`
at rest, `elementFromPoint()` correctly resolves to the real button
again). Separately confirmed tap-to-dismiss still works during the toast's
actual visible window (`pointer-events:auto` while `.show` is present, a
dispatched click on the card closes it). `node -c` n/a (CSS-only, no JS
touched), `build-core.js` "round-trip OK", `npm run test:audit` passes in
full. `user/sw.js` bumped `v202` → `v203`.

## Follow-up 26 -- reviewed Codex's 4 commits (clean); a real bugsweep found two dead admin settings that had never actually rendered anywhere

Owner: *"codex made some commits, so you can take a look. and also fix all
bugs in the code, check the bugs."* Two separate asks, both done.

**Codex's 4 commits reviewed** (`a9db377`..`f28297e`, fast-forwarded onto
this branch): `Match Petro account icons to supplied references` (gift-
code/email/download-app icons redrawn from the owner's reference images,
including a JPEG traced into an inline SVG for the gift-code mark),
`Restore Gift Codes tile styling and contrast` (put the gift-code icon's
badge background back and fixed its heading to white -- it sits on the
dark glass `.sheet-body`, so the earlier dark-ink heading would have been
near-invisible), `Restore Account Gift Codes row icon` (reverted the
Account row's gift icon back to the raster mask version, removing the
now-unused `.gift-reference-svg` sizing rule for that one spot), and `Add
admin-managed Rules and Regulations page` (a genuine new feature: a
`content/rules` Mongo doc + `/public/rules-content`/`/admin/rules-content`
routes, mirroring the existing About-page block-editor pattern almost
exactly -- same validation shape, same `verifyOwner` gate on the write,
same `_dirty`-flag/`beforeunload` guard in the admin editor). All four
read cleanly and build clean; ran the full test suite (all pass) and
grep-audited every `$('id')` reference in both `-src` files against every
id actually declared (static or templated) anywhere in the same file, and
every `onclick="fn()"` reference against every defined function -- zero
dangling references introduced by any of the four commits, the specific
failure shape this file's own history has caught repeatedly before.

**One small, genuinely dead leftover cleaned up, not a functional bug**:
the `Rules and Regulations` commit added `if (kind === 'rules') return
openRulesSheet();` to `openInfoSheet()`, which made its own pre-existing
`map.rules` entry (the old plain-text fallback for the same kind)
unreachable -- confirmed `openInfoSheet()` itself has zero callers left
anywhere in the file (same "entirely unreachable" finding this file's own
"Regulation page" section documented once already, for the identical
function, before the Rules page existed to call into it for real).
Simplified rather than left as confusing dead-looking-live code.

**The actual bugsweep** (per "fix all bugs in the code, check the bugs"):
syntax/build checks and the full `npm run test:audit` suite were already
clean (see above), so the real work was a static reachability sweep for
this codebase's own repeatedly-proven failure class -- an element or
function a live code path references that was quietly never wired into
the markup, or was removed from it without updating the reference. Found
two, both real, both silent (never crashed, never logged -- just never
rendered), both restored:

- **`applyAuthTagline()`** (called once from `boot()`) has always
  targeted `#authTagline` to paint the admin's "App tagline (shown under
  the logo...)" setting (`brandTagline`) onto the Login screen -- but no
  `#authTagline` element has ever actually existed in `user-src/index.html`,
  through several full auth-screen rebuilds this file's own history
  documents. The function's own null-guard (`if (!el) return;`) meant this
  failed completely silently: the setting has been saveable in Admin ->
  Settings this whole time and has never shown up anywhere a member could
  see it. (Its OTHER promised location, the Home top-bar, WAS live once
  but was deliberately removed in an earlier round -- a different,
  intentional removal, not this bug.) Fixed by adding the missing
  `<p id="authTagline">` under the login pane's logo, in a new
  `.auth-tagline` style matched to the rest of `.auth-intro`'s white-on-
  photo palette -- `applyAuthTagline()` itself needed no code changes, it
  was already correct. The admin label's own text ("...and on the Home
  header") was also stale (that half is gone on purpose) -- trimmed to
  match what's actually still true.
- **`updateReferralFieldHint()`** (runs on every auth-screen load, per its
  own comment: "says out loud whether the box must be filled, instead of
  leaving members to discover it by being rejected") has always
  null-safely tried to write into `#regReferralHint`, which also never
  existed in the markup -- so only its OTHER effect (swapping the
  referral field's placeholder between "Referral code" and "Referral code
  (optional)") was ever visible; the actual sentence explaining WHY was
  silently dropped every single time. Fixed the same way: added
  `<p id="regReferralHint">` under the referral field in the Register
  pane, with its own small `.af-reg-referral-hint` style.
- **Checked and ruled out as false positives, not additional bugs**: 12
  other `$('id')` references the same automated sweep initially flagged --
  `confettiCanvas`/`langSheetBg` are created via `element.id = '...'`
  (a JS property assignment, not an HTML attribute, which the sweep's
  regex doesn't parse) rather than missing; `langBtnLabel`/`langRowValue`
  and `lpOld`/`lpNew`/`lpNew2`/`tpOld`/`tpNew`/`tpNew2` are either
  null-guarded already or generated by `pwFieldHtml()` inside the exact
  same `openSheet()` call that also wires the button referencing them, so
  they always exist by the time anything could click that button;
  `rememberMe`'s `if (!remember || remember.checked)` fallback is the
  already-documented, deliberate "credentials now always save locally on
  login" behavior from the single-screen auth rebuild, not a new find;
  `manPayTotal` was only ever a code comment, no live reference at all.

**Verified, not assumed**: `node -c`/`build-core.js`/`build-admin.js` all
clean (`round-trip OK` on both), `npm run test:audit` passes in full after
the fixes. Live in headless Chromium against the real built bundle: called
`applyAuthTagline()` directly with a mock `brandTagline` and confirmed
`#authTagline` now exists, shows the exact text, and correctly hides
itself again (`display:none`) when the setting is blank; called
`updateReferralFieldHint()` in both the required and optional states and
confirmed `#regReferralHint` now shows the right sentence in each,
alongside the placeholder swap that already worked. `user/sw.js` bumped
`v207` → `v208`, `admin/sw.js` bumped `v50` → `v51` (the admin label-text
fix touched `admin-src/index.html`).

## Follow-up 27 -- gift-code win card removed in favor of a plain notify; last of the Chipz i18n residue swept out

Owner, with two screenshots of the "Congratulations! You won UGX 169...
COLLECT" full-screen win card: *"l was still chatting with codex and
weekly limit hit, so bro help me complete and remove it, so notify has
[a checkmark]... Remove this stuff completely, only just put a notify
'giftcode redeemed successfully [checkmark]'. Look for all chipz stuffs
l nolonger need the[m]."*

**Win card removed end to end, not hidden.** `showChestWin()`/
`correctChestWinBalance()`/`closeChestWin()`/`chestWinBalFmt()`/
`_chestWinBalFrom` are all deleted from `user-src/original_module.js` --
`submitChestKey()` (the gift-code redeem handler) now just closes the
sheet and calls `notify('Giftcode redeemed successfully ✓')`, the
exact same toast mechanism every other quick confirmation in this app
already uses, per the owner's own wording. `refreshAfterWin()` (the
background `/account` + transactions refresh that follows a redeem) is
kept -- it was never part of the visual card, just quietly catches
`STATE`/Home/Account up afterward -- with its now-pointless
`correctChestWinBalance()` call removed. The `#chestWinBg`/
`#chestWinGhost`/`#chestWinAmount`/`#chestWinBalance` markup and its
`.chest-win-bg`/`.chest-win-card`/`.gift-win-mark`/`winFlash` CSS are
gone from `user-src/index.html`, and `isAnyOverlayOpen()` no longer
checks `#chestWinBg`. `GIFT_CODE_REFERENCE_SVG`/`.gift-code-mark`
(the icon on the REDEEM form itself, not the win card) are untouched --
a different, still-live piece of the same screen. Confirmed
`showChestWin()` had exactly one caller in the whole file before this
change (the old spin/Turntable `source==='spin'` branch inside it was
already fully dead, Turntable having been removed in an earlier round),
so nothing else needed touching.

**A real test caught by this, not shipped blind**:
`test-member-audit.js` called `w.showChestWin(...)` directly and
asserted against `#chestWinAmount`/`#chestWinBalance` -- would have
thrown `TypeError: w.showChestWin is not a function` on every future
`test:audit` run had it been left alone. Rewritten to call
`w.notify('Giftcode redeemed successfully ✓')` and assert against
`#notifyMsg`/`#notifyBg.show` instead, matching what the code path
actually does now.

**Chipz i18n residue swept out of the admin panel.** A fresh grep sweep
(the whole repo, not just the two touched files) for `chipz`/`CHIPZ`
found the live source files already clean of anything but historical,
accurately-quoted comments (owner quotes, past design-history notes --
CLAUDE.md's own standing rule against rewriting those into invented
narrative) and `guard-src.js`'s explanatory comment about why the
frame-bust code deliberately uses `window.location.href` instead of a
hardcoded domain (real reasoning that happens to name a past Chipz URL,
not a current one -- the code itself is already domain-agnostic). What
WAS real: 5 orphaned i18n translation-table rows in `admin-src/index.html`,
each carrying literal "Chipz"/"CHIPZ" text in their English source --
`'Built-in Chipz icon'`, `'1. Top band (behind the CHIPZ logo)'`,
`'Mint a new short address for this country, e.g. g26e.chipz-platform.com'`,
`'The round logo on the app's Account profile card. An empty slot shows
the CHIPZ wordmark instead...'`, `'Replaces the CHIPZ wordmark on the
manual-deposit flow's own 2 screens...'`. Confirmed each one's exact
English text appears NOWHERE else in the file -- not in any live label,
button, or help paragraph -- meaning these described UI that earlier
rounds already removed (the old two-part hero+card auth layout, the
Countries/subdomain-minting tab, the manual-deposit logo upload) and
were simply never cleaned up alongside it. Deleted outright, same
"orphaned translation row, source text is gone" convention this file
has followed every other time.

**Verified, not assumed**: `node -c` on the touched `.js` file,
`build-core.js`/`build-admin.js` both "round-trip OK", `npm run
test:audit` passes in full (after the `test-member-audit.js` fix). Live
in headless Chromium against the real built `user/index.html`: confirmed
`window.showChestWin`/`window.closeChestWin` are both `undefined` and
`#chestWinBg` no longer exists anywhere in the DOM; ran
`submitChestKey()` end-to-end against a mocked `/redeem` response and
confirmed the toast shows with the exact requested text
("Giftcode redeemed successfully ✓") while `STATE.account.walletBalance`
still updates correctly in the background.

**Merge note**: a concurrent session pushed 4 commits to this branch
while this round was in progress (article-loader ring polish, a traced
gavel/gift-box icon replacing the earlier base64-JPEG version, a login-
success toast, a shared `dismissNotify()` helper) -- fast-forwarded
cleanly onto them (`git fetch` + read the incoming log first, matched
this file's own standing precedent for this exact situation), then
`git stash`/`pop`'d this round's own source edits back on top; both
sides auto-merged with zero conflicts. Rebuilt both bundles fresh from
the merged source rather than trusting a stashed copy of the generated
files, and re-ran the full verification above (build round-trips,
`test:audit`, and the live headless-Chromium gift-code check) against
that fresh build before pushing. `user/sw.js` bumped `v212` → `v213`,
`admin/sw.js` bumped `v51` → `v52` (both source files this round's own
changes touched, on top of whichever version the concurrent session's
commits had already reached).

## Follow-up 28 -- Messages tab removed, video banner removed, announcement trigger moved to bottom-nav, Deposit/Withdraw renamed to Top Up/Cash Out everywhere, statement PDF speed fix

Owner, one message, seven asks: *"There is also a tab in admin panel
called messages, remove it, also video banner remove it, headers
remove them, and l told you that the dialog should appear when one
also clicks back to home ie from assets to home, from network to
home, and account to home, so remove those existing of from
withdrawal, from deposit to home, also change deposit to Top up and
withdrawal to Cash out everywhere whether admin, transactions,
statements, etc, also bro why when downloading statement it takes
some seconds yet we are using a powerful vps, so improve speed of
everything, so that it is perfect. Also improve smooth navigation."*

- **Admin panel Messages tab removed.** Tab button, `'messages'` from
  `VALID_TABS`/`LIVE_TABS`, and its entry in `switchTab()`'s `fn` map
  and the `RENDERERS` map are gone. `renderMessages()` itself is left
  defined but unreachable, same "leave the dormant code, remove only
  the entry point" precedent this file has followed for Turntable,
  subdomains, Trade Password, and others -- confirmed by grep that no
  id/handler it touches (`messagesTab`, etc.) has a dangling reference
  anywhere else.
- **Video banner removed entirely** -- server (`getHomeBannerVideo()`,
  `/public/banner-video`, `parseByteRange()`, `isYouTubeLink()`,
  `sanitizeBannerVideoUrl()`, the `home-video` Mongo doc, the
  `HUGE_JSON_ROUTES` entry for its upload route), client
  (`STATE.homeBannerVideo`, `preloadBannerVideo()`/
  `adoptPreloadedBannerVideo()`/`tryAutoplayHomeBanner()`, the up-to-4s
  boot-time preload wait, the `.home-banner video` CSS), and admin (the
  video-upload UI block, `bannerVideo`/`bannerVideoUploaded`,
  `fileToRawDataUrl()`, 7 i18n rows). The boot-time preload wait was a
  real, measurable cost to first paint -- removing it is a genuine
  speed win toward the "improve speed of everything" ask, not just
  cosmetic.
- **"Headers remove them"** -- first guessed (wrongly) as the duplicate
  `<h2 class="sec">Home banner</h2>` heading bug in admin-src's Home
  banner panel-card, left over from the video-upload block that used
  to sit between the two headings (that duplicate is real and was
  fixed regardless, confirmed by grep that only one "Home banner"
  heading remains -- just not what the owner meant). The owner then
  sent a screenshot of the admin Banners tab with the **"Home footer
  banner"** and **"Account screen header photo"** upload cards
  circled directly: *"the headers l meant were those ones, and account
  screen header photos those were what l meant."* Removed both, end to
  end, not just the admin UI: the `homefooter`/`profilecard` entries
  out of `PETRO_IMAGE_SLOTS` (server.js) and both `/public/petro-images`/
  `/admin/petro-images` `Promise.all` fetches, the two admin panel-cards
  and their `wirePetroImageSlot(...)` wiring (admin-src), and both
  client render sites: `STATE.homeFooterBanner`'s `<img
  class="home-footer-banner">` at the bottom of Home (removed outright,
  along with its now-dead CSS in both the mobile and desktop rule
  blocks) and `STATE.profileCard`'s inline `--acct-card-image` override
  on the Account screen's profile card. The Account card does NOT go
  blank without it -- `.acct-card`'s own base rule already defaults
  `--acct-card-image` to `var(--auth-hero-img)` (the same photo Login/
  Sign Up already use), a fallback this exact CSS block's own comment
  already documented ("or the signed-in refinery image as its
  fallback") -- so Account now always shows that shared photo instead
  of a separately admin-set one, a coherent, already-designed-for
  outcome, not a regression needing new CSS. Same "actually remove it,
  not just hide the UI" standard as every other genuine feature reversal
  in this file (video banner above, LipaPay, Turntable, subdomains,
  etc.) -- an admin can no longer even attempt to set either slot via
  the raw API, not just lose the upload button. Verified live in
  headless Chromium: the Banners tab no longer shows either section or
  their `homeFooterFile`/`profileCardFile` inputs (their neighbors,
  Daily Check-in banner and Login & Sign Up background, still do);
  Home paints with zero `.home-footer-banner` element; the Account
  card still renders with no inline style (falls through to the CSS
  default), zero page errors on either bundle. `user/sw.js` bumped
  `v214` → `v215`, `admin/sw.js` bumped `v53` → `v54` (this correction
  is its own commit on top of the round above, not folded into it --
  both source files it touches changed again).
- **Announcement dialog trigger moved from sheet-close to bottom-nav
  navigation** -- a real reversal of Follow-up 24's own explicit
  mechanism (which reintroduced the dialog specifically firing on
  Deposit/Withdraw/Wallet closing back to Home, "just like mechanism
  of previous chipz"). This round's instruction supersedes that:
  `maybeAnnounceAfterSheet()`/`ANNOUNCE_AFTER_SHEETS` are replaced with
  `maybeAnnounceAfterHomeNav(prevPage)`, called from `showPage()`'s own
  `'home'` branch with the page being left captured before `STATE.page`
  is overwritten. Fires only when the previous page was `'assets'`,
  `'network'`, or `'account'` (not on a sheet close, not on a page
  reload or direct home-to-home tap) and no other overlay is already
  open. Verified live in headless Chromium against the real built
  bundle: Assets→Home and Network→Home both trigger it, Home→Home does
  not, and `maybeAnnounceAfterSheet` no longer exists as a function at
  all (confirms the old trigger is genuinely gone, not just unreachable).
- **Deposit → Top Up, Withdrawal → Cash Out, renamed everywhere a
  member or admin actually reads it** -- user app (action tiles, stat
  labels, sheet titles, Task Center copy, statement descriptions,
  confirm buttons, error toasts), admin panel (tab bar, Deposits/
  Withdrawals section headings and tables, Dashboard/Analytics cards
  and tooltips, user detail modal, Settings' Rates & limits card, the
  Payments card's gateway radios and their prose, the Crypto/Card top
  up panels, audit-log labels, the integrity-audit modal's field
  labels, Transactions tab subtabs, the save-payment-method toast, and
  the announcement-dialog help text -- rewritten, not just word-swapped,
  to correctly describe the new Assets/Network/Account→Home trigger
  instead of the old Deposit/Withdraw/Wallet one), and server.js
  (the `/withdraw/request` UNBOUND_ACCOUNT/fee/amount-too-small error
  messages a member can actually see, and the admin-facing withdrawal-
  reject success toast). Internal identifiers deliberately left alone,
  same convention as every previous renaming round in this file:
  `data-tab="deposits"`/`"withdrawals"`, `depositMethod`/
  `withdrawMethod`, `minDeposit`/`minWithdraw`/`withdrawFeePct`, route
  paths (`/deposit/marzpay`, `/withdraw/request`), function names
  (`openDepositSheet`, `submitWithdraw`), and `type==='deposit'`/
  `'withdraw'` comparisons all stay exactly as they were. The
  `ADMIN_LANG_ROWS` translation table's English-source rows for the
  renamed strings (tab labels, "Withdrawal fee (%)", etc.) were
  deliberately NOT updated -- same accepted tradeoff this file has
  documented before: editing the English source without re-translating
  the other 5 languages would desync the lookup, so those rows are now
  simply orphaned (no longer match anything rendered) rather than
  wrong-but-matched, and a non-English admin sees the new English text
  fall back cleanly instead of a stale mistranslation. Needs a real
  translation review, not a guess, same as every prior round's version
  of this same note.
- **A real regression caught and fixed before shipping, not
  discovered later**: `openWithdrawSheet()` calls `openSheet('Cash
  Out', '')` (renamed from `'Withdraw'`), but its own post-`/bank/list`
  guard, `if (_openSheetTitle !== 'Withdraw' ...) return;`, was never
  updated to match -- meaning after this round's rename, EVERY
  Withdraw sheet open would have silently failed to populate the
  payout-wallet card and bound-accounts list (the guard would always
  see `_openSheetTitle === 'Cash Out'`, never equal to the old literal
  `'Withdraw'`, and return early). Found by grepping every
  `_openSheetTitle` comparison in the file (12 total) before shipping
  the rename, not after a bug report -- all the others already matched
  their sheet's new title. Fixed to compare against `'Cash Out'`.
  Verified live in headless Chromium against the real built
  `user/index.html`: before understanding this bug the wallet card
  would have stayed empty; after the fix, opening Withdraw with a
  mocked `/bank/list` response correctly populates `#witWallet`.
- **Statement PDF download speed, root-caused, not guessed at.**
  `GET /statement/pdf` was doing four independent reads -- the user
  doc, `getSettings()`, the up-to-2000-row transactions query, and the
  admin logo image -- as four sequential `await`s in a row, each
  paying its own full round trip before the next one could even start.
  None of the four depend on each other's result, only on
  `settleAllForUser(uid)` having already run (which genuinely must go
  first, since it can change the wallet total and add a fresh
  transaction row) -- so the four are now a single `Promise.all()`,
  cutting three round trips' worth of serial latency off every
  download. Separately, the `statementDownloads` audit-log write (see
  Follow-up 24's "Downloaded statements now visible in Admin" section)
  was being `await`ed before the PDF was sent back -- a log write the
  member's own download does not need to wait on, matching this same
  route's own existing comment that a logging failure must never block
  the download (it was already failure-tolerant, just not
  latency-tolerant). Made fire-and-forget. `db.js`'s indexes were
  checked first and are not the problem -- `{userId:1,createdAt:-1}`
  on `transactions` already exists and backs this exact query.
- **"Improve speed of everything" / "improve smooth navigation"** --
  checked rather than guessed at further, consistent with this file's
  own established discipline (see Follow-up 11's identical finding):
  `showPage()`'s Assets/Network/Account renderers already paint from
  cache synchronously before their own first network `await`, so the
  tab switch itself is never blocked on a round trip; Follow-up 16
  already audited and closed the one real missing index
  (`users.phone`); Follow-up 9/11 already audited and closed the
  deposit/withdraw polling and callback-ack-first paths. No second
  concrete slow spot was found beyond the statement-PDF one above --
  told honestly here rather than inventing a change with no measured
  problem behind it, same posture Follow-up 11 already took and
  explained to the owner.
- **Verified**: `node -c user-src/original_module.js`, `node --check
  server.js`, `node build-core.js` + `node build-admin.js` (both
  round-trip OK). `npm run test:audit` passes in full (163 checks, 0
  failures). Live in headless Chromium against the real built bundles:
  the Deposit/Withdraw sheet-title and `_openSheetTitle` fix confirmed
  end-to-end (see above); the admin Settings tab rendered directly
  from `admin-src/index.html` (not the obfuscated build, same
  precedent as Follow-up 24) confirms every renamed label present and
  zero stray "Deposit"/"Withdrawal" text remaining, Messages tab gone
  from the tab bar, zero page errors on either bundle. `user/sw.js`
  bumped `v213` → `v214`, `admin/sw.js` bumped `v52` → `v53`.
