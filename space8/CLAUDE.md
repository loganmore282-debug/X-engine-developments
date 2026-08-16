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

- **Palette — vibrant blue is the actual page CANVAS now, white cards float on top.**
  As of 2026-08-16, `--blue: #2e6bff` and **`--page-bg` is the SAME blue** — this is a
  structural change, not just an accent-color swap. The owner sent reference screenshots
  of another platform and was explicit: "I wanted a vibrant blue which was throughout
  like that platform, it taken like 80% and whites like 10%." (This followed a brief,
  explicitly-confirmed detour to green, then back to blue — green is fully gone, don't
  resurrect it without being asked again.) Concretely: `body`/`main`/every `.page` render
  directly on `--page-bg` (blue); `.topbar` and `.navbar` are blue with WHITE wordmark/
  nav-icon/nav-label text (`.navitem` inactive = `rgba(255,255,255,.68)`, active = `#fff`
  solid, same for `.svg-cart`/`.svg-team` fills); `.section-title` headers are white when
  inside a `.page` (`.page .section-title` override) but stay the darker `--blue-dim` in
  their base rule for any future sheet content that renders on white — don't collapse
  that distinction, even though nothing currently uses a `.section-title` inside a sheet
  (the notification bell's "Recent Activity" sub-heading that used to be the live
  example was removed 2026-08-16 when Codex replaced the whole sheet with real
  database-backed notifications, titled "Notifications" now, no `.section-title` inside
  it at all — `.sheet-title` is a separate, always-white-context class, unaffected).
  Every content card (`.card`, `.prod-card`, `.plan-card`,
  `.mystats .card`, `.mtile`, `.menu-list`, `.shortcut`, `.banner` fallback) is now plain
  white with **no colored border** — the blue-glow borders/tints from the immediately
  prior (green, and blue-accent-on-white) design passes were deliberately removed because
  they'd blend into a same-hue blue canvas or were simply redundant once white cards do
  the contrast work on their own. Three surfaces were deliberately kept OFF the blue
  canvas and given `--void` (light, near-white) backgrounds instead, because putting them
  on `--blue` would break their own internal contrast: `#loadingScreen` (its mark is drawn
  in `--blue` and would vanish), `.auth-screen` (an explicit earlier "no gradient, minimal,
  formal" decision, unrelated to this change, still holds), and `.assist-panel` (its
  own `.msg.user` bubbles are `var(--blue)` and would vanish on a `var(--blue)` panel).
  `--blue-dim: #1c48b3` / `--blue-mute: #7fa1f0` / `--blue-glow: rgba(46,107,255,.22)` are
  all derived from the same hue. **The CSS custom properties kept their `--blue*` names
  through every color change this session** (blue → sapphire → green → back to this
  vibrant blue) rather than being renamed each time — a full rename across every
  `var(--blue...)` reference in this ~600KB file was judged higher-risk (easy to miss an
  occurrence) than swapping 5-6 token values at the source. If the accent color changes
  again, prefer that same value-only-swap approach unless there's a strong reason to do
  the full rename. A single desaturated red (`--danger`) is the only non-blue color,
  reserved for genuine failure states. No violet, no gold, no green, no gradients
  anywhere.
