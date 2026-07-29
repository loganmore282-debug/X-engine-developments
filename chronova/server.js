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
// No legitimate Chronova request uses keys starting with "$" or containing ".",
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
app.use('/admin/login', adminLoginLimiter);
app.use('/admin/', adminLimiter);
// Best-effort: if a Bearer token is a valid admin session, attach req.adminUser
// so verifyAdmin()/verifyOwner() below can recognise it. A raw master-key
// Authorization header simply won't match any session and falls through.
app.use('/admin/', async (req, res, next) => {
  const header = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (header) { try { req.adminUser = await resolveSession(header); } catch (_) {} }
  next();
});
// Money/value endpoints added in phase 2 will be registered here as they land:
['/checkin', '/withdraw/request', '/invest/create', '/deposit/marzpay', '/deposit/card', '/redeem']
  .forEach(p => app.use(p, apiLimiter));

// ── MAINTENANCE GATE ──
// When maintenance mode is on, every money/account action is blocked for normal
// users (admin panel, auth, health and public read-only endpoints stay open so
// the owner can still work and the app can show a maintenance screen).
const MAINTENANCE_BLOCK = ['/account', '/invest', '/deposit', '/withdraw', '/checkin', '/redeem', '/team', '/register'];
// Payment-provider webhooks/callbacks must ALWAYS run, even in maintenance,
// or deposits/withdrawals in flight would never get confirmed.
const GUARD_EXEMPT = new Set(['/', '/health', '/callback', '/deposit/callback', '/deposit/return', '/withdraw/callback', '/deposit/obpay-callback', '/obpay/webhook', '/withdraw/obpay-callback', '/obpay/payout-webhook', '/zenga/webhook', '/deposit/zenga-callback', '/withdraw/zenga-callback']);
app.use(async (req, res, next) => {
  if (GUARD_EXEMPT.has(req.path)) return next();
  if (!MAINTENANCE_BLOCK.some(p => req.path.startsWith(p))) return next();
  try {
    const s = await getSettings();
    if (s && s.maintenanceMode) {
      return res.status(503).json({ status: 'error', code: 'MAINTENANCE',
        message: s.maintenanceMsg || 'Chronova is under maintenance. Please check back shortly.' });
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
// ── ObPay (mobile-money DEPOSITS). Withdrawals stay on MarzPay. ──
// The API URL + public (anon) key are the same for every ObPay merchant; only the
// secret key + webhook secret are ours and MUST come from env (never hard-coded).
const OBPAY_URL        = (process.env.OBPAY_URL || 'https://k5nkqygnd0i42zb1n5c3.helloreaddy.com/functions/v1/obpay-api-no-jwt').trim();
const OBPAY_PUBLIC_KEY = process.env.OBPAY_PUBLIC_KEY || 'sb_publishable_dFKnLJZfWkXfRVr9l97rEm5s8RweReFt';
const OBPAY_SECRET_KEY = process.env.OBPAY_SECRET_KEY || '';
const OBPAY_WEBHOOK_SECRET = process.env.OBPAY_WEBHOOK_SECRET || '';
// ── ZengaPay (Chronova's default gateway) ──
const ZENGA_BASE          = (process.env.ZENGA_BASE || 'https://api.zengapay.com/v1').trim().replace(/\/$/, '');
const ZENGA_API_KEY       = process.env.ZENGA_API_KEY || '';
const ZENGA_WEBHOOK_SECRET = process.env.ZENGA_WEBHOOK_SECRET || '';
// ── MarzSMS (admin alerts for the manual deposit/withdrawal flow) ──
const MARZSMS_BASE   = (process.env.MARZSMS_BASE || 'https://sms.wearemarz.com/api/v1').trim().replace(/\/$/, '');
const MARZSMS_KEY    = process.env.MARZSMS_KEY    || '';
const MARZSMS_SECRET = process.env.MARZSMS_SECRET || '';
// ── Manual (recipient-number) payment flow ──
const MANUAL_ORDER_TTL_MS           = 15 * 60 * 1000; // escrow window: pay within 15 minutes
const MANUAL_MAX_PENDING_PER_NUMBER = 3;              // anti-flood: soft cap of live orders per number
// Where a card customer is bounced back to after paying on the gateway.
const APP_URL = (process.env.APP_URL || 'https://www.chronova-plaform.com').trim().replace(/\/$/, '');

const APP_VERSION      = '1.7.0';   // shown on the in-app "Download app" screen
const APP_SIZE         = '2.4 MB';  // approximate installed PWA size
const MIN_DEPOSIT      = 25000;
const MIN_WITHDRAWAL   = 10000;   // no multiples restriction
const WELCOME_BONUS    = 5000;
const CHECKIN_BONUS    = 500;
const COMM_L1          = 0.30;    // referral bonus, level 1
const COMM_L2          = 0.03;    // level 2
const COMM_L3          = 0.01;    // level 3
const LIQUIDITY_FEE    = 0.17;    // withdrawal fee
const RETURN_MULTIPLE  = 30;      // payout = price * RETURN_MULTIPLE
const CYCLE_DAYS       = 120;     // investment period (days), fixed for every watch tier
// EARNINGS: each product pays daily cashback (expectedReturn / cycle) every 24 hours
// from the exact purchase time, for `cycle` days, totalling expectedReturn.
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


// TASK CENTER — milestone rewards on the COUNT of a user's ACTIVE level-1
// referrals (an active referral = one who has deposited and activated at least
// one watch tier). Each tier is claimed manually once its target is reached —
// the server always recomputes the live count at claim time, it never trusts
// the client. `target` is a member COUNT, not money.
const TEAM_MILESTONES = [
  { target:   5, reward:   10000 },
  { target:  10, reward:   20000 },
  { target:  20, reward:   40000 },
  { target:  50, reward:  100000 },
  { target: 100, reward:  200000 },
  { target: 200, reward:  500000 },
  { target: 500, reward: 1000000 },
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
  // MarzPay's transient provider faults come back with several generic phrasings
  // ("An unexpected error occurred. Please try again.", "database error",
  // "internal server error", gateway/timeout). Map them ALL to one friendly
  // message. Genuinely actionable reasons (insufficient balance, invalid phone,
  // limits) don't match these patterns, so they're passed through untouched.
  if ((mp && (mp.providerDown || mp.error_code === 'DATABASE_ERROR')) ||
      /database error|internal server|server error|unexpected error|try again|temporarily|timeout|timed out|gateway|unavailable|bad gateway/i.test(raw))
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

// ── ObPay CLIENT (deposits) ──
// Direct HTTP: X-API-Key carries our secret; `apikey` carries the public anon key
// the Supabase gateway needs. Body always has _action. Money-safety NEVER trusts a
// webhook — success is always re-confirmed with obpayGetStatus (authenticated), so
// a forged callback is worthless. Credits the user the gross amount THEY paid; the
// 5% ObPay platform fee is the platform's cost, not the user's.
async function obpayCall(action, extra = {}) {
  const resp = await fetch(OBPAY_URL, {
    method: 'POST', signal: AbortSignal.timeout(MARZ_TIMEOUT),
    headers: {
      'Content-Type': 'application/json',
      'apikey': OBPAY_PUBLIC_KEY,
      'Authorization': `Bearer ${OBPAY_PUBLIC_KEY}`,
      'X-API-Key': OBPAY_SECRET_KEY
    },
    body: JSON.stringify({ _action: action, _api_key: OBPAY_SECRET_KEY, ...extra })
  });
  try { return await resp.json(); }
  catch (_) { return { success: false, error: PROVIDER_BUSY_MSG, providerDown: true }; }
}
async function obpayCollect({ amount, phone, reference, description }) {
  const r = await obpayCall('collect', {
    phoneNumber: phone, amount: Number(amount), currency: 'UGX',
    reference: String(reference).slice(0, 30), description: description || 'Deposit'
  });
  return r; // { success, data:{ reference, transaction_id, status:'pending' } } | { success:false, error }
}
async function obpayPayout({ amount, phone, reference, description }) {
  const r = await obpayCall('payout', {
    phoneNumber: phone, amount: Number(amount), currency: 'UGX',
    reference: String(reference).slice(0, 30), description: description || 'Payout'
  });
  return r; // { success, data:{ reference, transaction_id, status:'pending' } } | { success:false, error }
}
// Returns ObPay's real status for a reference (lowercased): 'success'|'pending'|'failed'|''.
async function obpayGetStatus(reference) {
  try {
    const r = await obpayCall('transaction-status', { reference });
    return String(r?.data?.status || r?.status || '').toLowerCase();
  } catch (_) { return ''; }
}
// Short, space-free, ≤30-char reference (ObPay rejects long/spaced refs).
function obpayRef() { return ('FZ-' + Date.now().toString(36) + '-' + randChars(6)).toUpperCase().slice(0, 30); }
// ── ZengaPay CLIENT (deposits = Collections, withdrawals = Transfers) ──
// Auth: Bearer <API key>. Money-safety identical to the others: a webhook is NEVER
// trusted — success is always re-confirmed with ZengaPay's authenticated GET status
// endpoint before any credit/complete/refund. Requires the server's egress IP to be
// whitelisted in the ZengaPay dashboard (Settings → Developer Settings).
async function zengaCall(path, method, body) {
  const resp = await fetch(ZENGA_BASE + path, {
    method, signal: AbortSignal.timeout(MARZ_TIMEOUT),
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ZENGA_API_KEY}` },
    body: body ? JSON.stringify(body) : undefined
  });
  let j; try { j = await resp.json(); } catch (_) { j = { providerDown: true, message: PROVIDER_BUSY_MSG }; }
  j._http = resp.status;
  return j;
}
// ZengaPay wants an international MSISDN with no '+': 2567XXXXXXXX / 2567XXXXXXXX.
function zengaMsisdn(phone) {
  let p = String(phone).replace(/\D/g, '');
  if (p.startsWith('0')) p = '256' + p.slice(1);
  if (p.length === 9) p = '256' + p;
  return p;
}
// external_reference must be unique per request, short & space-free.
function zengaRef() { return ('CHR' + Date.now().toString(36) + randChars(6)).toUpperCase().slice(0, 30); }
async function zengaCollect({ amount, phone, reference, description }) {
  const r = await zengaCall('/collections', 'POST', {
    msisdn: zengaMsisdn(phone), amount: Number(amount),
    external_reference: String(reference), narration: String(description || 'Deposit').slice(0, 60)
  });
  const ok = [200, 201, 202].includes(r._http) && (r.transactionReference || r.status);
  return { success: !!ok, reference: r?.transactionReference || null,
           error: ok ? null : (r?.message || PROVIDER_BUSY_MSG), providerDown: r?.providerDown };
}
async function zengaPayout({ amount, phone, reference, description }) {
  const r = await zengaCall('/transfers', 'POST', {
    msisdn: zengaMsisdn(phone), amount: Number(amount),
    external_reference: String(reference), narration: String(description || 'Payout').slice(0, 60), use_contact: false
  });
  const ok = [200, 201, 202].includes(r._http) && (r.transactionReference || r.status === 'accepted');
  return { success: !!ok, reference: r?.transactionReference || null,
           error: ok ? null : (r?.message || PROVIDER_BUSY_MSG), providerDown: r?.providerDown };
}
// Normalised status for a ZengaPay transaction. kind = 'collections' | 'transfers'.
// Maps SUCCEEDED→success, FAILED→failed, PENDING/INDETERMINATE→pending.
async function zengaGetStatus(theirRef, kind) {
  if (!theirRef) return '';
  try {
    const r = await zengaCall('/' + kind + '/' + theirRef, 'GET');
    const s = String(r?.data?.transactionStatus || r?.transactionStatus || '').toUpperCase();
    if (s === 'SUCCEEDED') return 'success';
    if (s === 'FAILED')    return 'failed';
    if (s === 'PENDING' || s === 'INDETERMINATE') return 'pending';
    return '';
  } catch (_) { return ''; }
}
// Real payout status for a withdrawal, whichever provider sent it (lowercased).
async function getPayoutStatus(wit) {
  if (wit.provider === 'zengapay') return await zengaGetStatus(wit.zengaTxRef || wit.marzReference, 'transfers');
  if (wit.provider === 'obpay') return await obpayGetStatus(wit.marzReference);
  return await marzGetStatus(wit.marzTxUuid || wit.marzReference);
}

// ── MarzSMS CLIENT (admin alerts) — HTTP Basic Auth (key:secret) ──
// Uganda intl format for MarzSMS: +256XXXXXXXXX.
function toIntlUg(phone) {
  let p = String(phone || '').replace(/[^\d]/g, '');
  if (p.startsWith('256')) return '+' + p;
  if (p.startsWith('0'))   return '+256' + p.slice(1);
  if (p.length === 9)      return '+256' + p;
  return p ? '+' + p : '';
}
async function sendSms(recipient, message) {
  if (!MARZSMS_KEY || !MARZSMS_SECRET || !recipient) return { success: false, skipped: true };
  try {
    const auth = Buffer.from(MARZSMS_KEY + ':' + MARZSMS_SECRET).toString('base64');
    const resp = await fetch(MARZSMS_BASE + '/sms/send', {
      method: 'POST', signal: AbortSignal.timeout(MARZ_TIMEOUT),
      headers: { 'Authorization': 'Basic ' + auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient, message: String(message).slice(0, 320) })
    });
    let j; try { j = await resp.json(); } catch (_) { j = {}; }
    return { success: !!j.success, data: j };
  } catch (e) { console.error('sendSms error:', e.message); return { success: false, error: e.message }; }
}
// Alert every admin phone configured in settings (comma-separated). Never throws.
async function notifyAdmins(message) {
  try {
    const s = await getSettings();
    const phones = String(s.adminAlertPhones || '')
      .split(',').map(x => toIntlUg(x)).filter(Boolean);
    if (!phones.length) return;
    await sendSms(phones.join(','), message).catch(() => {});
  } catch (_) {}
}

// Browser push (FCM) to every registered admin/owner device, equally — one
// pending withdrawal or completed deposit reaches all of them at once. Dead
// tokens (uninstalled, permission revoked) are pruned from the response so
// the token list never grows unbounded. Never throws — a push failure must
// never break the money flow that triggered it.
async function sendAdminPush(title, body, data) {
  try {
    const snap = await db.collection('adminPushTokens').get();
    const tokens = snap.docs.map(d => d.data().token).filter(Boolean);
    if (!tokens.length) return;
    const resp = await admin.messaging().sendEachForMulticast({
      tokens,
      notification: { title, body },
      data: Object.fromEntries(Object.entries(data || {}).map(([k, v]) => [k, String(v)])),
      webpush: { fcmOptions: { link: '/' } }
    });
    const dead = [];
    resp.responses.forEach((r, i) => {
      if (!r.success && /registration-token-not-registered|invalid-argument/.test(r.error?.code || '')) dead.push(tokens[i]);
    });
    if (dead.length) {
      const doomed = await db.collection('adminPushTokens').where('token', 'in', dead).get();
      await Promise.all(doomed.docs.map(d => d.ref.delete()));
    }
  } catch (e) { console.warn('sendAdminPush error:', e.message); }
}

// ── SETTINGS CACHE — reads MongoDB `settings/main`, TTL 5 min ──
// Admin-editable rates live here; hardcoded constants above are fallbacks
// only, so a bad DB value never breaks the server.
let _settingsCache = null, _settingsCacheTs = 0;
let _bannersCache = null, _bannersCacheTs = 0;
// Each banner is its own document (id = slot key, e.g. bannerHero) so a save is
// physically incapable of affecting another slot, and no single document grows
// with every image. Legacy banners still sitting in settings/main are folded in
// as a fallback so nothing already uploaded disappears.
async function getBanners() {
  if (_bannersCache && Date.now() - _bannersCacheTs < 5 * 60 * 1000) return _bannersCache;
  const out = {};
  try {
    const snap = await db.collection('banners').get();
    snap.docs.forEach(d => { const v = d.data(); if (v && v.url) out[d.id] = v.url; });
  } catch (_) {}
  try {
    const s = await getSettings();
    for (const k of Object.keys(s)) if (k.startsWith('banner') && s[k] && !out[k]) out[k] = s[k];
  } catch (_) {}
  _bannersCache = out; _bannersCacheTs = Date.now();
  return out;
}
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
function phoneToEmail(phone) { return String(phone).replace(/\D/g,'') + '@chronova-app.com'; }
// MM/DD/YYYY and HH:MM:SS on a 24 hour clock. The app shows these two joined,
// so anything written here reads the same as a transaction reference does.
function nowStr() {
  const d = eatNow();
  const pad = n => String(n).padStart(2, '0');
  return {
    date: pad(d.getUTCMonth() + 1) + '/' + pad(d.getUTCDate()) + '/' + d.getUTCFullYear(),
    time: pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds())
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
// Short mixed-case codes (e.g. oTpi8g). Same ambiguity rules as above applied to
// both cases: no I/l/O/o-vs-0 confusion. Matching everywhere is case-insensitive,
// so the casing is presentation only and a user may type it however they like.
const MIX_CHARS = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
function mixedCode(n = 6) {
  return Array.from(crypto.randomBytes(n)).map(b => MIX_CHARS[b % MIX_CHARS.length]).join('');
}
// Transaction reference in the owner's format: a type letter, the timestamp to
// the second, then four digits. Uniqueness is confirmed against the collection
// rather than assumed, so two records created in the same second can never share
// one. Every reference carries the same B prefix.
function stampRef(letter) {
  const d = new Date(Date.now() + 3 * 3600000);   // Kampala
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

async function generateUniqueRefCode() {
  for (let attempt = 0; attempt < 15; attempt++) {
    const code = mixedCode(6);
    const exists = await db.collection('users').where('usernameLower', '==', code.toLowerCase()).limit(1).get();
    if (exists.empty) return code;
  }
  return mixedCode(8);
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
// Constant-time secret comparison — a plain === leaks how many leading
// characters matched through response timing. Length is compared first
// (still technically observable, but this is the standard accepted
// trade-off; timingSafeEqual itself requires equal-length buffers).
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a || ''));
  const bufB = Buffer.from(String(b || ''));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
function verifyAdmin(req) {
  if (req.adminUser) return true; // a valid session token was resolved by the middleware above
  if (!ADMIN_KEY) return false;
  const header = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (header && safeEqual(header, ADMIN_KEY)) return true;
  return safeEqual(req.body?.adminKey, ADMIN_KEY);
}
// Owner-only actions (managing other admin accounts) must never be reachable
// with a staff login, even a compromised one — only the master key or a
// session that was itself issued to the owner qualifies.
function verifyOwner(req) {
  if (!verifyAdmin(req)) return false;
  return !req.adminUser || req.adminUser.role === 'owner';
}

// ── MULTI-ADMIN ACCOUNTS + SESSIONS ──
// ADMIN_KEY above stays the OWNER's own master credential — it is never
// handed to staff. Each of the other admins gets their own username +
// password (adminUsers, password stored only as a scrypt hash, never
// plaintext). Logging in issues a random, short-lived session token
// (adminSessions) instead of resending a password on every request, so
// deactivating or resetting ONE account revokes only that person's access —
// nobody else has to change anything.
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
// sourceId is whatever the reward hangs off — a deposit id now, an investment id
// for the legacy records the reconciler still sweeps. Both are Mongo doc ids, so
// the per-source dedup flag can never collide between the two.
async function payCommissions(investorId, amount, sourceId, sourceKind = 'deposit') {
  const investmentId = sourceId;
  // Only mark the source "handled" when a referrer chain actually existed to
  // evaluate. If the investor has no referrer YET (a race at sign-up, or the
  // referral link hasn't been attributed yet), commDone must stay false —
  // otherwise reconcileCommissions would skip this deposit forever the moment
  // referredBy is set later, permanently forfeiting the referrer's reward.
  let handled = false;
  // Serialise per investment so the invest-time call and the reconciler can't
  // both pay the same commission (the per-level flags are re-checked in the
  // transaction, but M0 has no real isolation, so add a true single-writer lock).
  await withLock('comm:' + investmentId, async () => {
    try { handled = await _payChain(investorId, amount, investmentId); }
    catch (e) { console.error('Commission error:', e.message); }
  });
  if (handled) {
    const coll = sourceKind === 'investment' ? 'investments' : 'pendingDeposits';
    try { await db.collection(coll).doc(sourceId).update({ commDone: true }); } catch (_) {}
  }
}
async function _payChain(investorId, amount, investmentId) {
  const { date, time } = nowStr();
  {
    const [invSnap, sett] = await Promise.all([
      db.collection('users').doc(investorId).get(),
      getSettings()
    ]);
    if (!invSnap.exists) return false;
    const investor = invSnap.data();
    const l1Id = investor.referredBy;
    const seen = new Set([investorId]);
    if (!l1Id || seen.has(l1Id)) return false; // no referrer (yet) — leave commDone unset so this is retried
    seen.add(l1Id);

    const commL1 = sett.commL1 ?? COMM_L1;
    const commL2 = sett.commL2 ?? COMM_L2;
    const commL3 = sett.commL3 ?? COMM_L3;
    const dedupFlag = `commPaid_${investmentId}`;

    const l1Snap = await db.collection('users').doc(l1Id).get();
    if (!l1Snap.exists) return true; // referrer account was deleted — unrecoverable, stop retrying
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
          description: `Level 1 referral bonus (${Math.round(commL1*100)}%) — ${investor.name || investor.phone} recharged ${fmtUGX(amount)}`,
          amount: l1Amt, level: 1, fromUserId: investorId, investmentId, status: 'success',
          date, time, createdAt: FieldValue.serverTimestamp()
        });
      });
    }

    const l2Id = l1Snap.data().referredBy;
    if (!l2Id || seen.has(l2Id)) return true; // L1 paid; chain terminates here — nothing left owed
    seen.add(l2Id);
    const l2Snap = await db.collection('users').doc(l2Id).get();
    if (!l2Snap.exists) return true;
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
          description: `Level 2 referral bonus (${Math.round(commL2*100)}%) — ${investor.name || investor.phone} recharged ${fmtUGX(amount)}`,
          amount: l2Amt, level: 2, fromUserId: investorId, investmentId, status: 'success',
          date, time, createdAt: FieldValue.serverTimestamp()
        });
      });
    }

    const l3Id = l2Snap.data().referredBy;
    if (!l3Id || seen.has(l3Id)) return true; // L1+L2 paid; chain terminates here
    const l3Snap = await db.collection('users').doc(l3Id).get();
    if (!l3Snap.exists) return true;
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
          description: `Level 3 referral bonus (${Math.round(commL3*100)}%) — ${investor.name || investor.phone} recharged ${fmtUGX(amount)}`,
          amount: l3Amt, level: 3, fromUserId: investorId, investmentId, status: 'success',
          date, time, createdAt: FieldValue.serverTimestamp()
        });
      });
    }
    return true;
  }
}

// ── COMMISSION RECONCILER ──
// Safety net so a referrer NEVER loses a reward: re-runs payCommissions for any
// credited recharge not yet marked commDone (a call that failed, or an older
// record). payCommissions is idempotent (per-level commPaid_<id> flags +
// transactions), so re-running can only pay what's still owed — never double-pay.
let _reconcilingComm = false;
async function reconcileCommissions(limit = 800) {
  if (_reconcilingComm) return 0;
  _reconcilingComm = true;
  let fixed = 0;
  try {
    const snap = await db.collection('pendingDeposits').orderBy('createdAt', 'desc').limit(limit).get();
    for (const doc of snap.docs) {
      const dep = doc.data();
      if (dep.commDone || dep.status !== 'matched') continue;
      await payCommissions(dep.userId, dep.creditedAmount || dep.amount, doc.id, 'deposit');
      fixed++;
    }
  } catch (e) { console.error('reconcileCommissions error:', e.message); }
  finally { _reconcilingComm = false; }
  return fixed;
}

// ── TASK CENTER: ACTIVE REFERRAL COUNT ──
// Milestone metric = COUNT of ACTIVE level-1 referrals. An active referral is a
// member who has activated at least one watch tier (totalInvested > 0). Pure
// read, no crediting — rewards are claimed explicitly via /team/milestone/claim,
// which recomputes this same count itself so a claim can never be forged.
async function activeL1Count(userId) {
  const snap = await db.collection('users').where('referredBy', '==', userId).get();
  let l1Total = 0;
  snap.forEach(d => { if ((d.data().totalInvested || 0) > 0) l1Total += 1; });
  return l1Total;
}
app.post('/team/milestone/claim', async (req, res) => {
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Please sign in again' });
  const target = Number(req.body.target);
  const m = TEAM_MILESTONES.find(x => x.target === target);
  if (!m) return res.status(400).json({ status: 'error', message: 'Unknown milestone' });
  try {
    const l1Total = await activeL1Count(userId);
    if (l1Total < m.target)
      return res.status(400).json({ status: 'error', message: `You need ${m.target} active referrals to claim this — you have ${l1Total}.` });
    const claimFlag = 'milestoneClaimed_' + m.target;
    let done = false;
    await withLock('milestoneclaim:' + userId + ':' + m.target, async () => {
      await db.runTransaction(async t => {
        const uRef  = db.collection('users').doc(userId);
        const fresh = await t.get(uRef);
        if (!fresh.exists || fresh.data()[claimFlag]) return;
        const { date, time } = nowStr();
        t.update(uRef, {
          walletBalance: FieldValue.increment(m.reward),
          totalEarned:   FieldValue.increment(m.reward),
          [claimFlag]: true
        });
        t.set(db.collection('transactions').doc(), {
          userId, type: 'team_reward',
          description: `Task Center — ${m.target} active referrals`,
          amount: m.reward, milestone: m.target, status: 'success',
          date, time, createdAt: FieldValue.serverTimestamp()
        });
        done = true;
      });
    });
    if (!done) return res.status(400).json({ status: 'error', message: 'Already claimed' });
    return res.json({ status: 'success', amount: m.reward, message: `${fmtUGX(m.reward)} added to your wallet` });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});
// ── REFERRAL ATTRIBUTION ──
// Attach `newUserId` to `referrerId` exactly once: set referredBy, bump the
// L1/L2/L3 team counts up the chain, write the referrals ledger row, and clear
// the stored pending code. The referredBy gate inside the transaction makes this
// idempotent — it can NEVER double-count a member, no matter how often it runs.
async function linkReferral(newUserId, referrerId) {
  let done = false;
  await withLock('reflink:' + newUserId, async () => {
    await db.runTransaction(async t => {
      const uRef  = db.collection('users').doc(newUserId);
      const fresh = await t.get(uRef);
      if (!fresh.exists || fresh.data().referredBy) return; // already linked — stop
      t.update(uRef, { referredBy: referrerId, pendingReferral: '' });
      done = true;
    });
    if (!done) return;
    try {
      await db.collection('users').doc(referrerId).update({ teamL1Count: FieldValue.increment(1) });
      const l1 = await db.collection('users').doc(referrerId).get();
      const l2Id = l1.exists ? l1.data().referredBy : null;
      if (l2Id && l2Id !== referrerId) {
        await db.collection('users').doc(l2Id).update({ teamL2Count: FieldValue.increment(1) });
        const l2 = await db.collection('users').doc(l2Id).get();
        const l3Id = l2.exists ? l2.data().referredBy : null;
        if (l3Id && l3Id !== l2Id && l3Id !== referrerId)
          await db.collection('users').doc(l3Id).update({ teamL3Count: FieldValue.increment(1) });
      }
      await db.collection('referrals').doc().set({
        referrerId, referredUserId: newUserId, healed: true, createdAt: FieldValue.serverTimestamp()
      });
    } catch (e) { console.warn('linkReferral counts:', e.message); }
    // Any deposit this member made before being attributed left commDone unset
    // (payCommissions only marks a deposit done once a referrer chain actually
    // existed to pay) — so reconcileCommissions picks it up on its own next
    // pass now that referredBy is set, paying the correct deposit-based amount
    // with no separate re-run needed here.
  });
  return done;
}
// Resolve a referral code (username first, legacy referralCode second) → user id.
async function resolveReferrer(code) {
  const c = String(code || '').trim();
  if (!c) return null;
  let snap = await db.collection('users').where('usernameLower', '==', c.toLowerCase()).limit(1).get();
  if (snap.empty) snap = await db.collection('users').where('referralCode', '==', c).limit(1).get();
  return snap.empty ? null : snap.docs[0].id;
}
// Self-healing net for referral ATTRIBUTION. A user can finish registration while
// the referral code is still unresolved — a cold start, a race, or a code that
// only survived as the stored pendingReferral (the /register call arrived without
// it). Any registered user who still holds a pendingReferral but no referredBy is
// linked to their referrer here. Idempotent via linkReferral's referredBy gate.
let _reconcilingRefs = false;
async function reconcileReferrals(limit = 10000) {
  if (_reconcilingRefs) return 0;
  _reconcilingRefs = true;
  let linked = 0;
  try {
    const usersSnap = await db.collection('users').limit(limit).get();
    for (const doc of usersSnap.docs) {
      const u = doc.data();
      const pend = String(u.pendingReferral || '').trim();
      if (!pend || u.referredBy) continue;                 // nothing to heal / already linked
      const referrerId = await resolveReferrer(pend);
      if (!referrerId) continue;                           // referrer still not visible — try next pass
      if (referrerId === doc.id) { await doc.ref.update({ pendingReferral: '' }).catch(() => {}); continue; }
      if (await linkReferral(doc.id, referrerId)) linked++;
    }
    if (linked) console.log('reconcileReferrals: healed', linked, 'missing referral link(s)');
  } catch (e) { console.error('reconcileReferrals error:', e.message); }
  finally { _reconcilingRefs = false; }
  return linked;
}

// ── HEALTH ──
app.get('/health', async (_req, res) => {
  const dbOk = await pingDb().catch(() => false);
  res.status(dbOk ? 200 : 503).json({ status: dbOk ? 'ok' : 'db_unreachable' });
});

app.get('/settings/public', async (_req, res) => {
  const [s, B] = await Promise.all([getSettings(), getBanners()]);
  res.json({
    status: 'success',
    minDeposit: s.minDeposit ?? MIN_DEPOSIT,
    minWithdrawal: s.minWithdrawal ?? MIN_WITHDRAWAL,
    depositProvider: ['obpay','marzpay','zengapay','manual'].includes(s.depositProvider) ? s.depositProvider : 'manual', // which gateway the app deposits through
    welcomeBonus: s.welcomeBonus ?? WELCOME_BONUS,
    checkinBonus: s.checkinBonus ?? CHECKIN_BONUS,
    liquidityFee: s.liquidityFee ?? LIQUIDITY_FEE,
    commL1: s.commL1 ?? COMM_L1,
    commL2: s.commL2 ?? COMM_L2,
    commL3: s.commL3 ?? COMM_L3,
    aboutText: s.aboutText || '',
    maintenanceMode:  !!s.maintenanceMode,
    maintenanceMsg:   s.maintenanceMsg || 'Chronova is under maintenance. Please check back shortly.',
    appVersion:       s.appVersion || APP_VERSION,
    appDeveloper:     s.appDeveloper || 'Chronova Developers',
    appSize:          s.appSize || APP_SIZE,
    // Every image the app renders comes from here. There are deliberately no
    // built-in banners: an unset slot stays empty rather than falling back.
    banners: {
      hero:       B.bannerHero       || '',
      checkin:    B.bannerCheckin    || '',
      checkinBg:  B.bannerCheckinBg  || '',
      contact:    B.bannerContact    || '',
      gift:       B.bannerGift       || '',
      team:       B.bannerTeam       || '',
      inviteCode: B.bannerInviteCode || '',
      inviteLink: B.bannerInviteLink || '',
      balance:    B.bannerBalance    || '',
      income:     B.bannerIncome     || '',
      cumulative: B.bannerCumulative || '',
      withdrawn:  B.bannerWithdrawn  || '',
    },
    rulesText:       s.rulesText       || '',
    telegramGroup:   s.telegramGroup   || '',
    telegramChannel: s.telegramChannel || '',
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

// Products live in the `products` collection — admin-managed, never hardcoded.
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
// The catalogue is EXACTLY what the admin has published. No seed list, no
// fallback: if the panel is empty the app shows an empty catalogue.
app.get('/products', async (_req, res) => {
  try {
    res.json({ status: 'success', products: await fetchProducts(false) });
  } catch (e) { res.json({ status: 'success', products: [] }); }
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

// ── ACTIVITY FEED — simulated, NOT real transactions. Generated ONCE here,
// server-side, and shared by every client (cached ~25s) so everyone watching
// at the same moment sees the exact same feed — global/synchronized is the
// point, not authenticity. (Previously this was fabricated independently by
// each device via Math.random(), so no two users ever saw the same thing.)
const _WIRE_CAP = 1000000, _WIRE_STEP = 10000;
function _maskedMsisdn() {
  return '256****' + String(Math.floor(Math.random() * 10000)).padStart(4, '0');
}
async function buildActivityFeed() {
  let rechargePool = [];
  try {
    const products = await fetchProducts(false);
    rechargePool = products.map(p => Number(p.price)).filter(n => n > 0 && n <= _WIRE_CAP);
  } catch (_) {}
  if (!rechargePool.length) for (let a = _WIRE_STEP; a <= _WIRE_CAP; a += _WIRE_STEP) rechargePool.push(a);
  const withdrawPool = [];
  for (let a = _WIRE_STEP; a <= _WIRE_CAP; a += _WIRE_STEP) withdrawPool.push(a);
  const rows = [];
  for (let i = 0; i < 18; i++) {
    const kind = Math.random() < 0.6 ? 'recharge' : 'withdrawal';
    const pool = kind === 'recharge' ? rechargePool : withdrawPool;
    rows.push({ kind, phone: _maskedMsisdn(), amount: pool[Math.floor(Math.random() * pool.length)] });
  }
  return rows;
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
  if (!phone) return res.status(400).json({ status: 'error', message: 'phone required' });
  try {
    const ref  = db.collection('users').doc(uid);
    const snap = await ref.get();
    // Already provisioned (idempotent retry) — keep the existing code.
    if (snap.exists && snap.data().referralCode) return res.json({ status: 'success', message: 'Profile ensured', referralCode: snap.data().referralCode });

    // Chronova: no username at sign-up — the referral CODE (CHR…) is auto-generated
    // and IS the user's shareable code. (A username is still accepted if supplied,
    // for backward compatibility.)
    let codeVal, codeLower;
    if (username && normalizeUsername(username).ok) {
      const norm = normalizeUsername(username);
      if (await usernameTaken(norm.lower, uid))
        return res.status(409).json({ status: 'error', message: 'That code is taken.', field: 'username' });
      codeVal = norm.value; codeLower = norm.lower;
    } else {
      codeVal = await generateUniqueRefCode(); codeLower = codeVal.toLowerCase();
    }
    const base = {
      username: codeVal, usernameLower: codeLower, referralCode: codeVal,
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
    return res.json({ status: 'success', username: codeVal });
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
    // NOTE: pendingReferral is cleared ONLY when we actually link a referrer (or
    // there was no code at all). If a code was supplied but didn't resolve yet, we
    // KEEP it so reconcileReferrals() can link the member once the referrer is
    // visible — this is what stops "joined by my link but not recorded under me".
    const update = { registrationDone: true, referralCode: myRefCode, walletBalance: FieldValue.increment(WELCOME) };
    if (!useCode) update.pendingReferral = '';

    batch.set(db.collection('transactions').doc(), {
      userId, type: 'admin_credit', description: 'Welcome gift',
      amount: WELCOME, status: 'success', date, time, createdAt: FieldValue.serverTimestamp()
    });

    if (referrerId) {
      update.referredBy = referrerId;
      update.pendingReferral = '';   // linked now — safe to clear
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
  // The user picks the network explicitly; detection is only the fallback.
  const picked = String(req.body.network || '').trim();
  const network = /^(mtn|airtel)$/i.test(picked)
    ? (picked.toUpperCase() === 'MTN' ? 'MTN' : 'Airtel')
    : detectNetwork(digits);
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
// The owner's own master key — never shared with staff. Successful login
// issues a session token like every other admin account, so the client code
// only ever has to deal with one auth shape from here on.
app.post('/admin/check-key', async (req, res) => {
  const { key } = req.body;
  if (!ADMIN_KEY) return res.status(500).json({ status: 'error', message: 'Admin key not configured' });
  if (loginLocked('owner-key')) return res.status(429).json({ status: 'error', message: 'Too many attempts. Try again in 15 minutes.' });
  if (!safeEqual(key, ADMIN_KEY)) { recordLoginFail('owner-key'); return res.status(401).json({ status: 'error', message: 'Invalid key' }); }
  clearLoginFails('owner-key');
  try {
    const token = await createSession('owner', 'owner');
    return res.json({ status: 'success', token, username: 'owner', role: 'owner' });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});
// Per-person staff login — each of the owner's admins has their own
// username/password (created from the Admins tab, owner-only). Deactivating
// or resetting one account here never touches anyone else's access.
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
    return res.json({ status: 'success', token, username, role: 'staff' });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/logout', async (req, res) => {
  const header = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (header) await db.collection('adminSessions').doc(header).delete().catch(() => {});
  return res.json({ status: 'success' });
});

// ── ADMIN PUSH NOTIFICATIONS — every admin/owner is equal here, so both
// registration and the events that fire (pending withdrawal, deposit
// completed) are open to any verified admin, not owner-only. ──
app.post('/admin/push/register', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const token = String(req.body.token || '').trim();
  if (!token) return res.status(400).json({ status: 'error', message: 'Missing token' });
  const username = req.adminUser?.username || 'owner';
  try {
    const existing = await db.collection('adminPushTokens').where('token', '==', token).limit(1).get();
    if (!existing.empty) {
      await existing.docs[0].ref.update({ username, updatedAt: FieldValue.serverTimestamp() });
    } else {
      await db.collection('adminPushTokens').add({ token, username, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    }
    return res.json({ status: 'success' });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/push/unregister', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const token = String(req.body.token || '').trim();
  if (!token) return res.status(400).json({ status: 'error', message: 'Missing token' });
  try {
    const existing = await db.collection('adminPushTokens').where('token', '==', token).limit(1).get();
    if (!existing.empty) await existing.docs[0].ref.delete();
    return res.json({ status: 'success' });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
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
    return res.json({ status: 'success', admins });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
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
    return res.json({ status: 'success' });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/admins/deactivate', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const username = String(req.body.username || '').trim().toLowerCase();
  try {
    await db.collection('adminUsers').doc(username).update({ active: false });
    await invalidateSessionsFor(username);
    logAdminAction(req, 'admin_deactivated', { username });
    return res.json({ status: 'success' });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/admins/reactivate', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const username = String(req.body.username || '').trim().toLowerCase();
  try {
    await db.collection('adminUsers').doc(username).update({ active: true });
    logAdminAction(req, 'admin_reactivated', { username });
    return res.json({ status: 'success' });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
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
    return res.json({ status: 'success' });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/admins/delete', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const username = String(req.body.username || '').trim().toLowerCase();
  try {
    await db.collection('adminUsers').doc(username).delete();
    await invalidateSessionsFor(username);
    logAdminAction(req, 'admin_deleted', { username });
    return res.json({ status: 'success' });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/audit-log', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const snap = await db.collection('adminAuditLog').orderBy('createdAt', 'desc').limit(200).get();
    return res.json({ status: 'success', log: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
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
        // Money this member has DEPOSITED (real deposits + admin credit) — this is
        // exactly what drives your team-deposit milestones, so the app shows it on
        // each row. A member can hold a product yet have 0 deposited (they bought
        // from a bonus or gift), which is why deposits and holdings are separate.
        deposited: d.totalDeposited || 0,
        referralCode: d.referralCode || d.username || null,
      });
    });
    members.sort((a, b) => (b.joinedAt || '') > (a.joinedAt || '') ? 1 : -1);
    return res.json({ status: 'success', members });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});

// Team + Task Center stats. Milestones are informational here — claiming
// itself only happens via /team/milestone/claim (server-recomputed there too).
app.get('/team/stats', async (req, res) => {
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const l1ActiveCount = await activeL1Count(userId);
    const uSnap = await db.collection('users').doc(userId).get();
    const u = uSnap.exists ? uSnap.data() : {};
    const milestones = TEAM_MILESTONES.map(m => ({
      target: m.target, reward: m.reward,
      current: l1ActiveCount,
      achieved: l1ActiveCount >= m.target,
      claimed: !!u['milestoneClaimed_' + m.target],
    }));
    return res.json({
      status: 'success', l1ActiveCount, l1DepositTotal: l1ActiveCount, milestones,
      counts:  { l1: u.teamL1Count || 0, l2: u.teamL2Count || 0, l3: u.teamL3Count || 0 },
      earned:  { l1: u.commissionL1Earned || 0, l2: u.commissionL2Earned || 0, l3: u.commissionL3Earned || 0,
                 commissions: u.commissionEarned || 0,
                 teamRewards: TEAM_MILESTONES.reduce((s, m) => s + (u['milestoneClaimed_' + m.target] ? m.reward : 0), 0) },
    });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});

// ═══════════════════════════════════════════
// INVESTMENTS: buy a product, paid out daily across its cycle
// ═══════════════════════════════════════════
app.post('/invest/create', async (req, res) => {
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Please sign in again' });
  const { tierKey } = req.body;
  const tier = await getProductByKeyOrId(tierKey);
  if (!tier) return res.status(400).json({ status: 'error', message: 'Unknown product' });
  if (tier.active === false) return res.status(400).json({ status: 'error', message: 'This product is not available right now' });
  if (tier.comingSoon) return res.status(400).json({ status: 'error', message: 'This product is sold out.' });
  // Ensure derived numbers exist even for a minimally-filled admin product.
  tier.cycle = Number(tier.cycle) || CYCLE_DAYS;
  tier.expectedReturn = Number(tier.expectedReturn) || Math.round((tier.price || 0) * RETURN_MULTIPLE);
  try {
    const uSnap = await db.collection('users').doc(userId).get();
    if (!uSnap.exists) return res.status(404).json({ status: 'error', message: 'User not found' });
    const user = uSnap.data();
    if (user.status === 'banned') return res.status(403).json({ status: 'error', message: 'Account access paused' });
    if ((user.walletBalance || 0) < tier.price)
      return res.status(400).json({ status: 'error', message: `Need ${fmtUGX(tier.price)}, have ${fmtUGX(user.walletBalance || 0)}` });

    const sett = await getSettings();
    const now = Date.now();
    const matDate = new Date(now + tier.cycle * 86400000);
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
        userId, tierKey: tier.key, tierLabel: tier.label, level: Number(tier.level) || 0,
        amount: tier.price, cycle: tier.cycle, expectedReturn: tier.expectedReturn,
        status: 'active', maturityDate: matDate,
        dailyPayout, payoutsTotal: tier.cycle, payoutsMade: 0, paidOut: 0, nextPayoutAt,
        date, time, createdAt: FieldValue.serverTimestamp()
      });
      t.set(db.collection('transactions').doc(), {
        userId, type: 'investment', description: `Purchased ${tier.label}`,
        amount: -tier.price, status: 'success', date, time,
        investmentId: invRef.id, tierKey: tier.key, createdAt: FieldValue.serverTimestamp()
      });
    }));
    return res.json({ status: 'success', investmentId: invId, message: `Bought ${tier.label} for ${fmtUGX(tier.price)}` });
  } catch (e) {
    console.error('Invest error:', e.message);
    return res.status(400).json({ status: 'error', message: e.message });
  }
});

// ── DAILY CASHBACK ENGINE ──
// Credits every active investment's due payout(s). "Due" is computed
// deterministically from elapsed days since purchase (never from stored
// nextPayoutAt drifting), so a cron that was down for a while catches an
// investment up in one shot rather than losing days. The final payout that
// completes a cycle absorbs any rounding remainder so paidOut lands exactly
// on expectedReturn.
const _creditingPayouts = new Set();
async function runDailyPayouts() {
  let credited = 0;
  try {
    const snap = await db.collection('investments').where('status', '==', 'active').limit(2000).get();
    for (const doc of snap.docs) {
      const inv = doc.data();
      const total = Number(inv.payoutsTotal) || Number(inv.cycle) || 0;
      const made  = Number(inv.payoutsMade) || 0;
      if (!total || made >= total) continue;
      const createdMs = tsMillis(inv.createdAt) || Date.now();
      const elapsedDays = Math.floor((Date.now() - createdMs) / 86400000);
      const dueCount = Math.min(total, elapsedDays) - made;
      if (dueCount <= 0) continue;
      if (_creditingPayouts.has(doc.id)) continue;
      _creditingPayouts.add(doc.id);
      try {
        await withLock('payout:' + doc.id, async () => {
          const invRef = doc.ref;
          let didCredit = false, amount = 0, newMade = 0, willComplete = false;
          await db.runTransaction(async t => {
            const fresh = await t.get(invRef);
            if (!fresh.exists || fresh.data().status !== 'active') return;
            const f = fresh.data();
            const fMade = Number(f.payoutsMade) || 0;
            const fTotal = Number(f.payoutsTotal) || Number(f.cycle) || 0;
            const fElapsed = Math.floor((Date.now() - (tsMillis(f.createdAt) || Date.now())) / 86400000);
            const fDue = Math.min(fTotal, fElapsed) - fMade;
            if (fDue <= 0) return;
            newMade = fMade + fDue;
            willComplete = newMade >= fTotal;
            const dailyPayout = Number(f.dailyPayout) || 0;
            amount = willComplete
              ? Math.max(0, (Number(f.expectedReturn) || 0) - (Number(f.paidOut) || 0))
              : dailyPayout * fDue;
            if (amount <= 0) return;
            const uRef = db.collection('users').doc(f.userId);
            t.update(uRef, { walletBalance: FieldValue.increment(amount), totalEarned: FieldValue.increment(amount) });
            t.update(invRef, {
              payoutsMade: newMade, paidOut: FieldValue.increment(amount),
              nextPayoutAt: new Date(Date.now() + 86400000),
              status: willComplete ? 'matured' : 'active'
            });
            const { date, time } = nowStr();
            t.set(db.collection('transactions').doc(), {
              userId: f.userId, type: 'gem_payout',
              description: `Cashback — ${f.tierLabel || 'watch'} (day ${newMade}/${fTotal})`,
              amount, status: 'success', date, time, investmentId: doc.id, createdAt: FieldValue.serverTimestamp()
            });
            didCredit = true;
          });
          if (didCredit) credited++;
        });
      } finally { _creditingPayouts.delete(doc.id); }
    }
  } catch (e) { console.error('runDailyPayouts error:', e.message); }
  return credited;
}

app.post('/admin/payments/sync', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const settled = await pollPendingPayments();
  return res.json({ status: 'success', settled });
});
// Verify ONE withdrawal against MarzPay — ask the gateway what really happened to
// this payout, so a "Failed" row can be confirmed (or a double-payment caught).
// READ-ONLY: it never moves money; it only reports MarzPay's verdict + advice.
app.post('/admin/withdraw/verify', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const { withdrawalId } = req.body;
  if (!withdrawalId) return res.status(400).json({ status: 'error', message: 'withdrawalId required' });
  try {
    const snap = await db.collection('withdrawals').doc(withdrawalId).get();
    if (!snap.exists) return res.status(404).json({ status: 'error', message: 'Withdrawal not found' });
    const w = snap.data();
    const provName = w.provider === 'obpay' ? 'ObPay' : 'MarzPay';
    const ref = w.provider === 'obpay' ? w.marzReference : (w.marzTxUuid || w.marzReference);
    if (!ref)
      return res.json({ status: 'success', ourStatus: w.status, marzStatus: 'no_reference',
        message: `This payout never reached ${provName} (no gateway reference), so nothing was sent and the failure or refund is correct.` });
    const real = await getPayoutStatus(w);
    const sent   = PAY_OK.includes(real);
    const failed = PAY_FAIL.includes(real);
    let message;
    if (!real)
      message = `${provName} did not respond just now — try Verify again in a moment.`;
    else if (sent && w.status !== 'processed')
      message = `⚠ ${provName} says this payout was SENT, but our record is "${w.status}". The user may have been paid AND refunded — check the recipient before doing anything else.`;
    else if (sent)
      message = `${provName} confirms the payout was SENT and our record already shows it processed — all good.`;
    else if (failed)
      message = `${provName} confirms this payout FAILED — the refund was correct, no money left your float.`;
    else
      message = `${provName} still reports this payout as "${real}" (not final yet). Check again shortly.`;
    return res.json({ status: 'success', ourStatus: w.status, marzStatus: real || 'unknown', provider: provName, sent, failed, message });
  } catch (e) {
    console.error('Withdraw verify error:', e.message);
    return res.status(500).json({ status: 'error', message: 'Could not reach the payment provider to verify right now.' });
  }
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
  // release any withdrawal the admin has left sitting past their 5-minute window
  setInterval(sweepPendingWithdrawals, 60 * 1000);
  setTimeout(pollPendingPayments, 15 * 1000);
  // Referral safety-net: catch any commission that didn't get paid at invest time.
  setInterval(reconcileCommissions, 10 * 60 * 1000);
  setTimeout(reconcileCommissions, 90 * 1000);
  // Referral-attribution safety-net: link anyone who joined by a link but was
  // never recorded under the referrer — automatically, every 10 minutes.
  setInterval(reconcileReferrals, 10 * 60 * 1000);
  setTimeout(reconcileReferrals, 2.5 * 60 * 1000);
  // Hourly ledger audit — balances vs ledger, duplicate credits, stuck payouts.
  setInterval(auditIntegrity, 60 * 60 * 1000);
  setTimeout(auditIntegrity, 3 * 60 * 1000);
  // Redemption healer — a marked-but-uncredited code redemption always pays out.
  setInterval(reconcileRedemptions, 10 * 60 * 1000);
  setTimeout(reconcileRedemptions, 2 * 60 * 1000);
  // Totals recount — rebuilds every user's running counters (totalEarned,
  // totalDeposited, commissionEarned, totalWithdrawn...) from the transactions
  // ledger, so the balance tabs can never silently drift from reality. Every
  // other reconciler here self-heals its own slice every 10 minutes; this is
  // the broadest one of all, so it runs on the same cadence as the hourly audit.
  setInterval(() => { recountUserTotals().catch(e => console.error('recount cron error:', e.message)); }, 60 * 60 * 1000);
  setTimeout(() => { recountUserTotals().catch(e => console.error('recount cron error:', e.message)); }, 4 * 60 * 1000);
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
// Heal every user who joined by a link but was never recorded under the referrer.
app.post('/admin/referrals/reconcile', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const linked = await reconcileReferrals();
  return res.json({ status: 'success', linked });
});
// Manual fix for a specific complaint: attach a user to a referrer by code/username.
// Only fills a MISSING referrer (never reassigns) so team counts stay correct.
app.post('/admin/user/set-referrer', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const { userId, referrerCode } = req.body;
  if (!userId || !referrerCode) return res.status(400).json({ status: 'error', message: 'userId and referrerCode required' });
  try {
    const uSnap = await db.collection('users').doc(userId).get();
    if (!uSnap.exists) return res.status(404).json({ status: 'error', message: 'User not found' });
    if (uSnap.data().referredBy) return res.status(400).json({ status: 'error', message: 'This user already has a referrer, so reassigning is not allowed.' });
    const referrerId = await resolveReferrer(referrerCode);
    if (!referrerId) return res.status(404).json({ status: 'error', message: 'No user found for that referral code.' });
    if (referrerId === userId) return res.status(400).json({ status: 'error', message: 'A user cannot refer themselves.' });
    const ok = await linkReferral(userId, referrerId);
    return res.json({ status: ok ? 'success' : 'error', message: ok ? 'Referral linked.' : 'Could not link (already linked).', referrerId });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
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
    if (user.status === 'banned') return res.status(403).json({ status: 'error', message: 'Account access paused' });
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
        userId, type: 'checkin', description: `Daily bonus, day ${newStreak}`,
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
// REDEMPTION CODES — server auto-generates the code; each user redeems it
// once. The admin sets a min/max reward range at generation time, and each
// redemption pays a fresh random amount inside that range, so two users
// (or the same code used by several people) don't all get an identical sum.
// ═══════════════════════════════════════════
function genCode() { return mixedCode(6); } // e.g. dgT573 — matched case-insensitively
function randomAmountIn(min, max) {
  const lo = Math.min(min, max), hi = Math.max(min, max);
  const raw = lo + Math.random() * (hi - lo);
  return Math.max(lo, Math.round(raw / 100) * 100); // clean multiple of 100
}
const _redeemingCodes = new Set(); // code doc id -> being redeemed (single-writer)

app.post('/redeem', async (req, res) => {
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Please sign in again' });
  // GLOBAL recognition: uppercase + strip every space/dash, so a code pasted
  // from WhatsApp as "AB CD-EF GH23" still matches exactly what was generated.
  const typed = String(req.body.code || '').replace(/[\s-]/g, '');
  const code = typed.toUpperCase();
  if (!code) return res.status(400).json({ status: 'error', message: 'Enter a code' });
  try {
    // codeKey is the uppercase form written for every code issued from now on.
    // Codes created before it existed are still found by their original value.
    let snap = await db.collection('redemptionCodes').where('codeKey', '==', code).limit(1).get();
    if (snap.empty) snap = await db.collection('redemptionCodes').where('code', '==', code).limit(1).get();
    if (snap.empty) snap = await db.collection('redemptionCodes').where('code', '==', typed).limit(1).get();
    if (snap.empty) return res.status(404).json({ status: 'error', message: 'Invalid code' });
    const doc = snap.docs[0], d = doc.data();
    if (!d.active) return res.status(400).json({ status: 'error', message: 'This code is no longer active' });
    if ((d.usedBy || []).includes(userId)) return res.status(400).json({ status: 'error', message: 'You have already redeemed this code' });
    if (d.maxUsers && (d.usedBy || []).length >= d.maxUsers) return res.status(400).json({ status: 'error', message: 'This code has reached its usage limit' });
    if (d.expiresAt && new Date(tsMillis(d.expiresAt)) < new Date()) return res.status(400).json({ status: 'error', message: 'This code has expired' });
    if (_redeemingCodes.has(doc.id))
      return res.status(429).json({ status: 'error', message: 'This code is being processed. Try again in a moment.' });
    _redeemingCodes.add(doc.id);
    try {
      const { date, time } = nowStr();
      let err = null, ok = false, amount = 0;
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
        // Random per redemption — inside the range the admin set on this code,
        // decided fresh here (not read from the outer snapshot) so it's rolled
        // exactly once per user even under concurrent attempts.
        amount = randomAmountIn(fd.minAmount || fd.amount || 0, fd.maxAmount || fd.amount || 0);
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
        if (!(c.minAmount || c.maxAmount || c.amount)) continue;
        await withLock('redeemfix:' + cDoc.id + ':' + uid, async () => {
          // Re-check inside the lock so two overlapping sweeps can't both pay.
          const again = await db.collection('transactions').where('code', '==', c.code).get();
          let has = false;
          again.forEach(d => { const t = d.data(); if (t.type === 'redeem' && t.userId === uid) has = true; });
          if (has) return;
          const uSnap = await db.collection('users').doc(uid).get();
          if (!uSnap.exists) return; // account deleted since
          // The original redemption never got to roll an amount (it died before
          // that point) — roll one now from the same range, so the user is
          // still made whole with a fair random amount, just decided at heal time.
          const amount = randomAmountIn(c.minAmount || c.amount || 0, c.maxAmount || c.amount || 0);
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
  const { count = 1, minAmount, maxAmount, expiresInDays, maxUsers } = req.body;
  const min = Math.max(0, Math.round(parseFloat(minAmount) || 0));
  const max = Math.max(0, Math.round(parseFloat(maxAmount) || 0));
  if (!min || !max) return res.status(400).json({ status: 'error', message: 'minAmount and maxAmount required' });
  if (min > max) return res.status(400).json({ status: 'error', message: 'minAmount cannot exceed maxAmount' });
  const n = Math.min(Math.max(parseInt(count) || 1, 1), 50);
  try {
    // Uniqueness is judged case-insensitively so two codes can never differ by
    // casing alone — they would be indistinguishable when redeemed.
    const existingSnap = await db.collection('redemptionCodes').select('code').get();
    const existing = new Set(existingSnap.docs.map(d => String(d.data().code || '').toUpperCase()));
    const made = [];
    const batch = db.batch();
    const expiresAt = expiresInDays ? new Date(Date.now() + Number(expiresInDays) * 86400000) : null;
    let attempts = 0;
    while (made.length < n && attempts < n * 10) {
      attempts++;
      const code = genCode();
      const key = code.toUpperCase();
      if (existing.has(key)) continue;
      made.push(code); existing.add(key);
      const docData = { code, codeKey: key, minAmount: min, maxAmount: max, active: true, usedBy: [],
        maxUsers: maxUsers ? Math.max(1, parseInt(maxUsers)) : null, createdAt: FieldValue.serverTimestamp() };
      if (expiresAt) docData.expiresAt = expiresAt;
      batch.set(db.collection('redemptionCodes').doc(), docData);
    }
    await batch.commit();
    return res.json({ status: 'success', codes: made, count: made.length, minAmount: min, maxAmount: max });
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
    // L1/L2/L3 commissions — Chronova pays the upline on a credited RECHARGE,
    // not on a purchase. (Task Center milestones are claimed by the user, not
    // auto-paid, so there's no hook to fire here.)
    if (didCredit) {
      payCommissions(dep.userId, amount, depDoc.id, 'deposit')
        .catch(e => console.error('Commission err:', e.message));
      sendAdminPush('Deposit completed', `${fmtUGX(amount)} credited to ${dep.phone || 'a user'}'s wallet.`, { type: 'deposit', id: depDoc.id }).catch(() => {});
    }
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
    if (user.status === 'banned') return res.status(403).json({ status: 'error', message: 'Account access paused' });
    const minDep = sett.minDeposit ?? MIN_DEPOSIT;
    if (amt < minDep) return res.status(400).json({ status: 'error', message: `Minimum deposit is ${fmtUGX(minDep)}` });

    const phone = cleanPhone(rawPhone || user.phone || '');
    if (!phone || phone.length < 10)
      return res.status(400).json({ status: 'error', message: 'Enter a valid mobile-money phone number.' });

    const reference = uuidv4();
    const ref = await uniqueRef('pendingDeposits', 'B');
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
          userId, phone, amount: amt, creditedAmount: amt, ref,
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
        userId, phone, amount: amt, ref, marzReference: reference, marzTxUuid,
        status: 'processing', date, time, createdAt: FieldValue.serverTimestamp()
      });
    }
    if (isSandbox) {
      // the sandbox branch credits inline, so it must trigger the upline reward
      // itself — creditMarzDeposit (the live path) is never reached here.
      payCommissions(userId, amt, depRef.id, 'deposit')
        .catch(e => console.error('Commission err:', e.message));
    }
    return res.json({ status: 'success', depositId: depRef.id, amount: amt, phone, sandbox: isSandbox });
  } catch (e) {
    console.error('Deposit error:', e.message);
    const friendly = /abort|timeout|fetch failed|network|ENOTFOUND|ECONN|Unexpected token|JSON/i.test(e.message || '')
      ? PROVIDER_BUSY_MSG : (e.message || 'Could not start the payment');
    return res.status(500).json({ status: 'error', message: friendly });
  }
});
// ═══════════════════════════════════════════
// DEPOSIT — ObPay collection (mobile money). Same money-safety as MarzPay:
// in-process lock + atomic increment on credit, and success is ALWAYS re-confirmed
// with ObPay's authenticated status API (never trusts a webhook body).
// ═══════════════════════════════════════════
async function pollObpayDepositStatus(depDoc) {
  const dep = depDoc.data();
  const ref = dep.marzReference;                 // shared reference field
  if (!ref || !OBPAY_SECRET_KEY) return { credited: false, failed: false };
  const raw = await obpayGetStatus(ref);
  if (raw === 'success') { await creditMarzDeposit(depDoc, dep.amount, dep.obpayTxId || null); return { credited: true, failed: false, amount: dep.amount }; }
  if (raw === 'failed') {
    if (dep.status !== 'failed') await depDoc.ref.update({ status: 'failed',
      failedAt: FieldValue.serverTimestamp(), failureReason: 'Payment failed or cancelled' });
    return { credited: false, failed: true };
  }
  return { credited: false, failed: false }; // still pending / transient
}
app.post('/deposit/obpay', async (req, res) => {
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
    if (user.status === 'banned') return res.status(403).json({ status: 'error', message: 'Account access paused' });
    const minDep = sett.minDeposit ?? MIN_DEPOSIT;
    if (amt < minDep) return res.status(400).json({ status: 'error', message: `Minimum deposit is ${fmtUGX(minDep)}` });
    const phone = cleanPhone(rawPhone || user.phone || '');
    if (!phone || phone.length < 10)
      return res.status(400).json({ status: 'error', message: 'Enter a valid mobile-money phone number.' });

    const reference = obpayRef();
    const ob = await obpayCollect({ amount: amt, phone, reference, description: user.name || userId });
    if (!ob || ob.success !== true) {
      const rawMsg = String(ob?.error || '');
      const msg = (ob?.providerDown || /internal|server error|timeout|timed out|temporarily|try again|gateway|unavailable/i.test(rawMsg))
        ? PROVIDER_BUSY_MSG : (rawMsg || 'Could not start the payment right now. Please try again.');
      return res.status(400).json({ status: 'error', message: msg });
    }
    const { date, time } = nowStr();
    const depRef = db.collection('pendingDeposits').doc();
    await depRef.set({
      userId, phone, amount: amt, provider: 'obpay',
      marzReference: reference, obpayTxId: ob.data?.transaction_id || null,
      status: 'processing', date, time, createdAt: FieldValue.serverTimestamp()
    });
    return res.json({ status: 'success', depositId: depRef.id, amount: amt, phone });
  } catch (e) {
    console.error('ObPay deposit error:', e.message);
    const friendly = /abort|timeout|fetch failed|network|ENOTFOUND|ECONN|Unexpected token|JSON/i.test(e.message || '')
      ? PROVIDER_BUSY_MSG : (e.message || 'Could not start the payment');
    return res.status(500).json({ status: 'error', message: friendly });
  }
});
// ObPay → our server webhook (ONE URL handles BOTH deposits and payouts, since
// ObPay's dashboard has a single webhook URL). We ack fast (<10s), then re-confirm
// with ObPay's authenticated status API before crediting/completing/refunding — so
// a forged/unsigned callback naming a real transaction can only trigger a truthful
// re-check, never move money on its own.
async function handleObpayEvent(req, res) {
  res.status(200).json({ received: true });
  setImmediate(async () => {
    try {
      const body = req.body || {};
      const reference = body.data?.reference || body.reference || '';
      if (!reference) return;
      // Deposit?
      const depSnap = await db.collection('pendingDeposits').where('marzReference', '==', reference).limit(1).get();
      if (!depSnap.empty) {
        const depDoc = depSnap.docs[0];
        const raw = await obpayGetStatus(reference);
        if (raw === 'success') await creditMarzDeposit(depDoc, depDoc.data().amount, depDoc.data().obpayTxId || null);
        else if (raw === 'failed' && depDoc.data().status === 'processing')
          await depDoc.ref.update({ status: 'failed', failedAt: FieldValue.serverTimestamp(), failureReason: 'Payment declined' });
        return;
      }
      // Payout (withdrawal)?
      const witSnap = await db.collection('withdrawals').where('marzReference', '==', reference).limit(1).get();
      if (!witSnap.empty) {
        const witDoc = witSnap.docs[0];
        if (witDoc.data().status !== 'processing') return; // already settled
        const raw = await obpayGetStatus(reference);
        if (raw === 'success') await completeWithdrawal(witDoc);
        else if (raw === 'failed') await failWithdrawal(witDoc, body.data?.description || 'Payout failed');
      }
    } catch (e) { console.error('ObPay webhook error:', e.message); }
  });
}
app.post('/obpay/webhook', handleObpayEvent);
app.post('/deposit/obpay-callback', handleObpayEvent);

