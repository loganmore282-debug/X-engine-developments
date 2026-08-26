const express     = require('express');
const admin       = require('firebase-admin');
const cors        = require('cors');
const crypto      = require('crypto');
const helmet      = require('helmet');
const compression = require('compression');
const rateLimit   = require('express-rate-limit');
if (!globalThis.fetch) { globalThis.fetch = (...a) => import('node-fetch').then(m => m.default(...a)); }

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
// Money endpoints are keyed by the Firebase user (from the token), not
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
// A second, IP-only limiter that can't be evaded by claiming a fresh fake
// uid every request (rlKeyByUser trusts the CLAIMED uid in an unverified
// token — real verification happens later, inside each handler).
const ipOnlyLimiter = rateLimit({ windowMs: 60 * 1000, max: 900, standardHeaders: false, legacyHeaders: false,
  message: { status: 'error', message: 'Too many requests from this network. Slow down.' } });
app.use((req, res, next) => (req.path === '/health' ? next() : ipOnlyLimiter(req, res, next)));
app.use((req, res, next) => (req.path === '/health' ? next() : globalLimiter(req, res, next)));

const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, keyGenerator: rlKeyByUser,
  standardHeaders: true, legacyHeaders: false,
  message: { status: 'error', message: 'Too many requests. Slow down.' } });
const adminLoginLimiter = rateLimit({ windowMs: 60 * 1000, max: 8, standardHeaders: true, legacyHeaders: false,
  message: { status: 'error', message: 'Too many attempts. Try again in a minute.' } });
const adminLimiter = rateLimit({ windowMs: 60 * 1000, max: 200, standardHeaders: true, legacyHeaders: false,
  message: { status: 'error', message: 'Too many requests. Slow down.' } });
app.use('/admin/check-key', adminLoginLimiter);
app.use('/admin/login', adminLoginLimiter);
app.use('/admin/', adminLimiter);
// If a Bearer token is a valid staff session, attach req.adminUser so
// verifyAdmin()/verifyOwner() below can recognise it. A raw master-key
// Authorization header skips the DB lookup entirely and falls through
// untouched. A transient DB hiccup must never look like "your session is
// invalid" — it's just left unresolved, and verifyAdmin() falls through to
// the legacy-key check (which fails closed).
app.use('/admin/', async (req, _res, next) => {
  const header = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (header && !(ADMIN_KEY && safeEqual(header, ADMIN_KEY))) {
    try { req.adminUser = await resolveSession(header); }
    catch (e) { console.error('Admin session resolve error:', e.message); }
  }
  next();
});
['/withdraw/request', '/invest/create', '/deposit/marzpay', '/bank/save', '/bank/delete',
 '/account/create-profile', '/register', '/account/transaction-pin/change', '/redeem',
 '/team/milestone/claim', '/checkin']
  .forEach(p => app.use(p, apiLimiter));

// ── BODY PARSING ──
// A tight 64kb cap by default; admin routes that carry a base64 product
// photo get the larger parser instead of loosening the limit for everything.
const smallJsonParser  = express.json({ limit: '64kb' });
const bigJsonParser    = express.json({ limit: '4mb' });
// Real bug fixed: this used to list '/admin/banners/set' (plural), which
// doesn't match the actual route below ('/admin/banner/set', singular) --
// every real banner image upload (always >64kb as base64) was silently
// hitting the small parser and failing with "request too large." Same bug
// class space8's CLAUDE.md documents hitting its own home-banner-slides
// route once, before that route was added here too.
const IMAGE_BODY_ROUTES = new Set(['/admin/products/save', '/admin/banner/set']);
app.use((req, res, next) => (IMAGE_BODY_ROUTES.has(req.path) ? bigJsonParser : smallJsonParser)(req, res, next));
app.use(express.urlencoded({ extended: true, limit: '64kb' }));

const CORS_ALLOWED_ORIGINS = new Set([
  'https://snow-platform.com', 'https://www.snow-platform.com',
]);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (CORS_ALLOWED_ORIGINS.has(origin)) return cb(null, true);
    try {
      const h = new URL(origin).hostname.toLowerCase();
      if (h.endsWith('.onrender.com') || h === 'localhost' || h === '127.0.0.1') return cb(null, true);
    } catch (_) {}
    cb(null, false);
  }
}));

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

// ── FIREBASE AUTH (auth only — data lives in MongoDB) ──
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
const MARZPAY_KEY  = process.env.MARZPAY_KEY || ''; // base64-encoded credentials
const MARZ_TIMEOUT = 20000;

// ── MAINTENANCE GATE ──
const MAINTENANCE_BLOCK = ['/account', '/invest', '/deposit', '/withdraw', '/register', '/bank', '/team'];
const GUARD_EXEMPT = new Set(['/', '/health', '/deposit/callback', '/withdraw/callback']);
app.use(async (req, res, next) => {
  if (GUARD_EXEMPT.has(req.path)) return next();
  if (!MAINTENANCE_BLOCK.some(p => req.path.startsWith(p))) return next();
  try {
    const s = await getSettings();
    if (s && s.maintenanceMode) {
      return res.status(503).json({ status: 'error', code: 'MAINTENANCE',
        message: s.maintenanceMsg || 'Snow is under maintenance. Please check back shortly.' });
    }
  } catch (_) {}
  next();
});

// ── PLATFORM DEFAULTS ──
// Owner-supplied 2026-08-26 (see snow/CLAUDE.md "Platform rates" / "Product
// ladder"). Admin panel overrides live in the settings/products collections;
// these are only the boot fallback.
const DEFAULT_SETTINGS = {
  withdrawFeePct: 15, minWithdraw: 8000, minDeposit: 30000,
  welcomeBonus: 5000, commL1: 27, commL2: 2, commL3: 1,
  returnMultiple: 30, cycleDays: 150,
  // Not yet confirmed by the owner — a reasonable Snow-scaled default,
  // admin-editable like every other rate here.
  dailyCheckin: 500,
  maintenanceMode: false, maintenanceMsg: '',
  maxWithdrawalsPerDay: 2, requireInvestToWithdraw: true,
  // Off by default — approves every pending withdrawal automatically a few
  // seconds after it's requested, server-driven, idempotent (shares the
  // exact same processWithdrawalCore path a manual admin approval uses).
  // autoApproveMaxAmount: 0 = unlimited; a nonzero value leaves anything
  // above it for manual review instead.
  autoApproveWithdrawalsEnabled: false, autoApproveIntervalSec: 10, autoApproveMaxAmount: 0,
  supportTelegram: '', telegramGroup: '', telegramChannel: '', supportHours: '',
  rulesText: '', aboutText: '',
};
// Daily Cashback × 150 = Total Return = Investment × 30, per tier — every
// figure below is stamped explicitly rather than derived, matching the
// owner-supplied table exactly.
const DEFAULT_PRODUCTS = [
  { key: 'qing-shuang',    name: 'Snow Qing Shuang',                     price: 30000,    cycle: 150, expectedReturn: 900000,     image: '/bottles/01-qing-shuang.jpg' },
  { key: 'ice-cool',       name: 'Snow Ice Cool (Bing Ku)',              price: 90000,    cycle: 150, expectedReturn: 2700000,    image: '/bottles/02-ice-cool-bing-ku.jpg' },
  { key: 'brave-the-world',name: 'Snow Brave the World',                 price: 197000,   cycle: 150, expectedReturn: 5910000,    image: '/bottles/03-brave-the-world.jpg' },
  { key: 'classic-old',    name: 'Snow Classic (Old Snow)',              price: 355000,   cycle: 150, expectedReturn: 10650000,   image: '/bottles/04-classic-old-snow.jpg' },
  { key: 'draft-beer',     name: 'Snow Draft Beer (Chun Sheng)',         price: 560000,   cycle: 150, expectedReturn: 16800000,   image: '/bottles/05-draft-beer-chun-sheng.jpg' },
  { key: 'brave-superx',   name: 'Snow Brave the World SuperX',          price: 950000,   cycle: 150, expectedReturn: 28500000,   image: '/bottles/06-brave-the-world-superx.jpg' },
  { key: 'marrs-green',    name: 'Snow Marrs Green',                     price: 1000000,  cycle: 150, expectedReturn: 30000000,   image: '/bottles/07-marrs-green.jpg' },
  { key: 'master-artisan', name: 'Snow Jiang Xin Ying Zao (Master Artisan)', price: 1250000, cycle: 150, expectedReturn: 37500000, image: '/bottles/08-master-artisan.jpg' },
  { key: 'opera-mask',     name: 'Snow Opera Mask Series (Lianpu)',      price: 2550000,  cycle: 150, expectedReturn: 76500000,   image: '/bottles/09-opera-mask-lianpu.jpg' },
  { key: 'li',             name: 'Snow "Li" (醴)',                       price: 4500000,  cycle: 150, expectedReturn: 135000000,  image: '/bottles/10-li.jpg' },
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
    const saved = snap.docs.map(d => d.data());
    const touchedKeys = new Set(saved.map(p => p.key));
    const merged = saved.filter(p => !p.deleted)
      .concat(DEFAULT_PRODUCTS.filter(p => !touchedKeys.has(p.key)));
    merged.sort((a, b) => (a.order || 0) - (b.order || 0) || (a.price || 0) - (b.price || 0));
    _productsCache = merged;
  } catch (_) { _productsCache = _productsCache || DEFAULT_PRODUCTS.slice(); }
  _productsCacheTs = Date.now();
  return _productsCache;
}
async function getProductByKey(key) {
  const list = await getProducts();
  return list.find(p => p.key === key) || null;
}
// Single admin-configurable Home banner (per snow/CLAUDE.md Nav/IA). Kept
// deliberately minimal compared to space8's many-slot system — Snow's
// design has exactly one banner surface right now.
let _bannerCache = null, _bannerCacheTs = 0;
async function getHomeBanner() {
  if (Date.now() - _bannerCacheTs < 60 * 1000 && _bannerCache !== null) return _bannerCache;
  try {
    const snap = await db.collection('banners').doc('home').get();
    _bannerCache = (snap.exists && snap.data().image) || null;
  } catch (_) { _bannerCache = _bannerCache || null; }
  _bannerCacheTs = Date.now();
  return _bannerCache;
}

