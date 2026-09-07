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
- **Register has a confirm-login-password field** and a **6-digit Trade Password**
  (single field — `Register.dc.html` has no confirm for it, an earlier note here said
  otherwise and was wrong). Snow's registration has no confirm field and a 5-digit
  PIN. Referral code field is **required**, not optional/skippable.
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
- **Firebase project is `chipz-23a4c`** — the owner supplied the web config and it is
  stamped into BOTH `user-src/index.html` and `admin-src/index.html` (apiKey,
  authDomain, projectId, storageBucket, messagingSenderId, appId, measurementId).
  Snow's `snow-beer-cbf65` config is fully gone from both. This is the public client
  config only; the matching `FIREBASE_SERVICE_ACCOUNT` for the backend is a real
  secret and belongs in the host's env vars, never here.
- **All three services `autoDeploy: true`** (see `render.yaml`) — pushing to the branch
  redeploys `chipz-server`, `chipz-app` and `chipz-admin` on its own. Unlike Voltra,
  the owner does NOT hand-copy `server.js` anywhere; do not tell him to.
- **Backend is LIVE**: `https://chipz-server.onrender.com` (Render web service
  `chipz-server`, paid $7 instance so it never sleeps). `API_BASE` at the top of
  `user-src/original_module.js` and `SERVER` in `admin-src/index.html` both point at
  it. No `mylifeismyhappiness` (Snow's backend) reference survives anywhere.
- **MongoDB Atlas Flex**, cluster `cluster0.wblvntm.mongodb.net`, database **`chipz`**,
  user `chipz`. The cluster is SHARED with the owner's other apps, so the `/chipz`
  path segment in `MONGODB_URI` is load-bearing — `db.js` now refuses to boot without
  it rather than defaulting (see its own comment).
- Flex, unlike the M0 free tier, **does support real transactions**. `db.js`'s
  `runTransaction` is still Snow's fake (runs the fn, commits writes individually), and
  the money paths still rely on in-process locks + atomic `$inc`. That is correct and
  safe as-is; making deposits/withdrawals genuinely atomic is now *possible* and is a
  worthwhile follow-up, but must not be attempted casually — it is the money path.
- Payment-provider credentials (MarzPay/LipaPay) are still **not provisioned**, so no
  real money can move yet.

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

### Product photos: one 1600 x 900 (16:9) frame

`fileToFramedDataUrl()` in the admin panel cover-fits **every** product photo onto an
exact **1600 x 900** canvas before storing it, so the whole catalog is one shape.
Anything off-shape is centre-cropped rather than squashed or letterboxed. The app's card
frame (`.p-card .p-img`) and the skeleton (`.sk-pcard .sk-img`) are both
`aspect-ratio:16/9`, so the photo fills it exactly and nothing jumps on load.

**It was 4:3 (1200 x 900) first, and that was wrong.** The owner asked for 4:3
explicitly — *"on image frames please set 1200 x 900 px, 4:3 for all P1–P12"* — and then
sent his actual product artwork, **1721 x 914** (ratio 1.883, near enough 16:9), with
*"reduce on the size of cards their height is very high, just like you see that
resolution it should be that"*. The 4:3 frame was the cause of the height, measured on a
390 px viewport:

| | image | whole card | cards on screen |
|---|---|---|---|
| 4:3 | 264 px | 422 px | 2 |
| 16:9 | 198 px | 356 px | 3 |

His files cover-fit onto 16:9 losing about **2.8% off each side** — on a centred product
shot with margins that takes nothing. The remaining card height is the body (156 px:
88 px of stats, a 38 px CTA, 20 px padding); if he ever wants shorter still, that is
where it is, not the image.

The upload path before any of this was `fileToDataUrl(f, 640, 0.7)` — it caps only the
LONGEST side, so uploads arrived downscaled and re-compressed, and off-shape ones came
out some other shape entirely. **Capping a side cannot guarantee a frame**; that is the
whole reason `fileToFramedDataUrl()` exists.

One 1600 x 900 JPEG at quality 0.82 is roughly 140 KB as a data URL, so twelve is about
1.6 MB: fine against the 4 MB `bigJsonParser` limit on `/admin/products/save` (which
saves one product at a time) and the 2,800,000-char per-image cap in
`sanitizeProductInput()`, but close enough to localStorage's ~5 MB quota that
`saveCachedState()` retries with the photo bytes stripped if the full snapshot will not
fit — otherwise the instant-boot cache would silently stop being written.

`test-product-image-frame.py` feeds four shapes (his 1721x914, a true 16:9, a 4000x1000
banner, a 500x1500 portrait) through the real built admin bundle and checks all four
store as exactly 1600x900. `test-product-cards.py` measures the rendered card HEIGHT,
not just the ratio — the complaint was height, so that is what is pinned.

### A real bug: editing product-1 could silently spawn "product1"

Owner: *"when l save image for the product 1 after that what was product 2 changes
again to 1 and when l change it it changes product 1 again."*

The admin product editor's save handler ran its slug-building regex over
`(p.key || <new-product fields>)` **unconditionally**. For an existing product `p.key`
is already the real, validated key — "product-1" — but the regex
(`.replace(/[^a-z0-9]+/g,'')`) still stripped its hyphen, turning it into "product1".
That is a *different* key, so the save created a **second** document instead of
updating the first. The untouched "product-1" default kept existing side by side with
the new "product1", both named "Product-1". Whichever of the two happened to sort into
the next slot is what looked like "Product 2" — so editing "Product 2" kept landing back
on Product-1's data. This has existed since Chipz's product editor was forked from Snow,
so it likely fired every time any default product (`product-1`..`product-12`) was ever
individually edited and saved.

Fixed in `admin-src/index.html`: an existing key now passes through untouched —
`const key = p.key || (<slugify what was typed>)` — the slug logic only ever runs for a
genuinely new product (`p.key` falsy).

**The damage already done needs a one-time cleanup, which the fix alone cannot do** —
whatever got saved under a dehyphenated key is already sitting in the live database.
Admin → Products → **"Fix duplicate keys"** button calls `POST
/admin/products/fix-legacy-keys`, which finds every `DEFAULT_PRODUCTS` key with a hyphen
whose stripped form (`product1`, `product2`, ...) also exists as a saved doc — that
dehyphenated shape can only exist because of this bug, nothing else in the app ever
derives a key that way. Unambiguous cases (the correct hyphenated key was never
individually saved) are merged automatically. A genuine conflict — both the correct key
and the corrupted one were separately edited — is deliberately **left alone and reported
back**, rather than guessed at; picking a winner automatically could silently discard
whichever copy the owner actually wanted to keep. The owner needs to run this once from
the live admin panel after `server.js` redeploys.

`test-product-key-corruption.py` reproduces the original bug against the real built
admin (a two-product edit-and-save sequence, matching what the owner actually did),
proves the fix keeps four cards as four cards, and drives the migration route against a
store seeded exactly as the old bug would have left it — including a genuine conflict,
checked to survive untouched. `test-product-legacy-key-route.js` pins the route's own
matching logic and confirms every `DEFAULT_PRODUCTS` key actually has a hyphen (the
whole premise the route depends on).

### One payout number, resolved on the server (do not regress)

`productExpectedReturn()` in `server.js` is the ONLY place a product's total payout is
decided: **per-product `multiplier` → explicit `expectedReturn` → global
`returnMultiple` (default 30)**. `/public/products` runs every product through
`publicProductView()`, which resolves `expectedReturn`, `cycle` (`cycle || cycleDays`)
and `dailyPayout` (`round(expectedReturn / cycle)`) with exactly the figures
`/invest/create` will stamp on the investment and pay out.

**The client must never re-derive a payout.** `planFigures()` in
`user-src/original_module.js` is the single frontend reader (product card + buy-confirm
dialog); the admin product list uses `resolvedPayout()`, which mirrors the server rule
because `/admin/products` deliberately still returns RAW saved fields so the editor
round-trips what was typed.

This was a real, shipped mismatch: the card preferred a stored `expectedReturn` over the
multiplier and fell back to ×3; the buy-confirm dialog ignored the multiplier entirely
and fell back to ×30; the admin list printed the raw `expectedReturn`. Setting a
multiplier on a product that still carried an inherited `expectedReturn` made all three
quote **UGX 900,000** on a plan the server would credit **UGX 90,000** for.
`test-product-config.js` now pins app, admin and server to the same number on a matrix
of product shapes — run it after touching any of them.

Note the built-in `DEFAULT_PRODUCTS` ladder is Snow's inherited **×30 over 150 days**
(Product-1: 30,000 → 900,000). It is placeholder pricing, not a Chipz decision. Daily
cashback IS live in Chipz (unlike Voltra, where it is disabled): `settleInvestmentIfDue()`
credits `round(expectedReturn × daysDue / cycle) − paidOut` per elapsed day, telescoping
to exactly `expectedReturn` at maturity, so the "Daily" figure on the card is honest.

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

### Buttons: the live glow sweep

Owner: *"now let every button have a live glow sweep animation like it runs from left
to right"*, then corrected: *"bro, let it move from right to left."* **It runs
right-to-left** — the band enters at the right edge and exits left. A translucent band
travels across every **filled CTA** on a 2.8s loop —
`.primary-button`, `.secondary-button`, `.dark-button`, `.spin-cta`, `.notify-ok`,
`.btn-bind`, the Wallet Cancel, and the manual-pay confirm.

Deliberately **not** on `.navitem`, `.home-action`, `.icon-btn` or the close X: those are
transparent or 26–38px artwork, and a shine crossing them reads as flicker, not polish.
"Every button" means every button that looks like a button.

Mechanics that matter:
- The band is a `::after` moved with **transform only**, so the browser runs it on the
  compositor — no layout, no repaint, no per-frame main-thread work. These loop forever
  on cheap Android phones, so that is the difference between "premium" and "the app feels
  hot". `will-change` is deliberately **not** set: it would pin a layer per button for
  the life of the page, and a running transform is auto-promoted anyway.
- The button gets `overflow:hidden` + `position:relative` so the band is clipped to its
  own rounded box, and `pointer-events:none` on the band so it never eats a tap.
- It sweeps for the first 55% of the cycle and rests for the rest, so it reads as a
  repeating pass rather than a strobe.
- `--sweep` is the band's colour. Pale buttons (`.secondary-button`, `.btn-bind`, the
  Wallet Cancel) override it to a brand-tinted sheen — white on near-white shows nothing.
