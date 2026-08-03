const express     = require('express');
const admin       = require('firebase-admin');
const cors        = require('cors');
const crypto      = require('crypto');
const helmet      = require('helmet');
const compression = require('compression');
const rateLimit   = require('express-rate-limit');
if (!globalThis.fetch) { globalThis.fetch = (...a) => import('node-fetch').then(m => m.default(...a)); }

// ── GLOBAL ERROR SAFETY NET ──
process.on('unhandledRejection', (reason) => console.error('Unhandled rejection:', reason));
process.on('uncaughtException',  (err)    => { console.error('Uncaught exception:', err); process.exit(1); });

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(compression());
app.use(helmet({
  contentSecurityPolicy: false,
  hsts: { maxAge: 31536000, includeSubDomains: true },
  frameguard: { action: 'deny' },
  referrerPolicy: { policy: 'no-referrer' },
  noSniff: true,
  crossOriginResourcePolicy: { policy: 'same-site' }
}));

// ── RATE LIMITERS ──
// Money/value endpoints are keyed by the Firebase user (from the token), not
// shared IP — Ugandan carrier-NAT puts many real users behind one IP.
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
const globalLimiter = rateLimit({ windowMs: 60 * 1000, max: 400, keyGenerator: rlKeyByUser,
  standardHeaders: true, legacyHeaders: false,
  message: { status: 'error', message: 'Too many requests. Slow down.' } });
app.use((req, res, next) => (req.path === '/health' ? next() : globalLimiter(req, res, next)));

const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, keyGenerator: rlKeyByUser,
  standardHeaders: true, legacyHeaders: false,
  message: { status: 'error', message: 'Too many requests. Slow down.' } });
const adminLoginLimiter = rateLimit({ windowMs: 60 * 1000, max: 8, standardHeaders: true, legacyHeaders: false,
  message: { status: 'error', message: 'Too many attempts. Try again in a minute.' } });
const adminLimiter = rateLimit({ windowMs: 60 * 1000, max: 200, standardHeaders: true, legacyHeaders: false,
  message: { status: 'error', message: 'Too many requests. Slow down.' } });
app.use('/admin/check-key', adminLoginLimiter);
app.use('/admin/', adminLimiter);
['/checkin', '/withdraw/request', '/invest/create', '/deposit/marzpay', '/redeem', '/bank/save']
  .forEach(p => app.use(p, apiLimiter));

// ── BODY PARSING ──
app.use(express.json({ limit: '64kb' }));
app.use(express.urlencoded({ extended: true, limit: '64kb' }));
app.use(cors({ origin: '*' }));

app.use((_req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
    'Cache-Control': 'no-store',
  });
  next();
});

// ── NoSQL-INJECTION GUARD ──
function stripMongoOperators(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 6) return;
  for (const key of Object.keys(obj)) {
    if (key.startsWith('$') || key.includes('.')) { delete obj[key]; continue; }
    const v = obj[key];
    if (v && typeof v === 'object') stripMongoOperators(v, depth + 1);
  }
}
app.use((req, _res, next) => { try { stripMongoOperators(req.body); } catch (_) {} next(); });

// ── MAINTENANCE GATE ──
const MAINTENANCE_BLOCK = ['/account', '/invest', '/deposit', '/withdraw', '/checkin', '/redeem', '/register', '/bank'];
const GUARD_EXEMPT = new Set(['/', '/health', '/deposit/callback', '/withdraw/callback']);
app.use(async (req, res, next) => {
  if (GUARD_EXEMPT.has(req.path)) return next();
  if (!MAINTENANCE_BLOCK.some(p => req.path.startsWith(p))) return next();
  try {
    const s = await getSettings();
    if (s && s.maintenanceMode) {
      return res.status(503).json({ status: 'error', code: 'MAINTENANCE',
        message: s.maintenanceMsg || 'ChocoMCC is under maintenance. Please check back shortly.' });
    }
  } catch (_) {}
  next();
});

// ── FIREBASE AUTH (Auth only — data lives in MongoDB) ──
let serviceAccount;
try {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
  if (!serviceAccount.project_id) throw new Error('Missing project_id');
} catch (e) {
  console.error('FIREBASE_SERVICE_ACCOUNT invalid:', e.message);
  process.exit(1);
}
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

// ── MONGODB ──
const { connectMongo, db, FieldValue, pingDb } = require('./db');

// ── CONFIG ──
const ADMIN_KEY   = process.env.ADMIN_KEY   || '';
const PUBLIC_URL  = (() => {
  let u = (process.env.RENDER_EXTERNAL_URL || process.env.PUBLIC_URL || '').trim().replace(/\/$/, '');
  if (u && !u.startsWith('http')) u = 'https://' + u;
  return u;
})();
const MARZPAY_BASE = 'https://wallet.wearemarz.com/api/v1';
const MARZPAY_KEY  = process.env.MARZPAY_KEY || ''; // base64 encoded credentials
const MARZ_TIMEOUT = 15000;

// Product/economics defaults — mirrors DEFAULT_SETTINGS in the client
// (choco-mcc/user/index.html). Admin panel overrides live in the
// `settings`/`products` collections; these are only the boot fallback.
const DEFAULT_SETTINGS = {
  withdrawFeePct: 19, minWithdraw: 10000, minDeposit: 5000,
  dailyCheckin: 250, commL1: 27, commL2: 2, commL3: 1,
  returnMultiple: 3, cycleDays: 10, maintenanceMode: false, maintenanceMsg: ''
};
const DEFAULT_PRODUCTS = [
  { key: 'hersheys',  name: "Hershey's Milk Chocolate", price: 15000   },
  { key: 'mars',      name: 'Mars',                     price: 30000  },
  { key: 'snickers',  name: 'Snickers',                 price: 50000  },
  { key: 'cadbury',   name: 'Cadbury Dairy Milk',        price: 80000  },
  { key: 'kitkat',    name: 'KitKat Chunky',             price: 120000 },
  { key: 'toblerone', name: 'Toblerone',                 price: 200000 },
  { key: 'rondnoir',  name: 'Ferrero Rondnoir',          price: 350000 },
  { key: 'rocher',    name: 'Ferrero Rocher',            price: 500000 },
  { key: 'raffaello', name: 'Raffaello',                 price: 750000 },
  { key: 'godiva',    name: 'Godiva Gold Box',           price: 1000000 }
];

