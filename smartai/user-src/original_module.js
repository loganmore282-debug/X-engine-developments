/* Smart AI member app.
   The pages are ChocoMCC's (Home, AI Robots, Rewards, Team, Me and their full-screen sheets) in blue and white with the owner's icons,
   running on Smart AI's own server: its sign-in (/auth/*), 6-digit Trade Password, Google Authenticator, deposits, withdrawals and rewards. */
// The server answers under /k7x2 on the page's own host (nginx strips the prefix). No domain is baked in, so a new host never needs a rebuild.
var SERVER = '/k7x2';
var BRAND_CACHE_KEY = 'smartai_brand_name';
var SETTINGS_CACHE_KEY = 'smartai_settings_cache';
var PRODUCTS_CACHE_KEY = 'smartai_products_cache';
// The numbers before the server has answered: the server's own defaults. Everything the member sees is replaced by what /public/settings says.
var DEFAULT_SETTINGS = {
  withdrawFeePct: 15, minWithdraw: 8000, minDeposit: 30000, welcomeBonus: 0,
  commL1: 25, commL2: 2, commL3: 1, dailyCheckin: 250, maxWithdrawalsPerDay: 2,
  requireTwofaToWithdraw: true, withdrawWindowEnabled: false, withdrawOpenFrom: '09:00', withdrawOpenTo: '17:00',
  salaryTiers: [], depositMethodNames: '', brandName: '', shareMessage: 'Join me on {app}', shareDomain: '',
  supportTelegram: '', telegramGroup: '', telegramChannel: '', supportHours: '', whatsappGroup: '', whatsappContact: '',
  rulesText: '', homeBannerTitle: '', homeBannerText: '', giftCodeHint: 'Enter gift code', appClaimAmount: 0
};
var ICON_CHEV = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>';
// Filled by syncPublicConfig() from the admin's products; the last copy this device saw is read first so the very first paint is already right.
var PRODUCTS = [];
try {
  var _cachedProducts = JSON.parse(localStorage.getItem(PRODUCTS_CACHE_KEY) || 'null');
  if (Array.isArray(_cachedProducts) && _cachedProducts.length) PRODUCTS = _cachedProducts;
} catch (e) {}
var NETWORK_COLORS = { 'MTN Mobile Money': { color: '#FFCC08', textColor: '#0B2A5B' }, 'Airtel Money': { color: '#ED1C24', textColor: '#fff' } };
// Pictures the admin uploaded (Admin > Banners): Home banner, Login banner and logo, Team / My / About / Share banners. None set = a blue art banner.
var ART = { home: '', authhero: '', authlogo: '', teambanner: '', mybanner: '', aboutbanner: '', promobanner: '', profilelogo: '', announcement: '' };
var LOCKOUT_IC_MAINT = '<svg viewBox="0 0 24 24" width="64" height="64" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4 4 0 005 5l-9.5 9.5a2.1 2.1 0 01-3-3l9.5-9.5a4 4 0 01-2-1.5z"/><circle cx="17" cy="7" r="1.2" fill="currentColor" stroke="none"/></svg>';
var LOCKOUT_IC_BANNED = '<svg viewBox="0 0 24 24" width="56" height="56" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'+
  '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/><circle cx="12" cy="16" r="1.6" fill="currentColor" stroke="none"/>'+
'</svg>';
function $(id){ return document.getElementById(id); }

/* ====================== THE APP'S NAME ======================
   One admin setting (Settings > App name) read from here everywhere; the last name this device saw is painted by index.html before this file
   even unpacks, so the loading screen never shows a wrong or blank name. Nothing in this file spells the name out. */
function brandNameKnown(){
  var n = (getSettings().brandName || '').trim();
  if (n) return n;
  var cached = typeof window.__brandCached === 'string' ? window.__brandCached.trim() : '';
  return cached || '';
}
function brandName(){ return brandNameKnown() || 'Smart AI'; }
function applyBrandName(){
  var known = brandNameKnown();
  if (!known) return;
  document.querySelectorAll('[data-brandname]').forEach(function(el){ el.textContent = known; });
  document.querySelectorAll('[data-brandmark]').forEach(function(el){ el.textContent = known.toUpperCase(); });
  try { document.title = known; } catch (e) {}
  try {
    if (window.__brandCached !== known) { localStorage.setItem(BRAND_CACHE_KEY, known); window.__brandCached = known; }
  } catch (e) {}
}

/* ====================== SERVER API ====================== */
// The lock-out screen (maintenance, suspended account, or an address that is not in use) is triggered from the one place every call passes
// through (api(), below), so an action already in flight is shut down the instant the server refuses it. It has no close button on purpose.
function showLockout(kind, message){
  var scr = $('lockoutScreen');
  if (!scr) return;
  var ic = $('lockoutIc'), title = $('lockoutTitle'), msg = $('lockoutMsg'), cta = $('lockoutCta');
  if (kind === 'banned') {
    ic.innerHTML = LOCKOUT_IC_BANNED;
    title.textContent = 'Account Suspended';
    msg.textContent = message || 'Account suspended. Contact customer service.';
    var link = getSettings().supportTelegram;
    if (link) { cta.style.display = ''; cta.textContent = 'Contact Customer Service'; cta.onclick = function(){ window.open(link, '_blank', 'noopener'); }; }
    else cta.style.display = 'none';
    // A suspended account is signed out for real, not just covered up.
    try { if (window.fbSignOut) window.fbSignOut(); } catch (e) {}
    STATE = null;
    stopActivityFeed();
    stopAccountPoll();
  } else if (kind === 'parked') {
    ic.innerHTML = LOCKOUT_IC_MAINT;
    title.textContent = brandName();
    msg.textContent = message || 'This address is not in use. Open the app from the link you were given.';
    cta.style.display = 'none';
  } else {
    ic.innerHTML = LOCKOUT_IC_MAINT;
    title.textContent = 'Under Maintenance';
    msg.textContent = message || (brandName() + ' is under maintenance. Please check back shortly.');
    cta.style.display = 'none';
  }
  hideLoadingScreen();
  scr.classList.add('show');
}
// Counts money-moving requests in flight, so a service-worker update never reloads the page in the middle of a payment (see index.html).
window.__moneyCallsInFlight = 0;
var _wokenUp = false;
// The server's own clock (X-Server-Time on every reply): the offset from this phone's clock. Only used to warn that the phone's clock is wrong,
// because a Google Authenticator code is made from the phone's clock and cannot match when it is far from the real time.
var _skewMs = 0, _skewRtt = Infinity;
function noteServerClock(resp, sentAt){
  try {
    var sv = Number(resp.headers.get('X-Server-Time')); if (!sv) return;
    var now = Date.now(), rtt = now - sentAt;
    if (rtt <= _skewRtt + 150 || _skewRtt === Infinity) { _skewRtt = Math.min(_skewRtt, rtt); _skewMs = sv - (sentAt + rtt / 2); }
  } catch (e) {}
}
function clockOffSecs(){ return Math.round(Math.abs(_skewMs) / 1000); }
async function api(path, body, method, retry){
  var isWrite = !!body;
  if (isWrite) window.__moneyCallsInFlight++;
  try {
    return await _apiRaw(path, body, method, retry);
  } finally {
    if (isWrite) {
      window.__moneyCallsInFlight--;
      // An update that arrived while a request was in flight was held back; now it is safe.
      if (window.__moneyCallsInFlight <= 0 && window.__swUpdateReady) window.__swUpdateReady();
    }
  }
}
// Reads (no body) are retried a few times so a weak connection or a restarting server does not show as an error; a call that moves money is
// NEVER retried (a repeated deposit, withdrawal, purchase or redeem could be applied twice).
async function _apiRaw(path, body, method, retry){
  method = method || (body ? 'POST' : 'GET');
  if (retry === undefined) retry = (method === 'GET');
  var isPublic = path.indexOf('/public/') === 0;
  var epoch = _authEpoch;
  var delays = [0, 2500, 6000];
  var attempts = retry ? delays.length : 1;
  for (var i = 0; i < attempts; i++) {
    if (i > 0) await new Promise(function(r){ setTimeout(r, delays[i]); });
    if (!isPublic && epoch !== _authEpoch) return { status: 'error', stale: true, message: 'Session changed' };
    var headers = {};
    var user = window.fbAuth && window.fbAuth.currentUser;
    if (user) {
      try { var tok = await user.getIdToken(); if (tok) headers['Authorization'] = 'Bearer ' + tok; } catch (e) {}
    }
    var ctl = new AbortController(), timer = setTimeout(function(){ ctl.abort(); }, 45000);
    var opts = { method: method, headers: headers, signal: ctl.signal };
    if (body) { headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    try {
      var sentAt = Date.now();
      var resp = await fetch(SERVER + path, opts);
      noteServerClock(resp, sentAt);
      var data = await resp.json();
      clearTimeout(timer);
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid response');
      _wokenUp = true;
      if (!isPublic && epoch !== _authEpoch) return { status: 'error', stale: true, message: 'Session changed' };
      if (data.code === 'MAINTENANCE') showLockout('maintenance', data.message);
      else if (data.code === 'HOST_PARKED') showLockout('parked', data.message);
      else if (data.code === 'BANNED' && _appEntered) showLockout('banned', data.message);
      // The server ended this login (password changed elsewhere, a ban, or a session that no longer exists): back to the sign-in screen.
      else if (resp.status === 401 && !isPublic && STATE && path.indexOf('/auth/') !== 0) sessionEnded();
      return data;
    } catch (e) {
      clearTimeout(timer);
      if (!isPublic && epoch !== _authEpoch) return { status: 'error', stale: true, message: 'Session changed' };
      if (i === attempts - 1) return { status: 'error', message: ctl.signal.aborted ? 'The request took too long. Check Records before trying a payment again.' : 'Could not reach the server. Check your connection and try again.' };
    }
  }
}
// Bumped on every sign-in and sign-out. A reply that arrives after the member changed is dropped, so one member's balance can never be painted into another's session.
var _authEpoch = 0;

function tsMs(v){
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'object') {
    if (typeof v._seconds === 'number') return v._seconds * 1000;
    if (typeof v.seconds === 'number') return v.seconds * 1000;
    if (typeof v.$date === 'string') return Date.parse(v.$date) || 0;
  }
  var n = Date.parse(String(v));
  return isNaN(n) ? 0 : n;
}
function fmtStamp(ms){
  var d = new Date(ms); if (!ms || isNaN(d.getTime())) return '';
  var p = function(n){ return String(n).padStart(2, '0'); };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}
// Pulls the live account, products, bank cards and ledger from the server and stamps them onto STATE. Called on entry, after every money action
// and by the poll, because deposits, withdrawals and the daily payouts all settle on the server.
// A slow or briefly unreachable server would otherwise raise the same warning on every poll: it is said once per outage.
var _serverUnreachableWarned = false;
async function refreshFromServer(){
  var results = await Promise.all([ api('/account'), api('/investments'), api('/bank/list'), api('/transactions') ]);
  var accR = results[0], invR = results[1], bankR = results[2], txR = results[3];
  if (accR.stale || !STATE) return accR;
  if (accR.status === 'success') {
    _serverUnreachableWarned = false;
    var a = accR.account;
    STATE.phone = a.phone || STATE.phone;
    STATE.balance = Number(a.walletBalance) || 0; STATE.totalDeposited = a.totalDeposited || 0;
    STATE.totalEarned = a.totalEarned || 0; STATE.totalWithdrawn = a.totalWithdrawn || 0;
    STATE.totalInvested = a.totalInvested || 0;
    STATE.checkinStreak = a.checkinStreak || 0; STATE.lastCheckin = a.lastCheckin || null;
    STATE.referralCode = a.referralCode || STATE.referralCode;
    STATE.twofaEnabled = a.twofaEnabled === true; STATE.hasTradePin = a.hasTradePin === true;
    STATE.withdrawAnytime = a.withdrawAnytime === true; STATE.appClaimed = a.appClaimed === true;
    STATE.team = a.team || STATE.team;
  } else if (accR.code === 'MAINTENANCE' || accR.code === 'BANNED' || accR.code === 'HOST_PARKED') {
    // handled by the full-screen lock-out inside api()
  } else if (!_serverUnreachableWarned) {
    _serverUnreachableWarned = true;
    toast('Could not reach the server, showing your last known balance');
  }
  if (invR.status === 'success' && Array.isArray(invR.investments)) {
    // Every figure is read straight off the server's own record of the purchase and never worked out here, so the app can only show the real number.
    STATE.investments = invR.investments.map(function(iv){
      return { id: iv.id, key: iv.tierKey, name: iv.tierLabel, price: iv.amount,
        cycleDays: iv.payoutsTotal || iv.cycle, daysElapsed: iv.payoutsMade || 0, accrued: iv.paidOut || 0, matured: iv.status === 'matured' || iv.status === 'completed',
        dailyIncome: iv.dailyPayout, totalIncome: iv.expectedReturn, purchasedAt: tsMs(iv.createdAt) || null };
    });
  }
  if (bankR.status === 'success') STATE.bankAccounts = bankR.accounts || [];
  if (txR.status === 'success' && Array.isArray(txR.transactions)) {
    STATE.transactions = txR.transactions.map(function(t){
      var when = tsMs(t.createdAt) || tsMs((t.date || '') + ' ' + (t.time || ''));
      return { type: t.type, amount: Number(t.amount) || 0, desc: t.description || '', status: t.status || 'success', ref: t.ref || t.statementId || '', when: when };
    });
  }
  saveState();
  return accR;
}
// The admin's economics, products and pictures, so a change made in the admin panel reaches members without a new app. Settings are kept in
// localStorage next to the products, so the next launch paints with the last real numbers before the network answers.
async function syncPublicConfig(){
  var jobs = [];
  jobs.push(api('/public/settings').then(function(r){
    if (r && r.status === 'success' && r.settings) {
      try { localStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify(r.settings)); } catch (e) {}
      applyBrandName();
    }
  }).catch(function(){}));
  jobs.push(api('/public/products').then(function(r2){
    if (r2 && r2.status === 'success' && Array.isArray(r2.products)) {
      PRODUCTS = r2.products.filter(function(p){ return !p.deleted; });
      saveProductsCache();
    }
  }).catch(function(){}));
  await Promise.all(jobs);
}
function saveProductsCache(){
  try { localStorage.setItem(PRODUCTS_CACHE_KEY, JSON.stringify(PRODUCTS)); }
  catch (e) {
    // Photos can be a few megabytes: if they do not fit, keep the list without them (they are fetched again anyway).
    try { localStorage.setItem(PRODUCTS_CACHE_KEY, JSON.stringify(PRODUCTS.map(function(p){ return Object.assign({}, p, { image: '' }); }))); } catch (e2) {}
  }
}
// The admin's pictures (banners, logo). Fetched behind the screen, not in front of it: the app paints with the blue art banner and swaps each
// picture in as it lands.
var _artTries = 0;
var _artPromise = null;
function syncArtwork(){ _artPromise = _syncArtwork(); return _artPromise; }
async function _syncArtwork(){
  var rs = await Promise.all([ api('/public/smartai-images'), api('/public/banner'), api('/public/announcement-image') ]);
  var im = rs[0], bn = rs[1], an = rs[2];
  if (im.status === 'success') {
    ['authhero', 'authlogo', 'teambanner', 'mybanner', 'aboutbanner', 'promobanner', 'profilelogo'].forEach(function(k){ ART[k] = im[k] || ''; });
    STATE_ICONS = im.icons || {};
  }
  if (bn.status === 'success') ART.home = (bn.image || (Array.isArray(bn.slides) && bn.slides[0]) || bn.banner1 || '') || '';
  if (an.status === 'success') ART.announcement = an.image || '';
  if ((im.status !== 'success' || bn.status !== 'success') && _artTries++ < 3) setTimeout(syncArtwork, 4000);
  paintArt();
}
// The pictures of the app are the owner's built-in icon pack (/icons/<name>.webp); a picture uploaded in Admin > Banners > Icons for the same name replaces it.
var STATE_ICONS = {};
function iconUrl(name){ return (STATE_ICONS && STATE_ICONS[name]) || '/icons/' + name + '.webp'; }
function paintIcons(){
  document.querySelectorAll('img[data-icon]').forEach(function(img){
    var name = img.getAttribute('data-icon'), u = iconUrl(name);
    if (img.getAttribute('src') !== u) {
      img.onerror = function(){ this.onerror = null; this.src = '/icons/' + name + '.webp'; };
      img.setAttribute('src', u);
    }
  });
}
function serverTodayKey(){
  var d = new Date(Date.now() + 3 * 3600000);
  var p = function(n){ return String(n).padStart(2, '0'); };
  return p(d.getUTCMonth() + 1) + '/' + p(d.getUTCDate()) + '/' + d.getUTCFullYear();
}
function getSettings(){
  try { return Object.assign({}, DEFAULT_SETTINGS, JSON.parse(localStorage.getItem(SETTINGS_CACHE_KEY) || '{}')); }
  catch (e) { return Object.assign({}, DEFAULT_SETTINGS); }
}
// What a member sees before buying is exactly what he will be paid: the product's own payout and cycle win (the server computes it the same way).
function productCycle(p){ return Number(p && p.cycle) || 150; }
function productExpectedReturn(p){ return Number(p && p.expectedReturn) || Math.round((p ? p.price : 0) * (Number(p && p.multiplier) || 1)); }
function dailyReturn(p){ return Math.round(productExpectedReturn(p) / productCycle(p)); }
function ugx(n){ n = Number(n) || 0; var hasCents = Math.round(n * 100) % 100 !== 0; return 'UGX ' + (hasCents ? (Math.round(n * 100) / 100).toFixed(2) : String(Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]; }); }
function spinnerHtml(){ return '<div class="cm-spin-wrap"><svg class="cm-spinner" viewBox="22 22 44 44"><circle cx="44" cy="44" r="20.2"></circle></svg></div>'; }
// Same small spinning-arc icon already used on the deposit status screen's
// Verify Payment button (.verify-spin) -- reused here as one shared helper
// so every "Please wait…" busy state app-wide (sign in/register, redeem
// gift code, check-in, Task Center claim, save bank account, deposit,
// withdraw, change password) actually spins instead of just swapping text
// with no visual motion at all.
function btnBusyHtml(text){
  return '<span class="verify-spin" style="margin-right:7px;vertical-align:-3px"><svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a1.6 1.6 0 010 3.2A6.8 6.8 0 1018.8 12a1.6 1.6 0 013.2 0 10 10 0 11-10-10z"/></svg></span>'+esc(text);
}

