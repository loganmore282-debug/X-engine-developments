# Snow — Project Memory (read this first)

**What it is:** Snow is a new Uganda mobile-money **investment platform**, a sibling
project to **space8** in this same repo. Same category of app (deposits/withdrawals via
mobile money, tiered investment products with daily cashback, 3-level referral
commissions) but a genuinely different brand, product ladder, and visual design —
**not** a reskin of space8, a fresh build that reuses space8's proven backend
architecture/patterns as a starting point.

**Brand inspiration**: the product names are drawn from real **Snow Beer (雪花啤酒)**
variants — the world's best-selling beer brand by volume, from China. 10 reference
photos of the actual bottles are committed at `snow/design/reference-bottles/`
(01–10, matching the product order below) — use these as the visual/mood source of
truth for anything design-related, not assumptions about what "Snow" should look like.

**Status as of this file's creation: planning/design phase.** No backend code has been
written yet. Only the product ladder, rates, nav structure, and 3 rounds of visual
design exploration exist so far (see AGENT_LOG.md for the full design history).

## Repo / branch

- Repo: `loganmore282-debug/x-engine-developments` — same multi-project repo as
  `space8/`, `voltra/`, `choco-mcc/`, `nexus/`. This project's code lives under
  `snow/`, on its own dedicated branch: **`claude/snow-platform-build`**.
- Never edit `space8/`, `voltra/`, or other sibling project folders from Snow sessions.

## Product ladder (confirmed, owner-supplied — 2026-08-26)

10 tiers, flat **150-day cycle**, formula: **Daily Cashback × 150 = Total Return =
Investment × 30**.

| # | Product | Investment | Daily Cashback | Duration | Total Return |
|---|---|---|---|---|---|
| 1 | Snow Qing Shuang | UGX 30,000 | UGX 6,000/day | 150 days | UGX 900,000 |
| 2 | Snow Ice Cool (Bing Ku) | UGX 90,000 | UGX 18,000/day | 150 days | UGX 2,700,000 |
| 3 | Snow Brave the World | UGX 197,000 | UGX 39,400/day | 150 days | UGX 5,910,000 |
| 4 | Snow Classic (Old Snow) | UGX 355,000 | UGX 71,000/day | 150 days | UGX 10,650,000 |
| 5 | Snow Draft Beer (Chun Sheng) | UGX 560,000 | UGX 112,000/day | 150 days | UGX 16,800,000 |
| 6 | Snow Brave the World SuperX | UGX 950,000 | UGX 190,000/day | 150 days | UGX 28,500,000 |
| 7 | Snow Marrs Green | UGX 1,000,000 | UGX 200,000/day | 150 days | UGX 30,000,000 |
| 8 | Snow Jiang Xin Ying Zao (Master Artisan) | UGX 1,250,000 | UGX 250,000/day | 150 days | UGX 37,500,000 |
| 9 | Snow Opera Mask Series (Lianpu) | UGX 2,550,000 | UGX 510,000/day | 150 days | UGX 76,500,000 |
| 10 | Snow "Li" (醴) | UGX 4,500,000 | UGX 900,000/day | 150 days | UGX 135,000,000 |

## Platform rates (confirmed, owner-supplied — 2026-08-26)

- Referral commission: **L1 27% / L2 2% / L3 1%**
- Withdrawal fee: **15%**
- Minimum withdrawal: **UGX 8,000**
- Minimum deposit: **UGX 30,000**
- Registration bonus: **UGX 5,000**

Not yet specified by the owner (ask before assuming, or reuse space8's default and flag
it as an assumption): daily check-in bonus amount, referral-count/whole-team-deposit
Task Center ladders, gift code format, withdrawal request hours.

