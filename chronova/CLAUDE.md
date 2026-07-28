# Chronova — Project Memory (read this first)

**What it is:** Chronova is a Uganda mobile-money **investment platform** themed around
luxury watches (Casio → Patek Philippe tiers). It descends technically from an earlier
app called **Furagemz** (reuses its money-safety engine, security patterns, and build
pipeline) but the owner's #1 rule, repeated many times and still not fully respected in
past sessions, is: **Chronova must NOT resemble Furagemz** — not in wording, colors, icons,
layout, or **code structure**. Read the whole "Lesson learned" section below before
touching any file.

Active dev branch: **`claude/voltra-session-continue-mk95gw`**. All work is committed
AND pushed there.

## Lesson learned from the last session (do not repeat)

The single biggest recurring failure was **reusing Furagemz's inherited code** —
variable names, function names, and structural patterns (`GEM_COLORS`, `FG_LOGO`,
`renderGems`, purple `rgba()` shadows under a "gold" surface, etc.) — and only patching
them piecemeal each time the owner caught a leftover. That produced repeated rounds of
"same mistake" complaints. **Do not treat the inherited Furagemz code as a starting
point to tweak.** When building or fixing a screen, treat the owner's approved mockup as
the spec and write/rewrite the screen to match it, including renaming Furagemz-derived
identifiers where they leak old assumptions (colors, milestone logic, domains, etc.).
Before assuming a past fix is sufficient, verify against what the owner is currently
showing you (screenshots) — don't argue that the code should be fine on inspection alone.

## Locked-in economics (do not change without asking)

