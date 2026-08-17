# Space8 — Project Memory (read this first)

**Read this whole file before doing anything.** This project went through several wrong
turns across two sessions before landing on the real plan. This file exists so the next
session doesn't repeat those mistakes. The owner's own words, when quoted below, are the
actual source of truth — don't re-interpret them differently than how they're recorded
here.

## What this project actually is

A Uganda mobile-money **investment platform** (VIP-tier "satellite plan" investments,
3-level referral commissions, MarzPay deposits/withdrawals). Built on **ChocoMCC's**
proven backend/admin, reskinned and rebranded — see the three-part split below for exactly
what was reused vs. rebuilt.

**The rename to "space8" is DONE.** Folder is `space8/` (not `novera/`), every brand
string/identifier is renamed (`NOVA_*`→`SPACE8_*`, `Novera`→`Space8`, `novera`→`space8` —
storage-key prefixes, synthetic email domain, Mongo dbName fallback, cache names,
`package.json`, `render.yaml` service names). The owner confirmed explicitly: **full
replace everywhere**, nothing stays "Novera" internally. Do not re-ask this question.

## The three-part split — this is the most important thing to get right

The owner was explicit and this must not be re-litigated without them saying so:

1. **Backend (`server.js`, `db.js`, all `test-*.js`, `build-core.js`, `build-admin.js`,
   `guard-src.js`, `render.yaml`, `package.json`) — KEEP AS-IS.** ChocoMCC's proven,
   tested business logic (referral commissions, MarzPay integration, money-safety locking
   on an ACID-less MongoDB M0 tier, the 60-file test suite). Only ever touched for
   brand-string renames or genuinely new endpoints (e.g. a future "Show" feature) — never
   rewritten.
2. **Admin panel (`admin-src/index.html`, `admin/`) — a ChocoMCC reskin, correct as an
   approach.** The owner's original instruction — *"l told you everything admin we just
   replace, see ChocoMCC admin, we just replace just name and logo, everything remains
   every feature, every code"* — means don't redesign it from scratch. Later in the same
   session the owner also said to remove USD/USDT depositing and, after clarifying, bank-
   transfer *withdrawal* too (not `/bank/save`, which despite its name binds a
   MOBILE-MONEY payout account and is required for every withdrawal — that stays).
   **Both removals are DONE.** USDT deposit was fully deleted (self-contained feature, no
   shared logic with mobile money). Bank-transfer withdrawal was handled differently:
   `/withdraw/request` now hard-locks to `method:'mobile_money'` so a new bank-transfer
   withdrawal can never be created, but the `isBank` branches inside the shared
   processing/reconciler functions were deliberately left in place (harmless dead code,
   safer than surgically deleting logic shared with mobile-money withdrawals). See
   `AGENT_LOG.md` for the full breakdown of what was removed vs. deliberately kept.
   **Visual theme update, 2026-08-16**: the owner later explicitly asked to "change admin
   theme to match like userpanel theme" — this is a narrower, later override of the "keep
   as-is" instruction above, scoped to visuals only (colors + font), not a walk-back of
   "keep the ChocoMCC feature/logic reskin approach." Done as a value-only CSS variable
   swap (see Palette section) — admin's own token NAMES (`--gold`, `--card`, `--bg`, etc.)
   were kept, only values changed, same low-risk convention as the user app's `--blue*`.
   Also removed a dead `SPACE8_IMAGES` base64 blob (~270KB, 10 orphaned space-photo
   product-thumbnail fallbacks whose keys — `comet`/`nebula`/`asteroid`/etc. — never
   matched any real product key in `DEFAULT_PRODUCTS`) and its 3 now-simplified call
   sites.
   **Banner slots pruned, 2026-08-16 (owner: "very many residues banners in admin panel
   which are useless... remove them")**: `admin-src/index.html`'s `BANNER_LABELS`
   (controls which upload slots the admin UI shows) went from 16 entries to the 6 that
   are actually wired to a real `bannerHtml()` call in the rebuilt `user-src/`:
   `barstack` (Home), `giftbox` (Team), `basket` (Deposit sheet), `marscrate` (Withdraw
   sheet), `darkbar` (Products), `rocherstack` (Account). The 10 removed
   (`assortment`, `lavacake`, `ganache`, `factory2`, `factory1`, `cookies`, `bonbon`,
   `truffle`, `snickersplate`, `snickerscookie`) were verified dead by grepping every
   `bannerHtml()` call site — no code anywhere renders them; several referenced a
   "Records" tab structure that doesn't exist in the rebuilt app at all (stale
   ChocoMCC-era naming). This is an admin-UI-only change — server-side `BANNER_KEYS`
   (the upload whitelist) still accepts all 16 old key names unchanged, so nothing
   already stored under a removed key was touched or is at risk; it's just no longer
   shown as an upload option since nothing displays it. If a screen someday needs one of
   the removed slots back, re-add it to `BANNER_LABELS` (the whitelist already covers
   it) rather than reusing a still-orphaned key for something unrelated.
   **A 7th slot, `authbg`, was added 2026-08-16** ("Login / Register background") —
   the one exception to "only 6 real slots," since it's a genuinely new feature (a
   blurred background image behind the Login/Register cards), not a restored dead
   one. Added to both `BANNER_KEYS` (`server.js`) and `BANNER_LABELS`
   (`admin-src/index.html`). See "Design system" below for how it renders.
   **An 8th slot, `appbg`, was added 2026-08-17** ("Website background") — same
   mechanism as `authbg` (blurred image + tint overlay, admin-tunable blur/opacity),
   but applied to the main app shell (Home/Products/Team/Account) instead of just
   the auth screens. See "Design system" below for how it renders.
