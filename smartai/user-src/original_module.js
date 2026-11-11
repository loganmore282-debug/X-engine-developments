/* Smart AI member app.
   The pages are ChocoMCC's (Home, AI Robots, Rewards, Team, Me and their full-screen sheets) in blue and white with the owner's icons,
   running on Smart AI's own server: its sign-in (/auth/*), 6-digit Trade Password, deposits, withdrawals and rewards. */
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
  supportTelegram: '', telegramGroup: '', telegramChannel: '', supportHours: '', whatsappGroup: '', whatsappContact: '',
  rulesText: '', annEnabled: false, annTitle: '', annBody: '', pageParticles: false, homeBannerTitle: '', homeBannerText: '', myBannerOpacity: 100, myBannerBlur: 0, navIconSize: 26, homeIconSize: 34, meIconSize: 36, giftCodeHint: 'Enter gift code'
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
        var movesMoney = /^\/(deposit|invest|withdraw|redeem|salary\/claim|checkin)/.test(path);
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
    STATE.checkinStreak = a.checkinStreak || 0; STATE.lastCheckin = a.lastCheckin || null;
    STATE.referralCode = a.referralCode || STATE.referralCode;
    STATE.hasTradePin = a.hasTradePin === true;
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
var ICON_VER = '70';
function iconUrl(name){ return (STATE_ICONS && STATE_ICONS[name]) || '/icons/' + name + '.webp?v=' + ICON_VER; }
function customIcon(name){ return (STATE_ICONS && STATE_ICONS[name]) || ''; }
function paintIcons(){
  paintMedals();
  paintGift();
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
// The gift (an inline SVG; the gradients live once in the page, #gbL ...): sharp at any size. Its idle loop copies the original recording: the whole box squashes fat with its walls bowed out, snaps tall with the walls pinched in, then the lid lifts over a yellow glow as if the box were about to burst. Every wall is a polygon re-drawn each frame through gbWarp(), so the walls really bend. The opened box with its coins is a picture (gift-open.webp).
var GB_PARTS = [
  // [lid?, closed subpaths, fill / stroke attributes]
  [0, [[[38,100],[100,124],[100,182],[38,158]]], 'fill="url(#gbL)"'],
  [0, [[[100,124],[162,100],[162,158],[100,182]]], 'fill="url(#gbR)"'],
  [0, [[[62,109.3],[78,115.5],[78,173.5],[62,167.3]]], 'fill="url(#gbRib)"'],
  [0, [[[122,115.5],[138,109.3],[138,167.3],[122,173.5]]], 'fill="url(#gbRibD)"'],
  [0, [[[44,106],[53,109.5],[53,153],[44,149.5]]], 'fill="#fff" opacity=".28"'],
  [0, [[[38,100],[100,124],[162,100]], [[38,100],[38,158],[100,182],[162,158],[162,100]], [[100,124],[100,182]]], 'fill="none" stroke="#1c63c4" stroke-width="1.6" stroke-linejoin="round" opacity=".75" data-open="1"'],
  [0, [[[38,100],[100,76],[162,100],[100,124]]], 'class="gb-slit" fill="url(#gbGlow)"'],
  [1, [[[34,77],[100,102],[100,126],[34,101]]], 'fill="url(#gbL)"'],
  [1, [[[100,102],[166,77],[166,101],[100,126]]], 'fill="url(#gbR)"'],
  [1, [[[62,87.6],[78,93.7],[78,117.7],[62,111.6]]], 'fill="url(#gbRib)"'],
  [1, [[[122,93.7],[138,87.6],[138,111.6],[122,117.7]]], 'fill="url(#gbRibD)"'],
  [1, [[[100,52],[166,77],[100,102],[34,77]]], 'fill="url(#gbT)"'],
  [1, [[[62,87.6],[78,93.7],[144,68.7],[128,62.6]]], 'fill="url(#gbRib)"'],
  [1, [[[122,93.7],[138,87.6],[72,62.6],[56,68.7]]], 'fill="url(#gbRib)"'],
  [1, [[[56,70],[96,55.5],[126,66.5],[110,74]]], 'fill="#fff" opacity=".22"'],
  [1, [[[34,77],[100,102],[166,77]], [[34,77],[34,101],[100,126],[166,101],[166,77]], [[100,102],[100,126]], [[34,77],[100,52],[166,77]]], 'fill="none" stroke="#1c63c4" stroke-width="1.6" stroke-linejoin="round" opacity=".75" data-open="1"'],
  [1, [[[40,82],[47,84.6],[47,98],[40,95.4]]], 'fill="#fff" opacity=".3"']
];
var GB_BOW = '<path d="M100 76C86 42 52 40 54 62C56 78 86 82 100 76Z" fill="url(#gbRib)" stroke="#d98600" stroke-width="1.6"/><path d="M100 76C114 42 148 40 146 62C144 78 114 82 100 76Z" fill="url(#gbRibD)" stroke="#d98600" stroke-width="1.6"/><path d="M92 69C82 54 66 52 66 62C68 70 84 74 92 69Z" fill="#7a4a00" opacity=".55"/><path d="M108 69C118 54 134 52 134 62C132 70 116 74 108 69Z" fill="#7a4a00" opacity=".55"/><path d="M90 60C80 50 66 51 64 58" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" opacity=".55"/><circle cx="100" cy="76" r="10" fill="url(#gbRib)" stroke="#d98600" stroke-width="1.6"/><path d="M94 73a8 8 0 0 1 8-3" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" opacity=".7"/>';
// Poses read off the recording (t = share of the 0.433 s loop): s = height (1 = normal), b = how far the walls bow out (negative = pinched in), lift = how far the lid is up.
var GB_KEYS = [
  [0,.90,11,0],[.04,1,1,0],[.08,1,0,0],[.12,1.07,-6,0],[.20,1.08,-7,0],[.24,1.05,-4,6],[.30,1.04,-3,22],[.40,1.02,-2,24],
  [.50,1,0,22],[.55,1,0,12],[.58,1,0,0],[.62,1,0,0],[.66,.97,3,0],[.74,.94,6,0],[.85,.91,10,0],[1,.90,11,0]
];
function gbPose(t){
  var k = GB_KEYS, i = 1;
  while (i < k.length - 1 && t > k[i][0]) i++;
  var a = k[i - 1], c = k[i], f = c[0] > a[0] ? (t - a[0]) / (c[0] - a[0]) : 1;
  f = f * f * (3 - 2 * f);
  return { s: a[1] + (c[1] - a[1]) * f, b: a[2] + (c[2] - a[2]) * f, lift: a[3] + (c[3] - a[3]) * f };
}
// One point of the box through a pose: squash/stretch about the floor, walls bowed by a sine over the height, a fatter box when short and a slimmer one when tall.
function gbWarp(x, y, o, lid){
  var tt = Math.min(1, Math.max(0, (182 - y) / 130)), w = o.s < 1 ? 1 + (1 - o.s) * 0.9 : 1 - (o.s - 1) * 0.5;
  return [100 + (x - 100) * w + o.b * ((x - 100) / 66) * Math.sin(Math.PI * tt), 182 - (182 - y) * o.s - (lid ? o.lift : 0)];
}
function gbPath(subs, o, lid, open){
  var d = '', si, pi, n, p, q, e, pts;
  for (si = 0; si < subs.length; si++) {
    pts = subs[si]; d += 'M';
    for (pi = 0; pi < pts.length; pi++) {
      p = pts[pi]; q = pts[(pi + 1) % pts.length];
      if (open && pi === pts.length - 1) { e = gbWarp(p[0], p[1], o, lid); d += e[0].toFixed(1) + ' ' + e[1].toFixed(1); break; }
      for (n = 0; n < 6; n++) { e = gbWarp(p[0] + (q[0] - p[0]) * n / 6, p[1] + (q[1] - p[1]) * n / 6, o, lid); d += e[0].toFixed(1) + ' ' + e[1].toFixed(1) + 'L'; }
    }
    d = d.replace(/L$/, '') + (open ? '' : 'Z');
  }
  return d;
}
function gbSvg(t){
  var o = gbPose(t), body = '', lid = '', i, P, d;
  for (i = 0; i < GB_PARTS.length; i++) {
    P = GB_PARTS[i]; d = gbPath(P[1], o, P[0], /data-open/.test(P[2]));
    (P[0] ? (lid += '<path d="' + d + '" ' + P[2] + '/>') : (body += '<path d="' + d + '" ' + P[2] + '/>'));
  }
  return '<svg class="gb" viewBox="0 0 200 210" aria-hidden="true"><ellipse class="gb-sh" cx="100" cy="190" rx="66" ry="11" fill="rgba(8,40,110,.28)"/><g class="gb-body">' + body + '</g><g class="gb-lid">' + lid + '<g class="gb-bow">' + GB_BOW + '</g></g></svg>';
}
// Redraws one gift at time t: every wall path in the order the markup lists them, the glow under the lifted lid, the bow riding on the lid, and the shadow.
function gbDraw(svg, t, pose){
  var o = pose || gbPose(t), paths = svg.querySelectorAll('.gb-body > path, .gb-lid > path'), i, P, w = o.s < 1 ? 1 + (1 - o.s) * 0.9 : 1 - (o.s - 1) * 0.5;
  for (i = 0; i < GB_PARTS.length && i < paths.length; i++) {
    P = GB_PARTS[i]; paths[i].setAttribute('d', gbPath(P[1], o, P[0], /data-open/.test(P[2])));
    if (paths[i].classList.contains('gb-slit')) paths[i].style.opacity = Math.min(1, o.lift / 8).toFixed(2);
  }
  var bow = svg.querySelector('.gb-bow'), by = 182 - 106 * o.s - o.lift;
  if (bow) bow.setAttribute('transform', 'translate(100 ' + by.toFixed(1) + ') scale(' + w.toFixed(3) + ' ' + o.s.toFixed(3) + ') translate(-100 -76)');
  var sh = svg.querySelector('.gb-sh'); if (sh) sh.setAttribute('rx', (66 * w).toFixed(1));
}
// The claim: while the code is checked the box shakes and SWELLS (walls bulging more and more, the lid rattling); when the answer is yes it BANGS (puffs up fat, the lid blown
// off) and the opened box takes its place. _giftPhaseAt = when the stage entered that phase.
var _giftPhaseAt = 0;
function gbSwellPose(ms){
  var p = Math.min(1, ms / 1100), e = p * p * (3 - 2 * p), sh = Math.sin(ms / 22) * (0.4 + 2.2 * e);
  return { s: 1 + 0.16 * e + 0.012 * sh, b: 4 + 20 * e + sh, lift: 1 + 6 * e * Math.abs(Math.sin(ms / 45)) };
}
function gbBangPose(ms){
  var p = Math.min(1, ms / 260), e = 1 - Math.pow(1 - p, 3);
  return { s: 1.16 + 0.26 * e, b: 24 + 14 * e, lift: 8 + 70 * e };
}
var GB_SVG = gbSvg(0.5);
function giftPreload(){ var c = customIcon('giftopen'); if (c) { var op = new Image(); op.src = c; } }
function paintGift(){
  var custom = customIcon('giftbox');
  document.querySelectorAll('.gbox').forEach(function(el){
    // A picture uploaded in Admin > Banners > Animations stands still in place of the gift; Back to default brings the animation.
    if (custom) { el.classList.add('custom'); el.innerHTML = ''; el.style.backgroundImage = 'url("' + String(custom).replace(/"/g, '%22') + '")'; return; }
    el.classList.remove('custom'); el.style.backgroundImage = '';
    if (!el.firstChild) el.innerHTML = GB_SVG;
  });
  // The opened box is vector too; a picture uploaded for it in the admin replaces it, Back to default brings the vector back.
  var cu = document.querySelector('.go-custom'), cv = document.querySelector('.gs-open svg.go'), cust = customIcon('giftopen');
  if (cu && cv) { if (cust) cu.setAttribute('src', cust); else cu.removeAttribute('src'); cu.hidden = !cust; cv.style.display = cust ? 'none' : ''; cv.parentNode.classList.toggle('custom-open', !!cust); }
}
var _animLast = -1;
function animTick(){
  var dls = document.querySelectorAll('svg.dl'), meds = document.querySelectorAll('.medal.live'), gbs = document.querySelectorAll('.gbox svg.gb'), n = dls.length + meds.length + gbs.length;
  if (n && !document.hidden) {
    var now = Date.now(), c, i, j, ch;
    if (dls.length) {
      c = dlCircles((now % 2000) / 1000);
      for (i = 0; i < dls.length; i++) { ch = dls[i].children; for (j = 0; j < 12; j++) { ch[j].setAttribute('cx', c[j][0].toFixed(1)); ch[j].setAttribute('cy', c[j][1].toFixed(1)); ch[j].setAttribute('r', c[j][2].toFixed(1)); } }
    }
    for (i = 0; i < gbs.length; i++) {
      if (!gbs[i].getBoundingClientRect().width) continue;
      var stg = gbs[i].closest('.gs'), ph = stg && stg.classList.contains('gs-opening') ? gbSwellPose(now - _giftPhaseAt) : stg && stg.classList.contains('gs-bang') ? gbBangPose(now - _giftPhaseAt) : null;
      gbDraw(gbs[i], (now % 433) / 433, ph);
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
  else if (name === 'deposit') again = refreshDepositSlot;
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
    checkinStreak: 0, lastCheckin: null, team: { l1: 0, l2: 0, l3: 0, commission: 0 },
    hasTradePin: false, withdrawAnytime: false,
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
      return fetch(API_BASE + '/auth/session/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + t }, signal: ac.signal });
    }).catch(function(){});
    _authEpoch++;
    STATE = null; _appEntered = false;
    clearCachedState();
    _recordsLoaded = { accrued: true, topups: false, cashouts: false }; _recordsFailed = { topups: false, cashouts: false }; _dataFailed = {};
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
  setTimeout(medalPreload, 700);
  setTimeout(giftPreload, 900);
  startAccountPoll();
  updateDownloadTileVisibility();
  syncArtwork();
  refreshDepositSlot();
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
    var c = s.getContext('2d'), gr = c.createRadialGradient(24, 24, 0, 24, 24, 24);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(' + r + ',' + g + ',' + b + ',1)');
    gr.addColorStop(0.6, 'rgba(' + r + ',' + g + ',' + b + ',0.26)'); gr.addColorStop(1, 'rgba(' + r + ',' + g + ',' + b + ',0)');
    c.fillStyle = gr; c.fillRect(0, 0, 48, 48); return s;
  }
  var SP = [sprite(30, 120, 255), sprite(70, 160, 255), sprite(120, 200, 255), sprite(190, 240, 255)];
  function size(){
    var w = cv.clientWidth, h = cv.clientHeight, d = Math.min(window.devicePixelRatio || 1, 2);
    if (!w || !h) return false;
    if (w !== W || h !== H || d !== dpr) { W = w; H = h; dpr = d; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    return true;
  }
  function sm(a, b, x){ x = Math.max(0, Math.min(1, (x - a) / (b - a))); return x * x * (3 - 2 * x); }
  var ZN = 1, ZF = 5, CAMH = 1.2;     // nearest and farthest distance of the sheet, camera height (world units)
  function draw(t){
    if (!size()) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    var dim = opt.dim == null ? 1 : opt.dim, k = (opt.scale || 1) * Math.max(0.8, Math.min(1.5, W / 390));
    var y0 = H * (opt.horizon == null ? 0.16 : opt.horizon), fx = W * 0.9, fy = (H * 1.1 - y0) * ZN / CAMH, range = ZF - ZN;
    var DX = 1 / (fx / W * 6.5), DZ = Math.max(0.03, (W / 13) / (H * 1.1 - y0)), NR = Math.min(150, Math.ceil(range / DZ)), NC = Math.ceil((W / 2) * ZF / fx / DX) + 1;   // about 6 dots across the near rows, rows half as far apart as columns
    var zr = 3.7 + 0.6 * Math.sin(t * 0.27), xr = 1.3 * Math.sin(t * 0.21);          // where the bright crest is now (distance, and how far it leans left or right)
    var r, c;
    for (r = 0; r < NR; r++) {
      var z = ZN + (((r * DZ - t * 0.4) % range) + range) % range;
      var zn = (z - ZN) / range;                                                      // 0 near ... 1 far
      var fade = sm(0, 0.05, zn) * (1 - sm(0.94, 1, zn));
      if (fade < 0.01) continue;
      var big = 0.03 + 0.42 * sm(0.15, 0.95, zn);                                     // the swells grow toward the far hills
      var ridge = Math.exp(-Math.pow((z - zr) / 0.32, 2));
      var spr = zn < 0.3 ? SP[0] : (zn < 0.65 ? SP[1] : SP[2]);
      var base = 3.9 * k * Math.pow(ZN / z, 0.95);
      for (c = -NC; c <= NC; c++) {
        var x = c * DX;
        x += 0.1 * Math.sin(1.7 * z + 0.8 * t + 0.35 * x) * (0.2 + zn);                // the lines sway sideways in S-curves
        var h = big * (Math.sin(0.7 * x + 1.5 * z - 0.9 * t) + 0.6 * Math.sin(-1.1 * x + 0.8 * z + 0.7 * t) + 0.35 * Math.sin(2 * x + 2 * z - 1.3 * t));
        h += 0.045 * x * x * sm(0.1, 1, zn);                                           // the far sides curl up like a bowl
        var rw = ridge * Math.exp(-Math.pow((x - xr) / 3.2, 2) * 0.35);
        h += rw * (0.16 + 0.06 * Math.sin(3.4 * x + 2.6 * z - 2.4 * t));               // the crest, with quick little ripples along it
        var px = W / 2 + fx * x / z, py = y0 + fy * (CAMH - h) / z;
        if (px < -12 || px > W + 12 || py < -12 || py > H + 12) continue;
        var a = fade * dim * (0.62 + 0.3 * zn + 0.55 * rw) * (0.84 + 0.16 * Math.sin(t * 1.7 + c * 1.3 + r * 0.7));
        if (a < 0.03) continue;
        var rad = Math.max(0.6 * k, base) * (1 + 0.3 * rw);
        ctx.globalAlpha = Math.min(1, a);
        if (rad < 1.3) { ctx.fillStyle = rw > 0.35 ? '#d8f4ff' : '#7cc0ff'; ctx.fillRect(px - rad, py - rad, rad * 2, rad * 2); }
        else { var R = rad * 3; ctx.drawImage(rw > 0.45 ? SP[3] : spr, px - R, py - R, R * 2, R * 2); }
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
    running: function(){ return !!raf; }
  };
}
var _annField = null, _payField = null, _scrollLocked = false, _lockY = 0;
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
  b.classList.toggle('pf-on', on);
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
  if (immediateShake) tgRow.querySelectorAll('.tg-pill,.wa-pill').forEach(function(el){ el.style.animationDelay = '-2.4s, -2.4s'; });
  $('announcementBg').classList.add('show');
  if (!_annField) _annField = makeParticleField($('annFx'), { horizon: 0.1, dim: 0.5, alive: function(){ return $('announcementBg').classList.contains('show'); } });
  _annField.start();
  startAnnEmoji();
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
function maybeOfferInstallAfterSignup(){
  if (isStandalone()) return;
  try { if (STATE && STATE.uid && localStorage.getItem('smartai_install_dismissed_' + STATE.uid)) return; } catch (e) {}
  // After the welcome picture (if there is one) has been seen, and not if the member has already signed out.
  setTimeout(function(){ if (STATE && _appEntered && !document.querySelector('.modal-bg.show')) openInstallSheet(); }, 4000);
}

/* ====================== SMALL DIALOGS ======================
   The Trade Password is asked in a small dialog when a member cashes out (or changes a payout setting). It resolves
   with the typed text, or null when the member cancels. */
function closeAllSheets(){
  ['networkPickerBg', 'tradePinBg', 'installSheetBg', 'announcementBg', 'changePinBg'].forEach(function(id){ var el = $(id); if (el) el.classList.remove('show'); });
  if (_pinResolve) { var r = _pinResolve; _pinResolve = null; r(null); }
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
  renderCheckin();
  renderMeRows();
  renderFeatured(); renderTicker(); renderShop(); renderRecords();
}
// The daily reward card (Rewards tab).
// The daily check-in CALENDAR: 30 days, the ladder of amounts along it (Admin > Settings > Daily check-in calendar; empty = one flat amount). A claimed day is filled
// blue, the day the next tap pays is outlined and pulses. Day 31 starts the cycle again, and a missed day sends the run back to day 1 (the server decides; this only draws it).
function cleanLadder(v){ return (Array.isArray(v) ? v : []).map(Number).filter(function(n){ return isFinite(n) && n >= 1; }).slice(0, 30); }
function serverYesterdayKey(){
  var d = new Date(Date.now() + 3 * 3600000 - 86400000), p = function(n){ return String(n).padStart(2, '0'); };
  return p(d.getUTCMonth() + 1) + '/' + p(d.getUTCDate()) + '/' + d.getUTCFullYear();
}
var _calToday = 0, _calPop = 0;   // the day a claim would pay now / the day just claimed (its tick pops)
function renderCheckin(){
  var s = STATE, sett = getSettings(), ladder = cleanLadder(sett.checkinLadder), flat = Math.round(Number(sett.dailyCheckin) || 0);
  var card = $('checkinCard'); if (card) card.style.display = (ladder.length || flat > 0) ? '' : 'none';
  var amtFor = function(day){ return ladder.length ? ladder[(day - 1) % ladder.length] : flat; };
  var done = s.lastCheckin === serverTodayKey();
  var alive = s.checkinStreak > 0 && (done || s.lastCheckin === serverYesterdayKey());
  var cyclePos = alive ? ((s.checkinStreak - 1) % 30) + 1 : 0;           // days of this cycle already claimed
  var claimed = done ? cyclePos : (cyclePos === 30 ? 0 : cyclePos);        // day 31 = day 1 of the next cycle
  var todayPos = done ? 0 : claimed + 1;
  _calToday = todayPos;
  var btn = $('checkinBtn');
  if (!btn.dataset.busy) {
    btn.innerHTML = done ? '<span class="tick-txt">\u2713\uFE0E</span> Claimed today' : ('Check in for ' + ugx(amtFor(todayPos)));
    btn.disabled = done; btn.style.opacity = done ? '.55' : '1';
  }
  $('streakNum').textContent = alive ? s.checkinStreak : 0;
  var cells = '';
  for (var i = 1; i <= 30; i++) {
    cells += '<div class="cal-d' + (i <= claimed ? ' done' : '') + (i === _calPop && i <= claimed ? ' pop' : '') + (i === todayPos ? ' today' : '') + '"><span class="cal-n">' + i + '</span><span class="cal-a">' + String(amtFor(i)).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '</span></div>';
  }
  $('calGrid').innerHTML = cells;
  _calPop = 0;   // the tick pops once, on the render right after a claim
  var nextDay = done ? (cyclePos % 30) + 1 : todayPos;
  $('streakCycleLabel').textContent = done ? ('Day ' + cyclePos + ' claimed. Tomorrow pays ' + ugx(amtFor(nextDay))) : (claimed > 0 ? ('Today is day ' + todayPos + ' of 30: ' + ugx(amtFor(todayPos))) : ('Start your run today: ' + ugx(amtFor(1))));
  var gc = $('giftCodeInput'); if (gc) gc.placeholder = getSettings().giftCodeHint || 'Enter gift code';
}
// The Me page: the Download App tile follows whether the app is already installed.
function renderMeRows(){
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
  // Settlement is done by the server (a payment at 00:00 every day); this only reshapes what refreshFromServer() stored.
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
  scheduleAccountPoll();
}
function startAccountPoll(){ scheduleAccountPoll(); }
function stopAccountPoll(){ clearTimeout(_accountPollTimer); _accountPollTimer = null; }
document.addEventListener('visibilitychange', function(){
  if (!document.hidden && STATE) runAccountPoll();   // catch up the moment the app is brought back to the front
});

/* ====================== LEDGER — Accrued (income) / Topups (deposits) / Cash Outs (withdrawals) ====================== */
var _recordsTab = 'accrued';
var _recordsLoaded = { accrued: true, topups: false, cashouts: false }, _recordsFailed = { topups: false, cashouts: false };
// The kinds of ledger row that are money coming IN as earnings (the Accrued tab). A top-up is in Topups and a cash-out is in Cash Outs.
var INCOME_TYPES = ['cashback', 'checkin', 'commission', 'mission_salary', 'promocode', 'welcome_bonus', 'admin_credit', 'investment_refund'];
var REC_TYPE_LABEL = { cashback: 'AI robot income', checkin: 'Daily reward', commission: 'Referral commission', mission_salary: 'Task Center reward', promocode: 'Gift code',
  welcome_bonus: 'Welcome gift', admin_credit: 'Account credit', investment_refund: 'Product refund' };
function recStatusInfo(s){
  s = String(s || 'success').toLowerCase();
  if (['success', 'matched', 'processed'].indexOf(s) !== -1) return { label: 'Completed', cls: 'ok' };
  if (s === 'awaiting_verification') return { label: 'Pending Review', cls: 'proc' };
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
var _tabAsk = null;   // the request the last tab switch sent; a caller that wants to scroll inside the new tab waits for it so the page is built first
function switchTab(name){
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
  if (STATE && (name === 'rewards' || name === 'team' || name === 'share' || name === 'home')) renderAll();
  if (name === 'account' && STATE && _lastTab !== 'account') countMyBalances();
  if (name === 'team') medalPreload();
  if (name === 'rewards') giftPreload();
  // Coming back to Home from another tab shows the announcement again (its buttons shaking straight away).
  if (enteringHomeFromElsewhere) maybeShowAnnouncement(true);
  _lastTab = name;
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
  });
}
// One full-screen page at a time. The phone's Back button closes it (one history entry, replaced when one page opens another) instead of leaving the app.
var _ovOpen = false, _ovName = '';
function hideOverlays(){ document.querySelectorAll('.overlay').forEach(function(o){ o.classList.remove('show'); }); }
function openOverlay(name){
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
  navVeil(true, rt || overlayTask(name));
}
function closeOverlay(){
  if (!_ovOpen) { hideOverlays(); return; }
  _ovOpen = false;
  navVeil(false);
  hideOverlays();
  if (_lastTab === 'account') countMyBalances();   // back on Me: the balances count up again
  try { if (history.state && history.state.ov) history.back(); } catch (e) {}
}
window.addEventListener('popstate', function(){
  if (document.querySelector('.modal-bg.show:not(#giftRevealBg)')) closeAllSheets();
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
    renderAll(); toast('Rented ' + p.name + '!');
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

/* ====================== THE PAYMENT PAGE LOADER ======================
   While a payment is being checked the page shows the app's own dotted loader (the same dots as every page loader; animTick() moves it) in bright blue, big, over the full-page
   particle field. The field stops when the page is left. */
function showPayLoader(){
  var ic = $('depStatusIc'); if (!ic) return;
  ic.className = 'pay-status-ic dots';
  ic.innerHTML = dlMarkup();
  ic.setAttribute('role', 'img'); ic.setAttribute('aria-label', 'Checking your payment');
  if (!_payField) _payField = makeParticleField($('payFx'), { horizon: 0.12, dim: 0.55, alive: function(){ var o = $('ovDepositStatus'); return !!(o && o.classList.contains('show')); } });
  _payField.start();
}
function releasePayLoader(){ if (_payField) _payField.stop(); }

/* ====================== DEPOSIT STATUS (checks the payment by itself) ====================== */
// The first check comes 1 s after the page opens, then every 1.5 s (PesaJet's own SDK cadence); the server holds an automatic check for up to DEP_HOLD_MS while its own watcher is
// on the payment, so a settled payment shows at once. The Verify button never waits behind a held request. After DEP_POLL_MAX checks the page says so (Verify still works).
var DEP_POLL_FIRST_MS = 1000;
var DEP_POLL_EVERY_MS = 1500;
var DEP_POLL_MAX = 120;
var DEP_HOLD_MS = 8000;
function depositStatusHold(depositId){ return api('/deposit/marzpay/status', { depositId: depositId, waitMs: DEP_HOLD_MS }); }
function depositStatusCheck(depositId){ return api('/deposit/marzpay/status', { depositId: depositId }); }
var _depPollTimer = null, _depFirstTimer = null, _depPollAttempt = 0, _depPollId = null, _depConfirmed = false, _depPollChecking = false;
/* The picture shown while a payment is being checked is the app's dotted loader (see THE PAYMENT PAGE LOADER); the tick shows once it is paid. */
// The success tick and the failed cross (the owner's recordings, redrawn): a disc grows, a faint halo follows, the mark is drawn in.
// Disc radius 182, halo 300 (x1.65); check stroke 0.163 of the disc, X stroke 0.145; times measured at 60 pictures a second.
function tickHtml(){
  return '<svg viewBox="-300 -300 600 600" aria-hidden="true"><circle class="an-pop ok-halo" r="300" fill="rgba(3,239,0,.17)"/><circle class="an-pop ok-disc" r="182" fill="#03ef00"/><path class="ok-check" d="M-60 -4L-16 42L78 -53" fill="none" stroke="#111" stroke-width="30" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}
function crossHtml(){
  return '<svg viewBox="-310 -310 620 620" aria-hidden="true"><circle class="an-pop no-halo" r="303" fill="rgba(254,30,61,.15)"/><circle class="an-pop no-disc" r="187" fill="#fe1e3d"/><path class="no-x" d="M-51 -51L51 51M51 -51L-51 51" fill="none" stroke="#111" stroke-width="27" stroke-linecap="round"/></svg>';
}
var _depIcSuccess = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>';
function stopDepositPoll(){ clearInterval(_depPollTimer); clearTimeout(_depFirstTimer); _depPollTimer = null; _depFirstTimer = null; _depPollId = null; }
function openDepositStatus(depositId, reference, phone){
  _depPollId = depositId; _depPollAttempt = 0; _depConfirmed = false;
  showPayLoader();
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
  clearInterval(_depPollTimer); clearTimeout(_depFirstTimer);
  _depFirstTimer = setTimeout(pollDepositStatus, DEP_POLL_FIRST_MS);
  _depPollTimer = setInterval(pollDepositStatus, DEP_POLL_EVERY_MS);
}
function showDepositSuccess(){
  _depConfirmed = true;
  releasePayLoader();
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
  btn.onclick = function(){ closeOverlay(); switchTab('home'); renderAll(); };
}
function showDepositFailed(){
  releasePayLoader();
  $('depStatusIc').className = 'pay-status-ic anim';
  $('depStatusIc').innerHTML = customIcon('cross') ? '<img src="' + esc(customIcon('cross')) + '" alt="" style="width:100%;height:100%;object-fit:contain">' : crossHtml();
  $('depStatusTitle').textContent = 'Payment Not Completed';
  $('depStatusSteps').style.display = 'none';
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
    if (attEl) attEl.textContent = 'Auto-verifying… (attempt ' + _depPollAttempt + '/' + DEP_POLL_MAX + ')';
    var r = await (manual === true ? depositStatusCheck(_depPollId) : depositStatusHold(_depPollId));
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
        showDepositFailed();
        if (manual === true) toast('Declined: ' + (r.message || 'payment was not completed'));
        return;
      }
      if (manual === true) toast('Still pending, check your phone for the prompt');
    } else if (manual === true) {
      toast(r.message || 'Could not check the payment status right now');
    }
    if (_depPollAttempt >= DEP_POLL_MAX) {
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
function cancelDepositStatus(){ stopDepositPoll(); releasePayLoader(); closeOverlay(); if (STATE) renderAll(); }
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
var _withdrawBusy = false;
async function doWithdraw(){
  if (_withdrawBusy) return;
  var sett = getSettings();
  var amt = parseMoney($('witAmt').value);
  if (!amt) { toast('Enter a valid amount'); shakeVibrate($('witAmt')); return; }
  // The server checks every rule again; these checks only save the member a round trip.
  if (amt < sett.minWithdraw) { toast('Minimum cash-out is ' + ugx(sett.minWithdraw)); shakeVibrate($('witAmt'), $('witGoBtn')); return; }
  if (amt > STATE.balance) { toast('Insufficient balance'); shakeVibrate($('witAmt'), $('witGoBtn')); return; }
  var card = selectedBank();
  if (!card) { toast('Bind a mobile-money account first'); goBindBank(true); return; }
  var win = withdrawWindow(sett);
  if (win.enabled && !win.open && !STATE.withdrawAnytime) { toast('Withdraw is open from ' + win.from + ' to ' + win.to + '. Please come back then.'); return; }
  var pin = await askTradePin('Trade Password', 'Enter your 6-digit Trade Password to cash out ' + ugx(amt) + '.');
  if (pin === null) return;
  var btn = $('witGoBtn'), label = btn.textContent;
  _withdrawBusy = true;
  btn.disabled = true; btn.innerHTML = btnBusyHtml('Please wait…');
  var r;
  try {
    r = await api('/withdraw/request', { amount: amt, network: card.network, phone: card.phone, pin: pin });
  } finally {
    _withdrawBusy = false;
    btn.disabled = false; btn.textContent = label;
  }
  if (r.stale || !STATE) return;
  if (r.status !== 'success') {
    toast(r.message || 'Could not process the cash-out');
    return;
  }
  $('witAmt').value = ''; renderWitCalc();
  // The server took the money at once; show it gone now and let the refresh below confirm.
  STATE.balance = Math.max(0, STATE.balance - amt);
  closeOverlay(); renderAll();
  toast('Withdrawal submitted successfully');
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

/* ====================== DAILY REWARD, GIFT CODE ====================== */
async function doCheckin(){
  var btn = $('checkinBtn');
  if (btn) { if (btn.disabled || btn.dataset.busy) return; btn.disabled = true; btn.dataset.busy = '1'; btn.innerHTML = btnBusyHtml('Please wait…'); }
  try {
    var r = await api('/checkin', {});
    if (r.stale) return;
    if (r.status !== 'success') { toast(r.message || 'Check-in failed'); return; }
    _calPop = _calToday;
    await refreshFromServer();
    toast('Checked in successfully ✓');
  } catch (e) {
  } finally {
    if (btn) { delete btn.dataset.busy; btn.disabled = false; }
    if (STATE) renderAll();
  }
}
// The gift: tapping it (or Open gift) with a code typed shows the stage -- the page blurs, spoke rings turn, the gift spins with glitter while the code is checked --
// and a right code bursts the gift open: a coin rises, coins and ribbon bits fly, balloons float up, and the figure counts up to the real amount.
// Codes are written the way the owner's other app writes them: a referral code is 5 capital letters / digits (S62BV), a gift code 10 (25LVI2IRLX). Whatever is typed or pasted
// (lower case, spaces, dashes) is turned into capitals and cut to that length as it goes in.
function capsCode(el, max){
  if (!el) return;
  el.addEventListener('input', function(){
    var v = String(el.value || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, max);
    if (v !== el.value) el.value = v;
  });
}
capsCode($('fCode'), 5);
capsCode($('giftCodeInput'), 10);
function tapGiftBox(){ openGiftStage(); }
async function redeemGiftCode(){
  var raw = $('giftCodeInput').value.trim().toUpperCase();
  if (!$('giftRevealBg').classList.contains('show')) openGiftStage();
  if (!raw) { toast('Enter a code'); shakeVibrate($('giftCodeInput')); return; }
  var btn = $('redeemBtn'), label = btn ? btn.textContent : '', st = $('giftStage');
  if (btn) { if (btn.disabled) return; btn.disabled = true; btn.innerHTML = btnBusyHtml('Opening…'); }
  var openedAt = Date.now();
  st.className = 'gs gs-opening';   // the card goes, the gift shakes and swells while the code is checked
  _giftPhaseAt = Date.now();
  try {
    var r = await api('/redeem', { code: raw });
    if (r.stale) { closeGiftReveal(); return; }
    if (r.status !== 'success') { st.className = 'gs gs-ask'; toast(r.message || "That code isn't valid"); shakeVibrate($('giftCodeInput')); return; }
    $('giftCodeInput').value = '';
    await refreshFromServer();
    renderAll();
    var wait = GIFT_OPEN_MS - (Date.now() - openedAt);   // the spin is seen for a moment even when the answer is quick
    if (wait > 0) await new Promise(function(res){ setTimeout(res, wait); });
    showGiftReveal(r.reward != null ? r.reward : r.amount);
  } catch (e) {
    st.className = 'gs gs-ask';
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = label; }
  }
}
var GIFT_OPEN_MS = 1100;
var _giftCountRaf = null;
function giftStageReset(){
  var bg = $('giftRevealBg'), st = $('giftStage');
  st.className = 'gs gs-ask';
  $('gsLabel').textContent = 'Opening your gift…';
  $('giftRevealAmount').textContent = ugx(0);
  $('gsGlitter').innerHTML = ''; $('gsConfetti').innerHTML = '';
  st.querySelectorAll('.gs-balloon').forEach(function(b){ b.remove(); });
  if (_giftCountRaf) { cancelAnimationFrame(_giftCountRaf); _giftCountRaf = null; }
  // glitter around the gift while it spins
  var g = '', i;
  for (i = 0; i < 16; i++) {
    var a = Math.random() * 6.283, rad = 70 + Math.random() * 62;
    g += '<i style="left:' + (135 + Math.cos(a) * rad - 3).toFixed(0) + 'px;top:' + (135 + Math.sin(a) * rad - 3).toFixed(0) + 'px;animation-delay:' + (Math.random() * 1.1).toFixed(2) + 's;animation-duration:' + (0.8 + Math.random() * 0.7).toFixed(2) + 's"></i>';
  }
  $('gsGlitter').innerHTML = g;
  giftPreload(); paintGift();
  return bg;
}
// Tapping the gift: the popup with the gift behind it and the code field; "Open gift" starts the opening.
function openGiftStage(){
  var bg = giftStageReset();
  bg.classList.add('show');
  if (navigator.vibrate) navigator.vibrate(20);
  setTimeout(function(){ var i = $('giftCodeInput'); if (bg.classList.contains('show') && $('giftStage').classList.contains('gs-ask')) { try { i.focus(); } catch (e) {} } }, 380);
}
function showGiftReveal(amount){
  amount = Number(amount) || 0;
  var bg = $('giftRevealBg'), st = $('giftStage');
  if (!bg.classList.contains('show')) giftStageReset();
  bg.classList.add('show');
  // First the bang (the swollen box puffs up and its lid is blown off), then the opened box with its coins.
  if (st.classList.contains('gs-opening')) {
    st.className = 'gs gs-bang'; _giftPhaseAt = Date.now();
    if (navigator.vibrate) navigator.vibrate(40);
    setTimeout(function(){ if (bg.classList.contains('show')) burstReveal(amount); }, 280);
    return;
  }
  burstReveal(amount);
}
function burstReveal(amount){
  var st = $('giftStage');
  st.className = 'gs gs-burst';
  $('gsLabel').textContent = 'You got';
  // The burst, replayed each time: ribbon bits and little coins fly out, balloons float up.
  var c = '', i, cols = ['#7cc4ff', '#2b8bf6', '#ffffff', '#b5dcff', '#137aef'];
  for (i = 0; i < 30; i++) {
    var a = (i / 30) * 6.283 + Math.random() * 0.4, d = 90 + Math.random() * 120, coin = i % 3 !== 0;
    c += '<i class="' + (coin ? 'c' : 'r') + '" style="--dx:' + (Math.cos(a) * d).toFixed(0) + 'px;--dy:' + (Math.sin(a) * d * 0.9 - 40).toFixed(0) + 'px;--rot:' + ((Math.random() - 0.5) * 900).toFixed(0) + 'deg;--cc:' + cols[i % cols.length] + ';animation-delay:' + (0.1 + Math.random() * 0.25).toFixed(2) + 's"></i>';
  }
  $('gsConfetti').innerHTML = c;
  [['16%', '#7cc4ff', 0.15], ['46%', '#2b8bf6', 0.4], ['78%', '#b5dcff', 0.0]].forEach(function(b, k){
    var el = document.createElement('span'); el.className = 'gs-balloon';
    el.style.cssText = 'left:' + b[0] + ';--bc:' + b[1] + ';--sway:' + ((k - 1) * 26) + 'px;animation-delay:' + b[2] + 's';
    st.appendChild(el);
  });
  if (navigator.vibrate) navigator.vibrate([40, 30, 40, 30, 90]);
  if (_giftCountRaf) cancelAnimationFrame(_giftCountRaf);
  var start = null, duration = 900, amountEl = $('giftRevealAmount');
  amountEl.textContent = ugx(0);
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
paintIconSizes();
syncPageParticles();
paintAuthArt();
setAuthMode(authMode);
window.addEventListener('snow-auth', function(ev){ onFbAuthChanged(ev.detail); });
// The sign-in script announces who is signed in once, as soon as the page is parsed. This code unpacks a little later (on a slow phone, much later):
// if that already happened nobody was listening, so it is taken from the sign-in script directly.
if (window._smartaiAuthFired && window.fbAuth) onFbAuthChanged(window.fbAuth.currentUser);
