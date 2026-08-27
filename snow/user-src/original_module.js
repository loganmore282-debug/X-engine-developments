// ── Update this once the real Render service URL is known ──
// NOTE: top-level bindings referenced elsewhere in this file must be `var`,
// not `const`/`let` — the obfuscation build (build-core.js) preserves
// top-level names by routing references through `window[...]`, which only
// works for names that genuinely become a `window` property (var/function
// declarations do; const/let never do, even at the top level of a classic
// script) — a `const` here broke at runtime post-obfuscation (verified via
// Playwright against the built artifact) even though it works fine
// unobfuscated. See build-core.js's own comment on this for the full story.
var API_BASE = 'https://mylifeismyhappiness.onrender.com';

var ICONS = {
  bell: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M6 10a6 6 0 1 1 12 0c0 4 1.5 5.5 1.5 5.5H4.5S6 14 6 10Z"/><path d="M10 19a2 2 0 0 0 4 0"/></svg>',
  deposit: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v8"/><path d="M8.5 12 12 15.5 15.5 12"/></svg>',
  withdraw: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 16.5v-8"/><path d="M8.5 12 12 8.5 15.5 12"/></svg>',
  chev: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
  backArrow: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>',
  home: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9a1 1 0 0 0 1 1H10v-5.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1V20h3.5a1 1 0 0 0 1-1v-9"/></svg>',
  box: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8.5 12 4 3 8.5 12 13l9-4.5Z"/><path d="M3 8.5V16l9 4.5 9-4.5V8.5"/><path d="M12 13v7.5"/></svg>',
  team: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="7.5" r="3"/><circle cx="5" cy="9" r="2.2"/><circle cx="19" cy="9" r="2.2"/><path d="M12 12.3c-2.9 0-5.3 1.9-5.3 5.2"/><path d="M12 12.3c2.9 0 5.3 1.9 5.3 5.2"/><path d="M5 13.5c-1.7.4-3 1.9-3 4"/><path d="M19 13.5c1.7.4 3 1.9 3 4"/></svg>',
  user: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.5"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/></svg>',
  walletLg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10h18"/><path d="M15.5 14.5h2.5"/></svg>',
  docLg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3.5h7l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 19V5A1.5 1.5 0 0 1 7 3.5Z"/><path d="M14 3.5V8h4"/><path d="M9 12h6M9 15.5h6"/></svg>',
  clock: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12.5" r="8"/><path d="M12 8.5v4l3 2"/></svg>',
  copy: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15 8.5V6A1.5 1.5 0 0 0 13.5 4.5H6A1.5 1.5 0 0 0 4.5 6v7.5A1.5 1.5 0 0 0 6 15h2.5"/></svg>',
  share: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="6" r="2.3"/><circle cx="6" cy="12" r="2.3"/><circle cx="18" cy="18" r="2.3"/><path d="M8.1 10.8 15.9 7.2M8.1 13.2l7.8 3.6"/></svg>',
  shield: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v6c0 4.6-3 7.6-7 9-4-1.4-7-4.4-7-9V6l7-3Z"/><path d="M9 12l2 2 4-4"/></svg>',
  doc: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3.5h7l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 19V5A1.5 1.5 0 0 1 7 3.5Z"/><path d="M14 3.5V8h4"/><path d="M9 12h6M9 15.5h6"/></svg>',
  headset: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M4 13v-1a8 8 0 0 1 16 0v1"/><rect x="3" y="13" width="4.5" height="6" rx="1.5"/><rect x="16.5" y="13" width="4.5" height="6" rx="1.5"/><path d="M20 19v.5A3.5 3.5 0 0 1 16.5 23H13"/></svg>',
  download: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11"/><path d="M8 11.5 12 15.5 16 11.5"/><path d="M5 18.5h14"/></svg>',
  logout: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4.5H6A1.5 1.5 0 0 0 4.5 6v12A1.5 1.5 0 0 0 6 19.5h3"/><path d="M14.5 8.5 19 12l-4.5 3.5"/><path d="M19 12H9.5"/></svg>',
  people2: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0"/><circle cx="17" cy="9" r="2.4"/><path d="M14.8 14a5 5 0 0 1 6.7 4.7"/></svg>',
  link: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M9 15l6-6"/><path d="M8 17.5 5.5 15A4 4 0 0 1 11 9.5"/><path d="M16 6.5 18.5 9A4 4 0 0 1 13 14.5"/></svg>',
  trash: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-9 0 1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12"/></svg>',
  eye: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeOff: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18"/><path d="M10.6 5.2A11.4 11.4 0 0 1 12 5c7 0 11 7 11 7a17.5 17.5 0 0 1-3.1 3.9M6.7 6.7C3.6 8.5 1 12 1 12s4 7 11 7a10.6 10.6 0 0 0 4.3-.9"/><path d="M9.5 9.8A3 3 0 0 0 12 15a3 3 0 0 0 2.2-.97"/></svg>',
};
function snowflakeSvg(color, size){ return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round"><path d="M12 2v20M4.2 6.5l15.6 11M4.2 17.5l15.6-11"/><path d="M12 2l-2 2.3M12 2l2 2.3M12 22l-2-2.3M12 22l2-2.3M4.2 6.5l3 .3M4.2 6.5l1-2.8M19.8 6.5l-3 .3M19.8 6.5l-1-2.8M4.2 17.5l3-.3M4.2 17.5l1 2.8M19.8 17.5l-3-.3M19.8 17.5l-1 2.8"/></svg>`; }
function waveLinesTR(w,h,color,count,opacity){
  color = color || 'var(--snow-wave-on-wine)'; count = count || 4; opacity = opacity == null ? .9 : opacity;
  const paths = ["M-18 -8 C40 0 69 42 96 86 C121 127 151 150 202 155","M0 -21 C55 -4 84 35 109 80 C134 123 162 143 205 147","M20 -34 C70 -8 99 29 123 73 C148 116 174 136 208 140","M40 -47 C85 -14 114 23 138 66 C161 108 186 128 211 132"];
  const svg = paths.slice(0,count).map(d=>`<path d="${d}" stroke="${color}" stroke-width="1.4" fill="none"/>`).join('');
  return `<svg viewBox="0 0 190 180" aria-hidden="true" style="position:absolute;top:-4px;right:-6px;width:${w}px;height:${h}px;opacity:${opacity};">${svg}</svg>`;
}
function softBlob(color,opacity,size,right,bottom){
  return `<div style="position:absolute;right:${right}px;bottom:${bottom}px;width:${size}px;height:${size}px;border-radius:50%;background:${color};opacity:${opacity};pointer-events:none;"></div>`;
}
function brandWaveFull(){
  return `<svg class="brand-wave--full" viewBox="0 0 390 126" preserveAspectRatio="none" aria-hidden="true"><path d="M0 104 C58 68 104 61 154 83 C205 105 251 95 296 62 C332 36 362 23 390 31 L390 126 L0 126 Z" fill="var(--snow-canvas)"></path></svg>`;
}
function copyBubble(){ return `<div style="width:30px;height:30px;border-radius:50%;background:rgba(255,255,255,.18);display:flex;align-items:center;justify-content:center;flex-shrink:0;">${ICONS.copy}</div>`; }

function fmtUGX(n){ return 'UGX ' + Math.round(Number(n)||0).toLocaleString('en-UG'); }
// Matches server.js's nowStr().date exactly (Kampala/EAT, UTC+3) -- used
// client-side only to show "claimed today" state without an extra round
// trip; the server is still the real source of truth on submit.
function eatTodayStr(){
  const d = new Date(Date.now() + 3 * 3600000);
  const pad = n => String(n).padStart(2, '0');
  return pad(d.getUTCMonth() + 1) + '/' + pad(d.getUTCDate()) + '/' + d.getUTCFullYear();
}
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
// Caps how many digits a phone field accepts, based on which format the
// person is actually typing -- a bare "0" local number tops out at 10
// digits ("0769968158"), a "256"/"+256" international number tops out at
// 12 ("256769968158", the + doesn't count as a digit). Nothing was capping
// this before -- someone could type an arbitrarily long garbled string into
// any phone field with no limit at all. Wired to every phone input's own
// oninput, not a static maxlength, since the right cap depends on which
// format the field is currently holding.
function sanitizePhoneInput(el){
  const hadPlus = el.value.charAt(0) === '+';
  let digits = el.value.replace(/\D/g, '');
  const maxDigits = digits.startsWith('0') ? 10 : 12;
  if (digits.length > maxDigits) digits = digits.slice(0, maxDigits);
  el.value = (hadPlus ? '+' : '') + digits;
}
function $(id){ return document.getElementById(id); }
function togglePw(id, btn){
  const el = $(id);
  const showing = el.type === 'password';
  el.type = showing ? 'text' : 'password';
  if (btn) {
    btn.innerHTML = showing ? ICONS.eyeOff : ICONS.eye;
    btn.setAttribute('aria-label', showing ? 'Hide password' : 'Show password');
  }
}

// ── STATE ──
var STATE = { user: null, account: null, settings: null, products: null, investments: null,
  teamStats: null, teamMembers: {1:null,2:null,3:null}, bankAccounts: null, transactions: null, refCode: null, page: 'home', mission: null,
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

function toast(msg, isErr){
  const el = document.createElement('div');
  el.className = 'toast' + (isErr ? ' err' : '');
  el.textContent = msg;
  $('toastHost').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

// ── API ──
// Endpoints that actually move money -- a background service-worker reload
// (see the registration script near the bottom of this file) waits for this
// count to hit 0 before ever yanking the page out from under one of these.
var MONEY_ENDPOINTS = new Set(['/deposit/marzpay', '/withdraw/request', '/invest/create', '/bank/save', '/bank/delete', '/checkin', '/redeem']);
window._moneyCallsInFlight = 0;
async function api(path, opts){
  opts = opts || {};
  const isMoneyCall = MONEY_ENDPOINTS.has(path);
  if (isMoneyCall) window._moneyCallsInFlight++;
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
  const startEpoch = STATE.authEpoch;
  try {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    if (window.fbAuth && window.fbAuth.currentUser) {
      try { headers['Authorization'] = 'Bearer ' + (await window.fbAuth.currentUser.getIdToken()); } catch (_) {}
    }
    let resp;
    try {
      resp = await fetch(API_BASE + path, Object.assign({}, opts, { headers }));
    } catch (e) {
      return { status: 'error', message: 'Network error. Check your connection.' };
    }
    let data;
    try { data = await resp.json(); } catch (_) { data = { status: 'error', message: 'Unexpected response from server' }; }
    if (!isPublicCall && STATE.authEpoch !== startEpoch) return { status: 'error', message: 'Session changed', stale: true };
    return data;
  } finally {
    if (isMoneyCall) window._moneyCallsInFlight--;
  }
}
function post(path, body){ return api(path, { method: 'POST', body: JSON.stringify(body || {}) }); }

// ── AUTH ──
function phoneToEmail(phone){ return String(phone).replace(/\D/g,'').replace(/^0+/, '') + '@snow-platform.com'; }
function cleanPhone(raw){
  const s = String(raw||'').replace(/\D/g,'');
  let local9 = null;
  if (s.startsWith('256') && s.length === 12) local9 = s.slice(3);
  else if (s.startsWith('0') && s.length === 10) local9 = s.slice(1);
  else if (s.length === 9) local9 = s;
  if (!local9 || !/^7\d{8}$/.test(local9)) return null;
  return '+256' + local9;
}
function showAuthTab(tab){
  $('loginPane').style.display = tab === 'login' ? '' : 'none';
  $('registerPane').style.display = tab === 'register' ? '' : 'none';
  $('loginError').innerHTML = ''; $('regError').innerHTML = '';
}
function setBtnLoading(id, loading, label){
  const btn = $(id);
  btn.disabled = loading;
  btn.textContent = loading ? 'Please wait…' : label;
}
function fbErrMsg(e){
  const code = e && e.code || '';
  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password') return 'Incorrect phone number or password.';
  if (code === 'auth/user-not-found') return 'No account found for that number.';
  if (code === 'auth/email-already-in-use') return 'An account with that number already exists.';
  if (code === 'auth/weak-password') return 'Password must be at least 6 characters.';
  if (code === 'auth/too-many-requests') return 'Too many attempts. Try again shortly.';
  return e && e.message ? e.message : 'Something went wrong. Try again.';
}
window.doLogin = async function(){
  const phone = cleanPhone($('loginPhone').value);
  const pass = $('loginPassword').value;
  if (!phone) return $('loginError').innerHTML = '<div class="auth-error">Enter a valid Uganda mobile number.</div>';
  if (!pass) return $('loginError').innerHTML = '<div class="auth-error">Enter your password.</div>';
  $('loginError').innerHTML = '';
  setBtnLoading('loginBtn', true);
  try { await window.fbSignIn(phoneToEmail(phone), pass); }
  catch (e) { $('loginError').innerHTML = `<div class="auth-error">${esc(fbErrMsg(e))}</div>`; setBtnLoading('loginBtn', false, 'Login'); }
};
window.doRegister = async function(){
  const phone = cleanPhone($('regPhone').value);
  const pass = $('regPassword').value;
  const pin = $('regPin').value.trim();
  if (!phone) return $('regError').innerHTML = '<div class="auth-error">Enter a valid Uganda mobile number.</div>';
  if (!pass || pass.length < 6) return $('regError').innerHTML = '<div class="auth-error">Password must be at least 6 characters.</div>';
  if (!/^\d{5}$/.test(pin)) return $('regError').innerHTML = '<div class="auth-error">Transaction PIN must be exactly 5 digits.</div>';
  $('regError').innerHTML = '';
  setBtnLoading('regBtn', true);
  window._pendingRegPin = pin;
  window._pendingRegPhone = phone;
  try { await window.fbCreateUser(phoneToEmail(phone), pass); }
  catch (e) { $('regError').innerHTML = `<div class="auth-error">${esc(fbErrMsg(e))}</div>`; setBtnLoading('regBtn', false, 'Register'); }
};
window.doLogout = async function(){
  stopLiveRefresh();
  STATE.authEpoch++;
  Object.assign(STATE, { account: null, investments: null, teamStats: null, teamMembers: {1:null,2:null,3:null}, bankAccounts: null, transactions: null, mission: null });
  await window.fbSignOut();
};

// ── BOOT ──
async function boot(){
  const [s, p] = await Promise.all([ api('/public/settings'), api('/public/products') ]);
  STATE.settings = s.status === 'success' ? s.settings : {};
  STATE.products = p.status === 'success' ? p.products : [];
}
function captureReferralFromUrl(){
  try {
    const params = new URLSearchParams(location.search);
    const ref = params.get('ref');
    if (ref) STATE.refCode = ref;
  } catch (_) {}
}

// ── AUTH STATE HANDLER ──
window.addEventListener('snow-auth', async (ev) => {
  const user = ev.detail;
  // Also bump here (not just doLogout()) -- this is what actually fires when
  // a DIFFERENT user logs in right after, and it's the guard that matters if
  // Firebase's own token expiry/refresh ever drops us out without doLogout()
  // having run first.
  STATE.authEpoch++;
  STATE.user = user;
  if (!user) {
    $('loadingScreen').style.display = 'none';
    $('app').style.display = 'none';
    $('authScreen').style.display = '';
    setBtnLoading('loginBtn', false, 'Login');
    setBtnLoading('regBtn', false, 'Register');
    return;
  }
  $('authScreen').style.display = 'none';
  $('loadingScreen').style.display = 'flex';
  await enterApp();
});
async function enterApp(){
  let r = await api('/account');
  if (r.status === 'error' && (r.code === 'NOT_FOUND' || r.message === 'User not found')) {
    // Ghost account (Firebase user exists, our profile never finished) or a
    // fresh registration still finishing -- retry /register, which
    // self-heals a missing profile doc and is a safe no-op if already done.
    const reg = await post('/register', {
      referralCode: STATE.refCode || '',
      pin: window._pendingRegPin || '',
      phone: window._pendingRegPhone || '',
    });
    if (reg.status !== 'success' && reg.status !== 'already_done') {
      $('loadingScreen').style.display = 'none';
      toast(reg.message || 'Could not complete registration', true);
      await window.fbSignOut();
      return;
    }
    r = await api('/account');
  }
  if (r.status === 'error') {
    $('loadingScreen').style.display = 'none';
    if (r.code === 'BANNED') { toast(r.message, true); await window.fbSignOut(); return; }
    toast(r.message || 'Could not load your account', true);
    await window.fbSignOut();
    return;
  }
  STATE.account = r.account;
  // Prefetch everything every tab needs, all in parallel, before the loading
  // screen ever comes down -- so the very first tab switch (and opening
  // Withdraw/Withdrawal Accounts/Records) is already cache-first-instant
  // instead of only becoming fast after a first visit to each one. This adds
  // no real time over the account fetch alone since it's parallel, not
  // sequential -- one network round trip's worth of latency, not four.
  const [invR, teamR, bankR, txR] = await Promise.all([
    api('/investments'), api('/team/stats'), api('/bank/list'), api('/transactions')
  ]);
  if (invR.status === 'success') STATE.investments = invR.investments;
  if (teamR.status === 'success') STATE.teamStats = teamR;
  if (bankR.status === 'success') STATE.bankAccounts = bankR.accounts;
  if (txR.status === 'success') STATE.transactions = txR.transactions;
  $('loadingScreen').style.display = 'none';
  $('app').style.display = '';
  showPage(STATE.page || 'home');
}

// ── NAV ──
function updateNavIcons(){
  document.querySelectorAll('.navitem').forEach(btn => {
    const key = btn.dataset.nav;
    const active = key === STATE.page;
    const iconKey = key === 'products' ? 'box' : (key === 'account' ? 'user' : key);
    const icon = ICONS[iconKey];
    btn.querySelector('.nav-ic').innerHTML = active
      ? `<div style="width:40px;height:40px;border-radius:14px;background:var(--snow-wine-soft);display:flex;align-items:center;justify-content:center;">${icon}</div>`
      : icon;
    btn.classList.toggle('active', active);
  });
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
var _liveRefreshTimer = null;
function stopLiveRefresh(){ clearInterval(_liveRefreshTimer); _liveRefreshTimer = null; }
function startLiveRefresh(){
  stopLiveRefresh();
  _liveRefreshTimer = setInterval(async () => {
    if (STATE.page === 'home') {
      const r = await api('/account');
      if (r.status === 'success' && STATE.page === 'home') { STATE.account = r.account; patchHomeBalances(); }
    } else if (STATE.page === 'team') {
      const r = await api('/team/stats');
      if (r.status === 'success' && STATE.page === 'team') { STATE.teamStats = r; patchTeamStats(); }
    }
  }, 8000);
}
window.showPage = async function(name){
  STATE.page = name;
  updateNavIcons();
  if (_countdownTimer) { clearInterval(_countdownTimer); _countdownTimer = null; }
  stopActivityTicker();
  if (name === 'home') await renderHome();
  else if (name === 'products') await renderProducts();
  else if (name === 'team') await renderTeam();
  else if (name === 'account') await renderAccount();
  startLiveRefresh();
};

// ── HOME ──
// Cache-first: a page revisit paints instantly from whatever STATE already
// holds (no network wait, no loading affordance needed), then a background
// fetch quietly brings it up to date. `patchHomeBalances()` updates just the
// 3 money figures in place afterward (and on a standing timer via
// startLiveRefresh()) without rebuilding the page -- rebuilding would tear
// down and restart the ticker/chest-swing animations every few seconds.
async function renderHome(){
  const hadCache = !!STATE.account;
  if (hadCache) paintHome();
  const [accR, invR] = await Promise.all([ api('/account'), api('/investments') ]);
  if (accR.status === 'success') STATE.account = accR.account;
  if (STATE.page !== 'home') return; // navigated away while awaiting
  if (hadCache) patchHomeBalances(); else paintHome();
}
function paintHome(){
  const a = STATE.account || {};
  const products = STATE.products || [];
  let html = `
<div class="brand-hero--full">
  ${waveLinesTR(140,133)}
  <button aria-label="Open gift code" onclick="openChestModal()" class="chest-hang" style="position:absolute;top:-6px;right:20px;z-index:2;width:64px;height:60px;border:none;background:none;padding:0;cursor:pointer;filter:drop-shadow(0 8px 12px rgba(0,0,0,.4));">
    <img src="/treasure-chest.png" alt="" style="width:100%;height:100%;object-fit:contain;display:block;">
  </button>
  <div style="position:relative;padding:22px 20px 0;">
    <div style="display:flex;align-items:center;gap:9px;">
      ${snowflakeSvg('var(--snow-green)',26)}
      <img src="/badge.png" alt="" style="height:38px;width:auto;">
      <div class="wm-text" style="font-size:19px;color:#fff;">SNOW</div>
    </div>
    <div style="margin-top:26px;">
      <div style="font-size:12.5px;opacity:.82;">Wallet Balance</div>
      <div id="homeWallet" class="mono" style="font-size:32px;font-weight:800;margin-top:4px;">${fmtUGX(a.walletBalance)}</div>
      <div style="display:flex;gap:10px;margin-top:16px;">
        <div style="flex:1;background:rgba(255,255,255,.14);border-radius:16px;padding:10px 12px;">
          <div style="font-size:11px;opacity:.8;">Total Earned</div>
          <div id="homeTotalEarned" class="mono" style="font-size:14.5px;font-weight:700;margin-top:2px;">${fmtUGX(a.totalEarned)}</div>
        </div>
        <div style="flex:1;background:rgba(255,255,255,.14);border-radius:16px;padding:10px 12px;">
          <div style="font-size:11px;opacity:.8;">Total Invested</div>
          <div id="homeTotalInvested" class="mono" style="font-size:14.5px;font-weight:700;margin-top:2px;">${fmtUGX(a.totalInvested)}</div>
        </div>
      </div>
    </div>
  </div>
  ${brandWaveFull()}
</div>
<div style="display:flex;gap:12px;margin:-6px 20px 0;position:relative;z-index:1;">
  <button class="primary-button" style="flex:1;display:flex;align-items:center;justify-content:center;gap:8px;padding:13px 0;font-size:14.5px;" onclick="openDepositSheet()">${ICONS.deposit}Deposit</button>
  <button class="secondary-button" style="flex:1;display:flex;align-items:center;justify-content:center;gap:8px;padding:13px 0;font-size:14.5px;" onclick="openWithdrawSheet()">${ICONS.withdraw}Withdraw</button>
</div>
<div id="activityTicker" style="margin:14px 20px 0;box-sizing:border-box;display:flex;align-items:center;gap:8px;padding:9px 16px;border-radius:999px;background:rgba(17,17,17,.82);box-shadow:0 6px 16px -8px rgba(0,0,0,.35);overflow:hidden;">
  <span style="width:6px;height:6px;border-radius:50%;background:var(--snow-green);flex-shrink:0;"></span>
  <div style="overflow:hidden;flex:1;min-width:0;">
    <div id="activityTickerTrack" class="mono" style="display:inline-flex;white-space:nowrap;color:#fff;font-size:11.5px;">Loading activity&hellip;</div>
  </div>
</div>
<div class="app-card" style="margin:18px 20px 0;padding:20px 22px;background:var(--snow-green-soft);border-color:transparent;display:flex;align-items:flex-start;justify-content:space-between;gap:10px;" onclick="showPage('team')">
  <div style="min-width:0;">
    <div style="font-size:11px;letter-spacing:.6px;text-transform:uppercase;color:var(--snow-green);font-weight:700;">Referral Program</div>
    <div style="font-size:18px;font-weight:800;margin-top:4px;max-width:250px;line-height:1.25;color:var(--snow-ink);">Earn ${(STATE.settings&&STATE.settings.commL1)||27}% on every referral&rsquo;s first investment</div>
  </div>
  <button style="flex-shrink:0;border:none;cursor:pointer;font-family:inherit;background:var(--snow-wine);color:#fff;border-radius:999px;padding:5px 12px;font-size:10.5px;font-weight:700;" onclick="event.stopPropagation();openCheckinSheet()">Go check in</button>
</div>
<div style="display:flex;align-items:baseline;justify-content:space-between;margin:26px 20px 12px;">
  <div class="section-title">Investment Plans</div>
  <div style="font-size:12.5px;color:var(--snow-muted);">${products.length} plan${products.length===1?'':'s'}</div>
</div>
<div style="display:flex;flex-direction:column;gap:12px;margin:0 20px;">`;
  products.forEach(p => {
    const dailyPayout = Math.round((p.expectedReturn || p.price*30) / (p.cycle || 150));
    html += `
  <div class="product-card">
    <img class="product-card__thumb" src="${esc(p.image||'')}" alt="${esc(p.name)}" onerror="this.style.display='none'">
    <div class="product-card__body">
      <div style="font-size:14.5px;font-weight:700;color:var(--snow-ink);">${esc(p.name)}</div>
      <div class="product-card__stats" style="margin-top:10px;">
        <div><div class="stat-label">Investment</div><div class="stat-val mono">${fmtUGX(p.price)}</div></div>
        <div><div class="stat-label">Daily Cashback</div><div class="stat-val mono" style="color:var(--snow-green);">${fmtUGX(dailyPayout)}</div></div>
        <div><div class="stat-label">Duration</div><div class="stat-val mono">${p.cycle||150} days</div></div>
        <div><div class="stat-label">Total Return</div><div class="stat-val mono">${fmtUGX(p.expectedReturn||p.price*30)}</div></div>
      </div>
      <button class="primary-button product-card__cta" ${p.comingSoon?'disabled':''} onclick="openInvestConfirm('${esc(p.key)}')">${p.comingSoon?'Coming Soon':'Invest'}</button>
    </div>
  </div>`;
  });
  html += `</div><div style="height:16px;"></div>`;
  $('pageHost').innerHTML = '<div class="reveal-in">' + html + '</div>';
  startActivityTicker();
}
function patchHomeBalances(){
  const a = STATE.account || {};
  const w = $('homeWallet'); if (w) w.textContent = fmtUGX(a.walletBalance);
  const e = $('homeTotalEarned'); if (e) e.textContent = fmtUGX(a.totalEarned);
  const i = $('homeTotalInvested'); if (i) i.textContent = fmtUGX(a.totalInvested);
}

// ── MY PRODUCTS ──
async function renderProducts(){
  const hadCache = Array.isArray(STATE.investments);
  if (hadCache) paintProducts(true);
  const r = await api('/investments');
  if (r.status === 'success') STATE.investments = r.investments;
  else if (!hadCache) STATE.investments = [];
  if (STATE.page !== 'products') return; // navigated away while awaiting
  paintProducts(!hadCache);
}
function paintProducts(animate){
  const investments = STATE.investments || [];
  const active = investments.filter(i => i.status === 'active' || i.status === 'matured');
  const totalInvested = active.reduce((s,i)=>s+(i.amount||0),0);
  const totalEarned = active.reduce((s,i)=>s+(i.paidOut||0),0);
  let html = `
<div class="top-bar" style="display:flex;align-items:center;justify-content:space-between;padding:24px 20px 4px;">
  <div class="wordmark">${snowflakeSvg('var(--snow-ink)',15)}<div class="wm-text" style="font-size:17px;">SNOW</div></div>
</div>
<div style="margin:16px 20px 0;">
  <div style="font-size:22px;font-weight:800;color:var(--snow-ink);">My Products</div>
  <div style="font-size:13px;color:var(--snow-muted);margin-top:3px;">${active.length} active plan${active.length===1?'':'s'} &middot; ${fmtUGX(totalEarned)} earned so far</div>
</div>
<div style="display:flex;gap:10px;margin:16px 20px 0;">
  <div class="stat-tile" style="flex:1;"><div style="font-size:10.5px;color:var(--snow-muted);">Active Plans</div><div class="mono" style="font-size:16px;font-weight:800;margin-top:3px;">${active.length}</div></div>
  <div class="stat-tile" style="flex:1;"><div style="font-size:10.5px;color:var(--snow-muted);">Total Invested</div><div class="mono" style="font-size:16px;font-weight:800;margin-top:3px;">${fmtUGX(totalInvested)}</div></div>
  <div class="stat-tile" style="flex:1;"><div style="font-size:10.5px;color:var(--snow-muted);">Total Earned</div><div class="mono" style="font-size:16px;font-weight:800;margin-top:3px;color:var(--snow-green);">${fmtUGX(totalEarned)}</div></div>
</div>
<div class="section-title" style="margin:26px 20px 12px;">Active Plans</div>
<div style="display:flex;flex-direction:column;gap:14px;margin:0 20px;">`;
  if (!investments.length) {
    html += `<div class="list-empty">No products yet — browse plans on Home to get started.</div>`;
  } else {
    investments.forEach(inv => {
      const p = (STATE.products||[]).find(x=>x.key===inv.tierKey) || {};
      const createdMs = new Date(inv.createdAt||Date.now()).getTime();
      const pct = Math.round((inv.payoutsMade||0)/(inv.payoutsTotal||150)*100);
      const matured = inv.status === 'matured' || (inv.payoutsMade||0) >= (inv.payoutsTotal||150);
      html += `
  <div class="plan-card">
    <div style="display:flex;align-items:center;gap:12px;">
      <img class="product-card__thumb" style="width:40px;height:40px;border-radius:12px;" src="${esc(p.image||'')}" alt="" onerror="this.style.display='none'">
      <div style="flex:1;min-width:0;">
        <div style="font-size:14.5px;font-weight:700;color:var(--snow-ink);">${esc(inv.tierLabel)}</div>
        <div style="font-size:12px;color:var(--snow-muted);margin-top:1px;">${fmtUGX(inv.amount)} invested &middot; ${fmtUGX(inv.dailyPayout)}/day</div>
      </div>
      <div class="status-pill ${matured?'active':'pending'}">${matured?'Matured':'Active'}</div>
    </div>
    <div style="margin-top:16px;">
      <div style="display:flex;justify-content:space-between;font-size:11.5px;color:var(--snow-muted);margin-bottom:6px;">
        <span>Day ${Math.min(inv.payoutsMade||0, inv.payoutsTotal||150)} of ${inv.payoutsTotal||150}</span>
        <span class="mono" style="color:var(--snow-green);font-weight:600;">+${fmtUGX(inv.paidOut)} earned</span>
      </div>
      <div style="height:8px;border-radius:999px;background:var(--snow-neutral-soft);overflow:hidden;"><div style="height:100%;border-radius:999px;background:var(--snow-green);width:${pct}%;"></div></div>
    </div>
    ${matured ? '' : `<div style="display:flex;align-items:center;gap:6px;margin-top:14px;color:var(--snow-muted);font-size:12px;" data-countdown data-created="${createdMs}" data-payouts-made="${inv.payoutsMade||0}">${ICONS.clock} Next cashback in <span class="mono countdown-val" style="color:var(--snow-ink);font-weight:600;">--:--:--</span></div>`}
  </div>`;
    });
  }
  html += `</div><div style="height:16px;"></div>`;
  $('pageHost').innerHTML = animate ? '<div class="reveal-in">' + html + '</div>' : html;
  startPlanCountdowns();
}
// Live-ticking "Next cashback in HH:MM:SS" on each active plan card. Cleared
// whenever the page changes away from My Products so it never keeps ticking
// (and leaking a timer) in the background.
var _countdownTimer = null;
function startPlanCountdowns(){
  if (_countdownTimer) clearInterval(_countdownTimer);
  const tick = () => {
    const nodes = document.querySelectorAll('[data-countdown]');
    if (!nodes.length) { clearInterval(_countdownTimer); _countdownTimer = null; return; }
    nodes.forEach(el => {
      const created = Number(el.dataset.created);
      const made = Number(el.dataset.payoutsMade);
      const nextBoundary = created + (made + 1) * 86400000;
      const remaining = Math.max(0, nextBoundary - Date.now());
      const h = Math.floor(remaining / 3600000);
      const m = Math.floor((remaining % 3600000) / 60000);
      const s = Math.floor((remaining % 60000) / 1000);
      const pad = n => String(n).padStart(2, '0');
      el.querySelector('.countdown-val').textContent = `${pad(h)}:${pad(m)}:${pad(s)}`;
    });
  };
  tick();
  _countdownTimer = setInterval(tick, 1000);
}

// Floating "recent activity" strip on Home -- simulated, not real
// transactions (see server.js's /public/activity-feed, which says the same
// thing). Continuously flows/scrolls like a real ticker tape via a pure CSS
// animation (translateX 0 -> -50% over a track holding two back-to-back
// copies of the same joined text, looping seamlessly) rather than swapping
// between discrete messages. Refreshed with new feed data periodically;
// stopped on every page change the same way _countdownTimer is, so it never
// keeps refreshing into a detached DOM node in the background.
var _activityRefreshTimer = null;
function activityRowText(row){
  const verb = row.kind === 'deposit' ? 'just deposited' : 'just withdrew';
  return row.phone + ' ' + verb + ' ' + fmtUGX(row.amount);
}
async function renderActivityTicker(){
  const track = $('activityTickerTrack');
  if (!track) return;
  const r = await api('/public/activity-feed');
  if (STATE.page !== 'home' || !$('activityTickerTrack')) return; // navigated away while awaiting
  const rows = (r.status === 'success' && Array.isArray(r.feed)) ? r.feed : [];
  if (!rows.length) return;
  const joined = rows.map(row => esc(activityRowText(row))).join('&nbsp;&nbsp;&nbsp;&middot;&nbsp;&nbsp;&nbsp;');
  track.style.animation = 'none';
  track.innerHTML = `<span style="padding-right:48px;">${joined}</span><span style="padding-right:48px;" aria-hidden="true">${joined}</span>`;
  const singleWidth = track.scrollWidth / 2;
  const duration = Math.max(4, singleWidth / 160); // ~160px/sec, floor so a short feed doesn't whip past
  track.style.animation = `tickerFlow ${duration}s linear infinite`;
}
function stopActivityTicker(){
  clearInterval(_activityRefreshTimer); _activityRefreshTimer = null;
  const track = $('activityTickerTrack');
  if (track) track.style.animation = 'none';
}
function startActivityTicker(){
  stopActivityTicker(); // idempotent -- a stray extra call must never leak a second interval
  renderActivityTicker();
  _activityRefreshTimer = setInterval(renderActivityTicker, 20000);
}

// ── TEAM ──
window.switchTeamLevel = async function(level){
  document.querySelectorAll('.team-level-switcher .seg').forEach(s => s.classList.toggle('active', Number(s.dataset.level)===level));
  if (!STATE.teamMembers[level]) {
    const r = await api('/team/members?level=' + level);
    STATE.teamMembers[level] = r.status === 'success' ? r.members : [];
  }
  renderTeamMembers(level);
};
function maskPhone(phone){
  const s = String(phone||'').replace(/\D/g,'');
  if (s.length < 6) return phone || '';
  return '+' + s.slice(0,6) + ' *** ' + s.slice(-3);
}
function timeAgo(ts){
  if (!ts) return '';
  const ms = typeof ts === 'object' && ts.seconds ? ts.seconds*1000 : new Date(ts).getTime();
  if (!ms) return '';
  const days = Math.floor((Date.now()-ms)/86400000);
  if (days <= 0) return 'Joined today';
  if (days === 1) return 'Joined 1 day ago';
  if (days < 14) return `Joined ${days} days ago`;
  const weeks = Math.floor(days/7);
  return `Joined ${weeks} week${weeks===1?'':'s'} ago`;
}
function renderTeamMembers(level){
  const members = STATE.teamMembers[level] || [];
  $('teamMembersHeading').textContent = `Level ${level} members`;
  $('teamMembersCount').textContent = `${members.length} member${members.length===1?'':'s'}`;
  const box = $('teamMembersBox');
  if (!members.length) { box.innerHTML = '<div class="list-empty reveal-in">No members at this level yet.</div>'; return; }
  box.innerHTML = '<div class="reveal-in">' + members.map((m,idx) => `
  <div class="list-row">
    <div class="mono" style="width:24px;flex-shrink:0;text-align:center;font-size:14px;font-weight:700;color:var(--snow-muted);">${idx+1}</div>
    <div style="flex:1;min-width:0;">
      <div class="mono" style="font-size:13.5px;font-weight:600;color:var(--snow-ink);">${esc(maskPhone(m.phone))}</div>
      <div style="font-size:11px;color:var(--snow-muted);margin-top:1px;">${timeAgo(m.createdAt)}</div>
    </div>
    <div class="status-pill ${m.invested>0?'active':'pending'} mono">${m.invested>0?fmtUGX(m.invested):'UGX 0'}</div>
  </div>`).join('') + '</div>';
}
async function renderTeam(){
  const hadCache = !!STATE.teamStats;
  if (hadCache) paintTeam();
  const r = await api('/team/stats');
  if (r.status === 'success') STATE.teamStats = r;
  else if (!hadCache) STATE.teamStats = { referralCode:'', commRates:{l1:27,l2:2,l3:1}, team:{l1:0,l2:0,l3:0}, totalTeam:0, teamCommission:0, teamDeposits:0 };
  if (STATE.page !== 'team') return; // navigated away while awaiting
  if (hadCache) patchTeamStats(); else paintTeam();
}
function patchTeamStats(){
  const t = STATE.teamStats || {};
  const tt = $('teamTotalCount'); if (tt) tt.textContent = t.totalTeam;
  const tc = $('teamCommissionAmt'); if (tc) tc.textContent = fmtUGX(t.teamCommission);
  const td = $('teamDepositsAmt'); if (td) td.textContent = fmtUGX(t.teamDeposits);
}
function paintTeam(){
  const t = STATE.teamStats || { referralCode:'', commRates:{l1:27,l2:2,l3:1}, team:{l1:0,l2:0,l3:0}, totalTeam:0, teamCommission:0, teamDeposits:0 };
  const link = t.referralCode ? (location.origin + '/?ref=' + t.referralCode) : '';
  let html = `
<div style="display:flex;align-items:center;justify-content:center;gap:9px;padding:24px 20px 4px;">
  ${snowflakeSvg('var(--snow-green)',26)}
  <img src="/badge.png" alt="" style="height:38px;width:auto;">
  <div class="wm-text" style="font-size:19px;color:var(--snow-green);">SNOW</div>
</div>
<div style="margin:16px 20px 0;">
  <div style="font-size:22px;font-weight:800;color:var(--snow-ink);">Team</div>
  <div style="font-size:13px;color:var(--snow-muted);margin-top:3px;">Invite friends and grow your rewards</div>
</div>
<div class="team-referral-card" style="margin:16px 20px 0;">
  ${waveLinesTR(120,114)}
  ${softBlob('var(--snow-wine-deep)',.4,110,-28,-28)}
  <div style="position:relative;">
    <div style="font-size:11px;letter-spacing:.6px;text-transform:uppercase;opacity:.8;font-weight:700;">Your Referral Code</div>
    <div style="display:flex;align-items:center;gap:10px;margin-top:4px;">
      <div class="mono" style="font-size:30px;font-weight:800;letter-spacing:1px;">${esc(t.referralCode||'—')}</div>
      <button style="border:none;background:none;padding:0;" onclick="copyText('${esc(t.referralCode||'')}')">${copyBubble()}</button>
    </div>
    <div style="font-size:11px;letter-spacing:.6px;text-transform:uppercase;opacity:.8;font-weight:700;margin-top:18px;">Your Invite Link</div>
    <div style="display:flex;align-items:center;gap:8px;margin-top:8px;background:rgba(255,255,255,.16);border-radius:14px;padding:9px 12px;">
      <div style="opacity:.85;flex-shrink:0;">${ICONS.link}</div>
      <div class="mono" style="flex:1;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(link)}</div>
      <button style="border:none;background:none;padding:0;color:#fff;" onclick="copyText('${esc(link)}')">${ICONS.copy}</button>
    </div>
    <button style="width:100%;margin-top:14px;display:flex;align-items:center;justify-content:center;gap:8px;background:#fff;color:var(--snow-wine);border:none;border-radius:var(--snow-radius-control);padding:13px 0;font-size:13.5px;font-weight:700;" onclick="shareReferral('${esc(link)}')">${ICONS.share} Share referral link</button>
  </div>
</div>
<div class="app-card" style="margin:16px 20px 0;padding:0;display:flex;overflow:hidden;">
  <div style="flex:1;text-align:center;padding:16px 8px;background:var(--snow-wine-soft);"><div class="icon-tile" style="width:32px;height:32px;margin:0 auto 8px;background:rgba(148,24,39,.12);color:var(--snow-wine);">${ICONS.people2}</div><div style="font-size:10.5px;color:var(--snow-muted);">Level 1</div><div class="mono" style="font-size:16px;font-weight:800;margin-top:2px;color:var(--snow-wine);">${t.commRates.l1}%</div></div>
  <div style="flex:1;text-align:center;padding:16px 8px;background:var(--snow-green-soft);"><div class="icon-tile" style="width:32px;height:32px;margin:0 auto 8px;background:rgba(47,107,71,.12);color:var(--snow-green);">${ICONS.people2}</div><div style="font-size:10.5px;color:var(--snow-muted);">Level 2</div><div class="mono" style="font-size:16px;font-weight:800;margin-top:2px;color:var(--snow-green);">${t.commRates.l2}%</div></div>
  <div style="flex:1;text-align:center;padding:16px 8px;background:var(--snow-wine-soft);"><div class="icon-tile" style="width:32px;height:32px;margin:0 auto 8px;background:rgba(148,24,39,.12);color:var(--snow-wine);">${ICONS.people2}</div><div style="font-size:10.5px;color:var(--snow-muted);">Level 3</div><div class="mono" style="font-size:16px;font-weight:800;margin-top:2px;color:var(--snow-wine);">${t.commRates.l3}%</div></div>
</div>
<button class="brand-card" style="margin:14px 20px 0;padding:18px 20px;width:calc(100% - 40px);display:flex;align-items:center;justify-content:space-between;gap:12px;border:none;cursor:pointer;text-align:left;" onclick="openMissionCenterSheet()">
  ${waveLinesTR(90,84,'rgba(255,255,255,.55)',2,.7)}
  <div style="position:relative;display:flex;align-items:center;gap:12px;">
    <div class="account-icon-bubble" style="width:46px;height:46px;background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.3);">${ICONS.people2}</div>
    <div><div style="font-size:14.5px;font-weight:800;">Mission Center</div><div style="font-size:11.5px;opacity:.85;margin-top:2px;">Daily salary &amp; team deposit rewards</div></div>
  </div>
  <div style="position:relative;">${ICONS.chev}</div>
</button>
<div class="team-summary-grid" style="margin:14px 20px 0;">
  <div class="stat-tile" style="background:var(--snow-wine-soft);border-color:transparent;display:flex;align-items:center;gap:12px;"><div class="icon-tile" style="width:38px;height:38px;background:rgba(148,24,39,.12);color:var(--snow-wine);">${ICONS.people2}</div><div><div style="font-size:10.5px;color:var(--snow-muted);">Total team</div><div id="teamTotalCount" class="mono" style="font-size:18px;font-weight:800;color:var(--snow-wine);">${t.totalTeam}</div></div></div>
  <div class="stat-tile" style="background:var(--snow-green-soft);border-color:transparent;display:flex;align-items:center;gap:12px;"><div class="icon-tile" style="width:38px;height:38px;background:rgba(47,107,71,.12);color:var(--snow-green);">${ICONS.user}</div><div><div style="font-size:10.5px;color:var(--snow-muted);">Team commission</div><div id="teamCommissionAmt" class="mono" style="font-size:18px;font-weight:800;color:var(--snow-green);">${fmtUGX(t.teamCommission)}</div></div></div>
  <div class="team-deposits-card">
    ${waveLinesTR(90,84,'rgba(255,255,255,.55)',2,.7)}
    <div style="position:relative;display:flex;align-items:center;gap:12px;"><div class="account-icon-bubble" style="width:46px;height:46px;background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.3);">${ICONS.walletLg}</div><div><div style="font-size:11px;opacity:.85;">Team deposits</div><div id="teamDepositsAmt" class="mono" style="font-size:20px;font-weight:800;margin-top:2px;">${fmtUGX(t.teamDeposits)}</div></div></div>
  </div>
</div>
<div class="team-level-switcher" style="margin:22px 20px 0;">
  <div class="seg active" data-level="1" onclick="switchTeamLevel(1)">Level 1</div>
  <div class="seg" data-level="2" onclick="switchTeamLevel(2)">Level 2</div>
  <div class="seg" data-level="3" onclick="switchTeamLevel(3)">Level 3</div>
</div>
<div class="app-card" style="margin:14px 20px 0;padding:6px 18px;">
  <div style="display:flex;align-items:baseline;justify-content:space-between;padding:14px 0 4px;">
    <div id="teamMembersHeading" style="font-size:15px;font-weight:800;color:var(--snow-ink);">Level 1 members</div>
    <div id="teamMembersCount" style="font-size:12px;color:var(--snow-muted);"></div>
  </div>
  <div id="teamMembersBox"></div>
</div>
<div style="height:16px;"></div>`;
  $('pageHost').innerHTML = '<div class="reveal-in">' + html + '</div>';
  STATE.teamMembers = {1:null,2:null,3:null};
  switchTeamLevel(1);
}
window.openMissionCenterSheet = async function(){
  openSheet('Mission Center', '');
  const r = await api('/mission/status');
  if (r.status !== 'success') { $('sheetBody').innerHTML = '<div class="list-empty reveal-in">Could not load Mission Center right now.</div>'; return; }
  STATE.mission = r;
  renderMissionCenter();
};
function renderMissionCenter(){
  const m = STATE.mission;
  if (!m) return;
  const salaryBtn = m.salaryClaimedToday
    ? `<button class="primary-button" style="width:100%;padding:14px 0;font-size:14px;margin-top:14px;opacity:.55;" disabled>Claimed today — resets at midnight</button>`
    : !m.l1ActiveCount
      ? `<button class="primary-button" style="width:100%;padding:14px 0;font-size:14px;margin-top:14px;opacity:.55;" disabled>Need at least 1 active referral</button>`
      : `<button class="primary-button" id="missionSalaryBtn" style="width:100%;padding:14px 0;font-size:14px;margin-top:14px;" onclick="claimMissionSalary()">Claim ${fmtUGX(m.salaryAmount)}</button>`;
  const depositRows = m.depositRewards.map(d => `
    <div class="list-row">
      <div style="flex:1;min-width:0;">
        <div style="font-size:13.5px;font-weight:600;">${fmtUGX(d.target)} team deposits</div>
        <div style="font-size:11px;color:var(--snow-muted);margin-top:1px;">Reward ${fmtUGX(d.reward)}</div>
      </div>
      ${d.claimed
        ? `<div class="status-pill active mono">Claimed</div>`
        : d.achieved
          ? `<button class="primary-button" id="missionDepositBtn_${d.target}" style="padding:8px 16px;font-size:12.5px;" onclick="claimMissionDeposit(${d.target})">Claim</button>`
          : `<div class="status-pill pending mono">${fmtUGX(m.teamDeposits)} / ${fmtUGX(d.target)}</div>`}
    </div>`).join('');
  $('sheetBody').innerHTML = `<div class="reveal-in">
    <div class="app-card" style="padding:18px;">
      <div style="font-size:11px;letter-spacing:.6px;text-transform:uppercase;color:var(--snow-muted);font-weight:700;">Daily Referral Salary</div>
      <div style="font-size:13px;color:var(--snow-muted);margin-top:6px;">UGX 200 per active referral, up to 1,000 referrals. Claim once a day — resets at 00:00.</div>
      <div style="display:flex;align-items:baseline;gap:8px;margin-top:14px;">
        <div class="mono" style="font-size:26px;font-weight:800;color:var(--snow-wine);">${fmtUGX(m.salaryAmount)}</div>
        <div style="font-size:12px;color:var(--snow-muted);">${m.l1ActiveCount} active referral${m.l1ActiveCount===1?'':'s'}</div>
      </div>
      ${salaryBtn}
    </div>
    <div class="app-card" style="padding:6px 18px;margin-top:16px;">
      <div style="padding:14px 0 4px;font-size:15px;font-weight:800;color:var(--snow-ink);">Team Deposit Rewards</div>
      <div style="font-size:12px;color:var(--snow-muted);padding-bottom:10px;">One-time reward per threshold — claim manually once your whole team's deposits reach it.</div>
      ${depositRows}
    </div>
    <p style="font-size:11.5px;color:var(--snow-muted);line-height:1.6;margin:14px 2px 0;">Daily salaries are credited once referrals meet the active-account criteria. Team deposit rewards are available to claim instantly once your team's deposits confirm.</p></div>`;
}
// Both claim buttons disable themselves for the duration of the request --
// without this, a fast double/triple-tap (or an impatient tap while the
// first request is still in flight) fired several concurrent requests, each
// with its own toast(), stacking up a pile of identical messages. Matches
// the same disable-during-request pattern every other submit button in this
// app already follows (witSubmitBtn, bankSaveBtn, confirmActionBtn, etc.).
window.claimMissionSalary = async function(){
  const btn = $('missionSalaryBtn');
  if (!btn || btn.disabled) return;
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = 'Claiming…';
  const r = await post('/mission/salary/claim', {});
  if (r.status !== 'success') {
    if (btn) { btn.disabled = false; btn.textContent = label; }
    return toast(r.message || 'Could not claim', true);
  }
  toast(r.message || 'Claimed');
  const s2 = await api('/mission/status');
  if (s2.status === 'success') { STATE.mission = s2; renderMissionCenter(); }
  const acc = await api('/account');
  if (acc.status === 'success') STATE.account = acc.account;
};
window.claimMissionDeposit = async function(target){
  const btn = $('missionDepositBtn_' + target);
  if (!btn || btn.disabled) return;
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = 'Claiming…';
  const r = await post('/mission/deposit/claim', { target });
  if (r.status !== 'success') {
    if (btn) { btn.disabled = false; btn.textContent = label; }
    return toast(r.message || 'Could not claim', true);
  }
  toast(r.message || 'Claimed');
  const s2 = await api('/mission/status');
  if (s2.status === 'success') { STATE.mission = s2; renderMissionCenter(); }
  const acc = await api('/account');
  if (acc.status === 'success') STATE.account = acc.account;
};
window.copyText = function(text){
  if (!text) return;
  navigator.clipboard && navigator.clipboard.writeText(text).then(()=>toast('Copied')).catch(()=>toast('Could not copy', true));
};
window.shareReferral = function(link){
  const text = `Join Snow and start earning — sign up with my link: ${link}`;
  if (navigator.share) navigator.share({ text }).catch(()=>{});
  else copyText(link);
};

// ── ACCOUNT ──
async function renderAccount(){
  const a = STATE.account || {};
  const s = STATE.settings || {};
  let html = `
<div style="display:flex;align-items:center;gap:9px;padding:24px 20px 4px;">
  ${snowflakeSvg('var(--snow-green)',26)}
  <img src="/badge.png" alt="" style="height:38px;width:auto;">
  <div class="wm-text" style="font-size:19px;color:var(--snow-green);">SNOW</div>
</div>
<div class="brand-card" style="margin:16px 20px 0;padding:22px;">
  ${waveLinesTR(110,104)}
  <div style="position:relative;display:flex;align-items:center;gap:12px;">
    <div style="width:56px;height:56px;border-radius:16px;background:rgba(255,255,255,.18);display:flex;align-items:center;justify-content:center;flex-shrink:0;">${snowflakeSvg('#fff',26)}</div>
    <img src="/badge.png" alt="" style="height:104px;width:auto;flex-shrink:0;filter:drop-shadow(0 8px 12px rgba(0,0,0,.28));">
    <div style="flex:1;min-width:0;">
      <div style="display:flex;align-items:center;gap:7px;"><div class="mono" style="font-size:14.5px;font-weight:700;white-space:nowrap;">${esc(a.phone||'')}</div><button style="border:none;background:none;color:#fff;padding:0;" onclick="copyText('${esc(a.phone||'')}')">${ICONS.copy}</button></div>
    </div>
  </div>
</div>
<div class="account-grid" style="margin:18px 20px 0;">
  <button class="account-feature-card" style="background:linear-gradient(145deg,var(--snow-wine) 0%,var(--snow-wine-deep) 100%);padding:20px 16px;" onclick="openWithdrawalAccountsSheet()">
    ${waveLinesTR(95,90,undefined,3,.75)}${softBlob('var(--snow-wine-deep)',.4,100,-26,-26)}
    <div class="account-icon-bubble" style="position:relative;background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.35);color:#fff;margin-bottom:14px;">${ICONS.walletLg}</div>
    <div style="position:relative;font-size:14px;font-weight:800;">Withdrawal account</div>
    <div style="position:relative;font-size:12px;opacity:.85;margin-top:4px;">Manage your payout account</div>
  </button>
  <button class="account-feature-card" style="background:linear-gradient(145deg,var(--snow-green) 0%,var(--snow-green-deep) 100%);padding:20px 16px;" onclick="openRecordsSheet()">
    ${waveLinesTR(95,90,'rgba(255,255,255,.55)',3,.75)}${softBlob('var(--snow-green-deep)',.45,100,-26,-26)}
    <div class="account-icon-bubble" style="position:relative;background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.35);color:#fff;margin-bottom:14px;">${ICONS.docLg}</div>
    <div style="position:relative;font-size:14px;font-weight:800;">Records</div>
    <div style="position:relative;font-size:12px;opacity:.85;margin-top:4px;">Deposits &middot; Withdrawals &middot; Income</div>
  </button>
  <button class="account-utility-card utility-wine" style="background:var(--snow-wine-soft);" onclick="openInfoSheet('about')">${softBlob('var(--snow-wine)',.08,70,-16,-16)}<div class="account-icon-bubble" style="position:relative;">${ICONS.doc}</div><div style="position:relative;font-size:14px;font-weight:700;color:var(--snow-wine-deep);">About Snow</div></button>
  <button class="account-utility-card utility-green" style="background:var(--snow-green-soft);" onclick="openInfoSheet('rules')">${waveLinesTR(56,52,'var(--snow-green)',2,.3)}<div class="account-icon-bubble" style="position:relative;">${ICONS.shield}</div><div style="position:relative;font-size:14px;font-weight:700;color:var(--snow-green-deep);">Rules &amp; Terms</div></button>
  <button class="account-utility-card utility-wine" style="background:var(--snow-wine-soft);" onclick="openInfoSheet('help')">${softBlob('var(--snow-wine)',.12,16,14,74)}<div class="account-icon-bubble" style="position:relative;">${ICONS.headset}</div><div style="position:relative;font-size:14px;font-weight:700;color:var(--snow-wine-deep);">Help Centre</div></button>
  <button class="account-utility-card utility-green" style="background:var(--snow-green-soft);" onclick="promptInstallApp()">${waveLinesTR(56,52,'var(--snow-green)',2,.3)}<div class="account-icon-bubble" style="position:relative;">${ICONS.download}</div><div style="position:relative;font-size:14px;font-weight:700;color:var(--snow-green-deep);">Install Snow</div></button>
</div>
<button class="account-utility-card utility-wine" style="margin:14px 20px 0;width:calc(100% - 40px);background:var(--snow-wine-soft);min-height:88px;border-radius:28px;padding:20px;" onclick="doLogout()">
  ${softBlob('var(--snow-wine)',.1,90,-22,-22)}
  <div class="account-icon-bubble" style="position:relative;">${ICONS.logout}</div>
  <div style="position:relative;font-size:15px;font-weight:700;color:var(--snow-wine-deep);">Sign out</div>
</button>
<div style="height:16px;"></div>`;
  $('pageHost').innerHTML = '<div class="reveal-in">' + html + '</div>';
}

// ── SHEETS ──
function openSheet(title, bodyHtml){
  $('sheetTitle').textContent = title;
  $('sheetBody').innerHTML = bodyHtml;
  $('sheetBg').classList.add('show');
  history.pushState({ sheet: title }, '', '');
  document.body.style.overflow = 'hidden';
}
window.closeSheet = function(){
  $('sheetBg').classList.remove('show');
  document.body.style.overflow = '';
  if (_aboutScrollObserver) { _aboutScrollObserver.disconnect(); _aboutScrollObserver = null; }
  if (history.state && history.state.sheet) history.back();
};
window.addEventListener('popstate', () => {
  $('sheetBg').classList.remove('show');
  document.body.style.overflow = '';
  if (_aboutScrollObserver) { _aboutScrollObserver.disconnect(); _aboutScrollObserver = null; }
});

window.openInfoSheet = function(kind){
  if (kind === 'about') return openAboutSheet();
  if (kind === 'help') return openHelpSheet();
  const s = STATE.settings || {};
  const map = {
    rules: ['Rules & Terms', s.rulesText || 'Minimum deposit ' + fmtUGX(s.minDeposit) + '. Minimum withdrawal ' + fmtUGX(s.minWithdraw) + ', a ' + (s.withdrawFeePct||15) + '% fee applies. Referral commission: Level 1 ' + (s.commL1||27) + '%, Level 2 ' + (s.commL2||2) + '%, Level 3 ' + (s.commL3||1) + '%.'],
  };
  const [title, body] = map[kind] || ['Info', ''];
  openSheet(title, `<p style="white-space:pre-line;line-height:1.6;color:var(--snow-ink);">${esc(body)}</p>`);
};
// Help Centre banner + the two support links are lazy-fetched only when
// this page is actually opened (the banner can be a large embedded image,
// see getHelpBanner()'s own comment server-side), so the sheet paints
// immediately with just the links/text while the image streams in.
window.openHelpSheet = async function(){
  const s = STATE.settings || {};
  const links = (s.telegramGroup ? `<a class="primary-button" style="display:block;text-align:center;text-decoration:none;box-sizing:border-box;" href="${esc(s.telegramGroup)}" target="_blank" rel="noopener">Telegram Group</a>` : '')
    + (s.supportTelegram ? `<a class="primary-button" style="display:block;text-align:center;text-decoration:none;box-sizing:border-box;background:var(--snow-ink);" href="${esc(s.supportTelegram)}" target="_blank" rel="noopener">Customer Service</a>` : '');
  openSheet('Help Centre', `<div class="reveal-in">
    <div id="helpBannerWrap"></div>
    ${links ? `<div style="display:flex;flex-direction:column;gap:10px;margin-top:16px;">${links}</div>` : ''}
    <p style="white-space:pre-line;line-height:1.6;color:var(--snow-muted);margin-top:18px;font-size:13px;">${esc(s.supportHours ? 'Support hours: ' + s.supportHours : 'Contact support for help with your account.')}</p>
  </div>`);
  const r = await api('/public/help-banner');
  const wrap = $('helpBannerWrap');
  if (wrap && r.status === 'success' && r.image) {
    wrap.innerHTML = `<img src="${esc(r.image)}" style="width:100%;display:block;border-radius:0;" alt="">`;
  }
};
// About page: an admin-authored ordered list of text/image blocks (see
// /public/about-content), rendered as an article and revealed block-by-
// block as the member scrolls (owner: "whenever one scrolls down, images
// and words I placed show animation").
let _aboutScrollObserver = null;
window.openAboutSheet = async function(){
  const s = STATE.settings || {};
  openSheet('About Snow', `<div id="aboutArticle" class="reveal-in"><p style="color:var(--snow-muted);">Loading…</p></div>`);
  const r = await api('/public/about-content');
  const wrap = $('aboutArticle');
  if (!wrap) return; // sheet was closed again before this resolved
  const blocks = (r.status === 'success' && Array.isArray(r.blocks) && r.blocks.length) ? r.blocks
    : [{ type: 'text', text: s.aboutText || 'Snow lets you invest in a range of plans with daily cashback and a 3-level referral program.' }];
  wrap.innerHTML = blocks.map(b => b.type === 'image'
    ? `<div class="scroll-reveal about-block"><img src="${esc(b.image)}" style="width:100%;display:block;border-radius:0;" alt=""></div>`
    : `<div class="scroll-reveal about-block"><p style="white-space:pre-line;line-height:1.7;color:var(--snow-ink);">${esc(b.text)}</p></div>`
  ).join('');
  if (_aboutScrollObserver) _aboutScrollObserver.disconnect();
  _aboutScrollObserver = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('in-view'); _aboutScrollObserver.unobserve(e.target); }
    });
  }, { threshold: 0.15, rootMargin: '0px 0px -8% 0px' });
  wrap.querySelectorAll('.scroll-reveal').forEach(el => _aboutScrollObserver.observe(el));
};