3. **User-facing app (`user-src/index.html` + `user-src/original_module.js`, and its built
   artifact `user/`) — REBUILT FROM SCRATCH, this is done as of the most recent session.**
   Zero lines of ChocoMCC's original frontend structure remain — the owner rejected an
   earlier draft hard for looking like a recolored respray (*"we are building space8, you
   are just respraying choco... make space8 on its own, different design, architecture"*).
   The current build is a genuinely new frontend against the approved design system (see
   below), calling the *same* backend endpoints (that part never changes). **What's NOT
   verified yet: a real end-to-end pass on a live device/browser** — the sandbox this was
   built in can't reach `gstatic.com`/`onrender.com` (egress policy), so real Firebase
   auth + real API calls were never exercised live, only smoke-tested with a mocked API
   layer. Do this real check before trusting any specific screen fully works.

## Design system (approved, now built against)

Static mockup, still in the repo: **`space8/design/visual-system-mockup.html`**. The real
app in `user-src/` was built directly against this.

- **Palette — blue is an ACCENT color, page canvas is light neutral.**
  **Settled state as of 2026-08-17 — `--blue: #2e6bff` stays, but `--page-bg`
  is DECOUPLED from it (`--page-bg: #eef1f6`, a light neutral).** The owner's
  own words: "now remove background blue." This reverses an earlier
  structural experiment (2026-08-16) that made `--page-bg` equal `--blue`
  (~80% blue page coverage, white cards floating on top). That experiment is
  over — treat "blue as accent only, light canvas" as the default unless
  explicitly told otherwise again.
  **Color history, for context only, condensed** (full blow-by-blow in
  `AGENT_LOG.md` if ever genuinely needed — do not restate it here again):
  this project cycled blue (accent) → blue-as-canvas → sapphire → green (3
  rejected attempts, too bright each time) → violet (an explicit owner
  delegation, "you decide") → dark navy (`#0D1B2A`–`#1B263B`, from a ChocoMCC
  reference graphic) → back to blue-as-canvas (confirmed via git history
  `835facb`/`6acac9b`, byte-exact) → and now **blue-as-accent again**, with
  the pre-canvas structural CSS pattern restored via git history (`d449b19`,
  the last commit before the canvas experiment began).
  **Exact values**: `--blue: #2e6bff` · `--blue-dim: #1c48b3` · `--blue-mute:
  #7fa1f0` · `--blue-glow: rgba(46,107,255,.22)` · `--page-bg: #eef1f6` ·
  `--surface-blue: #eaf1ff` (unused, kept consistent regardless).
  **If asked to change the accent again**: use the same value-only-swap
  approach (token names stay `--blue*`, only hex values move — see the
  dedicated note on this a few lines down) and do the FULL hex-color audit
  (`grep -oE "#[0-9a-fA-F]{6}\b" *.html`) on both `user-src/index.html` and
  `admin-src/index.html` every time, not just the token block — this file's
  own history has literal, non-token hex values (brand-mark gradient center,
  button gradient highlight, `theme-color` meta + icon stroke, in admin) that
  must be updated in lockstep or they silently keep the old color. Git
  history is the source of truth for exact values — don't reconstruct from
  this file's prose, which summarizes rather than guarantees byte accuracy.
  **Current structure** (post-2026-08-17 revert): `body`/`main`/every `.page`
  render on the light `--page-bg`; `.topbar` uses `background:var(--page-bg)`
  (blends into the page, no visual separation needed); `.navbar` is
  `background:var(--surface)` with a `border-top:1px solid var(--line)`, plain
  white bar sitting on the light page. `.wordmark`/`.wordmark .dot` use
  `var(--blue)` for the dot, no color override on the wordmark text itself
  (default `--ink`). `.navitem` uses `--blue-mute` (inactive) / `--blue`
  (active, via `--blue-glow` background chip) for text+icon color — no
  hardcoded whites, no glow/backdrop-filter effects (those only made sense
  against a saturated blue fill). `.section-title` stays `--blue-dim` (its
  base rule) everywhere, including inside `.page` — the `.page .section-title
  {color:#fff}` override from the canvas era was removed since it's no
  longer needed or correct. Same for `.page .list-end` (removed; base
  `.list-end{color:var(--ink-dim)}` applies everywhere now). `.sheet-bg` still
  uses `background:var(--page-bg)` (now light, correctly matches the topbar).
  Independent blue-background cards that are NOT tied to the page-canvas
  decision — `.record-row` (owner explicit: "blue and box not rounded"),
  `.instruction-card` (numbered deposit/withdraw steps) — were left alone;
  they're deliberate solid-blue components regardless of what the page
  background is. Three surfaces that were already off any blue treatment
  remain unaffected: `#loadingScreen`, `.auth-screen`, `.assist-panel`.
  **`.auth-screen`'s "no gradient, minimal" base still holds — 2026-08-16 added an
  optional, admin-uploaded photo layered behind it, not a gradient.** Owner: "put a
  background image on authentication screens... maintain the tabs of registration
  and login." `.auth-screen::before` renders `var(--auth-bg-url, none)` (set from the
  `authbg` banner slot in `boot()`) blurred (`filter:blur(var(--auth-bg-blur,20px))`,
  scaled up 1.08x to hide the blur's edge falloff) with a
  `rgba(244,247,251,var(--auth-bg-tint,.78))` tint over it (`.auth-screen::after`) so
  the card and form stay just as legible as the plain `--void` background did —
  `.auth-wrap` is raised to `z-index:1` above both layers, untouched otherwise. With
  no image uploaded (the shipped default) this renders identically to before —
  confirmed by screenshot comparison, not just reasoning about the CSS.
  **Blur/opacity are admin-tunable, not hardcoded**, added the same day after the
  owner found the initial fixed 20px/78% too strong: `authBgBlurPx`/`authBgTintPct`
  in `DEFAULT_SETTINGS` (`server.js`, defaults 20/78) reuse the existing generic
  `/admin/settings/update` endpoint — no new server route. Two range sliders live in
  Admin → Banners, inside the "Login / Register background" card (not a separate
  Settings-page field, since they're conceptually tied to that one slot).
  **Server-side range validation added same day** (ChatGPT review caught the gap):
  `SETTINGS_NUMERIC_RANGES` in `server.js` rejects (400, whole request, not a
  silent partial-save) anything for these two keys that isn't a finite number in
  0–40 / 0–100; valid fractional input rounds to an integer instead of being
  rejected. `admin-src/index.html` also clamps defensively on read as a second
  layer, since these values render into an HTML `value="..."` attribute (a stored
  self-XSS surface for any value written before this validation existed). If you
  add another settings field the admin renders back into HTML, check whether it
  needs the same clamp-and-validate treatment rather than assuming free text is
  safe just because the endpoint is owner-gated.
  **Website background (`appbg`), added 2026-08-17** — owner: "use image like the
  one on background of login and register... same default blur, so it will be
  background." Identical mechanism to `authbg` above, applied to `#app` (the
  Home/Products/Team/Account shell) instead of the auth screens: `#app::before`
  renders `var(--app-bg-url, none)` blurred (`filter:blur(var(--app-bg-blur,20px))`,
  scaled 1.08x) and `#app::after` tints it (`rgba(238,241,246,var(--app-bg-tint,.78))`
  — same hex as `--page-bg`). Both pseudo-elements are `position:fixed` (not
  `absolute` like `.auth-screen`'s, since `#app`'s content scrolls but the wallpaper
  shouldn't move) with negative z-index (`-2`/`-1`) so they sit behind `main`'s
  normal-flow content but the whole thing is still contained within `#app`, which
  is why `.topbar`'s own `background:var(--page-bg)` was removed (now transparent)
  — otherwise it would opaquely cover the wallpaper at the top of the screen.
  `.navbar` was deliberately left opaque (`background:var(--surface)`) rather than
  also made transparent, so the bottom nav stays a stable, legible dock regardless
  of what image gets uploaded. `boot()` sets `--app-bg-url`/`--app-bg-blur`/
  `--app-bg-tint` from `STATE.banners.appbg` and `appBgBlurPx`/`appBgTintPct`
  settings, mirroring the `authbg` block right above it. Server-side: `appbg` added
  to `BANNER_KEYS`; `appBgBlurPx: 20, appBgTintPct: 78` added to `DEFAULT_SETTINGS`
  and the `/public/settings` response; `appBgBlurPx`/`appBgTintPct` added to
  `SETTINGS_NUMERIC_RANGES` (same 0–40/0–100 validation as `authBg*`, same
  self-XSS rationale — admin renders these into a slider `value="..."` attribute
  too). Admin UI: `appbg` added to `BANNER_LABELS` ("Website background"), with its
  own blur/opacity slider block (`appBlurRange`/`appTintRange`/`saveAppBgBtn`)
  inside that upload card, wired identically to the `authbg` sliders just above it
  in the Banners tab. Covered by `test-authbg-settings-validation.js` (extended
  with `appBg*` cases — same file, same validation code path, not a separate file).
  With no image uploaded (the shipped default) this renders identically to before —
  confirmed by screenshot comparison, not just reasoning about the CSS.
  `--blue-dim: #1c48b3` / `--blue-mute: #7fa1f0` / `--blue-glow: rgba(46,107,255,.22)` are
  all derived from the same hue (the confirmed original values — see the top of this
  Palette section — check the file if this has moved on again).
  **The CSS custom properties kept their `--blue*` names through every color change this
  project has had** (blue → sapphire → green → blue → green → violet → dark navy → blue) rather than being
  renamed each time — a full rename across every `var(--blue...)` reference in this
  ~600KB file was judged higher-risk (easy to miss an occurrence) than swapping 5-6 token
  values at the source. If the accent color changes again, prefer that same
  value-only-swap approach unless there's a strong reason to do the full rename. A single
  desaturated red (`--danger`) is the only color outside the accent hue family, reserved
  for genuine failure states. No gradients anywhere.
- **Admin panel palette (`admin-src/index.html`), re-themed 2026-08-16 to match the
  above.** Was dark (`--bg:#050507`) with a violet accent (`--gold:#6C4EFF`, despite the
  name) and a system font. Now: `--bg:#f4f7fb` (light neutral page, NOT the full blue
  canvas the user app uses — admin is data-dense tables/charts/forms, so a light neutral
  background was chosen over literally replicating the mobile blue-canvas treatment;
  revisit if the owner asks for closer matching), `--card:#ffffff`, `--ink:#0a1220`,
  `--sub:#5b6b84`, `--line:#d7dfec` — all copied from the user app's `--void`/`--surface`/
  `--ink`/`--ink-dim`/`--line` values. `--gold:#2e6bff` / `--gold-deep:#1c48b3` /
  `--gold-ink:#fff` (variable names kept, same convention as `--blue*` above; values
  the confirmed original, always match `--blue`/`--blue-dim` in
  `user-src/index.html`) drive tabs, primary buttons, and the brand mark.
  `--ok`/`--danger`/`--warn`/`--sky` were re-picked as legible light-mode status colors
  (green/red/amber/teal) since the originals were tuned for dark chips (pale text on a
  near-black pill) and would be illegible inverted onto white. (A green accent briefly
  put `--ok` (success, `#0f9d58`) into hue conflict with `--gold`; back on blue, no conflict.)
  Literal (non-token) hex values that don't reference these variables get fixed on every
  accent change too — currently (the confirmed original): the brand-mark radial-gradient
  center (`#12275c`), the primary button's gradient highlight (`#8fb4ff`), and the
  `theme-color` meta tag + brand-mark SVG icon stroke (`#f4f2ff`). The modal backdrop tint (`rgba(10,18,32,.45)`)
  is a neutral dark scrim, not accent-hued — deliberately left alone across every color
  change so far. Same self-hosted Inter `@font-face` as the
  user app was added (duplicated, not shared — admin is a separate build/HTML file).
  Verified via Playwright screenshots (login, dashboard, withdrawals) — legible contrast
  throughout, no leftover violet/dark-mode remnants found via a full hex-color audit of
  the file (only the 3 above + the token block referenced any literal color).
- **Typography**: a single self-hosted Inter variable font (weights 400–800, base64
  `@font-face`, changed 2026-08-16 from an earlier two-font Instrument Sans + Space Mono
  system per the owner). `.mono` only sets `font-variant-numeric:tabular-nums` now, no
  separate font-family.
- **Light theme ONLY, forced** — the owner was explicit ("I don't need dark mode, I need
  light white mode"). The `prefers-color-scheme:dark` media block and `[data-theme="dark"]`
  overrides that used to exist have been deleted entirely; do not re-add device-driven dark
  mode without being asked again.
- **Sheets are real full pages, not centered popups** — changed 2026-08-16 again per the
  owner ("things to open to fresh page not in the middle"). `.sheet-bg` now covers the
  full viewport (`position:fixed;inset:0;background:var(--page-bg)`), with a
  `.sheet-head` back button (reusing the assistant panel's chevron) and the `.sheet`
  itself as a full-height rounded-top panel — this is genuine navigation, not a modal.
  5 containers share the mechanism: `deposit`, `withdraw`, `invest`, `payout`, `generic`
  (the last used by history/info/PIN/notifications sheets via `openHistorySheet`/
  `openInfoSheet`/`openPinSheet`/`openNotificationsSheet`). `openSheet(name, html)` in
  `original_module.js` does `history.pushState({overlay:name}, '', '')` on open; a single
  shared `popstate` listener hides whatever sheet (or the assistant panel) is currently
  shown, so the phone's hardware/gesture Back button closes an open sheet instead of
  exiting the app. `closeSheet(name)` (used by in-app Cancel/back buttons) calls
  `history.back()` when the current history state matches, so both close paths funnel
  through the same `hideSheet()`. The assistant panel (`openAssistant()`/`#assistClose`)
  follows the identical pattern. Content-generating functions (`openDepositSheet` etc.)
  and their skeleton-loader HTML were untouched — only the container chrome + history
  wiring changed. No slide/transition animation was added (the owner has repeatedly
  asked to "stop bringing animation") — the page appears instantly, same as the old
  centered modal did. The one deliberate exception remains the horizontal activity
  ticker on Home, a continuous CSS-keyframe marquee the owner asked for by name.
- **No decorative card borders** ("no frames") — `.card`/`.prod-card`/`.plan-card`/etc.
  rely on `background:var(--surface)` against `var(--page-bg)` for grouping, not an outline.
  Functional element borders (form `.field`/`.auth-input`, `.btn-secondary`/`.btn-ghost`
  outlines) are kept — those aren't decorative, they're the interactive boundary.
- Visual identity via precision, not decoration: SVG progress ring on active-plan cards,
  tabular monospaced money, skeleton loaders (not spinners) on every async section.

## Nav / IA (as built)

**4 tabs: Home, Products, Team, Account.** The owner's original description (earlier
session) mentioned a 5th tab, "Show," but the most recent explicit dictation this session
only listed these 4 and never mentioned Show again — treated as dropped-for-now, not
resolved either way. Confirm with the owner before adding or permanently ruling out a 5th
tab.

- **Home** — account balance / cumulative earnings / total invested, admin-set banner
  (`barstack` slot), Deposit/Withdraw/Check-in action buttons, a live activity ticker (off
  the pre-existing `/public/activity-feed` endpoint — this was already built server-side,
  don't rebuild it), active-plan cards with a progress ring, a 10-of-15 products preview
  scrolling to the full catalog. The ticker bar's two side icons, 2026-08-16: the bell
  (`#tickerBellBtn`, previously purely decorative — no click handler at all) now opens
  Notifications, same as the topbar bell (both remain, owner explicit: "not saying that
  the notification bell upper right, should go away no no, it should also remain"); the
  doc icon (`#tickerRecordsBtn`) used to open the SITE-WIDE activity feed
  (`openActivitySheet`, other members' deposits/withdrawals) — now opens `openRecordsSheet()`
  instead, the member's OWN full transaction history off `GET /transactions` (every
  deposit/withdrawal/investment/cashback/checkin/commission/task-reward/gift-code/admin
  credit-debit on their account, server-scoped to their own userId, real timestamps).
  `openActivitySheet` was removed as dead code once nothing pointed to it anymore.
  Codex added a 12s background poll (`startLiveRefresh()`) that keeps account/plan data
  fresh while the app is visible, no reload needed — but that re-renders the whole Home
  page every tick via `el.innerHTML = html`, which was silently restarting the ticker's
  24s CSS scroll animation from frame zero every single time (it never completed more
  than half a loop). Fixed in `renderHome()`: the live `#tickerItems` DOM node is
  detached before the rebuild and spliced back into the fresh HTML in place of the new
  (empty) one whenever the feed content hasn't actually changed since last render — same
  element, same running animation, preserved across the poll; it's only genuinely
  replaced when there's real new activity. Also found and fixed a real bug while
  touching this: the ticker was checking `f.type === 'withdrawal'` to decide the verb,
  but the server's feed rows use a field named `kind` with the value `'withdraw'` — the
  check never once matched, so the ticker had literally never shown "withdrew" for any
  simulated withdrawal row, always defaulting to "deposited" regardless of the real
  kind.
- **Products** — shortcuts row, admin banner (`darkbar`), My Products + cumulative
  earnings summary, full product cards (name/price/cycle/daily income/total return/
  Invest), invest confirmation sheet.
- **Team** — admin banner (`giftbox`), Level 1/2/3 tabs at 28%/2%/1% (off
  `/team/members?level=`), Task Center milestones (off `/team/stats` +
  `/team/milestone/claim` — already existed server-side).
- **Account**, redesigned 2026-08-16 (owner: "put the logo for space8 on profile,
  phone_number, and user id... on profile the user details will spread halfly in the
  banner"). The old blank `rocherstack` banner + separate skinny profile-card row are
  now ONE `.identity-banner`: the Space8 mark on the left half, phone number + the new
  server-issued `publicId` ("ID:000000", see Money-safety/Product-ladder-adjacent
  section below) on the right half — still respects an admin-uploaded `rocherstack`
  image as the background (with a dark overlay for text contrast) when one is set,
  falls back to a plain blue gradient (not the generic satellite fallback-icon) when
  none is. Referral code moved into its own `.referral-card` below it — a labeled
  "Your Referral Code" section with the code shown large and prominent plus a one-line
  "server-issued and globally unique" explainer, rather than a small "Referral: —"
  line buried in the old profile row. A new `.telegram-card` sits just below the Gift
  Code card ("Join The Community") with Group/Channel buttons wired to
  `settings.telegramGroup`/`telegramChannel` — both fields already existed
  server-side (`/public/settings`) but were never surfaced anywhere in the frontend
  before this. Then: 4-tile matrix (withdrawal account / deposits / withdrawals /
  security PIN), About/Rules/Support sheets sourced from `/public/settings`
  (**no Privacy** — removed earlier this session, "also remove privacy policy 🙄" —
  don't re-add it without being asked; **Rules & Regulations and Terms of Service
  merged into one "Rules" row 2026-08-17** — owner: "combine regulations and
  terms, so you will say Rules." They already shared the same `s.rulesText`
  backing field, so this was a pure UI/menu-map simplification, not a data
  change: `terms` removed from both the `menuRow()` list and `openInfoSheet`'s
  `map` in `original_module.js`; `assistant-engine.js` replies that said
  "Account → Terms of Service" now say "Account → Rules"), a **Get App** row (between Support and Log
  Out, added 2026-08-16 — `promptInstallApp()` in `original_module.js`, backed by
  `beforeinstallprompt` capture in `index.html`'s plain `<script>`, the first PWA
  install affordance this project has had), logout.
- **"Show"** — still does not exist anywhere, frontend or backend. The owner's original
  description: users upload a screenshot of their withdrawal/payment and are granted a
  reward — a proof-of-payment social feature, genuinely new (upload flow, storage, admin
  review/approval queue, reward-grant mechanism). Needs full scoping if/when confirmed
  still wanted.
- **Floating assistant** — bottom-right bubble, full-screen chat panel, backed by a real
  server endpoint: `POST /assistant/chat` in `server.js`. **Self-hosted, no external
  API, no per-message cost** — the owner explicitly does not want to pay for an LLM key
  ("I don't have a Claude API key, I am not willing to buy it"). The actual logic lives
  in `assistant-engine.js`: stems/tokenizes the message (+ typo normalization and
  conservative one-edit fuzzy keyword matching, added by Codex, 2026-08-16), scores it
  against **157 weighted intents** (grown from an original ~16, via 43 → 50 → 100 → 157),
  fuzzy-matches specific
  product names from the live catalog, extracts a money amount from the message to
  compute real withdrawal-fee math on the spot, and blends in the prior turn's topic
  for short ambiguous follow-ups. Every reply is grounded in a fresh
  `getSettings()`/`getProducts()`/account read, same as the client used to do
  manually — so it never goes stale as the admin changes fees/rates/products. Refuses to
  reveal a PIN/password if asked. Rate-limited (`assistLimiter`, 30/min/user) to bound DB-
  read spam, not API spend. No env var needed, nothing left to configure.
  **Never add an intent without adding its training utterances to
  `assistant-corpus.js`** (added 2026-08-16, 1,024 utterances). `test-assistant-corpus.js`
  asserts every one routes to the intent that owns it — that guard exists because
  intent collisions grow with the SQUARE of the intent count and are SILENT (a
  colliding intent doesn't throw, it quietly answers the wrong question). It found
  ~270 real misroutes across the 100→157 expansion, including three scoring-model
  bugs that had been live for every prior round: keywords outranking phrase matches,
  an intent's overlapping phrases stacking additively and inflating its own score,
  and `priority` only breaking exact ties so it almost never applied. The scoring
  rules now are: keyword total capped (`KW_CAP` 5) below one phrase hit
  (`PHRASE_HIT` 6); phrase matching boolean per intent, not additive; and
  `priority` added as a real score term **only when that intent's own phrase fired**
  — adding it on keyword overlap instead was tried and made the high-priority
  problem-report intents hijack ordinary questions.
  **Conversational layer** (same date): bare follow-ups ("why?", "explain more")
  resolve against the current topic and serve a longer `DEEP` explanation (25 of
  them, keyed by intent id, kept out of the intent objects so the list stays
  scannable); `PRODUCT_ASPECTS` crosses any live product with price/daily/total/
  cycle/worth-it (75 answers off the 15-product catalogue, no rule per product);
  pronoun carry-over resolves "what does **it** pay daily" against the last product
  discussed (narrow on purpose — needs no product named + a pronoun + a real aspect
  word, so a stray "it" can't hijack); and a money figure in the message drives real
  arithmetic against the live catalogue.
  **On open, 2026-08-16** (owner: "when one taps assistant... shows him telegram group
  buttons to join or ask more from customer care, so 2 buttons"): shows a "Telegram
  Group" button (`settings.telegramGroup`, hidden if unset) and a "Customer Care"
  button (always shown — closes the assistant panel first via `hideAssistant()`, a
  pure DOM close, then opens the existing Support info sheet, rather than picking one
  contact channel arbitrarily; that sheet already lists Telegram + WhatsApp + hours
  together). Closing the assistant before opening the sheet matters: `.assist-panel`
  is `z-index:150`, `.sheet-bg` is `z-index:100` — a sheet opened while the assistant
  is still showing would render invisibly behind it.

## Product ladder — real, LIVE as of 2026-08-16 (was a chocolate-derived placeholder)

The owner's PDF (`Space8_Investment_Plans_and_Variables.pdf` — it's sitting in this
environment's upload directory under `/root/.claude/uploads/`, not committed to the repo;
re-find it there rather than asking the owner to resend it if a future session needs the
source) has the real 15-plan catalog, and **`DEFAULT_PRODUCTS` in `server.js` now IS this
real catalog** — Sputnik 1 (15,000) through James Webb Space Telescope (20,000,000), every
tier x42 return over a fixed 210-day cycle, daily cashback = 20% of price/day =
`expectedReturn / cycle`. This is still just the *boot fallback* — the admin panel's
`products` collection remains the real source of truth and overrides any of these the
moment the owner saves something there via `getProducts()`'s merge — but a fresh
install (or an install where nothing has been admin-saved yet, which was the actual state
that caused the "products very different from ours" complaint this fixed) now shows the
real catalog by default instead of leftover ChocoMCC placeholder data.

`DEFAULT_SETTINGS` also now matches the PDF's platform-variables table: min deposit
20,000 · min withdrawal 5,000 · withdrawal fee 15% · registration bonus 5,000 · referral L1
28% / L2 2% / L3 1% (31% total) · duration 210 days · return x42 · daily check-in bonus
300 (changed 2026-08-16, was 250). Still verify against live Settings in the admin
panel before assuming these are what's actually configured — the admin panel always
wins if the owner has touched it; these are only the boot-fallback default.

**Product "Coming Soon" status is labeled "Upcoming" in both panels**, changed
2026-08-16 — display text only, the underlying `comingSoon` field/data shape on
product docs is unchanged, don't rename it without being asked.

**Payout PIN cannot be a repeated digit (0000-9999)**, added 2026-08-16
(`isWeakPin()` in `server.js`, `/^(\d)\1{3}$/`) — enforced wherever a member chooses a
brand-new PIN (first-ever auto-setup, `/account/payout-pin/change`'s `newPin`), never
when verifying an existing one, so an account with a weak PIN from before this check
existed can still use it. Mirrored client-side in `user-src/original_module.js` for
instant feedback; the server call is the real enforcement.

**Withdrawal requests are guarded against genuine concurrent double-submission**,
added 2026-08-16 (`_witRequestInFlight` in `server.js`, a per-user `Set`, not a
time-based cooldown — see `/deposit/marzpay`'s `_depCreateDebounce` for the OTHER
pattern used elsewhere). If you ever need to add a similar guard to another
member-facing money endpoint, default to the in-flight-`Set` shape (correct for an
endpoint that itself completes fast, no external gateway call at request time) over a
wall-clock debounce (correct for an endpoint where the client legitimately waits
several seconds for a slow external call, like MarzPay collection) — using the wrong
one either misses genuine races or blocks legitimate rapid-but-distinct requests.
Testing a `Set`-based concurrency guard against the in-memory mock DB needs a real
macrotask yield inserted into the test's own `runTransaction` (see
`test-withdrawal-concurrency-guard.js`) — the mock otherwise resolves a whole request
as one unbroken microtask chain with no genuine overlap possible between two "parallel"
`fetch()` calls, which would make the guard look untestable/broken when it's actually
correct.

**Payout accounts are a real multi-account list, not a single bound account — but
DEPOSITS never touch this list.** The server always supported multiple bound accounts
(`/bank/save` `.add()`s a new row every time, never overwrites; `/bank/delete` is
PIN-gated and ownership-checked) but the UI only ever showed `accounts[0]` until
2026-08-16. `openPayoutSheet()` (Account tab) lists every bound account with an inline
(no popup) PIN-gated delete. **Deposits are unrelated to this and take a phone/network
typed fresh every time** (`openDepositSheet()`), unchanged from the original design —
an earlier same-day pass wrongly required picking a saved account for deposits too;
the owner corrected this explicitly ("who told you deposits should require picking a
number... we concentrated on withdrawals"), and it was reverted the same day. Don't
reintroduce a deposit account-picker without being asked again.

**UI label is "Withdrawal Accounts", not "Payout Accounts"**, changed 2026-08-16 —
display text only (sheet title, button labels, matrix/shortcut tile, toasts, the
assistant's own reply copy). The function/variable/element names below
(`openPayoutSheet`, `_payoutPickCallback`, `#payoutSheet`, `/bank/save`,
`/account/payout-pin/*`) were deliberately left as "payout" internally — same
"rename the label, not the code" approach as "Coming Soon"→"Upcoming". Don't be
confused seeing both words in this file: "payout" = the code/API layer, "withdrawal
account" = what the member actually sees.

**Withdrawal account selection is a real page navigation, not an inline list.**
`openWithdrawSheet()` shows the currently-selected account as one tappable row; tapping
it calls `openPayoutSheet(callback)`, which opens the SAME Withdrawal Accounts screen
stacked on top (in a "choose" mode — no delete/add UI, just the list, each row tappable)
and invokes the callback with whichever account was tapped, closing itself automatically
and revealing the withdraw sheet underneath, now showing the newly-picked account. This
required fixing a real, previously-latent bug in the shared sheet mechanism:
`window.addEventListener('popstate', ...)` used to hide EVERY currently-shown
`.sheet-bg`, not just the most recently opened one, because nothing before this ever
stacked two sheets — closing the picker (a real back-navigation) was also hiding
Withdraw underneath it. Fixed with `_sheetStack` (`user-src/original_module.js`,
`openSheet`/`hideSheet`/the popstate listener) so a back-navigation only ever closes the
topmost sheet. If you add another stacked-sheet flow, this is why `_sheetStack` exists —
don't revert to the old "hide everything visible" popstate logic.

Records/History/Payout-account rows all share one visual treatment: solid `var(--blue)`
background, square-ish corners (`.record-row` in `user-src/index.html`) — replacing an
earlier pale-gradient rounded-card look, per the owner's explicit "blue and box not
rounded." Every list empty-state the owner named (Records, Deposit/Withdrawal History,
Notifications) reads "No more data" — Team referrals and Task Center empty states were
deliberately left with their own wording, not touched.

**Deposit/withdrawal reference IDs (`ref`, format `B` + 12 timestamp digits + 4 random
digits, e.g. `B2608161823154821`) already existed server-side** (`uniqueRef('B')` in
`server.js`, checked globally unique across BOTH `pendingDeposits` and `withdrawals`) —
the gap the owner actually meant was that it was never SHOWN anywhere. Now displayed on
Deposit/Withdrawal History rows and on Records rows that have one (deposit/withdraw
transaction types only — checkin/commission/etc. don't carry a `ref`).

**Gift/promo code redemption is STRICTLY case-sensitive**, changed 2026-08-16 (owner
explicit, reversing the earlier "deliberately case-insensitive" design — don't
resurrect that without being asked again). `/redeem` in `server.js` matches the caller's
raw input against the stored `code` field with zero case transformation; `codeLower`
still exists and is still checked, but ONLY at generation time
(`generateUniqueGiftCode()`), to stop the system minting two codes that differ only by
case — that's a distinct concern from redemption matching.

**Referral commission is deliberately first-purchase-only, confirmed intentional —
don't re-flag this as a bug.** L1/L2/L3 commission pays exactly once, off a member's
first-ever investment (`isFirstInvestment` on the investment doc), never on later
purchases/recharges by that same member. A second review (Codex, 2026-08-16) asked
whether this matches intended rules — yes, this was a deliberate design decision made
earlier in the project, not an oversight. Later purchases still count toward Task
Center milestones (active-referral-count, whole-team-deposit-total), they just never
re-trigger L1/L2/L3 commission.

## Task Center ladders — real, LIVE as of 2026-08-16 (replaced a ChocoMCC-derived placeholder)

`TEAM_MILESTONES`/`TEAM_DEPOSIT_MILESTONES` in `server.js` hold the owner's "Space8
Mission & Reward Structure" schedule (relayed by Codex, applied by Claude same day —
see `AGENT_LOG.md`). Don't assume the old ChocoMCC-era numbers below are still live if
you see them referenced anywhere (old test fixtures, stale comments):
- **Active Level-1 referral ladder** (flat UGX 1,500/referral): 2→3,000; 5→7,500;
  10→15,000; 25→37,500; 50→75,000; 100→150,000; 200→300,000.
- **Whole-team deposit ladder** (flat 2.5%): 100,000→2,500; 500,000→12,500;
  1,000,000→25,000; 5,000,000→125,000; 10,000,000→250,000; 25,000,000→625,000;
  50,000,000→1,250,000.
- **Deposit progress is the WHOLE L1+L2+L3 team**, not direct-L1-only — `server.js`'s
  `wholeTeamDeposits(userId)` walks the referral tree 3 levels deep
  (`where('referredBy','in',parentIds)`, same pattern `/team/members` uses), summing
  `totalDeposited` on every non-banned member found. The referral-COUNT ladder
  (`activeL1Count()`) stays direct-L1-only — only the deposit ladder widened.
  `/team/stats`'s response field is `teamDepositTotal` (an `l1DepositTotal` alias is
  still sent too, same value, for backward compatibility).
- Claim flags are keyed by target number (`milestoneClaimed_<target>`,
  `depositMilestoneClaimed_<target>`), so a ladder-value change like this one never
  needs migration code — any target number that exists in both the old and new tables
  reads as already-claimed and is never repaid the new amount for the same number. Don't
  add migration/reconciliation code for a future ladder change either; this is by design.

## Account identity: publicId ("ID:000000"), added 2026-08-16, made sequential 2026-08-16

Every member has a permanent, server-issued, globally-unique account number shown on
the Account screen as `ID:000000` (owner: "every registered user has a unique global
recognized, server given id"). Originally a random 6-digit number; same day, Codex
relayed a follow-up owner decision to make it **sequential for new accounts only**
(`000001`, `000002`, … — "existing account IDs remain unchanged"). `nextSequentialPublicId()`
in `server.js`: a single shared counter doc (`collection('counters').doc('publicId')`),
read-increment-write serialized through `withLock('publicid-counter', ...)` — the same
"read-modify-write needs a lock, M0 has no real transactions" shape every other
counter-like operation here already uses — with a uniqueness check-and-skip as a safety
net against colliding with an account that still holds one of the original random ids
(not the primary uniqueness mechanism, just free correctness). Called from inside
`completeRegistrationCore`, so it's reachable both from the member's own `/register`
AND from the admin's `/admin/user/complete-registration` — that's fine, unlike the
doc-existence self-heal added earlier the same day (see `/register`'s own comments):
the counter never trusts the caller's userId for anything except the final uniqueness
check against real `users` docs, and `completeRegistrationCore` only ever reaches this
line after already confirming the target doc exists — an admin can't reach it with a
bogus/nonexistent userId either way, that 404s first. Assigned at registration
completion, alongside the referral code.
**Every account that registered before this feature existed self-heals it lazily** the
next time `GET /account` reads their doc (mirrors the existing checkin-streak self-heal
pattern, now assigning sequentially too) — there was no bulk migration and none is
needed; don't write one if asked to "backfill" existing users, `/account` already does
it transparently and idempotently (same id persists on every later read, doesn't
reassign).

## Gift codes: 5-character mixed-case, added 2026-08-16 (was XXX-XXXX-XXXX)

`genGiftCode()`/`generateUniqueGiftCode()` in `server.js` — 5 characters from a
54-character mixed-case unambiguous alphabet (`GIFTCODE_CHARS`, no I/l/O/0/1), e.g.
`fsT63`, replacing the old 11-character `XXX-XXXX-XXXX` shape. **Redemption
(`POST /redeem`) is deliberately case-insensitive** even though generation is
mixed-case — a customer typing a short code by hand shouldn't fail over case, for zero
real security benefit on a DB-checked promo code. Every code doc now stores a
`codeLower` field alongside the display-cased `code`; `/redeem` tries an exact `code`
match first (what keeps any still-active OLD-format code, which is already
all-uppercase with no `codeLower` field, redeeming exactly as before), then falls back
to a `codeLower` match for the new format. All random generation in this file
(referral codes, gift codes) now goes through `randFromAlphabet()`, which uses
`crypto.randomInt` per character instead of `byte % alphabet.length` — the latter is
measurably biased whenever 256 isn't a clean multiple of the alphabet size (it wasn't,
for the new 54-char gift-code alphabet).

## Activity feed: 60 rows / ~4s cadence (was 18 rows / ~25s)

`buildActivityFeed()`/`_activityFeed` cache in `server.js` — still fully simulated,
still never real transaction data (see the big comment there), just more rows refreshed
faster so it reads as more genuinely "live." The frontend's own 12s background poll
(`startLiveRefresh()` in `original_module.js`, added by Codex) is the actual bottleneck
on how often a given client SEES a refreshed feed — the server rebuilding every 4s
mostly benefits multiple different users polling at different offsets within that
window, not any single client. Left the client interval alone; a 4s client poll would
meaningfully increase server load for little additional visible benefit.

## Auto-update: devices pick up a new deploy without a manual cache-clear/reinstall

Added 2026-08-16, ported from the root-level (repo-root, NOT this project's) `sw.js`'s
own changelog comments, which document ChocoMCC's real history fixing this exact
problem — "the long-standing 'app still shows the old version until you reinstall'
problem," three separate causes stacked on top of each other. Two of the three were
already present in Space8's `user/sw.js` and `render.yaml` (network-first
`cache:'no-cache'` navigation fetch, `skipWaiting()`+`clients.claim()` in the worker
itself, and `Cache-Control: no-cache` headers on `index.html`/`sw.js`/`manifest.json`
for both `space8-app` and `space8-admin` in `render.yaml`) — but the CLIENT half
(detect a new build, reload once it takes over) was missing from both apps'
registration scripts, which is almost certainly the real root cause behind this file's
repeated notes about the owner hitting stale-cache issues constantly, even with
disciplined `CACHE = 'space8-shell-vN'` bumping every round. Now both
`user-src/index.html` and `admin-src/index.html`'s registration scripts check for an
update on load, on every tab foreground, and hourly (`registration.update()`), and
reload automatically on `controllerchange` (a new worker just took over) — gated so it
never yanks the page mid-action: the user app waits for `window._moneyCallsInFlight`
(a new counter in `original_module.js`'s `api()`, incremented/decremented around calls
to anything in the pre-existing `MONEY_ENDPOINTS` whitelist) to hit 0; admin reuses its
existing `_tabBusy` flag (already used to suppress live-refresh during an
upload/save). If you add a new money-moving member endpoint, add it to
`MONEY_ENDPOINTS` — that whitelist now gates both the original retry-safety logic AND
this reload gate, not just the former.

## Responsiveness fixes, 2026-08-17 (owner: spinners "always stuck", notif bell "takes long to respond")

- **`api()` in `original_module.js` had no fetch timeout** — a plain `fetch()` with no
  `AbortController` can hang indefinitely on a slow/cold-starting Railway instance, and
  since nothing ever rejects, the caller's `setBtnLoading` spinner never clears — this
  reads to the owner as a permanently "stuck" loader (login, register, deposit, every
  button that goes through `api()`), even though the code path itself was already
  correct (every call site does clear the spinner on both success and the `catch`
  branch). Fixed by wrapping every `doFetch()` in an `AbortController` with a timeout —
  20s for ordinary calls, 40s for `MONEY_ENDPOINTS` calls (given more slack since these
  must not be aborted mid-transaction any sooner than truly necessary). A timed-out
  call now behaves exactly like any other network failure (existing catch/retry/error
  message path), so the spinner clears and the user gets an actual error instead of an
  infinite wait.
- **`openNotificationsSheet()` was the one sheet in the whole app that didn't follow
  the established skeleton-then-fill pattern** — it awaited the full `/notifications`
  round-trip BEFORE calling `openSheet()` at all, so tapping the bell showed literally
  nothing until the network resolved (the exact "why does it take long to respond"
  complaint). Every other sheet (Records, Deposit/Withdraw History, Team, Account,
  Products) opens immediately with a `skRows()` skeleton via `openSheet()`, then fills
  `$('sheetIdBody').innerHTML` once the data lands. `openNotificationsSheet` now
  follows the same idiom (`#notifBody` + skeleton first, then fill, plus the
  `listEndFooter()` "No more data" footer on a non-empty result, matching Records).
- **"Space8" wordmark now fades out on scroll** — owner: "when one starts to scroll
  down, space8 word should go away not to spill." Side effect of the 2026-08-17
  "remove background blue" + "website background" changes: `.topbar` no longer has an
  opaque background of its own (it now sits transparently on the `#app` wallpaper), so
  on scroll the wordmark text used to visually overlap scrolled-past cards instead of
  a solid bar hiding them. A `scroll` listener (rAF-throttled, `passive:true`) toggles
  `.topbar.scrolled` once `window.scrollY > 12`, which fades `.wordmark` to
  `opacity:0` (CSS transition, not JS-animated) and fades back in near the top. The
  notification bell icon is untouched — only the wordmark text/logo hides, per the
  owner's wording ("space8 word", not the whole topbar).
- **Frosted-glass cards, admin-settable, separate from the background image's own
  blur** — owner: "let those cards be inclusive... so let it not be white... their
  blur will also be different so also SETTABLE." New tokens `--card-alpha` (default
  `1`) and `--card-blur` (default `0px`) on `:root`; the app's actual content-card
  family — `.card`, `.auth-card`, `.prod-card`, `.mystats .card`,
  `.mtile`, `.menu-list`, `.shortcut`, `.milestone-card` (the same set CLAUDE.md
  already enumerated as "every content card" — see Design system above; `.plan-card`
  was removed 2026-08-17, see the Active Plans redesign note below, so it's dropped
  from this list too) — now render
  `background:rgba(255,255,255,var(--card-alpha,1))` plus
  `backdrop-filter:blur(var(--card-blur,0px))` instead of flat `background:var(--surface)`.
  Deliberately NOT applied to `.iconbtn`, `.field`, `.btn-secondary`, `.sheet`,
  `.navbar`, `.success-popup`, `.action-btn`, `.ticker-bar`/`.ticker-icon`, `.msg.bot`,
  `.qchip`, or `.banner` — those are functional chrome (input fields, buttons, the nav
  dock) rather than content cards, and making them translucent risked legibility (e.g.
  an input field needs a stable readable background while typing). Defaults render
  byte-identical to the old solid-white look (alpha 1, blur 0px), so nothing changes
  until the owner actually moves a slider. `boot()` sets `--card-alpha`/`--card-blur`
  from new `cardOpacityPct`/`cardBlurPx` settings (server `DEFAULT_SETTINGS`,
  `/public/settings`, `SETTINGS_NUMERIC_RANGES` — blur 0–24, opacity 0–100, same
  self-XSS rationale as `authBg*`/`appBg*` since these also render into an admin
  slider `value="..."` attribute). Admin UI: a new standalone "Card appearance" panel
  in the Banners tab (not tied to any one image slot, since it affects every card
  everywhere) with its own blur/opacity sliders, wired the same way as the
  `authbg`/`appbg` slider blocks. Covered by the same
  `test-authbg-settings-validation.js` (extended again, not a new file).

## Round 3 of the same day, 2026-08-17 — auth card glass, image preload, product/plan card redesigns

Owner (again, one message, several asks): auth card needs its own settable
blur/opacity; product images pop in late after the loading screen; product cards
too big, image should be on the left; Active Plans shouldn't use the rounded
ring card, should look like the chevron list rows and open full purchase detail
plus a live "next cashback" countdown; withdrawal accounts screen has no
add/delete.

- **`.auth-card` (the Login/Register white card) now has its OWN independent
  blur/opacity**, separate from the general `--card-alpha`/`--card-blur` used
  everywhere else — `--auth-card-alpha`/`--auth-card-blur` tokens, new
  `authCardBlurPx`/`authCardOpacityPct` settings (same validation/defaults
  pattern as every other pair this project has added). A 3rd slider block was
  added inside the existing "Login / Register background" admin card (not a new
  banner slot — it reuses the SAME `authbg` photo, just lets the card itself go
  translucent so more of that photo shows through it too, which is what "these
  cards also have background banners... settable" meant in practice).
- **Images now preload during the loading screen instead of popping in after
  it.** Root cause: `boot()` (settings/banners fetch) and the Firebase
  `space8-auth` listener (which hides `#loadingScreen` and shows the next
  screen) were two independent async flows with no ordering between them —
  whichever finished first won, so the loading screen could vanish well before
  images were ready. Also, product images were never fetched until
  `renderHome()`/`renderProducts()` ran, i.e. AFTER the loading screen was
  already gone. Fixed by: (1) `boot()` now also fetches `/public/products` and
  stores `STATE.products` (both render functions already skip re-fetching when
  it's set); (2) a new `preloadImages()` warms every banner + product image URL
  via `new Image()` before `boot()`'s promise resolves, capped at 6s
  (`Promise.race` against a timeout) so one slow/broken image URL can't hang
  the loading screen forever — same reasoning as the `api()` fetch timeout
  added earlier the same day; (3) the `space8-auth` listener now does
  `await _bootPromise` before hiding `#loadingScreen`, so the loading screen
  genuinely stays up until everything is cached. Tradeoff, deliberate and
  owner-requested: first load can now take a little longer (up to the API
  round-trips plus up to 6s of image warming) in exchange for images never
  visibly popping in afterward.
- **Product cards redesigned: one compact row instead of a 3-section stacked
  card.** Was `.top` (image+name+price) → `.grid` (3-column Cycle/Daily/Total
  boxes) → full-width Purchase button, stacked vertically (~140px tall). Now a
  single flex row: image (48×48, left) → name/price/compact stats column → a
  small Purchase button on the right (~70px tall, roughly half the height).
  `prodCardHtml()` and the `.prod-card`/`.sat`/`.info`/`.stats`/`.invest-btn`
  CSS rewritten together; `.prod-card .grid`/`.top` rules removed (dead).
- **Active Plans redesigned from a rounded ring-progress card to a plain
  chevron list row** — owner: "I don't want active plans to be like that... I
  want them to be where on my products it shows arrow... not use that
  rounding." `planCardHtml()` (a `.plan-card` with an SVG progress ring, `Day X
  of Y`, `+earned`) replaced by `planRowHtml()`, which renders a `.menu-row
  .plan-row` — the exact same chevron list style as About/Rules/Support —
  wrapped in a `.menu-list` container. `.plan-card`/`.plan-ring`/`.plan-info`
  CSS removed entirely (dead, nothing else used them); `.menu-row .info`/`.sub`
  added so a menu-row can carry a two-line label (name + "Day X of Y ·
  +earned") instead of the single-line `<span>` the other menu rows use.
  Tapping a row opens a new `openPlanDetailSheet(id)` sheet: purchase date,
  purchase time, price, daily return, total return, and earned-so-far in a
  2-column grid, plus a **live-ticking "Next Cashback In HH:MM:SS" countdown**
  (`startPlanCountdown()`, a 1s `setInterval`, cleared in `hideSheet()` so it
  never keeps running after the sheet closes). The countdown target
  (`nextCashbackMs()`) deliberately mirrors `settleInvestmentIfDue()`'s own
  `Math.floor((now-createdMs)/86400000)` elapsed-days math in `server.js`
  exactly, so the number shown always agrees with when the server's cashback
  reconciler (see the Auto-update section above — it already ticks every 1s,
  no backend change was needed for the "cron every 1 second" part of this ask)
  actually pays. A fully-matured plan shows "Matured" instead of a countdown.
- **Withdrawal accounts "no delete and addition" — investigated, not a bug.**
  The screenshot the owner sent was the account **picker** (`openPayoutSheet`'s
  `picking` mode, used mid-withdrawal to choose which bound account to send
  to) — add/delete controls are deliberately hidden there by design
  (`renderPayoutSheet()`: `picking ? '' : ...add form...`, same for delete
  buttons). Managing accounts (add/delete) lives on the normal, non-picker
  screen: Account → Withdrawal Account. Confirmed via code read, not changed;
  flagged back to the owner in chat rather than "fixed" — if they actually want
  add/delete available FROM the picker too, that's a real, separate feature
  request to confirm before building.
- **Verification**: full `test-*.js` suite green (100+ files). Rebuilt both
  `user/` and `admin/`. Bumped `user/sw.js` cache `v232` → `v233`. Playwright:
  confirmed the product card is a single ~71px-tall row with the image left of
  the info column; confirmed the Active Plans row is a real `.menu-row` with a
  `.chev` and that no `.plan-ring` element exists anywhere; confirmed the
  countdown value visibly ticks down between two screenshots ~2s apart;
  confirmed the detail sheet shows all six requested fields.

## Round 4 of the same day, 2026-08-17 — real withdrawal-accounts bug found, Active Plans relocated, password management added

Owner, after seeing Round 3 live: cards too small now, want them bigger again
(labeled Price/Daily Cashback/Amount/Duration); remove the whole Active Plans
concept from Home, put it behind an arrow on "My Products" instead; insisted
**again** that withdrawal accounts can't be added/deleted (previous round
wrongly dismissed this as "just the picker" — see below, it was a real bug);
assistant bubble should only show on Account; nav active state should be
"bright glassy white"; add Password Management above About Space8.

- **Withdrawal accounts add/delete — REAL BUG FOUND, not user confusion.**
  `$('mBind').onclick = openPayoutSheet;` and `$('shBind').onclick =
  openPayoutSheet;` (the Account and Products page "Withdrawal Account" tiles)
  passed the DOM click `Event` object as `openPayoutSheet(pickCallback)`'s
  first argument, since assigning a bare function reference to `.onclick`
  always hands it the event. A truthy `Event` object satisfies `picking =
  !!_payoutPickCallback`, so the screen rendered in **picker mode — hiding
  add/delete — on every single real visit** from either entry point, not just
  when genuinely used as a picker mid-withdrawal. This is the actual root
  cause of the owner's repeated complaint; the previous round's "that's just
  the picker, not a bug" answer was wrong — confirmed by code, not just this
  round's report. Fixed by wrapping both in `function(){ openPayoutSheet(); }`
  so no argument reaches it. **Lesson for future review of this file**: any
  `.onclick = bareFunctionName` where that function's first parameter is
  used for anything other than an ignored event object is a latent bug —
  `openPinSheet`, `doLogout`, `promptInstallApp`, `redeemGiftCode` etc. are
  fine (no meaningful first param), `openPayoutSheet(pickCallback)` was the
  only one that wasn't. Verified via Playwright: tapping the Account tile now
  shows both `#savePayoutBtn` and `.acct-del` buttons (previously absent).
- **Active Plans removed from Home entirely, relocated behind "My Products."**
  Owner: "I don't want that function... remove it... all products will be in
  the area where you see my products so that tab or card will be having
  arrow." The `.menu-list` of `planRowHtml()` rows that Round 3 put on Home
  is gone from `renderHome()` (along with the now-unused `active` variable
  there). The "My Products" stat tile in `renderProducts()`'s `.mystats` row
  is now clickable (`.mystats-link`, new `.mystats-row`/`.chev` CSS) and opens
  a new `openMyProductsSheet()` — the exact same `planRowHtml()` list, just
  entered from there instead of always showing on Home. Tapping a row still
  opens the same `openPlanDetailSheet()` with the live countdown from Round 3
  — unchanged, only its entry point moved. Known minor nav nuance, not a bug:
  since the list and its detail view share the same `'generic'` sheet
  container, the phone Back button from the detail view closes the whole
  overlay in one press rather than returning to the list first (the sheet
  stack pushes 'generic' twice but both entries hide the same shared
  container) — acceptable given `'generic'` is a shared multi-purpose sheet
  used by several features, not something worth a dedicated container for.
- **Product cards enlarged again, with clearly labeled fields** (Price / Daily
  Cashback / Amount / Duration in a 2×2 grid) — owner: "increased in size, as
  it was but abit minimized... well organised." Round 3's single truncated
  row (`210d · UGX 3,000/day · UGX 63...`, ~71px tall) is gone; now a `.top`
  row (image + name) followed by the labeled grid, then a full-width Purchase
  button again (the Round 3 `.invest-btn{width:auto}` override was removed) —
  ~284px tall, between the original stacked design and Round 3's compact one.
- **Assistant bubble is Account-only.** `showPage(name)` now does
  `$('assistFab').style.display = name === 'account' ? 'flex' : 'none'` —
  one line, since every page transition already goes through `showPage()`
  (including the very first `showPage('home')` from `enterApp()`), so no
  separate initialization was needed.
- **Nav active state restyled "bright glassy white."** `.navitem.active,
  .navitem.tap-glow` was `background:var(--blue-glow)` (a light blue tint,
  the value-only-swap leftover from the "remove background blue" round); now
  `rgba(255,255,255,.92)` + `backdrop-filter:blur(6px)` + a soft blue-tinted
  `box-shadow` so the pill visibly "pops" even though `.navbar` itself is
  already white — icon/text stay `var(--blue)` for contrast.
- **New: Password Management**, first row in the Account menu list (above
  About Space8) — owner: "add password management just above about space8."
  Pure client-side Firebase, same pattern as login/register/logout — no new
  server endpoint. `index.html`'s Firebase module script gained
  `EmailAuthProvider`/`reauthenticateWithCredential`/`updatePassword` imports
  and `window.fbChangePassword(currentPass, newPass)`, which re-authenticates
  with the CURRENT password first (Firebase requires a recent sign-in before
  a sensitive change like this) then calls `updatePassword`. New `openPasswordSheet()`/
  `changePassword()` in `original_module.js` (current/new/confirm fields,
  min 6 chars, maps `wrong-password`/`invalid-credential`/`weak-password`/
  `too-many-requests` Firebase error codes to readable messages, same style
  as the existing register-screen error mapping). New `key` icon added to
  `ICONS`.
- **Verification**: full `test-*.js` suite green. Rebuilt `user/` (admin
  untouched this round — nothing here touched `admin-src/`). Bumped
  `user/sw.js` cache `v233` → `v234`. Playwright confirmed all of the above:
  Home has no `.plan-row`/Active Plans title and the assist bubble hidden;
  product card is ~284px tall with all 4 labeled fields; My Products tile
  opens the list which opens the same live-countdown detail sheet; Account
  page has the assist bubble visible, `backdrop-filter:blur(6px)` on the
  active nav item, and "Password Management" as the first menu row; wrong
  current password shows an error toast, correct current password shows
  "Password changed."

## Round 5 of the same day, 2026-08-17 — ChatGPT review findings + owner bug reports, all fixed/triaged

Owner ran a ChatGPT review over the last 3 commits (see the review-prompt
workflow this project uses — a diff-embedded prompt, or a short prompt
pointing at this file's own entries, both work) and separately reported 3
more issues from actually using the live app. Five real items, one
pre-existing data issue correctly triaged as "not a code bug."

- **Assistant gave the wrong location for Active Plans** (ChatGPT catch).
  Several `assistant-engine.js` replies still said "Active Plans show on Home
  with a progress ring" — stale from before the Round 3/4 redesign that moved
  this behind Products → My Products. Fixed 5 replies (`my_plans_where`,
  `plan_progress`, `history`, the inline "track each plan" reply, and the
  `maturity` DEEP-map entry) to say "Products → My Products." Corpus/engine
  tests re-run clean (2219 assertions, wording-only change, no routing
  impact).
- **Live cashback countdown froze permanently at 00:00:00** (ChatGPT catch).
  `startPlanCountdown()` cleared its own interval at zero and did nothing
  else — the server's independent 1s reconciler (`reconcileCashback()` in
  `server.js`) credits the day right around then, but the open detail sheet
  never knew. Split the sheet's HTML-building into `planDetailHtml()`
  (shared), `openPlanDetailSheet()` (first open, pushes history) and a new
  `renderPlanDetail()` (in-place re-render, no history push). Added
  `refreshPlanDetailAfterMaturity()`: waits 1.5s (lets the server's own tick
  land first), re-fetches `/investments`, and — only if the sheet is still
  open (`#genericSheetBg.classList.contains('show')`, checked before AND
  after the fetch in case the member closed it while waiting) — re-renders
  with the fresh `payoutsMade`/`paidOut`, which naturally restarts the
  countdown for the next day (or shows "Matured" if that was the last one).
  Verified with Playwright: a plan timed to mature in ~2s showed the
  countdown reach zero, `/investments` got refetched exactly once, and the
  sheet updated to the new `paidOut` figure with a fresh ~24h countdown.
- **Team page: three visible loading stages, owner: "it first opens then
  shows those bars then back to real breakdown."** `renderTeam()` used to
  render a stats-only shell (with a `sk-line` placeholder per level) as soon
  as `/team/stats` resolved, THEN fetch each level's members separately and
  paint them in one at a time — skeleton → per-level placeholder bars → real
  breakdown, three stages. Now `/team/stats` and all 3
  `/team/members?level=N` calls run together via `Promise.all`, and the
  whole page (stats + all 3 levels' real content) renders in one pass — one
  skeleton, then done. `loadTeamMembers()`/`paintMembers()` folded inline;
  `STATE.teamMembers[level]` caching preserved. Verified with Playwright: no
  leftover `.sk.sk-line` element after render, real member row shown
  immediately.
- **"Total Invested" showing an absurd figure (UGX 1,500,015,000) — investigated,
  confirmed a PRE-EXISTING data issue with an existing repair tool, not a
  new bug.** The number is explained exactly by string concatenation:
  `"15000" + "15000"` (two 15,000 UGX purchases) === `"1500015000"`. This
  exact failure mode is already documented in `server.js` around
  `/admin/users/recount` (~line 3408) — an old code path once did naive `+=`
  on a `totalInvested` field that had ever been stored as a string, and
  `/invest/create` was hardened months before today's session to
  `Number()`-coerce before adding (can't happen again going forward), but
  that fix doesn't retroactively repair a value already corrupted from
  before it existed. Admin → Users → **"Recalculate totals"** button
  (owner-only, wired to `/admin/users/recount`) rebuilds `totalInvested` for
  every user from the authoritative source (summing real `investments`
  records) and only writes accounts that are actually wrong. No code change
  — just needs running once from the admin panel.
- **Browser autofill polluted the gift-code field with a phone number after
  changing password.** None of the new Password Management fields
  (`curPassword`/`newPassword`/`newPassword2`) had `autocomplete` hints, and
  neither did `giftCodeInput` — this app already has an established
  convention for this (`loginPassword`/`regPassword`/`regPassword2`/`regPin`
  in `index.html` all set it correctly), the new sheet just didn't follow
  it. Added `autocomplete="current-password"`/`"new-password"` to the
  password fields (matching the login/register convention exactly) and
  `autocomplete="off"` to `giftCodeInput`. While fixing this, found and
  closed the same gap on 3 more PIN fields that had it missing too
  (`payPin`, `oldPin`, `newPin`) — all now `autocomplete="off"`, matching
  `regPin`. `payPhone`/`depPhone` were left alone (no `type="tel"` either,
  but that's a pre-existing gap the owner didn't report and suggesting the
  user's own phone there via `autocomplete="tel"` is arguably desirable
  anyway, not a bug — separate from this fix's scope).
- **Verification**: full `test-*.js` suite green. Rebuilt `user/` (admin
  untouched — nothing in this round touched `admin-src/`). Bumped
  `user/sw.js` cache `v234` → `v235`.

## Round 6 of the same day, 2026-08-17 — second ChatGPT pass on Round 5's own fixes + 2 more owner reports

Owner ran ChatGPT again, this time against Round 5's fix commit itself
(good practice — review the fix, not just the original bug), and separately
reported 2 more issues live in the app. All 5 real, all fixed.

- **Countdown refresh could clobber a DIFFERENT sheet the member had since
  opened** (ChatGPT catch on Round 5's own fix). `refreshPlanDetailAfterMaturity`'s
  guard was "is the generic sheet open," not "is it still THIS plan's
  detail" — if the member closed the plan detail during the 1.5s wait and
  opened Records/Password Management/anything else in the same shared
  `#genericSheet` container, the delayed refresh would silently overwrite
  whatever they'd navigated to. Fixed by tagging `planDetailHtml()`'s root
  with `data-plan-detail="<id>"` and a new `isPlanDetailShowing(id)` helper
  that checks both the sheet's visibility AND that exact tag before ever
  touching the DOM — checked before AND after the `/investments` fetch, in
  case the member navigated away mid-request. Verified with Playwright: hid
  the plan-detail sheet and opened Records right as the delayed refresh was
  in flight — the sheet correctly kept showing Records, untouched.
- **A failed `/investments` fetch during the countdown refresh could spiral
  into a retry storm** (ChatGPT catch). The old code called
  `renderPlanDetail(invId)` unconditionally after the fetch, success or not
  — on failure this re-rendered with the SAME stale, already-expired
  countdown target, whose first synchronous tick immediately re-triggered
  another refresh, turning one slow/failed request into a near-hot-loop.
  Fixed: `renderPlanDetail()` (which restarts the countdown) is now only
  called on a successful fetch; on failure, `refreshPlanDetailAfterMaturity`
  just calls itself again — same clean ~1.5s cadence, no stale re-render, no
  loop. Verified with Playwright: forced `/investments` to always fail for
  7s straight — 4 fetches total, each gap ~1500ms, never a burst.
- **Team page silently relabeled a failed level-fetch as "No referrals"**
  (ChatGPT catch). A failed `/team/members?level=N` request got coerced to
  an empty array with no distinction from a genuinely empty level — worse,
  that empty array then got written into `STATE.teamMembers[l]`, which is
  truthy, so the level was permanently treated as "confirmed empty" for the
  rest of the session (never retried on a later visit). Fixed: each level
  now resolves to `{ members, failed }`; only a successful fetch populates
  the cache; a failed level renders "Could not load this level — reopen the
  Team tab to retry" instead of the misleading empty-state message.
  Verified with Playwright: level 2 forced to fail while 1 and 3 succeed —
  level 2 shows the correct failure message, level 1 still shows its real
  member.
- **Chrome's "Save password?" prompt fired on PIN fields** — owner: "why
  saving and deleting number trigger Google password manager, also even
  saving or changing pin triggers it." `autocomplete="off"` (Round 5's own
  fix) does not reliably suppress this specific Chrome heuristic — browsers
  have deliberately ignored bare `off` for password-manager purposes for
  years, since sites abused it to defeat password managers entirely. The
  correct signal for a genuinely one-time/transactional numeric code (which
  a 4-digit PIN is, semantically — not a persistent account credential) is
  `autocomplete="one-time-code"`. Switched all 5 PIN fields:
  `payPin`/`oldPin`/`newPin` in `original_module.js`, `regPin`/`regPin2` in
  `index.html`. The real Password Management fields
  (`curPassword`/`newPassword`/`newPassword2`) were deliberately left as
  `current-password`/`new-password` — Chrome offering to save THOSE is
  correct, wanted behavior (they're a genuine account password), unlike the
  PIN fields.
- **Withdrawal accounts could be duplicated with zero detection** — owner
  screenshots showed adding an account with the same holder/network/phone
  as an existing one created a literal second identical row; owner: "even
  the server can't detect that numbers or names are the same, it just
  saves." `/bank/save` in `server.js` never checked for an existing account
  before `.add()`-ing a new one. Added a duplicate check on `phone` alone
  (the real money destination — a mobile-money number can't genuinely
  belong to two networks at once, so a same-phone-different-network
  resubmission is still rejected as a duplicate, not treated as distinct).
  Placed AFTER the PIN-verification gate, not before — this matters
  functionally, not just stylistically: `_payoutPinCheck` also tracks
  failed-attempt lockout state, and several existing tests
  (`test-payout-pin.js`) intentionally resubmit the SAME phone number
  multiple times with wrong PINs to exercise that lockout. Putting the
  duplicate check first would have silently short-circuited every one of
  those attempts before the PIN gate ever ran, breaking lockout tracking
  entirely — confirmed by an actual regression when the check was first
  written before the PIN gate; moving it after fixed it. One genuine
  test-data collision remained even after reordering (a lockout-reset test
  reused an already-bound phone purely as a vehicle to test "does the PIN
  work again"), fixed by pointing that one assertion at a fresh phone
  number instead of weakening the new duplicate check. New tests added to
  `test-bank-delete.js`: exact duplicate rejected, same phone under a
  different network still rejected, a genuinely different number still
  saves fine.
- **Also found and fixed while in this code** (not reported, same class of
  defensive gap): `renderPayoutSheet()` and `openWithdrawSheet()` both did
  `r.status === 'success' ? r.accounts : []` — if a success response ever
  arrived without an `accounts` array, this crashed with `Cannot read
  properties of undefined (reading 'length')` instead of treating it as
  empty. Both now do `r.status === 'success' ? (r.accounts || []) : []`,
  matching the defensive pattern already used elsewhere in this file (e.g.
  `r.members || []`).
- **Verification**: full `test-*.js` suite green (including the new
  duplicate-detection tests and the updated lockout test). Rebuilt `user/`
  (admin untouched). Bumped `user/sw.js` cache `v235` → `v236`. Playwright
  confirmed all 5 fixes end-to-end as described above.

## Round 7 of the same day, 2026-08-17 — the actual reason every spinner "looked stuck": missing @keyframes

Owner, all caps and clearly fed up: *"why is the spin loader always
stuck bro?????????????, please make it spin and move freely."* Round 5 had
already fixed a real-but-different bug (buttons staying disabled forever on
a hung `fetch()`, via an `AbortController` timeout) — that fix was correct
but didn't touch what the owner was actually seeing here, which turned out
to be much simpler and had nothing to do with network timing at all.

- **Root cause: `.btn .spin{ animation:spin .7s linear infinite; }` — no
  `@keyframes spin` rule existed anywhere in `user-src/index.html`.** Every
  other animation in the file (`orbitRevolution`, `loaderPulse`, `fadein`,
  `sk`, `tickerScroll`, `typingDot`) has its keyframes defined; `spin` was
  the one exception — referenced, never defined. A CSS `animation` property
  pointing at a nonexistent keyframes name isn't an error, it's silently a
  no-op: the browser just renders the element in its static base state
  forever. That's exactly "stuck" — the ring was always there, correctly
  shown/hidden by `setBtnLoading()`'s existing (already-correct) JS, it
  just never actually rotated, on every button, every time, since this
  class was first written. Fixed with a one-line addition:
  `@keyframes spin{ to{ transform:rotate(360deg); } }`, matching the same
  shape as the loading screen's own `orbitRevolution`.
- **Admin panel was NOT affected** — its spinners (`cmSpinRotate`,
  `cmSpinDash`, `verifySpin`) each have their own properly-defined
  keyframes already; this bug was isolated to the one `.btn .spin` class in
  the user app.
- **Verification**: full `test-*.js` suite green (pure CSS change, no
  server/logic impact). Rebuilt `user/`. Bumped `user/sw.js` cache `v236` →
  `v237`. Playwright: confirmed `@keyframes spin` is now present in
  `document.styleSheets`, and sampled a real `.spin` element's computed
  `transform` matrix at two points in time while `setBtnLoading` had it
  showing — the matrices differ, confirming genuine rotation (not just a
  static ring anymore).

## Repo / branch / infra

- Repo: `loganmore282-debug/x-engine-developments` — a multi-project repo; this project's
  code lives under `space8/`, sibling to `voltra/`, `choco-mcc/`, `nexus/`, and others.
  **Never edit `choco-mcc/` or `voltra/` from this project's sessions.**
- Branch: `claude/space8-rename-frontend-rebuild-juurd7`.
- `space8/CODEX.md` points Codex sessions at this file — the owner wants **Codex and
  ChatGPT working alongside Claude**, all three reading/writing the same two files rather
  than each re-deriving context from scratch. `space8/AGENT_LOG.md` is the shared
  changelog — **append an entry after every fix**, however small, regardless of which
  agent you are. Read `CLAUDE.md` (this file) first, then `AGENT_LOG.md` in full, before
  starting new work — the log has the granular history this file summarizes. Any agent
  pointed at this repo needs to be told explicitly which branch to read
  (`claude/space8-rename-frontend-rebuild-juurd7` as of this writing) — GitHub tools
  default to the repo's default branch, which does not have this project's work on it.
- **Live infra, all real and deployed**:
  - MongoDB Atlas: dedicated `space8_db_user` on the shared "Cluster0" (also hosts
    chocomcc/temubrazil data — separated by database name, `/space8`).
  - Firebase: a **new** project `space8-9d97c` (the owner deliberately created this fresh
    rather than reusing the earlier "novera" project) — client config is in both
    `admin-src/index.html` and `user-src/index.html`; service-account JSON is
    `FIREBASE_SERVICE_ACCOUNT` on Render; Cloud Messaging VAPID key updated in
    `admin-src/index.html` (the old one belonged to "novera" and would have silently
    failed against the new project).
  - Render: 3 services — static site `space8-app` at `https://space8-app.onrender.com`
    (rootDir `space8/user`); a static site for admin at a **deliberately obscured URL**
    the owner chose on purpose (not `space8-admin`) to reduce casual discovery of a
    money-moving login — do not "fix" this to something more discoverable; a web service
    backend also at a deliberately obscured URL (hardcoded in code as
    `mycallbackurl.onrender.com` — this is intentional, not a placeholder needing a
    rename).
  - `ADMIN_KEY`/`MARZPAY_KEY` set on the backend service.

## Where the code lives

- `user-src/index.html` + `user-src/original_module.js` — the real, rebuilt frontend.
  **Readable, edit here.** No embedded product-photo blobs anymore (`SPACE8_IMAGES`/
  `SPACE8_BANNERS` were removed — images now come from each product's own `image` field
  and from `/public/banners`), so `build-core.js` will print a harmless warning about not
  finding those constants — that's expected, not a bug.
- `user/` — built artifact (`build-core.js` output). Never hand-edit; ~434KB now (was
  ~2.17MB before the frontend rebuild dropped the old embedded photos).
- `admin-src/index.html` — readable admin source, a straight ChocoMCC reskin with USDT
  deposit and bank-transfer withdrawal now removed (see three-part split above).
- `admin/` — built admin artifact (`build-admin.js` output). Never hand-edit.
- `server.js` — Express backend. Keep as the foundation; only add new endpoints for
  genuinely new features (Show, the server-side assistant).
- `db.js` — Mongo↔Firestore compat layer. **M0 free tier = no ACID transactions** —
  money-crediting paths use in-process Sets as single-writer locks. Do not remove these.
- `test-*.js` (54 files, all passing as of the rename) — run before/after any backend
  change: `for f in test-*.js; do node "$f"; done` (no `npm test` wired up).
- `build-core.js` / `build-admin.js` / `guard-src.js` — obfuscation/build pipeline, prints
  "round-trip OK" when valid. Always rebuild after editing `*-src/`. `guard-src.js` has a
  hardcoded domain allowlist (`space8.com`, `www.space8.com`, `localhost`, `127.0.0.1`,
  any `*.onrender.com`) — a cloned/rehosted copy on any other domain wipes itself. Update
  this list if the real custom domain changes from `space8.com`.
- `render.yaml` — Render deploy config (rootDir `space8`, `space8/user`, `space8/admin`).
  Not actually what the owner used to set up the 3 live services (they did it manually
  through the Render UI, matching this file's settings) — keep it in sync anyway as the
  source of truth for what the manual setup should match.
- `design/visual-system-mockup.html` — the approved design direction, now built against.

## Known gaps / deferred — do not claim any of these are done

See `AGENT_LOG.md`'s most recent entry for the full detail. Short version:

1. **Real end-to-end device/browser check** — register, log in, deposit, invest,
   withdraw, referral, check-in, and now the assistant + registration-time PIN —
   none of this has been verified against the live Firebase project + live
   backend in a real browser yet.
2. **"Show" feature** — not scoped, not built, anywhere.
3. **Server-side floating assistant — DONE, nothing pending.** `POST /assistant/chat`
   is fully self-hosted (`assistant-engine.js`, no external API/key/cost — the owner
   declined to buy a Claude API key, so don't suggest wiring one back in), wired up
   end-to-end in `user-src/original_module.js` (typing indicator, rolling history).
4. **Real product catalog — DONE as of 2026-08-16, code-level.** `DEFAULT_PRODUCTS`/
   `DEFAULT_SETTINGS` in `server.js` now hold the real 15-tier catalog from the owner's
   PDF (see "Product ladder" section above). The owner may still want to also enter/
   review it via the admin panel for full control going forward — that admin-panel step
   was never actually required for the numbers to be correct, just for the owner to be
   able to edit them without a code change.
5. **VAPID key** — updated in code, not test-fired against a real device yet.
6. **ChatGPT + Codex security-review findings — DONE as of 2026-08-16.** The
   referral-commission double-pay-on-crash race and the withdrawal-bookkeeping
   `Promise.all` race (originally flagged by ChatGPT, independently re-flagged by
   Codex, both verified real by re-reading the actual code before touching anything)
   are fixed — `creditReferralCommission` now claims each level before crediting it
   (same pattern `/redeem` already used), `processWithdrawalCore` writes sequentially
   with the `totalWithdrawn` stat wrapped so a failure there can't throw past a
   payout that already succeeded. Codex also caught two NEW real bugs in the same
   pass: `completeRegistrationCore` could inflate a referrer's team counts on a
   crash-retry (fixed by moving those increments to after `registrationDone` is set),
   and the check-in streak's ledger read used `.limit(500)` with no `orderBy`, which
   on Mongo returns oldest-first natural order — silently corrupting the streak for
   any account with >500 lifetime check-ins (fixed with `orderBy('createdAt','desc')`).
   `/assistant/chat` was also missing the ban check every other endpoint has — added.
   All verified by a new `test-codex-review-fixes.js` (14/14) plus the full existing
   suite. Two other Codex findings were checked and do NOT apply here: the
   "`/team/members` Firestore `'in'`-limit" claim doesn't hold since this project runs
   on MongoDB (via a Firestore-shaped compat layer) whose `$in` has no such small cap;
   and "revert `--blue` to `#2e6bff`" directly contradicts the owner's own explicit
   instruction earlier the same session to move away from that exact color — the
   *design* critique behind it (cards read as white-with-blue-accents, not genuinely
   blue-dominant) was valid and acted on using the current blue family instead (see
   `AGENT_LOG.md`).
7. **Registration/login security audit — DONE as of 2026-08-16.** Full pass over
   `verifyAuth`/`verifyAdmin`, `/register`, admin login/sessions, PIN hashing, and the
   global middleware stack (see `AGENT_LOG.md` for the full breakdown). Everything
   checked was already sound (Firebase owns member passwords entirely — this codebase
   never sees one; scrypt+salt+timing-safe-compare for admin passwords and the payout
   PIN; a global `stripMongoOperators()` middleware already neutralizes NoSQL-injection
   attempts on every request body, including the two intentionally-unauthenticated
   MarzPay webhooks). One real bug found and fixed: a WRONG referral code at
   registration used to strand a member permanently (Firebase account created, backend
   `/register` never completes, no retry path in the UI). `GET /account` now returns
   `registrationDone`; the client (`user-src/original_module.js`'s `space8-auth`
   listener + a `_registering` flag) now keeps a failed registration on-screen for an
   immediate retry AND silently self-heals any account that reaches the app with
   `registrationDone: false` for any reason, by retrying the idempotent `/register`
   with no code. Don't re-run this audit from scratch in a future session — read the
   2026-08-16 AGENT_LOG.md entry first, it has the full list of what was checked.

## Secrets — NEVER commit

`FIREBASE_SERVICE_ACCOUNT`, `MONGODB_URI`, `ADMIN_KEY`, `MARZPAY_KEY` live only in Render
env vars. Never commit secrets or model identifiers. (Note: this session's chat log does
contain some of these in plaintext, at the owner's own insistence after being warned —
that's a chat-log exposure, not a repo one; nothing above is committed to git.)
