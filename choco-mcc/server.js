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
// If a Bearer token is a valid admin session, attach req.adminUser so
// verifyAdmin()/verifyOwner() below can recognise it. A raw master-key
// Authorization header skips the DB lookup entirely (verifyAdmin compares it
// directly) and falls through untouched. A transient DB hiccup must never
// look like "your session is invalid" — it's just left unresolved, and
// verifyAdmin() falls through to the legacy-key check (which fails closed).
app.use('/admin/', async (req, _res, next) => {
  const header = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (header && !(ADMIN_KEY && safeEqual(header, ADMIN_KEY))) {
    try { req.adminUser = await resolveSession(header); }
    catch (e) { console.error('Admin session resolve error:', e.message); }
  }
  next();
});
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
  dailyCheckin: 250, welcomeBonus: 7000, commL1: 27, commL2: 2, commL3: 1,
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
// Bank-account holder name is the one piece of free text a user can store
// and later see rendered back (Records/Bind Bank Card) — strip any HTML so
// a name like '<img onerror=...>' can never execute when displayed.
function stripHtml(s) { return String(s || '').replace(/<[^>]*>/g, '').trim(); }
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
// 6-character alphanumeric, cryptographically random (crypto.randomBytes),
// checked against every existing user's referralCode for global uniqueness,
// then written onto that user's own doc only — one code is permanently
// bound to exactly one account uid.
async function generateUniqueReferralCode() {
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = randCode(6);
    const exists = await db.collection('users').where('referralCode', '==', code).limit(1).get();
    if (exists.empty) return code;
  }
  return randCode(8);
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

