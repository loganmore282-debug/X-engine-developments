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
- Product catalog is still placeholder ("Product-1".."Product-10") — the owner has
  not supplied real names/prices/images.
- **Payment providers not connected.** Everything else is live end to end (EdgeOne
  frontend -> Render backend -> Atlas `chipz` database), but no real deposit or
  withdrawal can complete until MarzPay/LipaPay keys are set in Render's env vars.

A note on how the Firebase config got missed the first time: the owner supplied it
mid-session with "now stamp in this config in admin and userpanel and start building",
and the mechanical `snow/` -> `chipz/` file copy silently carried Snow's config
forward over it. When the owner hands over config values, stamp them in immediately
and grep for the OLD values afterwards to prove nothing survived.

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

### Home banner: image or video

`banners/home` holds `{ image, video }`. The video is a **URL, never an uploaded blob**
— a base64 video would live inside one Mongo document, be re-sent in full on every cold
boot with no HTTP caching, and inflate ~33% on the wire; unaffordable on Ugandan mobile
data for a decorative banner. The owner drops `banner.mp4` into the EdgeOne upload beside
`index.html` and types the file name, or pastes an `https://` link.
`sanitizeBannerVideoUrl()` accepts relative paths and `https://` only — plain `http://`
is rejected (mixed content would be silently blocked), as are other schemes, `..`
traversal and a leading `//` (protocol-relative to another host).
The image doubles as the video's poster. `/admin/banner/set` patches only the keys sent,
so saving one never wipes the other; `/admin/banner/clear?what=video` drops just the
video. The player is muted+loop+playsinline so mobile autoplays it, with the mockup's
play ring shown whenever it is paused or autoplay was refused, and a fallback to the
striped hero if the URL fails to load. `test-banner-video-url.js` covers the validator;
the Playwright banner test drives a real MediaRecorder-generated webm.

### Run this before every push
```
node build-core.js && node build-admin.js && python3 smoke-test.py
node test-product-config.js && node test-cors-origins.js && node test-banner-video-url.js && node test-referral-required.js
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
