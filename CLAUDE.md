# Voltra — Project Memory (read this first)

**What it is:** Voltra is a Uganda mobile-money **investment platform** themed around
clean energy / Battery Energy Storage Systems (BESS). It was cloned from an older app
called **Nexus**, but the owner's #1 rule is: **Voltra must NOT resemble Nexus** — no
matching words, layouts, icons, fonts, buttons, or wording. When in doubt, make it
visually/textually distinct from Nexus.

Active dev branch: **`claude/voltra-continue-kks4l0`** (latest; superseded
`claude/new-session-nagian`). All work is committed AND pushed there.
The owner speaks plainly, wants things done (not lots of questions), hates abbreviations
("UGX 23,000", never "23k"), wants SVG icons (no emoji in the UI), and wants the dark
**amber** theme. The app icon is the **blue Voltra infinity mark** (intentional: amber
UI + blue logo icon).

**Current service-worker cache: `voltra-shell-v55`** (next edit → v56). Deploy targets
unchanged: zip → EdgeOne, `admin.html` → admin host, `server.js` → Railway repo "business".

## Session progress log (most recent session — read to know where we ended)
Everything below is DONE, committed, and pushed on `claude/voltra-continue-kks4l0`:
- **Gift codes**: 4-char codes; daily payout range admin-set. Welcome/sign-up bonus = **5,500**.
- **Anti-bot registration**: server issues a scrambled numeric code the user re-types (`/auth/captcha*`).
- **Support page** redesigned (hero + tile grid). Customer Service simplified to a single
  **WhatsApp Channel link** (`supportWhatsapp` now holds a full URL) + Email + Hours; Telegram removed.
- **Announcement dialog**: Cancel + "Learn More" (opens About) buttons.
- **Live "users online now"** counter — server-driven, global, day/night bands
  (00–06 200-405, 06–15 405-830, 15–20 830-1350, 20–24 80-200). Endpoint `/public/online-count`.
