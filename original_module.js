// ══════════════════════════════════════════════════
// ⚙️  CONFIG
// ══════════════════════════════════════════════════
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyBA_S0u69P9Por2kkhF189HHuhLTBX1vtE",
  authDomain:        "x--engine.firebaseapp.com",
  projectId:         "x--engine",
  storageBucket:     "x--engine.firebasestorage.app",
  messagingSenderId: "420172832235",
  appId:             "1:420172832235:web:735d05ea80069177ec4dae"
};
const SERVER = 'https://x-engine-server-production.up.railway.app';
const CLOUDINARY_CLOUD = 'dcmfxgofa';
const CLOUDINARY_PRESET = 'x-engineuploads';
const APP_URL = window.location.origin + window.location.pathname;

// ══════════════════════════════════════════════════
// FIREBASE INIT
// ══════════════════════════════════════════════════
import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  onAuthStateChanged, signOut
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, collection,
  query, where, orderBy, limit, getDocs, onSnapshot,
  serverTimestamp, increment, addDoc
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const app  = getApps().length ? getApps()[0] : initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);
const db   = getFirestore(app);

// ══════════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════════
let _user     = null;
let _userData = null;
let _userUnsub = null;
let _pendingProduct = null;
let _helpLink = '';
let _appDownloadLink = '';
let _txFilter = 'all';
let _allTxs   = [];
let _witListenerUnsub = null;

// ══════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════
function ugx(n){ return 'UGX '+Number(n||0).toLocaleString('en-UG'); }
function fmtPhone(p){ const s=String(p||'').replace(/\s+/g,'').replace(/^\+/,''); return s.startsWith('256')?'+'+s:s.startsWith('0')?'+256'+s.slice(1):'+256'+s; }
function cleanPhone(p){ const s=String(p||'').replace(/\D/g,''); return s.length>=9?s.slice(-9):s; }
function makeEmail(phone){ return cleanPhone(phone).slice(-9)+'@xengine.app'; }
function genRefCode(uid){ return 'XE-'+uid.slice(0,6).toUpperCase(); }

// Authenticated POST to the server — attaches Firebase ID token so the
// server can verify the caller owns the userId in the body.
async function api(path, body){
  let token='';
  try{ if(_user) token = await _user.getIdToken(); }catch(e){ console.error('token error:', e); }
  const headers = {'Content-Type':'application/json'};
  if(token) headers['Authorization'] = 'Bearer '+token;
  const r = await fetch(`${SERVER}${path}`,{method:'POST',headers,body:JSON.stringify(body||{})});
  try{ return await r.json(); }
  catch(e){ return {status:'error', message:'Server error ('+r.status+') — please try again'}; }
}

let _toastT;
function showToast(msg,type='info',dur=3000){
  document.querySelectorAll('.toast').forEach(t=>t.remove());
  const t=document.createElement('div'); t.className='toast '+(type==='error'?'error':type==='success'?'success':'');
  t.textContent=msg; document.body.appendChild(t);
  clearTimeout(_toastT); _toastT=setTimeout(()=>t.remove(),dur);
}

// ══════════════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════════════
window._doLogin = async function(){
  const phone = document.getElementById('loginPhone').value.trim();
  const pass  = document.getElementById('loginPass').value;
  if(!phone||!pass) return showToast('Enter phone and password','error');
  const btn=document.getElementById('loginBtn'); btn.disabled=true; btn.textContent='Signing in...';
  try{
    await signInWithEmailAndPassword(auth, makeEmail(phone), pass);
  }catch(e){
    if(e.code==='auth/user-disabled'){
      showToast('Your account has been suspended. Contact support.','error',7000);
    } else {
      showToast(e.code==='auth/invalid-credential'?'Wrong phone or password.':e.message,'error');
    }
  }finally{ btn.disabled=false; btn.textContent='Log in'; }
};

window._doRegister = async function(){
  const phone = document.getElementById('regPhone').value.trim();
  const pass  = document.getElementById('regPass').value;
  const pass2 = document.getElementById('regPass2').value;
  const ref   = document.getElementById('regRef').value.trim().toUpperCase();
  if(!phone||!pass||!pass2) return showToast('Fill in all fields','error');
  if(phone.length<7) return showToast('Enter a valid phone number','error');
  if(pass.length<6) return showToast('Password must be at least 6 characters','error');
  if(pass!==pass2) return showToast('Passwords do not match','error');
  const btn=document.getElementById('registerBtn'); btn.disabled=true; btn.textContent='Creating...';
  try{
    // Firebase Auth enforces phone uniqueness (email = phone) — duplicate throws auth/email-already-in-use
    const cred = await createUserWithEmailAndPassword(auth, makeEmail(phone), pass);
    const uid  = cred.user.uid;
    _user = cred.user; // ensure api() has the auth token before onAuthStateChanged fires
    // All account data + referral + bonus created server-side (secure — no client writes to balances)
    const regRes = await api('/register',{userId:uid, phone, referralCode:ref});
    if(regRes && regRes.status==='error') throw new Error(regRes.message||'Registration failed');
    try{ localStorage.removeItem('pendingRef'); }catch(e){}
    showToast('Account created! 🎉 Welcome bonus processing...','success',4000);
  }catch(e){
    if(e.code==='auth/email-already-in-use') showToast('Phone already registered. Sign in instead.','error');
    else showToast(e.message,'error');
  }finally{ btn.disabled=false; btn.textContent='Confirm'; }
};

window._showForgot = function(){
  if(_helpLink) window.open(_helpLink,'_blank');
  else showToast('Our Telegram community is coming soon! 🚀 Stay tuned.','info',4000);
};

window._doLogout = async function(){
  if(!confirm('Log out of x-engine?')) return;
  if(_userUnsub){ _userUnsub(); _userUnsub=null; }
  if(_witListenerUnsub){ _witListenerUnsub(); _witListenerUnsub=null; }
  await signOut(auth);
};

// ══════════════════════════════════════════════════
// AUTH STATE
// ══════════════════════════════════════════════════
onAuthStateChanged(auth, async (user)=>{
  const splash = document.getElementById('splashScreen');
  if(user){
    // Check Firestore ban status before granting access
    try{
      const uSnap = await getDoc(doc(db,'users',user.uid));
      if(uSnap.exists() && uSnap.data().status === 'banned'){
        await signOut(auth);
        if(splash) splash.style.display='none';
        document.getElementById('loginPage').style.display='flex';
        document.getElementById('mainApp').style.display='none';
        showToast('Your account has been suspended. Contact support.','error',7000);
        return;
      }
    }catch(_){}
    // Check maintenance mode (admins bypass)
    try{
      const settSnap = await getDoc(doc(db,'settings','main'));
      const isMaint = settSnap.exists() && settSnap.data().maintenanceMode===true;
      const isAdmin = settSnap.exists() && settSnap.data().adminEmails &&
        Array.isArray(settSnap.data().adminEmails) ?
        settSnap.data().adminEmails.includes(user.email) :
        user.email==='admin@xengine.com';
      if(isMaint && !isAdmin){
        if(splash) splash.style.display='none';
        document.getElementById('loginPage').style.display='none';
        document.getElementById('mainApp').style.display='none';
        let mEl=document.getElementById('maintenancePage');
        if(!mEl){
          mEl=document.createElement('div');
          mEl.id='maintenancePage';
          mEl.style.cssText='position:fixed;inset:0;background:#0B0E11;display:flex;align-items:center;justify-content:center;flex-direction:column;z-index:9999;padding:32px;text-align:center';
          mEl.innerHTML=`<div style="font-size:56px;margin-bottom:20px">🚧</div><div style="font-size:22px;font-weight:800;color:#F0B90B;margin-bottom:10px">Under Maintenance</div><div style="font-size:14px;color:#888;line-height:1.8;max-width:280px">X-Engine is undergoing scheduled maintenance. We'll be back shortly.<br><br>Thank you for your patience! ⚙️</div><div style="margin-top:28px;font-size:12px;color:#555">— X-Engine Team</div>`;
          document.body.appendChild(mEl);
        }
        mEl.style.display='flex';
        return;
      }
    }catch(_){}
    _user=user;
    document.getElementById('loginPage').style.display='none';
    document.getElementById('registerPage').style.display='none';
    document.getElementById('mainApp').style.display='block';
    if(splash) splash.style.display='none';
    await loadUserData();
    initTicker();
    loadProducts();
    loadSettings();
    startWitListener(user.uid);
    // Restore last active tab
    const savedTab = localStorage.getItem('xe_tab') || 'home';
    setTimeout(()=>{ if(window._switchTab) window._switchTab(savedTab); },100);
    setTimeout(()=>loadAndShowDialog(),1500);
  } else {
    _user=null; _userData=null;
    if(_userUnsub){ _userUnsub(); _userUnsub=null; }
    // If the visitor arrived via a ?ref= invite link, show register, not login
    let _wantReg=false;
    try{ _wantReg = !!new URLSearchParams(location.search).get('ref') || !!window._openRegisterFromRef; }catch(e){}
    document.getElementById('loginPage').style.display = _wantReg ? 'none' : 'flex';
    document.getElementById('registerPage').style.display = _wantReg ? 'flex' : 'none';
    document.getElementById('mainApp').style.display='none';
    if(splash) splash.style.display='none';
  }
});

// ══════════════════════════════════════════════════
// USER DATA — live listener
// ══════════════════════════════════════════════════
async function loadUserData(){
  if(!_user) return;
  if(_userUnsub) _userUnsub();
  const uRef = doc(db,'users',_user.uid);
  _userUnsub = onSnapshot(uRef,(snap)=>{
    if(!snap.exists()) return;
    _userData = snap.data();
    // Kick out immediately if admin bans user while they are logged in
    if(_userData.status === 'banned'){
      signOut(auth).then(()=>{
        showToast('Your account has been suspended. Contact support.','error',7000);
      });
      return;
    }
    updateUI();
  });
}

function updateUI(){
  if(!_userData) return;
  const dep = _userData.depositBalance||0;
  const refEarned = _userData.refEarned||0;
  // depositBalance = investable only (deposits + bonuses), NOT withdrawable
  // cumulativeBalance = withdrawable only (investment returns), NOT reinvestable
  const cum = _userData.cumulativeBalance || 0;
  const wit = _userData.totalWithdrawn||0;
  const name = (_userData.name||'').replace('@xengine.app','').replace('+256','') || 'there';

  // Balances — clamp cumulative to 0 minimum for display
  const cumDisplay = Math.max(0, cum);
  document.getElementById('balDeposit').textContent    = ugx(dep);
  document.getElementById('balCumulative').textContent = ugx(cumDisplay);
  document.getElementById('balWithdrawn').textContent  = ugx(wit);
  const refEarnEl=document.getElementById('balRefEarned'); if(refEarnEl) refEarnEl.textContent=ugx(_userData?.refEarned||0);
  document.getElementById('greetName').textContent     = name;
  document.getElementById('cumIncomeDisplay').textContent = Number(cumDisplay).toFixed(2);
  const totalWithdrawable = cumDisplay;
  document.getElementById('witAvailDisplay').textContent  = ugx(totalWithdrawable);

  // Profile
  document.getElementById('profileName').textContent   = _userData.phone||name;
  document.getElementById('profilePhone').textContent  = _userData.phone||'';
  document.getElementById('profileBalance').textContent = Number(cumDisplay).toFixed(2);
  // Profile photo
  const photoUrl = _userData.photoUrl || _userData.profilePhotoUrl || _userData.photoURL || '';
  const avatarWrap = document.getElementById('profileAvatarWrap');
  const avatarText = document.getElementById('profileAvatarText');
  if (photoUrl && avatarWrap) {
    avatarWrap.style.background = 'transparent';
    let img = avatarWrap.querySelector('img');
    if (!img) { img = document.createElement('img'); img.style.cssText='width:100%;height:100%;object-fit:cover;border-radius:50%'; avatarWrap.innerHTML=''; avatarWrap.appendChild(img); }
    img.src = photoUrl;
    img.onerror = () => { avatarWrap.innerHTML = '<span id="profileAvatarText">👤</span>'; };
  }
  if (avatarWrap && !avatarWrap._photoClickSet) {
    avatarWrap.style.cursor = 'pointer';
    avatarWrap.title = 'Tap to change photo';
    avatarWrap.addEventListener('click', () => {
      let inp = document.getElementById('_profilePhotoInput');
      if (!inp) { inp = document.createElement('input'); inp.type='file'; inp.id='_profilePhotoInput'; inp.accept='image/*'; inp.style.display='none'; document.body.appendChild(inp); inp.addEventListener('change', _uploadProfilePhoto); }
      inp.value=''; inp.click();
    });
    avatarWrap._photoClickSet = true;
  }
  if(_userData.createdAt?.toDate){
    const d=_userData.createdAt.toDate();
    document.getElementById('profileJoined').textContent = 'Joined: '+d.toLocaleDateString('en-UG',{day:'2-digit',month:'short',year:'numeric'});
  }

  // Referral
  const code = _userData.referralCode || genRefCode(_user.uid);
  document.getElementById('myRefCode').textContent = code;
  document.getElementById('myRefLink').textContent = `${APP_URL}?ref=${code}`;

  // Checkin — use EAT (UTC+3) to match server timezone
  document.getElementById('ckStreak').textContent = _userData.checkinStreak||0;
  document.getElementById('ckEarned').textContent = ugx(_userData.checkinEarned||0);
  const eatNowMs = Date.now() + 3 * 60 * 60 * 1000;
  const todayKey = new Date(eatNowMs).toISOString().slice(0,10);
  const alreadyCheckin = _userData.lastCheckinDate === todayKey;
  const hBtn = document.getElementById('homeCheckinBtn');
  if(hBtn){ hBtn.disabled=alreadyCheckin; hBtn.textContent=alreadyCheckin?'Done ✓':'Check in'; }
  const ckSub = document.querySelector('.checkin-strip-sub');
  if(ckSub) ckSub.textContent = alreadyCheckin ? '✓ Checked in today' : ugx(_checkinBonus)+' bonus today';
  const ckBtn = document.getElementById('checkinBtn');
  if(ckBtn){ ckBtn.disabled=alreadyCheckin; ckBtn.textContent=alreadyCheckin?'✅ Come back tomorrow':'✅ Check In Today'; }

  // My products count (active investments)
  loadMyProductsCount();
  // Bell badge
  loadUnreadCount();
  // Referral stats
  loadRefStats();
  // Checkin totals
  _loadCheckin();
}

async function loadMyProductsCount(){
  if(!_user) return;
  try{
    const snap=await getDocs(query(collection(db,'investments'),where('userId','==',_user.uid),where('status','in',['active','matured']),limit(50)));
    document.getElementById('myProductsCount').textContent = snap.size + ' ›';
  }catch(e){}
}

// ══════════════════════════════════════════════════
// TABS
// ══════════════════════════════════════════════════
const TABS={home:'homeScreen',products:'productsScreen',investments:'investmentsScreen',team:'teamScreen',wallet:'walletScreen',profile:'profileScreen'};
let _activeTab='home';

window._switchTab = function(tab){
  if(!TABS[tab]) return;
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  document.getElementById(TABS[tab]).classList.add('active');
  const navMap={home:'nav-home',products:'nav-products',team:'nav-team',profile:'nav-profile'};
  if(navMap[tab] && document.getElementById(navMap[tab])) document.getElementById(navMap[tab]).classList.add('active');
  _activeTab=tab;
  localStorage.setItem('xe_tab', tab);
  window.scrollTo(0,0);
  if(tab==='investments') loadMyInvestments();
  if(tab==='wallet') loadTransactions();
  if(tab==='team') loadRefStats();
  if(tab==='home') loadAndShowDialog();
};

