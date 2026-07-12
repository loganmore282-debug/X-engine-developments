const express    = require('express');
const admin      = require('firebase-admin');
const cors       = require('cors');
const crypto     = require('crypto');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');
if (!globalThis.fetch) { globalThis.fetch = (...a) => import('node-fetch').then(m => m.default(...a)); }

// ── GLOBAL ERROR SAFETY NET ──
process.on('unhandledRejection', (reason) => console.error('⚠️ Unhandled rejection:', reason));
process.on('uncaughtException',  (err)    => { console.error('💥 Uncaught exception:', err); process.exit(1); });

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: false,
  hsts: { maxAge: 31536000, includeSubDomains: true },
  frameguard: { action: 'deny' },
  referrerPolicy: { policy: 'no-referrer' },
  noSniff: true,
  crossOriginResourcePolicy: { policy: 'same-site' }
}));
app.use(express.json({ limit: '64kb' }));
app.use(express.urlencoded({ extended: true, limit: '64kb' }));
app.use(cors({ origin: '*' }));

// ── NoSQL-INJECTION GUARD ──
// No legitimate Furagemz request uses keys starting with "$" or containing ".",
// so strip them from every incoming body before any handler reaches the database.
function stripMongoOperators(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 6) return;
  for (const key of Object.keys(obj)) {
    if (key.startsWith('$') || key.includes('.')) { delete obj[key]; continue; }
    const v = obj[key];
    if (v && typeof v === 'object') stripMongoOperators(v, depth + 1);
  }
}
app.use((req, _res, next) => { try { stripMongoOperators(req.body); } catch (_) {} next(); });

// Escape user-controlled text before it's ever echoed into HTML (admin panel).
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// ── RATE LIMITERS ──
// Ugandan carrier-NAT IPs put many real users behind one IP, so money/value
// endpoints key the limiter on the Firebase user (from the token), not the
// shared IP. Only unauthenticated login/register falls back to per-IP.
function rlKeyByUser(req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) {
    try {
      const p = JSON.parse(Buffer.from(auth.slice(7).split('.')[1], 'base64').toString('utf8'));
      const uid = p && (p.user_id || p.sub);
      if (uid) return 'u:' + uid;
    } catch (_) {}
  }
  return req.ip;
}
const authLimiter = rateLimit({ windowMs: 60 * 1000, max: 40, standardHeaders: true, legacyHeaders: false,
  message: { status: 'error', message: 'Too many attempts. Try again in a minute.' } });
const apiLimiter  = rateLimit({ windowMs: 60 * 1000, max: 60, keyGenerator: rlKeyByUser, standardHeaders: true, legacyHeaders: false,
  message: { status: 'error', message: 'Too many requests. Slow down.' } });
const adminLoginLimiter = rateLimit({ windowMs: 60 * 1000, max: 8, standardHeaders: true, legacyHeaders: false,
  message: { status: 'error', message: 'Too many attempts. Try again in a minute.' } });
const adminLimiter = rateLimit({ windowMs: 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false,
  message: { status: 'error', message: 'Too many requests. Slow down.' } });
app.use('/auth/', authLimiter);
app.use('/admin/check-key', adminLoginLimiter);
app.use('/admin/', adminLimiter);
// Money/value endpoints added in phase 2 will be registered here as they land:
['/checkin', '/withdraw/request', '/invest/create', '/invest/claim', '/deposit/marzpay']
  .forEach(p => app.use(p, apiLimiter));

// ── FIREBASE AUTH (Auth only — data lives in MongoDB) ──
let serviceAccount;
try {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
  if (!serviceAccount.project_id) throw new Error('Missing project_id');
} catch (e) {
  console.error('❌ FIREBASE_SERVICE_ACCOUNT invalid:', e.message);
  process.exit(1);
}
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

// ── MONGODB ──
const { connectMongo, db, FieldValue, pingDb } = require('./db');

// ── CONFIG (owner-set, locked in) ──
const ADMIN_KEY        = process.env.ADMIN_KEY        || '';
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY || '';
if (!FIREBASE_API_KEY) { console.error('❌ FIREBASE_API_KEY env var is required'); process.exit(1); }
const RAILWAY_URL  = (() => {
  let u = (process.env.RAILWAY_URL || '').trim().replace(/\/$/, '');
  if (u && !u.startsWith('http')) u = 'https://' + u;
  return u;
})();

const MARZPAY_BASE = 'https://wallet.wearemarz.com/api/v1';
const MARZPAY_KEY  = process.env.MARZPAY_KEY || ''; // base64 encoded credentials