// ── HELPERS ──
function fmtUGX(n) { return 'UGX ' + Number(n || 0).toLocaleString('en-UG'); }
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
function eatDayKey(ts) {
  const d = new Date(tsMillis(ts) + 3 * 3600000);
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
}
function dayKeyToLastCheckinFormat(key) {
  const [y, m, d] = key.split('-');
  return `${m}/${d}/${y}`;
}
// Recomputed from real check-in history on every call — a stale/corrupted
// stored streak can never keep silently breaking a real one.
function computeCheckinStreak(dayKeysSet) {
  if (!dayKeysSet.size) return { streak: 0, lastCheckin: null };
  const sorted = [...dayKeysSet].sort();
  let streak = 1;
  for (let i = sorted.length - 1; i > 0; i--) {
    const cur = Date.parse(sorted[i] + 'T00:00:00Z');
    const prev = Date.parse(sorted[i - 1] + 'T00:00:00Z');
    if (cur - prev === 86400000) streak++; else break;
  }
  return { streak, lastCheckin: dayKeyToLastCheckinFormat(sorted[sorted.length - 1]) };
}
function eatParts(ts) {
  const ms = tsMillis(ts) || Date.now();
  const d = new Date(ms + 3 * 3600000);
  const pad = n => String(n).padStart(2, '0');
  return { day: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` };
}
// Synthetic login email — same convention as space8's phoneToEmail, using
// the domain already established in Snow's own design (referral links use
// snow-platform.com).
function phoneToEmail(phone) { return String(phone).replace(/\D/g, '').replace(/^0+/, '') + '@snow-platform.com'; }
// STRICT on purpose — every real Uganda mobile number is 256 + exactly 9
// digits starting with 7. Rejects anything that doesn't reduce to exactly
// that, so a garbled/wrong-country number never reaches MarzPay.
function cleanPhone(raw) {
  const s = String(raw || '').replace(/\D/g, '');
  let local9 = null;
  if (s.startsWith('256') && s.length === 12) local9 = s.slice(3);
  else if (s.startsWith('0') && s.length === 10) local9 = s.slice(1);
  else if (s.length === 9) local9 = s;
  if (!local9 || !/^7\d{8}$/.test(local9)) return null;
  return '+256' + local9;
}
const NETWORK_NAMES = new Set(['MTN Mobile Money', 'Airtel Money']);
const MAX_MONEY_AMOUNT = 999_999_999;
function finiteMoney(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'; // no I/l/O/0/1
// Gift codes share the exact same unambiguous alphabet as referral codes but
// are 5 characters (referral codes are 6) — length is the only thing that
// tells the two systems apart by construction, so a code typed into the
// wrong box can never even superficially collide.
const GIFTCODE_CHARS = CODE_CHARS;
function randFromAlphabet(alphabet, n) {
  let s = '';
  for (let i = 0; i < n; i++) s += alphabet[crypto.randomInt(alphabet.length)];
  return s;
}
function randCode(n = 6) { return randFromAlphabet(CODE_CHARS, n); }
function genGiftCode() { return randFromAlphabet(GIFTCODE_CHARS, 5); }
async function generateUniqueGiftCode() {
  return withLock('giftcode-gen', async () => {
    for (let attempt = 0; attempt < 30; attempt++) {
      const code = genGiftCode();
      const codeLower = code.toLowerCase();
      const dup = await db.collection('promoCodes').where('codeLower', '==', codeLower).limit(1).get();
      if (dup.empty) return code;
    }
    throw new Error('Could not generate a unique gift code');
  });
}
// Check-and-claim as one atomic step, under a process-local lock — this
// app runs as a single Node process, so that's a real guarantee.
async function generateUniqueReferralCode(userId) {
  return withLock('referral-code-gen', async () => {
    const tryClaim = async (code) => {
      const codeLower = code.toLowerCase();
      const [exact, byLower] = await Promise.all([
        db.collection('users').where('referralCode', '==', code).limit(1).get(),
        db.collection('users').where('referralCodeLower', '==', codeLower).limit(1).get(),
      ]);
      if (!exact.empty || !byLower.empty) return null;
      await db.collection('users').doc(userId).update({ referralCode: code, referralCodeLower: codeLower });
      return code;
    };
    for (let attempt = 0; attempt < 20; attempt++) {
      const claimed = await tryClaim(randCode(6));
      if (claimed) return claimed;
    }
    for (let attempt = 0; attempt < 20; attempt++) {
      const claimed = await tryClaim(randCode(8));
      if (claimed) return claimed;
    }
    throw new Error('Could not generate a unique referral code');
  });
}
// Sequential, server-issued account number ("ID:000001"). Single counter
// doc, read-increment-write serialized through withLock.
async function nextSequentialPublicId() {
  return withLock('publicid-counter', async () => {
    const counterRef = db.collection('counters').doc('publicId');
    const snap = await counterRef.get();
    let n = (snap.exists ? Number(snap.data().value) : 0) || 0;
    for (let i = 0; i < 50; i++) {
      n += 1;
      const id = String(n).padStart(6, '0');
      const dup = await db.collection('users').where('publicId', '==', id).limit(1).get();
      if (dup.empty) { await counterRef.set({ value: n }, { merge: true }); return id; }
    }
    throw new Error('Could not assign a public id');
  });
}
function stampRef(letter) {
  const d = eatNow();
  const pad = (n, l = 2) => String(n).padStart(l, '0');
  return letter + d.getUTCFullYear().toString().slice(2) + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate())
    + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + pad(crypto.randomInt(10000), 4);
}
async function uniqueRef(letter) {
  for (let i = 0; i < 10; i++) {
    const ref = stampRef(letter);
    const [inDep, inWit] = await Promise.all([
      db.collection('pendingDeposits').where('ref', '==', ref).limit(1).get(),
      db.collection('withdrawals').where('ref', '==', ref).limit(1).get(),
    ]);
    if (inDep.empty && inWit.empty) return ref;
  }
  return letter + Date.now() + crypto.randomInt(1000);
}
// TASK CENTER — milestone rewards on top of ordinary L1/L2/L3 % commission.
// Reward numbers are Snow-scaled defaults (flat per-referral / flat % of
// team deposits, same shape as space8's proven ladder) — not yet confirmed
// by the owner; flag before treating these as final.
const TEAM_MILESTONES = [
  { target: 2, reward: 2000 }, { target: 5, reward: 5000 }, { target: 10, reward: 10000 },
  { target: 25, reward: 25000 }, { target: 50, reward: 50000 }, { target: 100, reward: 100000 },
  { target: 200, reward: 200000 }, { target: 500, reward: 500000 }, { target: 1000, reward: 1000000 },
  { target: 2000, reward: 2000000 }, { target: 5000, reward: 5000000 },
];
const TEAM_DEPOSIT_MILESTONES = [
  { target: 100000, reward: 2500 }, { target: 500000, reward: 12500 }, { target: 1000000, reward: 25000 },
  { target: 5000000, reward: 125000 }, { target: 10000000, reward: 250000 }, { target: 25000000, reward: 625000 },
  { target: 50000000, reward: 1250000 }, { target: 100000000, reward: 2500000 }, { target: 200000000, reward: 5000000 },
  { target: 500000000, reward: 12500000 }, { target: 1000000000, reward: 25000000 },
];
async function activeL1Count(userId) {
  const snap = await db.collection('users').where('referredBy', '==', userId).get();
  let n = 0;
  snap.forEach(d => { const v = d.data(); if (v.status !== 'banned' && (v.totalInvested || 0) > 0) n += 1; });
  return n;
}

// MISSION CENTER — owner-supplied 2026-08-26, deliberately a SEPARATE system
// from the Task Center above (owner: "it is aside"), reached via its own
// screen/button. Two independent rewards, both MANUALLY claimed (owner:
// "one has to claim it manually"):
//  1. Referral "daily salary" — RECURRING, resets every day at 00:00 EAT
//     (owner: "just like every day ie resets at 00:00"). Unclaimed on a
//     given day is forfeited, not banked/stacked — same one-shot-per-day
//     shape /checkin already uses (lastCheckin/today comparison), reused
//     here as missionSalaryLastClaim/nowStr().date. Amount is a flat
//     MISSION_SALARY_RATE per active L1 referral, scaling continuously with
//     the live count (not stepped at the 5/10/50/100/500/1000 checkpoints —
//     those are just worked examples: 5→1,000, 10→2,000 ... all exactly
//     count×200), capped at MISSION_SALARY_REFERRAL_CAP referrals (owner:
//     "Maximum eligible cap for referral tiers scales up to 1,000 total
//     referrals" — 1,000×200 = 200,000, matching the top listed tier
//     exactly).
//  2. Team deposit reward — ONE-TIME per cumulative-whole-team-deposit
//     threshold (owner confirmed "on time" or one-time, same shape as the
//     Task Center's own deposit ladder, just a separate claim-flag
//     namespace and different numbers), all exactly 1% of the threshold.
const MISSION_SALARY_RATE = 200;
const MISSION_SALARY_REFERRAL_CAP = 1000;
const MISSION_DEPOSIT_REWARDS = [
  { target: 150000, reward: 1500 }, { target: 300000, reward: 3000 }, { target: 600000, reward: 6000 },
  { target: 1000000, reward: 10000 }, { target: 2500000, reward: 25000 }, { target: 5000000, reward: 50000 },
];
// Sum of the WHOLE team's (L1+L2+L3) deposits — powers Team's "Team
// deposits" stat card.
async function wholeTeamDeposits(userId) {
  let parentIds = [userId];
  let total = 0;
  for (let level = 1; level <= 3; level++) {
    if (!parentIds.length) break;
    const snap = await db.collection('users').where('referredBy', 'in', parentIds).get();
    const nextIds = [];
    snap.forEach(d => {
      const v = d.data();
      nextIds.push(d.id);
      if (v.status !== 'banned') total += finiteMoney(v.totalDeposited);
    });
    parentIds = nextIds;
  }
  return total;
}

// ── PER-KEY MUTEX ──
// M0 has NO real transactions: two parallel requests can both read the same
// balance and both write it. Every debit/credit path serialises through
// this so a single Node instance gives real mutual exclusion per key.
const _lockTails = new Map();
function withLock(key, fn) {
  const prev = _lockTails.get(key) || Promise.resolve();
  const run  = prev.then(() => fn(), () => fn());
  const tail = run.then(() => {}, () => {});
  _lockTails.set(key, tail);
  tail.finally(() => { if (_lockTails.get(key) === tail) _lockTails.delete(key); });
  return run;
}
const _userBeingDeleted = new Set();

async function verifyAuth(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  try {
    const decoded = await admin.auth().verifyIdToken(header.slice(7), true); // checkRevoked
    return decoded.uid;
  } catch (_) { return null; }
}
async function verifyAuthWithEmail(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  try {
    const decoded = await admin.auth().verifyIdToken(header.slice(7), true);
    return { uid: decoded.uid, email: decoded.email || '' };
  } catch (_) { return null; }
}
// Prefers the phone derivable from the caller's OWN verified Firebase email
// over the client-supplied body value — an authenticated caller can't label
// their own profile with a phone number unrelated to the account they
// actually signed up with.
function phoneFromVerifiedEmail(email, bodyPhone) {
  if (!email) return cleanPhone(bodyPhone || '') || String(bodyPhone || '').trim();
  const derived = cleanPhone(String(email).split('@')[0]);
  if (derived) return derived;
  return null;
}
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a || ''));
  const bufB = Buffer.from(String(b || ''));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
// Accepts EITHER a resolved staff session (req.adminUser, attached by the
// '/admin/' middleware below) OR the owner's raw ADMIN_KEY — every existing
// `if (!verifyAdmin(req))` call site keeps working unchanged while
// multi-admin accounts sit on top of it.
function verifyAdmin(req) {
  if (req.adminUser) return true;
  if (!ADMIN_KEY) return false;
  const header = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (header && safeEqual(header, ADMIN_KEY)) return true;
  return safeEqual(req.body?.adminKey, ADMIN_KEY);
}
// Owner-only actions (staff management, rates, products, gift codes, wallet
// credit/debit/ban/delete) must never be reachable with a staff login.
function verifyOwner(req) {
  if (!verifyAdmin(req)) return false;
  return !req.adminUser || req.adminUser.role === 'owner';
}
// Push notifications for admin — deposit/withdrawal alerts. Tokens are keyed
// by the token string itself (doc id == token) so re-registering the same
// device is a natural upsert and never creates duplicate rows.
async function sendAdminPush(title, body, data = {}) {
  try {
    const snap = await db.collection('adminPushTokens').get();
    if (snap.empty) return;
    const tokens = snap.docs.map(d => d.id);
    const strData = {};
    for (const [k, v] of Object.entries(data)) strData[k] = String(v);
    const resp = await admin.messaging().sendEachForMulticast({
      tokens,
      notification: { title, body },
      data: strData,
      webpush: { fcmOptions: { link: '/' } }
    });
    const stale = [];
    resp.responses.forEach((r, i) => {
      const code = r.success ? null : (r.error && r.error.code);
      if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token')
        stale.push(tokens[i]);
    });
    if (stale.length) await Promise.all(stale.map(t => db.collection('adminPushTokens').doc(t).delete().catch(() => {})));
  } catch (e) { console.warn('sendAdminPush failed (non-critical):', e.message); }
}
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
const _loginFails = new Map();
function loginLocked(key) {
  const f = _loginFails.get(key);
  return !!(f && f.lockedUntil && f.lockedUntil > Date.now());
}
function recordLoginFail(key) {
  const f = _loginFails.get(key) || { count: 0, lockedUntil: 0 };
  f.count++;
  if (f.count >= 5) { f.lockedUntil = Date.now() + 15 * 60 * 1000; f.count = 0; }
  f.ts = Date.now();
  _loginFails.set(key, f);
}
function clearLoginFails(key) { _loginFails.delete(key); }
function logAdminAction(req, action, meta) {
  db.collection('adminAuditLog').add({
    actor: req.adminUser?.username || 'owner-key', role: req.adminUser?.role || 'owner',
    action, meta: meta || {}, ip: req.ip || null, createdAt: FieldValue.serverTimestamp()
  }).catch(e => console.warn('audit log write failed:', e.message));
}

// ── MULTI-ADMIN ACCOUNTS + SESSIONS ──
// ADMIN_KEY stays the owner's own master credential, never handed to staff.
// Each other admin gets a username + scrypt-hashed password (adminUsers);
// logging in issues a random, short-lived session token (adminSessions)
// instead of resending a password on every request, so deactivating or
// resetting one account revokes only that person's access.
const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h — forces periodic re-login
// Used by /admin/login to run scryptVerify against SOMETHING even when the
// username doesn't exist, so that path costs the same as a real wrong-
// password attempt instead of returning near-instantly (timing side-channel).
const DUMMY_PASSWORD_HASH = scryptHash(crypto.randomBytes(24).toString('hex'));
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

// ── DEPOSIT / WITHDRAWAL ABUSE GUARDS ──
const _depAttempts = new Map();       // userId -> [timestamps]
const _depAttemptsSucceeded = new Set();
function recordDepositAttempt(userId) {
  const now = Date.now();
  const arr = (_depAttempts.get(userId) || []).filter(t => now - t < 60000);
  arr.push(now);
  _depAttempts.set(userId, arr);
  return arr.length;
}
function markDepositAttemptSucceeded(userId) { _depAttemptsSucceeded.add(userId); }
async function banUserAutomatically(userId, reason) {
  try {
    await db.collection('users').doc(userId).update({ status: 'banned', banReason: reason, bannedAt: FieldValue.serverTimestamp() });
    console.warn(`Auto-banned ${userId}: ${reason}`);
  } catch (e) { console.error('Auto-ban failed:', e.message); }
}
async function markDepositFailed(depRef, userId, reason) {
  await depRef.update({ status: 'failed', failureReason: reason }).catch(() => {});
}

// ── MARZPAY (mobile money collect/send) ──
const PROVIDER_BUSY_MSG = 'The payment provider is busy right now. Please try again in a moment.';
const DEPOSIT_FAILED_MSG = 'Payment was not completed. Please try again.';
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
    description: description || 'Mobile Money' };
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
    description: description || 'Mobile Money' };
  if (callbackUrl) payload.callback_url = callbackUrl;
  const resp = await fetch(`${MARZPAY_BASE}/send-money`, {
    method: 'POST', signal: AbortSignal.timeout(MARZ_TIMEOUT),
    headers: { 'Authorization': `Basic ${MARZPAY_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return _marzParse(resp);
}
function _marzExtractTx(d) {
  const tx = d?.data?.transaction || d?.transaction || d?.data || d || {};
  const rawStatus = tx.status || tx.state || tx.transaction_status || tx.payment_status || d?.status || '';
  return { status: String(rawStatus).toLowerCase(), reference: tx.reference || tx.transaction_reference || null };
}
async function _marzFetchTxStatus(path, uuid, label) {
  let lastErr = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const resp = await fetch(`${MARZPAY_BASE}${path}`, {
        signal: AbortSignal.timeout(MARZ_TIMEOUT), headers: { 'Authorization': `Basic ${MARZPAY_KEY}` }
      });
      const d = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        console.error(`${label}(${uuid}) attempt ${attempt}: HTTP ${resp.status}`, JSON.stringify(d).slice(0, 300));
        lastErr = new Error(`HTTP ${resp.status}`);
      } else {
        return _marzExtractTx(d);
      }
    } catch (e) { lastErr = e; console.error(`${label}(${uuid}) attempt ${attempt} failed:`, e.message); }
    if (attempt < 2) await new Promise(r => setTimeout(r, 350));
  }
  // MarzPay's docs list GET /transactions/{uuid} as a documented fallback
  // "when webhooks are delayed" — one extra try before giving up.
  try {
    const resp = await fetch(`${MARZPAY_BASE}/transactions/${uuid}`, {
      signal: AbortSignal.timeout(MARZ_TIMEOUT), headers: { 'Authorization': `Basic ${MARZPAY_KEY}` }
    });
    const d = await resp.json().catch(() => ({}));
    if (resp.ok) {
      const parsed = _marzExtractTx(d);
      if (parsed.status) return parsed;
    }
  } catch (e) { console.error(`${label}(${uuid}) /transactions fallback failed:`, e.message); }
  console.error(`${label}(${uuid}): gave up after 2 attempts + fallback, last error:`, lastErr && lastErr.message);
  return { status: '', reference: null };
}
async function marzGetCollectTx(uuid) { return _marzFetchTxStatus(`/collect-money/${uuid}`, uuid, 'marzGetCollectTx'); }
async function marzGetSendTx(uuid)    { return _marzFetchTxStatus(`/send-money/${uuid}`,    uuid, 'marzGetSendTx'); }
async function marzGetCollectStatus(uuid) { return (await marzGetCollectTx(uuid)).status; }
async function marzGetSendStatus(uuid) { return (await marzGetSendTx(uuid)).status; }
const SUCCESS_STATUSES = new Set(['success', 'successful', 'completed']);
const FAILED_STATUSES  = new Set(['failed', 'declined', 'cancelled', 'canceled', 'rejected', 'expired']);
function marzEventTypeFallback(eventType) {
  const e = String(eventType || '');
  if (e === 'success' || /\.completed$/.test(e)) return 'completed';
  if (e === 'failure' || /\.(failed|cancelled|canceled)$/.test(e)) return 'failed';
  return '';
}

// ── DAILY CASHBACK (settle-on-read + a 1s background sweep) ──
// Each tier pays expectedReturn/cycleDays per elapsed day, using cumulative-
// target allocation (round(expectedReturn * daysDue / total)) so the running
// total always telescopes to EXACTLY expectedReturn at completion, for any
// ratio — not just ones that divide evenly.
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
      const fresh = await doc.ref.get();
      if (!fresh.exists || fresh.data().status !== 'active') return;
      const f = fresh.data();
      const fMade = Number(f.payoutsMade) || 0;
      const fTotal = Number(f.payoutsTotal) || 0;
      const fElapsed = Math.floor((Date.now() - (tsMillis(f.createdAt) || Date.now())) / 86400000);
      const fDue = Math.min(fTotal, fElapsed) - fMade;
      if (fDue <= 0) return;
      const newMade = fMade + fDue;
      const willComplete = newMade >= fTotal;
      const fExpected = Number(f.expectedReturn) || 0;
      const fPaidOut = Number(f.paidOut) || 0;
      const target = Math.round(fExpected * newMade / fTotal);
      const amount = Math.max(0, target - fPaidOut);
      if (amount <= 0 && !willComplete) return;
      // RECORD-BEFORE-CREDIT: db.js's runTransaction replays queued writes
      // sequentially with no rollback, so advancing payoutsMade first means
      // a failed credit rolls back cleanly instead of silently re-crediting
      // the same day forever on every future tick.
      await doc.ref.update({
        payoutsMade: newMade, paidOut: FieldValue.increment(amount),
        status: willComplete ? 'matured' : 'active'
      });
      if (amount <= 0) return;
      try {
        await db.collection('users').doc(f.userId).update({
          walletBalance: FieldValue.increment(amount), totalEarned: FieldValue.increment(amount)
        });
      } catch (creditErr) {
        await doc.ref.update({ payoutsMade: fMade, paidOut: FieldValue.increment(-amount), status: 'active' }).catch(() => {});
        throw creditErr;
      }
      const { date, time } = nowStr();
      await db.collection('transactions').add({
        userId: f.userId, type: 'cashback', description: `${f.tierLabel} daily cashback`,
        amount, status: 'success', date, time, investmentId: doc.id, createdAt: FieldValue.serverTimestamp()
      });
    });
    return true;
  } finally { _creditingPayouts.delete(doc.id); }
}
async function settleAllForUser(userId) {
  const snap = await db.collection('investments').where('userId', '==', userId).where('status', '==', 'active').get();
  for (const doc of snap.docs) { await settleInvestmentIfDue(doc).catch(e => console.error('Settle error:', e.message)); }
}

// ── REFERRAL COMMISSION (L1/L2/L3, first-purchase-only) ──
// Idempotent per (investmentId, level) via commissionPaidLevels on the
// investment doc; each level is CLAIMED before its wallet credit so a crash
// mid-loop can only ever under-pay (visible, fixable by hand), never repeat
// a payment on the next reconciler tick.
async function creditReferralCommission(investmentId, buyerId, amount) {
  await withLock('comm:' + investmentId, async () => {
    const invRef = db.collection('investments').doc(investmentId);
    const invSnap = await invRef.get();
    if (!invSnap.exists) return;
    if (invSnap.data().isFirstInvestment !== true) { await invRef.update({ commissionPending: false }); return; }
    const paidLevels = invSnap.data().commissionPaidLevels || [];

    const sett = await getSettings();
    const buyerSnap = await db.collection('users').doc(buyerId).get();
    if (!buyerSnap.exists || buyerSnap.data().status === 'banned') { await invRef.update({ commissionPending: false }); return; }
    const l1Id = buyerSnap.data().referredBy;
    if (!l1Id) { await invRef.update({ commissionPending: false }); return; }
    const rates = [sett.commL1, sett.commL2, sett.commL3];
    const l1Snap = await db.collection('users').doc(l1Id).get();
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
      if (paidLevels.indexOf(i) !== -1) continue;
      const { id, snap } = chain[i];
      if (!snap.exists || snap.data().status === 'banned') continue;
      const pct = Number(rates[i]) || 0;
      if (pct <= 0) continue;
      const reward = Math.round(amount * pct / 100);
      if (reward <= 0) continue;
      await invRef.update({ commissionPaidLevels: FieldValue.arrayUnion(i) });
      await db.collection('users').doc(id).update({
        walletBalance: FieldValue.increment(reward), teamCommission: FieldValue.increment(reward),
        totalEarned: FieldValue.increment(reward)
      });
      await db.collection('transactions').add({
        userId: id, type: 'commission', description: `Level ${i + 1} reward`,
        amount: reward, status: 'success', date, time, investmentId, createdAt: FieldValue.serverTimestamp()
      });
    }
    await invRef.update({ commissionPending: false });
  });
}