window.openCheckinSheet = function(){
  const a = STATE.account || {};
  const bonus = Number(STATE.settings && STATE.settings.dailyCheckin) || 0;
  const streak = Number(a.checkinStreak) || 0;
  const claimedToday = a.lastCheckin === eatTodayStr();
  openSheet('Daily Check-in', `
    <div class="app-card" style="padding:24px 20px;text-align:center;">
      <div style="font-size:12.5px;color:var(--snow-muted);text-transform:uppercase;letter-spacing:.5px;">Current streak</div>
      <div class="mono" style="font-size:36px;font-weight:800;margin-top:6px;color:var(--snow-green);">${streak}<span style="font-size:15px;font-weight:600;color:var(--snow-muted);"> day${streak===1?'':'s'}</span></div>
      <div style="font-size:13px;color:var(--snow-muted);margin-top:12px;line-height:1.5;">Check in daily to keep your streak and earn ${fmtUGX(bonus)} every day.</div>
      <button class="primary-button" id="checkinBtn" style="width:100%;padding:15px 0;font-size:15px;margin-top:20px;" ${claimedToday?'disabled':''} onclick="submitCheckin()">${claimedToday?'Claimed today':'Check In &middot; '+fmtUGX(bonus)}</button>
    </div>`);
};
window.submitCheckin = async function(){
  const btn = $('checkinBtn');
  if (!btn || btn.disabled) return;
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = 'Checking in…';
  const r = await post('/checkin', {});
  if (r.status !== 'success') {
    btn.disabled = false; btn.textContent = label;
    return toast(r.message || 'Could not check in', true);
  }
  toast(`${fmtUGX(r.bonus)} added — day ${r.streak} streak`);
  const acc = await api('/account');
  if (acc.status === 'success') STATE.account = acc.account;
  closeSheet();
  if (STATE.page === 'home') renderHome();
};