- Disabled buttons do not glow, and `prefers-reduced-motion:reduce` removes it entirely.

`test-button-glow.py` does **not** assert the CSS exists — a typo'd selector, a
pseudo-element clipped out of existence, or a keyframe name that never matches would all
pass a text search. It drives the built app and samples
`getComputedStyle(el,'::after').transform` over real time, confirming the X translation
actually changes and that FALLS outnumber rises (i.e. it runs right→left). Two traps it
hit while being written, both worth knowing: the sampling window **must span more than
one full 2.8s cycle** or it only ever sees the rest phase and reports the band as parked;
and `querySelector` grabs the first match in DOM order, which is often a button inside a
hidden screen whose pseudo-element reports `transform:none` — measure the first
**visible** one instead.

### The bottom nav: a persistent selector box, and an icon that fades on tap

These are **two separate things**, and getting them the wrong way round cost a round.
The owner's correction, verbatim: *"l said the icon fades in and out when tapped not
static and selector doesn't disappear."*

- **The BOX is the active-tab selector and it STAYS.** `.navitem.active::before` sits at
  full opacity for as long as that tab is selected; every other tab has none. It only
  eases in/out as the selection moves (a 0.2s transition). It is **not** a tap flash.
- **The ICON is what animates on tap.** `@keyframes navIconFade` takes
  `.navitem.nav-tap .nav-ic img` from opacity 1 → 0 → 1 with a slight scale, so a tap
  never looks static.

