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

// Owner: replace with the Furagemz Railway backend URL once deployed.
const SERVER = 'https://REPLACE-WITH-FURAGEMZ-RAILWAY-URL.up.railway.app';

const app  = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);

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
    redeem: 'var(--violet)', boost: '#ef4444'
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
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

// Disable a button and swap its label while a request is in flight — plain
// text state change, no spinner/shimmer/animated loader anywhere in the app.
function setBusy(btn, busyText) {
  if (!btn) return () => {};
  const prevText = btn.textContent, prevDisabled = btn.disabled;
  btn.disabled = true; btn.textContent = busyText;
  return () => { btn.disabled = prevDisabled; btn.textContent = prevText; };
}

function openModal(html) {
  const root = document.getElementById('modalRoot');
  root.innerHTML = `<div class="modal-backdrop" data-close></div><div class="modal-card">${html}</div>`;
  root.classList.remove('hidden');
  root.querySelector('[data-close]').addEventListener('click', closeModal);
  const closeBtn = root.querySelector('.modal-close');
  if (closeBtn) closeBtn.addEventListener('click', closeModal);
}
function closeModal() {
  const root = document.getElementById('modalRoot');
  root.classList.add('hidden');
  root.innerHTML = '';
}

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
    const resp = await fetch(SERVER + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
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
  document.getElementById('splashView').classList.add('hidden');
  document.getElementById('authView').classList.toggle('hidden', name !== 'auth');
  document.getElementById('mainView').classList.toggle('hidden', name !== 'main');
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
const _capRefresh = document.getElementById('captchaRefresh');
if (_capRefresh) _capRefresh.addEventListener('click', loadCaptcha);

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
    await api('/register', { method: 'POST', body: { referralCode: ref } });
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
  showView('auth');
}