// Treasure chest on Home -- opens a centered popup (not a bottom sheet) to
// redeem a gift code, reusing the existing /redeem endpoint. Same feature as
// admin's promo codes, just entered here via the chest instead of an
// Account menu item.
window.openChestModal = function(){
  $('chestCodeInput').value = '';
  $('chestError').innerHTML = '';
  $('chestModalBg').classList.add('show');
  setTimeout(() => $('chestCodeInput').focus(), 50);
};
window.closeChestModal = function(){
  $('chestModalBg').classList.remove('show');
};
window.submitChestCode = async function(){
  const raw = $('chestCodeInput').value.trim();
  if (!raw) { $('chestError').innerHTML = '<div class="auth-error">Enter a code</div>'; return; }
  const btn = $('chestSubmitBtn');
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = 'Opening…';
  const r = await post('/redeem', { code: raw });
  btn.disabled = false; btn.textContent = label;
  if (r.status !== 'success') { $('chestError').innerHTML = `<div class="auth-error">${esc(r.message || 'Could not redeem this code')}</div>`; return; }
  closeChestModal();
  toast(`${fmtUGX(r.reward)} added to your wallet`);
  const acc = await api('/account');
  if (acc.status === 'success') STATE.account = acc.account;
  if (STATE.page === 'home') renderHome();
};

