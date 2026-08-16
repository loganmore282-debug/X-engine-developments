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
// SECURITY: rlKeyByUser trusts the uid CLAIMED in the token's payload
// without verifying its signature (real verification happens later, inside
// each handler, via verifyAuth/verifyAdmin) -- so on its own, a request
// carrying a well-formed-but-fake Bearer token with a different fake uid
// claimed each time gets a brand-new rate-limit bucket every single
// request, on BOTH the limiter above and every per-route one below,
// completely defeating them. No real data is ever at risk this way (the
// forged token still fails real verification inside the handler), but the
// limiters intended to bound abuse would not actually bound anything.
// This second limiter is keyed purely by IP -- nothing claimed in a
// request body or token header can change it -- so it can't be evaded the
// same way. Deliberately looser than the per-user ceiling above (double
// it) so it never re-introduces the exact problem per-user keying was
// built to solve (real Ugandan carrier-NAT traffic sharing one IP); it
// only ever becomes the binding constraint for someone actively rotating
// fake identities to dodge the smarter limiter.
const ipOnlyLimiter = rateLimit({ windowMs: 60 * 1000, max: 900, standardHeaders: false, legacyHeaders: false,
  message: { status: 'error', message: 'Too many requests from this network. Slow down.' } });
app.use((req, res, next) => (req.path === '/health' ? next() : ipOnlyLimiter(req, res, next)));
app.use((req, res, next) => (req.path === '/health' ? next() : globalLimiter(req, res, next)));

const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, keyGenerator: rlKeyByUser,
  standardHeaders: true, legacyHeaders: false,
  message: { status: 'error', message: 'Too many requests. Slow down.' } });
// Assistant replies are computed in-process (no external API), but every
// call still does a fresh account/settings/products read -- keep it tighter
// than the general apiLimiter so a spam loop can't hammer the DB.
const assistLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, keyGenerator: rlKeyByUser,
  standardHeaders: true, legacyHeaders: false,
  message: { status: 'error', message: 'Too many messages — slow down a moment.' } });
app.use('/assistant/chat', assistLimiter);
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
['/checkin', '/withdraw/request', '/invest/create', '/deposit/marzpay', '/redeem', '/bank/save',
 '/bank/delete', '/account/create-profile', '/register', '/team/milestone/claim', '/account/payout-pin/change', '/account/payout-pin/set']
  .forEach(p => app.use(p, apiLimiter));