/* ====================== LOCAL STATE (a copy of the last server answer, for an instant repaint) ====================== */
// Kept in sessionStorage, not localStorage: a balance is not left on a shared phone after the app is closed. It is cleared at sign-out too.
var STATE = null;
var CACHED_STATE_PREFIX = 'smartai_state_';
function loadState(uid){
  try { var raw = sessionStorage.getItem(CACHED_STATE_PREFIX + uid); var s = raw ? JSON.parse(raw) : null; return s && s.uid === uid ? s : null; } catch (e) { return null; }
}
function saveState(){
  if (!STATE || !STATE.uid) return;
  try { sessionStorage.setItem(CACHED_STATE_PREFIX + STATE.uid, JSON.stringify(STATE)); } catch (e) {}
}
function clearCachedState(){
  try { Object.keys(sessionStorage).forEach(function(k){ if (k.indexOf(CACHED_STATE_PREFIX) === 0) sessionStorage.removeItem(k); }); } catch (e) {}
}
// Gates whether api() escalates a BANNED answer to the full-screen lock-out: false on the sign-in screen, where a suspended account gets the
// message under the form instead. MAINTENANCE always escalates.
var _appEntered = false;
function freshState(uid, phone){
  return {
    uid: uid, phone: phone || '', referralCode: '',
    balance: 0, totalDeposited: 0, totalEarned: 0, totalWithdrawn: 0, totalInvested: 0,
    checkinStreak: 0, lastCheckin: null, team: { l1: 0, l2: 0, l3: 0, commission: 0 },
    twofaEnabled: false, hasTradePin: false, withdrawAnytime: false, appClaimed: false,
    investments: [], transactions: [], bankAccounts: [], depositRecords: null, withdrawalRecords: null, messages: null, salary: null
  };
}

/* ====================== THE START-UP SCREEN ======================
   Stays for at least LOADER_MIN_MS from the moment the page began, then "Loading... 100%" turns to "Ready" for a moment and the page opens. */
var LOADER_MIN_MS = 2500, _ldTimer = null, _annAfterLoader = false, LOADED_MS = 150, READY_MS = 350;
function hideLoadingScreen(){
  var ls = $('loadingScreen'); if (!ls || ls.style.display === 'none') return;
  var began = Number(window._smartaiLoaderStart) || 0;
  var minMs = typeof window._smartaiLoaderMinMs === 'number' ? window._smartaiLoaderMinMs : LOADER_MIN_MS;
  var wait = began ? Math.max(0, minMs - (Date.now() - began)) : 0;
  if (_ldTimer) { clearTimeout(_ldTimer); _ldTimer = null; }
  var finish = function(){
    if (window._smartaiLoaderProgress) window._smartaiLoaderProgress(100);
    var go = function(){
      _ldTimer = null;
      ls.style.display = 'none';
      if (_annAfterLoader) { _annAfterLoader = false; maybeShowAnnouncement(); }
    };
    if (!window._smartaiLoaderReady || window._smartaiLoaderReadyMs === 0) { go(); return; }   // (the tests set _smartaiLoaderReadyMs = 0, like _smartaiLoaderMinMs)
    _ldTimer = setTimeout(function(){ window._smartaiLoaderReady(); _ldTimer = setTimeout(go, READY_MS); }, LOADED_MS);
  };
  if (!wait) { finish(); return; }
  _ldTimer = setTimeout(function(){ _ldTimer = null; finish(); }, wait);
}
function showLoadingScreen(){
  _annAfterLoader = false;
  if (_ldTimer) { clearTimeout(_ldTimer); _ldTimer = null; }
  $('loadingScreen').style.display = 'flex';
  if (window._smartaiLoaderRestart) window._smartaiLoaderRestart();
}
// If the sign-in script cannot be reached the page would sit on the start-up screen for ever: after a while say so and show the sign-in form.
setTimeout(function(){
  if (window.fbAuth) return;
  try { hideLoadingScreen(); if ($('app').style.display === 'none') $('authScreen').style.display = 'flex'; toast('Could not load the sign-in service. Check your connection, then reload the app.'); } catch (e) {}
}, 15000);

