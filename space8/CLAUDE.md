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

- **Palette — white/ink + one dominant blue, nothing else.** `--blue: #2e6bff`. A single
  desaturated red (`--danger`) is the only exception, reserved for genuine failure states.
  No violet, no gold, no green, no gradients (except the auth-screen hero, which uses a
  dark ink→blue gradient specifically so the white wordmark stays legible before an admin
  sets a real login photo — this was a real bug caught and fixed via screenshot review,
  don't revert it to a flat fallback).
- **Typography**: Instrument Sans (UI) + Space Mono (every money figure, tabular-nums),
  embedded as base64 `@font-face` (self-hosted, not a Google Fonts CDN dependency at
  runtime).
- **Light theme is primary** (owner's explicit instruction), dark mode supported via
  `prefers-color-scheme` + `[data-theme="dark"]` override, same token structure as the
  mockup.
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
  scrolling to the full catalog.
- **Products** — shortcuts row, admin banner (`darkbar`), My Products + cumulative
  earnings summary, full product cards (name/price/cycle/daily income/total return/
  Invest), invest confirmation sheet.
- **Team** — admin banner (`giftbox`), Level 1/2/3 tabs at 28%/2%/1% (off
  `/team/members?level=`), Task Center milestones (off `/team/stats` +
  `/team/milestone/claim` — already existed server-side).
- **Account** — admin banner (`rocherstack`), profile + referral share, 4-tile matrix
  (payout account / deposits / withdrawals / security PIN), About/Rules/Terms/Privacy/
  Support sheets sourced from `/public/settings`, logout.
- **"Show"** — still does not exist anywhere, frontend or backend. The owner's original
  description: users upload a screenshot of their withdrawal/payment and are granted a
  reward — a proof-of-payment social feature, genuinely new (upload flow, storage, admin
  review/approval queue, reward-grant mechanism). Needs full scoping if/when confirmed
  still wanted.
- **Floating assistant** — exists in the UI (bottom-right bubble, full-screen chat panel)
  but is currently **client-side canned Q&A only** (regex-matched answers about deposits/
  withdrawals/referrals/investing/check-in/support). The owner asked for something
  server-side ("I think they may be serversided, put some technology") — not built yet.
  Needs a real backend endpoint and a choice of LLM/response tech.

## Product ladder — real, owner-provided (NOT the old chocolate-derived placeholder)

The owner sent a PDF with the actual 15-plan catalog (Sputnik 1 → James Webb Space
Telescope, x42 return over 210 days, daily cashback = 20% of price/day = `expectedReturn /
cycle`). **The owner will enter these into the admin panel themselves** — do not hardcode
them into `server.js`. `DEFAULT_PRODUCTS` in `server.js` still has the old 10-tier
chocolate-derived space-object ladder as a fallback; harmless since admin-entered products
override it via `getProducts()`, but don't mistake it for the real catalog when reading
the code.

Platform variables from that same PDF (verify against live Settings before assuming
these are wired, they may still need setting via the admin panel):
min deposit 20,000 · min withdrawal 5,000 · withdrawal fee 15% · registration bonus 5,000 ·
referral L1 28% / L2 2% / L3 1% (31% total).

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
   withdraw, referral, check-in — none of this has been verified against the live
   Firebase project + live backend in a real browser yet.
2. **"Show" feature** — not scoped, not built, anywhere.
3. **Server-side floating assistant** — current one is a client-side placeholder.
4. **Real product catalog** — not entered into the admin panel yet (owner's task).
5. **VAPID key** — updated in code, not test-fired against a real device yet.
6. **ChatGPT security-review findings not yet acted on** — referral-commission
   double-pay-on-crash race and a withdrawal-bookkeeping `Promise.all` race, both
   confirmed real. See `AGENT_LOG.md`'s "Fixed a real deposit-polling bug..." entry for
   exact locations and severity — needs the owner's go-ahead before touching this
   money-handling code.

## Secrets — NEVER commit

`FIREBASE_SERVICE_ACCOUNT`, `MONGODB_URI`, `ADMIN_KEY`, `MARZPAY_KEY` live only in Render
env vars. Never commit secrets or model identifiers. (Note: this session's chat log does
contain some of these in plaintext, at the owner's own insistence after being warned —
that's a chat-log exposure, not a repo one; nothing above is committed to git.)
