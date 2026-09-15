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

### Brand assets: the installed-app icon and the link-preview card

Owner: *"make when l can upload app icon which will be appearing when downloaded, also
l want to upload link preview."* Admin → Settings → **App icon** and **Link preview**.

**Sizes:** app icon **1024 × 1024** square PNG (anything square works — the panel
renders it to the exact 512 and 192 Android asks for). Link preview **1200 × 630**.

These two are architecturally unlike every other admin image in the project, and the
difference is the whole design. Every other slot is fetched by the app's own JavaScript
as a data URL inside JSON. **These two are not read by our code at all** — Chrome reads
the icon out of `manifest.json` at install time, and the WhatsApp/Telegram/Facebook
crawler reads the `og:` tags out of the page `<head>`. Neither consumer can use a data
URI and neither runs a line of script, so both must be **real image files at fixed,
permanent URLs**:

- `GET /public/app-icon-512.png`, `/public/app-icon-192.png`, `/public/link-preview.jpg`
  serve raw bytes out of `banners/brand-<slot>` docs. **These paths are permanent** —
  they are hard-coded in `user/manifest.json` and in `index.html`'s head, so renaming one
  breaks the installed icon and every previously-shared link at once.
- **The same CORP trap the banner video hit applies here**, and it is the reason an icon
  would silently never appear: helmet sets `Cross-Origin-Resource-Policy: same-site`
  globally, `onrender.com` is on the Public Suffix List so chipz-app and chipz-server are
  separate *sites*, and a manifest icon is a no-cors subresource. Each route sets
  `cross-origin` explicitly.
- Cached `max-age=300, must-revalidate` with an ETag — **not** the video's immutable year.
  The video's URL carries a `?v=<version>` the client appends; a static manifest and
  static `og:` tags cannot, so the URL is fixed forever and the cache is the only thing
  that decides how long a stale icon survives.
- The icon falls back to the bundled `user/icon-512.png` / `icon-192.png` read off disk
  (chipz-server's rootDir is `chipz/`, so they sit right beside server.js). The manifest
  URL therefore always resolves, even before anything is uploaded and even if Mongo is
  down. The **link preview deliberately has no fallback** — an unset share card must show
  *no* picture, never a wrong one.
- `imageSize()` reads dimensions out of the PNG IHDR chunk / JPEG SOFn segment, no image
  library, and the routes refuse anything not *exactly* the target size. A wrong-sized
  icon is not an error anyone would ever be shown — just a permanently blurry home screen.
- One chosen file becomes **both** icon renditions in **one** request, and both are
  validated before either is written: writing the 512 then rejecting the 192 would leave
  two different logos live, which on Android shows as the icon changing between the
  launcher and the task switcher.
- `fileToSquarePng()` in the admin **contains** (never covers — a cropped icon loses the
  ends of a wordmark), exports **PNG** (a JPEG cannot hold transparency), and draws onto
  an unfilled canvas so a transparent logo stays transparent.
- **Rounded corners** (owner: *"but l wanted round corners of app icon please"*).
  `roundIconCorners()` cuts them into the PNG's **own alpha** with a `destination-in`
  composite — a launcher is handed the file, not our stylesheet, so a CSS `border-radius`
  on the panel preview would look right and change nothing on the phone. Radius is
  `ICON_CORNER_RADIUS = 0.22` of the side (iOS's squircle sits near 22.5%), taken as a
  *share* so the 192 and 512 stay the same icon. Path drawn with `arcTo`, not `roundRect`
  — a browser too old for `roundRect` would throw, and that reads as "the upload is
  broken", not "your browser is old".
- The link preview reuses `fileToFramedDataUrl(f,1200,630,.85)` — cover-fit, because a
  share card is artwork that should fill its frame.
- No `og:url` on purpose: a crawler falls back to the URL it fetched, so the card keeps
  working on any domain, where a hard-coded one goes stale the day a custom domain lands.

**Two caveats the panel states in its own copy, because they otherwise come back as bug
reports:** a phone that already installed the app **keeps its old icon** (Android copies
it at install time and never returns for it — reinstall to see a new one), and WhatsApp
/ Facebook **remember a preview they have already fetched** for an already-shared link
(appending anything, e.g. `?x=2`, forces a refetch).

Three tests cover this, and they split along what each can actually prove:
`test-brand-assets.js` pins the wiring *between* files that nothing else would catch
(manifest URL → a route that exists, `og:image` → the same, declared dimensions ==
enforced dimensions, panel field names == server field names) and then **runs the real
route handler** against a stub database for the headers, ETag/304 and the disk fallback;
`test-app-icon-resize.py` runs the real `fileToSquarePng()` in Chromium against generated
artwork and decodes the result — exact size, transparent padding, markers at the far
left/right of a 900 × 300 wordmark proving nothing was cropped, and the corner radius
measured **by area** (a rounded square of side S loses exactly `(4−π)r²`). Measure the
radius by walking the top row inward instead and you get a number about `√r` px short —
the arc crosses the pixel-centre line y=0.5 well inside the true corner — which read a
correct 113px radius as 102px and failed a correct implementation; `test-admin-brand-panel.py`
drives the **built** admin panel, because the source is obfuscated into `admin/index.html`
and grepping the deployed file proves nothing.

### Mission Center — REMOVED

Owner: *"remove mission center."* Gone from the client (Team button, sheet, both claim
flows, `STATE.mission`, the cached field) **and** from the server: `/mission/status`,
`/mission/salary/claim` and `/mission/deposit/claim` are deleted, not merely unlinked.
**Two of them credited money** — a removed feature whose payout endpoints stay reachable
still pays anyone who knows the URL; the client is not the access control. The
`MISSION_*` constants went with them.

Deliberately kept: the `mission_salary` / `mission_deposit_reward` entries in
`TX_TYPE_LABELS` (and the admin's copy of that map). Members who claimed these were
really paid, and their Records must keep reading properly — dropping the labels turns old
rows into raw type keys. `activeL1Count()` / `wholeTeamDeposits()` also stay: the **Task
Center**, a different feature that is NOT removed, uses both. Boot lost a
`/mission/status` call, so every launch is one round trip lighter.

### The Download APP screen

Owner: *"make when one taps download, it opens and middle there is a button download, and
in background there is image uploaded from admin panel."* Account → Download APP now
opens `openDownloadSheet()` instead of firing the browser install prompt directly.

- New admin slot **`downloadbg`** (Admin → Settings → *Download screen background*),
  portrait **1080 × 1920**, riding the existing `CHIPZ_IMAGE_SLOTS` / `/public/chipz-images`
  machinery. It resizes to 1600 on the long side, not the banners' 1280 — a portrait image
  capped at 1280 is only 720 wide and visibly soft full-bleed.
- The image is a real `<img class="dl-bg">`, not a CSS background, so a slow or broken one
  degrades to the brand gradient rather than a blank panel. A fixed dark scrim sits over
  it because the artwork is the owner's and could be pale, busy or white.
- **The BUTTON is what sits in the middle**, not the card containing it. Centring the
  whole block put the heading and blurb above the button and pushed it ~60px below the
  real centre; `.dl-body` is a `1fr auto 1fr` grid so the button itself is dead centre
  (verified at 422 vs 422 on a 390×844 viewport).
- It uses the ordinary sheet overlay, so the phone Back button closes it for free.

### The nav icon bounces; "Loading…" waves

Two animation corrections, both after the owner rejected an earlier attempt.

- **Nav icon (third pass).** *"the nav icons when tapped be live bounce in and out … it is
  like tapping something and bounces 1 in and out 1."* `@keyframes navIconBounce` scales
  .74 → 1.18 → settle, at **full opacity throughout**. The previous `navIconFade` is gone:
  he rejected the fade twice, and an icon that dims mid-press reads as a loading state.
  The overshoot past 1.0 is what makes it feel physical — without it this is a scale
  transition and the bounce is gone. `hookNavTapBox()`'s `animationend` listener matches
  on the keyframe NAME, so renaming the keyframe means renaming it there too.
- **Icon size, and `--nav-h`.** The owner has asked twice — *"nav icons are too small"*,
  then *"the nav icons are small also the treasure chest box at home screen is small"*.
  Icons are **38px** now (23 in the mockup → 30 → 38), and the **bar grew with them**
  rather than a bigger glyph being squeezed into the old 68px and clipping the label.
  The bar height is now the single token **`--nav-h:76px`**; four rules depend on it
  (`.wrap` bottom padding, `.sheet-bg` bottom inset, and the Download panel's two height
  calcs) and each used to repeat `68` as a literal. Change the one token, not five places.
  The treasure chest float went **64px → 86px** and the turntable float moved up to 212px
  so the taller chest doesn't run into it.
- **Selector width.** *"the nav tab is still small in width can you extend it abit."*
  The box went from a fixed `width:54px` + `left:50%` + `margin-left:-27px` to
  `left:3px;right:3px;max-width:62px;margin:0 auto` — as wide as the tab allows, capped.
  The inset-and-auto-margin form is not just tidier: centring by transform would **collide
  with `navBoxBounce`**, whose keyframes set `transform` to a bare `scale()` and would
  throw the translate away. `transform` now belongs entirely to the animation. Measures
  58px in a 64px tab on a 390px viewport (was 54).
- **The selector box bounces with it.** *"not only the nav icon bounces in and out but
  also the selector should do so."* `@keyframes navBoxBounce` on
  `.navitem.nav-tap.active::before`, same curve so the two read as one press, but gentler
  (.78/1.14 vs .74/1.18) — it is a 54×40 slab, not a 26px glyph, and the icon's numbers on
  that area read as a wobble. **Opacity is pinned at 1 in every keyframe**: this is the
  active-tab selector and it must never look like it is leaving (the earlier *"selector
  doesn't disappear"* correction). Its duration is **.42s against the icon's .46s on
  purpose** — the icon's `animationend` is what ends the tap, and removing `nav-tap` kills
  anything still running, so the box has to finish first or it gets cut off mid-bounce.
- **Loading text.** *"the letters on 'Loading...' and dots are in like wavy moving
  animations."* Each letter and each dot is its own `<i>` running `loadWave`, so motion
  travels along the word instead of the whole word bobbing as one block.
  `display:inline-block` is required — transform does nothing to an inline box.
  Second pass, against a reference screenshot: *"the wave should be slow and words spaced
  like that and 6 dots."* So **`Loading......` (six dots, 13 elements)**, `letter-spacing
  .24em`, and the ripple slowed to a **2s** cycle with a **95ms** step (was 1.15s / 55ms),
  taking 1.14s to cross the word. `letter-spacing` adds its gap *after* every character
  including the last, which hung a quarter-em off the right and pushed the word visibly
  off-centre — `.ls-text i:last-child{letter-spacing:0}` re-centres it. The reference's
  cream-and-purple palette was deliberately not copied; shape from the reference, colours
  from Chipz. Fourth pass: *"even loader animation word is small make it abit big"* —
  **25px**, up from 18px, and the wave's rise grew with it (9px → 12px), because the same
  travel against larger type reads as a weaker motion.

### Turntable spins: what makes them safe

Owner: *"make sure that spins are perfectly secure."* Audited, and three things changed.

**Already sound, and must stay that way:** `/turntable/spin` reads **nothing from the
request body** — the reward is decided entirely server-side, so a member cannot name their
own prize; it requires a token, refuses a banned account, refuses when the turntable is
off; a product spin's payout band is **snapshot onto the spin at grant time**, so retuning
a product cannot shrink spins already earned; the spin is burnt **before** the credit, and
handed back if the credit throws.

**Changed:**
1. **`Math.random()` → `crypto.randomInt()`** in `rollSpinReward()`. V8's `Math.random` is
   a seeded xorshift128+ whose internal state is recoverable from a run of outputs — and a
   member sees every one of their own spin results, which is exactly such a run. Exposure
   was bounded (nobody wins past `spinMax` either way), but a predictable generator should
   not be deciding payouts. Works in integer cents, matching `round2()`'s precision.
2. **The daily spin is now claimed atomically.** It was read `lastTurntableAt` → decide →
   write, guarded only by `withLock()` — which is an **in-process promise chain**, so it
   serialises taps inside ONE server process and nothing more. On two instances, two taps
   could each see the day free and each pay. It now uses `updateIf()` (one conditional
   Mongo write); only the request whose read matched wins, whichever process it came from.
   The earned-spin burn uses `updateIf({used:false})` for the same reason.
3. **`/turntable/spin` joined the strict per-user rate limiter** (60/min), next to
   `/checkin` and `/withdraw/request`. It had only the 400/min global cap.

**The GRANT path (spins earned by buying a product), audited separately.** Sound and
unchanged: the client sends only a product **key**, the server looks the product up and
re-reads it **live inside the purchase lock**, so no spin figure ever comes from the
request; the payout band is snapshot onto each spin; a grant failure is caught and logged
rather than thrown into a purchase the member has already paid for. Three things changed:

- **`MAX_SPINS_PER_PURCHASE = 20` is now one shared constant**, used by
  `sanitizeProductInput()` (refuse at save) **and** by `grantTurntableSpins()` (clamp at
  grant). The second is not redundant — it is the **loop bound**, and it reads a value out
  of the database. **Not every write to `products/` goes through the validator**: the
  legacy-key migration re-writes stored docs directly. A loop that writes a money document
  per iteration must not depend on the validator having been the only writer. The band is
  clamped to `MAX_MONEY_AMOUNT` at grant time for the same reason.
- **The grant is idempotent per purchase.** Each spin now records `investmentId`, and the
  grant returns early if spins already exist for that investment. Nothing calls it twice
  today — it is fire-and-forget from `/invest/create` — but a bonus that re-pays on a
  retry is exactly what a later caller adds by accident.
- `investmentId` also makes a spin **auditable**: it answers "where did this spin come
  from" for a member's account, which `productKey` alone could not.

`test-spin-and-withdraw.js` runs the real `rollSpinReward` 4,000 times (inside the band,
whole band reachable, mean centred, backwards/negative bands clamped) and pins the route's
properties. Note when lifting that function into a test: it now needs `crypto` **and**
`finiteMoney` in scope — `test-product-config.js` broke on exactly that.

### The withdrawal multiple is an admin setting

Owner: *"let the withdrawal multiple be set from admin, so default multiple should be
5000, ie one withdrawals 5000,10000,25000,30000,35000 like that."* New setting
**`withdrawMultiple`, default 5000**, range `[0, MAX_MONEY_AMOUNT]` — **0 turns the rule
off** entirely.

Enforced in `/withdraw/request` **after** the minimum check (so the more useful message
wins), reading the live setting rather than a constant, and the refusal names the two
nearest valid amounts. The app checks it too, but that is a **courtesy so the member sees
the rule before a round trip** — `/withdraw/request` is a plain authenticated POST and the
amount in its body is whatever the caller sent. Admin field: *Rates & limits → Withdrawal
multiple*.

### Tapping a product card acknowledges, and does nothing

Owner: *"when l tap on the product card it fades in then out, but no action just it is
animation but no action should be there on triggering buy."*

`hookProductCardTap()` — one delegated `pointerdown` on `#pageHost` (the catalog
re-renders whenever products load, so per-card handlers would need re-attaching).

**It is a bounce, not a fade.** The first version read the word "fades" literally and
dipped opacity to .62. Owner: *"you failed to understand, cozy when l tap it just cause
faint image instead of make product card bounce in or fade in and out minimumly."* He is
right about the reason, and it is worth keeping: fading a card does not read as the card
responding, it reads as the card briefly failing to draw. A press is physical, so the
acknowledgement has to be — the card gives under the finger and springs back.

`@keyframes cardTapBounce` uses the **same spring curve as the nav icon at a fraction of
its amplitude**: the nav glyph squashes to .74 and overshoots to 1.18, which suits a 30px
icon and would look like the screen lurching on a 360px card. Measured on a real phone
viewport: **3.1% in, 1.2% out**, settling at exactly 1. Nothing touches opacity, so it can
never go faint again — the test asserts that explicitly.

The card has **no `onclick`, and the handler bails the moment the tap came from a
`button, a, input, select, textarea`** — so Buy Now is untouched and the acknowledgement
can never be confused with a purchase. `test-round-fixes.py` proves the negative properly:
it wraps `window.fetch`, taps the card, and asserts **no purchase call was made and no
sheet opened** — not merely that something animated.

**Two traps this block has already hit.** The class is removed by an `animationend`
listener that matches on the *keyframes name*, so renaming the animation without updating
that string leaves the class stuck: the first tap animates and every tap afterwards does
nothing, silently. The test now taps **twice** for exactly that reason. And the old
assertions measured the opacity dip — the behaviour being removed — so they failed when it
changed, which is correct; they were rewritten to read `scaleX` out of the computed
transform matrix rather than to trust a class name.

### The type scale is bigger than it looks in a mockup file

Owner, with his purple mockups next to the live build: *"as you see in my mock ups
everything is abit big but see yours, your cards your digits your deposit withdrawal
buttons and others, small tiny words, cards buttons and numbers."* He was right; the
whole app was drawn a size or two down from the mockups. Roughly a **+20% uplift** across
Balance Record, Account and Deposit:

| | was | now |
|---|---|---|
| Balance Record band figure | 30px | **40px** |
| Records tabs (All/Deposit/…) | 13px | **16px** |
| Record row title / amount | 14 / 15px | **16.5 / 16.5px** |
| Record row avatar | 38px | **44px** |
| Settings row title / sub | 15 / 12px | **17.5 / 14px** |
| Settings row icon tile | 42 / 30px | **52 / 38px** |
| Section heads (SETTINGS, Select Amount) | 19 / 14px | **22 / 17px** |
| Account ID / phone | 16 / 14px | **20 / 16px** |
| Deposit & Withdraw buttons | 50px / 15px | **58px / 17px** |
| Quick-amount chips | 15px, pad 13 | **17px, pad 17** |
| Sheet & page titles | 20px | **23px** |
| Form labels / inputs | 13 / 15px | **15 / 17px** |

**The trap:** bumping type alone broke the Balance Record rows. A bigger amount
(`+UGX30,000.00` at 18px bold) widened the right-hand column enough to squeeze the title
and the timestamp onto **two lines each** — "Welcome Bonus" wrapped, and a date split
across two lines reads as two dates. Fixed by giving the text column its width back
rather than by shrinking the type back down: tighter card gutter (18 → 14px), gap 14 → 11,
avatar 46 → 44, amount 18 → 16.5, and `white-space:nowrap` on both the timestamp and the
amount. **Check the widest row, not just the font size** — this is a three-column row and
the columns compete.

### Product & plan figures, and the plan counters

Owner: *"what about numbers, on the products values and other words they are small also
remove counter showing number of plans, it is in userpanel so remove it."*

Second uplift, on the two product screens: catalog card name 16 → 19px, its stat labels
9 → 10.5 and **values 13 → 16px**, Buy Now 38 → 44px tall / 14 → 16px; My Products band
figure 32 → 38, its sub-lines 11/12.5/15 → 13/14.5/17, plan row name 14.5 → 17, meta
12 → 14, thumb 38 → 46, day counters 11.5 → 13.5, and the Running/Matured/All chips
12.5 → 15px on a 34 → 42px control.

**Two counters, both gone.** There were two things showing a plan count and he did not
say which: the `<i>3</i>` badges on the My Products filter chips, and a literal
**"4 plans"** beside the *Products* page title. Both removed — along with the `.mp-f i`
rules that styled the badge, and the **skeleton placeholder** that stood in for the "4
plans" label while loading (leaving that behind would reflow the header the moment the
real content painted). `counts` is still computed: the empty-state copy uses it.

**The conflict worth knowing about:** the bigger figures pushed the catalog card back over
the height ceiling an earlier round set — *"reduce on the size of cards their height is
very high"*, pinned by `test-product-cards.py` at **card < 380px with three visible**. Both
asks can hold at once, but only by taking the height out of the PADDING, not the type:
body 13 → 10, stat padding 10 → 8, stats gap/margin 7/12 → 6/9, CTA 46 → 44. Lands at
**375px, three cards visible**. If a later round grows this type again, trim spacing —
don't shrink the numbers back.

### Login / Sign Up backdrops (2 images + opacity + blur)

Owner: *"make when l can put background image on those screens of login tab and
registration tab, make when l can set their opusity and blur … 2 different images so one
image will appear on login and registration tabs, and 1 will appear on space where orange
color is shared."* Admin → Settings → **Login & Sign Up screen**.

Two `CHIPZ_IMAGE_SLOTS`: **`authhero`** (the orange band, ~1200 × 700) and **`authcard`**
(the white form panel, ~900 × 1200). **One pair covers BOTH tabs**, not one pair per tab —
the two screens share the same hero and the same card, so per-tab images would make the
background jump as a member switches between Log In and Sign Up. Four settings ride the
existing `SETTINGS_CRITICAL_RANGES` validation: `authHeroOpacity`/`authCardOpacity`
(0–100) and `authHeroBlur`/`authCardBlur` (0–40 px).

- **Opacity is stored as a PERCENT, not a 0–1 fraction.** `/admin/settings/update` runs
  `Math.round()` over every ranged number, which would flatten `0.45` to `0`. It is
  divided once, client-side, in `applyAuthBackgrounds()`.
- Each backdrop is a **child element**, not a `background-image` on the section itself.
  That is what makes opacity useful: the child paints *over* the brand gradient (or the
  white card), so fading it blends the photo toward the brand colour rather than toward
  nothing. Fading the section itself would take the wordmark and the form fields with it.
- **The negative inset is load-bearing.** `filter:blur()` feathers an element's own edges,
  so a backdrop that exactly filled its box shows a soft transparent rim once blurred.
  `inset:calc(-2 * var(--auth-bg-blur))` pushes that rim outside the clip — which is why
  both sections need `overflow:hidden` (added to `.auth-card`).
- Applied as CSS custom properties on `:root`, not inline styles: the auth screen is
  static markup in `index.html` that the module never re-renders, so there is nothing to
  re-apply them to after a repaint.
- **The trap that actually bit:** `.auth-card > *{position:relative}` and `.auth-bg`
  have the *same* specificity, and the former comes later in the sheet — so it won the
  cascade and collapsed the card backdrop to a 0×0 relatively-positioned span. It rendered
  as nothing at all while **every computed-style assertion still passed**. The fix restores
  `position:absolute` explicitly on `.auth-card > #authCardBg`, and the test now measures
  the element's real box.

**No dead strip under the card.** Owner: *"there is a white space down the login screen,
why is it there?"* The hero is a fixed 280px and the card was only as tall as its own
fields, so on any screen taller than the two together the page canvas showed through as a
pale strip — worst on **Log In**, which has three fewer fields than Sign Up.
`#authScreen > .wrap` is now a flex column with `.auth-card{flex:1 0 auto}`, so the card
takes the slack and runs to the bottom. Height is **`100dvh` where supported**, not
`100vh`: on a phone `100vh` is the viewport with the address bar *hidden*, so on first
paint it overshoots and trades the gap for a scrollbar. The test asserts both — zero gap
**and** zero overflow — because closing the gap by overshooting is the obvious wrong fix.

`test-auth-backgrounds.py` renders the signed-out screen with a **blue** hero image and a
**green** card image — flatly different colours, so "which image landed where" is answered
from pixels rather than markup, and a swapped pair cannot pass. It takes the **median** of
each section's real bounding box (median, not mean: the card is mostly backdrop with dark
text over it). Card median comes back `(191, 241, 191)` — exactly 25% green over white. It
also checks the backdrops sit *behind* the content, because a z-index mistake there does
not look like a styling bug, it looks like the login form has stopped working.

### Balance Record counts up from zero

Owner: *"when one taps balance records l need a live animation of balancing increase from
0 to that current amount the user has."* `countUpEl(el, to, fmt, ms)` in
`original_module.js`, called from `openBalanceRecordSheet()`.

Distinct from `animateBalanceEl()`, which corrects a *stale* figure to a fresh one and
only moves when the two differ. This always starts at zero and always runs — it fires on
an OPEN, so it is the entrance the screen makes, not a data correction.

- The band is **rendered as `fmtUGX2(0)`** and counted up after the sheet is in the DOM.
  Rendering the real figure and then resetting to zero would flash the true balance for a
  frame before the count began.
- `requestAnimationFrame`, not `setInterval`: the count is tied to real frames, so it
  takes the same 1.1s on a slow phone instead of running long wherever timers throttle.
- A `_countToken` on the element guards against two counts racing — reopening the sheet
  mid-animation starts a second one, and without it the first keeps writing and lands on
  a stale figure.
- A zero balance, or `prefers-reduced-motion`, skips straight to the value; counting 0 up
  to 0 is a second of watching a number that was never going to move.

`test-round-fixes.py` samples the band every frame through a real open: starts at 0, ends
at the true balance, and **68 distinct figures in between** — a straight jump from 0 to the
total would satisfy the first two checks on its own.

Note while you are in here: `fmtUGX2()` renders **`UGX520,782.00` with no space**, unlike
`fmtUGX()`'s `UGX 520,782.00`. It is pre-existing, and it is used by the whole Balance
Record screen (band and every row), so changing it is a screen-wide decision, not a
one-line fix. Not changed unasked.

**Measuring the loading wave is a trap.** During real boot the main thread is busy
inflating and running the ~265KB core, so no frames are produced and
`document.timeline.currentTime` stays at **0** — every letter reads as untransformed and a
perfectly good wave measures as motionless. `test-round-fixes.py` therefore re-shows
`#loadingScreen` *after* boot and samples it with the thread idle.

### Copy invite link copies

Owner: *"copying invite link just copys not sharing."* The button labelled **COPY INVITE
LINK** was calling `shareReferral()`, which opened the phone's share sheet. It now goes
through `copyText()` like the small copy icon above it, and `shareReferral()` is deleted.

It was also broken in a way the label hid: the button called `shareReferral()` **with no
argument**, so the shared message read `...sign up with my link: undefined`. Nothing
inside the app would have shown this — the wrong text only appeared after it had been
sent to someone.

### No Snow branding reaches a member

Chipz is a fork of **Snow**, so inherited wording is not hypothetical. Found and fixed
(owner: *"it could be better if you remove old images of previews of Snow, remove them"*):

- **The referral share text** read `Join Snow and start earning` — the single most
  widely-seen sentence the app produces, since it is what every member's own WhatsApp
  invite carries. Every referral anyone had ever sent invited people to a different
  product.
- **The About sheet** was titled `About Snow`.
- Two admin toasts offered to revert the manual-pay marks to *"the snowflake mark"*.

`test-no-snow-branding.js` is the standing guard. It scans the four sources with
comments stripped (block, line **and HTML** — an unstripped `<!-- ... -->` was the first
thing it flagged) and **deliberately allows** three inherited internal names: the
`--snow-*` CSS design tokens (a documented value-only swap; the app reskins by changing
what they hold), the `snow_*` storage keys, and the `snow-auth` event. It asserts those
carve-outs still exist, so they get deleted rather than left looking protective if the
names ever change.

**Where the shipped wording is checked, and why not there:** the obfuscator replaces every
string literal with a lookup into an encoded string array, so `Join Chipz` is not present
as text at *any* layer of `user/index.html`. A first attempt grepped the inflated payload
for it; the assertion that mattered (`no "Join Snow" left`) then passed **vacuously**
against an empty string. The node test now only proves the payload inflates and that its
literals *are* encoded — so nobody re-adds a grep there. The real check lives at the end
of **`test-nav-sheets.py`**, which stubs `navigator.share`, calls the built bundle's own
`shareReferral()` and reads what it would have sent. That also catches a source fixed but
never rebuilt.

### The app's name is one admin setting

Owner: *"l would like to also to edit the app name chipz, so make it when it can be
editable everywhere."* `brandName` is a real field in `DEFAULT_SETTINGS` (default
`'Chipz'`), edited at **Admin → Settings → App name**, capped at 24 characters, rejected
if blank or containing `<`/`>`. Nothing spells the name out by hand any more:

- **Client**: `brandName()` reads it, `brandWordmarkHtml()` renders the CHIP+**Z**
  treatment as a *rule* (all but the last letter, then the last letter in the accent),
  `brandTextMark()` is the Account badge, `chipzMarkHtml()` is the gradient square.
  `applyBrandName()` fills `[data-brandmark]` in `index.html`'s static markup (loading
  screen, auth header, announcement placeholder) and sets `document.title`. It is called
  at **all three** places `STATE.settings` gets filled — `boot()`, `loadAuthSettings()`,
  and the cached instant-boot path — because whichever wins the race must be the one
  that applies it.
- **Server**: `brandName(s)` backs the maintenance message, the opening-countdown
  message, the default welcome inbox message, and the description on a new admin credit.
  Ledger rows already written keep their old wording, which is correct for a record.
- **Admin panel**: `applyAdminBrandName()` renames the topbar and the tab title; it is
  called from `openShell()` (not only `renderSettings()`, or an admin who never opens
  Settings would sit under the old name).

**Two places a rename does NOT reach without a frontend redeploy**, and the admin panel
says so in plain words: `manifest.json`'s `name` (what Android prints under the installed
icon) and the `og:`/`twitter:` title (what a pasted link shows). Both are read out of the
static file by Chrome at install time and by link crawlers — neither runs a line of app
code. Serving the manifest from the backend is not a fix: `start_url`/`scope` resolve
relative to the manifest's own origin, so a cross-origin manifest breaks installation
outright.

Sizing is derived from the name's length in both marks (`px / (0.68 * len)` for the
gradient square, `95 / len` clamped to 9–19px for the round badge) — at a fixed size a
longer name simply ran past the shape it sits in. The two `onerror=""` fallbacks on the
Account profile call `brandTextMark()` rather than interpolating the name into the
attribute: an inline handler is HTML-decoded *then* compiled as JS, so an apostrophe in
an owner-typed name would have ended the string early and broken the whole handler.

`test-home-gif-and-name.py` boots the built app four times — renamed, never-set, with and
without the GIF — and reads the wordmark, its accent letter's computed colour, the tab
title, the loading-screen mark, the Account badge and the About sheet title.

### Home's idle strip carries the profile GIF

Owner: *"bro this white space is idle we need to put the gif which is in profile also to
show up here … it should appear there I middle too."* The same `profilegif` slot feeds
`homeGifHtml()`, rendered after the spin banner. With nothing uploaded it renders **the
empty string** — no placeholder box, so Home looks exactly as it does today until the
owner uploads one.

Two things were measured rather than guessed:

- **Horizontal centre.** The treasure chest is `position:fixed` over the bottom-right,
  so centring in the full width put the mark half underneath it. The strip's right
  padding is the chest's own column (96px), which centres it in the width that is
  actually free — and that is what reads as centred on the phone.
- **Height.** A CSS `max-height: 20vh` cap was wrong by construction: how much room is
  left is the phone's height minus a fixed stack of content, so on 390×844 it overshot by
  23px and put a scrollbar on a Home screen that had never had one. `fitHomeGif()` reads
  `scrollHeight - clientHeight` after the image loads and takes exactly that much off
  (60px floor). It runs on the image's own `load` (at paint time there is no intrinsic
  size to measure) and on `resize`. **The test caught this** — the vh version passed
  every other assertion.

The strip is `pointer-events:none` so it can never swallow a tap meant for the chest.

### Messages: a blurred tinted backdrop, and a sheet that actually slides

Owner: *"you can see blurry green, and message doesn't slide from down… the mock up has a
very clean css, high quality and definition."*

Measured off the two screenshots at matched width, both halves were real:

**The backdrop was the opposite operation, not a shade off.** His reads
`rgb(163,218,186)` — **luminance 189**, a *light* tinted wash with the list visibly
blurred behind it. Ours read `rgb(134,125,118)` — **luminance 126**: a flat grey-brown
dim, no blur, no hue. His *lifts and tints* the page; ours dropped a dirty sheet over it.
That is why "make it lighter" would never have got there. Now
`backdrop-filter: blur(14px) saturate(1.15)` plus a warm `rgba(238,112,34,.42)`, tuned by
measuring the **rendered** result until it landed at luminance **190** against his 189 —
the tint and the blur composite, so only the result is comparable.

**The tint is the brand's warm one, not his green.** His mockups are drawn in a
purple/green theme; a green wash is right in that app and would be the only green surface
in this one. The effect is his, the hue is Chipz's.

**"Doesn't slide from down" was literal.** The animation was `translateY(24px)` over
`.22s` — a nudge you have to be looking for. It now starts at `translateY(100%)`, so it
begins fully below the fold and travels its whole height (measured: 490px of a 489px
sheet, settling at 0).

Also: rounded **top corners only** (it is anchored to the screen edge, so the lower
corners were being rounded against something nobody can see, which is what stops a bottom
sheet reading as a sheet), a `min-height:58vh` so a two-line message arrives as a panel
rather than a strip (his sits at 86% of the screen, ours was 24%), and the unread row
gets a gradient card with a brand-tinted glow instead of a flat white rectangle with an
accent bar — an unread message should look *lit*, not merely outlined.

**A duplicate-selector trap was created and caught in the same edit.** Splitting
`.msg-row` into unread/read states first produced two full `.msg-row.read` rules — the
exact shape that blanked the About page. The audit from that fix (`re.findall` for
repeated selectors) was re-run immediately and the duplicate collapsed to a
three-property override. Run that audit after any rule-splitting edit.

### Measuring against a mockup screenshot (do this, don't eyeball)

Owner: *"you see the difference on withdrawal screen with my mockups, things are small
even see number… see the dialog message should be like that in that height that size…
our dialog is too high."*

**The method.** His mockup screenshots and screenshots of the live app are both 720px
wide, so *glyph ink heights compare directly* even though the CSS pixel size behind each
is unknown. Scan a band of rows for dark pixels, take the runs, compare. For boxes, work
in **fractions of screen width** — the only dpr-independent unit available.

**What that turned up, and why it matters:** only three things on Withdraw were actually
undersized, all by the same ~1.45×. Several things he might have meant were *already
bigger than his mockup*, and scaling them "to be safe" would have overshot — which is
exactly how the nav icons ended up wrong in both directions.

| Withdraw element | ours | mockup | verdict |
|---|---|---|---|
| Balance figure | 38 | 55 | **1.45× too small** → 28 → 40px |
| Amount input | 19 | 28 | **1.47× too small** → 16 → 23px |
| Trade-password field | 14 | 21 | **1.50× too small** → 15 → 22px |
| "Withdrawal Wallet" / "Trade Password" | 23 | 24 | already right — untouched |
| Instruction list | 18–23 | 16 | **ours is bigger** — untouched |
| Wallet card number | 32 | 24 | **ours is bigger** — the difference was *tracking*, so `.06em → .16em` |

Deposit's amount field was moved with Withdraw's: same control, sibling screen, and a
16px one beside a 23px one is the next complaint.

**Dialog proportions**, all measured as a share of screen width unless noted:

| | mockup | before |
|---|---|---|
| Alert card | 73.9% wide, 53.3% tall | 85% wide, taller |
| Warning triangle | 11.0% | — |
| OK button | 19.3% × 11.0%, **pill** | 120px min, rounded rect |
| Announcement card | **74.9% of viewport HEIGHT** | 96% (`inset:14px`) |
| Close ring | 10.7% wide, 1px hairline, no fill | 38px, 1.8px border, filled |
| X inside the ring | 41% of its diameter | ~20% |

The announcement now centres in the backdrop with a `max-height` **ceiling** rather than
a fixed height — a short announcement should make a short dialog, not a tall one padded
with nothing.

`test-mockup-proportions.py` pins every one of these as a ratio with the mockup's own
figure in the assertion text, and it asserts in **both directions**: that the three
undersized items grew, *and* that the already-correct headings and instruction list did
not get dragged up with them.

**The one deliberate departure** is colour. His mockups are a purple/green theme; Chipz
is red/orange, so the OK and Join Channel buttons use the brand gradient. Every
proportion is his.

**Owner's exact wording, at both ends:** *"Please enter the treasure chest key"* (client,
empty field) and *"Wrong treasure chest password"* (server, `/redeem`, code not found).
The other `/redeem` failures — inactive, expired, already used — deliberately keep saying
what is actually wrong: those are *real* codes in a wrong state, and calling them "wrong"
would send someone hunting for a typo that isn't there.

### The About page was blank — a duplicate CSS rule, and how it hid

Found during a health check, live in production. The About page rendered **nothing**.
Not empty: every word was in the DOM, wrapped in `<span class="reveal-word">`, and every
one of them computed to `opacity: 0`.

