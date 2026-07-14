import { initializeApp, getApps }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signInWithCustomToken, onAuthStateChanged, signOut, updatePassword, reauthenticateWithCredential, EmailAuthProvider }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

// FURAGEMZ — Firebase web config. Owner: replace with the Furagemz Firebase
// project's own web config once that project is created (separate from Voltra's).
const firebaseConfig = {
  apiKey:            "AIzaSyBcyftQBgJXPoVhNx0BSSv-ZUz81k2YxZ0",
  authDomain:        "furagemz.firebaseapp.com",
  projectId:         "furagemz",
  storageBucket:     "furagemz.firebasestorage.app",
  messagingSenderId: "538053506631",
  appId:             "1:538053506631:web:a388e60009a456befda362"
};

// Furagemz Render backend.
const SERVER = 'https://ugandalove.onrender.com';

const app  = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);

// ── SERVICE WORKER REMOVED (owner's call) ──
// Actively unregister any previously-installed worker and wipe its caches so
// every phone that got stuck on a cached build goes straight back to the live
// site. The app now always loads directly from the network, like Voltra's origin.
let _installPrompt = null;
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister())).catch(() => {});
}
try { if (window.caches) caches.keys().then(ks => ks.forEach(k => caches.delete(k))); } catch (_) {}
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); _installPrompt = e; });
window.addEventListener('appinstalled', () => { _installPrompt = null; try { toast('Furagemz installed', 'ok'); } catch (_) {} });
function isInstalled() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

// ── STATE ──
let _user = null, _account = null, _investments = [], _members = [], _txns = [], _products = [];
let _activeTab = 'home';
let _txnFilter = 'all';
let _feed = [];
let _hideBal = false;
try { _hideBal = localStorage.getItem('fg_hide_bal') === '1'; } catch (_) {}

// ── SVG ICONS ──
const _svg = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const ICN = {
  topup:        _svg('<rect x="3" y="8" width="18" height="12" rx="2"/><path d="M7 8V6a5 5 0 0 1 10 0v2"/><path d="M12 12v4"/><path d="M9.5 14.5 12 17l2.5-2.5"/>'),
  withdrawal:   _svg('<rect x="3" y="8" width="18" height="12" rx="2"/><path d="M7 8V6a5 5 0 0 1 10 0v2"/><path d="M12 17v-4"/><path d="M9.5 14.5 12 12l2.5 2.5"/>'),
  investment:   _svg('<path d="M6 3h12l4 6-10 12L2 9z"/><path d="M2 9h20M9 3l3 6-3 12M15 3l-3 6 3 12"/>'),
  gem_payout:   _svg('<circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 4.5-5"/>'),
  commission:   _svg('<circle cx="9" cy="8" r="3"/><path d="M2.5 20c0-3.3 2.9-5.5 6.5-5.5s6.5 2.2 6.5 5.5"/><circle cx="18" cy="9" r="2.2"/><path d="M15.8 14.7c2.3.4 4.2 2.1 4.2 5.3"/>'),
  checkin:      _svg('<rect x="3" y="4" width="18" height="18" rx="3"/><path d="M8 2v4M16 2v4M3 10h18"/><path d="m8.5 15 2 2 4-4"/>'),
  admin_credit: _svg('<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>'),
  admin_debit:  _svg('<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>'),
  refund:       _svg('<path d="M3 10h11a5 5 0 0 1 0 10H9"/><path d="m7 5-4 5 4 5"/>'),
  close:        _svg('<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>'),
  back:         _svg('<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>'),
  download:     _svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>'),
  phone:        _svg('<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M10.5 5h3"/><path d="M12 17.5h.01"/>'),
  award:        _svg('<circle cx="12" cy="9" r="6"/><path d="M8.5 14 7 22l5-3 5 3-1.5-8"/>'),
  info:         _svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>'),
  about:        _svg('<circle cx="12" cy="12" r="9"/><path d="M12 16v-5"/><path d="M12 8h.01"/>'),
  eye:          _svg('<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/>'),
  eyeOff:       _svg('<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>'),
  copy:         _svg('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>'),
  down:         _svg('<line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>'),
  up:           _svg('<line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>'),
  chevron:      _svg('<polyline points="9 6 15 12 9 18"/>'),
  receipt:      _svg('<path d="M5 3v18l2-1.5L9 21l2-1.5L13 21l2-1.5L17 21l2-1.5V3l-2 1.5L15 3l-2 1.5L11 3 9 4.5 7 3z"/><path d="M8 8h8M8 12h8"/>'),
  gem:          _svg('<path d="M6 3h12l4 6-10 12L2 9z"/><path d="M2 9h20"/>'),
  people:       _svg('<circle cx="9" cy="8" r="3.2"/><path d="M2.5 20c0-3.3 2.9-5.5 6.5-5.5s6.5 2.2 6.5 5.5"/><circle cx="18" cy="9" r="2.4"/>'),
  logout:       _svg('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>'),
  redeem:       _svg('<path d="M4 8h16a1 1 0 0 1 1 1v2a2 2 0 0 0 0 4v2a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-2a2 2 0 0 0 0-4V9a1 1 0 0 1 1-1z"/><path d="M13 8v12" stroke-dasharray="2 2"/>'),
  lock:         _svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
  support:      _svg('<path d="M21 15a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z"/><path d="M9.5 10h.01M12 10h.01M14.5 10h.01"/>'),
  mail:         _svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/>'),
  telegram:     _svg('<path d="M21 4 3 11.5l6 2M21 4 15 20l-6-6.5M21 4 9 13.5"/>'),
  clock:        _svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  bank:         _svg('<rect x="3" y="8" width="18" height="12" rx="2"/><path d="M3 12h18"/><path d="M7 16h4"/>'),
  trash:        _svg('<path d="M4 7h16"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/>'),
  boost:        _svg('<path d="M13 3 5 13h6l-1 8 9-11h-6z"/>'),
};

// Faceted emerald-cut gem illustration, tinted to any tier colour. Layered
// polygons + white overlays give facets and shine on a flat brand colour.
function gemArt(color) {
  return `<svg viewBox="0 0 64 64" fill="none">
    <polygon points="22,8 42,8 56,22 56,42 42,56 22,56 8,42 8,22" fill="${color}"/>
    <polygon points="18,16 46,16 48,22 48,42 46,48 18,48 16,42 16,22" fill="#ffffff" opacity="0.15"/>
    <polygon points="25,22 39,22 41,26 41,38 39,42 25,42 23,38 23,26" fill="#ffffff" opacity="0.20"/>
    <polygon points="22,8 31,8 15,24 8,24 8,22" fill="#ffffff" opacity="0.28"/>
    <polygon points="22,8 42,8 56,22 56,42 42,56 22,56 8,42 8,22" fill="none" stroke="#ffffff" stroke-opacity="0.4" stroke-width="1.3" stroke-linejoin="round"/>
  </svg>`;
}
function typeIcon(t) { return ICN[t] || ICN.admin_credit; }
function typeColor(t) {
  const map = {
    topup: 'var(--emerald)', gem_payout: 'var(--ok)', commission: 'var(--sapphire)',
    checkin: 'var(--topaz)', withdrawal: 'var(--ruby)', admin_debit: 'var(--ruby)',
    investment: 'var(--amethyst)', refund: 'var(--sapphire)', admin_credit: 'var(--violet)',
    redeem: 'var(--violet)', boost: '#ef4444', team_reward: '#db2777'
  };
  return map[t] || 'var(--violet)';
}

// ── UTILS ──
function ugx(n) { return 'UGX ' + Number(n || 0).toLocaleString('en-UG'); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
function initials(name) {
  const parts = String(name || 'F').trim().split(/\s+/);
  return ((parts[0]?.[0] || 'F') + (parts[1]?.[0] || '')).toUpperCase();
}
function timeAgo(ms) {
  if (!ms) return '';
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}
function tsMs(v) {
  if (!v) return 0;
  if (v.seconds != null) return v.seconds * 1000;
  const t = new Date(v).getTime();
  return isNaN(t) ? 0 : t;
}

function toast(msg, kind = '') {
  const root = document.getElementById('toastRoot');
  const el = document.createElement('div');
  el.className = 'toast' + (kind ? ' ' + kind : '');
  // Rises from the bottom and spreads open, holds, then collapses back down the
  // same way it came in (CSS handles enter; the 'out' class reverses it).
  el.innerHTML = `<span class="toast-in">${esc(msg)}</span>`;
  root.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 380); }, 2800);
}

// Disable a button while a request is in flight and show an animated three-dot
// loader (no "Please wait" / "Loading…" text anywhere).
function setBusy(btn) {
  if (!btn) return () => {};
  const prevHTML = btn.innerHTML, prevDisabled = btn.disabled;
  btn.disabled = true;
  btn.innerHTML = '<span class="btn-dots"><i></i><i></i><i></i></span>';
  return () => { btn.disabled = prevDisabled; btn.innerHTML = prevHTML; };
}

// Pages slide in from the right (full screen) instead of the old bottom-sheet.
// The phone Back button closes the open page rather than leaving the app:
// each open pushes a history entry, popstate closes without re-pushing.
let _pageOpen = false;
function openModal(html) {
  const root = document.getElementById('modalRoot');
  root.style.alignItems = '';
  root.innerHTML = `<div class="modal-backdrop" data-close></div><div class="modal-card">${html}</div>`;
  root.classList.remove('hidden');
  root.querySelector('[data-close]').addEventListener('click', () => closeModal());
  const closeBtn = root.querySelector('.modal-close');
  if (closeBtn) { closeBtn.innerHTML = ICN.back; closeBtn.addEventListener('click', () => closeModal()); }
  if (!_pageOpen) { _pageOpen = true; try { history.pushState({ fgPage: 1 }, ''); } catch (_) {} }
}
function closeModal(fromPop) {
  const root = document.getElementById('modalRoot');
  root.classList.add('hidden');
  root.innerHTML = '';
  if (_pageOpen) {
    _pageOpen = false;
    if (!fromPop) { try { history.back(); } catch (_) {} }
  }
}
window.addEventListener('popstate', () => { if (_pageOpen) closeModal(true); });

function phoneToEmail(phone) { return String(phone).replace(/\D/g, '') + '@furagemz-app.com'; }
function cleanPhone(raw) {
  const s = String(raw || '').replace(/\D/g, '');
  if (s.startsWith('256') && s.length >= 12) return '+' + s;
  if (s.startsWith('0') && s.length === 10) return '+256' + s.slice(1);
  if (s.length === 9) return '+256' + s;
  return '+256' + s;
}