var _recordsTab = 'income';
var INCOME_TX_TYPES = new Set(['cashback','commission','team_reward','mission_salary','mission_deposit_reward','welcome_bonus','checkin','promocode','admin_credit']);
function recordsTabMatch(cat, t){
  if (cat === 'deposit') return t.type === 'deposit';
  if (cat === 'withdraw') return t.type === 'withdraw';
  return INCOME_TX_TYPES.has(t.type);
}
// Cache-first: STATE.transactions is already prefetched at login (see
// enterApp()), so this normally has data to show the instant the sheet
// opens -- no network wait. Still quietly re-fetches in the background to
// stay current for next time.
window.openRecordsSheet = async function(){
  _recordsTab = 'income';
  const hadCache = Array.isArray(STATE.transactions);
  openSheet('Records', `
    <div class="segmented-control" id="recordsTabs">
      <button class="seg active" data-cat="income" onclick="switchRecordsTab('income')">Income</button>
      <button class="seg" data-cat="deposit" onclick="switchRecordsTab('deposit')">Deposits</button>
      <button class="seg" data-cat="withdraw" onclick="switchRecordsTab('withdraw')">Withdrawals</button>
    </div>
    <div id="recordsBody" style="margin-top:16px;"></div>`);
  if (hadCache) renderRecordsTab(_recordsTab);
  const r = await api('/transactions');
  if (r.status === 'success') STATE.transactions = r.transactions;
  else if (!hadCache) STATE.transactions = [];
  if (!$('recordsBody')) return; // sheet closed while awaiting
  renderRecordsTab(_recordsTab);
};
window.switchRecordsTab = function(cat){
  _recordsTab = cat;
  const tabs = $('recordsTabs');
  if (tabs) tabs.querySelectorAll('.seg').forEach(b => b.classList.toggle('active', b.dataset.cat === cat));
  renderRecordsTab(cat);
};
function renderRecordsTab(cat){
  const body = $('recordsBody');
  if (!body) return;
  const rows = (STATE.transactions || []).filter(t => recordsTabMatch(cat, t));
  if (!rows.length) { body.innerHTML = '<div class="list-empty reveal-in">No records yet.</div>'; return; }
  body.innerHTML = '<div class="reveal-in"><div class="settings-list">' + rows.map(t => `
    <div class="list-row">
      <div style="flex:1;min-width:0;">
        <div style="font-size:13.5px;font-weight:600;">${esc(cleanDesc(t.description))}</div>
        <div style="font-size:11px;color:var(--snow-muted);margin-top:1px;">${esc(t.date||'')} ${esc(t.time||'')}</div>
      </div>
      <div class="mono" style="font-size:13px;font-weight:700;color:${t.amount<0?'var(--snow-wine)':'var(--snow-green)'};">${t.amount<0?'-':'+'}${fmtUGX(Math.abs(t.amount))}</div>
    </div>`).join('') + '</div><div class="list-end">No more data</div></div>';
}
function cleanDesc(d){ return d || ''; }