/* ====================== AUTH (Smart AI's own sign-in, see the module script in index.html) ====================== */
// The sign-in script names an account by a small address built from the phone number (the server reads only the number part). The same
// shape is built here and in server.js (phoneToEmail), so one number is always one account.
function phoneToEmail(phone){ return String(phone).replace(/\D/g, '').replace(/^0+/, '') + '@smartai-platform.com'; }
// Uganda: 9 digits starting with 7. Typed as 07XXXXXXXX, 7XXXXXXXX or +256 7XXXXXXXX: all reduce to the same 9 digits (or null when it is not a number).
function localDigits(raw){
  var s = String(raw || '').replace(/\D/g, '');
  if (s.indexOf('256') === 0 && s.length === 12) s = s.slice(3);
  else if (s.charAt(0) === '0' && s.length === 10) s = s.slice(1);
  return /^7\d{8}$/.test(s) ? s : null;
}
var authMode = 'login';
function setAuthMode(mode){
  authMode = mode;
  var reg = mode === 'register';
  $('regPassConfirmField').style.display = reg ? 'block' : 'none';
  $('regPinField').style.display = reg ? 'block' : 'none';
  $('regCodeField').style.display = reg ? 'block' : 'none';
  $('fPassConfirm').value = ''; $('fPin').value = '';
  $('authTitle').textContent = reg ? 'Create your account' : 'Welcome to ' + brandName();
  $('authSub').textContent = reg ? 'Join and start putting AI robots to work for you.' : 'Sign in to see what your AI robots have earned today.';
  $('authSwitchBtn').innerHTML = reg ? 'Already a member? <b>Sign In</b>' : 'New here? <b>Create Account</b>';
  $('authErr').style.display = 'none';
  $('authGo').textContent = reg ? 'Create Account' : 'Continue';
  paintAuthArt();
}
// A shared invitation link: .../share.html?v=<stamp>&code=<CODE>, .../#/inviteRegister?invitecode=<CODE>, .../?ref=<CODE>, .../refCode=<CODE>. All of them
// land on Create Account with the code already filled in. A referral code is case-sensitive on the server, so it is never changed.
var _refFromUrl = '';
function captureReferralFromUrl(){
  try {
    var search = new URLSearchParams(location.search);
    var ref = search.get('ref');
    if (!ref && location.hash) {
      var q = location.hash.indexOf('?');
      if (q !== -1) { var hp = new URLSearchParams(location.hash.slice(q + 1)); ref = hp.get('invitecode') || hp.get('inviteCode') || hp.get('ref'); }
    }
    if (!ref) { var m = /\/refCode=([^/?#]+)/.exec(location.pathname); if (m) { try { ref = decodeURIComponent(m[1]); } catch (e) { ref = m[1]; } } }
    if (!ref) ref = search.get('code');
    if (!ref) return;
    _refFromUrl = String(ref).trim();
    $('fCode').value = _refFromUrl;
    setAuthMode('register');
  } catch (e) {}
}
// Sign-in is driven by the button's own handler; the sign-in event it causes must sit out, or two code paths would race to open the app.
var _authInProgress = false;
function authFail(msg){
  var box = $('authErr'); box.textContent = msg; box.style.display = '';
  toast(msg);
}
function authErrMsg(e){
  var code = (e && e.code) || '';
  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') return 'Incorrect phone number or password.';
  if (code === 'auth/email-already-in-use') return 'An account with that number already exists.';
  if (code === 'auth/weak-password') return (e && e.message) || 'Password must be at least 6 characters.';
  if (code === 'auth/too-many-requests') return (e && e.message) || 'Too many attempts. Try again shortly.';
  if (code === 'auth/network-request-failed') return 'Could not reach the server. Check your connection and try again.';
  if (code === 'auth/invalid-email') return 'Enter a valid mobile number (07XXXXXXXX).';
  if (code === 'auth/bad-captcha') return (e && e.message) || 'The captcha code is wrong. Please try again.';
  return (e && e.message && code.indexOf('auth/') !== 0) ? e.message : 'Something went wrong, try again.';
}
// Finishes a sign-up that has an account but no profile yet (the Trade Password, the invitation code and the welcome gift are added here).
async function registerProfile(ref, pin, phone){
  var r = await api('/register', { referralCode: ref, pin: pin, phone: phone }, 'POST', true);
  // The invitation code is optional: a wrong one is dropped and the sign-up carries on without an upline.
  if (r.status === 'error' && r.code === 'BAD_REFERRAL' && ref) {
    toast(r.message || 'That invitation code is not valid. Continuing without it.');
    r = await api('/register', { referralCode: '', pin: pin, phone: phone }, 'POST', true);
  }
  return r;
}
$('authGo').onclick = async function(){
  var btn = this;
  if (btn.disabled) return;
  var local = localDigits($('fPhone').value);
  var pass = $('fPass').value;
  var errBox = $('authErr'); errBox.style.display = 'none';
  if (!$('fPhone').value.trim() || !pass) { toast('Enter your phone and password'); return; }
  if (!local) { toast('Enter a valid Uganda mobile number (07XXXXXXXX)'); shakeVibrate($('fPhone')); return; }
  if (pass.length < 6) { toast('Password must be at least 6 characters'); return; }
  var ref = '', pin = '';
  if (authMode === 'register') {
    if (pass !== $('fPassConfirm').value) { toast('Passwords do not match'); return; }
    pin = $('fPin').value.trim();
    if (!/^\d{6}$/.test(pin)) { toast('Trade Password must be exactly 6 digits'); shakeVibrate($('fPin')); return; }
    ref = $('fCode').value.trim();
  }
  if (!window.fbSignIn) { toast('Still connecting, try again in a moment'); return; }
  var email = phoneToEmail(local);
  var label = btn.textContent;
  btn.disabled = true; btn.innerHTML = btnBusyHtml('Please wait…');
  _authInProgress = true;
  try {
    var cred;
    if (authMode === 'register') {
      try { cred = await window.fbCreateUser(email, pass); }
      catch (e) {
        if (!(e && e.code === 'auth/email-already-in-use')) throw e;
        // The number already has an account. If the password typed is its password, this is a sign-up that was started and never finished
        // (a closed app, a lost connection): it signs in and finishes it below. Any other password is somebody else's account.
        try { cred = await window.fbSignIn(email, pass); }
        catch (e2) {
          setAuthMode('login');
          $('fPass').value = '';
          toast('This phone number already has an account, sign in instead');
          return;
        }
      }
      _authEpoch++;
      STATE = freshState(cred.user.uid, local);
      var regR = await registerProfile(ref, pin, local);
      if (regR.status !== 'success' && regR.status !== 'already_done') {
        try { await window.fbSignOut(); } catch (e3) {}
        STATE = null; _authEpoch++;
        authFail(regR.message || 'Could not finish setting up your account, try again shortly');
        return;
      }
      await refreshFromServer();
      toast('Registration successful ✓');
      enterApp();
      maybeOfferInstallAfterSignup();
    } else {
      cred = await window.fbSignIn(email, pass);
      _authEpoch++;
      STATE = loadState(cred.user.uid) || freshState(cred.user.uid, local);
      var acc = await refreshFromServer();
      if (!acc || acc.status !== 'success') {
        var c = acc && acc.code;
        try { await window.fbSignOut(); } catch (e4) {}
        STATE = null; _authEpoch++;
        if (c === 'BANNED') { authFail('Account locked.'); return; }
        if (c === 'NOT_FOUND' || c === 'REGISTRATION_REQUIRED') {
          // The account was made but its sign-up never finished: Create Account takes the same number and password and finishes it.
          setAuthMode('register');
          toast('Your sign-up was not finished. Complete it below.');
          return;
        }
        authFail((acc && acc.message) || 'Could not open your account. Please try again.');
        return;
      }
      await syncPublicConfig();
      enterApp();
    }
  } catch (e) {
    authFail(authErrMsg(e));
  } finally {
    btn.disabled = false; btn.textContent = authMode === 'register' ? 'Create Account' : 'Continue';
    _authInProgress = false;
  }
};
// Chrome's "Use saved password?" sheet fills both fields at once but never submits: the CSS animationstart trick on #fPass tells us it did, and
// Sign In then goes ahead by itself. Only on Sign In (Create Account has fields autofill never touches), and only once the phone box is filled too.
$('fPass').addEventListener('animationstart', function(e){
  if (e.animationName !== 'onAutoFillStart' || authMode !== 'login') return;
  if (!$('fPhone').value.trim() || !$('fPass').value) return;
  $('authGo').click();
});

async function doChangePassword(){
  var cur = $('pwCur').value, nw = $('pwNew').value, nw2 = $('pwNew2').value;
  if (!cur || !nw) { toast('Fill in both password fields'); return; }
  if (nw.length < 6) { toast('New password must be at least 6 characters'); return; }
  if (nw !== nw2) { toast('The new passwords do not match'); return; }
  if (!window.fbChangePassword) { toast('Still connecting, try again in a moment'); return; }
  var btn = $('changePassBtn'), label = btn.textContent;
  btn.disabled = true; btn.innerHTML = btnBusyHtml('Please wait…');
  try {
    await window.fbChangePassword(phoneToEmail(STATE ? STATE.phone : ''), cur, nw);
    $('pwCur').value = ''; $('pwNew').value = ''; $('pwNew2').value = '';
    // The server ends every session when the password changes: the member signs in again with the new one.
    closeOverlay();
    await logout({ auto: true, message: 'Password updated. Sign in with your new password.' });
  } catch (e) {
    toast(e && e.code === 'auth/invalid-credential' ? 'Current password is incorrect' : (e && e.code === 'auth/weak-password' ? (e.message || 'Password must be at least 6 characters') : (e && e.message && e.code ? e.message : 'Could not update password, try again')));
  } finally {
    btn.disabled = false; btn.textContent = label;
  }
}

// Tells the server first (so the token stops working), then forgets everything about the member on this phone.
var _loggingOut = false;
async function logout(opts){
  if (_loggingOut) return;
  _loggingOut = true;
  try {
    opts = opts || {};
    var u = window.fbAuth && window.fbAuth.currentUser;
    if (u && !opts.skipServer) u.getIdToken().then(function(t){
      var ac = new AbortController(); setTimeout(function(){ ac.abort(); }, 5000);
      return fetch(SERVER + '/auth/session/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + t }, signal: ac.signal });
    }).catch(function(){});
    _authEpoch++;
    STATE = null; _appEntered = false;
    clearCachedState();
    _recordsLoaded = { accrued: true, topups: false, cashouts: false };
    stopActivityFeed(); stopAccountPoll(); stopDepositPoll();
    closeOverlay(); closeAllSheets();
    $('app').style.display = 'none';
    $('authScreen').style.display = 'flex';
    $('fPass').value = ''; if (!opts.auto) $('fPhone').value = '';
    setAuthMode('login');
    switchTab('home');
    try { if (window.fbSignOut) await window.fbSignOut(); } catch (e) {}
    if (opts.message) toast(opts.message);
  } finally { _loggingOut = false; }
}
var _sessionEndedAt = 0;
function sessionEnded(){
  if (Date.now() - _sessionEndedAt < 4000 || !STATE) return;
  _sessionEndedAt = Date.now();
  logout({ auto: true, skipServer: true, message: 'Your login session ended. Please sign in again.' });
}

function enterApp(){
  _appEntered = true;
  $('authScreen').style.display = 'none';
  $('app').style.display = 'block';
  renderAll();
  renderStaticPages();
  applyBrandName();
  startActivityFeed();
  startAccountPoll();
  updateDownloadTileVisibility();
  syncArtwork();
  refreshDepositSlot();
  refreshMessageBadge();
  hideLoadingScreen();
  maybeShowAnnouncement();
}
// Fires once the sign-in script has said who (if anyone) is signed in: at start-up, then on every sign-in and sign-out. It sits out while the form's
// own handler is driving a sign-in (_authInProgress), so the two can never race.
function showAuthScreen(){
  _appEntered = false;
  hideLoadingScreen();
  $('app').style.display = 'none';
  $('authScreen').style.display = 'flex';
  paintAuthArt();
  applyBrandName();
  setAuthMode(authMode);
  // The login screen wants the app's name and the Login pictures before anyone signs in.
  syncPublicConfig().then(function(){ applyBrandName(); setAuthMode(authMode); });
  syncArtwork();
}
function onFbAuthChanged(user){
  if (_authInProgress) return;
  if (user && (!STATE || STATE.uid !== user.uid)) {
    _authEpoch++;
    var cached = loadState(user.uid);
    STATE = cached || freshState(user.uid, '');
    if (cached) enterApp();
    var uid = user.uid;
    Promise.all([refreshFromServer(), syncPublicConfig()]).then(function(rs){
      var accR = rs[0];
      if (!STATE || STATE.uid !== uid) return;
      if (!accR || accR.stale) return;
      if (accR.status !== 'success') {
        var c = accR.code;
        if (c === 'BANNED') { showLockout('banned', accR.message); return; }
        if (c === 'MAINTENANCE' || c === 'HOST_PARKED') return;
        if (c === 'NOT_FOUND' || c === 'REGISTRATION_REQUIRED') {
          STATE = null; _authEpoch++;
          if (window.fbSignOut) window.fbSignOut();
          setAuthMode('register'); showAuthScreen(); toast('Your sign-up was not finished. Complete it below.');
          return;
        }
        // A slow or dropped connection is not a reason to end the login: the sign-in form shows the message and the session is kept.
        if (!cached) { STATE = null; _authEpoch++; showAuthScreen(); toast('Could not reach the server. Check your connection and try again.'); }
        return;
      }
      if (cached) { renderAll(); renderStaticPages(); } else enterApp();
    });
  } else if (!user) {
    STATE = null; _appEntered = false;
    clearCachedState();
    showAuthScreen();
  }
}

/* ====================== ADMIN-DRIVEN STATIC PAGES ======================
   Terms & Rules, Support and About read what the admin set (Settings and Banners), so an edit reaches every member's next app open. */
function nl2p(text){
  var paras = String(text || '').split(/\n\s*\n/).filter(function(p){ return p.trim(); });
  if (!paras.length) return '';
  return paras.map(function(p){ return '<p>' + esc(p).replace(/\n/g, '<br>') + '</p>'; }).join('<br>');
}
// Only a real web link is ever opened from an admin-typed address (never javascript: or data:).
function safeUrl(u){ u = String(u || '').trim(); return /^https?:\/\/[^\s"'<>]+$/i.test(u) ? u : ''; }
function openLink(u){ var s = safeUrl(u); if (s) window.open(s, '_blank', 'noopener'); }
var TG_ICON = '<svg width="18" height="18" viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="#26A5E4"/><path fill="#fff" d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.3-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71l-4.14-3.05-2 1.93c-.23.23-.42.42-.83.42z"/></svg>';
var TG_ICON_WHITE = '<svg width="16" height="16" viewBox="0 0 24 24"><path fill="#fff" d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.3-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71l-4.14-3.05-2 1.93c-.23.23-.42.42-.83.42z"/></svg>';
var WA_ICON = '<svg width="18" height="18" viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="#25D366"/><path fill="#fff" d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/></svg>';
function supportRow(url, icon, label){
  return '<button class="menu-item" style="margin:0 0 10px" data-open-url="' + esc(url) + '"><div class="menu-ic" style="background:transparent">' + icon + '</div><div class="menu-lbl">' + esc(label) + '</div>' + ICON_CHEV + '</button>';
}
function renderStaticPages(){
  var s = getSettings();
  // Terms & Rules: written by the admin, empty until set.
  $('rulesBody').innerHTML = s.rulesText ? nl2p(s.rulesText) : '<div class="empty">Nothing published yet.</div>';
  // Support: every configured destination gets its own row with the real brand icon.
  var rows = '';
  var links = [
    [s.telegramChannel, TG_ICON, 'Telegram Channel'], [s.telegramGroup, TG_ICON, 'Telegram Group'], [s.supportTelegram, TG_ICON, 'Message us on Telegram'],
    [s.whatsappGroup, WA_ICON, 'WhatsApp Group'], [s.whatsappContact, WA_ICON, 'Message us on WhatsApp']
  ];
  links.forEach(function(l){ if (safeUrl(l[0])) rows += supportRow(safeUrl(l[0]), l[1], l[2]); });
  if (!rows) rows += '<div class="empty">Contact details are not set up yet.</div>';
  rows += '<div class="kv" style="margin:0 20px"><span>Support hours</span><b>' + esc(s.supportHours || '8am – 9pm') + '</b></div>';
  $('supportLinks').innerHTML = rows;
}
document.addEventListener('click', function(e){
  var el = e.target.closest && e.target.closest('[data-open-url]');
  if (el) { e.preventDefault(); openLink(el.getAttribute('data-open-url')); }
});
// About Us is the article the admin wrote (Admin > About), fetched when the page is opened. The server cleans it; it is still only shown as the markup it returned.
var _aboutLoaded = false;
async function loadAbout(){
  var box = $('aboutBody');
  if (_aboutLoaded) return;
  box.innerHTML = spinnerHtml();
  var r = await api('/public/about-content');
  if (r.status !== 'success') { box.innerHTML = '<div class="empty">Could not load this page. Try again.</div>'; return; }
  _aboutLoaded = true;
  box.innerHTML = r.html ? '<div class="about-html">' + r.html + '</div>' : '<div class="empty">Nothing published yet.</div>';
}

/* ====================== ANNOUNCEMENT (the welcome picture) ======================
   Shown on every app open and every time Home is entered from another tab. Admin > Banners > Welcome announcement sets the picture; its button
   joins the Telegram group (Settings > Support). No picture, no dialog. */
async function maybeShowAnnouncement(immediateShake){
  var ls = $('loadingScreen');
  if (ls && ls.style.display !== 'none') { _annAfterLoader = true; return; }
  if (!STATE) return;
  if (_artPromise) { try { await Promise.race([_artPromise, new Promise(function(r){ setTimeout(r, 2500); })]); } catch (e) {} }
  if (!STATE || !ART.announcement) return;
  if (document.querySelector('.overlay.show, .modal-bg.show')) return;
  var img = $('annImg');
  img.src = ART.announcement; img.style.display = 'block';
  $('annBadge').style.display = 'none';
  $('annTitle').textContent = brandName();
  var s = getSettings(), btns = '';
  if (safeUrl(s.telegramGroup)) btns += '<button class="tg-pill" data-open-url="' + esc(safeUrl(s.telegramGroup)) + '">' + TG_ICON_WHITE + 'Join Channel</button>';
  var tgRow = $('annTgRow');
  tgRow.innerHTML = btns;
  tgRow.style.display = btns ? 'flex' : 'none';
  $('annDivider').style.display = 'none';
  $('annBody').innerHTML = '';
  if (immediateShake) tgRow.querySelectorAll('.tg-pill').forEach(function(el){ el.style.animationDelay = '-2.4s, -2.4s'; });
  $('announcementBg').classList.add('show');
}
function dismissAnnouncement(){ $('announcementBg').classList.remove('show'); }

/* ====================== INSTALL AS AN APP ====================== */
// The browser fires this ahead of time so the real install prompt can be shown from our own button, not the address bar's small icon.
var _deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', function(e){
  e.preventDefault();
  _deferredInstallPrompt = e;
  updateDownloadTileVisibility();
});
window.addEventListener('appinstalled', function(){
  _deferredInstallPrompt = null;
  updateDownloadTileVisibility();
});
function isStandalone(){
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}
function isIos(){ return /iphone|ipad|ipod/i.test(navigator.userAgent); }
// The reward for installing (Admin > Settings > Download App claim) can be claimed once; while it is still there to claim, the tile stays even in the installed app.
function claimAvailable(){ return (Number(getSettings().appClaimAmount) || 0) > 0 && !!STATE && !STATE.appClaimed; }
// The Me-screen tile is hidden once the app is installed and nothing is left to offer.
function updateDownloadTileVisibility(){
  var tile = $('downloadAppTile');
  if (!tile) return;
  tile.style.display = (isStandalone() && !claimAvailable()) ? 'none' : 'flex';
}
function openInstallSheet(){
  var stepsEl = $('installManualSteps'), btn = $('installNowBtn');
  if (isStandalone()) { stepsEl.style.display = 'none'; btn.style.display = 'none'; }   // already installed: only the reward, if there is one, is left to offer
  else if (_deferredInstallPrompt) { stepsEl.style.display = 'none'; btn.style.display = 'block'; }
  else if (isIos()) {
    // Safari has no install call, only the Share sheet.
    stepsEl.innerHTML = 'Tap the <b>Share</b> icon in Safari’s toolbar, then choose <b>"Add to Home Screen"</b>.';
    stepsEl.style.display = 'block'; btn.style.display = 'none';
  } else {
    stepsEl.innerHTML = 'Open your browser menu and choose <b>"Add to Home Screen"</b> or <b>"Install app"</b>.';
    stepsEl.style.display = 'block'; btn.style.display = 'none';
  }
  $('installSheetBg').classList.add('show');
}
function dismissInstallSheet(){
  $('installSheetBg').classList.remove('show');
  // Remembered per member, so the offer after sign-up is made once; the Me-screen tile stays for any time they change their mind.
  if (STATE && STATE.uid) { try { localStorage.setItem('smartai_install_dismissed_' + STATE.uid, '1'); } catch (e) {} }
}
async function doInstallApp(){
  if (!_deferredInstallPrompt) { dismissInstallSheet(); return; }
  _deferredInstallPrompt.prompt();
  var choice = await _deferredInstallPrompt.userChoice.catch(function(){ return null; });
  _deferredInstallPrompt = null;
  dismissInstallSheet();
  if (choice && choice.outcome === 'accepted') toast('Installing ' + brandName() + '…');
  updateDownloadTileVisibility();
}
// Offered once, right after a sign-up: "download now or later", never forced.
function maybeOfferInstallAfterSignup(){
  if (isStandalone()) return;
  try { if (STATE && STATE.uid && localStorage.getItem('smartai_install_dismissed_' + STATE.uid)) return; } catch (e) {}
  // After the welcome picture (if there is one) has been seen, and not if the member has already signed out.
  setTimeout(function(){ if (STATE && _appEntered && !document.querySelector('.modal-bg.show')) openInstallSheet(); }, 4000);
}

/* ====================== SMALL DIALOGS ======================
   The Trade Password and the Google Authenticator code are asked in small dialogs when a member cashes out (or changes a payout setting). Each resolves
   with the typed text, or null when the member cancels. */
function closeAllSheets(){
  ['networkPickerBg', 'tradePinBg', 'totpBg', 'installSheetBg', 'announcementBg', 'changePinBg'].forEach(function(id){ var el = $(id); if (el) el.classList.remove('show'); });
  if (_pinResolve) { var r = _pinResolve; _pinResolve = null; r(null); }
  if (_totpResolve) { var r2 = _totpResolve; _totpResolve = null; r2(null); }
}
var _pinResolve = null;
function askTradePin(title, sub, err){
  return new Promise(function(resolve){
    if (_pinResolve) { var prev = _pinResolve; _pinResolve = null; prev(null); }
    _pinResolve = resolve;
    $('tradePinTitle').textContent = title || 'Trade Password';
    $('tradePinSub').textContent = sub || 'Enter your 6-digit Trade Password to continue.';
    var errEl = $('tradePinErr'); errEl.textContent = err || ''; errEl.style.display = err ? '' : 'none';
    var inp = $('tradePinInput'); inp.value = '';
    $('tradePinBg').classList.add('show');
    setTimeout(function(){ try { inp.focus(); } catch (e) {} }, 60);
  });
}
function tradePinSubmit(){
  var inp = $('tradePinInput'), v = inp.value.trim();
  if (!/^\d{6}$/.test(v)) { shakeVibrate(inp); return; }
  $('tradePinBg').classList.remove('show');
  if (_pinResolve) { var r = _pinResolve; _pinResolve = null; r(v); }
}
function tradePinCancel(){
  $('tradePinBg').classList.remove('show');
  if (_pinResolve) { var r = _pinResolve; _pinResolve = null; r(null); }
}
// The second step of a cash-out, only for a member who turned Google Authenticator on: the 6-digit code, or one backup code.
var _totpResolve = null, _totpBackup = false;
function totpMode(b){
  _totpBackup = b;
  var input = $('totpInput');
  input.value = ''; input.maxLength = b ? 11 : 6;
  input.setAttribute('inputmode', b ? 'text' : 'numeric');
  input.placeholder = b ? 'Backup code' : '6-digit code';
  $('totpAlt').textContent = b ? 'Use the 6-digit code instead' : 'Use a backup code instead';
  $('totpHelp').textContent = b ? 'Type one of the backup codes you saved. Each one works only once.' : 'Open Google Authenticator and type the code it shows now.';
  try { input.focus(); } catch (e) {}
}
function askAuthCode(){
  return new Promise(function(resolve){
    if (_totpResolve) { var prev = _totpResolve; _totpResolve = null; prev(null); }
    _totpResolve = resolve;
    totpMode(false);
    var off = clockOffSecs();
    $('totpWarn').textContent = off > 20 ? 'Your phone’s clock is about ' + off + ' seconds away from the real time, so the code will not match. Turn on automatic date and time.' : '';
    $('totpBg').classList.add('show');
    setTimeout(function(){ try { $('totpInput').focus(); } catch (e) {} }, 60);
  });
}
function totpSubmit(){
  var v = $('totpInput').value.trim().replace(/\s/g, '');
  if (!v) { shakeVibrate($('totpInput')); return; }
  $('totpBg').classList.remove('show');
  if (_totpResolve) { var r = _totpResolve; _totpResolve = null; r(v); }
}
function totpCancel(){
  $('totpBg').classList.remove('show');
  if (_totpResolve) { var r = _totpResolve; _totpResolve = null; r(null); }
}

/* ====================== PICTURES ======================
   Every banner is either a picture the admin uploaded (Admin > Banners) or a blue art banner with one of the owner's icons. */
function artHtml(url, icon){
  // The blue art is always underneath; a picture the admin uploaded covers it, and falls away by itself if it cannot be loaded.
  return artFillHtml(icon) + (url ? '<img class="art-photo" src="' + esc(url) + '" alt="" onerror="this.remove()">' : '');
}
function artFillHtml(icon){
  return '<div class="art-fill"><span class="art-ring r1"></span><span class="art-ring r2"></span><span class="art-ring r3"></span><img class="art-bot" data-icon="' + icon + '" src="' + iconUrl(icon) + '" alt=""></div>';
}
function paintArt(){
  var sett = getSettings();
  var map = [
    ['depositBanner', '', 'deposit'], ['withdrawBanner', '', 'withdraw'], ['supportBanner', '', 'support'], ['aboutBanner', ART.aboutbanner, 'about'],
    ['bindbankBanner', '', 'payout'], ['shopBannerArt', '', 'robots'], ['accountBanner', ART.mybanner, 'my'], ['rewardsBanner', ART.promobanner, 'gift'],
    ['recordsBanner', '', 'ledger'], ['teamBanner', ART.teambanner, 'share'], ['messagesBanner', '', 'inbox']
  ];
  map.forEach(function(m){ var el = $(m[0]); if (el) el.innerHTML = artHtml(m[1], m[2]); });
  var hb = $('homeBanner');
  if (hb) {
    var t = (sett.homeBannerTitle || '').trim(), x = (sett.homeBannerText || '').trim();
    hb.innerHTML = artHtml(ART.home, 'robots') + ((t || x) ? ('<div class="pb-tint pb-text">' + (t ? '<b class="pb-tint-title">' + esc(t) + '</b>' : '') + (x ? '<span>' + esc(x) + '</span>' : '') + '</div>') : '');
  }
  var av = $('acctIcon'); if (av) av.innerHTML = '<img' + (ART.profilelogo ? '' : ' data-icon="robots"') + ' src="' + esc(ART.profilelogo || iconUrl('robots')) + '" alt="">';
  paintAuthArt();
  paintIcons();
}
function paintAuthArt(){
  var b = $('authBanner'); if (b) b.innerHTML = artHtml(ART.authhero, 'robots');
  var m = $('authMark'); if (m) m.innerHTML = '<img' + (ART.authlogo ? '' : ' data-icon="robots"') + ' src="' + esc(ART.authlogo || iconUrl('robots')) + '" alt="">';
}
// 0771 234 567 from the +256771234567 the server keeps.
function displayPhone(p){
  var d = String(p || '').replace(/\D/g, '');
  if (d.indexOf('256') === 0 && d.length === 12) d = '0' + d.slice(3);
  return d.length === 10 ? d.slice(0, 4) + ' ' + d.slice(4, 7) + ' ' + d.slice(7) : (p || 'Not set');
}
function maskPhone(p){
  var d = displayPhone(p).replace(/\s/g, '');
  return d.length > 6 ? d.slice(0, 4) + '•••' + d.slice(-2) : d;
}

/* ====================== RENDER ====================== */
// A long figure steps the type down a size or two so it always stays on one line inside its box.
function fitMoney(el, text){
  if (!el) return;
  el.textContent = text;
  var n = String(text).length;
  el.style.fontSize = n <= 11 ? '' : n <= 13 ? '14px' : n <= 15 ? '12.5px' : '11px';
}
function renderAll(){
  var s = STATE;
  if (!s) return;
  var sett = getSettings();
  paintArt();
  $('acctPhone').textContent = displayPhone(s.phone);
  fitMoney($('acctBalNum'), ugx(s.balance));
  fitMoney($('acctWitNum'), ugx(s.totalWithdrawn));
  $('teamLink').textContent = promoLink() || '—';
  $('teamL1').textContent = s.team.l1; $('teamL2').textContent = s.team.l2; $('teamL3').textContent = s.team.l3;
  $('teamComm').textContent = ugx(s.team.commission);
  $('commL1Pct').textContent = sett.commL1 + '%'; $('commL2Pct').textContent = sett.commL2 + '%'; $('commL3Pct').textContent = sett.commL3 + '%';
  renderCheckin();
  renderMeRows();
  renderFeatured(); renderTicker(); renderShop(); renderRecords();
}
// The daily reward card (Rewards tab).
function renderCheckin(){
  var s = STATE, sett = getSettings(), amt = Number(sett.dailyCheckin) || 0;
  var card = $('checkinCard'); if (card) card.style.display = amt > 0 ? '' : 'none';
  $('checkinAmt').textContent = ugx(amt).replace('UGX ', '');
  var done = s.lastCheckin === serverTodayKey();
  var btn = $('checkinBtn');
  if (!btn.dataset.busy) {
    btn.innerHTML = done ? '<span style="display:inline-flex;align-items:center;gap:6px;justify-content:center"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12l4.5 4.5L19.5 6"/></svg>Claimed today</span>' : ('Check in for ' + ugx(amt));
    btn.disabled = done; btn.style.opacity = done ? '.55' : '1';
  }
  $('streakNum').textContent = s.checkinStreak;
  // The ring is a 30-day cycle: day 30 shows a full ring and day 31 starts again at day 1.
  var cyclePos = s.checkinStreak > 0 ? ((s.checkinStreak - 1) % 30) + 1 : 0;
  $('checkinRing').style.setProperty('--pct', (cyclePos / 30 * 100) + '%');
  $('streakCycleLabel').textContent = s.checkinStreak > 0 ? ('Day ' + cyclePos + ' of 30') : 'Start your streak today';
  var dots = ''; for (var i = 0; i < 30; i++) dots += '<i class="' + (i < cyclePos ? 'on' : '') + '"></i>';
  $('streakDots').innerHTML = dots;
  var gc = $('giftCodeInput'); if (gc) gc.placeholder = getSettings().giftCodeHint || 'Enter gift code';
}
// The Me page: rows that depend on settings (Google Authenticator) and the unread count on Messages.
function renderMeRows(){
  var on = authFeatureOn();
  var row = $('gaRow'); if (row) row.style.display = on ? '' : 'none';
  var n = unreadCount();
  document.querySelectorAll('.msg-badge').forEach(function(b){ b.textContent = n > 99 ? '99+' : n; b.style.display = n > 0 ? 'flex' : 'none'; });
  var claim = $('appClaimBtn');
  if (claim) { var amt = Number(getSettings().appClaimAmount) || 0; claim.style.display = claimAvailable() ? 'block' : 'none'; claim.textContent = 'Claim ' + ugx(amt); }
  updateDownloadTileVisibility();
}

/* ====================== TASK CENTER (team reward tiers) ======================
   Each tier is claimed ONCE, for good. The server recomputes the team's purchases and the reward on every load and every claim: what is drawn here
   is only what it just answered. */
var TK_ICON_DEP = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6.5" width="18" height="12" rx="2.5"/><path d="M3 10h18"/><circle cx="7.2" cy="14.5" r="1" fill="currentColor" stroke="none"/></svg>';
function renderTierCard(t, total){
  var current = Math.min(total, t.target);
  var pct = t.target > 0 ? Math.min(100, Math.floor(current / t.target * 100)) : 0;
  var pillClass = t.claimed ? 'is-done' : (t.reached ? 'is-ready' : '');
  var pillLabel = t.claimed ? 'Claimed' : (t.reached ? 'Claim' : 'In Progress');
  var clickable = !t.claimed && t.reached;
  return '<div class="tk-card">' +
      '<div class="tk-head"><div class="tk-ic tk-ic-dep">' + TK_ICON_DEP + '</div><div class="tk-type">Team Purchases</div></div>' +
      '<div class="tk-desc">Your team’s purchases reach <b>' + ugx(t.target) + '</b> to get: <em>' + ugx(t.reward) + '</em></div>' +
      '<div class="tk-bar"><div class="tk-bar-fill' + (t.claimed ? ' is-done' : '') + '" style="width:' + pct + '%"></div></div>' +
      '<div class="tk-stats"><div><b>' + ugx(current) + '</b><span>Current</span></div><div><b>' + ugx(t.target) + '</b><span>Target</span></div><div><b>' + pct + '%</b><span>Progress</span></div></div>' +
      '<button type="button" class="tk-pill ' + pillClass + '"' + (clickable ? ' data-tier="' + esc(t.id) + '" onclick="claimTier(this)"' : ' disabled') + '>' + pillLabel + '</button>' +
    '</div>';
}
async function loadTaskCenter(){
  var box = $('taskCenterList');
  if (!box) return;
  box.innerHTML = spinnerHtml();
  var r = await api('/salary/status');
  if (r.stale) return;
  if (r.status !== 'success' || !Array.isArray(r.tiers)) { box.innerHTML = '<div class="empty">' + esc((r && r.message) || 'Could not load the Task Center. Try again.') + '</div>'; return; }
  STATE.salary = r;
  box.innerHTML = r.tiers.length ? r.tiers.map(function(t){ return renderTierCard(t, Number(r.total) || 0); }).join('') : '<div class="empty">No rewards are set up yet.</div>';
}
async function claimTier(btn){
  var id = btn && btn.getAttribute('data-tier');
  if (!id || btn.disabled) return;
  var label = btn.textContent;
  btn.disabled = true; btn.innerHTML = btnBusyHtml('Please wait…');
  var r = await api('/salary/claim', { tierId: id });
  if (r.stale) return;
  if (r.status !== 'success') {
    toast(r.message || 'Could not claim this reward');
    btn.disabled = false; btn.textContent = label;
    await loadTaskCenter();
    return;
  }
  toast(r.message || 'Reward added to your wallet');
  await refreshFromServer();
  renderAll();
  await loadTaskCenter();
}

/* ====================== AI ROBOTS (the products) ====================== */
function isProductSoldOut(p){ return p.active === false || !!p.comingSoon || p.isOpen === false; }
function productImg(p){ return p && p.image ? p.image : iconUrl('robots'); }
function imgTag(p, cls, style){
  return '<img' + (cls ? ' class="' + cls + '"' : '') + (style ? ' style="' + style + '"' : '') + ' src="' + esc(productImg(p)) + '" alt="" onerror="this.onerror=null;this.src=\'/icons/robots.webp\'">';
}
function ownedCount(key){
  return (STATE && STATE.investments || []).filter(function(i){ return i.key === key; }).length;
}
function limitReached(p){
  var lim = Number(p.buyLimit) || 0;
  return lim > 0 && ownedCount(p.key) >= lim;
}
function closedLabel(p){
  if (p.comingSoon || p.openMode === 'soon') return 'Coming soon';
  if (p.isOpen === false && p.opensAt) {
    var d = new Date(Number(p.opensAt)), p2 = function(n){ return String(n).padStart(2, '0'); };
    var today = new Date(); var same = d.toDateString() === today.toDateString();
    return 'Opens ' + (same ? '' : p2(d.getDate()) + '/' + p2(d.getMonth() + 1) + ' ') + p2(d.getHours()) + ':' + p2(d.getMinutes());
  }
  return 'Not available';
}
function renderFeatured(){
  // Sold-out and coming-soon robots are never featured: no point steering anyone toward something they cannot buy yet.
  var html = PRODUCTS.filter(function(p){ return !isProductSoldOut(p); }).slice(0, 6).map(function(p){
    return '<button class="choc-card" onclick="goToShopProduct(\'' + esc(p.key) + '\')">' + imgTag(p, 'choc-img') +
      '<div class="choc-body"><div class="choc-name">' + esc(p.name) + '</div>' +
      '<div class="choc-price">' + ugx(p.price) + '</div>' +
      '<div class="choc-ret">+' + ugx(dailyReturn(p)) + '/day</div></div></button>';
  }).join('');
  $('featStrip').innerHTML = html || '<div class="empty" style="width:100%">No AI robots yet. Check back soon.</div>';
}
// renderShop() runs on every poll and rebuilds the Buy buttons, which would restart their glow sweep: a negative delay equal to how far into the cycle
// "now" is makes a freshly built button carry on exactly where the old one was.
var SWEEP_EPOCH = Date.now(), SWEEP_CYCLE = 2;   // the cycle must match .btn-buy-glow::after's animation duration
function syncSweepPhase(root){
  var delay = -(((Date.now() - SWEEP_EPOCH) / 1000) % SWEEP_CYCLE);
  (root || document).querySelectorAll('.btn-buy-glow').forEach(function(el){ el.style.setProperty('--sweep-delay', delay + 's'); });
}
function renderShop(){
  var firstOpen = -1;
  PRODUCTS.forEach(function(p, i){ if (firstOpen < 0 && !isProductSoldOut(p)) firstOpen = i; });
  var html = PRODUCTS.map(function(p, i){
    var soldOut = isProductSoldOut(p), capped = !soldOut && limitReached(p);
    var lim = Number(p.buyLimit) || 0;
    var rank = Number(p.vip) > 0 ? 'VIP ' + p.vip : 'Robot ' + (i + 1);
    var btn = soldOut
      ? '<button class="btn btn-primary btn-block" disabled style="opacity:.5;cursor:not-allowed;margin-top:14px">' + esc(closedLabel(p)) + '</button>'
      : capped
        ? '<button class="btn btn-primary btn-block" disabled style="opacity:.5;cursor:not-allowed;margin-top:14px">Limit reached (' + ownedCount(p.key) + '/' + lim + ')</button>'
        : '<button class="btn btn-primary btn-block btn-buy-glow" style="margin-top:14px" onclick="buyProduct(this,\'' + esc(p.key) + '\')">Buy</button>';
    return '<div class="prod-card' + (soldOut ? ' is-soldout' : '') + '" id="prodCard-' + esc(p.key) + '">' +
      '<div class="prod-img-wrap">' + imgTag(p, 'prod-img') +
      '<span class="prod-rank">' + esc(rank) + '</span>' +
      (i === firstOpen ? '<span class="prod-ribbon">Popular</span>' : '') + '</div>' +
      '<div class="prod-body-full">' +
        '<div class="prod-name">' + esc(p.name) + '</div>' +
        '<div class="prod-stats-line">' +
          '<div class="prod-stat-cell"><div class="prod-stat-cell-lbl">Price</div><div class="prod-stat-cell-val">' + ugx(p.price) + '</div></div>' +
          '<div class="prod-stat-cell"><div class="prod-stat-cell-lbl">Daily reward</div><div class="prod-stat-cell-val is-mint">' + ugx(dailyReturn(p)) + '</div></div>' +
          '<div class="prod-stat-cell"><div class="prod-stat-cell-lbl">Cycle</div><div class="prod-stat-cell-val">' + productCycle(p) + ' days</div></div>' +
          '<div class="prod-stat-cell"><div class="prod-stat-cell-lbl">Total payout</div><div class="prod-stat-cell-val">' + ugx(productExpectedReturn(p)) + '</div></div>' +
        '</div>' + btn +
      '</div></div>';
  }).join('');
  $('shopGrid').innerHTML = html || '<div class="empty">No AI robots yet. Check back soon.</div>';
  syncSweepPhase($('shopGrid'));
}
function investmentStats(){
  // Settlement is done by the server (a payment at 00:00 every day); this only reshapes what refreshFromServer() stored.
  return (STATE.investments || []).map(function(inv){ return { inv: inv, daysElapsed: inv.daysElapsed, cycleDays: inv.cycleDays, accrued: inv.accrued, matured: inv.matured }; });
}
function productByKey(key){ return PRODUCTS.filter(function(p){ return p.key === key; })[0]; }
function renderMyRobots(){
  var rows = investmentStats();
  if (!rows.length) { $('mychocList').innerHTML = '<div class="empty">No AI robots running yet. Buy one from AI Robots to start earning.</div>'; return; }
  $('mychocList').innerHTML = rows.map(function(r){
    var purchased = r.inv.purchasedAt ? new Date(r.inv.purchasedAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Unknown';
    return '<div class="choc-hold-card">' +
      '<div class="choc-hold-top">' + imgTag(productByKey(r.inv.key), '', 'width:48px;height:48px;border-radius:12px;object-fit:cover;flex:0 0 auto') +
        '<div class="bank-info"><b>' + esc(r.inv.name) + '</b><span>' + ugx(r.inv.price) + '</span></div>' +
        '<span style="font-size:10.5px;font-weight:800;color:' + (r.matured ? 'var(--mint)' : 'var(--cocoa-faint)') + '">' + (r.matured ? 'Matured' : 'Ongoing') + '</span>' +
      '</div>' +
      '<div class="choc-hold-daylbl">' + r.daysElapsed + ' / ' + r.cycleDays + ' days</div>' +
      '<div class="choc-hold-grid">' +
        '<div class="choc-hold-item"><span>Purchase date &amp; time</span><b>' + esc(purchased) + '</b></div>' +
        '<div class="choc-hold-item"><span>Daily income</span><b>' + ugx(r.inv.dailyIncome) + '</b></div>' +
        '<div class="choc-hold-item"><span>Accrued income</span><b style="color:var(--mint)">' + ugx(r.accrued) + '</b></div>' +
        '<div class="choc-hold-item"><span>Total income</span><b>' + ugx(r.inv.totalIncome) + '</b></div>' +
      '</div>' +
    '</div>';
  }).join('');
}
function renderEarnings(){
  var rows = investmentStats();
  var total = rows.reduce(function(s, r){ return s + r.accrued; }, 0);
  $('earningsTotal').textContent = ugx(total);
  if (!rows.length) { $('earningsList').innerHTML = '<div class="empty">No AI robots running yet. Buy one from AI Robots to start earning.</div>'; return; }
  $('earningsList').innerHTML = rows.map(function(r){
    return '<div class="bank-row">' + imgTag(productByKey(r.inv.key), '', 'width:48px;height:48px;border-radius:12px;object-fit:cover;flex:0 0 auto') +
      '<div class="bank-info"><b>' + esc(r.inv.name) + '</b><span>Day ' + r.daysElapsed + ' of ' + r.cycleDays + '</span></div>' +
      '<b style="color:var(--mint);font-size:14px">' + ugx(r.accrued) + '</b></div>';
  }).join('');
}

/* ====================== ACTIVITY TICKER AND LIVE REFRESH ====================== */
// A simulated live feed (not the member's own transactions, and not supposed to be): the same rows for everybody, made by the server and refreshed
// now and then. The track is drawn twice back to back and animated from -50% to 0% so it loops without a seam.
var _activityFeed = [], _activityFeedTimer = null;
// Every renderTicker() builds a new track, which would restart the CSS animation; a negative delay equal to how far into the cycle "now" is lets it resume.
var TICKER_EPOCH = Date.now(), TICKER_CYCLE = 36;   // must match .ticker-track's animation duration
async function refreshActivityFeed(){
  var r = await api('/public/activity-feed');
  if (r.status === 'success') { _activityFeed = r.feed || []; renderTicker(); }
}
function startActivityFeed(){
  refreshActivityFeed();
  clearInterval(_activityFeedTimer);
  _activityFeedTimer = setInterval(refreshActivityFeed, 27000);
}
function stopActivityFeed(){ clearInterval(_activityFeedTimer); _activityFeedTimer = null; }
function renderTicker(){
  var box = $('tickerBox');
  if (!_activityFeed.length) { box.innerHTML = ''; return; }
  var rows = _activityFeed.map(function(f){
    var isDep = f.kind === 'deposit';
    return '<div class="ticker-row"><span class="dot" style="background:' + (isDep ? 'var(--mint)' : 'var(--berry)') + '"></span>' +
      '<span style="flex:1">' + esc(f.phone) + ' ' + (isDep ? 'added funds' : 'cashed out') + '</span>' +
      '<b style="color:' + (isDep ? 'var(--mint)' : 'var(--berry)') + '">' + (isDep ? '+' : '-') + ugx(f.amount).replace('UGX ', '') + '</b></div>';
  }).join('');
  var delay = -(((Date.now() - TICKER_EPOCH) / 1000) % TICKER_CYCLE);
  box.innerHTML = '<div class="ticker-track" style="animation-delay:' + delay.toFixed(2) + 's">' + rows + rows + '</div>';
}
// Balance, history and the daily payouts change on the server without the member doing anything, so the app asks again while it is open.
// Self-scheduling (setTimeout, not setInterval), so a slow answer can never pile a second request on top of itself, and paused while the app is in
// the background; coming back to the front refreshes at once. The settings and products are re-read about once a minute.
var _accountPollTimer = null, _accountPollRunning = false, ACCOUNT_POLL_MS = 8000, _settingsPollCounter = 0, SETTINGS_POLL_EVERY = 8;
function scheduleAccountPoll(){
  clearTimeout(_accountPollTimer);
  if (!STATE || document.hidden) return;
  _accountPollTimer = setTimeout(runAccountPoll, ACCOUNT_POLL_MS);
}
async function runAccountPoll(){
  if (!STATE || document.hidden || _accountPollRunning) { scheduleAccountPoll(); return; }
  _accountPollRunning = true;
  try {
    await refreshFromServer();
    _settingsPollCounter++;
    if (_settingsPollCounter % SETTINGS_POLL_EVERY === 0) { await syncPublicConfig(); renderStaticPages(); }
    if (STATE) {
      renderAll();
      var recOv = $('ovRecords');
      if (recOv && recOv.classList.contains('show') && _recordsTab !== 'accrued') loadRecordsTab(_recordsTab).then(renderRecords);
      var openOv = document.querySelector('.overlay.show');
      if (openOv && openOv.id === 'ovMychoc') renderMyRobots();
      if (openOv && openOv.id === 'ovEarnings') renderEarnings();
      if (openOv && openOv.id === 'ovMessages') refreshMessages(true);
    }
  } catch (e) {}
  _accountPollRunning = false;
  scheduleAccountPoll();
}
function startAccountPoll(){ scheduleAccountPoll(); }
function stopAccountPoll(){ clearTimeout(_accountPollTimer); _accountPollTimer = null; }
document.addEventListener('visibilitychange', function(){
  if (!document.hidden && STATE) runAccountPoll();   // catch up the moment the app is brought back to the front
});

/* ====================== LEDGER — Accrued (income) / Topups (deposits) / Cash Outs (withdrawals) ====================== */
var _recordsTab = 'accrued';
var _recordsLoaded = { accrued: true, topups: false, cashouts: false };
// The kinds of ledger row that are money coming IN as earnings (the Accrued tab). A top-up is in Topups and a cash-out is in Cash Outs.
var INCOME_TYPES = ['cashback', 'checkin', 'commission', 'mission_salary', 'promocode', 'order_gift', 'app_claim', 'welcome_bonus', 'admin_credit'];
var REC_TYPE_LABEL = { cashback: 'AI robot income', checkin: 'Daily reward', commission: 'Referral commission', mission_salary: 'Task Center reward', promocode: 'Gift code',
  order_gift: 'Order gift', app_claim: 'App reward', welcome_bonus: 'Welcome gift', admin_credit: 'Account credit' };
function recStatusInfo(s){
  s = String(s || 'success').toLowerCase();
  if (['success', 'matched', 'processed'].indexOf(s) !== -1) return { label: 'Completed', cls: 'ok' };
  if (s === 'awaiting_verification') return { label: 'Pending Review', cls: 'proc' };
  if (['initiating', 'pending', 'processing', 'creating', 'sending'].indexOf(s) !== -1) return { label: 'Settling', cls: 'proc' };
  if (['failed', 'declined', 'cancelled', 'rejected', 'expired'].indexOf(s) !== -1) return { label: 'Declined', cls: 'bad' };
  return { label: s.charAt(0).toUpperCase() + s.slice(1), cls: 'mut' };
}
function setRecordsTab(t){
  _recordsTab = t;
  document.querySelectorAll('.uline-tab[data-rt]').forEach(function(b){ b.classList.toggle('active', b.dataset.rt === t); });
  renderRecords();
  loadRecordsTab(t).then(renderRecords);
}
// Top-ups and cash-outs are asked for fresh every time (a deposit that was still pending a minute ago may be done now); _recordsLoaded only
// decides whether the "loading" placeholder is shown the first time.
async function loadRecordsTab(t){
  if (t === 'topups') {
    var r = await api('/deposits');
    if (r.status === 'success' && STATE) { STATE.depositRecords = r.deposits || []; _recordsLoaded.topups = true; }
  } else if (t === 'cashouts') {
    var r2 = await api('/withdrawals');
    if (r2.status === 'success' && STATE) { STATE.withdrawalRecords = r2.withdrawals || []; _recordsLoaded.cashouts = true; }
  }
}
function renderRecords(){
  var s = STATE;
  if (!s) return;
  if (_recordsTab === 'accrued') {
    var rows = s.transactions.filter(function(t){ return INCOME_TYPES.indexOf(t.type) !== -1 && t.amount > 0; });
    var total = rows.reduce(function(sum, t){ return sum + t.amount; }, 0);
    $('recordsStats').innerHTML = '<div class="stat"><div class="n" style="color:var(--mint)">' + ugx(total) + '</div><div class="l">Total accrued</div></div>';
    if (!rows.length) { $('recordsList').innerHTML = '<div class="empty">No accrued rewards yet. Check in or buy an AI robot to start earning.</div>'; return; }
    $('recordsList').innerHTML = rows.slice(0, 80).map(function(t){
      var label = REC_TYPE_LABEL[t.type] || t.desc || 'Reward';
      // The server's own wording is more specific than the category (which level, which robot): shown on its own line when it adds something.
      var detail = (t.desc && t.desc !== label) ? '<div class="rec-line"><span>Details</span><b>' + esc(t.desc) + '</b></div>' : '';
      return '<div class="rec-card"><div class="rec-head"><span class="rec-ref">' + esc(label) + '</span><span class="rec-st ok">Completed</span></div>' + detail +
        '<div class="rec-line"><span>Amount</span><b>+' + ugx(t.amount) + '</b></div>' +
        '<div class="rec-line"><span>Date</span><b>' + esc(fmtStamp(t.when)) + '</b></div></div>';
    }).join('');
    return;
  }
  var isTop = _recordsTab === 'topups';
  var list = isTop ? (s.depositRecords || []) : (s.withdrawalRecords || []);
  if (!_recordsLoaded[_recordsTab]) { $('recordsList').innerHTML = spinnerHtml(); $('recordsStats').innerHTML = ''; return; }
  var sum = list.reduce(function(acc, r){ return acc + (isTop ? (r.status === 'matched' ? Number(r.amount) || 0 : 0) : (r.status === 'processed' ? Number(r.net || r.amount) || 0 : 0)); }, 0);
  $('recordsStats').innerHTML = '<div class="stat"><div class="n" style="color:' + (isTop ? 'var(--mint)' : 'var(--berry)') + '">' + ugx(sum) + '</div><div class="l">Total ' + (isTop ? 'topped up' : 'cashed out') + '</div></div>';
  if (!list.length) { $('recordsList').innerHTML = '<div class="empty">' + (isTop ? 'No top-ups yet.' : 'No cash-outs yet.') + '</div>'; return; }
  $('recordsList').innerHTML = list.slice(0, 80).map(function(r){
    var st = recStatusInfo(r.status);
    var stamp = r.createdAt ? fmtStamp(tsMs(r.createdAt)) : ((r.date || '') + ' ' + (r.time || '')).trim();
    var desc = isTop ? 'Mobile-money top-up' : ('Cash out' + (r.holder ? ' to ' + r.holder : '') + (r.network ? ' (' + r.network + ')' : ''));
    // The reason a request was declined (set by the admin, or by the server when the payment provider refused it).
    var reasonRow = (st.cls === 'bad' && r.failureReason) ? '<div class="rec-line"><span>Reason</span><b>' + esc(r.failureReason) + '</b></div>' : '';
    return '<div class="rec-card"><div class="rec-head"><span class="rec-ref">' + esc(r.ref || 'pending') + '</span><span class="rec-st ' + st.cls + '">' + st.label + '</span></div>' +
      '<div class="rec-line"><span>Description</span><b>' + esc(desc) + '</b></div>' +
      '<div class="rec-line"><span>Amount</span><b>' + ugx(r.amount) + '</b></div>' +
      (!isTop && r.net != null ? '<div class="rec-line"><span>Received</span><b>' + ugx(r.net) + '</b></div>' : '') +
      '<div class="rec-line"><span>Number</span><b>' + esc(r.phone ? displayPhone(r.phone) : '') + '</b></div>' +
      reasonRow +
      '<div class="rec-line"><span>Date</span><b>' + esc(stamp) + '</b></div></div>';
  }).join('');
}

/* ====================== TABS / OVERLAYS ====================== */
// Home starts as the active tab in the markup, so _lastTab is seeded to 'home': that is what makes a Home -> Home tap NOT show the announcement again.
var _lastTab = 'home';
function switchTab(name){
  var enteringHomeFromElsewhere = (name === 'home' && _lastTab !== 'home');
  ['home', 'shop', 'rewards', 'team', 'account'].forEach(function(t){
    var el = $('view' + t.charAt(0).toUpperCase() + t.slice(1));
    if (t === name) {
      el.style.display = 'block';
      // A reflow before re-adding the class makes the appearing animation play every time, including on a tab that already had it.
      el.classList.remove('view-appear'); void el.offsetWidth; el.classList.add('view-appear');
    } else {
      el.style.display = 'none';
      el.classList.remove('view-appear');
    }
  });
  document.querySelectorAll('.tab').forEach(function(b){ b.classList.toggle('active', b.dataset.tab === name); });
  var tapped = document.querySelector('.tab[data-tab="' + name + '"]');
  if (tapped) { tapped.classList.remove('tab-tapped'); void tapped.offsetWidth; tapped.classList.add('tab-tapped'); }
  hideOverlays(); _ovOpen = false;
  window.scrollTo(0, 0);
  if (STATE && (name === 'rewards' || name === 'team' || name === 'home')) renderAll();
  if (name === 'team' && STATE) refreshTeamStats();
  // Coming back to Home from another tab shows the announcement again (its buttons shaking straight away).
  if (enteringHomeFromElsewhere) maybeShowAnnouncement(true);
  _lastTab = name;
}
// The Featured strip on Home: go to AI Robots and scroll straight to that robot's own card.
function goToShopProduct(key){
  switchTab('shop');
  setTimeout(function(){ var el = $('prodCard-' + key); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 50);
}
// One full-screen page at a time. The phone's Back button closes it (one history entry, replaced when one page opens another) instead of leaving the app.
var _ovOpen = false, _ovName = '';
function hideOverlays(){ document.querySelectorAll('.overlay').forEach(function(o){ o.classList.remove('show'); }); }
function openOverlay(name){
  var el = $('ov' + name.charAt(0).toUpperCase() + name.slice(1));
  if (!el) return;
  hideOverlays();
  el.scrollTop = 0;
  el.classList.add('show');
  try { if (_ovOpen) history.replaceState({ ov: name }, ''); else history.pushState({ ov: name }, ''); } catch (e) {}
  _ovOpen = true; _ovName = name;
  if (name === 'bindbank') renderBankList();
  if (name === 'withdraw') prepareWithdraw();
  if (name === 'records') setRecordsTab(_recordsTab === 'accrued' || _recordsTab === 'topups' || _recordsTab === 'cashouts' ? _recordsTab : 'accrued');
  if (name === 'mychoc') renderMyRobots();
  if (name === 'earnings') renderEarnings();
  if (name === 'taskcenter') loadTaskCenter();
  if (name === 'about') loadAbout();
  if (name === 'messages') loadMessages();
  if (name === 'authenticator') gaOpen();
  if (name === 'gifts') loadGifts();
  if (name === 'deposit') prepareDeposit();
  if (name === 'security') renderMeRows();
}
function closeOverlay(){
  if (!_ovOpen) { hideOverlays(); return; }
  _ovOpen = false;
  hideOverlays();
  try { if (history.state && history.state.ov) history.back(); } catch (e) {}
}
window.addEventListener('popstate', function(){
  if (document.querySelector('.modal-bg.show:not(#giftRevealBg)')) closeAllSheets();
  if (_ovOpen) { _ovOpen = false; hideOverlays(); }
});

/* ====================== MESSAGES (the inbox) ====================== */
function unreadCount(){ return (STATE && STATE.messages ? STATE.messages : []).filter(function(m){ return !m.read; }).length; }
async function refreshMessageBadge(){
  var r = await api('/messages');
  if (r.status === 'success' && STATE) { STATE.messages = r.messages || []; renderMeRows(); }
}
async function refreshMessages(quiet){
  var r = await api('/messages');
  if (r.status !== 'success' || !STATE) { if (!quiet) $('messagesList').innerHTML = '<div class="empty">Could not load your messages. Try again.</div>'; return; }
  STATE.messages = r.messages || [];
  paintMessages();
}
function paintMessages(){
  var list = STATE.messages || [];
  if (!list.length) { $('messagesList').innerHTML = '<div class="empty">No messages</div>'; renderMeRows(); return; }
  $('messagesList').innerHTML = list.map(function(m){
    var stamp = ((m.date || '') + ' ' + (m.time || '')).trim();
    return '<div class="msg-card' + (m.read ? '' : ' unread') + '">' +
      '<div class="msg-top"><b>' + esc(m.title || 'Message') + '</b>' + (m.read ? '' : '<i class="msg-dot"></i>') + '</div>' +
      (stamp ? '<div class="msg-date">' + esc(stamp) + '</div>' : '') +
      (m.hasImage ? '<img class="msg-img" src="' + SERVER + '/public/message-image/' + encodeURIComponent(m.id) + '" alt="" onerror="this.remove()">' : '') +
      '<div class="msg-body">' + esc(m.body || '').replace(/\n/g, '<br>') + '</div></div>';
  }).join('');
  renderMeRows();
}
// Opening the inbox reads every message in it (the page shows each one in full).
async function loadMessages(){
  if (STATE.messages) paintMessages(); else $('messagesList').innerHTML = spinnerHtml();
  await refreshMessages(false);
  if (!STATE) return;
  var ids = (STATE.messages || []).filter(function(m){ return !m.read; }).map(function(m){ return m.id; });
  if (ids.length) {
    // Shown as read here at once; the server is told behind it.
    api('/messages/read', { messageIds: ids.slice(0, 100) }).then(function(r){
      if (r.status === 'success' && STATE) { (STATE.messages || []).forEach(function(m){ if (ids.indexOf(m.id) !== -1) m.read = true; }); renderMeRows(); }
    });
  }
}

/* ====================== ORDER GIFTS ====================== */
// A robot can carry a one-time gift (Admin > Products > Order gift). A member who BOUGHT it may receive the gift once.
async function loadGifts(){
  var box = $('giftsList');
  box.innerHTML = spinnerHtml();
  var r = await api('/gifts/list');
  if (r.stale) return;
  if (r.status !== 'success') { box.innerHTML = '<div class="empty">' + esc(r.message || 'Could not load the order gifts. Try again.') + '</div>'; return; }
  var gifts = r.gifts || [];
  if (!gifts.length) { box.innerHTML = '<div class="empty">No order gifts at the moment.</div>'; return; }
  box.innerHTML = gifts.map(function(g){
    var state = g.claimed ? 'Received' : (g.owned ? 'Receive' : 'Buy to unlock');
    var can = g.owned && !g.claimed;
    return '<div class="bank-row">' + imgTag(productByKey(g.key), '', 'width:48px;height:48px;border-radius:12px;object-fit:cover;flex:0 0 auto') +
      '<div class="bank-info"><b>' + esc(g.name) + '</b><span>Gift ' + ugx(g.amount) + '</span></div>' +
      '<button type="button" class="tk-pill ' + (g.claimed ? 'is-done' : (can ? 'is-ready' : '')) + '" style="width:auto;padding:0 14px;margin:0"' +
        (can ? ' data-gift="' + esc(g.key) + '" onclick="claimGift(this)"' : ' disabled') + '>' + state + '</button></div>';
  }).join('');
}
async function claimGift(btn){
  var key = btn && btn.getAttribute('data-gift');
  if (!key || btn.disabled) return;
  var label = btn.textContent;
  btn.disabled = true; btn.innerHTML = btnBusyHtml('Please wait…');
  var r = await api('/gifts/claim', { key: key });
  if (r.stale) return;
  if (r.status !== 'success') { toast(r.message || 'Could not receive this gift'); btn.disabled = false; btn.textContent = label; loadGifts(); return; }
  showGiftReveal(r.amount);
  await refreshFromServer();
  renderAll();
  loadGifts();
}

/* ====================== PAYOUT ACCOUNT (the mobile-money cards cash-outs are sent to) ====================== */
// A member may keep several cards. The server holds which one is active (the one a cash-out goes to); a tap on a card makes it the active one.
function selectedBank(){
  var l = (STATE && STATE.bankAccounts) || [];
  return l.filter(function(b){ return b.isDefault; })[0] || l[0] || null;
}
function bankBadge(b){
  var nc = NETWORK_COLORS[b.network] || { color: '#D6E3F8', textColor: '#0B2A5B' };
  var initials = String(b.network || '').split(' ').map(function(w){ return w.charAt(0); }).join('').slice(0, 2);
  return '<div class="bank-net-badge" style="background:' + nc.color + ';color:' + nc.textColor + '">' + esc(initials) + '</div>';
}
function renderBankList(){
  var list = (STATE && STATE.bankAccounts) || [];
  var sel = selectedBank();
  if (!list.length) { $('bankList').innerHTML = '<div class="empty">No accounts bound yet. Add one below.</div>'; return; }
  $('bankList').innerHTML = list.map(function(b){
    var active = sel && sel.id === b.id;
    return '<div class="bank-row" data-bank="' + esc(b.id) + '" onclick="pickBankAccount(this.dataset.bank)" style="cursor:pointer">' + bankBadge(b) +
      '<div class="bank-info"><b>' + esc(b.holder) + '</b><span>' + esc(b.network) + ' · ' + esc(maskPhone(b.phone)) + '</span></div>' +
      (active ? '<span class="bank-default">Active</span>' : '') + '</div>';
  }).join('');
}
function openNetworkPicker(){
  $('npStep1').style.display = 'block';
  $('npStep2').style.display = 'none';
  $('npTitle').textContent = 'Choose network';
  $('networkPickerBg').classList.add('show');
}
function closeNetworkPicker(){ $('networkPickerBg').classList.remove('show'); }
var _pickedNetwork = null;
function pickNetwork(name){
  _pickedNetwork = { network: name };
  $('npStep1').style.display = 'none';
  $('npStep2').style.display = 'block';
  $('npTitle').textContent = name;
  $('npName').value = ''; $('npPhone').value = '';
}
async function saveBankAccount(){
  var holder = $('npName').value.trim();
  var local = localDigits($('npPhone').value);
  if (!holder || !$('npPhone').value.trim()) { toast('Enter the account holder name and phone'); return; }
  if (!local) { toast('Enter a valid Uganda mobile number (07XXXXXXXX)'); return; }
  var btn = $('npSaveBtn'), label = btn.textContent;
  if (btn.disabled) return;
  btn.disabled = true; btn.innerHTML = btnBusyHtml('Please wait…');
  try {
    var r = await api('/bank/save', { holder: holder, network: _pickedNetwork.network, phone: '+256' + local });
    if (r.stale) return;
    if (r.status !== 'success') { toast(r.message || 'Could not save the account'); return; }
    var bankR = await api('/bank/list');
    if (bankR.status === 'success' && STATE) STATE.bankAccounts = bankR.accounts || [];
    saveState();
    closeNetworkPicker(); renderBankList(); renderWitBankBox();
    toast('Account bound');
  } finally { btn.disabled = false; btn.textContent = label; }
}
// Payout Account is opened from two places: on its own from the Me tab, and from mid-cash-out ("Change" / "Bind one now"). This remembers which, so a
// tap only returns to Cash Out when that is where the member came from.
var _bindbankReturnToWithdraw = false;
async function pickBankAccount(id){
  var cur = selectedBank();
  if (!cur || cur.id !== id) {
    var r = await api('/bank/select', { id: id });
    if (r.stale) return;
    if (r.status !== 'success') { toast(r.message || 'Could not change the account'); return; }
    var bankR = await api('/bank/list');
    if (bankR.status === 'success' && STATE) { STATE.bankAccounts = bankR.accounts || []; saveState(); }
  }
  if (_bindbankReturnToWithdraw) { _bindbankReturnToWithdraw = false; openOverlay('withdraw'); }
  else renderBankList();
}
function goBindBank(fromWithdraw){ _bindbankReturnToWithdraw = !!fromWithdraw; openOverlay('bindbank'); }

/* ====================== BUY ====================== */
async function buyProduct(btn, key){
  var p = productByKey(key);
  if (!p) return;
  if (isProductSoldOut(p)) { toast('This AI robot is not available right now'); return; }
  if (limitReached(p)) { toast('You already own the most you can of this AI robot'); return; }
  if (STATE.balance < p.price) { toast('Not enough balance, add funds first'); return; }
  if (btn) { if (btn.disabled) return; btn.disabled = true; }
  toast('Processing…');
  try {
    // The price, payout and length the card showed are sent with the order: if the admin changed any of them meanwhile, nothing is charged.
    var r = await api('/invest/create', { tierKey: key, expectedPrice: Number(p.price) || 0, expectedReturn: Number(p.expectedReturn) || undefined, cycle: Number(p.cycle) || undefined });
    if (r.stale) return;
    if (r.status !== 'success') {
      toast(r.message || 'Purchase failed');
      if (r.code === 'PRICE_CHANGED' || r.code === 'PURCHASE_LIMIT') { await syncPublicConfig(); await refreshFromServer(); renderAll(); }
      return;
    }
    await refreshFromServer();
    renderAll(); toast('Purchased ' + p.name + '!');
  } finally {
    if (btn) btn.disabled = false;
  }
}

/* ====================== DEPOSIT ====================== */
var _depNetwork = null, _depSlot = null;
// Which pay button is used is NOT fixed: the server hands them out in turn (one counter for every member and visit), so over time every method is used
// equally. The answer is asked for ahead of time and kept for the NEXT deposit, so opening the page never waits for it.
function refreshDepositSlot(){
  api('/deposit/start').then(function(r){ if (r && r.status === 'success' && typeof r.start === 'number') _depSlot = r.start; }).catch(function(){});
}
function selectDepNetwork(name){
  _depNetwork = name;
  document.querySelectorAll('#depNetworkRow .net-card').forEach(function(b){ b.classList.toggle('active', b.dataset.net === name); });
}
// Quick amounts: the minimum, then the prices of the robots (the usual first deposits), kept to six.
function renderQuickAmounts(){
  var min = Number(getSettings().minDeposit) || 0;
  var amounts = [min].concat(PRODUCTS.map(function(p){ return Number(p.price) || 0; }).filter(function(n){ return n >= min && n > 0; }));
  var seen = {}, out = [];
  amounts.sort(function(a, b){ return a - b; }).forEach(function(n){ if (n > 0 && !seen[n]) { seen[n] = 1; out.push(n); } });
  if (out.length < 3) [2, 5, 10].forEach(function(m){ if (min * m > 0 && !seen[min * m]) { seen[min * m] = 1; out.push(min * m); } });
  $('quickAmts').innerHTML = out.slice(0, 6).map(function(n){ return '<button type="button" class="quick-amt-chip" data-amt="' + n + '" onclick="$(\'depAmt\').value=this.dataset.amt">' + ugx(n) + '</button>'; }).join('');
}
function prepareDeposit(){
  // The number paying is one the member types himself every time: a deposit can come from a different number than the one the account was made with.
  $('depPhone').value = '';
  _depNetwork = null;
  document.querySelectorAll('#depNetworkRow .net-card').forEach(function(b){ b.classList.remove('active'); });
  var min = getSettings().minDeposit;
  $('depMin').textContent = ugx(min);
  renderQuickAmounts();
  refreshDepositSlot();
}
// Money amount boxes cannot be left to type() alone: a number input has no real upper bound, and a 20-digit figure would overflow every sum below.
function capAmountInput(el){ if (el.value.length > 10) el.value = el.value.slice(0, 10); }
async function doDeposit(){
  var amt = parseInt($('depAmt').value, 10);
  var sett = getSettings();
  if (!amt || amt < sett.minDeposit) { toast('Minimum amount is ' + ugx(sett.minDeposit)); return; }
  if (!_depNetwork) { toast('Choose MTN or Airtel'); return; }
  var local = localDigits($('depPhone').value);
  if (!$('depPhone').value.trim()) { toast('Enter the mobile-money number to pay from'); return; }
  if (!local) { toast('Enter a valid Uganda mobile number (07XXXXXXXX)'); return; }
  var btn = $('depGoBtn'), label = btn.textContent;
  if (btn.disabled) return;
  btn.disabled = true; btn.innerHTML = btnBusyHtml('Please wait…');
  var body = { amount: amt, phone: '+256' + local, network: _depNetwork };
  if (typeof _depSlot === 'number') body.slot = _depSlot;
  var r = await api('/deposit/marzpay', body);
  btn.disabled = false; btn.textContent = label;
  if (r.stale) return;
  if (r.status !== 'success') { toast(r.message || 'Could not start the payment'); return; }
  $('depAmt').value = '';
  refreshDepositSlot();   // the next deposit uses the next method in turn
  openDepositStatus(r.depositId, r.reference, '0' + local);
}

/* ====================== DEPOSIT STATUS (checks the payment by itself) ====================== */
var _depPollTimer = null, _depPollAttempt = 0, _depPollMax = 120, _depPollId = null, _depConfirmed = false, _depPollChecking = false;
var _depIcPending = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="2" width="10" height="20" rx="2.4"/><path d="M11 18h2"/></svg>';
var _depIcSuccess = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>';
function stopDepositPoll(){ clearInterval(_depPollTimer); _depPollTimer = null; _depPollId = null; }
function openDepositStatus(depositId, reference, phone){
  _depPollId = depositId; _depPollAttempt = 0; _depConfirmed = false;
  $('depStatusIc').innerHTML = _depIcPending;
  $('depStatusTitle').textContent = 'Payment Initiated Successfully!';
  $('depStatusPhone').textContent = 'You will receive a payment prompt on ' + phone + ' shortly.';
  $('depStatusSteps').style.display = '';
  $('depStatusRef').textContent = reference;
  setDepStatusMsg('pending', 'Payment initiated. Check your phone.');
  $('depStatusAttempt').textContent = '';
  $('depCancelRow').style.display = '';
  $('depVerifyBtn').onclick = manualVerifyDeposit;
  setVerifySpinning(false);
  openOverlay('depositStatus');
  clearInterval(_depPollTimer);
  _depPollTimer = setInterval(pollDepositStatus, 3000);
  pollDepositStatus();
}
function showDepositSuccess(){
  _depConfirmed = true;
  $('depStatusIc').innerHTML = _depIcSuccess;
  $('depStatusTitle').textContent = 'Payment Successful!';
  $('depStatusPhone').textContent = 'Your wallet has been credited.';
  $('depStatusSteps').style.display = 'none';
  $('depStatusAttempt').textContent = '';
  $('depCancelRow').style.display = 'none';
  $('depVerifyLabel').textContent = 'Continue to Dashboard';
  var btn = $('depVerifyBtn');
  btn.disabled = false;
  btn.onclick = function(){ closeOverlay(); switchTab('home'); renderAll(); };
}
function setDepStatusMsg(kind, text){
  var el = $('depStatusMsg');
  el.textContent = text;
  el.style.background = kind === 'matched' ? 'var(--mint-pale)' : kind === 'failed' ? 'var(--berry-pale)' : 'var(--caramel-pale)';
  el.style.color = kind === 'matched' ? 'var(--mint)' : kind === 'failed' ? 'var(--berry)' : 'var(--caramel-deep)';
}
function setVerifySpinning(on){
  var spin = $('depVerifySpin'), label = $('depVerifyLabel');
  if (spin) spin.style.display = on ? 'inline-flex' : 'none';
  if (label && !_depConfirmed) label.textContent = on ? 'Verifying…' : 'Verify Payment';
}
// _depPollChecking stops the automatic check and a tap on Verify Payment from running at the same instant. (Crediting is idempotent on the server either
// way; this only avoids two answers landing back to back and flickering the message.)
async function pollDepositStatus(manual){
  if (!_depPollId || _depPollChecking) return;
  _depPollChecking = true;
  var btn = $('depVerifyBtn');
  if (btn) btn.disabled = true;
  setVerifySpinning(true);
  try {
    _depPollAttempt++;
    var attEl = $('depStatusAttempt');
    if (attEl) attEl.textContent = 'Auto-verifying… (attempt ' + _depPollAttempt + '/' + _depPollMax + ')';
    // waitMs lets the server hold the answer while its own watcher is on this payment, so a payment is announced the moment it settles.
    var r = await api('/deposit/marzpay/status', manual === true ? { depositId: _depPollId } : { depositId: _depPollId, waitMs: 8000 });
    if (r.stale || !STATE) return;
    if (r.status === 'success') {
      if (r.state === 'matched') {
        clearInterval(_depPollTimer); _depPollTimer = null;
        setDepStatusMsg('matched', 'Payment confirmed. Funds added to your wallet.');
        showDepositSuccess();
        if (manual === true) toast('Successful. Funds added to your wallet');
        await refreshFromServer(); renderAll();
        return;
      }
      if (r.state === 'failed') {
        clearInterval(_depPollTimer); _depPollTimer = null;
        setDepStatusMsg('failed', r.message || 'Payment was not completed.');
        if (manual === true) toast('Declined: ' + (r.message || 'payment was not completed'));
        return;
      }
      if (manual === true) toast('Still pending, check your phone for the prompt');
    } else if (manual === true) {
      toast(r.message || 'Could not check the payment status right now');
    }
    if (_depPollAttempt >= _depPollMax) {
      clearInterval(_depPollTimer); _depPollTimer = null;
      setDepStatusMsg('failed', "We couldn't confirm this payment automatically. Tap Verify Payment or contact support.");
    }
  } finally {
    _depPollChecking = false;
    var b2 = $('depVerifyBtn'); if (b2) b2.disabled = false;
    setVerifySpinning(false);
  }
}
function manualVerifyDeposit(){ pollDepositStatus(true); }
function cancelDepositStatus(){ stopDepositPoll(); closeOverlay(); if (STATE) renderAll(); }
function copyDepositRef(){ copyText($('depStatusRef').textContent, 'Reference copied'); }
// The clipboard may be missing (an old browser, an insecure address): say so instead of claiming it worked.
function copyText(text, okMsg){
  if (!text) return;
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function(){ toast(okMsg || 'Copied'); }).catch(function(){ toast('Could not copy'); });
  else toast('Could not copy');
}

/* ====================== CASH OUT ====================== */
// Shakes the given elements and, where the phone allows it, vibrates: feedback for a cash-out refused on the phone itself (below the minimum, or more than the balance).
function shakeVibrate(){
  for (var i = 0; i < arguments.length; i++) {
    var el = arguments[i];
    if (!el) continue;
    el.classList.remove('shake-x');
    void el.offsetWidth;
    el.classList.add('shake-x');
  }
  if (navigator.vibrate) navigator.vibrate([60, 40, 60]);
}
function authFeatureOn(){ return getSettings().requireTwofaToWithdraw !== false; }
function needsAuthSetup(){ return authFeatureOn() && !!STATE && STATE.twofaEnabled !== true; }
// The hours cash-out is open (Admin > Settings), as the server judges them: a window may wrap past midnight (18:00 to 17:00).
function witMinutes(v){ var m = /^(\d{1,2}):(\d{2})$/.exec(String(v || '').trim()); return m ? Number(m[1]) * 60 + Number(m[2]) : null; }
function withdrawWindow(s){
  var from = witMinutes(s && s.withdrawOpenFrom), to = witMinutes(s && s.withdrawOpenTo);
  if (!(s && s.withdrawWindowEnabled) || from == null || to == null || from === to) return { enabled: false, open: true, from: '', to: '' };
  var d = new Date(Date.now() + _skewMs + 3 * 3600000);   // Uganda's clock (UTC+3), by the server's time
  var now = d.getUTCHours() * 60 + d.getUTCMinutes();
  var open = from < to ? (now >= from && now < to) : (now >= from || now < to);
  return { enabled: true, open: open, from: s.withdrawOpenFrom, to: s.withdrawOpenTo };
}
function renderWitBankBox(){
  var sett = getSettings();
  var maxEl = $('witMaxPerDay'); if (maxEl) maxEl.textContent = sett.maxWithdrawalsPerDay || 2;
  $('witMinAmt').textContent = ugx(sett.minWithdraw);
  $('witFeePctInfo').textContent = sett.withdrawFeePct + '%';
  $('witFeePctLabel').textContent = sett.withdrawFeePct + '%';
  var win = withdrawWindow(sett);
  var wn = $('witWindowNote');
  if (wn) { wn.style.display = win.enabled ? '' : 'none'; wn.textContent = win.enabled ? ('Cash-outs are open from ' + win.from + ' to ' + win.to + '.') : ''; }
  var gn = $('witGaNote');
  if (gn) gn.style.display = needsAuthSetup() ? '' : 'none';
  var box = $('witBankBox');
  var b = selectedBank();
  if (!b) {
    box.innerHTML = '<div class="info-box" style="background:var(--berry-pale);color:var(--berry)">No bank account bound yet.' +
      ' <b style="text-decoration:underline;cursor:pointer" onclick="goBindBank(true)">Bind one now</b></div>';
    return;
  }
  box.innerHTML = '<div class="bank-row" style="margin:16px 20px 0">' + bankBadge(b) +
    '<div class="bank-info"><b>Cash out to ' + esc(b.holder) + '</b><span>' + esc(b.network) + ' · ' + esc(maskPhone(b.phone)) + '</span></div>' +
    '<b style="font-size:12px;color:var(--caramel-deep);cursor:pointer" onclick="goBindBank(true)">Change</b></div>';
}
function prepareWithdraw(){
  renderWitBankBox();
  $('witAmt').value = '';
  renderWitCalc();
}
function parseMoney(v){ var s = String(v || '').replace(/[,\s]/g, ''); return /^\d+$/.test(s) ? parseInt(s, 10) : NaN; }
function renderWitCalc(){
  var sett = getSettings();
  var amt = parseMoney($('witAmt').value) || 0;
  var fee = Math.round(amt * sett.withdrawFeePct / 100);
  $('witFee').textContent = ugx(fee);
  $('witNet').textContent = ugx(amt - fee);
}
// Tapping Cash Out without Google Authenticator set up: say why, then take the member to the set-up page (the amount typed is kept for the way back).
var _gaReturn = null;
function gaRequiredNotice(){
  _gaReturn = { amount: $('witAmt') ? $('witAmt').value : '' };
  toast('Google Authenticator is required to cash out. Set it up first.');
  setTimeout(function(){ if (_ovName === 'withdraw') openOverlay('authenticator'); }, 900);
}
var _withdrawBusy = false;
async function doWithdraw(){
  if (_withdrawBusy) return;
  var sett = getSettings();
  var amt = parseMoney($('witAmt').value);
  if (!amt) { toast('Enter a valid amount'); shakeVibrate($('witAmt')); return; }
  // The minimum is checked first, as the server does, so the suggestions below can never be amounts under it. The server checks every rule again.
  if (amt < sett.minWithdraw) { toast('Minimum cash-out is ' + ugx(sett.minWithdraw)); shakeVibrate($('witAmt'), $('witGoBtn')); return; }
  var mult = Math.max(0, Math.floor(Number(sett.withdrawMultiple) || 0));
  if (mult > 0 && amt % mult !== 0) {
    var low = Math.floor(amt / mult) * mult, high = low + mult;
    toast('Cash-out must be a multiple of ' + ugx(mult) + '. Try ' + ugx(low || high) + ' or ' + ugx(high) + '.'); shakeVibrate($('witAmt')); return;
  }
  if (amt > STATE.balance) { toast('Insufficient balance'); shakeVibrate($('witAmt'), $('witGoBtn')); return; }
  var card = selectedBank();
  if (!card) { toast('Bind a mobile-money account first'); goBindBank(true); return; }
  var win = withdrawWindow(sett);
  if (win.enabled && !win.open && !STATE.withdrawAnytime) { toast('Cash-out is open from ' + win.from + ' to ' + win.to + '. Please come back then.'); return; }
  // COMPULSORY Google Authenticator: no set-up yet = the member is told and taken to the set-up page before any password is asked (the server refuses as well).
  if (needsAuthSetup()) { gaRequiredNotice(); return; }
  var pin = await askTradePin('Trade Password', 'Enter your 6-digit Trade Password to cash out ' + ugx(amt) + '.');
  if (pin === null) return;
  var code = '';
  // The code is asked right after the Trade Password, for a member who turned Google Authenticator on. The SERVER enforces it either way.
  if (authFeatureOn() && STATE.twofaEnabled) {
    code = await askAuthCode();
    if (code === null) return;
  }
  var btn = $('witGoBtn'), label = btn.textContent;
  _withdrawBusy = true;
  btn.disabled = true; btn.innerHTML = btnBusyHtml('Please wait…');
  var r;
  try {
    r = await api('/withdraw/request', Object.assign({ amount: amt, network: card.network, phone: card.phone, pin: pin }, code ? { totp: code } : {}));
  } finally {
    _withdrawBusy = false;
    btn.disabled = false; btn.textContent = label;
  }
  if (r.stale || !STATE) return;
  if (r.status !== 'success') {
    // What the server says about the rule wins over this app's copy of it: any Google Authenticator refusal means it is ON.
    if (/^TWOFA_/.test(r.code || '')) {
      var st = getSettings(); st.requireTwofaToWithdraw = true;
      try { localStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify(st)); } catch (e) {}
    }
    if (r.code === 'TWOFA_REQUIRED') STATE.twofaEnabled = true;
    if (r.code === 'TWOFA_SETUP_REQUIRED') { STATE.twofaEnabled = false; gaRequiredNotice(); return; }
    toast(r.message || 'Could not process the cash-out');
    return;
  }
  $('witAmt').value = ''; renderWitCalc();
  // The server took the money at once; show it gone now and let the refresh below confirm.
  STATE.balance = Math.max(0, STATE.balance - amt);
  closeOverlay(); renderAll();
  toast('Withdrawal submitted successfully' + (r.usedBackupCode ? '. You have ' + (Number(r.backupLeft) || 0) + ' backup code' + (Number(r.backupLeft) === 1 ? '' : 's') + ' left.' : ''));
  refreshFromServer().then(function(){ if (STATE) renderAll(); });
}

/* ====================== TRADE PASSWORD ====================== */
function openChangeTradePin(){
  $('cpOldPin').value = ''; $('cpNewPin').value = '';
  $('changePinErr').style.display = 'none';
  $('changePinBg').classList.add('show');
}
function closeChangeTradePin(){ $('changePinBg').classList.remove('show'); }
async function doChangeTradePin(){
  var oldPin = $('cpOldPin').value.trim(), newPin = $('cpNewPin').value.trim();
  var errEl = $('changePinErr');
  if (!/^\d{6}$/.test(oldPin) || !/^\d{6}$/.test(newPin)) { errEl.textContent = 'Both Trade Passwords must be exactly 6 digits.'; errEl.style.display = ''; return; }
  var btn = $('cpSubmitBtn'), label = btn.textContent;
  btn.disabled = true; btn.innerHTML = btnBusyHtml('Please wait…');
  var r = await api('/account/transaction-pin/change', { oldPin: oldPin, newPin: newPin });
  btn.disabled = false; btn.textContent = label;
  if (r.stale) return;
  if (r.status !== 'success') { errEl.textContent = r.message || 'Could not change the Trade Password'; errEl.style.display = ''; return; }
  closeChangeTradePin();
  toast('Trade Password updated');
}

/* ====================== GOOGLE AUTHENTICATOR ======================
   The SERVER decides whether a code is needed (it reads the account); this page only turns it on and off. The secret is made by the server and shown
   once as a link, a setup key and a picture drawn on this phone (the vendored qrcode-generator): it is never sent to any outside service. */
var _ga = { view: 'loading', setup: null, codes: null, status: null, action: '' };
var GA_PLAY = 'https://play.google.com/store/apps/details?id=com.google.android.apps.authenticator2';
var GA_STORE = 'https://apps.apple.com/app/google-authenticator/id388497605';
function gaWarn(){
  var off = clockOffSecs();
  return off > 20 ? '<p class="ga-warn">Your phone’s clock is about ' + off + ' seconds away from the real time, so authenticator codes will not match. Turn on automatic date and time in your phone settings.</p>' : '';
}
function gaMsg(msg){ var el = $('gaErr'); if (el) { el.textContent = msg || ''; el.style.display = msg ? '' : 'none'; } }
function gaBox(id, placeholder, kind){
  var any = kind === 'any';
  return '<input class="famt ga-input" id="' + id + '" type="' + (kind === 'pin' ? 'password' : 'text') + '" ' +
    (any ? 'maxlength="11" inputmode="text" autocapitalize="characters"' : 'maxlength="6" inputmode="numeric"') + ' placeholder="' + esc(placeholder) +
    '" autocomplete="one-time-code" autocorrect="off" spellcheck="false" data-lpignore="true" oninput="gaMsg(\'\')">';
}
// The setup picture: one SVG path of the dark squares with a 4-square white border, so a camera can read it.
function qrSvg(text){
  if (typeof qrcode !== 'function') return '';
  var q = qrcode(0, 'L'); q.addData(String(text)); q.make();
  var n = q.getModuleCount(), quiet = 4, size = n + quiet * 2, d = '';
  for (var r = 0; r < n; r++) { var c = 0; while (c < n) { if (q.isDark(r, c)) { var e = c; while (e < n && q.isDark(r, e)) e++; d += 'M' + (c + quiet) + ' ' + (r + quiet) + 'h' + (e - c) + 'v1h-' + (e - c) + 'z'; c = e; } else c++; } }
  return '<svg viewBox="0 0 ' + size + ' ' + size + '" role="img" aria-label="Setup picture for Google Authenticator" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg"><rect width="' + size + '" height="' + size + '" fill="#fff"/><path d="' + d + '" fill="#000"/></svg>';
}
function gaOffHtml(){
  return '<section class="ga-card ga-hero"><b class="ga-h">Google Authenticator is required</b><p>After your Trade Password, every cash-out also asks for a 6-digit code from Google Authenticator. Setting it up takes about two minutes.</p></section>' +
    '<section class="ga-card"><div class="ga-step"><i>1</i><div><b>Download Google Authenticator</b><span>A free app from Google. Install it on your phone first.</span></div></div>' +
      '<div class="ga-stores"><a href="' + GA_PLAY + '" target="_blank" rel="noopener">Google Play</a><a href="' + GA_STORE + '" target="_blank" rel="noopener">App Store</a></div></section>' +
    '<section class="ga-card"><div class="ga-step"><i>2</i><div><b>Enter your Trade Password</b><span>This confirms that it is really you.</span></div></div>' +
      '<div class="ga-form">' + gaBox('gaPin', 'Enter trade password', 'pin') + '<p class="ga-err" id="gaErr" style="display:none"></p>' +
      '<button type="button" class="btn btn-primary btn-block" id="gaStartBtn" onclick="gaStart()">Continue</button></div></section>' + gaWarn();
}
function gaSetupHtml(){
  var s = _ga.setup || {}, groups = String(s.secret || '').match(/.{1,4}/g) || [], key = groups.slice(0, 4).join(' ') + '<br>' + groups.slice(4).join(' ');
  return '<section class="ga-card"><div class="ga-step"><i>1</i><div><b>Add this account to Google Authenticator</b><span>Choose the way that suits you.</span></div></div>' +
      '<a class="btn btn-primary btn-block" href="' + esc(s.otpauth) + '">Open Google Authenticator</a>' +
      '<p class="ga-note">If nothing opens, install the app first (Google Play or App Store), then use the setup key below.</p>' +
      '<p class="ga-or"><span>or type the setup key</span></p>' +
      '<div class="ga-key" id="gaKey">' + key + '</div>' +
      '<button type="button" class="btn btn-ghost btn-block" data-copy="' + esc(s.secret) + '" onclick="copyText(this.dataset.copy,\'Key copied\')">Copy key</button>' +
      '<p class="ga-note">In the app tap <b>+</b>, then <b>Enter a setup key</b>. Account: ' + esc(s.issuer) + '. Type of key: <b>Time based</b>.</p>' +
      '<p class="ga-or"><span>or scan the picture</span></p><div class="ga-qr" id="gaQr"></div>' +
      '<p class="ga-note">Scan it with Google Authenticator on another phone or tablet.</p></section>' +
    '<section class="ga-card"><div class="ga-step"><i>2</i><div><b>Type the 6-digit code</b><span>Google Authenticator now shows a 6-digit code for ' + esc(s.issuer) + '. Type it here to finish.</span></div></div>' +
      '<div class="ga-form">' + gaBox('gaCode', 'Enter 6-digit code') + '<p class="ga-err" id="gaErr" style="display:none"></p>' +
      '<button type="button" class="btn btn-primary btn-block" id="gaConfirmBtn" onclick="gaConfirm()">Turn On</button>' +
      '<button type="button" class="btn btn-ghost btn-block" style="margin-top:10px" onclick="gaCancel()">Cancel</button></div></section>' + gaWarn();
}
function gaCodesHtml(){
  var codes = _ga.codes || [];
  return '<section class="ga-card ga-hero"><b class="ga-h">Google Authenticator is on</b><p>Save your backup codes now.</p></section>' +
    '<section class="ga-card"><b class="ga-h">Your backup codes</b>' +
      '<p class="ga-note left">If you lose your phone, one of these codes lets you cash out once. Each code works one time only. They are shown only now, so write them down or copy them and keep them somewhere safe.</p>' +
      '<div class="ga-codes">' + codes.map(function(c){ return '<span>' + esc(c) + '</span>'; }).join('') + '</div>' +
      '<button type="button" class="btn btn-ghost btn-block" data-copy="' + esc(codes.join('  ')) + '" onclick="copyText(this.dataset.copy,\'Codes copied\')">Copy all codes</button>' +
      '<button type="button" class="btn btn-primary btn-block" style="margin-top:10px" onclick="gaCodesDone()">I have saved them</button></section>';
}
function gaOnHtml(){
  var st = _ga.status || {}, left = Number(st.backupLeft) || 0;
  return '<section class="ga-card ga-hero"><b class="ga-h">Google Authenticator is on</b>' + (st.enabledAt ? '<p>Turned on ' + esc(fmtStamp(Number(st.enabledAt))) + '</p>' : '') + '</section>' +
    '<section class="ga-card"><p class="ga-line">Every cash-out needs your Trade Password and a 6-digit code from Google Authenticator.</p>' +
      '<p class="ga-line"><b>Backup codes left:</b> ' + left + ' of 8</p>' + (left <= 2 ? '<p class="ga-warn">You are running low on backup codes. Make new ones.</p>' : '') +
      '<button type="button" class="btn btn-ghost btn-block" onclick="gaManage(\'codes\')">New backup codes</button>' +
      '<button type="button" class="btn btn-primary btn-block" style="margin-top:10px" onclick="gaManage(\'off\')">Turn Off</button></section>' + gaWarn();
}
function gaManageHtml(){
  var off = _ga.action === 'off';
  return '<section class="ga-card"><b class="ga-h">' + (off ? 'Turn off Google Authenticator' : 'Make new backup codes') + '</b>' +
    '<p class="ga-note left">' + (off ? 'You will not be able to cash out until you set Google Authenticator up again.' : 'Your old backup codes stop working as soon as the new ones are made.') + '</p>' +
    '<div class="ga-form"><span class="flabel">Trade Password</span>' + gaBox('gaPin', 'Enter trade password', 'pin') +
    '<span class="flabel" style="margin-top:12px">Authenticator code</span>' + gaBox('gaCode', '6-digit code or a backup code', 'any') + '<p class="ga-err" id="gaErr" style="display:none"></p>' +
    '<button type="button" class="btn btn-primary btn-block" id="gaDoBtn" onclick="gaDoManage()">' + (off ? 'Turn Off' : 'Make New Codes') + '</button>' +
    '<button type="button" class="btn btn-ghost btn-block" style="margin-top:10px" onclick="gaBack()">Cancel</button></div></section>' + gaWarn();
}
function gaPaint(){
  var host = $('gaBody'); if (!host) return;
  var v = _ga.view;
  host.innerHTML = v === 'loading' ? spinnerHtml()
    : v === 'error' ? '<div class="empty" onclick="gaLoad()" style="cursor:pointer">Could not load. Tap to try again.</div>'
    : v === 'disabled' ? '<section class="ga-card ga-hero"><b class="ga-h">Google Authenticator is switched off</b><p>It is not needed right now. Cash-outs ask only for your Trade Password.</p></section>'
    : v === 'off' ? gaOffHtml() : v === 'setup' ? gaSetupHtml() : v === 'codes' ? gaCodesHtml() : v === 'manage' ? gaManageHtml() : gaOnHtml();
  if (v === 'setup') { var q = $('gaQr'); if (q) q.innerHTML = qrSvg((_ga.setup || {}).otpauth); }
  var ov = $('ovAuthenticator'); if (ov) ov.scrollTop = 0;
}
async function gaLoad(){
  _ga.view = 'loading'; gaPaint();
  var r = await api('/account/2fa/status');
  if (r.stale || !$('gaBody')) return;
  if (r.status !== 'success') { _ga.view = 'error'; return gaPaint(); }
  _ga.status = r; if (STATE) STATE.twofaEnabled = r.enabled === true;
  if (r.available === false) { var st = getSettings(); st.requireTwofaToWithdraw = false; try { localStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify(st)); } catch (e) {} renderMeRows(); _ga.view = 'disabled'; return gaPaint(); }
  if (r.enabled && _gaReturn) return gaReturnToWithdraw();   // it was already on (the app held an old copy of the account): nothing to set up
  _ga.view = r.enabled ? 'on' : 'off'; gaPaint();
}
function gaOpen(){ _ga = { view: 'loading', setup: null, codes: null, status: null, action: '' }; gaLoad(); }
async function gaStart(){
  var pin = ($('gaPin').value || '').trim();
  if (!/^\d{6}$/.test(pin)) return gaMsg('Enter your 6-digit Trade Password.');
  var btn = $('gaStartBtn'); btn.disabled = true;
  var r = await api('/account/2fa/start', { pin: pin });
  if (r.stale) return;
  if ($('gaStartBtn')) $('gaStartBtn').disabled = false;
  if (r.status !== 'success') {
    if (r.code === 'TWOFA_ALREADY_ON') return gaLoad();
    return gaMsg(r.message || 'Could not start. Please try again.');
  }
  _ga.setup = r; _ga.view = 'setup'; gaPaint();
}
async function gaConfirm(){
  var code = ($('gaCode').value || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(code)) return gaMsg('Enter the 6-digit code from Google Authenticator.');
  var btn = $('gaConfirmBtn'); btn.disabled = true;
  var r = await api('/account/2fa/confirm', { code: code });
  if (r.stale) return;
  if ($('gaConfirmBtn')) $('gaConfirmBtn').disabled = false;
  if (r.status !== 'success') {
    if (r.code === 'TWOFA_NO_SETUP') { _ga.setup = null; _ga.view = 'off'; gaPaint(); return toast(r.message); }
    return gaMsg((r.message || 'Could not turn it on.') + (r.code === 'TWOFA_INVALID' && clockOffSecs() > 20 ? ' Your phone’s clock is about ' + clockOffSecs() + ' seconds off.' : ''));
  }
  if (STATE) STATE.twofaEnabled = true;
  _ga.setup = null; _ga.codes = r.backupCodes || []; _ga.view = 'codes'; gaPaint();
}
function gaCodesDone(){ _ga.codes = null; if (_gaReturn) return gaReturnToWithdraw(); gaLoad(); }
// Set up from the Cash Out button: back to Cash Out with the amount that was typed, and the member can go on (Trade Password, then the code).
function gaReturnToWithdraw(){
  var amount = (_gaReturn && _gaReturn.amount) || '';
  _gaReturn = null;
  openOverlay('withdraw');
  if (amount) { $('witAmt').value = amount; renderWitCalc(); }
  toast('Google Authenticator setup done. You can cash out now.');
}
function gaCancel(){ _ga.setup = null; _ga.view = 'off'; gaPaint(); }
function gaManage(action){ _ga.action = action; _ga.view = 'manage'; gaPaint(); }
function gaBack(){ _ga.view = 'on'; gaPaint(); }
async function gaDoManage(){
  var off = _ga.action === 'off';
  var pin = ($('gaPin').value || '').trim(), code = ($('gaCode').value || '').trim();
  if (!/^\d{6}$/.test(pin)) return gaMsg('Enter your 6-digit Trade Password.');
  if (!code) return gaMsg('Enter the 6-digit code from Google Authenticator, or a backup code.');
  var btn = $('gaDoBtn'); btn.disabled = true;
  var r = await api(off ? '/account/2fa/disable' : '/account/2fa/backup-codes', { pin: pin, code: code });
  if (r.stale) return;
  if ($('gaDoBtn')) $('gaDoBtn').disabled = false;
  if (r.status !== 'success') return gaMsg(r.message || 'Could not finish. Please try again.');
  if (off) { if (STATE) STATE.twofaEnabled = false; _ga.view = 'off'; gaPaint(); return toast('Google Authenticator is off'); }
  _ga.codes = r.backupCodes || []; _ga.view = 'codes'; gaPaint();
}

/* ====================== DAILY REWARD, GIFT CODE ====================== */
async function doCheckin(){
  var btn = $('checkinBtn');
  if (btn) { if (btn.disabled || btn.dataset.busy) return; btn.disabled = true; btn.dataset.busy = '1'; btn.innerHTML = btnBusyHtml('Please wait…'); }
  try {
    var r = await api('/checkin', {});
    if (r.stale) return;
    if (r.status !== 'success') { toast(r.message || 'Check-in failed'); return; }
    await refreshFromServer();
    toast('Checked in successfully ✓');
  } catch (e) {
  } finally {
    if (btn) { delete btn.dataset.busy; btn.disabled = false; }
    if (STATE) renderAll();
  }
}
async function redeemGiftCode(){
  var raw = $('giftCodeInput').value.trim().toUpperCase();
  if (!raw) { toast('Enter a code'); return; }
  var btn = $('redeemBtn'), label = btn ? btn.textContent : '';
  if (btn) { if (btn.disabled) return; btn.disabled = true; btn.innerHTML = btnBusyHtml('Please wait…'); }
  try {
    var r = await api('/redeem', { code: raw });
    if (r.stale) return;
    if (r.status !== 'success') { toast(r.message || "That code isn't valid"); return; }
    $('giftCodeInput').value = '';
    await refreshFromServer();
    renderAll(); showGiftReveal(r.reward != null ? r.reward : r.amount);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = label; }
  }
}
// A treasure-chest reveal on a successful redeem: the chest pops in and keeps shaking while light bursts upward and coin sparks fly out (pure CSS,
// replayed each time by a reflow), with a real vibration, while the figure counts up from 0 to the real amount over about 0.9 s.
var _giftCountRaf = null;
function showGiftReveal(amount){
  amount = Number(amount) || 0;
  var bg = $('giftRevealBg'), amountEl = $('giftRevealAmount');
  var chest = bg.querySelector('.gift-reveal-chest'), glow = bg.querySelector('.gift-reveal-glow'), sparks = bg.querySelectorAll('.gift-spark');
  amountEl.textContent = ugx(0);
  bg.classList.add('show');
  // A reflow so showing it again replays the animations from the first frame.
  [chest, glow].concat(Array.prototype.slice.call(sparks)).forEach(function(el){ el.style.animation = 'none'; void el.offsetWidth; el.style.animation = ''; });
  if (navigator.vibrate) navigator.vibrate([40, 30, 40, 30, 90]);
  if (_giftCountRaf) cancelAnimationFrame(_giftCountRaf);
  var start = null, duration = 900;
  function step(ts){
    if (!start) start = ts;
    var p = Math.min(1, (ts - start) / duration), eased = 1 - Math.pow(1 - p, 3);
    amountEl.textContent = ugx(Math.round(amount * eased * 100) / 100);
    if (p < 1) _giftCountRaf = requestAnimationFrame(step); else amountEl.textContent = ugx(amount);
  }
  _giftCountRaf = requestAnimationFrame(step);
}
function closeGiftReveal(){
  $('giftRevealBg').classList.remove('show');
  if (_giftCountRaf) { cancelAnimationFrame(_giftCountRaf); _giftCountRaf = null; }
}
// "Download App": a one-time reward for installing (Admin > Settings > App claim amount; 0 = off).
async function claimAppReward(){
  var btn = $('appClaimBtn'); if (!btn || btn.disabled) return;
  var label = btn.textContent;
  btn.disabled = true; btn.innerHTML = btnBusyHtml('Please wait…');
  var r = await api('/app/claim', {});
  btn.disabled = false; btn.textContent = label;
  if (r.stale) return;
  if (r.status !== 'success') { toast(r.message || 'Could not claim right now'); if (r.code === 'ALREADY_CLAIMED' && STATE) { STATE.appClaimed = true; renderMeRows(); } return; }
  if (STATE) STATE.appClaimed = true;
  showGiftReveal(r.amount);
  await refreshFromServer();
  renderAll();
}

/* ====================== TEAM, SHARE ====================== */
// Invite links carry a code that only means something on this app: .../#/inviteRegister?invitecode=CODE. With a wildcard domain set up on the
// server every link is made on a NEW random 4-character address of it, so no one address carries all the sharing; every such address serves
// the very same app. Without that, or on any other address (the IP preview), the link keeps the address the app is open on, which always works.
var SHARE_LABEL_RESERVED = ['mail', 'smtp', 'imap', 'pop3', 'ftp1', 'cpan', 'whm1', 'host', 'test', 'demo'];
function shareRand(n){
  try { var a = new Uint32Array(1); window.crypto.getRandomValues(a); return a[0] % n; } catch (e) { return Math.floor(Math.random() * n); }
}
function shareLabel(){
  var letters = 'abcdefghijklmnopqrstuvwxyz', all = letters + '0123456789';
  var out = letters[shareRand(letters.length)];
  for (var i = 1; i < 4; i++) out += all[shareRand(all.length)];
  return SHARE_LABEL_RESERVED.indexOf(out) >= 0 ? shareLabel() : out;
}
function shareOrigin(){
  var d = String(getSettings().shareDomain || '').toLowerCase();
  var h = location.hostname.toLowerCase();
  if (!d || location.protocol !== 'https:' || !(h === d || h.endsWith('.' + d))) return location.origin;
  return 'https://' + shareLabel() + '.' + d;
}
var _promoLink = '', _promoCode = '';
function promoLink(){
  var code = (STATE && STATE.referralCode) || '';
  if (!code) return '';
  // The same link is kept while the code is the same (a repaint must not change what is on screen); Copy and Share make a fresh one.
  if (code !== _promoCode || !_promoLink) { _promoCode = code; _promoLink = shareOrigin() + '/#/inviteRegister?invitecode=' + encodeURIComponent(String(code).toUpperCase()); }
  return _promoLink;
}
function freshPromoLink(){
  _promoLink = '';
  var l = promoLink();
  var el = $('teamLink'); if (el) el.textContent = l || '—';
  return l;
}
function copyCode(){
  var link = freshPromoLink();
  if (!link) { toast('Your invite link is not ready yet.'); return; }
  copyText(link, 'Referral link copied');
}
function shareLink(){
  var link = freshPromoLink();
  if (!link) { toast('Your invite link is not ready yet.'); return; }
  // The words with the link are the admin's (Settings > Share message); {app} stands for the app's name.
  var words = String(getSettings().shareMessage || 'Join me on {app}').replace(/\{app\}/gi, brandName());
  if (navigator.share) { navigator.share({ title: brandName(), text: words, url: link }).catch(function(){}); return; }
  copyText(link, 'Referral link copied');
}
async function refreshTeamStats(){
  var r = await api('/team/stats');
  if (r.status !== 'success' || !STATE) return;
  STATE.teamStats = r;
  if (r.referralCode && !STATE.referralCode) { STATE.referralCode = r.referralCode; }
  if (r.team) STATE.team = Object.assign({}, STATE.team, r.team, { commission: r.teamCommission != null ? r.teamCommission : STATE.team.commission });
  renderAll();
}
// Tapping Level 1 / 2 / 3 opens that level's members, walked fresh on the server (never just the number already on screen).
async function openTeamLevel(level){
  openOverlay('teamlevel');
  $('teamLevelTitle').textContent = 'Level ' + level + ' members';
  $('teamLevelList').innerHTML = spinnerHtml();
  var r = await api('/team/members?level=' + level);
  if (r.stale) return;
  if (r.status !== 'success') { $('teamLevelList').innerHTML = '<div class="empty">Could not load this list. Try again.</div>'; return; }
  var list = r.members || [];
  if (!list.length) { $('teamLevelList').innerHTML = '<div class="empty">No Level ' + level + ' members yet.</div>'; return; }
  // Every row is a real figure off the server (what that member has invested), never a vague phrase: a member who has not invested shows UGX 0.
  var rows = list.map(function(m){
    var display = m.phoneMasked || m.phone || 'Not set';
    var joined = tsMs(m.createdAt) ? new Date(tsMs(m.createdAt)).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Unknown';
    var invested = Number(m.invested) || 0;
    return '<div class="flat-row"><div class="flat-avatar' + (invested > 0 ? ' on' : '') + '">' + esc(String(display).replace(/\D/g, '').slice(-2) || '··') + '</div>' +
      '<div class="flat-main"><b>' + esc(display) + '</b><span>Joined ' + esc(joined) + '</span></div>' +
      '<div class="flat-amt' + (invested > 0 ? ' pos' : ' zero') + '">' + ugx(invested) + '</div></div>';
  }).join('');
  $('teamLevelList').innerHTML = '<div class="muted" style="font-size:12px;margin-bottom:2px">' + list.length + ' member' + (list.length === 1 ? '' : 's') + '</div><div class="flat-list">' + rows + '</div>';
}

/* ====================== NOTICES ====================== */
function toast(msg){
  var bg = $('toastBg'); $('toast').textContent = msg; bg.classList.add('show');
  clearTimeout(window._tTimer); window._tTimer = setTimeout(function(){ bg.classList.remove('show'); }, 2600);
}

/* ====================== START ====================== */
// Real entry happens in onFbAuthChanged() once the sign-in script has said who (if anyone) is signed in. STATE is null until then.
captureReferralFromUrl();
applyBrandName();
paintAuthArt();
setAuthMode(authMode);
window.addEventListener('snow-auth', function(ev){ onFbAuthChanged(ev.detail); });
// The sign-in script announces who is signed in once, as soon as the page is parsed. This code unpacks a little later (on a slow phone, much later):
// if that already happened nobody was listening, so it is taken from the sign-in script directly.
if (window._smartaiAuthFired && window.fbAuth) onFbAuthChanged(window.fbAuth.currentUser);
