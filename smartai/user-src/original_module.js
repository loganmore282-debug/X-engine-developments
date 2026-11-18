/* Smart AI member app.
   The pages are ChocoMCC's (Home, AI Robots, Rewards, Team, Me and their full-screen sheets) in blue and white with the owner's icons,
   running on Smart AI's own server: its sign-in (/auth/*), deposits, withdrawals and rewards. */
// The server answers under /k7x2 on the page's own host (nginx strips the prefix). No domain is baked in, so a new host never needs a rebuild.
var API_BASE = '/k7x2';
var BRAND_CACHE_KEY = 'smartai_brand_name';
var SETTINGS_CACHE_KEY = 'smartai_settings_cache';
var PRODUCTS_CACHE_KEY = 'smartai_products_cache';
// The numbers before the server has answered: the server's own defaults. Everything the member sees is replaced by what /public/settings says.
var DEFAULT_SETTINGS = {
  withdrawFeePct: 15, minWithdraw: 5000, minDeposit: 5000, welcomeBonus: 7000,
  commL1: 27, commL2: 2, commL3: 1, checkinLadder: [100, 200, 300, 500, 600, 700, 800, 1000], dailyCheckin: 250, maxWithdrawalsPerDay: 2,
  withdrawWindowEnabled: false, withdrawOpenFrom: '09:00', withdrawOpenTo: '17:00',
  salaryTiers: [], depositMethodNames: '', brandName: '', shareMessage: 'Join me on {app}', shareDomain: '',
  supportTelegram: '', telegramGroup: '', telegramChannel: '', supportHours: '', whatsappGroup: '', whatsappContact: '', signupJoin: 'auto',
  rulesText: '', guideOn: false, guideVer: 0, guidePdfVer: 0, guidePdfName: '', annEnabled: false, annTitle: '', annBody: '', pageParticles: false, homeBannerTitle: '', homeBannerText: '', myBannerOpacity: 100, myBannerBlur: 0, navIconSize: 26, homeIconSize: 34, meIconSize: 36, giftCodeHint: 'Enter gift code'
};
var ICON_CHEV = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>';
// Filled by syncPublicConfig() from the admin's products; the last copy this device saw is read first so the very first paint is already right.
var PRODUCTS = [];
try {
  var _cachedProducts = JSON.parse(localStorage.getItem(PRODUCTS_CACHE_KEY) || 'null');
  if (Array.isArray(_cachedProducts) && _cachedProducts.length) PRODUCTS = _cachedProducts;
} catch (e) {}
// False until the robot list has come from the server (or this phone had a saved copy): until then an empty list means "not here yet", and the page shows the loader.
var _productsOk = PRODUCTS.length > 0;
try { localStorage.removeItem('smartai_categories_cache'); } catch (e) {}   // the old category list this phone kept (categories are gone)
var NETWORK_COLORS = { 'MTN Mobile Money': { color: '#FFCC08', textColor: '#0B2A5B' }, 'Airtel Money': { color: '#ED1C24', textColor: '#fff' } };
// Pictures the admin uploaded (Admin > Banners): one for every banner the app draws, plus the Login logo and the profile logo. None set = a blue art banner.
var ART_SLOTS = ['authhero', 'authlogo', 'profilelogo', 'teambanner', 'mybanner', 'aboutbanner', 'shopbanner', 'depositbanner', 'withdrawbanner', 'supportbanner', 'recordsbanner', 'bindbankbanner'];
var ART = { home: '', announcement: '' };
ART_SLOTS.forEach(function(k){ ART[k] = ''; });
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
// Icon sizes from Admin > Settings: bottom navigation, Home actions, Me page. They are CSS variables, so the box around each icon follows it.
function paintIconSizes(){
  var sett = getSettings(), root = document.documentElement.style;
  [['--nav-ic', 'navIconSize', 14, 48, 26], ['--home-ic', 'homeIconSize', 20, 64, 34], ['--me-ic', 'meIconSize', 20, 64, 36]].forEach(function(d){
    var n = Number(sett[d[1]]); if (!isFinite(n)) n = d[4];
    root.setProperty(d[0], Math.max(d[2], Math.min(d[3], Math.round(n))) + 'px');
  });
}
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
// The server's own clock (X-Server-Time on every reply): the offset from this phone's clock, used by the cash-out hours, which follow the server's time.
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
      var resp = await fetch(API_BASE + path, opts);
      noteServerClock(resp, sentAt);
      var data;
      try { data = await resp.json(); }
      catch (pe) {
        // The web server's own "too many requests" page is not JSON: say what it means instead of "could not reach the server".
        if (resp.status === 429) { clearTimeout(timer); return { status: 'error', message: 'Too many requests. Please wait a moment and try again.' }; }
        throw pe;
      }
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
      if (i === attempts - 1) {
        // A call that moves money may have reached the server even though the answer never came back: never say "try again" for those.
        var movesMoney = /^\/(deposit|invest|withdraw|redeem|salary\/claim|agent\/claim|checkin|lucky)/.test(path);
        return { status: 'error', message: ctl.signal.aborted ? 'The request took too long. Check Records before trying a payment again.' : (movesMoney ? 'The connection dropped. Check Records before trying again, in case it went through.' : 'Could not reach the server. Check your connection and try again.') };
      }
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
var _serverUnreachableWarned = false, _lastDataAt = 0, _lastCfgAt = 0;
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
    STATE.vip = Number(a.vipLevel) || 0;
    STATE.lucky = a.lucky || { on: false, vip: 0, chances: 0, minVip: 0, minAmount: 0, maxAmount: 0, hasProducts: false };
    STATE.referralCode = a.referralCode || STATE.referralCode;
    STATE.withdrawAnytime = a.withdrawAnytime === true;
    STATE.team = a.team || STATE.team;
  } else if (accR.code === 'MAINTENANCE' || accR.code === 'BANNED' || accR.code === 'HOST_PARKED') {
    // handled by the full-screen lock-out inside api()
  } else if (!_serverUnreachableWarned) {
    _serverUnreachableWarned = true;
    toast('Could not reach the server, showing your last known balance');
  }
  if (!STATE.ok) STATE.ok = { inv: false, bank: false, tx: false };
  if (invR.status === 'success' && Array.isArray(invR.investments)) {
    STATE.ok.inv = true;
    // Every figure is read straight off the server's own record of the purchase and never worked out here, so the app can only show the real number.
    STATE.investments = invR.investments.map(function(iv){
      return { id: iv.id, key: iv.tierKey, name: iv.tierLabel, price: iv.amount,
        cycleDays: iv.payoutsTotal || iv.cycle, daysElapsed: iv.payoutsMade || 0, accrued: iv.paidOut || 0, matured: iv.status === 'matured' || iv.status === 'completed',
        dailyIncome: iv.dailyPayout, totalIncome: iv.expectedReturn, purchasedAt: tsMs(iv.createdAt) || null };
    });
  }
  if (bankR.status === 'success') { STATE.bankAccounts = bankR.accounts || []; STATE.ok.bank = true; }
  if (txR.status === 'success' && Array.isArray(txR.transactions)) {
    STATE.ok.tx = true;
    STATE.transactions = txR.transactions.map(function(t){
      var when = tsMs(t.createdAt) || tsMs((t.date || '') + ' ' + (t.time || ''));
      return { type: t.type, amount: Number(t.amount) || 0, desc: t.description || '', status: t.status || 'success', ref: t.ref || t.statementId || '', when: when };
    });
  }
  if (accR.status === 'success') _lastDataAt = Date.now();
  saveState();
  return accR;
}
// A list that is empty only because it has not arrived must never say "none yet": a page that needs one of the three lists (STATE.ok) shows the loader, asks
// the server, and if the answer does not come says so with a Try again button (never a loader that turns for ever).
var _dataFailed = {}, _dataAsking = null;
function dataLoaded(kind, list){ return !!(list && list.length) || !!(STATE && STATE.ok && STATE.ok[kind]); }
function ensureData(){
  if (!_dataAsking) _dataAsking = refreshFromServer().then(function(r){ _dataAsking = null; return r; }, function(){ _dataAsking = null; return null; });
  return _dataAsking;
}
function waitForData(kind, box, again){
  if (_dataFailed[kind]) {
    box.innerHTML = '<div class="empty">Could not load this page.<br><button type="button" class="btn btn-ghost btn-sm" style="margin-top:12px" data-kind="' + kind + '" onclick="retryData(this.dataset.kind)">Try again</button></div>';
    return;
  }
  box.innerHTML = spinnerHtml();
  var epoch = _authEpoch;
  ensureData().then(function(){
    if (!STATE || epoch !== _authEpoch) return;
    _dataFailed[kind] = !(STATE.ok && STATE.ok[kind]);
    again();
  });
}
function retryData(kind){ _dataFailed[kind] = false; renderMyRobots(); renderEarnings(); renderBankList(); renderRecords(); }
// The admin's economics, products and pictures, so a change made in the admin panel reaches members without a new app. Settings are kept in
// localStorage next to the products, so the next launch paints with the last real numbers before the network answers.
async function syncPublicConfig(){
  var jobs = [];
  jobs.push(api('/public/settings').then(function(r){
    if (r && r.status === 'success' && r.settings) {
      try { localStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify(r.settings)); } catch (e) {}
      applyBrandName();
      paintMeLook();
      paintIconSizes();
      syncPageParticles();
      try { var as = getSettings(); preloadAnnEmoji(String(as.annTitle || '') + ' ' + String(as.annBody || '')); } catch (e) {}
    }
  }).catch(function(){}));
  jobs.push(api('/public/products').then(function(r2){
    if (r2 && r2.status === 'success' && Array.isArray(r2.products)) {
      PRODUCTS = r2.products.filter(function(p){ return !p.deleted; });
      saveProductsCache();
      var firstArrival = !_productsOk;
      _productsOk = true;
      if (firstArrival && STATE) { renderFeatured(); renderShop(); }   // the loader that stood in for the list is replaced by the list
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
    ART_SLOTS.forEach(function(k){ ART[k] = im[k] || ''; });
    STATE_ICONS = im.icons || {};
  }
  if (bn.status === 'success') ART.home = bn.image || '';
  if (an.status === 'success') ART.announcement = an.image || '';
  if ((im.status !== 'success' || bn.status !== 'success') && _artTries++ < 3) setTimeout(syncArtwork, 4000);
  paintArt();
}
// The pictures of the app are the owner's built-in icon pack (/icons/<name>.webp); a picture uploaded in Admin > Banners > Icons for the same name replaces it.
var STATE_ICONS = {};
// ICON_VER: raise it whenever a built-in picture in user/icons/ is replaced, so a phone that kept the old file under the same address fetches the new one.
var ICON_VER = '71';
function iconUrl(name){ return (STATE_ICONS && STATE_ICONS[name]) || '/icons/' + name + '.webp?v=' + ICON_VER; }
function customIcon(name){ return (STATE_ICONS && STATE_ICONS[name]) || ''; }
function paintIcons(){
  paintMedals();
  document.querySelectorAll('img[data-icon]').forEach(function(img){
    var name = img.getAttribute('data-icon'), u = iconUrl(name);
    if (img.getAttribute('src') !== u) {
      img.onerror = function(){ this.onerror = null; this.src = '/icons/' + name + '.webp?v=' + ICON_VER; };
      img.setAttribute('src', u);
    }
  });
}
function serverTodayKey(){
  var d = new Date(Date.now() + 3 * 3600000);
  var p = function(n){ return String(n).padStart(2, '0'); };
  return p(d.getUTCMonth() + 1) + '/' + p(d.getUTCDate()) + '/' + d.getUTCFullYear();
}
// Read from every screen paint, so the stored text is only parsed again when it has changed.
var _settingsRaw = null, _settingsObj = {};
function getSettings(){
  try {
    var raw = localStorage.getItem(SETTINGS_CACHE_KEY) || '';
    if (raw !== _settingsRaw) { _settingsObj = raw ? JSON.parse(raw) : {}; _settingsRaw = raw; }
    return Object.assign({}, DEFAULT_SETTINGS, _settingsObj);
  } catch (e) { _settingsRaw = null; return Object.assign({}, DEFAULT_SETTINGS); }
}
// What a member sees before buying is exactly what he will be paid: the product's own payout and cycle win (the server computes it the same way).
function productCycle(p){ return Number(p && p.cycle) || 150; }
function productExpectedReturn(p){ return Number(p && p.expectedReturn) || Math.round((p ? p.price : 0) * (Number(p && p.multiplier) || 1)); }
function dailyReturn(p){ return Math.round(productExpectedReturn(p) / productCycle(p)); }
function ugx(n){ n = Number(n) || 0; var hasCents = Math.round(n * 100) % 100 !== 0; return 'UGX ' + (hasCents ? (Math.round(n * 100) / 100).toFixed(2) : String(Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]; }); }
/* ====================== THE OWNER'S ANIMATIONS: dots loader, level medals ======================
   Dots loader: measured frame by frame from his screen recording (2 s loop). Three rings of four dots. Outer (big) dots turn once round a loop with a pause
   (DL_THETA = their angle every 20 ms, measured; 81 degrees to start). Middle dots follow 46 degrees behind and breathe: ring and dot size both x(0.8546 + 0.1425 sin(pi t)).
   Small inner dots turn the other way (90 minus the outer angle). Blue in the app's colour (CSS var --caramel). One shared ticker moves every dots loader and
   medal that is on screen; with nothing to draw it only looks again four times a second. */
var DL_THETA = [0.0,0.3,1.4,2.2,2.9,3.5,4.0,4.5,5.1,5.6,6.0,6.4,6.8,7.2,7.5,7.7,8.0,8.2,8.4,8.6,8.7,8.9,8.9,9.0,9.0,9.2,9.4,9.9,10.6,11.5,12.7,14.5,16.8,19.5,22.8,26.8,32.0,38.2,44.9,52.4,61.1,72.0,84.8,98.5,112.0,126.0,140.9,155.7,168.5,179.5,189.7,200.0,210.1,219.3,227.2,234.5,241.9,249.0,255.2,260.6,265.8,271.2,276.5,281.3,285.4,289.2,293.0,296.8,300.5,304.0,307.2,310.3,313.4,316.3,318.9,321.5,324.2,326.8,329.1,331.1,332.9,334.8,336.8,338.8,340.6,342.3,344.0,345.6,347.0,348.3,349.4,350.6,351.8,353.1,354.2,355.3,356.4,357.4,358.4,359.6,360.0];
function dlTheta(t){
  var x = (t % 2) / 0.02, i = Math.floor(x), f = x - i;
  return 81 + DL_THETA[i] + (DL_THETA[i + 1] - DL_THETA[i]) * f;
}
// 12 circles [cx, cy, r] at time t (seconds)
function dlCircles(t){
  var th = dlTheta(t), s = 0.8546 + 0.1425 * Math.sin(Math.PI * t), out = [], k, a, d2r = Math.PI / 180;
  for (k = 0; k < 4; k++) { a = (th + 90 * k) * d2r; out.push([224.9 * Math.cos(a), 224.9 * Math.sin(a), 46.88]); }
  for (k = 0; k < 4; k++) { a = (th - 46 + 90 * k) * d2r; out.push([224.9 * s * Math.cos(a), 224.9 * s * Math.sin(a), 46.88 * s]); }
  for (k = 0; k < 4; k++) { a = (90 - th + 90 * k) * d2r; out.push([80.9 * Math.cos(a), 80.9 * Math.sin(a), 16.38]); }
  return out;
}
function dlMarkup(){
  var c = dlCircles((Date.now() % 2000) / 1000), h = '<svg class="dl" viewBox="-280 -280 560 560" aria-hidden="true">', i;
  for (i = 0; i < c.length; i++) h += '<circle cx="' + c[i][0].toFixed(1) + '" cy="' + c[i][1].toFixed(1) + '" r="' + c[i][2].toFixed(1) + '"></circle>';
  return h + '</svg>';
}
// Admin > Banners > Animations: a picture uploaded for the loader replaces the dots (it turns round); removing it brings the dots back.
function spinnerHtml(){
  var custom = customIcon('loader');
  return '<div class="cm-spin-wrap">' + (custom ? '<img class="dl-custom" src="' + esc(custom) + '" alt="">' : dlMarkup()) + '</div>';
}
// Level medals: sprite sheets of 10 columns x 9 rows (128 px cells); MEDAL_TL[level][n] = the cell shown during the n-th thirtieth of a second of the 3 s loop.
var MEDAL_TL = {1:[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,59,60,61,62,63,64,65,65,66,66,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,82,82],2:[0,1,1,2,2,3,4,5,6,7,8,9,10,11,12,13,14,14,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84],3:[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89]};
var _medalReady = {};
function medalPreload(){
  [1, 2, 3].forEach(function(n){
    if (_medalReady[n] !== undefined || customIcon('level' + n)) return;
    _medalReady[n] = false;
    var im = new Image();
    im.onload = function(){ _medalReady[n] = true; paintMedals(); };
    im.onerror = function(){ _medalReady[n] = undefined; };
    im.src = '/anim/medal-' + n + '.webp';
  });
}
// A picture uploaded in Admin > Banners > Animations stands still in place of the animated medal; Back to default brings the animation.
function paintMedals(){
  document.querySelectorAll('.medal[data-medal]').forEach(function(el){
    var n = el.getAttribute('data-medal'), custom = customIcon('level' + n);
    if (custom) { el.classList.add('custom'); el.classList.remove('live'); el.style.backgroundImage = 'url("' + String(custom).replace(/"/g, '%22') + '")'; return; }
    el.classList.remove('custom'); el.style.backgroundImage = '';
    el.classList.toggle('live', !!_medalReady[n]);
    if (_medalReady[n]) medalPose(el, Math.floor((Date.now() % 3000) / (1000 / 30)));   // the right picture at once, not the middle of the sheet for a thirtieth of a second
  });
}
function medalPose(el, tick){
  var tl = MEDAL_TL[el.getAttribute('data-medal')]; if (!tl) return;
  var cell = tl[tick % tl.length];
  el.style.backgroundPosition = ((cell % 10) / 9 * 100).toFixed(3) + '% ' + (Math.floor(cell / 10) / 8 * 100).toFixed(3) + '%';
}
var _animLast = -1;
function animTick(){
  var dls = document.querySelectorAll('svg.dl'), meds = document.querySelectorAll('.medal.live'), n = dls.length + meds.length;
  if (n && !document.hidden) {
    var now = Date.now(), c, i, j, ch;
    if (dls.length) {
      c = dlCircles((now % 2000) / 1000);
      for (i = 0; i < dls.length; i++) { ch = dls[i].children; for (j = 0; j < 12; j++) { ch[j].setAttribute('cx', c[j][0].toFixed(1)); ch[j].setAttribute('cy', c[j][1].toFixed(1)); ch[j].setAttribute('r', c[j][2].toFixed(1)); } }
    }
    var tick = Math.floor((now % 3000) / (1000 / 30));
    if (meds.length && tick !== _animLast) {
      _animLast = tick;
      for (i = 0; i < meds.length; i++) medalPose(meds[i], tick);
    }
  }
  if (n) requestAnimationFrame(animTick); else setTimeout(animTick, 250);
}
animTick();
// Every page change shows the dots over a veil in the page colour. The veil is REAL: it stays up for as long as that page's own request to the server is
// in flight (the account, products, ledger, team, activity ...) and goes the moment the answer is on screen (never before 300 ms, never after 10 s). A
// page with nothing to ask for (Terms, Support text) keeps it for 450 ms. Tests switch it off with window._smartaiNavMs = 0.
var _navVeilTimer = null, _navVeilToken = 0, NAV_VEIL_MS = 450, NAV_VEIL_MIN = 300, NAV_VEIL_MAX = 10000;
function navVeil(over, task){
  var ms = window._smartaiNavMs != null ? window._smartaiNavMs : (window._smartaiLoaderMinMs === 0 ? 0 : NAV_VEIL_MS), v = $('navVeil');
  if (!v || !ms || !STATE || document.hidden) return;
  clearTimeout(_navVeilTimer);
  var token = ++_navVeilToken, started = Date.now();
  v.className = 'nav-veil on' + (over ? ' over' : '');
  v.innerHTML = dlMarkup();
  function hide(){
    if (token !== _navVeilToken) return;
    v.classList.remove('on');
    flushVeilWaiters();
    _navVeilTimer = setTimeout(function(){ if (!v.classList.contains('on')) v.innerHTML = ''; }, 260);
  }
  if (task && task.then) {
    var finish = function(){ if (token !== _navVeilToken) return; clearTimeout(_navVeilTimer); _navVeilTimer = setTimeout(hide, Math.max(0, NAV_VEIL_MIN - (Date.now() - started))); };
    task.then(finish, finish);
    _navVeilTimer = setTimeout(hide, NAV_VEIL_MAX);
  } else _navVeilTimer = setTimeout(hide, ms);
}
// Something that must happen AFTER the dots have lifted (a scroll the member should see): runs once the veil is off, at once when none is showing.
var _veilWaiters = [];
function afterVeil(fn){
  var v = $('navVeil');
  if (!v || !v.classList.contains('on')) { setTimeout(fn, 0); return; }
  _veilWaiters.push(fn);
}
function flushVeilWaiters(){ var l = _veilWaiters.splice(0); l.forEach(function(f){ setTimeout(f, 120); }); }
// The account, products, bank cards and ledger, asked afresh when the last answer is older than maxAge ms (several quick taps share one answer).
function liveData(maxAge){ return Date.now() - _lastDataAt < maxAge ? Promise.resolve() : ensureData(); }
function liveConfig(maxAge){ if (Date.now() - _lastCfgAt < maxAge) return Promise.resolve(); _lastCfgAt = Date.now(); return syncPublicConfig(); }
// What each tab really asks the server when it opens; the answer is painted before the veil lifts.
function tabTask(name){
  if (!STATE) return null;
  var epoch = _authEpoch, t;
  if (name === 'home') t = Promise.all([liveData(8000), liveConfig(15000), refreshActivityFeed()]);
  else if (name === 'shop') t = Promise.all([liveData(8000), liveConfig(15000)]);
  else if (name === 'rewards' || name === 'account') t = liveData(8000);
  else if (name === 'team' || name === 'share') t = Promise.all([liveData(8000), refreshTeamStats()]);
  else return null;
  return t.then(function(){ if (STATE && epoch === _authEpoch) renderAll(); });
}
// And each page that opens over a tab.
function overlayTask(name){
  if (!STATE) return null;
  var epoch = _authEpoch, t = null, again = null;
  if (name === 'taskcenter') return loadTaskCenter();
  if (name === 'about') return loadAbout();
  if (name === 'mychoc') again = renderMyRobots;
  else if (name === 'earnings') again = renderEarnings;
  else if (name === 'bindbank') again = renderBankList;
  else if (name === 'withdraw') again = renderWitBankBox;
  else if (name === 'support' || name === 'rules') return liveConfig(15000).then(function(){ if (STATE && epoch === _authEpoch) renderStaticPages(); });
  if (!again) return null;
  return liveData(8000).then(function(){ if (STATE && epoch === _authEpoch && _ovName === name) again(); });
}
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
    lucky: { on: false, vip: 0, chances: 0, minVip: 0, minAmount: 0, maxAmount: 0, hasProducts: false }, team: { l1: 0, l2: 0, l3: 0, commission: 0 },
    withdrawAnytime: false,
    investments: [], transactions: [], bankAccounts: [], depositRecords: null, withdrawalRecords: null, salary: null,
    ok: { inv: false, bank: false, tx: false }   // which of those three lists has really come from the server (see waitForData)
  };
}

/* ====================== THE START-UP SCREEN ======================
   The animation (see the script at the top of index.html) stays for at least LOADER_MIN_MS from the moment the page began, then the page opens. */