// ══════════════════════════════════════════════════
// TICKER
// ══════════════════════════════════════════════════
const TICK_PHONES=['256****234','256****891','256****567','256****123','256****788','256****345','256****012','256****456','256****999','256****677'];
const TICK_DEP_AMTS=[30000,35700,40000,45500,50000,60500,75000,80300,100000,120000,150000,200000];
const TICK_WIT_AMTS=[11200,18500,22400,30000,37800,45000,52300,60500,67000,75000,80300,90000,100000,112500,133500,150000,178000,200000];
function pick(arr){ return arr[Math.floor(Math.random()*arr.length)]; }
function buildTicker(){
  const msgs=[];
  for(let i=0;i<8;i++){
    const isWit=Math.random()>.55;
    const p=pick(TICK_PHONES);
    if(isWit){
      const gross=pick(TICK_WIT_AMTS);
      const net=Math.round(gross*0.89).toLocaleString();
      msgs.push(`User ${p} has withdrawn UGX ${net}`);
    } else {
      msgs.push(`User ${p} has deposited UGX ${Number(pick(TICK_DEP_AMTS)).toLocaleString()}`);
    }
  }
  return msgs.join('   •   ');
}
function initTicker(){
  const el=document.getElementById('tickerInner'); if(!el) return;
  function refresh(){
    el.style.animation='none'; el.textContent=buildTicker(); void el.offsetWidth;
    const dur=28+Math.random()*10;
    el.style.animation=`tickerRun ${dur.toFixed(1)}s linear 1`;
    el.addEventListener('animationend',refresh,{once:true});
  }
  setTimeout(refresh,600);
}

// ══════════════════════════════════════════════════
// PRODUCTS — Lafite card layout
// ══════════════════════════════════════════════════
async function loadProducts(){
  const grid=document.getElementById('productGrid'); if(!grid) return;
  grid.innerHTML='<div class="page-loader"><div class="spinner"></div> Loading...</div>';
  try{
    const snap=await getDocs(query(collection(db,'products'),orderBy('order','asc')));
    const activeProd=snap.docs.filter(d=>d.data().isActive!==false);
    if(!activeProd.length){ grid.innerHTML='<div class="empty-state"><div class="empty-icon">⚙️</div><div class="empty-title">No products yet</div></div>'; return; }
    grid.innerHTML='';
    activeProd.forEach(d=>{
      const p={id:d.id,...d.data()};
      const oos=!!p.isOutOfStock;
      const dailyCashback=p.dailyCashback||Math.round((p.totalReturn-p.price)/p.cycle)||0;
      const rating=p.rating||4.9;

      // Use DOM API — avoids innerHTML corruption from emoji/special chars in description
      const card=document.createElement('div');
      card.className='product-card';

      const imgWrap=document.createElement('div');
      imgWrap.className='product-img-wrap';
      const imgSrc=p.photoUrl||p.photo||'';
      if(imgSrc){
        const img=document.createElement('img');
        img.className='product-img';
        img.src=imgSrc;
        img.alt=p.name||'';
        img.onerror=function(){
          imgWrap.innerHTML='<div class="product-img-placeholder">'+(p.emoji||'📦')+'</div>';
        };
        imgWrap.appendChild(img);
      } else {
        imgWrap.innerHTML='<div class="product-img-placeholder">'+(p.emoji||'📦')+'</div>';
      }
      card.appendChild(imgWrap);

      const info=document.createElement('div');
      info.className='product-info';

      const nameEl=document.createElement('div');
      nameEl.className='product-name';
      nameEl.textContent=p.name||'';
      info.appendChild(nameEl);

      const meta=document.createElement('div');
      meta.className='product-meta';
      meta.innerHTML='Cycle: '+( p.cycle||p.term||0)+' Days<br>Daily income: <span style="color:#F0B90B;font-weight:700">UGX '+Number(dailyCashback).toLocaleString()+'</span><br>Total revenue: <span style="color:#03A66D;font-weight:700">UGX '+Number(p.totalReturn||0).toLocaleString()+'</span>';
      info.appendChild(meta);

      const ratingEl=document.createElement('div');
      ratingEl.className='product-rating';
      ratingEl.innerHTML='<span class="product-star">★</span><span class="product-rating-val">'+rating+'</span><span style="color:var(--muted);font-size:12px;margin-left:4px">Price:</span><span class="product-price">UGX '+Number(p.price||0).toLocaleString()+'</span>';
      info.appendChild(ratingEl);
      card.appendChild(info);

      const badge=document.createElement('span');
      badge.className='product-status-badge '+(oos?'badge-soldout':'badge-onsale');
      badge.textContent=oos?'Sold Out':'On Sale';
      card.appendChild(badge);

      const btn=document.createElement('button');
      btn.className='product-cart-btn'+(oos?' disabled-btn':'');
      btn.disabled=oos;
      btn.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#0B0E11" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 001.99 1.61h9.72a2 2 0 001.99-1.61L23 6H6"/></svg>';
      if(!oos) btn.onclick=()=>openInvestPage(p.id);
      card.appendChild(btn);

      grid.appendChild(card);
    });
  }catch(e){ grid.innerHTML='<div class="empty-state">'+e.message+'</div>'; }
}

// ── Invest advisory bottom-sheet ──
function _showInvestAdvisory(p, depBal, dailyCashback, onProceed){
  const hasEnough = depBal >= p.price;
  const overlay = document.createElement('div');
  overlay.style.cssText='position:fixed;inset:0;z-index:800;background:rgba(0,0,0,.72);display:flex;align-items:flex-end;justify-content:center';
  const rm = ()=>{ if(overlay.parentNode) overlay.parentNode.removeChild(overlay); };
  if(hasEnough){
    overlay.innerHTML=`
    <div style="width:100%;max-width:480px;background:#1a1a1a;border-radius:24px 24px 0 0;padding:28px 20px 40px">
      <div style="width:36px;height:4px;background:rgba(255,255,255,.15);border-radius:2px;margin:0 auto 20px"></div>
      <div style="text-align:center;margin-bottom:18px">
        <div style="width:56px;height:56px;background:rgba(3,166,109,.12);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 12px;font-size:26px">✅</div>
        <div style="font-size:17px;font-weight:800;color:#fff;margin-bottom:6px">You're ready to invest!</div>
        <div style="font-size:13px;color:var(--muted)">Buying <strong style="color:#fff">${p.name}</strong> will:</div>
      </div>
      <div style="background:#0B0E11;border-radius:12px;padding:14px;margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid rgba(255,255,255,.06);font-size:13px">
          <span style="color:var(--muted)">💳 Deducted from Deposit Wallet</span>
          <span style="font-weight:700;color:#ef4444">−UGX ${Number(p.price).toLocaleString()}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid rgba(255,255,255,.06);font-size:13px">
          <span style="color:var(--muted)">📅 Daily cashback (starts day 2)</span>
          <span style="font-weight:700;color:#F0B90B">+UGX ${Number(dailyCashback).toLocaleString()}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:7px 0;font-size:13px">
          <span style="color:var(--muted)">🎯 Total payout at maturity</span>
          <span style="font-weight:700;color:#03A66D">+UGX ${Number(p.totalReturn||0).toLocaleString()}</span>
        </div>
      </div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:18px;padding:10px 12px;background:rgba(240,185,11,.06);border:1px solid rgba(240,185,11,.15);border-radius:10px;line-height:1.8">
        💡 Returns go to your <strong style="color:#F0B90B">Cumulative Wallet</strong> (withdrawable) daily. Full cycle: <strong style="color:#fff">${p.cycle||0} days</strong>.
      </div>
      <button class="adv-proceed" style="width:100%;padding:15px;background:#03A66D;border:none;border-radius:14px;color:#fff;font-size:14px;font-weight:800;cursor:pointer;font-family:var(--fam);margin-bottom:10px">🛒 Got it, Proceed</button>
      <button class="adv-cancel" style="width:100%;padding:13px;background:transparent;border:1px solid rgba(255,255,255,.1);border-radius:14px;color:var(--muted);font-size:14px;cursor:pointer;font-family:var(--fam)">Cancel</button>
    </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('.adv-proceed').addEventListener('click',()=>{ rm(); onProceed(); });
    overlay.querySelector('.adv-cancel').addEventListener('click', rm);
  } else {
    overlay.innerHTML=`
    <div style="width:100%;max-width:480px;background:#1a1a1a;border-radius:24px 24px 0 0;padding:28px 20px 40px">
      <div style="width:36px;height:4px;background:rgba(255,255,255,.15);border-radius:2px;margin:0 auto 20px"></div>
      <div style="text-align:center;margin-bottom:18px">
        <div style="width:56px;height:56px;background:rgba(59,130,246,.12);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 12px;font-size:26px">💳</div>
        <div style="font-size:17px;font-weight:800;color:#fff;margin-bottom:6px">Deposit First</div>
        <div style="font-size:13px;color:var(--muted);line-height:1.7">To buy <strong style="color:#fff">${p.name}</strong>, you need funds in your <strong style="color:#3b82f6">Deposit Wallet</strong> first.</div>
      </div>
      <div style="background:#0B0E11;border-radius:12px;padding:14px;margin-bottom:14px">
        <div style="font-size:11px;font-weight:700;color:#F0B90B;margin-bottom:10px;text-transform:uppercase;letter-spacing:.5px">How to get started:</div>
        ${[['Go to Wallet tab at the bottom',''],['Tap the Deposit button',''],['Enter at least UGX '+Number(p.price).toLocaleString(),''],['Pay via MTN or Airtel Mobile Money',''],['Come back here and buy','']].map(([s],i,a)=>`
        <div style="display:flex;gap:10px;padding:7px 0;font-size:13px;color:var(--text2);${i<a.length-1?'border-bottom:1px solid rgba(255,255,255,.06)':''}">
          <span style="width:20px;height:20px;min-width:20px;background:rgba(240,185,11,.15);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;color:#F0B90B">${i+1}</span>
          <span>${s}</span>
        </div>`).join('')}
      </div>
      <div style="display:flex;justify-content:space-between;background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.2);border-radius:10px;padding:10px 14px;margin-bottom:8px;font-size:13px">
        <span style="color:var(--muted)">Your Deposit Wallet</span><span style="font-weight:800;color:#ef4444">UGX ${Number(depBal).toLocaleString()}</span>
      </div>
      <div style="display:flex;justify-content:space-between;background:rgba(3,166,109,.08);border:1px solid rgba(3,166,109,.2);border-radius:10px;padding:10px 14px;margin-bottom:14px;font-size:13px">
        <span style="color:var(--muted)">Amount needed</span><span style="font-weight:800;color:#03A66D">UGX ${Number(p.price).toLocaleString()}</span>
      </div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:18px;padding:10px 12px;background:rgba(59,130,246,.06);border:1px solid rgba(59,130,246,.15);border-radius:10px;line-height:1.8">
        ℹ️ Your <strong style="color:#93c5fd">registration bonus</strong> is credited to your Cumulative (withdrawable) wallet and cannot be used to invest.
      </div>
      <button class="adv-wallet" style="width:100%;padding:15px;background:rgba(59,130,246,.12);border:1.5px solid rgba(59,130,246,.3);border-radius:14px;color:#93c5fd;font-size:14px;font-weight:800;cursor:pointer;font-family:var(--fam);margin-bottom:10px">💳 Go to Wallet — Deposit Now</button>
      <button class="adv-close" style="width:100%;padding:13px;background:transparent;border:1px solid rgba(255,255,255,.1);border-radius:14px;color:var(--muted);font-size:14px;cursor:pointer;font-family:var(--fam)">Close</button>
    </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('.adv-wallet').addEventListener('click',()=>{ rm(); window._switchTab('wallet'); setTimeout(()=>{ if(window._openDepositPage) window._openDepositPage(); },50); });
    overlay.querySelector('.adv-close').addEventListener('click',()=>{ rm(); onProceed(); });
  }
}

// ── Open invest page ──
window._openInvestPage = async function(productId){
  const pSnap = await getDoc(doc(db,'products',productId));
  if(!pSnap.exists()) return showToast('Product not found','error');
  const p={id:pSnap.id,...pSnap.data()};
  _pendingProduct = p;
  const depBal = _userData?.depositBalance||0;
  const dailyCashback = p.dailyCashback || Math.round((p.totalReturn-p.price)/p.cycle) || 0;

  // Check existing quantity for this product
  let existingQty=0;
  try{
    const invSnap=await getDocs(query(collection(db,'investments'),where('userId','==',_user.uid),where('productId','==',productId),where('status','in',['active','matured'])));
    existingQty=invSnap.size;
  }catch(e){}
  const maxQty=3; const remaining=maxQty-existingQty;
  window._currentProductRemaining = remaining;
  window._currentQty = 1;

  _showInvestAdvisory(p, depBal, dailyCashback, function(){
    document.getElementById('investPageBody').innerHTML=`
    <div style="display:flex;gap:12px;margin-bottom:16px">
      <img src="${p.photoUrl||p.photo||''}" style="width:80px;height:100px;border-radius:12px;object-fit:cover;background:#252525;flex-shrink:0" onerror="this.style.background='#252525'">
      <div>
        <div style="font-size:16px;font-weight:800;margin-bottom:6px;color:#fff">${p.name}</div>
        <div style="font-size:12px;color:var(--text2);line-height:1.8">
          Cycle: ${p.cycle||p.term||0} Days<br>
          Daily income: <span style="color:#F0B90B;font-weight:700">UGX ${Number(dailyCashback).toLocaleString()}</span><br>
          Total revenue: <span style="color:#03A66D;font-weight:700">UGX ${Number(p.totalReturn||0).toLocaleString()}</span>
        </div>
      </div>
    </div>
    <div id="investDescBox" style="display:none;background:rgba(240,185,11,.06);border:1px solid rgba(240,185,11,.15);border-radius:10px;padding:12px;margin-bottom:14px;font-size:12px;color:var(--text2);line-height:1.7"></div>
    <div style="background:#0B0E11;border:1px solid var(--border);border-radius:12px;padding:14px;margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:13px">
        <span style="color:var(--muted)">Price</span><span style="font-weight:700">UGX ${Number(p.price).toLocaleString()}</span>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:13px">
        <span style="color:var(--muted)">Your Deposits Wallet</span>
        <span style="font-weight:700;color:${depBal>=p.price?'var(--green)':'var(--primary)'}">${ugx(depBal)}</span>
      </div>
      ${depBal<p.price?`<div style="font-size:12px;color:var(--primary);margin-top:4px">⚠️ Need ${ugx(p.price-depBal)} more. Please deposit first.</div>`:''}
    </div>
    <div style="margin-bottom:16px">
      <div style="font-size:13px;font-weight:700;margin-bottom:8px">Quantity (max 3 per product)</div>
      <div style="display:flex;align-items:center;gap:12px">
        <button onclick="adjustQty(-1)" style="width:36px;height:36px;border-radius:8px;border:1.5px solid var(--border);background:var(--bg3);color:var(--text);font-size:18px;cursor:pointer">−</button>
        <span id="qtyDisplay" style="font-size:20px;font-weight:800;min-width:24px;text-align:center">1</span>
        <button onclick="adjustQty(1)" style="width:36px;height:36px;border-radius:8px;border:1.5px solid var(--border);background:var(--bg3);color:var(--text);font-size:18px;cursor:pointer">+</button>
        <span style="font-size:12px;color:var(--muted)">${existingQty} owned / max ${maxQty}</span>
      </div>
    </div>
    <button class="btn-auth" id="confirmInvestBtn" onclick="confirmInvest()" ${depBal<p.price?'disabled':''}><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#0B0E11" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:6px"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 001.99 1.61h9.72a2 2 0 001.99-1.61L23 6H6"/></svg>Buy Now</button>
  `;
    const descBox = document.getElementById('investDescBox');
    if(descBox){
      if(p.description){ descBox.textContent = p.description; descBox.style.display='block'; }
      else { descBox.style.display='none'; }
    }
    openPage('investPage');
  });
};

window.adjustQty = function(delta){
  const max = Math.min(3, window._currentProductRemaining||3);
  window._currentQty = Math.max(1, Math.min(max, (window._currentQty||1)+delta));
  const el=document.getElementById('qtyDisplay'); if(el) el.textContent=window._currentQty;
  const depBal=_userData?.depositBalance||0;
  const total=(window._currentQty)*((_pendingProduct?.price)||0);
  const btn=document.getElementById('confirmInvestBtn');
  if(btn) btn.disabled=depBal<total;
};