// TASK CENTER — milestone rewards on the COUNT of a user's ACTIVE level-1
// referrals (an active referral = one who has invested at least once, i.e.
// totalInvested > 0). This is separate from and on top of the ordinary
// L1/L2/L3 % commission paid on every investment (creditReferralCommission
// below) — commission pays per purchase, these milestones pay once each,
// the first time a referral-count threshold is reached. Each tier is
// claimed explicitly (never auto-credited) via /team/milestone/claim, which
// always recomputes the live count itself server-side — the client-reported
// progress is informational only and is never trusted for the actual payout.
const TEAM_MILESTONES = [
  { target:   5, reward:  10000 },
  { target:  10, reward:  20000 },
  { target:  20, reward:  50000 },
  { target:  25, reward:  60000 },
  { target:  50, reward: 100000 },
  { target: 100, reward: 200000 },
];
// Second Task Center ladder: total money this user's LEVEL 1 referrals
// (never L2/L3) have deposited, summed across their accounts. Same
// manual-claim, server-recomputed pattern as TEAM_MILESTONES, but its own
// claim-flag namespace so the two ladders can never collide or double-pay
// each other.
const TEAM_DEPOSIT_MILESTONES = [
  { target:   90000, reward:   2000 },
  { target:  270000, reward:   6000 },
  { target:  500000, reward:  12000 },
  { target: 1000000, reward:  25000 },
  { target: 2000000, reward:  50000 },
  { target: 5000000, reward: 150000 },
];
// Recomputed live on every /team/stats read and every claim — never stored,
// never trusted from the client, so a milestone can never be forged.
async function activeL1Count(userId) {
  const snap = await db.collection('users').where('referredBy', '==', userId).get();
  let n = 0;
  snap.forEach(d => { if ((d.data().totalInvested || 0) > 0) n += 1; });
  return n;
}
async function l1TeamDeposits(userId) {
  const snap = await db.collection('users').where('referredBy', '==', userId).get();
  let total = 0;
  snap.forEach(d => { total += Number(d.data().totalDeposited || 0); });
  return total;
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
// verifyAdmin accepts EITHER a resolved session (req.adminUser, attached by
// the '/admin/' middleware below) OR the legacy raw ADMIN_KEY — this is what
// lets every existing `if (!verifyAdmin(req))` call site keep working
// unchanged while multi-admin accounts are added on top.
function verifyAdmin(req) {
  if (req.adminUser) return true;
  if (!ADMIN_KEY) return false;
  const header = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (header && safeEqual(header, ADMIN_KEY)) return true;
  return safeEqual(req.body?.adminKey, ADMIN_KEY);
}
// Owner-only actions (managing other admin accounts, rates, products, gift
// codes, wallet credit/debit/ban/delete) must never be reachable with a
// staff login — only the master key or a session issued to the owner.
function verifyOwner(req) {
  if (!verifyAdmin(req)) return false;
  return !req.adminUser || req.adminUser.role === 'owner';
}

// ── MULTI-ADMIN ACCOUNTS + SESSIONS ──
// ADMIN_KEY stays the OWNER's own master credential — never handed to staff.
// Each other admin gets their own username + password (adminUsers, password
// stored only as a scrypt hash). Logging in issues a random, short-lived
// session token (adminSessions) instead of resending a password on every
// request, so deactivating or resetting ONE account revokes only that
// person's access — nobody else has to change anything.
const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h — forces periodic re-login
function scryptHash(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function scryptVerify(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const check = crypto.scryptSync(String(password || ''), salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex'), b = Buffer.from(check, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
// Per-username lockout — independent of the IP-based rate limiter, so
// spraying attempts at one username from many different IPs still gets
// locked out instead of slipping under the per-IP ceiling.
const _loginFails = new Map(); // lockKey -> { count, lockedUntil }
function loginLocked(key) {
  const f = _loginFails.get(key);
  return !!(f && f.lockedUntil && f.lockedUntil > Date.now());
}
function recordLoginFail(key) {
  const f = _loginFails.get(key) || { count: 0, lockedUntil: 0 };
  f.count++;
  if (f.count >= 5) { f.lockedUntil = Date.now() + 15 * 60 * 1000; f.count = 0; }
  _loginFails.set(key, f);
}
function clearLoginFails(key) { _loginFails.delete(key); }
async function createSession(username, role) {
  const token = crypto.randomBytes(32).toString('hex');
  await db.collection('adminSessions').doc(token).set({
    username, role, createdAt: FieldValue.serverTimestamp(),
    expiresAt: new Date(Date.now() + ADMIN_SESSION_TTL_MS)
  });
  return token;
}
async function resolveSession(token) {
  if (!token) return null;
  const snap = await db.collection('adminSessions').doc(token).get();
  if (!snap.exists) return null;
  const s = snap.data();
  if (tsMillis(s.expiresAt) < Date.now()) { db.collection('adminSessions').doc(token).delete().catch(() => {}); return null; }
  if (s.role !== 'owner') {
    const uSnap = await db.collection('adminUsers').doc(s.username).get();
    if (!uSnap.exists || uSnap.data().active === false) return null;
  }
  return { username: s.username, role: s.role };
}
async function invalidateSessionsFor(username) {
  const snap = await db.collection('adminSessions').where('username', '==', username).get();
  await Promise.all(snap.docs.map(d => d.ref.delete().catch(() => {})));
}
// Fire-and-forget audit trail — who did what, from where. Never blocks the
// action itself if logging fails.
function logAdminAction(req, action, meta) {
  db.collection('adminAuditLog').doc().set({
    actor: req.adminUser?.username || 'owner-key',
    role: req.adminUser?.role || 'owner',
    action, meta: meta || {}, ip: req.ip,
    createdAt: FieldValue.serverTimestamp()
  }).catch(() => {});
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
// Idempotent per (investmentId, level): each level is only ever credited
// once, tracked via commissionPaidLevels on the investment doc itself, and
// the whole function is safe to call again for the SAME purchase — by the
// reconciler after a restart, by a retry, by anything — since already-paid
// levels are skipped and never re-credited. This is what makes crediting
// "faultless on restart": if the process dies mid-loop, whatever was
// credited before that point stays correctly marked done, and the
// reconciler's periodic re-invocation picks up exactly where it left off
// rather than either re-paying or permanently losing the remaining levels.
async function creditReferralCommission(investmentId, buyerId, amount) {
  await withLock('comm:' + investmentId, async () => {
    const invRef = db.collection('investments').doc(investmentId);
    const invSnap = await invRef.get();
    if (!invSnap.exists) return;
    const paidLevels = invSnap.data().commissionPaidLevels || [];

    const sett = await getSettings();
    const buyerSnap = await db.collection('users').doc(buyerId).get();
    // Don't pay commission on a purchase from an account that's since been
    // banned — checking the REFERRED member's own status, not just the
    // referrer's, before any reward goes out.
    if (!buyerSnap.exists || buyerSnap.data().status === 'banned') return;
    const l1Id = buyerSnap.data().referredBy;
    if (!l1Id) return;
    const rates = [sett.commL1, sett.commL2, sett.commL3];
    const l1Snap = await db.collection('users').doc(l1Id).get();
    // Each chain entry carries its own already-fetched snapshot so we never
    // re-look-up (or blindly trust) a doc that might not exist or might be
    // banned when it comes time to actually credit it below.
    let chain = [{ id: l1Id, snap: l1Snap }];
    const l2Id = l1Snap.exists ? l1Snap.data().referredBy : null;
    if (l2Id && l2Id !== l1Id) {
      const l2Snap = await db.collection('users').doc(l2Id).get();
      chain.push({ id: l2Id, snap: l2Snap });
      const l3Id = l2Snap.exists ? l2Snap.data().referredBy : null;
      if (l3Id && l3Id !== l2Id && l3Id !== l1Id) {
        const l3Snap = await db.collection('users').doc(l3Id).get();
        chain.push({ id: l3Id, snap: l3Snap });
      }
    }
    const { date, time } = nowStr();
    for (let i = 0; i < chain.length; i++) {
      if (paidLevels.indexOf(i) !== -1) continue; // this level already paid — never re-credit it
      const { id, snap } = chain[i];
      // Skip a referrer that doesn't exist (orphaned link) or is banned —
      // crediting either would be a phantom or fraudulent payout.
      if (!snap.exists || snap.data().status === 'banned') continue;
      const pct = Number(rates[i]) || 0;
      if (pct <= 0) continue;
      const reward = Math.round(amount * pct / 100);
      if (reward <= 0) continue;
      await db.collection('users').doc(id).update({
        walletBalance: FieldValue.increment(reward), teamCommission: FieldValue.increment(reward)
      });
      await db.collection('transactions').add({
        userId: id, type: 'commission', description: `Level ${i + 1} reward`,
        amount: reward, status: 'success', date, time, investmentId, createdAt: FieldValue.serverTimestamp()
      });
      // Mark THIS level paid immediately after its own credit succeeds — if
      // anything later in the loop throws, everything credited so far stays
      // correctly marked done and will never be paid twice on retry.
      await invRef.update({ commissionPaidLevels: FieldValue.arrayUnion(i) });
    }
  });
}

// ═══════════════════════════════════════════
// TEAM + TASK CENTER
// ═══════════════════════════════════════════
app.get('/team/members', async (req, res) => {
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const snap = await db.collection('users').where('referredBy', '==', userId).get();
    const members = [];
    snap.forEach(doc => {
      const d = doc.data();
      members.push({
        id: doc.id, phone: d.phone || '',
        joinedAt: d.createdAt ? new Date(tsMillis(d.createdAt)).toISOString() : null,
        hasInvested: (d.totalInvested || 0) > 0,
        totalInvested: d.totalInvested || 0,
        deposited: d.totalDeposited || 0,
      });
    });
    members.sort((a, b) => (b.joinedAt || '') > (a.joinedAt || '') ? 1 : -1);
    res.json({ status: 'success', members });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});

// Team + Task Center stats. Milestones here are informational — actually
// claiming only happens via /team/milestone/claim, which recomputes both
// progress numbers itself, so nothing read here is ever trusted for payout.
app.get('/team/stats', async (req, res) => {
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const l1ActiveCount = await activeL1Count(userId);
    const l1DepositTotal = await l1TeamDeposits(userId);
    const uSnap = await db.collection('users').doc(userId).get();
    const u = uSnap.exists ? uSnap.data() : {};
    const milestones = [
      ...TEAM_MILESTONES.map(m => ({
        type: 'count', target: m.target, reward: m.reward,
        current: l1ActiveCount, achieved: l1ActiveCount >= m.target,
        claimed: !!u['milestoneClaimed_' + m.target],
      })),
      ...TEAM_DEPOSIT_MILESTONES.map(m => ({
        type: 'deposit', target: m.target, reward: m.reward,
        current: l1DepositTotal, achieved: l1DepositTotal >= m.target,
        claimed: !!u['depositMilestoneClaimed_' + m.target],
      })),
    ];
    const teamRewards = TEAM_MILESTONES.reduce((s, m) => s + (u['milestoneClaimed_' + m.target] ? m.reward : 0), 0)
                       + TEAM_DEPOSIT_MILESTONES.reduce((s, m) => s + (u['depositMilestoneClaimed_' + m.target] ? m.reward : 0), 0);
    res.json({
      status: 'success', l1ActiveCount, l1DepositTotal, milestones,
      counts: { l1: u.teamL1Count || 0, l2: u.teamL2Count || 0, l3: u.teamL3Count || 0 },
      commission: u.teamCommission || 0, teamRewards
    });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});

app.post('/team/milestone/claim', async (req, res) => {
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Please sign in again' });
  const target = Number(req.body.target);
  const isDeposit = req.body.type === 'deposit';
  const table = isDeposit ? TEAM_DEPOSIT_MILESTONES : TEAM_MILESTONES;
  const m = table.find(x => x.target === target);
  if (!m) return res.status(400).json({ status: 'error', message: 'Unknown milestone' });
  try {
    const progress = isDeposit ? await l1TeamDeposits(userId) : await activeL1Count(userId);
    if (progress < m.target) {
      const need = isDeposit ? fmtUGX(m.target) : m.target;
      const have = isDeposit ? fmtUGX(progress) : progress;
      return res.status(400).json({ status: 'error', message: `You need ${need} to claim this — you have ${have}.` });
    }
    const claimFlag = (isDeposit ? 'depositMilestoneClaimed_' : 'milestoneClaimed_') + m.target;
    let done = false;
    await withLock('milestoneclaim:' + userId + ':' + claimFlag, async () => {
      await db.runTransaction(async t => {
        const uRef = db.collection('users').doc(userId);
        const fresh = await t.get(uRef);
        if (!fresh.exists || fresh.data()[claimFlag]) return;
        const { date, time } = nowStr();
        t.update(uRef, {
          walletBalance: FieldValue.increment(m.reward),
          totalEarned: FieldValue.increment(m.reward),
          [claimFlag]: true
        });
        t.set(db.collection('transactions').doc(), {
          userId, type: 'team_reward',
          description: isDeposit ? `Task Center — level 1 team deposits ${fmtUGX(m.target)}` : `Task Center — ${m.target} active referrals`,
          amount: m.reward, milestone: m.target, status: 'success',
          date, time, createdAt: FieldValue.serverTimestamp()
        });
        done = true;
      });
    });
    if (!done) return res.status(400).json({ status: 'error', message: 'Already claimed' });
    res.json({ status: 'success', amount: m.reward, message: `${fmtUGX(m.reward)} added to your wallet` });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});

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
    dailyCheckin: s.dailyCheckin, welcomeBonus: s.welcomeBonus, commL1: s.commL1, commL2: s.commL2, commL3: s.commL3,
    returnMultiple: s.returnMultiple, cycleDays: s.cycleDays,
    maintenanceMode: !!s.maintenanceMode, maintenanceMsg: s.maintenanceMsg || ''
  } });
});
app.get('/public/products', async (_req, res) => {
  res.json({ status: 'success', products: await getProducts() });
});

// ── ACTIVITY FEED — simulated, NOT real transactions (same as Chronova's
// wireHtml()/buildActivityFeed(), explicitly the approved pattern for this
// product line). Built ONCE here, server-side, and shared by every client
// (cached ~25s) so everyone watching at the same moment sees the identical
// feed — global/synchronized is the point, not authenticity. Never swap
// this for real transaction data.
const _WIRE_STEP = 5000, _WIRE_CAP = 500000; // matches the real min-withdraw multiple/ceiling
// A broad spread of realistic deposit sizes — was previously just the raw
// product-price list (as few as 7-10 distinct numbers), so an 18-row feed
// kept reusing the same handful of amounts and visibly looked like it was
// "just rotating" instead of a real, varied stream of people topping up.
// This ladder covers the whole realistic range at the round numbers a
// mobile-money top-up actually comes in (including odd-looking-but-real
// ones like 150,000/180,000), and is unioned with the live product prices
// below so a purchase-sized deposit still shows up too.
const _DEPOSIT_LADDER = [
  10000, 15000, 20000, 25000, 30000, 35000, 40000, 45000, 50000, 60000,
  70000, 80000, 90000, 100000, 120000, 150000, 180000, 200000, 250000,
  300000, 350000, 400000, 450000, 500000, 600000, 700000, 800000, 900000, 1000000
];
// Draws a masked number never yet used in THIS batch (`used`) — plain
// Math.random() draws let the same last-4-digits show up twice in one
// 18-row feed often enough to be noticeable, which looked like the same
// "person" repeating.
function maskedMsisdn(used) {
  for (let tries = 0; tries < 50; tries++) {
    const n = '256****' + String(Math.floor(Math.random() * 10000)).padStart(4, '0');
    if (!used.has(n)) { used.add(n); return n; }
  }
  return '256****' + String(Math.floor(Math.random() * 10000)).padStart(4, '0');
}
async function buildActivityFeed() {
  let depositPool = _DEPOSIT_LADDER.slice();
  try {
    const products = await getProducts();
    const prices = products.map(p => Number(p.price)).filter(n => n > 0);
    depositPool = Array.from(new Set(depositPool.concat(prices)));
  } catch (_) {}
  const withdrawPool = [];
  for (let a = _WIRE_STEP; a <= _WIRE_CAP; a += _WIRE_STEP) withdrawPool.push(a);
  const rows = [];
  const usedNumbers = new Set();
  for (let i = 0; i < 18; i++) {
    const kind = Math.random() < 0.6 ? 'deposit' : 'withdraw';
    const pool = kind === 'deposit' ? depositPool : withdrawPool;
    rows.push({ kind, phone: maskedMsisdn(usedNumbers), amount: pool[Math.floor(Math.random() * pool.length)] });
  }
  return rows;
}
let _activityFeed = [], _activityTs = 0, _activityBuilding = false;
app.get('/public/activity-feed', async (_req, res) => {
  if (!_activityFeed.length && !_activityBuilding) {
    _activityBuilding = true;
    try { _activityFeed = await buildActivityFeed(); _activityTs = Date.now(); }
    catch (e) { console.error('Activity feed error:', e.message); }
    finally { _activityBuilding = false; }
  } else if (!_activityBuilding && Date.now() - _activityTs > 25000) {
    _activityBuilding = true;
    buildActivityFeed()
      .then(f => { _activityFeed = f; _activityTs = Date.now(); })
      .catch(e => console.error('Activity feed error:', e.message))
      .finally(() => { _activityBuilding = false; });
  }
  res.json({ status: 'success', feed: _activityFeed });
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
      const sett = await getSettings();
      const WELCOME = Number(sett.welcomeBonus) || 0;
      const update = { registrationDone: true, referralCode: myRefCode, walletBalance: FieldValue.increment(WELCOME) };
      if (referrerId) {
        update.referredBy = referrerId;
        await db.collection('users').doc(referrerId).update({ teamL1Count: FieldValue.increment(1) });
        const l1Snap = await db.collection('users').doc(referrerId).get();
        const l2Id = l1Snap.exists ? l1Snap.data().referredBy : null;
        if (l2Id && l2Id !== referrerId) await db.collection('users').doc(l2Id).update({ teamL2Count: FieldValue.increment(1) });
      }
      // The user's own doc (registrationDone + the actual wallet credit) is
      // written FIRST, in one update. If the process dies right after this,
      // the user is already fully and correctly paid and marked done — a
      // retried /register hits the registrationDone guard above and stops
      // immediately rather than re-running this block. The only possible
      // casualty of an interruption is the ledger row below never getting
      // written (cosmetic, not money) — never the reverse (a ledger row with
      // no matching credit, or a double credit from a retry).
      await userRef.update(update);
      if (WELCOME > 0) {
        const { date, time } = nowStr();
        await db.collection('transactions').add({
          userId, type: 'admin_credit', description: 'Welcome gift',
          amount: WELCOME, status: 'success', date, time, createdAt: FieldValue.serverTimestamp()
        });
      }
      res.json({ status: 'success', referrerId, welcomeBonus: WELCOME, referralCode: myRefCode });
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
      if (u.status === 'banned') return res.status(403).json({ status: 'error', message: 'Account access paused' });
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
      if (fresh.data().status === 'banned') throw new Error('Account access paused');
      const bal = fresh.data().walletBalance || 0;
      if (bal < tier.price) throw new Error(`Need ${fmtUGX(tier.price)}, have ${fmtUGX(bal)}`);
      const invRef = db.collection('investments').doc();
      invId = invRef.id;
      t.update(uRef, { walletBalance: FieldValue.increment(-tier.price), totalInvested: FieldValue.increment(tier.price) });
      const { date, time } = nowStr();
      t.set(invRef, {
        userId, tierKey: tier.key, tierLabel: tier.name, amount: tier.price, cycle, expectedReturn,
        status: 'active', dailyPayout, payoutsTotal: cycle, payoutsMade: 0, paidOut: 0,
        commissionPaidLevels: [], date, time, createdAt: FieldValue.serverTimestamp()
      });
      t.set(db.collection('transactions').doc(), {
        userId, type: 'investment', description: `Bought ${tier.name}`, amount: -tier.price,
        status: 'success', date, time, investmentId: invRef.id, createdAt: FieldValue.serverTimestamp()
      });
    }));
    creditReferralCommission(invId, userId, tier.price).catch(e => console.error('Commission error:', e.message));
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
    if (uSnap.data().status === 'banned') return res.status(403).json({ status: 'error', message: 'Account access paused' });
    if (amt < sett.minDeposit) return res.status(400).json({ status: 'error', message: `Minimum amount is ${fmtUGX(sett.minDeposit)}` });
    const phone = cleanPhone(req.body.phone || uSnap.data().phone || '');
    if (!phone || phone.length < 10) return res.status(400).json({ status: 'error', message: 'Enter a valid mobile-money phone number.' });

    // Two different references on purpose: `ref` is OUR display reference
    // (the B<timestamp> format shown to the user/Records), `marzReference`
    // is what actually goes to MarzPay's `reference` field — their API
    // requires that to be a UUID v4 for collections, so it can never be the
    // same string as our own format.
    const ref = await uniqueRef('pendingDeposits', 'B');
    const marzReference = crypto.randomUUID();
    const { date, time } = nowStr();
    const depRef = db.collection('pendingDeposits').doc();
    // The network is only ever shown back to the member/admin (which network
    // they said they were paying from) — MarzPay itself detects it from the
    // phone number, not from this field — so whitelist it rather than
    // storing whatever arbitrary string the client sends.
    const NETWORK_NAMES = new Set(['MTN Mobile Money', 'Airtel Money']);
    const network = NETWORK_NAMES.has(req.body.network) ? req.body.network : null;
    // Write BEFORE calling the gateway — marzCollect() below can trigger a
    // REAL mobile-money charge; if the process dies right after that call
    // succeeds, the doc must already exist so a reconciler can find it by
    // OUR OWN reference even without MarzPay's uuid yet.
    await depRef.set({
      userId, phone, network, amount: amt, ref, marzReference, status: 'initiating',
      date, time, createdAt: FieldValue.serverTimestamp()
    });
    // Unlike withdrawals, a thrown/timed-out call here must NOT be treated
    // as a clean failure: money hasn't moved on OUR side (nothing was
    // debited yet — deposits only credit on confirmation), but MarzPay may
    // have genuinely received and be processing the charge on THEIRS. If we
    // marked this 'failed', a customer who WAS actually charged would never
    // get credited (there's no marzTxUuid to poll against). So on a network
    // exception the record stays 'initiating' — findable later by `ref` —
    // and the user is told honestly rather than definitively "it failed".
    let mpData;
    try {
      mpData = await marzCollect({
        amount: amt, phone, reference: marzReference, description: 'ChocoMCC deposit',
        callbackUrl: PUBLIC_URL ? PUBLIC_URL + '/deposit/callback' : undefined
      });
    } catch (netErr) {
      console.error('MarzPay collect-money network error (ref ' + ref + '):', netErr.message);
      return res.status(202).json({ status: 'error',
        message: "We couldn't confirm this payment started. If your phone doesn't get a prompt shortly, try again — if you ARE charged, contact support with reference " + ref + '.' });
    }
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
    res.json({ status: 'success', depositId: depRef.id, reference: ref, message: 'Payment initiated — check your phone.' });
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
          amount: fresh.data().amount, status: 'success', date, time, ref: fresh.data().ref,
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

