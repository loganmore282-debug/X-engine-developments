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

**There is only ONE PIN in Snow, not two** (confirmed, owner-supplied — 2026-08-26):
the 5-digit "Transaction PIN" set at registration (per Codex's auth spec — see Design
status below) IS the same PIN used to authorize withdrawals — there is no separate
"Security PIN"/"Payout PIN" concept the way earlier Nexus/space8-lineage projects had
one. Account's menu tile is labeled "Transaction PIN", not "Security PIN", to keep this
one system consistently named everywhere. When backend work starts: do not build two
separate PIN fields/hashes — one `transactionPin` (or equivalent) gates both first-time
setup and every withdrawal, matching what the registration screen already collects.

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

## Design status — settled on a Codex-authored system as of 2026-08-26, now mid-build

**Round 5 is the current, live design direction — read this section (and the round-5
AGENT_LOG.md entry, which lists all 7 fixes in detail) before touching visual design
again.** Round 4 established the token/component system below (still accurate, unchanged
in round 5). Round 5 applied Codex's critique of round 4's screenshots: one canonical
wave curve (used only on Home; Team/Account use a wave-less `brand-card` variant with
just the corner lines), a dedicated `--snow-wave-on-wine` token so the green corner
lines don't blend muddy-brown against the wine background, the full 10-product
catalogue with real bottle-photo thumbnails per tier (was hardcoded to 5), a fixed
cross-screen financial mismatch (Home's Total Invested/Earned now agree with My
Products' plan cards), and a fuller token/component set (`--snow-wine-soft`/
`green-soft`/`neutral-soft`, `--snow-radius-*`, `product-card`/`plan-card`/
`stat-tile`/`icon-tile`/`segmented-control`/`settings-list`/`list-row`/`top-bar`).
Rounds 1–3 (ice/blue, amber/gold beer-pour, dark wood-grain — all Claude-only
explorations) are superseded and should NOT be revisited; they're kept in
AGENT_LOG.md purely as history of what was already tried and rejected.

**The owner had Codex design the login/register screens directly** (screenshots
relayed back into chat, same review-prompt workflow already established on space8) and
Codex also produced a full written design-system spec at the same time. Both are now
the source of truth:

- **Visual reference screens** (Codex-designed, pixel-final, not to be altered without
  the owner asking): `snow/design/mockups/00-register.png`,
  `snow/design/mockups/00-login.png`.
- **Design tokens** (white/black/wine-red/green — **no blue, no amber/gold, no dark
  wood theme** — all three of rounds 1–3 are explicitly ruled out by this spec):
  ```css
  --snow-canvas: #FCFBF9;   /* main page background */
  --snow-surface: #FFFFFF;  /* cards, fields, sheets */
  --snow-ink: #111111;      /* headings and primary text */
  --snow-muted: #737373;    /* secondary text */
  --snow-wine: #941827;     /* primary CTA, hero, active state */
  --snow-wine-deep: #71101B;/* subtle hero depth only */
  --snow-green: #2F6B47;    /* waves, success, links, verified state */
  --snow-border: #E8E4E1;   /* field/card outline */
  ```
- **Radii**: main cards 28px, input cards 26px, primary buttons 24px, sheets/modals
  32px 32px 0 0. Soft clean shadows, thin warm-gray borders, not harsh box-shadows.
- **Brand language**: green snowflake mark + wordmark "SNOW"; wine-red hero areas with
  a large smooth white wave curving into the form/content area below, plus thin
  bottle-green parallel wave-line decorations in the hero's corners. Built with
  SVG/CSS shapes, not a screenshot background.
- **Component vocabulary Codex asked for** (build all future screens out of these, not
  one-off markup): `brand-hero`, `brand-wave`, `wave-lines`, `app-card`, `form-field`,
  `primary-button`, `secondary-button`, `status-pill`, `bottom-nav`, `bottom-sheet`.
- **Explicit product-behavior constraints from the same spec** (relevant once backend
  work starts, not just visual): registration fields are exactly Mobile number /
  Password / Transaction PIN (5 digits) — no confirmation fields, no referral/checkbox/
  social login unless the owner asks later; only show "Forgot password?" once a real
  reset flow exists; never log/store/expose a raw password or PIN in client state;
  money movement must stay server-side/idempotent with a ledger record per
  balance-changing event; frontend state is display-only.

