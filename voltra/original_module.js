import { initializeApp, getApps }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signInWithCustomToken, onAuthStateChanged, signOut, updateProfile }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getFirestore }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// VOLTRA — Firebase web config (voltra-platform project)
const firebaseConfig = {
  apiKey:            "AIzaSyCpds3p2ciYoReARRVSkdb07e3gEfVc7CU",
  authDomain:        "voltra-platform.firebaseapp.com",
  projectId:         "voltra-platform",
  storageBucket:     "voltra-platform.firebasestorage.app",
  messagingSenderId: "493764461645",
  appId:             "1:493764461645:web:f05e8a4a11f85ee18f4804",
  measurementId:     "G-02YSFLS6DV"
};

// NOTE: VOLTRA — replace with your own Railway server URL once deployed.
const SERVER = 'https://business-production-f4c2.up.railway.app';

const _BOLT = '<svg class="eico" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z"/></svg>';
const _ICN_CHECKIN='<svg class="eico" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z"/></svg>',_ICN_COINS='<svg class="eico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></svg>',_ICN_PEOPLE='<svg class="eico" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="7" r="3.2"/><circle cx="17" cy="9" r="2.6"/><path d="M2.5 19c0-3.3 2.9-5.5 6.5-5.5s6.5 2.2 6.5 5.5v.5h-13z"/><path d="M16.5 13.2c2.7.2 5 2 5 4.8v1h-4v-1c0-1.9-.9-3.6-2.3-4.6.4-.1.9-.2 1.3-.2z"/></svg>',_ICN_GIFT='<svg class="eico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></svg>',_ICN_TREND='<svg class="eico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>',_ICN_BANK='<svg class="eico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="22" x2="21" y2="22"/><line x1="6" y1="18" x2="6" y2="11"/><line x1="10" y1="18" x2="10" y2="11"/><line x1="14" y1="18" x2="14" y2="11"/><line x1="18" y1="18" x2="18" y2="11"/><polygon points="12 2 20 7 4 7"/></svg>',_ICN_UNDO='<svg class="eico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></svg>';
const app  = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

// ── STATE ──
let _user = null, _userData = null, _unsub = null;
let _currentProduct = null;

// ── SVG ICONS ──
const _svg = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const ICN = {
  deposit:           _svg('<line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>'),
  withdrawal:        _svg('<line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>'),
  commission:        _svg('<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>'),
  checkin:           _svg('<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'),
  cashback:          _svg('<circle cx="12" cy="12" r="10"/><polyline points="16 8 12 12 8 16"/><line x1="8" y1="8" x2="16" y2="16"/>'),
  investment:        _svg('<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>'),
  investment_return: _svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="0.5" fill="currentColor"/>'),
  admin_credit:      _svg('<polygon points="12 2 2 8.5 12 15 22 8.5 12 2"/><polyline points="2 15.5 12 22 22 15.5"/>'),
  gift_code:         _svg('<polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/>'),
  box:               _svg('<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>'),
  chart:             _svg('<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>'),
  trend:             _svg('<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>'),
  bell:              _svg('<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>'),
  phone:             _svg('<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>'),
  message:           _svg('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
  bolt:              _svg('<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>'),
  trash:             _svg('<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'),
  warn:              _svg('<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>'),
  eye:               _svg('<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/>'),
  eyeOff:            _svg('<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>'),
};

// ── UTILS ──
function ugx(n) { return 'UGX ' + Number(n||0).toLocaleString('en-UG'); }
// Timestamps now arrive from the server as ISO strings (MongoDB) but may still be
// Firestore Timestamps or {seconds} objects in cached data — normalise all shapes.
function tsMs(v) {
  if (!v) return 0;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v.toDate === 'function')   return v.toDate().getTime();
  if (typeof v === 'object' && v.seconds != null) return v.seconds * 1000;
  const t = new Date(v).getTime();
  return isNaN(t) ? 0 : t;
}
function tsDate(v) { const m = tsMs(v); return m ? new Date(m) : null; }
function shortUgx(n) { n = Number(n||0); return n >= 1000000 ? (n/1000000).toFixed(1)+'M' : n >= 1000 ? (n/1000).toFixed(0)+'K' : n.toString(); }
function showToast(msg, type='') {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'show ' + type;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.className = ''; }, 3200);
}
window.showToast = showToast; // let the plain PWA script surface toasts too
function showLoading(show) {
  document.getElementById('loadingOverlay').classList.toggle('show', show);
}
function phoneToEmail(phone) { return phone.replace(/\D/g,'') + '@voltra-app.com'; }

// ── AUTH FORMS ──
window.showRegister = () => {
  document.getElementById('loginForm').style.display = 'none';
  document.getElementById('registerForm').style.display = 'flex';
  window.scrollTo(0, 0);
};
window.showLogin = () => {
  document.getElementById('registerForm').style.display = 'none';
  document.getElementById('loginForm').style.display = 'flex';
  window.scrollTo(0, 0);
};
window.togglePass = (id, btn) => {
  const inp = document.getElementById(id);
  const show = inp.type === 'password';
  inp.type = show ? 'text' : 'password';
  if (btn) btn.innerHTML = show ? ICN.eyeOff : ICN.eye;
};

// Init password eye icon
document.querySelectorAll('.pass-eye').forEach(b => b.innerHTML = ICN.eye);

// Remember password
const savedPhone = localStorage.getItem('nx_saved_phone');
const savedPass  = localStorage.getItem('nx_saved_pass');
if (savedPhone) { document.getElementById('loginPhone').value = savedPhone; document.getElementById('rememberMe').checked = true; }
if (savedPass)  { document.getElementById('loginPass').value  = savedPass; }

window.doLogin = async () => {
  const phone = document.getElementById('loginPhone').value.trim().replace(/\D/g,'').replace(/^0+/,'');
  const pass  = document.getElementById('loginPass').value;
  if (!phone || !pass) { showToast('Enter phone and password', 'error'); return; }
  if (phone.length !== 9) { showToast('Enter a valid 9-digit number (no leading 0)', 'error'); return; }
  const remember = document.getElementById('rememberMe').checked;
  showLoading(true);
  try {
    let cred;
    try {
      cred = await signInWithEmailAndPassword(auth, phoneToEmail(phone), pass);
    } catch (primaryErr) {
      if (primaryErr.code === 'auth/network-request-failed') {
        const r = await fetch(SERVER + '/auth/login', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone, password: pass })
        }).then(x => x.json());
        if (r.status !== 'success') throw new Error(r.message || 'Login failed');
        cred = await signInWithCustomToken(auth, r.customToken);
      } else {
        throw primaryErr;
      }
    }
    if (remember) { localStorage.setItem('nx_saved_phone', phone); localStorage.setItem('nx_saved_pass', pass); }
    else { localStorage.removeItem('nx_saved_phone'); localStorage.removeItem('nx_saved_pass'); }
  } catch (e) {
    showLoading(false);
    const msg = e.code === 'auth/user-not-found' || e.code === 'auth/wrong-password' || e.code === 'auth/invalid-credential'
      ? 'Incorrect phone or password' : 'Login failed: ' + e.message;
    showToast(msg, 'error');
  }
};

window.doRegister = async () => {
  const phone = document.getElementById('regPhone').value.trim().replace(/\D/g,'').replace(/^0+/,'');
  const pass  = document.getElementById('regPass').value;
  const pass2 = document.getElementById('regPass2').value;
  const ref   = document.getElementById('regRef').value.trim().toUpperCase();
  const name  = '0' + phone;   // no name field — use the phone as the display name
  if (phone.length !== 9) { showToast('Enter a valid 9-digit number (no leading 0)', 'error'); return; }
  if (!pass || pass.length < 6) { showToast('Password must be at least 6 characters', 'error'); return; }
  if (pass !== pass2) { showToast('Passwords do not match', 'error'); return; }
  showLoading(true);
  try {
    let cred;
    try {
      cred = await createUserWithEmailAndPassword(auth, phoneToEmail(phone), pass);
    } catch (primaryErr) {
      if (primaryErr.code === 'auth/network-request-failed') {
        const r = await fetch(SERVER + '/auth/register', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone, password: pass })
        }).then(x => x.json());
        if (r.status !== 'success') throw new Error(r.message || 'Registration failed');
        cred = await signInWithCustomToken(auth, r.customToken);
      } else {
        throw primaryErr;
      }
    }
    const profR = await api('/account/create-profile', { userId: cred.user.uid, name, phone: '256' + phone, password: pass });
    if (profR.status !== 'success' && !/exists|ensured/i.test(profR.message || ''))
      throw new Error(profR.message || 'Profile creation failed');
    await api('/register', { userId: cred.user.uid, referralCode: ref });
  } catch (e) {
    showLoading(false);
    const msg = e.code === 'auth/email-already-in-use'
      ? 'This phone number is already registered' : 'Registration failed: ' + e.message;
    showToast(msg, 'error');
  }
};

window.doLogout = async () => {
  if (!confirm('Log out of Voltra?')) return;
  if (_unsub)      { _unsub(); _unsub = null; }
  if (_maintTimer) { clearInterval(_maintTimer); _maintTimer = null; }
  stopWitTimers();
  await signOut(auth);
  _user = null; _userData = null;
  document.body.classList.add('on-auth');
  document.getElementById('appScreen').style.display = 'none';
  document.getElementById('authScreen').style.display = 'block';
};

// ── API HELPER ──
// Always sends the Firebase ID token so the server can verify the caller.
async function api(path, body = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (_user) {
    try { headers['Authorization'] = 'Bearer ' + await _user.getIdToken(); } catch (_) {}
  }
  const resp = await fetch(SERVER + path, {
    method: 'POST', headers, body: JSON.stringify(body)
  });
  return resp.json();
}