**There is only ONE PIN in Snow, not two** (confirmed, owner-supplied — 2026-08-26):
the 5-digit "Transaction PIN" set at registration (per Codex's auth spec — see Design
status below) IS the same PIN used to authorize withdrawals — there is no separate
"Security PIN"/"Payout PIN" concept the way earlier Nexus/space8-lineage projects had
one. Account's menu tile is labeled "Transaction PIN", not "Security PIN", to keep this
one system consistently named everywhere. When backend work starts: do not build two
separate PIN fields/hashes — one `transactionPin` (or equivalent) gates both first-time
setup and every withdrawal, matching what the registration screen already collects.

## Navigation / IA (confirmed, owner-supplied — 2026-08-26)

**4 tabs: Home, My Products, Team, Account.**

- **Home** — has an admin-configurable banner, **no activity/live ticker** (explicitly
  excluded, unlike space8 which has one), and **the full product catalog lives directly
  on Home** (not a separate "Products" tab like space8).
- **My Products** — the member's own active investments/plans (progress, next payout).
  Separate tab from Home's browse-and-buy catalog.
- **Team** — referral levels (L1/L2/L3), referral code/link, commission structure.
- **Account** — profile identity, wallet/menu tiles (withdrawal account, deposit/
  withdrawal history, security PIN, etc.), standard settings menu rows.