window.openDepositSheet = function(){
  const s = STATE.settings || {};
  openSheet('Deposit', `
    <div class="form-field"><label>Amount (min ${fmtUGX(s.minDeposit)})</label><input id="depAmount" type="text" inputmode="numeric" maxlength="9" placeholder="0"></div>
    <div class="form-field"><label>Mobile-money phone number</label><input id="depPhone" type="tel" inputmode="tel" placeholder="+256 7XX XXX XXX" value="${esc((STATE.account&&STATE.account.phone)||'')}" oninput="sanitizePhoneInput(this)"></div>
    <div class="form-field"><label>Network</label>
      <select id="depNetwork" style="width:100%;padding:15px 16px;border:1px solid var(--snow-border);border-radius:26px;font-size:15px;background:var(--snow-surface);">
        <option value="MTN Mobile Money">MTN Mobile Money</option>
        <option value="Airtel Money">Airtel Money</option>
      </select>
    </div>
    <button class="primary-button" id="depSubmitBtn" style="width:100%;padding:15px 0;font-size:15px;margin-top:8px;" onclick="submitDeposit()">Deposit</button>`);
};
window.submitDeposit = async function(){
  const amount = parseInt($('depAmount').value, 10);
  const phone = $('depPhone').value;
  const network = $('depNetwork').value;
  if (!amount || amount <= 0) return toast('Enter a valid amount', true);
  $('depSubmitBtn').disabled = true; $('depSubmitBtn').textContent = 'Please wait…';
  const r = await post('/deposit/marzpay', { amount, phone, network });
  $('depSubmitBtn').disabled = false; $('depSubmitBtn').textContent = 'Deposit';
  if (r.status !== 'success') return toast(r.message || 'Could not start deposit', true);
  toast(r.message || 'Payment initiated. Check your phone.');
  pollDepositStatus(r.depositId);
  closeSheet();
};
async function pollDepositStatus(depositId){
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const r = await post('/deposit/marzpay/status', { depositId });
    if (r.status === 'success' && r.state === 'matched') { toast('Deposit successful'); if (STATE.page==='home') renderHome(); return; }
    if (r.status === 'success' && r.state === 'failed') { toast(r.message || 'Deposit failed', true); return; }
  }
}