// ── SLIDESHOW ──
const SLIDE_DEFAULTS = [
  { bg:'linear-gradient(135deg,#3a2400 0%,#7a4d00 50%,#0a0e17 100%)', slogan:'Plug In.\nPower Up.' },
  { bg:'linear-gradient(135deg,#1a1407 0%,#4a3000 50%,#0a0e17 100%)', slogan:'Charge Your Wallet\nEvery Day.' },
  { bg:'linear-gradient(135deg,#15100a 0%,#5c3a00 50%,#0a0e17 100%)', slogan:'Your Power.\nYour Profit.' },
];
let _slideTimer = null;
let _pendingAnnouncement = null; // stored here if settings load before login
function setupSlideshow(images) {
  if (_slideTimer) { clearInterval(_slideTimer); _slideTimer = null; }
  const wrap   = document.getElementById('slideshowContainer');
  const dotsEl = document.getElementById('slideshowDots');
  const count  = images.length || SLIDE_DEFAULTS.length;
  wrap.innerHTML   = '';
  dotsEl.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const img = images[i];
    const def = SLIDE_DEFAULTS[i % SLIDE_DEFAULTS.length];
    const slide = document.createElement('div');
    slide.className = 'slide' + (i === 0 ? ' active' : '');
    slide.style.background = def.bg; // gradient shows instantly while image loads
    if (img) {
      slide.innerHTML = `<img src="${img}" alt="" fetchpriority="${i===0?'high':'low'}" decoding="async" loading="eager" style="width:100%;height:100%;object-fit:cover;position:absolute;inset:0"><div class="slide-overlay"></div>`;
    } else {
      slide.innerHTML = `<div class="slide-watermark"><svg class="eico" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z"/></svg></div><div class="slide-slogan">${def.slogan.replace('\n','<br>')}</div>`;
    }
    wrap.appendChild(slide);
    const dot = document.createElement('span');
    dot.className = 'sdot' + (i === 0 ? ' active' : '');
    dotsEl.appendChild(dot);
  }
  let cur = 0;
  _slideTimer = setInterval(() => {
    const slides = wrap.querySelectorAll('.slide');
    const dots   = dotsEl.querySelectorAll('.sdot');
    if (!slides.length) return;
    slides[cur].classList.remove('active');
    dots[cur].classList.remove('active');
    cur = (cur + 1) % slides.length;
    slides[cur].classList.add('active');
    dots[cur].classList.add('active');
  }, 3500);
}
async function loadSlideshow() {
  setupSlideshow([]); // render gradient defaults immediately — no blank screen
  try {
    const r = await (await fetch(SERVER + '/settings/public')).json();
    if (r.status !== 'success') return; // keep defaults
    const s = r.settings;
    const images = s.slideshowImages || [];
    setupSlideshow(images); // swap in real slides once Firestore responds
    // Products banner
    if (s.productsBannerImage) {
      const wrap = document.getElementById('productsBannerWrap');
      const img  = document.getElementById('productsBannerImg');
      if (wrap && img) { img.src = s.productsBannerImage; wrap.style.display = 'block'; }
    }
    // Deposit promo image
    if (s.depositImage) {
      const img = document.getElementById('depPromoImg');
      if (img) { img.src = s.depositImage; img.style.display = 'block'; }
    }
    // About section image (admin-settable, stacked at top of About)
    if (s.aboutImage) _aboutImage = s.aboutImage;
    // Deposit instructions override
    if (s.depositInstructions) {
      const el = document.getElementById('depInstructions');
      if (el) el.innerHTML = s.depositInstructions;
    }
    // Announcement dialog (once per session) — show immediately if already
    // logged in, otherwise store and fire the moment onAuthStateChanged confirms login.
    if (s.announcement?.active && !sessionStorage.getItem('nx_ann_shown')) {
      if (_user) {
        showAnnouncement(s.announcement);
      } else {
        _pendingAnnouncement = s.announcement;
      }
    }
    // Update customer service content from admin settings
    const tg = s.supportTelegram || '';
    const wa = s.supportWhatsapp || '';
    const em = s.supportEmail    || 'support@voltrainvest.com';
    const hr = s.supportHours    || 'Monday – Saturday, 8:00 AM – 8:00 PM (EAT)';
    if (tg || wa || em) {
      const tgSvg = `<svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.248-2.02 9.52c-.148.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.883.701z"/></svg>`;
      const waSvg = `<svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z"/></svg>`;
      CONTENT.support.body = `<p style="color:var(--text2);margin-bottom:20px">Our team is ready to help with any account questions or issues.</p>
        ${tg ? `<a href="${tg}" target="_blank" rel="noopener" class="content-cta-btn tg-btn">${tgSvg}Telegram Support Channel</a>` : ''}
        ${wa ? `<a href="https://wa.me/${wa.replace(/\D/g,'')}" target="_blank" rel="noopener" class="content-cta-btn wa-btn">${waSvg}WhatsApp Us Now</a>` : ''}
        <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border)">
          <p style="font-size:13px;color:var(--text2)"><strong style="color:var(--text)">Email:</strong> ${em}</p>
          <p style="font-size:13px;color:var(--text2);margin-top:8px"><strong style="color:var(--text)">Hours:</strong> ${hr}</p>
        </div>`;
    }
  } catch (_) { setupSlideshow([]); }
}

// Now safe to call — SLIDE_DEFAULTS and _slideTimer are already declared above
loadSlideshow().catch(() => {});

function showAnnouncement(ann) {
  const imgEl  = document.getElementById('annImg');
  const titleEl = document.getElementById('annTitle');
  const msgEl  = document.getElementById('annMsg');
  const tgBtn  = document.getElementById('annTgBtn');
  if (imgEl)  { if (ann.image) { imgEl.src = ann.image; imgEl.style.display = 'block'; } else imgEl.style.display = 'none'; }
  if (titleEl) titleEl.textContent = ann.title || 'Welcome to Voltra!';
  if (msgEl)  msgEl.textContent = ann.message || '';
  if (tgBtn)  { if (ann.telegramLink) { tgBtn.href = ann.telegramLink; tgBtn.style.display = 'flex'; } else tgBtn.style.display = 'none'; }
  const waBtn = document.getElementById('annWaBtn');
  if (waBtn)  { if (ann.whatsappLink) { waBtn.href = ann.whatsappLink; waBtn.style.display = 'flex'; } else waBtn.style.display = 'none'; }
  document.getElementById('announcementDialog').classList.add('show');
  sessionStorage.setItem('nx_ann_shown', '1');
}
window.closeAnnouncement = () => document.getElementById('announcementDialog').classList.remove('show');

window.selectDepAmt = (amt, btn) => {
  document.getElementById('depAmount').value = amt;
  document.querySelectorAll('.qa-btn').forEach(b => b.classList.remove('sel'));
  btn.classList.add('sel');
};

// ── TICKER ──
function loadTicker() {
  const el = document.getElementById('homeTicker');
  if (!el) return;   // ticker removed from home — no-op
  const round = (n, r) => Math.round(n / r) * r;
  const randDep = () => round(30000 + Math.random() * 170000, 5000);   // 30k–200k
  const randWit = () => round(15000 + Math.random() * 985000, 5000);   // 15k–1M
  const randComm = () => round(5000 + Math.random() * 95000, 1000);    // 5k–100k
  const randRet  = () => round(20000 + Math.random() * 480000, 5000);  // 20k–500k

  // masked phone like 256****764
  const ph = () => '256' + (7 + Math.floor(Math.random() * 3)) + '****' + String(100 + Math.floor(Math.random() * 900));
  // Live-style activity: who did what, how much
  const pool = [
    { who:ph(), act:'recharged',  amt:`UGX ${randDep().toLocaleString()}` },
    { who:ph(), act:'cashed out', amt:`UGX ${randWit().toLocaleString()}` },
    { who:ph(), act:'earned',     amt:`UGX ${randRet().toLocaleString()}` },
    { who:ph(), act:'recharged',  amt:`UGX ${randDep().toLocaleString()}` },
    { who:ph(), act:'got a team bonus', amt:`UGX ${randComm().toLocaleString()}` },
    { who:ph(), act:'cashed out', amt:`UGX ${randWit().toLocaleString()}` },
    { who:ph(), act:'recharged',  amt:`UGX ${randDep().toLocaleString()}` },
    { who:ph(), act:'earned',     amt:`UGX ${randRet().toLocaleString()}` },
    { who:ph(), act:'recharged',  amt:`UGX ${randDep().toLocaleString()}` },
    { who:ph(), act:'cashed out', amt:`UGX ${randWit().toLocaleString()}` },
    { who:ph(), act:'got a team bonus', amt:`UGX ${randComm().toLocaleString()}` },
    { who:ph(), act:'earned',     amt:`UGX ${randRet().toLocaleString()}` },
  ];

  const text = pool.map(e =>
    `<span class="tk-item"><span class="tk-dot"></span><b>${e.who}</b> ${e.act} <span class="tk-amt">${e.amt}</span></span>`
  ).join('');
  el.innerHTML = text + text;

  // Refresh with new random values every 40 seconds
  setTimeout(loadTicker, 40000);
}

// ── AUTH STATE ──
onAuthStateChanged(auth, async user => {
  if (user) {
    _user = user;
    document.body.classList.remove('on-auth');
    document.getElementById('authScreen').style.display = 'none';
    document.getElementById('appScreen').style.display  = 'block';
    showLoading(false);
    startListener(user.uid);
    loadProducts();
    loadRecords('deposits');
    loadTicker();
    checkMaintenance();
    api('/account/ensure-refcode', { userId: user.uid }).catch(() => {});
    // Show announcement immediately if settings already loaded before login
    if (_pendingAnnouncement && !sessionStorage.getItem('nx_ann_shown')) {
      showAnnouncement(_pendingAnnouncement);
      _pendingAnnouncement = null;
    }
  } else {
    if (_unsub) { _unsub(); _unsub = null; }
    stopWitTimers();
    document.body.classList.add('on-auth');
    document.getElementById('appScreen').style.display  = 'none';
    document.getElementById('authScreen').style.display = 'block';
    showLoading(false);
  }
});

// ── MAINTENANCE — poll the server so overlay appears shortly after admin toggles it ──
let _maintTimer = null;
async function pollMaintenance() {
  try {
    const r = await (await fetch(SERVER + '/settings/public')).json();
    const on = r.status === 'success' && !!r.settings.maintenanceMode;
    document.getElementById('maintenanceOverlay').style.display = on ? 'flex' : 'none';
  } catch (_) {}
}
function startMaintenanceListener() {
  if (_maintTimer) return; // already polling
  pollMaintenance();
  _maintTimer = setInterval(pollMaintenance, 20000); // every 20 s
}
// Keep legacy name so the onAuthStateChanged call still works
function checkMaintenance() { startMaintenanceListener(); }

// ── DATA POLLING (replaces Firestore real-time listeners; server reads MongoDB) ──
let _pollTimer = null;
async function pollAccount(uid) {
  // Account balance/profile
  try {
    const r = await api('/account/data', { userId: uid });
    if (r.status === 'success' && r.user) {
      _userData = r.user;
      // Enforce ban — kick the user out immediately if admin bans them
      if (_userData.status === 'banned') {
        await signOut(auth);
        _user = null; _userData = null;
        document.body.classList.add('on-auth');
        document.getElementById('appScreen').style.display = 'none';
        document.getElementById('authScreen').style.display = 'block';
        showLoading(false);
        showToast('Your account has been suspended. Contact support.', 'error');
        return;
      }
      renderHome(_userData);
      renderCommission(_userData);
      renderMore(_userData);
    }
  } catch (_) {}
  // Active investments (home preview)
  try {
    const r = await api('/account/investments', { userId: uid });
    if (r.status === 'success') {
      const active = (r.investments || [])
        .filter(inv => inv.status === 'active' || inv.status === 'matured')
        .slice(0, 5);
      renderHomeInvestments(active);
    }
  } catch (_) {}
}