window._confirmInvest = async function(){
  if(!_pendingProduct||!_user) return;
  const qty = window._currentQty||1;
  const p   = _pendingProduct;
  const btn = document.getElementById('confirmInvestBtn');
  btn.disabled=true; btn.textContent='Buying...';
  try{
    const data = await api('/invest/buy',{userId:_user.uid,productId:p.id,qty});
    if(data.status!=='success') throw new Error(data.message||'Purchase failed');
    closePage('investPage');
    showToast(`✅ Bought ${qty}x ${p.name}!`,'success',4000);
    _pendingProduct=null;
    window._switchTab('investments');
  }catch(e){ showToast(e.message,'error'); }
  finally{ btn.disabled=false; btn.textContent='🛒 Buy Now'; }
};

// ══════════════════════════════════════════════════
// MY INVESTMENTS
// ══════════════════════════════════════════════════
async function loadMyInvestments(){
  const el=document.getElementById('invList');
  el.innerHTML='<div class="page-loader"><div class="spinner"></div> Loading...</div>';
  if(!_user) return;
  const snap=await getDocs(query(collection(db,'investments'),where('userId','==',_user.uid),limit(30)));const invDocs=snap.docs.sort((a,b)=>{const ta=a.data().createdAt?.seconds||0;const tb=b.data().createdAt?.seconds||0;return tb-ta;});
  if(!invDocs.length){ el.innerHTML='<div class="empty-state" style="padding:48px 20px"><svg viewBox="0 0 100 100" width="90" height="90" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:block;margin:0 auto 16px"><circle cx="50" cy="50" r="44" fill="rgba(240,185,11,0.1)" stroke="#F0B90B" stroke-width="5.5"/><circle cx="52" cy="36" r="12" fill="rgba(240,185,11,0.2)" stroke="#F0B90B" stroke-width="3"/><text x="52" y="41" text-anchor="middle" font-size="15" fill="#F0B90B" font-weight="900" font-family="Arial,sans-serif">$</text><line x1="60" y1="50" x2="60" y2="56" stroke="#F0B90B" stroke-width="2.5" stroke-linecap="round"/><line x1="64" y1="48" x2="64" y2="54" stroke="#F0B90B" stroke-width="2.5" stroke-linecap="round" opacity="0.6"/><line x1="56" y1="50" x2="56" y2="56" stroke="#F0B90B" stroke-width="2.5" stroke-linecap="round" opacity="0.6"/><path d="M28 76 C28 69 31 64 38 62 L47 60 L47 53 C47 50.5 49 49 51.5 49 C54 49 56 50.5 56 53 L56 59 C57.5 58 60 58 61.5 59.5 C63 58.5 65.5 59 66.5 61 L66.5 71 C66.5 77 61 81 55 81 L40 81 C34 81 28 79 28 76Z" stroke="#F0B90B" stroke-width="3" stroke-linejoin="round" fill="rgba(240,185,11,0.08)"/><line x1="18" y1="18" x2="82" y2="82" stroke="#F0B90B" stroke-width="5.5" stroke-linecap="round"/></svg><div style="font-size:15px;font-weight:800;color:var(--text);margin-bottom:6px">No Investments Yet</div><div style="font-size:12px;color:var(--muted)">Go to Products and buy a plan to start earning</div></div>'; return; }
  el.innerHTML='';
  invDocs.forEach(d=>{
    const inv=d.data(); const id=d.id;
    const now=Date.now();
    // Robust date parsing — handles ISO string, Firestore Timestamp, and ms number
    function parseInvDate(v){ if(!v) return null; if(typeof v==='number') return v; if(v.toDate) return v.toDate().getTime(); if(typeof v==='string') return new Date(v).getTime(); if(v.seconds) return v.seconds*1000; return null; }
    const startMs = parseInvDate(inv.startDate) || parseInvDate(inv.createdAt) || now;
    const endMs = parseInvDate(inv.maturityDate) || (startMs + (inv.cycle||30)*86400000);
    const totalDuration = endMs - startMs;
    const elapsed = now - startMs;
    const pct = totalDuration>0 ? Math.min(100,Math.max(0,Math.round(elapsed/totalDuration*100))) : 0;
    const daysLeft=Math.max(0,Math.round((endMs-now)/86400000));
    const isMature=inv.status==='matured'||(now>=endMs&&inv.status==='active'), isClaimed=inv.status==='claimed';
    el.innerHTML+=`
    <div class="inv-card">
      <div class="inv-top">
        <div class="inv-name">${inv.productName}</div>
        <div class="inv-status-badge ${inv.status}">${isClaimed?'Claimed':isMature?'Matured':'Active'}</div>
      </div>
      <div class="inv-progress-wrap" style="margin-bottom:6px"><div class="inv-progress" style="width:${pct}%"></div></div>
      <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--muted);margin-bottom:10px"><span>${pct}% complete</span><span>${daysLeft>0?daysLeft+'d left':'Done ✓'}</span></div>
      <div class="inv-row"><span>Amount</span><span>${ugx(inv.amount)}</span></div>
      <div class="inv-row"><span>Daily Cashback</span><span>${ugx(inv.dailyCashback)}</span></div>
      <div class="inv-row"><span>Total Return</span><span style="color:#F0B90B;font-weight:800">${ugx(inv.expectedReturn)}</span></div>
      ${inv.lockedCashback===true && inv.status==='active'?`
      <div style="margin:8px 0;background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.25);border-radius:8px;padding:9px 12px;font-size:12px;color:#fca5a5;line-height:1.6">
        🔒 Daily cashback is <strong>locked</strong> — make a real deposit to unlock it immediately and receive all accumulated earnings in your Cumulative Wallet.
        ${inv.pendingCashback?`<br>💰 Accumulated so far: <strong style="color:#fcd34d">${ugx(inv.pendingCashback)}</strong>`:''}
      </div>`:''}
      ${inv.lockedCashback!==true && inv.status==='active'?`
      <div style="margin:8px 0;background:rgba(3,166,109,.06);border:1px solid rgba(3,166,109,.2);border-radius:8px;padding:7px 12px;font-size:11px;color:rgba(3,166,109,.9);line-height:1.6">
        ✅ Daily cashback active — <strong>${ugx(inv.dailyCashback)}</strong> credited to Cumulative Wallet every 24 hrs
      </div>`:''}
      ${inv.description?`<div class="inv-row"><span>Info</span><span style="color:var(--muted);text-align:right;max-width:60%;font-size:11px">${inv.description}</span></div>`:''}
      ${isMature?`<button class="btn-claim" onclick="claimInvestment('${id}')" style="background:linear-gradient(135deg,#F0B90B,#d4a017);color:#0B0E11;font-weight:900">🎉 Claim ${ugx(inv.expectedReturn)}</button>`:''}
    </div>`;
  });
}

window._claimInvestment = async function(invId){
  if(!_user) return;
  if(!confirm('Claim returns? Funds go to your Cumulative Wallet (withdrawable).')) return;
  showToast('Claiming...','info');
  try{
    const d=await api('/invest/claim',{userId:_user.uid,investmentId:invId});
    if(d.status==='success'){ showToast(`${ugx(d.payout)} added to Cumulative Wallet! 🎉`,'success'); loadMyInvestments(); }
    else showToast(d.message,'error');
  }catch(e){ showToast('Error: '+e.message,'error'); }
};

// ══════════════════════════════════════════════════
// DEPOSIT
// ══════════════════════════════════════════════════
window._openDepositPage = function(){
  document.getElementById('depAmount').value='';
  document.getElementById('depPhone').value=cleanPhone(_userData?.phone||'');
  document.getElementById('depStatus').style.display='none';
  openPage('depositPage');
};

window._startDeposit = async function(){
  const amount=parseFloat(document.getElementById('depAmount').value);
  const phone=document.getElementById('depPhone').value.trim();
  if(!amount||amount<30000) return showToast('Minimum deposit is UGX 30,000','error');
  if(amount>200000) return showToast('Maximum deposit is UGX 200,000','error');
  if(!phone||phone.length<7) return showToast('Enter a valid phone number','error');
  const btn=document.getElementById('depBtn'); btn.disabled=true; btn.textContent='Processing...';
  const status=document.getElementById('depStatus');
  status.style.display='block'; status.textContent='Initiating payment...';
  try{
    const d=await api('/collect',{userId:_user.uid,amount,phone:fmtPhone(phone)});
    if(d.status==='success'||d.reference){
      status.textContent='📱 USSD sent — approve on your phone...';
      openTxDialog('deposit', amount, '+256'+phone);
      pollDepositLive(d.reference, amount, '+256'+phone);
    } else {
      status.textContent='❌ '+d.message;
      btn.disabled=false; btn.textContent='💰 Pay Now';
    }
  }catch(e){
    status.textContent='Network error: '+e.message;
    btn.disabled=false; btn.textContent='💰 Pay Now';
  }
};

async function pollDeposit(ref){
  const status=document.getElementById('depStatus');
  const btn=document.getElementById('depBtn');
  let tries=0;
  const timer=setInterval(async()=>{
    tries++;
    if(tries>36){ clearInterval(timer); status.textContent='Taking longer than usual. Check your Deposits Wallet balance later.'; btn.disabled=false; btn.textContent='💰 Pay Now'; return; }
    try{
      const r=await fetch(`${SERVER}/check/${ref}`);
      const d=await r.json();
      if(d.status==='success'){
        clearInterval(timer);
        status.textContent=`✅ ${ugx(d.amountCredited||d.amount)} deposited!`;
        btn.disabled=false; btn.textContent='💰 Pay Now';
        showToast('Deposit successful! 🎉','success');
      } else if(d.status==='failed'){
        clearInterval(timer);
        status.textContent='❌ Payment failed. No money deducted.';
        btn.disabled=false; btn.textContent='💰 Pay Now';
      }
    }catch(e){ console.error('poll error:', e); }
  },5000);
}

// ══════════════════════════════════════════════════
// WITHDRAW
// ══════════════════════════════════════════════════
window._openWithdrawPage = function(){
  document.getElementById('witAmount').value='';
  document.getElementById('witPhone').value=cleanPhone(_userData?.phone||'');
  window._witPin=''; window._witPinAttempts=0;
  updatePinDots_global('wd',0);
  // Reset verify state
  window._phoneVerified=false; window._verifiedPhoneName=''; window._lastVerifiedPhone='';
  const ac=document.getElementById('witAccountCard'); if(ac) ac.style.display='none';
  const ps=document.getElementById('witPinSection'); if(ps) ps.style.display='none';
  const vp=document.getElementById('witVerifyPrompt'); if(vp) vp.style.display='block';
  const vb=document.getElementById('verifyPhoneBtn');
  if(vb){ vb.innerHTML='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:4px"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>Verify'; vb.disabled=false; vb.style.background=''; vb.style.borderColor='rgba(59,130,246,.4)'; vb.style.color='#60a5fa'; }
  const wb=document.getElementById('witBtn'); if(wb){wb.disabled=true;wb.style.opacity='.4';wb.style.cursor='not-allowed';}
  const attMsg=document.getElementById('witPinAttemptsMsg'); if(attMsg) attMsg.textContent='Enter your 4-digit withdrawal PIN';
  // Load saved accounts
  const sec=document.getElementById('savedAccountsSection');
  const lst=document.getElementById('savedAccountsList');
  if(sec && lst && _user){
    api('/bank-account/list',{userId:_user.uid})
      .then(d=>{
        const active=(d.accounts||[]).filter(a=>a.status==='activated');
        if(active.length){
          sec.style.display='block';
          lst.innerHTML=active.map(a=>`<div onclick="window._selectSavedAccount('${a.phone}','${a.name}','${a.network||''}')"
            style="background:#1a1a1a;border:1.5px solid rgba(3,166,109,.35);border-radius:12px;padding:12px 14px;margin-bottom:8px;cursor:pointer;display:flex;align-items:center;justify-content:space-between">
            <div>
              <div style="font-size:13px;font-weight:700;color:#fff">${a.phone}</div>
              <div style="font-size:11px;color:var(--muted)">${a.name} · ${a.network||'Mobile Money'}</div>
            </div>
            <span style="font-size:10px;font-weight:700;background:rgba(3,166,109,.15);color:#03A66D;border:1px solid rgba(3,166,109,.3);border-radius:999px;padding:3px 10px">✅ Active</span>
          </div>`).join('');
        } else { sec.style.display='none'; }
      }).catch(()=>{sec.style.display='none';});
  }
  // Show pool balance breakdown
  const poolEl=document.getElementById('witPoolBreakdown');
  if(poolEl && _userData){
    const refBal=_userData.referralBalance||0;
    const cumBal=_userData.cumulativeBalance||0;
    const cbBal=Math.max(0,cumBal-refBal);
    const refStatus=refBal>=10000?`<span style="color:#03A66D">✓ Withdraw min UGX 10,000</span>`:`<span style="color:#ef4444">Need UGX ${(10000-refBal).toLocaleString()} more</span>`;
    const cbStatus=cbBal>=60000?`<span style="color:#03A66D">✓ Withdraw min UGX 60,000</span>`:`<span style="color:#ef4444">Locked — need UGX ${(60000-cbBal).toLocaleString()} more</span>`;
    poolEl.innerHTML=`
      <div style="display:flex;gap:8px;margin-bottom:14px">
        <div style="flex:1;background:rgba(240,185,11,.06);border:1px solid rgba(240,185,11,.18);border-radius:10px;padding:10px 12px">
          <div style="font-size:10px;color:var(--muted);margin-bottom:3px">👥 Referral Earnings</div>
          <div style="font-weight:800;color:#F0B90B;font-size:15px">UGX ${refBal.toLocaleString()}</div>
          <div style="font-size:10px;margin-top:3px">${refStatus}</div>
        </div>
        <div style="flex:1;background:rgba(3,166,109,.06);border:1px solid rgba(3,166,109,.18);border-radius:10px;padding:10px 12px">
          <div style="font-size:10px;color:var(--muted);margin-bottom:3px">📈 Daily Cashback</div>
          <div style="font-weight:800;color:#03A66D;font-size:15px">UGX ${cbBal.toLocaleString()}</div>
          <div style="font-size:10px;margin-top:3px">${cbStatus}</div>
        </div>
      </div>`;
    poolEl.style.display='block';
  }
  openPage('withdrawPage');
};

window._selectSavedAccount = function(phone, name, network){
  // Strip +256 prefix for the input (9 digits)
  const digits = phone.replace(/^\+256/,'').replace(/^\+/,'').replace(/^256/,'');
  const inp = document.getElementById('witPhone');
  if(inp) inp.value = digits;
  window._phoneVerified = true;
  window._verifiedPhoneName = name;
  window._lastVerifiedPhone = digits;
  // Show account card
  const ac=document.getElementById('witAccountCard');
  const acName=document.getElementById('witAccountName');
  const acNet=document.getElementById('witAccountNetwork');
  if(ac){ ac.style.display='block'; }
  if(acName) acName.textContent=name;
  if(acNet) acNet.textContent=(network||'Mobile Money')+' · ✅ Saved Account';
  // Show verify button as verified
  const vb=document.getElementById('verifyPhoneBtn');
  if(vb){ vb.innerHTML='✅ Verified'; vb.disabled=true; vb.style.background='rgba(3,166,109,.15)'; vb.style.borderColor='rgba(3,166,109,.4)'; vb.style.color='#03A66D'; }
  const vp=document.getElementById('witVerifyPrompt'); if(vp) vp.style.display='none';
  const ps=document.getElementById('witPinSection'); if(ps) ps.style.display='block';
  const wb=document.getElementById('witBtn'); if(wb){wb.disabled=false;wb.style.opacity='1';wb.style.cursor='pointer';}
  showToast('Account selected ✅','success');
};

function updatePinDots_global(prefix,filled){
  for(let i=0;i<4;i++){
    const d=document.getElementById(prefix+i);
    if(d) d.className='pin-dot'+(i<filled?' filled':'');
  }
}

// ── PHONE VERIFICATION ──
window._phoneVerified = false;
window._verifiedPhoneName = '';
window._lastVerifiedPhone = '';
window._witPinAttempts = 0;
const WIT_MAX_ATTEMPTS = 10;

