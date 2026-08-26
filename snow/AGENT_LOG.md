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

## 2026-08-26 — Claude — Round 9: Team screen full architecture rebuild (not a recolor)

Owner sent a new Team reference image plus a detailed 7-section Codex prompt requiring
the Team screen to be rebuilt to match Account's now-locked card language, not merely
recolored. Applied directly to `build.py`'s Team section.

**What changed:**
1. **Header** — replaced the old bell-included `top_bar()` call with a bespoke
   bell-less header matching Account's: snowflake + `BOTTLE_BADGE` (38px) + "SNOW"
   wordmark in `--snow-green`. Moved `BOTTLE_BADGE = f"{BOTTLES_REL}/01-qing-shuang-badge.png"`
   from partway through the Account section up to right after `BOTTLES_REL` near the
   top of the file, since Team's header now needs it too and Team's section runs
   before Account's in file execution order (this was caught and fixed before
   regenerating — the previous edit would have raised `NameError` on `python3 build.py`).
2. **Referral hero card** (new `.team-referral-card`) — wine gradient card (same
   `linear-gradient(145deg, var(--snow-wine), var(--snow-wine-deep))` as Account's
   identity banner) replacing the old straight-diagonal-line brand card: referral code
   at 30px mono bold with a circular copy-bubble beside it, an invite-link pill
   (chain-link icon + `snow-platform.com/r/...` + copy icon) below, and a full-width
   white pill "Share referral link" button at the bottom. Wave-lines top-right +
   a darker `soft_blob` bottom-left, matching Account's card decoration language.
3. **Commission strip** — 3 equal panels (Level 1 27% / Level 2 2% / Level 3 1%) as
   one `app-card` split into alternating wine-soft/green-soft backgrounds, each with
   a small circular icon tile (new `people2` icon) — replaces the old plain outlined
   6-tile grid.
4. **Team summary grid** (new `.team-summary-grid`) — Total team (38) and Active
   referrals (14) as two half-width soft-tinted stat tiles with icon+number, plus a
   full-width `.team-deposits-card` (green gradient, same treatment as the wine
   referral card) showing "Team deposits · UGX 3,140,000" in full numbers per house
   style (no "3.1M" abbreviation).
5. **Level switcher** (new `.team-level-switcher`) — pill-track segmented control
   (white active pill on a neutral-soft track), replacing the old `.segmented-control`.
6. **Member list** — rebuilt as an `app-card` with a "Level 1 members / 14 members"
   header row, then `.list-row` entries with alternating wine/green circular avatar
   bubbles (initials), phone numbers reformatted to `+256 700 *** 123` (masked,
   matching the reference image — the old format was `+2567****XXXX`), join-date
   caption, and an Active/Pending `.status-pill` on the right.
7. **Bottom nav** — unchanged shared `nav_bar("team")` call, so the round-7 pale-wine
   active-icon capsule applies here too, keeping Team visually unified with the other
   3 tabs.

New CSS: `.team-referral-card`, `.team-summary-grid`, `.team-deposits-card`,
`.team-level-switcher` + `.seg`/`.seg.active` (added after the `.utility-green`
rules). New icons: `people2` (two-person, for commission/team-size tiles), `link`
(chain-link, for the invite-link pill). New helper: `copy_bubble()` (circular
translucent copy-icon button, reused for both the referral code and invite link).

**Why:** Codex's spec was explicit this was an architecture rebuild, not a palette
swap — the old Team screen predated the Account card-matrix language entirely (flat
outlined tiles, a different referral-card style, an older phone-masking format) and
needed to be brought onto the same visual system now that Account is locked.

