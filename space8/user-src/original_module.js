// ═══════════════════════════════════════════════════════════════════════
// Space8 — user app logic
// ═══════════════════════════════════════════════════════════════════════
var SERVER = 'https://mycallbackurl.onrender.com';

var STATE = {
  account: null, products: null, investments: null, settings: null,
  teamStats: null, teamMembers: {1:null,2:null,3:null}, teamExpanded: {1:false,2:false,3:false}, bankAccounts: null,
  hasPayoutPin: false, banners: {}, currentPage: 'home',
  loaded: { home:false, products:false, team:false, account:false }
};
// ChatGPT-verified bug (2026-08-17): on a shared device, a real sign-out
// only ever cleared STATE.account/STATE.loaded -- STATE.teamMembers/
// teamExpanded/teamStats, STATE.investments, and STATE.bankAccounts all
// stayed cached, so the NEXT person to log in on the same browser/tab
// could still see the PREVIOUS member's referral phone numbers, Active/
// Pending statuses, active plans, and saved withdrawal accounts (all
// treated as valid cache by their respective render functions, which skip
// re-fetching whenever a value is already present). products/settings/
// banners are deliberately left alone -- those are shared catalog data,
// not per-user, so keeping them cached across a login switch is correct
// and desirable. Called from both doLogout() and the 'space8-auth'
// listener's signed-out branch (the actual authoritative place a sign-out
// is detected, whether triggered by a logout tap or a Firebase session
// simply expiring) so neither path can drift out of sync with the other.
function resetUserState(){
  STATE.account = null;
  STATE.investments = null;
  STATE.teamStats = null;
  STATE.teamMembers = {1:null,2:null,3:null};
  STATE.teamExpanded = {1:false,2:false,3:false};
  STATE.bankAccounts = null;
  STATE.hasPayoutPin = false;
  Object.keys(STATE.loaded).forEach(function(k){ STATE.loaded[k] = false; });
}

// ── UTILS ──────────────────────────────────────────────────────────────
function ugx(n){ return 'UGX ' + Math.round(Number(n||0)).toLocaleString('en-UG'); }
function $(id){ return document.getElementById(id); }
function qs(sel, root){ return (root||document).querySelector(sel); }
function qsa(sel, root){ return Array.from((root||document).querySelectorAll(sel)); }
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function cleanPhone(p){
  var d = String(p||'').replace(/\D/g,'');
  if (d.startsWith('0')) d = '256' + d.slice(1);
  if (d.startsWith('7') && d.length===9) d = '256' + d;
  if (!d.startsWith('256')) return null;
  if (d.length !== 12) return null;
  if (d[3] !== '7') return null;
  return d;
}
function phoneToEmail(phone){ return String(phone).replace(/\D/g,'').replace(/^0+/,'') + '@space8.com'; }
function timeAgo(iso){
  if (!iso) return '';
  var diff = Date.now() - new Date(iso).getTime();
  var m = Math.floor(diff/60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  var h = Math.floor(m/60);
  if (h < 24) return h + 'h ago';
  return Math.floor(h/24) + 'd ago';
}

function toast(msg, isErr){
  var t = $('toast');
  t.textContent = msg;
  t.className = 'toast show' + (isErr ? ' err' : '');
  clearTimeout(toast._tm);
  toast._tm = setTimeout(function(){ t.className = 'toast'; }, 3200);
}

function showSuccessPopup(msg){
  var bg = $('successPopupBg');
  $('successPopupMsg').textContent = msg;
  bg.className = 'success-popup-bg show';
  clearTimeout(showSuccessPopup._tm);
  showSuccessPopup._tm = setTimeout(function(){ bg.className = 'success-popup-bg'; }, 1600);
}

function copyText(value, label){
  value = String(value || '');
  if (!value) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(value).then(function(){ toast((label || 'Value') + ' copied'); }).catch(function(){ toast('Could not copy', true); });
  } else {
    var area = document.createElement('textarea'); area.value = value; document.body.appendChild(area); area.select();
    try { document.execCommand('copy'); toast((label || 'Value') + ' copied'); } catch (_) { toast('Could not copy', true); }
    area.remove();
  }
}

function setBtnLoading(btn, on, label){
  if (!btn) return;
  if (on){
    btn.dataset.label = btn.innerHTML;
    btn.innerHTML = '<span class="spin"></span>' + (label ? esc(label) : 'Please wait…');
    btn.classList.add('loading'); btn.disabled = true;
  } else {
    btn.innerHTML = btn.dataset.label || btn.innerHTML;
    btn.classList.remove('loading'); btn.disabled = false;
  }
}

function skRows(n, cls){
  var out = '';
  for (var i=0;i<n;i++) out += '<div class="sk ' + (cls||'sk-card') + '" style="margin-bottom:10px"></div>';
  return out;
}

// ── ICONS ──────────────────────────────────────────────────────────────
var ICONS = {
  satellite: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="7" width="10" height="10" rx="2"/><path d="m4.5 4.5 3 3M19.5 4.5l-3 3M4.5 19.5l3-3M19.5 19.5l-3-3"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/></svg>',
  deposit: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1v6.5"/><path d="M8.5 5 12 8.5 15.5 5"/><circle cx="12" cy="16" r="6.5"/><text x="12" y="19" text-anchor="middle" font-size="8" font-weight="700" font-family="inherit" stroke="none" fill="currentColor">$</text></svg>',
  withdraw: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="5" width="19" height="14" rx="3"/><path d="M7 9.5h5"/><path d="M21.5 10.5h-4a2.5 2.5 0 0 0 0 5h4"/><circle cx="17.3" cy="13" r="0.9" fill="currentColor" stroke="none"/></svg>',
  checkin: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="m9 16 2 2 4-4"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  chev: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  wallet: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-2"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/></svg>',
  history: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/></svg>',
  card: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/></svg>',
  doc: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M9 13h6M9 17h6"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
  support: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11a9 9 0 0 1 18 0"/><path d="M21 12v5a2 2 0 0 1-2 2h-1v-7ZM3 12v5a2 2 0 0 0 2 2h1v-7Z"/></svg>',
  logout: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  share: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/></svg>',
  gift: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M12 8a2.5 2.5 0 1 1-2.5-2.5C11 5.5 12 8 12 8ZM12 8a2.5 2.5 0 1 0 2.5-2.5C13 5.5 12 8 12 8Z"/></svg>',
  cluster: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="2.4"/><circle cx="5" cy="19" r="2.4"/><circle cx="19" cy="19" r="2.4"/><path d="M12 7.4V14M12 14 6.6 17.3M12 14l5.4 3.3"/></svg>',
  assistant: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  phone: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
  bell: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
  telegram: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21 4-9.4 16-2.6-7-7-2.6Z"/><path d="M21 4 8.9 12.9"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="m19 6-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 19h16"/></svg>',
  key: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.6 12.4 8.4-8.4M15 8l3 3M18 5l3 3"/></svg>'
};
function ico(name){ return ICONS[name] || ''; }

// ── API LAYER ─────────────────────────────────────────────────────────
var MONEY_ENDPOINTS = ['/deposit/marzpay', '/invest/create', '/withdraw/request', '/redeem', '/checkin', '/bank/save'];
function isMoneyCall(path){ return MONEY_ENDPOINTS.some(function(p){ return path.indexOf(p) === 0; }); }