The first build had it backwards — a transient box that faded away, and a static icon —
which is exactly what the owner pushed back on. If this ever needs revisiting, that is
the distinction to hold onto.

Brand-tinted red rather than the reference's lavender, per the standing rule: copy the
shape from a reference, never another app's colours.

Two things that are easy to get wrong here:
- **The box has to sit BEHIND the icon**, and a positioned pseudo-element paints *above*
  its own element's content by default — so it would cover the very icon it belongs
  behind. `z-index:-1` is not the fix either: the nav bar's own white background would
  then hide it completely. The working answer is `.navitem .nav-ic, .navitem .lbl
  {position:relative;z-index:1}` with the box at `z-index:0`.
- **Re-adding a class that is already present does not restart a CSS animation**, so
  tapping the same tab twice would do nothing the second time. `hookNavTapBox()` removes
  the class, forces a reflow (`void btn.offsetWidth`), then re-adds it. Its `animationend`
  cleanup listens for `navIconFade` and clears the class off the `.navitem` **ancestor**,
  because the animation runs on the `<img>` inside it, so `e.target` is the image.

The listener is bound once on the **bar**, not on each of the six items — one listener
instead of six, and it survives any re-render of them. It uses `pointerdown` rather than
`click` so the icon reacts the instant a thumb lands. `updateNavIcons()` installs it
(that runs on every `showPage()`, so the bar is definitely in the DOM by then) and a
module flag makes every later call free.

