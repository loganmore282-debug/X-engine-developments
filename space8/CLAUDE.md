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
   **Both removals were done at the time**, and USDT deposit stays gone (self-contained
   feature, no shared logic with mobile money). **Bank-transfer withdrawal was
   REACTIVATED 2026-08-19** (owner: "we are adding banks... let it remain the same, same
   terms") — see "Withdrawal accounts now support banks too" below in Product ladder for
   the full current design; the `isBank` branches in `processWithdrawalCore`/the
   reconcilers that were deliberately left in place as dead code during the original
   removal are exactly what made this reactivation cheap. See `AGENT_LOG.md` for the full
   breakdown of the original removal and the 2026-08-19 reactivation.
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
   **Home-screen auto-cycling banner "slides", added 2026-08-18** (owner: "l want them
   to be floating again and again... l will add other banners that will slide one
   after the other") — deliberately NOT a 9th `BANNER_KEYS` slot: it's a variable-
   length LIST of images (0–`MAX_HOME_SLIDES`=8, `server.js`), stored in its own doc
   (`banners` collection, doc id `homeSlides`, field `slides:[{id,image}]`) so it can
   never crowd the single `banners/main` doc that already holds ~18 single-image slots
   toward MongoDB's 16MB per-doc limit. Admin endpoints: `GET /admin/banners/home-
   slides` (list), `POST .../add` (owner-only, same image-type/size validation as
   `/admin/banners/set`, rejects past the cap), `POST .../remove` (by id, 404 if
   already gone) — admin UI lives in `admin-src/index.html`'s Banners tab, right above
   the `barstack` slot's own card. `/public/banners` sends the images (in order, no
   ids — those are an admin-management detail only) as a sibling `homeSlides` array,
   not nested inside `banners`. Client (`user-src/original_module.js`): `homeBannerHtml()`
   falls back to the existing static `barstack` banner (or the default fallback icon)
   whenever 0 or 1 slides are configured — 2+ auto-cycles via ONE shared CSS
   `@keyframes` animation with each `<img>` phase-shifted by a negative
   `animation-delay` (the standard pure-CSS carousel trick — no JS interval to leak or
   double up), 4s per slide. `renderHome()` DOM-preserves the carousel node across its
   own 12s live-refresh the same way it already does for the activity ticker
   (`preservedTicker`/`preservedCarousel`, both in `renderHome()`) — without that, the
   silent background refresh would snap the animation back to slide 1 every 12s
   instead of actually cycling. **Real bug caught while testing, fixed before ship**:
   the new `/admin/banners/home-slides/add` route was left off `IMAGE_BODY_ROUTES`
   (`server.js`), so it inherited the 64kb `smallJsonParser` instead of the 4mb
   `bigJsonParser` every other image-upload route uses — every real upload past 64kb
   (i.e. basically all of them) would have failed with "Request is too large" the
   moment an admin actually tried it. `test-home-banner-slides.js` (20/20) covers
   auth, image-type/size validation, ordering, id-targeted removal, the cap, and the
   body-size route registration itself.
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

**Withdrawal accounts now support banks too, 2026-08-19** (owner: "we are adding
banks... let it remain the same, same terms, only l want when one selects network
mtn,airtel,plus all supported banks, so one can tap network and inputs account
number... no making another category it has remained the same"). One bind-then-pick
flow for BOTH mobile money and bank — not a separate screen/category:
- `payNetwork` (the add-form's network `<select>`, `renderPayoutSheet()`) now lists
  MTN Mobile Money, Airtel Money, then every bank `GET /public/banks` returns (live
  from MarzPay's own `/bank-transfer/banks`, cached server-side 60s via
  `getMarzBanks()`, cached client-side on `STATE.banks` for the session). The old
  phone-only field (`ico('phone')`, placeholder "07XXXXXXXX", `maxlength="10"`) is now
  a generic account-number field (`ico('bank')` — a new stroke-outline bank/institution
  glyph — placeholder "Mobile-money or bank account number", `maxlength="20"`).
- `/bank/save` (`server.js`): a `network` not in `NETWORK_NAMES` is now treated as a
  bank name — the account number is validated LIVE against MarzPay
  (`marzValidateBankAccount`, the same `/bank-transfer/validate` call the
  now-reactivated bank-transfer rail already used) before ever being saved, closing
  both "is this a real bank" and "is this a real account" in one call, no static bank
  whitelist to keep in sync. Stores `isBank:true` on the doc. Duplicate detection for a
  bank account is scoped by `(network, phone)` TOGETHER (unlike mobile money's
  deliberate phone-only scoping — see the round-6 duplicate-detection note above) since
  a bank account number is only unique within its own bank.
- `/withdraw/request`: the "destination must already be a bound account" check (added
  2026-08-16 for mobile money only) now applies to BOTH rails equally — bank never had
  this gate before since it had no bind step at all pre-removal. `method` is derived
  from the BOUND doc's own `isBank` flag, never trusted from the client, with an
  explicit defense-in-depth check (`!isMM && boundAcct.isBank !== true` → rejected)
  so a forged/stale `bankAccounts` row missing that flag can never be treated as a
  valid bank destination even if its network+phone happen to match. `bankName`/
  `accountNumber`/`accountName` are populated onto the withdrawal doc from the BOUND
  account (not typed fresh per request, unlike the old pre-removal bank-transfer
  design) — this is exactly what `processWithdrawalCore`'s already-existing `isBank`
  branch (`marzBankTransfer`) reads, so reactivating this needed no changes to the
  actual sending/reconciling logic, only to how the withdrawal doc gets populated.
- Assistant replies (`assistant-engine.js`): `withdraw_to_bank`, `payout_account` (both
  the quick reply and the DEEP explainer) updated — used to say "no bank-transfer
  option," now correctly describe binding a bank account the same way as mobile money.
- Covered by new `test-bank-withdrawal-accounts.js` (40/40): live-validate-before-save,
  malformed-number-rejected-without-a-live-call, bank-scoped duplicate detection,
  `/public/banks`, bound-account enforcement for bank, the forged-row defense-in-depth
  check, `/admin/withdraw/process` correctly driving `marzBankTransfer` (not
  `marzSendMoney`), and a full mobile-money regression pass proving it's unaffected.
  **`server.js` changed → needs a Railway redeploy.** `user/sw.js` `CACHE` bumped to
  `v279`. See the 2026-08-19 AGENT_LOG.md entry ("Bank withdrawal accounts reactivated,
  merged into the existing Withdrawal Accounts flow").

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
- **Active Level-1 referral ladder** (flat UGX 500/referral, changed 2026-08-19 —
  history: 1,500 → 1,000 → 500, all same day): 2→1,000; 5→2,500; 10→5,000;
  25→12,500; 50→25,000; 100→50,000; 200→100,000; 500→250,000;
  1,000→500,000; 2,000→1,000,000; 5,000→2,500,000 (tiers 8-11 added
  2026-08-18, owner requests — same flat rate throughout, no other tier ever
  touched; rate itself changed twice more 2026-08-19, see 0n/0p below).
- **Whole-team deposit ladder** (flat 2.5%): 100,000→2,500; 500,000→12,500;
  1,000,000→25,000; 5,000,000→125,000; 10,000,000→250,000; 25,000,000→625,000;
  50,000,000→1,250,000; 100,000,000→2,500,000; 200,000,000→5,000,000;
  500,000,000→12,500,000; 1,000,000,000→25,000,000 (tiers 8-11 all added
  2026-08-18, same flat rate throughout).
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
`fsT63`, replacing the old 11-character `XXX-XXXX-XXXX` shape. **STALE NOTE, CORRECTED
2026-08-18: redemption (`POST /redeem`) is STRICTLY CASE-SENSITIVE** — the owner
reversed an earlier case-insensitive design the same day gift codes went mixed-case
(2026-08-16); this section previously described the reversed, no-longer-true earlier
behavior and was corrected while touching this same area for the referral-code work
below. `/redeem` matches the caller's raw input against the stored `code` field with NO
case transformation at all — "gf64h" only ever matches "gf64h", never "GF64H". A
`codeLower` field still exists on every code doc, but ONLY for the uniqueness check at
GENERATION time (`generateUniqueGiftCode()`), so the system never hands out two codes
that would be confusing/ambiguous to read back over SMS or phone (e.g. "AbC12" and
"abc12") — it is never consulted at redemption time. All random generation in this file
(referral codes, gift codes) now goes through `randFromAlphabet()`, which uses
`crypto.randomInt` per character instead of `byte % alphabet.length` — the latter is
measurably biased whenever 256 isn't a clean multiple of the alphabet size (it wasn't,
for the new 54-char gift-code alphabet).

## Referral codes: 6-character mixed-case, added 2026-08-18 (was 6-char all-caps)

Owner: not all-capitals, mixed case, 6 characters specifically so a referral code can
never be the same shape as a 5-character gift code ("there might be a same similarity,
one can put a referral code as gift code, so let it be referral code of 6 characters to
avoid such") — plus "globally recognized by server, unique globally, accurate,
encrypted, safeguarded, and secured." `CODE_CHARS` in `server.js` is now literally the
same 54-character unambiguous mixed-case alphabet as `GIFTCODE_CHARS` (no I/l/O/0/1) —
`GIFTCODE_CHARS` now just aliases `CODE_CHARS` rather than duplicating the literal.
Length (6 vs. 5) is the only thing that structurally tells the two systems apart; they
also live in entirely separate collections (`users.referralCode` vs.
`promoCodes.code`), so a raw-string collision between the two is impossible by
construction, not just improbable.

- **Generation** (`generateUniqueReferralCode()`): unchanged mechanism, still
  `crypto.randomInt`-backed (unpredictable — as close to "encrypted" as a code that must
  stay human-typeable can meaningfully be), still lock-guarded check-and-claim-as-one-
  atomic-step (see the function's own comment for the two prior races this already
  closed). What's new: a `referralCodeLower` field is now written alongside
  `referralCode` on claim, and the uniqueness check queries BOTH the exact `referralCode`
  (catches every code ever issued, including pre-2026-08-18 all-caps ones, which
  predate `referralCodeLower` and would be invisible to a lower-only check) AND
  `referralCodeLower` (catches the NEW ambiguity mixed-case introduces: two different-
  case codes that would look/sound identical read aloud, e.g. "AbC123" vs "abc123") —
  both must come back empty before a candidate is claimable. Indexed
  (`['users', {referralCodeLower:1}]`, `db.js`).
- **Redemption/matching is CASE-SENSITIVE** — same established philosophy as gift codes
  (see that section just above). `completeRegistrationCore()` (shared by `/register` and
  `/admin/user/complete-registration`) and `/admin/user/attach-referrer` both used to
  `.toUpperCase()` the caller's input before matching — harmless when every real code
  was all-caps, but that call was REMOVED as part of this change: uppercasing a mixed-
  case candidate before comparing against a mixed-case stored value would silently break
  matching for any code containing a lowercase letter. Neither call site transforms case
  at all now — an exact match against the stored `referralCode` field, full stop.
- **Old, already-issued all-caps codes keep working exactly as before** — no migration,
  no backfill, by design (same "claim flags keyed by target number" philosophy this
  codebase already uses elsewhere for a ladder change). An old code is still matched by
  the same exact-match query; it just never had `referralCodeLower` set, which is fine
  since the generation-time check above covers it through the EXACT-match half.
- **Real client-side bug caught and fixed in the same pass**: the registration screen's
  referral-code input (`#regReferral`, `user-src/index.html`) had
  `autocapitalize="characters"` — same mistake the gift-code input had before an earlier
  round fixed it there. On a mobile keyboard this force-uppercases every letter as it's
  typed, which combined with the new case-sensitive matching would have made it
  functionally impossible to manually type a code containing a lowercase letter
  correctly. Changed to `autocapitalize="off"`. (Codes shared via the `/?ref=CODE` link,
  the much more common path, were never affected — the code round-trips through
  `encodeURIComponent`/`decodeURIComponent` exactly, no keyboard involved.)
- **Also fixed while in this area**: this same "Gift codes" section above was
  documenting the REVERSED, no-longer-true earlier case-INsensitive redemption design —
  corrected in place (see that section's note).
- **Also found and fixed, adjacent gap**: `generateUniqueGiftCode()` has queried
  `codeLower` for its own uniqueness check since gift codes went mixed-case
  (2026-08-16), but no index ever backed it. Added (`['promoCodes', {codeLower:1}]`,
  `db.js`) alongside the new referral index while touching this area.
- `test-referral-code-format.js` (new, 19/19) proves: correct shape/length, genuine
  mixed-case across a real generation batch, no case-insensitive collisions across that
  batch, case-sensitive redemption (exact code works, a case-flipped variant is
  rejected), and a seeded LEGACY all-caps code still works exactly as before (plus its
  own case-flipped variant is still correctly rejected). `test-security-review.js`'s
  referral-code-shape assertion updated to match the new alphabet (was asserting the old
  all-caps-only shape, which real mixed-case codes correctly no longer match).

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

## Round 8 of the same day, 2026-08-17 — deposits-in-Records check, Coming Soon relabel, forced payout-account selection, dead Home banner removed, real announcement dialog built, notification admin UI added

One long owner message, six distinct asks, quoted in full since each part
matters: *"bro ,make sure also deposits are recorded in records,bro change
from upcoming to "coming soon" it should not be badged ,it should replace
the area of purchase button, so purchase word goes away,not the button, the
button should remain.also l want when one wants to withdrawal, he picks the
number from withdrawal accounts even if it is 1,it should not auto select
,so one needs to click and select a withdrawal account,so that blue card
will remain,it will say [Select payout account] [.....................>]
so in most cases if one has no ,it says add payout account after he taps on
it and comes back to withdrawal screen automatically also bro ,also in
admin there is a residue of saying that home screen banner 😳 in setting,
and also announcement dialog not working 😕, l want a dialog with a
background image SETTABLE from admin,plus blur and opusity, l want it very
good,with telegram button and cancel,,also l can't see where to send
notifications???,l want my old notifications to even show up in newly
created accounts,and notifications."*

- **Deposits in Records — investigated, NOT a bug.** `RECORD_META` already
  maps `deposit → 'Deposit'`, `openRecordsSheet()` doesn't filter by type,
  and all 3 server-side deposit-crediting paths write `type:'deposit'`
  transaction rows. The account in the owner's screenshot simply had no
  completed real deposits — its balance came entirely from an
  `admin_credit` entry, correctly shown as "Credit" in that same
  screenshot. No code change; reported back instead of "fixed."
- **"Upcoming" badge → "Coming Soon" button label.** `prodCardHtml()`
  (`user-src/original_module.js`) no longer renders the
  `<span class="pill badge-soon">Upcoming</span>` next to the product name
  at all — the word is gone, not just relabeled. The Purchase button itself
  is untouched (still `disabled` when `p.active===false || p.comingSoon`),
  only its label now reads `p.comingSoon ? 'Coming Soon' : 'Purchase'`.
  Dead `.badge-soon` CSS rule removed from `user-src/index.html`;
  `.prod-card.soon{ opacity:.6; }` kept since it still drives the disabled
  look.
- **Withdrawal accounts: forced explicit tap-to-select, even with exactly
  one account.** Owner: *"it should not auto select ,so one needs to click
  and select a withdrawal account,so that blue card will remain,it will say
  [Select payout account] [.....................>]"*. `openWithdrawSheet()`
  no longer fetches `/bank/list` up front or auto-picks anything — it opens
  straight into `renderWithdrawSheet(null, min, feePct, true)`. The sheet
  now always starts with a blue `.record-row.acct-row` reading "Select
  payout account" with a chevron; tapping it opens the existing Payout
  Accounts sheet in its established picking mode (`_payoutPickCallback`,
  the same stacked-sheet mechanism the earlier withdrawal-picker feature
  already used) and `renderWithdrawSheet()` re-renders with the chosen
  account once picked. "Request Withdrawal" stays disabled until an account
  is actually selected. **Zero-accounts case**: `renderPayoutSheet()` now
  shows the "Add Withdrawal Account" form inline even while in picking mode
  when the account list is empty (previously the add-form was hidden
  whenever `_payoutPickCallback` was set, so a first-time withdrawer with no
  saved accounts hit a dead end) — saving auto-refreshes the picker list, so
  they can then tap the account they just added and land back on the
  Withdraw sheet automatically, matching *"after he taps on it and comes
  back to withdrawal screen automatically."* The now-redundant old
  `savePayoutBtn` handler at the bottom of `renderPayoutSheet()` was
  deleted (superseded by the new one that covers both the normal and
  picking-with-zero-accounts cases).
  **Bonus defensive fix** (found via a test mock that omitted `/bank/list`):
  both `openWithdrawSheet()`/`renderPayoutSheet()` did
  `r.status==='success' ? r.accounts : []`, which throws if a success
  response ever arrives with no `accounts` array — changed to
  `(r.accounts || [])` in both places.
- **Dead "Home screen banner" admin section removed.** Owner: *"in admin
  there is a residue of saying that home screen banner"*. Grepped
  `original_module.js` for `homeBannerTitle|homeBannerText` — zero matches;
  the real app never reads either field. Removed the whole panel-card
  (`#hbTitle`, `#hbText`, "Save home banner text") and its handler from
  `admin-src/index.html`. Server-side `homeBannerTitle`/`homeBannerText` in
  `DEFAULT_SETTINGS` were left alone (same "don't touch storage, just stop
  showing a dead control" precedent as the 10-banner-slot pruning from an
  earlier round).
- **Announcement dialog — built from scratch, not "fixed."** Grepping
  `original_module.js` for `annEnabled|annTitle|annBody|annCtaLabel|
  annCtaUrl|announcementBg` came back with zero matches: despite
  `admin-src/index.html` already having a Title/Body/enabled form wired to
  `/admin/settings/update` and an image-upload card wired to the same
  endpoint, **nothing in the real app ever read any of it or rendered a
  dialog** — the owner's "not working" was literally true, there was no
  client-side implementation at all. Built now, end to end:
  - `server.js`: new `annBgBlurPx` (default 6) / `annBgTintPct` (default
    55) added to `DEFAULT_SETTINGS`, the `/public/settings` response, and
    `SETTINGS_NUMERIC_RANGES` (`[0,40]` / `[0,100]`) — same shape as the
    4 existing blur/tint pairs (authBg, appBg, card, authCard).
  - `admin-src/index.html`: added a blur/opacity slider pair under the
    existing "Announcement banner image" card (renamed "Announcement
    background image" to match what it now actually does), wired to
    `saveAnnBgBtn` → `/admin/settings/update`. Also fixed the section's own
    stale help text, which claimed *"the dialog's own two buttons are your
    Telegram Channel and Telegram Group links"* — the owner asked for ONE
    Telegram button, not two, so the text (and the real implementation) now
    say the button uses `telegramGroup` if set, else `telegramChannel`.
  - `user-src/index.html`: new `.announce-bg`/`.announce-sheet` CSS — a
    slide-up bottom sheet (not tied to the `_sheetStack`/history-back
    system, since this is a dismissible notice that appears automatically
    rather than something the user navigates to) with a dark navy base
    (`#0d1b2a`) so it reads as "plain dark background" with no image set,
    plus a blurred/tinted `::before`/`::after` image layer exactly like the
    `authbg`/`appbg` pattern (`--ann-bg-url`/`--ann-bg-blur`/`--ann-bg-tint`
    custom properties, set in `boot()`). Two `.pillbtn` buttons (Cancel,
    Telegram — the Telegram one hidden entirely via `style.display='none'`
    when neither `telegramGroup` nor `telegramChannel` is set, leaving
    Cancel alone at full width).
  - `user-src/original_module.js`: new `maybeShowAnnouncement()`, called
    from inside `showPage()` whenever `name==='home'` — this single hook
    covers both "opens the app" (`enterApp()` calls `showPage('home')`) and
    "switches back to Home from Shop/Rewards/Team/Me" (the bottom-nav click
    handler also calls `showPage('home')`), matching admin's own help text
    for when it should appear, without a separate timer or listener. Gated
    on `annEnabled` and a non-empty `annBody`. Telegram tap calls
    `window.open(url,'_blank')` then closes; Cancel and tapping the dark
    scrim both close with no history/back-button interaction (it's a
    notice, not a page).
  - **Verified via Playwright** (6 cases): shows on first Home visit with
    the mocked image+telegram settings; Telegram tap opens the right URL
    and closes the dialog; shows again on a subsequent Home return (nav
    away then back) and Cancel closes it; `annEnabled:false` never shows
    it; no telegram links set → Telegram button genuinely hidden (`display:
    none`), Cancel alone fills the row; no `announcementBg` set → renders
    cleanly on the dark fallback with no console errors. Screenshots
    confirm the visual: dimmed Home page behind a bottom sheet with a dark
    card, white title/body text, and pill Cancel/Telegram buttons.
- **Notification sending — the endpoint already existed, the admin UI to
  reach it never did.** Owner: *"l can't see where to send
  notifications???"* — correct: `server.js`'s `/admin/notifications/create`
  (owner-only broadcast to every member's bell, already covered by
  `test-notifications.js`) had zero call sites anywhere in
  `admin-src/index.html`. Added a "Send notification" panel-card to the
  Settings tab, above the Announcement dialog card (title + message +
  "Send to all members" button), wired straight to that existing endpoint.
- **"Old notifications should show up in newly created accounts" — already
  true, verified not a bug.** `GET /notifications` queries
  `notifications` where `audience==='all'` with no `createdAt` /
  account-creation-time filtering at all, so a brand-new account already
  sees every broadcast ever sent, not just ones sent after it registered.
  `test-notifications.js` has an explicit assertion for exactly this
  ("a member who registers later still sees the older owner announcement")
  and it was already green before this round — this was fixed in an
  earlier round of this same session (see that test file's own header
  comment) and never regressed. No code change; reported back instead of
  "fixed." If the owner is still seeing this on their phone, the standard
  cause is `server.js` on Railway not yet redeployed — remind them which
  file to push there.
- **Verification**: full `test-*.js` suite green (62/62) both after the
  user-app changes and again after the admin-app changes. Rebuilt both
  `user/` and `admin/`. Bumped `user/sw.js` cache `v237` → `v238`.
  Playwright covered the announcement dialog (6 cases, see above); the
  Coming-Soon relabel, forced payout-account selection, and dead-banner
  removal are straightforward markup/logic changes verified by reading the
  rebuilt output and the green test suite (`test-payoutbug.js` and the
  broader suite already exercise the withdrawal-account flow this round
  changed).
- **Same-day follow-up: announcement dialog re-opened from center, not the
  bottom.** Owner: *"bro the dialog message should be opened from middle
  not down, we'll framed and architectured."* The first cut above opened as
  a bottom sheet (`align-items:flex-end`, corners rounded only on top,
  slide-up translateY animation) — changed to a proper centered modal:
  `.announce-bg` now uses `align-items:center` with side padding,
  `.announce-sheet` is a `max-width:360px` floating card with all four
  corners rounded (`24px`), a real drop shadow + 1px light border for
  definition, a `.announce-accent` 4px `var(--blue)` stripe across the top
  for brand framing, and a scale+fade entrance (`scale(.92)→scale(1)`)
  instead of the slide-up. Title stays centered, body text left-aligned for
  readability, action row stretches full width. Rebuilt `user/`, bumped
  `user/sw.js` cache `v238`→`v239`, full `test-*.js` suite still green
  (62/62, pure CSS/markup change), Playwright re-ran all 6 announcement
  cases against the rebuilt artifact — same pass/fail results, screenshots
  confirm the dialog now floats centered over a dimmed backdrop.

## Round 9 of the same day, 2026-08-17 — announcement dialog taller + scroll-chain bug fixed, Records shortcut added to Deposit/Withdraw

Owner, with screenshots: *"let us increase the height of announcement
dialog abit,without removing or tempering with its contents or
functions.also let us put deposits records shortcut svg on top right,think
you see on the red marks on deposits and withdrawals screens, that is
where short cuts will be,so there will be svg like for records📄 on
activity checker,also bro when you reach at end of text in announcement
dialog, it again scrolls the contents in dashboard, that is very bad 👎,
fix it as soon as possible."* Also asked earlier in the same exchange for
copy-paste-ready dialog/notification text (delivered in chat, not a code
change — see the announcement/notification content the owner pasted into
admin's Title/Body fields directly).

- **Announcement dialog made taller.** `.announce-text`'s `max-height` in
  `user-src/index.html` went from `34vh` to `52vh` — nothing about the
  content, buttons, or open/close behavior changed, just more of the
  message is visible before the inner box needs to scroll at all (the
  owner's own longer platform-rules message now fits with zero scrolling
  at a typical phone height).
- **Real bug fixed: reaching the end of the announcement text scrolled the
  Home page underneath.** Root cause: the announcement dialog was never
  part of the `openSheet()`/`closeSheet()` system (it's a dismissible
  notice, not a stacked page — see the previous round's reasoning), so
  unlike every real sheet it never set `document.body.style.overflow =
  'hidden'` while shown. Once a touch/wheel scroll hit the bottom of the
  inner `.announce-text` box, the browser's default scroll-chaining handed
  the rest of the gesture to the page underneath — the dashboard — which
  visibly scrolled *while the dialog was still open on top of it*. Two-part
  fix: `overscroll-behavior: contain` added to `.announce-text` (stops the
  chain at the box's own boundary) plus `maybeShowAnnouncement()` /
  `hideAnnouncement()` (`user-src/original_module.js`) now lock/restore
  `document.body.style.overflow` exactly like `openSheet()`/`hideSheet()`
  already do for real sheets (guarded by the same `qsa('.sheet-bg.show')`
  check, so it plays correctly with any sheet that happens to be open too).
- **Records shortcut added to the Deposit and Withdraw sheet headers.**
  Owner pointed at the empty top-right corner of both screens in two
  screenshots (red circles) and asked for a document/records icon shortcut
  there, matching the one already used for the home activity-ticker.
  `.sheet-head` (`user-src/index.html`) gained `justify-content:
  space-between` (harmless no-op for the other sheet-heads, which still
  only have one child) and both `depositSheetBg`/`withdrawSheetBg` got a
  second `.iconbtn` in their header using the same `doc` SVG as elsewhere,
  wired in `original_module.js` to the existing `openRecordsSheet()` —
  which already stacks onto the `'generic'` sheet slot via the
  `_sheetStack` mechanism from the withdrawal-account-picker round, so it
  opens Records *on top of* Deposit/Withdraw and the phone Back button (or
  the Records sheet's own back arrow) returns to whichever of the two was
  underneath, without needing any new plumbing.
- **Verification**: full `test-*.js` suite green (62/62 — pure
  markup/CSS/client-JS, no server change). Rebuilt `user/`, bumped
  `user/sw.js` cache `v239`→`v240`. Playwright: confirmed
  `.announce-text`'s computed `max-height` is now ~52% of viewport height;
  confirmed `document.body.style.overflow` is `'hidden'` while the dialog
  is shown and restored to `''` after Cancel; scrolled the inner text to
  its end and kept scrolling — `window.scrollY` stayed at 0 (no more
  chain-through); opened Records from both the Deposit and Withdraw sheet's
  new shortcut icon and confirmed it stacks correctly (`generic` sheet
  shows `true`, the sheet underneath stays `true` too) and that a phone-back
  pops only Records, leaving Deposit/Withdraw still open underneath.
  Screenshots confirm the icon sits exactly where the owner circled it and
  the full rules message now fits without scrolling.

## Round 10 of the same day, 2026-08-17 — Deposit/Withdraw Records shortcuts corrected to per-screen history, not the combined list

Owner, immediately after Round 9 shipped: *"unfortunately you misunderstood,
l said on withdrawals, the records svg opens the withdrawals history/
records,and also for deposit svg of records,opens deposits history, not
records, so records combines all transactions, but here it goes
specifically."* Round 9's shortcut buttons both opened the same combined
Records sheet (every transaction type) — correct location, wrong content.

- `openRecordsSheet()` (`user-src/original_module.js`) now takes 3 optional
  params: `filterType`, `title`, `emptyMsg`. Called with none of them (the
  home activity-ticker's own records button, unchanged) it's still the full
  combined view titled "Records". The two new header buttons now pass
  `'deposit'`/`'Deposit History'`/`'No deposits yet'` and
  `'withdraw'`/`'Withdrawal History'`/`'No withdrawals yet'` — filtering the
  same `/transactions` response client-side on `t.type` (confirmed against
  `server.js`'s actual write sites: the field is `'deposit'`/`'withdraw'`,
  matching `RECORD_META`'s keys exactly) before rendering, with its own
  sheet title and a screen-specific empty-state message instead of the
  generic "No more data".
- **Verification**: full `test-*.js` suite green (62/62). Rebuilt `user/`,
  bumped `user/sw.js` cache `v240`→`v241`. Playwright: Deposit sheet's
  shortcut against a 5-item mixed mock transaction list shows exactly the
  2 deposit rows titled "Deposit History"; Withdraw sheet's shortcut shows
  exactly the 1 withdraw row titled "Withdrawal History"; the Home
  activity-ticker's own records icon (called separately, not through the
  Deposit/Withdraw path) still shows the full combined list, confirming
  that path is untouched; an empty deposit-only mock correctly renders "No
  deposits yet" instead of the generic empty-list wording.

## Round 11 of the same day, 2026-08-17 — third ChatGPT pass, 4/4 confirmed real (wrong data source, a genuine race, a missing click-lock, a missing orderBy)

Owner: *"now let us again ask chatgpt, you already remember our last ask to
chatgpt, so from there to this commit,let us tell it to make a review."*
Pointed ChatGPT at `AGENT_LOG.md` again, scoped to the 5 newest entries
(everything since the last review). All 4 findings verified against the
real code before touching anything, per the established practice — every
one held up:

1. **Wrong data source for the Round 10 Deposit/Withdraw Records
   shortcuts.** `openRecordsSheet()` filters `/transactions` — but
   `server.js`'s own comment on `GET /deposits` says outright: *"the
   generic /transactions list only ever gets a row once a deposit is
   actually credited... this is the only place a user can see one that's
   still processing or that never went through."* A pending or failed
   deposit/withdrawal would silently be invisible from the new shortcut
   while still showing correctly on the real Deposit/Withdrawal History
   screen (Account → Deposit History, already built, using
   `openHistorySheet()` against `/deposits`/`/withdrawals` with real
   Processing/Successful/Unsuccessful status pills). Fixed by pointing both
   shortcuts at `openHistorySheet('deposit'|'withdrawal')` instead —
   `openRecordsSheet()` reverted back to its simple no-args combined-view
   form (the filterType/title/emptyMsg params added in Round 10 are gone,
   since nothing needs them anymore).
2. **Genuine stale-response race**, present in both `openRecordsSheet()`
   and `openHistorySheet()`: each looks up its body element by id (
   `$('recordsBody')` / `$('histBody')`) *after* its own `await`/`.then()`,
   with nothing to check it's still the sheet that's actually showing.
   Failure scenario: open Deposit History, back out fast, open Withdrawal
   History before the first request lands — if the slower response arrives
   second it overwrites the CURRENT sheet's content with the wrong data
   under the right title. Fixed with a shared `_genericAsyncSeq` counter:
   each render captures the sequence number at the start of its own call
   and silently bails if a newer 'generic'-sheet render has taken over by
   the time its response lands. Scoped to just these two functions (the
   ones now reachable via the new rapid Deposit/Withdraw ↔ Records
   navigation) rather than sweeping every other `openSheet('generic', ...)`
   call site in the file.
3. **"Send notification" had no click-lock.** `withTabBusy()` only
   suppresses the admin panel's background live-refresh tick — it never
   disables a button. Every other state-mutating admin button in
   `admin-src/index.html` already does `btn.disabled=true` / restore around
   its request except this one, added fresh in Round 8. A fast double-tap
   (easy on mobile) fired two separate `POST /admin/notifications/create`
   calls, each inserting its own broadcast — every member would get the
   same announcement twice. Fixed to match the established pattern.
4. **`/notifications` had no `orderBy` before `.limit(50)`.** Once more
   than 50 broadcasts exist, the fetched 50 aren't guaranteed to be the
   newest 50 — the `rows.sort()` afterward can only reorder what was
   actually fetched, so a genuinely newer broadcast could be silently
   excluded. Fixed by adding `.orderBy('createdAt', 'desc')` before
   `.limit(50)` — the exact same `.where().orderBy().limit()` shape already
   used elsewhere in `server.js` (`/checkin`, `adminAuditLog`, etc.).
- **Verification**: full `test-*.js` suite green (62/62, including
  `test-notifications.js` unaffected by the added `orderBy`). Rebuilt both
  `user/` and `admin/`. Bumped `user/sw.js` cache `v241`→`v242`. Playwright:
  confirmed the Deposit shortcut now shows a pending deposit with a
  "Processing" pill (impossible before this fix, since `/transactions`
  never has that row); confirmed the Withdraw shortcut shows
  Processing/Unsuccessful pills from `/withdrawals`; confirmed the race
  guard directly — fired a deliberately-delayed deposit-history call, then
  immediately opened withdrawal-history, waited past the slow response's
  arrival, and confirmed the sheet still reads "Withdrawal History" (the
  stale deposit response was correctly discarded). The admin click-lock and
  `orderBy` fixes are small, mechanical, and match long-established patterns
  elsewhere in the same files — verified by reading the change and a
  successful `build-admin.js` syntax check rather than a dedicated
  Playwright pass, since the other three fixes already got full live
  coverage this round.

## Round 12 of the same day, 2026-08-17 — security review of login/registration/PIN/referral, 8/10 findings fixed, 2 known-limitation architectural gaps documented (not silently patched)

Owner: *"now let us ask chatgpt to check on login and registration plus all
its functions connected to it, ie number, codes and code generation, id
giveaway, independency, encryption, safeguards, strength, referral and
codes... adding also pin functions, and passwords."* Then, after ChatGPT's
10-point response: *"he said that, also supplement, build, make final
check, and ship."* This was a from-scratch audit (not a changelog review),
scoped with direct pointers to the real functions in `server.js` and
`user-src/original_module.js` so the review would be concrete rather than
generic. Every finding was independently verified against the actual code
before anything was touched, same discipline as every prior ChatGPT round
this session — one finding's suggested fix was tried, found to actively
break a legitimate scenario the codebase's own test suite already protects,
and reverted rather than forced through.

**Fixed:**

1. **Registration trusted `req.body.phone` verbatim, with nothing tying it
   to the account that actually authenticated the request.** Since member
   login is Firebase email/password with a synthetic
   `phoneToEmail(phone)` email (client-side), the local part of the
   VERIFIED Firebase token's own email IS that account's real phone. Added
   `verifyAuthWithEmail()` (a sibling of `verifyAuth()`, used only at the
   two call sites that needed it — not a blanket rewrite of the ~50
   existing `verifyAuth()` call sites) and `phoneFromVerifiedEmail()`, and
   switched `/account/create-profile` and `/register` to derive `phone`
   from the caller's own verified email first, falling back to the body
   value only when that derivation doesn't yield a valid Uganda number
   (old/irregular accounts, or — matching every existing test's mock shape
   — no email on the token at all). **This does NOT fully close ChatGPT's
   underlying "phone-number account squatting" concern** — an attacker who
   creates a Firebase account against a victim's predictable synthetic
   email BEFORE the victim ever registers still locks the victim out of
   ever using that phone number, because there is no real proof-of-phone-
   ownership step (SMS/Phone-Auth OTP) anywhere in this app. That's a
   genuinely larger feature (a real SMS/OTP provider, cost, a changed
   onboarding flow) requiring the owner's own decision, not something to
   silently build into a review-response patch — **documented here as an
   open architectural limitation**, not fixed. What WAS fixed closes the
   narrower, cheaply-fixable gap: an already-authenticated caller can no
   longer mislabel their OWN profile with a phone number unrelated to the
   account they actually hold.
2. **`/register`'s member-facing response leaked the referring account's
   raw Firebase uid** (`referrerId`) — nothing in the client ever read it;
   it's internal bookkeeping the ADMIN reconciliation endpoint
   (`/admin/user/complete-registration`) legitimately still needs. Redacted
   via response-shape destructuring in `/register` only; `referrerId`
   still flows to the admin route and its audit log exactly as before.
3. **A banned account's referral code still worked at registration** —
   team counts incremented toward a banned referrer even though commission
   crediting elsewhere already skips banned referrers, leaving referral
   attribution inconsistent. `completeRegistrationCore` now rejects a
   referral code belonging to a banned account with the same `BAD_REFERRAL`
   shape as a nonexistent/self-referral code.
4. **Admin login had a timing side-channel**: a nonexistent or deactivated
   username short-circuited BEFORE `scryptVerify` ever ran, while a real
   username with a wrong password always paid the full scrypt cost —
   different response times could let an attacker enumerate valid admin
   usernames. Added a fixed `DUMMY_PASSWORD_HASH` (computed once at boot)
   that a nonexistent/inactive username's attempt is verified against
   instead, equalizing the cost of both paths.
5. **`generateUniqueReferralCode()` had a real check-then-write race**
   (two simultaneous registrations could both see the same 6-char candidate
   as unused and both write it) **and its post-20-collision fallback
   returned an 8-char code with ZERO uniqueness check at all** — not just
   low-probability, genuinely unchecked. Wrapped the whole function in
   `withLock('referral-code-gen', ...)` (same process-local-lock idiom
   already used for the publicId counter — this app runs as a single Node
   process, so that's the same guarantee already accepted there), and
   changed the fallback to keep verifying uniqueness with the wider 8-char
   alphabet instead of ever returning unverified.
6. **The publicId lazy self-heal in `GET /account` had a real (low-severity)
   race**: two concurrent reads of the same not-yet-repaired legacy account
   could each mint a DIFFERENT valid sequential id (the counter itself is
   already lock-protected, so no two users could ever collide on the SAME
   id) and then both write to the same user doc — the slower write wins,
   the other freshly-minted id is simply wasted. Not a security issue
   (publicId doesn't gate access to anything — confirmed, see below), just
   wasted counter values. Wrapped the check-then-assign in a per-user
   `withLock('publicid-selfheal:'+uid, ...)`.
7. **Tried, found harmful, reverted**: ChatGPT's suggestion to attach the
   existing 8/min `adminLoginLimiter` to `/admin/login` (previously only on
   `/admin/check-key`, the owner's single master-key login) was implemented
   first — then `test-security-hardening.js` immediately caught that this
   IP-keyed limiter (no `keyGenerator`, defaults to per-IP) breaks
   legitimate multi-staff usage: its own "a different, never-attacked
   username logs in normally at the same time" case makes 9 real
   `/admin/login` calls across a few different accounts in one run, which
   is completely normal multi-staff behavior sharing one office/VPN IP, and
   an 8/min per-IP cap blocked the 9th outright. `/admin/login` (unlike
   check-key) legitimately serves MULTIPLE distinct staff accounts, so
   IP-keying is the wrong scope for it — the existing per-username
   5-attempt/15-minute lockout (`_loginFails`, independent of IP, already
   covered by that same test) is the correct defense for this route's
   actual threat model. Reverted rather than force a suggested fix that
   actively conflicts with the codebase's own deliberate, already-tested
   design. (ChatGPT's underlying root concern — that in-memory lockout
   state resets on a server restart/redeploy — isn't actually solved by an
   equally in-memory rate limiter either way; a real fix would need
   persistent storage for login-failure state, a bigger change than this
   pass, and is **documented as open, not fixed**.)

**Verified but NOT independently exploitable / already solid, per the
review itself** — publicId being sequential rather than random is
enumerable (leaks approximate registration volume) but gates access to
nothing found anywhere in the codebase; member data routes are all scoped
by the Firebase-verified uid from `verifyAuth()`; the PIN system's scrypt
hashing, timing-safe compare, weak-PIN rejection, and persisted 5-attempt/
15-minute lockout were all confirmed correctly implemented as-is.

**Documented as open architectural limitations, not silently patched in
this pass** (both require a real product/infra decision from the owner,
not a quiet code change):
- No real phone-ownership verification (SMS/Phone-Auth OTP) anywhere in
  the signup flow — see finding 1 above. The synthetic-email identity model
  cannot fully close phone-squatting without this.
- A registration process crash in the narrow window between
  `completeRegistrationCore` marking `registrationDone:true` (with the
  wallet already credited) and the subsequent team-count/welcome-
  transaction-row writes can leave those under-counted with no reconciler
  able to detect/repair it (the existing `already_done` guard means a
  retry is a safe no-op, but also means it can never re-run the missing
  side effects). Rare — needs a real process crash in a specific few-
  millisecond window — but a full fix (durable side-effect ledger /
  reconciler) is a bigger lift than this pass; not attempted.
- The PIN auto-setup-on-first-use path (`allowAutoSetup:true` on
  `/bank/save` and `/withdraw/request`) is a deliberate, already-documented
  design tradeoff (see the existing comment above `_payoutPinCheck`), not
  a newly-discovered oversight — a session hijacked in the narrow window
  before a member's PIN is set (normally set inline during registration
  itself) could set its own PIN. Requiring fresh Firebase reauthentication
  before first PIN enrollment would close this further but is a bigger UX
  change than this pass; not attempted.

- **Verification**: new `test-security-review.js` (28 checks) proves the
  email-derived-phone override (and its no-email fallback matching every
  other test file's mock shape), the `referrerId` redaction alongside the
  referral link still functioning underneath, banned-referrer rejection,
  the admin-login timing-fix's correctness (same generic error shape for
  both paths), a batch of 8 referral-code generations all coming back
  unique and correctly-shaped under the new lock, and the publicId
  self-heal race fix returning the same id on a second read rather than
  minting a new one. Full `test-*.js` suite green, 63/63 (62 existing +
  the new file) — including catching, and enabling the revert of, the
  rate-limiter regression described above. Server-only changes; no
  rebuild needed (nothing in `user-src/` or `admin-src/` touched).

## Round 13 of the same day, 2026-08-17 — asked ChatGPT to verify its own Round 12 fixes; found 3 real problems with the first cut, including one that made a "fix" a total no-op

Owner: *"now let us ask chatgpt where that patch is now green ✅️✅️✅️✅️✅️."*
Sent ChatGPT the diff/AGENT_LOG entry from Round 12 and asked it to verify
each of its own 10 original findings against the actual current code,
not just trust the changelog's claims. It found three genuine problems
with the first pass — all verified, all fixed:

1. **The admin-login timing fix was a complete no-op.** Round 12 added
   `DUMMY_PASSWORD_HASH` and computed `hashToCheck` correctly, but then
   still wrote `if (!validAccount || !scryptVerify(password, hashToCheck))`
   — `||` never evaluates its right side once the left side is already
   `true`, so for a nonexistent/inactive username `scryptVerify` (and the
   whole point of the dummy hash) was STILL never reached. The timing gap
   Round 12 claimed to close was still wide open. Fixed by computing
   `passwordOk = scryptVerify(...)` unconditionally, on its own line,
   before the branch — exactly ChatGPT's own suggested fix. **This time
   verified by actually instrumenting `crypto.scryptSync`** (wrapped and
   call-counted in `test-security-review.js`, before `server.js` loads) and
   asserting the count increases for a nonexistent username's login
   attempt — a check that would have failed (0 new calls) against the
   broken version even though the HTTP response looked identical either
   way. Response-shape checks alone cannot catch this class of bug; this
   is now the pattern for any future timing-sensitive fix in this repo.
2. **`generateUniqueReferralCode()`'s lock didn't cover the write.** Round
   12 wrapped the uniqueness CHECK in `withLock('referral-code-gen', ...)`
   but returned the code and released the lock immediately — the actual
   write happened later in `completeRegistrationCore`, unprotected. A
   second concurrent registration's own check could run (and pass) before
   the first registration's code was ever actually persisted. Fixed by
   giving `generateUniqueReferralCode(userId)` the registering user's own
   id and having it RESERVE the code (write it onto that user's own doc)
   while STILL holding the lock — check-and-claim is now one atomic step.
   **Verified with genuine concurrency this time**: the original
   `test-security-review.js` batch test used a sequential `for` loop with
   `await` between each call, which never actually raced anything at all
   (a real gap in the FIRST test, not just the code) — rewritten to fire
   10 registrations via `Promise.all`, letting Node genuinely interleave
   their async DB operations, and confirms all 10 codes come back unique
   with each one actually persisted on its own user doc.
3. **`phoneFromVerifiedEmail()` still trusted `req.body.phone` when the
   verified email was present but not phone-shaped** — e.g. an attacker
   hitting the API directly with an arbitrary email like
   `attacker@example.com` (bypassing this app's own `phoneToEmail()`
   convention, which only the real client ever uses) could still label
   their profile with a stolen phone number, since the derivation fell
   through to the body on any non-phone-shaped email. Fixed to return
   `null` in that case (profile stores an empty phone) instead of ever
   falling back to an unrelated caller-supplied value. The "no email on
   the token at all" fallback (every existing test file's mock shape,
   also the only realistic account of a Firebase auth method this app's
   client never actually uses) is unchanged and still falls back to body.
- **Also fixed on the same pass, both flagged by ChatGPT as consistency
  gaps rather than new categories of bug**: the separate OWNER-only
  `/admin/user/attach-referrer` reconciliation route gained the same
  banned-referrer rejection `completeRegistrationCore` already had (was
  missed in Round 12, same `BAD_REFERRAL` shape); the publicId self-heal
  in `GET /account` no longer returns a freshly-minted id when the
  persisting write actually fails (was silently swallowing the error and
  returning the unpersisted id anyway, so that one response would show an
  ID that later turned out to be a lie, and the next read would mint a
  completely different one) — now returns `null` on a failed write instead.
- **Considered and explicitly declined**: a username-keyed rate limiter on
  `/admin/login` (ChatGPT's suggestion to improve on Round 12's revert).
  Implementing it correctly would require moving `express.json()` body
  parsing earlier in the middleware chain (a `keyGenerator` reading
  `req.body.username` needs the body already parsed, and rate limiters are
  currently registered before that parser) — a broader, riskier change for
  marginal benefit, since the existing per-username 5-attempt/15-minute
  lockout already caps an attacker to 5 guesses per username regardless of
  request timing/rate, which is a stronger constraint than a requests/min
  limiter would add on top. Not implemented; noted here as a deliberate
  choice, not an oversight.
- **Verification**: `test-security-review.js` expanded from 28 to 27
  checks (net change from restructuring the referral-code batch test into
  fewer, stronger assertions, while adding: the arbitrary-email-phone gap,
  the scryptSync instrumentation, the genuine-concurrency referral race,
  and the admin attach-referrer banned-check). Full `test-*.js` suite
  green, 63/63. Server-only changes, no rebuild needed.

## Round 14 of the same day, 2026-08-17 — direct review of deposits/withdrawals/callbacks/records/status validation (no ChatGPT this round); found and fixed a real "stuck at processing forever" records-writing bug in 3 separate places

Owner: *"bro now check on deposits, withdrawals, callbacks speed, records
writing, and status validation."* Read the actual deposit and withdrawal
code directly (no ChatGPT this round — self-review) across
`/deposit/marzpay`, `creditDeposit`, `/deposit/marzpay/status`,
`/deposit/callback`, `/withdraw/request`, `processWithdrawalCore`,
`/withdraw/marzpay/status`, `/withdraw/callback`, and the background
reconciler (`reconcilePendingDeposits`/`reconcilePendingWithdrawals`).

**Deposits, callback speed, and status validation: all already solid, no
changes needed.** Deposit crediting is claim-before-credit (flips to
'matched' before crediting the wallet, so every retry path — webhook,
client poll, reconciler — becomes a clean no-op instead of a double
credit) and never trusts a webhook's bare claimed status: it always
independently re-verifies against MarzPay's own API, and a uuid the
webhook itself supplies (rather than one this server captured on its own
outbound call) is only ever trusted once that uuid's OWN live-reported
`reference` is confirmed to match this exact deposit — closing two
previously-fixed real exploits (see the extensive comment history at
`/deposit/callback`). Both `/deposit/callback` and `/withdraw/callback`
respond `200` as their literal first statement, before any processing, so
MarzPay's own webhook retry logic is never triggered by slow work on this
end — that's already the fastest a webhook ack can be. `SUCCESS_STATUSES`/
`FAILED_STATUSES` are strict allowlisted `Set`s checked with `.has()`,
never loose string matching, and an unrecognized status is correctly
treated as "still unresolved," never silently assumed either way.
**Precision note (ChatGPT review, round 2):** the "always independently
re-verifies" claim above is exact for deposits — `/deposit/callback`'s
success path genuinely returns without crediting if the live check fails
or disagrees. `/withdraw/callback`'s success path is deliberately
different: the live re-check is attempted best-effort but a failed/empty
check does NOT block the webhook from being trusted (see that code's own
comment — this was a previous fix, after a real production incident where
a genuinely-completed payout got stuck forever because a working webhook
kept losing to a flaky check). Both are correct for their own money-safety
direction — crediting is the risky direction to get wrong for deposits,
so it's gated strictly; refunding is the risky direction for withdrawals,
so THAT path (the failure branch) is the one gated strictly, not success —
but they are not the same guarantee, and this file's earlier wording
grouped them together loosely enough to misread as identical.

**Records writing: found a real bug, confirmed by reading the code, fixed
in all three places it existed.** A withdrawal's matching `transactions`
row (what the combined Records view actually renders — `description`
field shown verbatim) is written once at request time
(`/withdraw/request`, status `'pending'`, description ending "...net X
after Y% fee, processing") and updated once more to `'processing'` when
an admin approves and sends it (`processWithdrawalCore`) — but nothing
EVER updated it again once the withdrawal reached its real final outcome.
That resolution can happen in three completely different places — the
MarzPay webhook (`/withdraw/callback`), the member's own client-side poll
(`/withdraw/marzpay/status`), or the background reconciler
(`reconcilePendingWithdrawals`, also reachable on-demand via the admin
panel's "Sync MarzPay" button, `GET /admin/payments/sync`) — and grepping
every `where('withdrawalId', '==', ...)` call site in the file confirmed
NONE of the three ever touched the `transactions` collection. The
`withdrawals` collection itself (and the dedicated Deposit/Withdrawal
History screen, which reads it directly via `openHistorySheet()`) always
showed the correct live status; a member's Records entry for the SAME
withdrawal would keep reading "...processing" verbatim forever — even for
a payout that actually completed or failed days earlier — because that
literal word was baked into the description string at request time and
nothing ever revisited it.
- Fixed with one new shared, idempotent helper,
  `finalizeWithdrawalTransactionRecord(withdrawalId, outcome)`, called from
  all three resolution paths (both the success and failure branch of each)
  instead of six near-identical inline copies. It looks up the
  transaction by `withdrawalId`, sets `status` to `'success'`/`'failed'`,
  and rewrites `description` (dropping the trailing ", processing" on
  success; replacing it with " — failed, refunded to wallet" on failure).
  Best-effort/non-critical by design, matching the existing pattern
  `processWithdrawalCore` already used for its own transactions-row
  update — a failure here is logged and swallowed, never blocks or
  reverts the real money movement, which has already happened by the time
  this runs. Idempotent by construction (a second call's regex simply
  doesn't match an already-updated description, so it's a safe no-op),
  which matters since more than one of the three resolution paths can
  plausibly fire for the same withdrawal in quick succession.
- **Verification**: new `test-withdrawal-record-finalize.js` (17 checks) —
  fabricates a withdrawal already at `'processing'` with its matching
  transaction row (exactly as the real request+approve flow would leave
  it), then separately resolves it through each of the three paths for
  BOTH outcomes (processed and declined) and confirms the transaction
  record is correctly finalized every time, not just the `withdrawals`
  collection. Full `test-*.js` suite green, 64/64 (63 existing + the new
  file). Server-only change, no rebuild needed.

## Round 15 of the same day, 2026-08-17 — asked ChatGPT to verify Round 14's withdrawal-records fix; found a genuine unguarded success/failure race plus a missing 4th resolution path, both fixed

Owner: *"now let us also ask chatgpt."* Sent ChatGPT the Round 14 diff and
asked it to verify `finalizeWithdrawalTransactionRecord` and its call
sites against the real code. It found five real issues; all verified
against the code before touching anything, same discipline as every prior
round. The most significant one (item 3 below) was a genuine, previously
unnoticed money-safety race, not just a records-writing cosmetic gap.

1. **A fourth real resolution path was missed entirely.** `/admin/withdraw
   /reject` (the owner manually force-declining a pending or still-
   processing withdrawal) correctly refunded the wallet but never called
   `finalizeWithdrawalTransactionRecord` — same gap as the three paths
   Round 14 already fixed. Added the call, gated on the transaction inside
   `withLock('bal:'+userId,...)` actually having performed the decline
   (tracked via a `didTransition` flag), so it's never called on a no-op.
2. **The sandbox-immediate-success branch in `processWithdrawalCore`
   updated the transaction's `status` to `'success'` but never touched its
   `description`**, leaving the literal word "processing" in the text
   despite the status field disagreeing — internally inconsistent. Routed
   through the same `finalizeWithdrawalTransactionRecord` helper as every
   other path instead of its own inline partial update.
3. **The real bug: every success-branch write was completely unguarded,
   unlike its failure-branch counterpart.** Every FAILURE/refund path in
   `server.js` already goes through `withLock('bal:'+userId, ...)` + a
   `runTransaction` that re-reads status and only writes if it's still
   `'processing'` (the established STATUS-BEFORE-REFUND pattern) — but the
   three SUCCESS paths (webhook, client poll, reconciler) each did a bare,
   unconditional `doc.ref.update({status:'processed'})` with no lock and no
   re-check at all. Confirmed by reading `db.js`: `runTransaction` here is
   NOT a real MongoDB transaction — no session, no optimistic concurrency,
   just sequential `get`/`update` calls inside one function; `withLock` is
   the ONLY actual serialization this codebase has. Without the success
   path sharing that same lock key, a real race existed: a failure branch
   could correctly decline-and-refund a withdrawal, and a success branch
   resolving via a different, unsynchronized path moments later could
   silently overwrite that back to `'processed'` with zero re-verification
   — a withdrawal shown processed while the wallet had already been
   refunded, or vice versa. Fixed with a new shared `markWithdrawalProcessed
   (witRef, userId)` helper using the identical `'bal:'+userId` lock key
   and status-checked-transaction shape the failure paths already use,
   returning whether THIS call actually performed the transition. All
   three success call sites now only finalize the Records row when that's
   confirmed `true` — closing a related gap in the same motion, where a
   silently-swallowed withdrawal-status write failure used to still
   finalize the Records row as successful regardless of whether the real
   write ever landed. The poll endpoint (`/withdraw/marzpay/status`) also
   no longer blindly reports `state: 'processed'` when its own attempt
   turns out to be a no-op — it re-reads and reports the real current
   state instead.
4. **`finalizeWithdrawalTransactionRecord`'s `.limit(1)` only ever repaired
   one matching transaction row.** There's exactly one normal creation path
   (`/withdraw/request`, inside the same atomic write as the withdrawal
   itself) so duplicates shouldn't occur under current code — but widened
   to repair every matching row (bounded at 10, not unbounded) rather than
   assume that can never happen, in case old data or a past bug ever left
   more than one.
5. **Documentation precision**: Round 14's summary paragraph, read
   casually, could be misread as claiming BOTH deposit and withdrawal
   webhooks always require independent live re-verification before
   trusting a success claim. That's exactly true for deposits; withdrawal
   success is deliberately best-effort-checked (a previous, already-fixed
   incident: a flaky live check used to block a genuinely-completed payout
   forever). Added a precision note to the Round 14 entry above rather than
   rewriting history — the underlying code behavior was always correct and
   already explained in its own comments, only this summary's wording was
   loose enough to overstate it.
- **Verification**: `test-withdrawal-record-finalize.js` expanded from 17
  to 31 checks — added the missing `/admin/withdraw/reject` path, a real
  sandbox-approval run through `/admin/withdraw/process` (the fetch mock
  now answers `POST .../send-money` with `{status:'sandbox'}`, driving the
  actual code path instead of hand-simulating it), a genuine concurrency
  test firing the poll endpoint and `/admin/withdraw/reject` for the SAME
  withdrawal via `Promise.all` (not a sequential loop — real interleaving)
  and confirming the withdrawal, wallet balance, and Records row all agree
  on exactly one consistent outcome no matter which path wins the lock, and
  a multi-row repair check (two transaction docs sharing one `withdrawalId`,
  both correctly updated). Full `test-*.js` suite green, 64/64. Server-only
  changes, no rebuild needed.

## Round 16 of the same day, 2026-08-17 — owner's 8-screenshot bug report: input glitches/overrides, abnormal admin total, referral-link 404, label renames, Team page paging/status, cumulative-earnings gap

Owner sent 8 screenshots and one message covering 11 distinct items: unbounded
gift-code/deposit/withdrawal/phone inputs letting garbled 20+ digit values
reach the server, an abnormal "Total Invested" figure in the admin panel, a
referral link that 404s, two label renames, Team-page paging, and an explicit
requirement that "Cumulative Earnings" include every real income source. No
ChatGPT this round — investigated and fixed directly, same as Round 14.

1. **Gift code input had no length limit** — screenshot showed
   `GOTTDOOYDOYDYOD` overflowing the field. Gift codes are generated as
   exactly 5 characters (`genGiftCode()`/`GIFTCODE_CHARS`), and `/redeem`
   already capped server-side input at 32 chars, so this was purely a
   client polish gap. Added `maxlength="5"` to `giftCodeInput`.
2. **Deposit/withdrawal amount inputs had no digit limit** — screenshots
   showed a garbled string of zeros and a withdrawal fee computed off it
   ("Fee UGX 74,999,999,999,999,990,000,000,000,000"). Fixed both ends:
   - Server: added `MAX_MONEY_AMOUNT = 999_999_999` (9 digits) and a check
     in both `/deposit/marzpay` and `/withdraw/request` rejecting anything
     over it — this is the real fix, since a client limit alone is
     bypassable by any direct API call.
   - Client: `depAmount`/`wdAmount` needed `maxlength="9"`, but HTML's
     `maxlength` attribute silently does nothing on `type="number"` inputs
     (a fresh discovery this round) — switched both to
     `type="text" inputmode="numeric" maxlength="9"`, which keeps the
     numeric mobile keyboard via `inputmode` while making `maxlength`
     actually take effect.
3. **Phone number inputs had no digit limit** — screenshots showed 20+
   digit garbled "phone numbers" in login/register/deposit/withdrawal-
   account forms. Added `maxlength="10"` to `loginPhone`, `regPhone` (both
   in `user-src/index.html`), and `payPhone`, `depPhone` (both in
   `user-src/original_module.js`).
4. **Admin panel's "Total Invested" showing an absurd figure** (owner
   screenshot: "UGX 30,000,015,000,015,000") — root cause: the dashboard's
   own aggregation loops (`/admin/stats` and the Analytics endpoint) did a
   bare `total += u.totalInvested` with no type coercion. If even ONE
   user's stored money field was ever a STRING (the pre-existing
   totalInvested string-concatenation corruption already documented
   earlier in this file, only partially repaired), JS's `+=` silently
   coerces the ENTIRE running total to a string from that account onward —
   every subsequent user's numeric contribution gets string-concatenated
   instead of added for the rest of the loop, producing an ever-growing,
   very-real-looking but wildly wrong number. Ruled out `FieldValue
   .increment()` itself as an ongoing source by reading `db.js` — it
   compiles to a real MongoDB `$inc`, which throws on a non-numeric field
   rather than silently corrupting it, so this was specifically the admin
   dashboard's own less-defensive summing code, a NEW instance of the same
   bug class. Fixed by `Number(...)`-coercing every summed field
   (`walletBalance`, `totalDeposited`, `totalWithdrawn`, `totalInvested`,
   `totalEarned`, `teamCommission`) at both aggregation sites. This stops
   any future poisoning but does NOT retroactively repair whatever account
   is already corrupted in the live database — the owner still needs to
   run Admin → Users → "Recalculate totals" (`/admin/users/recount`) once
   to clean it up for good.
5. **Referral link opens to a "Not Found" page** — investigated the
   deployment architecture, not the application code. `space8/render.yaml`
   already has the correct SPA rewrite rule for the `space8-app` static
   site (`routes: - type: rewrite, source: /*, destination: /index.html`),
   so a deep link like `/?ref=CODE` should already resolve correctly by
   the committed config. This means the 404 is a Render dashboard/deploy-
   sync issue, not a code bug requiring a repo change — the owner should
   check the `space8-app` static site's Redirects/Rewrites settings on
   Render's dashboard and confirm a redeploy actually picked up
   `render.yaml`'s route block (same class of gotcha as "owner forgets to
   redeploy server.js", just on the frontend/routing side).
6. **Label renames** (plan-detail sheet, `user-src/original_module.js`):
   "Daily Return" → "Daily Profit", "Earned So Far" → "Accumulated Profit".
7. **Team page: cap each level's referral list to 5 with a "View more"
   expand** — `renderTeam()` used to render every member unconditionally.
   Added `STATE.teamExpanded = {1:false,2:false,3:false}`, slice each
   level's member list to 5 unless expanded, and a "View more (N)"/"View
   less" button per level that toggles the flag and re-renders (no
   network refetch — `STATE.teamMembers[l]` is already cached from the
   first load).
8. **Team page: explicit Active/Pending status badges** — member rows
   used to only append " · Active" for invested members and show nothing
   for the rest, which reads as broken/missing rather than "pending" for
   anyone who hasn't invested yet. Added a `pill-active`/`pill-pending`
   badge per row, driven by the `hasInvested` field `/team/members`
   already returns (`(d.totalInvested || 0) > 0`).
9. **"Cumulative Earnings" (`totalEarned`) was silently missing 3 of its
   5 required income sources.** The owner was explicit that it must
   include check-in, referrals, task rewards, gift codes, and daily
   profit. Auditing every place `totalEarned` gets touched found it
   already correctly included maturity/cashback payout and Task Center
   milestone rewards, but:
   - `/checkin` credited `walletBalance` and never `totalEarned` at all.
   - `creditReferralCommission` credited `walletBalance` + `teamCommission`
     and never `totalEarned`.
   - `/redeem` (gift code) credited `walletBalance` and never `totalEarned`.
   All three now increment `totalEarned` alongside their existing credit.
   **Also caught a second-order bug this would have caused**: the admin
   "Recalculate totals" tool (`/admin/users/recount`) rebuilds `totalEarned`
   from transaction history, but only ever summed `type === 'cashback'`
   transactions — the very next time an admin clicked recalculate, it
   would have silently WIPED OUT every user's checkin/referral/task-reward/
   gift-code earnings back down to cashback-only. Fixed the recount to sum
   all 5 earning transaction types (`cashback`, `commission`, `team_reward`,
   `promocode`, `checkin`), keeping it in permanent lockstep with what's
   credited live.
- **Verification**: new `test-round16-limits-and-earnings.js` (14/14) —
  proves the 9-digit deposit/withdrawal cap is enforced server-side (not
  just client-side), the admin total stays numeric and sane when one
  user's field is stored as a string, `totalEarned` actually increases
  from a real check-in / referral commission / gift-code redemption, and
  `/admin/users/recount` reconstructs `totalEarned` as the sum of all 5
  transaction types from a seeded ledger. Full `test-*.js` suite green,
  65/65 (64 existing + the new file). Rebuilt `user/index.html` via
  `node build-core.js` (round-trip OK) and bumped `user/sw.js`'s cache to
  `space8-shell-v243` since `user-src/` changed. Admin panel (`admin-src/`)
  needed no changes or rebuild — it only displays the numbers `/admin
  /stats` sends, it doesn't aggregate them itself.

## Round 17 of the same day, 2026-08-17 — asked ChatGPT to verify Round 16; found a real cross-user data leak on shared devices plus a real Infinity gap in the total-poisoning fix

Owner: *"let us ask chatgpt to verify too."* Sent a scoped prompt covering all
6 code changes from Round 16 (amount caps, client input limits, admin total
coercion, `totalEarned` completeness, the recount fix, Team paging). It found
two real issues; everything else checked out clean, verified against the
actual code before touching anything, same discipline as every prior round.

1. **Real bug: Team data (and more) leaks across users on a shared device.**
   ChatGPT's own framing named only `STATE.teamMembers`/`teamExpanded`, but
   tracing the actual sign-out flow surfaced the true scope was wider: a real
   sign-out only ever cleared `STATE.account` and `STATE.loaded` — in BOTH
   `doLogout()` AND, more importantly, the `space8-auth` listener's signed-
   out branch (`user-src/original_module.js`), which is the actual
   authoritative place a sign-out is detected (fires on a manual logout tap
   OR a Firebase session simply expiring — `doLogout()`'s own reset is
   mostly redundant with it, since `doLogout()` just triggers the same
   listener a moment later via `fbSignOut()`). Neither ever cleared
   `STATE.teamStats`/`teamMembers`/`teamExpanded`, `STATE.investments`, or
   `STATE.bankAccounts` — all treated as valid cache by their render
   functions, which skip re-fetching whenever a value is already present.
   On a shared device: User A opens Team (and/or Products, and/or binds a
   withdrawal account), logs out, User B logs in — User B could still see
   A's referral phone numbers, Active/Pending statuses, active investment
   plans, and saved withdrawal account details. Fixed with a single shared
   `resetUserState()` helper (clears every per-user field but deliberately
   leaves `products`/`settings`/`banners` alone — those are shared catalog
   data, correct to keep cached across a login switch), called from both
   `doLogout()` and the listener's signed-out branch so neither path can
   drift out of sync with the other again.
2. **Real gap: `Number(x) || 0` still lets `Infinity` through.** Every
   Round-16 total-poisoning fix used this pattern — but `Infinity` is
   truthy, so `Infinity || 0` stays `Infinity`. A stored `"Infinity"`,
   `"1e309"`, or a genuine double overflow would poison a running total the
   exact same way an unguarded string used to. Added a shared
   `finiteMoney(v)` helper (`Number.isFinite(Number(v)) ? Number(v) : 0`)
   and swept every unguarded or `Number()||0`-guarded money accumulator
   found across the file — not just the ones ChatGPT named — in
   `/admin/stats` (all 6 totals + `pendingPayouts`), `/admin/analytics`
   (`depAmount`/`witAmount` and their per-hour/per-band/per-day breakdowns,
   staff `amountApproved`/`amountDeclined`, `investedAmount`/
   `commissionsPaid`, `maturingPayout`), `/admin/deposits/list` and
   `/admin/withdrawals/list`'s per-day breakdowns, `wholeTeamDeposits()`
   (the Task Center whole-team-deposit milestone check — user-facing, not
   just an admin display), and `/admin/users/recount` (the repair tool
   itself must never WRITE an Infinity-corrupted value back into a user's
   document while "fixing" it).
   - **Deliberately did NOT apply `finiteMoney()` inside `/admin/integrity`**
     (`ledgerByUser`, `investedByUser`, `bal`, `storedInvested`) after first
     doing so and then catching the mistake: that endpoint's entire job is
     to DETECT and FLAG a corrupted value via its mismatch alerts, not
     silently launder it back to a clean 0 before an admin ever sees it —
     doing so would have made a genuinely-corrupted account (e.g. a real
     Infinity-valued `walletBalance`) invisible to the one tool that exists
     to catch it. Every field there is per-user-keyed (never summed across
     different users), so there's no cross-user contamination risk the way
     there was in the dashboard aggregators — reverted those 4 spots back
     to the plain `Number(x) || 0` they already had, which correctly lets
     `Infinity` propagate into the diff/mismatch check and trip the alert.
- **Verification**: `test-round16-limits-and-earnings.js` expanded with 10
  new checks — seeds a user with `Infinity` on all 6 money fields and
  confirms `/admin/stats`'s totals, `/admin/analytics`'s KPIs stay finite,
  AND separately confirms `/admin/integrity` still correctly flags that same
  Infinity-valued account with a mismatch alert instead of silently passing
  it. Full `test-*.js` suite green, 65/65. Rebuilt `user/index.html` via
  `node build-core.js` (round-trip OK) and bumped `user/sw.js`'s cache to
  `space8-shell-v244` since `user-src/original_module.js` changed. Admin
  panel needed no rebuild — server-only logic change.

## Round 18 of the same day, 2026-08-17 — full audit of investment timing, server-side monitoring, referral chain/commission accuracy, and Task Center safeguards

Owner: *"check through investment, daily profit timing, accuracy... high
monitoring of products and ongoing products by server... check also
referrals and referral codes, rewards and commission, proper counting...
every referral code, id is globally unique and regulated by server...
users or referral connection should be perfectly connected... even
strength task center, there should be proper counting, encryption and
safeguard."* No ChatGPT this round — direct code audit, same discipline as
Round 14. Read every function in the money-crediting and referral-chain
path before concluding anything.

**Confirmed already solid (no change needed) — listed so a future session
doesn't re-audit from scratch:**
- `dailyPayout = Math.round(expectedReturn / cycle)` timer math: per-day
  rounding never drifts the total, since the FINAL day's credit is computed
  as the exact remainder (`expectedReturn - paidOut`), not `dailyPayout *
  count` — the cycle always pays out exactly `expectedReturn` in total.
  `cycleDays`(210) and `returnMultiple`(42) are chosen so `price*42/210 =
  price/5` divides evenly for every tier, so this never even needs the
  remainder correction in practice.
- `settleInvestmentIfDue()`: idempotent, RECORD-BEFORE-CREDIT ordering
  (advance `payoutsMade` before crediting the wallet, roll back on a failed
  credit), lock-protected per investment (`payout:<id>`) — already
  extensively hardened in earlier rounds.
- Referral code generation (`generateUniqueReferralCode`): CSPRNG
  (`crypto.randomInt`, not a biased byte-mod), globally serialized via a
  single `withLock('referral-code-gen',...)` so check-and-claim is one
  atomic step — genuinely globally unique, "regulated by server" exactly
  as asked. `nextSequentialPublicId()` (each member's public ID) uses the
  same atomic-counter-under-lock pattern.
- Referral chain wiring (`completeRegistrationCore`, `/admin/user/attach-
  referrer`): self-referral blocked, banned-referrer's code rejected,
  admin tool has a defensive cycle-guard walk (can't attach a referrer
  that's already downstream). Team-count increments run AFTER
  `registrationDone` is set so a crash-retry can only under-count, never
  double-count.
- `creditReferralCommission()`: idempotent per (investmentId, level) via
  `commissionPaidLevels`, claim-before-credit, checks BOTH the buyer's and
  the referrer's banned status before paying, fires instantly (immediately
  after the purchase transaction commits, not waiting for any later read).
- Task Center milestone claim (`/team/milestone/claim`): progress
  (`activeL1Count`/`wholeTeamDeposits`) is always LIVE-computed from the
  real `referredBy` graph and each user's actual `totalInvested`/
  `totalDeposited` -- never cached/stale -- so "proper counting" holds;
  claim itself is lock + transaction + claim-flag guarded, credits both
  `walletBalance` and `totalEarned` (per Round 16).
- `/team/members`: no `.limit()` at all -- returns every real member at
  every level, so the referral chain a member sees is always complete, not
  silently truncated.

**2 real gaps found and fixed — both in the background "server monitoring"
sweeps, not the request-time crediting logic itself:**
1. `reconcileCashback()` (1s tick, checks every `active` investment
   platform-wide) was capped at `.limit(500)`. Unlike pendingDeposits/
   withdrawals (naturally small, self-draining within minutes), an
   investment stays `active` for its whole cycle (up to 210 days) and only
   accumulates as the platform grows -- past 500 concurrently-active
   investments, this sweep silently truncated to whichever 500 the DB
   happened to return first. Nothing was ever LOST (`settleAllForUser()`,
   an unbounded per-user query, still catches it up the moment that
   specific member's own `/account` or `/investments` is read), but
   crediting stopped being proactive/instant for accounts past the cap.
   Bumped to `CASHBACK_SWEEP_LIMIT = 5000` -- pure DB read+write per
   candidate, no external call, so this costs nothing extra on the
   overwhelming majority of ticks where little or nothing is actually due.
2. `reconcileCommissions()` (30s tick, retries commission-crediting for
   any investment from the last 10 minutes) was capped at `.limit(50)`,
   same platform-wide-not-per-user shape. `creditReferralCommission()`
   itself is a no-op once a level is already paid, so this only does real
   work when the ORIGINAL fire-and-forget call in `/invest/create` failed
   -- rare -- but a high-volume 10-minute window could still exceed 50
   real investments and leave whichever land past the cap un-retried.
   Bumped to `COMMISSION_RECONCILE_LIMIT = 500`.
- **Verification**: new `test-reconciler-caps.js` — seeds 520 due
  investments across 8 users (strictly more than the old 500 cap) and
  confirms ALL are credited by a single 1s-tick sweep; separately seeds 60
  fresh first-investments under one referrer (strictly more than the old
  50 cap) and confirms ALL get their L1 commission retried and paid by a
  single 30s-tick sweep, checked both via `commissionPaidLevels` and the
  referrer's actual wallet delta. This also surfaced (and fixed) a real
  gap in the SHARED `test-mockdb.js` test harness: it only ever supported
  `==`/`in` query operators, so `reconcileCommissions()`'s own `.where(
  'createdAt', '>', cutoff)` had literally never been exercised by any
  test in this suite before now (`db.js` itself already supports `>` fine
  against real MongoDB — this was purely a test-mock gap). Added `>`, `>=`,
  `<`, `<=` support to `test-mockdb.js`'s `where()`, comparing Dates by
  epoch-ms the same way real Mongo compares BSON dates — purely additive,
  every existing test using only `==`/`in` is unaffected. Full `test-*.js`
  suite green, 66/66 (65 existing + this new file). Server-only change
  (`server.js` + `test-mockdb.js`), no `user-src/`/`admin-src/` rebuild needed.

## Round 19 of the same day, 2026-08-17 — added space8-ex.com to the domain lock; re-diagnosed the referral-link "Not Found" as a Render dashboard config gap, not code

Owner sent a screenshot of a shared referral link (`https://space8-app
.onrender.com/register/ref=87A79Q`) opening to a plain black "Not Found"
page, and asked to add `space8-ex.com` to "script guard or arc guard."

1. **`guard-src.js`'s domain lock** (the `hostOk()` check baked into
   `user/index.html`'s `<script data-nx-guard>` — wipes the page and
   bounces to `https://space8.com/` on any host NOT in its allowlist, to
   stop a cloned/rehosted phishing copy from running) only allowed
   `space8.com`/`www.space8.com`/`localhost`/`127.0.0.1` plus any
   `*.onrender.com` subdomain. Added `space8-ex.com` and
   `www.space8-ex.com`. Sanity-checked the updated `hostOk()` logic
   directly (not just re-reading it): every intended host still resolves
   `true`, and a lookalike like `space8-ex.com.evil.com` still correctly
   resolves `false` (exact hostname match, not a substring/prefix check —
   adding a new allowed domain can't accidentally open a bypass for
   attacker-controlled subdomains of it).
2. **Referral-link "Not Found"**: re-confirmed this is NOT a code bug on
   this branch. Referral links are generated client-side as `origin +
   '/register/ref=' + code` (`referralLink()`), a PATH segment — not a
   real file, so it only resolves at all if the static host rewrites every
   unmatched path to `/index.html` first (the client then reads
   `location.pathname` itself to pull the code out). `render.yaml`'s
   `space8-app` service already declares exactly that rewrite
   (`routes: - type: rewrite, source: /*, destination: /index.html`) and
   already did the last two times this was checked. The screenshot's
   plain "Not Found" (not a browser error page, not the app's own UI) is
   Render's static-host default response for an unmatched path with NO
   rewrite actually in effect — meaning the live `space8-app` service
   still isn't applying this rule, i.e. Render's Blueprint sync hasn't (or
   can't) retroactively push a `render.yaml` route change onto an
   already-provisioned static site. **This needs a manual fix on Render's
   own dashboard, not a repo change**: open the `space8-app` static site →
   Redirects/Rewrites tab → add `Source: /*` → `Destination: /index.html`
   → **Rewrite** (not Redirect) directly there. Flagging this AGAIN in
   this file (see the Round 16 entry for the first flag) since apparently
   it hasn't been actioned yet — this is the actual blocker, not anything
   fixable by another `git push`.
- **Verification**: `node build-core.js` round-trip OK (guard-src.js feeds
  into the build); `user/sw.js` cache bumped `v244` → `v245`. Full
  `test-*.js` suite green, 66/66 (no server.js logic touched this round,
  so no new/changed test needed — the guard change was verified directly
  via a standalone Node check of the exact `hostOk()` logic instead, since
  it's plain client-side JS with no existing harness coverage).

## Round 20 of the same day, 2026-08-17 — actually fixed the referral-link "Not Found" in code (query-string link, no Render config needed) + auto-switch to Register screen

Owner sent fresh screenshots proving the bare root URL loads the app fine
(login, home, account all render normally at `space8-app.onrender.com/`)
but the shared referral link
(`https://space8-app.onrender.com/register/ref=87A79Q`) still 404s, and
asked to just change the link format instead of chasing the Render
dashboard fix again. That request was the right instinct, applied to the
right target: **root-path + query-string sidesteps the whole problem
without needing ANY server-side rewrite config at all** — a bare `/`
always serves `index.html` on every static host with zero setup (that's
just how static hosting works), unlike a deeper path like
`/register/ref=CODE` or the owner's own first suggestion of `/ref=CODE`
(still a non-root, non-existent path — would 404 for the exact same
reason).

1. **`referralLink()`** (`user-src/original_module.js`) now generates
   `origin + '/?ref=' + code` instead of `origin + '/register/ref=' +
   code`.
2. **Boot-time ref-code parsing** now reads `location.search`'s `ref`
   param first (works with zero server config), falling back to the old
   `/register/ref=CODE` path-regex if present (in case an already-shared
   old-format link is out there, or the Render rewrite ever does get
   fixed) — `_refCode` holds whichever one matched.
3. **Real second bug found and fixed in the same flow**: the code was
   already prefilling the referral field (`$('regReferral').value =
   ...`), but nothing ever switched the visible screen to Register — a
   first-time visitor following a referral link landed on the default
   Login screen with their code silently sitting filled-in on the HIDDEN
   Register screen underneath, unless they happened to manually tap over.
   Worse: even adding a bare `showRegisterScreen()` call at the top-level
   parse point wouldn't have been enough on its own — the `space8-auth`
   listener's signed-out branch unconditionally calls `showLoginScreen()`
   once Firebase's (async) auth check resolves, which always runs AFTER
   the synchronous top-level parse and would silently win the race,
   stomping the Register screen back to Login. Fixed by making that
   branch check `_refCode` and call `showRegisterScreen()` instead when
   one is pending.
- **Verification**: standalone Node check of the exact new parsing logic
  (root+query, old-path fallback, query params coexisting like a UTM tag,
  no-ref case) — all correct. `node build-core.js` round-trip OK;
  `user/sw.js` cache bumped `v245` → `v246`. Full `test-*.js` suite green,
  66/66 (server.js untouched, this is entirely client-side routing logic
  with no existing harness coverage for it, same as the domain-guard round).
- **The Render dashboard rewrite gap documented in Rounds 16/19 is now
  moot for referral links specifically** (they no longer depend on it),
  but SPA deep-linking in general still would benefit from it being fixed
  properly at some point — not urgent anymore, downgraded from "blocking"
  to "nice to have."

## Round 21 of the same day, 2026-08-17 — fixed a real "ghost account" bug: signs in fine, but zero profile ever existed, self-heal never caught it

Owner sent 4 screenshots of one specific number (0791201913): logs in
successfully, but Home shows UGX 0 everywhere, Account shows a blank
referral code and blank ID, and tapping Check In returns a big red "User
not found" error toast. Traced this to its actual root cause by reading
the real code, not guessing from symptoms.

**Root cause**: the Register button's own client flow (confirmed via
`test-register-self-heal.js`'s existing findings) calls `fbCreateUser()`
then goes straight to `POST /register` — it never calls `/account/create-
profile` first. `/register`'s own route already self-heals a missing user
doc (creates it via `defaultProfileDoc()` before calling
`completeRegistrationCore`), so a normal registration is safe. But if that
`/register` call itself never lands — a dropped connection, or the
person closing the app/tab the instant after Firebase account creation —
the Firebase auth account now exists (so a LATER login with that
phone+password succeeds; Firebase auth is a wholly separate system from
this app's own `users` collection) while NO Space8 profile document was
ever created for them. Every real endpoint (`/account`, `/checkin`, etc.)
correctly 404s "User not found" against that missing doc forever, with
this exact bug's symptom being different from previous self-heal work.

The `space8-auth` listener's existing self-heal (added in an earlier
round, see the 2026-08-16 registration/login security audit above) only
ever retried `/register` when `GET /account` responded `status:'success'`
with `registrationDone: false` — i.e. a PARTIALLY finished registration.
A genuinely MISSING doc instead makes `/account` return a plain 404
`status:'error'`, which that condition never matched, so the account was
stranded with zero automatic recovery, permanently.

1. **`server.js`**: `GET /account`'s 404 for a missing doc now also
   carries `code: 'NOT_FOUND'` (same pattern as the existing `code:
   'BANNED'`), giving the client a stable signal to retry `/register`
   against, distinct from a genuine network failure or any other error.
2. **`user-src/original_module.js`**: the `space8-auth` listener's
   self-heal condition widened to `(status:'success' && registrationDone
   === false) || (status:'error' && code === 'NOT_FOUND')` — now catches
   BOTH the partially-registered case (existing) and the genuinely-missing
   case (new). Deliberately does NOT retry on a plain network failure or
   on `BANNED` — only on a server-confirmed "no profile exists at all."
- **Verification**: extended `test-register-self-heal.js` with a new
  section proving `GET /account` returns `code: 'NOT_FOUND'` (not
  `BANNED`, not unset) for a genuinely missing doc. Separately verified
  the widened client-side condition directly with a standalone Node
  script against every real response shape it needs to distinguish:
  partially-registered (retry), fully-registered (don't retry, the normal
  case on every login), the new ghost-account 404 (retry), `BANNED`
  (must NOT retry), a plain network failure (must NOT retry — would spam
  `/register` on every connectivity blip otherwise), and a 401 (must NOT
  retry). Full `test-*.js` suite green, 66/66 (test count unchanged — this
  extended an existing file rather than adding a new one). `node
  build-core.js` round-trip OK; `user/sw.js` cache bumped `v246` → `v247`.

## Round 22 of the same day, 2026-08-17 — second ChatGPT pass on the investment/referral/task-center audit; 4 real bugs fixed, 2 genuine architectural tradeoffs documented (not hastily patched)

Owner re-sent the exact same broad audit request from Round 18 and asked
ChatGPT to review it independently a second time. It found real issues
Round 18 missed — verified each against the actual code (including reading
`db.js`'s `Transaction` class implementation directly to settle exactly how
non-atomic `db.runTransaction` really is) before touching anything.

**Fixed — 4 real, containable bugs:**
1. **Pathological daily-payout math could permanently strand an
   investment.** `settleInvestmentIfDue()`'s old flat `dailyPayout * daysDue`
   rate (exact remainder only computed on the FINAL day) can't overshoot for
   any built-in tier (`cycleDays=210` / `returnMultiple=42` always divides
   evenly), but an admin-configured custom product with an unlucky
   `expectedReturn`/`cycle` ratio could round UP enough that the running
   total already exceeds `expectedReturn` before the completion day arrives
   — ChatGPT's worked example: `expectedReturn=105, cycle=210` →
   `dailyPayout=round(105/210)=1` → 209 days of paying 1 each already totals
   209, so the old "final day" branch computes `max(0,105-209)=0`, hits
   `if(amount<=0)return`, and NEVER completes — `payoutsMade` frozen short
   of total forever, `status` stuck `'active'` forever, re-checked and
   skipped by every future sweep. Fixed with cumulative-target allocation:
   the running total credited by day N is now always
   `round(expectedReturn * N / total)`, which telescopes to EXACTLY
   `expectedReturn` at `N=total` for ANY ratio (not just ones that divide
   evenly) — produces IDENTICAL per-day amounts to the old approach for
   every ratio that DOES divide evenly, so this is a pure generalization,
   not a behavior change for any existing built-in tier. Also: the
   completion tick now ALWAYS flips the investment to `'matured'` even if
   the misconfigured-product math leaves nothing left to credit, so it can
   never get stuck the way it used to.
2. **`/admin/user/attach-referrer` could be raced into a genuine 2-node
   referral cycle.** Its `withLock('reg:'+userId,...)` only serializes
   against that SAME user's own concurrent self-registration — it does
   NOTHING to stop two DIFFERENT concurrent attach-referrer calls from
   racing each other, since `'reg:A'` and `'reg:B'` are different lock
   keys. Concrete exploit: fire "attach B as A's referrer" and "attach A as
   B's referrer" close together — both requests' cycle-check walks run
   concurrently, both see a clean chain (neither has a `referredBy` yet),
   both pass, both writes land: `A.referredBy=B` AND `B.referredBy=A`, a
   real cycle that would later let a buyer appear as their own L2 referrer
   in `creditReferralCommission()`. Fixed by wrapping the whole route in an
   additional global `withLock('attach-referrer',...)`, nested OUTSIDE the
   existing per-user lock — this admin-only, rare operation can afford full
   serialization at effectively zero cost.
3. **That same route's cycle-detection walk capped at 25 hops — too
   shallow for a chain that's organically grown deeper.** A real referral
   chain (unrelated to the 3-level commission structure, which only ever
   looks 3 hops deep) can exceed 25 hops over enough real registrations;
   past that depth the walk exhausts its budget and exits WITHOUT throwing
   before ever reaching back to the account being attached, silently
   letting a real (longer) cycle through undetected. Raised to 1000 hops —
   effectively unlimited for any realistic chain, while still bounding
   worst-case runtime against an already-corrupted loop from some other
   cause.
4. **`/team/milestone/claim`'s progress check had a real TOCTOU gap.**
   Progress (`activeL1Count()`/`wholeTeamDeposits()`) was computed ONCE,
   before the lock, and never re-verified at commit time. Concrete
   scenario: a member has exactly the target's worth of active L1
   referrals, passes the check, and in the gap before the transaction
   actually commits, one of those referrals gets banned (`activeL1Count`
   excludes banned members) — the claim would still pay out against
   now-stale progress. Fixed by re-verifying progress live, inside the
   lock, immediately before the credit — the check outside the lock stays
   too, purely as a cheap fast-fail for obvious non-qualifiers so they
   don't have to wait on the lock just to be told no.
- Also: **`reconcileCommissions()`'s time-windowed query was replaced
  entirely**, not just its cap raised again — see below, this is really
  part of the SAME finding class as items above, not a separate one.
- Minor: fixed a stale doc comment (`32^8` → the alphabet is actually 31
  characters, `31^8`) — no behavior change, just accuracy.

**A deeper architectural fix, not just a bigger number — `commissionPending`
flag replaces `reconcileCommissions()`'s time-window entirely:**
ChatGPT correctly pointed out that Round 18's fix (raising the query's
`.limit()` from 50 to 500) treated the SYMPTOM, not the actual wrong query
shape: `where('createdAt','>',cutoff).limit(N)` with no `orderBy` was a
platform-wide, unindexed scan of EVERY investment from the last 10 minutes,
first-purchase or not, even though `creditReferralCommission()` is a no-op
for the overwhelming majority of them. At high enough volume, more real
investments than N in any rolling 10-minute window would still silently
starve whichever ones land past the cap, aging out of the window with no
retry ever happening. Replaced with a `commissionPending` boolean: set
`true` only at creation for a first-investment (the only kind that ever
pays commission), cleared by `creditReferralCommission()` itself the
moment it determines there's truly nothing left to retry for that
investment (every early-return path now clears it too, not just the
success path). `reconcileCommissions()` now queries
`where('commissionPending','==',true)` directly — no time window, no
arbitrary cap needed at all, since the pending set is inherently tiny (only
the rare handful whose original fire-and-forget call is still outstanding
or failed), not "everything recent."

**Confirmed real, deliberately documented instead of hastily patched —
genuine architectural tradeoffs already baked into this codebase, not new
discoveries:**
- **Crash-window under-payment risk** (raised independently for cashback
  in `settleInvestmentIfDue()`, commission in `creditReferralCommission()`,
  and Task Center in `/team/milestone/claim`): all three follow the SAME
  deliberate pattern established across many earlier rounds — advance the
  ledger/claim-flag BEFORE the money actually moves, so a normal THROWN
  error rolls back cleanly and the safe failure direction is "under-pay,
  visibly fixable by hand" rather than "silently double-pay forever."
  ChatGPT is right that this doesn't protect against the PROCESS itself
  being killed between two sequential writes (a normal `try/catch` can't
  catch that) — confirmed by reading `db.js`'s `Transaction` class
  directly: `db.runTransaction()` QUEUES `t.update()`/`t.set()` calls
  during the callback and only applies them one-at-a-time, sequentially,
  during `_commit()` AFTER the callback returns — it provides genuinely
  ZERO atomicity beyond code-organization convenience, exactly as this
  file's comments have said all along, now directly verified against the
  implementation rather than taken on faith. A real fix needs either (a)
  actual MongoDB multi-document transactions via real sessions (worth
  investigating whether Atlas M0/shared-tier genuinely lacks this or
  whether that's an inherited assumption from a template this project was
  forked from — MongoDB replica sets, which M0 IS, have supported
  multi-document ACID transactions since server v4.0, so this may be worth
  re-checking rather than assumed) or (b) a durable outbox/job-queue
  pattern. Both are real architecture changes, not something to improvise
  as a side effect of an audit — flagged here for a dedicated future round
  with explicit sign-off, not attempted this round.
- **Referral code / public ID generation is not horizontally-scaling
  safe.** `withLock()` is in-process only; a second Node instance sharing
  the same database would NOT be serialized against the first, and there's
  no database-level unique index on `referralCode`/`publicId` as a
  backstop. Not a bug on the CURRENT single-process deployment (confirmed:
  `render.yaml`'s `space8-server` has no multi-instance config, and this
  exact "runs as a single Node process" assumption is already the
  foundation every `withLock()` call in this codebase depends on) — but
  must be revisited (unique index + duplicate-key-aware retry in
  `tryClaim()`) BEFORE ever scaling this service to more than one instance.
  Noting this explicitly so it isn't silently forgotten if that ever
  happens.
- **`reconcileCashback()`'s poll-everything-active shape** (vs. an
  indexed `nextPayoutAt`-based "only fetch what's actually due" query)
  is a real, valid architectural improvement ChatGPT suggested — NOT
  implemented this round because, unlike `commissionPending` (safe to
  introduce with zero migration story, since it only matters for
  investments created AFTER this deploy), a recurring `nextPayoutAt`
  field would need a migration/backfill for every EXISTING active
  investment, or the query would silently stop sweeping all of them the
  moment this shipped. Left as a recommended future improvement, not
  attempted as a rushed side effect of this round.
- **Verification**: new `test-round2-audit-fixes.js` (16/16) — proves the
  pathological-product fix converges to EXACTLY `expectedReturn` through
  genuine day-by-day accumulation (not just checking the final state) and
  always reaches `matured`; proves two concurrent attach-referrer calls
  can no longer both land (exactly one succeeds, the other is rejected as
  a loop); proves a 29-hop cycle (deeper than the old 25-hop cap, within
  the new 1000-hop one) is now correctly caught; proves a Task Center
  claim is refused once live progress has genuinely dropped below target
  rather than paid against stale data. Also updated `test-reconciler-
  caps.js`'s commission section to seed `commissionPending: true` directly
  (the old time-window-based seeding no longer applies) and added a check
  that the flag is actually cleared once resolved. Full `test-*.js` suite
  green, 67/67. Server-only change, no `user-src/`/`admin-src/` rebuild
  needed.

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

0. **Codex full-codebase audit (27 findings) + re-verification pass — DONE as of
   2026-08-17.** First pass: went through all 27 findings one by one, fixed every
   confirmed real bug (product/settings validation, stored XSS escaping, delete-user
   reordering, session-epoch stale-response guard, admin credit/debit bounds,
   nested-sheet Back-button bug, Team member cache staleness, EAT day-boundary
   mismatch, ghost-account registration-failure handling, broadcast audit-log gap,
   reconciler oldest-first ordering, 4 factually-wrong assistant replies, stale
   push-approval domain, SW-reload-mid-claim, no DecompressionStream fallback,
   misleading bank-transfer admin copy), documented (not changed) the genuine
   architectural tradeoffs/intentional decisions/infra investments. Then asked Codex
   to re-verify its own findings against the fix commit — it confirmed 21/21 claimed
   fixes and found 6 more real gaps: a fractional product price could round to a
   free UGX-0 plan, delete-user's team-count math was wrong for a multi-level
   referral chain (fixed with a full recompute, which then caught ANOTHER real
   ordering bug of its own while writing the test for it), a purchase could charge
   stale price/cycle/return after an admin edit mid-request, 3 more assistant
   replies still claimed no deposit/withdrawal cap, Team cache still went stale on a
   Pending→Active flip with no headcount change, and a real shared-device data leak
   through open sheets/notifications/the live-refresh timer that the session-epoch
   guard didn't yet cover everywhere. Also found and accepted (not faked) a genuine
   architectural limit: the reconciler oldest-first fix does NOT fully solve
   starvation for cashback/commission reconcilers past their 5000 cap the way it
   does for deposits/withdrawals, since active investments don't drain out of
   `status:'active'` until maturity — needs a `nextDueAt`-indexed redesign, not an
   audit-round patch. `test-codex-round2-fixes.js` now 39/39; full suite 68/68. Read
   BOTH 2026-08-17 AGENT_LOG.md entries ("Codex full-codebase audit" and "Codex
   re-verification of the audit-fix commit") before re-auditing this codebase from
   scratch — most of what a fresh audit would find has already been triaged.
0b. **Codex fresh full-codebase review, round 3 — DONE as of 2026-08-17.** Two
   genuine money-safety races fixed (deletion racing a concurrent deposit/
   withdrawal for the same account; deletion racing a registration claiming
   that same account as a referrer, into a permanently orphaned `referredBy`
   — both closed with new in-process locks, `_userBeingDeleted` and
   `referrer-guard:<id>`), plus several admin-panel display-truncation bugs
   (deposits/withdrawals/promo-codes lists could hide a genuinely unresolved/
   active row past their display cap; `/admin/user/detail` and
   `/admin/transactions/list` sorted after truncating instead of before) and
   a real data-corruption risk in "Recalculate totals" (now refuses to write
   partial totals if its scan is truncated, instead of silently zeroing real
   history). Also flagged, NOT fixed — a genuine architectural gap, not a
   containable bug: `/admin/users`, `/admin/stats`, `/admin/integrity`,
   `/admin/analytics`, and `recomputeTeamCounts()` are ALSO capped at
   10,000 users / 200,000 ledger rows and would silently under-report/
   under-repair past that volume — needs real pagination/aggregation, a
   bigger lift than this pass. `test-codex-round3-fixes.js` 28/28; full
   suite 69/69. Read the 2026-08-17 AGENT_LOG.md entry ("Codex fresh
   full-codebase review (round 3)") before re-auditing from scratch.
0c. **Personal Claude code review (not Codex) — DONE as of 2026-08-17.** Owner
   asked Claude to personally read through the scripts after two rounds of
   external Codex review. Read server.js, assistant-engine.js,
   admin-src/index.html, build-core.js, build-admin.js fresh, in full. Found
   one real bug: Deposits/Withdrawals admin tabs' referral-code column and
   "search by code" only worked once the Users tab had been opened first (a
   client-side `_users` array only that tab populated). Fixed by having
   `/admin/deposits/list`/`/admin/withdrawals/list` send `referralCode` on
   each row directly, same as they already do for `accountPhone`. Full suite
   71/71 (30/30 in test-codex-round3-fixes.js, 2 new assertions added there).
   Read the 2026-08-17 AGENT_LOG.md entry ("Personal code review") for detail
   — it also lists what's been read fresh vs. not yet in this pass
   (user-src/original_module.js not yet re-read fresh, though it's been
   covered piecemeal across ~22 prior rounds).
0d. **Codex review of 2026-08-18's referral-code/banner/ladder work — DONE.**
   1 High (a deleted user's still-valid Firebase token could resurrect the
   account via `/register`'s self-heal, including a fresh welcome bonus —
   fixed with `checkRevoked:true` on both `verifyAuth`/`verifyAuthWithEmail`,
   closing it for every authenticated endpoint at once), 3 Medium (home-slide
   storage could exceed MongoDB's 16MB doc limit AND had an unlocked
   lost-update race — both fixed by a one-doc-per-slide storage redesign;
   legacy referral codes weren't covered by the case-collision check — fixed
   with a one-time boot backfill), 2 Low (the carousel played back in
   REVERSE order for 3+ slides due to a sign error in the animation-delay
   math — fixed; banner changes don't push to an already-open member
   session — flagged as real but PRE-EXISTING across every banner type, not
   something this round introduced, left for the owner to decide on rather
   than unilaterally building live-push). Three of the five fixes were
   verified empirically (revert the fix, confirm its own new test actually
   catches the regression) not just read-and-trust. `server.js` needs a
   Railway redeploy — this one touches auth on every endpoint, more
   consequential than a typical un-deployed-fix gap. Read the 2026-08-18
   AGENT_LOG.md entry ("Codex review of the day's work") for full detail.
0e. **Admin-settable withdrawal request hours (EAT) — DONE.** Owner: "control
   withdrawal requests time... EAT time, settable in admin settings... server
   side... secure." Two new settings (`withdrawHoursEnabled`,
   `withdrawHoursStart`/`End`, 0-23, off by default), enforced in
   `/withdraw/request` via `isWithinWithdrawHours()` (`server.js`, next to
   `eatNow()`) — checked before min-amount/PIN/bind-account, off the
   server's own clock only (no client time parameter exists on this
   endpoint). Handles wraparound past midnight (start>end) and fails OPEN
   on a degenerate start===end config rather than ever locking out every
   withdrawal platform-wide. Admin UI: toggle + two hour `<select>`s in
   Settings → Rates & limits. Client shows a purely informational note in
   the withdraw sheet (server enforces regardless). `test-withdraw-hours.js`
   (25/25) computes every scenario relative to the REAL current EAT hour at
   test time, so it never flakes by time of day. See the 2026-08-18
   AGENT_LOG.md entry ("New feature: admin-settable withdrawal request
   hours") for detail, including a real bug caught in the TEST itself
   (not the feature) while writing it.
0f. **Notification management (view/delete) + gift-code expiry in minutes —
   DONE.** Owner: "make sure l can see sent notification, delete them and
   gets deleted from all accounts, also... assign the duration of giftCodes
   to minutes not days." Broadcasts are a single shared doc (no per-user
   copy), so `POST /admin/notifications/delete` deleting one document is
   sufficient for it to vanish from every account's bell at once — new
   `GET /admin/notifications/list` shows what's been sent, who sent it, and
   read counts; admin UI is a new "Sent notifications" table in Settings.
   Gift codes never had an expiry concept at all before this —
   `/admin/promocodes/generate` now takes an optional `durationMinutes`
   (blank = never expires, unchanged default), checked lazily at
   `/redeem` time. `test-notifications-management.js` (19/19) and
   `test-giftcode-expiry.js` (17/17). See the 2026-08-18 AGENT_LOG.md entry
   ("New features: notification management... + gift-code expiry in
   minutes") for detail.
0g. **ChatGPT review of the notifications/gift-code-expiry commit — DONE.**
   2 Low findings, both real, both fixed: `/admin/notifications/delete` had
   no lock on its check-then-delete (two concurrent deletes of the same id
   could both report `success`, one falsely) — fixed with the same
   `withLock('notif-delete:'+id, ...)` idiom used everywhere else this race
   shows up; `durationMinutes` used `parseFloat` (silently accepted
   `"30minutes"` as `30`) — fixed to strict `Number()`, matching
   `SETTINGS_CRITICAL_RANGES`'s convention. Proving the lock fix needed a
   new `global.__mockDbDelayMs` hook on BOTH `.get()` and `.delete()` in
   `test-mockdb.js` — a delay on `.get()` alone never produced a real race
   (Node finishes a timer callback's whole microtask chain, delete
   included, before servicing the next pending timer). Pagination on
   `/admin/notifications/list`'s 200-item cap was flagged as "worth a
   decision," not a bug — deliberately left as-is (notifications have no
   "must eventually be actioned" state, unlike deposits/gift-codes). See
   the 2026-08-18 AGENT_LOG.md entry ("ChatGPT review of the notifications/
   gift-code-expiry commit") for detail. `server.js` needs a Railway
   redeploy for the lock fix to take effect.
0h. **New app icon: satellite-in-orbit mark — DONE.** Owner: "let ask codex to make
   new app icon." Replaced the old blue figure-eight/infinity loop with a
   satellite-on-a-tilted-orbit-ring mark, single color `#2e6bff`, no gradients —
   designed by Codex via an external prompt (same pattern as the ChatGPT review
   rounds: drafted the prompt, owner ran it, pasted back SVG). Regenerated
   `icon-192/512.png`, `icon-maskable-192/512.png`, `favicon.png` in both `user/`
   and `admin/` (always shipped identical); SVG source at `design/app-icon.svg`.
   `user/sw.js` `CACHE` bumped to `v264` since the filenames didn't change — without
   the bump, installed PWAs would keep the old cached icon under the same name
   indefinitely. Verified the mark clears Android's maskable safe-zone crop with
   real margin (~171px farthest point vs. a 205px safe radius at 512×512); it does
   blur into a blob at 32px favicon size, left as-is since that's a minor
   browser-tab asset, not the home-screen icon. No `server.js` change, no
   Railway redeploy needed — Render auto-deploys `user/`/`admin/` on push. See the
   2026-08-18 AGENT_LOG.md entry ("New app icon: satellite-in-orbit mark").
0i. **Referral share text — full launch-announcement post — DONE.** Owner pasted a
   target format (rocket-emoji header, deposit/withdrawal terms, 3-level bonus
   structure, link repeated twice) to replace the old one-line "Join Space8 and
   start earning with my referral link." `shareReferral()` (`user-src/
   original_module.js`) now builds it with every number pulled from live
   settings (`STATE.settings`, same fallback pattern as `openGiftCodeSheet`/
   `openSupportSheet`) — NOT the numbers in the owner's example text, which used
   15,000/3,000 for the deposit/withdrawal minimums while the real live settings
   are 20,000/5,000 (`DEFAULT_SETTINGS` in `server.js`); used the real values so
   the shared message can't advertise wrong terms and stays correct if the owner
   changes them later. `url` deliberately left out of `navigator.share()` — most
   share targets append it a second time after `text`, which would add a stray
   third copy of the link. See the 2026-08-18 AGENT_LOG.md entry ("Referral share
   text rebuilt into a full launch-announcement post").
0j. **Announcement dialog polish — DONE.** Owner, from a screenshot: remove the thin blue
   accent bar above the "Announcement" title (`.announce-accent`, deleted along with its
   markup), and stop the scrollable body (deposits/withdrawals/fees/referrals copy) from
   clipping text mid-line at the scroll edges — `.announce-text` now carries a
   `mask-image` gradient that fades its top/bottom ~22px to transparent instead. Verified
   with a Chromium render of the isolated dialog markup, scrolled, screenshotted. `user/sw.js`
   `CACHE` bumped to `v265`. See the 2026-08-18 AGENT_LOG.md entry ("Announcement dialog:
   removed top accent bar, scroll edges now fade instead of clipping").
0k. **Checkmark unified to literal ✓ (U+2713) — DONE.** Owner: "your tick is very
   different from that, so replace very well." The `check` entry in `ICONS`
   (`user-src/original_module.js`) was an SVG stroked-path icon — now
   `<span class="checkmark">✓</span>`, matching the exact character already used in
   the "✓ Claimed" checkin button text (verified by codepoint). Covers both places
   it renders: the checkin button's icon and the Task Center claimed-mission pill.
   The success popup (login/registration) had its own separate copy of the same old
   SVG in `index.html` markup — replaced the same way. New `.checkmark` CSS sizes/
   colors it per context. Also reworded 4 success messages to the owner's exact
   phrasing: "Login successful ✓", "Registration successful ✓", checkin toast now
   leads with "Claimed successfully ✓" (kept the amount/streak — streak has no
   other display anywhere), gift-code toast now "+X redeemed successfully ✓".
   `user/sw.js` `CACHE` bumped to `v266`, then `v267` after a follow-up fix — it
   shipped with `font-weight:800` on `.checkmark`, which rendered the "Light"
   check mark just as thick/bold as the old icon (owner: "still the same as
   usual" after seeing it live); dropped to normal weight — but that STILL
   looked heavy on the phone. Codex found why: Android renders the literal ✓
   (U+2713) from a fallback SYMBOL font that ignores CSS `font-weight` entirely,
   so no weight value ever thinned it on-device (it only looked thinner in
   desktop-Chromium test renders, a different fallback). **Final fix (v268):
   abandoned the Unicode character, back to an inline SVG (`.s8-check`,
   `ICONS.check`) whose `stroke-width` we control — 1.75/1.9/2 per size, all
   lighter than the old 2.4 — which IS honored on every browser.** Lesson for
   future icon work: never rely on CSS to restyle a bare Unicode symbol glyph;
   use an SVG. See the 2026-08-18 AGENT_LOG.md entries ("Checkmark unified to
   the literal ✓...", "Fixed the checkmark fix: it shipped bold...", and
   "Checkmark, take three: SVG stroke, not Unicode char").
0l. **Codex review of the sweep/banner-card/check-in-screen round — DONE.** 3
   Medium + 1 Low, all confirmed real, all fixed. **Medium: stored CSS
   injection via banner data** — `/admin/banners/set`'s format check only
   matched the prefix (no `$` anchor); `bcardBg()`/`identityBannerHtml()`
   interpolate a banner value into an inline `style="url('...')"` inside HTML
   later assigned via `.innerHTML`, and `esc()`'s quote-escaping is NOT a
   defense there since `.innerHTML` decodes entities back to literal
   characters before the CSS engine parses the result — confirmed live with a
   Playwright render (a crafted payload landed a real second CSS declaration).
   Fixed with `DATA_IMAGE_RE`, requiring the WHOLE string after the prefix to
   be valid base64, anchored. **Medium: Security-PIN late-response guard**
   only checked the sheet STACK NAME (`'generic'`), which Gift Code/Check-in/
   Records all share — a slow PIN status fetch could overwrite whichever of
   those the member opened next. Fixed the same way `isPlanDetailShowing()`
   already solves this for its own sheet: a `data-generic-sheet="pin"` marker,
   checked before writing. **Medium: check-in's reworked claim callback had no
   `authEpoch` guard** — the one thing every other STATE-mutating `await` in
   this file carries — so a delayed response after a sign-out/sign-in on a
   shared device could credit one member's bonus onto another's live screen.
   Both client fixes verified with a REAL-script Playwright harness (loads
   the actual `original_module.js`, not a reimplementation) proving revert →
   fails, restore → passes. **Low: `banners/main` could exceed MongoDB's
   16MB limit** — 24 slots now exist; redesigned to one document per slot
   (same fix already applied to Home slides), with `backfillBannerDocs()`
   migrating old data additively (never deletes the legacy doc). New
   `test-banner-doc-backfill.js` (8/8), extended `test-banners-security.js`.
   `user/sw.js` `CACHE` bumped to `v273`. **`server.js` changed → Railway
   needs a redeploy.** See the 2026-08-18 AGENT_LOG.md entry ("Codex review of
   the sweep/banner-card/check-in round").
0m. **Deposit/withdraw icons, announcement-title font, referral share image — DONE.**
   Owner supplied 4 reference images. `ICONS.deposit`/`ICONS.withdraw`
   (`user-src/original_module.js`) replaced with solid-fill designs (arrow-into-coin /
   card-arrow-coin), each `$` a real SVG `<mask>` cutout — verified against the real
   `ico()` function via Playwright, including that the shared mask `id` renders correctly
   when `ico('deposit')` is duplicated in the DOM at once (Home action row + open Deposit
   sheet). A self-hosted `Archivo Black` `@font-face` was added (`user-src/index.html`,
   same base64-embed convention as `Inter`) and applied to `.announce-title` (bold,
   uppercase) to match a reference dialog screenshot. `shareReferral()` now attaches
   `user/plans-table.jpg` (a re-compressed, data-verified copy of the owner's investment-
   plans table graphic) via the Web Share API's `files` capability when the target
   supports it (`navigator.canShare({files:[...]})`), falling back to text-only share
   otherwise. `user/sw.js` `CACHE` bumped to `v274`. No `server.js`/`admin-src/` changes —
   no Railway redeploy needed. See the 2026-08-18 AGENT_LOG.md entry ("Deposit/withdraw
   icons replaced, Archivo Black display font on the announcement title, referral share
   now attaches the plans-table image").
0n. **Shorter Home action buttons (trimmed twice, same day) + referral ladder
   recalculated to flat UGX 1,000 — DONE. Announcement dialog restyle — MISTAKE,
   reverted, do not redo without being asked.** `.action-btn` (Deposit/Withdraw/Check-in
   on Home) padding/icon size
   reduced for a shorter, less bulky look, then trimmed further the same day on a
   follow-up "reduce it abit" request (padding `9px 8px`→`7px 8px`, icon badge
   `36px`→`32px`, icon-svg `17px`→`15px`). `TEAM_MILESTONES` in `server.js`
   recalculated to a flat UGX 1,000/active-referral (was 1,500) — see the "Active
   Level-1 referral ladder" entry above for the new numbers; only reward VALUES
   changed, target numbers untouched, so the existing claim-flag-by-target mechanism
   needed no migration. The claim endpoint's encryption/server-side/idempotency/
   no-double-claim properties the owner asked for were already true of
   `/team/milestone/claim`'s existing lock+transaction+live-recompute implementation —
   nothing new was needed there beyond the table values.
   **The announcement dialog is UNCHANGED from before this round** — a redesign
   (circular bell-icon badge above the title, stacked OK/Telegram buttons instead of
   the original side-by-side Cancel+Telegram row) was built and shipped off a
   misread of the owner's trailing "...also back to dialog" next to a reference
   screenshot, and the owner explicitly said they never asked for it. Reverted in
   full the same round — `.announce-icon`/`.announce-actions`/`.pillbtn`/the dialog
   markup are byte-identical to before this round. **Do not restyle the announcement
   dialog again unless the owner explicitly asks for a specific change** — an
   attached reference image is not itself a request. `user/sw.js` `CACHE` bumped to
   `v275` (ship) then `v276` (revert) then `v278` (second button trim; `v277` was the
   Codex icon-redesign round, see 0o below). **`server.js` changed (TEAM_MILESTONES) →
   needs a Railway redeploy** for the new reward amounts to take effect. See the
   2026-08-19 AGENT_LOG.md entries ("Shorter Home action buttons, referral count-ladder
   recalculated to flat UGX 1,000 (announcement-dialog restyle shipped then
   immediately reverted — owner never asked for it)" and "Home action buttons
   (Deposit/Withdraw/Check-in) made shorter again").
0o. **Deposit/withdraw icons replaced again, Codex-designed — DONE.** The 2026-08-18
   hand-drawn icons (see 0m above) didn't match the owner's reference images closely
   enough — the owner had Codex design the actual SVG geometry (repo/AGENT_LOG.md
   pointer relayed to it, same pattern as the review-prompt workflow) and pasted the
   result back verbatim. `ICONS.deposit`/`ICONS.withdraw` (`user-src/
   original_module.js`) replaced with Codex's design: a rounded weighty arrow dropping
   into a `$` coin (deposit), and a card + eight-segment "spoked coin" + broad
   left-pointing arrow (withdraw) — both `fill=currentColor`/`stroke=none` with every
   cut-out (the `$`, the arrow silhouettes) as a real transparent SVG `<mask>` hole.
   `ico()` now mints a fresh mask id on every call (`ICON_UID` counter +
   `__ID__`-placeholder substitution) instead of reusing one static id per icon name —
   more defensive than the previous round's confirmed-safe shared-id approach. New CSS
   (`.money-action-icon`) needed since these two icons are filled via `color`, unlike
   every other icon in the file which is colored via `stroke`. `user/sw.js` `CACHE`
   bumped to `v277`. No `server.js`/`admin-src/` changes — no Railway redeploy needed.
   See the 2026-08-19 AGENT_LOG.md entry ("Deposit/withdraw icons replaced again,
   Codex-designed to match the owner's reference images exactly").
0p. **Referral count-ladder recalculated again to flat UGX 500 — DONE.** Same-day
   second rate change on `TEAM_MILESTONES` (see 0n above for the first: 1,500→1,000):
   now 1,000→500. See the "Active Level-1 referral ladder" entry above for the current
   numbers. Same mechanism as before — only reward values moved, target numbers and the
   claim-flag-by-target no-migration-needed property both unchanged.
   `TEAM_DEPOSIT_MILESTONES` (whole-team-deposit ladder) untouched both times — owner's
   wording scopes this to the count ladder only. `test-referral-milestones.js` updated
   again. **`server.js` changed → needs a Railway redeploy.** No client-side change, no
   rebuild, no cache bump (nothing in `user-src/` hardcodes reward amounts). See the
   2026-08-19 AGENT_LOG.md entry ("Referral count-ladder recalculated again to flat
   UGX 500 (was 1,000)").
0q. **Bank withdrawal accounts reactivated — DONE.** See the dedicated "Withdrawal
   accounts now support banks too" entry a few sections above (in Product ladder) for
   the full design — bank-transfer withdrawal, merged into the SAME bind-then-pick
   flow mobile money already uses, not a separate category. `test-bank-withdrawal-
   accounts.js` (40/40). **`server.js` changed → needs a Railway redeploy.** `user/
   sw.js` `CACHE` bumped to `v279`. See the 2026-08-19 AGENT_LOG.md entry ("Bank
   withdrawal accounts reactivated, merged into the existing Withdrawal Accounts
   flow").
0r. **Balance-card figures shrink past 7 digits; withdrawal network select no longer
   defaults — DONE.** Home's 3 balance cards (`.bamt`) now shrink proportionally via
   a graduated `--amt-scale` (1 at ≤7 digits, stepping down through 8/9/10/11+ digits)
   instead of overflowing/wrapping once a figure grows large. The Withdrawal Accounts
   add-form's network `<select>` no longer defaults to MTN Mobile Money — starts on a
   disabled, greyed "Select network" placeholder; submit is rejected if it's still
   unselected. `user/sw.js` `CACHE` bumped to `v280`. No `server.js` changes, no
   Railway redeploy needed. See the 2026-08-19 AGENT_LOG.md entry ("Balance-card
   figures shrink past 7 digits; withdrawal network select no longer defaults").
0s. **Codex review of the last 3 commits — DONE.** 2 Medium + 2 Low, all real, all
   fixed. **Medium: withdrawal `holder` came from the request body, not the bound
   account** — the bound-account lookup only matched `(userId, network, phone)`,
   never `holder`, so a mismatched holder could reach storage and, for a bank
   destination, get sent to MarzPay as `accountName`. Fixed: `holder` now always
   comes from `boundAcct.holder` after the lookup, never `req.body.holder`.
   **Medium: Task Center reward totals recomputed from TODAY's ladder rate, not
   what was actually paid** — `/team/stats.teamRewards` and `/admin/analytics`'s
   `kpis.teamRewardsPaid` both summed the CURRENT `TEAM_MILESTONES`/
   `TEAM_DEPOSIT_MILESTONES` reward values against old claim flags, silently
   understating any claim made under an earlier rate once the ladder started
   changing today. Fixed by summing the real, immutable `team_reward` transactions
   instead. **Low: a MarzPay bank-list outage could hide banks for the rest of a
   session** — an empty (but "successful") `/public/banks` response got cached
   client-side as permanently-fetched; fixed to only cache a non-empty list.
   **Low: 5 more assistant replies still said mobile-money-only** for withdrawals —
   reworded. New/extended tests: `test-bank-withdrawal-accounts.js`,
   `test-referral-milestones.js`, `test-admin-stats.js`,
   `test-withdrawal-security.js` (also fixed a real test-ordering bug the new test
   exposed there — a "find the withdrawal for this user" helper matched on userId
   alone and grabbed the wrong one once a user had more than one withdrawal; fixed
   to match on `ref`). `user/sw.js` `CACHE` bumped to `v281`. **`server.js`
   changed → needs a Railway redeploy.** See the 2026-08-19 AGENT_LOG.md entry
   ("Codex review of the last 3 commits: 2 Medium + 2 Low, all real, all fixed").
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