// Tracked so a background service-worker update never yanks the page out
// from under a deposit/withdrawal/investment/gift-code/check-in request that's
// actually in flight -- see the reload gate in index.html's plain <script>.
window._moneyCallsInFlight = 0;
async function api(path, body, method, retryOnce){
  var token = null;
  try { if (window.fbAuth && window.fbAuth.currentUser) token = await window.fbAuth.currentUser.getIdToken(); } catch(e){}
  var opts = {
    method: method || (body ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json' },
  };
  if (token) opts.headers['Authorization'] = 'Bearer ' + token;
  if (body) opts.body = JSON.stringify(body);
  var isMoney = isMoneyCall(path);
  // A plain fetch() with no timeout can hang indefinitely on a slow/cold-
  // starting server -- there's nothing to catch, so the caller's spinner
  // (setBtnLoading) never clears and just looks permanently stuck. Money
  // calls get a longer allowance (a real Railway cold start can take a
  // while and these must not be aborted mid-transaction any sooner than
  // necessary) but every call now fails, visibly, rather than hanging forever.
  var doFetch = async function(){
    var ctrl = new AbortController();
    var timer = setTimeout(function(){ ctrl.abort(); }, isMoney ? 40000 : 20000);
    try {
      var res = await fetch(SERVER + path, Object.assign({}, opts, { signal: ctrl.signal }));
      var json;
      try { json = await res.json(); } catch(e) { json = { status:'error', message:'Unexpected response from server' }; }
      if (json.status === 'error' && json.code === 'BANNED') { handleBanned(json.message); }
      return json;
    } finally {
      clearTimeout(timer);
    }
  };
  if (isMoney) window._moneyCallsInFlight++;
  try {
    try {
      return await doFetch();
    } catch (netErr) {
      if (!isMoney && (retryOnce !== false)) {
        try { return await doFetch(); } catch(e2){ return { status:'error', message:'Could not reach the server. Check your connection.' }; }
      }
      return { status:'error', message:'Could not reach the server. Check your connection.' };
    }
  } finally {
    if (isMoney) window._moneyCallsInFlight--;
  }
}

function handleBanned(msg){
  toast(msg || 'Account suspended', true);
  setTimeout(function(){ doLogout(); }, 1500);
}

// ── SHEETS (full pages, not modals — own history entry, phone Back closes
// them without exiting the app) ────────────────────────────────────────
// _sheetStack tracks genuine stacking (2026-08-16, added for the Payout
// Accounts "choose an account for this withdrawal" picker, which opens ON
// TOP of an already-open Withdraw sheet rather than replacing it) -- the
// popstate listener used to unconditionally hide EVERY currently-shown
// sheet on any back navigation, which was fine when only one sheet was
// ever open at a time, but broke as soon as two were stacked: closing the
// picker (a real back-navigation) also hid the Withdraw sheet underneath
// it, defeating the whole "tap an account, come back automatically"
// design. Now popstate only hides the TOPMOST sheet, leaving whatever's
// stacked underneath alone -- correct for both the single-sheet case
// (stack depth 1, unchanged behavior) and genuine stacking.
var _sheetStack = [];
function openSheet(name, html){
  var bg = $(name + 'SheetBg'), sheet = $(name + 'Sheet');
  sheet.innerHTML = html;
  bg.classList.add('show');
  document.body.style.overflow = 'hidden';
  _sheetStack.push(name);
  history.pushState({ overlay: name }, '', '');
}
// Pure DOM close, no history interaction — this is what actually hides a
// sheet. Called both from closeSheet() below (an in-app close/cancel
// button, which triggers history.back() and lets the resulting popstate
// call this) and directly from the popstate listener (the phone's own
// hardware/gesture back button, which never went through closeSheet()).
function hideSheet(name){
  $(name + 'SheetBg').classList.remove('show');
  var i = _sheetStack.lastIndexOf(name);
  if (i !== -1) _sheetStack.splice(i, 1);
  if (!qsa('.sheet-bg.show').length) document.body.style.overflow = '';
  if (_planCountdownTimer) { clearInterval(_planCountdownTimer); _planCountdownTimer = null; }
}
function closeSheet(name){
  if (history.state && history.state.overlay === name) history.back();
  else hideSheet(name); // no matching history entry (shouldn't normally happen) — just hide directly
}
window.addEventListener('popstate', function(){
  var top = _sheetStack[_sheetStack.length - 1];
  if (top) hideSheet(top);
  if ($('assistPanel').classList.contains('show')) hideAssistant();
});
qsa('.sheet-back').forEach(function(btn){
  btn.addEventListener('click', function(){ closeSheet(btn.dataset.close); });
});
// Records shortcut in the Deposit/Withdraw sheet headers -- owner wanted a
// quick way to jump to transaction history from those two screens without
// backing out first, but scoped to THAT screen's own history, not the
// combined Records list. ChatGPT review caught that the first cut of this
// called openRecordsSheet() filtering /transactions -- but /transactions
// only ever gets a row once a deposit is actually credited (see the
// comment on GET /deposits in server.js), so a pending or failed deposit
// would silently vanish from this shortcut while still showing correctly
// on the real Deposit History screen. openHistorySheet() (already used by
// Account -> Deposit History / Withdrawal History) is the correct source:
// it hits /deposits or /withdrawals and renders the real
// Processing/Successful/Unsuccessful status pill. Stacks onto the
// 'generic' sheet slot via the existing _sheetStack mechanism, so the
// phone Back button (or the sheet's own back arrow) returns to
// Deposit/Withdraw underneath, same as the withdrawal-account picker
// already stacks on top of Withdraw.
$('depositRecordsBtn').onclick = function(){ openHistorySheet('deposit'); };
$('withdrawRecordsBtn').onclick = function(){ openHistorySheet('withdrawal'); };

// ── AUTH ──────────────────────────────────────────────────────────────
function showLoginScreen(){ $('screenRegister').style.display = 'none'; $('screenLogin').style.display = 'flex'; }
function showRegisterScreen(){ $('screenLogin').style.display = 'none'; $('screenRegister').style.display = 'flex'; }
$('goRegister').onclick = showRegisterScreen;
$('goLogin').onclick = showLoginScreen;

qsa('.auth-pw-toggle').forEach(function(toggle){
  toggle.addEventListener('click', function(){
    var input = $(toggle.dataset.target);
    var hidden = input.type === 'password';
    input.type = hidden ? 'text' : 'password';
    toggle.textContent = hidden ? 'Hide' : 'Show';
  });
});

function showAuthErr(id, msg){
  var el = $(id);
  el.textContent = msg;
  el.style.display = msg ? 'block' : 'none';
}

// Referral links are shareable as /?ref=CODE -- the bare root path always
// resolves with no extra server config (every static host, including the
// current Render deploy, serves index.html for '/' out of the box), unlike
// the old /register/ref=CODE PATH form, which depended on the host
// rewriting every unmatched path to index.html -- a config that turned out
// to NOT actually be active on the live deploy (confirmed live: sharing
// that link 404'd with Render's own bare "Not Found" page, not this app's
// UI, meaning this script never even got a chance to run). Query-string
// form sidesteps that dependency entirely. The old path form is still
// parsed too, as a fallback, in case an already-shared /register/ref=CODE
// link is out there or the host rewrite gets fixed later.
var _refCode = null;
try { _refCode = new URLSearchParams(location.search).get('ref') || null; } catch (_) {}
if (!_refCode) {
  var _refPath = location.pathname.match(/^\/register\/ref=([^/]+)$/);
  if (_refPath) { try { _refCode = decodeURIComponent(_refPath[1]); } catch (_) {} }
}
if (_refCode && $('regReferral')) {
  $('regReferral').value = _refCode.slice(0, 32);
  // Owner: "I expect it to open the site and fill in the code automatically
  // on registration screen" -- the field was being prefilled, but the
  // screen underneath it was still whichever one is shown by default
  // (Login), so a first-time visitor following a referral link never
  // actually SAW the filled-in code without manually tapping over to
  // Register first.
  showRegisterScreen();
}

// True for the whole span between fbCreateUser() succeeding and /register
// finishing (success OR failure). Firebase signs a newly-created user in
// immediately, which fires the 'space8-auth' listener below on its own --
// without this flag that listener would drop the person straight into the
// app the instant the Firebase account exists, even if /register then
// fails (e.g. a bad referral code) and never actually finished creating
// their Space8 profile. See the listener and enterApp() below.
var _registering = false;
function enterApp(){
  $('screenLogin').style.display = 'none';
  $('screenRegister').style.display = 'none';
  $('app').style.display = 'flex';
  showPage('home');
  startLiveRefresh();
}

$('loginBtn').onclick = async function(){
  showAuthErr('loginErr', '');
  var phone = cleanPhone($('loginPhone').value);
  var pass = $('loginPassword').value;
  if (!phone) return showAuthErr('loginErr', 'Enter a valid Uganda phone number (07XXXXXXXX).');
  if (!pass) return showAuthErr('loginErr', 'Enter your password.');
  setBtnLoading($('loginBtn'), true, 'Signing in…');
  try {
    await window.fbSignIn(phoneToEmail(phone), pass);
  } catch (e) {
    setBtnLoading($('loginBtn'), false);
    return showAuthErr('loginErr', 'Incorrect phone number or password.');
  }
  setBtnLoading($('loginBtn'), false);
  showSuccessPopup('Login successful');
};

$('registerBtn').onclick = async function(){
  showAuthErr('registerErr', '');
  var phone = cleanPhone($('regPhone').value);
  var pass = $('regPassword').value, pass2 = $('regPassword2').value;
  var pin = $('regPin').value, pin2 = $('regPin2').value;
  var ref = $('regReferral').value.trim();
  // A previous attempt in THIS session may have already created the
  // Firebase account and then failed on /register (wrong referral code,
  // dropped connection, etc.) -- retrying fbCreateUser for the same phone
  // would only fail with "already in use". Detected by _registering still
  // being true (only a just-failed registration leaves it that way) plus a
  // real signed-in Firebase user.
  var resuming = !!(_registering && window.fbAuth && window.fbAuth.currentUser);
  if (!resuming) {
    if (!phone) return showAuthErr('registerErr', 'Enter a valid Uganda phone number (07XXXXXXXX).');
    if (pass.length < 6) return showAuthErr('registerErr', 'Password must be at least 6 characters.');
    if (pass !== pass2) return showAuthErr('registerErr', 'Passwords do not match.');
  }
  if (!/^\d{4}$/.test(pin)) return showAuthErr('registerErr', 'Choose a 4-digit withdrawal PIN.');
  if (/^(\d)\1{3}$/.test(pin)) return showAuthErr('registerErr', 'That PIN is too easy to guess (e.g. 1111, 2222). Choose 4 digits that are not all the same.');
  if (pin !== pin2) return showAuthErr('registerErr', 'PINs do not match.');
  setBtnLoading($('registerBtn'), true, 'Creating account…');
  _registering = true;
  try {
    if (!resuming) await window.fbCreateUser(phoneToEmail(phone), pass);
    var r = await api('/register', { referralCode: ref || undefined, phone: phone }, 'POST', true);
    if (r.status === 'error') {
      // Firebase account exists, but the Space8 profile isn't finished --
      // stay on this screen (never silently enter the app half-registered)
      // and let them fix the referral code and try again; _registering
      // stays true so the retry above skips fbCreateUser.
      setBtnLoading($('registerBtn'), false);
      return showAuthErr('registerErr', (r.message || 'Could not finish creating your account.') + ' You are signed in — fix the referral code (or clear it) and tap Create Account again.');
    }
    var pinR = await api('/account/payout-pin/set', { pin: pin });
    if (pinR.status === 'error') toast('Account created, but the PIN could not be set — set it later in Account.', true);
  } catch (e) {
    setBtnLoading($('registerBtn'), false);
    // Only clear _registering if no Firebase account actually exists yet --
    // fbCreateUser is the only call in this block that can genuinely throw
    // (api() always resolves with {status:'error'}, never throws), but this
    // check is written to hold regardless of exactly which line threw: if a
    // Firebase user already exists at this point, the account WAS created,
    // and the next retry must still skip fbCreateUser (via `resuming`
    // above) rather than attempt it again and hit "already-in-use",
    // stranding the account with no way to finish registering.
    if (!(window.fbAuth && window.fbAuth.currentUser)) _registering = false;
    var msg = 'Could not create your account.';
    if (String(e.code).indexOf('email-already-in-use') !== -1) msg = 'This phone number is already registered.';
    else if (String(e.code).indexOf('weak-password') !== -1) msg = 'Choose a stronger password (min 6 characters).';
    return showAuthErr('registerErr', msg);
  }
  _registering = false;
  setBtnLoading($('registerBtn'), false);
  showSuccessPopup('Registration successful');
  enterApp();
};

function doLogout(){
  resetUserState();
  window.fbSignOut();
}

// ── ROUTER ────────────────────────────────────────────────────────────
function showPage(name){
  STATE.currentPage = name;
  qsa('.page').forEach(function(p){ p.classList.toggle('active', p.id === 'page-' + name); });
  qsa('.navitem').forEach(function(n){ n.classList.toggle('active', n.dataset.page === name); });
  // Assistant bubble is Account-only -- owner: "ai assistant bubble should
  // be in account, so remove it from home, team, products."
  $('assistFab').style.display = name === 'account' ? 'flex' : 'none';
  window.scrollTo(0,0);
  loadPage(name);
  if (name === 'home') maybeShowAnnouncement();
}

// Owner: "l want a dialog with a background image SETTABLE from admin,plus
// blur and opusity ... with telegram button and cancel." Admin's own help
// text (unchanged by this feature) says it shows every time a member opens
// the app and every time they return to Home from another tab -- both of
// those are exactly the two callers of showPage('home') (enterApp() and the
// bottom-nav click handler), so hooking it there covers both without a
// separate timer/listener.
function maybeShowAnnouncement(){
  var sett = STATE.settings || {};
  if (!sett.annEnabled || !sett.annBody) return;
  $('announceTitle').textContent = sett.annTitle || 'Notice';
  $('announceText').textContent = sett.annBody;
  var tgUrl = sett.telegramGroup || sett.telegramChannel;
  var tgBtn = $('announceTgBtn');
  if (tgUrl) {
    tgBtn.style.display = 'flex';
    tgBtn.innerHTML = ico('telegram') + '<span>Telegram</span>';
    tgBtn.onclick = function(){ window.open(tgUrl, '_blank'); hideAnnouncement(); };
  } else {
    tgBtn.style.display = 'none';
  }
  // Lock body scroll while the dialog is up -- real sheets already do this
  // via openSheet()/hideSheet(), but this dialog isn't part of that stack
  // (it's a dismissible notice, not a page). Without it, once the inner
  // .announce-text scroll hits its end, the scroll silently chains through
  // to the Home page scrolling underneath -- owner: "when you reach at end
  // of text in announcement dialog, it again scrolls the contents in
  // dashboard, that is very bad." overscroll-behavior:contain on
  // .announce-text (index.html) stops the chaining at the text box itself;
  // this stops the dashboard from being scrollable at all while shown.
  document.body.style.overflow = 'hidden';
  $('announceBg').classList.add('show');
}
function hideAnnouncement(){
  $('announceBg').classList.remove('show');
  if (!qsa('.sheet-bg.show').length) document.body.style.overflow = '';
}
$('announceCancelBtn').onclick = hideAnnouncement;
$('announceBg').addEventListener('click', function(e){ if (e.target.id === 'announceBg') hideAnnouncement(); });
qsa('.navitem').forEach(function(n){ n.addEventListener('click', function(){
  qsa('.navitem').forEach(function(item){ item.classList.remove('tap-glow'); });
  n.classList.add('tap-glow');
  setTimeout(function(){ n.classList.remove('tap-glow'); }, 360);
  showPage(n.dataset.page);
}); });

function loadPage(name){
  if (name === 'home') renderHome();
  else if (name === 'products') renderProducts();
  else if (name === 'team') renderTeam();
  else if (name === 'account') renderAccount();
}

// ── BANNER HELPER ─────────────────────────────────────────────────────
function bannerHtml(key, fallbackIcon){
  var src = STATE.banners[key];
  if (src) return '<div class="banner"><img src="' + esc(src) + '" alt=""></div>';
  return '<div class="banner"><div class="fallback-ico">' + ico(fallbackIcon||'satellite') + '</div></div>';
}
// Account screen only: the same admin-customizable 'rocherstack' banner
// slot, but with the member's own identity spread across it instead of a
// plain image/fallback-icon — the Space8 mark on one half, phone + the
// server-issued account ID on the other. Falls back to a plain blue
// gradient (not the generic satellite fallback-icon) when no custom image
// is set, since that's the more likely default state and reads better
// behind white text than the icon does.
function identityBannerHtml(acc){
  var src = STATE.banners['rocherstack'];
  return '<div class="identity-banner' + (src?' has-img':'') + '"' + (src?' style="background-image:url(\'' + esc(src) + '\')"':'') + '>' +
    '<div class="identity-mark"><svg viewBox="0 0 36 28" fill="none"><path d="M18 14C10 4 4 6 4 12c0 6 7 8 14 2 7-6 14-4 14 2 0 6-6 8-14-2Z" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="27" cy="7" r="2.5" fill="currentColor"/></svg></div>' +
    '<div class="identity-info">' +
      '<div class="identity-copyline"><span class="identity-phone">' + esc(acc.phone||'—') + '</span><button class="mini-copy" data-copy="' + esc(acc.phone||'') + '" data-copy-label="Account number" aria-label="Copy account number">' + ico('copy') + '</button></div>' +
      '<div class="identity-copyline"><span class="identity-id mono">ID:' + esc(acc.publicId||'——————') + '</span><button class="mini-copy" data-copy="' + esc(acc.publicId||'') + '" data-copy-label="Account ID" aria-label="Copy account ID">' + ico('copy') + '</button></div>' +
    '</div>' +
  '</div>';
}

// ── HOME ──────────────────────────────────────────────────────────────
async function renderHome(){
  var el = $('page-home');
  if (!STATE.loaded.home) {
    el.innerHTML =
      '<div class="sk sk-card" style="height:150px;margin:16px 0"></div>' +
      '<div class="action-row">' +
      '<div class="sk" style="height:74px;border-radius:16px;flex:1"></div><div class="sk" style="height:74px;border-radius:16px;flex:1"></div><div class="sk" style="height:74px;border-radius:16px;flex:1"></div>' +
      '</div>' +
      '<div class="sk sk-card" style="height:150px;margin-top:22px"></div>' +
      skRows(2);
  }
  var results = await Promise.all([
    STATE.account ? Promise.resolve({status:'success',account:STATE.account}) : api('/account'),
    STATE.investments ? Promise.resolve({status:'success',investments:STATE.investments}) : api('/investments'),
    STATE.products ? Promise.resolve({status:'success',products:STATE.products}) : api('/public/products'),
    STATE.settings ? Promise.resolve({status:'success',settings:STATE.settings}) : api('/public/settings'),
    api('/public/activity-feed')
  ]);
  var accR = results[0], invR = results[1], prodR = results[2], setR = results[3], feedR = results[4];
  if (accR.status === 'success') STATE.account = accR.account;
  if (invR.status === 'success' && invR.investments) STATE.investments = invR.investments;
  if (prodR.status === 'success') STATE.products = prodR.products;
  if (setR.status === 'success') STATE.settings = setR.settings;
  STATE.loaded.home = true;

  var acc = STATE.account || {};
  var products = (STATE.products||[]).filter(function(p){ return p.active !== false; });
  var checkedIn = acc.lastCheckin && isToday(acc.lastCheckin);

  // Preserve the ticker's own DOM node across this render when its feed
  // data hasn't actually changed. `el.innerHTML = html` below rebuilds the
  // ENTIRE Home page fresh every time it runs -- including on the silent
  // 12s live-refresh timer -- which recreates #tickerItems as a brand-new
  // element and restarts its 24s CSS marquee animation from frame zero.
  // Detaching the still-animating node here and splicing it back in after
  // the rebuild (in place of the fresh, empty placeholder the new HTML
  // creates) keeps the SAME element -- and its running animation -- alive
  // across the refresh; it's only actually replaced when the feed content
  // genuinely changes.
  var feed = feedR.status === 'success' ? (feedR.feed || feedR.items || []) : [];
  var feedJson = JSON.stringify(feed);
  var existingTicker = $('tickerItems');
  var preservedTicker = (existingTicker && feedJson === STATE.lastFeedJson) ? existingTicker : null;
  if (preservedTicker) preservedTicker.remove();

  var html = bannerHtml('barstack', 'satellite');
  html += '<div class="balance-card">' +
    '<div class="lab">Account Balance</div>' +
    '<div class="amt mono">' + ugx(acc.walletBalance) + '</div>' +
    '<div class="balance-split">' +
      '<div><div class="lab2">Cumulative Earnings</div><div class="val2 mono">' + ugx(acc.totalEarned) + '</div></div>' +
      '<div><div class="lab2">Total Invested</div><div class="val2 mono">' + ugx(acc.totalInvested) + '</div></div>' +
    '</div>' +
  '</div>';

  html += '<div class="action-row">' +
    '<div class="action-btn" id="homeDepositBtn"><div class="ico">' + ico('deposit') + '</div><span>Deposit</span></div>' +
    '<div class="action-btn" id="homeWithdrawBtn"><div class="ico">' + ico('withdraw') + '</div><span>Withdraw</span></div>' +
    '<div class="action-btn ' + (checkedIn?'done':'') + '" id="homeCheckinBtn"><div class="ico">' + ico(checkedIn?'check':'checkin') + '</div><span>' + (checkedIn?'✓ Claimed':'Check In') + '</span></div>' +
  '</div>';

  html += '<div class="ticker-bar">' +
    '<div class="ticker-icon" id="tickerBellBtn">' + ico('bell') + '</div>' +
    '<div class="ticker-track"><div class="ticker-items" id="tickerItems"></div></div>' +
    '<div class="ticker-icon" id="tickerRecordsBtn">' + ico('doc') + '</div>' +
  '</div>';

  html += '<div class="section-title">Products <span class="see-all" id="homeSeeAllProds">See all</span></div>';
  products.slice(0,10).forEach(function(p){ html += prodCardHtml(p); });

  el.innerHTML = html;
  if (preservedTicker) {
    var freshTicker = $('tickerItems');
    if (freshTicker) freshTicker.replaceWith(preservedTicker);
  }
  wireHomeActions();
  renderTicker(feed);
  qsa('.plan-row', el).forEach(function(row){
    row.onclick = function(){ openPlanDetailSheet(row.dataset.id); };
  });
}
function isToday(dateStr){
  var d = new Date();
  var mm = String(d.getMonth()+1).padStart(2,'0'), dd = String(d.getDate()).padStart(2,'0');
  return dateStr === (mm + '/' + dd + '/' + d.getFullYear());
}
// Simple list row (icon, name + "Day X of Y", chevron) -- owner explicit:
// "I don't want active plans to be like that [the rounded ring card], I
// want them to be where on my products it shows arrow" -- i.e. the same
// menuRow()-style chevron list already used for About/Rules/Support.
function planRowHtml(inv){
  var made = inv.payoutsMade||0, total = inv.payoutsTotal||0;
  return '<div class="menu-row plan-row" data-id="' + esc(inv.id) + '">' + ico('satellite') +
    '<div class="info"><div class="name">' + esc(inv.tierLabel) + '</div>' +
    '<div class="sub">Day ' + made + ' of ' + total + ' · +' + ugx(inv.paidOut) + ' earned</div></div>' +
    ico('chev').replace('<svg ', '<svg class="chev" ') +
  '</div>';
}
var _planCountdownTimer = null;
// Elapsed-full-days boundary this plan's cashback is credited on --
// mirrors settleInvestmentIfDue()'s own elapsedDays math in server.js
// exactly (Math.floor((now-createdMs)/86400000)), so the countdown shown
// here always agrees with when the server's 1s reconciler actually pays.
function nextCashbackMs(inv){
  var createdMs = inv.createdAt ? new Date(inv.createdAt).getTime() : NaN;
  var made = inv.payoutsMade || 0, total = inv.payoutsTotal || 0;
  if (!createdMs || isNaN(createdMs) || made >= total) return null;
  return createdMs + (made + 1) * 86400000;
}
function fmtCountdown(ms){
  var s = Math.max(0, Math.floor(ms/1000));
  var hh = String(Math.floor(s/3600)).padStart(2,'0');
  var mm = String(Math.floor((s%3600)/60)).padStart(2,'0');
  var ss = String(s%60).padStart(2,'0');
  return hh + ':' + mm + ':' + ss;
}
function detailField(lab, val){
  return '<div><div style="font-size:10px;color:var(--ink-dim);text-transform:uppercase">' + esc(lab) + '</div><div style="font-weight:700" class="mono">' + val + '</div></div>';
}
function planDetailHtml(inv){
  var nextMs = nextCashbackMs(inv);
  var html =
    '<div data-plan-detail="' + esc(inv.id) + '">' +
    '<div class="sheet-title">' + esc(inv.tierLabel) + '</div>' +
    '<div class="card" style="margin-bottom:14px">' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">' +
        detailField('Purchase Date', esc(inv.date||'-')) +
        detailField('Purchase Time', esc(inv.time||'-')) +
        detailField('Price', ugx(inv.amount)) +
        detailField('Daily Profit', ugx(inv.dailyPayout)) +
        detailField('Total Return', ugx(inv.expectedReturn)) +
        detailField('Accumulated Profit', ugx(inv.paidOut)) +
      '</div>' +
    '</div>' +
    '<div class="card" style="text-align:center">' +
      '<div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--ink-dim);margin-bottom:6px">' + (nextMs ? 'Next Cashback In' : 'Status') + '</div>' +
      '<div id="planCountdownVal" class="mono" style="font-size:26px;font-weight:700;color:var(--blue)">' + (nextMs ? fmtCountdown(nextMs - Date.now()) : 'Matured') + '</div>' +
    '</div>' +
    '</div>';
  return { html: html, nextMs: nextMs };
}
function openPlanDetailSheet(id){
  var inv = (STATE.investments||[]).find(function(i){ return i.id === id; });
  if (!inv) return;
  var d = planDetailHtml(inv);
  openSheet('generic', d.html);
  if (d.nextMs) startPlanCountdown(d.nextMs, id);
}
// True only if the generic sheet is open AND still showing THIS plan's
// detail view -- the member may have closed it and opened something else
// entirely (Records, Password Management, another plan) while a delayed
// refresh below was in flight; a bare "is some sheet open" check isn't
// enough to tell those apart, since every generic-sheet feature shares the
// same #genericSheet container.
function isPlanDetailShowing(id){
  if (!$('genericSheetBg').classList.contains('show')) return false;
  var wrap = qs('[data-plan-detail]', $('genericSheet'));
  return !!wrap && wrap.dataset.planDetail === id;
}
// Re-renders the SAME already-open detail sheet in place (no openSheet(), no
// new history entry) -- used by startPlanCountdown() once a plan's countdown
// hits zero, so the sheet picks up the day the server just credited instead
// of sitting frozen at 00:00:00 until the member manually reopens it.
function renderPlanDetail(id){
  var inv = (STATE.investments||[]).find(function(i){ return i.id === id; });
  if (!inv) return;
  var d = planDetailHtml(inv);
  $('genericSheet').innerHTML = d.html;
  if (d.nextMs) startPlanCountdown(d.nextMs, id);
}
// The server's own 1s cashback reconciler (reconcileCashback() in server.js)
// runs independently of this client-side timer, so a short delay here gives
// it a moment to actually land the credit before we re-fetch -- otherwise a
// re-fetch at the exact instant the countdown hits zero would often still
// read the pre-credit state and show the same "00:00:00" over again.
async function refreshPlanDetailAfterMaturity(invId){
  await new Promise(function(r){ setTimeout(r, 1500); });
  if (!isPlanDetailShowing(invId)) return;
  var r = await api('/investments', null, 'GET');
  if (!isPlanDetailShowing(invId)) return;
  if (r.status === 'success' && r.investments) {
    STATE.investments = r.investments;
    renderPlanDetail(invId);
  } else {
    // Fetch failed -- retry on the same ~1.5s cadence instead of calling
    // renderPlanDetail() with stale data: that would restart the countdown
    // on the SAME already-expired target, whose first synchronous tick
    // immediately re-triggers this function again, turning one slow
    // request into a hot loop. Leaves "00:00:00" showing until this
    // eventually succeeds.
    refreshPlanDetailAfterMaturity(invId);
  }
}
function startPlanCountdown(targetMs, invId){
  if (_planCountdownTimer) clearInterval(_planCountdownTimer);
  var tick = function(){
    var el = $('planCountdownVal');
    if (!el) { clearInterval(_planCountdownTimer); _planCountdownTimer = null; return; }
    var remaining = targetMs - Date.now();
    if (remaining <= 0) {
      el.textContent = '00:00:00';
      clearInterval(_planCountdownTimer); _planCountdownTimer = null;
      refreshPlanDetailAfterMaturity(invId);
      return;
    }
    el.textContent = fmtCountdown(remaining);
  };
  tick();
  _planCountdownTimer = setInterval(tick, 1000);
}
function renderTicker(feed){
  var track = $('tickerItems');
  // Real bug found while wiring up the live 12s background refresh: every
  // renderHome() call (including the silent periodic one) rebuilds this
  // element's innerHTML unconditionally, which restarts the ticker's own
  // 24s CSS scroll animation from position zero every time -- the marquee
  // never completed more than half a loop before visibly snapping back to
  // the start. Skipping the rebuild when the feed content hasn't actually
  // changed since last render (the common case between server-side
  // rebuilds) keeps the animation running smoothly; it only restarts when
  // there's genuinely new activity to show.
  var feedJson = JSON.stringify(feed);
  var changed = feedJson !== STATE.lastFeedJson;
  if (track && changed) {
    STATE.lastFeedJson = feedJson;
    if (!feed.length) track.innerHTML = '<span class="ticker-item">Waiting for activity…</span>';
    else {
      var items = feed.slice(0,18).map(function(f){
        // Real bug found while testing the animation fix above: the
        // server's feed rows (buildActivityFeed() in server.js) use a
        // field named `kind` with values 'deposit'/'withdraw' -- this was
        // checking `f.type === 'withdrawal'`, a field that was never even
        // present on the object, so this ternary always fell through to
        // "deposited" for every row regardless of what kind it actually
        // was. The ticker has never once shown "withdrew" for a real
        // simulated withdrawal.
        var verb = f.kind === 'withdraw' ? 'withdrew' : 'deposited';
        return '<span class="ticker-item">' + esc(f.phone||f.masked||'A member') + ' ' + verb + ' <span class="amt mono">' + ugx(f.amount) + '</span></span>';
      }).join('');
      track.innerHTML = items + items; // doubled so a -50% translate loop is seamless
    }
  }
  STATE.lastFeed = feed;
  // Wiring these two buttons was previously INSIDE the `if (!feed.length)`
  // branch above (an early return before this line), so on a fresh
  // install with no site-wide activity yet, neither button ever got a
  // click handler at all -- fixed by moving the wiring out here,
  // unconditional on whether the ticker itself has anything to show.
  var bellBtn = $('tickerBellBtn');
  if (bellBtn) bellBtn.onclick = openNotificationsSheet;
  var recBtn = $('tickerRecordsBtn');
  if (recBtn) recBtn.onclick = openRecordsSheet;
}
// Every transaction type ever written to the 'transactions' collection
// (grepped every db.collection('transactions').add/.set(...) call site in
// server.js to build this list) -- server-side is the single source of
// truth for what's real; this is presentation only.
var RECORD_META = {
  deposit:    { label: 'Deposit' },
  withdraw:   { label: 'Withdrawal' },
  investment: { label: 'Investment' },
  cashback:   { label: 'Daily Cashback' },
  checkin:    { label: 'Check-in Reward' },
  commission: { label: 'Referral Commission' },
  team_reward:{ label: 'Task Center Reward' },
  admin_credit:{ label: 'Credit' },
  admin_debit: { label: 'Debit' },
  promocode:  { label: 'Gift Code' }
};
function recordMeta(type){
  return RECORD_META[type] || { label: type ? (type.charAt(0).toUpperCase() + type.slice(1)) : 'Transaction' };
}
// Full personal transaction history -- every deposit, withdrawal,
// investment, daily cashback, check-in reward, referral commission, task
// center reward, gift code redemption and admin credit/debit on THIS
// account. Server-scoped to the caller's own userId (GET /transactions,
// auth-gated) -- nothing here is guessable or another member's data, and
// every row's date/time comes straight from the same server-timestamped
// ledger every balance figure in the app is computed from, not a
// client-side guess.
// Reached only from the home activity-ticker's own records icon now --
// the Deposit/Withdraw sheet header shortcuts use openHistorySheet()
// instead (see its own comment), since /transactions can't show a
// pending/failed deposit or withdrawal the way /deposits and /withdrawals
// can.
//
// _genericAsyncSeq guard (shared with openHistorySheet() below): both
// functions render into the SAME 'generic' sheet slot's body element,
// looked up by id AFTER their own await/then. ChatGPT review caught that
// with no guard, opening one of these, backing out fast, then opening the
// other (or the same one again) before the first response lands lets the
// slower response win and overwrite whichever sheet is now actually open
// with stale content under the wrong title. Each render captures the
// sequence number at the START of its own call and bails silently if a
// newer generic-sheet render has since taken over by the time its
// response arrives.
var _genericAsyncSeq = 0;
async function openRecordsSheet(){
  var seq = ++_genericAsyncSeq;
  openSheet('generic', '<div class="sheet-title">Records</div><div id="recordsBody"><div class="sk sk-line" style="width:60%"></div>' + skRows(4,'sk-card') + '</div>');
  var r = await api('/transactions', null, 'GET');
  if (seq !== _genericAsyncSeq) return;
  var body = $('recordsBody'); if (!body) return;
  var items = (r.status === 'success' && r.transactions) || [];
  if (!items.length) { body.innerHTML = emptyState('doc', 'No more data'); return; }
  body.innerHTML = items.map(function(t){
    var meta = recordMeta(t.type);
    var neg = (t.amount||0) < 0;
    return '<div class="member-row record-row"><div class="info"><div class="phone">' + esc(meta.label) + '</div>' +
      '<div class="date">' + esc(t.description||'') + '<br>' + esc(t.date||'') + ' ' + esc(t.time||'') +
      (t.ref ? '<br>Ref: ' + esc(t.ref) : '') + '</div></div>' +
      '<span class="mono" style="font-weight:700;color:' + (neg?'#ffd0d6':'#fff') + ';flex-shrink:0;margin-left:10px">' +
        (neg?'−':'+') + ugx(Math.abs(t.amount||0)) + '</span></div>';
  }).join('') + listEndFooter();
}
function wireHomeActions(){
  $('homeDepositBtn').onclick = openDepositSheet;
  $('homeWithdrawBtn').onclick = openWithdrawSheet;
  $('homeCheckinBtn').onclick = doCheckin;
  var seeAll = $('homeSeeAllProds'); if (seeAll) seeAll.onclick = function(){ showPage('products'); };
  qsa('.prod-card', $('page-home')).forEach(function(c){
    var invBtn = qs('.invest-btn', c);
    if (invBtn) invBtn.onclick = function(e){ e.stopPropagation(); openInvestSheet(c.dataset.key); };
  });
}
async function doCheckin(){
  var btn = $('homeCheckinBtn');
  if (btn.classList.contains('done')) return;
  var r = await api('/checkin', {});
  if (r.status === 'success') {
    toast('+' + ugx(r.bonus) + ' added — day ' + r.streak + ' streak');
    STATE.account.walletBalance = (STATE.account.walletBalance||0) + r.bonus;
    STATE.account.lastCheckin = new Date().toLocaleDateString('en-US',{month:'2-digit',day:'2-digit',year:'numeric'}).replace(/(\d+)\/(\d+)\/(\d+)/, function(_,m,d,y){ return m.padStart(2,'0')+'/'+d.padStart(2,'0')+'/'+y; });
    renderHome();
  } else toast(r.message, true);
}

// ── PRODUCTS ──────────────────────────────────────────────────────────
async function renderProducts(){
  var el = $('page-products');
  if (!STATE.loaded.products) el.innerHTML = '<div class="sk sk-card" style="height:110px;margin:16px 0"></div>' + skRows(4);
  var results = await Promise.all([
    STATE.products ? Promise.resolve({status:'success', products:STATE.products}) : api('/public/products'),
    STATE.investments ? Promise.resolve({status:'success', investments:STATE.investments}) : api('/investments'),
    STATE.account ? Promise.resolve({status:'success', account:STATE.account}) : api('/account')
  ]);
  if (results[0].status === 'success') STATE.products = results[0].products;
  if (results[1].status === 'success' && results[1].investments) STATE.investments = results[1].investments;
  if (results[2].status === 'success') STATE.account = results[2].account;
  STATE.loaded.products = true;

  var products = STATE.products || [];
  var myCount = (STATE.investments||[]).filter(function(i){ return i.status==='active'; }).length;
  var earned = (STATE.account||{}).totalEarned || 0;

  var html = bannerHtml('darkbar', 'satellite');
  html += '<div class="shortcut-row">' +
    '<div class="shortcut" id="shBind">' + ico('lock') + '<span>Withdrawal Account</span></div>' +
    '<div class="shortcut" id="shDeposits">' + ico('history') + '<span>Deposits</span></div>' +
    '<div class="shortcut" id="shWithdrawals">' + ico('wallet') + '<span>Withdrawals</span></div>' +
  '</div>';
  html += '<div class="mystats">' +
    '<div class="card mystats-link" id="myProductsCard"><div class="lab">My Products</div>' +
      '<div class="mystats-row"><div class="val">' + myCount + '</div>' + ico('chev').replace('<svg ', '<svg class="chev" ') + '</div></div>' +
    '<div class="card"><div class="lab">Cumulative Earnings</div><div class="val mono">' + ugx(earned) + '</div></div>' +
  '</div>';
  html += '<div class="section-title">All Products</div>';
  products.forEach(function(p){ html += prodCardHtml(p); });
  el.innerHTML = html;

  qsa('.prod-card').forEach(function(c){
    var invBtn = qs('.invest-btn', c);
    if (invBtn) invBtn.onclick = function(e){ e.stopPropagation(); openInvestSheet(c.dataset.key); };
  });
  $('shBind').onclick = function(){ openPayoutSheet(); };
  $('shDeposits').onclick = function(){ openHistorySheet('deposit'); };
  $('shWithdrawals').onclick = function(){ openHistorySheet('withdrawal'); };
  $('myProductsCard').onclick = function(){ openMyProductsSheet(); };
}
// Purchased-plans list, moved here from a dedicated Home section 2026-08-17
// (owner: "I don't want that function or that of active plans, remove it...
// products will be in the area where you see my products so that... card
// will be having arrow") -- reuses the same planRowHtml()/openPlanDetailSheet()
// pair the Home section used, just entered from the "My Products" stat tile
// instead of always showing on Home.
function openMyProductsSheet(){
  var active = (STATE.investments||[]).filter(function(i){ return i.status === 'active'; });
  var html = '<div class="sheet-title">My Products</div>';
  html += active.length ?
    '<div class="menu-list">' + active.map(planRowHtml).join('') + '</div>' :
    emptyState('satellite', 'No active plans yet — purchase one from All Products.');
  openSheet('generic', html);
  qsa('.plan-row', $('genericSheet')).forEach(function(row){
    row.onclick = function(){ openPlanDetailSheet(row.dataset.id); };
  });
}
function prodCardHtml(p){
  var daily = Math.round((p.expectedReturn||0)/(p.cycle||1));
  var disabled = p.active === false || p.comingSoon;
  return '<div class="prod-card ' + (disabled?'soon':'') + '" data-key="' + esc(p.key) + '">' +
    '<div class="top">' +
      '<div class="sat">' + (p.image ? '<img src="'+esc(p.image)+'">' : ico('satellite')) + '</div>' +
      '<div class="name">' + esc(p.name) + '</div>' +
    '</div>' +
    '<div class="grid">' +
      '<div><div class="lab">Price</div><div class="val mono">' + ugx(p.price) + '</div></div>' +
      '<div><div class="lab">Daily Cashback</div><div class="val mono">' + ugx(daily) + '</div></div>' +
      '<div><div class="lab">Amount</div><div class="val mono">' + ugx(p.expectedReturn) + '</div></div>' +
      '<div><div class="lab">Duration</div><div class="val">' + (p.cycle||'-') + ' days</div></div>' +
    '</div>' +
    '<button class="btn btn-primary invest-btn" ' + (disabled?'disabled':'') + '>' + (p.comingSoon?'Coming Soon':'Purchase') + '</button>' +
  '</div>';
}

async function openInvestSheet(key){
  var p = (STATE.products||[]).find(function(x){ return x.key === key; });
  if (!p) return;
  var daily = Math.round((p.expectedReturn||0)/(p.cycle||1));
  var bal = (STATE.account||{}).walletBalance || 0;
  var can = bal >= p.price;
  openSheet('invest',
    '<div class="sheet-title">' + esc(p.name) + '</div>' +
    '<div class="sheet-sub">Confirm your investment</div>' +
    '<div class="card" style="margin-bottom:16px">' +
      '<div class="grid" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
        '<div><div class="lab" style="font-size:10px;color:var(--ink-dim);text-transform:uppercase">Price</div><div style="font-weight:700" class="mono">' + ugx(p.price) + '</div></div>' +
        '<div><div class="lab" style="font-size:10px;color:var(--ink-dim);text-transform:uppercase">Cycle</div><div style="font-weight:700">' + p.cycle + ' days</div></div>' +
        '<div><div class="lab" style="font-size:10px;color:var(--ink-dim);text-transform:uppercase">Daily Income</div><div style="font-weight:700" class="mono">' + ugx(daily) + '</div></div>' +
        '<div><div class="lab" style="font-size:10px;color:var(--ink-dim);text-transform:uppercase">Total Return</div><div style="font-weight:700" class="mono">' + ugx(p.expectedReturn) + '</div></div>' +
      '</div>' +
    '</div>' +
    (!can ? '<div class="auth-err" style="display:block;margin-bottom:14px">Insufficient balance. You have ' + ugx(bal) + '.</div>' : '') +
    '<button class="btn btn-primary" id="confirmInvestBtn" ' + (!can?'disabled':'') + '>Confirm & Purchase</button>' +
    '<button class="btn btn-secondary" style="margin-top:10px" id="cancelInvestBtn">Cancel</button>'
  );
  $('cancelInvestBtn').onclick = function(){ closeSheet('invest'); };
  $('confirmInvestBtn').onclick = async function(){
    var btn = $('confirmInvestBtn');
    setBtnLoading(btn, true, 'Processing…');
    var r = await api('/invest/create', { tierKey: key });
    setBtnLoading(btn, false);
    if (r.status === 'success') {
      toast('Invested in ' + p.name);
      closeSheet('invest');
      STATE.account = null; STATE.investments = null;
      STATE.loaded.home = false; STATE.loaded.products = false;
      loadPage(STATE.currentPage);
    } else toast(r.message, true);
  };
}

// Internal status values (deposits: initiating/pending/matched/failed;
// withdrawals: pending/sending/processing/processed/declined) are our own
// pipeline's bookkeeping states, not user-facing words -- collapsed down to
// the three states a member actually cares about: it went through, it
// didn't, or it's still on its way.
var STATUS_DONE = ['matched', 'processed', 'success', 'completed'];
var STATUS_FAIL = ['failed', 'declined'];
function friendlyStatus(status){
  var s = String(status || '').toLowerCase();
  if (STATUS_DONE.indexOf(s) !== -1) return 'Successful';
  if (STATUS_FAIL.indexOf(s) !== -1) return 'Unsuccessful';
  return 'Processing';
}
// See _genericAsyncSeq's comment above openRecordsSheet() -- shares the
// same guard since both render into the same 'generic' sheet slot and can
// race against each other now that Deposit/Withdraw's header shortcuts
// make it easy to hop between this and the combined Records view quickly.
function openHistorySheet(kind){
  var seq = ++_genericAsyncSeq;
  openSheet('generic', '<div class="sheet-title">' + (kind==='deposit'?'Deposit':'Withdrawal') + ' History</div><div id="histBody"><div class="sk sk-line" style="width:60%"></div>' + skRows(3,'sk-card') + '</div>');
  api(kind === 'deposit' ? '/deposits' : '/withdrawals').then(function(r){
    if (seq !== _genericAsyncSeq) return;
    var body = $('histBody'); if (!body) return;
    var items = (r.status === 'success' && (r.deposits||r.withdrawals)) || [];
    if (!items.length) { body.innerHTML = emptyState('history','No more data'); return; }
    body.innerHTML = items.map(function(x){
      var s = String(x.status || '').toLowerCase();
      var pillClass = STATUS_DONE.indexOf(s) !== -1 ? 'pill-done' : STATUS_FAIL.indexOf(s) !== -1 ? 'pill-fail' : 'pill-active';
      return '<div class="member-row record-row"><div class="info"><div class="phone mono">' + ugx(x.amount) + '</div>' +
      '<div class="date">' + esc(x.date) + ' ' + esc(x.time) + (x.ref ? '<br>Ref: ' + esc(x.ref) : '') + '</div></div>' +
      '<span class="pill ' + pillClass + '">' + friendlyStatus(x.status) + '</span></div>';
    }).join('') + listEndFooter();
  });
}
function emptyState(icon, msg){
  return '<div class="empty-state">' + ico(icon) + '<p>' + esc(msg) + '</p></div>';
}
function listEndFooter(){
  return '<div class="list-end">No more data</div>';
}

// ── TEAM ──────────────────────────────────────────────────────────────
// Fetches team stats and every level's member list TOGETHER (Promise.all)
// and renders the whole page in one pass -- previously each level's members
// were fetched and painted separately AFTER the stats-only shell already
// rendered, so a visit showed skeleton -> per-level placeholder bars -> real
// breakdown, three visible stages instead of one clean loading transition
// (owner: "when you open team it first opens then shows those bars then
// back to real breakdown"). `STATE.teamMembers[level]` cache is preserved so
// a second visit in the same session still skips re-fetching.
async function renderTeam(){
  var el = $('page-team');
  if (!STATE.loaded.team) el.innerHTML = '<div class="sk sk-card" style="height:110px;margin:16px 0"></div>' + skRows(3);
  // Each level resolves to { members, failed } rather than a bare array, so
  // a fetch error can be told apart from a genuinely empty level both when
  // rendering (a failed fetch must not read as "No referrals yet") and when
  // caching (only a SUCCESSFUL result is written to STATE.teamMembers[l] --
  // caching [] on failure would otherwise silently treat that level as
  // confirmed-empty forever, since a cached [] is still truthy and skips
  // re-fetching on every later visit).
  var memberFetches = [1,2,3].map(function(l){
    if (STATE.teamMembers[l]) return Promise.resolve({ members: STATE.teamMembers[l], failed: false });
    return api('/team/members?level=' + l, null, 'GET').then(function(r){
      if (r.status !== 'success') return { members: [], failed: true };
      var members = r.members || [];
      STATE.teamMembers[l] = members;
      return { members: members, failed: false };
    });
  });
  var results = await Promise.all([api('/team/stats')].concat(memberFetches));
  var statsR = results[0];
  if (statsR.status === 'success') STATE.teamStats = statsR;
  STATE.loaded.team = true;
  var s = STATE.teamStats || { counts:{l1:0,l2:0,l3:0}, commission:0, milestones:[] };
  var LEVEL_PCT = { 1:28, 2:2, 3:1 };

  var html = bannerHtml('giftbox', 'cluster');
  html += '<div class="mystats">' +
    '<div class="card"><div class="lab">Total Referrals</div><div class="val">' + ((s.counts.l1||0)+(s.counts.l2||0)+(s.counts.l3||0)) + '</div></div>' +
    '<div class="card"><div class="lab">Total Commission</div><div class="val mono">' + ugx(s.commission) + '</div></div>' +
  '</div>';
  var TEAM_PAGE_SIZE = 5;
  [1,2,3].forEach(function(l){
    var lvl = results[l] || { members: [], failed: true };
    html += '<div class="section-title">Level ' + l + ' <span class="see-all">' + LEVEL_PCT[l] + '%</span></div>';
    var expanded = !!STATE.teamExpanded[l];
    var visible = expanded ? lvl.members : lvl.members.slice(0, TEAM_PAGE_SIZE);
    html += lvl.failed ? emptyState('cluster','Could not load this level — reopen the Team tab to retry.') :
      lvl.members.length ?
      '<div class="card">' + visible.map(function(m){
        return '<div class="member-row"><div class="av">' + esc(String(m.phone||'?').slice(-2)) + '</div>' +
          '<div class="info"><div class="phone">' + esc(m.phone) + '</div><div class="date">Joined ' + timeAgo(m.joinedAt) + '</div></div>' +
          '<span class="pill ' + (m.hasInvested?'pill-active':'pill-pending') + '">' + (m.hasInvested?'Active':'Pending') + '</span></div>';
      }).join('') + '</div>' +
      (lvl.members.length > TEAM_PAGE_SIZE ? '<div class="view-more-row"><button class="view-more-lvl" data-level="' + l + '">' + (expanded ? 'View less' : 'View more (' + (lvl.members.length - TEAM_PAGE_SIZE) + ')') + '</button></div>' : '') +
      listEndFooter() :
      emptyState('cluster','No referrals at this level yet.');
  });
  html += '<div class="section-title">Task Center</div><div id="taskList"></div>';
  el.innerHTML = html;
  qsa('.view-more-lvl', el).forEach(function(btn){ btn.onclick = function(){
    var l = Number(btn.dataset.level);
    STATE.teamExpanded[l] = !STATE.teamExpanded[l];
    renderTeam();
  }; });
  renderTaskList(s.milestones||[]);
}
function renderTaskList(milestones){
  var box = $('taskList'); if (!box) return;
  if (!milestones.length) { box.innerHTML = emptyState('gift','No missions available right now.'); return; }
  var groups = [
    { key:'count', title:'Active Level-1 Missions', items:milestones.filter(function(m){ return m.type === 'count'; }) },
    { key:'deposit', title:'Whole Team Deposit Missions', items:milestones.filter(function(m){ return m.type === 'deposit'; }) }
  ];
  box.innerHTML = groups.map(function(g){
    return '<div class="section-title mission-title">' + g.title + '</div>' + g.items.map(function(m){
      var pct = Math.min(100, Math.round((m.current/m.target)*100));
      var label = m.type === 'deposit' ? ('Team deposits ' + ugx(m.target)) : (m.target + ' active Level-1 referrals');
      return '<div class="milestone-card ' + (m.claimed?'done':'') + '">' +
        '<div class="ico">' + ico('gift') + '</div><div class="info"><div class="t">' + label + '</div>' +
        '<div class="p">Manual reward · ' + ugx(m.reward) + (m.claimed ? ' · Claimed' : ' · ' + (m.type==='deposit'?ugx(m.current):m.current) + ' / ' + (m.type==='deposit'?ugx(m.target):m.target)) + '</div>' +
        (!m.claimed ? '<div class="bar"><i style="width:'+pct+'%"></i></div>' : '') + '</div>' +
        (m.claimed ? '<span class="pill pill-done">' + ico('check') + '</span>' : m.achieved ? '<button class="claim" data-target="'+m.target+'" data-type="'+m.type+'">Claim reward</button>' : '<span class="mission-pending">Not yet reached</span>') +
      '</div>';
    }).join('');
  }).join('');
  qsa('.claim', box).forEach(function(c){ c.onclick = async function(){
    c.disabled = true; c.textContent = 'Claiming…';
    var r = await api('/team/milestone/claim', { target:Number(c.dataset.target), type:c.dataset.type });
    if (r.status === 'success') { toast(r.message); STATE.loaded.team=false; STATE.loaded.home=false; renderTeam(); }
    else { c.disabled=false; c.textContent='Claim'; toast(r.message,true); }
  }; });
}
// ── ACCOUNT ───────────────────────────────────────────────────────────
async function renderAccount(){
  var el = $('page-account');
  if (!STATE.loaded.account) el.innerHTML = '<div class="sk sk-card" style="height:90px;margin:16px 0"></div>' + skRows(2);
  var r = STATE.account ? {status:'success', account:STATE.account} : await api('/account');
  if (r.status === 'success') STATE.account = r.account;
  STATE.loaded.account = true;
  var acc = STATE.account || {};

  var html = identityBannerHtml(acc);

  html += '<div class="card referral-card">' +
    '<div class="referral-label">Your Referral Code</div>' +
    '<div class="referral-row">' +
      '<div class="referral-code mono">' + esc(acc.referralCode||'—') + '</div>' +
      '<button class="iconbtn" id="copyRefCodeBtn" aria-label="Copy referral code">' + ico('copy') + '</button>' +
    '</div>' +
    '<div class="referral-label referral-link-label">Your Referral Link</div>' +
    '<div class="referral-row referral-link-row"><div class="referral-link mono" id="referralLink">' + esc(referralLink(acc.referralCode)) + '</div><button class="iconbtn" id="shareRefBtn" aria-label="Share referral link">' + ico('share') + '</button></div>' +
    '<div class="referral-hint">Copy your code or share your personal link to invite people.</div>' +
  '</div>';

  html += '<div class="card giftcode-card">' +
    '<div class="giftcode-row">' +
      '<div class="field">' + ico('gift') + '<input id="giftCodeInput" type="text" maxlength="5" placeholder="Enter gift code" autocapitalize="characters" autocomplete="off"></div>' +
      '<button class="btn btn-primary" id="giftCodeBtn">Redeem</button>' +
    '</div>' +
  '</div>';

  var sett = STATE.settings || {};
  if (sett.telegramGroup || sett.telegramChannel) {
    html += '<div class="card telegram-card">' +
      '<div class="referral-label">Join The Community</div>' +
      '<div class="telegram-row">' +
        (sett.telegramGroup ? '<button class="btn btn-secondary" id="telegramGroupBtn">' + ico('telegram') + '<span>Group</span></button>' : '') +
        (sett.telegramChannel ? '<button class="btn btn-secondary" id="telegramChannelBtn">' + ico('telegram') + '<span>Channel</span></button>' : '') +
      '</div>' +
    '</div>';
  }

  html += '<div class="matrix">' +
    '<div class="mtile" id="mBind">' + ico('lock') + '<span>Withdrawal Account</span></div>' +
    '<div class="mtile" id="mDeposits">' + ico('history') + '<span>Deposits</span></div>' +
    '<div class="mtile" id="mWithdrawals">' + ico('wallet') + '<span>Withdrawals</span></div>' +
    '<div class="mtile" id="mPin">' + ico('shield') + '<span>Security PIN</span></div>' +
  '</div>';

  html += '<div class="menu-list">' +
    '<div class="menu-row" id="passwordRow">' + ico('key') + '<span>Password Management</span>' + ico('chev').replace('<svg ', '<svg class="chev" ') + '</div>' +
    menuRow('info','About Space8','about') +
    menuRow('doc','Rules','rules') +
    menuRow('support','Support','support') +
    '<div class="menu-row" id="getAppRow">' + ico('download') + '<span>Get App</span></div>' +
  '</div>';
  html += '<div class="menu-list" style="margin-top:14px">' +
    '<div class="menu-row" id="logoutRow">' + ico('logout') + '<span>Log Out</span></div>' +
  '</div>';

  el.innerHTML = html;
  $('mBind').onclick = function(){ openPayoutSheet(); };
  $('mDeposits').onclick = function(){ openHistorySheet('deposit'); };
  $('mWithdrawals').onclick = function(){ openHistorySheet('withdrawal'); };
  $('mPin').onclick = openPinSheet;
  $('passwordRow').onclick = openPasswordSheet;
  $('shareRefBtn').onclick = function(){ shareReferral(acc.referralCode); };
  $('copyRefCodeBtn').onclick = function(){ copyText(acc.referralCode, 'Referral code'); };
  qsa('.mini-copy', el).forEach(function(btn){ btn.onclick = function(){ copyText(btn.dataset.copy, btn.dataset.copyLabel); }; });
  $('logoutRow').onclick = doLogout;
  $('getAppRow').onclick = promptInstallApp;
  $('giftCodeBtn').onclick = redeemGiftCode;
  $('giftCodeInput').addEventListener('keydown', function(e){ if (e.key === 'Enter') $('giftCodeBtn').click(); });
  if ($('telegramGroupBtn')) $('telegramGroupBtn').onclick = function(){ window.open(sett.telegramGroup, '_blank'); };
  if ($('telegramChannelBtn')) $('telegramChannelBtn').onclick = function(){ window.open(sett.telegramChannel, '_blank'); };
  qsa('.menu-row[data-key]').forEach(function(row){
    row.onclick = function(){ openInfoSheet(row.dataset.key); };
  });
}
async function promptInstallApp(){
  if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) {
    return toast('Space8 is already installed on this device.');
  }
  var evt = window._installPrompt;
  if (evt) {
    window._installPrompt = null;
    try {
      await evt.prompt();
      var choice = await evt.userChoice;
      if (choice && choice.outcome === 'accepted') toast('Installing Space8…');
    } catch (_) {
      toast('Use your browser menu to install the app.', true);
    }
    return;
  }
  openSheet('generic', '<div class="sheet-title">Get App</div><div style="font-size:13.5px;line-height:1.6;color:var(--ink-dim)">' +
    'Open your browser menu and choose "Add to Home Screen" (or "Install App") to install Space8 on this device.</div>');
}
function menuRow(icon, label, key){
  return '<div class="menu-row" data-key="' + key + '">' + ico(icon) + '<span>' + esc(label) + '</span>' + ico('chev').replace('<svg ', '<svg class="chev" ') + '</div>';
}
function referralLink(code){
  // Query-string form, not a path -- see the _refCode parsing comment near
  // the top of this file for why: the bare root path always resolves with
  // no server-side rewrite config, a path like the old /register/ref=CODE
  // form does not.
  return location.origin + '/?ref=' + encodeURIComponent(String(code || ''));
}
function shareReferral(code){
  var link = referralLink(code);
  var text = 'Join Space8 and start earning with my referral link.';
  if (navigator.share) navigator.share({ title: 'Join Space8', text: text, url: link }).catch(function(){});
  else copyText(link, 'Referral link');
}
async function redeemGiftCode(){
  var input = $('giftCodeInput');
  var code = input.value.trim();
  if (!code) return toast('Enter a gift code first', true);
  var btn = $('giftCodeBtn');
  setBtnLoading(btn, true, 'Redeeming…');
  var r = await api('/redeem', { code: code });
  setBtnLoading(btn, false);
  if (r.status === 'success') {
    toast('+' + ugx(r.reward) + ' credited!');
    input.value = '';
    if (STATE.account) STATE.account.walletBalance = (STATE.account.walletBalance || 0) + (r.reward || 0);
    STATE.loaded.home = false;
    if (STATE.currentPage === 'home') renderHome();
  } else toast(r.message, true);
}
async function openInfoSheet(key){
  var s = STATE.settings || (await api('/public/settings')).settings || {};
  var map = {
    about: ['About Space8', s.aboutText || 'Space8 lets you invest in satellite-themed plans and earn daily returns.'],
    rules: ['Rules', s.rulesText || 'Standard platform rules apply.'],
    support: ['Support', 'Telegram: ' + esc(s.supportTelegram||'—') + '<br>WhatsApp: ' + esc(s.whatsappContact||'—') + '<br>Hours: ' + esc(s.supportHours||'—')]
  };
  var m = map[key] || ['Info',''];
  openSheet('generic', '<div class="sheet-title">' + m[0] + '</div><div style="font-size:13.5px;line-height:1.6;color:var(--ink-dim)">' + m[1] + '</div>');
}