**Verification:** Fixed the `BOTTLE_BADGE` ordering bug first (moved the definition
above `BOTTLES_REL`'s first use), then ran `python3 build.py` (all 4 files regenerate
cleanly, no errors) and `python3 shot.py`. Visually inspected `Team.png` against all
7 of Codex's numbered requirements above — confirmed header matches Account's exactly
(same badge size, same wordmark color), referral card renders with correct gradient/
wave/blob/copy-bubble/share-button layout, commission strip and summary grid read as
a clear hierarchy leading into the green deposits card, level switcher matches the
pill-track style, member list shows correct alternating avatar tones and the new
phone format, and the bottom nav's Team icon shows the same pale-wine highlight
capsule Account uses for its own tab. Also compared side-by-side against `Account.png`
to confirm card radii, shadow weight, and color tokens are visually identical between
the two screens (same design system, not just similar).

**Files touched:** `snow/design/mockup-src/build.py`, `snow/design/mockup-src/Team.html`,
`snow/design/mockups/03-team.png`.

**Left open:** Home and My Products have not yet been through a Codex critique round
(only Account and now Team have). Per the owner's confirmed sequencing decision, those
are next before any conversion to a real single-page app begins.

---

## 2026-08-26 — Claude — Round 8: Codex's line-by-line correction of the round-7 Account screen; MongoDB/Firebase infra noted

Owner sent Codex's detailed correction pass on round 7's Account screenshot, plus two
infra items in the same message (a MongoDB Atlas "Add New Database User" screenshot
and a Firebase web config for a new project) — see the separate notes on those below,
kept out of this design entry.

**Applied all 7 of Codex's corrections directly to `build.py`:**
1. Header: bottle badge enlarged 28px → 38px tall (so it reads as a real bottle, not
   a tiny emoji-scale mark); "SNOW" wordmark recolored from black (`--snow-ink`) to
   `var(--snow-green)`.
2. Identity banner: swapped `01-qing-shuang-cutout.png` (bottle + the ice it stands
   on) for `01-qing-shuang-badge.png` (bottle only, transparent, no ice) — Codex's
   own reasoning: the ice read as a blue-ish strip and pushed the phone number onto 2
   lines. Sized to `height:104px` in this larger banner context (vs 38px in the tiny
   header). Phone number set to `white-space:nowrap;font-size:14.5px` (was 15.5px,
   no nowrap) so it can never wrap even with a longer number; banner's internal gap
   tightened 14px → 12px for extra headroom. `BOTTLE_CUTOUT` is no longer referenced
   anywhere in the file — only `BOTTLE_BADGE` is used across the whole Account screen
   now (header + banner both).
3. Feature cards (Withdrawal account / Records): icon bubbles gained a white
   translucent border (`1px solid rgba(255,255,255,.35)`) and their own soft shadow,
   plus a new darker translucent corner blob (`soft_blob`, the card's own `-deep`
   shade at bottom-right) layered underneath the existing top-right wave-lines, so
   neither card reads as a flat block. "Withdrawal account" — the longer of the two
   titles — was wrapping to 2 lines; fixed with `font-size:14px` (was 16),
   `letter-spacing:-.25px`, `white-space:nowrap`, and tighter card padding
   (`20px 16px` instead of a flat `20px`) — reads on one line now, matching Codex's
   "Withdrawal account stays on one line" requirement exactly.
4. **The 4 utility cards were restructured from vertical (icon-on-top, label-below,
   44px white circles) to horizontal (icon-left, label-right, vertically centered,
   62px SOLID gradient circles)** — the actual substance of this round's correction.
   New CSS: `.utility-wine`/`.utility-green` set a `linear-gradient(145deg, ...)`
   background + white icon color + drop shadow directly on `.account-icon-bubble`
   when nested inside one of those two wrapper classes, plus a faint matching
   `1px` border on the card itself (`rgba(148,24,39,.10)` wine /
   `rgba(47,107,71,.12)` green) for the "soft premium edge" Codex asked for. Labels
   now use each card's own `-deep` color (`--snow-wine-deep`/`--snow-green-deep`)
   instead of the flat `--snow-ink` every card used before. Each card kept its own
   decorative accent (soft blob for About Snow/Help Centre, a scaled-down 2-curve
   wave-lines accent for Rules & Terms/Install Snow) — unchanged in kind from round
   7, just recolored/repositioned now that the icon bubble is bigger and the layout
   direction flipped.