// ═══════════════════════════════════════════
// TEAM
// ═══════════════════════════════════════════
app.get('/team/members', async (req, res) => {
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const level = Math.min(3, Math.max(1, parseInt(req.query.level, 10) || 1));
  try {
    let parentIds = [userId];
    let members = [];
    for (let l = 1; l <= level; l++) {
      if (!parentIds.length) { members = []; break; }
      const snap = await db.collection('users').where('referredBy', 'in', parentIds).get();
      const nextIds = [];
      const rows = [];
      snap.forEach(d => {
        const v = d.data();
        nextIds.push(d.id);
        rows.push({ id: d.id, phone: v.phone || '', createdAt: v.createdAt || null, invested: finiteMoney(v.totalInvested) });
      });
      members = rows;
      parentIds = nextIds;
    }
    res.json({ status: 'success', level, members });
  } catch (e) {
    console.error('Team members error:', e.message);
    res.status(500).json({ status: 'error', message: 'Could not load your team' });
  }
});
app.get('/team/stats', async (req, res) => {
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const [uSnap, sett, deposits] = await Promise.all([
      db.collection('users').doc(userId).get(), getSettings(), wholeTeamDeposits(userId)
    ]);
    if (!uSnap.exists) return res.status(404).json({ status: 'error', message: 'User not found' });
    const u = uSnap.data();
    const l1ActiveCount = await activeL1Count(userId);
    const milestones = [
      ...TEAM_MILESTONES.map(m => ({ type: 'count', target: m.target, reward: m.reward,
        current: l1ActiveCount, achieved: l1ActiveCount >= m.target, claimed: !!u['milestoneClaimed_' + m.target] })),
      ...TEAM_DEPOSIT_MILESTONES.map(m => ({ type: 'deposit', target: m.target, reward: m.reward,
        current: deposits, achieved: deposits >= m.target, claimed: !!u['depositMilestoneClaimed_' + m.target] })),
    ];
    const rewardTxSnap = await db.collection('transactions').where('userId', '==', userId).where('type', '==', 'team_reward').get();
    let teamRewards = 0;
    rewardTxSnap.forEach(d => { teamRewards += finiteMoney(d.data().amount); });
    res.json({
      status: 'success',
      referralCode: u.referralCode || null,
      commRates: { l1: sett.commL1, l2: sett.commL2, l3: sett.commL3 },
      team: { l1: u.teamL1Count || 0, l2: u.teamL2Count || 0, l3: u.teamL3Count || 0 },
      totalTeam: (u.teamL1Count || 0) + (u.teamL2Count || 0) + (u.teamL3Count || 0),
      teamCommission: finiteMoney(u.teamCommission),
      teamDeposits: deposits, l1ActiveCount, milestones, teamRewards,
    });
  } catch (e) {
    console.error('Team stats error:', e.message);
    res.status(500).json({ status: 'error', message: 'Could not load team stats' });
  }
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
    const progress = isDeposit ? await wholeTeamDeposits(userId) : await activeL1Count(userId);
    if (progress < m.target) {
      const need = isDeposit ? fmtUGX(m.target) : m.target;
      const have = isDeposit ? fmtUGX(progress) : progress;
      return res.status(400).json({ status: 'error', message: `You need ${need} to claim this, you have ${have}.` });
    }
    const claimFlag = (isDeposit ? 'depositMilestoneClaimed_' : 'milestoneClaimed_') + m.target;
    let done = false, stillShort = false;
    await withLock('milestoneclaim:' + userId + ':' + claimFlag, async () => {
      const liveProgress = isDeposit ? await wholeTeamDeposits(userId) : await activeL1Count(userId);
      if (liveProgress < m.target) { stillShort = true; return; }
      await db.runTransaction(async t => {
        const uRef = db.collection('users').doc(userId);
        const fresh = await t.get(uRef);
        if (!fresh.exists || fresh.data()[claimFlag] || fresh.data().status === 'banned') return;
        const { date, time } = nowStr();
        t.update(uRef, { walletBalance: FieldValue.increment(m.reward), totalEarned: FieldValue.increment(m.reward), [claimFlag]: true });
        t.set(db.collection('transactions').doc(), {
          userId, type: 'team_reward',
          description: isDeposit ? `Task Center: whole team deposits ${fmtUGX(m.target)}` : `Task Center: ${m.target} active referrals`,
          amount: m.reward, milestone: m.target, status: 'success', date, time, createdAt: FieldValue.serverTimestamp()
        });
        done = true;
      });
    });
    if (stillShort) return res.status(400).json({ status: 'error', message: 'Your progress changed just now — please try again.' });
    if (!done) return res.status(400).json({ status: 'error', message: 'Already claimed' });
    res.json({ status: 'success', amount: m.reward, message: `${fmtUGX(m.reward)} added to your wallet` });
  } catch (e) { console.error('Milestone claim error:', e.message); res.status(500).json({ status: 'error', message: 'Could not claim that reward right now' }); }
});

// ── MISSION CENTER (separate from Task Center above — see the constants'
// own comment for the full owner-supplied spec) ──
app.get('/mission/status', async (req, res) => {
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const [uSnap, l1ActiveCount, teamDeposits] = await Promise.all([
      db.collection('users').doc(userId).get(), activeL1Count(userId), wholeTeamDeposits(userId)
    ]);
    if (!uSnap.exists) return res.status(404).json({ status: 'error', message: 'User not found' });
    const u = uSnap.data();
    const today = nowStr().date;
    const salaryAmount = Math.min(l1ActiveCount, MISSION_SALARY_REFERRAL_CAP) * MISSION_SALARY_RATE;
    const salaryClaimedToday = u.missionSalaryLastClaim === today;
    const depositRewards = MISSION_DEPOSIT_REWARDS.map(m => ({
      target: m.target, reward: m.reward, current: teamDeposits, achieved: teamDeposits >= m.target,
      claimed: !!u['missionDepositClaimed_' + m.target],
    }));
    res.json({ status: 'success', l1ActiveCount, salaryRate: MISSION_SALARY_RATE, salaryCap: MISSION_SALARY_REFERRAL_CAP,
      salaryAmount, salaryClaimedToday, teamDeposits, depositRewards });
  } catch (e) { console.error('Mission status error:', e.message); res.status(500).json({ status: 'error', message: 'Could not load Mission Center right now' }); }
});
app.post('/mission/salary/claim', async (req, res) => {
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Please sign in again' });
  try {
    let result = null;
    await withLock('mission-salary:' + userId, async () => {
      const uRef = db.collection('users').doc(userId);
      const uSnap = await uRef.get();
      if (!uSnap.exists) { result = { code: 404, body: { status: 'error', message: 'User not found' } }; return; }
      const u = uSnap.data();
      if (u.status === 'banned') { result = { code: 403, body: { status: 'error', code: 'BANNED', message: 'Account suspended. Contact customer service.' } }; return; }
      const today = nowStr().date;
      if (u.missionSalaryLastClaim === today) { result = { code: 400, body: { status: 'error', message: "Already claimed today's salary — come back after 00:00." } }; return; }
      const count = await activeL1Count(userId);
      const amount = Math.min(count, MISSION_SALARY_REFERRAL_CAP) * MISSION_SALARY_RATE;
      if (amount <= 0) { result = { code: 400, body: { status: 'error', message: 'You need at least one active referral to claim a daily salary.' } }; return; }
      await uRef.update({ walletBalance: FieldValue.increment(amount), totalEarned: FieldValue.increment(amount), missionSalaryLastClaim: today });
      const { date, time } = nowStr();
      await db.collection('transactions').add({
        userId, type: 'mission_salary', description: `Mission Center: daily referral salary (${count} active referrals)`,
        amount, status: 'success', date, time, createdAt: FieldValue.serverTimestamp()
      });
      result = { code: 200, body: { status: 'success', amount, message: `${fmtUGX(amount)} added to your wallet` } };
    });
    res.status(result.code).json(result.body);
  } catch (e) { console.error('Mission salary claim error:', e.message); res.status(500).json({ status: 'error', message: 'Could not claim your daily salary right now' }); }
});
app.post('/mission/deposit/claim', async (req, res) => {
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Please sign in again' });
  const target = Number(req.body.target);
  const m = MISSION_DEPOSIT_REWARDS.find(x => x.target === target);
  if (!m) return res.status(400).json({ status: 'error', message: 'Unknown reward tier' });
  try {
    const progress = await wholeTeamDeposits(userId);
    if (progress < m.target) return res.status(400).json({ status: 'error', message: `You need ${fmtUGX(m.target)} in team deposits to claim this, you have ${fmtUGX(progress)}.` });
    const claimFlag = 'missionDepositClaimed_' + m.target;
    let done = false, stillShort = false;
    await withLock('mission-deposit:' + userId + ':' + claimFlag, async () => {
      const liveProgress = await wholeTeamDeposits(userId);
      if (liveProgress < m.target) { stillShort = true; return; }
      await db.runTransaction(async t => {
        const uRef = db.collection('users').doc(userId);
        const fresh = await t.get(uRef);
        if (!fresh.exists || fresh.data()[claimFlag] || fresh.data().status === 'banned') return;
        const { date, time } = nowStr();
        t.update(uRef, { walletBalance: FieldValue.increment(m.reward), totalEarned: FieldValue.increment(m.reward), [claimFlag]: true });
        t.set(db.collection('transactions').doc(), {
          userId, type: 'mission_deposit_reward', description: `Mission Center: team deposits reached ${fmtUGX(m.target)}`,
          amount: m.reward, milestone: m.target, status: 'success', date, time, createdAt: FieldValue.serverTimestamp()
        });
        done = true;
      });
    });
    if (stillShort) return res.status(400).json({ status: 'error', message: 'Your progress changed just now — please try again.' });
    if (!done) return res.status(400).json({ status: 'error', message: 'Already claimed' });
    res.json({ status: 'success', amount: m.reward, message: `${fmtUGX(m.reward)} added to your wallet` });
  } catch (e) { console.error('Mission deposit claim error:', e.message); res.status(500).json({ status: 'error', message: 'Could not claim that reward right now' }); }
});