// ═══════════════════════════════════════════
// DEPOSIT — ZengaPay collection (mobile money). Same money-safety: in-process
// lock + atomic increment on credit, and success is ALWAYS re-confirmed with
// ZengaPay's authenticated GET status (never trusts a webhook body).
// ═══════════════════════════════════════════
async function pollZengaDepositStatus(depDoc) {
  const dep = depDoc.data();
  if (!ZENGA_API_KEY) return { credited: false, failed: false };
  const raw = await zengaGetStatus(dep.zengaTxRef || dep.marzReference, 'collections');
  if (raw === 'success') { await creditMarzDeposit(depDoc, dep.amount, dep.zengaTxRef || null); return { credited: true, failed: false, amount: dep.amount }; }
  if (raw === 'failed') {
    if (dep.status !== 'failed') await depDoc.ref.update({ status: 'failed',
      failedAt: FieldValue.serverTimestamp(), failureReason: 'Payment failed or cancelled' });
    return { credited: false, failed: true };
  }
  return { credited: false, failed: false };
}
app.post('/deposit/zengapay', async (req, res) => {
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
    if (user.status === 'banned') return res.status(403).json({ status: 'error', message: 'Account access paused' });
    const minDep = sett.minDeposit ?? MIN_DEPOSIT;
    if (amt < minDep) return res.status(400).json({ status: 'error', message: `Minimum deposit is ${fmtUGX(minDep)}` });
    const phone = cleanPhone(rawPhone || user.phone || '');
    if (!phone || phone.length < 10)
      return res.status(400).json({ status: 'error', message: 'Enter a valid mobile-money phone number.' });

    const reference = zengaRef();
    const z = await zengaCollect({ amount: amt, phone, reference, description: (user.name || userId) });
    if (!z.success) {
      const rawMsg = String(z.error || '');
      const msg = (z.providerDown || /internal|server error|timeout|timed out|temporarily|try again|gateway|unavailable/i.test(rawMsg))
        ? PROVIDER_BUSY_MSG : (rawMsg || 'Could not start the payment right now. Please try again.');
      return res.status(400).json({ status: 'error', message: msg });
    }
    const { date, time } = nowStr();
    const depRef = db.collection('pendingDeposits').doc();
    await depRef.set({
      userId, phone, amount: amt, provider: 'zengapay',
      marzReference: reference, zengaTxRef: z.reference || null,
      status: 'processing', date, time, createdAt: FieldValue.serverTimestamp()
    });
    return res.json({ status: 'success', depositId: depRef.id, amount: amt, phone });
  } catch (e) {
    console.error('ZengaPay deposit error:', e.message);
    const friendly = /abort|timeout|fetch failed|network|ENOTFOUND|ECONN|Unexpected token|JSON/i.test(e.message || '')
      ? PROVIDER_BUSY_MSG : (e.message || 'Could not start the payment');
    return res.status(500).json({ status: 'error', message: friendly });
  }
});
// ZengaPay webhook (single URL for collections + transfers). Ack fast, then
// re-confirm with the authenticated status API before moving money — a forged or
// unsigned callback can only trigger a truthful re-check, never a credit.
async function handleZengaEvent(req, res) {
  res.status(202).json({ received: true });
  setImmediate(async () => {
    try {
      const d = (req.body && req.body.data) || {};
      const extRef = d.transactionExternalReference || '';   // our external_reference
      const theirRef = d.transactionReference || '';
      if (!extRef && !theirRef) return;
      // Deposit? matched on our reference (stored as marzReference)
      if (extRef) {
        const depSnap = await db.collection('pendingDeposits').where('marzReference', '==', extRef).limit(1).get();
        if (!depSnap.empty) {
          const depDoc = depSnap.docs[0];
          const raw = await zengaGetStatus(depDoc.data().zengaTxRef || theirRef, 'collections');
          if (raw === 'success') await creditMarzDeposit(depDoc, depDoc.data().amount, depDoc.data().zengaTxRef || theirRef || null);
          else if (raw === 'failed' && depDoc.data().status === 'processing')
            await depDoc.ref.update({ status: 'failed', failedAt: FieldValue.serverTimestamp(), failureReason: 'Payment declined' });
          return;
        }
        // Payout (withdrawal)?
        const witSnap = await db.collection('withdrawals').where('marzReference', '==', extRef).limit(1).get();
        if (!witSnap.empty) {
          const witDoc = witSnap.docs[0];
          if (witDoc.data().status !== 'processing') return;
          const raw = await zengaGetStatus(witDoc.data().zengaTxRef || theirRef, 'transfers');
          if (raw === 'success') await completeWithdrawal(witDoc);
          else if (raw === 'failed') await failWithdrawal(witDoc, d.transactionExternalNarrative || 'Payout failed');
        }
      }
    } catch (e) { console.error('ZengaPay webhook error:', e.message); }
  });
}
app.post('/zenga/webhook', handleZengaEvent);
app.post('/deposit/zenga-callback', handleZengaEvent);
app.post('/withdraw/zenga-callback', handleZengaEvent);

