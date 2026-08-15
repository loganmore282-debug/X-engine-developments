# Space8 — Agent Log

Shared changelog for AI sessions (Claude, Codex, others) working on `space8/`. Append one
entry per fix/change, newest at the top. Read this in full before starting new work.

**Entry format:**
```
## YYYY-MM-DD — <agent> — <one-line summary>
- What changed (files/areas touched)
- Why (the actual reason, not just "user asked")
- Verification (tests run, build checked, manual check — be specific)
- Anything left open / deferred
```

---

## 2026-08-15 — Claude — Replaced ChocoMCC chocolate-brand icons with the real Space8 mark

- **What changed**: `icon-192.png`/`icon-512.png`/`icon-maskable-192.png`/
  `icon-maskable-512.png`/`favicon.png` in both `user/` and `admin/`, plus
  `user/link-preview.jpg` and the loading-screen `<svg class="mark">` in
  `user-src/index.html`. New mark, "Orbital 8": two stacked blue (`#2e6bff`) rings
  forming a vertical figure-eight, with a small satellite node on the top ring's
  upper-right arc — reads as both an orbital-path motif and a literal "8". Flat,
  single-color, no gradients, matches the white+blue design system exactly.
  Maskable variants keep the mark inside a conservative safe zone; favicon uses a
  bolder stroke for legibility at browser-tab size.
- **Why**: the last visible piece of ChocoMCC's old chocolate branding still shipping
  (flagged as open in every previous entry). The concept originated from a ChatGPT
  design review the owner requested this session ("Orbital 8" — white field, blue
  vertical figure-eight orbital path, satellite node, flat/no gradients, maskable-safe,
  simplified favicon). Getting ChatGPT's own GitHub connector real write access to push
  it directly turned into a long, repeatedly-403'ing side-quest (its connector is an
  OAuth-style "Authorized GitHub App," not a fine-grained installed one, so scopes can't
  be hand-edited from GitHub's settings UI the way Claude/Render/Railway's can — it needs
  the requesting app itself to ask for the broader scope on reconnect). At the owner's
  request ("last resort"), built and shipped it directly instead: rendered the mark as
  SVG, screenshotted at each required size via a headless Chromium instance (Playwright
  + this environment's pre-installed browser), no external design tool needed.
- **Verification**: `node build-core.js` round-trip OK. Loading-screen mark smoke-tested
  in a real headless browser — zero console/page errors, screenshot confirmed the icon
  renders correctly. Visual review of `icon-512.png`, `icon-maskable-512.png`, and
  `favicon.png` at actual size before shipping — all read clearly as an "8" including at
  favicon size. File sizes dropped substantially too (old chocolate photos were
  27-275KB each; the new flat-color mark is 4-16KB).
- **Left open / deferred**:
  1. ChatGPT's own GitHub connector still doesn't have write access — if a future
     session wants it to push directly, look for a "Reconnect"/re-authenticate option in
     ChatGPT's own connector settings (not GitHub's side) to trigger a fresh OAuth
     consent screen requesting the broader scope. Not worth chasing further unless
     there's a specific reason to want ChatGPT pushing commits itself rather than
     proposing content for another session to commit.
  2. Everything else already listed as open in the previous two entries (real
     end-to-end device check, "Show" feature, server-side assistant, real product
     catalog, VAPID key live test, the two unfixed ChatGPT-flagged money-safety races)
     is still open — this entry only touched icon/mark assets.

## 2026-08-15 — Claude — Fixed a real deposit-polling bug (caught by ChatGPT security review) + removed USDT deposit and bank-transfer withdrawal