// ── API HELPER ──
// Sends the Firebase ID token so the server can verify the caller. Money
// endpoints are never retried on failure — a lost response must never be
// re-sent, or a payment/investment could be applied twice.
const NO_RETRY = ['/deposit', '/invest/', '/withdraw/request', '/checkin', '/register'];
async function api(path, { method = 'GET', body } = {}, _attempt = 0) {
  const headers = { 'Content-Type': 'application/json' };
  if (_user) { try { headers['Authorization'] = 'Bearer ' + await _user.getIdToken(); } catch (_) {} }
  try {
    // Abort a hung request (cold server / dropped network) so nothing waits forever.
    const resp = await fetch(SERVER + path, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
    return await resp.json();
  } catch (e) {
    const unsafe = NO_RETRY.some(p => path.startsWith(p));
    if (_attempt < 2 && !unsafe && method === 'GET') {
      await new Promise(r => setTimeout(r, 700 * (_attempt + 1)));
      return api(path, { method, body }, _attempt + 1);
    }
    return { status: 'error', message: 'Network issue. Please try again.' };
  }
}

// ══════════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════════
function showView(name) {
  const boot = document.getElementById('bootView');
  if (boot) boot.classList.add('hidden');
  document.getElementById('authView').classList.toggle('hidden', name !== 'auth');
  document.getElementById('mainView').classList.toggle('hidden', name !== 'main');
  // Remember on THIS device that the user reached the dashboard, so next launch
  // skips the login screen and auto-syncs straight in.
  try {
    if (name === 'main') localStorage.setItem('fg_wasAuthed', '1');
    else if (name === 'auth') localStorage.removeItem('fg_wasAuthed');
  } catch (_) {}
}

// Paint the gradient watermark gems + floating decorative gems behind auth.
document.getElementById('authArt1').innerHTML = gemArt('#ffffff');
document.getElementById('authArt2').innerHTML = gemArt('#ffffff');
document.querySelectorAll('.float-gem').forEach(el => { el.innerHTML = gemArt(el.dataset.fgem || '#ffffff'); });

// ── Jumbled-letter captcha ──
let _captchaId = null;
async function loadCaptcha() {
  const box = document.getElementById('captchaBox');
  if (!box) return;
  box.innerHTML = '<span style="color:#b9a9d6">…</span>';
  const r = await api('/auth/captcha', { method: 'POST' });
  if (r.status !== 'success') { box.innerHTML = '<span style="color:#b9a9d6">—</span>'; return; }
  _captchaId = r.captchaId;
  const cols = ['#7c3aed', '#0ea5e9', '#e11d48', '#059669', '#c026d3', '#eab308'];
  const letters = String(r.challenge).split('').map(ch => {
    const rot = (Math.random() * 40 - 20).toFixed(1);
    const dy = (Math.random() * 10 - 5).toFixed(1);
    const col = cols[Math.floor(Math.random() * cols.length)];
    return `<span style="transform:rotate(${rot}deg) translateY(${dy}px);color:${col}">${esc(ch)}</span>`;
  }).join('');
  box.innerHTML = `<i class="cap-line cl1"></i><i class="cap-line cl2"></i>${letters}`;
}
// Captcha auto-loads when the register form opens and refreshes itself after a
// wrong answer — no manual "reload" button for the user to tap.

let _authMode = 'login';
function setAuthMode(mode) {
  _authMode = mode;
  const login = mode === 'login';
  document.getElementById('loginForm').classList.toggle('active', login);
  document.getElementById('registerForm').classList.toggle('active', !login);
  document.getElementById('authTitle').textContent = login ? 'Start logging in' : 'Create your account';
  document.getElementById('authErr').classList.add('hidden');
  document.querySelector('.auth-scroll').scrollTop = 0;
  if (!login) loadCaptcha();
}
document.getElementById('toRegister').addEventListener('click', () => setAuthMode('register'));
document.getElementById('toLogin').addEventListener('click', () => setAuthMode('login'));
document.querySelectorAll('[data-toggle]').forEach(btn => {
  btn.innerHTML = ICN.eye;
  btn.addEventListener('click', () => {
    const input = document.getElementById(btn.dataset.toggle);
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.innerHTML = show ? ICN.eyeOff : ICN.eye;
  });
});
function authError(msg) {
  const box = document.getElementById('authErr');
  box.textContent = msg;
  box.classList.remove('hidden');
}

// Prefill a referral username from ?ref= in the link.
(() => {
  try {
    const ref = new URLSearchParams(location.search).get('ref');
    if (ref) { document.getElementById('rgRef').value = ref; }
  } catch (_) {}
})();

// Live username availability check (debounced).
let _unameTimer = null, _unameOk = false;
const unameInput = document.getElementById('rgUser');
const unameHint = document.getElementById('unameHint');
unameInput.addEventListener('input', () => {
  _unameOk = false;
  const v = unameInput.value.trim();
  unameHint.className = 'uname-hint';
  unameHint.textContent = '';
  if (_unameTimer) clearTimeout(_unameTimer);
  if (!v) return;
  if (!/^[a-zA-Z0-9_]{3,16}$/.test(v)) {
    unameHint.className = 'uname-hint bad';
    unameHint.textContent = '3–16 letters, numbers or underscore.';
    return;
  }
  _unameTimer = setTimeout(async () => {
    const r = await api('/auth/check-username', { method: 'POST', body: { username: v } });
    if (unameInput.value.trim() !== v) return; // changed since
    if (r.status === 'success' && r.available) {
      _unameOk = true;
      unameHint.className = 'uname-hint ok';
      unameHint.textContent = v + ' is available';
    } else {
      _unameOk = false;
      unameHint.className = 'uname-hint bad';
      unameHint.textContent = r.reason || 'That username is taken.';
    }
  }, 450);
});

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const phone = document.getElementById('liPhone').value.trim();
  const pass = document.getElementById('liPass').value;
  if (!phone || !pass) return authError('Enter your phone number and password.');
  document.getElementById('authErr').classList.add('hidden');
  const restore = setBusy(document.getElementById('liSubmit'), 'Please wait');
  try {
    try {
      await signInWithEmailAndPassword(auth, phoneToEmail(phone), pass);
    } catch (primaryErr) {
      if (primaryErr.code === 'auth/network-request-failed') {
        const r = await api('/auth/login', { method: 'POST', body: { phone, password: pass } });
        if (r.status !== 'success') throw new Error(r.message || 'Login failed');
        await signInWithCustomToken(auth, r.customToken);
      } else throw primaryErr;
    }
  } catch (err) {
    restore();
    const msg = /user-not-found|wrong-password|invalid-credential/.test(err.code || '')
      ? 'Incorrect phone or password.' : (err.message || 'Login failed.');
    authError(msg);
  }
});

// Keep the Firebase credential across a retry so a post-signup username
// collision doesn't try to re-register the phone.
let _pendingCred = null;
document.getElementById('registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const phone = document.getElementById('rgPhone').value.trim();
  const pass = document.getElementById('rgPass').value;
  const pass2 = document.getElementById('rgPass2').value;
  const username = document.getElementById('rgUser').value.trim();
  const ref = document.getElementById('rgRef').value.trim();
  if (!phone || !pass || !username) return authError('Fill in phone, password and a username.');
  if (pass.length < 6) return authError('Password must be at least 6 characters.');
  if (pass !== pass2) return authError('The two passwords do not match.');
  if (!/^[a-zA-Z0-9_]{3,16}$/.test(username)) return authError('Username must be 3–16 letters, numbers or underscore.');
  const captcha = document.getElementById('rgCaptcha').value.trim();
  if (!captcha) return authError('Type the letters shown in the box.');
  document.getElementById('authErr').classList.add('hidden');
  const restore = setBusy(document.getElementById('rgSubmit'), 'Please wait');
  try {
    // Anti-bot: verify the jumbled-letter captcha before anything else.
    const capR = await api('/auth/captcha/verify', { method: 'POST', body: { captchaId: _captchaId, answer: captcha } });
    if (capR.status !== 'success') { restore(); loadCaptcha(); document.getElementById('rgCaptcha').value = ''; return authError(capR.message || 'Incorrect verification code.'); }
    // Pre-check availability so we don't create a phone account for a taken name.
    const chk = await api('/auth/check-username', { method: 'POST', body: { username } });
    if (chk.status === 'success' && !chk.available) { restore(); return authError(chk.reason || 'That username is taken.'); }
    // Pre-check the referral code — a code that doesn't belong to a real user
    // stops registration HERE, before any account is created.
    if (ref) {
      const rchk = await api('/auth/check-referral', { method: 'POST', body: { referralCode: ref } });
      if (rchk.status === 'success' && !rchk.valid) { restore(); return authError(rchk.reason || 'That referral code does not exist.'); }
    }

    if (!_pendingCred) {
      try {
        _pendingCred = await createUserWithEmailAndPassword(auth, phoneToEmail(phone), pass);
      } catch (primaryErr) {
        if (primaryErr.code === 'auth/network-request-failed') {
          const r = await api('/auth/register', { method: 'POST', body: { phone, password: pass } });
          if (r.status !== 'success') throw new Error(r.message || 'Registration failed');
          _pendingCred = await signInWithCustomToken(auth, r.customToken);
        } else throw primaryErr;
      }
    }
    const prof = await api('/account/create-profile', { method: 'POST', body: { username, phone: cleanPhone(phone).replace('+', '') } });
    if (prof.status !== 'success') { restore(); return authError(prof.message || 'Could not create your profile.'); }
    // Register applies the welcome bonus AND records the referral link. It is
    // idempotent server-side (registrationDone guard), so retry it a few times on
    // a network blip — otherwise a referral could be silently lost at sign-up.
    let regRef = ref;
    for (let attempt = 0; attempt < 3; attempt++) {
      const reg = await api('/register', { method: 'POST', body: { referralCode: regRef } });
      if (reg.status === 'success' || reg.status === 'already_done') break;
      // Code vanished between pre-check and now (e.g. referrer deleted): finish
      // the registration without it rather than leaving a half-created account.
      if (reg.code === 'BAD_REFERRAL') { regRef = ''; continue; }
      await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
    }
    _pendingCred = null; // success — onAuthStateChanged takes over
  } catch (err) {
    restore();
    const msg = err.code === 'auth/email-already-in-use'
      ? 'This phone number is already registered.' : (err.message || 'Registration failed.');
    authError(msg);
  }
});

document.getElementById('mainView').addEventListener('click', (e) => {
  const logoutBtn = e.target.closest('#logoutBtn');
  if (logoutBtn) doLogout();
});
async function doLogout() {
  await signOut(auth);
  _user = null; _account = null;
  // Remove the maintenance/banned blocker if it's up, or it would cover the auth view.
  document.getElementById('blockerView')?.remove();
  showView('auth');
}

// ══════════════════════════════════════════════
// BOOT / DATA LOAD
// ══════════════════════════════════════════════
let _publicSettings = null;
onAuthStateChanged(auth, async (user) => {
  _user = user;
  if (!user) { showView('auth'); return; }
  // Keep the branded syncing screen up and load the ESSENTIAL data — balance,
  // gems, transactions AND settings (banner images) — BEFORE revealing the
  // dashboard, so it appears already populated: no "UGX 0 → real" flash and no
  // default banners flashing before the admin images. Capped so a slow network
  // can't hang the sync screen; anything still loading finishes in the background.
  const essential = Promise.all([loadAccount(), loadPublicSettings(), loadTxns(), loadActivityFeed(), loadProducts(), loadTeam()]);
  await Promise.race([essential, new Promise(r => setTimeout(r, 8000))]);
  if (checkGate()) return;
  render();
  showView('main');
  startRealtime();
  maybeShowAnnouncement();
  // If the 8s cap fired before data was ready, repaint the moment it lands.
  essential.then(() => { if (checkGate()) return; if (!_pageOpen) render(); }).catch(() => {});
});
// Returns true (and shows a blocker) if the app should be gated off.
function checkGate() {
  if (_publicSettings?.maintenanceMode) {
    showBlocker('Under maintenance', _publicSettings.maintenanceMsg || 'Furagemz is being upgraded. Please check back shortly.', 'Try again', () => location.reload());
    return true;
  }
  if (_account?.status === 'banned') {
    showBlocker('Account suspended', 'Your account has been suspended. Contact support if you believe this is a mistake.', 'Log out', doLogout);
    return true;
  }
  return false;
}