`test-button-glow.py` pins both halves against the built app: every tab's box opacity
(exactly one at 1, the rest at 0, and still 1 well after any tap animation would have
finished), and the icon's opacity sampled through a real tap — 1 → 0 → 1, settling fully
visible, and replaying on a second tap of the same tab.

### The Account wallet balance: big, gradient, and auto-fitted

Owner: *"l told you that the number of account balance is large and UGX and colored in
the colour of site, so ours should be that orange"*, then, seeing it sitting flat above
the Deposit button: *"but has no gradient just like you see buttons, other side is conc
another is half conc."* So `.acct-profile .bal-value` is 44px / weight 700 and painted
with **`var(--chipz-grad)` — the identical gradient the buttons use** (deep red
`#e21b2a` into orange `#ff8a1f` at 135deg), clipped through the glyphs. The **whole**
figure carries it, the `UGX` as well as the digits (it is one text node; nothing inside
may override it). It was 34px in the ordinary ink colour, which is what made it read as
body text.

Two things make the gradient actually work, and both are easy to lose:
- **The box must hug the digits.** `background-clip:text` paints the gradient across the
  ELEMENT's box; on a full-width block, both ends of the ramp land on empty card and the
  digits only ever sample the middle. `width:fit-content;max-width:100%;margin:… auto`
  fixes it — and `max-width` is what keeps the overflow test below working, since the box
  is still capped at the card width.
- **It is wrapped in `@supports`**, because the fallback for a browser that can't clip to
  text is an *invisible balance*. The flat `color:var(--chipz-orange)` stays as the
  declared fallback and only a browser that can do the clip gets the gradient.
  `-webkit-text-fill-color:transparent` is the one WebKit honours.

The size cannot simply be hard-coded, because the figure's **length is not ours to
choose**: `UGX 5,000.00` and `UGX 240,000,000.00` (product-12's full payout, so a
reachable balance) differ by more than double in width, and past roughly seven digits
44px wraps onto a second line or spills out of the card on a 390px phone. A balance
broken across two lines reads as two numbers. So:

- CSS pins it to `white-space:nowrap`.
- `fitBalanceText(el, sample)` in `original_module.js` starts at `BAL_MAX_PX` (44) and
  steps down 1px at a time while `scrollWidth > clientWidth`, floor `BAL_MIN_PX` (22).
  An ordinary balance therefore still gets essentially the full size; only a very large
  one shrinks. It no-ops when `clientWidth` is 0 (page not laid out yet).
- Both writers of `#acctWallet` call it: `renderAccount()` right after it sets
  `pageHost.innerHTML`, and `animateBalanceEl(..., autoFit=true)` from
  `patchHomeBalances()`. The animated one fits against **whichever end of the count is
  the longer string**, so the figure can't briefly overflow mid-animation.

`test-balance-style.py` measures the RENDERED geometry (`scrollWidth` vs `clientWidth`,
box height vs one line-height, and left/right against the 390px viewport) at three real
balances rather than trusting the number in the stylesheet — which is how the wrap was
caught in the first place. Note when writing amounts for it: `fmtUGXCents` only appends
`.00`; it does **not** divide by 100, so `walletBalance` is already whole UGX.

It also proves the gradient **from pixels**, not from CSS: it screenshots the figure
itself, keeps only solid warm ink (`r>150 and r-b>80`, which discards the antialiasing
against the white card) and averages each end. A real ramp shows the green channel around
**56 on the left and 129 on the right**; a flat fill shows no spread, and an unsupported
clip shows no ink at all. A declared `background-image` proves only that it was declared —
`background-clip:text` on a box that doesn't hug its text renders flat while every
computed-style assertion still passes.