function startListener(uid) {
  if (_unsub) _unsub();
  // Immediate first load, then poll every 6 s so balance/check-in/deposits reflect quickly.
  pollAccount(uid);
  _pollTimer = setInterval(() => pollAccount(uid), 6000);
  _unsub = () => { if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; } };

  // Resume watching any in-flight withdrawal so user gets notified even after re-opening app.
  api('/account/withdrawals', { userId: uid })
    .then(r => {
      if (_witUnsubscribe || r.status !== 'success') return;
      const d = (r.withdrawals || []).find(x => x.status === 'processing');
      if (d) watchWithdrawal(d.id, d.amount);
    }).catch(() => {});
}

// ── RENDER HOME ──
function renderHome(u) {
  document.getElementById('homeBalance').textContent = ugx(u.walletBalance);
  document.getElementById('homeBalanceSub').textContent = u.walletBalance > 0 ? 'Invest in a plan to earn returns' : 'Tap deposit to add funds';
  // Cumulative income = referral commission + cashback (check-in + investment returns)
  const referral = u.commissionEarned || 0;
  const cashback = (u.checkinEarned || 0) + (u.totalEarned || 0);
  document.getElementById('homeCumulative').textContent = ugx(referral + cashback);
  const firstName = u.name ? u.name.split(' ')[0] : '';
  document.getElementById('topGreeting').textContent = 'Hi, ' + firstName;
  // Check-in
  const eat = new Date(Date.now() + 3*60*60*1000);
  const todayKey = eat.toISOString().slice(0,10);
  const doneCi = u.lastCheckinDate === todayKey;
  const streakDays = u.checkinStreak || 0;
  document.getElementById('checkinSub').textContent = doneCi
    ? `<svg class="eico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Checked in today  ·  ${streakDays} day${streakDays===1?'':'s'} series`
    : 'Earn UGX 500 free today';
  const ciBtn = document.getElementById('checkinBtn');
  ciBtn.textContent = doneCi ? 'Done' : 'Claim';
  ciBtn.className   = 'btn-checkin' + (doneCi ? ' done' : '');
}

function renderHomeInvestments(invs) {
  const el = document.getElementById('homeActiveInvest');
  if (!invs.length) {
    el.innerHTML = `<div class="empty-state"><span class="es-icon">${ICN.trend}</span><p>No active plans<br>Browse Plans to invest</p></div>`;
    return;
  }
  el.innerHTML = invs.map(inv => {
    const matured = inv.status === 'matured';
    const msLeft2   = inv.maturityDate ? Math.max(0, tsMs(inv.maturityDate) - Date.now()) : 0;
    const daysLeft = Math.ceil(msLeft2 / 86400000);
    const imgHtml = inv.productImage
      ? `<div class="inv-img"><img src="${inv.productImage}" alt=""></div>`
      : `<div class="inv-img">${ICN.box}</div>`;
    const cycleDays = inv.cycle || 0;
    const daysDone  = Math.floor(Math.max(0, cycleDays * 86400000 - msLeft2) / 86400000);
    return `<div class="inv-item" style="cursor:pointer" onclick="openInvDetail('${inv.id}')">
      ${imgHtml}
      <div class="inv-info">
        <div class="inv-name">${inv.productName || 'Investment'}</div>
        <div class="inv-meta">${ugx(inv.amount)} · ${cycleDays} day${cycleDays!==1?'s':''}</div>
      </div>
      <div class="inv-right">
        <div class="inv-return">${ugx(inv.expectedReturn)}</div>
        <div class="inv-days" style="${matured?'color:#22c55e;font-weight:700':''}">${matured ? '<svg class="eico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Matured' : 'Day '+Math.min(cycleDays,daysDone+1)+'/'+cycleDays}</div>
        <span class="inv-badge ${matured ? 'matured' : 'active'}">${matured ? 'Matured' : 'Active'}</span>
      </div>
    </div>`;
  }).join('');
}

// ── RENDER COMMISSION ──
function renderCommission(u) {
  const code = u.referralCode || '——';
  document.getElementById('commTotal').textContent     = ugx(u.commissionEarned || 0);
  document.getElementById('myRefCode').textContent     = code;
  document.getElementById('myRefLink').textContent     = location.origin + location.pathname + '?ref=' + code;
  const totalSize = (u.teamL1Count||0) + (u.teamL2Count||0) + (u.teamL3Count||0);
  document.getElementById('teamTotalSize').textContent = totalSize;
  document.getElementById('teamL1Count').textContent   = u.teamL1Count || 0;
  document.getElementById('teamL2Count').textContent   = u.teamL2Count || 0;
  document.getElementById('teamL3Count').textContent   = u.teamL3Count || 0;
  document.getElementById('teamL1Earned').textContent  = shortUgx(u.commissionL1Earned || 0);
  document.getElementById('teamL2Earned').textContent  = shortUgx(u.commissionL2Earned || 0);
  document.getElementById('teamL3Earned').textContent  = shortUgx(u.commissionL3Earned || 0);
}

// ── RENDER MORE ──
function renderMore(u) {
  const nameEl = document.getElementById('moreName');
  const TIER_BADGES = {
    junior_agent:    'Junior Agent',
    agent:           'Agent',
    super_agent:     'Super Agent',
    regional_agent:  'Regional Agent',
    national_agent:  'National Agent',
    executive_agent: 'Executive Agent',
  };
  if (u.isAgent && u.agentTier) {
    nameEl.innerHTML = (u.name || '—') + ` <span class="agent-badge">${TIER_BADGES[u.agentTier] || 'Agent'}</span>`;
  } else {
    nameEl.textContent = u.name || '—';
  }
  document.getElementById('morePhone').textContent   = u.phone   || '—';
  document.getElementById('moreBalance').textContent = 'Balance: ' + ugx(u.walletBalance);
  renderAvatars(u);
}

// ── RENDER AGENT CENTRE ──
function renderAgentCentre(u) {
  const TIERS = [
    { key: 'member',          label: 'Member',          stars: '', threshold:  0, weeklyPay:      0 },
    { key: 'junior_agent',    label: 'Junior Agent',    stars: '', threshold:  5, weeklyPay:  30000 },
    { key: 'agent',           label: 'Agent',           stars: '', threshold: 10, weeklyPay:  75000 },
    { key: 'super_agent',     label: 'Super Agent',     stars: '', threshold: 15, weeklyPay: 120000 },
    { key: 'regional_agent',  label: 'Regional Agent',  stars: '', threshold: 20, weeklyPay: 170000 },
    { key: 'national_agent',  label: 'National Agent',  stars: '', threshold: 30, weeklyPay: 220000 },
    { key: 'executive_agent', label: 'Executive Agent', stars: '', threshold: 50, weeklyPay: 280000 },
  ];
  const refs           = u.activeReferralCount || 0;
  const currentTier    = TIERS.find(t => t.key === (u.agentTier || 'member')) || TIERS[0];
  const currentTierIdx = TIERS.indexOf(currentTier);
  const nextTier       = TIERS[currentTierIdx + 1] || null;

  // Hero
  let heroHtml;
  if (u.isAgent && currentTier && currentTier.key !== 'member') {
    const agentSinceDate = u.agentSince
      ? (tsDate(u.agentSince) || new Date()).toLocaleDateString('en-UG', { day:'numeric', month:'short', year:'numeric' })
      : '—';
    const lastPay = u.lastAgentPayoutDate;
    let payoutLine = 'Next payout: Available now!';
    if (lastPay) {
      const nextMs = new Date(lastPay).getTime() + 7 * 86400000;
      if (nextMs > Date.now()) {
        const d = Math.ceil((nextMs - Date.now()) / 86400000);
        payoutLine = 'Next payout: in ' + d + ' day' + (d === 1 ? '' : 's');
      }
    }
    heroHtml = `
      <div class="ac-hero is-agent">
        <span class="ac-hero-star">${currentTier.stars}</span>
        <div class="ac-hero-tier">${currentTier.label}</div>
        <div class="ac-hero-name">${u.name || '—'}</div>
        <div class="ac-hero-meta">Agent since ${agentSinceDate}</div>
        <div class="ac-hero-payout">${payoutLine}</div>
      </div>
      <div class="ac-stats">
        <div class="ac-stat">
          <div class="ac-stat-val">${ugx(u.agentPayoutTotal || 0)}</div>
          <div class="ac-stat-lbl">Total Earned</div>
        </div>
        <div class="ac-stat">
          <div class="ac-stat-val">${ugx(currentTier.weeklyPay)}</div>
          <div class="ac-stat-lbl">Weekly Salary</div>
        </div>
      </div>`;
  } else {
    const needed = nextTier ? Math.max(nextTier.threshold - refs, 0) : 0;
    heroHtml = `
      <div class="ac-hero no-agent">
        <span class="ac-hero-star"></span>
        <div class="ac-hero-tier">Member</div>
        <div class="ac-hero-name">${u.name || '—'}</div>
        <div class="ac-hero-meta">${needed > 0 ? `Get ${needed} more active referral${needed===1?'':'s'} to become ${nextTier.stars} ${nextTier.label}` : 'Invite friends to climb the ranks!'}</div>
      </div>
      <div class="ac-stats">
        <div class="ac-stat">
          <div class="ac-stat-val">${refs}</div>
          <div class="ac-stat-lbl">Active Referrals</div>
        </div>
        <div class="ac-stat">
          <div class="ac-stat-val">${needed}</div>
          <div class="ac-stat-lbl">Needed for ${nextTier ? nextTier.label : 'Top'}</div>
        </div>
      </div>`;
  }

  // Tier cards
  const tierCards = TIERS.map((tier, idx) => {
    let state, barClass, barPct, barLabel;
    if (tier.threshold === 0 || idx <= currentTierIdx) {
      state = 'achieved'; barClass = 'gold'; barPct = 100;
      barLabel = tier.threshold === 0 ? 'All members' : tier.threshold + ' / ' + tier.threshold;
    } else if (idx === currentTierIdx + 1) {
      const prev = TIERS[currentTierIdx].threshold;
      state = 'inprogress'; barClass = 'blue';
      barPct = Math.min(Math.max((refs - prev) / (tier.threshold - prev) * 100, 0), 100);
      barLabel = refs + ' / ' + tier.threshold;
    } else {
      state = 'locked'; barClass = 'gray';
      barPct = Math.min(refs / tier.threshold * 100, 100);
      barLabel = refs + ' / ' + tier.threshold;
    }
    const pillLabel = state === 'achieved' ? '<svg class="eico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Achieved' : state === 'inprogress' ? 'In Progress' : 'Locked';
    const refsLine = tier.threshold === 0 ? 'Default rank' : tier.threshold + ' active referrals';
    return `<div class="ac-tier-card ${state}">
      <div class="ac-tier-top">
        <div class="ac-tier-info">
          <span class="ac-tier-stars">${tier.stars}</span>
          <div>
            <div class="ac-tier-name">${tier.label}</div>
            <div class="ac-tier-refs">${refsLine}</div>
          </div>
        </div>
        <span class="ac-status-pill ${state}">${pillLabel}</span>
      </div>
      <div class="ac-bar-row">
        <div class="ac-bar"><div class="ac-bar-fill ${barClass}" style="width:${Math.max(barPct, barPct > 0 ? 3 : 0)}%"></div></div>
        <span class="ac-bar-val">${barLabel}</span>
      </div>
      <div class="ac-tier-pay">Weekly salary: <b>${tier.weeklyPay > 0 ? ugx(tier.weeklyPay) : '—'}</b></div>
    </div>`;
  }).join('');

  document.getElementById('agentCentreContent').innerHTML =
    heroHtml +
    '<div class="ac-section-lbl">Agent Tier Journey</div>' +
    tierCards;
}