// ── PAYOUT ACCOUNT / PIN ─────────────────────────────────────────────
// Multiple mobile-money accounts can be bound (server already supports
// this -- /bank/save always adds a new row, never overwrites) -- shown
// here as a list so a member can hold more than one, remove one they no
// longer use, and (2026-08-16, owner correction) pick between them for a
// WITHDRAWAL by navigating here as a real page, not an inline picker
// embedded in the withdraw sheet: openPayoutSheet(pickCallback) opens this
// same screen in "choose" mode -- tap any account, it calls the callback
// with that account and this page closes on its own, dropping the member
// straight back onto the withdraw sheet underneath (which was never
// closed, just temporarily covered -- same stacked-sheet mechanism
// openSheet() already uses everywhere else). Deposits do NOT use this at
// all; they take a phone/network typed fresh each time, unchanged.
var _payoutDeletePending = null;
var _payoutPickCallback = null;
async function openPayoutSheet(pickCallback){
  _payoutPickCallback = pickCallback || null;
  openSheet('payout', '<div class="sk sk-line"></div>');
  await renderPayoutSheet();
}
async function renderPayoutSheet(){
  var r = await api('/bank/list', null, 'GET');
  var accounts = r.status === 'success' ? (r.accounts || []) : [];
  STATE.bankAccounts = accounts;
  var picking = !!_payoutPickCallback;
  var listHtml = accounts.length ? accounts.map(function(a){
    var pending = !picking && _payoutDeletePending === a.id;
    return '<div class="record-row acct-row' + (picking ? ' selectable' : '') + '" data-id="' + esc(a.id) + '">' +
      '<div class="info"><div class="phone">' + esc(a.holder) + '</div>' +
      '<div class="date">' + esc(a.network) + ' · ' + esc(a.phone) + '</div>' +
      (pending ?
        '<div style="margin-top:10px;display:flex;gap:8px;align-items:center">' +
          '<input type="password" inputmode="numeric" maxlength="4" placeholder="PIN" class="del-pin" style="width:64px;background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.4);border-radius:8px;padding:8px 10px;color:#fff;font-size:14px">' +
          '<button class="btn-confirm-del" style="background:#fff;color:var(--danger);border:none;border-radius:8px;padding:8px 12px;font-weight:700;font-size:12.5px">Delete</button>' +
          '<button class="btn-cancel-del" style="background:rgba(255,255,255,.18);color:#fff;border:none;border-radius:8px;padding:8px 12px;font-weight:600;font-size:12.5px">Cancel</button>' +
        '</div>' : '') +
      '</div>' +
      (picking ? ico('chev').replace('<svg ', '<svg class="chev" ') :
        (!pending ? '<button class="acct-del" data-del="' + esc(a.id) + '">' + ico('trash') + '</button>' : '')) +
    '</div>';
  }).join('') : emptyState('wallet', 'No withdrawal accounts bound yet.');

  // In picking mode with nothing to pick from yet, show the add-account
  // form right here instead of a dead end -- owner, 2026-08-17: "in most
  // cases if one has no, it says add payout account after he taps on it
  // and comes back to withdrawal screen automatically." Saving here
  // re-renders this same picker (still in picking mode, see savePayoutBtn
  // below), which now has a real account to tap -- no separate detour.
  var showAddForm = !picking || !accounts.length;

  // Content-only update, no openSheet() here -- the sheet was already
  // opened (and its one history/stack entry pushed) by openPayoutSheet()
  // before this ever runs; re-pushing on every internal interaction
  // (delete-pending toggle, cancel, post-delete, post-add) would mean the
  // phone Back button has to be pressed once per interaction before it
  // actually leaves the page.
  $('payoutSheet').innerHTML =
    '<div class="sheet-title">' + (picking ? 'Choose Withdrawal Account' : 'Withdrawal Accounts') + '</div>' +
    '<div class="sheet-sub">' + (picking ? (accounts.length ? 'Tap the account to send this withdrawal to.' : 'Add a withdrawal account below, then tap it to continue.') : 'Mobile-money accounts you can withdraw to.') + '</div>' +
    listHtml +
    (!showAddForm ? '' :
      (picking ? '' : '<div class="plain-note">Withdrawals only ever go to an account bound here, never a number typed at withdrawal time. Add another account below, or remove one you no longer use with your withdrawal PIN.</div>') +
      '<div class="auth-form">' +
        '<div class="field">' + ico('wallet') + '<input id="payHolder" placeholder="Account holder name"></div>' +
        '<select id="payNetwork" class="field" style="appearance:none">' +
          '<option value="MTN Mobile Money">MTN Mobile Money</option>' +
          '<option value="Airtel Money">Airtel Money</option>' +
        '</select>' +
        '<div class="field">' + ico('phone') + '<input id="payPhone" type="tel" inputmode="tel" maxlength="10" placeholder="07XXXXXXXX"></div>' +
        '<div class="field">' + ico('shield') + '<input id="payPin" type="password" inputmode="numeric" maxlength="4" placeholder="Your withdrawal PIN" autocomplete="one-time-code"></div>' +
        '<div class="field-hint">Enter the withdrawal PIN you set when you registered.</div>' +
      '</div>' +
      '<button class="btn btn-primary" id="savePayoutBtn" style="margin-top:14px">Add Withdrawal Account</button>');

  if (showAddForm) {
    $('savePayoutBtn').onclick = async function(){
      var btn = $('savePayoutBtn');
      var holder = $('payHolder').value.trim(), network = $('payNetwork').value;
      var phone = $('payPhone').value, pin = $('payPin').value;
      if (!holder || !cleanPhone(phone) || !/^\d{4}$/.test(pin)) return toast('Fill in all fields correctly', true);
      setBtnLoading(btn, true, 'Saving…');
      var r2 = await api('/bank/save', { holder: holder, network: network, phone: phone, pin: pin });
      setBtnLoading(btn, false);
      if (r2.status === 'success') { toast('Withdrawal account saved'); STATE.bankAccounts = null; STATE.hasPayoutPin = true; renderPayoutSheet(); }
      else toast(r2.message, true);
    };
  }

  if (picking) {
    qsa('.acct-row', $('payoutSheet')).forEach(function(row){
      row.onclick = function(){
        var acct = accounts.find(function(a){ return a.id === row.dataset.id; });
        var cb = _payoutPickCallback;
        _payoutPickCallback = null;
        closeSheet('payout');
        if (cb && acct) cb(acct);
      };
    });
    return;
  }

  qsa('.acct-del').forEach(function(btn){
    btn.onclick = function(){ _payoutDeletePending = btn.dataset.del; renderPayoutSheet(); };
  });
  qsa('.btn-cancel-del').forEach(function(btn){
    btn.onclick = function(){ _payoutDeletePending = null; renderPayoutSheet(); };
  });
  qsa('.btn-confirm-del').forEach(function(btn){
    btn.onclick = async function(){
      var row = btn.closest('.acct-row');
      var pin = qs('.del-pin', row).value;
      if (!/^\d{4}$/.test(pin)) return toast('Enter your 4-digit PIN', true);
      btn.textContent = '…'; btn.disabled = true;
      var r2 = await api('/bank/delete', { id: _payoutDeletePending, pin: pin });
      if (r2.status === 'success') {
        toast('Account removed');
        _payoutDeletePending = null;
        STATE.bankAccounts = null;
        renderPayoutSheet();
      } else {
        toast(r2.message, true);
        btn.textContent = 'Delete'; btn.disabled = false;
      }
    };
  });
}
async function openPinSheet(){
  var status = await api('/account/payout-pin/status', null, 'GET');
  var has = status.status === 'success' && status.hasPayoutPin;
  openSheet('generic',
    '<div class="sheet-title">Security PIN</div>' +
    '<div class="sheet-sub">' + (has ? 'Change your 4-digit withdrawal PIN.' : 'No withdrawal PIN on this account yet — it should have been set at registration. Contact support if this looks wrong.') + '</div>' +
    (has ?
      '<div class="auth-form">' +
        '<div class="field">' + ico('shield') + '<input id="oldPin" type="password" inputmode="numeric" maxlength="4" placeholder="Current PIN" autocomplete="one-time-code"></div>' +
        '<div class="field">' + ico('shield') + '<input id="newPin" type="password" inputmode="numeric" maxlength="4" placeholder="New 4-digit PIN" autocomplete="one-time-code"></div>' +
      '</div><button class="btn btn-primary" id="changePinBtn" style="margin-top:14px">Change PIN</button>' : '')
  );
  var btn = $('changePinBtn');
  if (btn) btn.onclick = async function(){
    var oldPin = $('oldPin').value, newPin = $('newPin').value;
    if (!/^\d{4}$/.test(oldPin) || !/^\d{4}$/.test(newPin)) return toast('Enter valid 4-digit PINs', true);
    if (/^(\d)\1{3}$/.test(newPin)) return toast('That PIN is too easy to guess (e.g. 1111, 2222). Choose 4 digits that are not all the same.', true);
    setBtnLoading(btn, true);
    var r = await api('/account/payout-pin/change', { oldPin: oldPin, newPin: newPin });
    setBtnLoading(btn, false);
    if (r.status === 'success') { toast('PIN changed'); closeSheet('generic'); } else toast(r.message, true);
  };
}