// ── REAL-TIME REFRESH ──
// Silently re-pulls balance, transactions and team every 15s (and the moment the
// app regains focus) and re-renders the visible tab — so a commission landing,
// a deposit clearing or a daily payout shows up on its own, no manual reload.
// Pauses while the tab is hidden or a full-page/modal is open (M0-friendly).
let _realtimeTimer = null, _realtimeSig = '', _tickN = 0;
function dataSig() {
  return [_account?.walletBalance, _account?.totalEarned, _account?.commissionEarned,
    _account?.totalWithdrawn, _account?.totalDeposited, _account?.teamL1Count,
    _txns.length, _txns[0]?.status, _investments.length,
    _investments.map(i => i.status).join(''), _members.length].join('|');
}
async function realtimeTick() {
  if (document.hidden || !_user || _pageOpen) return;
  _tickN++;
  // Every ~20th tick also refresh the live activity ticker (server caches it,
  // so this is cheap) — the feed stays alive instead of freezing at boot.
  const wantFeed = _tickN % 20 === 0;
  try {
    await Promise.all([loadAccount(), loadTxns(),
      (_activeTab === 'team' ? loadTeam() : Promise.resolve()),
      (wantFeed ? loadActivityFeed() : Promise.resolve())]);
  } catch (_) { return; }
  if (_pageOpen || document.hidden) return; // state changed during the await
  if (wantFeed) {
    const track = document.querySelector('#panel-home .ticker-track');
    if (track) track.innerHTML = tickerItemsHtml();
  }
  // Only re-render when something actually changed — no needless flicker.
  const sig = dataSig();
  if (sig === _realtimeSig) return;
  _realtimeSig = sig;
  if (_activeTab === 'home') renderHome();
  else if (_activeTab === 'account') renderAccount();
  else if (_activeTab === 'team') renderTeam();
}
function startRealtime() {
  if (_realtimeTimer) return;
  _realtimeTimer = setInterval(realtimeTick, 4000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) realtimeTick(); });
  startCountdownTick();
}

// Full-screen blocker (maintenance / banned) — replaces the app entirely.
function showBlocker(title, msg, actionLabel, action) {
  document.getElementById('authView')?.classList.add('hidden');
  document.getElementById('mainView')?.classList.add('hidden');
  const old = document.getElementById('blockerView'); if (old) old.remove();
  const el = document.createElement('div');
  el.id = 'blockerView'; el.className = 'blocker';
  el.innerHTML = `<div class="blocker-card"><div class="blocker-logo">${FG_LOGO}</div>
    <h2>${esc(title)}</h2><p>${esc(msg)}</p><button class="btn" id="blockerBtn">${esc(actionLabel)}</button></div>`;
  document.body.appendChild(el);
  document.getElementById('blockerBtn').addEventListener('click', action);
}

async function loadActivityFeed() {
  const r = await api('/public/activity-feed');
  if (r.status === 'success') _feed = r.feed || [];
}
const TICK_COLORS = ['#7c3aed', '#0ea5e9', '#f43f5e', '#10b981', '#eab308', '#c084fc'];
function tickColor(name) {
  let h = 0; for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return TICK_COLORS[h % TICK_COLORS.length];
}
function tickerItemsHtml() {
  if (!_feed.length) return '';
  const one = f => {
    const label = f.action === 'joined Furagemz'
      ? `${esc(f.name)} joined Furagemz`
      : `${esc(f.name)} ${esc(f.action)}${f.amount ? ` <span class="tk-amt">${ugx(f.amount)}</span>` : ''}`;
    return `<div class="tick-item"><span class="tav" style="background:${tickColor(f.name)}">${esc(initials(f.name))}</span><span>${label} <span class="tk-ago">· ${f.ago}m</span></span></div>`;
  };
  const items = _feed.map(one).join('');
  return items + items; // duplicated so the -50% marquee loops seamlessly
}

async function loadPublicSettings() {
  const r = await api('/settings/public');
  if (r.status === 'success') _publicSettings = r;
  return _publicSettings;
}

const FG_LOGO = `<svg viewBox="0 0 100 100" fill="none">
  <polygon points="35,20 65,20 82,42 58,80 42,80 18,42" fill="#7c3aed"/>
  <polygon points="50,32 35,20 65,20" fill="#10b981"/><polygon points="50,32 65,20 82,42" fill="#38bdf8"/>
  <polygon points="50,32 82,42 58,80" fill="#f43f5e"/><polygon points="50,32 58,80 42,80" fill="#eab308"/>
  <polygon points="50,32 42,80 18,42" fill="#c084fc"/></svg>`;

function maybeShowAnnouncement() {
  const ann = _publicSettings?.announcement;
  if (!ann || !ann.enabled || !ann.body) return;
  let seen = null;
  try { seen = localStorage.getItem('fg_ann_seen'); } catch (_) {}
  if (String(seen) === String(ann.version)) return; // already dismissed this version
  const root = document.getElementById('modalRoot');
  root.style.alignItems = 'center';
  root.innerHTML = `
    <div class="modal-backdrop" data-close></div>
    <div class="ann-card">
      <div class="ann-hero"><span class="ann-htitle">${esc(ann.title || 'Notice')}</span>
        <div class="ann-logo">${FG_LOGO}</div></div>
      <div class="ann-body">
        <div class="ann-text">${esc(ann.body)}</div>
        ${ann.ctaUrl && ann.ctaLabel ? `<a class="ann-cta" href="${esc(ann.ctaUrl)}" target="_blank" rel="noopener">${esc(ann.ctaLabel)}</a>` : ''}
        <button class="ann-ok" id="annOk">OK</button>
      </div>
    </div>`;
  root.classList.remove('hidden');
  const dismiss = () => { try { localStorage.setItem('fg_ann_seen', String(ann.version)); } catch (_) {} root.style.alignItems = ''; closeModal(); };
  root.querySelector('#annOk').addEventListener('click', dismiss);
  root.querySelector('[data-close]').addEventListener('click', dismiss);
}

async function loadAccount() {
  const [accR, invR] = await Promise.all([
    api('/account'),
    api('/account/investments'),
  ]);
  if (accR.status === 'success') _account = accR.account;
  if (invR.status === 'success') _investments = invR.investments || [];
}
async function loadProducts() {
  if (_products.length) return;
  const r = await api('/products');
  if (r.status === 'success') _products = r.products || [];
}
let _teamStats = null;
// Client-side copy of the milestone ladder so the Task centre renders instantly
// (0% / unpaid) before /team/stats returns — no loader. Server is source of truth
// for what's actually paid; these fill in the moment stats arrive.
const TEAM_MILESTONES = [
  { target:   60000, reward:  3000 },
  { target:  100000, reward: 10000 },
  { target:  250000, reward: 15000 },
  { target:  500000, reward: 25000 },
  { target: 1000000, reward: 50000 },
];
async function loadTeam() {
  const [r, s] = await Promise.all([api('/team/members'), api('/team/stats')]);
  if (r.status === 'success') _members = r.members || [];
  if (s.status === 'success') _teamStats = s;
}
async function loadTxns() {
  const r = await api('/account/transactions');
  if (r.status === 'success') _txns = r.transactions || [];
}

// ══════════════════════════════════════════════
// TAB NAVIGATION
// ══════════════════════════════════════════════
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});
async function switchTab(name) {
  _activeTab = name;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.panel').forEach(p => p.classList.toggle('hidden', p.id !== 'panel-' + name));
  document.getElementById('topbarTitle').textContent = { home: 'Home', gems: 'Gems', team: 'Team', account: 'Account' }[name];
  // INSTANT tabs: paint whatever is cached NOW, refresh silently in the
  // background and repaint when fresh data lands — never block the switch.
  if (name === 'gems' && !_products.length)
    loadProducts().then(() => { if (_activeTab === 'gems') renderGems(); }).catch(() => {});
  if (name === 'team')
    loadTeam().then(() => { if (_activeTab === 'team') renderTeam(); }).catch(() => {});
  if (name === 'account' && !_txns.length)
    loadTxns().then(() => { if (_activeTab === 'account') renderAccount(); }).catch(() => {});
}

function render() {
  renderHome();
  renderGems();
  renderTeam();
  renderAccount();
}