// Cache-first: STATE.bankAccounts is prefetched at login. Deliberately does
// NOT quietly repaint once the background re-fetch lands (unlike Home/Team/
// Products) -- this sheet has live input fields (amount, PIN) and silently
// replacing them out from under someone mid-entry would be a much worse bug
// than a slightly-stale account list. The background fetch still keeps
// STATE.bankAccounts current for the NEXT time this sheet opens.
window.openWithdrawSheet = async function(){
  const s = STATE.settings || {};
  const hadCache = Array.isArray(STATE.bankAccounts);
  openSheet('Withdraw', '');
  if (hadCache) paintWithdrawSheet(s);
  const r = await api('/bank/list');
  if (r.status === 'success') STATE.bankAccounts = r.accounts;
  else if (!hadCache) STATE.bankAccounts = [];
  if (!hadCache && $('sheetBody')) paintWithdrawSheet(s);
};
function paintWithdrawSheet(s){
  const acctOptions = STATE.bankAccounts.map(a => `<option value="${a.id}">${esc(a.holder)} — ${esc(a.network)} ${esc(a.phone)}</option>`).join('');
  $('sheetBody').innerHTML = `<div class="reveal-in">
    <div class="form-field"><label>Amount (min ${fmtUGX(s.minWithdraw)}, ${s.withdrawFeePct||15}% fee applies)</label><input id="witAmount" type="text" inputmode="numeric" maxlength="9" placeholder="0"></div>
    <div class="form-field"><label>Withdrawal account</label>
      ${STATE.bankAccounts.length
        ? `<select id="witAccount" style="width:100%;padding:15px 16px;border:1px solid var(--snow-border);border-radius:26px;font-size:15px;background:var(--snow-surface);">${acctOptions}</select>`
        : `<div class="form-hint">No withdrawal account saved yet.</div><button class="secondary-button" style="width:100%;padding:12px 0;margin-top:8px;" onclick="openWithdrawalAccountsSheet()">Add withdrawal account</button>`}
    </div>
    <div class="form-field"><label>Transaction PIN</label><input id="witPin" type="text" inputmode="numeric" maxlength="5" placeholder="5 digits" autocomplete="one-time-code"></div>
    <button class="primary-button" id="witSubmitBtn" style="width:100%;padding:15px 0;font-size:15px;margin-top:8px;" ${STATE.bankAccounts.length?'':'disabled'} onclick="submitWithdraw()">Request Withdrawal</button></div>`;
}
window.submitWithdraw = async function(){
  const amount = parseInt($('witAmount').value, 10);
  const pin = $('witPin').value.trim();
  const acctSel = $('witAccount');
  const acct = acctSel ? STATE.bankAccounts.find(a => a.id === acctSel.value) : null;
  if (!amount || amount <= 0) return toast('Enter a valid amount', true);
  if (!acct) return toast('Select a withdrawal account', true);
  if (!/^\d{5}$/.test(pin)) return toast('Enter your 5-digit Transaction PIN', true);
  $('witSubmitBtn').disabled = true; $('witSubmitBtn').textContent = 'Please wait…';
  const r = await post('/withdraw/request', { amount, network: acct.network, phone: acct.phone, pin });
  $('witSubmitBtn').disabled = false; $('witSubmitBtn').textContent = 'Request Withdrawal';
  if (r.status !== 'success') return toast(r.message || 'Could not request withdrawal', true);
  toast(r.message || 'Cash-out requested');
  closeSheet();
  if (STATE.page==='home') renderHome();
};