The word-by-word reveal was removed on request (*"remove live appearing animation
everywhere"*). The removal added `.reveal-word{opacity:1;transform:none}` — and left the
animation's old starting frame, `.reveal-word{opacity:0;transform:translateY(10px)}`,
**four lines further down**. Same selector, same specificity, later in the source: the
stale rule won. The comment two rules above it warned about exactly this hazard ("Its old
`opacity:0` default is the thing to be careful about: leaving that behind while removing
the transition would hide the About page outright") and the duplicate was left in anyway.

It is **deleted**, not overridden — adding a third rule to win the cascade keeps the trap
loaded for the next edit. There is now exactly one `.reveal-word` rule.

**Why nothing caught it:** every existing check asserted on `textContent`, which was
correct throughout. What was wrong was whether any of it reached a pixel.
`test-visible-text.py` closes that gap three ways: the structural guard (exactly one
`.reveal-word` rule), the computed opacity of every rendered word, and an **ink
fraction** — the proportion of the article's screenshot that is not the background
colour. Verified by re-introducing the bug: the ink fraction reads **0.00%** and five
assertions fail. A test that would have passed against the broken app is worth nothing.

It also sweeps all six main screens for *any* text-bearing element rendered at opacity 0
with no hidden ancestor, so the next instance of this class is caught wherever it lands.

**Static analysis that was wrong, recorded so it is not repeated:**
- Grepping the inflated core for `window.X =` property names to check inline
  `onclick`/`onerror` handlers still resolve. The obfuscator encodes property names as
  strings, so every name reads as "missing" — including ones the app demonstrably uses.
  Proven at runtime instead: a deliberately broken logo URL fires the inline `onerror`,
  and the badge falls back to the admin-set name with no page errors.
- Flagging `--auth-hero-op` and friends as "used in CSS, never defined". They are set via
  a computed name (`'--auth-' + prefix + '-op'`), and every CSS use carries a fallback.

### The scrollbar is orange, and it takes two properties

Owner: *"l want the scroll bar to be orange not dull color."*

The file said `::-webkit-scrollbar{display:none;}`, and that rule was not being disobeyed
— **it does not reach the scrollbar he is looking at**. Android always draws *overlay*
scrollbars, and since Chromium 121 overlay scrollbars are painted natively and ignore the
`::-webkit-scrollbar` pseudo-elements entirely, so the phone fell back to the system grey
thumb. The standard `scrollbar-color` is the one thing overlay scrollbars obey.

Both are set, because they cover two different scrollbars:
```css
html{scrollbar-width:thin;scrollbar-color:var(--chipz-orange) transparent;}
::-webkit-scrollbar-thumb{background:var(--chipz-orange);border-radius:var(--r-pill);}
```
`scrollbar-color` is an **inherited** property, so the root covers every scroller in the
app — sheets, the announcement body, the message detail, the manual-pay overlay —
without naming any of them. Naming them is how the next one added gets missed. The track
is transparent on purpose: a filled track on a phone is a grey stripe down the edge of
every screen, which is the thing being removed. The admin panel carries the same rules.

**The painted pixels cannot be verified in this container, and the test says so.** This
Chromium always draws overlay scrollbars — every documented flag for turning that off
(`--disable-features=OverlayScrollbar` / `OverlayScrollbars` / `FluentOverlayScrollbar`,
`--disable-overlay-scrollbar`) still reports a 0px gutter — and headless does not
composite overlay scrollbars into a screenshot at all: sampling the thumb's strip
immediately after a scroll, and again at 50/200/600ms, finds zero non-background pixels.
A first version of the check probed a 0px-wide strip, found nothing, and reported a
cheerful pass having photographed empty space. `test-card-quality.py` now asserts the
computed `scrollbar-color` on the root **and on an inherited scroller**, plus the source
rules, and records the reason inline so nobody re-adds the screenshot check.

### The name is remembered on the device, and the manifest is rewritten

Owner: *"let's not make chipz to be default name, let's make it to be backend such that
the set name abides every functions except others like api, callback curls but system
visuals should be backend, ie l had made a little bit changes in names but on start up
loader it was still saying chipz, also on app even if l had uninstall and installed."*

Two separate gaps, and neither was a bug in the rename:

**The loading screen.** It is on screen *precisely while `/public/settings` is in
flight*, so it could only ever paint what was compiled into `index.html` — and that was
the old name, on every launch, forever. Fixed by remembering the name on the device:
`applyBrandName()` writes `localStorage['chipz_brand_name']`, and a small plain
`<script>` sitting immediately after the loading-screen markup reads it back and paints
the mark **before the 250KB core inflates**. Every launch after the first shows the real
name in the first frame. Proven in `test-home-gif-and-name.py` by holding the settings
response open for three seconds and asserting the loader already reads `VOLTRIX` while
`STATE.settings.brandName` is still undefined.

**Nothing falls back to a hardcoded wordmark any more.** `brandNameKnown()` may return
`''`; `brandWordmarkHtml()` renders nothing when it does, and the static markup ships
empty. On a genuinely first-ever launch the mark is blank for the moment settings take
to land — `.ls-wordmark` carries a `min-height` so the dots don't jump — because a blank
that fills in is honest and the wrong name is not. `brandName()` keeps a `'Chipz'` last
resort **for sentences only** ("Welcome to the  app" is worse than a stale name), and
`brandTextMark()` uses it deliberately: that one is the fallback for a *broken image*,
where an empty badge would be a hole in the card.

**The install prompt.** `manifest.json`'s `name` is what Android prints under the icon
and what Chrome's "Install app" sheet shows — a static file on a static host, so the
rename could not reach it. The **service worker** now rewrites it: it owns this origin's
responses, so it can hand Chrome a manifest built from the live setting while keeping it
same-origin. A cross-origin or `data:` manifest is not an alternative — `scope` and
`start_url` resolve against the manifest's own origin, so either breaks installing
outright.

It is best-effort by construction, and `test-brand-manifest.js` runs `sw.js` in a `vm`
to prove each failure path: backend offline, setting unset, a non-JSON body (captive
portal wifi), and fully offline all fall back to the file **as shipped, icons intact** —
a phone that cannot install the app is far worse than one that installs under last
week's name. A known name is served immediately with the refresh running behind it,
because a manifest fetch happens while Chrome is deciding whether to offer the prompt
and blocking it on a cold Render backend is how the prompt never appears. The interception
must sit **before** the navigate and cache-first branches (`/manifest.json` is in
`SHELL`), and `activate()` spares `BRAND_CACHE` or every deploy would forget the name.

Playwright cannot test this: every Playwright test here runs `service_workers="block"`,
because an unblocked worker intercepts the stubbed API calls and the rest of the suite
goes dark.

**What a rename still does NOT reach:** the `og:`/`twitter:` link-preview title, which a
crawler reads out of the static file. That is a share card, not a system visual, and it
needs a redeploy.

### Busy buttons say what they are doing

Owner: *"on login it should not say please wait, it should say logging in..., so
everywhere saying please wait... it should be removed."* "Please wait" tells the member
the app is busy — which the disabled button already says — and nothing about *what* is
happening, which is the one thing that makes a two-second pause on a money screen feel
safe rather than stuck.

`setBtnLoading(id, loading, label, busy)` now takes the busy label as a **required
argument** rather than defaulting: a new loading button with no label is a visible blank,
not a silent fall back to the wrong words. Login → *Logging in…*, Sign Up → *Creating
your account…*, wallet → *Saving wallet…*, deposit → *Sending request…*, withdraw →
*Submitting…*, purchase → *Purchasing…*, confirm → *Working…*, admin credit/debit →
*Crediting… / Debiting…*.

Checked by driving the real button in `test-card-quality.py`, not by grepping: the
obfuscator replaces every string literal with a lookup into an encoded array, so
"Logging in…" is not present as text at **any** layer of `user/index.html` and a grep
would pass whether the label were right, wrong, or missing.

### The nav icon size has now been wrong in both directions

The mockup drew them at 23px, which read as specks with six tabs sharing a phone's
width. Two rounds of *"the nav icons are small"* pushed them to 38px — and 38 drew
*"reduce on sizes of nav icons, they are too big eeh"*. They are **31px** now, with
`--nav-h` 76 → 68 and the active-tab slab 48 → 42 so the bar comes down with the glyph
instead of leaving it floating in the old height.

`test-round-fixes.py` asserts a **band** (28–34), not a floor. The old check was
`>= 36`, which is exactly how it drifted to 38 with nothing objecting.

### The surface pass: three radii, real shadows, solid pills

Owner, holding a mockup next to the live app: *"the mock up has very clean CSS, well
ultra definition and quality cards and colour ... clean cards, well defined and high
quality ... make sure it is enhanced through out the app."*

What actually separated the two was not colour:

- **91 rules hardcoded `border-radius:4px`.** At that size a corner reads as an
  unfinished edge, not a decision. They now resolve to one of three tokens, and those
  are the only radii in the file: `--r-card:16px` (panels, rows, sheets),
  `--r-ctl:12px` (buttons, inputs, chips, tiles — tighter, so a control reads as
  pressable rather than as a small card), `--r-pill:999px` (status pills, accent bars,
  progress tracks). The one deliberate 4px left is the copy-button glyph, which is a
  15px square drawn with borders.
- **Every card leaned on a 1px hairline plus a shadow that never drew a pixel** — the
  spreads were `-16px`/`-24px` against blurs of 18–34px, so nothing reached outside the
  box. A hairline with no shadow is a wireframe. `--sh-card` is two layers: a 1–2px
  contact shadow that defines the edge, and a wide soft one that lifts the card off the
  cream canvas. The hairline stayed but dropped to `--line-soft`, an edge highlight
  rather than the only thing holding the card together.
- **Status pills** were pale tints with same-hue text. Now solid gradients with white
  text and a shadow in their own hue. `.status-pill.active` on Team matches `.rec-pill`
  exactly — one pill vocabulary, so a status looks like a status wherever it appears.
  Pending on Team stays quiet on purpose: it is the absence of a thing.
- **The D / W / T discs** were one flat wash with the letter in a darker tone of the
  same colour. Three things give a 44px disc definition: a gradient so it has a lit
  side, an inset 1px top highlight so it reads as raised, and a drop shadow tinted with
  its **own** colour rather than grey. Green for money in, rose for money out — the
  app's colours, not the mockup's purple. `.msg-row .av` and `.msg-detail .av` got the
  same treatment; two avatars that nearly match is worse than one that does.

**The pending orange is deliberately a stop deeper than the mockup's.** White on
`#ffa726` measures **2.35:1** — a label you squint at outdoors, which matters for a
Uganda mobile app. `#fb8c00 → #dd6b00` measures 2.77:1 and still lands as orange beside
the green and the red. Saturating a pill is only an improvement if you can still read it,
so `test-card-quality.py` asserts **both** directions: pill-vs-card ≥ 2.5 (the "defined"
claim — pending went from 1.27:1 to 2.77:1) and text-on-pill ≥ 2.7 (the legibility floor).
It samples the **rendered pixels**, because every pill and disc is a gradient and
`background-color` on those computes to `rgba(0,0,0,0)` — an assertion against that value
would pass no matter what the member sees.

### The spin win shows the wheel, not a chest

Owner: *"l want when one spins it shows that spin icon background icon l generated my
own instead of chest box, so it will show that inside background blur."* His artwork is
`user/spin-wheel.png`, cut out of the JPEG he sent by flood-filling the white **page**
inward from the border — a global "white → transparent" would have punched holes in the
wheel's own white segments, which are the same colour and only survive because they are
enclosed by the yellow ring.

`showChestWin(reward, balance, source)` takes the source as an argument rather than
reading whichever screen is open: the spin's win lands four seconds after the tap, by
which time the member may have moved. A gift-code win still shows the chest.

The `.spin` variant carries its own filter. The chest is warm brown and the shared
`brightness(1.3)` on the green flash just made it glow; the wheel is red and white, and
the same treatment turned the red to mud and let green through the white segments until
it read as mint. Verified by screenshot, not by reasoning about it.

### Total Team wears the app's own team icon

Owner: *"you failed to put that icon total team icon just as the same team icon on our
app, dont use that in mockup."* The card had no icon at all, and the mockup he was
holding up marks it with a bare emoji. It is now `/nav-team.png` — literally the same
file the bottom nav loads, asserted as such in `test-card-quality.py`, so "team" is one
picture everywhere instead of an emoji in one place and artwork in another.
`align-items` moved from `baseline` to `center`: an image has no baseline and hung low
against the text.

### How far along a plan is — no bar, and the denominator that was wrong

Owner, first: *"does the progress bar on running investment work properly?"*
Owner, later: *"remove progress bar on running products so on you will see how you'll
organize it but remove progress bar."*

**The bar is gone. What it was drawing is not.** `.mp-bar` was the only place it
existed (the plan rows — there is no bar in the detail sheet or on Home), and
`planStats().pct` went with it.

**How the row was reorganised.** The `.mp-days` line under the bar was its *caption* —
two muted greys 6px beneath the track. Left alone after the bar was deleted, it reads
as a label for something that is no longer there. So it takes over the bar's own slot
(13px below the header, where the eye already expects the next thing) and the day count
is promoted to ink at 15px: **the fact the bar was drawing is now simply stated.** The
right-hand half ("26 days left" / "Finished") stays muted at 13.5px, because it is the
same arithmetic said a second way and must not compete with the count.

`test-plan-progress.py` kept all six cases and changed what it reads — the rendered
**text** instead of the fill's geometry. It also asserts, on the rendered rows, that no
row draws a bar at all: grepping the built file would prove nothing, since the
obfuscator encodes class names as strings.

### "Ongoing", and the orbiting-chips mark

Owner: *"instead of running use ongoing, also put this animation on aside of running
product, it should be well defined"* — with a 180px standalone loader: three chips
orbiting a pulsing centre one.

**Ongoing replaces Running everywhere a member reads it** — the row chip, the filter
tab, "2 ongoing plans", and both empty states. The internal filter KEY stays
`'running'`; it is never displayed, and renaming it would churn `switchPlanFilter`,
`counts.running` and the tests for nothing.

**Where the mark went, and why not beside the status pill.** Beside "Ongoing" was the
obvious spot, but the header's width is already spoken for: thumb + name + pill leaves
about 186px for the meta line, and a 32px mark plus its gap takes 38px of that —
enough to start truncating *"UGX 197,000.00 invested"*, which is money information. It
sits at the head of the day line instead, where there is room to spare, and only on
ongoing rows — a matured plan has nothing in motion, and an animation there would
contradict the "Finished" beside it.

**Sizing is measured, not guessed.** Rendered at 24/30/36/44 side by side, the three
triangles stop being separately readable below about 30px. It is set at **32**.

Two implementation notes worth keeping:
- Every length is a fraction of `--s`, so the shape is identical at any size.
  Shrinking his 180px original with `transform:scale()` would drop the 2px speckle
  highlights to a third of a pixel, where they stop reading as texture and start
  reading as dirt. For the same reason the speckles are **dropped** at this size — his
  gold-to-ember gradient is what actually carries the chip.
- Everything is namespaced `pspin-*`, keyframes included. A bare `.chip` would have
  collided with `.wallet-card .chip`, and a bare `spin` keyframe is exactly the kind of
  name a later screen would reuse.

**What drives the width.** `planStats()` is the single source for every plan figure on
both the My Products row and the detail sheet: `pct = payoutsMade / payoutsTotal`.
`payoutsMade` is the count of daily payouts the **server has actually credited**, not
elapsed wall-clock time, so the row can never claim a day that was not paid. And
`/investments` calls `settleAllForUser(uid)` *before* it responds, so opening the screen
settles everything that has come due first — the count is current at the moment it is
looked at, not as of the last cron tick. That is why it is honest to answer "yes" here:
the number on screen and the money in the ledger come from the same field.

**The one thing that was wrong.** The cycle length fell back to a bare `|| 150` when an
investment document carried no `payoutsTotal`. `/invest/create` always stamps that field,
so anything bought through the app was fine — but a document written before the field
existed measured itself against 150 days regardless of the cycle it was sold on. A 30-day
plan four days in read 3% on the old bar; in today's wording it would say **"Day 4 of
150"** and claim 146 days left, on a plan sold as a 30-day one. The fallback is now a
chain — `payoutsTotal` → the product's own `cycle` → `settings.cycleDays` → 150 — and the
fixture uses **30-day products on purpose**, because a 150-day fixture cannot tell a
correct cycle from the old hardcoded one.

The other five states all passed before the fix and still do: Day 0 on the day of
purchase, the exact half-way count, "Finished" + "Matured" + countdown stopped at
maturity, **clamped** (not "Day 31 of 30") when the ledger pays one rounding day past the
total (that has happened), and correct when every number arrives from the API as a
**string** — the same JSON-typing that once turned a `+` into concatenation and produced
the "1,000,000,500"-class figure recorded above.

### The congratulations card: what was slow, and the balance that grows

Owner: *"why does the congratulations card delay to appear when one has claimed
treasure code and also when has got spin rewards"* and *"l want when congratulations
card comes let the balance also have a live growing animation."*

**Nothing was slow to render. Both paths were queuing round trips ahead of the card.**

- **Chest key.** After `/redeem` came back a winner, the client fetched `/account`
  and then the transactions cache *before* calling `showChestWin` — purely so the
  card could print "New Balance". Two extra round trips on mobile data with a cold
  backend, during which the app showed nothing at all after a successful claim.
- **The spin.** Worse, and for a second reason. The wheel's transition is **4s and
  starts at the tap**, but the wait was a flat `setTimeout(…, 4000)` measured from
  **when the server answered** — so the whole request time was served twice, and the
  member watched a wheel that had already stopped. Then the same three refreshes
  ran before the card.

The credit is already confirmed by the time either response lands, so the card opens
immediately now and the refreshes happen behind it (`refreshAfterWin()`, deliberately
un-awaited). The spin waits only for **what is left** of the 4s transition, so the
card lands as the wheel settles however long the network took — zero remainder if the
request outlived the spin. `/turntable/spin` already returned the post-credit
`walletBalance`; **`/redeem` now does too** (one local read replacing a network round
trip), with `before + reward` as the client-side fallback for a backend that has not
redeployed yet.

**The growing balance.** `countUpEl()` was refactored into `countBetweenEl(el, from,
to, …)` — it is now that with `from` pinned to zero — and the card counts from the
balance held *before* the reward up to the one held after. Counting from zero would
animate the member's entire savings, which says nothing about what they just won.

One rule worth keeping: `correctChestWinBalance()` (the live `/account` figure
landing behind the open card) **only ever corrects upward**. A lower figure is either
a read that has not caught up with the credit or a debit unrelated to this win, and a
congratulations card that visibly takes money back off the member is worse than one
that is a few seconds behind — `STATE.account` already holds the truth and Home shows
it the moment they close the card.

**A rAF timestamp can be earlier than the `performance.now()` you started from.**
`countBetweenEl` clamped `t` at the top only, and the assertion "it only ever grows"
failed **once**, in a suite run, then passed on every re-run. That flake was real: a
rAF callback receives the *frame's start* timestamp, not the moment it executes, so a
task running inside an already-stamped frame — a promise continuation, which is
exactly what opens the win card — can schedule a callback that arrives with
`now < start`. `t` went negative, the ease-out cubic went negative with it, and the
figure painted one frame **below** where it started: money visibly dipping on a
congratulations card. `t` is now clamped at both ends. If any other animation here is
ever written against `performance.now()`, clamp both ends — and treat a
one-in-many-runs failure of a timing assertion as a defect to find, not a test to
loosen.

`test-win-and-purchase.py` is the standing check. It only means anything against a
**slow** backend — on a fast connection the old code looked fine — so it stalls
`/account` by 3s and `/turntable/spin` by 1.5s and asserts wall-clock time from the
tap: card in **under 1.5s** for the key (measured 74ms), and **under 4.9s** for the
spin (measured 4344ms, i.e. the wheel and nothing more). The balance is sampled by an
in-page rAF recorder **armed before the tap** — reading it after awaiting the card
from Python misses the opening frames, and with ease-out cubic it is already 5% along
by then, so "did it start at the old balance?" becomes unanswerable.

### Buying a product goes to My Products, and says so in the alert dialog

Owner: *"l want when one buys a product he is immediately redirected to my products
page to see his products, l nolonger need those ugly notifys that bought product 1, l
need what we are using with this ⚠️."*

The "ugly notify" was `toast()` carrying the **server's own sentence** —
`Bought ${name} for ${price}`, from `/invest/create`. It is gone from this path.
`openInvestConfirm()` now calls `showPage('products')` and then `notify()`, in that
order: My Products starts its own fetch immediately and is painting the new plan while
the dialog is still being read, so dismissing it reveals a finished screen rather than
a loading one.

The dialog is the ordinary app-wide alert card — amber triangle and one pill OK — not
a bespoke success dialog, because that is the component he pointed at. The server's
message is left untouched; it is simply no longer what the member reads.

### `.screen` in a .dc.html is the CANVAS, not a background — the announcement

Owner: *"l don't need an announcement dialog to be having yellow background l need it
to show dashboard just like my mock ups."*

`.announce-bg` was painted `linear-gradient(160deg,#ff8a1f,#e21b2a)`. That is
`Announcement.dc.html`'s `.screen` rule, copied literally when the dialog was ported.

**Every single .dc.html carries that same gradient on `.screen`.** It is the design
canvas — the mockup file's stand-in for whatever is behind the phone's content — not
any screen's background. Adopting it as paint made the announcement the one overlay in
the app that hides everything under it behind flat orange. What is actually under it
is Home: `maybeShowAnnouncement()` is reached only from `showPage('home')`.

It is now `rgba(20,10,5,.45)` — the same scrim `.notify-bg` already uses, so there is
one backdrop treatment for every dialog rather than a second one invented here — and
the dashboard shows above and below the card, which is what the mockup's centred,
76vh-tall framing was always implying.

**If another screen is ever ported from a .dc.html, do not carry `.screen`'s
background with it.** Take the `.wrap`/card rules and leave the canvas behind.

`test-announcement-backdrop.py` checks this in **pixels**, not CSS: a backdrop rule
can be corrected and the dashboard still be invisible behind an opaque wrapper or a
stacking context. It samples the strip of screen above the card, asserts none of it is
the orange gradient, then screenshots the same strip with the dialog closed and
requires the colours behind to **track what Home actually paints there** — because a
flat scrim over a blank page would satisfy "not orange" while showing no dashboard at
all.

### The announcement fires on the way to HOME, and nowhere else

Owner: *"l said from deposit to home, not when one clicks on deposit and later goes to
another ... l don't want when l can go in deposit and l click to another nav icon not
home it should not show announcement dialog, also on withdrawal as well."*

**An ordering bug, two lines apart.** Deposit and Withdraw are OVERLAYS over Home, so
`STATE.page` is still `'home'` for as long as one is open. `showPage()` closes any open
sheet **before** it sets `STATE.page = name` — it has to, or the new tab paints
underneath a sheet still covering it. But that close ran `maybeAnnounceAfterSheet()`,
whose guard is `if (STATE.page !== 'home') return`, and at that instant the answer was
still "yes, home" **whichever tab had been tapped**. So the announcement fired on the way
to Products, Team, Account — everything — and the destination page then painted behind
the open dialog.

The guard was not wrong; it was simply asked one line too early. `showPage()` now closes
with `closeSheet({ navigating: true })` and `closeSheet` suppresses the announcement for
`fromAction || navigating`. **Tapping Home from Deposit still announces** — that path
goes through the `name === 'home'` branch, which is the one case that genuinely is
"from deposit back to home" — and so does the back chevron, unchanged.

`navigating` is deliberately a **separate flag from `fromAction`** rather than a reuse of
it. They suppress the dialog for unrelated reasons (one is "the member is mid-payment",
the other "the member is leaving"), and folding a tab tap into "fromAction" would read as
a lie to whoever traces this next.

**Why this needed a runtime test and not an assertion on the flag.** The defect was
purely in the ORDER two adjacent statements run in — the code, the guard and the list
were all individually correct. `test-nav-sheets.py` drives real taps on the real bottom
bar for both screens across three destination tabs, plus the two paths that MUST still
announce, so a "fix" that just mutes the dialog everywhere cannot pass. Verified by
reverting the fix and re-running: exactly the six wrong cases fail and the four correct
ones keep passing.

### The message popup: two overlays stop above the nav bar, only one was handled

Owner: *"even see when in this message and you tap nav icons, the message screen or
page still persists to go away unless you click on X mark."*

`showPage()` closed `.sheet-bg.show` and nothing else. The message detail is its **own**
overlay (`#msgDetailBg`), and — measured, not assumed — it is the **only other overlay
in the app that stops above the bottom bar** (`bottom:var(--nav-h)`, the same inset
`.sheet-bg` uses). Every other one (notify, confirm, chest win, announcement, deposit
result, manual pay) is `inset:0` and covers the bar, so a nav tap cannot reach them and
none of them have this bug. That measurement is the useful part: **the set of overlays a
nav tap can reach is exactly the set that does not cover the nav.** If a new overlay is
ever given a `bottom:var(--nav-h)` inset, it belongs in `showPage()`'s teardown.

**A second bug, found by probing rather than reported.** The detail pushed no history
entry, so the phone **Back** button consumed the Messages *sheet's* entry instead: the
list was torn down and the popup left floating over nothing (measured `detail=True,
sheet=False`). Same "it won't go away", different route. It now pushes `{msgDetail:true}`
like `openSheet()` does, `popstate` closes just the popup and returns — landing back on
the sheet's own entry with the list still open — and the X routes through `history.back()`
too, so Back and the X cannot drift apart.

**`history.go(-n)` once, never two `back()`s.** With both overlays owning an entry,
`showPage()` has two to retire. Two `history.back()` calls in one tick is the exact race
this file has already been bitten by, so `closeSheet` gained `keepHistory` and `showPage`
makes a single `go(-spent)`.

**Three assertions here were written, watched to pass against the BROKEN app, and
rewritten.** Worth reading before adding to this file:
- *"closes in the same tick"* — a Python-side read straight after `page.click()` passes
  either way, because `click()` does not resolve until the queued `popstate` has already
  run. Only clicking and reading **inside one page task** (`page.evaluate` that calls
  `.click()` and returns the class in the same expression) can tell a synchronous
  teardown from one that waits for `popstate`.
- *"Back leaves the list open"* — passes with the `pushState` deleted, because the
  `popstate` branch closes the popup either way. What actually differs is **whose entry
  was spent**, so that is what is asserted (`history.state.msgDetail` on top, then
  `history.state.sheet` after one Back).
- The real-world consequence of getting that wrong is severe and arrives disguised: with
  no entry of its own, `go(-spent)` counts one too many and walks off the app's **first**
  entry, so a nav tap **drops the member out of the app**. In the test that surfaced as a
  null-dereference stack trace from every later assertion, not as a finding — so there is
  now an explicit, named `did not navigate out of the app entirely` check ahead of them.

### The Referral share card, measured off the mockup

Owner: *"l want the copy SVG icon to be replaced by that image l made myself, just like
you see on the mock ups, also on copying, the other button should say copied. l want the
same size of card, box and button and icon exactly that of mock ups rather than guess."*

**Half of it already worked.** "Copied" on the labelled button and the tick on the tile
shipped a round earlier; driving the built app confirmed both before changing anything.
He was holding up the mockup as the spec, not reporting those as broken.

**What was actually wrong, measured at 390px against his 1080px screenshots** (1068 of
which is the phone's content — the last ~12px are the capture's purple edge strip):

| | ours | mockup | |
|---|---|---|---|
| icon tile | 28 × 28 | **45.3 × 41.6** | −38% |
| field height | 48 | **65.7** | −27% |
| label → field | 10 | **15.0** | −33% |
| field → button | 14 | **17.5** | −20% |
| card / field / button width, button height, card padding, tile inset | — | — | **already right, untouched** |

**The field is taller because his URL wraps to TWO lines.** Ours truncated to one with an
ellipsis. That is the whole 18px, and it is why the height alone is not the assertion —
a one-line field with fat padding would satisfy it and look nothing like his. The span is
now a 2-line clamp with `overflow-wrap:anywhere` (a URL is one unbroken word).

**The card height is the independent check.** Nothing sets it; it is the sum of what is
inside. It landed at **200.0 against his 199.7** — so the parts are right, not merely
summing to the right total.

`user/copy-clip.png` is his artwork, cut out by flood-filling the white **page** inward
from the border — the same rule as the spin wheel: a global white→transparent would punch
holes in the clipboard's own white paper, which is the same colour and only survives
because it is enclosed. Trimmed to content, 118 × 144, 6KB. Its height is set in CSS
(`.url-row .copy-ic img`), not in the markup, so the tile and the art stay in step.

**The one judgment call:** his mockup's icon is the system 📋 emoji, whose *ink* measures
35 × 42 mockup px — about **15 CSS px**, which would turn his detailed illustration into
mush. The art is set to 24px (57% of the tile height, the ordinary icon-in-tile
proportion, near the emoji's em box). Everything else in the table is his figure exactly.

**Both controls acknowledge, whichever was tapped.** Owner: *"why when l copy link with
the other icon and shows tick, the button which says copy invite link doesn't show
copied, yet l wanted it to say it in all cases whether clicking copy icon or button."*
`flashCopied()` only ever flashed the control that was tapped, which reads as the other
one not having worked. They are two controls for **one** action, so both now flip.

Grouped by an explicit **`data-copy-group`**, deliberately not by "flash everything in
the same container": `copyText()` is shared with the manual-pay screen, whose two copy
buttons sit in one container and copy **different** text (account number, account name) —
a proximity rule would tick the account name when someone copied the number, telling a
member they had copied something they hadn't. Only controls copying the same thing share
a group, and `test-referral-share.py` asserts that exactly two elements carry one.

**A percentage is the wrong tolerance for small distances.** `test-referral-share.py`
allows 8% **or 2px, whichever is looser**: the card padding sits 1.5px off his 17.5px,
which is invisible but 8.6%, while every error this round found is far outside both bars
(17.3px, 17.7px, 5.0px, 3.5px). A test that flags 1.5px on a JPEG-measured figure is one
you learn to ignore. Verified by reverting the CSS: 5 assertions fail, including the
card height.

### The warning sign is the emoji, and the chest gets its second ring

Owner: *"first check how well defined and realistic and quality ⚠️ that sign is … on
treasure chest there are 2 linings circulating the chest box, you can even see clearly
that one inside is solid and one outside is dotted … also some greener background on
that chest box."*

**The warning sign.** His reference's triangle is the system emoji — Noto Color Emoji's
⚠️, with rounded corners, a gold-to-amber gradient and a real drop shadow. Ours was a
hand-drawn flat SVG with a hard 1px stroke, which is exactly what looked cheap beside
it. It is now the glyph itself. Redrawing it in SVG would be an imitation of a picture
the phone already ships, and this project already uses real emoji glyphs (Login /
Register). `.notify-icon` needs `line-height:1`, not the `0` the SVG used — a zero line
box clips an emoji's ascender.

**The chest rings.** Every value was **sampled off his screenshot**, not eyeballed:
scanning the vertical centre line through the circle finds the outer dotted ring at
`rgb(166,206,180)` (a muted mint), the inner solid one 27 image-px further in at
`rgb(234,227,209)` (a warm tan), and the field between them tinted `rgb(198,227,199)`
against `rgb(250,248,240)` paper — that tint is the green wash. At his 1080px capture on
a ~393pt screen: a 191px outer circle, a 172px inner one, about 10px apart. Implemented
as `::before` (dotted, inset 16px) and `::after` (solid, inset 26px) with a mint radial
gradient replacing the old orange one.

`test-chest-screen.py` asserts the outer is dotted, the inner is **solid**, the solid
one sits **inside** the dotted one (a solid ring drawn wider would satisfy "two rings"
and still be the wrong picture), and that the wash's first colour stop is green.

### Date bought

Owner: *"make sure that one running investment, it shows Date bought."*

Its own quiet line under the day count, not a third column in `.mp-figs`: three columns
would drop each from 161px to 104px, and `UGX 571,300.00` at 16px does not fit in 104.
Shown on matured rows too — when a finished plan was bought is the same fact, and hiding
it there would be an odd gap.

`fmtDay()` takes the **raw `createdAt`**, never `planStats().createdMs`. That one falls
back to `Date.now()`, which is the right guess for "when is the next payout due" and
completely the wrong one for "when did I buy this" — a plan with no stored date would
have claimed it was bought today. Missing or unparseable gives an em dash instead.

The month is spelled (`24 Aug 2026 at 21:13`), not numbered: `12/08` is read as two
different dates by two different members, and `toLocaleDateString` would order it by
whatever locale the phone happens to be set to. The time (owner: *"even bought should
carry the time bought at"*) is **24-hour**, matching the ledger's own `23:21` and the
plan countdown's `HH:MM:SS` — one clock across the app, no am/pm to misread — and comes
from the LOCAL getters, so a member in Kampala sees the moment they tapped Buy rather
than the UTC instant the server wrote down.

Its test asserts against the exact ISO the fixture sent, converted by the browser's own
`getTimezoneOffset()` — recomputing from `utcnow()` at assert time drifts by a minute
whenever the clock ticks over mid-run, which is a flake waiting to happen.

**The key field is green too.** Owner: *"the chest box password input card, it has green
on it, don't you see the mockup image."* Sampling down its left edge in his screenshot
gives `rgb(184,213,195)` on the border rows against a `rgb(254,253,251)` fill; undoing
the JPEG's blend against the paper puts the real border near `rgb(156,197,174)`. It is
the same sage as the rings and the wash, which is why that block reads as one thing in
his and read as a plain grey box in ours. Only this field is greened — it is the one
that belongs to the chest.

### A stray `*/` silently ate one CSS rule — read this before editing the stylesheet

This is the most dangerous mistake available in `user-src/index.html`, and it happened
here. A round appended a new explanatory paragraph *after* a comment that had already
closed with its own `*/`, leaving the prose as raw text at the top level of the
stylesheet with a second `*/` after it. CSS error recovery treated the prose as a
selector and swallowed **the very next rule** as part of it: `.msg-detail-bg` lost its
background, its blur and its bottom inset, while every rule after it kept working
normally.

No parse error, no console warning, no build failure, one rule missing. It was caught
only because a screenshot assertion noticed the backdrop had no colour — otherwise it
would have shipped looking exactly like the bug the owner had just reported.

**`test-css-comments.js` now guards both stylesheets** (user and admin, in the SOURCE
files, since that is where the editing happens) and includes a poisoned fixture proving
the checker catches this exact shape. When adding to an existing comment block, extend
the block — do not start writing after its `*/`.

### The message sheet, round 2: real blur, and the nav left alone

Owner: *"the mockup shows good blur very well but see yours, not even blur … see the
message when tapped, it leaves a nav icons but see yours how you did it and you poorly
designed it."*

Two faults, both measured off his screenshot.

1. **The blur was applying; the tint was hiding it.** At `.42` the wash was opaque
   enough that the blurred page beneath stopped being legible as content — and you
   cannot see a blur you cannot see through. Tint down to `.26`, blur up to `20px`. An
   `@supports not` fallback raises the tint to `.62` where `backdrop-filter` is
   unsupported (older Android WebViews), so the card never floats on nothing.
2. **His overlay stops above the bottom bar.** Sampling his left gutter, the tint runs
   to y=1841 of 2085 and the nav below is untinted and sharp. Ours covered the whole
   screen. It is now `bottom:var(--nav-h)` — the same rule `.sheet-bg` already uses, so
   this is the app's own convention rather than a number invented here.

**The card floats.** Measured: it spans x=45..1035 of 1080 (a 4.2% side inset = 16px at
390), its bottom sits ~16px above the overlay's own bottom, every corner is rounded, and
its height is 898 of 2085 = **43% of the screen** — the previous `58vh` minimum made a
short message noticeably taller than his. It still rises from below; it now comes to
rest 16px up instead of against the screen edge.

### The message sheet, round 3: 20px was not "minimal", and luminance could not see it

Owner: *"see the blur in my mockup it is minimal such that you can even see some texts in
background."*

|  | luminance | stdev | edge p99 |
|---|---|---|---|
| his | 190.9 | **10.9** | **8** |
| ours at blur 20px | 216.2 | **1.4** | **3** |

**Round 2 measured the wrong thing and this is the lesson.** It tuned the tint until the
rendered luminance matched his (190 vs 189) and called it done — but luminance is a
*brightness*, and the fault was that no STRUCTURE survived. At stdev 1.4 the page behind
was not blurred, it was erased, while brightness sat right where it was aimed. Measure
what the complaint is about: "can you still read it" is variance and edge energy, not
mean grey.

`tune-msg-blur.py` sweeps blur × tint over the real popup on the real list (28
combinations) and reads back all three. **blur 5px / tint .22** reproduces his stdev
exactly (10.9). Kept from that sweep: at 20px, no tint value gets stdev above 5.9 — the
blur, not the tint, was the whole problem, so round 2's tint-only tuning could never
have got there.

**The luminance still reads higher than his (216 vs 191) and that is correct to ignore.**
His list sits on a green page and ours on a white sheet, so brightness here is a property
of his *content*, not of his blur. Matching it would mean darkening the wash until the
text went away again.

`test-mockup-proportions.py` asserts the rendered pixels (stdev ≥ 6.0). The pre-existing
`"blur" in backdropFilter` check stays, but note it passes for **any** blur including the
20px that erased the page — it cannot see this class of fault at all. The companion edge
check is honestly a weak one and says so inline: with that fixture's single message it
reads 6 at both 5px and 20px, so stdev is the assertion doing the work (8.6 vs 4.0,
verified by reverting the CSS).

### The red band above the app was `theme-color`

Owner: *"why app still have red upper title color? it takes space even."*

Android paints the status bar with `theme-color`, and at `#e21b2a` it read as a separate
red title bar sitting on top of the app rather than as part of it — which is exactly why
it looked like it was taking space. Both `<meta name="theme-color">` and
`manifest.json`'s `theme_color` are now the app's own paper `#fbf1e8`, so the status bar
becomes the top of the page. Chrome picks dark status icons for a light theme colour, so
the clock stays readable.

**An already-installed app keeps the colour it was installed with** until it is
reinstalled — reopening is not enough for this one.

### Referral / commission audit — what is true, and one thing that was not

Owner: *"make sure you audit referrals and cashback counting and all logics in
referrals chains."*

**THE RULE, stated once so nothing drifts from it again: referral commission is paid
ONCE per referred member, on their FIRST product purchase, calculated on the product's
price.** Not on deposits. Not on their second or later purchases. `creditReferralCommission()`
returns early unless `isFirstInvestment === true`, and its only real call site is
`/invest/create` (plus the reconciler retrying the same investments).

**The Referral banner used to say "Invite friends. Earn on every deposit they make."**
That was false in the way that matters most — about money. A friend could deposit
UGX 100,000, never buy, and earn their referrer nothing. The copy is now *"Earn when
they buy their first product"*, and the Rules line states the basis rather than listing
bare percentages. **The copy was changed, not the payout rule**: L1 at 28% of every
deposit forever would be ruinous, while 28% once on a first purchase is an ordinary
acquisition cost — the server was right and the sentence was wrong. If the owner ever
does want per-deposit commission, that is a server change and an economics decision,
not a wording one.

**Verified sound, so a later pass need not re-derive it:**
- **Chain integrity.** Self-referral is refused at registration (`refDoc.id === userId`).
  Cycles are impossible via registration by construction — `referredBy` is written once,
  at signup, and the referrer must already exist. The one path that can re-point an
  upline (`/admin/user/set-referrer`) walks the chain upward and refuses if it reaches
  the member. The 3-level cap is applied identically in every walk.
- **Commission is idempotent per (investment, level)**, and each level is CLAIMED
  (`commissionPaidLevels` arrayUnion) *before* its wallet credit, so a crash mid-loop
  can only under-pay — visible and fixable — never pay twice.
- **A banned referrer is a temporary hold, not a forfeiture**: `commissionPending` stays
  open and `commissionBanBlocked` keeps the 30s reconciler from re-scanning the same
  stuck rows forever.
- **Daily cashback has no rounding drift.** `settleInvestmentIfDue()` pays
  `round(expectedReturn × payoutsMade / payoutsTotal) − paidOut` — a running target, not
  a fixed daily slice — so it self-corrects every day and the final payout lands exactly
  on `expectedReturn`. It advances `payoutsMade` before crediting.
- **Milestone claims** are locked per user per milestone and set the claimed flag in the
  same write as the credit.

**KNOWN, NOT FIXED — team counts can drift from the member list.** `/team/stats` reads
the cached `teamL1Count/L2/L3`; `/team/members` queries `referredBy` live. Registration
and the admin re-point both increment those counters *after* the relationship is
written, deliberately ("can only under-count, never double-count on a retry"), so a
crash in that window leaves a permanent "L1: 3" above a list of four names.
`recomputeTeamCounts(rootId)` repairs it but currently only runs on account deletion.
**Exposing it as an admin repair button is the fix** — not attempted here, since it was
not asked for.

**`/team/stats` is the most expensive read in the app** — it walks the downline three
levels for team deposits, runs a second full query for the active-L1 count, and sums
every `team_reward` transaction the member has ever had. The live loop had it on the 5s
beat (and on Referral as well as Team), which multiplied the heaviest endpoint by every
member sitting on those screens. It now has its own 30s beat (`LIVE_TEAM_MS`); team
figures move when someone joins or invests, which is minutes, not seconds. The wallet
balance stays on the 5s tick, because that is the figure that actually needs to be live.

### Snow residues that were still live (round 2)

The first sweep covered wording a member reads. These were *functional*, and each one
silently sent something to the wrong platform:

- **`guard-src.js`** — the frame-bust redirected to a hard-coded `https://chn-snow2beer.com/`.
  A framed Chipz app therefore sent its own members to a different product. Now busts to
  `window.location.href`, which is also simply correct: the app will get a custom domain
  one day and a constant would be wrong again that day.
- **`admin/sw.js`** — initialised **Snow's Firebase project** (`snow-beer-cbf65`), so the
  admin panel's background push handler was registered against a different project
  entirely and could never receive a notification. Now matches `FIREBASE_CONFIG` in
  `admin-src/index.html`; a service worker cannot import from the page, so the values are
  necessarily duplicated and must be kept in step by hand.
- **The admin app icon** — `admin-src/index.html`, `admin/manifest.json` and
  `admin/sw.js` all read the local `/icon-192.png` that ships in the repo, while the user
  app had been moved onto the server-hosted, admin-uploadable
  `/public/app-icon-{192,512}.png`. That is the whole of the owner's *"why also the app
  icon of admin never changed?"* — the upload worked, the admin just wasn't looking at
  it. All three now point at the server. `test-brand-assets.js` asserts it for every file
  that names an icon.
- **`sms-forwarder-app/`** — the sharpest of the lot, and three separate faults:
  `DEFAULT_URL` posted deposit SMS at Snow's backend
  (`mylifeismyhappiness.onrender.com`); `UpdateChecker` polled Snow's GitHub release tag,
  so a Chipz admin phone would have offered Snow's next build **as an update to itself**;
  and the package id `com.snowplatform.smsforwarder` was byte-identical to Snow's, which
  Android treats as the same application — the two could never coexist on one phone,
  installing either silently repointed that phone's SMS at the other platform. Now
  `com.chipzplatform.smsforwarder`, Chipz's server, tag `chipz-sms-app`. A rename means
  it installs fresh rather than upgrading, so its settings are entered once more.
- **There was no workflow building it at all.** `.github/workflows/build-chipz-sms-apk.yml`
  is new — the fork copied the app but not its pipeline, so the only Chipz forwarder that
  could ever have existed was a sideloaded Snow APK. It carries a "the fork is fully
  renamed" step that greps for Snow's package, server and release tag; the strings are
  deliberately **not** spelled out in nearby comments, because an assertion matching its
  own explanation has failed here four times already.
- Snow's wine `#941827` survived in three spots (the forwarder's launcher icon, the
  guard's console banner, the admin's `theme-color`) — all now Chipz red `#e21b2a`.

What is deliberately left: fork-history comments, `test-cors-origins.js`'s assertion that
Snow's domain must **not** reach Chipz, and the `--snow-*`/`snow_*` internal names the
branding test already documents as carve-outs.

### The Deposit screen: green chips, a heavier chevron, and the redirect loader

Owner: *"that arrow with black check it is classic and well defined, also see clearly
those mockups every amount card on deposit has some green ... also see critically after
confirm deposit a loader saying Redirecting to payment. Check critically rather than
guess."*

His screenshot and ours are both **720 px wide**, so device pixels compare directly
(720/390 = 1.846 per CSS px).

**The chevron was nearly right already** — 23 × 37 in both, same gradient. The only real
difference was weight: a **14 px** run at mid-height against our 12, so `stroke-width`
went 4.2 → 4.9. That is the whole of "well defined".

**There is no black on his arrow.** The dark pixels in his close-up are the phone's
status bar: 3,312 of them, **zero touching the mark**. Checked before adding an outline
that would have been wrong.

**The green on the amount chips, measured by walking out of a chip's edge:** a 1 px
border at `rgb(203,214,206)` — a light green-grey, where ours was the warm
`--snow-border` — and outside it a shadow peaking near `rgb(227,243,232)` against a
`rgb(247,246,241)` page, fading over ~10 device px. It **darkens red and blue while
leaving green almost untouched**, which is what makes it read as green rather than grey.
Ours now renders `(203,217,207)`, G−R **+14** against his +11..+16.

**The loader** is up only while `/deposit/marzpay` is genuinely in flight, and comes down
in a `finally` — a rejected recharge that left it covering the form would be a worse bug
than the missing loader was. His mockup dims to a dark wash; this uses a light scrim in
the app's paper instead, because *"use app color and theme not dark"* was a standing
instruction from the poll-screen round and a dark sheet two screens apart would
contradict it.

**Two test traps hit here, both worth knowing:**
- `page.evaluate("submitDeposit()")` returns the async function's **promise**, which
  Playwright awaits — so the "mid-flight" check ran *after* the request resolved and read
  the loader as absent. Fire it as `evaluate("()=>{ submitDeposit(); }")` instead.
- `r, g, b = _px[...]` **shadowed the browser handle `b`** in that scope. Every assertion
  still ran and passed; the run then died on `b.close()` at the very end with
  `'int' object has no attribute 'close'`. Never unpack a pixel into `b` in these files.

### A deposit with no phone number: `||` treated empty as absent

Owner: *"why when one didn't put number, it just continues to poll ... l tried to leave
not putting number and clicked confirm deposit but it didn't reject it just continued to
go to poll page. please make sure no loopholes."*

**Two faults stacked, and the second is the one that mattered.**

1. `submitDeposit()` validated the amount and simply never looked at the phone.
2. Both deposit routes resolved the number as
   `cleanPhone(req.body.phone || uSnap.data().phone || '')`. **`||` treats an empty
   string as absent**, so a blank field did not fail the `if (!phone)` check below it —
   it fell through to the account's own registered number, a real deposit was created,
   the route answered success, and the app went on to poll a prompt nobody asked for.
   It also produced the broken **"Payment prompt sent to +256"** with no digits, because
   the client's display fell back to a bare country code.

`depositSenderPhone(body, accountPhone, keys)` is now the single rule for both routes.
The distinction it draws: a field **sent but empty or malformed** is a member who has not
filled the form in and must be told; a field **not sent at all** is a caller that never
had one, and the account's number is a sound answer for it — so that fallback survives,
and only that. `senderPhone` is read before `phone` on the manual route, so a caller
sending both cannot slip a different number past by blanking the one that is read.

The client checks it too now, through the **same `cleanPhone()`** the server uses so the
two cannot drift — but that is a courtesy: `/deposit/marzpay` is a plain authenticated
POST and the body is whatever the caller sends.

Audited alongside it, and sound: **`submitWithdraw()`** already refuses a bad amount, a
non-multiple, a missing bound wallet and a malformed 6-digit Trade Password.

`test-deposit-phone.js` runs the real helper (empty, whitespace, half-typed, wrong
prefix, `0`, `false`) and asserts the refused input **never becomes the account's own
number**. `test-pay-poll.py` drives the real form with the field blank and asserts what
actually went wrong: **no request is sent** and **the poll page does not open** — checking
only for an alert would pass on a build that still fired the deposit.

### The recharge poll is a PAGE in the app's colours

Owner: *"l nolonger need those old poll designs ... when one taps deposit, it should open
a new page for polling, so for polling it should show the other 4 triangles rotating,
just like those which we placed on running product, so it will be enlarged ... l nolonger
need those dark things, use app color and theme not dark, also for success use exactly
that and failed use that ... however still nav icons should exist on the poll payment
page."*

**Presentation only — the polling state machine is untouched.** All five setters
(`setDepositStatusPending/Success/Failed/Review/Unknown`) still write into the same
`#depStatusIcon` / `#depStatusTitle` / `#depStatusBody`; what changed is what those look
like.

- **Its own classes** (`.pay-page` / `.pay-card`), NOT a restyle of
  `.chest-modal-bg` / `.chest-modal` — those are shared with the gift-code win modal, and
  recolouring them here would have silently redesigned the chest too.
- `background:var(--snow-canvas)` and `bottom:var(--nav-h)`. That inset is the app's own
  convention for "leave the bottom bar alone" (`.sheet-bg` and `.msg-detail-bg` both use
  it) and is what keeps the nav icons **visible and tappable** while a payment polls —
  the old overlay was `inset:0` and swallowed them.
- The polling mark reuses **`PLAN_SPIN`**, the same orbiting-chips markup the ongoing
  plan rows carry, enlarged purely by CSS (`.dep-status-icon .pspin{--s:150px}`) — every
  length in `.pspin` is a fraction of `--s`, so one mark and one set of keyframes serve
  both sizes.
- Success and failure are the owner's own artwork, `user/pay-success.png` and
  `user/pay-failed.png`, cut out by flood-filling the white page inward from the border
  (never a global white→transparent — both marks enclose white of their own). Checked for
  stock watermarks before use and found none; he confirmed they are his.

`test-pay-poll.py` reads the things that were actually complained about from **pixels and
geometry**, not class names: mean luminance of the page (241 — "not dark" is a property
of what reaches the screen, and a stray inherited rule could darken it while every
declared value still looked right), the nav hit-tested with `elementFromPoint` rather
than merely "on screen", the chips mark sampled over real frames so a keyframe name
cannot pass for motion, and both result images asserted to have actually **loaded**
(`naturalWidth > 0`) rather than just to be referenced.

### Account ids are five digits

Owner: *"let the user id be having 5 characters, so so far now the current account is
000001, so remove first 0 so it will be 00001."*

`PUBLIC_ID_DIGITS = 5` in `server.js` drives `nextSequentialPublicId()`'s `padStart`.
`padStart` is a **minimum**, so account 100,000 becomes six digits rather than wrapping
round onto an id someone already has.

**Changing the constant only governs ids handed out from now on.** Anything already
stored has to be rewritten, and a publicId is an identifier a member may already have
been told — so that is an explicit admin action, not a boot-time migration:
**Admin → Users → "Shorten account ids"** (`POST /admin/users/shorten-public-ids`).

Two rules it will not break:
- Only ids that are **pure padding** change. `000001 → 00001`; `100000` stays, because
  shortening a six-digit *value* would change which account it names.
- A target another account already holds is **skipped and reported**, never written.
  Two members sharing an id is far worse than one keeping a longer one, and it cannot
  be undone by re-running.

`test-public-id.js` lifts both conditions out of `server.js` rather than restating them,
and runs 200,000 ids through the shortener checking that each still reads as the same
number and none collide.

### Logging out stayed logged in — there are TWO auto-login routes

Owner: *"why is it that when l try to log out the app logs in automatically again
because the cached credentials autofills hence triggering auto login yet l don't want
to use that very account."*

`doLogout()` disarmed only the first of two:

1. **Credential Management silent sign-in** — handled, via `preventSilentAccess()`.
2. **The autofill auto-submit** — not handled. Back on the login screen, Chrome refills
   the saved phone/password, that fires the `onAutoFillStart` animation, and the
   listener calls `doLogin()`: straight back into the account the member just left.

And `doLogout()` ended with `window._autofillLoginTried = false`, which **re-armed** that
listener for exactly the moment Chrome was about to refill — the logout made the bug
*more* likely, not less. It now sets `_suppressAutofillLogin`, which `maybeAutoSubmit()`
checks first, and nothing clears it: after "log me out", no amount of refilling should
sign anyone in without a tap. Logging back into the same account still takes one tap.
The login fields are also cleared after the sign-out; Chrome may refill them and that is
fine, since filled fields only matter when something submits them by itself.

`test-logout.py` dispatches the same `animationstart` Chrome's own fill produces, against
a Firebase stub whose `signOut`/`signIn` really flip the current user, so an unwanted
auto-login is observable exactly as on the phone. Reverting the fix reproduces the report
precisely: one sign-in call, back inside the account. **A test that only checked
"doLogout calls signOut" would have passed against the broken app** — it did sign out,
and was then signed back in.

### The hardening round: what was already there, and the five things that were not

A full security pass was run against the project. **The most useful outcome is how
little was missing** — most of what a payment-platform checklist asks for was already
built, and a from-memory audit had wrongly called several of these gaps. Do not
re-"fix" them:

| already present | where |
|---|---|
| Multi-layer rate limiting (global 400/min per user, IP-only 900/min that a forged uid cannot evade, 60/min on every money route, 8/min on admin login) | `server.js` limiter block |
| Per-admin accounts, scrypt-hashed, 12h sessions, revocable per person | `scryptHash`/`createSession`/`resolveSession` |
| Admin audit log of every action, with actor and IP | `logAdminAction()` → `adminAuditLog` |
| Timing-safe comparisons + a dummy hash so a bad username costs the same as a bad password | `safeEqual`, `DUMMY_PASSWORD_HASH` |
| NoSQL operator injection stripped from every body | `stripMongoOperators()` |
| Body-size caps per route class (64kb / 4mb / 13mb) | the three JSON parsers |
| Webhooks never trusted — the credit decision always comes from an independent provider re-check | `/deposit/callback`, `/withdraw/callback` |
| Login lockout, deposit-attempt bans, security event log | `loginLocked`, `banUserAutomatically`, `logSecurityEvent` |
| Headers on all three origins | `helmet(...)` + `render.yaml` |
| HTML escaping helper, used | `esc()` in `original_module.js` |

**What was actually missing, and is now done:**

1. **Uniqueness was enforced only by application code.** Six values are generated by a
   *check the database, then write* loop — `referralCodeLower`, `publicId`,
   `promoCodes.codeLower`, both `marzReference` fields and `lipaOutTradeNo`. That is not
   atomic, and the worst case is not theoretical: `findUserByReferralCode()` takes the
   FIRST match, so two members sharing a referral code sends one person's commission to
   the other — real money, silently misrouted. They now have **unique indexes** in
   `db.js`. Each is `partialFilterExpression: {field: {$type:'string'}}` — without that,
   a unique index treats every document *missing* the field as sharing one null and
   rejects the second, which would block manual deposits (no `marzReference`) outright.
   Each also carries its own `*_unique` name so it coexists with the plain index of the
   same shape already built on the live cluster instead of failing with
   IndexOptionsConflict on every deploy.
   **A unique index that fails to build is now an `console.error` with a summary**, not a
   warning among thirty startup lines — it fails for one interesting reason (the
   duplicates it was added to prevent already exist) and that is a finding.

2. **A real CSP.** It was three directives (`frame-ancestors`, `object-src`, `base-uri`)
   — which stop framing, and do nothing about the attack that matters here: injected
   script reading a balance or Trade Password and POSTing it to the attacker's server.
   Now a full policy with **`connect-src` as the point of it**, in `render.yaml` **and**
   as a `<meta http-equiv>` in both `index.html` files. Both, deliberately: the frontend
   also deploys to EdgeOne, where a Render header cannot follow it, and a meta policy
   cannot express `frame-ancestors`, which is why the header stays.

   **`'unsafe-inline'` in `script-src` is required** — build-core.js ships the app as one
   inline `<script>` whose content changes every build, so no hash can cover it.
   **`'unsafe-eval'` is deliberately absent, and that costs one expected violation per
   load**: `disableConsoleOutput: true` makes javascript-obfuscator emit
   `try { Function('return this')() } catch { window }`. The browser blocks it, the catch
   assigns `window` — the same object — and the bundle carries on. Do **not** add
   `'unsafe-eval'` to silence it; that would hand injected script the ability to build
   code from a string, in exchange for a warning that changes nothing.

3. **`/health` was exempt from every limiter** — unauthenticated, guessable by design,
   and it calls `pingDb()` on each hit, so it was the cheapest way to make this server
   hammer Mongo. It now has its own 300/min limiter. It cannot simply join the others:
   a 429 to Render's health checker reads as "service down" and pulls the backend out of
   rotation.

4. **`Permissions-Policy`** on all three origins (camera, microphone, geolocation,
   payment and four more denied). helmet has no setting for it, so the API sets it by hand.

5. **Nothing checked anything before a deploy.** All three services are `autoDeploy:
   true`, so a push *is* the deploy. `.github/workflows/chipz-tests.yml` runs `npm ci`,
   `npm audit --audit-level=high` and every `test-*.js` on any change under `chipz/`;
   `.github/dependabot.yml` watches the npm tree weekly and the actions monthly. The
   Playwright half is deliberately left out — it needs a browser and a built page, and a
   slow flaky gate is one people learn to ignore. `--audit-level=high` rather than
   moderate for the same reason (11 moderate advisories exist today, all in build-only
   dependencies).

**Two tests, and the second is why the first is worth anything.**
`test-security-hardening.js` **evaluates** the specs array out of `db.js` and **parses**
the CSP into directives rather than grepping — a string match would pass on a policy that
merely mentions `connect-src` while allowing `*`, and on a unique index missing its
partial filter. Every assertion was proved to discriminate by re-breaking the change
(dropping a partial filter → 2 fail, widening `connect-src` to `https:` → 6 fail,
adding `'unsafe-eval'` → 2 fail, reverting `/health` → 1 fail).

`test-csp-runtime.py` **runs the built app under the real policy**, because a policy can
be perfectly worded and still take the product down, and **a CSP violation is not a page
error so `smoke-test.py` cannot see it**. It walks every tab and sheet with a
`securitypolicyviolation` listener and requires zero unexpected violations — then
deliberately attempts a script load and a POST to an attacker origin and requires **both
to be blocked**, so the first half cannot pass vacuously against an unenforced policy.
**It immediately caught something static reading had missed**: the `Function('return
this')` helper above. Grepping `build-core.js` for `eval` finds nothing — the call is
inside the deflated base64 payload.

### Still outstanding, and not code

- **Rotate the Atlas password** (it was exposed in chat earlier in this project) and the
  `ADMIN_KEY` with it. Nothing in the repo can do this.
- **Set the MarzPay/LipaPay keys in Render** — until then a correctly-filled deposit
  still ends on the red mark, because the provider refuses the request.
- **Test a database restore once.** Atlas Flex takes backups; an untested backup is a
  hope, not a control.
- **No error tracking or uptime alerting.** The payment-key outage was found by trying a
  deposit by hand.
- **One environment.** Every change is reviewed in production, on live member data.
- **No self-serve account deletion.**

### The recharge status page: new copy, a header, working nav, and Verify

Owner: "change this, we need to use new words, even on success and failing, not the
same words as old ... include nav arrow '<', and its title space ... why the nav icons
don't work when on payment page ... add a button saying verify, so one can tap it but
it should not stop autopolling, also they should not call at the same time to strike
api of payment provider."

**The copy.** The pending state is now the owner's own four numbered steps, verbatim, as
a real `<ol>` (`.pay-steps`) rather than one paragraph -- the old wording buried "approve
it on your phone", the single line that actually needed finding, mid-sentence between
two facts. Left-aligned inside the otherwise centred card, because centred list items put
the numbers out of line with each other. All five states were reworded: *Payment
confirmed* / *Payment not completed* / *Still waiting for the provider* / *We are
checking this payment*. `test-pay-verify.py` sweeps every old phrase across all five
states in one pass, so none can quietly come back.

Two judgement calls worth keeping:
- **The USSD fallback stayed.** The four steps replaced the paragraph, but the
  "dial *165#" note was the owner's own earlier explicit ask (the MoMo push prompt
  genuinely does fail to arrive), and without it a member is stuck staring at step 2 with
  nothing to do. It is a `.pay-note` footnote, deliberately NOT a fifth step.
- **The failure copy says the CHIPZ balance did not change, and nothing about the
  member's mobile money account** -- this app cannot see that account, so "nothing has
  been taken" would be a guess about someone else's money. The test asserts that phrase
  is absent.

**The header** reuses `.sheet-head` verbatim, so it IS the app's header rather than a
lookalike. Its chevron gradient gets its own id (`chipzBackPay`) -- two `<linearGradient>`
elements sharing an id is a duplicate-id bug, harmless only until one of them changes.
`.pay-page` became a flex COLUMN with a `.pay-body` that takes the remaining height, so
the card centres below the header instead of half a header-height low. `#depStatusBody`
had to become a `<div>`: an `<ol>` inside a `<p>` is invalid and the browser reparents it,
dropping the list out of the card entirely.

**The nav bug was the message-detail bug again.** `showPage()`'s teardown carried a
comment claiming the deposit result was `inset:0` and therefore unreachable -- true when
it was a dark modal, and stale the moment the round that made it a themed page gave it
`bottom:var(--nav-h)` so the bar would stay visible. So the tap landed, the page behind
changed, and the payment page stayed on top: the app looked frozen. `#depStatusBg` is now
in that teardown, and **deliberately not counted in `spent`** -- it pushes no history
entry, so retiring one would walk the member off the app's first entry and out of the
app. Closing it does not stop the poll; the payment is still live at the provider.

**Verify is a single-flight, not a mutex.** `/deposit/marzpay/status` makes the server ask
the provider, so two at once is two hits for one answer -- and a manual tap is most likely
to land exactly while the 3s autopoll is mid-request. `depositStatusCheck()` hands a
caller arriving mid-request the SAME promise instead of refusing it or starting a second:
the tap is never ignored, the poll is never interrupted, the provider is never asked
twice. Both callers can therefore resolve on one response, which is why
`applyDepositStatusResult()` is idempotent (`_depPollDone`). Verify stays available in the
"still waiting" state -- that is the autopoll spending its 60s budget, not the payment
ending, so removing the one control that can still resolve it would be backwards.

Two ordering hazards were closed while in here, neither reported: the poll loop now bails
when `_depActiveDepositId` moves on (deposit A's loop would otherwise write over deposit
B's page AND set the shared done-flag, stopping B's loop), and the manual path clears
`_depPendingAmount` so the success copy cannot name a figure from an earlier automatic
recharge.

**"They should not call at the same time" is a concurrency property, and no amount of
reading the source proves it.** `test-pay-verify.py` stubs the status endpoint with a real
1.2s delay, counts requests in flight on arrival and departure, and taps Verify nine times
straight through the autopoll's ticks: peak concurrency must stay at 1 while requests are
demonstrably still being made and the poll is still running afterwards. Verified by
reverting the single-flight -- **peak goes to 2** -- and by reverting the teardown, which
reproduces the owner's report exactly.

**A route-ordering trap, caught by its own guard.** Playwright gives precedence to the
route registered LAST, so registering the status stub before the catch-all let the
catch-all answer it: the counters never moved and "peak <= 1" passed having measured
nothing at all. The companion "requests really were being made" assertion is what caught
it. Register specific routes AFTER general ones in these files.

### The CI gate's first real run went red, and it was right to

The workflow added with the hardening round failed on all four of its runs. It was
not the workflow: `npm ci` and `npm audit` passed, and it reported `1 test file(s)
failed` -- correctly.

`test-cors-origins.js` opened **server.js by absolute path**, hardcoded to the one
directory it happened to be written in. On a GitHub runner the checkout is somewhere
else entirely, so it died with ENOENT. **28 test files carried the same baked-in
prefix**; only that one is in the Node gate, which is why exactly one failed. Every
one of them had "passed" forever, because they had only ever run from a single
machine in a single directory. A test that cannot move is a test that is only
checking where it lives.

All 28 now resolve from `__dirname` / a `HERE` computed off `__file__`, and
`test-security-hardening.js` grew a guard that fails if ANY test file hardcodes an
absolute checkout path -- matched on `/home|/Users|/root`, not on one specific
prefix, since the next one will be someone else's.

**Three mistakes in the fix itself, all of which the suite caught:**
- The guard flagged **itself**: its own comment quotes an example path, and a plain
  scan cannot tell an offending line of code from a sentence describing one. It now
  strips comments and docstrings before scanning -- the same trap
  `test-no-snow-branding.js` already documents.
- Inserting `HERE` after the *last* import put it **below its first use** in two
  files that carry a mid-file `import re as _re`.
- Inserting it after the first line matching `^(import|from)` put it **inside the
  module docstring** in three files, where it never executes at all --
  `test-button-glow.py`'s docstring contains the line *"from right to left."*. The
  fix is to find the first real import with `ast.parse` rather than a regex, and then
  assert via the AST that `HERE` is a genuine top-level assignment.

**How to verify this class of change: run the suite from somewhere else.** Copy the
tracked files (`git ls-files chipz .github`) to a temp directory, drop node_modules
in, and run the Node suite there. That reproduces what the runner does, and it is the
only check that would have caught the original bug before it was pushed.

### The invite link is /refCode=, and manual deposits are human-verified

Owner: "let the link be '/refCode=' not other more words also the manual payments, ie
deposits, this time no use of forwarder sms app, only the sent message from after
refresh on manual payment page should appear to admin panel in its full details so as
admin verifies manually or rejects."

**The link is now `<origin>/refCode=<code>`** -- no `#pages/register`, no query string.
That is a real URL **path**, so the host has to answer it with index.html:
`render.yaml` carries ONE rewrite, scoped to `/refCode=*`. The file's own long-standing
"no SPA rewrite" note still holds for everything else and says why -- a blanket `/*`
rule in front of sw.js, the manifest and the nav PNGs is a real risk. **If the frontend
is uploaded to EdgeOne, the same single-path rewrite must be configured there or every
invite 404s on that host while working fine on Render.**
`captureReferralFromUrl()` reads the code off `location.pathname`, and both older forms
(`?ref=` and `#...?ref=`) still work on purpose -- links already sent to real people are
out of our hands and must not start failing.

**Manual deposits no longer credit automatically, by any path.**
- `settings.manualSmsAutoCredit` defaults to **false**, and the forwarder route checks
  it *before* `creditDeposit()`. A confident automatic match is still matched and its
  evidence attached -- it just lands in Needs Review instead of moving money. The route
  was gated rather than deleted so the matching work survives and it is reversible from
  a setting; what it can no longer do is pay someone silently.
- **`/deposit/manual/paste-sms` no longer refuses text it cannot parse.** It used to
  answer 400 with "that doesn't look like a mobile-money message" and store NOTHING, so
  a real payment whose SMS wording this parser does not recognise -- a new operator
  template, a forwarded or edited message -- simply vanished and the member had no way
  to be paid. The human is the judge now, so the route's job is to deliver what they
  sent, intact, not to sit in front of the admin deciding what is worth passing on. It
  stores the raw text plus `pastedSmsParsed:false`. **What did NOT change: it still
  never calls `creditDeposit()`.** An unparsed message is *less* trusted, not more.
- The paste box on the manual payment page ships **visible** instead of being revealed
  only after an unresolved Refresh. With nothing matching automatically any more, a
  refresh that can never resolve on its own was just a step in front of the one control
  that can.
- The admin Deposits tab renders the message **in full** under the row: a pre-wrapped,
  scrollable `<pre>` (never truncated -- the transaction id sits at the END of an
  operator SMS, which is exactly what a "…" would cut), plus the amount/id/counterparty
  cross-checks in green or red, and a loud note when the server could not read it.

**The strongest assertion runs the real route.** `test-manual-review.js` executes the
actual `paste-sms` handler against a stub database and reads what it wrote -- grepping
for the absence of a `res.status(400)` would prove nothing about what lands in the
document. Junk text must come back 200, `status:'review'`, `pastedSms` byte-identical to
what was typed. Verified by restoring the old refusal: **6 assertions fail.**

**The same self-matching trap bit three times in one session** -- a check whose own
comment contains the thing it scans for. `test-security-hardening.js`'s portability
guard flagged itself; then the "route never calls creditDeposit" check matched the
comment saying it never does; then the forwarder-gate check matched the comment naming
`manualSmsAutoCredit` and stayed green with the gate deleted. **Strip comments before
any "does the code do X" scan**, and prove it by deleting the code.

**Two older assertions were deliberately retired, not loosened.**
`test-referral-share.py` required the URL to wrap to two lines -- true of the mockup only
because the link used to be long. It now asserts the field's 66px height and its
*ability* to wrap (clamp 2 + `overflow-wrap:anywhere`, which a custom domain will need
again) rather than a wrap that no longer happens. `test-round-fixes.py` accepted any
`ref=Gy2f` substring, which `/refCode=Gy2f` satisfies by accident -- it was tightened to
the exact form so the old long link cannot come back unnoticed.

### One Deposit screen, an orange panel, and the logo where the logo belongs

Owner: "we still have old designs of deposit page, see our current one but see the old
residue pages, l no longer need them we have that new one, so for option b it will be
PAY B, so remove all those pages of old stuffs of kpay and others, also admin panel
still has old red color instead of orange plus logo on dashboard and authentication
screen should match the one uploaded from admin, that gif which appears on profile icon
should be logo."

**There were THREE deposit screens, and the SETTINGS chose between them** -- not the
design, not a route, not anything visible. `openDepositSheet()` branched on which methods
were enabled: the current Deposit design for PAY A alone, an old Snow-inherited
"Recharge" whose payment method read **K-pay** for PAY B alone, and a third old
"Recharge" carrying a PAY A / PAY B list when both were on. So the owner could meet a
screen he had already replaced simply by switching PAY B on. Now there is **one**
`openDepositFormSheet(payA, payB)`; only the method rows inside it change, labelled
`PAY-A` and `PAY B`. Both dead builders are deleted, along with
`depositQuickAmountsHtml()`, the `.quick-amt*` / `.pm-selected-*` / `.pm-choice-row` CSS
and `syncDepositQuickAmt()`'s branch for the row that no longer exists.

Three details worth keeping:
- **Preselected when only one method is live**, nothing preselected when both are --
  a radio group with a single option is not a choice.
- **A blank Payment Phone is refused on BOTH methods**, and the check lives in
  `submitDepositChoice()` -- one rule, one place, before the branch. Owner: *"when pay b
  is selected and no putting number, it just continues to payment page why???"* Only the
  PAY-A branch validated it; `proceedToManualPaymentMethod()` checked the amount and
  nothing else, on the reasoning that the manual overlay collects its own number on the
  next screen. That reasoning does not survive contact with the screen: the field is
  visible for every method, so leaving it blank and sailing through is the same loophole
  he had already caught on PAY-A. `submitDeposit()` still repeats both checks -- that one
  guards the request being sent, this one guards the form.
- **The Payment Phone field is ALWAYS shown**, for every method and every combination.
  A first pass hid it for PAY B, reasoning that the manual overlay collects a number on
  its own next screen; the owner overruled that -- *"l want even if pay a or b, the
  payment phone should be there ... only that one will be typing the number twice on
  manual payments, so don't mind with that"*. He is right about the trade: a section
  that appears and disappears as the radio changes reads as the form breaking, and a
  duplicate entry is the smaller cost. PAY B ignores the value; its own screen collects
  the number it actually uses.
- **The instruction card never changes.** Same four lines on every method -- owner:
  *"even deposit instructions shouldn't change please it should use that new one, no
  changing."* A conditional PAY B line was added in the first pass and removed here; the
  test now compares the rendered list across all three combinations and requires them
  identical.
- `submitDeposit()`'s failure path restored the button to **"Recharge"** -- a label
  belonging to one of the deleted screens -- so a member whose recharge failed watched
  the button silently rename itself. It restores "Confirm Deposit" now.
- **PAY B raises the same "Redirecting to payment…" loader as PAY-A** (`showDepRedirect`).
  It used to swap the button's label for a small in-button spinner, so the same tap on
  the same button looked like "going somewhere" on one method and merely "busy" on the
  other. Lowered once the manual overlay is actually up, and the button re-enabled --
  this sheet is not destroyed, so an un-restored button stays disabled if the member
  backs out and returns.

**The admin panel is orange**, `--gold:#ef6c00` (was `#e21b2a`), a value-only token swap
like every other reskin here. Deliberately NOT the app's own `#ff8a1f`: `--gold-ink` is
white, white on `#ff8a1f` measures 2.35:1, and this token backs filled buttons with white
labels. `#ef6c00` reads as the same orange at about 3.9:1.

**Both admin marks now show the admin-uploaded Brand logo.** They were hardcoded SVGs --
the login screen's was still *Snow's* inherited swoosh -- so uploading a logo changed the
member app and left the panel showing something else. `applyAdminBrandLogo()` reads
`/public/chipz-images`, and it uses the PUBLIC endpoint on purpose: the login screen has
to draw before anyone has signed in, so it cannot depend on a session. Failure is silent
and the existing SVG stays; a panel that will not paint its header because a logo fetch
failed would be a far worse trade.

**The profile icon is the GIF. Leave it alone.** A round read "that gif which appears on
profile icon should be logo" as an instruction to replace it, and demoted the GIF behind
the Brand logo on the Account card. It was not that: the sentence was about the ADMIN
PANEL's own marks -- its dashboard and login screen should show the uploaded logo, which
they now do. The owner's reaction on seeing it gone was **"NOOOOOOO, PLEASE PUT IT BACK"**,
and it is back: GIF, then Brand logo, then the CHIPZ wordmark, with `has-gif` keeping it
from being cropped to a circle. It renders in BOTH places -- the profile card and the Home
idle strip. If this ever looks like a candidate for change again, it is not.

Both tests covering it now serve a Brand logo AND a GIF in the same fixture, so "the GIF
is there" cannot pass just because the logo happens to be missing.

**Checking only the case that already worked would have proved nothing.**
`test-deposit-one-screen.py` drives the built app three times, once per PAY combination,
because PAY-A-alone was the one combination that was already right. Reverting PAY-B-only
to an old "Recharge" fails 4 assertions; reverting the profile icon to the GIF fails 2;
reverting the panel to red fails the colour check. The colour is asserted as R>G>B with
real green in it rather than as a hex string, so a future retune of the same hue does not
fail it.

**Two test lessons, both about measuring in the wrong place.**
- `test-profile-gif-render.py`'s rendering-quality checks were **re-targeted to the Home
  strip rather than deleted** -- aspect, transparency and animation are still worth
  pinning, just where the GIF now lives. Its "never blown up" check was **not** carried
  over: that was a property of the 60px circular slot, and asserting it against a
  deliberately large strip would be asserting against the design. It was replaced with
  the constraint that actually matters there -- the strip must not push Home into a
  scroll, which is the bug that position really had.
- Its animation check compared **one pair of frames 700ms apart** and reported a running
  GIF as frozen. `locator.screenshot()` made it worse: an element screenshot waits for
  the element to look stable, so two come back byte-identical on a working animation. Six
  viewport clips over three seconds, any two differing (measured: 3 distinct of 6).

**The Playwright route-precedence trap bit again** -- a specific route registered BEFORE
a catch-all never fires, because the last registration wins. Register the catch-all
first. That is twice in two rounds; it is in this file now for a reason.

### The Account list, measured off his mockup (and his own door on Log Out)

Owner: "l made that door icon myself, so just like my mock up put it on logout, even see
cards in account are very big plus their icons, please use exactly the size of mock up,
even see button size of withdrawal and deposit, see the settings card is having green
line, see closely on balance record icon it has some green in its background, check every
background of each icon, the first of download app it is purple, so here it should be
orange ... see closely rather than guess and implement."

His screenshot and ours are both **1080 device px wide on the same phone**, so device
pixels compare directly: 1080/390 = **2.769 device px per CSS px**.

| | his mockup | ours was | now |
|---|---|---|---|
| icon tile | 114 dev px | 146 (52 CSS) | **41 CSS** |
| row pitch | 193 | 250 (90 CSS) | **70 CSS** (41 + 2x14 padding + 1px rule) |
| row title ink | 30 | 35 (17.5px) | **15px** |
| Deposit / Withdraw | 141 tall | 58 CSS | **51 CSS** |
| Log Out | 146 tall | 54 CSS | **53 CSS** |
| his door glyph | 31 x 47 | — | **17px tall**, width auto |

**The "green line" is the CARD's own border**, not the rule beside the heading. Sampled
down his left edge it holds `rgb(236,243,235)` from the top of the card to the bottom --
G−R = +7. Ours was the neutral `--line-soft`; it is `#dceadd` now.

**Every icon tile carries its own background, and they are GRADIENTS, not flat fills** --
sampled top-left to bottom-right off his mockup:

| row | his top-left → bottom-right | ours |
|---|---|---|
| Download APP | (100,31,112) → (78,23,88) purple | **orange** `#b34700 → #8a3600` |
| Wallet | (255,209,12) → (232,195,78) | his, unchanged |
| Balance Record | (177,202,172) → (224,238,225) | his, unchanged (the green he pointed at) |
| Messages | (254,244,208) → (250,244,230) | his, unchanged |
| Login Password | (98,52,98) → (233,216,188) purple | **orange** `#a8480e → #e9d8bc` |
| Trade Password | (192,161,96) → (246,202,15) | his, unchanged |

Only the two PURPLE stops are translated, per the standing rule and his own instruction.
**Turntable has no counterpart in his mockup** (that row does not exist there), so it
takes a warm coral that sits between the gold above and the green below rather than
inventing a seventh hue out of sequence.

The tile's colour class is derived from the icon key (`.ic-<icon>`), so a row's
background cannot drift from the artwork sitting on it.

**The door is his own artwork**, cut out by flood-filling the white page inward from the
border -- the same rule as the spin wheel and the clipboard, never a global
white→transparent, because the door's own highlights are near-white and only survive
because they are enclosed. Downscaled to 105x160 (10 KB) for a 17px display, and added to
the service worker's SHELL precache.

**Two measurement traps, both of which reported a correct build as broken:**
- A **full-page screenshot places `position:fixed` elements by viewport, not document**,
  so the last row sampled as flat white on a tile whose gradient was demonstrably applied.
  Sample from a per-element viewport clip instead.
- `scroll_into_view_if_needed()` scrolls the **minimum** amount, which leaves the last row
  under the fixed bottom nav -- the clip then samples the nav's own pale surface. Use
  `scrollIntoView({block:'center'})`.

**And one trap in the verification itself, worth more than either.** Reverting the card
border to the neutral token appeared to produce **zero failures** -- because the colour
parser stripped `"rgb("` and choked on `rgba(239,224,211,0.72)`, so the test **crashed**,
and a crash prints no FAIL line. Counting FAIL lines therefore read a crash as a pass.
Parse with a regex, and when checking that an assertion discriminates, **check the exit
code, not the output**.

### The manual payment page speaks for itself (toasts + loaders)

Owner: "on manual payment page, l need those loaders, ie on redirect loaders after
finishing, l need to see such notifies, ie when one taps confirm but when no number or
operator set, and when invalid number is set, also that loader after putting number and
confirming, and also that loader after reaching final payment page ... loaders load data
ie payment numbers and names and others, also one mock up on invitation rewards, there is
no slash bar '|' on ours."

**The validation already existed; the way it spoke was wrong.** All three cases were
checked, but each called `notify()` — this app's alert dialog, with an OK button to
dismiss. His reference answers a mistyped field with a **centred dark toast** that says
its piece and goes. A modal that has to be dismissed to get back to the field you were
typing in is the wrong instrument for "you left this blank". `manualPayToast(msg)`: 2000
ms, **restarts rather than stacks** (three fast taps give one toast, not three), and
falls back to `notify(msg)` if its own elements are missing, so a message is never
swallowed by a markup change.

His reference's exact wording is kept: *"Please select the operator first"*, *"Please
enter your payment account"*, *"The mobile phone number format is incorrect."*

**Why `.mp-toast` is `position:fixed` and not a child of the card.** A comment in the
source records that the reference's own bottom-pill toast had already been removed once
for a real bug: as a child of `.reveal-in`, the stagger entrance animation permanently
overrode its `transform:translateX(-50%)` and its `opacity`, so it either sat off-centre
or never appeared. Scoped to `#manualPayFlow` and fixed with `inset:0`, it centres itself
the way `.mp-loading-overlay` always has, and the old bug cannot recur. z-index 30, above
the loader's 20 — a toast raised while the loader is up is exactly the case that must
still be readable.

**Three loaders, each covering a specific frame the member should never see:**
- `manualPayConfirm` raises it **synchronously before the await**, and lowers it in a
  `finally` rather than on the line after — a rejected init that left the overlay covering
  the form would be a worse bug than a missing loader.
- The init and status calls both use the same `try/finally` pair.
- `presentManualPayCodeScreen` raises it and lowers it on a **double
  `requestAnimationFrame`**, so the code screen never paints a frame with blank account
  number and holder name. On a page whose whole job is "send money to THIS number", a
  flash of empty fields is the worst possible thing to show.

**Two assertions that needed care to be true rather than lucky:**
- The mid-flight loader is read **in the same page task as the call**. Its raise is
  synchronous and the request resolves on a later tick, so a Python-side read after the
  click races it and would report a working loader as absent.
- The code screen's loader is sampled **inside** the double-rAF window by an rAF loop in
  the page, not after it.

**A wrong test case, not a wrong app.** The first run failed "invalid number" because the
fixture typed `7373` and expected *"format is incorrect"* — but four digits is caught by
the length check first and correctly reads as an **unfinished** field, not a wrong one.
The format message needs a full-length number that is not a mobile: a Kampala landline
(`0414123456`) or an unused `07x` prefix (`0719968158`, since `UGANDA_MOBILE_PREFIXES`
omits 71/72). All three cases are now separate assertions.

**The Invitation Reward accent bar** — his mockup has the same `|` the Account sections
carry, ours had none. A 4x17 `.inv-bar` span reusing `--chipz-grad`, asserted on width,
height, left-of-heading position and the gradient itself, so a flat-colour regression
fails too.

`verify-mp-feedback-discriminates.py` proves the point by really breaking the app five
ways — toasts back to `notify`, each of the two loader raises removed, the bar deleted,
the bar's gradient flattened — rebuilding each time and judging on the **exit code**, per
the lesson directly above. All five are caught.

### The banner bleed, the green behind the numbers, and the last Snow icons

Owner: "on login and register pages there should be like whites or color bleeding into
the image of banner uploaded from admin panel, just like you see the first image ... also
on team there are some green behind the number, see our mockup on percentage and number
of team, some green is there behind numbers, see clearly rather than guess ... also in
admin panel still has old svgs and icons ie that slanting 8 and that ladder svg on the
home, please let it be chipz logo ... also l want when l put pay b let it return to A in
userpanel not just to b, so when l put a single 1, it should be A ... also make sure that
manual payments are matching very well on orders generated ie mtn to mtn, airtel to
airtel ... also make sure that messages are sent correctly in full to admin panel."

**The banner fades into the card, and it is a SCRIM, not a mask.** Masking the photo out
would reveal the orange gradient beneath it, which is not "white bleeding in".
`.auth-hero::after` ramps to `var(--snow-surface)` over the bottom 55%, at z-index 1 —
over the photo (0), under the wordmark (2). Measured off his reference: the pixels stop
varying about 80 device px before the bottom and the last ~160 are one continuous ramp,
so the stop is at 88%, solid well before the edge, not a short fade near it. **Only when
a banner is set** (`.has-bg`, toggled in `applyAuthBackgrounds()`) — a fade on the plain
gradient hero would restyle a screen he already approved. Asserted by SAMPLING the
rendered hero, not by reading the CSS back: a gradient on a transparent element, or one
painted under the photo, reads as present and shows as nothing.

**The Team glow is green — his reading, not the earlier one, and the numbers say so.**
An earlier round measured this and concluded the halo was in the glyph's own hue, with
green only on the card edge. That sample was taken too far out: (212,228,244) against a
(223,229,245) fill, a flat −11/−1/−1 that reads as plain darkening. Sampling for the
MAXIMUM instead: **(176,220,219) against (197,230,249) — −21 red, −10 green, −30 blue.**
Blue falling three times as fast as green is a hue shift, not a shadow. Solved back
through normal compositing at 20–30% that puts the glow's own colour between (92,180,99)
and (127,197,149), a medium leafy green: `--team-glow: rgba(45,170,85,.42)`, one token
for both figures. The 18px geometry was already right — his halo dies out 10–25 device px
from the stroke, which at 1.846 device px per CSS px is exactly an 18px blur's reach.
Both tests assert on CHANNELS, never on a colour name, so a retune of the same hue passes
and a drift to another hue does not.

**Both app icons were still Snow's snowflake, and that is not cosmetic.** `server.js`
serves `chipz/user/icon-*.png` as the STOCK app icon for both manifests
(`bundledBrandAsset` → `/public/app-icon-192.png`), so until he uploads one, anyone
installing either app got a snowflake on their home screen. `make-app-icon.py` draws the
app's own mark instead — brand gradient, the auth hero's angular corner motifs, and the
skewed CHIPZ wordmark with its last letter in ink, the same thing `chipzMarkHtml()` falls
back to. Regenerate with `python3 make-app-icon.py`. **Size the type by measuring and
scaling, never by a grow-only search** — the first version's initial guess already
overshot, so it broke on iteration one and rendered a wordmark wider than the tile.

**The admin's two marks are that icon now.** The login screen's was Snow's inherited
swoosh (the "slanting 8"); the topbar's a hand-drawn grid (the "ladder"). Both are
`<img src="/icon-192.png">`: no network, works offline, and `applyAdminBrandLogo()` still
overrides it when a Brand logo is uploaded — two tiers, same as the member app.

**PAY-A is a POSITION, not an identity.** 'A' and 'B' still name two different payment
paths and the rest of the file branches on them; what the member reads is just "which one
in the list". With one method live it is the first one, so switching the manual path on
alone now shows a single row saying PAY-A. Calling it PAY B asked them to wonder where
PAY A went.

**MTN orders MTN.** `manualPayConfirm` used to send the OPPOSITE network on purpose. That
reading is withdrawn, and it broke two things beyond the obvious: the USSD reminder on the
code screen is chosen by `network`, so an MTN payer was shown Airtel's code; and
`restoreManualPayPending()` maps a saved order's network straight back onto the tile, so
reopening a pending order showed an operator nobody had tapped. Both are correct the
moment the two agree. `assignManualNumberAndCreateDeposit()` now distinguishes **no
numbers configured** from **all numbers busy** — with the flip gone, an admin holding only
Airtel numbers sends every MTN payer into a "busy, try a different amount" loop that
cannot end.

**"In full" means as they sent it.** The paste route stored `info.raw` — the parser's
working copy, with `/\s+/g` collapsed to single spaces so its patterns match across line
breaks. Fine for matching, wrong to keep: an operator SMS puts the transaction id, the
balance and the fee on their own lines, and the admin panel renders it in a
`<pre style="white-space:pre-wrap">` precisely so a person can read that shape. **Every
existing test case was one line, which is why it survived a round** — on one-line input
the collapsed copy IS the original. There is a real multi-line case now.

#### The comment-stripping trap, in a new form — and a real bug it hid

Fixing the network comment made `test-no-snow-branding.js` go red, on something I had not
touched. The cause: the OLD comment wrote the USSD codes as `*165#/*185#`. That `/*`
opened a block comment as far as the tests' shared `stripComments` helper was concerned,
and the non-greedy match ran to the next real `*/` about 600 lines later — **blanking
every line of live code in between.** Three hardcoded `'Chipz balance'` sentences sat
inside that window, and this file's own "no hardcoded app name" assertion had been
reporting them as absent. They now go through `brandName()`, so a rename from admin
reaches them.

All three copies of `stripComments` (`test-no-snow-branding.js`, `test-manual-review.js`,
`test-security-hardening.js`) run the **LINE passes before the BLOCK passes** now, which
removes such text before it can be mistaken for a delimiter.

This is the third distinct shape of the same trap in this project — a check defeated by
the text of a comment. The rule has widened: **strip comments before any "does the code do
X" scan, and strip line comments first.**

`verify-round-discriminates.py` really breaks the app eleven ways — the fade off, the fade
stopping short of white, the glow back to red, the percentage's glow deleted, the lone
method renamed PAY B, the network flipped back, each of the two admin SVGs restored, both
message paths re-collapsed, and Snow's snowflake painted back over the app icon —
rebuilding both panels each time and judging on the **exit code**. All eleven are caught.

### Lifting an uploaded logo off its black background

Owner: "there are logos l would like to upload to admin panel to replace chipz logo on
manual payment pages on copy and on network, but they have black background so l wanted
the system to refine it such that it remains as it is with no background so as it shows
up on transparent sitting with no black background."

**Half the bug was the file format, and no amount of keying would have fixed it.** Both
manual-pay slots uploaded through `fileToDataUrl()`, which exports `image/jpeg`. **JPEG
has no alpha channel**, so those two slots could never hold a transparent logo however
clean the file he picked — every upload came back on a solid backdrop. They go through
`fileToLogoPng()` now, and it is PNG on purpose, not incidentally.

**"Remains as it is" rules out the obvious implementation.** Keying every dark pixel also
hollows out the dark parts INSIDE a logo — an outline, a drop shadow, black lettering —
and hands back artwork full of holes. `removeDarkBackdrop()` uses the same rule the door
icon and the spin wheel were cut with: **flood-fill inward from the border**. Only
background connected to the edge of the picture is removed; anything enclosed by the
artwork survives regardless of how black it is. The fixture is deliberately a bright shape
with **black bars inside it**, so a cutter that keys globally fails the test rather than
passing it and shipping holes.

**The rim is unpremultiplied, not threshold-cut.** A logo on black has an antialiased edge
whose pixels are already a blend of logo colour and black; cut those at a threshold and
the logo keeps a dirty dark fringe, which is the usual tell of a bad cut-out. Composited
over black a pixel is just `c = alpha * C`, so inside the flood region both are
recoverable — take alpha from the brightness, divide the colour back out. Measured: the
output has 131 partly-transparent pixels and **none of them is dark**.

**Keyed at full resolution, downscaled after.** Downscaling first blends the black
backdrop into the logo's edge pixels, and a fringe mixed in by the resampler cannot be
told from artwork.

Then `trimTransparentEdges()`, because these slots draw at 56px and 32px — a logo left
floating in its original margin arrives on screen a fraction of the size it should be.
Alpha > 8, not > 0: the recovered rim leaves a few invisible pixels that would otherwise
pin the box back to the original dimensions.

**Two supporting changes.** The thumbnails sit on a **checkerboard** (`.img-thumb.alpha`,
`object-fit:contain` so a wide wordmark is not cropped) — a transparent logo on a flat
tile is indistinguishable from one with a matching solid background, and he has to be able
to see that it worked. And the toast **names what happened**: "Background removed",
"Saved, but no dark background was found to cut off", or "Saved as it is". A plain "Saved"
on an image whose background did not come off is the one message that sends him to the
member app to find out why.

`manualPaySelectorBrandHtml()` / `manualPayHeroBrandHtml()` lost their inline
`height:56px` / `height:32px` and their `border-radius`. The stylesheet already said
`height:auto` for these images and the inline height was overriding it, letterboxing a
wide wordmark into a fraction of its own width; and rounding the corners of a transparent
logo can only clip artwork, since the radius existed to soften an opaque tile that is no
longer there. `max-height` caps a tall logo so it cannot push the card around.

**Worth knowing before blaming the cutter:** the selector card is `#fff`, but the code
screen's hero band is `linear-gradient(155deg,#050505,#33342f 55%,#565853)` — near-black
by design. A dark logo whose background has just been removed is invisible there. That is
the surface, not the cut.

**A test lesson, and it is about sampling the wrong place again.** The soft-edge assertion
first walked in from the left edge at mid-height, found no partly-transparent pixels, and
reported a hard cut. That row crosses the rounded shape at its widest point, where the edge
is vertical and the trim has already cropped to it, so the first retained pixel is
legitimately solid. The antialiasing lives on the **corners**, where the edge runs
diagonally. Scan the whole image, not one row.

**Driven through the UI, not by calling the cutter.** The built panel is obfuscated, so its
functions have no names left to call (`typeof fileToLogoPng` is `undefined` in the deployed
file) — but the better reason is that setting the real file input and intercepting the real
`/admin/manual-pay-image/set` tests the whole path and reads the exact bytes that would be
stored. `make-logo-fixture.py` builds the three fixtures; `verify-logo-cutout-discriminates.py`
breaks the cutter six ways — back to JPEG, keying globally, no rim recovery, no trim,
the tickbox off by default, and a toast that always claims success — and all six are caught.

### The team member avatar, and "Joined Joined"

Owner, on a screenshot of one member row: "why the logo is empty?"

**Because it was.** Team.dc.html draws these avatars as bare gradient discs and that is
exactly what got built — `<div class="avatar" style="background:...">` with no content at
all. Every member on this screen is deliberately anonymous (the name is the literal
"User", the phone is masked, so one member cannot harvest another's number), so there is
no per-person picture to show and an empty disc just reads as an image that failed to
load. It carries the **same chain as the Account profile card** now — uploaded Brand logo,
else the wordmark — so uploading a logo once lands in both places. The alternating
gradient stays as the backdrop behind either.

`brandTextMark()` took an optional `box` argument for this, **defaulting to 68** — the
profile card's circle, its only previous caller — so every existing call site is unchanged
to the pixel. Its sizing constants were all tuned for 68, and dropping a 19px wordmark
into the 44px disc overflowed it. At 44 it comes out 12px, measuring 37px wide inside a
44px circle.

**"Joined Joined 1 day ago"** — visible in the same screenshot, not mentioned.
`timeAgo()` returns its own prefix ("Joined today", "Joined 1 day ago") and the template
prepended another. The fallback is now "Joined recently" rather than a bare em dash, which
alone in that slot reads as a row that failed.

#### Two test traps, both about asserting on the wrong thing

- **A fixed epoch in a fixture drifts.** The first version pinned `NOW` to a constant and
  built the member timestamps off it; the browser runs on the real clock, so the "1 day
  ago" row read as four days old and the assertion failed against correct code. Anchor
  relative fixtures to `time.time()`.
- **A DOM check is not a check on what got painted.** The uploaded-logo case asserted
  `img.naturalWidth > 0`, `object-fit`, and that the image filled the disc — all green —
  while the disc actually rendered as the bare gradient. The fixture was a hand-written
  base64 string that **is not a valid PNG at all** (PIL refuses it outright), and Chromium
  reported a nonzero natural width for it anyway. The fixture is generated and verified
  now, and the test **screenshots the disc and samples its centre pixel** against the
  logo's own colour. If an assertion's whole point is "this is what you see", sample it.

`verify-team-avatar-discriminates.py` breaks it seven ways — the disc emptied, the upload
ignored, the wordmark drawn at the profile size, the centring/clipping dropped, the logo
letterboxed, "Joined" doubled again, and `brandTextMark`'s default moved so the Account
card would shift with it — and all seven are caught.

### The member card against his mockup: absolute dates, the green lining, bigger figures

Owner, holding the mockup up: "l told you removed joined one day ago, l need that exactly
what you're seeing, all the arrangements, have you seen even those green winnings on
cards, l need them, also figures are small why?"

("green winnings" is **green linings** — the glow round the card edge. The measurement
below settles it: there is one in his mockup and there was none in ours.)

**The join line is an absolute stamp now.** `timeAgo()` is gone, replaced by
`joinedStamp()` → `Joined 07/09/2026 01:21`, day/month/year on a 24-hour clock. Relative
wording reads better in most places but not in a downline list: it is the one screen where
a member wants to line a join date up against a commission they were paid, and "2 weeks
ago" lines up against nothing. Built from the local date **parts**, NOT `toLocaleString()`
— the format has to be his on every handset, and an en-US phone would print `9/7/2026` and
silently swap the day and the month on a screen about money. `timeAgo()` had exactly one
caller, checked before deleting it.

**The green lining was real and ours had none.** Sampled straight out from the left edge
of his card 1: **G−R reaches +12 and G−B +10** in the two pixels just outside it, decaying
to the page's own +1 over about 8 device px. Ours carried `var(--sh-card)`, a warm brown
drop shadow (`rgba(30,10,5,…)`), plus a warm neutral border — no green anywhere. It is the
same `rgba(74,170,108,…)` glow `.team-gcard` already used, so the two card families on this
one screen finally match instead of one being warm and one green. Border `#dceadd` to
match, the same green hairline the settings card uses.

**"Figures are small" was two faults, not one.** Size *and* weight:

| | his | ours was | now |
|---|---|---|---|
| `.amt3` ink height | 13.0 CSS | 12 @ 16px | **17px** |
| `.amt3` ink density | **0.556** | 0.409 @ weight 400 | **700** |

Ink density inside his figure's own bbox is the weight tell: his box is *wider with one
fewer character in it* (`UGX0.00` vs our `UGX 0.00`), so the extra ink is stroke, not
glyphs.

**Sizes come from ink heights and this app's own cap-to-font ratios** — measured per
element on our render, then applied to his, and **only where the two strings share a glyph
class.** An ink height that includes an ascender or a descender is not comparable to one
that does not:

| element | his ink | our ink @ our size | → his size | now |
|---|---|---|---|---|
| `.name` | 10.8 | 10 @ 15px | 16.2 | **16** |
| `.phone` | 8.1 | 9 @ 12px | 10.8 | **11** |
| `.amt3` | 13.0 | 12 @ 16px | 17.3 | **17** |
| `.foot` | 8.1 | 8 @ 11px | 11.1 | 11 (unchanged) |

**`.joined` is deliberately absent from that table.** His string and ours differed, so ink
height could not compare them — his has no descender, the old "Joined 1 day ago" had two.
It is settled by **width** instead, now that both render the same text: his measures
**123.0 CSS** wide and ours at 11px measures 121.1, inside 2%. **11px was already
correct** — measuring by the wrong dimension would have "fixed" a value that was right.

**The arrangement, and where the missing 3px was.** Rather than nudge the padding until it
looked close, every internal offset was measured in both:

| | his | ours was | now |
|---|---|---|---|
| card height | 131.6 | 129 | **133** |
| gap between cards | 15.2 | 12 | **15** |
| divider (`.ln2`) | 94.8 | 91 | **95** |
| footer line | 103.0 | 100 | **104** |

One value explained all of it: `.joined`'s bottom margin, 8 → **12**. Everything below it
then falls where his does, and the card lands at 133 against 131.6 — inside the error of
measuring a blurred JPEG.

`verify-team-avatar-discriminates.py` now breaks it **fourteen** ways, including the join
line back to "1 day ago", the date flipped to month/day, the glow back to warm brown, the
figure back to small, the figure's weight alone removed, the 3px margin reverted and the
gap re-crowded. All fourteen are caught. One anchor needed pairing with its following line
first: **`.team-gcard` carries an identical `box-shadow` string**, so the value alone is
not unique in the file.

### Can a product spin and the daily spin override each other?

Owner: "what if a product spin and a daily spin combine together, can't it override??"

**No, and five separate things stop it** — now proved by EXECUTION (`test-spin-sources.js`
runs the real `/turntable/spin` and `grantTurntableSpins` against a stub database),
not by reading the code:

1. **Different storage.** The daily is a date stamp on the user (`lastTurntableAt`);
   earned spins are individual `turntableSpins` documents. Neither can consume the other.
2. **One entitlement per request.** The daily goes first if it is free today, otherwise
   the oldest earned spin. Never both, never neither.
3. **Each pays from its own band.** The daily from settings; a product spin from the band
   **snapshotted onto it at purchase**, so retuning or disabling the product afterwards
   cannot reprice a spin already earned.
4. **Claimed before paid, with a conditional write.** `updateIf` on `lastTurntableAt` for
   the daily, `updateIf({used:false})` on the document for an earned one.
5. **Handed back if the credit fails.**

So 2 product spins plus today's daily is 3 spins, and nothing is lost.

**The one real defect the question surfaced was the balance in the response.** It was
`(Number(u.walletBalance) || 0) + reward`, and `u` is read at the top of the lock while
`withLock('bal:' + uid)` only serialises the WRITES. A referral commission, an approved
deposit or a maturing investment landing in between made that figure short by exactly
that amount — and the client trusts it: it writes it into `STATE.account` and the win
popup counts up to it, so a member watched their balance animate to LESS money than they
have and kept seeing it until the next `/account` fetch. It is re-read now, and `null`
rather than a guess if the re-read fails (the client already falls back). `/checkin`,
which shares this lock discipline, sidesteps this by returning only the bonus.

**The other hole was on the GRANTING side, not the spending side.** The idempotency guard
in `grantTurntableSpins` was a read-then-write with no lock, so two calls for one
investmentId could both find nothing and both grant. Check and writes share one
`withLock('spingrant:' + investmentId)` now, and the call is `await`ed — it is
fire-and-forget from `/invest/create` with no `.catch()`, so a returned promise would
have carried a rejection out as an unhandled rejection.

**Still his call, flagged not changed:** `grantTurntableSpins` returns early when
`turntableEnabled` is false, so buying a product while the wheel is off earns **no spins
ever**, while the same purchase later earns them. Granting them anyway (inert until the
wheel is on) is arguably more correct, but it would hand out retroactive payouts the
moment he enables it — his decision.

#### Three stub-fidelity lessons, and they cost three missed mutations

- **A snapshot is a COPY, taken at read time.** The stub returned the LIVE document
  object as `data()`, so every read saw writes that happened after it — a second process
  reading *before* the first one's write still observed that write and correctly bailed
  out. That made **both** conditional-write mutations look harmless. Freezing `data()`
  (live `ref`, frozen data — the same split a real snapshot has) is what made
  `updateIf` testable at all.
- **`withLock` is in-process, so one lock cannot test what `updateIf` defends.** Two
  `build()`s over one `state` give two *processes* with separate locks, which is the
  Render multi-instance case the conditional writes exist for.
- **A race test must force the interleaving.** Left to the event loop it did not happen.
  A barrier holds the first N reads until all N have arrived. A race test that depends on
  lucky scheduling is not a test.

Also: `fnSource()` must match `async function <name>(` first. Matching `function <name>(`
alone finds the right place in an async function but starts the slice after the keyword,
so `new Function` throws "await is only valid in async functions" on correct code.

### The wallet card's glow sweep

Owner: "on wallet that wallet card having number, it has a glow sweep animation too."

`.sheen` was a **static** diagonal highlight across the whole card — the look of a sweep
frozen mid-pass, which is why it read as almost-right. It travels now, reusing this app's
own sweep convention rather than a second one: the same right-to-left direction he asked
for on the buttons ("let it move from right to left"), the same band-narrower-than-its-box
shape, the same run-then-rest cycle, at 5.2s because this is a card at rest rather than a
control asking to be tapped. Reduced motion returns it to the static highlight — not to
nothing, since a flat gradient-only card looks unfinished.

**Two measurement traps here, both of which reported working code as broken:**
- **"Find the brightest column" never moved.** The card's gradient ends in `#ff8a1f`, and
  that orange is brighter in greyscale than a white band over the card's dark end — so
  the brightest column was always the right edge, i.e. the base gradient, never the
  sheen. What identifies a moving highlight is the part that **CHANGED**: frame
  differencing.
- **A 2s sample can land entirely inside the rest.** The sweep deliberately rests for 45%
  of its 5.2s cycle, so the window has to exceed one full cycle. Measured: 10 repainting
  frame pairs, the change travelling 0.98 of the card's width.
- And `getBoundingClientRect().width` includes the skew — it read 309px of a 350px card
  for a band laid out at 193px. Use `offsetWidth` for "is the band narrower than the box".

`verify-spin-and-sheen-discriminate.py` breaks the two together ten ways — the balance
back to snapshot arithmetic, a daily spin also burning a product spin, a product spin
repriced from the daily band, each conditional write replaced by a plain one, double
granting, the sweep static, the band full-width, the sweep run-once, and reduced motion
losing the highlight. All ten are caught.

### One cash-out at a time, and settable cash-out hours

Owner: "no requesting another withdrawal yet another one is on pending, so one should have
got his processing one to be paid then requests another, also one withdrawal time should
be SETTABLE IN ADMIN, such that when one tries to withdrawal he sees, that withdrawals
start from this time to this time, nothing much ie 6pm to 5pm."

**One unresolved cash-out at a time, and it is not a setting.** Checked inside
`withLock('bal:' + userId)` and **before the debit**, so two taps cannot both find nothing
pending. The blocking statuses are exactly the three `/admin/withdrawals/list` treats as
unresolved — `pending`, `sending`, `processing`. `processed` and `rejected` are finished
and must not block, or a member's first cash-out would be their last. Another member's
pending request is irrelevant; both are asserted.

**The window is `withdrawWindowEnabled` + `withdrawOpenFrom`/`withdrawOpenTo`**, stored as
`"HH:MM"` in EAT, off by default. **It may wrap past midnight and that is not an edge
case — his own example does it.** 18:00 to 17:00 is open for 23 of the 24 hours, and the
obvious `from <= now && now < to` reads it as never open:

```js
const open = from < to ? (now >= from && now < to) : (now >= from || now < to);
```

A bad time string returns **null, not 0** — coerced to 0 it would silently become midnight
and move everyone's window. `from === to` is treated as unset rather than as
open-or-closed-all-day, and the save endpoint **refuses** both a malformed time and two
identical ones instead of repairing them: a silently repaired window is hours the owner
did not choose on a screen whose whole job is stating them.

**The app was already lying about this.** The instruction card carried a hardcoded
`Withdrawal time: 06:00:00 - 17:00:00.` that nothing enforced, and
`There is no limit to the number of withdrawals.` Both are gone: the hours come from the
real setting via `withdrawHoursLine()` (and say "any time of day" when the window is off,
because that is the truth), and the one-at-a-time rule is stated plainly.

### The manual payment flow is Snow's again, rule for rule

Owner: "you changed the design and font of manual payment land page, check back on snow
scripts, it should be same texts and design, you even rounded the network selection design
and submit sms stuffs were changed, use exact as it was on snow, only logics change."

**The markup was never the problem** — Snow's and Chipz's manual-pay HTML are identical,
same classes and same strings, which is how the fault got narrowed. The stylesheet had
diverged, and **every single divergence was one of two mechanical substitutions made when
Chipz was forked:**

- **Literal radii replaced with Chipz tokens.** `.mp-method` went from `11px` to
  `var(--r-card)` — **22px, double** — which is exactly "you even rounded the network
  selection design". Same for the phone field, the SMS textarea ("submit sms stuffs"), the
  detail/paid/reminder boxes, the loader, the timeline card, the Refresh and Confirm
  buttons, the copy glyph and the timer digits.
- **Font weights lightened one or two steps** — 800→700, 700→500 — on fifteen rules.

`restore-snow-manualpay-css.py` put all 31 back, written as a one-shot repair with a
uniqueness assertion per anchor so a silent no-op is impossible — **it refused outright on
its first run** (five anchors spanned line breaks) rather than applying half.

**Kept, deliberately, because he asked for them and neither touches Snow's text, shape or
weight:** the centred `.mp-toast` notices, and the app-wide Confirm-button glow sweep. The
button's radius went back to Snow's 26px pill regardless, because that is shape.

**`test-manualpay-matches-snow.js` diffs against Snow's own file** rather than a list of
numbers someone typed — a hardcoded expectation is a second copy of the design that drifts
on its own. It also asserts no Chipz radius token survives anywhere in the flow, and
`SKIP`s cleanly if `snow/` is not in the checkout.

`verify-withdraw-and-snowcss-discriminate.py` breaks the three tests sixteen ways —
the pending block removed, narrowed to one status, or checked-but-not-thrown; the window
unenforced, un-wrapped, coerced-from-garbage, or labelled on a 24-hour clock; the fake
hours line restored; the admin inputs downgraded; a bad time quietly repaired; both named
radii re-rounded; two weights re-lightened; a rule dropped; and one of Snow's strings
reworded. All sixteen are caught.

#### The name-prefix trap, and the self-matching comment AGAIN

This round's window work first added `hhmmToMinutes()` — and `hhmmToMin()` already existed
a thousand lines further down, doing **exactly the same thing** for the product-schedule
helpers. Two faults in one:

1. It was a duplicate of live code. Deleted; the window uses `hhmmToMin()`. Its regex
   demands a two-digit hour, so the settings route **pads before parsing** — a hand-typed
   `9:00` is a clear time to refuse on a technicality.
2. **Its name is a prefix-superset of the existing one**, and `test-product-config.js`
   slices server.js by searching for that helper's declaration. The new function sat
   earlier in the file, silently stole the anchor, and the slice swallowed ~1300 lines —
   `test-product-config.js` and `test-product-schedule.js` both died on a redeclared
   `finiteMoney`. **A new helper whose name merely starts with an existing one's can break
   a text-slicing test.**

Then the comment explaining all that **quoted the anchor literally**, which made the
comment itself the earliest match and broke the same slice again in a new way. The anchor
is now described rather than quoted. That is the **fourth** distinct shape of this trap in
this project, and the rule has widened once more: **never write a scanner's anchor
verbatim in the file it scans.**

Both product tests were confirmed green at HEAD before the fix, so the breakage was
correctly attributed to this round rather than assumed pre-existing.

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

## Round 152 — Multi-country subdomains (regions)

Owner: *"l wanted other subdomain to fetch other country code and currency, ie
fgdr.chipz-platform.com in ugx, and country code changeable to other country or
created, and another can be sfhd.chipz-platform in KES shs, or any country created,
also make when l can edit prices of each product and all settings as these of ugx."*

Chipz is now multi-tenant by country. A **region** owns:

| what | where it is set |
|---|---|
| its subdomain(s) | Admin → **Countries** → Web addresses |
| currency label ("UGX", "KES") | Admin → Countries |
| dialling code + number length + allowed prefixes | Admin → Countries |
| clock offset (its cash-out hours and product windows are in ITS local time) | Admin → Countries |
| every rate, limit, bonus, payment method, cash-out window | Admin → **Settings** with that country picked |
| every product's price, payout, cycle, spin band, availability | Admin → **Products** with that country picked |
| its own mobile-money collection numbers | Admin → Settings → payment numbers, with that country picked |

### How a request gets its region (the money-safety rule)
- a **visitor** (not signed in) gets the region that owns the hostname the app was
  loaded from — so the landing screen, Sign Up and the product list read in the right
  currency before anybody has an account.
- a **member** always gets **their own** region, stamped on the account at
  registration, no matter which hostname they opened.

That second rule is the whole point. If the region came from the request, somebody
could register where a product costs 30,000 KES and buy it on the host where the same
product costs 30,000 UGX. `regionKey` is never read from a request body; the region is
resolved once per request in the region middleware (hostname, then overridden by
`users/{uid}.regionKey`) and carried in an **`AsyncLocalStorage`** store. That store is
what makes `getSettings()`, `getProducts()`, `fmtMoney()`, `cleanPhone()` and the clock
helpers region-correct without an argument threaded through ~250 call sites.

Background jobs (maturity payouts, referral commission, deposit crediting, withdrawal
processing) have no request, so each wraps itself in the member's own region with
`withUserRegion(userId, fn)` — otherwise a Kenyan's payout description would read UGX.

### The founding region
Key `ug`, name Uganda, UGX, +256, 9 digits starting 7, UTC+3. It cannot be deleted and
cannot be switched off: it is where an unrecognised hostname and an account with no
`regionKey` land. Its settings document is still `settings/main` and its prices are
still the plain `price`/`expectedReturn` fields on each product document — **nothing
migrates**, and a database written before this round reads correctly as Uganda.

### Storage
- `regions/<key>` — `{ key, name, currency, dialCode, localLength, prefixes[],
  utcOffsetMin, hosts[], active }`. Cached 60 s with a synchronous snapshot
  (`currentRegion()` is called from `fmtMoney()`, which cannot await).
- `settings/region-<key>` — that country's settings, **layered on top of
  `settings/main`**. A new country therefore starts out behaving exactly like Uganda
  and the admin only types what differs. `GLOBAL_ONLY_SETTINGS`
  (`allowedOrigins`, `maintenanceMode`, `maintenanceMsg`, `openingCountdownEnabled`,
  `openingCountdownAt`, `brandName`) can never be per-country — a region trying to set
  one is **refused**, not silently dropped.
- each product document gains `regions: { ke: { price, … } }`, written at the **dotted
  path** `regions.ke`. Not as a nested map: this Mongo compatibility layer turns
  `set({regions:{ke:…}}, {merge:true})` into `$set: {regions: …}`, which replaces the
  whole map and would wipe every other country's prices on each save.
  `PRODUCT_REGION_FIELDS` is the whitelist — name, image and order stay shared, so one
  country cannot rename a product for everyone.
- `pendingDeposits` / `withdrawals` / `manualPaymentNumbers` carry `regionKey`, so the
  admin lists can label a figure and the number pool can be scoped without a per-row
  user lookup. A document with no `regionKey` is Uganda (filtered in JavaScript, not
  in the query — a `where('regionKey','==','ug')` matches none of the existing rows).

### Login addresses — the collision this closes
The synthetic Firebase email was the local digits alone (`742730382@chipz-platform.com`).
`0712345678` is a real number in **both** Uganda and Kenya, so a second country would
have put a Kenyan straight inside a Ugandan member's account. Now: **Uganda keeps the
bare local digits** (no deployed login changes) and **every other country carries its
dialling code** (`254712345678@…`). They cannot collide — a Ugandan address is exactly
9 digits, a prefixed one is always longer — and two regions are **refused at save time
if they share a dialling code**, which is what keeps the prefixed forms distinct too.

`phoneToEmail()` exists twice, in `server.js` and in `user-src/original_module.js`, and
they MUST produce the same string. `test-regions.js` lifts both and compares them.

**Consequence to know:** a member signs in on their **own country's** subdomain. On
another country's address their login address does not exist, and the login error says
so once more than one country is configured (`regionCount` on `/public/settings`).

### Also per-region now
- referral codes do **not** cross countries — a code from another region is refused at
  registration (`BAD_REFERRAL_REGION`). Paying 27% of a 30,000 KES purchase into a
  Ugandan wallet is arithmetically right and worth about eight times what it should be.
- auto-approval of cash-outs runs **once per country**, with that country's own
  interval, cap and enable flag, and only touches its own members' withdrawals.
- a region's hostnames are folded into the CORS allowlist automatically
  (`_regionHosts` + `refreshCorsSnapshot()`), so a new subdomain never needs adding to
  Settings → Allowed website domains. A CORS-refused subdomain is indistinguishable
  from a dead server, which this file already warns about twice.

### New endpoints
`GET /admin/regions`, `POST /admin/regions/save`, `POST /admin/regions/delete`
(refused for `ug`, and refused while any member is signed up in that region — switch it
off instead, so those accounts keep their own currency and prices).
`GET /admin/settings?region=` and `GET /admin/products?region=` read one country's view
and also return `overrides` (which fields that country has actually set, so the panel
can show what is still inherited). `POST /admin/settings/update`,
`POST /admin/products/save` and `POST /admin/manual-numbers/save` take `region`.

The admin panel stamps all of that on in **one** place — its `api()` helper — rather
than at a dozen call sites; `ADMIN_REGION` is the picked country and `ugx(n, regionKey)`
labels a figure in the right currency. The picker is **hidden entirely while there is
only one country**.

### Not done / known limits
- `NETWORK_NAMES` is still MTN / Airtel. Those are Uganda's operators; a Kenyan region
  would want Safaricom M-Pesa. Networks are not yet per-region.
- MarzPay and LipaPay are Uganda-only gateways. A new country should run on **manual
  payments (PAY B)** until a provider for it is wired in.
- The SMS parser (`parseMoMoSms` and friends) is written against real MTN/Airtel Uganda
  message formats. It picks the payer's number using the region's own prefixes now, but
  the message *shapes* are still Ugandan.
- Admin analytics day-bucketing stays on EAT — it aggregates across every country, so
  one clock is the right answer there.

### Tests
`test-regions.js` runs the real functions out of both files: the region model and its
normalisation, hostname → country (including a country switched off), per-country
settings documents, phone shapes per country, the currency label, **the app/server
login-address agreement**, the Uganda↔Kenya collision, format hints, per-country
product pricing (including a blanked field going back to inheriting rather than
becoming 0), and code-level checks on every money-safety rule above.

`test-region-currency.py` drives the **built, obfuscated** app in a real browser
against a backend answering as Kenya, and checks what a member would actually see:
the wallet balance and every visible currency label reading KES, the Deposit number
field showing **+254**, the Withdraw amount field labelled KES, a Kenyan number
accepted where a Ugandan one is refused, and the login address carrying the dialling
code. It then reloads the **same build** served as Uganda and requires every one of
those to read the Ugandan way — a test that only ever sees Kenya cannot tell a working
region layer apart from a build with "KES" compiled into it. A third scenario is the
money-safety rule itself: `/public/settings` says **Uganda** (the hostname) while
`/account` says **Kenya** (the account), and the screen must come out Kenyan.
That third scenario is not optional — verified by mutation: dropping
`applyRegion(r.region)` from the `/account` reply goes **undetected** by the first two
runs, because there the two regions agree.

`verify-regions-discriminates.py` re-breaks the feature **43 ways** — region taken from
the request, hostname winning over the account, registration not stamping, a
cross-region referral accepted, the nested-map product save that wipes other countries,
a global setting made per-country, both `phoneToEmail` halves losing their prefix,
hardcoded UGX on either side, the `.slice(3)` cents bug, the region filters dropped from
auto-approval and the number pool, `withUserRegion` removed from the background jobs,
the app deciding its own region — and requires the test to **exit non-zero** every
time. All 35 are caught. Two were NOT, first time round, and both were real holes in the
test, fixed: a file-wide `region: publicRegionView()` check passed with the
`/public/settings` one deleted (the `/account` one still matched), and a file-wide
`_regionHosts` check passed with the code that fills the list deleted (the declaration
still matched). **Check inside the function, not across the file.**

### Two bugs this round's own tests caught in this round's own work
1. **`STATE.settings.regionCount = …` took the whole boot down.** `STATE.settings` is
   whatever `/public/settings` sent, and on a success reply with no `settings` key it
   is `undefined` — so writing into it threw, the loading screen never lifted, and
   `test-cache-quota.py` and `test-mockup-proportions.py` both went red on "no page
   errors" (they pass at HEAD; checked). `regionCount` now lives on `STATE` itself.
   **Do not write into `STATE.settings`** — it is the server's object, not ours.
2. **A second country's rates could never be saved at all.** The Settings screen's
   Rates card sends ONE payload that mixes per-country rates with the backend-wide
   controls (`allowedOrigins`, `maintenanceMode`, `maintenanceMsg`,
   `openingCountdown*`). With Kenya picked, the server's (correct) refusal of those
   fields failed the entire save. The panel now strips them in its `api()` helper —
   `ADMIN_GLOBAL_ONLY`, which `test-regions.js` asserts is **exactly** the server's
   `GLOBAL_ONLY_SETTINGS`, so nothing is stripped that should save and nothing is sent
   that will be refused. The server refusal stays as the backstop for a direct POST.

## Round 153 — Short per-country subdomains, and the root domain is closed

Owner: *"bro l wanted like subdomains of different countries, ie g26e for Uganda, shy
for another, or make when server auto generates subdomains every session of the specific
country, like l didn't want root domain to work, l used hostinger and onrender for
connecting."*

Three asks. Two are built; the third is not possible as phrased and the honest version
is built instead.

### 1. Short addresses, typed as LABELS not hostnames
A country now holds `labels: ['g26e','x7k2']`, and the hostname is built from them and
one backend-wide `baseDomain` (default `chipz-platform.com`). Four characters typed per
address instead of a whole hostname spelled out, and the domain lives in one place
rather than repeated on every country. `hosts` is still there for an address on a
DIFFERENT domain.

`regionHostnames(region)` is the single resolver — every hostname a country answers for,
short and full — and `regionForHost()`, the CORS allowlist (`rebuildRegionHosts()`) and
the admin panel's display all go through it, so they cannot disagree.

`/admin/regions` returns `resolvedHosts` per country, so the panel prints
`g26e.chipz-platform.com` rather than leaving the admin to join label and domain in
their head.

**normalizeRegion() stays permissive; the SAVE route refuses.** That split matters:
normalizeRegion also runs over whatever is already stored, and refusing there would take
a live country offline — but an admin who types `he!lo` and is shown `hello` in the list
has been given an address they did not choose. So `/admin/regions/save` rejects a typed
label that would not survive normalisation unchanged, by name, and rejects `www`
explicitly. Whitespace and commas both separate, so `sp ace` is deliberately **two**
addresses — that field says it takes several.

### 2. "The root domain must not work"
`blockRootDomain` (default **on**) refuses the bare domain and its `www.` form;
`parkedHosts` adds any retired address; `strictRegionHosts` (default **off**) narrows it
further to "only a hostname some country actually claims". All four are
`GLOBAL_ONLY_SETTINGS` — backend-wide, never per-country — and live in Admin → Settings
→ **Where the app may be opened from**.

- **The refusal is a 403 with `code: 'HOST_PARKED'`, deliberately NOT a CORS refusal.**
  A refused origin means the browser drops the reply before any code sees it, so the app
  could not tell "this address is parked" from "the server is down" and would show the
  wrong screen. Answering with a code is what lets it say the right thing.
- **The app handles it in `api()`** — the one place every request passes through — so it
  cannot matter which call happens to be first. `showHostParked()` takes the loading
  screen, the app and the sign-in screen down and shows a plain final notice. Not
  `notify()`: a dialog with an OK button implies there is something behind it to go back
  to, and on this address there is nothing.
- **An EMPTY host is never parked**, and `GUARD_EXEMPT` is honoured. Gateway webhooks,
  the SMS forwarder and Render's health check arrive with no Origin at all, and money
  that has already left a payer's account must never be lost to a domain rule.
- **The platform's own hosts are never parked** — `*.onrender.com`, the EdgeOne and
  Pages previews, localhost and bare IPs (`isInfraHost`). Without that,
  `strictRegionHosts` would lock the owner out of the very panel the setting is turned
  off in.

**The real fix is at the host: do not attach the root domain to the `chipz-app` static
site at all.** This is the backstop for it being attached anyway, and for a direct API
call made from it.

### 3. "Auto-generate subdomains every session" — what is actually possible
**A subdomain cannot be minted per session.** A browser can only reach a hostname that
DNS already answers for and that the host already holds a certificate for, and neither
happens in the second between tapping a link and the page loading. There is no
implementation of this that works; it is a property of DNS and TLS, not of this code.

What is real, and what `POST /admin/regions/add-label` does, is mint a fresh unguessable
label **on demand** — Admin → Countries → **+ Address**. With a wildcard
`*.chipz-platform.com` record at Hostinger pointed at the Render app, and a wildcard
custom domain on that Render service, a generated label works the moment it is saved,
and generating is then effectively unlimited. **Without a wildcard, each label still
needs its own DNS record and certificate**, so generate a few and add them at the host
in one sitting rather than expecting one per visit.

Details that matter:
- the label is minted with `randFromAlphabet` (the CSPRNG), not `Math.random`;
- the alphabet omits **l, o, 0, 1** — these get read off a screen and typed;
- uniqueness is checked across **every** country, not just the one being added to: two
  countries sharing a label would make the currency depend on document order;
- labels are **added, never replaced** — an address already shared with members has to
  keep working. Remove one by editing the country.

### Tests
`test-regions.js` gained five sections: short addresses resolving against the base
domain and reaching the CORS allowlist, the root-domain block in every configuration
(including strict mode, the infra exemptions and the empty-host case), the 403-not-CORS
shape and the app's handling of it, the generator's properties, and the validation of
all four settings. `test-region-currency.py` gained a fourth browser scenario: every
request answered 403 HOST_PARKED, and the notice must be on screen with the loader down
and neither the app nor the sign-in screen showing.

`verify-regions-discriminates.py` is now **70 mutations**, all caught.

**Three of this round's own assertions did not discriminate at first, and each is a
reusable lesson:**
1. **The empty-host case passed with `if (!h) return false;` deleted** — with strict mode
   OFF every later rule says "not parked" anyway, so the early return was unobservable.
   It is now checked with strict mode **on**, which is the only state where it does work.
2. **"the loading screen is down" passed with the hide deleted**, because the boot path
   takes the loader down on its own once it gives up — a sample three seconds later
   cannot tell "the notice hid it" from "boot hid it eventually". It is now sampled by a
   MutationObserver **at the instant the notice appears**. (Observe `document`, not
   `document.documentElement`: an `add_init_script` runs before the root element exists.)
3. **A re-anchoring edit turned one mutation into a no-op** — a bulk replace of the old
   `GLOBAL_ONLY_SETTINGS` literal hit both the `old` and the `new` field of the same
   entry, so it substituted a string for itself and "passed". When re-anchoring a
   mutation harness, check that `old != new` for every entry.

## Round 154 — Each arrival moved onto a different address in his own country

> "so l wanted that if one joined the site or visited the site with a subdomain like
> gfdt so in his session, server changes the subdomain of his session to another like
> b5dh, so in that very country"

Now possible because the wildcard is live (Round 153's DNS walkthrough): a generated
label works the moment it is saved, so there is a real pool of addresses to move
between.

### How it works
`GET /public/entry` is asked once on arrival and answers `{rotate, mode, host}`. The
app (`maybeRotateEntry()`, called at start-up alongside `boot()`) moves the browser to
that host. Every rule lives on the server so the mode can be changed from the panel
without shipping a build:

- **Same country, always.** The pool is `region.labels` joined to the base domain and
  nothing else. Which region that is was already decided by the region middleware,
  which prefers a **signed-in member's own region** over the hostname — so a Kenyan
  member who opens a Ugandan address is offered a Kenyan one, never the reverse.
- **Claimed addresses only.** A made-up label resolves to the founding region (wrong
  currency) and is not in the CORS allowlist, so handing one out would break the app
  rather than move it.
- **Never back to where he is.** `?from=` (or the Origin header) is excluded, so a pool
  of one answers "stay".
- **Not from a service host.** `*.onrender.com`, `*.edgeone.app`, `localhost` — that is
  the owner testing, and being bounced onto a live country address mid-test is not a
  thing he asked for.
- **A failure answers "stay".** A broken settings read must never stop the app loading.

### The three modes — `rotateEntry`, PER COUNTRY
`'off'` (default) / `'visitors'` / `'always'`. Deliberately **not** in
`GLOBAL_ONLY_SETTINGS`: the pool is per country and "in that very country" is the point.
Refused rather than coerced at `/admin/settings/update` (`ROTATE_ENTRY_MODES`) — a typo
landing on `'off'` would read as saved while nobody moves; a typo landing on `'always'`
would log every member out of his saved password.

**`'visitors'` is the one to use, and the cost is the reason.** A browser scopes the
saved password, the `localStorage` instant-boot cache, the service worker's offline
shell and an **installed home-screen icon** to ONE hostname. Move a signed-in member and
he loses autofill, re-downloads the whole app shell on his own data, and his installed
icon still points at the address he left. Someone with no account yet has none of that
to lose.

### The loop guard cannot live in sessionStorage alone
Storage is **per origin**, so a marker written before the hop does not exist on the
address we land on — it would ask again, be handed a third address, and hop forever. So
the marker travels **in the URL** (`?_e=1`), is copied into the destination's own
`sessionStorage` on arrival, and is then stripped out of the address bar with
`history.replaceState` (a member must not be able to share a link that says "already
moved"). The hop uses `location.replace()`, not `assign()`, so the phone's Back button
cannot walk him onto the old address. `url.hostname` is the **only** thing changed, so
the path, the `?ref=` code and the `#hash` all travel — every invite-link shape keeps
working.

The app also makes its **own** "is anyone signed in here" check
(`localStorage.getItem(CACHED_STATE_KEY)`) before obeying `'visitors'`: on the first
request of a page load Firebase has usually not restored the session yet, so the
server's token check sees a returning member as a stranger.

### Also
`/admin/regions/add-label` takes a `count` (capped at the room left under 24) and the
panel gained a **+ 5** button — a pool needs several addresses and one tap each is a lot
of tapping. Each minted label is added to `taken` inside the loop, so a batch cannot
contain the same address twice.

### Tests
`test-regions.js` gained a section that **runs the real `/public/entry` handler** lifted
out of `server.js` (200 iterations, because which address it picks is deliberately
random — a single call could pass by luck) and **runs the real `maybeRotateEntry()`**
lifted out of `original_module.js` against a stub `location`, asserting the exact URL
the browser is sent to. `verify-regions-discriminates.py` is now **98 mutations**, all
caught. `test-region-currency.py` gained a fifth browser scenario that performs a
**real hop between two real origins** — `127.0.0.1` and `localhost` are the same
server on the same port but different origins, which is exactly the trap this feature
has to survive — and asserts the landing URL, the surviving `?ref=` code, the stripped
marker, the recorded `sessionStorage` flag, and that a browser already holding an
account there is left alone.

### A real bug this round surfaced, unreported
**The parked notice could be covered by the app a moment later.** `showHostParked()`
hid `#loadingScreen`, `#app` and `#authScreen` with inline styles — once. A Firebase
session restore landing a moment after that runs `enterApp()`, which shows `#app`
again, leaving the member looking at a half-painted app on an address where every
single request is refused. It had been invisible because the notice used to appear
later; `maybeRotateEntry()` is now the first request of the page, the notice arrives
earlier, and `test-region-currency.py`'s parked scenario went red on
`app: True`. Fixed by appending a `<style>` with
`#loadingScreen,#app,#authScreen{display:none !important}` — a stylesheet rule with
`!important` beats the inline style any later code sets; an inline style set from
`showHostParked` does not.

**Two of this round's own assertions did not discriminate at first:**
1. **"all of them come back, not just the first" passed with the reply stripped back to
   one address** — a file-wide `/labels: made/` matched the `logAdminAction(..., { key,
   labels: made.join(', ') })` line right above it. Now matched on the reply line only.
   (Watch the regex too: `[^)]*` stopped at the `)` inside `hostOf(made[0])`.)
2. **"the path, ref code and hash travel with him" passed with a line that blanked the
   path inserted right in front of `url.hostname = r.host`** — a static "does it assign
   the hostname" check cannot see what happens either side of it. Replaced by running
   the function and comparing the URL string.
3. **A pre-existing mutation went obsolete** — "the parked notice sits behind a spinner"
   stopped being caught, because the new `!important` rule *names* `#loadingScreen`, so
   the loose `/loadingScreen/` match still passed with the inline hide deleted. Both
   mechanisms are wanted (the inline hide is in place in the same tick, the stylesheet
   keeps it there), so the assertion now matches the inline hide **specifically** and
   each id in the rule is checked on its own, with a mutation per id.

**Playwright notes for a page that navigates itself:** `page.goto(..., wait_until="load")`
**times out** on a page that hops away during start-up — use `wait_until="commit"`. And
clear the origin's storage on a load where the answer is still "stay": set it to "move"
first and the page navigates mid-`page.evaluate`, which throws "Execution context was
destroyed".

### Owner still has to
Give each country **several** short addresses (Countries → **+ 5**) before turning this
on, then set **Settings → Move arrivals to another address** to **Visitors only** for
that country. With no wildcard on a domain, every label still needs its own DNS record.

## Round 155 — Why the subdomains were broken, and one country toggle everywhere

> "l wanted other subdomain ... see that is Ugandan subdomain but you can see it is saying
> wrong password, yet on root domain, everything was working perfectly, and that password
> is correct, also why when you tap the other country domain, still returns the 256 on
> login and register ... make sure referrals are working bro, and those subdomain are not
> working well why"

**One misconfiguration was breaking four things at once**, and nothing on screen said so.
A short address resolving to a country its members are not in silently breaks: the login
address, the referral code check, the currency, and the dialling code — and the chip that
should have revealed it was hardcoded.

### Four real bugs, all confirmed in the code
1. **The `+256` chip was static text.** `user-src/index.html` had
   `<span class="prefix">+256</span>` on **both** Login and Sign Up, with nothing ever
   updating it — every country's address showed Uganda's code. Worse than cosmetic: that
   chip is the ONLY thing on that screen naming the country, so an address pointing at
   the wrong one looked completely normal until a correct password was refused. Now
   `#loginDial`/`#regDial`, painted by `paintRegionChrome()` from `applyRegion`, plus a
   "Uganda · UGX" line shown only when more than one country exists.
2. **The login address depended on the region KEY.** `phoneToEmail` chose bare-vs-prefixed
   on `isDefault`, which means `key === 'ug'`. So a **second** region configured with
   Uganda's +256 — what you get when a short address is attached to the wrong country, or
   a country is re-created under a new id — moved every deployed account from
   `769968158@` to `256769968158@`, and the password that had always worked started being
   refused. Now keyed on the **founding region's dialling code**
   (`regionUsesBareLocal`), published to the app as `usesBareLocal` because the app cannot
   see the founding region. Plus `loginAddressCandidates()`: sign-in tries this region's
   shape, then the bare legacy shape — never another **country's**, which would become a
   way into a Kenyan account on the Ugandan site.
3. **Signing up was impossible on a mis-mapped address.** Registration refused any referral
   code whose region **id** differed from the hostname's — and a referral code is
   *required*, so the whole country was shut: every real member's code read as "belongs to
   another country". Now judged on **currency**, which is the only thing the rule was ever
   protecting (commission is a percentage paid into the referrer's wallet).
4. **`applyRegion` dropped the new flag** — it copies a **whitelist** of fields and I
   forgot to add `usesBareLocal`, so the server's answer never reached `REGION`. Found by
   `test-region-currency.py` reading the login address off the running app; none of the
   static checks saw it. **A whitelist is a place bugs hide: adding a published field means
   editing that list.**

### Making the misconfiguration impossible to miss
The likely root cause is that **Base domain** still holds the built-in default while the
real site is on the owner's own domain — short addresses are built as
`<short name>.<base domain>`, so nothing matches and every subdomain falls back to the
founding country. So:
- the **Countries** tab warns when the base domain is not the domain the panel itself is
  being used on (skipped when the panel is on `*.onrender.com`/`*.edgeone.app`/localhost,
  which say nothing about the members' domain), with a one-tap **"Use <domain> as the base
  domain"**;
- `POST /admin/regions/check-host` + a **"Which country does an address serve?"** box
  answers it directly and says **why**, including the login address a member there would
  use — the thing that was silently wrong.

### One country toggle on every screen
`adminRegionFilter(req)` reads `?region=` or `body.region`; `'all'` (or nothing, which an
older panel build sends) means every country, so an untaught tab keeps working.
`rowRegionKey()` places a row by its own `regionKey` where it has one (that is where the
money moved) and otherwise by its **member's** country, which is how rows written before
regions existed are placed. Filtering is applied to `/admin/stats`, `/admin/analytics`,
`/admin/users`, `/admin/deposits/list`, `/admin/withdrawals/list`,
`/admin/transactions/list` and `/admin/referrals/list`, **before** counts and day-totals
are built — otherwise the totals describe every country while the rows beneath describe
one. `truncated` stays judged on the **raw** page, so a partial list is never called
complete. The picker is injected centrally by `paintRegionPicker()` after each tab paints
and after each live refresh, gains an **All countries** option (with a caption saying the
figures then mix currencies), and is withheld from Settings/Products, which belong to one
country at a time.

**`REGION_FILTERED_*` routes are stamped ALWAYS, Uganda included** — unlike the two config
routes, where "no region" already meant the founding country. For a *list*, "no region"
means *every* country, so not stamping it while Uganda is picked would show a mixed list
under a label saying Uganda.

### Tests
`test-regions.js` gained the second-Uganda lockout case, the candidate-address list, the
live chips, the currency-based referral rule, and the whole admin toggle; it now **runs**
`baseDomainWarningHtml()` in a sandbox rather than describing it.
`test-region-currency.py` reads both dialling-code chips and the country line off the real
built app as Kenya **and then as Uganda**. `verify-regions-discriminates.py` is **136
mutations**, all caught.

**Six of this round's own assertions did not discriminate at first:**
1. **"the country count is set before the repaint" passed with boot()'s order swapped** —
   the auth-screen prefetch has the same pair of statements, so a file-wide match still
   hit. Checked inside `boot()` now. (Same lesson as Round 152's: *check inside the
   function, not across the file* — it keeps recurring.)
2. **`indexOf` returns −1 when a thing is ABSENT, and −1 is less than every real index** —
   so "the filter runs before the totals" passed with the filtering deleted outright. Now
   a `before()` helper that requires both to be found.
3. **"each list is per-country" passed with the `.filter()` removed** — asking for the
   country is not filtering by it; the assertions only checked that
   `adminRegionFilter(req)` was *called*. Each route now has its applied-filter shape
   asserted.
4. **The base-domain warning was asserted to EXIST**, so an `if (1) return ''` bolted into
   it went unnoticed. Now the function is run for a mismatch, a match, four platform
   hosts, and an unset base domain.
5. **The one-tap fix was asserted by its handler name**, which survives deleting the
   button. Now asserted on the markup the function returns.
6. A blanket `clientApi(region)` → `clientApi(pubView(region))` replace also hit the
   **function declaration**. Same family as Round 154's string-for-itself no-op: *a bulk
   replace in a test harness needs its hit count checked, not just its result.*

### Owner still has to
Set **Settings → Base domain** to his real domain (the Countries tab now says so outright,
with a one-tap fix), then give each country its short addresses. Everything else in this
round is already live on push.

## Round 156 — Why every subdomain loaded nothing: CORS was an exact hostname match

> "other country domains are not working, no fetching images, please check out
> systematically ... subdomains are not working, what is going on"
> "why showing the country and currency, that should not be shown"

### The cause, found by walking the whole chain
1. **DNS** — wildcard `*` CNAME at the registrar → the app. Working (he verified).
2. **TLS + static serving** — wildcard custom domain, certificate issued. Working (the
   sign-in screen rendered on a subdomain).
3. **`API_BASE`** — absolute (`https://chipz-server.onrender.com`), so correct from any
   origin. Fine.
4. **CSP** (`render.yaml`) — `connect-src` includes the backend, `img-src` includes
   `data:`. Fine on any subdomain.
5. **CORS — BROKEN.** `_corsExtraHosts.includes(h)` was an **exact hostname match**.

The owner types the domain he *registered* into **Allowed website domains**. The short
addresses are **generated** (`g26e`, `b5dh`, …) and never typed anywhere. So the root
domain worked and **every subdomain of it was refused** — which is also why the root
domain kept looking fine while the subdomains did not.

**Why it looked like "no images":** a refused origin means the browser throws the reply
away before any of our code sees it, so `api()` can only report a generic network error.
Practically everything on screen comes through that API, and **every photo travels as a
`data:` URL inside the JSON** — so the visible symptom is an app with no prices and no
pictures. (The few images served as their own binary endpoints are `<img src>` loads,
which need no CORS, which is why it was not *completely* blank.)

### The fix
`corsHostAllowed()` — a host the owner allowed now covers its **subdomains** too. That is
the whole premise of a wildcard DNS record: every label under his domain is his. Matched
on `'.' + domain`, which cannot be spoofed from outside (`ownersite.example.evil.test`
ends with `.evil.test`, not `.ownersite.example`).

**Deliberately independent of the base domain setting.** That setting exists to decide
which *country* a label belongs to; being able to reach the backend at all must not be
gated on it, or one wrong field takes the entire platform off the air. Tested with
`baseDomain` blank.

Also: **strict mode no longer parks a domain the owner typed in himself.** It depends on
the base domain to know what a country's addresses are, so with that wrong it would have
refused every address at once — including the ones he explicitly allowed. And the address
checker now reports **"Can reach the backend: yes/NO"**, because this was the one thing
invisible from outside.

### Removed
The **"Uganda · UGX" line on the sign-in screen** (Round 155) is gone — operator
diagnostics do not belong in front of members. The dialling-code chip stays live per
country, which is what Round 155 actually needed to fix. The slot is left in the markup,
blank and hidden, so nothing has to move if it is ever wanted again.

### Tests
`test-regions.js` covers the generated-subdomain case, the lookalike-domain refusals
(`ownersite.example.evil.test`, `notownersite.example`, `ownersite.example.co`), the
no-base-domain case, and strict mode sparing an allowlisted domain — **and that the CORS
middleware is what calls the rule**, since every other check calls the function directly
and would pass a middleware that quietly went back to exact matching.
`verify-regions-discriminates.py` is **140 mutations**, all caught.

**Four mutations were deleted as obsolete rather than re-anchored** — three described the
country line that no longer exists and the old strict-mode rule, and one ("an empty origin
is admitted") turned out **not to describe a real bug**: `refreshCorsSnapshot` filters
empty entries out, so `''` matches nothing either way. The `if (!h) return false` guard
stays as belt-and-braces, but no honest assertion can fail on it, so claiming a test for
it would have been a lie. *A mutation that cannot fail for the right reason should be
deleted, not propped up.*

### Round 156 follow-up — the rotation harness was flaky, not the app

`test-region-currency.py` passed on its own and went **red in the full-suite run**. The
app was fine; the harness was.

The rotation scenario waited a fixed 20s for the hop. The hop depends on a heavy
obfuscated bundle parsing *and* one request resolving, so on a loaded machine it lands
late — and a **late hop then navigated the page out from under the NEXT `page.goto`**,
which failed with an unrelated `Page.goto: Timeout 30000ms exceeded`. So the reported
error was three steps away from the cause, and the timed-out wait had only been
`print`ed, never asserted.

Fixed three ways:
- the hop window is 60s and its outcome is **recorded in `hop_ok`**, not printed;
- the signed-in case only runs **if the hop actually landed** — otherwise a hop still in
  flight lands mid-load and the failure that gets reported is not the one that happened;
- that load uses `wait_until="commit"` inside a `try`, because a goto waiting for `"load"`
  is breakable by any stray navigation;
- the `framenavigated` listener is removed at the end, so `hops` cannot keep collecting
  into a later scenario's "moved once, not round a loop" count.

Verified by running it **twice on its own and once under three other Playwright harnesses
in parallel** — the condition that produced the original failure. All green.

**Lessons worth keeping.** A fixed timeout around a navigation the page starts itself is a
flake generator: wait long, and record the outcome as a value the assertions can see. Never
`print` the failure of a wait you are relying on — assert it, or a later, unrelated error
becomes the only symptom. And where one step failing makes the next step meaningless,
**guard the next step** rather than letting it produce a second, more confusing failure.

## Round 157 — The INVITE LINK rotates, not the browsing session

> "if one clicks a link ie of Uganda, so the subdomain can be gdfs ... when he uses gdfs
> in the team links, the urls will rotate to any of that specific country ie t3gs,
> randomly every sessions ... so user can tap on team everything and sees a different
> subdomain which is not bad, so only rotation such that every subdomain is used and
> randomly, and not login session changes rotation of a link but also clicking back
> there to that section of copying referral code, a server looks for another subdomain
> of that very country randomly, and secure and perfect secured"

**This is the better half of Round 154's idea, and it is what he wanted all along.** What
rotates is the link he SHARES, not the address he is browsing on. The goal is spreading
invite traffic across every one of a country's addresses instead of burning one.

`GET /public/share-host` returns a random claimed short address of the member's own
country. The app asks on **every open of the Referral screen** — "clicking back there to
that section" picks again — so over time every address gets used. The referral **code** is
untouched; only the hostname varies, so every invite link stays valid whichever address it
names.

### Why this costs nothing, unlike session rotation
Rotating the browsing session (`rotateEntry`, Round 154) takes away the member's saved
password, his offline copy of the app and his installed home-screen icon, because a
browser files all three under **one** hostname. Rotating only the link he copies has none
of those costs — he stays where he is. **`rotateEntry` should stay `off`**; this replaces
the reason it existed.

### Security
- **The server picks.** No hostname is accepted from the request, so a member cannot aim
  his own invite link anywhere he likes.
- **His own country only.** The region is already the member's own (the region middleware
  prefers the account over the hostname), so an invite can never carry another country's
  address — where the code would be refused at sign-up as a different currency, and the
  invitee would be shown the wrong prices on the way there.
- **Claimed addresses only**, drawn from the country's own label list. A made-up label
  resolves to the founding country and is not allowed to reach the backend, so an invite
  built on one would simply be dead.
- Picked with `crypto.randomInt`, not `Math.random`.
- A failure answers `host: ''`, and the app falls back to the current origin — the member
  never ends up with a blank or broken invite link.

**One honest limitation to note:** a member can call this repeatedly and enumerate all of
his country's addresses. That is inherent to the feature — the addresses have to appear in
shared links to work at all — so they are public, not secret. If the addresses are ever
meant to resist enumeration, this feature is the wrong shape for that, and the owner
should be told rather than sold a false guarantee.

`render.yaml`'s `/refCode=*` rewrite is scoped to the **service**, not a host, so it
applies to every custom domain on `chipz-app` including the wildcard. Invite links resolve
on any subdomain.

### Tests
`test-regions.js` runs the real `/public/share-host` handler 300 times and requires **all**
of a country's addresses to appear and **none** from another country; covers the empty-pool,
no-base-domain and thrown-error paths; and **runs the real `renderReferral()` and
`shareOrigin()`** against stubs.

**Three assertions had to be rewritten to discriminate, all the same lesson in different
clothes:**
1. `shareOrigin()` could not be checked statically at all — `stripComments()` treats the
   `'//'` inside `location.protocol + '//' + h` as the start of a line comment and eats
   the rest of the line, so the "source" being matched was rubble. Run it instead.
2. "the screen repaints even when the stats call fails" passed with an early `return`
   bolted in above the repaint — the repaint was still *in the text*. Run it and count the
   paints.
3. Two older `/public/entry` mutations **drifted because the new handler duplicated their
   anchors** (`const pool = (region.labels || [])`, `if (!pool.length) return res.json(stay);`).
   Re-anchored on the entry handler's own `from`-excluding filter. *Adding a similar
   endpoint silently breaks every mutation anchored on shared-looking lines — re-run the
   discrimination suite after any such addition, not just after changing behaviour.*

One mutation was **deleted rather than propped up**: removing the empty-pool guard makes
`crypto.randomInt(0)` throw, the catch answers the identical `stay` reply, and the
observable behaviour is unchanged — so no honest assertion can fail on it.

### Round 157 follow-up — a port collision is not a test failure

The full suite reported `test-banner-video-corp.py` failing with
`OSError: [Errno 98] Address already in use`. That was **me**: I ran
`test-region-currency.py` alongside the batch to save time, and both bound port **8871**.
Whichever starts second cannot open its server and dies — which reads exactly like a real
failure and is not one. It passed on its own immediately.

`test-region-currency.py` now binds **8869**, and the two were then run **at the same
time** to prove it (both exit 0). Every harness in this suite picks its own fixed port;
keep it that way, and when one dies with "Address already in use", check for a second
harness on the same port **before** looking for a bug in the app.

Ports currently in use across the suite: 8000, 8640, 8763, 8769, 8771, 8773, 8796,
8798–8799, 8801, 8803–8805, 8812–8814, 8825, 8831, 8833, 8835, 8841, 8843, 8847, 8851,
8853, 8857, 8859, 8861, 8867, 8869, 8871, 8873, 8875, 8877, 8879, 8881, 8883, 8891.

## Round 158 — The invite link 404, and the missing link preview

> "https://gigs.myapp.com/refCode=RC9J2N ... it returns not found, why why"
> "and all all those route domains aren't fetching link preview image"

**These were the same bug plus one more, and both are now impossible rather than
configured.**

### Why `/refCode=` 404'd
`gigs.myapp.com` works because `/` serves `index.html` by default. `/refCode=RC9J2N` is a
real URL **path**, so the host looks for a file with that name and answers 404. Making it
work needs a **rewrite rule** on the host — and that rule is the most fragile thing in the
whole invite chain: it lives in `render.yaml`, which only applies if the service was
created from that blueprint, it must be re-added by hand on any other host, and while it
is missing **nothing looks wrong** until an invite is tapped.

**And the 404 killed the link preview too**: a crawler that gets a 404 page never reads
the `og:` tags, so shared invites had no title and no picture either.

New links are `<origin>/?ref=CODE` — a query string on `/`, so **no rule is needed on any
host and it cannot 404**. `captureReferralFromUrl()` still parses all three shapes
(`?ref=`, `#…?ref=`, `/refCode=`), so **invites already sent to real people keep working**.
The `render.yaml` rewrite stays for exactly that reason.

### Why the preview image was missing even where the page loaded
`og:image` pointed at `https://chipz-server.onrender.com/public/link-preview.jpg` — the
**backend** — and that had two independent ways to show nothing:
1. `serveBrandAsset()` answers **404 when nothing has been uploaded** in the admin panel.
   No picture, on every host, with nothing anywhere saying so.
2. Even once uploaded, the backend **sleeps**. A crawler allows a link preview a few
   seconds; a cold start takes far longer, so the picture would come and go depending on
   whether the backend happened to be awake.

`og:image` now names **`https://chipz-app.onrender.com/link-preview.jpg`** — a real
1200×630 file shipped with the static site. Static hosting does not sleep and cannot 404 a
file that exists. The URL is absolute and names the static site's own stable host on
purpose: an `og:image` must resolve for a crawler with no page context, and the members'
domain changes per country while that host never does.

**To change the picture, replace `chipz/user/link-preview.jpg` (1200×630).** The admin
panel's link-preview upload still serves at `/public/link-preview.jpg` for anything else.

### Tests
`test-regions.js` now **runs `captureReferralFromUrl()` over all three link shapes** plus a
plain visit. `test-brand-assets.js` asserts `og:image` is **not** a backend route, names the
static host, that the file **exists**, and that its **real** pixel size (read out of the
JPEG header) matches the declared 1200×630. `verify-regions-discriminates.py` is **151
mutations**, all caught.

**Two harnesses had assertions that pinned the bug**, and both were rewritten rather than
deleted:
- `test-brand-assets.js` required `og:image` to resolve to a registered **server route** —
  which is precisely the thing that 404s and sleeps.
- `test-manual-review.js` required the link to be `/refCode=` and **refused** `?ref=`.

*A test that pins the current shape of a thing will defend a bug as loyally as it defends a
feature. When the shape was the defect, the assertion has to be rewritten with the reason
recorded, not quietly dropped.*

And one of my own new assertions did not discriminate: "the `?ref=` shape is read" matched
`URLSearchParams(location.search)` and passed with `let ref = null;` a line later. Running
the parser over real URLs replaced it.

## Round 158 — 2026-09-14 — money/region audit repairs

- Turntable: split wallet-credit failure handling from transaction-history failure handling. A history insert can no longer re-arm an already-paid spin and create a retry double-credit.
- Referral commissions: each (investment, level) wallet credit now carries a durable `creditedCommissionKeys` token in the same atomic user update; history is find-or-create and `commissionPaidLevels` is marked last, so failures recover without double-pay or permanent under-pay.
- Product turntable grants: retries count already-created spin rows and fill only the missing remainder, so a mid-loop write failure no longer turns a 5-spin entitlement into a permanent 1/2-spin partial grant.
- Synthetic login: non-founding/dial-code regions no longer try the founding bare-local Firebase namespace as a fallback.
- Admin Dashboard: exact stats queries are no longer hard-capped; All countries money is returned/displayed per region/currency rather than summed across currencies.
- Admin transaction tables: row amounts now format with each transaction's `regionKey`.


## Round 159 — Reviewing Codex's audit push, and the bug it found in my code

Codex pushed seven audited repairs straight to `claude/chipz-platform-build`, which
**auto-deploys**, so this was reviewed after the fact rather than before. Reviewed commit
range `193aba7..1b81c96` — 192 insertions, 60 deletions across 9 files. Contained, not a
rewrite.

### Checked first: nothing of this session's was reverted
`corsHostAllowed` subdomain matching, `regionUsesBareLocal`, the currency-based referral
rule, `usesBareLocal` publication, `adminRegionFilter`, `/public/share-host`, the `?ref=`
link, `paintRegionChrome`, the sticky parked-notice stylesheet and the static
`link-preview.jpg` are all intact. **No `runTransaction` was introduced** — the M0
in-process-lock design is untouched, which was the thing most likely to be "improved" into
a double-credit. The committed bundles were genuinely rebuilt from the edited sources
(~50 chars of obfuscator rename variance out of ~300k).

### A REAL BUG IN MY OWN CODE, found by Codex
`loginAddressCandidates()` (Round 155) returned, for a **non-founding** country:

```
254712345678@…   ← correct
712345678@…      ← the BARE form, which is the FOUNDING country's namespace
```

So a Kenyan member signing in could resolve to a **Ugandan** member's Firebase account
whenever the same local digits and password happened to coincide — and a malicious one
could grind passwords against the founding namespace from their own login screen. I had
written the comment *"never another country's -- so it cannot become a way to sign in to a
Kenyan account on the Ugandan site"* directly above code that did exactly that.

**Worse, my own test exempted it.** I wrote:

```js
ck(!cands.includes(ugAddr) || ugAddr === cands[1], 'and never an address built from …')
```

The `|| ugAddr === cands[1]` is an escape hatch for precisely the collision the assertion
was supposed to catch. I noticed the overlap and wrote it off instead of failing on it.
**An assertion with an `||` that excuses the observed value is not a test; it is a
comment.** Codex's replacement is unconditional, and the fix is that only the
founding/bare namespace may try a dial-prefixed migration shape. Now pinned with its own
mutation so it cannot come back.

### Codex's other six, all verified real
- **Turntable double-credit.** The history write sat inside the same `try` as the wallet
  increment, so a failed transaction row re-armed the spin (`used: false`) **after** the
  money had landed — spin again, credited again. Now the catch covers only the wallet
  update; a history failure logs loudly and keeps the entitlement consumed.
- **Turntable partial grant.** `if (!already.empty) return;` treated one surviving row as
  "all spins granted", so a loop that died after 2 of 5 lost the other 3 forever. Now
  counts rows and fills the tail, with deterministic ids + `createIfAbsent`.
- **Referral commission ordering.** The level was marked paid *before* the wallet moved.
  Now: wallet increment carrying a durable idempotency token (`creditedCommissionKeys` +
  `updateIf $ne`) first, idempotent history second, marker last.
- **`db.js createIfAbsent`** — `$setOnInsert` + upsert, returning whether it inserted. A
  correct primitive, and notably *not* a transaction.
- **Mixed-currency dashboard totals.** My Round 155 work added `regionKey` to rows and a
  caption warning, but still *summed across currencies* in All-countries view. Codex hides
  the money cards there and shows a per-country breakdown, and labels each transaction row
  with `ugx(amount, t.regionKey)`. Better than my caption.

### The one thing I changed back
Codex removed the row caps on `/admin/stats` entirely, reasoning that a silent cap turns a
total into "first N rows". **Right about the lie, wrong about the remedy.** Atlas M0 is a
shared tier, that endpoint pulls **four whole collections** into Node memory, and the
dashboard **re-polls it every 30 seconds** (`LIVE_TABS`/`liveTick`) — so unbounded trades a
wrong number for the owner's only admin view timing out, on the one screen he uses to find
out whether anything is wrong.

Restored a high ceiling (`STATS_SCAN_LIMIT = 200000`) on all six reads, added a
`truncated` flag judged on the **raw** reads before the country filter, and the panel now
shows "These totals are incomplete" when it is hit. The figure is then either complete or
visibly flagged — the same bargain `/admin/transactions/list` and `/admin/referrals/list`
already strike in this file.

### Verification Codex did not do
It ran the `test-*.js` files. It did **not** run the Playwright/Python harnesses or
`verify-regions-discriminates.py`. Both were run here. Two mutation anchors had drifted
onto lines Codex rewrote (and one new anchor collided with `/admin/analytics`, which now
shares a line with `/admin/stats`) — re-anchored, and the suite is **157 mutations, all
caught**.

**Process note worth keeping:** an agent pushing to an auto-deploying branch means review
happens after production, not before. The review that matters is (1) are the previous
round's fixes still present, (2) were the money-safety invariants preserved rather than
"improved", (3) do the built bundles match the edited sources, and (4) run the harnesses
the other agent did not.

### Round 159 follow-up — the THIRD harness pinning the old link form

The full Python suite came back with one red: `test-round-fixes.py` demanded the clipboard
end in `/refCode=Gy2f` and explicitly **refused** `?ref=`. The value it captured
(`http://127.0.0.1:8873/?ref=Gy2f`) was correct; the assertion was not.

That makes **three** harnesses that pinned the same defect — `test-brand-assets.js`,
`test-manual-review.js`, and now this one — and I found them one suite-run at a time
instead of all at once.

**The lesson is procedural, not technical: when changing a user-visible format, grep every
harness for the old value before running anything.** One `grep -ln "refCode=" test-*` would
have found all three in a second. For the record the remaining matches are legitimate:
`test-referral-share.py` (asserts the old forms still PARSE), `test-regions.js` (runs the
parser over all three shapes) and `verify-regions-discriminates.py` (mutates them).

Kept the tail match exact (`endswith('/?ref=Gy2f')`) rather than loosening it to a
`ref=Gy2f` substring — `/refCode=Gy2f` contains that substring, so a loose assertion would
quietly start passing again if the path form ever came back.

**Full suite now green**, including `test-round-fixes.py` and `test-referral-share.py`.

## Round 160 — The check-in double-credit: eligibility read one fact, the claim wrote another

A second Codex audit reported **one** CONFIRMED critical finding and, to its credit,
**did not commit it** — "I did not push an inadequately tested money-code change."
`codex/audit-2` is still at `defd4f5`. The finding was real; it is fixed here.

### The bug
`/checkin`'s gate was `if (lastKey === todayKey)`, where `lastKey` comes from
`computeCheckinStreak()` — which reads the **transactions ledger**. The claim was written
to the **user document** (`lastCheckinAt`). **Two different facts.** So:

1. member taps Check in; the wallet credit lands;
2. the `transactions.add()` for it throws (a write error, a disconnect mid-request);
3. the endpoint answers 500 and the app offers the button again;
4. the retry rebuilds eligibility from a ledger that has **no row for today**, sees the
   day as free, and credits the bonus **again**.

Repeatable once per failed ledger write. **`withLock` cannot help**: the retry is a new
request, arriving long after that lock was released. On two Render instances there is no
shared lock at all.

### The fix — three parts, and each is load-bearing
1. **`lastCheckinClaimDay` is the claim**, written in the *same atomic document update* as
   the money. Deliberately **not** `lastCheckinAt`: that field is recomputed from the
   ledger by `/admin/user/reconcile-checkin` and by `recountAllTotals`'s freshness pass, so
   a reconciler could roll the claim back onto a ledger with a hole in it and re-open the
   identical hole. Nothing else in `server.js` writes `lastCheckinClaimDay`.
2. **The write is conditional** — `ref.updateIf({ lastCheckinClaimDay: { $ne: todayKey } }, …)`
   — so a stale read cannot pay twice, and a request whose write does not apply is
   **refused (400), not told it won**. The pre-check stays, but it is a courtesy; the
   conditional write is the guarantee. Same discipline as the turntable's daily spin.
3. **The ledger row has a deterministic id** (`checkin:<uid>:<dayKey>`) written with
   `createIfAbsent`, and its failure **must not undo the claim** — re-opening a claim
   because a bookkeeping row failed *is* the double-credit path. It logs
   `MONEY-SAFETY:` loudly instead, and the *next* attempt that day **repairs the missing
   row** (same deterministic id), which also saves the streak — the ledger is still what
   the streak number is derived from, so a hole there would silently reset it tomorrow.

**Both halves of the gate are checked** (`claimDay === todayKey || lastKey === todayKey`).
Members who checked in before this field existed have no `claimDay`, and their ledger row
is the only evidence of it — without the second half, **deploying the fix would hand
everyone who had already checked in that day one extra check-in.**

### Two test-harness lessons, and one is the reason the fix is trustworthy
**A pre-check hides the conditional write from your test.** The mutation
*"a concurrent check-in is no longer refused by the conditional write"* went **MISSED** at
first: the test never reached a *losing* `updateIf`, because the read-then-check refused
first. Both the stub and the case had to change —

- **a snapshot must be a frozen COPY** (`const frozen = {...u}`; live `ref`, frozen data),
  or the second reader observes the first one's write and correctly bails out, making every
  conditional-write mutation look harmless — the same lesson `test-spin-sources.js`
  already records, hit again in a new place;
- **a barrier must force the interleaving** — two `build(state)` calls give two *processes*
  with separate in-process locks (the Render case the conditional write exists for), held
  at the read until both have arrived. Result: wallet 500 not 1000, one ledger row, one
  200 and one **400**.

`test-checkin-idempotency.js` lifts the real handler and `computeCheckinStreak()` into a
sandbox over a stub db whose ledger can be made to fail on demand: one credit; a second
attempt pays nothing; **the reported defect** (ledger fails after the credit → the retry
credits nothing and the row is repaired); five retries still pay once; the two-process
race; and a legacy member with a ledger row but no claim field is refused.

`verify-regions-discriminates.py` now runs **both** harnesses per mutation (worst exit code
wins) and carries 6 check-in mutations — gate back to ledger-only, claim not written with
the money, `if (!applied)` removed, a random ledger id, the claim rolled back on a ledger
failure, the repair row renamed. **163 mutations, all caught.**

### Reviewing an audit that did not commit
The right order, and it is cheaper than reviewing a push: read the finding, **confirm it
against the code yourself** (this one was exactly as described), fix it, then prove the fix
discriminates by re-breaking it one way at a time. An audit that hands over a finding and
stops is more useful than one that pushes a repair to an auto-deploying branch.

### Fresh container: the Python suite needs two installs
Every `test-*.py` failed identically on the first run of this session — `ModuleNotFoundError:
playwright`, then `PIL`. The container is rebuilt per session and neither is preinstalled:
`pip install playwright pillow`. Chromium itself **is** there (`/opt/pw-browsers`,
`PLAYWRIGHT_BROWSERS_PATH` already set) — never run `playwright install`. **46 harnesses
failing at once is an environment problem, not a regression**; run one directly and read
its traceback before believing the batch.

## Round 161 — The root domain, the uploaded share card, and ONE country switch

> "l would like to delete the root domain records such that it brings this, so as l just
> remain with sub domains, also l wanted the uploaded link preview to be shown not the
> hardcoded, please check out that very well. also in the admin panel, l wanted to have a
> single switch such that it changes all contents ie l can toggle to switch to another
> country so as l see all contents ie dashboard, deposits, withdrawals, transactions,
> settings etc, note settings like dialog will be different too, so all country changes
> everything but images are same only edittable variables like prices, words like that,
> withdrawal time etc"

### 1. Deleting the root domain's DNS records — nothing in the code needs changing
Walked the whole chain before answering, and the platform already survives it:

- **The wildcard is what serves the subdomains.** `*.<domain>` is a separate record from
  the root's; deleting the root's `A`/`CNAME`/`ALIAS` leaves every short address working
  and gives the bare domain exactly the `DNS_PROBE_FINISHED_NXDOMAIN` screen he sent.
- **`www` still resolves through the wildcard** — `*.<domain>` matches `www.<domain>`, so
  deleting the root record does NOT close `www`. What closes it is `blockRootDomain`
  (default **on**), whose rule covers `h === baseDomain || h === 'www.' + baseDomain`.
  **That only works once Base domain holds his real domain**, which is the one setting he
  still has to fill in.
- **CORS is unaffected.** `corsHostAllowed()` matches the Origin *string*, not DNS, and
  `_baseDomain` is in that list precisely so every label under it is allowed.
- **Nothing in the app or the server ever fetches the root.** `API_BASE` is absolute,
  `og:image` is absolute, the manifest's `start_url`/`scope` are relative, and
  `guard-src.js` busts frames to `window.location.href`.
- **He should also remove the root as a custom domain from the Render static site**, or
  Render keeps trying to verify and renew a certificate for a hostname with no DNS.
- **`strictRegionHosts` must stay OFF** unless he adds his admin host to Allowed website
  domains: that check is `_mainAllowedHosts.includes(h)`, an EXACT match, so
  `admin.<domain>` is not covered by the base domain being allowed.

### 2. The uploaded link preview is what shares now, and the reasoning that changed
`og:image` pointed at a **static file in the build**, so Admin → Settings → Link preview
changed nothing a crawler ever saw — only a redeploy could change the share card. It
names the backend route again: `https://chipz-server.onrender.com/public/link-preview.jpg`.

**Both reasons Round 158 moved it off that route are gone, and that is why this is not a
flip-flop:**
1. *"It 404s until something is uploaded."* It cannot any more —
   `BRAND_ASSET_SLOTS['link-preview'].file` is `'link-preview.jpg'`, so the route falls
   back to the card bundled in the build, exactly as the app icon has always fallen back
   to `icon-512.png`. Upload set → the upload; nothing uploaded, or Mongo unreachable →
   this build's own card. **Never a 404.**
2. *"The backend sleeps and a crawler waits seconds."* `chipz-server` is a **paid**
   instance and does not sleep. That was a free-tier assumption, already untrue for this
   deploy when it was written.

The old "an unset share card must show NO picture, never a wrong one" rule was right when
nothing shipped in the build. A branded 1200 × 630 card **is** the right picture, so the
fallback is now the correct answer rather than a compromise.

Two delays the panel now states in its own copy, because both come back as bug reports:
the route's **five-minute** `max-age` (a fresh fetch can show the previous card for that
long) and **WhatsApp/Facebook remembering** a preview for a link already shared.

### 3. One switch, in the topbar, that changes everything
The pieces existed (`ADMIN_REGION`, stamped centrally in `api()`) but the control was a
**card injected into each tab after it painted** — so it looked like a different control
on every screen, its options *changed* between tabs ("All countries" was dropped on
Settings), it was absent from Gift Codes and Messages, and it forgot the country on every
reload.

- **It is one `<select>` in the topbar**, beside Live/Refresh, on every screen. Outside
  `#content`, so no tab render can wipe it — which is why `switchTab()` no longer waits
  for the tab to paint before drawing it.
- **The option list never changes.** A switch whose choices move as you navigate is not
  one switch. Settings and Products still mean one country at a time; they say so in a
  **note under the tabs** instead of by removing an option, and that note is also where
  an All-countries list warns that its totals mix currencies, and where a screen no
  country owns (Countries, Admins, Activity Log) says "This screen is the same for every
  country."
- **Remembered on the device** (`localStorage['chipz_admin_region']`). An admin working
  through one country's deposits, then its withdrawals, then its settings should not
  re-pick it every reload — and a panel that silently snapped back to the founding country
  is how figures get read under the wrong heading. A country that has since been deleted
  clears the stored value too, or every reload resurrects it.
- `adminOneRegion()` mirrors `api()`'s own `'all' → 'ug'` fallback, so what a one-country
  screen SHOWS and what it ASKS FOR cannot disagree. The manual payment numbers were
  filtered on the raw `ADMIN_REGION`, so with All countries picked they silently listed
  **nothing** while a save would have targeted Uganda.

### The two tabs that were not per-country yet — and one is money
- **Gift codes.** The reward is a bare number; what it is WORTH is the claimer's currency,
  so a code cut for 5,000 UGX claimed by a Kenyan pays 5,000 KES — about twenty times as
  much. Same class of bug as a cross-country referral commission, and by a similar
  multiple. A code now carries `regionKey`, `/redeem` refuses one from another country
  **before any credit**, the list is per country, and each row shows its country with the
  reward labelled in **that code's** currency rather than the panel's.
- **Messages.** Words that name a currency, an amount or an operator are wrong in another
  country. `messages` carry `regionKey`; `/messages` serves the **member's own** country.
- **Both default permissive for legacy rows:** a missing `regionKey` (every row written
  before this) means *every country*. Hiding somebody's live announcements, or killing
  gift codes already handed out, would be a far worse surprise than one row shown too
  widely — and a code that stops working reads as theft. Writing for one country is an
  explicit act with that country picked; "All countries" is still offered and stores `all`.
- **The announcement dialog was already per-country** (`annEnabled`/`annTitle`/`annBody`
  are ordinary settings, not `GLOBAL_ONLY_SETTINGS`), so "settings like dialog will be
  different too" needed nothing — it just needed the switch to reach the Settings tab.
- **Images stay shared**, as he asked: the banners, logos, app icon, link preview and
  product photos are all global slots. Only `PRODUCT_REGION_FIELDS` (price, payout,
  cycle, spin band, availability) and the per-country settings document vary.

**A footgun I wrote and then closed:** with All countries picked the panel shows messages
from several countries at once, so an edit made from that view would have **re-stamped**
the message it was editing — fixing a typo in a Kenyan message would broadcast it to the
whole platform. `'all'` now means "every country" for a NEW message and "leave it as it
is" for an edit.

### Tests
`test-regions.js` runs the real `giftCodeInRegion`/`giftCodeRegion` and the real
`listBroadcastMessages` over a stub database (Kenyan/Ugandan/all-countries/legacy rows,
a per-country welcome, a tombstone, and the settings region the built-in row is built
from), asserts the `/redeem` refusal comes **before** `FieldValue.increment`, and **runs
`paintRegionSwitch()`** over a stub DOM — options, per-tab note, hidden with one country —
then **fires its change handler** and checks what it actually did.
`verify-regions-discriminates.py` now runs **three** harnesses per mutation
(`test-brand-assets.js` joined it) and is **187 mutations, all caught**.

**Five lessons, and three cost a missed mutation each:**
1. **A fourth harness was pinning the old shape.** `test-brand-assets.js` *required*
   `og:image` NOT to be a backend route and the link-preview slot to have NO fallback —
   both written deliberately, both now wrong. Rewritten with the history in the comment,
   because this assertion has now been written **both ways** and the next person needs to
   know each flip removed the reason the previous shape existed. (This project's running
   count of harnesses that defended a bug: five.)
2. **Mutate what the test READS.** The og: mutations had to target `user/index.html`, the
   built artifact `test-brand-assets.js` opens — mutating `user-src` went undetected
   because nothing rebuilds between mutations. Added an assertion that the built page and
   the source **agree**, so a source fixed but never rebuilt is caught on its own.
3. **A text match found the wrong copy.** "the picked country is never written down" and
   "switching country no longer repaints the open tab" both survived, because the panel
   has *other* `localStorage.setItem('chipz_admin_region', …)` calls and *other*
   `switchTab(_tab)` calls. Fixed by capturing the change handler and **firing** it, then
   asserting on the recorded `setItem`/`switchTab` calls.
4. **My stub's methods closed over the factory, not the node** — `addEventListener` wrote
   `_onChange` onto the function object, and a correctly wired switch measured as unwired.
5. **Four old mutations were deleted rather than re-anchored**, each with its reason: they
   described the per-tab picker's own guard, its injection point and its live-refresh
   repaint, none of which exist now. The live-refresh one in particular *cannot* fail for
   an honest reason any more — the switch is not in `#content` — and this file already
   records that such a mutation should be deleted, not propped up.

### Owner still has to
Delete the root `A`/`CNAME` record (and remove the root custom domain from the Render
static site), keep the `*` wildcard, and **set Settings → Base domain to his real
domain** — without it `www` is not closed and short addresses match no country. Then
upload a Link preview if he wants his own card instead of the built-in one.

## Round 162 — Faster loading, and an invite address that changes instantly

> "l also need faster loading and faster changing of the subdomain rations,
> before we tackle on the removing root domain certificates"

**Everything below was measured before it was changed.** `test-boot-speed.py` is new and
exists for that: it drives the real built app and a real local HTTP server, because the
three questions here cannot all be seen with the same tool.

| | before | after |
|---|---|---|
| JSON the loading screen waits for | **1,281 KB** | **151 KB** |
| time to the first screen (artwork stalled 3s) | blocked | **141 ms** |
| round trips per read | **2** (OPTIONS + GET) | **1** |
| a second open's artwork | **900 KB again** | **0 KB** (304) |
| changing the invite address | 1 request, link repainted | **0 requests, instant** |

### 1. A CORS preflight was doubling every request
`api()` sent `Content-Type: application/json` on **every** call. That header is not
CORS-safelisted, so it turns even a plain GET into a **preflighted** request: an `OPTIONS`
round trip before every single read, per URL. Eight reads on the boot path is eight wasted
round trips, on the connection where latency costs the most.

It was never needed on a GET — there is no body to describe, and Express's JSON parser only
runs when a body is present. It is now sent **only when there is a body**. Writes still
declare theirs, and their preflight is cached for a day (`cors({ maxAge: 86400 })`) instead
of Chromium's five-second default.

**This is invisible to `page.route` and to Playwright's request events** — the browser
issues preflights below that layer — which is why the harness runs a real cross-origin
server and counts methods server-side. Measured: `['OPTIONS','GET']` with the header,
`['GET']` without, same answer.

### 2. Every launch re-downloaded a megabyte of artwork
Not one of the public reads carried a cache header, and **every admin-uploaded image
travels as a base64 data: URL inside JSON**. `/public/chipz-images` alone carries seven
slots — measured at **900 KB** with realistic artwork — and it was re-sent in full on every
single app open.

`publicJson()` now adds a **weak ETag hashed from the body it was about to send** (correct
by construction — no version counter to forget) and answers `304` with no body when the
browser already has it. Policies differ on purpose:
- **artwork** (`chipz-images`, `banner`, `announcement-image`, `manual-pay-images`) —
  `max-age=60`. Opening the app twice in a row costs nothing; an upload still shows up on
  the owner's own phone within a minute.
- **settings and products** — revalidated every time, no `max-age`. Maintenance mode, the
  opening countdown and a rate change have to bite on the *next* launch, not a minute
  later. The ETag still removes the bytes.

`Vary: Origin` is set, because these replies are per **region** (resolved from the
hostname) — without it a shared cache could hand one country's prices to another.

### 3. The loading screen now waits for four replies, not seven
Of the seven images in that bundle, exactly **two** can appear on the first screen (Home's
spin banner and the profile GIF). The rest belong to screens nobody has opened yet.

The three heavy replies are **still fired at the same instant** — delaying the fetch would
only move the wait later — but the app no longer *blocks* on them (`_artPromise`). They
land underneath, and `applyBootArtwork()` repaints Home when they do.

**The one thing that must NOT open before its picture arrives is the announcement dialog**,
because it paints once and never repaints — so that path waits on `_artPromise` (capped at
4s, and it still opens if the wait fails: an announcement with no picture beats no
announcement).

`BANNER_PRELOAD_MS` also came down **10s → 4s**. That wait is the owner's own ask and is
paid once per upload (the year-long immutable cache serves every later open from the
phone), but ten seconds of loading screen is a member deciding the app is broken.

### 4. The invite address changes with no round trip
`/public/share-host` used to answer with **one** address, so every open of the Referral
screen cost a request before the link could be painted — and it was painted **twice**, so
the address visibly changed under him a beat after the screen opened.

It now returns the country's **whole pool, shuffled** (Fisher-Yates on `crypto.randomInt`,
never `Math.random`). The app caches it and advances **locally** on each open: instant, and
it walks the pool in order so **every** address gets used, which is the point — random
picking leaves some unused and repeats others. The pool is re-read after ten minutes so an
address the owner adds reaches a member who leaves the app open, and it is prefetched at
boot so even the *first* open is instant.

**None of Round 157's security properties move**: the server still decides which addresses
exist and in what order, no hostname is accepted from the request, and it is the member's
own country only. `host` stays in the reply so a phone running the previous build keeps
working.

### The harness, and two false starts worth recording
`test-boot-speed.py` measures each question where it can actually be seen — and getting
that split right took two failures:

1. **Pointing the real app at a local server by rewriting its `fetch` does not work.** The
   page's own CSP blocked the stub origin (fixable), and then every response write died
   with a broken pipe while the app reported no error and sat on its loading screen. The
   obfuscated bundle is not what the preflight and caching questions are about, so those
   are measured on a **minimal page** that reproduces `api()`'s request shape, and the
   shape itself is asserted against the source in `test-regions.js`.
2. **A stub that speaks HTTP/1.0 cannot test HTTP caching.** `BaseHTTPRequestHandler`
   defaults to 1.0, and Chromium will not revalidate a 1.0 response at all — so a perfectly
   good ETag measured as "no 304". One line (`protocol_version = 'HTTP/1.1'`) and the same
   fixture showed `If-None-Match` and a zero-byte second fetch.

**And the first version of the boot assertion measured the wrong thing entirely.** It
counted every request made before `#app` appeared and failed on the big ones — but firing
them early is deliberate and good. What matters is whether the loader *blocks*, and the
only way to see that is to **stall those replies by three seconds and watch whether the app
still opens** (it opens in 141 ms). The byte count had the same flaw: it counted payloads at
**request** time, including ones that arrived long after the app was up. Counting on
**arrival** is what turned a meaningless 1,281 KB into the real 151 KB.

### Tests
`test-regions.js` gained the fast, mutation-suite-friendly half: it **runs** the real pool
walk (four opens, one request, four distinct addresses, wrapping, the single-host fallback,
the forced re-read), **runs** `api()` and reads the headers it really sends, **runs**
`publicJson()` for the 200/304/ETag-changes-with-content behaviour, and asserts **per route**
which cache policy is used. That last one is not decoration: the mutation that dropped the
artwork route back to a bare `res.json()` went **undetected** until it was added — proving
a helper behaves correctly says nothing about whether the heavy replies go through it.

`verify-regions-discriminates.py` is **207 mutations, all caught**. Four older anchors had
drifted onto lines this round rewrote, and two of my own were not unique (`crypto.randomInt(i + 1)`
appears in the entry handler too; `if-none-match` in three routes) — the same lesson this
file already records, hit again: **check the anchor count, not just the result.** One was
deleted as obsolete (there is no single "pick" any more) and one of mine was a **no-op**
(`IMAGE_CACHE && {…}` is just `{…}` — a truthy string and-ed with an object), which the
suite caught by reporting it undetected.

### Ports
`test-boot-speed.py` binds **8893** (static) and **8895** (stub API). Neither was in use;
the running list is in Round 157's note.

## Round 163 — Languages, per country; and the downline loader

> "l wanted to remove that of www, also please add the other loader of
> 'Loading... ' while Loading users on team of specific level, l am not saying the
> other designed loader, l wanted the other which has 4 triangle chips rotating,
> think you know it, it is already there, and it will be 4 triangles not
> 'Loading...', another thing add when can select languages of a country, so on
> login page of every subdomain of any country, at top right there is a button of
> language, it can change that very word depending on selected language, so you put
> all language code base of Luganda, so app or site can read luganda, English,
> swahili, French you'll add more 2 you think needs to be added. so make when l can
> select allowed languages of any specific country."

### 1. The downline loader
Tapping a level with nothing cached left the box showing the PREVIOUS level's
members until the fetch landed — so Level 2 looked like Level 1's list re-labelled,
which is worse than looking slow. It now paints `PLAN_SPIN` — the same orbiting-chips
markup the ongoing-plan rows and the payment page use, every length a fraction of
`--s`, so one mark and one set of keyframes now serve **32px, 56px and 150px**.

Painted **before** the await and **only** for a level with nothing cached: a level
already in `STATE.teamMembers` renders instantly, and a mark that appears for one
frame reads as a glitch. `test-languages.py` asserts both directions — it appears on
a cold level and does **not** appear on a warm one.

No word beside it: he asked for the chips *instead of* "Loading...".

### 2. Languages — six, per country
| | |
|---|---|
| Admin → **Countries** → *Languages this country offers* | tickboxes, one per language |
| Admin → **Countries** → *Opens in* | which one a device with no choice stored starts in |
| member, signed out | a button at the **top right of the sign-in hero** |
| member, signed in | **Account → Language** (he would otherwise never see that screen again) |

**English, Luganda, Swahili, French** are his four. The two added:
- **Kinyarwanda** — Rwanda, and close enough to Kirundi that Burundi reads it. Two
  countries for one dictionary.
- **Runyankole** — western Uganda. Luganda is central Uganda's language, not a
  national one, so "Uganda is covered" is only true with a second one.

**Deliberately NOT added: Amharic and Arabic.** Neither has a font in this build, and
Arabic needs a right-to-left pass over every screen — either would arrive as boxes or
a broken layout rather than as a language. That is a project of its own.

#### Keyed on the ENGLISH SENTENCE, not on codes like `login.button`
- a string with no entry falls back to **its own English**, automatically. A member
  can never be shown a missing-key placeholder.
- adding a string to a screen costs nothing; it reads English until somebody adds a row.
- and it is what makes the DOM sweep possible.

#### The sweep, and why it exists
This app draws nearly every screen by assigning a template literal to `innerHTML`.
Wrapping each visible string in `t()` would mean editing several hundred sites and
would **still** miss whatever the next round adds. So `translateTree()` walks the
rendered DOM, and a `MutationObserver` on `document.body` translates each newly
rendered subtree as it lands. `childList` only, on purpose: the function's own writes
are `characterData` and attribute changes, so observing those would feed it its own
output forever. When the language is English it is a single early return per batch.

**The original English is kept per node** (`_i18nText` / `_i18nAttr`, WeakMaps). That
is what makes Luganda → French work: the second pass resolves from the stored English,
never from the Luganda on screen — and switching back **to** English restores the page
word for word, because `t()` then returns each stored original.

**Only a whole trimmed text node that matches a row is replaced, never a substring.**
`Home Cell Battery` and `Tap Withdraw to cash out` both survive untouched even though
each contains a translated word; amounts, names and product titles cannot be rewritten
by accident. `[data-no-i18n]`, `<script>`, `<style>` and `<textarea>` are skipped.
`placeholder`, `aria-label` and `title` are translated too, so a screen reader agrees
with the screen.

#### An empty cell means "not translated", and it is used on purpose
A wrong word on a money screen is worse than an English one: a member who reads
"Withdraw" in English still withdraws. Where the right word was not certain the cell
is **left empty** rather than filled with a guess. Swahili and French are complete;
the three Bantu columns cover what a member meets on every screen and **should be read
over by a native speaker before launch** — every correction is one cell in `LANG_ROWS`,
nothing else moves. `test-languages.js` fails any cell that merely repeats the English
(French for "Messages" *is* "Messages" — that cell is blank, because a filled cell is
a claim somebody chose it).

#### Rules worth keeping
- **The button is hidden where the country allows one language.** One option is not a
  choice; a single-language country gains no furniture. Same rule the admin panel's
  country switch follows, and `paintLangButton()` applies it to the button and the
  Account row together so the two cannot disagree.
- **A stored language the country has since withdrawn falls back to the country's
  default.** The picker lists only allowed languages, so a member left in a withdrawn
  one would have nothing on screen able to switch them back.
- **A default outside the allowed list is pulled back into it**, at save time and in
  `normalizeRegion`, for the same reason.
- **A country with nothing ticked offers English alone** — exactly what every region
  stored before this reads as, so nothing needs migrating.
- **`applyRegion`'s whitelist gained `languages` and `defaultLang`.** Round 155's
  `usesBareLocal` slip is the precedent: a field left out of that list is silently
  dropped, and these two decide what the button offers and what a first launch opens in.
- **The picker is `inset:0`**, covering the bottom bar. This file's own rule: the
  overlays a nav tap can reach are exactly the ones that do NOT cover the nav, and each
  of those has needed teardown code in `showPage()`. Covering it means no teardown entry
  and no history entry.
- **Server messages are English.** Nothing on the server translates — but because the
  sweep matches whole nodes, any server sentence that is in the table is translated
  where it is displayed. The common ones are in it.
- Prices, amounts, currency labels and dialling codes are never translated.

### 3. `www` — what actually closes it
The root `A` record is gone (he confirmed NXDOMAIN). `www` still resolves, because the
`*` wildcard matches it. Two ways to close it, and he was told both: `blockRootDomain`
(already on) refuses it **once Base domain holds his real domain**, and a **more
specific DNS record at `www`** — a TXT is enough — removes it from the wildcard's reach
entirely, since a wildcard only applies to a name that has no records of its own.

### Tests
`test-languages.js` runs the real `normalizeRegion`, `publicRegionView`, `t()`,
`translateTree()`, `resolveLang()` and `applyRegionLanguages()` — the translator against
a stub DOM real enough to drive a TreeWalker (node types, `parentElement`, `closest`,
`querySelectorAll`, attributes). It also asserts **the three code lists agree**
(`LANGUAGE_CODES` in server.js, `LANGS` in the app, `ADMIN_LANGS` in the panel): a code
in two of the three is an option that does nothing when tapped, and nothing at runtime
would say so.

`test-languages.py` (port **8897**) drives the BUILT, obfuscated app: the button's box
measured against the hero's (14px in from the right, 14px down), the picker's two
options, and the screen **actually rewritten** — `LOGIN`→`INGIA`, the placeholder, the
Remember me label — because the obfuscator encodes every string literal and grepping
the deployed file proves nothing. Then a reload (still Swahili), a one-language country
(no button), a withdrawn language (falls back), the Account row, and the downline mark
sampled over real frames.

`verify-regions-discriminates.py` now runs **four** harnesses per mutation and carries
16 language mutations.

**One existing assertion was rewritten, not bumped.** `test-account-sizes.py` pinned
his mockup's **seven** Account rows and read 8. Counting **visible** rows keeps the
seven pinned *and* proves the Language row is really hidden in a one-language country —
bumping the number to eight would have thrown both away.

### Ports
`test-languages.py` binds **8897**. 8893/8895 are test-boot-speed.py's; the running
list is in Round 157's note.

#### Two process lessons from this round, both self-inflicted
- **Never build, and never run anything else that reads the sources, while
  `verify-regions-discriminates.py` is running.** It mutates `server.js`,
  `user-src/`, `admin-src/` and `user/index.html` in place and restores each after
  its own run. A `node build-core.js` fired alongside it compiled a MUTATED source
  into the deployed bundle, and the suite's results were meaningless for that window.
- **Do not `pkill` it either.** SIGTERM skips the `finally` that restores the files,
  so it leaves whichever mutation was in flight applied to the tree — here
  `labels: []`, which is a live bug that would have shipped. The tell was
  `test-regions.js` going red on five label assertions while every other harness
  passed; the whole Node suite is the cheap way to confirm the tree is clean
  afterwards, because exactly one mutation is ever applied at a time.

## Round 164 — "Product 12 failed to save spins": one sentence for fifteen refusals

> "continue however product 12 failed to save spins"

The panel printed:

> Product #1 (Product-12) has an invalid key, name, price, or (if given) cycle/return.
> Nothing was saved.

**Spins are not in that list, and spins were the only thing he had changed.**
`sanitizeProductInput()` has **fifteen** separate `return null` paths — key, name,
price, cycle, total payout, multiplier, win-from, win-to, a backwards band, spin count,
the one-off date, both window times, half a window, a zero-length window — and every one
of them arrived as that single sentence naming four fields. So the message did not merely
fail to help; it pointed at the wrong boxes. **The defect was the diagnosis, not the
validation** — every one of those refusals is a rule worth keeping.

### The fix
- `sanitizeProductInput(p, fallbackOrder, out)` takes an optional out-parameter. Each
  refusal writes `{field, why}` into it and **still returns `null`**, which is the
  contract `test-product-config.js` drives and the only thing any caller reads. The
  field names are the panel's own labels ("Spins per purchase", "Win to", "Cycle
  (days)"), so the sentence names the box rather than a variable.
- `/admin/products/save` says `Product-12: "Spins per purchase" must be a whole number
  between 0 and 20. Nothing was saved.` and returns `field` alongside `message`.
  The old `Product #1` numbering went with it — the panel saves **one** product per
  request, so "#1" was always 1 and never told anyone anything.
- The helper is named **`refuse`, not `bad`**: several harnesses lift this function into
  their own scope, and `bad` is already the failure counter in
  `test-spin-and-withdraw.js`.
- **`openFrom`/`openTo` are padded before parsing**, exactly as the cash-out-hours
  settings route already does. `hhmmToMin()` demands a two-digit hour; an
  `<input type="time">` always sends one, so this only bites a legacy document or a
  direct POST — but the two routes disagreeing about what a valid time looks like is
  precisely the kind of difference that surfaces as an unexplainable refusal. The
  **padded** form is what gets stored, so `productOpenState()` reads it back.
- **`ADMIN_MAX_SPINS = 20` in the panel**, mirroring `MAX_SPINS_PER_PURCHASE`. It is the
  input's `max` attribute, the label's "— up to 20" hint, and a typed-value check.
  `max="20"` on a number input is **only a hint**: a typed 50 sails straight past it, and
  that is the most likely thing that actually happened here — it is the one spins refusal
  with no client-side check in front of it.

### What made this worth a round rather than a one-line message change
**Two existing assertions were pinned on the `return null` text** and went red on a
rewrite that changed no rule:
`/spinCount > MAX_SPINS_PER_PURCHASE\) return null/` and `/spinMax < spinMin\) return null/`
in `test-spin-and-withdraw.js`. They were replaced by **running the real validator**
(`new Function` with `MAX_MONEY_AMOUNT`, `MAX_SPINS_PER_PURCHASE` and the real
`hhmmToMin` handed in **by name**, so a helper the validator starts using cannot be
silently satisfied by something that happens to exist in the test's own scope). That is
the assertion that was wanted all along: it cannot be defeated by a rewrite, and it also
pins that the refusal names the right field. **That is the sixth harness in this project
to have been defending the shape of a thing rather than the thing.**

`test-product-config.js` now covers all fifteen refusals by field name, **runs the
route's own message builder** over what the validator wrote (a text match on the template
would pass for a route filling in the wrong field, or none), asserts the padding both
accepts and stores, asserts `ADMIN_MAX_SPINS === MAX_SPINS_PER_PURCHASE` across the two
files, and **runs the panel's pre-flight block** with a stub `toast` — nine cases,
including the typed 50.

That last one only exists because the first mutation run reported it **MISSED**: six of
seven mutations were caught and "the panel's own spin-count check is removed" was not,
because nothing anywhere executed the panel's courtesy checks. A grep would have "passed"
it. All seven are caught now.

**One ordering note:** `eval(slice('function hhmmToMin', …))` had to move to the **top**
of `test-product-config.js`. `sanitizeProductInput()` calls that parser for a product's
daily window, and the new field-naming cases exercise that path — lifted where it used to
be, they died on an undefined helper instead of failing an assertion.

### Round 164 follow-up — the spin cap was an invented number

> "stop limiting everything bro, they are above 25 even"

`MAX_SPINS_PER_PURCHASE` was **20**, and 20 was a figure I made up. It is **200** now.

**What that number actually bounds is the write loop**, not a product decision:
`writeTurntableSpinDocs()` writes **one Mongo document per spin**, one `await` at a
time, so the cost of a grant is linear in it. That is the only reason it is not simply
removed — a typed `100000` would try to write a hundred thousand money documents. At 200
the worst case is a couple of seconds of work that happens **after** the purchase has
already answered (`grantTurntableSpins` is fire-and-forget from `/invest/create`) and
inside that investment's own lock, so nothing a member waits on gets slower.

**The sequential await is load-bearing** and is now recorded as such in the comment: a
mid-loop failure leaves the surviving rows as a **contiguous prefix**, which is exactly
what the resume logic (`start = existingCount`) assumes. Making that loop concurrent to
speed up a big count would silently reintroduce the Round 158 partial-grant bug — the
resume would have to fill **missing ordinals** instead of counting rows.

### Four hand-copied 20s, and why none of them will happen again
Raising one constant broke assertions in three harnesses, because each had **written the
number down** instead of reading it: `test-product-config.js` declared its own
`MAX_SPINS_PER_PURCHASE = 20` to feed the lifted validator, `test-spin-and-withdraw.js`
asserted `/const MAX_SPINS_PER_PURCHASE = 20;/` and restated the grant clamp as
`Math.min(20, …)`, and `test-spin-sources.js`'s sandbox handed the real
`writeTurntableSpinDocs` a stub value of 20 — which would have kept clamping that fixture
at the old cap while the shipped code allowed 200, i.e. the test would have gone on
passing while testing a bound that no longer existed.

All four now **parse the constant out of `server.js`** (`serverConst(name)` in
test-product-config.js; a regex in the other two), and the fixtures are written as
`MAX_SPINS_PER_PURCHASE + 1` rather than `99` — which, note, **stopped being over the cap
at all** when it moved, so the "absurd spin count rejected" case would have started
asserting that a valid product is refused. What is pinned about the value itself is only
that it **leaves room above 25** (his words), not that it is any particular figure.

**A constant restated in a test is a second source of truth that nobody updates.** This
file already warned "keep them in step with it" at the top of test-product-config.js;
that instruction is the tell that it should have been read rather than copied.

### One more MISSED mutation: a refusal that quotes a number
Five mutations were run over the raise and four were caught. The one that was not:
hardcoding *"between 0 and 20"* back into the spins refusal **message** while the cap
stayed at 200. Every field-naming assertion stayed green — they check `why.field`, not
the sentence — so the owner would have been told a limit that does not exist, which is
the exact class of defect this whole round was about. There is now an assertion that the
refusal quotes the live constant, and both mutation sets (12 in total) are caught.

### The other caps, stated so they are his to raise rather than mine to guess
None of these were touched, and each is either structural or already far past anything
he has used. If any of them is in the way, it is one number:

| cap | value | what it is |
|---|---|---|
| `MAX_MONEY_AMOUNT` | 999,999,999 | every price, payout, spin band, deposit, cash-out. Product-12 sits at 240,000,000, so about a quarter of it. Raisable — exact-integer safety in cents runs to ~90,000,000,000,000 — but it is the whole money layer's sanity bound, so it is a decision, not a tidy-up. |
| `multiplier` | ×1000 | per product |
| `cycle` / `cycleDays` | 3650 days | ten years |
| `returnMultiple` | ×1000 | the global fallback multiple |
| `maxWithdrawalsPerDay` | 1000 | |
| `withdrawFeePct`, `commL1/2/3` | 0–100 | these are percentages; the range IS the unit |
| `authHeroBlur` / `authCardBlur` | 40 px | past it a photo is a flat wash and only costs GPU |
| product name / key | 100 / 64 chars | |

Every settings refusal already names its field and its range
(`${key} must be a number between ${min} and ${max}`), so a limit met there says which.

## Round 165 — Every language, on every screen: measured from the screen, not the source

> "make sure every language is fixed on anything, please checkout such that none
> remaining, words such as failed, paid ... all words on login, register, dashboard,
> deposit, wallet, download app, every thing they are very very many, they should change
> uniformly in language not missing English and any language, whether redirecting to
> payment page, should change to that language, whether words in my products all terms
> there should change ... price, total, coming soon, all everything"

Round 163 shipped the language layer and measured its table as **98% full**. That figure
was true and useless: it measures the table against **itself**. What the owner was looking
at was the app, and the app was full of English.

### The method, and why the old one could not work
`extract-ui-strings.py` reads the sources with regexes and found **213** strings. A regex
has to model how each string is *built*, and this app builds nearly every screen out of
template literals, helper calls, ternaries inside attributes and strings assembled from
two halves — so anything the patterns did not model simply was not in the list, silently.

**`find-untranslated.py` asks the screen instead.** It drives the BUILT, obfuscated app
with the language forced, walks **40** screens/sheets/dialogs/sub-tabs, and reads back
every visible text node *and* every `placeholder`/`aria-label`/`title`. Anything it cannot
account for against the real `LANG_ROWS`/`LANG_PATTERNS` (parsed out of the app's own
source) is a finding. It cannot miss a string because of how that string is written.

First run, in Swahili: **78 findings**. They fell into three causes, not one.

### Cause 1 — a whole-string table can never match a sentence with a figure in it
`Fee: 15%`, `LV1 = 27%`, `New Balance: UGX13,293.23`, `Minimum deposit amount: UGX 30,000`,
`ID: 00042`, `2 Members`, `Joined 01/09/2026 10:00`, `0 spins available`,
`Withdrawal amounts should be between 20,000 and 1,000,000.` — the figure is spliced in at
render time, so the string differs every time and **no row can ever equal it**. Adding
rows cannot fix this class; it needs a second lookup.

**`LANG_PATTERNS`** is that lookup: 22 templates with `{0}`/`{1}` where the figure goes.
`t()` falls through to `tPattern()` when the whole-string lookup misses.

- **Only the literal words are translated.** Whatever `{0}` captured is copied across
  verbatim, so an amount, a date, a percentage or an account id can never be rewritten,
  reformatted or reordered by a translation. On a money screen that is the whole point.
- **Placeholders are NUMBERED, not positional**, because a translation is allowed to move
  them — Swahili renders `2 Members` as `Wanachama 2`.
- **Anchored end to end**, so a template can never rewrite part of a sentence it does not
  own. `Paid in full: 15% of nothing` comes back untouched.
- **Compiled once and sorted by how much literal text each template carries**, longest
  first, so a specific template always beats a loose one *regardless of the order the
  table is written in*. Hand-ordering a table is exactly the kind of thing that rots.
- `test-languages.js` asserts every translation keeps **every placeholder the English
  uses** — a template that drops its `{0}` silently drops a figure off a money screen, and
  that is invisible from a screenshot (it renders as the translation, just missing a
  number), which is why it is pinned by comparing templates rather than by looking.

### Cause 2 — the About page was chopped into one span per WORD
`revealWordsHtml()` wrapped every word in its own `<span class="reveal-word">` with its own
`animation-delay`, for a staggered reveal that was **removed on request** — `.reveal-word`
is `opacity:1;transform:none` and nothing animates. So the split had stopped doing anything
at all except **making the page untranslatable**: the sweep matches a WHOLE text node, and
a sentence in fourteen one-word nodes matches nothing. That is exactly why the report
listed `and`, `of`, `in`, `you`, `products`, `daily`, `invest` as findings.

It is one span per BLOCK now. **The class is kept deliberately**: a stale
`.reveal-word{opacity:0}` rule is what blanked this page once before, and
`test-visible-text.py`'s guard only means something while something still carries it.

### Cause 3 — an attribute written AFTER the sweep was never translated
The observer was `childList` only. `updateReferralFieldHint()` sets `#regReferral`'s
placeholder *after* the auth screen has been swept, so **the Sign Up referral field stayed
in English in every language** — the one field on the one screen every new member meets.

It observes `attributeFilter: I18N_ATTRS` now. `characterData` is still deliberately NOT
observed: that IS the translator's own text output and there is no way to tell it apart
from app code writing the same string, so observing it would feed the translator its own
result forever.

**Attributes are only safe to observe because `i18nElementAttrs` now remembers what it
WROTE, not just the English it was given.** Two things depend on that second field, and
the second one is a bug the coverage sweep structurally cannot see:

- an observer record arrives a microtask later, so a "we are writing now" flag cannot
  work; recognising its own output is the only thing that stops the loop;
- app code is allowed to **replace** a placeholder with *different* English. Remembering
  only the first English ever seen translates the OLD sentence back over the new one —
  the **wrong sentence, in the right language**. No sweep looking for English can ever
  see that, so it is asserted in `test-languages.js` by replacing the attribute and
  reading what comes out.

### What is deliberately still English, and why
- **Anything the owner types in the admin panel** — message titles and bodies, the
  announcement text, About blocks, the brand tagline once he sets one. Nothing in this
  repo can translate a sentence written at runtime. Listed explicitly in the tool
  (`ADMIN_AUTHORED`) rather than guessed at, so a real string can never be waved away as
  "probably admin copy".
- **Amounts, dates, times, currency labels, dialling codes, account ids, product names.**
  Translating any of these would be a bug.
- **`07XX XXX XXX`** was a table ROW and should never have been: it is a number *mask*,
  identical in every language, so it could only ever be an empty cell reported as a gap
  forever. Row deleted, added to the tool's data patterns.
- **`PAY-A` / `PAY B` ARE translated** (`LIPA-A` / `LIPA B` in Swahili) — but the **letter
  is kept**, because the admin panel where he configures them still says PAY-A / PAY B, so
  a member naming one is still unambiguous.

### `'='` — a chosen match is not a missing translation
French for *Messages* is *Messages*; the same is true of *OK*, *Service* and
*Transaction*. Those cells were **blank**, which is byte-identical to "nobody has
translated this yet" — so the tool reported the same four French words as gaps on every
run, forever. A cell may now hold **`'='`**, meaning *the right word in this language IS
the English word*. `DICT` stores no entry for it (so `t()` returns the English, exactly as
a blank does); the only difference is that the coverage tool can tell the two apart.

### The sweep's own length cap was a silent trap
`i18nTextNode()` skips any text node longer than **160** characters, so the translator
cannot be dragged through a wall of member content. A row longer than that is therefore a
row that **can never apply**, with nothing at runtime saying so. No row exceeds it today
(longest is 127) and `test-languages.js` now reads the cap **out of the source** and fails
if any row or template does.

### Result
| | before | after |
|---|---|---|
| table rows | 222 | **255** |
| pattern templates | 0 | **22** |
| filled cells | 1096/1110, 14 blank | **1269/1275, 0 blank** |
| cells deliberately identical to English | 0 (indistinguishable from blank) | **6, marked `'='`** |
| Swahili findings over 40 screens | **78** | **0** |
| Luganda / French / Kinyarwanda / Runyankole | not measured | **0 each** |

The last three blanks were worth chasing rather than declaring acceptable, and they split
the way the rest did: French for **Recharge** is *Recharge* and for **Total** is *Total*
(both now `'='`, a choice rather than a hole), while **TURNTABLE** was simply the
uppercase twin of a row filled earlier in this round and had been missed.

`test-i18n-coverage.py` is the standing assertion — it runs the sweep **once per
language**, because every column is a separate claim: Swahili came back clean while French
still showed five English sentences and Runyankole three. "Uniformly, not missing any
language" is only testable by rendering each one. It fails on a page error or a step that
would not open, too: *"no findings" from a screen that never rendered is the most dangerous
kind of green.*

### Five lessons, and four of them cost a missed mutation
`verify-i18n-coverage-discriminates.py` breaks the work eleven ways; **five were MISSED on
the first run**, and every one was a hole in my own harness rather than in the app:

1. **"Failed" and "Paid" — the two words the owner named — could be deleted from the table
   undetected.** The ledger pill's three words come from `balRowStatus()`, which reads the
   transaction's **description** (`Withdrawal: Paid`) and classifies it, not its `status`
   field. Every fixture row had a `desc` key the app never reads, so the pill always fell
   through to `Pending` and the other two states had **never once been on screen while
   anything was measuring.** A fixture that cannot reach a state cannot test it.
2. **The founder-account Sign Up wording had never rendered either** — the fixture always
   sent `referralRequired: true`. Rendering the other state immediately found **two more
   real gaps** (`Referral code (optional)` and `No code needed yet — you are among the
   first to join.`), which is what the very first member of a new country reads.
3. **`referralRequired` sits INSIDE `settings`**, not beside it. Put in the wrong place it
   was ignored, the optional state silently never rendered, and the run still said "0
   findings" — a fixture wired to the wrong key is indistinguishable from a passing test.
4. **A pattern that drops its `{0}` is invisible from the screen** (it renders as the
   translation, minus a figure). It is caught by comparing placeholder sets in
   `test-languages.js`, so the mutation harness has to run **both** harnesses and take the
   worst exit code.
5. **The tool's first classifier reported 108 correct Swahili translations as findings**,
   because its only test for "is this English" was "does it contain a latin letter" —
   which Swahili does too. A finding has to be *a string the table cannot account for*,
   not *a string that looks foreign*: it now compares against every value the table can
   PRODUCE, patterns included.

And one measurement bug worth keeping: the sweep normalises whitespace runs to a single
space, and JS `\s` matches **U+00A0** — so `Frais : 15 %` came back with a plain space
where the French template has a non-breaking one, and **five correct French translations
were reported as untranslated English.** Normalise both sides, or the tool invents work.

### Still open, honestly
- **The three Bantu columns want a native speaker's eye.** They are complete and
  consistent, and every correction is one cell in `LANG_ROWS` with nothing else moving.
- **Server-sent sentences are English** unless the exact sentence is in the table (the
  common ones are). A sentence the server composes with a figure in it is covered only if
  its shape is in `LANG_PATTERNS`.
- `openSimpleConfirm()` has **no call sites** — it is dead code (the saved-account
  deletion it was written for is gone in Chipz, which binds one wallet). The coverage
  sweep opens it anyway to exercise its chrome, and passes table strings as its arguments
  on purpose: a literal of the test's own invention would be reported as untranslated app
  copy, which it is not.

### Ports
`find-untranslated.py` binds **8899**, and `test-i18n-coverage.py` shells out to it, so
the two cannot be run at the same time. The running list is in Round 157's note.

### Two harnesses went red in the first full-suite run, and only one was a defect
- **`test-visible-text.py` was right to fail.** It asserted `words > 5` on the About
  page, counting one `<span class="reveal-word">` **per word** — the very split this round
  removed. The number was NOT simply lowered to 1: what that assertion is *for* is "the
  article rendered real content", so it now counts the words **inside** the spans, which a
  one-span render satisfies honestly and an empty or one-word render still fails. The
  class and its one-rule guard stay, because a stale `.reveal-word{opacity:0}` is what
  blanked that page in the first place. **This was predicted while making the change and
  then forgotten** — the standing rule from Round 159 applies and was not followed: when
  changing something a harness measures, grep every harness for it *before* running
  anything.
- **`test-i18n-coverage.py` was a port collision, not a failure.** I ran it by hand while
  the batch was also running it, and both shell out to `find-untranslated.py` on 8899.
  Reproduced deliberately to be sure rather than assumed: two concurrent runs give one
  `OSError: [Errno 98] Address already in use` and one clean pass. That is the **fourth**
  time this shape has appeared in this project; the rule stands — when a harness dies with
  that error, look for a second copy of it before looking for a bug in the app.

## Round 166 — The popups, and the ticker that scrolled Uganda's money at every country

> "I am sure you didn't even change the language of some instructions, popup notifies ⚠️
> still in English, even make sure on currency change the activity checker should be
> changing currency too basing on the products and values of the system"

Both true. The i18n sweep had reported **zero** findings the round before, and the reason
it could is the most useful thing here.

### Why a 40-screen sweep saw no English popups
**A popup only appears when something goes WRONG, and the sweep walks every screen
SUCCESSFULLY.** It never submits a blank amount, never mistypes a password, never gets a
refusal back from the server. So **58 `notify()` call sites existed and exactly one had
ever been on screen** while anything was measuring — and that one was handed a string out
of the table by the harness itself.

Auditing the call sites instead of the screens (walk each call's argument expression, pull
out every string literal) found **17 plain messages with no row** and **6 built with a
figure spliced in**, which need templates. Among them every `r.message || 'Could not …'`
fallback — which is exactly what a member reads when the server sends no message of its
own, i.e. the worst moment to be handed a foreign sentence.

**Runtime cannot close this class**: reaching all 58 means provoking 58 distinct failures.
So `test-languages.js` now audits the **inventory** — every literal passed to
`notify()`/`toast()`/`manualPayToast()` must be covered by a row or a template. That
catches the real failure mode, which is a message added later with no row. 61 call sites
audited, 0 missing.

Three things that had to be right for that audit to be honest:
- **Comments stripped first, line comments before block comments** — this file's own
  explanations quote message text. Fifth shape of that trap in this project.
- **Only the FIRST argument is the message.** `notify()` also takes an onClose callback,
  and swallowing it turned the tail of a real sentence into one anonymous `{1}`, which
  then failed to match a template that was perfectly correct.
- **Concatenation is one message.** ``notify(`Cash-out of ${a} is processing. You will
  receive ` + `${b} after the ${c}% charge.`)`` is ONE sentence on screen; looking at the
  halves separately reported two correct templates as missing. The auditor splits on
  top-level `+` and shapes the whole chain, so a non-literal gap becomes `{n}` exactly as
  an interpolation does — which also covers `'…installing ' + brandName() + '.'`, whose
  old ROW could never match the rendered string and had therefore never once applied.

### The activity ticker: two faults, and the first hid the second
**1. One module-level cache for every country.** `buildActivityFeed()` was already
region-correct *inside* — `getSettings()`, `getProducts()` and `maskedMsisdn()` all read
the request's region out of `AsyncLocalStorage` — but the result was stored in a single
`_activityFeed` array. Whichever country's request built it first won, and every other
country was served that one for the life of the process. **A cache in front of a
region-aware builder has to carry the region in its key**; it is `Map<regionKey, slot>` now.

**2. Two hardcoded Ugandan ladders**, which the cache bug was hiding. Deposits came from a
fixed list running 30,000–4,500,000 and withdrawals stepped 5,000–900,000. On a market
where a product costs 500 and the minimum cash-out is 300, that ticker scrolls figures
**sixty times too large** — money nobody there has ever moved.

`activityPools(sett, products)` replaces both, and **contains no money-sized literal at
all**:
- **deposits** — every active product's price plus the minimum recharge. Those *are* "the
  products and values of the system", and they arrive already in that region's currency
  because `getProducts()` resolved them through the region overlay.
- **withdrawals** — whole multiples of that region's own `withdrawMultiple`, from its own
  minimum upward. A cash-out that is not a *legal* amount on that market is a number no
  member could have requested, so inventing one is what makes a feed read as fake.
- Capped at 40 entries (a 1-unit multiple would otherwise build a huge array) and every
  pool falls back to something non-empty — **an empty pool indexes `undefined` and scrolls
  "UGX NaN"**.

**Why it read worse than an obviously wrong number:** the client labels the amount with
its OWN currency (`fmtUGX` → `cur()`), so a Kenyan member saw Ugandan prices with **KES**
in front of them.

`test-activity-feed-region.js` runs the real pools, `maskedMsisdn`, the builder and the
route against two countries whose money **does not overlap** — that is the design of the
fixture, so any figure traces to exactly one country and a leak cannot be mistaken for a
coincidence. It also asserts the pool builder holds no 4-digit literal and that both old
ladder constants are gone from `server.js` entirely.

### The ticker's own words had never rendered either
`topped up` / `cashed out` were missing from the table for as long as the table has
existed, because `find-untranslated.py` fed the ticker an **empty feed**. A fixture that
renders nothing cannot test what renders — the third time that exact sentence has been
written in this file, after the ledger pill's `Failed`/`Paid` and the founder-account
Sign Up wording last round. The fixture carries three real rows now.

### Result
| | before | after |
|---|---|---|
| table rows | 255 | **274** |
| pattern templates | 22 | **28** |
| row cells filled | 1269/1275 | **1364/1370** (6 deliberate `'='`, 0 blank) |
| pattern cells filled | — | **140/140** |
| popup call sites with no translation | **17 + 6 templates** | **0 of 61** |
| ticker figures on a non-founding country | Uganda's | **its own** |

### The control mutation, and why it is in the harness
The mutation set opens with a deliberate **no-op** — a variable declared and never used —
asserted to be reported **MISSED**. If a harness ever "catches" that, it is failing for
some reason unrelated to the mutation, and every other CAUGHT in that run means nothing.
Eight real mutations, all caught; the control behaved.

## Round 167 — The admin panel speaks every language, and it runs the app's translator

> "also make when in admin, you can change its language too, everything there"

### The panel does NOT have a second translator
`build-admin.js` lifts the i18n **engine** and the member app's own **string table**
straight out of `user-src/original_module.js` at build time, into two marked regions of
`admin-src/index.html`, and the panel concatenates its own rows onto them. Not a copy
checked into the repo — a copy made by the build, from one source, every time, so drift
is impossible rather than merely tested for.

Two reasons it is shared rather than written twice:
- the engine is ~150 lines that took a round and eleven mutations to get right (the
  pattern fallback, the whole-node rule, the WeakMap of originals, the attribute observer
  that has to recognise its own output). A second implementation would be subtle in
  exactly the places nobody re-reads. This project already keeps ONE such pair in step by
  hand (`phoneToEmail`) and needs a dedicated test to prove they still agree.
- the panel and the app share a couple of hundred **words** — Deposit, Withdraw, Save,
  Cancel, Settings, Pending, Failed, Paid, Products, Messages. Two hand-kept tables would
  drift cell by cell until the same button read differently on the two screens.

**The order the three pieces run in is load-bearing and invisible**: `DICT` and
`LANG_PATTERN_RE` are built ONCE, at the moment the engine's own text runs, so the
concatenation has to sit **between** the two injected regions. A tidier placement after
the engine would compile and translate nothing. `test-admin-i18n.js` pins the order by
byte offset.

`build-admin.js` **refuses to build** if either marker is missing at either end, or if
the injected result carries no `translateTree`/`startI18nObserver`. The failure it is
guarding against is a panel that boots perfectly and silently never translates anything,
which nobody notices until the owner does.

### Where the operator changes it
| | |
|---|---|
| topbar, beside the country switch | on every screen, never hidden |
| the sign-in card | the one screen standing between an operator and the panel |
| remembered | `localStorage['chipz_admin_lang']`, per device |

**The topbar picker is never hidden**, unlike the country switch. Which words the person
reading the panel understands is not a property of the country they are administering.
Both `<select>`s carry **`data-no-i18n`**: their options are each language's own native
name, and a picker whose options change language as you change language is unusable.

### The table: 311 rows and 24 templates, every one of them measured
`find-admin-untranslated.py` (port **8901**) drives the **built, obfuscated** panel with
the language forced, walks all 14 tabs plus their sub-tabs and the user-detail modal, and
reads back every visible text node and every `placeholder`/`aria-label`/`title`. The
panel's own copy is ~4× the member app's, so "I think I got them all" is worth nothing —
and grepping `admin/index.html` proves nothing either, because every string literal is
encoded.

First run: **503 findings**. Final: **0, in all five languages** (317–350 strings
accounted for per language). `test-admin-i18n-coverage.py` is the standing assertion and
runs the sweep once per language, because every column is a separate claim.

`admin-rows-*.py` hold the rows as a **table** rather than as JavaScript, and
`build-admin-rows.py` is the only thing that writes them into the source. It refuses on:
a row that is not exactly six cells (a short row silently shifts every language after the
gap by one column, which reads as a working translation in the wrong language), a blank
cell in any column, a cell that merely repeats its English (byte-identical to a blank at
runtime, so a filled one is a claim nobody checked — use `'='`), an English key over the
engine's 160-character cap, a duplicate key within the panel **or against the app's own
table**, and a template whose translation drops a placeholder.

**The cap applies to the ENGLISH only.** `i18nTextNode()` measures the text node it
found — the key — and a translation is free to run longer, which most of them do. A first
version of the guard capped every cell and rejected four correct rows.

### `'='` now means the same thing in a template as in a row
It was only ever handled in `DICT`. In `LANG_PATTERNS` a `'='` cell passed
`tPattern()`'s truthiness check and would have been used **as the template**, rendering
`Plans (0)` as a bare `=`. One line in the shared engine; the sweep and
`build-admin-rows.py` were taught it too. French needs it for `Transactions ({0})` and
`Plans ({0})`, and eleven row cells besides.

### What deliberately stays English, and why it is not a fudge
- **`fragment` (163)** — a piece of a sentence that inline markup broke up:
  `<p class="muted">Set it under <b>Settings</b>, then add the <code>*</code> record.</p>`
  is four text nodes, none of them a sentence. The translator matches WHOLE text nodes,
  so no row can ever apply to one — and `", then add the"` translated out of context is
  nonsense. Detected structurally (walk up past inline tags, ask whether the block owner
  holds more than one node), not by a length guess. A string that renders whole on ANY
  screen clears the flag, so one clean rendering wins over a spliced one.
- **`too-long` (43)** — over the engine's own 160-character cap, so a row could never
  apply. These are the long operator-documentation paragraphs in Settings and Countries.
- **Admin-authored content and defaults** — message bodies, the announcement, About
  blocks, the tagline and maintenance notice the panel ships for him to overwrite, the
  USSD steps template. Nothing in this repo can translate a sentence written at runtime.
- **Money, dates, account ids, hostnames, referral codes, a member's pasted payment
  SMS.** Translating any of these would be a bug. The pasted SMS in particular is
  somebody else's message and must reach the admin exactly as sent.

The three Bantu columns want a native speaker's eye before launch, exactly as the member
app's table says. Every correction is one cell in an `admin-rows-*.py`, nothing else
moves.

### The two tabs that had never rendered — and the check that now refuses to call that clean
Deposits and Withdrawals produced **zero findings through five batches**, and both were
correct-looking green. `switchTab()` runs each renderer as
`Promise.resolve(fn()).catch(() => {})`, so a renderer that throws leaves `#content`
empty, raises **no page error**, and the sweep cheerfully reports nothing to fix for the
two screens where money is actually approved. The cause was my own fixture:
`processedByDay` was an object where `renderWithdrawals` spreads an array
(`Math.max(1, ...pbd.map(...))`, which runs *before* the `pbd.length ?` guard).

`collect()` now records "the screen rendered NO text" as an **error**, not a note, and
the sweep exits non-zero on it. Fixing the fixture immediately produced **29 more real
findings** (Approve, Reject, Force-credit, Needs Review, Destination, Net, every counted
filter label). That is the **fourth** time in this project that a fixture which could not
reach a state was mistaken for a feature that worked — after the ledger pill's
Failed/Paid, the founder Sign Up wording, and the activity ticker's own verbs.

### Fixtures live in ONE file
`find_admin_fixtures.py` — the sweep and `test-admin-i18n.py` both need every tab to
paint, and two copies would drift, with the drift showing up as a screen quietly no
longer being covered.

### Tests
- **`test-admin-i18n.js`** — performs the lift here and requires the result to hold every
  engine name and none of the host-specific ones; pins the concat order; checks the build
  really does refuse; then the whole table's hygiene; then **runs the real engine** in a
  sandbox to prove `'='` behaves identically to a blank in both tables and that a
  template copies its figure across untouched.
- **`test-admin-i18n.py`** (port **8903**) — drives the BUILT panel: the sign-in card
  translates before anyone signs in, the tab bar and dashboard after, a tab opened
  **after** the switch (the observer, and the whole of "everything there"), switching back
  to English restoring the panel word for word from stored originals, the choice surviving
  a reload, and money/phone/referral code left alone. "Products"/"Messages" are asserted
  specifically because they have **no row in the panel's table** — they can only be
  translated if the shared table really was lifted, so they are the one assertion a no-op
  injection fails.
- **`test-admin-i18n-coverage.py`** — the sweep, once per language, with a floor on how
  many strings were accounted for so "0 findings" cannot mean "0 screens".
- **`verify-admin-i18n-discriminates.py`** — 14 real mutations plus a control, rebuilding
  the panel each time, judged on the **exit code**. A refused build counts as caught,
  because refusing is what it is for. All 14 caught; the control behaved.

**Two of them were MISSED on the first run, and it was the harness, not the guard.** Both
mutate a row in `admin-rows-1.py` — but the tests read `ADMIN_LANG_ROWS` out of
`admin-src/index.html`, and `build-admin-rows.py` is the only thing that puts it there.
Without re-running the merge, mutating a row was **a no-op pretending to be a mutation**.
The harness runs the merge for a rows-file mutation now, and its refusal counts as caught
exactly as the panel build's does — both are then caught. *A mutation aimed at a source
that something else has to compile is not applied until that something else runs.*

### A test trap worth keeping
`test-admin-i18n.py` first looked for `Status` in the withdrawals table and **never found
it in either language** — the headings carry `text-transform:uppercase`, so `inner_text`
returns `STATUS`. That failed a working panel, while its companion assertion ("no English
heading left") passed having measured nothing at all. Both now match case-insensitively
and are **scoped to `thead`**: "destination" also appears inside the manual-payments help
paragraph, which is one of the fragmented sentences that stays English, so a whole-tab
match would fail on prose rather than on a heading.

### Why not just let Chrome translate the page?
Owner: *"what if we use it but it triggers chrome translator? instead of taking long time
doing the stuff"*. A fair question, and the answer is four things Chrome's translator
cannot do, none of which depend on its quality:

- **An installed app has no translate menu.** Chrome's translate UI lives in browser
  chrome — the address bar and the three-dot menu. A PWA added to the home screen runs
  standalone with none of it. Both the app and the panel are installable on purpose, so
  for anyone who installed them it is simply not reachable.
- **Runyankole is not in Google Translate at all.** Luganda was added in the 2022 batch;
  Runyankole was left out of it. One of the six languages would not exist.
- **It translates everything, including what must never be touched.** The Deposits tab
  renders a member's pasted mobile-money SMS *verbatim* precisely so a person can check a
  real payment against it. Machine-translating that is worse than showing nothing; the
  same goes for holder names, product names and reference ids.
- **It is the viewer's browser setting, not the owner's.** He asked to set the panel's
  language *from the panel*. A site cannot enable Chrome translate, choose its target
  language, or set it for staff.

**Where it IS useful, and what was done about that:** the long help paragraphs that stay
English by construction (over the engine's cap, or split into fragments) are exactly what
Chrome's translator handles well in a browser tab. So the two are made not to fight:
`markAdminPageLanguage()` keeps `<html lang>` on the language the panel is really
rendering in — left saying `en` over a Kiswahili panel, Chrome offers to
machine-translate our own translation, which is the one way this gets worse rather than
better — and the pasted-SMS `<pre>` carries **`translate="no"`** so that even with Chrome
translate running, the one message an admin verifies a real payment against reaches them
as it was sent. `<html lang>` also decides how a screen reader pronounces the page, so it
was worth setting regardless. The member app already set it.

### Ports
`find-admin-untranslated.py` binds **8901** and `test-admin-i18n.py` **8903**;
`test-admin-i18n-coverage.py` shells out to the sweep, so the two cannot run at once. The
running list is in Round 157's note.

## Round 168 — The spin wheel shows what it pays

> "why the spin wheel has no amounts?"

Because there were none to show. The wheel was eight coloured wedges from a CSS
`conic-gradient`, a pointer and a "SPIN" hub, with nothing written on it — and the code
said as much in its own comment, *"the wheel is decoration"*. `rollSpinReward()` drew
**any** figure between the admin's minimum and maximum (`crypto.randomInt` across the
whole band), so there was no slice-to-prize mapping that could have been labelled. The
band was stated, but in the rules list underneath; spins earned from products did not
state theirs at all.

Owner's steer when asked which way to fix it: *"Do the best basing on the set spin ranges
on products amount ranges and that amount of daily spin"* — so no new admin config. The
bands he already sets are the source.

### The wheel and the wallet are now the same list
`spinWheelSlices(lo, hi)` builds **eight amounts** from a band, `rollSpinSlice()` picks
one of them, and `rollSpinReward()` is a wrapper over it. The slices are computed **on the
server**, used by the roll, and sent to the client to render.

**That direction is the whole point.** A wheel stopping on 600 while the wallet receives
587 is a money screen telling a lie, and the only way to guarantee they agree is for one
side to decide and the other to draw what it was given. Deriving the same list on both
sides is the `phoneToEmail` hazard — two copies that agree until one is edited, needing a
dedicated test to prove they still do.

- the ends of the list are **exactly** `lo` and `hi`, because those are the figures the
  admin typed and the copy under the wheel promises;
- the middle six are evenly spaced, then rounded to a step that suits the band's width
  (500 / 50 / 5 / 1), so a 200–1,000 band reads **200, 300, 450, 550, 650, 750, 900,
  1,000** rather than 200, 314.29, 428.57;
- **a zero-width band is not a broken one** — `min == max` means every spin pays that,
  and all eight slices show it;
- mean is unchanged (evenly spaced across the band has the same mean as uniform over it),
  so this is not a payout change in cost terms. Measured: 4,000 rolls of 200–1,000 mean
  **604**.

### The wheel is labelled with the band of the spin that is actually next
Not always the daily one. `/turntable/spin` takes the free daily spin if available and
otherwise the **oldest unused earned spin**, which carries the band its product had when
it was granted. `spinBandOf()` resolves that (including the pre-band spins that carry a
flat `reward`, honoured as a zero-width band rather than paid as 0), and
`/turntable/status` runs the same resolution so the wheel shows the prizes the next tap
can actually win. The extra read only happens when there IS an earned spin to describe.

`/turntable/spin` returns `slices` and `sliceIndex` **as well**, even though the client
already has a set from status: the spin actually taken may not be the one status
described — another device could have used the daily spin in between — so the wheel is
relabelled before it lands rather than stopping on a stale prize.

### Landing on the winning slice without re-introducing the delay
Slice *i*'s centre sits at `i*45 + 22.5` degrees clockwise from 12 o'clock, so it reaches
the pointer when the wheel has turned the negative of that. The remainder is taken modulo
360 **upward**, so the wheel never visibly reverses to reach its answer.

**The re-aim shortens the transition to what is left of the original 4s rather than
starting a fresh one.** Re-targeting a `transform` restarts the transition by default,
which would serve the request time twice over — exactly the delay Round "congratulations
card" was written to remove. The wheel still settles 4s after the tap and now settles on
the right number; a floor of 600ms covers a request slower than the whole spin, and the
card waits for `landMs` rather than `remaining` or it would announce a prize the wheel has
not reached. The 4s duration is handed back afterwards, or the next spin inherits the
shortened one and snaps round instead of turning.

Labels are **upright**, not rotated to follow the wedge: eight rotated numbers on a 250px
wheel are a puzzle to read, and this is money. The currency is stated **once** under the
wheel (`All amounts in UGX`, from the region) rather than eight times on it, and no figure
is shortened.

### Tests
`test-spin-and-withdraw.js` runs the real slice builder and 4,000 real draws: eight
slices, ends exactly the admin's figures, ascending, inside the band, round figures, every
payout **is** the slice the wheel will stop on, and **every slice reachable** — a slice
that can never win is a prize the wheel shows and never pays.

`test-spin-wheel.py` (port **8905**) drives the BUILT app, because the obfuscator encodes
every string literal and reading the deployed file proves nothing. It asserts the eight
figures are on the wheel and are **the server's own list**, that each sits inside the rim
and clear of the hub, that the wheel **stops on the slice that was paid** (computed from
the rendered `matrix()`, not from a class name) and the win card names the same figure,
and that a product band **relabels** the wheel — with the two fixture bands deliberately
non-overlapping so "it was relabelled" cannot pass by coincidence. Verified by mutation:
landing anywhere fails the landing assertion; having the app invent its own slices fails
two.

### Three harnesses lifted `rollSpinReward` and broke
`test-spin-and-withdraw.js`, `test-spin-sources.js` and `test-product-config.js` all
`eval` it out of `server.js`. It is a wrapper over `rollSpinSlice` now, so lifting the
wrapper alone left it calling something not in scope. All three now lift from
`var SPIN_SLICES` through the roll. `test-spin-and-withdraw.js`'s *"it uses
crypto.randomInt"* assertion was right to fail meanwhile — the randomness moved into
`rollSpinSlice`, and the assertion is about where the payout's randomness comes from, so
it has to look at the function that actually calls for it.

`test-spin-sources.js` also gained a `serverConst()` helper so `SPIN_SLICES` is read out
of `server.js` rather than restated — the same lesson as the four hand-written `20`s that
raising `MAX_SPINS_PER_PURCHASE` left behind.

## Round 169 — PesaJet, a third automatic gateway for Uganda

> "l would like also to introduce in a new gateway for Uganda
> https://pay.pesajet.com/docs" ... "can't you get it as of now?"

### The docs could not be read, and did not need to be
`pay.pesajet.com` (and `pesajet.com`, and `docs.pesajet.com`) are refused by this
environment's egress proxy — 403 at the CONNECT, logged, and `google.com` is refused
too, so it is a narrow allowlist rather than anything about PesaJet. The proxy README is
explicit that a policy denial is to be reported rather than routed around.

**`registry.npmjs.org` is in the proxy's `noProxy` list, so npm IS reachable.** PesaJet's
landing page names its own SDK, so `npm pack @pesajet/sdk` (v1.0.2) and its `dist/`
yielded the whole contract — the same one the SDK speaks, therefore authoritative for
endpoints, headers, field names and status values. Recorded in **`docs/pesajet-api.md`**,
with provenance and with **seven things the SDK does not answer written down as questions
rather than guessed at** (sandbox URL, amount units, min/max, whether payouts draw on a
pre-funded float, `reference` uniqueness, webhook retry policy, IP allowlist).

**When a vendor's docs are unreachable, their published SDK is usually the better source
anyway** — it is executable, versioned, and cannot describe an endpoint it does not call.

### What PesaJet is, and the three ways it differs from the other two
| | |
|---|---|
| base | `https://payments.pesajet.com/api/v1` (`PESAJET_BASE_URL` overrides) |
| auth | `X-API-Key` |
| create | `POST /payments` — **both directions**, `type: 'COLLECTION' \| 'DISBURSEMENT'` |
| read | `GET /payments/{transactionId}` |
| status | `PENDING \| PROCESSING \| COMPLETED \| FAILED \| EXPIRED` |
| phone | E.164 with a `+`, which `cleanPhone()` already produces |
| provider | lowercase `mtn` \| `airtel`, and **optional** |
| webhook | HMAC-SHA256 hex in `x-webhook-signature` |

1. **One endpoint for both directions**, so there is no send-money path to mirror — only
   a `type`. Sending a payout as a COLLECTION would move money the wrong way and nothing
   downstream would notice, so it has its own mutation.
2. **No per-request callback URL.** MarzPay and LipaPay both take one in the body;
   PesaJet's is configured in their dashboard. `PUBLIC_URL` plays no part here, **the
   owner has to set it there**, and until he does, resolution rests entirely on the
   member's status poll and the reconciler — both of which already work, so a missing
   webhook is slow rather than broken. That is also why this gateway's reconciler loop
   matters more than the other two's, not less.
3. **Three terminal statuses, not two.** `EXPIRED` means the member never approved the
   prompt — the commonest real outcome on mobile money. It resolves as a failure
   (`FAILED_STATUSES` already contained `'expired'`) but gets **its own sentence**,
   because "you did not approve it in time" and "the payment failed" send a member to two
   different places. That sentence is in `LANG_ROWS`, so it translates.

`provider` being optional is load-bearing: PesaJet's own SDK **refuses to guess on 073**
(it spans both networks) and returns null. So the stored network wins, a prefix fallback
covers the rest, and when neither resolves the field is **omitted** rather than guessed —
a wrong operator is worse than none. Note PesaJet's list carries `39` and Chipz's
`UGANDA_MOBILE_PREFIXES` does not; deliberately **not** reconciled by widening Chipz's
list, because that list governs which numbers the platform accepts at all and quietly
admitting a prefix because a payment provider recognises it is a different decision.

### Every money-safety rule this codebase already had, applied
- **A webhook is a hint, never the authority.** Both callbacks verify the signature,
  **401 a forgery**, and then re-read `GET /payments/{transactionId}` — and the credit
  decision comes from that re-read. The id re-read is **the one we stored**, never one
  from the body; otherwise anyone reaching the URL could point it at somebody else's
  completed transaction. A `ping` is answered without touching money.
- **`providerDown` is a distinct outcome from a refusal.** A 5xx, a 408/429 or a dropped
  connection leaves a deposit **pending** for the reconciler and never fails it, and
  never reverts a payout from `'sending'` to `'pending'` — that would invite a retry that
  pays twice. Only a clean 4xx hands a row back.
- **Acceptance is not completion.** PesaJet answers `PENDING` and resolves
  asynchronously, so a payout lands on `'processing'`.
- **The outbound reference is written before the provider is ever called**, so a later
  write failure cannot leave a real payout unrecorded — the bug `marzReference` already
  documents once.
- **A `'sending'` row is ambiguous and stays a human's decision.** A success may be
  recognised from it; a failure may never be auto-declined and refunded from an
  automated path, and the payout sweep reads `'processing'` only.
- **Idempotency** is the row's own doc id, sent as `Idempotency-Key`, so a retry is
  de-duplicated by PesaJet rather than by a loop here.
- **Unique indexes** on `pesajetTxId` in both collections, each with
  `partialFilterExpression: {$type:'string'}` — without it every document *missing* the
  field collides on one null and manual deposits break outright.
- `/admin/withdraw/verify` learned the gateway, because the one answer that screen must
  never give wrongly is "nothing was sent" about a payout that went.

### A real bug the test found in the new code
`pesajetVerifyWebhook` returned `reason: 'mismatch'` only when the signature **lengths**
differed; a same-length forgery came back `reason: 'checked'`, which the routes treat as
"could not verify, carry on as a hint". No money could have moved wrongly — the re-read
still governs every credit — but a forged call would have been answered **200 instead of
401** and nothing would have flagged it. A signature that was present and did not verify
is now a mismatch whatever the reason.

### Tests
`test-pesajet.js` lifts the module and **runs it against a stub fetch**: the exact
endpoint, method, auth header and body the SDK documents; whole shillings not minor
units; DISBURSEMENT vs COLLECTION; `provider` omitted when unresolvable; all five statuses
including the two that mean "still in flight" and the rule that **an unrecognised status
resolves to nothing, never to success**; busy-vs-refused in three shapes; the status
re-read's retry; and six signature cases. Then it checks the wiring **inside each route
body** rather than file-wide, because the other two gateways carry the same lines and a
file-wide match passes with the re-read deleted.

`verify-pesajet-discriminates.py` — **35 real mutations plus a control, all caught.**

**Four of its own findings were harness faults, not code faults, and each is a lesson:**
1. **`fnSource` broke on destructured parameters.** The "first `{` after the name"
   extractor every other harness here uses closes at the end of `function f({ a, b })`'s
   signature and returns a truncated function. Half this module's functions take an
   options object. It steps over the parameter list now.
2. **A slice ended on a COMMENT banner that `strip()` had already removed**, so
   `indexOf` returned −1, the slice ran to the end of the file, and the ping assertion
   passed on the *other* gateway's copy of the same line. End markers must be code.
3. **`if (false && w.pesajetRef)` satisfied every assertion** about Verify — the field
   was still mentioned, the call still present in the dead branch. Pinned on the guard's
   exact live form instead.
4. **A slice started at the field name, but the status comparison sat earlier on the same
   line**, so widening the payout sweep to `'sending'` went unnoticed. Slice from the
   start of the query.

And one in the mutation harness itself: **`node --check` on `admin-src/index.html` always
fails**, so three admin mutations reported CAUGHT having measured nothing. The parse check
is scoped to `.js` now.

### Round 169b — the live dashboard corrected three things
Screenshots of the real merchant dashboard arrived after the first build, and each one
changed the implementation. **This is the value of seeing the console rather than only the
SDK**: none of the three was visible from the package.

1. **There is ONE "Webhook Destination URL" field.** Two per-direction callbacks
   (`/deposit/pesajet/callback`, `/withdraw/pesajet/callback`, mirroring MarzPay and
   LipaPay) **could not both be registered**, and the unregistered half would have failed
   *invisibly* — the reconciler quietly covers for a missing webhook, so nothing would
   ever have looked wrong. Collapsed into **one** `POST /pesajet/webhook` that dispatches
   on whether the event's `reference` names a `pendingDeposits.ref` or a `withdrawals`
   doc id.
2. **The signature is over the RAW REQUEST PAYLOAD** — the dashboard says so in as many
   words ("an HMAC-SHA256 digest of the raw request payload"). The SDK computes it over
   `JSON.stringify(payload minus signature)`, which is a *different byte string* whenever
   spacing or key order differ. The two sources disagree and only one is real, so
   **both are accepted**: the raw buffer is kept for that one path
   (`RAW_BODY_ROUTES` + a `verify` hook on its own parser, not on the shared one) and
   tried first. Not a weakening — both candidates are HMACs over data derived from the
   same request under the same secret, so forging either still needs the secret. What it
   buys is not 401-ing every live webhook until somebody reads the bytes off the wire.
3. **200 within 30 seconds** is required. The re-read is two attempts at a 30s timeout,
   so it can outlast that. The ack now goes out **first** and the work happens after, as
   `/deposit/callback` has always done for MarzPay. Safe only because every path below it
   is idempotent.

Also recorded: the dashboard issues **three** credentials, and the `sk_` "API secret" has
**no use in the SDK or in PesaJet's own cURL sample**. That is now open question 8 — do
not assume `pk_` alone is enough for a disbursement without asking.

**Two more harness faults, both mine, both the same shape as before:**
- The mutation *"the raw payload is never hashed"* came back MISSED, because the test's
  raw fixture happened to **re-serialise to identical bytes** — so the fallback satisfied
  it and the raw path was unobservable. Fixed with a fixture whose JSON carries **spaces**,
  which only the raw digest can match. That is also the real-world case, since PesaJet's
  formatting is theirs to choose.
- A tamper case mutated the raw buffer but **left the parsed body intact**, which verified
  (correctly) via the re-serialised candidate and looked like a hole that was not there.
  A real tamper changes both, because one is parsed from the other.
- And an anchor collided: `'/pesajet/webhook'` appears in `RAW_BODY_ROUTES` as well as
  `GUARD_EXEMPT`, so the guard mutation hit twice and aborted the run. *Check the anchor
  count, not just the result* — third time in this project.

`verify-pesajet-discriminates.py` is now **41 mutations, all caught**, control behaved.

### Round 169c — it works; making it fast
> "its working but call back speed is low, so try to make the system solid and faster
> validation on payments, and sometimes a prompt may come when the screen is just
> redirecting to payment page, so it is slow to redirect"

Two complaints, four causes, all of them measurable rather than a matter of feel.

**1. The redirect waited on a write the next screen does not need.**
`/deposit/marzpay` answers before calling the provider (it always has), but *before*
answering it also `await`ed the Records ledger row — a whole Atlas round trip standing
between the member's tap and the screen moving. The response now goes out straight after
the `pendingDeposits` write, which is the only one the payment screen reads; the ledger
row is written after. Safe because `creditDeposit()`'s find-or-create already covers a
missing row, which is why that write was never load-bearing here.

That is also why a prompt could beat the redirect: our own answer was slower than
PesaJet's.

**2. A status read carried the SDK's blanket 30-second timeout.** Right for creating a
payment, badly wrong for a read polled every couple of seconds — one slow read stalls the
whole poll behind it. Split into `PESAJET_TIMEOUT` (20s, creates, matching MarzPay and
LipaPay) and **`PESAJET_READ_TIMEOUT` (7s)**.

**3. And it retried inside the request.** `pesajetGetTx` took two attempts with a
backoff, so the worst case was ~60 seconds of a screen saying nothing. It takes an
`attempts` option now: **1 on the path a member is watching** — their next poll is the
retry — and 2 for the webhook and the reconciler, where nobody is waiting and a blip
really would mean another 30-second tick.

**4. The client slept a flat 3 s before its FIRST check.** For a member who approved the
prompt at once, that was the entire delay. First check at **1.2 s**, later ones every
**2.5 s** (PesaJet's own `pollUntilComplete` cadence), and the tick count raised to 24 so
the **giving-up budget stays ~59 s** — faster polling must not quietly mean abandoning a
payment sooner, and the test asserts that arithmetic rather than the interval alone.

**Also, from their REST example:** `idempotencyKey` appears as a **body field**, while
their SDK sends an `Idempotency-Key` **header**. Which one their API honours is stated
nowhere, and guessing wrong costs a **duplicate payment** on a retry — so both are sent.

Their current docs also show `phoneNumber` as a local `0742730383` where the earlier
example used `+256772…`, so PesaJet accept both. Chipz keeps sending E.164: unambiguous,
and it is what `cleanPhone()` already produces.

`verify-pesajet-discriminates.py` is now **48 mutations, all caught** — including one
that buys speed by shortening the give-up budget, which is the tempting wrong fix.

### Owner still has to
1. Set **`PESAJET_API_KEY`** (the `pk_…`) and **`PESAJET_WEBHOOK_SECRET`** (the
   `whsec_…`) in Render — never in this repo.  `PESAJET_BASE_URL` only if PesaJet give a
   sandbox host.
2. **Set the ONE webhook URL in PesaJet's dashboard** to
   `https://chipz-server.onrender.com/pesajet/webhook`, and use its *Test endpoint*
   button — a `ping` is answered 200 and touches no money, so it is a safe check.
3. **Rotate the API key.** The `pk_…` was shown in a screenshot; PesaJet call it "public"
   but it is the credential that authenticates every request, and the dashboard has a
   *Rotate API keys* button. Same standing rule as the Atlas password.
4. Pick it in **Admin → Settings → Manual payments**: PAY A's gateway, and/or
   "Always automatic (PesaJet sends payouts)".
5. Ask PesaJet the EIGHT open questions in `docs/pesajet-api.md` — in particular whether
   payouts need a pre-funded float, since **there is no balance endpoint in their SDK**,
   so the dashboard's "available balance" card has no PesaJet equivalent.
6. Decide which of PesaJet's `netAmount` / `totalCost` the 15% cash-out fee reconciles
   against once real figures exist. Chipz currently sends `wit.net` as the amount, so the
   member receives the net and PesaJet's fee is the platform's cost.

## Round 170 — "The balance of JetPay", when PesaJet publish no balance

> "l also want to see the balance of jetpay just like we were doing on marz"

**PesaJet have no balance endpoint, and one was not invented.** Both official SDKs —
`@pesajet/sdk` on npm and `pesajet` on PyPI, the latter checked with `pip download`
specifically for this — expose exactly three calls: create a payment, read a payment,
preview a fee. No float, wallet or balance call in either, and none in their REST
examples. MarzPay's card exists because MarzPay's SDK really does call `GET /balance`;
guessing a path against a money provider would be API surface made up out of nothing,
and the first time it 404'd in production it would read as "the gateway is down".

So the card answers the question a balance is actually asked for — *how much has gone in
and out through this gateway* — from **Chipz's own records**, which are exact for what we
sent and received. `GET /admin/pesajet/summary` scans `pendingDeposits` where
`provider == 'pesajet'` and `withdrawals` where `pesajetRef > ''`, and returns per
country: `collected`, `paidOut`, `net`, `pendingIn`, `pendingOut` with their counts.

**What it deliberately does NOT claim.** It cannot see PesaJet's fees, their settlements
to a bank, or anything moved outside Chipz. The panel says that in its own copy and the
**reply carries the same caveat in a `note` field**, so an operator reading the raw JSON
is not misled either. The word "balance" appears on the card exactly once, in the
sentence explaining why this is not one. The moment PesaJet give us a balance path this
becomes a real reading and the card keeps its place — that is open question 4 in
`docs/pesajet-api.md`.

### The rules it follows, each one a way the figure could lie
- **`depositFullyCredited(row)`, not `status === 'success'`.** Claim-before-credit can
  leave a row `matched` with the wallet write unfinished; counting that as collected
  overstates money received. It is the same test the rest of the file uses.
- **A payout counts `net`** — what the member actually received — and only once
  `processed`. A `processing` or `sending` row is its own figure, because the one thing
  this screen must never say wrongly is that a payout has landed.
- **Per country, never summed across currencies.** Round 159's lesson: adding UGX to KES
  produces a number that is wrong in both.
- **`truncated` is judged on the RAW reads, before the country filter.** A page cut short
  is still cut short whichever country is on screen. The ceiling is
  `PESAJET_SUMMARY_SCAN = 200000` — a high ceiling rather than none, for the reason
  `/admin/stats` records: this pulls whole collections into Node memory on a shared Atlas
  tier and the dashboard re-polls every 30 seconds.
- **The card ships `hidden`** and is revealed only when PesaJet is actually selected as a
  gateway or has history. An operator on MarzPay alone never meets a card of zeroes. A
  *failed* read still shows it when the gateway is in use, because silence would read as
  "nothing has gone through" rather than "we could not read it".

### Translated, like everything else in the panel
`admin-rows-7.py` carries 11 rows and 2 patterns. Two decisions worth keeping:
- **The description is two `<p>` elements, not one with a `<b>` in it.** The translator
  matches a WHOLE text node, so inline markup would have split it into fragments no row
  can ever apply to — and one 200-character sentence would be over the engine's own
  160-character cap. Split that way, both halves translate.
- **The pending lines are patterns**, so the count and the money are copied across
  untouched. A figure must never be rewritten by a translation.

The sweep confirms the card end to end: **0 findings in all five languages** (358 strings
accounted for per language, up from 348).

### The fixture that could not have found this, and the one that did
`find_admin_fixtures.py` had no `/admin/pesajet/summary` entry, so the card would have
rendered nothing and the sweep would have reported the whole thing clean **having never
seen it** — the same false green the Deposits and Withdrawals tabs produced last round.
The fixture now switches the gateway on, gives it history, and sets `truncated` and an
unset API key so both notes render too. Fifth instance of *a fixture that cannot reach a
state cannot test it*.

Two branches one fixture cannot reach alongside the rest (an empty summary, a failed
read) are covered from the other direction instead: `test-pesajet.js` requires every
English key in `admin-rows-7.py` to occur **verbatim in the panel**. A row whose key has
drifted from the string it is meant to match is silently no translation at all, and
nothing at runtime says so.

**That check was vacuous on its first run, and the reason is worth remembering:**
`build-admin-rows.py` writes every English key into `ADMIN_LANG_ROWS` **in the same
file**, so "the key appears in `admin-src`" was satisfied by the row rather than by the
card, and a key matching nothing on screen still passed. The table is cut out of the text
before looking now, and an assertion pins that the cut really happened.

### Tests
`test-pesajet.js` **runs the real route handler** against a stub database — a text match
cannot tell "collected" from "created", and getting that wrong overstates money received.
The fixture carries a credited deposit, a credited Kenyan one, one in flight, a failed
one, a `matched` one whose credit never finished, a processed payout, one still sending
and a rejected one, so every bucket is reached and each figure traces to exactly one row.
`PESAJET_SUMMARY_SCAN` is a named module constant precisely so the test can shrink it to
2 and actually reach the truncated case, then check it stays true when the view is
narrowed to a country holding fewer rows than the cap.

`verify-pesajet-discriminates.py` is now **63 mutations, all caught** (the deliberate
no-op control correctly reported MISSED). The 13 new ones: a made-up `/balance` call, an
uncredited deposit counted as collected, an in-flight recharge counted as collected, a
payout still sending counted as paid, the gross counted instead of the net, every country
folded into one bucket, the country switch ignored, net the wrong way round, a cut-short
page reported as complete, `selected` pinned true, the reply's caveat removed, the card
presenting itself as PesaJet's own float, the card shipped visible, and a label drifting
from the row that translates it.

**One anchor aborted the run on its first attempt**: `const want = adminRegionFilter(req);`
occurs **eleven** times in `server.js`. Anchored with the line after it. *Check the anchor
count, not just the result* — fourth time in this project.

**And one assertion had to be re-aimed for the same old reason.** "The card ships hidden"
first matched `/hidden/` in the 200 characters before the div — where the comment
explaining that the card is hidden lives — so deleting the class would have passed. It
matches the exact `<div class="panel-card hidden" id="pesajetCard">` now. Sixth instance
of *a check defeated by the text of a comment*.

### Owner still has to
Nothing new. This card needs no configuration — it appears on the Dashboard as soon as
PesaJet is picked in Settings, or as soon as anything has gone through it.

## Round 171 — Reading PesaJet's real docs, and the two bugs it found

The owner pasted `pay.pesajet.com/docs` (the host is refused by this environment's egress
proxy, so it had never been read — Round 169 worked from the published SDK instead). It
answered six of the eight open questions **and exposed two defects in shipped money code**,
one of which could tell a member their recharge failed while the prompt was ringing on
their phone.

**The SDK was a good source and not a sufficient one.** It is executable and pins field
names, which is why it was the right call at the time; but it cannot describe an HTTP
status it never returns, a retry schedule, or a dashboard control. Where the two disagree,
the docs win — and they disagreed twice.

### Bug 1 — the error body is NESTED, and a member was shown `[object Object]`
The SDK's error type is flat. The docs' is not:

```json
{ "error": { "code": "…", "message": "…", "details": {…}, "timestamp": "…", "requestId": "…" } }
```

`pesajetUserMsg()` read `r.data.message || r.data.error`. Against the documented shape
`message` is undefined and `error` is an **object** — truthy, so it was returned as the
member-facing sentence. Somebody whose recharge had just failed would read
`[object Object]`, which is worse than the generic message it replaced.

`_pesajetRequest()` flattens both shapes into one now, and `pesajetUserMsg()` will only
ever return a **string** — it picks the first candidate that actually is one. `requestId`
is logged on every non-2xx, because their own error table says to quote it to support.

### Bug 2 — a 409 was treated as a refusal. It is the opposite.
Their error table's instruction for a conflict is **"reuse the original response for an
idempotency conflict"**: the transaction ALREADY EXISTS. `_pesajetRequest()` classified
only 5xx/408/429 as "busy", so a 409 fell through as a clean refusal — which fails the
deposit and tells the member it did not work, while PesaJet may have a live prompt on
their phone. On the payout side it would hand a withdrawal back for a retry that pays
twice.

`pesajetCreate()` now recovers the existing transaction by reference on a 409. If it
cannot be found, the result is downgraded to **`providerDown`** — in flight, never
refused — so the deposit stays pending for the reconciler and no payout is handed back.
That is the posture the 5xx path already had; the 409 simply never reached it.

### The hole this let me close: a deposit with no transaction id
Not a new bug, but the first time it was fixable. If a create call is **accepted by
PesaJet and its response is lost** (a timeout at our end), the row has no `pesajetTxId` —
and every resolver here reads by that id. The reconciler even excluded such rows
explicitly, and my own comment said so: *"a row whose create call never returned a
transaction id can never be checked."* The member's money can leave their phone and
nothing in this platform would ever credit it.

The docs list a fourth endpoint the SDK does not expose: **`GET /payments`**, paginated,
with `page` / `limit` / `status` / `provider` / `startDate` / `endDate`.
`pesajetFindByReference()` uses **only those six** — there is no `reference` filter among
them, so the window is narrowed with `startDate` and our own reference is matched here.
Inventing a seventh parameter would be the same mistake as inventing a balance path.

A second reconciler sweep now uses it, and every rule in it exists to avoid failing a
real payment:
- **Newest first**, unlike every other sweep here. A row is only recoverable while it is
  still inside the window a lookup can page, so old ones age out rather than starving the
  young ones — the same starvation the `pesajetTxId > ''` exclusion avoids.
- **Younger than 10 minutes is left alone**: the member's own status poll owns it.
- **A deposit is failed ONLY on a window scanned right to its end** (a short page — the
  one thing that proves there was nothing more to see). A blip, a short read or an
  unreadable envelope leaves the row pending, which is the outcome that cannot cost
  anybody money.
- **The list envelope is not documented, only its parameters are.** Four plausible shapes
  are accepted and anything else is reported as **unreadable** rather than as "no rows" —
  because "no rows" is the finding that licenses failing a deposit, and an unrecognised
  shape must never become evidence that a payment does not exist.

### What else the docs settled
- **The signing question is closed, in our favour.** *"Take the raw body (or remove the
  `signature` key from the parsed JSON)"* — both candidates, which is exactly what
  `pesajetVerifyWebhook` already tries. Round 169's "two sources disagree, accept either"
  turns out to be their own documented position.
- **Webhooks retry at 1 min / 5 min / 15 min / 1 hour / every 4 hours up to 24 hours**,
  and carry an `X-Webhook-Id` per delivery attempt. So redelivery is routine, not an edge
  case; the handler is idempotent at every step and credits only from an independent
  re-read, which is what makes that harmless.
- **There is no sandbox host.** Sandbox runs against the real carriers, restricted to the
  phone number on the merchant profile, and **one successful sandbox transaction to that
  SIM is a prerequisite for submitting KYC**.
- **Disbursements can be restricted by client IP** (collections and reads are not). That
  is a live outage risk on Render, whose outbound addresses are not guaranteed stable —
  leave enforcement OFF unless those IPs are pinned and entered first.
- **Minimum amount is 1.** No maximum documented.
- **No balance endpoint, confirmed by the complete endpoint reference** — four endpoints,
  none of them a balance, while the docs do say "your merchant balance sends funds". So a
  float exists and cannot be read. Round 170's card was the right call and stands.

Still unanswered: the maximum per transaction, whether payouts draw on a pre-funded
float, what the `sk_` secret is for, the list endpoint's response envelope, and whether
`reference` must be unique.

### Tests
`test-pesajet.js` gained a section that RUNS the real functions against both error shapes,
a 409 that resolves and a 409 that does not, and four list-endpoint outcomes (found, a
short page, an unreadable envelope, a gateway blip) — plus checks inside the reconciler
sweep, since the other two gateways carry similar-looking lines.
`verify-pesajet-discriminates.py` is now **72 mutations, all caught**, control behaved.

**One of the new mutations was MISSED, and deleting it was the right answer.** "An error
object reaches the member as `[object Object]`" reverted `pesajetUserMsg()`'s string guard
— and that is harmless, because `_pesajetRequest()` flattens the nested body *before*
`pesajetUserMsg()` ever sees it, so by then `d.error` can only be a string or absent. The
property itself IS defended, by the mutation that removes the flattening (caught). The
guard stays as belt-and-braces against a future change to the flattener, but no honest
assertion can fail on it today. This file's own rule applies: *a mutation that cannot fail
for the right reason should be deleted, not propped up.*

**One anchor matched nothing and aborted the run**, which is the only reason it was
noticed rather than silently skipped: `pesajetCreate` now awaits its reply so it can
handle a 409, so the old `return _pesajetRequest(...)` line no longer exists. The
standing lesson holds — *re-check every anchor after changing the code it points at, and
judge a mutation by the exit code.*

### Owner still has to
1. **Rotate the API key.** `pk_…` has now appeared twice in chat. Dashboard →
   *Rotate API keys*.
2. **Do the sandbox test from the registered number (0742730383, MTN)** — it is a
   prerequisite for submitting KYC, and it exercises the whole path end to end.
3. **Leave the disbursement IP allowlist OFF** until Render's outbound addresses are
   known and entered, or payouts will fail with everything else looking healthy.
4. The three outstanding questions above, in particular what `sk_` is for.