// ══════════════════════════════════════════════
// BOOT / DATA LOAD
// ══════════════════════════════════════════════
let _publicSettings = null;
onAuthStateChanged(auth, async (user) => {
  _user = user;
  if (!user) { showView('auth'); return; }
  showView('main');
  await Promise.all([loadAccount(), loadActivityFeed()]);
  render();
  loadPublicSettings().then(maybeShowAnnouncement);
});

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
async function loadTeam() {
  const r = await api('/team/members');
  if (r.status === 'success') _members = r.members || [];
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
  if (name === 'gems' && !_products.length) { await loadProducts(); renderGems(); }
  if (name === 'team') { await loadTeam(); renderTeam(); }
  if (name === 'account' && !_txns.length) { await loadTxns(); renderAccount(); }
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
  return `<svg viewBox="0 0 54 54"><circle class="ring-track" cx="27" cy="27" r="${r}" fill="none" stroke-width="5"/>
    <circle cx="27" cy="27" r="${r}" fill="none" stroke="${color}" stroke-width="5" stroke-linecap="round"
      stroke-dasharray="${c}" stroke-dashoffset="${off}"/></svg>`;
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
function durPhrase(hours) {
  hours = Number(hours) || 0;
  return hours % 24 === 0 ? `${hours / 24} day${hours / 24 === 1 ? '' : 's'}` : `${hours} hours`;
}
// Boost eligibility for an active gem.
function boostState(inv) {
  if (inv.status !== 'active') return { kind: 'none' };
  if (inv.boosted) return { kind: 'boosted', ms: tsMs(inv.maturityDate) - Date.now() };
  const unlock = tsMs(inv.boostUnlockDate);
  if (unlock && Date.now() < unlock) return { kind: 'locked', days: Math.ceil((unlock - Date.now()) / 86400000) };
  return { kind: 'ready', cost: inv.amount };
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
  const hours = _publicSettings?.boostMatureHours || 3;
  const cost = inv.amount || 0;
  openModal(`
    <div class="modal-head"><h2>Boost ${esc(inv.tierLabel || 'gem')}</h2><button class="modal-close">${ICN.close}</button></div>
    <div class="boost-hero">${ICN.boost}</div>
    <p class="boost-copy">Pay <b>${ugx(cost)}</b> again to accelerate this gem. It matures in about <b>${durPhrase(hours)}</b> instead of waiting the full period — and your payout of <b>${ugx(inv.expectedReturn)}</b> stays the same.</p>
    <div class="breakdown">
      <div class="br"><span class="muted">Boost cost</span><span>${ugx(cost)}</span></div>
      <div class="br"><span class="muted">Your balance</span><span>${ugx(_account?.walletBalance || 0)}</span></div>
      <div class="br total"><span>Matures in</span><span>${durPhrase(hours)}</span></div>
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
      <div class="hold-sub">${ugx(inv.amount)} in · pays ${ugx(inv.expectedReturn)}</div>${action}</div>`;
  };
  openModal(`
    <div class="modal-head"><h2>My gems</h2><button class="modal-close">${ICN.close}</button></div>
    ${list.length ? list.map(rowHtml).join('') : `<div class="empty-note">You have no gems yet. Buy one from the Gems tab.</div>`}
  `);
  bindBoosts(document.getElementById('modalRoot'));
}

const BANNER_SLIDES = [
  { bg: 'linear-gradient(120deg,#7c3aed 0%,#c026d3 100%)', art: '#e9d5ff', title: 'Grow your gems', sub: 'Buy a tier, get paid in full at maturity.' },
  { bg: 'linear-gradient(120deg,#0284c7 0%,#4338ca 100%)', art: '#bae6fd', title: 'Invite &amp; earn', sub: '18% on level 1, plus level 2 and 3.' },
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
  go(0);
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
        ${BANNER_SLIDES.map(s => `
          <div class="hb-slide" style="background:${s.bg}">
            <div class="hb-title">${s.title}</div>
            <div class="hb-sub">${s.sub}</div>
            <div class="hb-art">${gemArt(s.art)}</div>
          </div>`).join('')}
      </div>
      <div class="hb-dots" id="hbDots">${BANNER_SLIDES.map(() => '<i></i>').join('')}</div>
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
          <div class="ring">${ringSvg(gemProgress(inv), 'var(--violet)')}</div>
          <div class="gem-active-info">
            <div class="t">${esc(inv.tierLabel || 'Gem')}</div>
            <div class="s">${inv.boosted ? 'Accelerating' : daysLeft(inv) + ' day' + (daysLeft(inv) === 1 ? '' : 's') + ' left'} · ${ugx(inv.amount)} in</div>
            <div class="p">Pays ${ugx(inv.expectedReturn)} at maturity</div>
          </div>
        </div>
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
}

// Premium record card — gradient icon chip, clean title, tag, amount + status pill.
const REC_META = {
  topup:         { label: 'Deposit',          grad: 'linear-gradient(135deg,#10b981,#059669)' },
  withdrawal:    { label: 'Withdrawal',        grad: 'linear-gradient(135deg,#fb7185,#e11d48)' },
  commission:    { label: 'Commission',        grad: 'linear-gradient(135deg,#818cf8,#6366f1)' },
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
const WITHDRAW_FEE = 0.05;

function openDepositModal() {
  const phone0 = esc((_account?.phone || '').replace('+256', '0'));
  openModal(`
    <div class="modal-head"><h2>Deposit</h2><button class="modal-close">${ICN.close}</button></div>
    <input id="mAmt" class="amt-big" type="number" inputmode="numeric" placeholder="0" min="30000">
    <div class="amt-chips">${DEPOSIT_CHIPS.map(v => `<button class="amt-chip" data-amt="${v}">${Number(v).toLocaleString('en-UG')}</button>`).join('')}</div>
    <div class="field" style="margin-top:16px"><label>Mobile-money phone</label><input id="mPhone" type="tel" placeholder="0771234567" value="${phone0}"></div>
    <div class="note" style="text-align:left;margin-bottom:14px">Minimum ${ugx(30000)}. You'll approve a prompt on your phone.</div>
    <button class="btn" id="mSubmit">Deposit</button>
  `);
  const amtEl = document.getElementById('mAmt');
  document.querySelectorAll('#modalRoot .amt-chip').forEach(c =>
    c.addEventListener('click', () => { amtEl.value = c.dataset.amt; amtEl.focus(); }));
  document.getElementById('mSubmit').addEventListener('click', async () => {
    const amount = parseInt(amtEl.value, 10);
    const phone = document.getElementById('mPhone').value.trim();
    if (!amount || amount < 30000) return toast('Minimum deposit is ' + ugx(30000), 'err');
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
      <div class="pay-orb" id="payOrb">${ICN.down}</div>
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
  if (tries > 25)      { depositResult('slow', amount); return; }
  setTimeout(() => pollDepositUI(depositId, amount, tries + 1), 3000);
}
function depositResult(kind, amount) {
  const orb = document.getElementById('payOrb'); if (!orb) return;
  const title = document.getElementById('payTitle'), sub = document.getElementById('paySub'), dots = document.getElementById('payDots');
  if (dots) dots.style.display = 'none';
  if (kind === 'ok')  { orb.className = 'pay-orb ok';  orb.innerHTML = CHECK_SVG; title.textContent = 'Deposit successful'; sub.innerHTML = `<b>${ugx(amount)}</b> has been added to your wallet.`; }
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
  openModal(`
    <div class="modal-head"><h2>Withdraw</h2><button class="modal-close">${ICN.close}</button></div>
    <div style="text-align:center;color:var(--sub);font-size:12.5px;margin-bottom:6px">Available ${ugx(bal)}</div>
    <input id="mAmt" class="amt-big" type="number" inputmode="numeric" placeholder="0" min="10000">
    <div class="amt-chips">${WITHDRAW_CHIPS.map(v => `<button class="amt-chip" data-amt="${v}">${Number(v).toLocaleString('en-UG')}</button>`)
      .join('')}<button class="amt-chip" data-amt="${bal}">All</button></div>
    <div class="breakdown" id="mBreak">
      <div class="br"><span class="muted">Amount</span><span id="brAmt">${ugx(0)}</span></div>
      <div class="br"><span class="muted">Service fee (5%)</span><span id="brFee">${ugx(0)}</span></div>
      <div class="br total"><span>You receive</span><span id="brNet">${ugx(0)}</span></div>
    </div>
    ${(_account?.bankAccounts || []).length ? `<label style="font-size:13px;color:var(--sub);font-weight:600;display:block;margin-bottom:7px">Saved accounts</label>
      <div class="amt-chips" style="justify-content:flex-start;margin:0 0 12px">
        ${(_account.bankAccounts).map(a => `<button type="button" class="amt-chip bank-pick" data-phone="${esc(a.phone)}">${esc(a.holderName || a.network || 'Account')}</button>`).join('')}
      </div>` : ''}
    <div class="field"><label>Send to mobile-money phone</label><input id="mPhone" type="tel" placeholder="0771234567" value="${phone0}"></div>
    <button class="btn" id="mSubmit">Request withdrawal</button>
  `);
  document.querySelectorAll('#modalRoot .bank-pick').forEach(b => b.addEventListener('click', () => {
    document.getElementById('mPhone').value = '0' + b.dataset.phone;
  }));
  const amtEl = document.getElementById('mAmt');
  const recompute = () => {
    const a = parseInt(amtEl.value, 10) || 0;
    const fee = Math.round(a * WITHDRAW_FEE);
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
    if (!amount || amount < 10000) return toast('Minimum withdrawal is ' + ugx(10000), 'err');
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
      <input id="mCode" type="text" autocomplete="off" placeholder="ABC123"
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
const GEM_COLORS = { quartz: '#38bdf8', amethyst: '#c084fc', topaz: '#eab308', emerald: '#10b981', sapphire: '#0ea5e9', diamond: '#7c3aed' };
function renderGems() {
  const el = document.getElementById('panel-gems');
  if (!_products.length) { el.innerHTML = `<div class="empty-note" style="margin-top:14px">Gem tiers not loaded yet.</div>`; loadProducts().then(renderGems); return; }
  el.innerHTML = `
    <div class="sec-head" style="margin-top:12px"><h3>Pick a gem to grow</h3></div>
    ${_products.map(p => {
      const color = GEM_COLORS[p.key] || '#7c3aed';
      const daily = Math.round(p.expectedReturn / (p.cycle || 1));
      return `
      <div class="gem-hero" style="--accent:${color}">
        <div class="gh-head"><span class="gh-name">${esc(p.label)}</span><span class="gh-badge">Fixed</span></div>
        <div class="gh-body">
          <div class="gh-art">${gemArt(color)}</div>
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
    <div class="gem-swatch" style="background:${GEM_COLORS[p.key] || 'var(--violet)'};width:56px;height:56px;border-radius:16px;margin-bottom:16px"></div>
    <div class="stat-row">
      <div class="stat-box"><div class="n">${ugx(p.price)}</div><div class="l">Price</div></div>
      <div class="stat-box"><div class="n">${ugx(p.expectedReturn)}</div><div class="l">Total payout</div></div>
      <div class="stat-box"><div class="n">${p.cycle}d</div><div class="l">Matures in</div></div>
    </div>
    <div class="note" style="text-align:left;margin:16px 0">Paid out in full the moment it matures — no separate claim step. Your wallet balance: ${ugx(bal)}.</div>
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
function renderTeam() {
  const el = document.getElementById('panel-team');
  const code = _account?.referralCode || _account?.username || '—';
  const link = code !== '—' ? referralLink(code) : '';
  el.innerHTML = `
    <div class="ref-card">
      <div style="color:var(--sub);font-size:13px;font-weight:600">Your referral code</div>
      <div class="ref-code">${esc(code)}</div>
      ${link ? `<div class="ref-link" id="refLink" title="Tap to copy">${esc(link)}</div>` : ''}
      <div style="display:flex;gap:8px;justify-content:center;margin-top:12px">
        <button class="btn outline" id="copyRef" style="width:auto;padding:9px 18px;display:inline-flex;align-items:center;gap:7px">${ICN.copy} Copy link</button>
        <button class="btn" id="shareRef" style="width:auto;padding:9px 18px">Share</button>
      </div>
      <div class="stat-row">
        <div class="stat-box"><div class="n">${_account?.teamL1Count || 0}</div><div class="l">Level 1</div></div>
        <div class="stat-box"><div class="n">${_account?.teamL2Count || 0}</div><div class="l">Level 2</div></div>
        <div class="stat-box"><div class="n">${_account?.teamL3Count || 0}</div><div class="l">Level 3</div></div>
      </div>
    </div>
    <div class="sec-head"><h3>Direct referrals</h3></div>
    ${_members.length ? _members.map(m => `
      <div class="member-row">
        <div class="avatar">${esc(initials(m.name))}</div>
        <div class="member-info">
          <div class="t">${esc(m.name)}</div>
          <div class="s">${m.joinedAt ? timeAgo(new Date(m.joinedAt).getTime()) : ''}</div>
        </div>
        <div class="badge ${m.hasInvested ? 'on' : 'off'}">${m.hasInvested ? 'Active' : 'New'}</div>
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
  { key: 'commissions', label: 'Commissions',  types: ['commission'] },
  { key: 'bonuses',     label: 'Bonuses',      types: ['checkin', 'redeem'] },
];
function renderAccount() {
  const el = document.getElementById('panel-account');
  const code = _account?.referralCode ? `<span class="reftag">CODE ${esc(_account.referralCode)}</span>` : '';
  el.innerHTML = `
    <div class="id-card">
      <div class="avatar">${esc(initials(_account?.name))}</div>
      <div>
        <div class="name">${esc(_account?.name || 'Furagemz user')}</div>
        <div class="phone">${esc(_account?.phone || '')}</div>
        ${code}
      </div>
    </div>
    <div class="earn-strip">
      <div class="es"><div class="n">${ugx(_account?.totalDeposited || 0)}</div><div class="l">Deposited</div></div>
      <div class="es"><div class="n">${ugx(_account?.totalEarned || 0)}</div><div class="l">Earned</div></div>
      <div class="es"><div class="n">${ugx(_account?.totalWithdrawn || 0)}</div><div class="l">Withdrawn</div></div>
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
    </div>
    <div class="menu-list">
      <button class="menu-row danger" id="logoutBtn"><span class="mi">${ICN.logout}</span><span class="ml">Log out</span></button>
    </div>
  `;
  el.querySelector('#mnRedeem').addEventListener('click', openRedeemModal);
  el.querySelector('#mnHistory').addEventListener('click', openHistoryModal);
  el.querySelector('#mnGems').addEventListener('click', openHoldingsModal);
  el.querySelector('#mnTeam').addEventListener('click', () => switchTab('team'));
  el.querySelector('#mnBanks').addEventListener('click', openBanksModal);
  el.querySelector('#mnPassword').addEventListener('click', openPasswordModal);
  el.querySelector('#mnSupport').addEventListener('click', openSupportModal);
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

function openSupportModal() {
  const s = _publicSettings || {};
  const wa = s.supportWhatsapp || '';
  const email = s.supportEmail || '';
  const hours = s.supportHours || 'Every day, 9:00 AM – 9:00 PM';
  openModal(`
    <div class="modal-head"><h2>Contact support</h2><button class="modal-close">${ICN.close}</button></div>
    <div class="support-body">
      ${wa ? `<a class="support-row" href="${esc(wa)}" target="_blank" rel="noopener"><span class="mi" style="background:var(--ok-bg);color:var(--ok)">${ICN.support}</span><span><b>WhatsApp channel</b><br><span class="s">Tap to open</span></span></a>` : ''}
      ${email ? `<a class="support-row" href="mailto:${esc(email)}"><span class="mi" style="background:#eef2ff;color:var(--sapphire)">${ICN.mail}</span><span><b>Email us</b><br><span class="s">${esc(email)}</span></span></a>` : ''}
      <div class="support-row" style="cursor:default"><span class="mi" style="background:#fef9e7;color:var(--topaz)">${ICN.clock}</span><span><b>Support hours</b><br><span class="s">${esc(hours)}</span></span></div>
      ${!wa && !email ? `<div class="empty-note">Support contacts have not been set yet.</div>` : ''}
    </div>
  `);
}

function openHistoryModal() {
  if (!TXN_FILTERS.some(x => x.key === _txnFilter)) _txnFilter = 'all';
  const draw = () => {
    const f = TXN_FILTERS.find(x => x.key === _txnFilter) || TXN_FILTERS[0];
    const filtered = f.types ? _txns.filter(t => f.types.includes(t.type)) : _txns;
    let inSum = 0, outSum = 0;
    filtered.forEach(t => { const a = t.amount || 0; if (a >= 0) inSum += a; else outSum += -a; });
    openModal(`
      <div class="modal-head"><h2>Records</h2><button class="modal-close">${ICN.close}</button></div>
      <div class="rec-summary">
        <div class="rs in"><div class="rs-l">Money in</div><div class="rs-n">${ugx(inSum)}</div></div>
        <div class="rs out"><div class="rs-l">Money out</div><div class="rs-n">${ugx(outSum)}</div></div>
      </div>
      <div class="chips rec-chips">${TXN_FILTERS.map(x => `<button class="chip${_txnFilter === x.key ? ' active' : ''}" data-filter="${x.key}">${x.label}</button>`).join('')}</div>
      <div class="rec-list">${filtered.length ? filtered.map(txnRowHtml).join('') : `<div class="empty-note">No records here yet.</div>`}</div>
    `);
    document.querySelectorAll('#modalRoot [data-filter]').forEach(chip => {
      chip.addEventListener('click', () => { _txnFilter = chip.dataset.filter; draw(); });
    });
  };
  draw();
}