// ── PASSWORD MANAGEMENT ──────────────────────────────────────────────
// Pure client-side Firebase, same as login/register/logout -- no server
// endpoint involved, matching how this app already handles auth. Firebase
// requires a recent sign-in before allowing a sensitive change like this,
// hence re-authenticating with the CURRENT password first (fbChangePassword
// in index.html's plain <script>) rather than calling updatePassword directly.
function openPasswordSheet(){
  openSheet('generic',
    '<div class="sheet-title">Password Management</div>' +
    '<div class="sheet-sub">Change the password you use to log in.</div>' +
    '<div class="auth-form">' +
      '<div class="field">' + ico('key') + '<input id="curPassword" type="password" autocomplete="current-password" placeholder="Current password"></div>' +
      '<div class="field">' + ico('key') + '<input id="newPassword" type="password" autocomplete="new-password" placeholder="New password (min 6 characters)"></div>' +
      '<div class="field">' + ico('key') + '<input id="newPassword2" type="password" autocomplete="new-password" placeholder="Confirm new password"></div>' +
    '</div>' +
    '<button class="btn btn-primary" id="changePasswordBtn" style="margin-top:14px">Change Password</button>'
  );
  $('changePasswordBtn').onclick = changePassword;
}
async function changePassword(){
  var btn = $('changePasswordBtn');
  var cur = $('curPassword').value, next = $('newPassword').value, next2 = $('newPassword2').value;
  if (!cur) return toast('Enter your current password', true);
  if (next.length < 6) return toast('New password must be at least 6 characters', true);
  if (next !== next2) return toast('New passwords do not match', true);
  setBtnLoading(btn, true, 'Updating…');
  try {
    await window.fbChangePassword(cur, next);
    setBtnLoading(btn, false);
    toast('Password changed');
    closeSheet('generic');
  } catch (e) {
    setBtnLoading(btn, false);
    var msg = 'Could not change your password.';
    var code = String(e.code || '');
    if (code.indexOf('wrong-password') !== -1 || code.indexOf('invalid-credential') !== -1) msg = 'Current password is incorrect.';
    else if (code.indexOf('weak-password') !== -1) msg = 'Choose a stronger password (min 6 characters).';
    else if (code.indexOf('too-many-requests') !== -1) msg = 'Too many attempts. Try again later.';
    toast(msg, true);
  }
}

