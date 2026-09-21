# Petro — Project Memory (read this first)

**What it is (so far):** Petro is meant to be a mobile-money investment platform —
same category as this repo's other apps: deposits/withdrawals via mobile money,
tiered investment products, referral commissions — themed around **petroleum /
oil & gas**. That theme was chosen by the owner in the session that created this
fork; **no palette, fonts, icons, product names, or copy have been decided yet.**
Nothing in this file above the "Status" section should be read as design already
signed off — it is the mechanical fork, not the product.

## Fixed decisions (owner-stated, do not re-ask, do not re-derive)

- **Design/layout will be genuinely distinct from Chipz** — new colors,
  typography, screen arrangement, visual identity. NOT a reskin, and
  explicitly **not assumed to be Chipz's Doritos red/orange either**. The
  owner will supply the actual direction (palette, fonts, mockups/references,
  product names and pricing) when that stage starts. Until then: do not
  invent any of it unprompted. This sharpens (doesn't contradict) the
  "Everything inherited from Chipz, unchanged" section below.
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

## Hosting: Hostinger VPS (KVM1)

**Not Railway, not Render** — unlike Chipz (see `chipz/docs/railway-deploy.md`,
which does not apply here), Petro deploys to a Hostinger KVM1 VPS: a real
server under direct SSH control, not a PaaS. That changes the shape of the
deploy pipeline itself, not just where the bytes end up:

- **Process manager: pm2**, not systemd. Chosen because this pipeline deploys
  by SSH + rsync rather than a package manager, and pm2's `reload` gives a
  zero-downtime restart plus built-in log handling without hand-writing a
  unit file. A systemd unit is a reasonable alternative if the owner prefers
  it later; nothing else here depends on pm2 specifically.
- **Reverse proxy/TLS: nginx + certbot.** nginx also serves `user/` and
  `admin/` as static files directly — on Railway those were their own
  services running `static-server.js` (a zero-dependency Node static host,
  because Railway has no static-site type); on a VPS nginx does that job
  natively, so `static-server.js` is **not used in the VPS pipeline** but is
  left in the repo (dead-but-harmless, same status `render.yaml` had before
  removal below).
- **Three subdomains**, mirroring Chipz's three-service split rather than
  collapsing everything onto one origin: `api.<domain>` (backend, proxied to
  the pm2-managed `server.js` on `127.0.0.1:3000`), `app.<domain>` (member
  app, static), `admin.<domain>` (admin panel, static). Kept separate on
  purpose — `server.js`'s `CORS_ALLOWED_ORIGINS` and the meta-tag CSP in both
  `-src/index.html` files already assume the API is a different origin from
  the pages calling it; collapsing to one origin would silently change that
  security assumption while "just" wiring up a host.
- **Deploy is scripted, not git-triggered** — there is no autoDeploy on a
  bare VPS. `petro/deploy/deploy.sh` is the replacement: rsyncs
  `server.js`/`db.js`/`service-account.js`/package files plus the built
  `user/`/`admin/` bundles, runs `npm install --omit=dev` remotely, then
  `pm2 reload` (falling back to `pm2 start` on first deploy) and an
  `nginx -t && systemctl reload nginx`.

**What's built, in `petro/deploy/`:**
- `ecosystem.config.js` — the pm2 app definition. **`instances` must stay `1`**
  — see the comment inside it: the in-process locking that makes money
  crediting safe (per "Money-safety invariants" below) only works within a
  single Node process, and pm2 cluster mode would silently reopen the exact
  race those locks close.
- `nginx-petro.conf.template` — all three server blocks, security headers and
  CSP ported line-for-line from `static-server.js`/the old `render.yaml`
  (same threat model regardless of host), the `/refCode=` referral-link
  rewrite, and the `no-cache` revalidation rules for `index.html`/`sw.js`/
  `manifest.json`. Every `PETRO_DOMAIN` placeholder needs the real domain
  substituted in before use (`sed 's/PETRO_DOMAIN/.../g'`).
- `deploy.sh` — the repeatable half of a deploy. Reads `PETRO_VPS_HOST`
  (and optional `PETRO_VPS_PATH`, default `/srv/petro`) from the environment,
  never hardcodes them (this file is committed).

**What's still real, undone work** — the once-per-server setup `deploy.sh`
deliberately does *not* attempt, because it needs the owner's actual
credentials/decisions, not something to script blind:
1. Provision the VPS: create a deploy user, install Node ≥18, nginx, certbot,
   pm2 (`npm i -g pm2`).
2. Pick the real domain(s), point DNS at the VPS, drop
   `nginx-petro.conf.template` into `/etc/nginx/sites-available/` with the
   domain substituted, then `certbot --nginx -d api.<domain> -d app.<domain>
   -d admin.<domain>`.
3. Write the backend's env (`.env` next to `server.js`, or exported in the
   shell pm2 starts from — never committed): `MONGODB_URI`,
   `FIREBASE_SERVICE_ACCOUNT`, `ADMIN_KEY`, and payment-gateway keys once
   those are decided.