// ══════════════════════════════════════════════
// HOME
// ══════════════════════════════════════════════
function ringSvg(pct, color) {
  const r = 22, c = 2 * Math.PI * r;
  const off = c * (1 - Math.min(1, Math.max(0, pct)));
  // Start empty (offset = full circumference) and store the target; animateRings()
  // sweeps each ring to its real value on render, so progress is visibly "moving".
  return `<svg viewBox="0 0 54 54"><circle class="ring-track" cx="27" cy="27" r="${r}" fill="none" stroke-width="5"/>
    <circle class="ring-prog" cx="27" cy="27" r="${r}" fill="none" stroke="${color}" stroke-width="5" stroke-linecap="round"
      stroke-dasharray="${c}" stroke-dashoffset="${c}" data-off="${off.toFixed(2)}"/></svg>`;
}
// Sweep every progress ring from empty to its real value, then keep them updated.
function animateRings() {
  requestAnimationFrame(() => {
    document.querySelectorAll('#panel-home .ring-prog').forEach(circ => {
      const off = parseFloat(circ.getAttribute('data-off'));
      if (!isNaN(off)) circ.style.strokeDashoffset = off;
    });
  });
}
let _ringTimer = null;
function startRingTick() {
  if (_ringTimer) return;
  // Recompute progress every 30s (no network) so a gem's ring keeps creeping
  // forward while the user watches the home screen.
  _ringTimer = setInterval(() => {
    if (_activeTab !== 'home') return;
    document.querySelectorAll('#panel-home .ring[data-inv]').forEach(el => {
      const inv = _investments.find(i => i.id === el.dataset.inv);
      const circ = el.querySelector('.ring-prog');
      if (!inv || !circ) return;
      const c = 2 * Math.PI * 22;
      circ.style.strokeDashoffset = c * (1 - gemProgress(inv));
    });
  }, 30000);
}
function gemProgress(inv) {
  const start = tsMs(inv.createdAt), mat = tsMs(inv.maturityDate);
  if (!start || !mat || mat <= start) return 1;
  return Math.min(1, Math.max(0, (Date.now() - start) / (mat - start)));
}
function daysLeft(inv) {
  const mat = tsMs(inv.maturityDate);
  const d = Math.ceil((mat - Date.now()) / 86400000);
  return d > 0 ? d : 0;
}
function fmtCountdown(ms) {
  if (ms <= 0) return 'moments';
  const d = Math.floor(ms / 86400000), h = Math.floor((ms % 86400000) / 3600000), m = Math.floor((ms % 3600000) / 60000);
  if (d > 0) return `${d}d ${h}h`;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
// ── LIVE NEXT-CASHBACK COUNTDOWN ──
// The payout moment is set by the SERVER (investment.nextPayoutAt, advanced by
// the payout cron); the app only displays the remaining time, ticking locally.
function nextPayoutMs(inv) {
  const t = tsMs(inv.nextPayoutAt);
  if (t) return t;
  // Legacy gems (created before the schedule existed): first payout is 24h
  // after purchase, then every 24h — same formula the server migrates them to.
  const start = tsMs(inv.createdAt);
  return start ? start + ((inv.payoutsMade || 0) + 1) * 86400000 : 0;
}
function fmtHMS(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const pad = n => String(n).padStart(2, '0');
  return (d > 0 ? d + 'd ' : '') + pad(h) + 'h ' + pad(m) + 'm ' + pad(sec) + 's';
}
function cashbackLineHtml(inv) {
  if (inv.status !== 'active') return '';
  const next = nextPayoutMs(inv);
  if (!next) return '';
  const daily = inv.dailyPayout || Math.round((inv.expectedReturn || 0) / (inv.cycle || 1));
  return `<div class="cd-line">Next cashback of <b>${ugx(daily)}</b> in <span class="cd" data-cdnext="${next}">${fmtHMS(next - Date.now())}</span></div>`;
}
let _cdTimer = null;
function startCountdownTick() {
  if (_cdTimer) return;
  _cdTimer = setInterval(() => {
    document.querySelectorAll('[data-cdnext]').forEach(el => {
      const t = parseInt(el.dataset.cdnext, 10);
      if (!t) return;
      const left = t - Date.now();
      el.textContent = left > 0 ? fmtHMS(left) : 'any moment now';
    });
  }, 1000);
}
function durPhrase(hours) {
  hours = Number(hours) || 0;
  return hours % 24 === 0 ? `${hours / 24} day${hours / 24 === 1 ? '' : 's'}` : `${hours} hours`;
}
// Boost cost = a percentage of the gem's total return (default 30%).
function boostCost(inv) {
  const pct = (_publicSettings?.boostCostPct != null) ? _publicSettings.boostCostPct : 0.30;
  return Math.round((inv.expectedReturn || 0) * pct);
}
// Boost eligibility for an active gem.
function boostState(inv) {
  if (inv.status !== 'active') return { kind: 'none' };
  if (inv.boosted) return { kind: 'boosted', ms: tsMs(inv.maturityDate) - Date.now() };
  const unlock = tsMs(inv.boostUnlockDate);
  if (unlock && Date.now() < unlock) return { kind: 'locked', days: Math.ceil((unlock - Date.now()) / 86400000) };
  return { kind: 'ready', cost: boostCost(inv) };
}
function boostRowHtml(inv) {
  const bs = boostState(inv);
  if (bs.kind === 'none') return '';
  if (bs.kind === 'ready')   return `<div class="ga-boost"><span class="bs hot">Ready to accelerate</span><button class="boost-btn" data-boost="${esc(inv.id)}">${ICN.boost} Boost ${ugx(bs.cost)}</button></div>`;
  if (bs.kind === 'boosted') return `<div class="ga-boost"><span class="bs hot">Boosted · matures in ${fmtCountdown(bs.ms)}</span></div>`;
  return `<div class="ga-boost"><span class="bs">Boost unlocks in ${bs.days} day${bs.days === 1 ? '' : 's'}</span></div>`;
}
function bindBoosts(scope) {
  (scope || document).querySelectorAll('[data-boost]').forEach(b =>
    b.addEventListener('click', () => openBoostModal(b.dataset.boost)));
}
function openBoostModal(invId) {
  const inv = _investments.find(i => i.id === invId);
  if (!inv) return;
  const days = _publicSettings?.boostMatureDays || 5;
  const pct  = Math.round(((_publicSettings?.boostCostPct != null) ? _publicSettings.boostCostPct : 0.30) * 100);
  const cost = boostCost(inv);
  openModal(`
    <div class="modal-head"><h2>Boost ${esc(inv.tierLabel || 'gem')}</h2><button class="modal-close">${ICN.close}</button></div>
    <div class="boost-hero">${ICN.boost}</div>
    <p class="boost-copy">Pay <b>${ugx(cost)}</b> (${pct}% of this gem's total return) to accelerate it. All the cashback still to come is then paid out over the next <b>${days} days</b> instead of the full period — your total payout of <b>${ugx(inv.expectedReturn)}</b> stays the same.</p>
    <div class="breakdown">
      <div class="br"><span class="muted">Boost cost (${pct}%)</span><span>${ugx(cost)}</span></div>
      <div class="br"><span class="muted">Your balance</span><span>${ugx(_account?.walletBalance || 0)}</span></div>
      <div class="br total"><span>Pays out over</span><span>${days} days</span></div>
    </div>
    <button class="btn" id="mSubmit">Boost now</button>
  `);
  document.getElementById('mSubmit').addEventListener('click', async () => {
    if ((_account?.walletBalance || 0) < cost) { closeModal(); return toast(`Need ${ugx(cost)} to boost`, 'err'); }
    const restore = setBusy(document.getElementById('mSubmit'), 'Please wait');
    const r = await api('/invest/boost', { method: 'POST', body: { investmentId: invId } });
    if (r.status !== 'success') { restore(); return toast(r.message || 'Could not boost', 'err'); }
    closeModal();
    toast(r.message || 'Boosted', 'ok');
    await loadAccount(); await loadTxns(); renderHome(); renderAccount();
  });
}
function openHoldingsModal() {
  const list = _investments.slice().sort((a, b) => tsMs(b.createdAt) - tsMs(a.createdAt));
  const rowHtml = inv => {
    const bs = boostState(inv);
    const matured = inv.status === 'matured' || inv.status === 'claimed';
    const badge = matured ? `<span class="badge on">Matured</span>`
      : inv.boosted ? `<span class="badge" style="background:#fff3e6;color:#c2410c">Boosted</span>`
      : `<span class="badge off">Active</span>`;
    let action = '';
    if (bs.kind === 'ready')   action = `<button class="boost-btn" style="margin-top:10px" data-boost="${esc(inv.id)}">${ICN.boost} Boost ${ugx(bs.cost)}</button>`;
    else if (bs.kind === 'boosted') action = `<div class="bs hot" style="margin-top:8px">Matures in ${fmtCountdown(bs.ms)}</div>`;
    else if (bs.kind === 'locked')  action = `<div class="bs" style="margin-top:8px">Boost unlocks in ${bs.days} day${bs.days === 1 ? '' : 's'}</div>`;
    return `<div class="hold-row"><div class="hold-top"><b>${esc(inv.tierLabel || 'Gem')}</b>${badge}</div>
      <div class="hold-sub">${ugx(inv.amount)} in · pays ${ugx(inv.expectedReturn)}</div>${cashbackLineHtml(inv)}${action}</div>`;
  };
  openModal(`
    <div class="modal-head"><h2>My gems</h2><button class="modal-close">${ICN.close}</button></div>
    ${list.length ? list.map(rowHtml).join('') : `<div class="empty-note">You have no gems yet. Buy one from the Gems tab.</div>`}
  `);
  bindBoosts(document.getElementById('modalRoot'));
}

const BANNER_SLIDES = [
  { bg: 'linear-gradient(120deg,#7c3aed 0%,#c026d3 100%)', art: '#e9d5ff', title: 'Grow your gems', sub: 'Buy a tier, get paid in full at maturity.' },
  { bg: 'linear-gradient(120deg,#0284c7 0%,#4338ca 100%)', art: '#bae6fd', title: 'Invite &amp; earn', sub: '35% on level 1, plus level 2 and 3.' },
  { bg: 'linear-gradient(120deg,#059669 0%,#0d9488 100%)', art: '#a7f3d0', title: 'Redeem a code', sub: 'Got a Furagemz code? Turn it into cash.' },
];
let _bannerTimer = null, _bannerIdx = 0;
function startBanner() {
  if (_bannerTimer) { clearInterval(_bannerTimer); _bannerTimer = null; }
  const track = document.getElementById('hbTrack');
  if (!track) return;
  const go = (i) => {
    _bannerIdx = (i + BANNER_SLIDES.length) % BANNER_SLIDES.length;
    track.querySelectorAll('.hb-slide').forEach((s, k) => s.classList.toggle('on', k === _bannerIdx));
    document.querySelectorAll('#hbDots i').forEach((d, k) => d.classList.toggle('on', k === _bannerIdx));
  };
  go(_bannerIdx % BANNER_SLIDES.length);  // resume position (real-time refresh re-renders home)
  _bannerTimer = setInterval(() => go(_bannerIdx + 1), 4500);
  document.querySelectorAll('#hbDots i').forEach((d, k) => d.addEventListener('click', () => go(k)));
}

function renderHome() {
  const el = document.getElementById('panel-home');
  const bal = _account?.walletBalance || 0;
  const checkedInToday = _account?.lastCheckinDate === new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
  const active = _investments.filter(i => i.status === 'active');
  const recent = _txns.slice(0, 5);

  el.innerHTML = `
    <div class="hero-banner">
      <div id="hbTrack">
        ${(() => {
          const imgs = (_publicSettings?.slideshowImages || []).filter(Boolean);
          if (imgs.length) return imgs.map(u => `<div class="hb-slide" style="background:#241640 center/cover no-repeat;background-image:url('${esc(u)}')"></div>`).join('');
          return BANNER_SLIDES.map(s => `
            <div class="hb-slide" style="background:${s.bg}">
              <div class="hb-title">${s.title}</div>
              <div class="hb-sub">${s.sub}</div>
              <div class="hb-art">${gemArt(s.art)}</div>
            </div>`).join('');
        })()}
      </div>
      <div class="hb-dots" id="hbDots">${((_publicSettings?.slideshowImages || []).filter(Boolean).length || BANNER_SLIDES.length) > 0 ? Array.from({length: (_publicSettings?.slideshowImages || []).filter(Boolean).length || BANNER_SLIDES.length}).map(() => '<i></i>').join('') : ''}</div>
    </div>
    ${_feed.length ? `
    <div class="ticker-head"><i class="live"></i><span>Live activity</span></div>
    <div class="ticker"><div class="ticker-track">${tickerItemsHtml()}</div></div>` : ''}
    <div class="wallet-panel">
      <div class="wallet-top">
        <span class="wallet-label">Total balance</span>
        <button class="wallet-eye" id="balEye">${_hideBal ? ICN.eyeOff : ICN.eye}</button>
      </div>
      <div class="wallet-amt" id="balAmt">${_hideBal ? '••••••' : ugx(bal)}</div>
    </div>
    <div class="wallet-stats">
      <div class="wstat"><div class="wi" style="background:var(--ok-bg);color:var(--ok)">${ICN.down}</div><div class="wn">${_hideBal ? '••••' : ugx(_account?.totalDeposited || 0)}</div><div class="wl">Total deposits</div></div>
      <div class="wstat"><div class="wi" style="background:var(--danger-bg);color:var(--danger)">${ICN.up}</div><div class="wn">${_hideBal ? '••••' : ugx(_account?.totalWithdrawn || 0)}</div><div class="wl">Total withdrawals</div></div>
      <div class="wstat"><div class="wi" style="background:#eef2ff;color:var(--sapphire)">${ICN.commission}</div><div class="wn">${_hideBal ? '••••' : ugx(_account?.commissionEarned || 0)}</div><div class="wl">Commissions</div></div>
    </div>
    <div class="quick-row">
      <button class="quick-btn" id="qaDeposit"><span class="qi" style="background:var(--ok-bg);color:var(--ok)">${ICN.down}</span>Deposit</button>
      <button class="quick-btn" id="qaWithdraw"><span class="qi" style="background:var(--danger-bg);color:var(--danger)">${ICN.up}</span>Withdraw</button>
      <button class="quick-btn" id="qaRedeem"><span class="qi" style="background:#f3e8ff;color:var(--violet)">${ICN.redeem}</span>Redeem</button>
      <button class="quick-btn${checkedInToday ? ' claimed' : ''}" id="qaCheckin"><span class="qi" style="background:#fef9e7;color:var(--topaz)">${ICN.checkin}</span>${checkedInToday ? 'Claimed' : 'Check in'}</button>
    </div>
    <div class="sec-head"><h3>Your gems</h3>${active.length ? `<button class="link-btn" data-tab-jump="gems">Buy more</button>` : ''}</div>
    ${active.length ? active.map(inv => `
      <div class="gem-active">
        <div class="ga-main">
          <div class="ring" data-inv="${esc(inv.id)}">${ringSvg(gemProgress(inv), 'var(--violet)')}</div>
          <div class="gem-active-info">
            <div class="t">${esc(inv.tierLabel || 'Gem')}</div>
            <div class="s">${inv.boosted ? 'Accelerating' : daysLeft(inv) + ' day' + (daysLeft(inv) === 1 ? '' : 's') + ' left'} · ${ugx(inv.amount)} in</div>
            <div class="p">Earns ${ugx(Math.round((inv.expectedReturn || 0) / (inv.cycle || 1)))} daily · ${ugx(inv.expectedReturn)} total</div>
          </div>
        </div>
        ${cashbackLineHtml(inv)}
        ${boostRowHtml(inv)}
      </div>`).join('') : `<div class="empty-note">No active gems yet. Buy your first one from the Gems tab.</div>`}
    <div class="sec-head"><h3>Recent activity</h3>${_txns.length ? `<button class="link-btn" data-tab-jump="account">See all</button>` : ''}</div>
    ${recent.length ? recent.map(txnRowHtml).join('') : `<div class="empty-note">No activity yet.</div>`}
  `;
  el.querySelector('#balEye').addEventListener('click', () => {
    _hideBal = !_hideBal;
    try { localStorage.setItem('fg_hide_bal', _hideBal ? '1' : '0'); } catch (_) {}
    renderHome();
  });
  el.querySelector('#qaDeposit').addEventListener('click', openDepositModal);
  el.querySelector('#qaWithdraw').addEventListener('click', openWithdrawModal);
  el.querySelector('#qaRedeem').addEventListener('click', openRedeemModal);
  if (!checkedInToday) el.querySelector('#qaCheckin').addEventListener('click', doCheckin);
  el.querySelectorAll('[data-tab-jump]').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tabJump)));
  bindBoosts(el);
  startBanner();
  animateRings();
  startRingTick();
}