let _settingsCache = null, _settingsCacheTs = 0;
async function getSettings() {
  if (Date.now() - _settingsCacheTs < 60 * 1000 && _settingsCache) return _settingsCache;
  try {
    const snap = await db.collection('settings').doc('main').get();
    _settingsCache = Object.assign({}, DEFAULT_SETTINGS, snap.exists ? snap.data() : {});
  } catch (_) { _settingsCache = _settingsCache || DEFAULT_SETTINGS; }
  _settingsCacheTs = Date.now();
  return _settingsCache;
}
let _productsCache = null, _productsCacheTs = 0;
async function getProducts() {
  if (Date.now() - _productsCacheTs < 60 * 1000 && _productsCache) return _productsCache;
  try {
    const snap = await db.collection('products').orderBy('order', 'asc').get();
    _productsCache = snap.empty ? DEFAULT_PRODUCTS.slice() : snap.docs.map(d => d.data());
  } catch (_) { _productsCache = _productsCache || DEFAULT_PRODUCTS.slice(); }
  _productsCacheTs = Date.now();
  return _productsCache;
}
async function getProductByKey(key) {
  const list = await getProducts();
  return list.find(p => p.key === key) || null;
}

// ── HELPERS ──
function fmtUGX(n) { return 'UGX ' + Number(n || 0).toLocaleString('en-UG'); }
function eatNow()  { return new Date(Date.now() + 3 * 3600000); } // Kampala (UTC+3)
function nowStr() {
  const d = eatNow();
  const pad = n => String(n).padStart(2, '0');
  return {
    date: pad(d.getUTCMonth() + 1) + '/' + pad(d.getUTCDate()) + '/' + d.getUTCFullYear(),
    time: pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds())
  };
}
function tsMillis(v) {
  if (!v) return 0;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (v instanceof Date) return v.getTime();
  return 0;
}
// Same synthetic-email scheme the client uses (phoneToEmail in index.html) —
// kept here only for endpoints that need to derive it server-side.
function phoneToEmail(phone) { return String(phone).replace(/\D/g, '').replace(/^0+/, '') + '@choco-mcc.com'; }
function cleanPhone(raw) {
  const s = String(raw || '').replace(/\D/g, '');
  if (s.startsWith('256') && s.length >= 12) return '+' + s;
  if (s.startsWith('0')   && s.length === 10) return '+256' + s.slice(1);
  if (s.length === 9)  return '+256' + s;
  if (s.length === 12 && s.startsWith('256')) return '+' + s;
  return '+256' + s;
}
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I/L/O/0/1 ambiguity
function randCode(n = 6) {
  return Array.from(crypto.randomBytes(n)).map(b => CODE_CHARS[b % CODE_CHARS.length]).join('');
}
async function generateUniqueReferralCode() {
  for (let attempt = 0; attempt < 15; attempt++) {
    const code = 'CHM' + randCode(4);
    const exists = await db.collection('users').where('referralCode', '==', code).limit(1).get();
    if (exists.empty) return code;
  }
  return 'CHM' + randCode(8);
}
// Transaction reference: a type letter, timestamp to the second, four random
// digits — same shape used across the rest of the product line (Chronova/
// Voltra) so a reference always reads as "B" + date-time + a short tail.
function stampRef(letter) {
  const d = eatNow();
  const p = n => String(n).padStart(2, '0');
  const stamp = String(d.getUTCFullYear()).slice(2) + p(d.getUTCMonth() + 1) + p(d.getUTCDate())
              + p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds());
  return letter + stamp + String(Math.floor(Math.random() * 10000)).padStart(4, '0');
}
async function uniqueRef(collection, letter) {
  for (let i = 0; i < 12; i++) {
    const ref = stampRef(letter);
    const hit = await db.collection(collection).where('ref', '==', ref).limit(1).get();
    if (hit.empty) return ref;
  }
  return stampRef(letter) + String(Math.floor(Math.random() * 100)).padStart(2, '0');
}

// ── PER-KEY MUTEX ──
// M0 has NO real transactions: two parallel requests can both read the same
// balance and both write it — a double-spend. Every debit/credit path below
// serialises through this so a single Node instance gives real mutual
// exclusion per user/deposit/withdrawal key.
const _lockTails = new Map();
function withLock(key, fn) {
  const prev = _lockTails.get(key) || Promise.resolve();
  const run  = prev.then(() => fn(), () => fn());
  const tail = run.then(() => {}, () => {});
  _lockTails.set(key, tail);
  tail.finally(() => { if (_lockTails.get(key) === tail) _lockTails.delete(key); });
  return run;
}

async function verifyAuth(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  try {
    const decoded = await admin.auth().verifyIdToken(header.slice(7));
    return decoded.uid;
  } catch (_) { return null; }
}
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a || ''));
  const bufB = Buffer.from(String(b || ''));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
function verifyAdmin(req) {
  const header = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || req.body.adminKey || '';
  return !!ADMIN_KEY && safeEqual(header, ADMIN_KEY);
}

