# Novera — Agent Log

Shared changelog for AI sessions (Claude, Codex, others) working on `novera/`. Append one
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

## 2026-08-15 — Claude — Ported full ChocoMCC codebase into Novera, rebranded in place

- **What changed**: Deleted an earlier from-scratch Novera scaffold (server.js/db.js/
  index.html/admin.html written fresh, ~5000 lines) after the owner pointed out this
  should instead be a direct port of ChocoMCC with only branding swapped. Copied the full
  `choco-mcc/` source tree (server.js, db.js, user-src/, admin-src/, build-core.js,
  build-admin.js, guard-src.js, all 60 test-*.js files, render.yaml, package.json) into
  `novera/` from branch `claude/voltra-session-continue-mk95gw` (where the real ChocoMCC
  source lives — it wasn't on this branch before). `choco-mcc/` itself was never touched.
- **Why**: The owner was explicit: "we just replace ChocoMCC admin... just name and logo,
  everything remains every feature, every code." The earlier scratch build had a fraction
  of ChocoMCC's actual feature set (no USDT, no bank withdrawal, no payout PIN, no admin
  audit log, no 60-test safety net, etc.) and admittedly weaker design.
- **Rebrand applied** (see `CLAUDE.md` for the full mapping):
  - Brand strings: ChocoMCC→Novera, CHOCO_*→NOVA_*, choco_* storage keys→novera_*.
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
  - Product/banner fallback images (`NOVA_IMAGES`/`NOVA_BANNERS`) are still literal
    chocolate product photos — not replaced with space imagery yet.
  - App icons (icon-192/512, favicon, maskable, link-preview.jpg) are still ChocoMCC's
    chocolate-brand art.
  - The owner asked for a "Show" tab where users upload withdrawal screenshots and get
    rewarded — **this does not exist in ChocoMCC**. Closest existing tab is "Rewards"
    (check-in/cashback/task-center), which is a different feature. Needs scoping as new
    work, not assumed already present.
  - `CLAUDE.md`/`CODEX.md`/this log were just created this round — no prior history to
    reconcile.