// Premium record card — gradient icon chip, clean title, tag, amount + status pill.
const REC_META = {
  topup:         { label: 'Deposit',          grad: 'linear-gradient(135deg,#10b981,#059669)' },
  withdrawal:    { label: 'Withdrawal',        grad: 'linear-gradient(135deg,#fb7185,#e11d48)' },
  commission:    { label: 'Commission',        grad: 'linear-gradient(135deg,#818cf8,#6366f1)' },
  team_reward:   { label: 'Team reward',       grad: 'linear-gradient(135deg,#f472b6,#db2777)' },
  checkin:       { label: 'Daily bonus',       grad: 'linear-gradient(135deg,#fbbf24,#f59e0b)' },
  gem_payout:    { label: 'Gem payout',        grad: 'linear-gradient(135deg,#34d399,#0d9488)' },
  investment:    { label: 'Gem purchase',      grad: 'linear-gradient(135deg,#c084fc,#9333ea)' },
  boost:         { label: 'Gem boost',         grad: 'linear-gradient(135deg,#f59e0b,#ef4444)' },
  redeem:        { label: 'Code redeemed',     grad: 'linear-gradient(135deg,#a78bfa,#7c3aed)' },
  admin_credit:  { label: 'Credit',            grad: 'linear-gradient(135deg,#38bdf8,#2563eb)' },
  admin_debit:   { label: 'Adjustment',        grad: 'linear-gradient(135deg,#fb7185,#e11d48)' },
  refund:        { label: 'Refund',            grad: 'linear-gradient(135deg,#38bdf8,#0ea5e9)' },
};
function recMeta(type) { return REC_META[type] || { label: 'Transaction', grad: 'linear-gradient(135deg,#a78bfa,#7c3aed)' }; }
function statusInfo(s) {
  s = String(s || 'success').toLowerCase();
  if (['success', 'processed', 'matched'].includes(s)) return { label: 'Successful', cls: 'ok' };
  if (['pending', 'processing'].includes(s))           return { label: 'Processing', cls: 'proc' };
  if (['failed', 'cancelled', 'rejected'].includes(s)) return { label: 'Failed',     cls: 'bad' };
  return { label: s.charAt(0).toUpperCase() + s.slice(1), cls: 'mut' };
}
function recTag(t) {
  if (t.type === 'commission' && t.level) return `<span class="rec-tag">Level ${t.level} · ${Math.round((t.level === 1 ? 0.35 : t.level === 2 ? 0.02 : 0.01) * 100)}%</span>`;
  if (t.type === 'withdrawal' && (t.netAmount != null)) return `<span class="rec-tag">Received ${ugx(t.netAmount)}</span>`;
  if (t.type === 'redeem' && t.code) return `<span class="rec-tag">${esc(t.code)}</span>`;
  return '';
}
function txnRowHtml(t) {
  const amt = t.amount || 0;
  const sign = amt > 0 ? '+' : (amt < 0 ? '−' : '');
  const m = recMeta(t.type), st = statusInfo(t.status);
  return `<div class="rec">
    <div class="rec-ic" style="background:${m.grad}">${typeIcon(t.type)}</div>
    <div class="rec-body">
      <div class="rec-title">${esc(m.label)}</div>
      <div class="rec-meta">${esc(t.date || '')}${t.time ? ' · ' + esc(t.time) : ''}</div>
      ${recTag(t)}
    </div>
    <div class="rec-right">
      <div class="rec-amt ${amt >= 0 ? 'pos' : 'neg'}">${sign}${ugx(Math.abs(amt))}</div>
      <div class="rec-status ${st.cls}">${st.label}</div>
    </div>
  </div>`;
}

async function doCheckin() {
  const btn = document.getElementById('qaCheckin');
  const restore = setBusy(btn, 'Please wait');
  const r = await api('/checkin', { method: 'POST' });
  restore();
  if (r.status === 'success') {
    toast(`${ugx(r.bonus)} credited — day ${r.streak}`, 'ok');
    await loadAccount(); await loadTxns();
    renderHome(); renderAccount();
  } else {
    toast(r.message || 'Could not check in', 'err');
  }
}

// ══════════════════════════════════════════════
// DEPOSIT / WITHDRAW MODALS
// ══════════════════════════════════════════════
const DEPOSIT_CHIPS = [30000, 50000, 100000, 200000, 500000];
const WITHDRAW_CHIPS = [10000, 25000, 50000, 100000];
const WITHDRAW_FEE = 0.14;

function openDepositModal() {
  const phone0 = esc((_account?.phone || '').replace('+256', '0'));
  const minDep = _publicSettings?.minDeposit || 30000;
  openModal(`
    <div class="modal-head"><h2>Deposit</h2><button class="modal-close">${ICN.close}</button></div>
    <input id="mAmt" class="amt-big" type="number" inputmode="numeric" placeholder="0" min="${minDep}">
    <div class="amt-chips">${DEPOSIT_CHIPS.map(v => `<button class="amt-chip" data-amt="${v}">${Number(v).toLocaleString('en-UG')}</button>`).join('')}</div>
    <div class="field" style="margin-top:16px"><label>Mobile-money phone</label><input id="mPhone" type="tel" placeholder="0771234567" value="${phone0}"></div>
    <div class="info-note">
      <span class="in-ic">${ICN.info}</span>
      <div class="in-tx"><b>How to deposit.</b>
        <ol>
          <li>Enter the amount (minimum <b>${ugx(minDep)}</b>) and the phone number that holds your mobile money.</li>
          <li>Tap <b>Deposit</b> — a payment prompt is sent to that phone.</li>
          <li>Approve it with your mobile-money PIN. Your wallet updates here automatically once it clears.</li>
        </ol>
      </div>
    </div>
    <button class="btn" id="mSubmit">Deposit</button>
  `);
  const amtEl = document.getElementById('mAmt');
  document.querySelectorAll('#modalRoot .amt-chip').forEach(c =>
    c.addEventListener('click', () => { amtEl.value = c.dataset.amt; amtEl.focus(); }));
  document.getElementById('mSubmit').addEventListener('click', async () => {
    const amount = parseInt(amtEl.value, 10);
    const phone = document.getElementById('mPhone').value.trim();
    if (!amount || amount < minDep) return toast('Minimum deposit is ' + ugx(minDep), 'err');
    if (!phone) return toast('Enter a mobile-money phone number', 'err');
    const restore = setBusy(document.getElementById('mSubmit'), 'Please wait');
    const r = await api('/deposit/marzpay', { method: 'POST', body: { amount, phone } });
    if (r.status !== 'success') { restore(); return toast(r.message || 'Could not start deposit', 'err'); }
    openDepositPending(r.depositId, amount);
  });
}
const CHECK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
const XMARK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>';
// Deposit "polling" experience — a pulsing status while we confirm the payment,
// resolving in-place to a success or failed state (no blocking spinner).
function openDepositPending(depositId, amount) {
  const root = document.getElementById('modalRoot');
  root.innerHTML = `<div class="modal-backdrop"></div><div class="modal-card">
    <div class="pay-wait">
      <div class="pay-orb" id="payOrb">${ICN.phone}</div>
      <div class="pay-title" id="payTitle">Approve on your phone</div>
      <div class="pay-sub" id="paySub">Enter your mobile-money PIN to approve <b>${ugx(amount)}</b>. We'll confirm it here automatically.</div>
      <div class="pay-dots" id="payDots"><i></i><i></i><i></i></div>
    </div>
  </div>`;
  root.classList.remove('hidden');
  pollDepositUI(depositId, amount, 0);
}
async function pollDepositUI(depositId, amount, tries) {
  const r = await api('/deposit/status/' + depositId);
  const s = r.deposit?.depositStatus;
  if (s === 'matched') { depositResult('ok', r.deposit.creditedAmount || amount); await loadAccount(); await loadTxns(); renderHome(); renderAccount(); return; }
  if (s === 'failed')  { depositResult('bad', amount); return; }
  if (tries > 100)     { depositResult('slow', amount); return; }
  setTimeout(() => pollDepositUI(depositId, amount, tries + 1), 1200);
}
// Full-screen celebratory confetti: pieces rain from the top of the SCREEN,
// fluttering side-to-side with varied sizes, shapes, spin and speed — like real
// confetti falling — then clear on their own. Pure CSS particles, no emoji.
function fireConfetti() {
  const colors = ['#7c3aed', '#10b981', '#38bdf8', '#f43f5e', '#eab308', '#c084fc', '#fb7185', '#34d399'];
  const wrap = document.createElement('div'); wrap.className = 'confetti-sky';
  for (let i = 0; i < 100; i++) {
    const p = document.createElement('i');
    const w = 6 + Math.random() * 7;
    p.style.left = (Math.random() * 100) + 'vw';
    p.style.width = w + 'px';
    p.style.height = (i % 4 === 0 ? w : 4 + Math.random() * 8) + 'px';
    if (i % 4 === 0) p.style.borderRadius = '50%';           // some round pieces
    p.style.background = colors[i % colors.length];
    p.style.setProperty('--sway', (Math.random() * 180 - 90) + 'px');
    p.style.setProperty('--rot', (Math.random() * 1000 - 500) + 'deg');
    p.style.animationDuration = (2.4 + Math.random() * 1.8) + 's';
    p.style.animationDelay = (Math.random() * 0.8) + 's';
    wrap.appendChild(p);
  }
  document.body.appendChild(wrap);
  setTimeout(() => wrap.remove(), 5200);
}