// ── BODY PARSING ──
// Every route gets a tight 64kb JSON cap by default — plenty for any normal
// request, and it keeps a stray huge payload from tying up the process.
// Banner uploads are the one legitimate exception (a base64 image can run
// into the megabytes), so that single route gets its own larger parser
// instead of loosening the limit for everything else.
const smallJsonParser  = express.json({ limit: '64kb' });
const bannerJsonParser = express.json({ limit: '4mb' });
app.use((req, res, next) => (req.path === '/admin/banners/set' ? bannerJsonParser : smallJsonParser)(req, res, next));
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
const MAINTENANCE_BLOCK = ['/account', '/invest', '/deposit', '/withdraw', '/checkin', '/redeem', '/register', '/bank', '/team'];
const GUARD_EXEMPT = new Set(['/', '/health', '/deposit/callback', '/withdraw/callback']);
app.use(async (req, res, next) => {
  if (GUARD_EXEMPT.has(req.path)) return next();
  if (!MAINTENANCE_BLOCK.some(p => req.path.startsWith(p))) return next();
  try {
    const s = await getSettings();
    if (s && s.maintenanceMode) {
      return res.status(503).json({ status: 'error', code: 'MAINTENANCE',
        message: s.maintenanceMsg || 'Space8 is under maintenance. Please check back shortly.' });
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
const MARZ_TIMEOUT = 20000; // matches Chronova's proven value — a short timeout here just means more retries on a slow-but-real MarzPay response

// ── ASSISTANT (self-hosted, no external API/cost — see assistant-engine.js) ──
const { answerAssistant } = require('./assistant-engine');

// Product/economics defaults — mirrors DEFAULT_SETTINGS in the client
// (space8/user/index.html). Admin panel overrides live in the
// `settings`/`products` collections; these are only the boot fallback.
const DEFAULT_SETTINGS = {
  withdrawFeePct: 15, minWithdraw: 5000, minDeposit: 20000,
  dailyCheckin: 250, welcomeBonus: 5000, commL1: 28, commL2: 2, commL3: 1,
  returnMultiple: 42, cycleDays: 210, maintenanceMode: false, maintenanceMsg: '',
  maxWithdrawalsPerDay: 2, requireInvestToWithdraw: true,
  annEnabled: false, annTitle: '', annBody: '', annCtaLabel: '', annCtaUrl: '', announcementBg: '',
  supportTelegram: '', telegramGroup: '', telegramChannel: '', supportHours: '',
  whatsappGroup: '', whatsappContact: '',
  rulesText: '', brandTagline: '', aboutText: '',
  homeBannerTitle: '', homeBannerText: ''
};
// The real 15-plan catalog from the owner's PDF (Space8_Investment_Plans_
// and_Variables.pdf) -- x42 total return over a fixed 210-day cycle for
// every tier (both stamped explicitly per product, not left to the global
// returnMultiple/cycleDays fallback), daily cashback = 20% of price/day.
// This is the boot fallback only -- the admin panel's `products` collection
// is still the real source of truth and overrides these via getProducts().
const DEFAULT_PRODUCTS = [
  { key: 'sputnik1',   name: 'Sputnik 1',                    price: 15000,    cycle: 210, expectedReturn: 630000     },
  { key: 'explorer1',  name: 'Explorer 1',                   price: 30000,    cycle: 210, expectedReturn: 1260000    },
  { key: 'vanguard1',  name: 'Vanguard 1',                   price: 50000,    cycle: 210, expectedReturn: 2100000    },
  { key: 'tiros1',     name: 'TIROS-1',                      price: 100000,   cycle: 210, expectedReturn: 4200000    },
  { key: 'telstar1',   name: 'Telstar 1',                    price: 180000,   cycle: 210, expectedReturn: 7560000    },
  { key: 'landsat1',   name: 'Landsat 1',                    price: 250000,   cycle: 210, expectedReturn: 10500000   },
  { key: 'meteosat1',  name: 'Meteosat-1',                   price: 350000,   cycle: 210, expectedReturn: 14700000   },
  { key: 'hubble',     name: 'Hubble Space Telescope',       price: 500000,   cycle: 210, expectedReturn: 21000000   },
  { key: 'terra',      name: 'Terra',                        price: 850000,   cycle: 210, expectedReturn: 35700000   },
  { key: 'aqua',       name: 'Aqua',                         price: 1000000,  cycle: 210, expectedReturn: 42000000   },
  { key: 'sentinel1a', name: 'Sentinel-1A',                  price: 1500000,  cycle: 210, expectedReturn: 63000000   },
  { key: 'goes16',     name: 'GOES-16',                      price: 3000000,  cycle: 210, expectedReturn: 126000000  },
  { key: 'sentinel6',  name: 'Sentinel-6 Michael Freilich',  price: 5000000,  cycle: 210, expectedReturn: 210000000  },
  { key: 'landsat9',   name: 'Landsat 9',                    price: 10000000, cycle: 210, expectedReturn: 420000000  },
  { key: 'jwst',       name: 'James Webb Space Telescope',   price: 20000000, cycle: 210, expectedReturn: 840000000  }
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
// The DEFAULT_PRODUCTS ladder only ever exists in memory until an admin
// actually edits one of them — nothing seeds the `products` collection on
// its own. Saving a single product used to make this return ONLY the saved
// docs (snap.docs.map with no merge), so every other never-touched default
// vanished from both the admin list and the user shop the moment anyone
// edited one product. Fixed: always merge saved docs with whichever
// DEFAULT_PRODUCTS keys were never saved. A saved doc marked `deleted:true`
// (see /admin/products/delete) is dropped entirely rather than falling back
// to its default, so deleting a default product doesn't just resurrect it
// on the next read.
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
// Admin-uploaded banner overrides, keyed by BANNER_KEYS slot name. Only
// slots the owner has actually replaced are ever returned to clients — an
// unset slot means "keep showing the app's own baked-in default image",
// never an empty/broken src.
let _bannersCache = null, _bannersCacheTs = 0;
async function getBannerOverrides() {
  if (Date.now() - _bannersCacheTs < 60 * 1000 && _bannersCache) return _bannersCache;
  try {
    const snap = await db.collection('banners').doc('main').get();
    _bannersCache = snap.exists ? snap.data() : {};
  } catch (_) { _bannersCache = _bannersCache || {}; }
  _bannersCacheTs = Date.now();
  return _bannersCache;
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
// The EAT calendar-day key a checkin transaction actually happened on,
// derived fresh from its own createdAt timestamp -- never trusted from the
// transaction's stored `date` string, so anything built on this is a
// genuine independent recomputation, not just re-reading a cached value.
function eatDayKey(ts) {
  const d = new Date(tsMillis(ts) + 3 * 3600000);
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
}
// Matches nowStr().date's zero-padded MM/DD/YYYY exactly -- that's the
// format /checkin itself compares lastCheckin against, so a recomputed
// value has to land in the identical shape or the very next real check-in
// would wrongly see it as "not yesterday" and reset the streak all over
// again.
function dayKeyToLastCheckinFormat(key) {
  const [y, m, d] = key.split('-');
  return `${m}/${d}/${y}`;
}
// What checkinStreak/lastCheckin SHOULD be, purely from the real history of
// 'checkin' transactions -- the length of the run of CONSECUTIVE calendar
// days ending at the most recent actual check-in. This is exactly the
// state repeated real, unbroken daily check-ins would produce on their
// own; it never invents activity that didn't happen and never touches
// wallet balance (the reward money for each real check-in was already
// correctly paid at the time, verified by the very transactions this
// reads). Used both by /checkin itself on every call (so a stale/corrupted
// stored value can never keep silently breaking a real streak) and by the
// admin recount tool below (for surfacing/logging what got corrected).
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
// Same synthetic-email scheme the client uses (phoneToEmail in index.html) —
// kept here only for endpoints that need to derive it server-side.
function phoneToEmail(phone) { return String(phone).replace(/\D/g, '').replace(/^0+/, '') + '@space8.com'; }
// STRICT on purpose. The old version's first check -- starts with "256" AND
// is >=12 digits, no upper bound -- let anything through: a mistyped
// +25625607541000 (14 digits) passed straight to MarzPay's /send-money as
// phone_number, which is exactly how one real payout got stuck "processing"
// forever with MarzPay throwing an internal error on that malformed number
// (and, since MarzPay only allows one send-money payout in flight per
// business account, silently blocked every OTHER pending withdrawal too).
// Every real Uganda mobile number is the country code (256) plus EXACTLY 9
// digits, the first of which is always 7 (all UG mobile prefixes are 07x)
// -- MarzPay's own send-money/collect-money docs use this same
// +2567XXXXXXXX shape. Returns null on anything that doesn't reduce to
// exactly that, so a garbled/wrong-country number is rejected outright
// instead of silently being accepted and forwarded to the gateway.
function cleanPhone(raw) {
  const s = String(raw || '').replace(/\D/g, '');
  let local9 = null;
  if (s.startsWith('256') && s.length === 12) local9 = s.slice(3);
  else if (s.startsWith('0') && s.length === 10) local9 = s.slice(1);
  else if (s.length === 9) local9 = s;
  if (!local9 || !/^7\d{8}$/.test(local9)) return null;
  return '+256' + local9;
}
// Whitelisted mobile-money networks — every endpoint that stores a `network`
// value (deposit, bank-account binding, withdrawal) validates against this
// SAME set rather than trusting the client's string verbatim, so a forged
// value can never reach storage, break the NETWORK_COLORS badge lookup in
// the UI, or masquerade as a network the payment gateway doesn't recognise.
const NETWORK_NAMES = new Set(['MTN Mobile Money', 'Airtel Money']);

// Admin-editable banner slots — every named key the client's baked-in
// SPACE8_BANNERS object ships with a default for. An admin override is
// merged over the client's own default at load time (GET /public/banners),
// so leaving a slot untouched keeps showing the shipped default forever —
// nothing breaks if the owner never uploads anything.
const BANNER_KEYS = new Set([
  'assortment', 'lavacake', 'barstack', 'giftbox', 'basket', 'marscrate',
  'ganache', 'factory2', 'factory1', 'darkbar', 'rocherstack', 'cookies',
  'bonbon', 'truffle', 'snickersplate', 'snickerscookie'
]);
// Hard cap on a single banner's stored size (raw data-URI string length) —
// keeps one oversized upload from bloating the M0 free-tier database or
// slowing down every client's /public/banners fetch. ~2MB of actual image
// bytes, accounting for base64's ~37% overhead.
const BANNER_MAX_LEN = 2_800_000;
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
// Checked against BOTH pendingDeposits and withdrawals — a deposit and a
// withdrawal both stamp the same 'B' letter, so checking only the caller's
// own collection (the original bug) could in theory hand out the same
// reference to a deposit and a withdrawal that happened to land in the
// same second with the same random tail. Checking the union of both makes
// a reference globally unique across every money-moving record, not just
// unique within its own type.
async function uniqueRef(letter) {
  for (let i = 0; i < 12; i++) {
    const ref = stampRef(letter);
    const [depHit, witHit] = await Promise.all([
      db.collection('pendingDeposits').where('ref', '==', ref).limit(1).get(),
      db.collection('withdrawals').where('ref', '==', ref).limit(1).get(),
    ]);
    if (depHit.empty && witHit.empty) return ref;
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
// never trusted from the client, so a milestone can never be forged. Both
// exclude a banned L1 referral's activity: an account gets banned for real
// abuse (duplicate accounts, chargebacks, fraud), and letting its
// investment/deposits keep padding the REFERRER's Task Center milestones
// after that would still be a live miscalculation even though the money
// itself was never double-paid.
async function activeL1Count(userId) {
  const snap = await db.collection('users').where('referredBy', '==', userId).get();
  let n = 0;
  snap.forEach(d => { const v = d.data(); if (v.status !== 'banned' && (v.totalInvested || 0) > 0) n += 1; });
  return n;
}
async function l1TeamDeposits(userId) {
  const snap = await db.collection('users').where('referredBy', '==', userId).get();
  let total = 0;
  snap.forEach(d => { const v = d.data(); if (v.status !== 'banned') total += Number(v.totalDeposited || 0); });
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
  f.ts = Date.now(); // last touched — lets the sweeper below expire dead entries
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

// ── ADMIN PUSH NOTIFICATIONS ──
// Fired on exactly two events: a new withdrawal request, and a deposit
// completing. Every registered admin/staff device gets both equally — no
// owner-vs-staff distinction here. Reuses the SAME Firebase project as user
// login (public client config, safe to duplicate into admin.html) — no
// separate Firebase project needed. A push failure must never break the
// money flow that triggered it, so this never throws.
async function sendAdminPush(title, body, data) {
  try {
    const snap = await db.collection('adminPushTokens').get();
    if (snap.empty) return;
    const tokens = snap.docs.map(d => d.id);
    const resp = await admin.messaging().sendEachForMulticast({
      tokens,
      notification: { title, body },
      data: data || {},
    });
    // Prune tokens Firebase reports as dead/unregistered so the list doesn't
    // grow stale forever.
    if (resp && Array.isArray(resp.responses)) {
      resp.responses.forEach((r, i) => {
        if (!r.success && /registration-token-not-registered|invalid-registration-token/.test(String(r.error?.code || '')))
          db.collection('adminPushTokens').doc(tokens[i]).delete().catch(() => {});
      });
    }
  } catch (e) {
    console.error('Admin push error:', e.message);
  }
}
// Owner-only variant of the push above, used ONLY for new-withdrawal alerts:
// owner devices get an "Approve" action button wired to that device's own
// quick-approve secret (see /admin/push/register) so a single tap sends the
// payout with the admin panel fully closed; staff devices get the identical
// notification with no action at all -- quick-approve is deliberately
// owner-only, staff still approve the normal way from inside the panel.
// FCM's sendEachForMulticast reuses one shared payload for every token, but
// each owner device needs ITS OWN token+secret embedded in the payload, so
// owner devices go out individually via sendEach while staff devices stay
// on the cheaper shared multicast.
async function sendWithdrawalPush(title, body, withdrawalId) {
  try {
    const snap = await db.collection('adminPushTokens').get();
    if (snap.empty) return;
    const ownerMessages = [];
    const staffTokens = [];
    snap.docs.forEach(d => {
      const t = d.data();
      if (t.role === 'owner' && t.quickApproveSecret) {
        ownerMessages.push({
          token: d.id,
          notification: { title, body },
          data: { type: 'withdrawal', withdrawalId, quickApprove: '1', pushToken: d.id, secret: t.quickApproveSecret }
        });
      } else {
        staffTokens.push(d.id);
      }
    });
    const deadTokens = [];
    const isDeadTokenError = code => /registration-token-not-registered|invalid-registration-token/.test(String(code || ''));
    if (ownerMessages.length) {
      const resp = await admin.messaging().sendEach(ownerMessages);
      resp.responses.forEach((r, i) => { if (!r.success && isDeadTokenError(r.error?.code)) deadTokens.push(ownerMessages[i].token); });
    }
    if (staffTokens.length) {
      const resp = await admin.messaging().sendEachForMulticast({
        tokens: staffTokens, notification: { title, body }, data: { type: 'withdrawal', withdrawalId },
      });
      resp.responses.forEach((r, i) => { if (!r.success && isDeadTokenError(r.error?.code)) deadTokens.push(staffTokens[i]); });
    }
    deadTokens.forEach(t => db.collection('adminPushTokens').doc(t).delete().catch(() => {}));
  } catch (e) {
    console.error('Withdrawal push error:', e.message);
  }
}
app.post('/admin/push/register', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const token = String(req.body.token || '');
  if (!token) return res.status(400).json({ status: 'error', message: 'Missing token' });
  try {
    const role = req.adminUser?.role || 'owner';
    // A one-time, narrowly-scoped secret for this device's push-driven
    // quick-approve action (see sendWithdrawalPush/quick-approve below) --
    // deliberately NOT the master ADMIN_KEY or a login session, and never
    // sent back to the page/JS: it only ever travels inside the encrypted
    // FCM payload of a push this same device receives, and back out again
    // when that device's own service worker acts on it. Persisted across
    // re-registration (merge) so it doesn't rotate on every token refresh.
    // Staff devices never get one at all -- quick-approve is owner-only, so
    // there's no reason for a usable-if-leaked secret to exist for staff.
    const tokRef = db.collection('adminPushTokens').doc(token);
    const existing = await tokRef.get();
    const fields = { username: req.adminUser?.username || 'owner', role, updatedAt: FieldValue.serverTimestamp() };
    if (role === 'owner') fields.quickApproveSecret = (existing.exists && existing.data().quickApproveSecret) || crypto.randomUUID();
    await tokRef.set(fields, { merge: true });
    res.json({ status: 'success' });
  } catch (e) {
    res.status(500).json({ status: 'error', message: 'Could not register for push' });
  }
});
app.post('/admin/push/unregister', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const token = String(req.body.token || '');
  if (!token) return res.status(400).json({ status: 'error', message: 'Missing token' });
  try {
    await db.collection('adminPushTokens').doc(token).delete();
    res.json({ status: 'success' });
  } catch (e) {
    res.status(500).json({ status: 'error', message: 'Could not unregister' });
  }
});

// ── MARZPAY (deposits via collect-money, withdrawals via send-money) ──
const PROVIDER_BUSY_MSG = 'The mobile-money service is temporarily busy. Please try again shortly.';
// Shown when MarzPay itself reports the collection failed/declined with no
// specific reason of its own to pass along (marzUserMsg() already surfaces
// MarzPay's own message when one exists — this is only the fallback for
// when it doesn't). Insufficient balance on the paying line is by far the
// most common real-world cause, so naming it directly is far more useful
// than a bare "not completed" that leaves the member guessing.
const DEPOSIT_FAILED_MSG = 'Payment was not completed. This is usually because the mobile-money account did not have enough balance. Check your balance and try again.';
// ── DEPOSIT ABUSE AUTO-BAN ──
// Two independent automatic bans, both owner-requested:
//  1) 5+ deposit REQUESTS from the same account within a rolling 60s window
//     -- every hit to /deposit/marzpay counts, whether it succeeds, fails,
//     or the member just backs out of the flow and taps it again. This is
//     the signature of someone repeatedly tapping Add Funds then cancelling
//     rather than a real payment attempt. A genuine member who deposits
//     several times quickly is protected as long as at least ONE of those
//     attempts actually clears (markDepositAttemptSucceeded, called from
//     creditDeposit) -- only a burst where NONE ever settles successfully
//     results in a ban.
//  2) More than 20 FAILED deposits (status:'failed') from the same account
//     in the same calendar day (EAT, matching nowStr()'s own `date` field
//     already stamped on every deposit) -- repeated failures all day is
//     either a broken payment method or someone testing many small charges
//     against a mobile-money line that keeps declining them.
// Both bans are a plain automatic `status:'banned'` on the user doc, same
// field an admin's own manual ban already sets and the same BANNED code
// path every other endpoint already enforces -- nothing new to check
// elsewhere, and the admin panel's existing Users/ban tooling already
// shows and can reverse it.
const _depAttempts = new Map();
const _depAttemptsSucceeded = new Set();
function recordDepositAttempt(userId) {
  const now = Date.now();
  let arr = (_depAttempts.get(userId) || []).filter(t => now - t < 60000);
  if (!arr.length) _depAttemptsSucceeded.delete(userId); // fresh window -- last burst's success no longer protects a new one
  arr.push(now);
  _depAttempts.set(userId, arr);
  return arr.length;
}
function markDepositAttemptSucceeded(userId) { _depAttemptsSucceeded.add(userId); }
async function banUserAutomatically(userId, reason) {
  try {
    await db.collection('users').doc(userId).update({ status: 'banned', banReason: reason, bannedAt: FieldValue.serverTimestamp() });
    console.error(`Auto-ban: ${userId} -- ${reason}`);
  } catch (e) { console.error('Auto-ban write error:', e.message); }
}
// Lightweight, fire-and-forget log of a suspicious/rejected action -- feeds
// the owner-only "Suspicious Activity" analytics (repeated insufficient-
// funds withdrawal attempts, repeated already-claimed check-ins, gift/promo
// code guessing). Deliberately NOT awaited at any call site: this is pure
// visibility, never on the critical path of the actual request, and a
// logging failure must never turn into a user-facing error.
function logSecurityEvent(userId, type, meta) {
  if (!userId) return;
  db.collection('securityEvents').add({ userId, type, meta: meta || null, createdAt: FieldValue.serverTimestamp() })
    .catch(e => console.error('logSecurityEvent error:', e.message));
}
// Marks a pending deposit failed AND checks this user's failed-deposit count
// for today, banning past 20. Centralized here so every place a deposit can
// resolve to 'failed' (the initial gateway call, the status-poll fallback,
// the webhook callback, and the background reconciler sweep) enforces the
// same rule instead of four separately-maintained copies of it.
async function markDepositFailed(depRef, userId, reason) {
  await depRef.update({ status: 'failed', failureReason: reason }).catch(() => {});
  if (!userId) return;
  try {
    const today = nowStr().date;
    const snap = await db.collection('pendingDeposits')
      .where('userId', '==', userId).where('status', '==', 'failed').where('date', '==', today).get();
    if (snap.docs.length > 20) await banUserAutomatically(userId, 'Automatic: more than 20 failed deposits today');
  } catch (e) { console.error('Deposit failure-count ban check error:', e.message); }
}
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
// ── BANK TRANSFER — a second, real automatic withdrawal rail through the
// SAME MarzPay gateway (mobile-money send-money above is completely
// untouched by any of this). Unlike collect-money/send-money, bank-transfer
// does NOT take a client-supplied reference -- MarzPay generates its own
// and returns it as `data.bank_transfer.reference` (also duplicated as
// `transaction_uuid`), so that's what we capture and poll against later.
async function marzValidateBankAccount({ bankName, accountNumber }) {
  const resp = await fetch(`${MARZPAY_BASE}/bank-transfer/validate`, {
    method: 'POST', signal: AbortSignal.timeout(MARZ_TIMEOUT),
    headers: { 'Authorization': `Basic ${MARZPAY_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ bank_name: bankName, account_number: accountNumber })
  });
  return _marzParse(resp);
}
async function marzBankTransfer({ amount, description, bankName, accountNumber, accountName, branch }) {
  const payload = { amount: Number(amount), description: description || 'Bank transfer',
    bank_name: bankName, bank_account_number: accountNumber, bank_account_name: accountName,
    wallet_source: 'main' };
  if (branch) payload.bank_branch = branch;
  const resp = await fetch(`${MARZPAY_BASE}/bank-transfer`, {
    method: 'POST', signal: AbortSignal.timeout(MARZ_TIMEOUT),
    headers: { 'Authorization': `Basic ${MARZPAY_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return _marzParse(resp);
}
// The show/status endpoint's response key is documented inconsistently
// against the create endpoint (create nests under `bank_transfer`; the
// show endpoint may use `bank_transfer_request` instead) -- read both
// rather than trusting either name alone, same defensive spirit as
// _marzExtractTx below for send-money's own shape drift.
function _marzExtractBankTransfer(d) {
  const bt = d?.data?.bank_transfer || d?.data?.bank_transfer_request || d?.data || {};
  const rawStatus = bt.status || d?.status || '';
  return { status: String(rawStatus).toLowerCase(), reference: bt.reference || bt.transaction_uuid || null };
}
// Was a single unretried attempt with no fallback -- exactly the gap that
// (once fixed for send-money below, after a real MTN payout got stuck
// "processing" forever on a provider-side error) never got ported over to
// bank-transfer. A real bank payout showed "Completed" on MarzPay's own
// dashboard while sitting stuck on 'processing' here indefinitely -- same
// failure shape, different rail. Now goes through the exact same hardened
// retry + /transactions/{reference} fallback + logging as send-money/
// collect-money (see _marzFetchTxStatus below), just with the bank-transfer
// response shape parsed via _marzExtractBankTransfer instead.
async function marzGetBankTransferTx(reference) { return _marzFetchTxStatus(`/bank-transfer/${reference}`, reference, 'marzGetBankTransferTx', _marzExtractBankTransfer); }
async function marzGetBankTransferStatus(reference) { return (await marzGetBankTransferTx(reference)).status; }
// The supported-banks list barely ever changes -- cached the same short-TTL
// way as getSettings()/getProducts() so the picker doesn't hit MarzPay on
// every single page load, while still picking up an addition within a
// minute with zero manual cache-busting.
let _banksCache = null, _banksCacheTs = 0;
async function getMarzBanks() {
  if (Date.now() - _banksCacheTs < 60 * 1000 && _banksCache) return _banksCache;
  try {
    const resp = await fetch(`${MARZPAY_BASE}/bank-transfer/banks`, {
      signal: AbortSignal.timeout(MARZ_TIMEOUT), headers: { 'Authorization': `Basic ${MARZPAY_KEY}` }
    });
    const d = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const list = d?.data?.banks || d?.data || [];
    const banks = Array.isArray(list) ? list.map(b => (typeof b === 'string' ? b : (b.name || b.bank_name || ''))).filter(Boolean) : [];
    if (banks.length) { _banksCache = banks; _banksCacheTs = Date.now(); }
    return _banksCache || [];
  } catch (e) {
    console.error('getMarzBanks error:', e.message);
    return _banksCache || []; // serve the last known-good list on a transient failure rather than an empty picker
  }
}
// Returns the full transaction resource (status + whatever identifying
// fields MarzPay's response happens to echo back), not just a bare status
// string — a bare status alone only proves SOME transaction with this uuid
// reached that state, never that it's the one that paid a SPECIFIC
// reference. Callers that need to trust an uuid they didn't themselves
// capture (see /deposit/callback's self-heal path) must cross-check
// `.reference` against their own record before accepting anything.
// FIXED real bug: a payout's own MTN Mobile Money SMS confirmed it
// genuinely arrived, but the status lookup below kept failing/timing out
// against MarzPay's API, so /withdraw/callback, the 30s reconciler, and
// the on-demand "Sync MarzPay" all kept the record stuck on 'processing'
// indefinitely — WITH ZERO TRACE in the server logs of why (every failure
// was swallowed by a bare `catch(_){}`, and only one exact field path was
// ever tried for the status value). Owner explicitly wants this resolved
// by the provider check itself getting more reliable, not by a manual
// admin override — so this is now: (1) logged on every failure, so a
// repeat is diagnosable instead of just vanishing; (2) retried a couple of
// times on a transient network/HTTP failure instead of giving up and
// waiting a full extra 30s reconciler cycle; (3) parses several plausible
// field names/locations for the status value (MarzPay's send-money and
// collect-money resources are not guaranteed to shape their response
// identically), so a real completed transaction is far less likely to be
// missed just because the status landed in a spot the old single-path
// lookup didn't check.
function _marzExtractTx(d) {
  const tx = d?.data?.transaction || d?.transaction || d?.data || d || {};
  const rawStatus = tx.status || tx.state || tx.transaction_status || tx.payment_status || d?.status || '';
  return { status: String(rawStatus).toLowerCase(), reference: tx.reference || tx.transaction_reference || null };
}
async function _marzFetchTxStatus(path, uuid, label, extractFn) {
  extractFn = extractFn || _marzExtractTx;
  let lastErr = null;
  // 2 attempts, 350ms apart, then straight to the /transactions fallback
  // below -- a genuine transient blip almost always clears on the first
  // retry (proven by test-withdrawal-stuck-auto-resolve.js), so burning
  // several extra seconds on a 3rd attempt before ever trying a second,
  // different endpoint just made every "Verify"/status click feel stuck for
  // no real benefit.
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
        return extractFn(d);
      }
    } catch (e) { lastErr = e; console.error(`${label}(${uuid}) attempt ${attempt} failed:`, e.message); }
    if (attempt < 2) await new Promise(r => setTimeout(r, 350));
  }
  // Real production case: MarzPay's own /send-money/{uuid} resource threw a
  // server-side error on ITS end (HTTP 422 "Undefined variable $currency" --
  // a bug in their code, not ours, confirmed reproducing identically on
  // every single attempt, not a transient network flake) for one specific
  // transaction. Their own docs list GET /transactions/{uuid} as a
  // documented fallback "when webhooks are delayed" -- it's a different
  // resource/code path on their side, so a bug specific to one product's own
  // formatter doesn't necessarily also break this one. One extra try here
  // before giving up, reusing the SAME extractFn since /transactions/{uuid}
  // is a generic resource across every MarzPay product (send-money,
  // collect-money, bank-transfer), not specific to whichever one failed.
  try {
    const resp = await fetch(`${MARZPAY_BASE}/transactions/${uuid}`, {
      signal: AbortSignal.timeout(MARZ_TIMEOUT), headers: { 'Authorization': `Basic ${MARZPAY_KEY}` }
    });
    const d = await resp.json().catch(() => ({}));
    if (resp.ok) {
      const parsed = extractFn(d);
      if (parsed.status) {
        console.log(`${label}(${uuid}): resolved via /transactions/{uuid} fallback after the primary endpoint kept failing`);
        return parsed;
      }
    } else {
      console.error(`${label}(${uuid}) /transactions fallback: HTTP ${resp.status}`, JSON.stringify(d).slice(0, 300));
    }
  } catch (e) { console.error(`${label}(${uuid}) /transactions fallback failed:`, e.message); }
  console.error(`${label}(${uuid}): gave up after 2 attempts + fallback, last error:`, lastErr && lastErr.message);
  return { status: '', reference: null };
}
// Returns the full transaction resource (status + whatever identifying
// fields MarzPay's response happens to echo back), not just a bare status
// string — a bare status alone only proves SOME transaction with this uuid
// reached that state, never that it's the one that paid a SPECIFIC
// reference. Callers that need to trust an uuid they didn't themselves
// capture (see /deposit/callback's self-heal path) must cross-check
// `.reference` against their own record before accepting anything.
async function marzGetCollectTx(uuid) { return _marzFetchTxStatus(`/collect-money/${uuid}`, uuid, 'marzGetCollectTx'); }
async function marzGetSendTx(uuid)    { return _marzFetchTxStatus(`/send-money/${uuid}`,    uuid, 'marzGetSendTx'); }
async function marzGetCollectStatus(uuid) { return (await marzGetCollectTx(uuid)).status; }
async function marzGetSendStatus(uuid) { return (await marzGetSendTx(uuid)).status; }
const SUCCESS_STATUSES = new Set(['success', 'successful', 'completed']);
const FAILED_STATUSES  = new Set(['failed', 'declined', 'cancelled', 'canceled', 'rejected', 'expired']);
// MarzPay's webhooks always carry event_type (collection.completed/failed/
// cancelled for deposits, disbursement.completed/failed for withdrawals,
// plus a generic success/failure on some dashboard-configured webhooks) —
// used as a fallback whenever transaction.status is missing or shaped
// somewhere this code doesn't already check, so a genuine webhook is never
// silently dropped just because the status field wasn't where expected.
function marzEventTypeFallback(eventType) {
  const e = String(eventType || '');
  if (e === 'success' || /\.completed$/.test(e)) return 'completed';
  if (e === 'failure' || /\.(failed|cancelled|canceled)$/.test(e)) return 'failed';
  return '';
}

// ── DAILY CASHBACK (settle-on-read, no cron in this MVP) ──
// Each plan tier pays price*returnMultiple/cycleDays per elapsed day,
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
      const amount = willComplete
        ? Math.max(0, (Number(f.expectedReturn) || 0) - (Number(f.paidOut) || 0))
        : (Number(f.dailyPayout) || 0) * fDue;
      if (amount <= 0) return;
      // RECORD-BEFORE-CREDIT. db.js's runTransaction is NOT atomic on M0 — it
      // replays queued writes one at a time — so a failure part-way through
      // leaves whatever already ran committed. Crediting the wallet first and
      // recording the payout second meant a failed second write left money
      // credited with payoutsMade still on its old value; reconcileCashback()
      // re-runs every second, recomputed the SAME dueCount, and credited it
      // again on every tick until the write finally landed — an unbounded,
      // self-amplifying over-payment. Advancing payoutsMade first makes the
      // failure direction safe: the ledger says paid, so nothing re-credits,
      // and the rollback below puts it straight back if the credit itself
      // fails, so the member never silently loses a day either.
      await doc.ref.update({
        payoutsMade: newMade, paidOut: FieldValue.increment(amount),
        status: willComplete ? 'matured' : 'active'
      });
      try {
        await db.collection('users').doc(f.userId).update({
          walletBalance: FieldValue.increment(amount), totalEarned: FieldValue.increment(amount)
        });
      } catch (creditErr) {
        await doc.ref.update({
          payoutsMade: fMade, paidOut: FieldValue.increment(-amount), status: 'active'
        }).catch(() => {});
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

// ── REFERRAL COMMISSION (credited when a downstream member buys a product) ──
// Idempotent per (investmentId, level): each level is only ever credited
// once, tracked via commissionPaidLevels on the investment doc itself, and
// the whole function is safe to call again for the SAME purchase — by the
// reconciler after a restart, by a retry, by anything — since already-paid
// levels are skipped and never re-credited. Each level is claimed
// (commissionPaidLevels updated) BEFORE its wallet credit, not after, so a
// crash mid-loop can only ever leave a level "claimed but not yet credited"
// (a single lost payment, safe and visible to fix by hand) rather than
// "credited but not marked" -- which used to let the reconciler's next pass
// see the level as still unpaid and credit it again, repeating on every
// restart until caught.
async function creditReferralCommission(investmentId, buyerId, amount) {
  await withLock('comm:' + investmentId, async () => {
    const invRef = db.collection('investments').doc(investmentId);
    const invSnap = await invRef.get();
    if (!invSnap.exists) return;
    // L1/L2/L3 commission is a ONE-TIME reward for landing a new investor —
    // it only ever fires off a buyer's first-ever investment, stamped on the
    // investment doc itself at creation time (see /invest/create). Every
    // later purchase by that same buyer is real, valid investment activity
    // (it still counts toward Task Center's active-referral and deposit-
    // total milestones), but it never pays L1/L2/L3 again. Checked here
    // rather than only at the call site so the periodic reconciler — which
    // re-invokes this for any investment created recently, first or not —
    // can never accidentally pay a later purchase.
    if (invSnap.data().isFirstInvestment !== true) return;
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
      // CLAIM-BEFORE-CREDIT (same pattern as /redeem): mark this level paid
      // BEFORE touching the wallet, not after. The old order (credit, THEN
      // mark) meant a crash landing between those two writes left a real
      // credit on the books with no marker recorded -- so the reconciler's
      // next pass would see the level as still unpaid and credit it AGAIN,
      // repeating indefinitely on every restart. Claiming first inverts the
      // failure direction: a crash here can only ever produce "marked paid
      // but the credit write never landed" (a single lost payment, visible
      // and fixable by hand), never a silently repeating double-pay.
      await invRef.update({ commissionPaidLevels: FieldValue.arrayUnion(i) });
      await db.collection('users').doc(id).update({
        walletBalance: FieldValue.increment(reward), teamCommission: FieldValue.increment(reward)
      });
      await db.collection('transactions').add({
        userId: id, type: 'commission', description: `Level ${i + 1} reward`,
        amount: reward, status: 'success', date, time, investmentId, createdAt: FieldValue.serverTimestamp()
      });
    }
  });
}

// ═══════════════════════════════════════════
// TEAM + TASK CENTER
// ═══════════════════════════════════════════
// Returns the caller's own Level 1 (direct), Level 2 (their referrals'
// referrals), or Level 3 team — ?level=1|2|3, defaulting to 1 for backward
// compatibility. Walked one hop at a time from the caller's own id rather
// than trusting any stored "level" field, so it's always derived fresh from
// the live referredBy graph and can never be spoofed by passing someone
// else's id anywhere in the chain.
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
      members = [];
      snap.forEach(doc => {
        const d = doc.data();
        nextIds.push(doc.id);
        members.push({
          id: doc.id, phone: d.phone || '',
          joinedAt: d.createdAt ? new Date(tsMillis(d.createdAt)).toISOString() : null,
          hasInvested: (d.totalInvested || 0) > 0,
          totalInvested: d.totalInvested || 0,
          deposited: d.totalDeposited || 0,
        });
      });
      parentIds = nextIds;
    }
    members.sort((a, b) => (b.joinedAt || '') > (a.joinedAt || '') ? 1 : -1);
    res.json({ status: 'success', level, members });
  } catch (e) { console.error('Team members error:', e.message); res.status(500).json({ status: 'error', message: 'Could not load your team right now' }); }
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
  } catch (e) { console.error('Team stats error:', e.message); res.status(500).json({ status: 'error', message: 'Could not load your team stats right now' }); }
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
      return res.status(400).json({ status: 'error', message: `You need ${need} to claim this, you have ${have}.` });
    }
    const claimFlag = (isDeposit ? 'depositMilestoneClaimed_' : 'milestoneClaimed_') + m.target;
    let done = false;
    await withLock('milestoneclaim:' + userId + ':' + claimFlag, async () => {
      await db.runTransaction(async t => {
        const uRef = db.collection('users').doc(userId);
        const fresh = await t.get(uRef);
        if (!fresh.exists || fresh.data()[claimFlag] || fresh.data().status === 'banned') return;
        const { date, time } = nowStr();
        t.update(uRef, {
          walletBalance: FieldValue.increment(m.reward),
          totalEarned: FieldValue.increment(m.reward),
          [claimFlag]: true
        });
        t.set(db.collection('transactions').doc(), {
          userId, type: 'team_reward',
          description: isDeposit ? `Task Center: level 1 team deposits ${fmtUGX(m.target)}` : `Task Center: ${m.target} active referrals`,
          amount: m.reward, milestone: m.target, status: 'success',
          date, time, createdAt: FieldValue.serverTimestamp()
        });
        done = true;
      });
    });
    if (!done) return res.status(400).json({ status: 'error', message: 'Already claimed' });
    res.json({ status: 'success', amount: m.reward, message: `${fmtUGX(m.reward)} added to your wallet` });
  } catch (e) { console.error('Milestone claim error:', e.message); res.status(500).json({ status: 'error', message: 'Could not claim that reward right now' }); }
});

// ═══════════════════════════════════════════
// PUBLIC
// ═══════════════════════════════════════════
app.get('/health', async (_req, res) => {
  const dbOk = await pingDb().catch(() => false);
  res.json({ status: dbOk ? 'ok' : 'degraded', db: dbOk });
});
// Both public GET routes below are reachable with no auth at all -- an
// async throw here with no try/catch would be an unhandled rejection
// Express never turns into a response (only logged, per the process-level
// safety net at the top of this file), leaving the request hanging
// forever instead of failing cleanly. Wrapped so a DB hiccup is a normal
// 500, not a stuck connection an anonymous caller could pile up for free.
app.get('/public/settings', async (_req, res) => {
  try {
    const s = await getSettings();
    res.json({ status: 'success', settings: {
      withdrawFeePct: s.withdrawFeePct, minWithdraw: s.minWithdraw, minDeposit: s.minDeposit,
      dailyCheckin: s.dailyCheckin, welcomeBonus: s.welcomeBonus, commL1: s.commL1, commL2: s.commL2, commL3: s.commL3,
      returnMultiple: s.returnMultiple, cycleDays: s.cycleDays, maxWithdrawalsPerDay: s.maxWithdrawalsPerDay,
      maintenanceMode: !!s.maintenanceMode, maintenanceMsg: s.maintenanceMsg || '',
      requireInvestToWithdraw: s.requireInvestToWithdraw !== false,
      annEnabled: !!s.annEnabled, annTitle: s.annTitle || '', annBody: s.annBody || '',
      annCtaLabel: s.annCtaLabel || '', annCtaUrl: s.annCtaUrl || '', announcementBg: s.announcementBg || '',
      supportTelegram: s.supportTelegram || '',
      telegramGroup: s.telegramGroup || '', telegramChannel: s.telegramChannel || '', supportHours: s.supportHours || '',
      whatsappGroup: s.whatsappGroup || '', whatsappContact: s.whatsappContact || '',
      rulesText: s.rulesText || '', brandTagline: s.brandTagline || '', aboutText: s.aboutText || '',
      homeBannerTitle: s.homeBannerTitle || '', homeBannerText: s.homeBannerText || ''
    } });
  } catch (e) { res.status(500).json({ status: 'error', message: 'Could not load settings' }); }
});
app.get('/public/products', async (_req, res) => {
  try { res.json({ status: 'success', products: await getProducts() }); }
  catch (e) { res.status(500).json({ status: 'error', message: 'Could not load products' }); }
});
app.get('/public/banners', async (_req, res) => {
  const overrides = await getBannerOverrides();
  // Only ever return keys the owner actually set — anything absent/null
  // means the client keeps its own shipped default, so this endpoint being
  // empty (the common case, nothing uploaded yet) changes nothing at all.
  const banners = {};
  for (const k of BANNER_KEYS) if (overrides[k]) banners[k] = overrides[k];
  res.json({ status: 'success', banners });
});
// Real bank picker for the Bank Transfer withdrawal screen -- pulled from
// MarzPay's own supported-bank list (cached, see getMarzBanks) rather than
// a free-text field, so a member can never type a bank name MarzPay
// doesn't actually support.
app.get('/public/banks', async (_req, res) => {
  try { res.json({ status: 'success', banks: await getMarzBanks() }); }
  catch (e) { res.status(500).json({ status: 'error', message: 'Could not load bank list' }); }
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
  // Both floors are read live from admin-configured settings, never
  // hardcoded — if the owner raises/lowers minDeposit or minWithdraw, this
  // simulated feed reflects it on its very next rebuild (~25s), the same
  // as every real deposit/withdrawal already does. A simulated top-up
  // showing below the actual minimum deposit (or a payout below the actual
  // minimum withdrawal) would be an obvious tell that the feed is fake and
  // not even internally consistent with the app's own rules.
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
  // Guards against an admin setting a minimum so high it clears the whole
  // static ladder/cap (e.g. minDeposit above 1,000,000 or minWithdraw above
  // 500,000) -- falls back to just the floor itself rather than handing
  // an empty pool to the random pick below.
  if (!depositPool.length) depositPool = [minDep || 30000];
  if (!withdrawPoolFiltered.length) withdrawPoolFiltered.push(minWit || 5000);
  const rows = [];
  const usedNumbers = new Set();
  for (let i = 0; i < 18; i++) {
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
  } else if (!_activityBuilding && Date.now() - _activityTs > 25000) {
    _activityBuilding = true;
    buildActivityFeed()
      .then(f => { _activityFeed = f; _activityTs = Date.now(); })
      .catch(e => console.error('Activity feed error:', e.message))
      .finally(() => { _activityBuilding = false; });
  }
  res.json({ status: 'success', feed: _activityFeed });
});

// ── MEMBER NOTIFICATIONS ───────────────────────────────────────────────
// Database-backed records shown in the authenticated member notification bell.
async function createMemberNotification(userId, title, body, type, data) {
  if (!userId) return;
  await db.collection('notifications').add({
    userId, audience: 'member',
    title: stripHtml(title || '').slice(0, 120),
    body: stripHtml(body || '').slice(0, 600),
    type: String(type || 'system').slice(0, 40),
    data: data && typeof data === 'object' ? data : {},
    readAt: null, createdAt: FieldValue.serverTimestamp()
  });
}
app.get('/notifications', async (req, res) => {
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Please sign in again' });
  try {
    const userSnap = await db.collection('users').doc(userId).get();
    if (!userSnap.exists || userSnap.data().status === 'banned')
      return res.status(403).json({ status: 'error', code: 'BANNED', message: 'Account suspended. Contact customer service.' });
    const [mine, broadcasts] = await Promise.all([
      db.collection('notifications').where('userId', '==', userId).limit(50).get(),
      db.collection('notifications').where('audience', '==', 'all').limit(30).get()
    ]);
    const seen = new Set(), rows = [];
    [...mine.docs, ...broadcasts.docs].forEach(doc => {
      if (seen.has(doc.id)) return;
      seen.add(doc.id);
      const n = doc.data();
      // Broadcasts (audience:'all') have no single owning userId, so "read"
      // can't live on a plain readAt field the way it does for a member's
      // own notification -- every member sees the same doc. readBy is an
      // array of userIds who've opened the bell since this broadcast was
      // created; membership in it is this member's own read state.
      const readAt = n.audience === 'all' ? ((n.readBy || []).includes(userId) ? true : null) : (n.readAt || null);
      rows.push({ id: doc.id, title: n.title || 'Space8 update', body: n.body || '',
        type: n.type || 'system', readAt, createdAt: n.createdAt || null });
    });
    rows.sort((a, b) => (tsMillis(b.createdAt) || 0) - (tsMillis(a.createdAt) || 0));
    res.json({ status: 'success', notifications: rows.slice(0, 50) });
  } catch (e) {
    console.error('Notifications error:', e.message);
    res.status(500).json({ status: 'error', message: 'Could not load notifications' });
  }
});
app.post('/notifications/read', async (req, res) => {
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Please sign in again' });
  const ids = Array.isArray(req.body.ids) ? req.body.ids.slice(0, 50).filter(x => typeof x === 'string' && x.length <= 128) : [];
  try {
    await Promise.all(ids.map(async id => {
      const ref = db.collection('notifications').doc(id);
      const snap = await ref.get();
      if (!snap.exists) return;
      const n = snap.data();
      if (n.userId === userId) await ref.update({ readAt: FieldValue.serverTimestamp() });
      // Broadcasts have no single owner -- record THIS member's read state
      // in a shared readBy array instead of overwriting one readAt field
      // every other member would also be judged against.
      else if (n.audience === 'all') await ref.update({ readBy: FieldValue.arrayUnion(userId) });
    }));
    res.json({ status: 'success' });
  } catch (e) {
    res.status(500).json({ status: 'error', message: 'Could not mark notifications read' });
  }
});
app.post('/admin/notifications/create', async (req, res) => {
  // Owner-only, like every other broadcast-to-every-member action
  // (/admin/settings/update controls the equivalent annEnabled/annTitle/
  // annBody announcement) -- a staff login must not be able to push a
  // message to the entire user base.
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const title = stripHtml(req.body.title || '').trim().slice(0, 120);
  const body = stripHtml(req.body.body || '').trim().slice(0, 600);
  if (!title || !body) return res.status(400).json({ status: 'error', message: 'Title and message are required' });
  try {
    await db.collection('notifications').add({
      audience: 'all', title, body, type: 'announcement',
      createdBy: req.adminUser?.username || 'owner', createdAt: FieldValue.serverTimestamp()
    });
    res.json({ status: 'success' });
  } catch (e) {
    res.status(500).json({ status: 'error', message: 'Could not create notification' });
  }
});

// ═══════════════════════════════════════════
// ACCOUNT / REGISTER / CHECK-IN
// ═══════════════════════════════════════════
app.post('/account/create-profile', async (req, res) => {
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  // Not rejecting here on purpose -- this phone already succeeded as this
  // user's Firebase login identity client-side before this call ever
  // happens, so it's not the money-moving path cleanPhone()'s new strict
  // rejection is meant to guard (payout binding/withdrawal, below). Falls
  // back to the raw trimmed input rather than storing null so a profile
  // phone that doesn't reduce to a clean UG mobile number is stored as-is,
  // exactly like it always was, instead of becoming null.
  const phone = cleanPhone(req.body.phone || '') || String(req.body.phone || '').trim();
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

// Shared by the member's own self-service /register AND the owner-only
// admin "Complete registration" reconciliation action (see
// /admin/user/complete-registration below), so there is exactly ONE place
// that ever assigns a referral code, links a referrer's team counts, or
// credits the welcome bonus -- not two copies that could quietly drift
// apart. Both call sites go through the SAME 'reg:'+userId lock, so if a
// member's own client happens to retry /register at the exact moment an
// admin clicks the fix, they cannot race each other into a double credit --
// whichever gets the lock first completes registration and flips
// registrationDone to true; the other sees that flag already set and stops
// immediately, exactly like a normal retry always has.
async function completeRegistrationCore(userId, referralCode) {
  return withLock('reg:' + userId, async () => {
    const userRef = db.collection('users').doc(userId);
    const userSnap = await userRef.get();
    if (!userSnap.exists) return { code: 404, body: { status: 'error', message: 'User not found' } };
    if (userSnap.data().registrationDone)
      return { code: 200, body: { status: 'already_done', referralCode: userSnap.data().referralCode || null } };

    const code = String(referralCode || '').trim().toUpperCase();
    let referrerId = null;
    if (code) {
      const refSnap = await db.collection('users').where('referralCode', '==', code).limit(1).get();
      if (refSnap.empty)
        return { code: 400, body: { status: 'error', code: 'BAD_REFERRAL', message: 'That referral code does not exist.' } };
      if (refSnap.docs[0].id === userId)
        return { code: 400, body: { status: 'error', code: 'BAD_REFERRAL', message: 'You cannot use your own referral code.' } };
      referrerId = refSnap.docs[0].id;
    }

    const myRefCode = await generateUniqueReferralCode();
    const sett = await getSettings();
    const WELCOME = Number(sett.welcomeBonus) || 0;
    const update = { registrationDone: true, referralCode: myRefCode, walletBalance: FieldValue.increment(WELCOME) };
    if (referrerId) update.referredBy = referrerId;
    // The user's own doc (registrationDone + the actual wallet credit) is
    // written FIRST, in one atomic single-document update. If the process
    // dies right after this, the user is already fully and correctly paid
    // and marked done — a retried call hits the registrationDone guard above
    // and stops immediately rather than re-running anything below. This is
    // also why the referrer/L2/L3 team-count increments moved to AFTER this
    // line (they used to run before it): those are separate per-document
    // writes with no cross-document transaction on M0, so if they ran first
    // and the process crashed before registrationDone got set, a retry would
    // re-run and increment every one of them a second time -- inflating team
    // size on every crash-retry. Running them after means a crash here can
    // only under-count (registrationDone already true, so a retry is a safe
    // no-op that never re-runs this block at all), never over-count.
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
    if (WELCOME > 0) {
      const { date, time } = nowStr();
      await db.collection('transactions').add({
        userId, type: 'admin_credit', description: 'Welcome gift',
        amount: WELCOME, status: 'success', date, time, createdAt: FieldValue.serverTimestamp()
      });
    }
    return { code: 200, body: { status: 'success', referrerId, welcomeBonus: WELCOME, referralCode: myRefCode } };
  });
}
app.post('/register', async (req, res) => {
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const result = await completeRegistrationCore(userId, req.body.referralCode);
    res.status(result.code).json(result.body);
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
    if (!snap.exists) return res.status(404).json({ status: 'error', message: 'User not found' });
    const u = snap.data();
    // SECURITY (real bug, confirmed live): every WRITE endpoint (checkin,
    // invest, deposit, withdraw, bank/save, redeem) already refused a banned
    // account, but /account itself -- the one endpoint that runs on every
    // login and every background poll, and decides whether the app lets
    // someone in at all -- had no ban check whatsoever. A banned account
    // could sign in and use the app normally as long as it never happened to
    // hit one of those specific write endpoints. This is the actual gate.
    if (u.status === 'banned')
      return res.status(403).json({ status: 'error', code: 'BANNED', message: 'Account suspended. Contact customer service.' });
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

// ── ASSISTANT ──────────────────────────────────────────────────────────
// Self-hosted support chat -- no external API, no per-message cost (see
// assistant-engine.js for the actual intent-matching/entity-extraction
// logic). Every reply is grounded in a fresh read of live settings +
// products + the caller's own account, so answers track whatever the admin
// has actually configured instead of copy hand-maintained in the client.
const ASSIST_FALLBACK = 'The assistant is temporarily unavailable. For deposits, withdrawals, investing, referrals or check-ins, see the relevant screen in the app, or reach Support from the Account tab.';
app.post('/assistant/chat', async (req, res) => {
  const uid = await verifyAuth(req);
  if (!uid) return res.status(401).json({ status: 'error', message: 'Please sign in again' });
  const message = stripHtml(req.body.message).slice(0, 500);
  if (!message) return res.status(400).json({ status: 'error', message: 'Type a message first.' });
  try {
    const history = Array.isArray(req.body.history)
      ? req.body.history.slice(-8)
        .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string')
        .map(m => ({ role: m.role, text: stripHtml(m.text).slice(0, 500) }))
      : [];

    const [sett, products, snap] = await Promise.all([
      getSettings(), getProducts(), db.collection('users').doc(uid).get()
    ]);
    if (snap.exists && snap.data().status === 'banned')
      return res.status(403).json({ status: 'error', code: 'BANNED', message: 'Account suspended. Contact customer service.' });
    const u = snap.exists ? snap.data() : {};

    const reply = answerAssistant({ message, history, settings: sett, products, account: u });
    res.json({ status: 'success', reply: reply || ASSIST_FALLBACK });
  } catch (e) {
    console.error('Assistant error:', e.message);
    res.json({ status: 'success', reply: ASSIST_FALLBACK });
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
      if (u.status === 'banned') return res.status(403).json({ status: 'error', code: 'BANNED', message: 'Account suspended. Contact customer service.' });
      const today = nowStr().date;
      if (u.lastCheckin === today) {
        logSecurityEvent(uid, 'checkin_already_claimed', null);
        return res.status(400).json({ status: 'error', message: 'Already checked in today' });
      }
      // Reconciled against real check-in history on every single call,
      // rather than trusting the stored checkinStreak/lastCheckin fields
      // outright -- a stale or corrupted value (a bad past write, data
      // edited by hand, any bug since fixed) can never keep silently
      // breaking or misreporting a real streak; the next check-in always
      // self-heals it. Bounded to this one user's own check-ins -- at most
      // one real row per calendar day since the account existed -- so this
      // is one small extra indexed query, not a real scan.
      // orderBy + limit, not just limit: without an explicit sort, a bare
      // .limit(500) returns whatever order the DB feels like (in practice,
      // natural/insertion order -- the OLDEST 500 check-ins, not the most
      // recent ones) for any account with more than 500 lifetime check-ins.
      // That silently fed the streak calculation ancient history instead of
      // recent activity, wrongly resetting a long-lived daily user's streak.
      // Sorting desc first means the 500 fetched are always the most recent.
      const ledgerSnap = await db.collection('transactions')
        .where('userId', '==', uid).where('type', '==', 'checkin').orderBy('createdAt', 'desc').limit(500).get();
      const dayKeys = new Set();
      ledgerSnap.forEach(d => dayKeys.add(eatDayKey(d.data().createdAt)));
      const real = computeCheckinStreak(dayKeys);
      const yesterday = new Date(eatNow().getTime() - 86400000);
      const yPad = n => String(n).padStart(2, '0');
      const yStr = yPad(yesterday.getUTCMonth() + 1) + '/' + yPad(yesterday.getUTCDate()) + '/' + yesterday.getUTCFullYear();
      const streak = real.lastCheckin === yStr ? real.streak + 1 : 1;
      const bonus = sett.dailyCheckin;
      await ref.update({ walletBalance: FieldValue.increment(bonus), lastCheckin: today, checkinStreak: streak });
      const { date, time } = nowStr();
      await db.collection('transactions').add({
        userId: uid, type: 'checkin', description: `Daily reward, day ${streak}`,
        amount: bonus, status: 'success', date, time, createdAt: FieldValue.serverTimestamp()
      });
      createMemberNotification(uid, 'Check-in reward received', `${fmtUGX(bonus)} was added for day ${streak}.`, 'checkin', { bonus, streak }).catch(e => console.warn('Check-in notification:', e.message));
      res.json({ status: 'success', bonus, streak });
    });
  } catch (e) {
    console.error('Checkin error:', e.message);
    res.status(500).json({ status: 'error', message: 'Check-in failed' });
  }
});

// ═══════════════════════════════════════════
// PRODUCTS (buy a plan tier)
// ═══════════════════════════════════════════
app.post('/invest/create', async (req, res) => {
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Please sign in again' });
  const tier = await getProductByKey(req.body.tierKey);
  if (!tier) return res.status(400).json({ status: 'error', message: 'Unknown product' });
  // The shop only ever shows active, non-coming-soon products, but that's a
  // client-side filter — nothing stopped a direct API call from buying a
  // product an admin deliberately turned off or marked coming soon.
  if (tier.active === false || tier.comingSoon) return res.status(400).json({ status: 'error', message: 'This product is not available right now.' });
  try {
    const sett = await getSettings();
    const cycle = Number(tier.cycle) || sett.cycleDays;
    const expectedReturn = Number(tier.expectedReturn) || Math.round(tier.price * sett.returnMultiple);
    const dailyPayout = Math.round(expectedReturn / cycle);
    let invId;
    await withLock('bal:' + userId, () => db.runTransaction(async t => {
      // Re-checked again, right here, immediately before any money actually
      // moves -- the check above (line ~1128) runs at the top of the
      // request, but this is the moment that actually matters. getProductByKey()
      // re-reads live (its cache is invalidated the instant an admin saves
      // ANY product change), so if this exact product got turned off or
      // marked coming-soon in the gap between the two checks -- a client
      // showing a stale "buy" button mid-sync, two requests racing, or
      // anything else that could ever land a request here after the fact
      // -- it's caught and refused HERE too, not just at the door. This is
      // a pure purchase-time gate: it never touches or reverses an
      // investment someone already legitimately holds from before the
      // product was paused, only blocks a brand new one from being created.
      const liveTier = await getProductByKey(tier.key);
      if (!liveTier || liveTier.active === false || liveTier.comingSoon) throw new Error('This product is not available right now.');
      const uRef = db.collection('users').doc(userId);
      const fresh = await t.get(uRef);
      if (!fresh.exists) throw new Error('User not found');
      if (fresh.data().status === 'banned') { const banErr = new Error('Account suspended. Contact customer service.'); banErr.code = 'BANNED'; throw banErr; }
      const bal = fresh.data().walletBalance || 0;
      if (bal < tier.price) throw new Error(`Need ${fmtUGX(tier.price)}, have ${fmtUGX(bal)}`);
      // Referral commission is a one-time reward for the buyer's first-ever
      // investment. firstInvestmentDone is the authoritative flag going
      // forward, but it never existed on accounts that invested before this
      // flag was introduced — falling back to their pre-existing
      // totalInvested (only ever incremented by a real completed investment)
      // means an existing investor's NEXT purchase is correctly recognised
      // as a later one, not wrongly treated as "first" and double-paying
      // their referrer. Read BEFORE incrementing totalInvested below.
      const isFirstInvestment = !(fresh.data().firstInvestmentDone === true || (fresh.data().totalInvested || 0) > 0);
      const invRef = db.collection('investments').doc();
      invId = invRef.id;
      // FieldValue.increment() on MongoDB throws "Cannot increment with
      // non-numeric argument" outright if the stored field isn't already a
      // number (seen live on a real account with totalInvested stored as
      // the STRING "30000", likely from an old manual edit) -- blocking the
      // purchase entirely instead of just producing a wrong total. This
      // transaction is already single-writer-safe per user via the
      // withLock('bal:'+userId) wrapping it, so computing the new values
      // from the value just read and writing them as plain numbers is just
      // as race-safe as increment() here, and it self-heals a corrupted
      // string field back to numeric the moment this runs.
      const newBalance = (Number(fresh.data().walletBalance) || 0) - tier.price;
      const newInvested = (Number(fresh.data().totalInvested) || 0) + tier.price;
      t.update(uRef, {
        walletBalance: newBalance, totalInvested: newInvested,
        firstInvestmentDone: true
      });
      const { date, time } = nowStr();
      t.set(invRef, {
        userId, tierKey: tier.key, tierLabel: tier.name, amount: tier.price, cycle, expectedReturn,
        status: 'active', dailyPayout, payoutsTotal: cycle, payoutsMade: 0, paidOut: 0,
        isFirstInvestment, commissionPaidLevels: [], date, time, createdAt: FieldValue.serverTimestamp()
      });
      t.set(db.collection('transactions').doc(), {
        userId, type: 'investment', description: `Bought ${tier.name}`, amount: -tier.price,
        status: 'success', date, time, investmentId: invRef.id, createdAt: FieldValue.serverTimestamp()
      });
    }));
    creditReferralCommission(invId, userId, tier.price).catch(e => console.error('Commission error:', e.message));
    createMemberNotification(userId, 'Plan activated', `${tier.name} is now active. Cashback is credited automatically each day.`, 'investment', { investmentId: invId, tierKey: tier.key }).catch(e => console.warn('Investment notification:', e.message));
    res.json({ status: 'success', investmentId: invId, message: `Bought ${tier.name} for ${fmtUGX(tier.price)}` });
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
      db.collection('investments').where('userId', '==', uid).get(),
      getProducts()
    ]);
    // Price/cycle/expectedReturn/dailyPayout are locked in for good at
    // purchase time (see test-locked-in-pricing.js) -- an admin edit must
    // never retroactively change what an existing plan pays out. The
    // DISPLAY name is different: an owner relabelling a product (e.g. to
    // "VIP 1: Comet...") should show up on every already-running plan
    // too, not just the shop listing, so this looks the current product up
    // by tierKey and swaps in its live name. Falls back to the name
    // recorded at purchase time if that product key was since deleted.
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
  try {
    const [uSnap, sett] = await Promise.all([db.collection('users').doc(userId).get(), getSettings()]);
    if (!uSnap.exists) return res.status(404).json({ status: 'error', message: 'User not found' });
    if (uSnap.data().status === 'banned') return res.status(403).json({ status: 'error', code: 'BANNED', message: 'Account suspended. Contact customer service.' });

    // Every request reaching here counts as a deposit attempt, INCLUDING
    // ones about to be soft-rate-limited by the debounce right below --
    // rapid clicking straight through the debounce wall is itself part of
    // the abuse pattern this is watching for, not something that should
    // escape counting just because it also got a 429.
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
    if (!phone || phone.length < 10) return res.status(400).json({ status: 'error', message: 'Enter a valid mobile-money phone number.' });

    // Two different references on purpose: `ref` is OUR display reference
    // (the B<timestamp> format shown to the user/Records), `marzReference`
    // is what actually goes to MarzPay's `reference` field — their API
    // requires that to be a UUID v4 for collections, so it can never be the
    // same string as our own format.
    const ref = await uniqueRef('B');
    const marzReference = crypto.randomUUID();
    const { date, time } = nowStr();
    const depRef = db.collection('pendingDeposits').doc();
    // The network is only ever shown back to the member/admin (which network
    // they said they were paying from) — MarzPay itself detects it from the
    // phone number, not from this field — so whitelist it rather than
    // storing whatever arbitrary string the client sends.
    const network = NETWORK_NAMES.has(req.body.network) ? req.body.network : null;
    // Write BEFORE calling the gateway — marzCollect() below can trigger a
    // REAL mobile-money charge; if the process dies right after that call
    // succeeds, the doc must already exist so a reconciler can find it by
    // OUR OWN reference even without MarzPay's uuid yet.
    await depRef.set({
      userId, phone, network, amount: amt, ref, marzReference, status: 'initiating',
      date, time, createdAt: FieldValue.serverTimestamp()
    });
    // Respond the instant OUR OWN write lands — do not make the member wait
    // on MarzPay's own API round-trip (which can legitimately take several
    // seconds) before they see any confirmation at all. MarzPay pushes the
    // real mobile-money PIN prompt to their phone on ITS OWN timeline
    // regardless of when our response arrives, so the fix is to stop
    // blocking our screen on that round-trip — not to make the round-trip
    // itself faster (that part isn't ours to control). The actual gateway
    // call below runs in the background; the status screen's own polling
    // (which starts immediately and repeats every 3s) picks up whatever it
    // resolves to — pending, matched, or failed — within moments either way.
    res.json({ status: 'success', depositId: depRef.id, reference: ref, message: 'Payment initiated. Check your phone.' });
    // Unlike withdrawals, a thrown/timed-out call here must NOT be treated
    // as a clean failure: money hasn't moved on OUR side (nothing was
    // debited yet — deposits only credit on confirmation), but MarzPay may
    // have genuinely received and be processing the charge on THEIRS. If we
    // marked this 'failed', a customer who WAS actually charged would never
    // get credited (there's no marzTxUuid to poll against). So on a network
    // exception the record stays 'initiating' — findable later by `ref` —
    // and the status screen just keeps polling rather than showing a
    // definitive "it failed".
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
      // Log the RAW gateway response — marzUserMsg() below deliberately hides
      // this from the user behind a friendly message, so without this line
      // there is no way to tell a bad MARZPAY_KEY apart from a real MarzPay
      // outage apart from staring at Render's logs and seeing nothing.
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
      // CLAIM-BEFORE-CREDIT — see settleInvestmentIfDue for the full rationale.
      // db.js's runTransaction replays writes sequentially with no rollback, so
      // crediting first and flipping to 'matched' second meant a failed second
      // write left the deposit still 'pending' with the money already paid in.
      // This exact deposit is then retried from three directions (the MarzPay
      // webhook, the client's own status poll, and reconcilePendingDeposits),
      // and every one of those retries would credit it again. Flipping to
      // 'matched' first makes each retry a clean no-op instead.
      await depDoc.ref.update({ status: 'matched', creditedAt: FieldValue.serverTimestamp() });
      try {
        await db.collection('users').doc(depUserId).update({
          walletBalance: FieldValue.increment(depAmount), totalDeposited: FieldValue.increment(depAmount)
        });
      } catch (creditErr) {
        // Money genuinely arrived at the gateway but the wallet credit failed.
        // Never re-open the deposit (that would risk a double credit) — flag it
        // loudly so it shows up for admin force-credit instead.
        await depDoc.ref.update({ needsManualCredit: true }).catch(() => {});
        console.error(`DEPOSIT CREDIT FAILED (needs manual credit) dep=${depDoc.id} user=${depUserId} amount=${depAmount}:`, creditErr.message);
        throw creditErr;
      }
      const { date, time } = nowStr();
      await db.collection('transactions').add({
        userId: depUserId, type: 'deposit', description: 'Added funds to wallet',
        amount: depAmount, status: 'success', date, time, ref: fresh.data().ref,
        createdAt: FieldValue.serverTimestamp()
      });
      credited = true; justCredited = true; creditedAmount = depAmount;
    });
    // Only on a REAL new credit (never on an idempotent replay/no-op) —
    // otherwise a retried webhook would fire a duplicate notification for
    // money that was already credited long ago.
    if (justCredited) {
      sendAdminPush('Deposit completed', `${fmtUGX(creditedAmount)} credited to a wallet`, { type: 'deposit', depositId: depDoc.id });
      markDepositAttemptSucceeded(dep.userId);
    }
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
      await markDepositFailed(depSnap.ref, userId, DEPOSIT_FAILED_MSG);
      return res.json({ status: 'success', state: 'failed', message: DEPOSIT_FAILED_MSG });
    }
    res.json({ status: 'success', state: 'pending' });
  } catch (e) {
    console.error('Deposit status error:', e.message);
    res.status(500).json({ status: 'error', message: 'Could not check payment status' });
  }
});