- **What changed**:
  1. **Deposit-status polling fix** (`user-src/original_module.js`) — `pollDepositStatus()`
     was calling `GET /deposit/marzpay/status?id=...` and reading `r.deposit.status`. The
     real endpoint is `POST /deposit/marzpay/status` with `depositId` in the body, returning
     `r.state` (`'matched'`/`'failed'`/`'pending'`). Every deposit would have polled forever
     without ever detecting success or failure — a genuine, user-facing bug in the frontend
     built last session. Rebuilt via `build-core.js` (round-trip OK).
  2. **USDT (TRC20) deposit — fully removed.** Self-contained feature (own endpoints, own
     on-chain verification subsystem, own reconciler sweep), safe to delete outright:
     `/deposit/usdt/submit`, `/deposit/usdt/status`, `/admin/deposit/usdt/reject` endpoints;
     `verifyUsdtTx`/`resolveUsdtDeposit`/`reconcileUsdtDeposits` functions; `TRONGRID_*`
     constants; `usdtEnabled`/`usdtWalletAddress`/`usdtRate` settings everywhere they
     appeared; the admin's "Crypto deposits (USDT TRC20)" settings panel and the USDT
     column/badge/Approve-Reject UI in the Deposits tab. Deleted
     `test-usdt-autoverify.js`/`test-usdt-deposit.js` (tested a feature that no longer
     exists).
  3. **Bank-transfer withdrawal — entry point locked, not surgically deleted.** Unlike
     USDT, this was woven through six shared functions that also handle mobile-money
     withdrawals (`processWithdrawalCore`, `/admin/withdraw/verify`,
     `/withdraw/marzpay/status`, the periodic reconciler, `/withdraw/request` itself).
     Deleting every `isBank` branch across all of those risked breaking real mobile-money
     withdrawals for a cosmetic gain. Instead: `/withdraw/request` now hard-locks `method`
     to `'mobile_money'` and never reads `req.body.method` — a bank-transfer withdrawal can
     no longer be created, period. Removed the now-unreachable `bankWithdrawEnabled`
     setting and its admin settings panel. **Deliberately left** the `isBank` branches
     inside the shared processing/reconciler functions in place as inert dead code — they
     can still correctly process any withdrawal record that already has `method:'bank'`
     (there are effectively none, this is a fresh database), and removing them was the
     genuinely risky part of this change for no real benefit. Removed
     `test-bank-withdrawal.js` and the bank-transfer PIN-gate scenario from
     `test-payout-pin.js` (redundant once bank withdrawal can't be created); left
     `test-withdrawal-stuck-auto-resolve.js`'s bank-method scenario intact since it seeds
     the DB directly, bypassing `/withdraw/request`, so it still validly exercises the
     reconciler code that's deliberately still there.
- **Why**: The owner brought in ChatGPT (now also reading `CLAUDE.md`/`AGENT_LOG.md` on
  this branch, see the coordination note added to `CLAUDE.md`) for a second-opinion
  security review, which surfaced the deposit-polling bug as a "High" finding — verified
  against the real `server.js` handler before fixing, confirmed genuine. ChatGPT also
  raised several other findings (a referral-commission double-pay race on crash, a
  withdrawal-bookkeeping `Promise.all` race, process-local locking, first-time-PIN
  auto-setup) — see "Left open" below, **none of those were acted on this entry**, only
  investigated. Separately, the owner explicitly asked for USDT deposit and bank-transfer
  withdrawal removed (an earlier session already asked for USD/bank-*deposit* removal from
  admin; this session clarified "bank" specifically meant the withdrawal rail, not the
  `/bank/save` payout-binding endpoint, which stays — that binds a MOBILE-MONEY payout
  account despite its name, required for every withdrawal).
- **Verification**: Full `test-*.js` suite: 51/51 passing (54 minus the 3
  removed/obsolete files). `node build-core.js`/`build-admin.js` both round-trip OK.
  ChatGPT's other findings were cross-checked against the existing test suite before
  deciding whether they were real gaps or already-covered — see "Left open" below for the
  verdict on each.
- **Left open / deferred — do not claim any of these are done**:
  1. **Referral-commission double-pay on crash** (confirmed real, `server.js` ~
     `creditReferralCommission`) — the wallet credit and the "level paid" flag write are
     two separate writes; a crash between them lets the reconciler pay that level again on
     retry. Not covered by any existing test. Not fixed this entry — owner hadn't given
     go-ahead on backend changes to this specific function when this entry was written.
  2. **Withdrawal-bookkeeping race** (confirmed real, `processWithdrawalCore`'s
     `Promise.all([witRef.update(...), users.doc(...).update({totalWithdrawn:...})])`) —
     lower-impact than it sounds (the MarzPay send already happened by this point, so a
     partial failure here is a reporting inconsistency, not a double-spend or lost money).
     Not fixed this entry.
  3. **Process-local locks** and **first-time payout-PIN auto-setup** — both real, but
     confirmed to be deliberate, already-documented, already-tested tradeoffs, not
     oversights (locks: safe as long as Render stays single-instance, confirmed via
     `render.yaml` — no autoscaling configured; PIN: inherent to any PIN scheme, and
     `test-payout-pin.js` explicitly tests "first bind succeeds" as intended behavior).
     Nothing to fix here unless the owner wants a stronger first-setup mitigation (e.g. an
     OTP step) — a product decision, not a bug.
  4. **`getMarzBanks()`/`marzValidateBankAccount()`/`GET /public/banks`** are now fully
     orphaned (zero callers anywhere) but were left in place rather than risk more edits
     right after a money-safety-critical change. Harmless, just unused — safe to remove in
     a future pass if someone wants the cleanup.
  5. Everything already listed as open in the previous entry (real end-to-end device
     check, "Show" feature, server-side assistant, real product catalog, app icons/
     favicon) is still open — this entry didn't touch any of those.

## 2026-08-15 — Claude — Rename to space8 (full replace) + real infra + frontend rebuilt from scratch

- **What changed**:
  1. **Rename, full replace confirmed by owner**: `novera/` → `space8/` (git mv, history
     preserved), every brand string/identifier renamed (`NOVA_*`→`SPACE8_*`, `Novera`→
     `Space8`, `novera`→`space8` — storage-key prefixes, synthetic email domain, Mongo
     dbName fallback, cache names, `package.json`, `render.yaml` service names/rootDir).
     Client-side Firebase config in both `admin-src/index.html` and `user-src/index.html`
     swapped to a real new Firebase project (`space8-9d97c`, owner created it fresh rather
     than reusing "novera" — see the AskUserQuestion answer in-session). Rebuilt both
     `user/` and `admin/` via `build-core.js`/`build-admin.js` (round-trip OK both times).
     Full `test-*.js` suite: 54/54 passing, untouched by the rename.
  2. **Real infra stood up this session** (owner did the actual clicking, I gave exact
     steps): MongoDB Atlas — dedicated `space8_db_user` user + `/space8` database on the
     same shared cluster as chocomcc/temubrazil, network access opened. Firebase — new
     `space8-9d97c` project, service-account JSON installed as `FIREBASE_SERVICE_ACCOUNT`,
     new Cloud Messaging VAPID key wired into `admin-src/index.html` (the old one belonged
     to "novera" and would have silently failed). Render — 3 services live: static site
     `space8-app` (`https://space8-app.onrender.com`, rootDir `space8/user`), static site
     for admin at a deliberately obscured URL (owner's choice, not `space8-admin`, to cut
     down on casual discovery of a money-moving login), web service backend at another
     deliberately obscured URL (`mycallbackurl.onrender.com` in code — same reasoning).
     `ADMIN_KEY`/`MARZPAY_KEY` set. The frontend's/admin's hardcoded `SERVER` constant
     (previously the old ChocoMCC/business placeholder URL) now points at the real deployed
     backend in both `user-src/original_module.js` and `admin-src/index.html`.
  3. **User-facing frontend rebuilt from scratch** (`user-src/index.html` +
     `user-src/original_module.js`, ~2700 lines replaced) — this is the item flagged as
     "not started" in every previous entry. Built against the approved mockup
     (`design/visual-system-mockup.html`: white/ink + one dominant blue `#2e6bff`,
     Instrument Sans + Space Mono, light theme primary) and the full spec the owner
     dictated across this session (voice-transcribed, several messages): 4-tab nav (Home/
     Products/Team/Account — "Show" deliberately excluded, see below), Home dashboard
     (account balance + cumulative earnings + total invested, admin-set banner image via
     the existing `barstack` slot, deposit/withdraw/check-in actions, a live activity
     ticker off the *already-existing* `/public/activity-feed` endpoint, active-plan cards
     with an SVG progress ring, a 10-of-15 products preview scrolling to the full catalog),
     Products page (shortcuts, `darkbar` banner, My Products + cumulative earnings, full
     product cards with price/cycle/daily income/total return/Invest — schema is
     `key/name/price/cycle/expectedReturn/image/active/comingSoon`, daily income is just
     `expectedReturn/cycle`, verified against the owner's 15-plan PDF), Team page (L1/L2/L3
     tabs at 28%/2%/1% off `/team/members?level=`, Task Center off `/team/stats` +
     `/team/milestone/claim` — this already existed server-side, just needed a frontend),
     Account page (4-tile matrix, referral share, About/Rules/Terms/Privacy/Support sheets
     off `/public/settings`, logout), deposit sheet (MarzPay mobile money **only** — USD/
     USDT deposit intentionally dropped per the owner's explicit "remove USD depositing"
     instruction, which the images/PDF and dictated spec never mentioned wanting back),
     withdraw sheet with a live fee preview and PIN-gated payout binding (`/bank/save` is
     actually "bind mobile-money payout account", not a real bank — misleading name, left
     as-is since it's backend, not touched), floating assistant (client-side canned Q&A
     over deposits/withdrawals/referrals/investing/check-in/support — **not** the
     server-side assistant the owner asked for, see "Open" below), skeleton loaders on
     every async section, bottom-sheet modals, toasts. Zero lines of ChocoMCC's original
     frontend structure reused — the owner rejected an earlier draft hard for looking like
     a respray, so this pass intentionally shares nothing with it beyond calling the same
     API endpoints. Dropped ~950KB of embedded ChocoMCC product-photo blobs
     (`SPACE8_IMAGES`/`SPACE8_BANNERS`) since images now come from each product's own
     `image` field and `/public/banners` — `user/index.html` shrank from ~2.17MB to
     ~434KB.
- **Why**: Every previous session's log ended with "user-facing frontend: not started" as
  the #1 open item. The owner walked through infra setup live this session (MongoDB/
  Firebase/Render, screenshots + step-by-step) specifically so the real app could be
  deployed and tested as it's built, and got visibly frustrated partway through when the
  still-live *old* ChocoMCC-reskin (kept up only to validate the infra chain end-to-end)
  read as "the redesign" — worth remembering for tone next time: say explicitly and early
  that a placeholder deploy is not the real design, before showing it.