window.verifyWithdrawPhone = async function(){
  const phone = document.getElementById('witPhone').value.trim();
  if(!phone||phone.length<7) return showToast('Enter phone number first','error');
  // Marzpay format: 256XXXXXXXXX (no + sign)
  const digits = phone.replace(/\D/g,'');
  const marzPhone = digits.startsWith('256') ? digits : '256'+digits.slice(-9);

  const verifyBtn = document.getElementById('verifyPhoneBtn');
  const accountCard = document.getElementById('witAccountCard');
  const pinSection = document.getElementById('witPinSection');
  const verifyPrompt = document.getElementById('witVerifyPrompt');
  if(verifyBtn){ verifyBtn.innerHTML='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin .7s linear infinite;vertical-align:middle"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> Checking...'; verifyBtn.disabled=true; }

  try{
    const d = await api('/verify-phone',{phone:marzPhone});
    if(d.success && (d.name||d.data?.full_name)){
      const name = d.name || d.data?.full_name || 'Verified';
      window._phoneVerified = true;
      window._verifiedPhoneName = name;
      window._lastVerifiedPhone = phone;

      // Detect network
      const pfx = digits.slice(-9).slice(0,2);
      const mtnPfx = ['76','77','78','31','39'];
      const isMTN = mtnPfx.includes(pfx);
      const network = isMTN ? 'MTN Mobile Money' : 'Airtel Money';
      const netColor = isMTN ? '#fcd34d' : '#fca5a5';
      const netBg = isMTN ? 'rgba(255,204,0,.12)' : 'rgba(239,68,68,.12)';
      const netBorder = isMTN ? 'rgba(255,204,0,.3)' : 'rgba(239,68,68,.3)';
      const displayPhone = '+256'+digits.slice(-9);

      if(accountCard){
        accountCard.style.display='block';
        accountCard.innerHTML=`
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
            <span style="font-size:10px;font-weight:700;color:rgba(3,166,109,.7);text-transform:uppercase;letter-spacing:.5px">Account Holder</span>
            <span style="display:inline-flex;align-items:center;gap:4px;background:rgba(3,166,109,.12);border:1px solid rgba(3,166,109,.35);border-radius:999px;padding:3px 10px;font-size:10px;font-weight:800;color:#03A66D">✓ VERIFIED</span>
          </div>
          <div style="font-size:17px;font-weight:800;color:#fff;margin-bottom:8px;font-family:var(--fam-cond);letter-spacing:.5px">${name}</div>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <span style="background:${netBg};border:1px solid ${netBorder};border-radius:999px;padding:4px 10px;font-size:11px;font-weight:700;color:${netColor}">${network}</span>
            <span style="font-family:var(--fam-mono);font-size:12px;color:var(--muted)">${displayPhone}</span>
          </div>
          <div style="margin-top:10px;font-size:11px;color:rgba(240,185,11,.7);background:rgba(240,185,11,.05);border-radius:8px;padding:8px 10px;line-height:1.6;border:1px solid rgba(240,185,11,.12)">
            ⚠️ Confirm this is the correct recipient. Transfers cannot be reversed.
          </div>`;
      }
      // Show PIN section, hide prompt
      if(pinSection){ pinSection.style.display='block'; }
      if(verifyPrompt){ verifyPrompt.style.display='none'; }
      if(verifyBtn){ verifyBtn.innerHTML='✓ Verified'; verifyBtn.style.background='rgba(3,166,109,.15)'; verifyBtn.style.borderColor='rgba(3,166,109,.4)'; verifyBtn.style.color='#03A66D'; verifyBtn.disabled=true; }

      // Reset PIN dots and attempts for new verify
      window._witPin=''; window._witPinAttempts=0;
      updatePinDots_global('wd',0);
      const attMsg=document.getElementById('witPinAttemptsMsg');
      if(attMsg) attMsg.textContent='Enter your 4-digit withdrawal PIN';
      showToast(`Verified: ${name}`,'success');
    } else {
      window._phoneVerified = false;
      if(verifyBtn){ verifyBtn.innerHTML='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:4px"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>Verify'; verifyBtn.disabled=false; verifyBtn.style.background=''; verifyBtn.style.borderColor=''; verifyBtn.style.color=''; }
      showToast(d.message||'Phone not found in network database','error');
    }
  }catch(e){
    window._phoneVerified = false;
    if(verifyBtn){ verifyBtn.innerHTML='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:4px"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>Verify'; verifyBtn.disabled=false; verifyBtn.style.background=''; verifyBtn.style.borderColor=''; verifyBtn.style.color=''; }
    showToast('Verification error: '+(e.message.includes('DOCTYPE')?'Server error - check Railway is running':e.message),'error');
  }
};

window.resetPhoneVerification = function(){
  window._phoneVerified = false;
  window._verifiedPhoneName = '';
  const accountCard = document.getElementById('witAccountCard');
  if(accountCard) accountCard.style.display='none';
  const pinSection = document.getElementById('witPinSection');
  if(pinSection) pinSection.style.display='none';
  const verifyPrompt = document.getElementById('witVerifyPrompt');
  if(verifyPrompt) verifyPrompt.style.display='block';
  const verifyBtn = document.getElementById('verifyPhoneBtn');
  if(verifyBtn){ verifyBtn.innerHTML='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:4px"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>Verify'; verifyBtn.disabled=false; verifyBtn.style.background=''; verifyBtn.style.borderColor=''; verifyBtn.style.color=''; }
  window._witPin=''; updatePinDots_global('wd',0);
  const witBtn=document.getElementById('witBtn'); if(witBtn){witBtn.disabled=true;witBtn.style.opacity='.4';witBtn.style.cursor='not-allowed';}
};

window._startWithdrawal = async function(){
  const amount=parseFloat(document.getElementById('witAmount').value);
  const phone=document.getElementById('witPhone').value.trim();
  const pin = window._witPin||'';
  const cum=_userData?.cumulativeBalance||0;
  const refBal=_userData?.referralBalance||0;
  const cashbackBal=Math.max(0,cum-refBal);
  if(!amount||amount<=0) return showToast('Enter withdrawal amount','error');
  if(amount>500000) return showToast('Maximum withdrawal is UGX 500,000','error');
  if(amount>cum) return showToast(`Insufficient balance. Available: ${ugx(cum)}`,'error');
  const canUseRef =refBal>=10000&&amount>=10000&&amount<=refBal;
  const canUseCash=cashbackBal>=60000&&amount>=60000&&amount<=cashbackBal;
  const canUseBoth=refBal>=10000&&cashbackBal>=60000&&amount>=10000&&amount<=(refBal+cashbackBal);
  if(!canUseRef&&!canUseCash&&!canUseBoth){
    let msg;
    const refOk=refBal>=10000, cashOk=cashbackBal>=60000;
    if(!refOk&&!cashOk)
      msg=`Referral: ${ugx(refBal)} (need 10,000) | Daily cashback: ${ugx(cashbackBal)} (need 60,000). Keep earning!`;
    else if(refOk&&!cashOk&&amount<10000)
      msg=`Minimum referral withdrawal is UGX 10,000. Your referral: ${ugx(refBal)}.`;
    else if(refOk&&!cashOk&&amount>refBal)
      msg=`Amount exceeds referral balance (${ugx(refBal)}). Daily cashback ${ugx(cashbackBal)} locked — needs UGX 60,000.`;
    else if(refOk&&!cashOk)
      msg=`Daily cashback ${ugx(cashbackBal)} is locked (need UGX 60,000). Withdraw up to ${ugx(refBal)} from referral.`;
    else if(!refOk&&cashOk&&amount<60000)
      msg=`Minimum daily cashback withdrawal is UGX 60,000.`;
    else if(!refOk&&cashOk&&amount>cashbackBal)
      msg=`Insufficient cashback. Available: ${ugx(cashbackBal)}.`;
    else
      msg=`Minimum withdrawal is UGX 10,000.`;
    return showToast(msg,'error');
  }
  if(!phone||phone.length<7) return showToast('Enter valid phone number','error');
  if(!window._phoneVerified) return showToast('Verify your phone number first','error');
  if(pin.length!==4) return showToast('Enter your 4-digit PIN','error');
  const btn=document.getElementById('witBtn'); btn.disabled=true; btn.textContent='Processing...';
  try{
    const d=await api('/withdraw/request',{userId:_user.uid,amount,phone:fmtPhone(phone),pin});
    if(d.status==='success'){
      closePage('withdrawPage');
      window._witPin=''; updatePinDots_global('wd',0);
      const formattedPhone = '+256'+phone;
      openTxDialog('withdraw', amount, formattedPhone);
      if(d.withdrawalId) pollWithdrawalLive(d.withdrawalId, d.netAmount||amount, formattedPhone);
      else {
        // No withdrawalId returned — show processing state
        setTimeout(()=>txDialogSuccess(
          'Withdrawal Submitted ✓',
          'Your withdrawal is being processed via mobile money.',
          d.netAmount||amount,
          [['Phone',formattedPhone],['Status','Processing 🔄','var(--primary)']]
        ),1500);
      }
    } else if(d.needsPin){
      // First time: no PIN set yet - open set PIN page
      closePage('withdrawPage');
      // Reset setPin state
      window._setPin=''; window._setPinStep=1; window._setPinFirst='';
      updatePinDots_global('sp',0);
      document.getElementById('setPinSubtext').textContent='Enter a 4-digit PIN to secure withdrawals';
      openPage('setPinPage');
      showToast('Set your withdrawal PIN first','error');
    } else {
      // Wrong PIN or locked
      if(d.attemptsLeft !== undefined){
        window._witPinAttempts = WIT_MAX_ATTEMPTS - d.attemptsLeft;
        const attMsg=document.getElementById('witPinAttemptsMsg');
        if(d.attemptsLeft===0){
          if(attMsg) attMsg.innerHTML='<span style="color:#ef4444">❌ Account locked. Contact support.</span>';
          // Disable keypad
          document.querySelectorAll('.pin-key').forEach(k=>k.style.pointerEvents='none');
        } else {
          if(attMsg) attMsg.innerHTML=`<span style="color:#ef4444">Wrong PIN — ${d.attemptsLeft} attempt${d.attemptsLeft===1?'':'s'} left</span>`;
        }
      }
      // Clear PIN
      window._witPin=''; updatePinDots_global('wd',0);
      const witBtn=document.getElementById('witBtn');
      if(witBtn){witBtn.disabled=true;witBtn.style.opacity='.4';witBtn.style.cursor='not-allowed';}
      showToast(d.message||'Error','error');
    }
  }catch(e){ showToast('Error: '+e.message,'error'); }
  finally{ btn.disabled=false; btn.textContent='💸 Withdraw'; }
};

// Override witPinKey to sync with module state
window.witPinKey = function(k){
  if(!window._witPin) window._witPin='';
  if(window._witPin.length<4){
    window._witPin+=k;
    updatePinDots_global('wd',window._witPin.length);
    // Enable withdraw button when 4 digits entered
    const witBtn=document.getElementById('witBtn');
    if(witBtn){
      if(window._witPin.length===4){
        witBtn.disabled=false; witBtn.style.opacity='1'; witBtn.style.cursor='pointer';
      } else {
        witBtn.disabled=true; witBtn.style.opacity='.4'; witBtn.style.cursor='not-allowed';
      }
    }
  }
};
window.witPinDel = function(){
  if(!window._witPin) window._witPin='';
  window._witPin=window._witPin.slice(0,-1);
  updatePinDots_global('wd',window._witPin.length);
  const witBtn=document.getElementById('witBtn');
  if(witBtn){ witBtn.disabled=true; witBtn.style.opacity='.4'; witBtn.style.cursor='not-allowed'; }
};

// ══════════════════════════════════════════════════
// SET PIN
// ══════════════════════════════════════════════════
window._finalizeSetPin = async function(pin){
  try{
    const d=await api('/pin/set',{userId:_user.uid,pin});
    if(d.status==='success'){
      closePage('setPinPage');
      showToast('PIN set successfully! 🔒','success');
    } else showToast(d.message,'error');
  }catch(e){ showToast('Error: '+e.message,'error'); }
};

window._saveWithdrawPin = async function(){
  const pin = window._waPin||'';
  if(pin.length!==4) return showToast('Enter a 4-digit PIN','error');
  try{
    const d=await api('/pin/set',{userId:_user.uid,pin});
    const msg=document.getElementById('waPinMsg');
    if(d.status==='success'){
      if(msg) msg.innerHTML='<div style="color:var(--green);font-weight:700;font-size:13px">✅ PIN saved!</div>';
      showToast('PIN set successfully!','success');
    } else { if(msg) msg.innerHTML=`<div style="color:var(--primary);font-size:13px">❌ ${d.message}</div>`; }
  }catch(e){ showToast('Error: '+e.message,'error'); }
};

// ── Fee calculator + pool routing hint ──
window.calcWithdrawFee = function(){
  const amt = parseFloat(document.getElementById('witAmount').value)||0;
  const preview = document.getElementById('witFeePreview');
  const hintEl = document.getElementById('witRouteHint');
  if(!preview) return;
  if(amt < 1){ preview.style.display='none'; if(hintEl) hintEl.style.display='none'; return; }
  const feePct = parseFloat(document.getElementById('witFeeDisplay')?.textContent)||11;
  const fee = Math.round(amt * feePct / 100);
  const net = amt - fee;
  preview.style.display='block';
  document.getElementById('feePreviewAmount').textContent = ugx(amt);
  document.getElementById('feePreviewFee').textContent = '- '+ugx(fee);
  document.getElementById('feePreviewNet').textContent = ugx(net);
  document.getElementById('feePreviewPct').textContent = feePct;
  // Pool routing hint
  if(hintEl && _userData){
    const refBal=_userData.referralBalance||0;
    const cumBal=_userData.cumulativeBalance||0;
    const cbBal=Math.max(0,cumBal-refBal);
    const canRef=refBal>=10000&&amt<=refBal;
    const canCash=cbBal>=60000&&amt<=cbBal;
    const canBoth=refBal>=10000&&cbBal>=60000&&amt<=(refBal+cbBal);
    let hint='',color='#ef4444';
    if(canRef&&!canCash){
      hint=`✅ From Referral Earnings (${ugx(refBal)} available)`;color='#03A66D';
    } else if(canCash&&!canRef){
      hint=`✅ From Daily Cashback (${ugx(cbBal)} available)`;color='#03A66D';
    } else if(canBoth){
      hint=`✅ Referral first, Daily Cashback covers remainder`;color='#03A66D';
    } else if(refBal>=10000&&amt>refBal&&cbBal<60000){
      hint=`⚠️ Exceeds referral (${ugx(refBal)}). Daily cashback ${ugx(cbBal)} needs UGX 60,000 min.`;
    } else if(refBal<10000&&cbBal<60000){
      hint=`❌ Referral ${ugx(refBal)} (need 10k) · Cashback ${ugx(cbBal)} (need 60k)`;
    } else if(amt>cumBal){
      hint=`❌ Insufficient — total available: ${ugx(cumBal)}`;
    } else {
      hint=`⚠️ Check pool minimums above`;
    }
    hintEl.textContent=hint;
    hintEl.style.color=color;
    hintEl.style.display='block';
  }
};