const MIN_DEPOSIT      = 30000;
const MIN_WITHDRAWAL   = 10000;   // no multiples restriction (owner's call, differs from Voltra)
const WELCOME_BONUS    = 5000;
const CHECKIN_BONUS    = 300;
const COMM_L1          = 0.18;
const COMM_L2          = 0.05;
const COMM_L3          = 0.02;
const LIQUIDITY_FEE    = 0.05;    // withdrawal fee

// Gem tier ladder — prices distinct from Voltra's energy-asset ladder.
// Return multiplier and cycle length finalized in phase 2 alongside invest endpoints.
const GEM_TIERS = [
  { key: 'quartz',   label: 'Quartz',   price:   25000 },
  { key: 'amethyst', label: 'Amethyst', price:   75000 },
  { key: 'topaz',    label: 'Topaz',    price:  200000 },
  { key: 'emerald',  label: 'Emerald',  price:  450000 },
  { key: 'sapphire', label: 'Sapphire', price:  800000 },
  { key: 'diamond',  label: 'Diamond',  price: 1200000 },
];

// ── SETTINGS CACHE — reads MongoDB `settings/main`, TTL 5 min ──
// Admin-editable rates live here; hardcoded constants above are fallbacks
// only, so a bad DB value never breaks the server.
let _settingsCache = null, _settingsCacheTs = 0;
async function getSettings() {
  if (Date.now() - _settingsCacheTs < 5 * 60 * 1000) return _settingsCache || {};
  try {
    const snap = await db.collection('settings').doc('main').get();
    _settingsCache = snap.exists ? snap.data() : {};
  } catch (_) { _settingsCache = _settingsCache || {}; }
  _settingsCacheTs = Date.now();
  return _settingsCache;
}

// ── HELPERS ──
function fmtUGX(n)   { return 'UGX ' + Number(n || 0).toLocaleString('en-UG'); }
function eatNow()    { return new Date(Date.now() + 3 * 3600000); }
function phoneToEmail(phone) { return String(phone).replace(/\D/g,'') + '@furagemz-app.com'; }
function nowStr() {
  const d = eatNow();
  const pad = n => String(n).padStart(2, '0');
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const days   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  return {
    date: days[d.getUTCDay()] + ', ' + d.getUTCDate() + ' ' + months[d.getUTCMonth()] + ' ' + d.getUTCFullYear(),
    time: pad(d.getUTCHours() % 12 || 12) + ':' + pad(d.getUTCMinutes()) + ' ' + (d.getUTCHours() >= 12 ? 'PM' : 'AM')
  };
}
function cleanPhone(raw) {
  const s = String(raw || '').replace(/\D/g, '');
  if (s.startsWith('256') && s.length >= 12) return '+' + s;
  if (s.startsWith('0')   && s.length === 10) return '+256' + s.slice(1);
  if (s.length === 9)  return '+256' + s;
  if (s.length === 12 && s.startsWith('256')) return '+' + s;
  return '+256' + s;
}
// Crypto-secure character picker (no I/L/O/0/1 ambiguity)
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function randChars(n) {
  return Array.from(crypto.randomBytes(n)).map(b => CODE_CHARS[b % CODE_CHARS.length]).join('');
}
async function generateUniqueRefCode() {
  for (let attempt = 0; attempt < 15; attempt++) {
    const code = randChars(7);
    const exists = await db.collection('users').where('referralCode', '==', code).limit(1).get();
    if (exists.empty) return code;
  }
  return randChars(9);
}

// Verify Firebase ID token — returns uid on success, null on failure.
// Every user-action endpoint calls this so the server never trusts a
// client-provided userId (money endpoints must never skip this).
async function verifyAuth(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  try {
    const decoded = await admin.auth().verifyIdToken(header.slice(7));
    return decoded.uid;
  } catch (_) { return null; }
}

// ── HEALTH ──
app.get('/health', async (_req, res) => {
  const dbOk = await pingDb().catch(() => false);
  res.status(dbOk ? 200 : 503).json({ status: dbOk ? 'ok' : 'db_unreachable' });
});

app.get('/settings/public', async (_req, res) => {
  const s = await getSettings();
  res.json({
    status: 'success',
    minDeposit: s.minDeposit ?? MIN_DEPOSIT,
    minWithdrawal: s.minWithdrawal ?? MIN_WITHDRAWAL,
    welcomeBonus: s.welcomeBonus ?? WELCOME_BONUS,
    checkinBonus: s.checkinBonus ?? CHECKIN_BONUS,
    liquidityFee: s.liquidityFee ?? LIQUIDITY_FEE,
    gemTiers: GEM_TIERS,
  });
});