7 watch tiers: Casio 25,000 → Patek 500,000, VIP 1–7 (the product catalogue itself is
fully admin-driven now — no hardcoded tier list ships in the client — so treat this as
the intended default naming/pricing, not a guarantee of what's live). Return **×30** over
**120 days** (daily = price ÷ 4). Commissions **L1 30% / L2 3% / L3 1%**. Welcome bonus
**5,000**. Min deposit **25,000**. Min withdrawal **10,000**. Referral milestones by
**ACTIVE referral count** (active = totalInvested > 0): 3→10,000 / 10→50,000 / 15→75,000 /
20→100,000.

**Confirmed by the owner: check-in bonus 500, withdrawal fee 17%.** `runRatePatchOnce()`
bumped check-in from 300→500 (correct, kept) but also dropped the withdrawal fee to 14%
— that part was wrong and got walked back by `runRatePatchV3Once()` (`ratePatchV3Done`
guard), which force-sets `liquidityFee` back to 0.17 once. `CHECKIN_BONUS` (500) and
`LIQUIDITY_FEE` (0.17) in server.js are the fallback defaults and match live. If a future
rate change is needed, prefer a new one-time patch function (V4, …) over hand-editing the
live settings doc, so the intent is documented and idempotent.

**Payment flow — manual mobile-money, NOT a gateway:** admin configures up to ~7
recipient mobile-money numbers in the admin panel. On deposit, the server auto-assigns
the least-busy active number and gives the user a 15-minute "Copy & Pay" window; the
admin gets an SMS (MarzSMS) to approve after confirming the money landed. Withdrawals:
admin manually sends the money then marks paid, or rejects (auto-refund).

## Design language (already implemented — preserve, don't regress)

- Dark **charcoal + gold** theme. No purple/violet anywhere — including in `rgba()`
  box-shadows, gradient overlays, and modal-backdrop tints, not just flat hex fills
  (this was a real bug found late: surface colors were gold but shadows underneath were
  still Furagemz-purple `rgba(124,58,237,...)` etc. — always grep for stray
  purple-toned `rgba()`/hex after editing CSS).
- Gold circular clock logo (`FG_LOGO` in `original_module.js`, and the admin panel's
  `.mark`/`.topbar .mk`) — never the old gem/diamond mark.
- Auth screens: box-cornered fields/buttons (not pills), icon inside each field
  (phone, lock, lock, `<>` for invite code). Login/Register wording: "Log In" /
  "Create account ›" / "Forgot password?" and "Register Now" / "Already have an
  account? Sign In" — no "Welcome back" / "Access my account" wording.
- Login and Register have **different** full-screen watch-photo backgrounds
  (`.auth-view` / `.auth-view.mode-register` in `index.html`, toggled in `setAuthMode()`).
- Radial CSS loader (conic-gradient ring, `.pay-dots`/`.btn-dots` in `index.html`) is
  used for **every** loading state app-wide — never reintroduce the old bouncing-dot
  spinner.
- Home dashboard order: actions row (Recharge/Withdraw/Contact Us/Check-in, plain
  owner-supplied PNG icons recolored gold via CSS filter, no circle/box background) →
  slim activity ticker → photo-background cards for Account Balance / Cumulative Income
  / Total Withdrawn (photo IS the card background) → promo banner. No "CHRONOVA"
  title/logo bar above the hero image.
- Owner-supplied PNG icons live as base64 in `window.CHRONOVA_ICONS` (plain `<script>`
  in `index.html`, placed immediately before `<script data-nx-core>` so it survives
  `build-core.js` reruns). Referenced via `(window.CHRONOVA_ICONS || {}).keyname`,
  recolored gold with
  `filter:invert(75%) sepia(46%) saturate(638%) hue-rotate(358deg) brightness(101%) contrast(94%)`.
- Account screen menu (in this exact order): About Us, Customer Service, Records,
  My Watches, Referrals & Team, then Bind Bank Card, Change Password, Redeem Gift Code,
  Install App, then Exit. About Us is an actual article about the history/craft of
  watches, not investment marketing copy. Customer Service lists **WhatsApp + Telegram
  only, no email**.
- Boxed (not rounded) corners applied consistently across dashboard cards, tiles, and
  buttons, matching the auth screen treatment.
- Product tier colors come from `TIER_TINTS` in `original_module.js` (7 gold-family hex
  values) via `tierTint(product, index)` — assigned by **position** in the admin-driven
  product list, not by a tier key lookup, so there's no key-matching failure mode left to
  regress (the old `GEM_COLORS`-by-key design this replaced is gone; don't reintroduce it).

## Where the app lives

Everything is in `chronova/` (this directory):
- `original_module.js` — all app logic/screens (compiled into `index.html`)
- `index.html` — shell + CSS + compiled core (edit CSS/markup here directly; JS logic
  lives in `original_module.js` and gets recompiled in)
- `server.js` — Render backend (Express + Firebase Auth + MongoDB via `db.js`)
- `db.js` — Mongo layer. M0 free tier has **no ACID transactions** — money-crediting
  code uses in-process Sets as single-writer locks (same pattern as the Voltra/Furagemz
  lineage; see `db.js` comments).
- `admin.html` — admin panel source (readable; compiles to `admin.dist.html` +
  `admin-dist/`)
- `sw.js`, `manifest.json`, icon PNGs — PWA shell

## Admin panel access control (multi-admin)

The owner gives admin access to multiple people (staff), so nobody shares one
password. `ADMIN_KEY` (env var) is the **owner's own master key only** — never
handed to staff. Each staff member gets an individual account instead:
- `adminUsers` (Mongo): `{username, passwordHash (scrypt, salt:hash hex), active, createdAt, lastLoginAt}`.
- `adminSessions`: opaque random token → `{username, role, createdAt, expiresAt}`,
  12h TTL. Login (`/admin/check-key` for the owner, `/admin/login` for staff)
  issues one; the client sends it as `Authorization: Bearer <token>` from then
  on instead of resending the key/password on every call.
- `adminAuditLog`: append-only `{actor, role, action, meta, ip, createdAt}` —
  written by `logAdminAction()` from every sensitive mutating endpoint (bans,
  manual credit/debit, deposit/withdrawal approve/reject/process, settings
  changes, product/banner edits, admin-account management itself). Readable
  only via `/admin/audit-log` (owner-only) — the admin.html "Activity Log" tab.
- `verifyAdmin(req)` accepts EITHER a resolved session (`req.adminUser`, set by
  middleware before the route runs) OR the legacy raw `ADMIN_KEY` in the
  `Authorization` header / `body.adminKey` — this is what keeps all 42
  existing `if (!verifyAdmin(req))` call sites unchanged. `verifyOwner(req)`
  additionally requires `role === 'owner'` (or the legacy key path, which has
  no `req.adminUser` at all) — used to gate the `/admin/admins/*` and
  `/admin/audit-log` endpoints so a staff account (even a compromised one)
  can never create more admins, see the log, or touch anyone else's account.
  Same gate on `/admin/settings`, `/admin/settings/update`, `/admin/banners`,
  `/admin/banners/set`, and `/admin/products/{list,save,delete,clear}` — staff
  never see or touch platform rates/announcement/maintenance mode, banners,
  or the product catalogue, only the owner can.
- Deactivating or resetting one account (`/admin/admins/deactivate`,
  `/admin/admins/reset-password`) calls `invalidateSessionsFor(username)`,
  which deletes that person's `adminSessions` docs — their access dies
  **immediately**, on every device, not just at their next login attempt.
  Nobody else's session or password is touched.
- Per-username login lockout (5 fails → 15 min, in-process `_loginFails` Map)
  is separate from the existing per-IP `adminLoginLimiter` — stops someone
  spraying one username's password from many IPs.
- `admin.html`: the login form has an optional Username field — blank means
  "I'm the owner, this is the master key"; filled in means a staff username +
  password via `/admin/login`. `SESSION_TOKEN`/`SESSION_USER`/`SESSION_ROLE`
  live in `sessionStorage` (not the raw secret). `openShell()` hides the
  Admins/Activity Log/Products/Banners/Settings tabs entirely for
  `SESSION_ROLE !== 'owner'` — staff never even see these exist.
- Test coverage: `test-admin-accounts.js` (38 checks) — login for both roles,
  deactivation/reset kills existing sessions instantly, staff can't reach
  owner-only endpoints, per-username lockout, logout invalidates server-side,
  audit log records the right actor. Run it after touching any of this.

## Admin push notifications (every admin/owner equally)

Browser push (Firebase Cloud Messaging), fired on exactly two events: a new
withdrawal request (`/withdraw/request`) and a deposit completing
(`creditMarzDeposit` — the one shared crediting function every provider/admin
path funnels through). No owner-vs-staff distinction — every registered
device gets both.
- Reuses the SAME Firebase project as user login (`FIREBASE_CONFIG` in
  `admin.html`, duplicated from `original_module.js` — it's public client
  config, safe to embed). No new Firebase project needed.
- The Web Push certificate (VAPID key) is set — owner generated it in
  Firebase Console and it's in `VAPID_KEY` in `admin.html` (near
  `FIREBASE_CONFIG`). If it ever needs rotating, regenerate there and update
  the same constant, then rebuild.
- `adminPushTokens` (Mongo): `{token, username, createdAt, updatedAt}` —
  one doc per subscribed device. `/admin/push/register` and
  `/admin/push/unregister` (any verified admin, not owner-only) manage it;
  `sendAdminPush(title, body, data)` in server.js fans out to every token via
  `admin.messaging().sendEachForMulticast()` and prunes dead tokens from the
  response (never throws — a push failure must never break the money flow
  that triggered it).
- `admin-dist/sw.js` (generated in `build-admin.js`, NOT the readable
  `admin.html` source) has `push`/`notificationclick` listeners added on top
  of its otherwise-intentional no-op/no-cache behavior — don't add caching
  logic here, only notification display.
- Not silent: `showNotification()` sets no `silent`/`vibrate` override, so a
  backgrounded device plays its normal system notification sound. Foreground
  (tab open + focused) is different — that's handled by `onMessage()` in
  `admin.html`, which only shows an in-page `toast()`, no sound.
- Manually crediting a wallet (`/admin/deposit`) is owner-only (`verifyOwner`)
  — staff can debit/ban/etc. but never credit, that's the one adjustment
  reserved for the owner. The Credit button itself only renders in
  `admin.html` when `SESSION_ROLE === 'owner'`.
- Not verified end-to-end in this sandbox (no outbound internet to Firebase,
  and no real deployed backend to register a token against) — code is
  defensively guarded (`typeof firebase === 'undefined'` etc.) and syntax
  checked, but the actual enable → receive flow needs a real device test
  after the VAPID key is in place.

## Build & deploy pipeline

1. Edit `original_module.js` (app logic) and/or `index.html` (CSS/markup).
2. `cd chronova && node build-core.js` — obfuscates + deflates + base64s
   `original_module.js` into `index.html`'s `<script data-nx-core>`. Prints
   "round-trip : OK" when valid. **Always rebuild after editing `original_module.js`.**
   This also syncs `dist/` (the clean EdgeOne deploy folder for the user app).
3. `node build-admin.js` for admin panel changes — writes `admin.dist.html` (single-file)
   and `admin-dist/` (separate EdgeOne project, `chronoadmin.edgeone.app`).
4. Bump the cache: `sw.js` → `const CACHE = 'chronova-shell-vN'` → `vN+1`, then
   `cp sw.js dist/sw.js` (do **not** overwrite `admin-dist/sw.js` — it's intentionally a
   bare no-op service worker so the admin panel never serves stale data).
5. Zip for handoff:
   ```
   (cd dist && zip -q -j ../chronova-userpanel.zip index.html manifest.json sw.js icon-192.png icon-512.png icon-maskable-192.png icon-maskable-512.png)
   (cd admin-dist && zip -q -j ../chronova-admin.zip index.html manifest.json sw.js icon-192.png icon-512.png icon-maskable-192.png icon-maskable-512.png)
   ```
6. Commit + push to `claude/voltra-session-continue-mk95gw`, then deliver zips via
   `SendUserFile`.

### Deploy targets (owner does this manually)
- User app → EdgeOne project, upload `dist/` contents (or the zip). URL pattern:
  `*.edgeone.app` / `*.edgeone.dev` preview domains, plus their own custom domain.
- Admin panel → separate EdgeOne project from `admin-dist/`.
- Backend → **Render** (not Railway), from `server.js`.
- MongoDB Atlas (M0), Firebase Auth, MarzPay/MarzSMS are the external services.

### Secrets — never commit
Firebase service account, Mongo URI, admin key, MarzPay/MarzSMS keys all live only in
Render env vars. Never put secrets or the model identifier in commits/PRs/code.

## Known constraints

- No outbound internet in the sandbox — Firebase's `gstatic.com` module import fails
  during any Playwright boot test, so click-driven JS behavior can't be verified via
  automated screenshot here, only static HTML/CSS. Disclose this rather than claiming a
  behavior is confirmed when it wasn't.
- PIL (`python3 -c "from PIL import Image"`) is available for icon resizing;
  ImageMagick/ffmpeg/sharp are not.