// ── Withdrawal Account Page — Bank Accounts + PIN ──
window._witAccPageFn = async function(){
  const body = document.getElementById('waPinBody');
  if(body) body.innerHTML='<div class="page-loader"><div class="spinner"></div></div>';
  openPage('withdrawAccountPage');
  if(!_user) return;
  try{
    const [pinData, accData] = await Promise.all([
      api('/pin/status',{userId:_user.uid}),
      api('/bank-account/list',{userId:_user.uid})
    ]);
    const accounts = accData.accounts || [];
    const hasDeposited = (_userData?.depositCount||0) > 0;
    const hasAccounts  = accounts.length > 0;

    // ── Bank Accounts Section ──
    const statusColor = s => s==='activated'?'#03A66D':s==='invalid'?'#ef4444':'#F0B90B';
    const statusBg    = s => s==='activated'?'rgba(3,166,109,.15)':s==='invalid'?'rgba(239,68,68,.15)':'rgba(240,185,11,.15)';

    let bankSection = `<div style="padding:18px 16px 10px">
      <div style="font-size:15px;font-weight:800;color:#fff;margin-bottom:4px">🏦 Bind Bank Account</div>
      <div style="font-size:11px;color:var(--muted);margin-bottom:14px">Up to 2 mobile money accounts for withdrawals</div>`;

    if(!hasDeposited && !hasAccounts){
      bankSection += `<div style="background:#1a1a1a;border:1px solid #2a2a2a;border-radius:12px;padding:16px;text-align:center;margin-bottom:4px">
        <div style="font-size:28px;margin-bottom:8px">🔒</div>
        <div style="font-size:13px;font-weight:700;color:#fff;margin-bottom:4px">Deposit Required</div>
        <div style="font-size:12px;color:var(--muted)">Make a deposit first to unlock this feature</div>
      </div>`;
    } else {
      // List existing accounts
      accounts.forEach(a=>{
        const c=statusColor(a.status), bg=statusBg(a.status);
        bankSection += `<div style="background:#1a1a1a;border:1px solid #2a2a2a;border-radius:12px;padding:13px 14px;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between">
          <div>
            <div style="font-size:13px;font-weight:700;color:#fff">${a.phone}</div>
            <div style="font-size:11px;color:var(--muted);margin-top:2px">${a.name} · ${a.network||'Mobile Money'}</div>
          </div>
          <span style="font-size:10px;font-weight:700;background:${bg};color:${c};border:1px solid ${c}44;border-radius:999px;padding:3px 10px;text-transform:uppercase">${a.status}</span>
        </div>`;
      });
      if(accounts.length < 2){
        bankSection += `<div style="background:#1a1a1a;border:1.5px solid rgba(240,185,11,.2);border-radius:12px;padding:14px;margin-bottom:4px">
          <div style="font-size:12px;font-weight:700;color:#F0B90B;margin-bottom:10px">➕ Add New Account</div>
          <div style="display:flex;gap:8px;margin-bottom:10px">
            <div style="background:#0B0E11;border:1.5px solid #2a2a2a;border-radius:10px;padding:10px 12px;font-size:13px;color:var(--muted);font-weight:700;white-space:nowrap">+256</div>
            <input id="baPhone" type="tel" placeholder="7XXXXXXXX" maxlength="9" style="flex:1;background:#0B0E11;border:1.5px solid #2a2a2a;border-radius:10px;padding:10px 12px;font-size:13px;color:#fff;font-family:var(--fam);outline:none;-webkit-appearance:none">
            <button id="baVerifyBtn" onclick="window._verifyBankPhone()" style="background:#0B0E11;border:1.5px solid rgba(59,130,246,.4);color:#60a5fa;border-radius:10px;padding:0 12px;font-size:11px;font-weight:800;cursor:pointer;white-space:nowrap;font-family:var(--fam);height:46px">Verify</button>
          </div>
          <div id="baVerifiedCard" style="display:none;background:#0B0E11;border:1px solid rgba(3,166,109,.3);border-radius:10px;padding:10px;margin-bottom:10px">
            <div id="baVerifiedName" style="font-size:13px;font-weight:700;color:#03A66D"></div>
            <div id="baVerifiedNet" style="font-size:11px;color:var(--muted);margin-top:2px"></div>
          </div>
          <button id="baSaveBtn" onclick="window._saveBankAccount()" style="display:none;width:100%;padding:13px;background:#F0B90B;border:none;border-radius:12px;color:#000;font-size:14px;font-weight:800;cursor:pointer;font-family:var(--fam)">💾 Save Account</button>
          <div id="baMsg" style="font-size:11px;color:var(--muted);margin-top:8px;text-align:center"></div>
        </div>`;
      }
    }
    bankSection += `</div>`;

    // ── PIN Section ──
    let pinSection = `<div style="height:1px;background:#1a1a1a;margin:4px 16px 16px"></div>`;
    if(pinData.hasPin){
      pinSection += `<div style="padding:0 16px 24px;text-align:center">
        <div style="font-size:15px;font-weight:800;color:#fff;margin-bottom:16px;text-align:left">🔐 Withdrawal PIN</div>
        <div style="width:56px;height:56px;background:rgba(240,185,11,.1);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 14px">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#F0B90B" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        </div>
        <div style="font-size:14px;font-weight:700;color:#fff;margin-bottom:6px">PIN Active ✅</div>
        <div style="font-size:12px;color:var(--muted);margin-bottom:20px;line-height:1.6">Your withdrawal PIN is active and protecting your account.</div>
        <button onclick="requestPinReset()" style="width:100%;padding:14px;background:#1a1a1a;border:1.5px solid rgba(240,185,11,.3);border-radius:14px;color:#F0B90B;font-size:13px;font-weight:800;cursor:pointer;font-family:var(--fam)">📲 Reset PIN via SMS OTP</button>
      </div>`;
    } else {
      pinSection += `<div style="padding:0 16px 24px">
        <div style="font-size:15px;font-weight:800;color:#fff;margin-bottom:16px">🔐 Set Withdrawal PIN</div>
        <div style="text-align:center">
          <div style="font-size:12px;color:var(--muted);margin-bottom:20px;line-height:1.6">Create a 4-digit PIN to secure withdrawals.<br><span style="color:rgba(240,185,11,.7)">⚠️ Once set, PIN cannot be changed without admin approval.</span></div>
          <div class="pin-dots" id="waPinDots" style="margin-bottom:20px">
            <div class="pin-dot" id="wa0"></div><div class="pin-dot" id="wa1"></div>
            <div class="pin-dot" id="wa2"></div><div class="pin-dot" id="wa3"></div>
          </div>
          <div class="pin-keypad" style="margin-bottom:20px">
            <div class="pin-key" onclick="waPinKey('1')">1</div><div class="pin-key" onclick="waPinKey('2')">2</div><div class="pin-key" onclick="waPinKey('3')">3</div>
            <div class="pin-key" onclick="waPinKey('4')">4</div><div class="pin-key" onclick="waPinKey('5')">5</div><div class="pin-key" onclick="waPinKey('6')">6</div>
            <div class="pin-key" onclick="waPinKey('7')">7</div><div class="pin-key" onclick="waPinKey('8')">8</div><div class="pin-key" onclick="waPinKey('9')">9</div>
            <div class="pin-key" style="visibility:hidden"></div><div class="pin-key" onclick="waPinKey('0')">0</div><div class="pin-key del" onclick="waPinDel()">⌫</div>
          </div>
          <button class="btn-auth" onclick="saveWithdrawPin()" style="width:100%">Save PIN</button>
          <div id="waPinMsg" style="margin-top:10px;text-align:center"></div>
        </div>
      </div>`;
    }

    body.innerHTML = bankSection + pinSection;
  } catch(e) {
    // Fallback
    const body2 = document.getElementById('waPinBody');
    if(body2) showSetPinInAccount(body2);
  }
};

// ── Bank Account: Verify Phone ──
window._verifyBankPhone = async function(){
  const phone = (document.getElementById('baPhone')?.value||'').trim();
  if(!phone||phone.length<7) return showToast('Enter a phone number first','error');
  const digits = phone.replace(/\D/g,'');
  const marzPhone = digits.startsWith('256') ? digits : '256'+digits.slice(-9);
  const btn = document.getElementById('baVerifyBtn');
  if(btn){ btn.textContent='Checking...'; btn.disabled=true; }
  document.getElementById('baMsg').textContent='';
  try{
    const d = await api('/verify-phone',{phone:marzPhone});
    if(d.success && d.name){
      const net = marzPhone.startsWith('25677')||marzPhone.startsWith('25676')||marzPhone.startsWith('25639')||marzPhone.startsWith('25631') ? 'MTN' :
                  marzPhone.startsWith('25670')||marzPhone.startsWith('25675')||marzPhone.startsWith('25674') ? 'Airtel' : 'Mobile Money';
      window._baVerifiedName = d.name;
      window._baVerifiedNet  = net;
      window._baVerifiedPhone= '+256'+digits.slice(-9);
      const card = document.getElementById('baVerifiedCard');
      if(card){ card.style.display='block'; }
      const nameEl = document.getElementById('baVerifiedName');
      const netEl  = document.getElementById('baVerifiedNet');
      if(nameEl) nameEl.textContent = d.name;
      if(netEl)  netEl.textContent  = net+' · ✅ Verified';
      const saveBtn = document.getElementById('baSaveBtn');
      if(saveBtn) saveBtn.style.display='block';
      if(btn){ btn.textContent='✅ Verified'; btn.style.borderColor='rgba(3,166,109,.4)'; btn.style.color='#03A66D'; }
    } else {
      document.getElementById('baMsg').textContent = d.message || 'Number not found. Try again.';
      document.getElementById('baMsg').style.color = '#ef4444';
      if(btn){ btn.textContent='Verify'; btn.disabled=false; }
    }
  } catch(e) {
    document.getElementById('baMsg').textContent = 'Verification failed. Check your connection.';
    document.getElementById('baMsg').style.color = '#ef4444';
    if(btn){ btn.textContent='Verify'; btn.disabled=false; }
  }
};

// ── Bank Account: Save ──
window._saveBankAccount = async function(){
  if(!_user){ showToast('Not logged in','error'); return; }
  if(!window._baVerifiedPhone || !window._baVerifiedName){ showToast('Verify a phone number first','error'); return; }
  const saveBtn = document.getElementById('baSaveBtn');
  if(saveBtn){ saveBtn.disabled=true; saveBtn.textContent='Saving...'; }
  try{
    const d = await api('/bank-account/add',{userId:_user.uid,phone:window._baVerifiedPhone,name:window._baVerifiedName,network:window._baVerifiedNet||''});
    if(d.status==='success'){
      showToast('Account saved! Pending admin review ⏳','success',4000);
      window._baVerifiedPhone=''; window._baVerifiedName=''; window._baVerifiedNet='';
      window._witAccPageFn(); // Refresh page
    } else {
      showToast(d.message||'Save failed','error');
      if(saveBtn){ saveBtn.disabled=false; saveBtn.textContent='💾 Save Account'; }
    }
  } catch(e) {
    showToast('Error: '+e.message,'error');
    if(saveBtn){ saveBtn.disabled=false; saveBtn.textContent='💾 Save Account'; }
  }
};

function showSetPinInAccount(body){
  window._waPin='';
  if(body) body.innerHTML=`
    <div style="padding:20px">
      <div style="text-align:center;margin-bottom:24px">
        <div style="font-size:40px;margin-bottom:10px">🔐</div>
        <div style="font-size:16px;font-weight:800;color:#fff;margin-bottom:6px">Set Withdrawal PIN</div>
        <div style="font-size:12px;color:var(--muted);line-height:1.6">Create a 4-digit PIN to secure withdrawals.<br><span style="color:rgba(240,185,11,.7)">⚠️ Once set, PIN cannot be changed without admin approval.</span></div>
      </div>
      <div class="pin-dots" id="waPinDots" style="margin-bottom:20px">
        <div class="pin-dot" id="wa0"></div><div class="pin-dot" id="wa1"></div>
        <div class="pin-dot" id="wa2"></div><div class="pin-dot" id="wa3"></div>
      </div>
      <div class="pin-keypad" style="margin-bottom:20px">
        <div class="pin-key" onclick="waPinKey('1')">1</div><div class="pin-key" onclick="waPinKey('2')">2</div><div class="pin-key" onclick="waPinKey('3')">3</div>
        <div class="pin-key" onclick="waPinKey('4')">4</div><div class="pin-key" onclick="waPinKey('5')">5</div><div class="pin-key" onclick="waPinKey('6')">6</div>
        <div class="pin-key" onclick="waPinKey('7')">7</div><div class="pin-key" onclick="waPinKey('8')">8</div><div class="pin-key" onclick="waPinKey('9')">9</div>
        <div class="pin-key" style="visibility:hidden"></div><div class="pin-key" onclick="waPinKey('0')">0</div><div class="pin-key del" onclick="waPinDel()">⌫</div>
      </div>
      <button class="btn-auth" onclick="saveWithdrawPin()" style="width:100%">Save PIN</button>
      <div id="waPinMsg" style="margin-top:10px;text-align:center"></div>
    </div>`;
}

window.requestPasswordReset = async function(btn){
  if(!_user) return;
  if(!confirm('Send a password reset request to admin? They will reset your password and notify you.')) return;
  if(btn){ btn.disabled=true; btn.textContent='Sending...'; }
  try{
    const d=await api('/password/request-reset',{userId:_user.uid});
    showToast('Password reset request sent! Admin will contact you shortly.','success',4000);
  }catch(e){ showToast('Request sent to admin','success'); }
  finally{ if(btn){ btn.disabled=false; btn.textContent='📩 Request Password Reset from Admin'; } }
};

// ── OTP Password Reset ──
window.requestPasswordResetOTP = function(){
  if(!_user) return;
  const overlay = document.createElement('div');
  overlay.id = 'passOtpOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.85);display:flex;align-items:flex-end;justify-content:center';
  overlay.innerHTML = `
    <div style="width:100%;max-width:520px;background:#141414;border-radius:20px 20px 0 0;padding:24px 20px 40px">
      <div style="text-align:center;margin-bottom:20px">
        <div style="font-size:20px;font-weight:900;color:#F0B90B">🔑 Reset Password via SMS</div>
        <div style="font-size:12px;color:var(--muted);margin-top:6px">An OTP will be sent to your registered phone number</div>
      </div>
      <div id="passOtpStep1">
        <div style="background:#1a1a1a;border-radius:12px;padding:14px;margin-bottom:16px;text-align:center">
          <div style="font-size:11px;color:var(--muted);margin-bottom:4px">Sending OTP to</div>
          <div style="font-size:16px;font-weight:800;color:#fff">${_userData?.phone||'your phone'}</div>
        </div>
        <button onclick="window._sendPassOTP()" style="width:100%;padding:14px;background:#F0B90B;border:none;border-radius:14px;color:#000;font-size:14px;font-weight:900;cursor:pointer;font-family:var(--fam)">📲 Send OTP</button>
        <div id="passOtpMsg1" style="margin-top:10px;text-align:center;font-size:12px"></div>
      </div>
      <div id="passOtpStep2" style="display:none">
        <div style="font-size:12px;color:var(--muted);text-align:center;margin-bottom:16px">Enter the 6-digit code sent to your phone</div>
        <input id="passOtpCodeInput" type="number" placeholder="6-digit OTP" maxlength="6"
          style="width:100%;padding:14px;background:#1a1a1a;border:1.5px solid rgba(240,185,11,.3);border-radius:12px;color:#fff;font-size:20px;font-weight:900;text-align:center;letter-spacing:6px;box-sizing:border-box;font-family:var(--fam)" />
        <button onclick="window._verifyPassOTP()" style="width:100%;padding:14px;background:#F0B90B;border:none;border-radius:14px;color:#000;font-size:14px;font-weight:900;cursor:pointer;font-family:var(--fam);margin-top:12px">✅ Verify OTP</button>
        <div id="passOtpMsg2" style="margin-top:10px;text-align:center;font-size:12px"></div>
      </div>
      <div id="passOtpStep3" style="display:none">
        <div style="font-size:12px;color:var(--muted);text-align:center;margin-bottom:16px">Enter your new password (min 6 characters)</div>
        <input id="passOtpNewPass" type="password" placeholder="New password" minlength="6"
          style="width:100%;padding:14px;background:#1a1a1a;border:1.5px solid rgba(240,185,11,.3);border-radius:12px;color:#fff;font-size:15px;box-sizing:border-box;font-family:var(--fam);margin-bottom:10px" />
        <input id="passOtpNewPass2" type="password" placeholder="Confirm new password" minlength="6"
          style="width:100%;padding:14px;background:#1a1a1a;border:1.5px solid rgba(240,185,11,.3);border-radius:12px;color:#fff;font-size:15px;box-sizing:border-box;font-family:var(--fam)" />
        <button onclick="window._saveNewPassword()" style="width:100%;padding:14px;background:#F0B90B;border:none;border-radius:14px;color:#000;font-size:14px;font-weight:900;cursor:pointer;font-family:var(--fam);margin-top:12px">🔑 Save New Password</button>
        <div id="passOtpMsg3" style="margin-top:10px;text-align:center;font-size:12px"></div>
      </div>
      <button onclick="document.getElementById('passOtpOverlay').remove()" style="width:100%;padding:12px;background:transparent;border:1px solid #333;border-radius:14px;color:var(--muted);font-size:13px;cursor:pointer;font-family:var(--fam);margin-top:12px">Cancel</button>
    </div>`;
  document.body.appendChild(overlay);
};