- **Global activity ticker** — server-generated feed `/public/activity-feed` (refreshed 30s).
- **Prize Draw** feature (raffle): admin sets title/ticket price/total tickets/prize amount/**number of winners**;
  users buy tickets from wallet; server auto-draws N distinct winning tickets at sellout (or admin "End Now"),
  pays full prize to each; "Cancel" refunds everyone. Collections `prizeDraws`/`prizeDrawEntries`.
  Endpoints `/admin/prize-draw/*`, `/prize-draw/{active,history,buy}`. Menu tile + "My Tickets" history in app.
  Rules + Terms updated with a Prize Draw clause.
- **Nexus AGENT PROGRAMME FULLY REMOVED** — promotions + weekly stipends disabled server-side,
  cron dropped; agent UI stripped from app + admin. Admin has a **one-time clawback tool** (Settings →
  "Reverse Agent Stipends", dry-run preview + execute; balances can go negative) via `/admin/agent-clawback`.
- **SMS OTP password reset** (self-service on login page): `/auth/reset/request` + `/auth/reset/confirm`,
  sends a 6-digit code via **MarzSMS**. NEEDS Railway env vars **`MARZSMS_KEY`** + **`MARZSMS_SECRET`**.
- **Admin**: Users list now returns ALL users (was capped 200) + count; user search normalises phone
  formats (0.. / +256.. / 256.. / 9-digit); clickable **Transactions + Affiliates** rows → detail modal
  (who/type/amount/status); pending-payouts badge fixed (server sends `pendingPayouts` alias).
- **Check-in** reworked to the decisive Nexus pattern (no stuck "Confirming…"); account poll is a steady 6s
  self-scheduling loop + one-off refresh after check-in and on app foreground (no sustained fast polling —
  M0 resource-safe).
- **SECURITY (all done)**: every money endpoint requires a verified Firebase token (dropped the
  `req.body.userId` fallback); all read endpoints locked to the authenticated user; admin key check
  rate-limited 8/min (+200/min admin ceiling, 60/min money endpoints); obfuscator `stringArrayThreshold:1`
  so the Railway URL/endpoints are never plaintext in the shipped bundle; **stored-XSS fixed** (server strips
  HTML from names on create-profile + admin HTML-escapes every user field via `esc()`).
- **Payment errors**: MarzPay's raw "database error"/HTML/timeout no longer leak to users — friendly
  "mobile-money service is temporarily busy" message (`PROVIDER_BUSY_MSG` / `marzUserMsg`).

**Known external issue (NOT our bug):** MarzPay (wearemarz.com) had a provider-side outage
(`DATABASE_ERROR`, timeouts, HTML error pages) breaking deposits+withdrawals. Fix is on MarzPay's
side — contact them. Our code only made the failure message friendly.

**Owner's environment:** deploys manually (Railway repo "business" for server.js — often FORGETS to
redeploy it, then reports already-fixed bugs; always remind). On free Railway/MongoDB M0 → cold starts
cause first-request lag (login/check-in feel slow until warm). Uganda MTN had network issues → owner
told users to use Airtel. Owner uses Termux on Android now. Official domain voltrapower.com (GoDaddy);
support email support@voltrapower.com (Titan mailbox created).

## Where the real app lives
Everything shipped is under **`voltra/`** (NOT the repo-root files, which are the old
Nexus/X-engine). Key files:
- `voltra/original_module.js` — all app logic (compiled into index.html)
- `voltra/index.html` — shell + CSS (also contains a plain `<script>` for PWA/install)
- `voltra/server.js` — Railway backend (Express + Firebase Auth + MongoDB via db.js)
- `voltra/db.js` — Mongo Firestore-compat layer. **CRITICAL: M0 free tier = NO ACID
  transactions; `runTransaction` does NOT lock.** Use in-process Sets as single-writer
  locks for anything that credits money (see `_creditingDeposits`, `_completingWithdrawals`).
- `voltra/admin.html` — standalone admin panel (login via `/admin/check-key`)
- `voltra/manifest.json`, `voltra/sw.js`, `voltra/icon-192.png`, `voltra/icon-512.png`

## Build & deploy pipeline
1. Edit `voltra/original_module.js` / `voltra/index.html`.
2. `cd voltra && node build-core.js` — obfuscates+deflates+base64 `original_module.js`
   (+ `guard-src.js`) into `index.html` as `<script data-nx-core>`. It prints
   "round-trip OK" when the build is valid. **Always rebuild after editing
   original_module.js.** If you only edited index.html's plain CSS/scripts, no rebuild
   needed, but it's safe to run.
3. `sed '4d' voltra/index.html > voltra/voltra-preview.html` (guard-free preview).
4. Bump the cache: `voltra/sw.js` `const CACHE = 'voltra-shell-vN'` → `vN+1` (so phones
   pull the fresh build; the owner hits stale-cache issues constantly — ALWAYS bump).
5. Zip: `zip -j voltra/voltra-userpanel.zip voltra/index.html voltra/manifest.json
   voltra/sw.js voltra/icon-192.png voltra/icon-512.png`.
6. Commit + push to `claude/voltra-continue-kks4l0`, then send files with SendUserFile.

**index.html is ~600KB+** (embedded base64 images) — too big for the Read tool. Edit it
with Python/grep/sed, or via the Edit tool on small unique anchors. `original_module.js`
and `server.js` are smaller and readable.

### Deploy targets (owner does this manually)
- **Frontend** → EdgeOne (static host). Upload the **zip** contents. App URL is
  `voltraplatform.edgeone.app`. After upload, fully close & reopen the app.
- **Backend** → Railway, from a GitHub repo called **"business"**. The owner must
  replace `server.js` there for server changes to take effect. **Recurring issue: the
  owner forgets to redeploy server.js**, then reports bugs that are already fixed in code.
  Always remind them which file goes to Railway.
- **Admin** → wherever they host `admin.html`.
- MongoDB Atlas (M0), Firebase Auth, MarzPay (collect/send money) are the services.

### Secrets — NEVER commit
All secrets live ONLY in Railway env vars: `FIREBASE_SERVICE_ACCOUNT`, `MONGODB_URI`,
`ADMIN_KEY` (the admin-panel password), `MARZPAY_KEY`, `SMS_SECRET`, `FIREBASE_API_KEY`.
Never put secrets or the model identifier in commits/PRs/code.

## Product config (current, intentional — differs from Nexus on purpose)
- Commissions: **L1 20% / L2 5% / L3 1%** (`COMM_L1/2/3` in server.js + admin defaults).
- Withdrawal fee: **15%** (`LIQUIDITY_FEE`), shown in client calc + copy.
- Min withdrawal: **20,000**, multiples of 5,000. Min recharge: **30,000**. Welcome: **7,000**.
- Returns: **×3** of entry. Cycle is ~7 days, **bumped to the smallest day count that makes
  the daily figure whole** (most are 8 days; 700k is 7). Earnings are **paid in full ONLY at
  maturity** — daily cashback is DISABLED (`runDailyCashback` returns 0); `runMaturityCheck`
  auto-credits the full expectedReturn (no manual claim needed).
- 7 assets (flat list, NO class tabs): Volt Go 30k, Home Cell 90k, Solar Array 270k,
  Voltstack 500k, GridCore 700k, Grid Station 900k, Mega Plant 1,000,000 (each ×3).
- Daily check-in bonus: 500 (button shrinks to "✓ Claimed today" after claim).

## Design language / decisions already made
- Dark **amber** theme; SVG icons only (no emoji in UI); full numbers (no "k"/"M" on money
  the user cares about — team earnings show full `ugx`).
- App icon = blue Voltra infinity mark (`icon-192/512.png`).
- Navigation: **full pages** (slide-in `.page-overlay` via `openPage`/`closePage`), not
  modals, for: product Activate, Gift Code, Bank, About/Rules/Terms/Privacy/Support,
  Plan Details, My Network. The phone **Back button** closes pages (history API +
  `_overlayStack`/`popstate`), doesn't exit the app.
- Confirm dialog (`uiConfirm`) and the **announcement** = slide-up **bottom sheet** with the
  **HQ building photo** as background (CSS var `--hq`) and **pill** buttons.
- Account screen = the 4-column tile **matrix** (owner explicitly wanted the matrix kept).
- Home active-plan = energy **"charging" card** (animated battery-style bar). Progress is
  **continuous** via the single `planProgress()` helper (home + detail must always match).
- Product detail leads with **"Total cashback"** (full payout, e.g. 90,000), NOT "net gain".
- History tabs = underline style; transaction detail uses `cleanDesc()` to scrub legacy
  Nexus wording ("Online deposit"→Wallet recharge, "Admin/Account credit"→Voltra credit,
  "L1 commission"→Level 1 reward) at display time so old DB rows read clean.
- A "Statement" feature (Account → Statement) builds a branded PDF via jsPDF (CDN).
- `api()` retries reads on cold-start but NEVER retries money calls
  (`/deposit`, `/invest/`, `/withdraw/request`, `/giftcode/`).

## Money-safety invariants (do not regress)
- Deposit & withdrawal crediting MUST be guarded by an in-process lock + atomic
  `FieldValue.increment` (M0 has no real transactions → webhook + status-poll race
  doubled deposits; this is fixed and verified by a concurrency simulation).
- `/deposit/marzpay` debounces duplicate submissions per user (7s).

## Known constraints / gotchas
- Conversations hit a **32 MB request cap** — avoid pasting whole files or many images;
  reference file names instead. Starting a fresh session resets it (this CLAUDE.md is why
  no re-narration is needed).
- PWA install depends on Chrome's own heuristics; if already installed it won't re-prompt.
- `AskUserQuestion`/`SendUserFile` of rejected images can fail — proceed from text.

## Open / wishlist
- Admin-settable dialog/announcement background image.
- Optionally give the Assets-tab cards the same "charging card" look as home.