// Background safety-net: re-check every deposit still stuck on "processing"
// against its real gateway, so a webhook that never arrived (dropped, or the
// user closed the app before /deposit/status/:id polled it) still settles.
let _sweepingDeposits = false;
async function pollPendingPayments() {
  if (_sweepingDeposits) return 0;
  _sweepingDeposits = true;
  let settled = 0;
  try {
    const snap = await db.collection('pendingDeposits').where('status', '==', 'processing').limit(50).get();
    for (const doc of snap.docs) {
      const dep = doc.data();
      try {
        const result = dep.provider === 'zengapay' ? await pollZengaDepositStatus(doc)
                     : dep.provider === 'obpay'    ? await pollObpayDepositStatus(doc)
                     : await pollMarzDepositStatus(doc);
        if (result && (result.credited || result.failed)) settled++;
      } catch (e) { console.warn('pollPendingPayments item error:', e.message); }
    }
  } catch (e) { console.error('pollPendingPayments error:', e.message); }
  finally { _sweepingDeposits = false; }
  return settled;
}

// ═══════════════════════════════════════════
// MANUAL (recipient-number) DEPOSITS — the user is shown one of the admin's
// mobile-money numbers and must send the money there within 15 minutes; the admin
// verifies receipt and approves. Security model:
//   • server assigns the number (user never chooses) and spreads load across numbers
//   • one live order per user at a time (idempotent) — no order flooding
//   • amount is server-authoritative; crediting is the SAME idempotent path as the
//     gateways (creditMarzDeposit → in-process lock + atomic increment + ledger)
//   • unpaid orders auto-expire at 15 min and free the number's slot
//   • admins are alerted by SMS the instant an order is created / claimed
// ═══════════════════════════════════════════
function orderExpMs(o) { return o.expiresAtMs || (o.createdAtMs ? o.createdAtMs + MANUAL_ORDER_TTL_MS : 0); }
// Expire any live manual order past its window (frees the recipient slot). Cheap:
// only ever scans the small set flagged manualPending.
async function sweepExpiredManualOrders() {
  try {
    const snap = await db.collection('pendingDeposits').where('manualPending', '==', true).get();
    const now = Date.now();
    for (const d of snap.docs) {
      const o = d.data();
      if (o.status === 'awaiting_payment' && orderExpMs(o) && orderExpMs(o) < now) {
        await d.ref.update({ status: 'expired', manualPending: false, expiredAt: FieldValue.serverTimestamp() }).catch(() => {});
      }
    }
  } catch (e) { console.error('sweepExpiredManualOrders:', e.message); }
}
// Pick the least-busy active recipient number (anti-flood rotation).
async function pickRecipientNumber() {
  const s = await getSettings();
  const list = (Array.isArray(s.recipients) ? s.recipients : []).filter(r => r && r.active !== false && r.number);
  if (!list.length) return null;
  const snap = await db.collection('pendingDeposits').where('manualPending', '==', true).get();
  const now = Date.now(), counts = {};
  snap.forEach(d => {
    const o = d.data();
    if (o.status === 'awaiting_payment' && orderExpMs(o) && orderExpMs(o) < now) return; // expired
    counts[o.recipientId] = (counts[o.recipientId] || 0) + 1;
  });
  // Prefer numbers under the per-number cap; otherwise the globally least-loaded.
  const under = list.filter(r => (counts[r.id] || 0) < MANUAL_MAX_PENDING_PER_NUMBER);
  const pool = under.length ? under : list;
  pool.sort((a, b) => (counts[a.id] || 0) - (counts[b.id] || 0));
  return pool[0];
}
app.post('/deposit/manual/create', async (req, res) => {
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Please sign in again' });
  const amt = parseInt(req.body.amount, 10);
  if (isNaN(amt) || amt <= 0) return res.status(400).json({ status: 'error', message: 'Invalid amount' });
  const last = _depCreateDebounce.get(userId) || 0;
  if (Date.now() - last < 4000) return res.status(429).json({ status: 'error', message: 'Please wait a moment.' });
  _depCreateDebounce.set(userId, Date.now());
  try {
    await sweepExpiredManualOrders();
    const [uSnap, sett] = await Promise.all([db.collection('users').doc(userId).get(), getSettings()]);
    if (!uSnap.exists) return res.status(404).json({ status: 'error', message: 'User not found' });
    const user = uSnap.data();
    if (user.status === 'banned') return res.status(403).json({ status: 'error', message: 'Account access paused' });
    const minDep = sett.minDeposit ?? MIN_DEPOSIT;
    if (amt < minDep) return res.status(400).json({ status: 'error', message: `Minimum deposit is ${fmtUGX(minDep)}` });

    // One live order per user (idempotent) — return the existing one instead of flooding.
    const mine = await db.collection('pendingDeposits')
      .where('userId', '==', userId).where('manualPending', '==', true).limit(1).get();
    if (!mine.empty) {
      const o = mine.docs[0].data();
      if (o.status === 'awaiting_payment' && orderExpMs(o) > Date.now()) {
        return res.json({ status: 'success', orderId: mine.docs[0].id, amount: o.amount,
          recipient: { name: o.recipientName, network: o.recipientNetwork, number: o.recipientNumber },
          expiresAtMs: orderExpMs(o), reused: true });
      }
    }

    const rcpt = await pickRecipientNumber();
    if (!rcpt) return res.status(503).json({ status: 'error', message: 'Deposits are briefly unavailable. Please try again shortly.' });

    const senderPhone = cleanPhone(req.body.senderPhone || '');
    const senderNetwork = String(req.body.senderNetwork || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 8);
    const reference = ('CHR' + Date.now().toString(36) + randChars(5)).toUpperCase();
    const nowMs = Date.now();
    const { date, time } = nowStr();
    const depRef = db.collection('pendingDeposits').doc();
    await depRef.set({
      userId, amount: amt, provider: 'manual', manual: true, manualPending: true,
      marzReference: reference, status: 'awaiting_payment',
      senderPhone: senderPhone || null, senderNetwork: senderNetwork || null,
      recipientId: rcpt.id, recipientNumber: rcpt.number, recipientName: rcpt.name || 'Agent', recipientNetwork: rcpt.network || '',
      createdAtMs: nowMs, expiresAtMs: nowMs + MANUAL_ORDER_TTL_MS,
      date, time, createdAt: FieldValue.serverTimestamp()
    });
    notifyAdmins(`Chronova deposit ${reference}: ${user.name || 'User'} (${user.phone || ''}) pays ${fmtUGX(amt)} to ${rcpt.number} (${rcpt.name || 'Agent'} ${rcpt.network || ''})${senderPhone ? ' from ' + senderPhone + (senderNetwork ? ' ' + senderNetwork : '') : ''}. Approve in panel.`).catch(() => {});
    return res.json({ status: 'success', orderId: depRef.id, amount: amt,
      recipient: { name: rcpt.name || 'Agent', network: rcpt.network || '', number: rcpt.number },
      reference, expiresAtMs: nowMs + MANUAL_ORDER_TTL_MS });
  } catch (e) {
    console.error('manual deposit create:', e.message);
    return res.status(500).json({ status: 'error', message: 'Could not create the deposit order. Please try again.' });
  }
});
// User confirms they have sent the money (optionally with the sending number + MM txn id).
app.post('/deposit/manual/claim', async (req, res) => {
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Please sign in again' });
  try {
    const { orderId } = req.body;
    const ref = db.collection('pendingDeposits').doc(String(orderId || ''));
    const snap = await ref.get();
    if (!snap.exists || snap.data().userId !== userId) return res.status(404).json({ status: 'error', message: 'Order not found' });
    const o = snap.data();
    if (o.status !== 'awaiting_payment') return res.json({ status: 'success', already: true, state: o.status });
    if (orderExpMs(o) < Date.now()) { await ref.update({ status: 'expired', manualPending: false }); return res.status(410).json({ status: 'error', message: 'This order expired. Please start a new deposit.' }); }
    const senderPhone = cleanPhone(req.body.senderPhone || '');
    const txnId = String(req.body.txnId || '').replace(/[^\w-]/g, '').slice(0, 40);
    await ref.update({ status: 'claimed', claimedAt: FieldValue.serverTimestamp(),
      senderPhone: senderPhone || null, userTxnId: txnId || null });
    notifyAdmins(`Chronova ${o.marzReference}: user says SENT ${fmtUGX(o.amount)} to ${o.recipientNumber}${senderPhone ? ' from ' + senderPhone : ''}${txnId ? ' (txn ' + txnId + ')' : ''}. Verify & approve.`).catch(() => {});
    return res.json({ status: 'success' });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});
// App polls this while the pay screen is open.
app.get('/deposit/manual/status/:id', async (req, res) => {
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const ref = db.collection('pendingDeposits').doc(String(req.params.id));
    const snap = await ref.get();
    if (!snap.exists || snap.data().userId !== userId) return res.status(404).json({ status: 'error', message: 'Order not found' });
    const o = snap.data();
    if (o.status === 'awaiting_payment' && orderExpMs(o) < Date.now()) { await ref.update({ status: 'expired', manualPending: false }); o.status = 'expired'; }
    const state = o.status === 'matched' ? 'credited' : o.status;
    return res.json({ status: 'success', state, amount: o.amount, expiresAtMs: orderExpMs(o),
      recipient: { name: o.recipientName, network: o.recipientNetwork, number: o.recipientNumber } });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});
// ── ADMIN: manual deposit approvals ──
app.post('/admin/deposits/pending', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Invalid key' });
  try {
    await sweepExpiredManualOrders();
    const snap = await db.collection('pendingDeposits').where('manualPending', '==', true).get();
    const rows = [];
    for (const d of snap.docs) {
      const o = d.data();
      let uName = '', uPhone = '';
      try { const u = await db.collection('users').doc(o.userId).get(); if (u.exists) { uName = u.data().name || ''; uPhone = u.data().phone || ''; } } catch (_) {}
      rows.push({ id: d.id, reference: o.marzReference, amount: o.amount, status: o.status,
        userName: uName, userPhone: uPhone, senderPhone: o.senderPhone || '', txnId: o.userTxnId || '',
        recipientNumber: o.recipientNumber, recipientName: o.recipientName, recipientNetwork: o.recipientNetwork,
        expiresAtMs: orderExpMs(o), date: o.date, time: o.time });
    }
    rows.sort((a, b) => (b.expiresAtMs || 0) - (a.expiresAtMs || 0));
    return res.json({ status: 'success', orders: rows, count: rows.length });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/deposit/approve', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Invalid key' });
  try {
    const ref = db.collection('pendingDeposits').doc(String(req.body.orderId || ''));
    const snap = await ref.get();
    if (!snap.exists || !snap.data().manual) return res.status(404).json({ status: 'error', message: 'Order not found' });
    const o = snap.data();
    if (o.status === 'matched') return res.json({ status: 'success', already: true });
    const credited = await creditMarzDeposit(snap, o.amount, 'manual-approved');
    await ref.update({ manualPending: false, approvedBy: 'admin', approvedAt: FieldValue.serverTimestamp() });
    if (!credited) return res.status(409).json({ status: 'error', message: 'Already credited or in progress' });
    logAdminAction(req, 'deposit_approved', { orderId: req.body.orderId, amount: o.amount, userId: o.userId });
    return res.json({ status: 'success', message: `Credited ${fmtUGX(o.amount)}` });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/deposit/reject', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Invalid key' });
  try {
    const ref = db.collection('pendingDeposits').doc(String(req.body.orderId || ''));
    const snap = await ref.get();
    if (!snap.exists || !snap.data().manual) return res.status(404).json({ status: 'error', message: 'Order not found' });
    if (snap.data().status === 'matched') return res.status(409).json({ status: 'error', message: 'Already credited, so it cannot be rejected' });
    await ref.update({ status: 'rejected', manualPending: false,
      rejectReason: String(req.body.reason || 'Payment not received'), rejectedAt: FieldValue.serverTimestamp() });
    logAdminAction(req, 'deposit_rejected', { orderId: req.body.orderId, reason: req.body.reason });
    return res.json({ status: 'success' });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});