function renderAvatars(u) {
  const initial = (u.name || '?')[0].toUpperCase();
  [['moreAvatarInitial',52],['avatarInitial',34],['avatarInitialTop',34]].forEach(([id,size]) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (u.profilePhoto) {
      el.innerHTML = `<img src="${u.profilePhoto}" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover">`;
    } else {
      el.textContent = initial;
    }
  });
  const avatarWrap = document.getElementById('moreAvatarWrap');
  if (avatarWrap) avatarWrap.classList.toggle('agent-ring', !!u.isAgent);
}

// ── NAVIGATION ──
window.showSection = (sec) => {
  const secMap = { home:'homeSection', products:'productsSection', invest:'recordsSection', records:'recordsSection', commission:'commissionSection', more:'moreSection' };
  const navMap = { home:'home', products:'products', invest:'records', records:'records', commission:'commission', more:'more' };
  const titleMap = { products:'Power Assets', commission:'My Network', records:'My Activity', more:'Account' };
  const ptEl = document.getElementById('pageTitle');
  if (ptEl && titleMap[sec]) ptEl.textContent = titleMap[sec];
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.getElementById(secMap[sec] || sec + 'Section')?.classList.add('active');
  document.querySelectorAll('.bnav-item').forEach(b => {
    b.classList.toggle('active', b.dataset.sec === (navMap[sec] || sec));
  });
  // topbar only visible on non-home sections
  const tb = document.getElementById('mainTopbar');
  if (tb) tb.style.display = (sec === 'home') ? 'none' : 'flex';
  if (sec === 'records' || sec === 'invest') {
    document.querySelectorAll('.pill-tab').forEach((b, i) => b.classList.toggle('active', i === 0));
    loadRecords('deposits');
  }
  window.scrollTo(0, 0);
};

// ── CHECK-IN ──
window.doCheckin = async () => {
  if (!_user || !_userData) return;
  const eat = new Date(Date.now() + 3*60*60*1000);
  const todayKey = eat.toISOString().slice(0,10);
  if (_userData.lastCheckinDate === todayKey) { showToast('Already checked in today!', 'error'); return; }
  if (_userData.status === 'banned') { showToast('Account suspended', 'error'); return; }
  showLoading(true);
  try {
    const r = await api('/checkin', { userId: _user.uid });
    showLoading(false);
    if (r.status === 'success') showToast(`UGX ${(r.bonus||500).toLocaleString()} credited! Day ${r.streak}`, 'success');
    else showToast(r.message || 'Check-in failed', 'error');
  } catch (e) {
    showLoading(false);
    showToast('Network error', 'error');
  }
};

// ── PRODUCTS ──
async function loadProducts() {
  try {
    const r = await (await fetch(SERVER + '/products')).json();
    renderProducts(r.status === 'success' ? r.products : []);
  } catch (e) { console.error('Load products:', e); }
}

function renderProducts(products) {
  const grid = document.getElementById('productsGrid');
  // Update banner stats
  const countEl   = document.getElementById('prodBannerCount');
  const benefitEl = document.getElementById('prodBannerBenefit');
  if (countEl)   countEl.textContent   = products.length;
  if (benefitEl) {
    const maxReturn = products.reduce((m,p) => Math.max(m, p.expectedReturn||0), 0);
    benefitEl.textContent = maxReturn ? ugx(maxReturn) : '—';
  }
  if (!products.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><span class="es-icon">${ICN.box}</span><p>No assets available yet</p></div>`;
    return;
  }
  products.sort((a,b) => (a.displayOrder||999) - (b.displayOrder||999));

  const cardHtml = (p) => {
    const inStock  = p.isInStock !== false;
    const stars    = p.stars || 0;
    const starStr  = stars ? '<svg class="eico" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3 6.5 7 .9-5 4.8 1.3 7L12 18l-6.3 3.2L7 14.2 2 9.4l7-.9z"/></svg>'.repeat(Math.round(stars)) : '';
    const imgHtml  = p.image
      ? `<img src="${p.image}" alt="${p.name}" decoding="async" loading="lazy">`
      : `<span class="no-img">${ICN.box}</span>`;
    return `<div class="product-card" onclick="openProductModal('${p.id}')">
      <div class="product-img-wrap">${imgHtml}</div>
      <div class="product-body">
        <div class="product-name">${p.name}</div>
        <div class="product-meta-row">Runs for ${p.cycle||0} days</div>
        <div class="product-meta-row">Daily output: <span class="pv">${ugx(p.dailyReturn)}</span></div>
        <div class="product-meta-row">Total return: <span class="pv">${ugx(p.expectedReturn)}</span></div>
        <div class="product-price-row">${starStr ? `<span class="product-stars">${starStr}</span> <span style="font-size:11px;color:var(--text2)">${stars}</span>` : ''} Cost: ${ugx(p.price)}</div>
      </div>
      <span class="product-stock ${inStock?'in':'out'}">${inStock?'Available':'Sold Out'}</span>
      <button class="product-cart" ${inStock?'':'disabled'} onclick="event.stopPropagation();openProductModal('${p.id}')">
        <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="28" height="17" rx="4"/><text x="16" y="15" text-anchor="middle" font-family="system-ui,sans-serif" font-weight="900" font-size="11" fill="currentColor" stroke="none">BUY</text><path d="M16 20v5"/><path d="M11 28c1-3 10-3 10 0"/></svg>
      </button>
    </div>`;
  };

  // Voltra organises machines into power tiers instead of one flat list
  const tiers = [
    { icon:'<svg class="eico" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z"/></svg>', name:'Starter Assets', desc:'Low entry · quick cycles',        test:p => (p.price||0) <  100000 },
    { icon:'<svg class="eico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="16" height="10" rx="2"/><line x1="22" y1="11" x2="22" y2="13"/><line x1="6" y1="11" x2="6" y2="13"/><line x1="10" y1="11" x2="10" y2="13"/></svg>', name:'Power Assets',   desc:'Mid-range · bigger daily output', test:p => (p.price||0) >= 100000 && (p.price||0) < 700000 },
    { icon:'<svg class="eico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 20h20V9l-6 4V9l-6 4V4H4z"/><line x1="7" y1="20" x2="7" y2="16"/></svg>', name:'Elite Assets',   desc:'High capital · maximum return',   test:p => (p.price||0) >= 700000 },
  ];

  let html = '';
  tiers.forEach(t => {
    const items = products.filter(t.test);
    if (!items.length) return;
    html += `<div class="prod-group-head"><div class="pgh-title">${t.icon} ${t.name}</div><div class="pgh-desc">${t.desc}</div></div>`;
    html += `<div class="prod-group">${items.map(cardHtml).join('')}</div>`;
  });
  grid.innerHTML = html;
}

window.openProductModal = async (productId) => {
  try {
    const r = await (await fetch(SERVER + '/products/' + productId)).json();
    if (r.status !== 'success') return;
    _currentProduct = r.product;
    const p = _currentProduct;
    const inStock = p.isInStock !== false;
    document.getElementById('productModalName').textContent = p.name;
    const imgWrap = document.getElementById('productModalImgWrap');
    if (p.image) {
      imgWrap.innerHTML = `<img src="${p.image}" alt="${p.name}" style="width:100%;height:100%;object-fit:cover;border-radius:12px">`;
    } else {
      imgWrap.innerHTML = ICN.box;
    }
    document.getElementById('pmPrice').textContent  = ugx(p.price);
    document.getElementById('pmDaily').textContent  = ugx(p.dailyReturn);
    document.getElementById('pmCycle').textContent  = p.cycle + ' days';
    document.getElementById('pmReturn').textContent = ugx(p.expectedReturn);
    document.getElementById('pmWalletNote').textContent = `Your wallet: ${ugx(_userData?.walletBalance || 0)}` + (!inStock ? ' — This plan is currently sold out' : '');
    const btn = document.getElementById('pmBuyBtn');
    btn.textContent = inStock ? 'Confirm Investment' : 'Sold Out';
    btn.disabled    = !inStock;
    openModal('productModal');
  } catch (e) { showToast('Failed to load plan', 'error'); }
};

window.confirmBuy = async () => {
  if (!_currentProduct || !_user) return;
  const p = _currentProduct;
  if (p.isInStock === false) { showToast('This plan is sold out', 'error'); return; }
  if ((_userData?.walletBalance || 0) < p.price) {
    showToast(`Insufficient balance. Need ${ugx(p.price)}, have ${ugx(_userData?.walletBalance||0)}`, 'error'); return;
  }
  if (!confirm(`Invest ${ugx(p.price)} in ${p.name}?`)) return;
  closeModal('productModal');
  showLoading(true);
  try {
    const r = await api('/invest/create', { userId: _user.uid, productId: p.id });
    showLoading(false);
    if (r.status === 'success') showToast(r.message, 'success');
    else showToast(r.message || 'Investment failed', 'error');
  } catch (e) { showLoading(false); showToast('Network error', 'error'); }
};

// ── CLAIM INVESTMENT ──
window.claimInvestment = async (invId) => {
  if (!_user) return;
  if (!confirm('Claim your returns now?')) return;
  showLoading(true);
  try {
    const r = await api('/invest/claim', { userId: _user.uid, investmentId: invId });
    showLoading(false);
    if (r.status === 'success') showToast(r.message, 'success');
    else showToast(r.message || 'Claim failed', 'error');
  } catch (e) { showLoading(false); showToast('Network error', 'error'); }
};

// ── INVESTMENT DETAIL MODAL ──
let _invCache = {};
window.openInvDetail = async (invId) => {
  openModal('invDetailModal');
  const body = document.getElementById('invDetailBody');
  body.innerHTML = '<div class="load-spin" style="margin:24px auto"></div>';
  try {
    let inv = _invCache[invId];
    if (!inv) {
      const r = await (await fetch(SERVER + '/investment/' + invId)).json();
      if (r.status !== 'success') { body.innerHTML = '<p style="color:var(--text2);text-align:center">Plan not found</p>'; return; }
      inv = r.investment;
      _invCache[invId] = inv;
    }
    const matured  = inv.status === 'matured';
    const claimed  = inv.status === 'claimed';
    const cycle    = inv.cycle || inv.durationDays || 1;
    const totalMs  = cycle * 86400000;
    const msLeft   = inv.maturityDate ? Math.max(0, tsMs(inv.maturityDate) - Date.now()) : 0;
    const daysLeft = Math.ceil(msLeft / 86400000);
    const hoursLeft = Math.ceil(msLeft / 3600000);
    const timeLeftStr = msLeft <= 0 ? '0 hrs remaining'
      : msLeft < 86400000 ? hoursLeft + ' hr' + (hoursLeft !== 1 ? 's' : '') + ' remaining'
      : daysLeft + ' day' + (daysLeft !== 1 ? 's' : '') + ' remaining';
    const msElapsed   = Math.max(0, totalMs - msLeft);
    const daysElapsed = Math.floor(msElapsed / 86400000);
    // A plan whose cashback has fully paid out is complete even if the clock
    // has a few hours left; the server marks these 'claimed', this is a guard
    // for the brief window before the next maturity sweep runs.
    const fullyPaid   = (inv.expectedReturn || 0) > 0 && (inv.dailyCredited || 0) >= inv.expectedReturn;
    const progress    = matured || claimed || fullyPaid ? 100 : Math.min(100, Math.max(0, Math.round(msElapsed / totalMs * 100)));
    const imgHtml  = inv.productImage ? `<img src="${inv.productImage}" alt="" style="width:64px;height:64px;border-radius:12px;object-fit:cover;margin-bottom:12px">` : '';
    const stateBadge = claimed ? '<span class="inv-badge claimed">Claimed</span>'
                     : matured ? '<span class="inv-badge matured">Matured</span>'
                     : '<span class="inv-badge active">Active</span>';
    const claimBtn = matured ? `<button class="btn-submit" style="margin-top:16px" onclick="closeModal('invDetailModal');claimInvestment('${inv.id}')"> Claim Return — ${ugx(inv.expectedReturn)}</button>` : '';
    body.innerHTML = `
      <div style="text-align:center">${imgHtml}</div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <div style="font-size:17px;font-weight:800;color:var(--text)">${inv.productName||'Plan'}</div>
        ${stateBadge}
      </div>
      <div class="rec-row"><span class="rec-row-lbl">Amount Invested</span><span class="rec-row-val">${ugx(inv.amount)}</span></div>
      <div class="rec-row"><span class="rec-row-lbl">Expected Return</span><span class="rec-row-val s-green">+${ugx(inv.expectedReturn)}</span></div>
      <div class="rec-row"><span class="rec-row-lbl">Profit</span><span class="rec-row-val s-green">+${ugx((inv.expectedReturn||0)-(inv.amount||0))}</span></div>
      <div class="rec-row"><span class="rec-row-lbl">Daily Cashback</span><span class="rec-row-val s-green">+${ugx(inv.dailyReturn||0)}/day</span></div>
      <div class="rec-row"><span class="rec-row-lbl">Paid to wallet</span><span class="rec-row-val s-green">+${ugx(inv.dailyCredited||0)}</span></div>
      <div class="rec-row"><span class="rec-row-lbl">Remaining at maturity</span><span class="rec-row-val">${ugx(Math.max(0,(inv.expectedReturn||0)-(inv.dailyCredited||0)))}</span></div>
      <div class="rec-row"><span class="rec-row-lbl">Date Started</span><span class="rec-row-val">${inv.date||'—'}</span></div>
      <div class="rec-row"><span class="rec-row-lbl">Investment Duration</span><span class="rec-row-val"><strong>${cycle} day${cycle!==1?'s':''}</strong></span></div>
      <div class="rec-row"><span class="rec-row-lbl">Matures On</span><span class="rec-row-val">${inv.maturityDate ? (tsDate(inv.maturityDate)||new Date()).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}) : '—'}</span></div>
      <div class="rec-row"><span class="rec-row-lbl">Time Left</span><span class="rec-row-val" style="color:${claimed?'var(--text2)':matured||fullyPaid?'#22c55e':'var(--blue)'}">${claimed ? 'Completed' : matured ? '<svg class="eico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Matured — Claim now!' : fullyPaid ? 'Fully paid out' : timeLeftStr}</span></div>
      <div class="rec-row"><span class="rec-row-lbl">Plan Day</span><span class="rec-row-val">${claimed||matured||fullyPaid ? 'Day '+cycle+' of '+cycle : 'Day '+Math.min(cycle, daysElapsed+1)+' of '+cycle}</span></div>
      <div style="margin:14px 0 6px;display:flex;align-items:center;justify-content:space-between">
        <span style="font-size:12px;color:var(--text2)">Progress</span>
        <span style="font-size:12px;font-weight:700;color:${matured||claimed||fullyPaid?'#22c55e':'#ff9d00'}">${progress}%</span>
      </div>
      <div style="background:var(--border);border-radius:99px;height:10px;overflow:hidden">
        <div style="background:${matured||claimed||fullyPaid?'#22c55e':'#ff9d00'};height:100%;width:${progress}%;border-radius:99px;transition:width .4s"></div>
      </div>
      ${claimBtn}`;
  } catch(e) { body.innerHTML = '<p style="color:var(--red);text-align:center">Failed to load details</p>'; }
};

// ── RECORDS ──
let _recordTab = 'income', _recToken = 0;
window.switchRecord = (tab, btn) => {
  _recordTab = tab;
  document.querySelectorAll('.pill-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  loadRecords(tab);
};

function orderRef(tx) {
  const d = tsDate(tx.createdAt);
  if (d) {
    const p = n => String(n).padStart(2,'0');
    return 'T'+d.getFullYear()+p(d.getMonth()+1)+p(d.getDate())+p(d.getHours())+p(d.getMinutes())+p(d.getSeconds())+String(d.getMilliseconds()).padStart(3,'0');
  }
  return tx.id ? tx.id.slice(0,20) : 'T——';
}

function fmtDT(tx) {
  const d = tsDate(tx.createdAt);
  if (d) {
    const p = n => String(n).padStart(2,'0');
    return `${p(d.getDate())}/${p(d.getMonth()+1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }
  return ((tx.date||'') + (tx.time ? ' '+tx.time : '')).trim() || '—';
}

