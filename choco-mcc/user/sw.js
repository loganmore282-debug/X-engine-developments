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
// v37: fixed real slowness -- returning-user auto sign-in (silent Firebase
// session restore) used to block the whole screen behind a full network
// round-trip (/account + /investments + /bank + /transactions + public
// settings) before showing anything, which is what made it feel like a
// ~3s wait. It now enters the app immediately using this device's own
// last-saved snapshot for that uid (localStorage, written by the previous
// session's own refreshFromServer()), then refreshes from the server in
// the background and re-renders the instant real numbers arrive -- so a
// returning sign-in now paints instantly instead of waiting on the network,
// same "fast paint, safe background reconciliation" pattern already used
// for deposits. A first-ever sign-in (nothing cached yet) is unaffected --
// there's nothing to show early, so it still waits on the real fetch.
// v38: found the remaining chunk of sign-in latency the v37 fix didn't
// touch -- index.html imports the Firebase Auth SDK live from gstatic.com
// on every single app open (that's what Firebase's own sign-in check runs
// on top of), and the service worker was explicitly routing ALL
// cross-origin requests straight to the network with no caching at all.
// So even after v37 made the app's OWN data instant from cache, sign-in
// itself still couldn't start until ~150KB+ of Firebase SDK JS finished
// downloading fresh, every time. Added one narrow, safe exception: those
// specific gstatic.com/firebasejs/... SDK files (public static library
// code, no per-user data, version-pinned in the URL) are now cache-first,
// so the second app open onward skips that network fetch entirely. Kept
// in its OWN cache bucket (VENDOR_CACHE, below), separate from the
// versioned shell cache -- these files don't change when the app's own
// code does, so a normal shell version bump (which happens on most
// deploys) must not wipe them and pay that network cost again right after
// every single update.
// v39: fixed a real, reproducible bug (caught on two screenshots taken a
// minute apart showing the same Shop screen two different ways) -- the
// products list has NO persistence of its own (unlike account state and
// admin settings, which are both cached in localStorage): every single
// page load starts from a hardcoded fallback array with no active/
// comingSoon information at all, and only gets the real, admin-set status
// once /public/products resolves over the network. In that window, a
// coming-soon tier rendered as a completely normal, tappable product --
// looked exactly like it could be bought. It never actually COULD be
// bought (server.js's /invest/create independently re-checks active/
// comingSoon on every purchase attempt regardless of what the client
// shows, so no money was ever actually at risk), but the UI itself must
// never show a wrong status. Now the last real synced product list is
// cached in localStorage too, exactly like account state already is, and
// loaded back before anything ever renders -- so even the very first
// paint of a returning visit already shows the correct status, not a
// generic guess. Only a genuinely first-ever visit still waits on the
// real fetch, same accepted case as account state.
// v40: My Team, per feedback. (1) A team member's row in the Level 1 list
// showed "Not invested yet" as vague text -- now shows a real UGX amount
// (UGX 0 when they haven't invested, the real total otherwise), same field
// as everyone else, no special-cased wording. (2) The member list itself
// was redesigned off individually-boxed white/shadowed "card" rows onto a
// single flat divided list (hairline between rows, no per-row box) -- no
// tabs anywhere in it either.
// v41: correction to v40 -- the ask was only to mask the raw COUNT DIGIT
// shown for Level 2/3 on the Team overview (now shows "•••" there instead
// of a number), never to remove the ability to actually open and browse
// the Level 2/3 member lists. v40 wrongly did the latter (removed the rows
// entirely and had the server reject ?level=2/3 outright) -- both are
// reverted here: Level 2/3 rows are back, still tappable, still open the
// real member list exactly like Level 1 does; /team/members answers all
// three levels again, same as before v40.
// v42: correction to v40/v41's masking direction -- Level 1 members (the
// people the member personally, directly invited) now show their real,
// full phone number, unmasked. Level 2/3 members (referrals of referrals --
// never directly invited by this member) keep the masked "+256•••82"
// format. Previously all three levels used the same masked format.
// v43: fixed a real bug -- server.js writes Task Center milestone claims
// as transaction type 'team_reward', but History -> Accrued only ever
// filtered for 'commission' (the separate, automatic Level 1/2/3 referral
// payout paid when your downline invests). Every Task Center claim was
// landing correctly in the wallet server-side but never appearing in
// Accrued at all. Both types are now included, and given genuinely
// distinct labels -- "Referral commission" vs "Task Center reward" --
// since both were confusingly labelled "Team reward" before, which is
// exactly why referral commissions ALSO looked like they weren't showing
// anywhere: a commission payout and a Task Center claim are different
// things and now read as different things. Each Accrued entry also shows
// the server's own specific description (which level, which milestone)
// as a Details line, not just the generic category. No change to how
// live this screen already was -- it was already reading from the same
// account-poll-refreshed data as everything else, silently, no spinner;
// the transactions were simply never being counted as income at all.
// v44: two fixes, both per feedback. (1) Reverted the Level 2/3 masked
// "•••" count on the Team overview back to the real number -- kept for
// under a day before being asked to undo it; Level 1/2/3 all show real
// counts again now, same as before that change. (2) Every "Please wait…"
// busy button app-wide (sign in/register, change password, Task Center
// claim, save bank account, deposit, withdraw, check-in) now shows the
// same small spinning-arc icon already used on the deposit Verify Payment
// button, not just swapped text with no motion. Redeem Gift Code
// specifically had NO busy feedback at all before (button just silently
// disabled) -- it now gets the same spinner + text as everything else, so
// a redemption in flight is visibly happening instead of looking like
// nothing responded until the toast appears.
// v50: (1) SECURITY FIX -- /account had no banned-account check at all, the
// one real gap that let a banned member keep using the app normally. (2)
// Maintenance/ban are now a real full-screen, non-dismissible takeover
// (crossed wrench+screwdriver / padlock) triggered instantly from api()
// itself, so an action already in flight gets shut down immediately, no
// reload needed. (3) A banned account signing in now sees "Account locked"
// right on the sign-in form instead of getting into the app at all.
// v51: (1) Cash Out screen gets tap-to-fill quick-amount chips (UGX
// 20,000 / UGX 50,000 / Max) -- the bug was that a chip only ever set
// witAmt's value with no matching input event, so the fee/net calc row
// stayed frozen at UGX 0 after a tap (looked like it "swapped back to
// default"); tapping now recomputes the fee/net immediately so the user
// can go straight to Request Cash Out. (2) Home screen banner now
// supports an admin-set title + sentence overlaid on the image (Admin ->
// Settings -> Home screen banner), server-side setting, blank by default
// so nothing shows unless the owner adds text.
// v52: Removed the rounded-corner "curved frame" from every banner image
// EXCEPT the Home dashboard banner (Rewards, Team, Ledger/history,
// Deposit, Cash Out, Support, Bind Bank all now sit square-edged, flush
// with the page padding) -- Home keeps its curved bottom corners on
// purpose, everything else is now straight-edged per feedback.
// v53: (1) Reverted the v51 withdrawal quick-amount chips -- never asked
// for, removed entirely, Cash Out is back to a plain amount field. (2)
// Bottom tab bar is no longer a floating rounded pill -- it's now full
// width, flush with the very bottom and both side edges, square corners,
// per feedback. (3) Added "How it works" numbered instruction cards: one
// on the Team screen (how referral commissions work) and one on the Cash
// Out screen (how withdrawals get approved and paid).
// v54: (1) The 4 Home action-chip icons (Add Funds, Cash Out, Rewards Hub,
// Support) all use the same caramel color now instead of 4 different
// colors. (2) "Daily Reward" action-chip label renamed to "Rewards Hub".
// (3) Announcement dialog redesigned: caramel gradient hero band with a
// gift-box badge (shown whenever the admin hasn't uploaded a custom
// image), bolder centered title, a divider before the Telegram buttons --
// no longer a flat plain card.
// v55: Announcement popup, round 2 -- with the owner's real (long, 6-
// paragraph) notice live it was still way too tall and still had rounded
// corners everywhere. Squared off every corner (sheet, hero band, badge,
// Telegram buttons, floating close button), shrank the hero band/badge,
// and switched paragraph spacing from nl2p's full blank-line gaps (built
// for the spacious About/Rules pages) to a new tight nl2pTight helper
// with a small fixed margin between paragraphs -- same content now takes
// noticeably less vertical space.
// v56: (1) "How referrals work" card moved to below Team overview (was
// above it). (2) Payout Account: removed the "Default" badge and its
// confirmation toast entirely -- tapping an account now just picks it,
// with no label to explain and no separate step. From the withdrawal
// flow (Cash Out's "Change"/"Bind one now") the tap also drops straight
// back into Cash Out automatically; from the standalone Account tab entry
// it just re-renders the list in place. (3) Add Funds / Cash Out submit
// buttons: swapped the small busy-arc icon for the bigger dash-spin
// circle (same animation as the app's full-section loading spinner,
// scaled down), and both now stay in that busy state for a minimum of 3
// seconds even if the server answers faster (never longer than a
// genuinely slow response, just never shorter than 3s).
// v57: Corrected v56's loader misread. (1) Reverted the submit-button
// spinner/3s-delay change entirely -- Add Funds / Cash Out's actual
// "Request" buttons are back to the plain small arc + no artificial
// delay. (2) The 3-second "other" loader (big dash-spin circle, full
// screen) now shows the instant the HOME SCREEN'S Add Funds / Cash Out
// chips are tapped, before that screen even opens -- which is what was
// actually asked for. (3) Home banner title/sentence: was rendering in
// white text sitting on the bright top part of the banner photo where
// the bottom-anchored dark gradient never reaches, making it unreadable.
// Switched to a dark chocolate color (var(--cocoa)/--cocoa-soft) so it
// reads regardless of the gradient position.
// v58: Home chip loader (Add Funds / Cash Out) shortened from 3s to 2s.
// v59: (1) Removed the Home chip loader entirely, per feedback -- Add
// Funds / Cash Out open instantly again, no loader. (2) Fixed a real
// bug: witAmt/depAmt had no upper bound, so mashing digits (or a
// scanner) could type a 20+ digit figure that overflowed the fee/net
// calculation -- both amount fields now cap at 10 digits. (3) Team and
// Rewards screens: removed every white card/box/pill container (referral
// link box, commission % tiles, Team overview card, How-referrals-works
// card, the DAILY REWARD pill, Redeem-a-Promo-Code card) -- everything
// now sits directly on the page separated by thin dividers, no boxes.
// Cash Out's own "How cash-outs work" card is untouched (out of scope).
// v60: Design pass -- own chocolate-brand execution, not a copy of the
// reference app the owner shared. (1) Account/Me: the 2 plain balance
// boxes are now a caramel-gradient hero card, plus a new dark-cocoa
// "Invite friends" banner (tap to copy the referral link) above the menu
// grid. (2) Team: level tiles get gold/silver/bronze numbered medal
// badges above the L1/L2/L3 percentages. (3) Shop: the cheapest tier
// gets a "Popular" ribbon, the priciest gets "Premium". (4) Redeeming a
// promo code now shows a festive gift-badge pop-up with the amount
// earned instead of a plain toast. Reversible as a unit -- this is one
// commit on top of the previous known-good state.
// v61: Design pass verdict -- Account hub (gradient balance card + invite
// banner) and the Redeem gift-badge pop-up are OUT, reverted to exactly
// what they were before v60. Team's gold/silver/bronze medal badges and
// Shop's "Popular" ribbon on the cheapest tier are KEPT (the "Premium"
// ribbon on the priciest tier is dropped too -- only Popular stays).
// v62: Product detail page (opens for every chocolate tapped in Shop)
// redesigned -- same 4 numbers (Price, Daily reward, Cycle, Total
// payout), same wording, same hero image/banner/Buy button, just a
// different layout: Total payout is now a bold caramel-gradient hero
// card, Price/Daily reward/Cycle sit as a 3-tile row below it, instead
// of the old plain stacked list.
// v63: The v62 detail page is GONE per feedback -- no more tapping into a
// separate page for any chocolate. Every product's full numbers (Price,
// Daily reward, Cycle, Total payout) plus its own Buy button now sit
// directly on its Shop card. Home's small "Featured chocolates" cards
// now jump to the Shop tab on tap (that's where full details + Buy
// live) instead of a page that no longer exists.
// v64: Shop card numbers were v63's gradient "hero stat" + 3-tile grid --
// too box-heavy per feedback. Swapped for the classic plain list (same
// .kv row pattern used elsewhere): Price/Daily reward/Cycle/Total payout
// as simple label-left value-right rows with thin dividers, no
// tiles/gradients. Same content, same Buy button, just plainer.
// v65: Shop card was still too tall with 4 stacked rows. Collapsed
// Price/Daily reward/Cycle/Total payout into one compact divided row
// (label above value in each of 4 cells, thin vertical dividers between
// them -- "| | |") instead of 4 separate rows, same divider style
// already used on Team's L1/L2/L3 row. Noticeably shorter card, same
// content, same wording.
// v66: Rewards tab was too tall/spaced -- Redeem a Promo Code sat below
// the fold on most phones. Compressed the check-in block: banner
// 170px->120px, ring 170px->132px, wrap padding 30px->16px, tighter
// margins around the streak dots -- Redeem now sits in view without
// scrolling as much. Unrelated to this, also fixed a real timing bug:
// daily cashback used to only settle when the owning user's own
// /account or /investments got read, so a payout could land minutes
// late if the app was backgrounded right at the 24h mark. A new
// company-wide reconciler sweep now runs every 30s independent of any
// user's activity, so payouts land within ~30s of when they're due.
// v67: Tapping a card in Home's "Featured chocolates" strip now switches
// to Shop AND auto-scrolls straight to that exact product's own card
// (smooth scroll, centered in view), instead of just landing on Shop's
// top and leaving the member to hunt for it.
// v68: Account (Me) screen -- added a small UGX coin icon beside the
// Balance and Cash Outs figures, sized to sit neatly next to the text
// without disturbing the tile layout.
const CACHE = 'chocomcc-shell-v68';
const VENDOR_CACHE = 'chocomcc-vendor-firebase-v1';
const SHELL = ['/', '/index.html', '/manifest.json', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== VENDOR_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first for navigations (always try to get the freshest app shell),
// falling back to cache when offline. Cache-first for the static shell
// assets ONLY. Anything else cross-origin (every API call to the backend)
// goes straight to the network, every time, with NO caching whatsoever —
// those responses are per-user and must never be shared between
// sessions/devices (this is the v2 fix above).
//
// ONE deliberate, narrow exception: Firebase Auth's own SDK script files
// (imported live from gstatic.com in index.html so sign-in can even start).
// They're public static library code — no Authorization header, no
// per-user data whatsoever, and version-pinned right in the URL itself
// (.../firebasejs/10.12.0/...), so a version bump is a different URL, not
// a stale-cache risk. Fetching ~150KB+ of JS from gstatic.com on every
// single app open, before Firebase can even fire its sign-in callback, was
// real added latency on top of everything else already fixed for fast
// returning sign-in. Cache-first here removes that network round-trip
// entirely from the second app open onward.
const FIREBASE_SDK_PREFIX = 'https://www.gstatic.com/firebasejs/';
self.addEventListener('fetch', e => {
  if (e.request.url.indexOf(FIREBASE_SDK_PREFIX) === 0) {
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request).then(resp => {
        const copy = resp.clone();
        caches.open(VENDOR_CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        return resp;
      }))
    );
    return;
  }
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
