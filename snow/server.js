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
 '/team/milestone/claim', '/checkin', '/deposit/manual/init', '/deposit/manual/paste-sms']
  .forEach(p => app.use(p, apiLimiter));

// ── BODY PARSING ──
// A tight 64kb cap by default; admin routes that carry a base64 product
// photo get the larger parser instead of loosening the limit for everything.
const smallJsonParser  = express.json({ limit: '64kb' });
const bigJsonParser    = express.json({ limit: '4mb' });
// The About page article can carry several embedded images at once (owner:
// "I will not put one image, no I will put many images"), well past a
// single-image upload -- gets its own larger cap instead of loosening
// bigJsonParser for the single-image routes that don't need it.
const hugeJsonParser   = express.json({ limit: '13mb' });
// Real bug fixed: this used to list '/admin/banners/set' (plural), which
// doesn't match the actual route below ('/admin/banner/set', singular) --
// every real banner image upload (always >64kb as base64) was silently
// hitting the small parser and failing with "request too large." Same bug
// class space8's CLAUDE.md documents hitting its own home-banner-slides
// route once, before that route was added here too.
const IMAGE_BODY_ROUTES = new Set(['/admin/products/save', '/admin/banner/set', '/admin/help-banner/set', '/admin/announcement-image/set', '/admin/manual-pay-image/set']);
const HUGE_JSON_ROUTES = new Set(['/admin/about-content/set']);
app.use((req, res, next) => (HUGE_JSON_ROUTES.has(req.path) ? hugeJsonParser : IMAGE_BODY_ROUTES.has(req.path) ? bigJsonParser : smallJsonParser)(req, res, next));
app.use(express.urlencoded({ extended: true, limit: '64kb' }));