// ── ADMIN: reject a withdrawal (refunds the held funds, idempotent) ──
app.post('/admin/withdraw/reject', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Invalid key' });
  try {
    const ref = db.collection('withdrawals').doc(String(req.body.withdrawalId || ''));
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ status: 'error', message: 'Withdrawal not found' });
    const ok = await failWithdrawal(snap, String(req.body.reason || 'Rejected by admin — refunded'));
    logAdminAction(req, 'withdrawal_rejected', { withdrawalId: req.body.withdrawalId, reason: req.body.reason });
    return res.json({ status: 'success', done: ok, message: ok ? 'Rejected & refunded' : 'Already settled' });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});
setInterval(() => { sweepExpiredManualOrders().catch(() => {}); }, 2 * 60 * 1000);

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
    if (user.status === 'banned') return res.status(403).json({ status: 'error', message: 'Account access paused' });
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
        const result = dep.provider === 'zengapay' ? await pollZengaDepositStatus(snap) : dep.provider === 'obpay' ? await pollObpayDepositStatus(snap) : await pollMarzDepositStatus(snap);
        if (result.credited || result.failed) {
          const fresh = await db.collection('pendingDeposits').doc(snap.id).get();
          dep = fresh.data();
        }
      } catch (pollErr) { console.warn('Deposit poll error:', pollErr.message); }
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
    if (user.status === 'banned') return res.status(403).json({ status: 'error', message: 'Account access paused' });
    // Anti-abuse: a user must own at least one product before withdrawing
    // (stops someone registering, taking the welcome bonus, and cashing out).
    // Admin-toggleable via settings.requireInvestToWithdraw (default: required).
    const mustInvest = sett.requireInvestToWithdraw !== false;
    if (mustInvest && (user.totalInvested || 0) <= 0)
      return res.status(400).json({ status: 'error', message: 'You need to purchase at least one product before you can withdraw.' });
    if ((user.walletBalance || 0) < amt)
      return res.status(400).json({ status: 'error', message: `Insufficient balance. Available: ${fmtUGX(user.walletBalance || 0)}` });

    const fee = Math.round(amt * feeRate);
    const netAmt = amt - fee;
    const { date, time } = nowStr();
    const ref = await uniqueRef('withdrawals', 'B');
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
        withdrawalPhone: fullPhone, amount: amt, fee, netAmount: netAmt, ref,
        status: 'pending', date, time, createdAt: FieldValue.serverTimestamp()
      });
      t.set(db.collection('transactions').doc(), {
        userId, type: 'withdrawal', description: 'Cash-out request — awaiting processing',
        amount: -amt, fee, netAmount: netAmt, phone: fullPhone,
        status: 'pending', date, time, withdrawalId: witRef.id, createdAt: FieldValue.serverTimestamp()
      });
    }));
    notifyAdmins(`Chronova withdrawal: ${user.name || 'User'} wants ${fmtUGX(amt)} (net ${fmtUGX(netAmt)} after fee) to ${fullPhone}. Ref ${witId}. Tap "Send via MarzPay" in the panel, or it auto-releases through the gateway in 15 min (7am-6pm only).`).catch(() => {});
    sendAdminPush('New withdrawal request', `${user.name || 'A user'} requested ${fmtUGX(netAmt)} to ${fullPhone}.`, { type: 'withdrawal', id: witId }).catch(() => {});
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
      userId: wit.userId, type: 'refund', description: `Withdrawal refund — ${reason || 'disbursement failed'}`,
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
        const rawStatus = await getPayoutStatus(wit);
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
// Payout events also arrive at the same unified ObPay webhook; these aliases just
// point at the one handler in case a separate URL is configured for payouts.
app.post('/withdraw/obpay-callback', handleObpayEvent);
app.post('/obpay/payout-webhook', handleObpayEvent);
// ══════════════════════════════════════════════
// AUTOMATIC WITHDRAWAL RELEASE
// The admin owns a fresh request for its first fifteen minutes. Past that the
// server releases it itself, so a payout never sits waiting on a human. A
// gateway fault does NOT fail the withdrawal — the request stays pending with
// the user's money still debited and in flight, and the next sweep retries
// it, up to WITHDRAW_MAX_AUTO_TRIES.
//
// Withdrawals are only actively worked between 07:00 and 18:00 Kampala time.
// Outside that window the sweep takes NO action at all on anything, however
// old — it neither auto-releases nor burns retry attempts. The moment the
// window reopens, any request already past its 15-minute mark is released
// right away (the 15-minute clock runs from submission, not from window-open).
// The admin's own manual "Send via MarzPay" button is unaffected either way.
// ══════════════════════════════════════════════
const WITHDRAW_ADMIN_WINDOW_MS = 15 * 60 * 1000;
const WITHDRAW_MAX_AUTO_TRIES  = 8;
const WITHDRAW_WINDOW_START_H  = 7;   // 07:00 Kampala
const WITHDRAW_WINDOW_END_H    = 18;  // 18:00 Kampala
function inWithdrawWindow() {
  const h = eatNow().getUTCHours(); // eatNow() is already shifted to Kampala time
  return h >= WITHDRAW_WINDOW_START_H && h < WITHDRAW_WINDOW_END_H;
}
const _autoReleasing = new Set();