function depositResult(kind, amount) {
  const orb = document.getElementById('payOrb'); if (!orb) return;
  const title = document.getElementById('payTitle'), sub = document.getElementById('paySub'), dots = document.getElementById('payDots');
  if (dots) dots.style.display = 'none';
  if (kind === 'ok')  { orb.className = 'pay-orb ok';  orb.innerHTML = CHECK_SVG; title.textContent = 'Successful!'; sub.innerHTML = `<b>${ugx(amount)}</b> has been added to your wallet.`; fireConfetti(); }
  else if (kind === 'bad') { orb.className = 'pay-orb bad'; orb.innerHTML = XMARK_SVG; title.textContent = 'Deposit not completed'; sub.textContent = 'The payment was not confirmed. If money left your account, contact support.'; }
  else { title.textContent = 'Still processing'; sub.textContent = 'This is taking a little longer. It will update on its own once confirmed.'; }
  const card = document.querySelector('#modalRoot .modal-card');
  if (card && !card.querySelector('#payDone')) {
    const b = document.createElement('button');
    b.className = 'btn'; b.id = 'payDone'; b.textContent = 'Done'; b.style.marginTop = '10px';
    b.addEventListener('click', closeModal);
    card.appendChild(b);
  }
}

function openWithdrawModal() {
  const bal = _account?.walletBalance || 0;
  const phone0 = esc((_account?.phone || '').replace('+256', '0'));
  const minW = _publicSettings?.minWithdrawal || 10000;
  const feeRate = (_publicSettings?.liquidityFee != null) ? _publicSettings.liquidityFee : WITHDRAW_FEE;
  const feePct = Math.round(feeRate * 100);
  openModal(`
    <div class="modal-head"><h2>Withdraw</h2><button class="modal-close">${ICN.close}</button></div>
    <div style="text-align:center;color:var(--sub);font-size:12.5px;margin-bottom:6px">Available ${ugx(bal)}</div>
    <input id="mAmt" class="amt-big" type="number" inputmode="numeric" placeholder="0" min="${minW}">
    <div class="amt-chips">${WITHDRAW_CHIPS.map(v => `<button class="amt-chip" data-amt="${v}">${Number(v).toLocaleString('en-UG')}</button>`)
      .join('')}<button class="amt-chip" data-amt="${bal}">All</button></div>
    <div class="breakdown" id="mBreak">
      <div class="br"><span class="muted">Amount</span><span id="brAmt">${ugx(0)}</span></div>
      <div class="br"><span class="muted">Service fee (${feePct}%)</span><span id="brFee">${ugx(0)}</span></div>
      <div class="br total"><span>You receive</span><span id="brNet">${ugx(0)}</span></div>
    </div>
    <div class="info-note">
      <span class="in-ic">${ICN.info}</span>
      <div class="in-tx"><b>How to withdraw.</b>
        <ol>
          <li>Minimum withdrawal is <b>${ugx(minW)}</b>. A <b>${feePct}%</b> service fee is deducted, so you receive the amount shown above.</li>
          <li>Money is sent to the mobile-money number you enter below. Save an account to reuse it next time.</li>
          <li>You must have activated at least one gem before you can withdraw. Requests are processed shortly after you submit.</li>
        </ol>
      </div>
    </div>
    ${(_account?.bankAccounts || []).length ? `<label style="font-size:13px;color:var(--sub);font-weight:600;display:block;margin-bottom:7px">Saved accounts</label>
      <div class="amt-chips" style="justify-content:flex-start;margin:0 0 12px">
        ${(_account.bankAccounts).map(a => `<button type="button" class="amt-chip bank-pick" data-phone="${esc(a.phone)}">${esc(a.holderName || a.network || 'Account')}</button>`).join('')}
      </div>` : ''}
    <div class="field"><label>Send to mobile-money phone</label><input id="mPhone" type="tel" placeholder="0771234567" value="${phone0}"></div>
    ${(_account?.totalInvested || 0) <= 0 ? `<div class="err-box" style="margin-bottom:14px">Activate at least one gem before you can withdraw.</div>` : ''}
    <button class="btn" id="mSubmit">Request withdrawal</button>
  `);
  document.querySelectorAll('#modalRoot .bank-pick').forEach(b => b.addEventListener('click', () => {
    document.getElementById('mPhone').value = '0' + b.dataset.phone;
  }));
  const amtEl = document.getElementById('mAmt');
  const recompute = () => {
    const a = parseInt(amtEl.value, 10) || 0;
    const fee = Math.round(a * feeRate);
    document.getElementById('brAmt').textContent = ugx(a);
    document.getElementById('brFee').textContent = '− ' + ugx(fee);
    document.getElementById('brNet').textContent = ugx(Math.max(0, a - fee));
  };
  amtEl.addEventListener('input', recompute);
  document.querySelectorAll('#modalRoot .amt-chip').forEach(c =>
    c.addEventListener('click', () => { amtEl.value = c.dataset.amt; recompute(); }));
  document.getElementById('mSubmit').addEventListener('click', async () => {
    const amount = parseInt(amtEl.value, 10);
    const phone = document.getElementById('mPhone').value.trim();
    if (!amount || amount < minW) return toast('Minimum withdrawal is ' + ugx(minW), 'err');
    if (amount > bal) return toast('That is more than your balance', 'err');
    if (!phone) return toast('Enter a mobile-money phone number', 'err');
    const restore = setBusy(document.getElementById('mSubmit'), 'Please wait');
    const r = await api('/withdraw/request', { method: 'POST', body: { amount, phone } });
    restore();
    if (r.status !== 'success') return toast(r.message || 'Could not submit withdrawal', 'err');
    closeModal();
    toast('Withdrawal submitted. Processing soon.', 'ok');
    await loadAccount(); await loadTxns(); renderHome(); renderAccount();
  });
}

function openRedeemModal() {
  openModal(`
    <div class="modal-head"><h2>Redeem a code</h2><button class="modal-close">${ICN.close}</button></div>
    <div class="field"><label>Enter your code</label>
      <input id="mCode" type="text" autocomplete="off" placeholder="XXXXXXXXXX" maxlength="10"
        style="text-transform:uppercase;letter-spacing:3px;text-align:center;font-weight:800;font-size:18px"></div>
    <div class="note" style="text-align:left;margin-bottom:14px">A code can be redeemed once per account. The reward lands straight in your wallet.</div>
    <button class="btn" id="mSubmit">Redeem code</button>
  `);
  document.getElementById('mSubmit').addEventListener('click', async () => {
    const code = document.getElementById('mCode').value.trim().toUpperCase();
    if (!code) return toast('Enter a code', 'err');
    const restore = setBusy(document.getElementById('mSubmit'), 'Please wait');
    const r = await api('/redeem', { method: 'POST', body: { code } });
    restore();
    if (r.status !== 'success') return toast(r.message || 'Could not redeem this code', 'err');
    closeModal();
    toast(r.message || 'Code redeemed', 'ok');
    await loadAccount(); await loadTxns(); renderHome(); renderAccount();
  });
}

// ══════════════════════════════════════════════
// GEMS
// ══════════════════════════════════════════════
const GEM_COLORS = { quartz: '#64748b', amethyst: '#c084fc', topaz: '#eab308', emerald: '#10b981', sapphire: '#0ea5e9', diamond: '#334155' };
function renderGems() {
  const el = document.getElementById('panel-gems');
  if (!_products.length) { el.innerHTML = `<div class="empty-note" style="margin-top:14px">Gem tiers not loaded yet.</div>`; loadProducts().then(renderGems); return; }
  el.innerHTML = `
    <div class="sec-head" style="margin-top:12px"><h3>Pick a gem to grow</h3></div>
    ${_products.map(p => {
      const color = p.color || GEM_COLORS[p.key] || '#7c3aed';
      const daily = Math.round(p.expectedReturn / (p.cycle || 1));
      const art = p.image ? `<img src="${esc(p.image)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:16px">` : gemArt(color);
      return `
      <div class="gem-hero" style="--accent:${color}">
        <div class="gh-head"><span class="gh-name">${esc(p.label)}</span><span class="gh-badge">Daily</span></div>
        <div class="gh-body">
          <div class="gh-art">${art}</div>
          <div class="gh-stats">
            <div class="ghs"><span>Price</span><b>${ugx(p.price)}</b></div>
            <div class="ghs"><span>Matures in</span><b>${p.cycle} days</b></div>
            <div class="ghs"><span>Daily value</span><b>${ugx(daily)}</b></div>
            <div class="ghs"><span>Total payout</span><b>${ugx(p.expectedReturn)}</b></div>
          </div>
        </div>
        <div class="gh-foot"><span class="gh-price">${ugx(p.price)}</span><button class="gh-buy" data-tier="${p.key}">Buy now</button></div>
      </div>`;
    }).join('')}
  `;
  el.querySelectorAll('.gh-buy').forEach(b => b.addEventListener('click', () => openGemDetail(b.dataset.tier)));
}
function openGemDetail(key) {
  const p = _products.find(t => t.key === key);
  if (!p) return;
  const bal = _account?.walletBalance || 0;
  openModal(`
    <div class="modal-head"><h2>${esc(p.label)}</h2><button class="modal-close">${ICN.close}</button></div>
    ${p.image ? `<img src="${esc(p.image)}" alt="" style="width:100%;height:150px;object-fit:cover;border-radius:16px;margin-bottom:16px">`
      : `<div class="gem-swatch" style="background:${p.color || GEM_COLORS[p.key] || 'var(--violet)'};width:56px;height:56px;border-radius:16px;margin-bottom:16px"></div>`}
    <div class="stat-row">
      <div class="stat-box"><div class="n">${ugx(Math.round(p.expectedReturn / (p.cycle || 1)))}</div><div class="l">Daily cashback</div></div>
      <div class="stat-box"><div class="n">${ugx(p.expectedReturn)}</div><div class="l">Total payout</div></div>
      <div class="stat-box"><div class="n">${p.cycle}d</div><div class="l">Runs for</div></div>
    </div>
    <div class="info-note" style="margin:16px 0">
      <span class="in-ic">${ICN.info}</span>
      <div class="in-tx">You earn <b>${ugx(Math.round(p.expectedReturn / (p.cycle || 1)))}</b> every 24 hours, starting one day after you buy, for <b>${p.cycle} days</b> — <b>${ugx(p.expectedReturn)}</b> in total, paid straight to your wallet. Your balance: ${ugx(bal)}.</div>
    </div>
    <button class="btn" id="mSubmit">Buy for ${ugx(p.price)}</button>
  `);
  document.getElementById('mSubmit').addEventListener('click', async () => {
    if (bal < p.price) { closeModal(); return toast(`Need ${ugx(p.price)}, you have ${ugx(bal)}`, 'err'); }
    const restore = setBusy(document.getElementById('mSubmit'), 'Please wait');
    const r = await api('/invest/create', { method: 'POST', body: { tierKey: key } });
    if (r.status !== 'success') { restore(); return toast(r.message || 'Purchase failed', 'err'); }
    closeModal();
    toast(r.message || 'Gem purchased', 'ok');
    await loadAccount(); renderHome();
  });
}