var LOADER_MIN_MS = 2500, _ldTimer = null, _annAfterLoader = false;
function hideLoadingScreen(){
  var ls = $('loadingScreen'); if (!ls || ls.style.display === 'none') return;
  var began = Number(window._smartaiLoaderStart) || 0;
  var minMs = typeof window._smartaiLoaderMinMs === 'number' ? window._smartaiLoaderMinMs : LOADER_MIN_MS;
  var wait = began ? Math.max(0, minMs - (Date.now() - began)) : 0;
  if (_ldTimer) { clearTimeout(_ldTimer); _ldTimer = null; }
  var go = function(){
    _ldTimer = null;
    ls.style.display = 'none';
    if (window._smartaiLoaderEnded) window._smartaiLoaderEnded();   // the animation lets go of its picture sheet and the status bar goes back to the app's colour
    if (_annAfterLoader) { _annAfterLoader = false; maybeShowAnnouncement(); }
  };
  if (!wait) { go(); return; }
  _ldTimer = setTimeout(go, wait);
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
  $('regCodeField').style.display = reg ? 'block' : 'none';
  $('fPassConfirm').value = '';
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
    _refFromUrl = _refFromUrl.toUpperCase(); $('fCode').value = _refFromUrl;
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
  return (e && e.message && code.indexOf('auth/') !== 0) ? e.message : 'Something went wrong, try again.';
}
// Finishes a sign-up that has an account but no profile yet (the invitation code and the welcome gift are added here).
async function registerProfile(ref, phone){
  var r = await api('/register', { referralCode: ref, phone: phone }, 'POST', true);
  // The invitation code is optional: a wrong one is dropped and the sign-up carries on without an upline.
  if (r.status === 'error' && r.code === 'BAD_REFERRAL' && ref) {
    toast(r.message || 'That invitation code is not valid. Continuing without it.');
    r = await api('/register', { referralCode: '', phone: phone }, 'POST', true);
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
  var ref = '';
  if (authMode === 'register') {
    if (pass !== $('fPassConfirm').value) { toast('Passwords do not match'); return; }
    ref = $('fCode').value.trim();
  }
  if (!window.fbSignIn) { toast('Still connecting, try again in a moment'); return; }
  var email = phoneToEmail(local);
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
      var regR = await registerProfile(ref, local);
      if (regR.status !== 'success' && regR.status !== 'already_done') {
        try { await window.fbSignOut(); } catch (e3) {}
        STATE = null; _authEpoch++;
        authFail(regR.message || 'Could not finish setting up your account, try again shortly');
        return;
      }
      await refreshFromServer();
      toast('Registration successful ✓');
      enterApp();
      // A member who has just CREATED the account (not one who signs in later) is sent once to the community link the admin chose; coming back, the app is just as they left it.
      var joinUrl = regR.status === 'success' ? signupJoinUrl() : '';
      if (joinUrl) sendToCommunity(joinUrl); else maybeOfferInstallAfterSignup();
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
      return fetch(API_BASE + '/auth/session/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + t }, signal: ac.signal });
    }).catch(function(){});
    _authEpoch++;
    STATE = null; _appEntered = false; _agentMe = null; _agentMeAt = 0; _cc.unread = {}; _cc.msgs = []; _cc.agent = null; _cc.seq = 0; _cc.cfg = null; _cc.key = null; _cc.regFor = ''; _cc.imgs = {}; _cc.warm = {}; _cc.typing = false; _cc.restricted = false;
    clearCachedState();
    _recordsLoaded = { accrued: true, topups: false, cashouts: false }; _recordsFailed = { topups: false, cashouts: false }; _dataFailed = {};
    stopActivityFeed(); stopAccountPoll(); gpLeave(); stopDepositPoll(); releasePayLoader();
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
  setTimeout(medalPreload, 700);
  setTimeout(refreshAgentMe, 1500);
  startAccountPoll();
  updateDownloadTileVisibility();
  syncArtwork();
  setTimeout(gpResume, 1200);   // an unfinished payment order comes back (same order, same clock)
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
    STATE = null; _appEntered = false; _agentMe = null; _agentMeAt = 0; _cc.unread = {}; _cc.msgs = []; _cc.agent = null; _cc.seq = 0; _cc.cfg = null; _cc.key = null; _cc.regFor = ''; _cc.imgs = {}; _cc.warm = {}; _cc.typing = false; _cc.restricted = false;
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
var TG_ICON_WHITE = '<svg width="16" height="16" viewBox="0 0 24 24"><path fill="#fff" d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.3-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71l-4.14-3.05-2 1.93c-.23.23-.42.42-.83.42z"/></svg>';
// The Telegram and WhatsApp app icons, traced off the recordings (600 x 600, gradients #supTg / #supWa live once in the page); they pop in a loop (.sup-ic).
var SUP_ART = {
  tg: ['M56 32L32 56L32 59L28 62L28 65L26 66L26 69L24 70L24 73L22 74L22 77L18 82L18 87L16 88L16 92L14 93L14 99L12 100L12 106L10 107L10 115L8 116L8 127L6 128L6 140L0 141L0 457L6 458L6 472L8 473L8 483L10 484L10 491L12 492L14 506L16 507L16 512L18 513L18 517L20 518L20 521L22 522L24 529L30 536L30 539L34 542L34 545L54 565L59 567L66 573L69 573L70 575L77 577L82 581L100 587L115 589L116 591L123 591L127 593L139 593L142 595L142 599L460 599L460 595L463 593L474 593L477 591L485 591L487 589L494 589L495 587L508 585L509 583L513 583L515 581L518 581L519 579L522 579L534 573L535 571L546 565L566 545L568 539L578 525L586 505L586 498L588 497L588 492L590 490L590 484L592 481L592 474L594 470L594 458L599 457L599 142L594 141L594 129L592 125L592 118L590 115L590 109L588 101L586 99L584 88L582 87L582 83L580 81L580 78L578 77L578 74L576 73L576 70L574 69L570 60L564 52L546 34L541 32L534 26L531 26L530 24L527 24L526 22L523 22L518 18L513 18L508 14L502 14L501 12L495 12L494 10L485 10L484 8L477 8L476 6L461 6L460 0L139 0L138 6L124 6L123 8L116 8L115 10L106 10L105 12L98 12L97 14L86 16L85 18L82 18L81 20L78 20L77 22L74 22L73 24L70 24L69 26L62 28L59 32Z', 'M465 177L464 175L459 171L453 169L445 169L444 170L435 171L432 173L428 173L408 181L405 181L402 183L397 184L382 191L379 191L377 193L375 193L372 195L369 195L367 197L350 203L348 205L345 205L343 207L336 209L334 211L331 211L329 213L322 215L320 217L317 217L315 219L308 221L306 223L299 225L297 227L294 227L292 229L289 229L283 233L280 233L278 235L275 235L273 237L271 237L269 239L266 239L260 243L257 243L251 247L248 247L246 249L243 249L237 253L234 253L232 255L225 257L223 259L220 259L219 261L216 261L214 263L211 263L209 265L206 265L205 267L202 267L200 269L197 269L191 273L188 273L186 275L183 275L177 279L174 279L172 281L169 281L163 285L160 285L159 287L156 287L153 289L151 289L149 291L146 291L145 293L142 293L139 295L137 295L135 297L132 297L131 299L128 299L125 301L123 301L121 303L118 303L117 305L114 305L112 307L110 307L108 309L102 311L102 312L94 319L94 328L95 328L98 332L100 332L102 334L104 334L106 336L109 336L114 339L121 340L124 342L127 342L136 346L140 346L143 348L147 348L150 350L155 350L158 352L163 352L166 354L172 354L177 356L191 356L194 354L199 354L201 352L204 352L206 350L212 348L217 344L219 344L220 342L223 340L225 340L226 338L232 334L235 334L238 330L263 314L264 312L273 307L276 304L348 256L353 254L365 246L372 245L377 249L377 254L363 270L342 289L333 299L325 305L314 317L289 339L289 340L263 365L258 372L258 374L256 377L256 380L259 388L260 388L264 394L268 396L269 398L272 399L275 402L287 409L290 412L330 438L333 441L336 442L337 444L342 446L373 468L386 475L392 477L395 477L396 478L406 478L414 474L421 465L426 451L426 446L429 437L431 420L432 419L432 415L434 409L434 403L436 397L436 389L438 385L438 380L440 374L440 367L441 366L442 356L443 355L444 345L445 344L445 339L446 338L446 332L447 331L447 326L448 325L448 320L450 313L450 306L452 301L452 295L453 294L456 268L457 267L459 248L460 247L460 239L462 232L462 225L463 224L463 218L464 217L464 208L465 207L465 199L466 198L466 181L465 180Z'],
  wa: ['M43 42L41 44L41 47L37 49L37 51L31 56L31 59L27 62L27 65L25 66L25 69L23 70L23 73L21 74L21 77L17 82L17 87L15 88L15 93L13 94L13 99L11 100L11 109L9 110L9 117L7 118L7 129L5 130L5 145L0 146L0 453L5 454L5 469L7 472L7 481L9 482L11 498L13 500L13 505L15 506L15 511L17 512L19 521L21 522L21 525L25 530L25 533L29 536L31 542L46 559L61 571L76 579L84 581L85 583L90 583L97 587L110 589L113 591L137 594L138 599L463 599L464 594L477 593L480 591L487 591L490 589L503 587L510 583L514 583L525 577L528 577L549 563L565 547L565 545L573 535L583 515L583 511L587 503L587 498L591 487L594 462L599 461L599 134L595 134L593 131L593 120L591 119L591 110L589 109L589 102L587 101L587 96L585 95L585 90L581 83L581 80L579 79L579 76L573 64L561 49L561 47L558 46L547 34L534 26L533 24L530 24L524 20L520 20L519 18L516 18L515 16L512 16L510 14L498 12L497 10L488 10L487 8L480 8L479 6L466 6L465 0L135 0L134 6L121 6L120 8L113 8L112 10L105 10L104 12L89 14L88 16L85 16L80 20L75 20L74 22L71 22L68 26L65 26L64 28L57 30L46 42Z', 'M215 216L211 223L209 224L203 236L203 239L201 244L201 263L202 264L203 271L205 274L205 277L216 299L219 302L227 315L229 316L230 319L232 320L233 323L235 324L240 331L241 331L256 347L262 351L263 353L267 355L268 357L275 361L276 363L291 373L297 375L306 381L309 381L311 383L313 383L316 385L319 385L328 389L333 389L336 391L344 391L345 392L351 392L352 393L360 393L361 392L370 391L379 387L388 381L388 380L394 375L400 361L400 356L401 355L400 346L399 346L398 344L396 344L390 340L387 340L385 338L383 338L381 336L379 336L369 330L366 330L365 328L362 328L356 324L350 324L350 325L346 328L345 331L343 332L342 335L338 338L337 341L333 344L332 347L329 348L328 350L322 350L320 348L317 348L316 346L313 346L311 344L309 344L307 342L301 340L293 334L291 334L290 332L286 330L285 328L279 324L263 307L262 304L260 303L250 287L250 281L254 276L258 273L266 261L266 254L264 251L264 249L262 247L262 244L260 242L260 240L258 237L258 234L254 227L254 225L252 223L252 220L248 212L243 208L226 208L224 210L222 210L221 212L219 212L219 213ZM431 144L427 142L426 140L424 140L423 138L419 136L418 134L416 134L415 132L413 132L412 130L410 130L409 128L407 128L402 124L400 124L399 122L396 122L395 120L393 120L387 116L384 116L383 114L380 114L378 112L375 112L373 110L370 110L368 108L364 108L362 106L358 106L355 104L350 104L348 102L340 102L338 100L329 100L326 98L305 98L304 97L301 98L277 98L274 100L263 100L261 102L254 102L252 104L246 104L244 106L240 106L238 108L234 108L232 110L229 110L227 112L224 112L222 114L219 114L218 116L215 116L213 118L211 118L209 120L203 122L195 128L193 128L192 130L190 130L189 132L187 132L186 134L184 134L183 136L181 136L178 140L176 140L175 142L173 142L164 152L160 154L160 155L154 160L151 165L145 170L135 185L133 186L133 188L127 196L123 205L121 207L121 209L119 211L117 218L113 224L113 228L111 230L111 233L107 242L107 247L105 250L105 255L103 258L103 265L101 268L101 281L99 286L99 313L101 318L101 329L103 333L103 339L105 343L105 349L107 352L107 355L109 358L109 361L111 364L113 373L117 380L117 382L119 384L119 387L121 389L121 391L123 392L123 394L125 396L126 401L125 402L125 407L123 410L123 414L121 416L121 421L119 424L119 428L117 431L117 435L115 438L115 443L113 446L113 450L111 452L111 457L109 460L109 464L107 468L107 471L105 474L105 479L103 482L103 487L101 490L101 494L99 496L99 503L103 501L115 499L118 497L130 495L133 493L138 493L141 491L146 491L149 489L153 489L156 487L160 487L164 485L168 485L172 483L176 483L180 481L184 481L187 479L192 479L195 477L199 477L200 476L206 476L214 481L216 481L218 483L220 483L223 485L226 485L228 487L230 487L233 489L236 489L239 491L243 491L246 493L249 493L253 495L258 495L262 497L269 497L273 499L284 499L285 500L314 500L315 499L327 499L331 497L338 497L342 495L347 495L351 493L361 491L364 489L367 489L370 487L382 483L384 481L386 481L388 479L390 479L398 475L423 459L424 457L435 449L435 448L451 433L464 417L465 414L467 413L469 408L471 407L477 397L485 381L485 379L491 366L491 363L493 360L495 354L495 350L497 346L497 342L498 341L499 332L500 331L500 325L501 324L502 286L501 285L501 272L499 267L499 260L497 257L497 252L495 247L495 243L489 229L487 220L485 219L483 212L477 200L473 195L471 190L469 189L467 184L465 183L464 180L461 176L459 175L455 168L454 168ZM413 171L414 173L428 186L430 190L434 195L436 196L440 203L442 204L442 206L446 211L446 213L448 214L448 216L450 218L456 230L456 232L458 234L460 243L462 245L462 249L464 252L464 256L466 258L466 265L468 268L468 277L470 282L470 315L468 320L468 329L466 332L466 339L464 340L464 345L462 348L462 351L460 354L458 363L456 364L456 367L450 377L448 383L446 384L446 387L444 388L442 391L442 393L440 394L438 397L438 399L434 402L432 405L432 407L430 408L411 428L407 430L407 431L402 434L401 436L389 444L387 444L386 446L384 446L379 450L377 450L371 454L368 454L366 456L363 456L361 458L352 460L350 462L345 462L342 464L336 464L333 466L323 466L320 468L285 468L281 466L272 466L268 464L262 464L259 462L255 462L252 460L248 460L246 458L243 458L241 456L237 456L236 454L233 454L231 452L224 450L211 442L203 442L200 444L195 444L192 446L188 446L186 448L180 448L178 450L172 450L170 452L165 452L162 454L157 454L155 456L145 457L144 456L144 452L148 443L148 438L150 435L150 431L152 428L152 424L154 421L154 416L158 407L158 402L160 399L160 392L158 391L158 389L154 384L154 382L152 381L152 378L150 377L150 375L146 369L146 366L144 364L144 362L142 359L142 356L140 354L140 351L138 349L138 344L136 341L136 337L134 333L134 325L132 321L132 302L131 301L132 277L134 273L134 266L136 263L136 256L138 253L138 250L140 247L142 238L144 235L144 233L146 231L146 228L148 226L148 224L150 223L150 220L152 219L152 217L154 215L157 208L160 205L162 200L168 195L172 188L174 187L191 169L198 165L199 163L206 159L207 157L209 157L212 155L213 153L215 153L217 151L219 151L221 149L223 149L225 147L227 147L237 141L246 139L248 137L253 137L255 135L260 135L263 133L269 133L273 131L282 131L289 129L311 129L312 130L318 130L319 131L329 131L333 133L339 133L342 135L347 135L350 137L353 137L355 139L359 139L361 141L365 141L367 143L369 143L370 145L373 145L375 147L381 149L382 151L385 151L386 153L388 153L397 159L398 161L400 161L403 163L404 165L409 169Z']
};
function supIcon(kind, delay){
  var a = SUP_ART[kind];
  return '<span class="sup-ic" style="--d:-' + delay + 's"><svg viewBox="0 0 600 600" aria-hidden="true"><path d="' + a[0] + '" fill="url(#' + (kind === 'tg' ? 'supTg' : 'supWa') + ')"/><path d="' + a[1] + '" fill="#fff" fill-rule="evenodd"/></svg></span>';
}
function supportRow(url, icon, label){
  return '<button class="menu-item" style="margin:0 0 10px;width:100%" data-open-url="' + esc(url) + '"><div class="menu-ic sup">' + icon + '</div><div class="menu-lbl">' + esc(label) + '</div>' + ICON_CHEV + '</button>';
}
function renderStaticPages(){
  var s = getSettings();
  // Terms & Rules: written by the admin, empty until set.
  $('rulesBody').innerHTML = s.rulesText ? nl2p(s.rulesText) : '<div class="empty">Nothing published yet.</div>';
  // Support: every configured destination gets its own row with the real brand icon.
  var rows = '';
  var links = [
    [s.telegramChannel, 'tg', 'Telegram Channel'], [s.telegramGroup, 'tg', 'Telegram Group'], [s.supportTelegram, 'tg', 'Telegram Support'],
    [s.whatsappGroup, 'wa', 'WhatsApp Group'], [s.whatsappContact, 'wa', 'WhatsApp Support']
  ], n = 0;
  links.forEach(function(l){ if (safeUrl(l[0])) rows += supportRow(safeUrl(l[0]), supIcon(l[1], (n++ * 0.55).toFixed(2)), l[2]); });
  if (!rows) rows += '<div class="empty">Contact details are not set up yet.</div>';
  rows += '<div class="kv" style="margin:0 20px"><span>Support hours</span><b>' + esc(s.supportHours || '8am – 9pm') + '</b></div>';
  $('supportLinks').innerHTML = rows;
}
/* CHATCRYPTO BEGIN (the same text in the member app and in the admin panel; test-chat-e2e.js compares the two copies) */
var CHAT = (function(){
  var enc = new TextEncoder(), dec = new TextDecoder(), S = crypto.subtle, EC = { name: 'ECDH', namedCurve: 'P-256' };
  function b64(buf){ var a = new Uint8Array(buf), s = ''; for (var i = 0; i < a.length; i += 8192) s += String.fromCharCode.apply(null, a.subarray(i, i + 8192)); return btoa(s); }
  function unb64(t){ var s = atob(t), a = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }
  function pubOf(j){ return { kty: 'EC', crv: 'P-256', x: j.x, y: j.y }; }
  async function kidOf(jwk){
    var h = new Uint8Array(await S.digest('SHA-256', enc.encode(jwk.x + '.' + jwk.y))), out = '';
    for (var i = 0; i < 8; i++) out += ('0' + h[i].toString(16)).slice(-2);
    return out;
  }
  // A key pair: kid names it, pub is shared with the server, priv stays on this device.
  async function newPair(){
    var kp = await S.generateKey(EC, true, ['deriveBits']), pub = pubOf(await S.exportKey('jwk', kp.publicKey)), priv = await S.exportKey('jwk', kp.privateKey);
    return { kid: await kidOf(pub), pub: pub, priv: priv };
  }
  // The key that locks one message's own key: the ECDH secret of (private, public), stretched with HKDF.
  async function wrapKey(privKey, pubJwk){
    var bits = await S.deriveBits({ name: 'ECDH', public: await S.importKey('jwk', pubOf(pubJwk), EC, false, []) }, privKey, 256);
    var base = await S.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
    return S.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode('smartai-chat-v1') }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  // Encrypts text for every recipient ([{kid, jwk}]); ad (thread|from|profile) is bound into the ciphertext so a message cannot be moved to another conversation.
  async function seal(text, ad, recipients){
    var k = await S.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']), iv = crypto.getRandomValues(new Uint8Array(12));
    var ct = await S.encrypt({ name: 'AES-GCM', iv: iv, additionalData: enc.encode(ad) }, k, enc.encode(text)), raw = await S.exportKey('raw', k), wraps = [];
    for (var i = 0; i < recipients.length; i++) {
      var eph = await S.generateKey(EC, true, ['deriveBits']), wk = await wrapKey(eph.privateKey, recipients[i].jwk), wiv = crypto.getRandomValues(new Uint8Array(12));
      var ek = await S.encrypt({ name: 'AES-GCM', iv: wiv }, wk, raw), epk = pubOf(await S.exportKey('jwk', eph.publicKey));
      wraps.push({ kid: recipients[i].kid, epk: { x: epk.x, y: epk.y }, iv: b64(wiv), ek: b64(ek) });
    }
    return { iv: b64(iv), ct: b64(ct), wraps: wraps };
  }
  // Opens a message with this device's private key (kid names it); null when the message was not locked for this key.
  async function open(msg, ad, kid, privJwk){
    var w = null; for (var i = 0; i < msg.wraps.length; i++) if (msg.wraps[i].kid === kid) w = msg.wraps[i];
    if (!w) return null;
    var wk = await wrapKey(await S.importKey('jwk', privJwk, EC, false, ['deriveBits']), w.epk);
    var raw = await S.decrypt({ name: 'AES-GCM', iv: unb64(w.iv) }, wk, unb64(w.ek)), k = await S.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
    return dec.decode(await S.decrypt({ name: 'AES-GCM', iv: unb64(msg.iv), additionalData: enc.encode(ad) }, k, unb64(msg.ct)));
  }
  // PICTURES. A picture is locked with its OWN key; that key travels inside the encrypted message, and the server keeps only the locked bytes.
  async function sealBlob(bytes){
    var k = await S.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']), iv = crypto.getRandomValues(new Uint8Array(12));
    var ct = new Uint8Array(await S.encrypt({ name: 'AES-GCM', iv: iv }, k, bytes));
    return { ct: ct, key: b64(await S.exportKey('raw', k)), iv: b64(iv) };
  }
  async function openBlob(ct, keyB64, ivB64){
    var k = await S.importKey('raw', unb64(keyB64), 'AES-GCM', false, ['decrypt']);
    return new Uint8Array(await S.decrypt({ name: 'AES-GCM', iv: unb64(ivB64) }, k, ct));
  }
  function loadImage(file){
    return new Promise(function(ok, no){
      var url = URL.createObjectURL(file), im = new Image();
      im.onload = function(){ URL.revokeObjectURL(url); ok(im); };
      im.onerror = function(){ URL.revokeObjectURL(url); no(new Error('That file is not a picture')); };
      im.src = url;
    });
  }
  function canvasBlob(cv, type, q){ return new Promise(function(ok){ cv.toBlob(ok, type, q); }); }
  // Makes a picture SMALL before it leaves the phone: the long side at most 1280 px, WebP (JPEG where the browser cannot make WebP) and under about 230 KB, plus a tiny
  // 32 px preview that sits inside the message and shows (blurred) the instant the chat opens, before the picture itself has arrived.
  async function shrink(file){
    var im = await loadImage(file), W = im.naturalWidth, H = im.naturalHeight;
    if (!W || !H) throw new Error('That file is not a picture');
    var best = null, side = 1280;
    for (var pass = 0; pass < 4; pass++) {
      var sc = Math.min(1, side / Math.max(W, H)), w = Math.max(1, Math.round(W * sc)), h = Math.max(1, Math.round(H * sc));
      var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      var g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(im, 0, 0, w, h);
      var q = 0.76 - pass * 0.09, mime = 'image/webp', blob = await canvasBlob(cv, mime, q);
      if (!blob || blob.type !== 'image/webp') { mime = 'image/jpeg'; blob = await canvasBlob(cv, mime, q); }
      best = { blob: blob, w: w, h: h, mime: mime };
      if (blob.size <= 230000) break;
      side = Math.round(side * 0.78);
    }
    var tw = W >= H ? 32 : Math.max(8, Math.round(32 * W / H)), th = H > W ? 32 : Math.max(8, Math.round(32 * H / W));
    var tc = document.createElement('canvas'); tc.width = tw; tc.height = th; tc.getContext('2d').drawImage(im, 0, 0, tw, th);
    return { bytes: new Uint8Array(await best.blob.arrayBuffer()), w: best.w, h: best.h, mime: best.mime, thumb: tc.toDataURL('image/jpeg', 0.5) };
  }
  return { newPair: newPair, kidOf: kidOf, seal: seal, open: open, b64: b64, unb64: unb64, sealBlob: sealBlob, openBlob: openBlob, shrink: shrink };
})();
/* CHATCRYPTO END */

/* ====================== CUSTOMER SERVICE CHAT (end-to-end encrypted) ======================
   The Support page lists the customer-service profiles the admin set up (a photo and a name each). Tapping one opens a chat with it. Every message is locked on this phone
   (see CHAT above) for the admin panel and for this phone only; the server just carries it. Ticks: one = sent, two = delivered (the panel was online after it), blue = read.
   FAST: a chat opens at once from this phone's own copy of the (still locked) messages and then asks the server only for what is newer; a profile is warmed up the moment it
   is pressed; pictures are shrunk before they leave the phone, locked, and shown as a blurred preview (inside the message) until the picture itself arrives. */
var _cc = { cfg: null, cfgAt: 0, key: null, regFor: '', agent: null, msgs: [], after: 0, seq: 0, looping: false, adminReadAt: 0, adminSeenAt: 0, online: false, unread: {}, sig: '', busy: false,
  typing: false, typingT: null, typeSent: 0, tsig: 'null', imgs: {}, warm: {}, saveT: null };
function chatInitial(n){ var t = String(n || '').trim(); return esc(t ? t.charAt(0).toUpperCase() : '?'); }
function chatPhoto(a){ return a && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+\/]+=*$/.test(a.photo || '') ? a.photo : ''; }
function chatAvatar(a){ var p = chatPhoto(a); return p ? '<img src="' + p + '" alt="">' : '<span class="ch-ini">' + chatInitial(a && a.name) + '</span>'; }
async function chatLoadConfig(force){
  if (!force && _cc.cfg && Date.now() - _cc.cfgAt < 20000) { paintChatAgents(); return; }
  var r = await api('/public/chat-config', null, 'GET', false);
  if (r && r.status === 'success' && Array.isArray(r.agents)) { _cc.cfg = r; _cc.cfgAt = Date.now(); _cc.online = !!r.online; }
  paintChatAgents();
}
// The row of profiles under the support hours: photo, a green dot while someone is online, a red count of unread replies, the name underneath.
function paintChatAgents(){
  var box = $('supAgents'); if (!box) return;
  var ag = (_cc.cfg && _cc.cfg.agents) || [];
  if (!ag.length) { box.innerHTML = ''; return; }
  var on = !!(_cc.cfg && _cc.cfg.online);
  box.innerHTML = ag.map(function(a){
    var n = Number(_cc.unread[a.id]) || 0;
    return '<button type="button" class="sup-ag" data-ag="' + esc(a.id) + '"><span class="sup-ag-pic">' + chatAvatar(a) + '<i class="sup-ag-dot' + (on ? ' on' : '') + '"></i>' + (n ? '<b class="sup-ag-n">' + (n > 9 ? '9+' : n) + '</b>' : '') + '</span><span class="sup-ag-name">' + esc(a.name) + '</span></button>';
  }).join('');
}
async function chatSummary(){
  if (!STATE) return null;
  var r = await api('/chat/summary', null, 'GET', false);
  if (!r || r.stale || r.status !== 'success') return null;
  _cc.unread = r.unread || {};
  if (!_cc.seq) _cc.seq = r.seq;
  if (_cc.cfg) _cc.cfg.online = !!r.online;
  if (typeof r.restricted === 'boolean') chatSetRestricted(r.restricted);
  paintChatAgents();
  return r;
}
function chatSupportOpen(){
  chatLoadConfig(true).then(chatSummary);
  chatLoop();
}
// This phone's key pair, made once and kept on the phone; its public half is registered so the admin panel can lock replies for it.
async function chatKey(){
  if (_cc.key && _cc.key.uid === STATE.uid) return _cc.key;
  var k = null, name = 'sa_chat_' + STATE.uid;
  try { k = JSON.parse(localStorage.getItem(name) || 'null'); } catch (e) {}
  if (!k || !k.kid || !k.priv || !k.pub) {
    var p = await CHAT.newPair(); k = { kid: p.kid, pub: p.pub, priv: p.priv };
    try { localStorage.setItem(name, JSON.stringify(k)); } catch (e) {}
  }
  k.uid = STATE.uid; _cc.key = k; return k;
}
async function chatRegister(){
  var k = await chatKey(), tag = STATE.uid + ':' + k.kid;
  if (_cc.regFor === tag) return true;
  var r = await api('/chat/key', { kid: k.kid, jwk: k.pub });
  if (r && r.status === 'success') { _cc.regFor = tag; return true; }
  return false;
}
// ---- this phone's own copy of the conversation: the messages exactly as the server holds them (LOCKED), opened with this phone's key on every start ----
function chatCacheName(ag){ return 'sa_chatc_' + STATE.uid + '_' + ag; }
function chatCacheRead(ag){
  try { var c = JSON.parse(localStorage.getItem(chatCacheName(ag)) || 'null'); return c && Array.isArray(c.m) ? c : { m: [], rd: 0, sn: 0 }; } catch (e) { return { m: [], rd: 0, sn: 0 }; }
}
function chatCacheWrite(ag, c){ try { localStorage.setItem(chatCacheName(ag), JSON.stringify(c)); } catch (e) {} }
function chatCacheSoon(){
  clearTimeout(_cc.saveT);
  _cc.saveT = setTimeout(function(){
    var ag = _cc.agent; if (!ag || !STATE) return;
    chatCacheWrite(ag.id, { m: _cc.msgs.filter(function(x){ return x.raw && !x.pending; }).slice(-60).map(function(x){ return x.raw; }), rd: _cc.adminReadAt, sn: _cc.adminSeenAt });
  }, 400);
}
function chatTick(st){
  if (st === 'pend') return '<svg class="cm-tk" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 5v3.3l2 1.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
  var one = '<path d="M2.5 8.6l3.2 3.2L12.6 4.6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>';
  var two = '<path d="M1.2 8.6l3.2 3.2L11 4.6M7.2 11.2l.6.6L14.8 4.6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>';
  return '<svg class="cm-tk' + (st === 'read' ? ' rd' : '') + '" viewBox="0 0 16 16" aria-hidden="true">' + (st === 'sent' ? one : two) + '</svg>';
}
function chatDay(ms){
  var d = new Date(ms), t = new Date(), y = new Date(Date.now() - 86400000);
  if (d.toDateString() === t.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
// A picture inside a bubble: its own shape from the start (so nothing jumps), the blurred 32 px preview behind it, the picture itself once it has arrived.
var CHAT_THUMB = /^data:image\/(jpeg|webp|png);base64,[A-Za-z0-9+\/]+=*$/;
function chatImgHtml(m){
  var i = m.img, got = _cc.imgs[i.id], url = (got && got.url) || i.local || '';
  var w = Math.max(1, Number(i.w) || 4), h = Math.max(1, Number(i.h) || 3), th = CHAT_THUMB.test(i.th || '') ? i.th : '';
  return '<div class="cm-img' + (url ? ' ready' : '') + '" style="aspect-ratio:' + w + ' / ' + h + (th ? ';background-image:url(' + th + ')' : '') + '" data-bid="' + esc(i.id || '') + '">' + (url ? '<img src="' + url + '" alt="">' : '') + (m.pending ? '<i class="cm-spin"></i>' : '') + '</div>';
}
// The list is UPDATED, not rebuilt: a message that has not changed keeps its very element (so a picture never blinks, and nothing scrolls by itself); only a changed
// tick / time is rewritten inside it, and only a message whose own content changed is replaced. Day labels and the typing dots are items of the same list.
function chatPatch(box, items){
  var old = {}, c = box.firstChild, n;
  while (c) { old[c.getAttribute('data-k')] = c; c = c.nextSibling; }
  var prev = null;
  items.forEach(function(it){
    n = old[it.key]; delete old[it.key];
    if (n && n.getAttribute('data-s') !== it.sig) { var fresh = chatNode(it); box.replaceChild(fresh, n); n = fresh; }
    else if (!n) n = chatNode(it);
    else {
      var tm = n.querySelector('.cm-t');
      if (tm && it.meta != null && n.getAttribute('data-m') !== it.meta) { tm.innerHTML = it.meta; n.setAttribute('data-m', it.meta); }
    }
    var want = prev ? prev.nextSibling : box.firstChild;
    if (n !== want) box.insertBefore(n, want);
    prev = n;
  });
  for (var k in old) if (old.hasOwnProperty(k) && old[k].parentNode === box) box.removeChild(old[k]);
}
function chatNode(it){
  var w = document.createElement('div'); w.innerHTML = it.html;
  var n = w.firstChild; n.setAttribute('data-k', it.key); n.setAttribute('data-s', it.sig); if (it.meta != null) n.setAttribute('data-m', it.meta);
  return n;
}
function chatRender(stick){
  var box = $('chatList'), body = $('chatBody'); if (!box) return;
  var near = body.scrollHeight - body.scrollTop - body.clientHeight < 90, items = [], last = '';
  _cc.msgs.forEach(function(m){
    var day = chatDay(m.at); if (day !== last) { items.push({ key: 'd:' + day, sig: day, html: '<div class="cm-day"><span>' + esc(day) + '</span></div>' }); last = day; }
    var me = m.from === 'member', st = m.pending ? 'pend' : (m.at <= _cc.adminReadAt ? 'read' : (m.at <= _cc.adminSeenAt ? 'dlv' : 'sent'));
    var hm = new Date(m.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }), meta = hm + (me ? chatTick(st) : '');
    var lock = m.text == null && !m.img && !m.voice;
    var inner = lock ? 'This message cannot be opened on this phone.' : ((m.img ? chatImgHtml(m) : '') + (m.voice ? chatVoiceHtml(m) : '') + (m.text ? '<div class="cm-tx">' + esc(m.text) + '</div>' : ''));
    // what the message IS (not what has been fetched for it): a picture arriving does not change this, so its element stays
    var sig = (me ? 'm' : 'a') + '|' + (lock ? 'L' : '') + '|' + (m.text || '') + '|' + (m.img ? m.img.id + m.img.w + 'x' + m.img.h + (m.img.th ? m.img.th.length : 0) : '') + '|' + (m.voice ? m.voice.id + ':' + m.voice.d : '') + '|' + (m.pending ? 'p' : '');
    items.push({ key: 'm:' + m.id, sig: sig, meta: meta, html: '<div class="cm ' + (me ? 'me' : 'ag') + '"><div class="cm-b' + (lock ? ' cm-lock' : '') + (m.img ? ' has-img' : '') + (m.voice ? ' has-vn' : '') + '">' + inner + '<span class="cm-t">' + meta + '</span></div></div>' });
  });
  if (_cc.typing) items.push({ key: 'typing', sig: 't', html: '<div class="cm ag"><div class="cm-b cm-typ" aria-label="typing"><i></i><i></i><i></i></div></div>' });
  chatPatch(box, items);
  if (stick || near) body.scrollTop = body.scrollHeight;
  chatLoadImages();
}
// Customer service can turn off a member's sending (they still read replies): the bar then says so instead of the text box.
var CHAT_LOCK_RE = /turned off sending messages/;
function chatPaintLock(){ var bar = $('chatBar'); if (bar) bar.classList.toggle('restricted', !!_cc.restricted); }
function chatSetRestricted(on){
  on = !!on; if (_cc.restricted === on) return;
  _cc.restricted = on; chatPaintLock();
  if (on) chatVnStop(true);
}
function chatErr(e, dflt){ var m = e && e.message ? e.message : dflt; if (CHAT_LOCK_RE.test(m)) chatSetRestricted(true); return m; }
function chatState(){
  var el = $('chatState'); if (!el) return;
  el.textContent = _cc.typing ? 'typing…' : (_cc.online ? 'Online' : 'Offline');
  el.className = _cc.typing || _cc.online ? 'on' : '';
}
// "typing…": shown while the panel says so, and gone 5.5 s after the last word from it (or the moment its message arrives).
function chatSetTyping(on){
  clearTimeout(_cc.typingT); _cc.typingT = null;
  var was = _cc.typing; _cc.typing = !!on;
  if (on) _cc.typingT = setTimeout(function(){ chatSetTyping(false); }, 5500);
  if (was !== _cc.typing) { chatState(); if (chatShown('ovChat')) chatRender(false); }
}
function chatTypingPing(){
  var inp = $('chatInput'), ag = _cc.agent; if (!inp || !ag || !STATE || !inp.value.trim()) return;
  if (Date.now() - _cc.typeSent < 2500) return;
  _cc.typeSent = Date.now(); api('/chat/typing', { agentId: ag.id, typing: true });
}
// A message as the phone shows it: its words and, when it carries one, the picture's details.
async function chatOpenMsg(m){
  var k = await chatKey();
  try {
    var pt = await CHAT.open(m, STATE.uid + '|' + m.from + '|' + m.agentId, k.kid, k.priv);
    if (pt == null) return { text: null, img: null, voice: null };
    var o = JSON.parse(pt) || {}, i = o.i && typeof o.i === 'object' && /^[0-9a-f]{24}$/.test(String(o.i.id || '')) ? { id: o.i.id, k: String(o.i.k || ''), v: String(o.i.v || ''), w: Number(o.i.w) || 0, h: Number(o.i.h) || 0, m: String(o.i.m || 'image/webp'), th: String(o.i.th || '') } : null;
    var a = o.a && typeof o.a === 'object' && /^[0-9a-f]{24}$/.test(String(o.a.id || '')) ? { id: o.a.id, k: String(o.a.k || ''), v: String(o.a.v || ''), d: Math.min(300, Math.max(0, Number(o.a.d) || 0)), m: /^audio\/(webm|ogg|mp4|mpeg|aac)$/.test(String(o.a.m || '')) ? o.a.m : 'audio/webm' } : null;
    return { text: String(o.t || ''), img: i, voice: a };
  } catch (e) { return { text: null, img: null, voice: null }; }
}
function chatOwn(m, k){ return { id: m.id, from: m.from, agentId: m.agentId, at: m.at, iv: m.iv, ct: m.ct, wraps: (m.wraps || []).filter(function(w){ return w.kid === k.kid; }) }; }
async function chatAdd(m, k){
  if (_cc.msgs.some(function(x){ return x.id === m.id; })) return false;
  var o = await chatOpenMsg(m);
  _cc.msgs.push({ id: m.id, from: m.from, text: o.text, img: o.img, voice: o.voice, at: m.at, raw: chatOwn(m, k) });
  return true;
}
// Loads the conversation (everything on opening it; afterwards only what is newer than the last message seen).
async function chatPoll(){
  var ag = _cc.agent; if (!ag || !STATE) return;
  var k = await chatKey();
  var r = await api('/chat/history?agentId=' + encodeURIComponent(ag.id) + '&after=' + _cc.after + '&kid=' + k.kid, null, 'GET', false);
  if (!r || r.stale || r.status !== 'success' || _cc.agent !== ag) return;
  var fresh = false, gotAdmin = false;
  var opened = await Promise.all(r.messages.map(function(m){ return _cc.msgs.some(function(x){ return x.id === m.id; }) ? null : chatOpenMsg(m); }));
  for (var i = 0; i < r.messages.length; i++) {
    var m = r.messages[i];
    _cc.after = Math.max(_cc.after, m.at);
    if (!opened[i] || _cc.msgs.some(function(x){ return x.id === m.id; })) continue;
    _cc.msgs.push({ id: m.id, from: m.from, text: opened[i].text, img: opened[i].img, voice: opened[i].voice, at: m.at, raw: chatOwn(m, k) }); fresh = true; if (m.from === 'admin') gotAdmin = true;
  }
  _cc.msgs.sort(function(a, b){ return a.at - b.at || (a.id < b.id ? -1 : 1); });
  var sig = r.adminReadAt + '|' + r.adminSeenAt + '|' + r.online + '|' + _cc.msgs.length;
  _cc.adminReadAt = Math.max(_cc.adminReadAt, r.adminReadAt); _cc.adminSeenAt = Math.max(_cc.adminSeenAt, r.adminSeenAt); _cc.online = r.online; chatState(); chatSetRestricted(r.restricted);
  if (fresh || sig !== _cc.sig) { _cc.sig = sig; chatRender(fresh); chatCacheSoon(); }
  if (gotAdmin) api('/chat/read', { agentId: ag.id });
}
function chatShown(id){ var el = $(id); return !!el && el.classList.contains('show'); }
function chatSleep(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }
// LIVE DELIVERY. While Support or a chat is open, ONE request to the server stays open; the server answers it the instant something happens for this member (the reply
// itself, the chat being read, the panel typing or coming online), the answer is applied on the spot and the request is made again. No timer, nothing fetched twice.
async function chatLoop(){
  if (_cc.looping) return;
  _cc.looping = true;
  var fails = 0;
  try {
    while (STATE && (chatShown('ovChat') || chatShown('ovSupport'))) {
      if (document.hidden) { await chatSleep(800); continue; }
      var me = STATE.uid;
      if (!_cc.seq) { await chatSummary(); if (!_cc.seq) { fails++; await chatSleep(Math.min(6000, 700 * fails)); } continue; }
      var r = await api('/chat/wait?seq=' + _cc.seq + '&ts=' + encodeURIComponent(_cc.tsig), null, 'GET', false);
      if (!STATE || STATE.uid !== me) break;
      if (!r || r.stale || r.status !== 'success') { fails++; await chatSleep(Math.min(6000, 700 * fails)); continue; }
      fails = 0; _cc.seq = r.seq; _cc.tsig = JSON.stringify(r.typing === undefined ? null : r.typing);
      if (r.reset) { await chatResync(); continue; }
      await chatApply(r);
    }
  } finally { _cc.looping = false; }
}
async function chatResync(){
  await Promise.all([chatLoadConfig(true), chatSummary(), _cc.agent ? chatPoll() : null]);
}
async function chatApply(r){
  var redraw = false, fresh = false, unreadChanged = false, open = !!_cc.agent && chatShown('ovChat'), k = await chatKey();
  if (r.online !== undefined) { if (_cc.online !== r.online) { _cc.online = r.online; chatState(); } if (_cc.cfg) _cc.cfg.online = r.online; unreadChanged = true; }
  if (r.adminSeenAt > _cc.adminSeenAt) { _cc.adminSeenAt = r.adminSeenAt; redraw = true; }
  for (var i = 0; i < r.events.length; i++) {
    var e = r.events[i];
    if (e.kind === 'adminRead') { if (e.at > _cc.adminReadAt) { _cc.adminReadAt = e.at; redraw = true; } }
    else if (e.kind === 'msg' && e.msg && e.msg.from === 'admin') {
      var m = e.msg;
      if (open && m.agentId === _cc.agent.id) {
        _cc.after = Math.max(_cc.after, m.at);
        if (await chatAdd(m, k)) { _cc.msgs.sort(function(a, b){ return a.at - b.at || (a.id < b.id ? -1 : 1); }); redraw = fresh = true; api('/chat/read', { agentId: m.agentId }); chatSetTyping(false); }
      } else { _cc.unread[m.agentId] = (Number(_cc.unread[m.agentId]) || 0) + 1; unreadChanged = true; }
    }
  }
  if (typeof r.restricted === 'boolean') chatSetRestricted(r.restricted);
  if (r.typing !== undefined) chatSetTyping(!!(r.typing && open && _cc.agent && r.typing.agentId === _cc.agent.id));
  if (redraw && open) { _cc.sig = ''; chatRender(fresh); chatCacheSoon(); }
  if (unreadChanged && chatShown('ovSupport')) paintChatAgents();
}
// ---- pictures: fetched, opened with the key inside the message, shown; newest first, three at a time, each only once ----
async function chatToken(){
  var user = window.fbAuth && window.fbAuth.currentUser, tok = '';
  if (user) { try { tok = await user.getIdToken(); } catch (e) {} }
  return tok;
}
async function chatFetchImage(i){
  var got = _cc.imgs[i.id];
  if (got && got.url) return got.url;
  if (got && got.p) return got.p;
  var p = (async function(){
    var tok = await chatToken();
    var resp = await fetch(API_BASE + '/chat/blob/' + i.id, { headers: { 'Authorization': 'Bearer ' + tok }, cache: 'force-cache' });
    if (!resp.ok) throw new Error('missing');
    var plain = await CHAT.openBlob(new Uint8Array(await resp.arrayBuffer()), i.k, i.v);
    var url = URL.createObjectURL(new Blob([plain], { type: /^(image\/(webp|jpeg|png)|audio\/(webm|ogg|mp4|mpeg|aac))$/.test(i.m) ? i.m : 'image/webp' }));
    _cc.imgs[i.id] = { url: url }; return url;
  })();
  _cc.imgs[i.id] = { p: p };
  p.catch(function(){ if (_cc.imgs[i.id] && _cc.imgs[i.id].p === p) delete _cc.imgs[i.id]; });
  return p;
}
function chatPaintImage(id, url){
  var els = document.querySelectorAll('#chatList .cm-img[data-bid="' + id + '"]');
  for (var n = 0; n < els.length; n++) if (!els[n].querySelector('img')) { var im = document.createElement('img'); im.alt = ''; im.src = url; im.className = 'fresh'; els[n].appendChild(im); els[n].classList.add('ready'); }
}
async function chatLoadImages(){
  var todo = _cc.msgs.filter(function(m){ return m.img && m.img.k && !(_cc.imgs[m.img.id] && _cc.imgs[m.img.id].url) && !m.pending; }).reverse(), slots = 3;
  async function worker(){
    while (todo.length) {
      var m = todo.shift();
      try { var url = await chatFetchImage(m.img); chatPaintImage(m.img.id, url); } catch (e) {}
    }
  }
  var ws = []; for (var w = 0; w < slots; w++) ws.push(worker());
  await Promise.all(ws);
}
// A picture opened full screen takes one history entry of its own, so the phone's Back button closes the picture (and only the picture); a tap on it closes it the same way.
var _vwOpen = false, _vwSkip = false;
function chatViewer(url){
  var v = $('chatViewer'); if (!v || !url) return;
  v.innerHTML = '<img src="' + url + '" alt="">'; v.classList.add('show');
  if (!_vwOpen) { _vwOpen = true; try { history.pushState({ vw: 1 }, ''); } catch (e) {} }
}
function chatViewerClose(fromBack){
  var v = $('chatViewer'); if (v) { v.classList.remove('show'); v.innerHTML = ''; }
  if (_vwOpen) { _vwOpen = false; if (!fromBack) { _vwSkip = true; try { history.back(); } catch (e) { _vwSkip = false; } } }
}
async function chatUpload(bytes){
  var tok = await chatToken(), ctl = new AbortController(), timer = setTimeout(function(){ ctl.abort(); }, 60000);
  try {
    var resp = await fetch(API_BASE + '/chat/blob', { method: 'POST', headers: { 'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/octet-stream' }, body: bytes, signal: ctl.signal });
    var d = await resp.json();
    if (!d || d.status !== 'success') throw new Error((d && d.message) || 'Could not send the picture.');
    return d;
  } finally { clearTimeout(timer); }
}
async function chatSendImage(file){
  var inp = $('chatInput'), ag = _cc.agent;
  if (!file || !ag || !STATE || _cc.busy) return;
  if (!/^image\//.test(file.type || '')) { toast('Choose a picture.'); return; }
  if (!_cc.cfg || !_cc.cfg.adminKey) { toast('Chat is not available yet.'); return; }
  var caption = (inp.value || '').trim().slice(0, 300), local = URL.createObjectURL(file);
  var tmp = { id: 'tmp' + Date.now(), from: 'member', text: caption, at: Date.now(), pending: true, img: { id: 'tmp', w: 0, h: 0, th: '', local: local } };
  _cc.busy = true; inp.value = ''; chatGrow(); _cc.msgs.push(tmp); chatRender(true);
  try {
    var sh = await CHAT.shrink(file);
    tmp.img.w = sh.w; tmp.img.h = sh.h; tmp.img.th = sh.thumb; chatRender(false);
    var sealed = await CHAT.sealBlob(sh.bytes), k = await chatKey();
    var results = await Promise.all([chatUpload(sealed.ct), chatRegister()]);
    var up = results[0];
    var info = { id: up.id, k: sealed.key, v: sealed.iv, w: sh.w, h: sh.h, m: sh.mime, th: sh.thumb };
    var env = await CHAT.seal(JSON.stringify({ t: caption, i: info }), STATE.uid + '|member|' + ag.id, [{ kid: _cc.cfg.adminKey.kid, jwk: _cc.cfg.adminKey.jwk }, { kid: k.kid, jwk: k.pub }]);
    env.agentId = ag.id;
    var r = await api('/chat/send', env);
    if (!r || r.status !== 'success') throw new Error((r && r.message) || 'Could not send. Try again.');
    _cc.imgs[up.id] = { url: local };   // our own picture is already here: nothing to download
    _cc.msgs = _cc.msgs.filter(function(x){ return x !== tmp; });
    if (!_cc.msgs.some(function(x){ return x.id === r.id; })) _cc.msgs.push({ id: r.id, from: 'member', text: caption, img: info, at: r.at, raw: { id: r.id, from: 'member', agentId: ag.id, at: r.at, iv: env.iv, ct: env.ct, wraps: env.wraps.filter(function(w){ return w.kid === k.kid; }) } });
    _cc.after = Math.max(_cc.after, r.at - 1);
    if (r.delivered) _cc.adminSeenAt = Math.max(_cc.adminSeenAt, r.at);
  } catch (e) {
    _cc.msgs = _cc.msgs.filter(function(x){ return x !== tmp; }); inp.value = caption; chatGrow();
    toast(chatErr(e, 'Could not send the picture.'));
  } finally { _cc.busy = false; }
  _cc.sig = ''; _cc.typeSent = 0; chatRender(true); chatCacheSoon();
}
// ===== VOICE NOTES =====
// Recorded on the phone (small: about 24 kbit/s, two minutes at most), locked with its own key exactly like a picture, and stored by the server only as locked bytes.
// The key, length and type travel inside the encrypted message ({ a: { id, k, v, d, m } }).
var CHAT_VN_MAX = 120, _vn = { rec: null, chunks: [], t0: 0, timer: 0, stream: null, cancel: false, ag: null, mime: '' }, _vp = { id: '', el: null };
function chatVnMime(){
  if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return '';
  var l = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm'];
  for (var n = 0; n < l.length; n++) if (MediaRecorder.isTypeSupported(l[n])) return l[n];
  return '';
}
function chatVnFmt(s){ s = Math.max(0, Math.round(Number(s) || 0)); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }
async function chatVnStart(){
  if (_vn.rec || _cc.busy || _cc.restricted || !_cc.agent || !STATE) return;
  if (!_cc.cfg || !_cc.cfg.adminKey) { toast('Chat is not available yet.'); return; }
  var mime = chatVnMime();
  if (!mime || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast('This phone cannot record a voice note.'); return; }
  var stream, rec;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
  catch (e) { var nm = e && e.name; toast(nm === 'NotFoundError' ? 'No microphone was found on this phone.' : (nm === 'NotReadableError' ? 'The microphone is being used by another app.' : 'Allow the microphone for this app (phone settings > Permissions) to send a voice note.')); return; }
  if (_vn.rec || !_cc.agent) { stream.getTracks().forEach(function(t){ t.stop(); }); return; }
  try { rec = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 24000 }); }
  catch (e) { stream.getTracks().forEach(function(t){ t.stop(); }); toast('This phone cannot record a voice note.'); return; }
  chatVoiceStop();
  _vn.chunks = []; _vn.cancel = false; _vn.stream = stream; _vn.rec = rec; _vn.t0 = Date.now(); _vn.ag = _cc.agent; _vn.mime = mime;
  rec.ondataavailable = function(ev){ if (ev.data && ev.data.size) _vn.chunks.push(ev.data); };
  rec.onstop = chatVnDone;
  rec.start(1000);
  var bar = $('chatBar'); if (bar) bar.classList.add('recording');
  var tt = $('chatRecT'); if (tt) tt.textContent = '0:00';
  _vn.timer = setInterval(function(){
    var s = (Date.now() - _vn.t0) / 1000, el = $('chatRecT'); if (el) el.textContent = chatVnFmt(s);
    if (s >= CHAT_VN_MAX) chatVnStop(false);
  }, 250);
}
function chatVnStop(cancel){
  if (!_vn.rec) return;
  _vn.cancel = !!cancel;
  try { if (_vn.rec.state !== 'inactive') _vn.rec.stop(); else chatVnDone(); } catch (e) { chatVnDone(); }
}
function chatVnDone(){
  clearInterval(_vn.timer);
  if (_vn.stream) _vn.stream.getTracks().forEach(function(t){ t.stop(); });
  var bar = $('chatBar'); if (bar) bar.classList.remove('recording');
  var rec = _vn.rec, cancel = _vn.cancel, secs = (Date.now() - _vn.t0) / 1000, mt = String(_vn.mime || '').split(';')[0], ag = _vn.ag, blob = new Blob(_vn.chunks, { type: mt });
  _vn.rec = null; _vn.stream = null; _vn.chunks = [];
  if (!rec || cancel || !ag) return;
  if (secs < 1 || blob.size < 200) { toast('Hold on a little longer to record a voice note.'); return; }
  chatSendVoice(blob, Math.min(CHAT_VN_MAX, Math.round(secs)), mt, ag);
}
async function chatSendVoice(blob, secs, mt, ag){
  if (!STATE || _cc.busy || _cc.agent !== ag) return;
  if (blob.size > 560 * 1024) { toast('That voice note is too long. Keep it shorter.'); return; }
  var local = URL.createObjectURL(blob);
  var tmp = { id: 'tmp' + Date.now(), from: 'member', text: '', at: Date.now(), pending: true, voice: { id: 'tmp', d: secs, m: mt, local: local } };
  _cc.busy = true; _cc.msgs.push(tmp); chatRender(true);
  try {
    var bytes = new Uint8Array(await blob.arrayBuffer()), sealed = await CHAT.sealBlob(bytes), k = await chatKey();
    var results = await Promise.all([chatUpload(sealed.ct), chatRegister()]), up = results[0];
    var info = { id: up.id, k: sealed.key, v: sealed.iv, d: secs, m: mt };
    var env = await CHAT.seal(JSON.stringify({ t: '', a: info }), STATE.uid + '|member|' + ag.id, [{ kid: _cc.cfg.adminKey.kid, jwk: _cc.cfg.adminKey.jwk }, { kid: k.kid, jwk: k.pub }]);
    env.agentId = ag.id;
    var r = await api('/chat/send', env);
    if (!r || r.status !== 'success') throw new Error((r && r.message) || 'Could not send. Try again.');
    _cc.imgs[up.id] = { url: local };   // our own voice note is already here: nothing to download
    _cc.msgs = _cc.msgs.filter(function(x){ return x !== tmp; });
    if (!_cc.msgs.some(function(x){ return x.id === r.id; })) _cc.msgs.push({ id: r.id, from: 'member', text: '', img: null, voice: info, at: r.at, raw: { id: r.id, from: 'member', agentId: ag.id, at: r.at, iv: env.iv, ct: env.ct, wraps: env.wraps.filter(function(w){ return w.kid === k.kid; }) } });
    _cc.after = Math.max(_cc.after, r.at - 1);
    if (r.delivered) _cc.adminSeenAt = Math.max(_cc.adminSeenAt, r.at);
  } catch (e) {
    _cc.msgs = _cc.msgs.filter(function(x){ return x !== tmp; });
    toast(chatErr(e, 'Could not send the voice note.'));
  } finally { _cc.busy = false; }
  _cc.sig = ''; chatRender(true); chatCacheSoon();
}
var CHAT_PLAY = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M8 5.2v13.6a1 1 0 0 0 1.5.86l11-6.8a1 1 0 0 0 0-1.72l-11-6.8A1 1 0 0 0 8 5.2z" fill="currentColor"/></svg>',
    CHAT_PAUSE = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><rect x="6.5" y="5" width="4" height="14" rx="1.3" fill="currentColor"/><rect x="13.5" y="5" width="4" height="14" rx="1.3" fill="currentColor"/></svg>';