async function autoReleaseWithdrawal(witDoc) {
  const id = witDoc.id, wit = witDoc.data();
  if (wit.status !== 'pending') return false;
  if (_autoReleasing.has(id)) return false;   // single writer per withdrawal
  _autoReleasing.add(id);
  try {
    const phone     = wit.withdrawalPhone || wit.userPhone || '';
    const netAmount = wit.netAmount || wit.amount;
    if (!phone || !(netAmount > 0)) return false;

    const reference = uuidv4();
    const mpData = await marzSendMoney({
      amount: netAmount, phone, reference, description: wit.userName || wit.userId,
      callbackUrl: PUBLIC_URL ? PUBLIC_URL + '/withdraw/callback' : undefined
    });
    const sandbox = mpData.status === 'sandbox' || mpData.data?.disbursement?.mode === 'sandbox';
    if (mpData.status !== 'success' && mpData.status !== 'pending' && !sandbox) {
      await witDoc.ref.update({
        autoTries:     FieldValue.increment(1),
        lastAutoError: marzUserMsg(mpData, 'Gateway did not accept the payout'),
        lastAutoAt:    FieldValue.serverTimestamp()
      });
      return false;                            // stays pending; retried next sweep
    }

    const marzTxUuid = mpData.data?.transaction?.uuid || '';
    const batch = db.batch();
    if (sandbox) {
      batch.update(witDoc.ref, {
        status: 'processed', provider: 'marzpay', marzReference: reference, marzTxUuid,
        releasedBy: 'server', processedAt: FieldValue.serverTimestamp(), completedAt: FieldValue.serverTimestamp()
      });
      batch.update(db.collection('users').doc(wit.userId), { totalWithdrawn: FieldValue.increment(netAmount) });
    } else {
      batch.update(witDoc.ref, {
        status: 'processing', provider: 'marzpay', marzReference: reference, marzTxUuid,
        releasedBy: 'server', processedAt: FieldValue.serverTimestamp()
      });
    }
    await batch.commit();
    try {
      const txSnap = await db.collection('transactions').where('withdrawalId', '==', id).limit(1).get();
      if (!txSnap.empty) await txSnap.docs[0].ref.update({
        status: sandbox ? 'success' : 'processing', marzReference: reference });
    } catch (txErr) { console.warn('Auto-release tx update (non-critical):', txErr.message); }
    console.log(`Auto-released withdrawal ${id} — ${fmtUGX(netAmount)} to ${phone}`);
    return true;
  } catch (e) {
    console.error('autoReleaseWithdrawal error:', e.message);
    try { await witDoc.ref.update({
      autoTries: FieldValue.increment(1), lastAutoError: e.message,
      lastAutoAt: FieldValue.serverTimestamp() }); } catch (_) {}
    return false;
  } finally { _autoReleasing.delete(id); }
}

