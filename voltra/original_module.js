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
  try { localStorage.removeItem('nx_photo'); } catch (_) {}
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
const DEFAULT_SLIDE_IMAGES = ['data:image/jpeg;base64,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','data:image/jpeg;base64,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','data:image/jpeg;base64,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KF0ileuymkFC6UUmUopBRSkUr0ppCUKpFJlIpBQvFRim0opCULpFJmKiuyCheKMUyuyK7IKFYoxTceyiuyCheKMUyuyK7IKF4KMU2uyiigoXijFMooooBeKMEyiiigFYopMpRStgpijFXpGKAXijFMpFJZBWKmlfFFJYF0jFNpRSAXSik3HsoxQoulGKbijAd0sgnFGKdiorsrYoVijFNrsiuyWBNIxTKU4pYFYoxTcUYpYFYqMU7FRiEB2sVGKbSil5j20LoooplIpBQuijFMpFISheKMUykUqSheKmlekUgopSKV6RSChdIxV6RSWKKYoxV6U0rYF0ilekYpZClIxV8UUliheKMUzFGKWKF4oxTMUYqkoXijFMxRigoXioxTcVWkJRSkYq9IpBQvFTir0ikJRTFRimUikArFGKZijFUC8UYpmKMUAvFGKZijFAUxUUm0ooIaoXijFXpFISimKjFOI2VaQNC8UYplIpCC8UYplIpC0beHHou1H9BcLQnGavVd6Ldi+V1i3s+/0ErxITO22rz+qZUxXpZhbVwNY39eV16JnH/Ix/CzFSMUykUvoHxdIrFGKbSrStkoXgjFMpGISyUUxUYplKMUFC8UYJlIxQULxUYplIpLJQvFGKZSKVsCsUUmYorsliheKMUzFGKWBWKMUzFGKWBeKMFelOKWKFYKKTsVXFCUUpFK+KMVS0UrsopXpTihKF0ikzEKKQUUxRir0ikFCqRSZijFBQukYpmKMUFC8UYq9KcUILxUUfRNxRj2QtCqKKTKUUgopioxKZSKQlCqKnFMpFIKFY91OKZSKQUJxRimV2RXZCULxRir12U12QtC8VGKbXZGKoo7NKMVekUvMe2imKMVekUqKKYoxV6RSCimKMVekUoSimKMVekUqKF0ilelNDuhKF4oxV6RigopiilelFIKK4oxV6UUqKK4qMVekUhKKUilekUhKKUilekUliilIpXpFK2KKUoxTKRSWQXijFMpFJYFUjFMxRiqKF4oxTMUYoSheKMUzFGKCheKMUzFRSCilIpXpRigopSKTMUYoBeKMUzFRSApSikylWkBWkUr4qKQUVpFK+KMUBbT22ZpXfg3YuC3Yg+i7ujOUY+C8PWr8bPrf46WziNcPcXC17T5/xXoCNqXG17amBXHo3UqPR10bxnOLFUhPVaX00fDcaFUopNxUY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'];
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
  const imgs   = (images && images.length) ? images : DEFAULT_SLIDE_IMAGES;
  const count  = imgs.length || SLIDE_DEFAULTS.length;
  wrap.innerHTML   = '';
  dotsEl.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const img = imgs[i];
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
    // Deposit screen hero image (admin-settable)
    if (s.depositImage) {
      const h = document.getElementById('depHero');
      if (h) h.style.backgroundImage = `linear-gradient(135deg,rgba(10,14,23,0.55),rgba(10,14,23,0.35) 50%,rgba(10,14,23,0.7)), url('${s.depositImage}')`;
    }
    // Withdraw screen hero image (admin-settable)
    if (s.withdrawImage) {
      const h = document.getElementById('witHero');
      if (h) h.style.backgroundImage = `linear-gradient(135deg,rgba(10,14,23,0.55),rgba(10,14,23,0.35) 50%,rgba(10,14,23,0.7)), url('${s.withdrawImage}')`;
    }
    // About section image (admin-settable, stacked at top of About)
    _aboutImgs = [
      s.aboutImage1 || s.aboutImage || DEFAULT_SLIDE_IMAGES[0],
      s.aboutImage2 || DEFAULT_SLIDE_IMAGES[1],
      s.aboutImage3 || DEFAULT_SLIDE_IMAGES[2]
    ];
    // admin-editable About section text (falls back to the built-in copy)
    const D = CONTENT.about.blocks;
    _aboutTxt = [
      { h: s.aboutTitle1 || D[0].h, body: s.aboutBody1 || D[0].body },
      { h: s.aboutTitle2 || D[1].h, body: s.aboutBody2 || D[1].body },
      { h: s.aboutTitle3 || D[2].h, body: s.aboutBody3 || D[2].body }
    ];
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
      const mailSvg  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="22" height="22"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/></svg>`;
      const clockSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="22" height="22"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`;
      const card = (cls, icon, h, s, href) => {
        const tag = href ? 'a' : 'div';
        const attr = href ? ` href="${href}" target="_blank" rel="noopener"` : '';
        return `<${tag} class="contact-card"${attr}>
          <span class="cc-ico ${cls}">${icon}</span>
          <span class="cc-txt"><span class="cc-h">${h}</span><span class="cc-s">${s}</span></span>
          ${href ? '<span class="cc-go">&rsaquo;</span>' : ''}
        </${tag}>`;
      };
      CONTENT.support.body = `
        <div class="contact-hero">
          <span class="contact-hero-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="26" height="26"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg></span>
          <div><div class="ch-title">We're here to help</div><div class="ch-sub">Reach our team any time</div></div>
        </div>
        ${tg ? card('tg', tgSvg, 'Telegram', 'Join our support channel', tg) : ''}
        ${wa ? card('wa', waSvg, 'WhatsApp', 'Chat with an agent now', 'https://wa.me/' + wa.replace(/\D/g,'')) : ''}
        ${card('em', mailSvg, 'Email', em, 'mailto:' + em)}
        ${card('hr', clockSvg, 'Support hours', hr, '')}`;
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
  document.querySelectorAll('.amt-btn').forEach(b => b.classList.remove('sel'));
  if (btn) btn.classList.add('sel');
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
    // self-heal: make sure the profile (name/phone) exists even if signup's create-profile didn't run
    try {
      const digits = (user.email || '').split('@')[0].replace(/\D/g, '');
      if (digits) api('/account/create-profile', { userId: user.uid, name: '0' + digits, phone: '256' + digits }).catch(() => {});
    } catch (_) {}
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
  document.getElementById('checkinSub').innerHTML = doneCi
    ? `<svg class="eico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Claimed today · ${streakDays} day${streakDays===1?'':'s'} streak`
    : 'Tap to claim UGX 500 today';
  const ciBtn = document.getElementById('checkinBtn');
  if (ciBtn) {
    ciBtn.textContent = doneCi ? 'Claimed' : 'Claim';
    ciBtn.classList.toggle('done', doneCi);
    ciBtn.disabled = doneCi;
  }
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
  // photo persists locally so it never "disappears" between polls / server resets
  const photo = u.profilePhoto || localStorage.getItem('nx_photo') || '';
  [['moreAvatarInitial',52],['avatarInitial',34],['avatarInitialTop',34]].forEach(([id,size]) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (photo) {
      el.innerHTML = `<img src="${photo}" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover">`;
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
  if (_userData.lastCheckinDate === todayKey) { showToast('Already claimed today', 'success'); return; }
  if (_userData.status === 'banned') { showToast('Account suspended', 'error'); return; }
  const ciBtn = document.getElementById('checkinBtn');
  if (ciBtn) { ciBtn.disabled = true; ciBtn.textContent = '…'; }
  try {
    const r = await api('/checkin', { userId: _user.uid });
    if (r.status === 'success') {
      showToast(`UGX ${(r.bonus||500).toLocaleString()} credited! Day ${r.streak}`, 'success');
      _userData.lastCheckinDate = todayKey;
      if (r.streak) _userData.checkinStreak = r.streak;
      renderHome(_userData);
    } else {
      showToast(r.message || 'Check-in failed', 'error');
      if (ciBtn) { ciBtn.disabled = false; ciBtn.textContent = 'Claim'; }
    }
  } catch (e) {
    showToast('Network error', 'error');
    if (ciBtn) { ciBtn.disabled = false; ciBtn.textContent = 'Claim'; }
  }
};

// ── PRODUCTS ──
async function loadProducts() {
  try {
    const r = await (await fetch(SERVER + '/products')).json();
    renderProducts(r.status === 'success' ? r.products : []);
  } catch (e) { console.error('Load products:', e); }
}

let _allAssets = [];
let _assetCat  = 'all';
function renderProducts(products) {
  if (products) _allAssets = products;
  const list = _allAssets;
  const grid = document.getElementById('productsGrid');
  const countEl   = document.getElementById('prodBannerCount');
  const benefitEl = document.getElementById('prodBannerBenefit');
  if (countEl)   countEl.textContent   = list.length;
  if (benefitEl) {
    const maxReturn = list.reduce((m,p) => Math.max(m, p.expectedReturn||0), 0);
    benefitEl.textContent = maxReturn ? ugx(maxReturn) : '—';
  }
  if (!list.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><span class="es-icon">${ICN.box}</span><p>No assets available yet</p></div>`;
    return;
  }
  list.sort((a,b) => (a.displayOrder||999) - (b.displayOrder||999));

  const cardHtml = (p) => {
    const inStock = p.isInStock !== false;
    const imgHtml = p.image
      ? `<img src="${p.image}" alt="${p.name}" decoding="async" loading="lazy">`
      : `<span class="no-img">${ICN.box}</span>`;
    return `<div class="prod-row" onclick="openProductModal('${p.id}')">
      <div class="prod-thumb">${imgHtml}</div>
      <div class="prod-info">
        <div class="prod-name">${p.name}</div>
        <div class="prod-line">Entry cost: <b>${ugx(p.price)}</b></div>
        <div class="prod-line">Earning days: <b>${p.cycle||0}</b></div>
        <div class="prod-line">Daily yield: <b>${ugx(p.dailyReturn)}</b></div>
        <div class="prod-line">Total payout: <b>${ugx(p.expectedReturn)}</b></div>
      </div>
      <button class="prod-buy" ${inStock?'':'disabled'} onclick="event.stopPropagation();openProductModal('${p.id}')">${inStock?'ACTIVATE':'TAKEN'}</button>
    </div>`;
  };

  // Class A / B / C category filter
  const cats = [['all','All'],['A','Class A'],['B','Class B'],['C','Class C']];
  const tabs = `<div class="cat-tabs">${cats.map(([k,l]) =>
    `<button class="cat-tab ${_assetCat===k?'on':''}" onclick="setAssetCat('${k}')">${l}</button>`).join('')}</div>`;
  const filtered = list.filter(p => _assetCat === 'all' || (p.category||'A') === _assetCat);
  const body = filtered.length
    ? `<div class="prod-list">${filtered.map(cardHtml).join('')}</div>`
    : `<div class="empty-state"><span class="es-icon">${ICN.box}</span><p>No assets in this class yet</p></div>`;
  grid.innerHTML = tabs + body;
}
window.setAssetCat = (c) => { _assetCat = c; renderProducts(); };

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
      if (r.status !== 'success') { body.innerHTML = '<p style="color:var(--text2);text-align:center">Asset not found</p>'; return; }
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
    const stateBadge = claimed ? '<span class="inv-badge claimed">Collected</span>'
                     : matured ? '<span class="inv-badge matured">Ready</span>'
                     : '<span class="inv-badge active">Running</span>';
    const claimBtn = matured ? `<button class="btn-submit" style="margin-top:16px" onclick="closeModal('invDetailModal');claimInvestment('${inv.id}')">Collect payout — ${ugx(inv.expectedReturn)}</button>` : '';
    body.innerHTML = `
      <div style="text-align:center">${imgHtml}</div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <div style="font-size:17px;font-weight:800;color:var(--text)">${inv.productName||'Asset'}</div>
        ${stateBadge}
      </div>
      <div class="rec-row"><span class="rec-row-lbl">Activation cost</span><span class="rec-row-val">${ugx(inv.amount)}</span></div>
      <div class="rec-row"><span class="rec-row-lbl">Total payout</span><span class="rec-row-val s-green">+${ugx(inv.expectedReturn)}</span></div>
      <div class="rec-row"><span class="rec-row-lbl">Net gain</span><span class="rec-row-val s-green">+${ugx((inv.expectedReturn||0)-(inv.amount||0))}</span></div>
      <div class="rec-row"><span class="rec-row-lbl">Daily Yield</span><span class="rec-row-val s-green">+${ugx(inv.dailyReturn||0)}/day</span></div>
      <div class="rec-row"><span class="rec-row-lbl">Paid so far</span><span class="rec-row-val s-green">+${ugx(inv.dailyCredited||0)}</span></div>
      <div class="rec-row"><span class="rec-row-lbl">Still to come</span><span class="rec-row-val">${ugx(Math.max(0,(inv.expectedReturn||0)-(inv.dailyCredited||0)))}</span></div>
      <div class="rec-row"><span class="rec-row-lbl">Activated on</span><span class="rec-row-val">${inv.date||'—'}</span></div>
      <div class="rec-row"><span class="rec-row-lbl">Run length</span><span class="rec-row-val"><strong>${cycle} day${cycle!==1?'s':''}</strong></span></div>
      <div class="rec-row"><span class="rec-row-lbl">Completes on</span><span class="rec-row-val">${inv.maturityDate ? (tsDate(inv.maturityDate)||new Date()).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}) : '—'}</span></div>
      <div class="rec-row"><span class="rec-row-lbl">Time remaining</span><span class="rec-row-val" style="color:${claimed?'var(--text2)':matured||fullyPaid?'#22c55e':'var(--blue)'}">${claimed ? 'Completed' : matured ? '<svg class="eico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Matured — Claim now!' : fullyPaid ? 'Fully paid out' : timeLeftStr}</span></div>
      <div class="rec-row"><span class="rec-row-lbl">Day</span><span class="rec-row-val">${claimed||matured||fullyPaid ? 'Day '+cycle+' of '+cycle : 'Day '+Math.min(cycle, daysElapsed+1)+' of '+cycle}</span></div>
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
  const m={success:'Completed',approved:'Completed',paid:'Completed',processing:'Processing',pending:'Awaiting payment',failed:'Unsuccessful',rejected:'Declined',reversed:'Reversed',cancelled:'Cancelled'};
  return m[s?.toLowerCase()] || (s||'Awaiting payment');
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
        const typeLabel = tx.type === 'admin_credit' ? 'Account Credit' : 'Recharge';
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
      const typeLabel = { checkin:'Daily Spark', cashback:'Daily Yield', commission:'Team Bonus', gift_code:'Gift Reward', investment_return:'Asset Payout', admin_credit:'Account Credit', reversal:'Reversal' };
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

window.selectWitAmt = (amt, btn) => {
  document.getElementById('witAmount').value = amt;
  document.querySelectorAll('.wq-btn').forEach(b => b.classList.remove('sel'));
  if (btn) btn.classList.add('sel');
  updateWitFee();
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
    // built at render time so admin-uploaded images interleave with the text
    blocks: [
      { h:'<svg class="eico" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z"/></svg> Powering a clean-energy future',
        body:`<p>Voltra BESS is a leader in the design and operation of Battery Energy Storage Systems (BESS) that drive the transition to a clean, sustainable energy era. With a strong team of industry experts and a clear vision for the future, we are focused on delivering efficient, reliable and scalable energy-storage solutions for the growing demands of the modern energy landscape.</p>
        <p>Every Voltra asset is modelled on real infrastructure — solar arrays, wind turbines and grid-scale battery containers. When you activate an asset, your capital helps power that output, and the output pays you back a fixed return every single day of its cycle.</p>` },
      { h:'Our mission &amp; what we do',
        body:`<p>Our mission is simple: make participation in the clean-energy economy open to everyone, not just large institutions. We package energy-storage performance into accessible assets — from the entry-level Spark to the high-output Thunder — so anyone can put their money to work and earn daily.</p>
        <p>We operate on transparency and consistency. Returns are credited automatically to your wallet each day, withdrawals are processed quickly, and every transaction is recorded in your history. No guesswork, no waiting — just steady, predictable payouts you control.</p>
        <p>Behind the scenes, our reconciliation engine settles cashback, asset payouts and team rewards continuously, so what you see in the app always reflects your real balance.</p>` },
      { h:'Our team, innovation &amp; the road ahead',
        body:`<p>Voltra is built by a team of engineers, energy specialists and product designers committed to reliability and scale. We invest continuously in the technology that keeps the platform fast, secure and dependable as our community grows.</p>
        <p>Growth is shared. Our 3-level reward system pays you the moment people you invite activate an asset — Level 1, 2 and 3 — turning your network into a second stream of income alongside your own assets.</p>
        <p>As we expand across the region, our goal stays the same: a sustainable energy future where everyday earners share in the value they help create. Plug in, power up, and grow with Voltra.</p>` }
    ]
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
let _aboutImgs = [];
let _aboutTxt = null;
let _aboutStats = null;
window.openContentModal = (type) => {
  const c = CONTENT[type];
  if (!c) return;
  document.getElementById('contentModalTitle').textContent = c.title;
  let body;
  if (type === 'about' && c.blocks) {
    const txt = _aboutTxt || c.blocks;
    const stats = (_aboutStats && _aboutStats.length ? _aboutStats : [
      { v:'10 GWh', l:'Storage capacity' },
      { v:'99.9%',  l:'Platform uptime' },
      { v:'24/7',   l:'Support' },
      { v:'3-Level',l:'Team rewards' }
    ]);
    const statsHtml = `<div class="about-stats">${stats.map(s =>
      `<div class="ab-stat"><b>${s.v}</b><span>${s.l}</span></div>`).join('')}</div>`;
    // newspaper layout: image, text, image, text, image, text
    const sections = txt.map((b, i) => {
      const img = _aboutImgs[i] || DEFAULT_SLIDE_IMAGES[i % DEFAULT_SLIDE_IMAGES.length];
      return `<img class="about-pic" src="${img}" alt="">
        <h3${i ? ' style="margin-top:4px"' : ''}>${b.h}</h3>
        ${b.body || ('<p>' + (b.p || '') + '</p>')}`;
    }).join('');
    const values = [
      ['Transparency','Every return, fee and transaction is visible in your history — no hidden moves.'],
      ['Reliability','Daily payouts settle automatically through our reconciliation engine, on time.'],
      ['Accessibility','Anyone can start from a low entry and grow at their own pace.'],
      ['Security','Your funds and data are protected with bank-grade, server-side safeguards.']
    ];
    const valuesHtml = `<h3 style="margin-top:18px">Our Values</h3><div class="about-values">${values.map(v =>
      `<div class="ab-val"><div class="ab-val-h">${v[0]}</div><div class="ab-val-p">${v[1]}</div></div>`).join('')}</div>`;
    const why = ['Fixed daily returns credited automatically','Withdraw your earnings any time','Class A / B / C assets for every budget','Earn from a 3-level referral network','Backed by real clean-energy infrastructure'];
    const whyHtml = `<h3 style="margin-top:18px">Why choose Voltra</h3><div class="about-why">${why.map(w =>
      `<div class="ab-why"><svg class="eico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg><span>${w}</span></div>`).join('')}</div>`;
    body = statsHtml + sections + valuesHtml + whyHtml;
  } else {
    body = c.body;
  }
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
const PRESET = 'voltra';

window.triggerPhotoUpload = () => document.getElementById('photoInput').click();

window.uploadPhoto = async (input) => {
  const file = input.files[0];
  if (!file || !_user) return;
  showLoading(true);
  try {
    // compress in-browser to a small square JPEG data URI (no external upload service)
    const dataUrl = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const max = 256;
        let w = img.width, h = img.height;
        if (w > h) { if (w > max) { h = Math.round(h * max / w); w = max; } }
        else       { if (h > max) { w = Math.round(w * max / h); h = max; } }
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL('image/jpeg', 0.7));
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
    // keep the photo locally so it always shows even if the server can't store it
    try { localStorage.setItem('nx_photo', dataUrl); } catch (_) {}
    if (_userData) _userData.profilePhoto = dataUrl;
    renderAvatars(_userData || { profilePhoto: dataUrl });
    const r = await api('/account/update-photo', { photoUrl: dataUrl });
    showToast(r && r.status === 'success' ? 'Profile photo updated' : 'Photo saved on this device', 'success');
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


