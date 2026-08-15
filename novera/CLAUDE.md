# Space8 (working in `novera/` for now) — Project Memory (read this first)

**Read this whole file before doing anything.** This session ran long and went through
several wrong turns before landing on the real plan. This file exists so the next session
doesn't repeat those mistakes. The owner's own words, when quoted below, are the actual
source of truth — don't re-interpret them differently than how they're recorded here.

## What this project actually is

A Uganda mobile-money **investment platform** (VIP-tier plans, 3-level referral
commissions, MarzPay deposits/withdrawals) currently being built under the working name
**Novera**, but the owner said in this session: **"it is going to be 'space8'"** — the
project is renaming. As of this file being written, the code, folder name (`novera/`),
and all internal strings still say "Novera" — **the rename to "space8" has NOT been done
yet**. Do not assume it's done. Ask the owner at the start of the next session whether:
(a) "space8" fully replaces "Novera" everywhere (folder name, brand strings, tier-key
prefixes, storage keys, etc.), or (b) "Novera" stays as an internal/product name and
"space8" is something else (a company name, a different sub-brand). Do not guess — this
determines a lot of find-and-replace work and guessing wrong wastes a full round-trip
again, which already happened twice this session (see "Mistakes already made" below).

## The three-part split — this is the most important thing to get right

The owner was explicit and this must not be re-litigated without them saying so:

1. **Backend (`server.js`, `db.js`, all `test-*.js`, `build-core.js`, `build-admin.js`,
   `guard-src.js`, `render.yaml`, `package.json`) — KEEP AS-IS.** This is ChocoMCC's
   proven, tested business logic (referral commissions, MarzPay integration, money-safety
   locking on an ACID-less MongoDB M0 tier, the 60-file test suite). The owner confirmed
   directly: keep this as the foundation, don't rebuild it. Reused wholesale from
   `choco-mcc/` in this same repo, with only brand-string renames (see below) — not a
   rewrite.
2. **Admin panel (`admin-src/`, `admin/`) — KEEP AS-IS, this was the CORRECT approach.**
   The owner's original instruction — *"l told you everything admin we just replace, see
   ChocoMCC admin, we just replace just name and logo, everything remains every feature,
   every code"* — was scoped to the admin panel specifically, and a straight ChocoMCC
   admin reskin (name/logo/colour swap only, zero feature changes) is exactly right here.
   Do not redesign the admin panel from scratch. It's a fully-featured internal tool;
   ChocoMCC's admin already does everything needed.
