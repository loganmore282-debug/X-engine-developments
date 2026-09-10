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