- **Verification**: `node build-core.js`/`build-admin.js` round-trip OK. Full backend
  `test-*.js` suite 54/54 (unaffected — no backend files touched in the frontend-rebuild
  commit). Headless-browser smoke test (Playwright + this environment's pre-installed
  Chromium, served over a local `python3 -m http.server`) against the actual built
  `user/index.html`: auth tab switching, password-visibility toggle, phone/password/
  confirm validation errors, all four page routes, the deposit sheet, and the invest sheet
  all rendered and interacted correctly with **zero console/page errors** (STATE.api mocked
  to work around this sandbox's egress policy blocking `gstatic.com`/`onrender.com`
  outright — confirmed via `/__agentproxy/status`, a real policy denial, not something to
  route around). That smoke test caught and fixed two real authoring mistakes before they
  shipped: a broken ternary (`x.repeat ? '' : ...`) that would have rendered the Home
  skeleton loader as a blank div, and an invalid CSS selector/`@media` hybrid that was dead
  code in two places (auth-hero background, toast dark-mode override). Also caught a
  genuine visual bug via screenshot review: the auth-screen wordmark was white text on a
  light gray fallback background (illegible) when no admin banner image is set yet — fixed
  by giving `.auth-hero` a dark gradient fallback instead of `var(--surface-2)`.
  **Not verified**: real Firebase auth (create/sign-in) and real backend API calls
  end-to-end in a live browser — blocked by this sandbox's egress policy, not by anything
  in the code. Needs a real-device or real-browser check once Render finishes
  auto-deploying this push.
