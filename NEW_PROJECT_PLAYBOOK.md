# New-project playbook — paste this as your opening prompt

This is a filled-in version, not a generic template. It bakes in the exact facts a fresh
Claude/Codex session needs about this repo and this build method, learned the hard way
while building Novera. Copy the block below, swap the `<<...>>` placeholders (only those —
everything else is a real, load-bearing fact, not filler), and send it as your first
message in a new session.

---

```
We're building <<NEW APP NAME>>, a <<what it is, one sentence — e.g. "Uganda mobile-money
investment platform themed around ___">>. This repo (loganmore282-debug/x-engine-developments)
already holds several apps of this exact kind, each in its own top-level folder — voltra/,
choco-mcc/, novera/. Read novera/CLAUDE.md and novera/AGENT_LOG.md in this repo first — they
document the working method in detail, including two wrong turns that wasted a full session
last time. Do not repeat those. The short version:

SOURCE OF TRUTH: choco-mcc/ is the most complete, battle-tested version of this app type —
Express + MongoDB + Firebase Auth + MarzPay backend, 60-file test suite, full admin panel,
referral commissions, money-safety locking for MongoDB Atlas M0 (no ACID transactions —
in-process Sets act as single-writer locks on every money-crediting path, do not remove
these). IMPORTANT: choco-mcc/'s full source is NOT on this repo's default/main branch — it
only exists on branch `claude/voltra-session-continue-mk95gw`. Check there first
(`git ls-tree -r --name-only claude/voltra-session-continue-mk95gw | grep choco-mcc` or a
`git worktree add` against that branch) before assuming it's missing. NEVER edit choco-mcc/
itself from a new-project session — only copy FROM it.

FILE STRUCTURE (same convention for every app in this repo — follow it exactly):
- user-src/index.html + user-src/original_module.js — readable frontend source, edit here.
- user/ — built deploy artifact (build-core.js output, obfuscated). Never hand-edit.
- admin-src/index.html — readable admin source, edit here.
- admin/ — built admin artifact (build-admin.js output). Never hand-edit.
- server.js, db.js — backend. db.js is a MongoDB-driver-wrapped Firestore-compatible API
  (collection/doc/where/get/set/update, FieldValue.increment etc.) so server.js code reads
  like Firestore even though it's Mongo underneath.
- test-*.js — one file per behavior, run directly with `node test-name.js` (no test runner
  wired up, no npm test script — just loop `for f in test-*.js; do node "$f"; done`).
- build-core.js, build-admin.js, guard-src.js — obfuscation/build pipeline, prints
  "round-trip OK" when a build is valid. Always rebuild after editing *-src/.
- render.yaml — Render deploy config, rootDir points at the project folder and at
  <project>/user for the two separate Render services (backend, static frontend host).

THE SPLIT THAT MATTERS MOST — get this right from message one, don't let me correct it later:
1. Backend (server.js, db.js, test-*.js) — REUSE choco-mcc/'s AS-IS. Rename brand strings
   only (see rebrand notes below). This is proven logic, not a design choice — don't
   rebuild it, don't "improve" it unasked.
2. Admin panel (admin-src/, admin/) — REUSE choco-mcc/'s admin AS-IS too. Same reasoning:
   admin panels are internal tools, not a place for original design. Straight reskin:
   name, logo, one color-token remap. Zero feature changes.
3. User-facing app (user-src/, user/) — DO NOT reuse choco-mcc/'s frontend, not even
   recolored. Build this one from scratch with its own visual design and its own
   information architecture. This is the ONLY layer that should look and feel different
   from every other app in this repo. Getting this backwards (reskinning the frontend
   instead of rebuilding it) is exactly what went wrong on Novera and had to be redone.

REBRAND MECHANICS (apply to backend/admin only, per the split above):
- Brand strings: find/replace the source app's name → your new name, including any
  ALL_CAPS_IDENTIFIER prefixes (e.g. CHOCO_IMAGES → YOURPREFIX_IMAGES) and any
  lowercase_storage_key prefixes used in localStorage/sessionStorage.
- Watch for tests that assert on literal brand words in error-message text via regex
  (e.g. `/chocolate product/i.test(r.body.message)`) rather than status codes alone — a
  copy change to server.js will silently break these unless you grep the test files for
  the old brand word too, not just the source files.
- If the source app's product/tier list uses source-brand names, decide new names in
  advance and rename by `key` field, not by guessing which occurrences are safe — use a
  script (regex on quoted whole-word tokens), don't hand-edit a 1MB+ single-line HTML file.
- Any static fallback content (an About page, a hero banner) that's only shown before the
  real admin-configured content loads — check its actual weight before assuming it matters;
  it may be several hundred KB of source-brand photos/copy worth trimming regardless of
  priority, since it ships dead weight and can flash off-brand content on cold load.
- Icon/photo assets tied to the source brand (product photos, favicons) do NOT need
  pixel-perfect replacement immediately — the admin panel's own upload feature overrides
  them in real usage. Flag as deferred, don't block on generating new imagery.

DESIGN FOR THE NEW FRONTEND — be explicit about these, don't leave them to be inferred:
- Exact color palette: <<name every color as a hex value, however many you want; say if
  it's strictly N colors and nothing else, or if there's room for semantic exceptions
  (e.g. one reserved red for real error/failure states, separate from your brand accent)>>
- Typography: pick two real typefaces (a UI/body face + a distinct face for money/data
  figures ideally monospaced with tabular figures) — avoid Inter and Space Grotesk, they're
  the default "safe" choice every AI reaches for. Google Fonts' CSS API and file host
  (fonts.googleapis.com, fonts.gstatic.com) are reachable through this environment's
  network proxy even when most other external domains are blocked — fetch the real font
  files with curl and embed as base64 @font-face data URIs, don't link an external
  stylesheet (it silently fails in sandboxed contexts and may not render at all elsewhere).
- No decoration for decoration's sake — whatever makes this app's world distinctive
  (<<the theme, e.g. "space," "chocolate," whatever it is>>) should come through in how
  data is presented (custom iconography, a meaningful progress/state visualization,
  disciplined use of one accent color) rather than a decorative background effect.
- Design BOTH light and dark mode as first-class, not one inverted from the other — use
  :root for light, @media (prefers-color-scheme: dark) guarded with
  :root:not([data-theme="light"]), and :root[data-theme="dark"] for an explicit toggle.
- Before writing the real frontend: build a static design mockup (multiple real screens +
  a small component strip showing buttons/inputs/status states) and get sign-off before
  writing the full app against it. Don't build blind.

NAV / SCREENS: <<list every tab/screen you want>>. For each one, say explicitly whether
it's the same feature as something in choco-mcc/'s tab bar (home / shop / rewards / team /
account("Me")) under a new label, or genuinely new functionality that needs backend work
too (new endpoints, new DB collections, an admin review queue) — not just a new UI tab
wired to nothing.

PROCESS: write <<project-folder>>/CLAUDE.md as you go (what's reused vs rebuilt, exact
rebrand mapping, design tokens, known gaps — don't let this drift out of sync with reality)
and <<project-folder>>/AGENT_LOG.md (one entry per fix: what changed, why, how it was
verified, what's still open) so a different AI session — Claude or Codex — can pick this
up later without re-deriving context or re-asking me questions I've already answered.
```

---

### Why each part is in there (for you, not for the AI)

- **The branch note about `choco-mcc/`** — without this, a fresh session will look at the
  default branch, see only zip files, and either give up or rebuild from scratch. This one
  fact alone caused most of the wasted effort this session.
- **The three-layer split spelled out per-layer** — "reuse this app but make it look
  different" reads as one instruction to a model; it isn't one instruction, it's three
  different instructions for three different files. Naming them separately is what
  prevents the model from either reusing everything or rebuilding everything.
- **Exact colors, not "modern"** — a taste word tells a model nothing concrete to build
  against. A hex value does.
- **The mockup-before-code checkpoint** — this is the one step that would have caught the
  wrong direction before a full afternoon went into it twice.