// ── DEPOSIT ───────────────────────────────────────────────────────────
// Deposits take a phone/network typed fresh each time, same as always --
// the owner's "select the account in payout accounts" instruction was
// specifically about WITHDRAWALS (2026-08-16 correction), not deposits.
function openDepositSheet(){
  var acc = STATE.account || {};
  var min = (STATE.settings||{}).minDeposit || 20000;
  openSheet('deposit', bannerHtml('basket','deposit') +
    '<div class="sheet-title">Deposit Funds</div>' +
    '<div class="sheet-sub">Minimum deposit ' + ugx(min) + '.</div>' +
    '<div class="auth-form">' +
      '<div class="field">' + ico('deposit') + '<input id="depAmount" type="text" inputmode="numeric" maxlength="9" placeholder="Amount (UGX)"></div>' +
      '<div class="field">' + ico('phone') + '<input id="depPhone" type="tel" inputmode="tel" maxlength="10" placeholder="07XXXXXXXX" value="' + esc(acc.phone||'') + '"></div>' +
      '<select id="depNetwork" class="field" style="appearance:none">' +
        '<option value="MTN Mobile Money">MTN Mobile Money</option>' +
        '<option value="Airtel Money">Airtel Money</option>' +
      '</select>' +
    '</div>' +
    '<button class="btn btn-primary" id="submitDepositBtn" style="margin-top:14px">Deposit Now</button>' +
    '<div class="instruction-card"><b>Deposit instructions</b><ol>' +
      '<li>Enter the amount you want to deposit, at least ' + ugx(min) + '.</li>' +
      '<li>Enter the mobile-money number to pay from, and pick the correct network.</li>' +
      '<li>Tap Deposit Now — a payment prompt will appear on that phone.</li>' +
      '<li>Approve the prompt using your mobile-money PIN.</li>' +
      '<li>Your wallet balance updates automatically once payment is confirmed.</li>' +
    '</ol></div>'
  );
  $('submitDepositBtn').onclick = async function(){
    var btn = $('submitDepositBtn');
    var amt = parseInt($('depAmount').value, 10);
    var phone = $('depPhone').value, network = $('depNetwork').value;
    if (!amt || amt < min) return toast('Enter at least ' + ugx(min), true);
    if (!cleanPhone(phone)) return toast('Enter a valid mobile-money number', true);
    setBtnLoading(btn, true, 'Initiating…');
    var r = await api('/deposit/marzpay', { amount: amt, phone: phone, network: network });
    setBtnLoading(btn, false);
    if (r.status === 'success') {
      toast('Check your phone to approve the payment');
      closeSheet('deposit');
      pollDepositStatus(r.depositId);
    } else toast(r.message, true);
  };
}
function pollDepositStatus(id){
  var tries = 0;
  var iv = setInterval(async function(){
    tries++;
    var r = await api('/deposit/marzpay/status', { depositId: id });
    if (r.status === 'success' && r.state && r.state !== 'pending') {
      clearInterval(iv);
      if (r.state === 'matched') {
        toast('Deposit successful');
        STATE.account = null; STATE.loaded.home = false;
        if (STATE.currentPage === 'home') renderHome();
      } else toast(r.message || 'Deposit failed', true);
    }
    if (tries > 40) clearInterval(iv);
  }, 3000);
}

