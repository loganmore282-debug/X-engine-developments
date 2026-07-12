const express    = require('express');
const admin      = require('firebase-admin');
const cors       = require('cors');
const crypto     = require('crypto');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');
if (!globalThis.fetch) { globalThis.fetch = (...a) => import('node-fetch').then(m => m.default(...a)); }

// ── GLOBAL ERROR SAFETY NET ──
process.on('unhandledRejection', (reason) => console.error('Unhandled rejection:', reason));
process.on('uncaughtException',  (err)    => { console.error('Uncaught exception:', err); process.exit(1); });

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
['/checkin', '/withdraw/request', '/invest/create', '/invest/claim', '/deposit/marzpay', '/redeem']
  .forEach(p => app.use(p, apiLimiter));

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

// ── CONFIG (owner-set, locked in) ──
const ADMIN_KEY        = process.env.ADMIN_KEY        || '';
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY || '';
if (!FIREBASE_API_KEY) { console.error('FIREBASE_API_KEY env var is required'); process.exit(1); }
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
const RETURN_MULTIPLE  = 2.5;     // payout = price * RETURN_MULTIPLE, paid in full at maturity
const CYCLE_DAYS       = 5;       // every tier's daily figure lands on a whole number at 2.5x

// Gem tier ladder — prices distinct from Voltra's energy-asset ladder.
const GEM_TIERS = [
  { key: 'quartz',   label: 'Quartz',   price:   25000 },
  { key: 'amethyst', label: 'Amethyst', price:   75000 },
  { key: 'topaz',    label: 'Topaz',    price:  200000 },
  { key: 'emerald',  label: 'Emerald',  price:  450000 },
  { key: 'sapphire', label: 'Sapphire', price:  800000 },
  { key: 'diamond',  label: 'Diamond',  price: 1200000 },
].map(t => {
  const expectedReturn = Math.round(t.price * RETURN_MULTIPLE);
  return { ...t, cycle: CYCLE_DAYS, expectedReturn, dailyReturn: expectedReturn / CYCLE_DAYS };
});
function findGemTier(key) { return GEM_TIERS.find(t => t.key === key) || null; }

// ── UUID v4 generator ──
function uuidv4() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// ── MarzPay API helpers ──
const MARZ_TIMEOUT = 20000; // 20 s — abort any hung MarzPay call
const PROVIDER_BUSY_MSG = 'The mobile-money service is temporarily busy. Please wait a moment and try again.';
async function _marzParse(resp) {
  try { return await resp.json(); }
  catch (_) { return { status: 'error', message: PROVIDER_BUSY_MSG, providerDown: true }; }
}
function marzUserMsg(mp, fallback) {
  const raw = String((mp && mp.message) || '');
  if ((mp && (mp.providerDown || mp.error_code === 'DATABASE_ERROR')) ||
      /database error|internal server|server error|try again later|temporarily/i.test(raw))
    return PROVIDER_BUSY_MSG;
  return raw || fallback || PROVIDER_BUSY_MSG;
}
async function marzCollect({ amount, phone, reference, description, callbackUrl }) {
  const payload = { amount: Number(amount), phone_number: phone, country: 'UG', reference,
    description: description || 'Deposit' };
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
    description: description || 'Payout' };
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
      signal: AbortSignal.timeout(MARZ_TIMEOUT),
      headers: { 'Authorization': `Basic ${MARZPAY_KEY}` }
    });
    const d = await resp.json();
    return String(d?.data?.transaction?.status || d?.transaction?.status || d?.status || '').toLowerCase();
  } catch (_) { return ''; }
}
async function marzGetStatus(uuid) {
  try {
    const resp = await fetch(`${MARZPAY_BASE}/send-money/${uuid}`, {
      signal: AbortSignal.timeout(MARZ_TIMEOUT),
      headers: { 'Authorization': `Basic ${MARZPAY_KEY}` }
    });
    const d = await resp.json();
    return String(d?.data?.transaction?.status || d?.transaction?.status || d?.status || '').toLowerCase();
  } catch (_) { return ''; }
}

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
function verifyAdmin(req) {
  if (!ADMIN_KEY) return false;
  const header = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (header && header === ADMIN_KEY) return true;
  return req.body?.adminKey === ADMIN_KEY;
}

// Milliseconds from any timestamp shape (Date, ISO string, {seconds}).
function tsMillis(v) {
  if (!v) return 0;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v.toDate === 'function')   return v.toDate().getTime();
  if (typeof v === 'object' && v.seconds != null) return v.seconds * 1000;
  const t = new Date(v).getTime();
  return isNaN(t) ? 0 : t;
}

// ── COMMISSION CHAIN — fires once per investment (dedup via commPaid_<invId> flag) ──
async function payCommissions(investorId, amount, investmentId) {
  const { date, time } = nowStr();
  try {
    const [invSnap, sett] = await Promise.all([
      db.collection('users').doc(investorId).get(),
      getSettings()
    ]);
    if (!invSnap.exists) return;
    const investor = invSnap.data();
    const l1Id = investor.referredBy;
    const seen = new Set([investorId]);
    if (!l1Id || seen.has(l1Id)) return;
    seen.add(l1Id);

    const commL1 = sett.commL1 ?? COMM_L1;
    const commL2 = sett.commL2 ?? COMM_L2;
    const commL3 = sett.commL3 ?? COMM_L3;
    const dedupFlag = `commPaid_${investmentId}`;

    const l1Snap = await db.collection('users').doc(l1Id).get();
    if (!l1Snap.exists) return;
    const l1Amt = Math.round(amount * commL1);
    if (l1Amt > 0 && !l1Snap.data()[dedupFlag]) {
      await db.runTransaction(async t => {
        const ref = db.collection('users').doc(l1Id);
        const f   = await t.get(ref);
        if (f.data()[dedupFlag]) return;
        t.update(ref, {
          walletBalance:      FieldValue.increment(l1Amt),
          commissionEarned:   FieldValue.increment(l1Amt),
          commissionL1Earned: FieldValue.increment(l1Amt),
          [dedupFlag]:        true
        });
        t.set(db.collection('transactions').doc(), {
          userId: l1Id, type: 'commission',
          description: `Level 1 referral bonus (${Math.round(commL1*100)}%) — ${investor.name || investor.phone} bought ${fmtUGX(amount)}`,
          amount: l1Amt, level: 1, fromUserId: investorId, investmentId, status: 'success',
          date, time, createdAt: FieldValue.serverTimestamp()
        });
      });
    }

    const l2Id = l1Snap.data().referredBy;
    if (!l2Id || seen.has(l2Id)) return;
    seen.add(l2Id);
    const l2Snap = await db.collection('users').doc(l2Id).get();
    if (!l2Snap.exists) return;
    const l2Amt = Math.round(amount * commL2);
    if (l2Amt > 0 && !l2Snap.data()[dedupFlag]) {
      await db.runTransaction(async t => {
        const ref = db.collection('users').doc(l2Id);
        const f   = await t.get(ref);
        if (f.data()[dedupFlag]) return;
        t.update(ref, {
          walletBalance:      FieldValue.increment(l2Amt),
          commissionEarned:   FieldValue.increment(l2Amt),
          commissionL2Earned: FieldValue.increment(l2Amt),
          [dedupFlag]:        true
        });
        t.set(db.collection('transactions').doc(), {
          userId: l2Id, type: 'commission',
          description: `Level 2 referral bonus (${Math.round(commL2*100)}%) — ${investor.name || investor.phone} bought ${fmtUGX(amount)}`,
          amount: l2Amt, level: 2, fromUserId: investorId, investmentId, status: 'success',
          date, time, createdAt: FieldValue.serverTimestamp()
        });
      });
    }

    const l3Id = l2Snap.data().referredBy;
    if (!l3Id || seen.has(l3Id)) return;
    const l3Snap = await db.collection('users').doc(l3Id).get();
    if (!l3Snap.exists) return;
    const l3Amt = Math.round(amount * commL3);
    if (l3Amt > 0 && !l3Snap.data()[dedupFlag]) {
      await db.runTransaction(async t => {
        const ref = db.collection('users').doc(l3Id);
        const f   = await t.get(ref);
        if (f.data()[dedupFlag]) return;
        t.update(ref, {
          walletBalance:      FieldValue.increment(l3Amt),
          commissionEarned:   FieldValue.increment(l3Amt),
          commissionL3Earned: FieldValue.increment(l3Amt),
          [dedupFlag]:        true
        });
        t.set(db.collection('transactions').doc(), {
          userId: l3Id, type: 'commission',
          description: `Level 3 referral bonus (${Math.round(commL3*100)}%) — ${investor.name || investor.phone} bought ${fmtUGX(amount)}`,
          amount: l3Amt, level: 3, fromUserId: investorId, investmentId, status: 'success',
          date, time, createdAt: FieldValue.serverTimestamp()
        });
      });
    }
  } catch (e) { console.error('Commission error:', e.message); }
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
    announcement: {
      enabled:  !!s.annEnabled,
      // A content version so the app can re-show the popup after an edit
      // (hash of the shown fields; changes whenever the admin edits any of them).
      version:  s.annVersion || 0,
      title:    s.annTitle    || 'Notice',
      body:     s.annBody     || '',
      ctaLabel: s.annCtaLabel || '',
      ctaUrl:   s.annCtaUrl    || '',
    },
  });
});