5. Sign out: promoted from a plain utility-card override to its own explicit
   `min-height:104px; border-radius:28px; padding:20px` (was implicitly inheriting
   the smaller 126px/26px utility-card defaults before), 62px solid wine icon bubble
   (via `utility-wine`, same mechanism as the other 4 cards), and a subtle wine
   `soft_blob` at the lower-right. Still reads "Sign out", never "Log Out".
6. Confirmed still true, no changes needed: no Transaction PIN card, no separate
   Deposit/Withdrawal History cards, Records alone represents all three, no blue or
   gold anywhere (the small blue inside the authentic bottle label itself is fine
   per Codex's own carve-out — that's the product photo, not UI chrome), bottom nav
   unchanged from round 7's global update.
7. One additional, unprompted but low-risk tightening: reduced `.account-utility-card`'s
   base padding from 18px to 16px to give the now-larger 62px bubble a little more
   room before the label wraps — labels still wrap to 2 lines for the longer ones
   (About Snow / Rules & Terms / Help Centre / Install Snow all wrap at this card
   width), which Codex's spec doesn't actually require to be single-line (only the
   "Withdrawal account" feature-card title had that explicit requirement) — left as
   a reasonable, spec-compliant trade-off rather than shrinking the 62px bubble
   Codex explicitly said to keep.

**Verification**: regenerated (`python3 build.py`, Playwright screenshot) and visually
inspected the result against every one of Codex's 7 numbered points — confirmed the
phone number is genuinely one line now, "Withdrawal account" is one line, all 4
utility cards read icon-left/label-right with solid gradient 62px circles and a
visible border, Sign out is visibly larger/more premium than a generic utility card,
and Home/My Products/Team render unaffected (only Account-scoped CSS/markup touched
this round).

---

### Infra notes (not a design change — recorded here since they arrived in the same message)