4. `node set-backend-url.js https://api.<domain>` then rebuild both bundles,
   so the frontends actually call the new API origin (see "Build & deploy
   pipeline" above — this step didn't change, it's host-independent).
5. First deploy: run `petro/deploy/deploy.sh`, then `pm2 startup` +
   `pm2 save` on the VPS so the backend survives a reboot.

None of steps 1–3 can happen without the owner's actual VPS access, domain,
and payment/DB decisions — they are not simulated or invented here.

Also still needed regardless of host (unchanged from before this pipeline
was built):
1. A **new MongoDB Atlas database** (own cluster, or a new database on
   Chipz's shared cluster under its own name ending in `/petro` per
   `db.js`'s requirement) — **undecided with the owner**, see "Fixed
   decisions" above.
2. A **new Firebase project** — the current web config in both
   `-src/index.html` files is a deliberately broken placeholder; nothing can
   sign in until this is real and verified in the rebuilt bundles.
3. A new `ADMIN_KEY`, and payment-provider credentials once a gateway is
   chosen — not inherited from Chipz just because the code (MarzPay/LipaPay/
   PesaJet) is already wired.

**Removed from this fork** (were Railway/Render artifacts, actively
misleading once hosting moved to a VPS): `railway.json`, `railway.app.json`,
`railway.admin.json`, `render.yaml`. Their content (env var list, CSP/header
set) isn't lost — it's carried into `nginx-petro.conf.template` and this
section.

**Also fixed while building this** (a real bug, not a design choice — see
"Fixed decisions" above on the bar for touching inherited logic):
`CORS_ALLOWED_ORIGINS` in `server.js` still hardcoded
`https://chipz-platform.com`/`https://www.chipz-platform.com`, even though
`_baseDomain`'s default was already renamed to `petro-platform.com` in the
mechanical fork — a miss, the same category as the other load-bearing renames
that commit made. Left as `chipz-platform.com` it would have silently
rejected Petro's own real frontend origin once deployed (CORS failures are
invisible server-side and look identical to a dead backend — the exact
failure mode `server.js`'s own comments above that line warn about twice
already, for Snow's custom domain and `.edgeone.dev`). Now reads
`petro-platform.com`/`www.petro-platform.com`; update again if the real
domain ends up different. `CORS_ALLOWED_SUFFIXES` (EdgeOne/Railway/Render
suffixes) was left alone — unused on a VPS but harmless, not broken.

## Status

**Fork complete, mechanically.** Boots as "Petro" in name (title, manifest,
brand-name default) and cannot accidentally authenticate against or write into
Chipz's live Firebase/Mongo (verified, not assumed). The CORS origin miss
(`chipz-platform.com` left in `CORS_ALLOWED_ORIGINS`) is fixed.

**VPS deploy pipeline built, not yet stood up.** `petro/deploy/` has the pm2
config, the nginx template (all headers/CSP/rewrites ported from the old
Railway/Render setup), and the rsync+ssh deploy script — see "Hosting:
Hostinger VPS (KVM1)" above. Nothing has actually been deployed: there is no
VPS provisioned, no domain pointed at one, no TLS cert, no Firebase project,
no Mongo database/cluster decision, and no payment-gateway credentials. Both
bundles rebuild clean (`node build-core.js`/`node build-admin.js`, round-trip
OK) as of this session.

Everything else — design, product catalog, which countries/languages/gateways
actually apply, the test suite's own correctness — is real, undone work for
the next session, laid out below in the order it probably needs doing:

1. ~~Confirm/adjust the fork's mechanical renames~~ — done this session (the
   CORS miss above); nothing else here needs redoing.
2. Decide the actual oil/gas visual identity — palette, typography, iconography
   — with the owner, the same deliberate way Chipz's own `CLAUDE.md` records
   getting its own red/orange identity right (see "Design language / decisions
   already made" in `chipz/CLAUDE.md` for the *process*, not the *values* —
   the values are Chipz's). **Waiting on the owner's direction, per "Fixed
   decisions" above — do not invent this unprompted.**
3. Decide the product catalog: real names, prices, cycle lengths.
4. Decide which countries/currencies/languages/payment gateways actually apply
   to Petro — do not assume Uganda/UGX/MarzPay just because the code defaults
   to it.
5. Work through the inherited test suite file by file, per the warning above.
6. Provision the actual VPS, domain, Firebase project and Mongo
   database/cluster (see the numbered checklist under "Hosting: Hostinger VPS
   (KVM1)"), then run `petro/deploy/deploy.sh` for the first real deploy.
