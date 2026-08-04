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
const CACHE = 'chocomcc-shell-v23';
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