// ══════════════════════════════════════════════
// TEAM
// ══════════════════════════════════════════════
function referralLink(code) {
  try { return location.origin + location.pathname.replace(/index\.html$/, '') + '?ref=' + encodeURIComponent(code); }
  catch (_) { return 'https://furagemz.com/?ref=' + code; }
}
function commPct(level) {
  const s = _publicSettings || {};
  const raw = level === 1 ? (s.commL1 ?? 0.35) : level === 2 ? (s.commL2 ?? 0.02) : (s.commL3 ?? 0.01);
  return Math.round(raw * 100);
}
function renderTeam() {
  const el = document.getElementById('panel-team');
  const code = _account?.referralCode || _account?.username || '—';
  const link = code !== '—' ? referralLink(code) : '';
  const ts = _teamStats;
  const l1Total = ts?.l1DepositTotal || 0;
  const totalTeamEarn = (ts?.earned?.commissions || _account?.commissionEarned || 0) + (ts?.earned?.teamRewards || 0);
  const LVL = [
    { n: 1, count: ts?.counts?.l1 ?? _account?.teamL1Count ?? 0, earned: ts?.earned?.l1 || 0, tint: '#7c3aed', bg: '#f3e8ff' },
    { n: 2, count: ts?.counts?.l2 ?? _account?.teamL2Count ?? 0, earned: ts?.earned?.l2 || 0, tint: '#0ea5e9', bg: '#e0f2fe' },
    { n: 3, count: ts?.counts?.l3 ?? _account?.teamL3Count ?? 0, earned: ts?.earned?.l3 || 0, tint: '#059669', bg: '#d1fae5' },
  ];
  el.innerHTML = `
    <div class="team-hero">
      <div class="th-top">
        <div>
          <div class="th-label">Team earnings</div>
          <div class="th-amt">${ugx(totalTeamEarn)}</div>
        </div>
        <div class="th-art">${gemArt('#ffffff')}</div>
      </div>
      <div class="th-code-row">
        <div class="th-code"><span>Code</span><b>${esc(code)}</b></div>
        <button class="th-btn" id="copyRef">${ICN.copy} Copy link</button>
        <button class="th-btn solid" id="shareRef">Share</button>
      </div>
    </div>

    <div class="lvl-list">
      ${LVL.map(l => `
        <div class="lvl-row">
          <div class="lvl-badge" style="background:${l.bg};color:${l.tint}">L${l.n}</div>
          <div class="lvl-info">
            <div class="t">Level ${l.n} · earns ${commPct(l.n)}% of every gem</div>
            <div class="s">${l.count} member${l.count === 1 ? '' : 's'}</div>
          </div>
          <div class="lvl-earn">${ugx(l.earned)}</div>
        </div>`).join('')}
    </div>

    <div class="sec-head"><h3>Task centre</h3></div>
    <div class="task-intro">Your level 1 team has deposited <b>${ugx(l1Total)}</b> so far. Hit each target below and the reward drops into your wallet instantly.</div>
    ${(ts?.milestones || TEAM_MILESTONES).map(m => {
      const pct = Math.min(100, Math.round((l1Total / m.target) * 100));
      return `
      <div class="task-row${m.paid ? ' done' : ''}">
        <div class="task-ic">${ICN.award}</div>
        <div class="task-body">
          <div class="task-t">Team deposits reach ${ugx(m.target)}</div>
          <div class="task-bar"><i style="width:${pct}%"></i></div>
          <div class="task-s">${m.paid ? 'Reward paid to your wallet' : pct + '% there'}</div>
        </div>
        <div class="task-reward">${m.paid ? `<span class="task-paid">${CHECK_SVG}</span>` : `<b>${ugx(m.reward)}</b>`}</div>
      </div>`;
    }).join('')}

    <div class="sec-head"><h3>Direct referrals</h3></div>
    ${_members.length ? _members.map(m => `
      <div class="member-row">
        <div class="avatar" style="background:${tickColor(m.name)}">${esc(initials(m.name))}</div>
        <div class="member-info">
          <div class="t">${esc(m.name)}</div>
          <div class="s">${m.joinedAt ? timeAgo(new Date(m.joinedAt).getTime()) : ''}</div>
        </div>
        <div class="badge ${m.hasInvested ? 'on' : 'off'}">${m.hasInvested ? 'Invested' : 'New'}</div>
      </div>`).join('') : `<div class="empty-note">Share your code — nobody has joined yet.</div>`}
  `;
  const copyBtn = el.querySelector('#copyRef');
  if (copyBtn) copyBtn.addEventListener('click', () => {
    navigator.clipboard?.writeText(link).then(() => toast('Referral link copied', 'ok')).catch(() => toast(link));
  });
  const linkEl = el.querySelector('#refLink');
  if (linkEl) linkEl.addEventListener('click', () => {
    navigator.clipboard?.writeText(link).then(() => toast('Referral link copied', 'ok')).catch(() => {});
  });
  const shareBtn = el.querySelector('#shareRef');
  if (shareBtn) shareBtn.addEventListener('click', async () => {
    const text = `Join me on Furagemz and grow your gems. Use my link: ${link}`;
    if (navigator.share) { try { await navigator.share({ title: 'Furagemz', text, url: link }); } catch (_) {} }
    else navigator.clipboard?.writeText(link).then(() => toast('Referral link copied', 'ok')).catch(() => {});
  });
}

// ══════════════════════════════════════════════
// ACCOUNT
// ══════════════════════════════════════════════
const TXN_FILTERS = [
  { key: 'all',         label: 'All',          types: null },
  { key: 'deposits',    label: 'Deposits',     types: ['topup', 'admin_credit'] },
  { key: 'withdrawals', label: 'Withdrawals',  types: ['withdrawal', 'refund'] },
  { key: 'commissions', label: 'Commissions',  types: ['commission', 'team_reward'] },
  { key: 'bonuses',     label: 'Bonuses',      types: ['checkin', 'redeem'] },
];
function renderAccount() {
  const el = document.getElementById('panel-account');
  const rc = _account?.referralCode || '';
  const code = rc ? `<span class="acc-code" id="accCode">CODE ${esc(rc)} ${ICN.copy}</span>` : '';
  el.innerHTML = `
    <div class="acc-card">
      <div class="acc-top">
        <div class="acc-av">${esc(initials(_account?.name))}</div>
        <div>
          <div class="acc-name">${esc(_account?.name || 'Furagemz user')}</div>
          <div class="acc-phone">${esc(_account?.phone || '')}</div>
          ${code}
        </div>
      </div>
      <div class="acc-stats">
        <div class="as"><div class="n">${ugx(_account?.totalDeposited || 0)}</div><div class="l">Deposited</div></div>
        <div class="as"><div class="n">${ugx(_account?.totalEarned || 0)}</div><div class="l">Earned</div></div>
        <div class="as"><div class="n">${ugx(_account?.totalWithdrawn || 0)}</div><div class="l">Withdrawn</div></div>
      </div>
      <div class="acc-tier">${ICN.gem} Furagemz member</div>
    </div>
    <div class="menu-list">
      <button class="menu-row" id="mnRedeem"><span class="mi">${ICN.redeem}</span><span class="ml">Redeem a code</span><span class="mr">${ICN.chevron}</span></button>
      <button class="menu-row" id="mnHistory"><span class="mi">${ICN.receipt}</span><span class="ml">Transaction history</span><span class="mr">${ICN.chevron}</span></button>
      <button class="menu-row" id="mnGems"><span class="mi">${ICN.gem}</span><span class="ml">My gems</span><span class="mr">${ICN.chevron}</span></button>
      <button class="menu-row" id="mnTeam"><span class="mi">${ICN.people}</span><span class="ml">Referrals &amp; team</span><span class="mr">${ICN.chevron}</span></button>
    </div>
    <div class="menu-list">
      <button class="menu-row" id="mnBanks"><span class="mi">${ICN.bank}</span><span class="ml">Withdrawal accounts</span><span class="mr">${ICN.chevron}</span></button>
      <button class="menu-row" id="mnPassword"><span class="mi">${ICN.lock}</span><span class="ml">Change password</span><span class="mr">${ICN.chevron}</span></button>
      <button class="menu-row" id="mnSupport"><span class="mi">${ICN.support}</span><span class="ml">Contact support</span><span class="mr">${ICN.chevron}</span></button>
      <button class="menu-row" id="mnDownload"><span class="mi">${ICN.download}</span><span class="ml">Download app</span><span class="mr">${ICN.chevron}</span></button>
      <button class="menu-row" id="mnAbout"><span class="mi">${ICN.about}</span><span class="ml">About Furagemz</span><span class="mr">${ICN.chevron}</span></button>
    </div>
    <div class="menu-list">
      <button class="menu-row danger" id="logoutBtn"><span class="mi">${ICN.logout}</span><span class="ml">Log out</span></button>
    </div>
  `;
  const accCode = el.querySelector('#accCode');
  if (accCode) accCode.addEventListener('click', () => {
    try { navigator.clipboard.writeText(rc); toast('Code copied'); } catch (e) {}
  });
  el.querySelector('#mnRedeem').addEventListener('click', openRedeemModal);
  el.querySelector('#mnHistory').addEventListener('click', openHistoryModal);
  el.querySelector('#mnGems').addEventListener('click', openHoldingsModal);
  el.querySelector('#mnTeam').addEventListener('click', () => switchTab('team'));
  el.querySelector('#mnBanks').addEventListener('click', openBanksModal);
  el.querySelector('#mnPassword').addEventListener('click', openPasswordModal);
  el.querySelector('#mnSupport').addEventListener('click', openSupportModal);
  el.querySelector('#mnDownload').addEventListener('click', openDownloadModal);
  el.querySelector('#mnAbout').addEventListener('click', openAboutModal);
}