Contrast note: the orange end (`#ff8a1f`) is only **2.36:1** on the white card, under the
3:1 bar for large text — but the gradient's red end (`#e21b2a`) is 4.4:1, so the figure
now reads better than the flat orange did. If it ever needs to be legible end-to-end,
darkening the orange stop toward `#e0670a` (3.44:1) is the lever.

## Secrets — NEVER commit

Same rule as every sibling project in this repo: real secrets (Mongo URI, Firebase
service account, admin key, payment-provider keys) live ONLY in the hosting platform's
env vars once Chipz has its own live deploy — never in this repo, never in chat unless
truly necessary and immediately treated as compromised.

## Status

The screen-by-screen port to the `chipz-design/` mockups is **done** — every screen
in the mockup set is built in the real app and verified against the real obfuscated
build with Playwright (zero page errors).

Built and verified: Login, Sign Up, Loading, Home (topbar + banner + 4 action buttons
+ activity ticker + Hot/New product tabs + floating chest), Products (catalog),
My Products, Referral, Team, Account, Wallet, Balance Record (All/Deposit/Withdraw/
Turntable), Messages (inbox + detail sheet), Change Login Password, Change Trade
Password, Treasure Chest + win state, Notify dialog, Announcement, Deposit, Withdraw.

What was built beyond a pure port:
- **Messages backend** (`messages` + `messageReads` collections; `GET /messages`,
  `POST /messages/read`, and admin `list`/`save`/`delete`) plus a **Messages tab in
  the admin panel**. A built-in "welcome" message is served virtually until an admin
  writes a real one, and a deleted one leaves a tombstone so it stays gone.
- **Trade Password is now 6 digits** everywhere (was Snow's 5) — `pinCheck`,
  `/account/transaction-pin/change`, `/admin/user/reset-payout-pin`, registration,
  withdrawal, and every piece of copy. "Transaction PIN" is renamed "Trade Password"
  in user- and admin-facing text.
- **Auth email domain** is `@chipz-platform.com` (was `@snow-platform.com`).
- **Two new admin image slots** — the Referral page banner and the Account brand
  logo — behind one generic endpoint pair (`/public/chipz-images`,
  `/admin/chipz-image/set|clear`, `banners/chipz-<slot>` docs).
- **Owner's own PNG icon set shipped** in `user/`: `nav-*.png` (6 bottom-nav icons,
  greyscale-filtered when inactive), `act-*.png` (4 Home action icons), `set-*.png`
  (6 Account settings-row icons), `treasure-chest.png`. All downscaled; ~285 KB total.
- **Snow's snowflake mark is gone** — `chipzMarkHtml()` (a skewed CHIPZ wordmark on
  the brand gradient) replaces it wherever a compact logo is needed.
- Admin panel rebranded to "Chipz Admin" with the red accent (value-only `--gold*`
  token swap); PWA manifest + `sw.js` rebranded, cache bumped to `chipz-shell-v1`,
  and the new icons added to the precache SHELL list.
- Snow's old Records sheet was removed — Balance Record fully replaces it.

Known gaps / next up:
- **Turntable has no backend yet.** The Balance Record tab exists and renders empty;
  the daily-spin mechanic, its admin-set win amount, and the per-product extra-spin
  percentage still need building (see the Turntable bullet above for the spec).
- Product catalog is still placeholder ("Product-1".."Product-12") — the owner has
  not supplied real names/prices/images.
- **Payment providers not connected.** Everything else is live end to end (EdgeOne
  frontend -> Render backend -> Atlas `chipz` database), but no real deposit or
  withdrawal can complete until MarzPay/LipaPay keys are set in Render's env vars.

A note on how the Firebase config got missed the first time: the owner supplied it
mid-session with "now stamp in this config in admin and userpanel and start building",
and the mechanical `snow/` -> `chipz/` file copy silently carried Snow's config
forward over it. When the owner hands over config values, stamp them in immediately
and grep for the OLD values afterwards to prove nothing survived.

### CORS: the "Network error" that is not a network error