window._sendPassOTP = async function(){
  const btn = document.querySelector('#passOtpStep1 button');
  const msg = document.getElementById('passOtpMsg1');
  btn.disabled=true; btn.textContent='⏳ Sending...'; msg.textContent='';
  try{
    const d = await api('/otp/send',{userId:_user.uid, phone:_userData?.phone, purpose:'password'});
    if(d.status==='success'){
      document.getElementById('passOtpStep1').style.display='none';
      document.getElementById('passOtpStep2').style.display='block';
      showToast('OTP sent! Check your phone 📱','success',4000);
    } else {
      msg.style.color='#ef4444'; msg.textContent=d.message||'Failed to send OTP';
      btn.disabled=false; btn.textContent='📲 Send OTP';
    }
  }catch(e){
    msg.style.color='#ef4444'; msg.textContent='Error: '+e.message;
    btn.disabled=false; btn.textContent='📲 Send OTP';
  }
};

window._verifyPassOTP = async function(){
  const code = document.getElementById('passOtpCodeInput').value.trim();
  const msg  = document.getElementById('passOtpMsg2');
  if(!code||code.length!==6){ msg.style.color='#ef4444'; msg.textContent='Enter the 6-digit code'; return; }
  const btn = document.querySelector('#passOtpStep2 button');
  if(btn){ btn.disabled=true; btn.textContent='⏳ Verifying...'; }
  msg.textContent='';
  // Verify on the server now — reject a wrong code before the new-password screen.
  try{
    const d = await api('/otp/verify',{userId:_user.uid, otp:code, purpose:'password'});
    if(d.status==='success'){
      window._passOtpCode = code;
      msg.style.color='#22c55e'; msg.textContent='✅ Code verified';
      document.getElementById('passOtpStep2').style.display='none';
      document.getElementById('passOtpStep3').style.display='block';
    } else {
      msg.style.color='#ef4444'; msg.textContent = d.message||'Wrong OTP';
    }
  }catch(e){
    msg.style.color='#ef4444'; msg.textContent='Error: '+e.message;
  }finally{
    if(btn){ btn.disabled=false; btn.textContent='✅ Verify OTP'; }
  }
};

window._saveNewPassword = async function(){
  const pass  = document.getElementById('passOtpNewPass').value;
  const pass2 = document.getElementById('passOtpNewPass2').value;
  const msg   = document.getElementById('passOtpMsg3');
  if(!pass||pass.length<6){ msg.style.color='#ef4444'; msg.textContent='Password must be at least 6 characters'; return; }
  if(pass!==pass2){ msg.style.color='#ef4444'; msg.textContent='Passwords do not match'; return; }
  const btn = document.querySelector('#passOtpStep3 button');
  btn.disabled=true; btn.textContent='⏳ Saving...'; msg.textContent='';
  try{
    const d = await api('/password/reset-via-otp',{userId:_user.uid, otp:window._passOtpCode, newPassword:pass});
    if(d.status==='success'){
      document.getElementById('passOtpOverlay')?.remove();
      // Also update Firebase Auth client-side session
      await signOut(auth);
      showToast('Password reset! Please log in with your new password.','success',5000);
    } else {
      msg.style.color='#ef4444'; msg.textContent=d.message||'Failed. Try again.';
      if(d.message?.includes('OTP')){
        setTimeout(()=>{ document.getElementById('passOtpStep3').style.display='none'; document.getElementById('passOtpStep2').style.display='block'; },1200);
      }
      btn.disabled=false; btn.textContent='🔑 Save New Password';
    }
  }catch(e){
    msg.style.color='#ef4444'; msg.textContent='Error: '+e.message;
    btn.disabled=false; btn.textContent='🔑 Save New Password';
  }
};

// ── OTP PIN Reset ──
window._otpStep = 0; // 0=idle 1=awaiting-otp 2=awaiting-new-pin
window._otpPin  = '';

window.requestPinReset = function(){
  if(!_user) return;
  // Show OTP flow bottom sheet
  const overlay = document.createElement('div');
  overlay.id = 'otpOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.85);display:flex;align-items:flex-end;justify-content:center';
  overlay.innerHTML = `
    <div style="width:100%;max-width:520px;background:#141414;border-radius:20px 20px 0 0;padding:24px 20px 40px">
      <div style="text-align:center;margin-bottom:20px">
        <div style="font-size:20px;font-weight:900;color:#F0B90B">🔐 Reset PIN via SMS</div>
        <div style="font-size:12px;color:var(--muted);margin-top:6px">An OTP will be sent to your registered phone number</div>
      </div>
      <div id="otpStep1">
        <div style="background:#1a1a1a;border-radius:12px;padding:14px;margin-bottom:16px;text-align:center">
          <div style="font-size:11px;color:var(--muted);margin-bottom:4px">Sending OTP to</div>
          <div style="font-size:16px;font-weight:800;color:#fff">${_userData?.phone||'your phone'}</div>
        </div>
        <button onclick="window._sendOTP()" style="width:100%;padding:14px;background:#F0B90B;border:none;border-radius:14px;color:#000;font-size:14px;font-weight:900;cursor:pointer;font-family:var(--fam)">📲 Send OTP</button>
        <div id="otpMsg1" style="margin-top:10px;text-align:center;font-size:12px"></div>
      </div>
      <div id="otpStep2" style="display:none">
        <div style="font-size:12px;color:var(--muted);text-align:center;margin-bottom:16px">Enter the 6-digit code sent to your phone</div>
        <input id="otpCodeInput" type="number" placeholder="6-digit OTP" maxlength="6"
          style="width:100%;padding:14px;background:#1a1a1a;border:1.5px solid rgba(240,185,11,.3);border-radius:12px;color:#fff;font-size:20px;font-weight:900;text-align:center;letter-spacing:6px;box-sizing:border-box;font-family:var(--fam)" />
        <button onclick="window._verifyOTP()" style="width:100%;padding:14px;background:#F0B90B;border:none;border-radius:14px;color:#000;font-size:14px;font-weight:900;cursor:pointer;font-family:var(--fam);margin-top:12px">✅ Verify OTP</button>
        <div id="otpMsg2" style="margin-top:10px;text-align:center;font-size:12px"></div>
      </div>
      <div id="otpStep3" style="display:none">
        <div style="font-size:12px;color:var(--muted);text-align:center;margin-bottom:16px">Enter your new 4-digit PIN</div>
        <div class="pin-dots" style="justify-content:center;margin-bottom:16px">
          <div class="pin-dot" id="otp_p0"></div><div class="pin-dot" id="otp_p1"></div>
          <div class="pin-dot" id="otp_p2"></div><div class="pin-dot" id="otp_p3"></div>
        </div>
        <div class="pin-keypad" style="margin-bottom:16px">
          <div class="pin-key" onclick="window._otpPinKey('1')">1</div><div class="pin-key" onclick="window._otpPinKey('2')">2</div><div class="pin-key" onclick="window._otpPinKey('3')">3</div>
          <div class="pin-key" onclick="window._otpPinKey('4')">4</div><div class="pin-key" onclick="window._otpPinKey('5')">5</div><div class="pin-key" onclick="window._otpPinKey('6')">6</div>
          <div class="pin-key" onclick="window._otpPinKey('7')">7</div><div class="pin-key" onclick="window._otpPinKey('8')">8</div><div class="pin-key" onclick="window._otpPinKey('9')">9</div>
          <div class="pin-key" style="visibility:hidden"></div><div class="pin-key" onclick="window._otpPinKey('0')">0</div><div class="pin-key del" onclick="window._otpPinDel()">⌫</div>
        </div>
        <div id="otpMsg3" style="text-align:center;font-size:12px"></div>
      </div>
      <button onclick="document.getElementById('otpOverlay').remove()" style="width:100%;padding:12px;background:transparent;border:1px solid #333;border-radius:14px;color:var(--muted);font-size:13px;cursor:pointer;font-family:var(--fam);margin-top:12px">Cancel</button>
    </div>`;
  document.body.appendChild(overlay);
  window._otpPin = '';
};

window._sendOTP = async function(){
  const btn = document.querySelector('#otpStep1 button');
  const msg = document.getElementById('otpMsg1');
  btn.disabled = true; btn.textContent = '⏳ Sending...'; msg.textContent = '';
  try{
    const d = await api('/otp/send',{userId:_user.uid, phone:_userData?.phone});
    if(d.status==='success'){
      document.getElementById('otpStep1').style.display='none';
      document.getElementById('otpStep2').style.display='block';
      showToast('OTP sent! Check your phone 📱','success',4000);
    } else {
      msg.style.color='#ef4444'; msg.textContent = d.message||'Failed to send OTP';
      btn.disabled=false; btn.textContent='📲 Send OTP';
    }
  }catch(e){
    msg.style.color='#ef4444'; msg.textContent='Error: '+e.message;
    btn.disabled=false; btn.textContent='📲 Send OTP';
  }
};

window._verifyOTP = async function(){
  const code = document.getElementById('otpCodeInput').value.trim();
  const msg  = document.getElementById('otpMsg2');
  if(!code||code.length!==6){ msg.style.color='#ef4444'; msg.textContent='Enter the 6-digit code'; return; }
  const btn = document.querySelector('#otpStep2 button');
  btn.disabled=true; btn.textContent='⏳ Verifying...'; msg.textContent='';
  // Verify the OTP on the server NOW so a wrong code is rejected here,
  // before the new-PIN screen. The code is consumed later by /pin/reset-via-otp.
  try{
    const d = await api('/otp/verify',{userId:_user.uid, otp:code, purpose:'pin'});
    if(d.status==='success'){
      window._otpVerifiedCode = code;
      msg.style.color='#22c55e'; msg.textContent='✅ Code verified';
      document.getElementById('otpStep2').style.display='none';
      document.getElementById('otpStep3').style.display='block';
    } else {
      msg.style.color='#ef4444'; msg.textContent = d.message||'Wrong OTP';
    }
  }catch(e){
    msg.style.color='#ef4444'; msg.textContent='Error: '+e.message;
  }finally{
    btn.disabled=false; btn.textContent='✅ Verify OTP';
  }
};

window._otpPinKey = function(k){
  if(window._otpPin.length<4){
    window._otpPin+=k;
    for(let i=0;i<4;i++){const d=document.getElementById('otp_p'+i); if(d) d.className='pin-dot'+(i<window._otpPin.length?' filled':'');}
    if(window._otpPin.length===4) window._saveOTPPin();
  }
};
window._otpPinDel = function(){
  window._otpPin=window._otpPin.slice(0,-1);
  for(let i=0;i<4;i++){const d=document.getElementById('otp_p'+i); if(d) d.className='pin-dot'+(i<window._otpPin.length?' filled':'');}
};
window._saveOTPPin = async function(){
  const msg = document.getElementById('otpMsg3');
  msg.style.color='var(--muted)'; msg.textContent='Saving new PIN...';
  try{
    const d = await api('/pin/reset-via-otp',{userId:_user.uid, otp:window._otpVerifiedCode, newPin:window._otpPin});
    if(d.status==='success'){
      document.getElementById('otpOverlay')?.remove();
      showToast('PIN reset successfully! ✅','success',4000);
    } else {
      window._otpPin='';
      for(let i=0;i<4;i++){const dot=document.getElementById('otp_p'+i); if(dot) dot.className='pin-dot';}
      msg.style.color='#ef4444'; msg.textContent=d.message||'Failed. Try again.';
      if(d.message?.includes('OTP')){
        // OTP was wrong — go back to OTP entry step
        setTimeout(()=>{ document.getElementById('otpStep3').style.display='none'; document.getElementById('otpStep2').style.display='block'; },1200);
      }
    }
  }catch(e){
    msg.style.color='#ef4444'; msg.textContent='Error: '+e.message;
    window._otpPin='';
    for(let i=0;i<4;i++){const dot=document.getElementById('otp_p'+i); if(dot) dot.className='pin-dot';}
  }
};

window.requestWithdrawalPhoneChange = async function(){
  if(!_user) return;
  const newPhone = prompt('Enter the new withdrawal phone number (e.g. 0771234567):');
  if(!newPhone || !newPhone.trim()) return;
  if(!confirm(`Request to change withdrawal phone to ${newPhone.trim()}?`)) return;
  try{
    const d=await api('/withdraw/request-phone-change',{userId:_user.uid,newPhone:newPhone.trim()});
    showToast(d.message||'Request sent! Admin will review shortly.','success',4000);
  }catch(e){ showToast('Request sent to admin','success'); }
};

window.waPinKey = function(k){
  if(!window._waPin) window._waPin='';
  if(window._waPin.length<4){ window._waPin+=k; updatePinDots_global('wa',window._waPin.length); }
};
window.waPinDel = function(){
  if(!window._waPin) window._waPin='';
  window._waPin=window._waPin.slice(0,-1); updatePinDots_global('wa',window._waPin.length);
};

// ══════════════════════════════════════════════════
// CHECK-IN
// ══════════════════════════════════════════════════
window._doCheckin = async function(){
  if(!_user) return;
  const btn1=document.getElementById('homeCheckinBtn'), btn2=document.getElementById('checkinBtn');
  if(btn1){ btn1.disabled=true; btn1.textContent='...'; }
  if(btn2){ btn2.disabled=true; btn2.textContent='Checking in...'; }
  try{
    const d=await api('/checkin',{userId:_user.uid});
    if(d.status==='success'){
      // Lock buttons immediately — onSnapshot will confirm final state
      if(btn1){ btn1.disabled=true; btn1.textContent='Done ✓'; }
      if(btn2){ btn2.disabled=true; btn2.textContent='✅ Come back tomorrow'; }
      const ckSub=document.querySelector('.checkin-strip-sub');
      if(ckSub) ckSub.textContent='✓ Checked in today';
      showToast(`${ugx(d.bonus)} bonus added to Deposits Wallet! 🔥 Day ${d.streak}`,'success',4000);
      loadUserData().then(()=>_loadCheckin());
    } else if(d.alreadyDone){
      if(btn1){ btn1.disabled=true; btn1.textContent='Done ✓'; }
      if(btn2){ btn2.disabled=true; btn2.textContent='✅ Come back tomorrow'; }
      showToast('Already checked in today!','info');
    } else {
      // Real error — re-enable so user can retry
      if(btn1){ btn1.disabled=false; btn1.textContent='Check in'; }
      if(btn2){ btn2.disabled=false; btn2.textContent='✅ Check In Today'; }
      showToast(d.message||'Check-in failed. Try again.','error');
    }
  }catch(e){
    if(btn1){ btn1.disabled=false; btn1.textContent='Check in'; }
    if(btn2){ btn2.disabled=false; btn2.textContent='✅ Check In Today'; }
    showToast('Connection error. Try again.','error');
  }
};

window._loadCheckin = function(){
  if(!_userData) return;
  const eatNowMs = Date.now() + 3 * 60 * 60 * 1000;
  const todayKey = new Date(eatNowMs).toISOString().slice(0,10);
  const done=_userData.lastCheckinDate===todayKey;
  const ckBtn=document.getElementById('checkinBtn');
  if(ckBtn){ ckBtn.disabled=done; ckBtn.textContent=done?'✅ Come back tomorrow':'✅ Check In Today'; }
  document.getElementById('ckStreak').textContent=_userData.checkinStreak||0;
  document.getElementById('ckEarned').textContent=ugx(_userData.checkinEarned||0);
  const el2=document.getElementById('checkinFullBonusAmt');
  if(el2) el2.textContent=ugx(_userData.checkinEarned||0);
  const el3=document.getElementById('checkinDailyRate');
  if(el3) el3.textContent='UGX '+Number(_checkinBonus).toLocaleString()+' per day';
};

