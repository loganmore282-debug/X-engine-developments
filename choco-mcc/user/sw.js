// v2: FIXED A SEV-1 BUG — one member's account data was being served to the
// NEXT member who signed in on the same browser/device ("I signed out,
// signed up, and saw the old account's records"). Root cause: the fetch
// handler below applied cache-first to EVERY request, with no origin check.
// A service worker intercepts ALL fetches made by pages it controls,
// including cross-origin ones — so every API call the app makes to the
// Render backend (GET /account, /deposits, /withdrawals, /transactions,
// etc.) was ALSO being cache-matched and cache-stored here. The Cache API
// keys purely on request URL + method; it does NOT key on the Authorization
// header. Every one of those endpoints identifies the user ONLY via that
// header (the URL is always exactly "/account", "/deposits", ...), so once
// any member's response was cached under that URL, literally any other
// member who later hit the same endpoint on the same device got served that
// FIRST member's cached data — a real, reproducible cross-account data leak,
// not a database or Firebase problem. The bump to v2 also forces every
// already-affected device to drop its poisoned v1 cache on next load.
// v3: new app icon shipped (icon-192/512 + maskable variants) — bumped so
// every device (including ones already on v2) re-fetches the precached
// SHELL list below instead of keeping the old icon cached indefinitely.
// v4: deposit screen procedure box + curved home banner + clear
// success state on the deposit-status screen — bumped so devices pull
// the fresh index.html instead of the cached shell.
// v5: moved the deposit-procedure box below the Add Funds form (was
// above it, pushing the payment fields down).
// v6: referral codes are now a plain 6-character alphanumeric string (no
// "CHM" prefix) — updated the two cosmetic client-side placeholders that
// referenced the old format.
// v7: Task Center — referral milestone rewards (active-L1-count ladder +
// level-1-team-deposits ladder) added to the Team screen.
// v8: Task Center moved to its own dedicated screen (a "Task Center ›" link
// on the Team screen opens it) — bigger cards, no progress bars, plain
// current/target counts (0/5, 1/5, …), claim button below each card.
// v9: app-wide loading spinner replaces plain "Loading…" text; withdraw
// screen shows the (admin-editable) daily cash-out cap.
// v10: admin-uploaded banner overrides now merge over the app's own
// baked-in CHOCO_BANNERS images (GET /public/banners) — no visible change
// until an admin actually uploads one.
// v11: Task Center now shows the loading spinner immediately on open
// (was a silent blank screen while /team/stats loaded), and the Claim
// button shows a "Claiming…" busy state instead of appearing unresponsive.
// v14: deposit failure reason, real MTN/Airtel network cards + checkmark,
// wallet/upload-tray action icons, announcement dialog restructure, phone
// input accepts 07xxxxxxxx or 7xxxxxxxx, Team screen levels are tappable,
// referral links (?reg=CODE) now actually prefill the invite code.
// v15: announcement dialog's close X now floats below the card; OK button
// replaced with Telegram Channel/Group pill buttons (from Settings ->
// Support contacts); the dialog re-shows every app open and every time
// Home is switched into from Shop/Rewards/Team/Me (not Home -> Home).
// v16: tapping Cash Out without ever having invested now shows an upfront
// toast and never opens the withdrawal form (server still enforces this
// independently). Referral L1/L2/L3 commission now pays out only once per
// referred member, on their first-ever investment — later purchases by the
// same member no longer pay it again (they still count for Task Center's
// active-referral and deposit-total milestones).
// v17: every overlay screen's header (.ov-top) now has a thin separator line
// under it, cleanly dividing the back-arrow/title bar from the content below
// on every single screen that opens.
// v18: Task Center milestone cards redesigned — each now leads with a type
// icon (people for referral-count milestones, wallet for deposit-target
// milestones) + label, and a slim progress bar under the description. Same
// Current/Target/Progress numbers and Claim/In Progress/Received button as
// before, just a fresher look.
// v19: overlay header separator line thickened (2px, higher-contrast) so it
// reads clearly instead of nearly disappearing against the cream background.
// v20: Cash Out no longer blocks at the tap-to-open stage — the withdrawal
// form always opens. The invest-first check now runs (as it always has,
// server-side, unbypassable) only when "Request Cash Out" is actually
// submitted, surfacing the real server message in the form itself.
// v21: removed the "amount must be a multiple of UGX 5,000" restriction on
// withdrawals entirely (any amount at or above the minimum is now
// accepted). Fixed the withdrawal screen's fee/minimum text and the Team
// screen's L1/L2/L3 commission tiles, which were hardcoded literal strings
// that never reflected admin-changed settings — both now read live from
// getSettings() every time their screen renders.
// v22: renamed several Account menu tiles for clarity — Records->History,
// Referrals & Team->My Team, Bind Bank Card->Payout Account, Change
// Password->Security, About ChocoMCC->About Us, Rules & Regulation->Terms
// & Rules, Customer Care->Support, Log out->Sign Out. Matching screen
// titles updated too so opening a renamed tile shows the same new name.
// v23: auth screen redesigned — Sign In/Sign Up is now a real segmented tab
// control instead of a plain text link, and all fields are grouped into one
// card with row dividers instead of separate floating boxes. Same content
// (titles, placeholders, button label) in both modes, same architecture for
// both — login and register share the identical card/tab/button styling,
// just with 2 vs 4 rows showing.
// v24: reverted the v23 two-tab (Sign In | Sign Up both visible at once)
// switcher — back to a single contextual switch action showing only
// whichever mode ISN'T currently active, per feedback that both options
// shouldn't appear together. Kept the unified field card and pill button
// from v23; the switch is now one static dashed-border button whose text
// updates in place instead of two side-by-side tabs.
// v25: password field icons switched from a padlock to a key, everywhere
// one appears — auth screen (password + confirm password), the Security
// menu tile, and all three fields on the Security (change password)
// screen.
// v26: "Please wait…" busy states added where actions previously gave no
// feedback while a request was in flight — Task Center Claim (was
// "Claiming…", now matches the same wording everywhere else), Daily
// Check-in, and Bind Bank Card's Save account button (had NO busy state
// at all before). All three now disable the button and show "Please
// wait…" until the server responds, then restore the normal label.
// v27: fixed a real bug — a product flagged "Coming soon"/sold-out in
// admin still rendered as a fully live, tappable tile everywhere in the
// app (Home, Shop, product detail) because the client never read the
// comingSoon/active flag at all, even though the server already blocked
// the purchase itself. Sold-out products now show a "Sold out" badge on
// their Shop tile, are dimmed, are dropped from Home's featured strip
// entirely, and their detail page shows a disabled "Sold out" button
// instead of "Buy this chocolate". Server-side: maintenance mode never
// covered Task Center claims (/team/*) — money could still move during a
// declared maintenance window — now fixed; and a banned account could
// still rebind its payout (bank) account — now blocked too.
// v28: found by going back over deposits/withdrawals/history a second
// time. Two real gaps, both maintenance-mode related: (1) registration
// during maintenance mode used to lie — /account/create-profile and
// /register both fail (blocked, by design), but the app ignored that and
// showed "Account created — welcome!" anyway, leaving a real Firebase
// login with NO server-side profile behind it, permanently ("User not
// found" even after maintenance lifted). Now a failure here is shown
// honestly and the user is told to try again shortly, not waved through.
// (2) refreshFromServer() showed a generic "Could not reach the server"
// toast when maintenance mode was actually the reason /account failed —
// misleading, since the server IS reachable, it's deliberately paused.
// Now shows the admin's real maintenance message in that case.
// v29: About Us rewritten as a long-form newspaper-style feature — real
// chocolate-brand photos (Mars, Snickers, KitKat Chunky, Cadbury Dairy
// Milk, Ferrero Rocher) in sharp-cornered "box card" tiles (no curved
// frames), covering the brands' real heritage/locations, how ChocoMCC's
// own product tiers are named in their honour, and the platform's
// mission — plus a trademark/non-affiliation credit line at the bottom.
// v30: removed every em-dash ("—") from user-visible text app-wide (toasts,
// button labels, empty-state messages, the About Us article, transaction
// descriptions) — replaced with plain commas/periods/colons per plain
// sentence instead. Code comments were left alone since they're never
// shown to anyone using the app. Same sweep also applied to admin.html.
// v31: About Us article no longer name-checks Kampala, Gulu, Mbale, or
// Uganda specifically — those city/country call-outs are removed from
// the copy (the "boda stage" line too); the rest of the article is
// unchanged.
// v32: Support screen fixed a real bug — it collapsed Telegram Channel,
// Telegram Group, and the direct-contact Telegram field into ONE row
// (whichever was set first), so configuring more than one meant the
// others silently never showed. Now each configured destination gets its
// own row. WhatsApp support removed entirely (button, admin Settings
// field, and the settings field itself) — Telegram-only going forward.
// Every Telegram link app-wide (Support screen + announcement dialog)
// now uses the real Telegram brand mark (blue disc + paper-plane) instead
// of a generic themed outline icon.
// v33: Shop screen's sold-out/coming-soon products fixed per feedback --
// "Sold out" corner badge replaced with a "Coming Soon" banner spanning
// the full width of the product image (not a small aside pill), and the
// whole card is now a real disabled button with no onclick at all, so
// tapping it does nothing instead of opening a product page. Server-side
// purchase blocking (already in place) re-verified unchanged.
// v34: two real bugs fixed. (1) An admin manually crediting a member's
// wallet (e.g. compensating a declined MarzPay payment) was recorded
// server-side but never shown ANYWHERE in the app's own History — not in
// Accrued, not in Topups (which only ever reads real deposit records).
// The balance would visibly jump with zero explanation. Now shows as
// "Account credit" under History -> Accrued. (2) balance/History never
// refreshed while the app just sat open — only after the member's OWN
// action (buy/deposit/checkin). An admin credit is out-of-band, so it
// could sit unseen until the member backed out and reopened the app.
// Added a self-scheduling 10s background refresh (paused while the tab
// is backgrounded, catches up instantly on foreground) so balance and
// History update on their own without needing a manual trigger.
// v35: My Chocolates redesigned per feedback -- each holding was only
// showing "Day X of Y" and price, nothing about what it was actually
// earning. Now shows purchase date & time, a day-progress bar (X/Y days),
// daily income, accrued income so far, and total income at maturity --
// every figure read straight from the server's own investment record
// (dailyPayout/expectedReturn/paidOut/payoutsMade, already settled
// server-side on every read), never recomputed client-side, so nothing
// here can drift from what the server actually owes.
// v36: My Chocolates tweak per feedback -- removed the visual progress bar
// (wasn't asked for), purchase date & time now include seconds. The day
// counter (X / Y days) and the purchase timestamp shown next to it always
// come from the exact same /investments record in the exact same response
// (server computes payoutsMade as floor(real elapsed ms since that same
// createdAt / one day), freshly on every read), so the two can never show
// out-of-sync values.
const CACHE = 'chocomcc-shell-v36';
const SHELL = ['/', '/index.html', '/manifest.json', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first for navigations (always try to get the freshest app shell),
// falling back to cache when offline. Cache-first for the static shell
// assets ONLY. Anything cross-origin (every API call to the backend) goes
// straight to the network, every time, with NO caching whatsoever — those
// responses are per-user and must never be shared between sessions/devices.
self.addEventListener('fetch', e => {
  const reqUrl = new URL(e.request.url);
  if (reqUrl.origin !== self.location.origin) {
    e.respondWith(fetch(e.request));
    return;
  }
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match('/index.html')));
    return;
  }
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(resp => {
      const copy = resp.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
      return resp;
    }).catch(() => cached))
  );
});