`CORS_ALLOWED_SUFFIXES` in `server.js` gates which frontend origins may call the
backend. An unlisted origin gets NO CORS headers, the browser blocks the response, and
the app shows its own generic **"Network error. Try again."** on a backend that is up
and healthy. **This has now bitten twice** — Snow when its custom domain went live, and
Chipz when the admin panel landed on `*.edgeone.dev` (only `.edgeone.app` and
`.edgeone.site` were listed). EdgeOne hands out `.edgeone.app`, `.edgeone.site` AND
`.edgeone.dev`; all three are listed now, plus `.onrender.com` and `.pages.dev`.

**Custom domains are admin-editable** — Settings → "Allowed website domains"
(`settings.allowedOrigins`, one host per line). They are **added to** the two built-in
lists and can never replace or remove them, which is the whole safety property: a typo
here cannot CORS-block the admin panel, which is the only place to undo it. Matching is
EXACT hostname (no wildcards, no suffixes) so `chipz-platform.com` never admits
`chipz-platform.com.evil.com`; `sanitizeAllowedOrigins()` rejects wildcards, bare TLDs
and single labels, naming the offending line. `_corsExtraHosts` is a synchronous
snapshot refreshed by `getSettings()` and immediately on save, because the CORS check
runs on every request and must never await a database read. `allowedOrigins` is stripped
from `/public/settings` — operator config, not app content.

**If any Chipz screen reports a network error while the server is fine, check this list
FIRST** — before suspecting the host, the database, or the deploy. `test-cors-origins.js`
covers the real domains and the suffix-spoofing attempts (`edgeone.dev.evil.com` must
NOT match).

### Signing up: the referral code, and the very first account

