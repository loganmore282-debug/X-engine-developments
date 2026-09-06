# Chipz — Project Memory (read this first)

**What it is:** Chipz is a Uganda mobile-money **investment platform**, forked from the
sibling **Snow** project in this same repo to reuse its proven backend architecture and
money-safety patterns — **not a reskin of Snow's design**. Same category of app
(deposits/withdrawals via mobile money, tiered investment products, referral
commissions) but a genuinely different brand, visual design, and several structural
differences from Snow (see below). The owner's own words on how to treat this fork:
*"Snow but it should change designs, but we are still planning so app design have
changed but functions and logics are same as snow but make a different branch not to
refuse that of snow."*

**Brand inspiration**: bold Doritos-style red-to-orange gradient + black, on a warm
cream/paper background — condensed/bold typography (`'Playfair Display'` for headings/
numbers/wordmark, `'Barlow Condensed'` for body text), angular/triangle motifs. See
"Design tokens" below for exact values.

## Repo / branch

- Repo: `loganmore282-debug/x-engine-developments` — same multi-project repo as
  `snow/`, `space8/`, `voltra/`, `nexus/`. This project's code lives under **`chipz/`**,
  on its own dedicated branch: **`claude/chipz-platform-build`**.
- Never edit `snow/`, `space8/`, `voltra/`, or other sibling project folders from Chipz
  sessions.
- Forked from `snow/` via a plain file copy (not a git history fork) — `chipz/` starts
  as a byte-for-byte copy of Snow's backend/frontend/admin, then diverges from there.
  Snow's own `AGENT_LOG.md`/`CODEX_REVIEW_BRIEF.md`/`design/` folder (Snow Beer bottle
  reference photos, Snow-specific mockup sources) were deleted from the Chipz copy —
  irrelevant history/assets for this project. If you need to see how a Snow feature was
  originally built or reasoned about, read `snow/CLAUDE.md` (read-only reference, never
  edit it from a Chipz session).

## Where the design mockups live (read before touching any screen)

All Chipz-specific screen mockups (`.dc.html` design-canvas source files, rendered PNG
previews, and icon assets) live in the session scratchpad, NOT in this repo:
`chipz-design/` — `Main.dc.html` (Login), `Register.dc.html`, `Home.dc.html`,
`Account.dc.html`, `Deposit.dc.html`, `Withdraw.dc.html`, `Wallet.dc.html`,
`BalanceRecord.dc.html` (+ `BalanceRecordDeposit.dc.html`/`BalanceRecordWithdraw.dc.html`
tab variants), `Team.dc.html`, `Referral.dc.html`, `Messages.dc.html` (+
`MessagesList.dc.html`), `ChangePassword.dc.html` (Trade), `ChangeLoginPassword.dc.html`,
`Chest.dc.html`, `ChestSuccess.dc.html`, `Announcement.dc.html`, `Loading.dc.html`,
`Notify.dc.html`. These are the pixel-accurate reference for what the real frontend
build must match — when porting a screen from Snow's real markup into Chipz's real
`user-src/index.html`/`original_module.js`, use these mockups as ground truth for
layout/colors/copy, not Snow's own screen design.

**Design fidelity rule, hard-won this session**: when the owner sends a reference
screenshot, match it as literally as possible — exact icons (including real emoji
glyphs when the reference shows them, e.g. 🔒/🗝/🎁 on Login/Register — this
project does NOT follow Snow's/Voltra's "no emoji" rule), exact copy, exact field
order, exact button shapes/colors. Do not redesign, reorganize, or "improve" a
screen the owner has already spec'd via a real screenshot. Only recolor to the
Chipz red/orange/black palette when the reference uses a different brand's colors
(several references this session were literal screenshots of an unrelated existing
app in a purple/green theme) — never copy that other app's colors, but copy
everything else pixel-for-pixel.

## Structural differences from Snow (do not silently "fix" these back to Snow's way)

- **6-tab bottom nav**: Home, **Products** (separate tab), My Products, **Referral**,
  Team, Account — Snow has only 4 tabs (Home/My Products/Team/Account) and folds the
  catalog into Home with no separate Products tab. Referral tab sits between My
  Products and Team, holding the banner + Share URL/Copy Invite Link + Invitation
  Reward content (moved OUT of Team, which now only holds stats + member list).
- **Register has a confirm-password field** and a **6-digit Trade Password with its own
  confirm field** — Snow's registration has no confirm fields and a 5-digit single PIN.
  Referral code field is **required**, not optional/skippable.
- **Messages / notifications feature** — Chipz has a real inbox (list + detail popup),
  something Snow deliberately does NOT have (explicitly removed there by owner
  decision). Reuses Snow's dormant backend concept if one exists; otherwise build fresh.
- **Account screen is a plain LIST** (Download APP, Wallet, Balance Record, Messages,
  Login Password, Trade Password, Log Out) — Snow's Account is a colored card matrix.
- **Wallet = ONE bound account shown as a bank-card tile** (provider/chip/masked number/
  holder name, "Edit Wallet" reveals Provider/Account/Holder-Name fields + Cancel/Submit,
  plus a "Your Wallet" summary row) — not Snow's list-of-several-accounts model.
- **"Turntable"**: a daily spin-the-wheel bonus (like check-in), admin sets the win
  amount; also earns extra spins from buying VIP products 2–8, at an admin-set
  percentage of the product amount bought. Shows as a Balance Record tab alongside
  All/Deposit/Withdraw. Not present in Snow at all — needs real backend logic built,
  nothing to port.
- **Deposit uses "PAY A" / "PAY B"** terminology matching Snow's own Round 145
  architecture (2 independently-enableable payment methods, admin toggles which are
  live) — reuse that pattern directly, just confirm current field names against
  `snow/CLAUDE.md`'s Round 145 entry since it evolved over many rounds.