// ═══════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════
app.post('/auth/register', async (req, res) => {
  const { phone, password } = req.body;
  if (!phone || !password) return res.status(400).json({ status: 'error', message: 'phone and password required' });
  const email = phoneToEmail(phone);
  try {
    const fbRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_API_KEY}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, returnSecureToken: true }) }
    );
    const fbData = await fbRes.json();
    if (fbData.error) {
      const code = fbData.error.message || 'UNKNOWN';
      const msg  = code === 'EMAIL_EXISTS' ? 'This phone number is already registered' : 'Registration failed: ' + code;
      return res.json({ status: 'error', message: msg });
    }
    const customToken = await admin.auth().createCustomToken(fbData.localId);
    return res.json({ status: 'success', customToken, uid: fbData.localId });
  } catch (e) {
    return res.status(500).json({ status: 'error', message: e.message });
  }
});

app.post('/auth/login', async (req, res) => {
  const { phone, password } = req.body;
  if (!phone || !password) return res.status(400).json({ status: 'error', message: 'phone and password required' });
  const email = phoneToEmail(phone);
  try {
    const fbRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, returnSecureToken: true }) }
    );
    const fbData = await fbRes.json();
    if (fbData.error) {
      const code = fbData.error.message || 'UNKNOWN';
      const msg  = (code === 'EMAIL_NOT_FOUND' || code === 'INVALID_PASSWORD' || code === 'INVALID_LOGIN_CREDENTIALS')
        ? 'Incorrect phone or password' : 'Login failed: ' + code;
      return res.json({ status: 'error', message: msg });
    }
    const customToken = await admin.auth().createCustomToken(fbData.localId);
    return res.json({ status: 'success', customToken, uid: fbData.localId });
  } catch (e) {
    return res.status(500).json({ status: 'error', message: e.message });
  }
});