The owner's rule is that the Sign Up referral code is a **MUST**. Taken literally that
makes the platform unlaunchable — the first person has no code to type, and without them
nobody ever gets one (the owner's own question: *"how to create user account yet no
referral code???"*). So the requirement is **resolved from two things**:

`referralRequiredNow()` = `settings.requireReferralCode !== false` **AND**
`anyMemberExists()`. With zero registered members the code is optional (the founder
account); the moment the first registration commits, `_anyMemberExists` latches true and
every later sign-up must carry a code. A failed database read returns "required" rather
than handing out an unearned exemption.

Enforced in `completeRegistrationCore()` on the **server** — it used to be a client-side
check only (`original_module.js` hard-coded "always required"), which meant two bugs at
once: nobody could create the first account through the app, and a direct
`POST /register` with an empty code walked straight past the "must" and created an
uplineless account. `/public/settings` publishes the resolved answer as
`referralRequired`; `referralIsRequired()` in the app is the only reader and defaults to
required if settings never loaded. `loadAuthSettings()` fetches settings while the
member is still on the auth screen, because `boot()` only runs after sign-in.

Admin toggle: Settings → "Require a referral code to sign up" (`requireReferralCode`,
default ON). Only for onboarding someone with no upline; the founder case needs no
toggle.

Note `registerCurrentUser()`'s retry — which drops a bad code and registers without it
to avoid stranding a member whose Firebase account already exists — now only runs when a
code is **optional**. When required, the member is told to fix the code; retrying Sign Up
with the same number and password takes `doRegister()`'s `email-already-in-use` branch,
which signs them in and finishes the same registration.

### Home banner: uploaded video, or a link

`banners/home` holds `{ image, video, videoVersion }`, and there are now **two**
sources for the video. Exactly one is ever live — setting either clears the other, so
there is never a question of which one is playing.

**Uploaded file (preferred).** Owner: *"why can't we just upload video to database
instead of url."* `POST /admin/banner/video-upload` stores the bytes in their own
`banners/home-video` document (`{data, mime, bytes, version}`) and stamps `videoVersion`
on `banners/home`. MP4 or WebM, **4 MB max** — that cap is about members' data bills,
not Mongo (16 MB a document): the clip downloads onto every phone that opens the app.

The bytes are deliberately kept **out of `/public/banner`**, which is fetched on every
app start — inlining them there would re-send the whole clip on every boot, base64'd
33% larger, with no HTTP caching. They are served from **`/public/banner-video`**
instead, with an ETag, `Cache-Control: immutable` for a year, and the version in the
query string (a new upload is a new URL, so the long cache can never go stale). The
client builds that URL from `videoVersion`. **Byte-range support on that route is not
optional** — iOS Safari refuses to play video from a server that cannot serve ranges,
so without it the banner would work on Android and silently do nothing on iPhone.
`parseByteRange()` handles it and is unit-tested including suffix ranges (`bytes=-100`
means the LAST 100 bytes) and 416 cases.

**Linked file.** The owner drops `banner.mp4` into the upload beside `index.html` and
types the file name, or pastes an `https://` link. `sanitizeBannerVideoUrl()` accepts
relative paths and `https://` only — plain `http://` is rejected (mixed content would
be silently blocked), as are other schemes, `..` traversal, and a leading `//`
(protocol-relative to another host).

**YouTube links are refused, on both sides, with an explanation.** A YouTube URL in a
`<video>` tag loads an HTML page, not a video, so the banner sits blank with no error
anywhere — the owner hit exactly this. An embedded player is not the answer either: it
keeps YouTube's controls and end-screen, cannot be made non-tappable, and blocks
autoplay far more often than a plain file. `isYouTubeLink()` covers youtube.com,
youtu.be, m./music. subdomains and youtube-nocookie.com, and is tested against
lookalikes (`myyoutube.com`, `youtube-promo.mp4`) that must NOT be rejected.

**The player runs on its own and cannot be touched.** Owner: *"l dont want it to be
tappable or pause or play, l want it to go or run on its own."* So there is no play
ring (the mockup's, removed), no `controls`, and `pointer-events:none` on the video —
a tap on the banner passes straight through, and there is no long-press or
picture-in-picture menu. `autoplay muted loop playsinline` is the exact combination
phone browsers allow to start unprompted; `tryAutoplayHomeBanner()` installs one-time
retries on `visibilitychange`/`focus`/`pageshow` and on the first tap **anywhere** in
the app, for the cases a browser refuses the first attempt. A video that fails to load
falls back to the striped hero.

**The banner video is the app's ONLY cross-origin subresource, and that broke it.**
The owner uploaded a video and Home showed nothing. `server.js` sets
`Cross-Origin-Resource-Policy: same-site` globally (helmet), and
`chipz-app.onrender.com` / `chipz-server.onrender.com` *look* same-site but are not:
**onrender.com is on the Public Suffix List**, so every `*.onrender.com` is its own
registrable domain. A `<video src>` is a no-cors subresource load, so CORP gates it —
the browser dropped the response with `ERR_BLOCKED_BY_RESPONSE.NotSameSite`, the
`<video>` fired `error`, the app's own fallback swapped in the striped hero, and
nothing said why. API calls never showed it because **CORP does not gate CORS-mode
fetches**.

`/public/banner-video` now sets `Cross-Origin-Resource-Policy: cross-origin` for itself
only; the global `same-site` default stays, and is a real protection for the money
endpoints. `test-banner-video-corp.py` pins it, loading `localhost` → `127.0.0.1`
(different sites, same relationship as the two Render subdomains) with the headers
**parsed out of the real route**, and asserts both directions — that `cross-origin`
plays and that `same-site` really does block with `NotSameSite`, so the passing case
cannot go vacuous. Each case runs in its own browser context with its own `?v=`,
because the route's year-long `immutable` cache otherwise replays the first (allowed)
response and the blocked case silently "passes" — the first version of that test did
exactly that.

**Anything else this app ever loads directly from `chipz-server` (`<img src>`,
`<audio>`, a font, a `<script>`) will hit the same wall** and needs the same per-route
override. Everything else today is a data: URL inside JSON, which is why nothing else
has tripped it.

The service worker no longer intercepts cross-origin requests at all — it returns
without `respondWith`, handing them back to the browser. That is what
`respondWith(fetch(e.request))` was approximating anyway, minus a worker round-trip and
minus the worker relaying 206 range responses for media, which is a known source of
stalled video.

`fileToRawDataUrl()` in the admin panel falls back to the file EXTENSION when the
browser reports an empty `file.type` (some Android pickers do), and rewrites the
`application/octet-stream` prefix the FileReader then produces — otherwise a perfectly
good `.mp4` would be refused by the server's type gate.

**The loading screen waits for the video, and hands the element over.** Owner: *"make
when the start up loader must have loaded also the video before it waiting to load, so
video must show up after loader."* `bootFromNetwork()` awaits `preloadBannerVideo()`
after `_bootPromise` (which is what carries `/public/banner`, so the URL is known by
then) and before hiding `#loadingScreen`.

Warming the HTTP cache is **not enough on its own**: `paintHome()` builds a brand-new
`<video>`, so at the instant the loader goes that element is at `readyState 0` and still
has to go and read the file — the poster shows for a beat first, which is the exact gap
the owner was complaining about. `adoptPreloadedBannerVideo()` moves the already-decoded
element into the banner in place of the fresh node, copying every attribute off the node
it replaces so it can never drift from `homeBannerInnerHtml()`. Measured at the handoff:
`readyState 4`, playing.

Only a preload that reached `canplaythrough` is adopted (`_bannerPreloadOk`). Adopting a
FAILED one was a real bug caught by `test-banner-autoplay.py`: its `error` had already
fired while the element was detached, so `hb-video-failed` never got set and the striped
fallback never appeared. The inline `onerror` is null-guarded for the same reason.

The wait is capped at `BANNER_PRELOAD_MS` (10s) and the element is kept alive in a
module-level reference — a member on slow mobile data opens the app anyway while the
clip keeps buffering, and a GC'd detached `<video>` would abandon the very fetch being
waited on. An erroring video resolves immediately rather than burning the cap. The cost
is a first-open-after-upload one: the year-long immutable cache makes every later open
resolve from the phone.

`saveCachedState()` also keeps `homeBannerVideo` (the URL only — a poster data: URL
would eat the quota), so the instant-boot path paints the banner straight away instead
of leaving it blank until `/public/banner` returns. Because that path can therefore
paint a STALE video, `boot()` calls `refreshHomeBannerIfChanged()` — without it a
returning member would keep seeing the previous clip for the whole session after an
upload, since nothing else repaints Home.

The image doubles as the poster frame. `/admin/banner/set` patches only the keys sent;
`/admin/banner/clear?what=video` drops the link **and** the uploaded file.

Tests: `test-banner-video-url.js` (validator + YouTube), `test-banner-video-upload.js`
(size caps, accepted formats, byte ranges, cache headers, and that the bytes stay out
of the boot JSON), `test-banner-video-corp.py` (the cross-site block above), `test-banner-preload.py` (the video is decoded and playing at the exact tick the loader hides, measured with a MutationObserver on the #app hand-off -- NOT on the first `display:none`, which is the sign-in screen appearing and fires long before boot), `test-banner-autoplay.py` (drives the BUILT app against a real
MediaRecorder-generated webm under the browser's **default** autoplay policy: proves it
starts alone, keeps looping, has no button, and survives taps without pausing).

### Run this before every push
```
node build-core.js && node build-admin.js && python3 smoke-test.py
for t in test-*.js; do node $t >/dev/null && echo "OK   $t" || echo "FAIL $t"; done
for t in test-*.py; do python3 $t /tmp/out >/dev/null 2>&1 && echo "OK   $t" || echo "FAIL $t"; done
```
`smoke-test.py` boots the BUILT app in a real browser, walks every tab and sheet, and
fails on any page error, a stuck loading screen, or a bad `API_BASE`. It exists because
three separate still-used declarations (`NUMBER_FONT_STACKS`, `chipzMarkHtml`, `ICONS`,
and later `API_BASE`) were silently deleted along with neighbouring dead code in this
session. `node --check` passes on all of those and the obfuscated build round-trips
fine — the only symptom is the deployed app hanging forever on its loading screen.

Its `API_BASE` assertion was added after the first version of the test passed a build
whose every API call was broken: with `API_BASE` undefined, `fetch(API_BASE + path)`
silently requests `<origin>/undefined/account`, which 404s without throwing. **"No page
errors" is not the same as "reaching the server"** — assert on destinations, not just
on the absence of exceptions. Both failure modes are verified to trip the test.

### Testing notes (reusable)
Playwright verification runs against the **built** `user/index.html` served over
`http://127.0.0.1:8731`, with `service_workers="block"` on the browser context — the
service worker otherwise intercepts API calls before `page.route` sees them, which
looks exactly like a broken endpoint. Firebase's ESM modules are stubbed by routing
`https://www.gstatic.com/firebasejs/**/firebase-{app,auth}.js` to a tiny fake module
that reports an already-signed-in user.
