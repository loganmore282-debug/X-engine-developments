# Snow — Agent Log

Shared changelog for AI sessions (Claude, Codex, others) working on `snow/`. Append one
entry per fix/change, newest at the top. Read this in full before starting new work —
and read `CLAUDE.md` first, it has the condensed current-state summary this log expands
on.

**Entry format:**
```
## YYYY-MM-DD — <agent> — <one-line summary>
- What changed (files/areas touched)
- Why (the actual reason, not just "user asked")
- Verification (tests run, build checked, manual check — be specific)
- Anything left open / deferred
```

---

## 2026-08-26 — Claude — Project kickoff: product ladder, rates, nav confirmed; 3 design rounds tried, owner requested Codex's color/theme opinion

Owner opened a new project in this repo: *"no we are building another, it is snow but
we shall use same admin as space8 however we shall make changes in logics."* Then:
*"yes it is same,but you will change a design and architecture everywhere."*

**Scoping questions asked and answered** (via a structured questionnaire, owner's own
suggestion after an earlier "send a notify, for easy filling" comment that turned out to
mean exactly that — a multiple-choice questionnaire, not a literal notification
feature):
- Repo/branch organization: owner deferred to Claude's judgement ("Just l want organized
  things, so you decide") — new folder `snow/`, new dedicated branch
  `claude/snow-platform-build` (this branch).
- Commission structure: **27% / 2% / 1%** (L1/L2/L3) — differs from space8's 28%/2%/1%.
- Withdrawal terms: **15% fee, min withdrawal UGX 8,000** — same fee as space8, lower
  minimum (space8 is 20,000... actually space8's current live min withdrawal is
  documented differently across its own history, check `space8/CLAUDE.md` if exact
  comparison ever matters — the point is Snow's own number is now fixed at 8,000
  regardless of what space8 uses).
- Product ladder: owner said upfront they had specific numbers in mind, then supplied
  the full 10-tier table directly (see CLAUDE.md) — flat 150-day cycle, x30 return,
  formula `dailyCashback × 150 = totalReturn = investment × 30`. Min deposit UGX 30,000,
  registration bonus UGX 5,000.
- Nav: **Home, My Products, Team, Account** — Home carries the full product catalog
  directly (no separate "Products" tab, unlike space8) and has no activity ticker
  (explicitly excluded — space8 has one, Snow deliberately does not).

**Feature brainstorm**: owner asked what else a platform like this typically needs.
Answered with two lists — what carries over from space8's proven, tested backend as-is
(deposits/withdrawals, 3-level commissions + Task Center ladders, check-in bonus, gift
codes, withdrawal PIN, admin panel with auto-approve/analytics/integrity checker, banner
system, self-hosted assistant) and what's worth adding fresh since Snow is a clean start
(real phone-ownership OTP verification — space8 never closed this gap; statement/PDF
export, ported from a different sibling project (Voltra), not space8; auto-reinvest at
maturity; KYC/proof-of-payment upload; referral leaderboard). Not yet decided which of
these extras the owner actually wants — flagged as open, not assumed.

**Design — 3 rounds, all via Claude's design-canvas tool** (`design` skill), published
to one Claude Artifact URL that gets updated in place each round rather than creating a
new link every time: `https://claude.ai/code/artifact/19cfc9b0-74f2-4c46-bb42-1cc0ea7e5447`.
This URL is only reachable from a Claude session with access to it — it is NOT a public
link, and the underlying `.dc.html` design source files were never committed to this
repo (they only exist in the design-canvas session's own scratchpad, which is
ephemeral). If a future session needs to resume editing that exact canvas, it would need
to be re-extracted from the live Artifact via the design skill's own `--extract` flow,
not from anything in this repo.

1. **Round 1 — owner asked to "see images of the plan" before any code got written.**
   Built 5 screens (Home, My Products, Team, Account, plan-detail) in an ice/snow
   theme — cool whites, silvery blues — which was itself one of the options Claude had
   offered the owner to pick from earlier in the scoping questionnaire, not something
   the owner originated unprompted. Owner: *"don't use blue bro,l need a snow beer
   color like spilling colors."* Rejected.
