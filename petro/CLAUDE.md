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
  **One-time setup, still needs doing** (both sides — until then this route
  exists in the code but nothing calls it):
  1. On the VPS: add `DEPLOY_WEBHOOK_SECRET` to `secrets.local.js` (same file
     as `MONGODB_URI`/`ADMIN_KEY`/etc.), then do ONE LAST manual redeploy
     (the three commands above) so the running process actually picks up
     this route and the new secret.
  2. On GitHub: repo → Settings → Webhooks → Add webhook. Payload URL
     `http://179.198.197.114:3000/deploy/webhook` (or the real domain once
     one exists), content type `application/json`, Secret = the same value
     as step 1, "Just the push event". GitHub's own ping fires immediately
     on save — a 200 there confirms it's wired up.
  After that, every future `git push` to this branch reaches the VPS with
  zero manual steps — this doc's own "the code in this commit needs `git
  pull` + rebuild + `pm2 reload` on the VPS" notes become unnecessary the
  moment step 1+2 above are done, though they're left in place below since
  that hasn't happened yet as of this note.
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