- **Admin panel palette (`admin-src/index.html`), re-themed 2026-08-16 to match the
  above.** Was dark (`--bg:#050507`) with a violet accent (`--gold:#6C4EFF`, despite the
  name) and a system font. Now: `--bg:#f4f7fb` (light neutral page, NOT the full blue
  canvas the user app uses — admin is data-dense tables/charts/forms, so a light neutral
  background was chosen over literally replicating the mobile blue-canvas treatment;
  revisit if the owner asks for closer matching), `--card:#ffffff`, `--ink:#0a1220`,
  `--sub:#5b6b84`, `--line:#d7dfec` — all copied from the user app's `--void`/`--surface`/
  `--ink`/`--ink-dim`/`--line` values. `--gold:#2e6bff` / `--gold-deep:#1c48b3` /
  `--gold-ink:#fff` (variable names kept, same convention as `--blue*` above) drive tabs,
  primary buttons, and the brand mark — same hue as the user app's `--blue`/`--blue-dim`.
  `--ok`/`--danger`/`--warn`/`--sky` were re-picked as legible light-mode status colors
  (green/red/amber/teal) since the originals were tuned for dark chips (pale text on a
  near-black pill) and would be illegible inverted onto white. Three literal (non-token)
  hex values that no longer made sense once the accent went from violet to blue were also
  fixed: the brand-mark radial-gradient center (`#1a1530`→`#12275c`), the primary button's
  gradient highlight (`#F3C98A`→`#8fb4ff`), and the modal backdrop tint
  (`rgba(40,26,16,.45)`→`rgba(10,18,32,.45)`). Same self-hosted Inter `@font-face` as the
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
  before this. Then: 4-tile matrix (payout account / deposits / withdrawals / security
  PIN), About/Rules/Terms/Support sheets sourced from `/public/settings` (**no
  Privacy** — removed earlier this session, "also remove privacy policy 🙄" — don't
  re-add it without being asked), logout.
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
  against 43 weighted intents (grown from an original ~16), fuzzy-matches specific
  product names from the live catalog, extracts a money amount from the message to
  compute real withdrawal-fee math on the spot, and blends in the prior turn's topic
  for short ambiguous follow-ups. Every reply is grounded in a fresh
  `getSettings()`/`getProducts()`/account read, same as the client used to do
  manually — so it never goes stale as the admin changes fees/rates/products. Refuses to
  reveal a PIN/password if asked. Rate-limited (`assistLimiter`, 30/min/user) to bound DB-
  read spam, not API spend. No env var needed, nothing left to configure.
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
28% / L2 2% / L3 1% (31% total) · duration 210 days · return x42. Still verify against live
Settings in the admin panel before assuming these are what's actually configured — the
admin panel always wins if the owner has touched it.

**Referral commission is deliberately first-purchase-only, confirmed intentional —
don't re-flag this as a bug.** L1/L2/L3 commission pays exactly once, off a member's
first-ever investment (`isFirstInvestment` on the investment doc), never on later
purchases/recharges by that same member. A second review (Codex, 2026-08-16) asked
whether this matches intended rules — yes, this was a deliberate design decision made
earlier in the project, not an oversight. Later purchases still count toward Task
Center milestones (active-referral-count, L1-deposit-total), they just never re-trigger
L1/L2/L3 commission.

## Account identity: publicId ("ID:000000"), added 2026-08-16

Every member has a permanent, server-issued, globally-unique account number shown on
the Account screen as `ID:000000` (owner: "every registered user has a unique global
recognized, server given id"). `publicId` on the user doc — a random 6-digit number
(`generateUniquePublicId()` in `server.js`, same generate-check-retry shape as
`generateUniqueReferralCode()`, NOT a shared incrementing counter, which would need its
own lock and be a contention point on every registration). Assigned at the same moment
as the referral code, inside `completeRegistrationCore`. **Every account that
registered before this feature existed self-heals it lazily** the next time `GET
/account` reads their doc (mirrors the existing checkin-streak self-heal pattern) —
there was no bulk migration and none is needed; don't write one if asked to "backfill"
existing users, `/account` already does it transparently and idempotently (same id
persists on every later read, doesn't reassign).

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

## Secrets — NEVER commit

`FIREBASE_SERVICE_ACCOUNT`, `MONGODB_URI`, `ADMIN_KEY`, `MARZPAY_KEY` live only in Render
env vars. Never commit secrets or model identifiers. (Note: this session's chat log does
contain some of these in plaintext, at the owner's own insistence after being warned —
that's a chat-log exposure, not a repo one; nothing above is committed to git.)