// Called immediately after createUserWithEmailAndPassword on the client.
// Creates the user doc server-side so the client cannot set arbitrary
// fields (e.g. walletBalance).
app.post('/account/create-profile', async (req, res) => {
  const authedUid = await verifyAuth(req);
  const uid = authedUid || req.body.userId; // fallback only for the mid-registration edge
  if (!uid) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  if (authedUid && req.body.userId && authedUid !== req.body.userId)
    return res.status(403).json({ status: 'error', message: 'Forbidden' });
  const { name, phone } = req.body;
  if (!name || !phone) return res.status(400).json({ status: 'error', message: 'name and phone required' });
  const safeName = String(name).replace(/[<>]/g, '').trim().slice(0, 60);
  try {
    const ref  = db.collection('users').doc(uid);
    const snap = await ref.get();
    if (snap.exists) {
      const d = snap.data();
      if (!d.name || !d.phone) {
        await ref.update({ name: safeName, phone: cleanPhone(phone), email: phoneToEmail(phone) });
      }
      return res.json({ status: 'success', message: 'Profile ensured' });
    }
    await ref.set({
      name: safeName,
      phone: cleanPhone(phone),
      email: phoneToEmail(phone),
      walletBalance: 0, totalDeposited: 0, totalInvested: 0, totalWithdrawn: 0,
      totalEarned: 0, commissionEarned: 0, commissionL1Earned: 0,
      commissionL2Earned: 0, commissionL3Earned: 0,
      teamL1Count: 0, teamL2Count: 0, teamL3Count: 0,
      checkinEarned: 0, checkinStreak: 0, checkinDays: 0,
      withdrawalCount: 0, status: 'active',
      bankAccounts: [], createdAt: FieldValue.serverTimestamp()
    });
    return res.json({ status: 'success' });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});

// ═══════════════════════════════════════════
// REGISTRATION — welcome bonus + 3-level referral graph
// ═══════════════════════════════════════════
app.post('/register', async (req, res) => {
  const authedUid = await verifyAuth(req);
  const userId = authedUid || req.body.userId;
  if (!userId) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  if (authedUid && req.body.userId && authedUid !== req.body.userId)
    return res.status(403).json({ status: 'error', message: 'Forbidden' });
  const { referralCode } = req.body;
  try {
    const userRef  = db.collection('users').doc(userId);
    const userSnap = await userRef.get();
    if (!userSnap.exists) return res.status(404).json({ status: 'error', message: 'User not found' });
    if (userSnap.data().registrationDone) return res.json({ status: 'already_done', referralCode: userSnap.data().referralCode || null });

    let referrerId = null;
    if (referralCode) {
      const refSnap = await db.collection('users').where('referralCode', '==', referralCode.toUpperCase().trim()).limit(1).get();
      if (!refSnap.empty && refSnap.docs[0].id !== userId) referrerId = refSnap.docs[0].id;
    }

    const myRefCode = userSnap.data().referralCode || await generateUniqueRefCode();
    const s = await getSettings();
    const WELCOME = s.welcomeBonus ?? WELCOME_BONUS;
    const { date, time } = nowStr();
    const batch = db.batch();
    const update = { registrationDone: true, referralCode: myRefCode, walletBalance: FieldValue.increment(WELCOME) };

    batch.set(db.collection('transactions').doc(), {
      userId, type: 'admin_credit', description: 'Sign-up reward',
      amount: WELCOME, status: 'success', date, time, createdAt: FieldValue.serverTimestamp()
    });

    if (referrerId) {
      update.referredBy = referrerId;
      batch.update(db.collection('users').doc(referrerId), { teamL1Count: FieldValue.increment(1) });
      const l1Snap = await db.collection('users').doc(referrerId).get();
      const l2Id   = l1Snap.exists ? l1Snap.data().referredBy : null;
      if (l2Id && l2Id !== referrerId) {
        batch.update(db.collection('users').doc(l2Id), { teamL2Count: FieldValue.increment(1) });
        const l2Snap = await db.collection('users').doc(l2Id).get();
        const l3Id   = l2Snap.exists ? l2Snap.data().referredBy : null;
        if (l3Id && l3Id !== l2Id && l3Id !== referrerId)
          batch.update(db.collection('users').doc(l3Id), { teamL3Count: FieldValue.increment(1) });
      }
      batch.set(db.collection('referrals').doc(), {
        referrerId, referredUserId: userId, createdAt: FieldValue.serverTimestamp()
      });
    }

    batch.update(userRef, update);
    await batch.commit();
    return res.json({ status: 'success', referrerId, welcomeBonus: WELCOME, referralCode: myRefCode });
  } catch (e) {
    console.error('Register error:', e.message);
    return res.status(500).json({ status: 'error', message: e.message });
  }
});

// ═══════════════════════════════════════════
// ACCOUNT — read own profile
// ═══════════════════════════════════════════
app.get('/account', async (req, res) => {
  const uid = await verifyAuth(req);
  if (!uid) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const snap = await db.collection('users').doc(uid).get();
    if (!snap.exists) return res.status(404).json({ status: 'error', message: 'User not found' });
    return res.json({ status: 'success', account: snap.data() });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});

// ── ADMIN AUTH ──
app.post('/admin/check-key', (req, res) => {
  const { key } = req.body;
  if (!ADMIN_KEY) return res.status(500).json({ status: 'error', message: 'Admin key not configured' });
  if (key !== ADMIN_KEY) return res.status(401).json({ status: 'error', message: 'Invalid key' });
  return res.json({ status: 'success' });
});

// ── 404 + ERROR HANDLER ──
app.use((req, res) => res.status(404).json({ status: 'error', message: 'Not found' }));
app.use((err, _req, res, _next) => {
  console.error('Unhandled route error:', err && err.message);
  if (res.headersSent) return;
  res.status(500).json({ status: 'error', message: 'Something went wrong. Please try again.' });
});

// ── BOOT ──
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || '';

async function startServer() {
  if (!MONGODB_URI) { console.error('❌ MONGODB_URI env var not set'); process.exit(1); }

  // Start listening right away so the server is always reachable even if the
  // database is momentarily unreachable at boot — /health stays up for
  // diagnosis and the app self-heals the instant the DB comes back.
  app.listen(PORT, () => {
    console.log(`◆ Furagemz Investment Server on port ${PORT}`);
    console.log(`  URL: ${RAILWAY_URL || '(set RAILWAY_URL)'}`);
  });

  const tryConnect = async () => {
    try {
      await connectMongo(MONGODB_URI);
    } catch (e) {
      console.error('⏳ MongoDB not reachable yet — retrying in 5s:', e.message);
      setTimeout(tryConnect, 5000);
    }
  };
  tryConnect();
}
startServer().catch(e => { console.error('Startup error:', e.message); process.exit(1); });