3. **User-facing app (`user-src/`, `user/`) — CURRENTLY WRONG, NEEDS A FRESH BUILD.**
   Early in this session these were built by literally porting ChocoMCC's user-facing
   `index.html`/`original_module.js` and reskinning the colours in place. The owner
   rejected this hard: *"we are building novera, you are just respraying choco... l dont
   want to rebrand ChocoMCC, make novera on its own, different design, architecture."*
   **The current `user-src/`/`user/` folders are ChocoMCC's actual frontend with recolored
   CSS variables — they are not what should ship.** The next session needs to build the
   real user-facing frontend from scratch: its own visual design (see design system below,
   already agreed) and its own front-end architecture/structure — while still calling the
   *same* backend endpoints in `server.js` (that part doesn't change). Do NOT reuse
   `user-src/original_module.js`'s structure as a starting point beyond looking at it to
   know which API endpoints/fields exist.

## Mistakes already made this session (so they aren't repeated)

1. Built a small from-scratch Novera scaffold (own server.js/db.js/index.html/admin.html,
   ~5000 lines) with a fraction of ChocoMCC's real feature set. **Wrong** — the owner
   wanted ChocoMCC's proven backend and admin reused, not reinvented. Deleted.
2. Then went too far the other way: ported ChocoMCC's user-facing frontend wholesale and
   just recoloured it (violet/void "Void/Signal" palette, starfield canvas). **Wrong** —
   admin-panel reuse was correct, user-app reuse was not; the owner wants the user app to
   have its own design and architecture, not ChocoMCC wearing new CSS variables.
3. First design direction (violet `#6C4EFF` + black + starfield canvas) was rejected as
   "not modern," "just functional." Second, corrected direction — an actual reviewed
   mockup — used a strict **white + one dominant blue** palette per the owner's explicit
   spec: *"l only need 2 clouds [colors] white plus dominant color which will take part in
   showing up buttons, svgs, cards, etc no more colors, and make it blue."* This mockup
   (see below) had NOT yet received owner feedback when the session pivoted to the
   "space8" rename conversation — **get their reaction to it before assuming it's final.**

## Design system agreed so far (not yet approved against "space8" branding)

Static mockup, already published, still live: **`novera/design/visual-system-mockup.html`**
in this repo (also on claude.ai as an Artifact, but the repo copy is the durable one).
Open it in a browser to see the actual screens before designing anything new — don't
redesign from memory.

- **Palette — exactly white/ink + one dominant blue, nothing else.** `--blue: #2e6bff`.
  A single desaturated red (`--danger`) is kept ONLY for genuine failure states (a
  declined withdrawal must read as different from a completed one) — this was flagged to
  the owner as a deliberate exception, not yet explicitly re-confirmed after the "space8"
  pivot. Everything else (active/pending/done) is encoded by icon + text weight, not by
  colour. No violet, no gold, no green, no gradients.
- **Typography**: Instrument Sans (UI text, headings) + Space Mono (every money figure,
  tabular-nums) — both deliberately chosen to avoid the cliché Inter/Space-Grotesk default
  look. Font files were fetched from Google Fonts and embedded as base64 `@font-face` data
  URIs (the artifact CSP blocks external font requests — same constraint will apply to a
  real deployed app if it's ever published as a Claude Artifact, though the real app will
  just self-host these files instead).
  - Google Fonts CSS API (`fonts.googleapis.com`) and file host (`fonts.gstatic.com`) ARE
    reachable through this environment's egress proxy — most other external domains are
    NOT (`WebFetch` to random blogs/galleries failed with `EGRESS_BLOCKED`). Use `curl`
    directly for Google Fonts, not `WebFetch`.
- **Visual identity comes from precision, not decoration**: a progress ring for an active
  plan's cycle, tabular monospaced money, a single thin blue rail marking the one active
  item in a list. No starfield, no cosmic-gradient decoration — that was the earlier,
  rejected direction.
- **Both light and dark mode are designed as first-class**, not one inverted from the
  other — the mockup's CSS custom-property structure (`:root` for light,
  `@media (prefers-color-scheme: dark)` + `[data-theme="dark"]` override) is the pattern
  to keep using.
- Reference points explicitly researched for this (not guessed from memory alone):
  Robinhood (high-contrast, chart-forward), Cash App (bold single-accent blocks), Revolut/
  Binance (dense data made scannable), Stripe (restrained, indigo-on-neutral discipline).

## Nav / IA the owner described (confirm exact tab set next session)

Owner's words: *"where is home, products, show (this is where people upload there
withdrawals screens shots and they are granted reward), team, Account."* Mapped against
ChocoMCC's actual tab bar (`home / shop / rewards / team / account("Me")`):
- **Home** — same concept, wallet + plan list.
- **Products** ≈ ChocoMCC's **Shop** tab (buy a tier/plan). Same feature, different label.
- **Show** — **this does NOT exist in ChocoMCC.** The owner described a specific feature:
  users upload a screenshot of their withdrawal/payment and are granted a reward for it —
  a proof-of-payment social feature. ChocoMCC's closest tab, **Rewards**, is actually
  check-in bonus / cashback / task-center — a different feature entirely. **"Show" needs
  to be scoped and built as genuinely new functionality** (upload flow, storage, an admin
  review/approval queue, a reward-grant mechanism) — it is not a rename of something that
  already exists. Do not build the frontend tab and assume the backend support is already
  there; it isn't.
- **Team** — same as ChocoMCC's Team tab (referral levels/commissions).
- **Account** — same as ChocoMCC's Account/"Me" tab.

## Tier ladder (already renamed from ChocoMCC's chocolate brands, prices/cycles untouched)

