# Novera — Project Memory (read this first)

**What it is:** Novera is a Uganda mobile-money **investment platform**, themed around
space/cosmic exploration (comets, nebulae, supernovae). It is a **full port of ChocoMCC**
(`choco-mcc/` elsewhere in this repo) — same backend, same admin panel, same referral
system, same test suite, same money-safety guarantees. **Do not treat this as a fresh
build.** Every feature ChocoMCC has, Novera has. The only intentional differences are
brand identity: name, colour theme, and tier/product naming (space objects instead of
chocolate brands). If a fix is needed that touches business logic, check whether ChocoMCC
already solved it — the two codebases should stay in sync on anything that isn't
presentation.

**Source of truth:** `choco-mcc/` in this repo. **Never edit `choco-mcc/` from a Novera
session** — it's a separate, live product with its own owner workflow. Port fixes in the
same direction they were ported here (ChocoMCC → Novera), never the reverse, unless
explicitly asked to upstream something.

**Coordination with other AI sessions (Claude, Codex, etc.):** After every fix — however
small — append an entry to `novera/AGENT_LOG.md` (format described there). This is how a
different AI picking up the next task knows what changed and why, without re-deriving it.
Read `AGENT_LOG.md` in full before starting new work in this folder.

## Where the app lives
Same split as ChocoMCC:
- `user-src/index.html` + `user-src/original_module.js` — readable app source (edit these).
- `user/` — **built** deploy artifact (`build-core.js` output — obfuscated). Never hand-edit.
- `admin-src/index.html` — readable admin panel source (edit this).
- `admin/` — **built** admin deploy artifact (`build-admin.js` output). Never hand-edit.
- `server.js` — Express backend (Firebase Auth + MongoDB via `db.js` + MarzPay).
- `db.js` — Mongo↔Firestore compat layer. **M0 free tier = no ACID transactions** —
  money-crediting paths use in-process Sets as single-writer locks (same pattern as
  ChocoMCC/Voltra). Do not remove these guards.
- `test-*.js` (60 files) — the full ChocoMCC test suite, ported as-is except where a
  test asserted on brand-specific error-message text (see "Rebrand gotchas" below).
- `build-core.js`, `build-admin.js`, `guard-src.js` — same obfuscation/build pipeline as
  ChocoMCC. Prints "round-trip OK" when a build is valid. **Always rebuild after editing
  `*-src/`.**
- `render.yaml` — Render deploy config (`rootDir: novera`, `rootDir: novera/user`).

## Build & verify
```
cd novera && npm install
node build-core.js     # rebuilds user/index.html from user-src/
node build-admin.js    # rebuilds admin/index.html from admin-src/
for f in test-*.js; do node "$f"; done   # run the test suite (no test runner wired yet)
```

## Rebrand: what changed vs. ChocoMCC, and why
Ported wholesale on 2026-08-15, then reskinned in place (no feature/logic removed):

1. **Brand strings**: `ChocoMCC`→`Novera`, `CHOCO_*` identifiers→`NOVA_*`,
   `choco_*` localStorage/sessionStorage keys→`novera_*`.
2. **Colour theme**: ChocoMCC is a **light** cream/cocoa/caramel palette (dessert-shop
   aesthetic). Novera is **dark** — Void/Signal (see below). This was done by remapping
   the `:root` CSS custom-property **values** only (var names unchanged), plus the
   handful of hardcoded hex/rgba duplicates of those same colours. External brand colours
   (Telegram blue, WhatsApp green, MTN yellow, Airtel red) were deliberately left alone.
   - `--cream`/`--bg` (page bg) → `#050507` (void)
   - `--card`/pure white → `#12121c` (void-3)
   - `--cocoa`/`--ink` (primary text) → `#f4f2ff` (ink)
   - `--caramel`/`--gold` (primary accent/CTA) → `#6C4EFF` (signal, violet)
   - `--berry`/`--danger` → `#ff5c72`, `--mint`/`--ok` → `#3ddc97` (kept semantic roles)
3. **Tier/product ladder**: chocolate-brand names → space objects, **prices/cycles/
   returns unchanged**, only `key` and `name` fields renamed:
   `hersheys→comet, mars→asteroid, snickers→pulsar, cadbury→nebula, kitkat→quasar,
   toblerone→neutron_star, rondnoir→supernova, rocher→blackhole, raffaello→magnetar,
   godiva→singularity`. Verified against `test-all-tiers-pricing.js` (70/70 passing
   post-rename — pricing/cashback/maturity math untouched).
4. **About page**: ChocoMCC's static About-page fallback was a ~950KB block of embedded
   chocolate-factory heritage photos + copy (Hershey's/Mars/Cadbury/Ferrero brand story).
   This only ever renders before `syncPublicConfig()` loads the real admin-set About text
   (same pattern as the product-list fallback), so it's low-stakes functionally, but it
   shipped 950KB of off-brand dead weight and briefly flashed candy-brand copy on cold
   load. Replaced with a short space-themed placeholder. **The owner should set the real
   About text via the admin panel** (Settings → About), same as they would on ChocoMCC.
5. **Rebrand gotchas for future fixes**: a few tests asserted on the literal word
   "chocolate" in server error-message text via regex (`/chocolate product/i` etc.) rather
   than checking status codes alone. Fixed in `test-settings-wired.js` and
   `test-withdrawal-security.js` to match the new "plan" wording. If a test looks like it
   broke after a copy change, check for this pattern before assuming logic broke.

## Known gaps / deferred (do not claim these are done)
- **Embedded product/banner photos** (`NOVA_IMAGES`, `NOVA_BANNERS`) are still literal
  chocolate product photos (candy bars, factory shots) carried over from ChocoMCC. They
  are legacy fallback art — the *real* product images come from the admin panel's
  banner/product upload feature, same as ChocoMCC — but the fallback art itself hasn't
  been replaced with space imagery yet. Low priority (admin overrides it in practice) but
  should eventually be swapped or removed.
- **App icons** (`icon-192.png`, `icon-512.png`, favicon, maskable variants,
  `link-preview.jpg`) are still ChocoMCC's chocolate-brand icon art. Needs a real Novera
  mark before this ships.
- **"Show" tab**: the owner described wanting a tab where "people upload their withdrawal
  screenshots and are granted a reward" (a social proof-of-payment feature). ChocoMCC has
  no such feature — the closest existing tab is **Rewards** (check-in / cashback /
  task-center), which is NOT the same thing. This needs to be scoped as new work, not
  assumed to already exist.
- Full 60-file test suite: verify current pass/fail state (`AGENT_LOG.md` has the latest
  run's results) before assuming everything is green.

## Product config (inherited from ChocoMCC — verify before assuming stale)
- Referral commissions, withdrawal fee %, min withdrawal/deposit, check-in bonus: same
  values/mechanism as ChocoMCC, admin-configurable via Settings. Check `server.js`
  `COMM_L1/2/3`-equivalent constants and the admin defaults rather than assuming numbers
  from memory — ChocoMCC's owner tunes these periodically.

## Secrets — NEVER commit
Same as ChocoMCC/Voltra: `FIREBASE_SERVICE_ACCOUNT`, `MONGODB_URI`, `ADMIN_KEY`,
`MARZPAY_KEY`, `FIREBASE_API_KEY` live only in Render env vars. Never commit secrets or
model identifiers.