**Claude then built Home, My Products, Team, and Account against this exact spec**
(not a redesign — a direct application of the tokens/components above), rendered as
static PNG screenshots via Playwright rather than an interactive Claude Artifact link,
per the owner's explicit ask (*"can you send me photos instead of artifacts of html"*)
so they're easy to hand to Codex directly:
`snow/design/mockups/01-home.png`, `02-my-products.png`, `03-team.png`,
`04-account.png`. Editable source for these 4 (plain standalone HTML, not the
design-canvas `.dc.html` format used in rounds 1–3) is at
`snow/design/mockup-src/*.html` + the Python generator `build.py` that produced them
(`python3 build.py` regenerates the HTML from the shared token/component definitions
inside it; screenshot with Playwright + `chromium` at `/opt/pw-browsers/chromium`,
390px width, `device_scale_factor=2`, `full_page=True`).

**Known limitation, disclosed to the owner**: the wave curvature and corner-line
decoration on Home/Team/Account's hero cards are Claude's own approximation of the
brand language Codex described in prose — Codex's actual SVG source for the
login/register hero was never shared, only the rendered screenshots, so the curve
shape is not pixel-identical between the two auth screens and these 4. If Codex's
critique flags the wave shape specifically, that's expected and worth fixing with
real coordinates from Codex rather than guessed ones.

**Status: Account has its own locked structure as of round 7 — a coloured card
matrix (feature cards + utility cards + Sign out), not a list.** Read the round-7
AGENT_LOG.md entry before touching Account again: it covers the exact
`.account-grid`/`.account-feature-card`/`.account-utility-card` CSS, why Records now
replaces separate Deposit/Withdrawal History tiles, why Transaction PIN has no card
here anymore, and how the real Snow Beer bottle photos got their backgrounds removed
(`rembg`, confirmed working offline in this environment — see that entry before
assuming background removal isn't possible here). Home/My Products/Team are still
governed by the round-4/5/6 spec described above (Codex's original tokens/wave/
component system) and were not part of round 7's changes except the shared bottom-nav
icon/active-state update, which landed everywhere. Do not treat any of the 4 screens
as fully final until the owner confirms — still "still designing."

## Build/backend — not started

Nothing under `snow/` yet except this file, `AGENT_LOG.md`, and
`design/reference-bottles/`. When backend work starts, follow the SAME
three-part-split discipline space8 used (see `space8/CLAUDE.md` for the pattern):
backend logic reused/adapted from a proven base, admin panel reskinned not rebuilt,
user-facing frontend genuinely new. Do not assume space8's `server.js`/`db.js` can be
copied verbatim — the product ladder, rates, and nav structure above are all different
and need to be reflected in whatever backend gets built.

## Live infra (provisioning started 2026-08-26)

- **Firebase**: project `snow-beer-cbf65`. Client-side web config (safe to commit —
  a Firebase web `apiKey` is not a secret, access control is Security Rules/App Check,
  same reasoning space8 already uses for its own committed config in
  `user-src/index.html`/`admin-src/index.html`):
  ```js
  const firebaseConfig = {
    apiKey: "AIzaSyDhaVbSaQyYRdSiP1LLze-Apb6kNNTVCsc",
    authDomain: "snow-beer-cbf65.firebaseapp.com",
    projectId: "snow-beer-cbf65",
    storageBucket: "snow-beer-cbf65.firebasestorage.app",
    messagingSenderId: "171510439127",
    appId: "1:171510439127:web:94f15dd79aa057e3d32492",
    measurementId: "G-4S4ZES85SS"
  };
  ```
  Nothing consumes this yet — no frontend code exists under `snow/` beyond the design
  mockups. When the real user-facing app is built, this goes into its Firebase
  init script the same way space8's does. The Firebase **service-account JSON**
  (server-side, genuinely secret) has NOT been provided and must never go in this repo
  when it is — only into the backend host's env vars, exactly like space8's
  `FIREBASE_SERVICE_ACCOUNT` on Render.
- **MongoDB Atlas**: owner is creating a dedicated `snow` database user (same shared
  cluster/project space8 and choco-mcc already use, separated by database name — see
  space8's own equivalent note in `space8/CLAUDE.md`). Mid-setup as of 2026-08-26: the
  Atlas "Add New Database User" dialog was screenshotted with username `snow` filled
  in but **no role selected yet** — Atlas requires at least one Built-in Role or
  Specific Privilege before "Add User" actually saves. Next step: pick a role (e.g.
  `readWriteAnyDatabase`, matching the existing `chocomcc` user's own role in that
  project, or a tighter `readWrite` scoped to just the `snow` database) and click Add
  User. **The generated password was never recorded in this repo** — the resulting
  full `MONGODB_URI` connection string is a secret and must go straight into whatever
  hosting platform's env vars end up running Snow's backend, never into a commit, and
  ideally never pasted into chat again either.

## Secrets — NEVER commit

MongoDB URI and the Firebase service-account JSON are the two real secrets Snow will
need once backend work starts — both live ONLY in the hosting platform's env vars,
never in this repo. The Firebase web client config above is the one exception
(genuinely not secret) — don't confuse the two when handling future infra messages.