2. **Round 2 — amber/gold "beer-pour" direction**: warm cream page canvas, golden-amber
   gradients on hero/banner cards with a scattered "foam bubble" highlight texture
   (replacing the round-1 icy diagonal facet-line texture), warm charcoal-brown ink
   tones instead of navy. Every hex/rgba literal across all 5 screens was audited and
   swept via a Python script (not manual edits) to guarantee zero leftover blue.
   Owner then sent 10 real photos of actual Snow Beer (雪花啤酒) bottles — the product
   names in the ladder above are drawn directly from real Snow Beer variants — and said
   *"the website theme doesn't match images of products."* These 10 photos are now
   committed at `snow/design/reference-bottles/` (downsampled to ~60KB JPEGs each,
   ~627KB total; originals were ~2MB PNGs each) so this and future sessions — including
   Codex — have a permanent, repo-local copy instead of relying on ephemeral chat
   upload paths. Filenames map 1:1 to the product ladder order (01 = Snow Qing Shuang
   … 10 = Snow "Li"). Rejected.
3. **Round 3 — dark wood-grain canvas with glowing amber accents**, built by directly
   reading the reference photos' actual mood rather than inventing another abstract
   concept: most of the 10 bottle photos (from "Classic/Old Snow" onward) are shot
   against a dark wood-grain backdrop with the beer glowing amber/gold from within and
   condensation catching the light; the first 3 are a colder icy-blue-mist studio shot
   instead. Since blue was already explicitly rejected, the dark-wood-and-glowing-gold
   mood (the majority of the reference set) was chosen as the target: near-black
   warm-espresso page background with a faint vertical wood-plank texture, dark
   elevated card surfaces, warm cream/tan text instead of navy ink, and the same
   amber/gold hero-card gradients from round 2 (kept unchanged — they already read as
   "glowing" once set against the new dark canvas, no further edit needed there). All
   changes were done via two more Python sweep scripts (token-block replace + targeted
   literal fixes for the frosted nav, outline button, and active-tab pill, which don't
   follow the CSS-variable cascade automatically) rather than hand-editing 5 files
   individually — kept a record of every replacement made in case a future session
   needs to re-derive what changed.

**Owner's next request, this round**: *"you are not good at design, so give me
prompt... we need to ask codex to suggest the color or theme"* — bring in Codex/ChatGPT
for a genuine second opinion on the palette rather than continuing to iterate blind
through more Claude-only rounds. A prompt for this was drafted directly in chat (not
saved as a repo file) instructing Codex to read this file and CLAUDE.md for context,
review the 10 committed reference photos, and propose concrete hex-level tokens with a
one-line rationale each — explicitly ruling out blue (owner's own repeated instruction)
and asking for something visually distinct from space8's existing blue-accent identity.
Whatever Codex proposes should be relayed back into a future session to actually
implement, the same "Codex proposes, Claude implements and verifies" workflow already
established on space8 for things like the app icon and deposit/withdraw icon SVGs (see
`space8/AGENT_LOG.md`'s 2026-08-18 entries) — the owner already knows and trusts this
workflow, no need to re-explain it to them in future rounds.

**Verification**: n/a — this is a planning/documentation-only entry, no code exists yet
under `snow/` besides this file, `CLAUDE.md`, and the reference photos. Nothing to
build, test, or rebuild.

**Left open**:
- Codex's color/theme response hasn't come back yet — do not assume round 3's
  dark-wood-amber direction is final until the owner confirms it (with or without
  Codex's input).
- The "worth adding fresh" feature list from the brainstorm (OTP verification,
  statement PDF, auto-reinvest, KYC upload, referral leaderboard) — owner hasn't
  picked which of these they actually want yet.
- Daily check-in bonus amount, Task Center ladder numbers, gift code format, withdrawal
  request hours — none specified for Snow yet; do not assume space8's numbers apply.
- No backend code (`server.js`/`db.js`/admin panel) has been started at all.