// MarzPay webhook. Respond 200 immediately (MarzPay retries on anything
// else, and slow processing here shouldn't hold the connection open), then
// do the real work async — this is the fast, instant-crediting path: the
// moment MarzPay confirms a payment, this fires and credits within the same
// request, with no batch job or polling delay in the way.
//
// Money-safety history on this endpoint (two real, confirmed exploits,
// each closed in turn):
//   1. Skipping live verification whenever no uuid had been captured let a
//      forged webhook credit a deposit with zero real payment.
//   2. Falling back to a uuid the WEBHOOK supplied (instead of one we
//      captured ourselves) let an attacker reuse a real uuid from their own
//      unrelated, legitimately-paid transaction to fraudulently confirm a
//      completely different, unpaid deposit — a bare "successful" status
//      only proves SOME transaction with that uuid succeeded, never that
//      it's the one that paid THIS reference.
// The fix for both, kept here: crediting/declining only ever happens after
// an INDEPENDENT live re-check, and any uuid this endpoint doesn't already
// trust (i.e. wasn't captured by our own outbound call) is only ever
// accepted once that live check's OWN reported `reference` is confirmed to
// match this exact deposit's marzReference — proving genuine correspondence
// instead of just "some real transaction happened somewhere." If MarzPay's
// response doesn't echo a reference at all, a self-heal is refused rather
// than assumed safe — uncertain is treated as unverified, same as before.
app.post('/deposit/callback', async (req, res) => {
  res.status(200).json({ status: 'ok' });
  try {
    const body = req.body || {};
    const reference = body.data?.reference || body.reference || body.data?.transaction?.reference || body.transaction?.reference;
    if (!reference) return;
    let rawStatus = String(
      body.data?.transaction?.status || body.transaction?.status || body.data?.status || body.status || ''
    ).toLowerCase();
    if (!rawStatus) rawStatus = marzEventTypeFallback(body.event_type); // collection.completed/failed/cancelled
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
    const webhookUuid = body.data?.transaction?.uuid || body.transaction?.uuid || body.data?.uuid || null;
    // SECURITY: this endpoint has no signature/secret verification — MarzPay
    // sends no shared secret we can check, so anyone who obtains a
    // marzReference (a member can see their OWN one via /deposits) can POST
    // a forged body here. The webhook's claimed status is NEVER trusted by
    // itself; crediting/declining only ever happens after an INDEPENDENT
    // live re-check against MarzPay's own API confirms it.
    //
    // A uuid we already captured ourselves (dep.marzTxUuid) is trusted
    // outright for that lookup. A uuid the WEBHOOK supplies instead (no
    // uuid captured yet — a real, documented MarzPay gap, not
    // attacker-controlled) is only ever accepted once the live check on
    // THAT uuid reports its OWN `reference` matching this exact deposit's
    // marzReference — proving it's genuinely the transaction that paid this
    // reference, not just some other real, unrelated transaction reused to
    // fake this one. (Two confirmed exploits were closed to reach this
    // point: trusting an uncaptured webhook status outright credited money
    // for zero payment; trusting a webhook-supplied uuid's bare status
    // without a reference match let a real-but-unrelated uuid fraudulently
    // confirm a completely different, unpaid deposit.) If MarzPay's
    // response doesn't echo a reference at all, the self-heal is refused —
    // "can't confirm the match" is never treated as "assume it matches."
    let uuid = dep.marzTxUuid;
    let tx = null;
    if (uuid) {
      tx = await marzGetCollectTx(uuid);
    } else if (webhookUuid) {
      const candidate = await marzGetCollectTx(webhookUuid);
      if (candidate.reference && candidate.reference === dep.marzReference) {
        uuid = webhookUuid;
        tx = candidate;
        doc.ref.update({ marzTxUuid: uuid }).catch(() => {}); // now safe to persist — independently proven to belong here
      }
    }
    if (!uuid || !tx) return;
    if (isSuccess) {
      if (!SUCCESS_STATUSES.has(tx.status)) return; // not independently confirmed — never credit on the webhook's word alone
      await creditDeposit(doc);
    } else if (isFailed) {
      if (!FAILED_STATUSES.has(tx.status)) return; // not independently confirmed — never decline on the webhook's word alone
      await markDepositFailed(doc.ref, dep.userId, DEPOSIT_FAILED_MSG);
    }
  } catch (e) {
    console.error('Deposit callback error:', e.message);
  }
});