function statusCls(s) {
  if (!s) return 's-orange';
  const v = s.toLowerCase();
  if (v==='success'||v==='approved') return 's-green';
  if (v==='failed'||v==='rejected') return 's-red';
  return 's-orange';
}

function statusLabel(s) {
  const m={success:'Success',approved:'Approved',pending:'Payment in progress',failed:'Failed',rejected:'Rejected'};
  return m[s?.toLowerCase()] || (s||'Pending');
}

// compact expandable record row (tap to reveal details)
function recRow({ icon, title, sub, amt, amtClass = '', status = '', statusCls = '', details = [] }) {
  const det = details.filter(d => d.v != null && d.v !== '')
    .map(d => `<div class="rd-line"><span>${d.k}</span><span>${d.v}</span></div>`).join('');
  return `<div class="rrow" onclick="this.classList.toggle('open')">
    <div class="rrow-top">
      <div class="rrow-ico">${icon}</div>
      <div class="rrow-main"><div class="rrow-title">${title}</div><div class="rrow-sub">${sub || ''}</div></div>
      <div class="rrow-end"><div class="rrow-amt ${amtClass}">${amt}</div>${status ? `<div class="rrow-pill ${statusCls}">${status}</div>` : ''}</div>
    </div>
    ${det ? `<div class="rrow-details">${det}</div>` : ''}
  </div>`;
}

