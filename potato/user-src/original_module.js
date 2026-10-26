// Potato backend, on the same Hostinger VPS as this frontend (pm2, port 3000
// behind nginx). api./app. are still different subdomains -- different
// browser origins -- so this host must stay in server.js's CORS allowlist.
// Same host as the page: the server answers under /k7x2 (nginx strips the prefix).
// No domain is baked in, so changing the host never needs a rebuild.
var API_BASE = '/k7x2';


// Every money amount elsewhere is always a whole shilling -- only a
// gift-code reward can ever carry cents (Round 137's randomized rewards,
// e.g. 123.39), so this used to Math.round() them away entirely before
// display. Now only shows decimals on a value that actually has them --
// everything else (deposits, withdrawals, prices, cashback) keeps its old,
// clean whole-number look with no changes needed at any call site.
// ── REGION (which country this app is running as) ──
//
// Owner: "l wanted other subdomain to fetch other country code and
// currency, ie fgdr.potato-platform.com in ugx, and country code changeable
// to other country or created, and another can be sfhd.potato-platform in
// KES shs, or any country created, also make when l can edit prices of each
// product and all settings as these of ugx."
//
// The SERVER decides which region this is, never the app: it comes back on
// /public/settings (the region that owns the hostname we were loaded from,
// so Sign Up reads in the right currency) and again on /account (the
// signed-in member's OWN region, which wins -- a member who opens another
// country's subdomain still sees their own currency, prices and number
// rules). Nothing here is ever sent back up; the server re-derives it on
// every request. See the REGIONS section in server.js.
//
// The values below are Uganda's, and they are also what an offline first
// paint uses -- so a cold start with no network still formats money and
// validates a phone number the way it always did.
var REGION = { key: 'ug', name: 'Uganda', currency: 'UGX', currencySymbol: 'UGX', dialCode: '256', localLength: 9, localLengths: [9], prefixes: ['7'], utcOffsetMin: 180, isDefault: true };
function cur(){ return (REGION && REGION.currency) || 'UGX'; }
// "7XXXXXXXX" for Uganda -- the region's first allowed prefix padded out to
// its local length, used in the placeholders that show the shape to type.
function dial(){ return (REGION && REGION.dialCode) || '256'; }
function dialPlus(){ return '+' + dial(); }
function localLen(){ return Number(REGION && REGION.localLength) || 9; }
// Every length a number may have in this region (9 for Uganda, 9 or 10 for Nigeria), longest last.
function localLens(){
  const l = REGION && Array.isArray(REGION.localLengths) && REGION.localLengths.length ? REGION.localLengths : [localLen()];
  return l.map(Number).filter(n => n > 0).sort((a, b) => a - b);
}
// "9 or 10", "9": what the red line under the phone box says a number must have.
function phoneLenWords(){ const l = localLens(); return l.length > 1 ? l.slice(0, -1).join(', ') + ' or ' + l[l.length - 1] : String(l[0]); }
function regionPrefixes(){ return (REGION && Array.isArray(REGION.prefixes) ? REGION.prefixes.filter(Boolean) : []); }
// Applied from whichever response carried a region block. Only the fields
// the server actually sent are taken, so a server that is one deploy behind
// (no region in its replies at all) leaves Uganda's defaults standing
// instead of blanking the currency.
function applyRegion(r){
  paintRegionChrome();
}
// The bits of the SIGN-IN screen that name a country. Repainted from here,
// because the region arrives from the network AFTER that screen is already
// on display -- and the two dialling-code chips were static "+256" in the
// markup with nothing ever updating them, so every country's address showed
// Uganda's code. Reported: "why when you tap the other country domain,
// still returns the 256 on login and register".
//
// That was worse than a cosmetic slip: the chip is the ONLY thing telling a
// member which country the address he opened belongs to, so an address
// pointing at the wrong country looked completely normal right up until the
// password that had always worked was refused.
function paintRegionChrome(){
  try {
    const d = dialPlus();
    for (const id of ['loginDial', 'regDial']) { const el = $(id); if (el) el.textContent = d; }
    // The country and currency are NOT printed on the sign-in screen. They
    // were, briefly, as a way to make a wrongly-mapped address visible --
    // owner: "why showing the country and currency, that should not be
    // shown". The dialling-code chip above already differs per country, and
    // the address checker in the admin panel answers the same question
    // without putting operator diagnostics in front of members. Left in
    // place, blank, so nothing has to move if it is ever wanted again.
    for (const id of ['loginRegionNote', 'regRegionNote']) {
      const el = $(id);
      if (!el) continue;
      el.textContent = '';
      el.style.display = 'none';
    }
  } catch(_){}
}
// The last region this device saw, restored before the first paint so a
// returning member never sees Uganda's currency flash on a Kenyan phone
// while /public/settings is still in flight.

// Thousands commas and the decimal point are written here, never left to the phone's own locale (an older phone browser without full
// language data prints 970130.00 or 970 130,00 for the same number). cents=true always shows two decimals.
function numGroup(n, cents){
  let v = Number(n); if (!Number.isFinite(v)) v = 0;
  const neg = v < 0; v = Math.abs(v);
  const fixed = cents ? (Math.round(v * 100) / 100).toFixed(2) : String(Math.round(v));
  const parts = fixed.split('.');
  return (neg ? '-' : '') + parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (parts[1] ? '.' + parts[1] : '');
}
function fmtUGX(n){
  const v = Number(n)||0;
  const hasCents = Math.round(v*100)%100 !== 0;
  return cur() + ' ' + numGroup(v, hasCents);
}
// Keep investment and payout amounts on the same cents-aware formatter.
function fmtUGXCents(n){ return fmtUGX(n); }
// subagent-audit-caught: the deposit/withdraw amount fields have no
// oninput sanitizer, and every amount the app itself shows (quick-amount
// chips, "min UGX 30,000" hints) is comma-formatted via fmtUGX() -- so a
// member typing "30,000" out of habit fed straight into a bare parseInt()
// stops at the comma (parseInt("30,000",10) === 30), producing a
// nonsensical "Minimum amount is UGX 30,000" rejection right next to an
// input that visibly still reads "30,000". Strips thousands separators
// before parsing.
// Whole numbers only: "20000.5" or "2e4" used to be read as 20000 and 2 (parseInt stops at the first non-digit); now they are not numbers.
function parseMoneyInput(v){ const s = String(v||'').replace(/[,\s]/g,''); return /^\d+$/.test(s) ? parseInt(s, 10) : NaN; }
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// ── Potato v2 design helpers ──
// Money the way the screens print it: currency glued to the figure, no
// spaces. vMoney drops the decimals ("UGX11,000"), vMoney2 always shows them
// ("UGX2,200.00"), which is how balances and totals read.
// Long money figures (nine digits and more) step the font down in two sizes so they stay on one line inside their box.
function vMoney2(n){ return cur() + ' ' + numGroup(n, true); }
// Icons traced from the owner's screenshots live in a square box 288 units wide drawn 1:1 with a 22 px picture (13.1 units = 1 px); the stroke sits on the <g> so a bigger/smaller box keeps the same proportions.





// ── THE APP'S NAME ──
// Owner: "l would like to also to edit the app name potato, so make it when it
// can be editable everywhere." It is one admin setting (Settings -> App name)
// and every screen reads it from here. Nothing in this file spells the name
// out any more, so a rename cannot half-land -- which is precisely how the
// last one went, leaving the old name on the screens nobody thought to check.
//
// The fallback is not decoration: settings arrive over the network, and the
// login screen paints before they land. Without it the very first frame of a
// cold open would have a blank space where the name goes.
// What the app is CALLED, if anything actually knows yet. Three sources, in
// order of freshness: the settings this session fetched, then the name this
// device remembered from the last session (written by index.html's own early
// script, which runs before this file inflates), then nothing.
//
// "Nothing" is a real answer and callers must handle it. Owner: "let's not
// make potato to be default name" -- a hardcoded default is exactly what made
// the loading screen keep saying the old name after he had renamed the app,
// because the loader is on screen while the settings request is still in
// flight, so the default was all it could ever show.
function brandNameKnown(){
  const n = STATE.settings && typeof STATE.settings.brandName === 'string'
    ? STATE.settings.brandName.trim() : '';
  if (n) return n;
  const cached = typeof window.__brandCached === 'string' ? window.__brandCached.trim() : '';
  return cached || '';
}
// For SENTENCES, where a blank would read as a broken string ("Welcome to
// the  app"). The wordmark deliberately does NOT use this -- see
// brandWordmarkHtml().
// Was `|| 'Potato'` -- a real bug, not a design choice: with no
// admin-set brandName yet (a fresh Potato deploy, before the owner has
// opened Admin -> Settings), every sentence-form use of the brand name
// literally rendered the word "Potato". Potato is this app's own real name,
// not an inherited-fork placeholder, so it is the correct fallback here --
// unlike the wordmark below, which stays blank on purpose.
function brandName(){
  return brandNameKnown() || 'Potato';
}
var BRAND_CACHE_KEY = 'potato_brand_name';
// The wordmark: just the name, in caps. Used to split off the LAST letter
// into an accent colour ("CHIP+Z") -- a pun specific to Potato's own name
// that means nothing for any other brand, dropped per the owner's "don't
// use anything that was Potato" instruction rather than carried over as a
// rule that happens to have one letter highlighted for no reason.
// The wordmark shows the name or NOTHING. It is the one place a guess is
// worse than a blank: a blank for the half-second before settings land reads
// as the logo loading, while the wrong name reads as the rename not having
// worked -- which is precisely the report that started this.
function brandWordmarkHtml(){
  const n = brandNameKnown().toUpperCase();
  return n ? esc(n) : '';
}
// Paints the name into the places that are NOT re-rendered from JavaScript:
// index.html's own static markup (the pre-launch countdown gate is the only
// [data-brandmark] left -- the loading screen's own wordmark was dropped
// along with the rest of its Potato-derived design) and the browser/tab
// title. Called once the settings land, and safe to call again -- it only
// ever writes.
//
// The document title is as far as a running app can go. manifest.json's own
// `name` and the og: tags are read by Chrome at install time and by link
// crawlers, both of which see the STATIC file and never run a line of this
// code, so those two carry the name at deploy time and a rename needs a
// frontend redeploy to reach them.
function applyBrandName(){
  const known = brandNameKnown();
  if (!known) return;   // nothing to say yet; leave the blanks blank
  document.querySelectorAll('[data-brandmark]').forEach(el => { el.innerHTML = brandWordmarkHtml(); });
  document.querySelectorAll('[data-brandname]').forEach(el => { el.textContent = known; });
  document.querySelectorAll('.home-brand-title').forEach(el => { el.textContent = known; });
  try { document.title = known; } catch (_) {}
  // Remember it for the next launch. This is the whole fix for "on start up
  // loader it was still saying potato": the loading screen paints long before
  // /public/settings answers, so the only way it can show the right name is
  // to already know it. Written on every apply, so a rename reaches the
  // loader on the boot AFTER the one that learned it -- there is no earlier
  // moment available to a screen that is up before the network answers.
  try {
    if (window.__brandCached !== known) {
      localStorage.setItem(BRAND_CACHE_KEY, known);
      window.__brandCached = known;
    }
  } catch (_) {}
}
function sanitizePhoneInput(el){
  let digits = el.value.replace(/\D/g, '');
  const len = localLens()[localLens().length - 1], d = dial();
  if (digits.startsWith(d) && digits.length > len) digits = digits.slice(d.length);
  const maxDigits = digits.startsWith('0') ? len + 1 : len;
  if (digits.length > maxDigits) digits = digits.slice(0, maxDigits);
  el.value = digits;
}
function $(id){ return document.getElementById(id); }

// ── STATE ──
var STATE = { user: null, account: null, settings: null, products: null, investments: null,
  teamStats: null, teamMembers: {1:null,2:null,3:null}, bankAccounts: null, transactions: null, refCode: null, page: 'home',
  // Codex-caught real bug: on a shared device, a request started by member A
  // (e.g. the live-refresh poll, or a tab opened right before logout) could
  // still be in flight when A logs out and B logs in on the same page load --
  // there was nothing stopping that stale response from landing and writing
  // A's balance/investments/team into STATE right after enterApp() just
  // populated it with B's data. Bumped on every auth transition (doLogout()
  // and the snow-auth handler below); api()/post() capture the epoch before
  // the network call and discard the response if it's changed by the time
  // the response lands, so every existing `if (r.status === 'success')
  // STATE.x = ...` call site is automatically safe with no per-site changes.
  authEpoch: 0 };

// The dark bottom-pill toast USED TO LIVE HERE and is gone. Owner: "no more
// saying other stuffs of old small notifies, l nolonger need those dark tiny
// notifies you already know that we have a pop up card with [the warning
// sign]." Every one of its ~30 call sites now goes to window.notify() further
// down -- the same alert card the rest of the app uses.
//
// Nothing may reintroduce a `function toast` here: `notify` is defined as
// window.notify, and a top-level function of either name would shadow it for
// every unqualified call in this file.