function chatVoiceHtml(m){
  var v = m.voice, d = Math.max(0, Number(v.d) || 0);
  return '<div class="cm-vn' + (m.pending ? ' pend' : '') + '" data-vid="' + esc(v.id || '') + '" data-d="' + d + '"><button type="button" class="cm-vp" aria-label="Play voice note">' + CHAT_PLAY + '</button><span class="cm-vb"><i></i></span><span class="cm-vd">' + chatVnFmt(d) + '</span></div>';
}
function chatVoiceEls(id){ return document.querySelectorAll('#chatList .cm-vn[data-vid="' + id + '"]'); }
function chatVoiceDraw(id, state, frac, label){
  var els = chatVoiceEls(id);
  for (var n = 0; n < els.length; n++) {
    var b = els[n].querySelector('.cm-vp'), bar = els[n].querySelector('.cm-vb i'), lb = els[n].querySelector('.cm-vd');
    els[n].classList.toggle('playing', state === 'play'); els[n].classList.toggle('load', state === 'load');
    if (b) b.innerHTML = state === 'play' ? CHAT_PAUSE : CHAT_PLAY;
    if (bar) bar.style.width = Math.round(Math.max(0, Math.min(1, frac || 0)) * 1000) / 10 + '%';
    if (lb) lb.textContent = label;
  }
}
function chatVoiceStop(){
  if (!_vp.el) return;
  var id = _vp.id, el = _vp.el, d = 0; _vp = { id: '', el: null };
  try { el.pause(); } catch (e) {}
  var f = chatVoiceEls(id)[0]; if (f) d = Number(f.getAttribute('data-d')) || 0;
  chatVoiceDraw(id, 'idle', 0, chatVnFmt(d));
}
async function chatVoiceToggle(box){
  var id = box.getAttribute('data-vid'), d = Number(box.getAttribute('data-d')) || 0;
  if (!id || id === 'tmp' || box.classList.contains('pend')) return;
  if (_vp.el && _vp.id === id) { if (_vp.el.paused) _vp.el.play().catch(function(){}); else _vp.el.pause(); return; }
  var m = _cc.msgs.filter(function(x){ return x.voice && x.voice.id === id; })[0]; if (!m) return;
  chatVoiceStop(); chatVoiceDraw(id, 'load', 0, chatVnFmt(d));
  var url; try { url = await chatFetchImage(m.voice); } catch (e) { chatVoiceDraw(id, 'idle', 0, chatVnFmt(d)); toast('Could not open this voice note.'); return; }
  var el = new Audio(url); el.preload = 'auto'; _vp = { id: id, el: el };
  el.onplay = function(){ chatVoiceDraw(id, 'play', el.currentTime / (d || el.duration || 1), chatVnFmt(el.currentTime)); };
  el.onpause = function(){ if (_vp.el === el && !el.ended) chatVoiceDraw(id, 'idle', el.currentTime / (d || el.duration || 1), chatVnFmt(el.currentTime)); };
  el.ontimeupdate = function(){ if (_vp.el === el && !el.paused) chatVoiceDraw(id, 'play', el.currentTime / (d || el.duration || 1), chatVnFmt(el.currentTime)); };
  el.onended = function(){ if (_vp.el === el) _vp = { id: '', el: null }; chatVoiceDraw(id, 'idle', 0, chatVnFmt(d)); };
  el.onerror = function(){ if (_vp.el === el) _vp = { id: '', el: null }; chatVoiceDraw(id, 'idle', 0, chatVnFmt(d)); toast('Could not play this voice note.'); };
  el.play().catch(function(){ if (_vp.el === el) _vp = { id: '', el: null }; chatVoiceDraw(id, 'idle', 0, chatVnFmt(d)); });
}
// A profile pressed: its newest messages are fetched at once, in the background, so the page has them the instant it opens.
async function chatWarm(agentId){
  if (!STATE || (_cc.warm[agentId] && Date.now() - _cc.warm[agentId] < 4000)) return;
  _cc.warm[agentId] = Date.now();
  try {
    var k = await chatKey(), c = chatCacheRead(agentId), after = c.m.reduce(function(a, x){ return Math.max(a, x.at); }, 0);
    var r = await api('/chat/history?agentId=' + encodeURIComponent(agentId) + '&after=' + after + '&kid=' + k.kid, null, 'GET', false);
    if (!r || r.stale || r.status !== 'success' || !r.messages.length) return;
    var have = {}; c.m.forEach(function(x){ have[x.id] = 1; });
    r.messages.forEach(function(m){ if (!have[m.id]) c.m.push(chatOwn(m, k)); });
    c.m.sort(function(a, b){ return a.at - b.at; }); c.m = c.m.slice(-60); c.rd = Math.max(c.rd || 0, r.adminReadAt); c.sn = Math.max(c.sn || 0, r.adminSeenAt);
    chatCacheWrite(agentId, c);
  } catch (e) {}
}
async function chatOpen(agentId){
  if (!STATE) return;
  var a = ((_cc.cfg && _cc.cfg.agents) || []).filter(function(x){ return x.id === agentId; })[0];
  if (!a) return;
  _cc.agent = a; _cc.msgs = []; _cc.after = 0; _cc.sig = ''; _cc.adminReadAt = 0; _cc.adminSeenAt = 0; chatSetTyping(false); chatPaintLock();
  $('chatAv').innerHTML = chatAvatar(a); $('chatName').textContent = a.name; $('chatList').innerHTML = ''; $('chatInput').value = ''; chatGrow(); chatState();
  openOverlay('chat', true); chatFit(); chatLoop();
  // 1) at once, from this phone's own copy (opened with this phone's key; nothing waits for the network)
  try {
    var k = await chatKey(), c = chatCacheRead(a.id);
    if (_cc.agent === a && c.m.length) {
      var opened = await Promise.all(c.m.map(chatOpenMsg));
      c.m.forEach(function(m, n){ _cc.msgs.push({ id: m.id, from: m.from, text: opened[n].text, img: opened[n].img, voice: opened[n].voice, at: m.at, raw: m }); _cc.after = Math.max(_cc.after, m.at); });
      _cc.adminReadAt = c.rd || 0; _cc.adminSeenAt = c.sn || 0;
      if (_cc.agent === a) chatRender(true);
    }
  } catch (e) {}
  // 2) the server: only what is newer than that
  try { await Promise.all([chatLoadConfig(true), chatPoll()]); } catch (e) {}
  chatRegister();
  if (_cc.agent === a) { chatRender(true); api('/chat/read', { agentId: a.id }); delete _cc.unread[a.id]; }
}
function chatBack(){ chatVnStop(true); chatVoiceStop(); _cc.agent = null; chatSetTyping(false); openOverlay('support', true); }
function chatGrow(){ var t = $('chatInput'); if (!t) return; var bar = $('chatBar'); if (bar) bar.classList.toggle('empty', !t.value.trim()); t.style.height = 'auto'; var h = t.scrollHeight; t.style.height = h > 44 ? Math.min(h, 112) + 'px' : ''; }
// The page sits above the keyboard: it follows the visible part of the screen.
function chatFit(){
  var el = $('ovChat'), vv = window.visualViewport; if (!el) return;
  if (vv && el.classList.contains('show')) { el.style.height = vv.height + 'px'; el.style.top = vv.offsetTop + 'px'; el.style.bottom = 'auto'; }
  else { el.style.height = ''; el.style.top = ''; el.style.bottom = ''; }
  var b = $('chatBody'); if (b && el.classList.contains('show')) b.scrollTop = b.scrollHeight;
}
if (window.visualViewport) { window.visualViewport.addEventListener('resize', chatFit); window.visualViewport.addEventListener('scroll', chatFit); }
async function chatSend(){
  var inp = $('chatInput'), text = inp.value.trim();
  if (!text || _cc.busy || !_cc.agent || !STATE) return;
  if (!_cc.cfg || !_cc.cfg.adminKey) { toast('Chat is not available yet.'); return; }
  var ag = _cc.agent, tmp = { id: 'tmp' + Date.now(), from: 'member', text: text, at: Date.now(), pending: true };
  _cc.busy = true; inp.value = ''; chatGrow(); _cc.msgs.push(tmp); chatRender(true);
  try {
    var k = await chatKey();
    if (!(await chatRegister())) throw new Error('Could not send. Check your connection.');
    var env = await CHAT.seal(JSON.stringify({ t: text }), STATE.uid + '|member|' + ag.id, [{ kid: _cc.cfg.adminKey.kid, jwk: _cc.cfg.adminKey.jwk }, { kid: k.kid, jwk: k.pub }]);
    env.agentId = ag.id;
    var r = await api('/chat/send', env);
    if (!r || r.status !== 'success') throw new Error((r && r.message) || 'Could not send. Try again.');
    _cc.msgs = _cc.msgs.filter(function(x){ return x !== tmp; });
    if (!_cc.msgs.some(function(x){ return x.id === r.id; })) _cc.msgs.push({ id: r.id, from: 'member', text: text, img: null, at: r.at, raw: { id: r.id, from: 'member', agentId: ag.id, at: r.at, iv: env.iv, ct: env.ct, wraps: env.wraps.filter(function(w){ return w.kid === k.kid; }) } });
    _cc.after = Math.max(_cc.after, r.at - 1);
    if (r.delivered) _cc.adminSeenAt = Math.max(_cc.adminSeenAt, r.at);   // the panel is open: two ticks at once
  } catch (e) {
    _cc.msgs = _cc.msgs.filter(function(x){ return x !== tmp; }); inp.value = text; chatGrow();
    toast(chatErr(e, 'Could not send. Try again.'));
  } finally { _cc.busy = false; }
  _cc.sig = ''; _cc.typeSent = 0; chatRender(true); chatCacheSoon();
}
document.addEventListener('pointerdown', function(e){
  var b = e.target.closest && e.target.closest('.sup-ag');
  if (b) chatWarm(b.getAttribute('data-ag'));
});
document.addEventListener('click', function(e){
  var b = e.target.closest && e.target.closest('.sup-ag');
  if (b) { chatOpen(b.getAttribute('data-ag')); return; }
  var vp = e.target.closest && e.target.closest('#chatList .cm-vp');
  if (vp) { chatVoiceToggle(vp.closest('.cm-vn')); return; }
  var im = e.target.closest && e.target.closest('#chatList .cm-img.ready');
  if (im) { var pic = im.querySelector('img'); if (pic) chatViewer(pic.src); return; }
  if (e.target.closest && e.target.closest('#chatViewer')) chatViewerClose(false);
});
document.addEventListener('visibilitychange', function(){ if (!document.hidden && STATE && (chatShown('ovChat') || chatShown('ovSupport'))) { chatResync(); chatLoop(); } });
document.addEventListener('keydown', function(e){
  if (e.target && e.target.id === 'chatInput' && e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) { e.preventDefault(); chatSend(); }
});
document.addEventListener('input', function(e){ if (e.target && e.target.id === 'chatInput') { chatGrow(); chatTypingPing(); } });
document.addEventListener('change', function(e){ if (e.target && e.target.id === 'chatFile') { var f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) chatSendImage(f); } });