**Notifications feature removed (owner decision, 2026-08-26).** No bell/notifications
screen anywhere in Snow. Home's hero header had its bell stripped the same day and now
uses the same bespoke bell-less header as Account/Team (snowflake + `BOTTLE_BADGE` +
"SNOW" wordmark, white text since it's on the dark hero background). Known stale
residue: My Products' `top_bar()` header still renders a bell icon (leftover from the
round-4/5 spec) — owner explicitly said leave My Products as-is for now, so this is
NOT fixed yet. Strip the bell (and don't call `top_bar()` with a bell at all —
Account/Team/Home's bell-less bespoke header is the correct pattern) when My Products
finally goes through its own Codex critique round.

## Design status — settled on a Codex-authored system as of 2026-08-26, now mid-build

**Round 5 is the current, live design direction — read this section (and the round-5
AGENT_LOG.md entry, which lists all 7 fixes in detail) before touching visual design
again.** Round 4 established the token/component system below (still accurate, unchanged
in round 5). Round 5 applied Codex's critique of round 4's screenshots: one canonical
wave curve (used only on Home; Team/Account use a wave-less `brand-card` variant with
just the corner lines), a dedicated `--snow-wave-on-wine` token so the green corner
lines don't blend muddy-brown against the wine background, the full 10-product
catalogue with real bottle-photo thumbnails per tier (was hardcoded to 5), a fixed
cross-screen financial mismatch (Home's Total Invested/Earned now agree with My
Products' plan cards), and a fuller token/component set (`--snow-wine-soft`/
`green-soft`/`neutral-soft`, `--snow-radius-*`, `product-card`/`plan-card`/
`stat-tile`/`icon-tile`/`segmented-control`/`settings-list`/`list-row`/`top-bar`).
Rounds 1–3 (ice/blue, amber/gold beer-pour, dark wood-grain — all Claude-only
explorations) are superseded and should NOT be revisited; they're kept in
AGENT_LOG.md purely as history of what was already tried and rejected.

**The owner had Codex design the login/register screens directly** (screenshots
relayed back into chat, same review-prompt workflow already established on space8) and
Codex also produced a full written design-system spec at the same time. Both are now
the source of truth:

- **Visual reference screens** (Codex-designed, pixel-final, not to be altered without
  the owner asking): `snow/design/mockups/00-register.png`,
  `snow/design/mockups/00-login.png`.
- **Design tokens** (white/black/wine-red/green — **no blue, no amber/gold, no dark
  wood theme** — all three of rounds 1–3 are explicitly ruled out by this spec):
  ```css
  --snow-canvas: #FCFBF9;   /* main page background */
  --snow-surface: #FFFFFF;  /* cards, fields, sheets */
  --snow-ink: #111111;      /* headings and primary text */
  --snow-muted: #737373;    /* secondary text */
  --snow-wine: #941827;     /* primary CTA, hero, active state */
  --snow-wine-deep: #71101B;/* subtle hero depth only */
  --snow-green: #2F6B47;    /* waves, success, links, verified state */
  --snow-border: #E8E4E1;   /* field/card outline */
  ```
- **Radii**: main cards 28px, input cards 26px, primary buttons 24px, sheets/modals
  32px 32px 0 0. Soft clean shadows, thin warm-gray borders, not harsh box-shadows.
- **Brand language**: green snowflake mark + wordmark "SNOW"; wine-red hero areas with
  a large smooth white wave curving into the form/content area below, plus thin
  bottle-green parallel wave-line decorations in the hero's corners. Built with
  SVG/CSS shapes, not a screenshot background.
- **Component vocabulary Codex asked for** (build all future screens out of these, not
  one-off markup): `brand-hero`, `brand-wave`, `wave-lines`, `app-card`, `form-field`,
  `primary-button`, `secondary-button`, `status-pill`, `bottom-nav`, `bottom-sheet`.
- **Explicit product-behavior constraints from the same spec** (relevant once backend
  work starts, not just visual): registration fields are exactly Mobile number /
  Password / Transaction PIN (5 digits) — no confirmation fields, no referral/checkbox/
  social login unless the owner asks later; only show "Forgot password?" once a real
  reset flow exists; never log/store/expose a raw password or PIN in client state;
  money movement must stay server-side/idempotent with a ledger record per
  balance-changing event; frontend state is display-only.

**Claude then built Home, My Products, Team, and Account against this exact spec**
(not a redesign — a direct application of the tokens/components above), rendered as
static PNG screenshots via Playwright rather than an interactive Claude Artifact link,
per the owner's explicit ask (*"can you send me photos instead of artifacts of html"*)
so they're easy to hand to Codex directly:
`snow/design/mockups/01-home.png`, `02-my-products.png`, `03-team.png`,
`04-account.png`. Editable source for these 4 (plain standalone HTML, not the
design-canvas `.dc.html` format used in rounds 1–3) is at
`snow/design/mockup-src/*.html` + the Python generator `build.py` that produced them
(`python3 build.py` regenerates the HTML from the shared token/component definitions
inside it; screenshot with Playwright + `chromium` at `/opt/pw-browsers/chromium`,
390px width, `device_scale_factor=2`, `full_page=True`).

**Known limitation, disclosed to the owner**: the wave curvature and corner-line
decoration on Home/Team/Account's hero cards are Claude's own approximation of the
brand language Codex described in prose — Codex's actual SVG source for the
login/register hero was never shared, only the rendered screenshots, so the curve
shape is not pixel-identical between the two auth screens and these 4. If Codex's
critique flags the wave shape specifically, that's expected and worth fixing with
real coordinates from Codex rather than guessed ones.

**Status: Account has its own locked structure as of round 7/8 — a coloured card
matrix (feature cards + utility cards + Sign out), not a list.** Read the round-7/8
AGENT_LOG.md entries before touching Account again: they cover the exact
`.account-grid`/`.account-feature-card`/`.account-utility-card` CSS, why Records now
replaces separate Deposit/Withdrawal History tiles, why Transaction PIN has no card
here anymore, and how the real Snow Beer bottle photos got their backgrounds removed
(`rembg`, confirmed working offline in this environment — see that entry before
assuming background removal isn't possible here).

**Team was rebuilt in round 9 (2026-08-26) to match Account's card language** — a
wine-gradient `.team-referral-card` (referral code + copy bubble + invite-link pill +
share button), a 3-panel commission strip, a `.team-summary-grid` (total team/active
referrals tiles + a green `.team-deposits-card`), a pill-track `.team-level-switcher`,
and a member-list `app-card` with alternating wine/green avatar bubbles and
`+256 700 *** 123`-style masked phone numbers. Read the round-9 AGENT_LOG.md entry
before touching Team again — it also documents (and fixes) a `BOTTLE_BADGE` variable
ordering bug in `build.py` worth knowing about if `NameError` ever resurfaces there.
Team's header now shares the same bell-less bottle-badge layout as Account's, so
`top_bar()` is no longer called from Team's section.

Home and My Products are still governed by the round-4/5/6 spec described above
(Codex's original tokens/wave/component system) and have NOT yet been through their
own dedicated Codex critique round — only the shared bottom-nav icon/active-state
update and product-image-on-left fix have landed there. Do not treat Home or My
Products as final until they go through the same critique-and-rebuild pass Account
and Team already have.

## Build/backend — REAL APP BUILT as of 2026-08-26, ready for first deploy

**Owner override, same day**: after the "finish designing every screen first" sequencing
decision (below, kept for history) was recorded, the owner said "now ready to go" and
asked to build the real backend + frontend + admin immediately and deploy to Render, on
the current designs — explicitly accepting that Home/My Products haven't had their own
Codex critique round yet (only Account and Team have). This is the live decision; do not
revert to "finish designing first" without the owner saying so again.

**What exists now, real and working (not mockups):**
- `snow/server.js` + `snow/db.js` — Express/MongoDB backend, adapted from space8's
  proven money-safety patterns (claim-before-credit, `withLock` per-key mutexes,
  STATUS-BEFORE-REFUND, cumulative-target daily-cashback math, first-purchase-only
  referral commission) but re-scoped to Snow: Snow's own rates/product ladder, a single
  Transaction PIN set at registration (no auto-setup-on-first-use, no separate payout
  PIN), mobile-money-only withdrawal accounts (no bank transfer), no gift codes, no
  notifications, no check-in, no assistant chat, no multi-admin accounts — just one
  `ADMIN_KEY`. Verified: syntax-checked, boots cleanly against dummy Firebase creds
  (fails only at the expected Mongo-connect step with no live DB), and the full 10-tier
  product ladder's cumulative-payout math was verified in isolation to telescope to
  exactly `price × 30` over 150 days for every tier with zero rounding drift.
- `snow/user-src/index.html` (+ deployed copy `snow/user/index.html`, product images at
  `snow/user/bottles/`) — the real single-page app. Login/Register screens rebuilt to
  match Codex's locked `00-login.png`/`00-register.png` pixel-for-pixel in structure
  (verified via a static Playwright render); Home/My Products/Team/Account carry the
  exact markup + `--snow-*` CSS tokens/components from `build.py` straight into the real
  app, wired to live data instead of hardcoded mockup numbers. Firebase modular SDK
  (v10, gstatic CDN) for auth; a plain `api()` fetch helper attaches the ID token.
  Verified end-to-end with a mocked-backend Playwright harness (all 4 main pages +
  Deposit/Withdraw/Withdrawal-Accounts/Invest-confirm/Info sheets + the Register tab) —
  found and fixed one real bug this way (Account's bottom-nav icon looked up a
  nonexistent `ICONS.account` key and rendered "undefined").
- `snow/admin-src/index.html` (+ deployed copy `snow/admin/index.html`) — new MVP admin
  panel (Snow never had a prior admin to reskin, unlike space8's ChocoMCC-derived one):
  single-admin-key login, Dashboard stats, Users (search, credit/debit, ban/unban),
  Deposits (force-credit), Withdrawals (send/reject), Products (edit price/cycle/return/
  active/comingSoon), Settings (rates, maintenance, About/Rules/support text, home
  banner upload). Verified with the same mocked-backend Playwright approach — all 6 tabs
  render correctly and read live values with no console errors.
- `snow/render.yaml` + `snow/package.json` — mirrors space8's proven 3-service Render
  layout (`snow-server` web service, `snow-app`/`snow-admin` static sites with SPA
  rewrite rules and clickjacking-hardening headers). Validated as syntactically correct
  YAML/JSON with the right service names and `rootDir`s.
- **Live and deployed** to Render (`snow-server` at `mylifeismyhappiness.onrender.com`,
  plus `snow-app`/`snow-admin` static sites) — confirmed working end-to-end by the owner
  (real registration, welcome bonus credited, product catalog loading).
- **PWA** (both apps): `manifest.json`, branded `icon-192/512.png`, `sw.js` with
  network-first navigations / cache-first same-origin shell / never-cache cross-origin
  API responses (space8's proven anti-leak pattern), hourly + visibility/focus update
  checks, `controllerchange` auto-reload gated so it never fires on first-ever SW claim.
  User app additionally gates the reload on `window._moneyCallsInFlight` so a background
  update never interrupts an in-flight deposit/withdraw/invest call, and wires a real
  `beforeinstallprompt` capture into the "Install Snow" button.
- **Skeleton loaders** (user app) — shimmer `skRows()`/`skPage()` helpers, replacing all
  "Loading…" placeholders on Home/My Products/Team/Account.
- **Live countdown timers** (My Products) — computed from real `inv.createdAt` +
  `payoutsMade`, ticking every second, cleaned up on navigation and when no countdown
  nodes remain.
- **Admin push notifications** (deposits + withdrawal requests) — `sendAdminPush()` in
  `server.js` uses `admin.messaging().sendEachForMulticast()` against an `adminPushTokens`
  collection (doc id = token, so re-registering a device is a natural upsert; stale/
  unregistered tokens are pruned automatically from the multicast response). The deposit
  push fires only on a genuinely new credit (`creditDeposit()`'s `justCredited` flag), not
  on every idempotent retry/replay; the withdrawal push fires once, on the same
  single-attempt success path `/withdraw/request` already guards with
  `_witRequestInFlight`. `POST /admin/push/register` / `/unregister` are
  `verifyAdmin`-gated. Admin frontend: a Firebase Messaging module script (gstatic CDN,
  same non-secret client config as the user app) requests notification permission, gets
  an FCM token via the owner-supplied VAPID key, and registers it; a Dashboard card
  toggles enable/disable and remembers state in `localStorage`. `admin/sw.js` carries a
  `firebase-messaging-compat` background handler so pushes still show when the tab isn't
  focused (cache bumped to `snow-admin-shell-v2` for this). Verified: `node --check` on
  every extracted `<script>` block plus `admin/sw.js`, and a mocked-backend Playwright
  pass confirming the Dashboard push card renders and reads its enabled/disabled state
  correctly (the two Firebase-CDN network calls fail in this sandbox — no outbound
  access to gstatic.com here — same known limitation as the user app's Firebase Auth;
  not testable end-to-end until the owner tries it on the real deployed site).

## Round 12 (2026-08-26) — real space8-architecture port: backend now has multi-admin, gift codes, Task Center, activity feed, checkin, admin CRUD/analytics/integrity, and a working obfuscated build pipeline

**Why this round exists**: the owner's original Round 10 instruction was interpreted as
"build a lean from-scratch MVP" instead of what space8 itself was actually built as — a
literal reskin of an existing, proven codebase (see space8/CLAUDE.md's own "three-part
split": *"l told you everything admin we just replace, see ChocoMCC admin, we just
replace just name and logo, everything remains every feature, every code"*). The owner
was right and said so directly, pointing at real numbers: space8's `server.js` was 6,669
lines vs Snow's 2,023; space8's `admin-src/index.html` was 446KB vs Snow's 30KB; space8
has `assistant-engine.js`/`build-core.js`/`guard-src.js`/80+ `test-*.js` files that had
no Snow equivalent at all.

**server.js grafted with space8's missing architecture (2,023 → 2,807 lines)** — done as
an *addition* onto Snow's already-live, already-working money paths (deposit/withdraw/
invest/single-PIN registration), not a wholesale replace, specifically to avoid
regressing what the owner had just confirmed working in production:
- **Multi-admin staff accounts + sessions**: `adminUsers`/`adminSessions` collections,
  scrypt-hashed passwords, `DUMMY_PASSWORD_HASH` timing-attack defense on `/admin/login`,
  12h session TTL, `verifyOwner()` (owner-only actions) layered on top of the existing
  `verifyAdmin()` (which still accepts the raw `ADMIN_KEY` unchanged — no regression for
  the owner's existing login). `/admin/login`, `/admin/logout`, `/admin/admins/list`
  `/create`/`/deactivate`/`/reactivate`/`/reset-password`/`/delete`, `/admin/audit-log`.
- **Gift codes**: `GIFTCODE_CHARS` (same unambiguous alphabet as referral codes, 5 chars
  vs referral's 6 so the two can never collide by shape), case-sensitive redemption,
  `POST /redeem`, `/admin/promocodes/generate`/`/list`/`/deactivate`.
- **Task Center** (referral milestones on top of ordinary L1/L2/L3 % commission):
  `TEAM_MILESTONES`/`TEAM_DEPOSIT_MILESTONES` — Snow-scaled defaults (flat UGX 2,000/
  active-referral, flat 2.5% of whole-team deposits — **not yet confirmed by the owner,
  flag before treating as final**), `activeL1Count()`, `/team/milestone/claim`,
  `/team/stats` extended with `milestones`/`teamRewards`.
- **Activity feed**: simulated (not real transactions, same as space8's — global/
  synchronized so everyone watching sees the same feed), `/public/activity-feed`, ladder
  scaled to Snow's real UGX 30,000–4,500,000 product range.
- **Daily check-in**: `dailyCheckin: 500` default (**not yet confirmed by the owner**),
  `checkinStreak`/`lastCheckin` self-healing streak math (ported from space8's
  `computeCheckinStreak`), `POST /checkin`.
- **Admin-settable EAT withdrawal-request hours**: `withdrawHoursEnabled/Start/End`,
  `isWithinWithdrawHours()`, wired into `/withdraw/request`.
- **Admin CRUD/ops completeness**: `/admin/user/reset-password`, `/set-phone`,
  `/repair-ledger` (single-user ledger rebuild), `/complete-registration`,
  `/attach-referrer` (with a cycle-guard walk), `/reconcile-checkin`, `/delete` (reparents
  the deleted account's own downline to its own referrer, then `recomputeTeamCounts()`
  walks the whole subtree rather than trying to patch counts with increments/decrements).
  `/admin/transactions/list`, `/admin/referrals/list`, `/admin/badges` (pending-count
  chips), `/admin/analytics` (deposits/withdrawals/investments/commissions + a
  time-of-day breakdown), `/admin/analytics/abuse` (reads `securityEvents`, already
  logged by existing abuse-detection code that had zero admin visibility before this),
  `/admin/integrity` (flags — never silently launders — a `walletBalance` vs.
  transaction-ledger-sum mismatch per user).
- **Auto-approve withdrawals**: `autoApproveWithdrawalsEnabled/IntervalSec/MaxAmount`
  (off by default), `autoApproveWithdrawalsTick()` sharing `processWithdrawalCore` with
  the manual "Send" button so it's exactly as safe/idempotent; `/admin/payments/sync`
  (on-demand reconciler run).
- **Real bug caught and fixed while adding all this**: `recountAllTotals()`'s "earned"
  bucket only ever summed `cashback`/`commission` transaction types — the moment
  check-in/Task Center/gift-code income started crediting `totalEarned` live (all three
  new this round), the very next "Recalculate totals" run would have silently wiped
  every user's checkin/milestone/gift-code earnings back to zero. Fixed before it could
  ever fire for real (added `team_reward`/`promocode`/`checkin` to the summed set) —
  this is the exact same bug class space8's own Round 16 hit and documents.
- `db.js`: indexes added for every new collection (`adminUsers`, `promoCodes` ×3,
  `promoRedemptions`, `securityEvents` ×2, `users.publicId`, `transactions.type`).

**Obfuscated build pipeline — `build-core.js` + `guard-src.js`, real and working, not a
copy-paste.** Ported space8's pipeline (extract the big inline `<script>` out of
`user-src/index.html` into `user-src/original_module.js` on first run → obfuscate with
`javascript-obfuscator` → deflate+base64 → `DecompressionStream` loader IIFE → inline as
`<script data-nx-core>` in the deployed `user/index.html`; `guard-src.js` → domain-lock/
frame-bust/devtools-shield → `<script data-nx-guard>` in `<head>`), rebranded to
`snow-platform.com` and Snow's wine palette. `javascript-obfuscator` added as a
`devDependency` (build-time only, not needed on the deployed Render service).

**Two real bugs found and fixed while getting this to actually work** (verified via a
Playwright pass against the real built artifact with a mocked backend — not just
`node --check`, which only proves the obfuscated output is syntactically valid, not that
it *runs* correctly):
1. **`controlFlowFlattening: true`** (space8's own setting) broke a real runtime call
   somewhere in Snow's module once obfuscated — confirmed by toggling it off and
   re-testing. Left OFF in `build-core.js` with a comment explaining why: string-array
   encoding + hexadecimal identifiers already make the source unreadable (the actual
   goal), and shipping a broken app to get an extra obfuscation layer is not an
   acceptable trade for money-handling software. Root cause not chased further past
   confirming the fix — not worth the time for an optional extra layer.
2. **Real, general bug, not Snow-specific**: any top-level `const`/`let` declaration in
   `original_module.js` that's referenced elsewhere breaks post-obfuscation, even with
   flattening off. `renameGlobals: false` makes the obfuscator preserve top-level names
   by rewriting references through `window['name']` — correct and necessary for
   `function`/`var` declarations (those really do become `window` properties in a
   classic script) but silently wrong for `const`/`let` (which never become `window`
   properties, even at top level) — `window['MONEY_ENDPOINTS']` resolves to `undefined`
   even though `MONEY_ENDPOINTS` is a perfectly real, reachable local binding in the
   unobfuscated code. This is exactly why the unobfuscated app worked fine in every
   Playwright pass all session while the *first* obfuscated build threw
   `TypeError: window[...] is not a function` inside `enterApp()` — confirmed by
   diffing an unobfuscated vs. obfuscated Playwright run side by side, and confirmed
   fixed by converting all 5 of the file's top-level `const`/`let` (`API_BASE`, `ICONS`,
   `STATE`, `MONEY_ENDPOINTS`, `_countdownTimer`) to `var`. **Standing rule for every
   future edit to `user-src/original_module.js` (and eventually `admin-src/`'s own core
   script once `build-admin.js` exists): any new top-level binding must be `var`, never
   `const`/`let`, or it will silently break only in the obfuscated build, not in
   development** — a comment to this effect is at the top of `original_module.js` itself.
   Re-verified 4 independent full rebuilds (obfuscation output differs — hex names,
   string-array shuffling — on every run) all pass consistently after the fix.
- `user/sw.js` cache bumped to `snow-shell-v2` (the deployed `user/index.html`'s
  structure changed — real code, not just cosmetics).

**Still deliberately deferred, not attempted this round** (flag to the owner, don't
silently build later without asking): `build-admin.js` + an obfuscated `admin/`
(admin-src/index.html still ships unobfuscated — no UI exists yet for any of the new
backend features above either: multi-admin management, gift-code generation, Task
Center rate editing, referrals list, analytics/integrity dashboards, auto-approve
toggle — this is the very next round), the self-hosted assistant chat's actual content
(the engine/wiring pattern from space8 was not ported — `assistant-engine.js`/
`assistant-corpus.js` would need genuinely new Snow-specific training content, a content
task, not a porting task), and the full ChatGPT/Codex security-audit rounds space8 went
through (~30+ rounds, all documented in space8/AGENT_LOG.md) — ask Codex for a review of
this round's diff before the next one, per the owner's explicit "per round Codex review"
request.

**Before this can go live**: the owner needs to (1) finish the MongoDB Atlas database
user setup (pick a Built-in Role, click Add User — see Live infra below), (2) set
`MONGODB_URI`/`FIREBASE_SERVICE_ACCOUNT`/`ADMIN_KEY`/`MARZPAY_KEY` as env vars on the
`snow-server` Render service (never commit these), (3) update `API_BASE` in both
`user-src/index.html` and `admin-src/index.html` once the real `snow-server` Render URL
is known (currently a placeholder `https://snow-server.onrender.com`), (4) create the 3
Render services from `render.yaml` (or match it manually), (5) do a real end-to-end
device test — nothing here has been exercised against a live Firebase project, live
MongoDB, or live MarzPay yet, only smoke-tested with mocked responses.

**Design-sequencing decision, superseded but kept for context**: earlier the same day,
the plan was to finish locking every screen's design (via the generator+screenshot+
Codex-critique loop) before converting anything to a real app, specifically to avoid
rebuilding already-converted screens every time a later critique reveals a shared-
component change (exactly what happened across Account rounds 6→7→8). The owner's
"build it now" override above replaces this — Home/My Products can still go through
their own Codex critique rounds later, applied directly to the now-real
`user-src/index.html` instead of `build.py`'s mockup generator.

## Live infra (provisioning started 2026-08-26)

- **Firebase**: project `snow-beer-cbf65`. Client-side web config (safe to commit —
  a Firebase web `apiKey` is not a secret, access control is Security Rules/App Check,
  same reasoning space8 already uses for its own committed config in
  `user-src/index.html`/`admin-src/index.html`):
  ```js
  const firebaseConfig = {
    apiKey: "AIzaSyDhaVbSaQyYRdSiP1LLze-Apb6kNNTVCsc",
    authDomain: "snow-beer-cbf65.firebaseapp.com",
    projectId: "snow-beer-cbf65",
    storageBucket: "snow-beer-cbf65.firebasestorage.app",
    messagingSenderId: "171510439127",
    appId: "1:171510439127:web:94f15dd79aa057e3d32492",
    measurementId: "G-4S4ZES85SS"
  };
  ```
  Nothing consumes this yet — no frontend code exists under `snow/` beyond the design
  mockups. When the real user-facing app is built, this goes into its Firebase
  init script the same way space8's does. The Firebase **service-account JSON**
  (server-side, genuinely secret) has NOT been provided and must never go in this repo
  when it is — only into the backend host's env vars, exactly like space8's
  `FIREBASE_SERVICE_ACCOUNT` on Render.
- **MongoDB Atlas**: owner is creating a dedicated `snow` database user (same shared
  cluster/project space8 and choco-mcc already use, separated by database name — see
  space8's own equivalent note in `space8/CLAUDE.md`). Mid-setup as of 2026-08-26: the
  Atlas "Add New Database User" dialog was screenshotted with username `snow` filled
  in but **no role selected yet** — Atlas requires at least one Built-in Role or
  Specific Privilege before "Add User" actually saves. Next step: pick a role (e.g.
  `readWriteAnyDatabase`, matching the existing `chocomcc` user's own role in that
  project, or a tighter `readWrite` scoped to just the `snow` database) and click Add
  User. **The generated password was never recorded in this repo** — the resulting
  full `MONGODB_URI` connection string is a secret and must go straight into whatever
  hosting platform's env vars end up running Snow's backend, never into a commit, and
  ideally never pasted into chat again either.

## Secrets — NEVER commit

MongoDB URI and the Firebase service-account JSON are the two real secrets Snow will
need once backend work starts — both live ONLY in the hosting platform's env vars,
never in this repo. The Firebase web client config above is the one exception
(genuinely not secret) — don't confuse the two when handling future infra messages.