// Download / install screen — app details are server-driven (settings/public).
function openDownloadModal() {
  const s = _publicSettings || {};
  const installed = isInstalled();
  openModal(`
    <div class="modal-head"><h2>Download app</h2><button class="modal-close">${ICN.close}</button></div>
    <div class="about-hero">
      <div class="about-logo">${FG_LOGO}</div>
      <div class="about-name">Furagemz</div>
      <div class="about-tag">Install Furagemz on your phone</div>
    </div>
    <div class="dl-meta">
      <div class="dl-row"><span>Version</span><b>${esc(s.appVersion || '1.0.0')}</b></div>
      <div class="dl-row"><span>Developer</span><b>${esc(s.appDeveloper || 'Furagemz Developers')}</b></div>
      <div class="dl-row"><span>Size</span><b>${esc(s.appSize || '—')}</b></div>
      <div class="dl-row"><span>Platform</span><b>Android · iPhone · Web</b></div>
    </div>
    ${installed
      ? `<div class="info-note"><span class="in-ic">${ICN.info}</span><div class="in-tx">Furagemz is already installed on this device. Open it from your home screen.</div></div>`
      : `<button class="btn" id="dlInstall">${ICN.download} Install Furagemz</button>
         <div class="info-note" style="margin-top:14px"><span class="in-ic">${ICN.info}</span><div class="in-tx">If the install button does nothing, open your browser menu and tap <b>Add to Home screen</b> (or <b>Install app</b>).</div></div>`}
  `);
  const btn = document.getElementById('dlInstall');
  if (btn) btn.addEventListener('click', async () => {
    if (_installPrompt) {
      _installPrompt.prompt();
      try { await _installPrompt.userChoice; } catch (_) {}
      _installPrompt = null;
      closeModal();
    } else {
      toast('Open your browser menu → Add to Home screen', '');
    }
  });
}

// About page — content is admin-managed (settings.aboutText). Falls back to a
// short default so the page is never empty before the admin writes their own.
function openAboutModal() {
  const raw = (_publicSettings?.aboutText || '').trim();
  const tagline = _publicSettings?.brandTagline || 'Grow your money with gems.';
  const paras = raw
    ? raw.split(/\n{2,}|\r\n\r\n/).map(p => `<p>${esc(p.trim()).replace(/\n/g, '<br>')}</p>`).join('')
    : `<p>Furagemz is a mobile-money savings and rewards platform. You buy a gem tier, and it pays out in full when it matures — a simple, fixed return with no daily claiming.</p>
       <p>Invite friends with your referral code to earn rewards across three levels, redeem codes for instant wallet credit, and check in daily for a bonus.</p>`;
  openModal(`
    <div class="modal-head"><h2>About Furagemz</h2><button class="modal-close">${ICN.close}</button></div>
    <div class="about-hero">
      <div class="about-logo">${FG_LOGO}</div>
      <div class="about-name">Furagemz</div>
      <div class="about-tag">${esc(tagline)}</div>
    </div>
    <div class="about-body">${paras}</div>
  `);
}

function bankRowsHtml(accounts, withRemove) {
  if (!accounts.length) return `<div class="empty-note">No saved accounts yet.</div>`;
  return accounts.map(a => `
    <div class="bank-row" data-phone="${esc(a.phone)}">
      <span class="mi" style="background:#eef2ff;color:var(--sapphire)">${ICN.bank}</span>
      <div class="bank-info"><div class="t">${esc(a.holderName || a.label || 'Account')}</div><div class="s">${esc(a.network || '')} · 0${esc(a.phone)}</div></div>
      ${withRemove ? `<button class="bank-del" data-del="${esc(a.phone)}">${ICN.trash}</button>` : ''}
    </div>`).join('');
}
function openBanksModal() {
  const accounts = _account?.bankAccounts || [];
  openModal(`
    <div class="modal-head"><h2>Withdrawal accounts</h2><button class="modal-close">${ICN.close}</button></div>
    <div class="support-body" id="bankList">${bankRowsHtml(accounts, true)}</div>
    <div style="border-top:1px solid var(--line2);margin:16px 0 4px"></div>
    <div class="field"><label>Account holder full name</label><input id="bkName" type="text" placeholder="Name registered on the SIM"></div>
    <div class="field"><label>Mobile-money number</label><input id="bkPhone" type="tel" inputmode="numeric" placeholder="0771234567"></div>
    <button class="btn" id="bkAdd">Save account</button>
  `);
  const refresh = async () => {
    await loadAccount();
    document.getElementById('bankList').innerHTML = bankRowsHtml(_account?.bankAccounts || [], true);
    bindBankDeletes();
  };
  const bindBankDeletes = () => {
    document.querySelectorAll('#bankList [data-del]').forEach(b => b.addEventListener('click', async () => {
      const r = await api('/account/remove-bank', { method: 'POST', body: { phone: b.dataset.del } });
      if (r.status !== 'success') return toast(r.message || 'Could not remove', 'err');
      toast('Account removed', 'ok'); refresh();
    }));
  };
  bindBankDeletes();
  document.getElementById('bkAdd').addEventListener('click', async () => {
    const holderName = document.getElementById('bkName').value.trim();
    const phone = document.getElementById('bkPhone').value.trim();
    if (!holderName) return toast('Enter the account holder full name', 'err');
    if (!phone) return toast('Enter a mobile-money number', 'err');
    const restore = setBusy(document.getElementById('bkAdd'), 'Please wait');
    const r = await api('/account/add-bank', { method: 'POST', body: { holderName, phone } });
    restore();
    if (r.status !== 'success') return toast(r.message || 'Could not save', 'err');
    document.getElementById('bkName').value = ''; document.getElementById('bkPhone').value = '';
    toast('Account saved', 'ok'); refresh();
  });
}

function openPasswordModal() {
  openModal(`
    <div class="modal-head"><h2>Change password</h2><button class="modal-close">${ICN.close}</button></div>
    <div class="field"><label>Current password</label><input id="pwCur" type="password" placeholder="Current password"></div>
    <div class="field"><label>New password</label><input id="pwNew" type="password" placeholder="At least 6 characters"></div>
    <div class="field"><label>Confirm new password</label><input id="pwNew2" type="password" placeholder="Re-enter new password"></div>
    <button class="btn" id="mSubmit">Update password</button>
  `);
  document.getElementById('mSubmit').addEventListener('click', async () => {
    const cur = document.getElementById('pwCur').value;
    const nw = document.getElementById('pwNew').value;
    const nw2 = document.getElementById('pwNew2').value;
    if (!cur || !nw) return toast('Fill in both password fields', 'err');
    if (nw.length < 6) return toast('New password must be at least 6 characters', 'err');
    if (nw !== nw2) return toast('The new passwords do not match', 'err');
    const restore = setBusy(document.getElementById('mSubmit'), 'Please wait');
    try {
      const cred = EmailAuthProvider.credential(_user.email, cur);
      await reauthenticateWithCredential(_user, cred);
      await updatePassword(_user, nw);
      closeModal();
      toast('Password updated', 'ok');
    } catch (err) {
      restore();
      const msg = /wrong-password|invalid-credential/.test(err.code || '') ? 'Current password is incorrect' : (err.message || 'Could not update password');
      toast(msg, 'err');
    }
  });
}

// Admin may type a bare phone number or a full link — always produce a real, clickable URL.
function waLink(v) {
  v = String(v || '').trim();
  if (!v) return '';
  if (/^https?:\/\//i.test(v)) return v;
  const digits = v.replace(/\D/g, '');
  return digits ? `https://wa.me/${digits}` : '';
}
function tgLink(v) {
  v = String(v || '').trim();
  if (!v) return '';
  if (/^https?:\/\//i.test(v)) return v;
  return `https://t.me/${v.replace(/^@/, '')}`;
}

function openSupportModal() {
  const s = _publicSettings || {};
  const wa = waLink(s.supportWhatsapp || '');
  const tg = tgLink(s.supportTelegram || '');
  const hours = s.supportHours || 'Every day, 9:00 AM – 9:00 PM';
  openModal(`
    <div class="modal-head"><h2>Contact support</h2><button class="modal-close">${ICN.close}</button></div>
    <div class="support-body">
      ${wa ? `<a class="support-row" href="${esc(wa)}" target="_blank" rel="noopener"><span class="mi" style="background:var(--ok-bg);color:var(--ok)">${ICN.support}</span><span><b>WhatsApp</b><br><span class="s">Tap to open</span></span></a>` : ''}
      ${tg ? `<a class="support-row" href="${esc(tg)}" target="_blank" rel="noopener"><span class="mi" style="background:#eef2ff;color:var(--sapphire)">${ICN.telegram}</span><span><b>Telegram group</b><br><span class="s">Tap to open</span></span></a>` : ''}
      <div class="support-row" style="cursor:default"><span class="mi" style="background:#fef9e7;color:var(--topaz)">${ICN.clock}</span><span><b>Support hours</b><br><span class="s">${esc(hours)}</span></span></div>
      ${!wa && !tg ? `<div class="empty-note">Support contacts have not been set yet.</div>` : ''}
    </div>
  `);
}

function openHistoryModal() {
  if (!TXN_FILTERS.some(x => x.key === _txnFilter)) _txnFilter = 'all';
  // Money in / Money out are lifetime totals across ALL SUCCESSFUL transactions —
  // failed/pending attempts (e.g. a declined deposit) appear in the list with
  // their status but never count into the totals.
  let inSum = 0, outSum = 0;
  _txns.forEach(t => {
    const st = String(t.status || 'success').toLowerCase();
    if (!['success', 'processed', 'matched'].includes(st)) return;
    const a = t.amount || 0; if (a >= 0) inSum += a; else outSum += -a;
  });
  // Build the page ONCE. Tapping a filter chip only re-renders the list + chip
  // state below — the page never re-mounts, so there's no reload/flash.
  openModal(`
    <div class="modal-head"><h2>Records</h2><button class="modal-close">${ICN.close}</button></div>
    <div class="rec-summary">
      <div class="rs in"><div class="rs-l">Money in</div><div class="rs-n">${ugx(inSum)}</div></div>
      <div class="rs out"><div class="rs-l">Money out</div><div class="rs-n">${ugx(outSum)}</div></div>
    </div>
    <div class="chips rec-chips" id="recChips">${TXN_FILTERS.map(x => `<button class="chip${_txnFilter === x.key ? ' active' : ''}" data-filter="${x.key}">${x.label}</button>`).join('')}</div>
    <div class="rec-list" id="recList"></div>
  `);
  const listEl = document.getElementById('recList');
  const drawList = () => {
    const f = TXN_FILTERS.find(x => x.key === _txnFilter) || TXN_FILTERS[0];
    const filtered = f.types ? _txns.filter(t => f.types.includes(t.type)) : _txns;
    listEl.innerHTML = filtered.length ? filtered.map(txnRowHtml).join('') : `<div class="empty-note">No records here yet.</div>`;
  };
  document.querySelectorAll('#recChips [data-filter]').forEach(chip => {
    chip.addEventListener('click', () => {
      _txnFilter = chip.dataset.filter;
      document.querySelectorAll('#recChips [data-filter]').forEach(c => c.classList.toggle('active', c.dataset.filter === _txnFilter));
      drawList();
    });
  });
  drawList();
}