app.get('/products', async (_req, res) => {
  res.json({ status: 'success', products: GEM_TIERS });
});

// ── USERNAMES ──
// A user's username IS their referral code. Rules: 3–16 chars, letters/
// numbers/underscore only. Matching is case-insensitive (stored lowercased in
// usernameLower); the original casing is kept for display.
function normalizeUsername(raw) {
  const v = String(raw || '').trim();
  if (!/^[a-zA-Z0-9_]{3,16}$/.test(v)) return { ok: false, error: 'Username must be 3–16 letters, numbers or underscore.' };
  return { ok: true, value: v, lower: v.toLowerCase() };
}
async function usernameTaken(lower, exceptUid) {
  const snap = await db.collection('users').where('usernameLower', '==', lower).limit(1).get();
  if (snap.empty) return false;
  return snap.docs[0].id !== exceptUid;
}

// Live availability check used by the register screen (public, rate-limited by /auth/).
app.post('/auth/check-username', async (req, res) => {
  const norm = normalizeUsername(req.body.username);
  if (!norm.ok) return res.json({ status: 'success', available: false, reason: norm.error });
  try {
    const taken = await usernameTaken(norm.lower, null);
    return res.json({ status: 'success', available: !taken, reason: taken ? 'That username is taken.' : '' });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
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
  const { username, phone } = req.body;
  if (!username || !phone) return res.status(400).json({ status: 'error', message: 'username and phone required' });
  const norm = normalizeUsername(username);
  if (!norm.ok) return res.status(400).json({ status: 'error', message: norm.error, field: 'username' });
  try {
    const ref  = db.collection('users').doc(uid);
    const snap = await ref.get();
    // Already provisioned (idempotent retry) — keep the existing username.
    if (snap.exists && snap.data().username) return res.json({ status: 'success', message: 'Profile ensured', username: snap.data().username });

    // Authoritative uniqueness check (case-insensitive). A live check runs on the
    // client first, so this only catches the rare race.
    if (await usernameTaken(norm.lower, uid))
      return res.status(409).json({ status: 'error', message: 'That username is taken.', field: 'username' });

    const base = {
      username: norm.value, usernameLower: norm.lower, referralCode: norm.value,
      phone: cleanPhone(phone), email: phoneToEmail(phone),
    };
    if (snap.exists) {
      await ref.update(base);
    } else {
      await ref.set({
        ...base,
        walletBalance: 0, totalDeposited: 0, totalInvested: 0, totalWithdrawn: 0,
        totalEarned: 0, commissionEarned: 0, commissionL1Earned: 0,
        commissionL2Earned: 0, commissionL3Earned: 0,
        teamL1Count: 0, teamL2Count: 0, teamL3Count: 0,
        checkinEarned: 0, checkinStreak: 0, checkinDays: 0,
        withdrawalCount: 0, status: 'active',
        bankAccounts: [], createdAt: FieldValue.serverTimestamp()
      });
    }
    return res.json({ status: 'success', username: norm.value });
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

    // The referral a new user enters is a referrer's USERNAME. Match case-insensitively.
    let referrerId = null;
    if (referralCode) {
      const wanted = String(referralCode).trim().toLowerCase();
      let refSnap = await db.collection('users').where('usernameLower', '==', wanted).limit(1).get();
      if (refSnap.empty) // fall back to legacy referralCode field for any pre-username accounts
        refSnap = await db.collection('users').where('referralCode', '==', String(referralCode).trim()).limit(1).get();
      if (!refSnap.empty && refSnap.docs[0].id !== userId) referrerId = refSnap.docs[0].id;
    }

    // A user's referral code is their username (set at profile creation); fall back
    // to a random code only for any legacy account with no username.
    const myRefCode = userSnap.data().referralCode || userSnap.data().username || await generateUniqueRefCode();
    const s = await getSettings();
    const WELCOME = s.welcomeBonus ?? WELCOME_BONUS;
    const { date, time } = nowStr();
    const batch = db.batch();
    const update = { registrationDone: true, referralCode: myRefCode, walletBalance: FieldValue.increment(WELCOME) };

    batch.set(db.collection('transactions').doc(), {
      userId, type: 'admin_credit', description: 'Welcome gift',
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

// ═══════════════════════════════════════════
// TEAM — direct referrals only (own team, no client-supplied id)
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
        id: doc.id,
        name: d.username || d.name || 'User',
        phone: d.phone || '',
        joinedAt: d.createdAt ? new Date(tsMillis(d.createdAt)).toISOString() : null,
        hasInvested: (d.totalInvested || 0) > 0,
        totalInvested: d.totalInvested || 0,
        referralCode: d.referralCode || d.username || null,
      });
    });
    members.sort((a, b) => (b.joinedAt || '') > (a.joinedAt || '') ? 1 : -1);
    return res.json({ status: 'success', members });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});