// Cache-first, same reasoning as openWithdrawSheet() above -- this sheet
// also has a live add-account form, so a background refetch never forces a
// repaint over it. renderWithdrawalAccountsSheet() itself is still called
// directly (a real repaint, not stale) right after a save/delete succeeds --
// that's a genuine, expected state change, not a surprise mid-typing.
window.openWithdrawalAccountsSheet = async function(){
  const hadCache = Array.isArray(STATE.bankAccounts);
  openSheet('Withdrawal Accounts', '');
  if (hadCache) renderWithdrawalAccountsSheet();
  const r = await api('/bank/list');
  if (r.status === 'success') STATE.bankAccounts = r.accounts;
  else if (!hadCache) STATE.bankAccounts = [];
  if (!hadCache && $('sheetBody')) renderWithdrawalAccountsSheet();
};
function renderWithdrawalAccountsSheet(){
  const list = STATE.bankAccounts || [];
  let html = '<div class="reveal-in"><div class="settings-list" style="margin-bottom:18px;">';
  html += list.length ? list.map(a => `
    <div class="list-row">
      <div style="flex:1;min-width:0;">
        <div style="font-size:13.5px;font-weight:600;">${esc(a.holder)}</div>
        <div style="font-size:11.5px;color:var(--snow-muted);margin-top:1px;">${esc(a.network)} &middot; ${esc(a.phone)}</div>
      </div>
      <button style="border:none;background:none;color:var(--snow-wine);padding:6px;" onclick="deleteWithdrawalAccount('${a.id}')">${ICONS.trash}</button>
    </div>`).join('') : '<div class="list-empty">No withdrawal accounts saved.</div>';
  html += '</div>';
  html += `
    <div class="section-title" style="margin-bottom:14px;">Add withdrawal account</div>
    <div class="form-field"><label>Account holder name</label><input id="bankHolder" type="text" placeholder="Full name"></div>
    <div class="form-field"><label>Network</label>
      <select id="bankNetwork" style="width:100%;padding:15px 16px;border:1px solid var(--snow-border);border-radius:26px;font-size:15px;background:var(--snow-surface);">
        <option value="" disabled selected>Select network</option>
        <option value="MTN Mobile Money">MTN Mobile Money</option>
        <option value="Airtel Money">Airtel Money</option>
      </select>
    </div>
    <div class="form-field"><label>Phone number</label><input id="bankPhone" type="tel" inputmode="tel" placeholder="+256 7XX XXX XXX" oninput="sanitizePhoneInput(this)"></div>
    <div class="form-field"><label>Transaction PIN</label><input id="bankPin" type="text" inputmode="numeric" maxlength="5" placeholder="5 digits" autocomplete="one-time-code"></div>
    <button class="primary-button" id="bankSaveBtn" style="width:100%;padding:15px 0;font-size:15px;" onclick="saveWithdrawalAccount()">Save account</button></div>`;
  $('sheetBody').innerHTML = html;
}
window.saveWithdrawalAccount = async function(){
  const holder = $('bankHolder').value.trim();
  const network = $('bankNetwork').value;
  const phone = $('bankPhone').value;
  const pin = $('bankPin').value.trim();
  if (!holder) return toast('Enter the account holder name', true);
  if (!network) return toast('Select a network', true);
  if (!/^\d{5}$/.test(pin)) return toast('Enter your 5-digit Transaction PIN', true);
  $('bankSaveBtn').disabled = true; $('bankSaveBtn').textContent = 'Please wait…';
  const r = await post('/bank/save', { holder, network, phone, pin });
  $('bankSaveBtn').disabled = false; $('bankSaveBtn').textContent = 'Save account';
  if (r.status !== 'success') return toast(r.message || 'Could not save account', true);
  toast('Withdrawal account saved');
  const list = await api('/bank/list');
  STATE.bankAccounts = list.status === 'success' ? list.accounts : [];
  renderWithdrawalAccountsSheet();
};
window.deleteWithdrawalAccount = function(id){
  openConfirm('Remove withdrawal account?', 'Enter your Transaction PIN to confirm.', async (pinValue) => {
    const r = await post('/bank/delete', { id, pin: pinValue });
    if (r.status !== 'success') { toast(r.message || 'Could not remove account', true); return false; }
    toast('Account removed');
    const list = await api('/bank/list');
    STATE.bankAccounts = list.status === 'success' ? list.accounts : [];
    renderWithdrawalAccountsSheet();
    return true;
  });
};

