# Petro — Project Memory (read this first)

**What it is (so far):** Petro is meant to be a mobile-money investment platform —
same category as this repo's other apps: deposits/withdrawals via mobile money,
tiered investment products, referral commissions — themed around **petroleum /
oil & gas**. That theme was chosen by the owner in the session that created this
fork; **no palette, fonts, icons, product names, or copy have been decided yet.**
Nothing in this file above the "Status" section should be read as design already
signed off — it is the mechanical fork, not the product.

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
  MarzPay/LipaPay/PesaJet gateway integrations (all of which are wired to
  **Uganda-area currencies and, per the most recent Chipz round, MarzPay's
  twelve real markets** — irrelevant unless Petro also launches in one of
  those markets), the turntable/spin mechanic, referral commissions, the
  whole admin panel. All real, all functional, all still speaking Chipz's
  product in its comments and defaults.
- **`sms-forwarder-app/`** package/tag/URL are fixed (see above) but its
  **UI copy, icon, and any Chipz-specific settings-screen text** are not
  audited yet.

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

## Deploy target: none yet

There is no live Petro deploy anywhere. Whichever host is chosen (the same
Railway-based setup Chipz just moved to is the obvious default —
`chipz/docs/railway-deploy.md` is the step-by-step, and every gotcha it
records — root directory, branch, config-as-code being retired, the
`FIREBASE_SERVICE_ACCOUNT` diagnosis, all of it — applies identically) will
need, before anything can work:
1. A **new MongoDB Atlas database** (or a new database on the existing shared
   cluster, ending in `/petro` per `db.js`'s own requirement).
2. A **new Firebase project** — the current web config in both `-src/index.html`
   files is a deliberately broken placeholder; nothing can sign in until this
   is real.
3. A new `ADMIN_KEY`, and payment-provider credentials if/when Petro takes
   real payments (MarzPay/LipaPay/PesaJet, or something else entirely — that's
   a real decision, not inherited from Chipz just because the code is there).
4. Real backend and frontend domains, then `set-backend-url.js` run against
   them.

## Status

**Fork complete, mechanically.** Boots as "Petro" in name (title, manifest,
brand-name default) and cannot accidentally authenticate against or write into
Chipz's live Firebase/Mongo (verified, not assumed). Everything else — design,
product catalog, which countries/languages/gateways actually apply, the test
suite's own correctness — is real, undone work for the next session, laid out
above in the order it probably needs doing:

1. Confirm/adjust the fork's mechanical renames (nothing here needs redoing,
   but skim it once).
2. Decide the actual oil/gas visual identity — palette, typography, iconography
   — with the owner, the same deliberate way Chipz's own `CLAUDE.md` records
   getting its own red/orange identity right (see "Design language / decisions
   already made" in `chipz/CLAUDE.md` for the *process*, not the *values* —
   the values are Chipz's).
3. Decide the product catalog: real names, prices, cycle lengths.
4. Decide which countries/currencies/languages/payment gateways actually apply
   to Petro — do not assume Uganda/UGX/MarzPay just because the code defaults
   to it.
5. Work through the inherited test suite file by file, per the warning above.
6. Stand up real infrastructure (Atlas, Firebase, host) and deploy.