// ═══════════════════════════════════════════
// WITHDRAWAL (MarzPay send-money)
// ═══════════════════════════════════════════
// Guards the actual MONEY-SEND step (MarzPay send-money) — shared by the
// admin "Send via MarzPay" action and admin "Reject". Two admins acting on
// the same withdrawal at once (or an admin racing a reject) could otherwise
// both touch it — checked-and-set with no await in between, so it can't
// race even though M0 gives no real transaction locking.
const _withdrawInFlight = new Set();

app.post('/withdraw/request', async (req, res) => {
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Please sign in again' });
  const amt = parseInt(req.body.amount, 10);
  if (isNaN(amt) || amt <= 0) return res.status(400).json({ status: 'error', message: 'Invalid amount' });
  // Bank-transfer withdrawal has been removed -- mobile money is the only
  // withdrawal rail. method is intentionally never read from the client.
  const method = 'mobile_money';
  const holder = stripHtml(req.body.holder);
  const network = NETWORK_NAMES.has(req.body.network) ? req.body.network : null;
  const phone = cleanPhone(req.body.phone || '');
  if (!holder || !network) return res.status(400).json({ status: 'error', message: 'Bind a mobile-money account first.' });
  // Was a loose length check that let a garbled number (e.g. a stray
  // extra "256" mashed onto the front) straight through to MarzPay's
  // send-money call -- that's exactly how one real payout ended up
  // permanently stuck "processing" with MarzPay erroring on the bad
  // number, which then blocked every OTHER withdrawal too (MarzPay only
  // allows one send-money payout in flight per business account).
  // cleanPhone() itself is strict now; rejected here BEFORE anything is
  // reserved, with a message that says exactly what's wrong.
  if (!phone) return res.status(400).json({ status: 'error', message: 'That mobile-money number is not a valid Uganda number. Use the format 07XXXXXXXX or +2567XXXXXXXX, then bind it again.' });
  let pinJustSet = false;
  try {
    const sett = await getSettings();
    if (amt < sett.minWithdraw) return res.status(400).json({ status: 'error', message: `Minimum cash-out is ${fmtUGX(sett.minWithdraw)}` });
    // PIN gate applies to EVERY withdrawal, mobile money included. A stolen
    // login password (phished via a fake "customer service" DM, the exact
    // pattern behind a run of unauthorized cash-outs) used to be enough on
    // its own to drain a wallet to mobile money -- this endpoint only ever
    // checked the PIN on the bank branch, since bank has no separate "bind"
    // step to gate instead. That asymmetry is the hole: mobile money DOES
    // have a bind step (/bank/save, already PIN-gated), but nothing stopped
    // an authenticated session from cashing out to that already-bound
    // account with nothing beyond the password. Checked before anything is
    // reserved, same as bank.
    const pinCheck = await _payoutPinCheck(userId, req.body.pin, true);
    if (!pinCheck.ok) return res.status(400).json({ status: 'error', code: pinCheck.code, message: pinCheck.message });
    pinJustSet = !!pinCheck.justSet;

    // A second, independent layer beyond the PIN: the mobile-money
    // destination has to actually BE one of this member's saved payout
    // accounts, not just look like valid holder/network/phone fields. The
    // real app UI only ever sends an already-bound account, but nothing
    // server-side used to enforce that -- a direct API call (the exact
    // capability an attacker who already has a stolen password and PIN
    // would use, bypassing the app's own restriction) could redirect a
    // cash-out to ANY number, never bound at all. Bank transfer has no
    // bind step to compare against by design (its PIN gate already covers
    // it, right above), so this only applies to the mobile-money branch.
    if (method === 'mobile_money') {
      const boundSnap = await db.collection('bankAccounts')
        .where('userId', '==', userId).where('network', '==', network).where('phone', '==', phone).limit(1).get();
      if (boundSnap.empty)
        return res.status(400).json({ status: 'error', code: 'UNBOUND_ACCOUNT', message: 'That mobile-money account isn\'t saved to your profile. Bind it in Payout Account first, then try again.' });
    }

    const fee = Math.round(amt * sett.withdrawFeePct / 100);
    const net = amt - fee;
    const ref = await uniqueRef('B');
    let witId;
    await withLock('bal:' + userId, () => db.runTransaction(async t => {
      const uRef = db.collection('users').doc(userId);
      const fresh = await t.get(uRef);
      if (!fresh.exists) throw new Error('User not found');
      if (fresh.data().status === 'banned') { const banErr = new Error('Account suspended. Contact customer service.'); banErr.code = 'BANNED'; throw banErr; }
      // Anti-abuse, admin-toggleable (settings.requireInvestToWithdraw, default
      // required): stops someone registering, taking the welcome bonus, and
      // cashing out without ever buying a product.
      if (sett.requireInvestToWithdraw !== false && (fresh.data().totalInvested || 0) <= 0)
        throw new Error('Purchase at least one plan before you can cash out.');
      const bal = fresh.data().walletBalance || 0;
      if (bal < amt) {
        logSecurityEvent(userId, 'withdraw_insufficient_funds', { attempted: amt, balance: bal });
        throw new Error(`Not enough balance, you have ${fmtUGX(bal)}`);
      }
      // Daily cash-out cap, admin-editable (settings.maxWithdrawalsPerDay).
      // Counted and enforced HERE, inside the same per-user withLock('bal:'+
      // userId) every withdrawal already serialises through — two requests
      // racing to sneak in a 3rd cash-out can never both pass this check,
      // since the second one only runs after the first's count-and-create
      // has already committed. 0 or unset disables the cap entirely.
      const maxPerDay = Number(sett.maxWithdrawalsPerDay) || 0;
      if (maxPerDay > 0) {
        const today = nowStr().date;
        const todaySnap = await t.get(db.collection('withdrawals').where('userId', '==', userId).where('date', '==', today));
        if (todaySnap.size >= maxPerDay)
          throw new Error(`You've reached today's limit of ${maxPerDay} cash-out${maxPerDay === 1 ? '' : 's'}. Try again tomorrow.`);
      }
      const witRef = db.collection('withdrawals').doc();
      witId = witRef.id;
      // Only the wallet is reserved here — totalWithdrawn is credited once an
      // admin actually sends the payout (see /admin/withdraw/process), never
      // at request time, since nothing has left the platform yet.
      t.update(uRef, { walletBalance: FieldValue.increment(-amt) });
      const { date, time } = nowStr();
      const record = { userId, amount: amt, fee, net, method, holder, network, phone, ref, status: 'pending', date, time, createdAt: FieldValue.serverTimestamp() };
      t.set(witRef, record);
      const destDesc = `${holder} (${network})`;
      t.set(db.collection('transactions').doc(), {
        userId, type: 'withdraw', description: `Cash out to ${destDesc}, net ${fmtUGX(net)} after ${sett.withdrawFeePct}% fee, processing`,
        amount: -amt, status: 'pending', date, time, ref, withdrawalId: witRef.id, createdAt: FieldValue.serverTimestamp()
      });
    }));

    // sendAdminPush is the owner's OWN push notification (not shown to the
    // member) -- it's fine, and meant, to say "awaiting approval" here.
    sendWithdrawalPush('New withdrawal request', `${fmtUGX(amt)} cash-out requested (net ${fmtUGX(net)}), awaiting approval`, witId);
    createMemberNotification(userId, 'Withdrawal requested', `${fmtUGX(amt)} cash-out is pending. We will update its status here.`, 'withdrawal', { withdrawalId: witId, reference: ref }).catch(e => console.warn('Withdrawal notification:', e.message));
    res.json({ status: 'success', withdrawalId: witId, reference: ref, net, pinJustSet, message: `Cash-out requested — processing now` });
  } catch (e) {
    res.status(400).json({ status: 'error', code: e.code, message: e.message });
  }
});

// Admin manually approves & sends a pending cash-out via MarzPay. This is the
// gate the owner wants: no withdrawal reaches the gateway until an admin
// acts here. On success the record moves to 'processing' (or straight to
// 'processed' for a sandbox response); on a clean gateway rejection it stays
// 'pending' untouched — no money moved either way, so the admin can just
// retry. Money-safety notes mirror /withdraw/request's old auto-send path:
// the "sending" marker is written BEFORE the gateway call so a crash right
// after marzSendMoney() succeeds can never leave this silently stuck.
// The actual send -- shared by the normal admin-panel button AND the
// push-notification quick-approve action below, so this money-safety logic
// exists in exactly one place. Returns { code, body, meta } instead of
// touching `res` directly; callers decide how to respond/log.
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

    const isBank = wit.method === 'bank';
    // Bank-transfer doesn't take a client-supplied reference (MarzPay
    // generates its own and returns it) -- this local marker exists purely
    // as OUR OWN "an attempt was made" audit trail, written before the
    // gateway call for the same crash-safety reason send-money's
    // marzReference is.
    const sendingMarker = crypto.randomUUID();
    await witRef.update({ status: 'sending', sendingReference: sendingMarker, sendingBy: processedBy, sendingAt: FieldValue.serverTimestamp() });

    // SECURITY/MONEY-SAFETY (found comparing against Chronova's proven
    // /admin/withdraw/process): a network exception here (timeout, dropped
    // connection, malformed response) means we genuinely don't know whether
    // MarzPay received and acted on the send-money request before we lost
    // the response -- that's a real, well-known distributed-systems failure
    // mode, not the same thing as a clean rejection. The OLD code folded
    // this into the same branch as a definitive gateway rejection and
    // reverted the withdrawal straight back to 'pending', inviting an admin
    // retry -- if MarzPay HAD actually received and processed the first
    // request, a retry would send the SAME payout a second time, paying the
    // recipient twice. Chronova's own equivalent deliberately does NOT
    // revert to 'pending' on this ambiguous case; it leaves the record at
    // 'sending' (blocking any further /admin/withdraw/process call, since
    // that requires status 'pending') and lets /admin/integrity surface it
    // for the owner to check directly on MarzPay's own dashboard, rather
    // than guessing. Ported the same distinction here -- identical
    // treatment for the bank-transfer rail.
    let mpData;
    let ambiguous = false;
    try {
      mpData = isBank
        ? await marzBankTransfer({ amount: wit.net, description: 'Withdrawal', bankName: wit.bankName, accountNumber: wit.accountNumber, accountName: wit.accountName, branch: wit.branch })
        : await marzSendMoney({
            amount: wit.net, phone: wit.phone, reference: sendingMarker, description: 'Mobile Money',
            callbackUrl: PUBLIC_URL ? PUBLIC_URL + '/withdraw/callback' : undefined
          });
    } catch (netErr) {
      console.error(`MarzPay ${isBank ? 'bank-transfer' : 'send-money'} network error (ambiguous, NOT reverting to pending):`, netErr.message);
      ambiguous = true;
      mpData = { status: 'error', providerDown: true, message: netErr.message };
    }
    if (ambiguous) {
      return { code: 500, body: { status: 'error', message: 'Lost contact with MarzPay mid-request -- we cannot confirm whether this payout was actually sent. It stays on "Sending" (not pending) so nobody retries it blindly; check this reference on the MarzPay dashboard before doing anything else.', sendingReference: sendingMarker } };
    }
    if (mpData.status !== 'success' && mpData.status !== 'sandbox') {
      // A real, complete HTTP round-trip that MarzPay itself answered with
      // an explicit rejection (validation error, insufficient balance, etc.)
      // -- this one genuinely never moved money, so it's safe to put it back
      // to 'pending' and let the admin retry.
      await witRef.update({ status: 'pending', sendingReference: null, sendingBy: null, sendingAt: null }).catch(() => {});
      return { code: 400, body: { status: 'error', message: marzUserMsg(mpData, 'MarzPay could not send this payout right now. The withdrawal stays pending and untouched. Try again in a moment.') } };
    }
    const sandbox = mpData.status === 'sandbox';
    const updateFields = { status: sandbox ? 'processed' : 'processing', processedBy, processedAt: FieldValue.serverTimestamp() };
    if (isBank) updateFields.marzBankReference = _marzExtractBankTransfer(mpData).reference || sendingMarker;
    else { updateFields.marzReference = sendingMarker; updateFields.marzTxUuid = mpData.data?.transaction?.uuid || null; }
    // Money has already left via MarzPay above -- these two writes used to
    // fire concurrently (Promise.all), so a write that failed on ONLY one of
    // them (a transient M0 hiccup hits one call but not the other, since
    // they're not one atomic transaction) could leave the withdrawal record
    // and the user's totalWithdrawn disagreeing with no way to tell which one
    // actually landed. Sequenced instead: the withdrawal doc (the real
    // source of truth for "was this sent") is written FIRST and awaited on
    // its own, so if IT fails the whole request correctly surfaces as a
    // 500 with nothing silently desynced. totalWithdrawn is a derived
    // per-user statistic, not itself money -- if it alone fails to write
    // after the withdrawal is already correctly marked sent, that's caught
    // here and logged loudly (with everything needed to backfill it by
    // hand) rather than throwing past a payout that genuinely succeeded.
    await witRef.update(updateFields);
    try {
      await db.collection('users').doc(wit.userId).update({ totalWithdrawn: FieldValue.increment(wit.net) });
    } catch (twErr) {
      console.error(`MONEY-SAFETY: totalWithdrawn increment failed AFTER withdrawal ${withdrawalId} was marked sent -- user ${wit.userId} is missing +${wit.net} in their totalWithdrawn stat. Backfill by hand.`, twErr.message);
    }
    try {
      const txSnap = await db.collection('transactions').where('withdrawalId', '==', withdrawalId).limit(1).get();
      if (!txSnap.empty) await txSnap.docs[0].ref.update({ status: sandbox ? 'success' : 'processing' });
    } catch (txErr) { console.warn('Process tx update (non-critical):', txErr.message); }
    const dest = isBank ? `${wit.bankName} · ${wit.accountName}` : wit.phone;
    return {
      code: 200,
      body: { status: 'success', sandbox, message: sandbox ? `Sandbox: withdrawal marked complete, ${fmtUGX(wit.net)} to ${dest}` : `Sending ${fmtUGX(wit.net)} to ${dest}` },
      meta: { amount: wit.net, dest, userId: wit.userId }
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
  const processedBy = req.adminUser?.username || 'owner-key';
  const result = await processWithdrawalCore(withdrawalId, processedBy);
  if (result.code === 200) logAdminAction(req, 'withdrawal_processed', { withdrawalId, ...result.meta });
  res.status(result.code).json(result.body);
});
// Owner-only quick-approve, reachable from a push notification's "Approve"
// action with the admin panel fully closed (no session, no page open) --
// see sendWithdrawalPush and /admin/push/register above for how the
// pushToken+secret pair is issued and delivered. Deliberately does NOT
// accept the master ADMIN_KEY or a login session: this is a narrower,
// single-purpose credential that can only ever reach processWithdrawalCore,
// nothing else on the admin surface, and is revoked the instant the device
// unregisters from push.
app.post('/admin/withdraw/quick-approve', async (req, res) => {
  try {
    const withdrawalId = String(req.body.withdrawalId || '');
    const pushToken = String(req.body.pushToken || '');
    const secret = String(req.body.secret || '');
    if (!withdrawalId || !pushToken || !secret) return res.status(400).json({ status: 'error', message: 'Missing fields' });
    const tokDoc = await db.collection('adminPushTokens').doc(pushToken).get();
    const tok = tokDoc.exists ? tokDoc.data() : null;
    if (!tok || tok.role !== 'owner' || !tok.quickApproveSecret || !safeEqual(String(tok.quickApproveSecret), secret))
      return res.status(401).json({ status: 'error', message: 'Unauthorized' });
    const result = await processWithdrawalCore(withdrawalId, 'owner (quick-approve)');
    if (result.code === 200) {
      logAdminAction({ adminUser: { username: 'owner (quick-approve)', role: 'owner' }, ip: req.ip },
        'withdrawal_processed', { withdrawalId, via: 'push', ...result.meta });
    }
    res.status(result.code).json(result.body);
  } catch (e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// Read-only re-check of a still-processing withdrawal against MarzPay's own
// records — never moves money, only reports the gateway's verdict so the
// admin can tell a real outage apart from something worth investigating.
app.post('/admin/withdraw/verify', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const withdrawalId = String(req.body.withdrawalId || '');
  if (!withdrawalId) return res.status(400).json({ status: 'error', message: 'withdrawalId required' });
  try {
    const snap = await db.collection('withdrawals').doc(withdrawalId).get();
    if (!snap.exists) return res.status(404).json({ status: 'error', message: 'Withdrawal not found' });
    const w = snap.data();
    const isBank = w.method === 'bank';
    const gatewayRef = isBank ? w.marzBankReference : w.marzTxUuid;
    if (!gatewayRef)
      return res.json({ status: 'success', ourStatus: w.status, marzStatus: 'no_reference', message: 'This payout never reached MarzPay (no gateway reference). Nothing was sent.' });
    const marzStatus = isBank ? await marzGetBankTransferStatus(gatewayRef) : await marzGetSendStatus(gatewayRef);
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
    const isBank = wit.method === 'bank';
    const gatewayRef = isBank ? wit.marzBankReference : wit.marzTxUuid;
    if (!gatewayRef) return res.json({ status: 'success', state: 'processing' });

    const marzStatus = isBank ? await marzGetBankTransferStatus(gatewayRef) : await marzGetSendStatus(gatewayRef);
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
        // STATUS-BEFORE-REFUND: db.js's runTransaction replays these writes
        // one at a time with no rollback, and the guard just above is
        // `status !== 'processing'`. Flipping the status first means a
        // failure before the credit lands leaves the refund un-paid but
        // retryable, instead of paid-but-still-'processing' — which every
        // retry of this path (client poll, webhook, reconciler) would refund
        // again.
        t.update(witSnap.ref, { status: 'declined', failureReason: isBank ? 'Bank transfer failed at the provider' : 'Payout failed at the mobile-money provider' });
        t.update(uRef, { walletBalance: FieldValue.increment(fresh.data().amount), totalWithdrawn: FieldValue.increment(-fresh.data().net) });
      }));
      return res.json({ status: 'success', state: 'declined' });
    }
    res.json({ status: 'success', state: 'processing' });
  } catch (e) {
    console.error('Withdraw status error:', e.message);
    res.status(500).json({ status: 'error', message: 'Could not check cash-out status' });
  }
});

