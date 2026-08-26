# Snow — Project Memory (read this first)

**What it is:** Snow is a new Uganda mobile-money **investment platform**, a sibling
project to **space8** in this same repo. Same category of app (deposits/withdrawals via
mobile money, tiered investment products with daily cashback, 3-level referral
commissions) but a genuinely different brand, product ladder, and visual design —
**not** a reskin of space8, a fresh build that reuses space8's proven backend
architecture/patterns as a starting point.

**Brand inspiration**: the product names are drawn from real **Snow Beer (雪花啤酒)**
variants — the world's best-selling beer brand by volume, from China. 10 reference
photos of the actual bottles are committed at `snow/design/reference-bottles/`
(01–10, matching the product order below) — use these as the visual/mood source of
truth for anything design-related, not assumptions about what "Snow" should look like.

**Status as of this file's creation: planning/design phase.** No backend code has been
written yet. Only the product ladder, rates, nav structure, and 3 rounds of visual
design exploration exist so far (see AGENT_LOG.md for the full design history).

## Repo / branch

- Repo: `loganmore282-debug/x-engine-developments` — same multi-project repo as
  `space8/`, `voltra/`, `choco-mcc/`, `nexus/`. This project's code lives under
  `snow/`, on its own dedicated branch: **`claude/snow-platform-build`**.
- Never edit `space8/`, `voltra/`, or other sibling project folders from Snow sessions.

## Product ladder (confirmed, owner-supplied — 2026-08-26)

10 tiers, flat **150-day cycle**, formula: **Daily Cashback × 150 = Total Return =
Investment × 30**.

| # | Product | Investment | Daily Cashback | Duration | Total Return |
|---|---|---|---|---|---|
| 1 | Snow Qing Shuang | UGX 30,000 | UGX 6,000/day | 150 days | UGX 900,000 |
| 2 | Snow Ice Cool (Bing Ku) | UGX 90,000 | UGX 18,000/day | 150 days | UGX 2,700,000 |
| 3 | Snow Brave the World | UGX 197,000 | UGX 39,400/day | 150 days | UGX 5,910,000 |
| 4 | Snow Classic (Old Snow) | UGX 355,000 | UGX 71,000/day | 150 days | UGX 10,650,000 |
| 5 | Snow Draft Beer (Chun Sheng) | UGX 560,000 | UGX 112,000/day | 150 days | UGX 16,800,000 |
| 6 | Snow Brave the World SuperX | UGX 950,000 | UGX 190,000/day | 150 days | UGX 28,500,000 |
| 7 | Snow Marrs Green | UGX 1,000,000 | UGX 200,000/day | 150 days | UGX 30,000,000 |
| 8 | Snow Jiang Xin Ying Zao (Master Artisan) | UGX 1,250,000 | UGX 250,000/day | 150 days | UGX 37,500,000 |
| 9 | Snow Opera Mask Series (Lianpu) | UGX 2,550,000 | UGX 510,000/day | 150 days | UGX 76,500,000 |
| 10 | Snow "Li" (醴) | UGX 4,500,000 | UGX 900,000/day | 150 days | UGX 135,000,000 |

## Platform rates (confirmed, owner-supplied — 2026-08-26)

- Referral commission: **L1 27% / L2 2% / L3 1%**
- Withdrawal fee: **15%**
- Minimum withdrawal: **UGX 8,000**
- Minimum deposit: **UGX 30,000**
- Registration bonus: **UGX 5,000**

Not yet specified by the owner (ask before assuming, or reuse space8's default and flag
it as an assumption): daily check-in bonus amount, referral-count/whole-team-deposit
Task Center ladders, gift code format, withdrawal request hours.

## Navigation / IA (confirmed, owner-supplied — 2026-08-26)

**4 tabs: Home, My Products, Team, Account.**

- **Home** — has an admin-configurable banner, **no activity/live ticker** (explicitly
  excluded, unlike space8 which has one), and **the full product catalog lives directly
  on Home** (not a separate "Products" tab like space8).
- **My Products** — the member's own active investments/plans (progress, next payout).
  Separate tab from Home's browse-and-buy catalog.
- **Team** — referral levels (L1/L2/L3), referral code/link, commission structure.
- **Account** — profile identity, wallet/menu tiles (withdrawal account, deposit/
  withdrawal history, security PIN, etc.), standard settings menu rows.

## Design status — 3 rounds so far, still not settled

A 5-screen design canvas mockup (Home, My Products, Team, Account, plan-detail) was
built and iterated via Claude's design-canvas tool, published as a Claude Artifact
(URL: `https://claude.ai/code/artifact/19cfc9b0-74f2-4c46-bb42-1cc0ea7e5447` — only
reachable from a Claude session with access to it, not a public link; the actual
`.dc.html` source files are NOT committed to this repo, they only exist in that
session's scratchpad).

1. **Round 1 — ice/snow theme, blue-accent, cool whites/silvery blues.** Owner's own
   pick from a set of options offered. **Rejected**: *"don't use blue bro"*.
2. **Round 2 — amber/gold "beer spilling colors" on a warm cream canvas**, in response
   to *"l need a snow beer color like spilling colors"*. **Rejected**: owner pointed out
   the theme still didn't match the real product photography (see below).
3. **Round 3 — dark wood-grain canvas with glowing amber accents**, built directly
   against the 10 real Snow Beer bottle reference photos (dark backdrop, glowing gold
   liquid, condensation highlights) instead of an invented "ice" or "cream" concept.
   **Outcome not yet confirmed** — owner then asked to bring in Codex/ChatGPT for a
   color/theme opinion instead of continuing to iterate blind with Claude alone (owner:
   *"you are not good at design"*).

**Owner's explicit ask, this round**: get Codex's suggestion for the color palette /
visual theme, using the real bottle photography (`snow/design/reference-bottles/`) as
the grounding reference, and considering that space8 (the sibling project) already owns
a blue-accent identity — Snow needs to read as visually distinct from it.

**Do not restart the design from scratch without reading this section and
AGENT_LOG.md's design-history entries first** — three real directions have already
been tried and explicitly rejected/pending; a future session (Claude or Codex) should
build on that history, not re-litigate it.

## Build/backend — not started

Nothing under `snow/` yet except this file, `AGENT_LOG.md`, and
`design/reference-bottles/`. When backend work starts, follow the SAME
three-part-split discipline space8 used (see `space8/CLAUDE.md` for the pattern):
backend logic reused/adapted from a proven base, admin panel reskinned not rebuilt,
user-facing frontend genuinely new. Do not assume space8's `server.js`/`db.js` can be
copied verbatim — the product ladder, rates, and nav structure above are all different
and need to be reflected in whatever backend gets built.

## Secrets — NEVER commit

No infrastructure (MongoDB, Firebase, MarzPay) has been provisioned for Snow yet. When
it is, follow the exact same pattern as space8: secrets live only in the hosting
platform's env vars, never in this repo.
