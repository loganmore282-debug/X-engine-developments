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
// Admin image uploads (product images / home banners) arrive as base64 data
// URIs, which exceed the tight default body limit. Give only those two admin
// routes a larger parser; everything else stays capped at 64kb. Once this
// parses the body, the global 64kb parser below sees it as already-read and
// skips it.
const bigJson = express.json({ limit: '8mb' });
const BIG_BODY_PATHS = new Set(['/admin/products/save', '/admin/settings/update']);
app.use((req, res, next) => BIG_BODY_PATHS.has(req.path) ? bigJson(req, res, next) : next());
app.use(express.json({ limit: '64kb' }));
app.use(express.urlencoded({ extended: true, limit: '64kb' }));
app.use(cors({ origin: '*' }));

// ── SECURITY HEADERS ── (API responses must never be framed, sniffed or leak referrers)
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
['/checkin', '/withdraw/request', '/invest/create', '/invest/boost', '/deposit/marzpay', '/deposit/card', '/redeem']
  .forEach(p => app.use(p, apiLimiter));

// ── MAINTENANCE GATE ──
// When maintenance mode is on, every money/account action is blocked for normal
// users (admin panel, auth, health and public read-only endpoints stay open so
// the owner can still work and the app can show a maintenance screen).
const MAINTENANCE_BLOCK = ['/account', '/invest', '/deposit', '/withdraw', '/checkin', '/redeem', '/team', '/register'];
// Payment-provider webhooks/callbacks must ALWAYS run, even in maintenance,
// or deposits/withdrawals in flight would never get confirmed.
const GUARD_EXEMPT = new Set(['/', '/health', '/callback', '/deposit/callback', '/deposit/return', '/withdraw/callback']);
app.use(async (req, res, next) => {
  if (GUARD_EXEMPT.has(req.path)) return next();
  if (!MAINTENANCE_BLOCK.some(p => req.path.startsWith(p))) return next();
  try {
    const s = await getSettings();
    if (s && s.maintenanceMode) {
      return res.status(503).json({ status: 'error', code: 'MAINTENANCE',
        message: s.maintenanceMsg || 'Furagemz is under maintenance. Please check back shortly.' });
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

// ── CONFIG (owner-set, locked in) ──
const ADMIN_KEY        = process.env.ADMIN_KEY        || '';
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY || '';
if (!FIREBASE_API_KEY) { console.error('FIREBASE_API_KEY env var is required'); process.exit(1); }
// Public base URL for payment callbacks. Render sets RENDER_EXTERNAL_URL
// automatically; PUBLIC_URL / RAILWAY_URL are manual fallbacks for other hosts.
const PUBLIC_URL  = (() => {
  let u = (process.env.RENDER_EXTERNAL_URL || process.env.PUBLIC_URL || process.env.RAILWAY_URL || '').trim().replace(/\/$/, '');
  if (u && !u.startsWith('http')) u = 'https://' + u;
  return u;
})();

const MARZPAY_BASE = 'https://wallet.wearemarz.com/api/v1';
const MARZPAY_KEY  = process.env.MARZPAY_KEY || ''; // base64 encoded credentials
// Where a card customer is bounced back to after paying on the gateway.
const APP_URL = (process.env.APP_URL || 'https://furagemzplatform.edgeone.app').trim().replace(/\/$/, '');

const APP_VERSION      = '1.7.0';   // shown on the in-app "Download app" screen
const APP_SIZE         = '2.4 MB';  // approximate installed PWA size
const MIN_DEPOSIT      = 30000;
const MIN_WITHDRAWAL   = 10000;   // no multiples restriction (owner's call, differs from Voltra)
const WELCOME_BONUS    = 7000;
const CHECKIN_BONUS    = 500;
const COMM_L1          = 0.35;    // referral bonus, level 1
const COMM_L2          = 0.02;    // level 2
const COMM_L3          = 0.01;    // level 3
const LIQUIDITY_FEE    = 0.14;    // withdrawal fee
const RETURN_MULTIPLE  = 13;      // payout = price * RETURN_MULTIPLE, paid in full at maturity
const CYCLE_DAYS       = 60;      // stipulated investment period (days), fixed for every gem
// EARNINGS: each gem pays daily cashback (expectedReturn / cycle) every 24 hours
// from the exact purchase time, for `cycle` days, totalling expectedReturn.
// BOOST / ACCELERATE — after BOOST_UNLOCK_DAYS the holder may pay BOOST_COST_PCT of
// the gem's total return to compress all remaining payouts into BOOST_MATURE_DAYS.
const BOOST_UNLOCK_DAYS  = 5;     // boost becomes available 5 days after purchase
const BOOST_COST_PCT     = 0.30;  // boost fee = 30% of the gem's total return
const BOOST_MATURE_DAYS  = 5;     // after a boost, the gem finishes paying in 5 days
const BOOST_MATURE_HOURS = BOOST_MATURE_DAYS * 24;
// Gateway status buckets. A payment is credited on SUCCESS and only marked failed
// on a TERMINAL failure. 'error' is deliberately EXCLUDED — MarzPay reports its
// transient provider outages (e.g. DATABASE_ERROR) as 'error', and treating that
// as a real failure is what wrongly killed genuine deposits. An 'error' now leaves
// the payment 'processing' so the background sweep keeps re-checking until MarzPay
// gives a real verdict.
const PAY_OK   = ['completed', 'successful', 'success', 'paid'];
const PAY_FAIL = ['failed', 'cancelled', 'declined'];
function durPhrase(hours) {
  hours = Number(hours) || 0;
  return hours % 24 === 0 ? `${hours / 24} day${hours / 24 === 1 ? '' : 's'}` : `${hours} hours`;
}

// Gem tier ladder — prices distinct from Voltra's energy-asset ladder.
const GEM_TIERS = [
  { key: 'quartz',   label: 'Quartz',   price:   30000 },
  { key: 'amethyst', label: 'Amethyst', price:   95000 },
  { key: 'topaz',    label: 'Topaz',    price:  160000 },
  { key: 'emerald',  label: 'Emerald',  price:  350000 },
  { key: 'sapphire', label: 'Sapphire', price:  500000 },
  { key: 'diamond',  label: 'Diamond',  price: 1000000 },
].map(t => {
  const expectedReturn = Math.round(t.price * RETURN_MULTIPLE);
  return { ...t, cycle: CYCLE_DAYS, expectedReturn, dailyReturn: expectedReturn / CYCLE_DAYS };
});
function findGemTier(key) { return GEM_TIERS.find(t => t.key === key) || null; }

// TEAM TASK CENTRE — milestone rewards on the TOTAL DEPOSITS of a user's
// level-1 team. Paid instantly by the server the moment a threshold is crossed
// (deposit-credit hook) and re-checked whenever the user opens the Team screen.
const TEAM_MILESTONES = [
  { target:   60000, reward:  3000 },
  { target:  100000, reward: 10000 },
  { target:  250000, reward: 15000 },
  { target:  500000, reward: 25000 },
  { target: 1000000, reward: 50000 },
];

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
// CARD collection — same /collect-money endpoint, method=card, NO phone number.
// Returns a redirect_url the customer opens to pay by card. Settles in UGX (the
// customer's own bank converts their currency), so nothing here is multi-currency.
async function marzCollectCard({ amount, reference, description, callbackUrl, country }) {
  const payload = { amount: Number(amount), method: 'card', country: country || 'UG', reference,
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

// ── PER-KEY MUTEX ──
// M0 has NO real transactions: runTransaction gives no isolation, and `await
// t.get()` yields the event loop, so two parallel requests can both read the
// same balance and both write it — a double-spend. Credit paths already serialise
// with in-process Sets; this mutex serialises the DEBIT paths (invest / boost /
// withdraw) and money settlement the same way. Single Node instance ⇒ real
// mutual exclusion. Each call runs strictly after the previous one for the key.
const _lockTails = new Map();
function withLock(key, fn) {
  const prev = _lockTails.get(key) || Promise.resolve();
  const run  = prev.then(() => fn(), () => fn());
  const tail = run.then(() => {}, () => {});
  _lockTails.set(key, tail);
  tail.finally(() => { if (_lockTails.get(key) === tail) _lockTails.delete(key); });
  return run;
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
// Wrapper: on a clean run (including the "no referrer" case — nothing owed) it
// marks the investment `commDone` so the reconciler skips it. On ANY failure it
// leaves commDone unset, so reconcileCommissions() retries it later — a referral
// reward is therefore never permanently lost, even if this call fails mid-way.
async function payCommissions(investorId, amount, investmentId) {
  let ok = false;
  // Serialise per investment so the invest-time call and the reconciler can't
  // both pay the same commission (the per-level flags are re-checked in the
  // transaction, but M0 has no real isolation, so add a true single-writer lock).
  await withLock('comm:' + investmentId, async () => {
    try { await _payChain(investorId, amount, investmentId); ok = true; }
    catch (e) { console.error('Commission error:', e.message); }
  });
  if (ok) { try { await db.collection('investments').doc(investmentId).update({ commDone: true }); } catch (_) {} }
}
async function _payChain(investorId, amount, investmentId) {
  const { date, time } = nowStr();
  {
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
          totalEarned:        FieldValue.increment(l1Amt),
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
          totalEarned:        FieldValue.increment(l2Amt),
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
          totalEarned:        FieldValue.increment(l3Amt),
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
  }
}

// ── COMMISSION RECONCILER ──
// Safety net so a referrer NEVER loses a reward: re-runs payCommissions for any
// investment not yet marked commDone (a call that failed, or an older record).
// payCommissions is idempotent (per-level commPaid_<invId> flags + transactions),
// so re-running can only pay what's still owed — never double-pay.
let _reconcilingComm = false;
async function reconcileCommissions(limit = 800) {
  if (_reconcilingComm) return 0;
  _reconcilingComm = true;
  let fixed = 0;
  try {
    const snap = await db.collection('investments').orderBy('createdAt', 'desc').limit(limit).get();
    for (const doc of snap.docs) {
      const inv = doc.data();
      if (inv.commDone) continue;
      await payCommissions(inv.userId, inv.amount, doc.id);
      fixed++;
    }
  } catch (e) { console.error('reconcileCommissions error:', e.message); }
  finally { _reconcilingComm = false; }
  return fixed;
}

// ── TEAM MILESTONE ENGINE ──
// Sums the caller's level-1 team deposits and pays every milestone that is
// reached but not yet paid. Idempotent: each milestone sets a flag inside a
// transaction with a fresh recheck (same proven pattern as commissions), so a
// reward can never be paid twice no matter how often this runs.
async function checkTeamMilestones(userId) {
  const snap = await db.collection('users').where('referredBy', '==', userId).get();
  // Team volume = total DEPOSITS by your LEVEL-1 team (all money members put in:
  // real deposits + admin credits) — as it was set up originally.
  let l1Total = 0;
  snap.forEach(d => { l1Total += d.data().totalDeposited || 0; });
  // Don't pay until the paid-marker backfill has run, so historical rewards are
  // never paid twice when the reconciler starts.
  const sett0 = await getSettings();
  if (!sett0.milestonePaidBackfillDone) return l1Total;
  const uRef = db.collection('users').doc(userId);
  const { date, time } = nowStr();
  // Serialise per referrer so the deposit hook, settle-on-open and reconciler
  // can't pay the same milestone twice (M0 has no real transaction isolation).
  await withLock('milestone:' + userId, async () => {
  for (const m of TEAM_MILESTONES) {
    if (l1Total < m.target) break;
    // Idempotency marker seeded from the ACTUAL ledger (a team_reward tx), so a
    // reward is paid exactly once and previously-paid ones are never repeated.
    const paidFlag = 'teamRewardPaidV2_' + m.target;
    try {
      await db.runTransaction(async t => {
        const fresh = await t.get(uRef);
        if (!fresh.exists || fresh.data()[paidFlag]) return;
        t.update(uRef, {
          walletBalance: FieldValue.increment(m.reward),
          totalEarned:   FieldValue.increment(m.reward),
          [paidFlag]: true, ['teamMilestone_' + m.target]: true
        });
        t.set(db.collection('transactions').doc(), {
          userId, type: 'team_reward',
          description: `Team reward — level 1 team deposits reached ${fmtUGX(m.target)}`,
          amount: m.reward, milestone: m.target, status: 'success',
          date, time, createdAt: FieldValue.serverTimestamp()
        });
      });
    } catch (e) { console.error('Milestone pay error:', userId, m.target, e.message); }
  }
  });
  return l1Total;
}
// Self-healing net: pay any referrer who crossed a deposit milestone but never
// got the reward (missed due to a race, cold start, or the earlier seal). Safe —
// checkTeamMilestones is idempotent on the ledger-seeded paid marker.
async function reconcileMilestones() {
  try {
    const s = await getSettings();
    if (!s.milestonePaidBackfillDone) return;
    const usersSnap = await db.collection('users').limit(10000).get();
    const referrers = new Set();
    usersSnap.forEach(d => { const r = d.data().referredBy; if (r) referrers.add(r); });
    for (const uid of referrers) { await checkTeamMilestones(uid).catch(() => {}); }
  } catch (e) { console.error('reconcileMilestones error:', e.message); }
}
// Fire-and-forget hook: after ANY deposit credit, check the depositor's
// referrer so their milestone pays out the instant the threshold is crossed.
async function notifyTeamDeposit(depositorId) {
  try {
    const u = await db.collection('users').doc(depositorId).get();
    const refId = u.exists ? u.data().referredBy : null;
    if (refId) await checkTeamMilestones(refId);
  } catch (e) { console.error('Team deposit hook error:', e.message); }
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
    commL1: s.commL1 ?? COMM_L1,
    commL2: s.commL2 ?? COMM_L2,
    commL3: s.commL3 ?? COMM_L3,
    aboutText: s.aboutText || '',
    gemTiers: GEM_TIERS,
    boostUnlockDays:  s.boostUnlockDays  ?? BOOST_UNLOCK_DAYS,
    boostMatureHours: s.boostMatureHours ?? BOOST_MATURE_HOURS,
    boostMatureDays:  s.boostMatureDays  ?? BOOST_MATURE_DAYS,
    boostCostPct:     s.boostCostPct     ?? BOOST_COST_PCT,
    maintenanceMode:  !!s.maintenanceMode,
    maintenanceMsg:   s.maintenanceMsg || 'Furagemz is under maintenance. Please check back shortly.',
    appVersion:       s.appVersion || APP_VERSION,
    appDeveloper:     s.appDeveloper || 'Furagemz Developers',
    appSize:          s.appSize || APP_SIZE,
    slideshowImages: Array.isArray(s.slideshowImages) ? s.slideshowImages : [],
    announcementBg:  s.announcementBg || '',
    brandTagline:    s.brandTagline || '',
    supportWhatsapp: s.supportWhatsapp || '',
    supportTelegram: s.supportTelegram || '',
    supportHours:    s.supportHours    || '',
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

// Gem products live in the `products` collection (admin-managed, not hardcoded).
// GEM_TIERS is only the seed + a safety fallback.
// Colours match each gem's real appearance: Quartz = clear/silver, Diamond = bright platinum.
const GEM_COLORS = { quartz: '#64748b', amethyst: '#c084fc', topaz: '#eab308', emerald: '#10b981', sapphire: '#0ea5e9', diamond: '#334155' };
async function seedProducts() {
  try {
    const snap = await db.collection('products').limit(1).get();
    if (!snap.empty) return;
    let order = 0;
    for (const t of GEM_TIERS) {
      await db.collection('products').add({
        key: t.key, label: t.label, price: t.price, expectedReturn: t.expectedReturn,
        cycle: t.cycle, dailyReturn: t.dailyReturn, image: '', color: GEM_COLORS[t.key] || '#7c3aed',
        order: order++, active: true, createdAt: FieldValue.serverTimestamp()
      });
    }
    console.log('Seeded default gem products');
  } catch (e) { console.error('seedProducts error:', e.message); }
}
async function fetchProducts(includeInactive) {
  const snap = await db.collection('products').get();
  let list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  if (!includeInactive) list = list.filter(p => p.active !== false);
  list.sort((a, b) => (a.order || 0) - (b.order || 0) || (a.price || 0) - (b.price || 0));
  return list;
}
async function getProductByKeyOrId(idOrKey) {
  let snap = await db.collection('products').where('key', '==', idOrKey).limit(1).get();
  if (!snap.empty) return { id: snap.docs[0].id, ...snap.docs[0].data() };
  const byId = await db.collection('products').doc(idOrKey).get();
  if (byId.exists) return { id: byId.id, ...byId.data() };
  return null;
}
app.get('/products', async (_req, res) => {
  try {
    const list = await fetchProducts(false);
    res.json({ status: 'success', products: list.length ? list : GEM_TIERS });
  } catch (e) { res.json({ status: 'success', products: GEM_TIERS }); }
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

// ── ANTI-BOT CAPTCHA (jumbled letters) ──
// The server issues a short random LETTER code the client renders visually
// jumbled; the user retypes it and the server verifies. In-memory, 5-min TTL.
const CAPTCHA_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ'; // letters only, no I/L/O ambiguity
// Captchas are stored in the DATABASE, not process memory — a server restart or
// redeploy mid-registration must never invalidate the letters a user is typing.
// Every registration session's code is globally recognised for 10 minutes.
app.post('/auth/captcha', async (_req, res) => {
  const len = 5, bytes = crypto.randomBytes(len);
  let code = '';
  for (let i = 0; i < len; i++) code += CAPTCHA_CHARS[bytes[i] % CAPTCHA_CHARS.length];
  const id = uuidv4();
  try {
    await db.collection('captchas').doc(id).set({
      answer: code, expires: Date.now() + 10 * 60 * 1000, createdAt: FieldValue.serverTimestamp()
    });
    // Opportunistic cleanup of long-expired codes (best effort, never blocks).
    db.collection('captchas').where('expires', '<', Date.now() - 3600000).limit(40).get()
      .then(s => s.forEach(d => d.ref.delete().catch(() => {}))).catch(() => {});
    return res.json({ status: 'success', captchaId: id, challenge: code });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/auth/captcha/verify', async (req, res) => {
  try {
    const id = String(req.body.captchaId || '');
    if (!id) return res.json({ status: 'error', message: 'Verification expired. Refresh and try again.' });
    const snap = await db.collection('captchas').doc(id).get();
    if (!snap.exists || snap.data().expires < Date.now())
      return res.json({ status: 'error', message: 'Verification expired. Refresh and try again.' });
    const ok = String(req.body.answer || '').toUpperCase().replace(/\s/g, '') === snap.data().answer;
    if (ok) await snap.ref.delete();
    return res.json({ status: ok ? 'success' : 'error', message: ok ? '' : 'Incorrect code, try again.' });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});

// ── ACTIVITY FEED — built from REAL user transactions, global (same on every
// device), cached ~25s. Names are shown first-name only for privacy. ──
const _FEED_ACTIONS = {
  topup:        'deposited',
  admin_credit: 'topped up',
  withdrawal:   'withdrew',
  gem_payout:   'earned cashback of',
  investment:   'activated a gem worth',
  commission:   'earned a referral reward of',
  team_reward:  'earned a team reward of',
  redeem:       'redeemed a code for',
  checkin:      'claimed a daily bonus of',
};
function _firstName(nm) {
  const first = String(nm || '').trim().split(/\s+/)[0] || 'Member';
  return first.charAt(0).toUpperCase() + first.slice(1);
}
async function buildActivityFeed() {
  const snap = await db.collection('transactions').orderBy('createdAt', 'desc').limit(60).get();
  const rows = snap.docs.map(d => d.data())
    .filter(t => _FEED_ACTIONS[t.type] && t.amount != null && Math.abs(t.amount) > 0);
  const ids = [...new Set(rows.map(t => t.userId).filter(Boolean))].slice(0, 40);
  const nameMap = {};
  await Promise.all(ids.map(async id => {
    try { const u = await db.collection('users').doc(id).get(); if (u.exists) nameMap[id] = u.data().name || u.data().username || 'Member'; }
    catch (_) {}
  }));
  return rows.slice(0, 30).map(t => ({
    name:   _firstName(nameMap[t.userId] || 'Member'),
    action: _FEED_ACTIONS[t.type],
    amount: Math.abs(t.amount || 0),
    ago:    Math.max(1, Math.round((Date.now() - tsMillis(t.createdAt)) / 60000)),
  }));
}
let _activityFeed = [], _activityTs = 0, _activityBuilding = false;
app.get('/public/activity-feed', async (_req, res) => {
  // COLD START: the very first request after a deploy must WAIT for the build —
  // returning an empty feed here made the app's ticker vanish until a reload.
  if (!_activityFeed.length && !_activityBuilding) {
    _activityBuilding = true;
    try { _activityFeed = await buildActivityFeed(); _activityTs = Date.now(); }
    catch (e) { console.error('activity feed error:', e.message); }
    finally { _activityBuilding = false; }
  } else if (!_activityBuilding && Date.now() - _activityTs > 25000) {
    // Warm cache: refresh in the background, serve the current copy instantly.
    _activityBuilding = true;
    buildActivityFeed()
      .then(f => { _activityFeed = f; _activityTs = Date.now(); })
      .catch(e => console.error('activity feed error:', e.message))
      .finally(() => { _activityBuilding = false; });
  }
  res.json({ status: 'success', feed: _activityFeed });
});

// Live availability check used by the register screen (public, rate-limited by /auth/).
app.post('/auth/check-username', async (req, res) => {
  const norm = normalizeUsername(req.body.username);
  if (!norm.ok) return res.json({ status: 'success', available: false, reason: norm.error });
  try {
    const taken = await usernameTaken(norm.lower, null);
    return res.json({ status: 'success', available: !taken, reason: taken ? 'That username is taken.' : '' });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});

// Referral-code existence check used by the register screen BEFORE the account
// is created — a forged/mistyped code must stop registration, not slide through.
app.post('/auth/check-referral', async (req, res) => {
  const raw = String(req.body.referralCode || '').trim();
  if (!raw) return res.json({ status: 'success', valid: true, empty: true }); // no code = fine
  try {
    let snap = await db.collection('users').where('usernameLower', '==', raw.toLowerCase()).limit(1).get();
    if (snap.empty)
      snap = await db.collection('users').where('referralCode', '==', raw).limit(1).get();
    return res.json({ status: 'success', valid: !snap.empty,
      reason: snap.empty ? 'That referral code does not exist. Check it or leave it empty.' : '' });
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
  // STRICT: identity comes only from the verified Firebase token — a client can
  // never name another user's id. (The client signs in before calling this, so
  // the token is always available; no unauthenticated fallback.)
  const uid = await verifyAuth(req);
  if (!uid) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  if (req.body.userId && req.body.userId !== uid)
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
    // DURABLE REFERRAL: persist the entered code on the user doc at profile
    // creation, so even if the follow-up /register call never arrives (app
    // closed, network died, server mid-deploy), the referral is NOT lost —
    // /register and the boot self-heal read it back from here.
    const pendingRef = String(req.body.referralCode || '').trim();
    if (pendingRef) base.pendingReferral = pendingRef;
    if (snap.exists) {
      await ref.update(base);
    } else {
      await ref.set({
        ...base,
        walletBalance: 0, totalDeposited: 0, realDeposited: 0, totalInvested: 0, totalWithdrawn: 0,
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
  // STRICT: token-derived identity only. Without this, anyone could call
  // /register with a victim's uid and plant their own referral code on them.
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  if (req.body.userId && req.body.userId !== userId)
    return res.status(403).json({ status: 'error', message: 'Forbidden' });
  const { referralCode } = req.body;
  try {
    // Serialise per user: the sign-up flow and the boot self-heal may both call
    // /register — without this lock M0 could pay the welcome bonus twice.
    await withLock('reg:' + userId, async () => {
    const userRef  = db.collection('users').doc(userId);
    const userSnap = await userRef.get();
    if (!userSnap.exists) return res.status(404).json({ status: 'error', message: 'User not found' });
    if (userSnap.data().registrationDone) return res.json({ status: 'already_done', referralCode: userSnap.data().referralCode || null });

    // The referral a new user enters is a referrer's USERNAME. Match case-insensitively.
    // STRICT: a non-empty code in the BODY must belong to a real user — forged/
    // mistyped codes are rejected so registration cannot continue with a dead
    // referral. When the body has no code, fall back to the pendingReferral
    // stored at profile creation (self-heal for interrupted sign-ups); a stored
    // code that no longer resolves must NOT block the account forever.
    const bodyCode   = String(referralCode || '').trim();
    const storedCode = String(userSnap.data().pendingReferral || '').trim();
    const useCode    = bodyCode || storedCode;
    const strict     = !!bodyCode;
    let referrerId = null;
    if (useCode) {
      let refSnap = await db.collection('users').where('usernameLower', '==', useCode.toLowerCase()).limit(1).get();
      if (refSnap.empty) // fall back to legacy referralCode field for any pre-username accounts
        refSnap = await db.collection('users').where('referralCode', '==', useCode).limit(1).get();
      if (refSnap.empty && strict)
        return res.status(400).json({ status: 'error', code: 'BAD_REFERRAL',
          message: 'That referral code does not exist. Check it and try again, or leave it empty.' });
      if (!refSnap.empty && refSnap.docs[0].id === userId && strict)
        return res.status(400).json({ status: 'error', code: 'BAD_REFERRAL',
          message: 'You cannot use your own referral code.' });
      if (!refSnap.empty && refSnap.docs[0].id !== userId) referrerId = refSnap.docs[0].id;
    }

    // A user's referral code is their username (set at profile creation); fall back
    // to a random code only for any legacy account with no username.
    const myRefCode = userSnap.data().referralCode || userSnap.data().username || await generateUniqueRefCode();
    const s = await getSettings();
    const WELCOME = s.welcomeBonus ?? WELCOME_BONUS;
    const { date, time } = nowStr();
    const batch = db.batch();
    const update = { registrationDone: true, referralCode: myRefCode, walletBalance: FieldValue.increment(WELCOME), pendingReferral: '' };

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
    }); // end withLock
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

// ── SAVED WITHDRAWAL (MOBILE-MONEY) ACCOUNTS ──
function detectNetwork(phone) {
  let n = String(phone || '').replace(/\D/g, '');
  if (n.startsWith('256') && n.length === 12) n = n.slice(3);
  if (n.startsWith('0') && n.length === 10) n = n.slice(1);
  const p2 = n.slice(0, 2);
  if (['77', '78', '76', '31', '39'].includes(p2)) return 'MTN';
  if (['70', '74', '75', '71'].includes(p2)) return 'Airtel';
  return 'MTN';
}
app.post('/account/add-bank', async (req, res) => {
  const uid = await verifyAuth(req);
  if (!uid) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const digits = String(req.body.phone || '').replace(/\D/g, '').slice(-9);
  if (digits.length < 9) return res.status(400).json({ status: 'error', message: 'Enter a valid phone number' });
  // Full name of the mobile-money account holder (required, not a bank/label).
  const holderName = String(req.body.holderName || '').replace(/[<>]/g, '').trim().slice(0, 40);
  if (holderName.length < 2 || !/[a-zA-Z]/.test(holderName))
    return res.status(400).json({ status: 'error', message: 'Enter the full name of the account holder' });
  const network = detectNetwork(digits);
  try {
    const snap = await db.collection('users').doc(uid).get();
    const existing = (snap.data().bankAccounts || []);
    if (existing.some(a => a.phone === digits)) return res.json({ status: 'error', message: 'That number is already saved' });
    if (existing.length >= 5) return res.json({ status: 'error', message: 'You can save up to 5 accounts' });
    await db.collection('users').doc(uid).update({ bankAccounts: FieldValue.arrayUnion({ holderName, phone: digits, network }) });
    return res.json({ status: 'success' });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/account/remove-bank', async (req, res) => {
  const uid = await verifyAuth(req);
  if (!uid) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const digits = String(req.body.phone || '').replace(/\D/g, '').slice(-9);
  try {
    const snap = await db.collection('users').doc(uid).get();
    const list = (snap.data().bankAccounts || []).filter(a => a.phone !== digits);
    await db.collection('users').doc(uid).update({ bankAccounts: list });
    return res.json({ status: 'success' });
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

// Team task-centre stats. Calling this ALSO settles any milestone that is due
// (idempotent), so a user opening the Team screen is paid instantly if a
// threshold was crossed while the deposit hook couldn't reach them.
app.get('/team/stats', async (req, res) => {
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const l1DepositTotal = await checkTeamMilestones(userId);
    const uSnap = await db.collection('users').doc(userId).get();
    const u = uSnap.exists ? uSnap.data() : {};
    const milestones = TEAM_MILESTONES.map(m => ({
      target: m.target, reward: m.reward,
      achieved: l1DepositTotal >= m.target,
      paid: !!u['teamMilestone_' + m.target],
    }));
    return res.json({
      status: 'success', l1DepositTotal, milestones,
      counts:  { l1: u.teamL1Count || 0, l2: u.teamL2Count || 0, l3: u.teamL3Count || 0 },
      earned:  { l1: u.commissionL1Earned || 0, l2: u.commissionL2Earned || 0, l3: u.commissionL3Earned || 0,
                 commissions: u.commissionEarned || 0,
                 teamRewards: TEAM_MILESTONES.reduce((s, m) => s + (u['teamMilestone_' + m.target] ? m.reward : 0), 0) },
    });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});

// ═══════════════════════════════════════════
// INVESTMENTS — buy a gem tier, paid out in full at maturity (no daily drip)
// ═══════════════════════════════════════════
app.post('/invest/create', async (req, res) => {
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Please sign in again' });
  const { tierKey } = req.body;
  const tier = (await getProductByKeyOrId(tierKey)) || findGemTier(tierKey);
  if (!tier) return res.status(400).json({ status: 'error', message: 'Unknown gem tier' });
  if (tier.active === false) return res.status(400).json({ status: 'error', message: 'This gem is not available right now' });
  if (tier.comingSoon) return res.status(400).json({ status: 'error', message: 'This gem is coming soon — not on sale yet.' });
  // Ensure derived numbers exist even for a minimally-filled admin product.
  tier.cycle = Number(tier.cycle) || CYCLE_DAYS;
  tier.expectedReturn = Number(tier.expectedReturn) || Math.round((tier.price || 0) * RETURN_MULTIPLE);
  try {
    const uSnap = await db.collection('users').doc(userId).get();
    if (!uSnap.exists) return res.status(404).json({ status: 'error', message: 'User not found' });
    const user = uSnap.data();
    if (user.status === 'banned') return res.status(403).json({ status: 'error', message: 'Account suspended' });
    if ((user.walletBalance || 0) < tier.price)
      return res.status(400).json({ status: 'error', message: `Need ${fmtUGX(tier.price)}, have ${fmtUGX(user.walletBalance || 0)}` });

    const sett = await getSettings();
    const unlockDays = Number(sett.boostUnlockDays ?? BOOST_UNLOCK_DAYS);
    const now = Date.now();
    const matDate = new Date(now + tier.cycle * 86400000);
    const boostUnlockDate = new Date(now + unlockDays * 86400000);
    // Daily cashback schedule: first payout is exactly 24 hours after purchase,
    // then every 24 hours, for `cycle` days. dailyPayout × cycle === expectedReturn
    // (the final payout absorbs any rounding remainder so the total is exact).
    const dailyPayout  = Math.round(tier.expectedReturn / tier.cycle);
    const nextPayoutAt = new Date(now + 86400000);
    let invId;
    await withLock('bal:' + userId, () => db.runTransaction(async t => {
      const uRef  = db.collection('users').doc(userId);
      const fresh = await t.get(uRef);
      const bal   = fresh.data().walletBalance || 0;
      if (bal < tier.price) throw new Error(`Need ${fmtUGX(tier.price)}, have ${fmtUGX(bal)}`);
      const invRef = db.collection('investments').doc();
      invId = invRef.id;
      // Atomic decrement (not absolute write) so even a missed lock only overdraws,
      // never loses a debit.
      t.update(uRef, { walletBalance: FieldValue.increment(-tier.price), totalInvested: FieldValue.increment(tier.price) });
      const { date, time } = nowStr();
      t.set(invRef, {
        userId, tierKey: tier.key, tierLabel: tier.label,
        amount: tier.price, cycle: tier.cycle, expectedReturn: tier.expectedReturn,
        status: 'active', maturityDate: matDate,
        boosted: false, boostUnlockDate,
        dailyPayout, payoutsTotal: tier.cycle, payoutsMade: 0, paidOut: 0, nextPayoutAt,
        date, time, createdAt: FieldValue.serverTimestamp()
      });
      t.set(db.collection('transactions').doc(), {
        userId, type: 'investment', description: `Purchased ${tier.label}`,
        amount: -tier.price, status: 'success', date, time,
        investmentId: invRef.id, tierKey: tier.key, createdAt: FieldValue.serverTimestamp()
      });
    }));
    payCommissions(userId, tier.price, invId).catch(e => console.error('Commission err:', e.message));
    return res.json({ status: 'success', investmentId: invId, message: `Bought ${tier.label} for ${fmtUGX(tier.price)}` });
  } catch (e) {
    console.error('Invest error:', e.message);
    return res.status(400).json({ status: 'error', message: e.message });
  }
});

// BOOST — after the unlock window, pay BOOST_COST_PCT of the gem's total return
// to compress every remaining daily payout into BOOST_MATURE_DAYS. The gem's total
// payout is unchanged; the remaining balance is just paid out over 5 days instead.
app.post('/invest/boost', async (req, res) => {
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Please sign in again' });
  const { investmentId } = req.body;
  if (!investmentId) return res.status(400).json({ status: 'error', message: 'investmentId required' });
  try {
    const invRef  = db.collection('investments').doc(investmentId);
    const invSnap = await invRef.get();
    if (!invSnap.exists) return res.status(404).json({ status: 'error', message: 'Investment not found' });
    const inv = invSnap.data();
    if (inv.userId !== userId) return res.status(403).json({ status: 'error', message: 'Not your investment' });
    if (inv.status !== 'active') return res.status(400).json({ status: 'error', message: 'This gem is no longer active' });
    if (inv.boosted) return res.status(400).json({ status: 'error', message: 'This gem is already boosted' });
    const unlockMs = tsMillis(inv.boostUnlockDate);
    if (unlockMs && Date.now() < unlockMs) {
      const daysLeft = Math.ceil((unlockMs - Date.now()) / 86400000);
      return res.status(400).json({ status: 'error', message: `Boost unlocks in ${daysLeft} day${daysLeft === 1 ? '' : 's'}` });
    }
    const sett = await getSettings();
    const costPct = Number(sett.boostCostPct ?? BOOST_COST_PCT);
    const days    = Number(sett.boostMatureDays ?? BOOST_MATURE_DAYS);
    const cost    = Math.round((inv.expectedReturn || 0) * costPct);
    const newMat  = new Date(Date.now() + days * 86400000);
    const { date, time } = nowStr();
    let err = null, ok = false;
    await withLock('bal:' + userId, () => db.runTransaction(async t => {
      const uRef  = db.collection('users').doc(userId);
      const uSnap = await t.get(uRef);
      if (!uSnap.exists) { err = 'User not found'; return; }
      const bal = uSnap.data().walletBalance || 0;
      if (bal < cost) { err = `Need ${fmtUGX(cost)} to boost, have ${fmtUGX(bal)}`; return; }
      const freshInv = await t.get(invRef);
      const fd = freshInv.exists ? freshInv.data() : null;
      if (!fd || fd.status !== 'active' || fd.boosted) { err = 'This gem cannot be boosted now'; return; }
      // Remaining money still to be paid, now spread across `days` daily payouts.
      const paidOut   = Number(fd.paidOut || 0);
      const remaining = Math.max(0, (fd.expectedReturn || 0) - paidOut);
      const made      = Number(fd.payoutsMade || 0);
      t.update(uRef, { walletBalance: FieldValue.increment(-cost) });
      t.update(invRef, {
        boosted: true, boostedAt: FieldValue.serverTimestamp(), boostAmount: cost,
        maturityDate: newMat, payoutsTotal: made + days,
        dailyPayout: Math.round(remaining / days),
        nextPayoutAt: new Date(Date.now() + 86400000)
      });
      t.set(db.collection('transactions').doc(), {
        userId, type: 'boost', description: `Boosted ${inv.tierLabel || 'gem'} — pays out over ${days} days`,
        amount: -cost, status: 'success', date, time, investmentId, createdAt: FieldValue.serverTimestamp()
      });
      ok = true;
    }));
    if (!ok) return res.status(400).json({ status: 'error', message: err || 'Could not boost' });
    return res.json({ status: 'success', maturesInDays: days, cost, message: `Boosted — pays out over ${days} days` });
  } catch (e) {
    console.error('Boost error:', e.message);
    return res.status(400).json({ status: 'error', message: e.message });
  }
});

// ── DAILY-CASHBACK CRON ──
// Credits each active gem's daily cashback every 24 hours from the exact purchase
// time. Any payouts missed while the server was asleep are caught up in one pass,
// and the final payout pays the exact remaining balance so the total always equals
// expectedReturn. Guarded by a single-run flag + per-gem transaction (M0 has no
// real locks, so we never let two passes credit the same gem twice).
let _payoutRunning = false;
async function runDailyPayouts() {
  if (_payoutRunning) return 0;
  _payoutRunning = true;
  try {
    const snap = await db.collection('investments').where('status', '==', 'active').get();
    if (snap.empty) return 0;
    const now = Date.now();
    let credited = 0;
    for (const doc of snap.docs) {
      try {
        await db.runTransaction(async t => {
          const fresh = await t.get(doc.ref);
          if (!fresh.exists || fresh.data().status !== 'active') return;
          const inv = fresh.data();
          // Lazily migrate gems created before the daily-cashback schedule existed.
          const cycle       = Number(inv.cycle) || CYCLE_DAYS;
          const expected    = Number(inv.expectedReturn) || 0;
          const total       = Number(inv.payoutsTotal) || cycle;
          let   made         = Number(inv.payoutsMade || 0);
          let   paidOut      = Number(inv.paidOut || 0);
          const dailyPayout  = Number(inv.dailyPayout) || Math.round(expected / cycle);
          const createdMs    = tsMillis(inv.createdAt) || now;
          if (made >= total) { t.update(doc.ref, { status: 'matured', maturedAt: FieldValue.serverTimestamp() }); return; }

          // DETERMINISTIC schedule anchored on the PURCHASE time: payout N is due
          // at createdAt + N×24h. This is immune to drift and SELF-HEALS any gem
          // whose stored nextPayoutAt wandered — the countdown always points at
          // the true next 24h mark from purchase, never a shifted minute.
          const elapsedDays = Math.floor((now - createdMs) / 86400000);
          const targetMade  = Math.min(total, Math.max(made, elapsedDays));
          const due         = targetMade - made;
          // nextPayoutAt is ALWAYS recomputed to the exact schedule point, even
          // when nothing is due yet — this is what repairs a drifted value.
          if (due <= 0) {
            t.update(doc.ref, { payoutsTotal: total, payoutsMade: made, paidOut, dailyPayout,
              nextPayoutAt: new Date(createdMs + Math.min(total, made + 1) * 86400000) });
            return;
          }
          const reachesEnd = (made + due) >= total;
          // Final batch pays the exact remaining balance (absorbs any rounding).
          const credit = reachesEnd ? Math.max(0, expected - paidOut) : dailyPayout * due;
          const newMade    = made + due;
          const newPaidOut = paidOut + credit;
          const newNextMs  = createdMs + Math.min(total, newMade + 1) * 86400000;
          const { date, time } = nowStr();
          const upd = { payoutsTotal: total, payoutsMade: newMade, paidOut: newPaidOut,
            dailyPayout, nextPayoutAt: new Date(newNextMs) };
          if (newMade >= total) { upd.status = 'matured'; upd.maturedAt = FieldValue.serverTimestamp(); }
          t.update(doc.ref, upd);
          if (credit > 0) {
            t.update(db.collection('users').doc(inv.userId), {
              walletBalance: FieldValue.increment(credit),
              totalEarned:   FieldValue.increment(credit)
            });
            t.set(db.collection('transactions').doc(), {
              userId: inv.userId, type: 'gem_payout',
              description: `Daily cashback — ${inv.tierLabel || 'Gem'}`,
              amount: credit, status: 'success', date, time, investmentId: doc.id,
              createdAt: FieldValue.serverTimestamp()
            });
          }
        });
        credited++;
      } catch (e) { console.error('Daily payout error:', doc.id, e.message); }
    }
    return credited;
  } catch (e) { console.error('Daily payout check error:', e.message); return 0; }
  finally { _payoutRunning = false; }
}
// ── BACKGROUND PAYMENT SWEEP ──
// Settles every in-flight payment WITHOUT needing the app open or a callback to
// arrive: polls MarzPay directly for all processing deposits and withdrawals,
// credits/fails them, and expires deposit attempts that were abandoned (e.g. a
// user cancelled the PIN prompt and started a new one). This is what keeps
// statuses truthful in near-real-time and stops "stuck on Processing" rows.
let _paySweepRunning = false;
let _sweepN = 0;
async function pollPendingPayments() {
  if (_paySweepRunning || !MARZPAY_KEY) return 0;
  _paySweepRunning = true;
  _sweepN++;
  let settled = 0;
  try {
    // OLDEST first — a busy day can never starve older pending deposits.
    const depSnap = await db.collection('pendingDeposits')
      .where('status', '==', 'processing').orderBy('createdAt', 'asc').limit(60).get();
    for (const doc of depSnap.docs) {
      try {
        const r = await pollMarzDepositStatus(doc);
        if (r.credited || r.failed) { settled++; continue; }
        // Abandoned attempt (cancelled prompt, never paid): expire after 6 hours
        // so it shows honestly as failed instead of processing forever. A LATE
        // success at MarzPay still credits — the rescue pass below re-checks.
        if (Date.now() - tsMillis(doc.data().createdAt) > 6 * 3600000) {
          await doc.ref.update({ status: 'failed', failedAt: FieldValue.serverTimestamp(),
            failureReason: 'Payment window expired' });
          settled++;
        }
      } catch (e) { console.warn('deposit sweep:', doc.id, e.message); }
    }
    // RESCUE PASS (every ~10th sweep ≈ 5 min): deposits we expired or MarzPay
    // reported failed in the last 48h are re-checked — if the gateway NOW says
    // the money arrived (late confirmation after an outage), credit it. This is
    // the "I paid, my carrier SMS proves it, but the app says failed" healer.
    if (_sweepN % 10 === 0) {
      const failSnap = await db.collection('pendingDeposits')
        .where('status', '==', 'failed').orderBy('createdAt', 'desc').limit(150).get();
      for (const doc of failSnap.docs) {
        const d = doc.data();
        if (!d.marzTxUuid) continue;
        if (Date.now() - tsMillis(d.createdAt) > 48 * 3600000) continue;
        try {
          const raw = await marzGetCollectStatus(d.marzTxUuid);
          if (PAY_OK.includes(raw)) {
            if (await creditMarzDeposit(doc, d.amount, null)) { settled++; console.log('RESCUED late deposit', doc.id); }
          }
        } catch (e) { console.warn('deposit rescue:', doc.id, e.message); }
      }
    }
    const witSnap = await db.collection('withdrawals')
      .where('status', '==', 'processing').orderBy('createdAt', 'asc').limit(60).get();
    for (const doc of witSnap.docs) {
      const w = doc.data();
      if (!w.marzTxUuid && !w.marzReference) continue; // no gateway ref — integrity audit flags these
      try {
        const raw = await marzGetStatus(w.marzTxUuid || w.marzReference);
        if (PAY_OK.includes(raw)) { await completeWithdrawal(doc); settled++; }
        else if (PAY_FAIL.includes(raw)) { await failWithdrawal(doc, 'Disbursement failed'); settled++; }
      } catch (e) { console.warn('withdraw sweep:', doc.id, e.message); }
    }
  } catch (e) { console.error('Payment sweep error:', e.message); }
  finally { _paySweepRunning = false; }
  return settled;
}
app.post('/admin/payments/sync', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const settled = await pollPendingPayments();
  return res.json({ status: 'success', settled });
});

// ═══════════════════════════════════════════
// INTEGRITY AUDIT — the server's own accountant. Recomputes every user's
// balance from the transaction ledger and cross-checks it against the stored
// wallet, hunts duplicate credits, negative balances and withdrawals stuck at
// the gateway. Runs hourly + on demand from the admin panel. It NEVER edits
// money by itself — it reports, the owner decides.
// Ledger math: withdrawal rows debit the wallet the moment they are created
// (any status — a failed one is offset by its refund row); every other row
// counts only once it is 'success'.
// ═══════════════════════════════════════════
let _auditRunning = false;
async function auditIntegrity() {
  if (_auditRunning) return null;
  _auditRunning = true;
  try {
    const alerts = [];
    const usersSnap = await db.collection('users').get();
    for (const uDoc of usersSnap.docs) {
      const u = uDoc.data(); const uid = uDoc.id;
      if (!u.registrationDone) continue; // unfinished sign-ups have no ledger yet
      if ((u.walletBalance || 0) < 0)
        alerts.push({ kind: 'negative_balance', userId: uid, username: u.username || '', balance: u.walletBalance });
      const txSnap = await db.collection('transactions').where('userId', '==', uid).get();
      let expected = 0;
      const creditRefs = new Map();
      txSnap.forEach(d => {
        const t = d.data();
        if (t.type === 'withdrawal' || t.status === 'success') expected += (t.amount || 0);
        if (t.type === 'topup' && (t.depositId || t.marzReference)) {
          const k = String(t.depositId || t.marzReference);
          creditRefs.set(k, (creditRefs.get(k) || 0) + 1);
        }
      });
      for (const [ref, n] of creditRefs) if (n > 1)
        alerts.push({ kind: 'duplicate_credit', userId: uid, username: u.username || '', ref, times: n });
      const bal = u.walletBalance || 0;
      if (Math.abs(expected - bal) > 1)
        alerts.push({ kind: 'balance_mismatch', userId: uid, username: u.username || '',
          balance: bal, ledger: expected, diff: bal - expected });
    }
    // Withdrawals stuck in processing — gateway state unknown or unmoving.
    const wSnap = await db.collection('withdrawals').where('status', '==', 'processing').get();
    wSnap.forEach(d => {
      const w = d.data();
      const ageH = Math.round((Date.now() - tsMillis(w.processedAt || w.createdAt)) / 3600000);
      if (!w.marzTxUuid && !w.marzReference && ageH >= 1)
        alerts.push({ kind: 'withdrawal_no_gateway_ref', withdrawalId: d.id, userId: w.userId,
          username: w.userName || '', amount: w.amount, hours: ageH });
      else if (ageH >= 3)
        alerts.push({ kind: 'withdrawal_stuck', withdrawalId: d.id, userId: w.userId,
          username: w.userName || '', amount: w.amount, hours: ageH });
    });
    const result = { ranAt: new Date().toISOString(), usersChecked: usersSnap.size,
      alertCount: alerts.length, healthy: alerts.length === 0, alerts: alerts.slice(0, 200) };
    await db.collection('integrity').doc('latest').set(result);
    if (alerts.length) console.warn('INTEGRITY AUDIT:', alerts.length, 'alert(s)', JSON.stringify(alerts.slice(0, 5)));
    return result;
  } catch (e) { console.error('Integrity audit error:', e.message); return null; }
  finally { _auditRunning = false; }
}
app.post('/admin/integrity', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const result = await auditIntegrity();
  if (!result) return res.status(500).json({ status: 'error', message: 'Audit did not complete (already running?)' });
  return res.json({ status: 'success', ...result });
});

function startCrons() {
  // Every 2 minutes so a payout lands within moments of its exact 24h mark —
  // plus the settle-on-open hook in /account/investments for instant landing.
  setInterval(runDailyPayouts, 60 * 1000);
  setTimeout(runDailyPayouts, 15 * 1000);
  // Background payment settlement — every 45s, so a paid deposit lands even if
  // the user closed the app and the callback never arrived.
  setInterval(pollPendingPayments, 30 * 1000);
  setTimeout(pollPendingPayments, 15 * 1000);
  // Referral safety-net: catch any commission that didn't get paid at invest time.
  setInterval(reconcileCommissions, 10 * 60 * 1000);
  setTimeout(reconcileCommissions, 90 * 1000);
  // Team-milestone safety-net: pay anyone whose team crossed a deposit milestone
  // but never received the reward — automatically, every 10 minutes.
  setInterval(reconcileMilestones, 10 * 60 * 1000);
  setTimeout(reconcileMilestones, 2 * 60 * 1000);
  // Hourly ledger audit — balances vs ledger, duplicate credits, stuck payouts.
  setInterval(auditIntegrity, 60 * 60 * 1000);
  setTimeout(auditIntegrity, 3 * 60 * 1000);
  // Redemption healer — a marked-but-uncredited code redemption always pays out.
  setInterval(reconcileRedemptions, 10 * 60 * 1000);
  setTimeout(reconcileRedemptions, 2 * 60 * 1000);
  // KEEP-WARM: ping Mongo every 4 min so the free M0 connection never goes cold —
  // this is what makes login / admin / check-in feel instant instead of laggy on
  // the first request after a quiet spell.
  setInterval(() => { pingDb().catch(() => {}); }, 4 * 60 * 1000);
  console.log('Crons started (daily cashback 5m, commission reconcile 10m, keep-warm 4m)');
}
app.post('/admin/commissions/reconcile', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const fixed = await reconcileCommissions(2000);
  return res.json({ status: 'success', processed: fixed });
});
app.post('/admin/milestones/reconcile', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  await reconcileMilestones();
  return res.json({ status: 'success' });
});
app.post('/admin/check-maturities', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error' });
  const credited = await runDailyPayouts();
  return res.json({ status: 'success', credited });
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
        checkinEarned:   FieldValue.increment(bonus),
        totalEarned:     FieldValue.increment(bonus)
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
function genCode() { return randChars(10); } // 10 alphanumeric chars (unambiguous charset)
const _codeRateMap   = new Map();  // userId -> last attempt ts
const _redeemingCodes = new Set(); // code doc id -> being redeemed (single-writer)

app.post('/redeem', async (req, res) => {
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Please sign in again' });
  // GLOBAL recognition: uppercase + strip every space/dash, so a code pasted
  // from WhatsApp as "AB CD-EF GH23" still matches exactly what was generated.
  const code = String(req.body.code || '').toUpperCase().replace(/[\s-]/g, '');
  if (!code) return res.status(400).json({ status: 'error', message: 'Enter a code' });
  const lastTry = _codeRateMap.get(userId) || 0;
  if (Date.now() - lastTry < 8000)
    return res.status(429).json({ status: 'error', message: 'Too many attempts. Wait a moment.' });
  _codeRateMap.set(userId, Date.now());
  try {
    const snap = await db.collection('redemptionCodes').where('code', '==', code).limit(1).get();
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
        // ORDER MATTERS on M0 (ops apply sequentially, no rollback): mark the
        // code used FIRST, ledger row second, wallet credit LAST. If the
        // process dies mid-way, reconcileRedemptions() sees "marked but no
        // ledger row" and pays the user — money can be delayed, never lost,
        // and never doubled.
        t.update(doc.ref, { usedBy: FieldValue.arrayUnion(userId) });
        t.set(db.collection('transactions').doc(), {
          userId, type: 'redeem', description: `Code redeemed — ${code}`,
          amount, status: 'success', code, date, time,
          createdAt: FieldValue.serverTimestamp()
        });
        t.update(uRef, { walletBalance: FieldValue.increment(amount), totalEarned: FieldValue.increment(amount) });
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

// REDEMPTION RECONCILER — heals "I redeemed but got nothing": if a user is in
// a code's usedBy list but has NO redeem ledger row for that code (the process
// died between marking and crediting), pay them now. Runs on a cron and from
// the admin panel; the in-lock re-check makes it impossible to pay twice.
async function reconcileRedemptions() {
  let healed = 0;
  try {
    const codesSnap = await db.collection('redemptionCodes').orderBy('createdAt', 'desc').limit(150).get();
    for (const cDoc of codesSnap.docs) {
      const c = cDoc.data();
      const used = c.usedBy || [];
      if (!used.length) continue;
      const txSnap = await db.collection('transactions').where('code', '==', c.code).get();
      const credited = new Set();
      txSnap.forEach(d => { const t = d.data(); if (t.type === 'redeem') credited.add(t.userId); });
      for (const uid of used) {
        if (credited.has(uid)) continue;
        const amount = Math.max(0, Math.round(c.amount || 0));
        if (!amount) continue;
        await withLock('redeemfix:' + cDoc.id + ':' + uid, async () => {
          // Re-check inside the lock so two overlapping sweeps can't both pay.
          const again = await db.collection('transactions').where('code', '==', c.code).get();
          let has = false;
          again.forEach(d => { const t = d.data(); if (t.type === 'redeem' && t.userId === uid) has = true; });
          if (has) return;
          const uSnap = await db.collection('users').doc(uid).get();
          if (!uSnap.exists) return; // account deleted since
          const { date, time } = nowStr();
          await db.runTransaction(async t => {
            t.set(db.collection('transactions').doc(), {
              userId: uid, type: 'redeem', description: `Code redeemed — ${c.code} (recovered)`,
              amount, status: 'success', code: c.code, date, time, createdAt: FieldValue.serverTimestamp() });
            t.update(db.collection('users').doc(uid), {
              walletBalance: FieldValue.increment(amount), totalEarned: FieldValue.increment(amount) });
          });
          healed++;
          console.log('RECOVERED redemption:', c.code, 'user', uid, 'amount', amount);
        });
      }
    }
  } catch (e) { console.error('reconcileRedemptions error:', e.message); }
  return healed;
}
app.post('/admin/redemptions/reconcile', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const healed = await reconcileRedemptions();
  return res.json({ status: 'success', healed });
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
  // Only an ALREADY-CREDITED deposit is refused. A deposit we expired to
  // 'failed' can still be credited later — MarzPay confirming success late
  // (delayed callback, network outage) must always land the user's money.
  if (dep.status === 'matched') return false;
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
      if (fresh.data().status === 'matched') return;
      const uRef = db.collection('users').doc(dep.userId);
      t.update(uRef, {
        walletBalance:  FieldValue.increment(amount),
        totalDeposited: FieldValue.increment(amount),  // team volume
        realDeposited:  FieldValue.increment(amount)   // dashboard (real network only)
      });
      t.update(depDoc.ref, {
        status: 'matched', creditedAmount: amount,
        providerTxId: provTxId || null, matchedAt: FieldValue.serverTimestamp()
      });
      t.set(db.collection('transactions').doc(), {
        userId: dep.userId, type: 'topup', description: 'Wallet top-up',
        amount, status: 'success', date, time, marzReference: dep.marzReference,
        depositId: depDoc.id, createdAt: FieldValue.serverTimestamp()
      });
      didCredit = true;
    });
    // Instant team-milestone check for the depositor's referrer.
    if (didCredit) notifyTeamDeposit(dep.userId).catch(() => {});
    return didCredit;
  } finally { _creditingDeposits.delete(depDoc.id); }
}
async function pollMarzDepositStatus(depDoc) {
  const dep = depDoc.data();
  const uuid = dep.marzTxUuid;
  if (!uuid || !MARZPAY_KEY) return { credited: false, failed: false };
  const rawStatus = await marzGetCollectStatus(uuid);
  const isSuccess = PAY_OK.includes(rawStatus);
  const isFailed  = PAY_FAIL.includes(rawStatus);
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
      callbackUrl: PUBLIC_URL ? PUBLIC_URL + '/deposit/callback' : undefined
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
        t.update(uRef, { walletBalance: FieldValue.increment(amt), totalDeposited: FieldValue.increment(amt), realDeposited: FieldValue.increment(amt) });
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
    if (isSandbox) notifyTeamDeposit(userId).catch(() => {});
    return res.json({ status: 'success', depositId: depRef.id, amount: amt, phone, sandbox: isSandbox });
  } catch (e) {
    console.error('Deposit error:', e.message);
    const friendly = /abort|timeout|fetch failed|network|ENOTFOUND|ECONN|Unexpected token|JSON/i.test(e.message || '')
      ? PROVIDER_BUSY_MSG : (e.message || 'Could not start the payment');
    return res.status(500).json({ status: 'error', message: friendly });
  }
});
// CARD DEPOSIT — global. Creates a card collection and returns MarzPay's
// redirect_url; the app sends the customer there to pay by card. Money settles
// in UGX (their bank converts), so the wallet credit is identical to mobile
// money. Crediting happens via the SAME callback + sweep path (matched on the
// reference), so all the existing double-credit / forgery guards apply.
app.post('/deposit/card', async (req, res) => {
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
    const user = uSnap.data();
    if (user.status === 'banned') return res.status(403).json({ status: 'error', message: 'Account suspended' });
    const minDep = sett.minDeposit ?? MIN_DEPOSIT;
    if (amt < minDep) return res.status(400).json({ status: 'error', message: `Minimum deposit is ${fmtUGX(minDep)}` });
    // MarzPay card limits are 500 – 10,000,000 UGX.
    if (amt > 10000000) return res.status(400).json({ status: 'error', message: 'Maximum card deposit is UGX 10,000,000' });

    const reference = uuidv4();
    const mpData = await marzCollectCard({
      amount: amt, reference, description: user.name || userId,
      country: sett.cardCountry || 'UG',
      callbackUrl: PUBLIC_URL ? PUBLIC_URL + '/deposit/return' : undefined
    });
    if (mpData.status !== 'success')
      return res.status(400).json({ status: 'error', message: marzUserMsg(mpData, 'Could not start the card payment. Please try again.') });

    const redirectUrl = mpData.data?.redirect_url;
    const marzTxUuid  = mpData.data?.transaction?.uuid || null;
    if (!redirectUrl)
      return res.status(400).json({ status: 'error', message: 'Card gateway did not return a payment page. Please try again.' });

    const { date, time } = nowStr();
    const depRef = db.collection('pendingDeposits').doc();
    await depRef.set({
      userId, method: 'card', phone: null, amount: amt,
      marzReference: reference, marzTxUuid,
      status: 'processing', date, time, createdAt: FieldValue.serverTimestamp()
    });
    return res.json({ status: 'success', depositId: depRef.id, amount: amt, redirectUrl });
  } catch (e) {
    console.error('Card deposit error:', e.message);
    const friendly = /abort|timeout|fetch failed|network|ENOTFOUND|ECONN|Unexpected token|JSON/i.test(e.message || '')
      ? PROVIDER_BUSY_MSG : (e.message || 'Could not start the card payment');
    return res.status(500).json({ status: 'error', message: friendly });
  }
});

// The app polls this fast (~1s) while the pending screen is open. We answer
// instantly from the DB and only ask MarzPay itself at most once every 2s per
// deposit — so the user sees the credit the moment it exists without hammering
// the provider.
const _depPollGate = new Map(); // depositId -> last MarzPay check ms
app.get('/deposit/status/:id', async (req, res) => {
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const snap = await db.collection('pendingDeposits').doc(req.params.id).get();
    if (!snap.exists) return res.status(404).json({ status: 'error', message: 'Not found' });
    if (snap.data().userId !== userId) return res.status(403).json({ status: 'error', message: 'Forbidden' });
    let dep = snap.data();
    if (dep.status === 'processing' && Date.now() - (_depPollGate.get(snap.id) || 0) > 2000) {
      _depPollGate.set(snap.id, Date.now());
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
      const isSuccess = PAY_OK.includes(rawStatus);
      const isFailed  = PAY_FAIL.includes(rawStatus);
      if (!isSuccess && !isFailed) return;
      const depSnap = await db.collection('pendingDeposits').where('marzReference', '==', reference).limit(1).get();
      if (depSnap.empty) return;
      const depDoc = depSnap.docs[0];
      if (isSuccess) {
        if (depDoc.data().marzTxUuid) {
          const realStatus = await marzGetCollectStatus(depDoc.data().marzTxUuid);
          if (realStatus && !PAY_OK.includes(realStatus)) return;
        }
        // SECURITY: credit the amount the SERVER initiated the collection for —
        // never an amount from the (unauthenticated) callback body. A forged
        // callback with an inflated amount is therefore worthless.
        const provTxId = body.collection?.provider_transaction_id || null;
        await creditMarzDeposit(depDoc, depDoc.data().amount, provTxId);
      } else if (isFailed) {
        const d = depDoc.data();
        // A settled deposit can NEVER be downgraded — a forged failure on a
        // credited deposit would re-open it for the rescue pass to credit AGAIN.
        if (d.status !== 'processing') return;
        // And a failure report is only believed when MarzPay itself confirms a
        // TERMINAL failure. A transient 'error' verdict is NOT believed — the
        // deposit stays processing for the sweep to re-check.
        if (d.marzTxUuid) {
          const realStatus = await marzGetCollectStatus(d.marzTxUuid);
          if (realStatus && !PAY_FAIL.includes(realStatus)) return;
        }
        const failReason = body.transaction?.description || body.description || rawStatus || 'Payment declined';
        await depDoc.ref.update({ status: 'failed', failedAt: FieldValue.serverTimestamp(), failureReason: failReason });
      }
    } catch (e) { console.error('Deposit callback error:', e.message); }
  });
}
app.post('/callback', handleDepositCallback);
app.post('/deposit/callback', handleDepositCallback);
// Card flow: MarzPay uses ONE callback_url for both the server webhook (POST)
// AND the customer's browser return (GET). POST credits as usual; GET bounces
// the customer straight back into the app (with ?card=1 so it resumes the fast
// pending poll on their deposit).
app.post('/deposit/return', handleDepositCallback);
app.get('/deposit/return', (_req, res) => res.redirect(302, APP_URL + '/?card=1'));

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
    // Anti-abuse: a user must have activated at least one gem before withdrawing
    // (stops someone registering, taking the welcome bonus, and cashing out).
    // Admin-toggleable via settings.requireInvestToWithdraw (default: required).
    const mustInvest = sett.requireInvestToWithdraw !== false;
    if (mustInvest && (user.totalInvested || 0) <= 0)
      return res.status(400).json({ status: 'error', message: 'You need to activate at least one gem before you can withdraw.' });
    if ((user.walletBalance || 0) < amt)
      return res.status(400).json({ status: 'error', message: `Insufficient balance. Available: ${fmtUGX(user.walletBalance || 0)}` });

    const fee = Math.round(amt * feeRate);
    const netAmt = amt - fee;
    const { date, time } = nowStr();
    let witId;
    await withLock('bal:' + userId, () => db.runTransaction(async t => {
      const uRef  = db.collection('users').doc(userId);
      const fresh = await t.get(uRef);
      const bal   = fresh.data().walletBalance || 0;
      if (bal < amt) throw new Error(`Insufficient: ${fmtUGX(bal)}`);
      t.update(uRef, { walletBalance: FieldValue.increment(-amt), withdrawalCount: FieldValue.increment(1) });
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
    }));
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
  // Same in-process lock as completeWithdrawal: two failure reports (or a
  // failure racing a success) can never both act on one withdrawal — M0 has
  // no transaction isolation, so this Set is the only real gate.
  if (_completingWithdrawals.has(witDoc.id)) return false;
  _completingWithdrawals.add(witDoc.id);
  try {
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
  } finally { _completingWithdrawals.delete(witDoc.id); }
}
app.get('/withdraw/status/:id', async (req, res) => {
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const snap = await db.collection('withdrawals').doc(req.params.id).get();
    if (!snap.exists) return res.status(404).json({ status: 'error' });
    if (snap.data().userId !== userId) return res.status(403).json({ status: 'error', message: 'Forbidden' });
    let wit = snap.data();
    if (wit.status === 'processing' && (wit.marzTxUuid || wit.marzReference)) {
      try {
        const rawStatus = await marzGetStatus(wit.marzTxUuid || wit.marzReference);
        const isSuccess = PAY_OK.includes(rawStatus);
        const isFailed  = PAY_FAIL.includes(rawStatus);
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
      const isSuccess = PAY_OK.includes(rawStatus);
      const isFailed  = PAY_FAIL.includes(rawStatus);
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
          if (realStatus && !PAY_OK.includes(realStatus)) return;
        }
        await completeWithdrawal(witDoc);
      } else if (isFailed) {
        // NEVER trust a failure report blindly: a forged "failed" webhook after
        // the money was really sent would refund the user AND leave them paid
        // (double money). Refund only when MarzPay ITSELF confirms the failure.
        const uuid = witDoc.data().marzTxUuid;
        if (!uuid) return; // nothing verifiable was ever sent — sweep/admin decides
        const realStatus = await marzGetStatus(uuid);
        if (!PAY_FAIL.includes(realStatus)) return;
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
      callbackUrl: PUBLIC_URL ? PUBLIC_URL + '/withdraw/callback' : undefined
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
    if (['processed', 'rejected', 'failed'].includes(wit.status))
      return res.status(400).json({ status: 'error', message: 'Already ' + wit.status });
    // Transaction with a fresh status recheck so a concurrent reject / failure
    // callback can never refund the same withdrawal twice.
    let refunded = false;
    await db.runTransaction(async t => {
      const fresh = await t.get(snap.ref);
      const fs = fresh.exists ? fresh.data() : null;
      if (!fs || ['processed', 'rejected', 'failed'].includes(fs.status)) return;
      t.update(snap.ref, {
        status: 'rejected', rejectionReason: reason || 'Rejected by admin', rejectedAt: FieldValue.serverTimestamp()
      });
      t.update(db.collection('users').doc(wit.userId), {
        walletBalance: FieldValue.increment(wit.amount), withdrawalCount: FieldValue.increment(-1)
      });
      refunded = true;
    });
    if (!refunded) return res.status(400).json({ status: 'error', message: 'Already finalised — nothing refunded' });
    // Reflect the rejection in the user's history: flip the original withdrawal
    // record off "Processing" and add a visible refund record.
    try {
      const txSnap = await db.collection('transactions').where('withdrawalId', '==', withdrawalId).limit(1).get();
      if (!txSnap.empty) await txSnap.docs[0].ref.update({ status: 'rejected' });
    } catch (txErr) { console.warn('reject tx update:', txErr.message); }
    const { date, time } = nowStr();
    await db.collection('transactions').add({
      userId: wit.userId, type: 'refund', description: 'Withdrawal refund — request rejected',
      amount: wit.amount, status: 'success', date, time, createdAt: FieldValue.serverTimestamp()
    });
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
    let snap = await db.collection('investments').where('userId', '==', userId).get();
    // Settle-on-open: if any of this user's payouts is due right now, run the
    // payout engine immediately (guarded, idempotent) and re-read — so the
    // cashback lands the moment the countdown reaches zero, not minutes later.
    const due = snap.docs.some(d => {
      const inv = d.data();
      if (inv.status !== 'active') return false;
      // Deterministic: due if more 24h marks have passed since purchase than the
      // number of payouts already made (ignores any drifted stored nextPayoutAt).
      const createdMs = tsMillis(inv.createdAt) || Date.now();
      const total = Number(inv.payoutsTotal) || Number(inv.cycle) || 0;
      const elapsedDays = Math.floor((Date.now() - createdMs) / 86400000);
      return Math.min(total || elapsedDays, elapsedDays) > (inv.payoutsMade || 0);
    });
    if (due) {
      await runDailyPayouts();
      snap = await db.collection('investments').where('userId', '==', userId).get();
    }
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
    const [snap, depSnap, witSnap] = await Promise.all([
      db.collection('transactions').where('userId', '==', userId).limit(300).get(),
      db.collection('pendingDeposits').where('userId', '==', userId).limit(100).get(),
      db.collection('withdrawals').where('userId', '==', userId).limit(100).get(),
    ]);
    const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    // Self-heal: withdrawal records always show the withdrawal's TRUE current
    // status (fixes any historical row stuck on "Processing" after a reject/fail).
    const witStatus = {};
    witSnap.forEach(d => { witStatus[d.id] = d.data().status; });
    list.forEach(t => {
      if (t.type === 'withdrawal' && t.withdrawalId && witStatus[t.withdrawalId]) {
        const ws = witStatus[t.withdrawalId];
        t.status = ws === 'processed' ? 'success'
          : (ws === 'pending' || ws === 'processing') ? 'pending' : 'failed';
      }
    });
    // "I deposited but never saw it": failed / still-processing deposit attempts
    // appear in history too, with their real status, so nothing seems to vanish.
    // (Credited ones already exist as real 'topup' transactions — skip those.)
    depSnap.forEach(d => {
      const dep = d.data();
      if (dep.status === 'matched') return;
      list.push({
        id: 'dep_' + d.id, type: 'topup',
        description: dep.status === 'failed'
          ? 'Deposit failed — money was not taken' : 'Deposit — waiting for approval',
        amount: dep.amount, status: dep.status === 'failed' ? 'failed' : 'pending',
        date: dep.date, time: dep.time, createdAt: dep.createdAt,
      });
    });
    list.sort((a, b) => tsMillis(b.createdAt) - tsMillis(a.createdAt));
    return res.json({ status: 'success', transactions: list.slice(0, 300) });
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
      // Admin credit counts toward TEAM VOLUME (all money in) but NOT toward
      // realDeposited — the dashboard's "Total deposits" stays real-network only.
      t.update(uRef, { walletBalance: FieldValue.increment(amt), totalDeposited: FieldValue.increment(amt) });
      t.set(db.collection('transactions').doc(), {
        userId, type: 'admin_credit', description: note || 'Furagemz credit',
        amount: amt, status: 'success', date, time, createdAt: FieldValue.serverTimestamp()
      });
    });
    // Admin credit adds to team volume too, so it can complete a milestone.
    notifyTeamDeposit(userId).catch(() => {});
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
// ADMIN PASSWORD RESET — the server queries Firebase via the Admin SDK and sets
// a new password for the user. The user doc id IS the Firebase uid, so we reset
// against that. Used when a user is locked out and the self-service SMS reset
// isn't available.
app.post('/admin/user/reset-password', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const { userId, newPassword } = req.body;
  if (!userId) return res.status(400).json({ status: 'error', message: 'userId required' });
  if (!newPassword || String(newPassword).length < 6)
    return res.status(400).json({ status: 'error', message: 'New password must be at least 6 characters' });
  try {
    const snap = await db.collection('users').doc(userId).get();
    if (!snap.exists) return res.status(404).json({ status: 'error', message: 'User not found' });
    // Firebase Auth update — throws if the auth account is missing.
    await admin.auth().updateUser(userId, { password: String(newPassword) });
    return res.json({ status: 'success', message: 'Password reset',
      username: snap.data().username || '', phone: snap.data().phone || '' });
  } catch (e) {
    const msg = /no user record|not.*found/i.test(e.message || '')
      ? 'No Firebase login exists for this account.' : (e.message || 'Could not reset password');
    return res.status(500).json({ status: 'error', message: msg });
  }
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
// ── USER-TOTALS RECOUNT ──
// Rebuilds every user's running counters (totalDeposited, totalEarned,
// commissionEarned incl. per-level, checkinEarned, totalWithdrawn) from the
// transactions ledger — the source of truth — so the stat tiles in the app can
// never drift from reality (e.g. credits made before a counter existed, or
// requests lost while the server was down). Safe to re-run any time: it SETS
// exact recomputed values, so running twice changes nothing.
// totalDeposited = TEAM VOLUME (all money members put in: real deposits + admin
// credits). realDeposited = ONLY real network deposits (MoMo + card) — that is
// what the dashboard's "Total deposits" shows. Welcome gift is excluded from both.
const DEP_TYPES  = new Set(['topup', 'admin_credit']); // all money in → team volume
const REAL_DEP   = new Set(['topup']);                 // real network only → dashboard
const EARN_TYPES = new Set(['gem_payout', 'checkin', 'commission', 'redeem', 'team_reward']);
const OK_STATUS  = new Set(['success', 'processed', 'matched']);
async function recountUserTotals() {
  const [txSnap, witSnap, usersSnap] = await Promise.all([
    db.collection('transactions').get(),
    db.collection('withdrawals').where('status', '==', 'processed').get(),
    db.collection('users').limit(10000).get(),
  ]);
  const zero = () => ({ totalDeposited: 0, realDeposited: 0, totalEarned: 0, commissionEarned: 0,
    commissionL1Earned: 0, commissionL2Earned: 0, commissionL3Earned: 0,
    checkinEarned: 0, totalWithdrawn: 0 });
  const agg = {};
  const bucket = id => (agg[id] = agg[id] || zero());
  txSnap.forEach(d => {
    const t = d.data();
    if (!t.userId || !(t.amount > 0)) return;
    if (t.status && !OK_STATUS.has(String(t.status).toLowerCase())) return;
    const b = bucket(t.userId);
    // Welcome gift is a sign-up bonus, not money the member put in — exclude it.
    const notWelcome = t.description !== 'Welcome gift';
    if (DEP_TYPES.has(t.type) && notWelcome) b.totalDeposited += t.amount;   // team volume
    if (REAL_DEP.has(t.type)  && notWelcome) b.realDeposited  += t.amount;   // dashboard
    if (EARN_TYPES.has(t.type)) b.totalEarned += t.amount;
    if (t.type === 'commission') {
      b.commissionEarned += t.amount;
      if (t.level === 1) b.commissionL1Earned += t.amount;
      else if (t.level === 2) b.commissionL2Earned += t.amount;
      else if (t.level === 3) b.commissionL3Earned += t.amount;
    }
    if (t.type === 'checkin') b.checkinEarned += t.amount;
  });
  witSnap.forEach(d => {
    const w = d.data();
    if (w.userId) bucket(w.userId).totalWithdrawn += (w.netAmount || w.amount || 0);
  });
  let updated = 0;
  for (const doc of usersSnap.docs) {
    try { await db.collection('users').doc(doc.id).update(agg[doc.id] || zero()); updated++; }
    catch (e) { console.error('recount update error:', doc.id, e.message); }
  }
  return updated;
}
// ONE-TIME BACKFILL: seed the ledger-based "already paid" markers from the real
// team_reward transactions, so the milestone reconciler never re-pays a reward
// that was genuinely paid before — while still paying anyone who legitimately
// missed theirs. Runs exactly once. (Clears the older seal flag if present.)
async function backfillMilestonePaidOnce() {
  try {
    const s = await getSettings();
    if (s.milestonePaidBackfillDone) return;
    const txSnap = await db.collection('transactions').where('type', '==', 'team_reward').get();
    const byUser = {};
    txSnap.forEach(d => {
      const t = d.data();
      if (t.userId && t.milestone) (byUser[t.userId] = byUser[t.userId] || {})['teamRewardPaidV2_' + t.milestone] = true;
    });
    let n = 0;
    for (const [uid, upd] of Object.entries(byUser)) { await db.collection('users').doc(uid).update(upd).catch(() => {}); n++; }
    await db.collection('settings').doc('main').set({ milestonePaidBackfillDone: true }, { merge: true });
    _settingsCache = null; _settingsCacheTs = 0; // so milestone payments resume at once
    console.log('Milestone paid-marker backfill done for', n, 'user(s); reconciler will now heal missed rewards.');
  } catch (e) { console.error('backfillMilestonePaidOnce error:', e.message); }
}

// One-time rate update (owner's call, 2026-07): check-in bonus 500, withdrawal
// fee 14%. Forced into the settings doc once so an older admin-saved value
// (300 / 5%) can't override the new defaults; admin can still change them later.
async function runRatePatchOnce() {
  try {
    const s = await getSettings();
    if (s.ratePatchV2Done) return;
    await db.collection('settings').doc('main').set(
      { checkinBonus: 500, liquidityFee: 0.14, ratePatchV2Done: true }, { merge: true });
    _settingsCache = null; _settingsCacheTs = 0;
    console.log('Rate patch applied: check-in 500, withdrawal fee 14%');
  } catch (e) { console.error('Rate patch error:', e.message); }
}

// One-time self-heal at boot: fixes every account whose counters predate the
// counter fixes (e.g. check-ins that never counted into totalEarned).
async function runRecountMigrationOnce() {
  try {
    const s = await getSettings();
    if (s.recountV1Done) return;
    const n = await recountUserTotals();
    await db.collection('settings').doc('main').set({ recountV1Done: true }, { merge: true });
    _settingsCache = null; _settingsCacheTs = 0;
    console.log('User-totals recount migration done:', n, 'users');
  } catch (e) { console.error('Recount migration error:', e.message); }
}
app.post('/admin/users/recount', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try { return res.json({ status: 'success', updated: await recountUserTotals() }); }
  catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});

// PERMANENT account deletion: removes the user and ALL their data — transactions,
// investments, deposits, withdrawals, referral links — fixes the referrer's team
// counts up the chain, and frees the phone number in Firebase so it can register
// again. Requires confirm:"DELETE" so a stray click can never wipe an account.
app.post('/admin/user/delete', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const { userId, confirm } = req.body;
  if (!userId) return res.status(400).json({ status: 'error', message: 'userId required' });
  if (confirm !== 'DELETE') return res.status(400).json({ status: 'error', message: 'Type DELETE to confirm' });
  try {
    const uSnap = await db.collection('users').doc(userId).get();
    if (!uSnap.exists) return res.status(404).json({ status: 'error', message: 'User not found' });
    const u = uSnap.data();
    // Walk the referral chain and correct team counts before the link is lost.
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
      referralsOut:  await wipe('referrals', 'referrerId'),
      referralsIn:   await wipe('referrals', 'referredUserId'),
    };
    await db.collection('users').doc(userId).delete();
    // Free the phone number for re-registration (best-effort; auth may lag).
    try { await admin.auth().deleteUser(userId); } catch (fbErr) { console.warn('delete: firebase auth:', fbErr.message); }
    return res.json({ status: 'success', message: 'Account and all its data deleted', removed });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});

// Voltra-style "Assign & Credit": when the owner has verified a payment on the
// MarzPay dashboard but the API/webhook can't confirm it, force-credit the
// deposit to its user. Uses the same locked, idempotent credit path — a
// force-credit can never double-credit, and an already-matched deposit is a no-op.
app.post('/admin/deposit/force-credit', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const { depositId } = req.body;
  if (!depositId) return res.status(400).json({ status: 'error', message: 'depositId required' });
  try {
    let snap = await db.collection('pendingDeposits').doc(depositId).get();
    if (!snap.exists) return res.status(404).json({ status: 'error', message: 'Deposit not found' });
    if (snap.data().status === 'matched') return res.json({ status: 'success', message: 'Already credited' });
    if (snap.data().status === 'failed') {
      // Owner has verified the money actually arrived — revive, then credit.
      await snap.ref.update({ status: 'processing', revivedByAdminAt: FieldValue.serverTimestamp() });
      snap = await db.collection('pendingDeposits').doc(depositId).get();
    }
    const ok = await creditMarzDeposit(snap, snap.data().amount, 'ADMIN-FORCED');
    if (!ok) return res.status(409).json({ status: 'error', message: 'Could not credit — try again' });
    return res.json({ status: 'success', message: `Force-credited ${fmtUGX(snap.data().amount)} to the user` });
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
    let totalWallet = 0, totalDeposited = 0, totalVolume = 0, totalWithdrawn = 0, totalInvested = 0,
        totalEarned = 0, totalCommissions = 0, referredUsers = 0;
    usersSnap.forEach(d => {
      const u = d.data();
      totalWallet      += u.walletBalance   || 0;
      // Dashboard "Total deposits" = REAL network deposits only (realDeposited).
      totalDeposited   += u.realDeposited   || 0;
      totalVolume      += u.totalDeposited  || 0;  // all money in (deposits + admin credits)
      totalWithdrawn   += u.totalWithdrawn  || 0;
      totalInvested    += u.totalInvested   || 0;
      totalEarned      += u.totalEarned     || 0;
      totalCommissions += u.commissionEarned || 0;
      if (u.referredBy) referredUsers += 1;
    });
    // Cashback still owed on active gems (expectedReturn minus what's been paid).
    let outstandingPayout = 0;
    investmentsSnap.forEach(d => {
      const inv = d.data();
      outstandingPayout += Math.max(0, (inv.expectedReturn || 0) - (inv.paidOut || 0));
    });
    let pendingPayouts = 0;
    withdrawalsSnap.forEach(d => pendingPayouts += (d.data().netAmount || d.data().amount || 0));
    // Overall health: real money that came in vs everything the platform still owes
    // (current wallet balances + pending withdrawals + future gem cashback).
    const netCashIn    = totalDeposited - totalWithdrawn;
    const liabilities  = totalWallet + pendingPayouts + outstandingPayout;
    const healthBalance = netCashIn - liabilities;
    return res.json({
      status: 'success',
      userCount: usersSnap.size,
      totalWallet, totalDeposited, totalVolume, totalWithdrawn,
      totalInvested, totalEarned, totalCommissions, referredUsers,
      pendingWithdrawals: withdrawalsSnap.size, pendingPayouts,
      activeInvestments: investmentsSnap.size, outstandingPayout,
      netCashIn, liabilities, healthBalance
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
    const [snap, invSnap] = await Promise.all([
      db.collection('users').doc(userId).get(),
      db.collection('investments').where('userId', '==', userId).limit(50).get(),
    ]);
    if (!snap.exists) return res.status(404).json({ status: 'error', message: 'User not found' });
    const investments = invSnap.docs.map(d => {
      const v = d.data();
      return { id: d.id, tierLabel: v.tierLabel, amount: v.amount, status: v.status,
        paidOut: v.paidOut || 0, expectedReturn: v.expectedReturn, createdAt: v.createdAt };
    });
    investments.sort((a, b) => tsMillis(b.createdAt) - tsMillis(a.createdAt));
    return res.json({ status: 'success', user: { id: snap.id, ...snap.data() }, investments });
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
    const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    // Resolve the referrer / new-user IDs to usernames so the panel is readable.
    const ids = [...new Set(rows.flatMap(r => [r.referrerId, r.referredUserId]).filter(Boolean))];
    const names = {};
    await Promise.all(ids.map(async id => {
      try { const u = await db.collection('users').doc(id).get(); if (u.exists) names[id] = u.data().username || u.data().name || u.data().phone || id; }
      catch (_) {}
    }));
    rows.forEach(r => { r.referrerName = names[r.referrerId] || r.referrerId || '—'; r.referredName = names[r.referredUserId] || r.referredUserId || '—'; });
    return res.json({ status: 'success', referrals: rows });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});

// ── ADMIN: GEM PRODUCTS (create/edit/delete) ──
app.post('/admin/products/list', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try { return res.json({ status: 'success', products: await fetchProducts(true) }); }
  catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/products/save', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const { id } = req.body;
  const price = Math.round(parseFloat(req.body.price) || 0);
  if (price <= 0) return res.status(400).json({ status: 'error', message: 'Price is required' });
  const cycle = Math.max(1, Math.round(parseFloat(req.body.cycle) || CYCLE_DAYS));
  const expectedReturn = Math.round(parseFloat(req.body.expectedReturn) || price * RETURN_MULTIPLE);
  const label = String(req.body.label || '').replace(/[<>]/g, '').trim().slice(0, 40) || 'Gem';
  const key = String(req.body.key || label).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24) || ('gem' + Date.now());
  const data = {
    key, label, price, cycle, expectedReturn, dailyReturn: expectedReturn / cycle,
    // Allow both short hosted URLs and full base64 data-URI uploads (the admin
    // downscales images before sending, so this stays well under the 8mb body cap).
    image: String(req.body.image || '').trim().slice(0, 4000000),
    color: String(req.body.color || '#7c3aed').trim().slice(0, 24),
    order: Math.round(parseFloat(req.body.order) || 0),
    active: req.body.active !== false && req.body.active !== 'false',
    comingSoon: req.body.comingSoon === true || req.body.comingSoon === 'true',
    updatedAt: FieldValue.serverTimestamp(),
  };
  try {
    if (id) { await db.collection('products').doc(id).update(data); return res.json({ status: 'success', id, action: 'updated' }); }
    data.createdAt = FieldValue.serverTimestamp();
    const ref = db.collection('products').doc();
    await ref.set(data);
    return res.json({ status: 'success', id: ref.id, action: 'created' });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/products/delete', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  if (!req.body.id) return res.status(400).json({ status: 'error', message: 'id required' });
  try { await db.collection('products').doc(req.body.id).delete(); return res.json({ status: 'success' }); }
  catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});
// One-click reset: push the default GEM_TIERS ladder (current prices, ×RETURN_MULTIPLE
// payout, fixed cycle) into the DB. Matches existing gems by key and updates their
// price/cycle/payout/label; any uploaded image, colour, order and active flag are
// kept. Missing tiers are created. Use after changing the ladder in code.
app.post('/admin/products/reseed', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const snap = await db.collection('products').get();
    const byKey = {};
    snap.docs.forEach(d => { const k = (d.data().key || '').toLowerCase(); if (k) byKey[k] = { id: d.id, ...d.data() }; });
    let updated = 0, created = 0;
    for (let i = 0; i < GEM_TIERS.length; i++) {
      const t = GEM_TIERS[i];
      const core = { key: t.key, label: t.label, price: t.price, cycle: t.cycle,
        expectedReturn: t.expectedReturn, dailyReturn: t.dailyReturn,
        color: GEM_COLORS[t.key] || '#7c3aed', updatedAt: FieldValue.serverTimestamp() };
      const existing = byKey[t.key];
      if (existing) { await db.collection('products').doc(existing.id).update(core); updated++; }
      else {
        await db.collection('products').add({ ...core, image: '', color: GEM_COLORS[t.key] || '#7c3aed',
          order: i, active: true, createdAt: FieldValue.serverTimestamp() });
        created++;
      }
    }
    return res.json({ status: 'success', updated, created, tiers: GEM_TIERS.map(t => ({ label: t.label, price: t.price, expectedReturn: t.expectedReturn, cycle: t.cycle })) });
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
    console.log(`  URL: ${PUBLIC_URL || '(RENDER_EXTERNAL_URL not set yet)'}`);
  });

  let cronsStarted = false;
  const tryConnect = async () => {
    try {
      await connectMongo(MONGODB_URI);
      if (!cronsStarted) { cronsStarted = true; startCrons(); seedProducts();
        (async () => { await runRecountMigrationOnce(); await runRatePatchOnce(); await backfillMilestonePaidOnce(); await reconcileMilestones(); })().catch(() => {});
      }
    } catch (e) {
      console.error('MongoDB not reachable yet — retrying in 5s:', e.message);
      setTimeout(tryConnect, 5000);
    }
  };
  tryConnect();
}
startServer().catch(e => { console.error('Startup error:', e.message); process.exit(1); });