// ═══════════════════════════════════════════
// INVESTMENTS — buy a gem tier, paid out in full at maturity (no daily drip)
// ═══════════════════════════════════════════
app.post('/invest/create', async (req, res) => {
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Please sign in again' });
  const { tierKey } = req.body;
  const tier = findGemTier(tierKey);
  if (!tier) return res.status(400).json({ status: 'error', message: 'Unknown gem tier' });
  try {
    const uSnap = await db.collection('users').doc(userId).get();
    if (!uSnap.exists) return res.status(404).json({ status: 'error', message: 'User not found' });
    const user = uSnap.data();
    if (user.status === 'banned') return res.status(403).json({ status: 'error', message: 'Account suspended' });
    if ((user.walletBalance || 0) < tier.price)
      return res.status(400).json({ status: 'error', message: `Need ${fmtUGX(tier.price)}, have ${fmtUGX(user.walletBalance || 0)}` });

    const { date, time } = nowStr();
    const matDate = new Date();
    matDate.setDate(matDate.getDate() + tier.cycle);
    let invId;
    await db.runTransaction(async t => {
      const uRef  = db.collection('users').doc(userId);
      const fresh = await t.get(uRef);
      const bal   = fresh.data().walletBalance || 0;
      if (bal < tier.price) throw new Error(`Need ${fmtUGX(tier.price)}, have ${fmtUGX(bal)}`);
      const invRef = db.collection('investments').doc();
      invId = invRef.id;
      t.update(uRef, { walletBalance: bal - tier.price, totalInvested: FieldValue.increment(tier.price) });
      t.set(invRef, {
        userId, tierKey: tier.key, tierLabel: tier.label,
        amount: tier.price, cycle: tier.cycle, expectedReturn: tier.expectedReturn,
        status: 'active', maturityDate: matDate,
        date, time, createdAt: FieldValue.serverTimestamp()
      });
      t.set(db.collection('transactions').doc(), {
        userId, type: 'investment', description: `Purchased ${tier.label}`,
        amount: -tier.price, status: 'success', date, time,
        investmentId: invRef.id, tierKey: tier.key, createdAt: FieldValue.serverTimestamp()
      });
    });
    payCommissions(userId, tier.price, invId).catch(e => console.error('Commission err:', e.message));
    return res.json({ status: 'success', investmentId: invId, message: `Bought ${tier.label} for ${fmtUGX(tier.price)}` });
  } catch (e) {
    console.error('Invest error:', e.message);
    return res.status(400).json({ status: 'error', message: e.message });
  }
});

// ── MATURITY CRON — auto-credit the full expected return the instant a gem matures ──
let _maturityRunning = false;
async function runMaturityCheck() {
  if (_maturityRunning) return 0;
  _maturityRunning = true;
  try {
    const snap = await db.collection('investments').where('status', '==', 'active').get();
    if (snap.empty) return 0;
    const now = new Date();
    let count = 0;
    for (const doc of snap.docs) {
      const inv = doc.data();
      const matMs = tsMillis(inv.maturityDate); const mat = matMs ? new Date(matMs) : null;
      if (!(mat && mat <= now)) continue;
      const payout = inv.expectedReturn || 0;
      const { date, time } = nowStr();
      try {
        await db.runTransaction(async t => {
          const fresh = await t.get(doc.ref);
          if (!fresh.exists || fresh.data().status !== 'active') return;
          t.update(doc.ref, { status: 'matured', maturedAt: FieldValue.serverTimestamp() });
          if (payout > 0) {
            t.update(db.collection('users').doc(inv.userId), {
              walletBalance: FieldValue.increment(payout),
              totalEarned:   FieldValue.increment(payout)
            });
            t.set(db.collection('transactions').doc(), {
              userId: inv.userId, type: 'gem_payout',
              description: `Gem payout — ${inv.tierLabel || 'Gem'}`,
              amount: payout, status: 'success', date, time, investmentId: doc.id,
              createdAt: FieldValue.serverTimestamp()
            });
          }
        });
        count++;
      } catch (e) { console.error('Maturity credit error:', doc.id, e.message); }
    }
    return count;
  } catch (e) { console.error('Maturity check error:', e.message); return 0; }
  finally { _maturityRunning = false; }
}
function startCrons() {
  setInterval(runMaturityCheck, 15 * 60 * 1000);
  setTimeout(runMaturityCheck, 60 * 1000);
  console.log('Crons started (maturity check every 15m)');
}
app.post('/admin/check-maturities', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error' });
  const matured = await runMaturityCheck();
  return res.json({ status: 'success', matured });
});

// ═══════════════════════════════════════════
// CHECK-IN
// ═══════════════════════════════════════════
app.post('/checkin', async (req, res) => {
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Please sign in again' });
  try {
    const sett  = await getSettings();
    const bonus = sett.checkinBonus ?? CHECKIN_BONUS;
    const uRef  = db.collection('users').doc(userId);
    const uSnap = await uRef.get();
    if (!uSnap.exists) return res.status(404).json({ status: 'error', message: 'User not found' });
    const user = uSnap.data();
    if (user.status === 'banned') return res.status(403).json({ status: 'error', message: 'Account suspended' });
    const today = eatNow();
    const todayKey = today.toISOString().slice(0, 10);
    const yesterdayKey = new Date(today.getTime() - 86400000).toISOString().slice(0, 10);
    if (user.lastCheckinDate === todayKey)
      return res.status(400).json({ status: 'error', message: 'Already checked in today', alreadyDone: true });
    const newStreak = user.lastCheckinDate === yesterdayKey ? (user.checkinStreak || 0) + 1 : 1;
    const { date, time } = nowStr();
    await db.runTransaction(async t => {
      const fresh = await t.get(uRef);
      if (fresh.data().lastCheckinDate === todayKey) throw new Error('ALREADY_DONE');
      t.update(uRef, {
        walletBalance:   FieldValue.increment(bonus),
        lastCheckinDate: todayKey, checkinStreak: newStreak,
        checkinDays:     FieldValue.increment(1),
        checkinEarned:   FieldValue.increment(bonus)
      });
      t.set(db.collection('transactions').doc(), {
        userId, type: 'checkin', description: `Daily bonus — Day ${newStreak}`,
        amount: bonus, status: 'success', date, time, createdAt: FieldValue.serverTimestamp()
      });
    });
    return res.json({ status: 'success', bonus, streak: newStreak, message: `${fmtUGX(bonus)} credited` });
  } catch (e) {
    if (e.message === 'ALREADY_DONE')
      return res.status(400).json({ status: 'error', message: 'Already checked in today', alreadyDone: true });
    return res.status(500).json({ status: 'error', message: e.message });
  }
});