window.openInvestConfirm = function(tierKey){
  const p = (STATE.products||[]).find(x => x.key === tierKey);
  if (!p) return;
  const dailyPayout = Math.round((p.expectedReturn||p.price*30)/(p.cycle||150));
  $('confirmSheet').innerHTML = `
    <h3>Confirm purchase</h3>
    <p style="color:rgba(255,255,255,.65);font-size:13px;margin:0 0 12px;">${esc(p.name)}</p>
    <div class="confirm-row"><span>Investment</span><span class="mono">${fmtUGX(p.price)}</span></div>
    <div class="confirm-row"><span>Daily cashback</span><span class="mono">${fmtUGX(dailyPayout)}</span></div>
    <div class="confirm-row"><span>Duration</span><span class="mono">${p.cycle||150} days</span></div>
    <div class="confirm-row"><span>Total return</span><span class="mono">${fmtUGX(p.expectedReturn||p.price*30)}</span></div>
    <button class="primary-button" id="investConfirmBtn" style="width:100%;padding:15px 0;font-size:15px;margin-top:16px;" onclick="confirmInvest('${esc(tierKey)}')">Confirm & Invest</button>
    <button class="secondary-button" style="width:100%;padding:13px 0;font-size:14px;margin-top:10px;border:none;color:rgba(255,255,255,.65);" onclick="closeConfirm()">Cancel</button>`;
  $('confirmBg').classList.add('show');
};
window.closeConfirm = function(){ $('confirmBg').classList.remove('show'); };
window.confirmInvest = async function(tierKey){
  const btn = $('investConfirmBtn');
  btn.disabled = true; btn.textContent = 'Please wait…';
  const r = await post('/invest/create', { tierKey });
  closeConfirm();
  if (r.status !== 'success') return toast(r.message || 'Could not complete purchase', true);
  toast(r.message || 'Purchase successful');
  if (STATE.page === 'home') renderHome();
};
function openConfirm(title, body, onConfirm){
  $('confirmSheet').innerHTML = `
    <h3>${esc(title)}</h3>
    <p style="color:var(--snow-muted);font-size:13px;margin:0 0 14px;">${esc(body)}</p>
    <input id="confirmPin" type="text" inputmode="numeric" maxlength="5" placeholder="5-digit PIN" style="width:100%;padding:15px 16px;border:1px solid var(--snow-border);border-radius:26px;font-size:15px;margin-bottom:14px;">
    <button class="primary-button" id="confirmActionBtn" style="width:100%;padding:15px 0;font-size:15px;">Confirm</button>
    <button class="secondary-button" style="width:100%;padding:13px 0;font-size:14px;margin-top:10px;border:none;color:rgba(255,255,255,.65);" onclick="closeConfirm()">Cancel</button>`;
  $('confirmActionBtn').onclick = async () => {
    const pinValue = $('confirmPin').value.trim();
    if (!/^\d{5}$/.test(pinValue)) return toast('Enter your 5-digit Transaction PIN', true);
    $('confirmActionBtn').disabled = true; $('confirmActionBtn').textContent = 'Please wait…';
    const ok = await onConfirm(pinValue);
    $('confirmActionBtn').disabled = false; $('confirmActionBtn').textContent = 'Confirm';
    if (ok) closeConfirm();
  };
  $('confirmBg').classList.add('show');
}

// ── PWA: install prompt + service worker auto-update ──
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  window._installPrompt = e;
});
window.addEventListener('appinstalled', () => { window._installPrompt = null; });
window.promptInstallApp = async function(){
  if (!window._installPrompt) { toast('Already installed, or your browser doesn\'t support installing Snow.'); return; }
  window._installPrompt.prompt();
  await window._installPrompt.userChoice.catch(() => {});
  window._installPrompt = null;
};
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      const checkForUpdate = () => reg.update().catch(() => {});
      setInterval(checkForUpdate, 60 * 60 * 1000);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) checkForUpdate(); });
      window.addEventListener('focus', checkForUpdate);
    }).catch(() => {});
  });
  // Only reload when there was ALREADY a controller at page-load time --
  // controllerchange also fires on the very first clients.claim() after a
  // fresh install/cleared cache, which is not a real update and would
  // otherwise bounce the app back to the loading screen for no reason.
  let _swReloading = false;
  let _hadControllerAtLoad = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (_swReloading) return;
    if (!_hadControllerAtLoad) { _hadControllerAtLoad = true; return; }
    (function tryReload(){
      if ((window._moneyCallsInFlight || 0) > 0) { setTimeout(tryReload, 500); return; }
      _swReloading = true;
      location.reload();
    })();
  });
}

// ── START ──
captureReferralFromUrl();
boot();