// ── WITHDRAW ──────────────────────────────────────────────────────────
function openWithdrawSheet(){
  var min = (STATE.settings||{}).minWithdraw || 20000;
  var feePct = (STATE.settings||{}).withdrawFeePct || 15;
  renderWithdrawSheet(null, min, feePct, true);
}
// Owner correction, 2026-08-16: the account to withdraw to is picked by
// navigating to the real Payout Accounts page (openPayoutSheet in "choose"
// mode, stacked on top of this sheet) and tapping one there -- it returns
// here automatically with the tapped account applied. NOT an inline list
// embedded in this sheet (that was the wrong shape, tried and reverted).
// **No account is ever auto-selected, even when exactly one is bound** --
// owner, 2026-08-17: "he picks the number from withdrawal accounts even if
// it is 1, it should not auto select." The sheet always opens with a
// "Select payout account" placeholder row (acct === null) and only shows a
// real account once the member has explicitly tapped through the picker,
// same blue .acct-row styling either way. A member with ZERO bound
// accounts still taps this same row: openPayoutSheet's picker (see
// renderPayoutSheet) now shows the add-account form INLINE whenever
// picking with nothing to pick from yet, so adding one there re-renders
// the same picker with the new account now tappable -- no separate
// "bind first" detour, and it returns to this sheet automatically via the
// same pickCallback every other picker selection already uses.
// isFirstRender controls whether this pushes a new history entry
// (openSheet) or just updates the sheet's content in place (coming back
// from the picker) -- re-pushing on every account change would mean the
// phone Back button has to be pressed once per account switch before it
// actually leaves the sheet.
function renderWithdrawSheet(acct, min, feePct, isFirstRender){
  var html = bannerHtml('marscrate','withdraw') +
    '<div class="sheet-title">Withdraw Funds</div>' +
    '<div class="record-row acct-row selectable" id="wdAcctRow">' +
      '<div class="info"><div class="phone">' + (acct ? esc(acct.holder) : 'Select payout account') + '</div>' +
      (acct ? '<div class="date">' + esc(acct.network) + ' · ' + esc(acct.phone) + '</div>' : '') + '</div>' +
      ico('chev').replace('<svg ', '<svg class="chev" ') +
    '</div>' +
    '<div class="auth-form" style="margin-top:14px">' +
      '<div class="field">' + ico('withdraw') + '<input id="wdAmount" type="text" inputmode="numeric" maxlength="9" placeholder="Amount (UGX), min ' + ugx(min) + '"></div>' +
      '<div class="field-hint" id="feePreview">Fee ' + feePct + '% applies — enter an amount to see what you\'ll receive.</div>' +
      '<div class="field">' + ico('shield') + '<input id="wdPin" type="password" inputmode="numeric" maxlength="4" placeholder="4-digit security PIN"></div>' +
    '</div>' +
    '<button class="btn btn-primary" id="submitWithdrawBtn" style="margin-top:14px" ' + (acct?'':'disabled') + '>Request Withdrawal</button>' +
    '<div class="instruction-card"><b>Withdrawal instructions</b><ol>' +
      '<li>Tap the account row above to choose which withdrawal account receives the money.</li>' +
      '<li>Enter the amount you want to withdraw, at least ' + ugx(min) + '.</li>' +
      '<li>Enter your 4-digit security PIN to confirm.</li>' +
      '<li>The withdrawal fee (' + feePct + '%) is deducted automatically — the fee preview above shows what you\'ll actually receive.</li>' +
      '<li>Tap Request Withdrawal. Each request is reviewed before money is sent.</li>' +
    '</ol></div>';

  if (isFirstRender) openSheet('withdraw', html);
  else $('withdrawSheet').innerHTML = html;

  $('wdAcctRow').onclick = function(){
    openPayoutSheet(function(newAcct){
      renderWithdrawSheet(newAcct, min, feePct, false);
    });
  };
  $('wdAmount').addEventListener('input', function(){
    var amt = parseInt(this.value,10) || 0;
    var fee = Math.round(amt * feePct / 100);
    $('feePreview').textContent = amt > 0 ? ('Fee ' + ugx(fee) + ' — you receive ' + ugx(amt-fee)) : ('Fee ' + feePct + '% applies.');
  });
  $('submitWithdrawBtn').onclick = async function(){
    var btn = $('submitWithdrawBtn');
    if (!acct) return toast('Select a payout account first', true);
    var amt = parseInt($('wdAmount').value, 10);
    var pin = $('wdPin').value;
    if (!amt || amt < min) return toast('Enter at least ' + ugx(min), true);
    if (!/^\d{4}$/.test(pin)) return toast('Enter your 4-digit PIN', true);
    setBtnLoading(btn, true, 'Processing…');
    var r = await api('/withdraw/request', { amount: amt, method:'mobile_money', holder: acct.holder, network: acct.network, phone: acct.phone, pin: pin });
    setBtnLoading(btn, false);
    if (r.status === 'success') {
      toast('Withdrawal requested');
      closeSheet('withdraw');
      STATE.account = null; STATE.loaded.home = false;
      if (STATE.currentPage === 'home') renderHome();
    } else toast(r.message, true);
  };
}

