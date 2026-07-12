import { initializeApp, getApps }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signInWithCustomToken, onAuthStateChanged, signOut }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

// FURAGEMZ — Firebase web config. Owner: replace with the Furagemz Firebase
// project's own web config once that project is created (separate from Voltra's).
const firebaseConfig = {
  apiKey:            "REPLACE_WITH_FURAGEMZ_FIREBASE_API_KEY",
  authDomain:        "REPLACE_WITH_FURAGEMZ_PROJECT.firebaseapp.com",
  projectId:         "REPLACE_WITH_FURAGEMZ_PROJECT",
  storageBucket:     "REPLACE_WITH_FURAGEMZ_PROJECT.firebasestorage.app",
  messagingSenderId: "REPLACE_WITH_SENDER_ID",
  appId:             "REPLACE_WITH_APP_ID"
};

// Owner: replace with the Furagemz Railway backend URL once deployed.
const SERVER = 'https://REPLACE-WITH-FURAGEMZ-RAILWAY-URL.up.railway.app';

const app  = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);

// ── STATE ──
let _user = null, _account = null, _investments = [], _members = [], _txns = [], _products = [];
let _activeTab = 'home';
let _txnFilter = 'all';

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
};
function typeIcon(t) { return ICN[t] || ICN.admin_credit; }
function typeColor(t) {
  const map = {
    topup: 'var(--emerald)', gem_payout: 'var(--ok)', commission: 'var(--sapphire)',
    checkin: 'var(--topaz)', withdrawal: 'var(--ruby)', admin_debit: 'var(--ruby)',
    investment: 'var(--amethyst)', refund: 'var(--sapphire)', admin_credit: 'var(--violet)'
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

// Single link-style toggle between sign-in and create-account (no segmented control).
let _authMode = 'login';
function setAuthMode(mode) {
  _authMode = mode;
  const login = mode === 'login';
  document.getElementById('loginForm').classList.toggle('active', login);
  document.getElementById('registerForm').classList.toggle('active', !login);
  document.getElementById('authHeading').textContent = login ? 'Welcome back' : 'Create your account';
  document.getElementById('authSubheading').textContent = login ? 'Sign in to reach your wallet.' : 'It only takes a moment to start.';
  document.getElementById('authToggleText').textContent = login ? 'New to Furagemz?' : 'Already have an account?';
  document.getElementById('authToggleBtn').textContent = login ? 'Create an account' : 'Sign in';
  document.getElementById('authErr').classList.add('hidden');
}
document.getElementById('authToggleBtn').addEventListener('click', () => setAuthMode(_authMode === 'login' ? 'register' : 'login'));
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

document.getElementById('registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('rgName').value.trim();
  const phone = document.getElementById('rgPhone').value.trim();
  const pass = document.getElementById('rgPass').value;
  const ref = document.getElementById('rgRef').value.trim().toUpperCase();
  if (!name || !phone || !pass) return authError('Fill in your name, phone number and password.');
  if (pass.length < 6) return authError('Password must be at least 6 characters.');
  document.getElementById('authErr').classList.add('hidden');
  const restore = setBusy(document.getElementById('rgSubmit'), 'Please wait');
  try {
    let cred;
    try {
      cred = await createUserWithEmailAndPassword(auth, phoneToEmail(phone), pass);
    } catch (primaryErr) {
      if (primaryErr.code === 'auth/network-request-failed') {
        const r = await api('/auth/register', { method: 'POST', body: { phone, password: pass } });
        if (r.status !== 'success') throw new Error(r.message || 'Registration failed');
        cred = await signInWithCustomToken(auth, r.customToken);
      } else throw primaryErr;
    }
    await api('/account/create-profile', { method: 'POST', body: { name, phone: cleanPhone(phone).replace('+', '') } });
    await api('/register', { method: 'POST', body: { referralCode: ref } });
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
onAuthStateChanged(auth, async (user) => {
  _user = user;
  if (!user) { showView('auth'); return; }
  showView('main');
  await loadAccount();
  render();
});

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

function renderHome() {
  const el = document.getElementById('panel-home');
  const bal = _account?.walletBalance || 0;
  const checkedInToday = _account?.lastCheckinDate === new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
  const active = _investments.filter(i => i.status === 'active');
  const recent = _txns.slice(0, 5);

  el.innerHTML = `
    <div class="balance-card">
      <div class="balance-label">Wallet balance</div>
      <div class="balance-amt">${ugx(bal)}</div>
      <div class="balance-sub">Total earned ${ugx(_account?.totalEarned || 0)}</div>
    </div>
    <div class="quick-row">
      <button class="quick-btn" id="qaDeposit"><span class="qi" style="background:var(--ok-bg);color:var(--ok)">${ICN.down}</span>Deposit</button>
      <button class="quick-btn" id="qaWithdraw"><span class="qi" style="background:var(--danger-bg);color:var(--danger)">${ICN.up}</span>Withdraw</button>
      <button class="quick-btn${checkedInToday ? ' claimed' : ''}" id="qaCheckin"><span class="qi" style="background:#fef9e7;color:var(--topaz)">${ICN.checkin}</span>${checkedInToday ? 'Claimed' : 'Check in'}</button>
    </div>
    <div class="sec-head"><h3>Your gems</h3>${active.length ? `<button class="link-btn" data-tab-jump="gems">Buy more</button>` : ''}</div>
    ${active.length ? active.map(inv => `
      <div class="gem-active">
        <div class="ring">${ringSvg(gemProgress(inv), 'var(--violet)')}</div>
        <div class="gem-active-info">
          <div class="t">${esc(inv.tierLabel || 'Gem')}</div>
          <div class="s">${daysLeft(inv)} day${daysLeft(inv) === 1 ? '' : 's'} left · ${ugx(inv.amount)} in</div>
          <div class="p">Pays ${ugx(inv.expectedReturn)} at maturity</div>
        </div>
      </div>`).join('') : `<div class="empty-note">No active gems yet. Buy your first one from the Gems tab.</div>`}
    <div class="sec-head"><h3>Recent activity</h3>${_txns.length ? `<button class="link-btn" data-tab-jump="account">See all</button>` : ''}</div>
    ${recent.length ? recent.map(txnRowHtml).join('') : `<div class="empty-note">No activity yet.</div>`}
  `;
  el.querySelector('#qaDeposit').addEventListener('click', openDepositModal);
  el.querySelector('#qaWithdraw').addEventListener('click', openWithdrawModal);
  if (!checkedInToday) el.querySelector('#qaCheckin').addEventListener('click', doCheckin);
  el.querySelectorAll('[data-tab-jump]').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tabJump)));
}

function txnRowHtml(t) {
  const amt = t.amount || 0;
  const sign = amt > 0 ? '+' : (amt < 0 ? '−' : '');
  return `<div class="activity-row">
    <div class="act-dot" style="background:${typeColor(t.type)}22;color:${typeColor(t.type)}">${typeIcon(t.type)}</div>
    <div class="act-info">
      <div class="t">${esc(t.description || t.type)}</div>
      <div class="s">${t.date || ''}${t.time ? ' · ' + t.time : ''}</div>
    </div>
    <div class="act-amt ${amt >= 0 ? 'pos' : 'neg'}">${sign}${ugx(Math.abs(amt))}</div>
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
    closeModal();
    toast('Approve the payment prompt on your phone', 'ok');
    pollDeposit(r.depositId);
  });
}
async function pollDeposit(depositId, tries = 0) {
  if (tries > 20) return;
  const r = await api('/deposit/status/' + depositId);
  const s = r.deposit?.depositStatus;
  if (s === 'matched') {
    toast(ugx(r.deposit.creditedAmount) + ' credited to your wallet', 'ok');
    await loadAccount(); renderHome(); renderAccount();
    return;
  }
  if (s === 'failed') { toast('Deposit did not go through', 'err'); return; }
  setTimeout(() => pollDeposit(depositId, tries + 1), 3000);
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
    <div class="field"><label>Send to mobile-money phone</label><input id="mPhone" type="tel" placeholder="0771234567" value="${phone0}"></div>
    <button class="btn" id="mSubmit">Request withdrawal</button>
  `);
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

// ══════════════════════════════════════════════
// GEMS
// ══════════════════════════════════════════════
const GEM_COLORS = { quartz: 'var(--sapphire)', amethyst: 'var(--amethyst)', topaz: 'var(--topaz)', emerald: 'var(--emerald)', sapphire: 'var(--sapphire)', diamond: 'var(--violet)' };
function renderGems() {
  const el = document.getElementById('panel-gems');
  if (!_products.length) { el.innerHTML = `<div class="empty-note" style="margin-top:14px">Gem tiers not loaded yet.</div>`; loadProducts().then(renderGems); return; }
  el.innerHTML = `
    <div class="sec-head" style="margin-top:12px"><h3>Pick a gem to grow</h3></div>
    <div class="gem-list">
      ${_products.map(p => {
        const color = GEM_COLORS[p.key] || 'var(--violet)';
        return `
        <div class="gem-row" data-tier="${p.key}" style="--accent:${color}">
          <div class="facet" style="background:${color}">${ICN.gem}</div>
          <div class="gr-body">
            <div class="gr-name">${esc(p.label)}</div>
            <div class="gr-pay">Pays ${ugx(p.expectedReturn)}</div>
            <div class="gr-meta">Matures in ${p.cycle} days</div>
          </div>
          <div class="gr-right">
            <div class="gr-price">${ugx(p.price)}</div>
            <div class="gr-cta">Buy</div>
          </div>
        </div>`;
      }).join('')}
    </div>
  `;
  el.querySelectorAll('[data-tier]').forEach(card => {
    card.addEventListener('click', () => openGemDetail(card.dataset.tier));
  });
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
function renderTeam() {
  const el = document.getElementById('panel-team');
  const code = _account?.referralCode || '—';
  el.innerHTML = `
    <div class="ref-card">
      <div style="color:var(--sub);font-size:13px;font-weight:600">Your referral code</div>
      <div class="ref-code">${esc(code)}</div>
      <button class="btn outline" id="copyRef" style="width:auto;padding:9px 20px;display:inline-flex;align-items:center;gap:7px">${ICN.copy} Copy code</button>
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
    navigator.clipboard?.writeText(code).then(() => toast('Referral code copied', 'ok')).catch(() => toast(code));
  });
}

// ══════════════════════════════════════════════
// ACCOUNT
// ══════════════════════════════════════════════
const TXN_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'topup', label: 'Deposits' },
  { key: 'withdrawal', label: 'Withdrawals' },
  { key: 'investment', label: 'Gems' },
  { key: 'commission', label: 'Referrals' },
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
      <button class="menu-row" id="mnHistory"><span class="mi">${ICN.receipt}</span><span class="ml">Transaction history</span><span class="mr">${ICN.chevron}</span></button>
      <button class="menu-row" id="mnGems"><span class="mi">${ICN.gem}</span><span class="ml">My gems</span><span class="mr">${ICN.chevron}</span></button>
      <button class="menu-row" id="mnTeam"><span class="mi">${ICN.people}</span><span class="ml">Referrals &amp; team</span><span class="mr">${ICN.chevron}</span></button>
    </div>
    <div class="menu-list">
      <button class="menu-row danger" id="logoutBtn"><span class="mi">${ICN.logout}</span><span class="ml">Log out</span></button>
    </div>
  `;
  el.querySelector('#mnHistory').addEventListener('click', openHistoryModal);
  el.querySelector('#mnGems').addEventListener('click', () => switchTab('gems'));
  el.querySelector('#mnTeam').addEventListener('click', () => switchTab('team'));
}

function openHistoryModal() {
  const draw = () => {
    const filtered = _txnFilter === 'all' ? _txns : _txns.filter(t => t.type === _txnFilter);
    openModal(`
      <div class="modal-head"><h2>Transaction history</h2><button class="modal-close">${ICN.close}</button></div>
      <div class="chips">${TXN_FILTERS.map(f => `<button class="chip${_txnFilter === f.key ? ' active' : ''}" data-filter="${f.key}">${f.label}</button>`).join('')}</div>
      ${filtered.length ? filtered.map(txnRowHtml).join('') : `<div class="empty-note">No transactions here yet.</div>`}
    `);
    document.querySelectorAll('#modalRoot [data-filter]').forEach(chip => {
      chip.addEventListener('click', () => { _txnFilter = chip.dataset.filter; draw(); });
    });
  };
  draw();
}