async function loadRecords(tab) {
  if (!_user) return;
  _recordTab = tab;
  const myToken = ++_recToken;
  const el = document.getElementById('recordsContent');
  el.innerHTML = '<div class="empty-state"><div class="load-spin" style="margin:0 auto 12px"></div><p>Loading…</p></div>';
  try {
    // ── PLANS ──
    if (tab === 'investments') {
      const rr = await api('/account/investments', { userId: _user.uid });
      if (myToken !== _recToken) return;
      const items = rr.status === 'success' ? rr.investments : [];
      if (!items.length) { el.innerHTML = `<div class="empty-state"><span class="es-icon">${ICN.box}</span><p>No investment plans yet</p></div>`; return; }
      el.innerHTML = items.map(inv => {
        const matured=inv.status==='matured', claimed=inv.status==='claimed';
        const badge = matured?'<span class="ast-badge ok">Matured</span>':claimed?'<span class="ast-badge done">Claimed</span>':'<span class="ast-badge live">Running</span>';
        const cyc = inv.cycle || inv.durationDays || 0;
        const dl  = inv.maturityDate ? Math.max(0, Math.ceil((tsMs(inv.maturityDate) - Date.now()) / 86400000)) : 0;
        const elapsed = Math.max(0, Math.min(cyc, cyc - dl));
        const pct = cyc ? Math.round(elapsed / cyc * 100) : (claimed||matured?100:0);
        const tStr = claimed ? 'Completed' : matured ? 'Ready to claim' : `${dl} day${dl!==1?'s':''} left`;
        return `<div class="ast-card" onclick="openInvDetail('${inv.id}')">
          <div class="ast-hd"><div class="ast-name"><svg class="eico" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z"/></svg> ${inv.productName||'Asset'}</div>${badge}</div>
          <div class="ast-figs">
            <div class="ast-fig"><b>${ugx(inv.dailyReturn||Math.round((inv.expectedReturn||0)/(cyc||1)))}</b><span>Daily output</span></div>
            <div class="ast-fig"><b>${ugx(inv.expectedReturn)}</b><span>Total return</span></div>
            <div class="ast-fig"><b>${cyc}d</b><span>Cycle</span></div>
          </div>
          <div class="ast-bar"><div class="ast-bar-fill" style="width:${pct}%"></div></div>
          <div class="ast-foot"><span>Day ${elapsed} of ${cyc}</span><span class="${matured?'s-green':''}">${tStr}</span></div>
        </div>`;
      }).join('');
      return;
    }
    // ── WITHDRAWALS — read directly from withdrawals collection for live status ──
    if (tab === 'withdrawals') {
      const wr = await api('/account/withdrawals', { userId: _user.uid });
      if (myToken !== _recToken) return;
      const witems = wr.status === 'success' ? wr.withdrawals : [];
      if (!witems.length) { el.innerHTML = `<div class="empty-state"><span class="es-icon">${ICN.chart}</span><p>No withdrawals yet</p></div>`; return; }
      el.innerHTML = witems.map(w => {
        const net   = w.netAmount != null ? w.netAmount : Math.round((w.amount||0) * 0.93);
        const phone = w.withdrawalPhone || w.phone || '—';
        return recRow({
          icon: '<svg class="eico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="6 11 12 5 18 11"/></svg>', title: 'Payout', sub: `${w.date||''} · ${w.time||fmtDT(w)}`,
          amt: '−' + ugx(w.amount), amtClass: 's-red',
          status: statusLabel(w.status), statusCls: statusCls(w.status),
          details: [
            { k:'Order Ref', v: orderRef(w) },
            { k:'Send to', v: phone },
            { k:'You receive', v: ugx(net) },
            { k:'Reason', v: w.rejectionReason }
          ]
        });
      }).join('');
      return;
    }

    // ── OTHER TRANSACTION RECORDS ──
    const tr = await api('/account/transactions', { userId: _user.uid });
    if (myToken !== _recToken) return; // newer tab was selected while awaiting
    const all = tr.status === 'success' ? tr.transactions : [];
    const REVENUE_TYPES = ['checkin','cashback','commission','gift_code','investment_return','admin_credit'];
    const items = tab === 'deposits'  ? all.filter(t => t.type === 'deposit' || t.type === 'admin_credit')
               : tab === 'referrals' ? all.filter(t => t.type === 'commission')
               : tab === 'revenue'   ? all.filter(t => REVENUE_TYPES.includes(t.type))
               : all;
    if (!items.length) {
      const emptyMsg = tab === 'referrals'
        ? 'No referral earnings yet.<br>Share your invite code to earn commissions!'
        : 'No records yet';
      el.innerHTML = `<div class="empty-state"><span class="es-icon">${ICN.chart}</span><p>${emptyMsg}</p></div>`;
      return;
    }

    if (tab === 'deposits') {
      el.innerHTML = items.map(tx => {
        const typeLabel = tx.type === 'admin_credit' ? 'Admin Credit' : 'Recharge';
        return recRow({
          icon: '<svg class="eico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="6 13 12 19 18 13"/></svg>', title: typeLabel, sub: `${tx.date||''} · ${tx.time||fmtDT(tx)}`,
          amt: '+' + ugx(tx.amount), amtClass: 's-green',
          status: statusLabel(tx.status||'success'), statusCls: statusCls(tx.status||'success'),
          details: [
            { k:'Order ID', v: tx.id },
            { k:'Type', v: typeLabel },
            { k:'Note', v: tx.description }
          ]
        });
      }).join('');
    } else if (tab === 'revenue') {
      const totalCashback = items.reduce((s, t) => s + (t.amount || 0), 0);
      const typeIcon  = { checkin:_ICN_CHECKIN, cashback:_ICN_COINS, commission:_ICN_PEOPLE, gift_code:_ICN_GIFT, investment_return:_ICN_TREND, admin_credit:_ICN_BANK, reversal:_ICN_UNDO };
      const typeLabel = { checkin:'Daily Spark', cashback:'Daily Cashback', commission:'Team Bonus', gift_code:'Gift Code', investment_return:'Asset Payout', admin_credit:'Admin Credit', reversal:'Recharge Reversed' };
      el.innerHTML = `
        <div class="rev-hero">
          <div class="rev-hero-lbl">Total Inbound Balance</div>
          <div class="rev-hero-amt">${ugx(totalCashback)}</div>
          <div class="rev-hero-sub">${items.length} payout${items.length !== 1 ? 's' : ''}</div>
        </div>` +
        items.map(tx => recRow({
          icon: typeIcon[tx.type] || _ICN_COINS, title: typeLabel[tx.type] || tx.type,
          sub: `${tx.date||''} · ${tx.time||fmtDT(tx)}`,
          amt: '+' + ugx(tx.amount), amtClass: 's-green',
          details: [ { k:'Detail', v: tx.description } ]
        })).join('');
    } else if (tab === 'referrals') {
      el.innerHTML = items.map(tx => recRow({
        icon: '<svg class="eico" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="7" r="3.2"/><circle cx="17" cy="9" r="2.6"/><path d="M2.5 19c0-3.3 2.9-5.5 6.5-5.5s6.5 2.2 6.5 5.5v.5h-13z"/><path d="M16.5 13.2c2.7.2 5 2 5 4.8v1h-4v-1c0-1.9-.9-3.6-2.3-4.6.4-.1.9-.2 1.3-.2z"/></svg>', title: 'Team Bonus', sub: fmtDT(tx),
        amt: '+' + ugx(tx.amount), amtClass: 's-green',
        status: 'Success', statusCls: 's-green',
        details: [ { k:'Order Ref', v: orderRef(tx) }, { k:'From', v: tx.description||'Affiliate' } ]
      })).join('');
    } else {
      el.innerHTML = items.map(tx => {
        const pos = tx.amount > 0;
        return recRow({
          icon: pos ? '<svg class="eico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="6 13 12 19 18 13"/></svg>' : '<svg class="eico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="6 11 12 5 18 11"/></svg>', title: tx.description||tx.type||'Transaction', sub: fmtDT(tx),
          amt: (pos?'+':'') + ugx(tx.amount), amtClass: pos?'s-green':'s-red',
          status: statusLabel(tx.status), statusCls: statusCls(tx.status),
          details: [ { k:'Order Ref', v: orderRef(tx) } ]
        });
      }).join('');
    }
  } catch (e) {
    if (myToken !== _recToken) return;
    el.innerHTML = `<div class="empty-state"><span class="es-icon">${ICN.warn}</span><p>Failed to load. Tap a tab to retry.</p></div>`;
    console.error('loadRecords error:', e);
  }
}

// ── REFERRAL ──
// Canonical public site — invite links must point here, NOT at whatever
// origin we happen to be running under (EdgeOne URL / GoDaddy iframe).
const VOLTRA_SITE = 'https://www.nexus-ug.site/';

// Clipboard copy that ALSO works inside iframes (GoDaddy domain masking),
// where navigator.clipboard is blocked. Falls back to a hidden textarea
// + execCommand('copy'), which iframes still allow.
function copyText(text) {
  return new Promise((resolve) => {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(() => resolve(true)).catch(() => resolve(legacyCopy(text)));
    } else {
      resolve(legacyCopy(text));
    }
  });
}
function legacyCopy(text) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none;';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch (e) { return false; }
}

window.copyRefCode = () => {
  const code = _userData?.referralCode || '';
  if (!code) return;
  copyText(code).then(ok => showToast(ok ? 'Referral code copied!' : code, ok ? 'success' : ''));
};
window.shareRefLink = () => {
  const code = _userData?.referralCode || '';
  const link = VOLTRA_SITE + '?ref=' + code;
  const text = `Join Voltra and earn returns!\n\nUse my referral code: ${code}\nSign up here: ${link}`;
  if (navigator.share) {
    navigator.share({ title: 'Voltra', text, url: link }).catch(() => {});
  } else {
    copyText(text).then(ok => showToast(ok ? 'Share link copied!' : link, ok ? 'success' : ''));
  }
};

// ── TEAM MEMBERS MODAL ──
window.openTeamMembersModal = async () => {
  const body = document.getElementById('teamMembersBody');
  body.innerHTML = '<div style="text-align:center;padding:32px 0;color:var(--text2);font-size:13px">Loading…</div>';
  openModal('teamMembersModal');
  try {
    const r = await api('/team/members', { userId: _user.uid });
    const members = r.members || [];
    if (!members.length) {
      body.innerHTML = '<div style="text-align:center;padding:32px 0;color:var(--text2);font-size:13px">No team members yet.<br><span style="font-size:11px;opacity:.7">Share your referral code to grow your team.</span></div>';
      return;
    }
    body.innerHTML = `
      <div style="font-size:11px;color:var(--text2);margin-bottom:12px">${members.length} member${members.length!==1?'s':''} — direct referrals only</div>
      ${members.map(m => {
        const initials = (m.name||'U').slice(0,2).toUpperCase();
        const joined = m.joinedAt ? new Date(m.joinedAt).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}) : '—';
        const badge = m.hasInvested
          ? `<span style="font-size:10px;font-weight:700;color:#22c55e;background:rgba(34,197,94,.12);border:1px solid rgba(34,197,94,.25);border-radius:5px;padding:2px 7px">Invested</span>`
          : `<span style="font-size:10px;font-weight:600;color:var(--muted);background:var(--card2);border:1px solid var(--border2);border-radius:5px;padding:2px 7px">Not invested</span>`;
        return `<div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--border2)">
          <div style="width:40px;height:40px;border-radius:50%;background:var(--bluefade);color:var(--blue);display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:800;flex-shrink:0">${initials}</div>
          <div style="flex:1;min-width:0">
            <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:2px">${m.name}</div>
            <div style="font-size:11px;color:var(--text2)">${m.phone} · Joined ${joined}</div>
          </div>
          <div>${badge}</div>
        </div>`;
      }).join('')}`;
  } catch(e) {
    body.innerHTML = '<div style="text-align:center;padding:32px 0;color:var(--red);font-size:13px">Failed to load team</div>';
  }
};

// ── PAGE NAVIGATION ──
window.openPage = (id) => {
  const el = document.getElementById(id);
  el.style.display = 'block';
  requestAnimationFrame(() => requestAnimationFrame(() => { el.classList.add('open'); el.scrollTop = 0; }));
};
window.closePage = (id) => {
  const el = document.getElementById(id);
  el.classList.remove('open');
  el.addEventListener('transitionend', () => { el.style.display = 'none'; }, { once: true });
};

// ── DEPOSIT PAGE ──
let _depPollTimer   = null;
let _depDepositId   = null;
let _depUnsubscribe = null;

function depDetectNetwork(phone) {
  const d = String(phone||'').replace(/\D/g,'');
  const p9 = d.startsWith('256') ? d.slice(3) : d.startsWith('0') ? d.slice(1) : d;
  const p2 = p9.slice(0,2);
  return ['77','78','76','31','39','79'].includes(p2) ? 'MTN' : 'Airtel';
}

let _depMinDeposit = 30000;
async function loadDepConfig() {
  try {
    const r = await (await fetch(SERVER + '/deposit/config')).json();
    if (r.status === 'success') _depMinDeposit = r.minDeposit || 30000;
  } catch (_) {}
  const badge = document.getElementById('depWalBadge');
  if (badge) {
    const wrap = badge.closest('.page-bal-badge');
    if (wrap) wrap.innerHTML = `Wallet: <span id="depWalBadge">${ugx(_userData?.walletBalance||0)}</span> &nbsp;·&nbsp; Min ${ugx(_depMinDeposit)}`;
  }
}

function stopDepTimers() {
  if (_depPollTimer)   { clearInterval(_depPollTimer); _depPollTimer = null; }
  if (_depUnsubscribe) { _depUnsubscribe(); _depUnsubscribe = null; }
}