- **Left open / deferred — do not claim any of these are done**:
  1. **Real end-to-end check on a real device/browser** — register, log in, deposit,
     invest, withdraw, referral, check-in — all need a live pass now that the sandbox can't
     reach the real Firebase/backend hosts.
  2. **"Show" feature** — still does not exist anywhere, frontend or backend. Nav is
     currently 4 tabs (Home/Products/Team/Account) per the owner's most recent explicit
     dictation this session, which dropped "Show" from the original 5-tab description
     without comment — flagged here, not assumed resolved either way. Needs the owner to
     confirm whether it's still wanted and, if so, full scoping (upload flow/storage/admin
     review queue/reward mechanism, none of which exist).
  3. **Floating assistant is a client-side placeholder** (regex-matched canned answers over
     `/public/settings` text) — the owner explicitly said "I think they may be serversided,
     put some technology" wanting a real server-side/AI-backed assistant. Not built. Needs
     a new backend endpoint + whatever LLM/response tech is chosen, and scoping on how much
     account-specific context it should have access to.
  4. **Admin panel**: still a straight ChocoMCC reskin (name/logo/colour swap only, per the
     owner's original explicit instruction) — NOT yet updated to remove USD-depositing and
     bank-depositing UI/logic, which the owner asked for later in this same session
     ("remove residues of USD depositing, bank depositing... just the same admin panel
     like for chocomcc"). Still present in `admin-src/index.html` and whatever server.js
     endpoints back them. Needs a real pass: find and remove the USDT/crypto deposit UI and
     the bank-transfer deposit UI (bank transfer for *withdrawal* is a different,
     PIN-gated, admin-toggleable feature — `bankWithdrawEnabled` — and was never asked to
     be removed, don't conflate the two).
  5. **Products aren't populated yet** — the owner said they'll enter the real 15-plan
     catalog (Sputnik 1 → James Webb Space Telescope, prices/cashback/returns per the PDF
     they sent) via the admin panel themselves. `DEFAULT_PRODUCTS` in `server.js` still has
     the old 10-tier chocolate-derived space-object ladder as a fallback — harmless (admin
     entries override it) but don't mistake it for the real catalog.
  6. **App icons / product fallback images** — `icon-192.png`/`icon-512.png`/favicon/
     maskable variants under `user/` and `admin/` are still ChocoMCC's chocolate-brand art.
     Lower priority since real product images now come from the admin's own `image` field
     per product, and banner slots (`barstack`/`darkbar`/`giftbox`/`rocherstack`/etc.) are
     admin-uploadable — but the app-icon/favicon art itself hasn't been touched.
  7. **VAPID key change is unverified live** — updated to the new `space8-9d97c` project's
     key, admin rebuilt and pushed, but push notifications haven't been test-fired against
     a real device.

## 2026-08-15 — Claude — Session wrap-up: scope corrected, design mockup built, rename to "space8" pending

- **What changed**: No code changes this entry — this is a checkpoint before a long
  session ends. Rewrote `CLAUDE.md` top-to-bottom to capture the full session history
  (including two wrong turns, corrected below) so the next session doesn't re-derive or
  repeat them. Added `design/visual-system-mockup.html` to the repo (previously only a
  scratchpad file + Artifact link) so the agreed design direction survives the session
  ending. Read the new `CLAUDE.md` in full — this log entry is a summary of it, not a
  replacement for it.
- **Why**: Owner corrected scope twice this session: (1) backend + admin panel should be
  ChocoMCC reused as-is — confirmed correct, no further action; (2) the user-facing
  frontend should NOT be a ChocoMCC reskin — it needs its own design and architecture, and
  the port that's currently sitting in `user-src/`/`user/` is wrong and needs replacing.
  Owner also specified an exact palette after rejecting the first design pass (violet +
  starfield): white + one dominant blue, no other colours. A reviewed mockup was built
  against that spec (screens + component strip, real embedded fonts, Robinhood/Cash App/
  Revolut/Stripe referenced for discipline) but had not yet received owner feedback when
  the owner asked to wrap the session and pivot the project name to "space8."
- **Verification**: N/A (documentation-only entry). Backend test suite was last confirmed
  green earlier in this session (54/54 files, see the prior entry below) and has not been
  touched since.
- **Left open for next session — in priority order**:
  1. Confirm what "space8" actually means for renaming scope (folder name? all brand
     strings? just a name change, keeping "Space8" internally?) before doing any find/
     replace — guessing wrong here has already cost two full wasted passes this session.
  2. Get owner reaction to `design/visual-system-mockup.html` — approved, or changes
     needed — before building the real frontend against it.
  3. Rebuild `user-src/`/`user/` from scratch against the approved design (backend/admin
     stay as they are — do not touch `server.js`/`db.js`/`admin-src/` for this).
  4. Scope and build the "Show" feature (withdrawal-proof-of-payment upload for a reward)
     — genuinely new, does not exist in ChocoMCC in any form.
  5. Real app icons + product/banner fallback art (currently still ChocoMCC's chocolate
     photos) — lower priority, admin-uploaded content overrides these in practice.

## 2026-08-15 — Claude — Ported full ChocoMCC codebase into Space8, rebranded in place

- **What changed**: Deleted an earlier from-scratch Space8 scaffold (server.js/db.js/
  index.html/admin.html written fresh, ~5000 lines) after the owner pointed out this
  should instead be a direct port of ChocoMCC with only branding swapped. Copied the full
  `choco-mcc/` source tree (server.js, db.js, user-src/, admin-src/, build-core.js,
  build-admin.js, guard-src.js, all 60 test-*.js files, render.yaml, package.json) into
  `space8/` from branch `claude/voltra-session-continue-mk95gw` (where the real ChocoMCC
  source lives — it wasn't on this branch before). `choco-mcc/` itself was never touched.
- **Why**: The owner was explicit: "we just replace ChocoMCC admin... just name and logo,
  everything remains every feature, every code." The earlier scratch build had a fraction
  of ChocoMCC's actual feature set (no USDT, no bank withdrawal, no payout PIN, no admin
  audit log, no 60-test safety net, etc.) and admittedly weaker design.
- **Rebrand applied** (see `CLAUDE.md` for the full mapping):
  - Brand strings: ChocoMCC→Space8, CHOCO_*→SPACE8_*, choco_* storage keys→space8_*.
  - Colour theme: light cream/cocoa/caramel → dark Void/Signal (violet), via `:root`
    custom-property value remap + matching hex/rgba literal cleanup. External brand
    colours (Telegram/WhatsApp/MTN/Airtel) deliberately left untouched.
  - 10-tier product ladder renamed chocolate-brand → space objects (comet → singularity),
    prices/cycles/returns numerically unchanged.
  - About-page static fallback (955KB of embedded chocolate-heritage photos/copy) replaced
    with a short space-themed placeholder paragraph — this fallback only renders before
    the admin-set About text loads, so it's cosmetic/weight, not logic.
- **Verification**:
  - `node build-core.js` → round-trip OK (user/index.html rebuilt, 2.17MB).
  - `node build-admin.js` → round-trip OK (admin/index.html rebuilt, 595KB).
  - `node test-all-tiers-pricing.js` → 70/70 passing on the renamed tier keys (pricing,
    daily cashback, and maturity payout math all unaffected by the rename).
  - Ran the full `test-*.js` suite after the rename; found and fixed two tests that
    asserted on the literal word "chocolate" in error-message text via regex
    (`test-settings-wired.js`, `test-withdrawal-security.js`) rather than status codes —
    updated their regexes to match the new "plan" wording.
  - **Full suite result: 54/54 test files clean, 0 issues** (run via a loop invoking each
    `test-*.js` directly — there's no `npm test` wired up, see `package.json`).
  - Did a second sweep for remaining "chocolate"/"choco" strings the scripted pass missed
    (found via visual screenshot check + grep): auth screen tagline ("stash of the
    world's finest chocolate brands" → "stash of the galaxy's finest returns"), home
    screen CTA ("Tap in, get chocolate money" → "Tap in, get cosmic returns"), promo
    codes (`CHOCO50/SWEET100/CACAO25` → `NOVA50/ORBIT100/COSMOS25`), and several
    admin-panel labels ("Active chocolates", "Chocolate purchase", "Require a chocolate
    product before withdrawing", etc. → plan-equivalent wording). Re-ran
    `build-core.js`/`build-admin.js` after — both round-trip OK — and re-ran the two
    edited test files individually to confirm still green.
- **Deferred / open** (do not assume these are done):
  - Product/banner fallback images (`SPACE8_IMAGES`/`SPACE8_BANNERS`) are still literal
    chocolate product photos — not replaced with space imagery yet.
  - App icons (icon-192/512, favicon, maskable, link-preview.jpg) are still ChocoMCC's
    chocolate-brand art.
  - The owner asked for a "Show" tab where users upload withdrawal screenshots and get
    rewarded — **this does not exist in ChocoMCC**. Closest existing tab is "Rewards"
    (check-in/cashback/task-center), which is a different feature. Needs scoping as new
    work, not assumed already present.
  - `CLAUDE.md`/`CODEX.md`/this log were just created this round — no prior history to
    reconcile.