// ── MARZPAY (deposits via collect-money, withdrawals via send-money) ──
const PROVIDER_BUSY_MSG = 'The mobile-money service is temporarily busy. Please try again shortly.';
function marzUserMsg(mp, fallback) {
  const raw = mp && (mp.message || mp.data?.message || mp.error || mp.data?.error);
  if ((mp && (mp.providerDown || mp.error_code === 'DATABASE_ERROR')) ||
      /database error|internal server|server error|unexpected error|try again|temporarily|timeout|timed out|gateway|unavailable|bad gateway/i.test(String(raw || '')))
    return PROVIDER_BUSY_MSG;
  return raw || fallback || PROVIDER_BUSY_MSG;
}
async function _marzParse(resp) {
  let data;
  try { data = await resp.json(); }
  catch (_) { return { status: 'error', providerDown: true, message: 'Invalid response from payment gateway' }; }
  if (!resp.ok && !data.status) data.status = 'error';
  return data;
}
async function marzCollect({ amount, phone, reference, description, callbackUrl }) {
  const payload = { amount: Number(amount), phone_number: phone, country: 'UG', reference,
    description: description || 'ChocoMCC deposit' };
  if (callbackUrl) payload.callback_url = callbackUrl;
  const resp = await fetch(`${MARZPAY_BASE}/collect-money`, {
    method: 'POST', signal: AbortSignal.timeout(MARZ_TIMEOUT),
    headers: { 'Authorization': `Basic ${MARZPAY_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return _marzParse(resp);
}
async function marzSendMoney({ amount, phone, reference, description, callbackUrl }) {
  const payload = { amount: Number(amount), phone_number: phone, country: 'UG', reference,
    description: description || 'ChocoMCC payout' };
  if (callbackUrl) payload.callback_url = callbackUrl;
  const resp = await fetch(`${MARZPAY_BASE}/send-money`, {
    method: 'POST', signal: AbortSignal.timeout(MARZ_TIMEOUT),
    headers: { 'Authorization': `Basic ${MARZPAY_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return _marzParse(resp);
}
async function marzGetCollectStatus(uuid) {
  try {
    const resp = await fetch(`${MARZPAY_BASE}/collect-money/${uuid}`, {
      signal: AbortSignal.timeout(MARZ_TIMEOUT), headers: { 'Authorization': `Basic ${MARZPAY_KEY}` }
    });
    const d = await resp.json();
    return String(d?.data?.transaction?.status || d?.transaction?.status || d?.status || '').toLowerCase();
  } catch (_) { return ''; }
}
async function marzGetSendStatus(uuid) {
  try {
    const resp = await fetch(`${MARZPAY_BASE}/send-money/${uuid}`, {
      signal: AbortSignal.timeout(MARZ_TIMEOUT), headers: { 'Authorization': `Basic ${MARZPAY_KEY}` }
    });
    const d = await resp.json();
    return String(d?.data?.transaction?.status || d?.transaction?.status || d?.status || '').toLowerCase();
  } catch (_) { return ''; }
}
const SUCCESS_STATUSES = new Set(['success', 'successful', 'completed']);
const FAILED_STATUSES  = new Set(['failed', 'declined', 'cancelled', 'canceled', 'rejected', 'expired']);

// ── DAILY CASHBACK (settle-on-read, no cron in this MVP) ──
// Each chocolate tier pays price*returnMultiple/cycleDays per elapsed day,
// capped at the tier's total payout. Settled lazily whenever the owning
// user's account/investments are read, so a user who never opens the app
// for a few days still gets caught up correctly the next time they do.
const _creditingPayouts = new Set();
async function settleInvestmentIfDue(doc) {
  const inv = doc.data();
  if (inv.status !== 'active') return false;
  const total = Number(inv.payoutsTotal) || 0;
  const made  = Number(inv.payoutsMade) || 0;
  if (!total || made >= total) return false;
  const createdMs = tsMillis(inv.createdAt) || Date.now();
  const elapsedDays = Math.floor((Date.now() - createdMs) / 86400000);
  const dueCount = Math.min(total, elapsedDays) - made;
  if (dueCount <= 0) return false;
  if (_creditingPayouts.has(doc.id)) return false;
  _creditingPayouts.add(doc.id);
  try {
    await withLock('payout:' + doc.id, async () => {
      await db.runTransaction(async t => {
        const fresh = await t.get(doc.ref);
        if (!fresh.exists || fresh.data().status !== 'active') return;
        const f = fresh.data();
        const fMade = Number(f.payoutsMade) || 0;
        const fTotal = Number(f.payoutsTotal) || 0;
        const fElapsed = Math.floor((Date.now() - (tsMillis(f.createdAt) || Date.now())) / 86400000);
        const fDue = Math.min(fTotal, fElapsed) - fMade;
        if (fDue <= 0) return;
        const newMade = fMade + fDue;
        const willComplete = newMade >= fTotal;
        const amount = willComplete
          ? Math.max(0, (Number(f.expectedReturn) || 0) - (Number(f.paidOut) || 0))
          : (Number(f.dailyPayout) || 0) * fDue;
        if (amount <= 0) return;
        const uRef = db.collection('users').doc(f.userId);
        t.update(uRef, { walletBalance: FieldValue.increment(amount), totalEarned: FieldValue.increment(amount) });
        t.update(doc.ref, {
          payoutsMade: newMade, paidOut: FieldValue.increment(amount),
          status: willComplete ? 'matured' : 'active'
        });
        const { date, time } = nowStr();
        t.set(db.collection('transactions').doc(), {
          userId: f.userId, type: 'cashback', description: `${f.tierLabel} daily cashback`,
          amount, status: 'success', date, time, investmentId: doc.id, createdAt: FieldValue.serverTimestamp()
        });
      });
    });
    return true;
  } finally { _creditingPayouts.delete(doc.id); }
}
async function settleAllForUser(userId) {
  const snap = await db.collection('investments').where('userId', '==', userId).where('status', '==', 'active').get();
  for (const doc of snap.docs) { await settleInvestmentIfDue(doc).catch(e => console.error('Settle error:', e.message)); }
}

// ── REFERRAL COMMISSION (credited when a downstream member buys a product) ──
async function creditReferralCommission(buyerId, amount) {
  const sett = await getSettings();
  const buyerSnap = await db.collection('users').doc(buyerId).get();
  if (!buyerSnap.exists) return;
  const l1Id = buyerSnap.data().referredBy;
  if (!l1Id) return;
  const rates = [sett.commL1, sett.commL2, sett.commL3];
  let chain = [l1Id];
  const l1Snap = await db.collection('users').doc(l1Id).get();
  const l2Id = l1Snap.exists ? l1Snap.data().referredBy : null;
  if (l2Id && l2Id !== l1Id) {
    chain.push(l2Id);
    const l2Snap = await db.collection('users').doc(l2Id).get();
    const l3Id = l2Snap.exists ? l2Snap.data().referredBy : null;
    if (l3Id && l3Id !== l2Id && l3Id !== l1Id) chain.push(l3Id);
  }
  const { date, time } = nowStr();
  for (let i = 0; i < chain.length; i++) {
    const pct = Number(rates[i]) || 0;
    if (pct <= 0) continue;
    const reward = Math.round(amount * pct / 100);
    if (reward <= 0) continue;
    await db.collection('users').doc(chain[i]).update({
      walletBalance: FieldValue.increment(reward), teamCommission: FieldValue.increment(reward)
    });
    await db.collection('transactions').add({
      userId: chain[i], type: 'commission', description: `Level ${i + 1} reward`,
      amount: reward, status: 'success', date, time, createdAt: FieldValue.serverTimestamp()
    });
  }
}

// ═══════════════════════════════════════════
// PUBLIC
// ═══════════════════════════════════════════
app.get('/health', async (_req, res) => {
  const dbOk = await pingDb().catch(() => false);
  res.json({ status: dbOk ? 'ok' : 'degraded', db: dbOk });
});
app.get('/public/settings', async (_req, res) => {
  const s = await getSettings();
  res.json({ status: 'success', settings: {
    withdrawFeePct: s.withdrawFeePct, minWithdraw: s.minWithdraw, minDeposit: s.minDeposit,
    dailyCheckin: s.dailyCheckin, commL1: s.commL1, commL2: s.commL2, commL3: s.commL3,
    returnMultiple: s.returnMultiple, cycleDays: s.cycleDays,
    maintenanceMode: !!s.maintenanceMode, maintenanceMsg: s.maintenanceMsg || ''
  } });
});
app.get('/public/products', async (_req, res) => {
  res.json({ status: 'success', products: await getProducts() });
});

// ═══════════════════════════════════════════
// ACCOUNT / REGISTER / CHECK-IN
// ═══════════════════════════════════════════
app.post('/account/create-profile', async (req, res) => {
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const phone = cleanPhone(req.body.phone || '');
  try {
    const ref = db.collection('users').doc(userId);
    const snap = await ref.get();
    if (snap.exists) return res.json({ status: 'success', message: 'Profile already exists' });
    await ref.set({
      phone, walletBalance: 0, totalDeposited: 0, totalEarned: 0, totalWithdrawn: 0, totalInvested: 0,
      checkinStreak: 0, lastCheckin: null, teamL1Count: 0, teamL2Count: 0, teamL3Count: 0, teamCommission: 0,
      referredBy: null, referralCode: null, registrationDone: false, status: 'active',
      createdAt: FieldValue.serverTimestamp()
    });
    res.json({ status: 'success' });
  } catch (e) {
    console.error('create-profile error:', e.message);
    res.status(500).json({ status: 'error', message: 'Could not create your profile' });
  }
});

app.post('/register', async (req, res) => {
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const { referralCode } = req.body;
  try {
    await withLock('reg:' + userId, async () => {
      const userRef = db.collection('users').doc(userId);
      const userSnap = await userRef.get();
      if (!userSnap.exists) return res.status(404).json({ status: 'error', message: 'User not found' });
      if (userSnap.data().registrationDone)
        return res.json({ status: 'already_done', referralCode: userSnap.data().referralCode || null });

      const code = String(referralCode || '').trim().toUpperCase();
      let referrerId = null;
      if (code) {
        const refSnap = await db.collection('users').where('referralCode', '==', code).limit(1).get();
        if (refSnap.empty)
          return res.status(400).json({ status: 'error', code: 'BAD_REFERRAL', message: 'That referral code does not exist.' });
        if (refSnap.docs[0].id === userId)
          return res.status(400).json({ status: 'error', code: 'BAD_REFERRAL', message: 'You cannot use your own referral code.' });
        referrerId = refSnap.docs[0].id;
      }

      const myRefCode = await generateUniqueReferralCode();
      const update = { registrationDone: true, referralCode: myRefCode };
      if (referrerId) {
        update.referredBy = referrerId;
        await db.collection('users').doc(referrerId).update({ teamL1Count: FieldValue.increment(1) });
        const l1Snap = await db.collection('users').doc(referrerId).get();
        const l2Id = l1Snap.exists ? l1Snap.data().referredBy : null;
        if (l2Id && l2Id !== referrerId) await db.collection('users').doc(l2Id).update({ teamL2Count: FieldValue.increment(1) });
      }
      await userRef.update(update);
      res.json({ status: 'success', referrerId, referralCode: myRefCode });
    });
  } catch (e) {
    console.error('Register error:', e.message);
    res.status(500).json({ status: 'error', message: e.message });
  }
});

app.get('/account', async (req, res) => {
  const uid = await verifyAuth(req);
  if (!uid) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    await settleAllForUser(uid);
    const snap = await db.collection('users').doc(uid).get();
    if (!snap.exists) return res.status(404).json({ status: 'error', message: 'User not found' });
    const u = snap.data();
    res.json({ status: 'success', account: {
      phone: u.phone, walletBalance: u.walletBalance || 0, totalDeposited: u.totalDeposited || 0,
      totalEarned: u.totalEarned || 0, totalWithdrawn: u.totalWithdrawn || 0, totalInvested: u.totalInvested || 0,
      checkinStreak: u.checkinStreak || 0, lastCheckin: u.lastCheckin || null, referralCode: u.referralCode || null,
      team: { l1: u.teamL1Count || 0, l2: u.teamL2Count || 0, l3: u.teamL3Count || 0, commission: u.teamCommission || 0 }
    } });
  } catch (e) {
    console.error('Account error:', e.message);
    res.status(500).json({ status: 'error', message: 'Could not load your account' });
  }
});

app.post('/checkin', async (req, res) => {
  const uid = await verifyAuth(req);
  if (!uid) return res.status(401).json({ status: 'error', message: 'Please sign in again' });
  try {
    await withLock('checkin:' + uid, async () => {
      const sett = await getSettings();
      const ref = db.collection('users').doc(uid);
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ status: 'error', message: 'User not found' });
      const u = snap.data();
      const today = nowStr().date;
      if (u.lastCheckin === today) return res.status(400).json({ status: 'error', message: 'Already checked in today' });
      const yesterday = new Date(eatNow().getTime() - 86400000);
      const yPad = n => String(n).padStart(2, '0');
      const yStr = yPad(yesterday.getUTCMonth() + 1) + '/' + yPad(yesterday.getUTCDate()) + '/' + yesterday.getUTCFullYear();
      const streak = u.lastCheckin === yStr ? (u.checkinStreak || 0) + 1 : 1;
      const bonus = sett.dailyCheckin;
      await ref.update({ walletBalance: FieldValue.increment(bonus), lastCheckin: today, checkinStreak: streak });
      const { date, time } = nowStr();
      await db.collection('transactions').add({
        userId: uid, type: 'checkin', description: `Daily reward, day ${streak}`,
        amount: bonus, status: 'success', date, time, createdAt: FieldValue.serverTimestamp()
      });
      res.json({ status: 'success', bonus, streak });
    });
  } catch (e) {
    console.error('Checkin error:', e.message);
    res.status(500).json({ status: 'error', message: 'Check-in failed' });
  }
});

// ═══════════════════════════════════════════
// PRODUCTS (buy a chocolate tier)
// ═══════════════════════════════════════════
app.post('/invest/create', async (req, res) => {
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Please sign in again' });
  const tier = await getProductByKey(req.body.tierKey);
  if (!tier) return res.status(400).json({ status: 'error', message: 'Unknown product' });
  try {
    const sett = await getSettings();
    const cycle = Number(tier.cycle) || sett.cycleDays;
    const expectedReturn = Number(tier.expectedReturn) || Math.round(tier.price * sett.returnMultiple);
    const dailyPayout = Math.round(expectedReturn / cycle);
    let invId;
    await withLock('bal:' + userId, () => db.runTransaction(async t => {
      const uRef = db.collection('users').doc(userId);
      const fresh = await t.get(uRef);
      if (!fresh.exists) throw new Error('User not found');
      const bal = fresh.data().walletBalance || 0;
      if (bal < tier.price) throw new Error(`Need ${fmtUGX(tier.price)}, have ${fmtUGX(bal)}`);
      const invRef = db.collection('investments').doc();
      invId = invRef.id;
      t.update(uRef, { walletBalance: FieldValue.increment(-tier.price), totalInvested: FieldValue.increment(tier.price) });
      const { date, time } = nowStr();
      t.set(invRef, {
        userId, tierKey: tier.key, tierLabel: tier.name, amount: tier.price, cycle, expectedReturn,
        status: 'active', dailyPayout, payoutsTotal: cycle, payoutsMade: 0, paidOut: 0,
        date, time, createdAt: FieldValue.serverTimestamp()
      });
      t.set(db.collection('transactions').doc(), {
        userId, type: 'investment', description: `Bought ${tier.name}`, amount: -tier.price,
        status: 'success', date, time, investmentId: invRef.id, createdAt: FieldValue.serverTimestamp()
      });
    }));
    creditReferralCommission(userId, tier.price).catch(e => console.error('Commission error:', e.message));
    res.json({ status: 'success', investmentId: invId, message: `Bought ${tier.name} for ${fmtUGX(tier.price)}` });
  } catch (e) {
    res.status(400).json({ status: 'error', message: e.message });
  }
});

app.get('/investments', async (req, res) => {
  const uid = await verifyAuth(req);
  if (!uid) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    await settleAllForUser(uid);
    const snap = await db.collection('investments').where('userId', '==', uid).get();
    res.json({ status: 'success', investments: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
  } catch (e) {
    res.status(500).json({ status: 'error', message: 'Could not load your chocolates' });
  }
});

// ═══════════════════════════════════════════
// DEPOSIT (MarzPay collect-money)
// ═══════════════════════════════════════════
const _depCreateDebounce = new Map();
app.post('/deposit/marzpay', async (req, res) => {
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Please sign in again' });
  const amt = parseInt(req.body.amount, 10);
  if (isNaN(amt) || amt <= 0) return res.status(400).json({ status: 'error', message: 'Invalid amount' });
  const lastDep = _depCreateDebounce.get(userId) || 0;
  if (Date.now() - lastDep < 7000)
    return res.status(429).json({ status: 'error', message: 'A deposit is already being processed. Please wait a moment.' });
  _depCreateDebounce.set(userId, Date.now());
  try {
    const [uSnap, sett] = await Promise.all([db.collection('users').doc(userId).get(), getSettings()]);
    if (!uSnap.exists) return res.status(404).json({ status: 'error', message: 'User not found' });
    if (amt < sett.minDeposit) return res.status(400).json({ status: 'error', message: `Minimum amount is ${fmtUGX(sett.minDeposit)}` });
    const phone = cleanPhone(req.body.phone || uSnap.data().phone || '');
    if (!phone || phone.length < 10) return res.status(400).json({ status: 'error', message: 'Enter a valid mobile-money phone number.' });

    const reference = await uniqueRef('pendingDeposits', 'B');
    const { date, time } = nowStr();
    const depRef = db.collection('pendingDeposits').doc();
    // Write BEFORE calling the gateway — marzCollect() below can trigger a
    // REAL mobile-money charge; if the process dies right after that call
    // succeeds, the doc must already exist so a reconciler can find it by
    // OUR OWN reference even without MarzPay's uuid yet.
    await depRef.set({
      userId, phone, amount: amt, ref: reference, status: 'initiating',
      date, time, createdAt: FieldValue.serverTimestamp()
    });
    const mpData = await marzCollect({
      amount: amt, phone, reference, description: 'ChocoMCC deposit',
      callbackUrl: PUBLIC_URL ? PUBLIC_URL + '/deposit/callback' : undefined
    });
    if (mpData.status !== 'success' && mpData.status !== 'sandbox') {
      // Log the RAW gateway response — marzUserMsg() below deliberately hides
      // this from the user behind a friendly message, so without this line
      // there is no way to tell a bad MARZPAY_KEY apart from a real MarzPay
      // outage apart from staring at Render's logs and seeing nothing.
      console.error('MarzPay collect-money rejected:', JSON.stringify(mpData));
      await depRef.update({ status: 'failed', failureReason: marzUserMsg(mpData, 'Could not start the payment') }).catch(() => {});
      return res.status(400).json({ status: 'error', message: marzUserMsg(mpData, 'Could not start the payment right now. Please try again.') });
    }
    const marzTxUuid = mpData.data?.transaction?.uuid || null;
    await depRef.update({ status: 'pending', marzTxUuid });
    res.json({ status: 'success', depositId: depRef.id, reference, message: 'Payment initiated — check your phone.' });
  } catch (e) {
    console.error('Deposit error:', e.message);
    res.status(500).json({ status: 'error', message: PROVIDER_BUSY_MSG });
  }
});

const _creditingDeposits = new Set();
async function creditDeposit(depDoc) {
  const dep = depDoc.data();
  if (dep.status === 'matched') return true;
  if (_creditingDeposits.has(depDoc.id)) return false;
  _creditingDeposits.add(depDoc.id);
  try {
    let credited = false;
    await withLock('dep:' + depDoc.id, async () => {
      const fresh = await depDoc.ref.get();
      if (!fresh.exists || fresh.data().status === 'matched') { credited = fresh.exists; return; }
      await db.runTransaction(async t => {
        const uRef = db.collection('users').doc(fresh.data().userId);
        t.update(uRef, { walletBalance: FieldValue.increment(fresh.data().amount), totalDeposited: FieldValue.increment(fresh.data().amount) });
        t.update(depDoc.ref, { status: 'matched', creditedAt: FieldValue.serverTimestamp() });
        const { date, time } = nowStr();
        t.set(db.collection('transactions').doc(), {
          userId: fresh.data().userId, type: 'deposit', description: 'Added funds to wallet',
          amount: fresh.data().amount, status: 'success', date, time, marzReference: fresh.data().ref,
          createdAt: FieldValue.serverTimestamp()
        });
      });
      credited = true;
    });
    return credited;
  } finally { _creditingDeposits.delete(depDoc.id); }
}

// Client polls this every few seconds after /deposit/marzpay while showing
// the "Payment Initiated" / auto-verifying screen.
app.post('/deposit/marzpay/status', async (req, res) => {
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const depSnap = await db.collection('pendingDeposits').doc(String(req.body.depositId || '')).get();
    if (!depSnap.exists || depSnap.data().userId !== userId)
      return res.status(404).json({ status: 'error', message: 'Deposit not found' });
    const dep = depSnap.data();
    if (dep.status === 'matched') return res.json({ status: 'success', state: 'matched' });
    if (dep.status === 'failed')  return res.json({ status: 'success', state: 'failed', message: dep.failureReason });
    if (!dep.marzTxUuid) return res.json({ status: 'success', state: 'pending' });

    const marzStatus = await marzGetCollectStatus(dep.marzTxUuid);
    if (SUCCESS_STATUSES.has(marzStatus)) {
      await creditDeposit(depSnap);
      return res.json({ status: 'success', state: 'matched' });
    }
    if (FAILED_STATUSES.has(marzStatus)) {
      await depSnap.ref.update({ status: 'failed', failureReason: 'Payment was not completed' }).catch(() => {});
      return res.json({ status: 'success', state: 'failed', message: 'Payment was not completed' });
    }
    res.json({ status: 'success', state: 'pending' });
  } catch (e) {
    console.error('Deposit status error:', e.message);
    res.status(500).json({ status: 'error', message: 'Could not check payment status' });
  }
});

// MarzPay webhook — never trusted blindly; re-confirms via marzGetCollectStatus
// before crediting anything, so a forged callback body is worthless.
app.post('/deposit/callback', async (req, res) => {
  try {
    const reference = req.body?.data?.reference || req.body?.reference;
    if (!reference) return res.status(200).json({ status: 'ignored' });
    const depSnap = await db.collection('pendingDeposits').where('ref', '==', reference).limit(1).get();
    if (depSnap.empty) return res.status(200).json({ status: 'ignored' });
    const doc = depSnap.docs[0];
    const uuid = doc.data().marzTxUuid;
    if (uuid) {
      const marzStatus = await marzGetCollectStatus(uuid);
      if (SUCCESS_STATUSES.has(marzStatus)) await creditDeposit(doc);
      else if (FAILED_STATUSES.has(marzStatus)) await doc.ref.update({ status: 'failed', failureReason: 'Payment was not completed' }).catch(() => {});
    }
    res.status(200).json({ status: 'ok' });
  } catch (e) {
    console.error('Deposit callback error:', e.message);
    res.status(200).json({ status: 'error' }); // still 200 — MarzPay retries on non-2xx
  }
});

// ═══════════════════════════════════════════
// WITHDRAWAL (MarzPay send-money)
// ═══════════════════════════════════════════
app.post('/withdraw/request', async (req, res) => {
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Please sign in again' });
  const amt = parseInt(req.body.amount, 10);
  const { holder, network, phone: bankPhone } = req.body;
  if (isNaN(amt) || amt <= 0) return res.status(400).json({ status: 'error', message: 'Invalid amount' });
  const phone = cleanPhone(bankPhone || '');
  if (!holder || !network || !phone || phone.length < 10)
    return res.status(400).json({ status: 'error', message: 'Bind a mobile-money account first.' });
  try {
    const sett = await getSettings();
    if (amt < sett.minWithdraw) return res.status(400).json({ status: 'error', message: `Minimum cash-out is ${fmtUGX(sett.minWithdraw)}` });
    if (amt % 5000 !== 0) return res.status(400).json({ status: 'error', message: 'Amount must be a multiple of UGX 5,000' });

    const fee = Math.round(amt * sett.withdrawFeePct / 100);
    const net = amt - fee;
    const reference = await uniqueRef('withdrawals', 'B');
    let witId;
    await withLock('bal:' + userId, () => db.runTransaction(async t => {
      const uRef = db.collection('users').doc(userId);
      const fresh = await t.get(uRef);
      if (!fresh.exists) throw new Error('User not found');
      const bal = fresh.data().walletBalance || 0;
      if (bal < amt) throw new Error(`Not enough balance — you have ${fmtUGX(bal)}`);
      const witRef = db.collection('withdrawals').doc();
      witId = witRef.id;
      t.update(uRef, { walletBalance: FieldValue.increment(-amt), totalWithdrawn: FieldValue.increment(net) });
      const { date, time } = nowStr();
      t.set(witRef, {
        userId, amount: amt, fee, net, holder, network, phone, ref: reference,
        status: 'processing', date, time, createdAt: FieldValue.serverTimestamp()
      });
      t.set(db.collection('transactions').doc(), {
        userId, type: 'withdraw', description: `Cash out to ${holder} (${network}) — net ${fmtUGX(net)} after ${sett.withdrawFeePct}% fee`,
        amount: -amt, status: 'success', date, time, marzReference: reference, createdAt: FieldValue.serverTimestamp()
      });
    }));

    const mpData = await marzSendMoney({
      amount: net, phone, reference, description: 'ChocoMCC cash out',
      callbackUrl: PUBLIC_URL ? PUBLIC_URL + '/withdraw/callback' : undefined
    });
    const witRef = db.collection('withdrawals').doc(witId);
    if (mpData.status !== 'success' && mpData.status !== 'sandbox') {
      console.error('MarzPay send-money rejected:', JSON.stringify(mpData));
      // Gateway rejected outright — refund immediately, nothing left in flight.
      await db.runTransaction(async t => {
        const uRef = db.collection('users').doc(userId);
        t.update(uRef, { walletBalance: FieldValue.increment(amt), totalWithdrawn: FieldValue.increment(-net) });
        t.update(witRef, { status: 'declined', failureReason: marzUserMsg(mpData, 'Payout could not be started') });
      });
      return res.status(400).json({ status: 'error', message: marzUserMsg(mpData, 'Could not process the cash-out right now. Please try again.') });
    }
    await witRef.update({ marzTxUuid: mpData.data?.transaction?.uuid || null });
    res.json({ status: 'success', withdrawalId: witId, reference, net, message: `Cash-out requested — net ${fmtUGX(net)}` });
  } catch (e) {
    res.status(400).json({ status: 'error', message: e.message });
  }
});

app.post('/withdraw/marzpay/status', async (req, res) => {
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const witSnap = await db.collection('withdrawals').doc(String(req.body.withdrawalId || '')).get();
    if (!witSnap.exists || witSnap.data().userId !== userId)
      return res.status(404).json({ status: 'error', message: 'Cash-out not found' });
    const wit = witSnap.data();
    if (wit.status === 'processed' || wit.status === 'declined') return res.json({ status: 'success', state: wit.status });
    if (!wit.marzTxUuid) return res.json({ status: 'success', state: 'processing' });

    const marzStatus = await marzGetSendStatus(wit.marzTxUuid);
    if (SUCCESS_STATUSES.has(marzStatus)) {
      await witSnap.ref.update({ status: 'processed', processedAt: FieldValue.serverTimestamp() }).catch(() => {});
      return res.json({ status: 'success', state: 'processed' });
    }
    if (FAILED_STATUSES.has(marzStatus)) {
      // Refund on confirmed failure — same lock key as the debit above.
      await withLock('bal:' + userId, () => db.runTransaction(async t => {
        const fresh = await t.get(witSnap.ref);
        if (!fresh.exists || fresh.data().status !== 'processing') return;
        const uRef = db.collection('users').doc(userId);
        t.update(uRef, { walletBalance: FieldValue.increment(fresh.data().amount), totalWithdrawn: FieldValue.increment(-fresh.data().net) });
        t.update(witSnap.ref, { status: 'declined', failureReason: 'Payout failed at the mobile-money provider' });
      }));
      return res.json({ status: 'success', state: 'declined' });
    }
    res.json({ status: 'success', state: 'processing' });
  } catch (e) {
    console.error('Withdraw status error:', e.message);
    res.status(500).json({ status: 'error', message: 'Could not check cash-out status' });
  }
});