// Owner: real custom domain confirmed live -- chn-snow2beer.com -- while
// snow-platform.com (this project's original placeholder domain, flagged as
// unconfirmed back in Round 89's own notes) was never actually put into use.
// Left in the set rather than removed: harmless if genuinely unused, and
// removing it on a guess risks breaking it if the owner does control it.
// Every request from an unlisted origin is silently rejected by the `cors`
// middleware below with NO CORS headers on the response -- the browser then
// blocks it entirely, which surfaces to the member as a plain fetch()
// failure (this app's own generic "Network error. Check your connection."),
// indistinguishable from a real connectivity problem. This is exactly what
// made the custom domain's own /register calls fail before this fix --
// not a bad connection, every API call from that origin was being refused
// at the CORS layer.
const CORS_ALLOWED_ORIGINS = new Set([
  'https://snow-platform.com', 'https://www.snow-platform.com',
  'https://chn-snow2beer.com', 'https://www.chn-snow2beer.com',
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
// MarzSms -- a SEPARATE MarzPay product (its own dashboard/API keys at
// sms.wearemarz.com, distinct from the wallet product MARZPAY_KEY above)
// used only to alert admins by text when a withdrawal needs processing.
// Same "base64(api_key:api_secret)" Basic-auth convention as the wallet API.
const MARZSMS_BASE = 'https://sms.wearemarz.com/api/v1';
const MARZSMS_KEY  = process.env.MARZSMS_KEY || '';

// ── OUTBOUND STATIC-IP PROXY (QuotaGuard) ──
// Some payment providers (LipaPay is the reason this exists) whitelist a
// fixed IP rather than authenticating every request -- Render's own egress
// IPs are dynamic, so a request straight from this dyno can land from any
// address and get rejected. QuotaGuard Static gives 2 fixed IPs and a proxy
// URL; routing a specific outbound call through it makes that call appear
// to come from one of those 2 IPs instead. This is opt-in PER CALL via
// proxyFetch() below, not global -- MarzPay has no IP-whitelist requirement
// today, so its own calls stay direct and unaffected by this being unset,
// misconfigured, or the proxy itself being briefly down.
const { ProxyAgent } = require('undici');
const QUOTAGUARD_URL = (process.env.QUOTAGUARDSTATIC_URL || '').trim();
let quotaGuardAgent = null;
if (QUOTAGUARD_URL) {
  // new ProxyAgent() THROWS synchronously on a malformed/unparseable URL --
  // confirmed by hand before shipping this. Left uncaught, a single typo'd
  // env var (this is optional plumbing for a not-yet-built LipaPay
  // integration) would crash the ENTIRE server at boot, taking down every
  // money path with it. A misconfigured proxy must only break the ONE
  // feature that needs it, never the whole app.
  try { quotaGuardAgent = new ProxyAgent(QUOTAGUARD_URL); }
  catch (e) { console.error('QUOTAGUARDSTATIC_URL is set but could not be parsed as a proxy URL -- proxied calls will fall through to a DIRECT request, which a static-IP-only provider will reject. Error:', e.message); }
}
// Drop-in replacement for fetch() that routes through the QuotaGuard static
// IP when QUOTAGUARDSTATIC_URL is configured, and behaves exactly like a
// plain fetch() otherwise (so this is safe to use even before the env var
// is ever set, e.g. in local dev). Never throws on its own for a missing
// proxy config -- an unconfigured proxy is a deploy-config problem for the
// provider's own request to surface (a 403 from THEM), not something this
// helper should silently swallow or crash the server over.
function proxyFetch(url, opts) {
  if (!quotaGuardAgent) return fetch(url, opts);
  return fetch(url, { ...opts, dispatcher: quotaGuardAgent });
}

// ── MAINTENANCE GATE ──
const MAINTENANCE_BLOCK = ['/account', '/invest', '/deposit', '/withdraw', '/register', '/bank', '/team'];
// Subagent-audit-caught real gap (Round 104): '/deposit/manual/sms-forwarder'
// starts with '/deposit', so MAINTENANCE_BLOCK's prefix match already swept
// it up -- unlike the 4 gateway webhooks above, it was never exempted. That
// webhook reports money that has ALREADY LEFT a payer's account onto an
// admin's phone; blocking it doesn't stop the deposit from happening, it
// just stops the SERVER from ever finding out, and the Android forwarder
// (Poster.java) makes exactly one attempt with no retry/queue -- a 503
// during maintenance is logged on the phone and dropped forever, so the
// order simply expires unmatched with no recovery. Same "money already
// moved externally, must never be blocked" reasoning as the 4 payment
// webhooks, just missed when this route was originally added.
const GUARD_EXEMPT = new Set(['/', '/health', '/deposit/callback', '/withdraw/callback', '/deposit/lipapay/callback', '/withdraw/lipapay/callback', '/deposit/manual/sms-forwarder']);
app.use(async (req, res, next) => {
  if (GUARD_EXEMPT.has(req.path)) return next();
  if (!MAINTENANCE_BLOCK.some(p => req.path.startsWith(p))) return next();
  try {
    const s = await getSettings();
    if (s && s.maintenanceMode) {
      return res.status(503).json({ status: 'error', code: 'MAINTENANCE',
        message: s.maintenanceMsg || 'Snow is under maintenance. Please check back shortly.' });
    }
    // Owner: "let's establish a timer ie like saying snow opening in
    // 23:59:34... make when l can activate it or disable it, just near
    // maintenance mode." Same route list as the maintenance block just
    // above, so the client-side countdown gate can't be routed around by
    // hitting a money/account endpoint directly. Self-clearing: once real
    // time passes openingCountdownAt this stops blocking on its own with no
    // separate step needed -- the admin toggle exists for turning it off
    // early (opening sooner than originally scheduled), not for turning it
    // back off again once the target time has actually passed.
    if (s && s.openingCountdownEnabled && Number(s.openingCountdownAt) > Date.now()) {
      return res.status(503).json({ status: 'error', code: 'OPENING_COUNTDOWN',
        message: 'Snow has not opened yet.', openingAt: Number(s.openingCountdownAt) });
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
  // Owner: "let's establish a timer ie like saying snow opening in
  // 23:59:34... just near maintenance mode." A pre-launch gate, separate
  // from maintenanceMode -- an admin-set future instant (0 = not scheduled)
  // nobody can use the app before, shown to the member as a live countdown
  // right after the loading screen. See the MAINTENANCE GATE section below
  // for the actual server-side enforcement.
  openingCountdownEnabled: false, openingCountdownAt: 0,
  maxWithdrawalsPerDay: 2, requireInvestToWithdraw: true,
  // Off by default — approves every pending withdrawal automatically a few
  // seconds after it's requested, server-driven, idempotent (shares the
  // exact same processWithdrawalCore path a manual admin approval uses).
  // autoApproveMaxAmount: 0 = unlimited; a nonzero value leaves anything
  // above it for manual review instead.
  autoApproveWithdrawalsEnabled: false, autoApproveIntervalSec: 10, autoApproveMaxAmount: 0,
  supportTelegram: '', telegramGroup: '', telegramChannel: '', supportHours: '',
  rulesText: '', aboutText: '',
  // Home announcement dialog, owner: "put it back... opens from middle...
  // background as that of activity checker [ticker]... OK button... triggers
  // link and joins telegram group... X button top right." A real feature
  // that was flagged as a deferred gap when the admin panel was ported from
  // Space8 (Round 14) -- Space8's version needed its own admin-uploaded
  // image + blur/tint sliders; this one deliberately didn't at first (owner
  // wanted the same solid dark pill look the Home activity ticker uses, no
  // photo) -- an optional image was added later (owner: "introduce
  // announcement dialog image, up of dialog message and scrollable"), kept
  // as its own separate 'banners'/'announcement' doc (see getAnnouncementImage())
  // rather than a settings field, same reasoning as the Home/Help Centre
  // banners: a base64 image doesn't belong bloating the /public/settings
  // payload every client fetches on every boot.
  annEnabled: false, annTitle: '', annBody: '',
  // Owner: "make when l can change figure/digit fonts in admin panel" --
  // the `.mono` class every UGX figure/numeric stat in the user app already
  // uses (Round 24 picked Bodoni Moda as the original fixed default) is now
  // admin-selectable from a curated list (see NUMBER_FONT_OPTIONS below),
  // not a free-text field -- a font *name* here ends up interpolated into a
  // Google Fonts URL and a CSS font-family value client-side, so an
  // allowlist closes off any injection surface the way SETTINGS_URL_FIELDS'
  // http(s)-only check already does for link fields.
  numberFont: 'Bodoni Moda',
  // Owner: "let us also add manual payments... make when l can toggle
  // payment method to manual or automatic (marzpay), current one." Only
  // one method is ever live at a time -- MarzPay's own code is completely
  // untouched, just gated behind this flag alongside the new manual-deposit
  // path (see the "MANUAL DEPOSITS" section below). Values are
  // 'marzpay' | 'lipapay' | 'manual' (Round 102 widened this from a plain
  // 'automatic'/'manual' 2-way toggle once LipaPay became a real 2nd
  // automatic provider -- 'automatic' is still recognized as a legacy
  // alias for 'marzpay' by depositProvider()/withdrawProvider() below, so
  // an already-deployed database with the old value keeps working exactly
  // as before with zero migration). Never read this field raw -- always go
  // through depositProvider()/payoutIsManual().
  depositMethod: 'marzpay',
  // Owner, after the first version tied payouts to depositMethod: "yeah it
  // can also work and vice versa" -- so the two directions are separable.
  // 'follow' keeps the original behaviour (payouts do whatever deposits do,
  // which is what most setups want and what everyone is already on);
  // 'marzpay'/'lipapay'/'manual' pin the payout side independently,
  // allowing e.g. manual deposits with LipaPay payouts. Resolved by
  // withdrawProvider()/payoutIsManual() -- never read this field raw.
  withdrawMethod: 'follow',
  // Owner: "let us establish Payment reminder, so as it is also editable in
  // admin panel for mtn and airtel" -- free-text, network-specific transfer
  // instructions shown on the manual-deposit code screen (e.g. the real USSD
  // steps for that network), rendered client-side with {{number}}/{{amount}}
  // substituted for the member's own real assigned account/order amount so
  // the same admin-authored template stays accurate across every order.
  // Blank means the section doesn't render for that network at all -- never
  // guess at a network's real USSD flow with an invented default; the owner
  // supplied MTN's own real steps directly, so that one is prefilled exactly
  // as given, Airtel is left blank for the admin to fill in with their own
  // verified steps.
  manualPayReminderMtn: '1: Dial *165#\n2: Select 1 Send Money\n3: Select 1 Mobile User\n4: Enter number {{number}}\n5: Enter Amount {{amount}}\n6: Enter Reason\n7: Enter your PIN code',
  manualPayReminderAirtel: '',
  // Owner (Round 145): "we will enable 2 payment methods for users to tap
  // and use... let it just be PAY A / PAY B" -- both can now be offered to
  // the member AT THE SAME TIME (previously depositMethod was a single
  // exclusive choice: automatic OR manual, never both). PAY A is always
  // the automatic gateway (whichever depositMethod itself resolves to via
  // depositAutomaticProvider() below -- MarzPay or LipaPay); PAY B is
  // always the admin-managed manual flow. Neither name ("manual"/
  // "automatic") is ever shown to a member -- the app only ever renders
  // the neutral "PAY A"/"PAY B" labels. See getSettings()'s own migration
  // comment for how an already-deployed database (which only ever had the
  // single depositMethod field) gets sane values for these two the first
  // time it's read after this round ships.
  depositPayAEnabled: true, depositPayBEnabled: false,
};
// Keep this exact list of keys in sync with NUMBER_FONT_STACKS in
// user-src/original_module.js (the client-side fallback-stack lookup) and
// the <select> options in admin-src/index.html -- all three must agree on
// the same set of names for a saved value to actually render correctly.
const NUMBER_FONT_OPTIONS = ['Bodoni Moda', 'Playfair Display', 'DM Serif Display', 'Georgia', 'Roboto Mono', 'JetBrains Mono', 'Orbitron', 'System default'];
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
    const stored = snap.exists ? snap.data() : {};
    // Migration (Round 145): a database saved before the PAY A/PAY B split
    // never wrote depositPayAEnabled/depositPayBEnabled at all -- letting
    // DEFAULT_SETTINGS' own true/false defaults silently fill them in below
    // would incorrectly reopen automatic recharges on a platform the owner
    // had deliberately set to depositMethod:'manual' (manual-only). Derive
    // real starting values from the old single depositMethod value instead,
    // exactly once -- the moment an admin explicitly saves the new toggles
    // via /admin/settings/update, both fields land in the stored doc for
    // real and this block is skipped for that database from then on.
    if (!('depositPayAEnabled' in stored) && !('depositPayBEnabled' in stored)) {
      const legacyManualOnly = stored.depositMethod === 'manual';
      stored.depositPayAEnabled = !legacyManualOnly;
      stored.depositPayBEnabled = legacyManualOnly;
    }
    _settingsCache = Object.assign({}, DEFAULT_SETTINGS, stored);
  } catch (_) { _settingsCache = _settingsCache || DEFAULT_SETTINGS; }
  _settingsCacheTs = Date.now();
  return _settingsCache;
}
// Normalizes a raw stored depositMethod/withdrawMethod value to one of
// 'marzpay' | 'lipapay' | 'manual'. 'automatic' is the pre-LipaPay literal
// (still possibly sitting in an already-deployed database) and is treated
// as a permanent alias for 'marzpay', so nothing needs to migrate. Anything
// unrecognized (a stale/corrupted value) also falls back to 'marzpay' --
// the historical default -- rather than silently landing on 'manual',
// which would divert real money to admin-managed numbers nobody expects.
function normalizeProviderValue(v) {
  if (v === 'lipapay' || v === 'manual') return v;
  return 'marzpay';
}
// The single place that decides which real payment path a DEPOSIT uses.
// Reading depositMethod raw anywhere else is a bug waiting to happen.
function depositProvider(sett) {
  return normalizeProviderValue(sett && sett.depositMethod);
}
// Resolves the automatic GATEWAY (marzpay vs lipapay) "PAY A" should use,
// once the /deposit/marzpay route has already confirmed PAY A is actually
// enabled (depositPayAEnabled) -- deliberately distinct from
// depositProvider() above, which withdrawals' own 'follow' mode still
// reads raw and untouched by the Round 145 PAY A/PAY B split. A legacy
// depositMethod:'manual' value (stored from before that split, back when
// this one field doubled as the single always-on method) must never leak
// through here as an "automatic" gateway -- it falls back to MarzPay, the
// historical default, same as every other unrecognized value.
function depositAutomaticProvider(sett) {
  return depositProvider(sett) === 'lipapay' ? 'lipapay' : 'marzpay';
}
// The single place that decides which real payment path a WITHDRAWAL
// (payout) uses. 'follow' defers to depositProvider() -- everything else
// ('marzpay'/'lipapay'/'manual', or the legacy 'automatic' alias) pins the
// payout side independently of the deposit side.
function withdrawProvider(sett) {
  const w = (sett && sett.withdrawMethod) || 'follow';
  if (w === 'follow') return depositProvider(sett);
  return normalizeProviderValue(w);
}
function payoutIsManual(sett) { return withdrawProvider(sett) === 'manual'; }

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
// Separate admin-configurable banner for the Help Centre page -- its own
// doc ('banners'/'help' vs 'banners'/'home') and its own cache, kept fully
// independent of the Home banner above so neither can step on the other.
let _helpBannerCache = null, _helpBannerCacheTs = 0;
async function getHelpBanner() {
  if (Date.now() - _helpBannerCacheTs < 60 * 1000 && _helpBannerCache !== null) return _helpBannerCache;
  try {
    const snap = await db.collection('banners').doc('help').get();
    _helpBannerCache = (snap.exists && snap.data().image) || null;
  } catch (_) { _helpBannerCache = _helpBannerCache || null; }
  _helpBannerCacheTs = Date.now();
  return _helpBannerCache;
}
// Optional image for the Home announcement dialog (owner: "introduce
// announcement dialog image, it will be up of dialog message and
// scrollable") -- same independent-slot/independent-cache pattern as the
// Home and Help Centre banners above, its own 'banners'/'announcement' doc
// so none of the three can ever step on each other.
let _announceImageCache = null, _announceImageCacheTs = 0;
async function getAnnouncementImage() {
  if (Date.now() - _announceImageCacheTs < 60 * 1000 && _announceImageCache !== null) return _announceImageCache;
  try {
    const snap = await db.collection('banners').doc('announcement').get();
    _announceImageCache = (snap.exists && snap.data().image) || null;
  } catch (_) { _announceImageCache = _announceImageCache || null; }
  _announceImageCacheTs = Date.now();
  return _announceImageCache;
}
// Two more independent slots, same pattern as the three above -- optional
// admin-uploaded images replacing the Snow snowflake mark on the manual-
// deposit flow's own 2 screens (owner: "make sure l can upload image to
// replace those snow on payment network screen and final payment
// screenshot... they will be 2 different images"). 'selector' = the
// payment-method/phone screen's brand mark; 'hero' = the COPY & PAY code
// screen's hero logo. Kept as one shared getter taking a slot name rather
// than duplicating the whole function twice, since the two are otherwise
// identical in every respect (own doc, own cache, own fallback to null).
const _manualPayImgCache = { selector: null, hero: null };
const _manualPayImgCacheTs = { selector: 0, hero: 0 };
async function getManualPayImage(slot) {
  if (Date.now() - _manualPayImgCacheTs[slot] < 60 * 1000 && _manualPayImgCache[slot] !== null) return _manualPayImgCache[slot];
  try {
    const snap = await db.collection('banners').doc('manual-' + slot).get();
    _manualPayImgCache[slot] = (snap.exists && snap.data().image) || null;
  } catch (_) { _manualPayImgCache[slot] = _manualPayImgCache[slot] || null; }
  _manualPayImgCacheTs[slot] = Date.now();
  return _manualPayImgCache[slot];
}
// Admin-authored "About" article: an ordered list of {type:'text',text} /
// {type:'image',image} blocks -- the admin decides the order and whether/
// where images go (owner: "I will write and put images... every after any
// group of words I put image or before, or even not to put"). Kept in its
// own collection/doc, not the settings doc, because it can carry several
// embedded images -- folding that into /public/settings would bloat EVERY
// settings fetch on EVERY page load, not just the rare visit to this page.
let _aboutCache = null, _aboutCacheTs = 0;
async function getAboutContent() {
  if (Date.now() - _aboutCacheTs < 60 * 1000 && _aboutCache !== null) return _aboutCache;
  try {
    const snap = await db.collection('content').doc('about').get();
    _aboutCache = (snap.exists && Array.isArray(snap.data().blocks)) ? snap.data().blocks : null;
  } catch (_) { _aboutCache = _aboutCache || null; }
  _aboutCacheTs = Date.now();
  return _aboutCache;
}

// ── HELPERS ──
// Owner: "introduce decimal places in account balance or earnings, so in
// treasure codes there are also decimals." Every OTHER money amount in
// this app (deposits, withdrawals, investments, commissions) is always a
// whole shilling -- only a gift-code reward can ever be fractional (see
// round2()/randomReward() below) -- so this stays whole-number-clean
// everywhere it always was, and only shows cents on the one figure that
// can actually carry them, with no per-call-site changes needed anywhere
// in this file or either frontend.
function fmtUGX(n) {
  const v = Number(n) || 0;
  const hasCents = Math.round(v * 100) % 100 !== 0;
  return 'UGX ' + v.toLocaleString('en-UG', hasCents ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : {});
}
// Rounds to the nearest UGX cent (2 decimal places) -- every gift-code
// reward amount (admin-entered min/max, and the randomly rolled value
// actually credited) is normalized through this so float noise from user
// input or arithmetic never leaks into a stored money field.
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
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
// Owner: "make daily checkin to reset at 00:00 not 24hrs" -- reverts Round
// 87's rolling-24h cooldown back to a calendar-midnight (EAT) daily reset.
// lastCheckinAt stays a real epoch-ms timestamp (Round 87's own field --
// still read as-is by /admin/user/reconcile-checkin, recountAllTotals's own
// freshness re-check, and the client's countdown) -- only the comparison
// logic changes, from "was the gap >=24h/<48h" to "was it the same/previous
// EAT calendar day," matching this app's original pre-Round-87 semantics.
// Recomputed from real check-in history on every call -- a stale/corrupted
// stored streak/timestamp can never keep silently breaking a real one.
// Accepts a Set or Array of timestamps in any order; sorts internally.
function computeCheckinStreak(timestampsMs) {
  const sorted = [...timestampsMs].sort((a, b) => a - b);
  if (!sorted.length) return { streak: 0, lastCheckinAt: null };
  // Collapse same-EAT-day timestamps into one day-key each (a Set, exactly
  // this app's own pre-Round-87 design) -- a stray legacy duplicate within
  // one calendar day can never double-count or break the streak.
  const dayKeys = [...new Set(sorted.map(ts => eatDayKey(new Date(ts))))].sort();
  let streak = 1;
  for (let i = dayKeys.length - 1; i > 0; i--) {
    const cur = Date.parse(dayKeys[i] + 'T00:00:00Z');
    const prev = Date.parse(dayKeys[i - 1] + 'T00:00:00Z');
    if (cur - prev === 86400000) streak++; else break;
  }
  return { streak, lastCheckinAt: sorted[sorted.length - 1] };
}
// UTC ms instant of the next EAT (UTC+3) midnight strictly after `ts`.
function eatNextMidnight(ts) {
  const dayStart = Math.floor((ts + 3 * 3600000) / 86400000) * 86400000;
  return dayStart + 86400000 - 3 * 3600000;
}
function eatParts(ts) {
  const ms = tsMillis(ts) || Date.now();
  const d = new Date(ms + 3 * 3600000);
  const pad = n => String(n).padStart(2, '0');
  return { day: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`, hour: d.getUTCHours() };
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
// Gift codes keep this original mixed-case alphabet, now at 8 characters
// (was 5, owner request 2026-08-27). Still can't collide with a referral
// code by construction — referral codes are 6 chars from a DIFFERENT
// (uppercase-only) alphabet below, so length alone already told the two
// apart and still does.
const GIFTCODE_CHARS = CODE_CHARS;
// Referral codes, changed 2026-08-27 (owner: uppercase letters + numbers
// only, e.g. "FTD6GH", "fully recognized, encrypted, safeguarded and
// global so no repetition"). Same unambiguous-character philosophy as
// CODE_CHARS (no I/O/0/1) but uppercase-only, no lowercase. Every
// already-issued mixed-case code (old CODE_CHARS-based) keeps working
// untouched forever -- redemption/matching below is exact-string
// comparison against whatever's actually stored, no case transform, no
// migration needed. This only changes what NEWLY generated codes look
// like going forward.
const REFERRAL_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I/O/0/1
function randFromAlphabet(alphabet, n) {
  let s = '';
  for (let i = 0; i < n; i++) s += alphabet[crypto.randomInt(alphabet.length)];
  return s;
}
function randCode(n = 6) { return randFromAlphabet(REFERRAL_CHARS, n); }
function genGiftCode() { return randFromAlphabet(GIFTCODE_CHARS, 8); }
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
//     given day is forfeited, not banked/stacked — a calendar-midnight
//     one-shot-per-day gate (missionSalaryLastClaim/nowStr().date), same
//     shape /checkin itself used before Round 87 switched check-in to a
//     rolling 24h cooldown instead (owner: "checkin will be resetting
//     24hrs not midnight") — Mission Center's own salary was never asked
//     to change and stays midnight-based, per the owner's own explicit
//     "resets at 00:00" spec quoted above. Amount is a flat
//     MISSION_SALARY_RATE per active L1 referral, scaling continuously with
//     the live count, capped at MISSION_SALARY_REFERRAL_CAP referrals (owner:
//     "Maximum eligible cap for referral tiers scales up to 1,000 total
//     referrals"). Rate changed 2026-08-27 (owner: "daily per referral change
//     it from 200 to 750ugx") — was 200, now 750 (1,000×750 = 750,000 at the
//     cap). Purely a constant change, no other code depends on the old
//     value — every consumer (salaryAmount here, /team/stats,
//     /mission/claim) already computes off this constant live, nothing
//     hardcodes 200 anywhere else in server.js or the frontend.
//  2. Team deposit reward — ONE-TIME per cumulative-whole-team-deposit
//     threshold (owner confirmed "on time" or one-time, same shape as the
//     Task Center's own deposit ladder, just a separate claim-flag
//     namespace and different numbers), all exactly 5% of the threshold
//     (owner's own worked examples: 150,000 -> 7,500, 300,000 -> 15,000;
//     every other tier scaled from those two the same way).
const MISSION_SALARY_RATE = 750;
const MISSION_SALARY_REFERRAL_CAP = 1000;
const MISSION_DEPOSIT_REWARDS = [
  { target: 150000, reward: 7500 }, { target: 300000, reward: 15000 }, { target: 600000, reward: 30000 },
  { target: 1000000, reward: 50000 }, { target: 2500000, reward: 125000 }, { target: 5000000, reward: 250000 },
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
// Locks TWO keys for one operation, always acquiring them in the same
// deterministic (sorted) order regardless of call-site argument order --
// required so two operations that both need keyA+keyB can never deadlock
// by acquiring them in opposite orders (withLock's promise-chain "lock" has
// no timeout/detection, so an actual opposite-order acquisition would hang
// forever, not just contend). Only introduce this pattern where a single
// withLock(key) genuinely isn't enough — see /admin/user/attach-referrer's
// own comment for why it needs both users' keys.
function withLock2(keyA, keyB, fn) {
  if (keyA === keyB) return withLock(keyA, fn); // same key twice would deadlock (waits on its own tail)
  const [first, second] = [keyA, keyB].sort();
  return withLock(first, () => withLock(second, fn));
}

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
// Codex-caught real bug (2nd money-flow audit): this used to be a bare
// membership Set, added to once on any success and never re-scoped to a
// time window -- only cleared by sweepEphemeralState() once _depAttempts
// for that user goes fully empty (every attempt has aged out of the
// rolling 60s window). An active depositor who succeeds once and then
// keeps submitting at least one deposit attempt every <60s (completely
// normal usage for someone actively investing) never lets _depAttempts
// empty out, so this stayed set INDEFINITELY -- meaning the 5-rapid-
// attempts auto-ban was permanently bypassed for them, even for a much
// later, genuinely suspicious burst of failed attempts unrelated to that
// one old success. Storing the success TIMESTAMP instead lets the ban
// check verify the success actually falls within the SAME rolling window
// being evaluated -- matching this guard's own original intent ("this
// burst included a real success, don't ban for it") instead of "this
// user has EVER succeeded, don't ever ban them."
const _depAttemptsSucceededAt = new Map(); // userId -> last success timestamp
function recordDepositAttempt(userId) {
  const now = Date.now();
  const arr = (_depAttempts.get(userId) || []).filter(t => now - t < 60000);
  arr.push(now);
  _depAttempts.set(userId, arr);
  return arr.length;
}
function markDepositAttemptSucceeded(userId) { _depAttemptsSucceededAt.set(userId, Date.now()); }
function depositSucceededRecently(userId) {
  const at = _depAttemptsSucceededAt.get(userId);
  return !!at && (Date.now() - at < 60000);
}
async function banUserAutomatically(userId, reason) {
  try {
    await db.collection('users').doc(userId).update({ status: 'banned', banReason: reason, bannedAt: FieldValue.serverTimestamp() });
    console.warn(`Auto-banned ${userId}: ${reason}`);
  } catch (e) { console.error('Auto-ban failed:', e.message); }
}
// Lightweight, fire-and-forget log of a suspicious/rejected action -- feeds
// the owner-only "Suspicious activity" analytics (repeated insufficient-
// funds withdrawal attempts, repeated already-claimed check-ins, gift/promo
// code guessing). This collection already existed (read by /admin/analytics/
// abuse and purged on account deletion) but nothing ever wrote to it --
// ported from the sibling Space8 project's own equivalent, which this
// analytics tab is being brought up to parity with. Deliberately NOT
// awaited at any call site: this is pure visibility, never on the critical
// path of the actual request, and a logging failure must never turn into a
// user-facing error.
function logSecurityEvent(userId, type, meta) {
  if (!userId) return;
  db.collection('securityEvents').add({ userId, type, meta: meta || null, createdAt: FieldValue.serverTimestamp() })
    .catch(e => console.error('logSecurityEvent error:', e.message));
}
async function markDepositFailed(depRef, userId, reason) {
  // subagent-audit-caught HIGH bug: this used to overwrite status:'failed'
  // unconditionally, with no check that the deposit hadn't already been
  // credited by a DIFFERENT in-flight check (the client poll, the webhook,
  // and the reconciler each independently ask MarzPay for a live status,
  // and mobile-money providers can genuinely flip an initial timeout/expiry
  // into a later approval). If one path already credited the deposit
  // (status:'matched') right before a second, stale FAILED verdict from
  // another path landed here, this would silently flip it back to
  // 'failed' -- /deposit/marzpay/status then reports "Failed" forever
  // (its own guard short-circuits once status is 'failed', never
  // rechecking), and an admin who trusts that and clicks force-credit
  // would credit the wallet a SECOND time (force-credit's only guard,
  // depositFullyCredited(), is false once status says 'failed', not
  // 'matched'). Locked + re-checked the same way creditDeposit() claims
  // before crediting, so whichever of "credited" vs "failed" lands first
  // wins permanently and the other is a clean no-op.
  let alreadyCredited = false;
  await withLock('dep:' + depRef.id, async () => {
    const fresh = await depRef.get();
    if (fresh.exists && depositFullyCredited(fresh.data())) { alreadyCredited = true; return; }
    await depRef.update({ status: 'failed', failureReason: reason }).catch(() => {});
    // Codex-caught real bug (2nd money-flow audit): this ledger-row update
    // used to run AFTER the dep:<id> lock above was released -- a
    // concurrent creditDeposit() call (a LATER poll/webhook/reconciler tick
    // reporting the SAME deposit as genuinely succeeded, which mobile-money
    // providers really can do after an initial timeout/expiry, per this
    // function's own comment above) could acquire the lock in that gap,
    // flip status back to 'matched', credit the wallet, and write the
    // ledger row to Success -- only for THIS call's now-stale "Failed"
    // ledger update to land on top of it moments later, permanently
    // mislabeling a successfully-credited deposit as failed/zeroed even
    // though the wallet was correctly paid. Moved inside the SAME dep:
    // lock as the status flip so the two can never straddle a concurrent
    // credit landing in between.
    //
    // Flip the ledger row created up front (see /deposit/marzpay) from
    // "Processing" to "Failed" too, same as creditDeposit() does for a
    // successful match -- otherwise a failed deposit is stuck showing
    // "Processing" in Records forever. Also zero the row's `amount` --
    // subagent-audit-caught real bug: /admin/integrity's walletBalance check
    // sums EVERY transaction row's raw amount regardless of status, and
    // computeRealTotals's totalDeposited sum only filters by `type`, not
    // status -- so a failed deposit's nonzero amount permanently inflated
    // both, exactly the false-positive-that-writes-real-corruption class
    // Round 53 already fixed once for declined withdrawals
    // (finalizeWithdrawalTransactionRecord zeroes its row's amount the same
    // way, only once the outcome is final). "Recalculate totals"/"Repair
    // ledger" would otherwise bake this inflated totalDeposited into the
    // user's real document.
    try {
      const txSnap = await db.collection('transactions').where('depositId', '==', depRef.id).limit(5).get();
      await Promise.all(txSnap.docs.map(txDoc => {
        const amt = Math.abs(Number(txDoc.data().amount) || 0);
        return txDoc.ref.update({ status: 'failed', description: `Deposit: Failed (${fmtUGX(amt)})`, amount: 0 });
      }));
    } catch (e) { console.warn('markDepositFailed: could not update ledger row:', e.message); }
  });
  if (alreadyCredited) {
    console.warn(`markDepositFailed: dep=${depRef.id} was already credited by another path -- ignoring this stale FAILED verdict.`);
    // Own test-caught follow-on bug: callers used to report "Failed" to the
    // member/reconciler regardless of what actually happened here -- a
    // stale FAILED verdict that lost this exact race would otherwise show
    // "Deposit failed" to someone whose money genuinely landed, via the
    // OTHER path, moments earlier. Returning false lets every call site
    // report the real outcome instead.
    return false;
  }
  return true;
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
// Owner: "let us put on dashboard so as it checks marzpy available
// balance." GET /balance -- confirmed against MarzPay's own official
// JS SDK (marzpay-js on npm, published by MarzPay's own maintainer),
// whose real BalanceAPI.getBalance() implementation calls this exact
// path (the README's shorter accounts.getBalance() example doesn't
// actually exist as working code in that same package -- the executable
// BalanceAPI class is what's trustworthy here, not a doc-comment).
// Response shape per that SDK's own JSDoc examples:
// { data: { account: { balance: { raw, formatted, currency },
// status: { account_status } } } }. Extracted defensively (several
// plausible field paths tried, same "don't trust one exact shape"
// defensiveness _marzExtractTx already uses for this same provider) since
// this is a live external call whose exact envelope was verified against
// SDK source, not MarzPay's own docs page directly.
function _marzExtractBalance(d) {
  const acct = d?.data?.account || d?.account || d?.data || d || {};
  const bal = acct.balance;
  const raw = (bal && typeof bal === 'object') ? (bal.raw ?? bal.amount ?? bal.value) : bal;
  const formatted = (bal && typeof bal === 'object') ? bal.formatted : undefined;
  const currency = (bal && typeof bal === 'object' && bal.currency) || acct.currency || 'UGX';
  const accountStatus = acct.status?.account_status || acct.account_status || null;
  return { amount: finiteMoney(raw), formatted: formatted || null, currency, accountStatus };
}
async function marzGetBalance() {
  const resp = await fetch(`${MARZPAY_BASE}/balance`, {
    signal: AbortSignal.timeout(MARZ_TIMEOUT), headers: { 'Authorization': `Basic ${MARZPAY_KEY}` }
  });
  const d = await _marzParse(resp);
  if (d.status === 'error') return d;
  return { status: 'success', ..._marzExtractBalance(d) };
}
// ── MARZSMS (a SEPARATE MarzPay product, sms.wearemarz.com -- alerts
// staff by text, never moves money) ──
async function marzSmsSend(recipients, message) {
  const resp = await fetch(`${MARZSMS_BASE}/sms/send`, {
    method: 'POST', signal: AbortSignal.timeout(MARZ_TIMEOUT),
    headers: { 'Authorization': `Basic ${MARZSMS_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient: recipients, message }),
  });
  const data = await resp.json().catch(() => ({}));
  // MarzSms's own documented error shape is {success:false,message,error}
  // (no `status` field, unlike the wallet API) -- resp.ok is the reliable
  // signal here, not any particular body field.
  if (!resp.ok) throw new Error(data.message || data.error || `MarzSms HTTP ${resp.status}`);
  return data;
}
// Owner: "sms should be sent to all admin payment numbers to alert them
// for incoming withdrawal request to be processed, don't put number or
// details in sms to be sent just make it simple, that there is new
// pending with, please verify from management group before sending
// withdrawal and approving." Deliberately generic -- no amount, no
// phone number, no member identity -- an SMS is not a secure or private
// channel; this is purely an attention-getter telling staff to go check
// the real admin panel and the management group themselves, never a
// substitute for actually verifying there. "Admin payment numbers" are
// the same manualPaymentNumbers admins already manage for collecting
// deposits -- these are real phones admins actively watch, unlike a
// separate staff-contact list this codebase doesn't otherwise have.
// Fire-and-forget from its one call site (matches sendAdminPush's own
// convention) -- an SMS-provider hiccup must never fail or delay a
// member's real withdrawal request.
const WITHDRAWAL_SMS_ALERT_TEXT = 'New pending withdrawal request. Please verify from the management group before sending payment and approving.';
async function sendWithdrawalSmsAlert() {
  if (!MARZSMS_KEY) return;
  try {
    const numsSnap = await db.collection('manualPaymentNumbers').where('active', '==', true).get();
    const numbers = [...new Set(numsSnap.docs.map(d => d.data().number).filter(Boolean))];
    if (!numbers.length) return;
    await marzSmsSend(numbers.join(','), WITHDRAWAL_SMS_ALERT_TEXT);
  } catch (e) { console.warn('Withdrawal SMS alert failed (non-critical):', e.message); }
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

// ── LIPAPAY (mobile money collect/disburse -- a 2nd, independent automatic
// payout provider alongside MarzPay; see CLAUDE.md Round 102) ──
// CLIENT ONLY as of this commit -- nothing in server.js calls any of these
// functions yet. depositMethod/withdrawMethod, /deposit, /withdraw, the
// admin payment-method UI, and a LipaPay webhook receiver are all a
// deliberately separate follow-up round once this module itself is settled
// and, ideally, exercised against LipaPay's real dev sandbox at least once
// (this sandbox's own network policy blocks reaching dev.pay.lipapayug.com,
// so this has only been verified against a local mock server standing in
// for LipaPay -- see the money-unit note on ugxToLipaCents() below).
const LIPA_SANDBOX = String(process.env.LIPAPAY_SANDBOX || '').trim().toLowerCase() === 'true';
const LIPA_BASE = LIPA_SANDBOX ? 'http://dev.pay.lipapayug.com' : 'https://pay.lipapayug.com';
const LIPA_MCHID = (process.env.LIPAPAY_MCHID || '').trim();
const LIPA_PRIVATE_KEY = process.env.LIPAPAY_PRIVATE_KEY || '';
const LIPA_TIMEOUT = 20000;
function lipaConfigured() { return !!(LIPA_MCHID && LIPA_PRIVATE_KEY); }

// LipaPay's own API reference (Version 3.0) §5.1's Request table documents
// Amount as "Transaction amount in UGX cents (1 UGX = 100 cents)". Every
// OTHER Amount-shaped field in every RESPONSE across every endpoint in the
// same document is labelled "(UGX)" with no cents mention -- confirmed by
// hand-checking the Order Query response example's own arithmetic
// (Amount=10000, PayerCharge=101, ActualPaymentAmount=10101 -- only exact
// if these are plain UGX, not cents: 10000+101=10101). One example (5.4
// Prepaid Bill Enquiry) echoes the raw request cents value unconverted in
// its own response example, which reads as a documentation copy-paste
// artifact given its own ServiceCharge (15 at a stated 3% rate) only makes
// sense against 500 UGX, not 50000 -- but this has NOT been confirmed
// against a live response, only inferred from the document's internal
// consistency. Money-unit conversion is deliberately centralized in this
// ONE function for exactly this reason: if a live sandbox test ever proves
// this wrong, there is exactly one place to fix, not several scattered
// multiplications.
function ugxToLipaCents(amountUgx) { return Math.round(Number(amountUgx) * 100); }

// Per §3 of the doc: sign over the given fields IN THE DOCUMENTED TABLE
// ORDER for that endpoint (never alphabetical, and never JSON key order,
// which is not guaranteed to match it), Key=Value joined with '&', any
// field that is null/undefined/'' OMITTED entirely, values NOT
// URL-encoded (confirmed against the doc's own worked example -- a literal
// space in "Sand Box" appears unescaped in their signature string, verified
// byte-for-byte against their example hash before this shipped), then
// '&privateKey=<key>' appended, MD5 hex lowercase. Reused both to SIGN an
// outgoing request and to independently recompute a received Data object's
// own Sign for a first-pass sanity check.
function lipaSign(fields, order, privateKey) {
  const parts = [];
  for (const key of order) {
    const v = fields[key];
    if (v === null || v === undefined || v === '') continue;
    parts.push(`${key}=${v}`);
  }
  parts.push(`privateKey=${privateKey}`);
  return crypto.createHash('md5').update(parts.join('&'), 'utf8').digest('hex');
}
// Signature field order per endpoint, exactly as each table in the doc
// lists it (Sign itself is never included; PayMessage is explicitly called
// out by the doc as "excluded from signature" everywhere it appears).
const LIPA_FIELDS = {
  unifiedOrderReq:     ['Version', 'MchID', 'TimeStamp', 'Channel', 'OutTradeNo', 'Amount', 'TransactionType', 'TraderID', 'TraderFullName', 'Description', 'NotifyUrl'],
  unifiedOrderRespData:['OutTradeNo', 'TransactionId', 'ActualPaymentAmount', 'ActualCollectAmount', 'PayerCharge', 'PayeeCharge', 'ChannelCharge'],
  orderQueryReq:       ['Version', 'MchID', 'TimeStamp', 'OutTradeNo'],
  orderQueryRespData:  ['PayStatus', 'PayTime', 'OutTradeNo', 'TransactionId', 'Amount', 'ActualPaymentAmount', 'ActualCollectAmount', 'PayerCharge', 'PayeeCharge'],
  callbackBody:        ['PayStatus', 'PayTime', 'OutTradeNo', 'TransactionId', 'Amount', 'ActualPaymentAmount', 'ActualCollectAmount', 'PayerCharge', 'PayeeCharge'],
  billReq:             ['Version', 'MchID', 'TimeStamp', 'Channel', 'TransactionType', 'TraderID', 'Amount'],
  billRespData:        ['TraderID', 'GivenName', 'FamilyName', 'FullName', 'Amount', 'ServiceCharge', 'ServiceChargeRate'],
  balanceReq:          ['Version', 'MchID', 'TimeStamp'],
  balanceRespData:      ['Balance'],
  statementReq:        ['Version', 'MchID', 'TimeStamp', 'StartTime', 'EndTime'],
};
// Best-effort, ADVISORY sanity check only -- never the trust boundary for
// crediting money. Exact decimal-string formatting of a value we RECEIVE
// (e.g. is a fee genuinely "15" or "15.00" in LipaPay's own signing input)
// is unverified against a real server from this sandbox, so a false
// negative here is expected and must never block a legitimate credit or
// stand in for real verification. The actual trust boundary for any money
// decision is always an independent lipaOrderQuery() call against LipaPay's
// own API using our own credentials -- mirrors exactly how Round 81
// hardened the MarzPay webhook to never trust an unauthenticated body
// alone. Returns null ("couldn't check"), never a false "failed", when
// there's nothing to check against.
function lipaVerifyDataSign(data, order) {
  if (!data || !data.Sign || !LIPA_PRIVATE_KEY) return null;
  return lipaSign(data, order, LIPA_PRIVATE_KEY) === data.Sign;
}
const LIPA_PAY_STATUS = { 0: 'processing', 1: 'success', 2: 'failed' };
function lipaStatusLabel(payStatus) { return LIPA_PAY_STATUS[payStatus] || ''; }
function lipaUserMsg(resp, fallback) {
  if (!resp) return fallback || PROVIDER_BUSY_MSG;
  if (Array.isArray(resp.Errors)) return resp.Errors.join('; ') || fallback || PROVIDER_BUSY_MSG;
  return resp.Errors || fallback || PROVIDER_BUSY_MSG;
}
async function _lipaParse(resp) {
  let data;
  try { data = await resp.json(); }
  catch (_) { return { StatusCode: 0, Succeeded: false, Errors: 'Invalid response from payment gateway', Data: null, providerDown: true }; }
  if (!resp.ok && data.StatusCode == null) data.StatusCode = resp.status;
  return data;
}
async function _lipaPost(path, body) {
  const resp = await proxyFetch(`${LIPA_BASE}${path}`, {
    method: 'POST', signal: AbortSignal.timeout(LIPA_TIMEOUT),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return _lipaParse(resp);
}
function _lipaNotConfigured() {
  return { StatusCode: 0, Succeeded: false, Errors: 'LipaPay is not configured', Data: null, providerDown: true };
}
// TransactionType 1 = Collection (deposit), 2 = Disbursement (withdrawal) --
// LipaPay uses ONE endpoint for both, unlike MarzPay's separate
// collect-money/send-money routes. outTradeNo, notifyUrl and channel are
// all caller-supplied (matching marzCollect()/marzSendMoney()'s own
// caller-supplies-the-reference shape) -- this module deliberately does not
// generate order numbers itself; the calling deposit/withdrawal code is
// what owns that idempotency guarantee.
async function lipaUnifiedOrder({ transactionType, amountUgx, channel, traderId, traderFullName, description, outTradeNo, notifyUrl }) {
  if (!lipaConfigured()) return _lipaNotConfigured();
  const fields = {
    Version: 'v1.0',
    MchID: Number(LIPA_MCHID),
    TimeStamp: Math.floor(Date.now() / 1000),
    Channel: channel != null ? Number(channel) : 0,
    OutTradeNo: outTradeNo,
    Amount: ugxToLipaCents(amountUgx),
    TransactionType: Number(transactionType),
    TraderID: traderId,
    TraderFullName: traderFullName || 'NONEEDMATCHNAMES',
    Description: description || 'Mobile Money',
    NotifyUrl: notifyUrl,
  };
  const Sign = lipaSign(fields, LIPA_FIELDS.unifiedOrderReq, LIPA_PRIVATE_KEY);
  return _lipaPost('/api/pay/unifiedorder', { ...fields, Sign });
}
async function lipaCollect(opts)  { return lipaUnifiedOrder({ ...opts, transactionType: 1 }); }
async function lipaDisburse(opts) { return lipaUnifiedOrder({ ...opts, transactionType: 2 }); }
// The one LipaPay call worth an internal retry -- this IS the "find out
// what really happened" fallback, mirroring _marzFetchTxStatus()'s own
// 2-attempt-plus-backoff shape exactly. lipaCollect()/lipaDisburse() stay
// single-attempt like marzCollect()/marzSendMoney() -- retry safety there
// comes from the caller reusing the same outTradeNo (LipaPay's own 403
// duplicate-order-number rejection is the dedup guard), not an internal loop.
async function lipaOrderQuery(outTradeNo) {
  if (!lipaConfigured()) return _lipaNotConfigured();
  const fields = { Version: 'v1.0', MchID: Number(LIPA_MCHID), TimeStamp: Math.floor(Date.now() / 1000), OutTradeNo: outTradeNo };
  const Sign = lipaSign(fields, LIPA_FIELDS.orderQueryReq, LIPA_PRIVATE_KEY);
  let lastErr = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const resp = await _lipaPost('/api/pay/orderquery', { ...fields, Sign });
      if (resp && !resp.providerDown) return resp;
      lastErr = new Error(resp && resp.Errors ? String(resp.Errors) : 'providerDown');
    } catch (e) { lastErr = e; console.error(`lipaOrderQuery(${outTradeNo}) attempt ${attempt} failed:`, e.message); }
    if (attempt < 2) await new Promise(r => setTimeout(r, 350));
  }
  console.error(`lipaOrderQuery(${outTradeNo}): gave up after 2 attempts, last error:`, lastErr && lastErr.message);
  return { StatusCode: 0, Succeeded: false, Errors: lastErr ? lastErr.message : 'unreachable', Data: null, providerDown: true };
}
// Fee preview + optional name-match verification before placing a real
// order. TraderFullName is intentionally not a parameter here the way it
// is on lipaUnifiedOrder() -- the doc doesn't list it as a Bill Enquiry
// request field at all (only Unified Order accepts the
// "NONEEDMATCHNAMES"-skips-verification value); a Bill Enquiry only ever
// echoes back whatever name LipaPay itself already has on file for TraderID.
async function lipaBillEnquiry({ amountUgx, channel, transactionType, traderId }) {
  if (!lipaConfigured()) return _lipaNotConfigured();
  const fields = {
    Version: 'v1.0',
    MchID: Number(LIPA_MCHID),
    TimeStamp: Math.floor(Date.now() / 1000),
    Channel: channel != null ? Number(channel) : 0,
    TransactionType: Number(transactionType),
    TraderID: traderId,
    Amount: ugxToLipaCents(amountUgx),
  };
  const Sign = lipaSign(fields, LIPA_FIELDS.billReq, LIPA_PRIVATE_KEY);
  return _lipaPost('/api/pay/bill', { ...fields, Sign });
}
async function lipaGetBalance() {
  if (!lipaConfigured()) return _lipaNotConfigured();
  const fields = { Version: 'v1.0', MchID: Number(LIPA_MCHID), TimeStamp: Math.floor(Date.now() / 1000) };
  const Sign = lipaSign(fields, LIPA_FIELDS.balanceReq, LIPA_PRIVATE_KEY);
  return _lipaPost('/api/pay/balance', { ...fields, Sign });
}
// startDate/endDate: 'yyyyMMdd' strings, both optional (defaults to "today"
// per the doc). The doc caps the query window at 3 calendar days -- not
// enforced client-side, left for LipaPay's own 400 to surface if violated,
// matching this codebase's general "the provider is the source of truth for
// validity" posture already used for MarzPay's own error messages.
async function lipaGetStatement(startDate, endDate) {
  if (!lipaConfigured()) return _lipaNotConfigured();
  const fields = { Version: 'v1.0', MchID: Number(LIPA_MCHID), TimeStamp: Math.floor(Date.now() / 1000), StartTime: startDate || null, EndTime: endDate || null };
  const Sign = lipaSign(fields, LIPA_FIELDS.statementReq, LIPA_PRIVATE_KEY);
  return _lipaPost('/api/pay/statement', { ...fields, Sign });
}
// Snow always stores a phone as cleanPhone()'s own canonical
// "+256XXXXXXXXX" form. LipaPay's own doc (Appendix A) wants the LOCAL
// 10-digit form with a leading 0 instead ("0750000000") -- straightforward
// since the input is already validated/canonical, not re-parsing raw user
// input a second time.
function lipaTraderId(canonicalPhone) {
  const digits = String(canonicalPhone || '').replace(/\D/g, '');
  if (digits.startsWith('256') && digits.length === 12) return '0' + digits.slice(3);
  return digits; // already local, or an unexpected shape -- let LipaPay's own validation catch it
}
// Snow's own NETWORK_NAMES ('MTN Mobile Money'/'Airtel Money', already
// stored on both deposits and withdrawals) mapped to LipaPay's Channel enum.
// Anything else (not yet chosen, or a network LipaPay doesn't carry) falls
// through to 0/Auto, which the doc documents as "auto-detect by TraderID
// prefix" -- always a safe default, never a hard failure.
function lipaChannel(network) {
  if (network === 'MTN Mobile Money') return 1;
  if (network === 'Airtel Money') return 2;
  return 0;
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
      // subagent-audit-caught HIGH bug: banning a member used to have zero
      // effect on their existing investments -- this reconciler runs every
      // second platform-wide and kept crediting daily cashback into a
      // banned account's wallet for the rest of the investment's cycle
      // regardless, defeating the entire point of a ban (every money-
      // moving/data-reading endpoint checks banned status; this background
      // engine never did). Skip the WHOLE settlement (never advance
      // payoutsMade) while banned -- since this function already "catches
      // up" any missed days from real elapsed time vs. payoutsMade rather
      // than a per-day cron, simply skipping here means it resumes and
      // catches up naturally the moment the account is unbanned, no
      // special-case resume logic needed.
      const uSnap = await db.collection('users').doc(f.userId).get();
      if (!uSnap.exists || uSnap.data().status === 'banned') return;
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
        // Nested under bal:<userId> so this credit can't interleave with a
        // concurrent absolute-value rewrite of the same totals (repair-ledger,
        // recountAllTotals) reading stale data mid-increment (see those
        // functions' own bal: locking and CLAUDE.md's Round 17/19 notes).
        await withLock('bal:' + f.userId, () => db.collection('users').doc(f.userId).update({
          walletBalance: FieldValue.increment(amount), totalEarned: FieldValue.increment(amount)
        }));
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
// Returns whether this call actually paid a NEW level (false for a no-op
// re-check, e.g. everything already paid, buyer/level ineligible, or no
// referrer at all) -- callers that report "commission credited" to an
// admin/owner should use this instead of assuming a qualifying investment
// existing means money moved.
async function creditReferralCommission(investmentId, buyerId, amount) {
  return withLock('comm:' + investmentId, async () => {
    let paidAny = false;
    const invRef = db.collection('investments').doc(investmentId);
    const invSnap = await invRef.get();
    if (!invSnap.exists) return paidAny;
    if (invSnap.data().isFirstInvestment !== true) { await invRef.update({ commissionPending: false }); return paidAny; }
    const paidLevels = invSnap.data().commissionPaidLevels || [];

    const sett = await getSettings();
    const buyerSnap = await db.collection('users').doc(buyerId).get();
    if (!buyerSnap.exists) { await invRef.update({ commissionPending: false }); return paidAny; }
    // Codex-caught real bug: banning the BUYER used to close commissionPending
    // permanently too, exactly the same class of bug the chain-level ban check
    // below was fixed for (Round 79) -- a buyer ban is a temporary block on
    // THAT account, not a fraud reversal of an already-genuine first purchase;
    // nothing in this codebase invalidates the investment doc itself when its
    // owner is banned. The referrer earned this commission on a real purchase
    // that already happened -- they should not permanently lose it just
    // because the buyer was later banned for something unrelated. Leave
    // commissionPending true so reconcileCommissions() retries once the
    // buyer is unbanned -- but mark commissionBanBlocked so that reconciler
    // (see its own comment) can skip re-querying this row every single tick
    // while nothing has changed.
    if (buyerSnap.data().status === 'banned') {
      await invRef.update({ commissionBanBlocked: true }).catch(() => {});
      return paidAny;
    }
    const l1Id = buyerSnap.data().referredBy;
    if (!l1Id) { await invRef.update({ commissionPending: false }); return paidAny; }
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
    let anyLevelBlockedByBan = false;
    for (let i = 0; i < chain.length; i++) {
      if (paidLevels.indexOf(i) !== -1) continue;
      const { id, snap } = chain[i];
      if (!snap.exists) continue;
      // Codex-caught real bug: this used to check ban status BEFORE the
      // commission rate, so a banned account sitting at a level whose rate
      // is currently 0% would still mark anyLevelBlockedByBan -- keeping
      // commissionPending open forever for an investment that has nothing
      // left to actually pay at that level regardless of ban status. A
      // zero-rate level is permanently resolved (nothing owed) no matter
      // what the account's status is -- check that first.
      const pct = Number(rates[i]) || 0;
      if (pct <= 0) continue;
      // A referrer banned at this exact instant is a TEMPORARY block, not a
      // permanent forfeiture -- see the anyLevelBlockedByBan comment below.
      if (snap.data().status === 'banned') { anyLevelBlockedByBan = true; continue; }
      const reward = Math.round(amount * pct / 100);
      if (reward <= 0) continue;
      await invRef.update({ commissionPaidLevels: FieldValue.arrayUnion(i) });
      // Nested under bal:<id> -- see settleInvestmentIfDue's own comment.
      await withLock('bal:' + id, () => db.collection('users').doc(id).update({
        walletBalance: FieldValue.increment(reward), teamCommission: FieldValue.increment(reward),
        totalEarned: FieldValue.increment(reward)
      }));
      await db.collection('transactions').add({
        userId: id, type: 'commission', description: `Level ${i + 1} reward`,
        amount: reward, status: 'success', date, time, investmentId, createdAt: FieldValue.serverTimestamp()
      });
      paidAny = true;
    }
    // Only close out commissionPending once every unpaid level has been
    // genuinely resolved (paid, or permanently ineligible -- a nonexistent
    // chain slot or a zero commission rate). A level skipped because that
    // referrer was BANNED at this exact instant is NOT resolved -- leave
    // commissionPending untouched (still true) so reconcileCommissions()
    // (runs every 30s) retries this investment and pays them the moment
    // they're unbanned. Mirrors settleInvestmentIfDue()'s own documented
    // "catches up naturally once unbanned" pattern for the identical class
    // of timing (see its own comment). Without this, a referrer banned at
    // the wrong instant would silently and PERMANENTLY forfeit commission
    // they were genuinely owed, even after being unbanned -- nothing would
    // ever look at this investment again once commissionPending flips false.
    if (anyLevelBlockedByBan) {
      // Codex-caught real bug: leaving commissionPending:true for every
      // ban-blocked investment (this one, and the buyer-banned branch
      // above) means the 30s reconciler's oldest-500-first query could, at
      // real scale, keep re-selecting the SAME long-stuck (still-banned)
      // rows every single tick forever, permanently starving genuinely new
      // pending commissions out of ever being reached once the backlog of
      // still-banned rows exceeds the query's own limit. commissionBanBlocked
      // lets reconcileCommissions() explicitly skip rows it already knows
      // are blocked (see that query's own comment) without needing this
      // investment to ever leave commissionPending, and without needing a
      // timestamp/backoff scheme that would risk silently excluding every
      // pre-existing pending investment that predates this field.
      await invRef.update({ commissionBanBlocked: true }).catch(() => {});
    } else {
      await invRef.update({ commissionPending: false });
    }
    return paidAny;
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
    // subagent-audit-caught: was missing the banned check every sibling
    // data-reading route (`/account`, `/investments`, `/team/stats`, etc.) has.
    const uSnap = await db.collection('users').doc(userId).get();
    if (uSnap.exists && uSnap.data().status === 'banned')
      return res.status(403).json({ status: 'error', code: 'BANNED', message: 'Account suspended. Contact customer service.' });
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
    // subagent-audit-caught: was missing the banned check every sibling
    // data-reading route has.
    if (u.status === 'banned')
      return res.status(403).json({ status: 'error', code: 'BANNED', message: 'Account suspended. Contact customer service.' });
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
      // Nested under bal:<userId> -- see settleInvestmentIfDue's own comment.
      await withLock('bal:' + userId, () => db.runTransaction(async t => {
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
      }));
    });
    if (stillShort) return res.status(400).json({ status: 'error', message: 'Your progress changed just now. Please try again.' });
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
      if (u.missionSalaryLastClaim === today) { result = { code: 400, body: { status: 'error', message: "Already claimed today's salary. Come back after 00:00." } }; return; }
      const count = await activeL1Count(userId);
      const amount = Math.min(count, MISSION_SALARY_REFERRAL_CAP) * MISSION_SALARY_RATE;
      if (amount <= 0) { result = { code: 400, body: { status: 'error', message: 'You need at least one active referral to claim a daily salary.' } }; return; }
      // Nested under bal:<userId> -- see settleInvestmentIfDue's own comment.
      await withLock('bal:' + userId, () => uRef.update({ walletBalance: FieldValue.increment(amount), totalEarned: FieldValue.increment(amount), missionSalaryLastClaim: today }));
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
      // Nested under bal:<userId> -- see settleInvestmentIfDue's own comment.
      await withLock('bal:' + userId, () => db.runTransaction(async t => {
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
      }));
    });
    if (stillShort) return res.status(400).json({ status: 'error', message: 'Your progress changed just now. Please try again.' });
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
    res.json({ status: 'success', settings: { ...rest, maintenanceMsg: s.maintenanceMode ? maintenanceMsg : '', payoutManual: payoutIsManual(s) } });
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
app.get('/public/help-banner', async (_req, res) => {
  try { res.json({ status: 'success', image: await getHelpBanner() }); }
  catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
// Prefetched in boot()'s own Promise.all alongside /public/banner, so it's
// ready with zero added visible latency by the time the announcement dialog
// itself checks STATE.settings and decides to show (same reasoning as the
// Home banner) -- not lazy-loaded like the Help Centre banner, since that
// would reintroduce the "waits before appearing" complaint this dialog's
// own timing was already fixed for in an earlier round.
app.get('/public/announcement-image', async (_req, res) => {
  try { res.json({ status: 'success', image: await getAnnouncementImage() }); }
  catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
// Both slots in one call (not two round trips) -- fetched unconditionally
// inside boot()'s own Promise.all, same "cheap when unset" tradeoff every
// other banner-style image already accepts, so a member who reaches the
// manual-deposit flow moments after boot never sees a pop-in.
app.get('/public/manual-pay-images', async (_req, res) => {
  try {
    const [selector, hero] = await Promise.all([getManualPayImage('selector'), getManualPayImage('hero')]);
    res.json({ status: 'success', selector, hero });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
// Lazy-loaded only when a member actually opens the About page -- not part
// of /public/settings, see getAboutContent()'s own comment for why.
app.get('/public/about-content', async (_req, res) => {
  try { res.json({ status: 'success', blocks: await getAboutContent() }); }
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
    checkinStreak: 0, lastCheckinAt: null,
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
    // Locked on the same 'reg:'+userId key as registration itself -- an
    // unconditional .set() here without the lock (the old behaviour) could
    // race a concurrent /register and wipe a just-completed registration
    // (registrationDone/walletBalance/referralCode) back to a fresh default
    // doc. Re-checks existence AFTER acquiring the lock, not before.
    await withLock('reg:' + userId, async () => {
      const ref = db.collection('users').doc(userId);
      const snap = await ref.get();
      if (snap.exists) return;
      await ref.set(defaultProfileDoc(phone));
    });
    res.json({ status: 'success' });
  } catch (e) {
    console.error('create-profile error:', e.message);
    res.status(500).json({ status: 'error', message: 'Could not create your profile' });
  }
});
// Shared by the member's own /register — the ONE place that ever assigns a
// referral code, links a referrer's team counts, sets the Transaction PIN,
// or credits the welcome bonus.
// `phone` is only used to create the profile doc if it's genuinely still
// missing -- creation MUST happen inside this same 'reg:'+userId lock, not
// before it (two concurrent /register calls for a brand-new user, e.g. a
// slow first load racing a page reload, both used to read "doc missing"
// and then unconditionally .set() a fresh default doc AFTER completion had
// already landed, wiping registrationDone/walletBalance/referralCode back
// to defaults and letting the second call register -- and pay the welcome
// bonus -- a second time).
async function completeRegistrationCore(userId, referralCode, pin, phone) {
  return withLock('reg:' + userId, async () => {
    const userRef = db.collection('users').doc(userId);
    let userSnap = await userRef.get();
    if (!userSnap.exists) {
      await userRef.set(defaultProfileDoc(phone));
      userSnap = await userRef.get();
    }
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
    const phone = phoneFromVerifiedEmail(auth.email, req.body.phone);
    const result = await completeRegistrationCore(userId, req.body.referralCode, req.body.pin, phone);
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
    // subagent-audit-caught: this used to run settleAllForUser() (which
    // credits any due cashback) BEFORE checking banned status -- the banned
    // check only decided whether to show the result, not whether to credit
    // it. settleInvestmentIfDue() itself now refuses to credit a banned
    // account regardless of caller, so this reordering is defense-in-depth
    // (and skips the wasted settlement work entirely for a banned account),
    // not the only thing standing between a ban and a payout.
    const preSnap = await db.collection('users').doc(uid).get();
    if (!preSnap.exists) return res.status(404).json({ status: 'error', code: 'NOT_FOUND', message: 'User not found' });
    if (preSnap.data().status === 'banned')
      return res.status(403).json({ status: 'error', code: 'BANNED', message: 'Account suspended. Contact customer service.' });
    await settleAllForUser(uid);
    const snap = await db.collection('users').doc(uid).get();
    if (!snap.exists) return res.status(404).json({ status: 'error', code: 'NOT_FOUND', message: 'User not found' });
    const u = snap.data();
    if (u.status === 'banned')
      return res.status(403).json({ status: 'error', code: 'BANNED', message: 'Account suspended. Contact customer service.' });
    res.json({ status: 'success', account: {
      phone: u.phone, walletBalance: u.walletBalance || 0, totalDeposited: u.totalDeposited || 0,
      totalEarned: u.totalEarned || 0, totalWithdrawn: u.totalWithdrawn || 0, totalInvested: u.totalInvested || 0,
      checkinStreak: u.checkinStreak || 0, lastCheckinAt: u.lastCheckinAt || null,
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
      // Codex-caught real bug (2nd money-flow audit): computeCheckinStreak()
      // walks this ledger window and, if every row in it turns out to be
      // contiguous (no real gap), simply runs out of rows to walk -- it has
      // no way to tell "the streak legitimately ends here" apart from "the
      // query just stopped returning more rows." At a 500-row cap, a member
      // who checks in every single day without ever missing one would have
      // their streak permanently stick at 501 the moment they cross it (day
      // 501's window is 500 contiguous rows -> reports 500 -> +1 -> 501; day
      // 502's window is STILL 500 contiguous rows, just shifted by one ->
      // reports 500 again -> +1 -> 501 again, forever). Bumped to a
      // practically-unreachable ceiling (13+ years of unbroken daily
      // check-ins) rather than building real pagination for it -- same
      // "generous cap, not a rewrite" tradeoff already used elsewhere in
      // this file (e.g. /admin/referrals/list). Also bumped at this
      // function's two other copies (admin reconcile-checkin,
      // recountAllTotals's own freshness re-check) so all three can never
      // disagree about what "the real streak" is.
      const ledgerSnap = await db.collection('transactions')
        .where('userId', '==', uid).where('type', '==', 'checkin').orderBy('createdAt', 'desc').limit(5000).get();
      const stamps = ledgerSnap.docs.map(d => tsMillis(d.data().createdAt)).filter(Boolean);
      const real = computeCheckinStreak(stamps);
      const now = Date.now();
      // Owner: "make daily checkin to reset at 00:00 not 24hrs" -- gate and
      // streak both compare EAT calendar days now, not a rolling 24h/48h
      // window (see computeCheckinStreak's own header comment for why).
      const todayKey = eatDayKey(new Date(now));
      const lastKey = real.lastCheckinAt ? eatDayKey(new Date(real.lastCheckinAt)) : null;
      if (lastKey === todayKey) {
        logSecurityEvent(uid, 'checkin_already_claimed', null);
        result = { code: 400, body: { status: 'error', message: 'Already checked in today. Come back after midnight.', nextCheckinAt: eatNextMidnight(now) } };
        return;
      }
      const yesterdayKey = eatDayKey(new Date(now - 86400000));
      const streak = (lastKey === yesterdayKey) ? real.streak + 1 : 1;
      const bonus = Number(sett.dailyCheckin) || 0;
      // Nested under bal:<uid> -- see settleInvestmentIfDue's own comment.
      await withLock('bal:' + uid, () => ref.update({ walletBalance: FieldValue.increment(bonus), totalEarned: FieldValue.increment(bonus), lastCheckinAt: now, checkinStreak: streak }));
      const { date, time } = nowStr();
      await db.collection('transactions').add({
        userId: uid, type: 'checkin', description: `Daily check-in, day ${streak}`,
        amount: bonus, status: 'success', date, time, createdAt: FieldValue.serverTimestamp()
      });
      result = { code: 200, body: { status: 'success', bonus, streak, nextCheckinAt: eatNextMidnight(now) } };
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
    // NOT db.runTransaction -- that helper just runs queued ops sequentially
    // with no rollback (M0 has no real multi-document transactions), so it
    // gave no real protection here anyway. Awaiting the debit directly lets
    // this catch a failure in the writes AFTER it and issue an exact
    // compensating refund, instead of silently leaving the user charged for
    // an investment that was never actually created.
    await withLock('bal:' + userId, async () => {
      liveTier = await getProductByKey(tier.key);
      if (!liveTier || liveTier.active === false || liveTier.comingSoon) throw new Error('This product is not available right now.');
      cycle = Number(liveTier.cycle) || sett.cycleDays;
      expectedReturn = Number(liveTier.expectedReturn) || Math.round(liveTier.price * sett.returnMultiple);
      dailyPayout = Math.round(expectedReturn / cycle);
      const uRef = db.collection('users').doc(userId);
      const fresh = await uRef.get();
      if (!fresh.exists) throw new Error('User not found');
      if (fresh.data().status === 'banned') { const banErr = new Error('Account suspended. Contact customer service.'); banErr.code = 'BANNED'; throw banErr; }
      const bal = fresh.data().walletBalance || 0;
      if (bal < liveTier.price) throw new Error(`Need ${fmtUGX(liveTier.price)}, have ${fmtUGX(bal)}`);
      const wasFirstInvestmentDone = fresh.data().firstInvestmentDone === true;
      const isFirstInvestment = !(wasFirstInvestmentDone || (fresh.data().totalInvested || 0) > 0);
      const invRef = db.collection('investments').doc();
      invId = invRef.id;
      // Debited via increment(), not an absolute newBalance write, so a
      // concurrent credit from a different lock key (deposit, commission)
      // landing mid-transaction can never be silently overwritten.
      await uRef.update({ walletBalance: FieldValue.increment(-liveTier.price), totalInvested: FieldValue.increment(liveTier.price), firstInvestmentDone: true });
      const { date, time } = nowStr();
      try {
        await invRef.set({
          userId, tierKey: liveTier.key, tierLabel: liveTier.name, amount: liveTier.price, cycle, expectedReturn,
          status: 'active', dailyPayout, payoutsTotal: cycle, payoutsMade: 0, paidOut: 0,
          isFirstInvestment, commissionPaidLevels: [], commissionPending: isFirstInvestment === true,
          date, time, createdAt: FieldValue.serverTimestamp()
        });
        await db.collection('transactions').add({
          userId, type: 'investment', description: `Bought ${liveTier.name}`, amount: -liveTier.price,
          status: 'success', date, time, investmentId: invRef.id, createdAt: FieldValue.serverTimestamp()
        });
      } catch (createErr) {
        // Codex-caught real bug: invRef.set() can succeed while the
        // following transactions.add() throws -- the refund below fixes the
        // wallet, but WITHOUT this delete the investments doc stays behind
        // with status:'active', a free plan with no matching debit that
        // would still earn cashback and mature normally.
        await invRef.delete().catch(delErr => {
          console.error(`MONEY-SAFETY: investment ${invRef.id} ledger-row write failed AND the investment doc itself could not be deleted -- a free undebited active investment may be left behind for user ${userId}. Manual fix required.`, delErr.message);
        });
        await uRef.update({ walletBalance: FieldValue.increment(liveTier.price), totalInvested: FieldValue.increment(-liveTier.price), firstInvestmentDone: wasFirstInvestmentDone }).catch(compErr => {
          console.error(`MONEY-SAFETY: investment ${invRef.id} creation failed AFTER debiting user ${userId} ${liveTier.price}, and the compensating refund ALSO failed -- wallet is short by ${liveTier.price}. Manual fix required.`, compErr.message);
        });
        throw createErr;
      }
    });
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
    // subagent-audit-caught: this was the one route that read/settled a
    // member's investments with NO banned check at all, unlike /account,
    // /checkin, /invest/create, /withdraw/request, /bank/*, /redeem,
    // /mission/*. A banned member's still-valid session could keep polling
    // this directly to both see their full plan data and trigger the same
    // on-demand cashback settlement /account does.
    const uSnap = await db.collection('users').doc(uid).get();
    if (!uSnap.exists) return res.status(404).json({ status: 'error', code: 'NOT_FOUND', message: 'User not found' });
    if (uSnap.data().status === 'banned')
      return res.status(403).json({ status: 'error', code: 'BANNED', message: 'Account suspended. Contact customer service.' });
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
    // Real gap found while adding LipaPay as a 2nd automatic provider (Round
    // 102): this route never actually checked whether PAY A was even
    // enabled -- a direct call here used to always go straight through the
    // automatic provider regardless of the admin's own settings, silently
    // bypassing intent. Round 145 widened this from a single exclusive
    // depositMethod choice to an independent depositPayAEnabled flag (PAY A
    // and PAY B -- manual -- can now both be live at once). Mirrors
    // /deposit/manual/init's own symmetric guard below.
    if (!sett.depositPayAEnabled) return res.status(400).json({ status: 'error', message: 'Automatic recharges are not enabled right now.' });
    const provider = depositAutomaticProvider(sett);

    // Validate BEFORE touching the debounce/abuse-attempt counters below --
    // a below-minimum amount or a missing phone number must never consume a
    // debounce slot or count toward the auto-ban threshold. Before this fix
    // EVERY call reached those counters first regardless of outcome, so a
    // member who simply typed too little then immediately retried with the
    // real minimum hit a false "already being processed" (the failed
    // attempt had already claimed the debounce window on a deposit that was
    // never actually created), and a couple more retries after that could
    // rack up enough recorded "attempts" to trip the 5-in-a-minute auto-ban
    // -- getting suspended for nothing more than fumbling the minimum
    // amount. Owner: "when you try to deposit with little amount, it says
    // minimum deposit is 30k, when you try again deposit with that very
    // minimum amount, it says deposit is already being processed!!, when
    // you try again once more it says account suspended."
    if (amt < sett.minDeposit) return res.status(400).json({ status: 'error', message: `Minimum amount is ${fmtUGX(sett.minDeposit)}` });
    const phone = cleanPhone(req.body.phone || uSnap.data().phone || '');
    if (!phone) return res.status(400).json({ status: 'error', message: 'Enter a valid mobile-money phone number.' });

    // subagent-audit-caught: the debounce check must run BEFORE
    // recordDepositAttempt() too, not just the amount/phone validation
    // above -- otherwise a request that's rejected ONLY by the 7s debounce
    // (nothing wrong with it, just too soon after the last one) still
    // counted as an "attempt" toward the 5-in-a-minute auto-ban, leaving
    // the exact false-ban chain this function's own comment above claims
    // to have closed still reachable through the debounce path alone: one
    // real deposit that's slow to confirm, followed by a few impatient
    // resubmits that each get bounced by the debounce, could still add up
    // to 5 recorded "attempts" and trip the ban.
    const lastDep = _depCreateDebounce.get(userId) || 0;
    if (Date.now() - lastDep < 7000)
      return res.status(429).json({ status: 'error', message: 'A deposit is already being processed. Please wait a moment.' });

    const attemptCount = recordDepositAttempt(userId);
    if (attemptCount >= 5 && !depositSucceededRecently(userId)) {
      await banUserAutomatically(userId, 'Automatic: 5+ deposit attempts within a minute, none completed');
      return res.status(403).json({ status: 'error', code: 'BANNED', message: 'Account suspended. Contact customer service.' });
    }
    _depCreateDebounce.set(userId, Date.now());

    const ref = await uniqueRef('S');
    const marzReference = crypto.randomUUID();
    const { date, time } = nowStr();
    const depRef = db.collection('pendingDeposits').doc();
    const network = NETWORK_NAMES.has(req.body.network) ? req.body.network : null;
    await depRef.set({
      userId, phone, network, amount: amt, ref, marzReference, status: 'initiating', provider,
      date, time, createdAt: FieldValue.serverTimestamp()
    });
    // Owner: "deposits are not recorded why" -- withdrawals have always
    // shown up in Records immediately, as "Processing", the instant they're
    // requested; deposits used to only get a ledger row once fully
    // credited, so anything still pending (or that failed at the provider)
    // was invisible the whole time. Mirrors withdrawal's own
    // create-now/finalize-later row exactly, keyed on depositId instead of
    // withdrawalId. Awaited (unlike a fire-and-forget write) so the row is
    // guaranteed to exist by the time the response reaches the client and
    // Records is checked -- "recorded immediately" has to mean immediately,
    // not "eventually, if a later read happens to lose the race." No
    // compensating rollback needed if this write itself fails (unlike
    // withdrawal, no money has moved yet at this point) --
    // creditDeposit()'s own find-or-create step below covers that case.
    await db.collection('transactions').add({
      // displayAmount is a separate, never-zeroed copy of the real amount --
      // markDepositFailed() zeroes `amount` itself (see its own comment) so
      // the walletBalance/totalDeposited integrity math stays honest, but
      // Records' own amount column reads THIS field so a failed deposit
      // still shows what was actually attempted instead of "+UGX 0".
      userId, type: 'deposit', description: `Deposit: Processing (${fmtUGX(amt)})`,
      amount: amt, displayAmount: amt, status: 'pending', date, time, ref, depositId: depRef.id, createdAt: FieldValue.serverTimestamp()
    }).catch(e => console.error(`Deposit ledger row create failed for dep=${depRef.id}:`, e.message));
    // Respond the instant our own write lands — do not wait on the provider's
    // own round-trip. The status screen's own polling picks up the resolution.
    res.json({ status: 'success', depositId: depRef.id, reference: ref, message: 'Payment initiated. Check your phone.' });

    if (provider === 'lipapay') {
      // LipaPay branch -- same "claim as pending, wait for the webhook/
      // reconciler to resolve it" shape as MarzPay just below, via
      // lipaCollect() instead of marzCollect(). OutTradeNo is the deposit's
      // OWN doc id (a crypto.randomUUID(), already exactly LipaPay's
      // required 6-36-char allowed-charset shape) rather than a freshly
      // generated value, so a genuine retry of this same deposit reuses the
      // identical OutTradeNo and LipaPay's own duplicate-order rejection
      // (StatusCode 403) is what guards against a double submission, not an
      // internal retry loop.
      let lpData;
      try {
        lpData = await lipaCollect({
          amountUgx: amt, traderId: lipaTraderId(phone), channel: lipaChannel(network),
          description: 'Mobile Money', outTradeNo: depRef.id,
          notifyUrl: PUBLIC_URL ? PUBLIC_URL + '/deposit/lipapay/callback' : undefined,
        });
      } catch (netErr) {
        console.error('LipaPay unified-order network error (dep ' + depRef.id + '):', netErr.message);
        return;
      }
      if (!lpData.Succeeded) {
        console.error('LipaPay unified-order rejected:', JSON.stringify(lpData));
        await markDepositFailed(depRef, userId, lipaUserMsg(lpData, 'Could not start the payment'));
        return;
      }
      const lipaTransactionId = lpData.Data?.TransactionId || null;
      // Same claim-race protection as the MarzPay branch below -- a webhook
      // racing ahead and already crediting this exact deposit must never be
      // silently reverted back to 'pending' by this later write.
      await withLock('dep:' + depRef.id, async () => {
        const fresh = await depRef.get();
        if (fresh.exists && fresh.data().status === 'initiating') {
          await depRef.update({ status: 'pending', lipaTransactionId });
        } else {
          await depRef.update({ lipaTransactionId }).catch(() => {});
        }
      });
      return;
    }

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
    // subagent-audit-caught: this used to overwrite `status` unconditionally
    // -- if a webhook raced ahead (via the webhookUuid fallback path, see
    // /deposit/callback) and already credited this exact deposit
    // (status:'matched') before this write landed, it would silently revert
    // status back to 'pending'. The next poll/reconciler check would then
    // see an uncredited-looking deposit and call creditDeposit() again,
    // crediting the wallet a second time. Locked + re-checked the same way
    // creditDeposit()/markDepositFailed() claim before acting, so whichever
    // outcome (credited vs. this "still initiating, now pending") lands
    // first wins permanently.
    await withLock('dep:' + depRef.id, async () => {
      const fresh = await depRef.get();
      if (fresh.exists && fresh.data().status === 'initiating') {
        await depRef.update({ status: 'pending', marzTxUuid });
      } else {
        await depRef.update({ marzTxUuid }).catch(() => {});
      }
    });
  } catch (e) {
    console.error('Deposit error:', e.message);
    if (!res.headersSent) res.status(500).json({ status: 'error', message: PROVIDER_BUSY_MSG });
  }
});
const _creditingDeposits = new Set();
// A deposit is only genuinely DONE once the wallet was actually credited --
// status alone reaching 'matched' is not enough, because CLAIM-BEFORE-CREDIT
// below deliberately flips status first and can leave it 'matched' with
// needsManualCredit:true if the wallet write itself then fails. Treating
// bare status==='matched' as "done" (the old behaviour) made that stuck
// state permanently unrecoverable: every future call here, and
// /admin/deposit/force-credit's own guard, both short-circuited on status
// alone and never retried the actual credit.
function depositFullyCredited(d) { return d.status === 'matched' && !d.needsManualCredit; }
async function creditDeposit(depDoc) {
  const dep = depDoc.data();
  if (depositFullyCredited(dep)) return true;
  if (_creditingDeposits.has(depDoc.id)) return false;
  _creditingDeposits.add(depDoc.id);
  try {
    let credited = false, justCredited = false, creditedAmount = 0;
    await withLock('dep:' + depDoc.id, async () => {
      const fresh = await depDoc.ref.get();
      if (!fresh.exists) { credited = false; return; }
      const fd = fresh.data();
      if (depositFullyCredited(fd)) { credited = true; return; }
      const depUserId = fd.userId;
      const depAmount = Number(fd.amount) || 0;
      const retryingStuckCredit = fd.status === 'matched' && fd.needsManualCredit === true;
      // CLAIM-BEFORE-CREDIT: flip to 'matched' before touching the wallet, so
      // a retry from the webhook, the client poll, or the reconciler is a
      // clean no-op instead of a double credit. Skipped when we're already
      // retrying a stuck credit -- status is 'matched' already, re-setting
      // creditedAt would misreport when this deposit actually completed.
      if (!retryingStuckCredit) {
        await depDoc.ref.update({ status: 'matched', creditedAt: FieldValue.serverTimestamp() });
      }
      // subagent-audit-caught CRITICAL bug: `retryingStuckCredit` only ever
      // gated the status-flip above, never the wallet increment itself --
      // but `needsManualCredit` gets set for TWO different failure reasons
      // (the wallet increment throwing, below; OR the ledger-row step
      // throwing further down, AFTER the wallet was already credited). A
      // retry triggered by the SECOND reason (self-heal poll, reconciler,
      // webhook redelivery, admin force-credit) re-ran this whole function
      // body including the wallet increment -- crediting the same deposit
      // TWICE. `walletCredited` makes the increment itself idempotent
      // regardless of which reason triggered the retry, closing that
      // permanently.
      if (!fd.walletCredited) {
        try {
          // Codex-caught real bug: the wallet increment and the
          // walletCredited:true marker used to be TWO separate writes -- if
          // the increment landed but the process crashed (or this specific
          // write failed) before the marker write, needsManualCredit could
          // stay true with walletCredited still false, and a LATER retry
          // would re-run the increment a second time for the same deposit.
          // updateIf() makes this ONE atomic conditional update: the wallet
          // is only ever incremented if this exact depositId is not already
          // in creditedDepositIds, and the id is added in the SAME atomic
          // operation -- there is no window where one half landed without
          // the other. `applied:false` means this exact credit already
          // happened (a safe, idempotent retry), not an error.
          const applied = await withLock('bal:' + depUserId, () => db.collection('users').doc(depUserId).updateIf(
            { creditedDepositIds: { $ne: depDoc.id } },
            {
              walletBalance: FieldValue.increment(depAmount), totalDeposited: FieldValue.increment(depAmount),
              creditedDepositIds: FieldValue.arrayUnion(depDoc.id),
            }
          ));
          if (!applied) {
            // Codex-caught real bug (2nd money-flow audit): updateIf()
            // returning false means EITHER "already applied" (the idempotency
            // token is already there -- genuinely safe) OR "no document
            // matched _id at all" (the user was deleted) -- these are NOT the
            // same thing, but this used to treat every false as the safe
            // case. If the user document is gone, the money has nowhere to
            // go; blindly marking walletCredited:true here would silently
            // and permanently lose it with no further retry ever attempted.
            // Re-read to tell the two cases apart before trusting a false as
            // safe -- an extremely narrow window in practice (would require
            // /admin/user/delete's own in-flight-deposit guard to somehow
            // miss a deposit mid-credit), but a real distinction to make
            // regardless of how rarely it's hit.
            const recheck = await db.collection('users').doc(depUserId).get();
            const tokenPresent = recheck.exists && (recheck.data().creditedDepositIds || []).includes(depDoc.id);
            if (!tokenPresent) {
              throw new Error(`Deposit ${depDoc.id} wallet credit could not be verified -- user ${depUserId} document is missing (or the idempotency token is absent) after updateIf() reported no match.`);
            }
            console.warn(`Deposit ${depDoc.id} wallet credit already applied (idempotent retry) -- skipped re-incrementing.`);
          }
          await depDoc.ref.update({ walletCredited: true }).catch(() => {});
        } catch (creditErr) {
          await depDoc.ref.update({ needsManualCredit: true }).catch(() => {});
          console.error(`DEPOSIT CREDIT FAILED (needs manual credit) dep=${depDoc.id} user=${depUserId} amount=${depAmount}:`, creditErr.message);
          throw creditErr;
        }
      }
      // The ledger row was already created up front, at deposit-request
      // time (mirrors the withdrawal flow) -- find it by depositId and flip
      // it to Success rather than adding a second row. Idempotent by
      // design (find-or-create keyed on depositId, not on a one-shot
      // "did we already add a row" branch), so retrying this after a
      // transient failure -- the ledger write itself throwing right after
      // the wallet was already credited, or a very old deposit that
      // predates this row existing at all -- can never leave the deposit
      // permanently invisible in Records, which is exactly the bug the
      // owner hit ("deposits are not recorded why").
      try {
        const txSnap = await db.collection('transactions').where('depositId', '==', depDoc.id).limit(5).get();
        if (!txSnap.empty) {
          // Codex-caught real bug: if this row had already been zeroed by
          // markDepositFailed() (a stale FAILED verdict, later overridden
          // by a genuine success or an owner's force-credit), only status/
          // description were restored here -- amount stayed at the 0 that
          // failure left behind. computeRealTotals()/recountAllTotals() sum
          // `amount`, not `displayAmount`, so this deposit would silently
          // contribute nothing to totalDeposited even though the wallet was
          // just credited the full amount -- and a later "Recalculate
          // totals" run would then WRITE that too-low figure into the
          // user's real totalDeposited, turning a display-only gap into
          // stored corruption. Restore both fields explicitly so a success
          // outcome always means the ledger row reflects what actually
          // happened, regardless of what state it was in before.
          await Promise.all(txSnap.docs.map(txDoc => txDoc.ref.update({
            status: 'success', description: `Deposit: Success (${fmtUGX(depAmount)})`,
            amount: depAmount, displayAmount: depAmount,
          })));
        } else {
          const { date, time } = nowStr();
          await db.collection('transactions').add({
            userId: depUserId, type: 'deposit', description: `Deposit: Success (${fmtUGX(depAmount)})`,
            amount: depAmount, displayAmount: depAmount, status: 'success', date, time, ref: fd.ref, depositId: depDoc.id,
            createdAt: FieldValue.serverTimestamp()
          });
        }
      } catch (ledgerErr) {
        // Wallet is already credited above -- never let a ledger-row
        // hiccup here look like the deposit never happened. Flag for
        // retry the same way a wallet-increment failure does; the
        // status-poll's own self-heal branch (and the periodic
        // reconciler) will retry this exact idempotent update next time.
        await depDoc.ref.update({ needsManualCredit: true }).catch(() => {});
        console.error(`DEPOSIT LEDGER ROW UPDATE FAILED (needs manual credit) dep=${depDoc.id} user=${depUserId} amount=${depAmount}:`, ledgerErr.message);
        throw ledgerErr;
      }
      await depDoc.ref.update({ needsManualCredit: FieldValue.delete() }).catch(() => {});
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
    if (dep.status === 'matched') {
      // Best-effort self-heal: if a prior credit attempt got the status to
      // 'matched' but failed to actually pay the wallet (needsManualCredit),
      // retry it here so the user's own poll loop -- which normally stops
      // the instant it sees 'matched' -- has a real chance to fix this
      // without needing an admin to notice first. Never let a retry failure
      // here turn into an error response; the deposit did genuinely match
      // at the gateway, the periodic reconciler keeps retrying regardless.
      if (dep.needsManualCredit) await creditDeposit(depSnap).catch(() => {});
      return res.json({ status: 'success', state: 'matched' });
    }
    if (dep.status === 'failed')  return res.json({ status: 'success', state: 'failed', message: dep.failureReason });
    // Subagent-audit-caught real gap (Round 104): this route only ever
    // checked marzTxUuid -- a LipaPay deposit never sets that field (it sets
    // lipaTransactionId instead), so the member's own status poll silently
    // fell through to a bare "still pending" for every LipaPay deposit,
    // contradicting this codebase's own stated design (the webhook and
    // reconciler both independently re-check via lipaOrderQuery(); the
    // member's poll should too, so a slow/lost webhook self-heals the
    // moment the member reopens the status screen, same as it already does
    // for MarzPay). Mirrors the marzTxUuid branch below exactly.
    if (dep.provider === 'lipapay') {
      if (!dep.lipaTransactionId) return res.json({ status: 'success', state: 'pending' });
      const q = await lipaOrderQuery(depSnap.id);
      if (q.providerDown || !q.Data) return res.json({ status: 'success', state: 'pending' });
      const realStatus = lipaStatusLabel(q.Data.PayStatus);
      if (realStatus === 'success') { await creditDeposit(depSnap); return res.json({ status: 'success', state: 'matched' }); }
      if (realStatus === 'failed') {
        const reallyFailed = await markDepositFailed(depSnap.ref, userId, DEPOSIT_FAILED_MSG);
        if (!reallyFailed) return res.json({ status: 'success', state: 'matched' });
        return res.json({ status: 'success', state: 'failed', message: DEPOSIT_FAILED_MSG });
      }
      return res.json({ status: 'success', state: 'pending' });
    }
    if (!dep.marzTxUuid) return res.json({ status: 'success', state: 'pending' });
    const marzStatus = await marzGetCollectStatus(dep.marzTxUuid);
    if (SUCCESS_STATUSES.has(marzStatus)) { await creditDeposit(depSnap); return res.json({ status: 'success', state: 'matched' }); }
    if (FAILED_STATUSES.has(marzStatus)) {
      // Own test-caught bug: markDepositFailed() can now correctly no-op
      // (returns false) when this exact deposit was already credited by a
      // DIFFERENT in-flight check that won the race -- reporting "failed"
      // here regardless, as this used to, would show a member "Deposit
      // failed" for money that genuinely landed moments earlier. Report
      // what actually happened instead.
      const reallyFailed = await markDepositFailed(depSnap.ref, userId, DEPOSIT_FAILED_MSG);
      if (!reallyFailed) return res.json({ status: 'success', state: 'matched' });
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
// LipaPay's NotifyUrl target. Per §5.3 of their API reference, the ONLY
// correct acknowledgement is the literal plain-text body "SUCCESS" with a
// 200 -- anything else (including a JSON body) is treated as a failed
// delivery and retried for up to 24h at 1s/30s/30s/30s intervals. This
// route always acks SUCCESS once it has looked the order up (whether or not
// it could act on it yet), because acting is never gated on THIS webhook
// specifically -- the periodic reconciler and the member's own status poll
// both independently re-check via lipaOrderQuery() regardless, so there is
// no reason to make LipaPay's own retry timer our source of truth.
//
// Money-safety posture matches /deposit/callback above exactly, and Round
// 81's own hardening of it: the webhook BODY's own PayStatus/Amount are
// NEVER trusted directly. OutTradeNo (== this deposit's own doc id, chosen
// at creation specifically so no separate lookup field is needed) is used
// only to find WHICH deposit this claims to be about; the actual decision
// to credit or fail always comes from an independent lipaOrderQuery() call
// using our own credentials, exactly mirroring how the MarzPay webhook
// above never credits off an unauthenticated body's own claimed status.
app.post('/deposit/lipapay/callback', async (req, res) => {
  try {
    const outTradeNo = String(req.body?.OutTradeNo || '');
    if (!outTradeNo) return res.status(200).send('SUCCESS');
    const doc = await db.collection('pendingDeposits').doc(outTradeNo).get();
    if (!doc.exists) return res.status(200).send('SUCCESS');
    const dep = doc.data();
    if (dep.provider !== 'lipapay') return res.status(200).send('SUCCESS'); // not ours -- ignore, ack anyway so LipaPay stops retrying
    if (dep.status !== 'pending' && dep.status !== 'initiating') return res.status(200).send('SUCCESS');
    const q = await lipaOrderQuery(outTradeNo);
    if (q.providerDown || !q.Data) return res.status(200).send('SUCCESS'); // couldn't independently confirm -- leave for the reconciler/next retry, ack regardless
    const realStatus = lipaStatusLabel(q.Data.PayStatus);
    if (realStatus === 'success') await creditDeposit(doc);
    else if (realStatus === 'failed') await markDepositFailed(doc.ref, dep.userId, DEPOSIT_FAILED_MSG);
    // realStatus === 'processing' -- genuinely not done yet, nothing to do
    res.status(200).send('SUCCESS');
  } catch (e) {
    console.error('LipaPay deposit callback error:', e.message);
    res.status(200).send('SUCCESS'); // still ack -- the reconciler covers whatever this failed to do
  }
});

// ═══════════════════════════════════════════
// MANUAL DEPOSITS (admin-managed MTN/Airtel numbers, SMS-matched)
// Owner: "let us also add manual payments, so payment numbers and names
// will be put in admin panel, so make when l can toggle payment method to
// manual or automatic (marzpay)." Only one method is ever live at a time
// (settings.depositMethod) -- MarzPay's own code above is completely
// untouched by any of this.
//
// Deliberately reuses the SAME `pendingDeposits` collection, the SAME
// creditDeposit()/markDepositFailed() functions, and the SAME
// "Deposit: Status (Amount)" ledger-row convention the MarzPay flow already
// uses -- both functions only ever read dep.userId/dep.amount and are
// already fully idempotent (claim-before-credit + updateIf() token), so a
// manual deposit's credit path is exactly as safe as an automatic one with
// zero new crediting logic. What differs between the two methods is only
// HOW a pendingDeposits doc gets from 'pending' to 'matched': MarzPay polls
// its own API; manual deposits wait for a phone's SMS forwarder (or a
// member-pasted SMS) to trigger a match. A manual doc carries
// `method:'manual'` plus network/assignedNumber/holderName/senderPhone/
// expiresAt fields the MarzPay path doesn't use.
// ═══════════════════════════════════════════
const MANUAL_DEPOSIT_WINDOW_MS = 15 * 60 * 1000; // owner: "deposit payment timer should read 15minutes"
// Each SMS-forwarder phone authenticates with this one shared secret (same
// shape as the proven Nexus /sms/incoming design this is adapted from) --
// per-device signed requests/replay protection is real, worthwhile
// hardening but deliberately deferred to a later round, not blocking a
// correct, safe V1.
// ── Per-number activity tracking ──────────────────────────────────────
// Owner: "make sure l can track number activity in analytics ie success
// rates, whether their Forwarder sends/forwards messages, success rates,
// total transactions, messages forwarded, dates time and much more so that
// l can track every number... daily number transactions, deposits received,
// sms forwarded, health, duration of sms forwarding delivery to server."
//
// Two documents get touched per event, both by atomic $inc so concurrent
// SMS from several phones can never lose a count:
//   manualNumberDaily/<number>_<YYYY-MM-DD>  one row per number per EAT day
//   manualPaymentNumbers/<id>                lifetime rollup + last-seen
// Recording is always best-effort and wrapped by the caller: a stats write
// must NEVER be able to fail a deposit. Money first, bookkeeping second.
const MANUAL_EVENT_FIELDS = {
  forwarded: 'smsForwarded',      // a message arrived from a phone, whatever it was
  credited: 'credited',           // matched an order and the wallet was credited
  unmatched: 'unmatched',         // real money SMS, no order waiting for it
  ambiguous: 'ambiguous',         // more than one candidate, credited nothing
  mismatch: 'mismatch',           // sender disagreed with the order, sent to review
  duplicate: 'duplicate',         // same transaction id seen before
  unparsed: 'unparsed',           // looked like money but no parser claimed it
  ignored: 'ignored',             // not a money message at all
  assigned: 'assigned',           // an order was pointed at this number
  expired: 'expired',             // an order on this number ran out of time
  unknownNumber: 'unknownNumber', // a phone reported a number nobody has saved
};
async function recordManualNumberEvent(number, event, opts) {
  if (!number) return;
  const o = opts || {};
  const field = MANUAL_EVENT_FIELDS[event];
  if (!field) return;
  const day = eatDayKey(new Date());
  const inc = { [field]: FieldValue.increment(1) };
  if (o.amount) inc.amount = FieldValue.increment(Number(o.amount) || 0);
  // Latency is measured ON THE PHONE (SMS arrival -> POST), so it is immune
  // to clock skew between a handset and the server. Kept as a sum plus a
  // count so an average survives without storing every sample, alongside
  // the worst case, which is what actually tells you a phone is struggling.
  const lat = Number(o.deliveryMs);
  if (Number.isFinite(lat) && lat >= 0 && lat < 24 * 3600000) {
    inc.deliveryMsSum = FieldValue.increment(lat);
    inc.deliverySamples = FieldValue.increment(1);
  }
  const dailyRef = db.collection('manualNumberDaily').doc(number + '_' + day);
  await dailyRef.set({ number, day, ...inc, lastEventAt: FieldValue.serverTimestamp() }, { merge: true });
  if (Number.isFinite(lat) && lat >= 0) {
    const cur = await dailyRef.get();
    const worst = cur.exists ? Number(cur.data().deliveryMsMax || 0) : 0;
    if (lat > worst) await dailyRef.set({ deliveryMsMax: lat }, { merge: true });
  }
  // Lifetime rollup on the number's own record, so the list can show totals
  // without summing every day ever recorded.
  try {
    const numSnap = await db.collection('manualPaymentNumbers').where('number', '==', number).limit(1).get();
    if (!numSnap.empty) {
      const patch = { ['total_' + field]: FieldValue.increment(1), lastEventAt: FieldValue.serverTimestamp() };
      if (o.amount) patch.totalAmount = FieldValue.increment(Number(o.amount) || 0);
      if (event === 'forwarded') {
        patch.lastSmsAt = FieldValue.serverTimestamp();
        // A phone forwarding messages but not yet heartbeating (an older
        // build, or one just installed) would otherwise show no device at
        // all in the panel, even though every message it sends carries one.
        if (o.device) patch.device = o.device;
        if (o.appVersion) patch.appVersion = o.appVersion;
      }
      await numSnap.docs[0].ref.set(patch, { merge: true });
    }
  } catch (_) { /* rollup is a convenience, the daily row is the record */ }
}
// Never let bookkeeping break a payment path.
function trackManual(number, event, opts) {
  recordManualNumberEvent(number, event, opts).catch(e =>
    console.warn('Manual number stats (non-critical):', e.message));
}

const MANUAL_SMS_SECRET = process.env.MANUAL_SMS_SECRET || '';
function manualSmsConfigured() { return MANUAL_SMS_SECRET.length >= 16; }

// Screen-lock password for the forwarder app on the admin phones. Held here
// rather than in the APK so it can be changed centrally without rebuilding
// and reinstalling on every phone, and so it is not sitting in a file
// anyone holding the APK can read.
//
// Be clear about what this defends: someone PICKING UP an unattended admin
// phone and changing a receiving number to their own, or stopping
// forwarding. It is not anti-tamper -- an APK can always be patched and
// resigned. What actually stops a modified app is MANUAL_SMS_SECRET, which
// the server checks on every forwarded message.
//
// Leave unset to disable the lock entirely; the app asks the server whether
// a password is required at all.
const FORWARDER_PASSWORD = process.env.FORWARDER_PASSWORD || '';

// Parse an MTN / Airtel Uganda "you have received" SMS. Ported from the
// proven Nexus implementation (root server.js) -- same regex, same
// field shape. Returns { amount, txId, sender, raw } or null if it isn't a
// genuine incoming-money message.
// Shared bits, verified against real MTN and Airtel Uganda messages.
// Amount: always the FIRST UGX figure -- both operators put the transacted
// amount before the running balance ("Bal UGX ..." / "New balance: UGX ...").
function _smsAmount(t) {
  const m = t.match(/(?:ugx|ush|shs?)\s*([\d,]+(?:\.\d+)?)/i) ||
            t.match(/([\d,]+(?:\.\d+)?)\s*(?:ugx|ush|shs?)/i);
  if (!m) return NaN;
  return parseFloat(m[1].replace(/,/g, ''));
}
// Operator transaction id. Airtel labels it "TID 155198427834."; MTN's newer
// format ends with "ID: 43140073868" (older ones said "Transaction ID ...").
function _smsTxId(t) {
  const idm = t.match(/(?:txn\s*id|transaction\s*id|trans\.?\s*id|\btid\b|ref(?:erence)?|financial transaction id)[:\s#]*([A-Za-z0-9.\-]{6,})/i)
           || t.match(/\bid[:\s#]+(\d{6,})/i);
  return idm ? idm[1].replace(/\.$/, '') : '';
}
// The counterparty's number moves around a lot between operators and between
// same-network and cross-network transfers, so this scans for candidates
// after the keyword rather than assuming a position. Real observed shapes:
//   Airtel in   "from 741234567, JOHN"            -- number first
//   MTN in      "from UMAR KIZITO, 256764628233"  -- name first
//   Airtel out  "to NAME on 256769968158"         -- number after "on"
//   MTN in x-net"from Airtel Money ... Reason: IBRAHIM NANKOOLA , 0731880221"
//               -- "from" is the OPERATOR, the payer's number is in Reason
//
// Two guards matter here:
//  - \b on the keyword, so a name ending in "to" (KIZITO) is not read as it.
//  - (?<!\d)...(?!\d), so a 9-13 digit window is never sliced out of a
//    LONGER number. MTN puts a 19-digit value in "Reason:" on same-network
//    transfers; without this, a cross-network message carrying one before
//    the payer's number yields 13 junk digits instead of the real number.
// Among valid candidates, prefer one that looks like a Ugandan mobile
// (+2567...), since Reason is a free-text field that can hold anything.
function _smsCounterparty(t, keyword) {
  const re = new RegExp('\\b' + keyword + '\\s+([\\s\\S]*)', 'i');
  const tail = t.match(re);
  if (!tail) return '';
  const candidates = tail[1].match(/(?<!\d)\+?\d{9,13}(?!\d)/g);
  if (!candidates || !candidates.length) return '';
  for (const c of candidates) {
    const cleaned = cleanPhone(c);
    if (cleaned && /^\+2567/.test(cleaned)) return c.replace(/[\s\-]/g, '');
  }
  return candidates[0].replace(/[\s\-]/g, '');
}

// An INCOMING "you have received" message, as it lands on an admin payment
// phone. This is what the SMS forwarder posts.
// Operators reword these templates without notice, so direction is decided
// on a spread of phrasings rather than one exact sentence. Kept deliberately
// wide: the (receivingNumber, amount) match plus the sender cross-check are
// what actually protect the money, so a generous reading here costs nothing
// while a narrow one silently stops matching the day a template changes.
const RE_INCOMING = /(received|credited|credit of|deposit of|you've received)/i;
const RE_OUTGOING = /(sent to|you have sent|you've sent|\bsent\b|withdrawn|debited|paid to|transferred|transfer of|payment of)/i;
const RE_NOT_MONEY = /(airtime|bundle|\bdata\b|megabytes|\bMBs?\b)/i;

function parseMoMoSms(text) {
  if (!text) return null;
  const t = String(text).replace(/\s+/g, ' ').trim();
  // "Download MoMo App ... to get 500MBs" rides along on real MTN deposit
  // messages, so the not-money check must not veto an otherwise valid one --
  // it only decides between the two directions when both could read true.
  const isReceive  = RE_INCOMING.test(t);
  const isOutgoing = /(sent to|you have sent|you've sent|withdrawn|debited|paid to)/i.test(t);
  if (!isReceive || isOutgoing) return null;
  const amount = _smsAmount(t);
  if (!amount || isNaN(amount)) return null;
  return { amount, txId: _smsTxId(t), sender: _smsCounterparty(t, 'from'), raw: t };
}

// An OUTGOING "you have sent" message, as it lands on the MEMBER's own phone.
//
// Owner, correcting a real bug: "I sending message, it says sent not sender
// one to receive... so sender doesn't receive, sender has sent message."
// Exactly right -- the member never gets a "received" SMS, so the paste-SMS
// fallback was validating their text with parseMoMoSms() above, which
// explicitly REJECTS outgoing wording. Every paste attempt failed. This
// parses the direction the member actually has.
//
// Returns { amount, txId, recipient, raw } or null. `recipient` is the
// number they paid TO, which should be the admin number we assigned them.
function parseSentMoMoSms(text) {
  if (!text) return null;
  const t = String(text).replace(/\s+/g, ' ').trim();
  const isSent = RE_OUTGOING.test(t);
  if (!isSent) return null;
  // Direction must be unambiguous. A message that reads as incoming is never
  // treated as outgoing, so the two parsers can never both claim one message
  // (the paste endpoint tries this one first).
  if (RE_INCOMING.test(t)) return null;
  // Airtime/bundle purchases are outgoing money but not deposits. Only vetoed
  // here, where no legitimate transfer message carries these words.
  if (RE_NOT_MONEY.test(t)) return null;
  const amount = _smsAmount(t);
  if (!amount || isNaN(amount)) return null;
  return { amount, txId: _smsTxId(t), recipient: _smsCounterparty(t, 'to'), raw: t };
}

// Picks a number from this network's pool at RANDOM (owner: "remove
// following of order of numbers let them be choose at random but
// everything should be uniformly assigned" -- was a deterministic
// round-robin walking a persisted lastIndex, so who got which number was
// entirely predictable from order alone; replaced with a real Fisher-
// Yates shuffle of the whole pool on every single call, so every active
// number has an EQUAL chance of being tried first, second, third, etc. --
// "uniformly assigned" means fair long-run distribution across the pool,
// which random selection gives for free; a fixed round-robin sequence
// does NOT need randomness to already be perfectly even, so this is a
// pure ordering change, not a fairness fix). The old
// `manualNumberRotation` collection/lastIndex state this used to persist
// is gone entirely -- nothing needs to remember "which number is next"
// once the pick is random every time.
// Skips any number that already has an active pending order for this
// EXACT amount (owner: "if user A deposit on number 1, user B deposits on
// number 2... every session, it's own number" -- the multi-number pool
// itself is the collision-avoidance mechanism, not Nexus's own "add
// random shillings to the amount" trick, which would fight the whole
// point of wanting several clean, round-number-friendly destinations).
// Locked per network so two concurrent inits can never both claim the
// same shuffled-first candidate.
// Subagent-audit-caught HIGH-severity real bug: this used to only PICK a
// number under the lock and return it -- the caller then wrote the actual
// pendingDeposits doc separately, after an awaited uniqueRef() call (a real
// DB round trip), outside this lock entirely. Two members requesting the
// same network + exact same amount concurrently could both run their own
// clash-check in that gap, before either doc existed to be seen, and get
// assigned the SAME number for the SAME amount. Two such orders degrade
// safely at match time (the ambiguous-match logic below already flags 2+
// non-expired candidates and credits neither) -- UNLESS one order later
// expires (a payer being slow is entirely outside server control) while the
// other is still live: at that point the survivor is the only remaining
// candidate, so a genuinely late real payment for the FIRST (now-expired)
// order matches and silently credits the SECOND member instead -- a real
// wrong-member credit, produced by this assignment race plus ordinary
// 15-minute expiry, not by any failure of the ambiguous-detection code
// itself. Closed by moving the deposit-doc WRITE itself inside the SAME
// lock as the clash-check (via depositFields, supplied by the one caller),
// so a concurrent call's own clash-check can never run in the gap between
// "picked" and "written" -- there no longer is one.
async function assignManualNumberAndCreateDeposit(network, amount, depositFields) {
  return withLock('manual-number-assign:' + network, async () => {
    const numsSnap = await db.collection('manualPaymentNumbers')
      .where('network', '==', network).where('active', '==', true).get();
    const pool = numsSnap.docs.map(d => ({ id: d.id, number: d.data().number, holderName: d.data().holderName }));
    if (!pool.length) return null;
    // Fisher-Yates -- every permutation of the pool is equally likely, so
    // the candidate tried first (and, if it clashes, second, third, ...)
    // is genuinely uniformly random on every call, not just "different
    // from last time."
    for (let i = pool.length - 1; i > 0; i--) {
      const j = crypto.randomInt(i + 1);
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const now = Date.now();
    for (const candidate of pool) {
      const clash = await db.collection('pendingDeposits')
        .where('method', '==', 'manual').where('assignedNumber', '==', candidate.number)
        .where('amount', '==', amount).where('status', '==', 'pending').limit(5).get();
      const stillActive = clash.docs.some(d => (d.data().expiresAt || 0) > now);
      if (!stillActive) {
        const depRef = db.collection('pendingDeposits').doc();
        await depRef.set({
          ...depositFields,
          assignedNumberId: candidate.id, assignedNumber: candidate.number, holderName: candidate.holderName,
        });
        return { assigned: candidate, depRef };
      }
    }
    return null; // every number on this network currently clashes on this exact amount
  });
}

app.post('/deposit/manual/init', async (req, res) => {
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Please sign in again' });
  const amt = parseInt(req.body.amount, 10);
  if (isNaN(amt) || amt <= 0) return res.status(400).json({ status: 'error', message: 'Invalid amount' });
  if (amt > MAX_MONEY_AMOUNT) return res.status(400).json({ status: 'error', message: `Amount is too large (max ${fmtUGX(MAX_MONEY_AMOUNT)}).` });
  const network = NETWORK_NAMES.has(req.body.network) ? req.body.network : null;
  if (!network) return res.status(400).json({ status: 'error', message: 'Select a network' });
  try {
    const [uSnap, sett] = await Promise.all([db.collection('users').doc(userId).get(), getSettings()]);
    if (!uSnap.exists) return res.status(404).json({ status: 'error', message: 'User not found' });
    if (uSnap.data().status === 'banned') return res.status(403).json({ status: 'error', code: 'BANNED', message: 'Account suspended. Contact customer service.' });
    if (!sett.depositPayBEnabled) return res.status(400).json({ status: 'error', message: 'Manual deposits are not enabled right now.' });
    if (_userBeingDeleted.has(userId)) return res.status(400).json({ status: 'error', message: 'This account is currently being processed. Try again shortly.' });
    // Same validate-before-touching-abuse-counters ordering as
    // /deposit/marzpay -- see its own comment for why this order matters.
    if (amt < sett.minDeposit) return res.status(400).json({ status: 'error', message: `Minimum amount is ${fmtUGX(sett.minDeposit)}` });
    const senderPhone = cleanPhone(req.body.senderPhone || req.body.phone || uSnap.data().phone || '');
    if (!senderPhone) return res.status(400).json({ status: 'error', message: 'Enter a valid mobile-money phone number.' });

    const lastDep = _depCreateDebounce.get(userId) || 0;
    if (Date.now() - lastDep < 7000)
      return res.status(429).json({ status: 'error', message: 'A deposit is already being processed. Please wait a moment.' });
    const attemptCount = recordDepositAttempt(userId);
    if (attemptCount >= 5 && !depositSucceededRecently(userId)) {
      await banUserAutomatically(userId, 'Automatic: 5+ deposit attempts within a minute, none completed');
      return res.status(403).json({ status: 'error', code: 'BANNED', message: 'Account suspended. Contact customer service.' });
    }
    _depCreateDebounce.set(userId, Date.now());

    // uniqueRef() is a real DB round trip -- deliberately run BEFORE
    // acquiring assignManualNumberAndCreateDeposit()'s lock (it doesn't need
    // to be inside it, self-contained), so the lock is held for the
    // shortest window that still needs it: pick-a-number-and-write, and
    // nothing else.
    const ref = await uniqueRef('M');
    const { date, time } = nowStr();
    const expiresAt = Date.now() + MANUAL_DEPOSIT_WINDOW_MS;
    const result = await assignManualNumberAndCreateDeposit(network, amt, {
      userId, phone: senderPhone, senderPhone, network, amount: amt, ref, status: 'pending',
      method: 'manual', expiresAt, date, time, createdAt: FieldValue.serverTimestamp(),
    });
    if (!result) return res.status(503).json({ status: 'error', message: 'All payment numbers for this network are busy right now. Try again shortly, or use a slightly different amount.' });
    const { assigned, depRef } = result;
    trackManual(assigned.number, 'assigned', { amount: amt });
    // Same "recorded immediately, not eventually" reasoning as
    // /deposit/marzpay's own ledger-row-up-front comment.
    await db.collection('transactions').add({
      userId, type: 'deposit', description: `Deposit: Processing (${fmtUGX(amt)})`,
      amount: amt, displayAmount: amt, status: 'pending', date, time, ref, depositId: depRef.id, createdAt: FieldValue.serverTimestamp()
    }).catch(e => console.error(`Manual deposit ledger row create failed for dep=${depRef.id}:`, e.message));

    res.json({
      status: 'success', depositId: depRef.id, reference: ref,
      assignedNumber: assigned.number, holderName: assigned.holderName, network, amount: amt, expiresAt,
      message: `Send exactly ${fmtUGX(amt)} to ${assigned.number} (${assigned.holderName}).`
    });
  } catch (e) {
    console.error('Manual deposit init error:', e.message);
    if (!res.headersSent) res.status(500).json({ status: 'error', message: 'Could not start the deposit right now' });
  }
});

app.post('/deposit/manual/status', async (req, res) => {
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const depSnap = await db.collection('pendingDeposits').doc(String(req.body.depositId || '')).get();
    if (!depSnap.exists || depSnap.data().userId !== userId || depSnap.data().method !== 'manual')
      return res.status(404).json({ status: 'error', message: 'Deposit not found' });
    const dep = depSnap.data();
    if (dep.status === 'matched') {
      if (dep.needsManualCredit) await creditDeposit(depSnap).catch(() => {});
      return res.json({ status: 'success', state: 'matched' });
    }
    if (dep.status === 'failed') return res.json({ status: 'success', state: 'failed', message: dep.failureReason });
    // A human is already looking at this one (ambiguous SMS match, sender
    // mismatch, or a member-pasted SMS) -- never auto-fail it out from
    // under them just because its original 15-minute window has lapsed.
    if (dep.status === 'review') return res.json({ status: 'success', state: 'review' });
    if ((dep.expiresAt || 0) <= Date.now()) {
      const reallyFailed = await markDepositFailed(depSnap.ref, userId, 'Payment window expired.');
      if (!reallyFailed) return res.json({ status: 'success', state: 'matched' });
      return res.json({ status: 'success', state: 'failed', message: 'Payment window expired.' });
    }
    return res.json({ status: 'success', state: 'pending', expiresAt: dep.expiresAt });
  } catch (e) {
    console.error('Manual deposit status error:', e.message);
    res.status(500).json({ status: 'error', message: 'Could not check payment status' });
  }
});

// The phone SMS-forwarder POSTs every incoming SMS here (shared-secret
// auth, same header convention as Nexus's own proven /sms/incoming).
// Nothing here credits a wallet directly -- it only ever calls the SAME
// creditDeposit() the MarzPay flow uses, and only after: (1) dedup by the
// operator's own transaction id (or a hash fallback) so a retried/
// redelivered/duplicate-device SMS can never be processed twice, and
// (2) finding EXACTLY one live candidate order for this receiving number +
// amount. Zero or more-than-one candidates never guess -- see the "never
// silently credit on ambiguity" comment below.
// Unlock check for the forwarder app's own screen lock. Sits behind the SAME
// shared secret as the webhook, so it is not a password oracle anyone on the
// internet can hammer -- a caller must already hold MANUAL_SMS_SECRET to get
// so much as a yes/no. Deliberately returns no detail beyond that.
//
// The app caches a hash after a successful unlock so a phone with no
// connectivity can still be opened by whoever knows the password; this
// endpoint is what establishes it in the first place and what picks up a
// password change made on Render.
const _forwarderUnlockAttempts = new Map();   // ip -> { n, first }
app.post('/deposit/manual/forwarder-unlock', async (req, res) => {
  if (!manualSmsConfigured()) return res.status(503).json({ status: 'error', message: 'disabled' });
  const provided = String(req.headers['x-sms-secret'] || (req.body && req.body.secret) || '');
  const expected = MANUAL_SMS_SECRET;
  const secretOk = provided.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  if (!secretOk) return res.status(403).json({ status: 'error', message: 'Forbidden' });

  // No password configured on the server: the lock is off, say so plainly
  // so a fresh install does not sit at a screen nobody can get past.
  if (!FORWARDER_PASSWORD) return res.json({ status: 'success', required: false });

  // Even behind the shared secret, throttle guessing.
  const ip = String(req.ip || 'unknown');
  const now = Date.now();
  const rec = _forwarderUnlockAttempts.get(ip);
  if (rec && now - rec.first < 60000 && rec.n >= 10)
    return res.status(429).json({ status: 'error', required: true, message: 'Too many attempts. Wait a minute.' });

  const pw = String((req.body && req.body.password) || '');
  const ok = pw.length === FORWARDER_PASSWORD.length &&
    crypto.timingSafeEqual(Buffer.from(pw), Buffer.from(FORWARDER_PASSWORD));
  if (!ok) {
    if (!rec || now - rec.first >= 60000) _forwarderUnlockAttempts.set(ip, { n: 1, first: now });
    else rec.n++;
    return res.status(401).json({ status: 'error', required: true, message: 'Wrong password' });
  }
  _forwarderUnlockAttempts.delete(ip);
  res.json({ status: 'success', required: true });
});

app.post('/deposit/manual/sms-forwarder', async (req, res) => {
  if (!manualSmsConfigured()) return res.status(503).json({ status: 'error', message: 'disabled' });
  const provided = String(req.headers['x-sms-secret'] || (req.body && req.body.secret) || '');
  const expected = MANUAL_SMS_SECRET;
  const ok = provided.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  if (!ok) return res.status(403).json({ status: 'error', message: 'Forbidden' });

  const text = String((req.body && (req.body.message || req.body.text)) || '');
  const receivingNumberRaw = String((req.body && req.body.receivingNumber) || '').trim();
  const receivingNumber = cleanPhone(receivingNumberRaw) || receivingNumberRaw;
  // How long the phone took between the SMS landing and this POST going out,
  // measured by the phone against its own clock so it can't be poisoned by
  // clock skew. Older app builds don't send it; that just means no sample.
  const deliveryMs = Number((req.body && req.body.forwardDelayMs));
  const device = String((req.body && req.body.device) || '').slice(0, 60);
  const appVersion = String((req.body && req.body.appVersion) || '').slice(0, 20);
  if (receivingNumber) trackManual(receivingNumber, 'forwarded', { deliveryMs, device, appVersion });
  const info = parseMoMoSms(text);
  if (!info) {
    // Operators reword these templates without notice. If a message LOOKS
    // like money (mentions a currency and carries a phone-length number) but
    // no parser claimed it, that is the signature of a template change --
    // and the failure mode is silent: deposits simply stop auto-crediting
    // and nobody knows why until members complain. So record it, loudly.
    // Grep Render logs for MANUAL_SMS_UNPARSED to find them.
    try {
      const looksLikeMoney = /(ugx|ush|shs?)\s*[\d,]/i.test(text) && /(?<!\d)\d{9,13}(?!\d)/.test(text);
      if (looksLikeMoney) {
        console.warn('MANUAL_SMS_UNPARSED (possible operator template change):', text.slice(0, 300));
        await db.collection('manualSmsLog').add({
          unparsed: true, raw: String(text).slice(0, 2000), receivingNumber,
          device, appVersion, deliveryMs: Number.isFinite(deliveryMs) ? deliveryMs : null,
          createdAt: FieldValue.serverTimestamp()
        });
        trackManual(receivingNumber, 'unparsed');
      }
    } catch (_) { /* diagnostics must never break the webhook */ }
    trackManual(receivingNumber, 'ignored');
    return res.json({ status: 'ignored', reason: 'not an incoming-money SMS' });
  }
  if (!receivingNumber) return res.json({ status: 'ignored', reason: 'no receivingNumber configured on this device' });

  try {
    // A phone can only be right about which number it is if that number is
    // actually one of ours. If it is not -- a typo during setup, or a number
    // deleted from the panel afterwards -- then no order was ever assigned
    // to it and nothing here could ever match, no matter how many real
    // payments arrive. Left alone this is completely silent: the phone looks
    // healthy, the member's money is gone, and the deposit just never lands.
    // So say so, loudly, instead of letting it fall through to "unmatched".
    const knownSnap = await db.collection('manualPaymentNumbers').where('number', '==', receivingNumber).limit(1).get();
    if (knownSnap.empty) {
      console.error(`MANUAL_SMS_UNKNOWN_NUMBER: a forwarder reported receivingNumber ${receivingNumber}, which is not saved in the admin panel. Deposits on this phone can NEVER match. Check the number configured on device "${device || 'unknown'}".`);
      trackManual(receivingNumber, 'unknownNumber', { amount: info.amount, device, appVersion });
      await db.collection('manualSmsLog').add({
        unknownNumber: true, receivingNumber, amount: info.amount,
        raw: String(info.raw).slice(0, 2000), device, appVersion,
        createdAt: FieldValue.serverTimestamp(),
      }).catch(() => {});
      return res.json({
        status: 'unknown-number', receivingNumber,
        message: 'This number is not saved in the admin panel, so nothing can match it.',
      });
    }

    // Idempotency: MoMo transaction id, or a hash of (raw text + receiving
    // number) as a fallback for a message with no extractable TID.
    const tid = info.txId || crypto.createHash('sha256').update(info.raw + '|' + receivingNumber).digest('hex').slice(0, 24);
    const seenRef = db.collection('manualSmsLog').doc(tid);
    if ((await seenRef.get()).exists) {
      trackManual(receivingNumber, 'duplicate');
      return res.json({ status: 'duplicate' });
    }
    await seenRef.set({
      amount: info.amount, sender: info.sender || '', receivingNumber, raw: info.raw,
      device, appVersion, deliveryMs: Number.isFinite(deliveryMs) ? deliveryMs : null,
      createdAt: FieldValue.serverTimestamp()
    });

    const now = Date.now();
    const snap = await db.collection('pendingDeposits')
      .where('method', '==', 'manual').where('status', '==', 'pending')
      .where('assignedNumber', '==', receivingNumber).where('amount', '==', info.amount)
      .limit(10).get();
    const candidates = snap.docs.filter(d => (d.data().expiresAt || 0) > now);
    if (!candidates.length) {
      await seenRef.update({ matched: false }).catch(() => {});
      console.warn(`Manual deposit SMS unmatched: ${fmtUGX(info.amount)} to ${receivingNumber}`);
      trackManual(receivingNumber, 'unmatched', { amount: info.amount });
      return res.json({ status: 'unmatched', amount: info.amount });
    }
    if (candidates.length > 1) {
      // Never guess with money -- a genuine same-number-same-amount
      // collision (should already be rare given assignManualNumber()'s own
      // skip logic, but never trust that alone) flags every candidate for
      // a human, credits none automatically.
      await Promise.all(candidates.map(d => d.ref.update({ status: 'review', reviewReason: 'Multiple pending orders matched this SMS (same number + amount)' }).catch(() => {})));
      await seenRef.update({ matched: false, ambiguous: true }).catch(() => {});
      console.warn(`Manual deposit SMS AMBIGUOUS: ${fmtUGX(info.amount)} to ${receivingNumber} -- ${candidates.length} candidates flagged for review`);
      trackManual(receivingNumber, 'ambiguous', { amount: info.amount });
      return res.json({ status: 'ambiguous', amount: info.amount });
    }
    const match = candidates[0];
    const md = match.data();
    // Defense in depth: sender-phone extraction from the SMS is
    // best-effort (not every operator format includes it cleanly), so it's
    // never a HARD requirement -- but if it IS present and it clearly
    // disagrees with the number the member typed when starting this order,
    // that's a real reason to stop and let a human look, not silently
    // credit anyway just because the number+amount happened to line up.
    const smsSenderClean = info.sender ? (cleanPhone(info.sender) || info.sender) : null;
    const orderSenderClean = md.senderPhone ? (cleanPhone(md.senderPhone) || md.senderPhone) : null;
    if (smsSenderClean && orderSenderClean && smsSenderClean !== orderSenderClean) {
      await match.ref.update({ status: 'review', reviewReason: `Sender number mismatch: SMS said ${info.sender}, order was placed with ${md.senderPhone}` }).catch(() => {});
      await seenRef.update({ matched: false, mismatch: true }).catch(() => {});
      trackManual(receivingNumber, 'mismatch', { amount: info.amount });
      return res.json({ status: 'mismatch', amount: info.amount });
    }
    await match.ref.update({ matchedSmsId: tid, smsTxId: info.txId || '', smsSender: info.sender || '' }).catch(() => {});
    await creditDeposit(match);
    await seenRef.update({ matched: true, matchedOrderId: match.id }).catch(() => {});
    trackManual(receivingNumber, 'credited', { amount: info.amount });
    return res.json({ status: 'credited', depositId: match.id });
  } catch (e) {
    console.error('Manual deposit SMS error:', e.message);
    return res.status(500).json({ status: 'error', message: e.message });
  }
});

// Member's own fallback when the forwarder is slow/down: paste the
// confirmation text THEIR phone received. Scoped so it can only ever touch
// their own already-existing pending order (never a blind platform-wide
// match the way the device-forwarder path above has to be), and — per this
// codebase's own "never trust user input for a balance change" rule —
// this NEVER credits by itself. It only ever queues the order for a human
// to confirm, exactly like an ambiguous/mismatched SMS does above.
app.post('/deposit/manual/paste-sms', async (req, res) => {
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Please sign in again' });
  try {
    const depSnap = await db.collection('pendingDeposits').doc(String(req.body.depositId || '')).get();
    if (!depSnap.exists || depSnap.data().userId !== userId || depSnap.data().method !== 'manual')
      return res.status(404).json({ status: 'error', message: 'Deposit not found' });
    const dep = depSnap.data();
    if (dep.status !== 'pending' && dep.status !== 'review')
      return res.status(400).json({ status: 'error', message: 'This deposit is no longer waiting for payment.' });
    const text = String(req.body.text || '').slice(0, 2000);
    // The member's own phone gets a SENT message, so that's the normal case.
    // A received message is still accepted in case they somehow relay the
    // admin phone's copy instead.
    const sent = parseSentMoMoSms(text);
    const received = sent ? null : parseMoMoSms(text);
    const info = sent || received;
    if (!info) return res.status(400).json({ status: 'error', message: "That doesn't look like a mobile-money message. Paste the whole confirmation text you got after sending, exactly as it came." });

    // Cross-checks for whoever reviews this. None of them credit anything --
    // this endpoint never calls creditDeposit(); it only ever queues the
    // order for a human, per this codebase's own "never trust user input for
    // a balance change" rule.
    const counterparty = sent ? sent.recipient : received.sender;
    const amountMatches = Number(info.amount) === Number(dep.amount);
    const cleanCounterparty = counterparty ? (cleanPhone(counterparty) || counterparty) : '';
    const cleanAssigned = dep.assignedNumber ? (cleanPhone(dep.assignedNumber) || dep.assignedNumber) : '';
    const paidRightNumber = sent && cleanCounterparty && cleanAssigned
      ? cleanCounterparty === cleanAssigned
      : null;   // null = could not be checked

    const notes = [sent ? 'Member pasted their own sent-money SMS' : 'Member pasted a received-money SMS'];
    if (!amountMatches) notes.push(`amount says ${fmtUGX(info.amount)} but the order is ${fmtUGX(dep.amount)}`);
    if (paidRightNumber === false) notes.push(`paid ${counterparty} but was assigned ${dep.assignedNumber}`);

    await depSnap.ref.update({
      status: 'review',
      reviewReason: notes.join('; '),
      pastedSms: info.raw,
      pastedSmsAmount: info.amount,
      pastedSmsTxId: info.txId || '',
      pastedSmsCounterparty: counterparty || '',
      pastedSmsDirection: sent ? 'sent' : 'received',
      pastedSmsAmountMatches: amountMatches,
      pastedSmsNumberMatches: paidRightNumber,
      pastedAt: FieldValue.serverTimestamp()
    });
    res.json({ status: 'success', message: "Thanks, we're checking this and will credit your wallet shortly if it's genuine." });
  } catch (e) {
    console.error('Manual deposit paste-sms error:', e.message);
    res.status(500).json({ status: 'error', message: 'Could not submit this right now' });
  }
});

// 1-minute sweep for manual orders nobody's actively polling -- the poll
// endpoint above already expires one lazily the instant a member checks it,
// this just makes sure an abandoned tab's order still gets released (and
// its number freed back to the pool) even if nobody ever polls it again.
async function reconcileManualDeposits() {
  try {
    const now = Date.now();
    const snap = await db.collection('pendingDeposits').where('method', '==', 'manual').where('status', '==', 'pending').limit(500).get();
    for (const doc of snap.docs) {
      const d = doc.data();
      if ((d.expiresAt || 0) <= now) {
        await markDepositFailed(doc.ref, d.userId, 'Payment window expired.').catch(e => console.error('Manual deposit expiry error:', e.message));
        trackManual(d.assignedNumber, 'expired', { amount: d.amount });
      }
    }
  } catch (e) { console.error('Reconcile manual deposits error:', e.message); }
}

// Owner: "if one receives a deposit message but no order created, what can
// server do?" -- genuine money can arrive on an admin number with nowhere to
// go: no order was waiting (wrong amount, a typo, an order that already
// expired), the receiving number itself was never saved
// (MANUAL_SMS_UNKNOWN_NUMBER), or an operator reworded a template so no
// parser claimed the message (MANUAL_SMS_UNPARSED). Every one of these was
// already being written to manualSmsLog and counted in the per-number
// analytics -- but nothing ever SHOWED the admin the actual message, so the
// only way to notice was watching Render logs. This is that missing view.
//
// Shared by the list route and /admin/badges so the two can never quietly
// disagree about what counts as "still needs a look".
async function unresolvedManualSmsLog(limit) {
  // Subagent-audit-caught real bug: this used to take the 500 most recent
  // rows of the WHOLE manualSmsLog collection -- including every ordinary
  // successful match, which vastly outnumbers genuinely-unresolved rows on
  // any platform with real deposit volume -- and only filtered matched/
  // resolved OUT afterward, in memory. A genuinely-unresolved row (real
  // money with nowhere to go) could silently age out of the 500-row window
  // entirely once 500+ OTHER events (mostly normal successful credits)
  // happened since it was logged, with no signal anywhere that it was ever
  // dropped -- exactly the failure mode this whole feature exists to
  // prevent. Fixed by excluding matched/resolved rows in the QUERY itself
  // (Mongo's $ne correctly matches a document where the field is simply
  // absent, same as every other $ne-based exclusion in this file), so the
  // 500-row limit only ever bounds rows that actually still need a look.
  const snap = await db.collection('manualSmsLog')
    .where('matched', '!=', true).where('resolved', '!=', true)
    .orderBy('createdAt', 'desc').limit(limit || 500).get();
  const rows = [];
  snap.forEach(d => {
    const v = d.data();
    rows.push({
      id: d.id,
      reason: v.unparsed ? 'unparsed' : v.unknownNumber ? 'unknown-number'
        : v.ambiguous ? 'ambiguous' : v.mismatch ? 'mismatch' : 'unmatched',
      receivingNumber: v.receivingNumber || '',
      amount: v.amount != null ? v.amount : null,
      sender: v.sender || '',
      raw: v.raw || '',
      device: v.device || '', appVersion: v.appVersion || '',
      createdAt: v.createdAt || null,
    });
  });
  return rows;
}
app.post('/admin/manual-sms-log/list', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const rows = await unresolvedManualSmsLog(500);
    res.json({ status: 'success', rows });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
// Owner-only, same posture as /admin/deposit/manual/reject just above --
// deciding a piece of unaccounted-for money needs no further action is a
// real judgement call, not a routine dismiss. This never moves money on its
// own; crediting the right member still goes through the existing
// /admin/deposit tool once the admin has identified who it belongs to.
app.post('/admin/manual-sms-log/resolve', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const id = String(req.body.id || '');
  if (!id) return res.status(400).json({ status: 'error', message: 'id required' });
  try {
    await db.collection('manualSmsLog').doc(id).update({ resolved: true, resolvedBy: req.adminUser?.username || 'owner', resolvedAt: FieldValue.serverTimestamp() });
    logAdminAction(req, 'manual_sms_log_resolved', { id });
    res.json({ status: 'success' });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});

// Checks ONE number a person typed into the forwarder. Owner: "this should
// be a backend secret, so one has to put the number not to select available
// in admin panel, so no choosing saved numbers, one has to type, system
// checks and verifies."
//
// So this deliberately never returns the list, or a holder name, or anything
// else about a number that was not already known to the caller. It answers
// only: is this exact number one of ours, and is it switched on. Nothing here
// can be used to discover a number.
//
// Why it needs to exist at all: orders are only ever assigned to saved
// numbers, so a phone configured with any other number can never match a
// deposit -- yet it forwards happily and looks perfectly healthy while every
// payment to that SIM is lost. Checking at the moment the number is typed
// turns a silent, permanent failure into an error on screen.
const _verifyNumberAttempts = new Map();   // ip -> { n, first }
app.post('/deposit/manual/verify-number', async (req, res) => {
  if (!manualSmsConfigured()) return res.status(503).json({ status: 'error', message: 'disabled' });
  const provided = String(req.headers['x-sms-secret'] || (req.body && req.body.secret) || '');
  const expected = MANUAL_SMS_SECRET;
  const ok = provided.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  if (!ok) return res.status(403).json({ status: 'error', message: 'Forbidden' });

  // A yes/no oracle is still an oracle. Setting up a phone means a handful of
  // checks; anything beyond that is somebody walking the number space, so it
  // gets throttled hard even though the caller already holds the secret.
  const ip = String(req.ip || 'unknown');
  const now = Date.now();
  const rec = _verifyNumberAttempts.get(ip);
  if (rec && now - rec.first < 60000 && rec.n >= 30)
    return res.status(429).json({ status: 'error', message: 'Too many checks. Wait a minute.' });
  if (!rec || now - rec.first >= 60000) _verifyNumberAttempts.set(ip, { n: 1, first: now });
  else rec.n++;

  try {
    const raw = String((req.body && req.body.number) || '').trim();
    const num = cleanPhone(raw) || raw;
    if (!num) return res.json({ status: 'success', known: false, active: false });
    const snap = await db.collection('manualPaymentNumbers').where('number', '==', num).limit(1).get();
    if (snap.empty) return res.json({ status: 'success', known: false, active: false });
    return res.json({ status: 'success', known: true, active: snap.docs[0].data().active !== false });
  } catch (e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// Forwarder heartbeat. Without this, a phone that has simply stopped
// working is indistinguishable from a quiet one -- no SMS arriving looks
// exactly the same whether the number is idle or the app was killed, the
// SIM removed, or the phone left on a dead battery. Every install checks in
// on a timer, so "healthy" is something the panel can actually assert
// rather than infer from silence.
app.post('/deposit/manual/forwarder-heartbeat', async (req, res) => {
  if (!manualSmsConfigured()) return res.status(503).json({ status: 'error', message: 'disabled' });
  const provided = String(req.headers['x-sms-secret'] || (req.body && req.body.secret) || '');
  const expected = MANUAL_SMS_SECRET;
  const ok = provided.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  if (!ok) return res.status(403).json({ status: 'error', message: 'Forbidden' });
  try {
    const raw = (req.body && req.body.numbers) || [];
    const numbers = (Array.isArray(raw) ? raw : [raw])
      .map(n => cleanPhone(String(n || '').trim()) || String(n || '').trim())
      .filter(Boolean).slice(0, 10);
    const patch = {
      lastHeartbeatAt: FieldValue.serverTimestamp(),
      device: String((req.body && req.body.device) || '').slice(0, 60),
      appVersion: String((req.body && req.body.appVersion) || '').slice(0, 20),
      forwardingActive: !!(req.body && req.body.forwarding),
    };
    const bat = Number(req.body && req.body.battery);
    if (Number.isFinite(bat) && bat >= 0 && bat <= 100) patch.battery = Math.round(bat);
    let updated = 0;
    for (const num of numbers) {
      const snap = await db.collection('manualPaymentNumbers').where('number', '==', num).limit(1).get();
      if (!snap.empty) { await snap.docs[0].ref.set(patch, { merge: true }); updated++; }
    }
    res.json({ status: 'success', matched: updated, seen: numbers.length });
  } catch (e) {
    console.error('Forwarder heartbeat error:', e.message);
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// A phone is called healthy only while it is actively checking in. The
// thresholds are generous on purpose: the app heartbeats every 15 minutes,
// so one missed check-in is normal (a tunnel, a flaky tower) and should not
// raise an alarm, while several hours of silence genuinely means somebody
// needs to go and look at that handset.
const MANUAL_HEALTH_OK_MS = 45 * 60 * 1000;
const MANUAL_HEALTH_WARN_MS = 3 * 60 * 60 * 1000;
function manualNumberHealth(lastHeartbeatMs, lastSmsMs) {
  const seen = Math.max(Number(lastHeartbeatMs) || 0, Number(lastSmsMs) || 0);
  if (!seen) return { state: 'unknown', label: 'Never checked in', lastSeenAt: null };
  const age = Date.now() - seen;
  if (age <= MANUAL_HEALTH_OK_MS) return { state: 'healthy', label: 'Online', lastSeenAt: seen };
  if (age <= MANUAL_HEALTH_WARN_MS) return { state: 'stale', label: 'Not checked in recently', lastSeenAt: seen };
  return { state: 'offline', label: 'Offline', lastSeenAt: seen };
}

// Everything the owner asked to be able to see per number: how many messages
// each phone forwarded, how many became real deposits, the success rate,
// how long forwarding actually takes, whether the phone is alive, and the
// same broken out day by day.
app.post('/admin/manual-numbers/analytics', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const days = Math.min(90, Math.max(1, parseInt(req.body && req.body.days, 10) || 14));
    const cutoffDay = eatDayKey(new Date(Date.now() - (days - 1) * 86400000));
    const [numsSnap, dailySnap] = await Promise.all([
      db.collection('manualPaymentNumbers').orderBy('network', 'asc').orderBy('order', 'asc').get(),
      db.collection('manualNumberDaily').where('day', '>=', cutoffDay).limit(20000).get(),
    ]);

    const byNumber = new Map();
    dailySnap.forEach(d => {
      const row = d.data();
      if (!byNumber.has(row.number)) byNumber.set(row.number, []);
      byNumber.get(row.number).push(row);
    });

    const blank = () => ({
      smsForwarded: 0, credited: 0, unmatched: 0, ambiguous: 0, mismatch: 0,
      duplicate: 0, unparsed: 0, ignored: 0, assigned: 0, expired: 0,
      unknownNumber: 0,
      amount: 0, deliveryMsSum: 0, deliverySamples: 0, deliveryMsMax: 0,
    });
    const sumInto = (acc, row) => {
      for (const k of Object.keys(acc)) {
        if (k === 'deliveryMsMax') acc[k] = Math.max(acc[k], Number(row[k]) || 0);
        else acc[k] += Number(row[k]) || 0;
      }
      return acc;
    };

    const numbers = numsSnap.docs.map(doc => {
      const n = doc.data();
      const rows = (byNumber.get(n.number) || []).slice().sort((a, b) => (a.day < b.day ? -1 : 1));
      const totals = rows.reduce((acc, r) => sumInto(acc, r), blank());
      // Success rate is measured against messages that were REAL money
      // arriving, not against every text the phone forwarded -- an operator
      // advert or a duplicate is not a failure of this number, and counting
      // it as one would make a perfectly healthy phone look broken.
      const realMoney = totals.credited + totals.unmatched + totals.ambiguous + totals.mismatch;
      const health = manualNumberHealth(tsMillis(n.lastHeartbeatAt), tsMillis(n.lastSmsAt));
      return {
        id: doc.id, number: n.number, holderName: n.holderName || '', network: n.network || '',
        active: n.active !== false,
        health: health.state, healthLabel: health.label, lastSeenAt: health.lastSeenAt,
        lastHeartbeatAt: tsMillis(n.lastHeartbeatAt) || null,
        lastSmsAt: tsMillis(n.lastSmsAt) || null,
        device: n.device || '', appVersion: n.appVersion || '',
        forwardingActive: n.forwardingActive === true,
        battery: Number.isFinite(Number(n.battery)) ? Number(n.battery) : null,
        ...totals,
        realMoneySms: realMoney,
        successRate: realMoney ? Math.round((totals.credited / realMoney) * 1000) / 10 : null,
        // How much of what this number was ASKED to collect actually landed.
        fillRate: totals.assigned ? Math.round((totals.credited / totals.assigned) * 1000) / 10 : null,
        avgDeliveryMs: totals.deliverySamples ? Math.round(totals.deliveryMsSum / totals.deliverySamples) : null,
        maxDeliveryMs: totals.deliveryMsMax || null,
        daily: rows.map(r => ({
          day: r.day,
          smsForwarded: Number(r.smsForwarded) || 0,
          credited: Number(r.credited) || 0,
          unmatched: Number(r.unmatched) || 0,
          ambiguous: Number(r.ambiguous) || 0,
          mismatch: Number(r.mismatch) || 0,
          duplicate: Number(r.duplicate) || 0,
          unparsed: Number(r.unparsed) || 0,
          assigned: Number(r.assigned) || 0,
          expired: Number(r.expired) || 0,
          amount: Number(r.amount) || 0,
          avgDeliveryMs: Number(r.deliverySamples) ? Math.round(Number(r.deliveryMsSum) / Number(r.deliverySamples)) : null,
          maxDeliveryMs: Number(r.deliveryMsMax) || null,
        })),
      };
    });

    // Any daily row whose number is NOT in the saved list came from a phone
    // configured with a number nobody set up -- the silent-failure case. It
    // would otherwise be invisible here, since this list is built from the
    // saved numbers only, which is exactly how it stayed hidden before.
    const savedSet = new Set(numsSnap.docs.map(d => d.data().number).filter(Boolean));
    const unknownNumbers = [];
    for (const [num, rows] of byNumber.entries()) {
      if (savedSet.has(num)) continue;
      const totals = rows.reduce((acc, r) => sumInto(acc, r), blank());
      unknownNumbers.push({
        number: num, ...totals,
        lastSeenAt: Math.max(...rows.map(r => tsMillis(r.lastEventAt) || 0), 0) || null,
      });
    }
    unknownNumbers.sort((a, b) => (b.smsForwarded || 0) - (a.smsForwarded || 0));

    const platform = numbers.reduce((acc, n) => sumInto(acc, n), blank());
    const platformReal = platform.credited + platform.unmatched + platform.ambiguous + platform.mismatch;
    res.json({
      status: 'success', days, numbers, unknownNumbers,
      totals: {
        ...platform,
        realMoneySms: platformReal,
        successRate: platformReal ? Math.round((platform.credited / platformReal) * 1000) / 10 : null,
        avgDeliveryMs: platform.deliverySamples ? Math.round(platform.deliveryMsSum / platform.deliverySamples) : null,
        numbersOnline: numbers.filter(n => n.health === 'healthy').length,
        numbersTotal: numbers.length,
      },
    });
  } catch (e) {
    console.error('Manual numbers analytics error:', e.message);
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ── ADMIN: manual payment numbers (5 MTN + 5 Airtel, or however many the
// owner wants) ──
app.post('/admin/manual-numbers/list', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const snap = await db.collection('manualPaymentNumbers').orderBy('network', 'asc').orderBy('order', 'asc').get();
    res.json({ status: 'success', numbers: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/manual-numbers/save', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const { id, network, number, holderName, active, order } = req.body;
    if (!NETWORK_NAMES.has(network)) return res.status(400).json({ status: 'error', message: 'Select a valid network' });
    const cleanNumber = cleanPhone(number);
    if (!cleanNumber) return res.status(400).json({ status: 'error', message: 'Enter a valid phone number' });
    const name = String(holderName || '').trim().slice(0, 80);
    if (!name) return res.status(400).json({ status: 'error', message: 'Enter the account holder name' });
    const doc = { network, number: cleanNumber, holderName: name, active: active !== false, order: Number(order) || 0 };
    if (id) await db.collection('manualPaymentNumbers').doc(String(id)).set(doc, { merge: true });
    else await db.collection('manualPaymentNumbers').add({ ...doc, createdAt: FieldValue.serverTimestamp() });
    logAdminAction(req, 'manual_number_saved', { id: id || null, network, number: cleanNumber });
    res.json({ status: 'success' });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/manual-numbers/delete', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const id = String(req.body.id || '');
    if (!id) return res.status(400).json({ status: 'error', message: 'id required' });
    const numDoc = await db.collection('manualPaymentNumbers').doc(id).get();
    // Refuse to delete a number a member is actively mid-payment against --
    // the assigned-number is the only thing letting a later SMS find its way
    // back to the right pending deposit; deleting it out from under a live
    // order would strand a real payment the member is about to make. The
    // order self-resolves within 15 minutes either way (expiry sweep), so
    // this is a short wait, not a permanent block.
    if (numDoc.exists) {
      const number = numDoc.data().number;
      if (number) {
        const activeSnap = await db.collection('pendingDeposits')
          .where('method', '==', 'manual').where('assignedNumber', '==', number)
          .where('status', '==', 'pending').limit(1).get();
        if (!activeSnap.empty) {
          return res.status(409).json({ status: 'error', message: 'This number has a live pending deposit assigned to it right now -- it will free up on its own within 15 minutes, or once that deposit resolves.' });
        }
      }
    }
    await db.collection('manualPaymentNumbers').doc(id).delete();
    logAdminAction(req, 'manual_number_deleted', { id });
    res.json({ status: 'success' });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
// Admin resolution for a MANUAL_REVIEW order that turns out NOT to be a
// genuine payment (fabricated/irrelevant pasted text, a real mismatch,
// etc.) -- the opposite of /admin/deposit/force-credit, which already
// works unmodified for the "yes, credit it" resolution (it operates on any
// pendingDeposits doc via creditDeposit(), manual or automatic alike).
app.post('/admin/deposit/manual/reject', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const depositId = String(req.body.depositId || '');
    if (!depositId) return res.status(400).json({ status: 'error', message: 'depositId required' });
    const snap = await db.collection('pendingDeposits').doc(depositId).get();
    if (!snap.exists) return res.status(404).json({ status: 'error', message: 'Deposit not found' });
    if (depositFullyCredited(snap.data())) return res.status(400).json({ status: 'error', message: 'This deposit was already credited -- cannot reject it now.' });
    const rejected = await markDepositFailed(snap.ref, snap.data().userId, 'Rejected by admin after review.');
    if (!rejected) return res.status(409).json({ status: 'error', message: 'This deposit was credited by another process just now.' });
    logAdminAction(req, 'manual_deposit_rejected', { depositId });
    res.json({ status: 'success' });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});

// ═══════════════════════════════════════════
// WITHDRAWAL (MarzPay send-money, mobile money only)
// ═══════════════════════════════════════════
const _withdrawInFlight = new Set();
const _witRequestInFlight = new Set();
// The Transaction PIN set at registration is the ONLY PIN in Snow -- it
// gates every actual money-moving withdrawal request. It no longer gates
// binding/removing a withdrawal account (owner, Round 39: "remove pin
// putting here, only it will be on Withdrawals") -- saving/removing a
// payout destination doesn't move money by itself, see /bank/save and
// /bank/delete for that change.
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
    // NOT db.runTransaction -- see /invest/create's own comment on why: no
    // real rollback exists here anyway, so awaiting each write directly lets
    // this catch a failure after the debit and refund it exactly, instead of
    // silently leaving the member charged with no withdrawal request to show
    // for it.
    await withLock('bal:' + userId, async () => {
      const uRef = db.collection('users').doc(userId);
      const fresh = await uRef.get();
      if (!fresh.exists) throw new Error('User not found');
      if (fresh.data().status === 'banned') { const banErr = new Error('Account suspended. Contact customer service.'); banErr.code = 'BANNED'; throw banErr; }
      if (sett.requireInvestToWithdraw !== false && (fresh.data().totalInvested || 0) <= 0)
        throw new Error('Purchase at least one plan before you can cash out.');
      const bal = fresh.data().walletBalance || 0;
      if (bal < amt) {
        logSecurityEvent(userId, 'withdraw_insufficient_funds', { attempted: amt, balance: bal });
        throw new Error(`Not enough balance, you have ${fmtUGX(bal)}`);
      }
      const maxPerDay = Number(sett.maxWithdrawalsPerDay) || 0;
      if (maxPerDay > 0) {
        const today = nowStr().date;
        const todaySnap = await db.collection('withdrawals').where('userId', '==', userId).where('date', '==', today).get();
        if (todaySnap.size >= maxPerDay)
          throw new Error(`You've reached today's limit of ${maxPerDay} cash-out${maxPerDay === 1 ? '' : 's'}. Try again tomorrow.`);
      }
      const witRef = db.collection('withdrawals').doc();
      witId = witRef.id;
      await uRef.update({ walletBalance: FieldValue.increment(-amt) });
      const { date, time } = nowStr();
      try {
        await witRef.set({ userId, amount: amt, fee, net, holder, network: rawNetwork, phone: destValue, ref, status: 'pending', date, time, createdAt: FieldValue.serverTimestamp() });
        // Owner: "instead of putting many words make it simple, no need to
        // put name, need only withdrawal, status, amount" -- dropped the
        // holder name, network, and fee breakdown that used to be spelled
        // out here (still recorded on the withdrawal doc itself, just not
        // repeated in this one-line ledger description).
        await db.collection('transactions').add({
          // displayAmount mirrors the deposit-side fix (see /deposit/marzpay's
          // own comment): finalizeWithdrawalTransactionRecord() zeroes
          // `amount` once a decline's refund is confirmed, to keep the
          // walletBalance/totalDeposited integrity math honest -- but that
          // used to also make Records' amount column show "+UGX 0" for a
          // refunded withdrawal instead of what was actually attempted.
          userId, type: 'withdraw', description: `Withdrawal: Processing (${fmtUGX(amt)})`,
          amount: -amt, displayAmount: -amt, status: 'pending', date, time, ref, withdrawalId: witRef.id, createdAt: FieldValue.serverTimestamp()
        });
      } catch (createErr) {
        // Codex-caught real bug: same shape as the investment path above --
        // witRef.set() can succeed while transactions.add() throws, leaving
        // a status:'pending' withdrawal doc behind even after the refund
        // below restores the wallet. Left alone, admin approval or the
        // auto-approve/reconcile tick would still see it as a real pending
        // withdrawal and pay it out via MarzPay on top of the refund.
        await witRef.delete().catch(delErr => {
          console.error(`MONEY-SAFETY: withdrawal ${witRef.id} ledger-row write failed AND the withdrawal doc itself could not be deleted -- a refunded-but-still-payable withdrawal may be left behind for user ${userId}. Manual fix required.`, delErr.message);
        });
        await uRef.update({ walletBalance: FieldValue.increment(amt) }).catch(compErr => {
          console.error(`MONEY-SAFETY: withdrawal ${witRef.id} creation failed AFTER debiting user ${userId} ${amt}, and the compensating refund ALSO failed -- wallet is short by ${amt}. Manual fix required.`, compErr.message);
        });
        throw createErr;
      }
    });
    sendAdminPush('New withdrawal request', `${fmtUGX(amt)} requested via ${rawNetwork}`, { type: 'withdrawal', withdrawalId: witId }).catch(() => {});
    sendWithdrawalSmsAlert().catch(() => {});
    res.json({ status: 'success', withdrawalId: witId, reference: ref, net, message: 'Cash-out requested, processing now' });
  } catch (e) {
    res.status(400).json({ status: 'error', code: e.code, message: e.message });
  } finally { _witRequestInFlight.delete(userId); }
});
// `refunded` MUST be the real, confirmed result of the wallet-side refund
// (declineWithdrawalAndRefund's/completeWithdrawalRefund's own return value)
// -- not just "did the status become declined." Zeroing this row's amount
// is what tells /admin/integrity's ledger sum "this debit has been
// reversed"; doing that before the wallet refund has actually landed
// (e.g. it failed and fell through to the reconciler) makes the ledger
// claim the money's back when it isn't yet, producing exactly the
// walletBalance-vs-ledger mismatch this was found from. When refunded is
// false, the row is left as its real, still-outstanding debit (with an
// honest "refund pending" description) until a later call — from the
// reconciler, once completeWithdrawalRefund actually succeeds — finalizes
// it with refunded:true.
async function finalizeWithdrawalTransactionRecord(withdrawalId, outcome, refunded) {
  try {
    const txSnap = await db.collection('transactions').where('withdrawalId', '==', withdrawalId).limit(10).get();
    if (txSnap.empty) return;
    const newStatus = outcome === 'processed' ? 'success' : 'failed';
    const statusLabel = outcome === 'processed' ? 'Success' : (refunded ? 'Failed, refunded' : 'Failed, refund pending');
    await Promise.all(txSnap.docs.map(txDoc => {
      // Rebuilt fresh from the row's own stored amount rather than editing
      // the old text -- simpler and no longer coupled to the exact
      // "processing" suffix the description used to always end with.
      const amt = Math.abs(Number(txDoc.data().amount) || 0);
      const update = { status: newStatus, description: `Withdrawal: ${statusLabel} (${fmtUGX(amt)})` };
      if (newStatus === 'failed' && refunded) update.amount = 0; // wallet was CONFIRMED refunded in full, zero this row so the ledger sum stays correct
      return txDoc.ref.update(update);
    }));
  } catch (e) { console.warn('finalizeWithdrawalTransactionRecord (non-critical):', e.message); }
}
// Applies the wallet-side refund recorded on a declined withdrawal
// (refundPending + refundAmount/refundNetToUnwind, set atomically together
// with the 'declined' status transition by declineWithdrawalAndRefund
// below) and clears refundPending once it lands. Idempotent and safe to
// call again on the same withdrawal -- re-reads the doc and does nothing if
// refundPending is already false, so both the original decline call and a
// later reconciler retry can safely call this without double-refunding.
// Returns true once refundPending is CONFIRMED false (whether it just now
// cleared it, or it was already clear) -- callers use this to know whether
// it's actually safe to zero this withdrawal's transaction-ledger row (see
// finalizeWithdrawalTransactionRecord's own comment for why that must wait).
async function completeWithdrawalRefund(witRef, userId) {
  try {
    const fresh = await witRef.get();
    if (!fresh.exists || !fresh.data().refundPending) return true;
    const fd = fresh.data();
    // Codex-caught real bug: this used to be TWO separate writes -- credit
    // the wallet, THEN (a separate call, its failure swallowed by .catch)
    // clear refundPending. If clearing the marker failed for any reason
    // (not just a crash -- any transient write error), refundPending
    // stayed true forever, and reconcileStuckWithdrawalRefunds() (which
    // scans for exactly refundPending:true every 30s) would call this
    // function again, see refundPending still true, and credit the SAME
    // refund a second time -- and again on every tick after that, with no
    // limit. updateIf() makes the wallet credit and the "this exact
    // withdrawal has been refunded" claim ONE atomic conditional update,
    // the same pattern creditDeposit() now uses: the wallet is only ever
    // credited if this withdrawalId is not already in
    // refundedWithdrawalIds, and the id is added in that same atomic
    // operation. `applied:false` means this exact refund already landed
    // (a safe, idempotent retry), not an error.
    const uRef = db.collection('users').doc(userId);
    const updates = { walletBalance: FieldValue.increment(fd.refundAmount || 0), refundedWithdrawalIds: FieldValue.arrayUnion(witRef.id) };
    if (fd.refundNetToUnwind) updates.totalWithdrawn = FieldValue.increment(-fd.refundNetToUnwind);
    const applied = await uRef.updateIf({ refundedWithdrawalIds: { $ne: witRef.id } }, updates);
    if (!applied) {
      // Codex-caught real bug (2nd money-flow audit): updateIf() returning
      // false means EITHER "already applied" (the token's already there --
      // genuinely safe) OR "no document matched _id at all" (the user was
      // deleted) -- treating every false as safe used to let this function
      // clear refundPending and return true even when the refund never
      // actually landed anywhere, which would then let the caller zero the
      // withdrawal's own ledger row (finalizeWithdrawalTransactionRecord),
      // permanently erasing any trace that a refund was ever owed. Re-check
      // which case this actually is before trusting it.
      const recheck = await uRef.get();
      const tokenPresent = recheck.exists && (recheck.data().refundedWithdrawalIds || []).includes(witRef.id);
      if (!tokenPresent) {
        console.error(`MONEY-SAFETY: withdrawal refund ${witRef.id} could not be verified -- user ${userId} document is missing (or the idempotency token is absent) after updateIf() reported no match. refundPending stays true.`);
        return false;
      }
      console.warn(`Withdrawal refund ${witRef.id} already applied (idempotent retry) -- skipped re-crediting.`);
    }
    await witRef.update({ refundPending: FieldValue.delete(), refundAmount: FieldValue.delete(), refundNetToUnwind: FieldValue.delete() }).catch(() => {});
    return true;
  } catch (e) {
    console.error(`MONEY-SAFETY: withdrawal refund failed for ${witRef.id} user ${userId} -- refundPending stays true, the reconciler will retry.`, e.message);
    return false;
  }
}
// Declines a withdrawal (only from one of fromStatuses, else a no-op — lets
// every caller pass the SAME status guard it already checked outside the
// lock without re-duplicating that logic) and refunds its full gross amount.
// The status flip + a durable refundPending marker land in ONE atomic
// single-document update (Mongo's updateOne is atomic per document even
// without M0's missing multi-document transactions); the wallet refund is a
// separate write right after it. If that second write fails -- a network
// blip, a process crash -- the withdrawal is left 'declined' with
// refundPending:true instead of silently declined-and-unrefunded with no
// trace: reconcileStuckWithdrawalRefunds (in the periodic reconciler) scans
// for exactly that and retries it.
// Returns { declined, refunded } -- `declined` is whether the status
// transition happened at all; `refunded` is the real signal callers need
// before they're allowed to zero the ledger row (see
// finalizeWithdrawalTransactionRecord). These used to be conflated into one
// boolean that only ever meant "declined" -- every call site either ignored
// it or (worse, at /admin/withdraw/reject) treated it AS "refunded", which
// was wrong the moment the wallet-side write failed and fell through to the
// reconciler: the ledger row got zeroed immediately regardless, silently
// telling /admin/integrity the money had already gone back when the wallet
// was still short by the full amount until the reconciler's later retry
// caught up -- a real, reproducible source of the "wallet balance ≠ ledger"
// mismatches the owner reported.
// declinedBy is only ever supplied by a real admin action (/admin/withdraw/
// reject) -- every other call site is a system/reconciler-driven decline
// (a provider-side failure, not a person's decision), so it's left unset
// there rather than attributed to a made-up actor.
async function declineWithdrawalAndRefund(witRef, userId, reason, fromStatuses, declinedBy) {
  let didDecline = false, refunded = false;
  await withLock('bal:' + userId, async () => {
    const fresh = await witRef.get();
    if (!fresh.exists || !fromStatuses.includes(fresh.data().status)) return;
    const fd = fresh.data();
    const netToUnwind = fd.status === 'processing' ? fd.net : 0;
    const updates = { status: 'declined', failureReason: reason, refundPending: true, refundAmount: fd.amount, refundNetToUnwind: netToUnwind };
    if (declinedBy) { updates.declinedBy = declinedBy; updates.declinedAt = FieldValue.serverTimestamp(); }
    await witRef.update(updates);
    didDecline = true;
    refunded = await completeWithdrawalRefund(witRef, userId);
  });
  return { declined: didDecline, refunded };
}
// Guarded transition to 'processed' — shares the SAME 'bal:'+userId lock key
// every failure/refund path already uses, so a success and a failure branch
// can never race each other into disagreeing about the final outcome.
async function markWithdrawalProcessed(witRef, userId) {
  let didTransition = false;
  await withLock('bal:' + userId, async () => {
    const fresh = await witRef.get();
    if (!fresh.exists) return;
    const status = fresh.data().status;
    // Codex-caught real bug (2nd money-flow audit): a withdrawal stuck at
    // 'sending' (the post-send-money write that would normally flip it to
    // 'processing' itself failed after MarzPay already accepted/sent the
    // payout -- see processWithdrawalCore's own comment) could never reach
    // 'processed' through this function, since it only ever accepted a
    // 'processing' starting state. /withdraw/callback's own webhook-uuid
    // fallback path (which independently re-verifies against MarzPay before
    // ever calling here) is exactly the self-heal for that stuck state --
    // widened to also accept 'sending' so that self-heal can actually land.
    if (status !== 'processing' && status !== 'sending') return;
    await witRef.update({ status: 'processed', processedAt: FieldValue.serverTimestamp() });
    didTransition = true;
    if (status === 'sending') {
      // A withdrawal reaching 'processed' straight from 'sending' skipped
      // the normal 'sending'->'processing' step, which is the ONLY place
      // totalWithdrawn is ordinarily incremented (processWithdrawalCore) --
      // without this, it would self-heal to 'processed' with totalWithdrawn
      // never touched, permanently missing this payout's net from the stat.
      try {
        await db.collection('users').doc(userId).update({ totalWithdrawn: FieldValue.increment(fresh.data().net || 0) });
      } catch (twErr) {
        console.error(`MONEY-SAFETY: totalWithdrawn increment failed after self-healing withdrawal ${witRef.id} from 'sending' -- user ${userId} is missing their net in totalWithdrawn. Backfill by hand.`, twErr.message);
      }
    }
  });
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

    // Owner: "when/if manual payment is switched also withdrawals are
    // manual, so it is approved manually when manual payment is toggled."
    // The same Settings toggle that puts DEPOSITS on admin payment numbers
    // also takes MarzPay out of the payout path: the admin sends the money
    // by hand from their own mobile-money account and then records that
    // here. So this call must never contact MarzPay -- it only writes down
    // a payment that has ALREADY happened outside the system.
    //
    // Everything after the status flip is identical to the sandbox path
    // just below (straight to 'processed', totalWithdrawn incremented once,
    // ledger row finalised), because the shape is the same: a payout that
    // is already final by the time we hear about it, with no 'processing'
    // stage to wait on and nothing for the reconcilers to poll.
    const settNow = await getSettings();
    if (payoutIsManual(settNow)) {
      // Atomic conditional flip, not read-then-write: this is the one place
      // a repeat call could double-count totalWithdrawn, and the status
      // check above ran outside any lock. updateIf only matches while the
      // withdrawal is still 'pending', so a second call writes nothing and
      // is told the status changed instead of incrementing again.
      const claimed = await witRef.updateIf({ status: 'pending' }, {
        status: 'processed', payoutMethod: 'manual',
        processedBy, processedAt: FieldValue.serverTimestamp(),
      });
      if (!claimed) {
        const now = await witRef.get();
        return { code: 400, body: { status: 'error', message: `Cannot mark paid, the status is '${now.exists ? now.data().status : 'missing'}'` } };
      }
      await withLock('bal:' + wit.userId, async () => {
        try {
          await db.collection('users').doc(wit.userId).update({ totalWithdrawn: FieldValue.increment(wit.net) });
        } catch (twErr) {
          console.error(`MONEY-SAFETY: totalWithdrawn increment failed AFTER manual withdrawal ${withdrawalId} was marked paid — user ${wit.userId} is missing +${wit.net} in their totalWithdrawn stat. Backfill by hand.`, twErr.message);
        }
      });
      await finalizeWithdrawalTransactionRecord(withdrawalId, 'processed');
      return {
        code: 200,
        body: { status: 'success', manual: true, message: `Recorded as paid by hand: ${fmtUGX(wit.net)} to ${wit.phone}` },
        meta: { amount: wit.net, dest: wit.phone, userId: wit.userId, payoutMethod: 'manual' },
      };
    }

    if (withdrawProvider(settNow) === 'lipapay') {
      // LipaPay branch (Round 102) -- mirrors the MarzPay send-money branch
      // below function-for-function: write the outbound identifier BEFORE
      // ever calling the provider (so a later write failure can never leave
      // it unrecorded, the exact class of bug this file's own comment on
      // marzReference already documents once), a network exception is
      // ambiguous (never revert to 'pending' -- that invites a double-pay
      // retry), and a genuinely successful SUBMISSION only means
      // 'processing', not done -- LipaPay's own doc says every Unified
      // Order (collection OR disbursement) resolves asynchronously via the
      // callback, so this never treats acceptance as completion the way
      // MarzPay's sandbox shortcut does (LipaPay has no such shortcut).
      // outTradeNo = this withdrawal's own doc id -- already a
      // crypto.randomUUID(), exactly LipaPay's required 6-36-char
      // allowed-charset shape, so a genuine retry of the same withdrawal
      // reuses the identical OutTradeNo and LipaPay's own duplicate-order
      // rejection is the dedup guard, not an internal retry loop.
      const outTradeNo = withdrawalId;
      await witRef.update({ status: 'sending', sendingReference: outTradeNo, lipaOutTradeNo: outTradeNo, sendingBy: processedBy, sendingAt: FieldValue.serverTimestamp() });
      let lpData, ambiguousLipa = false;
      try {
        lpData = await lipaDisburse({
          amountUgx: wit.net, traderId: lipaTraderId(wit.phone), channel: lipaChannel(wit.network),
          description: 'Withdrawal', outTradeNo,
          notifyUrl: PUBLIC_URL ? PUBLIC_URL + '/withdraw/lipapay/callback' : undefined,
        });
      } catch (netErr) {
        console.error('LipaPay unified-order (disbursement) network error (ambiguous, NOT reverting to pending):', netErr.message);
        ambiguousLipa = true;
        lpData = { Succeeded: false, providerDown: true, Errors: netErr.message };
      }
      if (ambiguousLipa) {
        return { code: 500, body: { status: 'error', message: 'Lost contact with LipaPay mid-request. We cannot confirm whether this payout was actually sent. It stays on "Sending" (not pending) so nobody retries it blindly.', sendingReference: outTradeNo } };
      }
      if (!lpData.Succeeded) {
        await witRef.update({ status: 'pending', sendingReference: null, lipaOutTradeNo: null, sendingBy: null, sendingAt: null }).catch(() => {});
        return { code: 400, body: { status: 'error', message: lipaUserMsg(lpData, 'LipaPay could not send this payout right now. The withdrawal stays pending and untouched. Try again in a moment.') } };
      }
      const lipaTransactionId = lpData.Data?.TransactionId || null;
      await withLock('bal:' + wit.userId, async () => {
        await witRef.update({ status: 'processing', processedBy, processedAt: FieldValue.serverTimestamp(), lipaOutTradeNo: outTradeNo, lipaTransactionId });
        try {
          await db.collection('users').doc(wit.userId).update({ totalWithdrawn: FieldValue.increment(wit.net) });
        } catch (twErr) {
          console.error(`MONEY-SAFETY: totalWithdrawn increment failed AFTER withdrawal ${withdrawalId} was marked sent via LipaPay — user ${wit.userId} is missing +${wit.net} in their totalWithdrawn stat. Backfill by hand.`, twErr.message);
        }
      });
      try {
        const txSnap = await db.collection('transactions').where('withdrawalId', '==', withdrawalId).limit(1).get();
        if (!txSnap.empty) await txSnap.docs[0].ref.update({ status: 'processing' });
      } catch (txErr) { console.warn('Process tx update (non-critical):', txErr.message); }
      return {
        code: 200,
        body: { status: 'success', sandbox: false, message: `Sending ${fmtUGX(wit.net)} to ${wit.phone}` },
        meta: { amount: wit.net, dest: wit.phone, userId: wit.userId },
      };
    }

    const sendingMarker = crypto.randomUUID();
    // Codex-caught real bug (2nd money-flow audit): marzReference -- the
    // field /withdraw/callback actually looks withdrawals up by -- used to
    // only get written in the POST-success update further down. If MarzPay
    // genuinely accepted and sent the payout but that later write then
    // failed (a transient DB error), the withdrawal was stuck at 'sending'
    // with no marzReference recorded anywhere -- the callback could never
    // find it (empty query), and /admin/withdraw/verify (see its own
    // updated comment below) would wrongly read "no gateway reference,
    // nothing was sent" even though the money may have already gone out.
    // Mirrors the deposit side's own already-correct pattern (marzReference
    // is set at deposit CREATION, before ever calling MarzPay) -- writing it
    // here, before the call, means it's always persisted regardless of
    // whether any later write in this function fails.
    await witRef.update({ status: 'sending', sendingReference: sendingMarker, marzReference: sendingMarker, sendingBy: processedBy, sendingAt: FieldValue.serverTimestamp() });

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
      return { code: 500, body: { status: 'error', message: 'Lost contact with MarzPay mid-request. We cannot confirm whether this payout was actually sent. It stays on "Sending" (not pending) so nobody retries it blindly.', sendingReference: sendingMarker } };
    }
    if (mpData.status !== 'success' && mpData.status !== 'sandbox') {
      await witRef.update({ status: 'pending', sendingReference: null, marzReference: null, sendingBy: null, sendingAt: null }).catch(() => {});
      return { code: 400, body: { status: 'error', message: marzUserMsg(mpData, 'MarzPay could not send this payout right now. The withdrawal stays pending and untouched. Try again in a moment.') } };
    }
    const sandbox = mpData.status === 'sandbox';
    const updateFields = { status: sandbox ? 'processed' : 'processing', processedBy, processedAt: FieldValue.serverTimestamp(), marzReference: sendingMarker, marzTxUuid: mpData.data?.transaction?.uuid || null };
    // subagent-audit-caught real bug: every OTHER totalWithdrawn mutation
    // (declineWithdrawalAndRefund, /admin/user/repair-ledger -- see its own
    // comment claiming "every withdrawal status transition that touches
    // totalWithdrawn ... is serialized through this exact lock key") takes
    // out bal:<userId> first. This "send" transition was the one place that
    // comment was wrong about -- it never actually locked, so a
    // repair-ledger run racing a send here could land its absolute-overwrite
    // BETWEEN this increment's read and write, silently losing or double-
    // counting this withdrawal's net amount in totalWithdrawn. No lock is
    // already held here (verified: neither /admin/withdraw/process nor
    // autoApproveWithdrawalsTick, the only two callers, holds bal:<userId>
    // before this point), so this can't deadlock.
    await withLock('bal:' + wit.userId, async () => {
      await witRef.update(updateFields);
      try {
        await db.collection('users').doc(wit.userId).update({ totalWithdrawn: FieldValue.increment(wit.net) });
      } catch (twErr) {
        console.error(`MONEY-SAFETY: totalWithdrawn increment failed AFTER withdrawal ${withdrawalId} was marked sent — user ${wit.userId} is missing +${wit.net} in their totalWithdrawn stat. Backfill by hand.`, twErr.message);
      }
    });
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
  // Owner: "l can't see who manually approved the withdrawal, everywhere
  // shows owner, owner yet admins are available" -- this hardcoded the
  // literal string 'owner' regardless of which real staff account actually
  // clicked Send, so the "processed by X" line the admin UI already shows
  // was never telling the truth once more than one admin existed.
  const result = await processWithdrawalCore(withdrawalId, req.adminUser?.username || 'owner');
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
    // A payout the admin sent by hand (manual mode) has no MarzPay record at
    // all, by design. Without this branch it falls into "no gateway
    // reference, nothing was sent" below -- which reads as though the member
    // was never paid and invites rejecting a withdrawal that WAS paid,
    // refunding them on top of real money that already left an admin phone.
    if (w.payoutMethod === 'manual') {
      return res.json({
        status: 'success', ourStatus: w.status, marzStatus: 'manual',
        message: `This payout was sent by hand, not through MarzPay, so there is nothing to verify here${w.processedBy ? ' (recorded by ' + w.processedBy + ')' : ''}. Check the mobile-money record on the admin phone that sent it. Do NOT reject it unless you have confirmed there that no money went out.`,
      });
    }
    // Round 102: a LipaPay-routed withdrawal has neither marzReference nor
    // marzTxUuid at all -- without this branch it would fall straight into
    // the "no gateway reference, nothing was sent" case below, which is
    // FALSE for a LipaPay payout and would invite rejecting (and refunding)
    // a withdrawal that genuinely already went out via LipaPay. Mirrors the
    // MarzPay branch below exactly: an independent live re-check via
    // lipaOrderQuery(), never trusting our own stored status alone.
    if (w.lipaOutTradeNo) {
      const q = await lipaOrderQuery(w.lipaOutTradeNo);
      if (q.providerDown || !q.Data) {
        return res.json({ status: 'success', ourStatus: w.status, marzStatus: 'unverifiable', message: `A send attempt WAS made via LipaPay (OutTradeNo: ${w.lipaOutTradeNo}) but LipaPay did not respond just now. Try Verify again in a moment -- this does NOT mean nothing was sent.` });
      }
      const realStatus = lipaStatusLabel(q.Data.PayStatus);
      let lpMessage;
      if (realStatus === 'success' && w.status !== 'processed') lpMessage = `LipaPay says this payout was SENT, but our record is "${w.status}". Check the recipient before doing anything else.`;
      else if (realStatus === 'success') lpMessage = 'LipaPay confirms the payout was SENT and our record already shows it processed.';
      else if (realStatus === 'failed') lpMessage = 'LipaPay says this payout FAILED.';
      else lpMessage = 'LipaPay reports the payout is still processing.';
      return res.json({ status: 'success', ourStatus: w.status, marzStatus: realStatus || 'unknown', message: lpMessage });
    }
    if (!w.marzTxUuid) {
      // Codex-caught real bug (2nd money-flow audit): this used to claim
      // "nothing was sent" from a bare missing marzTxUuid alone -- but
      // marzTxUuid is MarzPay's own transaction id, only known once their
      // response (or a later webhook) is received; marzReference is OUR OWN
      // outgoing reference, set BEFORE ever calling MarzPay (see
      // processWithdrawalCore's own comment). A withdrawal can genuinely
      // have marzReference set with marzTxUuid still missing -- MarzPay was
      // actually called, we just don't have their own id to check MarzPay's
      // status API against (there is no lookup-by-reference call available).
      // Claiming "nothing was sent" in that case is false and, if the owner
      // acts on it by rejecting, refunds a member on top of a payout that
      // may have already gone out. Only say "nothing was sent" when there's
      // no record of an attempt at all.
      if (!w.marzReference) {
        return res.json({ status: 'success', ourStatus: w.status, marzStatus: 'no_reference', message: 'This payout never reached MarzPay (no gateway reference). Nothing was sent.' });
      }
      return res.json({
        status: 'success', ourStatus: w.status, marzStatus: 'unverifiable',
        message: `A send attempt WAS made (our reference: ${w.marzReference}) but we have no MarzPay transaction id to check against -- this does NOT mean nothing was sent. Check MarzPay's own dashboard for that reference before rejecting; rejecting a payout that already went out will refund the member on top of it.`,
      });
    }
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
    // Subagent-audit-caught real gap (Round 104): same shape as the deposit
    // status route's own fix above -- this only ever checked marzTxUuid, so
    // a LipaPay withdrawal's own poll never independently re-verified via
    // lipaOrderQuery(), unlike its webhook and the reconciler. Note: this
    // route is not currently called anywhere in user-src/ (a dead
    // code path today per the frontend audit), but fixed for correctness/
    // consistency regardless, matching every other LipaPay-aware branch.
    if (wit.lipaOutTradeNo) {
      const q = await lipaOrderQuery(wit.lipaOutTradeNo);
      if (q.providerDown || !q.Data) return res.json({ status: 'success', state: 'processing' });
      const realStatus = lipaStatusLabel(q.Data.PayStatus);
      if (realStatus === 'success') {
        if (await markWithdrawalProcessed(witSnap.ref, userId)) {
          await finalizeWithdrawalTransactionRecord(witSnap.id, 'processed');
          return res.json({ status: 'success', state: 'processed' });
        }
        const nowSnap = await witSnap.ref.get();
        return res.json({ status: 'success', state: nowSnap.exists ? nowSnap.data().status : 'processed' });
      }
      if (realStatus === 'failed') {
        const { declined, refunded } = await declineWithdrawalAndRefund(witSnap.ref, userId, 'Payout failed at the payment provider', ['processing']);
        if (declined) await finalizeWithdrawalTransactionRecord(witSnap.id, 'declined', refunded);
        return res.json({ status: 'success', state: 'declined' });
      }
      return res.json({ status: 'success', state: 'processing' });
    }
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
      // subagent-audit-caught: `declined` was discarded here -- if a
      // concurrent status check (the webhook, the reconciler, this exact
      // poll from another request) already won the decline race,
      // declineWithdrawalAndRefund() no-ops and returns declined:false, but
      // finalizeWithdrawalTransactionRecord() was still called unconditionally
      // and would overwrite the winner's already-correct "Failed, refunded"
      // row with a stale "Failed, refund pending" (and amount:0, since the
      // winner already zeroed it) -- permanently mislabeling a withdrawal
      // that was actually refunded promptly. Only /admin/withdraw/reject
      // had this guard before; mirrored here.
      const { declined, refunded } = await declineWithdrawalAndRefund(witSnap.ref, userId, 'Payout failed at the mobile-money provider', ['processing']);
      if (declined) await finalizeWithdrawalTransactionRecord(witSnap.id, 'declined', refunded);
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
    // Codex-caught real bug (2nd money-flow audit): a withdrawal stuck at
    // 'sending' (see markWithdrawalProcessed's own comment) used to be
    // invisible to this callback entirely -- widened to let it through for
    // the SUCCESS branch (a genuine success is always safe to recognize),
    // but the FAILED branch below still explicitly refuses to act on a
    // 'sending' row (see its own guard) -- auto-declining/refunding an
    // ambiguous "we don't know if it was sent" withdrawal from an
    // unauthenticated webhook is exactly the risk this codebase already
    // treats as admin-only, confirm-on-MarzPay's-dashboard-first territory.
    if (wit.status !== 'processing' && wit.status !== 'sending') return;
    const webhookUuid = body.data?.transaction?.uuid || body.transaction?.uuid || body.data?.uuid || null;
    if (isSuccess) {
      // Real bug fixed: this endpoint has no webhook signature/secret check
      // (unlike a call WE make outward to MarzPay with our own key, an
      // inbound POST here is just whatever hit the URL) -- the live re-check
      // against MarzPay's own API is what actually makes this safe to act
      // on, not the webhook body itself. If there's no uuid to check against
      // AT ALL (neither our own record's marzTxUuid nor one on the webhook),
      // there is nothing to verify the claim against, so this leaves the
      // withdrawal untouched -- same "refuse rather than trust an
      // unverifiable claim" posture /deposit/callback already uses.
      // Recoverable by hand via /admin/withdraw/verify + /admin/withdraw/reject
      // if MarzPay's dashboard confirms it wasn't actually sent.
      const uuidForCheck = wit.marzTxUuid || webhookUuid;
      if (!uuidForCheck) return;
      const liveStatus = await marzGetSendStatus(uuidForCheck);
      // Codex-caught real bug (2nd money-flow audit): this used to give an
      // INCONCLUSIVE live check (MarzPay briefly down/timed out, so
      // liveStatus is '') the same benefit of the doubt as a genuinely
      // already-trusted uuid, on the reasoning that "our own uuid is
      // already known-real." But that reasoning only justifies not BLOCKING
      // on an inconclusive check -- it does NOT justify marking the
      // withdrawal processed on the unauthenticated webhook's bare claim
      // when the live check confirmed nothing at all. An attacker who
      // somehow learned this withdrawal's unguessable marzReference could
      // send a fabricated success webhook timed to a MarzPay outage and
      // have it accepted. Always require an EXPLICIT confirmed success --
      // an inconclusive check now just leaves the withdrawal untouched for
      // the next webhook retry, reconciler tick, or user poll to confirm
      // for real, never blocking a genuine payout, just deferring
      // recognition of it.
      if (!SUCCESS_STATUSES.has(liveStatus)) return;
      // Codex-caught real bug (2nd money-flow audit): this used to persist
      // the WEBHOOK's own claimed uuid unconditionally, even when we
      // already had our OWN trusted uuid and verified THAT one -- silently
      // overwriting a known-good, independently-captured value with an
      // unverified one from an unauthenticated request. Only ever adopt the
      // webhook's uuid when we didn't already have our own (i.e. it's the
      // exact one that was just verified above, not a bystander value).
      if (!wit.marzTxUuid && webhookUuid) doc.ref.update({ marzTxUuid: webhookUuid }).catch(() => {});
      if (await markWithdrawalProcessed(doc.ref, wit.userId)) await finalizeWithdrawalTransactionRecord(doc.id, 'processed');
    } else if (isFailed) {
      // A 'sending' withdrawal is genuinely ambiguous (see
      // processWithdrawalCore's own comment) -- never auto-decline/refund
      // one from this unauthenticated, automated path. Only
      // /admin/withdraw/reject (a human, after checking MarzPay's own
      // dashboard) is allowed to resolve a 'sending' row as failed.
      if (wit.status === 'sending') return;
      let uuid = wit.marzTxUuid, tx = null;
      if (uuid) tx = await marzGetSendTx(uuid);
      else if (webhookUuid) {
        const candidate = await marzGetSendTx(webhookUuid);
        if (candidate.reference && candidate.reference === wit.marzReference) { uuid = webhookUuid; tx = candidate; doc.ref.update({ marzTxUuid: uuid }).catch(() => {}); }
      }
      if (!uuid || !tx || !FAILED_STATUSES.has(tx.status)) return;
      // subagent-audit-caught: same guard as /withdraw/marzpay/status --
      // `declined` must gate this call, or a decline-race loser permanently
      // overwrites the winner's correct ledger row with a stale label.
      const { declined, refunded } = await declineWithdrawalAndRefund(doc.ref, wit.userId, 'Payout failed at the mobile-money provider', ['processing']);
      if (declined) await finalizeWithdrawalTransactionRecord(doc.id, 'declined', refunded);
    }
  } catch (e) { console.error('Withdraw callback error:', e.message); }
});
// LipaPay's NotifyUrl target for disbursements. Same "always ack literal
// SUCCESS text, never trust the webhook body's own PayStatus, always
// independently re-verify via lipaOrderQuery() first" posture as
// /deposit/lipapay/callback above -- see that route's own comment for the
// full reasoning. markWithdrawalProcessed()/declineWithdrawalAndRefund()
// are the SAME provider-agnostic functions the MarzPay callback already
// uses, so there is zero new crediting/refunding logic here, only new
// matching/verification logic around unchanged money functions.
app.post('/withdraw/lipapay/callback', async (req, res) => {
  try {
    const outTradeNo = String(req.body?.OutTradeNo || '');
    if (!outTradeNo) return res.status(200).send('SUCCESS');
    const doc = await db.collection('withdrawals').doc(outTradeNo).get();
    if (!doc.exists) return res.status(200).send('SUCCESS');
    const wit = doc.data();
    if (wit.lipaOutTradeNo !== outTradeNo) return res.status(200).send('SUCCESS'); // not a LipaPay-routed withdrawal -- ignore, ack anyway
    // A 'sending' withdrawal is genuinely ambiguous (network error mid-send,
    // see processWithdrawalCore's own comment) -- mirrors MarzPay's own
    // callback exactly: safe to recognize a SUCCESS from 'sending' (a
    // genuine success is always safe), but never auto-decline/refund one
    // from this unauthenticated, automated path -- only /admin/withdraw/
    // reject (a human, after checking LipaPay's own dashboard) may resolve
    // a 'sending' row as failed.
    if (wit.status !== 'processing' && wit.status !== 'sending') return res.status(200).send('SUCCESS');
    const q = await lipaOrderQuery(outTradeNo);
    if (q.providerDown || !q.Data) return res.status(200).send('SUCCESS');
    const realStatus = lipaStatusLabel(q.Data.PayStatus);
    if (realStatus === 'success') {
      if (await markWithdrawalProcessed(doc.ref, wit.userId)) await finalizeWithdrawalTransactionRecord(doc.id, 'processed');
    } else if (realStatus === 'failed') {
      if (wit.status === 'sending') return res.status(200).send('SUCCESS'); // ambiguous -- admin-only resolution, see the comment above
      const { declined, refunded } = await declineWithdrawalAndRefund(doc.ref, wit.userId, 'Payout failed at the payment provider', ['processing']);
      if (declined) await finalizeWithdrawalTransactionRecord(doc.id, 'declined', refunded);
    }
    // realStatus === 'processing' -- genuinely not done yet, nothing to do
    res.status(200).send('SUCCESS');
  } catch (e) {
    console.error('LipaPay withdraw callback error:', e.message);
    res.status(200).send('SUCCESS');
  }
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
    // Owner: the transaction PIN belongs to the actual Withdraw money flow
    // only, not to managing which accounts CAN receive a future withdrawal
    // -- saving/removing a payout destination here doesn't move any money by
    // itself (see /withdraw/request, still fully PIN-gated, for that).
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
    // subagent-audit-caught: was missing the banned check every sibling
    // data-reading route has.
    const uSnap = await db.collection('users').doc(userId).get();
    if (uSnap.exists && uSnap.data().status === 'banned')
      return res.status(403).json({ status: 'error', code: 'BANNED', message: 'Account suspended. Contact customer service.' });
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
    // subagent-audit-caught: was missing the banned check every sibling
    // account-mutating route has.
    const uSnap = await db.collection('users').doc(userId).get();
    if (uSnap.exists && uSnap.data().status === 'banned')
      return res.status(403).json({ status: 'error', code: 'BANNED', message: 'Account suspended. Contact customer service.' });
    const ref = db.collection('bankAccounts').doc(id);
    const snap = await ref.get();
    if (!snap.exists || snap.data().userId !== userId) return res.status(404).json({ status: 'error', message: 'Account not found' });
    // Same reasoning as /bank/save above -- no PIN needed to remove a payout
    // destination, only to actually withdraw money.
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
    // subagent-audit-caught: was missing the banned check every sibling
    // account-mutating route has.
    const uSnap = await db.collection('users').doc(userId).get();
    if (uSnap.exists && uSnap.data().status === 'banned')
      return res.status(403).json({ status: 'error', code: 'BANNED', message: 'Account suspended. Contact customer service.' });
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
      if (codeSnap.empty) {
        // A code that doesn't exist at all is the actual "guessing" signal --
        // an already-used or usage-capped code below is a REAL code, not a
        // guess, so those aren't logged here.
        logSecurityEvent(userId, 'giftcode_invalid_attempt', { code: raw });
        result = { code: 400, body: { status: 'error', message: "That code isn't valid" } };
        return;
      }
      const codeDoc = codeSnap.docs[0];
      const cd = codeDoc.data();
      const code = cd.code;
      if (cd.active === false) { result = { code: 400, body: { status: 'error', message: 'This code is no longer active' } }; return; }
      if (cd.expiresAt && tsMillis(cd.expiresAt) < Date.now()) { result = { code: 400, body: { status: 'error', message: 'This code has expired' } }; return; }
      const usedBy = cd.usedBy || [];
      const alreadyClaimed = usedBy.indexOf(userId) !== -1;
      if (alreadyClaimed) {
        // subagent-audit-caught HIGH bug (Codex Finding #5): a bare
        // usedBy-membership check treated "claimed" as permanently final --
        // but CLAIM-BEFORE-CREDIT means a genuinely-FINISHED redemption
        // always has a matching promoRedemptions row, written right after
        // the credit lands. If this user is in usedBy with no such row,
        // their own earlier attempt claimed the code but crashed/failed
        // before the credit ever landed -- resume and complete it instead
        // of permanently stranding them with the code burned and no
        // reward. A genuinely already-completed redemption still correctly
        // rejects below (real row found).
        const priorSnap = await db.collection('promoRedemptions').where('userId', '==', userId).where('code', '==', code).limit(1).get();
        if (!priorSnap.empty) { result = { code: 400, body: { status: 'error', message: "You've already used this code" } }; return; }
      } else if (cd.maxUses && usedBy.length >= cd.maxUses) {
        result = { code: 400, body: { status: 'error', message: 'This code has reached its usage limit' } }; return;
      }
      // Legacy fallback: a code generated before random rewards only has
      // the old single `reward` field -- treat it as a zero-width range so
      // it still pays exactly that fixed amount, unchanged.
      const minReward = round2(Number(cd.minReward ?? cd.reward) || 0);
      const maxReward = round2(Number(cd.maxReward ?? cd.reward) || 0);
      let reward;
      // CLAIM-BEFORE-CREDIT — a retried redeem after a mid-request failure
      // must never credit twice off the same code. A resumed (already-
      // claimed-by-this-user) call skips the redundant arrayUnion write --
      // it's already there — and goes straight to completing the credit,
      // reusing the amount already rolled and persisted on the FIRST
      // attempt (below), never re-rolling — a retry must always pay
      // exactly what was already promised, not a fresh random draw.
      if (!alreadyClaimed) {
        // Rolled ONCE per claim, uniformly at cent (2-decimal) granularity
        // -- e.g. min 100.00/max 500.00 can land on 123.39, 234.89, etc.
        // crypto.randomInt's upper bound is exclusive, hence maxCents+1;
        // minReward===maxReward (a code with no real range) still works,
        // always returning that one value.
        const minCents = Math.round(minReward * 100), maxCents = Math.round(maxReward * 100);
        reward = crypto.randomInt(minCents, maxCents + 1) / 100;
        // Claiming the code AND persisting the rolled amount happen in one
        // atomic write, so a crash right after this line can never lose
        // track of what was promised -- the resume path above reads it
        // straight back off `cd.claimedRewards[userId]` on retry.
        await codeDoc.ref.update({ usedBy: FieldValue.arrayUnion(userId), ['claimedRewards.' + userId]: reward });
        const claimSnap = await codeDoc.ref.get();
        const claimedBy = (claimSnap.exists && claimSnap.data().usedBy) || [];
        if (claimedBy.indexOf(userId) === -1) { result = { code: 500, body: { status: 'error', message: 'Could not redeem this code' } }; return; }
        if (cd.maxUses && claimedBy.length > cd.maxUses) {
          await codeDoc.ref.update({ usedBy: FieldValue.arrayRemove(userId), ['claimedRewards.' + userId]: FieldValue.delete() }).catch(() => {});
          result = { code: 400, body: { status: 'error', message: 'This code has reached its usage limit' } }; return;
        }
      } else {
        // A genuinely lost roll (deploy-time race, never observed in
        // testing) falls back to minReward rather than re-rolling -- never
        // credit MORE than what could have been promised. Reads with a
        // real Number.isFinite() presence check, not `||` -- a `||`
        // fallback would wrongly treat a legitimately-rolled reward of
        // exactly 0 as "missing" and substitute minReward instead (0 is
        // falsy in JS). Can't happen via normal generation (minReward must
        // be > 0), but this makes the fallback correct on its own terms
        // rather than relying on that invariant holding elsewhere.
        const persisted = cd.claimedRewards && cd.claimedRewards[userId];
        reward = round2(Number.isFinite(persisted) ? persisted : minReward);
      }
      // Codex-caught real bug (2nd money-flow audit): claiming the code in
      // usedBy above is NOT the same as the credit having actually landed --
      // a crash right after the (unconditional, before this fix) wallet
      // increment but before the promoRedemptions proof row was written left
      // a resumed retry with no way to tell "credited, proof row missing"
      // apart from "never credited at all", so it just credited again.
      // updateIf() closes this the same way creditDeposit()/
      // completeWithdrawalRefund() already do: the wallet increment and a
      // durable per-user "this exact code is credited" token land in ONE
      // atomic write, so ANY retry -- after a crash here, or after a later
      // ledger-write failure below -- is a safe no-op for the wallet itself,
      // regardless of which write actually failed last time.
      const applied = await withLock('bal:' + userId, () => db.collection('users').doc(userId).updateIf(
        { redeemedGiftCodeIds: { $ne: codeDoc.id } },
        {
          walletBalance: FieldValue.increment(reward), totalEarned: FieldValue.increment(reward),
          redeemedGiftCodeIds: FieldValue.arrayUnion(codeDoc.id),
        }
      ));
      if (!applied) console.warn(`Gift code ${code} for user ${userId} already credited (idempotent retry) -- skipped re-incrementing.`);
      // Find-or-create, same shape as creditDeposit()'s own ledger step --
      // a retry after a ledger-write failure must never duplicate these
      // rows (a duplicate 'promocode' row would inflate totalEarned the
      // next time "Recalculate totals" runs, since that sum includes this
      // type).
      const priorRedemption = await db.collection('promoRedemptions').where('userId', '==', userId).where('code', '==', code).limit(1).get();
      if (priorRedemption.empty) {
        await db.collection('promoRedemptions').add({ userId, code, reward, createdAt: FieldValue.serverTimestamp() });
      }
      const priorTx = await db.collection('transactions').where('userId', '==', userId).where('type', '==', 'promocode').where('giftCode', '==', code).limit(1).get();
      if (priorTx.empty) {
        const { date, time } = nowStr();
        await db.collection('transactions').add({
          userId, type: 'promocode', description: `Gift code redeemed: ${code}`, giftCode: code,
          amount: reward, status: 'success', date, time, createdAt: FieldValue.serverTimestamp()
        });
      }
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
    // Codex-caught real bug (2nd money-flow audit): a member past 300
    // lifetime transactions used to silently get only the newest 300 with
    // no signal anything was missing, while Records' own footer still said
    // "No more data" -- a false claim. Bumped the cap generously (a
    // practically-unreachable ceiling for one person's real ledger, not a
    // pagination rewrite) and added a `truncated` flag so the client can
    // stop claiming completeness it can't back up.
    const TX_LIST_LIMIT = 2000;
    const snap = await db.collection('transactions').where('userId', '==', uid).orderBy('createdAt', 'desc').limit(TX_LIST_LIMIT).get();
    const transactions = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json({ status: 'success', transactions, truncated: transactions.length >= TX_LIST_LIMIT });
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
  // Codex-caught real bug: this used to send only {status, token} -- the
  // admin UI's storeSession(d.token, d.username, d.role) then stored
  // SESSION_ROLE as undefined for the OWNER's own master-key login, so
  // every SESSION_ROLE==='owner' check in the panel (Products/Settings/
  // Gift Codes/Admins/Activity Log/Integrity Audit, plus everything just
  // moved to verifyOwner()) silently treated the real owner as unprivileged
  // staff.
  res.json({ status: 'success', token: ADMIN_KEY, username: 'owner', role: 'owner' });
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
    // Codex-caught real bug: the Admins tab's "Last login" column always
    // read "Never" -- nothing ever recorded it. Best-effort (never blocks
    // the actual login on a write failure).
    db.collection('adminUsers').doc(username).update({ lastLoginAt: FieldValue.serverTimestamp() }).catch(() => {});
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
    res.json({ status: 'success', admins: snap.docs.map(d => ({ username: d.id, role: d.data().role || 'staff', active: d.data().active !== false, createdAt: d.data().createdAt || null, lastLoginAt: d.data().lastLoginAt || null })) });
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
// Real bug fixed: owner reported the SAME push notification arriving twice
// on one phone. sendAdminPush() sends to every token in adminPushTokens,
// and a single physical device can end up registered under more than one
// still-valid token over time (browser vs. installed-PWA each get their
// own FCM registration scope, a token can rotate after a browser/service-
// worker update, etc.) -- there's no way to detect "these two opaque
// tokens are actually the same device" from the token strings alone, so
// the practical fix is a one-click reset: wipe every registered token,
// then each device/browser re-subscribes cleanly via the existing
// Notify button, ending up with exactly one live token per context again.
app.get('/admin/push/list', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const snap = await db.collection('adminPushTokens').get();
    res.json({ status: 'success', count: snap.size, tokens: snap.docs.map(d => ({ token: d.id.slice(0, 16) + '…', registeredAt: d.data().registeredAt || null })) });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/push/clear-all', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const snap = await db.collection('adminPushTokens').get();
    await Promise.all(snap.docs.map(d => d.ref.delete()));
    logAdminAction(req, 'push_tokens_cleared', { count: snap.size });
    res.json({ status: 'success', cleared: snap.size });
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
  // 0 = not scheduled; upper bound is a plain sanity cap (year 2100), not a
  // real business constraint -- an admin fat-fingering a date shouldn't be
  // able to silently store something outside "any date anyone would ever
  // actually pick here."
  openingCountdownAt: [0, 4102444800000],
};
const SETTINGS_BOOLEAN_FIELDS = ['maintenanceMode', 'openingCountdownEnabled', 'requireInvestToWithdraw', 'autoApproveWithdrawalsEnabled', 'annEnabled', 'depositPayAEnabled', 'depositPayBEnabled'];
// subagent-audit-caught XSS: these free-text fields are rendered straight
// into `href="${esc(...)}"` (Help Centre buttons, the announcement dialog's
// OK button) in user-src/original_module.js. esc() only HTML-escapes
// &<>"' -- it does nothing to the URI *scheme*, so a value like
// "javascript:fetch(...)" would render as a normal-looking button that
// executes arbitrary JS in the app's origin (STATE, api(), fbAuth all in
// scope) the instant any member taps it. Rejecting anything but a genuine
// http(s) link at save time closes this for every place these fields are
// ever rendered, in one spot, rather than patching each render site.
const SETTINGS_URL_FIELDS = ['telegramGroup', 'telegramChannel', 'supportTelegram', 'whatsappGroup', 'whatsappContact'];
function isSafeExternalUrl(v) {
  if (!v) return true; // blank clears the field -- always allowed
  try { const u = new URL(String(v)); return u.protocol === 'http:' || u.protocol === 'https:'; }
  catch (_) { return false; }
}
app.post('/admin/settings/update', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
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
    for (const key of SETTINGS_URL_FIELDS) {
      if (key in updates && !isSafeExternalUrl(updates[key]))
        return res.status(400).json({ status: 'error', message: `${key} must be a valid http(s) link, or left blank.` });
    }
    if ('numberFont' in updates && !NUMBER_FONT_OPTIONS.includes(updates.numberFont))
      return res.status(400).json({ status: 'error', message: `numberFont must be one of: ${NUMBER_FONT_OPTIONS.join(', ')}` });
    // 'automatic' is deliberately NOT accepted here anymore (Round 102) --
    // it's still recognized when READING an already-stored legacy value
    // (normalizeProviderValue()), but nothing should ever WRITE it again
    // now that 'marzpay'/'lipapay' are the real, distinct canonical values.
    // 'manual' is likewise no longer accepted as of Round 145 -- this field
    // now only ever picks PAY A's own automatic GATEWAY; whether manual
    // (PAY B) is offered at all is controlled independently by
    // depositPayBEnabled below, not by this field. An already-stored
    // legacy 'manual' value is still read correctly (see getSettings()'s
    // own migration + depositAutomaticProvider()'s own fallback) -- it
    // just can never be WRITTEN again going forward.
    if ('depositMethod' in updates && !['marzpay', 'lipapay'].includes(updates.depositMethod))
      return res.status(400).json({ status: 'error', message: `depositMethod must be 'marzpay' or 'lipapay'` });
    if ('withdrawMethod' in updates && !['follow', 'marzpay', 'lipapay', 'manual'].includes(updates.withdrawMethod))
      return res.status(400).json({ status: 'error', message: `withdrawMethod must be 'follow', 'marzpay', 'lipapay' or 'manual'` });
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
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
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
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    await db.collection('banners').doc('home').delete();
    _bannerCacheTs = 0;
    res.json({ status: 'success' });
  } catch (e) { res.status(500).json({ status: 'error', message: 'Could not clear the banner' }); }
});
app.get('/admin/help-banner', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try { res.json({ status: 'success', image: await getHelpBanner() }); }
  catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/help-banner/set', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const image = String(req.body.image || '');
  if (!/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(image) || image.length > 2_800_000)
    return res.status(400).json({ status: 'error', message: 'Invalid image' });
  try {
    await db.collection('banners').doc('help').set({ image });
    _helpBannerCacheTs = 0;
    logAdminAction(req, 'help_banner_set', {});
    res.json({ status: 'success' });
  } catch (e) { res.status(500).json({ status: 'error', message: 'Could not save the banner' }); }
});
app.post('/admin/help-banner/clear', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    await db.collection('banners').doc('help').delete();
    _helpBannerCacheTs = 0;
    res.json({ status: 'success' });
  } catch (e) { res.status(500).json({ status: 'error', message: 'Could not clear the banner' }); }
});
app.get('/admin/announcement-image', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try { res.json({ status: 'success', image: await getAnnouncementImage() }); }
  catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/announcement-image/set', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const image = String(req.body.image || '');
  if (!/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(image) || image.length > 2_800_000)
    return res.status(400).json({ status: 'error', message: 'Invalid image' });
  try {
    await db.collection('banners').doc('announcement').set({ image });
    _announceImageCacheTs = 0;
    logAdminAction(req, 'announcement_image_set', {});
    res.json({ status: 'success' });
  } catch (e) { res.status(500).json({ status: 'error', message: 'Could not save the image' }); }
});
app.post('/admin/announcement-image/clear', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    await db.collection('banners').doc('announcement').delete();
    _announceImageCacheTs = 0;
    res.json({ status: 'success' });
  } catch (e) { res.status(500).json({ status: 'error', message: 'Could not remove the image' }); }
});
app.get('/admin/manual-pay-images', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const [selector, hero] = await Promise.all([getManualPayImage('selector'), getManualPayImage('hero')]);
    res.json({ status: 'success', selector, hero });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/manual-pay-image/set', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const slot = String(req.body.slot || '');
  if (slot !== 'selector' && slot !== 'hero') return res.status(400).json({ status: 'error', message: 'slot must be selector or hero' });
  const image = String(req.body.image || '');
  if (!/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(image) || image.length > 2_800_000)
    return res.status(400).json({ status: 'error', message: 'Invalid image' });
  try {
    await db.collection('banners').doc('manual-' + slot).set({ image });
    _manualPayImgCacheTs[slot] = 0;
    logAdminAction(req, 'manual_pay_image_set', { slot });
    res.json({ status: 'success' });
  } catch (e) { res.status(500).json({ status: 'error', message: 'Could not save the image' }); }
});
app.post('/admin/manual-pay-image/clear', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const slot = String(req.body.slot || '');
  if (slot !== 'selector' && slot !== 'hero') return res.status(400).json({ status: 'error', message: 'slot must be selector or hero' });
  try {
    await db.collection('banners').doc('manual-' + slot).delete();
    _manualPayImgCacheTs[slot] = 0;
    res.json({ status: 'success' });
  } catch (e) { res.status(500).json({ status: 'error', message: 'Could not remove the image' }); }
});
app.get('/admin/about-content', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try { res.json({ status: 'success', blocks: await getAboutContent() }); }
  catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/about-content/set', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const raw = Array.isArray(req.body.blocks) ? req.body.blocks : null;
  if (!raw || raw.length > 60) return res.status(400).json({ status: 'error', message: 'Invalid content -- 60 blocks max' });
  const blocks = [];
  let totalSize = 0;
  for (const b of raw) {
    if (b && b.type === 'text') {
      const text = String(b.text || '').slice(0, 4000).trim();
      if (!text) continue;
      blocks.push({ type: 'text', text });
      totalSize += text.length;
    } else if (b && b.type === 'image') {
      const image = String(b.image || '');
      if (!/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(image) || image.length > 2_800_000)
        return res.status(400).json({ status: 'error', message: 'One of the images is invalid or too large' });
      blocks.push({ type: 'image', image });
      totalSize += image.length;
    }
  }
  // Stays comfortably under Mongo's 16MB BSON document limit.
  if (totalSize > 11_000_000) return res.status(400).json({ status: 'error', message: 'Total content is too large -- remove or compress some images' });
  try {
    await db.collection('content').doc('about').set({ blocks });
    _aboutCacheTs = 0;
    logAdminAction(req, 'about_content_set', { blockCount: blocks.length });
    res.json({ status: 'success' });
  } catch (e) { res.status(500).json({ status: 'error', message: 'Could not save the About page' }); }
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
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const list = Array.isArray(req.body.products) ? req.body.products : [];
    const sanitized = [];
    for (let i = 0; i < list.length; i++) {
      const clean = sanitizeProductInput(list[i], i);
      if (!clean) return res.status(400).json({ status: 'error', message: `Product #${i + 1} (${list[i]?.name || list[i]?.key || 'unnamed'}) has an invalid key, name, price, or (if given) cycle/return. Nothing was saved.` });
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
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
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
    // No genuine pagination available in this Mongo/Firestore-compat layer
    // (no cursor support) -- bumped well past any realistic product-catalog
    // size instead of silently truncating at 1,000, per the button's own
    // "every product" promise.
    const snap = await db.collection('products').limit(100000).get();
    const batch = db.batch();
    let removed = 0;
    // Codex-caught real bug: tombstoning (deleted:true, like the single-
    // product delete route) left the doc's key in getProducts()'s
    // touchedKeys set, which EXCLUDES it from the DEFAULT_PRODUCTS
    // fallback -- "Clear all" made the catalogue permanently empty instead
    // of reverting to defaults, contradicting the button's own confirm
    // text. Hard-delete instead, so a cleared key falls straight through
    // to its DEFAULT_PRODUCTS entry again.
    snap.forEach(d => { batch.delete(d.ref); removed++; });
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
    // No genuine pagination available in this Mongo/Firestore-compat layer
    // (no cursor support) -- bumped well past any realistic product-catalog
    // size instead of silently truncating at 1,000, per the button's own
    // "every product" promise.
    const snap = await db.collection('products').limit(100000).get();
    const batch = db.batch();
    let synced = 0;
    snap.forEach(d => {
      const p = d.data();
      if (p.deleted) return;
      const def = defaultsByKey.get(d.id);
      if (!def) return;
      // Only touch (and count) a doc whose stored pricing genuinely
      // differs -- a saved product that already matches the defaults
      // shouldn't be reported as "synced" alongside ones that really changed.
      if (p.price === def.price && p.cycle === def.cycle && p.expectedReturn === def.expectedReturn) return;
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
// Owner: "make when gift codes are randomly claimed no fixed claiming so
// user randomly gets rewards, also this is governed by setting of minimum
// reward and maximum reward, so no more fixed rewards... also make when I
// can set treasure code to expire in given seconds." A code no longer
// carries one fixed `reward` -- it carries a `minReward`/`maxReward` range,
// and /redeem below rolls a real random amount (2-decimal precision, e.g.
// 123.39) for each claim, independently. Setting minReward===maxReward
// still works and behaves exactly like the old fixed-reward code, so
// nothing is lost for an admin who wants that. Expiry switched from
// whole minutes to whole seconds for finer-grained flash-code control.
app.post('/admin/promocodes/generate', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const minReward = round2(Number(req.body.minReward));
  const maxReward = round2(Number(req.body.maxReward));
  const maxUses = req.body.maxUses ? Math.round(Number(req.body.maxUses)) : null;
  const durationSeconds = req.body.durationSeconds ? Number(req.body.durationSeconds) : null;
  if (!Number.isFinite(minReward) || minReward <= 0 || minReward > MAX_MONEY_AMOUNT) return res.status(400).json({ status: 'error', message: 'Enter a valid minimum reward amount' });
  if (!Number.isFinite(maxReward) || maxReward < minReward || maxReward > MAX_MONEY_AMOUNT) return res.status(400).json({ status: 'error', message: 'Maximum reward must be a valid amount, at least the minimum' });
  if (maxUses !== null && (!Number.isFinite(maxUses) || maxUses <= 0)) return res.status(400).json({ status: 'error', message: 'Max uses must be a positive number' });
  if (durationSeconds !== null && (!Number.isFinite(durationSeconds) || durationSeconds <= 0)) return res.status(400).json({ status: 'error', message: 'Duration must be a positive number of seconds' });
  try {
    const code = await generateUniqueGiftCode();
    const doc = {
      code, codeLower: code.toLowerCase(), minReward, maxReward, maxUses: maxUses || null, usedBy: [], active: true,
      createdBy: req.adminUser?.username || 'owner', createdAt: FieldValue.serverTimestamp(),
    };
    if (durationSeconds) doc.expiresAt = new Date(Date.now() + durationSeconds * 1000);
    await db.collection('promoCodes').add(doc);
    logAdminAction(req, 'giftcode_generated', { code, minReward, maxReward, maxUses, durationSeconds });
    res.json({ status: 'success', code, minReward, maxReward });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
app.get('/admin/promocodes/list', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const snap = await db.collection('promoCodes').orderBy('createdAt', 'desc').limit(300).get();
    res.json({ status: 'success', codes: snap.docs.map(d => {
      const c = d.data();
      // A code generated before this round only ever has the old, single
      // `reward` field -- read as a degenerate range (min===max) so the
      // admin UI needs no legacy-shape branch at all.
      const uses = (c.usedBy || []).length;
      // Owner: "showing total reward claimed on each treasure." Real
      // per-claim rolled amounts, summed -- `claimedRewards` is written
      // atomically alongside `usedBy` at claim time (see /redeem), so it
      // always has exactly one entry per real claim, in sync with `uses`.
      // A code from before random rewards has no `claimedRewards` map at
      // all -- every one of its claims paid the exact same fixed `reward`,
      // so `reward * uses` is exactly right, not an approximation.
      const totalClaimed = c.claimedRewards
        ? round2(Object.values(c.claimedRewards).reduce((s, r) => s + (Number(r) || 0), 0))
        : round2((Number(c.reward) || 0) * uses);
      return { id: d.id, code: c.code, minReward: c.minReward ?? c.reward, maxReward: c.maxReward ?? c.reward,
        maxUses: c.maxUses || null, uses, totalClaimed,
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
    const [uSnap, invSnap, txSnap, witSnap, depSnap, bankSnap, teamDeposits, earnedTxSnap] = await Promise.all([
      db.collection('users').doc(userId).get(),
      db.collection('investments').where('userId', '==', userId).limit(200).get(),
      db.collection('transactions').where('userId', '==', userId).orderBy('createdAt', 'desc').limit(200).get(),
      db.collection('withdrawals').where('userId', '==', userId).orderBy('createdAt', 'desc').limit(100).get(),
      // Owner: "l can see people's deposits in details such that l see the
      // deposits they made and to which number and from which number at
      // what time" -- the generic `transactions` ledger row for a deposit
      // only ever carries amount/status/ref, never the actual
      // assignedNumber/senderPhone/network a real deposit order carries.
      // That detail only lives on the pendingDeposits doc itself, which
      // this endpoint never fetched per-user before.
      db.collection('pendingDeposits').where('userId', '==', userId).orderBy('createdAt', 'desc').limit(100).get(),
      db.collection('bankAccounts').where('userId', '==', userId).get(),
      wholeTeamDeposits(userId),
      // Owner: "money/unknown money is continuing to pile up... a very bad
      // bug bro" -- traced to the admin panel's "Cashback earned" field
      // (totalEarned) being a genuinely misleading label: it's cashback
      // PLUS referral commission PLUS checkin/gift-code/Task-Center/
      // Mission-Center bonuses, all folded into one number, shown right
      // above a SEPARATE "Team commission" figure that looks like an
      // independent pool but is actually already counted INSIDE it -- a
      // real explanation for why the total can look alarmingly large with
      // no obvious single source. Not a money bug (see the CLAUDE.md round
      // entry for this fix); a real visibility gap. Deliberately a
      // SEPARATE, uncapped-at-200 query (the `txSnap` above is capped for
      // the Recent Transactions list's own display purposes) -- a member
      // with a large team can have far more than 200 commission-crediting
      // rows, and a breakdown computed from a truncated list would
      // silently under-count and not add up to the real total shown above
      // it, which is exactly the kind of confusion this exists to remove.
      db.collection('transactions').where('userId', '==', userId).limit(50000).get(),
    ]);
    if (!uSnap.exists) return res.status(404).json({ status: 'error', message: 'User not found' });
    // transactionPinHash never leaves this server, even to an admin --
    // hasPayoutPin is the boolean the admin UI actually needs.
    const { transactionPinHash, ...userSafe } = uSnap.data();
    const earnedBreakdown = {};
    EARNING_TX_TYPES.forEach(t => { earnedBreakdown[t] = 0; });
    earnedTxSnap.forEach(d => {
      const t = d.data();
      if (EARNING_TX_TYPES.includes(t.type)) earnedBreakdown[t.type] += finiteMoney(t.amount);
    });
    res.json({
      status: 'success', user: { id: uSnap.id, ...userSafe, hasPayoutPin: !!transactionPinHash },
      investments: invSnap.docs.map(d => ({ id: d.id, ...d.data() })),
      transactions: txSnap.docs.map(d => ({ id: d.id, ...d.data() })),
      withdrawals: witSnap.docs.map(d => ({ id: d.id, ...d.data() })),
      deposits: depSnap.docs.map(d => ({ id: d.id, ...d.data() })),
      // Codex-caught real bug: these two were never sent, so the admin
      // modal always showed "UGX 0" / "None saved" regardless of reality.
      bankAccounts: bankSnap.docs.map(d => ({ id: d.id, ...d.data() })),
      teamDeposits, earnedBreakdown,
    });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
// Sets a NEW PIN chosen by the admin -- never clears transactionPinHash to
// null. Codex-caught real bug: Snow has no auto-setup-on-first-use PIN path
// (see the comment above PIN_LOCK_MS) -- pinCheck() unconditionally rejects
// a null hash as NO_PIN, and /account/transaction-pin/change always
// requires the OLD pin to match first. Clearing the hash to null would have
// permanently locked the member out of ever setting a replacement PIN
// themselves (can't withdraw, can't add/remove a payout account). Same
// pattern as /admin/user/reset-password: the admin types the new value,
// which they then relay to the member.
app.post('/admin/user/reset-payout-pin', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const userId = String(req.body.userId || '');
  const newPin = String(req.body.newPin || '');
  if (!userId) return res.status(400).json({ status: 'error', message: 'userId required' });
  if (!/^\d{5}$/.test(newPin)) return res.status(400).json({ status: 'error', message: 'New PIN must be 5 digits.' });
  if (isWeakPin(newPin)) return res.status(400).json({ status: 'error', message: 'That PIN is too easy to guess. Choose 5 digits that are not all the same.' });
  try {
    const ref = db.collection('users').doc(userId);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ status: 'error', message: 'User not found' });
    await ref.update({ transactionPinHash: scryptHash(newPin), pinFailCount: 0, pinLockedUntil: null });
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
    // Codex-caught real bug (round 3): every withdrawal status transition
    // that touches totalWithdrawn (send, decline, verify, reconcile — see
    // every other withLock('bal:'+userId, ...) site in this file) is
    // serialized through this exact lock key. Reading+overwriting
    // totalWithdrawn here without it could race a settlement mid-flight:
    // e.g. repair reads a withdrawal as still 'processing' (so it's
    // included) right as the decline path is about to subtract its net
    // from totalWithdrawn — repair's overwrite lands with the OLD
    // (too-high) total included, then decline's own subtraction runs on
    // top of that, leaving totalWithdrawn too LOW by that amount, permanently.
    const result = await withLock('bal:' + userId, async () => {
      const uSnap = await db.collection('users').doc(userId).get();
      if (!uSnap.exists) return { notFound: true };
      const { deposited, earned, invested, withdrawn } = await computeUserRealTotals(userId);
      await db.collection('users').doc(userId).update({ totalDeposited: deposited, totalEarned: earned, totalWithdrawn: withdrawn, totalInvested: invested });
      return { notFound: false, deposited, earned, withdrawn, invested };
    });
    if (result.notFound) return res.status(404).json({ status: 'error', message: 'User not found' });
    const { deposited, earned, withdrawn, invested } = result;
    logAdminAction(req, 'user_ledger_repaired', { userId, deposited, earned, withdrawn, invested });
    res.json({ status: 'success', totals: { totalDeposited: deposited, totalEarned: earned, totalWithdrawn: withdrawn, totalInvested: invested } });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
// Owner-only wallet-balance repair for exactly ONE direction: the real ledger
// total is HIGHER than what's stored (a genuine under-credit somewhere --
// money the platform's own transaction records say arrived, that never
// actually landed in the member's spendable balance). /admin/integrity has
// always DETECTED this (the walletBalance check) but deliberately never
// auto-fixed it -- Credit/Debit move both the wallet AND the ledger together
// by design, so neither tool can close a gap BETWEEN them, and blindly
// reducing a wallet toward a lower ledger figure risks taking away money a
// member already relied on/withdrew against. This tool closes exactly the
// safe half of that gap: topping a wallet UP to match a ledger that says it
// should already be higher. The other direction (stored > real) still
// refuses and asks for a human to diagnose by hand, unchanged.
app.post('/admin/user/repair-wallet', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const userId = String(req.body.userId || '');
  if (!userId) return res.status(400).json({ status: 'error', message: 'userId required' });
  try {
    const result = await withLock('bal:' + userId, async () => {
      const uRef = db.collection('users').doc(userId);
      const uSnap = await uRef.get();
      if (!uSnap.exists) return { ok: false, message: 'User not found' };
      const stored = finiteMoney(uSnap.data().walletBalance);
      // Fresh, full-ledger sum for just this user -- the exact same formula
      // /admin/integrity itself uses for walletBalance (every transaction
      // type; deposits/earnings positive, investments/withdrawals/debits
      // negative, since that's how each is actually written) -- re-read
      // INSIDE this lock so it can never disagree with a credit/debit/
      // refund landing concurrently, same "fresh recheck inside the lock"
      // pattern every other money-repair tool in this file already uses.
      const txSnap = await db.collection('transactions').where('userId', '==', userId).limit(200000).get();
      let real = 0;
      txSnap.forEach(d => { real += Number(d.data().amount) || 0; });
      const diff = Math.round(real) - Math.round(stored);
      if (diff === 0) return { ok: true, message: 'Already correct -- nothing to repair.', diff: 0 };
      if (diff < 0) {
        return { ok: false, message: `The real ledger total (${fmtUGX(Math.round(real))}) is LOWER than the stored wallet balance (${fmtUGX(stored)}). This direction is never auto-repaired -- diagnose by hand (a duplicate/erroneous credit somewhere is more likely than a missing debit).` };
      }
      // Deliberately does NOT write a new transactions row for this top-up --
      // the ledger ALREADY contains whatever real event(s) this diff
      // represents (that's the entire premise: real > stored means money the
      // ledger already documents never actually reached the wallet). Adding
      // a fresh row here would double-count that same money on the NEXT
      // audit, recreating a mismatch of the same size in the same direction.
      // Also deliberately does NOT touch totalDeposited/totalEarned/etc. --
      // the missing amount could be from ANY transaction type (a deposit, a
      // cashback payout, a commission), and guessing it was a deposit would
      // corrupt whichever stat it wasn't. "Recalculate totals" (existing,
      // already correct -- rebuilds each stat from the real ledger by type)
      // is the right tool for those; this one is walletBalance-only.
      await uRef.update({ walletBalance: FieldValue.increment(diff) });
      return { ok: true, message: `Wallet topped up by ${fmtUGX(diff)} to match the real ledger total. Run "Recalculate totals" too if totalDeposited/Earned/Invested were also flagged.`, diff };
    });
    if (!result.ok) return res.status(409).json({ status: 'error', message: result.message });
    if (result.diff) logAdminAction(req, 'wallet_repaired', { userId, diff: result.diff });
    res.json({ status: 'success', message: result.message });
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
    // Codex-caught real bug: this used to check-then-create the profile doc
    // here, UNLOCKED, before ever calling completeRegistrationCore -- which
    // does that exact same check-then-create itself, but correctly, INSIDE
    // its own reg:+userId lock (see its own body). A concurrent /register
    // call finishing registration in the gap between this unlocked check and
    // this unlocked .set() could have its whole write (registrationDone,
    // walletBalance, the just-paid welcome bonus) silently wiped back to
    // defaultProfileDoc() by this .set() landing after -- completeRegistrationCore
    // would then see registrationDone:false again and pay the welcome bonus
    // a second time. Fixed by just not doing this here at all: only the
    // phone lookup is still needed (for a genuinely missing doc), passed
    // through so the lock-protected check-then-create inside
    // completeRegistrationCore does the actual creation safely.
    let phone = '';
    try { const rec = await admin.auth().getUser(userId); phone = cleanPhone((rec.email || '').split('@')[0]) || ''; } catch (_) {}
    const result = await completeRegistrationCore(userId, req.body.referralCode, pin, phone);
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
    // Look up the candidate referrer BEFORE locking anything -- we need to
    // know referrerId's identity to lock it, and referral codes don't
    // change, so an unlocked read here is safe (re-verified inside the
    // lock below before anything is written).
    const preSnap = await db.collection('users').where('referralCode', '==', code).limit(1).get();
    if (preSnap.empty) return res.status(400).json({ status: 'error', message: 'That referral code does not exist.' });
    const candidateReferrerId = preSnap.docs[0].id;
    if (candidateReferrerId === userId) return res.status(400).json({ status: 'error', message: 'Cannot refer yourself.' });
    let referrerId;
    // Codex-caught real bug (round 2): this used to lock a bare, unrelated
    // 'attach-referrer' global key, which does NOT serialize against a
    // concurrent /register call for the SAME user.
    // Codex-caught real bug (round 3): locking only 'reg:'+userId still
    // left a cross-user race — e.g. attaching U to R concurrently with R
    // itself registering/being attached to a parent P could read R's
    // referredBy before P's write lands (missing R's own upline's L2/L3
    // count), or two concurrent admin calls attaching U->R and R->U could
    // both pass the cycle check before either writes, creating a genuine
    // referral cycle. Locking BOTH 'reg:'+userId AND 'reg:'+referrerId
    // (see withLock2, always sorted to avoid deadlock) closes both: any
    // other operation that touches either user's own 'reg:' key --
    // including a concurrent registration or attach-referrer call for
    // EITHER of them -- now genuinely serializes against this one.
    await withLock2('reg:' + userId, 'reg:' + candidateReferrerId, async () => {
      const uRef = db.collection('users').doc(userId);
      const uSnap = await uRef.get();
      if (!uSnap.exists) throw Object.assign(new Error('User not found'), { code: 404 });
      // Re-verify inside the lock -- the pre-lock read above could be
      // stale if the referrer account changed state while we were
      // acquiring the lock (banned in the meantime, etc).
      const refSnap = await db.collection('users').doc(candidateReferrerId).get();
      if (!refSnap.exists) throw Object.assign(new Error('That referral code does not exist.'), { code: 400 });
      referrerId = candidateReferrerId;
      if (refSnap.data().status === 'banned') throw Object.assign(new Error('That referral code is no longer active.'), { code: 400 });
      // Codex-caught real bug: this whole block writes userId's own
      // referredBy field and then reads/increments based on IT, but the only
      // lock covering it was withLock2('reg:'+userId,'reg:'+candidateReferrerId)
      // -- a DIFFERENT lock family than the one completeRegistrationCore()'s
      // own commit() uses to read a referrer's referredBy (referrer-guard:
      // +referrerId, see that function's own comment). Concretely: a member
      // U registers under referrer R at the same moment an admin attaches R
      // to a new parent P here -- registration's read of R.referredBy (to
      // credit P's L2/L3) could land in the gap before THIS route's write of
      // R.referredBy=P actually lands, since the two never shared a lock key.
      // Result: P's L2 count silently underused U's join, permanently (no
      // organic recount ever revisits it). Nesting the SAME referrer-guard:
      // +userId key registration already uses -- inside the existing
      // withLock2 scope, so this never tries to reacquire either 'reg:' key
      // it already holds -- gives the two operations genuine mutual
      // exclusion over userId's own referredBy field with zero deadlock risk
      // (a single shared lock key can't create an acquisition cycle).
      await withLock('referrer-guard:' + userId, async () => {
        const existing = uSnap.data().referredBy;
        // Codex-caught real bug (round 2): rejecting outright on any existing
        // referredBy made a retry after a partial failure (referredBy written,
        // then a crash/error before the L2/L3 increments or the commission
        // credit below ran) permanently unrecoverable — every retry hit this
        // same rejection. Re-attaching the SAME referrer is now treated as a
        // resumed call (skips straight to the commission step, which is
        // itself idempotent); only a DIFFERENT referrer is still rejected.
        if (existing && existing !== referrerId) throw Object.assign(new Error('This account already has a different referrer.'), { code: 400 });
        if (existing === referrerId) return; // already attached — resume below, don't re-increment counts
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
        // Codex-caught real bug: this used to only ever increment the direct
        // referrer's teamL1Count — never L2/L3 further up the chain, unlike
        // every other place a referral relationship is created
        // (completeRegistrationCore's own commit(), same L1->L2->L3 walk).
        // KNOWN, ACCEPTED LIMITATION (same class documented elsewhere in this
        // file, e.g. settleInvestmentIfDue/creditReferralCommission's own
        // crash-window notes): a crash between the referredBy write above and
        // these increments leaves them permanently unapplied — a resumed call
        // sees existing===referrerId and skips straight past this block. A
        // real fix needs a durable outbox/counts-recompute mechanism, a
        // bigger lift than this pass; not attempted, same tradeoff this
        // codebase already accepts for registration's own identical shape.
        await db.collection('users').doc(referrerId).update({ teamL1Count: FieldValue.increment(1) });
        const l1Snap = await db.collection('users').doc(referrerId).get();
        const l2Id = l1Snap.exists ? l1Snap.data().referredBy : null;
        if (l2Id && l2Id !== referrerId) {
          await db.collection('users').doc(l2Id).update({ teamL2Count: FieldValue.increment(1) });
          const l2Snap = await db.collection('users').doc(l2Id).get();
          const l3Id = l2Snap.exists ? l2Snap.data().referredBy : null;
          if (l3Id && l3Id !== referrerId && l3Id !== l2Id) await db.collection('users').doc(l3Id).update({ teamL3Count: FieldValue.increment(1) });
        }
      });
    });
    // Codex-caught real bug: the admin UI's own copy ("if this member
    // already made their first purchase, commission on it is paid now")
    // was never actually true -- nothing here ever called
    // creditReferralCommission. Pay it now if a qualifying first
    // investment exists, same idempotent function every other commission
    // path in this file already uses.
    // Codex-caught real bug (round 3): this used to set commissionTriggered
    // true just because a qualifying investment EXISTED, even when
    // creditReferralCommission() paid nothing new (already paid, buyer/
    // level ineligible, etc) -- a resumed call after the levels were
    // already credited would still tell the owner "commission credited."
    // Uses the function's own real return value now.
    let commissionTriggered = false;
    const invSnap = await db.collection('investments').where('userId', '==', userId).where('isFirstInvestment', '==', true).limit(1).get();
    if (!invSnap.empty) {
      const inv = invSnap.docs[0];
      commissionTriggered = await creditReferralCommission(inv.id, userId, inv.data().amount);
    }
    logAdminAction(req, 'referrer_attached', { userId, referralCode: code, referrerId, commissionTriggered });
    res.json({ status: 'success', commissionTriggered });
  } catch (e) { res.status(e.code || 500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/user/reconcile-checkin', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const userId = String(req.body.userId || '');
  if (!userId) return res.status(400).json({ status: 'error', message: 'userId required' });
  try {
    // Codex-caught real bug: this recomputed lastCheckinAt purely from the
    // transaction ledger and wrote it with a bare .update(), completely
    // unguarded by the checkin:<uid> lock /checkin itself holds. /checkin
    // sets lastCheckinAt=now BEFORE writing this check-in's own ledger row
    // (a deliberate claim-before-credit ordering so a crash there can only
    // under-count, never double-pay) -- if this reconcile tool runs in that
    // exact gap, it would see "no ledger row for this check-in yet" and
    // overwrite lastCheckinAt back to the previous one, erasing the claim
    // marker the user's own request just set. The member could then call
    // /checkin again inside the still-active cooldown and get credited a
    // second time. Wrapped in the same lock so the two can never interleave.
    let result = null;
    await withLock('checkin:' + userId, async () => {
      const uSnap = await db.collection('users').doc(userId).get();
      if (!uSnap.exists) { result = { code: 404, body: { status: 'error', message: 'User not found' } }; return; }
      const before = { checkinStreak: uSnap.data().checkinStreak || 0 };
      // Same limit bump as /checkin's own copy of this query -- see its comment.
      const ledgerSnap = await db.collection('transactions')
        .where('userId', '==', userId).where('type', '==', 'checkin').orderBy('createdAt', 'desc').limit(5000).get();
      const stamps = ledgerSnap.docs.map(d => tsMillis(d.data().createdAt)).filter(Boolean);
      const real = computeCheckinStreak(stamps);
      const after = { checkinStreak: real.streak };
      await db.collection('users').doc(userId).update({ checkinStreak: real.streak, lastCheckinAt: real.lastCheckinAt });
      logAdminAction(req, 'checkin_reconciled', { userId, streak: real.streak });
      result = { code: 200, body: { status: 'success', before, after, changed: before.checkinStreak !== after.checkinStreak, lastCheckinAt: real.lastCheckinAt } };
    });
    res.status(result.code).json(result.body);
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
// Recomputes teamL1/L2/L3 counts for the WHOLE referral tree hanging off one
// account — used after a delete reparents a downline, since a multi-level
// chain's counts can't be fixed with simple increments/decrements.
// subagent-audit-caught HIGH bug (Codex Finding #6): the old walk() only
// ever wrote a count for a parentId that showed up as a KEY in byParent at
// its own level -- rootId's own L1/L2/L3 counts are structurally never
// reachable that way (byParent's keys at level N are rootId's OWN
// referrer-of-referrer chain members, not rootId itself), and a level with
// zero matching users produces zero loop iterations, so a stale nonzero
// count on rootId was never corrected back to 0 either. Concretely: delete
// D (whose child G gets reparented to P), and P's own teamL2/L3 counts
// could sit stale forever since nothing in the old walk ever targeted P's
// own doc. Only call site is /admin/user/delete, always with a single
// rootId -- rewritten to compute and write exactly rootId's own 3 counts
// explicitly (including a genuine 0), one atomic update to rootId's own
// document.
async function recomputeTeamCounts(rootId) {
  let ids = [rootId];
  const counts = [0, 0, 0]; // L1, L2, L3
  for (let level = 0; level < 3; level++) {
    if (!ids.length) break;
    const snap = await db.collection('users').where('referredBy', 'in', ids).get();
    counts[level] = snap.size;
    ids = snap.docs.map(d => d.id);
  }
  await db.collection('users').doc(rootId).update({
    teamL1Count: counts[0], teamL2Count: counts[1], teamL3Count: counts[2],
  }).catch(() => {});
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
    // Codex-caught real bug: this used to delete every pendingDeposits row
    // with status != 'matched', which also swept up 'initiating'/'pending'
    // deposits that are genuinely still in flight at MarzPay -- not
    // resolved yet, not a dead end. If MarzPay later confirmed the
    // collection (webhook, or the client's own status poll) after this ran,
    // the lookup by deposit id would find nothing (row deleted), so
    // creditDeposit() could never run -- and even if it somehow could,
    // there'd be no user doc left to credit into. Real collected money,
    // gone with no trace. Refuse the deletion outright while any such
    // deposit exists, same "refuse rather than silently corrupt" posture
    // this codebase already uses for concurrent-action guards elsewhere --
    // it resolves to 'matched' or 'failed' on its own within moments via
    // the existing webhook/reconciler, so this is a short, safe wait, not a
    // permanent block.
    const inFlightDepSnap = await db.collection('pendingDeposits').where('userId', '==', userId).where('status', 'in', ['initiating', 'pending']).limit(1).get();
    if (!inFlightDepSnap.empty) return res.status(409).json({ status: 'error', message: 'This account has a deposit still being confirmed with the payment provider. Wait a moment for it to settle, then try deleting again.' });
    // Reparent this account's own direct referrals up to ITS referrer, so a
    // deleted account never leaves a permanently orphaned downline.
    //
    // Subagent-audit-caught real bug: reparenting and the actual user-doc
    // delete used to be two SEPARATE steps -- reparent inside this
    // 'referrer-guard:'+userId lock, then several more unlocked round trips
    // (the bank/promo/security/deposit cleanup below) before finally
    // deleting the doc. completeRegistrationCore()'s own commit() acquires
    // this EXACT SAME lock key ('referrer-guard:'+referrerId) when resolving
    // a NEW registration's referrer -- but only re-checks whether that
    // referrer still exists AT COMMIT TIME. With the lock released early
    // here, a registration using this account's still-live referral code
    // could look the code up (unlocked, before this route even starts),
    // acquire 'referrer-guard:'+userId in the gap between reparent and
    // delete, see the referrer doc still exists and isn't banned, and
    // permanently attach the new member to it -- moments before this route
    // deletes that same document. The new member's referredBy then points
    // at nothing forever (never swept by the reparent step above, which
    // already ran before this new member existed), and every future
    // purchase they make pays zero commission to anyone, including the
    // legitimate upline above the deleted account. Fixed by holding the
    // SAME lock across BOTH the reparent query and the actual doc delete,
    // so the two operations can never interleave: either a concurrent
    // registration's commit() runs entirely first (attaches the new member,
    // then THIS reparent query -- which runs fresh, after that commit --
    // correctly sweeps the new member up too), or entirely after (its own
    // refCheck sees the now-deleted doc and correctly declines to attach).
    const parentId = uSnap.data().referredBy || null;
    await withLock('referrer-guard:' + userId, async () => {
      const childSnap = await db.collection('users').where('referredBy', '==', userId).get();
      await Promise.all(childSnap.docs.map(d => d.ref.update({ referredBy: parentId })));
      await db.collection('users').doc(userId).delete();
    });
    // Deletes the login + this user's non-financial personal data. Deliberately
    // does NOT touch investments/transactions/withdrawals -- those are the
    // financial ledger (audit trail, referral-commission source data for
    // OTHER users' records, admin financial reporting) and stay intact,
    // orphaned from any login, exactly like any real fintech's "close
    // account, keep the books" behavior. The admin UI's confirm prompt says
    // this explicitly now -- it used to claim "ALL data: deposits,
    // withdrawals, plans, transactions" would go, which was never true.
    // Only 'failed' pendingDeposits are purged here -- a real terminal
    // state, safe to remove (see the in-flight guard above for why
    // 'initiating'/'pending' can never reach this point).
    const [bankSnap, promoSnap, secSnap, depSnap] = await Promise.all([
      db.collection('bankAccounts').where('userId', '==', userId).get(),
      db.collection('promoRedemptions').where('userId', '==', userId).get(),
      db.collection('securityEvents').where('userId', '==', userId).get(),
      db.collection('pendingDeposits').where('userId', '==', userId).where('status', '==', 'failed').get(),
    ]);
    await Promise.all([
      ...bankSnap.docs.map(d => d.ref.delete()),
      ...promoSnap.docs.map(d => d.ref.delete()),
      ...secSnap.docs.map(d => d.ref.delete()),
      ...depSnap.docs.map(d => d.ref.delete()),
    ]);
    await db.collection('users').doc(userId).delete();
    try { await admin.auth().deleteUser(userId); } catch (_) {}
    // Codex-caught real bug: recomputeTeamCounts(parentId) alone only fixes
    // parentId's OWN L1/L2/L3 -- but reparenting the deleted user's children
    // up to parentId also changes what sits at levels 2/3 BELOW parentId's
    // own ancestors. Concretely: chain A->P->D->G, delete D (G reparents to
    // P) -- P's own counts get correctly rebuilt, but A's teamL3Count was
    // counting D's children (G) and never gets touched, staying stale
    // forever (recomputeTeamCounts is the only place this ever gets fixed,
    // and it was never called for A). A change at parentId's own children/
    // grandchildren can affect any ancestor whose OWN L2/L3 window reaches
    // that far -- that's parentId itself, parentId's referrer, and that
    // referrer's referrer (3 total: 0/1/2 hops above parentId), never
    // further given the 3-level cap. Each recomputeTeamCounts() call is
    // already a fully correct, self-contained fresh BFS from its own root,
    // so recomputing multiple roots here is simply repeating a
    // known-correct operation, not new logic.
    if (parentId) {
      const ancestorTargets = [parentId];
      let cursor = parentId;
      for (let hop = 0; hop < 2 && cursor; hop++) {
        const cSnap = await db.collection('users').doc(cursor).get();
        cursor = cSnap.exists ? cSnap.data().referredBy : null;
        if (cursor) ancestorTargets.push(cursor);
      }
      for (const t of ancestorTargets) await recomputeTeamCounts(t).catch(e => console.warn('recomputeTeamCounts warning:', e.message));
    }
    logAdminAction(req, 'user_deleted', { userId, reparentedTo: parentId });
    res.json({ status: 'success' });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
  finally { _userBeingDeleted.delete(userId); }
});
const _adminCreditDebounce = new Map();
const _adminDebitDebounce = new Map();
app.post('/admin/deposit', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const { userId, amount, note } = req.body;
  const amt = Math.round(parseFloat(amount || 0));
  if (!userId || !Number.isFinite(amt) || amt <= 0 || amt > MAX_MONEY_AMOUNT)
    return res.status(400).json({ status: 'error', message: `userId and a valid amount (1 - ${fmtUGX(MAX_MONEY_AMOUNT)}) required` });
  const lastCredit = _adminCreditDebounce.get(userId) || 0;
  if (Date.now() - lastCredit < 10000) return res.status(429).json({ status: 'error', message: 'This user was just credited seconds ago. Wait a moment before crediting again.' });
  _adminCreditDebounce.set(userId, Date.now());
  try {
    const { date, time } = nowStr();
    // Locked on bal:<userId> -- this was the one money-crediting path in the
    // whole codebase with no lock at all, meaning a concurrent repair-ledger/
    // recountAllTotals absolute-value rewrite (both bal:-locked) could race
    // this increment and silently drop it. Matches /admin/debit's own locking.
    await withLock('bal:' + userId, () => db.runTransaction(async t => {
      const uRef = db.collection('users').doc(userId);
      const uSnap = await t.get(uRef);
      if (!uSnap.exists) throw new Error('User not found');
      t.update(uRef, { walletBalance: FieldValue.increment(amt), totalDeposited: FieldValue.increment(amt) });
      t.set(db.collection('transactions').doc(), { userId, type: 'admin_credit', description: note || 'Snow credit', amount: amt, status: 'success', date, time, createdAt: FieldValue.serverTimestamp() });
    }));
    logAdminAction(req, 'manual_credit', { userId, amount: amt, note });
    res.json({ status: 'success', message: `Credited ${fmtUGX(amt)}` });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/debit', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
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
      if (amt > bal) throw new Error(`Cannot debit ${fmtUGX(amt)}, this wallet only holds ${fmtUGX(bal)}`);
      newBal = bal - amt;
      t.update(uRef, { walletBalance: FieldValue.increment(-amt) });
      t.set(db.collection('transactions').doc(), { userId, type: 'admin_debit', description: note || 'Balance adjustment', amount: -amt, status: 'success', date, time, createdAt: FieldValue.serverTimestamp() });
    }));
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
      status: isBan ? 'banned' : 'active', banReason: isBan ? (reason || 'Policy violation') : null, bannedAt: isBan ? FieldValue.serverTimestamp() : null
    });
    logAdminAction(req, isBan ? 'user_banned' : 'user_unbanned', { userId, reason });
    res.json({ status: 'success' });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
// Groups already-processed rows by calendar day (Kampala time, matching
// eatDayKey everywhere else) for the admin "Processed per day" charts.
// `rows` must already be filtered to only the processed ones.
function groupProcessedByDay(rows, timestampField, amountField = 'amount') {
  const byDay = {};
  let processedAmount = 0;
  for (const r of rows) {
    const amt = finiteMoney(r[amountField]);
    processedAmount += amt;
    const day = eatDayKey(r[timestampField] || r.createdAt);
    const row = byDay[day] || (byDay[day] = { day, count: 0, amount: 0 });
    row.count++; row.amount += amt;
  }
  const processedByDay = Object.values(byDay).sort((a, b) => a.day < b.day ? -1 : 1);
  return { processedByDay, processedAmount };
}
app.post('/admin/deposits/list', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const [snap, unresolvedSnap, usersSnap] = await Promise.all([
      db.collection('pendingDeposits').orderBy('createdAt', 'desc').limit(5000).get(),
      db.collection('pendingDeposits').where('status', 'in', ['pending', 'initiating', 'review']).limit(5000).get(),
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
    const { processedByDay, processedAmount } = groupProcessedByDay(rows.filter(r => r.status === 'matched'), 'creditedAt');
    // Subagent-audit-caught: this had a real 5000-row cap on each underlying
    // query with no truncated flag, unlike /admin/referrals/list and
    // /admin/transactions/list, which this file already fixed the same way
    // (Rounds 80/81) -- silently showing a partial "All" view/counts as if
    // complete once history genuinely exceeds the cap. Checked against
    // EITHER source query hitting its own limit, not just the merged/deduped
    // row count, since de-duplication can make the merged total look under
    // the cap even when one of the two source queries was truncated.
    const truncated = snap.docs.length >= 5000 || unresolvedSnap.docs.length >= 5000;
    res.json({ status: 'success', deposits: rows, counts, total: rows.length, processedByDay, processedAmount, truncated });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/deposit/force-credit', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const { depositId } = req.body;
  if (!depositId) return res.status(400).json({ status: 'error', message: 'depositId required' });
  try {
    const snap = await db.collection('pendingDeposits').doc(depositId).get();
    if (!snap.exists) return res.status(404).json({ status: 'error', message: 'Deposit not found' });
    if (depositFullyCredited(snap.data())) return res.json({ status: 'success', message: 'Already credited' });
    const ok = await creditDeposit(snap);
    if (!ok) return res.status(409).json({ status: 'error', message: 'Could not credit. Try again' });
    logAdminAction(req, 'deposit_force_credited', { depositId, amount: snap.data().amount });
    res.json({ status: 'success', message: `Force-credited ${fmtUGX(snap.data().amount)} to the user` });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/withdrawals/list', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const [snap, unresolvedSnap, usersSnap, sett] = await Promise.all([
      db.collection('withdrawals').orderBy('createdAt', 'desc').limit(5000).get(),
      db.collection('withdrawals').where('status', 'in', ['pending', 'sending', 'processing']).limit(5000).get(),
      db.collection('users').get(),
      getSettings(),
    ]);
    const phones = {}; const refCodes = {};
    usersSnap.forEach(u => { phones[u.id] = u.data().phone || ''; refCodes[u.id] = u.data().referralCode || ''; });
    const counts = {};
    const byId = new Map();
    snap.docs.forEach(d => byId.set(d.id, { id: d.id, ...d.data() }));
    unresolvedSnap.docs.forEach(d => { if (!byId.has(d.id)) byId.set(d.id, { id: d.id, ...d.data() }); });
    const rows = Array.from(byId.values());
    rows.forEach(w => { w.accountPhone = phones[w.userId] || ''; w.referralCode = refCodes[w.userId] || ''; counts[w.status] = (counts[w.status] || 0) + 1; });
    const { processedByDay, processedAmount } = groupProcessedByDay(rows.filter(w => w.status === 'processed'), 'processedAt', 'net');
    // The tab needs to know which real payout path is active -- it changes
    // what the approve button does/says and what it must warn the admin
    // about. Sent with the list so the tab doesn't need a second round trip
    // just to label a button. 'marzpay' | 'lipapay' | 'manual' (Round 102
    // widened this from a plain 'automatic'/'manual' 2-way string).
    // Subagent-audit-caught: same missing-truncated-flag gap as the deposits
    // list above, fixed the same way.
    const truncated = snap.docs.length >= 5000 || unresolvedSnap.docs.length >= 5000;
    res.json({ status: 'success', withdrawals: rows, counts, total: rows.length, processedByDay, processedAmount, payoutMode: withdrawProvider(sett), truncated });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/withdraw/reject', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const witId = String(req.body.withdrawalId || '');
  if (_withdrawInFlight.has(witId)) return res.status(409).json({ status: 'error', message: 'This withdrawal is being sent right now. Check the list in a moment.' });
  _withdrawInFlight.add(witId);
  try {
    const ref = db.collection('withdrawals').doc(witId);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ status: 'error', message: 'Withdrawal not found' });
    const w = snap.data();
    // Codex-caught real bug: 'sending' (a MarzPay network error mid-request
    // -- genuinely ambiguous whether the payout went out, see
    // processWithdrawalCore's own comment) was never an accepted status
    // here, and nothing else in the codebase ever resolves it either --
    // once a withdrawal landed on 'sending' it was permanently stuck, with
    // literally no code path able to move it anywhere else. This is exactly
    // the recovery action that comment describes ("leave it at 'sending'
    // for the admin to check on MarzPay's own dashboard") but the button to
    // actually do it never existed. Only use this for a 'sending' row after
    // manually confirming on MarzPay's dashboard that it was NOT actually
    // sent -- if MarzPay's dashboard shows it WAS sent, take no action here
    // (the payout already happened; rejecting would refund on top of it).
    if (w.status !== 'pending' && w.status !== 'processing' && w.status !== 'sending') return res.status(400).json({ status: 'error', message: `Cannot reject, the status is '${w.status}'` });
    const { declined, refunded } = await declineWithdrawalAndRefund(ref, w.userId, 'Rejected by admin', ['pending', 'processing', 'sending'], req.adminUser?.username || 'owner');
    if (!declined) return res.status(409).json({ status: 'error', message: 'Withdrawal status changed before this could be applied. Refresh and try again.' });
    await finalizeWithdrawalTransactionRecord(witId, 'declined', refunded);
    logAdminAction(req, 'withdrawal_rejected', { withdrawalId: witId, refunded });
    res.json({ status: 'success', message: refunded ? 'Withdrawal rejected and refunded' : 'Withdrawal rejected, refund is pending and will complete shortly' });
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
    const pendingDepCount = (await db.collection('pendingDeposits').where('status', 'in', ['pending', 'initiating', 'review']).limit(5000).get()).size;
    const pendingWitCount = (await db.collection('withdrawals').where('status', '==', 'pending').limit(5000).get()).size;
    res.json({ status: 'success', stats: { totalUsers, activeUsers, bannedUsers, walletTotal, depositAmount, withdrawAmount, investedAmount, activeInvestments, pendingDepCount, pendingWitCount } });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
// Owner: "let us put on dashboard so as it checks marzpy available
// balance." A real, live check of MarzPay's own float -- how much money
// is actually sitting in the account MarzPay pays withdrawals FROM --
// distinct from walletTotal above (members' own balances, this
// platform's liability) or any DB figure. verifyAdmin, not verifyOwner --
// same visibility level as the rest of Dashboard, which staff already see.
app.get('/admin/marzpay/balance', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  if (!MARZPAY_KEY) return res.status(400).json({ status: 'error', message: 'MarzPay is not configured on this server (no MARZPAY_KEY set).' });
  try {
    const d = await marzGetBalance();
    if (d.status !== 'success') return res.status(502).json({ status: 'error', message: marzUserMsg(d, 'Could not reach MarzPay') });
    res.json({ status: 'success', amount: d.amount, formatted: d.formatted, currency: d.currency, accountStatus: d.accountStatus });
  } catch (e) {
    console.error('MarzPay balance check failed:', e.message);
    res.status(502).json({ status: 'error', message: PROVIDER_BUSY_MSG });
  }
});
app.post('/admin/transactions/list', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    // Codex-caught real bug (2nd money-flow audit): this always hardcoded
    // 300 regardless of what the caller asked for -- the admin UI itself
    // requests {limit:400} and silently got capped down to 300 every time.
    // This list is PLATFORM-WIDE (every transaction, not one user's), so
    // 300 total rows is a genuinely small, fast-to-exhaust window on a live
    // investment platform, unlike the per-user /transactions endpoint.
    // Honor the caller's own limit (clamped to a sane range) and surface a
    // `truncated` flag so the panel can say so if the real limit is hit.
    const requested = parseInt(req.body.limit, 10);
    const TX_ADMIN_LIST_LIMIT = Number.isFinite(requested) ? Math.min(5000, Math.max(50, requested)) : 300;
    const snap = await db.collection('transactions').orderBy('createdAt', 'desc').limit(TX_ADMIN_LIST_LIMIT).get();
    const transactions = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json({ status: 'success', transactions, truncated: transactions.length >= TX_ADMIN_LIST_LIMIT });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
app.get('/admin/referrals/list', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    // Codex-caught real bug: a hard 2,000-row cap with no truncation signal
    // -- once the platform passed 2,000 linked accounts, this tab would
    // silently show an incomplete list with zero indication anything was
    // missing, exactly the kind of silent-corruption-of-an-admin-view this
    // codebase is otherwise careful to avoid (see /admin/integrity's own
    // "surface, never silently launder" design intent). Bumped the cap
    // generously (same "practically-unreachable ceiling, not real
    // pagination" tradeoff already used for /admin/products/clear's own
    // cap) and added an explicit `truncated` flag so the admin UI can at
    // least say so if this ceiling is ever actually reached.
    const REFERRALS_LIST_LIMIT = 20000;
    const snap = await db.collection('users').where('referredBy', '!=', null).limit(REFERRALS_LIST_LIMIT).get();
    // Codex-caught real bug: `referredBy` on a user doc is the referrer's
    // raw Firebase uid, not their referral CODE -- the admin UI's "Referred
    // user" table rendered the uid straight into the "Referrer's code"
    // column. Resolve each unique referrer id to their real referralCode.
    const referrerIds = [...new Set(snap.docs.map(d => d.data().referredBy).filter(Boolean))];
    const referrerSnaps = await Promise.all(referrerIds.map(id => db.collection('users').doc(id).get()));
    const codeById = {};
    referrerSnaps.forEach((s, i) => { codeById[referrerIds[i]] = s.exists ? (s.data().referralCode || '') : ''; });
    const rows = snap.docs.map(d => {
      const u = d.data();
      return {
        id: d.id, phone: u.phone || '', referrerId: u.referredBy,
        referrerCode: codeById[u.referredBy] || '', invested: finiteMoney(u.totalInvested), status: u.status || 'active',
      };
    });
    res.json({ status: 'success', referrals: rows, truncated: rows.length >= REFERRALS_LIST_LIMIT });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
// Full-depth referral chain trace -- deliberately separate from
// wholeTeamDeposits()/recomputeTeamCounts() above, which are capped at 3
// levels (Snow's commission structure only pays L1/L2/L3). Owner: "track
// all roots or chains of referral codes and referrals and all that
// chain." Walks the ENTIRE upline to the root (whoever has no referrer)
// and the ENTIRE downline tree (everyone directly or indirectly referred
// by this user, at any depth) -- an audit/support tool, not a money
// calculation, so it isn't scoped to the 3 commission levels.
app.post('/admin/user/referral-chain', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const userId = String(req.body.userId || '');
  if (!userId) return res.status(400).json({ status: 'error', message: 'userId required' });
  try {
    const startSnap = await db.collection('users').doc(userId).get();
    if (!startSnap.exists) return res.status(404).json({ status: 'error', message: 'User not found' });
    const brief = (id, d) => ({
      id, phone: d.phone || '', referralCode: d.referralCode || '',
      status: d.status || 'active', totalInvested: finiteMoney(d.totalInvested),
    });

    // Upline: walk referredBy repeatedly up to the root. Cycle-guarded --
    // attach-referrer's own cycle-check (Round 17) already prevents a real
    // cycle from being WRITTEN, but this is a read path against any
    // historical data, so it must never hang if one somehow exists rather
    // than trust that invariant blindly.
    const upline = [];
    let cursor = startSnap.data().referredBy || null;
    const seenUp = new Set([userId]);
    let cycleDetected = false;
    while (cursor && upline.length < 200) {
      if (seenUp.has(cursor)) { cycleDetected = true; break; }
      seenUp.add(cursor);
      const s = await db.collection('users').doc(cursor).get();
      if (!s.exists) break;
      upline.push(brief(s.id, s.data()));
      cursor = s.data().referredBy || null;
    }
    const root = upline.length ? upline[upline.length - 1] : brief(startSnap.id, startSnap.data());

    // Downline: full-depth BFS (same where('referredBy','in',parentIds)
    // pattern wholeTeamDeposits()/recomputeTeamCounts() already use, just
    // without their 3-level cap) -- capped only on total nodes returned and
    // a defensive max-depth so a pathological chain can't run away.
    // Codex-caught real bug: unlike the upline walk right above (which has
    // its own seenUp cycle-guard for exactly this reason), this had none --
    // a real referral cycle in the data (attach-referrer's own cycle-check,
    // Round 17, prevents one from ever being WRITTEN, but this reads
    // whatever the data actually is, corrupted or not, same reasoning the
    // upline walk's own comment already gives) would have this BFS
    // alternately rediscover the same accounts at successive levels,
    // inserting duplicates and reporting bogus per-level counts until
    // hitting the depth/node caps -- exactly mirroring the upline guard.
    const downline = [];
    let parentIds = [userId];
    let level = 0;
    const DOWNLINE_CAP = 5000;
    const seenDown = new Set([userId]);
    let downlineCycleDetected = false;
    while (parentIds.length && downline.length < DOWNLINE_CAP && level < 50) {
      level++;
      const snap = await db.collection('users').where('referredBy', 'in', parentIds).limit(DOWNLINE_CAP).get();
      const nextIds = [];
      snap.forEach(d => {
        if (seenDown.has(d.id)) { downlineCycleDetected = true; return; }
        seenDown.add(d.id);
        nextIds.push(d.id);
        if (downline.length < DOWNLINE_CAP) downline.push({ ...brief(d.id, d.data()), level, referredBy: d.data().referredBy });
      });
      parentIds = nextIds;
    }
    const downlineCountByLevel = {};
    downline.forEach(d => { downlineCountByLevel[d.level] = (downlineCountByLevel[d.level] || 0) + 1; });

    // Owner: "l want to see numbers of his team and total deposits" -- the
    // admin panel's Referrals search (Round 146) already found the right
    // member, but tapping through only ever reached the plain user-detail
    // modal's own aggregate counts, not this chain view's own real member
    // list. Same figure /admin/user/detail already labels "Team's total
    // deposits" (wholeTeamDeposits(), L1-L3 only -- deliberately the same
    // commission-scoped definition used everywhere else in this file, not
    // a new, wider "every downline level" total that would disagree with
    // it and confuse anyone comparing the two screens).
    const teamDeposits = await wholeTeamDeposits(userId);

    res.json({
      status: 'success',
      user: brief(startSnap.id, startSnap.data()),
      root, upline, cycleDetected, teamDeposits,
      downline, downlineCountByLevel, downlineTruncated: downline.length >= DOWNLINE_CAP, downlineCycleDetected,
    });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
app.get('/admin/badges', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const [pendingDep, pendingWit, unresolvedSms] = await Promise.all([
      db.collection('pendingDeposits').where('status', 'in', ['pending', 'initiating', 'review']).limit(5000).get(),
      db.collection('withdrawals').where('status', '==', 'pending').limit(5000).get(),
      unresolvedManualSmsLog(500),
    ]);
    res.json({ status: 'success', pendingDeposits: pendingDep.size, pendingWithdrawals: pendingWit.size, unmatchedSms: unresolvedSms.length });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
// Owner: "also all analytics were removed, see space8 analytics are not
// here." Traced to Round 12/14's own documented, deliberate deferral (this
// exact port, from the sibling Space8 project's richer analytics, flagged
// as a "known gap" back then rather than attempted as a scope surprise in a
// UI-reskin round) -- this round is that deferred backend feature-build.
// Ported field-for-field from Space8's own /admin/analytics, mapped onto
// Snow's real schema (verified against every field name used below: users.
// {walletBalance,totalDeposited,totalInvested,teamCommission,teamL1Count,
// referredBy,createdAt}, pendingDeposits.{status:'matched',amount,
// senderPhone,createdAt}, withdrawals.{status:'processed',amount,net,phone,
// holder,processedBy,processedAt,declinedBy,declinedAt}, investments.
// {status:'active',paidOut,dailyPayout,expectedReturn} -- all real, all
// already written by this file's own code). staffApprovals (who actually
// approved/declined each payout) only became meaningful once
// processedBy/declinedBy started being written to real staff usernames
// instead of a hardcoded 'owner' string (see the withdrawal-attribution fix
// immediately before this round).
function bandOf(h) {
  if (h >= 5 && h < 12) return 'morning';
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
    const bands = { morning: { dep: 0, wit: 0 }, afternoon: { dep: 0, wit: 0 }, evening: { dep: 0, wit: 0 }, night: { dep: 0, wit: 0 } };
    const dayMap = {};
    const ensureDay = k => (dayMap[k] = dayMap[k] || { day: k, dep: 0, wit: 0, users: 0 });

    let depAmount = 0, depCount = 0;
    depSnap.forEach(d => {
      const dep = d.data();
      if (dep.status !== 'matched') return;
      const ms = tsMillis(dep.createdAt);
      if (ms < sinceMs) return;
      const a = finiteMoney(dep.amount);
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
      bigWits.push({ phone: w.phone || w.holder || '', amount: finiteMoney(w.net) || finiteMoney(w.amount), when: ms });
      if (ms < sinceMs) return;
      const a = finiteMoney(w.net) || finiteMoney(w.amount);
      witAmount += a; witCount++;
      const { hour, day } = eatParts(w.createdAt);
      byHour[hour].witAmt += a; byHour[hour].witCnt++;
      bands[bandOf(hour)].wit += a;
      ensureDay(day).wit += a;
    });
    bigWits.sort((a, b) => b.amount - a.amount);

    // Who's actually approving/declining payouts, and how fast -- separate
    // from the deposits/withdrawals volume above because it's about STAFF
    // activity, not member activity.
    const staffMap = {};
    const staffTimeline = [];
    const touchStaff = actor => (staffMap[actor] = staffMap[actor] || { actor, approvals: 0, declines: 0, amountApproved: 0, amountDeclined: 0, firstAt: null, lastAt: null });
    witSnap.forEach(d => {
      const w = d.data();
      // processedBy/declinedBy mark an ADMIN ACTION happened, independent of
      // the withdrawal's current status -- a fresh approval lands at
      // 'processing' (still awaiting confirmation) and only becomes
      // 'processed' later, so gating on status==='processed' here would
      // undercount every recent approval. Deliberately not mutually
      // exclusive: a withdrawal can be approved by one admin, fail, and get
      // declined/refunded by another -- both actions credit whoever
      // actually did them.
      if (w.processedBy) {
        const ms = tsMillis(w.processedAt || w.createdAt);
        if (ms >= sinceMs) {
          const s = touchStaff(w.processedBy);
          s.approvals++; s.amountApproved += finiteMoney(w.amount);
          s.firstAt = s.firstAt === null ? ms : Math.min(s.firstAt, ms);
          s.lastAt = s.lastAt === null ? ms : Math.max(s.lastAt, ms);
          staffTimeline.push({ actor: w.processedBy, action: 'approved', phone: w.phone || w.holder || '', amount: finiteMoney(w.amount), at: ms });
        }
      }
      if (w.declinedBy) {
        const ms = tsMillis(w.declinedAt || w.createdAt);
        if (ms >= sinceMs) {
          const s = touchStaff(w.declinedBy);
          s.declines++; s.amountDeclined += finiteMoney(w.amount);
          s.firstAt = s.firstAt === null ? ms : Math.min(s.firstAt, ms);
          s.lastAt = s.lastAt === null ? ms : Math.max(s.lastAt, ms);
          staffTimeline.push({ actor: w.declinedBy, action: 'declined', phone: w.phone || w.holder || '', amount: finiteMoney(w.amount), at: ms });
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
      investedAmount += finiteMoney(u.totalInvested);
      commissionsPaid += finiteMoney(u.teamCommission);
      if ((u.teamL1Count || 0) > 0 || (u.teamCommission || 0) > 0)
        referrers.push({ phone: u.phone || '', team: u.teamL1Count || 0, earned: finiteMoney(u.teamCommission) });
      if ((u.totalDeposited || 0) > 0) depositors.push({ phone: u.phone || '', amount: finiteMoney(u.totalDeposited) });
    });
    // Task Center rewards paid so far -- /team/milestone/claim already writes
    // an immutable `team_reward` transaction with the exact amount paid at
    // claim time, so summing those directly is correct even after the
    // owner edits the reward ladder's rates later (unlike re-deriving it
    // from the CURRENT ladder, which would silently misstate history).
    let teamRewardsPaid = 0;
    try {
      const rewardTxSnap = await db.collection('transactions').where('type', '==', 'team_reward').limit(200000).get();
      rewardTxSnap.forEach(d => { teamRewardsPaid += finiteMoney(d.data().amount); });
    } catch (e) { console.error('teamRewardsPaid query error:', e.message); }
    referrers.sort((a, b) => (b.team - a.team) || (b.earned - a.earned));
    depositors.sort((a, b) => b.amount - a.amount);

    const byDay = [];
    for (let i = days - 1; i >= 0; i--) {
      const k = new Date(Date.now() + 3 * 3600000 - i * 86400000).toISOString().slice(0, 10);
      byDay.push(dayMap[k] || { day: k, dep: 0, wit: 0, users: 0 });
    }
    const peakDepositHour = byHour.reduce((p, c) => c.depCnt > p.depCnt ? c : p, byHour[0]).h;
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
      const paidOut = finiteMoney(inv.paidOut), dailyPayout = finiteMoney(inv.dailyPayout), expected = finiteMoney(inv.expectedReturn);
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
// at all, same "never disclose it" treatment as the Integrity audit and other
// owner-only tools. Surfaces repeat offenders across four signals: accounts
// with many FAILED deposits (reads the same pendingDeposits records
// /admin/integrity already trusts, no new logging needed), accounts
// repeatedly trying to withdraw more than their balance, accounts repeatedly
// tapping check-in after already claiming today, and accounts trying gift/
// promo codes that don't exist (guessing) -- the last three are logged to
// securityEvents at the exact point each one is rejected (see
// logSecurityEvent call sites above). Only ever a READ over events that
// already happened; never blocks or bans anyone by itself.
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
// Cross-checks every one of a user's own stored running totals --
// walletBalance, totalDeposited, totalEarned, totalInvested -- against what
// the real transaction/investment records actually add up to, and flags any
// mismatch (owner: "abnormal counts... should be bugged out... everything
// should be connected perfectly" — previously this only checked
// walletBalance, so a drifted totalDeposited/totalEarned/totalInvested
// (however it happened -- a missed increment, a stale write, a manual DB
// edit) could sit there indefinitely with nothing ever surfacing it). This
// tool's whole job is to SURFACE corruption, not hide or guess-fix it --
// each mismatch names the field, what's stored, and what the ledger says it
// should be, so a huge, out-of-place number like "1,000,000,500" shows up
// as an exact, explained diff instead of just looking odd on a stat card.
// Also flags 3 qualitative problems that a pure number-mismatch check can't
// catch by itself, ported from the sibling Space8 project's own integrity
// audit (already battle-tested there against this exact class of bug):
// duplicate_credit (the same deposit `ref` credited more than once -- the
// literal double-credit race CLAUDE.md's money-safety invariants exist to
// prevent, so a regression here is exactly what this tool should catch),
// negative_balance (should be structurally impossible if every debit path
// checks funds first -- a real one means a debit path skipped that check),
// and registration_incomplete (a profile that exists but never finished
// /register, invisible to any referrer's team, given an hour's grace so
// someone mid-signup right now isn't flagged).
app.get('/admin/integrity', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const [usersSnap, txSnap, { totals: realTotals, invested: realInvested, withdrawn: realWithdrawn }] = await Promise.all([
      db.collection('users').limit(10000).get(),
      db.collection('transactions').limit(200000).get(),
      computeRealTotals(),
    ]);
    // walletBalance is checked against the FULL ledger (every transaction
    // type, deposits/earnings positive, investments/withdrawals/debits
    // negative -- see how each is written) since it's the live net balance,
    // not a lifetime-income-only figure.
    const ledgerByUser = {};
    const refSeen = {}; // `${userId}::${ref}` -> count, deposits only (the only type with a real, reusable ref field)
    txSnap.forEach(d => {
      const t = d.data();
      if (!t.userId) return;
      ledgerByUser[t.userId] = (ledgerByUser[t.userId] || 0) + (Number(t.amount) || 0);
      if (t.ref && t.type === 'deposit') {
        const key = t.userId + '::' + t.ref;
        refSeen[key] = (refSeen[key] || 0) + 1;
      }
    });
    const mismatches = [];
    const alerts = [];
    Object.entries(refSeen).forEach(([key, times]) => {
      if (times > 1) {
        const [userId, ref] = key.split('::');
        alerts.push({ kind: 'duplicate_credit', userId, ref, times });
      }
    });
    const now = Date.now();
    usersSnap.forEach(d => {
      const u = d.data();
      const phone = u.phone || '';
      const row = realTotals[d.id] || { deposited: 0, earned: 0 };
      const bal = finiteMoney(u.walletBalance);
      const checks = [
        { field: 'walletBalance', stored: bal, real: ledgerByUser[d.id] || 0 },
        { field: 'totalDeposited', stored: finiteMoney(u.totalDeposited), real: row.deposited },
        { field: 'totalEarned', stored: finiteMoney(u.totalEarned), real: row.earned },
        { field: 'totalInvested', stored: finiteMoney(u.totalInvested), real: realInvested[d.id] || 0 },
        // subagent-audit-caught: totalWithdrawn had zero coverage here before
        // -- a drift in it (e.g. the exact processWithdrawalCore locking gap
        // Round 59 fixed) would sit silently forever, since the ONLY tool
        // that ever recomputed it was the single-user repair-ledger, which
        // nobody has a reason to run unless the audit itself flags a problem.
        { field: 'totalWithdrawn', stored: finiteMoney(u.totalWithdrawn), real: realWithdrawn[d.id] || 0 },
      ];
      for (const c of checks) {
        if (Math.abs(c.stored - c.real) > 1) mismatches.push({ userId: d.id, phone, field: c.field, stored: c.stored, real: c.real, diff: c.stored - c.real });
      }
      if (bal < 0) alerts.push({ kind: 'negative_balance', userId: d.id, phone, balance: bal });
      if (!u.registrationDone && (now - tsMillis(u.createdAt)) / 3600000 > 1)
        alerts.push({ kind: 'registration_incomplete', userId: d.id, phone, hours: Math.round((now - tsMillis(u.createdAt)) / 3600000) });
    });
    res.json({ status: 'success', checked: usersSnap.size, mismatches, alerts });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
// Single source of truth for what totalDeposited/totalEarned/totalInvested
// SHOULD be, derived from the real transaction/investment records rather
// than the incremental counters on the user doc. Shared by recountAllTotals
// (which writes the fix) and /admin/integrity (which only reports the gap)
// so the two can never quietly disagree about what "correct" means.
// Single-user version of computeRealTotals() below -- a per-user filtered
// query rather than a platform-wide scan, so it stays fresh even when
// called deep inside a loop over many users (see recountAllTotals()'s own
// use of this). MUST stay in lockstep with computeRealTotals()'s formulas
// (same earning-type list, same admin_credit inclusion, same
// totalWithdrawn-from-net-not-gross logic) or the two tools would
// contradict each other about what "correct" means.
// Every transaction type that counts toward totalEarned -- MUST stay in
// lockstep across every place that decides what "earned" means
// (computeUserRealTotals, computeRealTotals, and /admin/user/detail's own
// earnedBreakdown below), or the admin panel could show a per-source
// breakdown that doesn't actually add up to the "Cashback earned" total
// sitting right above it. Named for what it actually is (every earning
// source, not just investment cashback) since the admin UI's "Cashback
// earned" label is a real misnomer -- this field is cashback PLUS
// referral commission PLUS checkin/gift-code/Task-Center/Mission-Center
// bonuses, all folded into one number.
const EARNING_TX_TYPES = ['cashback', 'commission', 'team_reward', 'promocode', 'checkin', 'mission_salary', 'mission_deposit_reward'];
async function computeUserRealTotals(userId) {
  const [txSnap, invSnap, witSnap] = await Promise.all([
    db.collection('transactions').where('userId', '==', userId).limit(50000).get(),
    db.collection('investments').where('userId', '==', userId).get(),
    db.collection('withdrawals').where('userId', '==', userId).where('status', 'in', ['processing', 'processed']).limit(5000).get(),
  ]);
  let deposited = 0, earned = 0;
  txSnap.forEach(d => {
    const t = d.data();
    if (t.type === 'deposit' || t.type === 'admin_credit') deposited += finiteMoney(t.amount);
    else if (EARNING_TX_TYPES.includes(t.type)) earned += finiteMoney(t.amount);
  });
  let invested = 0;
  invSnap.forEach(d => { invested += finiteMoney(d.data().amount); });
  let withdrawn = 0;
  witSnap.forEach(d => { withdrawn += finiteMoney(d.data().net); });
  return { deposited, earned, invested, withdrawn };
}
async function computeRealTotals() {
  const [txSnap, invSnap, witSnap] = await Promise.all([
    db.collection('transactions').limit(200000).get(),
    db.collection('investments').limit(50000).get(),
    // subagent-audit-caught: totalWithdrawn was the one lifetime stat this
    // shared "what's actually correct" function never computed at all --
    // /admin/integrity never checked it and "Recalculate totals" never
    // repaired it, so a drift here (exactly the kind Round 59's
    // processWithdrawalCore locking fix was closing off a NEW source of)
    // had zero audit coverage; only the single-user /admin/user/repair-ledger
    // tool had its own, separately-written copy of this same formula.
    // Scoped to processing/processed exactly like that tool, for the same
    // reason its own comment gives: live crediting increments
    // totalWithdrawn the moment a payout is marked 'processing', not only
    // once it reaches 'processed'.
    db.collection('withdrawals').where('status', 'in', ['processing', 'processed']).limit(200000).get(),
  ]);
  const totals = {};
  const checkinTimestamps = {};
  txSnap.forEach(d => {
    const t = d.data();
    if (!t.userId) return;
    const row = totals[t.userId] || (totals[t.userId] = { deposited: 0, earned: 0 });
    if (t.type === 'deposit' || t.type === 'admin_credit') row.deposited += finiteMoney(t.amount);
    // Every income source that credits totalEarned live must be summed
    // here too, or a "Recalculate totals" run silently wipes it back to
    // zero — cashback/commission/team_reward (Task Center)/promocode
    // (gift codes)/checkin.
    if (EARNING_TX_TYPES.includes(t.type)) row.earned += finiteMoney(t.amount);
    if (t.type === 'checkin') (checkinTimestamps[t.userId] || (checkinTimestamps[t.userId] = new Set())).add(tsMillis(t.createdAt));
  });
  const invested = {};
  invSnap.forEach(d => {
    const inv = d.data();
    if (!inv.userId) return;
    invested[inv.userId] = (invested[inv.userId] || 0) + finiteMoney(inv.amount);
  });
  const withdrawn = {};
  witSnap.forEach(d => {
    const w = d.data();
    if (!w.userId) return;
    withdrawn[w.userId] = (withdrawn[w.userId] || 0) + finiteMoney(w.net);
  });
  return { totals, invested, checkinTimestamps, withdrawn };
}
// Rebuilds totalDeposited/totalEarned/totalInvested and each user's
// check-in streak from the real ledger/investments/check-in history --
// the source of truth -- rather than trusting drifted incremental counters.
// The admin UI's "Recalculate totals" button has always claimed all four;
// this used to only actually rebuild the first two (Codex-caught, round 19).
async function recountAllTotals() {
  return withLock('totals-recount', async () => {
    const { totals, invested, checkinTimestamps, withdrawn } = await computeRealTotals();
    let updated = 0, investedFixed = 0, streaksFixed = 0;
    const usersSnap = await db.collection('users').limit(10000).get();
    for (const doc of usersSnap.docs) {
      const row = totals[doc.id] || { deposited: 0, earned: 0 };
      const realInvestedSnapshot = invested[doc.id] || 0;
      const realWithdrawnSnapshot = withdrawn[doc.id] || 0;
      const snapshotStreak = computeCheckinStreak(checkinTimestamps[doc.id] || new Set());
      const u = doc.data();

      // subagent-audit-caught HIGH bug (Finding #4): this used to write the
      // platform-wide computeRealTotals() SNAPSHOT's deposited/earned/
      // invested/withdrawn figures straight into the user doc, guarded only
      // by the bal:<userId> lock around the write itself -- never
      // re-verified against what actually landed between that upfront
      // snapshot and this specific user's turn in a loop spanning up to
      // 10,000 users. A live cashback/commission/deposit/withdrawal/
      // mission/gift-code credit in that window got silently baked over by
      // the stale value. Mirrors the exact fix already applied to
      // checkinStreak/lastCheckinAt below (Round 35): use the snapshot only
      // as a cheap pre-filter for whether this user might need touching,
      // then re-derive the real figures fresh via computeUserRealTotals()
      // and re-read the doc fresh, both INSIDE the bal:<userId> lock,
      // immediately before writing.
      const moneyLooksStale = finiteMoney(u.totalDeposited) !== row.deposited ||
        finiteMoney(u.totalEarned) !== row.earned ||
        finiteMoney(u.totalInvested) !== realInvestedSnapshot ||
        finiteMoney(u.totalWithdrawn) !== realWithdrawnSnapshot;
      let moneyWrote = false, investedChanged = false;
      if (moneyLooksStale) {
        // Per-user bal:<userId>, not the outer 'totals-recount' lock this
        // whole function holds -- that lock only serializes recount runs
        // against each other, not against a live credit landing on this one
        // user, which is exactly the race this fresh re-check closes.
        // Scoped per-user, not held for the whole loop, so one recount run
        // doesn't serialize every user's money ops platform-wide for its
        // full duration.
        await withLock('bal:' + doc.id, async () => {
          const fresh = await computeUserRealTotals(doc.id);
          const freshDoc = await doc.ref.get();
          const fd = freshDoc.exists ? freshDoc.data() : {};
          const moneyUpdate = {};
          if (finiteMoney(fd.totalDeposited) !== fresh.deposited) moneyUpdate.totalDeposited = fresh.deposited;
          if (finiteMoney(fd.totalEarned) !== fresh.earned) moneyUpdate.totalEarned = fresh.earned;
          if (finiteMoney(fd.totalInvested) !== fresh.invested) { moneyUpdate.totalInvested = fresh.invested; investedChanged = true; }
          if (finiteMoney(fd.totalWithdrawn) !== fresh.withdrawn) moneyUpdate.totalWithdrawn = fresh.withdrawn;
          if (Object.keys(moneyUpdate).length) {
            await doc.ref.update(moneyUpdate);
            moneyWrote = true;
          }
        });
      }

      // subagent-audit-caught HIGH bug: this used to write the SNAPSHOT-
      // computed checkinStreak/lastCheckinAt straight into the user doc,
      // guarded only by the bal:<userId> lock -- not checkin:<userId>, the
      // lock /checkin's own claim-before-credit write holds. A live
      // /checkin landing anywhere between computeRealTotals()'s upfront
      // snapshot and THIS user's turn in a loop that can span up to 10,000
      // users would get its lastCheckinAt overwritten back to the previous
      // one by this stale snapshot, letting the member /checkin again
      // inside their still-active cooldown for a second bonus. Mirrors
      // /admin/user/reconcile-checkin's own fix for the identical race
      // (Round 35): re-read the ledger fresh, inside the checkin: lock,
      // immediately before writing, instead of trusting a snapshot taken
      // before this whole run began.
      const streakLooksStale = (u.checkinStreak || 0) !== snapshotStreak.streak || (u.lastCheckinAt || null) !== snapshotStreak.lastCheckinAt;
      let wroteStreak = false;
      if (streakLooksStale) {
        await withLock('checkin:' + doc.id, async () => {
          // Same limit bump as /checkin's own copy of this query -- see its comment.
          const ledgerSnap = await db.collection('transactions')
            .where('userId', '==', doc.id).where('type', '==', 'checkin').orderBy('createdAt', 'desc').limit(5000).get();
          const stamps = ledgerSnap.docs.map(d => tsMillis(d.data().createdAt)).filter(Boolean);
          const fresh = computeCheckinStreak(stamps);
          const freshDoc = await doc.ref.get();
          const fd = freshDoc.exists ? freshDoc.data() : {};
          const stillStale = (fd.checkinStreak || 0) !== fresh.streak || (fd.lastCheckinAt || null) !== fresh.lastCheckinAt;
          if (stillStale) {
            await withLock('bal:' + doc.id, () => doc.ref.update({ checkinStreak: fresh.streak, lastCheckinAt: fresh.lastCheckinAt }));
            wroteStreak = true;
          }
        });
      }

      if (moneyWrote || wroteStreak) { updated++; if (investedChanged) investedFixed++; if (wroteStreak) streaksFixed++; }
    }
    return { ok: true, updated, investedFixed, streaksFixed };
  });
}
app.get('/admin/users/recount', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
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
    // subagent-audit-caught: this used to scan only 'pending' -- a deposit
    // that never made it past 'initiating' (its own follow-up write that
    // records marzTxUuid, right after marzCollect() succeeded at the
    // provider, itself hit a transient failure) was invisible to this
    // sweep entirely. Widened to also pick up 'initiating' rows; still a
    // no-op for one that genuinely has no marzTxUuid recorded (nothing to
    // check MarzPay's status with) -- that narrow residual case still
    // relies on an inbound webhook or a human admin noticing it in
    // /admin/deposits/list, same as before, but it's no longer invisible
    // in Records (Round 58's up-front ledger row still shows "Processing").
    // Codex-caught real bug (2nd money-flow audit): this used to fetch the
    // oldest 50 pending/initiating rows regardless of whether they had a
    // usable marzTxUuid, then just `continue` past the ones that didn't --
    // but that only skips PROCESSING them, it doesn't stop them from
    // occupying a query slot. If 50+ old rows ever permanently lack a uuid
    // (nothing else ever sets one for them -- see the comment above), this
    // query would return the SAME stuck 50 every single tick forever,
    // starving any genuinely newer, actually-reconcilable row that sits
    // beyond that fixed window. `.where('marzTxUuid','>','')` uses a real,
    // already-supported comparison operator (unlike `$ne`, MongoDB's range
    // operators correctly exclude documents where the field is missing OR
    // null) to only ever select rows this loop can actually do something
    // with -- nothing lost, since a uuid-less row was never actionable here
    // anyway, just no longer able to block newer ones.
    const snap = await db.collection('pendingDeposits').where('status', 'in', ['pending', 'initiating']).where('marzTxUuid', '>', '').orderBy('createdAt', 'asc').limit(50).get();
    for (const doc of snap.docs) {
      const dep = doc.data();
      if (!dep.marzTxUuid) continue;
      const marzStatus = await marzGetCollectStatus(dep.marzTxUuid);
      if (SUCCESS_STATUSES.has(marzStatus)) { await creditDeposit(doc); settled++; }
      else if (FAILED_STATUSES.has(marzStatus)) await markDepositFailed(doc.ref, dep.userId, DEPOSIT_FAILED_MSG);
    }
    // LipaPay's own pending/initiating deposits (Round 102) -- a lost or
    // delayed webhook is exactly why this sweep exists; it independently
    // re-checks via lipaOrderQuery() using the deposit's own doc id as
    // OutTradeNo, same "never trust anything but our own live re-check"
    // posture as the MarzPay loop just above.
    // Subagent-audit-caught real gap (Round 104): if lipaCollect() itself
    // never succeeded (a network/proxy error creating the order -- see
    // /deposit/marzpay's LipaPay branch, which logs and returns on that
    // exception, leaving the row 'initiating' forever), OutTradeNo was never
    // registered with LipaPay at all -- lipaOrderQuery() then returns
    // "not found"/providerDown FOREVER for that row, and it can never
    // transition out (no expiry exists for automatic deposits the way
    // manual ones have one). Without an exclusion, once >=50 such
    // permanently-dead rows accumulate (e.g. during a LipaPay/QuotaGuard
    // outage), this fixed-limit(50) query would reselect the SAME dead rows
    // every tick forever, starving out genuinely-pending NEWER LipaPay
    // deposits from ever being reconciled -- the exact starvation bug class
    // the MarzPay loop's own `marzTxUuid>''` exclusion above already exists
    // to prevent, just not yet extended to this provider. lipaTransactionId
    // is only ever set once lipaCollect() has genuinely returned a real
    // TransactionId, so excluding rows without it removes only rows that
    // were never actionable here anyway -- nothing lost, matching the exact
    // same tradeoff already accepted for marzTxUuid-less MarzPay rows.
    const lpSnap = await db.collection('pendingDeposits').where('status', 'in', ['pending', 'initiating']).where('provider', '==', 'lipapay').where('lipaTransactionId', '>', '').orderBy('createdAt', 'asc').limit(50).get();
    for (const doc of lpSnap.docs) {
      const dep = doc.data();
      const q = await lipaOrderQuery(doc.id);
      if (q.providerDown || !q.Data) continue;
      const realStatus = lipaStatusLabel(q.Data.PayStatus);
      if (realStatus === 'success') { await creditDeposit(doc); settled++; }
      else if (realStatus === 'failed') await markDepositFailed(doc.ref, dep.userId, DEPOSIT_FAILED_MSG);
    }
    // Deposits stuck 'matched' with needsManualCredit:true (the wallet write
    // itself failed after status already claimed the credit) never show up
    // in the 'pending' scan above -- retry them here every tick regardless
    // of whether any user is actively polling, so a stuck credit heals on
    // its own even if the user never reopens the deposit screen.
    const stuckSnap = await db.collection('pendingDeposits').where('needsManualCredit', '==', true).limit(50).get();
    for (const doc of stuckSnap.docs) { if (await creditDeposit(doc).catch(() => false)) settled++; }
  } catch (e) { console.error('Reconcile deposits error:', e.message); }
  return settled;
}
async function reconcilePendingWithdrawals() {
  let settled = 0;
  try {
    // Codex-caught real bug (2nd money-flow audit): same starvation risk as
    // reconcilePendingDeposits() above -- see its own comment for the full
    // reasoning. A `processing` row with no marzTxUuid was never
    // actionable by this loop anyway (the `continue` below), so excluding
    // it from the query only removes wasted/blocking slots, not capability.
    const snap = await db.collection('withdrawals').where('status', '==', 'processing').where('marzTxUuid', '>', '').orderBy('createdAt', 'asc').limit(50).get();
    for (const doc of snap.docs) {
      const wit = doc.data();
      if (!wit.marzTxUuid) continue;
      const marzStatus = await marzGetSendStatus(wit.marzTxUuid);
      if (SUCCESS_STATUSES.has(marzStatus)) {
        if (await markWithdrawalProcessed(doc.ref, wit.userId)) await finalizeWithdrawalTransactionRecord(doc.id, 'processed');
        settled++;
      } else if (FAILED_STATUSES.has(marzStatus)) {
        // subagent-audit-caught: same `declined` guard as the other two
        // decline-then-finalize call sites -- required here too, since this
        // reconciler tick is exactly the kind of independent live-status
        // check that can race the webhook or a client poll.
        const { declined, refunded } = await declineWithdrawalAndRefund(doc.ref, wit.userId, 'Payout failed at the mobile-money provider', ['processing']);
        if (declined) await finalizeWithdrawalTransactionRecord(doc.id, 'declined', refunded);
        settled++;
      }
    }
    // LipaPay's own outstanding disbursements (Round 102) -- same
    // starvation-avoiding `.where(field,'>','')` shape as the MarzPay loop
    // above, and same independent lipaOrderQuery() re-check the webhook
    // route uses, so a lost/delayed webhook still resolves on its own.
    const lpSnap = await db.collection('withdrawals').where('status', '==', 'processing').where('lipaOutTradeNo', '>', '').orderBy('createdAt', 'asc').limit(50).get();
    for (const doc of lpSnap.docs) {
      const wit = doc.data();
      if (!wit.lipaOutTradeNo) continue;
      const q = await lipaOrderQuery(wit.lipaOutTradeNo);
      if (q.providerDown || !q.Data) continue;
      const realStatus = lipaStatusLabel(q.Data.PayStatus);
      if (realStatus === 'success') {
        if (await markWithdrawalProcessed(doc.ref, wit.userId)) await finalizeWithdrawalTransactionRecord(doc.id, 'processed');
        settled++;
      } else if (realStatus === 'failed') {
        const { declined, refunded } = await declineWithdrawalAndRefund(doc.ref, wit.userId, 'Payout failed at the payment provider', ['processing']);
        if (declined) await finalizeWithdrawalTransactionRecord(doc.id, 'declined', refunded);
        settled++;
      }
    }
  } catch (e) { console.error('Reconcile withdrawals error:', e.message); }
  return settled;
}
// Withdrawals left 'declined' with refundPending:true -- the wallet-side
// refund itself failed after the decline was already committed (see
// declineWithdrawalAndRefund's own comment). Retried every reconciler tick
// regardless of which caller originally declined it.
async function reconcileStuckWithdrawalRefunds() {
  let settled = 0;
  try {
    const snap = await db.collection('withdrawals').where('refundPending', '==', true).limit(50).get();
    for (const doc of snap.docs) {
      const w = doc.data();
      const refunded = await withLock('bal:' + w.userId, () => completeWithdrawalRefund(doc.ref, w.userId));
      // Closes the loop for a refund that failed at decline time and only
      // just now caught up here: the transaction-ledger row was correctly
      // left un-zeroed by finalizeWithdrawalTransactionRecord back then
      // (see its own comment) specifically so this moment — refund
      // actually confirmed — is what finally zeroes it, not the decline
      // itself.
      if (refunded) await finalizeWithdrawalTransactionRecord(doc.id, 'declined', true);
      settled++;
    }
  } catch (e) { console.error('Reconcile stuck withdrawal refunds error:', e.message); }
  return settled;
}
// Codex-caught real bug: this always requested the oldest 500
// commissionPending==true rows, ordered ascending -- fine as long as
// everything it finds actually resolves within a tick or two. But
// creditReferralCommission() now deliberately leaves commissionPending
// true for as long as a buyer/referrer stays banned (see its own
// comments -- Round 79 and this round's own fix), which real bans can be
// permanent. If 500+ old investments ever end up stuck that way at once,
// this query would return the SAME stuck 500 every single tick forever,
// permanently starving any genuinely newer pending commission (a real
// first-ever attempt, or one that failed transiently) that sits beyond
// that fixed window -- it would simply never be reached. Excluding rows
// already flagged commissionBanBlocked (set by creditReferralCommission
// itself whenever it leaves early because of an active ban) keeps this
// fast, frequent (30s) sweep free to reach genuinely new/transiently-
// failed rows. Blocked rows aren't abandoned -- see
// reconcileBlockedCommissions() below, a separate, much less frequent
// sweep that gives them a real chance to resolve once unbanned without
// spamming this query every tick in the meantime.
async function reconcileCommissions() {
  try {
    const snap = await db.collection('investments').where('commissionPending', '==', true).where('commissionBanBlocked', '!=', true).orderBy('createdAt', 'asc').limit(500).get();
    for (const doc of snap.docs) {
      const inv = doc.data();
      await creditReferralCommission(doc.id, inv.userId, inv.amount).catch(e => console.error('Reconcile commission error:', e.message));
    }
  } catch (e) { console.error('Reconcile commissions error:', e.message); }
}
// Slow-lane counterpart to reconcileCommissions() above -- specifically
// re-checks rows THAT query deliberately skips (commissionBanBlocked:true).
// A ban/unban cycle is a human-timescale event, not something needing
// sub-minute responsiveness, so this runs far less often (see its own
// setInterval below) -- cheap insurance against the starvation risk above
// while still actually paying a referrer the moment they're unbanned,
// rather than never looking at their investment again.
async function reconcileBlockedCommissions() {
  try {
    const snap = await db.collection('investments').where('commissionPending', '==', true).where('commissionBanBlocked', '==', true).limit(2000).get();
    for (const doc of snap.docs) {
      const inv = doc.data();
      await creditReferralCommission(doc.id, inv.userId, inv.amount).catch(e => console.error('Reconcile blocked commission error:', e.message));
    }
  } catch (e) { console.error('Reconcile blocked commissions error:', e.message); }
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
  reconcilePendingDeposits().then(reconcilePendingWithdrawals).then(reconcileStuckWithdrawalRefunds).then(reconcileCommissions).catch(() => {});
}
// Owner-toggleable: approves every still-pending withdrawal automatically,
// a few seconds after it was requested — shares processWithdrawalCore with
// the manual "Send" button, so it's exactly as safe/idempotent.
async function autoApproveWithdrawalsTick() {
  try {
    const sett = await getSettings();
    if (!sett.autoApproveWithdrawalsEnabled) return;
    // In manual mode a payout only exists once a human has actually sent the
    // money from an admin phone. Auto-approving here would mark withdrawals
    // paid, credit totalWithdrawn and close their ledger rows when nobody
    // sent anything -- a member would see "Success" for money that never
    // left. The toggle stays where the owner set it and simply does nothing
    // while manual mode is on, rather than being silently rewritten.
    if (payoutIsManual(sett)) return;
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
    dropStale(_depAttemptsSucceededAt, 60 * 1000);
    for (const [uid, times] of _depAttempts) {
      const live = times.filter(t => now - t < 60000);
      if (live.length) _depAttempts.set(uid, live);
      else _depAttempts.delete(uid);
    }
    for (const [k, f] of _loginFails) {
      const locked = f.lockedUntil && f.lockedUntil > now;
      if (!locked && now - (f.ts || 0) > 15 * 60 * 1000) _loginFails.delete(k);
    }
    // Subagent-audit-caught: these 2 IP-keyed throttle maps were never swept
    // here, unlike every sibling ephemeral map above -- both are behind a
    // timingSafeEqual check against MANUAL_SMS_SECRET (so growth is already
    // bounded by how many distinct IPs hold the shared secret, i.e. admin
    // phones, not attacker-triggerable by an outsider), but a genuine
    // inconsistency worth closing for defense-in-depth if the secret is ever
    // rotated across many more devices. `{n, first}` shape, not a bare
    // timestamp, so this can't reuse dropStale() directly.
    for (const [k, f] of _forwarderUnlockAttempts) { if (now - (f.first || 0) > 10 * 60 * 1000) _forwarderUnlockAttempts.delete(k); }
    for (const [k, f] of _verifyNumberAttempts) { if (now - (f.first || 0) > 10 * 60 * 1000) _verifyNumberAttempts.delete(k); }
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
    // Owner: "make sure there is perfect timing on maturity check, so cron
    // is 1/2 second." Safe to tighten from 1s to 500ms because
    // reconcileCashback() already guards itself against overlapping runs
    // (_sweepingCashback) -- a tick that's still mid-sweep when the next one
    // fires just no-ops instead of running concurrently, so halving the
    // interval can never cause two sweeps to race each other. Note for the
    // owner: this doubles how often the reconciler queries MongoDB Atlas
    // (still a single lightweight query -- .where('status','==','active'),
    // not a full-ledger scan) -- worth knowing on the M0 free tier, not
    // expected to be a real problem at Snow's current scale.
    setInterval(reconcileCashback, 500);
    setTimeout(reconcileCashback, 500);
    setInterval(autoApproveWithdrawalsTick, 10 * 1000);
    setInterval(sweepEphemeralState, 5 * 60 * 1000);
    setInterval(reconcileBlockedCommissions, 5 * 60 * 1000);
    setInterval(reconcileManualDeposits, 60 * 1000);
  })
  .catch(e => { console.error('Mongo connection failed:', e.message); process.exit(1); });
