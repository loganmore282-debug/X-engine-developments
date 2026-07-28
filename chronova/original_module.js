import { initializeApp, getApps }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signInWithCustomToken, onAuthStateChanged, signOut, updatePassword, reauthenticateWithCredential, EmailAuthProvider }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

// CHRONOVA — Firebase web config (public client config, safe to embed).
const firebaseConfig = {
  apiKey:            "AIzaSyDOwA8dGvLGGtj6wkAqh0-7EZ2u5cHSW7k",
  authDomain:        "chronovaplatform.firebaseapp.com",
  projectId:         "chronovaplatform",
  storageBucket:     "chronovaplatform.firebasestorage.app",
  messagingSenderId: "432567199816",
  appId:             "1:432567199816:web:64842f35909b1075ad107d",
  measurementId:     "G-08J2C1Y663"
};

// Chronova Render backend.
const SERVER = 'https://education-oc44.onrender.com';

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
window.addEventListener('appinstalled', () => { _installPrompt = null; try { toast('Chronova installed'); } catch (_) {} });
function isInstalled() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

// ── STATE ──
let _user = null, _account = null, _investments = [], _members = [], _txns = [], _products = [];
let _deposits = [], _withdrawals = [];
let _booting = false;   // first load in flight: panels show the loader, not zeros
let _activeTab = 'home';
let _hideBal = false;
try { _hideBal = localStorage.getItem('fg_hide_bal') === '1'; } catch (_) {}

// ── SVG ICONS ──
const _svg = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const ICN = {
  topup:        _svg('<rect x="3" y="8" width="18" height="12" rx="2"/><path d="M7 8V6a5 5 0 0 1 10 0v2"/><path d="M12 12v4"/><path d="M9.5 14.5 12 17l2.5-2.5"/>'),
  withdrawal:   _svg('<rect x="3" y="8" width="18" height="12" rx="2"/><path d="M7 8V6a5 5 0 0 1 10 0v2"/><path d="M12 17v-4"/><path d="M9.5 14.5 12 12l2.5 2.5"/>'),
  investment:   _svg('<circle cx="12" cy="12" r="8"/><path d="M12 8v4l2.6 1.6"/><path d="M9 2h6M9 22h6"/>'),
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
  gem:          _svg('<circle cx="12" cy="12" r="8"/><path d="M12 8v4l2.6 1.6"/><path d="M9 2h6M9 22h6"/>'),
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
  bell:         _svg('<path d="M6 8a6 6 0 0 1 12 0c0 4 1.5 5.5 2 6H4c.5-.5 2-2 2-6z"/><path d="M9.5 19a2.5 2.5 0 0 0 5 0"/>'),
};

// Faceted emerald-cut watch illustration, tinted to any tier colour. Layered
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
    topup: 'var(--emerald)', gem_payout: 'var(--ok)', product_income: 'var(--ok)', commission: 'var(--gold)',
    checkin: 'var(--topaz)', withdrawal: 'var(--ruby)', admin_debit: 'var(--ruby)',
    investment: 'var(--gold)', refund: 'var(--emerald)', admin_credit: 'var(--gold)',
    redeem: 'var(--gold)', team_reward: 'var(--gold-deep)'
  };
  return map[t] || 'var(--gold)';
}

// ── UTILS ──
function ugx(n) { return 'UGX ' + Number(n || 0).toLocaleString('en-UG'); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) {
    // No name on the account — fall back to the last two digits of the phone
    // rather than a hardcoded letter.
    const d = String(_account?.phone || '').replace(/\D/g, '');
    return d ? d.slice(-2) : 'CH';
  }
  return ((parts[0][0] || '') + (parts[1]?.[0] || '')).toUpperCase();
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

// A single dark slab that opens out of the centre of the screen, holds, then
// folds away. Deliberately colourless: the message carries the meaning, not a
// green or red background.
const SVG_TOAST_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5 9.5 18 20 6.5"/></svg>';
// ok=true adds the small checkmark above the message, for a clear confirmation
// like a successful login — everything else stays the plain colourless slab.
function toast(msg, ok) {
  const root = document.getElementById('toastRoot');
  root.querySelectorAll('.toast').forEach(t => t.remove());
  const el = document.createElement('div');
  el.className = 'toast' + (ok ? ' has-check' : '');
  el.innerHTML = (ok ? `<span class="toast-check">${SVG_TOAST_CHECK}</span>` : '') +
                 `<span class="toast-in">${esc(msg)}</span>`;
  root.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 260); }, 2400);
}

// Disable a button while a request is in flight and show an animated three-dot
// loader (no "Please wait" / "Loading…" text anywhere).
// The house loader: twelve spokes fading around a ring. One markup string, used
// by every busy state so nothing anywhere spins differently.
const SPINNER = '<span class="spin">' + '<i></i>'.repeat(12) + '</span>';

function setBusy(btn) {
  if (!btn) return () => {};
  const prevHTML = btn.innerHTML, prevDisabled = btn.disabled;
  btn.disabled = true;
  btn.innerHTML = SPINNER;
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
  document.body.classList.add('no-scroll'); // freeze the dashboard behind the dialog
  root.querySelector('[data-close]').addEventListener('click', () => closeModal());
  const closeBtn = root.querySelector('.modal-close');
  if (closeBtn) { closeBtn.innerHTML = SVG_CLOSE; closeBtn.addEventListener('click', () => closeModal()); }
  if (!_pageOpen) { _pageOpen = true; try { history.pushState({ fgPage: 1 }, ''); } catch (_) {} }
}
function closeModal(fromPop) {
  const root = document.getElementById('modalRoot');
  root.classList.add('hidden');
  root.innerHTML = '';
  document.body.classList.remove('no-scroll');
  if (_pageOpen) {
    _pageOpen = false;
    if (!fromPop) { try { history.back(); } catch (_) {} }
  }
}
window.addEventListener('popstate', () => { if (_pageOpen) closeModal(true); });

function phoneToEmail(phone) { return String(phone).replace(/\D/g, '') + '@chronova-app.com'; }
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
const NO_RETRY = ['/deposit', '/invest/', '/withdraw/request', '/checkin', '/register', '/redeem', '/deposit/card'];
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
  document.getElementById('authView').classList.toggle('hidden', name !== 'auth');
  document.getElementById('mainView').classList.toggle('hidden', name !== 'main');
  // Remember on THIS device that the user reached the dashboard, so next launch
  // skips the login screen and auto-syncs straight in.
  try {
    if (name === 'main') localStorage.setItem('fg_wasAuthed', '1');
    else if (name === 'auth') localStorage.removeItem('fg_wasAuthed');
  } catch (_) {}
}

// Auth screen now uses the clean centered clock logo (no decorative art).
const _a1 = document.getElementById('authArt1'); if (_a1) _a1.innerHTML = '';
const _a2 = document.getElementById('authArt2'); if (_a2) _a2.innerHTML = '';

// ── Jumbled-letter captcha ──
let _captchaId = null;
async function loadCaptcha() {
  const box = document.getElementById('captchaBox');
  if (!box) return;
  box.innerHTML = '<span style="color:#b9a9d6">…</span>';
  const r = await api('/auth/captcha', { method: 'POST' });
  if (r.status !== 'success') { box.innerHTML = '<span style="color:var(--sub)">try again</span>'; return; }
  _captchaId = r.captchaId;
  const cols = ['#8a6418', '#a97f22', '#c9932e', '#b8862b', '#96701d', '#d9ad4e'];
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
  document.getElementById('authErr').classList.add('hidden');
  document.querySelector('.auth-view').classList.toggle('mode-register', !login);
  document.querySelector('.auth-scroll').scrollTop = 0;
}
document.getElementById('toRegister').addEventListener('click', () => setAuthMode('register'));
document.getElementById('toLogin').addEventListener('click', () => setAuthMode('login'));
{ const _f = document.getElementById('toForgot');
  if (_f) _f.addEventListener('click', () => toast('To reset your password, contact Customer Service on the account page.')); }
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