`hersheys→comet, mars→asteroid, snickers→pulsar, cadbury→nebula, kitkat→quasar,
toblerone→neutron_star, rondnoir→supernova, rocher→blackhole, raffaello→magnetar,
godiva→singularity`. Verified against `test-all-tiers-pricing.js` (70/70 passing) —
pricing/cashback/maturity math is untouched by the rename, only `key`/`name` fields
changed. If the project renames to "space8," reconsider whether this ladder's naming
convention should change too (nothing said either way yet — don't assume "8" implies
exactly 8 tiers, that hasn't been confirmed).

## Repo / branch / multi-AI coordination

- Repo: `loganmore282-debug/x-engine-developments` (GitHub) — a multi-project repo; this
  project's code lives under `novera/`, sibling to `voltra/`, `choco-mcc/`, `nexus/`, and
  others. **Never edit `choco-mcc/` or `voltra/` from this project's sessions.**
- Branch: `claude/new-session-9z5u7r`.
- The owner wants **Codex working alongside Claude** on this project. `novera/CODEX.md`
  points Codex sessions at this file. `novera/AGENT_LOG.md` is the shared changelog —
  **append an entry to it after every fix**, however small, so the next AI session (Claude
  or Codex) can see what happened without re-deriving it. Read `AGENT_LOG.md` in full
  before starting new work.

## Where the code lives (backend/admin — unchanged from ChocoMCC's structure)

- `user-src/index.html` + `user-src/original_module.js` — **currently ChocoMCC's
  recoloured frontend; this needs replacing per the design system above.**
- `user/` — built artifact of the above (`build-core.js` output). Will need rebuilding
  once `user-src/` is actually rewritten.
- `admin-src/index.html` — readable admin source, correct as a ChocoMCC reskin, edit here
  for any further admin changes.
- `admin/` — built admin artifact (`build-admin.js` output). Never hand-edit.
- `server.js` — Express backend (Firebase Auth + MongoDB via `db.js` + MarzPay). Keep as
  the foundation; only add new endpoints for genuinely new features like "Show."
- `db.js` — Mongo↔Firestore compat layer. **M0 free tier = no ACID transactions** —
  money-crediting paths use in-process Sets as single-writer locks. Do not remove these.
- `test-*.js` (60 files, all passing as of this session) — run before/after any backend
  change: `for f in test-*.js; do node "$f"; done` (no `npm test` wired up yet).
- `build-core.js` / `build-admin.js` / `guard-src.js` — obfuscation/build pipeline, prints
  "round-trip OK" when valid. Always rebuild after editing `*-src/`.
- `render.yaml` — Render deploy config (`rootDir: novera`, `rootDir: novera/user`).
- `design/visual-system-mockup.html` — the approved-direction (not yet owner-confirmed
  final) design mockup described above.

## Rebrand mapping already applied (ChocoMCC → Novera strings/colours)

`ChocoMCC`→`Novera`, `CHOCO_*`→`NOVA_*`, `choco_*` storage keys→`novera_*`. Colour
`:root` custom-property **values** were remapped from ChocoMCC's light cream/cocoa/caramel
palette to a dark void/violet palette in `admin-src/`/`user-src/` — note the user-facing
half of this is moot once `user-src/` gets rebuilt per the new design system, but
**`admin-src/`'s recolour should stay** (or be redone in the agreed blue+white system if
the owner wants the admin panel to visually match — not yet asked). External brand colours
(Telegram/WhatsApp/MTN/Airtel) were deliberately left untouched throughout — don't touch
those regardless of what else changes.

ChocoMCC's static About-page fallback (~950KB of embedded chocolate-heritage photos/copy)
was trimmed to a short placeholder — this only ever shows before the admin-set About text
loads, so it's cosmetic, but the real About copy should be set via the admin panel same as
on ChocoMCC.

## Known gaps / deferred — do not claim any of these are done

- **User-facing frontend rebuild** — the big one, see above. Not started.
- **"Show" feature** — does not exist anywhere yet, backend or frontend. Needs scoping.
- App icons (`icon-192.png`, `icon-512.png`, favicon, maskable variants,
  `link-preview.jpg`) are still ChocoMCC's chocolate-brand art.
- Embedded product/banner fallback photos (`NOVA_IMAGES`/`NOVA_BANNERS`) are still literal
  chocolate product photos — low priority since the admin panel's own upload feature
  overrides these in practice, but should eventually be swapped or removed.
- Whether "space8" replaces "Novera" everywhere — unconfirmed, ask first.
- Whether the mockup's exact screens/flows are approved — the owner hadn't reacted to it
  yet when the session ended.

## Product config (inherited from ChocoMCC — verify before assuming stale)

Referral commissions, withdrawal fee %, min withdrawal/deposit, check-in bonus: same
values/mechanism as ChocoMCC, admin-configurable via Settings. Check `server.js` constants
and the admin defaults rather than assuming numbers from memory.

## Secrets — NEVER commit

`FIREBASE_SERVICE_ACCOUNT`, `MONGODB_URI`, `ADMIN_KEY`, `MARZPAY_KEY`, `FIREBASE_API_KEY`
live only in Render env vars. Never commit secrets or model identifiers.