// ══════════════════════════════════════════════════
// REFERRALS
// ══════════════════════════════════════════════════
async function loadRefStats(){
  if(!_user) return;
  try{
    // L1: direct referrals
    const l1Snap=await getDocs(query(collection(db,'referrals'),where('referrerId','==',_user.uid),limit(50)));
    const l1Active=l1Snap.docs.filter(d=>d.data().paid).length;
    const l1Total=l1Snap.size;
    document.getElementById('l1Count').textContent=l1Total;

    // Total earned from referrals
    const refEarned=_userData?.refEarned||0;
    document.getElementById('refTotalEarned').textContent=ugx(refEarned);

    // Render referral list
    const refList=document.getElementById('refList');
    if(l1Snap.empty){ refList.innerHTML='<div class="empty-state"><div class="empty-title">No referrals yet</div><div class="empty-sub">Share your code to earn UGX 20,000 per direct referral</div></div>'; }
    else{
      refList.innerHTML='';
      l1Snap.forEach(d=>{
        const r=d.data();
        refList.innerHTML+=`<div class="ref-row">
          <div class="ref-avatar">👤</div>
          <div class="ref-info">
            <div class="ref-name">${r.referredName||'Member'}</div>
            <div class="ref-phone">${r.referredEmail?.replace('@xengine.app','')||''}</div>
          </div>
          <span class="ref-status-badge" style="${r.paid?'':'background:rgba(240,185,11,.12);color:#F8D12F'}">${r.paid?'Active':'Inactive'}</span>
        </div>`;
      });
    }

    // L2/L3 — count by looking at users who referred our referrals
    // Simplified: show from userData if tracked
    document.getElementById('l2Count').textContent = _userData?.l2ReferralCount||0;
    document.getElementById('l3Count').textContent = _userData?.l3ReferralCount||0;
  }catch(e){ console.error('Ref stats error:',e); }
}

window._copyReferral = function(){
  const code=_userData?.referralCode||genRefCode(_user?.uid||'');
  navigator.clipboard.writeText(code).then(()=>showToast('Referral code copied! 🔗','success')).catch(()=>showToast(code,'info',5000));
};
window._copyRefLink = function(){
  const code=_userData?.referralCode||genRefCode(_user?.uid||'');
  const link=`${APP_URL}?ref=${code}`;
  navigator.clipboard.writeText(link).then(()=>showToast('Referral link copied!','success')).catch(()=>showToast(link,'info',6000));
};

// ══════════════════════════════════════════════════
// WALLET / TRANSACTIONS
// ══════════════════════════════════════════════════
async function loadTransactions(){
  const el=document.getElementById('txList');
  el.innerHTML='<div class="page-loader"><div class="spinner"></div></div>';
  if(!_user) return;
  const snap=await getDocs(query(collection(db,'transactions'),where('userId','==',_user.uid),limit(50)));
  const txDocs=snap.docs.sort((a,b)=>{const ta=a.data().createdAt?.seconds||0;const tb=b.data().createdAt?.seconds||0;return tb-ta;});
  if(snap.empty){ el.innerHTML='<div class="empty-state"><div class="empty-icon">📋</div><div class="empty-title">No records yet</div></div>'; return; }
  _allTxs=[];
  (txDocs||snap.docs).forEach(d=>_allTxs.push({id:d.id,...d.data()}));
  renderTxList();
}

function renderTxList(){
  const el=document.getElementById('txList');
  const filtered=_txFilter==='all'?_allTxs:_allTxs.filter(t=>t.type===_txFilter||(t.type||'').includes(_txFilter));
  if(!filtered.length){ el.innerHTML='<div class="empty-state"><div class="empty-title">No records in this category</div></div>'; return; }
  const icons={deposit:'💰 dep',withdrawal:'💸 wit',investment:'📈 inv',investment_claim:'📈 inv',checkin:'📅 chk',referral_l1:'👥 ref',referral_l2:'👥 ref',referral_l3:'👥 ref',referral:'👥 ref',referral_ongoing:'👥 ref',registration_bonus:'🎁 dep',admin_deposit:'💰 dep',daily_cashback:'📈 inv',daily_cashback_locked:'🔒 inv'};
  const _PLUS_TYPES=['deposit','investment','investment_claim','checkin','referral_l1','referral_l2','referral_l3','referral','referral_ongoing','registration_bonus','admin_deposit','daily_cashback','daily_cashback_locked'];
  el.innerHTML=filtered.map(t=>{
    const ico=icons[t.type]||'📋 dep'; const [em,cls]=ico.split(' ');
    const rawAmt=t.amount||0;
    const isPlus=_PLUS_TYPES.includes(t.type) && rawAmt>=0;
    const isWit=t.type==='withdrawal';
    const grossAmt=Math.abs(rawAmt);
    const netAmt=isWit && t.netAmount ? t.netAmount : null;
    const feeAmt=isWit && t.fee ? t.fee : null;
    const dispAmt=netAmt!==null ? netAmt : grossAmt;
    const feeNote=feeAmt ? `<div style="font-size:10px;color:#ef4444;margin-top:1px">Fee: -${ugx(feeAmt)} · Gross: ${ugx(grossAmt)}</div>` : '';
    const safeId=t.id||'';
    return `<div class="tx-item" style="cursor:pointer" onclick="window._showTxDetail('${safeId}')">
      <div class="tx-icon ${cls}">${em}</div>
      <div class="tx-info">
        <div class="tx-desc">${t.description||t.type}</div>
        <div class="tx-date">${t.date||''} ${t.time||''}</div>
        ${feeNote}
      </div>
      <div style="display:flex;align-items:center;gap:6px">
        <div class="tx-amount ${isPlus?'plus':'minus'}">${isPlus?'+':'-'}${ugx(dispAmt)}</div>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.3)" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
      </div>
    </div>`;
  }).join('');
}

window._filterTx = function(type,btn){
  _txFilter=type;
  document.querySelectorAll('.btn-filter').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  renderTxList();
};

window._showTxDetail = function(id){
  const t=(_allTxs||[]).find(x=>x.id===id); if(!t) return;
  const rawAmt=t.amount||0;
  const isWit=t.type==='withdrawal';
  const _PLUS=['deposit','investment','investment_claim','checkin','referral_l1','referral_l2','referral_l3','referral','referral_ongoing','registration_bonus','admin_deposit','daily_cashback','daily_cashback_locked'];
  const isPlus=_PLUS.includes(t.type)&&rawAmt>=0;
  const grossAmt=Math.abs(rawAmt);
  const rows=[
    ['Type', (t.type||'').replace(/_/g,' ')],
    ['Date', `${t.date||''} ${t.time||''}`.trim()||'—'],
    ['Amount', `${isPlus?'+':'-'}${ugx(grossAmt)}`],
    isWit&&t.fee ? ['Fee', `-${ugx(t.fee)}`] : null,
    isWit&&t.netAmount ? ['You received', `+${ugx(t.netAmount)}`] : null,
    t.reference ? ['Reference', t.reference] : null,
    t.phone ? ['Phone', t.phone] : null,
    t.withdrawalPhone ? ['Sent to', t.withdrawalPhone] : null,
    t.status ? ['Status', t.status] : null,
    t.description ? ['Description', t.description] : null,
  ].filter(Boolean);
  const html=`<div id="txDetailOverlay" onclick="if(event.target===this)this.remove()" style="position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:9999;display:flex;align-items:flex-end;justify-content:center;padding:16px">
    <div style="background:#1C2127;border-radius:20px 20px 16px 16px;width:100%;max-width:480px;padding:20px 18px 28px;max-height:80vh;overflow-y:auto">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px">
        <div style="font-size:15px;font-weight:800;color:#fff">Transaction Details</div>
        <div onclick="document.getElementById('txDetailOverlay').remove()" style="cursor:pointer;color:var(--muted);font-size:22px;line-height:1">×</div>
      </div>
      <table style="width:100%;border-collapse:collapse">
        ${rows.map(([k,v])=>`<tr>
          <td style="padding:9px 0;color:var(--muted);font-size:13px;width:40%;vertical-align:top">${k}</td>
          <td style="padding:9px 0;color:#fff;font-size:13px;font-weight:600;word-break:break-all">${v}</td>
        </tr>`).join('<tr><td colspan="2" style="border-top:1px solid rgba(255,255,255,.05)"></td></tr>')}
      </table>
    </div>
  </div>`;
  const old=document.getElementById('txDetailOverlay'); if(old) old.remove();
  document.body.insertAdjacentHTML('beforeend',html);
};

// ══════════════════════════════════════════════════
// NOTIFICATIONS
// ══════════════════════════════════════════════════
async function loadUnreadCount(){
  if(!_user) return;
  try{
    const snap=await getDocs(query(collection(db,'notifications'),where('userId','==',_user.uid),limit(30)));
    const unread=snap.docs.filter(d=>!(d.data().readBy||[]).includes(_user.uid)).length;
    const badge=document.getElementById('bellBadge');
    badge.textContent=unread>9?'9+':unread;
    badge.style.display=unread?'flex':'none';
  }catch(e){}
}