let _sweepingWithdrawals = false;
async function sweepPendingWithdrawals() {
  if (!inWithdrawWindow()) return 0; // outside 7am-6pm Kampala — the server takes no action
  if (_sweepingWithdrawals) return 0;
  _sweepingWithdrawals = true;
  let released = 0;
  try {
    const snap = await db.collection('withdrawals').where('status', '==', 'pending').limit(50).get();
    const now = Date.now();
    for (const doc of snap.docs) {
      const w = doc.data();
      const created = tsMillis(w.createdAt);
      if (!created || now - created < WITHDRAW_ADMIN_WINDOW_MS) continue; // still the admin's
      if ((w.autoTries || 0) >= WITHDRAW_MAX_AUTO_TRIES) continue;
      if (await autoReleaseWithdrawal(doc)) released++;
    }
  } catch (e) { console.error('sweepPendingWithdrawals error:', e.message); }
  finally { _sweepingWithdrawals = false; }
  return released;
}

app.post('/admin/withdraw/process', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const { withdrawalId } = req.body;
  if (!withdrawalId) return res.status(400).json({ status: 'error', message: 'withdrawalId required' });
  try {
    const witSnap = await db.collection('withdrawals').doc(withdrawalId).get();
    if (!witSnap.exists) return res.status(404).json({ status: 'error', message: 'Withdrawal not found' });
    const wit = witSnap.data();
    if (wit.status !== 'pending') return res.status(400).json({ status: 'error', message: `Cannot process, the status is '${wit.status}'` });

    const phone = wit.withdrawalPhone || wit.userPhone || '';
    const netAmount = wit.netAmount || wit.amount;
    // MarzPay is the only payout path — deposits and withdrawals both run through
    // it exclusively, so there is no provider to pick.
    // ── MarzPay payout ──
    const reference = uuidv4();
    const mpData = await marzSendMoney({
      amount: netAmount, phone, reference, description: wit.userName || wit.userId,
      callbackUrl: PUBLIC_URL ? PUBLIC_URL + '/withdraw/callback' : undefined
    });
    const witSandbox = mpData.status === 'sandbox' || mpData.data?.disbursement?.mode === 'sandbox';
    if (mpData.status !== 'success' && mpData.status !== 'pending' && !witSandbox) {
      const reason = marzUserMsg(mpData, '');
      const detail = (reason && reason !== PROVIDER_BUSY_MSG) ? ` MarzPay said: ${reason}` : '';
      return res.status(400).json({ status: 'error',
        message: `MarzPay could not send this payout right now. That is on the payment provider's side, not the panel.${detail} The withdrawal stays pending and the money is untouched, so just try again in a moment (or check your MarzPay disbursement balance).` });
    }
    const { date, time } = nowStr();
    const batch = db.batch();
    const marzTxUuid = mpData.data?.transaction?.uuid || '';
    if (witSandbox) {
      batch.update(db.collection('withdrawals').doc(withdrawalId), {
        status: 'processed', provider: 'marzpay', marzReference: reference, marzTxUuid,
        processedAt: FieldValue.serverTimestamp(), completedAt: FieldValue.serverTimestamp()
      });
      batch.update(db.collection('users').doc(wit.userId), { totalWithdrawn: FieldValue.increment(netAmount) });
    } else {
      batch.update(db.collection('withdrawals').doc(withdrawalId), {
        status: 'processing', provider: 'marzpay', marzReference: reference, marzTxUuid, processedAt: FieldValue.serverTimestamp()
      });
    }
    await batch.commit();
    try {
      const txSnap = await db.collection('transactions').where('withdrawalId', '==', withdrawalId).limit(1).get();
      if (!txSnap.empty) await txSnap.docs[0].ref.update({ status: witSandbox ? 'success' : 'processing', marzReference: reference });
    } catch (txErr) { console.warn('Process tx update (non-critical):', txErr.message); }
    logAdminAction(req, 'withdrawal_processed', { withdrawalId, amount: netAmount, phone, userId: wit.userId });
    return res.json({ status: 'success',
      message: witSandbox ? `Sandbox: withdrawal marked complete — ${fmtUGX(netAmount)} to ${phone}` : `Withdrawal processing. ${fmtUGX(netAmount)} is being sent to ${phone}`,
      sandbox: witSandbox });
  } catch (e) {
    console.error('Process withdrawal error:', e.message);
    const friendly = /abort|timeout|fetch failed|network|ENOTFOUND|ECONN|Unexpected token|JSON/i.test(e.message || '')
      ? PROVIDER_BUSY_MSG : (e.message || 'Could not process withdrawal');
    return res.status(500).json({ status: 'error', message: friendly });
  }
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
app.get('/account/deposits', async (req, res) => {
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const snap = await db.collection('pendingDeposits').where('userId', '==', userId).get();
    const list = snap.docs.map(d => {
      const x = d.data();
      return {
        id: d.id, ref: x.ref || '', amount: x.creditedAmount || x.amount || 0, status: x.status || 'processing',
        date: x.date || '', time: x.time || '', phone: x.phone || '',
        marzReference: x.marzReference || '', createdAt: x.createdAt || null,
      };
    });
    list.sort((a, b) => tsMillis(b.createdAt) - tsMillis(a.createdAt));
    return res.json({ status: 'success', deposits: list });
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
    const DEP_STATE_MSG = {
      failed:           { text: 'Deposit failed — money was not taken', status: 'failed' },
      expired:          { text: 'Deposit expired — please start a new one', status: 'failed' },
      rejected:         { text: 'Deposit rejected — payment was not confirmed', status: 'failed' },
      claimed:          { text: 'Deposit — waiting for approval', status: 'pending' },
      awaiting_payment: { text: 'Deposit — waiting for your payment', status: 'pending' },
      processing:       { text: 'Deposit — waiting for confirmation', status: 'pending' },
    };
    depSnap.forEach(d => {
      const dep = d.data();
      if (dep.status === 'matched') return;
      const st = DEP_STATE_MSG[dep.status] || { text: 'Deposit — waiting for approval', status: 'pending' };
      list.push({
        id: 'dep_' + d.id, type: 'topup',
        description: st.text,
        amount: dep.amount, status: st.status,
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
// Owner-only: manually crediting a wallet is the one adjustment staff never
// get, unlike debit/ban/etc. — too easy to abuse for free money.
app.post('/admin/deposit', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
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
        userId, type: 'admin_credit', description: note || 'Chronova credit',
        amount: amt, status: 'success', date, time, createdAt: FieldValue.serverTimestamp()
      });
    });
    logAdminAction(req, 'manual_credit', { userId, amount: amt, note });
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
    logAdminAction(req, 'manual_debit', { userId, amount: amt, note });
    return res.json({ status: 'success', message: `Removed ${fmtUGX(amt)}. New balance ${fmtUGX(newBal)}`, newBalance: newBal });
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
    logAdminAction(req, isBan ? 'user_banned' : 'user_unbanned', { userId, reason });
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
    const result = snap.data().provider === 'zengapay' ? await pollZengaDepositStatus(snap) : snap.data().provider === 'obpay' ? await pollObpayDepositStatus(snap) : await pollMarzDepositStatus(snap);
    if (result.credited) return res.json({ status: 'success', message: `Credited ${fmtUGX(result.amount || snap.data().amount)} to user` });
    if (result.failed) return res.status(400).json({ status: 'error', message: 'MarzPay confirms payment failed' });
    return res.status(400).json({ status: 'error', message: 'MarzPay status is still pending. Try again in a moment' });
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
    checkinEarned: 0, totalWithdrawn: 0, teamL1Count: 0, teamL2Count: 0, teamL3Count: 0 });
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
  // Team counts (LV1/LV2/LV3 shown on the Team screen) are otherwise pure
  // increment/decrement counters with no independent source of truth — a
  // failed increment (e.g. linkReferral's team-count step throwing after the
  // referral link itself already committed) permanently under-counts with no
  // way to detect it. Rebuild all three levels here from the live referredBy
  // graph, the same way every other counter in this recount is ground-truthed.
  const childrenOf = new Map();
  usersSnap.forEach(d => {
    const ref = d.data().referredBy;
    if (!ref) return;
    if (!childrenOf.has(ref)) childrenOf.set(ref, []);
    childrenOf.get(ref).push(d.id);
  });
  usersSnap.forEach(d => {
    const l1 = childrenOf.get(d.id) || [];
    let l2Count = 0, l3Count = 0;
    for (const c1 of l1) {
      const l2kids = childrenOf.get(c1) || [];
      l2Count += l2kids.length;
      for (const c2 of l2kids) l3Count += (childrenOf.get(c2) || []).length;
    }
    const b = bucket(d.id);
    b.teamL1Count = l1.length; b.teamL2Count = l2Count; b.teamL3Count = l3Count;
  });
  let updated = 0;
  for (const doc of usersSnap.docs) {
    try { await db.collection('users').doc(doc.id).update(agg[doc.id] || zero()); updated++; }
    catch (e) { console.error('recount update error:', doc.id, e.message); }
  }
  return updated;
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
// Correction (owner's call): the V2 patch's withdrawal fee should have stayed
// 17%, not 14% — check-in 500 was correct and is left alone. One-time, same
// pattern as V2, so this only ever overrides a live value once.
async function runRatePatchV3Once() {
  try {
    const s = await getSettings();
    if (s.ratePatchV3Done) return;
    await db.collection('settings').doc('main').set(
      { liquidityFee: 0.17, ratePatchV3Done: true }, { merge: true });
    _settingsCache = null; _settingsCacheTs = 0;
    console.log('Rate patch V3 applied: withdrawal fee corrected to 17%');
  } catch (e) { console.error('Rate patch V3 error:', e.message); }
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
    logAdminAction(req, 'user_deleted', { userId, removed });
    return res.json({ status: 'success', message: 'Account and all its data deleted', removed });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});

// "Assign & Credit": when the owner has verified a payment on the
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
    if (!ok) return res.status(409).json({ status: 'error', message: 'Could not credit. Try again' });
    logAdminAction(req, 'deposit_force_credited', { depositId, amount: snap.data().amount });
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
    // Income still owed on active products (expectedReturn minus what's been paid).
    let outstandingPayout = 0;
    investmentsSnap.forEach(d => {
      const inv = d.data();
      outstandingPayout += Math.max(0, (inv.expectedReturn || 0) - (inv.paidOut || 0));
    });
    let pendingPayouts = 0;
    withdrawalsSnap.forEach(d => pendingPayouts += (d.data().netAmount || d.data().amount || 0));
    // Overall health: real money that came in vs everything the platform still owes
    // (current wallet balances + pending withdrawals + future product income).
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

// ═══════════════════════════════════════════
// ANALYTICS CENTRE — everything computed server-side from the real ledger:
// deposit/withdraw volumes, when users transact (by hour + morning/afternoon/
// evening/night), daily trend, top referrers, top depositors, biggest cash-outs.
// ═══════════════════════════════════════════
const EAT_MS = 3 * 3600000;
function eatParts(ts) {                 // → { hour 0-23, dayKey 'YYYY-MM-DD' } in EAT
  const d = new Date(tsMillis(ts) + EAT_MS);
  return { hour: d.getUTCHours(), day: d.toISOString().slice(0, 10) };
}
function bandOf(h) {                     // owner's bands
  if (h >= 5 && h < 12)  return 'morning';
  if (h >= 12 && h < 17) return 'afternoon';
  if (h >= 17 && h < 21) return 'evening';
  return 'night';
}
app.post('/admin/analytics', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const days   = Math.min(Math.max(parseInt(req.body.days) || 30, 1), 180);
  const sinceMs = Date.now() - days * 86400000;
  try {
    const [txSnap, witSnap, usersSnap] = await Promise.all([
      db.collection('transactions').orderBy('createdAt', 'desc').limit(20000).get(),
      db.collection('withdrawals').orderBy('createdAt', 'desc').limit(20000).get(),
      db.collection('users').limit(20000).get()
    ]);

    const byHour = Array.from({ length: 24 }, (_, h) => ({ h, depAmt: 0, depCnt: 0, witAmt: 0, witCnt: 0 }));
    const bands  = { morning: { dep: 0, wit: 0 }, afternoon: { dep: 0, wit: 0 }, evening: { dep: 0, wit: 0 }, night: { dep: 0, wit: 0 } };
    const dayMap = {};                  // dayKey → { dep, wit, users }
    const ensureDay = k => (dayMap[k] = dayMap[k] || { day: k, dep: 0, wit: 0, users: 0 });

    let depAmount = 0, depCount = 0, commissionsPaid = 0, teamRewardsPaid = 0, investedAmount = 0;
    // DEPOSITS + earnings come from the transactions ledger (real network top-ups).
    txSnap.forEach(d => {
      const t = d.data();
      const ms = tsMillis(t.createdAt);
      if (ms < sinceMs) return;
      if (t.type === 'topup') {
        const a = Math.abs(t.amount || 0);
        depAmount += a; depCount++;
        const { hour, day } = eatParts(t.createdAt);
        byHour[hour].depAmt += a; byHour[hour].depCnt++;
        bands[bandOf(hour)].dep += a;
        ensureDay(day).dep += a;
      } else if (t.type === 'commission') commissionsPaid += Math.abs(t.amount || 0);
      else if (t.type === 'team_reward') teamRewardsPaid += Math.abs(t.amount || 0);
      else if (t.type === 'investment')  investedAmount  += Math.abs(t.amount || 0);
    });

    // WITHDRAWALS come from the withdrawals collection (has status + recipient).
    let witAmount = 0, witCount = 0;
    const bigWits = [];
    witSnap.forEach(d => {
      const w = d.data();
      const ms = tsMillis(w.createdAt);
      if (ms < sinceMs) return;
      if (w.status === 'rejected') return;            // never actually left → skip
      const a = Math.abs(w.amount || 0);
      witAmount += a; witCount++;
      const { hour, day } = eatParts(w.createdAt);
      byHour[hour].witAmt += a; byHour[hour].witCnt++;
      bands[bandOf(hour)].wit += a;
      ensureDay(day).wit += a;
      bigWits.push({ name: w.userName || '', phone: w.withdrawalPhone || w.userPhone || '', amount: a, status: w.status || 'pending', when: ms });
    });

    // USERS: totals, new-in-period, top referrers, top depositors.
    let totalUsers = 0, newUsers = 0, activeInvestors = 0;
    const referrers = [], depositors = [];
    usersSnap.forEach(d => {
      const u = d.data(); totalUsers++;
      const ms = tsMillis(u.createdAt);
      if (ms >= sinceMs) { newUsers++; const { day } = eatParts(u.createdAt); ensureDay(day).users++; }
      if ((u.totalInvested || 0) > 0) activeInvestors++;
      if ((u.teamL1Count || 0) > 0 || (u.commissionEarned || 0) > 0)
        referrers.push({ name: u.username || u.name || '', phone: u.phone || '', team: u.teamL1Count || 0, earned: u.commissionEarned || 0 });
      if ((u.realDeposited || 0) > 0)
        depositors.push({ name: u.username || u.name || '', phone: u.phone || '', amount: u.realDeposited || 0 });
    });

    referrers.sort((a, b) => (b.team - a.team) || (b.earned - a.earned));
    depositors.sort((a, b) => b.amount - a.amount);
    bigWits.sort((a, b) => b.amount - a.amount);

    // last `days` days, oldest → newest, gap-filled so the chart is continuous.
    const byDay = [];
    for (let i = days - 1; i >= 0; i--) {
      const k = new Date(Date.now() + EAT_MS - i * 86400000).toISOString().slice(0, 10);
      byDay.push(dayMap[k] || { day: k, dep: 0, wit: 0, users: 0 });
    }
    const peakDepositHour  = byHour.reduce((p, c) => c.depCnt > p.depCnt ? c : p, byHour[0]).h;
    const peakWithdrawHour = byHour.reduce((p, c) => c.witCnt > p.witCnt ? c : p, byHour[0]).h;
    const busiestBand = Object.entries(bands).reduce((p, c) => (c[1].dep + c[1].wit) > (p[1].dep + p[1].wit) ? c : p)[0];

    return res.json({
      status: 'success', period: days,
      kpis: {
        depositsAmount: depAmount, depositsCount: depCount,
        withdrawalsAmount: witAmount, withdrawalsCount: witCount,
        netFlow: depAmount - witAmount,
        totalUsers, newUsers, activeInvestors,
        investedAmount, commissionsPaid, teamRewardsPaid
      },
      byHour, bands, byDay,
      peakDepositHour, peakWithdrawHour, busiestBand,
      topReferrers: referrers.slice(0, 10),
      topDepositors: depositors.slice(0, 10),
      biggestWithdrawals: bigWits.slice(0, 10)
    });
  } catch (e) { console.error('Analytics error:', e.message); return res.status(500).json({ status: 'error', message: e.message }); }
});
// Every banner slot, read from its own document (with the legacy fallback).
// Owner-only: staff logins never see or touch banners.
app.post('/admin/banners', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try { return res.json({ status: 'success', banners: await getBanners() }); }
  catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});