app.post('/withdraw/callback', async (req, res) => {
  try {
    const reference = req.body?.data?.reference || req.body?.reference;
    if (!reference) return res.status(200).json({ status: 'ignored' });
    const witSnap = await db.collection('withdrawals').where('ref', '==', reference).limit(1).get();
    if (witSnap.empty) return res.status(200).json({ status: 'ignored' });
    const doc = witSnap.docs[0];
    const uuid = doc.data().marzTxUuid;
    if (uuid) {
      const marzStatus = await marzGetSendStatus(uuid);
      if (SUCCESS_STATUSES.has(marzStatus)) await doc.ref.update({ status: 'processed', processedAt: FieldValue.serverTimestamp() }).catch(() => {});
    }
    res.status(200).json({ status: 'ok' });
  } catch (e) {
    console.error('Withdraw callback error:', e.message);
    res.status(200).json({ status: 'error' });
  }
});

// ═══════════════════════════════════════════
// BIND BANK CARD
// ═══════════════════════════════════════════
app.post('/bank/save', async (req, res) => {
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const { holder, network, phone: rawPhone } = req.body;
  const phone = cleanPhone(rawPhone || '');
  if (!holder || !network || phone.length < 10) return res.status(400).json({ status: 'error', message: 'Fill in all fields' });
  try {
    await db.collection('bankAccounts').add({ userId, holder, network, phone, createdAt: FieldValue.serverTimestamp() });
    res.json({ status: 'success' });
  } catch (e) {
    res.status(500).json({ status: 'error', message: 'Could not save the bank account' });
  }
});
app.get('/bank/list', async (req, res) => {
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const snap = await db.collection('bankAccounts').where('userId', '==', userId).get();
    res.json({ status: 'success', accounts: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
  } catch (e) {
    res.status(500).json({ status: 'error', message: 'Could not load bank accounts' });
  }
});

// ═══════════════════════════════════════════
// PROMO CODES
// ═══════════════════════════════════════════
app.post('/redeem', async (req, res) => {
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Please sign in again' });
  const code = String(req.body.code || '').trim().toUpperCase();
  if (!code) return res.status(400).json({ status: 'error', message: 'Enter a promo code' });
  try {
    await withLock('redeem:' + userId + ':' + code, async () => {
      const codeSnap = await db.collection('promoCodes').where('code', '==', code).limit(1).get();
      if (codeSnap.empty) return res.status(400).json({ status: 'error', message: "That code isn't valid" });
      const codeDoc = codeSnap.docs[0];
      const usedSnap = await db.collection('promoRedemptions').where('userId', '==', userId).where('code', '==', code).limit(1).get();
      if (!usedSnap.empty) return res.status(400).json({ status: 'error', message: "You've already used this code" });
      const reward = Number(codeDoc.data().reward) || 0;
      await db.collection('users').doc(userId).update({ walletBalance: FieldValue.increment(reward) });
      await db.collection('promoRedemptions').add({ userId, code, reward, createdAt: FieldValue.serverTimestamp() });
      const { date, time } = nowStr();
      await db.collection('transactions').add({
        userId, type: 'promocode', description: `Promo code redeemed — ${code}`,
        amount: reward, status: 'success', date, time, createdAt: FieldValue.serverTimestamp()
      });
      res.json({ status: 'success', reward });
    });
  } catch (e) {
    console.error('Redeem error:', e.message);
    res.status(500).json({ status: 'error', message: 'Could not redeem this code' });
  }
});

// ═══════════════════════════════════════════
// TRANSACTIONS (Records / Transaction History)
// ═══════════════════════════════════════════
app.get('/transactions', async (req, res) => {
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const snap = await db.collection('transactions').where('userId', '==', userId).orderBy('createdAt', 'desc').limit(100).get();
    res.json({ status: 'success', transactions: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
  } catch (e) {
    res.status(500).json({ status: 'error', message: 'Could not load your transactions' });
  }
});
// Own top-up (deposit) history, including ones still pending/failed — the
// generic /transactions list only ever gets a row once a deposit is
// actually credited, so this is the only place a user can see one that's
// still processing or that never went through.
app.get('/deposits', async (req, res) => {
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const snap = await db.collection('pendingDeposits').where('userId', '==', userId).orderBy('createdAt', 'desc').limit(100).get();
    res.json({ status: 'success', deposits: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
  } catch (e) {
    res.status(500).json({ status: 'error', message: 'Could not load your top-ups' });
  }
});
// Own cash-out history, including ones still processing/declined.
app.get('/withdrawals', async (req, res) => {
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const snap = await db.collection('withdrawals').where('userId', '==', userId).orderBy('createdAt', 'desc').limit(100).get();
    res.json({ status: 'success', withdrawals: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
  } catch (e) {
    res.status(500).json({ status: 'error', message: 'Could not load your cash-outs' });
  }
});

// ═══════════════════════════════════════════
// ADMIN (key-gated — no per-staff accounts yet, mirrors Voltra's original model)
// ═══════════════════════════════════════════
app.post('/admin/check-key', (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Invalid admin key' });
  res.json({ status: 'success' });
});
app.get('/admin/settings', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Invalid admin key' });
  res.json({ status: 'success', settings: await getSettings() });
});
app.post('/admin/settings/update', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Invalid admin key' });
  try {
    await db.collection('settings').doc('main').set(req.body.settings || {}, { merge: true });
    _settingsCacheTs = 0;
    res.json({ status: 'success' });
  } catch (e) {
    res.status(500).json({ status: 'error', message: 'Could not save settings' });
  }
});
app.get('/admin/products', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Invalid admin key' });
  res.json({ status: 'success', products: await getProducts() });
});
app.post('/admin/products/save', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Invalid admin key' });
  try {
    const list = Array.isArray(req.body.products) ? req.body.products : [];
    const batch = db.batch();
    list.forEach((p, i) => batch.set(db.collection('products').doc(p.key), Object.assign({}, p, { order: i }), { merge: true }));
    await batch.commit();
    _productsCacheTs = 0;
    res.json({ status: 'success' });
  } catch (e) {
    res.status(500).json({ status: 'error', message: 'Could not save products' });
  }
});

// ═══════════════════════════════════════════
app.get('/', (_req, res) => res.json({ status: 'ok', service: 'ChocoMCC backend' }));

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || '';
if (!MONGODB_URI) { console.error('MONGODB_URI env var is required'); process.exit(1); }
connectMongo(MONGODB_URI)
  .then(() => app.listen(PORT, () => console.log(`ChocoMCC backend listening on :${PORT}`)))
  .catch(e => { console.error('Mongo connection failed:', e.message); process.exit(1); });