document.addEventListener('click', function(e){
  var el = e.target.closest && e.target.closest('[data-open-url]');
  if (el) { e.preventDefault(); openLink(el.getAttribute('data-open-url')); }
});
// About Us is the article the admin wrote (Admin > About), fetched when the page is opened. The server cleans it when it is saved and this function cleans it
// again before it is shown: no scripts, frames, forms, event handlers, javascript: links or styles that load things.
function cleanAboutHtml(html){
  var tpl = document.createElement('template');
  tpl.innerHTML = String(html || '');
  tpl.content.querySelectorAll('script,iframe,object,embed,link,meta,base,form,noscript,frame,frameset,applet,input,button,textarea,select').forEach(function(n){ n.remove(); });
  tpl.content.querySelectorAll('*').forEach(function(el){
    Array.prototype.slice.call(el.attributes).forEach(function(a){
      var n = a.name.toLowerCase(), v = String(a.value).replace(/[\s\u0000-\u001f]/g, '').toLowerCase();
      if (n.indexOf('on') === 0) el.removeAttribute(a.name);
      else if (['href', 'src', 'xlink:href', 'action', 'formaction', 'srcset', 'poster'].indexOf(n) !== -1 && /^(javascript|vbscript|data:text)/.test(v)) el.removeAttribute(a.name);
      else if (n === 'style' && /expression\(|javascript:|url\(\s*['"]?\s*(javascript|data:text)/i.test(a.value)) el.removeAttribute(a.name);
    });
    if (el.tagName === 'A') { el.setAttribute('rel', 'noopener noreferrer'); if (el.getAttribute('target')) el.setAttribute('target', '_blank'); }
    if (el.tagName === 'STYLE') el.textContent = String(el.textContent).replace(/@import[^;]*;?|expression\([^)]*\)|javascript:/gi, '');
  });
  return tpl.innerHTML;
}
var _aboutLoaded = false, _aboutShown = '';
// The first time the page is opened it waits behind the loader; after that it shows what it has at once and asks again quietly, so an edit made in the admin panel
// reaches a member who already has the app open (before, the first copy was kept until the app was reopened).
async function loadAbout(){
  var box = $('aboutBody');
  if (!_aboutLoaded) box.innerHTML = spinnerHtml();
  var r = await api('/public/about-content');
  if (r.stale) return;
  if (r.status !== 'success') { if (!_aboutLoaded) box.innerHTML = '<div class="empty">Could not load this page. Try again.</div>'; return; }
  _aboutLoaded = true;
  var html = r.html ? '<div class="about-html">' + cleanAboutHtml(r.html) + '</div>' : '<div class="empty">Nothing published yet.</div>';
  if (html !== _aboutShown) { _aboutShown = html; box.innerHTML = html; }
}

/* ====================== PARTICLE WAVE (the owner's recording, redone in code) ======================
   Measured off the recording: ONE wide sheet of glowing blue dots laid out on a regular grid on the ground and seen in true perspective (camera low, looking along it), so it fills
   the screen from edge to edge at every depth: about 8 dots across the near rows, spaced 8 times closer at the far end. The rows run slowly toward the viewer. The sheet moves like
   water: broad swells travel through it, the lines of dots sway sideways in S-curves, the far part curls up at both sides like a bowl, and a bright crest of crowded dots with fast
   little ripples rides far away and drifts from side to side. Near dots are big and soft blue, far dots tiny, the crest nearly white. Drawn on a canvas with glow pictures made once.
   makeParticleField(canvas, { horizon, scale, dim, alive }) gives { start, stop, running }; it stops by itself when alive() says no. dim (0..1, default 1) fades it behind words. */
function makeParticleField(cv, opt){
  opt = opt || {};
  var ctx = cv.getContext('2d'), raf = 0, t0 = 0, W = 0, H = 0, dpr = 1;
  function sprite(r, g, b){
    var s = document.createElement('canvas'); s.width = s.height = 48;
    var c = s.getContext('2d'), gr = c.createRadialGradient(24, 24, 0, 24, 24, 24), lr = Math.min(255, r + 70), lg = Math.min(255, g + 60), lb = Math.min(255, b + 20);
    gr.addColorStop(0, 'rgba(' + lr + ',' + lg + ',' + lb + ',1)'); gr.addColorStop(0.3, 'rgba(' + r + ',' + g + ',' + b + ',1)');
    gr.addColorStop(0.62, 'rgba(' + r + ',' + g + ',' + b + ',0.2)'); gr.addColorStop(1, 'rgba(' + r + ',' + g + ',' + b + ',0)');
    c.fillStyle = gr; c.fillRect(0, 0, 48, 48); return s;
  }
  var SP = [sprite(28, 105, 225), sprite(48, 128, 232), sprite(85, 160, 240), sprite(125, 190, 248)];
  function size(){
    var w = cv.clientWidth, h = cv.clientHeight, d = Math.min(window.devicePixelRatio || 1, 2);
    if (!w || !h) return false;
    if (w !== W || h !== H || d !== dpr) { W = w; H = h; dpr = d; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    return true;
  }
  function sm(a, b, x){ x = Math.max(0, Math.min(1, (x - a) / (b - a))); return x * x * (3 - 2 * x); }
  var ZN = 1, ZF = 5.5, CAMH = 1.2;     // nearest and farthest distance of the sheet, camera height (world units)
  function draw(t){
    if (!size()) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    var dim = opt.dim == null ? 1 : opt.dim, k = (opt.scale || 1) * Math.max(0.8, Math.min(1.5, W / 390));
    var y0 = H * (opt.horizon == null ? 0.16 : opt.horizon), fx = W * 0.9, fy = (H * 1.1 - y0) * ZN / CAMH, range = ZF - ZN;
    var DX = 1 / (fx / W * 6.5), DZ = Math.max(0.03, (W / 13) / (H * 1.1 - y0)), NR = Math.min(150, Math.ceil(range / DZ)), NC = Math.ceil((W / 2) * ZF / fx / DX) + 1;   // about 6 dots across the near rows, rows half as far apart as columns
    var zr = 4.4 + 0.25 * Math.sin(t * 0.22);                                          // where the bright crest is now (its distance); it runs evenly across the whole width
    var r, c;
    for (r = 0; r < NR; r++) {
      var z = ZN + (((r * DZ - t * 0.035) % range) + range) % range;
      var zn = (z - ZN) / range;                                                      // 0 near ... 1 far
      var fade = sm(0, 0.05, zn) * (1 - sm(0.94, 1, zn));
      if (fade < 0.01) continue;
      var big = 0.02 + 0.28 * sm(0.2, 0.95, zn);                                     // the swells grow toward the far hills
      var ridge = Math.exp(-Math.pow((z - zr) / 0.5, 2));
      var spr = zn < 0.3 ? SP[0] : (zn < 0.65 ? SP[1] : SP[2]);
      var base = 2.5 * k * Math.pow(ZN / z, 0.95);
      for (c = -NC; c <= NC; c++) {
        var x = c * DX;
        x += 0.14 * Math.sin(1.1 * z + 0.7 * t + 0.35 * x) * (0.25 + zn);                // the lines sway sideways in S-curves
        var h = big * (Math.sin(0.8 * x + 1.2 * z - 1.0 * t) + 0.2 * Math.sin(1.6 * x - 0.8 * z + 0.7 * t));
        h += 0.03 * x * x * sm(0.2, 1, zn);                                           // the far sides curl up like a bowl
        var rw = ridge;
        h += rw * (0.09 + 0.06 * Math.sin(1.2 * x - 0.9 * t));               // the crest, with quick little ripples along it
        var px = W / 2 + fx * x / z, py = y0 + fy * (CAMH - h) / z;
        if (px < -12 || px > W + 12 || py < -12 || py > H + 12) continue;
        var a = fade * dim * 0.72 * (0.7 + 0.25 * zn + 0.4 * rw) * (0.84 + 0.16 * Math.sin(t * 1.7 + c * 1.3 + r * 0.7));
        if (a < 0.03) continue;
        var rad = Math.max(0.6 * k, base) * (1 + 0.15 * rw);
        ctx.globalAlpha = Math.min(1, a);
        if (rad < 1.3) { ctx.fillStyle = rw > 0.35 ? '#a9d6ff' : '#5a9ee8'; ctx.fillRect(px - rad, py - rad, rad * 2, rad * 2); }
        else { var R = rad * 2.6; ctx.drawImage(rw > 0.45 ? SP[3] : spr, px - R, py - R, R * 2, R * 2); }
      }
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }
  function frame(now){
    raf = 0;
    if (!document.body.contains(cv) || (opt.alive && !opt.alive())) return;
    draw((now - t0) / 1000);
    raf = requestAnimationFrame(frame);
  }
  return {
    start: function(){
      if (raf) cancelAnimationFrame(raf);
      t0 = performance.now() - 2500 * Math.random();
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) { draw(3); raf = 0; return; }
      raf = requestAnimationFrame(frame);
    },
    stop: function(){ if (raf) cancelAnimationFrame(raf); raf = 0; },
    running: function(){ return !!raf; },
    at: function(t){ draw(t); }     // draws one picture at time t (seconds); used by the tests
  };
}
var _annField = null, _scrollLocked = false, _lockY = 0;
// While any popup is open the page behind it cannot be scrolled (the body is pinned where it was and put back when the last popup closes).
function syncScrollLock(){
  var open = !!document.querySelector('.modal-bg.show');
  if (open === _scrollLocked || !document.body) return;
  _scrollLocked = open;
  if (open) { _lockY = window.pageYOffset || 0; document.body.style.top = (-_lockY) + 'px'; document.body.classList.add('scroll-locked'); }
  else { document.body.classList.remove('scroll-locked'); document.body.style.top = ''; window.scrollTo(0, _lockY); }
}
var _pfField = null;
// The particle field behind EVERY page (Admin switch pageParticles): body.pf-on turns the dark backdrop on; while a full page (overlay) is open the app underneath is hidden so the field shows through.
function syncPageParticles(){
  var on = !!getSettings().pageParticles, b = document.body;
  if (!b) return;
  b.classList.toggle('pf-on', on); document.documentElement.classList.toggle('pf-on', on);   // the page edge shows the same dark colour when you pull past the end
  if (on) {
    if (!_pfField) _pfField = makeParticleField($('pfBg'), { horizon: 0.14, dim: 0.85, alive: function(){ return document.body.classList.contains('pf-on') && !document.hidden; } });
    if (!_pfField.running()) _pfField.start();
  } else if (_pfField) _pfField.stop();
  syncOvOpen();
}
function syncOvOpen(){ var open = !!document.querySelector('.overlay.show'); if (document.body.classList.contains('ov-open') !== open) document.body.classList.toggle('ov-open', open); }
document.addEventListener('visibilitychange', function(){ if (!document.hidden && document.body.classList.contains('pf-on') && _pfField && !_pfField.running()) _pfField.start(); });
new MutationObserver(function(){ syncScrollLock(); syncOvOpen(); }).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['class'] });
/* ====================== ANNOUNCEMENT (the welcome dialog, ChocoMCC's) ======================
   Shown on every app open and every time Home is entered from another tab, while Admin > Settings > Announcement dialog is switched on and has text. A title, the body text,
   an optional picture on top (Admin > Banners > Welcome announcement; without one the small gift badge shows), then the WhatsApp Group and Telegram Group buttons (Settings > Support). */
function nl2pTight(text){
  var paras = String(text || '').split(/\n\s*\n/).filter(function(p){ return p.trim(); });
  if (!paras.length) return '';
  return paras.map(function(p){ return '<p class="ann-p">' + annEmojiHtml(esc(p).replace(/\n/g, '<br>')) + '</p>'; }).join('');
}
var WA_ICON_IMG = 'data:image/png;base64,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';
// Animated emojis in the welcome dialog's words (Admin > Banners > Welcome announcement): the owner types :fire: (or :bangs: :alert: :warning: :boom: :tick: :robot:) in the title or
// the text and the app draws that little animated picture right there, like a normal emoji. Each is a sprite sheet /anim/emoji<n>.webp (176 px pictures, 10 to a row); one small
// timer moves every emoji in the dialog together and stops by itself when the dialog closes.
var ANN_EMOJI_NAMES = { bangs: 1, alert: 2, warning: 3, fire: 4, boom: 5, tick: 6, robot: 7 };
var ANN_EMOJI = { 1: { rows: 6, n: 60, ms: 50, still: 2 }, 2: { rows: 6, n: 60, ms: 50, still: 0 }, 3: { rows: 6, n: 60, ms: 50, still: 0 }, 4: { rows: 6, n: 60, ms: 50, still: 0 },
  5: { rows: 6, n: 60, ms: 49.7, still: 57 }, 6: { rows: 6, n: 60, ms: 50, still: 10 }, 7: { rows: 5, n: 43, ms: 50.4, still: 0 } };
var ANN_EMOJI_PX = 26, _annEmojiImgs = {}, _annEmojiRaf = 0, _annEmojiT0 = 0, _annEmojiEls = null;
var ANN_EMOJI_RE = /:(bangs|alert|warning|fire|boom|tick|robot):/g;
function annEmojiPos(m, k){ return (-(k % 10) * ANN_EMOJI_PX) + 'px ' + (-Math.floor(k / 10) * ANN_EMOJI_PX) + 'px'; }
// Already-escaped text in, the same text with each :name: replaced by its emoji out.
function annEmojiHtml(escaped){
  return escaped.replace(ANN_EMOJI_RE, function(all, name){
    var n = ANN_EMOJI_NAMES[name], m = ANN_EMOJI[n];
    return '<span class="emo-i" role="img" aria-label="' + name + '" data-e="' + n + '" style="background-image:url(/anim/emoji' + n + '.webp);background-size:' + (ANN_EMOJI_PX * 10) + 'px '
      + (ANN_EMOJI_PX * m.rows) + 'px;background-position:' + annEmojiPos(m, m.still) + '"></span>';
  });
}
function preloadAnnEmoji(text){
  String(text || '').replace(ANN_EMOJI_RE, function(all, name){
    var n = ANN_EMOJI_NAMES[name];
    if (!_annEmojiImgs[n]) { var im = new Image(); im.src = '/anim/emoji' + n + '.webp'; _annEmojiImgs[n] = im; }
    return all;
  });
}
function annEmojiFrame(){
  _annEmojiRaf = 0;
  var bg = $('announcementBg');
  if (!_annEmojiEls || !bg || !bg.classList.contains('show')) return;
  var now = Date.now();
  _annEmojiEls.forEach(function(el){
    var m = ANN_EMOJI[el.getAttribute('data-e')];
    el.style.backgroundPosition = annEmojiPos(m, Math.floor((now - _annEmojiT0) / m.ms) % m.n);
  });
  _annEmojiRaf = requestAnimationFrame(annEmojiFrame);
}
function startAnnEmoji(){
  if (_annEmojiRaf) { cancelAnimationFrame(_annEmojiRaf); _annEmojiRaf = 0; }
  _annEmojiEls = [].slice.call(document.querySelectorAll('#announcementBg .emo-i'));
  if (!_annEmojiEls.length) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  _annEmojiT0 = Date.now();
  _annEmojiRaf = requestAnimationFrame(annEmojiFrame);
}
async function maybeShowAnnouncement(immediateShake){
  var ls = $('loadingScreen');
  if (ls && ls.style.display !== 'none') { _annAfterLoader = true; return; }
  if (!STATE) return;
  if (_artPromise) { try { await Promise.race([_artPromise, new Promise(function(r){ setTimeout(r, 2500); })]); } catch (e) {} }
  var s = getSettings();
  if (!STATE || !s.annEnabled || !s.annBody) return;
  if (document.querySelector('.overlay.show, .modal-bg.show')) return;
  $('annTitle').innerHTML = annEmojiHtml(esc(s.annTitle || 'Notice'));
  $('annBody').innerHTML = nl2pTight(s.annBody);
  var img = $('annImg'), badge = $('annBadge');
  if (ART.announcement) { img.src = ART.announcement; img.style.display = 'block'; badge.style.display = 'none'; }
  else { img.style.display = 'none'; badge.style.display = 'flex'; }
  var btns = '';
  if (safeUrl(s.whatsappGroup)) btns += '<button class="wa-pill" data-open-url="' + esc(safeUrl(s.whatsappGroup)) + '"><img src="' + WA_ICON_IMG + '" alt="">WhatsApp Group</button>';
  if (safeUrl(s.telegramGroup)) btns += '<button class="tg-pill" data-open-url="' + esc(safeUrl(s.telegramGroup)) + '">' + TG_ICON_WHITE + 'Telegram Group</button>';
  var tgRow = $('annTgRow');
  tgRow.innerHTML = btns;
  tgRow.style.display = btns ? 'flex' : 'none';
  $('annDivider').style.display = btns ? 'block' : 'none';
  // The owner's guide (Admin > Banners > Guide PDF): its button sits under the text and the group buttons.
  var gRow = $('annGuideRow'), gOn = s.guideOn === true && Number(s.guideVer) > 0;
  if (gRow) { gRow.style.display = gOn ? 'block' : 'none'; if (gOn) $('annGuideBtn').innerHTML = GUIDE_DL_ICON + '<span>Download ' + esc(brandName()) + ' guide PDF</span>'; }
  if (immediateShake) tgRow.querySelectorAll('.tg-pill,.wa-pill').forEach(function(el){ el.style.animationDelay = '-2.4s, -2.4s'; });
  $('announcementBg').classList.add('show');
  if (!_annField) _annField = makeParticleField($('annFx'), { horizon: 0.1, dim: 0.5, alive: function(){ return $('announcementBg').classList.contains('show'); } });
  _annField.start();
  startAnnEmoji();
}
document.addEventListener('keydown', function(e){ if (e.key === 'Escape' && $('announcementBg') && $('announcementBg').classList.contains('show')) dismissAnnouncement(); });
var GUIDE_DL_ICON = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.7V14.6M6.9 10.2L12 15.1L17.1 10.2"/><path d="M3.1 14.5V18.4Q3.1 20.8 5.5 20.8H18.5Q20.9 20.8 20.9 18.4V14.5"/></svg>';   // the owner's download icon: arrow into an open tray
function dismissAnnouncement(){ $('announcementBg').classList.remove('show'); }

/* ====================== GUIDE PDF (the button on the welcome dialog) ======================
   The owner's guide (a title and blocks: heading / text / picture / new page, written in Admin > Banners > Guide PDF) is fetched when the member taps "Download guide PDF" and the PDF is
   written HERE on the phone: no library (the app loads no outside scripts), A4 portrait, Helvetica and Helvetica-Bold, wrapped text, bullets, JPEG pictures stored as they are
   (DCTDecode), page numbers. Text goes out as Latin-1 (WinAnsi): accents are kept, emoji and symbols the font cannot draw are dropped. */
var GPDF_W_REG = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
var GPDF_W_BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];
function gpdfClean(s){
  return String(s == null ? '' : s).replace(/[\u2013\u2014]/g, '-').replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/\u2026/g, '...').replace(/[\u2022\u00b7\u25cf]/g, '-')
    .replace(/\u00a0/g, ' ').replace(/\t/g, '    ').replace(/[^\n\x20-\x7e\xa1-\xff]/g, '');
}
function gpdfW(s, size, bold){ var w = bold ? GPDF_W_BOLD : GPDF_W_REG, t = 0; for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); t += c >= 32 && c <= 126 ? w[c - 32] : 556; } return t * size / 1000; }
function gpdfWrap(text, size, bold, maxW){
  var out = [], paras = gpdfClean(text).split('\n');
  paras.forEach(function(p){
    if (!p.trim()) { out.push(''); return; }
    var lead = '', m = /^(\s*(?:-|\*|\d+[.)])\s+)/.exec(p);
    var indent = 0; if (m) { lead = m[1].replace(/\s+$/, '') + ' '; p = p.slice(m[1].length); indent = gpdfW(lead, size, bold); }
    var words = p.split(/\s+/).filter(Boolean), line = '', first = true;
    words.forEach(function(w){
      while (gpdfW(w, size, bold) > maxW - (first ? 0 : indent)) { var cut = w.length - 1; while (cut > 1 && gpdfW(w.slice(0, cut), size, bold) > maxW - (first ? 0 : indent)) cut--; if (line) { out.push({ s: line, lead: first ? lead : '', ind: first ? 0 : indent }); line = ''; first = false; } out.push({ s: w.slice(0, cut), lead: first ? lead : '', ind: first ? 0 : indent }); first = false; w = w.slice(cut); }
      var tryLine = line ? line + ' ' + w : w;
      if (line && gpdfW(tryLine, size, bold) > maxW - (first ? indent : indent)) { out.push({ s: line, lead: first ? lead : '', ind: first ? 0 : indent }); first = false; line = w; } else line = tryLine;
    });
    out.push({ s: line, lead: first ? lead : '', ind: first ? 0 : indent });
  });
  return out;
}
function gpdfJpegInfo(b64){
  var bin = atob(b64), n = bin.length, bytes = new Uint8Array(n);
  for (var i = 0; i < n; i++) bytes[i] = bin.charCodeAt(i);
  var p = 2, w = 0, h = 0, comps = 3;
  while (p + 9 < n) {
    if (bytes[p] !== 0xFF) { p++; continue; }
    var mk = bytes[p + 1];
    if (mk >= 0xC0 && mk <= 0xCF && mk !== 0xC4 && mk !== 0xC8 && mk !== 0xCC) { h = bytes[p + 5] * 256 + bytes[p + 6]; w = bytes[p + 7] * 256 + bytes[p + 8]; comps = bytes[p + 9]; break; }
    p += 2 + (bytes[p + 2] * 256 + bytes[p + 3]);
  }
  return { bytes: bytes, w: w, h: h, comps: comps };
}
// doc = { title, blocks: [{t:'h'|'p'|'img'|'pb', text, image(data URL), caption}] }  ->  Uint8Array of the PDF file
function buildGuidePdf(doc, appName){
  var W = 595, H = 842, M = 48, CW = W - 2 * M, BOTTOM = H - 56;
  var pages = [], cur = null, y = 0, images = [];
  var num = function(n){ return (Math.round(n * 100) / 100).toString(); };
  var esc = function(s){ return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)'); };
  function newPage(){ cur = { ops: [], imgs: [] }; pages.push(cur); y = M; }
  function text(x, top, str, size, bold, col){ if (!str) return; col = col || [0.1, 0.12, 0.2]; cur.ops.push('BT /' + (bold ? 'F2' : 'F1') + ' ' + num(size) + ' Tf ' + num(col[0]) + ' ' + num(col[1]) + ' ' + num(col[2]) + ' rg ' + num(x) + ' ' + num(H - top - size * 0.85) + ' Td (' + esc(str) + ') Tj ET'); }
  function rule(top, col, width){ cur.ops.push(num(col[0]) + ' ' + num(col[1]) + ' ' + num(col[2]) + ' RG ' + num(width) + ' w ' + num(M) + ' ' + num(H - top) + ' m ' + num(M + CW) + ' ' + num(H - top) + ' l S'); }
  function need(h){ if (y + h > BOTTOM) newPage(); }
  newPage();
  var title = gpdfClean(doc.title || '').trim() || (gpdfClean(appName) + ' guide');
  gpdfWrap(title, 26, true, CW).forEach(function(l){ if (l === '') return; text(M, y, l.s, 26, true, [0.05, 0.25, 0.65]); y += 32; });
  rule(y + 2, [0.16, 0.45, 0.9], 2.5); y += 22;
  (doc.blocks || []).forEach(function(b){
    if (b.t === 'pb') { newPage(); return; }
    if (b.t === 'h') {
      var hl = gpdfWrap(b.text, 16, true, CW).filter(function(l){ return l !== ''; });
      need(hl.length * 21 + 22); y += 10;
      hl.forEach(function(l){ text(M, y, l.s, 16, true, [0.05, 0.2, 0.55]); y += 21; });
      y += 4;
    } else if (b.t === 'p') {
      var lines = gpdfWrap(b.text, 11, false, CW);
      lines.forEach(function(l){
        if (l === '') { y += 7; return; }
        need(16);
        if (l.lead) text(M, y, l.lead, 11, false); text(M + (l.lead ? gpdfW(l.lead, 11, false) : l.ind), y, l.s, 11, false);
        y += 15.5;
      });
      y += 6;
    } else if (b.t === 'img') {
      var m = /^data:image\/jpeg;base64,(.+)$/.exec(String(b.image || '')); if (!m) return;
      var info = gpdfJpegInfo(m[1]); if (!info.w || !info.h) return;
      var iw = Math.min(CW, info.w * 0.75), ih = iw * info.h / info.w, maxH = BOTTOM - M - 30;
      if (ih > maxH) { ih = maxH; iw = ih * info.w / info.h; }
      var cap = gpdfClean(b.caption || '').replace(/\n/g, ' ').trim();
      need(ih + (cap ? 24 : 12));
      images.push(info); var idx = images.length - 1; cur.imgs.push(idx);
      cur.ops.push('q ' + num(iw) + ' 0 0 ' + num(ih) + ' ' + num(M + (CW - iw) / 2) + ' ' + num(H - y - ih) + ' cm /Im' + idx + ' Do Q');
      y += ih + 6;
      if (cap) { var cw = gpdfW(cap, 9, false); text(M + Math.max(0, (CW - cw) / 2), y, cap, 9, false, [0.4, 0.43, 0.5]); y += 15; }
      y += 8;
    }
  });
  pages.forEach(function(pg, i){ var label = gpdfClean(appName) + '   -   Page ' + (i + 1) + ' of ' + pages.length; var cur0 = cur; cur = pg; text(M + (CW - gpdfW(label, 9, false)) / 2, H - 34, label, 9, false, [0.45, 0.48, 0.55]); cur = cur0; });
  // ---- the file
  var chunks = [], offsets = [], len = 0;
  var enc = function(s){ var u = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 255; return u; };
  var put = function(u){ if (typeof u === 'string') u = enc(u); chunks.push(u); len += u.length; };
  var nImg = images.length, firstPage = 5 + nImg;
  var objs = [];   // each entry: a string, or { dict, data }
  objs.push('<< /Type /Catalog /Pages 2 0 R >>');
  objs.push('<< /Type /Pages /Kids [' + pages.map(function(_, i){ return (firstPage + i * 2) + ' 0 R'; }).join(' ') + '] /Count ' + pages.length + ' >>');
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  images.forEach(function(im){ objs.push({ dict: '<< /Type /XObject /Subtype /Image /Width ' + im.w + ' /Height ' + im.h + ' /ColorSpace ' + (im.comps === 1 ? '/DeviceGray' : im.comps === 4 ? '/DeviceCMYK' : '/DeviceRGB') + ' /BitsPerComponent 8 /Filter /DCTDecode /Length ' + im.bytes.length + ' >>', data: im.bytes }); });
  pages.forEach(function(pg, i){
    var xo = pg.imgs.length ? ' /XObject << ' + pg.imgs.map(function(k){ return '/Im' + k + ' ' + (5 + k) + ' 0 R'; }).join(' ') + ' >>' : '';
    var stream = pg.ops.join('\n');
    objs.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + W + ' ' + H + '] /Resources << /Font << /F1 3 0 R /F2 4 0 R >>' + xo + ' >> /Contents ' + (firstPage + i * 2 + 1) + ' 0 R >>');
    objs.push('<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream');
  });
  objs.push('<< /Title (' + esc(title) + ') /Producer (' + esc(gpdfClean(appName)) + ') >>');
  put('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
  objs.forEach(function(o, i){
    offsets.push(len);
    if (typeof o === 'string') put((i + 1) + ' 0 obj\n' + o + '\nendobj\n');
    else { put((i + 1) + ' 0 obj\n' + o.dict + '\nstream\n'); put(o.data); put('\nendstream\nendobj\n'); }
  });
  var xref = len;
  put('xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n');
  offsets.forEach(function(o){ put(String(o).padStart(10, '0') + ' 00000 n \n'); });
  put('trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R /Info ' + objs.length + ' 0 R >>\nstartxref\n' + xref + '\n%%EOF');
  var out = new Uint8Array(len), at = 0; chunks.forEach(function(c){ out.set(c, at); at += c.length; });
  return out;
}
var _guideDoc = null, _guideBusy = false;
async function downloadGuide(btn){
  if (_guideBusy) return;
  _guideBusy = true;
  var label = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = btnBusyHtml('Preparing the guide…'); }
  try {
    var gs = getSettings(), ver = Number(gs.guideVer) || 0, blob, fileName = (brandName() + ' guide.pdf');
    if (Number(gs.guidePdfVer) > 0) {
      // The owner uploaded a finished PDF in the admin: it is saved exactly as it is.
      var resp = await fetch(API_BASE + '/public/guide.pdf?v=' + Number(gs.guidePdfVer), { cache: 'no-store' });
      if (!resp.ok) { toast('The guide is not available right now'); return; }
      blob = await resp.blob();
      if (!blob.size) { toast('The guide is not available right now'); return; }
      blob = new Blob([blob], { type: 'application/pdf' });
      if (gs.guidePdfName) fileName = String(gs.guidePdfName);
    } else {
      if (!_guideDoc || _guideDoc.ver !== ver) {
        var r = await api('/public/guide');
        if (r.stale) return;
        if (r.status !== 'success' || !r.blocks) { toast(r.message || 'The guide is not available right now'); return; }
        _guideDoc = r;
      }
      blob = new Blob([buildGuidePdf(_guideDoc, brandName())], { type: 'application/pdf' });
    }
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = fileName.replace(/[^A-Za-z0-9._ -]/g, '').replace(/\s+/g, '-'); a.style.display = 'none';
    document.body.appendChild(a); a.click();
    setTimeout(function(){ document.body.removeChild(a); URL.revokeObjectURL(url); }, 4000);
    toast('Guide downloaded');
  } catch (e) { toast('Could not make the guide. Try again'); }
  finally { _guideBusy = false; if (btn) { btn.disabled = false; btn.innerHTML = label; } }
}

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
// The Me-screen tile is hidden once the app is installed.
function updateDownloadTileVisibility(){
  var tile = $('downloadAppTile');
  if (!tile) return;
  tile.style.display = isStandalone() ? 'none' : 'flex';
}
function openInstallSheet(){
  var stepsEl = $('installManualSteps'), btn = $('installNowBtn');
  if (isStandalone()) { stepsEl.style.display = 'none'; btn.style.display = 'none'; }   // already installed: nothing to install
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
// The link a new member is sent to: the admin's choice (Settings > Support contacts), or with 'auto' the first one that is set: WhatsApp group, Telegram group, Telegram channel.
function signupJoinUrl(){
  var s = getSettings(), pick = String(s.signupJoin || 'auto');
  if (pick === 'off') return '';
  var order = pick === 'auto' ? ['whatsappGroup', 'telegramGroup', 'telegramChannel'] : [pick];
  for (var i = 0; i < order.length; i++) { var u = safeUrl(s[order[i]]); if (u) return u; }
  return '';
}
// Goes there by moving this page itself (a new window opened after the sign-up's waiting would be blocked by the browser); a moment is given to read the welcome first.
function sendToCommunity(url){
  toast('Taking you to our community…');
  setTimeout(function(){ try { window.location.href = url; } catch (e) { window.open(url, '_blank'); } }, 1100);
}
function maybeOfferInstallAfterSignup(){
  if (isStandalone()) return;
  try { if (STATE && STATE.uid && localStorage.getItem('smartai_install_dismissed_' + STATE.uid)) return; } catch (e) {}
  // After the welcome picture (if there is one) has been seen, and not if the member has already signed out.
  setTimeout(function(){ if (STATE && _appEntered && !document.querySelector('.modal-bg.show')) openInstallSheet(); }, 4000);
}

/* ====================== SMALL DIALOGS ======================
   Closing every small sheet at once (sign-out, the phone's Back button). */
function closeAllSheets(){
  ['networkPickerBg', 'installSheetBg', 'announcementBg'].forEach(function(id){ var el = $(id); if (el) el.classList.remove('show'); });
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
// Me page picture: the owner's own opacity (0-100) and blur (0-40 px), from Admin > Settings. A little zoom hides the soft edges blur leaves.
function paintMeLook(){
  var mb = $('accountBanner'), mp = mb && mb.querySelector('img.art-photo');
  if (!mp) return;
  var sett = getSettings(), mo = Number(sett.myBannerOpacity), mbl = Number(sett.myBannerBlur);
  mo = isFinite(mo) ? Math.max(0, Math.min(100, mo)) : 100; mbl = isFinite(mbl) ? Math.max(0, Math.min(40, mbl)) : 0;
  mp.style.opacity = String(mo / 100);
  mp.style.filter = mbl > 0 ? 'blur(' + mbl + 'px)' : '';
  mp.style.transform = mbl > 0 ? 'scale(' + (1 + mbl / 100).toFixed(3) + ')' : '';
}
function paintArt(){
  var sett = getSettings();
  var map = [
    ['depositBanner', ART.depositbanner, 'deposit'], ['withdrawBanner', ART.withdrawbanner, 'withdraw'], ['supportBanner', ART.supportbanner, 'support'],
    ['aboutBanner', ART.aboutbanner, 'about'], ['bindbankBanner', ART.bindbankbanner, 'payout'], ['shopBannerArt', ART.shopbanner, 'robots'],
    ['accountBanner', ART.mybanner, 'my'], ['recordsBanner', ART.recordsbanner, 'ledger'], ['teamBanner', ART.teambanner, 'teamnav'], ['shareBanner', ART.teambanner, 'share']
  ];
  map.forEach(function(m){ var el = $(m[0]); if (el) el.innerHTML = artHtml(m[1], m[2]); });
  paintMeLook();
  var hb = $('homeBanner');
  if (hb) {
    var t = (sett.homeBannerTitle || '').trim(), x = (sett.homeBannerText || '').trim();
    hb.innerHTML = artHtml(ART.home, 'robots') + ((t || x) ? ('<div class="pb-tint pb-text">' + (t ? '<b class="pb-tint-title">' + esc(t) + '</b>' : '') + (x ? '<span>' + esc(x) + '</span>' : '') + '</div>') : '');
  }
  var av = $('acctIcon'); if (av) av.innerHTML = profileIconHtml();
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
// The Me page balances count up from zero to their figure each time the page is shown (a tab tap, or coming back from a page opened from it), like Potato's;
// a figure that changes while the page is open (a deposit lands, an earning is paid) runs up from what it showed to the new amount.
function moneyCountUp(el, target, ms, from){
  if (!el) return;
  var f = Number(from) || 0, to = Number(target) || 0, token = (el._cu = (el._cu || 0) + 1);
  el._to = to; el.dataset.val = String(to);
  var whole = Math.round(to * 100) % 100 === 0;
  var done = function(){ fitMoney(el, ugx(el._to)); delete el.dataset.counting; };
  if (to === f || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) { done(); return; }
  el.dataset.counting = '1';
  fitMoney(el, ugx(to));   // the size for the final figure, so the text does not jump while it grows
  var t0 = performance.now();
  var step = function(now){
    if (el._cu !== token || !el.isConnected) return;
    var k = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - k, 3);
    if (k >= 1) { done(); return; }
    var v = f + (to - f) * e;
    el.textContent = ugx(whole ? Math.round(v) : Math.round(v * 100) / 100);
    requestAnimationFrame(step);
  };
  el.textContent = ugx(f);
  requestAnimationFrame(step);
}
function setMoney(el, target){
  if (!el) return;
  var to = Number(target) || 0;
  if (el.dataset.counting) { el._to = to; el.dataset.val = String(to); return; }
  if (el.dataset.val === undefined) { fitMoney(el, ugx(to)); el.dataset.val = String(to); return; }
  if (Number(el.dataset.val) !== to) moneyCountUp(el, to, 900, Number(el.dataset.val));
}
// Arriving on Me: both figures show 0 at once (under the page dots), then run up as soon as the dots have lifted.
function countMyBalances(){
  if (!STATE) return;
  var b = $('acctBalNum'), w = $('acctWitNum'), pairs = [[b, STATE.balance], [w, STATE.totalWithdrawn]];
  pairs.forEach(function(p){ var el = p[0]; if (!el) return; el._cu = (el._cu || 0) + 1; delete el.dataset.counting; fitMoney(el, ugx(0)); el.dataset.val = String(Number(p[1]) || 0); });
  afterVeil(function(){ if (STATE && _lastTab === 'account') pairs.forEach(function(p){ moneyCountUp(p[0], p[1], 1100, 0); }); });
}
function renderAll(){
  var s = STATE;
  if (!s) return;
  var sett = getSettings();
  paintArt();
  $('acctPhone').textContent = displayPhone(s.phone);
  setMoney($('acctBalNum'), s.balance);
  setMoney($('acctWitNum'), s.totalWithdrawn);
  $('teamLink').textContent = promoLink() || '—';
  $('teamL1').textContent = s.team.l1; $('teamL2').textContent = s.team.l2; $('teamL3').textContent = s.team.l3;
  $('teamComm').textContent = ugx(s.team.commission);
  $('commL1Pct').textContent = sett.commL1 + '%'; $('commL2Pct').textContent = sett.commL2 + '%'; $('commL3Pct').textContent = sett.commL3 + '%';
  renderLucky();
  paintVip(false);
  paintAgentMe();
  renderMeRows();
  renderFeatured(); renderTicker(); renderShop(); renderRecords();
}
// The Me page: the Download App tile follows whether the app is already installed.
function renderMeRows(){
  updateDownloadTileVisibility();
}
// The VIP bar under the number card: filled up to the member's level (VIP 0 = empty; the full bar is the highest VIP level the admin has set). animate = fill it from empty (the Me tab opening).
function paintVip(animate){
  var bar = $('vipBar'); if (!bar || !STATE) return;
  var vip = Math.max(0, Math.floor(Number(STATE.vip) || 0)), max = vip;
  for (var i = 0; i < PRODUCTS.length; i++) max = Math.max(max, Math.floor(Number(PRODUCTS[i].vip) || 0));
  if (max < 1) { bar.style.display = 'none'; return; }
  bar.style.display = '';
  $('vipBadge').textContent = 'VIP ' + vip;
  var tr = $('vipTrack'), fill = $('vipFill'), pct = Math.min(100, vip / max * 100);
  tr.setAttribute('aria-valuemax', String(max)); tr.setAttribute('aria-valuenow', String(vip));
  if (animate) { fill.style.transition = 'none'; fill.style.width = '0%'; void fill.offsetWidth; fill.style.transition = ''; }
  fill.style.width = pct.toFixed(2) + '%';
}

/* ====================== AGENT BADGES ======================
   Six live (animated) verified badges, one per agent level in the order the levels are listed (blue, red, gold, pink, black, green; a seventh level starts over at blue).
   Drawn as inline SVG and moved with SVG animation, so nothing is downloaded and nothing needs a script to keep running. */
var AGENT_BADGES = ['blue', 'red', 'gold', 'pink', 'black', 'green'], _bdgN = 0;
function bdgWave(a, phi, b, psi){   // a 10-lobed edge (a = lobe depth), pulled toward a rounded square by b
  var p = [], N = 80, R = 44;
  for (var i = 0; i < N; i++) { var t = i / N * Math.PI * 2, r = R * (1 + a * Math.cos(10 * t + phi) + b * Math.cos(4 * t + psi)); p.push((50 + r * Math.cos(t)).toFixed(2) + ',' + (50 + r * Math.sin(t)).toFixed(2)); }
  return 'M' + p.join('L') + 'Z';
}
// One looping animation: pts = [[seconds, value], ...] over a loop of D seconds; the first and last values hold to the loop's ends.
function bdgAnim(tag, attr, D, pts, extra){
  var p = pts.slice();
  if (p[0][0] > 0) p.unshift([0, p[0][1]]);
  if (p[p.length - 1][0] < D) p.push([D, p[p.length - 1][1]]);
  var kt = p.map(function(x){ return +(x[0] / D).toFixed(4); }).join(';'), vs = p.map(function(x){ return x[1]; }).join(';');
  var sp = []; for (var i = 1; i < p.length; i++) sp.push('.4 0 .2 1');
  return '<' + tag + ' attributeName="' + attr + '" ' + (extra || '') + ' values="' + vs + '" keyTimes="' + kt + '" calcMode="spline" keySplines="' + sp.join(';') + '" dur="' + D + 's" repeatCount="indefinite"/>';
}
function bdgShow(D, a, b, c, d){ return bdgAnim('animate', 'opacity', D, [[a, 0], [b, 1], [c, 1], [d, 0]]); }   // fades in from a to b, out from c to d
function bdgPlus(x, y, D, dot, on, off, gone){   // a + sign that starts as a dot and ends as four dots flying outwards; on = 0 means it is already showing when the loop begins
  var first = on <= 0;
  var c = '<g transform="translate(' + x + ' ' + y + ')"><circle r="1.6" fill="#fff" opacity="0">' + (first ? bdgAnim('animate', 'opacity', D, [[dot, 0], [dot + .03, 1]]) : bdgShow(D, dot, dot + .04, on - .04, on)) + '</circle>' +
    '<g opacity="' + (first ? 1 : 0) + '">' + (first ? bdgAnim('animate', 'opacity', D, [[0, 1], [off, 1], [off + .05, 0]]) + bdgAnim('animateTransform', 'transform', D, [[0, '1'], [off, '1'], [off + .05, '1.1']], 'type="scale"') :
      bdgShow(D, on - .06, on, off, off + .05) + bdgAnim('animateTransform', 'transform', D, [[on - .06, '.3'], [on, '1'], [off, '1'], [off + .05, '1.1']], 'type="scale"')) +
    '<rect x="-1.7" y="-8" width="3.4" height="16" rx="1.7" fill="#fff"/><rect x="-8" y="-1.7" width="16" height="3.4" rx="1.7" fill="#fff"/></g>' +
    '<g opacity="0">' + bdgShow(D, off, off + .04, off + .1, gone);
  [[0, -1], [1, 0], [0, 1], [-1, 0]].forEach(function(v){ c += '<circle r="1.3" cx="0" cy="0" fill="#fff">' + bdgAnim('animateTransform', 'transform', D, [[off, '0 0'], [gone, (v[0] * 9) + ' ' + (v[1] * 9)]], 'type="translate"') + '</circle>'; });
  return c + '</g></g>';
}
function bdgStar(x, y, D, on, off){   // a four-pointed twinkle
  return '<g transform="translate(' + x + ' ' + y + ')"><g opacity="0">' + bdgShow(D, on, on + .12, off - .15, off) + bdgAnim('animateTransform', 'transform', D, [[on, '0'], [on + .12, '1'], [(on + off) / 2, '1.25'], [off - .15, '1'], [off, '0']], 'type="scale"') +
    '<path d="M0,-10 C1.4,-3.4 3.4,-1.4 10,0 C3.4,1.4 1.4,3.4 0,10 C-1.4,3.4 -3.4,1.4 -10,0 C-3.4,-1.4 -1.4,-3.4 0,-10Z" fill="#fff"/></g></g>';
}
function bdgShine(id, D, a, b, ang, fromTo, soft){   // white bars sweeping across, clipped to the badge
  var s = fromTo === 'rev' ? [[a, 80], [b, -80]] : [[a, -80], [b, 80]];
  return '<g clip-path="url(#' + id + 'c)"><g transform="rotate(' + ang + ' 50 50)"><g>' + bdgAnim('animateTransform', 'transform', D, s.map(function(q){ return [q[0], '0 ' + q[1]]; }), 'type="translate"') +
    '<rect x="-40" y="41" width="180" height="16" fill="#fff" opacity="' + (soft ? .75 : .92) + '"/><rect x="-40" y="60" width="180" height="6" fill="#fff" opacity=".5"/><rect x="-40" y="34" width="180" height="4" fill="#fff" opacity=".35"/></g></g></g>';
}
function agentBadgeSvg(idx){
  var kind = AGENT_BADGES[((idx % 6) + 6) % 6], id = 'bd' + (++_bdgN), still = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  var W0 = bdgWave(.085, 0, 0, 0), W1 = bdgWave(.085, .5, 0, 0), W2 = bdgWave(.08, -.35, 0, 0), SQ = bdgWave(.02, 0, .06, Math.PI), SQ2 = bdgWave(.03, .3, .045, Math.PI);
  var defs = '', body = '', chk = '<path d="M30 51 L43 64 L70 35" fill="none" stroke="CHK" stroke-width="9.5" stroke-linecap="round" stroke-linejoin="round"/>', fill, chkCol = '#fff', D, shape, extra = '', checkG;
  if (kind === 'blue' || kind === 'red' || kind === 'pink' || kind === 'gold') {
    var gold = kind === 'gold';
    D = gold ? 3 : 1.5;
    var plan = gold ? [[0, SQ], [.25, SQ], [.45, W0], [.65, W1], [.85, W2], [1.05, SQ2], [1.25, SQ]] : [[0, W0], [.3, SQ], [.55, W1], [.8, W2], [1.05, SQ2], [1.3, W0]];
    if (kind === 'blue') fill = '#62b3ee';
    else if (kind === 'red') fill = '#ff2324';
    else if (kind === 'gold') { fill = 'url(#' + id + 'g)'; chkCol = '#1e1e1e'; defs += '<linearGradient id="' + id + 'g" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#e99d32"/><stop offset=".78" stop-color="#eca238"/><stop offset="1" stop-color="#f7d28c"/></linearGradient>'; }
    else { fill = 'url(#' + id + 'g)'; defs += '<linearGradient id="' + id + 'g" gradientUnits="userSpaceOnUse" x1="8" y1="92" x2="92" y2="8">' + (still ? '' : '<animateTransform attributeName="gradientTransform" type="rotate" values="0 50 50;360 50 50" dur="3s" repeatCount="indefinite"/>') + '<stop offset="0" stop-color="#b01fa8"/><stop offset=".55" stop-color="#e050dc"/><stop offset="1" stop-color="#ff73ff"/></linearGradient>'; }
    shape = '<path fill="' + fill + '" d="' + plan[0][1] + '">' + (still ? '' : bdgAnim('animate', 'd', D, plan)) + '</path>';
    if (gold) { defs += '<clipPath id="' + id + 'c"><path d="' + SQ + '"/></clipPath>'; extra = still ? '' : bdgShine(id, D, 1.85, 2.75, 45, 'rev', true); }
    var pulse = kind === 'red' && !still ? bdgAnim('animateTransform', 'transform', D, [[0, '1'], [.3, '.72'], [.6, '1.12'], [.9, '.8'], [1.2, '1.12'], [1.5, '1']], 'type="scale"') : '';
    checkG = '<g transform="translate(50 50)"><g>' + pulse + '<g transform="translate(-50 -50)">' + chk.replace('CHK', chkCol) + '</g></g></g>';
    body = shape + extra + checkG;
  } else {
    var black = kind === 'black', col = black ? '#000' : '#2bfe00', A = '<rect x="19" y="19" width="62" height="62" rx="7.5" fill="' + col + '"', B = A + ' transform="rotate(45 50 50)"';
    D = black ? 3 : 6;
    if (black) body = '<g>' + (still ? '' : bdgAnim('animateTransform', 'transform', D, [[1.45, '0 50 50'], [1.75, '-14 50 50'], [2.1, '9 50 50'], [2.4, '0 50 50']], 'type="rotate"')) + A + '/>' + B + '/></g>';
    else body = A + '>' + (still ? '' : bdgAnim('animateTransform', 'transform', D, [[.93, '0 50 50'], [2, '90 50 50']], 'type="rotate"')) + '</rect>' + B + '>' + (still ? '' : bdgAnim('animateTransform', 'transform', D, [[.93, '45 50 50'], [2, '-45 50 50']], 'type="rotate"')) + '</rect>';
    defs += '<clipPath id="' + id + 'c"><rect x="19" y="19" width="62" height="62" rx="7.5"/><rect x="19" y="19" width="62" height="62" rx="7.5" transform="rotate(45 50 50)"/></clipPath>';
    body += chk.replace('CHK', '#fff');
    if (!still) body += black ?
      bdgShine(id, D, 1.45, 2.45, -45, 'fwd', false) + bdgPlus(86, 14, D, 2.87, 0, .33, .6) + bdgPlus(8, 52, D, .65, .8, 1.15, 1.4) + bdgPlus(14, 14, D, 2, 2.13, 2.6, 2.8) :
      bdgStar(12, 16, D, 1.45, 2.1) + bdgStar(85, 14, D, 2.1, 3.1) + bdgShine(id, D, 2.45, 3.45, -45, 'fwd', true);
  }
  return '<svg class="bdg" viewBox="0 0 100 100" aria-hidden="true" focusable="false"><defs>' + defs + '</defs>' + body + '</svg>';
}

// The member's own agent level, on the number card of Me: the live badge on the corner of the profile picture and the level's name at the right end of the number row.
var _agentMe = null, _agentMeAt = 0, _agentMeBusy = false;
function setAgentMe(r){
  var idx = -1;
  if (r && r.levelId && Array.isArray(r.levels)) for (var i = 0; i < r.levels.length; i++) if (r.levels[i].id === r.levelId) idx = i;
  _agentMeAt = Date.now();
  _agentMe = idx >= 0 && STATE ? { uid: STATE.uid, idx: idx, name: String(r.levelName || r.levels[idx].name || '') } : null;
  paintAgentMe();
}
function paintAgentMe(){
  var slot = $('acctBadge'), nm = $('acctAgent'); if (!slot || !nm) return;
  var me = _agentMe && STATE && _agentMe.uid === STATE.uid ? _agentMe : null, sig = me ? me.idx + '|' + me.name : '';
  if (slot.getAttribute('data-sig') === sig) return;   // the same level: no repaint, so the animation is not restarted
  slot.setAttribute('data-sig', sig);
  slot.innerHTML = me ? agentBadgeSvg(me.idx) : '';
  nm.textContent = me ? me.name : '';
  nm.style.display = me ? '' : 'none';
}
async function refreshAgentMe(force){
  if (!STATE || _agentMeBusy || (!force && Date.now() - _agentMeAt < 90000)) return;
  _agentMeBusy = true;
  try { var r = await api('/agent/status'); if (!r.stale && r.status === 'success' && STATE) setAgentMe(r); } catch (e) {} finally { _agentMeBusy = false; }
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
/* VIP Tasks: two lists. Team rewards (each tier claimed once, from the team's purchases) and Agent rewards (a monthly salary for keeping a number of
   ACTIVE subordinates: members invited directly who have an AI robot running; the admin names each agent level). Everything shown is what the server answered. */
var _vipTab = 'team';
function setVipTab(name, tapped){
  var was = _vipTab;
  _vipTab = name === 'agent' ? 'agent' : 'team';
  // A tap on the other tab brings up the app's dots over the page, exactly like going to another page: the lists are asked for afresh behind them and the dots lift when the answer is on screen.
  if (tapped && _vipTab !== was) navVeil(true, vipRefresh());
  document.querySelectorAll('.uline-tab[data-vt]').forEach(function(b){ b.classList.toggle('active', b.dataset.vt === _vipTab); });
  var a = $('vtTeam'), g = $('vtAgent');
  if (a) a.style.display = _vipTab === 'team' ? '' : 'none';
  if (g) g.style.display = _vipTab === 'agent' ? '' : 'none';
}
var TK_ICON_AGENT = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.4"/><path d="M2.8 19.5c.5-3.4 3-5.3 6.2-5.3s5.7 1.9 6.2 5.3"/><path d="M16 5.2a3.2 3.2 0 010 6M18.2 14.7c1.7.7 2.8 2.3 3 4.8"/></svg>';
function agentDate(ms){
  var d = new Date(ms + 3 * 3600000), m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return d.getUTCDate() + ' ' + m[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
}
function renderAgentSummary(r){
  var has = !!r.levelId, first = r.levels[0], mineIdx = -1;
  if (has) for (var q = 0; q < r.levels.length; q++) if (r.levels[q].id === r.levelId) mineIdx = q;
  var waiting = has && !r.canClaim, label, cls = '', click = '';
  if (has && r.canClaim) { label = 'Claim ' + ugx(r.salary); cls = 'is-ready'; click = ' onclick="claimAgent(this)"'; }
  else if (waiting) label = 'Next salary on ' + agentDate(r.nextAt);
  else label = first ? ('Reach ' + first.target + ' active subordinate' + (first.target === 1 ? '' : 's')) : 'Not available yet';
  return '<div class="tk-card">' +
      '<div class="tk-head"><div class="tk-ic tk-ic-dep">' + TK_ICON_AGENT + '</div><div class="tk-type">Your agent level</div>' + (mineIdx >= 0 ? '<span class="tk-badge">' + agentBadgeSvg(mineIdx) + '</span>' : '') + '</div>' +
      '<div class="tk-desc">' + (has ? ('You are <b>' + esc(r.levelName) + '</b>. Monthly salary: <em>' + ugx(r.salary) + '</em>') : 'You are not an agent yet. Invite members and help them start an AI robot.') + '</div>' +
      '<div class="tk-stats"><div><b>' + (Number(r.active) || 0) + '</b><span>Active subordinates</span></div><div><b>' + (Number(r.direct) || 0) + '</b><span>Invited</span></div><div><b>' + (has ? ugx(r.salary) : ugx(0)) + '</b><span>Monthly salary</span></div></div>' +
      '<button type="button" class="tk-pill ' + cls + '"' + (click || ' disabled') + '>' + esc(label) + '</button>' +
    '</div>';
}
function renderAgentLevel(l, r, idx){
  var active = Number(r.active) || 0, current = Math.min(active, l.target);
  var pct = l.target > 0 ? Math.min(100, Math.floor(current / l.target * 100)) : 0, mine = r.levelId === l.id;
  return '<div class="tk-card' + (mine ? ' ag-mine' : '') + '">' +
      '<div class="tk-head"><div class="tk-ic tk-ic-dep">' + TK_ICON_AGENT + '</div><div class="tk-type">' + esc(l.name) + '</div>' + (mine ? '<span class="tk-tag">Your level</span>' : '') + '<span class="tk-badge">' + agentBadgeSvg(idx) + '</span></div>' +
      '<div class="tk-desc">Keep <b>' + l.target + '</b> active subordinate' + (l.target === 1 ? '' : 's') + ' to earn: <em>' + ugx(l.salary) + '</em> every month</div>' +
      '<div class="tk-bar"><div class="tk-bar-fill' + (l.reached ? ' is-done' : '') + '" style="width:' + pct + '%"></div></div>' +
      '<div class="tk-stats"><div><b>' + current + '</b><span>Current</span></div><div><b>' + l.target + '</b><span>Target</span></div><div><b>' + pct + '%</b><span>Progress</span></div></div>' +
      '<button type="button" class="tk-pill ' + (l.reached ? 'is-done' : '') + '" disabled>' + (l.reached ? 'Reached' : 'In Progress') + '</button>' +
    '</div>';
}
function renderAgentList(r){
  var box = $('agentList'); if (!box) return;
  if (!r || r.status !== 'success' || !Array.isArray(r.levels)) { box.innerHTML = '<div class="empty">' + esc((r && r.message) || 'Could not load the agent rewards. Try again.') + '</div>'; return; }
  box.innerHTML = r.levels.length ? (renderAgentSummary(r) + r.levels.map(function(l, i){ return renderAgentLevel(l, r, i); }).join('')) : '<div class="empty">No agent rewards are set up yet.</div>';
}
// Asks the server for both lists and paints them (no spinner of its own: the caller shows the dots or the ring).
async function vipRefresh(){
  var box = $('taskCenterList');
  if (!box) return;
  var rs = await Promise.all([api('/salary/status'), api('/agent/status')]);
  var r = rs[0], ag = rs[1];
  if (r.stale || ag.stale || !STATE) return;
  STATE.agent = ag;
  setAgentMe(ag);
  renderAgentList(ag);
  if (r.status !== 'success' || !Array.isArray(r.tiers)) { box.innerHTML = '<div class="empty">' + esc((r && r.message) || 'Could not load the team rewards. Try again.') + '</div>'; return; }
  STATE.salary = r;
  box.innerHTML = r.tiers.length ? r.tiers.map(function(t){ return renderTierCard(t, Number(r.total) || 0); }).join('') : '<div class="empty">No rewards are set up yet.</div>';
}
async function loadTaskCenter(){
  var box = $('taskCenterList'), abox = $('agentList');
  if (!box) return;
  setVipTab(_vipTab);
  box.innerHTML = spinnerHtml(); if (abox) abox.innerHTML = spinnerHtml();
  await vipRefresh();
}
async function claimAgent(btn){
  if (!btn || btn.disabled) return;
  var label = btn.textContent;
  btn.disabled = true; btn.innerHTML = btnBusyHtml('Please wait…');
  var r = await api('/agent/claim', {});
  if (r.stale) return;
  if (r.status !== 'success') {
    toast(r.message || 'Could not pay the salary');
    btn.disabled = false; btn.textContent = label;
    await loadTaskCenter();
    return;
  }
  toast(r.message || 'Salary added to your wallet');
  await refreshFromServer();
  renderAll();
  await loadTaskCenter();
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
function isProductSoldOut(p){ return p.active === false || !!p.comingSoon || p.isOpen === false; }   // closed for any reason: the card's button reads Coming soon (or Opens hh:mm)
function productImg(p){ return p && p.image ? p.image : iconUrl('robots'); }
// A product picture is shown WHOLE (any shape, tall or wide), not cropped: object-fit contain inside its frame, and the frame takes the colour of the picture's own
// corners so the picture melts into it (a white photo sits on white, the blue default art on blue). A picture from another website cannot be read and keeps the soft blue.
var _imgBg = {};   // picture address -> its corner colour, so a repaint (every refresh builds the cards again) never shows the empty frame for a moment
// Repaints that would write the very same cards again are skipped, so the pictures are not thrown away and loaded again (that is what flickered).
function setHtmlIfChanged(el, html){ if (el._lastHtml === html) return; el._lastHtml = html; el.innerHTML = html; }
// A picture whose corners are WHITE or very light grey (a photo on a plain light backdrop, the usual product picture) is brought to the card's own white: its
// backdrop is lifted to pure white (a brightness filter worked out from the corners) and the frame is the card colour, so every white matches and no grey
// block shows in a card, in My Products or on the Home strip. A coloured backdrop (the blue default art) still gets a frame of its own corner colour.
var _imgFx = {};   // picture address -> the filter that lifts its light backdrop to white ('' when none is needed)
function lightBackdropFilter(r, g, b){
  var mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (mn < 205 || mx - mn > 22) return null;   // not a plain light backdrop
  if (mn >= 253) return '';   // already white
  // Each colour channel is scaled so the corner colour becomes exactly 255,255,255 (an off-white with a warm or cool tint turns pure white, not just brighter).
  r = Math.round(r / 2) * 2 || 2; g = Math.round(g / 2) * 2 || 2; b = Math.round(b / 2) * 2 || 2;   // steps of two: few filters, one per backdrop colour
  var id = 'wf-' + r + '-' + g + '-' + b;
  if (!document.getElementById(id)) {
    var host = document.getElementById('whiteFilters');
    if (!host) {
      host = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      host.setAttribute('id', 'whiteFilters'); host.setAttribute('width', '0'); host.setAttribute('height', '0'); host.setAttribute('aria-hidden', 'true');
      host.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
      document.body.appendChild(host);
    }
    var NS = 'http://www.w3.org/2000/svg', f = document.createElementNS(NS, 'filter'), t = document.createElementNS(NS, 'feComponentTransfer');
    f.setAttribute('id', id); f.setAttribute('color-interpolation-filters', 'sRGB');
    [['feFuncR', r], ['feFuncG', g], ['feFuncB', b]].forEach(function(q){
      var fn = document.createElementNS(NS, q[0]); fn.setAttribute('type', 'linear'); fn.setAttribute('slope', (255 / q[1]).toFixed(4)); t.appendChild(fn);
    });
    f.appendChild(t); host.appendChild(f);
  }
  return 'url(#' + id + ')';
}
function fitImgBg(img){
  var key = img.getAttribute('src'), framed = img.classList.contains('prod-img') || img.classList.contains('choc-img');
  img.style.opacity = '1';
  if (framed && !_imgBg[key]) _imgBg[key] = 'none';   // loaded, colour not (yet) known: never hide it again on a repaint
  try {
    var c = document.createElement('canvas'); c.width = 8; c.height = 8;
    var x = c.getContext('2d'); x.drawImage(img, 0, 0, 8, 8);
    var r = 0, g = 0, b = 0, a = 0;
    [[0, 0], [7, 0], [0, 7], [7, 7]].forEach(function(q){ var d = x.getImageData(q[0], q[1], 1, 1).data; r += d[0]; g += d[1]; b += d[2]; a += d[3]; });
    if (a / 4 < 128) return;   // see-through corners: the page colour stays
    r = Math.round(r / 4); g = Math.round(g / 4); b = Math.round(b / 4);
    var fx = lightBackdropFilter(r, g, b);
    if (fx !== null) {
      _imgFx[key] = fx; img.style.filter = fx;
      if (framed) { img.style.background = 'var(--card)'; _imgBg[key] = 'var(--card)'; }
      return;
    }
    if (!framed) return;
    var col = 'rgb(' + r + ',' + g + ',' + b + ')';
    img.style.background = col; _imgBg[key] = col;
  } catch (e) {}
}
function imgTag(p, cls, style){
  var src = productImg(p), framed = cls === 'prod-img' || cls === 'choc-img', col = framed ? _imgBg[src] : '', fx = _imgFx[src] ? 'filter:' + _imgFx[src] + ';' : '';
  // A framed picture stays invisible until it has loaded (no blue frame flashing first); once its colour is known the frame is painted at once on every repaint.
  var st = (style || '') + fx + (framed ? (col === 'none' ? '' : col ? 'background:' + col + ';' : 'opacity:0;') : '');
  return '<img' + (cls ? ' class="' + cls + '"' : '') + (st ? ' style="' + st + '"' : '') + ' src="' + esc(src) + '" alt=""' + ' onload="fitImgBg(this)"' + ' onerror="this.onerror=null;this.src=\'/icons/robots.webp\'">';
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
  return 'Coming soon';   // every other closed product (Active off) reads the same: only COMING SOON is shown to members
}
function renderFeatured(){
  // Sold-out and coming-soon robots are never featured: no point steering anyone toward something they cannot buy yet.
  var html = PRODUCTS.filter(function(p){ return !isProductSoldOut(p); }).slice(0, 6).map(function(p){
    return '<button class="choc-card" data-key="' + esc(p.key) + '" onclick="goToShopProduct(this.dataset.key)">' + imgTag(p, 'choc-img') +
      '<div class="choc-body"><div class="choc-name">' + esc(p.name) + '</div>' +
      '<div class="choc-price">' + ugx(p.price) + '</div>' +
      '<div class="choc-ret">+' + ugx(dailyReturn(p)) + '/day</div></div></button>';
  }).join('');
  setHtmlIfChanged($('featStrip'), html || (_productsOk ? '<div class="empty" style="width:100%">No AI robots yet. Check back soon.</div>' : spinnerHtml()));
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
      ? '<button class="btn btn-primary btn-block" disabled style="opacity:.5;cursor:not-allowed;margin-top:6px">' + esc(closedLabel(p)) + '</button>'
      : capped
        ? '<button class="btn btn-primary btn-block" disabled style="opacity:.5;cursor:not-allowed;margin-top:6px">Limit reached (' + ownedCount(p.key) + '/' + lim + ')</button>'
        : '<button class="btn btn-primary btn-block btn-buy-glow" style="margin-top:6px" data-key="' + esc(p.key) + '" onclick="buyProduct(this,this.dataset.key)">Rent now</button>';
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
  setHtmlIfChanged($('shopGrid'), html || (_productsOk ? '<div class="empty">' + 'No AI robots yet. Check back soon.' + '</div>' : spinnerHtml()));
  syncSweepPhase($('shopGrid'));
}
function investmentStats(){
  // Settlement is done by the server (a payment every 24 hours); this only reshapes what refreshFromServer() stored.
  return (STATE.investments || []).map(function(inv){ return { inv: inv, daysElapsed: inv.daysElapsed, cycleDays: inv.cycleDays, accrued: inv.accrued, matured: inv.matured }; });
}
function productByKey(key){ return PRODUCTS.filter(function(p){ return p.key === key; })[0]; }
function renderMyRobots(){
  if (!dataLoaded('inv', STATE && STATE.investments)) { waitForData('inv', $('mychocList'), renderMyRobots); return; }
  var rows = investmentStats();
  if (!rows.length) { $('mychocList').innerHTML = '<div class="empty">No AI robots running yet. Buy one from AI Robots to start earning.</div>'; return; }
  $('mychocList').innerHTML = rows.map(function(r){
    var purchased = r.inv.purchasedAt ? new Date(r.inv.purchasedAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Unknown';
    return '<div class="choc-hold-card">' +
      '<div class="choc-hold-top">' + imgTag(productByKey(r.inv.key), '', 'width:48px;height:48px;border-radius:12px;object-fit:cover;flex:0 0 auto') +
        '<div class="bank-info"><b>' + esc(r.inv.name) + '</b><span>' + ugx(r.inv.price) + '</span></div>' +
        '<span style="font-size:10.5px;font-weight:800;color:' + (r.matured ? 'var(--mint)' : 'var(--cocoa-faint)') + '">' + (r.matured ? 'Matured' : 'Working') + '</span>' +
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
  if (!dataLoaded('inv', STATE && STATE.investments)) { $('earningsTotal').textContent = '—'; waitForData('inv', $('earningsList'), renderEarnings); return; }
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
var _activityFeed = [], _activityFeedTimer = null, _activityFeedOn = false, _activityFeedSig = '', ACTIVITY_FEED_MS = 27000;
// Every renderTicker() builds a new track, which would restart the CSS animation; a negative delay equal to how far into the cycle "now" is lets it resume.
var TICKER_EPOCH = Date.now(), TICKER_CYCLE = 36;   // must match .ticker-track's animation duration
async function refreshActivityFeed(){
  var r = await api('/public/activity-feed');
  if (r.status !== 'success') return;
  // The same rows as a moment ago: leave the running ticker alone instead of rebuilding it.
  var feed = r.feed || [], sig = JSON.stringify(feed);
  if (sig === _activityFeedSig && _activityFeed.length) return;
  _activityFeedSig = sig; _activityFeed = feed; renderTicker();
}
// Self-scheduling like the account poll: one request at a time, none while the app is in the background, and one at once when it comes back.
function scheduleActivityFeed(){
  clearTimeout(_activityFeedTimer); _activityFeedTimer = null;
  if (!_activityFeedOn || document.hidden) return;
  _activityFeedTimer = setTimeout(async function(){
    try { await refreshActivityFeed(); } catch (e) {}
    scheduleActivityFeed();
  }, ACTIVITY_FEED_MS);
}
function startActivityFeed(){
  _activityFeedOn = true; _activityFeedSig = '';
  refreshActivityFeed();
  scheduleActivityFeed();
}
function stopActivityFeed(){ _activityFeedOn = false; clearTimeout(_activityFeedTimer); _activityFeedTimer = null; }
document.addEventListener('visibilitychange', function(){
  if (!_activityFeedOn) return;
  if (document.hidden) { clearTimeout(_activityFeedTimer); _activityFeedTimer = null; return; }
  refreshActivityFeed(); scheduleActivityFeed();
});
function renderTicker(){
  var box = $('tickerBox');
  if (!_activityFeed.length) { box.innerHTML = ''; return; }
  var rows = _activityFeed.map(function(f){
    var isDep = f.kind === 'deposit';
    return '<div class="ticker-row"><span class="dot" style="background:' + (isDep ? 'var(--mint)' : 'var(--berry)') + '"></span>' +
      '<span style="flex:1">' + esc(f.phone) + ' ' + (isDep ? 'recharged' : 'withdrew') + '</span>' +
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
    if (_settingsPollCounter % SETTINGS_POLL_EVERY === 0) { await syncPublicConfig(); renderStaticPages(); syncArtwork(); }   // pictures too: a banner changed in the admin panel reaches an open app
    if (STATE) {
      renderAll();
      var recOv = $('ovRecords');
      if (recOv && recOv.classList.contains('show') && _recordsTab !== 'accrued') loadRecordsTab(_recordsTab).then(renderRecords);
      var openOv = document.querySelector('.overlay.show');
      if (openOv && openOv.id === 'ovMychoc') renderMyRobots();
      if (openOv && openOv.id === 'ovEarnings') renderEarnings();
    }
  } catch (e) {}
  _accountPollRunning = false;
  if (_live.again) { _live.again = false; setTimeout(runAccountPoll, 0); return; }
  scheduleAccountPoll();
}
function startAccountPoll(){ scheduleAccountPoll(); liveStart(); }
function stopAccountPoll(){ clearTimeout(_accountPollTimer); _accountPollTimer = null; liveStop(); }
document.addEventListener('visibilitychange', function(){
  if (!document.hidden && STATE) runAccountPoll();   // catch up the moment the app is brought back to the front
});

/* ====================== REAL TIME (the live channel) ======================
   One open line to the server (GET /live, a stream the server writes a short line into whenever something of THIS member's changes: wallet, a recharge, a cash-out). Each line makes the app
   look again at once (the same refresh the 8-second poll does), and, if the payment-under-review page or the pay page is open, check that order right away. While the line is up the
   poll only runs every 20 s as a safety net; if the line drops it reconnects by itself (1.5 s, then slower) and the 8-second poll covers the gap. Closed while the app is in the background. */
var _live = { run: false, looping: false, token: 0, epoch: -1, ctl: null, backoff: 1500, kick: null, again: false };
function liveStart(){
  if (!STATE) return;
  _live.run = true;
  if (!_live.looping || _live.epoch !== _authEpoch) liveLoop();   // a new sign-in starts its own line even if the old one is still closing
}
function liveStop(){
  _live.run = false; clearTimeout(_live.kick);
  try { if (_live.ctl) _live.ctl.abort(); } catch (e) {}
  ACCOUNT_POLL_MS = 8000;
}
function liveKick(){
  clearTimeout(_live.kick);
  _live.kick = setTimeout(function(){
    if (!STATE || document.hidden) return;
    if (_accountPollRunning) _live.again = true; else runAccountPoll();
    var st = $('ovDepositStatus'); if (st && st.classList.contains('show') && typeof pollDepositStatus === 'function') pollDepositStatus();
    if (_gpActive && _gp.order && !_gp.finished) gpCheck(false);
  }, 120);
}
async function liveLoop(){
  _live.looping = true; _live.epoch = _authEpoch;
  var epoch = _authEpoch, token = ++_live.token;
  while (_live.run && STATE && epoch === _authEpoch && token === _live.token) {
    try {
      if (document.hidden) { await new Promise(function(r){ setTimeout(r, 1200); }); continue; }
      var user = window.fbAuth && window.fbAuth.currentUser; if (!user) break;
      var tok = ''; try { tok = await user.getIdToken(); } catch (e) {}
      if (!tok) throw new Error('no token');
      _live.ctl = new AbortController();
      var resp = await fetch(API_BASE + '/live', { headers: { 'Authorization': 'Bearer ' + tok }, signal: _live.ctl.signal, cache: 'no-store' });
      if (resp.status === 401) break;
      if (!resp.ok || !resp.body) throw new Error('live ' + resp.status);
      _live.backoff = 1500; ACCOUNT_POLL_MS = 20000;
      var rd = resp.body.getReader(), dec = new TextDecoder(), buf = '';
      for (;;) {
        var r = await rd.read(); if (r.done) break;
        buf += dec.decode(r.value, { stream: true });
        var parts = buf.split('\n\n'); buf = parts.pop();
        for (var i = 0; i < parts.length; i++) if (parts[i].indexOf('data:') >= 0 && parts[i].indexOf('"hello"') < 0) liveKick();
      }
    } catch (e) {}
    ACCOUNT_POLL_MS = 8000;
    if (!_live.run || epoch !== _authEpoch || token !== _live.token) break;
    await new Promise(function(r){ setTimeout(r, _live.backoff); });
    _live.backoff = Math.min(15000, Math.round(_live.backoff * 1.7));
  }
  if (token === _live.token) _live.looping = false;
}
document.addEventListener('visibilitychange', function(){
  if (document.hidden) { try { if (_live.ctl) _live.ctl.abort(); } catch (e) {} }
  else if (STATE && _live.run && !_live.looping) liveLoop();
});

/* ====================== LEDGER — Accrued (income) / Topups (deposits) / Cash Outs (withdrawals) ====================== */
var _recordsTab = 'accrued';
var _recordsLoaded = { accrued: true, topups: false, cashouts: false }, _recordsFailed = { topups: false, cashouts: false };
// The kinds of ledger row that are money coming IN as earnings (the Accrued tab). A top-up is in Topups and a cash-out is in Cash Outs.
var INCOME_TYPES = ['cashback', 'checkin', 'lucky_card', 'commission', 'mission_salary', 'agent_salary', 'promocode', 'welcome_bonus', 'admin_credit', 'investment_refund'];
var REC_TYPE_LABEL = { cashback: 'AI robot income', checkin: 'Daily reward', lucky_card: 'Lucky card reward', commission: 'Referral commission', mission_salary: 'Team reward', agent_salary: 'Agent salary', promocode: 'Gift code',
  welcome_bonus: 'Welcome gift', admin_credit: 'Account credit', investment_refund: 'Product refund' };
function recStatusInfo(s){
  s = String(s || 'success').toLowerCase();
  if (['success', 'matched', 'processed'].indexOf(s) !== -1) return { label: 'Completed', cls: 'ok' };
  if (s === 'awaiting_verification' || s === 'review') return { label: 'Pending Review', cls: 'proc' };
  if (['initiating', 'pending', 'processing', 'creating', 'sending'].indexOf(s) !== -1) return { label: 'Settling', cls: 'proc' };
  if (['failed', 'declined', 'cancelled', 'rejected', 'expired'].indexOf(s) !== -1) return { label: 'Declined', cls: 'bad' };
  return { label: s.charAt(0).toUpperCase() + s.slice(1), cls: 'mut' };
}
var _recordsAsk = null;   // the request the last setRecordsTab() sent (the page veil waits for it); setRecordsTab itself returns nothing so a caller never has to wait
function setRecordsTab(t){
  _recordsTab = t;
  document.querySelectorAll('.uline-tab[data-rt]').forEach(function(b){ b.classList.toggle('active', b.dataset.rt === t); });
  renderRecords();
  _recordsAsk = Promise.all([loadRecordsTab(t), liveData(8000)]).then(renderRecords);
}
// Top-ups and cash-outs are asked for fresh every time (a deposit that was still pending a minute ago may be done now); _recordsLoaded only
// decides whether the "loading" placeholder is shown the first time.
async function loadRecordsTab(t){
  if (t === 'topups') {
    var r = await api('/deposits');
    if (r.stale) return;
    if (r.status === 'success' && STATE) { STATE.depositRecords = r.deposits || []; _recordsLoaded.topups = true; _recordsFailed.topups = false; }
    else if (!_recordsLoaded.topups) _recordsFailed.topups = true;
  } else if (t === 'cashouts') {
    var r2 = await api('/withdrawals');
    if (r2.stale) return;
    if (r2.status === 'success' && STATE) { STATE.withdrawalRecords = r2.withdrawals || []; _recordsLoaded.cashouts = true; _recordsFailed.cashouts = false; }
    else if (!_recordsLoaded.cashouts) _recordsFailed.cashouts = true;
  }
}
function retryRecords(){ _recordsFailed[_recordsTab] = false; setRecordsTab(_recordsTab); }
function renderRecords(){
  var s = STATE;
  if (!s) return;
  if (_recordsTab === 'accrued') {
    if (!dataLoaded('tx', s.transactions)) { $('recordsStats').innerHTML = ''; waitForData('tx', $('recordsList'), renderRecords); return; }
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
  if (!_recordsLoaded[_recordsTab]) {
    $('recordsStats').innerHTML = '';
    $('recordsList').innerHTML = _recordsFailed[_recordsTab]
      ? '<div class="empty">Could not load this list.<br><button type="button" class="btn btn-ghost btn-sm" style="margin-top:12px" onclick="retryRecords()">Try again</button></div>'
      : spinnerHtml();
    return;
  }
  var sum = list.reduce(function(acc, r){ return acc + (isTop ? (r.status === 'matched' ? Number(r.amount) || 0 : 0) : (r.status === 'processed' ? Number(r.net || r.amount) || 0 : 0)); }, 0);
  $('recordsStats').innerHTML = '<div class="stat"><div class="n" style="color:' + (isTop ? 'var(--mint)' : 'var(--berry)') + '">' + ugx(sum) + '</div><div class="l">Total ' + (isTop ? 'recharged' : 'withdrawn') + '</div></div>';
  if (!list.length) { $('recordsList').innerHTML = '<div class="empty">' + (isTop ? 'No recharges yet.' : 'No withdrawals yet.') + '</div>'; return; }
  $('recordsList').innerHTML = list.slice(0, 80).map(function(r){
    var st = recStatusInfo(r.status);
    var stamp = r.createdAt ? fmtStamp(tsMs(r.createdAt)) : ((r.date || '') + ' ' + (r.time || '')).trim();
    var desc = isTop ? 'Mobile-money recharge' : ('Withdrawal' + (r.holder ? ' to ' + r.holder : '') + (r.network ? ' (' + r.network + ')' : ''));
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
var _tabAsk = null;   // the request the last tab switch sent; a caller that wants to scroll inside the new tab waits for it so the page is built first
function switchTab(name){
  // Tapping the tab you are already on does nothing new: no loader, no re-appearing of the page, no repaint. (It only glides back to the top if the page was scrolled.)
  var same = $('view' + name.charAt(0).toUpperCase() + name.slice(1));
  if (name === _lastTab && !_ovOpen && same && getComputedStyle(same).display !== 'none') {
    var tp = document.querySelector('.tab[data-tab="' + name + '"]');
    if (tp) { tp.classList.remove('tab-tapped'); void tp.offsetWidth; tp.classList.add('tab-tapped'); }
    if ((window.pageYOffset || 0) > 4) window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  _tabAsk = null;
  if (name !== _lastTab || _ovOpen) { _tabAsk = tabTask(name); navVeil(false, _tabAsk); }
  var enteringHomeFromElsewhere = (name === 'home' && _lastTab !== 'home');
  ['home', 'shop', 'rewards', 'share', 'team', 'account'].forEach(function(t){
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
  if (name === 'rewards') lkSettle();
  if (name === 'rewards' && _lastTab !== 'rewards' && typeof lkResetIfDone === 'function') lkResetIfDone();
  if (STATE && (name === 'rewards' || name === 'team' || name === 'share' || name === 'home')) renderAll();
  if (name === 'account' && STATE && _lastTab !== 'account') { countMyBalances(); paintVip(true); refreshAgentMe(); }
  if (name === 'team') medalPreload();
  // Coming back to Home from another tab shows the announcement again (its buttons shaking straight away).
  if (enteringHomeFromElsewhere) maybeShowAnnouncement(true);
  _lastTab = name;
}
var _bhHTML = '<svg class="bh-svg" viewBox="70 40 520 380" aria-hidden="true"><g class="bh-bob"> <path d="M100 112Q100 100 112 100L505 100L560 148V395Q560 408 546 408H150L100 366Z" fill="#b3e0ff" stroke="#5b95c8" stroke-width="8" stroke-linejoin="round"/> <path d="M98 112V358Q98 368 110 368H495Q505 368 505 358V122Q505 112 495 112Z" fill="#eaf6ff" stroke="#5b95c8" stroke-width="6" stroke-linejoin="round"/> <g class="bh-ext"><path d="M83 70Q83 55 98 55H415L452 82Q462 90 462 104V318Q462 336 444 336H110Q83 336 83 310Z" fill="#b30f27" stroke="#70081b" stroke-width="5" stroke-linejoin="round"/><path d="M415 58L450 84V316L415 296Z" fill="#c9132c"/></g> <g class="bh-face">  <rect x="83" y="55" width="332" height="240" rx="13" fill="#e5102b" stroke="#70081b" stroke-width="5"/>  <rect x="113" y="82" width="284" height="180" rx="10" fill="#fd2a3d"/>  <g class="bh-pressed"><rect x="83" y="55" width="332" height="240" rx="13" fill="#ff3d5e" stroke="#7a0a22" stroke-width="5"/><rect x="108" y="76" width="282" height="190" rx="12" fill="#ff7f90"/></g>  <text x="252" y="214" text-anchor="middle" font-family="\'Open Sans\',\'Segoe UI\',Roboto,Arial,sans-serif" font-weight="800" font-size="138" fill="#fff" textLength="267" lengthAdjust="spacingAndGlyphs">BUY</text> </g></g><g class="bh-sp bh-s1"><path d="M252 36V58M130 150H112" stroke="#fff" stroke-width="6" stroke-linecap="round"/></g><g class="bh-sp bh-s2"><path d="M104 40L120 56M424 44L440 58" stroke="#fff" stroke-width="6" stroke-linecap="round"/></g><g class="bh-sp bh-s3"><path d="M82 176H62M164 36L170 54M100 330L112 312" stroke="#fff" stroke-width="6" stroke-linecap="round"/></g><g class="bh-hand"><g transform="translate(-22 -5)"> <path class="bh-hy" d="M293 168C280 166 268 178 272 192L305 285C280 285 268 305 280 322C290 335 315 340 330 345L360 378C375 388 410 386 430 372C465 350 485 330 490 300C492 280 485 255 470 232C462 214 445 206 432 214C428 205 412 198 403 208C395 200 380 198 372 212L355 245L315 185C310 172 300 166 293 168Z" fill="#ffe01b" stroke="#f08a00" stroke-width="6" stroke-linejoin="round"/> <path class="bh-ho" d="M293 168C280 166 268 178 272 192L305 285C280 285 268 305 280 322C290 335 315 340 330 345L360 378C375 388 410 386 430 372C465 350 485 330 490 300C492 280 485 255 470 232C462 214 445 206 432 214C428 205 412 198 403 208C395 200 380 198 372 212L355 245L315 185C310 172 300 166 293 168Z" fill="#ffa500" stroke="#d66a00" stroke-width="6" stroke-linejoin="round"/> <path d="M372 218L392 268M404 212L417 262M433 218L446 255M318 290L336 333" fill="none" stroke="#f08a00" stroke-width="5" stroke-linecap="round"/></g></g></svg>';
// The sticker sits in the blank space to the right of the robot on that card; it plays once (3.3 s) and removes itself.
function showBuyHint(key){
  if (window.matchMedia && matchMedia('(prefers-reduced-motion:reduce)').matches) return;
  var card = $('prodCard-' + key); if (!card || card.classList.contains('is-soldout')) return;
  var wrap = card.querySelector('.prod-img-wrap'); if (!wrap) return;
  var old = document.querySelector('.buy-hint'); if (old && old.parentNode) old.parentNode.removeChild(old);
  var d = document.createElement('div'); d.className = 'buy-hint'; d.innerHTML = _bhHTML; wrap.appendChild(d);
  setTimeout(function(){ if (d.parentNode) d.parentNode.removeChild(d); }, 3500);
}
// The Featured strip on Home: go to AI Robots and scroll straight to that robot's own card.
function goToShopProduct(key){
  switchTab('shop');
  // The dots come first; the scroll happens once they have lifted (and the page's data is painted), so the member sees the page glide to the robot. If the first glide
  // did not land (a slow phone), an instant one finishes the job.
  var near = function(){ var el = $('prodCard-' + key); if (!el) return true; var r = el.getBoundingClientRect(); return Math.abs((r.top + r.height / 2) - window.innerHeight / 2) < 140; };
  var go = function(smooth){ var el = $('prodCard-' + key); if (el) el.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'center' }); };
  afterVeil(function(){
    go(true);
    setTimeout(function(){ if (!near()) go(false); }, 1100);
    setTimeout(function(){ showBuyHint(key); }, 1200);   // once the card has landed, the BUY sticker taps three times beside the robot
  });
}
// One full-screen page at a time. The phone's Back button closes it (one history entry, replaced when one page opens another) instead of leaving the app.
var _ovOpen = false, _ovName = '';
function hideOverlays(){ document.querySelectorAll('.overlay').forEach(function(o){ o.classList.remove('show'); }); }
function openOverlay(name, noVeil){
  var el = $('ov' + name.charAt(0).toUpperCase() + name.slice(1));
  if (!el) return;
  _ovName = name;
  hideOverlays();
  el.scrollTop = 0;
  el.classList.add('show');
  try { if (_ovOpen) history.replaceState({ ov: name }, ''); else history.pushState({ ov: name }, ''); } catch (e) {}
  _ovOpen = true; _ovName = name;
  var rt = null;
  if (name === 'bindbank') renderBankList();
  if (name === 'withdraw') prepareWithdraw();
  if (name === 'records') { setRecordsTab(_recordsTab === 'accrued' || _recordsTab === 'topups' || _recordsTab === 'cashouts' ? _recordsTab : 'accrued'); rt = _recordsAsk; }
  if (name === 'mychoc') renderMyRobots();
  if (name === 'earnings') renderEarnings();
  if (name === 'deposit') prepareDeposit();
  if (name === 'support') chatSupportOpen();
  if (!noVeil) navVeil(true, rt || overlayTask(name));   // the chat pages open with no dots: they paint from the phone's own copy
}
function closeOverlay(){
  if (_gpActive) gpLeave();
  if (!_ovOpen) { hideOverlays(); return; }
  _ovOpen = false;
  navVeil(false);
  hideOverlays();
  if (_lastTab === 'account') countMyBalances();   // back on Me: the balances count up again
  try { if (history.state && history.state.ov) history.back(); } catch (e) {}
}
window.addEventListener('popstate', function(){
  if (_vwSkip) { _vwSkip = false; return; }   // the entry a tapped picture gave back
  if (_vwOpen) { chatViewerClose(true); return; }   // Back with a picture open: close the picture, stay in the chat
  if (_gpActive) gpLeave();
  if (document.querySelector('.modal-bg.show')) closeAllSheets();
  if (_ovOpen) { _ovOpen = false; navVeil(false); hideOverlays(); if (_lastTab === 'account') countMyBalances(); }
});

/* ====================== PAYOUT ACCOUNT (the mobile-money cards cash-outs are sent to) ====================== */
// A member may keep several cards. The server holds which one is active (the one a cash-out goes to); a tap on a card makes it the active one.
function selectedBank(){
  var l = (STATE && STATE.bankAccounts) || [];
  return l.filter(function(b){ return b.isDefault; })[0] || l[0] || null;
}
// The mobile-money logo (MTN yellow, Airtel red) of a payout card; any other network keeps its coloured initials.
var NETWORK_LOGOS = { 'MTN Mobile Money': '/icons/mtn-logo.jpg', 'Airtel Money': '/icons/airtel-logo.jpg' };
function bankBadge(b){
  if (NETWORK_LOGOS[b.network]) return '<img class="bank-net-badge bank-net-logo" src="' + NETWORK_LOGOS[b.network] + '" alt="' + esc(String(b.network).split(' ')[0]) + '">';
  var nc = NETWORK_COLORS[b.network] || { color: '#D6E3F8', textColor: '#0B2A5B' };
  var initials = String(b.network || '').split(' ').map(function(w){ return w.charAt(0); }).join('').slice(0, 2);
  return '<div class="bank-net-badge" style="background:' + nc.color + ';color:' + nc.textColor + '">' + esc(initials) + '</div>';
}
function renderBankList(){
  if (!dataLoaded('bank', STATE && STATE.bankAccounts)) { waitForData('bank', $('bankList'), renderBankList); return; }
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
  if (STATE.balance < p.price) { toast('Not enough balance, recharge first'); return; }
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
    renderAll(); toast('Rented ' + p.name + '!');
  } finally {
    if (btn) btn.disabled = false;
  }
}

/* ====================== DEPOSIT (Add Funds asks only the amount; the payment pages below do the rest) ====================== */
// Quick amounts: the minimum, then the prices of the robots (the usual first deposits), kept to six.
function renderQuickAmounts(){
  var min = Number(getSettings().minDeposit) || 0;
  var amounts = [min].concat(PRODUCTS.map(function(p){ return Number(p.price) || 0; }).filter(function(n){ return n >= min && n > 0; }));
  var seen = {}, out = [];
  amounts.sort(function(a, b){ return a - b; }).forEach(function(n){ if (n > 0 && !seen[n]) { seen[n] = 1; out.push(n); } });
  if (out.length < 3) [2, 5, 10].forEach(function(m){ if (min * m > 0 && !seen[min * m]) { seen[min * m] = 1; out.push(min * m); } });
  var tri = '<span class="net-check" aria-hidden="true"></span>';
  $('quickAmts').innerHTML = out.slice(0, 6).map(function(n){ return '<button type="button" class="quick-amt-chip" data-amt="' + n + '" onclick="$(\'depAmt\').value=this.dataset.amt;markQuickAmt()">' + ugx(n) + tri + '</button>'; }).join('');
  markQuickAmt();
}
// The chip whose amount is in the box wears the blue round tick the network cards used to have (it pops in); typing another figure takes it off.
function markQuickAmt(){
  var v = String(parseInt($('depAmt').value, 10) || ''), chips = document.querySelectorAll('#quickAmts .quick-amt-chip');
  for (var i = 0; i < chips.length; i++) chips[i].classList.toggle('on', chips[i].dataset.amt === v);
}
function prepareDeposit(){
  $('depMin').textContent = ugx(getSettings().minDeposit);
  renderQuickAmounts();
}
// Money amount boxes cannot be left to type() alone: a number input has no real upper bound, and a 20-digit figure would overflow every sum below.
function capAmountInput(el){ if (el.value.length > 10) el.value = el.value.slice(0, 10); }

// The success tick and the failed cross (the owner's recordings, redrawn): a disc grows, a faint halo follows, the mark is drawn in.
// Disc radius 182, halo 300 (x1.65); check stroke 0.163 of the disc, X stroke 0.145; times measured at 60 pictures a second.
function tickHtml(){
  return '<svg viewBox="-300 -300 600 600" aria-hidden="true"><circle class="an-pop ok-halo" r="300" fill="rgba(3,239,0,.17)"/><circle class="an-pop ok-disc" r="182" fill="#03ef00"/><path class="ok-check" d="M-60 -4L-16 42L78 -53" fill="none" stroke="#111" stroke-width="30" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}
function crossHtml(){
  return '<svg viewBox="-310 -310 620 620" aria-hidden="true"><circle class="an-pop no-halo" r="303" fill="rgba(254,30,61,.15)"/><circle class="an-pop no-disc" r="187" fill="#fe1e3d"/><path class="no-x" d="M-51 -51L51 51M51 -51L-51 51" fill="none" stroke="#111" stroke-width="27" stroke-linecap="round"/></svg>';
}
// The clipboard may be missing (an old browser, an insecure address): say so instead of claiming it worked.
function copyText(text, okMsg){
  if (!text) return;
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function(){ toast(okMsg || 'Copied'); }).catch(function(){ toast('Could not copy'); });
  else toast('Could not copy');
}

/* ====================== PAYMENT PAGES (two steps, the admin's own MTN / Airtel numbers) ======================
   Add Funds only asks the amount. Continue opens page 1 (pick MTN or Airtel, type the number the payment is made from); Confirm asks the server for a NEW order
   (/deposit/manual/order: one of the admin's numbers of that network, 15 minutes, a new reference every time) and page 2 shows the account to pay, the clock, the
   Refresh check, the SMS / transaction ID box and the how-to. Coming back to the app with an unfinished order shows page 2 again with the SAME order and clock
   (resume). Nothing here credits a wallet: the admin approves the claim (Deposits -> Needs Review) and the page then shows the amount paid. */
var _gp = { amount: 0, network: '', order: null, skew: 0, expMs: 0, timer: null, poll: null, busy: false, needId: false, submitted: false, finished: false };
var _gpActive = false, _gpToastT = null, _gpLoadN = 0, _gpDigits = '';
var GP_KEY = 'smartai_gp_resume';
var GP_ORDER_MS = 15 * 60 * 1000;
var GP_ICONS = {
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>',
  warn: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="10.4" y="4.6" width="3.2" height="10.2" rx="1.6"/><circle cx="12" cy="18.7" r="1.9"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  // The Submit arrow: a darker disc with a light chevron (the owner's screenshot: disc 55 px, chevron 3.8 px, on a 229,134,8 button).
  chev: '<svg viewBox="0 0 55 55" aria-hidden="true"><circle cx="27.5" cy="27.5" r="27.5" fill="rgba(0,0,0,.157)"/><path d="M21.75 14.5L34.35 27.1L21.75 39.5" fill="none" stroke="#efb468" stroke-width="3.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  // The four step pictures, drawn on a 90 x 90 grid = the 90 px disc of the owner's screenshots (all #6f849f on #ebecf0).
  card: '<svg viewBox="0 0 90 90" aria-hidden="true"><g fill="#6f849f"><rect x="24.4" y="25.6" width="41.6" height="10" rx="2"/><rect x="24.4" y="38.6" width="41.6" height="25" rx="2.5"/></g><rect x="49.4" y="54.4" width="12.2" height="3" rx="1.5" fill="#ebecf0"/></svg>',
  refresh: '<svg viewBox="0 0 90 90" aria-hidden="true"><circle cx="45" cy="44.6" r="26" fill="#6f849f"/><path d="M53.2 34.8A12.8 12.8 0 1 0 53.2 54.4" fill="none" stroke="#ebecf0" stroke-width="3" stroke-linecap="round"/><path d="M47 40.5H58.5V30" fill="none" stroke="#ebecf0" stroke-width="3" stroke-linejoin="miter"/></svg>',
  person: '<svg viewBox="0 0 90 90" aria-hidden="true"><rect x="19" y="24" width="42" height="35.4" rx="3.5" fill="#6f849f"/><rect x="27" y="33" width="11" height="3.6" rx="1.8" fill="#ebecf0"/><rect x="27" y="42.6" width="11" height="4" rx="2" fill="#ebecf0"/><g fill="#6f849f" stroke="#ebecf0" stroke-width="2.4" paint-order="stroke"><circle cx="56" cy="38" r="8.8"/><path d="M38 59.4C38 51.5 46 49 56 49S74 51.5 74 59.4Z"/></g></svg>',
  bulb: '<svg viewBox="0 0 90 90" aria-hidden="true"><g fill="#6f849f"><circle cx="45" cy="44" r="17"/><rect x="37" y="63" width="16" height="3.4" rx="1.7"/><rect x="41" y="69" width="8" height="3.6" rx="1.8"/><rect x="42.3" y="17.4" width="5.4" height="7.2" rx="2.7"/><rect x="16.9" y="39.4" width="9" height="4.4" rx="2.2"/><rect x="64.1" y="39.4" width="9" height="4.4" rx="2.2"/><rect x="22.5" y="25.4" width="9" height="4.4" rx="2.2" transform="rotate(42 27 27.6)"/><rect x="58.1" y="25.4" width="9" height="4.4" rx="2.2" transform="rotate(-42 62.6 27.6)"/></g></svg>',
  // The copy picture: a square with a plus in front of a second one (the owner's screenshot, 80 px grid, #70675e, 4.6 px line).
  copy: '<svg viewBox="0 0 80 80" fill="none" stroke="#70675e" stroke-width="4.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M56.9 18.8V17Q56.9 11.9 51.8 11.9H18.2Q13.1 11.9 13.1 17V50Q13.1 55 18.2 55H19.4"/><rect x="25.1" y="23.1" width="40" height="40" rx="7"/><path d="M36.5 43.1H54.1M45 34.9V52.3"/></svg>',
  swoosh: '<svg viewBox="0 0 24 24" fill="none" stroke="#f7ead2" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 17L17 7M9.5 7H17v7.5"/></svg>'
};
function gpHeadArt(){
  // The header's flowing lines are the picture /icons/gp-head.webp (cut from the owner's screenshot); only the small pictures are filled in here.
  document.querySelectorAll('[data-gp]').forEach(function(n){ if (!n.firstChild && GP_ICONS[n.dataset.gp]) n.innerHTML = GP_ICONS[n.dataset.gp]; });
}
function gpNow(){ return Date.now() + (_gp.skew || 0); }
/* ---- notices ---- */
function gpToast(msg, pill, anchor){
  var el = $('gpToast'); if (!el) return;
  el.textContent = msg; el.className = 'gp-toast' + (pill ? ' pill' : '');
  // "Copied." sits on the box that was tapped (centred across, at that box's height); every other notice is in the middle of the screen.
  if (pill && anchor && anchor.getBoundingClientRect) { var r = anchor.getBoundingClientRect(); el.style.top = Math.round(r.top + r.height / 2) + 'px'; } else el.style.top = '';
  void el.offsetWidth; el.classList.add('show');
  clearTimeout(_gpToastT); _gpToastT = setTimeout(function(){ el.classList.remove('show'); }, pill ? 1500 : 2300);
}
// The Loading box stays up for at least 0.8 s, however fast the server answers (in the recordings it is always seen for a moment).
var _gpLoadAt = 0, _gpLoadHide = null;
function gpLoading(on){
  _gpLoadN = Math.max(0, _gpLoadN + (on ? 1 : -1));
  var el = $('gpLoading'); if (!el) return;
  clearTimeout(_gpLoadHide);
  if (_gpLoadN > 0) { if (!el.classList.contains('show')) _gpLoadAt = Date.now(); el.classList.add('show'); return; }
  var wait = Math.max(0, 800 - (Date.now() - _gpLoadAt));
  _gpLoadHide = setTimeout(function(){ if (_gpLoadN === 0) el.classList.remove('show'); }, wait);
}
function gpCopyFallback(text){
  try {
    var t = document.createElement('textarea');
    t.value = text; t.setAttribute('readonly', ''); t.style.cssText = 'position:fixed;top:0;left:0;opacity:0;font-size:16px';
    document.body.appendChild(t); t.select(); t.setSelectionRange(0, t.value.length);
    var ok = document.execCommand('copy'); document.body.removeChild(t); return !!ok;
  } catch (e) { return false; }
}
// The clipboard API only exists on a secure address; the older way still works on the preview address, so both are tried.
function gpCopy(text, msg, pill, anchor){
  text = String(text || ''); if (!text) return;
  var ok = function(){ gpToast(msg || 'Copied.', pill, anchor); };
  var bad = function(){ if (gpCopyFallback(text)) ok(); else gpToast('Could not copy'); };
  if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(ok, bad); else bad();
}
function gpCopyId(id){ var el = $(id); if (el) gpCopy(el.textContent, 'Successful replication'); }
/* ---- showing a page ---- */
function gpShow(id, over){
  var prev = over ? document.querySelector('.overlay.show') : null;
  if (!over) hideOverlays(); else document.querySelectorAll('.overlay.show').forEach(function(o){ if (o !== prev) o.classList.remove('show'); });
  var el = $(id); if (!el) return;
  if (prev && prev !== el) setTimeout(function(){ if (prev !== el) prev.classList.remove('show'); }, 360);
  el.scrollTop = 0; el.classList.add('show');
  try { if (_ovOpen) history.replaceState({ ov: id }, ''); else history.pushState({ ov: id }, ''); } catch (e) {}
  _ovOpen = true; _ovName = id; _gpActive = true;
}
// Leaving the pages for any reason (phone Back, sign-out, a finished order): the clock and the check stop; the order stays open on the server for a resume.
function gpLeave(){
  _gpActive = false;
  clearInterval(_gp.timer); clearInterval(_gp.poll); clearTimeout(_gp.skelT); clearTimeout(_gp.toStatusT); _gp.timer = null; _gp.poll = null; _gp.busy = false;
  var d = $('gpDone'); if (d) d.classList.remove('show');
  var ex = $('gpExpired'); if (ex) ex.classList.remove('show');
  _gpLoadN = 0; clearTimeout(_gpLoadHide); var l = $('gpLoading'); if (l) l.classList.remove('show');
}
function gpFinish(){
  gpLeave();
  if (_ovOpen) closeOverlay();
  if (STATE) { refreshFromServer().then(function(){ if (STATE) renderAll(); }).catch(function(){}); }
}
/* ---- Add Funds -> page 1 ---- */
function continueDeposit(){
  var amt = parseInt($('depAmt').value, 10), sett = getSettings();
  if (!amt || amt < sett.minDeposit) { toast('Minimum amount is ' + ugx(sett.minDeposit)); return; }
  if (sett.depositAvailable === false) { toast('Recharges are not available right now'); return; }
  if (_gpEntering) return;
  // The dots come up over Add Funds while the payment page is asked for (the networks the admin has numbers for); the page opens under them and they lift.
  _gpEntering = true;
  var epoch = _authEpoch, ask = api('/public/pay-channels');
  navVeil(true, ask);
  ask.then(function(r){
    _gpEntering = false;
    if (!STATE || epoch !== _authEpoch) return;
    gpOpenPick(amt, r);
  }, function(){ _gpEntering = false; });
}
var _gpEntering = false;
function gpOpenPick(amt, channels){
  _gp.amount = amt; _gp.network = ''; _gp.busy = false;
  $('gpAmt1').textContent = String(amt);
  $('gpPhone').value = '';
  ['MTN', 'Airtel'].forEach(function(n){ var b = $('gpM_' + n); if (b) { b.classList.remove('on'); b.style.opacity = ''; b.dataset.off = ''; } });
  $('gpConfirm').disabled = false; $('ovGpPick').classList.remove('busy');
  gpShow('ovGpPick');
  // Which networks the admin has a number for (a network with none is greyed and says so when tapped).
  var r = channels;
  if (r && r.status === 'success' && Array.isArray(r.networks)) ['MTN', 'Airtel'].forEach(function(n){ var b = $('gpM_' + n); if (b && r.networks.indexOf(n) < 0) { b.style.opacity = '.4'; b.dataset.off = '1'; } });
}
function gpPickNet(n){
  var b = $('gpM_' + n);
  if (b && b.dataset.off === '1') { gpToast(n + ' is not available right now'); return; }
  _gp.network = n;
  ['MTN', 'Airtel'].forEach(function(x){ var e = $('gpM_' + x); if (e) e.classList.toggle('on', x === n); });
}
async function gpConfirm(){
  if (_gp.busy) return;
  if (!_gp.network) { gpToast('Please select the operator first'); return; }
  var raw = $('gpPhone').value.trim();
  if (!raw) { gpToast('Please enter payment account number'); return; }
  var local = localDigits(raw);
  if (!local) { gpToast('The mobile phone number format is incorrect'); return; }
  _gp.busy = true; $('gpConfirm').disabled = true; $('ovGpPick').classList.add('busy'); gpLoading(true);
  var r = await api('/deposit/manual/order', { amount: _gp.amount, network: _gp.network, phone: '+256' + local });
  _gp.busy = false;
  if (r.stale || !_gpActive || r.status !== 'success') {
    gpLoading(false); $('gpConfirm').disabled = false; $('ovGpPick').classList.remove('busy');
    if (!r.stale && _gpActive) gpToast(r.message || 'Could not start the payment');
    return;
  }
  $('depAmt').value = '';
  gpSave(r);
  gpOpenPay(r, true);   // page 2 fades in as an empty skeleton while the Loading box is still up, then the values fill in
}
/* ---- page 2 ---- */
function gpOpenPay(o, skeleton){
  _gp.order = o; _gp.amount = Number(o.amount) || 0; _gp.network = o.network;
  _gp.skew = (Number(o.serverNow) || Date.now()) - Date.now(); _gp.expMs = Number(o.expiresAt) || (gpNow() + GP_ORDER_MS);
  _gp.needId = false; _gp.submitted = false; _gp.finished = false; _gp.busy = false;
  var net = String(o.network || 'MTN'), NET = net.toUpperCase(), amt = String(Math.round(_gp.amount));
  gpHeadArt();
  $('gpNetName').textContent = NET;
  $('gpAcctLab').textContent = NET + ' Account:';
  $('gpAmt2').textContent = amt;
  $('gpAcct').textContent = o.accountNumber || '';
  $('gpName').textContent = o.accountName || '';
  $('gpMine').textContent = o.payerPhone || '';
  $('gpHow').innerHTML = 'How to transfer using （<b>' + esc(NET) + ' to ' + esc(NET) + '</b>）';
  var acct = esc(o.accountNumber || ''), steps = net === 'Airtel'
    ? ['1: Dial <b>*185#</b>', '2: Select <b>1</b> Send money', '3: Select <b>1</b> Airtel Number', '4: Enter Airtel Number <b>' + acct + '</b>', '5: Enter Reason', '6: Enter Amount <b>' + amt + '</b>', '7: Enter your <b>PIN</b> code']
    : ['1: Dial <b>*165#</b>', '2: Select <b>1</b> Send Money', '3: Select <b>1</b> Mobile User', '4: Enter number <b>' + acct + '</b>', '5: Enter Amount <b>' + amt + '</b>', '6: Enter Reason', '7: Enter your <b>PIN</b> code'];
  $('gpSteps').innerHTML = steps.map(function(t, i){ return '<li' + (i === 1 ? ' class="gap"' : '') + '>' + t + '</li>'; }).join('');
  var paid = $('gpPaid'); paid.className = 'gp-paidv'; $('gpPaidN').textContent = '0';
  $('gpSms').value = ''; $('gpSms').readOnly = false; $('gpId').value = '';
  // "Get results faster" is NOT on the page at first: it slides in after the first tap on Refresh (gpReveal)
  _gp.revealed = false;
  var fs = $('gpFaster'); fs.style.display = 'none'; fs.style.maxHeight = ''; fs.style.opacity = ''; fs.style.overflow = ''; fs.style.transition = '';
  $('gpIdRow').style.display = 'none'; $('gpLose').style.display = ''; $('gpSubmit').style.display = ''; $('gpGet').style.display = 'none';
  fs.classList.remove('sent'); $('gpSentMsg').style.display = 'none';
  $('gpDone').classList.remove('show');
  var ov = $('ovGpPay');
  ov.classList.remove('gp-pop');
  if (skeleton) {
    ov.classList.add('gp-skel');
    gpShow('ovGpPay', true);
    clearTimeout(_gp.skelT);
    _gp.skelT = setTimeout(function(){
      ov.classList.remove('gp-skel'); ov.classList.add('gp-pop');
      gpLoading(false); var b = $('gpConfirm'); if (b) b.disabled = false; $('ovGpPick').classList.remove('busy');
      setTimeout(function(){ ov.classList.remove('gp-pop'); }, 900);
    }, 520);
  } else { ov.classList.remove('gp-skel'); gpShow('ovGpPay'); }
  gpTick();
  clearInterval(_gp.timer); clearInterval(_gp.poll);
  _gp.timer = setInterval(gpTick, 250);
  _gp.poll = setInterval(function(){ if (!document.hidden) gpCheck(false); }, 7000);
}
function gpTick(){
  var rem = _gp.expMs - gpNow(); if (rem < 0) rem = 0;
  var s = Math.floor(rem / 1000), hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  var txt = (hh < 10 ? '0' : '') + hh + (mm < 10 ? '0' : '') + mm + (ss < 10 ? '0' : '') + ss;
  if (txt !== _gpDigits) {
    _gpDigits = txt;
    var el = $('gpTimer'), cells = el ? el.querySelectorAll('i') : [];
    for (var i = 0; i < cells.length && i < 6; i++) cells[i].textContent = txt.charAt(i);
    if (el) el.classList.toggle('low', rem > 0 && rem < 120000);
  }
  if (rem <= 0 && !_gp.submitted && !_gp.finished) gpExpired();
}
var _geHTML = '<svg class="ge-svg" viewBox="285 575 500 450" aria-hidden="true"><defs><linearGradient id="geArc" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f5dd9b" stop-opacity="0"/><stop offset=".45" stop-color="#f2d27f" stop-opacity=".9"/><stop offset="1" stop-color="#f5dd9b" stop-opacity="0"/></linearGradient><linearGradient id="gePap" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fde9df"/><stop offset=".6" stop-color="#f9c9b6"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient><linearGradient id="geHand" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fdd2c2"/><stop offset="1" stop-color="#f6a592"/></linearGradient><linearGradient id="geCuff" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#a9dcf6"/><stop offset="1" stop-color="#78bfee"/></linearGradient><radialGradient id="geFace" cx=".45" cy=".4" r=".7"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#f6e6e6"/></radialGradient><linearGradient id="geRed" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff5d55"/><stop offset="1" stop-color="#d81f1f"/></linearGradient></defs><path d="M470 592A212 212 0 0 1 565 1012" fill="none" stroke="url(#geArc)" stroke-width="4" stroke-linecap="round"/><path d="M300 848Q300 832 325 838L480 862L598 884Q604 924 562 944Q520 954 470 946Q415 938 398 962V1008Q402 1024 430 1022L560 1016" fill="url(#gePap)"/><path d="M500 718L656 750L612 802L522 792Z" fill="#fdeae0"/><path d="M356 864L440 890M520 748L604 770M508 790L580 812" stroke="#ecbaa9" stroke-width="7" stroke-linecap="round" opacity=".75"/><path d="M292 745H340Q362 758 362 800V842Q330 836 306 816Q292 792 292 745Z" fill="url(#geCuff)"/><path d="M322 742Q306 684 346 644Q392 616 432 634Q458 652 448 690L470 700L500 704Q522 710 526 732Q530 760 508 776Q530 792 526 812Q516 842 482 842L402 844Q332 832 322 742Z" fill="url(#geHand)"/><path d="M500 704Q522 710 526 732M508 776Q530 792 526 812" fill="none" stroke="#eaa08c" stroke-width="3" opacity=".6"/><circle cx="432" cy="764" r="74" fill="url(#geRed)"/><circle cx="432" cy="764" r="53" fill="url(#geFace)"/><circle cx="432" cy="764" r="53" fill="none" stroke="#f0d6d6" stroke-width="3"/><circle cx="432" cy="669" r="14" fill="none" stroke="#e24444" stroke-width="7"/><rect x="424" y="680" width="16" height="14" rx="3" fill="#d92b2b"/><path d="M432 764L407 736" stroke="#2c2c2c" stroke-width="7" stroke-linecap="round"/><path d="M432 764L456 722" stroke="#e53935" stroke-width="3.5" stroke-linecap="round"/><circle cx="432" cy="764" r="8" fill="#fff" stroke="#222" stroke-width="4"/><path d="M498 704Q522 706 528 730Q532 758 510 774" fill="none" stroke="url(#geHand)" stroke-width="26" stroke-linecap="round"/><path d="M512 776Q534 792 528 814Q518 840 486 842" fill="none" stroke="url(#geHand)" stroke-width="26" stroke-linecap="round"/><path d="M470 818Q505 826 490 842" fill="none" stroke="url(#geHand)" stroke-width="26" stroke-linecap="round"/><path d="M581 666L605 642M604 688L641 678M597 711L618 719" stroke="#22a0f0" stroke-width="13" stroke-linecap="round"/></svg>';
function gpExpired(){
  _gp.finished = true; clearInterval(_gp.timer); clearInterval(_gp.poll); gpClearResume();
  var art = $('geArt'); if (art && !art.firstChild) art.innerHTML = _geHTML;
  var e = $('gpExpired'); if (e) e.classList.add('show');   // "The transaction has expired" (the owner's recording)
}
// A tap anywhere on it closes it and goes back to Add Funds to start a new recharge.
function gpExpiredClose(){
  var e = $('gpExpired'); if (e) e.classList.remove('show');
  gpLeave(); openOverlay('deposit');
}
function gpDialog(kind, title, text){
  var pic = kind === 'tick' ? (customIcon('tick') ? '<img src="' + esc(customIcon('tick')) + '" alt="">' : tickHtml()) : (customIcon('cross') ? '<img src="' + esc(customIcon('cross')) + '" alt="">' : crossHtml());
  $('gpDonePic').innerHTML = pic; $('gpDoneT').textContent = title; $('gpDoneP').textContent = text;
  $('gpDone').classList.add('show');
}
/* ---- the SMS / transaction ID block slides in after the first Refresh (the owner's recording), and the page scrolls to it only if it is below the screen ---- */
function gpReveal(){
  if (_gp.revealed) return; _gp.revealed = true;
  var el = $('gpFaster'); if (!el) return;
  el.style.display = '';
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion:reduce)').matches;
  if (!reduce) {
    var h = el.scrollHeight;
    el.style.overflow = 'hidden'; el.style.maxHeight = '0px'; el.style.opacity = '0'; el.style.transition = 'none';
    void el.offsetHeight;
    el.style.transition = 'max-height .5s cubic-bezier(.22,.8,.3,1), opacity .45s ease .08s';
    el.style.maxHeight = h + 'px'; el.style.opacity = '1';
    setTimeout(function(){ el.style.maxHeight = ''; el.style.overflow = ''; el.style.transition = ''; el.style.opacity = ''; }, 650);
  }
  setTimeout(function(){
    var b = $('gpSubmit'); if (!b || b.style.display === 'none') b = $('gpSms');
    var r = b.getBoundingClientRect();
    if (r.bottom > window.innerHeight - 8) { try { b.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) { b.scrollIntoView(); } }
  }, reduce ? 0 : 560);
}
/* ---- Refresh: where is this order now? ---- */
async function gpCheck(manual){
  if (!_gp.order || _gp.finished || _gp.busy) return;
  if (manual) { _gp.busy = true; $('gpRefresh').disabled = true; gpLoading(true); }
  var r;
  try { r = await api('/deposit/manual/status', { depositId: _gp.order.depositId }); }
  finally { if (manual) { gpLoading(false); _gp.busy = false; $('gpRefresh').disabled = false; } }
  if (!r || r.stale || !_gpActive || !_gp.order || _gp.finished) return;
  if (r.status !== 'success') { if (manual) gpToast(r.message || 'Could not check the payment right now'); return; }
  if (r.state === 'matched') {
    _gp.finished = true; clearInterval(_gp.timer); clearInterval(_gp.poll); gpClearResume();
    $('gpPaidN').textContent = String(Math.round(r.amountPaid || _gp.amount)); $('gpPaid').classList.add('ok');
    setTimeout(function(){ gpDialog('tick', 'Payment Successful!', 'Your wallet has been credited.'); }, 650);
    return;
  }
  if (r.state === 'failed') {
    _gp.finished = true; clearInterval(_gp.timer); clearInterval(_gp.poll); gpClearResume();
    gpDialog('cross', 'Payment Not Completed', r.message || 'This payment was not completed.');
    return;
  }
  if (r.state === 'review') { _gp.revealed = true; $('gpFaster').style.display = ''; if (!_gp.submitted) gpSent(false); return; }
  if (r.state === 'expired' && !_gp.submitted) { gpExpired(); return; }
  if (manual) gpReveal();   // nothing paid yet: no message, the box just slides in (as in the recording)
}
function gpRefresh(){ gpCheck(true); }
/* ---- the SMS / transaction ID ---- */
function gpSent(withToast){
  _gp.submitted = true; gpClearResume();
  $('gpSms').readOnly = true; $('gpIdRow').style.display = 'none'; $('gpLose').style.display = 'none'; $('gpSubmit').style.display = 'none'; $('gpGet').style.display = 'none';
  $('gpFaster').classList.add('sent'); $('gpSentMsg').style.display = '';
  if (withToast) gpToast('Submitted. Our team is checking your payment.');
  clearTimeout(_gp.toStatusT); _gp.toStatusT = setTimeout(gpToStatus, withToast ? 1900 : 600);
}
function gpNeedId(){
  _gp.needId = true;
  $('gpIdRow').style.display = ''; $('gpLose').style.display = 'none'; $('gpSubmit').style.display = 'none'; $('gpGet').style.display = '';
}
async function gpSend(){
  if (!_gp.order || _gp.busy || _gp.finished) return;
  var sms = $('gpSms').value.trim(), txn = _gp.needId ? $('gpId').value.trim() : '';
  if (!_gp.needId && !sms) { gpToast('Please enter payment SMS'); return; }
  if (_gp.needId && !txn) { gpToast('Please enter the transaction ID'); return; }
  _gp.busy = true; gpLoading(true);
  var r, t0 = Date.now();
  try {
    r = await api('/deposit/manual/submit', { depositId: _gp.order.depositId, sms: sms, txnId: txn });
    // A message or ID that was already used does nothing at all: the Submit button loads for a moment, then simply stops (no notice, no change on the page).
    if (r && r.code === 'USED') await new Promise(function(ok){ setTimeout(ok, Math.max(0, 1500 - (Date.now() - t0))); });
  }
  finally { gpLoading(false); _gp.busy = false; }
  if (!r || r.stale || !_gpActive) return;
  if (r.code === 'USED') return;
  if (r.status === 'success') { gpSent(true); return; }
  if (r.code === 'NEED_TXN_ID' && !_gp.needId) { gpNeedId(); return; }
  gpToast(r.message || 'Could not submit. Please try again');
}
/* ---- coming back to an unfinished order ---- */
function gpSave(o){
  if (!STATE || !o) return;
  try { localStorage.setItem(GP_KEY, JSON.stringify({ uid: STATE.uid, depositId: o.depositId, amount: o.amount, network: o.network, phone: o.payerPhone, at: Date.now() })); } catch (e) {}
}
function gpClearResume(){ try { localStorage.removeItem(GP_KEY); } catch (e) {} }
async function gpResume(){
  if (!STATE || _ovOpen) return;
  var st = null;
  try { st = JSON.parse(localStorage.getItem(GP_KEY) || 'null'); } catch (e) {}
  if (!st) return;
  if (st.uid !== STATE.uid || Date.now() - st.at > GP_ORDER_MS + 120000) { if (st.uid === STATE.uid) gpClearResume(); return; }
  var r = await api('/deposit/manual/order', { amount: st.amount, network: st.network, phone: st.phone, depositId: st.depositId, resume: true });
  if (!r || r.stale || !STATE) return;
  if (r.status === 'success') { if (!_ovOpen) gpOpenPay(r); return; }
  if (r.code === 'ORDER_GONE') gpClearResume();
}

/* ====================== PAYMENT UNDER REVIEW (the page after Submit) ======================
   After the SMS / transaction ID is sent the pay page says the team is working, then hands over to this page: the app's dotted loader in bright blue over the full-page
   particle field, "Your payment is under review", and a check of the order every few seconds. The admin's approval shows the animated tick (wallet credited), a rejection
   or an expired order shows the animated cross. The field stops when the page is left. */
var _payField = null;
function showPayLoader(){
  var ic = $('depStatusIc'); if (!ic) return;
  ic.className = 'pay-status-ic dots';
  ic.innerHTML = dlMarkup();
  ic.setAttribute('role', 'img'); ic.setAttribute('aria-label', 'Your payment is under review');
  if (!_payField) _payField = makeParticleField($('payFx'), { horizon: 0.12, dim: 0.55, alive: function(){ var o = $('ovDepositStatus'); return !!(o && o.classList.contains('show')); } });
  _payField.start();
}
function releasePayLoader(){ if (_payField) _payField.stop(); }
var DEP_POLL_FIRST_MS = 1500;
var DEP_POLL_EVERY_MS = 5000;
var DEP_POLL_MAX = 720;
var _depPollTimer = null, _depFirstTimer = null, _depPollAttempt = 0, _depPollId = null, _depConfirmed = false, _depPollChecking = false;
function stopDepositPoll(){ clearInterval(_depPollTimer); clearTimeout(_depFirstTimer); _depPollTimer = null; _depFirstTimer = null; _depPollId = null; }
function openDepositStatus(depositId, reference, amount){
  _depPollId = depositId; _depPollAttempt = 0; _depConfirmed = false;
  showPayLoader();
  $('depStatusTitle').textContent = 'Your payment is under review';
  $('depStatusPhone').textContent = 'Our team is checking your payment of ' + ugx(amount) + '. Your wallet is credited as soon as it is confirmed.';
  $('depStatusSteps').style.display = '';
  $('depStatusRef').textContent = reference || '';
  setDepStatusMsg('pending', 'Under review. This page updates by itself.');
  $('depStatusAttempt').textContent = '';
  $('depCancelRow').style.display = '';
  $('depVerifyLabel').textContent = 'Check Status';
  $('depVerifyBtn').onclick = manualVerifyDeposit;
  setVerifySpinning(false);
  openOverlay('depositStatus');
  clearInterval(_depPollTimer); clearTimeout(_depFirstTimer);
  _depFirstTimer = setTimeout(pollDepositStatus, DEP_POLL_FIRST_MS);
  _depPollTimer = setInterval(pollDepositStatus, DEP_POLL_EVERY_MS);
}
function showDepositSuccess(){
  _depConfirmed = true;
  $('depStatusIc').removeAttribute('role'); $('depStatusIc').removeAttribute('aria-label');
  $('depStatusIc').className = 'pay-status-ic anim';
  $('depStatusIc').innerHTML = customIcon('tick') ? '<img src="' + esc(customIcon('tick')) + '" alt="" style="width:100%;height:100%;object-fit:contain">' : tickHtml();
  $('depStatusTitle').textContent = 'Payment Successful!';
  $('depStatusPhone').textContent = 'Your wallet has been credited.';
  $('depStatusSteps').style.display = 'none';
  $('depStatusAttempt').textContent = '';
  $('depCancelRow').style.display = 'none';
  $('depVerifyLabel').textContent = 'Continue to Dashboard';
  var btn = $('depVerifyBtn');
  btn.disabled = false;
  btn.onclick = function(){ releasePayLoader(); closeOverlay(); switchTab('home'); renderAll(); };
}
function showDepositFailed(reason){
  $('depStatusIc').removeAttribute('role'); $('depStatusIc').removeAttribute('aria-label');
  $('depStatusIc').className = 'pay-status-ic anim';
  $('depStatusIc').innerHTML = customIcon('cross') ? '<img src="' + esc(customIcon('cross')) + '" alt="" style="width:100%;height:100%;object-fit:contain">' : crossHtml();
  $('depStatusTitle').textContent = 'Payment Not Completed';
  $('depStatusPhone').textContent = reason || 'This payment was not completed.';
  $('depStatusSteps').style.display = 'none';
  $('depCancelRow').style.display = 'none';
  $('depVerifyLabel').textContent = 'Back to Dashboard';
  var btn = $('depVerifyBtn');
  btn.disabled = false;
  btn.onclick = function(){ releasePayLoader(); closeOverlay(); renderAll(); };
}
function setDepStatusMsg(kind, text){
  var el = $('depStatusMsg');
  el.textContent = text;
  el.style.background = kind === 'matched' ? 'rgba(46,204,113,.2)' : kind === 'failed' ? 'rgba(255,90,110,.2)' : 'rgba(40,120,255,.22)';
  el.style.color = kind === 'matched' ? '#8dffbd' : kind === 'failed' ? '#ffa3b0' : '#d3e6ff';
}
function setVerifySpinning(on){
  var spin = $('depVerifySpin'), label = $('depVerifyLabel');
  if (spin) spin.style.display = on ? 'inline-flex' : 'none';
  if (label && !_depConfirmed && $('depStatusTitle').textContent === 'Your payment is under review') label.textContent = on ? 'Checking…' : 'Check Status';
}
// _depPollChecking stops the automatic check and a tap on Check Status from running at the same instant.
async function pollDepositStatus(manual){
  if (!_depPollId || _depPollChecking) return;
  var ov = $('ovDepositStatus');
  if (!ov || !ov.classList.contains('show')) { stopDepositPoll(); releasePayLoader(); return; }   // the page was left (Back): the check stops
  _depPollChecking = true;
  var btn = $('depVerifyBtn');
  if (btn && manual === true) btn.disabled = true;
  if (manual === true) setVerifySpinning(true);
  try {
    _depPollAttempt++;
    var r = await api('/deposit/manual/status', { depositId: _depPollId });
    if (!r || r.stale || !STATE || !_depPollId) return;
    if (r.status === 'success') {
      if (r.state === 'matched') {
        clearInterval(_depPollTimer); _depPollTimer = null;
        setDepStatusMsg('matched', 'Payment confirmed. Funds added to your wallet.');
        showDepositSuccess();
        await refreshFromServer(); renderAll();
        var lkn = lkInfo();
        if (lkn.on && lkn.chances > 0 && !lkLocked(lkn)) $('depStatusPhone').textContent = 'Your wallet has been credited. You also earned a chance on Lucky Cards.';
        return;
      }
      if (r.state === 'failed' || r.state === 'expired') {
        clearInterval(_depPollTimer); _depPollTimer = null;
        var why = r.state === 'expired' ? 'The payment order expired.' : (r.message || 'This payment was not completed.');
        setDepStatusMsg('failed', why);
        showDepositFailed(why);
        return;
      }
      if (manual === true) toast('Still under review. Our team is checking your payment');
    } else if (manual === true) {
      toast(r.message || 'Could not check the payment right now');
    }
    if (_depPollAttempt >= DEP_POLL_MAX) {
      clearInterval(_depPollTimer); _depPollTimer = null;
      setDepStatusMsg('pending', 'Still under review. Your wallet is credited as soon as it is confirmed. Tap Check Status or contact support.');
    }
  } finally {
    _depPollChecking = false;
    var b2 = $('depVerifyBtn'); if (b2) b2.disabled = false;
    setVerifySpinning(false);
  }
}
function manualVerifyDeposit(){ pollDepositStatus(true); }
function cancelDepositStatus(){ stopDepositPoll(); releasePayLoader(); closeOverlay(); if (STATE) renderAll(); }
function copyDepositRef(){ copyText($('depStatusRef').textContent, 'Reference copied'); }
// After Submit: the pay page says the team is working, then this page takes over (at once when the order was found already under review on coming back).
function gpToStatus(){
  var o = _gp.order;
  if (!o || !_gpActive) return;
  var amt = _gp.amount || o.amount;
  gpLeave();
  openDepositStatus(o.depositId, o.reference, amt);
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
    // The marker is taken off when the shake ends: left on, the browser replays the shake every time the page holding it is shown again (the Raffle card shook again after going away and coming back).
    (function(node){ var off = function(){ node.classList.remove('shake-x'); node.removeEventListener('animationend', off); }; node.addEventListener('animationend', off); setTimeout(off, 900); })(el);
  }
  if (navigator.vibrate) navigator.vibrate([60, 40, 60]);
}
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
  if (wn) { wn.style.display = win.enabled ? '' : 'none'; wn.textContent = win.enabled ? ('Withdrawals are open from ' + win.from + ' to ' + win.to + '.') : ''; }
  var box = $('witBankBox');
  var b = selectedBank();
  if (!b) {
    box.innerHTML = '<div class="info-box" style="background:var(--berry-pale);color:var(--berry)">No bank account bound yet.' +
      ' <b style="text-decoration:underline;cursor:pointer" onclick="goBindBank(true)">Bind one now</b></div>';
    return;
  }
  box.innerHTML = '<div class="bank-row" style="margin:16px 20px 0">' + bankBadge(b) +
    '<div class="bank-info"><b>Withdraw to ' + esc(b.holder) + '</b><span>' + esc(b.network) + ' · ' + esc(maskPhone(b.phone)) + '</span></div>' +
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
var _withdrawBusy = false;
async function doWithdraw(){
  if (_withdrawBusy) return;
  var sett = getSettings();
  var amt = parseMoney($('witAmt').value);
  if (!amt) { toast('Enter a valid amount'); shakeVibrate($('witAmt')); return; }
  // The server checks every rule again; these checks only save the member a round trip.
  if (amt < sett.minWithdraw) { toast('Minimum withdrawal is ' + ugx(sett.minWithdraw)); shakeVibrate($('witAmt'), $('witGoBtn')); return; }
  if (amt > STATE.balance) { toast('Insufficient balance'); shakeVibrate($('witAmt'), $('witGoBtn')); return; }
  var card = selectedBank();
  if (!card) { toast('Bind a mobile-money account first'); goBindBank(true); return; }
  var win = withdrawWindow(sett);
  if (win.enabled && !win.open && !STATE.withdrawAnytime) { toast('Withdraw is open from ' + win.from + ' to ' + win.to + '. Please come back then.'); return; }
  var btn = $('witGoBtn'), label = btn.textContent;
  _withdrawBusy = true;
  btn.disabled = true; btn.innerHTML = btnBusyHtml('Please wait…');
  var r;
  try {
    r = await api('/withdraw/request', { amount: amt, network: card.network, phone: card.phone });
  } finally {
    _withdrawBusy = false;
    btn.disabled = false; btn.textContent = label;
  }
  if (r.stale || !STATE) return;
  if (r.status !== 'success') {
    toast(r.message || 'Could not process the withdrawal');
    return;
  }
  $('witAmt').value = ''; renderWitCalc();
  // The server took the money at once; show it gone now and let the refresh below confirm.
  STATE.balance = Math.max(0, STATE.balance - amt);
  closeOverlay(); renderAll();
  toast('Withdrawal submitted successfully');
  refreshFromServer().then(function(){ if (STATE) renderAll(); });
}

/* ====================== INVITE CODE FIELD ====================== */
// A referral code is 6 capital letters / digits (K9P4M2). Whatever is typed (lower case, spaces, dashes) is turned into capitals and cut to that length as it goes in.
function capsCode(el, max){
  if (!el) return;
  el.addEventListener('input', function(){
    var v = String(el.value || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, max);
    if (v !== el.value) el.value = v;
  });
}
capsCode($('fCode'), 6);
/* ====================== LUCKY CARDS (Rewards tab) ======================
   Nine cards face down (the AI robots on their backs). Every credited recharge gives one chance; a tap on a card sends ONE request (/lucky/flip): the server draws and pays the prize
   (earnings, or an AI robot the admin listed) and returns it with what the other eight cards would have held. The tapped card lifts and turns over to show the prize, then the
   other eight turn over in a ripple, dimmed. The board is built once; renders only change the words, never the faces, so a turned card is never reset under the member's finger. */
var LK_CARDS = 9;
var _lk = { built: false, busy: false, revealed: false, timers: [] };
var LK_STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6l2.5 6.1 6.6.5-5 4.3 1.6 6.4L12 16.4 6.3 19.9l1.6-6.4-5-4.3 6.6-.5z" fill="currentColor"/></svg>';
function lkInfo(){ return (STATE && STATE.lucky) || { on: false, vip: 0, chances: 0, minVip: 0, minAmount: 0, maxAmount: 0, hasProducts: false }; }
// The Raffle page opens under the finger that tapped the Home button (or the tab): that tap's click must not land on the card that appears there and shake it. The cards ignore touches for 0.6 s.
function lkSettle(){
  var g = $('lkGrid'); if (!g) return;
  _lk.enterAt = Date.now(); g.classList.add('settle');
  clearTimeout(_lk.settleT); _lk.settleT = setTimeout(function(){ g.classList.remove('settle'); }, 600);
}
function lkLater(fn, ms){ var t = setTimeout(fn, ms); _lk.timers.push(t); return t; }
function lkClearTimers(){ _lk.timers.forEach(clearTimeout); _lk.timers = []; }
function lkBuild(){
  var g = $('lkGrid'); if (!g || _lk.built) return;
  _lk.built = true;
  var h = '';
  for (var i = 0; i < LK_CARDS; i++) {
    h += '<button type="button" class="lk-card" data-i="' + i + '" aria-label="Card ' + (i + 1) + '" style="--d:' + (((i % 3) + Math.floor(i / 3)) * 0.35).toFixed(2) + 's" onclick="lkTap(' + i + ')"><span class="lk-in">' +
      '<span class="lk-face lk-back"><img class="lk-bimg" src="" alt=""><i class="lk-sheen"></i><i class="lk-mark">' + LK_STAR + '</i></span>' +
      '<span class="lk-face lk-front"></span></span></button>';
  }
  g.innerHTML = h;
}
function lkLocked(l){ return l.on === false || (l.minVip > 0 && l.vip < l.minVip); }
function renderLucky(){
  var g = $('lkGrid'); if (!g) return;
  lkBuild();
  var l = lkInfo(), src = iconUrl('robots');
  g.querySelectorAll('.lk-bimg').forEach(function(im){ if (im.getAttribute('src') !== src) im.setAttribute('src', src); });
  $('lkChances').textContent = String(l.chances || 0); $('lkChLbl').textContent = (l.chances || 0) === 1 ? 'Chance' : 'Chances';
  $('lkChip').classList.toggle('on', l.chances > 0 && !lkLocked(l));
  var rt = document.querySelector('.tab[data-tab="rewards"]'); if (rt) rt.classList.toggle('has-chance', l.chances > 0 && !lkLocked(l));
  var win = 'Win ' + ugx(l.minAmount) + (l.maxAmount > l.minAmount ? ' to ' + ugx(l.maxAmount) : '') + (l.hasProducts ? ' or an AI robot' : '');
  $('lkRange').textContent = l.on === false ? '' : win;
  var note;
  if (l.on === false) note = 'Lucky Cards are paused right now.';
  else if (l.minVip > 0 && l.vip < l.minVip) note = 'Reach VIP ' + l.minVip + ' to open your cards. Every chance you earn is kept for you.';
  else if (l.chances > 0) note = l.chances === 1 ? 'You have 1 chance. Pick a card.' : 'You have ' + l.chances + ' chances. Pick a card.';
  else note = 'Recharge to earn a chance, then flip any card.';
  if (!_lk.revealed && !_lk.busy) $('lkNote').textContent = note;
  g.classList.toggle('locked', lkLocked(l) && !_lk.revealed);
  g.classList.toggle('idle', !(l.chances > 0) && !_lk.revealed);
  var rb = $('lkRecharge'); if (rb) rb.style.display = (!_lk.revealed && l.on !== false && !(l.chances > 0)) ? '' : 'none';
}
function lkFront(p, win){
  if (p.kind === 'robot') return '<span class="lk-fx"></span><img class="lk-rimg" src="' + esc(p.image || iconUrl('robots')) + '" alt=""><b class="lk-nm">' + esc(p.name) + '</b><small>AI robot</small>';
  var t = ugx(p.amount);
  return '<span class="lk-fx"></span><svg class="lk-coin" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="18" fill="url(#lkGold)" stroke="#d98600" stroke-width="2"/><circle cx="20" cy="20" r="12.5" fill="none" stroke="#fff3b8" stroke-width="1.6"/><text x="20" y="25.6" text-anchor="middle" font-size="15" font-weight="900" fill="#b36b00" font-family="system-ui,sans-serif">U</text></svg><b class="lk-amt' + (t.length > 10 ? ' long' : '') + '" data-to="' + Math.round(p.amount) + '">' + t + '</b><small>Earnings</small>';
}
function lkCountUp(el){
  var to = Number(el.getAttribute('data-to')) || 0; if (!to) return;
  var start = null, dur = 800;
  function step(ts){
    if (start === null) start = ts;
    var k = Math.min(1, (ts - start) / dur), e = 1 - Math.pow(1 - k, 3);
    el.textContent = ugx(Math.round(to * e));
    if (k < 1 && el.isConnected) requestAnimationFrame(step); else el.textContent = ugx(to);
  }
  el.textContent = ugx(0); requestAnimationFrame(step);
}
function lkSparks(card){
  var h = '<i class="lk-ring"></i>';
  for (var i = 0; i < 16; i++) {
    var a = (i / 16) * Math.PI * 2 + Math.random() * 0.3, d = 54 + Math.random() * 42;
    h += '<i class="lk-sp" style="--dx:' + Math.round(Math.cos(a) * d) + 'px;--dy:' + Math.round(Math.sin(a) * d) + 'px;--s:' + (0.6 + Math.random() * 0.9).toFixed(2) + ';animation-delay:' + Math.round(Math.random() * 120) + 'ms"></i>';
  }
  var box = document.createElement('span'); box.className = 'lk-burst'; box.innerHTML = h; card.appendChild(box);
  setTimeout(function(){ if (box.parentNode) box.parentNode.removeChild(box); }, 1300);
}
async function lkTap(i){
  var l = lkInfo(), cards = $('lkGrid').children, card = cards[i];
  if (_lk.busy || Date.now() - (_lk.enterAt || 0) < 600) return;
  if (_lk.revealed) { toast('Tap Flip again for another card'); return; }
  if (l.on === false) { toast('Lucky Cards are not available right now'); shakeVibrate(card); return; }
  if (l.minVip > 0 && l.vip < l.minVip) { toast('Reach VIP ' + l.minVip + ' to open your cards'); shakeVibrate(card); return; }
  if (!(l.chances > 0)) { toast('Recharge to get a chance to flip a card'); shakeVibrate(card); return; }
  _lk.busy = true;
  $('lkGrid').classList.add('busy'); card.classList.add('lift');
  if (navigator.vibrate) navigator.vibrate(18);
  var t0 = Date.now();
  var r = await api('/lucky/flip', {});
  var wait = 560 - (Date.now() - t0);
  if (wait > 0) await new Promise(function(ok){ setTimeout(ok, wait); });
  if (r.stale || !STATE) { _lk.busy = false; card.classList.remove('lift'); $('lkGrid').classList.remove('busy'); return; }
  if (r.status !== 'success') {
    card.classList.remove('lift'); $('lkGrid').classList.remove('busy'); _lk.busy = false;
    toast(r.message || 'Could not open the card');
    shakeVibrate(card);
    if (r.code === 'NO_CHANCE' || r.code === 'VIP_REQUIRED' || r.code === 'LUCKY_OFF') refreshFromServer().then(function(){ if (STATE) renderAll(); }).catch(function(){});
    return;
  }
  lkReveal(i, r);
}
function lkReveal(i, r){
  var cards = $('lkGrid').children, k = 0, j;
  _lk.revealed = true;
  for (j = 0; j < cards.length; j++) cards[j].querySelector('.lk-front').innerHTML = lkFront(j === i ? r.prize : (r.others[k++] || r.prize), j === i);
  var winCard = cards[i];
  winCard.classList.add('flip', 'win');
  if (navigator.vibrate) navigator.vibrate([30, 40, 60]);
  lkLater(function(){ lkSparks(winCard); var a = winCard.querySelector('.lk-amt'); if (a) lkCountUp(a); }, 380);
  var order = 0;
  for (j = 0; j < cards.length; j++) {
    if (j === i) continue;
    (function(c, n){ lkLater(function(){ c.classList.add('flip', 'dim'); }, 760 + n * 70); })(cards[j], order++);
  }
  if (STATE && STATE.lucky) STATE.lucky.chances = Number(r.chances) || 0;
  lkLater(function(){
    var p = r.prize, left = Number(r.chances) || 0;
    $('lkNote').innerHTML = p.kind === 'robot' ? ('You won <b>' + esc(p.name) + '</b>. It is now in My AI robots.') : ('You won <b>' + ugx(p.amount) + '</b>. It is in your wallet.');
    $('lkResult').className = 'lk-result show';
    $('lkAgain').textContent = left > 0 ? 'Flip again (' + left + ' left)' : 'Recharge for another chance';
    $('lkAgain').onclick = left > 0 ? lkAgain : function(){ lkAgain(); openOverlay('deposit'); };
    _lk.busy = false; $('lkGrid').classList.remove('busy');
    refreshFromServer().then(function(){ if (STATE) { if (STATE.lucky && _lk.revealed) STATE.lucky.chances = left; renderAll(); } }).catch(function(){});
  }, 760 + 8 * 70 + 760);
}
function lkAgain(){
  if (_lk.busy) return;
  lkClearTimers();
  var cards = $('lkGrid').children, n = 0;
  for (var j = 0; j < cards.length; j++) { (function(c, d){ setTimeout(function(){ c.classList.remove('flip', 'dim', 'win', 'lift'); }, d); })(cards[j], n++ * 45); }
  $('lkResult').className = 'lk-result';
  setTimeout(function(){
    for (var j2 = 0; j2 < cards.length; j2++) cards[j2].querySelector('.lk-front').innerHTML = '';
    _lk.revealed = false; renderLucky();
  }, 460 + cards.length * 45);
}
// Coming back to the Rewards tab after a finished round starts a fresh board.
function lkResetIfDone(){ if (_lk.revealed && !_lk.busy) { var cards = $('lkGrid').children; for (var j = 0; j < cards.length; j++) { cards[j].classList.remove('flip', 'dim', 'win', 'lift'); cards[j].querySelector('.lk-front').innerHTML = ''; } $('lkResult').className = 'lk-result'; _lk.revealed = false; renderLucky(); } }

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
// Each brand button opens that app's own share screen with the invite link; TikTok has no web share page, so it hands the link to the phone's share sheet (or copies it).
function shareTo(kind){
  var link = freshPromoLink();
  if (!link) { toast('Your invite link is not ready yet.'); return; }
  var words = String(getSettings().shareMessage || 'Join me on {app}').replace(/\{app\}/gi, brandName());
  var u = encodeURIComponent(link), t = encodeURIComponent(words);
  var url = '';
  if (kind === 'tg') url = 'https://t.me/share/url?url=' + u + '&text=' + t;
  else if (kind === 'wa') url = 'https://wa.me/?text=' + encodeURIComponent(words + ' ' + link);
  else if (kind === 'fb') url = 'https://www.facebook.com/sharer/sharer.php?u=' + u;
  if (url) { window.open(url, '_blank', 'noopener'); return; }
  if (navigator.share) { navigator.share({ title: brandName(), text: words, url: link }).catch(function(){}); return; }
  copyText(link, 'Link copied. Paste it in TikTok.');
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
// The robot picture shown as a member's profile icon (the one on the number card of Me, or the admin's own upload).
function profileIconHtml(){
  return '<img' + (ART.profilelogo ? '' : ' data-icon="robots"') + ' src="' + esc(ART.profilelogo || iconUrl('robots')) + '" alt="">';
}
async function openTeamLevel(level){
  openOverlay('teamlevel');
  $('teamLevelTitle').textContent = 'Level ' + level + ' subordinates';
  $('teamLevelList').innerHTML = spinnerHtml();
  var r = await api('/team/members?level=' + level);
  if (r.stale) return;
  if (r.status !== 'success') { $('teamLevelList').innerHTML = '<div class="empty">Could not load this list. Try again.</div>'; return; }
  var list = r.members || [];
  if (!list.length) { $('teamLevelList').innerHTML = '<div class="empty">No Level ' + level + ' subordinates yet.</div>'; return; }
  // Every row is a real figure off the server (what that member has invested), never a vague phrase: a member who has not invested shows UGX 0.
  var rows = list.map(function(m){
    var display = m.phoneMasked || m.phone || 'Not set';
    var joined = tsMs(m.createdAt) ? new Date(tsMs(m.createdAt)).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Unknown';
    var invested = Number(m.invested) || 0;
    return '<div class="flat-row"><div class="flat-avatar">' + profileIconHtml() + '</div>' +
      '<div class="flat-main"><b>' + esc(display) + '</b><span>Joined ' + esc(joined) + '</span></div>' +
      '<div class="flat-amt' + (invested > 0 ? ' pos' : ' zero') + '">' + ugx(invested) + '</div></div>';
  }).join('');
  $('teamLevelList').innerHTML = '<div class="muted" style="font-size:12px;margin-bottom:2px">' + list.length + ' subordinate' + (list.length === 1 ? '' : 's') + '</div><div class="flat-list">' + rows + '</div>';
}

/* ====================== NOTICES ====================== */
function toast(msg){
  var bg = $('toastBg'); $('toast').textContent = msg; bg.classList.add('show');
  clearTimeout(window._tTimer); window._tTimer = setTimeout(function(){ bg.classList.remove('show'); }, 2000);   // shown for 2 seconds, then it fades away
}

/* ====================== START ====================== */
// Real entry happens in onFbAuthChanged() once the sign-in script has said who (if anyone) is signed in. STATE is null until then.
captureReferralFromUrl();
applyBrandName();
paintIconSizes();
syncPageParticles();
paintAuthArt();
setAuthMode(authMode);
window.addEventListener('snow-auth', function(ev){ onFbAuthChanged(ev.detail); });
// The sign-in script announces who is signed in once, as soon as the page is parsed. This code unpacks a little later (on a slow phone, much later):
// if that already happened nobody was listening, so it is taken from the sign-in script directly.
if (window._smartaiAuthFired && window.fbAuth) onFbAuthChanged(window.fbAuth.currentUser);