// A session ends on real inactivity, even when background polls still succeed.
try { window._suppressAutofillLogin = sessionStorage.getItem('potato_relogin_required') === '1'; } catch (_) {}
var _memberSession = window.createPotatoIdleSession('potato_member_session', function(){
  window._triedAutoSignIn = true;
  document.querySelectorAll('.sheet-bg.show,.modal-bg.show,.pay-page.show,#msgDetailBg.show').forEach(el => el.classList.remove('show'));
  unlockBodyScroll();
  resetOverlayState();
  hideLoadingScreen();
  $('app').style.display = 'none';
  $('authScreen').style.display = '';
  // {auto:true} -- see doLogout()'s own comment on why an idle timeout must
  // NOT permanently disable Chrome's autofill-then-submit convenience the
  // way a deliberate "Log Out" tap does.
  window.doLogout({ auto: true }).catch(() => {});
  notify(window._sessionFailureMessage || 'Your session ended. Please log in again. If this repeats, check automatic date and time on your phone.');
  window._sessionFailureMessage = '';
}, () => post('/auth/session/activity', {}));
var _apiPending = new Map();
function api(path, opts){
  opts = opts || {};
  // Share only concurrent reads. Payments and all other writes always run once
  // per explicit call, and reads are never cached across account changes.
  if (opts.body || opts.signal || (opts.method && opts.method !== 'GET')) return apiRequest(path, opts);
  const key = STATE.authEpoch + ':' + path;
  if (_apiPending.has(key)) return _apiPending.get(key);
  const pending = apiRequest(path, opts).finally(() => { if (_apiPending.get(key) === pending) _apiPending.delete(key); });
  _apiPending.set(key, pending); return pending;
}
// ── API ──
async function apiRequest(path, opts){
  opts = opts || {};
  // Captured before the network round-trip, checked after -- if a logout or
  // a different user's login happened while this request was in flight (see
  // STATE.authEpoch's own comment), the response belongs to a session that
  // no longer exists on screen and must never be written into STATE.
  // /public/* endpoints are exempt: they're not per-user (settings,
  // products, banners, the About article), so they can never leak one
  // member's data into another's session -- and boot()'s very first
  // /public/settings + /public/products fetch always races the app's own
  // first snow-auth firing (which bumps the epoch unconditionally, see
  // below), so gating them here would discard that legitimate boot data
  // every single page load.
  const isPublicCall = path.indexOf('/public/') === 0;
  if (!isPublicCall && STATE.user && path !== '/auth/session/logout' && !_memberSession.check()) return { status:'error', message:'Session expired. Log in again.' };
  const startEpoch = STATE.authEpoch;
  // ── Content-Type ONLY WHEN THERE IS A BODY ──
  // MEASURED (test-boot-speed.py, against a real cross-origin server):
  // `Content-Type: application/json` is not a CORS-safelisted request
  // header, so sending it turns even a plain GET into a PREFLIGHTED request
  // -- an OPTIONS round trip before every single call, per URL. With eight
  // reads on the boot path that was eight wasted round trips, on the one
  // connection where latency costs the most.
  //
  // It was never needed on a GET: there is no body to describe. Express's
  // JSON parser only runs when a body is present, so nothing on the server
  // depends on it either. The harness proves both directions -- with the
  // header the server logs ['OPTIONS','GET'], without it ['GET'], same
  // answer.
  //
  // POSTs still send it, and their preflight is now cached for a day
  // (cors({maxAge}) in server.js) rather than Chromium's five-second
  // default.
  const headers = Object.assign({}, opts.headers || {});
  if (opts.body != null && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (opts.signal) {
    if (opts.signal.aborted) abort();
    else opts.signal.addEventListener('abort', abort, { once: true });
  }
  const timeout = setTimeout(abort, Number(opts.timeoutMs) || 45000);
  let data, tokenAbort;
  try {
    if (window.fbAuth && window.fbAuth.currentUser) {
      try {
        const token = await Promise.race([
          window.fbAuth.currentUser.getIdToken(),
          new Promise((_, reject) => {
            tokenAbort = () => reject(new Error('Authentication request timed out'));
            if (controller.signal.aborted) tokenAbort();
            else controller.signal.addEventListener('abort', tokenAbort, { once: true });
          })
        ]);
        headers['Authorization'] = 'Bearer ' + token;
      } catch (e) { if (controller.signal.aborted) throw e; }
      finally { if (tokenAbort) controller.signal.removeEventListener('abort', tokenAbort); }
    }
    if (!isPublicCall && STATE.authEpoch !== startEpoch) return { status: 'error', stale: true, message: 'Session changed' };
    const resp = await fetch(API_BASE + path, Object.assign({}, opts, { headers, signal: controller.signal }));
    data = await resp.json();
    if (resp.status === 401 && !isPublicCall && STATE.authEpoch === startEpoch && STATE.user) {
      window._sessionFailureMessage = 'Your login session was rejected. Please log in again. If this continues, contact support.';
      _memberSession.expire();
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid response');
  } catch (e) {
    if (!isPublicCall && STATE.authEpoch !== startEpoch) return { status: 'error', stale: true, message: 'Session changed' };
    return { status: 'error', message: controller.signal.aborted
      ? 'Request timed out. Check Transaction Statement before trying a payment again.'
      : 'Could not reach the server. Check your connection and try again.' };
  } finally {
    clearTimeout(timeout);
    if (opts.signal) opts.signal.removeEventListener('abort', abort);
  }
  // Owner: "l didn't want root domain to work." The server answers every
  // request from a parked address -- the bare domain, its www. form, or
  // anything the admin has retired -- with this code. Handled HERE, in the
  // one place every request passes through, so it cannot matter which call
  // happens to be first: whatever the app was doing, it stops and says so.
  if (data && data.code === 'HOST_PARKED') { showHostParked(data.message); return data; }
  if (!isPublicCall && STATE.authEpoch !== startEpoch) return { status: 'error', message: 'Session changed', stale: true };
  return data;
}
// A plain, final screen. Not notify(): a dialog with an OK button implies
// there is something behind it to go back to, and on this address there is
// nothing -- no amount of tapping will make the app work here. The loading
// screen is taken down with it, or this would sit behind a spinner that
// never stops.
var _hostParkedShown = false;
function showHostParked(msg){
  if (_hostParkedShown) return;
  _hostParkedShown = true;
  try {
    const ls = $('loadingScreen'); if (ls) ls.style.display = 'none';
    const app = $('app'); if (app) app.style.display = 'none';
    const auth = $('authScreen'); if (auth) auth.style.display = 'none';
  } catch(_){}
  // ...and then make it STICK. Hiding the three screens once is not enough:
  // a Firebase session restore landing a moment later runs enterApp(), which
  // shows #app again, and the member is then looking at a half-painted app
  // on an address where every single request is refused. Caught by
  // test-region-currency.py's parked scenario the moment this notice started
  // appearing earlier than it used to. A stylesheet rule with !important
  // beats the inline style any later code can set, which an inline style set
  // from here does not.
  try {
    const st = document.createElement('style');
    st.textContent = '#loadingScreen,#app,#authScreen{display:none !important}';
    document.head.appendChild(st);
  } catch(_){}
  const host = (typeof location !== 'undefined' && location.hostname) || '';
  const box = document.createElement('div');
  box.id = 'hostParked';
  box.setAttribute('style', 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;padding:24px;background:var(--snow-canvas,#fbf1e8);');
  box.innerHTML = `<div style="max-width:340px;text-align:center;">
    <div style="font-size:26px;font-weight:800;margin-bottom:12px;">${esc(brandName())}</div>
    <div style="font-size:16px;line-height:1.55;color:var(--snow-ink,#1a1310);">${esc(msg || 'This address does not serve the app.')}</div>
    ${host ? `<div style="font-size:13px;margin-top:14px;color:var(--snow-muted,#8c7f76);">You opened <b>${esc(host)}</b>.</div>` : ''}
  </div>`;
  document.body.appendChild(box);
}
function post(path, body){ return api(path, { method: 'POST', body: JSON.stringify(body || {}) }); }

// ── AUTH ──
// The local (national) digits for THIS region -- the dialling code or the
// leading 0 taken off, and the right length or nothing. Mirrors
// localDigits() in server.js.
function localDigits(raw){
  const d = dial(), lens = localLens();
  const s = String(raw||'').replace(/\D/g,'');
  if (s.startsWith(d) && lens.some(l => s.length === d.length + l)) return s.slice(d.length);
  if (s.startsWith('0') && lens.some(l => s.length === l + 1)) return s.slice(1);
  if (lens.includes(s.length)) return s;
  return null;
}
// The synthetic address this account signs in to Firebase with. It MUST
// produce exactly the same string as phoneToEmail() in server.js, or a
// member would create one account and then log in looking for another.
// Uganda keeps the bare local digits it has always used, so no existing
// login changes; every other region carries its dialling code, because the
// same local number exists in more than one country and the bare digits
// alone would put a Kenyan inside a Ugandan's account.
// The login address for a number, in THIS region's shape. Must match
// server.js's phoneToEmail() exactly, character for character -- they are
// two implementations of one string, and a disagreement means a member
// creates one Firebase account and then signs in looking for another.
//
// `usesBareLocal` comes from the server (publicRegionView) because the
// answer depends on the FOUNDING region's dialling code, which the app
// cannot see. The `!== false` default keeps the bare form when talking to a
// server that is a deploy behind and does not send the flag -- that is the
// shape every account created before regions existed already has.
function phoneToEmail(phone){
  return loginAddressFor(phone, true);
}
function loginAddressFor(phone, bare){
  const local = localDigits(phone) || String(phone).replace(/\D/g,'').replace(/^0+/, '');
  return (bare ? local : dial() + local) + '@potato-platform.com';
}
// Every address this number could have been registered under, most likely
// first. Firebase folds "no such account" into the same
// auth/invalid-credential as a wrong password, so a member locked out by a
// region setting changing under him is indistinguishable from someone
// typing the wrong password -- he just sees "Incorrect phone number or
// password" for a password that is correct, which is exactly what was
// reported from a live subdomain.
//
// So sign-in tries the other shape too. Deliberately only the two shapes for
// THIS region -- never another country's -- so it cannot become a way to
// sign in to a Kenyan account on the Ugandan site.
function loginAddressCandidates(phone){
  // One address is enough now: the server reduces whatever it is given
  // (national or international shape) to the same canonical number, so there
  // is no second spelling to try. Trying two would also count every wrong
  // password twice toward the server's lockout.
  return [loginAddressFor(phone, true)];
}
function cleanPhone(raw){
  const local = localDigits(raw);
  if (!local) return null;
  const pfx = regionPrefixes();
  if (pfx.length && !pfx.some(p => local.startsWith(p))) return null;
  return dialPlus() + local;
}
// Login and Create Account are two states of one screen: the title and which form is shown.
// The banner is ALWAYS the whole picture (245.3 px tall) at the top of a page that scrolls as one piece. On the owner's recording the pages rest
// scrolled down 66.6 px (the top of the picture is above the screen, scrolling up reveals it) except Create Account for an invitation link, which
// rests at the very top. The banner never changes height and never animates.
var PA_REST = 66.6;
function paRestScroll(){
  const sc = $('authScroll'); if (!sc) return;
  const ref = $('regReferral'), invited = !!(ref && (ref.value || '').trim()) && $('registerPane').style.display !== 'none';
  sc.scrollTop = invited ? 0 : PA_REST;
}
// The invitation box is there only when the member arrived through an invitation link (it carries the code).
function paSyncInvite(){
  const ref = $('regReferral'); if (!ref) return;
  const box = ref.closest('.pa-f'); if (box) box.style.display = (ref.value || '').trim() ? '' : 'none';
  paRestScroll();
}
// The sign-in password boxes are switched off whenever the sign-in screen is hidden: with a password box anywhere in the page Chrome offers "Use saved
// password?" over every other box (the Deposit amount, for one). They are switched on again when the sign-in screen shows.
function paLockPasswordBoxes(lock){
  document.querySelectorAll('#authScreen input[type=password]').forEach(i => { i.disabled = !!lock; });
}
(function(){
  const as = $('authScreen'); if (!as || !window.MutationObserver) return;
  let hidden = as.style.display === 'none';
  paLockPasswordBoxes(hidden);
  new MutationObserver(() => { const now = as.style.display === 'none'; if (hidden && !now) { paLockPasswordBoxes(false); paRestScroll(); paLogoPlay(); } if (now) paLockPasswordBoxes(true); hidden = now; }).observe(as, { attributes: true, attributeFilter: ['style'] });
})();
// Switching between the two pages, as on the owner's recording (60 fps): the page goes blank at once, the banner fades in over 0.25 s, then the title and
// every box / button / link rise ~28 px into place while fading in, one after the other (the title after 0.17 s, then every 0.06 s, 0.3 s each).
var _paEnterTimer = 0, _paLogoTimer = 0;
// The round picture rises into place from below, growing and fading in (the owner's recording); on the first showing of the sign-in screen too.
function paLogoPlay(){
  const root = $('authScroll'); if (!root) return;
  // The rise is two-stop and runs on the compositor (translate3d + will-change in the CSS), so no frame is drawn half-way / broken.
  root.classList.remove('pa-logo-in'); void root.offsetWidth; root.classList.add('pa-logo-in');
  clearTimeout(_paLogoTimer); _paLogoTimer = setTimeout(() => root.classList.remove('pa-logo-in'), 1000);
}
function paEnter(){
  const root = $('authScroll'); if (!root) return;
  const pane = $('registerPane').style.display !== 'none' ? $('registerPane') : $('loginPane');
  const items = [$('authTitle')].concat(Array.prototype.filter.call(pane.children, el => el.offsetParent !== null && /(^| )(pa-f|pa-rem|pa-btn|pa-alt)( |$)/.test(el.className)));
  items.forEach((el, i) => { el.setAttribute('data-pa-i', i); el.style.setProperty('--pa-d', (0.17 + 0.06 * i).toFixed(2) + 's'); });
  root.classList.remove('pa-entering'); void root.offsetWidth; root.classList.add('pa-entering');
  clearTimeout(_paEnterTimer); _paEnterTimer = setTimeout(() => root.classList.remove('pa-entering'), 1100);
}
function showAuthTab(tab){
  const reg = tab === 'register';
  const changed = ($('registerPane').style.display !== 'none') !== reg;
  $('loginPane').style.display = reg ? 'none' : '';
  $('registerPane').style.display = reg ? '' : 'none';
  const title = $('authTitle'); if (title) title.textContent = reg ? 'Create Account' : 'Login';
  phoneError('login', ''); phoneError('reg', '');
  paSyncInvite();
  if (changed && $('authScreen').style.display !== 'none') paEnter();
  stopSmsCodeListener();
}
// The eye on a password box: shows what was typed, and hides it again.
window.toggleAuthEye = function(btn){
  const box = btn && btn.closest('.pa-f'), input = box && box.querySelector('input');
  if (!input) return;
  // The Trade Password box is a plain text box drawn as dots (.pa-mask), so Chrome's password manager does not offer to fill a long suggested
  // password into a 6-digit box; the eye then switches the dots off and on instead of the box's type.
  const masked = input.classList.contains('pa-mask');
  const show = masked ? !input.classList.contains('pa-clear') : input.type === 'password';
  if (masked) input.classList.toggle('pa-clear', show); else input.type = show ? 'text' : 'password';
  btn.classList.toggle('shown', show);   // the eye is struck through while the password is hidden, open while it is shown
  btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
};
// Owner: "on login it should not say please wait, it should say logging
// in... so everywhere saying please wait... it should be removed."
//
// "Please wait" tells the member the app is busy, which they can already see
// from the disabled button -- and tells them nothing about WHAT is happening,
// which is the one thing that makes a two-second pause on a money screen feel
// safe rather than stuck. Every busy button in this file now names its own
// action, so `busy` is a required argument, not a default: adding a new
// loading button and forgetting the label is now a visible blank rather than
// a silent fall back to the wrong words.
function setBtnLoading(id, loading, label, busy){
  const btn = $(id);
  btn.disabled = loading;
  btn.textContent = loading ? (busy || '') : label;
}
function fbErrMsg(e){
  const code = e && e.code || '';
  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password') return 'Incorrect phone number or password.';
  if (code === 'auth/user-not-found') return 'No account found for that number.';
  if (code === 'auth/email-already-in-use') return 'An account with that number already exists.';
  if (code === 'auth/weak-password') return 'Password must be at least 6 characters.';
  if (code === 'auth/too-many-requests') return 'Too many attempts. Try again shortly.';
  // A weak connection is the commonest real failure here, and without these
  // the member was shown Firebase's own developer text, e.g.
  // "Firebase: Error (auth/network-request-failed)."
  if (code === 'auth/network-request-failed' || code === 'auth/timeout') return 'Could not reach the sign-in service. Check your connection and try again.';
  if (code === 'auth/user-disabled') return 'This account has been disabled. Contact support.';
  if (code === 'auth/invalid-email') return 'Enter a valid mobile number.';
  if (code === 'auth/operation-not-allowed' || code === 'auth/internal-error' || code === 'auth/quota-exceeded' || code === 'auth/app-not-authorized' || code === 'auth/invalid-api-key')
    return 'Sign-in is temporarily unavailable. Please try again shortly.';
  const msg = e && e.message;
  // Any other Firebase code, or its "Firebase: ..." wording, is not for members.
  if (code.indexOf('auth/') === 0 || /^Firebase:/i.test(msg || '')) return 'Something went wrong. Try again.';
  return msg ? msg : 'Something went wrong. Try again.';
}
// ── THE SIGN-IN SERVICE MAY NOT BE THERE ──
// Firebase is a separate <script type="module"> that imports from gstatic
// and awaits setPersistence() before it defines window.fbSignIn/fbAuth. If
// that import or call fails (a blocked or flaky connection on a first visit,
// storage disabled), none of them are ever defined and, worse,
// onAuthStateChanged never runs -- so nothing ever took the loading screen
// down: the app sat on its spinner forever and said nothing. Two guards:
//   - firebaseReady(): login/sign-up wait briefly for it, then say so
//     instead of throwing "window.fbSignIn is not a function" at a member;
//   - a watchdog that, if it has still not appeared, hides the spinner,
//     shows the login screen and says what is wrong. Non-destructive: if
//     Firebase arrives late, its own snow-auth event carries on as normal.
function firebaseReady(maxMs, needs){
  maxMs = Number(window._FIREBASE_READY_MS) || maxMs;
  return new Promise(resolve => {
    const t0 = Date.now();
    (function poll(){
      if (window.fbAuth && window[needs]) return resolve(true);
      if (Date.now() - t0 >= maxMs) return resolve(false);
      setTimeout(poll, 100);
    })();
  });
}
setTimeout(function(){
  if (window.fbAuth) return;
  try {
    hideLoadingScreen();
    if ($('app').style.display === 'none') $('authScreen').style.display = '';
    notify('Could not load the sign-in service. Check your connection, then reload the app.');
  } catch (_) {}
}, Number(window._FIREBASE_WATCHDOG_MS) || 15000);
// ── SAVED-CREDENTIAL AUTO SIGN-IN ──
// Chrome (and other Credential Management API browsers) can silently hand
// back a previously-stored password credential with zero user interaction
// -- the "sign in automatically next visit" behaviour the owner asked for
// after seeing it on another site. This is a real browser API for exactly
// that, not something achievable by just reading autofilled input values
// (browsers deliberately keep autofilled field contents out of reach of
// script for privacy, so there's no DOM-level way to detect/trigger this).
function credManSupported(){
  return !!(window.PasswordCredential && navigator.credentials && navigator.credentials.get && navigator.credentials.store);
}
// The saved username (`id`) is the member's phone number, not the synthetic
// Firebase address. Owner: "Why is Google saving authentication data like
// this, l only wanted it to be without @". An earlier attempt set only the
// cosmetic `name` field and kept the email as `id`, but Android's Google
// Password Manager lists the `id` and ignores `name`, so the
// "<digits>@potato-platform.com" kept showing. The Firebase address is a
// pure function of the phone number, so nothing is lost by not storing it:
// tryAutoSignIn() rebuilds it with loginAddressCandidates().
async function storeCredentialIfPossible(email, pass, displayPhone){
  if (!credManSupported()) return;
  const local = displayPhone ? localDigits(displayPhone) : null;
  const id = local ? '0' + local : email;
  try { await navigator.credentials.store(new PasswordCredential({ id, password: pass, name: id })); } catch (_) {}
}
// The red line under the phone box ('login' or 'reg' screen). Only the phone number gets a line (as on the owner's screen); every other
// refusal is the notice in the middle of the screen.
function phoneError(which, msg){ const el = $(which === 'reg' ? 'regPhoneErr' : 'loginPhoneErr'); if (el) el.textContent = msg || ''; }
function phoneErrorText(){ return 'Please enter a ' + phoneLenWords() + ' digit phone number'; }
function loginError(where, msg){
  if (!msg) return phoneError('login', '');
  if (where === 'phone') return phoneError('login', msg);
  notify(msg);
}
window.loginError = loginError;
window.doLogin = async function(){
  if (window._loginInProgress) return;
  window._loginInProgress = true;
  try {
  if (window._logoutPromise) await window._logoutPromise;
  const phone = cleanPhone($('loginPhone').value);
  const pass = $('loginPassword').value;
  loginError('', '');
  if (!phone) return phoneError('login', phoneErrorText());
  if (!pass) return notify('Missing required parameter');
  if (pass.length < 6) return notify('Password must be at least 6 characters');
  setBtnLoading('loginBtn', true, 'Login', 'Logging in...');
  window._pendingLoginSuccess = true;
  try {
    // Tries this region's address, then the other shape for the same region
    // -- see loginAddressCandidates(). The LAST error is the one reported, so
    // a genuinely wrong password still reads as a wrong password.
    if (!(await firebaseReady(8000, 'fbSignIn'))) throw new Error('Sign-in is not available right now. Check your connection and try again.');
    const tries = loginAddressCandidates(phone);
    let email = tries[0], lastErr = null;
    for (const cand of tries) {
      try { await window.fbSignIn(cand, pass); email = cand; lastErr = null; break; }
      catch (e) {
        lastErr = e;
        // Only an "address not known / credentials rejected" answer is worth
        // retrying under a different address. A throttle, a network failure
        // or a disabled account means stop.
        const code = (e && e.code) || '';
        if (code !== 'auth/invalid-credential' && code !== 'auth/wrong-password' && code !== 'auth/user-not-found') break;
      }
    }
    if (lastErr) throw lastErr;
    await handleMemberAuth(window.fbAuth && window.fbAuth.currentUser);
    if (!STATE.user || !STATE.account) { window._pendingLoginSuccess = false; return; }
    // "Remember me" (Main.dc.html) gates the saved-credential store that
    // drives tryAutoSignIn() on the next visit. Unchecked -> nothing is
    // saved, so the login screen asks again next time.
    const remember = $('rememberMe');
    if (!remember || remember.checked) { storeCredentialIfPossible(email, pass, phone); try { localStorage.setItem('potato_remembered', '1'); } catch (_) {} }
    else { try { localStorage.removeItem('potato_remembered'); } catch (_) {} }
  }
  catch (e) {
    window._pendingLoginSuccess = false;
    // Only a wrong phone number has a red line (the owner's screen); every other refusal is the centred notice.
    const code = (e && e.code) || '';
    notify(code === 'auth/invalid-credential' || code === 'auth/wrong-password' ? 'Incorrect phone number or password' : fbErrMsg(e));
    setBtnLoading('loginBtn', false, 'Login');
  }
  } finally {
    window._loginInProgress = false;
    if (!window._suppressAutofillLogin) window._autofillLoginTried = false;
    setBtnLoading('loginBtn', false, 'Login');
  }
};
// ── SIGN UP: phone -> OTP -> password -> confirm password ──
// Rebuilt to the owner's exact mockup: ONE screen -- phone, verification
// phone, password, confirmation, trade PIN and invitation code.
// Owner: "l nolonger need such notifies of in page... all notifies in
// middle not bottom" -- was an inline pink box written into #regError,
// sitting inside the form itself. Routed through the same app-wide
// notify() toast every other screen already uses, instead of a second,
// auth-screen-only error pattern. Kept as its own function (rather than
// replacing every call site with notify() directly) purely so nothing
// else about doRegSendOtp()/doRegister() has to change.
function regError(msg){ if (msg) notify(msg); }
// Android Chrome can hand the code straight to the page when the SMS ends
// with the "@host #code" line the server adds (see otpSmsText() in
// server.js): one tap on the system prompt fills the box. Anywhere else the
// feature test fails and nothing changes -- the member just types it.
var _webOtpAbort = null;
function stopSmsCodeListener(){
  if (_webOtpAbort) { try { _webOtpAbort.abort(); } catch (_) {} _webOtpAbort = null; }
}
window.doRegister = async function(){
  phoneError('reg', '');
  const phone = cleanPhone($('regPhone').value);
  const pass = $('regPassword').value;
  const pass2 = $('regPassword2').value;
  const tradePin = ($('regTradePin').value || '').trim();
  // Referral code box is prefilled from ?ref= (see captureReferralFromUrl)
  // but stays editable -- whatever's in the box at submit time wins,
  // whether that's the link's code, untouched, or something typed by hand.
  // The invitation code is optional.
  const referral = $('regReferral').value.trim();
  if (!phone) return phoneError('reg', phoneErrorText());
  if (!pass || !pass2 || !tradePin) return regError('Missing required parameter');
  if (pass.length < 6) return regError('Password must be at least 6 characters');
  if (pass !== pass2) return regError('The two passwords do not match');
  if (!/^\d{6}$/.test(tradePin)) return regError('Trade Password must be exactly 6 digits');
  // See firebaseReady(): without the sign-in service there is nothing to
  // create the account with, and the code below would only throw at the member.
  if (!(window.fbCreateUser && window.fbAuth)) {
    setBtnLoading('regBtn', true, 'Register', 'Processing...');
    const ready = await firebaseReady(8000, 'fbCreateUser');
    setBtnLoading('regBtn', false, 'Register');
    if (!ready) return regError('Sign-up is not available right now. Check your connection and try again.');
  }
  setBtnLoading('regBtn', true, 'Register', 'Processing...');
  STATE.refCode = referral;
  window._pendingRegPin = tradePin;
  window._pendingRegPhone = phone;
  try {
    const email = phoneToEmail(phone);
    await window.fbCreateUser(email, pass);
    // The browser is asked to save the password only once the sign-up has really finished (finishSignupToLogin), not at this half-way point.
  }
  catch (e) {
    // Owner-reported real bug: a Firebase Auth account can exist with no
    // matching Potato profile -- e.g. an earlier registration attempt whose
    // account-creation step succeeded but the network call to /register
    // never finished (closed tab, lost connection, a crash) -- the classic
    // "ghost account" this file already self-heals ON LOGIN
    // (bootFromNetwork()'s own NOT_FOUND branch). But hitting Register
    // again with that same number always failed at account-creation itself
    // (auth/email-already-in-use) and stopped right here, before that
    // self-heal ever got a chance to run -- a real dead end with no way
    // forward, exactly what was reported.
    //
    // Fixed: try signing in with exactly what was just typed. A wrong
    // password (a genuinely different person's number, or a mistyped one)
    // fails and falls through to the normal error below, unchanged. A
    // correct password succeeds -- which can only mean either a ghost
    // account of THIS same attempt (ordinary sign-in), or an account that
    // was actually already fully registered (registerCurrentUser() below
    // treats server status 'already_done' as success too, so re-registering
    // an already-complete account just lands them in the app instead of
    // erroring). window._pendingRegPin/_pendingRegPhone are already set
    // above with what was just typed, so the normal snow-auth event fires
    // straight into bootFromNetwork()'s existing "just registered in this
    // tab" branch and finishes the profile with the real PIN -- no separate
    // recovery UI needed.
    if (e && e.code === 'auth/email-already-in-use') {
      const retryEmail = phoneToEmail(phone);
      try {
        const sameUid = STATE.user && STATE.user.email === retryEmail ? STATE.user.uid : null;
        await window.fbSignIn(retryEmail, pass);
        storeCredentialIfPossible(retryEmail, pass, phone);
        if (sameUid && STATE.user && STATE.user.uid === sameUid)
          await bootFromNetwork(sameUid);
        return;
      } catch (_) { /* wrong password -- fall through to the real error */ }
    }
    // No Firebase account came out of this attempt, so what was staged for
    // finishing it means nothing. Left set, the next thing to sign in on this
    // tab -- possibly a different member logging in -- would be treated by
    // bootFromNetwork() as a registration that just happened: a needless
    // /register call, and a "Registration successful" toast on a plain login.
    window._pendingRegPin = ''; window._pendingRegPhone = '';
    regError(fbErrMsg(e));
    setBtnLoading('regBtn', false, 'Register');
  }
};
// ── FORGOT PASSWORD: phone -> OTP -> new password, one screen ──
window.doLogout = function(opts){
  if (window._logoutPromise) return window._logoutPromise;
  window._logoutPromise = performMemberLogout(opts).finally(() => { window._logoutPromise = null; });
  return window._logoutPromise;
};
async function performMemberLogout(opts){
  // {auto:true} marks an AUTOMATIC sign-out (the idle-session timeout
  // above) rather than the member tapping Log Out themselves. Owner: "auto
  // login when Google details are put, it fails to login automatically, so
  // l have to press button, why" -- traced to this function: every logout,
  // idle-triggered or not, was permanently setting the SAME
  // potato_relogin_required flag that blocks Chrome's autofill-then-submit
  // convenience (see the big comment lower down) for the rest of the tab's
  // life. That is exactly right for a DELIBERATE "log me out" ("l don't
  // want to use that very account" -- the original owner quote this was
  // built for), but an idle timeout is not the member choosing to leave;
  // it is a security measure they didn't ask for, and permanently adding
  // "now also retype your password every single time for the rest of this
  // tab" on top of it is friction nobody asked for. Only an explicit call
  // sets the persistent suppression now.
  const auto = !!(opts && opts.auto);
  // Clear before asynchronous sign-out, never after a new autofill selection.
  // Keep the phone on automatic expiry so the member can retry.
  const phoneInput = $('loginPhone'), passwordInput = $('loginPassword');
  if (!auto && phoneInput) phoneInput.value = '';
  if (passwordInput) passwordInput.value = '';
  // Revoke the captured session without delaying the UI sign-out. The normal
  // api() epoch guard would intentionally cancel this call during logout.
  const leavingUser = window.fbAuth && window.fbAuth.currentUser;
  if (leavingUser) leavingUser.getIdToken().then(token => {
    // AbortSignal.timeout() does not exist on older phones: a throw here would skip the server logout and leave the token valid for hours.
    const ac = new AbortController(); setTimeout(() => ac.abort(), 5000);
    return fetch(API_BASE + '/auth/session/logout', { method:'POST', headers:{Authorization:'Bearer ' + token}, signal: ac.signal });
  }).catch(() => {});
  _memberSession.clear();
  resetOverlayState();
  window._triedAutoSignIn = true;
  if (!auto) { try { sessionStorage.setItem('potato_relogin_required', '1'); } catch (_) {} }
  // Signing out always lands on Login, even when this visitor last used Sign Up.
  showAuthTab('login');
  stopLiveRefresh();
  // Defense in depth alongside the _openSheetTitle fix on the checkin
  // countdown's own tick: a sign-out that happens to land while Daily
  // Check-in is still open shouldn't leave this ticking into a signed-out
  // session either.
  if (_checkinCountdownTimer) { clearInterval(_checkinCountdownTimer); _checkinCountdownTimer = null; }
  STATE.authEpoch++;
  Object.assign(STATE, { account: null, investments: null, teamStats: null, teamMembers: {1:null,2:null,3:null}, bankAccounts: null, transactions: null, messages: null, salary: null, page: 'home' }); _teamMembersAt = {}; _teamMembersFailed = {};
  clearCachedState();
  // Without this, an explicit logout would immediately silently sign the
  // member right back in on the next boot via tryAutoSignIn() -- Chrome
  // still has the credential, it's just been told not to hand it back
  // without asking first.
  if (credManSupported() && navigator.credentials.preventSilentAccess) {
    try { await navigator.credentials.preventSilentAccess(); } catch (_) {}
  }
  // THE OTHER auto-login path, and the one that was actually biting. Owner:
  // "why is it that when l try to log out the app logs in automatically again
  // because the cached credentials autofills hence triggering auto login yet l
  // don't want to use that very account."
  //
  // preventSilentAccess() above only stops the Credential Management route.
  // The autofill auto-submit below is a SECOND route: landing back on the
  // login screen, Chrome refills the saved phone/password, that fires
  // onAutoFillStart, and maybeAutoSubmit() calls doLogin() -- straight back
  // into the account the member just left. `_autofillLoginTried = false` was
  // making it worse, not better: it RE-ARMED the submitter for exactly the
  // moment Chrome was about to refill.
  //
  // A deliberate sign-out disables auto-submit for the rest of the page
  // session. Nothing re-enables it, on purpose -- after saying "log me out",
  // no amount of refilling should sign anyone in without a tap. Logging back
  // into the same account still takes one tap on Login, with the fields
  // already filled.
  //
  // An AUTOMATIC (idle-timeout) sign-out skips both of these: the member
  // is still right there and did not choose to leave, so Chrome refilling
  // the fields and auto-submitting straight back in is a legitimate,
  // still-interactive re-authentication (the member still had to pick the
  // credential in Chrome's own picker), not the silent bypass this guard
  // exists to stop.
  if (!auto) {
    window._suppressAutofillLogin = true;
    window._autofillLoginTried = true;
  }
  await window.fbSignOut();
}

// ── AUTOFILL AUTO-SUBMIT (Login only) ──
// This is a SEPARATE case from tryAutoSignIn() above. That covers the one
// stored credential, zero-UI scenario; this covers what actually happens
// once Chrome has several saved logins for the site and falls back to its
// own native "Use saved password?" picker (its own bubble, not something
// this page can suppress or drive) -- picking one there fills the fields
// but fires NO input/change event at all, so there was nothing to react to
// and the member had to tap Login manually even though the values were
// already correct on screen. The :-webkit-autofill CSS trick (see the
// #loginPhone/#loginPassword rules in index.html) is the one reliable way
// to get a real DOM event out of that -- toggling a no-op animation on the
// pseudo-class fires 'animationstart', which normal typing never does.
(function(){
  let debounce = null;
  function maybeAutoSubmit(){
    // Set by doLogout(). A member who just signed out must never be signed
    // back in by Chrome refilling the fields it still has saved.
    if (window._suppressAutofillLogin) return;
    if (window._autofillLoginTried) return;
    const phone = $('loginPhone'), pass = $('loginPassword'), btn = $('loginBtn');
    if (!phone || !pass || !btn || btn.disabled) return;
    if (!cleanPhone(phone.value) || !pass.value || window._loginInProgress || window._logoutPromise) return;
    window._autofillLoginTried = true;
    window.doLogin();
  }
  ['input', 'change'].forEach(type => document.addEventListener(type, e => {
    if (e.target.id !== 'loginPhone' && e.target.id !== 'loginPassword') return;
    clearTimeout(debounce);
    // Only picker-filled fields auto-submit; ordinary typing still uses Login.
    if (!e.target.matches(':-webkit-autofill')) return;
    debounce = setTimeout(maybeAutoSubmit, 160);
  }));
  document.addEventListener('animationstart', (e) => {
    if (e.animationName !== 'onAutoFillStart') return;
    if (e.target.id !== 'loginPhone' && e.target.id !== 'loginPassword') return;
    // Chrome's picker fills both fields together but not always in the same
    // tick -- give the second field a moment to land before checking.
    clearTimeout(debounce);
    debounce = setTimeout(maybeAutoSubmit, 160);
  });
})();

// ── BOOT ──
// Owner: "it takes long to load up, l want everything to be loaded up and
// cached after spin loader, as well as the activity checker, should be
// loaded up too." Before this, boot() ran fire-and-forget from module load
// with nothing ever awaiting it -- both enterApp()'s cache-hit path and
// bootFromNetwork() dropped the loading screen with zero dependency on
// settings/products actually being ready, so the announcement dialog could
// silently no-op (STATE.settings still empty) and the activity ticker
// always did its own separate fetch-after-paint, showing a blank/loading
// strip on Home for a beat. Now the activity feed is prefetched here too,
// and every caller awaits this same promise (capped by withTimeout, see
// below) before the spinner ever comes down, so nothing pops in afterward.
// ── WHAT THE LOADING SCREEN IS ALLOWED TO WAIT FOR ──
// Owner: "l also need faster loading."
//
// MEASURED (test-boot-speed.py, against the real built app): the loader used
// to wait on about 1.3 MB of JSON, and 900 KB of it was /public/potato-images
// -- SEVEN admin-uploaded images, base64'd inside one reply. Of those seven,
// exactly two can appear on the first screen (Home's spin banner and the
// profile GIF); the rest belong to screens nobody has opened yet -- the
// Download backdrop, the manual-payment logos, the announcement picture, the
// Referral banner, the Account logo, the two sign-in backdrops.
//
// So the three heavy replies are fired at the same instant as everything
// else -- they are NOT delayed, and nothing is fetched lazily later -- but
// the app stops BLOCKING on them. They land underneath and repaint what is
// on screen.
//
// _artPromise is that work, exposed so the one thing that genuinely needs a
// picture before it appears (the announcement dialog) can wait for it
// instead of opening blank.
// The loading screen stays for at least LOADER_MIN_MS from the moment the page began (owner: "let it take
// about 3 seconds, then open the page"). Everything that used to hide it immediately goes through here; the
// app is built underneath while it waits, and the pictures start loading straight away.
var LOADER_MIN_MS = 2500, _ldTimer = null;
function hideLoadingScreen(){
  const ls = $('loadingScreen'); if (!ls) return;
  try { startArtwork(); } catch (_) {}
  const began = Number(window._potatoLoaderStart) || 0;
  const minMs = typeof window._potatoLoaderMinMs === 'number' ? window._potatoLoaderMinMs : LOADER_MIN_MS;
  const wait = began ? Math.max(0, minMs - (Date.now() - began)) : 0;
  if (_ldTimer) { clearTimeout(_ldTimer); _ldTimer = null; }
  const finish = () => { if (window._potatoLoaderProgress) window._potatoLoaderProgress(100); ls.style.display = 'none'; };
  if (!wait) { finish(); return; }
  _ldTimer = setTimeout(() => { _ldTimer = null; finish(); }, wait);
}
function showLoadingScreen(){
  if (_ldTimer) { clearTimeout(_ldTimer); _ldTimer = null; }
  $('loadingScreen').style.display = 'flex';
  if (window._potatoLoaderRestart) window._potatoLoaderRestart();
}
var _artPromise = null, _artLanded = false, _annWaiting = false;
function startArtwork(){
  if (_artPromise) return _artPromise;
  _artPromise = Promise.all([ api('/public/announcement-image'), api('/public/potato-images') ])
    .then(([ai, ci]) => { applyBootArtwork(ai, ci); })
    .catch(() => {})
    .then(() => { _artLanded = true; });
  return _artPromise;
}
// Start the pictures the moment the loading screen comes down, wherever that
// happens (a signed-in app, the login screen, an error), instead of at 14 call sites.
(function(){
  const ls = document.getElementById('loadingScreen');
  if (!ls || !window.MutationObserver) return;
  new MutationObserver(() => { if (ls.style.display === 'none') startArtwork(); }).observe(ls, { attributes: true, attributeFilter: ['style'] });
})();
async function boot(){
  // Fired together so Home receives its first activity rows before it paints.
  // The server caches completed activity; this is deliberately not generated
  // client-side so the ticker never invents financial events.
  const pSettings = api('/public/settings'), pProducts = api('/public/products');
  const pBanner = api('/public/banner');
  // The pictures (several megabytes of base64) are fetched only once the
  // loading screen has gone, so they never compete with the account request
  // for a slow mobile connection (see startArtwork()).
  setTimeout(startArtwork, 8000);
  // Only the settings are waited for. The asset list and the Home banner carry
  // pictures (megabytes of base64) and used to hold the loading screen until
  // they had fully downloaded; they now land underneath the app and repaint
  // the pages that show them.
  const s = await pSettings;
  pProducts.then(p => {
    if (p.status === 'success') { STATE.products = p.products; _productsLoadFailed = false; }
    else if (!STATE.products) _productsLoadFailed = true;   // Home then says it could not load, not "no products"
    repaintAfterBootData();
  }).catch(() => {});
  pBanner.then(b => {
    STATE.homeBanner = (b.status === 'success' && b.image) ? b.image : null;
    repaintAfterBootData();
  }).catch(() => {});
  STATE.settings = s.status === 'success' ? s.settings : {};
  // The region that owns this hostname, so the landing screen, Sign Up and
  // the product list already read in the right currency before anybody has
  // signed in. Replaced by the MEMBER's own region the moment /account
  // lands -- see enterApp().
  // regionCount lives on STATE itself, NOT inside STATE.settings: that
  // object is exactly what the server sent, and writing into it threw
  // outright on a reply whose `settings` key was missing (caught by
  // test-cache-quota.py's own fixture, which sends one) -- taking the whole
  // boot down over a number used only to word a login error.
  // regionCount BEFORE applyRegion: applyRegion repaints the sign-in
  // screen's country line, and that line only appears when more than one
  // country exists -- set the other way round it paints with the count still
  // undefined and the line stays hidden on the very load that needed it.
  if (s.status === 'success') { applyRegion(); }
  // The name has just arrived; paint it into the static markup and the tab
  // title. Three call sites in all -- here, the auth-screen prefetch, and the
  // cached instant-boot path -- because each is a way STATE.settings gets
  // filled, and whichever one wins the race has to be the one that applies it.
  applyBrandName();
}
// Home and Income show the asset list and the banner; repaint whichever is
// on screen when either lands after the app has opened.
function repaintAfterBootData(){
  try {
    if (!$('app') || $('app').style.display === 'none') return;
    if (STATE.page === 'home') paintHome();
    else if (STATE.page === 'assets') paintAssets();
  } catch (_) {}
}
// Everything the first screen does not need. Called when the three heavy
// replies land -- which may be before or after the app becomes visible, so
// it repaints whatever is currently on screen rather than assuming.
function applyBootArtwork(ai, ci){
  // `ai` = the announcement picture; `ci` = the other admin images.
  STATE.announcementImage = (ai && ai.status === 'success' && ai.image) ? ai.image : null;
  STATE.brandLogo = (ci.status === 'success' && ci.logo) ? ci.logo : null;
  STATE.profileLogo = (ci.status === 'success' && ci.profilelogo) ? ci.profilelogo : null;
  syncBrandLogoImages();
  // Home's banner carousel, slides 2 and 3 (slide 1 is STATE.homeBanner,
  // fetched separately above -- it predates the carousel). Filtered to
  // whichever are actually set, so 1 or 2 slides render fine too, not only 3.
  STATE.homeSlides2n3 = (ci.status === 'success' ? [ci.banner2, ci.banner3] : []).filter(Boolean);
  STATE.promoBanner = (ci.status === 'success' && ci.promobanner) ? ci.promobanner : null;
  STATE.logo = (ci.status === 'success' && ci.logo) ? ci.logo : null;
  STATE.teamBanner = (ci.status === 'success' && ci.teambanner) ? ci.teambanner : null;
  STATE.myBanner = (ci.status === 'success' && ci.mybanner) ? ci.mybanner : null;
  STATE.aboutBanner = (ci.status === 'success' && ci.aboutbanner) ? ci.aboutbanner : null;
  STATE.aboutLogo = (ci.status === 'success' && ci.aboutlogo) ? ci.aboutlogo : null;
  // The Login / Sign Up backdrop (single full-bleed photo -- see
  // applyAuthBackgrounds()'s own comment on why there is only one now).
  STATE.authHeroImage = (ci.status === 'success' && ci.authhero) ? ci.authhero : null;
  STATE.authLogoImage = (ci.status === 'success' && ci.authlogo) ? ci.authlogo : null;
  // Transparent cut-out icons uploaded in the admin panel (Banners > Icons): { ordergift, downloadapp, ... }, each a PNG data URL or null.
  STATE.icons = (ci.status === 'success' && ci.icons && typeof ci.icons === 'object') ? ci.icons : {};
  applyAuthLogo();
  applyAuthTagline();
  applyAuthBackgrounds();
  // The tab pictures and the two floating pictures arrive here, usually after the app is already showing: paint them now, not on the next tab tap.
  try { updateNavIcons(); } catch (_) {}
  // Repaint Home for the banner and animated profile artwork. The brand-logo
  // nodes are patched in place above; other art consumers render on open.
  try { if (STATE.page === 'home' && $('app') && $('app').style.display !== 'none') paintHome(); } catch (_) {}
}
// The brand logo is fetched with the other large artwork in the background,
// so Auth, Home, or Account may already be visible when it arrives. Patch the
// image elements in place instead of rebuilding a page just for its logo.
function syncBrandLogoImages(){
  const logo = STATE.brandLogo || '';
  const home = document.getElementById('homeBrandLogo');
  if (home) {
    if (logo) {
      if (home.getAttribute('src') !== logo) home.src = logo;
      home.style.display = 'block';
    } else {
      home.removeAttribute('src');
      home.style.display = 'none';
    }
  }
  const account = document.getElementById('accountBrandLogo');
  const fallback = document.getElementById('accountBrandFallback');
  if (account) {
    if (logo) {
      if (account.getAttribute('src') !== logo) account.src = logo;
      account.style.display = 'block';
      if (fallback) fallback.style.display = 'none';
    } else {
      account.removeAttribute('src');
      account.style.display = 'none';
      if (fallback) fallback.style.display = 'flex';
    }
  }
  document.querySelectorAll('[data-auth-brand-logo]').forEach(img => {
    const fallback = document.getElementById(img.getAttribute('data-auth-fallback'));
    if (logo) {
      if (img.getAttribute('src') !== logo) img.src = logo;
      img.style.display = 'block';
      if (fallback) fallback.style.display = 'none';
    } else {
      img.removeAttribute('src');
      img.style.display = 'none';
      if (fallback) fallback.style.display = 'flex';
    }
  });
}
function applyAuthBackgrounds(){
  const s = STATE.settings || {};
  const root = document.documentElement;
  // An unset slot yields `none`, so the banner falls back to the brand gradient. The quotes matter for a data URL with odd characters.
  root.style.setProperty('--auth-hero-img', STATE.authHeroImage ? 'url("' + String(STATE.authHeroImage).replace(/"/g, '\\"') + '")' : 'none');
  // The banner is shown whole, in its own shape (nothing cropped): the box takes the picture's own proportions.
  if (STATE.authHeroImage) {
    const probe = new Image();
    probe.onload = () => { if (probe.naturalWidth && probe.naturalHeight) root.style.setProperty('--auth-hero-ar', probe.naturalWidth + ' / ' + probe.naturalHeight); };
    probe.src = STATE.authHeroImage;
  } else root.style.removeProperty('--auth-hero-ar');
  // The bottom-of-the-banner fade (.auth-hero::after) is switched on only
  // when there is a banner to fade. Owner: "there should be like whites or
  // color bleeding into the image of banner uploaded from admin panel." With
  // no upload the hero is the plain brand gradient, and fading that to white
  // would restyle a screen he has already signed off on, so the class -- not
  // the CSS -- is what decides.
  const hero = $('authHero');
  if (hero) hero.classList.toggle('has-bg', !!STATE.authHeroImage);
}
// The round picture above the Log In / Sign Up forms: the admin's circle logo, else the app logo, else an empty white circle.
function applyAuthLogo(){
  const el = $('authLogoImg'); if (!el) return;
  const img = STATE.authLogoImage || STATE.brandLogo || '';
  el.style.backgroundImage = img ? 'url("' + String(img).replace(/"/g, '\\"') + '")' : 'none';
}
function applyAuthTagline(){
  const el = $('authTagline');
  if (!el) return;
  const tag = (STATE.settings && STATE.settings.brandTagline) || '';
  el.textContent = tag;
  el.style.display = tag ? '' : 'none';
}
// Bounds how long the loading screen will wait on boot() -- a slow/stuck
// settings call must never strand a member on the spinner
// forever; past this cap the app proceeds with whatever boot() has (or
// hasn't) filled in yet, same as before this change.
// The settings may be waited for at several points of a start-up (the opening gate, then entering the app). They share ONE budget measured
// from the moment the page began, so a slow connection waits for them once, not once per step.
function waitForBootSettings(ms){
  const began = Number(window._potatoLoaderStart) || Date.now();
  return withTimeout(_bootPromise, Math.max(300, (ms || 6000) - (Date.now() - began)));
}
function withTimeout(promise, ms){
  return Promise.race([ promise, new Promise(resolve => setTimeout(resolve, ms)) ]);
}
function captureReferralFromUrl(){
  try {
    // Referral links are now shared as ".../#pages/register/?ref=CODE"
    // (Round 116) -- everything after "#" is the URL fragment, which
    // browsers never send to the server and never populate
    // location.search with, so that form's ref code has to be pulled out
    // of location.hash by hand. The original plain ".../?ref=CODE" query
    // string (checked first, since it's the cheaper/more common case) still
    // works too, so a link shared before this round keeps working exactly
    // as it always has.
    const search = new URLSearchParams(location.search);
    let ref = search.get('ref');
    if (!ref && location.hash) {
      const qIdx = location.hash.indexOf('?');
      if (qIdx !== -1) {
        const hp = new URLSearchParams(location.hash.slice(qIdx + 1));
        // The CURRENT shared form: <random address>/#/inviteRegister?invitecode=<code> (any capital letters in the name are accepted).
        ref = hp.get('invitecode') || hp.get('inviteCode') || hp.get('ref');
      }
    }
    // <origin>/refCode=<code>, read straight off the path. Checked after the
    // two forms above only because they're cheaper to test, not because
    // either older form is the fallback -- every one of them is kept working
    // on purpose: links already sent to real people are out of our hands and
    // must not start failing.
    if (!ref) {
      const m = /\/refCode=([^/?#]+)/.exec(location.pathname);
      if (m) { try { ref = decodeURIComponent(m[1]); } catch (_) { ref = m[1]; } }
    }
    // The CURRENT shared form (owner: "l wanted my link to look like
    // .../share.html?v=<timestamp>&code=<code>") -- share.html is a literal
    // copy of this same file (see build-core.js), so it boots the exact same
    // app and reaches this same function; only the query param name differs
    // from the original ".../?ref=" form above. `v` is never read here --
    // it exists purely so every generated link is unique (see paintNetwork()'s
    // own comment on why).
    if (!ref) ref = search.get('code');
    if (!ref) return;
    STATE.refCode = ref;
    // Referral codes are case-sensitive on the server (exact-match lookup,
    // e.g. "QcNBht") -- must NOT be uppercased/lowercased here or a real
    // code silently stops matching.
    $('regReferral').value = ref;
    showAuthTab('register');
  } catch (_) {}
}
// Pulls the public settings while the member is still on the auth screen (brand name and region for the Sign Up form). Failure is silent.
async function loadAuthSettings(){
  try {
    const s = await api('/public/settings');
    if (s && s.status === 'success') { STATE.settings = s.settings || {}; applyRegion(); applyBrandName(); }
  } catch (_) {}
  updateReferralFieldHint();
}
// Registration just drops its OTP step when the toggle is off (a brand-new
// account has no existing identity to protect) -- see doRegister()'s own
// branch. Saving a payout account is also unchanged apart from the code step
// disappearing -- see submitWallet(). Forgot Password is the exception: it
// hands an existing account to whoever asks, so it keeps requesting a code
// whatever the toggle says.
// Says out loud whether the box must be filled, instead of leaving members
// to discover it by being rejected. Runs whenever the auth screen paints.
function updateReferralFieldHint(){
  const input = $('regReferral');
  if (input) input.placeholder = 'Invitation Code';
}



// ── AUTH STATE HANDLER ──
var _memberAuthTask = null, _memberAuthTaskUser = null;
function handleMemberAuth(user){
  if (_memberAuthTask && _memberAuthTaskUser === user) return _memberAuthTask;
  _memberAuthTaskUser = user;
  const task = processMemberAuth(user);
  _memberAuthTask = task;
  task.finally(() => { if (_memberAuthTask === task) _memberAuthTask = null; }).catch(() => {});
  return task;
}
function onMemberAuth(user){
  handleMemberAuth(user).catch(() => {
    notify('Could not open your account. Please try logging in again.');
    hideLoadingScreen();
    $('authScreen').style.display = '';
    setBtnLoading('loginBtn', false, 'Login');
  });
}
window.addEventListener('snow-auth', ev => onMemberAuth(ev.detail));
// The sign-in script announces who is signed in (or nobody) once, as soon as the page is parsed. This code is unpacked a little
// later, and on a slow or busy phone it can be MORE than a little later: then that announcement happened before anyone was listening
// and nothing ever took the loading screen down. If it already fired, take it from the sign-in script directly.
if (window._potatoAuthFired && window.fbAuth) onMemberAuth(window.fbAuth.currentUser);
async function processMemberAuth(user){
  // Ignore repeated notifications only after the account is actually open.
  // Failed account setup must remain retryable for the same Firebase uid.
  if (user && STATE.user && user.uid === STATE.user.uid && STATE.account && $('app').style.display !== 'none') return;
  // Also bump here (not just doLogout()) -- this is what actually fires when
  // a DIFFERENT user logs in right after, and it's the guard that matters if
  // Firebase's own token expiry/refresh ever drops us out without doLogout()
  // having run first.
  STATE.authEpoch++;
  STATE.user = user;
  if (user) {
    try {
      const token = await user.getIdTokenResult();
      if (STATE.user !== user) return;
      const started = Number(token.claims.auth_time) * 1000;
      if (!_memberSession.begin(user.uid + ':' + started, started, false)) return;
      try { sessionStorage.removeItem('potato_relogin_required'); } catch (_) {}
    } catch (_) {
      notify('Could not verify your login session. Please try again.');
      await window.doLogout({ auto: true }); return;
    }
  } else { _memberSession.clear(); clearCachedState(); }
  if (STATE.user !== user) return;
  if (!user) {
    window._pendingLoginSuccess = false;
    // Only worth trying once, on the very first "nobody's signed in" we see
    // this page load (a real boot) -- not after an in-session doLogout(),
    // which already called preventSilentAccess() specifically so this
    // wouldn't immediately hand the same member right back in.
    // Returning to login never silently reuses a stored password.
    window._triedAutoSignIn = true;
    hideLoadingScreen();
    $('app').style.display = 'none';
    $('authScreen').style.display = '';
    setBtnLoading('loginBtn', false, 'Login');
    setBtnLoading('regBtn', false, 'Register');
    // Sign Up needs to know whether a referral code is required BEFORE
    // anyone submits, and boot() (which normally loads settings) only runs
    // after sign-in. Without this the screen would fall back to "required"
    // and the very first account could never be created.
    loadAuthSettings();
    return;
  }
  // A sign-up in progress stays on the Sign Up page (its button reads "Signing Up...") until the member lands on Login: the startup loader is
  // only for opening the app, never for registering.
  // A login the member just typed does not show it either: Login stays (button "Logging in...") until the app is ready, then Home opens.
  if (!window._pendingRegPhone && !window._pendingLoginSuccess) {
    $('authScreen').style.display = 'none';
    showLoadingScreen();
  }
  await enterApp();
}
// Real feature: a returning member used to sit through the loading screen
// on EVERY app open, even though nothing about their account usually
// changed since last time. Owner (relaying a friend's advice on instant-
// loading sites): "it loads basic ui features as backend loads user data
// through api... no delays." The app already does this cache-first pattern
// per-sheet (Withdraw, Records); this extends it to the
// boot sequence itself using a small persisted snapshot (localStorage
// survives a full page reload, unlike STATE, which doesn't) -- a RETURNING
// visit paints instantly from last-known data with zero network wait, then
// quietly refreshes in the background. A first-ever login on a device has
// nothing to paint from yet, so it still goes through the one real,
// unavoidable network round trip (bootFromNetwork, unchanged from before).
var CACHED_STATE_KEY = 'snow_state_cache';
try { localStorage.removeItem(CACHED_STATE_KEY); } catch (_) {}
function loadCachedState(uid){
  if (!uid) return null;
  try {
    const raw = sessionStorage.getItem(CACHED_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Never trust a snapshot saved for a DIFFERENT account -- a shared
    // device switching users must never paint one member's cached balance
    // into another's session, same reasoning as STATE.authEpoch's own
    // cross-session guard.
    if (!parsed || parsed.uid !== uid) return null;
    return parsed;
  } catch (_) { return null; }
}
// Product photos are stored as data: URLs inside STATE.products, and at the
// 1200x900 frame the admin now saves them at, twelve of them is a few
// megabytes on its own -- enough to blow localStorage's ~5 MB quota. The
// setItem below is in a try/catch, so that failure is SILENT: the snapshot
// simply stops being written and every boot goes back to a cold network
// wait, with nothing on screen to say why. So build the snapshot once, and
// if it will not fit, save it again with the image bytes stripped out --
// everything else here (balance, plans, team, transactions, minimums) is
// what the instant-boot path actually paints, and the photos refill from
// the live /products fetch a moment later behind the skeleton cards.
function _cachedStateBlob(uid, withImages){
  const products = withImages ? STATE.products
    : (STATE.products || []).map(p => Object.assign({}, p, { image: '' }));
  return JSON.stringify({
    uid, account: STATE.account, investments: STATE.investments, teamStats: STATE.teamStats,
    bankAccounts: STATE.bankAccounts, transactions: STATE.transactions, transactionsTruncated: STATE.transactionsTruncated,
    products, settings: STATE.settings,
  });
}
function saveCachedState(uid){
  try {
    sessionStorage.setItem(CACHED_STATE_KEY, _cachedStateBlob(uid, true));
    return;
  } catch (_) {
    try { sessionStorage.setItem(CACHED_STATE_KEY, _cachedStateBlob(uid, false)); } catch (_2) {}
    return;
  }
}
function clearCachedState(){
  try { sessionStorage.removeItem(CACHED_STATE_KEY); } catch (_) {}
}
async function enterApp(){
  // Belt-and-suspenders alongside the isScrollLockOverlayOpen() fix above:
  // a fresh app entry (a login, or a resumed session on page load) can
  // never legitimately have a real overlay open yet, so there is nothing
  // to lose by unconditionally clearing any scroll lock a PREVIOUS
  // session's SPA-level logout left stuck (the exact "freezes, no
  // scrolling" report this round root-caused).
  unlockBodyScroll();
  const uid = STATE.user && STATE.user.uid;
  const cached = loadCachedState(uid);
  if (!cached) return bootFromNetwork(uid);
  STATE.account = cached.account; STATE.investments = cached.investments;
  STATE.teamStats = cached.teamStats; STATE.bankAccounts = cached.bankAccounts;
  STATE.transactions = cached.transactions; STATE.transactionsTruncated = !!cached.transactionsTruncated;
  // subagent-audit-caught: products/settings used to never be part of this
  // cache-hit restore, so My Products showed "0 plans" and Deposit/
  // Withdraw's min-amount hints showed "UGX 0" until boot()'s own live
  // fetch happened to land. `||` prefers boot() if it already won the race
  // by this point (STATE.products/settings default to null until it
  // resolves) -- never overwrite genuinely fresh live data with the
  // possibly-stale cached copy, only fill the gap while waiting for it.
  STATE.products = STATE.products || cached.products;
  STATE.settings = STATE.settings || cached.settings;
  applyBrandName();
  // subagent-audit-caught real regression: Round 57 added a wait on
  // _bootPromise right here to stop the announcement dialog/activity
  // ticker popping in after the spinner -- but THIS is the cache-hit
  // "instant boot" path, which has no spinner to gate in the first place
  // (Round 46 built it specifically so a returning visit paints with zero
  // network wait). Making it block here reintroduced the exact "takes long
  // to load" complaint for the common case (a returning member) instead of
  // fixing it. The wait now happens narrowly in showPage()'s 'home' branch,
  // just before maybeShowAnnouncement() -- gates only the announcement's
  // own appearance, not this instant paint.
  hideLoadingScreen();
  $('authScreen').style.display = 'none';
  $('app').style.display = '';
  showPage(STATE.page || 'home');
  maybeAnnounceOnEntry();
  if (window._pendingLoginSuccess) { window._pendingLoginSuccess = false; }   // a typed login opens Home with no "Login successful" notice (owner)
  refreshAppDataInBackground(uid);
}
// Shared by both bootFromNetwork() branches below -- retries /register,
// which self-heals a missing profile doc and is a safe no-op if already
// done. A typo'd referral code (now that it's a hand-editable box, not just
// a silent value from ?ref=) must NOT sign the member back out -- their
// Firebase auth account already exists at this point with no profile doc
// yet, so a sign-out here would strand them: retrying register later hits
// "email already in use" and they're locked out for good (the exact
// ghost-account trap Round-something-earlier already fixed once). Retry
// once with the referral dropped instead; everything else (PIN, welcome
// bonus) still goes through.
async function registerCurrentUser(pin, phone){
  let reg = await post('/register', { referralCode: STATE.refCode || '', pin: pin || '', phone: phone || '' });
  // The invitation code is optional: a wrong one is dropped and the registration carries on without an upline.
  if (reg.status === 'error' && reg.code === 'BAD_REFERRAL' && STATE.refCode) {
    notify(reg.message || 'That referral code is invalid. Continuing without it.');
    STATE.refCode = '';
    reg = await post('/register', { referralCode: '', pin: pin || '', phone: phone || '' });
  }
  return reg;
}
// A member signed in to an account whose sign-up never finished (the Firebase
// account exists but the profile was never completed -- classically a mistyped
// referral code, or the app closing mid-sign-up). Login cannot finish it: with
// OTP on it needs a fresh verified code, and the referral code has to be
// right. Before, they were left on the Log In screen with "Please verify your
// phone number first." and no way to tell what to do. Now: say what happened,
// sign them out cleanly, and open Sign Up with their number already filled in.
// Re-submitting it takes doRegister()'s existing "email already in use" path,
// which signs in and finishes this same registration.
var SIGNUP_UNFINISHED_CODES = ['BAD_REFERRAL', 'BAD_REFERRAL_REGION'];
async function abandonUnfinishedSignup(reg){
  hideLoadingScreen();
  if (SIGNUP_UNFINISHED_CODES.indexOf(reg.code) === -1) {
    notify(reg.message || 'Could not complete registration');
    $('authScreen').style.display = '';
    setBtnLoading('regBtn', false, 'Register');
    return;
  }
  const local = localDigits(String((STATE.user && STATE.user.email) || '').split('@')[0]);
  window._pendingLoginSuccess = false;
  await window.fbSignOut();
  $('authScreen').style.display = '';
  showAuthTab('register');
  if (local && $('regPhone')) $('regPhone').value = '0' + local;
  if ($('regReferral') && STATE.refCode) { $('regReferral').value = STATE.refCode; paSyncInvite(); }
  setBtnLoading('regBtn', false, 'Register');
  notify((reg.message || 'Your sign-up was not finished.') + ' Complete your sign-up below.');
}
async function finishSignupToLogin(typedPhone){
  window._pendingLoginSuccess = false;
  window._pendingRegPin = ''; window._pendingRegPhone = '';
  // What was typed is taken BEFORE the boxes are emptied: the browser is offered the new number and password to save (Google Password Manager), so
  // the next Login is one tap on the saved entry.
  const savedPass = ($('regPassword') || {}).value || '';
  await window.doLogout();
  hideLoadingScreen();
  $('authScreen').style.display = '';
  setBtnLoading('regBtn', false, 'Register');
  showAuthTab('login');
  if (savedPass) storeCredentialIfPossible(null, savedPass, typedPhone);
  // The Sign Up boxes are emptied a moment AFTER that pane is hidden, so the browser sees the form leave with its values filled in.
  setTimeout(() => { ['regPhone', 'regPassword', 'regPassword2', 'regTradePin'].forEach(id => { const el = $(id); if (el) el.value = ''; }); }, 1500);
  const ph = $('loginPhone'), pw = $('loginPassword');
  if (ph) ph.value = typedPhone;
  if (pw) pw.value = '';
  notify('Registration successful!', () => { const el = $('loginPassword'); if (el) { try { el.focus(); } catch (_) {} } });
}
async function bootFromNetwork(uid){
  // _pendingRegPhone identifies a signup started in this tab; it works
  // without an OTP ticket.
  const signupFlow = !!window._pendingRegPhone;
  const regTypedPhone = signupFlow ? (($('regPhone') || {}).value || '') : '';
  let r;
  // subagent-audit-caught: a brand-new registration always paid for a
  // GUARANTEED-to-fail /account call first (the profile doc genuinely
  // doesn't exist yet the instant after Firebase account creation), THEN
  // /register, THEN a second /account -- three sequential network round
  // trips before the real prefetch even started, on every single signup --
  // owner: "the startup loader should load all data, and should be fast...
  // no taking long." doRegister() sets _pendingRegPin/_pendingRegPhone
  // right before creating the Firebase account, so their presence here
  // reliably means this boot is for a registration that JUST happened in
  // THIS tab -- skip straight to /register instead of wasting a call
  // already known to fail. Captured into locals and cleared immediately so
  // a later re-login in the same tab session (no page reload) never
  // wrongly takes this shortcut again.
  if (window._pendingRegPhone) {
    const pin = window._pendingRegPin, phone = window._pendingRegPhone;
    const reg = await registerCurrentUser(pin, phone);
    // The session changed while /register was in flight (a second sign-in
    // event for the same account, or a logout): whatever replaced it owns the
    // screen now. Treating this as a failure would sign the member out of the
    // very session that is opening.
    if (reg.stale || !STATE.user || STATE.user.uid !== uid) return;
    if (reg.status !== 'success' && reg.status !== 'already_done') {
      hideLoadingScreen();
      notify(reg.message || 'Could not complete registration');
      $('authScreen').style.display = '';
      setBtnLoading('regBtn', false, 'Register');
      return;
    }
    window._pendingRegPin = ''; window._pendingRegPhone = '';
    // A new account goes back to Login (below), so its account is not fetched: that was one more round trip for nothing.
    if (signupFlow) { await finishSignupToLogin(regTypedPhone); return; }
    r = await api('/account');
  } else {
    r = await api('/account', { timeoutMs: 10000 });
    if (r.stale || !STATE.user || STATE.user.uid !== uid) return;
    if (r.status === 'error' && (r.code === 'NOT_FOUND' || r.code === 'REGISTRATION_REQUIRED' || r.message === 'User not found')) {
      // Ghost account (Firebase user exists, our profile never finished in
      // an earlier session -- e.g. a crash/reload between account creation
      // and /register finishing) -- self-heal the same way.
      const reg = await registerCurrentUser(window._pendingRegPin || '', window._pendingRegPhone || '');
      if (reg.stale || !STATE.user || STATE.user.uid !== uid) return;
      if (reg.status !== 'success' && reg.status !== 'already_done') {
        await abandonUnfinishedSignup(reg);
        return;
      }
      r = await api('/account');
    }
  }
  // Same reasoning as above for the account fetch itself.
  if (r.stale || !STATE.user || STATE.user.uid !== uid) return;
  if (r.status === 'error' && !window._pendingLoginSuccess && ((!r.code && /timed out|Could not reach|Too many requests/i.test(r.message || '')) || r.code === 'AUTH_UNAVAILABLE' || r.code === 'SERVER_ERROR')) {
    // Re-opening the app on a slow or dropped connection, a busy server (429) or a store outage (503) is not a reason to end
    // the login: show the login screen with the message and keep the session.
    // (A login the member just typed still signs out below, so a retry is clean.)
    hideLoadingScreen();
    $('authScreen').style.display = '';
    notify('Could not reach the server. Check your connection and try again.');
    return;
  }
  if (r.status === 'error') {
    hideLoadingScreen();
    if (r.code === 'BANNED') { notify(r.message); await window.fbSignOut(); return; }
    notify(r.message || 'Could not load your account');
    await window.fbSignOut();
    return;
  }
  // A brand-new account does not go straight into the app: the member lands on Login with the number
  // already filled in, so only the password has to be typed.
  if (signupFlow) { await finishSignupToLogin(regTypedPhone); return; }
  STATE.account = r.account;
  // The member's OWN region wins over the hostname's: somebody who signed
  // up on the Kenyan site and then opens the Ugandan one still sees Kenyan
  // shillings, Kenyan prices and their own number rules, because that is
  // what the server will charge and pay them in.
  applyRegion(r.region);
  // Prefetch everything every tab needs, all in parallel, before the loading
  // screen ever comes down -- so the very first tab switch (and opening
  // Withdraw/Withdrawal Accounts/Records) is already cache-first-instant
  // instead of only becoming fast after a first visit to each one. This adds
  // no real time over the account fetch alone since it's parallel, not
  // sequential -- one network round trip's worth of latency, not four.
  // Only what the shell itself needs is awaited: the account (fetched above)
  // and _bootPromise, which carries settings -- Home cannot paint its
  // announcement or tagline without them. The per-screen datasets are fired
  // here and allowed to land underneath.
  //
  // This is why the skeleton loaders were never seen. Awaiting them all meant
  // that by the time the app became visible, every dataset a skeleton covers
  // was already in memory, so the "nothing cached yet" branch could not fire
  // on any screen.
  await waitForBootSettings(6000);
  hideLoadingScreen();
  $('authScreen').style.display = 'none';
  $('app').style.display = '';
  showPage(STATE.page || 'home');
  maybeAnnounceOnEntry();
  if (signupFlow) { window._pendingLoginSuccess = false; notify('Registration successful ✓'); }
  else if (window._pendingLoginSuccess) { window._pendingLoginSuccess = false; }   // no "Login successful" notice (owner)
  // The invite-address pool, fetched behind the app rather than in front of
  // it, so even the FIRST open of the Referral screen has an address ready
  // and costs no round trip. Tiny (a few hostnames), un-awaited, and a
  // failure is silent -- shareOrigin() falls back to the current origin.
  refreshShareHost().catch(() => {});
  // Still prefetched, just not in front of the member. Each screen's own
  // render() re-fetches what it needs anyway, so whichever tab is open
  // repaints itself when its data arrives -- nothing here has to push to it.
  Promise.all([
    api('/investments'), api('/team/stats'), api('/bank/list'), api('/transactions')
  ]).then(([invR, teamR, bankR, txR]) => {
    // Signed out, or switched account, while these were in flight.
    if (!STATE.user || STATE.user.uid !== uid) return;
    if (invR.status === 'success') STATE.investments = invR.investments;
    if (teamR.status === 'success') STATE.teamStats = teamR;
    if (bankR.status === 'success') STATE.bankAccounts = bankR.accounts;
    if (txR.status === 'success') { STATE.transactions = txR.transactions; STATE.transactionsTruncated = !!txR.truncated; }
    saveCachedState(uid);
  }).catch(() => {});
}
// Runs right after painting instantly from cache -- reconciles with the
// real server state silently, no spinner, no repaint flicker (only patches
// the live numbers already on screen if Home happens to be open, matching
// renderHome()'s own patchHomeBalances() pattern rather than a full
// re-render). Errors here are non-fatal: the member is already looking at
// real (if slightly stale) data, so a failed background refresh just means
// try again on the next open, never a forced sign-out.
async function refreshAppDataInBackground(uid){
  try {
    const [accR, invR, teamR, bankR, txR] = await Promise.all([
      api('/account'), api('/investments'), api('/team/stats'), api('/bank/list'), api('/transactions')
    ]);
    // Signed out, or switched to a different account, while this was in
    // flight -- api()'s own authEpoch guard already turns each response
    // into a discarded {stale:true} error in that case, but bail out
    // explicitly too so a stale snapshot never gets written back to disk.
    if (!STATE.user || STATE.user.uid !== uid) return;
    if (accR.status === 'error' && accR.code === 'BANNED') { notify(accR.message); await window.fbSignOut(); return; }
    if (accR.status === 'success') STATE.account = accR.account;
    if (invR.status === 'success') STATE.investments = invR.investments;
    if (teamR.status === 'success') STATE.teamStats = teamR;
    if (bankR.status === 'success') STATE.bankAccounts = bankR.accounts;
    if (txR.status === 'success') { STATE.transactions = txR.transactions; STATE.transactionsTruncated = !!txR.truncated; }
    saveCachedState(uid);
    if (STATE.page === 'home') { patchHomeBalances(); paintMyAssetsInner(); }
  } catch (_) {}
}

// ── NAV ──
// The six bottom-nav icons are the owner's own artwork (see CLAUDE.md's
// "Icon assets" note), shipped as PNGs in user/ rather than inline SVG --
// the inactive state is greyed with a CSS filter, exactly as the mockups do
// it, so one file covers both states.
// 4 tabs now (owner's mockups), inline SVG (ICONS.*) instead of the raster
// PNGs the other 5 sibling projects' fork all inherited -- 'assets'/
// 'network' are the two NEW consolidated tabs (see renderAssets()/
// renderNetwork()); 'catalog'/'products'/'referral'/'team' stay valid,
// still-dispatchable STATE.page values (Account's own rows still route to
// some of them as an interim measure) even though nothing on the bottom
// bar links to them directly any more.
var MGI = {
  telegram: '<svg viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>',
  plane: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 3 3 10.4l6.4 2.4L12 20l2.6-5.4L21 3z"/><path d="M9.4 12.8 21 3"/></svg>',
  whatsapp: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.4 20.6l1.3-4.4A8.6 8.6 0 1 1 8 19.5z"/><path d="M9 8.6c0 3.2 2.6 5.8 5.8 5.8l1-1.4-2-1-.8.8c-.8-.4-1.6-1.2-2-2l.8-.8-1-2z" fill="#fff" stroke="none"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
};
// The open treasure chest with gold coins (transparent background), used on Home and on the Treasure Chest page.
// Owner: "the icon fades in and out when tapped not static and selector
// doesn't disappear." The selector BOX is pure CSS off .navitem.active and
// needs no help here -- it stays put. This is only for the ICON's tap
// tap signal animation: put the class on when a thumb lands,
// take it off when the animation ends so it can replay.
//
// Bound on the BAR, not on each of the six items -- one listener instead of
// six, and it keeps working no matter how the items are re-rendered.
// pointerdown rather than click, so the box appears the instant a thumb
// lands rather than after the tap completes.
var _navTapHooked = false;
// Owner: "l also want when l tap on the product card it fades in then out,
// but no action just it is animation but no action should be there on
// triggering buy."
//
// One delegated listener on #pageHost rather than a handler per card: the
// catalog re-renders whenever products load or refresh, and per-card
// handlers would have to be re-attached every time.
//
// The card deliberately has NO onclick. Buying stays behind the Buy Now
// button alone, and this listener bails out the moment the tap came from
// that button (or any other control), so the acknowledgement and the
// purchase can never be confused for one another.
function hookNavTapBox(){
  if (_navTapHooked) return;
  const nav = document.querySelector('.bottom-nav');
  if (!nav) return;
  _navTapHooked = true;
  // No tap pulse or ripple on the tab icons (owner's request): they just switch to the active look.
}

// The five tab pictures are the admin's cut-out icons (Banners > Icons); a tab whose picture is not uploaded yet shows just its label.
var NAV_ICON_SLOT = { home: 'navhome', assets: 'navincome', network: 'navteam', promo: 'navshare', account: 'navmy' };
function updateNavIcons(){
  hookNavTapBox();
  document.querySelectorAll('.navitem').forEach(btn => {
    const key = btn.dataset.nav;
    btn.classList.toggle('active', key === STATE.page);
    const slot = btn.querySelector('.nav-ic');
    const src = (STATE.icons && STATE.icons[NAV_ICON_SLOT[key]]) || '';
    if (slot && slot.dataset.src !== src) { slot.innerHTML = src ? '<img src="' + esc(src) + '" alt="" draggable="false">' : ''; slot.dataset.src = src; }
  });
  paintFloats();
}
// The two pictures that float at the right of every signed-in page: Order gifts (chest) over Download app. Each is hidden on its own page.
function paintFloats(){
  const box = $('ptFloats'); if (!box) return;
  const ic = STATE.icons || {};
  const html = (ic.ordergift ? '<button class="pt-fl pt-fl-chest" type="button" onclick="openOrderGiftsPage()" aria-label="Order gifts">' + ptIconHtml('ordergift', 'gift') + '</button>' : '')
    + (ic.downloadapp ? '<button class="pt-fl pt-fl-app" type="button" onclick="openDownloadPage()" aria-label="Download app">' + ptIconHtml('downloadapp', 'appfloat') + '</button>' : '');
  if (box.dataset.sig !== html) { box.innerHTML = html; box.dataset.sig = html; }
}
// Keeps balances/team stats quietly current while the app just sits open --
// no navigation needed to see fresh numbers. Started once per page-enter
// (idempotent -- always clears any prior timer first) and checks
// STATE.page on every tick rather than tracking which page started it, so
// it naturally follows the user across tabs without needing to be
// restarted per-page. Only ever patches specific numeric fields in place
// (never a full page rebuild) so it can't disturb the activity ticker, the
// chest-swing animation, plan countdowns, or whichever team level/tab the
// member currently has open.
// ── THE LIVE LOOP ──
//
// Owner: "make sure that the app always listens to every content and updates
// quickly without reloads ... l want every data to be loaded up quickly every
// seconds, no reloads."
//
// A NOTE ON FIREBASE LISTENERS, because he asked for those by name: they are
// not available to this data. Firebase here is Auth only -- who you are. Every
// figure in the app (balances, plans, records, team, messages, settings) lives
// in MongoDB behind potato-server, so there is no Firestore document to attach onSnapshot
// to. The equivalent behaviour without rebuilding the backend is this: a short
// poll that repaints IN PLACE. Nothing reloads, nothing navigates, and the
// member cannot tell the difference. (A genuine server push would be SSE from
// potato-server off a Mongo change stream -- a real option, and a much bigger
// change than this.)
//
// What it does, and the reasons each part is not optional:
//  * ONE timer for the whole app, following STATE.page and the open sheet on
//    every tick rather than being restarted per screen.
//  * setTimeout chained, not setInterval: a fixed interval cannot back off, and
//    a stalled request under setInterval stacks up more of the same request.
//  * PAUSED while the app is hidden. This was the old loop's real fault -- it
//    kept hitting the backend from a phone in a pocket, all night. It kicks
//    immediately on return, so coming back to the app shows fresh figures at
//    once rather than after a wait.
//  * Repaints only when the data ACTUALLY CHANGED (liveChanged below). A list
//    rebuilt on every tick would reset scroll position and restart the reveal
//    animation -- which is precisely the "reload" feeling he does not want.
//  * Reads only. No money endpoint is ever called from here.
// _liveGen invalidates work already in flight. A tick that is sitting on an
// await when the member signs out would otherwise come back, reschedule itself
// and keep polling a session that no longer exists.
var _liveTimer = null, _liveBusy = false, _liveDelay = 0, _liveSigs = {}, _liveGen = 0;
// Database reads are the scarce thing on the hosted database (500 operations a second in all), and a Home tick used to cost
// three reads (balance, then the list of products owned, which is two). The balance still follows the member every second,
// but the heavier lists are re-read only when something that can change them has happened: the balance moved (a payout, a
// deposit, a purchase all move it) or their own short beat has elapsed (an admin giving a product or sending a message does
// not move the balance). Nothing else about what is shown changes.
var LIVE_LIST_MS = 8000, LIVE_FEED_MS = 4000, _liveSeenAt = {}, _liveAccountMoved = false;
function liveDue(key, ms, force){
  const now = Date.now();
  if (force || !_liveSeenAt[key] || now - _liveSeenAt[key] >= ms) { _liveSeenAt[key] = now; return true; }
  return false;
}
// Owner: "let it poll every 1 second, we have a VPS KVM1 and MongoDB flex" --
// was 5000/floored-at-2000. The 2s floor's own reasoning (phone battery/radio
// wake-ups, not server cost) still genuinely applies at 1s -- it is simply a
// tradeoff the owner chose to accept now that the infra behind it is real.
// Team/settings deliberately were NOT sped up to match -- see their own
// comments below; neither needs per-second freshness, and hammering them at
// 1Hz would burn battery for zero perceptible benefit.
var LIVE_MS = 1000, LIVE_MAX_MS = 60000;
// Team stats get their own, slower beat -- see the note at their fetch.
var LIVE_TEAM_MS = 30000, _liveTeamAt = 0;
// Settings get their own slower beat too -- see the note at their fetch.
var LIVE_SETTINGS_MS = 30000, _liveSettingsAt = 0;
// Tunable from the backend without shipping an app build. Floored at 1s:
// below that the phone spends more time on radio wake-ups than on anything a
// member would notice, and server.js's own livePollLimiter/livePollIpLimiter
// (see their comment there) are sized for exactly this floor, not faster.
function livePollMs(){
  const s = Number((STATE.settings || {}).livePollMs);
  return Math.max(1000, Number.isFinite(s) && s > 0 ? s : LIVE_MS);
}
// True the first time it sees a given payload, and whenever it changes after
// that. Keyed per feed, so one busy feed cannot suppress another.
function liveChanged(key, value){
  const s = JSON.stringify(value);
  if (_liveSigs[key] === s) return false;
  _liveSigs[key] = s;
  return true;
}
function stopLiveRefresh(){
  _liveGen++;
  clearTimeout(_liveTimer); _liveTimer = null; _liveBusy = false;
  _liveDelay = 0; _liveSigs = {}; _liveTeamAt = 0; _liveSettingsAt = 0; _liveSeenAt = {}; _liveAccountMoved = false;
}
function scheduleLive(gen, ms){
  clearTimeout(_liveTimer);
  _liveTimer = setTimeout(() => liveTick(gen), ms);
}
async function liveTick(gen){
  if (gen !== _liveGen) return;              // stopped, or restarted under us
  if (document.hidden || _liveBusy) { scheduleLive(gen, livePollMs()); return; }
  _liveBusy = true;
  let ok = true;
  try {
    ok = await liveRefreshVisible();
  } catch (_) {
    ok = false;
  }
  _liveBusy = false;
  if (gen !== _liveGen) return;              // signed out while that was in flight
  // Steady cadence while the backend is answering; exponential backoff while it
  // is not, so a sleeping Render instance is not hammered awake by a phone that
  // has been left open on one screen.
  _liveDelay = ok ? livePollMs() : Math.min(LIVE_MAX_MS, Math.max(livePollMs(), _liveDelay || 0) * 2);
  scheduleLive(gen, _liveDelay);
}
// Everything the member can currently see, and nothing else. Each branch
// re-checks what is on screen AFTER its await -- a tick that started on Home
// must not paint into Team because the member moved while it was in flight.
async function liveRefreshVisible(){
  const sheet = _openSheetTitle;
  let ok = true;
  // The wallet figure follows the member everywhere, so it is refreshed on
  // every tick regardless of screen -- it is the number they care about most,
  // and it is one small read.
  const acc = await api('/account');
  if (acc.status === 'success') {
    STATE.account = acc.account;
    _liveAccountMoved = false;
    if (liveChanged('account', acc.account)) {
      _liveAccountMoved = true;
      // patchHomeBalances() writes only the specific figures and no-ops on a
      // page that has none, so it is safe on every screen -- and unlike
      // renderAccount() it cannot reset the member's scroll position, which
      // would read as the reload he does not want.
      patchHomeBalances();
    }
  } else ok = false;

  // Owner: "the app still serves the old data, so can't you make when it
  // loads up without even reloading or restarting app." Settings (fees,
  // minimums, brand name, the announcement, support contacts, the OTP
  // toggle, product availability flags, and everything else an admin can
  // change) were never part of this loop at all -- STATE.settings was
  // fetched once at boot and held forever, so an admin change only ever
  // reached an already-open session after a manual reload. Its own slower
  // beat, like team stats right below: these change rarely (an admin
  // action), not every few seconds, and every sheet that actually reads a
  // setting (Deposit, Withdraw, Wallet, ...) already re-reads
  // STATE.settings fresh at the moment it opens -- so simply keeping this
  // object current is enough to fix them, no repaint needed there. Brand
  // name is the one thing shown continuously on screen, so that alone gets
  // a targeted patch, same non-disruptive pattern as patchHomeBalances()
  // above -- never a full re-render, which would reset scroll position and
  // read as the reload he does not want.
  if (Date.now() - _liveSettingsAt >= LIVE_SETTINGS_MS) {
    _liveSettingsAt = Date.now();
    const sr = await api('/public/settings');
    if (sr.status === 'success') {
      const changed = liveChanged('settings', sr.settings);
      STATE.settings = sr.settings || {};
      if (changed) applyBrandName();
    } else { _liveSettingsAt = 0; ok = false; }
  }

  // An open sheet is what the member is actually looking at, so it wins over
  // the page behind it.
  if (sheet === 'Balance Detail') {
    if (!liveDue('tx', LIVE_LIST_MS, _liveAccountMoved)) return ok;
    const r = await api('/transactions');
    if (r.status === 'success' && _openSheetTitle === 'Balance Detail') {
      STATE.transactions = r.transactions;
      STATE.transactionsTruncated = !!r.truncated;
      if (liveChanged('tx', r.transactions)) renderStatement();
    } else if (r.status !== 'success') ok = false;
    return ok;
  }
  if (sheet === 'Messages') {
    if (!liveDue('messages', LIVE_FEED_MS, _liveAccountMoved)) return ok;
    const r = await api('/messages');
    if (r.status === 'success' && _openSheetTitle === 'Messages') {
      STATE.messages = r.messages;
      if (liveChanged('messages', r.messages)) { renderMessagesList(); updateMessageBadge(); }
    } else if (r.status !== 'success') ok = false;
    return ok;
  }

  if (STATE.page === 'home' && !sheet) {
    if (!liveDue('inv', LIVE_LIST_MS, _liveAccountMoved)) return ok;
    const [pr, r] = await Promise.all([api('/public/products'), api('/investments')]);
    if (r.status === 'success' && Array.isArray(r.investments)) {
      STATE.investments = r.investments;
      _investmentsLoadFailed = false;
    } else ok = false;
    // The product list on Home follows the admin's changes (price, order, switched off) without the member reloading.
    if (pr.status === 'success') {
      STATE.products = pr.products;
      if (!_openSheetTitle && STATE.page === 'home' && liveChanged('products', pr.products) && $('homeProducts')) {
        const list = homeTabProducts();
        $('homeProducts').innerHTML = list.length ? list.map(vProductCardHtml).join('') : homeEmptyHtml();
        startProductCountdowns();
      }
    } else ok = false;
  } else if (STATE.page === 'assets') {
    if (!liveDue('inv', LIVE_LIST_MS, _liveAccountMoved)) return ok;
    const [pr, ir] = await Promise.all([api('/public/products'), api('/investments')]);
    if (pr.status === 'success') STATE.products = pr.products; else ok = false;
    if (ir.status === 'success') {
      STATE.investments = ir.investments;
      _investmentsLoadFailed = false;
    } else ok = false;
    if (!_openSheetTitle && STATE.page === 'assets') {
      const changedProducts = pr.status === 'success' && liveChanged('products', pr.products);
      const changedInvestments = ir.status === 'success' && liveChanged('investments', ir.investments);
      if (changedProducts || changedInvestments) paintAssets();
    }
  } else if (STATE.page === 'promo') {
    if (Date.now() - _liveTeamAt >= LIVE_TEAM_MS) {
      _liveTeamAt = Date.now();
      const r = await api('/team/stats');
      if (r.status === 'success') { STATE.teamStats = r; if (STATE.page === 'promo' && !_openSheetTitle && liveChanged('team', r)) paintPromo(); }
      else { _liveTeamAt = 0; ok = false; }
    }
  } else if (STATE.page === 'network') {
    if (Date.now() - _liveTeamAt >= LIVE_TEAM_MS) {
      _liveTeamAt = Date.now();
      const r = await api('/team/stats');
      if (r.status === 'success' && STATE.page === 'network' && !_openSheetTitle) {
        STATE.teamStats = r;
        if (liveChanged('team', r)) { _teamMembersAt = {}; paintNetwork(); } // someone joined or changed: refetch the lists too
      } else if (r.status !== 'success') { _liveTeamAt = 0; ok = false; }
    }
  }
  return ok;
}
function startLiveRefresh(){
  _liveGen++;
  _liveDelay = livePollMs();
  scheduleLive(_liveGen, _liveDelay);
}
// Coming back to the app refreshes it at once. Without this the member stares
// at whatever was on screen when they left until the next tick, which is the
// single most visible way a polled app feels stale.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && _liveTimer) { _liveDelay = livePollMs(); scheduleLive(_liveGen, 0); }
});
// The page's appearing animation (see .mg-enter in the MG styles): on every tab change, and again when a sheet is closed (the back arrow, the phone's
// Back button) so the page underneath comes back the same way.
var _popInTimer = null;
function replayPageIn(){
  const ph = $('pageHost');
  if (ph) { ph.classList.remove('mg-enter'); void ph.offsetWidth; ph.classList.add('mg-enter'); }
  // Home: its four buttons pop in again, for a moment only (a repaint of Home a little later must not pop them again).
  if (ph) {
    ph.classList.remove('pt-popin');
    if (STATE.page === 'home') {
      void ph.offsetWidth; ph.classList.add('pt-popin');
      if (_popInTimer) clearTimeout(_popInTimer);
      _popInTimer = setTimeout(() => { _popInTimer = null; ph.classList.remove('pt-popin'); }, 900);
    }
  }
}
window.navigatePage = function(name){
  dismissNotify();
  if (STATE.page === name && !document.querySelector('.sheet-bg.show,#msgDetailBg.show,#depStatusBg.show')) return;
  return showPage(name);
};
window.showPage = async function(name){
  // The page being left, captured before STATE.page is overwritten below --
  // maybeAnnounceAfterHomeNav() needs to know what tab a member is arriving
  // at Home FROM (Assets/Network/Account), not just that they landed on it.
  const prevPage = STATE.page;
  const prevSheet = _openSheetTitle;   // Deposit / Withdraw open when a tab is tapped: Home then shows its dialog like a Back does
  // The bottom bar now stays visible over sheets (Deposit, Withdraw, Wallet
  // and the rest), so a tab can be tapped while one is open. Close it first,
  // otherwise the new tab paints underneath a sheet that is still covering
  // it and the app looks frozen.
  //
  // The message detail is its OWN overlay, not a sheet, and it is the only
  // other one that stops above the bottom bar (`bottom:var(--nav-h)`, same as
  // .sheet-bg) -- so the nav is tappable through it and the tap did nothing.
  // Owner: "when in this message and you tap nav icons, the message screen
  // still persists to go away unless you click on X mark."
  //
  // The recharge status page (.pay-page) is a full-screen task state with
  // the bottom nav hidden while it is open. Keep its teardown here anyway so
  // any programmatic tab change also dismisses the overlay cleanly.
  //
  // Unlike the other two it owns NO history entry (openDepositStatusModal
  // does not pushState), so it must not be counted in `spent` below --
  // retiring an entry it never pushed would walk the member off the app's
  // first entry and drop them out of the app.
  //
  // Closing the page does NOT stop the poll, deliberately: a payment is still
  // in flight at the provider, pollDepositStatus() keeps running and still
  // refreshes Records when it settles.
  //
  // Other overlays cover the full viewport too, so a tab change cannot be
  // triggered from underneath them.
  //
  // Both overlays own a history entry, and they must be unwound with ONE
  // history call: two history.back()s in a single tick is the exact race this
  // file has already been bitten by (see openManualPayOverlay's note on a
  // pushState racing a still-pending back). So closeSheet is told to leave
  // history alone and a single go(-n) retires both entries, firing one
  // popstate that finds everything already closed and does nothing.
  const detailOpen = !!($('msgDetailBg') && $('msgDetailBg').classList.contains('show'));
  const sheetOpen = !!document.querySelector('.sheet-bg.show');
  const payOpen = !!($('depStatusBg') && $('depStatusBg').classList.contains('show'));
  if (detailOpen) $('msgDetailBg').classList.remove('show');
  if (payOpen) {
    $('depStatusBg').classList.remove('show');
    document.body.classList.remove('deposit-status-open');
    unlockBodyScroll();
  }
  // Owner: "some notifies take long to go away even when you've clicked in
  // another category, it still keep showing." notify()'s own 3.6s timer only
  // ever gets reset by ANOTHER notify() call -- switching tabs never touched
  // it, so a toast that fired moments before a tab tap rode out its full
  // remaining time floating over whatever screen the member had already
  // moved on to. Torn down here alongside the other overlays this same
  // function already tears down on a tab change. Deliberately NOT routed
  // through closeNotify(): that fires the pending onClose callback (e.g. the
  // insufficient-balance toast's "send them to Deposit"), and a member
  // tapping a different tab is not acknowledging the toast -- it must not
  // ALSO force a navigation neither the toast nor the tap asked for.
  dismissNotify();
  if (sheetOpen && typeof closeSheet === 'function') closeSheet({ navigating: true, keepHistory: true });
  // payOpen is deliberately absent from this count -- it pushes no history
  // entry, so including it would retire someone else's.
  const spent = (detailOpen ? 1 : 0) + (sheetOpen ? 1 : 0);
  if (spent) history.go(-spent);
  if (name === 'products') name = 'home';
  else if (name === 'catalog') name = 'assets';
  else if (name === 'team') name = 'network';
  else if (name === 'referral') name = 'promo';
  STATE.page = name;
  _ptCountOnPaint = (name === 'account' || name === 'assets') ? name : '';
  replayPageIn();
  window.scrollTo(0, 0);   // every tab opens at its top, not wherever the previous one was scrolled
  updateNavIcons();
  if (name === 'home') {
    // Deliberately NOT awaited: renderHome() does its own account/investments
    // refresh (a real network round trip even on a cache-hit repaint), and
    // the announcement decision below depends only on STATE.settings, not on
    // that data at all -- awaiting it first would add a real, needless delay
    // before the dialog could ever show. paintHome()'s synchronous portion
    // still runs in this same tick either way (everything in renderHome()
    // before its own first `await` executes before control returns here), so
    // Home's paint ordering is unaffected -- only the announcement's own
    // timing depends on this not being awaited.
    renderHome();
    maybeAnnounceAfterHomeNav(prevPage, prevSheet);
  }
  else if (name === 'assets') await renderAssets();
  else if (name === 'network') await renderNetwork();
  else if (name === 'promo') await renderPromo();
  else if (name === 'account') await renderAccount();
  startLiveRefresh();
};
// The announcement dialog: one picture (admin) with Join Channel under it and a round X.
window.closeAnnouncement = function(){
  const bg = $('annBg');
  if (bg) { if (bg.classList.contains('show')) dlgClosed(); bg.classList.remove('show'); }
  if (!isScrollLockOverlayOpen()) unlockBodyScroll();
};
// The announcement is one portrait picture (uploaded in the admin panel) with
// Join Channel and Close under it. Join Channel opens the Telegram group link,
// or the WhatsApp group link when no Telegram group is set.
function maybeShowAnnouncement(){
  const s = STATE.settings || {};
  // The picture is fetched behind the loading screen: wait for it, so the dialog opens once, complete.
  if (!_artLanded && !STATE.announcementImage) {
    if (!_annWaiting) { _annWaiting = true; startArtwork().then(() => { _annWaiting = false; if (!isAnyOverlayOpen()) maybeShowAnnouncement(); }); }
    return;
  }
  if (!STATE.announcementImage) {
    // The pictures are fetched after the loading screen comes down; if they
    // have not landed yet, open the dialog the moment they do.
    if (!_artLanded && !_annWaiting) { _annWaiting = true; startArtwork().then(() => { _annWaiting = false; if (!isAnyOverlayOpen()) maybeShowAnnouncement(); }); }
    return;
  }
  const bg = $('annBg'), sheet = $('annSheet');
  if (!bg || !sheet) return;
  const link = s.telegramGroup || '';
  sheet.innerHTML = `
    <button class="mg-ann-x" type="button" onclick="closeAnnouncement()" aria-label="Close">${MGI.x}</button>
    <div class="mg-ann-body">
      ${STATE.announcementImage ? `<img class="mg-ann-img" src="${esc(STATE.announcementImage)}" alt="">` : ''}
    </div>
    ${link ? `<a class="mg-ann-join" href="${esc(link)}" target="_blank" rel="noopener" onclick="closeAnnouncement()"><svg viewBox="0 0 24 24" aria-hidden="true" width="20" height="20"><path fill="#fff" d="M21.5 3.2 2.7 10.5c-.9.4-.9 1.1 0 1.4l4.8 1.5 1.8 5.6c.2.6.8.7 1.2.3l2.6-2.2 4.9 3.6c.9.5 1.6.2 1.8-.9L22.9 4.4c.3-1.3-.5-1.8-1.4-1.2zM9 13.1l9.6-6-7.4 7.2-.3 3.4z"/></svg><span>Join Channel</span></a>` : ''}`;
  bg.classList.add('show');
  lockBodyScroll(); dlgOpened();
  annGrowIn(sheet);
}
// The card appears whole and blank (a short fade and settle), then the picture fades in and then the words (about 0.6 s in all); nothing
// changes size or position while it opens. A picture not yet decoded is waited for (the card stays invisible) so it never lays out late.
function annGrowIn(sheet){
  if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const img = sheet.querySelector('.mg-ann-img');
  const run = () => {
    sheet.classList.remove('mg-ann-wait');
    if (!$('annBg').classList.contains('show')) return;
    sheet.classList.add('mg-ann-grow');
    setTimeout(() => sheet.classList.remove('mg-ann-grow'), 700);
  };
  if (img && !img.complete) { sheet.classList.add('mg-ann-wait'); img.decode().then(run, run); } else run();
}

// ── HOME ──
// Cache-first: a page revisit paints instantly from whatever STATE already
// holds (no network wait, no loading affordance needed), then a background
// fetch quietly brings it up to date. `patchHomeBalances()` updates just the
// 3 money figures in place afterward (and on a standing timer via
// startLiveRefresh()) without rebuilding the page -- rebuilding would tear
// down and restart the ticker/chest-swing animations every few seconds.
// A list that could not be fetched says so (and a tap tries again) instead of passing itself off as an empty one: "No Orders" after a failed
// load would tell a member their purchases are gone.
var _productsLoadFailed = false, _recordsLoadFailed = false, _messagesLoadFailed = false;
function loadFailHtml(what, cls){ return '<div class="v-empty ' + (cls || '') + '" role="button" onclick="retryLoad(\'' + what + '\')">Could not load. Tap to try again.</div>'; }
window.retryLoad = async function(what){
  if (what === 'account') { const r = await api('/account'); if (r.status === 'success') STATE.account = r.account; return renderAccount(); }
  if (what === 'home') return renderHome();
  if (what === 'assets') return renderAssets();
  if (what === 'records') return openTransactionStatement(_statementCat);
  if (what === 'messages') return openMessagesSheet();
};
async function renderHome(){
  const hadInvestments = Array.isArray(STATE.investments);
  const shownProducts = homeSignature();
  const hadProductList = !!STATE.products;
  paintHome();
  const [accR, invR, prR] = await Promise.all([ api('/account'), api('/investments'), api('/public/products') ]);
  if (accR.status === 'success') STATE.account = accR.account;
  if (prR.status === 'success' && Array.isArray(prR.products)) { STATE.products = prR.products; _productsLoadFailed = false; }
  else if (!STATE.products) _productsLoadFailed = true;   // stays unset so Home says "could not load", not "no products"
  if (invR.status === 'success' && Array.isArray(invR.investments)) {
    STATE.investments = invR.investments;
    _investmentsLoadFailed = false;
  } else if (!hadInvestments) {
    _investmentsLoadFailed = true;
  }
  if (STATE.page !== 'home') return; // navigated away while awaiting
  // Repaint only when the catalog really changed: a rebuild restarts the
  // banner carousel, the ticker and the Buy glow and throws away the scroll position.
  if (homeSignature() !== shownProducts || !hadProductList) paintHome();
  // The envelope button's unread dot. Fetched once per Home entry, AFTER
  // the paint (never blocking it) and patched in place via
  // updateMessageBadge() so it can't tear down the ticker/chest animation.
  const msgR = await api('/messages');
  if (msgR.status === 'success') STATE.messages = msgR.messages;
  if (STATE.page === 'home') updateMessageBadge();
}
// The Home banner has two states: an admin-set still image, or the built-in
// striped fallback with the brand tagline. (The admin-uploadable video
// banner was removed entirely -- owner: "video banner remove it" -- along
// with the preload-during-boot wait it needed, which was costing up to 4s
// of the loading screen on a first open after every upload.)
function homeBannerInnerHtml(st){
  if (STATE.homeBanner) return `<img src="${esc(STATE.homeBanner)}" alt="" onerror="this.style.display='none'">`;
  return `<div class="hb-stripes"></div>`;
}
// ── HOME BANNER CAROUSEL (owner: "those slide images will be uploaded
// from admin panel") ──
// Only kicks in when there is more than one image to actually rotate
// between -- a single image renders exactly as it always has (no dots,
// nothing to cycle). Slide 1 is STATE.homeBanner (the original, pre-
// carousel slot); slides 2/3 are the banner2/banner3 admin uploads.
function homeCarouselSlides(){
  const slides = [STATE.homeBanner].concat(STATE.homeSlides2n3 || []).filter(Boolean);
  return slides.length > 1 ? slides : null;
}
function mgDotsHtml(n, idx){
  let h = '';
  for (let i = 0; i < n; i++) h += '<i' + (i === idx ? ' class="on"' : '') + '></i>';
  return '<div class="mg-dots" id="mgDots">' + h + '</div>';
}
function mgSetDots(idx){
  const box = $('mgDots'); if (!box) return;
  box.querySelectorAll('i').forEach((el, i) => el.classList.toggle('on', i === idx));
}
function homeBannerBlockHtml(st){
  const slides = homeCarouselSlides();
  if (!slides) return `<div class="home-banner">${homeBannerInnerHtml(st)}</div>`;
  return `<div class="home-banner" id="homeCarouselTrack"><div class="mg-track" id="mgTrack">${slides.map((u, i) => `<img src="${esc(u)}" alt="" draggable="false"${i === 0 ? ' class="on"' : ''}>`).join('')}</div>${mgDotsHtml(slides.length, 0)}</div>`;
}
var _homeCarouselTimer = null;
var _homeCarouselIdx = 0;
// The banner changes by itself every 4.5 seconds: the picture leaving fades out while the next one fades in, together. It cannot be swiped.
// Self-terminating on the next tick once Home's own nodes are gone, so navigating away never leaves it ticking.
function mgGoSlide(i, noTimerReset){
  const track = $('mgTrack'), slides = homeCarouselSlides();
  if (!track || !slides) return;
  _homeCarouselIdx = ((i % slides.length) + slides.length) % slides.length;
  track.querySelectorAll('img').forEach((im, k) => im.classList.toggle('on', k === _homeCarouselIdx));
  mgSetDots(_homeCarouselIdx);
  if (!noTimerReset) startHomeCarousel(true);
}
function startHomeCarousel(keepIdx){
  if (_homeCarouselTimer) { clearInterval(_homeCarouselTimer); _homeCarouselTimer = null; }
  const slides = homeCarouselSlides();
  if (!slides) return;
  if (!keepIdx) _homeCarouselIdx = 0;
  _homeCarouselTimer = setInterval(() => {
    if (!$('mgTrack')) { clearInterval(_homeCarouselTimer); _homeCarouselTimer = null; return; }
    mgGoSlide(_homeCarouselIdx + 1, true);
  }, 4500);
}
// An asset picture is shown whole, in its own shape (nothing cropped). A portrait picture sits in
// the left column; a square or wide one goes across the top of the card with the figures below.
function vNoPicture(img, initial){
  const frame = img.parentNode;
  if (frame && frame.classList) frame.classList.remove('has-img', 'v-fence');
  const card = img.closest('.v-card'); if (card) card.classList.remove('v-flat');
  img.outerHTML = '<span class="v-glyph">' + initial + '</span>';
}
 window.vNoPicture = vNoPicture;
function vOwnedCount(key){ return (STATE.investments || []).filter(i => i.tierKey === key).length; }
function homeSignature(){ return JSON.stringify(STATE.products || []) + '|' + (STATE.investments || []).map(i => i.tierKey).join(','); }
// The picture sits in a fixed column on the left. A grey band across its top says "Coming Soon" while the product cannot be bought yet,
// and a green band across its bottom says how many of the purchase limit the member already holds (owned/limit).
function mgPicture(p){
  const initial = esc(String(p.name || '?').trim()[0] || '?');
  return p.image
    ? `<img src="${esc(p.image)}" alt="${esc(p.name)}" onerror="vNoPicture(this,'${initial}')">`
    : `<span class="v-glyph">${initial}</span>`;
}
function mgProductOpen(p){ return p.isOpen !== false && !p.comingSoon; }
function ptMoneyInt(n){ return cur() + ' ' + Math.round(Number(n) || 0).toLocaleString('en-US'); }
function vProductCardHtml(p){
  const { cycle, daily, expected } = planFigures(p);
  const limit = Number(p.buyLimit) || 0;
  const owned = vOwnedCount(p.key);
  return `
  <article class="pt-card" data-key="${esc(p.key)}">
    <div class="pt-img">${mgPicture(p)}${limit > 0 ? `<span class="pt-tag">${owned}/${limit}</span>` : ''}</div>
    <div class="pt-main">
      <h3>${esc(p.name)}</h3>
      <div class="pt-grid">
        <div><b>Price</b><i class="pt-fit">${esc(ptMoneyInt(p.price))}</i></div>
        <div><b>Daily</b><i class="pt-fit">${esc(ptMoneyInt(daily))}</i></div>
        <div><b>Days</b><i>${cycle}</i></div>
        <div><b>Total</b><i class="pt-fit">${esc(ptMoneyInt(expected))}</i></div>
      </div>
      ${vBuyHtml(p)}
    </div>
  </article>`;
}
// The Buy button keeps every state productCtaHtml() had (open, coming soon,
// ticking countdown). A product at its purchase limit is a plain disabled button.
var PT_CART = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 3h3l2.6 12.2h11.1L21 7H6.2"/><circle cx="9.5" cy="19.5" r="1.4"/><circle cx="17.5" cy="19.5" r="1.4"/></svg>';
function vBuyHtml(p){
  const limit = Number(p.buyLimit) || 0;
  if (limit > 0 && vOwnedCount(p.key) >= limit) return `<button class="pt-buy off" type="button" disabled>${PT_CART}<span>BUY</span></button>`;
  if (mgProductOpen(p)) return `<button class="pt-buy" type="button" onclick="openInvestConfirm('${esc(p.key)}',this)">${PT_CART}<span>BUY</span></button>`;
  const at = Number(p.opensAt) || 0;
  // Not `disabled`: a disabled button swallows the tap, and the screen shows the "Coming soon, please wait" dialog when it is tapped.
  if (!at || p.openMode === 'soon' || p.comingSoon) return '<button class="pt-buy soon" type="button" onclick="notify(\'Coming soon, please wait\')"><span>Coming Soon</span></button>';
  return `<button class="pt-buy soon" type="button" onclick="notify('Coming soon, please wait')" data-opens-at="${at}"><span>Coming soon in ${fmtCountdown(at - Date.now())}</span></button>`;
}
function vBannerHtml(){
  const st = STATE.settings || {};
  return STATE.homeBanner || homeCarouselSlides()
    ? homeBannerBlockHtml(st)
    : `<div class="home-banner v-banner-empty"></div>`;
}
function mgUnread(){ return (STATE.messages || []).filter(m => !m.read).length; }
// Channel = the Telegram group (or the WhatsApp group when there is none); Service = customer service.
window.openContactLink = function(kind){
  const s = STATE.settings || {};
  const url = kind === 'channel' ? (s.telegramGroup || '') : (s.supportTelegram || '');
  if (!/^https?:\/\//i.test(String(url))) return notify('No ' + (kind === 'channel' ? 'channel' : 'service') + ' link is set yet.');
  window.open(url, '_blank', 'noopener');
};
// ── Admin-uploaded cut-out icons and the flip clock (motion and look measured from the owner's screen recordings; CSS in index.html, PT-ANIM block) ──
// An icon slot's picture as an <img>, or '' when none has been uploaded (the screen then simply has no picture there). `motion` is 'gift'
// (order gift bounce) or 'appfloat' (download-app float) or '' for a still picture.
function ptIconHtml(key, motion, extraClass){
  const src = STATE.icons && STATE.icons[key];
  if (!src) return '';
  return '<img class="pt-icon' + (motion ? ' pt-' + motion : '') + (extraClass ? ' ' + extraClass : '') + '" src="' + esc(src) + '" alt="" draggable="false">';
}
// "08:47:15" -> the flip clock markup. Every digit is a tile; the colons are red dot pairs.
function ptFlipDigitHtml(ch){ return '<span class="pt-fd" data-v="' + ch + '"><span class="pt-ft"><i>' + ch + '</i></span><span class="pt-fb"><i>' + ch + '</i></span><span class="pt-fl pt-fl-t"><i>' + ch + '</i></span><span class="pt-fl pt-fl-b"><i>' + ch + '</i></span></span>'; }
function ptFlipClockHtml(str){
  const parts = String(str).split(':');
  return '<div class="pt-fc" data-t="' + esc(String(str)) + '">' + parts.map(p => '<span class="pt-fp">' + p.split('').map(ptFlipDigitHtml).join('') + '</span>').join('<span class="pt-fcol"></span>') + '</div>';
}
// Show a new time on an existing clock: only the digits that changed flip (0.55 s each).
function ptFlipClockSet(root, str){
  if (!root) return;
  const digits = root.querySelectorAll('.pt-fd'), chars = String(str).replace(/:/g, '').split('');
  if (digits.length !== chars.length) return;
  digits.forEach((d, i) => {
    const next = chars[i], prev = d.getAttribute('data-v');
    if (next === prev) return;
    if (d._ptT) { clearTimeout(d._ptT); d._ptT = null; ptFlipSettle(d); }
    const q = sel => d.querySelector(sel + ' i');
    q('.pt-fl-t').textContent = prev;      // the old upper half folds away
    q('.pt-ft').textContent = next;        // the new upper half is under it
    q('.pt-fb').textContent = next;        // the lower half shows the new digit at once
    q('.pt-fl-b').textContent = next;      // the new lower half unfolds over it
    d.setAttribute('data-v', next);
    d.classList.remove('pt-go'); void d.offsetWidth; d.classList.add('pt-go');
    d._ptT = setTimeout(() => { d._ptT = null; ptFlipSettle(d); }, 560);
  });
  root.setAttribute('data-t', String(str));
}
function ptFlipSettle(d){ d.classList.remove('pt-go'); const v = d.getAttribute('data-v'); d.querySelectorAll('i').forEach(i => { i.textContent = v; }); }

function homeTabProducts(){ return (STATE.products || []).filter(p => p.active !== false); }
function homeEmptyHtml(){ return '<div class="v-empty">No products yet.</div>'; }
function paintHome(){
  // A product the admin switched off (Active unticked) is not offered on Home; owners still see it on Income.
  const products = (STATE.products || []).filter(p => p.active !== false);
  const quick = (slot, label, fn) => `<button type="button" onclick="${fn}">${ptIconHtml(slot, '', 'pt-qi') || '<span class="pt-qi pt-qi-empty"></span>'}<span>${label}</span></button>`;
  const html = `
<div class="v-page pt-home">
  ${vBannerHtml()}
  <div class="pt-quick">
    ${quick('recharge', 'Recharge', 'openDepositSheet()')}${quick('withdraw', 'Withdraw', 'openWithdrawSheet()')}${quick('service', 'Service', "openContactLink('service')")}${quick('channel', 'Channel', "openContactLink('channel')")}
  </div>
  <div class="pt-list" id="homeProducts">${products.length ? products.map(vProductCardHtml).join('') : (STATE.products ? '<div class="pt-noprod">No products available</div>' : _productsLoadFailed ? '<div class="pt-noprod bad" role="button" onclick="retryLoad(\'home\')">Failed to load products</div>' : '')}</div>
</div>`;
  $('pageHost').innerHTML = html;
  startHomeCarousel();
  startProductCountdowns();
  ptFitValues();
}
// A money figure that is too wide for its cell is made smaller until it fits (UGX amounts of millions are long).
var PT_FIT_SEL = '.pt-fit, .pt-grid i, .pt-lvg b, .pt-tstat b, .pt-inc i, .pt-mystat b, .pt-tl b, .pt-rb b, .pt-tier header b';
function ptFitValues(){
  document.querySelectorAll(PT_FIT_SEL).forEach(el => {
    el.style.fontSize = '';
    let fs = parseFloat(getComputedStyle(el).fontSize) || 14, n = 0;
    while (el.scrollWidth > el.clientWidth + 0.5 && fs > 7 && n++ < 16) { fs -= .5; el.style.fontSize = fs + 'px'; }
  });
}
// Every page is painted by replacing its markup, so the figures are fitted after each paint (and after a figure's text changes), never by hand per page.
(function(){
  let q = 0;
  const relevant = recs => recs.some(r => {
    if (r.type === 'characterData') return false;
    for (const n of r.addedNodes) { if (n.nodeType === 1 && (n.matches(PT_FIT_SEL) || n.querySelector(PT_FIT_SEL))) return true; }
    const t = r.target && r.target.nodeType === 1 ? r.target : null;
    return !!(t && r.addedNodes.length && t.matches(PT_FIT_SEL) && !t.dataset.counting);
  });
  const start = () => {
    const h = document.getElementById('pageHost'); if (!h) return false;
    new MutationObserver(recs => { if (q || !relevant(recs)) return; q = requestAnimationFrame(() => { q = 0; try { ptFitValues(); } catch (_) {} }); }).observe(h, { childList: true, subtree: true });
    return true;
  };
  if (!start()) document.addEventListener('DOMContentLoaded', start);
})();
function patchHomeBalances(){
  const account = STATE.account || {};
  for (const [id, key] of [['homeWalletBalance','walletBalance'], ['homeTotalEarned','totalEarned'], ['homeTotalDeposited','totalDeposited'], ['homeTotalWithdrawn','totalWithdrawn']]) {
    const el = $(id);
    if (el) el.textContent = fmtUGX(account[key]);
  }
  // The figures the current screens actually show: My (balance), Income (total earnings) and the Balance Record header.
  for (const [id, key] of [['myBalance','walletBalance'], ['myIncome','totalEarned'], ['incomeTotal','totalEarned'], ['recBalance','walletBalance'], ['witBalance','walletBalance']]) {
    const el = $(id);
    if (!el) continue;
    if (id === 'myBalance' || id === 'myIncome' || id === 'incomeTotal') ptSetMoney(el, account[key]);
    else el.textContent = vMoney2(account[key]);
  }
}
// THE single place this app works out what a product pays. /public/products
// already sends resolved expectedReturn/cycle/dailyPayout figures computed
// by the same code that credits the money, so the normal path here is just
// to read them. The fallback exists only for a client running against an
// older build of the server, and it mirrors server.js's
// productExpectedReturn() exactly: the per-product multiplier wins over a
// stored expectedReturn, which wins over the global x30.
// Do not re-derive a payout anywhere else. Three screens each had their own
// slightly different formula before this, and once a multiplier was set on a
// product that still carried an inherited expectedReturn, the card and the
// buy-confirm dialog quoted a total the server was never going to pay.
function planFigures(p){
  const price = Number(p.price) || 0;
  const cycle = Number(p.cycle) || 150;
  const stored = Number(p.expectedReturn);
  const daily = Number(p.dailyPayout);
  // dailyPayout is only ever present on the resolved server view, so its
  // presence is what tells us expectedReturn has already been worked out.
  if (Number.isFinite(daily) && daily > 0 && Number.isFinite(stored) && stored > 0)
    return { price, cycle, expected: Math.round(stored), daily };
  const mult = Number(p.multiplier);
  const expected = (Number.isFinite(mult) && mult > 0) ? Math.round(price * mult)
    : (Number.isFinite(stored) && stored > 0) ? Math.round(stored)
    : Math.round(price * 30);
  return { price, cycle, expected, daily: Math.round(expected / cycle) };
}
// HH:MM:SS, and days folded into the hours rather than shown separately -- a
// product opening in two days reads "48:00:00", which is still a countdown. A
// finished one reads 00:00:00 rather than going negative.
function fmtCountdown(ms){
  let s = Math.max(0, Math.floor(Number(ms) / 1000));
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  const pad = n => String(n).padStart(2, '0');
  return pad(h) + ':' + pad(m) + ':' + pad(s);
}
// One timer for every scheduled card on screen. Cleared and restarted by
// whichever screen paints them, the same shape startPlanCountdowns() uses.
// When a card's moment arrives it re-fetches the catalog once, so the button
// becomes Buy Now on its own -- without that the member would sit watching
// 00:00:00 until they navigated away and back.
var _openCountdownTimer = null;
function startProductCountdowns(){
  if (_openCountdownTimer) { clearInterval(_openCountdownTimer); _openCountdownTimer = null; }
  const tick = () => {
    const nodes = document.querySelectorAll('[data-opens-at]');
    if (!nodes.length) { clearInterval(_openCountdownTimer); _openCountdownTimer = null; return; }
    let due = false;
    nodes.forEach(el => {
      const left = Number(el.getAttribute('data-opens-at')) - Date.now();
      if (left <= 0) { due = true; el.textContent = 'Opening…'; return; }
      el.textContent = 'Coming soon in ' + fmtCountdown(left);
    });
    if (due) {
      clearInterval(_openCountdownTimer); _openCountdownTimer = null;
      // A phone clock that runs ahead of the server would make this fire again at once after every refresh (the server still says
      // "not open yet"): ask again at most every 30 s.
      const wait = 30000 - (Date.now() - _catalogRefreshedAt);
      if (wait > 0) { if (!_catalogRetryTimer) _catalogRetryTimer = setTimeout(() => { _catalogRetryTimer = null; refreshCatalogNow(); }, wait); }
      else refreshCatalogNow();
    }
  };
  tick();
  _openCountdownTimer = setInterval(tick, 1000);
}
var _catalogRefreshedAt = 0, _catalogRetryTimer = null;
async function refreshCatalogNow(){
  _catalogRefreshedAt = Date.now();
  const r = await api('/public/products');
  if (r.status === 'success') {
    STATE.products = r.products;
    if (STATE.page === 'home') paintHome();
  }
}

async function renderAssets(){
  const hadCache = Array.isArray(STATE.investments);
  if (hadCache) paintAssets();
  else paintAssets(true);   // the countdown card at once, "Loading..." where the list will be
  const [pr, ir, ar, tr] = await Promise.all([api('/public/products'), api('/investments'), api('/account'), api('/transactions')]);
  if (pr.status === 'success' && Array.isArray(pr.products)) STATE.products = pr.products;
  if (ir.status === 'success' && Array.isArray(ir.investments)) { STATE.investments = ir.investments; _investmentsLoadFailed = false; }
  else if (!hadCache) { STATE.investments = []; _investmentsLoadFailed = true; }
  if (ar.status === 'success') STATE.account = ar.account;
  if (tr.status === 'success' && Array.isArray(tr.transactions)) STATE.transactions = tr.transactions;
  if (STATE.page !== 'assets') return; // navigated away while awaiting
  paintAssets();
}
// One card per product the member owns, in the same shape as Home's card. The running-product screen of the owner's own app is not seen yet:
// until it is, the card shows the same four figures, a bar for the days gone, and when it was bought and when it ends.
function ptStamp(ms){
  const d = new Date(ms), pad = n => String(n).padStart(2, '0');
  return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}
// A product the member owns, as on the owner's Orders picture: the product picture with a green "Earning" label and its name over a dark fade, the name in red,
// four pale lines (Daily, Reward, Amount, Start) and a "Maturity N%" bar with the length of the plan. Amounts are shown as the picture shows them, no thousands commas.
function ptMoneyPlain(n){ return cur() + (/[A-Za-z]$/.test(cur()) ? ' ' : '') + (Number(n) || 0).toFixed(2); }
function ptStartLines(ms){
  const d = new Date(ms), pad = n => String(n).padStart(2, '0');
  return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear() + '<br>' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}
function vOwnedCardHtml(inv){
  const st = planStats(inv);
  const p = (STATE.products || []).find(x => x.key === inv.tierKey) || {};
  const name = inv.tierLabel || p.name || 'Product';
  const startMs = st.createdMs, endMs = startMs + st.total * 86400000;
  const pct = st.matured ? 100 : Math.max(0, Math.min(100, Math.round((Date.now() - startMs) / (endMs - startMs) * 100)));
  return `
  <article class="pt-run">
    <div class="pt-run-top">
      <div class="pt-run-img">${mgPicture(Object.assign({}, p, { name }))}<span class="pt-run-st${st.matured ? ' done' : ''}">${st.matured ? 'Completed' : 'Earning'}</span><span class="pt-run-cap">${esc(name)}</span></div>
      <div class="pt-run-info">
        <h3>${esc(name)}</h3>
        <div class="pt-run-row"><span>Daily</span><b>+${esc(ptMoneyPlain(st.daily))}</b></div>
        <div class="pt-run-row"><span>Reward</span><b>${esc(ptMoneyPlain(st.earned))}</b></div>
        <div class="pt-run-row"><span>Amount</span><b>${esc(ptMoneyPlain(st.amount))}</b></div>
        <div class="pt-run-row two"><span>Start</span><b>${ptStartLines(startMs)}</b></div>
      </div>
    </div>
    <div class="pt-run-mat"><span>Maturity ${pct}%</span><b>${st.total} days</b></div>
  </article>`;
}
// "Today's Income": what was paid into the wallet as earnings since 00:00 of the region's own day (Uganda: UTC+3).
var PT_EARN_TYPES = ['cashback', 'commission', 'team_reward', 'promocode', 'mission_salary', 'mission_deposit_reward'];
function ptRegionOffsetMs(){ return (Number(REGION && REGION.utcOffsetMin) || 0) * 60000; }
function ptTodayIncome(){
  const off = ptRegionOffsetMs(), day = Math.floor((Date.now() + off) / 86400000);
  let sum = 0;
  (STATE.transactions || []).forEach(t => {
    if (PT_EARN_TYPES.indexOf(t.type) < 0) return;
    const ms = typeof t.createdAt === 'number' ? t.createdAt : Date.parse(t.createdAt && t.createdAt._seconds ? t.createdAt._seconds * 1000 : t.createdAt);
    if (Number.isFinite(ms) && Math.floor((ms + off) / 86400000) === day) sum += Number(t.amount) || 0;
  });
  return sum;
}
// Time left until the next 00:00 of the region's day, as "HH:MM:SS".
function ptTimeToMidnight(){
  const s = 86400 - Math.floor(((Date.now() + ptRegionOffsetMs()) / 1000) % 86400);
  const pad = n => String(n).padStart(2, '0');
  return pad(Math.floor(s / 3600) % 24) + ':' + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60);
}
var _ptClockTimer = null;
function ptStartIncomeClock(){
  if (_ptClockTimer) { clearInterval(_ptClockTimer); _ptClockTimer = null; }
  _ptClockTimer = setInterval(() => {
    const root = document.querySelector('.pt-cd .pt-fc');
    if (!root || STATE.page !== 'assets') { clearInterval(_ptClockTimer); _ptClockTimer = null; return; }
    ptFlipClockSet(root, ptTimeToMidnight());
  }, 1000);
}
function paintAssets(loading){
  // Running products first, newest first inside each group; the id is the last tie-break so the order never shuffles between refreshes.
  const owned = (STATE.investments || []).filter(i => i.status === 'active' || i.status === 'matured').sort((x, y) =>
    (x.status === 'active' ? 0 : 1) - (y.status === 'active' ? 0 : 1)
    || (new Date(y.createdAt || 0).getTime() || 0) - (new Date(x.createdAt || 0).getTime() || 0)
    || String(x.id || '').localeCompare(String(y.id || '')));
  const a = STATE.account || {};
  const html = `
<div class="pt-head">Orders</div>
<div class="v-page pt-orders">
  <section class="pt-cd">
    <h2>Earnings Countdown</h2>
    <p>Daily settlement at 00:00</p>
    ${ptFlipClockHtml(ptTimeToMidnight())}
    <div class="pt-inc"><div><b>Today's Income</b><i id="ptToday">${esc(vMoney2(ptTodayIncome()))}</i></div><div><b>Total Income</b><i id="incomeTotal">${esc(vMoney2(a.totalEarned))}</i></div></div>
  </section>
  <div class="mg-orders" id="ownedAssets">${loading ? '<div class="pt-none"><b>Loading...</b></div>' : owned.length ? owned.map(vOwnedCardHtml).join('') : _investmentsLoadFailed ? loadFailHtml('assets') : '<div class="pt-none"><b>No records</b><span>Buy your first product to start earning</span></div>'}</div>
</div>`;
  $('pageHost').innerHTML = html;
  ptStartIncomeClock();
  if (_ptCountOnPaint === 'assets') {
    _ptCountOnPaint = '';
    ptCountUp($('ptToday'), ptTodayIncome(), 1100);
    ptCountUp($('incomeTotal'), (STATE.account || {}).totalEarned, 1100);
  } else { const t = $('incomeTotal'); if (t) t.dataset.val = String(Number((STATE.account || {}).totalEarned) || 0); }
}
// ── REFERRAL (own tab) ──
// Owner: "introduce a new nav icon just between my products and team, it is
// called referral, so here there will be that banner and referral link and
// instruction, so remove them from team and they come here to this tab."
// The address the member's INVITE LINK should carry -- a random one of his
// own country's short addresses, picked by the server. Asked for on every
// open of this screen, which is the point: owner "not login session changes
// rotation of a link but also clicking back there to that section of copying
// referral code, a server looks for another subdomain of that very country
// randomly." Going back to Referral picks again, so over time every one of
// the country's addresses gets used.
//
// The last pick is kept in STATE so a repeat open paints the rotated link
// immediately instead of flashing the address the member is browsing on.
// And a failure is silent by design: the link falls back to this origin,
// which is always a working invite.
function refreshShareHost(){ STATE.shareHost = ''; return Promise.resolve(); }
// With a wildcard domain set up on the server (deploy/set-wildcard.sh), every invite link is made on a NEW random 4-character address of it, such as
// https://tg9s.yourdomain.com/#/inviteRegister?invitecode=2K3CT : every time the Share page paints and every time Copy is tapped, so a link is never the
// same twice and no one address carries all the sharing. Every such address serves the very same app. Without that setting, or when the app is open on
// some other address (the IP preview), the link keeps the address the app is open on, which always works.
var SHARE_LABEL_RESERVED = ['mail', 'smtp', 'imap', 'pop3', 'ftp1', 'cpan', 'whm1', 'host', 'test', 'demo'];
function shareRand(n){
  try { const a = new Uint32Array(1); window.crypto.getRandomValues(a); return a[0] % n; } catch (_) { return Math.floor(Math.random() * n); }
}
function shareLabel(){
  const letters = 'abcdefghijklmnopqrstuvwxyz', all = letters + '0123456789';
  let out = letters[shareRand(letters.length)];   // exactly 4 characters, like tg9s, mcqk or once
  for (let i = 1; i < 4; i++) out += all[shareRand(all.length)];
  return SHARE_LABEL_RESERVED.indexOf(out) >= 0 ? shareLabel() : out;
}
function shareOrigin(){
  const d = String((STATE.settings || {}).shareDomain || '').toLowerCase();
  const h = location.hostname.toLowerCase();
  if (!d || location.protocol !== 'https:' || !(h === d || h.endsWith('.' + d))) return location.origin;
  return 'https://' + shareLabel() + '.' + d;
}
// ── MY ASSETS investment helpers ──
var _investmentsLoadFailed = false;
var MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function fmtDay(value){
  if (!value) return '—';
  const d = new Date(typeof value === 'number' ? value : String(value));
  if (isNaN(d.getTime())) return '—';
  // Owner: "even bought should carry the time bought at."
  // 24-hour, matching the ledger's own "23:21" and the plan countdown's
  // HH:MM:SS -- one clock across the app, and no am/pm to misread. The
  // getters are LOCAL, so a member in Kampala sees the moment they tapped
  // Buy, not the UTC instant the server wrote down.
  const t = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  return d.getDate() + ' ' + MONTHS_SHORT[d.getMonth()] + ' ' + d.getFullYear() + ' at ' + t;
}
// Deposit result marks, traced from the owner's two pictures (green tick badge, red cross badge).



// The owner's tick and cross DRAW THEMSELVES on the deposit result page (ring runs round clockwise, the disc pops in, the tick is written
// from its left end to its tip; the cross: the disc pops in, then one bar after the other). They are drawn on a <canvas> with plain
// compositing, NOT with CSS-animated SVG masks: animated masks are not repainted reliably by every phone's browser (iPhones, older Android
// browsers) and the mark simply did not appear there. A canvas works the same on every phone. Checked frame by frame against the SVG-mask
// version it replaced: 32 moments each, at most 0.011 % of the pixels differ (edge smoothing). The artwork is the owner's, untouched.
// When the animation ends (or can never run: no canvas, a hidden tab, an error) the mark is replaced by the plain finished SVG above,
// which has no masks and no animation, so the final picture is always correct. It plays even when the phone asks for reduced motion:
// it is a 1.5 second status mark, and the owner wants it everywhere.
var DR_GREEN = '#42af3c', DR_RED = '#ea2c2c';

function drBezier(x1, y1, x2, y2) {            // CSS cubic-bezier(x1,y1,x2,y2) as a function of time 0..1
  var cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx, cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  return function (t) {
    if (t <= 0) return 0; if (t >= 1) return 1;
    var s = t, i, x, d;
    for (i = 0; i < 8; i++) { x = ((ax * s + bx) * s + cx) * s - t; d = (3 * ax * s + 2 * bx) * s + cx; if (Math.abs(x) < 1e-6 || Math.abs(d) < 1e-6) break; s -= x / d; }
    if (s < 0 || s > 1) { var lo = 0, hi = 1; s = t; for (i = 0; i < 24; i++) { x = ((ax * s + bx) * s + cx) * s; if (x < t) lo = s; else hi = s; s = (lo + hi) / 2; } }
    return ((ay * s + by) * s + cy) * s;
  };
}
var DR_E_RING = drBezier(.5, 0, .25, 1), DR_E_TICK = drBezier(.4, 0, .2, 1), DR_E_POP = drBezier(.2, .9, .3, 1.15), DR_E_OUT = drBezier(0, 0, .58, 1);




// the artwork, seen only through a mask drawn by `maskFn` (white = shown, destination-out = hidden)




var _drToken = 0;
// A failed payment: once the cross has been drawn it shakes and the phone buzzes (once per drawing).
function failShake(box, tok){
  if (tok !== _drToken || !box.classList) return;
  box.classList.remove('dep-shake'); void box.offsetWidth; box.classList.add('dep-shake');
  try { if (navigator.vibrate) navigator.vibrate([90, 50, 90, 50, 160]); } catch (e) {}
}

// Waiting for the payment: a green phone badge with rings spreading from it (the page around it is the timeline, see setDepositStatusPending).
var DEPOSIT_POLL_FLOW = '<div class="pl-radar" role="img" aria-label="Waiting for your approval"><i></i><i></i><i></i>'
  + '<b><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="2.5" width="11" height="19" rx="2.6"/><path d="M10.5 18.5h3"/></svg></b></div>';
// Only the waiting states use the open (card-less) layout; the tick and the cross keep the card.
function setPayLive(on){ const c = $('depStatusIcon') && $('depStatusIcon').closest('.pay-card'); if (c) c.classList.toggle('pl', !!on); }
// The result pages use the same open layout as the waiting page: only the badge and the timeline change (green ticks; or the last circle red).
var PL_BADGE_OK = '<div class="pl-radar ok" role="img" aria-label="Payment received"><b><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 12.5l4.2 4.2L18.5 8"/></svg></b></div>';
var PL_BADGE_BAD = '<div class="pl-radar bad" role="img" aria-label="Payment not completed"><b><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6.5v7.2"/><path d="M12 17.3v.2"/></svg></b></div>';
var _depPendingPhone = '';
function plStep(cls, head, text){ return '<li class="' + cls + '"><b>' + esc(head) + '</b><span>' + esc(text) + '</span></li>'; }
function plAmount(bad){ return _depPendingAmount ? '<div class="pl-amt' + (bad ? ' bad' : '') + '">' + esc(fmtUGX(_depPendingAmount)) + '</div>' : ''; }
function plSent(){ return plStep('done', 'Request sent', _depPendingAmount && _depPendingPhone ? 'A payment request for ' + fmtUGX(_depPendingAmount) + ' was sent to ' + _depPendingPhone + '.' : 'A payment request was sent to your phone.'); }
// Every figure this screen shows about one plan, worked out in one place so
// the summary band and the row can never disagree.
function planStats(inv){
  // The CYCLE LENGTH -- the "of 30" in "Day 4 of 30", and what daysLeft counts
  // down from. /invest/create always stamps payoutsTotal onto the investment,
  // so that is the answer for anything bought through the app -- but a document
  // written before that field existed has none, and a bare `|| 150` would then
  // measure a plan against 150 days regardless of the cycle it was actually
  // sold on: a 30-day plan four days in would say "Day 4 of 150" and claim 146
  // days left. Fall back through the product's own cycle and the platform
  // default before resorting to a constant.
  const prod = (STATE.products || []).find(p => p.key === inv.tierKey);
  const total = Number(inv.payoutsTotal)
    || (prod && Number(prod.cycle))
    || 150;
  const made = Math.min(Number(inv.payoutsMade) || 0, total);
  const expected = Number(inv.expectedReturn) || 0;
  const earned = Number(inv.paidOut) || 0;
  const matured = inv.status === 'matured' || made >= total;
  return {
    total, made, expected, earned, matured,
    amount: Number(inv.amount) || 0,
    daily: Number(inv.dailyPayout) || 0,
    // What is still to come. Clamped at zero so a plan that over-paid by a
    // rounding shilling never shows a negative "left to earn".
    remaining: Math.max(0, expected - earned),
    daysLeft: Math.max(0, total - made),
    createdMs: new Date(inv.createdAt || Date.now()).getTime(),
  };
}
function myAssetRowHtml(inv){
  const st = planStats(inv);
  const p = (STATE.products || []).find(x => x.key === inv.tierKey) || {};
  const name = inv.tierLabel || p.name || 'Product';
  const initial = esc(String(name || '?').trim()[0] || '?');
  const thumb = p.image
    ? `<img src="${esc(p.image)}" alt="" onerror="this.outerHTML='&lt;span&gt;${initial}&lt;/span&gt;'">`
    : `<span>${initial}</span>`;
  const progress = st.total > 0 ? Math.max(0, Math.min(100, (st.made / st.total) * 100)) : 0;
  return `
  <div class="my-asset-row ${st.matured ? 'done' : ''}">
    <div class="mar-head">
      <div class="mar-thumb">${thumb}</div>
      <div class="mar-id">
        <div class="mar-name">${esc(name)}</div>
        <div class="mar-date">${esc(fmtDay(inv.createdAt))}</div>
      </div>
      <span class="mar-status">${st.matured ? 'Completed' : 'Ongoing'}</span>
    </div>
    <div class="mar-values">
      <div><span>Invested</span><b class="mono">${fmtUGXCents(st.amount)}</b></div>
      <div><span>Earned</span><b class="mono">${fmtUGXCents(st.earned)}</b></div>
      <div><span>${st.matured ? 'Return' : 'Daily'}</span><b class="mono">${fmtUGXCents(st.matured ? st.expected : st.daily)}</b></div>
    </div>
    <div class="mar-progress"><i style="width:${progress}%"></i></div>
    <div class="mar-foot">
      <span>${st.matured ? 'Finished' : `Day ${st.made} of ${st.total}`}</span>
      <span>${st.matured ? fmtUGXCents(st.expected) + ' paid' : fmtUGXCents(st.remaining) + ' remaining'}</span>
    </div>
  </div>`;
}
function myAssetsInnerHtml(){
  const investments = (STATE.investments || []).filter(i => i.status === 'active' || i.status === 'matured');
  if (!Array.isArray(STATE.investments) && _investmentsLoadFailed) {
    return '<div class="my-assets-empty">Could not load your products.</div>';
  }
  if (!investments.length) return '<div class="my-assets-empty">No investments yet. Browse Products to get started.</div>';
  return '<div class="my-assets-list">' + investments.map(myAssetRowHtml).join('') + '</div>';
}
function paintMyAssetsInner(){
  const box = document.getElementById('myAssetsInner');
  if (!box) return;
  box.innerHTML = myAssetsInnerHtml();
}
// Live-ticking "Next cashback in HH:MM:SS" on each active plan card. Cleared
// whenever the page changes away from My Products so it never keeps ticking
// (and leaking a timer) in the background.
// ── TEAM ──
// subagent-audit-caught: same stale-deferred-repaint class Round 59 fixed
// for Withdraw/Withdrawal Accounts, here on Team -- tapping
// a not-yet-cached level then quickly tapping back to an already-cached
// one used to let the first tap's slow fetch land later and silently
// replace the visible (different) level's member list.
var _activeTeamLevel = null;
var _teamMembersAt = {};            // when each level's list was last fetched
var _teamMembersFailed = {};        // a level whose last fetch failed (shows a retry line, never "no members")
var TEAM_LIST_FRESH_MS = 15000;
// Shows the level's list at once when one is already held, then (if it is older than a few seconds
// or was never fetched) fetches a fresh one and repaints it. A failed fetch keeps whatever list was
// on screen and is never stored as an empty list: that used to read "No members at this level yet"
// for the rest of the session after one dropped connection.
window.switchTeamLevel = async function(level){
  _activeTeamLevel = level;
  document.querySelectorAll('.pt-lvp').forEach(el => el.classList.toggle('on', Number(el.dataset.level) === level));
  const lvc = $('ptLvCard'); if (lvc) lvc.innerHTML = ptLevelCardHtml(level, false);
  const held = !!STATE.teamMembers[level];
  if (held) renderTeamMembers(level);
  else { const box = $('teamMembersBox'); if (box) box.innerHTML = teamLoadingHtml(); }
  if (held && Date.now() - (_teamMembersAt[level] || 0) < TEAM_LIST_FRESH_MS) return;
  const r = await api('/team/members?level=' + level);
  if (r.status === 'success') { STATE.teamMembers[level] = r.members; _teamMembersAt[level] = Date.now(); _teamMembersFailed[level] = false; }
  else _teamMembersFailed[level] = true;
  if (_activeTeamLevel === level && STATE.page === 'network') renderTeamMembers(level);
};
// The "Loading . . ." word, centred, while a list is in flight.
function teamLoadingHtml(){ return '<div class="list-loading">' + NAV_LOADER + '</div>'; }
// The small "Loading..." word shown inside a page while its data arrives: plain grey text, standing still, as on the owner's screens.
var NAV_LOADER = '<span class="mg-loadtxt">Loading...</span>';
function maskPhone(phone){
  // "706****1455": the first three and last four digits of the local number
  // (country code and leading zero dropped), enough to recognise your own
  // referral and not a usable number.
  let d = String(phone||'').replace(/\D/g,'');
  const dc = dial();
  if (d.slice(0, dc.length) === dc) d = d.slice(dc.length);
  d = d.replace(/^0+/, '');
  if (d.length < 7) return phone || '';
  return d.slice(0, 3) + '****' + d.slice(-4);
}
// The exact date and time a member joined, as his mockup prints it:
// "07/09/2026 01:21" -- day/month/year and a 24-hour clock.
//
// Owner: "l told you removed joined one day ago, l need that exactly what
// you're seeing." This replaced a timeAgo() that answered "1 day ago" /
// "2 weeks ago". Relative wording reads more naturally in most places, but
// not in a downline list: it is the one screen where a member wants to know
// WHEN somebody joined, to line it up against a commission they were paid,
// and "2 weeks ago" cannot be lined up against anything.
//
// Built from the local date parts rather than toLocaleString(): the format
// has to be the one in his mockup on every phone, and a locale string is
// whatever the handset is set to -- an en-US phone would print 9/7/2026 and
// silently swap the day and the month on a screen about money.
function joinedStamp(ts){
  if (!ts) return '';
  const ms = typeof ts === 'object' && ts.seconds ? ts.seconds*1000 : new Date(ts).getTime();
  if (!ms || isNaN(ms)) return '';
  const d = new Date(ms);
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth()+1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function renderTeamMembers(level){
  const members = STATE.teamMembers[level] || [];
  const box = $('teamMembersBox');
  if (!box) return;
  const cnt = $('mgLvCount'); if (cnt) cnt.textContent = String(members.length || (((STATE.teamStats || {}).team || {})['l' + level]) || 0);
  const ttl = $('mgLvTitle'); if (ttl) ttl.textContent = 'Level ' + level;
  if (!STATE.teamMembers[level] && _teamMembersFailed[level]) { box.innerHTML = '<div class="mg-nomem" onclick="switchTeamLevel(' + level + ')">Could not load your team</div>'; return; }
  if (!members.length) { box.innerHTML = '<div class="mg-nomem">No Members</div>'; return; }
  // The owner's Team list (his screenshot, design-ref/c27): one white card holding a pale row per member -- the hidden number on the left, "Joined <date time>"
  // in the middle and the amount that member has bought on the right (₦0.00 until a product is purchased) -- and "No More" under it.
  box.innerHTML = '<div class="pt-mlist">' + members.map(m => `
  <article class="mg-mem">
    <b class="mg-mem-ph">${esc(m.phoneMasked || maskPhone(m.phone))}</b>
    <span class="mg-mem-join">Joined ${esc(joinedStamp(m.createdAt))}</span>
    <b class="mg-mem-amt">${esc(vMoney2(m.invested))}</b>
  </article>`).join('') + '</div><div class="pt-nomore">No More</div>';
}
async function renderNetwork(){
  const hadCache = !!STATE.teamStats;
  if (hadCache) paintNetwork();
  else paintNetwork(true);   // the page at once with "..." in the figures and "Loading..." in the list
  const [r, sr] = await Promise.all([api('/team/stats'), api('/salary/status')]);
  if (sr.status === 'success') STATE.salary = sr;
  if (r.status === 'success') STATE.teamStats = r;
  else if (!hadCache) STATE.teamStats = { referralCode:'', commRates:{l1:0,l2:0,l3:0}, team:{l1:0,l2:0,l3:0}, totalTeam:0, teamCommission:0, teamDeposits:0, levelCommission:{l1:0,l2:0,l3:0} };
  if (STATE.page !== 'network') return;
  paintNetwork();
}
function ptTeamData(){ return STATE.teamStats || { referralCode:'', commRates:{}, team:{}, totalTeam:0, teamCommission:0, teamDeposits:0, levelCommission:{}, levelPurchase:{} }; }
// The Level card: the chosen level's four figures.
function ptLevelCardHtml(level, loading){
  const t = ptTeamData(), rates = t.commRates || {}, team = t.team || {}, lc = t.levelCommission || {}, lp = t.levelPurchase || {};
  const tile = (v, l) => `<div><b>${v}</b><span>${l}</span></div>`;
  return `<div class="pt-lvh"><em>Lv${level}</em><h3>Level ${level}</h3></div>
    <div class="pt-lvg">${tile(loading ? '...' : (Number(team['l' + level]) || 0), 'Members')}${tile((rates['l' + level] != null ? rates['l' + level] : 0) + '%', 'Rate')}${tile(loading ? '...' : esc(vMoney2(lc['l' + level])), 'Commission')}${tile(loading ? '...' : esc(vMoney2(lp['l' + level])), 'Purchase')}</div>`;
}
function ptTeamBodyHtml(loading){
  if (STATE.teamTab === 'reward') return ptRewardHtml();
  const level = _activeTeamLevel || 1;
  _activeTeamLevel = level;
  return `<section class="pt-lvcard" id="ptLvCard">${ptLevelCardHtml(level, loading)}</section>
  <div class="pt-lvrow">${[1, 2, 3].map(n => `<button type="button" class="pt-lvp${level === n ? ' on' : ''}" data-level="${n}" onclick="switchTeamLevel(${n})">Level ${n}</button>`).join('')}</div>
  <div id="teamMembersBox">${loading ? '<div class="mg-nomem">Loading...</div>' : ''}</div>`;
}
function ptRewardHtml(){
  const S = STATE.salary;
  if (!S) return '<div class="v-empty" onclick="renderNetwork()">Could not load. Tap to try again.</div>';
  const tiers = S.tiers || [], total = Number(S.total) || 0, days = Number(S.accruedDays) || 0;
  const money = n => cur() + ' ' + numGroup(n, false);
  return tiers.map((tier, i) => {
    const pct = tier.target > 0 ? Math.min(100, Math.floor(total / tier.target * 100)) : 0;
    const btn = !tier.reached ? '<button type="button" class="pt-rbtn" onclick="navigatePage(\'promo\')">Share to Unlock</button>'
      : days > 0 ? '<button type="button" class="pt-rbtn go" onclick="claimSalary(this)">Claim</button>'
      : '<button type="button" class="pt-rbtn done" onclick="notify(\'Nothing to claim yet. Come back tomorrow.\')">Claimed</button>';
    return `<section class="pt-tier"><header><span>Tier ${i + 1}</span><b>+${esc(money(tier.reward))}</b></header>
      <div class="pt-tb"><div class="pt-tl"><span>Consumption Threshold</span><b>${esc(money(tier.target))}</b></div>
      <div class="pt-bar"><i style="width:${pct}%"></i></div>
      <div class="pt-tn">${esc(money(Math.min(total, tier.target)))} / ${esc(money(tier.target))}</div>${btn}</div></section>`;
  }).join('') || '<div class="v-empty">No rewards yet.</div>';
}
window.ptTeamTab = function(tab){
  STATE.teamTab = tab === 'reward' ? 'reward' : 'team';
  if (STATE.page !== 'network') return;
  document.querySelectorAll('.pt-tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === STATE.teamTab));
  const body = $('ptTeamBody'); if (body) body.innerHTML = ptTeamBodyHtml(false);
  if (STATE.teamTab === 'team') switchTeamLevel(_activeTeamLevel || 1);
};
function paintNetwork(loading){
  const t = ptTeamData();
  const html = `
<div class="v-page pt-team">
  <div class="pt-tb-banner">${STATE.teamBanner ? `<img src="${esc(STATE.teamBanner)}" alt="" onerror="this.style.display='none'">` : ''}
    <div class="pt-tstat"><div><span>Team Count</span><b>${loading ? '...' : Number(t.totalTeam) || 0}</b></div><div><span>Total Commission</span><b>${loading ? '...' : esc(vMoney2(t.teamCommission))}</b></div></div></div>
  <div class="pt-tabs"><button type="button" data-tab="team" class="${STATE.teamTab === 'reward' ? '' : 'on'}" onclick="ptTeamTab('team')">Team</button><button type="button" data-tab="reward" class="${STATE.teamTab === 'reward' ? 'on' : ''}" onclick="ptTeamTab('reward')">Reward</button></div>
  <div id="ptTeamBody">${ptTeamBodyHtml(loading)}</div>
</div>`;
  $('pageHost').innerHTML = html;
  if (!loading && STATE.teamTab !== 'reward') switchTeamLevel(_activeTeamLevel || 1); // shows a held list at once and refreshes it if it is old
}

// ── PROMOTION (own tab): banner, share link, share buttons, invitation reward ──
async function renderPromo(){
  const hadCache = !!STATE.teamStats;
  if (hadCache) paintPromo();
  else $('pageHost').innerHTML = '<div style="min-height:55vh;display:flex;align-items:center;justify-content:center;">' + NAV_LOADER + '</div>';
  const [r, sr] = await Promise.all([api('/team/stats'), api('/salary/status')]);
  if (sr.status === 'success') STATE.salary = sr;
  if (r.status === 'success') STATE.teamStats = r;
  else if (!hadCache) STATE.teamStats = { referralCode:'', commRates:{l1:0,l2:0,l3:0}, team:{l1:0,l2:0,l3:0}, totalTeam:0, teamDeposits:0, levelCommission:{}, levelPurchase:{} };
  if (STATE.page !== 'promo') return;
  paintPromo();
}
function promoLink(){
  const t = STATE.teamStats || {};
  const code = (STATE.account || {}).referralCode || t.referralCode || '';
  return code ? `${shareOrigin()}/#/inviteRegister?invitecode=${encodeURIComponent(String(code).toUpperCase())}` : '';
}
var _promoLink = '';
function paintPromo(){
  const t = STATE.teamStats || {};
  const rates = t.commRates || {};
  _promoLink = promoLink();
  const r1 = rates.l1 != null ? rates.l1 : 0, r2 = rates.l2 != null ? rates.l2 : 0, r3 = rates.l3 != null ? rates.l3 : 0;
  const img = STATE.promoBanner || STATE.homeBanner;
  const html = `
<div class="pt-share">
  <div class="pt-shero${img ? '' : ' pt-shero-empty'}">${img ? `<img src="${esc(img)}" alt="" onerror="this.style.display='none'">` : ''}</div>
  <section class="pt-scard">
    <div class="pt-srow"><b>Commission Rates</b><span>Lv1 ${r1}% · Lv2 ${r2}% · Lv3 ${r3}%</span></div>
    <div class="pt-surl"><p><b>Share URL:</b> <span class="pt-purl">${esc(_promoLink || '—')}</span></p><button type="button" class="pt-copy" data-copy-group="promo" onclick="copyPromoLink(this)">Copy</button></div>
    <div class="pt-sdesc"><b>Reward Description</b><p>You can earn more revenue by sharing the link: LV1=${r1}% LV2=${r2}% LV3=${r3}% Hurry and invite your friends to join us!</p></div>
    <div class="pt-sbtns"><button type="button" class="wa" onclick="shareTo('whatsapp')">${MGI.whatsapp}<span>WhatsApp</span></button><button type="button" class="tg" onclick="shareTo('telegram')">${MGI.telegram}<span>Telegram</span></button></div>
  </section>
</div>`;
  $('pageHost').innerHTML = html;
}
// Every Copy and every share makes a NEW random address and shows it, so the link on the page is the one that was copied or sent.
function refreshPromoLink(){
  const fresh = promoLink();
  if (!fresh) return;
  _promoLink = fresh;
  const el = document.querySelector('.pt-purl'); if (el) el.textContent = fresh;
}
window.copyPromoLink = function(btn){
  if (!_promoLink) return notify('Your invite link is not ready yet.');
  if (!rapidTapGuardOk('copy:promo')) return;
  refreshPromoLink();
  writeClipboard(_promoLink, btn || null);
};
window.shareTo = function(where){
  if (!_promoLink) return notify('Your invite link is not ready yet.');
  if (!rapidTapGuardOk('share:' + where)) return;
  refreshPromoLink();
  // The words that go with the link are the admin's (Settings > Share message); {app} stands for the app's name.
  const words = String(((STATE.settings || {}).shareMessage) || 'Join me on {app}').replace(/\{app\}/gi, brandName());
  const msg = words + ': ' + _promoLink;
  const u = encodeURIComponent(_promoLink), m = encodeURIComponent(msg);
  const urls = {
    telegram: 'https://t.me/share/url?url=' + u + '&text=' + encodeURIComponent(words),
    whatsapp: 'https://wa.me/?text=' + m,
    facebook: 'https://www.facebook.com/sharer/sharer.php?u=' + u,
    x: 'https://twitter.com/intent/tweet?text=' + m,
    tiktok: 'https://www.tiktok.com/',
  };
  // TikTok has no way to hand it a link, so the link is copied first and TikTok opens for the member to paste it.
  if (where === 'tiktok' && navigator.clipboard) navigator.clipboard.writeText(_promoLink).catch(() => {});
  window.open(urls[where], '_blank', 'noopener');
};

// ── SALARY (the Reward tab of Myteam) ──
var _salaryBusy = false;
window.claimSalary = async function(btn){
  if (_salaryBusy) return;
  _salaryBusy = true; if (btn) btn.disabled = true;
  const r = await post('/salary/claim', {});
  _salaryBusy = false;
  if (r && r.stale) return;
  const fresh = await api('/salary/status');
  if (fresh.status === 'success') STATE.salary = fresh;
  if (STATE.page === 'network') { const body = $('ptTeamBody'); if (body && STATE.teamTab === 'reward') body.innerHTML = ptTeamBodyHtml(false); }
  if (r && r.status === 'success') {
    if (STATE.account) STATE.account.walletBalance = r.walletBalance;
    refreshTransactionsCache().catch(() => {});
    return notify(fmtUGX(r.amount) + ' added to your wallet');
  }
  notify((r && r.message) || 'Could not claim the reward right now');
};
// ── MISSION CENTER — REMOVED ──
// Owner: "remove mission center". The screen, both claim flows and the
// /mission/status fetch that used to run on every boot are gone, and so are
// the three server routes behind them (see server.js) -- two of those
// credited money, so unlinking the button alone would have left a removed
// feature still paying out to anyone who knew the URL.
//
// What deliberately STAYS: the mission_salary / mission_deposit_reward
// labels in TX_TYPE_LABELS. Members who claimed these were really paid, and
// their Records must keep reading properly; dropping the labels would show
// old rows as raw type keys.

// Real bug fixed: these had no guard against firing more than once per tap
// -- unlike every other button in this app (witSubmitBtn, bankSaveBtn,
// etc.) neither disables itself, so a double-registered
// tap (common on touchscreens -- synthetic mouse+touch click events, or an
// actual accidental double-tap) called navigator.share()/clipboard.writeText
// again immediately, which is what the owner saw as "many share requests."
// Keyed by action so tapping copy-code then copy-link a moment apart still
// both work -- only truly rapid repeats of the SAME action are dropped.
const _lastTapAt = {};
function rapidTapGuardOk(key){
  const now = Date.now();
  if (now - (_lastTapAt[key] || 0) < 700) return false;
  _lastTapAt[key] = now;
  return true;
}
// Owner: "think you can see closely how the copied link is, so the copy turns
// to tick."
// Copying confirms ITSELF, on the control that was tapped: the copy icon
// becomes a tick and a labelled button's text becomes "Copied", both reverting
// after a moment. Nothing interrupts.
//
// This is the right answer for copy specifically, and it replaces the alert
// card that copy briefly used. An alert has to be dismissed, and on the
// Referral screen -- where the whole point is to copy and get straight out to
// WhatsApp -- an OK tap between the member and sharing is friction for a result
// they can already see. Every other message in the app still uses the card;
// copy is the one action whose outcome is visible where it happened.
// The owner's own clipboard artwork, replacing the hand-drawn SVG: "l want the
// copy SVG icon to be replaced by that image l made myself." Cut out of the
// JPEG he sent by flood-filling the white PAGE inward from the border -- a
// global white->transparent would have punched holes in the clipboard's own
// white paper, the same trap the spin-wheel cutout hit. Height is set in CSS
// (.url-row .copy-ic img), not here, so the tile and the art stay in step.
var COPY_TICK = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
  + 'stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5.2 5.2L20 7"/></svg>';
function flashCopiedOne(btn){
  if (!btn) return;
  const isIconBtn = btn.classList.contains('copy-ic') || btn.classList.contains('mp-copybtn');
  // A copy while the flash is STILL RUNNING restarts it rather than being
  // ignored. It used to return early, which was harmless when each control
  // flashed alone but is a real fault now they are grouped: tapping the icon
  // ~1.5s after the button did nothing, and the tick then disappeared 300ms
  // later on the FIRST tap's timer -- so the second tap read as having failed.
  // The original content is kept from the first flash in _copyBefore, so a
  // restart can never capture 'Copied' (or the tick) as the thing to restore
  // and leave the control permanently stuck on it.
  if (btn._copyRevert) clearTimeout(btn._copyRevert);
  else btn._copyBefore = btn.innerHTML;
  btn.innerHTML = isIconBtn ? COPY_TICK : btn.classList.contains('pt-copy') ? 'Copied \u2713' : 'Copied';
  btn.classList.add('copied');
  btn._copyRevert = setTimeout(() => {
    btn.innerHTML = btn._copyBefore;
    btn.classList.remove('copied');
    btn._copyRevert = null;
  }, 1800);
}
// Owner: "why when l copy link with the other icon and shows tick, the button
// which says copy invite link doesn't show copied, yet l wanted it to say it in
// all cases whether clicking copy icon or button."
//
// Two controls, ONE action: the icon and the labelled button on Referral copy
// the same link, so whichever is tapped, both have to acknowledge it. Only the
// tapped one used to, which reads as the other one not having worked.
//
// Grouped by an explicit `data-copy-group`, NOT by "flash everything nearby":
// copyText() is shared with the manual-pay screen's own copy buttons (account
// number, account name), which sit in one container and copy DIFFERENT text --
// a proximity rule would tick the account name when someone copied the number.
// Only controls that copy the same thing carry the same group.
function flashCopied(btn){
  const group = btn && btn.getAttribute && btn.getAttribute('data-copy-group');
  if (!group) return flashCopiedOne(btn);
  const all = document.querySelectorAll('[data-copy-group="' + group + '"]');
  for (let i = 0; i < all.length; i++) flashCopiedOne(all[i]);
}
function writeClipboard(text, btn){
  if (!navigator.clipboard) return notify('Could not copy');
  navigator.clipboard.writeText(text)
    .then(() => flashCopied(btn))
    // A failure has nothing visible to show for itself, so it still needs
    // saying -- and that is exactly what the alert card is for.
    .catch(() => notify('Could not copy'));
}
// The button is taken from the event rather than passed in by every call site:
// the markup already routes through onclick, so `this` is the control that was
// tapped, and no template needs editing to opt in.
window.copyText = function(text){
  if (!text || !rapidTapGuardOk('copy:' + text)) return;
  const btn = (typeof event !== 'undefined' && event && event.currentTarget)
    ? event.currentTarget : null;
  writeClipboard(text, btn);
};
// shareReferral() was here and is gone. Owner: "copying invite link just
// copys not sharing" -- the button is labelled COPY INVITE LINK and was
// opening the phone's share sheet instead, so it now goes through copyText()
// like the small copy icon directly above it.
//
// It was also broken in a way the label hid: the button called
// shareReferral() with NO argument, so the shared message read "...sign up
// with my link: undefined". Nobody would have noticed from inside the app --
// the wrong text only appeared after it had already been sent to someone.

// Rebuilt to the owner's Account mockup -- a profile card over a refinery
// photo (the account screen's own 'profilecard' image slot was removed by
// the owner -- see server.js's POTATO_IMAGE_SLOTS comment -- so the card
// falls back to the shared auth-hero photo via .acct-card's own
// --acct-card-image default) and a plain row list with coloured-circle SVG
// icons replacing the old settings list's coloured squares + Potato raster
// PNGs.
//
// Deliberately NOT built into this round: a per-member profile PHOTO upload
// (the mockup's camera badge) and phone-number editing (the mockup's pencil
// icon) -- both are real new backend features (per-member file storage; a
// changed phone re-derives the synthetic auth email, see phoneToEmail()'s
// own "must match server.js exactly" warning), not a visual swap, and
// nothing this session was asked to build them. The avatar here is a plain
// placeholder glyph until that's actually scoped. Same reasoning for the
// mockup's "Membership Level / VIP 1" card -- there is no tier system
// anywhere in this codebase (thresholds, benefits, what "View Benefits"
// would even show), so it is not invented here; flagged in CLAUDE.md.
// The red list icons of the My page, drawn as SVG.
var PT_MENU_IC = {
  bars: '<svg viewBox="-3 -3 30 30" aria-hidden="true"><path fill="currentColor" d="M3 21V9h4.2v12zm6.9 0V3h4.2v18zm6.9 0v-7.5H21V21z"/></svg>',
  mail: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M2.5 5.5A1.5 1.5 0 0 1 4 4h16a1.5 1.5 0 0 1 1.5 1.5v.7L12 12.4 2.5 6.2z"/><path fill="currentColor" d="M2.5 8.3 12 14.5l9.5-6.2V18.5A1.5 1.5 0 0 1 20 20H4a1.5 1.5 0 0 1-1.5-1.5z"/></svg>',
  lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 10V7a5 5 0 0 1 10 0v3h1.2c.9 0 1.8.8 1.8 1.8v8.4c0 1-.9 1.8-1.8 1.8H5.8C4.9 22 4 21.2 4 20.2v-8.4C4 10.8 4.9 10 5.8 10zm2.2 0h5.6V7a2.8 2.8 0 0 0-5.6 0zM12 14.2a1.6 1.6 0 0 0-.8 3v1.6h1.6v-1.6a1.6 1.6 0 0 0-.8-3z"/></svg>',
  shield: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 1.8 3.6 5v6c0 5.4 3.6 9.7 8.4 11.2 4.8-1.5 8.4-5.8 8.4-11.2V5z"/><path fill="#fff" d="M12 4.7 6.1 7v4H12zM12 11h5.9c-.3 3.6-2.5 6.7-5.9 8.2z"/></svg>',
  card: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.2" y="5.2" width="17.6" height="13.6" rx="2" fill="none" stroke="currentColor" stroke-width="2.2"/><rect x="3.2" y="9.6" width="17.6" height="3.3" fill="currentColor"/></svg>',
  bell: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2.5a1.5 1.5 0 0 1 1.5 1.5v.6c3 .7 4.8 3.2 4.8 6.2v3.6l1.9 2.7v.9H3.8v-.9l1.9-2.7v-3.6c0-3 1.8-5.5 4.8-6.2V4A1.5 1.5 0 0 1 12 2.5zM9.6 19.2h4.8a2.4 2.4 0 0 1-4.8 0z"/></svg>',
  down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M10.5 3h3v8.3l3-3 2.1 2.1L12 16.9 5.4 10.4l2.1-2.1 3 3z"/><path fill="currentColor" d="M4 19h16v2.4H4z"/></svg>',
  info: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.4" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="7.6" r="1.4" fill="currentColor"/><path d="M12 10.8v6.6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  chev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
};
function ptMenuRow(icon, label, fn, badge){
  return `<button type="button" class="pt-mrow" onclick="${fn}"><span class="ic">${PT_MENU_IC[icon]}</span><b>${label}</b>${badge ? `<em id="msgBadge"${mgUnread() ? '' : ' style="display:none"'}>${mgUnread()}</em>` : ''}<span class="ch">${PT_MENU_IC.chev}</span></button>`;
}
// The My page balances count up from zero to their figure each time the page is shown (a visit, or coming back from Balance Detail, Messages ...).
function ptCountUp(el, target, ms, from){
  if (!el) return;
  const f = Number(from) || 0, token = (el._cu = (el._cu || 0) + 1);
  el._to = Number(target) || 0; el.dataset.val = String(el._to);
  const done = () => { el.textContent = vMoney2(el._to); delete el.dataset.counting; ptFitValues(); };
  if (el._to === f || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) { done(); return; }
  el.dataset.counting = '1';
  const t0 = performance.now();
  const step = now => {
    if (el._cu !== token || !el.isConnected) return;
    const k = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - k, 3);
    if (k >= 1) { done(); return; }
    el.textContent = vMoney2(Math.round((f + (el._to - f) * e) * 100) / 100);
    requestAnimationFrame(step);
  };
  el.textContent = vMoney2(f);
  requestAnimationFrame(step);
}
// A figure that changes while its page is open (a deposit lands, an earning is paid) runs up from what it showed to the new amount.
// A figure that is still counting just takes the new amount as its end point.
function ptSetMoney(el, target){
  if (!el) return;
  const to = Number(target) || 0;
  if (el.dataset.counting) { el._to = to; el.dataset.val = String(to); return; }
  if (el.dataset.val === undefined) { el.textContent = vMoney2(to); el.dataset.val = String(to); return; }
  if (Number(el.dataset.val) !== to) ptCountUp(el, to, 900, Number(el.dataset.val));
}
// The run-up from zero belongs to arriving on a page (a tab tap, or coming back from a page opened from it), not to every repaint of it.
var _ptCountOnPaint = '';
function ptCountMyBalances(){
  if (STATE.page !== 'account') return;
  const a = STATE.account || {};
  ptCountUp($('myBalance'), a.walletBalance, 1100);
  ptCountUp($('myIncome'), a.totalEarned, 1100);
}
async function renderAccount(){
  if (!STATE.account) return paintAccountFailed();
  const a = STATE.account || {};
  const st = STATE.settings || {};
  const op = Number(st.myBannerOpacity), bl = Number(st.myBannerBlur);
  const phone = localDigits(a.phone) ? '0' + localDigits(a.phone).replace(/^0+/, '') : (walletLocalPhone(a.phone) || formatPhoneDisplay(a.phone));
  const avatar = STATE.profileLogo ? `<img src="${esc(STATE.profileLogo)}" alt="" onerror="this.style.display='none'">` : '';
  const html = `
<div class="v-page pt-my">
  <section class="pt-mybanner">
    ${STATE.myBanner ? `<img class="pt-mysize" src="${esc(STATE.myBanner)}" alt="" style="opacity:${Number.isFinite(op) ? Math.min(100, Math.max(0, op)) / 100 : 1};filter:blur(${Number.isFinite(bl) ? Math.min(40, Math.max(0, bl)) : 0}px);transform:scale(${1 + (Number.isFinite(bl) ? Math.min(40, Math.max(0, bl)) : 0) / 160})">` : ''}
    <div class="pt-mid"><span class="pt-av">${avatar}</span><b>${esc(phone)}</b><i>VIP ${Number(a.vipLevel) || 0}</i></div>
    <div class="pt-mystat"><div><span>Balance</span><b id="myBalance" class="pt-fit">${esc(vMoney2(a.walletBalance))}</b></div><div><span>Total Income</span><b id="myIncome" class="pt-fit">${esc(vMoney2(a.totalEarned))}</b></div></div>
  </section>
  <div class="pt-menu">
    ${ptMenuRow('bars', 'Balance Detail', "openTransactionStatement('all')")}
    ${ptMenuRow('mail', 'Messages', 'openMessagesSheet()', true)}
    ${ptMenuRow('lock', 'Login Password', 'openChangeLoginPasswordSheet()')}
    ${ptMenuRow('shield', 'Trade Password', 'openChangeTradePasswordSheet()')}
    ${ptMenuRow('card', 'Bank Card', 'openWalletSheet()')}
    ${ptMenuRow('bell', 'Gift Code', 'openChestSheet()')}
    ${ptMenuRow('down', 'APP Download', 'openDownloadPage()')}
    ${ptMenuRow('info', 'About Us', 'openAboutPage()')}
  </div>
  <button type="button" class="pt-logout" onclick="doLogout()">Log Out</button>
</div>`;
  $('pageHost').innerHTML = html;
  ptFitValues();
  if (_ptCountOnPaint === 'account') { _ptCountOnPaint = ''; ptCountMyBalances(); }
  else { const b1 = $('myBalance'), b2 = $('myIncome'); if (b1) b1.dataset.val = String(Number(a.walletBalance) || 0); if (b2) b2.dataset.val = String(Number(a.totalEarned) || 0); }
  // The unread count on the Messages row comes from the inbox; ask for it once per visit (never blocks the paint).
  api('/messages').then(r => { if (r.status === 'success') { STATE.messages = r.messages; updateMessageBadge(); } }).catch(() => {});
}
// The My page when the profile could not be read: the banner with its avatar, a dash and VIP0, "Failed to load profile" and a Retry pill (the owner's picture).
function paintAccountFailed(){
  const op = Number((STATE.settings || {}).myBannerOpacity), bl = Number((STATE.settings || {}).myBannerBlur);
  const avatar = STATE.profileLogo ? `<img src="${esc(STATE.profileLogo)}" alt="" onerror="this.style.display='none'">` : '';
  $('pageHost').innerHTML = `
<div class="v-page pt-my">
  <section class="pt-mybanner pt-mybad">
    ${STATE.myBanner ? `<img class="pt-mysize" src="${esc(STATE.myBanner)}" alt="" style="opacity:${Number.isFinite(op) ? Math.min(100, Math.max(0, op)) / 100 : 1};filter:blur(${Number.isFinite(bl) ? Math.min(40, Math.max(0, bl)) : 0}px);transform:scale(${1 + (Number.isFinite(bl) ? Math.min(40, Math.max(0, bl)) : 0) / 160})">` : ''}
    <div class="pt-mid"><span class="pt-av">${avatar}</span><b>\u2013</b><i>VIP0</i></div>
    <div class="pt-myerr"><p>Failed to load profile</p><button type="button" onclick="retryLoad('account')">Retry</button></div>
  </section>
  <button type="button" class="pt-logout" onclick="doLogout()">Log Out</button>
</div>`;
}
// "+256 742 730 382" -- the shape the mockups show, from whatever the
// server stored (0742730382 / 256742730382 / +256742730382 all normalise).
// The dialling code is the region's; the 3-3-3 grouping is applied only to
// a 9-digit local number, so a country with a different length gets its
// digits printed whole rather than half-grouped.
function formatPhoneDisplay(phone){
  let d = String(phone || '').replace(/\D/g, '');
  if (!d) return '';
  const dc = dial();
  if (d.slice(0, dc.length) === dc) d = d.slice(dc.length);
  d = d.replace(/^0+/, '');
  const groups = d.length === 9 ? d.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3') : d;
  return dialPlus() + ' ' + groups;
}

// Short names the Wallet page shows ("MTN", "Airtel"); the server still gets the full provider name.
function walShort(n){ n = String(n || ''); return n === 'MTN Mobile Money' ? 'MTN' : n === 'Airtel Money' ? 'Airtel' : n; }
function walProviders(){ return ['MTN Mobile Money', 'Airtel Money']; }
function walFull(label){
  const t = String(label || '').trim().toLowerCase();
  if (!t) return '';
  return walProviders().find(p => p.toLowerCase() === t || walShort(p).toLowerCase() === t) || '';
}
function walNetwork(){ const inp = $('walProvider'); return inp ? (inp.dataset.network || walFull(inp.value)) : ''; }
window.openWalletSheet = async function(){
  openSheet('Bank Cards', '');
  renderWalletSheet();
  const r = await api('/bank/list');
  if (r.status === 'success') STATE.bankAccounts = r.accounts;
  else if (!Array.isArray(STATE.bankAccounts)) STATE.bankAccounts = [];
  if (_openSheetTitle === 'Bank Cards') paintWalletParts();
};
var BANK_CARD_MAX = 5;
// The dark card shows the active card, or the empty message while there is none.
function vWalletCardHtml(w){
  if (!w) return '<div class="pt-bcard empty"><b>No bank cards yet</b><span>Fill the form below to add one</span></div>';
  return `<div class="pt-bcard"><b class="n">${esc(w.network)}</b><b class="d">${esc(ptCardNumber(w))}</b><span class="h">Cardholder\uff1a ${esc(String(w.holder || '').toUpperCase())}</span></div>`;
}
function ptCardNumber(w){ const d = walletDestDisplay(w); return /^\d+$/.test(d) ? d.replace(/(\d{4})(?=\d)/g, '$1 ') : d; }
function ptMaskedCard(w){ const d = String(walletDestDisplay(w)); return d.length > 8 ? d.slice(0, 4) + ' **** ' + d.slice(-4) : d; }
function ptOtherCardsHtml(){
  const list = STATE.bankAccounts || [], cur0 = witSelectedWallet();
  const others = list.filter(a => !cur0 || a.id !== cur0.id);
  if (!others.length) return '';
  return `<h4 class="pt-oth">Other Cards</h4>` + others.map(a => `<button type="button" class="pt-ocard" onclick="selectBankCard('${esc(a.id)}')"><span class="ic">\ud83d\udcb3</span><b>${esc(ptMaskedCard(a))}</b><i>${esc(a.network)}</i><em>${esc(String(a.holder || '').toUpperCase())}</em></button>`).join('');
}
window.selectBankCard = async function(id){
  if (!rapidTapGuardOk('bankcard:' + id)) return;
  const r = await post('/bank/select', { id });
  if (r.status !== 'success') return notify(r.message || 'Could not change the card');
  const fresh = await api('/bank/list');
  if (fresh.status === 'success') STATE.bankAccounts = fresh.accounts;
  if (_openSheetTitle === 'Bank Cards') paintWalletParts();
};
function walletLocalPhone(phone){
  let d = String(phone || '').replace(/\D/g, '');
  const dc = dial();
  if (d.slice(0, dc.length) === dc) d = d.slice(dc.length);
  d = d.replace(/^0+/, '');
  return d ? '0' + d : '';
}
// A saved card's number is always an MTN / Airtel phone number, shown with its leading zero.
function walletDestDisplay(w){ return w ? walletLocalPhone(w.phone) : ''; }
function walProviderOptionsHtml(){
  return walProviders().map(p => `<button type="button" class="prov-opt" onclick="pickProvider('${esc(p)}')">${esc(walShort(p))}</button>`).join('');
}
// Only the cards and the counter: the typed fields are never touched.
function paintWalletParts(){
  const n = (STATE.bankAccounts || []).length;
  const box = $('walCardBox'); if (box) box.innerHTML = vWalletCardHtml(witSelectedWallet()) + ptOtherCardsHtml();
  const cnt = $('walCount'); if (cnt) cnt.textContent = n + '/' + BANK_CARD_MAX;
  const hc = $('sheetCount'); if (hc) { hc.textContent = String(n); hc.style.display = n ? 'flex' : 'none'; }
}
function renderWalletSheet(){
  $('sheetBody').innerHTML = `<div class="pt-bk">
    <div id="walCardBox"></div>
    <div class="pt-addh"><i></i><h3>Add Bank Card</h3><span id="walCount">0/${BANK_CARD_MAX}</span></div>
    <label class="pt-fl-l" for="walProvider">Bank Name</label>
    <div class="prov-pick" id="walProviderPick">
      <div class="pt-fbox"><span class="ic">\ud83c\udfe6</span><input id="walProvider" type="text" autocomplete="off" placeholder="Type to search bank" oninput="filterProviders()" onfocus="openProviderList()" onclick="openProviderList()"></div>
      <div class="prov-list" id="walProviderList">${walProviderOptionsHtml()}</div>
    </div>
    <label class="pt-fl-l" for="walPhone">Bank Account</label>
    <div class="pt-fbox"><span class="ic hash">#</span><input id="walPhone" type="text" inputmode="numeric" autocomplete="off" placeholder="Enter card number" oninput="handleWalDestInput(this)"></div>
    <label class="pt-fl-l" for="walHolder">Cardholder</label>
    <div class="pt-fbox"><span class="ic">\ud83d\udc64</span><input id="walHolder" type="text" maxlength="60" autocomplete="name" enterkeyhint="done" placeholder="Cardholder name"></div>
    <button class="pt-save" id="walSaveBtn" type="button" onclick="submitWallet()">Save Card</button>
  </div>`;
  paintWalletParts();
}
window.openProviderList = function(){ const box = $('walProviderPick'); if (box) box.classList.add('open'); };
window.filterProviders = function(){
  const inp = $('walProvider'); if (!inp) return;
  if (inp.dataset.network) inp.dataset.lastNetwork = inp.dataset.network;   // remembered so pickProvider knows what was chosen before
  inp.dataset.network = '';
  const q = inp.value.trim().toLowerCase();
  document.querySelectorAll('#walProviderList .prov-opt').forEach(b => { b.style.display = !q || b.textContent.toLowerCase().includes(q) ? '' : 'none'; });
  openProviderList();
};
window.pickProvider = function(name){
  const inp = $('walProvider');
  if (inp) { inp.value = walShort(name); inp.dataset.network = name; inp.dataset.lastNetwork = name; }
  const box = $('walProviderPick');
  if (box) box.classList.remove('open');
  document.querySelectorAll('#walProviderList .prov-opt').forEach(b => { b.style.display = ''; });
};
window.handleWalDestInput = function(el){ sanitizePhoneInput(el); };
// Tapping anywhere else closes it, the way a real picker behaves. Bound once
// on the document rather than per-render so repainting the panel cannot leave
// duplicate listeners behind.
document.addEventListener('click', function(e){
  const box = document.getElementById('walProviderPick');
  if (box && box.classList.contains('open') && !box.contains(e.target)) box.classList.remove('open');
});
window.submitWallet = async function(){
  const network = walNetwork();
  const phone = $('walPhone').value;
  const holder = $('walHolder').value.trim();
  if (!network || !String(phone).trim() || !holder) return notify('Please fill in all fields');
  if ((STATE.bankAccounts || []).length >= BANK_CARD_MAX) return notify('You can save up to ' + BANK_CARD_MAX + ' bank cards.');
  if (String(phone).replace(/\D/g, '').length < 9) return notify('Enter a valid wallet account number.');
  const btn = $('walSaveBtn');
  btn.disabled = true;
  const r = await post('/bank/save', { holder, network, phone });
  btn.disabled = false;
  if (r.status !== 'success') return notify(r.message || 'Could not save your card.');
  return finishWalletSave();
};
// Tail of a successful /bank/save.
async function finishWalletSave(){
  const fresh = await api('/bank/list');
  STATE.bankAccounts = fresh.status === 'success' ? fresh.accounts : (STATE.bankAccounts || []);
  notify('Saved');
  if (_openSheetTitle === 'Bank Cards') {
    ['walProvider', 'walPhone', 'walHolder'].forEach(id => { const el = $(id); if (el) { el.value = ''; if (el.dataset) { el.dataset.network = ''; el.dataset.lastNetwork = ''; } } });
    paintWalletParts();
  }
}
// ── NOTIFY DIALOG (Notify.dc.html) ──
// The app-wide validation alert: dimmed backdrop, amber warning triangle,
// message, one pill OK. Replaces notify() for anything the member must
// acknowledge before continuing (toast is still used for confirmations
// that need no acknowledgement, e.g. "Copied", "Wallet saved").
// `onClose` lets a caller do something once the member has acknowledged the
// dialog -- used by the insufficient-balance path to send them to Deposit.
// It is one-shot and cleared on close, so a later plain notify() can never
// inherit a stale callback.
var PT_NOTICE_BAD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10.2"/><path d="M8.7 8.7l6.6 6.6M15.3 8.7l-6.6 6.6"/></svg>';
var PT_NOTICE_OK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10.2"/><path d="M7.9 12.4l2.9 2.9 5.4-5.8"/></svg>';
var _notifyOnClose = null;
var _notifyTimer = null;
function dismissNotify(){
  if (_notifyTimer) { clearTimeout(_notifyTimer); _notifyTimer = null; }
  $('notifyBg').classList.remove('show');
  _notifyOnClose = null;
}
window.notify = function(message, onClose){
  $('notifyMsg').textContent = String(message || '');
  // Good news gets the circled tick, everything else the circled cross (the owner's refusal notice).
  const good = /success|✓|copied|saved|done|now running|redeemed|submitted|sent|changed|processing|updated|claimed|unlocked|bound|added to your wallet/i.test(String(message || '')) && !/not |fail|could not|cannot|insufficient|invalid|incorrect|wrong|isn't|already|status changed|bind it|add a payout|need /i.test(String(message || ''));
  const ic = $('notifyIc');
  if (ic) { ic.innerHTML = good ? PT_NOTICE_OK : PT_NOTICE_BAD; ic.className = 'notify-ic ' + (good ? 'ok' : 'err'); }
  _notifyOnClose = typeof onClose === 'function' ? onClose : null;
  if (_notifyTimer) { clearTimeout(_notifyTimer); _notifyTimer = null; }
  $('notifyBg').classList.add('show');
  // The notice goes away by itself (it fades and shrinks out); a tap outside the card closes it sooner.
  const stay = 2500;   // every notice stays 2.5 seconds, whatever its length (owner)
  // A notice that carries a follow-up ("redirecting to deposit...") runs it when it closes, by itself or by a tap outside.
  _notifyTimer = setTimeout(() => { _notifyTimer = null; closeNotify(); }, stay);
};
window.closeNotify = function(){
  if (_notifyTimer) { clearTimeout(_notifyTimer); _notifyTimer = null; }
  $('notifyBg').classList.remove('show');
  const fn = _notifyOnClose;
  _notifyOnClose = null;
  if (fn) fn();
};

// The Help dialog (Home "Help Me", My "Help Me"): the two contact links the
// admin already sets -- Channel = the Telegram group, Service = Telegram
// customer service -- in a centred dialog.


// ── TRANSACTION STATEMENT ──
// One professional statement surface. Categories stay horizontal at the top;
// no balance hero, avatar discs, record cards or separate deposit/withdraw/
// earnings screens.
var _statementCat = 'all';
var _statementShown = 10;
function statementCategoryMatch(cat, t){
  if (cat === 'withdraw') return t.type === 'withdraw';
  if (cat === 'income') return t.type !== 'withdraw' && recordsRowAmount(t) > 0;
  if (cat === 'expense') return t.type !== 'withdraw' && recordsRowAmount(t) < 0;
  return true;
}
function statementDescription(t){
  if (t.type === 'deposit') return 'Deposit';
  if (t.type === 'withdraw') return 'Withdraw';
  if (t.type === 'cashback') return 'Cashback';
  if (t.type === 'commission') return 'Commission';
  if (t.type === 'promocode') return 'Treasure Chest';
  if (t.type === 'order_gift') return 'Order Gift';
  if (t.type === 'welcome_bonus') return 'Welcome Bonus';
  if (t.type === 'team_reward') return 'Team Reward';
  if (t.type === 'mission_salary') return 'Team Reward';
  if (t.type === 'mission_deposit_reward') return 'Mission Reward';
  if (t.type === 'admin_credit') return 'Deposit';
  if (t.type === 'invest' || t.type === 'investment') return 'Purchase';
  if (t.type === 'investment_refund') return 'Refund';
  return 'Transaction';
}
// The pill under a row: orange while it is still moving, green once paid,
// red when it failed. A finished credit shows a plain blue description line
// instead (the screens do the same for "Daily Earnings").
function statementChip(t){
  // A deposit is "Online Deposit" once it is paid and stays "Pending Deposit" in every other case, a failed or abandoned payment included (owner: never "Failed").
  if (t.type === 'deposit') {
    const dep = String(t.status || '').toLowerCase();
    return /pend|process|await|initiating|creating|sending|fail|declin|reject|cancel|error|expire|timeout|unpaid/.test(dep) || !dep ? { text: 'Pending Deposit', cls: 'wait' } : { text: 'Online Deposit', cls: '' };
  }
  // The words in a free-text description only describe a deposit or a withdrawal; on a credit or a gift they are the admin's note.
  const describes = t.type === 'deposit' || t.type === 'withdraw';
  const raw = String(t.status || '').toLowerCase() + (describes ? ' ' + String(t.description || '').toLowerCase() : '');
  if (/fail|declin|reject|cancel|error/.test(raw)) return { text: 'Failed', cls: 'bad' };
  if (/pend|process|await|initiating|creating|sending/.test(raw)) return { text: t.type === 'deposit' ? 'Pending Deposit' : t.type === 'withdraw' ? 'Processing Payment' : 'Pending', cls: 'wait' };
  if (t.type === 'withdraw') return { text: 'Paid', cls: 'ok' };
  return null;
}
function statementAmountText(t){
  const amt = recordsRowAmount(t);
  return (amt < 0 ? '-' : '+') + vMoney2(Math.abs(amt));
}
// The small emoji in front of a record (the owner's Balance Detail shows one for the Treasure Chest row) and the word after the time.
var PT_REC_ICON = { promocode: '\ud83c\udf8f', order_gift: '\ud83c\udf81', deposit: '\ud83d\udce5', admin_credit: '\ud83d\udce5', withdraw: '\ud83d\udce4', cashback: '\ud83d\udcc8', commission: '\ud83e\udd1d', team_reward: '\ud83c\udfc6', mission_salary: '\ud83c\udfc6', invest: '\ud83d\uded2', investment: '\ud83d\uded2' };
var PT_REC_NOKIND = ['invest', 'investment', 'investment_refund'];
var PT_REC_KIND = { deposit: 'Deposit', admin_credit: 'Deposit', withdraw: 'Withdraw', cashback: 'Income', commission: 'Team', team_reward: 'Team', mission_salary: 'Team' };
function statementDayKey(t){
  const pad = n => String(n).padStart(2, '0');
  const ms = t.createdAt ? new Date(t.createdAt).getTime() : NaN;
  if (Number.isFinite(ms)) { const d = new Date(ms); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`; }
  const m = String(t.date || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[2]}/${m[1]}/${m[3]}` : String(t.date || '');
}
function statementClock(t){
  const pad = n => String(n).padStart(2, '0');
  const ms = t.createdAt ? new Date(t.createdAt).getTime() : NaN;
  if (Number.isFinite(ms)) { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
  return String(t.time || '').slice(0, 5);
}
function renderStatement(){
  const body = $('statementBody');
  if (!body) return;
  const all = (STATE.transactions || []).filter(t => statementCategoryMatch(_statementCat, t));
  if (!all.length) { body.innerHTML = _recordsLoadFailed && !(STATE.transactions || []).length ? loadFailHtml('records') : '<div class="pt-norec">No records</div>'; return; }
  const groups = []; const idx = {};
  all.forEach(t => { const k = statementDayKey(t); if (!(k in idx)) { idx[k] = groups.length; groups.push({ k, rows: [] }); } groups[idx[k]].rows.push(t); });
  body.innerHTML = groups.map(g => `
    <div class="pt-day"><i></i><b>${esc(g.k)}</b><span>${g.rows.length} rows</span></div>
    <article class="pt-rec"><div class="pt-rec-in">${g.rows.map(t => {
      const amt = recordsRowAmount(t);
      const chip = statementChip(t);
      const kind = chip ? chip.text : (PT_REC_KIND[t.type] || (PT_REC_NOKIND.indexOf(t.type) >= 0 ? '' : 'Other'));   // a purchase shows only its time
      return `<div class="pt-rec-row"><span class="ic">${PT_REC_ICON[t.type] || '\ud83e\uddfe'}</span>
        <div class="m"><b>${esc(statementDescription(t))}</b><small>${esc(statementClock(t))}${kind ? ` \u00b7 <em class="${chip ? chip.cls : ''}">${esc(kind)}</em>` : ''}</small></div>
        <span class="a ${amt < 0 ? 'out' : 'in'}">${esc(statementAmountText(t))}</span></div>`;
    }).join('')}</div></article>`).join('');
}
window.switchStatementCategory = function(cat){
  if (!['all','income','expense','withdraw'].includes(cat)) return;
  _statementCat = cat; _statementShown = 10;
  const tabs = $('statementTabs');
  if (tabs) tabs.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.cat === cat));
  renderStatement();
};
window.openTransactionStatement = async function(cat){
  _statementCat = ['all','income','expense','withdraw'].includes(cat) ? cat : 'all';
  _statementShown = 10;
  const hadCache = Array.isArray(STATE.transactions);
  const bal = (STATE.account && STATE.account.walletBalance) || 0;
  openSheet('Balance Detail', `
    <div class="pt-rb"><span>Current Balance</span><b id="recBalance">${esc(vMoney2(bal))}</b></div>
    <div class="pt-rtabs" id="statementTabs">
      ${[['all','All'],['income','Income'],['expense','Expense'],['withdraw','Withdraw']].map(([k, l]) => `<button data-cat="${k}" class="${_statementCat === k ? 'on' : ''}" onclick="switchStatementCategory('${k}')">${l}</button>`).join('')}
    </div>
    <div id="statementBody"></div>`);
  $('sheetBg').classList.add('v-rec-page');
  if (hadCache) renderStatement();
  else $('statementBody').innerHTML = '<div class="list-loading">' + NAV_LOADER + '</div>';
  const r = await api('/transactions');
  if (r.status === 'success') {
    STATE.transactions = r.transactions;
    STATE.transactionsTruncated = !!r.truncated;
    _recordsLoadFailed = false;
  } else if (!hadCache) {
    STATE.transactions = [];
    _recordsLoadFailed = true;
  }
  if (_openSheetTitle === 'Balance Detail') renderStatement();
};
// Compatibility for post-withdraw flows and any stale call sites.
window.openBalanceRecordSheet = function(tab){
  const cat = tab === 'deposit' ? 'deposit' : tab === 'withdraw' ? 'withdraw' : 'all';
  return openTransactionStatement(cat);
};

// ── MESSAGES (MessagesList.dc.html / Messages.dc.html) ──
// Real inbox, backed by /messages (admin-authored broadcasts) with per-
// member read state. Snow has no equivalent -- see CLAUDE.md.
window.openMessagesSheet = async function(){
  const hadCache = Array.isArray(STATE.messages);
  openSheet('Messages', '<div id="msgBody"></div>');
  if (hadCache) renderMessagesList();
  else $('msgBody').innerHTML = '<div class="list-loading">' + NAV_LOADER + '</div>';
  const r = await api('/messages');
  if (r.status === 'success') { STATE.messages = r.messages; _messagesLoadFailed = false; }
  else if (!hadCache) { STATE.messages = []; _messagesLoadFailed = true; }
  if (_openSheetTitle === 'Messages') renderMessagesList();
  updateMessageBadge();
};
function renderMessagesList(){
  const box = $('msgBody');
  if (!box) return;
  const list = STATE.messages || [];
  if (!list.length) { box.innerHTML = _messagesLoadFailed ? loadFailHtml('messages') : '<div class="pt-emp"><span>\ud83d\udced</span><b>No messages</b></div>'; return; }
  box.innerHTML = '<div class="reveal-in">' + list.map((m, i) => `
    <button class="mg-mrow${m.read ? ' read' : ''}" onclick="openMessageDetail(${i})">
      <span class="av"></span>
      <span class="t">${esc(m.title || '')}</span>
      <span class="d">${esc(m.date || '')}<br>${esc(m.time || '')}</span>
      ${m.read ? '' : '<i class="dot"></i>'}
    </button>`).join('') + '</div>';
}
window.openMessageDetail = async function(index){
  const m = (STATE.messages || [])[index];
  if (!m) return;
  $('msgDetail').innerHTML = `
    <button class="xbtn" onclick="closeMessageDetail()" aria-label="Close">${MGI.x}</button>
    <div class="head">
      <span class="av"></span>
      <div>
        <h2>${esc(m.title || '')}</h2>
        <div class="date">${esc(m.date || '')} ${esc(m.time || '')}</div>
      </div>
    </div>
    <div class="ln"></div>
    ${m.body ? `<div class="content">${esc(m.body)}</div>` : ''}
    ${m.hasImage ? `<img class="mimg" src="${esc(API_BASE + '/public/message-image/' + encodeURIComponent(m.id))}" alt="" onerror="this.style.display='none'">` : ''}`;
  // Its own history entry, mirroring openSheet(). Without one, the phone Back
  // button consumed the Messages SHEET's entry instead and tore the list down
  // while leaving this popup floating over nothing -- the same "it won't go
  // away" the nav tap showed, by a different route. replaceState when it is
  // somehow already open, for openSheet()'s reason: stacking two entries for
  // one visible popup breaks the NEXT Back press as well.
  const detailWasOpen = $('msgDetailBg').classList.contains('show');
  $('msgDetailBg').classList.add('show');
  if (detailWasOpen) history.replaceState({ msgDetail: true }, '', '');
  else history.pushState({ msgDetail: true }, '', '');
  if (m.read) return;
  m.read = true;
  renderMessagesList();
  updateMessageBadge();
  await post('/messages/read', { messageId: m.id });
};
// The X goes through history too, so the popup has exactly ONE way to close
// and Back and the X cannot drift apart. popstate below does the actual
// hiding; the direct removal is only for a state that is not ours (nothing
// reaches it today, but a missing entry must still close the popup rather
// than trap the member behind it).
window.closeMessageDetail = function(){
  if (history.state && history.state.msgDetail) { history.back(); return; }
  $('msgDetailBg').classList.remove('show');
};
// Deliberate no-op (owner: "remove notification bell ... svgs in top right
// everywhere"). This used to paint an unread dot onto the top bar's bell
// button; that button no longer exists on ANY screen -- Messages is now
// reached from Account's own row list instead (acctRowHtml(ICONS.bell,
// ..., 'Messages', ..., 'openMessagesSheet()')), which has nowhere
// sensible to keep a live badge dot from every screen the way the top bar
// did. Kept as a callable no-op rather than deleted, since every call
// site (5+ spots across deposit/withdraw completion, page renders) would
// otherwise need its own guard -- same precedent as maybeShowAnnouncement()
// elsewhere in this file after its own feature was removed.
function updateMessageBadge(){
  const n = mgUnread();
  const dot = $('msgDot');
  if (dot) { dot.textContent = n > 99 ? '99+' : String(n); dot.style.display = n ? '' : 'none'; }
  const tile = $('msgBadge');
  if (tile) { tile.textContent = n > 99 ? '99+' : String(n); tile.style.display = n ? '' : 'none'; }
}

function vPwBox(id, placeholder, pin){
  return `<div class="pt-pbox"><input id="${id}" type="password" placeholder="${esc(placeholder)}"${pin ? ' inputmode="numeric" maxlength="6" autocomplete="one-time-code"' : ' autocomplete="off"'} oninput="ptPwClear()"></div>`;
}
window.ptPwClear = function(){ const e = $('ptPwErr'); if (e) e.textContent = ''; };
function ptPwError(msg){ const e = $('ptPwErr'); if (e) e.textContent = msg; }
window.openChangeLoginPasswordSheet = function(){
  openSheet('Change Login Password', `<div class="pt-pw">
    <label for="lpOld">Old Password</label>${vPwBox('lpOld', 'Enter old password')}
    <label for="lpNew">New Password</label>${vPwBox('lpNew', 'Enter new password')}
    <label for="lpNew2">Confirm New Password</label>${vPwBox('lpNew2', 'Confirm new password')}
    <p class="pt-pwerr" id="ptPwErr"></p>
    <div class="pt-pwbtns"><button type="button" class="no" onclick="closeSheet()">Cancel</button><button type="button" id="lpSaveBtn" onclick="submitLoginPasswordChange()">Change Password</button></div>
  </div>`);
};
window.submitLoginPasswordChange = async function(){
  const oldPass = $('lpOld').value;
  const newPass = $('lpNew').value;
  const confirm = $('lpNew2').value;
  if (!oldPass || !newPass || !confirm) return ptPwError('Please fill in all fields.');
  if (!newPass || newPass.length < 6) return notify('Your new password must be at least 6 characters.');
  if (newPass !== confirm) return notify('The two new passwords do not match.');
  if (newPass === oldPass) return notify('Your new password must be different from the old one.');
  const btn = $('lpSaveBtn');
  btn.disabled = true;
  try {
    await window.fbChangePassword(phoneToEmail((STATE.account || {}).phone), oldPass, newPass);
    // The member stays signed in (the server keeps this session). If the phone was told to remember the login, the remembered password is
    // replaced by the new one, so the next sign-in fills the right password instead of the old one.
    try { if (localStorage.getItem('potato_remembered') === '1') storeCredentialIfPossible(phoneToEmail((STATE.account || {}).phone), newPass, (STATE.account || {}).phone); } catch (_) {}
    btn.disabled = false;
    // Changing the password signs the member out (every session ends): they sign in again with the new password, their number already filled in.
    const phoneKept = (STATE.account || {}).phone;
    closeSheet({ fromAction: true });
    await window.doLogout();
    try { const pi = $('loginPhone'); const local = localDigits(phoneKept); if (pi && local) pi.value = '0' + local.replace(/^0+/, ''); } catch (_) {}
    notify('Login password changed. Please log in with your new password.');
  } catch (e) {
    btn.disabled = false;
    // fbErrMsg's wrong-credential copy names the phone number, which only
    // makes sense on the login screen -- here the only thing that can be
    // wrong is the old password itself.
    const code = e && e.code || '';
    notify(code === 'auth/invalid-credential' || code === 'auth/wrong-password'
      ? 'That is not your current login password.'
      : fbErrMsg(e));
  }
};

// ── CHANGE TRADE PASSWORD (ChangePassword.dc.html) ──
// The 6-digit PIN that confirms withdrawals. Potato uses 6 digits where Snow
// used 5 -- server.js validates the same length on /account/transaction-pin/change.
window.openChangeTradePasswordSheet = function(){
  // An account with no Trade Password yet is asked only for the new one.
  const first = (STATE.account || {}).hasTradePin === false;
  openSheet('Change Trade Password', `<div class="pt-pw">
    ${first ? '' : `<label for="tpOld">Old Password</label>${vPwBox('tpOld', 'Enter old password', true)}`}
    <label for="tpNew">New Password</label>${vPwBox('tpNew', 'Enter new password', true)}
    <label for="tpNew2">Confirm New Password</label>${vPwBox('tpNew2', 'Confirm new password', true)}
    <p class="pt-pwerr" id="ptPwErr"></p>
    <div class="pt-pwbtns one"><button type="button" id="tpSaveBtn" onclick="submitTradePasswordChange()">Change Password</button></div>
  </div>`);
};
window.submitTradePasswordChange = async function(){
  const first = (STATE.account || {}).hasTradePin === false;
  const oldPin = first ? '' : $('tpOld').value.trim();
  const newPin = $('tpNew').value.trim();
  const confirm = $('tpNew2').value.trim();
  if ((!first && !oldPin) || !newPin || !confirm) return ptPwError('Please fill in all fields.');
  if (!first && !/^\d{6}$/.test(oldPin)) return notify('Enter your current 6-digit trade password.');
  if (!/^\d{6}$/.test(newPin)) return notify('Your new trade password must be exactly 6 digits.');
  if (newPin !== confirm) return notify('The two new trade passwords do not match.');
  if (!first && newPin === oldPin) return notify('Your new trade password must be different from the old one.');
  const btn = $('tpSaveBtn');
  btn.disabled = true;
  const r = await post('/account/transaction-pin/change', first ? { newPin } : { oldPin, newPin });
  btn.disabled = false;
  if (r.status !== 'success') return notify(r.message || 'Could not change your trade password.');
  if (STATE.account) STATE.account.hasTradePin = true;
  closeSheet({ fromAction: true });
  notify(first ? 'Trade password saved' : 'Trade password changed');
};

// ── TREASURE CHEST (Chest.dc.html / ChestSuccess.dc.html) ──
// The bouncing chest on Home opens this full screen: glowing ring, bouncing
// chest artwork, key field, OPEN CHEST. A valid key flashes the green
// full-screen win state with the amount won and the new balance.
window.openChestSheet = function(){
  openSheet('Gift Code', `<div class="pt-gc">
    <section class="pt-gchero"><span class="pt-gcbox" aria-hidden="true">\ud83c\udf81</span><h2>Mystery Gift Code</h2><p>One free redeem per day</p></section>
    <section class="pt-gcform"><label for="chestKey">Gift Code Key</label>
      <div class="pt-gcin"><span>\ud83d\udddd\ufe0f</span><input id="chestKey" type="text" placeholder="${esc(((STATE.settings || {}).giftCodeHint) || 'Enter gift code (T-XXXX)')}" maxlength="14" autocapitalize="characters" autocomplete="off" spellcheck="false" oninput="this.value=this.value.toUpperCase()"></div>
      <button class="pt-gcgo" id="chestOpenBtn" type="button" onclick="submitChestKey()">Redeem Gift Code</button>
      <p class="pt-gchint">Result celebration shows after redeeming</p></section>
    <div class="pt-gcrec"><i></i><h3>Reward Records</h3></div>
    <p class="pt-gcnone" id="gcRecords">No more records</p>
  </div>`);
  $('sheetBg').classList.add('pt-pale-head');
  ptGiftCodeRecords();
};
// The member's own earlier redemptions, from the ledger rows already held (promocode credits).
function ptGiftCodeRecords(){
  const rows = (STATE.transactions || []).filter(t => t.type === 'promocode');
  const box = $('gcRecords'); if (!box) return;
  if (!rows.length) return;
  box.outerHTML = '<div class="pt-gcl">' + rows.slice(0, 20).map(t => `<div><span>${esc(statementDayKey(t))} ${esc(statementClock(t))}</span><b>+${esc(vMoney2(t.amount))}</b></div>`).join('') + '</div>';
}
window.submitChestKey = async function(){
  // No case-forcing here -- /redeem matches case-insensitively via
  // codeLower now, so whatever case the member typed or pasted reaches
  // the server unchanged and still resolves to the same code.
  const raw = ($('chestKey').value || '').trim();
  if (!raw) return notify('Please enter the gift code');
  const btn = $('chestOpenBtn');
  btn.disabled = true;
  const r = await post('/redeem', { code: raw });
  btn.disabled = false;
  if (r.status !== 'success') return notify(r.message || 'Wrong gift code');
  // Owner: "why does the congratulations card delay to appear when one has
  // claimed treasure code." Because it used to wait on TWO more round trips
  // after the redeem itself -- /account and the transactions cache -- purely
  // to print "New Balance". On a phone on mobile data with the backend cold,
  // that is seconds of nothing happening after a successful claim, which
  // reads as a failure.
  //
  // The credit is already confirmed by the time we are here, and the new
  // balance is simple arithmetic on a figure the app already holds, so the
  // card can open NOW. `walletBalance` comes back from /redeem itself where
  // the deployed backend sends it; the sum is the fallback for a backend
  // that has not been redeployed yet.
  const before = Number((STATE.account || {}).walletBalance) || 0;
  const reward = Number(r.reward) || 0;
  const after = Number.isFinite(Number(r.walletBalance)) && r.walletBalance !== null
    ? Number(r.walletBalance) : before + reward;
  if (STATE.account) STATE.account.walletBalance = after;
  // The win card from the owner's screenshot: Congratulations!, You won, the
  // amount, the new balance and COLLECT, over the blurred Treasure Chest page.
  $('chestKey').value = '';
  ptWinDialog(reward, after);
  // Now catch the app up in the background.
  refreshAfterWin().then(() => { if (_openSheetTitle === 'Gift Code') ptGiftCodeRecords(); });
};
// The two network refreshes a win needs. Deliberately not awaited by its
// caller -- the toast above already told the member it worked, so nothing
// on screen is waiting on either result.
async function refreshAfterWin(){
  try {
    const acc = await api('/account');
    if (acc.status === 'success') STATE.account = acc.account;
    await refreshTransactionsCache();
    if (STATE.page === 'home') renderHome();
    if (STATE.page === 'account') renderAccount();
  } catch (_) { /* STATE.account is already correct from the redeem response */ }
}

// Shared by every full-screen overlay (sheets, the announcement dialog, the
// gift-code modal, confirm dialogs) that needs to stop the page behind it
// from moving while it's open. Locking body.style.overflow alone isn't
// enough -- <html> (document.documentElement), not <body>, is the actual
// CSSOM "scrolling element" in standards mode, so a forceful drag/overscroll
// could still shift the whole layout viewport with only body locked,
// letting the fixed bottom-nav bar peek in at the edge during the bounce
// (owner: "when l scroll or force scroll the withdrawal screen it shows
// some bits of bottom navigation"). Locking both closes that gap.
function lockBodyScroll(){
  document.documentElement.style.overflow = 'hidden';
  document.body.style.overflow = 'hidden';
}
function unlockBodyScroll(){
  document.documentElement.style.overflow = '';
  document.body.style.overflow = '';
}

// ── SHEETS ──
// Tracks which sheet's content is currently showing in the one shared
// #sheetBody -- every deferred (post-await) repaint in a sheet's own open*
// function should check this, not merely "does #sheetBody exist" (it
// always does, it's a static element whose innerHTML just gets replaced).
// See openWithdrawSheet/openWalletSheet.
var _openSheetTitle = null;
// Used by showPage()'s deferred maybeShowAnnouncement() call to check whether
// the member has since opened a sheet or a confirm dialog on top of Home
// while the announcement's own wait was still in flight -- none of those
// are page navigations (STATE.page stays 'home' throughout), so
// _openSheetTitle alone isn't enough on its own.
// 30000 -> 30,000 (thousands separators for whole amounts printed inside a sentence); anything that is not a plain number is left as it is.
function isAnyOverlayOpen(){
  return !!(_openSheetTitle
    || ($('msgDetailBg') && $('msgDetailBg').classList.contains('show'))
    || ($('notifyBg') && $('notifyBg').classList.contains('show'))
    || ($('confirmBg') && $('confirmBg').classList.contains('show'))
    // The recharge result modal (Round 82) came after this guard was first
    // written and was never added to it -- it is exactly the kind of thing
    // the announcement must never land on top of, since it carries the
    // outcome of a payment the member is waiting on.
    || ($('depStatusBg') && $('depStatusBg').classList.contains('show'))
    // The announcement dialog itself, now that it's real again -- so a
    // second trigger (e.g. Withdraw closing right after Deposit already
    // opened it) can't stack a second announcement on top of the first.
    || ($('depStatusBg') && $('depStatusBg').classList.contains('show'))
    || ($('annBg') && $('annBg').classList.contains('show')));
}
// Owner: "when you logout and login again, the system freezes and no
// scrolling... only if you go back to homescreen and scroll so other pages
// scroll too" -- root-caused, not guessed at: maybeAnnounceOnEntry() fires
// the announcement dialog on every login (see its own comment below), which
// calls lockBodyScroll(); right around the same moment, bootFromNetwork()
// also fires a "Login successful" notify() toast. If the member closes the
// announcement WHILE that toast is still in its ~1.4s auto-dismiss window,
// closeAnnouncement() (and closeConfirm(), the same shape of bug) checked
// isAnyOverlayOpen() -- which counts a visible toast as "something is still
// in front" -- and skipped unlockBodyScroll() entirely. Nothing ever
// retries the unlock afterward, so document.documentElement/body stay
// permanently stuck at overflow:hidden (the app's real scroll mechanism --
// #pageHost/#app have no scroller of their own) for the rest of that
// session, on every page, until something else happens to call
// unlockBodyScroll() unconditionally (e.g. actually opening and closing a
// sheet, which is why visiting a page that involves one can look like it
// "fixes" things). Confirmed live: reproduced the exact toast-still-
// showing race against a real lockBodyScroll()/closeAnnouncement() pair and
// watched the unlock get silently skipped.
//
// The actual bug is isAnyOverlayOpen() answering two different questions
// with one check: "is there something else visible I shouldn't stack a new
// dialog on top of" (notifyBg/msgDetailBg are legitimately relevant there)
// vs. "is a REAL scroll lock still legitimately held" (notifyBg/msgDetailBg
// never call lockBodyScroll() at all, so a toast merely being visible must
// never be a reason to withhold unlockBodyScroll()). This narrower check
// answers only the second question.
function isScrollLockOverlayOpen(){
  return !!(_openSheetTitle
    || ($('confirmBg') && $('confirmBg').classList.contains('show'))
    || ($('depStatusBg') && $('depStatusBg').classList.contains('show'))
    || ($('annBg') && $('annBg').classList.contains('show')));
}

// Owner, superseding the earlier "fires when closing Deposit/Withdraw/Wallet
// back to Home" rule: "the dialog should appear when one also clicks back to
// home ie from assets to home, from network to home, and account to home, so
// remove those existing of from withdrawal, from deposit to home." The
// trigger is now a bottom-nav PAGE transition, not a sheet closing -- fires
// only when the tab just left is Assets, Network or Account and the tab just
// entered is Home. Deposit/Withdraw/Wallet are sheets, not STATE.page values
// (STATE.page stays 'home' the whole time one is open), so they were never
// part of this rule to begin with once the old sheet-based mechanism was
// removed -- nothing extra needed excluding them.
// Back on Home it waits for the page to appear first, briefly (as Cookie's does while its page loads), so the dialog never jumps in on top of a half-drawn page.
var _annNavTimer = null;
// The last Home icon finishes popping at 0.195 s delay + 0.36 s = 0.555 s; the dialog opens right then, never before.
var PT_ANN_AFTER_ICONS = 560;
function maybeAnnounceAfterHomeNav(prevPage, prevSheet){
  const fromSheet = prevSheet === 'Deposit' || prevSheet === 'Withdraw';   // the Home icon tapped while Deposit / Withdraw is open
  if (!fromSheet && ['assets', 'promo', 'network', 'salary', 'account'].indexOf(prevPage) === -1) return;
  if (isAnyOverlayOpen()) return;         // something else is already in front
  clearTimeout(_annNavTimer);
  _annNavTimer = setTimeout(() => {
    if (STATE.page !== 'home' || isAnyOverlayOpen()) return;   // left Home again, or something opened meanwhile
    maybeShowAnnouncement();
  }, PT_ANN_AFTER_ICONS);   // the Home icons pop first, then the dialog opens over them (a visit from another tab as much as a return from Deposit / Withdraw)
}
// Owner: the dialog also comes when Back is pressed on Deposit or Withdraw (the arrow in the page's header or the phone's Back button), like Cookie's.
// Only a plain Back: a sheet that closes itself after a submitted deposit/withdrawal, or because a tab was tapped, does not call this.
function maybeAnnounceAfterSheetBack(title){
  if (title !== 'Deposit' && title !== 'Withdraw') return;
  clearTimeout(_annNavTimer);
  // The Home icons pop in first (about 0.6 s), then the dialog opens over them.
  _annNavTimer = setTimeout(() => { if (!isAnyOverlayOpen()) maybeShowAnnouncement(); }, PT_ANN_AFTER_ICONS);
}
// Owner: "l also wanted the dialog to show when on every visit ie logging in
// again, registration like that." A second, independent trigger alongside
// the bottom-nav one above -- fires once, right after the loading screen
// comes down on login OR a fresh registration, from both places that ever
// happens (enterApp()'s cache-hit instant-boot path and bootFromNetwork()'s
// full-boot path). Not folded into maybeAnnounceAfterHomeNav() itself: that
// one deliberately requires a REAL prevPage of assets/network/account, which
// is never true on a fresh app entry (STATE.page is unset at that point), so
// this needed its own call rather than trying to make the nav-check pass.
function maybeAnnounceOnEntry(){
  if (isAnyOverlayOpen()) return;
  // Opening the app: the Home icons pop in first, then the dialog opens over them.
  clearTimeout(_annNavTimer);
  _annNavTimer = setTimeout(() => { if (!isAnyOverlayOpen()) maybeShowAnnouncement(); }, PT_ANN_AFTER_ICONS);
}
function openSheet(title, bodyHtml){
  dismissNotify();
  $('sheetBg').classList.remove('v-rec-page', 'mg-nohead', 'mg-chest-page', 'pt-pale-head');
  document.body.dataset.sheet = ({ 'Order Gifts': 'gifts', 'Download App': 'download', 'About Us': 'about', 'Deposit': 'deposit', 'Withdraw': 'withdraw' })[title] || '';
  $('sheetTitle').textContent = title;
  const hc = $('sheetCount'); if (hc) hc.style.display = 'none';
  $('sheetBody').innerHTML = bodyHtml;
  // Withdraw's empty-state "Add withdrawal account" link opens Withdrawal
  // Accounts FROM WITHIN the already-open Withdraw sheet -- both render into
  // this same shared overlay, so without this check a second history entry
  // stacks on top of the first for what looks like one continuously-open
  // sheet. A single Back tap (or the X button) then only unwound the newest
  // entry, closing the whole overlay in one tap instead of returning to
  // Withdraw, and left a stale extra entry behind that broke the NEXT Back
  // press too. Replacing the entry in place when a sheet is already open
  // keeps stack depth at 1 regardless of how many sheets got chained, so
  // one Back/X tap always does exactly one consistent thing: close.
  const alreadyOpen = $('sheetBg').classList.contains('show');
  // A page opens at its top, not wherever the previous page was scrolled to (they share this one overlay).
  if (!alreadyOpen) $('sheetBg').scrollTop = 0;
  $('sheetBg').classList.add('show');
  document.body.classList.add('sheet-open');
  _openSheetTitle = title;
  if (alreadyOpen) history.replaceState({ sheet: title }, '', '');
  else history.pushState({ sheet: title }, '', '');
  lockBodyScroll();
}
// opts.fromAction/opts.navigating used to gate whether closing a sheet could
// trigger the announcement dialog (a submitted withdrawal, a recharge
// handing over to its result modal, or a tab tap all had to suppress it).
// The announcement no longer fires from a sheet closing at all -- see
// maybeAnnounceAfterHomeNav() -- so both flags are now inert; left on their
// call sites rather than stripped out of several submit-button paths for a
// purely cosmetic cleanup. opts.keepHistory is the one flag this function
// still reads.
window.closeSheet = function(opts){
  const wasOpen = $('sheetBg').classList.contains('show');
  const wasTitle = _openSheetTitle;
  $('sheetBg').classList.remove('show');
  document.body.classList.remove('sheet-open'); document.body.dataset.sheet = '';
  unlockBodyScroll();
  _openSheetTitle = null;
  if (_aboutScrollObserver) { _aboutScrollObserver.disconnect(); _aboutScrollObserver = null; }
  // opts.keepHistory: the caller is retiring several overlay entries itself
  // with one history.go(-n) -- see showPage(). Only that caller sets it.
  if (!(opts && opts.keepHistory) && history.state && history.state.sheet) history.back();
  if (wasOpen && !(opts && opts.navigating)) replayPageIn();   // coming back to the page underneath: it appears again, like a tab change
  if (wasOpen && !(opts && opts.navigating)) ptCountMyBalances();   // back on My: the balances count up again
  if (wasOpen && !opts) maybeAnnounceAfterSheetBack(wasTitle);
};
// ── The Back button and pop-up dialogs ──
// Sheets and the message popup own a history entry, so Back closes them. The other dialogs (Buy confirm, Help, the
// announcement, the win card, the Download card) used not to, and Back with one of them open walked the member out
// of the app. Now each pushes ONE entry when it opens; Back closes the dialog and stays. When a dialog is closed
// with its own button its entry is removed a moment later (not at once: a page opened right after the close pushes
// its own entry, and a back() queued before that push would remove the wrong one); an entry that outlives its
// dialog is skipped over by the popstate handler below, so Back never "does nothing".
var _dlgIgnorePop = false, _dlgFromPop = false, _dlgCleanTimer = null;
function anyDialogOpen(){
  return !!(($('confirmBg') && $('confirmBg').classList.contains('show'))
    || ($('annBg') && $('annBg').classList.contains('show'))
    // The payment status page owns a history entry too: without it here, one Back left the page showing and the next left the app mid-payment.
    || ($('depStatusBg') && $('depStatusBg').classList.contains('show')));
}
function _dlgIgnore(){ _dlgIgnorePop = true; setTimeout(() => { _dlgIgnorePop = false; }, 700); }
function resetOverlayState(){
  document.body.classList.remove('deposit-status-open', 'sheet-open');
  // A session that ends (or a logout) takes every popup with it: the Buy confirm, Help, announcement, download and the win card used to stay
  // on top of the Login screen (the win card even showed the previous member's New Balance).
  ['confirmBg', 'annBg'].forEach(id => { const el = $(id); if (el) el.classList.remove('show'); });
  const win = $('ptClaimBg'); if (win) win.remove();
  _openSheetTitle = null; _depActiveDepositId = null; _withdrawSubmitting = false;
  if (_depSuccessRedirectTimer) { clearInterval(_depSuccessRedirectTimer); _depSuccessRedirectTimer = null; }
}
function dlgOpened(){
  if (_dlgCleanTimer) { clearTimeout(_dlgCleanTimer); _dlgCleanTimer = null; }
  if (history.state && history.state.dlg) history.replaceState({ dlg: 1 }, '', '');
  else history.pushState({ dlg: 1 }, '', '');
}
function dlgClosed(){
  if (_dlgFromPop) return;   // Back already took its entry away
  if (_dlgCleanTimer) clearTimeout(_dlgCleanTimer);
  _dlgCleanTimer = setTimeout(() => {
    _dlgCleanTimer = null;
    if (!anyDialogOpen() && history.state && history.state.dlg) { _dlgIgnore(); history.back(); }
  }, 400);
}
function closeTopDialog(){
  _dlgFromPop = true;
  try {
    if ($('confirmBg') && $('confirmBg').classList.contains('show')) closeConfirm();
    else if ($('annBg') && $('annBg').classList.contains('show')) closeAnnouncement();
    else if ($('depStatusBg') && $('depStatusBg').classList.contains('show')) {
      // The payment status page: Back closes it once it has an answer (its Close button is showing). While the payment is still being
      // checked Back stays on the page (a real operation is in flight, as the page's own comment says), instead of walking out of the app.
      const cb = $('depStatusCloseBtn');
      if (cb && cb.style.display === 'block') closeDepositStatusModal(); else dlgOpened();
    }
  } finally { _dlgFromPop = false; }
}
// A tap on the edge of a text box (its padding or the currency sign beside the figure) focuses the box's input too.
document.addEventListener('click', (e) => {
  const box = e.target.closest && e.target.closest('.v-pbox,.v-pin,.v-amtrow,.v-uline');
  if (!box || e.target.closest('button,a,input,select,textarea')) return;
  const inp = box.querySelector('input'); if (inp) inp.focus();
});
window.addEventListener('popstate', (ev) => {
  if (_dlgIgnorePop) { _dlgIgnorePop = false; return; }       // the removal of a leftover dialog entry: nothing to close
  if (anyDialogOpen()) { closeTopDialog(); return; }            // Back closes the dialog and stays where it is
  // The message detail sits ON TOP of the Messages sheet and carries its own
  // history entry, so unwinding it closes just the popup and lands back on
  // the sheet's entry -- the list is still open behind it, which is what
  // Back should do from a popup opened out of a list. Returning here is what
  // keeps the teardown below from taking the list with it.
  if ($('msgDetailBg') && $('msgDetailBg').classList.contains('show')) {
    $('msgDetailBg').classList.remove('show');
    return;
  }
  // The phone's own Back button, which never goes through closeSheet()
  // directly.
  const _backTitle = $('sheetBg').classList.contains('show') ? _openSheetTitle : null;
  $('sheetBg').classList.remove('show');
  document.body.classList.remove('sheet-open'); document.body.dataset.sheet = '';
  unlockBodyScroll();
  _openSheetTitle = null;
  maybeAnnounceAfterSheetBack(_backTitle);
  if (_backTitle) { replayPageIn(); ptCountMyBalances(); }   // the phone's Back button brings the page back the same way the arrow does
  if (_aboutScrollObserver) { _aboutScrollObserver.disconnect(); _aboutScrollObserver = null; }
  // Landed on an entry whose dialog is already closed: step over it so one Back is one visible step.
  if (ev && ev.state && ev.state.dlg) { _dlgIgnore(); history.back(); }
});

// About page: an admin-authored ordered list of text/image blocks (see
// /public/about-content), rendered as an article and revealed block-by-
// block as the member scrolls (owner: "whenever one scrolls down, images
// and words I placed show animation").
let _aboutScrollObserver = null;


// Owner: "make daily checkin to reset at 00:00 not 24hrs" -- reverts back to
// a calendar-midnight (EAT, UTC+3) daily reset instead of Round 87's rolling
// 24h cooldown. STATE.account.lastCheckinAt is still the real epoch-ms
// timestamp server.js already returns -- only the "when does the cooldown
// lift" math changes, from "+24h" to "the next EAT midnight after
// lastCheckinAt's own calendar day." The live "Available in HH:MM:SS"
// countdown (same startCheckinCountdown() ticking pattern
// startPlanCountdowns() already uses on My Products) is kept -- it now
// counts down to that real midnight instant instead of a moving +24h target.
// The region's own clock offset, not Kampala's -- "resets at midnight" has
// to mean midnight where the member lives. Mirrors tzOffMs() in server.js.

// Self-terminating, same idiom as startPlanCountdowns(): the tick just stops
// itself once #checkinBtn's countdown attribute is gone (sheet closed or
// re-rendered), no separate close-hook needed. Once the cooldown genuinely
// reaches zero, flips the button live to its claimable state -- no manual
// refresh/reopen needed to see the app catch up.
var _checkinCountdownTimer = null;


function recordsRowAmount(t){
  if (t.displayAmount !== undefined && t.displayAmount !== null) return Number(t.displayAmount) || 0;
  if ((Number(t.amount) || 0) === 0 && t.description && (t.type === 'deposit' || t.type === 'withdraw')) {
    // The currency label the SERVER wrote into this description, which is
    // the member's own region's -- "UGX" for Uganda, "KES" for Kenya. Any
    // 2-to-6-letter label is accepted rather than only the region's current
    // one, so a row written before an admin relabelled the currency still
    // reads. Fixed "UGX" here would have made every non-Ugandan row show 0.
    const m = String(t.description).match(/\b[A-Z]{2,6}\s*([\d,]+(?:\.\d+)?)/);
    if (m) {
      const parsed = Number(m[1].replace(/,/g, ''));
      if (Number.isFinite(parsed)) return t.type === 'withdraw' ? -parsed : parsed;
    }
  }
  return Number(t.amount) || 0;
}

// Manual (admin-number, SMS-matched) deposit collection -- PAY B, and the
// PAY A/PAY B choice screen itself -- was removed outright per owner
// instruction ("remove option for payment methods, remove manual payment
// in the whole codes... remove them all"). Automatic recharge is now the
// only deposit path: one screen, no method choice to make.
window.openDepositSheet = function(){
  const s = STATE.settings || {};
  if (s.depositAvailable === false) return notify('Deposits are not available right now.');
  openDepositFormSheet();
};
var _depChosenAmount = 0;
function openDepositFormSheet(){
  const s = STATE.settings || {};
  const min = Number(s.minDeposit) || 0;
  const chipAmts = Array.from(new Set((STATE.products || []).map(p => Number(p.price) || 0).filter(p => p >= min && p > 0))).sort((a, b) => a - b).slice(0, 6);
  _depChosenAmount = chipAmts.length ? chipAmts[0] : 0;
  // The admin's list: "Pay-B, Pay-A*, Pay-D, Pay-C" -- the name that ends with * is the one chosen when the page opens (the first, when none is marked).
  const rawNames = String(s.depositMethodNames || 'Pay-B, Pay-A*, Pay-D, Pay-C').split(',').map(x => x.trim()).filter(Boolean);
  const names = rawNames.map(x => x.replace(/\*+$/, '').trim());
  const startOn = Math.max(0, rawNames.findIndex(x => /\*$/.test(x)));
  const note = t => `<div class="pt-note">${t}</div>`;
  openSheet('Deposit', `<div class="pt-dep">
    <div class="pt-chips" id="depChips">${chipAmts.map(a => `<button type="button" class="dep-chip pt-chip${a === _depChosenAmount ? ' sel' : ''}" data-amt="${a}" onclick="pickDepositAmount(${a})">${a}</button>`).join('')}</div>
    <div class="pt-avail">Available:<b>${esc(vMoney2((STATE.account || {}).walletBalance))}</b></div>
    <div class="pt-amt"><span>${esc(cur())}</span><input id="depAmount" type="text" inputmode="numeric" maxlength="9" value="${_depChosenAmount || ''}" placeholder="${min || ''}" oninput="this.value=this.value.replace(/[^0-9]/g,'');syncDepositQuickAmt()" name="pt_amount" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" data-lpignore="true" data-1p-ignore></div>
    <div class="pt-meths" id="depPays">${names.map((n, i) => `<button type="button" class="${i === startOn ? 'on' : ''}" onclick="pickPayLabel(this)">${ptIconHtml('payicon', '', 'pt-payic')}<span>${esc(brandName())} ${esc(n)}</span></button>`).join('')}</div>
    <button class="pt-pay" id="depSubmitBtn" type="button" onclick="submitDeposit()">Pay <b id="depPayAmt">${esc(numGroup(_depChosenAmount, true))}</b></button>
    <div class="pt-notes">
      ${note('Minimum deposit amount: ' + esc(cur()) + ' ' + esc(numGroup(min, false)))}
      ${note('Funds are usually credited within 1-10 minutes after payment')}
      ${note('Please complete your payment in time to avoid order expiration')}
      ${note('Please do not transfer to any account not designated by the platform')}
    </div>
  </div>`);
  ptCountPay();
}
// The Pay button's amount always RUNS to its new figure (live, like Cookie's): from 0 when Deposit opens, and from what it shows to the new amount whenever one is
// typed or picked. A new amount while it is still running continues from the figure on screen.
function ptPayTo(to, ms){
  const el = $('depPayAmt'); if (!el) return;
  to = Number(to) || 0;
  const shown = Number.isFinite(el._cv) ? el._cv : (parseMoneyInput(el.textContent) || 0), token = (el._cp = (el._cp || 0) + 1);
  if (shown === to || !ms || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) { el._cv = to; el.textContent = numGroup(to, true); return; }
  const t0 = performance.now();
  const step = now => {
    if (el._cp !== token || !el.isConnected) return;
    const k = Math.min(1, (now - t0) / ms), v = k >= 1 ? to : Math.round(shown + (to - shown) * (1 - Math.pow(1 - k, 3)));
    el._cv = v; el.textContent = numGroup(v, true);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
function ptCountPay(){
  const el = $('depPayAmt'); if (!el) return;
  el._cv = 0; el.textContent = numGroup(0, true);
  ptPayTo(_depChosenAmount, 1000);
}
// The Deposit page shows the admin's pay buttons (up to six); tapping one selects it (only one is on at a time), and the page opens with the one marked * (the first if none).
window.pickPayLabel = function(btn){
  const box = $('depPays');
  if (box) box.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === btn));
};
window.pickDepositAmount = function(amt){
  const el = $('depAmount');
  if (el) el.value = amt;
  syncDepositQuickAmt();
};
function syncDepositQuickAmt(){
  // Deposit.dc.html's own chip grid (#depChips/.dep-chip) is the only chip
  // row left. The second branch here highlighted the older .quick-amt row on
  // the two "Recharge" screens, and both of those screens are gone.
  const val = parseMoneyInput(($('depAmount') || {}).value);
  _depChosenAmount = val;
  ptPayTo(val || 0, 450);
  const chips = $('depChips');
  if (chips) chips.querySelectorAll('.dep-chip').forEach(btn => btn.classList.toggle('sel', Number(btn.dataset.amt) === val));
}
// Live deposit-status modal -- reuses the .chest-modal-bg/.chest-modal dark/
// centered/thin pop-up convention. Opens the instant a recharge is accepted
// and updates in place as pollDepositStatus() resolves, instead of just a
// toast + silent background poll. No outside-tap-to-close while pending
// (a real operation is in flight); the Close button only appears once
// resolved (or once the poll gives up), matching the app's own established
// pattern of only offering Close on a settled dialog state.
window.openDepositStatusModal = function(amount, phone, network){
  setDepositStatusPending(amount, phone, network);
  $('depStatusBg').classList.add('show');
  document.body.classList.add('deposit-status-open');
  lockBodyScroll();
  // Back closes this page (see closeTopDialog) instead of leaving the app. When the deposit sheet's own history entry is still being
  // taken away (closeSheet called history.back() a moment ago), the popstate for that does the push (closeTopDialog); pushing here too
  // would be popped by that same back() and leave a stale sheet entry behind. A timer makes sure an entry exists either way.
  if (!(history.state && history.state.sheet)) dlgOpened();
  setTimeout(() => { if ($('depStatusBg') && $('depStatusBg').classList.contains('show') && !(history.state && history.state.dlg)) dlgOpened(); }, 700);
};
window.closeDepositStatusModal = function(goHome){
  // Cancels the success screen's own auto-redirect countdown if the member
  // taps Close/Back before it fires on its own -- otherwise the timer would
  // still be alive and try to close (or navigate) a modal that is already
  // closed, moments later.
  if (_depSuccessRedirectTimer) { clearInterval(_depSuccessRedirectTimer); _depSuccessRedirectTimer = null; }
  $('depStatusBg').classList.remove('show');
  document.body.classList.remove('deposit-status-open');
  unlockBodyScroll();
  dlgClosed();
  if (goHome === true && STATE.page !== 'home') { try { navigatePage('home'); } catch (_) {} }
};
// ── ONE STATUS REQUEST AT A TIME ──
// Owner: "add a button saying verify, so one can tap it but it should not
// stop autopolling, also they should not call at the same time to strike api
// of payment provider."
//
// /deposit/marzpay/status makes the server ask the payment provider about
// this transaction, so two of them firing together is two hits on the
// provider for one answer -- and the manual Verify tap is, by design, most
// likely to happen exactly while the 3s autopoll is mid-request.
//
// This is a single-flight, not a mutex: a caller arriving while a request is
// already out gets the SAME promise back rather than being refused or made to
// start a second one. So the member's tap is never ignored (they still get an
// answer, the one already on its way), the autopoll is never interrupted, and
// the provider is never asked twice at once. It also means both callers may
// resolve on the same response, which is why applyDepositStatusResult() below
// has to be idempotent.
var _depStatusInflight = null;
var _depActiveDepositId = null;
var _depPollDone = false;
var _depPendingAmount = 0;
// Long enough that hammering the button cannot turn into a burst of provider
// calls, short enough that a member watching the screen can re-check when the
// prompt actually lands on their phone.
var DEP_VERIFY_COOLDOWN_MS = 2500;
function depositStatusCheck(depositId){
  if (_depStatusInflight) return _depStatusInflight;
  // post() resolves to {status:'error'} rather than rejecting (see api()), so
  // this promise never rejects and the finally always clears the slot.
  _depStatusInflight = post('/deposit/marzpay/status', { depositId })
    .finally(() => { _depStatusInflight = null; });
  return _depStatusInflight;
}
// The autopoll's own request: asks the server to HOLD the answer for a few seconds while it is watching the payment (server.js waitDepositSettled),
// so "paid" arrives the moment PesaJet confirms instead of at the next tick. Deliberately NOT shared with depositStatusCheck(): a Verify tap must
// never be made to wait behind a held request. A server that does not hold simply answers at once and the loop's own pacing takes over.
var DEP_HOLD_MS = 8000;
function depositStatusHold(depositId){
  return post('/deposit/marzpay/status', { depositId, waitMs: DEP_HOLD_MS });
}
// The single place that decides what a status response MEANS, shared by the
// autopoll and the Verify button so the two can never disagree about the same
// payload. Returns true once the deposit has settled.
async function applyDepositStatusResult(r){
  if (_depPollDone) return true;
  if (!r || r.status !== 'success') return false;
  if (r.state === 'matched') {
    _depPollDone = true;
    setDepositStatusSuccess();
    await refreshTransactionsCache();
    if (STATE.page === 'home') renderHome();
    return true;
  }
  if (r.state === 'failed') {
    _depPollDone = true;
    setDepositStatusFailed(r.message);
    await refreshTransactionsCache();
    return true;
  }
  return false;
}
// Which of the two buttons the current state offers. Verify stays available
// in the "still processing" state as well as while pending -- that state is
// the autopoll giving up on its 60s budget, NOT the payment being over, so
// taking the one control that can still resolve it away at exactly that
// moment would be backwards.
function setDepButtons(showVerify, showClose){
  const v = $('depVerifyBtn'), c = $('depStatusCloseBtn');
  if (v) { v.style.display = showVerify ? 'block' : 'none'; v.disabled = false; v.textContent = 'Verify'; }
  if (c) { c.style.display = showClose ? 'block' : 'none'; c.setAttribute('onclick', 'closeDepositStatusModal(' + (c.textContent === 'Back to Home') + ')'); }
}
window.verifyDepositNow = async function(){
  const btn = $('depVerifyBtn');
  if (!_depActiveDepositId || _depPollDone || !btn || btn.disabled) return;
  btn.disabled = true; btn.textContent = 'Checking…';
  const settled = await applyDepositStatusResult(await depositStatusCheck(_depActiveDepositId));
  if (settled) return;                       // setDep* already reset the buttons
  notify('Not confirmed yet. Approve the payment prompt on your phone, then tap Verify again.');
  // The cooldown runs from the ANSWER, not the tap, so a slow provider does
  // not let taps queue up behind it.
  setTimeout(() => {
    if (_depPollDone) return;
    const b = $('depVerifyBtn');
    if (b) { b.disabled = false; b.textContent = 'Verify'; }
  }, DEP_VERIFY_COOLDOWN_MS);
};
function setDepositStatusPending(amount, phone, network){
  if (_depSuccessRedirectTimer) { clearInterval(_depSuccessRedirectTimer); _depSuccessRedirectTimer = null; }   // an old success countdown must not close this new page
  $('depStatusIcon').className = 'dep-status-icon';
  $('depStatusIcon').innerHTML = DEPOSIT_POLL_FLOW;
  // Owner asked for the specifics shown here, not a generic message --
  // the actual number the prompt was sent to and the actual amount.
  const displayPhone = cleanPhone(phone) || (dialPlus() + String(phone || '').replace(/\D/g, ''));
  // Owner: "put another statement, that dial *165# to approve, this is
  // just a fallback bro because a payment prompt can come or it may fail
  // and one may dial *165# so he see pending approval" -- the USSD push
  // prompt itself can fail to arrive (a real, common MoMo gap, not
  // specific to this app), so a member staring at a prompt that never
  // shows up needs a way out other than waiting. Dialling the network's
  // own money menu surfaces the same pending collection request for
  // manual approval there instead. Network-specific -- *165# is MTN
  // Mobile Money's own menu, *185# is Airtel Money's; showing the wrong
  // one would send a member down a dead end. Round 145 dropped the
  // network selector from PAY A's own form (the gateway detects it
  // instead), so `network` is no longer reliably known here -- show both
  // codes rather than guessing.
  const ussd = network === 'Airtel Money' ? '*185#' : (network === 'MTN Mobile Money' ? '*165#' : '*165# (MTN) or *185# (Airtel)');
  _depPendingAmount = Number(amount) || 0;
  _depPendingPhone = displayPhone;
  // Owner's own four steps, verbatim. Numbered because they are a sequence
  // with one thing for the member to DO in the middle of it -- the previous
  // single paragraph buried "approve it on your phone" mid-sentence between
  // two facts, which is the one line that actually needed to be found.
  //
  // esc() on both interpolations: the amount is ours, but the phone number is
  // whatever was typed into the form, and this is innerHTML now.
  setPayLive(true);
  $('depStatusTitle').textContent = 'Waiting for your approval';
  $('depStatusBody').innerHTML =
    '<div class="pl-amt">' + esc(fmtUGX(amount)) + '</div>'
    + '<ol class="pay-steps pl-steps">'
    + '<li class="done"><b>Request sent</b><span>A payment request for ' + esc(fmtUGX(amount)) + ' has been sent to ' + esc(displayPhone) + '.</span></li>'
    + '<li class="now"><b>Approve on your phone</b><span>Check your phone for the payment prompt and approve it.</span></li>'
    + '<li class="todo"><b>Balance updated</b><span>Your balance is updated automatically once the payment is confirmed.</span></li>'
    + '</ol>'
    // The push prompt genuinely does fail to arrive sometimes (a real MoMo gap), and without this a member is left at step 2 with nothing to do.
    + '<p class="pay-note">No prompt? Dial ' + esc(ussd) + ' on that phone to find and approve the pending payment yourself.</p>'
    + '<div class="pl-check"><i></i>Checking automatically</div>';
  // Owner: "remove verify button, so this is automatic verification" -- the
  // autopoll (pollDepositStatus() below) already checks on its own; a manual
  // Verify tap next to it was a second way to do the same thing, not a
  // needed one. Neither button shows while pending now -- purely automatic,
  // nothing for the member to do but wait.
  setDepButtons(false, false);
}
var _depSuccessRedirectTimer = null;
function setDepositStatusSuccess(){
  setPayLive(true);
  $('depStatusIcon').className = 'dep-status-icon success';
  $('depStatusIcon').innerHTML = PL_BADGE_OK;
  // Owner: on success it says Congratulations and that the payment has been received and added to the wallet; the member leaves with the Back to Home button.
  $('depStatusTitle').textContent = 'Congratulations!';
  // Names the actual figure when it is known (it always is on the automatic path); the manual-deposit path lands here without ever showing
  // the waiting page, so every line also reads properly without one. brandName(), not a literal: the app's name is admin-settable.
  const added = _depPendingAmount
    ? 'Payment received — ' + fmtUGX(_depPendingAmount) + ' has been added to your wallet.'
    : 'Payment received — your deposit has been added to your ' + brandName() + ' wallet.';
  $('depStatusBody').innerHTML = plAmount(false)
    + '<ol class="pay-steps pl-steps">' + plSent()
    + plStep('done', 'Approved on your phone', 'The payment was approved.')
    + plStep('done', 'Balance updated', added) + '</ol>';
  // Owner: no "Returning to Home in N seconds" and no automatic redirect: the page stays until the member taps Back to Home (or the back arrow).
  const c = $('depStatusCloseBtn');
  if (c) c.textContent = 'Back to Home';
  setDepButtons(false, true);
}
function setDepositStatusFailed(msg){
  setPayLive(true);
  $('depStatusIcon').className = 'dep-status-icon failed';
  $('depStatusIcon').innerHTML = PL_BADGE_BAD;
  failShake($('depStatusIcon'), _drToken);   // the badge shakes and the phone buzzes once
  $('depStatusTitle').textContent = 'Payment not completed';
  // Naming ONE specific cause here would be a fabricated claim: the provider's failed-collection reply carries no reason (see server.js's
  // DEPOSIT_FAILED_MSG), so the note lists the plausible causes without asserting which one it was. `msg` is server-supplied on the normal
  // path; the fallback only fires for a purely client-side failure that never reached the server.
  $('depStatusBody').innerHTML = plAmount(true)
    + '<ol class="pay-steps pl-steps">' + plSent()
    + plStep('todo', 'Approve on your phone', 'Not completed.')
    + plStep('bad', 'Balance not updated', 'Nothing was added to your wallet.') + '</ol>'
    + '<p class="pay-note bad">' + esc(msg
      || 'This deposit did not go through. This can happen if you did not approve the prompt in time, cancelled it, or had insufficient funds. Your ' + brandName() + ' balance has not changed.') + '</p>';
  // Undoes setDepositStatusSuccess()'s own "Back to Home" relabel -- this
  // button means plain Close here, on a modal a later deposit attempt can
  // reuse without a fresh page load in between.
  const cf = $('depStatusCloseBtn'); if (cf) cf.textContent = 'Close';
  setDepButtons(false, true);
}
function setDepositStatusUnknown(){
  setPayLive(true);
  $('depStatusIcon').className = 'dep-status-icon';
  $('depStatusIcon').innerHTML = DEPOSIT_POLL_FLOW;
  $('depStatusTitle').textContent = 'Still waiting for the provider';
  $('depStatusBody').innerHTML = '<p>The payment has not been confirmed yet, and nothing is lost. '
    + 'If it goes through, your balance updates on its own automatically, '
    + 'or look under Transaction Statement later to check.</p>';
  const cu = $('depStatusCloseBtn'); if (cu) cu.textContent = 'Close';
  // Verify removed here too (see setDepositStatusPending's own comment) --
  // this is the same automatic wait, just past the autopoll's own 60s
  // budget. Close is the only control: a way off the screen, not a way to
  // ask again by hand.
  setDepButtons(false, true);
}
// The "Processing payment..." cover: the whole screen (bottom bar and floating pictures too) dims and blurs, a ring turns above the words.
function ptProcessing(on){
  let el = $('ptProcBg');
  if (on && !el) { el = document.createElement('div'); el.id = 'ptProcBg'; el.className = 'mg-redirect'; el.innerHTML = '<span class="spin"></span><p>Processing payment...</p>'; document.body.appendChild(el); }
  if (el) el.classList.toggle('show', !!on);
}
window.submitDeposit = async function(){
  const submitBtn = $('depSubmitBtn');
  if (!submitBtn || submitBtn.disabled || !$('depAmount')) return;
  const amount = parseMoneyInput($('depAmount').value);
  // Owner: "why when one didn't put number, it just continues to poll ... l
  // tried to leave not putting number and clicked confirm deposit but it
  // didn't reject it just continued to go to poll page."
  //
  // The amount was validated here and the phone simply was not, so an empty
  // field went to the server, which fell back to the account's own registered
  // number, created a real deposit and answered success -- so the app went
  // happily on to the poll page for a payment prompt the member never asked
  // for. It also produced the broken "+256" with no digits on that screen,
  // because the display fell back to a bare country code.
  //
  // cleanPhone() is the SAME rule the server applies, so what is accepted
  // here and what is accepted there cannot drift apart.
  // The payment prompt goes to the member's own registered number (the server uses it when none is sent).
  // The member types the number he pays from (the prompt is sent to it); it is checked with the same rule the server applies.
  if (!amount || amount <= 0) return notify('Enter a valid amount');
  // A below-minimum amount is refused here, before any round trip.
  const s = STATE.settings || {};
  if (amount < (Number(s.minDeposit) || 0)) return notify('Minimum amount is ' + fmtUGX(s.minDeposit));
  submitBtn.disabled = true; submitBtn.textContent = 'Loading...';
  ptProcessing(true);
  let r;
  try {
    // No network field on this form (Round 145) -- the gateway detects it
    // from the phone number itself; server.js already treats `network` as
    // optional here.
    r = await post('/deposit/marzpay', { amount });
  } finally {
    // Restores the button's resting label after a failed attempt -- must
    // match whatever submitBtn actually reads at rest (see the sheet's own
    // button above), or a member whose recharge failed is left looking at a
    // button that silently renamed itself.
    submitBtn.disabled = false; submitBtn.innerHTML = 'Pay <b id="depPayAmt">' + esc(numGroup(amount, true)) + '</b>';
    ptProcessing(false);
  }
  if (r && r.stale) return;
  if (!r || r.status !== 'success') return notify((r && r.message) || 'Could not start deposit');
  // Same stale-Records fix as submitWithdraw() -- /deposit/marzpay already
  // wrote a "Processing" ledger row server-side by this point, refresh the
  // cache now so it's actually there the next time Records opens.
  refreshTransactionsCache().catch(() => {});
  if ($('depSubmitBtn') === submitBtn && _openSheetTitle === 'Deposit') closeSheet({ fromAction: true });
  openDepositStatusModal(amount, localDigits((STATE.account || {}).phone || ''));
  pollDepositStatus(r.depositId);
};
// Owner: "callback speed is low, so try to make the system solid and faster
// validation on payments."
//
// The old loop slept a flat 3s BEFORE its first check, so even a member who
// approved the prompt instantly watched a screen that said nothing for three
// seconds -- and every later tick was 3s too. Two changes, and neither asks
// the provider for more than it needs:
//
//   * the FIRST check is at 1.2s. That is the case worth optimising: the
//     member had the prompt open and approved it immediately.
//   * later checks are 1.5s apart (owner, 2026-10-08; was 2.5s, the cadence PesaJet's own SDK
//     uses in pollUntilComplete.
//
// The 60-second budget is unchanged -- 24 ticks at the new spacing is the same
// wall-clock window, so nothing gives up on a payment any sooner than before.
var DEP_POLL_FIRST_MS = 1000;
var DEP_POLL_EVERY_MS = 1500;
async function pollDepositStatus(depositId){
  _depActiveDepositId = depositId;
  _depPollDone = false;
  // Ticks are 1.5 s apart MEASURED FROM THE START OF EACH TICK (a slow answer no longer pushes the next check further away), and the
  // budget is 70 s of the wall clock, not 24 ticks however long each took.
  const began = Date.now();
  await new Promise(r => setTimeout(r, DEP_POLL_FIRST_MS));
  while (Date.now() - began < 70000) {
    const tickStart = Date.now();
    // A Verify tap may have settled it between ticks -- stop rather than
    // firing another provider call for an answer already in hand.
    if (_depPollDone) return;
    // Superseded: the member backed out of this recharge and started another
    // one, so a newer poll owns the screen now. Without this, THIS loop would
    // keep running for its full 60s and write deposit A's result over deposit
    // B's page -- and, worse than the old code, would set the shared
    // _depPollDone and stop B's loop as well. Same shape as the bug already
    // documented on the manual-pay poll.
    if (_depActiveDepositId !== depositId) return;
    const r = await depositStatusHold(depositId);
    if (_depPollDone) return;
    if (_depActiveDepositId !== depositId) return;
    if (await applyDepositStatusResult(r)) return;
    // Answered at once (nothing to hold on, or an error): pace the next ask. A held answer already took its time.
    const spent = Date.now() - tickStart;
    if (spent < DEP_POLL_EVERY_MS) await new Promise(r2 => setTimeout(r2, DEP_POLL_EVERY_MS - spent));
  }
  // Ending the loop is the autopoll giving up on its own ~60s budget, not the
  // payment being over -- _depPollDone stays false on purpose so Verify keeps
  // working on this deposit afterwards.
  if (!_depPollDone) { setDepositStatusUnknown(); slowDepositWatch(depositId); }
}
// The fast poll gives up after 70 s but the server keeps watching a payment for 2 minutes and the reconciler for longer: keep asking every few
// seconds for 3 more minutes so a payment approved late still turns the page into its result (Success or Failed) instead of staying on "Still waiting".
async function slowDepositWatch(depositId){
  const until = Date.now() + 180000;
  while (Date.now() < until) {
    await new Promise(r => setTimeout(r, 4000));
    if (_depPollDone || _depActiveDepositId !== depositId) return;
    if (!$('depStatusBg') || !$('depStatusBg').classList.contains('show')) continue;
    const r = await depositStatusHold(depositId);
    if (_depPollDone || _depActiveDepositId !== depositId) return;
    if (await applyDepositStatusResult(r)) return;
  }
}

// Cache-first: STATE.bankAccounts is prefetched at login. Deliberately does
// NOT quietly repaint once the background re-fetch lands (unlike Home/Team/
// Products) -- this sheet has live input fields (amount, PIN) and silently
// replacing them out from under someone mid-entry would be a much worse bug
// than a slightly-stale account list. The background fetch still keeps
// STATE.bankAccounts current for the NEXT time this sheet opens.
// Which saved wallet THIS withdrawal goes to, now that more than one can
// exist. null means "no explicit pick yet" -- witSelectedWallet() then
// falls back to the first saved one, so a member with only one wallet (the
// common case) never sees a picker or has to choose anything.
// The card a withdrawal goes to: the member's active card (the one marked isDefault; the first saved one when none is marked).
function witSelectedWallet(){ const l = STATE.bankAccounts || []; return l.find(a => a.isDefault === true) || l[0] || null; }
window.openWithdrawSheet = async function(){
  const s = STATE.settings || {};
  openSheet('Withdraw', '');
  // Paint the actual withdrawal page immediately. Waiting for /bank/list
  // left a transparent-looking empty sheet over Home on a cold open.
  paintWithdrawSheet(s);
  const amountField = $('witAmount');
  const r = await api('/bank/list');
  if (_openSheetTitle !== 'Withdraw' || $('witAmount') !== amountField) return;
  if (r.status === 'success' && Array.isArray(r.accounts)) {
    STATE.bankAccounts = r.accounts;
    // Only the wallet block -- never #witAmount or anything else on the
    // page, per this function's own standing rule (see the comment above
    // it): a member may already be mid-typing an amount by the time this
    // background fetch lands.
    const block = $('witWalletBlock');
    if (block) block.innerHTML = witWalletBlockHtml(s);
    const submitBtn = $('witSubmitBtn');
    if (submitBtn) submitBtn.disabled = _withdrawSubmitting;
  }
};
function tzOffMs(){ const m = REGION && REGION.utcOffsetMin; return (m == null ? 180 : Number(m)) * 60000; }
// The withdrawal hours (admin Settings): 24-hour, in the region's own clock, and the window may run past midnight (18:00 to 17:00).
function witMinutes(v){
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v == null ? '' : v).trim());
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  return (h > 23 || mi > 59) ? null : h * 60 + mi;
}
function witClock(v){
  const t = witMinutes(v);
  if (t == null) return '';
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}
function withdrawWindow(s){
  const from = witMinutes(s && s.withdrawOpenFrom), to = witMinutes(s && s.withdrawOpenTo);
  if (!(s && s.withdrawWindowEnabled) || from == null || to == null || from === to)
    return { enabled: false, open: true, from: '', to: '' };
  const d = new Date(Date.now() + tzOffMs());   // the region's clock, as the server judges it
  const now = d.getUTCHours() * 60 + d.getUTCMinutes();
  const open = from < to ? (now >= from && now < to) : (now >= from || now < to);
  return { enabled: true, open, from: witClock(s.withdrawOpenFrom), to: witClock(s.withdrawOpenTo) };
}
// The one wallet card and the Bind Wallet button (one wallet per member; the
// Wallet page edits it in place). Isolated so openWithdrawSheet()'s post-fetch
// update can repaint only this block, never #witAmount.
function witWalletBlockHtml(s){
  const w = witSelectedWallet();
  const row = (label, value) => `<div class="pt-wrow"><span>${label}</span><b>${value ? esc(value) : ''}</b></div>`;
  return `${row('Real Name', w && w.holder)}${row('Bank', w && w.network)}${row('Bank Account', w && walletDestDisplay(w))}
    <button id="witBindBtn" class="pt-bind" type="button" onclick="openWalletSheet()"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2l2.3 3.2 3.9-.8.3 4 3.6 1.7-2 3.5 2 3.5-3.6 1.7-.3 4-3.9-.8L12 22l-2.3-3.2-3.9.8-.3-4-3.6-1.7 2-3.5-2-3.5 3.6-1.7.3-4 3.9.8z"/></svg><span>Bind Bank Card</span></button>`;
}
// Withdraw.dc.html. Replaces the form inherited from Snow: a tinted balance
// card, a UGX-prefixed amount field, the bound wallet shown as the same
// bank-card tile the Wallet screen uses (not a <select> of several), the
// trade-password field, the fee line, and the instruction card.
function paintWithdrawSheet(s){
  const balance = (STATE.account && STATE.account.walletBalance) || 0;
  const fee = withdrawalFeePct(s);
  $('sheetBody').innerHTML = `<div class="pt-wit">
    <section class="pt-wcard"><h3>Amount</h3>
      <div class="pt-wamt"><span>${esc(cur())}</span><input id="witAmount" type="text" inputmode="numeric" maxlength="9" placeholder="Enter Amount" oninput="this.value=this.value.replace(/[^0-9]/g,'');syncWithdrawReceiveAmt()" autocomplete="off"></div>
      <p class="pt-wbal">Balance:<span id="witBalance">${esc(vMoney2(balance))}</span></p>
    </section>
    <section class="pt-wfee"><h3>Fee: ${fee}%</h3><p>Withdrawals are processed within 30 minutes to 24 hours; you will receive <span id="witReceive">${esc(vMoney2(0))}</span>.</p></section>
    <button class="pt-wgo" id="witSubmitBtn" type="button" ${_withdrawSubmitting ? 'disabled' : ''} onclick="submitWithdraw()">Withdraw <b id="witGoAmt">0.00</b></button>
    <section class="pt-wacct" id="witWalletBlock">${witWalletBlockHtml(s)}</section>
  </div>`;
}
function withdrawalFeePct(s){
  const value = Number(s && s.withdrawFeePct);
  return s && s.withdrawFeePct != null && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 15;
}
window.syncWithdrawReceiveAmt = function(){
  const amount = parseMoneyInput(($('witAmount') || {}).value);
  const pct = withdrawalFeePct(STATE.settings || {});
  const net = amount > 0 ? amount - Math.round(amount * pct / 100) : 0;
  const rc = $('witReceive'); if (rc) rc.textContent = vMoney2(net);
  const ga = $('witGoAmt'); if (ga) ga.textContent = numGroup(amount > 0 ? amount : 0, true);
};
// The Trade Password dialog: resolves with the typed text, or null when cancelled.
function askTradePin(){
  return new Promise(resolve => {
    const bg = $('pinBg'); if (!bg) return resolve('');
    const input = $('pinInput'); input.value = '';
    bg.classList.add('show');
    setTimeout(() => { try { input.focus(); } catch (_) {} }, 60);
    const done = v => { bg.classList.remove('show'); $('pinOk').onclick = $('pinNo').onclick = null; bg.onclick = null; input.onkeydown = null; resolve(v); };
    $('pinOk').onclick = () => done(input.value.trim());
    $('pinNo').onclick = () => done(null);
    bg.onclick = e => { if (e.target === bg) done(null); };
    input.onkeydown = e => { if (e.key === 'Enter') done(input.value.trim()); };
  });
}
// Transaction Statement (openBalanceRecordSheet()) is cache-first: it paints from
// whatever STATE.transactions already holds, and per Round 55's own fix,
// deliberately does NOT repaint once its own background refetch lands (that
// was to stop a sheet that's already open from silently reloading itself
// mid-view). The side effect nobody had hit until now: nothing ever
// refreshed STATE.transactions the moment a NEW ledger row was actually
// created server-side (withdraw/deposit both write one immediately, see
// server.js's own /withdraw/request and /deposit/marzpay) -- so opening
// Records right after submitting a withdrawal painted the STALE cached
// list, missing the just-created "Processing" row entirely, and even a
// second open could still miss it depending on exactly when the FIRST
// open's own background refetch happened to land. Owner: "a pending
// withdrawal order is not created... l want it to be created" -- it WAS
// being created server-side the whole time, the client just never told
// itself to look again. Same "refresh the relevant STATE slice right after
// a successful money action" pattern submitCheckin() already uses for
// STATE.account.
async function refreshTransactionsCache(){
  const r = await api('/transactions');
  if (r.status === 'success') { STATE.transactions = r.transactions; STATE.transactionsTruncated = !!r.truncated; _recordsLoadFailed = false; }
}
var _withdrawSubmitting = false;
window.submitWithdraw = async function(){
  const submitBtn = $('witSubmitBtn');
  if (!submitBtn || submitBtn.disabled || _withdrawSubmitting || !$('witAmount')) return;
  const amount = parseMoneyInput($('witAmount').value);
  // Whichever saved wallet is currently selected on screen -- may be one of
  // several now that Potato allows saving more than one (see
  // witSelectedWallet()'s own comment).
  const acct = witSelectedWallet();
  if (!amount || amount <= 0) return notify('Enter a valid amount.');
  // Mirrors the server's rule so the member is told BEFORE a round trip.
  // The server checks it again -- this is a courtesy, not the enforcement.
  const wMult = Math.max(0, Math.floor(Number((STATE.settings || {}).withdrawMultiple) || 0));
  const wMin = Number((STATE.settings || {}).minWithdraw) || 0;
  // The minimum is checked first, as the server does, so the suggestions below can never be amounts under it.
  if (wMin > 0 && amount < wMin) return notify(`Minimum withdraw is ${fmtUGX(wMin)}.`);
  if (wMult > 0 && amount % wMult !== 0) {
    const low = Math.floor(amount / wMult) * wMult, high = low + wMult;
    return notify(`Withdraw must be a multiple of ${fmtUGX(wMult)}. Try ${fmtUGX(low || high)} or ${fmtUGX(high)}.`);
  }
  // Owner: "I want a notify to appear when one tries to press confirm
  // cashout but when he hasn't saved a bank." Confirm Cash Out used to be a
  // plain HTML `disabled` button whenever there was no wallet -- a disabled
  // button swallows a tap with zero feedback, so the member saw nothing at
  // all. It's tappable unconditionally now (see paintWithdrawSheet()); this
  // check is what actually tells them why nothing happened.
  if (!acct) return notify('Please add a payout wallet before withdrawing.');
  // Told here so the member is not asked to wait on a request the server will refuse anyway.
  const win = withdrawWindow(STATE.settings || {});
  if (win.enabled && !win.open && !(STATE.account && STATE.account.withdrawAnytime))
    return notify(`Withdraw is open from ${win.from} to ${win.to}. Please come back then.`);
  // The Trade Password is asked in a small dialog, right when the member taps Withdraw (the owner's Withdraw page has no box for it).
  if ($('pinBg') && $('pinBg').classList.contains('show')) return;   // a second tap while the dialog is open does nothing
  const witPin = await askTradePin();
  if (witPin === null) return;
  if (!/^\d{6}$/.test(witPin)) return notify('Enter your 6-digit Trade Password.');
  _withdrawSubmitting = true;
  submitBtn.disabled = true;
  let r;
  try { r = await post('/withdraw/request', { amount, network: acct.network, phone: acct.phone, pin: witPin }); }
  finally {
    _withdrawSubmitting = false;
    submitBtn.disabled = false;
    // A background /bank/list landing mid-request can have repainted the
    // wallet block (see openWithdrawSheet()) and left a DIFFERENT button
    // element in the DOM -- disabled state is only ever about an in-flight
    // request now, not wallet presence, so the new one is simply enabled.
    const current = $('witSubmitBtn');
    if (current && current !== submitBtn) current.disabled = false;
  }
  if (r.stale) return;
  if (r.status !== 'success') return notify(r.message || 'Could not request withdrawal.');
  // Owner: "why when l withdrawal the value still remains???"
  // Because nothing here refreshed it. The SERVER debits immediately --
  // /withdraw/request does walletBalance: increment(-amt) before it answers --
  // so the money really had left, but STATE.account still held the figure from
  // before the request and every screen kept painting it. Subtract it here so
  // the balance drops the moment the sheet closes, then let the live /account
  // fetch below confirm it.
  if (STATE.account) {
    STATE.account.walletBalance = Math.max(0, (Number(STATE.account.walletBalance) || 0) - amount);
  }
  // Owner: "l nolonger need that ugly old notify that cash out processing ...
  // our card notifies, with the warning sign, so it can say other words and
  // show amount to be received after the charges plus okay button."
  // `net` comes from the server, which is the authority on the fee it actually
  // charged; the client-side sum is the fallback for a backend that has not
  // redeployed yet.
  const pct = withdrawalFeePct(STATE.settings || {});
  const net = Number.isFinite(Number(r.net)) && r.net !== null
    ? Number(r.net) : amount - Math.round(amount * pct / 100);
  // Owner: "when one requests withdrawal then he is forwarded to records of
  // withdrawals to see his processing withdrawal."
  // On OK, not before: the card carries the amount they will actually receive,
  // and yanking the screen out from under it while they are still reading is
  // how that number gets missed.
  notify(`Withdraw of ${fmtUGXCents(amount)} is processing. You will receive `
    + `${fmtUGXCents(net)} after the ${pct}% charge.`,
    () => openBalanceRecordSheet('withdraw'));
  if (_openSheetTitle === 'Withdraw' && $('witSubmitBtn') === submitBtn) closeSheet({ fromAction: true });
  refreshAfterWithdraw();
};
// The catch-up after a withdrawal, off the path between the server saying yes and
// the member being told. Not awaited: the balance above is already correct, and
// nothing on the dialog depends on either of these landing.
async function refreshAfterWithdraw(){
  try {
    const acc = await api('/account');
    if (acc.status === 'success') STATE.account = acc.account;
    await refreshTransactionsCache();
    if (STATE.page === 'home') renderHome();
    if (STATE.page === 'account') renderAccount();
  } catch (_) { /* the figure on screen is already the post-debit one */ }
}

// Owner: "investment confirmation dialog should be removed completely."
// Buy Now now purchases straight away. The card the button sits on is the
// only place the price and payout are shown before the money moves, which is
// why productCardHtml() must keep showing both.
// The button is disabled while the request is in flight -- with no dialog in
// the way, a double tap would otherwise fire two purchases, and /invest/create
// has no client-side retry guard of its own.
// Buy Now buys at once -- there is no confirmation pop-up (owner). A second tap while the purchase is on its way does nothing, so a double tap can never buy twice
// (the server also holds the per-member limit and the price the member was shown).
var _buyBusy = false;
window.openInvestConfirm = async function(tierKey, btn){
  const p = (STATE.products||[]).find(x => x.key === tierKey);
  if (!p || (btn && btn.disabled) || _buyBusy) return;
  _buyBusy = true;
  const label = btn ? btn.textContent : '';
  if (btn) btn.textContent = 'Buying…';
  let result;
  try { result = await api('/invest/create', { method:'POST', body:JSON.stringify({ tierKey, expectedPrice: Number(p.price) || 0 }) }); }
  finally { _buyBusy = false; if (btn && btn.isConnected) btn.textContent = label || 'Buy Now'; }
  if (result.stale) return;
  if (result.status === 'error' && result.code === 'PRICE_CHANGED') { try { refreshCatalogNow(); } catch (_) {} }
  if (result.status !== 'success') {
    const short = result.code === 'INSUFFICIENT_BALANCE' || /^Need .*, have /.test(String(result.message || ''));
    if (short) {
      notify('Insufficient balance, redirecting to deposit...', () => openDepositSheet());
      setTimeout(() => { if (_notifyOnClose) closeNotify(); }, 1800);
      return;
    }
    notify(result.message || 'Could not complete investment');
    return;
  }
  showPage('home');
  notify(`${p.name} is now running. See it under Orders.`);
};

// The Cancel button and backdrop both call this by name from inline markup.
// It must be a window property; a missing global here leaves confirmBg up and
// keeps the document's scroll lock active, which traps the member on screen.
window.closeConfirm = function(){
  $('confirmBg').classList.remove('show'); dlgClosed();
  $('confirmSheet').innerHTML = '';
  if (!isScrollLockOverlayOpen()) unlockBodyScroll();
};

// ── PWA: install prompt + service worker auto-update ──
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  window._installPrompt = e;
});
window.addEventListener('appinstalled', () => { window._installPrompt = null; });
// Owner, originally: "make when one taps download, it opens and middle
// there is a button download, and in background there is image uploaded
// from admin panel" -- built as its own full screen (openDownloadSheet(),
// with an admin-uploadable 'downloadbg' backdrop). Later reversed: "remove
// that stuff of download app background, here, one just taps on and it
// stimulates downloading, no going inside, so remove download app back
// image input." The Account row below now calls promptInstallApp()
// directly -- no screen in between -- and the 'downloadbg' image slot, its
// admin upload UI, and this function are gone, not just unlinked.
window.promptInstallApp = async function(){
  if (!window._installPrompt) { notify('Already installed, or your browser doesn\'t support installing ' + brandName() + '.'); return; }
  window._installPrompt.prompt();
  await window._installPrompt.userChoice.catch(() => null);
  window._installPrompt = null;
};
// ── CLAIM DIALOG: "Claim successful +amount" with one OK (Order gifts, Gift Code, app claim) ──
window.ptClaimDialog = function(amount){
  const old = $('ptClaimBg'); if (old) old.remove();
  const bg = document.createElement('div');
  bg.id = 'ptClaimBg'; bg.className = 'pt-claim-bg';
  bg.innerHTML = `<div class="pt-claim" role="dialog" aria-modal="true"><span class="tick"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M6 12.6l4 4 8-8.6"/></svg></span><h3>Claim successful</h3><b>+${esc(vMoney2(amount))}</b><button type="button" onclick="closeClaimDialog()">OK</button></div>`;
  bg.onclick = e => { if (e.target === bg) closeClaimDialog(); };
  document.body.appendChild(bg);
  requestAnimationFrame(() => bg.classList.add('show'));
};
// ── GIFT CODE WIN CARD (owner's recording): gift picture, "Congratulations!", "You won", the amount big in red, "New Balance: ..." and Collect, over the page
// dimmed red and blurred with soft red bubbles. Only the Gift Code uses it; Order Gifts and the app reward keep the "Claim successful" card above.
window.ptWinDialog = function(amount, balance){
  const old = $('ptWinBg'); if (old) old.remove();
  const bg = document.createElement('div');
  bg.id = 'ptWinBg'; bg.className = 'pt-win-bg';
  let bubbles = '';
  for (let i = 0; i < 12; i++) {
    const size = 16 + shareRand(18), left = 4 + shareRand(92), top = 69 + shareRand(8), delay = shareRand(40) / 100;
    bubbles += `<i style="width:${size}px;height:${size}px;left:${left}%;top:${top}%;animation-delay:${delay}s"></i>`;
  }
  bg.innerHTML = `<div class="pt-win-fx" aria-hidden="true">${bubbles}</div><div class="pt-win" role="dialog" aria-modal="true"><span class="e" aria-hidden="true">\ud83c\udf81</span><h3>Congratulations!</h3><p class="w">You won</p><b class="amt" id="ptWinAmt"><span>${esc(vMoney2(amount))}</span></b><p class="nb">New Balance: ${esc(vMoney2(balance))}</p><button type="button" onclick="closeWinDialog()">Collect</button></div>`;
  bg.onclick = e => { if (e.target === bg) closeWinDialog(); };
  document.body.appendChild(bg);
  const a = $('ptWinAmt'); if (a) { const t = a.firstChild, box = a.parentNode.clientWidth - 56; let fs = 38; while (t.getBoundingClientRect().width > box && fs > 22) { fs -= 1; a.style.fontSize = fs + 'px'; } }
  requestAnimationFrame(() => bg.classList.add('show'));
};
window.closeWinDialog = function(){ const bg = $('ptWinBg'); if (bg) { bg.classList.remove('show'); setTimeout(() => bg.remove(), 200); } };
window.closeClaimDialog = function(){ const bg = $('ptClaimBg'); if (bg) { bg.classList.remove('show'); setTimeout(() => bg.remove(), 200); } };

// ── ORDER GIFTS: one card per product that carries a gift; "receive" is live once the member has bought it ──
window.openOrderGiftsPage = async function(){
  openSheet('Order Gifts', '<div class="pt-og"><div class="pt-ogload">Loading...</div></div>');
  const r = await api('/gifts/list');
  if (_openSheetTitle !== 'Order Gifts') return;
  STATE.gifts = r.status === 'success' ? r.gifts : null;
  paintOrderGifts(r.status === 'success');
};
function paintOrderGifts(ok){
  const box = document.querySelector('.pt-og'); if (!box) return;
  if (!ok) { box.innerHTML = '<div class="pt-ogload" onclick="openOrderGiftsPage()">Could not load. Tap to try again.</div>'; return; }
  const list = STATE.gifts || [];
  if (!list.length) { box.innerHTML = '<div class="pt-ogload">No gifts yet</div>'; return; }
  box.innerHTML = list.map(g => `<div class="pt-og-card"><div class="t"><b>${esc(g.name)}</b><span>Gift: <i>${esc(cur() + ' ' + (Number(g.amount) || 0).toFixed(2))}</i></span></div>
    <button type="button" class="${g.owned && !g.claimed ? 'on' : ''}" ${g.owned && !g.claimed ? `onclick="claimOrderGift('${esc(g.key)}',this)"` : 'disabled'}>${g.claimed ? 'received' : 'receive'}</button></div>`).join('');
}
window.claimOrderGift = async function(key, btn){
  if (!rapidTapGuardOk('gift:' + key)) return;
  if (btn) btn.disabled = true;
  const r = await post('/gifts/claim', { key });
  if (r.stale) return;
  if (r.status !== 'success') { if (btn) btn.disabled = false; return notify(r.message || 'Could not receive this gift'); }
  const g = (STATE.gifts || []).find(x => x.key === key); if (g) g.claimed = true;
  if (STATE.account && r.walletBalance != null) STATE.account.walletBalance = r.walletBalance;
  paintOrderGifts(true);
  ptClaimDialog(r.amount);
  refreshTransactionsCache().catch(() => {});
};

// ── DOWNLOAD APP ──
var PT_DL_DOWN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 11l5 5 5-5M5 20h14"/></svg>';
var PT_DL_GIFT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M5 12v8h14v-8M12 8H8a2.5 2.5 0 1 1 0-5c2.5 0 4 3 4 5zm0 0h4a2.5 2.5 0 1 0 0-5c-2.5 0-4 3-4 5z"/></svg>';
var PT_DL_TICK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.6l4.4 4.4L19 7.4"/></svg>';
// The Claim button, or "Reward claimed" (pale, not tappable) once this member has taken it.
function ptClaimButtonHtml(claim){
  if (STATE.account && STATE.account.appClaimed === true) return `<button type="button" class="pt-dlbtn claim claimed" id="ptAppClaimBtn" disabled>${PT_DL_TICK}<span>Reward claimed</span></button>`;
  return claim > 0 ? `<button type="button" class="pt-dlbtn claim" id="ptAppClaimBtn" onclick="claimAppReward(this)">${PT_DL_GIFT}<span>Claim ${esc(numGroup(claim, true))}</span></button>` : '';
}
window.openDownloadPage = function(){
  const claim = Number((STATE.settings || {}).appClaimAmount) || 0;
  const faq = [['Installation is blocked by my phone', 'Open Settings, find "Special app access" or "Install unknown apps", and allow your browser to install apps. Then run the APK file again from your browser\'s downloads.'],
    ['The download does not start', 'Make sure you are opening this page in a normal mobile browser. In-app browsers (for example inside social apps) may block APK downloads - tap the menu at the top right and choose "Open in browser".'],
    ['Can I use this app on iPhone?', 'The app is currently available for Android only. Please open this page on an Android phone to download and install it.']];
  const step = (n, t, d) => `<div class="pt-step"><span>${n}</span><div><b>${t}</b><p>${d}</p></div></div>`;
  openSheet('Download App', `<div class="pt-dl">
    <section class="pt-dlhero">
      <button type="button" class="pt-dlback" onclick="closeSheet()" aria-label="Back"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg></button>
      <span class="pt-dllogo">${STATE.logo ? `<img src="${esc(STATE.logo)}" alt="">` : ''}</span>
      <h2>${esc(brandName())}</h2>
      <p class="sub">Official App \u00b7 Fast &amp; Secure</p>
      <div class="chips"><span>Android 7.0+</span><span>3.4 MB</span><span>Official</span></div>
      <button type="button" class="pt-dlbtn" onclick="promptInstallApp()">${PT_DL_DOWN}<span>Download APK</span></button>
      ${ptClaimButtonHtml(claim)}
      <p class="cap">Free download \u00b7 Tap the button above to install</p>
    </section>
    <section class="pt-dlcard"><h3><i></i>Install in 3 steps</h3>
      ${step(1, 'Download the APK', 'Tap the download button and wait for the file to finish downloading.')}${step(2, 'Allow installation', 'If prompted, enable "Install unknown apps" for your browser in settings.')}${step(3, 'Open and sign in', 'Install the app, open it and sign in with your existing account.')}
    </section>
    <div class="pt-dltiles"><div><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 3l7 2.5V11c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V5.5z"/></svg><b>Secure</b><span>Encrypted data</span></div><div><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M13 3L5 13.5h6L10 21l8-10.5h-6z"/></svg><b>Fast</b><span>Lightweight app</span></div><div><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/></svg><b>Official</b><span>Direct download</span></div></div>
    <section class="pt-dlcard faq"><h3><i></i>FAQ</h3>${faq.map((f, i) => `<div class="pt-faq"><button type="button" onclick="ptFaq(this)"><b>${f[0]}</b><em>+</em></button><p>${f[1]}</p></div>`).join('')}</section>
    <p class="pt-dlfoot">${esc(brandName())} Official Client<br>\u00a9 ${new Date().getFullYear()} All rights reserved</p>
  </div>`);
};
window.ptFaq = function(btn){
  const row = btn.closest('.pt-faq'); const open = row.classList.toggle('open');
  btn.querySelector('em').textContent = open ? '-' : '+';
};
window.claimAppReward = async function(btn){
  if (!rapidTapGuardOk('appclaim')) return;
  if (btn) btn.disabled = true;
  const r = await post('/app/claim', {});
  if (r.stale) return;
  if (btn) btn.disabled = false;
  if (r.code === 'ALREADY_CLAIMED') { if (STATE.account) STATE.account.appClaimed = true; const cb0 = $('ptAppClaimBtn'); if (cb0) cb0.outerHTML = ptClaimButtonHtml(0); return notify(r.message || 'You have already claimed this.'); }
  if (r.status !== 'success') return notify(r.message || 'Could not claim right now');
  if (STATE.account && r.walletBalance != null) STATE.account.walletBalance = r.walletBalance;
  if (STATE.account) STATE.account.appClaimed = true;
  const cb = $('ptAppClaimBtn'); if (cb) cb.outerHTML = ptClaimButtonHtml(0);
  ptClaimDialog(r.amount);
  refreshTransactionsCache().catch(() => {});
};

// ── ABOUT US: the admin's two banners, then the admin's own HTML (cleaned) ──
// Everything below the banners is ONE piece of HTML pasted in Admin > Banners > About page. The server cleans it when it is saved and this
// function cleans it again: no scripts, frames, forms, styles that load things, event handlers or javascript: links.
function ptCleanHtml(html){
  const tpl = document.createElement('template');
  tpl.innerHTML = String(html || '');
  const kill = 'script,iframe,object,embed,link,meta,base,form,noscript,frame,frameset,applet,input,button,textarea,select';
  tpl.content.querySelectorAll(kill).forEach(n => n.remove());
  tpl.content.querySelectorAll('*').forEach(el => {
    [...el.attributes].forEach(a => {
      const n = a.name.toLowerCase(), v = String(a.value).replace(/[\s\u0000-\u001f]/g, '').toLowerCase();
      if (n.startsWith('on')) el.removeAttribute(a.name);
      else if (['href', 'src', 'xlink:href', 'action', 'formaction', 'srcset', 'poster'].includes(n) && /^(javascript|vbscript|data:text)/.test(v)) el.removeAttribute(a.name);
      else if (n === 'style' && /expression\(|javascript:|url\(\s*['"]?\s*(javascript|data:text)/i.test(a.value)) el.removeAttribute(a.name);
    });
    if (el.tagName === 'A') { el.setAttribute('rel', 'noopener noreferrer'); if (el.getAttribute('target')) el.setAttribute('target', '_blank'); }
    if (el.tagName === 'STYLE') el.textContent = String(el.textContent).replace(/@import[^;]*;?|expression\([^)]*\)|javascript:/gi, '');
  });
  return tpl.innerHTML;
}
window.openAboutPage = async function(){
  openSheet('About Us', `<div class="pt-ab">
    <div class="pt-abban">${STATE.aboutBanner ? `<img src="${esc(STATE.aboutBanner)}" alt="" onerror="this.style.display='none'">` : ''}<button type="button" class="pt-dlback" onclick="closeSheet()" aria-label="Back"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg></button></div>
    <span class="pt-ablogo">${STATE.aboutLogo ? `<img src="${esc(STATE.aboutLogo)}" alt="">` : ''}</span>
    <div class="pt-abhtml" id="abHtml"></div>
  </div>`);
  const r = await api('/public/about-content');
  const box = $('abHtml');
  if (box && r.status === 'success') box.innerHTML = ptCleanHtml(r.html);
};

// Owner: "remove double loading of startup loader or system it's self it
// can loading the again it reloads automatically without touching it so
// remove it, the system should launch once per user's request." This app
// ships a new build almost every round (sw.js's own cache version bumps
// nearly every commit) -- checkForUpdate() below runs hourly AND on every
// tab focus/visibility change, so a member who simply switches back to
// this tab after using another app for a few minutes was very likely to
// have a new service worker already waiting, take control
// (controllerchange), and get bounced straight back to the loading
// screen via an UNPROMPTED location.reload() -- exactly "reloads
// automatically without touching it." Genuine auto-update behavior, not
// a bug in the sense of doing the wrong thing, but the owner explicitly
// doesn't want the app ever reloading itself outside of the member's own
// action of launching it. Fixed by dropping the forced reload entirely --
// the new service worker still activates and takes over in the
// background exactly as before (clients.claim() is unchanged, sw.js
// itself untouched), so the NEXT genuine launch (closing and reopening
// the app, or a manual browser refresh) already serves the fresh shell
// via sw.js's own network-first navigation strategy, with zero silent
// interruption of whatever the member is doing right now.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      // register() normally resolves WITH a registration, but it can resolve
      // with nothing where service workers are blocked by policy or by the
      // browser. Unguarded, the first visibilitychange after that threw
      // "Cannot read properties of undefined (reading 'update')" -- harmless
      // to the member, but a real uncaught error on every return to the app.
      if (!reg) return;
      const checkForUpdate = () => reg.update().catch(() => {});
      setInterval(checkForUpdate, 60 * 60 * 1000);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) checkForUpdate(); });
      window.addEventListener('focus', checkForUpdate);
    }).catch(() => {});
  });
}

// ── MOVING THIS SESSION ONTO A DIFFERENT ADDRESS ──
// ── START ──
captureReferralFromUrl();
// Asked alongside boot() rather than before it: one extra round trip in
// front of the loading screen would slow down every single arrival to buy a
// decision that, most of the time, is "stay where you are". If the answer is
// "move", the page navigates and whatever boot() had started is discarded
// with it.
// The dialling-code chips are static "+256" in the markup; a returning
// device already knows its region from localStorage (restoreRegion above),
// so paint them from it before the first network reply lands rather than
// showing Uganda's code to a Kenyan for a beat.
paintRegionChrome();
// Same reasoning for the language: the country's allowed list came back with
// the region and was cached with it, so a returning device opens straight
// into the language it was left in instead of showing English until
// /public/settings lands. The observer is started first so anything the boot
// path renders is translated as it appears, not after a visible flash.
var _bootPromise = boot();