- **MongoDB Atlas**: owner is creating a dedicated `snow` database user (Atlas "Add
  New Database User" dialog, Password authentication). At the point they screenshotted
  it, **no role had been selected yet** ("Built-in Role — 0 SELECTED") — Atlas requires
  at least one role or privilege before "Add User" will actually save, so this needed
  one more step (e.g. a `readWrite`-scoped role on the `snow` database, or
  `readWriteAnyDatabase` to mirror the existing `chocomcc` user's own role visible in
  the same project) before the user is actually usable. **The generated password shown
  in that screenshot was NOT recorded anywhere in this repo** — per this project's
  standing secrets rule, it belongs only in whatever hosting platform's env vars end up
  running Snow's backend (once one exists), same as space8's `MONGODB_URI` on Render.
- **Firebase**: owner shared a fresh web client config for a new Firebase project,
  `snow-beer-cbf65`. Unlike the Mongo password, **this IS safe to keep in this repo** —
  a Firebase web `apiKey`/config object is not a secret (Firebase's real access control
  is Security Rules + App Check, not hiding this object); space8's own equivalent config
  is already committed in `user-src/index.html`/`admin-src/index.html` following the
  same reasoning. Recorded in `CLAUDE.md`'s infra section for when real frontend/backend
  work starts — nothing consumes it yet, since no app code exists under `snow/` beyond
  the design mockups.

---

## 2026-08-26 — Claude — Round 7: Account rebuilt as a coloured card matrix, per Codex's own mockup + written spec

Owner sent an image (an Account-screen mockup they and Codex had produced) plus a full
Codex prompt implementing it. The image and prompt are now the source of truth for
Account — implemented directly, not just described:

- **Account changed from plain outlined tiles + a divider-line list to a designed
  coloured card matrix** (`.account-grid` / `.account-feature-card` /
  `.account-utility-card` / `.account-icon-bubble`, exact CSS from Codex's spec). Two
  larger feature cards up top (full wine-red and full deep-bottle-green backgrounds,
  translucent icon bubble, white title + helper text, restrained corner wave-lines) —
  then a 2×2 row of smaller pale utility cards (About Snow / Rules & Terms / Help
  Centre / Install Snow — each with a colored icon-in-a-white-circle and a soft
  decorative blob or mini wave accent, never a plain white outline) — then one
  separate full-width Sign out card. No settings-list/divider-line container anywhere
  on this screen anymore.
- **Records now combines Deposit History and Withdrawal History into one card** —
  those two used to be separate tiles; there is now a single deep-green "Records"
  feature card, helper text exactly "Deposits · Withdrawals · Income" per Codex's
  wording. The combined Records screen itself (with All/Deposits/Withdrawals/Income
  filters) doesn't exist yet — no real navigation has been built for any of these
  screens — but the entry point is already consolidated to one card, matching where
  the destination is headed.
- **Transaction PIN tile removed from Account entirely** (per Codex: "Remove the
  'Transaction PIN' Account card completely") — this is a naming/entry-point removal
  only, not a reversal of the round-6 decision that Transaction PIN and the withdrawal
  PIN are the same one PIN system (see `CLAUDE.md`); managing that PIN just doesn't get
  its own card on this screen anymore.
- **Notification bell removed from Account's header** — Account no longer shares the
  generic `top_bar()` component (bell + wordmark) that My Products and Team still use;
  it now has its own bell-less header built specifically for this screen. My
  Products/Team were NOT touched this round and still show the bell — Codex's spec was
  explicitly scoped to the Account screen only.
- **Final names locked in**: "Help Centre" (was "Support"), "Install Snow" (was "Get
  App"), "Sign out" (was "Log Out", also no longer all-caps-styled/aggressive — a soft
  pale-wine card with one bold wine circular icon).
- **A real Snow Beer bottle photo now appears beside the green snowflake mark, in
  BOTH the header and the identity banner — not instead of it, alongside it**, per
  Codex's explicit correction ("Do not replace the Snow SVG with the bottle; both must
  appear together"). The source photo (`snow/design/reference-bottles/
  01-qing-shuang.jpg`) has a deep blue icy studio background behind the bottle, which
  Codex explicitly said must not show ("Do not show a blue photo background around the
  bottle. Crop/isolate the bottle cleanly"). A plain rectangular crop could not
  actually satisfy that — the bottle is an irregular shape inside a rectangular photo,
  so any rectangular crop tight enough to exclude the blue on the sides still leaves it
  above/below. Used `rembg` (already installed in this environment, confirmed working
  without any network access needed for the model it uses) to properly cut the bottle
  out with a transparent background instead — genuinely clean, not a crop trick. Two
  derived assets now live alongside the original photo in
  `snow/design/reference-bottles/`: `01-qing-shuang-cutout.png` (full bottle + the ice
  it's standing on, transparent background — used in the larger identity banner) and
  `01-qing-shuang-badge.png` (bottle only, ice trimmed off since it read as visual
  noise at the tiny header-logo size — used next to the snowflake+"SNOW" wordmark).
  Only tier 1's bottle has been cut out so far, since it's the only one this screen
  needed; the other 9 reference photos are untouched.
- **Bottom nav updated globally** (shared `nav_bar()`, so this landed on all 4 screens,
  not just Account — a consistent nav across screens matters more than scoping this one
  part narrowly): icons bumped to Codex's specified 2px stroke width, the Team icon
  redrawn as a clearer 3-circle group glyph (the old one read more like "2 people,
  one partial" than "team"), and the active item now shows a pale-wine rounded
  highlight capsule behind just the icon (was: plain color change with no highlight).

Also added `--snow-green-deep` (`#1F5136`, darkened from `--snow-green` by the same
ratio `--snow-wine` → `--snow-wine-deep` uses) for the Records card's gradient, and
updated `--snow-wine-soft`/`--snow-green-soft` to Codex's slightly revised hex values
this round (`#F8E9EC` / `#EAF4EC`, was `#F6E9EB` / `#EEF6F0`).

**Verification**: regenerated all 4 screens (`python3 build.py` then Playwright
screenshot) and visually inspected each rendered PNG — confirmed the card matrix
layout matches Codex's mockup image structurally (2 feature cards, 2×2 utility grid,
full-width sign-out), confirmed no blue is visible around either bottle photo,
confirmed Transaction PIN/bell/old list container are all genuinely gone (not just
hidden), confirmed My Products and Team render unchanged apart from the shared nav
update, and caught + fixed one real layout bug during this same pass: the Sign out
card initially rendered with its icon and text pinned to the right edge instead of the
left, because `.account-utility-card`'s base CSS defaults to
`justify-content:flex-end` for its normal (icon-on-top, label-below) column layout,
and switching just `flex-direction` to `row` for this one wide card without also
overriding `justify-content` inherited that flex-end alignment sideways. Fixed by
adding an explicit `justify-content:flex-start` override on that card only.

**Left open**: same as prior rounds — no real navigation/routing exists yet (Records'
combined-with-filters screen, Withdrawal Account, About/Rules/Help/Install destinations
are all still just card entry points, nothing behind them); feature-scope decisions
(OTP, statement export, auto-reinvest, KYC, referral leaderboard); check-in bonus, Task
Center ladders, gift-code format, withdrawal hours; no backend code started. New this
round: only 1 of 10 reference-bottle photos has a background-removed cutout — if a
future round needs bottle cutouts on Home/My Products cards too (currently those still
use the plain photo-with-background thumbnails from round 6), the same `rembg` approach
works, just needs running for the other 9.

---

## 2026-08-26 — Claude — Round 6: bigger left-side product image on Home; unified PIN naming; sent the full 6-screen set for the owner to hand to Codex

Owner: *"l want images to be on left,not small portion,so product image should be on
left,also transaction pin is same as withdrawal pin,we are still planning, and l
wanted you to send all screen images,such that l download them such l tell codex to
design, such that we tackle everything one by one,so as of now login and register
screens is done."*

1. **Home's product-card thumbnail enlarged into a real left-side image column**, not
   a small 56×56 icon. `.product-card` is now a flex row: the bottle photo fills a
   118px-wide column at full card height (`object-fit:cover`), the name/stats/CTA sit
   in a `.product-card__body` on the right. Scoped to Home's Investment Plans catalog
   only, per the owner's wording ("product image") — My Products' plan-card thumbnail
   (a much smaller "which plan is this" icon inside an already-dense progress card,
   not a browsing/catalog card) was deliberately left at its existing small size;
   flag if the owner actually wants that one enlarged too.
2. **Confirmed and documented a real product-logic fact, not just a label change**:
   there is only ONE PIN in Snow — the 5-digit "Transaction PIN" collected at
   registration (per Codex's auth spec) IS the withdrawal-authorization PIN, not a
   separate system the way some earlier Nexus/space8-lineage projects had. Renamed
   Account's "Security PIN" tile to "Transaction PIN" to keep the naming consistent
   with what the registration screen actually calls it, and added an explicit note to
   `CLAUDE.md` so backend work doesn't accidentally build two separate PIN fields when
   it starts.
3. **Sent the complete 6-screen set** (Login, Register — Codex's own, unchanged — plus
   Home, My Products, Team, Account) to the owner as downloadable images, per their
   explicit ask, so they can hand the full set to Codex themselves and iterate
   screen-by-screen outside this session. Login and Register are explicitly marked
   **done** by the owner — do not suggest changes to those two without being asked.

Regenerated `01-home.png` and `04-account.png` (the only 2 screens actually changed
this round) and overwrote them in `snow/design/mockups/`, along with the updated
`build.py`/`Home.html`/`Account.html` source. `MyProducts.html`/`Team.html`/their PNGs
are unchanged this round but were re-copied alongside for consistency (same generator
run).

**Verification**: visual inspection of the re-rendered Home and Account PNGs —
confirmed the bottle photo now reads as a real left-side image (not a small icon) on
every one of the 10 product cards, and the Account tile correctly reads "Transaction
PIN". No automated test suite exists yet — still a pure design/mockup phase.

**Left open**: same as prior rounds — Codex's next feedback pass (now working from the
owner's own downloaded copies, screen-by-screen, rather than a single batch prompt from
Claude); feature-scope decisions (OTP, statement export, auto-reinvest, KYC, referral
leaderboard); check-in bonus, Task Center ladders, gift-code format, withdrawal hours;
no backend code started.

---

## 2026-08-26 — Claude — Round 5: applied Codex's critique of the round-4 screenshots

Owner sent Codex's review of `01-home.png`–`04-account.png` against its own round-4
spec. All 7 points were concrete and actionable — implemented all of them directly in
`snow/design/mockup-src/build.py`, regenerated, re-screenshotted, and re-verified by
looking at the actual rendered PNGs (not just reasoning about the code) before
committing:

1. **One canonical wave system.** Replaced the old shallow wave path with Codex's
   exact curve (`M0 104 C58 68 104 61 154 83 C205 105 251 95 296 62 C332 36 362 23
   390 31 L390 126 L0 126 Z`, viewBox `0 0 390 126`) as `.brand-wave--full`, used only
   on Home's hero. Replaced the old 4 straight diagonal green lines with Codex's exact
   curved paths (two variants — top-right and lower-left — each 4 nested curves),
   using a new dedicated token `--snow-wave-on-wine: #8FE0AE` instead of the plain
   `--snow-green` those lines used before (the real bug from round 4: `--snow-green`
   at reduced opacity directly over the wine-red background blended into a muddy
   brown — Codex independently caught the same class of bug Claude had already fixed
   once for a different color pairing in the earlier amber/dark-wood rounds; the fix
   this time is the same idea, a dedicated on-wine token rather than reusing the
   general-purpose one).
2. **Don't force the wave into every red card.** Team's referral-code card and
   Account's identity card were `.brand-hero` (full wave treatment) — renamed to a new
   `.brand-card` class: same wine gradient + 28px radius, but no white wave, only the
   top-right curved green lines. Home keeps the full `.brand-hero--full` treatment
   with both corner-line sets.
3. **Full 10-product catalogue on Home.** Was hardcoded to 5 tiers (a leftover from
   round 1, never actually fixed across rounds 2–4) — added tiers 6–10 (SuperX, Marrs
   Green, Master Artisan, Opera Mask/Lianpu, "Li") with the confirmed figures from
   `CLAUDE.md`. Each product card now shows the REAL matching bottle photo from
   `snow/design/reference-bottles/01…10` as a 56×56px rounded thumbnail instead of a
   generic snowflake icon repeated on every card — makes each tier visually distinct
   instead of interchangeable. Product-card CTA moved from a right-side button
   (previously so cramped that `UGX 2,700,000`-scale totals wrapped awkwardly) to a
   full-width row below the stats grid, per Codex's exact CSS.
4. **Fixed a real cross-screen data-consistency bug.** Home's "Total Invested" showed
   `UGX 470,000` while My Products' 3 visible plans summed to `UGX 475,000` — same
   account, disagreeing numbers. Fixed Home to `475,000`. Also fixed both of My
   Products' own "earned so far" figures (subtitle + Total Earned tile), which showed
   `2,806,000` against 3 plan cards that actually sum to `2,016,000 + 2,698,000 +
   36,000 = 4,750,000` — a real arithmetic error in the original sample data, not just
   a rounding choice. Also updated Home's "Total Earned" tile to the same `4,750,000`
   even though Codex's critique only named the other two figures explicitly — same
   account, same money, and Codex's own stated principle ("financial mockup figures
   must never contradict the plan cards") applies to that pairing too; a low-risk,
   one-line extension of what was asked rather than scope creep.
5. **Centralized the token/component system.** Added `--snow-wine-soft`,
   `--snow-green-soft`, `--snow-neutral-soft` (replacing raw hex like `#F6E9EB`,
   `#F3F6F1`, `#F1EFEC` scattered through round-4's markup) and
   `--snow-radius-card/tile/control/sheet` (28/20/24/32px — replacing repeated
   `border-radius:18px` etc. overrides). Added the named component classes Codex
   asked for that round-4 was still missing: `top-bar`, `product-card` (+
   `product-card__stats`/`__cta`/`__thumb`), `plan-card`, `stat-tile`, `icon-tile`,
   `segmented-control` (+ `.seg`/`.seg.active`), `settings-list`, `list-row`.
   Deliberately did NOT invent a fake `bottom-sheet` or force a new `form-field` use
   just to exercise those classes — Codex explicitly said not to (`form-field` is
   already proven on the login/register screens, `secondary-button` on Home's
   Withdraw button; build `bottom-sheet` only when Deposit/Withdraw/Invest/Withdrawal
   Account actually need one).
6. **Confirmed already-correct, no changes needed**: token colors (no blue/amber/dark
   wood), Home's hero-to-white-cards balance, My Products staying a clean white
   data screen with no wine hero, Team/Account being the right place for compact wine
   cards, the bottom nav's active-state treatment, green used correctly for
   earnings/progress/pills/links.
7. **Real-app implementation notes, NOT applied to these static mockup files** (Codex
   was explicit that the 390px fixed wrapper is fine for screenshot generation but
   must not be copied into the actual production layout) — recorded here so they
   aren't lost before real frontend work starts: use a responsive `.app-shell`
   (`width:100%; max-width:480px; min-height:100dvh; margin:0 auto`), make
   `.bottom-nav` `position:sticky` with `padding-bottom:env(safe-area-inset-bottom)`,
   and generate referral links from the deployed origin at runtime rather than
   hardcoding `snow-platform.com` (the mockups still show that hardcoded string
   deliberately — it's illustrative sample data in a static screenshot, not
   something that needed fixing this round).

Regenerated all 4 screens (`python3 build.py` then Playwright screenshot) and
overwrote the committed PNGs at `snow/design/mockups/01-home.png` through
`04-account.png`, plus the editable HTML source and `build.py` itself.

**Verification**: visual inspection of each re-rendered PNG against every point in
Codex's critique, one by one — confirmed the wave now reads as one large asymmetric
curve matching the login/register screens' proportions, the wave-lines read as clear
green (not muddy brown) against the wine background, all 10 products render with
distinct real bottle thumbnails and full-width CTAs that no longer wrap, and the
Home/My Products financial figures now agree. No automated test suite exists yet —
still a pure design/mockup phase, no backend/frontend app code written.

**Left open**: same items as the round-4 entry below — Codex's NEXT round of
feedback (if any) on this revision hasn't come back yet; feature-scope decisions
(OTP, statement export, auto-reinvest, KYC, referral leaderboard); check-in bonus,
Task Center ladders, gift-code format, withdrawal hours; no backend code started.

---

## 2026-08-26 — Claude — Round 4: Codex designed login/register + a full written design system; Claude built Home/My Products/Team/Account against it, sent as PNGs for Codex critique

Owner sent 2 screenshots (Codex-designed login and registration screens) and a long,
detailed design-system spec Codex wrote alongside them, with the instruction: *"take it
exactly and we start designing the site."* Both are now the source of truth for Snow's
visual design — see `CLAUDE.md`'s Design status section for the full token/component
breakdown, not repeated here. Short version: **white/black/wine-red/green only** — this
supersedes and explicitly rules out all 3 of the prior Claude-only exploration rounds
(ice/blue, amber/gold beer-pour, dark wood-grain — see the entry below this one). Wine
red (`#941827`) is the strong branded color, bottle green (`#2F6B47`) supporting; a
green snowflake + white "SNOW" wordmark; signature wine-red hero with a white wave
curving into the content area and thin green parallel wave-lines in the hero corners;
28/26/24/32px radii across cards/inputs/buttons/sheets; named reusable component
classes (`brand-hero`, `brand-wave`, `wave-lines`, `app-card`, `form-field`,
`primary-button`, `secondary-button`, `status-pill`, `bottom-nav`, `bottom-sheet`).

The two reference screens are committed at `snow/design/mockups/00-login.png` and
`00-register.png` — treat these as pixel-final, Codex's own output, not something to
redraw.

**Built Home, My Products, Team, and Account directly against this spec** — not a
Claude redesign, a direct application of the same tokens/components to the other 3
tabs (plus the top bar, which the auth screens don't have an equivalent for). Rendered
as static PNG screenshots via Playwright rather than an interactive Claude Artifact
link, per the owner's explicit ask this round: *"can you send me photos instead of
artifacts of html."* Files: `snow/design/mockups/01-home.png` through
`04-account.png`; editable source at `snow/design/mockup-src/*.html` +
`build.py` (the Python generator that emits them — shared token/component definitions
live inside it, matching the CSS tokens above 1:1).

**Two real bugs caught and fixed before sending anything to the owner**: (1) the "SNOW"
wordmark on the plain white top bar of My Products/Team/Account was rendered in white
text — invisible against the white background, since the wordmark helper only had one
white-text variant meant for the wine-red hero. Fixed with an `on_dark` parameter so
the wordmark renders in ink-black on a white bar and white only when actually placed on
a wine-red surface. (2) the green (`#2F6B47`) wave-line decorations, drawn at reduced
opacity directly over the wine-red hero background, visually blended into a muddy brown
rather than reading as green — verified by inspecting the rendered screenshot, not just
assumed from the code. Fixed by using a brighter mint-green (`#8FE0AE`) specifically for
the wave-lines-over-wine case and raising their opacity from .55 to .8, which reads
clearly green against the dark red instead of blending.

**Known, disclosed limitation**: the wave curve and corner-line geometry on these 4
screens' hero cards are Claude's own approximation of the brand language Codex
described in prose (a "large smooth wave," "thin parallel wave lines") — Codex's actual
SVG source for the login/register hero curve was never shared, only the rendered
screenshots, so don't assume the curve shape is pixel-identical between the auth pair
and these 4. Flagged explicitly to the owner in chat.

**This round's push**: owner said *"just push images to repo and also send on that
critique complain in the prompt such that l give it"* — committed both the 2 Codex auth
screenshots and the 4 new Claude-built screens (plus their editable HTML source and the
generator script) to this branch, and drafted a critique-request prompt for Codex
(given to the owner in chat, not saved as a repo file — same pattern as the
color/theme-request prompt from the previous round).

**Verification**: visual-only inspection of each rendered PNG (no automated test
suite exists yet — no backend/frontend app code has been written, this is still purely
a design/mockup phase). Both real bugs above were caught by actually looking at the
rendered screenshots before sending them anywhere, not by reasoning about the CSS in
the abstract — worth remembering for any future icon/color work in this file: color
and contrast bugs on colored/gradient surfaces don't show up from reading source, only
from rendering it.

**Left open**:
- Codex's critique of `01-home.png`–`04-account.png` hasn't come back yet — do not
  treat these 4 as final.
- Everything listed as "left open" in the entry below this one is still open — nothing
  about backend, rates, or feature scope changed this round, only the visual system.

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