function showDepStep(n) {
  ['depStep1','depStep2','depStep3Success','depStep3Failed'].forEach((id, i) => {
    document.getElementById(id).style.display = (i + 1 === n) ? 'block' : 'none';
  });
}

function launchConfetti() {
  const el = document.getElementById('depConfetti');
  if (!el) return;
  const colors = ['#f59e0b','#22c55e','#ffb84d','#ec4899','#8b5cf6','#ef4444','#f97316'];
  el.innerHTML = '';
  for (let i = 0; i < 55; i++) {
    const p = document.createElement('div');
    const c = colors[Math.floor(Math.random() * colors.length)];
    const w = 4 + Math.random() * 7, h = w * 1.4;
    p.style.cssText = `position:absolute;width:${w}px;height:${h}px;background:${c};border-radius:2px;left:${Math.random()*100}%;top:-${h}px;animation:confettiFall ${1.2+Math.random()}s ease-in ${Math.random()*1.2}s both;transform:rotate(${Math.random()*360}deg)`;
    el.appendChild(p);
  }
}

window.openDepositPage = () => {
  if (!_userData) return;
  stopDepTimers();
  _depDepositId = null;
  showDepStep(1);
  document.getElementById('depPageTitle').textContent = 'Recharge Account';
  document.getElementById('depBackBtn').onclick = () => closePage('depositPage');
  document.getElementById('depAmount').value = '';
  const btn = document.getElementById('depProceedBtn');
  btn.disabled = false; btn.innerHTML = _BOLT + ' Charge Wallet';

  // Pre-fill with profile phone (9 digits)
  const savedDigits = (_userData.phone || '').replace(/^\+256/, '').replace(/^0/, '').replace(/\D/g,'').slice(0,9);
  const phoneInput = document.getElementById('depSenderPhone');
  if (phoneInput) phoneInput.value = savedDigits;

  loadDepConfig(); // refresh min deposit + wallet balance badge
  openPage('depositPage');
};

// Strip non-digits as user types
setTimeout(() => {
  const inp = document.getElementById('depSenderPhone');
  if (inp) inp.addEventListener('input', () => { inp.value = inp.value.replace(/\D/g,'').slice(0,9); });
}, 500);

window.proceedDeposit = async () => {
  if (!_user || !_userData) return;
  const amount   = parseInt(document.getElementById('depAmount').value, 10);
  const digits9  = (document.getElementById('depSenderPhone').value || '').replace(/\D/g,'').slice(0,9);
  if (!amount || amount < _depMinDeposit) { showToast(`Minimum recharge is ${ugx(_depMinDeposit)}`, 'error'); return; }
  if (digits9.length !== 9)   { showToast('Enter a valid 9-digit MoMo number', 'error'); return; }

  const btn = document.getElementById('depProceedBtn');
  btn.disabled = true; btn.textContent = 'Requesting payment…';
  try {
    const r = await api('/deposit/marzpay', { userId: _user.uid, amount, phone: '256' + digits9 });
    if (r.status !== 'success') {
      btn.disabled = false; btn.innerHTML = _BOLT + ' Charge Wallet';
      showToast(r.message || 'Failed. Try again.', 'error');
      return;
    }
    _depDepositId = r.depositId;
    document.getElementById('depWaitPhone').textContent  = r.phone || ('+256' + digits9) || '—';
    document.getElementById('depWaitAmount').textContent = ugx(r.amount);
    document.getElementById('depPageTitle').textContent  = 'Waiting for Payment';
    document.getElementById('depBackBtn').onclick = () => cancelDepWait();
    showDepStep(2);
    startDepPolling();
  } catch (e) {
    btn.disabled = false; btn.innerHTML = _BOLT + ' Charge Wallet';
    showToast('Network error. Try again.', 'error');
  }
};

window.cancelDepWait = () => {
  stopDepTimers(); _depDepositId = null; _depResolved = false;
  showDepStep(1);
  document.getElementById('depPageTitle').textContent = 'Recharge Account';
  document.getElementById('depBackBtn').onclick = () => closePage('depositPage');
  const btn = document.getElementById('depProceedBtn');
  btn.disabled = false; btn.innerHTML = _BOLT + ' Charge Wallet';
};

window.retryDeposit = () => {
  _depResolved = false;
  showDepStep(1);
  document.getElementById('depPageTitle').textContent = 'Recharge Account';
  document.getElementById('depBackBtn').onclick = () => closePage('depositPage');
  const btn = document.getElementById('depProceedBtn');
  btn.disabled = false; btn.innerHTML = _BOLT + ' Charge Wallet';
};

// Deposit result handler — called by either Firestore listener or HTTP poll.
let _depResolved = false;
function handleDepResult(status, creditedAmount, amount) {
  if (_depResolved) return;
  if (status === 'matched') {
    _depResolved = true;
    stopDepTimers();
    document.getElementById('depSuccessAmt').textContent = ugx(creditedAmount || amount);
    document.getElementById('depPageTitle').textContent  = 'Payment Received';
    document.getElementById('depBackBtn').onclick = () => closePage('depositPage');
    showDepStep(3); launchConfetti(); loadUser();
  } else if (status === 'failed') {
    _depResolved = true;
    stopDepTimers();
    document.getElementById('depPageTitle').textContent = 'Payment Failed';
    document.getElementById('depBackBtn').onclick = () => closePage('depositPage');
    showDepStep(4);
  } else if (status === 'cancelled') {
    _depResolved = true;
    stopDepTimers();
  }
}

// HTTP poll every 2 s; server checks MarzPay status and reads MongoDB.
function startDepPolling() {
  stopDepTimers();
  _depResolved = false;
  if (!_depDepositId) return;

  _depPollTimer = setInterval(async () => {
    if (_depResolved) return;
    try {
      const r = await (await fetch(SERVER + '/deposit/status/' + _depDepositId)).json();
      if (r.status === 'success') {
        const d = r.deposit;
        handleDepResult(d.depositStatus, d.creditedAmount, d.amount);
      }
    } catch (_) {}
  }, 2000);
}

// ── WITHDRAW PAGE ──
window.openWithdrawPage = () => {
  if (!_userData) return;
  document.getElementById('witBalBadge').textContent = ugx(_userData.walletBalance);
  document.getElementById('witAmount').value = '';
  document.getElementById('witPhone').value  = '';
  document.getElementById('witFeeRow').style.display = 'none';

  // Render saved bank accounts as tappable cards
  const accounts = _userData.bankAccounts || [];
  const wrap = document.getElementById('witAccountsWrap');
  const list = document.getElementById('witAccList');
  const lbl  = document.getElementById('witPhoneLbl');
  if (accounts.length) {
    wrap.style.display = 'block';
    lbl.textContent = 'Or enter phone manually';
    list.innerHTML = accounts.map((a, i) => `
      <div class="wit-acc-card" id="witAcc${i}" onclick="pickWitAccount(${i},'${String(a.phone).replace(/'/g,'')}')">
        <div class="wit-acc-ico"><svg viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13 19.79 19.79 0 0 1 1.63 4.4 2 2 0 0 1 3.6 2h3a2 2 0 0 1 2 1.72c.13 1 .36 1.98.71 2.93a2 2 0 0 1-.45 2.11L7.91 9.91A16 16 0 0 0 14.09 16l.91-.91a2 2 0 0 1 2.11-.45c.95.35 1.93.58 2.93.71A2 2 0 0 1 22 16.92z"/></svg></div>
        <div class="wit-acc-info">
          <div class="wit-acc-name">${a.name}</div>
          <div class="wit-acc-num">+256 ${a.phone}</div>
        </div>
        <div class="wit-acc-chk" id="witChk${i}"><svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg></div>
      </div>`).join('');
  } else {
    wrap.style.display = 'none';
    lbl.textContent = 'Receive on Phone';
  }
  openPage('withdrawPage');
};

window.pickWitAccount = (idx, phone) => {
  const accounts = _userData?.bankAccounts || [];
  accounts.forEach((_, i) => {
    const c = document.getElementById('witAcc' + i);
    const k = document.getElementById('witChk' + i);
    if (c) c.classList.remove('sel');
    if (k) k.style.display = 'none';
  });
  const card = document.getElementById('witAcc' + idx);
  const chk  = document.getElementById('witChk' + idx);
  if (card) card.classList.add('sel');
  if (chk)  chk.style.display = 'block';
  const num = String(phone).replace(/\D/g,'').replace(/^256/,'').replace(/^0/,'');
  document.getElementById('witPhone').value = num;
};

window.updateWitFee = () => {
  const raw = parseInt(document.getElementById('witAmount').value, 10);
  const row = document.getElementById('witFeeRow');
  if (!raw || raw <= 0) { row.style.display = 'none'; return; }
  const fee = Math.round(raw * 0.07);
  const net = raw - fee;
  const snapHint = raw % 5000 !== 0
    ? ` · Must be multiple of 5,000 (try ${ugx(Math.ceil(raw/5000)*5000)})`
    : '';
  row.style.display = 'block';
  row.textContent = `Fee: ${ugx(fee)} (7%)  ·  You receive: ${ugx(net)}${snapHint}`;
};

window.submitWithdrawal = async () => {
  if (!_user || !_userData) return;
  const amount = parseInt(document.getElementById('witAmount').value, 10);
  const phone  = document.getElementById('witPhone').value.trim().replace(/\D/g,'');
  if (!amount || amount <= 0) { showToast('Enter withdrawal amount', 'error'); return; }
  if (amount < 20000) { showToast('Minimum withdrawal is UGX 20,000', 'error'); return; }
  if (amount % 5000 !== 0) {
    const snap = Math.ceil(amount / 5000) * 5000;
    showToast(`Amount must be a multiple of 5,000. Try ${ugx(snap)}`, 'error'); return;
  }
  if (amount > (_userData.walletBalance || 0)) { showToast('Insufficient balance', 'error'); return; }
  if (!phone || phone.length < 9) { showToast('Enter a valid phone number', 'error'); return; }
  closePage('withdrawPage');
  showLoading(true);
  try {
    const r = await api('/withdraw/request', { userId:_user.uid, amount, phone:'+256'+phone.slice(-9) });
    showLoading(false);
    if (r.status === 'success') {
      showToast('Withdrawal submitted! You\'ll be notified when processed.', 'success');
      if (r.withdrawalId) watchWithdrawal(r.withdrawalId, amount);
    } else {
      showToast(r.message || 'Withdrawal failed', 'error');
    }
  } catch (e) { showLoading(false); showToast('Network error', 'error'); }
};

// Real-time withdrawal status listener + HTTP poll fallback
let _witUnsubscribe = null;
let _witPollTimer   = null;
let _witResolved    = false;

function stopWitTimers() {
  if (_witUnsubscribe) { _witUnsubscribe(); _witUnsubscribe = null; }
  if (_witPollTimer)   { clearInterval(_witPollTimer); _witPollTimer = null; }
}