// ── FLOATING ASSISTANT (server-side, Claude-backed) ─────────────────────
var ASSIST_QUICK = ['How do I deposit?', 'How do I withdraw?', 'How do referrals work?', 'How do I invest?'];
var ASSIST_HISTORY = []; // {role:'user'|'assistant', text}
function addMsg(text, who){
  var body = $('assistBody');
  var div = document.createElement('div');
  div.className = 'msg ' + who;
  div.textContent = text;
  body.appendChild(div);
  body.scrollTop = body.scrollHeight;
  return div;
}
function addTyping(){
  var body = $('assistBody');
  var div = document.createElement('div');
  div.className = 'msg bot typing';
  div.innerHTML = '<span></span><span></span><span></span>';
  body.appendChild(div);
  body.scrollTop = body.scrollHeight;
  return div;
}
async function assistSend(text){
  addMsg(text, 'user');
  ASSIST_HISTORY.push({ role: 'user', text: text });
  var typing = addTyping();
  var reply;
  try {
    var r = await api('/assistant/chat', { message: text, history: ASSIST_HISTORY.slice(-8) });
    reply = (r && r.status === 'success' && r.reply) ? r.reply : 'The assistant is unavailable right now — reach Support from the Account tab.';
  } catch (e) {
    reply = "Couldn't reach the assistant — check your connection, or reach Support from the Account tab.";
  }
  typing.remove();
  addMsg(reply, 'bot');
  ASSIST_HISTORY.push({ role: 'assistant', text: reply });
}
function openAssistant(){
  $('assistPanel').classList.add('show');
  history.pushState({ overlay: 'assist' }, '', '');
  if (!$('assistBody').childElementCount) {
    addMsg("Hi! I'm the Space8 assistant. Ask me anything about deposits, withdrawals, investing, referrals or your account.", 'bot');
    var sett = STATE.settings || {};
    var links = '';
    if (sett.telegramGroup) links += '<button class="btn btn-secondary" id="assistGroupBtn">' + ico('telegram') + '<span>Telegram Group</span></button>';
    links += '<button class="btn btn-secondary" id="assistCareBtn">' + ico('support') + '<span>Customer Care</span></button>';
    $('assistLinks').innerHTML = links;
    if ($('assistGroupBtn')) $('assistGroupBtn').onclick = function(){ window.open(sett.telegramGroup, '_blank'); };
    // Pure DOM close (not closeSheet/history.back()) -- the assistant
    // panel and a sheet are two different full-screen overlays sharing
    // the same history slot mechanism; closing this one first keeps
    // exactly one overlay "current" at a time instead of a sheet opening
    // stacked behind the still-open assistant panel.
    $('assistCareBtn').onclick = function(){ hideAssistant(); openInfoSheet('support'); };
    $('assistQuick').innerHTML = ASSIST_QUICK.map(function(q){ return '<div class="qchip">' + esc(q) + '</div>'; }).join('');
    qsa('.qchip').forEach(function(c){ c.onclick = function(){ assistSend(c.textContent); }; });
  }
}
function hideAssistant(){ $('assistPanel').classList.remove('show'); }
$('assistFab').onclick = openAssistant;
$('assistClose').onclick = function(){
  if (history.state && history.state.overlay === 'assist') history.back();
  else hideAssistant();
};
$('assistSend').onclick = function(){
  var input = $('assistInput');
  var text = input.value.trim();
  if (!text) return;
  input.value = '';
  assistSend(text);
};
$('assistInput').addEventListener('keydown', function(e){
  if (e.key === 'Enter') { e.preventDefault(); $('assistSend').click(); }
});