- **Login/Register field icons are real emoji** (🔒 password fields, 🗝 old-style key
  specifically for Trade Password — renders gold by default, 🎁 gift box for referral
  code) — a deliberate, explicit exception to the SVG-only icon convention used
  elsewhere in the app (nav icons, action buttons, etc. are still real image/SVG
  assets, not emoji).
- **Back button = bare gradient chevron** (cyan-to-blue linear gradient, no white
  circle backing), on every sub-page header. This is consistent across every mockup
  and must not be replaced with a circular icon-button style.
- **Generic alert/notify dialog**: white rounded card, centered with a dimmed
  backdrop, amber warning-triangle SVG icon, message text, single pill "OK" button
  (red/orange gradient) — used app-wide for validation errors, matching `Notify.dc.html`.
- **Treasure chest**: bottom-right floating/bouncing chest icon on Home (own
  `@keyframes chestBounce` in the mockup CSS — not yet wired as real animation in a
  built frontend). Tapping opens a key-entry screen (`Chest.dc.html`); a valid code
  triggers a green-flash full-screen success state with a "Congratulations! / You won
  UGX X / New Balance: UGX Y / COLLECT" card (`ChestSuccess.dc.html`).
- **Announcement dialog**: near-fullscreen white sheet (not a small centered card),
  bigger outlined-circle X top-right, "Welcome" header, admin banner, body copy,
  "Join Channel" button.

## Icon assets — licensing status (resolved)

All action-button icons, bottom-nav icons, Account-settings-row icons, and the
Referral nav icon used in the mockups were **self-made by the owner** (via prompted
AI generation) and are solely owned by them — no licensing concern for any of them.
The treasure chest artwork is also the owner's own AI-generated image, no watermark,
no licensing concern.

## Build & deploy pipeline

Same pipeline as Snow's (`snow/CLAUDE.md`'s own "Build & deploy" conventions carry over
directly — `build-core.js`/`build-admin.js` obfuscate `user-src/`/`admin-src/` into the
deployed `user/`/`admin/` folders exactly the same way). Key differences from Snow's own
setup:
- Service names: `chipz-server` / `chipz-app` / `chipz-admin` (in `render.yaml`).
- `package.json`'s `name` is `chipz-server`.
- Real app URLs, Firebase project, MongoDB database, and all payment-provider
  credentials are **not yet provisioned** — this fork is still in the "port + reskin"
  phase, no live deploy has happened yet. Do not assume any of Snow's own live infra
  (Firebase project `snow-beer-cbf65`, its MongoDB Atlas cluster, its MarzPay/LipaPay
  keys) carries over — Chipz needs its own, set up when the owner is ready to deploy.

## Product config (not yet finalized — do not invent real numbers)

The mockups show **generic placeholder product names** ("Product-1", "Product-12", etc.)
— Chipz has no confirmed product ladder (names/prices/returns) yet, unlike Snow's real
10-tier Snow Beer-themed ladder or Voltra's 7 named BESS products. When porting the
product-catalog backend logic from Snow, keep the pricing/duration/cashback FORMULA
(if the owner hasn't said otherwise) but use placeholder names/images until the owner
supplies real ones — never invent a themed product name unprompted.

All numbers that appeared in reference screenshots this session (withdrawal fee,
min/max amounts, withdrawal-hours window, min deposit, the 12 quick-amount deposit chip
values, commission rates like LV1=28%/LV2=1%/LV3=1%) are **admin-editable defaults, not
locked values** — the owner's own words: *"those numbers which appeared should be
edittable in admin panel."*

## Design tokens

```css
:root{--bg:#0b0b0c;--ink:#1a1310;--paper:#fbf1e8;--card:#ffffff;--muted:#8c7f76;
--line:#efe0d3;--red:#e21b2a;--orange:#ff8a1f;
--grad:linear-gradient(135deg,#e21b2a 0%,#ff8a1f 100%);--gold:#f4b400;
--r-xl:32px;--r-lg:22px;--r-md:16px;--r-sm:10px;
--shadow:0 22px 44px -26px rgba(40,10,4,.5);}
```
Fonts: `'Playfair Display'` (600;700;800) for headings/big numbers/wordmark;
`'Barlow Condensed'` for body/labels/inputs. "3D button" shelf effect on every primary
CTA/selected-pill/chip:
```css
box-shadow:0 5px 0 #9e0f1c,0 14px 22px -10px rgba(30,10,5,.5),
  inset 0 1px 0 rgba(255,255,255,.3);
transform:translateY(0);transition:transform .1s,box-shadow .1s;
/* :active */
transform:translateY(4px);
box-shadow:0 1px 0 #9e0f1c,0 4px 8px -6px rgba(30,10,5,.4),
  inset 0 1px 0 rgba(255,255,255,.3);
```

## Secrets — NEVER commit

Same rule as every sibling project in this repo: real secrets (Mongo URI, Firebase
service account, admin key, payment-provider keys) live ONLY in the hosting platform's
env vars once Chipz has its own live deploy — never in this repo, never in chat unless
truly necessary and immediately treated as compromised.

## Status as of this file's creation

Backend/frontend/admin have just been mechanically forked from `snow/` (file copy,
`node_modules` excluded, package/service names rebranded) onto this file's own commit.
**Nothing has been visually reskinned or structurally changed yet** — the real
`user-src/index.html`/`original_module.js`/`admin-src/index.html` still look and behave
exactly like Snow's own, product catalog still has Snow's real Snow Beer product
names/images, and no live infrastructure (Firebase/Mongo/payment providers) has been
provisioned. The screen-by-screen port to match the `chipz-design/` mockups is the next
phase of work.