// ═══════════════════════════════════════════
// REDEMPTION CODES — admin generates a code worth a fixed amount; each user
// redeems it once. Distinct from Voltra's random-range gift codes: a Furagemz
// code carries its own fixed `amount`, set when the admin creates it.
// ═══════════════════════════════════════════
function genCode() { return randChars(6); } // e.g. K7M2QP — unambiguous charset
const _codeRateMap   = new Map();  // userId -> last attempt ts
const _redeemingCodes = new Set(); // code doc id -> being redeemed (single-writer)

app.post('/redeem', async (req, res) => {
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Please sign in again' });
  const { code } = req.body;
  if (!code) return res.status(400).json({ status: 'error', message: 'Enter a code' });
  const lastTry = _codeRateMap.get(userId) || 0;
  if (Date.now() - lastTry < 8000)
    return res.status(429).json({ status: 'error', message: 'Too many attempts. Wait a moment.' });
  _codeRateMap.set(userId, Date.now());
  try {
    const snap = await db.collection('redemptionCodes').where('code', '==', code.toUpperCase().trim()).limit(1).get();
    if (snap.empty) return res.status(404).json({ status: 'error', message: 'Invalid code' });
    const doc = snap.docs[0], d = doc.data();
    if (!d.active) return res.status(400).json({ status: 'error', message: 'This code is no longer active' });
    if ((d.usedBy || []).includes(userId)) return res.status(400).json({ status: 'error', message: 'You have already redeemed this code' });
    if (d.maxUsers && (d.usedBy || []).length >= d.maxUsers) return res.status(400).json({ status: 'error', message: 'This code has reached its usage limit' });
    if (d.expiresAt && new Date(tsMillis(d.expiresAt)) < new Date()) return res.status(400).json({ status: 'error', message: 'This code has expired' });
    if (_redeemingCodes.has(doc.id))
      return res.status(429).json({ status: 'error', message: 'This code is being processed — try again in a moment.' });
    _redeemingCodes.add(doc.id);
    try {
      const amount = Math.max(0, Math.round(d.amount || 0));
      const { date, time } = nowStr();
      let err = null, ok = false;
      await db.runTransaction(async t => {
        const fresh = await t.get(doc.ref);
        if (!fresh.exists) { err = 'Invalid code'; return; }
        const fd = fresh.data();
        if (!fd.active) { err = 'This code is no longer active'; return; }
        if ((fd.usedBy || []).includes(userId)) { err = 'You have already redeemed this code'; return; }
        if (fd.maxUsers && (fd.usedBy || []).length >= fd.maxUsers) { err = 'This code has reached its usage limit'; return; }
        const uRef = db.collection('users').doc(userId);
        const uSnap = await t.get(uRef);
        if (!uSnap.exists) { err = 'User not found'; return; }
        t.update(uRef, { walletBalance: FieldValue.increment(amount) });
        t.update(doc.ref, { usedBy: FieldValue.arrayUnion(userId) });
        t.set(db.collection('transactions').doc(), {
          userId, type: 'redeem', description: `Code redeemed — ${code.toUpperCase()}`,
          amount, status: 'success', code: code.toUpperCase(), date, time,
          createdAt: FieldValue.serverTimestamp()
        });
        ok = true;
      });
      if (!ok) return res.status(400).json({ status: 'error', message: err || 'Could not redeem this code' });
      return res.json({ status: 'success', amount, message: `${fmtUGX(amount)} added to your wallet` });
    } finally { _redeemingCodes.delete(doc.id); }
  } catch (e) {
    console.error('Redeem error:', e.message);
    return res.status(500).json({ status: 'error', message: e.message });
  }
});