// SECURITY (same fix as /deposit/callback, see its comment for the full
// exploit trail and the reference-matching self-heal): the uuid trusted
// outright is ONLY EVER `wit.marzTxUuid` — captured from OUR OWN outbound
// marzSendMoney() call. A uuid the webhook supplies instead is only ever
// accepted once its OWN live-reported `reference` is confirmed to match
// this exact withdrawal's marzReference — never on a bare status alone,
// which only proves some real transaction happened, not that it's this one.
app.post('/withdraw/callback', async (req, res) => {
  res.status(200).json({ status: 'ok' });
  try {
    const body = req.body || {};
    const reference = body.data?.reference || body.reference || body.data?.transaction?.reference || body.transaction?.reference;
    if (!reference) return;
    let rawStatus = String(
      body.data?.transaction?.status || body.transaction?.status || body.data?.status || body.status || ''
    ).toLowerCase();
    if (!rawStatus) rawStatus = marzEventTypeFallback(body.event_type); // disbursement.completed/failed
    const isSuccess = SUCCESS_STATUSES.has(rawStatus);
    const isFailed  = FAILED_STATUSES.has(rawStatus);
    if (!isSuccess && !isFailed) return;
    const witSnap = await db.collection('withdrawals').where('marzReference', '==', reference).limit(1).get();
    if (witSnap.empty) return;
    const doc = witSnap.docs[0];
    const wit = doc.data();
    if (wit.status !== 'processing') return; // already resolved — never downgrade
    const webhookUuid = body.data?.transaction?.uuid || body.transaction?.uuid || body.data?.uuid || null;

    if (isSuccess) {
      // FIXED real bug, pattern confirmed against Chronova's own proven
      // /withdraw/callback: a payout's own success webhook arrived correctly
      // (confirmed against a real production payload — MarzPay POSTs
      // event_type:"disbursement.completed" with transaction.status,
      // transaction.reference, transaction.uuid all present), but this used
      // to REQUIRE an independent live re-check against MarzPay's GET
      // /send-money/{uuid} to succeed before trusting it -- and treated that
      // check FAILING (network hiccup, timeout, anything) as equivalent to
      // the payout being unconfirmed. That's backwards: a failed check is
      // not evidence of anything, it's just a failed check. It left a
      // genuinely-completed payout stuck on "Processing" indefinitely
      // despite the correct webhook already having arrived.
      //
      // Now: the live check is still attempted, best-effort, as an EXTRA
      // layer of defense — but it only VETOES the webhook if it actually
      // comes back with a real, contradicting status. An empty/failed check
      // is silently ignored, not treated as a rejection. This is strictly
      // safer than dropping the check entirely: a forged success webhook is
      // still caught whenever the live check happens to work and disagrees,
      // while a working payout is never blocked by the check being broken.
      // Trusting the webhook at all still rests on it having matched
      // `marzReference` in the query above (our own crypto.randomUUID(),
      // set only by us) — genuine correspondence to THIS exact withdrawal,
      // not a guess. Marking 'processed' also never moves money by itself:
      // the wallet and totalWithdrawn were already updated once, at send
      // time, in /admin/withdraw/process.
      //
      // FAILED is handled differently, below — refunding a withdrawal that
      // actually succeeded WOULD let the recipient collect it twice (their
      // real payout plus a refunded wallet balance), so that path still
      // REQUIRES the independent live re-check to positively confirm
      // failure before any money moves; an unavailable check there means no
      // refund, not a default-safe one either way.
      const uuidForCheck = wit.marzTxUuid || webhookUuid;
      if (uuidForCheck) {
        const liveStatus = await marzGetSendStatus(uuidForCheck); // best-effort — '' on any failure
        if (liveStatus && !SUCCESS_STATUSES.has(liveStatus)) return; // explicit contradiction from a WORKING check — do not trust the webhook
      }
      if (webhookUuid) doc.ref.update({ marzTxUuid: webhookUuid }).catch(() => {});
      await doc.ref.update({ status: 'processed', processedAt: FieldValue.serverTimestamp() }).catch(() => {});
    } else if (isFailed) {
      let uuid = wit.marzTxUuid;
      let tx = null;
      if (uuid) {
        tx = await marzGetSendTx(uuid);
      } else if (webhookUuid) {
        const candidate = await marzGetSendTx(webhookUuid);
        if (candidate.reference && candidate.reference === wit.marzReference) {
          uuid = webhookUuid;
          tx = candidate;
          doc.ref.update({ marzTxUuid: uuid }).catch(() => {});
        }
      }
      if (!uuid || !tx || !FAILED_STATUSES.has(tx.status)) return; // not independently confirmed — never refund on the webhook's word alone
      await withLock('bal:' + wit.userId, () => db.runTransaction(async t => {
        const fresh = await t.get(doc.ref);
        if (!fresh.exists || fresh.data().status !== 'processing') return;
        const uRef = db.collection('users').doc(wit.userId);
        // STATUS-BEFORE-REFUND: db.js's runTransaction replays these writes
        // one at a time with no rollback, and the guard just above is
        // `status !== 'processing'`. Flipping the status first means a
        // failure before the credit lands leaves the refund un-paid but
        // retryable, instead of paid-but-still-'processing' — which every
        // retry of this path (client poll, webhook, reconciler) would refund
        // again.
        t.update(doc.ref, { status: 'declined', failureReason: 'Payout failed at the mobile-money provider' });
        t.update(uRef, { walletBalance: FieldValue.increment(fresh.data().amount), totalWithdrawn: FieldValue.increment(-fresh.data().net) });
      }));
    }
  } catch (e) {
    console.error('Withdraw callback error:', e.message);
  }
});

// ═══════════════════════════════════════════
// PAYOUT SECURITY PIN — guards every place a member can point their money
// somewhere new: binding/removing a mobile-money payout account, and every
// bank-transfer withdrawal (that rail never has a separate "bind" step --
// the bank details are typed fresh into each request -- so the PIN gate
// sits on the request itself instead). Without this, anyone who gets into
// a signed-in session (a shared/stolen phone, a hijacked browser tab) could
// silently redirect future payouts to their own number with no extra
// friction at all.
// ═══════════════════════════════════════════
// A 4-digit PIN is a password with only 10,000 possibilities -- verified
// the exact same way admin passwords are (scryptHash/scryptVerify above:
// salted, one-way, timing-safe compare; the PIN itself is never stored or
// recoverable in plaintext, matching what "encrypted" should actually mean
// for a secret like this), but ALSO needs a hard lockout or it's trivially
// brute-forceable in minutes even against 60/min rate limiting alone.
// Failure count + lock timestamp are persisted on the user doc itself
// (not an in-memory map) so a lockout survives a server restart.
const PAYOUT_PIN_LOCK_MS = 15 * 60 * 1000;
const PAYOUT_PIN_MAX_FAILS = 5;
// allowAutoSetup=true (bind/delete/bank-withdraw): a member with no PIN yet
// has whatever they type here become their PIN, and it authorizes this one
// action in the same step -- no separate mandatory "set up your PIN first"
// screen before their very first bind. allowAutoSetup=false (changing an
// existing PIN) requires one to already exist; there's nothing to change
// from otherwise.
async function _payoutPinCheck(userId, pin, allowAutoSetup) {
  if (!/^\d{4}$/.test(String(pin || '')))
    return { ok: false, code: 'INVALID_PIN', message: 'Enter your 4-digit payout security PIN.' };
  return withLock('pin:' + userId, async () => {
    const uRef = db.collection('users').doc(userId);
    const snap = await uRef.get();
    if (!snap.exists) return { ok: false, code: 'NOT_FOUND', message: 'Account not found' };
    const u = snap.data();
    const now = Date.now();
    if (u.payoutPinLockedUntil && tsMillis(u.payoutPinLockedUntil) > now) {
      const mins = Math.ceil((tsMillis(u.payoutPinLockedUntil) - now) / 60000);
      return { ok: false, code: 'LOCKED', message: `Too many wrong PIN attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.` };
    }
    if (!u.payoutPinHash) {
      if (!allowAutoSetup) return { ok: false, code: 'NO_PIN', message: 'No payout PIN is set yet.' };
      await uRef.update({ payoutPinHash: scryptHash(pin), payoutPinFailCount: 0, payoutPinLockedUntil: null });
      return { ok: true, justSet: true };
    }
    if (!scryptVerify(pin, u.payoutPinHash)) {
      const fails = (u.payoutPinFailCount || 0) + 1;
      const update = { payoutPinFailCount: fails };
      let locked = false;
      if (fails >= PAYOUT_PIN_MAX_FAILS) { update.payoutPinLockedUntil = new Date(now + PAYOUT_PIN_LOCK_MS); update.payoutPinFailCount = 0; locked = true; }
      await uRef.update(update);
      return { ok: false, code: locked ? 'LOCKED' : 'WRONG_PIN', message: locked ? `Too many wrong PIN attempts. Try again in ${PAYOUT_PIN_LOCK_MS / 60000} minutes.` : 'Incorrect PIN.' };
    }
    await uRef.update({ payoutPinFailCount: 0 });
    return { ok: true };
  });
}
// So the client knows whether to show "Create your payout PIN" (first ever
// bind/withdraw) or "Enter your payout PIN" (already set) without guessing.
app.get('/account/payout-pin/status', async (req, res) => {
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const snap = await db.collection('users').doc(userId).get();
    res.json({ status: 'success', hasPayoutPin: !!(snap.exists && snap.data().payoutPinHash) });
  } catch (e) {
    res.status(500).json({ status: 'error', message: 'Could not check PIN status' });
  }
});
app.post('/account/payout-pin/change', async (req, res) => {
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const newPin = String(req.body.newPin || '');
  if (!/^\d{4}$/.test(newPin)) return res.status(400).json({ status: 'error', message: 'New PIN must be exactly 4 digits.' });
  try {
    const check = await _payoutPinCheck(userId, req.body.oldPin, false);
    if (!check.ok) return res.status(400).json({ status: 'error', code: check.code, message: check.message });
    await db.collection('users').doc(userId).update({ payoutPinHash: scryptHash(newPin) });
    res.json({ status: 'success', message: 'Payout PIN changed.' });
  } catch (e) {
    res.status(500).json({ status: 'error', message: 'Could not change the PIN' });
  }
});
// Sets the withdrawal PIN for the first time, right after registration --
// distinct from /account/payout-pin/change (which requires the OLD pin and
// is for an account that already has one). Reuses _payoutPinCheck's own
// allowAutoSetup path unchanged: if no payoutPinHash exists yet, the pin
// supplied here becomes it; if one already exists (e.g. this got called
// twice), it's verified like any other PIN-gated action rather than
// silently overwritten -- a PIN can never be reset without proving you
// already know the current one.
app.post('/account/payout-pin/set', async (req, res) => {
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Please sign in again' });
  try {
    const check = await _payoutPinCheck(userId, req.body.pin, true);
    if (!check.ok) return res.status(400).json({ status: 'error', code: check.code, message: check.message });
    res.json({ status: 'success', justSet: !!check.justSet, message: check.justSet ? 'Withdrawal PIN set' : 'PIN confirmed' });
  } catch (e) {
    res.status(500).json({ status: 'error', message: 'Could not set the PIN' });
  }
});