// MarzPay webhook. Respond 200 immediately (MarzPay retries on anything
// else, and slow processing here shouldn't hold the connection open), then
// do the real work async.
//
// FIXED BUG: this used to require a stored marzTxUuid before it would do
// ANYTHING — `if (uuid) { ...only path that credits or fails... }` with no
// else branch. Whenever the initial collect-money response didn't hand back
// a uuid (happens; MarzPay's docs don't guarantee it on every response
// shape), the deposit had NO possible path to ever resolve: the reconciler
// below also skips docs with no marzTxUuid (nothing to poll), so the record
// sat at 'pending' — shown to the user as "Processing" — forever, even
// though the customer really paid. That is the exact "successful deposit,
// no record moves off Processing" bug.
//
// Fix (mirrors Chronova's handleDepositCallback, the same product line's
// already-proven pattern): read the webhook's OWN reported status/uuid
// directly. If we already have a stored uuid, still re-confirm via a real
// GET before crediting (defense in depth against a forged callback body).
// If we don't have one yet, trust the webhook's status — but the anti-forgery
// protection isn't "require a uuid", it's "always credit OUR OWN stored
// amount, never anything from the callback body" (creditDeposit() already
// only ever reads amount off our own doc). A terminal-state doc (already
// matched/failed) is never touched again either way.
app.post('/deposit/callback', async (req, res) => {
  res.status(200).json({ status: 'ok' });
  try {
    const body = req.body || {};
    const reference = body.data?.reference || body.reference || body.data?.transaction?.reference || body.transaction?.reference;
    if (!reference) return;
    const rawStatus = String(
      body.data?.transaction?.status || body.transaction?.status || body.data?.status || body.status || ''
    ).toLowerCase();
    const isSuccess = SUCCESS_STATUSES.has(rawStatus);
    const isFailed  = FAILED_STATUSES.has(rawStatus);
    if (!isSuccess && !isFailed) return;
    // MarzPay echoes back the UUID we sent as `reference` — that's our
    // marzReference field, not the B-format display `ref`.
    const depSnap = await db.collection('pendingDeposits').where('marzReference', '==', reference).limit(1).get();
    if (depSnap.empty) return;
    const doc = depSnap.docs[0];
    const dep = doc.data();
    if (dep.status !== 'pending' && dep.status !== 'initiating') return; // already resolved — never downgrade
    // Self-heal a uuid we never captured, if the webhook body happens to
    // carry one — helps the polling reconciler on any future retry too.
    const webhookUuid = body.data?.transaction?.uuid || body.transaction?.uuid || body.data?.uuid || null;
    if (!dep.marzTxUuid && webhookUuid) doc.ref.update({ marzTxUuid: webhookUuid }).catch(() => {});
    const uuid = dep.marzTxUuid || webhookUuid;
    if (isSuccess) {
      if (uuid) {
        const marzStatus = await marzGetCollectStatus(uuid);
        if (marzStatus && !SUCCESS_STATUSES.has(marzStatus)) return; // webhook disagrees with a real re-check — don't credit
      }
      await creditDeposit(doc);
    } else if (isFailed) {
      if (uuid) {
        const marzStatus = await marzGetCollectStatus(uuid);
        if (marzStatus && !FAILED_STATUSES.has(marzStatus)) return; // a transient/ambiguous re-check — leave it pending, don't decline
      }
      await doc.ref.update({ status: 'failed', failureReason: 'Payment was not completed' }).catch(() => {});
    }
  } catch (e) {
    console.error('Deposit callback error:', e.message);
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
    // Same split as deposits: `ref` is our own display reference, `marzReference`
    // is a UUID sent to MarzPay's `reference` field (recommended UUID, max 50
    // chars per their docs — never reuse our own B-format string for it).
    const ref = await uniqueRef('withdrawals', 'B');
    const marzReference = crypto.randomUUID();
    let witId;
    await withLock('bal:' + userId, () => db.runTransaction(async t => {
      const uRef = db.collection('users').doc(userId);
      const fresh = await t.get(uRef);
      if (!fresh.exists) throw new Error('User not found');
      if (fresh.data().status === 'banned') throw new Error('Account access paused');
      const bal = fresh.data().walletBalance || 0;
      if (bal < amt) throw new Error(`Not enough balance — you have ${fmtUGX(bal)}`);
      const witRef = db.collection('withdrawals').doc();
      witId = witRef.id;
      t.update(uRef, { walletBalance: FieldValue.increment(-amt), totalWithdrawn: FieldValue.increment(net) });
      const { date, time } = nowStr();
      t.set(witRef, {
        userId, amount: amt, fee, net, holder, network, phone, ref, marzReference,
        status: 'processing', date, time, createdAt: FieldValue.serverTimestamp()
      });
      t.set(db.collection('transactions').doc(), {
        userId, type: 'withdraw', description: `Cash out to ${holder} (${network}) — net ${fmtUGX(net)} after ${sett.withdrawFeePct}% fee`,
        amount: -amt, status: 'success', date, time, ref, createdAt: FieldValue.serverTimestamp()
      });
    }));

    // The wallet is ALREADY debited above — from here on, every exit path
    // must either confirm the payout was actually sent, or refund. A plain
    // try/catch around this call (not the whole handler) means a network
    // failure/timeout talking to MarzPay is treated exactly like a clean
    // rejection below and flows through the same refund logic, instead of
    // falling into the outer catch and leaving the user debited with
    // nothing sent and no refund (a real gap this used to have).
    let mpData;
    try {
      mpData = await marzSendMoney({
        amount: net, phone, reference: marzReference, description: 'ChocoMCC cash out',
        callbackUrl: PUBLIC_URL ? PUBLIC_URL + '/withdraw/callback' : undefined
      });
    } catch (netErr) {
      console.error('MarzPay send-money network error:', netErr.message);
      mpData = { status: 'error', providerDown: true, message: netErr.message };
    }
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
    res.json({ status: 'success', withdrawalId: witId, reference: ref, net, message: `Cash-out requested — net ${fmtUGX(net)}` });
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

// Same self-heal fix as /deposit/callback — required marzTxUuid before doing
// anything at all, so a payout whose initial send-money response omitted a
// uuid could never be marked processed by this webhook. Success now goes off
// the webhook's own reported status (with a real GET re-check as a
// cross-check whenever a uuid IS available). Failure stays strict — it is
// NEVER trusted without a stored uuid and a re-check confirming it, because
// the wallet is already debited by this point; a forged "failed" webhook
// refunding a payout that actually went out would be double money leaving
// the platform.
app.post('/withdraw/callback', async (req, res) => {
  res.status(200).json({ status: 'ok' });
  try {
    const body = req.body || {};
    const reference = body.data?.reference || body.reference || body.data?.transaction?.reference || body.transaction?.reference;
    if (!reference) return;
    const rawStatus = String(
      body.data?.transaction?.status || body.transaction?.status || body.data?.status || body.status || ''
    ).toLowerCase();
    const isSuccess = SUCCESS_STATUSES.has(rawStatus);
    const isFailed  = FAILED_STATUSES.has(rawStatus);
    if (!isSuccess && !isFailed) return;
    const witSnap = await db.collection('withdrawals').where('marzReference', '==', reference).limit(1).get();
    if (witSnap.empty) return;
    const doc = witSnap.docs[0];
    const wit = doc.data();
    if (wit.status !== 'processing') return; // already resolved — never downgrade
    const webhookUuid = body.data?.transaction?.uuid || body.transaction?.uuid || body.data?.uuid || null;
    if (!wit.marzTxUuid && webhookUuid) doc.ref.update({ marzTxUuid: webhookUuid }).catch(() => {});
    const uuid = wit.marzTxUuid || webhookUuid;
    if (isSuccess) {
      if (uuid) {
        const marzStatus = await marzGetSendStatus(uuid);
        if (marzStatus && !SUCCESS_STATUSES.has(marzStatus)) return;
      }
      await doc.ref.update({ status: 'processed', processedAt: FieldValue.serverTimestamp() }).catch(() => {});
    } else if (isFailed) {
      if (!uuid) return; // nothing verifiable to re-check — leave it processing for the sweep/admin
      const marzStatus = await marzGetSendStatus(uuid);
      if (!FAILED_STATUSES.has(marzStatus)) return;
      await withLock('bal:' + wit.userId, () => db.runTransaction(async t => {
        const fresh = await t.get(doc.ref);
        if (!fresh.exists || fresh.data().status !== 'processing') return;
        const uRef = db.collection('users').doc(wit.userId);
        t.update(uRef, { walletBalance: FieldValue.increment(fresh.data().amount), totalWithdrawn: FieldValue.increment(-fresh.data().net) });
        t.update(doc.ref, { status: 'declined', failureReason: 'Payout failed at the mobile-money provider' });
      }));
    }
  } catch (e) {
    console.error('Withdraw callback error:', e.message);
  }
});

// ═══════════════════════════════════════════
// BIND BANK CARD
// ═══════════════════════════════════════════
app.post('/bank/save', async (req, res) => {
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const holder = stripHtml(req.body.holder);
  const network = req.body.network;
  const phone = cleanPhone(req.body.phone || '');
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
    // Locked per-CODE (not per user+code) — a shared multi-use code being
    // redeemed by several different users at once must still serialise
    // through one place, or two concurrent redemptions could both read the
    // same usedBy array below maxUses and both slip through.
    await withLock('redeem:' + code, async () => {
      const codeSnap = await db.collection('promoCodes').where('code', '==', code).limit(1).get();
      if (codeSnap.empty) return res.status(400).json({ status: 'error', message: "That code isn't valid" });
      const codeDoc = codeSnap.docs[0];
      const cd = codeDoc.data();
      if (cd.active === false) return res.status(400).json({ status: 'error', message: 'This code is no longer active' });
      const usedBy = cd.usedBy || [];
      if (usedBy.indexOf(userId) !== -1) return res.status(400).json({ status: 'error', message: "You've already used this code" });
      if (cd.maxUses && usedBy.length >= cd.maxUses) return res.status(400).json({ status: 'error', message: 'This code has reached its usage limit' });
      const reward = Number(cd.reward) || 0;
      await db.collection('users').doc(userId).update({ walletBalance: FieldValue.increment(reward) });
      await codeDoc.ref.update({ usedBy: FieldValue.arrayUnion(userId) });
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
    // Sort in JS after fetching, not orderBy in the query itself — same
    // pattern Chronova's equivalent endpoint (/account/transactions) uses,
    // ported here to remove any doubt about the where+orderBy+limit combo.
    const snap = await db.collection('transactions').where('userId', '==', userId).limit(300).get();
    const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    list.sort((a, b) => tsMillis(b.createdAt) - tsMillis(a.createdAt));
    res.json({ status: 'success', transactions: list.slice(0, 100) });
  } catch (e) {
    console.error('Transactions list error:', e.message);
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
    // Same pattern as Chronova's /account/deposits — fetch by userId only
    // and sort in JS, not orderBy in the Mongo query itself.
    const snap = await db.collection('pendingDeposits').where('userId', '==', userId).limit(200).get();
    const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    list.sort((a, b) => tsMillis(b.createdAt) - tsMillis(a.createdAt));
    res.json({ status: 'success', deposits: list.slice(0, 100) });
  } catch (e) {
    console.error('Deposits list error:', e.message);
    res.status(500).json({ status: 'error', message: 'Could not load your top-ups' });
  }
});
// Own cash-out history, including ones still processing/declined.
app.get('/withdrawals', async (req, res) => {
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const snap = await db.collection('withdrawals').where('userId', '==', userId).limit(200).get();
    const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    list.sort((a, b) => tsMillis(b.createdAt) - tsMillis(a.createdAt));
    res.json({ status: 'success', withdrawals: list.slice(0, 100) });
  } catch (e) {
    console.error('Withdrawals list error:', e.message);
    res.status(500).json({ status: 'error', message: 'Could not load your cash-outs' });
  }
});

// ═══════════════════════════════════════════
// ADMIN AUTH — owner master key + per-staff accounts + sessions
// ═══════════════════════════════════════════
app.post('/admin/check-key', async (req, res) => {
  const { key } = req.body;
  if (!ADMIN_KEY) return res.status(500).json({ status: 'error', message: 'Admin key not configured' });
  if (loginLocked('owner-key')) return res.status(429).json({ status: 'error', message: 'Too many attempts. Try again in 15 minutes.' });
  if (!safeEqual(key, ADMIN_KEY)) { recordLoginFail('owner-key'); return res.status(401).json({ status: 'error', message: 'Invalid key' }); }
  clearLoginFails('owner-key');
  try {
    const token = await createSession('owner', 'owner');
    res.json({ status: 'success', token, username: 'owner', role: 'owner' });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
// Per-person staff login — each of the owner's admins has their own
// username/password. Deactivating or resetting one account here never
// touches anyone else's access.
app.post('/admin/login', async (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!username || !password) return res.status(400).json({ status: 'error', message: 'Enter your username and password' });
  const lockKey = 'u:' + username;
  if (loginLocked(lockKey)) return res.status(429).json({ status: 'error', message: 'Too many attempts. Try again in 15 minutes.' });
  try {
    const snap = await db.collection('adminUsers').doc(username).get();
    if (!snap.exists || snap.data().active === false || !scryptVerify(password, snap.data().passwordHash)) {
      recordLoginFail(lockKey);
      return res.status(401).json({ status: 'error', message: 'Invalid username or password' });
    }
    clearLoginFails(lockKey);
    const token = await createSession(username, 'staff');
    db.collection('adminUsers').doc(username).update({ lastLoginAt: FieldValue.serverTimestamp() }).catch(() => {});
    res.json({ status: 'success', token, username, role: 'staff' });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/logout', async (req, res) => {
  const header = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (header) await db.collection('adminSessions').doc(header).delete().catch(() => {});
  res.json({ status: 'success' });
});

// ── ADMIN ACCOUNT MANAGEMENT (owner only) ──
app.post('/admin/admins/list', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const snap = await db.collection('adminUsers').get();
    const admins = snap.docs.map(d => {
      const v = d.data();
      return { username: d.id, active: v.active !== false, createdAt: v.createdAt || null, lastLoginAt: v.lastLoginAt || null };
    });
    res.json({ status: 'success', admins });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/admins/create', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const username = String(req.body.username || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!/^[a-z0-9._-]{3,24}$/.test(username)) return res.status(400).json({ status: 'error', message: 'Username must be 3-24 characters: letters, numbers, dot, dash, underscore' });
  if (username === 'owner') return res.status(400).json({ status: 'error', message: '"owner" is reserved for the master key' });
  if (password.length < 8) return res.status(400).json({ status: 'error', message: 'Password must be at least 8 characters' });
  try {
    const existing = await db.collection('adminUsers').doc(username).get();
    if (existing.exists) return res.status(400).json({ status: 'error', message: 'That username is already taken' });
    await db.collection('adminUsers').doc(username).set({
      passwordHash: scryptHash(password), active: true, createdAt: FieldValue.serverTimestamp(), lastLoginAt: null
    });
    logAdminAction(req, 'admin_created', { username });
    res.json({ status: 'success' });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/admins/deactivate', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const username = String(req.body.username || '').trim().toLowerCase();
  try {
    await db.collection('adminUsers').doc(username).update({ active: false });
    await invalidateSessionsFor(username);
    logAdminAction(req, 'admin_deactivated', { username });
    res.json({ status: 'success' });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/admins/reactivate', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const username = String(req.body.username || '').trim().toLowerCase();
  try {
    await db.collection('adminUsers').doc(username).update({ active: true });
    logAdminAction(req, 'admin_reactivated', { username });
    res.json({ status: 'success' });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/admins/reset-password', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const username = String(req.body.username || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (password.length < 8) return res.status(400).json({ status: 'error', message: 'Password must be at least 8 characters' });
  try {
    await db.collection('adminUsers').doc(username).update({ passwordHash: scryptHash(password) });
    await invalidateSessionsFor(username);
    logAdminAction(req, 'admin_password_reset', { username });
    res.json({ status: 'success' });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/admins/delete', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const username = String(req.body.username || '').trim().toLowerCase();
  try {
    await db.collection('adminUsers').doc(username).delete();
    await invalidateSessionsFor(username);
    logAdminAction(req, 'admin_deleted', { username });
    res.json({ status: 'success' });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/audit-log', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const snap = await db.collection('adminAuditLog').orderBy('createdAt', 'desc').limit(200).get();
    res.json({ status: 'success', log: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});

// ═══════════════════════════════════════════
// ADMIN — SETTINGS / PRODUCTS (owner only — rates and the catalogue are the
// two levers staff logins never get to touch)
// ═══════════════════════════════════════════
app.get('/admin/settings', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  res.json({ status: 'success', settings: await getSettings() });
});
app.post('/admin/settings/update', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const updates = req.body.settings || {};
    await db.collection('settings').doc('main').set(updates, { merge: true });
    _settingsCacheTs = 0;
    logAdminAction(req, 'settings_updated', { fields: Object.keys(updates) });
    res.json({ status: 'success' });
  } catch (e) {
    res.status(500).json({ status: 'error', message: 'Could not save settings' });
  }
});
app.get('/admin/products', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  res.json({ status: 'success', products: await getProducts() });
});
app.post('/admin/products/save', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const list = Array.isArray(req.body.products) ? req.body.products : [];
    const batch = db.batch();
    list.forEach((p, i) => batch.set(db.collection('products').doc(p.key), Object.assign({}, p, { order: i }), { merge: true }));
    await batch.commit();
    _productsCacheTs = 0;
    logAdminAction(req, 'products_saved', { count: list.length });
    res.json({ status: 'success' });
  } catch (e) {
    res.status(500).json({ status: 'error', message: 'Could not save products' });
  }
});

// ═══════════════════════════════════════════
// ADMIN — USERS (any admin can view; wallet credit/debit/ban/reset/delete
// are owner-only — the same class of irreversible, user-harming action as
// minting gift codes)
// ═══════════════════════════════════════════
app.post('/admin/users', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const snap = await db.collection('users').limit(10000).get();
    const users = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json({ status: 'success', users, count: users.length });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/user/detail', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ status: 'error', message: 'userId required' });
  try {
    const [snap, invSnap, txSnap] = await Promise.all([
      db.collection('users').doc(userId).get(),
      db.collection('investments').where('userId', '==', userId).limit(50).get(),
      db.collection('transactions').where('userId', '==', userId).limit(50).get(),
    ]);
    if (!snap.exists) return res.status(404).json({ status: 'error', message: 'User not found' });
    const investments = invSnap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => tsMillis(b.createdAt) - tsMillis(a.createdAt));
    const transactions = txSnap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => tsMillis(b.createdAt) - tsMillis(a.createdAt));
    res.json({ status: 'success', user: { id: snap.id, ...snap.data() }, investments, transactions });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/deposit', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const { userId, amount, note } = req.body;
  const amt = parseFloat(amount || 0);
  if (!userId || !amt) return res.status(400).json({ status: 'error', message: 'userId and amount required' });
  try {
    const { date, time } = nowStr();
    await db.runTransaction(async t => {
      const uRef = db.collection('users').doc(userId);
      const uSnap = await t.get(uRef);
      if (!uSnap.exists) throw new Error('User not found');
      t.update(uRef, { walletBalance: FieldValue.increment(amt) });
      t.set(db.collection('transactions').doc(), {
        userId, type: 'admin_credit', description: note || 'ChocoMCC credit',
        amount: amt, status: 'success', date, time, createdAt: FieldValue.serverTimestamp()
      });
    });
    logAdminAction(req, 'manual_credit', { userId, amount: amt, note });
    res.json({ status: 'success', message: `Credited ${fmtUGX(amt)}` });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/debit', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const { userId, amount, note } = req.body;
  const amt = Math.abs(parseFloat(amount || 0));
  if (!userId || !amt) return res.status(400).json({ status: 'error', message: 'userId and amount required' });
  try {
    let newBal = 0;
    const { date, time } = nowStr();
    await db.runTransaction(async t => {
      const uRef = db.collection('users').doc(userId);
      const uSnap = await t.get(uRef);
      if (!uSnap.exists) throw new Error('User not found');
      newBal = (uSnap.data().walletBalance || 0) - amt;
      t.update(uRef, { walletBalance: FieldValue.increment(-amt) });
      t.set(db.collection('transactions').doc(), {
        userId, type: 'admin_debit', description: note || 'Balance adjustment',
        amount: -amt, status: 'success', date, time, createdAt: FieldValue.serverTimestamp()
      });
    });
    logAdminAction(req, 'manual_debit', { userId, amount: amt, note });
    res.json({ status: 'success', message: `Removed ${fmtUGX(amt)}. New balance ${fmtUGX(newBal)}`, newBalance: newBal });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/ban', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const { userId, action, reason } = req.body;
  try {
    const isBan = action === 'ban';
    await db.collection('users').doc(userId).update({
      status: isBan ? 'banned' : 'active',
      banReason: isBan ? (reason || 'Policy violation') : null,
      bannedAt: isBan ? FieldValue.serverTimestamp() : null
    });
    logAdminAction(req, isBan ? 'user_banned' : 'user_unbanned', { userId, reason });
    res.json({ status: 'success' });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
// Resets a locked-out member's Firebase Auth password directly via the
// Admin SDK. The user doc id IS the Firebase uid.
app.post('/admin/user/reset-password', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const { userId, newPassword } = req.body;
  if (!userId) return res.status(400).json({ status: 'error', message: 'userId required' });
  if (!newPassword || String(newPassword).length < 6)
    return res.status(400).json({ status: 'error', message: 'New password must be at least 6 characters' });
  try {
    const snap = await db.collection('users').doc(userId).get();
    if (!snap.exists) return res.status(404).json({ status: 'error', message: 'User not found' });
    await admin.auth().updateUser(userId, { password: String(newPassword) });
    logAdminAction(req, 'user_password_reset', { userId });
    res.json({ status: 'success', message: 'Password reset', phone: snap.data().phone || '' });
  } catch (e) {
    const msg = /no user record|not.*found/i.test(e.message || '')
      ? 'No Firebase login exists for this account.' : (e.message || 'Could not reset password');
    res.status(500).json({ status: 'error', message: msg });
  }
});
// PERMANENT account deletion: removes the user and ALL their data, fixes the
// referrer's team counts up the chain, and frees the phone number in
// Firebase so it can register again. Requires confirm:"DELETE".
app.post('/admin/user/delete', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const { userId, confirm } = req.body;
  if (!userId) return res.status(400).json({ status: 'error', message: 'userId required' });
  if (confirm !== 'DELETE') return res.status(400).json({ status: 'error', message: 'Type DELETE to confirm' });
  try {
    const uSnap = await db.collection('users').doc(userId).get();
    if (!uSnap.exists) return res.status(404).json({ status: 'error', message: 'User not found' });
    const u = uSnap.data();
    try {
      if (u.referredBy) {
        await db.collection('users').doc(u.referredBy).update({ teamL1Count: FieldValue.increment(-1) });
        const l1 = await db.collection('users').doc(u.referredBy).get();
        const l2Id = l1.exists ? l1.data().referredBy : null;
        if (l2Id) {
          await db.collection('users').doc(l2Id).update({ teamL2Count: FieldValue.increment(-1) });
          const l2 = await db.collection('users').doc(l2Id).get();
          const l3Id = l2.exists ? l2.data().referredBy : null;
          if (l3Id) await db.collection('users').doc(l3Id).update({ teamL3Count: FieldValue.increment(-1) });
        }
      }
    } catch (chainErr) { console.warn('delete: team-count fix:', chainErr.message); }
    const wipe = async (coll, field = 'userId') => {
      const snap = await db.collection(coll).where(field, '==', userId).get();
      let n = 0;
      for (const d of snap.docs) { try { await d.ref.delete(); n++; } catch (_) {} }
      return n;
    };
    const removed = {
      transactions:  await wipe('transactions'),
      investments:   await wipe('investments'),
      withdrawals:   await wipe('withdrawals'),
      deposits:      await wipe('pendingDeposits'),
      bankAccounts:  await wipe('bankAccounts'),
    };
    await db.collection('users').doc(userId).delete();
    try { await admin.auth().deleteUser(userId); } catch (fbErr) { console.warn('delete: firebase auth:', fbErr.message); }
    logAdminAction(req, 'user_deleted', { userId, removed });
    res.json({ status: 'success', message: 'Account and all its data deleted', removed });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});

// ═══════════════════════════════════════════
// ADMIN — DEPOSITS / WITHDRAWALS (list + force-override for a genuinely
// stuck payment, e.g. the owner verified it landed on MarzPay's own
// dashboard but the API/webhook never confirmed it here)
// ═══════════════════════════════════════════
app.post('/admin/deposits/list', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const [snap, usersSnap] = await Promise.all([
      db.collection('pendingDeposits').orderBy('createdAt', 'desc').limit(5000).get(),
      db.collection('users').get(),
    ]);
    const phones = {}; usersSnap.forEach(u => { phones[u.id] = u.data().phone || ''; });
    const counts = {};
    const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    rows.forEach(r => { r.accountPhone = phones[r.userId] || ''; counts[r.status || 'unknown'] = (counts[r.status || 'unknown'] || 0) + 1; });
    res.json({ status: 'success', deposits: rows, counts, total: rows.length });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
// OWNER-ONLY: unlike the client's own status poll (which only credits after
// RE-CHECKING the real gateway status), this credits on the admin's own
// say-so with no independent confirmation — same risk class as manually
// crediting a wallet outright. Still routed through the same locked,
// idempotent creditDeposit() — an already-matched deposit is always a no-op.
app.post('/admin/deposit/force-credit', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const { depositId } = req.body;
  if (!depositId) return res.status(400).json({ status: 'error', message: 'depositId required' });
  try {
    const snap = await db.collection('pendingDeposits').doc(depositId).get();
    if (!snap.exists) return res.status(404).json({ status: 'error', message: 'Deposit not found' });
    if (snap.data().status === 'matched') return res.json({ status: 'success', message: 'Already credited' });
    const ok = await creditDeposit(snap);
    if (!ok) return res.status(409).json({ status: 'error', message: 'Could not credit. Try again' });
    logAdminAction(req, 'deposit_force_credited', { depositId, amount: snap.data().amount });
    res.json({ status: 'success', message: `Force-credited ${fmtUGX(snap.data().amount)} to the user` });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/withdrawals/list', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const [snap, usersSnap] = await Promise.all([
      db.collection('withdrawals').orderBy('createdAt', 'desc').limit(5000).get(),
      db.collection('users').get(),
    ]);
    const phones = {}; usersSnap.forEach(u => { phones[u.id] = u.data().phone || ''; });
    const counts = {};
    const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    rows.forEach(w => { w.accountPhone = phones[w.userId] || ''; counts[w.status] = (counts[w.status] || 0) + 1; });
    res.json({ status: 'success', withdrawals: rows, counts, total: rows.length });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
// Force-decline a still-processing withdrawal and refund it — same locked
// transaction/key as the client status-poll and reconciler refund paths, so
// this can never double-refund alongside either of them.
app.post('/admin/withdraw/reject', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const witId = String(req.body.withdrawalId || '');
  try {
    const ref = db.collection('withdrawals').doc(witId);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ status: 'error', message: 'Withdrawal not found' });
    const w = snap.data();
    if (w.status !== 'processing') return res.status(400).json({ status: 'error', message: 'Only a still-processing withdrawal can be force-declined' });
    await withLock('bal:' + w.userId, () => db.runTransaction(async t => {
      const fresh = await t.get(ref);
      if (fresh.data().status !== 'processing') return;
      const uRef = db.collection('users').doc(w.userId);
      t.update(uRef, { walletBalance: FieldValue.increment(fresh.data().amount), totalWithdrawn: FieldValue.increment(-fresh.data().net) });
      t.update(ref, { status: 'declined', failureReason: String(req.body.reason || 'Declined by admin') });
    }));
    logAdminAction(req, 'withdraw_force_declined', { withdrawalId: witId, reason: req.body.reason });
    res.json({ status: 'success' });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});

// ═══════════════════════════════════════════
// ADMIN — TRANSACTIONS / REFERRALS
// ═══════════════════════════════════════════
app.post('/admin/transactions/list', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const { userId, limit: lim } = req.body;
  try {
    if (userId) {
      const snap = await db.collection('transactions').where('userId', '==', userId).limit(100).get();
      const txs = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => tsMillis(b.createdAt) - tsMillis(a.createdAt));
      return res.json({ status: 'success', transactions: txs });
    }
    const snap = await db.collection('transactions').orderBy('createdAt', 'desc').limit(Number(lim) || 300).get();
    res.json({ status: 'success', transactions: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
// Built from the live referredBy graph — ChocoMCC has no separate
// `referrals` collection, referral links are just the field on each user.
app.post('/admin/referrals/list', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const usersSnap = await db.collection('users').limit(10000).get();
    const phones = {}; usersSnap.forEach(u => { phones[u.id] = u.data().phone || u.id; });
    const rows = [];
    usersSnap.forEach(u => {
      const d = u.data();
      if (d.referredBy) rows.push({
        referrerId: d.referredBy, referrerPhone: phones[d.referredBy] || '—',
        referredId: u.id, referredPhone: d.phone || '—',
        referredInvested: d.totalInvested || 0, createdAt: d.createdAt || null
      });
    });
    rows.sort((a, b) => tsMillis(b.createdAt) - tsMillis(a.createdAt));
    res.json({ status: 'success', referrals: rows });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});

// ═══════════════════════════════════════════
// ADMIN — PROMO / GIFT CODES (owner only — a direct money lever exactly
// like manually crediting a wallet: anyone who can mint one can redeem it
// through any personal account and withdraw the payout)
// ═══════════════════════════════════════════
function genPromoCode() { return randCode(6); }
app.post('/admin/promocodes/generate', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const { count = 1, minAmount, maxAmount, maxUses } = req.body;
  const min = Math.max(0, Math.round(parseFloat(minAmount) || 0));
  const max = Math.max(0, Math.round(parseFloat(maxAmount) || 0));
  if (!min || !max) return res.status(400).json({ status: 'error', message: 'minAmount and maxAmount required' });
  if (min > max) return res.status(400).json({ status: 'error', message: 'minAmount cannot exceed maxAmount' });
  const n = Math.min(Math.max(parseInt(count) || 1, 1), 50);
  try {
    const existingSnap = await db.collection('promoCodes').get();
    const existing = new Set(existingSnap.docs.map(d => String(d.data().code || '').toUpperCase()));
    const made = [];
    let attempts = 0;
    while (made.length < n && attempts < n * 10) {
      attempts++;
      const code = genPromoCode();
      if (existing.has(code)) continue;
      existing.add(code);
      const reward = Math.round(min + Math.random() * (max - min));
      await db.collection('promoCodes').add({
        code, reward, active: true, usedBy: [],
        maxUses: maxUses ? Math.max(1, parseInt(maxUses)) : 1,
        createdAt: FieldValue.serverTimestamp(), createdBy: req.adminUser?.username || 'owner-key'
      });
      made.push({ code, reward });
    }
    logAdminAction(req, 'promocodes_generated', { count: made.length, minAmount: min, maxAmount: max });
    res.json({ status: 'success', codes: made, count: made.length });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/promocodes/list', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const snap = await db.collection('promoCodes').orderBy('createdAt', 'desc').limit(300).get();
    res.json({ status: 'success', codes: snap.docs.map(d => ({ id: d.id, ...d.data(), usedCount: (d.data().usedBy || []).length })) });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/promocodes/deactivate', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const { codeId } = req.body;
  if (!codeId) return res.status(400).json({ status: 'error', message: 'codeId required' });
  try {
    await db.collection('promoCodes').doc(codeId).update({ active: false });
    logAdminAction(req, 'promocode_deactivated', { codeId });
    res.json({ status: 'success' });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});

// ═══════════════════════════════════════════
// ADMIN — DASHBOARD STATS / ANALYTICS / BADGES
// ═══════════════════════════════════════════
app.post('/admin/stats', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const [usersSnap, pendingWitSnap, activeInvSnap] = await Promise.all([
      db.collection('users').limit(10000).get(),
      db.collection('withdrawals').where('status', '==', 'processing').get(),
      db.collection('investments').where('status', '==', 'active').get()
    ]);
    let totalWallet = 0, totalDeposited = 0, totalWithdrawn = 0, totalInvested = 0,
        totalEarned = 0, totalCommissions = 0, referredUsers = 0, bannedUsers = 0;
    usersSnap.forEach(d => {
      const u = d.data();
      totalWallet      += u.walletBalance   || 0;
      totalDeposited   += u.totalDeposited  || 0;
      totalWithdrawn   += u.totalWithdrawn  || 0;
      totalInvested    += u.totalInvested   || 0;
      totalEarned      += u.totalEarned     || 0;
      totalCommissions += u.teamCommission  || 0;
      if (u.referredBy) referredUsers++;
      if (u.status === 'banned') bannedUsers++;
    });
    let outstandingPayout = 0;
    activeInvSnap.forEach(d => {
      const inv = d.data();
      outstandingPayout += Math.max(0, (inv.expectedReturn || 0) - (inv.paidOut || 0));
    });
    let pendingPayouts = 0;
    pendingWitSnap.forEach(d => pendingPayouts += (d.data().net || d.data().amount || 0));
    const liabilities = totalWallet + pendingPayouts + outstandingPayout;
    const healthBalance = totalDeposited - totalWithdrawn - liabilities;
    res.json({
      status: 'success', userCount: usersSnap.size, bannedUsers, referredUsers,
      totalWallet, totalDeposited, totalWithdrawn, totalInvested, totalEarned, totalCommissions,
      pendingWithdrawals: pendingWitSnap.size, pendingPayouts,
      activeInvestments: activeInvSnap.size, outstandingPayout, liabilities, healthBalance
    });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/badges', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const snap = await db.collection('withdrawals').where('status', '==', 'processing').get();
    res.json({ status: 'success', pendingWithdrawals: snap.size });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});

// ── ANALYTICS CENTRE — real-aggregate KPIs computed from the ledger: deposit/
// withdraw volumes, when users transact (by hour + morning/afternoon/evening/
// night bands), daily trend, top referrers/depositors, biggest cash-outs.
const EAT_MS = 3 * 3600000;
function eatParts(ts) {
  const d = new Date(tsMillis(ts) + EAT_MS);
  return { hour: d.getUTCHours(), day: d.toISOString().slice(0, 10) };
}
function bandOf(h) {
  if (h >= 5 && h < 12)  return 'morning';
  if (h >= 12 && h < 17) return 'afternoon';
  if (h >= 17 && h < 21) return 'evening';
  return 'night';
}
app.post('/admin/analytics', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const days = Math.min(Math.max(parseInt(req.body.days) || 30, 1), 180);
  const sinceMs = Date.now() - days * 86400000;
  try {
    const [depSnap, witSnap, usersSnap] = await Promise.all([
      db.collection('pendingDeposits').orderBy('createdAt', 'desc').limit(10000).get(),
      db.collection('withdrawals').orderBy('createdAt', 'desc').limit(10000).get(),
      db.collection('users').limit(10000).get(),
    ]);
    const byHour = Array.from({ length: 24 }, (_, h) => ({ h, depAmt: 0, depCnt: 0, witAmt: 0, witCnt: 0 }));
    const bands  = { morning: { dep: 0, wit: 0 }, afternoon: { dep: 0, wit: 0 }, evening: { dep: 0, wit: 0 }, night: { dep: 0, wit: 0 } };
    const dayMap = {};
    const ensureDay = k => (dayMap[k] = dayMap[k] || { day: k, dep: 0, wit: 0, users: 0 });

    let depAmount = 0, depCount = 0;
    depSnap.forEach(d => {
      const dep = d.data();
      if (dep.status !== 'matched') return;
      const ms = tsMillis(dep.createdAt);
      if (ms < sinceMs) return;
      const a = dep.amount || 0;
      depAmount += a; depCount++;
      const { hour, day } = eatParts(dep.createdAt);
      byHour[hour].depAmt += a; byHour[hour].depCnt++;
      bands[bandOf(hour)].dep += a;
      ensureDay(day).dep += a;
    });

    let witAmount = 0, witCount = 0;
    const bigWits = [];
    witSnap.forEach(d => {
      const w = d.data();
      if (w.status !== 'processed') return;
      const ms = tsMillis(w.createdAt);
      bigWits.push({ phone: w.phone || '', amount: w.amount || 0, when: ms });
      if (ms < sinceMs) return;
      const a = w.amount || 0;
      witAmount += a; witCount++;
      const { hour, day } = eatParts(w.createdAt);
      byHour[hour].witAmt += a; byHour[hour].witCnt++;
      bands[bandOf(hour)].wit += a;
      ensureDay(day).wit += a;
    });
    bigWits.sort((a, b) => b.amount - a.amount);

    let totalUsers = 0, newUsers = 0, activeInvestors = 0;
    const referrers = [], depositors = [];
    usersSnap.forEach(d => {
      const u = d.data(); totalUsers++;
      const ms = tsMillis(u.createdAt);
      if (ms >= sinceMs) { newUsers++; const { day } = eatParts(u.createdAt); ensureDay(day).users++; }
      if ((u.totalInvested || 0) > 0) activeInvestors++;
      if ((u.teamL1Count || 0) > 0 || (u.teamCommission || 0) > 0)
        referrers.push({ phone: u.phone || '', team: u.teamL1Count || 0, earned: u.teamCommission || 0 });
      if ((u.totalDeposited || 0) > 0) depositors.push({ phone: u.phone || '', amount: u.totalDeposited || 0 });
    });
    referrers.sort((a, b) => (b.team - a.team) || (b.earned - a.earned));
    depositors.sort((a, b) => b.amount - a.amount);

    const byDay = [];
    for (let i = days - 1; i >= 0; i--) {
      const k = new Date(Date.now() + EAT_MS - i * 86400000).toISOString().slice(0, 10);
      byDay.push(dayMap[k] || { day: k, dep: 0, wit: 0, users: 0 });
    }
    const peakDepositHour  = byHour.reduce((p, c) => c.depCnt > p.depCnt ? c : p, byHour[0]).h;
    const peakWithdrawHour = byHour.reduce((p, c) => c.witCnt > p.witCnt ? c : p, byHour[0]).h;
    const busiestBand = Object.entries(bands).reduce((p, c) => (c[1].dep + c[1].wit) > (p[1].dep + p[1].wit) ? c : p)[0];

    res.json({
      status: 'success', period: days,
      kpis: {
        depositsAmount: depAmount, depositsCount: depCount,
        withdrawalsAmount: witAmount, withdrawalsCount: witCount,
        netFlow: depAmount - witAmount, totalUsers, newUsers, activeInvestors
      },
      byHour, bands, byDay, peakDepositHour, peakWithdrawHour, busiestBand,
      topReferrers: referrers.slice(0, 10), topDepositors: depositors.slice(0, 10), biggestWithdrawals: bigWits.slice(0, 10)
    });
  } catch (e) { console.error('Analytics error:', e.message); res.status(500).json({ status: 'error', message: e.message }); }
});

// ═══════════════════════════════════════════
// PENDING-PAYMENT RECONCILER
// A deposit/withdrawal's status was previously ONLY ever updated by: (a) the
// client polling while the "Payment Initiated" screen happens to be open, or
// (b) MarzPay's webhook actually arriving. Close either screen or miss the
// webhook and the record just sat at 'pending'/'processing' forever, looking
// stuck even though MarzPay itself had long since resolved it. This sweep
// (same role as Chronova's pollPendingPayments) periodically re-checks every
// still-open record against MarzPay's own status endpoint, independent of
// whether any client is even looking.
let _sweepingDeposits = false;
async function reconcilePendingDeposits() {
  if (_sweepingDeposits) return;
  _sweepingDeposits = true;
  try {
    const snap = await db.collection('pendingDeposits').where('status', '==', 'pending').limit(50).get();
    for (const doc of snap.docs) {
      const dep = doc.data();
      if (!dep.marzTxUuid) continue;
      const marzStatus = await marzGetCollectStatus(dep.marzTxUuid);
      if (SUCCESS_STATUSES.has(marzStatus)) await creditDeposit(doc);
      else if (FAILED_STATUSES.has(marzStatus)) await doc.ref.update({ status: 'failed', failureReason: 'Payment was not completed' }).catch(() => {});
    }
    // A deposit marked 'failed' isn't necessarily really dead (same lesson as
    // Chronova's pollPendingPayments): a member who insists "I paid but never
    // got credited" is usually right that the charge cleared late — a slow
    // confirmation, a transient hiccup at the exact moment we last checked.
    // creditDeposit() already only ever refuses an already-'matched' doc, so
    // reviving a 'failed' one here is safe; this just widens the sweep to
    // recheck recent failures too, bounded to the last 48h so it can never
    // turn into hammering MarzPay with ancient history.
    const cutoffMs = Date.now() - 48 * 3600000;
    const failedSnap = await db.collection('pendingDeposits').where('status', '==', 'failed').limit(80).get();
    for (const doc of failedSnap.docs) {
      const dep = doc.data();
      if (!dep.marzTxUuid || tsMillis(dep.createdAt) < cutoffMs) continue;
      const marzStatus = await marzGetCollectStatus(dep.marzTxUuid);
      if (SUCCESS_STATUSES.has(marzStatus)) await creditDeposit(doc);
    }
  } catch (e) { console.error('Reconcile deposits error:', e.message); }
  finally { _sweepingDeposits = false; }
}
// A deposit stuck at 'initiating' with no marzTxUuid never got a usable
// response from MarzPay (the network-exception path in /deposit/marzpay
// deliberately leaves it this way rather than guessing) — there is no uuid
// to poll it with directly. This used to auto-decline it after 5 minutes,
// but that is exactly the "the server should not cancel my payment" bug:
// mobile-money approval prompts can be actioned late, and the owner
// confirmed a genuinely-late approval must still be able to settle rather
// than being force-declined by a clock. So this no longer marks anything
// failed on a timeout — it only ever resolves via truth: the webhook above
// (now self-healing even with no stored uuid) or an admin's own
// force-credit/force-decline call from the Deposits tab for a record that
// genuinely never resolves.
async function reconcilePendingWithdrawals() {
  try {
    const snap = await db.collection('withdrawals').where('status', '==', 'processing').limit(50).get();
    for (const doc of snap.docs) {
      const wit = doc.data();
      if (!wit.marzTxUuid) continue;
      const marzStatus = await marzGetSendStatus(wit.marzTxUuid);
      if (SUCCESS_STATUSES.has(marzStatus)) {
        await doc.ref.update({ status: 'processed', processedAt: FieldValue.serverTimestamp() }).catch(() => {});
      } else if (FAILED_STATUSES.has(marzStatus)) {
        await withLock('bal:' + wit.userId, () => db.runTransaction(async t => {
          const fresh = await t.get(doc.ref);
          if (!fresh.exists || fresh.data().status !== 'processing') return;
          const uRef = db.collection('users').doc(wit.userId);
          t.update(uRef, { walletBalance: FieldValue.increment(fresh.data().amount), totalWithdrawn: FieldValue.increment(-fresh.data().net) });
          t.update(doc.ref, { status: 'declined', failureReason: 'Payout failed at the mobile-money provider' });
        }));
      }
    }
  } catch (e) { console.error('Reconcile withdrawals error:', e.message); }
}
// Re-invokes commission crediting for recent purchases — safe to call
// repeatedly since creditReferralCommission() skips any level already
// marked paid. This is what actually makes referral crediting survive a
// restart: if the server died between the purchase committing and the
// commission finishing, this picks up exactly where it left off within one
// reconciler tick instead of leaving the referrer permanently unpaid.
async function reconcileCommissions() {
  try {
    const cutoff = new Date(Date.now() - 10 * 60000);
    const snap = await db.collection('investments').where('createdAt', '>', cutoff).limit(50).get();
    for (const doc of snap.docs) {
      const inv = doc.data();
      await creditReferralCommission(doc.id, inv.userId, inv.amount).catch(e => console.error('Reconcile commission error:', e.message));
    }
  } catch (e) { console.error('Reconcile commissions error:', e.message); }
}
function runReconciler() {
  reconcilePendingDeposits().then(reconcilePendingWithdrawals).then(reconcileCommissions).catch(() => {});
}

app.get('/', (_req, res) => res.json({ status: 'ok', service: 'ChocoMCC backend' }));

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || '';
if (!MONGODB_URI) { console.error('MONGODB_URI env var is required'); process.exit(1); }
connectMongo(MONGODB_URI)
  .then(() => {
    app.listen(PORT, () => console.log(`ChocoMCC backend listening on :${PORT}`));
    setInterval(runReconciler, 30 * 1000);
    setTimeout(runReconciler, 15 * 1000);
  })
  .catch(e => { console.error('Mongo connection failed:', e.message); process.exit(1); });