app.post('/admin/codes/generate', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const { count = 1, amount, expiresInDays, maxUsers } = req.body;
  const amt = Math.max(0, Math.round(parseFloat(amount) || 0));
  if (!amt) return res.status(400).json({ status: 'error', message: 'amount required' });
  const n = Math.min(Math.max(parseInt(count) || 1, 1), 50);
  try {
    const existingSnap = await db.collection('redemptionCodes').select('code').get();
    const existing = new Set(existingSnap.docs.map(d => d.data().code));
    const made = [];
    const batch = db.batch();
    const expiresAt = expiresInDays ? new Date(Date.now() + Number(expiresInDays) * 86400000) : null;
    let attempts = 0;
    while (made.length < n && attempts < n * 10) {
      attempts++;
      const code = genCode();
      if (existing.has(code) || made.includes(code)) continue;
      made.push(code); existing.add(code);
      const docData = { code, amount: amt, active: true, usedBy: [],
        maxUsers: maxUsers ? Math.max(1, parseInt(maxUsers)) : null, createdAt: FieldValue.serverTimestamp() };
      if (expiresAt) docData.expiresAt = expiresAt;
      batch.set(db.collection('redemptionCodes').doc(), docData);
    }
    await batch.commit();
    return res.json({ status: 'success', codes: made, count: made.length, amount: amt });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/codes/list', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const snap = await db.collection('redemptionCodes').orderBy('createdAt', 'desc').limit(200).get();
    return res.json({ status: 'success', codes: snap.docs.map(d => ({ id: d.id, ...d.data(), usedCount: (d.data().usedBy || []).length })) });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/codes/deactivate', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const { codeId } = req.body;
  if (!codeId) return res.status(400).json({ status: 'error', message: 'codeId required' });
  try {
    await db.collection('redemptionCodes').doc(codeId).update({ active: false });
    return res.json({ status: 'success' });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});

// ═══════════════════════════════════════════
// DEPOSIT — MarzPay collection
// ═══════════════════════════════════════════
const _depCreateDebounce = new Map();
const _creditingDeposits = new Set();
async function creditMarzDeposit(depDoc, amount, provTxId) {
  const dep = depDoc.data();
  if (dep.status === 'matched' || dep.status === 'failed') return false;
  // M0 has NO atomic transactions — serialise per-deposit in-process so a webhook
  // firing alongside a status-poll can never both credit the same deposit.
  if (_creditingDeposits.has(depDoc.id)) return false;
  _creditingDeposits.add(depDoc.id);
  try {
    const { date, time } = nowStr();
    let didCredit = false;
    await db.runTransaction(async t => {
      const fresh = await t.get(depDoc.ref);
      if (!fresh.exists) return;
      if (fresh.data().status === 'matched' || fresh.data().status === 'failed') return;
      const uRef = db.collection('users').doc(dep.userId);
      t.update(uRef, {
        walletBalance:  FieldValue.increment(amount),
        totalDeposited: FieldValue.increment(amount)
      });
      t.update(depDoc.ref, {
        status: 'matched', creditedAmount: amount,
        providerTxId: provTxId || null, matchedAt: FieldValue.serverTimestamp()
      });
      t.set(db.collection('transactions').doc(), {
        userId: dep.userId, type: 'topup', description: 'Wallet top-up',
        amount, status: 'success', date, time, marzReference: dep.marzReference,
        createdAt: FieldValue.serverTimestamp()
      });
      didCredit = true;
    });
    return didCredit;
  } finally { _creditingDeposits.delete(depDoc.id); }
}
async function pollMarzDepositStatus(depDoc) {
  const dep = depDoc.data();
  const uuid = dep.marzTxUuid;
  if (!uuid || !MARZPAY_KEY) return { credited: false, failed: false };
  const rawStatus = await marzGetCollectStatus(uuid);
  const isSuccess = ['completed', 'successful', 'success', 'paid'].includes(rawStatus);
  const isFailed  = ['failed', 'cancelled', 'error', 'declined'].includes(rawStatus);
  if (isSuccess) {
    const creditAmount = dep.amount;
    await creditMarzDeposit(depDoc, creditAmount, null);
    return { credited: true, failed: false, amount: creditAmount };
  }
  if (isFailed) {
    if (dep.status !== 'failed') await depDoc.ref.update({ status: 'failed',
      failedAt: FieldValue.serverTimestamp(), failureReason: 'Payment failed or cancelled' });
    return { credited: false, failed: true };
  }
  return { credited: false, failed: false };
}
app.post('/deposit/marzpay', async (req, res) => {
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Please sign in again' });
  const { amount, phone: rawPhone } = req.body;
  const amt = parseInt(amount, 10);
  if (isNaN(amt) || amt <= 0) return res.status(400).json({ status: 'error', message: 'Invalid amount' });
  const lastDep = _depCreateDebounce.get(userId) || 0;
  if (Date.now() - lastDep < 7000)
    return res.status(429).json({ status: 'error', message: 'A deposit is already being processed. Please wait a moment.' });
  _depCreateDebounce.set(userId, Date.now());
  try {
    const [uSnap, sett] = await Promise.all([db.collection('users').doc(userId).get(), getSettings()]);
    if (!uSnap.exists) return res.status(404).json({ status: 'error', message: 'User not found' });
    const user = uSnap.data();
    if (user.status === 'banned') return res.status(403).json({ status: 'error', message: 'Account suspended' });
    const minDep = sett.minDeposit ?? MIN_DEPOSIT;
    if (amt < minDep) return res.status(400).json({ status: 'error', message: `Minimum deposit is ${fmtUGX(minDep)}` });

    const phone = cleanPhone(rawPhone || user.phone || '');
    if (!phone || phone.length < 10)
      return res.status(400).json({ status: 'error', message: 'Enter a valid mobile-money phone number.' });

    const reference = uuidv4();
    const mpData = await marzCollect({
      amount: amt, phone, reference, description: user.name || userId,
      callbackUrl: RAILWAY_URL ? RAILWAY_URL + '/deposit/callback' : undefined
    });
    const isSandbox = mpData.status === 'sandbox' || mpData.data?.collection?.mode === 'sandbox';
    if (mpData.status !== 'success' && !isSandbox)
      return res.status(400).json({ status: 'error', message: marzUserMsg(mpData, 'Could not start the payment right now. Please try again.') });

    const marzTxUuid = mpData.data?.transaction?.uuid || null;
    const { date, time } = nowStr();
    const depRef = db.collection('pendingDeposits').doc();

    if (isSandbox) {
      await db.runTransaction(async t => {
        const uRef  = db.collection('users').doc(userId);
        const uSnap2 = await t.get(uRef);
        if (!uSnap2.exists) throw new Error('User not found');
        t.update(uRef, { walletBalance: FieldValue.increment(amt), totalDeposited: FieldValue.increment(amt) });
        t.set(depRef, {
          userId, phone, amount: amt, creditedAmount: amt,
          marzReference: reference, marzTxUuid, status: 'matched', date, time,
          matchedAt: FieldValue.serverTimestamp(), createdAt: FieldValue.serverTimestamp()
        });
        t.set(db.collection('transactions').doc(), {
          userId, type: 'topup', description: 'Wallet top-up',
          amount: amt, status: 'success', date, time, marzReference: reference,
          createdAt: FieldValue.serverTimestamp()
        });
      });
    } else {
      await depRef.set({
        userId, phone, amount: amt, marzReference: reference, marzTxUuid,
        status: 'processing', date, time, createdAt: FieldValue.serverTimestamp()
      });
    }
    return res.json({ status: 'success', depositId: depRef.id, amount: amt, phone, sandbox: isSandbox });
  } catch (e) {
    console.error('Deposit error:', e.message);
    const friendly = /abort|timeout|fetch failed|network|ENOTFOUND|ECONN|Unexpected token|JSON/i.test(e.message || '')
      ? PROVIDER_BUSY_MSG : (e.message || 'Could not start the payment');
    return res.status(500).json({ status: 'error', message: friendly });
  }
});
app.get('/deposit/status/:id', async (req, res) => {
  try {
    const snap = await db.collection('pendingDeposits').doc(req.params.id).get();
    if (!snap.exists) return res.status(404).json({ status: 'error', message: 'Not found' });
    let dep = snap.data();
    if (dep.status === 'processing') {
      try {
        const result = await pollMarzDepositStatus(snap);
        if (result.credited || result.failed) {
          const fresh = await db.collection('pendingDeposits').doc(snap.id).get();
          dep = fresh.data();
        }
      } catch (pollErr) { console.warn('MarzPay poll error:', pollErr.message); }
    }
    return res.json({
      status: 'success',
      deposit: { id: snap.id, depositStatus: dep.status, amount: dep.amount, creditedAmount: dep.creditedAmount || dep.amount }
    });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});
async function handleDepositCallback(req, res) {
  res.status(200).json({ received: true });
  setImmediate(async () => {
    const body = req.body;
    try {
      const reference = body.transaction?.reference || body.reference || body.merchant_reference || '';
      if (!reference) return;
      const rawStatus = (() => {
        const s = String(body.transaction?.status || body.status || '').toLowerCase();
        if (s) return s;
        if (body.event_type === 'collection.completed') return 'completed';
        if (body.event_type === 'collection.successful') return 'successful';
        if (body.event_type === 'collection.failed')    return 'failed';
        if (body.event_type === 'collection.cancelled') return 'cancelled';
        return '';
      })();
      const isSuccess = ['completed', 'successful', 'success', 'paid'].includes(rawStatus);
      const isFailed  = ['failed', 'cancelled', 'error', 'declined'].includes(rawStatus);
      if (!isSuccess && !isFailed) return;
      const depSnap = await db.collection('pendingDeposits').where('marzReference', '==', reference).limit(1).get();
      if (depSnap.empty) return;
      const depDoc = depSnap.docs[0];
      if (isSuccess) {
        if (depDoc.data().marzTxUuid) {
          const realStatus = await marzGetCollectStatus(depDoc.data().marzTxUuid);
          if (realStatus && !['completed', 'successful', 'success', 'paid'].includes(realStatus)) return;
        }
        const amount   = parseInt(body.transaction?.amount?.raw || body.collection?.amount?.raw, 10) || depDoc.data().amount;
        const provTxId = body.collection?.provider_transaction_id || null;
        await creditMarzDeposit(depDoc, amount, provTxId);
      } else if (isFailed) {
        const failReason = body.transaction?.description || body.description || rawStatus || 'Payment declined';
        if (depDoc.data().status !== 'failed')
          await depDoc.ref.update({ status: 'failed', failedAt: FieldValue.serverTimestamp(), failureReason: failReason });
      }
    } catch (e) { console.error('Deposit callback error:', e.message); }
  });
}
app.post('/callback', handleDepositCallback);
app.post('/deposit/callback', handleDepositCallback);

// ═══════════════════════════════════════════
// WITHDRAWALS — user requests, admin processes via MarzPay
// ═══════════════════════════════════════════
app.post('/withdraw/request', async (req, res) => {
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Please sign in again' });
  const { amount, phone } = req.body;
  const amt = parseFloat(amount);
  if (!isFinite(amt) || amt <= 0) return res.status(400).json({ status: 'error', message: 'Invalid amount' });
  const fullPhone = cleanPhone(phone);
  try {
    const [uSnap, sett] = await Promise.all([db.collection('users').doc(userId).get(), getSettings()]);
    const feeRate = sett.liquidityFee ?? LIQUIDITY_FEE;
    const minWit  = sett.minWithdrawal ?? MIN_WITHDRAWAL;
    if (amt < minWit) return res.status(400).json({ status: 'error', message: `Minimum withdrawal is ${fmtUGX(minWit)}` });
    if (!uSnap.exists) return res.status(404).json({ status: 'error', message: 'User not found' });
    const user = uSnap.data();
    if (user.status === 'banned') return res.status(403).json({ status: 'error', message: 'Account suspended' });
    if ((user.walletBalance || 0) < amt)
      return res.status(400).json({ status: 'error', message: `Insufficient balance. Available: ${fmtUGX(user.walletBalance || 0)}` });

    const fee = Math.round(amt * feeRate);
    const netAmt = amt - fee;
    const { date, time } = nowStr();
    let witId;
    await db.runTransaction(async t => {
      const uRef  = db.collection('users').doc(userId);
      const fresh = await t.get(uRef);
      const bal   = fresh.data().walletBalance || 0;
      if (bal < amt) throw new Error(`Insufficient: ${fmtUGX(bal)}`);
      t.update(uRef, { walletBalance: bal - amt, withdrawalCount: FieldValue.increment(1) });
      const witRef = db.collection('withdrawals').doc();
      witId = witRef.id;
      t.set(witRef, {
        userId, userName: user.name || '', userPhone: user.phone || '',
        withdrawalPhone: fullPhone, amount: amt, fee, netAmount: netAmt,
        status: 'pending', date, time, createdAt: FieldValue.serverTimestamp()
      });
      t.set(db.collection('transactions').doc(), {
        userId, type: 'withdrawal', description: 'Cash-out request — awaiting processing',
        amount: -amt, fee, netAmount: netAmt, phone: fullPhone,
        status: 'pending', date, time, withdrawalId: witRef.id, createdAt: FieldValue.serverTimestamp()
      });
    });
    return res.json({ status: 'success', withdrawalId: witId, netAmount: netAmt, fee, message: 'Withdrawal submitted. Processing soon.' });
  } catch (e) {
    console.error('Withdrawal error:', e.message);
    return res.status(400).json({ status: 'error', message: e.message });
  }
});
const _completingWithdrawals = new Set();
async function completeWithdrawal(witDoc) {
  const wit = witDoc.data();
  if (wit.status === 'processed' || wit.status === 'failed') return false;
  if (_completingWithdrawals.has(witDoc.id)) return false;
  _completingWithdrawals.add(witDoc.id);
  try {
    const applied = await db.runTransaction(async t => {
      const fresh = await t.get(witDoc.ref);
      const fs = fresh.data();
      if (!fs || fs.status === 'processed' || fs.status === 'failed') return false;
      t.update(witDoc.ref, { status: 'processed', completedAt: FieldValue.serverTimestamp() });
      t.update(db.collection('users').doc(wit.userId), {
        totalWithdrawn: FieldValue.increment(wit.netAmount || wit.amount)
      });
      return true;
    });
    if (!applied) return false;
    try {
      const txSnap = await db.collection('transactions').where('withdrawalId', '==', witDoc.id).limit(1).get();
      if (!txSnap.empty) await txSnap.docs[0].ref.update({ status: 'success' });
    } catch (txErr) { console.warn('completeWithdrawal tx update:', txErr.message); }
    return true;
  } finally { _completingWithdrawals.delete(witDoc.id); }
}
async function failWithdrawal(witDoc, reason) {
  const wit = witDoc.data();
  if (wit.status === 'processed' || wit.status === 'failed') return false;
  const { date, time } = nowStr();
  await db.runTransaction(async t => {
    const freshWit = await t.get(witDoc.ref);
    if (!freshWit.exists) return;
    if (freshWit.data().status === 'processed' || freshWit.data().status === 'failed') return;
    const uRef  = db.collection('users').doc(wit.userId);
    const uSnap = await t.get(uRef);
    if (!uSnap.exists) throw new Error('User not found');
    t.update(uRef, { walletBalance: FieldValue.increment(wit.amount), withdrawalCount: FieldValue.increment(-1) });
    t.update(witDoc.ref, { status: 'failed', failureReason: reason, failedAt: FieldValue.serverTimestamp() });
    t.set(db.collection('transactions').doc(), {
      userId: wit.userId, type: 'refund', description: 'Withdrawal refund — disbursement failed',
      amount: wit.amount, status: 'success', date, time, createdAt: FieldValue.serverTimestamp()
    });
  });
  try {
    const txSnap = await db.collection('transactions').where('withdrawalId', '==', witDoc.id).limit(1).get();
    if (!txSnap.empty) await txSnap.docs[0].ref.update({ status: 'failed' });
  } catch (txErr) { console.warn('failWithdrawal tx update:', txErr.message); }
  return true;
}
app.get('/withdraw/status/:id', async (req, res) => {
  try {
    const snap = await db.collection('withdrawals').doc(req.params.id).get();
    if (!snap.exists) return res.status(404).json({ status: 'error' });
    let wit = snap.data();
    if (wit.status === 'processing' && (wit.marzTxUuid || wit.marzReference)) {
      try {
        const rawStatus = await marzGetStatus(wit.marzTxUuid || wit.marzReference);
        const isSuccess = ['completed', 'successful', 'success', 'paid'].includes(rawStatus);
        const isFailed  = ['failed', 'cancelled', 'error', 'declined'].includes(rawStatus);
        if (isSuccess) await completeWithdrawal(snap);
        else if (isFailed) await failWithdrawal(snap, 'Disbursement failed');
        if (isSuccess || isFailed) {
          const fresh = await db.collection('withdrawals').doc(req.params.id).get();
          wit = fresh.data();
        }
      } catch (pollErr) { console.warn('Withdraw poll error:', pollErr.message); }
    }
    return res.json({ status: 'success', withdrawal: { id: snap.id, withdrawStatus: wit.status, amount: wit.amount, netAmount: wit.netAmount } });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/withdraw/callback', async (req, res) => {
  res.status(200).json({ received: true });
  setImmediate(async () => {
    const body = req.body;
    try {
      const marzUuid  = body.transaction?.uuid || body.data?.transaction?.uuid || '';
      const reference = body.transaction?.reference || body.reference || body.data?.transaction?.reference || '';
      const rawStatus = (() => {
        const s = String(body.transaction?.status || body.status || '').toLowerCase();
        if (s) return s;
        if (body.event_type === 'disbursement.completed') return 'completed';
        if (body.event_type === 'disbursement.failed')    return 'failed';
        return '';
      })();
      const isSuccess = ['completed', 'successful', 'success', 'paid'].includes(rawStatus);
      const isFailed  = ['failed', 'cancelled', 'error', 'declined'].includes(rawStatus);
      if ((!marzUuid && !reference) || (!isSuccess && !isFailed)) return;
      let witSnap = marzUuid
        ? await db.collection('withdrawals').where('marzTxUuid', '==', marzUuid).limit(1).get()
        : { empty: true };
      if (witSnap.empty && reference)
        witSnap = await db.collection('withdrawals').where('marzReference', '==', reference).limit(1).get();
      if (witSnap.empty) return;
      const witDoc = witSnap.docs[0];
      if (isSuccess) {
        if (witDoc.data().marzTxUuid) {
          const realStatus = await marzGetStatus(witDoc.data().marzTxUuid);
          if (realStatus && !['completed', 'successful', 'success', 'paid'].includes(realStatus)) return;
        }
        await completeWithdrawal(witDoc);
      } else if (isFailed) {
        await failWithdrawal(witDoc, body.transaction?.description || body.description || 'Disbursement failed');
      }
    } catch (e) { console.error('Withdraw callback error:', e.message); }
  });
});
app.post('/admin/withdraw/process', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const { withdrawalId } = req.body;
  if (!withdrawalId) return res.status(400).json({ status: 'error', message: 'withdrawalId required' });
  try {
    const witSnap = await db.collection('withdrawals').doc(withdrawalId).get();
    if (!witSnap.exists) return res.status(404).json({ status: 'error', message: 'Withdrawal not found' });
    const wit = witSnap.data();
    if (wit.status !== 'pending') return res.status(400).json({ status: 'error', message: `Cannot process — status is '${wit.status}'` });

    const phone = wit.withdrawalPhone || wit.userPhone || '';
    const netAmount = wit.netAmount || wit.amount;
    const reference = uuidv4();
    const mpData = await marzSendMoney({
      amount: netAmount, phone, reference, description: wit.userName || wit.userId,
      callbackUrl: RAILWAY_URL ? RAILWAY_URL + '/withdraw/callback' : undefined
    });
    const witSandbox = mpData.status === 'sandbox' || mpData.data?.disbursement?.mode === 'sandbox';
    if (mpData.status !== 'success' && mpData.status !== 'pending' && !witSandbox)
      return res.status(400).json({ status: 'error', message: marzUserMsg(mpData, 'Withdrawal could not be sent right now. Please try again.') });

    const { date, time } = nowStr();
    const batch = db.batch();
    const marzTxUuid = mpData.data?.transaction?.uuid || '';
    if (witSandbox) {
      batch.update(db.collection('withdrawals').doc(withdrawalId), {
        status: 'processed', marzReference: reference, marzTxUuid,
        processedAt: FieldValue.serverTimestamp(), completedAt: FieldValue.serverTimestamp()
      });
      batch.update(db.collection('users').doc(wit.userId), { totalWithdrawn: FieldValue.increment(netAmount) });
    } else {
      batch.update(db.collection('withdrawals').doc(withdrawalId), {
        status: 'processing', marzReference: reference, marzTxUuid, processedAt: FieldValue.serverTimestamp()
      });
    }
    await batch.commit();
    try {
      const txSnap = await db.collection('transactions').where('withdrawalId', '==', withdrawalId).limit(1).get();
      if (!txSnap.empty) await txSnap.docs[0].ref.update({ status: witSandbox ? 'success' : 'processing', marzReference: reference });
    } catch (txErr) { console.warn('Process tx update (non-critical):', txErr.message); }
    const msg = witSandbox
      ? `Sandbox: withdrawal marked complete — ${fmtUGX(netAmount)} to ${phone}`
      : `Withdrawal processing — ${fmtUGX(netAmount)} being sent to ${phone}`;
    return res.json({ status: 'success', message: msg, sandbox: witSandbox });
  } catch (e) {
    console.error('Process withdrawal error:', e.message);
    const friendly = /abort|timeout|fetch failed|network|ENOTFOUND|ECONN|Unexpected token|JSON/i.test(e.message || '')
      ? PROVIDER_BUSY_MSG : (e.message || 'Could not process withdrawal');
    return res.status(500).json({ status: 'error', message: friendly });
  }
});
app.post('/withdraw/reject', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const { withdrawalId, reason } = req.body;
  try {
    const snap = await db.collection('withdrawals').doc(withdrawalId).get();
    if (!snap.exists) return res.status(404).json({ status: 'error', message: 'Not found' });
    const wit = snap.data();
    if (['processed', 'rejected'].includes(wit.status))
      return res.status(400).json({ status: 'error', message: 'Already ' + wit.status });
    const batch = db.batch();
    batch.update(db.collection('withdrawals').doc(withdrawalId), {
      status: 'rejected', rejectionReason: reason || 'Rejected by admin', rejectedAt: FieldValue.serverTimestamp()
    });
    batch.update(db.collection('users').doc(wit.userId), {
      walletBalance: FieldValue.increment(wit.amount), withdrawalCount: FieldValue.increment(-1)
    });
    await batch.commit();
    return res.json({ status: 'success', message: `Rejected. ${fmtUGX(wit.amount)} refunded.` });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});

// ═══════════════════════════════════════════
// ACCOUNT — own investments / withdrawals / transactions
// ═══════════════════════════════════════════
app.get('/account/investments', async (req, res) => {
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const snap = await db.collection('investments').where('userId', '==', userId).get();
    const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    list.sort((a, b) => tsMillis(b.createdAt) - tsMillis(a.createdAt));
    return res.json({ status: 'success', investments: list });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});
app.get('/account/withdrawals', async (req, res) => {
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const snap = await db.collection('withdrawals').where('userId', '==', userId).get();
    const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    list.sort((a, b) => tsMillis(b.createdAt) - tsMillis(a.createdAt));
    return res.json({ status: 'success', withdrawals: list });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});
app.get('/account/transactions', async (req, res) => {
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const snap = await db.collection('transactions').where('userId', '==', userId).limit(300).get();
    const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    list.sort((a, b) => tsMillis(b.createdAt) - tsMillis(a.createdAt));
    return res.json({ status: 'success', transactions: list });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});

// ═══════════════════════════════════════════
// ADMIN — wallet adjustments, deposits, stats, settings, lists
// ═══════════════════════════════════════════
app.post('/admin/deposit', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const { userId, amount, note } = req.body;
  const amt = parseFloat(amount || 0);
  if (!userId || !amt) return res.status(400).json({ status: 'error', message: 'userId and amount required' });
  try {
    const { date, time } = nowStr();
    await db.runTransaction(async t => {
      const uRef  = db.collection('users').doc(userId);
      const uSnap = await t.get(uRef);
      if (!uSnap.exists) throw new Error('User not found');
      t.update(uRef, { walletBalance: FieldValue.increment(amt) });
      t.set(db.collection('transactions').doc(), {
        userId, type: 'admin_credit', description: note || 'Furagemz credit',
        amount: amt, status: 'success', date, time, createdAt: FieldValue.serverTimestamp()
      });
    });
    return res.json({ status: 'success', message: `Credited ${fmtUGX(amt)}` });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/debit', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const { userId, amount, note } = req.body;
  const amt = Math.abs(parseFloat(amount || 0));
  if (!userId || !amt) return res.status(400).json({ status: 'error', message: 'userId and amount required' });
  try {
    const { date, time } = nowStr();
    let newBal = 0;
    await db.runTransaction(async t => {
      const uRef  = db.collection('users').doc(userId);
      const uSnap = await t.get(uRef);
      if (!uSnap.exists) throw new Error('User not found');
      newBal = (uSnap.data().walletBalance || 0) - amt;
      t.update(uRef, { walletBalance: FieldValue.increment(-amt) });
      t.set(db.collection('transactions').doc(), {
        userId, type: 'admin_debit', description: note || 'Balance adjustment',
        amount: -amt, status: 'success', date, time, createdAt: FieldValue.serverTimestamp()
      });
    });
    return res.json({ status: 'success', message: `Removed ${fmtUGX(amt)} — new balance ${fmtUGX(newBal)}`, newBalance: newBal });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/ban', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const { userId, action, reason } = req.body;
  try {
    const isBan = action === 'ban';
    await db.collection('users').doc(userId).update({
      status: isBan ? 'banned' : 'active',
      banReason: isBan ? (reason || 'Policy violation') : null,
      bannedAt: isBan ? FieldValue.serverTimestamp() : null
    });
    return res.json({ status: 'success' });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/deposit/complete', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const { depositId } = req.body;
  if (!depositId) return res.status(400).json({ status: 'error', message: 'depositId required' });
  try {
    const snap = await db.collection('pendingDeposits').doc(depositId).get();
    if (!snap.exists) return res.status(404).json({ status: 'error', message: 'Deposit not found' });
    if (snap.data().status === 'matched') return res.json({ status: 'success', message: 'Already credited' });
    const result = await pollMarzDepositStatus(snap);
    if (result.credited) return res.json({ status: 'success', message: `Credited ${fmtUGX(result.amount)} to user` });
    if (result.failed) return res.status(400).json({ status: 'error', message: 'MarzPay confirms payment failed' });
    return res.status(400).json({ status: 'error', message: 'MarzPay status still pending — try again in a moment' });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/stats', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const [usersSnap, withdrawalsSnap, investmentsSnap] = await Promise.all([
      db.collection('users').limit(10000).get(),
      db.collection('withdrawals').where('status', '==', 'pending').get(),
      db.collection('investments').where('status', '==', 'active').get()
    ]);
    let totalWallet = 0, totalDeposited = 0, totalWithdrawn = 0;
    usersSnap.forEach(d => {
      const u = d.data();
      totalWallet += u.walletBalance || 0;
      totalDeposited += u.totalDeposited || 0;
      totalWithdrawn += u.totalWithdrawn || 0;
    });
    let pendingPayouts = 0;
    withdrawalsSnap.forEach(d => pendingPayouts += (d.data().netAmount || d.data().amount || 0));
    return res.json({
      status: 'success',
      userCount: usersSnap.size,
      totalWallet, totalDeposited, totalWithdrawn,
      pendingWithdrawals: withdrawalsSnap.size, pendingPayouts,
      activeInvestments: investmentsSnap.size
    });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/settings', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const snap = await db.collection('settings').doc('main').get();
    return res.json({ status: 'success', settings: snap.exists ? snap.data() : {} });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/settings/update', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const { adminKey, ...updates } = req.body;
  if (!Object.keys(updates).length) return res.status(400).json({ status: 'error', message: 'No fields to update' });
  try {
    // If any announcement field is touched, bump the version so the app re-shows
    // the popup to everyone (even those who already dismissed the old one).
    if (Object.keys(updates).some(k => k.startsWith('ann'))) updates.annVersion = Date.now();
    await db.collection('settings').doc('main').set(updates, { merge: true });
    _settingsCache = null; _settingsCacheTs = 0;
    return res.json({ status: 'success', updated: updates });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/users', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const snap = await db.collection('users').limit(10000).get();
    const users = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return res.json({ status: 'success', users, count: users.length });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/user/detail', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ status: 'error', message: 'userId required' });
  try {
    const snap = await db.collection('users').doc(userId).get();
    if (!snap.exists) return res.status(404).json({ status: 'error', message: 'User not found' });
    return res.json({ status: 'success', user: { id: snap.id, ...snap.data() } });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/transactions/list', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const { userId, limit: lim = 200 } = req.body;
  try {
    if (userId) {
      const snap = await db.collection('transactions').where('userId', '==', userId).limit(50).get();
      const txs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      txs.sort((a, b) => tsMillis(b.createdAt) - tsMillis(a.createdAt));
      return res.json({ status: 'success', transactions: txs });
    }
    const snap = await db.collection('transactions').orderBy('createdAt', 'desc').limit(Number(lim) || 200).get();
    return res.json({ status: 'success', transactions: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/deposits/list', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const snap = await db.collection('pendingDeposits').orderBy('createdAt', 'desc').limit(200).get();
    return res.json({ status: 'success', deposits: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/withdrawals/list', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const { limit: lim = 200 } = req.body;
  try {
    const snap = await db.collection('withdrawals').orderBy('createdAt', 'desc').limit(Number(lim) || 200).get();
    return res.json({ status: 'success', withdrawals: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/referrals/list', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const snap = await db.collection('referrals').orderBy('createdAt', 'desc').limit(200).get();
    return res.json({ status: 'success', referrals: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
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
  if (!MONGODB_URI) { console.error('MONGODB_URI env var not set'); process.exit(1); }

  // Start listening right away so the server is always reachable even if the
  // database is momentarily unreachable at boot — /health stays up for
  // diagnosis and the app self-heals the instant the DB comes back.
  app.listen(PORT, () => {
    console.log(`Furagemz Investment Server on port ${PORT}`);
    console.log(`  URL: ${RAILWAY_URL || '(set RAILWAY_URL)'}`);
  });

  let cronsStarted = false;
  const tryConnect = async () => {
    try {
      await connectMongo(MONGODB_URI);
      if (!cronsStarted) { cronsStarted = true; startCrons(); }
    } catch (e) {
      console.error('MongoDB not reachable yet — retrying in 5s:', e.message);
      setTimeout(tryConnect, 5000);
    }
  };
  tryConnect();
}
startServer().catch(e => { console.error('Startup error:', e.message); process.exit(1); });