// Write ONE slot. Its own document, so it cannot disturb any other slot. An
// empty value deletes the slot. The legacy settings copy is cleared too, so a
// re-saved slot never resurrects from the fallback.
app.post('/admin/banners/set', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const key = String(req.body.key || '');
  if (!/^banner[A-Za-z]+$/.test(key)) return res.status(400).json({ status: 'error', message: 'Bad banner key' });
  const url = String(req.body.url || '').trim();
  try {
    if (url) await db.collection('banners').doc(key).set({ url, updatedAt: FieldValue.serverTimestamp() });
    else     await db.collection('banners').doc(key).delete();
    try { await db.collection('settings').doc('main').set({ [key]: FieldValue.delete() }, { merge: true }); } catch (_) {}
    _bannersCache = null; _bannersCacheTs = 0;
    logAdminAction(req, 'banner_set', { key, cleared: !url });
    return res.json({ status: 'success' });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});
// Owner-only: platform rates, the announcement dialog, support contacts,
// maintenance mode etc. are all in here — staff logins never reach any of it.
app.post('/admin/settings', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const snap = await db.collection('settings').doc('main').get();
    return res.json({ status: 'success', settings: snap.exists ? snap.data() : {} });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/settings/update', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const { adminKey, ...updates } = req.body;
  if (!Object.keys(updates).length) return res.status(400).json({ status: 'error', message: 'No fields to update' });
  try {
    // If any announcement field is touched, bump the version so the app re-shows
    // the popup to everyone (even those who already dismissed the old one).
    if (Object.keys(updates).some(k => k.startsWith('ann'))) updates.annVersion = Date.now();
    await db.collection('settings').doc('main').set(updates, { merge: true });
    _settingsCache = null; _settingsCacheTs = 0;
    logAdminAction(req, 'settings_updated', { fields: Object.keys(updates) });
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
    // The page for display is limited, but the STATUS COUNTS are tallied across
    // EVERY withdrawal (a light status-only scan) so the tab totals never cap out
    // at the page size — the "Processed (394)" freeze bug.
    const [snap, allSnap] = await Promise.all([
      db.collection('withdrawals').orderBy('createdAt', 'desc').limit(Number(lim) || 200).get(),
      db.collection('withdrawals').select('status', 'amount', 'netAmount', 'createdAt', 'processedAt').get()
    ]);
    const counts = { pending: 0, processing: 0, processed: 0, rejected: 0, failed: 0 };
    let processedAmount = 0;
    const procByDay = {};
    allSnap.forEach(d => {
      const w = d.data();
      counts[w.status] = (counts[w.status] || 0) + 1;
      if (w.status === 'processed') {
        const amt = (w.netAmount || w.amount || 0);
        processedAmount += amt;
        const ms = tsMillis(w.processedAt || w.createdAt);
        const day = new Date(ms + EAT_MS).toISOString().slice(0, 10);
        const e = (procByDay[day] = procByDay[day] || { count: 0, amount: 0 });
        e.count++; e.amount += amt;
      }
    });
    const processedByDay = [];
    for (let i = 29; i >= 0; i--) {
      const k = new Date(Date.now() + EAT_MS - i * 86400000).toISOString().slice(0, 10);
      processedByDay.push({ day: k, count: procByDay[k]?.count || 0, amount: procByDay[k]?.amount || 0 });
    }
    return res.json({
      status: 'success',
      withdrawals: snap.docs.map(d => ({ id: d.id, ...d.data() })),
      counts, total: allSnap.size, processedAmount, processedByDay
    });
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

// ── ADMIN: PRODUCTS (create/edit/delete) ── Owner-only: staff logins never
// see or touch the product catalogue.
app.post('/admin/products/list', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try { return res.json({ status: 'success', products: await fetchProducts(true) }); }
  catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/products/save', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const { id } = req.body;
  const price = Math.round(parseFloat(req.body.price) || 0);
  if (price <= 0) return res.status(400).json({ status: 'error', message: 'Price is required' });
  const cycle = Math.max(1, Math.round(parseFloat(req.body.cycle) || CYCLE_DAYS));
  const expectedReturn = Math.round(parseFloat(req.body.expectedReturn) || price * RETURN_MULTIPLE);
  const label = String(req.body.label || '').replace(/[<>]/g, '').trim().slice(0, 40) || 'Product';
  const key = String(req.body.key || label).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24) || ('item' + Date.now());
  const level = Math.max(0, Math.round(parseFloat(req.body.level) || 0));
  const data = {
    key, label, price, cycle, expectedReturn, dailyReturn: expectedReturn / cycle, level,
    // Allow both short hosted URLs and full base64 data-URI uploads (the admin
    // downscales images before sending, so this stays well under the 8mb body cap).
    image: String(req.body.image || '').trim().slice(0, 4000000),
    order: Math.round(parseFloat(req.body.order) || 0),
    active: req.body.active !== false && req.body.active !== 'false',
    comingSoon: req.body.comingSoon === true || req.body.comingSoon === 'true',
    updatedAt: FieldValue.serverTimestamp(),
  };
  try {
    if (id) { await db.collection('products').doc(id).update(data); logAdminAction(req, 'product_updated', { id, label }); return res.json({ status: 'success', id, action: 'updated' }); }
    data.createdAt = FieldValue.serverTimestamp();
    const ref = db.collection('products').doc();
    await ref.set(data);
    logAdminAction(req, 'product_created', { id: ref.id, label });
    return res.json({ status: 'success', id: ref.id, action: 'created' });
  } catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/products/delete', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  if (!req.body.id) return res.status(400).json({ status: 'error', message: 'id required' });
  try { await db.collection('products').doc(req.body.id).delete(); logAdminAction(req, 'product_deleted', { id: req.body.id }); return res.json({ status: 'success' }); }
  catch (e) { return res.status(500).json({ status: 'error', message: e.message }); }
});

// Wipes the catalogue. The seeded tier ladder still lives in the database from
// before the seed was removed, and only the owner can clear their own data.
app.post('/admin/products/clear', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const snap = await db.collection('products').get();
    let removed = 0;
    for (const d of snap.docs) { await d.ref.delete(); removed++; }
    logAdminAction(req, 'products_cleared', { removed });
    return res.json({ status: 'success', removed });
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
    console.log(`Chronova Investment Server on port ${PORT}`);
    console.log(`  URL: ${PUBLIC_URL || '(RENDER_EXTERNAL_URL not set yet)'}`);
  });

  let cronsStarted = false;
  const tryConnect = async () => {
    try {
      await connectMongo(MONGODB_URI);
      if (!cronsStarted) { cronsStarted = true; startCrons();
        (async () => { await runRecountMigrationOnce(); await runRatePatchOnce(); await runRatePatchV3Once(); await reconcileReferrals(); })().catch(() => {});
      }
    } catch (e) {
      console.error('MongoDB not reachable yet — retrying in 5s:', e.message);
      setTimeout(tryConnect, 5000);
    }
  };
  tryConnect();
}
startServer().catch(e => { console.error('Startup error:', e.message); process.exit(1); });