// ── NOTIFICATIONS ─────────────────────────────────────────────────────
async function openNotificationsSheet(){
  openSheet('generic', '<div class="sheet-title">Notifications</div><div id="notifBody">' + skRows(3) + '</div>');
  var r = await api('/notifications', null, 'GET');
  var body = $('notifBody'); if (!body) return;
  var items = r.status === 'success' ? (r.notifications || []) : [];
  body.innerHTML = items.length ? items.map(function(n){
    var unread = !n.readAt && !n.read;
    return '<div class="card" style="margin-bottom:10px;border:' + (unread ? '1px solid var(--blue-glow)' : '1px solid transparent') + '">' +
      '<div style="display:flex;gap:10px;align-items:flex-start"><div style="width:9px;height:9px;border-radius:50%;margin-top:6px;background:' + (unread ? 'var(--blue)' : 'var(--line)') + ';flex-shrink:0"></div><div style="min-width:0;flex:1">' +
      '<div style="font-weight:700;margin-bottom:4px">' + esc(n.title || 'Space8 update') + '</div>' +
      '<div style="font-size:13px;color:var(--ink-dim);line-height:1.5">' + esc(n.body || '') + '</div>' +
      (n.createdAt ? '<div style="font-size:11px;color:var(--blue-mute);margin-top:8px">' + esc(timeAgo(n.createdAt)) + '</div>' : '') +
      '</div></div></div>';
  }).join('') + listEndFooter() : emptyState('doc','No more data');
  var unreadIds = items.filter(function(n){ return n.id && !n.readAt && !n.read; }).map(function(n){ return n.id; });
  if (unreadIds.length) api('/notifications/read', { ids: unreadIds }, 'POST', false).catch(function(){});
}
$('notifBtn').onclick = openNotificationsSheet;



// ── BOOT ──────────────────────────────────────────────────────────────
async function boot(){
  var setR = await api('/public/settings');
  if (setR.status === 'success') STATE.settings = setR.settings;
  var bannerR = await api('/public/banners');
  if (bannerR.status === 'success') STATE.banners = bannerR.banners || {};
  if (STATE.banners.authbg) {
    document.documentElement.style.setProperty('--auth-bg-url', 'url("' + STATE.banners.authbg + '")');
  }
  var blurPx = (STATE.settings||{}).authBgBlurPx;
  var tintPct = (STATE.settings||{}).authBgTintPct;
  document.documentElement.style.setProperty('--auth-bg-blur', (blurPx != null ? blurPx : 20) + 'px');
  document.documentElement.style.setProperty('--auth-bg-tint', (tintPct != null ? tintPct : 78) / 100);
  if (STATE.banners.appbg) {
    document.documentElement.style.setProperty('--app-bg-url', 'url("' + STATE.banners.appbg + '")');
  }
  var appBlurPx = (STATE.settings||{}).appBgBlurPx;
  var appTintPct = (STATE.settings||{}).appBgTintPct;
  document.documentElement.style.setProperty('--app-bg-blur', (appBlurPx != null ? appBlurPx : 20) + 'px');
  document.documentElement.style.setProperty('--app-bg-tint', (appTintPct != null ? appTintPct : 78) / 100);
  var cardBlurPx = (STATE.settings||{}).cardBlurPx;
  var cardOpacityPct = (STATE.settings||{}).cardOpacityPct;
  document.documentElement.style.setProperty('--card-blur', (cardBlurPx != null ? cardBlurPx : 0) + 'px');
  document.documentElement.style.setProperty('--card-alpha', (cardOpacityPct != null ? cardOpacityPct : 100) / 100);
  var authCardBlurPx = (STATE.settings||{}).authCardBlurPx;
  var authCardOpacityPct = (STATE.settings||{}).authCardOpacityPct;
  document.documentElement.style.setProperty('--auth-card-blur', (authCardBlurPx != null ? authCardBlurPx : 0) + 'px');
  document.documentElement.style.setProperty('--auth-card-alpha', (authCardOpacityPct != null ? authCardOpacityPct : 100) / 100);
  if ((STATE.settings||{}).announcementBg) {
    document.documentElement.style.setProperty('--ann-bg-url', 'url("' + STATE.settings.announcementBg + '")');
  }
  var annBlurPx = (STATE.settings||{}).annBgBlurPx;
  var annTintPct = (STATE.settings||{}).annBgTintPct;
  document.documentElement.style.setProperty('--ann-bg-blur', (annBlurPx != null ? annBlurPx : 6) + 'px');
  document.documentElement.style.setProperty('--ann-bg-tint', (annTintPct != null ? annTintPct : 55) / 100);
  // Fetched here (not left to renderHome/renderProducts' own first call) so
  // the images below are already warm in the browser's cache by the time
  // either page actually renders -- renderHome/renderProducts both already
  // skip re-fetching when STATE.products is already set.
  var prodR = await api('/public/products');
  if (prodR.status === 'success') STATE.products = prodR.products;
  await preloadImages();
}
function preloadImages(){
  var urls = [];
  Object.keys(STATE.banners||{}).forEach(function(k){ if (STATE.banners[k]) urls.push(STATE.banners[k]); });
  (STATE.products||[]).forEach(function(p){ if (p.image) urls.push(p.image); });
  var loadOne = function(src){
    return new Promise(function(resolve){
      var img = new Image();
      img.onload = img.onerror = function(){ resolve(); };
      img.src = src;
    });
  };
  // Capped so one slow/broken image URL can't leave the loading screen up
  // indefinitely -- same reasoning as the api() fetch timeout above.
  var timeout = new Promise(function(resolve){ setTimeout(resolve, 6000); });
  return Promise.race([Promise.all(urls.map(loadOne)), timeout]);
}
window.addEventListener('space8-auth', async function(e){
  var user = e.detail;
  // Wait for boot() (settings/banners/products fetch + image preload) so the
  // loading screen stays up until images are already cached, instead of
  // handing off to Home/Products/the auth screens and having their images
  // visibly pop in a beat later.
  await _bootPromise;
  $('loadingScreen').style.display = 'none';
  if (user) {
    // A registration attempt currently in flight (its own handler above
    // will call enterApp() once /register actually finishes) -- don't race
    // it into the app early on a Firebase account that doesn't have a
    // finished Space8 profile yet.
    if (_registering) return;
    // Self-heal: covers a Firebase account left over from a PAST failed
    // registration attempt (a previous session, or this one after a
    // wrong-referral-code retry was abandoned) -- /register is idempotent
    // (locked + a registrationDone guard, see completeRegistrationCore in
    // server.js), so calling it again with no referral code is always safe
    // and guarantees the account eventually gets a real profile, welcome
    // bonus and referral code of its own instead of staying permanently
    // half-registered just because the original code was wrong once.
    //
    // Real bug, confirmed live (owner report, phone signed in fine but
    // balance/referral code/ID all blank and every action said "User not
    // found"): this used to only catch registrationDone:false -- a
    // PARTIALLY finished registration. It never caught the doc being
    // MISSING ENTIRELY (Firebase account created, but the very first
    // /register call after that never landed at all -- a dropped
    // connection, the app closed right after signup), because /account
    // returns a 404 status:'error' for that case, not status:'success', so
    // the old condition never matched and the account was permanently
    // stranded with no automatic recovery. /register self-heals a missing
    // doc on its own (see the comment in server.js's /register route), so
    // the only gap was ever telling the client TO call it here.
    try {
      var accR = await api('/account');
      var needsRegister = (accR.status === 'success' && accR.account && accR.account.registrationDone === false) ||
        (accR.status === 'error' && accR.code === 'NOT_FOUND');
      if (needsRegister) await api('/register', {}, 'POST', true);
    } catch (_) {}
    enterApp();
  } else {
    $('app').style.display = 'none';
    // A pending referral code (from _refCode's top-level parse) means this
    // load is a fresh visitor following a shared link -- without this
    // check, showLoginScreen() below would unconditionally win the race
    // against that earlier showRegisterScreen() call (Firebase's own auth
    // check is async and always resolves after the synchronous top-level
    // parse), landing the visitor back on Login with their referral code
    // silently sitting filled-in on a screen they can't see.
    if (_refCode) showRegisterScreen(); else showLoginScreen();
    stopLiveRefresh();
    resetUserState();
  }
});

// Lightweight server-confirmed live refresh: current account and plans are
// refreshed in the background while the app is visible, without a browser reload.
var _liveRefreshTimer = null;
function startLiveRefresh(){
  if (_liveRefreshTimer) return;
  _liveRefreshTimer = setInterval(async function(){
    if (document.hidden || !STATE.account || !window.fbAuth || !window.fbAuth.currentUser) return;
    var results = await Promise.all([api('/account', null, 'GET', false), api('/investments', null, 'GET', false)]);
    if (results[0].status === 'success') STATE.account = results[0].account;
    if (results[1].status === 'success') STATE.investments = results[1].investments || [];
    if (STATE.currentPage === 'home') renderHome();
    else if (STATE.currentPage === 'products') renderProducts();
  }, 12000);
}
function stopLiveRefresh(){ if (_liveRefreshTimer) { clearInterval(_liveRefreshTimer); _liveRefreshTimer = null; } }
document.addEventListener('visibilitychange', function(){ if (!document.hidden && STATE.account) { STATE.loaded.home = false; if (STATE.currentPage === 'home') renderHome(); } });

// Hide the "Space8" wordmark once the page scrolls -- the topbar has no
// opaque background of its own (it sits on the app wallpaper, see
// #app::before/::after above), so on scroll the wordmark used to overlap
// scrolled-past content instead of a solid bar. Fades back in near the top.
(function(){
  var topbar = $('topbar');
  if (!topbar) return;
  var ticking = false;
  window.addEventListener('scroll', function(){
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function(){
      topbar.classList.toggle('scrolled', window.scrollY > 12);
      ticking = false;
    });
  }, { passive: true });
})();
var _bootPromise = boot();