function handleWitResult(status, d, amount) {
  if (_witResolved) return;
  if (status === 'processed') {
    _witResolved = true; stopWitTimers();
    showToast(`Withdrawal of ${ugx(d.netAmount || amount)} sent to your phone!`, 'success');
  } else if (status === 'failed') {
    _witResolved = true; stopWitTimers();
    showToast(`Withdrawal failed — ${ugx(amount)} refunded to your wallet.`, 'error');
  }
}

function watchWithdrawal(withdrawalId, amount) {
  stopWitTimers();
  _witResolved = false;
  // HTTP poll every 2 s — server actively checks MarzPay and reads MongoDB.
  _witPollTimer = setInterval(async () => {
    try {
      const r = await fetch(SERVER + '/withdraw/status/' + withdrawalId);
      const j = await r.json();
      if (j.status === 'success' && j.data) handleWitResult(j.data.status, j.data, amount);
    } catch (_) {}
  }, 2000);
}

// Trigger an immediate balance refresh (used after deposit success, etc.)
function loadUser() { if (_user) pollAccount(_user.uid); }


// ── GIFT CODE ──
window.openGiftModal = () => {
  document.getElementById('giftCodeInput').value = '';
  openModal('giftModal');
};
window.redeemGiftCode = async () => {
  const code = document.getElementById('giftCodeInput').value.trim().toUpperCase();
  if (!code) { showToast('Enter a gift code', 'error'); return; }
  closeModal('giftModal');
  showLoading(true);
  try {
    const r = await api('/giftcode/redeem', { userId: _user.uid, code });
    showLoading(false);
    if (r.status === 'success') showToast(r.message, 'success');
    else showToast(r.message || 'Invalid code', 'error');
  } catch (e) { showLoading(false); showToast('Network error', 'error'); }
};

// ── BANK ACCOUNTS ──
window.openBankModal = () => {
  renderBankList();
  document.getElementById('bankName').value  = '';
  document.getElementById('bankPhone').value = '';
  openModal('bankModal');
};
function renderBankList() {
  const accounts = _userData?.bankAccounts || [];
  const el = document.getElementById('bankList');
  if (!accounts.length) { el.innerHTML = '<div class="empty-state" style="padding:16px 0"><p style="font-size:12px">No saved accounts yet</p></div>'; return; }
  el.innerHTML = accounts.map((a,i) => `
    <div class="bank-item">
      <div class="bank-icon">${ICN.phone}</div>
      <div class="bank-info">
        <div class="bank-name">${a.name || 'Account'}</div>
        <div class="bank-phone">+256${a.phone}</div>
      </div>
      <button class="bank-del" onclick="removeBankAccount(${i})">${ICN.trash}</button>
    </div>`).join('');
}
window.addBankAccount = async () => {
  const name  = document.getElementById('bankName').value.trim();
  const phone = document.getElementById('bankPhone').value.trim().replace(/\D/g,'');
  if (!name || !phone) { showToast('Enter account name and phone', 'error'); return; }
  try {
    const r = await api('/account/add-bank', { name, phone });
    if (r.status !== 'success') { showToast(r.message || 'Failed to save', 'error'); return; }
    document.getElementById('bankName').value  = '';
    document.getElementById('bankPhone').value = '';
    showToast('Account saved', 'success');
  } catch (e) { showToast('Failed to save', 'error'); }
};
window.removeBankAccount = async (idx) => {
  if (!confirm('Remove this account?')) return;
  const accounts = [...(_userData?.bankAccounts || [])];
  const removed  = accounts[idx];
  if (!removed) return;
  try {
    const r = await api('/account/remove-bank', { name: removed.name, phone: removed.phone });
    if (r.status !== 'success') { showToast(r.message || 'Failed to remove', 'error'); return; }
    showToast('Account removed', '');
  } catch (e) { showToast('Failed to remove', 'error'); }
};

// ── CONTENT PAGES ──
const CONTENT = {
  about: {
    title: 'About Voltra',
    body: `<h3><svg class="eico" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z"/></svg> Powering Everyday Earners</h3>
      <p>Voltra turns your capital into daily energy. You activate a power machine, and it generates returns for you every single day of its cycle — automatically.</p>
      <p>From the entry-level Spark to the high-output Thunder, every machine is built to keep your earnings charged. No guesswork, no waiting — just steady daily payouts you can withdraw.</p>
      <h3 style="margin-top:16px">Why Voltra</h3>
      <p>Simple to start, transparent by design, and powered by a 3-level team reward system that pays you instantly when your network grows. Plug in, power up, and watch your wallet charge.</p>`
  },
  rules: {
    title: 'Platform Rules',
    body: `<h3>How Voltra Works</h3>
      <ul>
        <li>Minimum recharge is UGX 30,000</li>
        <li>Minimum withdrawal is UGX 20,000 (multiples of 5,000 only)</li>
        <li>A 7% fee applies on all withdrawals</li>
        <li>Investment plans run for a fixed cycle and mature automatically</li>
        <li>Daily check-in bonus is UGX 500 per day</li>
      </ul>
      <h3 style="margin-top:16px">Commission Rules</h3>
      <ul>
        <li>Level 1: 12% of every investment your direct referral makes</li>
        <li>Level 2: 4% of every investment by your L2 team</li>
        <li>Level 3: 2% of every investment by your L3 team</li>
        <li>Commission is credited instantly and can be withdrawn immediately</li>
      </ul>
      <h3 style="margin-top:16px">Account Rules</h3>
      <ul>
        <li>One account per person only</li>
        <li>Fraudulent activity will result in permanent suspension</li>
        <li>All transactions are final and subject to review</li>
      </ul>`
  },
  support: {
    title: 'Customer Service',
    body: `<h3>Contact Us</h3>
      <p>Our support team is available to help you with any issues or questions about your Voltra account.</p>
      <p><strong>Telegram:</strong> Contact via our Telegram support channel</p>
      <p><strong>WhatsApp:</strong> Send us a message on WhatsApp</p>
      <p><strong>Email:</strong> support@voltrainvest.com</p>
      <p style="margin-top:16px">Support hours: Monday – Saturday, 8:00 AM – 8:00 PM (EAT)</p>
      <p>For urgent withdrawal issues, please contact us directly via Telegram for fastest response.</p>`
  },
  terms: {
    title: 'Terms & Conditions',
    body: `<h3>1. Acceptance</h3>
      <p>By creating a Voltra account and using the platform, you agree to these Terms & Conditions. If you do not agree, please do not use Voltra.</p>
      <h3 style="margin-top:16px">2. Eligibility</h3>
      <p>You must be at least 18 years old and the lawful owner of the mobile money account you use. One account is permitted per person.</p>
      <h3 style="margin-top:16px">3. Deposits & Investments</h3>
      <p>Recharges activate a power machine that pays a fixed daily return over its cycle. Returns are projections based on the selected plan and are credited daily to your wallet.</p>
      <h3 style="margin-top:16px">4. Withdrawals</h3>
      <p>Withdrawals are subject to the minimum amount, multiples rule and the liquidity fee shown on the withdrawal screen. Processing may take time during high demand.</p>
      <h3 style="margin-top:16px">5. Risk</h3>
      <p>All investments carry risk. Only commit funds you can afford to set aside. Voltra is not liable for losses arising from market conditions or events beyond our control.</p>
      <h3 style="margin-top:16px">6. Prohibited Use</h3>
      <p>Fraud, multiple accounts, automated abuse or any attempt to manipulate the platform will result in suspension and forfeiture of funds.</p>
      <h3 style="margin-top:16px">7. Changes</h3>
      <p>We may update these terms at any time. Continued use of Voltra after changes means you accept the updated terms.</p>`
  },
  privacy: {
    title: 'Privacy Policy',
    body: `<h3>1. Information We Collect</h3>
      <p>We collect your name, phone number, transaction history and basic device information needed to operate your account and process payments.</p>
      <h3 style="margin-top:16px">2. How We Use It</h3>
      <p>Your information is used to run your account, process recharges and withdrawals, calculate earnings and commissions, and keep the platform secure.</p>
      <h3 style="margin-top:16px">3. Sharing</h3>
      <p>We do not sell your personal data. Information is shared only with payment providers as required to complete your transactions, or where required by law.</p>
      <h3 style="margin-top:16px">4. Security</h3>
      <p>Sensitive credentials are stored server-side and never exposed in the app. Access to your account is protected by your password — keep it private.</p>
      <h3 style="margin-top:16px">5. Data Retention</h3>
      <p>We keep account and transaction records for as long as your account is active and as required for legal and accounting purposes.</p>
      <h3 style="margin-top:16px">6. Your Rights</h3>
      <p>You may request a copy of your data or account deletion by contacting support. Some records may be retained where the law requires.</p>
      <h3 style="margin-top:16px">7. Contact</h3>
      <p>For any privacy question, reach us through the Support option in the app.</p>`
  }
};
let _aboutImage = null;
window.openContentModal = (type) => {
  const c = CONTENT[type];
  if (!c) return;
  document.getElementById('contentModalTitle').textContent = c.title;
  let body = c.body;
  if (type === 'about' && _aboutImage)
    body = `<img src="${_aboutImage}" alt="" style="width:100%;border-radius:14px;margin-bottom:16px;display:block">` + body;
  document.getElementById('contentModalBody').innerHTML = body;
  openModal('contentModal');
};

// ── MODAL HELPERS ──
function openModal(id)  { document.getElementById(id).classList.add('show'); }
function closeModal(id) { document.getElementById(id).classList.remove('show'); }
window.openModal  = openModal;
window.closeModal = closeModal;

// ── PHOTO UPLOAD ──
const CLOUD  = 'dcmfxgofa';
const PRESET = 'x-engineuploads';

window.triggerPhotoUpload = () => document.getElementById('photoInput').click();

window.uploadPhoto = async (input) => {
  const file = input.files[0];
  if (!file || !_user) return;
  showLoading(true);
  try {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('upload_preset', PRESET);
    const resp = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD}/image/upload`, { method:'POST', body:fd });
    const data = await resp.json();
    if (data.secure_url) {
      await api('/account/update-photo', { photoUrl: data.secure_url });
      showToast('Profile photo updated', 'success');
    }
  } catch (e) { showToast('Photo upload failed', 'error'); }
  finally { showLoading(false); input.value = ''; }
};

// ── REFERRAL CODE FROM URL ──
// A ?ref= link means the visitor was invited - drop them straight on the
// registration screen with the code pre-filled (not the login screen).
const urlRef = new URLSearchParams(window.location.search).get('ref');
if (urlRef) {
  const refInput = document.getElementById('regRef');
  if (refInput) refInput.value = urlRef.toUpperCase();
  const loginF = document.getElementById('loginForm');
  const regF   = document.getElementById('registerForm');
  if (loginF && regF) { loginF.style.display = 'none'; regF.style.display = 'block'; }
}