// Capture a referral code from ?ref= the INSTANT the app opens and store it
// durably. This is what stops "joined by a link but not recorded": if the user
// installs the PWA or reopens later (when the URL no longer carries ?ref=), the
// stored code is still applied at sign-up. Prefill the field from the URL or,
// failing that, from the stored code.
(() => {
  try {
    let ref = new URLSearchParams(location.search).get('ref');
    if (ref) { ref = ref.trim(); try { localStorage.setItem('fg_pending_ref', ref); } catch (_) {} }
    if (!ref) { try { ref = (localStorage.getItem('fg_pending_ref') || '').trim(); } catch (_) {} }
    const el = document.getElementById('rgRef');
    if (ref && el && !el.value) el.value = ref;
  } catch (_) {}
})();

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
    toast('Login successful', true);
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
  let ref = document.getElementById('rgRef').value.trim();
  // If the field was somehow empty (PWA reopen cleared it), fall back to the code
  // we stored the moment the link was opened — never silently lose the referral.
  if (!ref) { try { ref = (localStorage.getItem('fg_pending_ref') || '').trim(); } catch (_) {} }
  if (!phone || !pass) return authError('Fill in your phone and password.');
  if (pass.length < 6) return authError('Password must be at least 6 characters.');
  if (pass !== pass2) return authError('The two passwords do not match.');
  document.getElementById('authErr').classList.add('hidden');
  const restore = setBusy(document.getElementById('rgSubmit'), 'Please wait');
  try {
    // Pre-check the invite code — a code that doesn't belong to a real user
    // stops registration HERE, before any account is created.
    if (ref) {
      const rchk = await api('/auth/check-referral', { method: 'POST', body: { referralCode: ref } });
      if (rchk.status === 'success' && !rchk.valid) { restore(); return authError(rchk.reason || 'That invite code does not exist.'); }
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
    // The referral code travels WITH profile creation (stored server-side as
    // pendingReferral), so an interrupted sign-up can never lose the referral.
    try { if (ref) localStorage.setItem('fg_pending_ref', ref); } catch (_) {}
    const prof = await api('/account/create-profile', { method: 'POST', body: { phone: cleanPhone(phone).replace('+', ''), referralCode: ref } });
    if (prof.status !== 'success') { restore(); return authError(prof.message || 'Could not create your profile.'); }
    // Register applies the welcome bonus AND records the referral link. It is
    // idempotent server-side (registrationDone guard), so retry it a few times on
    // a network blip — otherwise a referral could be silently lost at sign-up.
    // The code was already pre-validated, so a BAD_REFERRAL here is almost always
    // transient — keep sending the real code for the first tries; only the very
    // last attempt finishes without it so the account is never left half-created.
    // We DON'T wipe fg_pending_ref unless the referrer was actually linked, so the
    // server-side reconciler can still attach it later.
    for (let attempt = 0; attempt < 4; attempt++) {
      const useCode = attempt < 3 ? ref : '';
      const reg = await api('/register', { method: 'POST', body: { referralCode: useCode } });
      if (reg.status === 'success' || reg.status === 'already_done') {
        if (reg.referrerId) { try { localStorage.removeItem('fg_pending_ref'); } catch (_) {} }
        break;
      }
      await new Promise(r => setTimeout(r, 700 * (attempt + 1)));
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

// Paint the dashboard immediately for a device that was already signed in, before
// auth or any network call resolves. Empty state is a valid state for every panel.
try {
  if (localStorage.getItem('fg_wasAuthed') === '1') {
    _booting = true;
    render();
    // Safety release. If auth never resolves (Firebase blocked, no network) the
    // loader must not spin forever; the dashboard falls back to its empty state.
    setTimeout(() => { if (_booting) { _booting = false; if (!_pageOpen) render(); } }, 12000);
  }
} catch (_) {}

onAuthStateChanged(auth, async (user) => {
  _user = user;
  if (!user) { _booting = false; showView('auth'); return; }
  // Reveal and start ticking at once — the panels already have content.
  showView('main');
  startRealtime();
  // Keep the branded syncing screen up and load the ESSENTIAL data — balance,
  // watches, transactions AND settings (banner images) — BEFORE revealing the
  // dashboard, so it appears already populated: no "UGX 0 → real" flash and no
  // default banners flashing before the admin images. Capped so a slow network
  // can't hang the sync screen; anything still loading finishes in the background.
  const essential = Promise.all([loadAccount(), loadPublicSettings(), loadTxns(), loadProducts(), loadTeam()]);
  await Promise.race([essential, new Promise(r => setTimeout(r, 8000))]);
  _booting = false;
  if (checkGate()) return;
  // SELF-HEAL: an interrupted sign-up (app closed / network died between the
  // two registration calls) leaves the account unfinished — no welcome bonus,
  // referral not linked. Finish it now; the server reads the stored referral.
  if (_account && !_account.registrationDone) {
    let backupRef = ''; try { backupRef = localStorage.getItem('fg_pending_ref') || ''; } catch (_) {}
    api('/register', { method: 'POST', body: { referralCode: backupRef } }).then(async (r) => {
      if (r.status === 'success' || r.status === 'already_done') {
        if (r.referrerId) { try { localStorage.removeItem('fg_pending_ref'); } catch (_) {} }
        await loadAccount(); if (!_pageOpen) render();
      }
    }).catch(() => {});
  }
  render();
  maybeShowAnnouncement();
  // If the 8s cap fired before data was ready, repaint the moment it lands.
  essential.then(() => { if (checkGate()) return; if (!_pageOpen) render(); }).catch(() => {});
});

// Returns true (and shows a blocker) if the app should be gated off.
function checkGate() {
  if (_publicSettings?.maintenanceMode) {
    showBlocker('Under maintenance', _publicSettings.maintenanceMsg || 'Chronova is being upgraded. Please check back shortly.', 'Try again', () => location.reload());
    return true;
  }
  if (_account?.status === 'banned') {
    showBlocker('Account suspended', 'Your account has been suspended. Contact support if you believe this is a mistake.', 'Log out', doLogout);
    return true;
  }
  return false;
}

// ── REAL-TIME REFRESH ──
// Silently re-pulls balance, transactions, team and public settings every 4s
// (and the moment the app regains focus) and re-renders the visible tab — so
// a commission landing, a deposit clearing, a daily payout, or maintenance
// mode being switched on all show up on their own, no manual reload.
// Pauses while the tab is hidden or a full-page/modal is open (M0-friendly).
let _realtimeTimer = null, _realtimeSig = '', _tickN = 0;
function dataSig() {
  // Per-row statuses (not just counts): a deposit flipping pending→success or a
  // withdrawal being processed MUST repaint recent activity without a reload.
  return [_account?.walletBalance, _account?.totalEarned, _account?.commissionEarned,
    _account?.totalWithdrawn, _account?.totalDeposited, _account?.teamL1Count,
    _txns.length, _txns.slice(0, 30).map(t => t.status).join(''), _investments.length,
    _investments.map(i => i.status).join(''), _members.length].join('|');
}
async function realtimeTick() {
  if (document.hidden || !_user || _pageOpen) return;
  _tickN++;
  try {
    await Promise.all([loadPublicSettings(), loadAccount(), loadTxns(),
      (_activeTab === 'team' ? loadTeam() : Promise.resolve())]);
  } catch (_) { return; }
  if (_pageOpen || document.hidden) return; // state changed during the await
  // Maintenance mode (or a ban) flipped on the server while this tab sat open
  // must take effect right away — not only for someone opening the app fresh.
  if (checkGate()) return;
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

async function loadPublicSettings() {
  const r = await api('/settings/public');
  if (r.status === 'success') _publicSettings = r;
  return _publicSettings;
}

const FG_LOGO = `<svg viewBox="0 0 100 100"><defs><radialGradient id="fgLogoGrad" cx="35%" cy="30%" r="75%">
  <stop offset="0%" stop-color="#f7e6b4"/><stop offset="60%" stop-color="#d9ad4e"/><stop offset="100%" stop-color="#a97f22"/>
  </radialGradient></defs>
  <circle cx="50" cy="50" r="48" fill="url(#fgLogoGrad)"/>
  <circle cx="50" cy="50" r="28" fill="none" stroke="#1c1403" stroke-width="6"/>
  <path d="M50 34v16l11 7" fill="none" stroke="#1c1403" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

// Turns bare URLs inside already-escaped text into live inline links, so a
// link the admin pastes into the body reads in line with the sentence
// instead of only working via the separate CTA button below.
function linkifyEscaped(escapedText) {
  return escapedText.replace(/(https?:\/\/[^\s<]+)/g, (m) => {
    const clean = m.replace(/[.,!?)]+$/, '');
    const trail = m.slice(clean.length);
    return `<a class="ann-inline-link" href="${clean}" target="_blank" rel="noopener">${clean}</a>${trail}`;
  });
}
// Multi-line announcements read as a plain numbered list — items 1 through
// 5 at most, so a long admin post never turns into a wall of text. A single
// line (no breaks) stays as plain text; nothing to number.
function announcementBodyHtml(text) {
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean).slice(0, 5);
  if (lines.length > 1) return `<ol class="ci-rules ann-list">${lines.map(l => `<li>${linkifyEscaped(esc(l))}</li>`).join('')}</ol>`;
  return `<div class="ann-text">${linkifyEscaped(esc(text))}</div>`;
}
function maybeShowAnnouncement() {
  const ann = _publicSettings?.announcement;
  if (!ann || !ann.enabled || !ann.body) return;
  // Shows on EVERY visit while enabled (owner's choice) — no "seen" memory.
  const root = document.getElementById('modalRoot');
  document.body.classList.add('no-scroll'); // freeze the dashboard while the dialog is up
  root.style.alignItems = 'center';
  const ctaIsTelegram = /(?:^|\/\/)(?:t\.me|telegram\.me|telegram\.org)\//i.test(ann.ctaUrl || '');
  const bg = _publicSettings?.announcementBg || '';
  root.innerHTML = `
    <div class="modal-backdrop" data-close></div>
    <div class="ann-card">
      <button class="ann-x" id="annClose" aria-label="Close">${SVG_CLOSE}</button>
      <div class="ann-hero"${bg ? ` style="background-image:url('${esc(bg)}')"` : ''}>
        <span class="ann-htitle">${esc(ann.title || 'Notice')}</span>
        ${bg ? '' : `<div class="ann-logo">${FG_LOGO}</div>`}
      </div>
      <div class="ann-body">
        ${announcementBodyHtml(ann.body)}
        ${ann.ctaUrl && ann.ctaLabel ? `<a class="ann-cta" href="${esc(ann.ctaUrl)}" target="_blank" rel="noopener">${ctaIsTelegram ? `<span class="ann-cta-ic">${TG_MARK}</span>` : ''}${esc(ann.ctaLabel)}</a>` : ''}
      </div>
    </div>`;
  root.classList.remove('hidden');
  const dismiss = () => { root.style.alignItems = ''; closeModal(); };
  root.querySelector('#annClose').addEventListener('click', dismiss);
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
// Client-side copy of the milestone ladder so the Task Center renders instantly
// (0% / unclaimed) before /team/stats returns — no loader. Server is source of
// truth for what's actually claimable; these fill in the moment stats arrive.
// Target = a COUNT of active level-1 referrals (not a currency amount).
const TEAM_MILESTONES = [
  { target:   5, reward:   10000 },
  { target:  10, reward:   25000 },
  { target:  20, reward:   50000 },
  { target:  50, reward:  120000 },
  { target: 100, reward:  250000 },
  { target: 200, reward:  600000 },
  { target: 500, reward: 2000000 },
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
document.querySelectorAll('.tab-btn[data-tab]').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});
// The raised centre button opens what the user already owns, not the shop.
document.querySelector('.tab-fab')?.addEventListener('click', () => openHoldingsModal());
async function switchTab(name) {
  const prevTab = _activeTab;
  _activeTab = name;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.panel').forEach(p => p.classList.toggle('hidden', p.id !== 'panel-' + name));
  document.getElementById('topbarTitle').textContent = { home: 'Home', products: 'Products', team: 'Team', account: 'Account' }[name];
  // INSTANT tabs: paint whatever is cached NOW, refresh silently in the
  // background and repaint when fresh data lands — never block the switch.
  // Only re-show the announcement on an actual arrival at Home from another
  // tab — tapping Home while already there must not retrigger it.
  if (name === 'home' && prevTab !== 'home') maybeShowAnnouncement();
  if (name === 'products' && !_products.length)
    loadProducts().then(() => { if (_activeTab === 'products') renderProducts(); }).catch(() => {});
  if (name === 'team')
    loadTeam().then(() => { if (_activeTab === 'team') renderTeam(); }).catch(() => {});
  if (name === 'account')
    Promise.all([loadAccount(), loadTxns()]).then(() => { if (_activeTab === 'account') renderAccount(); }).catch(() => {});
}

function render() {
  renderHome();
  renderProducts();
  renderTeam();
  renderAccount();
}

// ══════════════════════════════════════════════
// HOME
// ══════════════════════════════════════════════
// ══════════════════════════════════════════════
// HOLDING HELPERS
// No bars, no rings, no graphs, no countdowns anywhere in Chronova. A holding
// pays every 24h from its own purchase instant and the SERVER decides when —
// the app only ever states what has already been settled.
// ══════════════════════════════════════════════

// Purchase stamp, owner's format: 07/24/2026 09:55:24
function fmtStamp(ms) {
  if (!ms) return 'not started';
  const d = new Date(ms), p = n => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}/${p(d.getDate())}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
// "1/120 days" — the day of the cycle, taken from payouts the server has
// actually settled, never estimated from the local clock.
function cycleLabel(inv) {
  const total = Number(inv.payoutsTotal) || Number(inv.cycle) || 0;
  const made  = Number(inv.payoutsMade)  || 0;
  if (!total) return 'not started';
  const day = inv.status === 'active' ? Math.min(made, total) : total;
  return `${day}/${total} days`;
}
function dailyReturnOf(inv) {
  return Number(inv.dailyPayout) || Math.round((Number(inv.expectedReturn) || 0) / (Number(inv.cycle) || 1));
}
// Income this holding has actually paid out so far.
function accruedOf(inv) {
  return Number(inv.paidOut) || (Number(inv.payoutsMade) || 0) * dailyReturnOf(inv);
}
function todayKey() {
  return new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10); // UTC+3, Kampala
}

function openHoldingsModal() {
  const list = _investments.slice().sort((a, b) => tsMs(b.createdAt) - tsMs(a.createdAt));
  const rowHtml = inv => {
    const done = inv.status === 'matured' || inv.status === 'claimed';
    return `<div class="hold-row">
      <div class="hold-top"><b>${esc(inv.tierLabel || 'Timepiece')}</b>
        <span class="badge ${done ? 'on' : 'off'}">${done ? 'Completed' : 'Running'}</span></div>
      <div class="hold-grid">
        <span>Price</span><b>${ugx(inv.amount)}</b>
        <span>Daily return</span><b>${ugx(dailyReturnOf(inv))}</b>
        <span>Accumulated income</span><b>${ugx(accruedOf(inv))}</b>
        <span>Total revenue</span><b>${ugx(inv.expectedReturn)}</b>
        <span>Purchase date</span><b>${fmtStamp(tsMs(inv.createdAt))}</b>
        <span>Cycle</span><b>${cycleLabel(inv)}</b>
      </div></div>`;
  };
  openModal(`
    <div class="modal-head"><h2>My products</h2><button class="modal-close">${ICN.close}</button></div>
    ${list.map(rowHtml).join('')}
    <div class="empty-note">No more data</div>
  `);
}

// ══════════════════════════════════════════════
// LIVE ACTIVITY WIRE
// Deliberately synthetic movement, not anyone's real history: masked MSISDNs
// against plausible amounts. Recharges follow the admin's real price list so
// the wire never advertises an amount the Products tab does not sell;
// withdrawals step in 10,000s. Both stop at 1,000,000.
// ══════════════════════════════════════════════
const WIRE_CAP = 1000000;
const WIRE_STEP = 10000;
function wirePool(kind) {
  if (kind === 'recharge') {
    const prices = _products.map(p => Number(p.price)).filter(n => n > 0 && n <= WIRE_CAP);
    if (prices.length) return prices;
  }
  const out = [];
  for (let a = WIRE_STEP; a <= WIRE_CAP; a += WIRE_STEP) out.push(a);
  return out;
}
function maskedMsisdn() {
  return '256****' + String(Math.floor(Math.random() * 10000)).padStart(4, '0');
}
let _wire = [];
const WIRE_EPOCH = Date.now();   // marquee resumes from here after any re-render
const WIRE_CYCLE = 120;           // seconds, must match the cvWire keyframes
function buildWire(n) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    const kind = Math.random() < 0.6 ? 'recharge' : 'withdrawal';
    const pool = wirePool(kind);
    rows.push({ kind, phone: maskedMsisdn(), amount: pool[Math.floor(Math.random() * pool.length)] });
  }
  return rows;
}
function wireHtml() {
  if (!_wire.length) _wire = buildWire(18);
  const one = w => `<span class="wire-item"><i class="wire-dot ${w.kind === 'recharge' ? 'in' : 'out'}"></i>${esc(w.phone)} <em>${w.kind}</em> ${ugx(w.amount)}</span>`;
  const s = _wire.map(one).join('');
  return s + s; // doubled so the -50% marquee loops seamlessly
}
let _wireTimer = null;
function startWire() {
  if (_wireTimer) return;
  _wireTimer = setInterval(() => {
    if (_activeTab !== 'home' || document.hidden) return;
    _wire = buildWire(18);
    const track = document.getElementById('wireTrack');
    if (track) track.innerHTML = wireHtml();
  }, 25000);
}

// ══════════════════════════════════════════════
// HOME
// Order is fixed by the owner: hero banner → actions → activity wire →
// balance cards. Nothing else belongs on this screen.
// ══════════════════════════════════════════════

// Every image on this screen is admin-supplied. There are deliberately NO
// built-in fallback banners — an empty slot renders as an empty frame so a
// missing upload is obvious in the panel instead of being papered over.
function bannerUrl(slot) {
  const b = _publicSettings?.banners;
  return (b && b[slot]) ? String(b[slot]) : '';
}

// Action glyphs live in ONE place. The dashboard and the account screen must
// never drift apart: whatever the owner uploads is what both show, and the
// inline fallback is only used when nothing has been uploaded.
function actionIcon(key, fallback) {
  const src = (window.CHRONOVA_ICONS || {})[key];
  return src ? `<img src="${src}" alt="">` : fallback;
}

function renderHome() {
  const el = document.getElementById('panel-home');
  if (!el) return;
  if (_booting) { el.innerHTML = `<div class="load-wrap">${SPINNER}</div>`; return; }
  const checkedInToday = _account?.lastCheckinDate === todayKey();

  const statCard = (slot, label, value) => {
    const img = bannerUrl(slot);
    return `<div class="stat-card">
      ${img ? `<img class="stat-bg" src="${esc(img)}" alt="">` : ''}
      <div class="stat-veil"></div>
      <div class="stat-in"><span class="stat-l">${label}</span><b class="stat-v">${value}</b></div>
    </div>`;
  };
  const money = v => _hideBal ? '••••••' : ugx(v);
  const hero = bannerUrl('hero');

  el.innerHTML = `
    <div class="hero-static${hero ? '' : ' is-empty'}">${hero ? `<img src="${esc(hero)}" alt="">` : ''}</div>

    <div class="act-row">
      <button class="act" id="qaRecharge"><span class="act-ic">${actionIcon('deposit', ICN.down)}</span><span class="act-t">Recharge</span></button>
      <button class="act" id="qaWithdraw"><span class="act-ic">${actionIcon('withdraw', ICN.up)}</span><span class="act-t">Withdrawal</span></button>
      <button class="act${checkedInToday ? ' is-done' : ''}" id="qaCheckin"><span class="act-ic">${actionIcon('checkin', ICN.checkin)}</span><span class="act-t">Check-in</span></button>
      <button class="act" id="qaContact"><span class="act-ic">${actionIcon('contact', ICN.phone)}</span><span class="act-t">Contact Us</span></button>
    </div>

    <div class="wire">
      <span class="wire-cap left">${FG_LOGO}</span>
      <div class="wire-view"><div class="wire-track" id="wireTrack" style="animation-delay:-${(((Date.now() - WIRE_EPOCH) / 1000) % WIRE_CYCLE).toFixed(2)}s">${wireHtml()}</div></div>
      <span class="wire-cap right">${ICN.bell}</span>
    </div>

    <div class="stat-grid">
      ${statCard('balance',    'Account Balance',   money(_account?.walletBalance || 0))}
      ${statCard('income',     "Today's Income",    money(todayIncome()))}
      ${statCard('cumulative', 'Cumulative Income', money(_account?.totalEarned || 0))}
      ${statCard('withdrawn',  'Total Withdrawals', money(_account?.totalWithdrawn || 0))}
    </div>
  `;

  el.querySelector('#qaRecharge').addEventListener('click', openRechargeSheet);
  el.querySelector('#qaWithdraw').addEventListener('click', openWithdrawSheet);
  el.querySelector('#qaContact').addEventListener('click', openContactPage);
  el.querySelector('#qaCheckin').addEventListener('click', openCheckinPage);
  startWire();
}

// Income credited today, from settled transactions (server is the source of
// truth for the all-time figure; this is only the day slice).
function todayIncome() {
  const EARN = ['gem_payout', 'product_income', 'commission', 'checkin', 'team_reward', 'redeem'];
  const key = todayKey();
  return _txns.reduce((sum, t) => {
    if (!EARN.includes(t.type)) return sum;
    const amt = Number(t.amount) || 0;
    if (amt <= 0) return sum;
    const ms = tsMs(t.createdAt);
    if (!ms) return sum;
    const k = new Date(ms + 3 * 3600000).toISOString().slice(0, 10);
    return k === key ? sum + amt : sum;
  }, 0);
}

// Premium record card — gradient icon chip, clean title, tag, amount + status pill.
const REC_META = {
  topup:         { label: 'Recharge' },
  withdrawal:    { label: 'Withdrawal' },
  commission:    { label: 'Commission' },
  team_reward:   { label: 'Team reward' },
  checkin:       { label: 'Daily bonus' },
  gem_payout:    { label: 'Product income' },
  product_income:{ label: 'Product income' },
  investment:    { label: 'Product purchase' },
  redeem:        { label: 'Code redeemed' },
  admin_credit:  { label: 'Credit' },
  admin_debit:   { label: 'Adjustment' },
  refund:        { label: 'Refund' },
};
function recMeta(type) { return REC_META[type] || { label: 'Transaction' }; }
function statusInfo(s) {
  s = String(s || 'success').toLowerCase();
  if (['success', 'processed', 'matched'].includes(s)) return { label: 'Successful', cls: 'ok' };
  if (['pending', 'processing', 'claimed', 'awaiting_payment'].includes(s)) return { label: 'Processing', cls: 'proc' };
  if (['failed', 'cancelled', 'rejected', 'expired'].includes(s)) return { label: 'Failed', cls: 'bad' };
  return { label: s.charAt(0).toUpperCase() + s.slice(1), cls: 'mut' };
}
function recTag(t) {
  if (t.type === 'commission' && t.level) return `<span class="rec-tag">Level ${t.level} · ${commPct(t.level)}%</span>`;
  if (t.type === 'withdrawal' && (t.netAmount != null)) return `<span class="rec-tag">Received ${ugx(t.netAmount)}</span>`;
  if (t.type === 'redeem' && t.code) return `<span class="rec-tag">${esc(t.code)}</span>`;
  return '';
}

async function doCheckin() {
  const btn = document.getElementById('qaCheckin');
  const restore = setBusy(btn, 'Please wait');
  const r = await api('/checkin', { method: 'POST' });
  restore();
  if (r.status === 'success') {
    toast('Checked in successfully ✔️');
    await loadAccount(); await loadTxns();
    renderHome(); renderAccount();
  } else {
    toast(r.message || 'Could not check in');
  }
}

// ══════════════════════════════════════════════
// DEPOSIT / WITHDRAW MODALS
// ══════════════════════════════════════════════
// ══════════════════════════════════════════════
// THREE-QUARTER SHEET
// Recharge and Withdrawal are dialogs, not pages: they rise from the bottom
// and cover three quarters of the viewport, leaving the dashboard visible
// behind. openModal() stays for full-screen pages.
// ══════════════════════════════════════════════
const SVG_RECORDS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M7 2h8l5 5v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z"/><path d="M15 2v5h5"/><path d="M10 13h6M10 17h4"/></svg>';
const SVG_TICK    = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5 9.5 18 20 6.5"/></svg>';
const SVG_CHEV    = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m9 5 7 7-7 7"/></svg>';
const SVG_CLOSE   = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';

// Bring a bottom button into view once its sheet has grown too tall for the
// screen (a chip pick or a typed amount can push it below the fold, and on a
// phone the keyboard covers the rest) — 'nearest' is a no-op if it's already
// visible, so this is safe to call on every keystroke.
function revealBtn(id) {
  const el = document.getElementById(id);
  if (el) requestAnimationFrame(() => el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
}
function openSheet({ title, body, onRecords }) {
  const root = document.getElementById('modalRoot');
  root.style.alignItems = 'center';
  root.innerHTML = `
    <div class="modal-backdrop" data-close></div>
    <div class="sheet">
      <div class="sheet-head">
        <button class="sheet-x" data-close-sheet aria-label="Close">${SVG_CLOSE}</button>
        <h2>${esc(title)}</h2>
        ${onRecords ? `<button class="sheet-rec" id="sheetRecords" aria-label="Records">${SVG_RECORDS}</button>` : '<span class="sheet-rec-sp"></span>'}
      </div>
      <div class="sheet-body">${body}</div>
    </div>`;
  root.classList.remove('hidden');
  document.body.classList.add('no-scroll');
  root.querySelector('[data-close]').addEventListener('click', () => closeModal());
  root.querySelector('[data-close-sheet]').addEventListener('click', () => closeModal());
  if (onRecords) root.querySelector('#sheetRecords').addEventListener('click', onRecords);
  if (!_pageOpen) { _pageOpen = true; try { history.pushState({ fgPage: 1 }, ''); } catch (_) {} }
  return root;
}

// ══════════════════════════════════════════════
// RECHARGE  (MarzPay collection — no admin approval step)
// ══════════════════════════════════════════════

// Quick-select amounts are the admin's real product prices, so a shortcut can
// never offer a figure that buys nothing. No hardcoded ladder.
function rechargeChips() {
  const min = Number(_publicSettings?.minDeposit) || 0;
  return [...new Set(_products.map(p => Number(p.price)).filter(n => n > 0 && n >= min))]
    .sort((a, b) => a - b).slice(0, 6);
}
function netOf(phone) {
  const n = String(phone || '').replace(/\D/g, '').replace(/^256/, '').replace(/^0/, '');
  return ['70', '74', '75', '71'].includes(n.slice(0, 2)) ? 'Airtel' : 'MTN';
}

function openRechargeSheet() {
  const chips = rechargeChips();
  const min = Number(_publicSettings?.minDeposit) || 0;

  openSheet({
    title: 'Recharge',
    onRecords: () => openRecordsPage('deposits'),
    body: `
      <label class="fld-l">Select amount</label>
      <div class="chip-grid" id="rcChips">
        ${chips.length
          ? chips.map(a => `<button class="chip" data-amt="${a}">${Number(a).toLocaleString('en-UG')}</button>`).join('')
          : '<div class="empty-note" style="grid-column:1/-1">No products available yet.</div>'}
      </div>

      <label class="fld-l">Amount</label>
      <div class="fld"><span class="fld-pre">UGX</span><input id="rcAmt" type="tel" inputmode="numeric" placeholder="${min ? Number(min).toLocaleString('en-UG') : '0'}"></div>

      <label class="fld-l">Mobile money number</label>
      <div class="fld"><span class="fld-pre">+256</span><input id="rcPhone" type="tel" inputmode="numeric" placeholder="7XXXXXXXX"></div>

      <div class="net-row" id="rcNets">
        <button class="net" data-net="MTN">MTN</button>
        <button class="net" data-net="Airtel">Airtel</button>
      </div>

      <label class="fld-l">Payment method</label>
      <div class="pm-row">
        <span class="pm-ic">${_svg('<rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/>')}</span>
        <span class="pm-label">Mobile Money</span>
        <span class="pm-check">${SVG_TOAST_CHECK}</span>
      </div>

      <ol class="ci-rules">
        <li>Minimum recharge is ${min ? ugx(min) : 'not set'}.</li>
        <li>A prompt reaches your number seconds after you tap Process.</li>
        <li>Approve it with your mobile money PIN.</li>
        <li>Your balance updates on its own once the network confirms.</li>
      </ol>

      <button class="btn" id="rcGo">Process</button>
    `
  });

  const amtEl = document.getElementById('rcAmt');
  const phEl  = document.getElementById('rcPhone');
  // Detection only seeds the choice. Once the user taps a network we stop
  // overriding it, because some numbers have been ported between operators.
  let netTouched = false;
  const paintNet = (force) => {
    if (netTouched && !force) return;
    const n = netOf('0' + phEl.value);
    document.querySelectorAll('#rcNets .net').forEach(b => b.classList.toggle('on', b.dataset.net === n));
  };
  document.querySelectorAll('#rcNets .net').forEach(b => b.addEventListener('click', () => {
    netTouched = true;
    document.querySelectorAll('#rcNets .net').forEach(x => x.classList.toggle('on', x === b));
  }));
  document.querySelectorAll('#rcChips .chip').forEach(c => c.addEventListener('click', () => {
    document.querySelectorAll('#rcChips .chip').forEach(x => x.classList.remove('on'));
    c.classList.add('on');
    amtEl.value = Number(c.dataset.amt).toLocaleString('en-UG');
    revealBtn('rcGo');
  }));
  amtEl.addEventListener('input', () => {
    const raw = amtEl.value.replace(/\D/g, '');
    amtEl.value = raw ? Number(raw).toLocaleString('en-UG') : '';
    document.querySelectorAll('#rcChips .chip').forEach(x =>
      x.classList.toggle('on', Number(x.dataset.amt) === Number(raw)));
    revealBtn('rcGo');
  });
  phEl.addEventListener('input', () => paintNet());  // never forward the Event as 'force'
  paintNet();

  document.getElementById('rcGo').addEventListener('click', async () => {
    const amount = parseInt(amtEl.value.replace(/\D/g, ''), 10);
    const phone  = phEl.value.replace(/\D/g, '');
    if (!amount || amount <= 0) return toast('Enter an amount');
    if (min && amount < min)    return toast(`Minimum recharge is ${ugx(min)}`);
    if (phone.length < 9)       return toast('Enter a valid mobile money number');

    const btn = document.getElementById('rcGo');
    const restore = setBusy(btn);
    const network = document.querySelector('#rcNets .net.on')?.dataset.net || netOf('0' + phone);
    const r = await api('/deposit/marzpay', { method: 'POST', body: { amount, phone: '0' + phone.slice(-9), network } });
    if (r.status !== 'success') { restore(); return toast(r.message || 'Could not start the payment'); }

    // Straight to the records view — the recharge is already listed there as
    // Processing while the user approves the prompt with their PIN.
    closeModal();
    openRecordsPage('deposits');
    toast('Approve the prompt on your phone');
    watchDeposit(r.depositId);
  });
}

// Poll a single recharge until the server resolves it, then refresh the list
// in place. The server is the only thing that credits money.
async function watchDeposit(depositId, tries = 0) {
  if (!depositId || tries > 40) return;
  const r = await api(`/deposit/status/${encodeURIComponent(depositId)}`);
  const st = String(r?.deposit?.status || r?.status2 || '').toLowerCase();
  if (['matched', 'success', 'credited'].includes(st)) {
    await Promise.all([loadAccount(), loadTxns()]);
    renderHome(); renderAccount();
    refreshRecords('deposits');
    return toast('Deposit successfully ✔️');
  }
  if (['failed', 'cancelled', 'rejected'].includes(st)) {
    refreshRecords('deposits');
    return toast('Recharge was declined');
  }
  setTimeout(() => watchDeposit(depositId, tries + 1), 4000);
}

// ══════════════════════════════════════════════
// WITHDRAWAL
// ══════════════════════════════════════════════
function feeRate() {
  const f = Number(_publicSettings?.liquidityFee);
  return (f > 0 && f < 1) ? f : 0.17;
}

// The bank pick is deliberately NOT remembered — bankIdx stays null until the
// user actually taps a card this trip, on every fresh Withdrawal, even if
// only one account is on file. It only survives the round trip to the Bind
// Bank Card screen and back within the SAME open sheet.
let _wdDraft = { amount: '', bankIdx: null };

function openWithdrawSheet() {
  _wdDraft = { amount: '', bankIdx: null };
  renderWithdrawSheet();
}

function renderWithdrawSheet() {
  const bal  = Number(_account?.walletBalance) || 0;
  const min  = Number(_publicSettings?.minWithdrawal) || 0;
  const rate = feeRate();
  const banks = _account?.bankAccounts || [];
  const invested = (Number(_account?.totalInvested) || 0) > 0 || _investments.length > 0;
  const picked = _wdDraft.bankIdx != null ? banks[_wdDraft.bankIdx] : null;

  openSheet({
    title: 'Withdrawal',
    onRecords: () => openRecordsPage('withdrawals'),
    body: `
      <div class="wd-bal"><span>Available balance</span><b>${ugx(bal)}</b></div>

      <label class="fld-l">Receiving account</label>
      <button class="pick-nav" id="wdBankPick" type="button">
        <span class="pick-nav-tx">${picked
          ? `${esc(picked.network || netOf(picked.phone))} · ${esc(String(picked.phone || '').replace(/^(\d{3}).*(\d{3})$/, '$1…$2'))}`
          : 'Please select your bank card'}</span>
        ${SVG_CHEV}
      </button>

      <label class="fld-l">Withdrawal amount</label>
      <div class="fld"><span class="fld-pre">UGX</span><input id="wdAmt" type="tel" inputmode="numeric" placeholder="${min ? Number(min).toLocaleString('en-UG') : '0'}" value="${esc(_wdDraft.amount)}"></div>
      <div class="calc" id="wdCalc">
        <span>You receive <b id="wdNet">${ugx(0)}</b></span>
        <span class="calc-fee">Fee ${Math.round(rate * 100)}%</span>
      </div>

      <ol class="ci-rules">
        <li>Minimum withdrawal is ${min ? ugx(min) : 'not set'}.</li>
        <li>The ${Math.round(rate * 100)}% charge is already taken off the figure above.</li>
        <li>You need at least one product before you can withdraw.</li>
        <li>Withdrawals are processed between 7:00 AM and 6:00 PM. A request placed in that window is sent within 15 minutes if it isn't already handled sooner; outside those hours it waits until 7:00 AM.</li>
      </ol>

      <button class="btn" id="wdGo"${invested ? '' : ' disabled'}>${invested ? 'Process' : 'Buy a product first'}</button>
    `
  });

  const amtEl = document.getElementById('wdAmt');
  const paint = () => {
    const v = parseInt(amtEl.value.replace(/\D/g, ''), 10) || 0;
    document.getElementById('wdNet').textContent = ugx(Math.max(0, Math.round(v * (1 - rate))));
  };
  paint();
  amtEl.addEventListener('input', () => {
    const raw = amtEl.value.replace(/\D/g, '');
    amtEl.value = raw ? Number(raw).toLocaleString('en-UG') : '';
    _wdDraft.amount = amtEl.value;
    paint();
    revealBtn('wdGo');
  });

  document.getElementById('wdBankPick').addEventListener('click', () => {
    _wdDraft.amount = amtEl.value;
    // Same Bind Bank Card screen used from Account — picking a saved card
    // returns straight to Withdrawal; with none saved yet, that screen's own
    // add-card form is right there, so there's nowhere else to be sent.
    openBanksModal((idx) => { _wdDraft.bankIdx = idx; renderWithdrawSheet(); });
  });

  const go = document.getElementById('wdGo');
  if (!invested) return;
  go.addEventListener('click', async () => {
    const amount = parseInt(amtEl.value.replace(/\D/g, ''), 10);
    if (!amount || amount <= 0) return toast('Enter an amount');
    if (min && amount < min)    return toast(`Minimum withdrawal is ${ugx(min)}`);
    if (amount > bal)           return toast('Amount exceeds your balance');
    if (!banks.length)          return toast('Bind a receiving account first');
    if (_wdDraft.bankIdx == null) return toast('Select a receiving account');
    const bank = banks[_wdDraft.bankIdx];

    const restore = setBusy(go);
    const r = await api('/withdraw/request', { method: 'POST', body: {
      amount, phone: bank.phone, network: bank.network || netOf(bank.phone), accountName: bank.holderName || ''
    }});
    if (r.status !== 'success') { restore(); return toast(r.message || 'Could not submit'); }
    closeModal();
    await Promise.all([loadAccount(), loadTxns()]);
    renderHome(); renderAccount();
    openRecordsPage('withdrawals');
    toast('Withdrawal request submitted successfully ✔️');
  });
}

// ══════════════════════════════════════════════
// RECORDS  — Income · Recharges · Withdrawals
// ══════════════════════════════════════════════
let _recordsTab = 'income';
const RECORD_TABS = [
  { key: 'income',      label: 'Income' },
  { key: 'deposits',    label: 'Recharges' },
  { key: 'withdrawals', label: 'Withdrawals' },
];
const INCOME_TYPES = ['gem_payout', 'product_income', 'commission', 'checkin', 'team_reward', 'redeem', 'admin_credit'];

function openRecordsPage(tab) {
  _recordsTab = tab || 'income';
  openModal(`
    <div class="modal-head"><h2>Records</h2><button class="modal-close"></button></div>
    <div class="rtabs" id="rTabs">
      ${RECORD_TABS.map(t => `<button class="rtab" data-rt="${t.key}">${t.label}</button>`).join('')}
    </div>
    <div id="rList"></div>
  `);
  document.querySelectorAll('#rTabs .rtab').forEach(b => b.addEventListener('click', () => {
    _recordsTab = b.dataset.rt; paintRecords(); refreshRecords(_recordsTab);
  }));
  paintRecords();
  refreshRecords(_recordsTab);
}

// A record is a boxed card carrying its ID, timestamp and the number it moved
// on. An empty list says "No more data" — same wording in every tab.
// One timestamp rule for every record. createdAt is authoritative and always
// present; the stored strings are only a fallback for rows that predate it.
function recStamp(r) {
  const ms = tsMs(r.createdAt);
  if (ms) return fmtStamp(ms);
  return `${esc(r.date || '')}${r.time ? ' ' + esc(r.time) : ''}`.trim();
}

// A record reads as a small statement: reference and status on the top line,
// then one labelled line per fact. Deposits carry the number they came from,
// withdrawals carry what actually landed after the charge.
function recordCard(r) {
  const st  = statusInfo(r.status);
  const net = (r.netAmount != null) ? Number(r.netAmount) : null;
  const stamp = recStamp(r);
  const line = (k, v) => v ? `<div class="rec-line"><span>${k}</span><b>${v}</b></div>` : '';
  return `<div class="rec-card">
    <div class="rec-head">
      <span class="rec-ref">${esc(String(r.ref || r.id || 'pending'))}</span>
      <span class="rec-st ${st.cls}">${st.label}</span>
    </div>
    ${line('Amount',   ugx(Math.abs(Number(r.amount) || 0)))}
    ${net != null ? line('Received', ugx(net)) : ''}
    ${line('Number',   esc(r.phone || r.withdrawalPhone || ''))}
    ${line('Date',     stamp)}
  </div>`;
}

// Income uses the same statement shape so every tab reads alike.
function incomeRow(t) {
  const st = statusInfo(t.status);
  const stamp = recStamp(t);
  const line = (k, v) => v ? `<div class="rec-line"><span>${k}</span><b>${v}</b></div>` : '';
  return `<div class="rec-card">
    <div class="rec-head">
      <span class="rec-ref">${esc(recMeta(t.type).label)}</span>
      <span class="rec-st ${st.cls}">${st.label}</span>
    </div>
    ${line('Amount', '+' + ugx(Math.abs(Number(t.amount) || 0)))}
    ${t.level ? line('Level', 'Level ' + t.level) : ''}
    ${line('Date', stamp)}
  </div>`;
}

function paintRecords() {
  document.querySelectorAll('#rTabs .rtab').forEach(b => b.classList.toggle('on', b.dataset.rt === _recordsTab));
  const host = document.getElementById('rList');
  if (!host) return;
  if (_recordsTab === 'income') {
    const rows = _txns.filter(t => INCOME_TYPES.includes(t.type) && (Number(t.amount) || 0) > 0);
    host.innerHTML = rows.map(incomeRow).join('') + `<div class="empty-note">No more data</div>`;
    return;
  }
  const rows = _recordsTab === 'deposits' ? _deposits : _withdrawals;
  host.innerHTML = rows.map(recordCard).join('') + `<div class="empty-note">No more data</div>`;
}

// Fetching is kept OUT of paintRecords: if painting triggers a request and the
// response repaints, the two call each other forever. Fetch once per tab entry
// and once more when a recharge resolves.
async function loadRecords(kind) {
  if (kind === 'income') return loadTxns();
  const path = kind === 'deposits' ? '/account/deposits' : '/account/withdrawals';
  const r = await api(path);
  if (r.status !== 'success') return;
  if (kind === 'deposits') _deposits = r.deposits || [];
  else _withdrawals = r.withdrawals || [];
}
function refreshRecords(kind) {
  loadRecords(kind)
    .then(() => { if (_recordsTab === kind && document.getElementById('rList')) paintRecords(); })
    .catch(() => {});
}

// ══════════════════════════════════════════════
// CHECK-IN  (its own page, opened from Home)
// ══════════════════════════════════════════════
function openCheckinPage() {
  const bonus = Number(_publicSettings?.checkinBonus) || 0;
  const earned = Number(_account?.checkinEarned) || 0;
  const days   = Number(_account?.checkinDays) || 0;
  const done   = _account?.lastCheckinDate === todayKey();
  const title  = bannerUrl('checkin');
  const back   = bannerUrl('checkinBg');

  openModal(`
    <div class="modal-head"><h2>Check-in</h2><button class="modal-close"></button></div>
    ${back ? `<div class="page-bg"><img src="${esc(back)}" alt=""></div>` : ''}
    ${title ? `<div class="page-banner"><img src="${esc(title)}" alt=""></div>` : ''}

    <div class="ci-total">
      <b>${ugx(earned)}</b>
      <span>Cumulative bonus</span>
    </div>

    <div class="ci-pair">
      <div class="ci-cell"><b>${ugx(bonus)}</b><span>Daily reward</span></div>
      <div class="ci-cell"><b>${days}</b><span>Check-in days</span></div>
    </div>

    <button class="btn" id="ciGo"${done ? ' disabled' : ''}>${done ? 'Checked in today' : 'Check in'}</button>

    <ol class="ci-rules">
      <li>Your daily reward is ${ugx(bonus)}.</li>
      <li>Check in once a day.</li>
      <li>The next one opens after midnight.</li>
    </ol>
  `);
  if (done) return;
  document.getElementById('ciGo').addEventListener('click', async () => {
    const btn = document.getElementById('ciGo');
    const restore = setBusy(btn);
    const r = await api('/checkin', { method: 'POST' });
    if (r.status !== 'success') { restore(); return toast(r.message || 'Could not check in'); }
    await Promise.all([loadAccount(), loadTxns()]);
    renderHome(); renderAccount();
    closeModal();
    openCheckinPage();
    toast('Checked in successfully ✔️');
  });
}

// ══════════════════════════════════════════════
// CONTACT US  (its own page — Telegram group, channel, direct)
// ══════════════════════════════════════════════

// ══════════════════════════════════════════════
// PRODUCTS
// The catalogue is whatever the admin publishes — there is no built-in tier
// list and no fallback. An empty catalogue renders as an empty catalogue.
// ══════════════════════════════════════════════

// Card-edge tint, gold family, chosen by position in the catalogue. A stored
// per-product colour is deliberately IGNORED: rows seeded before the palette was
// fixed still carry purple hexes, and one of those would put a violet edge on a
// gold card. Position is the only input.
const TIER_TINTS = ['#c9a86a', '#d9ad4e', '#e0b95a', '#c9932e', '#f4d98a', '#b8862b', '#f0c360'];
function tierTint(_p, i) {
  return TIER_TINTS[i % TIER_TINTS.length];
}

function renderProducts() {
  const el = document.getElementById('panel-products');
  if (!el) return;
  if (_booting) { el.innerHTML = `<div class="load-wrap">${SPINNER}</div>`; return; }
  const owned = _investments.length;

  const cumIncome = Number(_account?.totalEarned) || 0;
  const bg = slot => bannerUrl(slot) ? ` style="background-image:url('${esc(bannerUrl(slot))}')"` : '';
  const shortcut = `
    <div class="pstat-row${bannerUrl('hero') ? ' has-bg' : ''}"${bg('hero')} id="pdMine">
      <div class="pstat-txt"><span class="pstat-l">My products</span><b class="pstat-v">${owned}</b></div>
      <span class="pstat-go">${SVG_CHEV}</span>
    </div>
    <div class="pstat-row${bannerUrl('cumulative') ? ' has-bg' : ''}"${bg('cumulative')} id="pdCumulative">
      <div class="pstat-txt"><span class="pstat-l">Cumulative income</span><b class="pstat-v">${ugx(cumIncome)}</b></div>
      <span class="pstat-go">${SVG_CHEV}</span>
    </div>`;

  if (!_products.length) {
    el.innerHTML = shortcut + `<div class="shop-empty">
      <span class="shop-empty-ic">${MENU_ICONS.records}</span>
      <b>No products yet</b>
      <span>The shop is empty. New products appear here as soon as they are published.</span>
    </div>`;
    el.querySelector('#pdMine').addEventListener('click', openHoldingsModal);
    el.querySelector('#pdCumulative').addEventListener('click', () => openRecordsPage('income'));
    loadProducts().then(() => { if (_activeTab === 'products') renderProducts(); }).catch(() => {});
    return;
  }

  el.innerHTML = shortcut + _products.map((p, i) => {
    const tint  = tierTint(p, i);
    const daily = Math.round((Number(p.expectedReturn) || 0) / (Number(p.cycle) || 1));
    const soon  = !!p.comingSoon;
    return `
      <div class="pcard${soon ? ' is-soon' : ''}" style="--tint:${tint}">
        <div class="pcard-art">
          ${p.image ? `<img src="${esc(p.image)}" alt="">` : '<span class="pcard-noimg"></span>'}
          ${soon ? '<span class="pcard-soon">Sold out</span>' : ''}
        </div>
        <div class="pcard-in">
          <div class="pcard-name">${esc(p.label || '')}</div>
          <div class="pcard-grid">
            <span>Price</span><b>${ugx(p.price)}</b>
            <span>Daily return</span><b>${ugx(daily)}</b>
            <span>Cycle</span><b>${Number(p.cycle) || 0} days</b>
            <span>Total revenue</span><b>${ugx(p.expectedReturn)}</b>
          </div>
          ${soon
            ? `<button class="pcard-cta" disabled>Sold out</button>`
            : `<button class="pcard-cta" data-tier="${esc(p.key)}">Purchase</button>`}
        </div>
      </div>`;
  }).join('');

  el.querySelector('#pdMine').addEventListener('click', openHoldingsModal);
  el.querySelector('#pdCumulative').addEventListener('click', () => openRecordsPage('income'));
  el.querySelectorAll('.pcard-cta[data-tier]').forEach(b =>
    b.addEventListener('click', () => confirmBuy(b.dataset.tier)));
}

// Tapping Purchase on a card buys straight away. A compact centred confirm sits
// over the list so an accidental tap never spends money, but there is no detail
// page to step into.
function confirmBuy(key) {
  const idx = _products.findIndex(t => t.key === key);
  const p = _products[idx];
  if (!p) return;
  const bal   = Number(_account?.walletBalance) || 0;
  const daily = Math.round((Number(p.expectedReturn) || 0) / (Number(p.cycle) || 1));
  const tint  = tierTint(p, idx);
  const root  = document.getElementById('pickerRoot');
  root.innerHTML = `
    <div class="pick-backdrop" data-pc></div>
    <div class="buy-card">
      <div class="buy-art">${p.image ? `<img src="${esc(p.image)}" alt="">` : `<div class="buy-fill" style="background:linear-gradient(135deg,${tint},#100d08)"></div>`}</div>
      <h3 class="buy-name">${esc(p.label || '')}</h3>
      <div class="buy-grid">
        <span>Price</span><b>${ugx(p.price)}</b>
        <span>Daily return</span><b>${ugx(daily)}</b>
        <span>Cycle</span><b>${Number(p.cycle) || 0} days</b>
        <span>Total revenue</span><b>${ugx(p.expectedReturn)}</b>
      </div>
      <div class="buy-bal"><span>Your balance</span><b>${ugx(bal)}</b></div>
      <div class="buy-actions">
        <button class="buy-cancel" data-pc>Cancel</button>
        <button class="btn" id="buyGo">Purchase</button>
      </div>
    </div>`;
  root.classList.remove('hidden');
  const close = () => { root.classList.add('hidden'); root.innerHTML = ''; };
  root.querySelectorAll('[data-pc]').forEach(b => b.addEventListener('click', close));
  document.getElementById('buyGo').addEventListener('click', async () => {
    if (bal < p.price) { close(); return toast(`You need ${ugx(p.price)} to buy this`); }
    const btn = document.getElementById('buyGo');
    const restore = setBusy(btn);
    const r = await api('/invest/create', { method: 'POST', body: { tierKey: key } });
    if (r.status !== 'success') { restore(); return toast(r.message || 'Purchase failed'); }
    close();
    toast('Product activated successfully');
    await Promise.all([loadAccount(), loadTxns()]);
    renderHome(); renderProducts(); renderAccount();
  });
}

// ══════════════════════════════════════════════
// TEAM
// ══════════════════════════════════════════════
// Masks a phone the same visual way the activity wire does: keep enough of it
// to recognise, hide the middle.
function maskPhone(p) {
  const d = String(p || '').replace(/\D/g, '');
  return d.length >= 7 ? d.slice(0, 3) + '****' + d.slice(-3) : d;
}
function teamMemberRow(m) {
  return `<div class="rec-card">
    <div class="rec-head">
      <span class="rec-ref">${esc(m.name || 'Member')}</span>
    </div>
    <div class="rec-line"><span>Number</span><b>${esc(maskPhone(m.phone))}</b></div>
    <div class="rec-line"><span>Deposited</span><b>${ugx(m.deposited)}</b></div>
  </div>`;
}
function paintTeamMembers() {
  const host = document.getElementById('tmList');
  if (!host) return;
  host.innerHTML = _members.map(teamMemberRow).join('') + `<div class="empty-note">No more data</div>`;
}
function openTeamMembersModal() {
  openModal(`
    <div class="modal-head"><h2>My team</h2><button class="modal-close"></button></div>
    <div id="tmList"></div>
  `);
  paintTeamMembers();
  loadTeam().then(() => { if (document.getElementById('tmList')) paintTeamMembers(); }).catch(() => {});
}

function referralLink(code) {
  try { return location.origin + location.pathname.replace(/index\.html$/, '') + '?ref=' + encodeURIComponent(code); }
  catch (_) { return 'https://chronovaplatform.com/?ref=' + code; }
}
function commPct(level) {
  const s = _publicSettings || {};
  const raw = level === 1 ? (s.commL1 ?? 0.30) : level === 2 ? (s.commL2 ?? 0.03) : (s.commL3 ?? 0.01);
  return Math.round(raw * 100);
}
// ── Option picker: a sheet that slides up over the page with Cancel / Confirm
// and a scrollable list. Selection is only committed on Confirm. ──
function openPicker({ title, options, selected, onConfirm }) {
  let pick = selected || options[0]?.value;
  const root = document.getElementById('pickerRoot');
  root.innerHTML = `
    <div class="pick-backdrop" data-pc></div>
    <div class="pick-sheet">
      <div class="pick-bar">
        <button class="pick-cancel" data-pc>Cancel</button>
        <span>${esc(title)}</span>
        <button class="pick-ok" id="pkOk">Confirm</button>
      </div>
      <div class="pick-list">
        ${options.map(o => `<button class="pick-opt${o.value === pick ? ' on' : ''}" data-v="${esc(o.value)}">${esc(o.label)}</button>`).join('')}
      </div>
    </div>`;
  root.classList.remove('hidden');
  const close = () => { root.classList.add('hidden'); root.innerHTML = ''; };
  root.querySelectorAll('[data-pc]').forEach(b => b.addEventListener('click', close));
  root.querySelectorAll('.pick-opt').forEach(b => b.addEventListener('click', () => {
    pick = b.dataset.v;
    root.querySelectorAll('.pick-opt').forEach(x => x.classList.toggle('on', x === b));
  }));
  root.querySelector('#pkOk').addEventListener('click', () => { close(); onConfirm(pick); });
}

function openRedeemModal() {
  const group = (_publicSettings || {}).telegramGroup || '';
  openModal(`
    <div class="modal-head"><h2>Redeem gift</h2><button class="modal-close"></button></div>
    ${bannerUrl('gift') ? `<div class="page-banner"><img src="${esc(bannerUrl('gift'))}" alt=""></div>` : ''}

    <p class="gift-lead">Gift codes are posted in our Telegram group.</p>
    ${group ? `<a class="gift-group" href="${esc(group)}" target="_blank" rel="noopener">
        <span class="gift-tg">${TG_MARK}</span>
        <span class="gift-name">Chronova group</span>
        <span class="gift-go">${SVG_CHEV}</span>
      </a>` : ''}

    <label class="gift-label"><i>*</i>Gift code</label>
    <input id="mCode" class="gift-input" type="text" autocomplete="off" placeholder="Enter your gift code">

    <button class="btn" id="mSubmit">Claim</button>
  `);
  document.getElementById('mSubmit').addEventListener('click', async () => {
    const code = document.getElementById('mCode').value.replace(/[\s-]/g, '');
    if (!code) return toast('Enter a gift code');
    const btn = document.getElementById('mSubmit');
    const restore = setBusy(btn);
    const r = await api('/redeem', { method: 'POST', body: { code } });
    restore();
    if (r.status !== 'success') return toast(r.message || 'That code could not be claimed');
    closeModal();
    toast('Gift code claimed successfully ✔️');
    await Promise.all([loadAccount(), loadTxns()]);
    renderHome(); renderAccount();
  });
}

// ══════════════════════════════════════════════
// BIND BANK CARD
// ══════════════════════════════════════════════
const NETWORKS = [{ value: 'Airtel', label: 'Airtel' }, { value: 'MTN', label: 'MTN' }];

// onPick is only ever a function when this is opened as a picker (from
// Withdrawal); the Account-menu entry point wires this straight to a click
// listener, so it must never be treated as a picker just for being truthy.
function openBanksModal(onPick) {
  const picking = typeof onPick === 'function';
  let network = '';
  const paint = () => {
    const host = document.getElementById('bankList');
    if (host) host.innerHTML = bankRowsHtml(_account?.bankAccounts || [], !picking, picking);
    bindDeletes();
    bindPicks();
  };
  const bindDeletes = () => {
    document.querySelectorAll('#bankList [data-del]').forEach(b => b.addEventListener('click', async (e) => {
      e.stopPropagation();
      const r = await api('/account/remove-bank', { method: 'POST', body: { phone: b.dataset.del } });
      if (r.status !== 'success') return toast(r.message || 'Could not remove');
      toast('Account removed');
      await loadAccount(); paint();
    }));
  };
  const bindPicks = () => {
    if (!picking) return;
    document.querySelectorAll('#bankList [data-pick]').forEach(row => row.addEventListener('click', () => {
      onPick(Number(row.dataset.pick));
    }));
  };

  openModal(`
    <div class="modal-head"><h2>${picking ? 'Select bank card' : 'Bind bank card'}</h2><button class="modal-close"></button></div>
    <div id="bankList" class="bank-list">${bankRowsHtml(_account?.bankAccounts || [], !picking, picking)}</div>

    <div class="bind-card">
      <button class="bind-row" id="bkNet">
        <span class="bind-l"><i>*</i>Network</span>
        <span class="bind-v" id="bkNetV">Tap to choose</span>
        <span class="bind-go">${SVG_CHEV}</span>
      </button>
      <div class="bind-row is-field">
        <span class="bind-l"><i>*</i>Account name</span>
        <input id="bkName" type="text" placeholder="Name registered on the SIM">
      </div>
      <div class="bind-row is-field">
        <span class="bind-l"><i>*</i>Number</span>
        <input id="bkPhone" type="tel" inputmode="numeric" placeholder="Mobile money number">
      </div>
    </div>

    <button class="btn" id="bkAdd">Confirm</button>
  `);
  bindDeletes();
  bindPicks();

  document.getElementById('bkNet').addEventListener('click', () => openPicker({
    title: 'Choose network', options: NETWORKS, selected: network,
    onConfirm: v => { network = v; document.getElementById('bkNetV').textContent = v;
                      document.getElementById('bkNetV').classList.add('is-set'); }
  }));

  document.getElementById('bkAdd').addEventListener('click', async () => {
    const holderName = document.getElementById('bkName').value.trim();
    const phone = document.getElementById('bkPhone').value.trim();
    if (!network)    return toast('Select a bank');
    if (!holderName) return toast('Enter the account holder name');
    if (!phone)      return toast('Enter the account number');
    const btn = document.getElementById('bkAdd');
    const restore = setBusy(btn);
    const r = await api('/account/add-bank', { method: 'POST', body: { holderName, phone, network } });
    restore();
    if (r.status !== 'success') return toast(r.message || 'Could not save');
    toast('Account saved successfully');
    await loadAccount();
    // Picking mode: the freshly-added card is the obvious choice — apply it
    // and go straight back to Withdrawal instead of waiting for another tap.
    if (picking) return onPick((_account.bankAccounts || []).length - 1);
    document.getElementById('bkName').value = '';
    document.getElementById('bkPhone').value = '';
    paint();
  });
}

// ══════════════════════════════════════════════
// CUSTOMER CARE
// ══════════════════════════════════════════════
// The real Telegram mark, on its brand-blue disc.
const TG_MARK = `<svg viewBox="0 0 48 48" aria-hidden="true">
  <circle cx="24" cy="24" r="24" fill="#2AABEE"/>
  <path fill="#fff" d="M36.6 14.2 32.4 34c-.3 1.4-1.2 1.7-2.4 1.1l-6.6-4.9-3.2 3.1c-.35.35-.65.65-1.33.65l.47-6.7 12.2-11c.53-.47-.12-.74-.82-.27L15.6 25.6l-6.5-2c-1.42-.45-1.45-1.42.3-2.1l25.4-9.8c1.18-.43 2.2.27 1.8 2.5z"/></svg>`;

function openContactPage() {
  const S = _publicSettings || {};
  const tile = (label, url) => url
    ? `<a class="tg-row" href="${esc(url)}" target="_blank" rel="noopener">
         <span class="tg-art">${TG_MARK}</span>
         <span class="tg-tx"><b>${label}</b><button class="tg-jump">Open</button></span>
       </a>`
    : '';
  const rows = [
    tile('Support desk', S.supportTelegram),
    tile('Community group', S.telegramGroup),
    tile('News channel', S.telegramChannel),
  ].filter(Boolean).join('');

  openModal(`
    <div class="modal-head"><h2>Customer care</h2><button class="modal-close"></button></div>
    ${S.supportHours ? `<div class="cc-hours"><span>Support hours</span><b>${esc(S.supportHours)}</b></div>` : ''}
    ${bannerUrl('contact') ? `<div class="page-banner"><img src="${esc(bannerUrl('contact'))}" alt=""></div>` : ''}
    ${rows ? `<div class="cc-label">Reach us on Telegram</div>${rows}` : `<div class="empty-note">No contact channels published yet.</div>`}
    <ol class="ci-rules">
      <li>Use any link above and an agent will pick it up.</li>
      <li>Nobody from Chronova will ever ask for your password.</li>
      <li>These are the only links we publish.</li>
    </ol>
  `);
}

// ══════════════════════════════════════════════
// TEAM
// ══════════════════════════════════════════════
function renderTeam() {
  const el = document.getElementById('panel-team');
  if (!el) return;
  if (_booting) { el.innerHTML = `<div class="load-wrap">${SPINNER}</div>`; return; }
  const code = _account?.referralCode || _account?.username || 'not ready yet';
  const link = code !== 'not ready yet' ? referralLink(code) : '';
  const ts = _teamStats;
  const LVL = [
    { n: 1, count: ts?.counts?.l1 ?? _account?.teamL1Count ?? 0, earned: ts?.earned?.l1 || 0 },
    { n: 2, count: ts?.counts?.l2 ?? _account?.teamL2Count ?? 0, earned: ts?.earned?.l2 || 0 },
    { n: 3, count: ts?.counts?.l3 ?? _account?.teamL3Count ?? 0, earned: ts?.earned?.l3 || 0 },
  ];
  const people  = LVL.reduce((s, l) => s + l.count, 0);
  const rewards = (ts?.earned?.commissions || _account?.commissionEarned || 0) + (ts?.earned?.teamRewards || 0);
  const bg = slot => bannerUrl(slot) ? ` style="background-image:url('${esc(bannerUrl(slot))}')"` : '';

  el.innerHTML = `
    <div class="tm-share">
      <div class="tm-slab${bannerUrl('inviteCode') ? ' has-bg' : ''}"${bg('inviteCode')}>
        <div class="tm-slab-in">
          <b class="tm-code">${esc(code)}</b>
          <span>Invitation code</span>
        </div>
      </div>
      <div class="tm-slab${bannerUrl('inviteLink') ? ' has-bg' : ''}"${bg('inviteLink')}>
        <div class="tm-slab-in">
          <b class="tm-link">${esc(link || 'not ready yet')}</b>
          <span>Invitation link</span>
        </div>
      </div>
      <button class="tm-cp" id="cpCode">Copy code</button>
      <button class="tm-cp" id="cpLink">Copy link</button>
    </div>

    <div class="tm-title">
      <h3>Team levels</h3>
      <span>Grow your team, earn more</span>
    </div>
    <button class="tm-task-link" id="tmTaskLink">Task Center <span class="tm-task-chev">›</span></button>

    <div class="tm-card">
      ${LVL.map(l => `
        <div class="tm-lvl">
          <span class="tm-tag">LV${l.n}</span>
          <div class="tm-grid">
            <div class="tm-col"><b>${commPct(l.n)}%</b><span>Commission</span></div>
            <div class="tm-col"><b>${l.count}</b><span>Members</span></div>
            <div class="tm-col"><b>${ugx(l.earned)}</b><span>Rewards</span></div>
          </div>
        </div>`).join('')}
    </div>

    <div class="tm-totals">
      <button class="tm-total${bannerUrl('team') ? ' has-bg' : ''}"${bg('team')} id="tmPeople">
        <span class="tm-total-in"><b>${people}</b><em>Total members</em></span>
      </button>
      <button class="tm-total${bannerUrl('hero') ? ' has-bg' : ''}"${bg('hero')} id="tmRewards">
        <span class="tm-total-in"><b>${ugx(rewards)}</b><em>Total rewards</em></span>
      </button>
    </div>

    <ol class="ci-rules">
      <li>Anyone joining on your code becomes level one, and pays you ${commPct(1)}% of every recharge.</li>
      <li>Level two pays ${commPct(2)}% and level three pays ${commPct(3)}%.</li>
      <li>Rewards reach your balance the moment a recharge clears.</li>
    </ol>
  `;

  const copy = (text, msg) => {
    if (!text || text === 'not ready yet') return;
    try { navigator.clipboard.writeText(text); toast(msg); } catch (_) {}
  };
  el.querySelector('#cpCode').addEventListener('click', () => copy(code, 'Code copied'));
  el.querySelector('#cpLink').addEventListener('click', () => copy(link, 'Link copied'));
  el.querySelector('#tmPeople').addEventListener('click', () => openTeamMembersModal());
  el.querySelector('#tmRewards').addEventListener('click', () => openRecordsPage('income'));
  el.querySelector('#tmTaskLink').addEventListener('click', openTaskCenterPage);
}

// Task Center — one row per milestone: a target, a box progress bar, a claim
// button. Deliberately no extra design. Server governs every number here:
// current count, whether it's reached, and whether it's already claimed.
function openTaskCenterPage() {
  if (_teamStats) {
    // Already-cached numbers are current enough to paint instantly — this is
    // the normal path since Team tab refreshes _teamStats on every visit.
    renderTaskCenterPage();
    // The background refresh below rebuilds the whole screen, which resets
    // scroll to the top — with nothing actually changed that reads as the
    // screen randomly "reshowing" a moment after it opened. Only repaint if
    // the numbers genuinely moved, and keep the reader's scroll position
    // when it does.
    const before = JSON.stringify(_teamStats?.milestones || []);
    loadTeam().then(() => {
      if (!document.getElementById('tkList')) return;
      const after = JSON.stringify(_teamStats?.milestones || []);
      if (after === before) return;
      const scroller = document.querySelector('.modal-card');
      const y = scroller ? scroller.scrollTop : 0;
      renderTaskCenterPage();
      const scroller2 = document.querySelector('.modal-card');
      if (scroller2) scroller2.scrollTop = y;
    }).catch(() => {});
    return;
  }
  // Nothing cached yet (a cold open before Team has ever loaded): show a
  // loading state instead of zeroed rows, so the screen doesn't visibly
  // paint once and then get overwritten a moment later.
  renderTaskCenterPage(true);
  loadTeam().then(() => { if (document.querySelector('.tk-loading')) renderTaskCenterPage(); }).catch(() => {});
}
function renderTaskCenterPage(loading) {
  if (loading) {
    openModal(`
      <div class="modal-head"><h2>Task Center</h2><button class="modal-close">${ICN.close}</button></div>
      <div class="load-wrap tk-loading">${SPINNER}</div>
    `);
    return;
  }
  const ts = _teamStats;
  const rows = TEAM_MILESTONES.map(m => {
    const s = ts?.milestones?.find(x => x.target === m.target);
    const current  = Math.min(s?.current ?? 0, m.target);
    const claimed  = !!s?.claimed;
    const achieved = !!s?.achieved;
    const pillClass = claimed ? 'is-done' : (achieved ? 'is-ready' : '');
    const pillLabel = claimed ? 'Received' : (achieved ? 'Claim' : 'In Progress');
    return `
      <div class="tk-row">
        <div class="tk-desc">Invite <b>${m.target}</b> Level 1 investors to get: <em>${ugx(m.reward)}</em></div>
        <div class="tk-stats">
          <div><b>${current}</b><span>Current</span></div>
          <div><b>${m.target}</b><span>Target</span></div>
          <div><b>${current}/${m.target}</b><span>Progress</span></div>
        </div>
        <button class="tk-pill ${pillClass}" data-target="${m.target}"${(claimed || !achieved) ? ' disabled' : ''}>${pillLabel}</button>
      </div>`;
  }).join('');

  openModal(`
    <div class="modal-head"><h2>Task Center</h2><button class="modal-close">${ICN.close}</button></div>
    <p class="tk-lead">Invite friends with your referral code. Once enough of them activate a watch tier, claim the reward for that milestone.</p>
    <div id="tkList">${rows}</div>
  `);

  document.querySelectorAll('.tk-pill[data-target]').forEach(b => {
    b.addEventListener('click', async () => {
      if (b.disabled) return;
      const target = Number(b.dataset.target);
      const restore = setBusy(b);
      const r = await api('/team/milestone/claim', { method: 'POST', body: { target } });
      if (r.status !== 'success') { restore(); return toast(r.message || 'Could not claim'); }
      await loadTeam();
      renderTeam();
      renderTaskCenterPage();
      toast(`${ugx(r.amount)} added to your wallet`);
    });
  });
}

// ══════════════════════════════════════════════
// ACCOUNT
// Laid out from the approved mockup: gold disc avatar, phone, VIP badge, one
// balance card, four actions, mission centre, then a flat menu. The menu icons
// are gold outlines on nothing — no tinted chips behind them, and every row has
// its own glyph.
// ══════════════════════════════════════════════
const _mi = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const MENU_ICONS = {
  about:    _mi('<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H12v18H6.5A2.5 2.5 0 0 1 4 18.5z"/><path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H12v18h5.5a2.5 2.5 0 0 0 2.5-2.5z"/>'),
  care:     _mi('<path d="M21 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z"/><path d="M13 8.7 9.6 11.5 13 14.3"/><path d="M9.6 11.5H14a2.6 2.6 0 0 1 2.6 2.6v.9"/><path d="M17.3 17.6c1.8.4 3.2 1.7 3.6 3.4"/>'),
  records:  _mi('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h6M7 13h10M7 17h4"/>'),
  bank:     _mi('<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/><path d="M6 15h4"/>'),
  password: _mi('<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>'),
  gift:     _mi('<rect x="3" y="8" width="18" height="13" rx="1.5"/><path d="M3 12h18M12 8v13"/><path d="M12 8c-2.5 0-4-1-4-2.5S9.5 3 12 8zM12 8c2.5 0 4-1 4-2.5S14.5 3 12 8z"/>'),
  install:  _mi('<path d="M12 3v12"/><path d="M7.5 11 12 15.5 16.5 11"/><path d="M4 19h16"/>'),
  logout:   _mi('<path d="M12 3a9 9 0 1 0 6.5 2.8"/><path d="M12 2v9"/>'),
};

// Level counts purchases, nothing more: first product is level 1, second is
// level 2, and so on. No product, no badge.
function memberLevel() {
  return _investments.length;
}

function renderAccount() {
  const el = document.getElementById('panel-account');
  if (!el) return;
  if (_booting) { el.innerHTML = `<div class="load-wrap">${SPINNER}</div>`; return; }
  const level = memberLevel();
  const bal  = Number(_account?.walletBalance) || 0;
  const done = _account?.lastCheckinDate === todayKey();

  // A tile grid, not a stack of chevron rows — the row list is exactly the
  // pattern the owner is moving away from. Six tiles, then the two utilities.
  const tile = (id, icon, label) =>
    `<button class="atile" id="${id}"><span class="ati">${MENU_ICONS[icon]}</span><span class="atl">${label}</span></button>`;

  el.innerHTML = `
    <div class="acc-head">
      <div class="acc-disc">${FG_LOGO}</div>
      <div class="acc-id">
        <div class="acc-num">${esc(_account?.phone || '')}</div>
        <div class="acc-badges">
          ${level ? `<span class="vip">Level ${level}</span>` : ''}
        </div>
      </div>
    </div>

    <div class="acc-bal">
      <span>My balance</span>
      <b>${_hideBal ? '••••••' : ugx(bal)}</b>
    </div>

    <div class="acc-acts">
      <button class="aact" id="acRecharge"><span class="aact-ic">${actionIcon('deposit', ICN.down)}</span><span>Recharge</span></button>
      <button class="aact" id="acWithdraw"><span class="aact-ic">${actionIcon('withdraw', ICN.up)}</span><span>Withdrawal</span></button>
      <button class="aact${done ? ' is-done' : ''}" id="acCheckin"><span class="aact-ic">${actionIcon('checkin', ICN.checkin)}</span><span>Check-in</span></button>
      <button class="aact" id="acContact"><span class="aact-ic">${actionIcon('contact', ICN.phone)}</span><span>Contact Us</span></button>
    </div>

    <button class="mission" id="acMission">
      <span class="mission-txt"><b>Task Center</b><span>Claim your referral rewards</span></span>
      <span class="mission-go">${SVG_CHEV}</span>
    </button>

    <div class="atiles">
      ${tile('mnAbout',    'about',    'About Us')}
      ${tile('mnSupport',  'care',     'Customer Care')}
      ${tile('mnHistory',  'records',  'Records')}
      ${tile('mnBanks',    'bank',     'Bind Bank Card')}
      ${tile('mnPassword', 'password', 'Change Password')}
      ${tile('mnRedeem',   'gift',     'Redeem Gift Code')}
    </div>

    <button class="aflat" id="mnDownload"><span class="ati">${MENU_ICONS.install}</span><span>Install App</span></button>
    <button class="aflat is-exit" id="logoutBtn"><span class="ati">${MENU_ICONS.logout}</span><span>Logout</span></button>
  `;

  el.querySelector('#acRecharge').addEventListener('click', openRechargeSheet);
  el.querySelector('#acWithdraw').addEventListener('click', openWithdrawSheet);
  el.querySelector('#acCheckin').addEventListener('click', openCheckinPage);
  el.querySelector('#acContact').addEventListener('click', openContactPage);
  el.querySelector('#acMission').addEventListener('click', openTaskCenterPage);
  el.querySelector('#mnRedeem').addEventListener('click', openRedeemModal);
  el.querySelector('#mnHistory').addEventListener('click', () => openRecordsPage('income'));
  el.querySelector('#mnBanks').addEventListener('click', openBanksModal);
  el.querySelector('#mnPassword').addEventListener('click', openPasswordModal);
  el.querySelector('#mnSupport').addEventListener('click', openContactPage);
  el.querySelector('#mnDownload').addEventListener('click', installApp);
  el.querySelector('#mnAbout').addEventListener('click', openAboutModal);
}

// Download / install screen — app details are server-driven (settings/public).
// Tapping Install runs the browser's own install flow. No intermediate page:
// if the prompt is not available the user is told why in one line.
async function installApp() {
  if (isInstalled()) return toast('Chronova is already installed');
  if (!_installPrompt) return toast('Open the browser menu and choose Install app');
  _installPrompt.prompt();
  try { await _installPrompt.userChoice; } catch (_) {}
  _installPrompt = null;
}

function openDownloadModal() {
  const s = _publicSettings || {};
  const installed = isInstalled();
  openModal(`
    <div class="modal-head"><h2>Download app</h2><button class="modal-close">${ICN.close}</button></div>
    <div class="about-hero">
      <div class="about-logo">${FG_LOGO}</div>
      <div class="about-name">Chronova</div>
      <div class="about-tag">Install Chronova on your phone</div>
    </div>
    <div class="dl-meta">
      <div class="dl-row"><span>Version</span><b>${esc(s.appVersion || '1.0.0')}</b></div>
      <div class="dl-row"><span>Developer</span><b>${esc(s.appDeveloper || 'Chronova Developers')}</b></div>
      <div class="dl-row"><span>Size</span><b>${esc(s.appSize || 'unknown')}</b></div>
      <div class="dl-row"><span>Platform</span><b>Android · iPhone · Web</b></div>
    </div>
    ${installed
      ? `<div class="info-note"><span class="in-ic">${ICN.info}</span><div class="in-tx">Chronova is already installed on this device. Open it from your home screen.</div></div>`
      : `<button class="btn" id="dlInstall">${ICN.download} Install Chronova</button>
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
  const tagline = _publicSettings?.brandTagline || 'Grow your money with watches.';
  const paras = raw
    ? raw.split(/\n{2,}|\r\n\r\n/).map(p => `<p>${esc(p.trim()).replace(/\n/g, '<br>')}</p>`).join('')
    : `<p>Chronova is a mobile-money savings and rewards platform. You buy a watch tier, and it pays out in full when it matures. A simple, fixed return with no daily claiming.</p>
       <p>Invite friends with your referral code to earn rewards across three levels, redeem codes for instant wallet credit, and check in daily for a bonus.</p>`;
  openModal(`
    <div class="modal-head"><h2>About Chronova</h2><button class="modal-close">${ICN.close}</button></div>
    <div class="about-hero">
      <div class="about-logo">${FG_LOGO}</div>
      <div class="about-name">Chronova</div>
      <div class="about-tag">${esc(tagline)}</div>
    </div>
    <div class="about-body">${paras}</div>
    <button class="btn outline" id="aboutRules" style="margin-top:14px">Read the regulation</button>
  `);
  document.getElementById('aboutRules').addEventListener('click', openRulesPage);
}

function openRulesPage() {
  const raw = (_publicSettings?.rulesText || '').trim();
  const body = raw
    ? raw.split(/\n{2,}|\r\n\r\n/).map(t => `<p>${esc(t.trim()).replace(/\n/g, '<br>')}</p>`).join('')
    : `<div class="empty-note">No regulation published yet.</div>`;
  openModal(`
    <div class="modal-head"><h2>Regulation</h2><button class="modal-close"></button></div>
    <div class="about-body">${body}</div>
  `);
}

function bankRowsHtml(accounts, withRemove, pickable) {
  if (!accounts.length) return `<div class="empty-note">No saved accounts yet — add one below.</div>`;
  return accounts.map((a, i) => `
    <div class="bank-row${pickable ? ' is-pick' : ''}" data-phone="${esc(a.phone)}"${pickable ? ` data-pick="${i}"` : ''}>
      <span class="mi">${ICN.bank}</span>
      <div class="bank-info"><div class="t">${esc(a.holderName || a.label || 'Account')}</div><div class="s">${esc(a.network || '')} · 0${esc(a.phone)}</div></div>
      ${withRemove ? `<button class="bank-del" data-del="${esc(a.phone)}">${ICN.trash}</button>` : ''}
      ${pickable ? `<span class="bank-go">${SVG_CHEV}</span>` : ''}
    </div>`).join('');
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
    if (!cur || !nw) return toast('Fill in both password fields');
    if (nw.length < 6) return toast('New password must be at least 6 characters');
    if (nw !== nw2) return toast('The new passwords do not match');
    const restore = setBusy(document.getElementById('mSubmit'), 'Please wait');
    try {
      const cred = EmailAuthProvider.credential(_user.email, cur);
      await reauthenticateWithCredential(_user, cred);
      await updatePassword(_user, nw);
      closeModal();
      toast('Password updated');
    } catch (err) {
      restore();
      const msg = /wrong-password|invalid-credential/.test(err.code || '') ? 'Current password is incorrect' : (err.message || 'Could not update password');
      toast(msg);
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