// ═══════════════════════════════════════════
// PUBLIC
// ═══════════════════════════════════════════
app.get('/health', async (_req, res) => {
  const dbUp = await pingDb();
  res.json({ status: dbUp ? 'ok' : 'degraded', db: dbUp });
});
app.get('/public/settings', async (_req, res) => {
  try {
    const s = await getSettings();
    const { maintenanceMsg, ...rest } = s;
    res.json({ status: 'success', settings: { ...rest, maintenanceMsg: s.maintenanceMode ? maintenanceMsg : '' } });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
app.get('/public/products', async (_req, res) => {
  try { res.json({ status: 'success', products: await getProducts() }); }
  catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
app.get('/public/banner', async (_req, res) => {
  try { res.json({ status: 'success', image: await getHomeBanner() }); }
  catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});

// ── ACTIVITY FEED — simulated, NOT real transactions. Built once here,
// server-side, and shared by every client (cached ~4s) so everyone watching
// at the same moment sees the identical feed.
const _WIRE_STEP = 5000, _WIRE_CAP = 900000;
const _DEPOSIT_LADDER = [
  30000, 40000, 50000, 60000, 70000, 90000, 100000, 120000, 150000, 197000,
  200000, 250000, 300000, 355000, 400000, 500000, 560000, 700000, 800000,
  900000, 950000, 1000000, 1250000, 1500000, 2000000, 2550000, 3000000, 4500000
];
function maskedMsisdn(used) {
  for (let tries = 0; tries < 50; tries++) {
    const n = '256****' + String(Math.floor(Math.random() * 10000)).padStart(4, '0');
    if (!used.has(n)) { used.add(n); return n; }
  }
  return '256****' + String(Math.floor(Math.random() * 10000)).padStart(4, '0');
}
async function buildActivityFeed() {
  const sett = await getSettings();
  const minDep = Number(sett.minDeposit) || 0;
  const minWit = Number(sett.minWithdraw) || 0;
  let depositPool = _DEPOSIT_LADDER.slice();
  try {
    const products = await getProducts();
    const prices = products.map(p => Number(p.price)).filter(n => n > 0);
    depositPool = Array.from(new Set(depositPool.concat(prices)));
  } catch (_) {}
  depositPool = depositPool.filter(n => n >= minDep);
  const withdrawPool = [];
  for (let a = _WIRE_STEP; a <= _WIRE_CAP; a += _WIRE_STEP) withdrawPool.push(a);
  const withdrawPoolFiltered = withdrawPool.filter(n => n >= minWit);
  if (!depositPool.length) depositPool = [minDep || 30000];
  if (!withdrawPoolFiltered.length) withdrawPoolFiltered.push(minWit || 8000);
  const rows = [];
  const usedNumbers = new Set();
  for (let i = 0; i < 60; i++) {
    const kind = Math.random() < 0.6 ? 'deposit' : 'withdraw';
    const pool = kind === 'deposit' ? depositPool : withdrawPoolFiltered;
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
  } else if (!_activityBuilding && Date.now() - _activityTs > 4000) {
    _activityBuilding = true;
    buildActivityFeed().then(f => { _activityFeed = f; _activityTs = Date.now(); })
      .catch(e => console.error('Activity feed error:', e.message))
      .finally(() => { _activityBuilding = false; });
  }
  res.json({ status: 'success', feed: _activityFeed });
});

// ═══════════════════════════════════════════
// REGISTRATION / ACCOUNT
// ═══════════════════════════════════════════
// A 5-digit PIN, per Snow's registration spec — rejects the weakest shape
// (all-same-digit) whenever a NEW PIN is being chosen, never when an
// existing one is being verified.
function isWeakPin(pin) { return /^(\d)\1{4}$/.test(String(pin || '')); }

function defaultProfileDoc(phone) {
  return {
    phone: phone || '', walletBalance: 0, totalDeposited: 0, totalEarned: 0, totalWithdrawn: 0, totalInvested: 0,
    checkinStreak: 0, lastCheckin: null,
    teamL1Count: 0, teamL2Count: 0, teamL3Count: 0, teamCommission: 0,
    referredBy: null, referralCode: null, registrationDone: false, status: 'active',
    createdAt: FieldValue.serverTimestamp()
  };
}
app.post('/account/create-profile', async (req, res) => {
  const auth = await verifyAuthWithEmail(req);
  if (!auth) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const userId = auth.uid;
  const phone = phoneFromVerifiedEmail(auth.email, req.body.phone);
  try {
    const ref = db.collection('users').doc(userId);
    const snap = await ref.get();
    if (snap.exists) return res.json({ status: 'success', message: 'Profile already exists' });
    await ref.set(defaultProfileDoc(phone));
    res.json({ status: 'success' });
  } catch (e) {
    console.error('create-profile error:', e.message);
    res.status(500).json({ status: 'error', message: 'Could not create your profile' });
  }
});
// Shared by the member's own /register — the ONE place that ever assigns a
// referral code, links a referrer's team counts, sets the Transaction PIN,
// or credits the welcome bonus.
async function completeRegistrationCore(userId, referralCode, pin) {
  return withLock('reg:' + userId, async () => {
    const userRef = db.collection('users').doc(userId);
    const userSnap = await userRef.get();
    if (!userSnap.exists) return { code: 404, body: { status: 'error', message: 'User not found' } };
    if (userSnap.data().registrationDone)
      return { code: 200, body: { status: 'already_done', referralCode: userSnap.data().referralCode || null } };

    if (!/^\d{5}$/.test(String(pin || '')))
      return { code: 400, body: { status: 'error', code: 'INVALID_PIN', message: 'Enter a 5-digit Transaction PIN.' } };
    if (isWeakPin(pin))
      return { code: 400, body: { status: 'error', code: 'WEAK_PIN', message: 'That PIN is too easy to guess. Choose 5 digits that are not all the same.' } };

    const code = String(referralCode || '').trim();
    let referrerId = null;
    if (code) {
      const refSnap = await db.collection('users').where('referralCode', '==', code).limit(1).get();
      if (refSnap.empty)
        return { code: 400, body: { status: 'error', code: 'BAD_REFERRAL', message: 'That referral code does not exist.' } };
      if (refSnap.docs[0].id === userId)
        return { code: 400, body: { status: 'error', code: 'BAD_REFERRAL', message: 'You cannot use your own referral code.' } };
      if (refSnap.docs[0].data().status === 'banned')
        return { code: 400, body: { status: 'error', code: 'BAD_REFERRAL', message: 'That referral code is no longer active.' } };
      referrerId = refSnap.docs[0].id;
    }

    const [myRefCode, myPublicId] = await Promise.all([generateUniqueReferralCode(userId), nextSequentialPublicId()]);
    const sett = await getSettings();
    const WELCOME = Number(sett.welcomeBonus) || 0;
    const commit = async () => {
      if (referrerId) {
        const refCheck = await db.collection('users').doc(referrerId).get();
        if (!refCheck.exists || refCheck.data().status === 'banned') referrerId = null;
      }
      const update = {
        registrationDone: true, referralCode: myRefCode, publicId: myPublicId,
        walletBalance: FieldValue.increment(WELCOME), transactionPinHash: scryptHash(pin),
      };
      if (referrerId) update.referredBy = referrerId;
      // The user's own doc is written FIRST, in one atomic single-document
      // update — a crash right after this leaves the member fully and
      // correctly paid and marked done; a retry hits registrationDone above
      // and stops. Referrer team-count increments run AFTER on purpose (see
      // the same pattern space8 uses) so a crash here can only under-count,
      // never double-count on a retry.
      await userRef.update(update);
      if (referrerId) {
        await db.collection('users').doc(referrerId).update({ teamL1Count: FieldValue.increment(1) });
        const l1Snap = await db.collection('users').doc(referrerId).get();
        const l2Id = l1Snap.exists ? l1Snap.data().referredBy : null;
        if (l2Id && l2Id !== referrerId) {
          await db.collection('users').doc(l2Id).update({ teamL2Count: FieldValue.increment(1) });
          const l2Snap = await db.collection('users').doc(l2Id).get();
          const l3Id = l2Snap.exists ? l2Snap.data().referredBy : null;
          if (l3Id && l3Id !== referrerId && l3Id !== l2Id) await db.collection('users').doc(l3Id).update({ teamL3Count: FieldValue.increment(1) });
        }
      }
    };
    if (referrerId) await withLock('referrer-guard:' + referrerId, commit);
    else await commit();
    if (WELCOME > 0) {
      const { date, time } = nowStr();
      await db.collection('transactions').add({
        userId, type: 'welcome_bonus', description: 'Welcome gift',
        amount: WELCOME, status: 'success', date, time, createdAt: FieldValue.serverTimestamp()
      });
    }
    return { code: 200, body: { status: 'success', referrerId, welcomeBonus: WELCOME, referralCode: myRefCode, publicId: myPublicId } };
  });
}
app.post('/register', async (req, res) => {
  const auth = await verifyAuthWithEmail(req);
  if (!auth) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const userId = auth.uid;
  try {
    const ref = db.collection('users').doc(userId);
    const existing = await ref.get();
    if (!existing.exists) {
      const phone = phoneFromVerifiedEmail(auth.email, req.body.phone);
      await ref.set(defaultProfileDoc(phone));
    }
    const result = await completeRegistrationCore(userId, req.body.referralCode, req.body.pin);
    const { referrerId, ...memberBody } = result.body;
    res.status(result.code).json(memberBody);
  } catch (e) {
    console.error('Register error:', e.message);
    res.status(500).json({ status: 'error', message: 'Could not complete your registration right now' });
  }
});
app.get('/account', async (req, res) => {
  const uid = await verifyAuth(req);
  if (!uid) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    await settleAllForUser(uid);
    const snap = await db.collection('users').doc(uid).get();
    if (!snap.exists) return res.status(404).json({ status: 'error', code: 'NOT_FOUND', message: 'User not found' });
    const u = snap.data();
    if (u.status === 'banned')
      return res.status(403).json({ status: 'error', code: 'BANNED', message: 'Account suspended. Contact customer service.' });
    res.json({ status: 'success', account: {
      phone: u.phone, walletBalance: u.walletBalance || 0, totalDeposited: u.totalDeposited || 0,
      totalEarned: u.totalEarned || 0, totalWithdrawn: u.totalWithdrawn || 0, totalInvested: u.totalInvested || 0,
      checkinStreak: u.checkinStreak || 0, lastCheckin: u.lastCheckin || null,
      referralCode: u.referralCode || null, publicId: u.publicId || null, registrationDone: !!u.registrationDone,
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
    let result = null;
    await withLock('checkin:' + uid, async () => {
      const sett = await getSettings();
      const ref = db.collection('users').doc(uid);
      const snap = await ref.get();
      if (!snap.exists) { result = { code: 404, body: { status: 'error', message: 'User not found' } }; return; }
      const u = snap.data();
      if (u.status === 'banned') { result = { code: 403, body: { status: 'error', code: 'BANNED', message: 'Account suspended. Contact customer service.' } }; return; }
      const today = nowStr().date;
      if (u.lastCheckin === today) { result = { code: 400, body: { status: 'error', message: 'Already checked in today' } }; return; }
      const ledgerSnap = await db.collection('transactions')
        .where('userId', '==', uid).where('type', '==', 'checkin').orderBy('createdAt', 'desc').limit(500).get();
      const dayKeys = new Set();
      ledgerSnap.forEach(d => dayKeys.add(eatDayKey(d.data().createdAt)));
      const real = computeCheckinStreak(dayKeys);
      const yesterday = new Date(eatNow().getTime() - 86400000);
      const yPad = n => String(n).padStart(2, '0');
      const yStr = yPad(yesterday.getUTCMonth() + 1) + '/' + yPad(yesterday.getUTCDate()) + '/' + yesterday.getUTCFullYear();
      const streak = real.lastCheckin === yStr ? real.streak + 1 : 1;
      const bonus = Number(sett.dailyCheckin) || 0;
      await ref.update({ walletBalance: FieldValue.increment(bonus), totalEarned: FieldValue.increment(bonus), lastCheckin: today, checkinStreak: streak });
      const { date, time } = nowStr();
      await db.collection('transactions').add({
        userId: uid, type: 'checkin', description: `Daily check-in, day ${streak}`,
        amount: bonus, status: 'success', date, time, createdAt: FieldValue.serverTimestamp()
      });
      result = { code: 200, body: { status: 'success', bonus, streak } };
    });
    res.status(result.code).json(result.body);
  } catch (e) {
    console.error('Checkin error:', e.message);
    res.status(500).json({ status: 'error', message: 'Check-in failed' });
  }
});

// ═══════════════════════════════════════════
// INVESTMENTS
// ═══════════════════════════════════════════
app.post('/invest/create', async (req, res) => {
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Please sign in again' });
  const tier = await getProductByKey(req.body.tierKey);
  if (!tier) return res.status(400).json({ status: 'error', message: 'Unknown product' });
  if (tier.active === false || tier.comingSoon) return res.status(400).json({ status: 'error', message: 'This product is not available right now.' });
  try {
    const sett = await getSettings();
    let invId, liveTier, cycle, expectedReturn, dailyPayout;
    await withLock('bal:' + userId, () => db.runTransaction(async t => {
      liveTier = await getProductByKey(tier.key);
      if (!liveTier || liveTier.active === false || liveTier.comingSoon) throw new Error('This product is not available right now.');
      cycle = Number(liveTier.cycle) || sett.cycleDays;
      expectedReturn = Number(liveTier.expectedReturn) || Math.round(liveTier.price * sett.returnMultiple);
      dailyPayout = Math.round(expectedReturn / cycle);
      const uRef = db.collection('users').doc(userId);
      const fresh = await t.get(uRef);
      if (!fresh.exists) throw new Error('User not found');
      if (fresh.data().status === 'banned') { const banErr = new Error('Account suspended. Contact customer service.'); banErr.code = 'BANNED'; throw banErr; }
      const bal = fresh.data().walletBalance || 0;
      if (bal < liveTier.price) throw new Error(`Need ${fmtUGX(liveTier.price)}, have ${fmtUGX(bal)}`);
      const isFirstInvestment = !(fresh.data().firstInvestmentDone === true || (fresh.data().totalInvested || 0) > 0);
      const invRef = db.collection('investments').doc();
      invId = invRef.id;
      const newInvested = (Number(fresh.data().totalInvested) || 0) + liveTier.price;
      // Debited via increment(), not an absolute newBalance write, so a
      // concurrent credit from a different lock key (deposit, commission)
      // landing mid-transaction can never be silently overwritten.
      t.update(uRef, { walletBalance: FieldValue.increment(-liveTier.price), totalInvested: newInvested, firstInvestmentDone: true });
      const { date, time } = nowStr();
      t.set(invRef, {
        userId, tierKey: liveTier.key, tierLabel: liveTier.name, amount: liveTier.price, cycle, expectedReturn,
        status: 'active', dailyPayout, payoutsTotal: cycle, payoutsMade: 0, paidOut: 0,
        isFirstInvestment, commissionPaidLevels: [], commissionPending: isFirstInvestment === true,
        date, time, createdAt: FieldValue.serverTimestamp()
      });
      t.set(db.collection('transactions').doc(), {
        userId, type: 'investment', description: `Bought ${liveTier.name}`, amount: -liveTier.price,
        status: 'success', date, time, investmentId: invRef.id, createdAt: FieldValue.serverTimestamp()
      });
    }));
    creditReferralCommission(invId, userId, liveTier.price).catch(e => console.error('Commission error:', e.message));
    res.json({ status: 'success', investmentId: invId, message: `Bought ${liveTier.name} for ${fmtUGX(liveTier.price)}` });
  } catch (e) {
    res.status(400).json({ status: 'error', code: e.code, message: e.message });
  }
});
app.get('/investments', async (req, res) => {
  const uid = await verifyAuth(req);
  if (!uid) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    await settleAllForUser(uid);
    const [snap, products] = await Promise.all([
      db.collection('investments').where('userId', '==', uid).get(), getProducts()
    ]);
    const byKey = new Map(products.map(p => [p.key, p]));
    const investments = snap.docs.map(d => {
      const data = d.data();
      const live = byKey.get(data.tierKey);
      return { id: d.id, ...data, tierLabel: (live && live.name) || data.tierLabel };
    });
    res.json({ status: 'success', investments });
  } catch (e) {
    res.status(500).json({ status: 'error', message: 'Could not load your plans' });
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
  if (amt > MAX_MONEY_AMOUNT) return res.status(400).json({ status: 'error', message: `Amount is too large (max ${fmtUGX(MAX_MONEY_AMOUNT)}).` });
  try {
    const [uSnap, sett] = await Promise.all([db.collection('users').doc(userId).get(), getSettings()]);
    if (!uSnap.exists) return res.status(404).json({ status: 'error', message: 'User not found' });
    if (uSnap.data().status === 'banned') return res.status(403).json({ status: 'error', code: 'BANNED', message: 'Account suspended. Contact customer service.' });
    if (_userBeingDeleted.has(userId)) return res.status(400).json({ status: 'error', message: 'This account is currently being processed. Try again shortly.' });

    const attemptCount = recordDepositAttempt(userId);
    if (attemptCount >= 5 && !_depAttemptsSucceeded.has(userId)) {
      await banUserAutomatically(userId, 'Automatic: 5+ deposit attempts within a minute, none completed');
      return res.status(403).json({ status: 'error', code: 'BANNED', message: 'Account suspended. Contact customer service.' });
    }

    const lastDep = _depCreateDebounce.get(userId) || 0;
    if (Date.now() - lastDep < 7000)
      return res.status(429).json({ status: 'error', message: 'A deposit is already being processed. Please wait a moment.' });
    _depCreateDebounce.set(userId, Date.now());

    if (amt < sett.minDeposit) return res.status(400).json({ status: 'error', message: `Minimum amount is ${fmtUGX(sett.minDeposit)}` });
    const phone = cleanPhone(req.body.phone || uSnap.data().phone || '');
    if (!phone) return res.status(400).json({ status: 'error', message: 'Enter a valid mobile-money phone number.' });

    const ref = await uniqueRef('S');
    const marzReference = crypto.randomUUID();
    const { date, time } = nowStr();
    const depRef = db.collection('pendingDeposits').doc();
    const network = NETWORK_NAMES.has(req.body.network) ? req.body.network : null;
    await depRef.set({
      userId, phone, network, amount: amt, ref, marzReference, status: 'initiating',
      date, time, createdAt: FieldValue.serverTimestamp()
    });
    // Respond the instant our own write lands — do not wait on MarzPay's own
    // round-trip. The status screen's own polling picks up the resolution.
    res.json({ status: 'success', depositId: depRef.id, reference: ref, message: 'Payment initiated. Check your phone.' });
    let mpData;
    try {
      mpData = await marzCollect({
        amount: amt, phone, reference: marzReference, description: 'Mobile Money',
        callbackUrl: PUBLIC_URL ? PUBLIC_URL + '/deposit/callback' : undefined
      });
    } catch (netErr) {
      console.error('MarzPay collect-money network error (ref ' + ref + '):', netErr.message);
      return;
    }
    if (mpData.status !== 'success' && mpData.status !== 'sandbox') {
      console.error('MarzPay collect-money rejected:', JSON.stringify(mpData));
      await markDepositFailed(depRef, userId, marzUserMsg(mpData, 'Could not start the payment'));
      return;
    }
    const marzTxUuid = mpData.data?.transaction?.uuid || null;
    await depRef.update({ status: 'pending', marzTxUuid });
  } catch (e) {
    console.error('Deposit error:', e.message);
    if (!res.headersSent) res.status(500).json({ status: 'error', message: PROVIDER_BUSY_MSG });
  }
});
const _creditingDeposits = new Set();
async function creditDeposit(depDoc) {
  const dep = depDoc.data();
  if (dep.status === 'matched') return true;
  if (_creditingDeposits.has(depDoc.id)) return false;
  _creditingDeposits.add(depDoc.id);
  try {
    let credited = false, justCredited = false, creditedAmount = 0;
    await withLock('dep:' + depDoc.id, async () => {
      const fresh = await depDoc.ref.get();
      if (!fresh.exists || fresh.data().status === 'matched') { credited = fresh.exists; return; }
      const depUserId = fresh.data().userId;
      const depAmount = Number(fresh.data().amount) || 0;
      // CLAIM-BEFORE-CREDIT: flip to 'matched' before touching the wallet, so
      // a retry from the webhook, the client poll, or the reconciler is a
      // clean no-op instead of a double credit.
      await depDoc.ref.update({ status: 'matched', creditedAt: FieldValue.serverTimestamp() });
      try {
        await db.collection('users').doc(depUserId).update({
          walletBalance: FieldValue.increment(depAmount), totalDeposited: FieldValue.increment(depAmount)
        });
      } catch (creditErr) {
        await depDoc.ref.update({ needsManualCredit: true }).catch(() => {});
        console.error(`DEPOSIT CREDIT FAILED (needs manual credit) dep=${depDoc.id} user=${depUserId} amount=${depAmount}:`, creditErr.message);
        throw creditErr;
      }
      const { date, time } = nowStr();
      await db.collection('transactions').add({
        userId: depUserId, type: 'deposit', description: 'Wallet recharge',
        amount: depAmount, status: 'success', date, time, ref: fresh.data().ref,
        createdAt: FieldValue.serverTimestamp()
      });
      credited = true; justCredited = true; creditedAmount = depAmount;
    });
    // Only on a REAL new credit (never an idempotent replay/no-op) -- a
    // retried webhook/poll must never fire a duplicate push for the same money.
    if (justCredited) {
      markDepositAttemptSucceeded(dep.userId);
      sendAdminPush('Deposit completed', `${fmtUGX(creditedAmount)} credited to a wallet`, { type: 'deposit', depositId: depDoc.id }).catch(() => {});
    }
    return credited;
  } finally { _creditingDeposits.delete(depDoc.id); }
}
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
    if (SUCCESS_STATUSES.has(marzStatus)) { await creditDeposit(depSnap); return res.json({ status: 'success', state: 'matched' }); }
    if (FAILED_STATUSES.has(marzStatus)) {
      await markDepositFailed(depSnap.ref, userId, DEPOSIT_FAILED_MSG);
      return res.json({ status: 'success', state: 'failed', message: DEPOSIT_FAILED_MSG });
    }
    res.json({ status: 'success', state: 'pending' });
  } catch (e) {
    console.error('Deposit status error:', e.message);
    res.status(500).json({ status: 'error', message: 'Could not check payment status' });
  }
});
// MarzPay webhook. Never trusts the claimed status alone — crediting only
// ever happens after an independent live re-check confirms it, and a uuid
// this endpoint didn't itself capture is only trusted once that check's own
// reported `reference` is confirmed to match this exact deposit.
app.post('/deposit/callback', async (req, res) => {
  res.status(200).json({ status: 'ok' });
  try {
    const body = req.body || {};
    const reference = body.data?.reference || body.reference || body.data?.transaction?.reference || body.transaction?.reference;
    if (!reference) return;
    let rawStatus = String(body.data?.transaction?.status || body.transaction?.status || body.data?.status || body.status || '').toLowerCase();
    if (!rawStatus) rawStatus = marzEventTypeFallback(body.event_type);
    const isSuccess = SUCCESS_STATUSES.has(rawStatus);
    const isFailed  = FAILED_STATUSES.has(rawStatus);
    if (!isSuccess && !isFailed) return;
    const depSnap = await db.collection('pendingDeposits').where('marzReference', '==', reference).limit(1).get();
    if (depSnap.empty) return;
    const doc = depSnap.docs[0];
    const dep = doc.data();
    if (dep.status !== 'pending' && dep.status !== 'initiating') return;
    const webhookUuid = body.data?.transaction?.uuid || body.transaction?.uuid || body.data?.uuid || null;
    let uuid = dep.marzTxUuid;
    let tx = null;
    if (uuid) {
      tx = await marzGetCollectTx(uuid);
    } else if (webhookUuid) {
      const candidate = await marzGetCollectTx(webhookUuid);
      if (candidate.reference && candidate.reference === dep.marzReference) {
        uuid = webhookUuid; tx = candidate;
        doc.ref.update({ marzTxUuid: uuid }).catch(() => {});
      }
    }
    if (!uuid || !tx) return;
    if (isSuccess) {
      if (!SUCCESS_STATUSES.has(tx.status)) return;
      await creditDeposit(doc);
    } else if (isFailed) {
      if (!FAILED_STATUSES.has(tx.status)) return;
      await markDepositFailed(doc.ref, dep.userId, DEPOSIT_FAILED_MSG);
    }
  } catch (e) { console.error('Deposit callback error:', e.message); }
});

// ═══════════════════════════════════════════
// WITHDRAWAL (MarzPay send-money, mobile money only)
// ═══════════════════════════════════════════
const _withdrawInFlight = new Set();
const _witRequestInFlight = new Set();
// The Transaction PIN set at registration is the ONLY PIN in Snow — it
// gates every withdrawal request and every withdrawal-account bind/delete.
const PIN_LOCK_MS = 15 * 60 * 1000;
const PIN_MAX_FAILS = 5;
async function pinCheck(userId, pin) {
  if (!/^\d{5}$/.test(String(pin || '')))
    return { ok: false, code: 'INVALID_PIN', message: 'Enter your 5-digit Transaction PIN.' };
  return withLock('pin:' + userId, async () => {
    const uRef = db.collection('users').doc(userId);
    const snap = await uRef.get();
    if (!snap.exists) return { ok: false, code: 'NOT_FOUND', message: 'Account not found' };
    const u = snap.data();
    const now = Date.now();
    if (u.pinLockedUntil && tsMillis(u.pinLockedUntil) > now) {
      const mins = Math.ceil((tsMillis(u.pinLockedUntil) - now) / 60000);
      return { ok: false, code: 'LOCKED', message: `Too many wrong PIN attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.` };
    }
    if (!u.transactionPinHash) return { ok: false, code: 'NO_PIN', message: 'No Transaction PIN is set on this account.' };
    if (!scryptVerify(pin, u.transactionPinHash)) {
      const fails = (u.pinFailCount || 0) + 1;
      const update = { pinFailCount: fails };
      let locked = false;
      if (fails >= PIN_MAX_FAILS) { update.pinLockedUntil = new Date(now + PIN_LOCK_MS); update.pinFailCount = 0; locked = true; }
      await uRef.update(update);
      return { ok: false, code: locked ? 'LOCKED' : 'WRONG_PIN', message: locked ? `Too many wrong PIN attempts. Try again in ${PIN_LOCK_MS / 60000} minutes.` : 'Incorrect Transaction PIN.' };
    }
    await uRef.update({ pinFailCount: 0 });
    return { ok: true };
  });
}
app.post('/withdraw/request', async (req, res) => {
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Please sign in again' });
  if (_witRequestInFlight.has(userId))
    return res.status(429).json({ status: 'error', message: 'A withdrawal is already being processed. Please wait a moment.' });
  if (_userBeingDeleted.has(userId))
    return res.status(400).json({ status: 'error', message: 'This account is currently being processed. Try again shortly.' });
  _witRequestInFlight.add(userId);
  try {
    const amt = parseInt(req.body.amount, 10);
    if (isNaN(amt) || amt <= 0) return res.status(400).json({ status: 'error', message: 'Invalid amount' });
    if (amt > MAX_MONEY_AMOUNT) return res.status(400).json({ status: 'error', message: `Amount is too large (max ${fmtUGX(MAX_MONEY_AMOUNT)}).` });
    const rawNetwork = String(req.body.network || '').trim();
    if (!NETWORK_NAMES.has(rawNetwork)) return res.status(400).json({ status: 'error', message: 'Bind a withdrawal account first.' });
    const destValue = cleanPhone(req.body.phone || '');
    if (!destValue) return res.status(400).json({ status: 'error', message: 'Bind a withdrawal account first.' });
    const sett = await getSettings();
    if (amt < sett.minWithdraw) return res.status(400).json({ status: 'error', message: `Minimum cash-out is ${fmtUGX(sett.minWithdraw)}` });
    const check = await pinCheck(userId, req.body.pin);
    if (!check.ok) return res.status(400).json({ status: 'error', code: check.code, message: check.message });

    const boundSnap = await db.collection('bankAccounts')
      .where('userId', '==', userId).where('network', '==', rawNetwork).where('phone', '==', destValue).limit(1).get();
    if (boundSnap.empty)
      return res.status(400).json({ status: 'error', code: 'UNBOUND_ACCOUNT', message: "That withdrawal account isn't saved to your profile. Bind it first, then try again." });
    const holder = boundSnap.docs[0].data().holder;

    const fee = Math.round(amt * sett.withdrawFeePct / 100);
    const net = amt - fee;
    const ref = await uniqueRef('S');
    let witId;
    await withLock('bal:' + userId, () => db.runTransaction(async t => {
      const uRef = db.collection('users').doc(userId);
      const fresh = await t.get(uRef);
      if (!fresh.exists) throw new Error('User not found');
      if (fresh.data().status === 'banned') { const banErr = new Error('Account suspended. Contact customer service.'); banErr.code = 'BANNED'; throw banErr; }
      if (sett.requireInvestToWithdraw !== false && (fresh.data().totalInvested || 0) <= 0)
        throw new Error('Purchase at least one plan before you can cash out.');
      const bal = fresh.data().walletBalance || 0;
      if (bal < amt) throw new Error(`Not enough balance, you have ${fmtUGX(bal)}`);
      const maxPerDay = Number(sett.maxWithdrawalsPerDay) || 0;
      if (maxPerDay > 0) {
        const today = nowStr().date;
        const todaySnap = await t.get(db.collection('withdrawals').where('userId', '==', userId).where('date', '==', today));
        if (todaySnap.size >= maxPerDay)
          throw new Error(`You've reached today's limit of ${maxPerDay} cash-out${maxPerDay === 1 ? '' : 's'}. Try again tomorrow.`);
      }
      const witRef = db.collection('withdrawals').doc();
      witId = witRef.id;
      t.update(uRef, { walletBalance: FieldValue.increment(-amt) });
      const { date, time } = nowStr();
      t.set(witRef, { userId, amount: amt, fee, net, holder, network: rawNetwork, phone: destValue, ref, status: 'pending', date, time, createdAt: FieldValue.serverTimestamp() });
      t.set(db.collection('transactions').doc(), {
        userId, type: 'withdraw', description: `Cash out to ${holder} (${rawNetwork}), net ${fmtUGX(net)} after ${sett.withdrawFeePct}% fee, processing`,
        amount: -amt, status: 'pending', date, time, ref, withdrawalId: witRef.id, createdAt: FieldValue.serverTimestamp()
      });
    }));
    sendAdminPush('New withdrawal request', `${fmtUGX(amt)} requested via ${rawNetwork}`, { type: 'withdrawal', withdrawalId: witId }).catch(() => {});
    res.json({ status: 'success', withdrawalId: witId, reference: ref, net, message: 'Cash-out requested — processing now' });
  } catch (e) {
    res.status(400).json({ status: 'error', code: e.code, message: e.message });
  } finally { _witRequestInFlight.delete(userId); }
});
async function finalizeWithdrawalTransactionRecord(withdrawalId, outcome) {
  try {
    const txSnap = await db.collection('transactions').where('withdrawalId', '==', withdrawalId).limit(10).get();
    if (txSnap.empty) return;
    const newStatus = outcome === 'processed' ? 'success' : 'failed';
    await Promise.all(txSnap.docs.map(txDoc => {
      const oldDesc = txDoc.data().description || '';
      const newDesc = outcome === 'processed' ? oldDesc.replace(/, processing$/, '') : oldDesc.replace(/, processing$/, ' — failed, refunded to wallet');
      const update = { status: newStatus, description: newDesc };
      if (newStatus === 'failed') update.amount = 0; // wallet was refunded in full — zero this row so the ledger sum stays correct
      return txDoc.ref.update(update);
    }));
  } catch (e) { console.warn('finalizeWithdrawalTransactionRecord (non-critical):', e.message); }
}
// Guarded transition to 'processed' — shares the SAME 'bal:'+userId lock key
// every failure/refund path already uses, so a success and a failure branch
// can never race each other into disagreeing about the final outcome.
async function markWithdrawalProcessed(witRef, userId) {
  let didTransition = false;
  await withLock('bal:' + userId, () => db.runTransaction(async t => {
    const fresh = await t.get(witRef);
    if (!fresh.exists || fresh.data().status !== 'processing') return;
    t.update(witRef, { status: 'processed', processedAt: FieldValue.serverTimestamp() });
    didTransition = true;
  }));
  return didTransition;
}
async function processWithdrawalCore(withdrawalId, processedBy) {
  if (_withdrawInFlight.has(withdrawalId))
    return { code: 409, body: { status: 'error', message: 'Another admin is already acting on this withdrawal. Check the list in a moment.' } };
  _withdrawInFlight.add(withdrawalId);
  try {
    const witRef = db.collection('withdrawals').doc(withdrawalId);
    const witSnap = await witRef.get();
    if (!witSnap.exists) return { code: 404, body: { status: 'error', message: 'Withdrawal not found' } };
    const wit = witSnap.data();
    if (wit.status !== 'pending') return { code: 400, body: { status: 'error', message: `Cannot send, the status is '${wit.status}'` } };

    const sendingMarker = crypto.randomUUID();
    await witRef.update({ status: 'sending', sendingReference: sendingMarker, sendingBy: processedBy, sendingAt: FieldValue.serverTimestamp() });

    let mpData, ambiguous = false;
    try {
      mpData = await marzSendMoney({
        amount: wit.net, phone: wit.phone, reference: sendingMarker, description: 'Withdrawal',
        callbackUrl: PUBLIC_URL ? PUBLIC_URL + '/withdraw/callback' : undefined
      });
    } catch (netErr) {
      // A network exception here is ambiguous, not a clean rejection — we
      // genuinely don't know if MarzPay received it. Never revert to
      // 'pending' (that would invite a retry that could double-pay); leave
      // it at 'sending' for the admin to check on MarzPay's own dashboard.
      console.error('MarzPay send-money network error (ambiguous, NOT reverting to pending):', netErr.message);
      ambiguous = true;
      mpData = { status: 'error', providerDown: true, message: netErr.message };
    }
    if (ambiguous) {
      return { code: 500, body: { status: 'error', message: 'Lost contact with MarzPay mid-request — we cannot confirm whether this payout was actually sent. It stays on "Sending" (not pending) so nobody retries it blindly.', sendingReference: sendingMarker } };
    }
    if (mpData.status !== 'success' && mpData.status !== 'sandbox') {
      await witRef.update({ status: 'pending', sendingReference: null, sendingBy: null, sendingAt: null }).catch(() => {});
      return { code: 400, body: { status: 'error', message: marzUserMsg(mpData, 'MarzPay could not send this payout right now. The withdrawal stays pending and untouched. Try again in a moment.') } };
    }
    const sandbox = mpData.status === 'sandbox';
    const updateFields = { status: sandbox ? 'processed' : 'processing', processedBy, processedAt: FieldValue.serverTimestamp(), marzReference: sendingMarker, marzTxUuid: mpData.data?.transaction?.uuid || null };
    await witRef.update(updateFields);
    try {
      await db.collection('users').doc(wit.userId).update({ totalWithdrawn: FieldValue.increment(wit.net) });
    } catch (twErr) {
      console.error(`MONEY-SAFETY: totalWithdrawn increment failed AFTER withdrawal ${withdrawalId} was marked sent — user ${wit.userId} is missing +${wit.net} in their totalWithdrawn stat. Backfill by hand.`, twErr.message);
    }
    if (sandbox) await finalizeWithdrawalTransactionRecord(withdrawalId, 'processed');
    else {
      try {
        const txSnap = await db.collection('transactions').where('withdrawalId', '==', withdrawalId).limit(1).get();
        if (!txSnap.empty) await txSnap.docs[0].ref.update({ status: 'processing' });
      } catch (txErr) { console.warn('Process tx update (non-critical):', txErr.message); }
    }
    return {
      code: 200,
      body: { status: 'success', sandbox, message: sandbox ? `Sandbox: withdrawal marked complete, ${fmtUGX(wit.net)} to ${wit.phone}` : `Sending ${fmtUGX(wit.net)} to ${wit.phone}` },
      meta: { amount: wit.net, dest: wit.phone, userId: wit.userId }
    };
  } catch (e) {
    console.error('Process withdrawal error:', e.message);
    return { code: 500, body: { status: 'error', message: e.message } };
  } finally { _withdrawInFlight.delete(withdrawalId); }
}
app.post('/admin/withdraw/process', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const withdrawalId = String(req.body.withdrawalId || '');
  if (!withdrawalId) return res.status(400).json({ status: 'error', message: 'withdrawalId required' });
  const result = await processWithdrawalCore(withdrawalId, 'owner');
  if (result.code === 200) logAdminAction(req, 'withdrawal_processed', { withdrawalId, ...result.meta });
  res.status(result.code).json(result.body);
});
app.post('/admin/withdraw/verify', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const withdrawalId = String(req.body.withdrawalId || '');
  if (!withdrawalId) return res.status(400).json({ status: 'error', message: 'withdrawalId required' });
  try {
    const snap = await db.collection('withdrawals').doc(withdrawalId).get();
    if (!snap.exists) return res.status(404).json({ status: 'error', message: 'Withdrawal not found' });
    const w = snap.data();
    if (!w.marzTxUuid)
      return res.json({ status: 'success', ourStatus: w.status, marzStatus: 'no_reference', message: 'This payout never reached MarzPay (no gateway reference). Nothing was sent.' });
    const marzStatus = await marzGetSendStatus(w.marzTxUuid);
    const sent = SUCCESS_STATUSES.has(marzStatus);
    const failed = FAILED_STATUSES.has(marzStatus);
    let message;
    if (!marzStatus) message = 'MarzPay did not respond just now. Try Verify again in a moment.';
    else if (sent && w.status !== 'processed') message = `MarzPay says this payout was SENT, but our record is "${w.status}". Check the recipient before doing anything else.`;
    else if (sent) message = 'MarzPay confirms the payout was SENT and our record already shows it processed.';
    else if (failed) message = `MarzPay says this payout FAILED (status: ${marzStatus}).`;
    else message = `MarzPay reports status: ${marzStatus || 'unknown'}.`;
    res.json({ status: 'success', ourStatus: w.status, marzStatus: marzStatus || 'unknown', message });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/withdraw/marzpay/status', async (req, res) => {
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const witSnap = await db.collection('withdrawals').doc(String(req.body.withdrawalId || '')).get();
    if (!witSnap.exists || witSnap.data().userId !== userId)
      return res.status(404).json({ status: 'error', message: 'Cash-out not found' });
    const wit = witSnap.data();
    if (wit.status !== 'processing') return res.json({ status: 'success', state: wit.status });
    if (!wit.marzTxUuid) return res.json({ status: 'success', state: 'processing' });
    const marzStatus = await marzGetSendStatus(wit.marzTxUuid);
    if (SUCCESS_STATUSES.has(marzStatus)) {
      if (await markWithdrawalProcessed(witSnap.ref, userId)) {
        await finalizeWithdrawalTransactionRecord(witSnap.id, 'processed');
        return res.json({ status: 'success', state: 'processed' });
      }
      const nowSnap = await witSnap.ref.get();
      return res.json({ status: 'success', state: nowSnap.exists ? nowSnap.data().status : 'processed' });
    }
    if (FAILED_STATUSES.has(marzStatus)) {
      await withLock('bal:' + userId, () => db.runTransaction(async t => {
        const fresh = await t.get(witSnap.ref);
        if (!fresh.exists || fresh.data().status !== 'processing') return;
        const uRef = db.collection('users').doc(userId);
        t.update(witSnap.ref, { status: 'declined', failureReason: 'Payout failed at the mobile-money provider' });
        t.update(uRef, { walletBalance: FieldValue.increment(fresh.data().amount), totalWithdrawn: FieldValue.increment(-fresh.data().net) });
      }));
      await finalizeWithdrawalTransactionRecord(witSnap.id, 'declined');
      return res.json({ status: 'success', state: 'declined' });
    }
    res.json({ status: 'success', state: 'processing' });
  } catch (e) {
    console.error('Withdraw status error:', e.message);
    res.status(500).json({ status: 'error', message: 'Could not check cash-out status' });
  }
});
app.post('/withdraw/callback', async (req, res) => {
  res.status(200).json({ status: 'ok' });
  try {
    const body = req.body || {};
    const reference = body.data?.reference || body.reference || body.data?.transaction?.reference || body.transaction?.reference;
    if (!reference) return;
    let rawStatus = String(body.data?.transaction?.status || body.transaction?.status || body.data?.status || body.status || '').toLowerCase();
    if (!rawStatus) rawStatus = marzEventTypeFallback(body.event_type);
    const isSuccess = SUCCESS_STATUSES.has(rawStatus);
    const isFailed  = FAILED_STATUSES.has(rawStatus);
    if (!isSuccess && !isFailed) return;
    const witSnap = await db.collection('withdrawals').where('marzReference', '==', reference).limit(1).get();
    if (witSnap.empty) return;
    const doc = witSnap.docs[0];
    const wit = doc.data();
    if (wit.status !== 'processing') return;
    const webhookUuid = body.data?.transaction?.uuid || body.transaction?.uuid || body.data?.uuid || null;
    if (isSuccess) {
      // Best-effort live re-check: only VETOES the webhook on an explicit
      // contradiction; a check that itself fails/is empty never blocks a
      // genuinely-completed payout from being marked processed.
      const uuidForCheck = wit.marzTxUuid || webhookUuid;
      if (uuidForCheck) {
        const liveStatus = await marzGetSendStatus(uuidForCheck);
        if (liveStatus && !SUCCESS_STATUSES.has(liveStatus)) return;
      }
      if (webhookUuid) doc.ref.update({ marzTxUuid: webhookUuid }).catch(() => {});
      if (await markWithdrawalProcessed(doc.ref, wit.userId)) await finalizeWithdrawalTransactionRecord(doc.id, 'processed');
    } else if (isFailed) {
      let uuid = wit.marzTxUuid, tx = null;
      if (uuid) tx = await marzGetSendTx(uuid);
      else if (webhookUuid) {
        const candidate = await marzGetSendTx(webhookUuid);
        if (candidate.reference && candidate.reference === wit.marzReference) { uuid = webhookUuid; tx = candidate; doc.ref.update({ marzTxUuid: uuid }).catch(() => {}); }
      }
      if (!uuid || !tx || !FAILED_STATUSES.has(tx.status)) return;
      await withLock('bal:' + wit.userId, () => db.runTransaction(async t => {
        const fresh = await t.get(doc.ref);
        if (!fresh.exists || fresh.data().status !== 'processing') return;
        const uRef = db.collection('users').doc(wit.userId);
        t.update(doc.ref, { status: 'declined', failureReason: 'Payout failed at the mobile-money provider' });
        t.update(uRef, { walletBalance: FieldValue.increment(fresh.data().amount), totalWithdrawn: FieldValue.increment(-fresh.data().net) });
      }));
      await finalizeWithdrawalTransactionRecord(doc.id, 'declined');
    }
  } catch (e) { console.error('Withdraw callback error:', e.message); }
});

// ═══════════════════════════════════════════
// WITHDRAWAL ACCOUNTS (mobile money only)
// ═══════════════════════════════════════════
app.post('/bank/save', async (req, res) => {
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const holder = stripHtml(req.body.holder);
  const rawNetwork = String(req.body.network || '').trim();
  if (!holder || !NETWORK_NAMES.has(rawNetwork)) return res.status(400).json({ status: 'error', message: 'Fill in all fields' });
  const phone = cleanPhone(req.body.phone || '');
  if (!phone) return res.status(400).json({ status: 'error', message: 'That is not a valid Uganda mobile-money number. Use the format 07XXXXXXXX or +2567XXXXXXXX.' });
  try {
    const uSnap = await db.collection('users').doc(userId).get();
    if (uSnap.exists && uSnap.data().status === 'banned') return res.status(403).json({ status: 'error', code: 'BANNED', message: 'Account suspended. Contact customer service.' });
    const check = await pinCheck(userId, req.body.pin);
    if (!check.ok) return res.status(400).json({ status: 'error', code: check.code, message: check.message });
    const dup = await withLock('bank-save:' + userId, async () => {
      const dupSnap = await db.collection('bankAccounts').where('userId', '==', userId).where('phone', '==', phone).limit(1).get();
      if (!dupSnap.empty) return true;
      await db.collection('bankAccounts').add({ userId, holder, network: rawNetwork, phone, createdAt: FieldValue.serverTimestamp() });
      return false;
    });
    if (dup) return res.status(400).json({ status: 'error', message: 'This account is already saved as a withdrawal account.' });
    res.json({ status: 'success' });
  } catch (e) {
    res.status(500).json({ status: 'error', message: 'Could not save the withdrawal account' });
  }
});
app.get('/bank/list', async (req, res) => {
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const snap = await db.collection('bankAccounts').where('userId', '==', userId).get();
    res.json({ status: 'success', accounts: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
  } catch (e) { res.status(500).json({ status: 'error', message: 'Could not load withdrawal accounts' }); }
});
app.post('/bank/delete', async (req, res) => {
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const id = String(req.body.id || '');
  if (!id) return res.status(400).json({ status: 'error', message: 'Missing account id' });
  try {
    const ref = db.collection('bankAccounts').doc(id);
    const snap = await ref.get();
    if (!snap.exists || snap.data().userId !== userId) return res.status(404).json({ status: 'error', message: 'Account not found' });
    const check = await pinCheck(userId, req.body.pin);
    if (!check.ok) return res.status(400).json({ status: 'error', code: check.code, message: check.message });
    await ref.delete();
    res.json({ status: 'success' });
  } catch (e) { res.status(500).json({ status: 'error', message: 'Could not remove the withdrawal account' }); }
});
app.post('/account/transaction-pin/change', async (req, res) => {
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const newPin = String(req.body.newPin || '');
  if (!/^\d{5}$/.test(newPin)) return res.status(400).json({ status: 'error', message: 'New PIN must be 5 digits.' });
  if (isWeakPin(newPin)) return res.status(400).json({ status: 'error', message: 'That PIN is too easy to guess. Choose 5 digits that are not all the same.' });
  try {
    const check = await pinCheck(userId, req.body.oldPin);
    if (!check.ok) return res.status(400).json({ status: 'error', code: check.code, message: check.message });
    await db.collection('users').doc(userId).update({ transactionPinHash: scryptHash(newPin) });
    res.json({ status: 'success' });
  } catch (e) { res.status(500).json({ status: 'error', message: 'Could not change your PIN' }); }
});

// ═══════════════════════════════════════════
// GIFT CODES
// ═══════════════════════════════════════════
app.post('/redeem', async (req, res) => {
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Please sign in again' });
  // Strictly case-sensitive — a code only ever matches itself as issued.
  const raw = String(req.body.code || '').trim().slice(0, 32);
  if (!raw || !/^[A-Za-z0-9-]+$/.test(raw)) return res.status(400).json({ status: 'error', message: 'Enter a gift code' });
  try {
    let result = null;
    await withLock('redeem:' + raw, async () => {
      const userSnap = await db.collection('users').doc(userId).get();
      if (!userSnap.exists) { result = { code: 404, body: { status: 'error', message: 'User not found' } }; return; }
      if (userSnap.data().status === 'banned') { result = { code: 403, body: { status: 'error', code: 'BANNED', message: 'Account suspended. Contact customer service.' } }; return; }
      const codeSnap = await db.collection('promoCodes').where('code', '==', raw).limit(1).get();
      if (codeSnap.empty) { result = { code: 400, body: { status: 'error', message: "That code isn't valid" } }; return; }
      const codeDoc = codeSnap.docs[0];
      const cd = codeDoc.data();
      const code = cd.code;
      if (cd.active === false) { result = { code: 400, body: { status: 'error', message: 'This code is no longer active' } }; return; }
      if (cd.expiresAt && tsMillis(cd.expiresAt) < Date.now()) { result = { code: 400, body: { status: 'error', message: 'This code has expired' } }; return; }
      const usedBy = cd.usedBy || [];
      if (usedBy.indexOf(userId) !== -1) { result = { code: 400, body: { status: 'error', message: "You've already used this code" } }; return; }
      if (cd.maxUses && usedBy.length >= cd.maxUses) { result = { code: 400, body: { status: 'error', message: 'This code has reached its usage limit' } }; return; }
      const reward = Number(cd.reward) || 0;
      // CLAIM-BEFORE-CREDIT — a retried redeem after a mid-request failure
      // must never credit twice off the same code.
      await codeDoc.ref.update({ usedBy: FieldValue.arrayUnion(userId) });
      const claimSnap = await codeDoc.ref.get();
      const claimedBy = (claimSnap.exists && claimSnap.data().usedBy) || [];
      if (claimedBy.indexOf(userId) === -1) { result = { code: 500, body: { status: 'error', message: 'Could not redeem this code' } }; return; }
      if (cd.maxUses && claimedBy.length > cd.maxUses) {
        await codeDoc.ref.update({ usedBy: FieldValue.arrayRemove(userId) }).catch(() => {});
        result = { code: 400, body: { status: 'error', message: 'This code has reached its usage limit' } }; return;
      }
      await db.collection('users').doc(userId).update({
        walletBalance: FieldValue.increment(reward), totalEarned: FieldValue.increment(reward)
      });
      await db.collection('promoRedemptions').add({ userId, code, reward, createdAt: FieldValue.serverTimestamp() });
      const { date, time } = nowStr();
      await db.collection('transactions').add({
        userId, type: 'promocode', description: `Gift code redeemed: ${code}`,
        amount: reward, status: 'success', date, time, createdAt: FieldValue.serverTimestamp()
      });
      result = { code: 200, body: { status: 'success', reward } };
    });
    res.status(result.code).json(result.body);
  } catch (e) {
    console.error('Redeem error:', e.message);
    res.status(500).json({ status: 'error', message: 'Could not redeem this code' });
  }
});

// ═══════════════════════════════════════════
// TRANSACTIONS / HISTORY
// ═══════════════════════════════════════════
app.get('/transactions', async (req, res) => {
  const uid = await verifyAuth(req);
  if (!uid) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const snap = await db.collection('transactions').where('userId', '==', uid).orderBy('createdAt', 'desc').limit(300).get();
    res.json({ status: 'success', transactions: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
  } catch (e) { res.status(500).json({ status: 'error', message: 'Could not load your records' }); }
});
app.get('/deposits', async (req, res) => {
  const uid = await verifyAuth(req);
  if (!uid) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const snap = await db.collection('pendingDeposits').where('userId', '==', uid).orderBy('createdAt', 'desc').limit(200).get();
    res.json({ status: 'success', deposits: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
  } catch (e) { res.status(500).json({ status: 'error', message: 'Could not load deposit history' }); }
});
app.get('/withdrawals', async (req, res) => {
  const uid = await verifyAuth(req);
  if (!uid) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const snap = await db.collection('withdrawals').where('userId', '==', uid).orderBy('createdAt', 'desc').limit(200).get();
    res.json({ status: 'success', withdrawals: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
  } catch (e) { res.status(500).json({ status: 'error', message: 'Could not load withdrawal history' }); }
});

// ═══════════════════════════════════════════
// ADMIN
// ═══════════════════════════════════════════
app.post('/admin/check-key', async (req, res) => {
  const { key } = req.body;
  if (!ADMIN_KEY) return res.status(500).json({ status: 'error', message: 'Admin key not configured' });
  if (loginLocked('owner-key')) return res.status(429).json({ status: 'error', message: 'Too many attempts. Try again in 15 minutes.' });
  if (!safeEqual(key, ADMIN_KEY)) { recordLoginFail('owner-key'); return res.status(401).json({ status: 'error', message: 'Invalid key' }); }
  clearLoginFails('owner-key');
  res.json({ status: 'success', token: ADMIN_KEY });
});
// Staff login — issues a session token instead of resending a password.
// Costs the SAME as a real wrong-password attempt for a nonexistent/
// inactive username too (DUMMY_PASSWORD_HASH), so a login attempt can't be
// used to enumerate valid usernames by response timing.
app.post('/admin/login', async (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!username || !password) return res.status(400).json({ status: 'error', message: 'Username and password required' });
  if (loginLocked('staff:' + username)) return res.status(429).json({ status: 'error', message: 'Too many attempts. Try again in 15 minutes.' });
  try {
    const snap = await db.collection('adminUsers').doc(username).get();
    const validAccount = snap.exists && snap.data().active !== false;
    const hashToCheck = validAccount ? snap.data().passwordHash : DUMMY_PASSWORD_HASH;
    const passwordOk = scryptVerify(password, hashToCheck);
    if (!validAccount || !passwordOk) {
      recordLoginFail('staff:' + username);
      return res.status(401).json({ status: 'error', message: 'Invalid username or password' });
    }
    clearLoginFails('staff:' + username);
    const role = snap.data().role === 'owner' ? 'owner' : 'staff';
    const token = await createSession(username, role);
    res.json({ status: 'success', token, username, role });
  } catch (e) { res.status(500).json({ status: 'error', message: 'Could not log in right now' }); }
});
app.post('/admin/logout', async (req, res) => {
  const header = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (header) await db.collection('adminSessions').doc(header).delete().catch(() => {});
  res.json({ status: 'success' });
});
app.get('/admin/admins/list', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const snap = await db.collection('adminUsers').get();
    res.json({ status: 'success', admins: snap.docs.map(d => ({ username: d.id, role: d.data().role || 'staff', active: d.data().active !== false, createdAt: d.data().createdAt || null })) });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/admins/create', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const username = String(req.body.username || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) return res.status(400).json({ status: 'error', message: 'Username must be 3-32 characters (letters, digits, . _ -).' });
  if (password.length < 8) return res.status(400).json({ status: 'error', message: 'Password must be at least 8 characters.' });
  try {
    const existing = await db.collection('adminUsers').doc(username).get();
    if (existing.exists) return res.status(400).json({ status: 'error', message: 'That username already exists.' });
    await db.collection('adminUsers').doc(username).set({
      role: 'staff', active: true, passwordHash: scryptHash(password), createdAt: FieldValue.serverTimestamp()
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
  if (password.length < 8) return res.status(400).json({ status: 'error', message: 'Password must be at least 8 characters.' });
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
app.get('/admin/audit-log', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const snap = await db.collection('adminAuditLog').orderBy('createdAt', 'desc').limit(300).get();
    res.json({ status: 'success', log: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/push/register', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const token = String(req.body.token || '').trim();
  if (!token) return res.status(400).json({ status: 'error', message: 'Missing token' });
  try {
    await db.collection('adminPushTokens').doc(token).set({ token, registeredAt: FieldValue.serverTimestamp() }, { merge: true });
    res.json({ status: 'success' });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/push/unregister', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const token = String(req.body.token || '').trim();
  if (!token) return res.status(400).json({ status: 'error', message: 'Missing token' });
  try {
    await db.collection('adminPushTokens').doc(token).delete();
    res.json({ status: 'success' });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
app.get('/admin/settings', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try { res.json({ status: 'success', settings: await getSettings() }); }
  catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
const SETTINGS_CRITICAL_RANGES = {
  withdrawFeePct: [0, 100], minWithdraw: [0, MAX_MONEY_AMOUNT], minDeposit: [0, MAX_MONEY_AMOUNT],
  welcomeBonus: [0, MAX_MONEY_AMOUNT], commL1: [0, 100], commL2: [0, 100], commL3: [0, 100],
  returnMultiple: [0, 1000], cycleDays: [1, 3650], maxWithdrawalsPerDay: [0, 1000],
  dailyCheckin: [0, MAX_MONEY_AMOUNT],
  autoApproveIntervalSec: [1, 3600], autoApproveMaxAmount: [0, MAX_MONEY_AMOUNT],
};
const SETTINGS_BOOLEAN_FIELDS = ['maintenanceMode', 'requireInvestToWithdraw', 'autoApproveWithdrawalsEnabled'];
app.post('/admin/settings/update', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const updates = req.body.settings || {};
    for (const [key, [min, max]] of Object.entries(SETTINGS_CRITICAL_RANGES)) {
      if (!(key in updates)) continue;
      const n = Number(updates[key]);
      if (!Number.isFinite(n) || n < min || n > max)
        return res.status(400).json({ status: 'error', message: `${key} must be a number between ${min} and ${max}` });
      updates[key] = Math.round(n);
    }
    for (const key of SETTINGS_BOOLEAN_FIELDS) {
      if (key in updates) updates[key] = updates[key] === true || updates[key] === 'true';
    }
    await db.collection('settings').doc('main').set(updates, { merge: true });
    _settingsCacheTs = 0;
    logAdminAction(req, 'settings_updated', { fields: Object.keys(updates) });
    res.json({ status: 'success' });
  } catch (e) { res.status(500).json({ status: 'error', message: 'Could not save settings' }); }
});
app.get('/admin/banner', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try { res.json({ status: 'success', image: await getHomeBanner() }); }
  catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/banner/set', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const image = String(req.body.image || '');
  if (!/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(image) || image.length > 2_800_000)
    return res.status(400).json({ status: 'error', message: 'Invalid image' });
  try {
    await db.collection('banners').doc('home').set({ image });
    _bannerCacheTs = 0;
    logAdminAction(req, 'banner_set', {});
    res.json({ status: 'success' });
  } catch (e) { res.status(500).json({ status: 'error', message: 'Could not save the banner' }); }
});
app.post('/admin/banner/clear', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    await db.collection('banners').doc('home').delete();
    _bannerCacheTs = 0;
    res.json({ status: 'success' });
  } catch (e) { res.status(500).json({ status: 'error', message: 'Could not clear the banner' }); }
});
function sanitizeProductInput(p, fallbackOrder) {
  const key = String(p?.key || '').trim();
  if (!key || key.length > 64 || !/^[a-zA-Z0-9_-]+$/.test(key)) return null;
  const name = String(p?.name || '').trim().slice(0, 100);
  if (!name) return null;
  const price = Math.round(Number(p?.price));
  if (!Number.isFinite(price) || price < 1 || price > MAX_MONEY_AMOUNT) return null;
  let cycle = null;
  if (p?.cycle != null && p.cycle !== '') {
    cycle = Number(p.cycle);
    if (!Number.isFinite(cycle) || cycle <= 0 || cycle > 3650 || !Number.isInteger(cycle)) return null;
  }
  let expectedReturn = null;
  if (p?.expectedReturn != null && p.expectedReturn !== '') {
    expectedReturn = Math.round(Number(p.expectedReturn));
    if (!Number.isFinite(expectedReturn) || expectedReturn < 1 || expectedReturn > MAX_MONEY_AMOUNT) return null;
  }
  const image = typeof p?.image === 'string' ? p.image.slice(0, 2_800_000) : '';
  const order = p?.order != null ? Number(p.order) : fallbackOrder;
  return { key, name, price, cycle, expectedReturn, image, active: p?.active !== false, comingSoon: p?.comingSoon === true, order: Number.isFinite(order) ? order : fallbackOrder, deleted: false };
}
app.get('/admin/products', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try { res.json({ status: 'success', products: await getProducts() }); }
  catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/products/save', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const list = Array.isArray(req.body.products) ? req.body.products : [];
    const sanitized = [];
    for (let i = 0; i < list.length; i++) {
      const clean = sanitizeProductInput(list[i], i);
      if (!clean) return res.status(400).json({ status: 'error', message: `Product #${i + 1} (${list[i]?.name || list[i]?.key || 'unnamed'}) has an invalid key, name, price, or (if given) cycle/return — nothing was saved.` });
      sanitized.push(clean);
    }
    const batch = db.batch();
    sanitized.forEach(p => batch.set(db.collection('products').doc(p.key), p, { merge: true }));
    await batch.commit();
    _productsCacheTs = 0;
    logAdminAction(req, 'products_saved', { count: sanitized.length });
    res.json({ status: 'success' });
  } catch (e) { res.status(500).json({ status: 'error', message: 'Could not save products' }); }
});
app.post('/admin/products/delete', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const key = String(req.body.key || '');
  if (!key) return res.status(400).json({ status: 'error', message: 'key required' });
  try {
    await db.collection('products').doc(key).set({ key, deleted: true }, { merge: false });
    _productsCacheTs = 0;
    logAdminAction(req, 'product_deleted', { key });
    res.json({ status: 'success' });
  } catch (e) { res.status(500).json({ status: 'error', message: 'Could not delete this product' }); }
});
app.post('/admin/products/clear', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const snap = await db.collection('products').limit(1000).get();
    const batch = db.batch();
    let removed = 0;
    snap.forEach(d => { batch.set(d.ref, { key: d.id, deleted: true }, { merge: false }); removed++; });
    await batch.commit();
    _productsCacheTs = 0;
    logAdminAction(req, 'products_cleared', { removed });
    res.json({ status: 'success', removed });
  } catch (e) { res.status(500).json({ status: 'error', message: 'Could not clear products' }); }
});
// Updates price/cycle/expectedReturn on every saved product doc back to the
// current DEFAULT_PRODUCTS values, leaving image/active/comingSoon/order
// untouched -- a saved product that was never individually edited is
// already correct and is skipped.
app.post('/admin/products/sync-pricing', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const defaultsByKey = new Map(DEFAULT_PRODUCTS.map(p => [p.key, p]));
    const snap = await db.collection('products').limit(1000).get();
    const batch = db.batch();
    let synced = 0;
    snap.forEach(d => {
      const p = d.data();
      if (p.deleted) return;
      const def = defaultsByKey.get(d.id);
      if (!def) return;
      batch.update(d.ref, { price: def.price, cycle: def.cycle, expectedReturn: def.expectedReturn });
      synced++;
    });
    await batch.commit();
    _productsCacheTs = 0;
    logAdminAction(req, 'products_synced', { synced });
    res.json({ status: 'success', synced });
  } catch (e) { res.status(500).json({ status: 'error', message: 'Could not sync pricing' }); }
});

// ═══════════════════════════════════════════
// ADMIN — GIFT CODES
// ═══════════════════════════════════════════
app.post('/admin/promocodes/generate', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const reward = Math.round(Number(req.body.reward));
  const maxUses = req.body.maxUses ? Math.round(Number(req.body.maxUses)) : null;
  const durationMinutes = req.body.durationMinutes ? Number(req.body.durationMinutes) : null;
  if (!Number.isFinite(reward) || reward <= 0 || reward > MAX_MONEY_AMOUNT) return res.status(400).json({ status: 'error', message: 'Enter a valid reward amount' });
  if (maxUses !== null && (!Number.isFinite(maxUses) || maxUses <= 0)) return res.status(400).json({ status: 'error', message: 'Max uses must be a positive number' });
  if (durationMinutes !== null && (!Number.isFinite(durationMinutes) || durationMinutes <= 0)) return res.status(400).json({ status: 'error', message: 'Duration must be a positive number of minutes' });
  try {
    const code = await generateUniqueGiftCode();
    const doc = {
      code, codeLower: code.toLowerCase(), reward, maxUses: maxUses || null, usedBy: [], active: true,
      createdBy: req.adminUser?.username || 'owner', createdAt: FieldValue.serverTimestamp(),
    };
    if (durationMinutes) doc.expiresAt = new Date(Date.now() + durationMinutes * 60 * 1000);
    await db.collection('promoCodes').add(doc);
    logAdminAction(req, 'giftcode_generated', { code, reward, maxUses, durationMinutes });
    res.json({ status: 'success', code, reward });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
app.get('/admin/promocodes/list', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const snap = await db.collection('promoCodes').orderBy('createdAt', 'desc').limit(300).get();
    res.json({ status: 'success', codes: snap.docs.map(d => {
      const c = d.data();
      return { id: d.id, code: c.code, reward: c.reward, maxUses: c.maxUses || null, uses: (c.usedBy || []).length,
        active: c.active !== false, expiresAt: c.expiresAt || null, createdAt: c.createdAt || null };
    }) });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/promocodes/deactivate', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const id = String(req.body.id || '');
  if (!id) return res.status(400).json({ status: 'error', message: 'id required' });
  try {
    await db.collection('promoCodes').doc(id).update({ active: false });
    logAdminAction(req, 'giftcode_deactivated', { id });
    res.json({ status: 'success' });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});

app.get('/admin/users', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const snap = await db.collection('users').limit(10000).get();
    const users = snap.docs.map(d => { const { transactionPinHash, ...safe } = d.data(); return { id: d.id, ...safe }; });
    res.json({ status: 'success', users, count: users.length });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/user/detail', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const userId = String(req.body.userId || '');
  if (!userId) return res.status(400).json({ status: 'error', message: 'userId required' });
  try {
    const [uSnap, invSnap, txSnap, witSnap] = await Promise.all([
      db.collection('users').doc(userId).get(),
      db.collection('investments').where('userId', '==', userId).limit(200).get(),
      db.collection('transactions').where('userId', '==', userId).orderBy('createdAt', 'desc').limit(200).get(),
      db.collection('withdrawals').where('userId', '==', userId).orderBy('createdAt', 'desc').limit(100).get(),
    ]);
    if (!uSnap.exists) return res.status(404).json({ status: 'error', message: 'User not found' });
    // transactionPinHash never leaves this server, even to an admin --
    // hasPayoutPin is the boolean the admin UI actually needs.
    const { transactionPinHash, ...userSafe } = uSnap.data();
    res.json({
      status: 'success', user: { id: uSnap.id, ...userSafe, hasPayoutPin: !!transactionPinHash },
      investments: invSnap.docs.map(d => ({ id: d.id, ...d.data() })),
      transactions: txSnap.docs.map(d => ({ id: d.id, ...d.data() })),
      withdrawals: witSnap.docs.map(d => ({ id: d.id, ...d.data() })),
    });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/user/reset-payout-pin', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const userId = String(req.body.userId || '');
  if (!userId) return res.status(400).json({ status: 'error', message: 'userId required' });
  try {
    const ref = db.collection('users').doc(userId);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ status: 'error', message: 'User not found' });
    await ref.update({ transactionPinHash: null, pinFailCount: 0, pinLockedUntil: null });
    logAdminAction(req, 'user_pin_reset', { userId });
    res.json({ status: 'success' });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/user/reset-password', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const userId = String(req.body.userId || '');
  const newPassword = String(req.body.newPassword || '');
  if (!userId || newPassword.length < 6) return res.status(400).json({ status: 'error', message: 'userId and a password of at least 6 characters required' });
  try {
    await admin.auth().updateUser(userId, { password: newPassword });
    logAdminAction(req, 'user_password_reset', { userId });
    res.json({ status: 'success', message: 'Password reset' });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/user/set-phone', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const userId = String(req.body.userId || '');
  const phone = cleanPhone(req.body.phone || '');
  if (!userId || !phone) return res.status(400).json({ status: 'error', message: 'userId and a valid phone required' });
  try {
    await db.collection('users').doc(userId).update({ phone });
    logAdminAction(req, 'user_phone_set', { userId, phone });
    res.json({ status: 'success' });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
// Rebuilds one user's totalDeposited/totalEarned/totalWithdrawn/totalInvested
// straight from their own transaction ledger — a single-user version of the
// platform-wide "Recalculate totals" tool, for spot-fixing one account.
app.post('/admin/user/repair-ledger', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const userId = String(req.body.userId || '');
  if (!userId) return res.status(400).json({ status: 'error', message: 'userId required' });
  try {
    const [uSnap, txSnap, invSnap] = await Promise.all([
      db.collection('users').doc(userId).get(),
      db.collection('transactions').where('userId', '==', userId).limit(50000).get(),
      db.collection('investments').where('userId', '==', userId).get(),
    ]);
    if (!uSnap.exists) return res.status(404).json({ status: 'error', message: 'User not found' });
    let deposited = 0, earned = 0, withdrawn = 0;
    txSnap.forEach(d => {
      const t = d.data();
      if (t.type === 'deposit') deposited += finiteMoney(t.amount);
      else if (['cashback', 'commission', 'team_reward', 'promocode', 'checkin', 'mission_salary', 'mission_deposit_reward'].includes(t.type)) earned += finiteMoney(t.amount);
      else if (t.type === 'withdraw' && t.status === 'success') withdrawn += Math.abs(finiteMoney(t.amount));
    });
    let invested = 0;
    invSnap.forEach(d => { invested += finiteMoney(d.data().amount); });
    await db.collection('users').doc(userId).update({ totalDeposited: deposited, totalEarned: earned, totalWithdrawn: withdrawn, totalInvested: invested });
    logAdminAction(req, 'user_ledger_repaired', { userId, deposited, earned, withdrawn, invested });
    res.json({ status: 'success', totals: { totalDeposited: deposited, totalEarned: earned, totalWithdrawn: withdrawn, totalInvested: invested } });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
// Owner-only reconciliation for a registration that started (Firebase account
// exists) but never finished (no Snow profile doc, or one stuck with
// registrationDone:false). Reuses completeRegistrationCore so this can never
// drift from the member's own /register path.
app.post('/admin/user/complete-registration', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const userId = String(req.body.userId || '');
  const pin = String(req.body.pin || '');
  if (!userId) return res.status(400).json({ status: 'error', message: 'userId required' });
  try {
    const ref = db.collection('users').doc(userId);
    const existing = await ref.get();
    if (!existing.exists) {
      let phone = '';
      try { const rec = await admin.auth().getUser(userId); phone = cleanPhone((rec.email || '').split('@')[0]) || ''; } catch (_) {}
      await ref.set(defaultProfileDoc(phone));
    }
    const result = await completeRegistrationCore(userId, req.body.referralCode, pin);
    if (result.code === 200) logAdminAction(req, 'user_registration_completed', { userId });
    res.status(result.code).json(result.body);
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
// Attaches a referrer to an account that registered without one (or with the
// wrong one) — deliberately requires an existing doc (unlike the member's own
// /register self-heal) since a typo'd/bogus userId must never phantom-create
// an account with no real Firebase user behind it.
app.post('/admin/user/attach-referrer', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const userId = String(req.body.userId || '');
  const code = String(req.body.referralCode || '').trim();
  if (!userId || !code) return res.status(400).json({ status: 'error', message: 'userId and referralCode required' });
  try {
    await withLock('attach-referrer', async () => {
      const uRef = db.collection('users').doc(userId);
      const uSnap = await uRef.get();
      if (!uSnap.exists) throw Object.assign(new Error('User not found'), { code: 404 });
      const refSnap = await db.collection('users').where('referralCode', '==', code).limit(1).get();
      if (refSnap.empty) throw Object.assign(new Error('That referral code does not exist.'), { code: 400 });
      const referrerId = refSnap.docs[0].id;
      if (referrerId === userId) throw Object.assign(new Error('Cannot refer yourself.'), { code: 400 });
      if (refSnap.docs[0].data().status === 'banned') throw Object.assign(new Error('That referral code is no longer active.'), { code: 400 });
      // Cycle guard — walk up from the referrer; if we ever hit userId, this
      // would create a loop.
      let cursor = referrerId, hops = 0;
      while (cursor && hops < 1000) {
        if (cursor === userId) throw Object.assign(new Error('That would create a referral loop.'), { code: 400 });
        const cSnap = await db.collection('users').doc(cursor).get();
        cursor = cSnap.exists ? cSnap.data().referredBy : null;
        hops++;
      }
      await uRef.update({ referredBy: referrerId });
      await db.collection('users').doc(referrerId).update({ teamL1Count: FieldValue.increment(1) });
    });
    logAdminAction(req, 'referrer_attached', { userId, referralCode: code });
    res.json({ status: 'success' });
  } catch (e) { res.status(e.code || 500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/user/reconcile-checkin', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const userId = String(req.body.userId || '');
  if (!userId) return res.status(400).json({ status: 'error', message: 'userId required' });
  try {
    const ledgerSnap = await db.collection('transactions')
      .where('userId', '==', userId).where('type', '==', 'checkin').orderBy('createdAt', 'desc').limit(500).get();
    const dayKeys = new Set();
    ledgerSnap.forEach(d => dayKeys.add(eatDayKey(d.data().createdAt)));
    const real = computeCheckinStreak(dayKeys);
    await db.collection('users').doc(userId).update({ checkinStreak: real.streak, lastCheckin: real.lastCheckin });
    logAdminAction(req, 'checkin_reconciled', { userId, streak: real.streak });
    res.json({ status: 'success', streak: real.streak, lastCheckin: real.lastCheckin });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
// Recomputes teamL1/L2/L3 counts for the WHOLE referral tree hanging off one
// account — used after a delete reparents a downline, since a multi-level
// chain's counts can't be fixed with simple increments/decrements.
async function recomputeTeamCounts(rootId) {
  const walk = async (ids, level) => {
    if (!ids.length || level > 3) return;
    const snap = await db.collection('users').where('referredBy', 'in', ids).get();
    const byParent = new Map();
    snap.forEach(d => {
      const p = d.data().referredBy;
      byParent.set(p, (byParent.get(p) || 0) + 1);
    });
    for (const [parentId, count] of byParent) {
      const field = level === 1 ? 'teamL1Count' : level === 2 ? 'teamL2Count' : 'teamL3Count';
      await db.collection('users').doc(parentId).update({ [field]: count }).catch(() => {});
    }
    const nextIds = [];
    snap.forEach(d => nextIds.push(d.id));
    await walk(nextIds, level + 1);
  };
  await walk([rootId], 1);
}
app.post('/admin/user/delete', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const userId = String(req.body.userId || '');
  if (!userId) return res.status(400).json({ status: 'error', message: 'userId required' });
  if (_userBeingDeleted.has(userId)) return res.status(409).json({ status: 'error', message: 'Already deleting this account.' });
  _userBeingDeleted.add(userId);
  try {
    const uSnap = await db.collection('users').doc(userId).get();
    if (!uSnap.exists) return res.status(404).json({ status: 'error', message: 'User not found' });
    // Reparent this account's own direct referrals up to ITS referrer, so a
    // deleted account never leaves a permanently orphaned downline.
    const parentId = uSnap.data().referredBy || null;
    await withLock('referrer-guard:' + userId, async () => {
      const childSnap = await db.collection('users').where('referredBy', '==', userId).get();
      await Promise.all(childSnap.docs.map(d => d.ref.update({ referredBy: parentId })));
    });
    await db.collection('users').doc(userId).delete();
    try { await admin.auth().deleteUser(userId); } catch (_) {}
    if (parentId) await recomputeTeamCounts(parentId).catch(e => console.warn('recomputeTeamCounts warning:', e.message));
    logAdminAction(req, 'user_deleted', { userId, reparentedTo: parentId });
    res.json({ status: 'success' });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
  finally { _userBeingDeleted.delete(userId); }
});
const _adminCreditDebounce = new Map();
const _adminDebitDebounce = new Map();
app.post('/admin/deposit', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const { userId, amount, note } = req.body;
  const amt = Math.round(parseFloat(amount || 0));
  if (!userId || !Number.isFinite(amt) || amt <= 0 || amt > MAX_MONEY_AMOUNT)
    return res.status(400).json({ status: 'error', message: `userId and a valid amount (1 - ${fmtUGX(MAX_MONEY_AMOUNT)}) required` });
  const lastCredit = _adminCreditDebounce.get(userId) || 0;
  if (Date.now() - lastCredit < 10000) return res.status(429).json({ status: 'error', message: 'This user was just credited seconds ago. Wait a moment before crediting again.' });
  _adminCreditDebounce.set(userId, Date.now());
  try {
    const { date, time } = nowStr();
    await db.runTransaction(async t => {
      const uRef = db.collection('users').doc(userId);
      const uSnap = await t.get(uRef);
      if (!uSnap.exists) throw new Error('User not found');
      t.update(uRef, { walletBalance: FieldValue.increment(amt), totalDeposited: FieldValue.increment(amt) });
      t.set(db.collection('transactions').doc(), { userId, type: 'admin_credit', description: note || 'Snow credit', amount: amt, status: 'success', date, time, createdAt: FieldValue.serverTimestamp() });
    });
    logAdminAction(req, 'manual_credit', { userId, amount: amt, note });
    res.json({ status: 'success', message: `Credited ${fmtUGX(amt)}` });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/debit', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const { userId, amount, note } = req.body;
  const amt = Math.round(Math.abs(parseFloat(amount || 0)));
  if (!userId || !Number.isFinite(amt) || amt <= 0 || amt > MAX_MONEY_AMOUNT)
    return res.status(400).json({ status: 'error', message: `userId and a valid amount (1 - ${fmtUGX(MAX_MONEY_AMOUNT)}) required` });
  const lastDebit = _adminDebitDebounce.get(userId) || 0;
  if (Date.now() - lastDebit < 10000) return res.status(429).json({ status: 'error', message: 'This user was just debited seconds ago. Wait a moment before debiting again.' });
  _adminDebitDebounce.set(userId, Date.now());
  try {
    let newBal = 0;
    const { date, time } = nowStr();
    await withLock('bal:' + userId, () => db.runTransaction(async t => {
      const uRef = db.collection('users').doc(userId);
      const uSnap = await t.get(uRef);
      if (!uSnap.exists) throw new Error('User not found');
      const bal = uSnap.data().walletBalance || 0;
      if (amt > bal) throw new Error(`Cannot debit ${fmtUGX(amt)} — this wallet only holds ${fmtUGX(bal)}`);
      newBal = bal - amt;
      t.update(uRef, { walletBalance: FieldValue.increment(-amt) });
      t.set(db.collection('transactions').doc(), { userId, type: 'admin_debit', description: note || 'Balance adjustment', amount: -amt, status: 'success', date, time, createdAt: FieldValue.serverTimestamp() });
    }));
    logAdminAction(req, 'manual_debit', { userId, amount: amt, note });
    res.json({ status: 'success', message: `Removed ${fmtUGX(amt)}. New balance ${fmtUGX(newBal)}`, newBalance: newBal });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/ban', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const { userId, action, reason } = req.body;
  try {
    const isBan = action === 'ban';
    await db.collection('users').doc(userId).update({
      status: isBan ? 'banned' : 'active', banReason: isBan ? (reason || 'Policy violation') : null, bannedAt: isBan ? FieldValue.serverTimestamp() : null
    });
    logAdminAction(req, isBan ? 'user_banned' : 'user_unbanned', { userId, reason });
    res.json({ status: 'success' });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/deposits/list', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const [snap, unresolvedSnap, usersSnap] = await Promise.all([
      db.collection('pendingDeposits').orderBy('createdAt', 'desc').limit(5000).get(),
      db.collection('pendingDeposits').where('status', 'in', ['pending', 'initiating']).limit(5000).get(),
      db.collection('users').get(),
    ]);
    const phones = {}; const refCodes = {};
    usersSnap.forEach(u => { phones[u.id] = u.data().phone || ''; refCodes[u.id] = u.data().referralCode || ''; });
    const counts = {};
    const byId = new Map();
    snap.docs.forEach(d => byId.set(d.id, { id: d.id, ...d.data() }));
    unresolvedSnap.docs.forEach(d => { if (!byId.has(d.id)) byId.set(d.id, { id: d.id, ...d.data() }); });
    const rows = Array.from(byId.values());
    rows.forEach(r => { r.accountPhone = phones[r.userId] || ''; r.referralCode = refCodes[r.userId] || ''; counts[r.status || 'unknown'] = (counts[r.status || 'unknown'] || 0) + 1; });
    res.json({ status: 'success', deposits: rows, counts, total: rows.length });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/deposit/force-credit', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
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
    const [snap, unresolvedSnap, usersSnap] = await Promise.all([
      db.collection('withdrawals').orderBy('createdAt', 'desc').limit(5000).get(),
      db.collection('withdrawals').where('status', 'in', ['pending', 'sending', 'processing']).limit(5000).get(),
      db.collection('users').get(),
    ]);
    const phones = {}; const refCodes = {};
    usersSnap.forEach(u => { phones[u.id] = u.data().phone || ''; refCodes[u.id] = u.data().referralCode || ''; });
    const counts = {};
    const byId = new Map();
    snap.docs.forEach(d => byId.set(d.id, { id: d.id, ...d.data() }));
    unresolvedSnap.docs.forEach(d => { if (!byId.has(d.id)) byId.set(d.id, { id: d.id, ...d.data() }); });
    const rows = Array.from(byId.values());
    rows.forEach(w => { w.accountPhone = phones[w.userId] || ''; w.referralCode = refCodes[w.userId] || ''; counts[w.status] = (counts[w.status] || 0) + 1; });
    res.json({ status: 'success', withdrawals: rows, counts, total: rows.length });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/withdraw/reject', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const witId = String(req.body.withdrawalId || '');
  if (_withdrawInFlight.has(witId)) return res.status(409).json({ status: 'error', message: 'This withdrawal is being sent right now. Check the list in a moment.' });
  _withdrawInFlight.add(witId);
  try {
    const ref = db.collection('withdrawals').doc(witId);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ status: 'error', message: 'Withdrawal not found' });
    const w = snap.data();
    if (w.status !== 'pending' && w.status !== 'processing') return res.status(400).json({ status: 'error', message: `Cannot reject, the status is '${w.status}'` });
    let refunded = false;
    await withLock('bal:' + w.userId, () => db.runTransaction(async t => {
      const fresh = await t.get(ref);
      if (!fresh.exists || (fresh.data().status !== 'pending' && fresh.data().status !== 'processing')) return;
      const wasProcessing = fresh.data().status === 'processing';
      const uRef = db.collection('users').doc(w.userId);
      t.update(ref, { status: 'declined', failureReason: 'Rejected by admin' });
      t.update(uRef, { walletBalance: FieldValue.increment(fresh.data().amount) });
      if (wasProcessing) t.update(uRef, { totalWithdrawn: FieldValue.increment(-fresh.data().net) });
      refunded = true;
    }));
    if (refunded) await finalizeWithdrawalTransactionRecord(witId, 'declined');
    logAdminAction(req, 'withdrawal_rejected', { withdrawalId: witId });
    res.json({ status: 'success', message: 'Withdrawal rejected and refunded' });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
  finally { _withdrawInFlight.delete(witId); }
});
app.get('/admin/stats', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const [usersSnap, depSnap, witSnap, invSnap] = await Promise.all([
      db.collection('users').limit(10000).get(),
      db.collection('pendingDeposits').where('status', '==', 'matched').limit(50000).get(),
      db.collection('withdrawals').where('status', '==', 'processed').limit(50000).get(),
      db.collection('investments').limit(50000).get(),
    ]);
    let totalUsers = 0, activeUsers = 0, bannedUsers = 0, walletTotal = 0;
    usersSnap.forEach(d => {
      const u = d.data();
      totalUsers++;
      if (u.status === 'banned') bannedUsers++; else activeUsers++;
      walletTotal += finiteMoney(u.walletBalance);
    });
    let depositAmount = 0; depSnap.forEach(d => depositAmount += finiteMoney(d.data().amount));
    let withdrawAmount = 0; witSnap.forEach(d => withdrawAmount += finiteMoney(d.data().net));
    let investedAmount = 0, activeInvestments = 0;
    invSnap.forEach(d => { const inv = d.data(); investedAmount += finiteMoney(inv.amount); if (inv.status === 'active') activeInvestments++; });
    const pendingDepCount = (await db.collection('pendingDeposits').where('status', 'in', ['pending', 'initiating']).limit(5000).get()).size;
    const pendingWitCount = (await db.collection('withdrawals').where('status', '==', 'pending').limit(5000).get()).size;
    res.json({ status: 'success', stats: { totalUsers, activeUsers, bannedUsers, walletTotal, depositAmount, withdrawAmount, investedAmount, activeInvestments, pendingDepCount, pendingWitCount } });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/transactions/list', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const snap = await db.collection('transactions').orderBy('createdAt', 'desc').limit(300).get();
    res.json({ status: 'success', transactions: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
app.get('/admin/referrals/list', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const snap = await db.collection('users').where('referredBy', '!=', null).limit(2000).get();
    const rows = snap.docs.map(d => {
      const u = d.data();
      return { id: d.id, phone: u.phone || '', referredBy: u.referredBy, invested: finiteMoney(u.totalInvested), status: u.status || 'active' };
    });
    res.json({ status: 'success', referrals: rows });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
app.get('/admin/badges', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const [pendingDep, pendingWit] = await Promise.all([
      db.collection('pendingDeposits').where('status', 'in', ['pending', 'initiating']).limit(5000).get(),
      db.collection('withdrawals').where('status', '==', 'pending').limit(5000).get(),
    ]);
    res.json({ status: 'success', pendingDeposits: pendingDep.size, pendingWithdrawals: pendingWit.size });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
function bandOf(h) { return h < 6 ? 'night' : h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening'; }
app.post('/admin/analytics', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const [depSnap, witSnap, invSnap] = await Promise.all([
      db.collection('pendingDeposits').where('status', '==', 'matched').limit(50000).get(),
      db.collection('withdrawals').where('status', '==', 'processed').limit(50000).get(),
      db.collection('investments').limit(50000).get(),
    ]);
    let depAmount = 0, witAmount = 0, investedAmount = 0, commissionsPaid = 0;
    const byBand = { night: 0, morning: 0, afternoon: 0, evening: 0 };
    depSnap.forEach(d => {
      const dep = d.data();
      depAmount += finiteMoney(dep.amount);
      const h = new Date(tsMillis(dep.createdAt) + 3 * 3600000).getUTCHours();
      byBand[bandOf(h)] += finiteMoney(dep.amount);
    });
    witSnap.forEach(d => witAmount += finiteMoney(d.data().net));
    invSnap.forEach(d => investedAmount += finiteMoney(d.data().amount));
    const commSnap = await db.collection('transactions').where('type', '==', 'commission').limit(50000).get();
    commSnap.forEach(d => commissionsPaid += finiteMoney(d.data().amount));
    res.json({ status: 'success', kpis: { depAmount, witAmount, investedAmount, commissionsPaid, depositsByTimeOfDay: byBand } });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/analytics/abuse', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const snap = await db.collection('securityEvents').orderBy('createdAt', 'desc').limit(300).get();
    res.json({ status: 'success', events: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
// Cross-checks each user's own stored walletBalance against the sum of
// their own transaction ledger — flags a real mismatch rather than
// silently laundering it back to a clean value (this tool's whole job is
// to SURFACE corruption, not hide it).
app.get('/admin/integrity', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const [usersSnap, txSnap] = await Promise.all([
      db.collection('users').limit(10000).get(),
      db.collection('transactions').limit(200000).get(),
    ]);
    const ledgerByUser = {};
    txSnap.forEach(d => {
      const t = d.data();
      if (!t.userId) return;
      ledgerByUser[t.userId] = (ledgerByUser[t.userId] || 0) + (Number(t.amount) || 0);
    });
    const mismatches = [];
    usersSnap.forEach(d => {
      const u = d.data();
      const bal = Number(u.walletBalance) || 0;
      const ledger = ledgerByUser[d.id] || 0;
      if (Math.abs(bal - ledger) > 1) mismatches.push({ userId: d.id, phone: u.phone || '', walletBalance: bal, ledgerSum: ledger, diff: bal - ledger });
    });
    res.json({ status: 'success', checked: usersSnap.size, mismatches });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
// Rebuilds totalDeposited/totalEarned from the transaction ledger — the
// source of truth — rather than trusting drifted incremental counters.
async function recountAllTotals() {
  return withLock('totals-recount', async () => {
    const txSnap = await db.collection('transactions').limit(200000).get();
    const totals = {};
    txSnap.forEach(d => {
      const t = d.data();
      if (!t.userId) return;
      const row = totals[t.userId] || (totals[t.userId] = { deposited: 0, earned: 0 });
      if (t.type === 'deposit' || t.type === 'admin_credit') row.deposited += finiteMoney(t.amount);
      // Every income source that credits totalEarned live must be summed
      // here too, or a "Recalculate totals" run silently wipes it back to
      // zero — cashback/commission/team_reward (Task Center)/promocode
      // (gift codes)/checkin.
      if (['cashback', 'commission', 'team_reward', 'promocode', 'checkin', 'mission_salary', 'mission_deposit_reward'].includes(t.type)) row.earned += finiteMoney(t.amount);
    });
    let updated = 0;
    const usersSnap = await db.collection('users').limit(10000).get();
    for (const doc of usersSnap.docs) {
      const row = totals[doc.id] || { deposited: 0, earned: 0 };
      const u = doc.data();
      if (finiteMoney(u.totalDeposited) !== row.deposited || finiteMoney(u.totalEarned) !== row.earned) {
        await doc.ref.update({ totalDeposited: row.deposited, totalEarned: row.earned });
        updated++;
      }
    }
    return { ok: true, updated };
  });
}
app.get('/admin/users/recount', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const result = await recountAllTotals();
    logAdminAction(req, 'totals_recounted', result);
    res.json({ status: 'success', ...result });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});

app.get('/', (_req, res) => res.json({ status: 'ok', service: 'Snow backend' }));

app.use((err, _req, res, _next) => {
  if (err && err.type === 'entity.too.large') return res.status(413).json({ status: 'error', message: 'Request is too large' });
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ status: 'error', message: 'Malformed request body' });
  console.error('Unhandled request error:', err && err.message);
  res.status(500).json({ status: 'error', message: 'Something went wrong' });
});

// ── RECONCILERS ──
async function reconcilePendingDeposits() {
  let settled = 0;
  try {
    const snap = await db.collection('pendingDeposits').where('status', '==', 'pending').orderBy('createdAt', 'asc').limit(50).get();
    for (const doc of snap.docs) {
      const dep = doc.data();
      if (!dep.marzTxUuid) continue;
      const marzStatus = await marzGetCollectStatus(dep.marzTxUuid);
      if (SUCCESS_STATUSES.has(marzStatus)) { await creditDeposit(doc); settled++; }
      else if (FAILED_STATUSES.has(marzStatus)) await markDepositFailed(doc.ref, dep.userId, DEPOSIT_FAILED_MSG);
    }
  } catch (e) { console.error('Reconcile deposits error:', e.message); }
  return settled;
}
async function reconcilePendingWithdrawals() {
  let settled = 0;
  try {
    const snap = await db.collection('withdrawals').where('status', '==', 'processing').orderBy('createdAt', 'asc').limit(50).get();
    for (const doc of snap.docs) {
      const wit = doc.data();
      if (!wit.marzTxUuid) continue;
      const marzStatus = await marzGetSendStatus(wit.marzTxUuid);
      if (SUCCESS_STATUSES.has(marzStatus)) {
        if (await markWithdrawalProcessed(doc.ref, wit.userId)) await finalizeWithdrawalTransactionRecord(doc.id, 'processed');
        settled++;
      } else if (FAILED_STATUSES.has(marzStatus)) {
        await withLock('bal:' + wit.userId, () => db.runTransaction(async t => {
          const fresh = await t.get(doc.ref);
          if (!fresh.exists || fresh.data().status !== 'processing') return;
          const uRef = db.collection('users').doc(wit.userId);
          t.update(doc.ref, { status: 'declined', failureReason: 'Payout failed at the mobile-money provider' });
          t.update(uRef, { walletBalance: FieldValue.increment(fresh.data().amount), totalWithdrawn: FieldValue.increment(-fresh.data().net) });
        }));
        await finalizeWithdrawalTransactionRecord(doc.id, 'declined');
        settled++;
      }
    }
  } catch (e) { console.error('Reconcile withdrawals error:', e.message); }
  return settled;
}
async function reconcileCommissions() {
  try {
    const snap = await db.collection('investments').where('commissionPending', '==', true).orderBy('createdAt', 'asc').limit(500).get();
    for (const doc of snap.docs) {
      const inv = doc.data();
      await creditReferralCommission(doc.id, inv.userId, inv.amount).catch(e => console.error('Reconcile commission error:', e.message));
    }
  } catch (e) { console.error('Reconcile commissions error:', e.message); }
}
let _sweepingCashback = false;
async function reconcileCashback() {
  if (_sweepingCashback) return;
  _sweepingCashback = true;
  try {
    const snap = await db.collection('investments').where('status', '==', 'active').orderBy('createdAt', 'asc').limit(5000).get();
    for (const doc of snap.docs) { await settleInvestmentIfDue(doc).catch(e => console.error('Reconcile cashback error:', e.message)); }
  } catch (e) { console.error('Reconcile cashback error:', e.message); }
  finally { _sweepingCashback = false; }
}
function runReconciler() {
  reconcilePendingDeposits().then(reconcilePendingWithdrawals).then(reconcileCommissions).catch(() => {});
}
// Owner-toggleable: approves every still-pending withdrawal automatically,
// a few seconds after it was requested — shares processWithdrawalCore with
// the manual "Send" button, so it's exactly as safe/idempotent.
async function autoApproveWithdrawalsTick() {
  try {
    const sett = await getSettings();
    if (!sett.autoApproveWithdrawalsEnabled) return;
    const cutoff = new Date(Date.now() - (Number(sett.autoApproveIntervalSec) || 10) * 1000);
    const snap = await db.collection('withdrawals').where('status', '==', 'pending').orderBy('createdAt', 'asc').limit(50).get();
    for (const doc of snap.docs) {
      const wit = doc.data();
      if (tsMillis(wit.createdAt) > cutoff.getTime()) continue; // not old enough yet
      const cap = Number(sett.autoApproveMaxAmount) || 0;
      if (cap > 0 && wit.amount > cap) continue; // above the safety cap — leave for manual review
      await processWithdrawalCore(doc.id, 'auto-approve').catch(e => console.error('Auto-approve error:', e.message));
    }
  } catch (e) { console.error('Auto-approve tick error:', e.message); }
}
app.get('/admin/payments/sync', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const [depSettled, witSettled] = await Promise.all([reconcilePendingDeposits(), reconcilePendingWithdrawals()]);
    res.json({ status: 'success', depositsSettled: depSettled, withdrawalsSettled: witSettled });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});

// ── IN-MEMORY STATE SWEEPER ──
function sweepEphemeralState() {
  const now = Date.now();
  const dropStale = (map, maxAgeMs) => { for (const [k, ts] of map) if (now - ts > maxAgeMs) map.delete(k); };
  try {
    dropStale(_depCreateDebounce, 5 * 60 * 1000);
    dropStale(_adminCreditDebounce, 5 * 60 * 1000);
    dropStale(_adminDebitDebounce, 5 * 60 * 1000);
    for (const [uid, times] of _depAttempts) {
      const live = times.filter(t => now - t < 60000);
      if (live.length) _depAttempts.set(uid, live);
      else { _depAttempts.delete(uid); _depAttemptsSucceeded.delete(uid); }
    }
    for (const [k, f] of _loginFails) {
      const locked = f.lockedUntil && f.lockedUntil > now;
      if (!locked && now - (f.ts || 0) > 15 * 60 * 1000) _loginFails.delete(k);
    }
  } catch (e) { console.error('State sweep error:', e.message); }
}

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || '';
if (!MONGODB_URI) { console.error('MONGODB_URI env var is required'); process.exit(1); }
connectMongo(MONGODB_URI)
  .then(() => {
    app.listen(PORT, () => console.log(`Snow backend listening on :${PORT}`));
    setInterval(runReconciler, 30 * 1000);
    setTimeout(runReconciler, 15 * 1000);
    setInterval(reconcileCashback, 1000);
    setTimeout(reconcileCashback, 1000);
    setInterval(autoApproveWithdrawalsTick, 10 * 1000);
    setInterval(sweepEphemeralState, 5 * 60 * 1000);
  })
  .catch(e => { console.error('Mongo connection failed:', e.message); process.exit(1); });