window._openNotifs = async function(){
  openModal('notifsModal');
  const el=document.getElementById('notifsList');
  el.innerHTML='<div class="page-loader"><div class="spinner"></div></div>';
  if(!_user) return;
  const snap=await getDocs(query(collection(db,'notifications'),where('userId','==',_user.uid),limit(30)));
  const sortedDocs = snap.docs.sort((a,b)=>{const ta=a.data().createdAt?.seconds||0;const tb=b.data().createdAt?.seconds||0;return tb-ta;});
  if(snap.empty){ el.innerHTML='<div class="empty-state"><div class="empty-icon">🔔</div><div class="empty-title">No notifications</div></div>'; return; }
  el.innerHTML='';
  for(const d of sortedDocs){
    const n=d.data(); const unread=!(n.readBy||[]).includes(_user.uid);
    const t=n.createdAt?.toDate?.();
    const ts=t?t.toLocaleDateString('en-UG',{day:'2-digit',month:'short'})+' '+t.toLocaleTimeString('en-UG',{hour:'2-digit',minute:'2-digit'}):'';
    const payload=JSON.stringify({title:n.title||'',msg:n.message||'',ts}).replace(/"/g,'&quot;');
    const item=document.createElement('div');
    item.className='notif-item'+(unread?' unread':'');
    item.innerHTML=`<div class="notif-title">${n.title||'Notification'}</div><div class="notif-msg">${(n.message||'').replace(/\n/g,' ')}</div><div class="notif-time">${ts}</div>`;
    item.onclick=()=>window._showNotifDetail({title:n.title||'Notification',msg:n.message||'',ts});
    el.appendChild(item);
    if(unread) updateDoc(doc(db,'notifications',d.id),{readBy:[...(n.readBy||[]),_user.uid]}).catch(()=>{});
  }
  document.getElementById('bellBadge').style.display='none';
};

window._showNotifDetail = function({title,msg,ts}){
  document.getElementById('notifDetailTitle').textContent=title;
  document.getElementById('notifDetailBody').textContent=msg;
  document.getElementById('notifDetailTime').textContent=ts;
  openModal('notifDetailModal');
};

// ══════════════════════════════════════════════════
// SETTINGS
// ══════════════════════════════════════════════════
let _checkinBonus = 1000; // default, updated from settings
async function loadSettings(){
  try{
    const mainSnap=await getDoc(doc(db,'settings','main'));
    if(mainSnap.exists()){
      const s=mainSnap.data();
      if(s.checkinBonus){
        _checkinBonus = s.checkinBonus;
        const el=document.getElementById('checkinBonusAmt');
        if(el) el.textContent=ugx(s.checkinBonus)+' bonus today';
        // checkinFullBonusAmt shows total earned — managed by _loadCheckin(), not daily rate
        const el3=document.getElementById('checkinDailyRate');
        if(el3) el3.textContent='UGX '+Number(s.checkinBonus).toLocaleString()+' per day';
      }
      if(s.telegramLink) _helpLink=s.telegramLink;
      if(s.appDownloadLink) _appDownloadLink=s.appDownloadLink;
      // Update withdrawal fee display dynamically
      if(s.withdrawalFee){
        const feeEl=document.getElementById('witFeeDisplay');
        if(feeEl) feeEl.textContent=s.withdrawalFee+'%';
      }
      // Referral rewards display
      if(s.refL1){ const e=document.getElementById('refL1Display'); if(e) e.textContent=ugx(s.refL1); }
      if(s.refL2){ const e=document.getElementById('refL2Display'); if(e) e.textContent=ugx(s.refL2); }
      if(s.refL3){ const e=document.getElementById('refL3Display'); if(e) e.textContent=ugx(s.refL3); }
    }
    // Home banner (from ads collection)
    const adsSnap=await getDocs(query(collection(db,'ads'),orderBy('createdAt','desc'),limit(3)));
    if(!adsSnap.empty){
      const activeDocs=adsSnap.docs.filter(d=>d.data().active!==false);
      if(activeDocs.length){
        const ad=activeDocs[0].data();
        const bannerImg=document.getElementById('bannerImg');
        const bannerDefault=document.getElementById('bannerDefault');
        if(bannerImg && ad.url){
          bannerImg.src=ad.url;
          bannerImg.style.display='block';
          bannerImg.onload=()=>{ if(bannerDefault) bannerDefault.style.display='none'; };
          bannerImg.onerror=()=>{ bannerImg.style.display='none'; };
        }
      }
    }
    // App settings
    const appSnap=await getDoc(doc(db,'settings','app'));
    if(appSnap.exists()){
      const a=appSnap.data();
      if(a.telegramLink) _helpLink=a.telegramLink;
      if(a.appDownloadLink) _appDownloadLink=a.appDownloadLink;
      // Auth screen banners from admin
      if(a.authBannerUrl){
        const loginWrap=document.getElementById('loginBannerWrap');
        const regWrap=document.getElementById('regBannerWrap');
        const imgHtml=`<img src="${a.authBannerUrl}" style="width:100%;height:100%;object-fit:cover;position:absolute;inset:0" onerror="this.style.display='none'">`;
        if(loginWrap) loginWrap.innerHTML+=imgHtml;
        if(regWrap) regWrap.innerHTML+=imgHtml;
      }
    }
    const aboutSnap=await getDoc(doc(db,'settings','about'));
    if(aboutSnap.exists()) document.getElementById('aboutContent').textContent=aboutSnap.data().content||'X-Engine investment platform.';
    const termsSnap=await getDoc(doc(db,'settings','terms'));
    if(termsSnap.exists()) document.getElementById('termsContent').textContent=termsSnap.data().content||'Terms and conditions apply.';
  }catch(e){ console.error('loadSettings error:',e); }
}

window._openHelp = function(){
  if(_helpLink) window.open(_helpLink,'_blank');
  else showToast('Our Telegram community is coming soon! 🚀 Stay tuned.','info',4000);
};
window._showAbout = function(){ openModal('aboutModal'); };
window._showTerms = function(){ openModal('termsModal'); };
window._openDownloadApp = function(){
  if(window._triggerPWAInstall && window._triggerPWAInstall()) return;
  if(_appDownloadLink) window.open(_appDownloadLink,'_blank');
  else showToast('Tap the install banner at the top to download the app','info');
};

// ══════════════════════════════════════════════════
// ANNOUNCEMENT DIALOG
// ══════════════════════════════════════════════════
async function loadAndShowDialog(){
  try{
    const snap=await getDoc(doc(db,'settings','broadcast'));
    if(!snap.exists()) return;
    const d=snap.data();
    if(!d.active) return;
    // Always show: no once-per-interval gating — dialog appears on every
    // visit and every time the user taps the Home navigation icon.
    document.getElementById('dialogTitle').textContent=d.title||'Announcement';
    document.getElementById('dialogBody').textContent=d.body||'';
    if(d.photoUrl){ document.getElementById('dialogHeaderImg').src=d.photoUrl; document.getElementById('dialogHeaderImg').style.display='block'; }
    if(d.actionLabel && d.actionUrl){
      const al=document.getElementById('dialogActionLink');
      al.textContent=d.actionLabel; al.href=d.actionUrl; al.style.display='block';
    }
    const btn=document.querySelector('.btn-dialog-confirm');
    if(btn) btn.textContent=d.dismissLabel||'Confirm';
    document.getElementById('announcementDialog').classList.add('open');
  }catch(e){}
}

window.dismissDialog = function(){
  document.getElementById('announcementDialog').classList.remove('open');
};

// ══════════════════════════════════════════════════
// WITHDRAWAL SUCCESS LISTENER
// ══════════════════════════════════════════════════
function startWitListener(uid){
  if(_witListenerUnsub){ _witListenerUnsub(); _witListenerUnsub=null; }
  const q=query(collection(db,'withdrawals'),where('userId','==',uid),where('status','==','processed'));
  const shown=new Set(JSON.parse(sessionStorage.getItem('_xe_ws_shown')||'[]'));
  _witListenerUnsub=onSnapshot(q,snap=>{
    snap.docChanges().forEach(ch=>{
      if(ch.type!=='added'&&ch.type!=='modified') return;
      const id=ch.doc.id; const wit=ch.doc.data();
      const pAt=wit.processedAt?.toDate?.();
      const fresh=pAt&&pAt.getTime()>Date.now()-60*60*1000;
      if(!shown.has(id)&&fresh){
        shown.add(id);
        sessionStorage.setItem('_xe_ws_shown',JSON.stringify([...shown]));
        showWitSuccess(wit);
      }
    });
  });
}

function showWitSuccess(wit){
  const pAt=wit.processedAt?.seconds?new Date(wit.processedAt.seconds*1000):null;
  document.getElementById('witSuccessAmt').textContent=ugx(wit.netAmount);
  document.getElementById('witSuccessDetails').innerHTML=`
    <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px"><span style="color:var(--muted)">👤 Name</span><span style="font-weight:600">${wit.recipientName||wit.userName||'—'}</span></div>
    <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px"><span style="color:var(--muted)">📱 Phone</span><span style="font-weight:600">${wit.withdrawalPhone||'—'}</span></div>
    <div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px"><span style="color:var(--muted)">📅 Date</span><span style="font-weight:600">${pAt?pAt.toLocaleDateString('en-UG'):wit.date||'—'}</span></div>
  `;
  openModal('witSuccessModal');
}

// ══════════════════════════════════════════════════
// PRE-FILL REF CODE FROM URL
// ══════════════════════════════════════════════════
(function(){
  let ref=null;
  try{
    const params=new URLSearchParams(window.location.search);
    ref=params.get('ref');
    if(ref){
      // Persist so the code survives PWA install / tab close / revisits
      try{ localStorage.setItem('pendingRef', ref.trim().toUpperCase()); }catch(e){}
      window._openRegisterFromRef = true; // tells the auth handler to show register
    }else{
      try{ ref=localStorage.getItem('pendingRef'); }catch(e){}
    }
    if(ref){
      const el=document.getElementById('regRef');
      if(el) el.value=ref.trim().toUpperCase();
      // Only auto-open register on a fresh ?ref= visit, not every reload
      if(window._openRegisterFromRef){
        const lp=document.getElementById('loginPage'); if(lp) lp.style.display='none';
        const rp=document.getElementById('registerPage'); if(rp) rp.style.display='flex';
      }
    }
  }catch(e){ console.error('ref prefill error:', e); }
})();

// Load public settings on page load (for auth banners, before login)
(async function loadPublicSettings(){
  try{
    const {initializeApp:ia2,getApps:ga2}=await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
    const {getFirestore:gf2,doc:d2,getDoc:gd2}=await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    const _app2=ga2().length?ga2()[0]:ia2(FIREBASE_CONFIG);
    const _db2=gf2(_app2);
    const appSnap=await gd2(d2(_db2,'settings','app'));
    if(appSnap.exists()&&appSnap.data().authBannerUrl){
      const url=appSnap.data().authBannerUrl;
      const loginWrap=document.getElementById('loginBannerWrap');
      const regWrap=document.getElementById('regBannerWrap');
      const makeImg=()=>{ const i=document.createElement('img'); i.src=url; i.style.cssText='width:100%;height:100%;object-fit:cover;position:absolute;inset:0;border-radius:16px'; i.onerror=()=>i.style.display='none'; return i; };
      if(loginWrap){ loginWrap.style.position='relative'; loginWrap.appendChild(makeImg()); }
      if(regWrap){ regWrap.style.position='relative'; regWrap.appendChild(makeImg()); }
    }
  }catch(e){}
})();


// ══════════════════════════════════════════════════
// LIVE TRANSACTION DIALOG
// ══════════════════════════════════════════════════
let _txPollTimer = null;

function openTxDialog(type, amount, phone){
  clearInterval(_txPollTimer);
  const el = id => document.getElementById(id);
  el('txdIcon').className='txd-icon pending'; el('txdIcon').textContent='⏳';
  el('txdTitle').textContent = type==='deposit' ? '📱 Check Your Phone' : '💸 Processing Withdrawal';
  el('txdSub').textContent = type==='deposit'
    ? 'A USSD prompt has been sent to your phone.\nApprove it to complete the deposit.'
    : 'Your withdrawal is being processed via mobile money. This usually takes under 60 seconds.';
  el('txdAmount').textContent = amount ? ugx(amount) : '';
  el('txdBar').style.width='15%';
  el('txdBtn').style.display='none';
  el('txdCancelBtn').style.display='block';
  el('txdCancelBtn').textContent = 'Cancel Polling';
  el('txdCancelBtn').onclick = () => cancelTxPolling();
  el('txdRows').innerHTML = `
    <div class="txd-row"><span class="txd-label">Phone</span><span class="txd-val">${phone||'—'}</span></div>
    <div class="txd-row"><span class="txd-label">Status</span><span class="txd-val" id="txdStatusText">Waiting for approval...</span></div>
  `;
  document.getElementById('txDialog').classList.add('open');
}

function closeTxDialog(){
  clearInterval(_txPollTimer);
  document.getElementById('txDialog').classList.remove('open');
}

function cancelTxPolling(){
  clearInterval(_txPollTimer);
  _txPollTimer = null;
  const el = id => document.getElementById(id);
  el('txdIcon').className = 'txd-icon';
  el('txdIcon').style.cssText = 'background:#1E2026;font-size:28px';
  el('txdIcon').textContent = '⏸';
  el('txdTitle').textContent = 'Polling Stopped';
  el('txdSub').textContent = 'Auto-checking has been cancelled. Your payment may still complete in the background — check your Deposits Wallet balance in a few minutes.';
  el('txdBar').style.width = '0%';
  el('txdBar').parentElement.style.background = 'rgba(255,255,255,0.04)';
  el('txdCancelBtn').textContent = 'Close';
  el('txdCancelBtn').onclick = () => closeTxDialog();
}
window.cancelTxPolling = cancelTxPolling;
window.closeTxDialog = closeTxDialog;

function txDialogSuccess(title, sub, amount, rows){
  const el = id => document.getElementById(id);
  el('txdIcon').className='txd-icon success'; el('txdIcon').textContent='✅';
  el('txdTitle').textContent = title;
  el('txdSub').textContent = sub;
  if(amount) el('txdAmount').textContent = ugx(amount);
  el('txdBar').style.width='100%';
  el('txdBar').parentElement.style.background='rgba(3,166,109,.15)';
  if(rows) el('txdRows').innerHTML = rows.map(r=>`<div class="txd-row"><span class="txd-label">${r[0]}</span><span class="txd-val" style="color:${r[2]||'var(--text)'}">${r[1]}</span></div>`).join('');
  el('txdBtn').style.display='block';
  el('txdBtn').onclick = () => closeTxDialog();
  el('txdCancelBtn').style.display='none';
}

function txDialogFailed(title, sub){
  const el = id => document.getElementById(id);
  el('txdIcon').className='txd-icon failed'; el('txdIcon').textContent='❌';
  el('txdTitle').textContent = title;
  el('txdSub').textContent = sub;
  el('txdBar').style.width='100%';
  el('txdBar').parentElement.style.background='#1A1200';
  el('txdBtn').style.display='block'; el('txdBtn').textContent='Try Again';
  el('txdBtn').onclick=()=>{
    // Reset deposit button so user can try again
    const depBtn=document.getElementById('depBtn');
    if(depBtn){depBtn.disabled=false;depBtn.textContent='💰 Pay Now';}
    const depStatus=document.getElementById('depStatus');
    if(depStatus){depStatus.style.display='none';depStatus.textContent='';}
    closeTxDialog();
  };
  el('txdCancelBtn').style.display='none';
}

function txDialogProgress(pct, statusText){
  document.getElementById('txdBar').style.width = pct+'%';
  const st = document.getElementById('txdStatusText');
  if(st) st.textContent = statusText;
}

// ── Deposit polling with live dialog ──
function pollDepositLive(ref, amount, phone){
  let tries=0;
  const steps=['Waiting for approval...','USSD sent — please approve...','Verifying payment...','Confirming with network...','Almost done...'];
  _txPollTimer = setInterval(async()=>{
    tries++;
    txDialogProgress(Math.min(15+tries*3, 85), steps[Math.min(tries-1, steps.length-1)]);
    if(tries>45){
      clearInterval(_txPollTimer);
      txDialogFailed('Taking Too Long','No response from network. Check your Deposits Wallet — if money was deducted, contact support.');
      return;
    }
    try{
      const r=await fetch(`${SERVER}/check/${ref}`);
      const d=await r.json();
      if(d.status==='success'){
        clearInterval(_txPollTimer);
        txDialogSuccess(
          'Deposit Successful! 🎉',
          'Your Deposits Wallet has been credited.',
          d.amountCredited||amount,
          [['Reference', ref.slice(0,8)+'...'],['Credited to','Deposits Wallet','var(--green)'],['Time',new Date().toLocaleTimeString('en-UG')]]
        );
        loadUserData();
      } else if(d.status==='failed'){
        clearInterval(_txPollTimer);
        txDialogFailed('Payment Failed ❌','No money was deducted. Please try again or use a different number.');
      }
    }catch(e){ console.error('poll error:', e); }
  },2000);
}

// ── Withdrawal polling with live dialog ──
function pollWithdrawalLive(witId, netAmount, phone){
  let tries=0;
  const steps=['Verifying PIN...','Contacting mobile money...','Sending funds...','Waiting for network confirmation...','Almost done...'];
  _txPollTimer = setInterval(async()=>{
    tries++;
    txDialogProgress(Math.min(20+tries*8, 88), steps[Math.min(tries-1, steps.length-1)]);
    if(tries>30){
      clearInterval(_txPollTimer);
      document.getElementById('txdStatusText') && (document.getElementById('txdStatusText').textContent='Processing via network...');
      txDialogSuccess(
        'Withdrawal Submitted ✓',
        'Your withdrawal is being processed. Funds arrive within a few minutes.',
        netAmount,
        [['Phone',phone],['Status','Processing 🔄','var(--primary)'],['Note','You will be notified on arrival']]
      );
      return;
    }
    try{
      const r=await fetch(`${SERVER}/withdraw/status/${witId}`);
      const d=await r.json();
      const ws = d.witStatus || d.data?.status || '';
      if(ws==='processed'){
        clearInterval(_txPollTimer);
        txDialogSuccess(
          'Withdrawal Successful!',
          'Money sent to your account',
          netAmount,
          [['Sent to',phone],['Net amount',ugx(netAmount),'var(--green)'],['Status','Completed ✅','var(--green)']]
        );
        loadUserData();
      } else if(ws==='failed'||ws==='rejected'){
        clearInterval(_txPollTimer);
        txDialogFailed('Withdrawal Failed ❌','Your balance has been refunded. Please try again.');
        loadUserData();
      }
    }catch(e){ console.error('poll error:', e); }
  },2000);
}

// ── Change Password — show temp password if admin set one, else request reset ──
window.openChangePasswordPage = function(){
  const tmpPass = _userData?.tempPassword || '';
  const overlay = document.createElement('div');
  overlay.style.cssText='position:fixed;inset:0;z-index:800;background:rgba(0,0,0,.6);display:flex;align-items:flex-end;justify-content:center';
  const tmpBlock = tmpPass ? `
    <div style="background:rgba(240,185,11,.08);border:1.5px solid rgba(240,185,11,.35);border-radius:14px;padding:14px 16px;margin-bottom:14px">
      <div style="font-size:11px;font-weight:700;color:#F0B90B;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">🔑 Your Temporary Password</div>
      <div style="font-size:22px;font-weight:900;color:#fff;letter-spacing:2px;text-align:center;background:#0B0E11;border-radius:10px;padding:12px;margin-bottom:10px;user-select:all">${tmpPass}</div>
      <div style="font-size:12px;color:var(--muted);text-align:center;margin-bottom:10px">Use this to log in. Tap below once you've noted it.</div>
      <button id="_clearTmpPassBtn" style="width:100%;padding:11px;background:rgba(3,166,109,.12);border:1.5px solid rgba(3,166,109,.3);border-radius:10px;color:#03A66D;font-size:13px;font-weight:800;cursor:pointer;font-family:var(--fam)">✅ I've Noted My Password — Clear It</button>
    </div>` : '';
  overlay.innerHTML=`
    <div style="width:100%;max-width:480px;background:#1a1a1a;border-radius:24px 24px 0 0;padding:28px 20px 40px">
      <div style="width:36px;height:4px;background:rgba(255,255,255,.15);border-radius:2px;margin:0 auto 20px"></div>
      <div style="text-align:center;margin-bottom:18px">
        <div style="width:56px;height:56px;background:rgba(239,68,68,.12);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 12px">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        </div>
        <div style="font-size:17px;font-weight:800;color:#fff;margin-bottom:6px">Password</div>
        ${!tmpPass?`<div style="font-size:13px;color:var(--muted);line-height:1.7">Request a reset from admin. They will set a new password and you'll see it here.</div>`:''}
      </div>
      ${tmpBlock}
      <button onclick="requestPasswordResetOTP()" style="width:100%;padding:15px;background:rgba(240,185,11,.12);border:1.5px solid rgba(240,185,11,.3);border-radius:14px;color:#F0B90B;font-size:14px;font-weight:800;cursor:pointer;font-family:var(--fam);margin-bottom:10px">
        📲 Reset Password via SMS OTP
      </button>
      <button onclick="openHelp()" style="width:100%;padding:15px;background:rgba(240,185,11,.12);border:1.5px solid rgba(240,185,11,.3);border-radius:14px;color:#F0B90B;font-size:14px;font-weight:800;cursor:pointer;font-family:var(--fam);margin-bottom:10px">
        💬 Contact Customer Service
      </button>
      <button onclick="this.closest('[style*=fixed]').remove()" style="width:100%;padding:13px;background:transparent;border:1px solid rgba(255,255,255,.1);border-radius:14px;color:var(--muted);font-size:14px;cursor:pointer;font-family:var(--fam)">
        Close
      </button>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e=>{ if(e.target===overlay) overlay.remove(); });
  if(tmpPass){
    overlay.querySelector('#_clearTmpPassBtn')?.addEventListener('click', async ()=>{
      try{
        await updateDoc(doc(db,'users',_user.uid),{tempPassword:'',tempPasswordSetAt:null});
        if(_userData) _userData.tempPassword='';
      }catch(e){}
      overlay.remove();
      showToast('Password cleared from profile','success');
    });
  }
};

// ── Profile photo upload via Cloudinary ──
async function _uploadProfilePhoto(e) {
  const file = e.target.files && e.target.files[0];
  if (!file || !_user) return;
  const MAX_SIZE = 5 * 1024 * 1024;
  if (file.size > MAX_SIZE) { showToast('Photo too large (max 5MB)', 'error'); return; }
  showToast('Uploading photo…', 'info', 8000);
  try {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', CLOUDINARY_PRESET);
    formData.append('folder', 'profiles');
    const resp = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/image/upload`, { method: 'POST', body: formData });
    if (!resp.ok) throw new Error('Upload failed: ' + resp.status);
    const data = await resp.json();
    const url = data.secure_url;
    if (!url) throw new Error('No URL returned');
    await updateDoc(doc(db, 'users', _user.uid), { photoUrl: url });
    // Update avatar immediately
    const wrap = document.getElementById('profileAvatarWrap');
    if (wrap) { wrap.style.background='transparent'; let img=wrap.querySelector('img'); if(!img){img=document.createElement('img');img.style.cssText='width:100%;height:100%;object-fit:cover;border-radius:50%';wrap.innerHTML='';wrap.appendChild(img);} img.src=url; }
    showToast('Photo updated! ✅', 'success');
  } catch (err) {
    showToast('Upload failed: ' + (err.message || 'Unknown error'), 'error');
  }
}

console.log('✅ x-engine module loaded');