// ═══════════════════════════════════════════
// BIND BANK CARD
// ═══════════════════════════════════════════
app.post('/bank/save', async (req, res) => {
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const holder = stripHtml(req.body.holder);
  const network = NETWORK_NAMES.has(req.body.network) ? req.body.network : null;
  const phone = cleanPhone(req.body.phone || '');
  if (!holder || !network) return res.status(400).json({ status: 'error', message: 'Fill in all fields' });
  // This is THE bug that put +25625607541000 into a real payout: the old
  // check here was phone.length < 10, which a garbled 14-digit number
  // sailed straight past, got saved as a real payout destination, and
  // later got sent to MarzPay's send-money as-is -- MarzPay choked on it
  // and left that one withdrawal stuck "processing" forever, which then
  // blocked every OTHER pending withdrawal too (MarzPay only allows one
  // send-money payout in flight per business account at a time).
  // cleanPhone() itself now only accepts a real Uganda mobile number
  // (256 + exactly 9 digits, starting with 7) and returns null otherwise,
  // so this is rejected right here, before it's ever saved as a payout
  // destination.
  if (!phone) return res.status(400).json({ status: 'error', message: 'That is not a valid Uganda mobile-money number. Use the format 07XXXXXXXX or +2567XXXXXXXX.' });
  try {
    const uSnap = await db.collection('users').doc(userId).get();
    if (uSnap.exists && uSnap.data().status === 'banned') return res.status(403).json({ status: 'error', code: 'BANNED', message: 'Account suspended. Contact customer service.' });
    // A payout account is exactly the kind of thing an unauthorized
    // session (stolen/shared phone) could silently redirect -- gated the
    // same way a bank rebind would be, right before it's ever saved.
    const pinCheck = await _payoutPinCheck(userId, req.body.pin, true);
    if (!pinCheck.ok) return res.status(400).json({ status: 'error', code: pinCheck.code, message: pinCheck.message });
    await db.collection('bankAccounts').add({ userId, holder, network, phone, createdAt: FieldValue.serverTimestamp() });
    res.json({ status: 'success', pinJustSet: !!pinCheck.justSet });
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
app.post('/bank/delete', async (req, res) => {
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const id = String(req.body.id || '');
  if (!id) return res.status(400).json({ status: 'error', message: 'Missing account id' });
  try {
    const ref = db.collection('bankAccounts').doc(id);
    const snap = await ref.get();
    // Owner check matters here — an id is just a document id, not itself
    // proof this account belongs to the caller; without this any signed-in
    // user could delete anyone else's bound payout account by id.
    if (!snap.exists || snap.data().userId !== userId) return res.status(404).json({ status: 'error', message: 'Account not found' });
    const pinCheck = await _payoutPinCheck(userId, req.body.pin, true);
    if (!pinCheck.ok) return res.status(400).json({ status: 'error', code: pinCheck.code, message: pinCheck.message });
    await ref.delete();
    res.json({ status: 'success', pinJustSet: !!pinCheck.justSet });
  } catch (e) {
    res.status(500).json({ status: 'error', message: 'Could not remove the bank account' });
  }
});

// ═══════════════════════════════════════════
// PROMO CODES
// ═══════════════════════════════════════════
app.post('/redeem', async (req, res) => {
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Please sign in again' });
  // Bounded + shape-checked before it ever touches a query: no raw operator
  // keys survive this (only A-Z0-9 and dashes pass), and stripMongoOperators
  // (global middleware, app.use above) already strips any '$'/'.' key on
  // every request body regardless, so this is defense-in-depth, not the
  // only guard.
  const code = String(req.body.code || '').trim().toUpperCase().slice(0, 32);
  if (!code || !/^[A-Z0-9-]+$/.test(code)) return res.status(400).json({ status: 'error', message: 'Enter a promo code' });
  try {
    // Locked per-CODE (not per user+code) — a shared multi-use code being
    // redeemed by several different users at once must still serialise
    // through one place, or two concurrent redemptions could both read the
    // same usedBy array below maxUses and both slip through.
    await withLock('redeem:' + code, async () => {
      const userSnap = await db.collection('users').doc(userId).get();
      if (!userSnap.exists) return res.status(404).json({ status: 'error', message: 'User not found' });
      if (userSnap.data().status === 'banned') return res.status(403).json({ status: 'error', code: 'BANNED', message: 'Account suspended. Contact customer service.' });
      const codeSnap = await db.collection('promoCodes').where('code', '==', code).limit(1).get();
      if (codeSnap.empty) {
        // A code that doesn't exist at all is the actual "guessing" signal --
        // an already-used or usage-capped code below is a REAL code, not a
        // guess, so those aren't logged here.
        logSecurityEvent(userId, 'giftcode_invalid_attempt', { code });
        return res.status(400).json({ status: 'error', message: "That code isn't valid" });
      }
      const codeDoc = codeSnap.docs[0];
      const cd = codeDoc.data();
      if (cd.active === false) return res.status(400).json({ status: 'error', message: 'This code is no longer active' });
      const usedBy = cd.usedBy || [];
      if (usedBy.indexOf(userId) !== -1) return res.status(400).json({ status: 'error', message: "You've already used this code" });
      if (cd.maxUses && usedBy.length >= cd.maxUses) return res.status(400).json({ status: 'error', message: 'This code has reached its usage limit' });
      const reward = Number(cd.reward) || 0;
      // CLAIM-BEFORE-CREDIT. This used to credit the wallet first and mark the
      // code used second — so if that second write failed (an M0 connection
      // blip is enough), the member saw an error, tapped Redeem again, and got
      // credited a second time off the same code, repeatable indefinitely.
      // Claiming first inverts the failure: a failed claim credits nothing and
      // is safely retryable, and a claim that lands is honoured exactly once.
      await codeDoc.ref.update({ usedBy: FieldValue.arrayUnion(userId) });
      // $addToSet is atomic, so re-reading proves whether THIS claim really
      // landed and whether a concurrent redemption pushed the code past its
      // usage cap — the earlier in-memory check can't see a claim made by
      // another process between the read and the write.
      const claimSnap = await codeDoc.ref.get();
      const claimedBy = (claimSnap.exists && claimSnap.data().usedBy) || [];
      if (claimedBy.indexOf(userId) === -1)
        return res.status(500).json({ status: 'error', message: 'Could not redeem this code' });
      if (cd.maxUses && claimedBy.length > cd.maxUses) {
        await codeDoc.ref.update({ usedBy: FieldValue.arrayRemove(userId) }).catch(() => {});
        return res.status(400).json({ status: 'error', message: 'This code has reached its usage limit' });
      }
      await db.collection('users').doc(userId).update({ walletBalance: FieldValue.increment(reward) });
      await db.collection('promoRedemptions').add({ userId, code, reward, createdAt: FieldValue.serverTimestamp() });
      const { date, time } = nowStr();
      await db.collection('transactions').add({
        userId, type: 'promocode', description: `Promo code redeemed: ${code}`,
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
    const page = list.slice(0, 100);
    // Same live-rename treatment as GET /investments: 'Bought X' and
    // 'X daily cashback' descriptions were written with the product's name
    // at that moment, so a later admin rename never showed up here even
    // though it now does on the running plan itself. Rebuilt from the
    // CURRENT product name (looked up via each row's investmentId -> its
    // investment's tierKey), never by guessing/replacing text inside the
    // old stored string. Anything without a resolvable investmentId (a
    // deleted investment, or a transaction type that was never
    // product-related) just keeps its original description untouched.
    const invIds = [...new Set(page.filter(t => t.investmentId && (t.type === 'investment' || t.type === 'cashback')).map(t => t.investmentId))];
    if (invIds.length) {
      const [invDocs, products] = await Promise.all([
        Promise.all(invIds.map(id => db.collection('investments').doc(id).get())),
        getProducts()
      ]);
      const tierKeyByInvId = new Map();
      invDocs.forEach((d, i) => { if (d.exists) tierKeyByInvId.set(invIds[i], d.data().tierKey); });
      const nameByTierKey = new Map(products.map(p => [p.key, p.name]));
      page.forEach(t => {
        if (!t.investmentId) return;
        const liveName = nameByTierKey.get(tierKeyByInvId.get(t.investmentId));
        if (!liveName) return;
        if (t.type === 'investment') t.description = `Bought ${liveName}`;
        else if (t.type === 'cashback') t.description = `${liveName} daily cashback`;
      });
    }
    res.json({ status: 'success', transactions: page });
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
app.get('/admin/admins/list', async (req, res) => {
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
    // Clear the NAME wherever it's stamped as "who did this" -- the
    // Withdrawals list, the Analytics staff table (computed live off these
    // same fields, so this alone is enough to drop them from it), and the
    // Audit Log -- while leaving the underlying record completely intact
    // (status, amount, processedAt/declinedAt). That's the actual ask: no
    // lingering name once someone's removed, but a MEMBER's own withdrawal
    // history and running balance must never be corrupted by staff
    // turnover -- /admin/integrity recomputes every balance straight off
    // these same transaction/withdrawal records.
    const clearField = async (collection, field) => {
      const snap = await db.collection(collection).where(field, '==', username).get();
      await Promise.all(snap.docs.map(d => d.ref.update({ [field]: null })));
      return snap.docs.length;
    };
    const [processedCleared, declinedCleared, auditCleared] = await Promise.all([
      clearField('withdrawals', 'processedBy'),
      clearField('withdrawals', 'declinedBy'),
      clearField('adminAuditLog', 'actor'),
    ]);
    logAdminAction(req, 'admin_deleted', { username, nameStampsCleared: { processedCleared, declinedCleared, auditCleared } });
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
  try { res.json({ status: 'success', settings: await getSettings() }); }
  catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
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
app.get('/admin/banners', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const overrides = await getBannerOverrides();
    const banners = {};
    for (const k of BANNER_KEYS) banners[k] = overrides[k] || null;
    res.json({ status: 'success', banners });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/banners/set', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const key = String(req.body.key || '');
  const image = String(req.body.image || '');
  if (!BANNER_KEYS.has(key)) return res.status(400).json({ status: 'error', message: 'Unknown banner slot' });
  if (!/^data:image\/(png|jpe?g|webp|gif);base64,/.test(image))
    return res.status(400).json({ status: 'error', message: 'Upload a PNG, JPEG, WEBP or GIF image' });
  if (image.length > BANNER_MAX_LEN)
    return res.status(400).json({ status: 'error', message: 'Image is too large, please use a smaller file (~2MB max)' });
  try {
    await db.collection('banners').doc('main').set({ [key]: image }, { merge: true });
    _bannersCacheTs = 0;
    logAdminAction(req, 'banner_set', { key });
    res.json({ status: 'success' });
  } catch (e) {
    res.status(500).json({ status: 'error', message: 'Could not save this banner' });
  }
});
app.post('/admin/banners/clear', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const key = String(req.body.key || '');
  if (!BANNER_KEYS.has(key)) return res.status(400).json({ status: 'error', message: 'Unknown banner slot' });
  try {
    await db.collection('banners').doc('main').update({ [key]: FieldValue.delete() });
    _bannersCacheTs = 0;
    logAdminAction(req, 'banner_cleared', { key });
    res.json({ status: 'success' });
  } catch (e) {
    res.status(500).json({ status: 'error', message: 'Could not revert this banner' });
  }
});
app.get('/admin/products', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try { res.json({ status: 'success', products: await getProducts() }); }
  catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/products/save', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const list = Array.isArray(req.body.products) ? req.body.products : [];
    const batch = db.batch();
    // `order` is preserved from the submitted product itself when given
    // (the admin form always sends one) — indexing by array position would
    // stamp every product 0 whenever only a single product is saved at a
    // time, which is the normal case here.
    // `deleted:false` clears any earlier soft-delete tombstone on this key
    // (see /admin/products/delete) so re-saving a previously-deleted
    // product actually brings it back instead of the merge silently
    // reviving the old tombstone flag.
    list.forEach((p, i) => batch.set(db.collection('products').doc(p.key),
      Object.assign({}, p, { order: p.order != null ? Number(p.order) : i, deleted: false }), { merge: true }));
    await batch.commit();
    _productsCacheTs = 0;
    logAdminAction(req, 'products_saved', { count: list.length });
    res.json({ status: 'success' });
  } catch (e) {
    res.status(500).json({ status: 'error', message: 'Could not save products' });
  }
});
// Soft-delete: writes a tombstone rather than physically removing the doc.
// getProducts() drops any doc with deleted:true and does NOT fall back to
// its DEFAULT_PRODUCTS entry — a hard delete on a default product's key
// would otherwise just resurrect it right back on the very next read, since
// getProducts() fills in any key it's never seen a saved doc for.
app.post('/admin/products/delete', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const key = String(req.body.key || '');
  if (!key) return res.status(400).json({ status: 'error', message: 'key required' });
  try {
    await db.collection('products').doc(key).set({ key, deleted: true }, { merge: false });
    _productsCacheTs = 0;
    logAdminAction(req, 'product_deleted', { key });
    res.json({ status: 'success' });
  } catch (e) {
    res.status(500).json({ status: 'error', message: 'Could not delete this product' });
  }
});
app.post('/admin/products/clear', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const snap = await db.collection('products').get();
    let removed = 0;
    for (const d of snap.docs) { await d.ref.delete(); removed++; }
    _productsCacheTs = 0;
    logAdminAction(req, 'products_cleared', { removed });
    res.json({ status: 'success', removed });
  } catch (e) {
    res.status(500).json({ status: 'error', message: 'Could not clear products' });
  }
});
// A saved product doc (from any earlier per-product edit) permanently
// overrides DEFAULT_PRODUCTS for that key — so bumping the code-level
// pricing table (e.g. the 20x -> 25x rate change) silently does nothing
// for any tier that was ever individually saved before, even though a
// never-touched tier picks the new numbers up immediately. This walks
// every one of the 10 built-in keys and, ONLY for ones with an existing
// saved doc, overwrites just price/cycle/expectedReturn back to the
// current DEFAULT_PRODUCTS values — every other admin customization on
// that doc (custom image, active/comingSoon, order, name) is left
// completely untouched. A never-saved tier is already correct and is
// skipped entirely (nothing to sync).
app.post('/admin/products/sync-pricing', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const snap = await db.collection('products').get();
    const saved = new Map(snap.docs.map(d => [d.id, d.data()]));
    const batch = db.batch();
    let synced = 0;
    const keys = [];
    for (const def of DEFAULT_PRODUCTS) {
      const existing = saved.get(def.key);
      if (!existing || existing.deleted) continue;
      const alreadyMatches = existing.price === def.price && existing.cycle === def.cycle && existing.expectedReturn === def.expectedReturn;
      if (alreadyMatches) continue;
      batch.set(db.collection('products').doc(def.key),
        { price: def.price, cycle: def.cycle, expectedReturn: def.expectedReturn }, { merge: true });
      synced++; keys.push(def.key);
    }
    if (synced) await batch.commit();
    _productsCacheTs = 0;
    logAdminAction(req, 'products_pricing_synced', { synced, keys });
    res.json({ status: 'success', synced, keys });
  } catch (e) {
    res.status(500).json({ status: 'error', message: 'Could not sync product pricing' });
  }
});

// ═══════════════════════════════════════════
// ADMIN — USERS (any admin can view; wallet credit/debit/ban/reset/delete
// are owner-only — the same class of irreversible, user-harming action as
// minting gift codes)
// ═══════════════════════════════════════════
app.get('/admin/users', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const snap = await db.collection('users').limit(10000).get();
    const users = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json({ status: 'success', users, count: users.length });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
// Rebuilds every user's deposit/earning totals straight from the transaction
// ledger — the source of truth — rather than trusting whatever incremental
// counters have drifted to over time. Never touches walletBalance itself
// (that's real money in flight, not a derived stat), only the read-only
// summary fields the dashboard/analytics/Team screen show. Also rebuilds the
// teamL1/L2/L3Count fields straight from the live referredBy graph — these
// used to only ever be incremented at registration time (L3 wasn't even
// incremented at all, only ever decremented on delete), so any account that
// existed before that fix, or drifted for any other reason, is corrected here.
app.get('/admin/users/recount', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const [txSnap, invSnap] = await Promise.all([
      db.collection('transactions').limit(200000).get(),
      db.collection('investments').limit(200000).get(),
    ]);
    const totals = {}; // userId -> { deposited, earned }
    const checkinDays = {}; // userId -> Set of 'YYYY-MM-DD' EAT day keys
    txSnap.forEach(d => {
      const t = d.data();
      if (!t.userId) return;
      const row = totals[t.userId] || (totals[t.userId] = { deposited: 0, earned: 0 });
      if (t.type === 'deposit') row.deposited += Number(t.amount) || 0;
      else if (t.type === 'cashback') row.earned += Number(t.amount) || 0;
      if (t.type === 'checkin') (checkinDays[t.userId] || (checkinDays[t.userId] = new Set())).add(eatDayKey(t.createdAt));
    });
    // totalInvested is a plain cumulative counter (never derived server-side
    // from the investments themselves) -- an old code path that once did
    // naive JS `+=` on a field that had ever been stored as a STRING (a
    // manual edit, or a pre-fix write) doesn't throw, it silently
    // CONCATENATES: "30000" + 30000 becomes the string "3000030000",
    // which then gets stored and read back as the very real-looking but
    // wildly wrong number 3,000,030,000. /invest/create itself is already
    // hardened against this (Number()-coerces both sides before writing),
    // so it can't happen again going forward -- this repairs whatever is
    // ALREADY sitting wrong in the database from before that fix, the same
    // way the streak repair below fixes stale streaks. Each investment
    // record's own `amount` is written once at purchase time and never
    // mutated afterward, so summing them is the authoritative total
    // regardless of what the corrupted counter field says.
    const investedByUser = {};
    invSnap.forEach(d => {
      const inv = d.data();
      if (!inv.userId) return;
      investedByUser[inv.userId] = (investedByUser[inv.userId] || 0) + (Number(inv.amount) || 0);
    });
    const usersSnap = await db.collection('users').limit(10000).get();
    const referredByMap = {}; // userId -> their own referredBy
    usersSnap.forEach(d => { referredByMap[d.id] = d.data().referredBy || null; });
    const teamCounts = {}; // userId -> { l1, l2, l3 }
    const bump = (id, field) => { if (!id) return; (teamCounts[id] || (teamCounts[id] = { l1: 0, l2: 0, l3: 0 }))[field]++; };
    Object.keys(referredByMap).forEach(uid => {
      const l1Id = referredByMap[uid];
      if (!l1Id) return;
      bump(l1Id, 'l1');
      const l2Id = referredByMap[l1Id];
      if (l2Id && l2Id !== l1Id) {
        bump(l2Id, 'l2');
        const l3Id = referredByMap[l2Id];
        if (l3Id && l3Id !== l2Id && l3Id !== l1Id) bump(l3Id, 'l3');
      }
    });
    const batch = db.batch();
    let updated = 0, streaksFixed = 0, investedFixed = 0;
    usersSnap.forEach(d => {
      const u = d.data();
      const row = totals[d.id] || { deposited: 0, earned: 0 };
      const team = teamCounts[d.id] || { l1: 0, l2: 0, l3: 0 };
      const fields = {
        totalDeposited: row.deposited, totalEarned: row.earned,
        teamL1Count: team.l1, teamL2Count: team.l2, teamL3Count: team.l3
      };
      // Only ever WRITE a corrected streak/lastCheckin when the ledger-true
      // value actually differs from what's stored -- keeps this a genuine
      // "only touch what's actually wrong" reconciliation, not a blanket
      // rewrite, and streaksFixed reports exactly how many accounts really
      // had a stale/incorrect value.
      const real = computeCheckinStreak(checkinDays[d.id] || new Set());
      if (real.streak !== (u.checkinStreak || 0) || real.lastCheckin !== (u.lastCheckin || null)) {
        fields.checkinStreak = real.streak;
        fields.lastCheckin = real.lastCheckin;
        streaksFixed++;
      }
      // Same "only touch what's actually wrong" treatment for totalInvested
      // -- see the corruption explanation above. Never touches walletBalance
      // or any investment/payout record, purely a display/analytics counter.
      const realInvested = investedByUser[d.id] || 0;
      if (realInvested !== (Number(u.totalInvested) || 0)) {
        fields.totalInvested = realInvested;
        investedFixed++;
      }
      batch.update(d.ref, fields);
      updated++;
    });
    await batch.commit();
    logAdminAction(req, 'users_recounted', { updated, streaksFixed, investedFixed });
    res.json({ status: 'success', updated, streaksFixed, investedFixed });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
// Read-only sweep for real money-safety problems: negative balances, the same
// payment reference credited more than once, a wallet that no longer matches
// what its own transaction ledger says it should, and withdrawals stuck
// without a usable gateway reference or left pending too long for an admin
// to have missed. Never writes anything — it only reports what it finds so
// an admin can decide what to do about it.
app.get('/admin/integrity', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const [usersSnap, txSnap, witSnap, depSnap, invSnap] = await Promise.all([
      db.collection('users').limit(10000).get(),
      db.collection('transactions').limit(200000).get(),
      db.collection('withdrawals').limit(10000).get(),
      db.collection('pendingDeposits').limit(10000).get(),
      db.collection('investments').limit(200000).get(),
    ]);
    const alerts = [];
    const ledgerByUser = {};
    const refSeen = {}; // `${userId}::${ref}` -> count, only for money-crediting types
    txSnap.forEach(d => {
      const t = d.data();
      if (!t.userId) return;
      ledgerByUser[t.userId] = (ledgerByUser[t.userId] || 0) + (Number(t.amount) || 0);
      if (t.ref && (t.type === 'deposit' || t.type === 'promocode')) {
        const key = t.userId + '::' + t.ref;
        refSeen[key] = (refSeen[key] || 0) + 1;
      }
    });
    // See /admin/users/recount for the full story: totalInvested is a plain
    // counter, and an old code path that once did naive JS `+=` on a field
    // that had ever been stored as a STRING would silently CONCATENATE
    // instead of add ("30000" + 30000 -> the string "3000030000", read back
    // as a very real-looking but wildly wrong number). Flagged here so it
    // shows up in a routine audit, not just when an admin happens to
    // notice an absurd number on a user's detail page.
    const investedByUser = {};
    invSnap.forEach(d => {
      const inv = d.data();
      if (!inv.userId) return;
      investedByUser[inv.userId] = (investedByUser[inv.userId] || 0) + (Number(inv.amount) || 0);
    });
    Object.entries(refSeen).forEach(([key, times]) => {
      if (times > 1) {
        const [userId, ref] = key.split('::');
        alerts.push({ kind: 'duplicate_credit', userId, ref, times });
      }
    });
    const now = Date.now();
    usersSnap.forEach(d => {
      const u = d.data();
      const bal = Number(u.walletBalance) || 0;
      if (bal < 0) alerts.push({ kind: 'negative_balance', userId: d.id, phone: u.phone, balance: bal });
      const ledger = ledgerByUser[d.id] || 0;
      const diff = Math.round(bal - ledger);
      if (Math.abs(diff) > 1) alerts.push({ kind: 'balance_mismatch', userId: d.id, phone: u.phone, balance: bal, ledger, diff });
      const realInvested = investedByUser[d.id] || 0;
      const storedInvested = Number(u.totalInvested) || 0;
      if (realInvested !== storedInvested)
        alerts.push({ kind: 'invested_mismatch', userId: d.id, phone: u.phone, stored: storedInvested, real: realInvested });
      // /account/create-profile deliberately never rejects a phone that
      // doesn't reduce to a clean Uganda mobile number (it's this person's
      // already-working Firebase login identity, not the money-moving path
      // -- see the comment there) -- but that same leniency means a typo at
      // signup (a dropped digit, stray characters) silently becomes a
      // permanent, unsearchable phone with no format an admin can recognize
      // or match against. Surfaced here so it's found by a sweep, not by a
      // member complaining their referrer can't locate them.
      if (u.phone && !cleanPhone(u.phone)) alerts.push({ kind: 'phone_malformed', userId: d.id, phone: u.phone });
      // A profile that exists but never finished /register (no referral
      // code assigned, no welcome bonus, invisible to any referrer's team)
      // -- usually a create-profile that succeeded followed by a /register
      // call that failed or was never retried (a dropped connection, a
      // maintenance-mode window). Given an hour's grace so someone mid-
      // signup right now isn't flagged.
      if (!u.registrationDone && (now - tsMillis(u.createdAt)) / 3600000 > 1)
        alerts.push({ kind: 'registration_incomplete', userId: d.id, phone: u.phone, hours: Math.round((now - tsMillis(u.createdAt)) / 3600000) });
    });
    witSnap.forEach(d => {
      const w = d.data();
      const ageHours = (now - tsMillis(w.createdAt)) / 3600000;
      if (w.status === 'processing' && !w.marzTxUuid)
        alerts.push({ kind: 'withdrawal_no_gateway_ref', userId: w.userId, withdrawalId: d.id, amount: w.amount, hours: Math.round(ageHours) });
      // A payout WITH a gateway reference that's still 'processing' after a
      // generous window past the callback/30s-reconciler/on-demand-sync all
      // having had many chances to settle it is exactly the failure mode
      // that left a real, confirmed-arrived payout stuck indefinitely with
      // no visible trace of anything being wrong -- surfaced here now so it
      // gets found without the member (or owner) having to notice and ask.
      // Tap Verify (shows MarzPay's real status) then Mark Sent if
      // confirmed, on the Withdrawals tab.
      else if (w.status === 'processing' && w.marzTxUuid && ageHours > 0.25)
        alerts.push({ kind: 'withdrawal_processing_stuck', userId: w.userId, withdrawalId: d.id, amount: w.amount, hours: Math.round(ageHours * 10) / 10 });
      else if (w.status === 'pending' && ageHours > 48)
        alerts.push({ kind: 'withdrawal_stuck', userId: w.userId, withdrawalId: d.id, amount: w.amount, hours: Math.round(ageHours) });
      // A withdrawal left at 'sending' means /admin/withdraw/process lost
      // contact with MarzPay mid-request (network exception, not a clean
      // rejection) and deliberately did NOT revert it to 'pending' -- doing
      // that would invite a retry that could pay the recipient twice if
      // MarzPay actually received the first request. Report-only, same as
      // Chronova's equivalent: the owner checks this reference on MarzPay's
      // own dashboard directly rather than the server guessing.
      else if (w.status === 'sending' && (now - tsMillis(w.sendingAt || w.createdAt)) / 60000 >= 2)
        alerts.push({ kind: 'withdrawal_stuck_sending', userId: w.userId, withdrawalId: d.id, amount: w.amount, reference: w.sendingReference || null, minutes: Math.round((now - tsMillis(w.sendingAt || w.createdAt)) / 60000) });
    });
    // A deposit left at 'initiating' means /deposit/marzpay never got a
    // usable response from MarzPay's collect-money call either (same
    // ambiguous-network-failure window, collection side) -- the member may
    // genuinely have been charged. Report-only, same reasoning as above.
    depSnap.forEach(d => {
      const p = d.data();
      if (p.status !== 'initiating') return;
      const ageMin = (now - tsMillis(p.createdAt)) / 60000;
      if (ageMin >= 2)
        alerts.push({ kind: 'deposit_stuck_initiating', userId: p.userId, depositId: d.id, amount: p.amount, reference: p.marzReference || null, minutes: Math.round(ageMin) });
    });
    const phones = {}; usersSnap.forEach(u => { phones[u.id] = u.data().phone || ''; });
    alerts.forEach(a => { if (a.userId && !a.phone) a.phone = phones[a.userId] || a.userId; });
    res.json({ status: 'success', usersChecked: usersSnap.size, healthy: alerts.length === 0, alertCount: alerts.length, alerts, ranAt: new Date().toISOString() });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/user/detail', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ status: 'error', message: 'userId required' });
  try {
    const [snap, invSnap, txSnap, bankSnap] = await Promise.all([
      db.collection('users').doc(userId).get(),
      db.collection('investments').where('userId', '==', userId).limit(50).get(),
      db.collection('transactions').where('userId', '==', userId).limit(50).get(),
      db.collection('bankAccounts').where('userId', '==', userId).get(),
    ]);
    if (!snap.exists) return res.status(404).json({ status: 'error', message: 'User not found' });
    const investments = invSnap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => tsMillis(b.createdAt) - tsMillis(a.createdAt));
    const transactions = txSnap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => tsMillis(b.createdAt) - tsMillis(a.createdAt));
    const bankAccounts = bankSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    // The PIN is a one-way scrypt hash of a 4-digit value on purpose -- it
    // can't be "shown" to admin, only reset (see /admin/user/reset-payout-pin
    // below). Sending the raw hash here would let anyone with admin-panel
    // access offline-brute-force it (10,000 combinations) with none of the
    // 5-attempt/15-minute lockout that protects it online.
    const userData = snap.data();
    const hasPayoutPin = !!userData.payoutPinHash;
    delete userData.payoutPinHash;
    res.json({ status: 'success', user: { id: snap.id, ...userData, hasPayoutPin }, investments, transactions, bankAccounts });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
// Admin can never "view" a member's payout PIN -- it's a one-way hash by
// design, same as a login password -- but a locked-out or forgetful member
// still needs a way back in. This clears the PIN entirely (and any lockout
// state), so the very next add/remove/bank-withdraw auto-provisions a fresh
// one from whatever 4 digits that member types, exactly like a brand new
// user who never had a PIN. Owner-only, same trust boundary as a password
// reset.
app.post('/admin/user/reset-payout-pin', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ status: 'error', message: 'userId required' });
  try {
    const uRef = db.collection('users').doc(userId);
    const snap = await uRef.get();
    if (!snap.exists) return res.status(404).json({ status: 'error', message: 'User not found' });
    await uRef.update({ payoutPinHash: null, payoutPinFailCount: 0, payoutPinLockedUntil: null });
    logAdminAction(req, 'payout_pin_reset', { userId });
    res.json({ status: 'success', message: 'Payout PIN cleared. The member sets a new one automatically next time they add/remove a payout account or send a bank-transfer cash-out.' });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
// FIXED BUG: an owner reported a manual admin credit landing TWICE on the
// same user (unclear whether it was a network retry or a double-tap in the
// admin panel -- and it doesn't actually matter which, since neither this
// endpoint nor the panel's Credit button had ANY protection against it).
// Same debounce pattern already used for /deposit/marzpay: the check-and-set
// below runs synchronously with no await in between, so it's safe even
// against two requests landing genuinely back-to-back, not just a slow
// double-click. Paired with a client-side fix (the Credit/Debit buttons
// now disable themselves immediately instead of staying clickable while
// the first request is still in flight).
const _adminCreditDebounce = new Map();
const _adminDebitDebounce = new Map();
app.post('/admin/deposit', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const { userId, amount, note } = req.body;
  const amt = parseFloat(amount || 0);
  if (!userId || !amt) return res.status(400).json({ status: 'error', message: 'userId and amount required' });
  const lastCredit = _adminCreditDebounce.get(userId) || 0;
  if (Date.now() - lastCredit < 10000)
    return res.status(429).json({ status: 'error', message: 'This user was just credited seconds ago. Wait a moment before crediting again, to rule out a double-submit.' });
  _adminCreditDebounce.set(userId, Date.now());
  try {
    const { date, time } = nowStr();
    await db.runTransaction(async t => {
      const uRef = db.collection('users').doc(userId);
      const uSnap = await t.get(uRef);
      if (!uSnap.exists) throw new Error('User not found');
      // Counts toward totalDeposited (and therefore the referrer's Task
      // Center "Level 1 team deposits" milestone via l1TeamDeposits) by
      // deliberate choice — an admin credit is most often standing in for
      // a real payment MarzPay's own gateway declined, so from the
      // member's (and their referrer's) side it should behave exactly
      // like the deposit it's replacing, not vanish from every deposit
      // total. This does mean a staff member with owner-level access could
      // use it to hand a referrer free milestone progress — verifyOwner()
      // already gates this endpoint for exactly that reason (see the
      // owner-only role check), same trust boundary as any other credit.
      t.update(uRef, { walletBalance: FieldValue.increment(amt), totalDeposited: FieldValue.increment(amt) });
      t.set(db.collection('transactions').doc(), {
        userId, type: 'admin_credit', description: note || 'Space8 credit',
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
  const lastDebit = _adminDebitDebounce.get(userId) || 0;
  if (Date.now() - lastDebit < 10000)
    return res.status(429).json({ status: 'error', message: 'This user was just debited seconds ago. Wait a moment before debiting again, to rule out a double-submit.' });
  _adminDebitDebounce.set(userId, Date.now());
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
// Corrects a member's stored profile phone -- the reconciliation half of
// the phone_malformed integrity alert above. Unlike /account/create-profile
// (which deliberately accepts anything, since it's this person's ALREADY-
// WORKING Firebase login identity), this is the owner deliberately fixing a
// bad entry, so it's held to the same strict Uganda-mobile shape as a
// payout number -- no point "fixing" one broken value into another.
// Only touches the Firestore profile field (what search/display use) --
// does NOT rename the member's Firebase Auth email, so they keep logging in
// exactly the way they always have; this alone is what makes them findable
// and correctly attributed to their referrer again.
app.post('/admin/user/set-phone', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ status: 'error', message: 'userId required' });
  const phone = cleanPhone(req.body.phone || '');
  if (!phone) return res.status(400).json({ status: 'error', message: 'Enter a valid Uganda mobile number (07XXXXXXXX or +2567XXXXXXXX).' });
  try {
    const ref = db.collection('users').doc(userId);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ status: 'error', message: 'User not found' });
    const oldPhone = snap.data().phone || '';
    await ref.update({ phone });
    logAdminAction(req, 'user_phone_corrected', { userId, oldPhone, newPhone: phone });
    res.json({ status: 'success', message: `Phone corrected to ${phone}` });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
// Reconciliation for the registration_incomplete integrity alert: a member
// whose profile exists but whose /register call never completed (a dropped
// connection, a maintenance-mode window) -- no referral code, no welcome
// bonus, invisible to whoever actually invited them. This finishes that
// SAME flow server-side through the identical shared
// completeRegistrationCore() the member's own client calls -- not an
// improvised manual credit -- so the result is indistinguishable from a
// normal successful signup, with the exact same protections: the shared
// 'reg:'+userId lock means a member whose app reconnects and retries
// /register on its own at the same moment can never be double-credited by
// this (whichever gets the lock first wins, the other sees registrationDone
// already true and stops), and the idempotent guard means clicking this
// twice is always harmless. referralCode is optional -- exactly like
// self-service registration, some members never had one to begin with.
app.post('/admin/user/complete-registration', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const { userId, referralCode } = req.body;
  if (!userId) return res.status(400).json({ status: 'error', message: 'userId required' });
  try {
    const result = await completeRegistrationCore(userId, referralCode);
    if (result.body?.status === 'success')
      logAdminAction(req, 'registration_completed', {
        userId, referralCode: result.body.referralCode, referrerId: result.body.referrerId, welcomeBonus: result.body.welcomeBonus
      });
    res.status(result.code).json(result.body);
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
// Attaches a referrer to an account AFTER the fact -- the case where
// /admin/user/complete-registration above was already used with no code
// (nobody knew who invited them yet) and the real referrer surfaces later.
// Deliberately narrow: only ever works on an account with NO referrer
// currently set. Changing an ALREADY-correct referral link is a much bigger
// operation (it would mean reversing commission already paid to the old
// upline) and isn't what this is for -- rejected outright instead of
// guessed at.
//
// Reuses existing, already-proven pieces rather than inventing new money
// logic:
//   - the same L1/L2/L3 team-count chain-walk completeRegistrationCore uses
//   - creditReferralCommission() itself (the exact function /invest/create
//     and the periodic reconciler call) to pay commission on the member's
//     FIRST-EVER investment if they already made one before a referrer
//     existed to credit. That function reads referredBy LIVE (just set
//     below) and is idempotent per (investment, level) via
//     commissionPaidLevels, so calling it here is exactly as safe as the
//     reconciler re-invoking it after a restart -- it can never double-pay,
//     and it naturally does nothing if this member hasn't invested yet
//     (their next purchase, if it's their first, pays normally through the
//     ordinary /invest/create path).
//   - Task Center milestones need NO separate sync step at all:
//     activeL1Count()/l1TeamDeposits() are computed LIVE off referredBy on
//     every read, never cached -- the moment referredBy is set, the
//     referrer's Task Center progress already reflects it.
app.post('/admin/user/attach-referrer', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ status: 'error', message: 'userId required' });
  const code = String(req.body.referralCode || '').trim().toUpperCase();
  if (!code) return res.status(400).json({ status: 'error', message: 'Enter the referrer\'s referral code' });
  try {
    const result = await withLock('reg:' + userId, async () => {
      const userRef = db.collection('users').doc(userId);
      const userSnap = await userRef.get();
      if (!userSnap.exists) return { code: 404, body: { status: 'error', message: 'User not found' } };
      if (userSnap.data().referredBy)
        return { code: 400, body: { status: 'error', message: 'This account already has a referrer -- attaching a different one isn\'t supported here (it would require reversing commission already paid).' } };

      const refSnap = await db.collection('users').where('referralCode', '==', code).limit(1).get();
      if (refSnap.empty) return { code: 400, body: { status: 'error', code: 'BAD_REFERRAL', message: 'That referral code does not exist.' } };
      const referrerId = refSnap.docs[0].id;
      if (referrerId === userId) return { code: 400, body: { status: 'error', code: 'BAD_REFERRAL', message: 'A member cannot be their own referrer.' } };
      // Defensive cycle guard: the normal client flow can never produce a
      // loop (a brand new signup has no downline yet), but this admin tool
      // can attach a referrer to an account that's been active -- possibly
      // referring others of its own -- for a while. Bounded walk, this
      // chain is never more than a handful of hops deep in practice.
      let walk = referrerId, hops = 0;
      while (walk && hops < 25) {
        if (walk === userId) return { code: 400, body: { status: 'error', code: 'BAD_REFERRAL', message: 'That would create a referral loop -- the chosen referrer is already downstream of this member.' } };
        const s = await db.collection('users').doc(walk).get();
        walk = s.exists ? s.data().referredBy : null;
        hops++;
      }

      await userRef.update({ referredBy: referrerId });
      await db.collection('users').doc(referrerId).update({ teamL1Count: FieldValue.increment(1) });
      const l1Snap = await db.collection('users').doc(referrerId).get();
      const l2Id = l1Snap.exists ? l1Snap.data().referredBy : null;
      if (l2Id && l2Id !== referrerId) {
        await db.collection('users').doc(l2Id).update({ teamL2Count: FieldValue.increment(1) });
        const l2Snap = await db.collection('users').doc(l2Id).get();
        const l3Id = l2Snap.exists ? l2Snap.data().referredBy : null;
        if (l3Id && l3Id !== referrerId && l3Id !== l2Id) await db.collection('users').doc(l3Id).update({ teamL3Count: FieldValue.increment(1) });
      }

      let commissionTriggered = false;
      const firstInvSnap = await db.collection('investments').where('userId', '==', userId).where('isFirstInvestment', '==', true).limit(1).get();
      if (!firstInvSnap.empty) {
        const inv = firstInvSnap.docs[0];
        await creditReferralCommission(inv.id, userId, inv.data().amount);
        commissionTriggered = true;
      }

      return { code: 200, body: { status: 'success', referrerId, commissionTriggered } };
    });
    if (result.body?.status === 'success')
      logAdminAction(req, 'referrer_attached', { userId, referrerId: result.body.referrerId, referralCode: code, commissionTriggered: result.body.commissionTriggered });
    res.status(result.code).json(result.body);
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
// Single-user check-in streak reconciliation, on demand from the admin panel.
// /checkin already self-heals on every call, so this is a visibility/control
// tool for the owner rather than the only fix -- it reads the SAME real
// 'checkin' transaction history and reports/writes the true streak right
// now, without waiting for that member's next check-in. Never touches the
// wallet; idempotent (a no-op write when the stored value is already correct).
app.post('/admin/user/reconcile-checkin', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ status: 'error', message: 'userId required' });
  try {
    const userRef = db.collection('users').doc(userId);
    const userSnap = await userRef.get();
    if (!userSnap.exists) return res.status(404).json({ status: 'error', message: 'User not found' });
    const before = { checkinStreak: userSnap.data().checkinStreak || 0, lastCheckin: userSnap.data().lastCheckin || null };

    // See /checkin for why orderBy(desc) is required here, not just limit.
    const ledgerSnap = await db.collection('transactions')
      .where('userId', '==', userId).where('type', '==', 'checkin').orderBy('createdAt', 'desc').limit(500).get();
    const dayKeys = new Set();
    ledgerSnap.forEach(d => dayKeys.add(eatDayKey(d.data().createdAt)));
    const real = computeCheckinStreak(dayKeys);
    const after = { checkinStreak: real.streak, lastCheckin: real.lastCheckin };
    const changed = before.checkinStreak !== after.checkinStreak || before.lastCheckin !== after.lastCheckin;
    if (changed) await userRef.update({ checkinStreak: after.checkinStreak, lastCheckin: after.lastCheckin });

    logAdminAction(req, 'checkin_reconciled', { userId, before, after, changed });
    res.json({ status: 'success', before, after, changed });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
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
    const dayMap = {};
    rows.forEach(r => {
      r.accountPhone = phones[r.userId] || '';
      counts[r.status || 'unknown'] = (counts[r.status || 'unknown'] || 0) + 1;
      if (r.status === 'matched') {
        const { day } = eatParts(r.createdAt);
        const row = dayMap[day] || (dayMap[day] = { day, count: 0, amount: 0 });
        row.count++; row.amount += Number(r.amount) || 0;
      }
    });
    const processedByDay = Object.values(dayMap).sort((a, b) => a.day < b.day ? -1 : 1);
    const processedAmount = processedByDay.reduce((s, d) => s + d.amount, 0);
    res.json({ status: 'success', deposits: rows, counts, total: rows.length, processedByDay, processedAmount });
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
    // A deposit flagged needsManualCredit is already 'matched' — creditDeposit()
    // claims that status BEFORE crediting so nothing can ever re-credit it
    // automatically — but its wallet write failed, so the member was never
    // actually paid. That is the one case where a 'matched' deposit still owes
    // money, and without this branch the old "Already credited" short-circuit
    // below would strand it with no recovery path at all.
    if (snap.data().status === 'matched' && snap.data().needsManualCredit === true) {
      let recovered = false;
      await withLock('dep:' + depositId, async () => {
        const fresh = await db.collection('pendingDeposits').doc(depositId).get();
        if (!fresh.exists || fresh.data().needsManualCredit !== true) return; // another admin already recovered it
        const amt = Number(fresh.data().amount) || 0;
        // Clear the flag first so two admins double-clicking can't both pay,
        // then restore it if the credit itself fails so it stays recoverable.
        await fresh.ref.update({ needsManualCredit: false });
        try {
          await db.collection('users').doc(fresh.data().userId).update({
            walletBalance: FieldValue.increment(amt), totalDeposited: FieldValue.increment(amt)
          });
        } catch (creditErr) {
          await fresh.ref.update({ needsManualCredit: true }).catch(() => {});
          throw creditErr;
        }
        const { date, time } = nowStr();
        await db.collection('transactions').add({
          userId: fresh.data().userId, type: 'deposit', description: 'Added funds to wallet',
          amount: amt, status: 'success', date, time, ref: fresh.data().ref,
          createdAt: FieldValue.serverTimestamp()
        });
        recovered = true;
      });
      if (!recovered) return res.json({ status: 'success', message: 'Already credited' });
      logAdminAction(req, 'deposit_manual_credit_recovered', { depositId, amount: snap.data().amount });
      return res.json({ status: 'success', message: `Credited ${fmtUGX(snap.data().amount)} to the user` });
    }
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
    const dayMap = {};
    rows.forEach(w => {
      w.accountPhone = phones[w.userId] || '';
      counts[w.status] = (counts[w.status] || 0) + 1;
      if (w.status === 'processed') {
        const { day } = eatParts(w.createdAt);
        const row = dayMap[day] || (dayMap[day] = { day, count: 0, amount: 0 });
        row.count++; row.amount += Number(w.net) || 0;
      }
    });
    const processedByDay = Object.values(dayMap).sort((a, b) => a.day < b.day ? -1 : 1);
    const processedAmount = processedByDay.reduce((s, d) => s + d.amount, 0);
    res.json({ status: 'success', withdrawals: rows, counts, total: rows.length, processedByDay, processedAmount });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
// Reject a withdrawal and refund it — either still 'pending' (never sent,
// so only the reserved wallet balance is returned) or 'processing' (a send
// was attempted, so totalWithdrawn is reversed too). Same lock key as
// /admin/withdraw/process and the client status-poll/reconciler refund
// paths, so this can never double-refund alongside any of them.
app.post('/admin/withdraw/reject', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const witId = String(req.body.withdrawalId || '');
  if (_withdrawInFlight.has(witId))
    return res.status(409).json({ status: 'error', message: 'This withdrawal is being sent right now. Check the list in a moment.' });
  _withdrawInFlight.add(witId);
  try {
    const ref = db.collection('withdrawals').doc(witId);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ status: 'error', message: 'Withdrawal not found' });
    const w = snap.data();
    if (w.status !== 'pending' && w.status !== 'processing')
      return res.status(400).json({ status: 'error', message: `Only a pending or still-processing withdrawal can be declined (this one is '${w.status}')` });
    const wasProcessing = w.status === 'processing';
    await withLock('bal:' + w.userId, () => db.runTransaction(async t => {
      const fresh = await t.get(ref);
      if (fresh.data().status !== w.status) return;
      const uRef = db.collection('users').doc(w.userId);
      const refund = { walletBalance: FieldValue.increment(fresh.data().amount) };
      if (wasProcessing) refund.totalWithdrawn = FieldValue.increment(-fresh.data().net);
      // STATUS-BEFORE-REFUND: db.js's runTransaction replays these writes
      // one at a time with no rollback, and the guard just above is `status
      // !== 'processing'`. Flipping the status first means a failure before
      // the credit lands leaves the refund un-paid but retryable, instead of
      // paid-but-still-'processing' — which every retry of this path (client
      // poll, webhook, reconciler) would refund again.
      t.update(ref, {
        status: 'declined', failureReason: String(req.body.reason || 'Declined by admin'),
        declinedBy: req.adminUser?.username || 'owner-key', declinedAt: FieldValue.serverTimestamp()
      });
      t.update(uRef, refund);
    }));
    logAdminAction(req, 'withdraw_force_declined', { withdrawalId: witId, reason: req.body.reason });
    res.json({ status: 'success' });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
  finally { _withdrawInFlight.delete(witId); }
});

// ═══════════════════════════════════════════
// ADMIN — TRANSACTIONS / REFERRALS
// ═══════════════════════════════════════════
app.post('/admin/transactions/list', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const { userId, limit: lim } = req.body;
  const ref = String(req.body.ref || '').trim().toUpperCase();
  try {
    // An exact reference lookup (the "B..." id shown on deposits/
    // withdrawals) isn't bounded by recency like the plain list below —
    // it finds the transaction regardless of how far back it was, which
    // the admin panel's own client-side search over the recent window
    // can't do for anything older than its last-loaded batch.
    if (ref) {
      const snap = await db.collection('transactions').where('ref', '==', ref).limit(20).get();
      return res.json({ status: 'success', transactions: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
    }
    if (userId) {
      const snap = await db.collection('transactions').where('userId', '==', userId).limit(100).get();
      const txs = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => tsMillis(b.createdAt) - tsMillis(a.createdAt));
      return res.json({ status: 'success', transactions: txs });
    }
    const snap = await db.collection('transactions').orderBy('createdAt', 'desc').limit(Number(lim) || 300).get();
    res.json({ status: 'success', transactions: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
// Built from the live referredBy graph — Space8 has no separate
// `referrals` collection, referral links are just the field on each user.
app.get('/admin/referrals/list', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const usersSnap = await db.collection('users').limit(10000).get();
    const phones = {}; usersSnap.forEach(u => { phones[u.id] = u.data().phone || u.id; });
    const rows = [];
    usersSnap.forEach(u => {
      const d = u.data();
      if (d.referredBy) rows.push({
        referrerId: d.referredBy, referrerPhone: phones[d.referredBy] || 'Not set',
        referredId: u.id, referredPhone: d.phone || 'Not set',
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
// XXX-XXXX-XXXX — no fixed word list for the prefix: all three segments,
// prefix included, are generated fresh from crypto.randomBytes every time
// (never Math.random(), never picked from a stored array), so nothing about
// a code is drawn from a limited/predictable set. The prefix uses a
// letters-only unambiguous alphabet (no I/L/O, matching CODE_CHARS' letters)
// so it still reads like the XXX-XXXX-XXXX shape; the two 4-char blocks use
// the same full CODE_CHARS alphabet as referral codes. A code is
// "recognized" purely by an exact match against what the server itself
// generated and stored — generateUniquePromoCode() below re-queries the DB
// per candidate (same pattern as generateUniqueReferralCode()) so recognition
// never depends on the prefix or shape, only on a real DB record existing.
const PROMO_PREFIX_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ'; // letters only, no I/L/O ambiguity
function randPrefix(n = 3) {
  return Array.from(crypto.randomBytes(n)).map(b => PROMO_PREFIX_CHARS[b % PROMO_PREFIX_CHARS.length]).join('');
}
function genPromoCode() {
  return `${randPrefix(3)}-${randCode(4)}-${randCode(4)}`;
}
async function generateUniquePromoCode() {
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = genPromoCode();
    const exists = await db.collection('promoCodes').where('code', '==', code).limit(1).get();
    if (exists.empty) return code;
  }
  throw new Error('Could not generate a unique code right now, please try again');
}
app.post('/admin/promocodes/generate', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const { count = 1, minAmount, maxAmount, maxUses } = req.body;
  const min = Math.max(0, Math.round(parseFloat(minAmount) || 0));
  const max = Math.max(0, Math.round(parseFloat(maxAmount) || 0));
  if (!min || !max) return res.status(400).json({ status: 'error', message: 'minAmount and maxAmount required' });
  if (min > max) return res.status(400).json({ status: 'error', message: 'minAmount cannot exceed maxAmount' });
  const n = Math.min(Math.max(parseInt(count) || 1, 1), 50);
  try {
    // Whole batch runs under one lock — check-then-add isn't atomic on M0
    // (no real transactions), so without this two admins generating at the
    // same moment could theoretically both pick the same free code before
    // either had written it.
    await withLock('promocode-generate', async () => {
      const made = [];
      for (let i = 0; i < n; i++) {
        const code = await generateUniquePromoCode();
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
    });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
app.get('/admin/promocodes/list', async (req, res) => {
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
app.get('/admin/stats', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const [usersSnap, pendingWitSnap, activeInvSnap] = await Promise.all([
      db.collection('users').limit(10000).get(),
      // BUG FIXED: this only ever matched status 'processing' -- the brief
      // window between an admin's Send and MarzPay's own confirmation --
      // never 'pending', which is what a withdrawal sits at from the
      // moment a member requests it until an admin actually sends it (see
      // /admin/badges just below, which already queries 'pending' and was
      // never wrong). Real outstanding payout liability is every status
      // that hasn't reached a terminal state yet: 'pending' (queued,
      // untouched), 'sending' (crash-safety marker written just before the
      // gateway call), and 'processing' (sent, awaiting confirmation).
      db.collection('withdrawals').where('status', 'in', ['pending', 'sending', 'processing']).get(),
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
app.get('/admin/badges', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const snap = await db.collection('withdrawals').where('status', '==', 'pending').get();
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
    const [depSnap, witSnap, usersSnap, activeInvSnap, sett] = await Promise.all([
      db.collection('pendingDeposits').orderBy('createdAt', 'desc').limit(10000).get(),
      db.collection('withdrawals').orderBy('createdAt', 'desc').limit(10000).get(),
      db.collection('users').limit(10000).get(),
      db.collection('investments').where('status', '==', 'active').limit(10000).get(),
      getSettings(),
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

    // Who's actually approving/declining payouts, and how fast -- separate
    // from the deposits/withdrawals volume above because it's about STAFF
    // activity, not member activity. processedBy/declinedBy are the same
    // identity logAdminAction already uses (adminUser.username, or
    // 'owner-key' for the master key). Windowed to the same period as
    // everything else so "this month's" staff activity is what shows.
    const staffMap = {};
    const staffTimeline = [];
    const touchStaff = actor => (staffMap[actor] = staffMap[actor] || { actor, approvals: 0, declines: 0, amountApproved: 0, amountDeclined: 0, firstAt: null, lastAt: null });
    witSnap.forEach(d => {
      const w = d.data();
      // processedBy/declinedBy mark an ADMIN ACTION happened, independent of
      // the withdrawal's current status -- a fresh approval lands at
      // 'processing' (still awaiting MarzPay's own confirmation) and only
      // becomes 'processed' later once the reconciler/webhook catches up, so
      // gating on status==='processed' here undercounts every recent
      // approval. The two checks are deliberately NOT mutually exclusive: a
      // withdrawal can be approved by one admin, fail at the gateway, and
      // get declined/refunded by another -- both actions get credited to
      // whoever actually did them.
      if (w.processedBy) {
        const ms = tsMillis(w.processedAt || w.createdAt);
        if (ms >= sinceMs) {
          const s = touchStaff(w.processedBy);
          s.approvals++; s.amountApproved += w.amount || 0;
          s.firstAt = s.firstAt === null ? ms : Math.min(s.firstAt, ms);
          s.lastAt = s.lastAt === null ? ms : Math.max(s.lastAt, ms);
          staffTimeline.push({ actor: w.processedBy, action: 'approved', phone: w.phone || w.accountName || '', amount: w.amount || 0, at: ms });
        }
      }
      if (w.declinedBy) {
        const ms = tsMillis(w.declinedAt || w.createdAt);
        if (ms >= sinceMs) {
          const s = touchStaff(w.declinedBy);
          s.declines++; s.amountDeclined += w.amount || 0;
          s.firstAt = s.firstAt === null ? ms : Math.min(s.firstAt, ms);
          s.lastAt = s.lastAt === null ? ms : Math.max(s.lastAt, ms);
          staffTimeline.push({ actor: w.declinedBy, action: 'declined', phone: w.phone || w.accountName || '', amount: w.amount || 0, at: ms });
        }
      }
    });
    const staffActionsTotal = Object.values(staffMap).reduce((s, x) => s + x.approvals + x.declines, 0);
    const staffApprovals = {
      byStaff: Object.values(staffMap)
        .map(s => ({ ...s, totalHandled: s.approvals + s.declines, sharePct: staffActionsTotal ? Math.round((s.approvals + s.declines) / staffActionsTotal * 1000) / 10 : 0 }))
        .sort((a, b) => b.totalHandled - a.totalHandled),
      timeline: staffTimeline.sort((a, b) => b.at - a.at).slice(0, 40),
    };

    let totalUsers = 0, newUsers = 0, activeInvestors = 0, investedAmount = 0, commissionsPaid = 0;
    const referrers = [], depositors = [];
    usersSnap.forEach(d => {
      const u = d.data(); totalUsers++;
      const ms = tsMillis(u.createdAt);
      if (ms >= sinceMs) { newUsers++; const { day } = eatParts(u.createdAt); ensureDay(day).users++; }
      if ((u.totalInvested || 0) > 0) activeInvestors++;
      investedAmount += u.totalInvested || 0;
      commissionsPaid += u.teamCommission || 0;
      if ((u.teamL1Count || 0) > 0 || (u.teamCommission || 0) > 0)
        referrers.push({ phone: u.phone || '', team: u.teamL1Count || 0, earned: u.teamCommission || 0 });
      if ((u.totalDeposited || 0) > 0) depositors.push({ phone: u.phone || '', amount: u.totalDeposited || 0 });
    });
    // Task Center rewards paid so far (both milestone ladders), summed
    // straight off each user's own claim flags rather than a separate ledger.
    let teamRewardsPaid = 0;
    usersSnap.forEach(d => {
      const u = d.data();
      TEAM_MILESTONES.forEach(m => { if (u['milestoneClaimed_' + m.target]) teamRewardsPaid += m.reward; });
      TEAM_DEPOSIT_MILESTONES.forEach(m => { if (u['depositMilestoneClaimed_' + m.target]) teamRewardsPaid += m.reward; });
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

    // ── TOMORROW'S ESTIMATE — read from real platform state (who's actually
    // maturing, who's actually mid-signup-funnel), not just a straight trend
    // line. Explicitly labelled an estimate to the admin, never a promise.
    const trailing = byDay.slice(-Math.min(7, byDay.length));
    const trailN = trailing.length || 1;
    const witTrend = trailing.reduce((s, d) => s + d.wit, 0) / trailN;
    const depTrend = trailing.reduce((s, d) => s + d.dep, 0) / trailN;
    let maturingCount = 0, maturingPayout = 0;
    activeInvSnap.forEach(d => {
      const inv = d.data();
      const paidOut = Number(inv.paidOut) || 0, dailyPayout = Number(inv.dailyPayout) || 0, expected = Number(inv.expectedReturn) || 0;
      if (expected > 0 && paidOut + dailyPayout >= expected) { maturingCount++; maturingPayout += Math.max(0, expected - paidOut); }
    });
    const REINVEST_RATE_PCT = 35;
    const CONVERSION_RATE_PCT = 20;
    const pipelineCutoff = Date.now() - 3 * 86400000;
    let pipelineUserCount = 0;
    usersSnap.forEach(d => {
      const u = d.data();
      if (tsMillis(u.createdAt) >= pipelineCutoff && (u.totalDeposited || 0) === 0) pipelineUserCount++;
    });
    const pipelineEstimate = Math.round(pipelineUserCount * (sett.minDeposit || 0) * (CONVERSION_RATE_PCT / 100));
    const maturingReinvestEstimate = Math.round(maturingPayout * (REINVEST_RATE_PCT / 100));
    const forecast = {
      withdrawals: { estimate: Math.round(witTrend), likelyWithdrawerCount: maturingCount, trendReference: Math.round(witTrend) },
      deposits: {
        estimate: Math.round(depTrend + maturingReinvestEstimate + pipelineEstimate),
        organicTrend: Math.round(depTrend), maturingReinvestEstimate, maturingCount, reinvestRatePct: REINVEST_RATE_PCT,
        pipelineEstimate, pipelineUserCount, conversionRatePct: CONVERSION_RATE_PCT
      }
    };

    res.json({
      status: 'success', period: days,
      kpis: {
        depositsAmount: depAmount, depositsCount: depCount,
        withdrawalsAmount: witAmount, withdrawalsCount: witCount,
        netFlow: depAmount - witAmount, totalUsers, newUsers, activeInvestors,
        investedAmount, commissionsPaid, teamRewardsPaid
      },
      byHour, bands, byDay, peakDepositHour, peakWithdrawHour, busiestBand, forecast, staffApprovals,
      topReferrers: referrers.slice(0, 10), topDepositors: depositors.slice(0, 10), biggestWithdrawals: bigWits.slice(0, 10)
    });
  } catch (e) { console.error('Analytics error:', e.message); res.status(500).json({ status: 'error', message: e.message }); }
});

// Owner-only visibility into suspicious/abusive usage patterns -- deliberately
// a SEPARATE endpoint from /admin/analytics (which staff can also read) and
// gated with verifyOwner, not verifyAdmin, so staff never receives this data
// at all, same "never disclose it" treatment as the Integrity audit and
// other owner-only tools. Surfaces repeat offenders across four signals the
// owner asked for by name: accounts with many FAILED deposits (reads the
// same pendingDeposits records /admin/integrity already trusts, no new
// logging needed), accounts repeatedly trying to withdraw more than their
// balance, accounts repeatedly tapping check-in after already claiming
// today, and accounts trying gift/promo codes that don't exist (guessing) --
// the last three are newly logged to securityEvents at the exact point each
// one is rejected (see logSecurityEvent call sites). Only ever a READ over
// events that already happened; never blocks or bans anyone by itself.
app.post('/admin/analytics/abuse', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const days = Math.min(Math.max(parseInt(req.body.days) || 30, 1), 180);
  const minCount = Math.min(Math.max(parseInt(req.body.minCount) || 3, 1), 1000);
  const sinceMs = Date.now() - days * 86400000;
  try {
    const [depSnap, evSnap, usersSnap] = await Promise.all([
      db.collection('pendingDeposits').where('status', '==', 'failed').limit(10000).get(),
      db.collection('securityEvents').limit(10000).get(),
      db.collection('users').limit(10000).get(),
    ]);
    const phoneOf = {};
    usersSnap.forEach(d => { phoneOf[d.id] = d.data().phone || d.id; });

    // Groups docs matching filterFn into a per-user count, windowed to the
    // period, keeping up to 5 sample details per user for the admin to
    // actually see WHAT was attempted (amounts, codes tried), not just a
    // bare number. Only users at/above minCount show up at all -- a single
    // failed deposit or one mistimed check-in tap is normal life, not abuse.
    function topOffenders(snap, filterFn, sampleFn) {
      const byUser = {};
      snap.forEach(d => {
        const x = d.data();
        if (!x.userId || !filterFn(x)) return;
        const ms = tsMillis(x.createdAt);
        if (ms < sinceMs) return;
        const row = byUser[x.userId] || (byUser[x.userId] = { userId: x.userId, phone: phoneOf[x.userId] || x.userId, count: 0, lastAt: 0, samples: [] });
        row.count++;
        row.lastAt = Math.max(row.lastAt, ms);
        if (sampleFn && row.samples.length < 5) row.samples.push(sampleFn(x));
      });
      return Object.values(byUser).filter(r => r.count >= minCount).sort((a, b) => b.count - a.count).slice(0, 50);
    }

    const repeatedFailedDeposits = topOffenders(depSnap, () => true, x => ({ amount: x.amount || 0, reason: x.failureReason || null }));
    const repeatedInsufficientWithdrawals = topOffenders(evSnap, x => x.type === 'withdraw_insufficient_funds',
      x => ({ attempted: (x.meta && x.meta.attempted) || 0, balance: (x.meta && x.meta.balance) || 0 }));
    const repeatedCheckinAlreadyClaimed = topOffenders(evSnap, x => x.type === 'checkin_already_claimed', null);
    const giftcodeGuessing = topOffenders(evSnap, x => x.type === 'giftcode_invalid_attempt', x => (x.meta && x.meta.code) || '');

    res.json({
      status: 'success', period: days, minCount,
      repeatedFailedDeposits, repeatedInsufficientWithdrawals, repeatedCheckinAlreadyClaimed, giftcodeGuessing
    });
  } catch (e) { console.error('Abuse analytics error:', e.message); res.status(500).json({ status: 'error', message: e.message }); }
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
  if (_sweepingDeposits) return 0;
  _sweepingDeposits = true;
  let settled = 0;
  try {
    const snap = await db.collection('pendingDeposits').where('status', '==', 'pending').limit(50).get();
    for (const doc of snap.docs) {
      const dep = doc.data();
      if (!dep.marzTxUuid) continue;
      const marzStatus = await marzGetCollectStatus(dep.marzTxUuid);
      if (SUCCESS_STATUSES.has(marzStatus)) { await creditDeposit(doc); settled++; }
      else if (FAILED_STATUSES.has(marzStatus)) await markDepositFailed(doc.ref, dep.userId, DEPOSIT_FAILED_MSG);
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
      if (SUCCESS_STATUSES.has(marzStatus)) { await creditDeposit(doc); settled++; }
    }
  } catch (e) { console.error('Reconcile deposits error:', e.message); }
  finally { _sweepingDeposits = false; }
  return settled;
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
  let settled = 0;
  try {
    const snap = await db.collection('withdrawals').where('status', '==', 'processing').limit(50).get();
    for (const doc of snap.docs) {
      const wit = doc.data();
      const isBank = wit.method === 'bank';
      const gatewayRef = isBank ? wit.marzBankReference : wit.marzTxUuid;
      if (!gatewayRef) continue;
      const marzStatus = isBank ? await marzGetBankTransferStatus(gatewayRef) : await marzGetSendStatus(gatewayRef);
      if (SUCCESS_STATUSES.has(marzStatus)) {
        await doc.ref.update({ status: 'processed', processedAt: FieldValue.serverTimestamp() }).catch(() => {});
        settled++;
      } else if (FAILED_STATUSES.has(marzStatus)) {
        await withLock('bal:' + wit.userId, () => db.runTransaction(async t => {
          const fresh = await t.get(doc.ref);
          if (!fresh.exists || fresh.data().status !== 'processing') return;
          const uRef = db.collection('users').doc(wit.userId);
          // STATUS-BEFORE-REFUND: db.js's runTransaction replays these
          // writes one at a time with no rollback, and the guard just above
          // is `status !== 'processing'`. Flipping the status first means a
          // failure before the credit lands leaves the refund un-paid but
          // retryable, instead of paid-but-still-'processing' — which every
          // retry of this path (client poll, webhook, reconciler) would
          // refund again.
          t.update(doc.ref, { status: 'declined', failureReason: isBank ? 'Bank transfer failed at the provider' : 'Payout failed at the mobile-money provider' });
          t.update(uRef, { walletBalance: FieldValue.increment(fresh.data().amount), totalWithdrawn: FieldValue.increment(-fresh.data().net) });
        }));
        settled++;
      } else {
        // Was silently swallowed with zero trace of WHY -- a withdrawal
        // stuck in 'processing' with a status this codebase doesn't
        // recognize as terminal loops here forever (every 30s), and since
        // MarzPay only allows one send-money payout in flight per business
        // account at a time, ONE stuck-and-invisible item like this blocks
        // every OTHER pending withdrawal from ever being sent too -- with
        // nothing in the logs explaining why. Logs the exact raw status
        // string MarzPay (or its /transactions/{uuid} fallback) actually
        // returned, so a genuinely still-in-flight payout is distinguishable
        // from a status spelling this code just doesn't know about yet.
        console.log(`reconcilePendingWithdrawals: ${doc.id} (${gatewayRef}) still unresolved -- MarzPay status: "${marzStatus || '(empty)'}"`);
      }
    }
  } catch (e) { console.error('Reconcile withdrawals error:', e.message); }
  return settled;
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
// settleInvestmentIfDue() above only ever runs when triggered -- until now
// that was solely a user's own /account or /investments read, so when an
// actual payout landed depended entirely on when that user's client next
// happened to poll after the 24-hour mark passed. If the app was
// backgrounded or the phone's screen was off right at the boundary, the
// credit (and its transaction timestamp) could land minutes late instead
// of on the dot. This runs on its own 1s tick (see startup below) --
// separate from the deposits/withdrawals/commissions tick -- because it
// is a pure DB read+write with no external call, so a 1s cadence costs
// nothing beyond one indexed Mongo query per tick. Deposits/withdrawals
// stayed on the slower 30s tick deliberately: each open record there
// means a live HTTP call to MarzPay, and polling a third-party payment
// API 30x more often risks tripping its own rate limiting -- that would
// break real payments to chase a cosmetic timing improvement nobody
// asked for on that side. _sweepingCashback guards against a tick
// overlapping a still-running previous one if the investments collection
// ever grows large enough for the query itself to take over a second.
let _sweepingCashback = false;
async function reconcileCashback() {
  if (_sweepingCashback) return;
  _sweepingCashback = true;
  try {
    const snap = await db.collection('investments').where('status', '==', 'active').limit(500).get();
    for (const doc of snap.docs) {
      await settleInvestmentIfDue(doc).catch(e => console.error('Reconcile cashback error:', e.message));
    }
  } catch (e) { console.error('Reconcile cashback error:', e.message); }
  finally { _sweepingCashback = false; }
}
function runReconciler() {
  reconcilePendingDeposits().then(reconcilePendingWithdrawals).then(reconcileCommissions).catch(() => {});
}

// Manual "Sync MarzPay" button in the admin panel — re-checks every in-flight
// deposit AND withdrawal against the real gateway right now, instead of
// waiting for the background 30s sweep. Same functions the automatic
// background job uses, so this can never settle anything differently or
// double-pay — it just runs them on demand.
app.get('/admin/payments/sync', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const depositsSettled = await reconcilePendingDeposits();
    const withdrawalsSettled = await reconcilePendingWithdrawals();
    res.json({ status: 'success', settled: (depositsSettled || 0) + (withdrawalsSettled || 0),
      depositsSettled: depositsSettled || 0, withdrawalsSettled: withdrawalsSettled || 0 });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});

app.get('/', (_req, res) => res.json({ status: 'ok', service: 'Space8 backend' }));

// Catches body-parser failures (oversized payload, malformed JSON) that
// would otherwise fall through to Express's default HTML error page — every
// response from this API, success or failure, should be JSON.
app.use((err, _req, res, _next) => {
  if (err && err.type === 'entity.too.large')
    return res.status(413).json({ status: 'error', message: 'Request is too large' });
  if (err && err.type === 'entity.parse.failed')
    return res.status(400).json({ status: 'error', message: 'Malformed request body' });
  console.error('Unhandled request error:', err && err.message);
  res.status(500).json({ status: 'error', message: 'Something went wrong' });
});

// ── IN-MEMORY STATE SWEEPER ──
// The debounce/attempt/lockout maps above are all keyed by something
// unbounded (a userId, or worse, an arbitrary attacker-supplied username on
// /admin/login) and only ever pruned when that SAME key comes back. On a
// long-running process they therefore only grow: every member who ever
// deposits keeps a permanent entry, and anyone spraying the admin login with
// fresh usernames can add entries indefinitely — a slow memory-exhaustion
// path on a small Render instance. Nothing here is durable state (it's all
// short-window rate/abuse tracking), so anything past its own window is safe
// to drop outright.
function sweepEphemeralState() {
  const now = Date.now();
  const dropStale = (map, maxAgeMs) => {
    for (const [k, ts] of map) if (now - ts > maxAgeMs) map.delete(k);
  };
  try {
    // Debounce stamps are plain timestamps and only matter for a few seconds.
    dropStale(_depCreateDebounce, 5 * 60 * 1000);
    dropStale(_adminCreditDebounce, 5 * 60 * 1000);
    dropStale(_adminDebitDebounce, 5 * 60 * 1000);
    // Deposit-attempt windows are 60s; keep a wide margin, then drop.
    for (const [uid, times] of _depAttempts) {
      const live = times.filter(t => now - t < 60000);
      if (live.length) _depAttempts.set(uid, live);
      else { _depAttempts.delete(uid); _depAttemptsSucceeded.delete(uid); }
    }
    // Login-failure counters: keep anything still inside its lockout, drop the
    // rest once it's older than the 15-minute lockout window.
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
    app.listen(PORT, () => console.log(`Space8 backend listening on :${PORT}`));
    setInterval(runReconciler, 30 * 1000);
    setTimeout(runReconciler, 15 * 1000);
    setInterval(reconcileCashback, 1000);
    setTimeout(reconcileCashback, 1000);
    setInterval(sweepEphemeralState, 5 * 60 * 1000);
  })
  .catch(e => { console.error('Mongo connection failed:', e.message); process.exit(1); });
