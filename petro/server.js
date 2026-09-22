const express     = require('express');
const admin       = require('firebase-admin');
const cors        = require('cors');
const crypto      = require('crypto');
const fs          = require('fs');
const path        = require('path');
const helmet      = require('helmet');
const compression = require('compression');
const rateLimit   = require('express-rate-limit');
const { execFile } = require('child_process'); // used by the auto-deploy webhook, see /deploy/webhook below
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
// /health is exempted from BOTH limiters above because Render's own platform
// health checks must never be throttled -- a 429 to the health checker reads
// as "this service is down" and takes the whole backend out of rotation.
// But exempt-from-everything was too blunt: /health is unauthenticated, it is
// the one route whose URL is guessable by design, and it calls pingDb() on
// every hit, so it was the cheapest way in to make this server hammer Mongo.
// Its own limiter is set far above any real health-check cadence (Render
// polls on the order of once every few seconds, and this allows 5/second
// sustained) while still putting a ceiling on a flood.
const healthLimiter = rateLimit({ windowMs: 60 * 1000, max: 300, standardHeaders: false, legacyHeaders: false,
  message: { status: 'error', message: 'Too many requests.' } });
app.use((req, res, next) => (req.path === '/health' ? healthLimiter(req, res, next) : ipOnlyLimiter(req, res, next)));
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
// '/turntable/spin' belongs here for the same reason '/checkin' does: it
// pays real money on an unauthenticated-body POST, so it gets the strict
// 60/min per-user cap rather than only the 400/min global one.
['/withdraw/request', '/invest/create', '/deposit/marzpay', '/bank/save', '/bank/delete',
 '/account/create-profile', '/register', '/account/transaction-pin/change', '/redeem',
 '/team/milestone/claim', '/checkin', '/turntable/spin']
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
// /admin/app-icon/set carries TWO PNGs (512 and 192) in one body, so it
// needs the image parser even though each one on its own is small.
const IMAGE_BODY_ROUTES = new Set(['/admin/products/save', '/admin/banner/set', '/admin/help-banner/set', '/admin/announcement-image/set', '/admin/petro-image/set', '/admin/app-icon/set', '/admin/link-preview/set']);
// The banner video is capped at 4 MB of actual video, which is ~5.5 MB once
// base64'd, so it needs the huge parser -- bigJsonParser's 4 MB limit would
// reject a legal upload before the route's own, friendlier size check ran.
const HUGE_JSON_ROUTES = new Set(['/admin/about-content/set', '/admin/banner/video-upload']);
// PesaJet signs the RAW REQUEST PAYLOAD -- their dashboard says so in as many
// words ("computing an HMAC-SHA256 digest of the raw request payload using
// this secret"). A digest over a re-serialised object is NOT the same bytes,
// so the raw buffer has to be kept before the JSON parser consumes it.
//
// Scoped to the one webhook path rather than set on the shared parser: this
// holds a copy of every body it sees, and there is no reason to do that for
// every request in the app.
const RAW_BODY_ROUTES = new Set(['/pesajet/webhook', '/deploy/webhook']);
const keepRawBody = (req, res, buf) => { if (RAW_BODY_ROUTES.has(req.path)) req.rawBody = buf; };
const rawJsonParser = express.json({ limit: '64kb', verify: keepRawBody });
app.use((req, res, next) => (RAW_BODY_ROUTES.has(req.path) ? rawJsonParser : HUGE_JSON_ROUTES.has(req.path) ? hugeJsonParser : IMAGE_BODY_ROUTES.has(req.path) ? bigJsonParser : smallJsonParser)(req, res, next));
app.use(express.urlencoded({ extended: true, limit: '64kb' }));

// Petro's frontend is hosted on Tencent EdgeOne Pages while this backend
// runs elsewhere (Render), so the browser treats every API call as
// cross-origin and the EdgeOne origin MUST be allowed here. Get this wrong
// and the failure is deeply misleading: the `cors` middleware answers an
// unlisted origin with NO CORS headers at all, the browser blocks the
// response, and the app reports its own generic "Network error. Check your
// connection." -- identical to a real connectivity problem, on a backend
// that is actually up and healthy. Snow hit exactly this when its custom
// domain went live and every /register call started failing.
//
// Snow's own live domain (chn-snow2beer.com) was deliberately dropped from
// this copy -- it has no business reaching Petro's database.
const CORS_ALLOWED_ORIGINS = new Set([
  'https://petro-platform.com', 'https://www.petro-platform.com',
]);
// Suffix-matched hosts. EdgeOne hands out *.edgeone.app, *.edgeone.site AND
// *.edgeone.dev subdomains, and the project can be renamed or redeployed to
// a new one, so matching the suffix avoids a dead app every time that
// changes. Render's own *.onrender.com is here for the same reason.
// .edgeone.dev was missing and the admin panel landed on exactly that
// domain: the owner's login showed "Network error. Try again." on a backend
// that was up and healthy -- the misleading failure this block's own comment
// above warns about, hit for real a second time. If a Petro screen ever
// reports a network error while the server is fine, check this list FIRST.
// Platform hostnames the frontends can legitimately be served from. Railway
// is in this list for the same reason Render is: the panels live on
// <service>.up.railway.app, and a host missing from here is refused by CORS,
// which the browser reports to the app as nothing at all -- this file's own
// notes record that shape of outage twice, once for Snow's custom domain and
// once for *.edgeone.dev.
//
// '.railway.app' as well as '.up.railway.app' because Railway has served
// generated domains under both, and a suffix that stops matching after a
// platform rename looks exactly like a dead server.
const CORS_ALLOWED_SUFFIXES = ['.edgeone.app', '.edgeone.site', '.edgeone.dev', '.onrender.com', '.pages.dev', '.up.railway.app', '.railway.app'];
// Extra hostnames the owner adds from the admin panel (settings.allowedOrigins),
// for custom domains that no built-in suffix covers. Kept as a plain
// synchronous snapshot, refreshed by getSettings() whenever its own 60s cache
// refreshes and immediately on save, because the CORS check runs on EVERY
// request including preflights -- it must never wait on a database read.
//
// These are ADDED to the two lists above; they can never replace or remove
// them. That is deliberate. If a typo here could drop the built-in hosts, one
// bad save would CORS-block the admin panel itself, and the only place to
// undo it is... the admin panel. The baseline guarantees a way back in.
let _corsExtraHosts = [];
// One hostname, as the CORS check will compare it: lowercased, scheme and any
// path/port stripped, so the owner can paste "https://petro-platform.com/" or
// type "petro-platform.com" and get the same result.
// Matching is EXACT hostname only -- no wildcards, no suffix matching. A
// suffix entry typed as ".com" would hand every site on the internet access
// to this backend, and there is no phrasing of that field that makes the
// mistake obvious enough to risk.
function normalizeAllowedHost(raw) {
  let s = String(raw == null ? '' : raw).trim().toLowerCase();
  if (!s) return { skip: true };
  s = s.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '');
  if (!s) return { error: 'Enter a domain such as petro-platform.com' };
  if (s.length > 253) return { error: `"${raw}" is too long to be a domain.` };
  if (s.includes('*')) return { error: `Wildcards are not allowed ("${raw}"). Add each domain on its own line.` };
  const labels = s.split('.');
  if (labels.length < 2) return { error: `"${raw}" is not a full domain. Use something like petro-platform.com.` };
  if (!labels.every(l => /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(l)))
    return { error: `"${raw}" is not a valid domain name.` };
  return { host: s };
}
// Accepts the raw admin input (an array of lines, or one newline/comma
// separated string) and returns a clean, de-duplicated host list, or the
// first problem found so the owner is told exactly which line is wrong
// instead of having the whole save silently drop it.
function sanitizeAllowedOrigins(raw) {
  const lines = Array.isArray(raw) ? raw : String(raw == null ? '' : raw).split(/[\n,]/);
  if (lines.length > 50) return { error: 'That is more domains than this list is meant to hold (max 50).' };
  const hosts = [];
  for (const line of lines) {
    const r = normalizeAllowedHost(line);
    if (r.skip) continue;
    if (r.error) return { error: r.error };
    if (!hosts.includes(r.host)) hosts.push(r.host);
  }
  return { hosts };
}
// ── WHY EVERY SHORT ADDRESS WAS REFUSED BY THE BACKEND ──
// Owner: "other country domains are not working, no fetching images".
//
// This used to be an EXACT hostname match, and that is why: the owner types
// the domain he registered into the allowlist, but the short addresses are
// GENERATED (g26e, b5dh, ...) and never typed anywhere. So the root domain
// worked and every subdomain of it was refused -- and a refused origin means
// the browser throws the reply away before any of our code sees it, so the
// app just reports a network error. Practically everything on screen comes
// through this API, including every photo (they travel as data: URLs inside
// the JSON), which is exactly what "no fetching images" looks like.
//
// So a host the owner allowed now covers its SUBDOMAINS too. That is the
// whole premise of a wildcard DNS record: every label under his domain is
// his. Matched on '.' + domain, which cannot be spoofed from outside --
// "petro-platform.com.evil.com" ends with ".evil.com", not
// ".petro-platform.com".
//
// Deliberately NOT dependent on the base domain being set correctly: that
// is a separate setting for a separate job (deciding which COUNTRY a label
// belongs to), and reaching the backend at all must not be gated on it.
function corsHostAllowed(host) {
  const h = String(host || '').trim().toLowerCase();
  if (!h) return false;
  return _corsExtraHosts.some(d => h === d || h.endsWith('.' + d));
}
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (CORS_ALLOWED_ORIGINS.has(origin)) return cb(null, true);
    try {
      const h = new URL(origin).hostname.toLowerCase();
      if (CORS_ALLOWED_SUFFIXES.some(sfx => h.endsWith(sfx))) return cb(null, true);
      // Owner-added custom domains, checked LAST and only ever additive --
      // see _corsExtraHosts.
      if (corsHostAllowed(h)) return cb(null, true);
      if (h === 'localhost' || h === '127.0.0.1') return cb(null, true);
    } catch (_) {}
    cb(null, false);
  },
  // ── WHY maxAge IS SET ──
  // A preflight is a whole extra round trip, and Chromium caches one for
  // only FIVE SECONDS by default -- so every POST paid for two requests,
  // over and over, on a phone where the round trip is the expensive part.
  // A day is safe here because the answer barely changes: the allowed
  // methods and headers are fixed, and the origin decision is per-URL-and-
  // origin, so a newly allowed domain is unaffected (it has no cached
  // preflight to go stale).
  //
  // This does NOT fix the reads: a GET carrying Content-Type: application/
  // json is preflighted at all, which is a thing the app should not be doing
  // -- see api() in user-src/original_module.js, where that header is now
  // sent only with a body.
  maxAge: 86400
}));

app.use((_req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
    'Cache-Control': 'no-store',
    // helmet has no permissionsPolicy setting, so this is set by hand, to
    // match what render.yaml sends from the two static sites. It matters
    // less here than on the panels (this origin serves JSON, not a page
    // anyone browses), but a few endpoints DO return HTML/images, and
    // matching headers across all three origins means there is one posture
    // to reason about instead of three.
    'Permissions-Policy': 'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()',
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
// The validation lives in ./service-account so a test can require it; see that
// file for why each failure state gets its own sentence. Refusing to boot is
// right for every one of them: a server with no way to verify a member's ID
// token must not serve requests.
const { loadServiceAccount } = require('./service-account');
const { sa: serviceAccount, fatal: serviceAccountFatal } =
  loadServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT);
if (serviceAccountFatal) { console.error(serviceAccountFatal); process.exit(1); }
try {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
} catch (e) {
  // Reached when every field is present and one of them is wrong -- most often
  // a private_key whose line breaks did not survive the paste.
  console.error('Firebase rejected the service account: ' + e.message);
  process.exit(1);
}

// ── MONGODB ──
const { connectMongo, db, FieldValue, pingDb } = require('./db');

// ── CONFIG ──
const ADMIN_KEY   = process.env.ADMIN_KEY   || '';
// This server's own public address, which is what MarzPay is told to call
// back on (PesaJet's webhook URL is dashboard-configured instead -- see the
// PESAJET section below). An explicit PUBLIC_URL always wins; otherwise it
// is taken from whichever host we are running on.
//
// RAILWAY_PUBLIC_DOMAIN is in this list because Render suspended the account
// and the platform had to move. Railway does not set RENDER_EXTERNAL_URL, so
// without it PUBLIC_URL would be empty and `callbackUrl`/`notifyUrl` would
// simply be OMITTED from every payment request -- the deposit would still be
// created, the prompt would still reach the phone, and nothing would ever
// call back. The reconciler and the member's own poll would cover for it, so
// the only symptom is money taking minutes instead of seconds to appear.
// Railway gives a bare hostname, hence the https:// added below.
const PUBLIC_URL  = (() => {
  let u = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL ||
           process.env.RAILWAY_PUBLIC_DOMAIN || '').trim().replace(/\/$/, '');
  if (u && !u.startsWith('http')) u = 'https://' + u;
  return u;
})();
const MARZPAY_BASE = 'https://wallet.wearemarz.com/api/v1';
const MARZPAY_KEY  = process.env.MARZPAY_KEY || ''; // base64-encoded credentials
const MARZ_TIMEOUT = 20000;
// MarzSms -- a SEPARATE MarzPay product (its own dashboard/API keys at
// sms.wearemarz.com, distinct from the wallet product MARZPAY_KEY above).
// Used for the OTP verification codes sent on registration, password reset,
// and adding a withdrawal bank/mobile-money account -- see the "OTP" section
// below. Same "base64(api_key:api_secret)" Basic-auth convention as the
// wallet API. MARZSMS_KEY is unset until the owner supplies it (Railway/VPS
// secret, never committed); every OTP send refuses cleanly until then.
const MARZSMS_BASE = 'https://sms.wearemarz.com/api/v1';
const MARZSMS_KEY  = process.env.MARZSMS_KEY || '';

// ── REGIONS (one subdomain = one country) ──
//
// Owner: "l wanted other subdomain to fetch other country code and
// currency, ie fgdr.petro-platform.com in ugx, and country code changeable
// to other country or created, and another can be sfhd.petro-platform in
// KES shs, or any country created, also make when l can edit prices of each
// product and all settings as these of ugx."
//
// A region is one country the platform runs in. It owns:
//   * its hostname(s)        -- the subdomain(s) the app is served from
//   * its currency label     -- "UGX", "KES", whatever the admin types
//   * its dialling code and mobile-number shape (length + allowed prefixes)
//   * its clock offset       -- cash-out hours and product windows are that
//                               country's local time, not always Kampala's
//   * its own copy of every admin setting, and its own price for every
//     product (see settingsDocId() and applyRegionToProduct())
//
// HOW A REQUEST GETS ITS REGION
//   * a VISITOR (not signed in) gets the region that owns the hostname the
//     app was loaded from, so the landing screen, Sign Up and the product
//     list read in the right currency before anybody has an account.
//   * a MEMBER always gets THEIR OWN region -- the one stamped on the
//     account at registration -- no matter which hostname they opened.
//
// That second rule is the money-safety rule of this whole feature. If the
// region came from the request, somebody could register where a product
// costs 30,000 KES and then buy it on the host where the same product costs
// 30,000 UGX. The region is never something a caller can choose; it is a
// property of the account.
//
// Resolution happens once per request, in regionMiddleware(), and is
// carried in an AsyncLocalStorage store. That is what lets getSettings(),
// getProducts(), fmtMoney(), cleanPhone() and the clock helpers all be
// region-correct without threading an argument through ~250 call sites --
// and it is why the region middleware must be installed BEFORE the
// maintenance gate below, which reads settings itself.
const { AsyncLocalStorage } = require('node:async_hooks');
const _regionCtx = new AsyncLocalStorage();
// The founding region. Its key is fixed ('ug'): the region a member has no
// stamp for is this one, the 'settings/main' document is this one's
// settings, and every product's plain `price` field is this one's price. A
// 'regions/ug' document, if the admin saves one, overrides the fields below
// (name, currency, dial code, hosts, clock) but can never be deleted and
// can never stop being the default -- there is always somewhere for an
// unknown hostname and an unstamped account to land.
const DEFAULT_REGION_KEY = 'ug';
// The languages the app ships a dictionary column for. This list and LANGS in
// user-src/original_module.js MUST hold the same codes -- the server decides
// which a country may offer and the app decides what each one reads like, so
// a code here with no column there is an option that does nothing when
// tapped. test-languages.js compares the two files.
const LANGUAGE_CODES = ['en', 'lg', 'sw', 'fr', 'rw', 'nyn'];
const DEFAULT_REGION = Object.freeze({
  key: DEFAULT_REGION_KEY, name: 'Uganda', currency: 'UGX', dialCode: '256',
  localLength: 9, prefixes: ['7'], utcOffsetMin: 180, hosts: [], active: true, isDefault: true,
  languages: ['en'], defaultLang: 'en',
});
// Regions as a plain synchronous array, refreshed on the same 60s cadence as
// settings and products. Synchronous because currentRegion() is called from
// fmtMoney() and the clock helpers, which cannot await anything.
let _regionsSnapshot = [DEFAULT_REGION];
let _regionsCacheTs = 0;
// Hostnames owned by a region are allowed to call this backend, always --
// a region whose subdomain is CORS-refused is a region that does not work,
// and the owner would have no way to tell that apart from a dead server.
// Merged with the admin's own allowedOrigins list in _corsExtraHosts.
let _regionHosts = [];
let _mainAllowedHosts = [];
function refreshCorsSnapshot() {
  // Parked hostnames are allowed through CORS **on purpose**. They are
  // refused by hostIsParked() a moment later with a 403 the app can read
  // and act on -- and it can only read it if the browser does not drop the
  // response first. A CORS-refused parked address would show the app's
  // generic "Network error" instead of the notice, which is precisely the
  // confusion HOST_PARKED exists to avoid. The root domain is in the
  // built-in allowlist already for the same reason; this covers a custom
  // one the owner retires later.
  const all = _mainAllowedHosts.concat(_regionHosts, _parkedHosts, _baseDomain ? [_baseDomain, 'www.' + _baseDomain] : []);
  _corsExtraHosts = all.filter((h, i) => h && all.indexOf(h) === i);
}
// ── WHERE THE APP MAY BE OPENED FROM ──
// A synchronous snapshot of the four host settings, for the same reason
// _corsExtraHosts is one: this is decided on every request, including
// preflights, and must never await a database read. Refreshed by
// getSettings() whenever its own cache refreshes, and immediately on save.
let _baseDomain = 'petro-platform.com';
let _blockRootDomain = true;
let _parkedHosts = [];
let _strictRegionHosts = false;
function refreshHostPolicy(sett) {
  const bd = normalizeAllowedHost(sett && sett.baseDomain);
  if (bd.host) _baseDomain = bd.host;
  _blockRootDomain = (sett && sett.blockRootDomain) !== false;
  _parkedHosts = (sanitizeAllowedOrigins(sett && sett.parkedHosts).hosts) || [];
  _strictRegionHosts = !!(sett && sett.strictRegionHosts);
  rebuildRegionHosts();
}
// One hostname, lowercased with the scheme, path and port taken off -- the
// shape every host comparison in this file is made in.
function hostOnly(raw) {
  return String(raw || '').trim().toLowerCase()
    .replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '');
}
// Every hostname a country answers for: the full ones it lists, plus each
// short LABEL joined to the base domain.
function regionHostnames(region) {
  const r = region || {};
  const hosts = (r.hosts || []).slice();
  for (const l of (r.labels || [])) if (_baseDomain) hosts.push(l + '.' + _baseDomain);
  return hosts.filter((h, i) => h && hosts.indexOf(h) === i);
}
// The three ways an arrival can be moved onto a different address in his own
// country -- see the rotateEntry comment in DEFAULT_SETTINGS for what each
// one costs. Kept beside regionHostnames because the pool it draws from is
// exactly what that function returns.
const ROTATE_ENTRY_MODES = ['off', 'visitors', 'always'];
function rebuildRegionHosts() {
  _regionHosts = [];
  for (const r of _regionsSnapshot) for (const h of regionHostnames(r)) _regionHosts.push(h);
  refreshCorsSnapshot();
}
// The platform's OWN service and preview hosts. Never parked, whatever the
// settings say: these are the addresses the owner administers and tests
// from, and strictRegionHosts would otherwise lock him out of the panel the
// setting is turned off in.
function isInfraHost(h) {
  if (!h) return false;
  if (h === 'localhost' || h === '127.0.0.1' || /^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return true;
  return CORS_ALLOWED_SUFFIXES.some(sfx => h.endsWith(sfx));
}
// Owner: "l didn't want root domain to work." Members arrive on their own
// country's subdomain; the bare domain and its www. form serve nobody, so a
// request from one is refused outright rather than handed the app.
//
// An EMPTY host is never parked. A gateway webhook, the SMS forwarder and
// Render's own health check arrive with no Origin at all, and money that has
// already left a payer's account must never be blocked by a domain rule.
function hostIsParked(rawHost) {
  const h = hostOnly(rawHost);
  if (!h) return false;
  if (isInfraHost(h)) return false;
  if (_parkedHosts.includes(h)) return true;
  if (_blockRootDomain && _baseDomain && (h === _baseDomain || h === 'www.' + _baseDomain)) return true;
  // Only a hostname some country actually claims serves the app. Worth
  // having once a wildcard DNS record exists, or every made-up label under
  // the base domain would quietly serve the founding country.
  //
  // A domain the owner typed into the allowlist HIMSELF is never parked by
  // this, only by the retired list above. Strict mode depends on the base
  // domain being set correctly to know what a country's addresses even
  // are, and if it is not, this would refuse every address on the platform
  // at once -- including the ones he explicitly allowed.
  if (_strictRegionHosts && !_regionHosts.includes(h) && !_mainAllowedHosts.includes(h)) return true;
  return false;
}
// The hostname the app was loaded from. Origin, because the app is served
// from a different origin than this API; Host is the fallback for a
// same-origin or server-to-server call.
function requestHost(req) {
  return hostOnly((req && req.headers && (req.headers.origin || req.headers.host)) || '');
}
// One region record, with every field forced into the shape the rest of the
// server relies on. Applied to admin input at save time AND to whatever is
// read back out of the database, so a hand-edited or half-written document
// can never produce (say) a zero-length phone number rule.
function normalizeRegion(raw, key) {
  const k = String((raw && raw.key) || key || '').trim().toLowerCase();
  const isDefault = k === DEFAULT_REGION_KEY;
  const base = isDefault ? DEFAULT_REGION : { localLength: 9, prefixes: [], utcOffsetMin: 180 };
  const digitsOnly = v => String(v == null ? '' : v).replace(/\D/g, '');
  const dialCode = digitsOnly(raw && raw.dialCode) || base.dialCode || '';
  const localLength = Math.round(Number(raw && raw.localLength)) || base.localLength || 9;
  const prefixes = (Array.isArray(raw && raw.prefixes) ? raw.prefixes : String((raw && raw.prefixes) || '').split(/[\s,]+/))
    .map(digitsOnly).filter(Boolean);
  const off = Number(raw && raw.utcOffsetMin);
  const hosts = (Array.isArray(raw && raw.hosts) ? raw.hosts : String((raw && raw.hosts) || '').split(/[\s,\n]+/))
    .map(h => { const r = normalizeAllowedHost(h); return r.host || null; }).filter(Boolean);
  // Owner: "l wanted like subdomains of different countries, ie g26e for
  // Uganda, shy for another." A LABEL is just the bit in front of the base
  // domain -- 'g26e' becomes g26e.petro-platform.com. Four characters typed
  // instead of a whole hostname spelled out, and the base domain then lives
  // in one setting rather than repeated on every country.
  const labels = (Array.isArray(raw && raw.labels) ? raw.labels : String((raw && raw.labels) || '').split(/[\s,\n]+/))
    .map(l => String(l == null ? '' : l).trim().toLowerCase().replace(/[^a-z0-9-]/g, ''))
    .filter(l => l && l.length <= 40 && l !== 'www' && !l.startsWith('-') && !l.endsWith('-'));
  // Owner: "make when l can select allowed languages of any specific
  // country." Unknown codes are dropped rather than kept, because the app can
  // only render a language it ships a column for -- storing 'de' would put an
  // option in the picker that does nothing when tapped.
  const langsIn = (Array.isArray(raw && raw.languages) ? raw.languages : String((raw && raw.languages) || '').split(/[\s,\n]+/))
    .map(c => String(c == null ? '' : c).trim().toLowerCase()).filter(c => LANGUAGE_CODES.includes(c));
  const languages = langsIn.filter((c, i) => langsIn.indexOf(c) === i);
  // A country with nothing picked offers English alone -- the same thing it
  // did before this feature existed, so every stored region reads correctly
  // without a migration.
  if (!languages.length) languages.push('en');
  // Which one a first-ever launch opens in. Forced into the allowed list: a
  // default nobody is allowed to use would leave new arrivals in a language
  // the picker cannot switch away from, since it lists only allowed ones.
  let defaultLang = String((raw && raw.defaultLang) || '').trim().toLowerCase();
  if (!languages.includes(defaultLang)) defaultLang = languages[0];
  return {
    languages, defaultLang,
    key: k, name: String((raw && raw.name) || base.name || k).trim().slice(0, 48),
    currency: String((raw && raw.currency) || base.currency || 'UGX').trim().slice(0, 8).toUpperCase(),
    dialCode, localLength,
    prefixes: prefixes.length ? prefixes : (base.prefixes || []).slice(),
    utcOffsetMin: Number.isFinite(off) ? Math.round(off) : (base.utcOffsetMin != null ? base.utcOffsetMin : 180),
    hosts: hosts.filter((h, i) => hosts.indexOf(h) === i),
    labels: labels.filter((l, i) => labels.indexOf(l) === i),
    // The founding region can never be switched off -- see DEFAULT_REGION.
    active: isDefault ? true : (raw && raw.active) !== false,
    isDefault,
  };
}
async function getRegions() {
  if (Date.now() - _regionsCacheTs < 60 * 1000 && _regionsSnapshot.length) return _regionsSnapshot;
  try {
    const snap = await db.collection('regions').get();
    const stored = snap.docs.map(d => normalizeRegion(d.data(), d.id)).filter(r => r.key);
    const ug = stored.find(r => r.key === DEFAULT_REGION_KEY) || DEFAULT_REGION;
    const others = stored.filter(r => r.key !== DEFAULT_REGION_KEY);
    others.sort((a, b) => a.key.localeCompare(b.key));
    _regionsSnapshot = [ug].concat(others);
  } catch (_) {
    // A read failure must not take the platform down to no regions at all.
    _regionsSnapshot = _regionsSnapshot.length ? _regionsSnapshot : [DEFAULT_REGION];
  }
  _regionsCacheTs = Date.now();
  rebuildRegionHosts();
  return _regionsSnapshot;
}
function defaultRegion() { return _regionsSnapshot[0] || DEFAULT_REGION; }
// The region in force for whatever is running right now. Returns the
// founding region outside a request (boot, reconcilers, the scheduler) --
// background work that touches ONE member's money wraps itself in that
// member's region with withUserRegion() instead of relying on this.
function currentRegion() {
  const store = _regionCtx.getStore();
  return (store && store.region) || defaultRegion();
}
function currentRegionKey() { return currentRegion().key; }
function regionByKey(key) {
  const k = String(key || '').trim().toLowerCase();
  if (!k) return defaultRegion();
  return _regionsSnapshot.find(r => r.key === k) || defaultRegion();
}
// Which region owns a hostname. Unknown hostnames fall back to the founding
// region rather than being refused: the API is reached from EdgeOne previews,
// the Render domain, localhost and the admin panel, none of which belong to
// a country, and all of which must keep working.
function regionForHost(host) {
  const h = hostOnly(host);
  if (!h) return defaultRegion();
  for (const r of _regionsSnapshot) if (r.active && regionHostnames(r).includes(h)) return r;
  return defaultRegion();
}
// Run fn with an explicit region in force. Used by the admin panel (editing
// another region's settings and prices) and by background jobs.
function runInRegion(region, fn) {
  const r = typeof region === 'string' ? regionByKey(region) : (region || defaultRegion());
  return _regionCtx.run({ region: r }, fn);
}
// uid -> region key. A member's region is fixed at registration and never
// changes, so this is cached hard: without it the middleware would add a
// users/{uid} read to every single authenticated request, which an M0
// cluster cannot afford.
const _userRegionCache = new Map();
const USER_REGION_TTL = 10 * 60 * 1000;
async function userRegionKey(uid) {
  if (!uid) return null;
  const hit = _userRegionCache.get(uid);
  if (hit && Date.now() - hit.ts < USER_REGION_TTL) return hit.key;
  let key = null;
  try {
    const snap = await db.collection('users').doc(uid).get();
    if (snap.exists) key = String(snap.data().regionKey || '').trim().toLowerCase() || DEFAULT_REGION_KEY;
  } catch (e) {
    if (hit) return hit.key; // a verified cached region remains safe
    throw new Error('Could not resolve account region; retry when the database recovers.');
  }
  if (key) _userRegionCache.set(uid, { key, ts: Date.now() });
  return key;
}
function forgetUserRegion(uid) { if (uid) _userRegionCache.delete(uid); }
// Run fn in the region of ONE member, for work that happens outside any
// request: maturity payouts, referral commissions, the reconcilers. Their
// descriptions carry money amounts, and an amount labelled in the wrong
// currency is a support ticket at best.
async function withUserRegion(userId, fn) {
  const key = await userRegionKey(userId);
  if (!key) throw new Error('Cannot run financial work without a verified account region.');
  return runInRegion(key, fn);
}
app.use(async (req, res, next) => {
  let region = defaultRegion();
  let parked = false;
  try {
    // The founding region's settings carry the four backend-wide host
    // controls (base domain, root-domain block, parked list, strict mode).
    // Read first, and cheap -- it is the same 60s cache every other route
    // reads -- so the host decision below is never made against defaults.
    await getSettings(DEFAULT_REGION_KEY);
    await getRegions();
    const host = requestHost(req);
    region = regionForHost(host);
    // A signed-in caller overrides the hostname with their own account's
    // region -- see the money-safety rule at the top of this section.
    if ((req.headers.authorization || '').startsWith('Bearer ')) {
      const uid = await verifyAuth(req);
      const key = uid ? await userRegionKey(uid) : null;
      if (key) region = regionByKey(key);
    }
    parked = hostIsParked(host);
  } catch (_) {
    return res.status(503).json({ status: 'error', code: 'REGION_UNAVAILABLE', message: 'Could not confirm your account country. Please try again shortly.' });
  }
  _regionCtx.run({ region, parked }, next);
});
// ── THE ROOT DOMAIN DOES NOT SERVE THE APP ──
// Owner: "l didn't want root domain to work."
//
// The real fix is not attaching the root domain to the static site at all,
// and that is what should be done at the host. This covers it being
// attached anyway, and it covers a direct API call made from it: the app
// gets a definite answer it can act on rather than a silent CORS failure,
// which looks identical to the server being down.
//
// CORS is deliberately NOT used to do this. A refused origin means the
// browser drops the reply before any code sees it, so the app could not
// tell "this address is parked" from "the network is broken" and would show
// the wrong screen. Answering 403 with a code is what lets it say the right
// thing.
//
// GUARD_EXEMPT is honoured for the same reason the maintenance gate honours
// it: those are gateway webhooks, the SMS forwarder and the health check,
// reporting money that has already moved. None of them arrives with a
// browser Origin anyway, but a domain rule must never be the thing that
// loses a payment.
app.use((req, res, next) => {
  if (GUARD_EXEMPT.has(req.path)) return next();
  const store = _regionCtx.getStore();
  if (!store || !store.parked) return next();
  return res.status(403).json({
    status: 'error', code: 'HOST_PARKED',
    message: 'This address does not serve the app. Please open the link for your own country.',
  });
});

// ── MAINTENANCE GATE ──
const MAINTENANCE_BLOCK = ['/account', '/invest', '/deposit', '/withdraw', '/register', '/bank', '/team'];
const GUARD_EXEMPT = new Set(['/', '/health', '/deposit/callback', '/withdraw/callback', '/pesajet/webhook']);
// The platform's name, as the owner last set it in Admin -> Settings. Every
// server-side string that names the app goes through here rather than
// spelling it out, so renaming the app is one field and not a code change.
// Falls back to DEFAULT_SETTINGS' own value, so a settings read that failed
// still produces a sentence with a name in it.
function brandName(s) {
  const n = s && typeof s.brandName === 'string' ? s.brandName.trim() : '';
  return n || DEFAULT_SETTINGS.brandName;
}
app.use(async (req, res, next) => {
  if (GUARD_EXEMPT.has(req.path)) return next();
  if (!MAINTENANCE_BLOCK.some(p => req.path.startsWith(p))) return next();
  try {
    const s = await getSettings();
    if (s && s.maintenanceMode) {
      return res.status(503).json({ status: 'error', code: 'MAINTENANCE',
        message: s.maintenanceMsg || (brandName(s) + ' is under maintenance. Please check back shortly.') });
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
        message: brandName(s) + ' has not opened yet.', openingAt: Number(s.openingCountdownAt) });
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
  // Owner: "let the withdrawal multiple be set from admin, so default
  // multiple should be 5000, ie one withdrawals 5000,10000,25000,30000,
  // 35000 like that." Set to 0 to turn the rule off entirely and allow any
  // amount above the minimum.
  // Owner: "remove multiplier of with multiples of withdrawal settings" --
  // 0 means any amount above the minimum is allowed (see the check at
  // /withdraw/request). Admin control for this removed; left settable only
  // by editing this default or writing to the setting directly.
  withdrawMultiple: 0,
  // Login / Sign Up backdrops: fully opaque and unblurred, so an
  // uploaded image shows exactly as supplied until the owner dials it
  // back. With no image set these do nothing at all.
  authHeroOpacity: 100, authHeroBlur: 0,
  authCardOpacity: 100, authCardBlur: 0,
  // ── Turntable (daily spin wheel) ──
  // Owner's spec: "spin wheel bonus, so everyday one spins just like daily
  // check-in and earns the set amount in admin panel, also spin can also be
  // available from buying products like any vip product like product
  // 2,3,4,5,6,7,8... one earns the set percentage in admin panel of product
  // amount bought."
  // So there are TWO kinds of spin, with different payout rules:
  //   * the free daily one, paying a random amount in [Min, Max] (set both
  //     equal for a fixed amount), and
  //   * spins earned by buying a product, paying from THAT product's own
  //     spinMin/spinMax band -- configured per product, not here.
  turntableEnabled: false,
  turntableDailyMin: 200, turntableDailyMax: 1000,
  // Spins earned from purchases are configured PER PRODUCT (spinCount,
  // spinMin, spinMax on each product) -- owner: "make when l can configure
  // every spin price for each product... also products will have different
  // rates of multipliers so don't fix it in settings." Only the free daily
  // spin's band lives here, because it is not tied to any product.
  // Owner's rule: the referral code on Sign Up is a MUST, not optional.
  // Enforced on the server (it used to be a client-side check only, which any
  // direct POST /register walked straight past). The very first account is
  // exempt automatically -- see referralRequiredNow(): with no members yet
  // there is no code in existence to type, so requiring one would make the
  // platform impossible to launch. Turn this off temporarily if you ever need
  // to onboard someone with no upline.
  requireReferralCode: true,
  // Extra frontend domains allowed to call this backend, set from the admin
  // panel (Settings -> Allowed website domains). ADDED to the built-in
  // allowlist, never replacing it -- see _corsExtraHosts.
  allowedOrigins: [],
  // ── WHERE THE APP IS ALLOWED TO BE OPENED FROM ──
  // Owner: "l wanted like subdomains of different countries, ie g26e for
  // Uganda, shy for another... l didn't want root domain to work."
  //
  // The domain every country's short address hangs off. A country lists
  // LABELS ('g26e', 'shy') and the server builds the hostname from them and
  // this, so adding an address is four characters typed, not a full domain
  // spelled out in two places.
  baseDomain: 'petro-platform.com',
  // The bare domain and its www. form serve nobody: every member arrives on
  // their own country's subdomain. With this on, a request from the root
  // domain is refused with HOST_PARKED and the app shows a short notice
  // instead of booting. Belt to the braces of simply not attaching the root
  // domain to the site at all, which is the real fix -- this is what covers
  // it being attached anyway, and direct API calls made from it.
  blockRootDomain: true,
  // Extra hostnames that must never serve the app, beyond the root domain --
  // an old address being retired, a domain parked for later.
  parkedHosts: [],
  // With this on, ONLY a hostname some country actually claims serves the
  // app; anything else on the base domain is treated as parked. Worth
  // turning on once a wildcard DNS record exists, or every made-up label
  // would quietly serve the founding country. Off by default so no existing
  // address can stop working the moment this ships. The platform's own
  // service hosts (*.onrender.com and the preview hosts) are always exempt,
  // or this would lock the owner out of the URL he administers from.
  strictRegionHosts: false,
  // ── MOVING A VISITOR ONTO A DIFFERENT ADDRESS ──
  // Owner: "if one joined the site or visited the site with a subdomain like
  // gfdt so in his session, server changes the subdomain of his session to
  // another like b5dh, so in that very country."
  //
  // On arrival the app asks the server for an address, and the server hands
  // back a DIFFERENT short address belonging to the SAME country, which the
  // browser then moves to. The path, the ?ref= code and the #hash all come
  // along, so a shared invite link still works. Only addresses that country
  // actually claims are handed out -- a made-up label resolves to the
  // founding country (wrong currency) and is not in the CORS allowlist, so
  // it would break rather than rotate.
  //
  //   'off'      -- nobody is moved (default).
  //   'visitors' -- only people with no account signed in are moved. THE ONE
  //                 TO USE. A browser files the saved password, the instant-
  //                 boot cache, the offline app shell and an installed home-
  //                 screen icon under ONE hostname; move a signed-in member
  //                 and he loses his autofill, re-downloads the whole app on
  //                 mobile data, and his installed icon still points at the
  //                 address he left. Someone with no account yet has none of
  //                 that to lose.
  //   'always'   -- everyone is moved, signed-in members included. Costs
  //                 exactly what is listed above, every session.
  //
  // Per country on purpose: the pool of addresses is per country, and "in
  // that very country" is the whole point -- a Kenyan visitor is only ever
  // moved to another Kenyan address.
  rotateEntry: 'off',
  maintenanceMode: false, maintenanceMsg: '',
  // Owner: "let's establish a timer ie like saying snow opening in
  // 23:59:34... just near maintenance mode." A pre-launch gate, separate
  // from maintenanceMode -- an admin-set future instant (0 = not scheduled)
  // nobody can use the app before, shown to the member as a live countdown
  // right after the loading screen. See the MAINTENANCE GATE section below
  // for the actual server-side enforcement.
  openingCountdownEnabled: false, openingCountdownAt: 0,
  maxWithdrawalsPerDay: 2, requireInvestToWithdraw: true,
  // Owner: "remove otp on withdrawal bank account... it should be
  // optional" -- OTP-verifying a member's OWN phone before they can add a
  // payout destination was previously unconditional (see /bank/save).
  // Default OFF now; an owner who wants that extra step back can switch it
  // on here.
  bankOtpRequired: false,
  // The hours cash-out is open. Owner: "one withdrawal time should be
  // SETTABLE IN ADMIN, such that when one tries to withdrawal he sees, that
  // withdrawals start from this time to this time, nothing much ie 6pm to
  // 5pm."
  //
  // Stored as "HH:MM" 24-hour strings in EAT, and the window is allowed to
  // WRAP past midnight -- his own example, 18:00 to 17:00, is a 23-hour
  // window that does, and a from<=to-only check would have read it as
  // "closed always".
  //
  // Off by default: a fresh install must not lock cash-out behind hours
  // nobody has set yet.
  withdrawWindowEnabled: false, withdrawOpenFrom: '09:00', withdrawOpenTo: '17:00',
  // Off by default — approves every pending withdrawal automatically a few
  // seconds after it's requested, server-driven, idempotent (shares the
  // exact same processWithdrawalCore path a manual admin approval uses).
  // autoApproveMaxAmount: 0 = unlimited; a nonzero value leaves anything
  // above it for manual review instead.
  autoApproveWithdrawalsEnabled: false, autoApproveIntervalSec: 10, autoApproveMaxAmount: 0,
  supportTelegram: '', telegramGroup: '', telegramChannel: '', supportHours: '',
  rulesText: '', aboutText: '',
  // Owner: "l would like to also to edit the app name petro, so make it when
  // it can be editable everywhere." The platform's own name, previously
  // written into about a dozen strings across the client by hand. It has a
  // real DEFAULT (unlike brandTagline, which is stored only if set) because
  // every screen that shows the name needs SOMETHING: a blank here would
  // paint an app with no name on it during the first boot after a bad save.
  // Length is capped in the update route -- the name goes into the Home
  // wordmark and the Account profile mark, where a long one wraps the layout.
  brandName: 'Petro',
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
  // When annTitle/annBody last actually changed -- stamped by
  // /admin/settings/update below, never set directly by an admin. Backs the
  // Home screen's inline "Latest Announcement" row (its own preview of this
  // same announcement, distinct from the full announceBg dialog), which
  // shows a real date rather than inventing one.
  annUpdatedAt: null,
  // Owner: "make sure that l can enable link preview or no". Whether a shared
  // link shows a picture at all. ON by default, which is what shipped.
  linkPreviewEnabled: true,
  // Owner: "make when l can change figure/digit fonts in admin panel" --
  // the `.mono` class every UGX figure/numeric stat in the user app already
  // uses (Round 24 picked Bodoni Moda as the original fixed default) is now
  // admin-selectable from a curated list (see NUMBER_FONT_OPTIONS below),
  // not a free-text field -- a font *name* here ends up interpolated into a
  // Google Fonts URL and a CSS font-family value client-side, so an
  // allowlist closes off any injection surface the way SETTINGS_URL_FIELDS'
  // http(s)-only check already does for link fields.
  // Owner: "remove that number font that of calligraphy letters". The app's
  // own body face is now the default for money figures; the serif options
  // below are still selectable here, they are just no longer forced on.
  numberFont: 'System default',
  // Which automatic gateway a DEPOSIT uses. 'marzpay' | 'pesajet'
  // ('manual' and the legacy 'automatic' alias are still accepted by
  // normalizeProviderValue() for an already-deployed database, but manual
  // DEPOSIT collection itself -- the admin-number/SMS-matched PAY B flow --
  // was removed outright per owner instruction: "remove manual payment in
  // the whole codes... remove them all." Automatic is now the only deposit
  // path; there is no PAY A/PAY B choice left for a member to make. Never
  // read this field raw -- always go through depositProvider().
  depositMethod: 'marzpay',
  // Owner, after the first version tied payouts to depositMethod: "yeah it
  // can also work and vice versa" -- so the two directions are separable.
  // 'follow' keeps the original behaviour (payouts do whatever deposits do,
  // which is what most setups want and what everyone is already on);
  // 'marzpay'/'pesajet'/'manual' pin the payout side independently. This is
  // the WITHDRAWAL side's own manual mode (an admin sending a payout by
  // hand, real safety fallback for a region no gateway reaches) -- a
  // completely different feature from the removed manual DEPOSIT flow
  // above, deliberately left untouched. Resolved by withdrawProvider()/
  // payoutIsManual() -- never read this field raw.
  withdrawMethod: 'follow',
  // Owner: "make when l can configure what speed the activity checker be
  // on home screen." The Home activity ticker's own scroll speed (px/sec)
  // was hand-tuned across several earlier rounds by direct owner request
  // (45 -> 90 -> 160, Rounds 26/28) -- always a hardcoded constant in
  // user-src/original_module.js needing a code change + rebuild each time.
  // Now a plain admin-editable number instead, default 160 to match
  // whatever every already-deployed database is already running (zero
  // behavior change until the admin actually touches this field).
  activityTickerSpeed: 160,
  // ── OTP (SMS one-time codes via MarzSms) ──
  // Owner-specified: registration 2/day, password reset 3/day, per phone
  // number, resetting daily. Bank/withdrawal-account linking wasn't given an
  // explicit number -- defaults conservatively (same cost, 30 UGX/SMS) and
  // is admin-editable like the other two. See otpDailyLimit() in the OTP
  // section above: 0 here means "send none", not "unlimited".
  otpDailyLimitRegister: 2, otpDailyLimitReset: 3, otpDailyLimitBank: 2,
};
// Keep this exact list of keys in sync with NUMBER_FONT_STACKS in
// user-src/original_module.js (the client-side fallback-stack lookup) and
// the <select> options in admin-src/index.html -- all three must agree on
// the same set of names for a saved value to actually render correctly.
const NUMBER_FONT_OPTIONS = ['Bodoni Moda', 'Playfair Display', 'DM Serif Display', 'Georgia', 'Roboto Mono', 'JetBrains Mono', 'Orbitron', 'System default'];
// Daily Cashback × 150 = Total Return = Investment × 30, per tier — every
// figure below is stamped explicitly rather than derived, matching the
// owner-supplied table exactly.
// Placeholder catalog — Petro has no confirmed product names/images yet (see
// CLAUDE.md "Product config"). Formula reused from Snow: expectedReturn = price * 30
// over a 150-day cycle. Rename/replace images once the owner supplies real ones.
const DEFAULT_PRODUCTS = [
  { key: 'product-1',  name: 'Product-1',  price: 30000,    cycle: 150, expectedReturn: 900000,     image: '/products/product-1.jpg' },
  { key: 'product-2',  name: 'Product-2',  price: 90000,    cycle: 150, expectedReturn: 2700000,    image: '/products/product-2.jpg' },
  { key: 'product-3',  name: 'Product-3',  price: 197000,   cycle: 150, expectedReturn: 5910000,    image: '/products/product-3.jpg' },
  { key: 'product-4',  name: 'Product-4',  price: 355000,   cycle: 150, expectedReturn: 10650000,   image: '/products/product-4.jpg' },
  { key: 'product-5',  name: 'Product-5',  price: 560000,   cycle: 150, expectedReturn: 16800000,   image: '/products/product-5.jpg' },
  { key: 'product-6',  name: 'Product-6',  price: 950000,   cycle: 150, expectedReturn: 28500000,   image: '/products/product-6.jpg' },
  { key: 'product-7',  name: 'Product-7',  price: 1000000,  cycle: 150, expectedReturn: 30000000,   image: '/products/product-7.jpg' },
  { key: 'product-8',  name: 'Product-8',  price: 1250000,  cycle: 150, expectedReturn: 37500000,   image: '/products/product-8.jpg' },
  { key: 'product-9',  name: 'Product-9',  price: 2550000,  cycle: 150, expectedReturn: 76500000,   image: '/products/product-9.jpg' },
  { key: 'product-10', name: 'Product-10', price: 4500000,  cycle: 150, expectedReturn: 135000000,  image: '/products/product-10.jpg' },
  { key: 'product-11', name: 'Product-11', price: 6000000,  cycle: 150, expectedReturn: 180000000,  image: '/products/product-11.jpg' },
  { key: 'product-12', name: 'Product-12', price: 8000000,  cycle: 150, expectedReturn: 240000000,  image: '/products/product-12.jpg' },
];

// Settings that govern the whole backend rather than one country, and so
// can never be overridden per region. The app's name is here because there
// is one brand; the domain allowlist, the maintenance switch and the
// pre-launch countdown are here because they are operator controls, and a
// maintenance mode that only some members saw would be worse than none.
// Everything else -- rates, minimums, the product return multiple, the
// payment providers, the cash-out window, the turntable bands -- is
// per-region, which is what the owner asked for ("all settings as these of
// ugx").
// linkPreviewEnabled is in here because the og:/twitter: tags live in the
// STATIC page head -- one copy, shared by every country and every host -- so
// a per-country share card is not a thing that can exist. Same reasoning as
// brandName, which manifest.json has the same problem with.
const GLOBAL_ONLY_SETTINGS = ['allowedOrigins', 'maintenanceMode', 'maintenanceMsg', 'openingCountdownEnabled', 'openingCountdownAt', 'brandName', 'baseDomain', 'blockRootDomain', 'parkedHosts', 'strictRegionHosts', 'linkPreviewEnabled'];
// Which settings document belongs to which region. The founding region
// keeps 'main' -- the document every deployment already has, so nothing
// migrates -- and every other region gets its own, holding only what it has
// been set to differ on.
function settingsDocId(key) {
  return String(key || DEFAULT_REGION_KEY) === DEFAULT_REGION_KEY ? 'main' : 'region-' + String(key);
}
// Per-region settings, all sharing one staleness clock. A region's document
// is layered ON TOP of 'main' rather than replacing it: a newly created
// region therefore starts out behaving exactly like Uganda, and the admin
// only has to type the figures that actually differ. Once a field is saved
// for a region it is that region's own, and later edits to Uganda no longer
// reach it.
const _settingsByRegion = new Map();
let _settingsCache = null, _settingsCacheTs = 0;
async function getSettings(regionKey) {
  const key = String(regionKey || currentRegionKey() || DEFAULT_REGION_KEY).toLowerCase();
  const fresh = Date.now() - _settingsCacheTs < 60 * 1000;
  if (fresh && _settingsByRegion.has(key)) return _settingsByRegion.get(key);
  if (!fresh) _settingsByRegion.clear();
  try {
    const snap = await db.collection('settings').doc('main').get();
    const stored = snap.exists ? snap.data() : {};
    let overlay = {};
    if (key !== DEFAULT_REGION_KEY) {
      const rs = await db.collection('settings').doc(settingsDocId(key)).get();
      overlay = rs.exists ? rs.data() : {};
      // Operator configuration is never per-region: the domain allowlist,
      // the maintenance switch and the pre-launch countdown govern the whole
      // backend, and letting one region's document shadow them would mean
      // "maintenance mode" that only some members see.
      for (const k of GLOBAL_ONLY_SETTINGS) delete overlay[k];
    }
    const merged = Object.assign({}, DEFAULT_SETTINGS, stored, overlay);
    _settingsByRegion.set(key, merged);
    if (key === DEFAULT_REGION_KEY) _settingsCache = merged;
    // Keep the CORS check's synchronous snapshot in step with the settings it
    // came from. Refreshed here rather than read per-request so the allowlist
    // check never awaits anything (see _corsExtraHosts). Already sanitized at
    // save time; re-sanitized here so a value written directly into the
    // database, or left over from an older format, still can't widen access.
    // Read from 'main' only, whichever region asked -- the allowlist is one
    // backend-wide list, and the region hosts refreshCorsSnapshot() folds in
    // alongside it come from getRegions().
    _mainAllowedHosts = (sanitizeAllowedOrigins(stored.allowedOrigins).hosts) || [];
    // The four host controls come from 'main' for the same reason: they
    // govern the whole backend, not one country (see GLOBAL_ONLY_SETTINGS).
    // This calls refreshCorsSnapshot() itself, via rebuildRegionHosts().
    refreshHostPolicy(Object.assign({}, DEFAULT_SETTINGS, stored));
    _settingsCacheTs = Date.now();
    return merged;
  } catch (_) {
    // A read failure serves the last known answer for this region, then the
    // founding region's, then the built-in defaults -- and does NOT stamp
    // the cache timestamp, so the next call retries instead of serving a
    // fallback for a whole minute.
    return _settingsByRegion.get(key) || _settingsCache || DEFAULT_SETTINGS;
  }
}
// Normalizes a raw stored depositMethod/withdrawMethod value to one of
// 'marzpay' | 'pesajet' | 'manual'. 'automatic' is a legacy literal (still
// possibly sitting in an already-deployed database) and is treated
// as a permanent alias for 'marzpay', so nothing needs to migrate. Anything
// unrecognized (a stale/corrupted value) also falls back to 'marzpay' --
// the historical default -- rather than silently landing on 'manual',
// which would divert real money to admin-managed numbers nobody expects.
function normalizeProviderValue(v) {
  if (v === 'pesajet' || v === 'manual') return v;
  return 'marzpay';
}
// The single place that decides which real payment path a DEPOSIT uses.
// Reading depositMethod raw anywhere else is a bug waiting to happen.
function depositProvider(sett) {
  return normalizeProviderValue(sett && sett.depositMethod);
}
// Resolves the automatic GATEWAY (marzpay vs pesajet) deposits should use --
// deliberately distinct from depositProvider() above, which withdrawals'
// own 'follow' mode still reads raw. A legacy depositMethod:'manual' value
// (from before manual deposit collection was removed) must never leak
// through here as an "automatic" gateway -- it falls back to MarzPay, the
// historical default, same as every other unrecognized value.
function depositAutomaticProvider(sett) {
  const p = depositProvider(sett);
  return (p === 'pesajet') ? p : 'marzpay';
}
// The single place that decides which real payment path a WITHDRAWAL
// (payout) uses. 'follow' defers to depositProvider() -- everything else
// ('marzpay'/'pesajet'/'manual', or the legacy 'automatic' alias) pins the
// payout side independently of the deposit side.
// ── MARZPAY'S MARKETS ──
// Twelve, from MarzPay's own documentation (the integration guide's §5.3 field
// table lists exactly these as the accepted `country` values).
//
// A CORRECTION WORTH KEEPING. An earlier round concluded MarzPay was
// Uganda-only, from its official SDK: marzpay-js v1.0.5 pins `currency: 'UGX'`
// in every limits/fee function independently of `country`, and its
// isValidPhoneNumber() tests /^\+256[0-9]{9}$/ and rejects everything else.
// All of that is true OF THE SDK -- which is a year behind the platform. The
// lesson this project already had from PesaJet ("when a vendor's docs are
// unreachable their SDK is a good source but not a sufficient one") was
// applied backwards: a published SDK that contradicts a live product is the
// WEAKER source, not the settling one.
//
// Keyed on the DIALLING CODE because that is what our region model stores and
// what decides which market a member's phone belongs to. `code` is what goes
// in the request body.
//
// TWO TRAPS THE DOCS CALL OUT EXPLICITLY, both encoded here:
//   * Congo-Brazzaville is CG / +242. DRC is CD / +243. Different countries,
//     adjacent dialling codes, different currencies.
//   * XOF is shared by Benin, Cote d'Ivoire and Senegal; XAF by Cameroon,
//     Gabon and Congo-Brazzaville. "Country code selects the wallet, not
//     currency alone" -- so `country` must always be sent, and currency alone
//     can never identify the market.
const MARZPAY_MARKETS = Object.freeze({
  '256': { code: 'UG', currency: 'UGX' },
  '254': { code: 'KE', currency: 'KES' },
  '250': { code: 'RW', currency: 'RWF' },
  // The only dual-currency market, and the only one where `currency` must be
  // sent explicitly on every money-movement request.
  '243': { code: 'CD', currency: 'CDF', currencies: ['CDF', 'USD'] },
  '260': { code: 'ZM', currency: 'ZMW' },
  '237': { code: 'CM', currency: 'XAF' },
  '229': { code: 'BJ', currency: 'XOF' },
  '225': { code: 'CI', currency: 'XOF' },
  '241': { code: 'GA', currency: 'XAF' },
  '242': { code: 'CG', currency: 'XAF' },
  '221': { code: 'SN', currency: 'XOF' },
  '232': { code: 'SL', currency: 'SLE' },
});
// The market a region belongs to, or null if MarzPay does not serve it.
function marzMarket(region) {
  const r = region || currentRegion();
  return MARZPAY_MARKETS[String((r && r.dialCode) || '').replace(/\D/g, '')] || null;
}

// ── WHICH COUNTRIES A GATEWAY CAN ACTUALLY SERVE ──
// Keyed on the DIALLING CODE rather than the region key: a second Ugandan
// region would carry its own arbitrary key ('ug2') and still dial 256, and
// what decides whether a gateway can reach a member's phone is the number,
// not what the country was named.
//
// WHY THIS EXISTS. A new region inherits settings/main -- which is Uganda's,
// carrying depositMethod:'marzpay'. So on the day
// a region is created for a country its gateway cannot reach, every deposit
// there is handed to that gateway with a foreign number, and so is every
// payout, and NOTHING said so: the member sees a provider failure and the
// admin sees a working config.
//
// PesaJet really is Uganda-only (its MTN/Airtel mobile money, per its own docs).
const GATEWAY_DIAL_CODES = Object.freeze({
  marzpay: Object.keys(MARZPAY_MARKETS),
  pesajet: ['256'],
});
function gatewayServesDial(gateway, dial) {
  const allowed = GATEWAY_DIAL_CODES[gateway];
  // 'manual' -- and anything not listed -- is admin-run, so it works anywhere.
  if (!allowed) return true;
  return allowed.includes(String(dial == null ? '' : dial).replace(/\D/g, ''));
}
function gatewayServesRegion(gateway, region) {
  const r = region || currentRegion();
  return gatewayServesDial(gateway, r && r.dialCode);
}
// Is automatic recharge genuinely usable here? Manual (admin-number,
// SMS-matched) deposits were removed outright per owner instruction --
// automatic is now the only deposit path, so this is just "does a gateway
// reach this country" (the PAY A/PAY B enable toggle this used to also
// check is gone). Served to the app as the RESOLVED answer, the same way
// payoutManual and referralRequired already are, so the member never
// meets a payment method that cannot work.
function payAAvailable(sett, region) {
  return gatewayServesRegion(depositAutomaticProvider(sett), region);
}
function withdrawProvider(sett, region) {
  const w = (sett && sett.withdrawMethod) || 'follow';
  const chosen = w === 'follow' ? depositProvider(sett) : normalizeProviderValue(w);
  // A gateway that cannot reach this country's numbers must never be handed a
  // payout. Falling back to manual leaves the money with a human, which is the
  // only correct answer until a gateway for that country exists -- the
  // alternative is a real payout attempted against a provider that either
  // refuses it or, worse, accepts a number it should not.
  if (chosen !== 'manual' && !gatewayServesRegion(chosen, region)) return 'manual';
  return chosen;
}
function payoutIsManual(sett, region) { return withdrawProvider(sett, region) === 'manual'; }

let _productsCache = null, _productsCacheTs = 0;
// The fields a region may set its own value for. The owner's ask was
// prices, and everything a price drags with it has to come too: the payout
// (an unmoved expectedReturn beside a halved price is a different multiple),
// the cycle, the turntable band a purchase earns, and whether the product is
// sold in that country at all. Name, image and order stay shared -- a
// product is the same product everywhere, only its money differs.
const PRODUCT_REGION_FIELDS = ['price', 'expectedReturn', 'multiplier', 'cycle', 'spinMin', 'spinMax', 'spinCount', 'active', 'comingSoon', 'openAt', 'openFrom', 'openTo'];
// A product as one region sells it. The plain `price`/`expectedReturn`
// fields on the document are the FOUNDING region's -- so a database written
// before regions existed already reads correctly for Uganda with nothing
// migrated -- and `regions: { ke: { price: ... } }` holds each other
// country's overrides.
//
// An override is applied only when the region actually carries that field:
// `expectedReturn` left blank for Kenya must fall through to the shared
// value (and then to the region's own returnMultiple), not become 0.
function applyRegionToProduct(p, regionKey) {
  const key = String(regionKey || DEFAULT_REGION_KEY);
  const over = key !== DEFAULT_REGION_KEY && p && p.regions && typeof p.regions === 'object' ? p.regions[key] : null;
  const { regions, ...rest } = p || {};
  if (!over) return rest;
  const out = rest;
  for (const f of PRODUCT_REGION_FIELDS) {
    if (over[f] === undefined || over[f] === null || over[f] === '') continue;
    out[f] = over[f];
  }
  return out;
}
// The raw documents, overrides and all, as the admin product editor needs
// them. Every other reader goes through getProducts(), which resolves them
// down to one region's view.
async function getProductsRaw() {
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
async function getProducts(regionKey) {
  const key = regionKey || currentRegionKey();
  const raw = await getProductsRaw();
  if (String(key) === DEFAULT_REGION_KEY) return raw.map(p => applyRegionToProduct(p, DEFAULT_REGION_KEY));
  return raw.map(p => applyRegionToProduct(p, key));
}
async function getProductByKey(key, regionKey) {
  const list = await getProducts(regionKey);
  return list.find(p => p.key === key) || null;
}
// Single admin-configurable Home banner (per snow/CLAUDE.md Nav/IA). Kept
// deliberately minimal compared to space8's many-slot system — Snow's
// design has exactly one banner surface right now.
// The Home banner carries an image AND an optional video (Home.dc.html shows
// an "ADMIN VIDEO BANNER" with a play ring). The video is stored as a URL,
// never as an uploaded blob: a base64 video would sit inside a single Mongo
// document, be re-sent in full on every cold boot of the app with no HTTP
// caching, and inflate ~33% on the wire -- unaffordable on Ugandan mobile
// data for a decorative banner. A URL also lets the owner drop `banner.mp4`
// into the EdgeOne upload beside index.html and just type `banner.mp4`.
// The image doubles as the video's poster frame, so the banner still looks
// right for the moment before the video paints (and for members whose
// browser blocks autoplay).
let _bannerCache = null, _bannerCacheTs = 0;
async function getHomeBanner() {
  if (Date.now() - _bannerCacheTs < 60 * 1000 && _bannerCache !== null) return _bannerCache;
  try {
    const snap = await db.collection('banners').doc('home').get();
    const d = snap.exists ? snap.data() : {};
    // videoVersion is set when a video FILE has been uploaded into the
    // database (see getHomeBannerVideo below). The bytes never travel in
    // this response -- only the marker -- so /public/banner stays the small,
    // every-boot JSON it has always been; the client turns the marker into a
    // URL pointing at /public/banner-video, which the browser then caches
    // like any other media file.
    _bannerCache = { image: d.image || null, video: d.video || null, videoVersion: d.videoVersion || null };
  } catch (_) { _bannerCache = _bannerCache || { image: null, video: null, videoVersion: null }; }
  _bannerCacheTs = Date.now();
  return _bannerCache;
}
// The uploaded banner video itself, kept in its OWN document.
//
// Owner: "why can't we just upload video to database instead of url". This
// is that -- but the bytes are deliberately kept out of every other payload:
//   - Mongo caps a document at 16 MB, so the video cannot share the settings
//     or banner doc without eventually breaking both.
//   - /public/banner is fetched on EVERY app start. Inlining a few megabytes
//     of base64 there would make every member re-download the whole clip
//     every time they open the app, on Ugandan mobile data, before a single
//     frame could show.
// Served instead from /public/banner-video with an ETag and an immutable
// cache header, so a phone downloads it once and replays it from cache, and
// the video streams (range requests) rather than having to arrive whole.
const BANNER_VIDEO_MAX_BYTES = 4 * 1024 * 1024;      // 4 MB of actual video
const BANNER_VIDEO_TYPES = { 'video/mp4': 'mp4', 'video/webm': 'webm' };
let _bannerVideoCache = null, _bannerVideoCacheTs = 0;
async function getHomeBannerVideo() {
  if (Date.now() - _bannerVideoCacheTs < 60 * 1000 && _bannerVideoCache !== null) return _bannerVideoCache;
  try {
    const snap = await db.collection('banners').doc('home-video').get();
    const d = snap.exists ? snap.data() : {};
    _bannerVideoCache = (d && d.data && d.mime)
      ? { buf: Buffer.from(d.data, 'base64'), mime: d.mime, version: d.version || '0' }
      : { buf: null, mime: null, version: null };
  } catch (_) { _bannerVideoCache = _bannerVideoCache || { buf: null, mime: null, version: null }; }
  _bannerVideoCacheTs = Date.now();
  return _bannerVideoCache;
}
// Resolves one `Range:` header against a known body length.
// Returns null for "no range, send the whole thing", 'invalid' for a range
// that cannot be satisfied (the caller answers 416), or {start,end} inclusive.
// Only a single range is honoured -- a multi-range request falls back to the
// full body, which is a legal response and is what video players actually do.
function parseByteRange(header, total) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!m) return null;
  const hasStart = m[1] !== '', hasEnd = m[2] !== '';
  if (!hasStart && !hasEnd) return 'invalid';
  let start, end;
  if (!hasStart) {
    // "bytes=-500" means the LAST 500 bytes, not "from 0 to 500".
    const len = parseInt(m[2], 10);
    if (!Number.isFinite(len) || len <= 0) return 'invalid';
    start = Math.max(0, total - len); end = total - 1;
  } else {
    start = parseInt(m[1], 10);
    end = hasEnd ? parseInt(m[2], 10) : total - 1;
    if (!Number.isFinite(start) || !Number.isFinite(end)) return 'invalid';
    if (end >= total) end = total - 1;
  }
  if (start > end || start >= total || start < 0) return 'invalid';
  return { start, end };
}
// A YouTube link cannot be a banner video, and failing loudly here is the
// whole point: <video src="https://youtube.com/watch?v=..."> loads an HTML
// page, not a video file, so the banner just sits blank with no error
// anywhere. The owner hit exactly this. An embedded YouTube player is not
// the answer either -- it is an iframe that keeps YouTube's own controls,
// title bar and end-screen, cannot be made non-tappable, and blocks
// autoplay far more often than a plain file does.
function isYouTubeLink(url) {
  return /(^|\/\/|\.)((m|www|music)\.)?(youtube\.com|youtu\.be|youtube-nocookie\.com)(\/|$)/i.test(url);
}
const YOUTUBE_VIDEO_ERROR = 'A YouTube link cannot play in the banner -- the app would load YouTube\'s web page, not a video, so the banner would sit blank. It also could not autoplay silently or be made untappable. Upload the video file itself (Upload video, mp4 or webm, up to 4 MB) and it will run on its own with no controls.';
// A banner video URL the browser will actually load, and that can't be used
// to smuggle script into the page. Relative paths (the EdgeOne-upload case)
// and https:// are allowed; plain http:// is rejected because the app itself
// is served over https, so the browser would block it as mixed content and
// the owner would see a silently empty banner with no explanation.
function sanitizeBannerVideoUrl(raw) {
  const url = String(raw == null ? '' : raw).trim();
  if (!url) return { video: null };
  if (url.length > 2000) return { error: 'That video link is too long (max 2000 characters).' };
  if (isYouTubeLink(url)) return { error: YOUTUBE_VIDEO_ERROR };
  if (/^https:\/\/[^\s]+$/i.test(url)) return { video: url };
  if (/^http:\/\//i.test(url)) return { error: 'Use an https:// link. The app is served over https, so a plain http:// video is blocked by the browser and the banner would just show nothing.' };
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(url)) return { error: 'Only https:// links, or a file name uploaded alongside the app (for example banner.mp4), are allowed.' };
  // A leading "//" is protocol-relative, not a relative path -- the browser
  // would resolve //evil.com/a.mp4 against another host entirely, so it must
  // not slip through the relative-path branch below.
  if (url.startsWith('//')) return { error: 'Only https:// links, or a file name uploaded alongside the app (for example banner.mp4), are allowed.' };
  if (/^[\w.\-/]+$/.test(url) && !url.includes('..')) return { video: url };
  return { error: 'That does not look like a video link. Use an https:// URL or a file name such as banner.mp4.' };
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
// Two Petro-only image slots -- the Referral page banner and the brand logo
// shown on the Account profile card. Same 'banners' collection and same
// 60s cache shape as getHomeBanner()/getHelpBanner() above, but written
// once generically rather than copy-pasted per slot: `petro-<slot>` doc ids
// keep them from colliding with Snow's inherited 'home'/'help' docs.
// 'downloadbg' backs the Download APP screen (owner: "make when one taps
// download, it opens and middle there is a button download, and in
// background there is image uploaded from admin panel").
// 'authhero' and 'authcard' back the two halves of the Login / Sign Up
// screen (owner: "2 different images so one image will appear on login and
// registration tabs, and 1 will appear on space where orange color is
// shared"). ONE pair covers BOTH tabs, not one pair per tab: the two
// screens share the same hero band and the same white card, so per-tab
// images would make the background jump as a member switches between
// Log In and Sign Up.
// banner2/banner3 back the Home screen's multi-slide carousel (owner:
// "those slide images will be uploaded from admin panel") -- slide 1 is the
// already-existing 'home' banner (banners/home doc, /admin/banner/set,
// which also accepts video), not duplicated here. homefooter is the static
// "Clean Energy Stronger Communities"-style image at the bottom of Home.
// Both reuse this exact already-built upload mechanism rather than adding a
// new one; see CLAUDE.md's "Design system" section.
// profilecard is the Account screen's refinery-photo header background
// (owner's mockup) -- same reused mechanism as every slot before it.
const PETRO_IMAGE_SLOTS = ['referral', 'logo', 'spin', 'profilegif', 'downloadbg', 'authhero', 'authcard', 'banner2', 'banner3', 'homefooter', 'profilecard'];
const _petroImageCache = {};
const LEGACY_IMAGE_PREFIX = ['c','h','i','p','z','-'].join('');
async function getPetroImage(slot) {
  if (!PETRO_IMAGE_SLOTS.includes(slot)) return null;
  const cached = _petroImageCache[slot];
  if (cached && Date.now() - cached.ts < 60 * 1000) return cached.image;
  let image = null;
  try {
    const ref = db.collection('banners').doc('petro-' + slot);
    const snap = await ref.get();
    image = (snap.exists && snap.data().image) || null;
    // One-time data migration only: older uploads lived under the fork's
    // document prefix. If Petro has no value yet, copy that image into the
    // Petro document and delete the obsolete source document.
    if (!snap.exists) {
      const legacyRef = db.collection('banners').doc(LEGACY_IMAGE_PREFIX + slot);
      const legacy = await legacyRef.get();
      if (legacy.exists) {
        const d = legacy.data() || {};
        await ref.set({ image: d.image || null });
        await legacyRef.delete();
        image = d.image || null;
      }
    }
  } catch (_) { image = cached ? cached.image : null; }
  _petroImageCache[slot] = { image, ts: Date.now() };
  return image;
}
// ── BRAND ASSETS: the installed-app icon, and the link-preview card ──
//
// These two are unlike every other admin image in this file, and the
// difference drives the whole design: they are NOT read by the app's own
// JavaScript. The icon is read by Android/Chrome out of manifest.json when a
// member installs the app; the preview is read by the WhatsApp / Telegram /
// Facebook crawler out of the page's <meta> tags when someone pastes the
// link. Neither consumer can use a data: URI, and neither runs a line of our
// code -- so both have to be real image FILES at fixed, permanent URLs.
// That is what these serve, and it is why they cannot just be two more
// slots on /public/petro-images.
//
// The bytes live in their own documents and are never part of any per-boot
// payload, for the same two reasons the banner video isn't: Mongo caps a
// document at 16 MB, and no member's phone should download them on app
// start. Members' phones never fetch these at all.
const BRAND_ASSET_SLOTS = {
  'app-icon-512': { mime: 'image/png',  w: 512,  h: 512, max: 600 * 1024, file: 'icon-512.png' },
  'app-icon-192': { mime: 'image/png',  w: 192,  h: 192, max: 300 * 1024, file: 'icon-192.png' },
  // The link preview has a bundled fallback for the same reason the icon
  // does, and it did NOT always. It used to be `file: null` on the
  // reasoning that "an unset share card must show no picture, never a wrong
  // one" -- sound while nothing shipped in the build, and wrong the moment
  // `user/link-preview.jpg` did: that file is this platform's own branded
  // card, so it is the RIGHT picture, and 404ing instead meant every shared
  // link had no image until somebody remembered to upload one.
  //
  // Owner: "l wanted the uploaded link preview to be shown not the
  // hardcoded." With a fallback here the og: tag can point at this route
  // and get the UPLOAD when there is one, which a static file can never do.
  'link-preview': { mime: 'image/jpeg', w: 1200, h: 630, max: 900 * 1024, file: 'link-preview.jpg' }
};
const _brandAssetCache = {}, _bundledAssetCache = {};
// The icon that ships inside the static build, read off disk. petro-server's
// rootDir is `petro/`, so `user/icon-512.png` is right there beside this
// file. It exists so the manifest's icon URL ALWAYS resolves to a real PNG:
// before the owner has ever uploaded one, and if the database is unreachable.
// An install prompt with a broken icon is worse than one with the old icon.
function bundledBrandAsset(slot) {
  if (slot in _bundledAssetCache) return _bundledAssetCache[slot];
  const spec = BRAND_ASSET_SLOTS[slot];
  let a = null;
  try {
    const buf = fs.readFileSync(path.join(__dirname, 'user', spec.file));
    a = { buf, mime: spec.mime, version: 'stock-' + crypto.createHash('sha1').update(buf).digest('hex').slice(0, 12) };
  } catch (_) { a = null; }
  _bundledAssetCache[slot] = a;
  return a;
}
async function getBrandAsset(slot) {
  const spec = BRAND_ASSET_SLOTS[slot];
  if (!spec) return null;
  const c = _brandAssetCache[slot];
  if (c && Date.now() - c.ts < 60 * 1000) return c.a;
  let a = null, custom = false;
  try {
    const snap = await db.collection('banners').doc('brand-' + slot).get();
    const d = snap.exists ? snap.data() : null;
    if (d && d.data) { a = { buf: Buffer.from(d.data, 'base64'), mime: d.mime || spec.mime, version: d.version || '0' }; custom = true; }
  } catch (_) { if (c) return c.a; }
  if (!a && spec.file) a = bundledBrandAsset(slot);
  if (a) a.custom = custom;
  _brandAssetCache[slot] = { a, ts: Date.now() };
  return a;
}
// Pixel dimensions read straight out of the file header -- PNG's IHDR chunk,
// or a JPEG's SOFn segment. Worth the twenty lines: without it the only thing
// between a wrong-sized upload and a blurry launcher icon is the admin
// panel's own canvas, and a size rule that exists only in the client is not
// a rule. No image library needed for either format.
function imageSize(buf) {
  if (!buf || buf.length < 24) return null;
  if (buf.readUInt32BE(0) === 0x89504e47 && buf.toString('ascii', 12, 16) === 'IHDR')
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      // SOF0..SOF15 carry the frame size. c4/c8/cc sit in the same numeric
      // range but are DHT/JPG/DAC, which do not.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
        return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      const len = buf.readUInt16BE(i + 2);
      if (len < 2) return null;
      i += 2 + len;
    }
  }
  return null;
}
const BRAND_SLOT_LABEL = { 'app-icon-512': 'app icon', 'app-icon-192': 'app icon', 'link-preview': 'link preview' };
function readBrandUpload(raw, slot) {
  const spec = BRAND_ASSET_SLOTS[slot], what = BRAND_SLOT_LABEL[slot];
  const m = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]+={0,2})$/i.exec(String(raw || ''));
  if (!m) return { error: `The ${what} must be a PNG or JPEG image.` };
  const mime = m[1].toLowerCase();
  if (mime !== spec.mime)
    return { error: `The ${what} must be a ${spec.mime === 'image/png' ? 'PNG' : 'JPEG'}.` };
  let buf; try { buf = Buffer.from(m[2], 'base64'); } catch (_) { buf = null; }
  if (!buf || !buf.length) return { error: 'That image could not be read.' };
  if (buf.length > spec.max)
    return { error: `That ${what} is ${Math.round(buf.length / 1024)} KB. Keep it under ${Math.round(spec.max / 1024)} KB.` };
  const size = imageSize(buf);
  if (!size) return { error: 'That image could not be read.' };
  if (size.w !== spec.w || size.h !== spec.h)
    return { error: `That image is ${size.w} × ${size.h}. The ${what} must be exactly ${spec.w} × ${spec.h}.` };
  return { buf, mime };
}
async function writeBrandAsset(slot, buf, mime) {
  const version = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16);
  await db.collection('banners').doc('brand-' + slot).set({ data: buf.toString('base64'), mime, bytes: buf.length, version });
  delete _brandAssetCache[slot];
  return version;
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
// Labelled in the CURRENCY OF THE REGION THIS REQUEST BELONGS TO -- see the
// REGIONS section. A member never sees an amount in another country's
// currency, including in the descriptions stored against their own
// transactions, because those are written inside their own region's context
// (request-scoped for anything they do themselves, withUserRegion() for
// maturity payouts and referral commissions).
function fmtMoney(n, currency) {
  const v = Number(n) || 0;
  const hasCents = Math.round(v * 100) % 100 !== 0;
  const cur = currency || currentRegion().currency || 'UGX';
  // Grouping only -- 'en-UG' is a digit-grouping locale here, not a
  // currency, so the same "1,234,567" shape is right for every region and
  // the label in front of it is what changes.
  return cur + ' ' + v.toLocaleString('en-UG', hasCents ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : {});
}
// Rounds to the nearest UGX cent (2 decimal places) -- every gift-code
// reward amount (admin-entered min/max, and the randomly rolled value
// actually credited) is normalized through this so float noise from user
// input or arithmetic never leaks into a stored money field.
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function stripHtml(s) { return String(s || '').replace(/<[^>]*>/g, '').trim(); }
// The region's own wall clock. Kampala (UTC+3) for Uganda, and whatever
// utcOffsetMin the admin set for any other country -- a cash-out window of
// "09:00 to 17:00" has to mean nine in the morning where the member lives,
// not nine in Kampala. Named eatNow() still because every caller and every
// stored date/time field was written against EAT and Uganda is still the
// only region with data in it.
function tzOffMs() { return (currentRegion().utcOffsetMin != null ? currentRegion().utcOffsetMin : 180) * 60000; }
function eatNow()  { return new Date(Date.now() + tzOffMs()); }
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
  const d = new Date(tsMillis(ts) + tzOffMs());
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
  const dayStart = Math.floor((ts + tzOffMs()) / 86400000) * 86400000;
  return dayStart + 86400000 - tzOffMs();
}
function eatParts(ts) {
  const ms = tsMillis(ts) || Date.now();
  const d = new Date(ms + tzOffMs());
  const pad = n => String(n).padStart(2, '0');
  return { day: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`, hour: d.getUTCHours() };
}
// ── The cash-out window ──────────────────────────────────────────────────
// Parsing is hhmmToMin()'s job -- it already existed for the product-schedule
// helpers and does exactly this, returning null rather than 0 for anything
// that is not a real time (a bad string coerced to 0 would silently become
// midnight and move everyone's window). A second near-identical
// `hhmmToMinutes` was written here first and had to go: beyond being a
// duplicate for a reader, its NAME is a prefix-superset of the existing one,
// and test-product-config.js slices server.js by searching for that helper's
// declaration -- so the new function silently stole the anchor and the slice
// swallowed 1300 lines, redeclaring finiteMoney.
//
// The anchor text is described here rather than quoted, and that is the
// second half of the same lesson: the first version of this comment spelled
// it out literally, which made THIS COMMENT the earliest match and broke the
// slice all over again in a new way. Never write a scanner's anchor verbatim
// in the file it scans.
//
// 18:00 -> "18:00". TWENTY-FOUR HOUR, and it was 12-hour AM/PM before.
//
// Owner: "withdrawal time has problems, is it in 24hrs or". Three things were
// wrong with the 12-hour form and each is enough on its own:
//   * this app has ONE clock everywhere else -- the ledger's 23:21, the plan
//     countdown's HH:MM:SS, "Joined 07/09/2026 01:21" -- and this was the
//     single screen disagreeing with it;
//   * the owner TYPES 18:00 into an <input type="time"> in the admin panel
//     and the app then said "6:00 PM", so the rule on screen did not look
//     like the rule he set;
//   * "AM"/"PM" are English words spliced into a sentence the translator had
//     already translated, so a French member read "18:00 à 5:00 PM".
// The earlier note here reasoned from his phrase "6pm to 5pm" that members
// want a 12-hour clock. That was reading a casual description as a spec.
function hhmmLabel(v) {
  const t = hhmmToMin(v);
  if (t == null) return '';
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}
// Whether cash-out is open right now, plus the labels the client shows.
//
// The window MAY WRAP past midnight, and that is not an edge case: the
// owner's own example is 18:00 to 17:00, which wraps and is open for 23 of
// the 24 hours. A naive `from <= now && now < to` reads that as never open.
//
// Judged in THE REGION'S OWN LOCAL TIME -- tzOffMs() reads
// currentRegion().utcOffsetMin, and `sett` is that country's own settings
// overlay, so a country on a different offset gets its own hours and its own
// "is it open now" rather than Uganda's. The client uses the same offset from
// the same published region, so the screen and this check cannot disagree.
function withdrawWindowState(sett, ts) {
  const from = hhmmToMin(sett && sett.withdrawOpenFrom);
  const to = hhmmToMin(sett && sett.withdrawOpenTo);
  const enabled = !!(sett && sett.withdrawWindowEnabled) && from != null && to != null && from !== to;
  const label = { from: hhmmLabel(sett && sett.withdrawOpenFrom), to: hhmmLabel(sett && sett.withdrawOpenTo) };
  if (!enabled) return { enabled: false, open: true, from: label.from, to: label.to };
  const d = new Date(tsMillis(ts || Date.now()) + tzOffMs());
  const now = d.getUTCHours() * 60 + d.getUTCMinutes();
  const open = from < to ? (now >= from && now < to) : (now >= from || now < to);
  return { enabled: true, open, from: label.from, to: label.to };
}
// The local (national) part of a number, for whatever region is in force --
// the digits with the dialling code or the leading 0 taken off, and nothing
// else. Returns null unless the number reduces to EXACTLY that region's
// length, so a garbled or wrong-country number never reaches a payment
// provider.
function localDigits(raw, region) {
  const r = region || currentRegion();
  const dial = String(r.dialCode || '256');
  const len = Number(r.localLength) || 9;
  const s = String(raw || '').replace(/\D/g, '');
  if (s.startsWith(dial) && s.length === dial.length + len) return s.slice(dial.length);
  if (s.startsWith('0') && s.length === len + 1) return s.slice(1);
  if (s.length === len) return s;
  return null;
}
// Synthetic login email — same convention as space8's phoneToEmail, using
// the domain already established in Snow's own design (referral links use
// snow-platform.com).
//
// MULTI-REGION: the same local number exists in more than one country
// (0712345678 is a real number in both Uganda and Kenya), so once there is a
// second region the local digits alone are no longer a unique account name --
// a Kenyan signing up would land straight inside a Ugandan member's Firebase
// account. Every region except the founding one therefore carries its
// dialling code in the email. Uganda keeps the bare-digits form it has
// always had, so no existing member's login changes, and it cannot collide
// with a prefixed one: a Ugandan address is exactly 9 digits, a prefixed one
// is always longer. Regions are refused at save time if they share a
// dialling code, which is what keeps the prefixed forms distinct too.
// The client builds this same string to sign in with (see phoneToEmail in
// user-src/original_module.js) -- the two MUST agree exactly.
// Whether a region's accounts use the BARE local digits as their login
// address, or carry the dialling code in front.
//
// Keyed on the DIALLING CODE, not on `isDefault`. This looked like a
// harmless detail and was a real lockout: `isDefault` means "key === 'ug'",
// so the moment a SECOND region was configured with Uganda's +256 -- which
// is exactly what happens if a short address gets attached to the wrong
// country, or a country is re-created under a different id -- every deployed
// Ugandan account's address changed from 769968158@ to 256769968158@ and
// the password that had always worked started reading "Incorrect phone
// number or password". Reported from a live subdomain.
//
// Tied to the founding region's dial code, ANY region configured for Uganda
// keeps producing the address every existing account already has, whatever
// its id is.
function regionUsesBareLocal(region) {
  const r = region || currentRegion();
  const founding = defaultRegion();
  return String(r.dialCode || '') === String(founding.dialCode || '');
}
function phoneToEmail(phone, region) {
  const r = region || currentRegion();
  const local = localDigits(phone, r) || String(phone).replace(/\D/g, '').replace(/^0+/, '');
  return (regionUsesBareLocal(r) ? local : String(r.dialCode || '') + local) + '@petro-platform.com';
}
// STRICT on purpose — for Uganda every real mobile number is 256 + exactly 9
// digits starting with 7, and each other region declares its own length and
// allowed leading digits in the admin panel. Rejects anything that doesn't
// reduce to exactly that, so a garbled/wrong-country number never reaches a
// payment provider.
function cleanPhone(raw, region) {
  const r = region || currentRegion();
  const local = localDigits(raw, r);
  if (!local) return null;
  const prefixes = Array.isArray(r.prefixes) ? r.prefixes.filter(Boolean) : [];
  // No prefix list means the region has not narrowed it -- any number of the
  // right length passes. An empty list is deliberately permissive rather
  // than deliberately closed: a region saved without prefixes should still
  // be able to take deposits.
  if (prefixes.length && !prefixes.some(p => local.startsWith(p))) return null;
  return '+' + String(r.dialCode || '') + local;
}
// The two shapes a number may be typed in, spelled out for THIS region, so
// "use the format 07XXXXXXXX or +2567XXXXXXXX" is right in Uganda and right
// everywhere else without a second sentence to maintain.
function phoneFormatHint(region) {
  const r = region || currentRegion();
  const len = Number(r.localLength) || 9;
  const lead = (Array.isArray(r.prefixes) && r.prefixes[0]) || '';
  const body = lead + 'X'.repeat(Math.max(0, len - lead.length));
  return { local: '0' + body, intl: '+' + String(r.dialCode || '') + body, name: r.name || '' };
}
function badPhoneMessage(region) {
  const h = phoneFormatHint(region);
  return `That is not a valid ${h.name} mobile-money number. Use the format ${h.local} or ${h.intl}.`;
}
// Does a cleaned number look like a MOBILE line in this region -- i.e. does
// it start with one of the prefixes the admin listed? Used when picking the
// payer's number out of a free-text SMS field, where digits of every kind
// turn up.
function looksLikeRegionMobile(cleaned, region) {
  const r = region || currentRegion();
  if (!cleaned) return false;
  const prefixes = Array.isArray(r.prefixes) ? r.prefixes.filter(Boolean) : [];
  if (!prefixes.length) return true;
  return prefixes.some(p => cleaned.startsWith('+' + String(r.dialCode || '') + p));
}
// Which number a deposit should charge, and the loophole this closes.
//
// Both deposit routes used to read `cleanPhone(req.body.phone || <account
// phone>)`. That `||` means an EMPTY field is falsy, so a member who left the
// number blank did not get refused -- the deposit was quietly created against
// whatever number the account was registered with, the route answered success,
// and the app went on to poll a payment prompt nobody had asked for. Owner:
// "l tried to leave not putting number and clicked confirm deposit but it
// didn't reject it just continued to go to poll page."
//
// The distinction that matters: a field SENT but empty or malformed is a
// member who has not filled the form in, and must be told so. A field not sent
// at all is a caller that never had one to send, and the account's own number
// is a sound answer for it -- so that fallback stays, and only that.
//
// Returns { phone } or { error }.
function depositSenderPhone(body, accountPhone, keys) {
  for (const k of keys) {
    if (!Object.prototype.hasOwnProperty.call(body || {}, k)) continue;
    const v = body[k];
    if (v === undefined || v === null) continue;
    const cleaned = cleanPhone(v);
    return cleaned ? { phone: cleaned }
                   : { error: 'Enter a valid mobile-money phone number.' };
  }
  const fallback = cleanPhone(accountPhone || '');
  return fallback ? { phone: fallback }
                  : { error: 'Enter a valid mobile-money phone number.' };
}
const NETWORK_NAMES = new Set(['MTN Mobile Money', 'Airtel Money']);
const MAX_MONEY_AMOUNT = 999_999_999;
// The most spins one purchase can ever grant. Used in TWO places that must
// agree: sanitizeProductInput() refuses a bigger number at save time, and
// grantTurntableSpins() clamps its loop to it at grant time. The second is
// not redundant -- it is the LOOP BOUND, and it reads a value out of the
// database. Not every write to products/ goes through the validator (the
// legacy-key migration re-writes stored docs directly), so the loop must
// not depend on the validator having been the only writer.
//
// It was 20, and 20 was an invented number -- owner: "stop limiting
// everything bro, they are above 25 even." It is 200 now. What this figure
// actually bounds is the WRITE LOOP in writeTurntableSpinDocs(): one Mongo
// document per spin, written one await at a time, so the cost of a purchase's
// grant is linear in it. That is why it is not simply removed -- a typed
// 100000 would try to write a hundred thousand money documents -- but 200
// leaves the owner far more room than he asked for and costs at most a couple
// of seconds of work that runs AFTER the purchase has already answered
// (grantTurntableSpins is fire-and-forget from /invest/create) and inside
// that investment's own lock, so nothing a member is waiting on is slowed.
// The sequential await is also what makes the resume-after-failure logic
// correct: surviving rows are a contiguous prefix, which is what
// `existingCount` assumes. Do not make this loop concurrent without making
// that resume fill MISSING ordinals instead of counting rows.
const MAX_SPINS_PER_PURCHASE = 200;
function finiteMoney(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
// Gift codes keep this original mixed-case alphabet, now at 8 characters
// (was 5, owner request 2026-08-27). Still can't collide with a referral
// code by construction — referral codes are 6 chars from a DIFFERENT
// (uppercase-only) alphabet below, so length alone already told the two
// apart and still does.
// Owner 2026-09-07: "treasure chest codes are 12 character alphanumeric
// random letters and numbers ie HDG27RHRFT64, NO PUTTING SMALL LETTERS."
// So gift codes now use the SAME uppercase-only, unambiguous alphabet as
// referral codes below (no I/l/O/0/1 -- a member reading a code off a
// screenshot must not have to guess O from 0). Length still tells the two
// kinds apart by construction: gift 12, referral 6.
const GIFTCODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const GIFTCODE_LENGTH = 12;
// Referral codes, changed 2026-09-07 (owner: "mixture of letters and numbers
// only 4 characters ie Gy2f, 5GHqt"). Mixed case and digits, still with no
// I/l/O/0/1 so a code read off a screenshot is never ambiguous. 54
// characters over 4 places is 8,503,056 codes; the uniqueness check below is
// what actually guarantees no repetition, the space only decides how often it
// has to retry.
// Every already-issued code keeps working untouched -- nothing is migrated,
// this only changes what NEWLY generated codes look like.
const REFERRAL_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'; // no I/l/O/0/1
const REFERRAL_LENGTH = 4;
function randFromAlphabet(alphabet, n) {
  let s = '';
  for (let i = 0; i < n; i++) s += alphabet[crypto.randomInt(alphabet.length)];
  return s;
}
function randCode(n = REFERRAL_LENGTH) { return randFromAlphabet(REFERRAL_CHARS, n); }
// Finds the owner of a referral code, ignoring case. Safe precisely because
// generateUniqueReferralCode() below refuses to issue two codes whose
// lowercase forms match -- so at most one user can ever answer to a given
// spelling, and matching case-insensitively cannot pick the wrong one.
// Codes are mixed case and only 4 characters now, so "Gy2f" typed as "gy2f"
// is a typo, not a different code; rejecting it would turn a real invite
// into "that referral code does not exist".
async function findUserByReferralCode(code) {
  const raw = String(code || '').trim();
  if (!raw) return null;
  const exact = await db.collection('users').where('referralCode', '==', raw).limit(1).get();
  if (!exact.empty) return exact.docs[0];
  const lower = raw.toLowerCase();
  const byLower = await db.collection('users').where('referralCodeLower', '==', lower).limit(1).get();
  return byLower.empty ? null : byLower.docs[0];
}
function genGiftCode() { return randFromAlphabet(GIFTCODE_CHARS, GIFTCODE_LENGTH); }
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
    for (let attempt = 0; attempt < 25; attempt++) {
      const claimed = await tryClaim(randCode(REFERRAL_LENGTH));
      if (claimed) return claimed;
    }
    // Safety valve, not the normal path. 25 collisions in a row at 4
    // characters means the 8.5M space is genuinely crowded, and at that point
    // a 5- then 6-character code is far better than refusing to let somebody
    // register. Length is not what identifies a referral code anywhere in
    // this file, so a longer one is handled identically.
    for (const len of [5, 6]) {
      for (let attempt = 0; attempt < 25; attempt++) {
        const claimed = await tryClaim(randCode(len));
        if (claimed) return claimed;
      }
    }
    throw new Error('Could not generate a unique referral code');
  });
}
// Sequential, server-issued account number ("ID:00001"). Single counter
// doc, read-increment-write serialized through withLock.
//
// FIVE digits, not six. Owner: "let the user id be having 5 characters, so so
// far now the current account is 000001, so remove first 0 so it will be
// 00001." padStart is a MINIMUM, so account 100,000 simply becomes six digits
// rather than wrapping or colliding -- the same way this behaved at six.
// Accounts issued before this change keep their stored six-digit id; the
// one-time repair for those is /admin/users/shorten-public-ids below.
const PUBLIC_ID_DIGITS = 5;
async function nextSequentialPublicId() {
  return withLock('publicid-counter', async () => {
    const counterRef = db.collection('counters').doc('publicId');
    const snap = await counterRef.get();
    let n = (snap.exists ? Number(snap.data().value) : 0) || 0;
    for (let i = 0; i < 50; i++) {
      n += 1;
      const id = String(n).padStart(PUBLIC_ID_DIGITS, '0');
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

// MISSION CENTER's constants lived here and are gone with the feature
// (owner: "remove mission center"). activeL1Count() above and
// wholeTeamDeposits() below STAY -- they are shared with the Task Center,
// which is a different feature and is not being removed.

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

// Verifies the caller's Firebase token ONCE per request and remembers the
// answer on the request object. The region middleware needs the caller's uid
// before any handler runs (to pick the member's own region), and every
// handler then asks again -- without this cache that would be two network
// round-trips to Firebase, and a revoked-token check, on every single
// authenticated call. The cached value includes the failure: a bad token
// stays bad for the life of the request.
async function _decodeAuth(req) {
  if (req && '_authDecoded' in req) return req._authDecoded;
  const header = (req && req.headers.authorization) || '';
  let decoded = null;
  if (header.startsWith('Bearer ')) {
    try { decoded = await admin.auth().verifyIdToken(header.slice(7), true); } // checkRevoked
    catch (_) { decoded = null; }
  }
  if (req) { try { req._authDecoded = decoded; } catch (_) {} }
  return decoded;
}
async function verifyAuth(req) {
  const decoded = await _decodeAuth(req);
  return decoded ? decoded.uid : null;
}
async function verifyAuthWithEmail(req) {
  const decoded = await _decodeAuth(req);
  return decoded ? { uid: decoded.uid, email: decoded.email || '' } : null;
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
        return txDoc.ref.update({ status: 'failed', description: `Deposit: Failed (${fmtMoney(amt)})`, amount: 0 });
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
  if (!data || typeof data !== 'object' || Array.isArray(data))
    return { status: 'error', providerDown: true, message: 'Invalid response from payment gateway' };
  if (resp.status >= 500 || [408, 409, 429].includes(resp.status)) data.providerDown = true;
  if (resp.ok && typeof data.status !== 'string') data.providerDown = true;
  if (!resp.ok && !data.status) data.status = 'error';
  return data;
}
// The body both money-movement calls share. `country` was hardcoded 'UG' here
// -- correct while Uganda was the only market, and the one line that had to
// change for any other. It is REQUIRED by the API (guide §5.3), and it is what
// selects the wallet: currency alone cannot, since XOF and XAF each cover three
// markets.
//
// `reference` is already a crypto.randomUUID() at both call sites, which is
// the UUID v4 the field requires.
//
// Refuses rather than guesses when the region is not a MarzPay market. A body
// with no `country` would be rejected by the API anyway; a body with the WRONG
// country would move real money in the wrong market, which is worse than a
// refusal. gatewayServesRegion() stops this being reachable in the first
// place, so this is the belt to that braces.
function marzMoneyBody({ amount, phone, reference, description, region }) {
  const market = marzMarket(region);
  if (!market) return null;
  const body = {
    amount: Number(amount),
    phone_number: phone,
    country: market.code,
    reference,
    description: description || 'Mobile Money',
  };
  // Only where the market genuinely has more than one wallet -- the docs ask
  // for it on DRC and nowhere else, and sending a currency for a
  // single-wallet market would be inventing a parameter value.
  if (market.currencies) body.currency = market.currency;
  return body;
}
function marzNoMarket(region) {
  const r = region || currentRegion();
  return { status: 'error', message:
    `MarzPay does not serve ${(r && r.name) || 'this country'} (+${(r && r.dialCode) || '?'})` };
}
async function marzCollect({ amount, phone, reference, description, callbackUrl, region }) {
  const payload = marzMoneyBody({ amount, phone, reference, description, region });
  if (!payload) return marzNoMarket(region);
  if (callbackUrl) payload.callback_url = callbackUrl;
  const resp = await fetch(`${MARZPAY_BASE}/collect-money`, {
    method: 'POST', signal: AbortSignal.timeout(MARZ_TIMEOUT),
    headers: { 'Authorization': `Basic ${MARZPAY_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return _marzParse(resp);
}
async function marzSendMoney({ amount, phone, reference, description, callbackUrl, region }) {
  const payload = marzMoneyBody({ amount, phone, reference, description, region });
  if (!payload) return marzNoMarket(region);
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
// Balances are PER COUNTRY WALLET, so the country has to be named or this
// reads whichever wallet the API defaults to -- which on a multi-market
// account is a figure for the wrong country presented as this one's. For DRC
// the currency picks between its CDF and USD wallets.
// Note the guide states this endpoint "requires IP whitelist"; a 401/403 here
// with the money paths working is that, not a bad key.
async function marzGetBalance(region) {
  const market = marzMarket(region);
  if (!market) return marzNoMarket(region);
  const q = new URLSearchParams({ country: market.code });
  if (market.currencies) q.set('currency', market.currency);
  const resp = await fetch(`${MARZPAY_BASE}/balance?${q}`, {
    signal: AbortSignal.timeout(MARZ_TIMEOUT), headers: { 'Authorization': `Basic ${MARZPAY_KEY}` }
  });
  const d = await _marzParse(resp);
  if (d.status === 'error') return d;
  return { status: 'success', currency: market.currency, ..._marzExtractBalance(d) };
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
// ── OTP (SMS one-time codes, via MarzSms above) ──
// Owner: registration goes phone -> OTP -> password -> confirm password;
// login stays phone/password with a "forgot password" link that also uses
// OTP; adding a withdrawal bank/mobile-money account requires OTP too (a
// member's own phone re-verifying it's really them, not the new payout
// number -- see /bank/save below, which resolves the phone from the
// account on file, not from the request body).
//
// Three purposes, one shared table. A code is generated, hashed (never
// stored in the clear -- same reasoning as a PIN or password), texted out,
// and checked by /auth/otp/verify, which on success issues a short-lived
// one-time `ticket`. The ticket -- not the raw code -- is what the
// following step (register / reset / bank-save) actually consumes, so the
// code itself is never seen again after the member types it once.
const OTP_CODE_LENGTH = 6;
const OTP_EXPIRES_MS = 10 * 60 * 1000;
const OTP_TICKET_EXPIRES_MS = 15 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_PURPOSES = new Set(['register', 'reset', 'bank']);
const OTP_SETTINGS_FIELD = { register: 'otpDailyLimitRegister', reset: 'otpDailyLimitReset', bank: 'otpDailyLimitBank' };
function generateOtpCode() {
  return String(crypto.randomInt(0, 10 ** OTP_CODE_LENGTH)).padStart(OTP_CODE_LENGTH, '0');
}
// SMS costs real money (30 UGX each, per the owner) -- unlike most numeric
// settings in this file, 0 here means "send none", not "no limit". A stray
// 0 must fail closed.
async function otpDailyLimit(purpose, sett) {
  const s = sett || await getSettings();
  return Math.max(0, Number(s[OTP_SETTINGS_FIELD[purpose]]) || 0);
}
// Atomic per phone+purpose+day counter. withLock is enough (not a Mongo
// transaction) because ecosystem.config.js pins this process to a single
// instance -- the same money-safety assumption every other counter in this
// file already relies on (see withLock's own header comment).
async function otpCheckAndBumpDailyLimit(phone, purpose) {
  const day = eatDayKey(new Date());
  const limit = await otpDailyLimit(purpose);
  return withLock('otp-limit:' + phone + ':' + purpose, async () => {
    if (limit <= 0) return false;
    const ref = db.collection('otpSendLog').doc(`${phone}:${purpose}:${day}`);
    const snap = await ref.get();
    const count = snap.exists ? (Number(snap.data().count) || 0) : 0;
    if (count >= limit) return false;
    await ref.set({ phone, purpose, day, count: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return true;
  });
}
// Looks the code up by its ticket (not by the otpCodes doc id, which the
// caller of /auth/otp/verify never learns), and only ever consumes it once:
// updateIf's conditional match is a single atomic Mongo call, so two
// requests racing on the same ticket cannot both succeed (see updateIf's
// own comment in db.js -- the identical pattern this file already uses for
// creditedDepositIds/refundedWithdrawalIds).
async function consumeOtpTicket(ticket, phone, purpose) {
  if (!ticket) return false;
  const snap = await db.collection('otpCodes').where('ticket', '==', ticket).limit(1).get();
  if (snap.empty) return false;
  const doc = snap.docs[0];
  const o = doc.data();
  if (o.phone !== phone || o.purpose !== purpose) return false;
  if (o.consumedAt) return false;
  if (Date.now() > tsMillis(o.ticketExpiresAt)) return false;
  return doc.ref.updateIf({ consumedAt: null }, { consumedAt: FieldValue.serverTimestamp() });
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

// ── PESAJET (mobile money collect/disburse -- a 2nd automatic gateway
// alongside MarzPay) ──
// Owner: "l would like also to introduce in a new gateway for Uganda
// https://pay.pesajet.com/docs".
//
// THE CONTRACT IS RECORDED IN docs/pesajet-api.md. It was taken from
// PesaJet's own published SDK (@pesajet/sdk@1.0.2 on npm) because
// pay.pesajet.com is refused by this environment's egress proxy -- that is
// the same contract the SDK speaks, so endpoints, headers, field names and
// status values are authoritative. Anything the SDK does not exercise is
// listed there as an open question instead of being guessed at here.
//
// Three shape differences from MarzPay, each of which changes how this is
// wired:
//   * ONE endpoint for both directions -- POST /payments with
//     type:'COLLECTION' or type:'DISBURSEMENT'. There is no separate
//     send-money path to mirror.
//   * NO per-request callback URL. MarzPay takes one in the
//     body; PesaJet's webhook URL is set once in their dashboard, so
//     PUBLIC_URL plays no part below and the OWNER HAS TO SET IT THERE or
//     resolution falls back entirely to the member's own status poll and the
//     reconciler. Both of those already work, so a missing webhook is slow
//     rather than broken -- which is why this is not treated as fatal.
//   * THREE terminal statuses, not two: COMPLETED, FAILED and EXPIRED.
//     EXPIRED means the member never approved the prompt, the commonest real
//     outcome on mobile money. It resolves as a failure -- FAILED_STATUSES
//     already contains 'expired' -- but it earns its own wording, because
//     "you did not approve it in time" and "the payment failed" send a member
//     to two different places.
const PESAJET_BASE = (process.env.PESAJET_BASE_URL || 'https://payments.pesajet.com/api/v1').replace(/\/+$/, '');
const PESAJET_KEY = (process.env.PESAJET_API_KEY || '').trim();
const PESAJET_WEBHOOK_SECRET = process.env.PESAJET_WEBHOOK_SECRET || '';
// TWO timeouts, because the two call shapes have opposite needs.
//
// Creating a payment is a one-off that raises a prompt on a phone; 20s is what
// MarzPay already allows and is worth waiting for.
//
// READING a status is polled every couple of seconds while a member watches
// the screen, and the SDK's blanket 30s default is actively harmful there: one
// slow read stalls the whole poll behind it, and pesajetGetTx's retry made the
// worst case 60 seconds of a screen saying nothing. A read that has not
// answered in 7s is better abandoned -- the next poll IS the retry.
const PESAJET_TIMEOUT = 20000;
const PESAJET_READ_TIMEOUT = 7000;
function pesajetConfigured() { return !!PESAJET_KEY; }
// E.164 with a leading '+', which is what PesaJet wants and what cleanPhone()
// already produces. Kept anyway, and shaped exactly like the SDK's own
// formatPhoneNumber, so a legacy document holding a bare local number cannot
// quietly send a malformed msisdn to a live gateway.
function pesajetPhone(raw) {
  let s = String(raw || '').replace(/[\s-]/g, '');
  if (!s) return '';
  if (s.startsWith('0')) return '+256' + s.slice(1);
  if (s.startsWith('256')) return '+' + s;
  if (!s.startsWith('+')) return '+' + s;
  return s;
}
// PesaJet's `provider` is OPTIONAL, and that is load-bearing here: its own
// SDK says 073 spans both networks and returns null rather than guessing, so
// sending a wrong operator is worse than sending none. Petro stores the
// network as NETWORK_NAMES ('MTN Mobile Money' / 'Airtel Money') when the
// member picked one; when it did not, this returns null and the field is
// omitted from the payload so PesaJet resolves it itself.
//
// NOTE the prefix lists differ: PesaJet's SDK maps 77/78/76/79/39 -> mtn and
// 70/75/74 -> airtel, while Petro's own UGANDA_MOBILE_PREFIXES does not carry
// 39. Deliberately NOT reconciled by widening Petro's list -- that list
// governs which numbers this platform accepts at all, and quietly admitting a
// new prefix because a payment provider happens to recognise it is a
// different decision from this one. The stored network wins where there is
// one; only the fallback consults prefixes.
function pesajetProviderFor(network, phone) {
  if (network === 'MTN Mobile Money') return 'mtn';
  if (network === 'Airtel Money') return 'airtel';
  const local = String(phone || '').replace(/^\+?256/, '').replace(/^0/, '');
  if (/^(77|78|76|79|39)\d{7}$/.test(local)) return 'mtn';
  if (/^(70|75|74)\d{7}$/.test(local)) return 'airtel';
  return null;
}
// Every call in one place. Returns a plain object rather than throwing, the
// same shape _marzParse() settles on, so the callers below read the same way
// as the MarzPay ones: { ok, data, httpStatus, providerDown }.
//
// `providerDown` is the distinction that matters on a money path: "PesaJet
// said no" and "we could not reach PesaJet" must never be collapsed, because
// the first is safe to report as a failure and the second is ambiguous and
// must leave the row alone for the reconciler.
async function _pesajetRequest(path, { method = 'GET', body, idempotencyKey, timeoutMs } = {}) {
  const headers = { 'X-API-Key': PESAJET_KEY };
  if (body) headers['Content-Type'] = 'application/json';
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  let resp;
  try {
    resp = await fetch(`${PESAJET_BASE}${path}`, {
      method, headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs || PESAJET_TIMEOUT),
    });
  } catch (e) {
    return { ok: false, providerDown: true, httpStatus: 0, data: { message: e.message } };
  }
  const text = await resp.text().catch(() => '');
  let data;
  try { data = text ? JSON.parse(text) : {}; }
  catch (_) { data = { message: text }; }
  // PesaJet's documented error body NESTS everything under `error`:
  //   { error: { code, message, details, timestamp, requestId } }
  // while their SDK's own error type is flat. Reading `data.message ||
  // data.error` off the documented shape hands back the error OBJECT, which
  // reaches a member as "[object Object]" on a failed recharge. Flattened
  // here, once, so every caller sees one shape whichever the API sends.
  if (data && typeof data === 'object' && data.error && typeof data.error === 'object') {
    const e = data.error;
    data = { message: e.message, errorCode: e.code, details: e.details,
             requestId: e.requestId, raw: data };
  }
  // Their own error table says to log this when contacting support.
  if (!resp.ok && data && data.requestId) {
    console.error(`pesajet ${method} ${path}: HTTP ${resp.status} requestId=${data.requestId}`);
  }
  // A 5xx or a 408/429 is the gateway struggling, not a verdict on this
  // payment -- same treatment as a thrown network error.
  const down = resp.status >= 500 || resp.status === 408 || resp.status === 429;
  // 409 is neither. Their error table's own instruction for a conflict is
  // "reuse the original response", i.e. the transaction ALREADY EXISTS --
  // handled by the caller, never as a refusal.
  return { ok: resp.ok, providerDown: !resp.ok && down, conflict: resp.status === 409,
           httpStatus: resp.status, data };
}
async function pesajetCreate({ type, amount, phone, network, reference, description, idempotencyKey }) {
  const payload = {
    type: type === 'DISBURSEMENT' ? 'DISBURSEMENT' : 'COLLECTION',
    amount: Number(amount),
    currency: 'UGX',
    phoneNumber: pesajetPhone(phone),
    reference: String(reference || ''),
    description: description || 'Mobile Money',
  };
  const provider = pesajetProviderFor(network, phone);
  if (provider) payload.provider = provider;
  // Sent BOTH ways on purpose. PesaJet's SDK puts the idempotency key in an
  // `Idempotency-Key` header; their own REST example puts an `idempotencyKey`
  // field in the body ("Use a unique idempotency key when retrying requests to
  // prevent duplicate payments"). Which one their API actually reads is not
  // stated anywhere, and the cost of guessing wrong is a DUPLICATE PAYMENT on
  // a retry -- so send both and let whichever they honour do its job.
  if (idempotencyKey) payload.idempotencyKey = idempotencyKey;
  const r = await _pesajetRequest('/payments', { method: 'POST', body: payload, idempotencyKey });
  if (!r.conflict) return r;
  // A 409 IS NOT A REFUSAL, and treating it as one is how a live payment gets
  // marked failed. PesaJet's own error table says of a conflict: "Reuse the
  // original response for an idempotency conflict" -- the transaction already
  // exists, so the prompt may be ringing on the member's phone right now, or
  // a payout may already be on its way.
  const hit = await pesajetFindByReference(payload.reference, { sinceMs: Date.now() - 6 * 3600 * 1000 });
  if (hit.found && hit.transactionId) {
    return { ok: true, providerDown: false, conflict: true, recovered: true, httpStatus: 200,
             data: { transactionId: hit.transactionId,
                     status: (hit.status || 'pending').toUpperCase(),
                     reference: payload.reference } };
  }
  // Could not recover the id. The only safe reading left is "in flight": the
  // caller then leaves a deposit pending for the reconciler and does not hand
  // a payout back for a retry that would pay twice.
  console.error('PesaJet 409 and the transaction could not be found by reference:', payload.reference);
  return { ...r, providerDown: true };
}
async function pesajetCollect(opts)  { return pesajetCreate({ ...opts, type: 'COLLECTION' }); }
async function pesajetDisburse(opts) { return pesajetCreate({ ...opts, type: 'DISBURSEMENT' }); }
// The independent re-read every credit decision here is made from. Two
// attempts with a short backoff, the same shape _marzFetchTxStatus() uses,
// because a single transient failure must not read as "not paid".
// `attempts` is 1 on the paths a member is waiting on -- their own status
// poll comes back in a couple of seconds and IS the retry, so retrying inside
// one request only doubles how long the screen says nothing. The webhook and
// the reconciler, where nobody is watching, keep the second attempt because
// there a transient blip really would mean waiting for the next 30s tick.
// Find a transaction we have NO id for, by our own reference.
//
// This closes a real hole. If a create call is accepted by PesaJet but its
// response is lost in flight (a timeout at our end), the deposit row has no
// `pesajetTxId` -- and every resolver here reads by that id, so nothing could
// ever check it again. The member's money may have left their phone and this
// platform would never credit it. Until PesaJet documented a LIST endpoint
// there was nothing to look such a row up with; now there is.
//
// It uses ONLY the six parameters their endpoint reference lists
// (page/limit/status/provider/startDate/endDate). There is no `reference`
// filter among them, so the window is narrowed with the documented startDate
// and our own reference is matched here. Inventing a seventh parameter would
// be the same mistake as inventing a balance path.
const PESAJET_FIND_LIMIT = 100;   // rows per page asked for
const PESAJET_FIND_PAGES = 3;     // at most 300 rows scanned per lookup
// How the reconciler rations those lookups. A lookup costs up to three calls,
// so a handful per 30s tick; younger than the minimum age the member's own
// status poll owns the row, and older than the window there is nothing left
// to page.
const PESAJET_LOST_PER_TICK = 5;
const PESAJET_LOST_MIN_AGE_MS = 10 * 60 * 1000;
const PESAJET_LOST_WINDOW_MS = 6 * 3600 * 1000;
async function pesajetFindByReference(reference, { sinceMs } = {}) {
  const ref = String(reference || '');
  if (!ref) return { found: false, complete: false, providerDown: false };
  // A minute of slack either side of our own timestamp: their clock is not
  // ours, and a row missed by a second would read as "never existed".
  const since = sinceMs ? new Date(sinceMs - 60000).toISOString() : null;
  for (let page = 1; page <= PESAJET_FIND_PAGES; page++) {
    const qs = new URLSearchParams({ page: String(page), limit: String(PESAJET_FIND_LIMIT) });
    if (since) qs.set('startDate', since);
    const r = await _pesajetRequest(`/payments?${qs.toString()}`, { timeoutMs: PESAJET_READ_TIMEOUT });
    if (!r.ok) return { found: false, complete: false, providerDown: !!r.providerDown, httpStatus: r.httpStatus };
    const body = r.data || {};
    const rows = Array.isArray(body) ? body
      : Array.isArray(body.data) ? body.data
      : Array.isArray(body.transactions) ? body.transactions
      : Array.isArray(body.payments) ? body.payments : null;
    // The list envelope is not documented, only its parameters are. If it is
    // not recognisably a list, say so rather than reading "no rows" -- an
    // unrecognised shape must never become evidence that a payment does not
    // exist, because that evidence is what licenses failing a deposit below.
    if (!rows) {
      console.error('pesajetFindByReference: unrecognised list envelope', JSON.stringify(body).slice(0, 200));
      return { found: false, complete: false, providerDown: false, unreadable: true };
    }
    const hit = rows.find(t => t && String(t.reference || '') === ref);
    if (hit) return { found: true, complete: true, providerDown: false,
                      transactionId: hit.transactionId || null,
                      status: String(hit.status || '').toLowerCase() };
    // A short page is the end of the window. That -- and only that -- means
    // we have now seen everything there is to see.
    if (rows.length < PESAJET_FIND_LIMIT) return { found: false, complete: true, providerDown: false };
  }
  return { found: false, complete: false, providerDown: false };
}
async function pesajetGetTx(transactionId, { attempts = 2 } = {}) {
  let last = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const r = await _pesajetRequest(`/payments/${encodeURIComponent(transactionId)}`,
      { timeoutMs: PESAJET_READ_TIMEOUT });
    if (r.ok) {
      const t = r.data?.data || r.data || {};
      return {
        status: String(t.status || '').toLowerCase(),
        reference: t.reference || null,
        transactionId: t.transactionId || transactionId,
        failureReason: t.failureReason || null,
        providerDown: false,
      };
    }
    // A 404 is an answer, not an outage: this id is unknown to PesaJet.
    if (!r.providerDown) {
      console.error(`pesajetGetTx(${transactionId}): HTTP ${r.httpStatus}`, JSON.stringify(r.data).slice(0, 300));
      return { status: '', reference: null, transactionId, failureReason: null, providerDown: false, notFound: r.httpStatus === 404 };
    }
    last = r;
    console.error(`pesajetGetTx(${transactionId}) attempt ${attempt}: gateway unavailable (HTTP ${r.httpStatus})`);
    if (attempt < attempts) await new Promise(r2 => setTimeout(r2, 350));
  }
  return { status: '', reference: null, transactionId, failureReason: null, providerDown: true, httpStatus: last && last.httpStatus };
}
// PesaJet's status -> the three words the rest of this file already speaks
// ('success'/'failed'/'processing'), so the deposit and withdrawal branches
// below read identically whichever gateway is in use. PENDING and
// PROCESSING are both still in flight; EXPIRED is terminal and counts as a
// failure.
function pesajetStatusLabel(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'completed') return 'success';
  if (s === 'failed' || s === 'expired') return 'failed';
  if (s === 'pending' || s === 'processing') return 'processing';
  return '';
}
// Only EXPIRED gets its own sentence. A member whose prompt timed out has not
// had a payment go wrong -- they have not answered it yet -- and telling them
// it failed sends them looking for a fault that is not there.
function pesajetFailureMsg(status) {
  return String(status || '').toLowerCase() === 'expired'
    ? 'The payment request timed out before it was approved on the phone. Nothing was taken. Start a new recharge to try again.'
    : DEPOSIT_FAILED_MSG;
}
function pesajetUserMsg(r, fallback) {
  if (r && r.providerDown) return PROVIDER_BUSY_MSG;
  const d = (r && r.data) || {};
  // Only ever a STRING reaches a member. The documented error body nests an
  // object under `error`, and handing that straight back printed
  // "[object Object]" in front of somebody whose recharge had just failed.
  const raw = [d.message, d.error].find(v => typeof v === 'string' && v.trim()) || '';
  if (/internal|server error|unavailable|timeout|timed out|try again|temporarily|gateway/i.test(raw))
    return PROVIDER_BUSY_MSG;
  return raw || fallback || PROVIDER_BUSY_MSG;
}
// HMAC-SHA256, hex, over the payload with its own `signature` field removed,
// exactly as PesaJet's SDK computes it. The signature may arrive in the
// x-webhook-signature header or inside the body; both are accepted, the
// header first.
//
// TWO THINGS TO KNOW, and they are why this is a filter and never the
// authority:
//   * the digest is over a RE-SERIALISED object, not over the raw request
//     body, so it depends on JSON key order surviving parse -> stringify.
//     Node preserves insertion order for string keys so it normally matches,
//     but a proxy that reorders or re-encodes would break it through no
//     fault of ours.
//   * with no secret configured there is nothing to verify against.
// In both cases the callback still does its job, because the callback never
// credits anything on the webhook's word -- it re-reads
// GET /payments/{transactionId} and acts on THAT. A failed or impossible
// verification downgrades the webhook to a hint; it does not invent one.
function pesajetVerifyWebhook(body, headerSig, rawBody) {
  if (!PESAJET_WEBHOOK_SECRET) return { verified: false, reason: 'no-secret' };
  const obj = (body && typeof body === 'object') ? body : {};
  const sig = String(headerSig || obj.signature || '');
  if (!sig) return { verified: false, reason: 'no-signature' };
  // TWO candidate digests, and accepting either is deliberate.
  //
  // PesaJet's DASHBOARD says the signature is an HMAC of the "raw request
  // payload". Their own published SDK computes it over
  // JSON.stringify(payload minus its `signature` field) -- which is a
  // different byte string whenever the raw body has any different spacing or
  // key order, i.e. in general. The two sources disagree, and only one of
  // them is what their servers actually send.
  //
  // This is not a weakening: both candidates are HMAC-SHA256 over data
  // derived from THIS request under the same secret, so forging either still
  // requires the secret. What accepting both buys is that the integration
  // works whichever of the two PesaJet really does, instead of silently
  // 401-ing every live webhook until somebody reads the bytes. The raw form
  // is tried first because it is what the dashboard states.
  const { signature: _omit, ...clean } = obj;
  const candidates = [];
  if (rawBody && rawBody.length) candidates.push(rawBody);
  candidates.push(Buffer.from(JSON.stringify(clean), 'utf8'));
  const expected = candidates.map(buf => crypto.createHmac('sha256', PESAJET_WEBHOOK_SECRET)
    .update(buf).digest('hex'));
  const b = Buffer.from(sig, 'utf8');
  for (const exp of expected) {
    const a = Buffer.from(exp, 'utf8');
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return { verified: true, reason: 'ok' };
  }
  // A signature that was present and did not verify is a 'mismatch' WHATEVER
  // the reason -- a wrong length, a wrong digest, or neither candidate
  // matching are the same event to whoever has to act on it. An earlier
  // version reported a wrong digest as 'checked', which the route treats as
  // "could not verify, carry on as a hint" rather than as the forgery it is:
  // no money could have moved wrongly (the re-read still governs every
  // credit) but a forged call would have been answered 200 instead of 401
  // with nothing flagging it. Caught by test-pesajet.js.
  return { verified: false, reason: 'mismatch' };
}

// ── DAILY CASHBACK (settle-on-read + a 1s background sweep) ──
// Each tier pays expectedReturn/cycleDays per elapsed day, using cumulative-
// target allocation (round(expectedReturn * daysDue / total)) so the running
// total always telescopes to EXACTLY expectedReturn at completion, for any
// ratio — not just ones that divide evenly.
const _creditingPayouts = new Set();
// Maturity payouts run from the reconciler, outside any request, so they
// have no region of their own -- and the description they stamp on the
// transaction carries a money amount. Run in the OWNER's region so the
// figure is labelled in the currency that member actually holds.
async function settleInvestmentIfDue(doc) {
  return withUserRegion(doc && doc.data() && doc.data().userId, () => _settleDueInvestmentNow(doc));
}
async function _settleDueInvestmentNow(doc) {
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
// Same reasoning as settleInvestmentIfDue(): the reconciler pays these with
// no region in force. Referral teams never cross regions (see the
// BAD_REFERRAL_REGION check in completeRegistrationCore), so the buyer's
// region is every payee's region too.
async function creditReferralCommission(investmentId, buyerId, amount) {
  return withUserRegion(buyerId, () => _payReferralCommissionNow(investmentId, buyerId, amount));
}
async function _payReferralCommissionNow(investmentId, buyerId, amount) {
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
      // A level is not considered paid merely because we STARTED paying it.
      // Put a durable idempotency token beside the wallet increment in the
      // same atomic user-document update. If anything after this line fails,
      // a retry sees the token and repairs history/metadata without crediting
      // the wallet twice; if this update itself fails, nothing was claimed.
      const commissionKey = investmentId + ':' + i;
      const payeeRef = db.collection('users').doc(id);
      const applied = await withLock('bal:' + id, () => payeeRef.updateIf(
        { creditedCommissionKeys: { $ne: commissionKey } },
        {
          walletBalance: FieldValue.increment(reward),
          teamCommission: FieldValue.increment(reward),
          totalEarned: FieldValue.increment(reward),
          creditedCommissionKeys: FieldValue.arrayUnion(commissionKey),
        }
      ));
      // History is idempotent too. A retry after the wallet landed but this
      // insert failed must fill the missing row, not append a duplicate.
      const priorCommissionTx = await db.collection('transactions')
        .where('userId', '==', id)
        .where('type', '==', 'commission')
        .where('investmentId', '==', investmentId)
        .where('commissionLevel', '==', i)
        .limit(1).get();
      if (priorCommissionTx.empty) {
        const commissionTxId = `commission:${investmentId}:${i}:${id}`;
        await db.collection('transactions').doc(commissionTxId).createIfAbsent({
          userId: id, type: 'commission', description: `Level ${i + 1} reward`,
          amount: reward, status: 'success', date, time, investmentId, commissionLevel: i,
          createdAt: FieldValue.serverTimestamp()
        });
      }
      // Mark the investment level resolved LAST. A failure here is harmless:
      // the next reconciler pass sees the wallet token/history and only
      // finishes this marker; it cannot pay again.
      await invRef.update({ commissionPaidLevels: FieldValue.arrayUnion(i) });
      if (applied) paidAny = true;
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
      const need = isDeposit ? fmtMoney(m.target) : m.target;
      const have = isDeposit ? fmtMoney(progress) : progress;
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
          description: isDeposit ? `Task Center: whole team deposits ${fmtMoney(m.target)}` : `Task Center: ${m.target} active referrals`,
          amount: m.reward, milestone: m.target, status: 'success', date, time, createdAt: FieldValue.serverTimestamp()
        });
        done = true;
      }));
    });
    if (stillShort) return res.status(400).json({ status: 'error', message: 'Your progress changed just now. Please try again.' });
    if (!done) return res.status(400).json({ status: 'error', message: 'Already claimed' });
    res.json({ status: 'success', amount: m.reward, message: `${fmtMoney(m.reward)} added to your wallet` });
  } catch (e) { console.error('Milestone claim error:', e.message); res.status(500).json({ status: 'error', message: 'Could not claim that reward right now' }); }
});

// ── MISSION CENTER — REMOVED ──
// Owner: "remove mission center". The three routes that lived here
// (/mission/status, /mission/salary/claim, /mission/deposit/claim) are gone,
// not merely unlinked from the app. Two of them CREDITED MONEY, so leaving
// them reachable after the screen was taken out of the UI would have meant a
// removed feature that still pays out to anyone who knows the URL -- the
// client is not the access control.
//
// Deliberately KEPT: the mission_salary / mission_deposit_reward transaction
// rows already in the database, and the labels that render them. Members who
// claimed these really were paid, and their Records must keep reading
// correctly; deleting the labels would turn old rows into raw type keys.
// The MISSION_* constants are gone too (see where they were declared).
// activeL1Count()/wholeTeamDeposits() stay: the Task Center, a different
// feature that is NOT being removed, uses both.

// ═══════════════════════════════════════════
// PUBLIC
// ═══════════════════════════════════════════
app.get('/health', async (_req, res) => {
  const dbUp = await pingDb();
  res.json({ status: dbUp ? 'ok' : 'degraded', db: dbUp });
});
// ── AUTO-DEPLOY (GitHub webhook -> git pull + npm install + pm2 reload) ──
// Owner: doing this by hand over Termux/SSH every single time is "tiresome"
// -- this closes that loop. A Claude Code session in this environment cannot
// SSH out (see petro/CLAUDE.md's "Hosting" section), so the only direction
// that ever worked here is the VPS pulling; this just makes the VPS do that
// pull BY ITSELF the moment something lands on the deploy branch, instead of
// a human running the same three commands over SSH every time.
//
// Authenticated the same way GitHub's own docs recommend, and the same
// pattern PesaJet's webhook above already uses in this file: HMAC-SHA256
// over the RAW request body (see RAW_BODY_ROUTES / keepRawBody), checked
// with a constant-time compare. Nothing from the request is ever
// interpolated into a shell command either -- every command below is a
// fixed, literal argv array run via execFile (never exec / a shell string),
// so there is no injection surface even though this route's entire job is
// running commands. A leaked DEPLOY_WEBHOOK_SECRET lets an attacker trigger
// a pull+reload on demand, but only of whatever is actually sitting on
// DEPLOY_BRANCH in this repo -- it cannot run an arbitrary command.
const DEPLOY_WEBHOOK_SECRET = process.env.DEPLOY_WEBHOOK_SECRET || '';
const DEPLOY_BRANCH = process.env.DEPLOY_BRANCH || 'claude/petro-platform-build';
// The sparse checkout root (git lives here) vs. the actual petro/ app
// directory inside it (npm/pm2 commands run from here) -- see
// petro/CLAUDE.md's "Hosting" section for why these are two different
// directories on this VPS.
const DEPLOY_GIT_DIR = process.env.DEPLOY_GIT_DIR || '/srv/petro-src';
const DEPLOY_APP_DIR = process.env.DEPLOY_APP_DIR || (DEPLOY_GIT_DIR + '/petro');
function verifyGithubWebhookSignature(rawBody, headerSig) {
  if (!DEPLOY_WEBHOOK_SECRET || !rawBody) return false;
  const sig = String(headerSig || '');
  if (!sig.startsWith('sha256=')) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', DEPLOY_WEBHOOK_SECRET).update(rawBody).digest('hex');
  const a = Buffer.from(sig), b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function runDeployCmd(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, timeout: 5 * 60 * 1000 }, (err, stdout, stderr) => {
      if (err) { err.stdout = stdout; err.stderr = stderr; return reject(err); }
      resolve(stdout);
    });
  });
}
// Only one at a time -- a second webhook firing mid-deploy (a rapid string
// of pushes) would otherwise overlap `npm install` with `pm2 reload`
// against a half-updated node_modules.
let _autoDeployRunning = false;
async function runAutoDeploy() {
  if (_autoDeployRunning) { console.warn('Auto-deploy: already running, this trigger skipped'); return; }
  _autoDeployRunning = true;
  try {
    console.log('Auto-deploy: pulling', DEPLOY_BRANCH);
    await runDeployCmd('git', ['pull', '--ff-only', 'origin', DEPLOY_BRANCH], DEPLOY_GIT_DIR);
    await runDeployCmd('npm', ['install', '--omit=dev'], DEPLOY_APP_DIR);
    // Hands the running process off to a freshly-spawned one running the
    // code just pulled above. Zero-downtime by pm2's own design -- and safe
    // to fire from inside the very process being replaced: by the time this
    // line runs, git pull + npm install have already fully completed, and
    // the `pm2` CLI call only has to reach the separate pm2 daemon (a
    // systemd service, not a child of this process) before this process
    // itself goes away.
    await runDeployCmd('pm2', ['reload', 'petro-server'], DEPLOY_APP_DIR);
    console.log('Auto-deploy: pulled + reloaded successfully');
  } catch (e) {
    console.error('Auto-deploy failed:', e.message, e.stderr || e.stdout || '');
  } finally { _autoDeployRunning = false; }
}
app.post('/deploy/webhook', (req, res) => {
  if (!verifyGithubWebhookSignature(req.rawBody, req.get('x-hub-signature-256')))
    return res.status(401).json({ status: 'error', message: 'Bad signature' });
  const event = req.get('x-github-event');
  // GitHub fires this automatically the moment the webhook is created in its
  // UI -- answering it is what lets the owner see "green" there without
  // needing an actual push first.
  if (event === 'ping') return res.json({ status: 'success', message: 'pong' });
  if (event !== 'push') return res.json({ status: 'ignored', message: `Not handling GitHub event: ${event}` });
  const ref = (req.body && req.body.ref) || '';
  if (ref !== `refs/heads/${DEPLOY_BRANCH}`)
    return res.json({ status: 'ignored', message: `Push was to ${ref || '(unknown)'}, this VPS only redeploys on refs/heads/${DEPLOY_BRANCH}` });
  // ANSWER FIRST. GitHub retries a webhook delivery that doesn't respond
  // within 10 seconds, and git pull + npm install can easily run past that
  // -- respond immediately, run the actual deploy in the background exactly
  // like every other fire-and-forget side effect in this file
  // (sendAdminPush, marzSmsSend's own callers).
  res.json({ status: 'success', message: 'Deploy started' });
  runAutoDeploy();
});
// What the app is told about its region: the currency label it prints in
// front of every amount, the dialling code it shows beside the phone field,
// and the number shape it validates against. Hostnames are left out -- the
// app knows which one it was loaded from.
function publicRegionView(r) {
  const reg = r || currentRegion();
  return {
    key: reg.key, name: reg.name, currency: reg.currency, dialCode: reg.dialCode,
    localLength: reg.localLength, prefixes: (reg.prefixes || []).slice(),
    utcOffsetMin: reg.utcOffsetMin, isDefault: !!reg.isDefault,
    // Which languages this country's sign-in screen may offer, and which one
    // a device with no choice stored opens in. Published rather than compiled
    // into the app so a country's list can change from the panel without a
    // frontend redeploy.
    languages: (reg.languages && reg.languages.length ? reg.languages : ['en']).slice(),
    defaultLang: reg.defaultLang || 'en',
    // Which login-address shape this region's accounts use. Sent rather than
    // worked out in the app: it depends on the FOUNDING region's dialling
    // code, which the app has no way of knowing, and the two must agree
    // exactly or a member creates one Firebase account and then signs in
    // looking for another.
    usesBareLocal: regionUsesBareLocal(reg),
  };
}
app.get('/public/settings', async (req, res) => {
  try {
    const s = await getSettings();
    // allowedOrigins is operator configuration, not app content -- there is
    // no reason to hand every member's phone the list of domains that can
    // reach this backend, so it is dropped here alongside maintenanceMsg.
    const { maintenanceMsg, allowedOrigins, ...rest } = s;
    // referralRequired is the RESOLVED answer (setting AND "a member already
    // exists"), not the raw setting -- same reasoning as the resolved product
    // figures below. The Sign Up screen shows the field as required or
    // optional from this one flag, so it can never disagree with what
    // /register will actually accept.
    // Revalidated every time (no max-age): maintenance mode, the opening
    // countdown and every rate have to take effect on the next launch, not a
    // minute later. The ETag still removes the bytes when nothing changed.
    publicJson(req, res, { status: 'success', settings: {
      ...rest,
      maintenanceMsg: s.maintenanceMode ? maintenanceMsg : '',
      payoutManual: payoutIsManual(s),
      // RESOLVED, not a raw setting: deposits are only real if a gateway can
      // actually reach this country's phone numbers. Sending an unresolved
      // flag would show a Kenyan member a recharge option that fails at the
      // provider every time -- the app reads this field directly
      // (`s.depositAvailable !== false`), so resolving it here is what hides
      // deposits rather than asking the app to know about gateways. (Named
      // depositPayAEnabled before manual deposit collection -- PAY B -- was
      // removed outright; renamed since "PAY A" no longer means anything
      // once there is no PAY B to contrast it with.)
      depositAvailable: payAAvailable(s),
      referralRequired: await referralRequiredNow(),
    // How many countries this platform runs in. The app only uses it to add
    // "if you signed up on another country's site, sign in there" to a
    // failed login -- an account belongs to one region and its synthetic
    // login address carries that region's dialling code, so signing in on
    // the wrong subdomain genuinely cannot find it.
    }, region: publicRegionView(), regionCount: (await getRegions()).filter(r => r.active).length });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
// ── WHICH ADDRESS THIS ARRIVAL SHOULD BE ON ──
// Owner: "if one joined the site or visited the site with a subdomain like
// gfdt so in his session, server changes the subdomain of his session to
// another like b5dh, so in that very country."
//
// The app asks this on arrival and, if told to, moves the browser to the
// hostname it gets back. Everything about the answer is decided here rather
// than in the app, so the mode can be changed from the panel without
// shipping a new build.
//
// Rules the answer obeys:
//  - SAME COUNTRY, ALWAYS. The pool is this region's own short addresses and
//    nothing else. Which region that is has already been decided by the
//    region middleware, which prefers a signed-in member's OWN region over
//    the hostname -- so a Kenyan member who somehow opens a Ugandan address
//    is offered a Kenyan one, never the other way round.
//  - CLAIMED ADDRESSES ONLY. A made-up label resolves to the founding region
//    (wrong currency) and is not in the CORS allowlist, so handing one out
//    would break the app rather than move it.
//  - NEVER BACK TO WHERE HE IS. The current host is excluded, so a pool of
//    one address answers "stay".
//  - NOT FROM A SERVICE HOST. Opened from *.onrender.com or localhost -- the
//    owner testing -- nobody is moved; being bounced onto a live country
//    address mid-test is not a thing he asked for.
//  - 'visitors' DOES NOT MOVE A SIGNED-IN MEMBER. A browser files the saved
//    password, the instant-boot cache, the offline shell and an installed
//    home-screen icon under one hostname. See DEFAULT_SETTINGS.rotateEntry.
app.get('/public/entry', async (req, res) => {
  try {
    const region = currentRegion();
    const sett = await getSettings(region.key);
    const mode = ROTATE_ENTRY_MODES.includes(sett.rotateEntry) ? sett.rotateEntry : 'off';
    const stay = { status: 'success', rotate: false, mode, host: '' };
    if (mode === 'off') return res.json(stay);
    const host = requestHost(req);
    if (isInfraHost(host)) return res.json(stay);
    // Signed in? Only 'always' moves him. Read from the cached decode the
    // region middleware already did, so this costs no extra Firebase round
    // trip.
    if (mode !== 'always' && (req.headers.authorization || '').startsWith('Bearer ')) {
      const uid = await verifyAuth(req);
      if (uid) return res.json(stay);
    }
    const from = hostOnly(req.query.from || '') || host;
    const pool = (region.labels || [])
      .map(l => (_baseDomain ? l + '.' + _baseDomain : ''))
      .filter(h => h && h !== from);
    if (!pool.length) return res.json(stay);
    const pick = pool[Math.floor(Math.random() * pool.length)];
    res.json({ status: 'success', rotate: true, mode, host: pick });
  } catch (e) {
    // A failure here must never stop the app loading: the member stays on
    // the address he already has, which works.
    res.json({ status: 'success', rotate: false, mode: 'off', host: '' });
  }
});
// ── WHICH ADDRESS THIS MEMBER'S INVITE LINK SHOULD CARRY ──
// Owner: "when he uses gdfs in the team links, the urls will rotate to any
// of that specific country ie t3gs, randomly ... not login session changes
// rotation of a link but also clicking back there to that section of copying
// referral code, a server looks for another subdomain of that very country
// randomly."
//
// So the thing that rotates is the LINK HE SHARES, not the address he is
// browsing on. The app asks this every time the Referral screen is opened,
// so going back to it picks again -- over time every one of that country's
// addresses gets used, which spreads invite traffic across all of them
// instead of burning one.
//
// This is the better half of the idea, and it costs nothing: rotating the
// browsing session (see rotateEntry) takes away the member's saved password,
// his offline copy of the app and his installed icon, because a browser
// files all three under one hostname. Rotating only the link he copies has
// none of those costs -- he stays where he is.
//
// Security:
//  - The SERVER picks. No hostname is ever accepted from the request, so a
//    member cannot have his invite link point anywhere he chooses.
//  - HIS OWN COUNTRY ONLY. The region here is already the member's own (the
//    region middleware prefers the account over the hostname), so an invite
//    can never carry another country's address -- where the code would be
//    refused at sign-up as belonging to a different currency, and the
//    invitee would be shown the wrong prices on the way there.
//  - CLAIMED ADDRESSES ONLY, drawn from the country's own label list. A
//    made-up label resolves to the founding country and is not allowed to
//    reach the backend, so an invite built on one would simply be dead.
//  - The referral CODE is untouched; only the hostname varies. Every invite
//    link stays valid whichever of the country's addresses it names.
app.get('/public/share-host', async (req, res) => {
  // A failure here must never cost a member his invite link: an empty host
  // means "use the address you are already on", which always works.
  const stay = { status: 'success', host: '', count: 0 };
  try {
    const region = currentRegion();
    const pool = (region.labels || [])
      .map(l => (_baseDomain ? l + '.' + _baseDomain : ''))
      .filter(Boolean);
    if (!pool.length) return res.json(stay);
    // ── THE WHOLE POOL, SHUFFLED, IN ONE ANSWER ──
    // Owner: "l also need ... faster changing of the subdomain rations."
    //
    // This used to return ONE address, so every open of the Referral screen
    // cost a round trip before the invite link could be painted -- and it
    // was painted twice, once with the address he is browsing on and again
    // when the answer landed, so the link visibly changed under him.
    //
    // Handing over the shuffled pool lets the app advance to the next
    // address locally on each open: instant, and still every address in turn
    // rather than one burnt. The SERVER still decides what is in the pool
    // and in what order, so none of Round 157's rules are weakened -- no
    // hostname is accepted from the request, it is this member's own country
    // only, and only addresses that country actually claims are in it.
    //
    // Shuffled with the CSPRNG (Fisher-Yates), not Math.random: this is the
    // same "a member sees a long run of these outputs" argument the spin
    // reward records, and a predictable order would make one address the
    // first pick for everybody.
    const shuffled = pool.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = crypto.randomInt(i + 1);
      const t = shuffled[i]; shuffled[i] = shuffled[j]; shuffled[j] = t;
    }
    // `host` stays in the reply for a phone still running the previous
    // build: it reads that field and ignores `hosts`, so an old app keeps
    // working exactly as it did rather than losing its invite link.
    res.json({ status: 'success', host: shuffled[0], hosts: shuffled, count: shuffled.length });
  } catch (e) { res.json(stay); }
});
// Members must never be shown a payout the purchase won't actually honour,
// so this endpoint publishes RESOLVED figures instead of the raw stored
// fields. It resolves them with exactly the rules /invest/create uses:
// productExpectedReturn() (multiplier beats expectedReturn beats the global
// returnMultiple), then `cycle || sett.cycleDays`, then the same
// round(expectedReturn / cycle) daily figure that is stamped onto the
// investment doc. Before this, every client re-derived the payout with its
// own slightly different formula -- the product card preferred a stored
// expectedReturn over the multiplier and fell back to x3, the buy-confirm
// dialog ignored the multiplier entirely and fell back to x30. So setting a
// multiplier on a product that still had an inherited expectedReturn made
// the app quote one total and the server credit another.
// /admin/products deliberately still returns the RAW values, so the editor
// keeps round-tripping exactly what was typed into it.
// ── WHEN A PRODUCT IS OPEN ──
//
// Owner: "make when l can time any product on its opening duration ie it can
// say coming soon in hh:mm:ss, make when l can put that this and this product
// should be coming or opening at this time of day from this minute to this
// minute, or even just putting as it is that coming soon."
//
// Three ways to close a product, in this order of precedence:
//   1. comingSoon        — closed flat, no clock. The existing checkbox.
//   2. openAt            — closed UNTIL one specific moment, then open for good.
//   3. openFrom/openTo   — a DAILY window in EAT ("14:00" to "16:30"). Open
//                          inside it, closed outside, every day.
// Nothing set = open.
//
// This returns an ABSOLUTE epoch-ms `opensAt`, and the client counts down to
// that. It deliberately does not send "seconds remaining": the phone's clock
// and timezone are whatever the member has set them to, and a countdown
// computed on the phone from a wall-clock window would be wrong by hours for
// anyone not in EAT. The server owns the schedule; the phone owns only the
// ticking.
//
// A window is allowed to WRAP MIDNIGHT (22:00 to 02:00) -- that is a real
// thing to want, and treating from>to as invalid would silently reject it.
function hhmmToMin(v) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(v || '').trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
function productOpenState(p, nowMs) {
  const now = Number(nowMs) || Date.now();
  if (p && p.comingSoon === true) return { open: false, mode: 'soon', opensAt: null };
  const openAt = Number(p && p.openAt) || 0;
  if (openAt && now < openAt) return { open: false, mode: 'until', opensAt: openAt };
  const from = hhmmToMin(p && p.openFrom);
  const to = hhmmToMin(p && p.openTo);
  // Both halves are required for a window; one alone is not a schedule.
  if (from == null || to == null || from === to) return { open: true, mode: null, opensAt: null };
  const DAY = 86400000, MIN = 60000;
  // Minutes since EAT midnight, and the instant that midnight happened.
  const eatNow = now + tzOffMs();
  const eatMidnight = Math.floor(eatNow / DAY) * DAY - tzOffMs();
  const minsIn = Math.floor((eatNow - Math.floor(eatNow / DAY) * DAY) / MIN);
  const wraps = to < from;
  const inside = wraps ? (minsIn >= from || minsIn < to) : (minsIn >= from && minsIn < to);
  if (inside) {
    // When it shuts again -- today's `to`, or tomorrow's if the window wraps
    // and we are in the after-midnight half.
    const closeMin = to;
    let closesAt = eatMidnight + closeMin * MIN;
    if (closesAt <= now) closesAt += DAY;
    return { open: true, mode: 'window', opensAt: null, closesAt };
  }
  let opensAt = eatMidnight + from * MIN;
  if (opensAt <= now) opensAt += DAY;
  return { open: false, mode: 'window', opensAt };
}
function publicProductView(p, sett) {
  const cycle = Number(p.cycle) || Number(sett && sett.cycleDays) || 150;
  const expectedReturn = productExpectedReturn(p, sett);
  const st = productOpenState(p, Date.now());
  return { ...p, cycle, expectedReturn, dailyPayout: Math.round(expectedReturn / cycle),
    isOpen: st.open, openMode: st.mode, opensAt: st.opensAt || null, closesAt: st.closesAt || null };
}
// ── WHY THESE READS CARRY AN ETag ──
// Owner: "l also need faster loading."
//
// MEASURED, not assumed (test-boot-speed.py): the loading screen waits for
// about 1.3 MB of JSON on a first open, and 900 KB of that is
// /public/petro-images alone -- every admin-uploaded image travels as a
// base64 data: URL inside JSON, and none of these replies carried a single
// cache header, so every launch re-downloaded the lot.
//
// An ETag turns the repeat into a 304 with no body. `no-cache` means "always
// ask, but a 304 is enough": the bytes go away while an upload is still
// visible on the very next open, which matters for settings and prices.
// The image bundles take a short max-age on top, because artwork changes
// once a month and a round trip per launch for something unchanged is the
// thing being removed.
//
// The ETag is a hash of the body we were about to send, so it is correct by
// construction -- no version counter to forget to bump when a slot changes.
// Weak (`W/`), because the body is JSON built per request: two equal payloads
// may differ in key order across restarts, and a weak tag is the honest claim
// ("semantically the same"), not a byte-for-byte one.
//
// The browser only revalidates an HTTP/1.1 response, which is fine here and
// was a real trap in the harness -- see test-boot-speed.py's own note.
function publicJson(req, res, body, cacheControl) {
  let raw;
  try { raw = JSON.stringify(body); } catch (_) { return res.json(body); }
  const etag = 'W/"' + crypto.createHash('sha1').update(raw).digest('base64').slice(0, 22) + '"';
  res.set('Cache-Control', cacheControl || 'no-cache');
  res.set('ETag', etag);
  // Vary on Origin: the CORS headers differ per origin and these replies are
  // per REGION, which is resolved from the hostname -- without this a shared
  // cache could hand one country's prices to another.
  res.vary('Origin');
  if (req.headers['if-none-match'] === etag) return res.status(304).end();
  res.set('Content-Type', 'application/json; charset=utf-8');
  return res.send(raw);
}
// 60s for the artwork bundles. Long enough that opening the app twice in a
// row costs nothing, short enough that an admin who uploads a banner sees it
// on his own phone within a minute rather than wondering if it saved.
const IMAGE_CACHE = 'public, max-age=60';
app.get('/public/products', async (req, res) => {
  try {
    const [products, sett] = await Promise.all([getProducts(), getSettings()]);
    // Prices: revalidated every time, so a change is never served stale --
    // but unchanged prices cost a 304 instead of every product photo again.
    publicJson(req, res, { status: 'success', products: products.map(p => publicProductView(p, sett)) });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
app.get('/public/banner', async (req, res) => {
  try { publicJson(req, res, { status: 'success', ...(await getHomeBanner()) }, IMAGE_CACHE); }
  catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
// The uploaded banner video's bytes. Deliberately NOT part of /public/banner:
// that JSON is fetched on every app start, this is fetched once and then
// replayed from the phone's own cache.
//
// Range support is not optional here -- iOS Safari refuses to play a video
// whose server cannot serve byte ranges, so without this the banner would
// work on Android and silently do nothing on iPhone.
app.get('/public/banner-video', async (req, res) => {
  try {
    const v = await getHomeBannerVideo();
    if (!v.buf) return res.status(404).end();
    const etag = '"bv-' + v.version + '"';
    // THIS LINE IS WHY THE VIDEO SHOWS AT ALL. helmet sets
    // Cross-Origin-Resource-Policy: same-site globally (see the top of this
    // file), and *.onrender.com subdomains are NOT same-site: onrender.com is
    // on the Public Suffix List, so petro-app.onrender.com and
    // petro-server.onrender.com are separate registrable domains. A <video>
    // is a no-cors subresource load, so CORP applies to it -- and the browser
    // dropped the response with ERR_BLOCKED_BY_RESPONSE.NotSameSite, silently:
    // the owner uploaded a video and Home just showed the fallback hero.
    //
    // API calls were unaffected (CORP does not gate CORS-mode fetches), which
    // is why this was the FIRST thing to break -- the banner video is the
    // app's only cross-origin subresource. The global same-site default stays
    // as it is; it is a real protection for the money endpoints. Only this
    // route, which serves a public decorative clip and nothing else, opts out.
    res.set('Cross-Origin-Resource-Policy', 'cross-origin');
    // The client asks for ?v=<version>, so a new upload is a new URL and the
    // long cache below can never serve a stale clip.
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.set('ETag', etag);
    res.set('Content-Type', v.mime);
    res.set('Accept-Ranges', 'bytes');
    if (req.headers['if-none-match'] === etag) return res.status(304).end();
    const total = v.buf.length;
    const r = parseByteRange(req.headers.range, total);
    if (r === 'invalid') return res.status(416).set('Content-Range', `bytes */${total}`).end();
    if (r) {
      res.status(206).set('Content-Range', `bytes ${r.start}-${r.end}/${total}`);
      res.set('Content-Length', String(r.end - r.start + 1));
      if (req.method === 'HEAD') return res.end();
      return res.end(v.buf.subarray(r.start, r.end + 1));
    }
    res.set('Content-Length', String(total));
    if (req.method === 'HEAD') return res.end();
    res.end(v.buf);
  } catch (e) { res.status(500).end(); }
});
// The installed-app icon and the link-preview card, as real image files.
// Nothing in the app fetches these -- Chrome does, out of manifest.json at
// install time, and the WhatsApp/Telegram/Facebook crawlers do, out of the
// page's og: tags. Their URLs are hard-coded in manifest.json and in
// index.html's <head>, so they must stay exactly what they are forever;
// changing a path here silently breaks the icon and the share card at once.
function serveBrandAsset(slot) {
  return async (req, res) => {
    try {
      // Owner: "make sure that l can enable link preview or no".
      //
      // The og:/twitter: tags are in the STATIC page head, so they cannot be
      // removed per-request -- a crawler reads the file and runs no script.
      // Answering 404 for the image is therefore how "off" is expressed: a
      // crawler that cannot fetch the picture shows the link with no picture,
      // which is exactly the wanted outcome.
      //
      // Scoped to this ONE slot on purpose. The same helper serves the two app
      // icons, and gating those would break the installed home-screen icon --
      // a far worse thing to switch off by accident than a share card.
      if (slot === 'link-preview') {
        const sett = await getSettings();
        if (sett && sett.linkPreviewEnabled === false) {
          // no-store, unlike the 300s below: this is an operator switch, and
          // turning it back ON has to take effect immediately rather than
          // after a cached refusal expires.
          res.set('Cache-Control', 'no-store');
          return res.status(404).end();
        }
      }
      const a = await getBrandAsset(slot);
      if (!a || !a.buf) return res.status(404).end();
      const etag = '"ba-' + slot + '-' + a.version + '"';
      // The same trap the banner video hit, and for the same reason. helmet
      // sets Cross-Origin-Resource-Policy: same-site globally; onrender.com
      // is on the Public Suffix List, so petro-app and petro-server are
      // different SITES; and a manifest icon is a no-cors subresource load,
      // which CORP gates. Without this line the browser drops the icon
      // silently -- API calls keep working, so nothing looks wrong except an
      // install prompt with no icon on it.
      res.set('Cross-Origin-Resource-Policy', 'cross-origin');
      // Five minutes and revalidate, NOT the banner video's immutable year.
      // The video gets a ?v=<version> from the client so a new upload is a
      // new URL; these two cannot -- manifest.json and the og: tags are
      // static files with fixed hrefs -- so the cache is the ONLY thing that
      // decides how long a stale icon survives. ETag keeps the repeat cost
      // at a 304 anyway.
      res.set('Cache-Control', 'public, max-age=300, must-revalidate');
      res.set('ETag', etag);
      res.set('Content-Type', a.mime);
      if (req.headers['if-none-match'] === etag) return res.status(304).end();
      res.set('Content-Length', String(a.buf.length));
      if (req.method === 'HEAD') return res.end();
      res.end(a.buf);
    } catch (e) { res.status(500).end(); }
  };
}
app.get('/public/app-icon-512.png', serveBrandAsset('app-icon-512'));
app.get('/public/app-icon-192.png', serveBrandAsset('app-icon-192'));
app.get('/public/link-preview.jpg', serveBrandAsset('link-preview'));
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
app.get('/public/announcement-image', async (req, res) => {
  try { publicJson(req, res, { status: 'success', image: await getAnnouncementImage() }, IMAGE_CACHE); }
  catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
// The Referral banner and the Account brand logo, in one call -- fetched
// in boot()'s own Promise.all alongside the Home banner so neither pops in.
app.get('/public/petro-images', async (req, res) => {
  try {
    const [referral, logo, spin, profilegif, downloadbg, authhero, authcard, banner2, banner3, homefooter, profilecard] = await Promise.all([
      getPetroImage('referral'), getPetroImage('logo'), getPetroImage('spin'), getPetroImage('profilegif'),
      getPetroImage('downloadbg'), getPetroImage('authhero'), getPetroImage('authcard'),
      getPetroImage('banner2'), getPetroImage('banner3'), getPetroImage('homefooter'), getPetroImage('profilecard'),
    ]);
    // The heaviest reply in the app -- now eleven base64 slots. Measured at
    // 900 KB with the owner's own artwork for the original seven, and it
    // used to be re-sent on every single launch.
    publicJson(req, res, { status: 'success', referral, logo, spin, profilegif, downloadbg, authhero, authcard, banner2, banner3, homefooter, profilecard }, IMAGE_CACHE);
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
// The figures the ticker scrolls are derived from the REGION's own products
// and settings -- see activityPools(). There used to be two hardcoded ladders
// here (a deposit list running 30,000 to 4,500,000 and withdrawals stepping
// 5,000 to 900,000), and both were Ugandan amounts handed to every country.
// On a market where a product costs 500 and the minimum cash-out is 300 that
// is a ticker scrolling figures sixty times too large -- money nobody there
// has ever moved. Owner: "make sure on currency change the activity checker
// should be changing currency too basing on the products and values of the
// system."
function maskedMsisdn(used) {
  // The region's own dialling code, so the ticker on a Kenyan subdomain does
  // not scroll Ugandan-looking numbers past its members.
  const dial = String(currentRegion().dialCode || '256');
  const one = () => dial + '****' + String(Math.floor(Math.random() * 10000)).padStart(4, '0');
  for (let tries = 0; tries < 50; tries++) {
    const n = one();
    if (!used.has(n)) { used.add(n); return n; }
  }
  return one();
}
// What the ticker is allowed to show, for ONE region, built entirely from
// that region's own catalogue and its own limits. Nothing here is a constant.
//
//   deposits    -- the prices its members actually pay: every active product's
//                  price, plus the minimum recharge. Those ARE "the products
//                  and values of the system", and they are already in the
//                  region's own currency because getProducts() resolved them
//                  through the region overlay.
//   withdrawals -- whole multiples of the region's own withdrawal multiple,
//                  from its own minimum upward. A cash-out that is not a legal
//                  amount on that market is a number no member could ever have
//                  requested, so inventing one makes the feed read as fake.
//
// Capped at 40 entries so a market with a 1-unit multiple does not build a
// hundred-thousand-element array, and every pool falls back to something
// non-empty: an empty pool would index undefined and scroll "UGX NaN".
function activityPools(sett, products) {
  const minDep = Math.max(0, finiteMoney(sett && sett.minDeposit));
  const minWit = Math.max(0, finiteMoney(sett && sett.minWithdraw));
  const prices = (products || [])
    .filter(p => p && p.active !== false)
    .map(p => Math.round(finiteMoney(p.price)))
    .filter(n => n > 0);
  let deposits = Array.from(new Set(prices.concat(minDep > 0 ? [minDep] : [])))
    .filter(n => n >= minDep).sort((a, b) => a - b);
  if (!deposits.length) deposits = [minDep > 0 ? minDep : 1];

  // The multiple is a real setting (0 turns the rule off), so fall back to the
  // minimum itself rather than to a number of our own choosing.
  let step = Math.round(Math.max(0, finiteMoney(sett && sett.withdrawMultiple)));
  if (step <= 0) step = minWit > 0 ? minWit : Math.max(1, Math.round(deposits[0] / 10));
  const first = Math.max(step, Math.ceil(Math.max(minWit, step) / step) * step);
  const ceiling = Math.max(first, deposits[deposits.length - 1]);
  const withdrawals = [];
  for (let a = first; a <= ceiling && withdrawals.length < 40; a += step) withdrawals.push(a);
  if (!withdrawals.length) withdrawals.push(first);
  return { deposits: deposits.slice(0, 40), withdrawals };
}
async function buildActivityFeed() {
  const sett = await getSettings();
  let products = [];
  try { products = await getProducts(); } catch (_) {}
  const { deposits, withdrawals } = activityPools(sett, products);
  const rows = [];
  const usedNumbers = new Set();
  for (let i = 0; i < 60; i++) {
    const kind = Math.random() < 0.6 ? 'deposit' : 'withdraw';
    const pool = kind === 'deposit' ? deposits : withdrawals;
    rows.push({ kind, phone: maskedMsisdn(usedNumbers), amount: pool[Math.floor(Math.random() * pool.length)] });
  }
  return rows;
}
// Cached PER REGION. It used to be one module-level array shared by every
// country, and that was a real bug with an ugly shape: buildActivityFeed() is
// already region-correct inside it -- getSettings(), getProducts() and
// maskedMsisdn() all read the request's region out of the AsyncLocalStorage
// store -- so whichever country's request happened to build the feed first
// won, and every other country was served that country's amounts and dialling
// code for as long as the process lived.
//
// It reads WORSE than an obviously wrong number, because the client labels the
// amount with its OWN currency (fmtUGX -> cur()): a Kenyan member saw Ugandan
// product prices with "KES" in front of them. Owner: "make sure on currency
// change, the activity checker should be changing currency too basing on the
// products and values of the system."
//
// A cache in front of a region-aware builder has to carry the region in its
// key. The same trap is available to anything else module-level here.
const _activityCache = new Map(); // regionKey -> { feed, ts, building }
function activitySlot() {
  const key = currentRegionKey() || DEFAULT_REGION_KEY;
  let slot = _activityCache.get(key);
  if (!slot) { slot = { feed: [], ts: 0, building: false }; _activityCache.set(key, slot); }
  return slot;
}
app.get('/public/activity-feed', async (_req, res) => {
  const slot = activitySlot();
  if (!slot.feed.length && !slot.building) {
    slot.building = true;
    try { slot.feed = await buildActivityFeed(); slot.ts = Date.now(); }
    catch (e) { console.error('Activity feed error:', e.message); }
    finally { slot.building = false; }
  } else if (!slot.building && Date.now() - slot.ts > 4000) {
    slot.building = true;
    buildActivityFeed().then(f => { slot.feed = f; slot.ts = Date.now(); })
      .catch(e => console.error('Activity feed error:', e.message))
      .finally(() => { slot.building = false; });
  }
  res.json({ status: 'success', feed: slot.feed });
});

// ═══════════════════════════════════════════
// REGISTRATION / ACCOUNT
// ═══════════════════════════════════════════
// A 6-digit trade password, per Petro's registration spec (Snow used 5) —
// rejects the weakest shape
// (all-same-digit) whenever a NEW PIN is being chosen, never when an
// existing one is being verified.
function isWeakPin(pin) { return /^(\d)\1{5}$/.test(String(pin || '')); }

// `regionKey` is stamped here, ONCE, from the region that owns the hostname
// the account was created on, and is never written again. Everything the
// member ever sees or is charged -- currency, product prices, minimums,
// cash-out hours, their number's shape -- is read from it for the life of
// the account, on whatever hostname they open next. See the REGIONS section
// for why it must not come from the request.
function defaultProfileDoc(phone, regionKey) {
  return {
    regionKey: String(regionKey || currentRegionKey() || DEFAULT_REGION_KEY),
    phone: phone || '', walletBalance: 0, totalDeposited: 0, totalEarned: 0, totalWithdrawn: 0, totalInvested: 0,
    // lastCheckinClaimDay is the durable "this EAT day is already claimed"
    // marker, written atomically with the check-in credit. Kept separate from
    // lastCheckinAt because reconcilers recompute that one from the ledger --
    // see the /checkin handler's own comment.
    checkinStreak: 0, lastCheckinAt: null, lastCheckinClaimDay: null,
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
// Is there at least one fully registered member yet? Only ever asked to
// decide whether a referral code CAN be required, so it latches: once a
// member exists the answer can never go back to "no", and the query is never
// run again. Before that it is a single limit(1) read, so an empty platform
// pays almost nothing for it either.
let _anyMemberExists = false;
async function anyMemberExists() {
  if (_anyMemberExists) return true;
  try {
    const snap = await db.collection('users').where('registrationDone', '==', true).limit(1).get();
    if (!snap.empty) _anyMemberExists = true;
  } catch (_) {
    // A read failure must not hand out an unearned exemption -- assume
    // members exist and keep the code required.
    return true;
  }
  return _anyMemberExists;
}
// The owner's rule is that a referral code is a MUST. That cannot apply to
// the very first account: with no members there is no code in existence to
// type, so a hard requirement would make the platform impossible to launch
// (the owner's own question -- "how to create user account yet no referral
// code???"). So the requirement switches itself on the moment the first
// member completes registration, and the admin toggle can lift it again if
// someone ever needs onboarding with no upline.
async function referralRequiredNow() {
  const sett = await getSettings();
  if (sett.requireReferralCode === false) return false;
  return await anyMemberExists();
}
// Shared by the member's own /register — the ONE place that ever assigns a
// referral code, links a referrer's team counts, sets the Trade Password,
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

    // Trade Password (PIN) requirement REMOVED (owner: registration is
    // exactly phone/OTP/password/confirm/referral, nothing else -- see
    // /withdraw/request's own comment for the full reasoning). `pin` is
    // still accepted as a parameter -- unused now -- rather than reworking
    // every call site's argument list for a field that may as well stay
    // silently ignored if an old client still sends one.
    const code = String(referralCode || '').trim();
    let referrerId = null;
    // The "referral code is a must" rule lives HERE, not only in the app --
    // the app's own check is a convenience, and a direct POST /register with
    // an empty code used to sail past it and create an uplineless account.
    if (!code && await referralRequiredNow())
      return { code: 400, body: { status: 'error', code: 'REFERRAL_REQUIRED', message: 'A referral code is required to sign up. Ask the person who invited you for theirs.' } };
    if (code) {
      const refDoc = await findUserByReferralCode(code);
      if (!refDoc)
        return { code: 400, body: { status: 'error', code: 'BAD_REFERRAL', message: 'That referral code does not exist.' } };
      if (refDoc.id === userId)
        return { code: 400, body: { status: 'error', code: 'BAD_REFERRAL', message: 'You cannot use your own referral code.' } };
      if (refDoc.data().status === 'banned')
        return { code: 400, body: { status: 'error', code: 'BAD_REFERRAL', message: 'That referral code is no longer active.' } };
      // A code from a country on a DIFFERENT CURRENCY is refused. Commission
      // is a percentage of what the new member spends, paid into the
      // referrer's wallet: pay 27% of a 30,000 KES purchase into a Ugandan
      // wallet and the figure is arithmetically right and worth roughly
      // eight times what it should be.
      //
      // Matched on CURRENCY, not on the region id. It used to refuse any
      // code from a different region id, and that made signing up
      // impossible: a short address pointing at the wrong country (or a
      // country re-created under a new id) puts the new member in a
      // different region from every existing member, so every real referral
      // code was refused -- and a referral code is required to sign up, so
      // the whole country was shut. Reported as "make sure referrals are
      // working". Two regions sharing a currency have no arithmetic problem,
      // which is the only thing this rule was ever protecting.
      const refRegion = String(refDoc.data().regionKey || DEFAULT_REGION_KEY);
      const myRegion = String(currentRegionKey() || DEFAULT_REGION_KEY);
      if (refRegion !== myRegion) {
        const a = regionByKey(refRegion), b = regionByKey(myRegion);
        if (String(a.currency || '') !== String(b.currency || ''))
          return { code: 400, body: { status: 'error', code: 'BAD_REFERRAL_REGION', message: `That referral code belongs to a member in ${a.name || 'another country'}, which uses ${a.currency || 'another currency'}. Ask for a code from someone signed up on this site.` } };
      }
      referrerId = refDoc.id;
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
        walletBalance: FieldValue.increment(WELCOME),
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
    // A member now exists, so the founder exemption above closes from here
    // on: the next sign-up must carry a code. Latched in memory rather than
    // re-queried, and anyMemberExists() re-derives it after a restart.
    _anyMemberExists = true;
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
// ── OTP endpoints ──
// /auth/otp/send is deliberately reachable WITHOUT a Firebase session for
// 'register' and 'reset' -- a phone verifying itself before an account
// exists (register) or while its owner cannot sign in (reset) is exactly
// what OTP is for. 'bank' is the one purpose that DOES require a session:
// the phone texted is resolved from the caller's own account on file, never
// from the request body, so a logged-in member cannot use this to spam an
// arbitrary number.
app.post('/auth/otp/send', async (req, res) => {
  try {
    const purpose = String(req.body.purpose || '');
    if (!OTP_PURPOSES.has(purpose)) return res.status(400).json({ status: 'error', message: 'Invalid verification purpose' });
    let phone;
    if (purpose === 'bank') {
      const userId = await verifyAuth(req);
      if (!userId) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
      const uSnap = await db.collection('users').doc(userId).get();
      if (!uSnap.exists) return res.status(404).json({ status: 'error', message: 'User not found' });
      if (uSnap.data().status === 'banned') return res.status(403).json({ status: 'error', code: 'BANNED', message: 'Account suspended. Contact customer service.' });
      phone = cleanPhone(uSnap.data().phone || '');
      if (!phone) return res.status(400).json({ status: 'error', message: 'Your account has no valid phone number on file. Contact support.' });
    } else {
      phone = cleanPhone(req.body.phone || '');
      if (!phone) return res.status(400).json({ status: 'error', message: badPhoneMessage() });
      const existing = await db.collection('users').where('phone', '==', phone).limit(1).get();
      // 'register' checks registrationDone specifically, not just any row --
      // a Mongo profile can exist with registrationDone:false from an earlier
      // attempt that crashed between Firebase account creation and finishing
      // /register (the same "ghost account" doRegister()'s own comment
      // already handles). Blocking THAT here would wrongly refuse a member
      // simply retrying their own incomplete signup.
      if (purpose === 'register' && existing.docs.some(d => d.data().registrationDone))
        return res.status(400).json({ status: 'error', message: 'An account with this phone number already exists.' });
      if (purpose === 'reset' && existing.empty)
        return res.status(400).json({ status: 'error', message: 'No account found with this phone number.' });
    }
    if (!MARZSMS_KEY) return res.status(503).json({ status: 'error', message: 'SMS verification is not available right now. Try again later.' });
    const allowed = await otpCheckAndBumpDailyLimit(phone, purpose);
    if (!allowed) return res.status(429).json({ status: 'error', message: 'Too many verification codes requested for this number today. Try again tomorrow.' });
    const code = generateOtpCode();
    const otpRef = db.collection('otpCodes').doc();
    await otpRef.set({
      phone, purpose, codeHash: scryptHash(code), attempts: 0, verified: false,
      ticket: null, ticketExpiresAt: null, consumedAt: null,
      expiresAt: new Date(Date.now() + OTP_EXPIRES_MS), createdAt: FieldValue.serverTimestamp(),
    });
    try {
      await marzSmsSend(phone, `Your Petro verification code is ${code}. It expires in 10 minutes. Do not share this code with anyone.`);
    } catch (e) {
      await otpRef.delete().catch(() => {});
      throw e;
    }
    res.json({ status: 'success', otpId: otpRef.id, expiresInSec: OTP_EXPIRES_MS / 1000 });
  } catch (e) {
    console.error('OTP send error:', e.message);
    res.status(500).json({ status: 'error', message: 'Could not send a verification code right now' });
  }
});
app.post('/auth/otp/verify', async (req, res) => {
  try {
    const otpId = String(req.body.otpId || '');
    const code = String(req.body.code || '').trim();
    if (!otpId || !code) return res.status(400).json({ status: 'error', message: 'Missing verification code' });
    const ref = db.collection('otpCodes').doc(otpId);
    const snap = await ref.get();
    if (!snap.exists) return res.status(400).json({ status: 'error', message: 'Invalid or expired code. Request a new one.' });
    const o = snap.data();
    if (o.consumedAt) return res.status(400).json({ status: 'error', message: 'This code has already been used.' });
    if (Date.now() > tsMillis(o.expiresAt)) return res.status(400).json({ status: 'error', message: 'This code has expired. Request a new one.' });
    if ((o.attempts || 0) >= OTP_MAX_ATTEMPTS) return res.status(429).json({ status: 'error', message: 'Too many incorrect attempts. Request a new code.' });
    if (!scryptVerify(code, o.codeHash)) {
      await ref.update({ attempts: FieldValue.increment(1) });
      return res.status(400).json({ status: 'error', message: 'Incorrect code.' });
    }
    // Re-verifying an already-verified code (a double-tap, a resent
    // response) just re-issues a fresh ticket rather than erroring -- the
    // code itself was already proven correct once, refusing here would only
    // punish a harmless retry.
    const ticket = crypto.randomUUID();
    await ref.update({ verified: true, ticket, ticketExpiresAt: new Date(Date.now() + OTP_TICKET_EXPIRES_MS) });
    res.json({ status: 'success', ticket, expiresInSec: OTP_TICKET_EXPIRES_MS / 1000 });
  } catch (e) {
    console.error('OTP verify error:', e.message);
    res.status(500).json({ status: 'error', message: 'Could not verify the code right now' });
  }
});
// Forgot-password. No Firebase session -- the whole point is the member
// cannot sign in. Identity is proven by the OTP ticket alone; the password
// itself is changed via the Admin SDK, the same call
// /admin/user/reset-password already uses, just self-served here once a
// ticket backs it instead of an owner's say-so.
app.post('/auth/reset/confirm', async (req, res) => {
  try {
    const phone = cleanPhone(req.body.phone || '');
    if (!phone) return res.status(400).json({ status: 'error', message: badPhoneMessage() });
    const newPassword = String(req.body.newPassword || '');
    if (newPassword.length < 6) return res.status(400).json({ status: 'error', message: 'Password must be at least 6 characters.' });
    const ticketOk = await consumeOtpTicket(String(req.body.ticket || ''), phone, 'reset');
    if (!ticketOk) return res.status(400).json({ status: 'error', code: 'OTP_REQUIRED', message: 'Please verify your phone number first.' });
    const uSnap = await db.collection('users').where('phone', '==', phone).limit(1).get();
    if (uSnap.empty) return res.status(404).json({ status: 'error', message: 'No account found with this phone number.' });
    const userId = uSnap.docs[0].id;
    await admin.auth().updateUser(userId, { password: newPassword });
    logSecurityEvent(userId, 'password_reset_self_service', null);
    res.json({ status: 'success', message: 'Password reset. You can now sign in.' });
  } catch (e) {
    console.error('Reset confirm error:', e.message);
    res.status(500).json({ status: 'error', message: 'Could not reset your password right now' });
  }
});
app.post('/register', async (req, res) => {
  const auth = await verifyAuthWithEmail(req);
  if (!auth) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const userId = auth.uid;
  try {
    const phone = phoneFromVerifiedEmail(auth.email, req.body.phone);
    if (!phone) return res.status(400).json({ status: 'error', message: badPhoneMessage() });
    // Skip the ticket check on a retry of an ALREADY-completed registration
    // (network drop after success, client resubmits) -- completeRegistrationCore
    // is idempotent for that case on its own (registrationDone short-circuit
    // below), and the ticket from the original successful call is already
    // consumed, so requiring it again would fail a registration that in fact
    // already succeeded.
    const already = await db.collection('users').doc(userId).get();
    if (!already.exists || !already.data().registrationDone) {
      const ticketOk = await consumeOtpTicket(String(req.body.otpTicket || ''), phone, 'register');
      if (!ticketOk) return res.status(400).json({ status: 'error', code: 'OTP_REQUIRED', message: 'Please verify your phone number first.' });
    }
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
    // Owner: "no incomplete registration saying code not set." A finished
    // registration always assigns a referral code, but a member could still
    // be left without one -- an account created before codes existed, or a
    // registration that crashed between creating the profile doc and
    // generateUniqueReferralCode()'s write. Rather than showing that member a
    // blank Referral tab forever, issue one now. Costs a single extra read on
    // the rare account that needs it and nothing at all on every other.
    if (u.registrationDone && !u.referralCode) {
      try {
        u.referralCode = await generateUniqueReferralCode(uid);
        console.warn(`Backfilled missing referral code for ${uid}: ${u.referralCode}`);
      } catch (e) { console.error('Referral code backfill failed:', e.message); }
    }
    res.json({ status: 'success', account: {
      phone: u.phone, walletBalance: u.walletBalance || 0, totalDeposited: u.totalDeposited || 0,
      totalEarned: u.totalEarned || 0, totalWithdrawn: u.totalWithdrawn || 0, totalInvested: u.totalInvested || 0,
      checkinStreak: u.checkinStreak || 0, lastCheckinAt: u.lastCheckinAt || null,
      referralCode: u.referralCode || null, publicId: u.publicId || null, registrationDone: !!u.registrationDone,
      team: { l1: u.teamL1Count || 0, l2: u.teamL2Count || 0, l3: u.teamL3Count || 0, commission: u.teamCommission || 0 }
    // The member's OWN region, which the middleware has already put in
    // force for this request. The app re-reads its currency, dialling code
    // and number rules from here on every account load, so a member who
    // opens another country's subdomain still sees their own figures.
    }, region: publicRegionView() });
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
      // ── THE DURABLE CLAIM IS A FIELD OF ITS OWN ──
      // Audit finding, CONFIRMED: this gate used to be `lastKey === todayKey`
      // alone -- and `lastKey` comes from computeCheckinStreak(), which reads
      // the TRANSACTIONS LEDGER, while the claim was written to the USER
      // DOCUMENT. Two different facts. So if the wallet credit landed and the
      // ledger row then failed, the endpoint returned 500, the retry
      // reconstructed eligibility from a ledger with no row for today, and
      // the SAME day's check-in credited the wallet again. Repeatable once
      // per failed ledger write. withLock does not help: the retry is a new
      // request, arriving after that lock has already been released.
      //
      // `lastCheckinClaimDay` is now the claim, written in the same atomic
      // user-document update as the money. It is deliberately NOT
      // `lastCheckinAt`: that field is recomputed from the ledger by
      // /admin/user/reconcile-checkin and by recountAllTotals's freshness
      // pass, so a reconciler could roll the claim back to a ledger that is
      // missing today's row and re-open the same hole. Nothing else in this
      // file writes lastCheckinClaimDay.
      //
      // The LEDGER is still what the streak NUMBER is derived from -- that is
      // its original job (see computeCheckinStreak's header) and is unchanged.
      // Only the "may I claim today" question moved.
      const claimDay = u.lastCheckinClaimDay || null;
      // Both are checked, not just the new field: members who claimed before
      // this field existed have no claimDay, and their ledger row for today
      // is the only evidence of it. Without the second half of this test,
      // deploying the fix would hand everyone who had already checked in that
      // day one extra check-in.
      if (claimDay === todayKey || lastKey === todayKey) {
        logSecurityEvent(uid, 'checkin_already_claimed', null);
        // Repair a ledger row that went missing when its write failed after
        // the credit. Deterministic id, so this cannot duplicate a row that
        // is already there -- and it restores the streak, which would
        // otherwise reset tomorrow because the ledger has a hole in it.
        try {
          await db.collection('transactions').doc(`checkin:${uid}:${todayKey}`).createIfAbsent({
            userId: uid, type: 'checkin', description: `Daily check-in, day ${u.checkinStreak || 1}`,
            amount: Number(sett.dailyCheckin) || 0, status: 'success',
            date: nowStr().date, time: nowStr().time, createdAt: FieldValue.serverTimestamp(),
          });
        } catch (_) {}
        result = { code: 400, body: { status: 'error', message: 'Already checked in today. Come back after midnight.', nextCheckinAt: eatNextMidnight(now) } };
        return;
      }
      const yesterdayKey = eatDayKey(new Date(now - 86400000));
      const streak = (lastKey === yesterdayKey) ? real.streak + 1 : 1;
      const bonus = Number(sett.dailyCheckin) || 0;
      // Nested under bal:<uid> -- see settleInvestmentIfDue's own comment.
      //
      // CONDITIONAL, not a blind update: the claim and the money move in one
      // atomic document write, and only if this day has not already been
      // claimed. The read above can be stale (a concurrent request, a retry);
      // this cannot. If it does not apply, somebody else already claimed
      // today and nothing has been credited.
      const applied = await withLock('bal:' + uid, () => ref.updateIf(
        { lastCheckinClaimDay: { $ne: todayKey } },
        {
          walletBalance: FieldValue.increment(bonus), totalEarned: FieldValue.increment(bonus),
          lastCheckinAt: now, checkinStreak: streak, lastCheckinClaimDay: todayKey,
        }
      ));
      if (!applied) {
        result = { code: 400, body: { status: 'error', message: 'Already checked in today. Come back after midnight.', nextCheckinAt: eatNextMidnight(now) } };
        return;
      }
      const { date, time } = nowStr();
      // Independently idempotent, and deliberately NOT allowed to undo the
      // claim. The spendable balance is already correct; re-opening the claim
      // because a bookkeeping row failed is the exact double-credit path this
      // whole change exists to close. Surface it loudly instead -- and the
      // deterministic id means the next attempt today repairs it.
      try {
        await db.collection('transactions').doc(`checkin:${uid}:${todayKey}`).createIfAbsent({
          userId: uid, type: 'checkin', description: `Daily check-in, day ${streak}`,
          amount: bonus, status: 'success', date, time, createdAt: FieldValue.serverTimestamp()
        });
      } catch (ledgerErr) {
        console.error(`MONEY-SAFETY: check-in bonus ${bonus} credited to ${uid} for ${todayKey} but its transaction row failed; the claim stands to prevent a double credit.`, ledgerErr.message);
      }
      result = { code: 200, body: { status: 'success', bonus, streak, nextCheckinAt: eatNextMidnight(now) } };
    });
    res.status(result.code).json(result.body);
  } catch (e) {
    console.error('Checkin error:', e.message);
    res.status(500).json({ status: 'error', message: 'Check-in failed' });
  }
});

// ═══════════════════════════════════════════
// TURNTABLE (daily spin wheel)
// ═══════════════════════════════════════════
// A Petro-only feature -- Snow has no equivalent, so none of this is a port.
//
// Two spin sources, deliberately kept as separate concepts because they pay
// differently and must not be able to subsidise each other:
//   1. One FREE spin per EAT calendar day, paying a random amount inside the
//      admin's [turntableDailyMin, turntableDailyMax] band.
//   2. Spins EARNED by buying a product, each paying a random amount from
//      that product's own spinMin/spinMax band. Configured per product
//      (spinCount/spinMin/spinMax) because the owner wants every product to
//      be able to pay differently.
//
// Earned spins are stored as individual `turntableSpins` documents rather
// than a counter, because each one carries its own payout basis (the price
// of the product that granted it). A counter would lose that, and a member
// who bought a cheap tier then an expensive one would be paid the wrong
// amount on one of them.
async function grantTurntableSpins(userId, product, investmentId) {
  try {
    const sett = await getSettings();
    if (!sett.turntableEnabled) return;
    // Idempotent per purchase. This is fire-and-forget from /invest/create,
    // so nothing today calls it twice -- but a bonus that pays out again on
    // a retry is the kind of thing a later caller adds by accident, and one
    // query is cheap next to silently double-granting.
    //
    // The check and the writes it guards run INSIDE one lock, because on its
    // own it is a read-then-write: two calls for the same investmentId could
    // both find nothing and both grant, which is the double-grant the query
    // exists to stop. Keyed on the investment so two different purchases
    // still run concurrently. Owner's question -- "what if a product spin and
    // a daily spin combine together, can't it override??" -- is about the
    // SPENDING side, which was already safe; this is the granting side, where
    // the only hole actually was.
    // AWAITED, not returned: this is called fire-and-forget from
    // /invest/create with no .catch(), so a returned promise would carry any
    // rejection straight past the handler below and out as an unhandled
    // rejection.
    if (!investmentId) { await writeTurntableSpinDocs(userId, product, null, 0); return; }
    await withLock('spingrant:' + investmentId, async () => {
      const already = await db.collection('turntableSpins')
        .where('investmentId', '==', investmentId).get();
      // A previous attempt may have died halfway through the loop. The old
      // existence-only guard treated one surviving row as "all spins were
      // granted" forever. Count the durable rows and fill only the missing
      // tail while this investment lock excludes concurrent grant attempts.
      await writeTurntableSpinDocs(userId, product, investmentId, already.size);
    });
  } catch (e) {
    // Never let this break a purchase that has already been paid for. The
    // member keeps their product; the spin is simply not granted, and the
    // failure is loud in the logs rather than silently swallowed.
    console.error(`Turntable: failed to grant spins to ${userId} for ${product && product.key}:`, e.message);
  }
}
// The writes themselves. Split out only so the idempotency query above and
// these can share one lock; it has no try/catch of its own because its single
// caller already wraps it, and swallowing an error here would let that caller
// report a grant it did not make.
async function writeTurntableSpinDocs(userId, product, investmentId, existingCount) {
    // Per-product config: how many spins this purchase grants, and the band
    // each of those spins pays from. A product with no spinCount grants
    // none, which is how "the cheapest product earns nothing" is expressed --
    // there is no global tier threshold any more.
    // Every one of these is re-clamped from the STORED product rather than
    // trusted: this loop writes a document per iteration and each document
    // is money, so the bound and the band are validated where they are used,
    // not only where they were saved.
    const count = Math.min(MAX_SPINS_PER_PURCHASE,
      Math.max(0, Math.floor(Number(product && product.spinCount) || 0)));
    if (!count) return;
    const lo = Math.min(MAX_MONEY_AMOUNT, Math.max(0, Number(product.spinMin) || 0));
    const hi = Math.min(MAX_MONEY_AMOUNT, Math.max(lo, Number(product.spinMax) || 0));
    if (hi <= 0) return;
    const { date, time } = nowStr();
    const start = Math.min(count, Math.max(0, Math.floor(Number(existingCount) || 0)));
    for (let i = start; i < count; i++) {
      // The band is SNAPSHOT onto the spin, not looked up when it is spun.
      // A member who earned a spin under one configuration keeps that deal
      // even if the admin retunes the product afterwards -- and an admin
      // lowering a payout cannot retroactively shrink spins already earned.
      const spinData = {
        // investmentId ties the spin to the purchase that paid for it: it is
        // what makes the guard above work, and it is the only way to answer
        // "where did this spin come from" when auditing a member's account.
        userId, investmentId: investmentId || null, grantOrdinal: i,
        spinMin: lo, spinMax: hi, source: 'product',
        productKey: product.key, productName: product.name,
        used: false, date, time, createdAt: FieldValue.serverTimestamp(),
      };
      if (investmentId) {
        await db.collection('turntableSpins')
          .doc(`grant:${investmentId}:${i}`).createIfAbsent(spinData);
      } else {
        await db.collection('turntableSpins').add(spinData);
      }
    }
}
// One shared roll for both spin kinds -- the daily band from settings, or a
// product spin's own snapshot band.
// This decides how much money a member is paid, so it does NOT use
// Math.random(). V8's Math.random is a seeded xorshift128+ whose internal
// state can be recovered from a modest run of outputs -- and a member sees
// every one of their own spin results, which is exactly such a run. The
// exposure was bounded (nobody can win past spinMax either way), but a
// predictable generator has no business deciding payouts when the fix is
// one line. crypto.randomInt is a CSPRNG and draws from a uniform range
// with no modulo bias.
//
// Resolution is 1/100 of a shilling, matching round2()'s own precision, so
// nothing is lost by working in integer cents here.
// ── THE WHEEL'S OWN SLICES ──
// Owner: "why the spin wheel has no amounts?" -- because there were none to
// show. The payout used to be any figure at all between the admin's minimum
// and maximum, so no slice could be labelled with anything.
//
// The eight amounts a member sees on the wheel and the eight the payout is
// drawn from MUST be the same list, or the wheel lands on 600 while the
// wallet gets 587 -- a money screen telling a lie. So they are computed HERE,
// used by the roll, and handed to the client to render. One source of truth,
// with no second copy in the app to keep in step (this project already keeps
// one such pair by hand -- phoneToEmail -- and needs a dedicated test to
// prove the two still agree; that is not a pattern worth repeating).
//
// The band is still the owner's: turntableDailyMin/Max for the free daily
// spin, and each product's own spinMin/spinMax snapshotted onto the spins it
// earned. Nothing new to configure, which is what he asked for -- "basing on
// the set spin ranges on products amount ranges and that amount of daily
// spin".
var SPIN_SLICES = 8;
function spinWheelSlices(lo, hi) {
  lo = Math.max(0, finiteMoney(lo));
  hi = Math.max(lo, finiteMoney(hi));
  // A zero-width band is not a broken one: an admin who sets min == max means
  // every spin pays exactly that, and the honest wheel shows it on all eight.
  if (hi <= lo) return new Array(SPIN_SLICES).fill(round2(lo));
  // Evenly spaced from lo to hi inclusive, then rounded to a step that suits
  // the band's own width so the figures read as money rather than as
  // arithmetic: 200 / 310 / 430 ... rather than 200 / 314.29 / 428.57. The
  // two ENDS stay exactly lo and hi, because those are the numbers the copy
  // under the wheel promises and the admin typed.
  const span = hi - lo;
  const step = span >= 8000 ? 500 : span >= 800 ? 50 : span >= 80 ? 5 : 1;
  const out = [];
  for (let i = 0; i < SPIN_SLICES; i++) {
    if (i === 0) { out.push(round2(lo)); continue; }
    if (i === SPIN_SLICES - 1) { out.push(round2(hi)); continue; }
    const raw = lo + (span * i) / (SPIN_SLICES - 1);
    out.push(round2(Math.min(hi, Math.max(lo, Math.round(raw / step) * step))));
  }
  return out;
}
// The roll IS the wheel: pick a slice, pay what that slice says. crypto, not
// Math.random -- V8's Math.random is a seeded xorshift128+ whose state is
// recoverable from a run of outputs, and a member sees every one of their own
// results.
function rollSpinSlice(lo, hi) {
  const slices = spinWheelSlices(lo, hi);
  const index = crypto.randomInt(0, slices.length);
  return { slices, index, amount: slices[index] };
}
function rollSpinReward(lo, hi) {
  return rollSpinSlice(lo, hi).amount;
}
function turntableDailyReward(sett) {
  return rollSpinReward(sett.turntableDailyMin, sett.turntableDailyMax);
}
// The band the NEXT spin will be paid from, which is not always the daily
// one: the spin route takes the free daily spin first if it is available and
// otherwise the OLDEST unused earned spin, each of which carries the band its
// product had at the moment it was granted. The wheel has to be labelled with
// whichever of those is actually about to be used, or it shows one product's
// prizes and pays another's.
function spinBandOf(doc) {
  const d = doc && doc.data ? doc.data() : doc;
  if (!d) return null;
  if (d.spinMin != null || d.spinMax != null) return { lo: d.spinMin, hi: d.spinMax };
  // Spins granted before per-product bands carry a flat `reward`. Honour it:
  // every slice reads the same, which is exactly what such a spin pays.
  const flat = round2(Number(d.reward) || 0);
  return { lo: flat, hi: flat };
}
app.get('/turntable/status', async (req, res) => {
  const uid = await verifyAuth(req);
  if (!uid) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const sett = await getSettings();
    const snap = await db.collection('users').doc(uid).get();
    if (!snap.exists) return res.status(404).json({ status: 'error', code: 'NOT_FOUND', message: 'User not found' });
    const u = snap.data();
    if (u.status === 'banned')
      return res.status(403).json({ status: 'error', code: 'BANNED', message: 'Account suspended. Contact customer service.' });
    const now = Date.now();
    const lastKey = u.lastTurntableAt ? eatDayKey(new Date(u.lastTurntableAt)) : null;
    const dailyAvailable = lastKey !== eatDayKey(new Date(now));
    // A real count, not the size of a capped fetch. This used to be
    // .limit(200).get() and report snap.size, so a member holding more than
    // 200 unused spins was told they had 200 -- the spins existed and were
    // spendable, but the number on screen was wrong, and totalSpins (which
    // enables the SPIN button) was wrong with it.
    const earnedCount = await db.collection('turntableSpins')
      .where('userId', '==', uid).where('used', '==', false).count();
    // The wheel is labelled with the band of the spin that is actually next,
    // resolved exactly the way /turntable/spin resolves it: the free daily
    // spin if it is available, otherwise the oldest unused earned one. The
    // extra read only happens when there IS an earned spin to describe.
    let band = { lo: sett.turntableDailyMin, hi: sett.turntableDailyMax };
    let nextSource = 'daily';
    if (!dailyAvailable && earnedCount > 0) {
      const earned = await db.collection('turntableSpins')
        .where('userId', '==', uid).where('used', '==', false)
        .orderBy('createdAt', 'asc').limit(1).get();
      if (!earned.empty) {
        band = spinBandOf(earned.docs[0]) || band;
        nextSource = 'product';
      }
    }
    res.json({
      status: 'success',
      enabled: !!sett.turntableEnabled,
      dailyAvailable,
      earnedSpins: earnedCount,
      totalSpins: (dailyAvailable ? 1 : 0) + earnedCount,
      nextDailyAt: eatNextMidnight(now),
      dailyMin: Number(sett.turntableDailyMin) || 0,
      dailyMax: Number(sett.turntableDailyMax) || 0,
      nextSource,
      nextMin: round2(Math.max(0, finiteMoney(band.lo))),
      nextMax: round2(Math.max(0, finiteMoney(band.hi))),
      slices: spinWheelSlices(band.lo, band.hi),
    });
  } catch (e) {
    console.error('Turntable status error:', e.message);
    res.status(500).json({ status: 'error', message: 'Could not load the turntable' });
  }
});
app.post('/turntable/spin', async (req, res) => {
  const uid = await verifyAuth(req);
  if (!uid) return res.status(401).json({ status: 'error', message: 'Please sign in again' });
  try {
    let result = null;
    // Same lock discipline as /checkin: one spin at a time per member, with
    // the balance write nested under bal:<uid>. Without this, two taps
    // landing together would each see the same unused spin and pay it twice.
    await withLock('turntable:' + uid, async () => {
      const sett = await getSettings();
      if (!sett.turntableEnabled) { result = { code: 400, body: { status: 'error', message: 'The turntable is not available right now.' } }; return; }
      const ref = db.collection('users').doc(uid);
      const snap = await ref.get();
      if (!snap.exists) { result = { code: 404, body: { status: 'error', message: 'User not found' } }; return; }
      const u = snap.data();
      if (u.status === 'banned') { result = { code: 403, body: { status: 'error', code: 'BANNED', message: 'Account suspended. Contact customer service.' } }; return; }

      const now = Date.now();
      const todayKey = eatDayKey(new Date(now));
      const lastKey = u.lastTurntableAt ? eatDayKey(new Date(u.lastTurntableAt)) : null;
      const dailyAvailable = lastKey !== todayKey;

      // `roll` carries the eight slices the wheel must land on and which of
      // them won, so the animation can stop on the exact figure being paid.
      let reward, source, label, spinDoc = null, roll = null;
      if (dailyAvailable) {
        // The day is CLAIMED here, atomically, before anything is paid.
        // withLock() is an in-process promise chain -- it serialises taps
        // inside ONE server process and nothing more, so if this app is ever
        // run on more than one instance two simultaneous taps could each
        // read lastTurntableAt, each see the day as free, and each pay a
        // daily spin. updateIf() is a single conditional Mongo write: only
        // the request whose read matched the stored value wins, whichever
        // process it came from.
        const claimed = await ref.updateIf(
          { lastTurntableAt: u.lastTurntableAt == null ? null : u.lastTurntableAt },
          { lastTurntableAt: now });
        if (!claimed) {
          result = { code: 400, body: { status: 'error', message: 'That spin was already used. Come back after midnight for your free daily spin.', nextDailyAt: eatNextMidnight(now) } };
          return;
        }
        roll = rollSpinSlice(sett.turntableDailyMin, sett.turntableDailyMax);
        reward = roll.amount;
        source = 'daily';
        label = 'Turntable daily spin';
      } else {
        // Oldest unused earned spin first, so a member cannot hold back a
        // high-value spin and burn cheap ones on other days.
        const earned = await db.collection('turntableSpins')
          .where('userId', '==', uid).where('used', '==', false)
          .orderBy('createdAt', 'asc').limit(1).get();
        if (earned.empty) {
          result = { code: 400, body: { status: 'error', message: 'No spins left. Come back after midnight for your free daily spin.', nextDailyAt: eatNextMidnight(now) } };
          return;
        }
        spinDoc = earned.docs[0];
        // spinBandOf() also covers the older spins, granted before
        // per-product bands, which carry a flat `reward` instead of one --
        // honoured as a zero-width band rather than paid as 0.
        const band = spinBandOf(spinDoc);
        roll = rollSpinSlice(band.lo, band.hi);
        reward = roll.amount;
        source = 'product';
        label = `Turntable spin from ${spinDoc.data().productName || 'a purchase'}`;
      }

      // Burn the spin BEFORE crediting. If the credit then fails, the member
      // has lost a spin -- annoying but recoverable, and visible in the
      // logs. Crediting first and burning second would mean a failure paid
      // real money out and left the spin re-usable, which is unrecoverable.
      // The daily spin was already claimed atomically above; only an earned
      // spin still needs burning. Same order as before -- burn, then credit --
      // because a failed credit that left the spin re-usable would pay real
      // money out twice, while a burnt spin with no credit is recoverable.
      if (spinDoc) {
        const burnt = await spinDoc.ref.updateIf({ used: false }, { used: true, usedAt: now });
        if (!burnt) {
          result = { code: 400, body: { status: 'error', message: 'That spin was already used.' } };
          return;
        }
      }
      try {
        await withLock('bal:' + uid, () => ref.update({
          walletBalance: FieldValue.increment(reward),
          totalEarned: FieldValue.increment(reward),
        }));
      } catch (creditErr) {
        // The wallet did NOT move, so hand the entitlement back. This catch
        // deliberately covers only the wallet update: if the money already
        // landed and a later history write fails, re-arming the spin would
        // let the same entitlement pay a second time on retry.
        if (spinDoc) await spinDoc.ref.update({ used: false, usedAt: null }).catch(() => {});
        else await ref.update({ lastTurntableAt: u.lastTurntableAt || null }).catch(() => {});
        throw creditErr;
      }
      const { date, time } = nowStr();
      try {
        await db.collection('transactions').add({
          userId: uid, type: 'turntable', description: label, amount: reward,
          status: 'success', date, time, createdAt: FieldValue.serverTimestamp(),
        });
      } catch (ledgerErr) {
        // MONEY-SAFETY: the spendable balance is already correct. Never
        // restore the spin here; doing so is a direct double-credit path.
        // Surface the missing history row loudly for the integrity tools /
        // operator instead of turning a bookkeeping failure into free money.
        console.error(`MONEY-SAFETY: turntable reward ${reward} credited to ${uid} but its transaction row failed; entitlement remains consumed to prevent a double credit.`, ledgerErr.message);
      }

      const earnedLeft = await db.collection('turntableSpins')
        .where('userId', '==', uid).where('used', '==', false).count();
      // RE-READ the balance rather than adding the reward to the snapshot
      // taken at the top of this lock.
      //
      // `u` was read before the increment, and withLock('bal:' + uid) only
      // serialises the WRITES -- that read sits outside it. Anything else
      // crediting this member in between (a referral commission from a
      // downline purchase, a manual deposit being approved, an investment
      // maturing on the sweep) lands after the read, so
      // `u.walletBalance + reward` is short by exactly that amount. The
      // client trusts this number: it writes it into STATE.account and the
      // win popup counts up to it, so a member would watch their balance
      // animate to a figure LOWER than the money they actually have and keep
      // seeing it until the next /account fetch.
      //
      // /checkin, which shares this endpoint's lock discipline, sidesteps the
      // problem by returning only the bonus and letting the client refetch.
      // This endpoint promises a balance, so it has to be the real one. On a
      // failed re-read, omit it -- the client already falls back to
      // before + reward, and a null is honest where a guess is not.
      let newBalance = null;
      try {
        const after = await ref.get();
        if (after.exists) newBalance = round2(Number(after.data().walletBalance) || 0);
      } catch (_) { newBalance = null; }
      result = { code: 200, body: {
        status: 'success', reward, source,
        walletBalance: newBalance,
        earnedSpins: earnedLeft,
        dailyAvailable: false,
        totalSpins: earnedLeft,
        nextDailyAt: eatNextMidnight(now),
        // The eight amounts this spin was drawn from, and which one won, so
        // the wheel can stop on the exact figure being credited. Sent even
        // though the client already has a set from /turntable/status: the
        // spin that was actually taken may not be the one that status
        // described (another device may have used the daily spin in
        // between), and the wheel must be relabelled rather than land on a
        // stale prize.
        slices: roll ? roll.slices : null,
        sliceIndex: roll ? roll.index : null,
      } };
    });
    res.status(result.code).json(result.body);
  } catch (e) {
    console.error('Turntable spin error:', e.message);
    res.status(500).json({ status: 'error', message: 'The spin could not be completed. Your balance is unchanged.' });
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
  if (tier.active === false || !productOpenState(tier, Date.now()).open)
    return res.status(400).json({ status: 'error', message: 'This product is not open right now.' });
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
      // Re-checked against the LIVE product inside the lock, and against the
      // clock at this instant -- a member sitting on the screen as a window
      // closes must not slip a purchase through on a stale card.
      if (!liveTier || liveTier.active === false || !productOpenState(liveTier, Date.now()).open)
        throw new Error('This product is not open right now.');
      cycle = Number(liveTier.cycle) || sett.cycleDays;
      expectedReturn = productExpectedReturn(liveTier, sett);
      dailyPayout = Math.round(expectedReturn / cycle);
      const uRef = db.collection('users').doc(userId);
      const fresh = await uRef.get();
      if (!fresh.exists) throw new Error('User not found');
      if (fresh.data().status === 'banned') { const banErr = new Error('Account suspended. Contact customer service.'); banErr.code = 'BANNED'; throw banErr; }
      const bal = fresh.data().walletBalance || 0;
      // Carries a code so the app can react to this specific failure (send
      // the member to Deposit) instead of string-matching the message.
      if (bal < liveTier.price) {
        const shortErr = new Error(`Need ${fmtMoney(liveTier.price)}, have ${fmtMoney(bal)}`);
        shortErr.code = 'INSUFFICIENT_BALANCE';
        throw shortErr;
      }
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
    // Fire-and-forget, exactly like the commission above: a turntable spin is
    // a bonus, and failing to grant one must never fail a purchase the member
    // has already paid for.
    grantTurntableSpins(userId, liveTier, invId);
    res.json({ status: 'success', investmentId: invId, message: `Bought ${liveTier.name} for ${fmtMoney(liveTier.price)}` });
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
  if (amt > MAX_MONEY_AMOUNT) return res.status(400).json({ status: 'error', message: `Amount is too large (max ${fmtMoney(MAX_MONEY_AMOUNT)}).` });
  try {
    const [uSnap, sett] = await Promise.all([db.collection('users').doc(userId).get(), getSettings()]);
    if (!uSnap.exists) return res.status(404).json({ status: 'error', message: 'User not found' });
    if (uSnap.data().status === 'banned') return res.status(403).json({ status: 'error', code: 'BANNED', message: 'Account suspended. Contact customer service.' });
    if (_userBeingDeleted.has(userId)) return res.status(400).json({ status: 'error', message: 'This account is currently being processed. Try again shortly.' });
    const provider = depositAutomaticProvider(sett);
    // The gateway has to be able to reach THIS country's phone numbers. Every
    // automatic gateway here is Uganda-only (see GATEWAY_DIAL_CODES), and a
    // new region inherits Uganda's settings, so without this a Kenyan deposit
    // is created and handed to MarzPay with a +254 number. Refused BEFORE any
    // pendingDeposit is written and before the debounce and abuse counters, so
    // a misconfiguration cannot leave rows behind or ban anybody. The message
    // names the country, because the person who has to fix this is the admin.
    if (!gatewayServesRegion(provider, currentRegion())) {
      return res.status(400).json({
        status: 'error', code: 'GATEWAY_REGION',
        message: 'Automatic recharge is not available in ' + (currentRegion().name || 'this country') + ' yet.',
      });
    }

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
    if (amt < sett.minDeposit) return res.status(400).json({ status: 'error', message: `Minimum amount is ${fmtMoney(sett.minDeposit)}` });
    const _ph = depositSenderPhone(req.body, uSnap.data().phone, ['phone']);
    if (_ph.error) return res.status(400).json({ status: 'error', message: _ph.error });
    const phone = _ph.phone;

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
      // Which country's money this is, stamped once so the admin lists can
      // label the figure correctly without a user lookup per row.
      regionKey: currentRegionKey(),
      date, time, createdAt: FieldValue.serverTimestamp()
    });
    // ANSWER FIRST. Owner: "sometimes a prompt may come when the screen is
    // just redirecting to payment page, so it is slow to redirect."
    //
    // The member is staring at "Redirecting to payment..." until this line
    // runs, and everything before it is a round trip to Atlas they are paying
    // for. The only write the next screen actually needs is the pendingDeposits
    // doc, which is already written above -- the ledger row below is
    // bookkeeping for the Records screen, which nobody is looking at in this
    // second, and creditDeposit()'s own find-or-create covers it if it fails.
    // Moving it after the response took a whole Mongo round trip out of the
    // redirect.
    res.json({ status: 'success', depositId: depRef.id, reference: ref, message: 'Payment initiated. Check your phone.' });
    // The Records row. Written AFTER the response now (see the note above)
    // -- still awaited, so the provider call below cannot race ahead of it,
    // just no longer in front of the member's redirect.
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
      userId, type: 'deposit', description: `Deposit: Processing (${fmtMoney(amt)})`,
      amount: amt, displayAmount: amt, status: 'pending', date, time, ref, depositId: depRef.id, createdAt: FieldValue.serverTimestamp()
    }).catch(e => console.error(`Deposit ledger row create failed for dep=${depRef.id}:`, e.message));

    if (provider === 'pesajet') {
      // PesaJet branch -- same "claim as pending, let the webhook / the
      // member's own poll / the reconciler resolve it" shape as the two
      // below. The IDEMPOTENCY ANCHOR is the deposit's own doc id: a genuine
      // retry of this same deposit sends the identical Idempotency-Key, so
      // PesaJet's own de-duplication is what prevents a second prompt, not a
      // loop in here. `reference` is our human-readable ref, which is what
      // comes back on the webhook and lets a row be found without trusting
      // any id the caller supplied.
      let pj;
      try {
        pj = await pesajetCollect({
          amount: amt, phone, network, reference: ref, description: 'Mobile Money',
          idempotencyKey: depRef.id,
        });
      } catch (netErr) {
        // Unreachable in practice (_pesajetRequest never throws), kept so a
        // future change to it cannot turn an exception into an unhandled
        // rejection on a money path.
        console.error('PesaJet collect network error (dep ' + depRef.id + '):', netErr.message);
        return;
      }
      if (!pj.ok) {
        console.error('PesaJet collect rejected:', pj.httpStatus, JSON.stringify(pj.data).slice(0, 300));
        // A gateway that is merely BUSY has not refused this payment. Failing
        // the deposit here would tell a member their recharge failed when
        // PesaJet may never have seen it -- leave it pending for the
        // reconciler, exactly as the network-error path above does.
        if (!pj.providerDown) await markDepositFailed(depRef, userId, pesajetUserMsg(pj, 'Could not start the payment'));
        return;
      }
      const tx = pj.data?.data || pj.data || {};
      const pesajetTxId = tx.transactionId || null;
      // Same claim-race protection as the other two branches: a webhook that
      // raced ahead and already credited this exact deposit must never be
      // reverted to 'pending' by this later write.
      await withLock('dep:' + depRef.id, async () => {
        const fresh = await depRef.get();
        if (fresh.exists && fresh.data().status === 'initiating') {
          await depRef.update({ status: 'pending', pesajetTxId });
        } else {
          await depRef.update({ pesajetTxId }).catch(() => {});
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
// Credited from a gateway webhook, a status poll, a forwarded SMS or an
// admin's hand -- most of which arrive with no region of their own. The
// description stamped on the member's ledger row carries the amount, so it
// is written in the DEPOSITOR's currency.
async function creditDeposit(depDoc) {
  return withUserRegion(depDoc && depDoc.data() && depDoc.data().userId, () => _creditDepositNow(depDoc));
}
async function _creditDepositNow(depDoc) {
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
            status: 'success', description: `Deposit: Success (${fmtMoney(depAmount)})`,
            amount: depAmount, displayAmount: depAmount,
          })));
        } else {
          const { date, time } = nowStr();
          await db.collection('transactions').add({
            userId: depUserId, type: 'deposit', description: `Deposit: Success (${fmtMoney(depAmount)})`,
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
      sendAdminPush('Deposit completed', `${fmtMoney(creditedAmount)} credited to a wallet`, { type: 'deposit', depositId: depDoc.id }).catch(() => {});
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
    // PesaJet: the same self-healing re-check MarzPay's own branch below does,
    // so a
    // slow or lost webhook resolves the moment the member looks at the status
    // screen. Its webhook URL is dashboard-configured rather than sent per
    // request (see the module note), so this poll is doing more of the work
    // here than it does for the other two gateways -- not less.
    if (dep.provider === 'pesajet') {
      if (!dep.pesajetTxId) return res.json({ status: 'success', state: 'pending' });
      // One attempt: a member is watching this, and their next poll is 2.5s
      // away and is itself the retry.
      const t = await pesajetGetTx(dep.pesajetTxId, { attempts: 1 });
      if (t.providerDown) return res.json({ status: 'success', state: 'pending' });
      const realStatus = pesajetStatusLabel(t.status);
      if (realStatus === 'success') { await creditDeposit(depSnap); return res.json({ status: 'success', state: 'matched' }); }
      if (realStatus === 'failed') {
        const msg = pesajetFailureMsg(t.status);
        const reallyFailed = await markDepositFailed(depSnap.ref, userId, msg);
        if (!reallyFailed) return res.json({ status: 'success', state: 'matched' });
        return res.json({ status: 'success', state: 'failed', message: msg });
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
// ═══════════════════════════════════════════
// WITHDRAWAL (MarzPay send-money, mobile money only)
// ═══════════════════════════════════════════
const _withdrawInFlight = new Set();
const _witRequestInFlight = new Set();
// The Trade Password set at registration is the ONLY PIN in Petro -- it
// gates every actual money-moving withdrawal request. It no longer gates
// binding/removing a withdrawal account (owner, Round 39: "remove pin
// putting here, only it will be on Withdrawals") -- saving/removing a
// payout destination doesn't move money by itself, see /bank/save and
// /bank/delete for that change.
const PIN_LOCK_MS = 15 * 60 * 1000;
const PIN_MAX_FAILS = 5;
async function pinCheck(userId, pin) {
  if (!/^\d{6}$/.test(String(pin || '')))
    return { ok: false, code: 'INVALID_PIN', message: 'Enter your 6-digit Trade Password.' };
  return withLock('pin:' + userId, async () => {
    const uRef = db.collection('users').doc(userId);
    const snap = await uRef.get();
    if (!snap.exists) return { ok: false, code: 'NOT_FOUND', message: 'Account not found' };
    const u = snap.data();
    const now = Date.now();
    if (u.pinLockedUntil && tsMillis(u.pinLockedUntil) > now) {
      const mins = Math.ceil((tsMillis(u.pinLockedUntil) - now) / 60000);
      return { ok: false, code: 'LOCKED', message: `Too many wrong Trade Password attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.` };
    }
    if (!u.transactionPinHash) return { ok: false, code: 'NO_PIN', message: 'No Trade Password is set on this account.' };
    if (!scryptVerify(pin, u.transactionPinHash)) {
      const fails = (u.pinFailCount || 0) + 1;
      const update = { pinFailCount: fails };
      let locked = false;
      if (fails >= PIN_MAX_FAILS) { update.pinLockedUntil = new Date(now + PIN_LOCK_MS); update.pinFailCount = 0; locked = true; }
      await uRef.update(update);
      return { ok: false, code: locked ? 'LOCKED' : 'WRONG_PIN', message: locked ? `Too many wrong Trade Password attempts. Try again in ${PIN_LOCK_MS / 60000} minutes.` : 'Incorrect Trade Password.' };
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
    if (amt > MAX_MONEY_AMOUNT) return res.status(400).json({ status: 'error', message: `Amount is too large (max ${fmtMoney(MAX_MONEY_AMOUNT)}).` });
    const rawNetwork = String(req.body.network || '').trim();
    if (!NETWORK_NAMES.has(rawNetwork)) return res.status(400).json({ status: 'error', message: 'Bind a withdrawal account first.' });
    const destValue = cleanPhone(req.body.phone || '');
    if (!destValue) return res.status(400).json({ status: 'error', message: 'Bind a withdrawal account first.' });
    const sett = await getSettings();
    // The cash-out window, enforced HERE and not only shown in the app.
    // Owner: "one withdrawal time should be SETTABLE IN ADMIN, such that when
    // one tries to withdrawal he sees, that withdrawals start from this time
    // to this time." The app draws the hours on the screen, but this route is
    // a plain authenticated POST -- a rule that lives only in the client is
    // not a rule.
    const win = withdrawWindowState(sett, Date.now());
    if (win.enabled && !win.open)
      return res.status(400).json({ status: 'error', code: 'WINDOW_CLOSED',
        message: `Cash-out is open from ${win.from} to ${win.to}. Please come back then.` });
    if (amt < sett.minWithdraw) return res.status(400).json({ status: 'error', message: `Minimum cash-out is ${fmtMoney(sett.minWithdraw)}` });
    // Checked HERE, not only in the app: the client's own check is a
    // courtesy so a member sees the rule before submitting, but /withdraw/
    // request is a plain authenticated POST and the amount in its body is
    // whatever the caller chose to send.
    const wMult = Math.max(0, Math.floor(Number(sett.withdrawMultiple) || 0));
    if (wMult > 0 && amt % wMult !== 0) {
      const low = Math.floor(amt / wMult) * wMult, high = low + wMult;
      return res.status(400).json({ status: 'error',
        message: `Cash-out must be a multiple of ${fmtMoney(wMult)}. Try ${fmtMoney(Math.max(low, sett.minWithdraw))} or ${fmtMoney(high)}.` });
    }
    // Trade Password / withdrawal PIN gate REMOVED here (owner: "what I am
    // giving you is what you should put... remove trade passwords" -- the
    // mockups have no PIN field anywhere, registration or withdrawal). The
    // OTP-verified Bind Bank Account step is what now stands between a
    // withdrawal and an unbound/unauthenticated caller -- see the
    // UNBOUND_ACCOUNT check right below, and /bank/save's own OTP
    // requirement. pinCheck()/transactionPinHash are left in place
    // (dead code, not deleted) -- see petro/CLAUDE.md's "Design system"
    // section for the reasoning already established for similar removals.
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
        throw new Error(`Not enough balance, you have ${fmtMoney(bal)}`);
      }
      // ONE UNRESOLVED CASH-OUT AT A TIME. Owner: "no requesting another
      // withdrawal yet another one is on pending, so one should have got his
      // processing one to be paid then requests another."
      //
      // Inside the balance lock and before the debit, so two taps cannot both
      // find nothing pending. The three statuses are exactly the ones
      // /admin/withdrawals/list treats as unresolved -- 'processed' and
      // 'rejected' are finished and must not block anything, or a member's
      // first ever cash-out would be their last.
      const openSnap = await db.collection('withdrawals')
        .where('userId', '==', userId).where('status', 'in', ['pending', 'sending', 'processing'])
        .limit(1).get();
      if (!openSnap.empty) {
        const w = openSnap.docs[0].data();
        const e = new Error(`You already have a cash-out of ${fmtMoney(w.amount || 0)} waiting. Once it is paid you can request another.`);
        e.code = 'WITHDRAW_PENDING';
        throw e;
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
        await witRef.set({ userId, amount: amt, fee, net, holder, network: rawNetwork, phone: destValue, ref, status: 'pending', regionKey: currentRegionKey(), date, time, createdAt: FieldValue.serverTimestamp() });
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
          userId, type: 'withdraw', description: `Withdrawal: Processing (${fmtMoney(amt)})`,
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
    sendAdminPush('New withdrawal request', `${fmtMoney(amt)} requested via ${rawNetwork}`, { type: 'withdrawal', withdrawalId: witId }).catch(() => {});
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
  let ownerId = null;
  try {
    const w = await db.collection('withdrawals').doc(withdrawalId).get();
    if (w.exists) ownerId = w.data().userId || null;
  } catch (_) {}
  return withUserRegion(ownerId, () => _finalizeWithdrawalTxNow(withdrawalId, outcome, refunded));
}
async function _finalizeWithdrawalTxNow(withdrawalId, outcome, refunded) {
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
      const update = { status: newStatus, description: `Withdrawal: ${statusLabel} (${fmtMoney(amt)})` };
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
// Started by an ADMIN, whose own request region is whichever host the panel
// is on -- but every amount in the replies and in the member's ledger row
// belongs to the MEMBER. The region is switched to theirs as soon as the
// withdrawal document names them.
async function processWithdrawalCore(withdrawalId, processedBy) {
  try {
    const pre = await db.collection('withdrawals').doc(withdrawalId).get();
    if (!pre.exists) return { code: 404, body: { status: 'error', message: 'Withdrawal not found' } };
    return await withUserRegion(pre.data().userId, () => _processWithdrawalNow(withdrawalId, processedBy));
  } catch (e) {
    console.error('Withdrawal region lookup failed:', e.message);
    return { code: 503, body: { status: 'error', message: 'Could not confirm the payout account country. Please retry shortly.' } };
  }
}
async function _processWithdrawalNow(withdrawalId, processedBy) {
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
        body: { status: 'success', manual: true, message: `Recorded as paid by hand: ${fmtMoney(wit.net)} to ${wit.phone}` },
        meta: { amount: wit.net, dest: wit.phone, userId: wit.userId, payoutMethod: 'manual' },
      };
    }

    if (withdrawProvider(settNow) === 'pesajet') {
      // PesaJet payout. The three rules that matter are:
      //   * the outbound identifier is written BEFORE the provider is ever
      //     called, so a later write failure can never leave a real payout
      //     unrecorded;
      //   * a network exception is AMBIGUOUS -- never revert to 'pending',
      //     which would invite a retry that double-pays;
      //   * acceptance is not completion. PesaJet answers PENDING and
      //     resolves asynchronously, so this lands on 'processing'.
      // The withdrawal's own doc id is the Idempotency-Key, so a genuine
      // retry of the same withdrawal is de-duplicated by PesaJet rather than
      // by anything in here.
      const sendingMarker = withdrawalId;
      await witRef.update({ status: 'sending', sendingReference: sendingMarker, pesajetRef: sendingMarker, sendingBy: processedBy, sendingAt: FieldValue.serverTimestamp() });
      const pj = await pesajetDisburse({
        amount: wit.net, phone: wit.phone, network: wit.network,
        reference: sendingMarker, description: 'Withdrawal',
        idempotencyKey: withdrawalId,
      });
      if (pj.providerDown) {
        console.error('PesaJet disbursement unreachable (ambiguous, NOT reverting to pending):', pj.httpStatus, JSON.stringify(pj.data).slice(0, 200));
        return { code: 500, body: { status: 'error', message: 'Lost contact with PesaJet mid-request. We cannot confirm whether this payout was actually sent. It stays on "Sending" (not pending) so nobody retries it blindly.', sendingReference: sendingMarker } };
      }
      if (!pj.ok) {
        // A clean refusal -- PesaJet answered and said no, so nothing was
        // sent and the row is safe to hand back to Pending.
        await witRef.update({ status: 'pending', sendingReference: null, pesajetRef: null, pesajetTxId: null, sendingBy: null, sendingAt: null }).catch(() => {});
        return { code: 400, body: { status: 'error', message: pesajetUserMsg(pj, 'PesaJet could not send this payout right now. The withdrawal stays pending and untouched. Try again in a moment.') } };
      }
      const tx = pj.data?.data || pj.data || {};
      const pesajetTxId = tx.transactionId || null;
      await withLock('bal:' + wit.userId, async () => {
        await witRef.update({ pesajetRef: sendingMarker, pesajetTxId });
        const claimed = await witRef.updateIf({ status: 'sending' }, { status: 'processing', processedBy, processedAt: FieldValue.serverTimestamp() });
        if (!claimed) return;
        try {
          await db.collection('users').doc(wit.userId).update({ totalWithdrawn: FieldValue.increment(wit.net) });
        } catch (twErr) {
          console.error(`MONEY-SAFETY: totalWithdrawn increment failed AFTER withdrawal ${withdrawalId} was marked sent via PesaJet — user ${wit.userId} is missing +${wit.net} in their totalWithdrawn stat. Backfill by hand.`, twErr.message);
        }
      });
      try {
        const txSnap = await db.collection('transactions').where('withdrawalId', '==', withdrawalId).limit(1).get();
        if (!txSnap.empty) await txSnap.docs[0].ref.updateIf({ status: 'pending' }, { status: 'processing' });
      } catch (txErr) { console.warn('Process tx update (non-critical):', txErr.message); }
      return {
        code: 200,
        body: { status: 'success', sandbox: false, message: `Sending ${fmtMoney(wit.net)} to ${wit.phone}` },
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
    if (ambiguous || mpData.providerDown) {
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
      await witRef.update({ marzReference: sendingMarker, ...(updateFields.marzTxUuid ? { marzTxUuid: updateFields.marzTxUuid } : {}) });
      const claimed = await witRef.updateIf({ status: 'sending' }, updateFields);
      if (!claimed) return;
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
        if (!txSnap.empty) await txSnap.docs[0].ref.updateIf({ status: 'pending' }, { status: 'processing' });
      } catch (txErr) { console.warn('Process tx update (non-critical):', txErr.message); }
    }
    return {
      code: 200,
      body: { status: 'success', sandbox, message: sandbox ? `Sandbox: withdrawal marked complete, ${fmtMoney(wit.net)} to ${wit.phone}` : `Sending ${fmtMoney(wit.net)} to ${wit.phone}` },
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
    // A PesaJet-routed payout likewise has neither marzReference nor
    // marzTxUuid, so without this branch Verify would report "no gateway
    // reference, nothing was sent" about a payout that may well have gone
    // out -- the single most dangerous wrong answer this screen can give,
    // because it invites a reject that refunds the member on top of real
    // money.
    if (w.pesajetRef) {
      if (!w.pesajetTxId) {
        return res.json({
          status: 'success', ourStatus: w.status, marzStatus: 'unverifiable',
          message: `A send attempt WAS made via PesaJet (reference: ${w.pesajetRef}) but we never recorded a PesaJet transaction id to check against -- this does NOT mean nothing was sent. Check PesaJet's own dashboard for that reference before rejecting; rejecting a payout that already went out will refund the member on top of it.`,
        });
      }
      const t = await pesajetGetTx(w.pesajetTxId);
      if (t.providerDown) {
        return res.json({ status: 'success', ourStatus: w.status, marzStatus: 'unverifiable', message: `A send attempt WAS made via PesaJet (transaction ${w.pesajetTxId}) but PesaJet did not respond just now. Try Verify again in a moment -- this does NOT mean nothing was sent.` });
      }
      const realStatus = pesajetStatusLabel(t.status);
      let pjMessage;
      if (realStatus === 'success') pjMessage = `PesaJet confirms this payout was SENT (status: ${t.status}).`;
      else if (realStatus === 'failed') pjMessage = `PesaJet says this payout ${t.status === 'expired' ? 'EXPIRED before it was collected' : 'FAILED'} (status: ${t.status})${t.failureReason ? ' — ' + t.failureReason : ''}.`;
      else if (realStatus === 'processing') pjMessage = `PesaJet still has this payout in flight (status: ${t.status}). Not finished, not failed.`;
      else pjMessage = `PesaJet reports status: ${t.status || 'unknown'}.`;
      return res.json({ status: 'success', ourStatus: w.status, marzStatus: t.status || 'unknown', message: pjMessage });
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
// ── THE PESAJET WEBHOOK -- ONE ENDPOINT FOR BOTH DIRECTIONS ──
// PesaJet's dashboard has a SINGLE "Webhook Destination URL" field. Two
// routes (one per direction, as MarzPay has) cannot both be
// registered there, so half the notifications would never arrive -- and the
// half that went missing would be invisible, because the reconciler quietly
// covers for it. One endpoint, dispatched on which of our own collections
// the event's `reference` belongs to.
//
// Same discipline as the other two gateways, and the rules that matter:
//   * THE PAYLOAD IS A HINT, NEVER THE AUTHORITY. The signature is verified
//     and a forgery is refused, and the decision still comes from re-reading
//     GET /payments/{transactionId} -- using the id WE stored, never one out
//     of the body, or anyone reaching this URL could point it at somebody
//     else's completed transaction.
//   * PesaJet requires 200 WITHIN 30 SECONDS ("Return 200 OK within 30
//     seconds", their dashboard). The re-read is two attempts with a 30s
//     timeout each, so it can outlast that on a bad day. The ack therefore
//     goes out FIRST and the work happens after -- exactly as
//     /deposit/callback has always done for MarzPay. A webhook PesaJet
//     thinks timed out gets retried, which is only safe because every path
//     below is idempotent.
//   * A 'sending' payout is genuinely ambiguous (a network error mid-send).
//     A success may be recognised from it -- a genuine success is always safe
//     -- but a failure may NEVER be auto-declined and refunded from this
//     unauthenticated automated path. Only a human, via
//     /admin/withdraw/reject after checking PesaJet's own dashboard, resolves
//     one. Refunding a payout that actually went out pays the member twice.
app.post('/pesajet/webhook', async (req, res) => {
  const body = req.body || {};
  const check = pesajetVerifyWebhook(body, req.get('x-webhook-signature'), req.rawBody);
  // A signature that is present and wrong is the one case worth refusing
  // loudly: it is either a forgery or a misconfigured secret, and both want
  // an operator's attention. Answered BEFORE the ack below, since a refusal
  // is not an acknowledgement.
  if (!check.verified && check.reason === 'mismatch') {
    console.error('PesaJet webhook: signature mismatch, refused.');
    return res.status(401).json({ status: 'error', message: 'Invalid signature' });
  }
  res.status(200).json({ received: true });
  // Everything past here runs after the ack. Nothing may throw out of it.
  try {
    if (body.event === 'ping') return;                 // a delivery test
    const reference = String(body.reference || '');
    if (!reference) return;
    // A deposit's reference is its own human-readable `ref`; a payout's is the
    // withdrawal's doc id. Looked up in that order, and never by anything the
    // caller could have invented.
    const depQ = await db.collection('pendingDeposits').where('ref', '==', reference).limit(1).get();
    if (!depQ.empty) {
      const doc = depQ.docs[0], dep = doc.data();
      if (dep.provider !== 'pesajet') return;
      if (dep.status !== 'pending' && dep.status !== 'initiating') return;
      if (!dep.pesajetTxId) return;
      const t = await pesajetGetTx(dep.pesajetTxId);
      if (t.providerDown) return;   // unverifiable -- the reconciler and the member's own poll both retry
      const realStatus = pesajetStatusLabel(t.status);
      if (realStatus === 'success') await creditDeposit(doc);
      else if (realStatus === 'failed') await markDepositFailed(doc.ref, dep.userId, pesajetFailureMsg(t.status));
      return;
    }
    const witDoc = await db.collection('withdrawals').doc(reference).get();
    if (!witDoc.exists) return;
    const wit = witDoc.data();
    if (wit.pesajetRef !== reference) return;          // not a PesaJet-routed payout
    if (wit.status !== 'processing' && wit.status !== 'sending') return;
    if (!wit.pesajetTxId) return;
    const t = await pesajetGetTx(wit.pesajetTxId);
    if (t.providerDown) return;
    const realStatus = pesajetStatusLabel(t.status);
    if (realStatus === 'success') {
      if (await markWithdrawalProcessed(witDoc.ref, wit.userId)) await finalizeWithdrawalTransactionRecord(witDoc.id, 'processed');
    } else if (realStatus === 'failed') {
      if (wit.status === 'sending') return;            // ambiguous -- admin-only resolution, see the note above
      const { declined, refunded } = await declineWithdrawalAndRefund(witDoc.ref, wit.userId, 'Payout failed at the payment provider', ['processing']);
      if (declined) await finalizeWithdrawalTransactionRecord(witDoc.id, 'declined', refunded);
    }
    // 'processing' -- genuinely not finished yet, nothing to do
  } catch (e) {
    console.error('PesaJet webhook error (already acked):', e.message);
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
  if (!phone) return res.status(400).json({ status: 'error', message: badPhoneMessage() });
  try {
    const uSnap = await db.collection('users').doc(userId).get();
    if (uSnap.exists && uSnap.data().status === 'banned') return res.status(403).json({ status: 'error', code: 'BANNED', message: 'Account suspended. Contact customer service.' });
    // OTP proves it's really the account holder adding this payout
    // destination -- sent to THEIR OWN phone on file (resolved by
    // /auth/otp/send's 'bank' purpose), not to `phone` above, which is the
    // new account being added and could belong to someone else entirely
    // (a family member's mobile money, for instance). Optional now, per
    // the owner -- off by default (see DEFAULT_SETTINGS.bankOtpRequired).
    if ((await getSettings()).bankOtpRequired) {
      const ownPhone = cleanPhone((uSnap.exists && uSnap.data().phone) || '');
      const ticketOk = await consumeOtpTicket(String(req.body.otpTicket || ''), ownPhone, 'bank');
      if (!ticketOk) return res.status(400).json({ status: 'error', code: 'OTP_REQUIRED', message: 'Please verify with the code sent to your phone first.' });
    }
    // Saving/removing a payout destination here doesn't move any money by
    // itself -- see /withdraw/request for the actual money-moving path.
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
  if (!/^\d{6}$/.test(newPin)) return res.status(400).json({ status: 'error', message: 'New trade password must be 6 digits.' });
  if (isWeakPin(newPin)) return res.status(400).json({ status: 'error', message: 'That PIN is too easy to guess. Choose 6 digits that are not all the same.' });
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
// ── WHICH COUNTRY A GIFT CODE BELONGS TO ──
// Stamped at generate time (see /admin/promocodes/generate for why money
// makes this necessary). 'all' means every country; so does a MISSING field,
// which is every code cut before this existed -- those were genuinely
// claimable by anybody and must stay that way, because they are already in
// members' hands and a code that stops working reads as theft.
function giftCodeRegion(c) {
  return String((c && c.regionKey) || '').trim().toLowerCase() || 'all';
}
function giftCodeInRegion(c, want) {
  if (!want || want === 'all') return true;
  const own = giftCodeRegion(c);
  return own === 'all' || own === want;
}
app.post('/redeem', async (req, res) => {
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Please sign in again' });
  // Strictly case-sensitive — a code only ever matches itself as issued.
  const raw = String(req.body.code || '').trim().slice(0, 32);
  if (!raw || !/^[A-Za-z0-9-]+$/.test(raw)) return res.status(400).json({ status: 'error', message: 'Enter a gift code' });
  try {
    let result = null;
    // Lock on the uppercased code, not the raw input: two members submitting
    // the same code in different casing must serialise against each other,
    // and after the fallback lookup above they can now both reach the same
    // document. Uppercasing an old mixed-case code only ever widens the lock,
    // which is the safe direction.
    await withLock('redeem:' + raw.toUpperCase(), async () => {
      const userSnap = await db.collection('users').doc(userId).get();
      if (!userSnap.exists) { result = { code: 404, body: { status: 'error', message: 'User not found' } }; return; }
      if (userSnap.data().status === 'banned') { result = { code: 403, body: { status: 'error', code: 'BANNED', message: 'Account suspended. Contact customer service.' } }; return; }
      // Exact match first, so a code already issued under the old mixed-case
      // alphabet still matches only itself. Codes are uppercase-only now, so
      // a member who types or pastes one in lowercase is not making a
      // different code -- fall back to the uppercased form rather than
      // telling them a real code is invalid.
      let codeSnap = await db.collection('promoCodes').where('code', '==', raw).limit(1).get();
      const upper = raw.toUpperCase();
      if (codeSnap.empty && upper !== raw) {
        codeSnap = await db.collection('promoCodes').where('code', '==', upper).limit(1).get();
      }
      if (codeSnap.empty) {
        // A code that doesn't exist at all is the actual "guessing" signal --
        // an already-used or usage-capped code below is a REAL code, not a
        // guess, so those aren't logged here.
        logSecurityEvent(userId, 'giftcode_invalid_attempt', { code: raw });
        // Owner's own wording. This is the "the key you typed is not a key"
        // case; the branches below (inactive / expired / already used) are
        // real codes in a wrong STATE and keep saying so, because telling
        // someone their correct code is "wrong" would send them hunting for
        // a typo that isn't there.
        result = { code: 400, body: { status: 'error', message: 'Wrong treasure chest password' } };
        return;
      }
      const codeDoc = codeSnap.docs[0];
      const cd = codeDoc.data();
      const code = cd.code;
      if (cd.active === false) { result = { code: 400, body: { status: 'error', message: 'This code is no longer active' } }; return; }
      if (cd.expiresAt && tsMillis(cd.expiresAt) < Date.now()) { result = { code: 400, body: { status: 'error', message: 'This code has expired' } }; return; }
      // A code cut for another country would pay its face value in THIS
      // member's currency -- the same arithmetic that makes a cross-country
      // referral commission wrong, and by a similar multiple. Refused with
      // its own wording, like the two above: this is a real code in a state
      // that is wrong for this account, not a typo to go hunting for.
      if (!giftCodeInRegion(cd, currentRegionKey())) {
        logSecurityEvent(userId, 'giftcode_wrong_region', { code: cd.code, codeRegion: giftCodeRegion(cd) });
        result = { code: 400, body: { status: 'error', message: 'This code was issued for a different country' } };
        return;
      }
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
      // The win card prints "New Balance" the instant it opens, so hand the
      // post-credit figure back with the reward. Without it the client had to
      // come back for /account before it could show anything -- a whole extra
      // round trip between a successful claim and any sign that it worked,
      // which is the delay the owner reported. One local read here replaces a
      // network round trip on a phone. /turntable/spin already does this.
      //
      // Read AFTER the increment, not computed from the pre-credit snapshot:
      // this is the real stored balance, so it is also right on the
      // idempotent-retry path above where no increment was applied at all.
      const body = { status: 'success', reward };
      try {
        const fresh = await db.collection('users').doc(userId).get();
        const bal = fresh.exists ? Number(fresh.data().walletBalance) : NaN;
        // Omitted rather than sent as null when unreadable -- the client
        // falls back to its own arithmetic, and a null would have to be
        // special-cased there to avoid reading as a balance of zero.
        if (Number.isFinite(bal)) body.walletBalance = bal;
      } catch (_) { /* the reward is credited; the figure is a convenience */ }
      result = { code: 200, body };
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
// MESSAGES (member inbox)
// ═══════════════════════════════════════════
// Petro has a real inbox -- Snow deliberately does not (see petro/CLAUDE.md's
// "Structural differences from Snow"). Messages are admin-authored
// BROADCASTS stored once in `messages`; per-member read state lives in
// `messageReads` keyed `<uid>_<messageId>` so a broadcast never has to be
// fanned out into one document per member.
// Built fresh per call rather than held as a constant, so it picks up a
// renamed app. An admin-authored 'welcome' doc still overrides it entirely.
function defaultWelcomeMessage(s) {
  return {
    id: 'welcome',
    title: 'Welcome to the ' + brandName(s) + ' Investment Returns app!',
    body: 'You can earn daily income through investments via the app, and also earn daily wages by sharing your referral link with friends and family.',
  };
}
// ── A MESSAGE BELONGS TO ONE COUNTRY, OR TO ALL OF THEM ──
// Owner: "all country changes everything but images are same only edittable
// variables like prices, words like that." An inbox message IS words -- and
// words that name a currency, an amount or a payment operator are wrong in
// another country, so a broadcast must be able to be per-country.
//
// An EMPTY regionKey, or the explicit 'all', means every country. That is
// deliberately the permissive direction: every message written before this
// existed has no regionKey, and quietly hiding somebody's live announcements
// from most of the platform would be a worse surprise than showing one
// message too widely. Writing one for a single country is an explicit choice
// made with that country picked in the panel.
function messageInRegion(m, want) {
  if (!want || want === 'all') return true;
  const own = String((m && m.regionKey) || '').trim().toLowerCase();
  return !own || own === 'all' || own === want;
}
async function listBroadcastMessages(want, settingsRegion) {
  const snap = await db.collection('messages').orderBy('createdAt', 'desc').limit(100).get();
  const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const rows = all.filter(m => !m.deleted && messageInRegion(m, want));
  // A brand-new deployment has no admin-authored messages yet; the welcome
  // note the mockups show is served as a virtual row so the inbox is never
  // blank on day one. The moment an admin writes a real 'welcome' doc it
  // takes over (same id), so this can't ever duplicate it. Tested against
  // `all`, not `rows` -- an admin who DELETED the welcome message left a
  // tombstone behind, and checking the filtered list would resurrect it.
  //
  // It IS filtered by region though, and that is not the same test: a real
  // 'welcome' doc written for ONE country is not visible in the others, so
  // those still need the built-in row. A tombstone carries no regionKey, so
  // deleting the welcome still hides it everywhere -- which is exactly what
  // the admin who deleted it asked for.
  if (!all.some(m => m.id === 'welcome' && messageInRegion(m, want))) {
    rows.push({ ...defaultWelcomeMessage(await getSettings(settingsRegion)), createdAt: 0, date: '', time: '' });
  }
  return rows;
}
app.get('/messages', async (req, res) => {
  const uid = await verifyAuth(req);
  if (!uid) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    // The MEMBER's own country, never the hostname's -- the region middleware
    // has already resolved that for a signed-in caller, and currentRegionKey()
    // is what every other per-country read in this file uses.
    const rows = await listBroadcastMessages(currentRegionKey());
    const reads = await db.collection('messageReads').where('userId', '==', uid).limit(200).get();
    const readIds = new Set(reads.docs.map(d => d.data().messageId));
    res.json({ status: 'success', messages: rows.map(m => ({
      id: m.id, title: m.title || '', body: m.body || '',
      date: m.date || '', time: m.time || '', createdAt: m.createdAt || 0,
      read: readIds.has(m.id),
    })) });
  } catch (e) { res.status(500).json({ status: 'error', message: 'Could not load your messages' }); }
});
app.post('/messages/read', async (req, res) => {
  const uid = await verifyAuth(req);
  if (!uid) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const messageId = String(req.body.messageId || '').slice(0, 120);
  if (!messageId) return res.status(400).json({ status: 'error', message: 'messageId required' });
  try {
    // Deterministic doc id -> marking the same message read twice is a
    // harmless idempotent overwrite, never a duplicate row.
    await db.collection('messageReads').doc(uid + '_' + messageId)
      .set({ userId: uid, messageId, readAt: Date.now() }, { merge: true });
    res.json({ status: 'success' });
  } catch (e) { res.status(500).json({ status: 'error', message: 'Could not update this message' }); }
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
// `?region=ke` reads THAT region's settings. `overrides` names the fields
// the region has actually been given its own value for -- everything else
// on the screen is still inherited from Uganda, and the panel says so
// rather than letting the admin think they have already set it.
app.get('/admin/settings', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    await getRegions();
    const key = String(req.query.region || DEFAULT_REGION_KEY).toLowerCase();
    const region = regionByKey(key);
    let overrides = [];
    if (region.key !== DEFAULT_REGION_KEY) {
      const snap = await db.collection('settings').doc(settingsDocId(region.key)).get();
      overrides = snap.exists ? Object.keys(snap.data()).filter(k => k !== '_id' && !GLOBAL_ONLY_SETTINGS.includes(k)) : [];
    }
    res.json({
      status: 'success', settings: await getSettings(region.key),
      region: publicRegionView(region), regionKey: region.key,
      overrides, globalOnly: GLOBAL_ONLY_SETTINGS,
    });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
const SETTINGS_CRITICAL_RANGES = {
  withdrawFeePct: [0, 100], minWithdraw: [0, MAX_MONEY_AMOUNT], minDeposit: [0, MAX_MONEY_AMOUNT],
  welcomeBonus: [0, MAX_MONEY_AMOUNT], commL1: [0, 100], commL2: [0, 100], commL3: [0, 100],
  returnMultiple: [0, 1000], cycleDays: [1, 3650], maxWithdrawalsPerDay: [0, 1000],
  dailyCheckin: [0, MAX_MONEY_AMOUNT],
  turntableDailyMin: [0, MAX_MONEY_AMOUNT], turntableDailyMax: [0, MAX_MONEY_AMOUNT],
  autoApproveIntervalSec: [1, 3600], autoApproveMaxAmount: [0, MAX_MONEY_AMOUNT],
  // 0 = not scheduled; upper bound is a plain sanity cap (year 2100), not a
  // real business constraint -- an admin fat-fingering a date shouldn't be
  // able to silently store something outside "any date anyone would ever
  // actually pick here."
  openingCountdownAt: [0, 4102444800000],
  // A floor above 0 -- the client divides scroll distance by this to get a
  // duration, so 0 would produce an infinite/frozen animation rather than
  // a genuinely paused one. 2000 is a generous ceiling, well past anything
  // that would still read as a legible scroll.
  activityTickerSpeed: [10, 2000],
  // Login / Sign Up backdrops. Opacity is stored as a PERCENT (0-100)
  // rather than a 0-1 fraction: every other number an admin types in
  // this panel is a whole number, and Math.round() below would flatten
  // 0.45 to 0. Blur is in px, capped at 40 -- past that the image is
  // indistinguishable from a flat colour wash and only costs GPU time.
  // 0 disables the rule. The upper bound is a sanity cap, not a business
  // one -- a multiple larger than the maximum withdrawal would make every
  // amount invalid, which the admin panel warns about rather than forbids.
  withdrawMultiple: [0, MAX_MONEY_AMOUNT],
  authHeroOpacity: [0, 100], authHeroBlur: [0, 40],
  authCardOpacity: [0, 100], authCardBlur: [0, 40],
  otpDailyLimitRegister: [0, 50], otpDailyLimitReset: [0, 50], otpDailyLimitBank: [0, 50],
};
const SETTINGS_BOOLEAN_FIELDS = ['linkPreviewEnabled', 'maintenanceMode', 'openingCountdownEnabled', 'requireInvestToWithdraw', 'autoApproveWithdrawalsEnabled', 'annEnabled', 'turntableEnabled', 'requireReferralCode', 'withdrawWindowEnabled', 'blockRootDomain', 'strictRegionHosts', 'bankOtpRequired'];
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
    // Which region's settings are being saved. Absent (or 'ug') means the
    // founding region, writing 'settings/main' exactly as this route always
    // has -- so every existing admin screen keeps working untouched.
    await getRegions();
    const regionKey = String(req.body.region || DEFAULT_REGION_KEY).toLowerCase();
    const targetRegion = regionByKey(regionKey);
    if (regionKey !== targetRegion.key)
      return res.status(400).json({ status: 'error', message: `There is no region "${regionKey}".` });
    const isRegionOverlay = targetRegion.key !== DEFAULT_REGION_KEY;
    if (isRegionOverlay) {
      // Backend-wide controls cannot be set per country -- see
      // GLOBAL_ONLY_SETTINGS. Refused rather than dropped: an admin who
      // typed a maintenance message into a region's screen and got a silent
      // success would believe that region was closed when it was not.
      const offending = GLOBAL_ONLY_SETTINGS.filter(k => k in updates);
      if (offending.length)
        return res.status(400).json({ status: 'error', message: `These apply to the whole platform, not one region, so set them on ${DEFAULT_REGION.name}: ${offending.join(', ')}.` });
    }
    // Fields the region should stop overriding and inherit from the founding
    // region again. Cleared by rewriting the region's document without them
    // rather than storing a null, which Object.assign() in getSettings()
    // would happily layer over a perfectly good inherited value.
    const clearFields = (Array.isArray(req.body.clear) ? req.body.clear : [])
      .map(k => String(k)).filter(k => k && k !== '_id' && !GLOBAL_ONLY_SETTINGS.includes(k));
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
    if ('allowedOrigins' in updates) {
      const r = sanitizeAllowedOrigins(updates.allowedOrigins);
      if (r.error) return res.status(400).json({ status: 'error', message: r.error });
      updates.allowedOrigins = r.hosts;
    }
    // Hostnames the app must never be served from, same validator as the
    // allowlist -- one bad line is named rather than silently dropped.
    if ('parkedHosts' in updates) {
      const r = sanitizeAllowedOrigins(updates.parkedHosts);
      if (r.error) return res.status(400).json({ status: 'error', message: r.error });
      updates.parkedHosts = r.hosts;
    }
    // The domain every country's short address hangs off. Refused rather
    // than coerced: a mistyped base domain silently stops every country's
    // subdomain resolving at once, which is the whole platform, and the
    // symptom (HOST_PARKED everywhere) points nowhere near the cause.
    if ('baseDomain' in updates) {
      const r = normalizeAllowedHost(updates.baseDomain);
      if (r.error) return res.status(400).json({ status: 'error', message: r.error });
      if (r.skip) return res.status(400).json({ status: 'error', message: 'The base domain cannot be blank -- it is what every country\'s short address is built from.' });
      updates.baseDomain = r.host;
    }
    // Which arrivals get moved onto a different address in their country.
    // Refused rather than coerced: a typo silently landing on 'off' would
    // read in the panel as saved while nobody is ever moved, and a typo
    // silently landing on 'always' would log every member out of his saved
    // password. Only the three known modes are accepted.
    if ('rotateEntry' in updates) {
      const mode = String(updates.rotateEntry == null ? '' : updates.rotateEntry).trim().toLowerCase();
      if (!ROTATE_ENTRY_MODES.includes(mode))
        return res.status(400).json({ status: 'error', message: 'Moving arrivals to another address must be off, visitors, or always.' });
      updates.rotateEntry = mode;
    }
    // The app name reaches every screen, so it is the one free-text setting
    // worth policing. Trim and cap it, refuse an empty one (an app with no
    // name is not a thing the owner can want, and the client would then fall
    // back to a default that contradicts what the panel shows as saved), and
    // refuse angle brackets outright. The client escapes it at every render
    // anyway -- this is the second lock, so a name that somehow reaches an
    // unescaped sink later cannot carry markup with it.
    if ('brandName' in updates) {
      const name = String(updates.brandName == null ? '' : updates.brandName).trim();
      if (!name) return res.status(400).json({ status: 'error', message: 'App name cannot be blank.' });
      if (name.length > 24) return res.status(400).json({ status: 'error', message: 'App name must be 24 characters or fewer.' });
      if (/[<>]/.test(name)) return res.status(400).json({ status: 'error', message: 'App name cannot contain < or >.' });
      updates.brandName = name;
    }
    // The two cash-out times. Refused rather than coerced: a silently
    // repaired time is a window the owner did not choose, on a screen whose
    // whole job is telling members exactly when they can cash out.
    for (const key of ['withdrawOpenFrom', 'withdrawOpenTo']) {
      if (!(key in updates)) continue;
      // Padded BEFORE parsing, not after: hhmmToMin() requires a two-digit
      // hour, and a hand-typed "9:00" is a perfectly clear time to refuse on
      // a technicality.
      let raw = String(updates[key] == null ? '' : updates[key]).trim();
      if (/^\d:\d{2}$/.test(raw)) raw = '0' + raw;
      if (hhmmToMin(raw) == null)
        return res.status(400).json({ status: 'error', message: `${key} must be a 24-hour time like 18:00` });
      updates[key] = raw;
    }
    // Equal times are refused too. from === to is not "open all day" and not
    // "closed all day" -- it is ambiguous, and withdrawWindowState() treats
    // it as unset, so saving it would show the member hours that are not
    // being enforced.
    {
      const f = 'withdrawOpenFrom' in updates ? updates.withdrawOpenFrom : null;
      const t = 'withdrawOpenTo' in updates ? updates.withdrawOpenTo : null;
      if (f != null && t != null && f === t)
        return res.status(400).json({ status: 'error', message: 'Cash-out opening and closing times cannot be the same.' });
    }
    if ('numberFont' in updates && !NUMBER_FONT_OPTIONS.includes(updates.numberFont))
      return res.status(400).json({ status: 'error', message: `numberFont must be one of: ${NUMBER_FONT_OPTIONS.join(', ')}` });
    // 'automatic' is deliberately NOT accepted here anymore (Round 102) --
    // it's still recognized when READING an already-stored legacy value
    // (normalizeProviderValue()), but nothing should ever WRITE it again
    // now that 'marzpay'/'pesajet' are the real, distinct canonical values.
    // 'manual' is likewise no longer accepted here -- manual deposit
    // collection was removed outright, so this field only ever picks the
    // automatic GATEWAY now. An already-stored legacy 'manual' value is
    // still read correctly (depositAutomaticProvider()'s own fallback to
    // MarzPay) -- it just can never be WRITTEN again going forward.
    if ('depositMethod' in updates && !['marzpay', 'pesajet'].includes(updates.depositMethod))
      return res.status(400).json({ status: 'error', message: `depositMethod must be 'marzpay' or 'pesajet'` });
    if ('withdrawMethod' in updates && !['follow', 'marzpay', 'pesajet', 'manual'].includes(updates.withdrawMethod))
      return res.status(400).json({ status: 'error', message: `withdrawMethod must be 'follow', 'marzpay', 'pesajet' or 'manual'` });
    // A gateway that cannot reach the picked country's phone numbers is not a
    // configuration worth storing: it would read as set up and fail on every
    // real payment. Refused with the reason rather than accepted and quietly
    // overridden at run time, so the admin finds out here and not from a
    // member. 'follow' and 'manual' are always fine -- one defers to the
    // deposit side (checked on its own line) and the other is admin-run.
    for (const [field, value] of [['depositMethod', updates.depositMethod],
                                  ['withdrawMethod', updates.withdrawMethod]]) {
      if (!(field in updates) || value === 'follow' || value === 'manual') continue;
      if (!gatewayServesRegion(value, targetRegion)) {
        const serves = (GATEWAY_DIAL_CODES[value] || []).map(d => '+' + d).join(', ');
        return res.status(400).json({ status: 'error', field, message:
          `${value} cannot be used for ${targetRegion.name || targetRegion.key}: it only serves ` +
          `${serves || 'other countries'}, and this country dials +${targetRegion.dialCode}. ` +
          `Use manual payments here until a gateway covers it.` });
      }
      // The gateway can reach the country, but the country's CURRENCY has to
      // agree with the market's or the money is labelled wrong end to end: a
      // region on +254 set to UGX would have MarzPay collect and pay KES while
      // every screen, ledger row and notification says UGX. Nothing downstream
      // could detect that -- the figures are right and the unit is a lie.
      const market = value === 'marzpay' ? marzMarket(targetRegion) : null;
      if (market && String(targetRegion.currency || '').toUpperCase() !== market.currency) {
        return res.status(400).json({ status: 'error', field, message:
          `${targetRegion.name || targetRegion.key} is set to ${targetRegion.currency || '(none)'}, ` +
          `but MarzPay settles ${market.code} in ${market.currency}. Fix the country's currency ` +
          `in Countries first, or this country's money would be shown in the wrong unit.` });
      }
    }
    // Stamped whenever the admin saves either announcement field, so the
    // Home screen's inline "Latest Announcement" row can show a real date
    // instead of inventing one. Not conditioned on the text actually being
    // different from what's stored -- "the admin just touched this" is a
    // fine enough definition of "updated" here, and checking for a real
    // diff would cost an extra read for a purely cosmetic date.
    if ('annTitle' in updates || 'annBody' in updates) updates.annUpdatedAt = FieldValue.serverTimestamp();
    if (isRegionOverlay) {
      const docId = settingsDocId(targetRegion.key);
      const ref = db.collection('settings').doc(docId);
      const cur = await ref.get();
      const next = Object.assign({}, cur.exists ? cur.data() : {}, updates);
      delete next._id;
      for (const k of clearFields) delete next[k];
      for (const k of GLOBAL_ONLY_SETTINGS) delete next[k];
      await ref.set(next, { merge: false });
    } else {
      await db.collection('settings').doc('main').set(updates, { merge: true });
    }
    _settingsCacheTs = 0;
    _settingsByRegion.clear();
    // Apply a domain change NOW rather than up to 60s later: the owner saves
    // this field precisely because a site is currently being refused, and
    // being told "wait a minute" while staring at a broken page is how a
    // working fix gets mistaken for a broken one.
    if ('allowedOrigins' in updates) { _mainAllowedHosts = updates.allowedOrigins; refreshCorsSnapshot(); }
    // Apply the host rules NOW rather than up to 60s later: the owner saves
    // these precisely because an address is behaving wrongly, and being
    // told to wait a minute while staring at it is how a working fix gets
    // mistaken for a broken one. Same reasoning as allowedOrigins above.
    if (['baseDomain', 'blockRootDomain', 'parkedHosts', 'strictRegionHosts'].some(k => k in updates)) {
      try { refreshHostPolicy(await getSettings(DEFAULT_REGION_KEY)); } catch (_) {}
    }
    logAdminAction(req, 'settings_updated', { region: targetRegion.key, fields: Object.keys(updates), cleared: clearFields });
    res.json({ status: 'success' });
  } catch (e) { res.status(500).json({ status: 'error', message: 'Could not save settings' }); }
});
// ── REGIONS: ADMIN CRUD ──
// Owner: "any country created". A region is created here, given its
// hostname(s), currency, dialling code and number shape, and from then on
// its settings and its product prices are edited through the same Settings
// and Products screens with that region picked.
app.get('/admin/regions', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    _regionsCacheTs = 0;
    const regions = await getRegions();
    res.json({
      status: 'success', defaultKey: DEFAULT_REGION_KEY,
      // Each country's RESOLVED addresses alongside its raw fields, so the
      // panel prints g26e.petro-platform.com rather than leaving the admin
      // to join the label to the base domain in their head.
      regions: regions.map(r => Object.assign({}, r, { resolvedHosts: regionHostnames(r) })),
      baseDomain: _baseDomain, blockRootDomain: _blockRootDomain,
      parkedHosts: _parkedHosts.slice(), strictRegionHosts: _strictRegionHosts,
    });
  } catch (e) { res.status(500).json({ status: 'error', message: 'Could not load regions' }); }
});
// ── WHICH COUNTRY DOES THIS ADDRESS SERVE, AND WHY ──
// Owner: "those subdomain are not working well why".
//
// A short address serving the wrong country is close to invisible from the
// outside: the app just shows that country's prices and refuses logins and
// referral codes that belong to members of another one. This answers the
// question directly, and -- the part that matters -- says WHY, because the
// usual cause is that the base domain setting still holds the built-in
// default while the real site is on a domain of the owner's own, so no
// country's short address matches anything at all.
app.post('/admin/regions/check-host', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    await getSettings(DEFAULT_REGION_KEY);
    const regions = await getRegions();
    const host = hostOnly(req.body.host || '');
    if (!host) return res.status(400).json({ status: 'error', message: 'Type an address to check.' });
    const claimedBy = regions.find(r => r.active && regionHostnames(r).includes(host)) || null;
    const resolved = regionForHost(host);
    const parked = hostIsParked(host);
    const reasons = [];
    if (parked) {
      reasons.push(_blockRootDomain && _baseDomain && (host === _baseDomain || host === 'www.' + _baseDomain)
        ? 'This is the root domain, and "the root domain does not serve the app" is switched on.'
        : (_parkedHosts.includes(host)
          ? 'This address is on the retired list.'
          : 'No country claims this address and "only a country\'s own addresses work" is switched on.'));
    }
    if (isInfraHost(host)) reasons.push('This is one of the platform\'s own service addresses, so it is never treated as retired.');
    if (!claimedBy) {
      reasons.push(`No country claims this exact address, so it falls back to ${resolved.name} — the founding country.`);
      // The single most common cause, named outright.
      if (_baseDomain && !host.endsWith('.' + _baseDomain) && host !== _baseDomain)
        reasons.push(`It is not under the base domain, which is set to "${_baseDomain}". Short addresses are built as <short name>.${_baseDomain}, so an address on any other domain can never match one.`);
      else if (_baseDomain)
        reasons.push(`It is under the base domain "${_baseDomain}", so adding its first label as a short name on the country you want would claim it.`);
    } else {
      reasons.push(`${claimedBy.name} claims this address.`);
    }
    // The question that was actually breaking the platform, answered
    // outright: a refused origin shows the app a bare network error, so
    // "allowed to reach the backend" is invisible from the outside.
    const reachable = corsHostAllowed(host) || isInfraHost(host);
    reasons.push(reachable
      ? 'It is allowed to reach the backend.'
      : 'It is NOT allowed to reach the backend, so the app there cannot load anything at all -- no prices, no photos. Add its domain under Settings -> Allowed website domains; subdomains of anything listed there are covered automatically.');
    res.json({
      status: 'success', host,
      claimed: !!claimedBy,
      region: { key: resolved.key, name: resolved.name, currency: resolved.currency, dialCode: resolved.dialCode },
      usesBareLocal: regionUsesBareLocal(resolved),
      loginExample: phoneToEmail('0700000000', resolved),
      parked, reachable, reasons,
      baseDomain: _baseDomain, blockRootDomain: _blockRootDomain, strictRegionHosts: _strictRegionHosts,
    });
  } catch (e) { res.status(500).json({ status: 'error', message: 'Could not check that address' }); }
});
const REGION_KEY_RE = /^[a-z0-9][a-z0-9-]{0,23}$/;
app.post('/admin/regions/save', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const raw = req.body.region || {};
  const key = String(raw.key || '').trim().toLowerCase();
  if (!REGION_KEY_RE.test(key))
    return res.status(400).json({ status: 'error', message: 'The region id must be lowercase letters, digits or dashes (for example "ke"), 24 characters or fewer.' });
  const r = normalizeRegion(raw, key);
  if (!r.name) return res.status(400).json({ status: 'error', message: 'Give the region a country name.' });
  if (!/^[A-Z][A-Z0-9 .$]{0,7}$/.test(r.currency))
    return res.status(400).json({ status: 'error', message: 'The currency label must be 1 to 8 characters, letters and digits only (for example UGX or KES).' });
  if (!/^\d{1,4}$/.test(r.dialCode))
    return res.status(400).json({ status: 'error', message: 'The dialling code must be 1 to 4 digits, with no + sign (for example 256 or 254).' });
  if (!(r.localLength >= 5 && r.localLength <= 12))
    return res.status(400).json({ status: 'error', message: 'The local number length must be between 5 and 12 digits.' });
  if (r.prefixes.length > 12 || r.prefixes.some(p => p.length > 4))
    return res.status(400).json({ status: 'error', message: 'List at most 12 number prefixes, each 4 digits or fewer (for example 7 for Uganda).' });
  if (r.prefixes.some(p => p.length >= r.localLength))
    return res.status(400).json({ status: 'error', message: 'A number prefix cannot be as long as the whole local number.' });
  if (!(r.utcOffsetMin >= -720 && r.utcOffsetMin <= 840))
    return res.status(400).json({ status: 'error', message: 'The clock offset must be between -720 and +840 minutes.' });
  // Same split as the short addresses directly below: normalizeRegion stays
  // permissive because it also runs over what is already stored, and the SAVE
  // route refuses by name. An admin who ticks a language and is shown a list
  // without it has been given a country he did not configure.
  const typedLangs = (Array.isArray(raw.languages) ? raw.languages : String(raw.languages || '').split(/[\s,\n]+/))
    .map(c => String(c == null ? '' : c).trim().toLowerCase()).filter(Boolean);
  const badLang = typedLangs.find(c => !LANGUAGE_CODES.includes(c));
  if (badLang)
    return res.status(400).json({ status: 'error', message: `"${badLang}" is not a language this app can display. Choose from: ${LANGUAGE_CODES.join(', ')}.` });
  if (raw.defaultLang && !r.languages.includes(String(raw.defaultLang).trim().toLowerCase()))
    return res.status(400).json({ status: 'error', message: 'The default language has to be one of the languages this country allows.' });
  try {
    _regionsCacheTs = 0;
    const existing = await getRegions();
    // Two regions sharing a dialling code would collide in the synthetic
    // login email (see phoneToEmail) -- the same local number in both would
    // resolve to one Firebase account. Refused here, which is what keeps
    // that function's guarantee true.
    const dialClash = existing.find(o => o.key !== key && o.dialCode === r.dialCode);
    if (dialClash)
      return res.status(400).json({ status: 'error', message: `Dialling code ${r.dialCode} is already used by ${dialClash.name} (${dialClash.key}). Each region needs its own.` });
    // A hostname can only belong to one region, or regionForHost() would
    // pick whichever happened to sort first and the currency shown would
    // depend on document order. Checked against the RESOLVED hostnames, so
    // a short label and somebody else's full hostname cannot collide either.
    const mine = regionHostnames(r);
    for (const h of mine) {
      const owner = existing.find(o => o.key !== key && regionHostnames(o).includes(h));
      if (owner) return res.status(400).json({ status: 'error', message: `${h} already belongs to ${owner.name} (${owner.key}).` });
    }
    if (r.labels.length > 24)
      return res.status(400).json({ status: 'error', message: 'A country can hold at most 24 short addresses.' });
    // A short address that does not survive normalisation unchanged is
    // REFUSED here rather than quietly repaired. normalizeRegion() has to
    // stay permissive -- it also runs over whatever is already stored, and
    // refusing there would take a country offline -- but an admin typing
    // "he!lo" and being shown "hello" in the list afterwards has been given
    // an address they did not choose, which is the same class of mistake
    // the cash-out times are refused for.
    const typed = (Array.isArray(raw.labels) ? raw.labels : String(raw.labels || '').split(/[\s,\n]+/))
      .map(l => String(l == null ? '' : l).trim()).filter(Boolean);
    for (const t of typed) {
      if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(t.toLowerCase()))
        return res.status(400).json({ status: 'error', message: `"${t}" is not a usable address. Use lowercase letters, digits and dashes only, not starting or ending with a dash.` });
      if (t.toLowerCase() === 'www')
        return res.status(400).json({ status: 'error', message: '"www" cannot be a country address -- it is the root domain, which does not serve the app.' });
      if (t.length > 40)
        return res.status(400).json({ status: 'error', message: `"${t}" is too long for an address (40 characters maximum).` });
    }
    await db.collection('regions').doc(key).set(r, { merge: false });
    _regionsCacheTs = 0;
    _settingsCacheTs = 0;
    await getRegions();
    logAdminAction(req, 'region_saved', { key, currency: r.currency, hosts: r.hosts.length });
    res.json({ status: 'success', region: r });
  } catch (e) { res.status(500).json({ status: 'error', message: 'Could not save this region' }); }
});
// Owner: "or make when server auto generates subdomains every session of
// the specific country."
//
// A subdomain cannot be minted per SESSION -- a browser can only reach a
// hostname that DNS already answers for and that the host already holds a
// certificate for, and neither happens in the second between tapping a link
// and the page loading. What is real, and what this does, is mint a fresh
// unguessable label on demand: with a wildcard record (*.<base domain>)
// pointed at the app and a wildcard custom domain on the host, the label
// works the moment it is saved. Without one, each label still needs its own
// DNS record and certificate, so generate a few and add them at the host in
// one sitting rather than expecting one per visit.
//
// Labels are ADDED, never replaced -- an address already shared with members
// has to keep working. Remove an old one by editing the country.
const LABEL_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'; // no l/o/0/1: these get read off a screen and typed
app.post('/admin/regions/add-label', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const key = String(req.body.key || '').trim().toLowerCase();
  const len = Math.min(12, Math.max(3, Math.round(Number(req.body.length)) || 4));
  try {
    _regionsCacheTs = 0;
    const regions = await getRegions();
    const region = regions.find(x => x.key === key);
    if (!region) return res.status(400).json({ status: 'error', message: `There is no country "${key}".` });
    const held = (region.labels || []).length;
    if (held >= 24)
      return res.status(400).json({ status: 'error', message: 'This country already holds 24 short addresses. Remove one first.' });
    // Several at once, because moving arrivals between addresses needs a POOL
    // and adding them one at a time is a lot of tapping. Capped at whatever
    // room is left under the 24 this country may hold.
    const want = Math.min(24 - held, Math.max(1, Math.round(Number(req.body.count)) || 1));
    // Unique across EVERY country, not just this one -- two countries
    // sharing a label would make the currency depend on document order.
    const taken = new Set();
    for (const r of regions) for (const l of (r.labels || [])) taken.add(l);
    const made = [];
    for (let i = 0; i < want; i++) {
      let label = null;
      for (let tries = 0; tries < 60 && !label; tries++) {
        const cand = randFromAlphabet(LABEL_ALPHABET, len).toLowerCase();
        if (!taken.has(cand)) label = cand;
      }
      if (!label) break;
      taken.add(label);
      made.push(label);
    }
    if (!made.length) return res.status(500).json({ status: 'error', message: 'Could not find an unused address. Try a longer one.' });
    const next = normalizeRegion(Object.assign({}, region, { labels: (region.labels || []).concat(made) }), key);
    await db.collection('regions').doc(key).set(next, { merge: false });
    _regionsCacheTs = 0;
    await getRegions();
    logAdminAction(req, 'region_label_added', { key, labels: made.join(', ') });
    const hostOf = l => (_baseDomain ? l + '.' + _baseDomain : l);
    res.json({ status: 'success', label: made[0], labels: made, host: hostOf(made[0]), hosts: made.map(hostOf), region: next });
  } catch (e) { res.status(500).json({ status: 'error', message: 'Could not generate an address' }); }
});
// Owner: "why can't l delete a country?"
//
// Three separate refusals live here and they used to be hard to tell apart --
// the first said only "Unauthorized", which names no cause at all. Each one
// now says which it is and what to do instead, because "it just will not
// delete" sends you looking at the button rather than at the reason.
app.post('/admin/regions/delete', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  // Deleting a country is owner-only, and a staff admin hitting this got a
  // bare 401 that reads as a broken panel. Separated from the admin check
  // above so the message can say WHICH of the two failed.
  if (!verifyOwner(req))
    return res.status(403).json({ status: 'error', code: 'OWNER_ONLY', message:
      'Only an owner account can delete a country. You are signed in as ' +
      `${(req.adminUser && req.adminUser.role) || 'a staff admin'}` +
      ' -- sign in with the master admin key, or have an owner do it.' });
  const key = String(req.body.key || '').trim().toLowerCase();
  if (!key) return res.status(400).json({ status: 'error', message: 'key required' });
  if (key === DEFAULT_REGION_KEY)
    return res.status(400).json({ status: 'error', code: 'FOUNDING_REGION', message: 'The founding region cannot be deleted -- it is where every unknown domain and every account without a region lands. Switch it off instead if you need it out of the way.' });
  try {
    const known = await getRegions();
    if (!known.some(r => r.key === key))
      return res.status(404).json({ status: 'error', code: 'NO_SUCH_REGION', message:
        `There is no country with the id "${key}". It may already have been deleted -- reload the Countries tab.` });
    // Refused while anyone is signed up there. Deleting the region would
    // silently move those members onto Uganda's prices and currency, which
    // is a repricing of live accounts, not a tidy-up.
    //
    // The COUNT is reported, not just the fact: "there are members here" on a
    // country you believe is empty reads as a bug, whereas "1 member" sends
    // you to look at that one account. Capped so a large region costs one
    // bounded read rather than a full scan.
    const members = await db.collection('users').where('regionKey', '==', key).limit(51).get();
    if (!members.empty) {
      const n = members.docs.length;
      const howMany = n > 50 ? 'more than 50 members' : `${n} member${n === 1 ? '' : 's'}`;
      return res.status(400).json({ status: 'error', code: 'REGION_HAS_MEMBERS', members: n, message:
        `${howMany} ${n === 1 ? 'is' : 'are'} signed up in this country, so it cannot be deleted -- ` +
        'that would move those accounts onto the founding country\'s currency and prices. ' +
        'Switch the country OFF instead: its addresses stop working and nobody new can join, ' +
        'while those members keep their own money and plans.' });
    }
    await db.collection('regions').doc(key).delete();
    // Its settings and its product prices go with it. Left behind, they
    // would silently come back into force the day somebody recreated a
    // region under the same id -- with figures nobody remembers setting.
    // The confirm dialog in the panel promises this; keep it true.
    try { await db.collection('settings').doc(settingsDocId(key)).delete(); } catch (_) {}
    try {
      const prods = await db.collection('products').get();
      const batch = db.batch();
      let touched = 0;
      for (const d of prods.docs) {
        const r = d.data().regions;
        if (r && typeof r === 'object' && r[key] !== undefined) {
          batch.update(d.ref, { ['regions.' + key]: FieldValue.delete() });
          touched++;
        }
      }
      if (touched) await batch.commit();
    } catch (e) { console.warn('Region delete: could not clear product overrides for ' + key + ':', e.message); }
    _regionsCacheTs = 0;
    _settingsCacheTs = 0;
    _settingsByRegion.clear();
    _productsCacheTs = 0;
    await getRegions();
    logAdminAction(req, 'region_deleted', { key });
    res.json({ status: 'success' });
  } catch (e) { res.status(500).json({ status: 'error', message: 'Could not delete this region' }); }
});
app.get('/admin/petro-images', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const [referral, logo, spin, profilegif, downloadbg, authhero, authcard, banner2, banner3, homefooter, profilecard] = await Promise.all([
      getPetroImage('referral'), getPetroImage('logo'), getPetroImage('spin'), getPetroImage('profilegif'),
      getPetroImage('downloadbg'), getPetroImage('authhero'), getPetroImage('authcard'),
      getPetroImage('banner2'), getPetroImage('banner3'), getPetroImage('homefooter'), getPetroImage('profilecard'),
    ]);
    res.json({ status: 'success', referral, logo, spin, profilegif, downloadbg, authhero, authcard, banner2, banner3, homefooter, profilecard });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/petro-image/set', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const slot = String(req.body.slot || '');
  if (!PETRO_IMAGE_SLOTS.includes(slot)) return res.status(400).json({ status: 'error', message: 'Unknown image slot' });
  const image = String(req.body.image || '');
  if (!/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(image) || image.length > 2_800_000)
    return res.status(400).json({ status: 'error', message: 'Invalid image' });
  try {
    await db.collection('banners').doc('petro-' + slot).set({ image });
    delete _petroImageCache[slot];
    logAdminAction(req, 'petro_image_set', { slot });
    res.json({ status: 'success' });
  } catch (e) { res.status(500).json({ status: 'error', message: 'Could not save this image' }); }
});
app.post('/admin/petro-image/clear', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const slot = String(req.body.slot || '');
  if (!PETRO_IMAGE_SLOTS.includes(slot)) return res.status(400).json({ status: 'error', message: 'Unknown image slot' });
  try {
    await db.collection('banners').doc('petro-' + slot).set({ image: null });
    delete _petroImageCache[slot];
    logAdminAction(req, 'petro_image_cleared', { slot });
    res.json({ status: 'success' });
  } catch (e) { res.status(500).json({ status: 'error', message: 'Could not clear this image' }); }
});
// ── BRAND ASSETS (admin) ──
// The panel shows what is live, which for an un-uploaded icon is the stock
// one that ships in the build -- so `custom` is reported separately from the
// image itself, or the owner could not tell "my icon" from "the default".
app.get('/admin/brand-assets', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const [icon, prev] = await Promise.all([getBrandAsset('app-icon-512'), getBrandAsset('link-preview')]);
    const url = a => (a && a.buf) ? `data:${a.mime};base64,${a.buf.toString('base64')}` : null;
    res.json({
      status: 'success',
      appIcon: url(icon), appIconCustom: !!(icon && icon.custom),
      linkPreview: url(prev), linkPreviewCustom: !!(prev && prev.custom),
      sizes: { appIcon: '512 × 512', linkPreview: '1200 × 630' }
    });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/app-icon/set', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  // BOTH renditions come from one upload and are validated before EITHER is
  // written. Writing the 512 and then rejecting the 192 would leave two
  // different logos live at once -- on Android that shows as the icon
  // changing between the launcher and the task switcher.
  const big = readBrandUpload(req.body.png512, 'app-icon-512');
  if (big.error) return res.status(400).json({ status: 'error', message: big.error });
  const small = readBrandUpload(req.body.png192, 'app-icon-192');
  if (small.error) return res.status(400).json({ status: 'error', message: small.error });
  try {
    await writeBrandAsset('app-icon-512', big.buf, big.mime);
    await writeBrandAsset('app-icon-192', small.buf, small.mime);
    logAdminAction(req, 'app_icon_set', { bytes: big.buf.length + small.buf.length });
    res.json({ status: 'success' });
  } catch (e) { res.status(500).json({ status: 'error', message: 'Could not save the app icon' }); }
});
app.post('/admin/app-icon/clear', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    await db.collection('banners').doc('brand-app-icon-512').delete();
    await db.collection('banners').doc('brand-app-icon-192').delete();
    delete _brandAssetCache['app-icon-512']; delete _brandAssetCache['app-icon-192'];
    logAdminAction(req, 'app_icon_cleared', {});
    res.json({ status: 'success' });
  } catch (e) { res.status(500).json({ status: 'error', message: 'Could not clear the app icon' }); }
});
app.post('/admin/link-preview/set', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const img = readBrandUpload(req.body.image, 'link-preview');
  if (img.error) return res.status(400).json({ status: 'error', message: img.error });
  try {
    await writeBrandAsset('link-preview', img.buf, img.mime);
    logAdminAction(req, 'link_preview_set', { bytes: img.buf.length });
    res.json({ status: 'success' });
  } catch (e) { res.status(500).json({ status: 'error', message: 'Could not save the link preview' }); }
});
app.post('/admin/link-preview/clear', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    await db.collection('banners').doc('brand-link-preview').delete();
    delete _brandAssetCache['link-preview'];
    logAdminAction(req, 'link_preview_cleared', {});
    res.json({ status: 'success' });
  } catch (e) { res.status(500).json({ status: 'error', message: 'Could not clear the link preview' }); }
});
app.get('/admin/banner', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try { res.json({ status: 'success', ...(await getHomeBanner()) }); }
  catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
// Takes image, video, or both, and only touches the keys actually sent --
// the image and the video are set from two separate controls in the admin
// panel, and a plain .set({image}) here would silently wipe a configured
// video the moment the poster was re-uploaded.
app.post('/admin/banner/set', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const patch = {};
  let dropUploadedVideo = false;
  if (req.body.image != null) {
    const image = String(req.body.image || '');
    if (!/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(image) || image.length > 2_800_000)
      return res.status(400).json({ status: 'error', message: 'Invalid image' });
    patch.image = image;
  }
  if (req.body.video != null) {
    const v = sanitizeBannerVideoUrl(req.body.video);
    if (v.error) return res.status(400).json({ status: 'error', message: v.error });
    patch.video = v.video;
    // A typed link replaces an uploaded file, the mirror of the upload route
    // clearing the link -- exactly one of the two is ever the live source, so
    // there is never a question of which one the banner is playing. The
    // stored bytes go too rather than lingering unreachable in the database.
    patch.videoVersion = null;
    dropUploadedVideo = true;
  }
  if (!Object.keys(patch).length) return res.status(400).json({ status: 'error', message: 'Nothing to save' });
  try {
    const ref = db.collection('banners').doc('home');
    const snap = await ref.get();
    await ref.set({ ...(snap.exists ? snap.data() : {}), ...patch });
    if (dropUploadedVideo) { await db.collection('banners').doc('home-video').delete(); _bannerVideoCacheTs = 0; }
    _bannerCacheTs = 0;
    logAdminAction(req, 'banner_set', { fields: Object.keys(patch).join(',') });
    res.json({ status: 'success' });
  } catch (e) { res.status(500).json({ status: 'error', message: 'Could not save the banner' }); }
});
// `?what=video` clears just the video and leaves the poster image in place;
// no parameter clears the whole banner, as it always did.
app.post('/admin/banner/clear', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const ref = db.collection('banners').doc('home');
    // "Remove video" has to clear BOTH sources -- the typed link and the
    // uploaded file -- or the owner would remove one and still see a video.
    if (String(req.query.what || req.body.what || '') === 'video') {
      const snap = await ref.get();
      await ref.set({ ...(snap.exists ? snap.data() : {}), video: null, videoVersion: null });
      await db.collection('banners').doc('home-video').delete();
      _bannerVideoCacheTs = 0;
    } else {
      await ref.delete();
      await db.collection('banners').doc('home-video').delete();
      _bannerVideoCacheTs = 0;
    }
    _bannerCacheTs = 0;
    res.json({ status: 'success' });
  } catch (e) { res.status(500).json({ status: 'error', message: 'Could not clear the banner' }); }
});
// Upload the video FILE into the database, rather than pointing at one.
// Owner: "why can't we just upload video to database instead of url".
//
// The bytes land in their own `banners/home-video` document and are served
// from /public/banner-video, so they never ride along in the every-boot
// /public/banner JSON. The 4 MB cap is not a database limit (Mongo allows
// 16 MB a document) -- it is a members' data-bill limit: this clip loads on
// every phone that opens the app, and a banner loop has no business costing
// someone more than a few seconds of video.
app.post('/admin/banner/video-upload', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const raw = String(req.body.video || '');
  const m = /^data:(video\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(raw);
  if (!m) return res.status(400).json({ status: 'error', message: 'That is not a video file. Choose an .mp4 or .webm.' });
  const mime = m[1].toLowerCase();
  if (!BANNER_VIDEO_TYPES[mime]) {
    return res.status(400).json({ status: 'error', message: `${mime} will not play on every phone. Save the clip as MP4 (H.264) -- that is the one format Android and iPhone both play.` });
  }
  let buf;
  try { buf = Buffer.from(m[2], 'base64'); } catch (_) { buf = null; }
  if (!buf || !buf.length) return res.status(400).json({ status: 'error', message: 'That video file could not be read.' });
  if (buf.length > BANNER_VIDEO_MAX_BYTES) {
    return res.status(400).json({ status: 'error', message: `That video is ${Math.round(buf.length / 1024 / 1024 * 10) / 10} MB. Keep it under 4 MB -- it downloads on every member's phone. A short, silent, muted loop of a few seconds is what fits.` });
  }
  try {
    const version = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16);
    await db.collection('banners').doc('home-video').set({ data: buf.toString('base64'), mime, bytes: buf.length, version });
    const ref = db.collection('banners').doc('home');
    const snap = await ref.get();
    // An uploaded file wins over any typed link, and clears it, so there is
    // never a question of which of the two the banner is actually playing.
    await ref.set({ ...(snap.exists ? snap.data() : {}), video: null, videoVersion: version });
    _bannerCacheTs = 0; _bannerVideoCacheTs = 0;
    logAdminAction(req, 'banner_video_uploaded', { bytes: buf.length, mime });
    res.json({ status: 'success', bytes: buf.length, version });
  } catch (e) { res.status(500).json({ status: 'error', message: 'Could not save the video' }); }
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
// A product's total payout, in priority order:
//   1. its own multiplier (price x multiplier) -- the owner's preferred
//      control, since repricing then updates the payout automatically;
//   2. an explicit expectedReturn typed in for that product;
//   3. the global returnMultiple, kept only as a fallback for products that
//      predate per-product multipliers.
// Everything that needs a payout figure must go through this, so the app,
// the admin panel and the actual credit can never disagree about it.
function productExpectedReturn(p, sett) {
  const price = Number(p && p.price) || 0;
  const mult = Number(p && p.multiplier);
  if (Number.isFinite(mult) && mult > 0) return Math.round(price * mult);
  const explicit = Number(p && p.expectedReturn);
  if (Number.isFinite(explicit) && explicit > 0) return Math.round(explicit);
  return Math.round(price * ((sett && sett.returnMultiple) || 30));
}
// `out`, when given, is written with WHICH field refused and why, so the save
// route can name the box the owner has to go and fix. There are fifteen
// separate ways to be refused in here and they all used to arrive as ONE
// sentence naming four fields ("key, name, price, or cycle/return"), which
// made a refused save pure guesswork -- the report that prompted this was
// "product 12 failed to save spins", and spins were not among the four things
// the message listed. The `null` return is unchanged: it is the contract
// test-product-config.js drives, and every caller still reads truthiness.
// Named `refuse`, not `bad`: several harnesses lift this function into their
// own scope with eval/new Function, and `bad` is already the failure counter
// in test-spin-and-withdraw.js.
function sanitizeProductInput(p, fallbackOrder, out) {
  const refuse = (field, why) => { if (out) { out.field = field; out.why = why; } return null; };
  const key = String(p?.key || '').trim();
  if (!key || key.length > 64 || !/^[a-zA-Z0-9_-]+$/.test(key))
    return refuse('Key', 'must be 1-64 characters, letters/numbers/hyphen/underscore only');
  const name = String(p?.name || '').trim().slice(0, 100);
  if (!name) return refuse('Name', 'cannot be blank');
  const price = Math.round(Number(p?.price));
  if (!Number.isFinite(price) || price < 1 || price > MAX_MONEY_AMOUNT)
    return refuse('Price', `must be a number between 1 and ${MAX_MONEY_AMOUNT}`);
  let cycle = null;
  if (p?.cycle != null && p.cycle !== '') {
    cycle = Number(p.cycle);
    if (!Number.isFinite(cycle) || cycle <= 0 || cycle > 3650 || !Number.isInteger(cycle))
      return refuse('Cycle (days)', 'must be a whole number of days between 1 and 3650');
  }
  let expectedReturn = null;
  if (p?.expectedReturn != null && p.expectedReturn !== '') {
    expectedReturn = Math.round(Number(p.expectedReturn));
    if (!Number.isFinite(expectedReturn) || expectedReturn < 1 || expectedReturn > MAX_MONEY_AMOUNT)
      return refuse('Total payout', `must be a number between 1 and ${MAX_MONEY_AMOUNT}`);
  }
  // Owner: "products will have different rates of multipliers so don't fix
  // it in settings." So the multiple lives on the PRODUCT. When set it wins
  // over expectedReturn (see productExpectedReturn), which lets the admin
  // reprice a product and have its payout follow automatically instead of
  // having to recompute the total by hand every time.
  let multiplier = null;
  if (p?.multiplier != null && p.multiplier !== '') {
    multiplier = Number(p.multiplier);
    if (!Number.isFinite(multiplier) || multiplier <= 0 || multiplier > 1000)
      return refuse('Multiplier (×)', 'must be a number greater than 0 and no more than 1000');
  }
  // Owner: "make when l can configure every spin price for each product like
  // product 2 buying, amount 200 to 1000 number of spins like that." Each
  // product carries its own turntable band and spin count -- there is no
  // global percentage or tier threshold any more.
  let spinMin = null, spinMax = null;
  if (p?.spinMin != null && p.spinMin !== '') {
    spinMin = Math.round(Number(p.spinMin));
    if (!Number.isFinite(spinMin) || spinMin < 0 || spinMin > MAX_MONEY_AMOUNT)
      return refuse('Win from', `must be a number between 0 and ${MAX_MONEY_AMOUNT}`);
  }
  if (p?.spinMax != null && p.spinMax !== '') {
    spinMax = Math.round(Number(p.spinMax));
    if (!Number.isFinite(spinMax) || spinMax < 0 || spinMax > MAX_MONEY_AMOUNT)
      return refuse('Win to', `must be a number between 0 and ${MAX_MONEY_AMOUNT}`);
  }
  // A band that runs backwards would silently pay the wrong amount, so it is
  // rejected at save time rather than clamped quietly at spin time.
  if (spinMin != null && spinMax != null && spinMax < spinMin)
    return refuse('Win to', 'cannot be less than "Win from"');
  let spinCount = 0;
  if (p?.spinCount != null && p.spinCount !== '') {
    spinCount = Math.round(Number(p.spinCount));
    if (!Number.isFinite(spinCount) || spinCount < 0 || spinCount > MAX_SPINS_PER_PURCHASE)
      return refuse('Spins per purchase', `must be a whole number between 0 and ${MAX_SPINS_PER_PURCHASE}`);
  }
  // Opening schedule -- see productOpenState() for what each field means and
  // why the two shapes (a one-off moment, and a daily window) coexist.
  // Rejected rather than clamped: a malformed time silently becoming 00:00
  // would open a product the owner meant to keep shut.
  let openAt = null;
  if (p?.openAt != null && p.openAt !== '') {
    openAt = typeof p.openAt === 'number' ? p.openAt : Date.parse(p.openAt);
    if (!Number.isFinite(openAt) || openAt <= 0) return refuse('Opens at (one-off)', 'is not a date the server can read');
  }
  // Padded BEFORE parsing, exactly as the cash-out-hours settings route does:
  // hhmmToMin() demands a two-digit hour, so a stored or hand-sent "9:00"
  // would be refused on a technicality that has nothing to do with the owner.
  // An <input type="time"> always hands over "HH:MM", so this only ever
  // matters for a legacy document or a direct POST -- but the two routes
  // disagreeing about what a valid time looks like is the kind of difference
  // that surfaces as an unexplainable refusal.
  const padHHMM = v => { const s = String(v).trim(); return /^\d:\d\d$/.test(s) ? '0' + s : s; };
  let openFrom = null, openTo = null;
  if (p?.openFrom != null && p.openFrom !== '') {
    openFrom = padHHMM(p.openFrom);
    if (hhmmToMin(openFrom) == null) return refuse('Open daily from', 'must be a time of day like 15:00');
  }
  if (p?.openTo != null && p.openTo !== '') {
    openTo = padHHMM(p.openTo);
    if (hhmmToMin(openTo) == null) return refuse('until', 'must be a time of day like 16:45');
  }
  // Half a window is not a schedule -- it would read as "opens at 14:00" and
  // silently never close, or never open. Both ends, or neither.
  if ((openFrom == null) !== (openTo == null))
    return refuse('Open daily from / until', 'a daily window needs BOTH times, or neither');
  if (openFrom != null && openFrom === openTo)
    return refuse('Open daily from / until', 'a daily window cannot start and end at the same minute');
  const image = typeof p?.image === 'string' ? p.image.slice(0, 2_800_000) : '';
  const order = p?.order != null ? Number(p.order) : fallbackOrder;
  return { key, name, price, cycle, expectedReturn, multiplier, spinMin, spinMax, spinCount, image, active: p?.active !== false, comingSoon: p?.comingSoon === true, openAt, openFrom, openTo, order: Number.isFinite(order) ? order : fallbackOrder, deleted: false };
}
// `?region=ke` hands the editor that region's view of every product -- its
// own price where it has one, Uganda's where it has not -- plus `overrides`,
// the per-product list of fields that region has actually set, so the panel
// can show which figures are its own and which are still inherited.
// Without a region it returns the RAW documents exactly as before, which is
// the founding region's own editor.
app.get('/admin/products', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    await getRegions();
    const key = String(req.query.region || DEFAULT_REGION_KEY).toLowerCase();
    const region = regionByKey(key);
    const raw = await getProductsRaw();
    if (region.key === DEFAULT_REGION_KEY)
      return res.json({ status: 'success', products: raw.map(p => { const { regions, ...rest } = p; return rest; }), regionKey: region.key, region: publicRegionView(region), overrides: {} });
    const overrides = {};
    for (const p of raw) {
      const o = p.regions && p.regions[region.key];
      overrides[p.key] = o ? PRODUCT_REGION_FIELDS.filter(f => o[f] !== undefined && o[f] !== null && o[f] !== '') : [];
    }
    res.json({
      status: 'success', products: raw.map(p => applyRegionToProduct(p, region.key)),
      regionKey: region.key, region: publicRegionView(region), overrides,
      regionFields: PRODUCT_REGION_FIELDS,
    });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/products/save', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const list = Array.isArray(req.body.products) ? req.body.products : [];
    await getRegions();
    const regionKey = String(req.body.region || DEFAULT_REGION_KEY).toLowerCase();
    const region = regionByKey(regionKey);
    if (regionKey !== region.key)
      return res.status(400).json({ status: 'error', message: `There is no region "${regionKey}".` });
    const sanitized = [];
    // Owner: "make sure all 2 asset name fields are editable" -- Key is no
    // longer locked once an asset exists, so a save can now be a RENAME
    // (oldKey !== key), not just an update. Renaming is moving the document,
    // not writing a second one alongside the old key -- exactly the bug
    // sanitizeProductInput's own history already warns about, see
    // editProduct() in admin-src for the client-side half of this fix.
    const renames = [];
    for (let i = 0; i < list.length; i++) {
      const why = {};
      const clean = sanitizeProductInput(list[i], i, why);
      if (!clean) {
        const who = list[i]?.name || list[i]?.key || 'unnamed';
        const what = why.field ? `"${why.field}" ${why.why}` : 'has a field the server cannot read';
        return res.status(400).json({ status: 'error', message: `${who}: ${what}. Nothing was saved.`, field: why.field || '' });
      }
      const oldKey = String(list[i]?.oldKey || '').trim();
      if (oldKey && oldKey !== clean.key) {
        if (!/^[a-zA-Z0-9_-]+$/.test(oldKey))
          return res.status(400).json({ status: 'error', message: `"${oldKey}" is not a real existing key.` });
        if (region.key !== DEFAULT_REGION_KEY)
          return res.status(400).json({ status: 'error', message: 'An asset can only be renamed from its founding country.' });
        renames.push({ oldKey, newKey: clean.key });
      }
      sanitized.push(clean);
    }
    // Refuse a rename onto a key that already belongs to a DIFFERENT asset --
    // silently overwriting it is exactly the "two products, one name"
    // failure mode this whole mechanism exists to prevent, just backwards.
    for (const { oldKey, newKey } of renames) {
      const collision = await db.collection('products').doc(newKey).get();
      if (collision.exists) return res.status(400).json({ status: 'error', message: `"${newKey}" is already another asset's key. Choose a different one.` });
      const old = await db.collection('products').doc(oldKey).get();
      if (!old.exists) return res.status(400).json({ status: 'error', message: `"${oldKey}" is not a real existing key.` });
    }
    const batch = db.batch();
    if (region.key === DEFAULT_REGION_KEY) {
      // The founding region writes the document's own fields, exactly as
      // this route always did. `regions` is untouched because merge:true
      // leaves fields the payload does not mention -- so repricing Uganda
      // never disturbs another country's prices. A renamed asset is the one
      // exception: the whole document moves to its new key, so it is a
      // fresh `set` (not merge) on the new id, plus a delete of the old --
      // merging here would leave the old doc's `regions.*` behind, or worse,
      // silently blend it into the new key's history.
      sanitized.forEach(p => {
        const rename = renames.find(r => r.newKey === p.key);
        if (rename) {
          batch.delete(db.collection('products').doc(rename.oldKey));
          batch.set(db.collection('products').doc(p.key), p);
        } else {
          batch.set(db.collection('products').doc(p.key), p, { merge: true });
        }
      });
    } else {
      // Another region writes ONLY into its own corner of the document, and
      // only the fields it is allowed its own value for: name, image and
      // order stay shared, so a region cannot quietly rename a product for
      // everyone else.
      sanitized.forEach(p => {
        const over = {};
        for (const f of PRODUCT_REGION_FIELDS) if (p[f] !== undefined && p[f] !== null && p[f] !== '') over[f] = p[f];
        // A DOTTED path, deliberately: `{ regions: { ke: ... } }` under this
        // Mongo compatibility layer becomes `$set: { regions: {...} }`,
        // which replaces the whole map and would wipe every OTHER region's
        // prices on each save. `regions.ke` touches only this region.
        // Replacing this region's own object (rather than merging into it)
        // is what lets a field blanked in the editor go back to inheriting
        // Uganda's value instead of keeping the figure it had.
        batch.set(db.collection('products').doc(p.key), { key: p.key, ['regions.' + region.key]: over }, { merge: true });
      });
    }
    await batch.commit();
    _productsCacheTs = 0;
    logAdminAction(req, 'products_saved', { region: region.key, count: sanitized.length });
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
// One-time cleanup for a real, now-fixed bug: the admin panel's key field
// used to run its "make a slug" regex on an EXISTING product key too, which
// strips hyphens -- so saving anything on "product-1" silently created a
// SECOND doc at "product1" instead of updating the first. The untouched
// "product-1" default kept existing side by side with it, both named
// "Product-1" -- which is exactly what the owner saw as "editing product 1
// makes what looks like product 2 turn into product 1 again": whichever of
// the two happened to sort into the next slot was the corrupted duplicate.
//
// This finds every DEFAULT_PRODUCTS key with a hyphen (product-1 .. -12) and
// checks whether its hyphen-stripped form (product1 .. ) also exists as a
// saved doc -- that dehyphenated doc can ONLY have been created by this bug,
// since nothing else in the app ever derives a key that way.
//
//   - If the correctly-hyphenated key was never individually saved (still
//     the untouched default), the fix is unambiguous: move the corrupted
//     doc's fields onto the correct key and delete the corrupted one.
//   - If BOTH the correct key and the corrupted one were separately edited
//     (e.g. an image saved under each before the owner noticed), picking a
//     winner automatically could silently discard real data either way --
//     those are reported back as conflicts for the owner to resolve by hand
//     in the product list (compare the two, keep the one with the right
//     image, delete the other) rather than merged blindly.
// One-time repair for accounts issued while ids were six digits. Owner: "so
// far now the current account is 000001, so remove first 0 so it will be
// 00001." Changing PUBLIC_ID_DIGITS only governs ids handed out from now on;
// what is already stored has to be rewritten, and only an explicit admin
// action should rewrite an identifier a member may have already been given.
//
// ONLY ids that are pure padding are touched: a six-character id whose value
// still fits in five (000001 -> 00001). An id that genuinely needs its length
// (100000 and up) is left exactly as it is -- shortening that would change
// which account it names.
//
// A target that some other account already holds is skipped and reported
// rather than written: two members sharing an id is far worse than one
// member keeping a longer one, and this cannot be undone by re-running.
app.post('/admin/users/shorten-public-ids', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const snap = await db.collection('users').limit(100000).get();
    const taken = new Set();
    const rows = [];
    snap.forEach(d => {
      const id = String((d.data() || {}).publicId || '');
      if (id) taken.add(id);
      rows.push({ ref: d.ref, id });
    });
    const changed = [], conflicts = [];
    for (const r of rows) {
      if (!/^0\d+$/.test(r.id) || r.id.length <= PUBLIC_ID_DIGITS) continue;
      const short = String(Number(r.id)).padStart(PUBLIC_ID_DIGITS, '0');
      if (short.length >= r.id.length) continue;          // nothing to strip
      if (taken.has(short)) { conflicts.push({ from: r.id, to: short }); continue; }
      await r.ref.set({ publicId: short }, { merge: true });
      taken.delete(r.id); taken.add(short);
      changed.push({ from: r.id, to: short });
    }
    res.json({ status: 'success', changed, conflicts });
  } catch (e) {
    console.error('shorten-public-ids', e);
    res.status(500).json({ status: 'error', message: 'Could not shorten account ids' });
  }
});
app.post('/admin/products/fix-legacy-keys', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const snap = await db.collection('products').limit(100000).get();
    const byKey = new Map();
    snap.forEach(d => { if (!d.data().deleted) byKey.set(d.id, d.data()); });
    const batch = db.batch();
    const fixed = [], conflicts = [];
    for (const def of DEFAULT_PRODUCTS) {
      const properKey = def.key;
      const strippedKey = properKey.replace(/[^a-zA-Z0-9]+/g, '');
      if (strippedKey === properKey) continue;   // no hyphen to have been stripped
      const corrupted = byKey.get(strippedKey);
      if (!corrupted) continue;                  // this one was never hit by the bug
      const proper = byKey.get(properKey);
      if (proper) { conflicts.push({ properKey, strippedKey }); continue; }
      const { key: _oldKey, ...rest } = corrupted;
      batch.set(db.collection('products').doc(properKey), { ...rest, key: properKey }, { merge: false });
      batch.delete(db.collection('products').doc(strippedKey));
      fixed.push({ properKey, strippedKey });
    }
    if (fixed.length) await batch.commit();
    _productsCacheTs = 0;
    logAdminAction(req, 'products_legacy_keys_fixed', { fixed: fixed.length, conflicts: conflicts.length });
    res.json({ status: 'success', fixed, conflicts });
  } catch (e) { res.status(500).json({ status: 'error', message: 'Could not check for duplicate keys' }); }
});

// ═══════════════════════════════════════════
// ADMIN — MESSAGES
// ═══════════════════════════════════════════
app.get('/admin/messages/list', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const want = adminRegionFilter(req);
    // The built-in welcome row is PREVIEWED in the picked country's own
    // wording, not the panel hostname's: it reads settings, and settings are
    // per-country. Without the second argument an admin looking at Kenya
    // would be shown the Ugandan copy of a message Kenyan members never get.
    const messages = await listBroadcastMessages(want, want || undefined);
    res.json({ status: 'success', messages, regionKey: want || 'all' });
  }
  catch (e) { res.status(500).json({ status: 'error', message: 'Could not load messages' }); }
});
app.post('/admin/messages/save', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const title = stripHtml(req.body.title).slice(0, 200);
  const body = stripHtml(req.body.body).slice(0, 4000);
  if (!title) return res.status(400).json({ status: 'error', message: 'A title is required' });
  if (!body) return res.status(400).json({ status: 'error', message: 'A message body is required' });
  // An explicit id edits that message in place; no id writes a new one.
  const explicitId = String(req.body.id || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120);
  const id = explicitId || 'msg_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  try {
    const stamp = nowStr();
    // Written with the country that was picked when Save was tapped.
    // Explicitly -- an absent field means "every country" for legacy rows,
    // so leaving it off would make a country-specific message impossible to
    // tell from one written before this existed.
    //
    // With ALL COUNTRIES picked the panel is showing messages from several
    // countries at once, and an edit made from that view must NOT re-stamp
    // the one being edited: fixing a typo in a Kenyan message would
    // otherwise silently broadcast it to the whole platform. So 'all' means
    // "every country" for a NEW message and "leave it as it is" for an edit.
    const want = adminRegionFilter(req);
    let regionKey = want;
    if (!regionKey) {
      let prev = null;
      if (explicitId) {
        try { prev = await db.collection('messages').doc(id).get(); } catch (_) { prev = null; }
      }
      regionKey = (prev && prev.exists && String(prev.data().regionKey || '').trim().toLowerCase()) || 'all';
    }
    await db.collection('messages').doc(id).set({
      title, body, regionKey, date: stamp.date, time: stamp.time, createdAt: Date.now(), deleted: false,
    }, { merge: true });
    logAdminAction(req, 'message_saved', { id, title, regionKey });
    res.json({ status: 'success', id });
  } catch (e) { res.status(500).json({ status: 'error', message: 'Could not save this message' }); }
});
app.post('/admin/messages/delete', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const id = String(req.body.id || '');
  if (!id) return res.status(400).json({ status: 'error', message: 'id required' });
  try {
    // Tombstoned rather than removed so the built-in 'welcome' message can
    // also be hidden by an admin who does not want it (listBroadcastMessages
    // only re-adds the virtual welcome row when no doc with that id exists,
    // and a tombstone IS such a doc).
    await db.collection('messages').doc(id).set({ deleted: true }, { merge: true });
    logAdminAction(req, 'message_deleted', { id });
    res.json({ status: 'success' });
  } catch (e) { res.status(500).json({ status: 'error', message: 'Could not delete this message' }); }
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
    // ── A GIFT CODE IS MONEY, SO IT BELONGS TO ONE COUNTRY ──
    // The reward is a bare number; what it is WORTH is decided by the
    // currency of whoever claims it. A code cut for 5,000 UGX claimed by a
    // Kenyan pays 5,000 KES, about twenty times as much. So a code is
    // stamped with the country that was picked when it was generated, and
    // /redeem refuses it elsewhere.
    //
    // Generating with "All countries" picked deliberately still works and
    // stores 'all' -- a code meant for everybody is a real thing to want,
    // and the panel says which one it just made.
    const regionKey = adminRegionFilter(req) || 'all';
    const doc = {
      code, codeLower: code.toLowerCase(), minReward, maxReward, maxUses: maxUses || null, usedBy: [], active: true,
      regionKey,
      createdBy: req.adminUser?.username || 'owner', createdAt: FieldValue.serverTimestamp(),
    };
    if (durationSeconds) doc.expiresAt = new Date(Date.now() + durationSeconds * 1000);
    await db.collection('promoCodes').add(doc);
    logAdminAction(req, 'giftcode_generated', { code, minReward, maxReward, maxUses, durationSeconds, regionKey });
    res.json({ status: 'success', code, minReward, maxReward, regionKey });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
app.get('/admin/promocodes/list', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const want = adminRegionFilter(req);
    const snap = await db.collection('promoCodes').orderBy('createdAt', 'desc').limit(300).get();
    // Same rule as messages: no regionKey, or 'all', shows in every country's
    // view. A legacy code carries no field and really is claimable anywhere
    // (see /redeem), so hiding it from the country being looked at would be
    // a list that disagrees with what the code does.
    res.json({ status: 'success', regionKey: want || 'all', codes: snap.docs.filter(d => giftCodeInRegion(d.data(), want)).map(d => {
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
        maxUses: c.maxUses || null, uses, totalClaimed, regionKey: giftCodeRegion(c),
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

// ── ONE COUNTRY AT A TIME, ON EVERY ADMIN SCREEN ──
// Owner: "make sure dashboards can be categorized so one toggle to see a
// country settings ie dashboard, analytics, referrals, transactions,
// settings, admins, deposits, withdrawals etc."
//
// Which country the panel is asking about. 'all' (or nothing at all, which
// is what an older panel build sends) means every country, so a tab that
// has not been taught about the toggle keeps showing what it always did
// rather than silently narrowing to one country.
function adminRegionFilter(req) {
  const raw = String((req.query && req.query.region) || (req.body && req.body.region) || '').trim().toLowerCase();
  if (!raw || raw === 'all') return null;
  const r = regionByKey(raw);
  return r.key === raw ? raw : null;
}
// uid -> region key. Filtering is done through the MEMBER's region, not only
// the row's own `regionKey`: rows written before regions existed have no
// such field, and a member's region is fixed for life, so their account is
// the reliable answer. The row's own value still wins where it has one --
// that is the region the money actually moved in.
async function adminUserRegions() {
  const snap = await db.collection('users').get();
  const m = new Map();
  snap.forEach(d => m.set(d.id, String(d.data().regionKey || '').trim().toLowerCase() || DEFAULT_REGION_KEY));
  return m;
}
function rowRegionKey(row, userRegions) {
  const own = String((row && row.regionKey) || '').trim().toLowerCase();
  if (own) return own;
  const viaUser = (userRegions && row && row.userId) ? userRegions.get(row.userId) : null;
  return viaUser || DEFAULT_REGION_KEY;
}
// Stamps every row with the country it belongs to and drops the ones that
// are not the country being asked about. The stamp goes on even when no
// filter is in force, so an "All countries" view can label each figure with
// its own currency instead of showing one country's label over all of them.
function scopeRowsToRegion(rows, want, userRegions) {
  const out = [];
  for (const row of rows) {
    const key = rowRegionKey(row, userRegions);
    if (want && key !== want) continue;
    row.regionKey = key;
    out.push(row);
  }
  return out;
}
app.get('/admin/users', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const want = adminRegionFilter(req);
    const snap = await db.collection('users').limit(10000).get();
    let users = snap.docs.map(d => { const { transactionPinHash, ...safe } = d.data(); return { id: d.id, ...safe }; });
    users = users.map(u => {
      u.regionKey = String(u.regionKey || '').trim().toLowerCase() || DEFAULT_REGION_KEY;
      return u;
    }).filter(u => !want || u.regionKey === want);
    res.json({ status: 'success', users, count: users.length, regionKey: want || 'all' });
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
  if (!/^\d{6}$/.test(newPin)) return res.status(400).json({ status: 'error', message: 'New trade password must be 6 digits.' });
  if (isWeakPin(newPin)) return res.status(400).json({ status: 'error', message: 'That PIN is too easy to guess. Choose 6 digits that are not all the same.' });
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
// A pending deposit records an intent, not money credited to the wallet.
// Pending withdrawals, in contrast, have already debited their gross amount.
function walletLedgerAmount(t) {
  if (t.type === 'deposit' && t.status !== 'success') return 0;
  return finiteMoney(t.amount);
}
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
      txSnap.forEach(d => { real += walletLedgerAmount(d.data()); });
      const diff = Math.round(real) - Math.round(stored);
      if (diff === 0) return { ok: true, message: 'Already correct -- nothing to repair.', diff: 0 };
      if (diff < 0) {
        return { ok: false, message: `The real ledger total (${fmtMoney(Math.round(real))}) is LOWER than the stored wallet balance (${fmtMoney(stored)}). This direction is never auto-repaired -- diagnose by hand (a duplicate/erroneous credit somewhere is more likely than a missing debit).` };
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
      return { ok: true, message: `Wallet topped up by ${fmtMoney(diff)} to match the real ledger total. Run "Recalculate totals" too if totalDeposited/Earned/Invested were also flagged.`, diff };
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
    const preDoc = await findUserByReferralCode(code);
    if (!preDoc) return res.status(400).json({ status: 'error', message: 'That referral code does not exist.' });
    const candidateReferrerId = preDoc.id;
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
    return res.status(400).json({ status: 'error', message: `userId and a valid amount (1 - ${fmtMoney(MAX_MONEY_AMOUNT)}) required` });
  const lastCredit = _adminCreditDebounce.get(userId) || 0;
  if (Date.now() - lastCredit < 10000) return res.status(429).json({ status: 'error', message: 'This user was just credited seconds ago. Wait a moment before crediting again.' });
  _adminCreditDebounce.set(userId, Date.now());
  try {
    const { date, time } = nowStr();
    // The default description names the app, so it has to be read rather than
    // written in. Only the row created from HERE follows a later rename --
    // rows already in the ledger keep the wording they were written with,
    // which is the honest behaviour for a historical record.
    const creditDesc = note || (brandName(await getSettings()) + ' credit');
    // Locked on bal:<userId> -- this was the one money-crediting path in the
    // whole codebase with no lock at all, meaning a concurrent repair-ledger/
    // recountAllTotals absolute-value rewrite (both bal:-locked) could race
    // this increment and silently drop it. Matches /admin/debit's own locking.
    await withLock('bal:' + userId, () => db.runTransaction(async t => {
      const uRef = db.collection('users').doc(userId);
      const uSnap = await t.get(uRef);
      if (!uSnap.exists) throw new Error('User not found');
      t.update(uRef, { walletBalance: FieldValue.increment(amt), totalDeposited: FieldValue.increment(amt) });
      t.set(db.collection('transactions').doc(), { userId, type: 'admin_credit', description: creditDesc, amount: amt, status: 'success', date, time, createdAt: FieldValue.serverTimestamp() });
    }));
    logAdminAction(req, 'manual_credit', { userId, amount: amt, note });
    res.json({ status: 'success', message: `Credited ${fmtMoney(amt)}` });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/debit', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const { userId, amount, note } = req.body;
  const amt = Math.round(Math.abs(parseFloat(amount || 0)));
  if (!userId || !Number.isFinite(amt) || amt <= 0 || amt > MAX_MONEY_AMOUNT)
    return res.status(400).json({ status: 'error', message: `userId and a valid amount (1 - ${fmtMoney(MAX_MONEY_AMOUNT)}) required` });
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
      if (amt > bal) throw new Error(`Cannot debit ${fmtMoney(amt)}, this wallet only holds ${fmtMoney(bal)}`);
      newBal = bal - amt;
      t.update(uRef, { walletBalance: FieldValue.increment(-amt) });
      t.set(db.collection('transactions').doc(), { userId, type: 'admin_debit', description: note || 'Balance adjustment', amount: -amt, status: 'success', date, time, createdAt: FieldValue.serverTimestamp() });
    }));
    logAdminAction(req, 'manual_debit', { userId, amount: amt, note });
    res.json({ status: 'success', message: `Removed ${fmtMoney(amt)}. New balance ${fmtMoney(newBal)}`, newBalance: newBal });
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
    // One country at a time. Filtered BEFORE the counts and the day
    // groupings are built, or the totals on screen would describe every
    // country while the rows beneath them describe one.
    const want = adminRegionFilter(req);
    const userRegions = new Map();
    usersSnap.forEach(u => userRegions.set(u.id, String(u.data().regionKey || '').trim().toLowerCase() || DEFAULT_REGION_KEY));
    const scoped = scopeRowsToRegion(rows, want, userRegions);
    rows.length = 0; rows.push(...scoped);
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
    res.json({ status: 'success', deposits: rows, counts, total: rows.length, processedByDay, processedAmount, truncated, regionKey: want || 'all' });
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
    res.json({ status: 'success', message: `Force-credited ${fmtMoney(snap.data().amount)} to the user` });
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
    // Same reasoning as the deposits list: scope first, then count.
    const want = adminRegionFilter(req);
    const userRegions = new Map();
    usersSnap.forEach(u => userRegions.set(u.id, String(u.data().regionKey || '').trim().toLowerCase() || DEFAULT_REGION_KEY));
    const scoped = scopeRowsToRegion(rows, want, userRegions);
    rows.length = 0; rows.push(...scoped);
    rows.forEach(w => { w.accountPhone = phones[w.userId] || ''; w.referralCode = refCodes[w.userId] || ''; counts[w.status] = (counts[w.status] || 0) + 1; });
    const { processedByDay, processedAmount } = groupProcessedByDay(rows.filter(w => w.status === 'processed'), 'processedAt', 'net');
    // The tab needs to know which real payout path is active -- it changes
    // what the approve button does/says and what it must warn the admin
    // about. Sent with the list so the tab doesn't need a second round trip
    // just to label a button. 'marzpay' | 'pesajet' | 'manual'.
    // Subagent-audit-caught: same missing-truncated-flag gap as the deposits
    // list above, fixed the same way.
    const truncated = snap.docs.length >= 5000 || unresolvedSnap.docs.length >= 5000;
    res.json({ status: 'success', withdrawals: rows, counts, total: rows.length, processedByDay, processedAmount, payoutMode: withdrawProvider(sett), truncated, regionKey: want || 'all' });
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
    // These feed exact financial TOTALS, not a rendered page, so a silent cap
    // turns a total into "first N rows" once the platform grows -- the audit
    // finding that removed the caps entirely was right about that.
    //
    // But unbounded is the wrong other end. Atlas M0 is a shared tier with
    // little RAM, this endpoint pulls FOUR whole collections into Node
    // memory, and the dashboard re-polls it every 30 seconds
    // (LIVE_TABS/liveTick in the panel) -- so "no limit" trades a wrong
    // number for the owner's only admin view timing out, on the one screen
    // he looks at to find out whether anything is wrong.
    //
    // So: a ceiling high enough not to be reached in normal operation, and
    // an explicit `truncated` flag when it IS reached. The number on screen
    // is then either complete or visibly flagged, never quietly wrong --
    // which is the same bargain /admin/transactions/list and
    // /admin/referrals/list already strike in this file.
    const STATS_SCAN_LIMIT = 200000;
    const [usersSnap, depSnap, witSnap, invSnap] = await Promise.all([
      db.collection('users').limit(STATS_SCAN_LIMIT).get(),
      db.collection('pendingDeposits').where('status', '==', 'matched').limit(STATS_SCAN_LIMIT).get(),
      db.collection('withdrawals').where('status', '==', 'processed').limit(STATS_SCAN_LIMIT).get(),
      db.collection('investments').limit(STATS_SCAN_LIMIT).get(),
    ]);
    // One country at a time. Every figure on this screen is money in a
    // currency, so mixing countries into a single total produces a number
    // that means nothing -- adding shillings to shillings of a different
    // kind. With a country picked, each total is that country's alone.
    const want = adminRegionFilter(req);
    const userRegions = new Map();
    usersSnap.forEach(d => userRegions.set(d.id, String(d.data().regionKey || '').trim().toLowerCase() || DEFAULT_REGION_KEY));
    const mine = row => !want || rowRegionKey(row, userRegions) === want;
    const moneyByRegion = new Map();
    const bucket = key => {
      const regionKey = String(key || DEFAULT_REGION_KEY).trim().toLowerCase() || DEFAULT_REGION_KEY;
      if (!moneyByRegion.has(regionKey)) {
        const r = regionByKey(regionKey);
        moneyByRegion.set(regionKey, {
          regionKey, name: r.name || regionKey, currency: r.currency || '',
          walletTotal: 0, depositAmount: 0, withdrawAmount: 0, investedAmount: 0,
        });
      }
      return moneyByRegion.get(regionKey);
    };
    let totalUsers = 0, activeUsers = 0, bannedUsers = 0, walletTotal = 0;
    usersSnap.forEach(d => {
      const u = d.data();
      const key = String(u.regionKey || '').trim().toLowerCase() || DEFAULT_REGION_KEY;
      if (want && key !== want) return;
      totalUsers++;
      if (u.status === 'banned') bannedUsers++; else activeUsers++;
      const amount = finiteMoney(u.walletBalance);
      walletTotal += amount;
      bucket(key).walletTotal += amount;
    });
    let depositAmount = 0; depSnap.forEach(d => {
      const r = { ...d.data() }; if (!mine(r)) return;
      const amount = finiteMoney(r.amount), key = rowRegionKey(r, userRegions);
      depositAmount += amount; bucket(key).depositAmount += amount;
    });
    let withdrawAmount = 0; witSnap.forEach(d => {
      const r = { ...d.data() }; if (!mine(r)) return;
      const amount = finiteMoney(r.net), key = rowRegionKey(r, userRegions);
      withdrawAmount += amount; bucket(key).withdrawAmount += amount;
    });
    let investedAmount = 0, activeInvestments = 0;
    invSnap.forEach(d => {
      const inv = { ...d.data() }; if (!mine(inv)) return;
      const amount = finiteMoney(inv.amount), key = rowRegionKey(inv, userRegions);
      investedAmount += amount; bucket(key).investedAmount += amount;
      if (inv.status === 'active') activeInvestments++;
    });
    const [pendDepSnap, pendWitSnap] = await Promise.all([
      db.collection('pendingDeposits').where('status', 'in', ['pending', 'initiating', 'review']).limit(STATS_SCAN_LIMIT).get(),
      db.collection('withdrawals').where('status', '==', 'pending').limit(STATS_SCAN_LIMIT).get(),
    ]);
    const pendingDepCount = pendDepSnap.docs.filter(d => mine({ ...d.data() })).length;
    const pendingWitCount = pendWitSnap.docs.filter(d => mine({ ...d.data() })).length;
    // In a one-country view the scalar fields stay backward-compatible. In
    // All countries they are null on purpose: UGX + KES is not money. The
    // grouped rows are the only meaningful financial totals in that mode.
    // Judged on the RAW reads, before the country filter: the ceiling was hit
    // or it was not, and calling one country's share of a capped scan
    // "complete" would be the very lie the cap is being flagged for.
    const truncated = [usersSnap, depSnap, witSnap, invSnap, pendDepSnap, pendWitSnap]
      .some(snap => snap.docs.length >= STATS_SCAN_LIMIT);
    res.json({
      status: 'success', regionKey: want || 'all', truncated,
      moneyByRegion: Array.from(moneyByRegion.values()).sort((a, b) => a.regionKey.localeCompare(b.regionKey)),
      stats: {
        totalUsers, activeUsers, bannedUsers,
        walletTotal: want ? walletTotal : null,
        depositAmount: want ? depositAmount : null,
        withdrawAmount: want ? withdrawAmount : null,
        investedAmount: want ? investedAmount : null,
        activeInvestments, pendingDepCount, pendingWitCount
      }
    });
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
    // The COUNTRY SWITCH's region, not the admin's own. Balances are per
    // country wallet now, and currentRegion() here resolves from the host the
    // panel happens to be open on -- which would put one country's float under
    // another country's heading on the very screen used to decide whether
    // there is enough money to pay withdrawals.
    // adminRegionFilter() answers null for "All countries", which is not a
    // question a single wallet balance can answer -- so it falls back to the
    // founding region, exactly as the panel's own adminOneRegion() does, and
    // the reply names the region it actually read so the card cannot be
    // labelled with a country it did not come from.
    const region = regionByKey(adminRegionFilter(req) || DEFAULT_REGION_KEY);
    if (!marzMarket(region)) {
      return res.status(400).json({ status: 'error', code: 'GATEWAY_REGION', message:
        `MarzPay does not serve ${region.name || region.key} (+${region.dialCode}), so it holds no wallet for it.` });
    }
    const d = await marzGetBalance(region);
    if (d.status !== 'success') return res.status(502).json({ status: 'error', message: marzUserMsg(d, 'Could not reach MarzPay') });
    res.json({ status: 'success', regionKey: region.key, amount: d.amount, formatted: d.formatted, currency: d.currency, accountStatus: d.accountStatus });
  } catch (e) {
    console.error('MarzPay balance check failed:', e.message);
    res.status(502).json({ status: 'error', message: PROVIDER_BUSY_MSG });
  }
});
// ── WHAT HAS GONE THROUGH PESAJET ──
// Owner: "l also want to see the balance of jetpay just like we were doing on
// marz."
//
// PESAJET PUBLISHES NO BALANCE ENDPOINT. Both of their official SDKs --
// @pesajet/sdk on npm and pesajet on PyPI -- expose exactly three calls:
// create a payment, read a payment, preview a fee. There is no float, wallet
// or balance call in either, and their REST docs show none. MarzPay's own
// card exists because MarzPay's SDK really does call GET /balance; guessing a
// path here would be inventing API surface on a money provider, which this
// file does not do.
//
// So this answers the question a balance is actually asked for -- "how much
// has gone in and out through this gateway" -- from PETRO'S OWN RECORDS,
// which are exact for what we sent and received. It is NOT their float: it
// cannot see settlements to a bank account, their fees, or anything moved
// outside Petro, and the panel says so in those words rather than letting a
// number imply more than it knows.
//
// The moment PesaJet give us a balance path this becomes a real reading and
// the card keeps its place. That is open question 4 in docs/pesajet-api.md.
//
// A high ceiling rather than no ceiling, for the reason /admin/stats records:
// this pulls whole collections into Node memory on a shared Atlas tier, and
// the dashboard re-polls every 30 seconds. Past it the reply says so rather
// than quietly calling a partial total complete. Named at module scope so the
// test can shrink it and actually reach the truncated case.
const PESAJET_SUMMARY_SCAN = 200000;
app.get('/admin/pesajet/summary', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const want = adminRegionFilter(req);
    const [depSnap, witSnap, sett] = await Promise.all([
      db.collection('pendingDeposits').where('provider', '==', 'pesajet').limit(PESAJET_SUMMARY_SCAN).get(),
      db.collection('withdrawals').where('pesajetRef', '>', '').limit(PESAJET_SUMMARY_SCAN).get(),
      getSettings(),
    ]);
    // Judged on the RAW reads, BEFORE the country filter below: a page cut
    // short is still cut short whichever country is being shown, and calling
    // a partial list complete is the lie this flag exists to prevent. Same
    // bargain /admin/stats and /admin/transactions/list already strike.
    const truncated = depSnap.size >= PESAJET_SUMMARY_SCAN || witSnap.size >= PESAJET_SUMMARY_SCAN;
    // adminUserRegions() is the file's own uid -> region map, used because a
    // row written before regions existed carries no regionKey of its own and
    // its member's country is the reliable answer.
    const userRegions = await adminUserRegions();
    const zero = () => ({ collected: 0, collectedCount: 0, paidOut: 0, paidOutCount: 0,
                          pendingIn: 0, pendingInCount: 0, pendingOut: 0, pendingOutCount: 0 });
    const byRegion = new Map();
    const slot = key => {
      if (!byRegion.has(key)) byRegion.set(key, Object.assign({ regionKey: key,
        currency: (regionByKey(key) || {}).currency || 'UGX' }, zero()));
      return byRegion.get(key);
    };
    for (const d of depSnap.docs) {
      const row = d.data(), key = rowRegionKey(row, userRegions);
      if (want && key !== want) continue;
      const amt = finiteMoney(row.displayAmount != null ? row.displayAmount : row.amount);
      const b = slot(key);
      // depositFullyCredited() is the same test the rest of this file uses for
      // "this deposit really landed" -- status alone is not enough, because
      // claim-before-credit can leave 'matched' with the wallet write unfinished.
      if (depositFullyCredited(row)) { b.collected += amt; b.collectedCount++; }
      else if (row.status === 'pending' || row.status === 'initiating') { b.pendingIn += amt; b.pendingInCount++; }
    }
    for (const w of witSnap.docs) {
      const row = w.data(), key = rowRegionKey(row, userRegions);
      if (want && key !== want) continue;
      const amt = finiteMoney(row.net != null ? row.net : row.amount);
      const b = slot(key);
      if (row.status === 'processed') { b.paidOut += amt; b.paidOutCount++; }
      else if (row.status === 'processing' || row.status === 'sending') { b.pendingOut += amt; b.pendingOutCount++; }
    }
    const regions = [...byRegion.values()].map(b => Object.assign(b, { net: round2(b.collected - b.paidOut) }));
    regions.sort((a, b2) => a.regionKey.localeCompare(b2.regionKey));
    res.json({
      status: 'success', regionKey: want || 'all', truncated, regions,
      configured: pesajetConfigured(),
      // Whether this gateway is actually in the path right now, so the panel
      // can keep the card out of the way of an operator who does not use it.
      selected: depositProvider(sett) === 'pesajet' || withdrawProvider(sett) === 'pesajet',
      // Said here rather than only in the panel, so an operator reading the
      // raw response is not misled either.
      note: 'Petro\'s own record of money moved through PesaJet. PesaJet publishes no balance endpoint, so this is not the float in their account.',
    });
  } catch (e) {
    console.error('PesaJet summary error:', e.message);
    res.status(500).json({ status: 'error', message: 'Could not read the PesaJet summary' });
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
    const raw = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    // `truncated` is judged on the RAW page, before the country filter: the
    // cap was hit or it was not, and saying "complete" because one country's
    // share of a truncated page happens to be small would be a lie.
    const truncated = raw.length >= TX_ADMIN_LIST_LIMIT;
    const want = adminRegionFilter(req);
    const transactions = scopeRowsToRegion(raw, want, want ? await adminUserRegions() : null);
    res.json({ status: 'success', transactions, truncated, regionKey: want || 'all' });
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
    const want = adminRegionFilter(req);
    const all = snap.docs.map(d => {
      const u = d.data();
      return {
        id: d.id, phone: u.phone || '', referrerId: u.referredBy,
        referrerCode: codeById[u.referredBy] || '', invested: finiteMoney(u.totalInvested), status: u.status || 'active',
        regionKey: String(u.regionKey || '').trim().toLowerCase() || DEFAULT_REGION_KEY,
      };
    });
    // Judged on the raw page, same reasoning as the transactions list.
    const truncated = all.length >= REFERRALS_LIST_LIMIT;
    const rows = want ? all.filter(r => r.regionKey === want) : all;
    res.json({ status: 'success', referrals: rows, truncated, regionKey: want || 'all' });
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
    const [pendingDep, pendingWit] = await Promise.all([
      db.collection('pendingDeposits').where('status', 'in', ['pending', 'initiating', 'review']).limit(5000).get(),
      db.collection('withdrawals').where('status', '==', 'pending').limit(5000).get(),
    ]);
    res.json({ status: 'success', pendingDeposits: pendingDep.size, pendingWithdrawals: pendingWit.size });
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
    // One country at a time -- every amount below is money in a currency,
    // so a mixed total is meaningless. Built once here and applied at each
    // forEach rather than pre-filtering four snapshots.
    const want = adminRegionFilter(req);
    const userRegions = new Map();
    usersSnap.forEach(d => userRegions.set(d.id, String(d.data().regionKey || '').trim().toLowerCase() || DEFAULT_REGION_KEY));
    const mine = row => !want || rowRegionKey(row, userRegions) === want;
    const byHour = Array.from({ length: 24 }, (_, h) => ({ h, depAmt: 0, depCnt: 0, witAmt: 0, witCnt: 0 }));
    const bands = { morning: { dep: 0, wit: 0 }, afternoon: { dep: 0, wit: 0 }, evening: { dep: 0, wit: 0 }, night: { dep: 0, wit: 0 } };
    const dayMap = {};
    const ensureDay = k => (dayMap[k] = dayMap[k] || { day: k, dep: 0, wit: 0, users: 0 });

    let depAmount = 0, depCount = 0;
    depSnap.forEach(d => {
      const dep = d.data();
      if (dep.status !== 'matched') return;
      if (!mine(dep)) return;
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
      if (!mine(w)) return;
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
      const u = d.data();
      if (want && (String(u.regionKey || '').trim().toLowerCase() || DEFAULT_REGION_KEY) !== want) return;
      totalUsers++;
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
      rewardTxSnap.forEach(d => { const t = d.data(); if (mine(t)) teamRewardsPaid += finiteMoney(t.amount); });
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
      if (!mine(inv)) return;
      const paidOut = finiteMoney(inv.paidOut), dailyPayout = finiteMoney(inv.dailyPayout), expected = finiteMoney(inv.expectedReturn);
      if (expected > 0 && paidOut + dailyPayout >= expected) { maturingCount++; maturingPayout += Math.max(0, expected - paidOut); }
    });
    const REINVEST_RATE_PCT = 35;
    const CONVERSION_RATE_PCT = 20;
    const pipelineCutoff = Date.now() - 3 * 86400000;
    let pipelineUserCount = 0;
    usersSnap.forEach(d => {
      const u = d.data();
      if (want && (String(u.regionKey || '').trim().toLowerCase() || DEFAULT_REGION_KEY) !== want) return;
      if (tsMillis(u.createdAt) >= pipelineCutoff && (u.totalDeposited || 0) === 0) pipelineUserCount++;
    });
    // This country's own minimum recharge, not the founding country's --
    // the estimate is in this country's currency.
    const pipelineSett = want ? await getSettings(want) : sett;
    const pipelineEstimate = Math.round(pipelineUserCount * (pipelineSett.minDeposit || 0) * (CONVERSION_RATE_PCT / 100));
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
      status: 'success', period: days, regionKey: want || 'all',
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
      ledgerByUser[t.userId] = (ledgerByUser[t.userId] || 0) + walletLedgerAmount(t);
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
    // deposit_reversal carries a negative amount (a manual correction row)
    // and must be included here or a later "Recalculate totals" run would
    // silently wipe the correction back out.
    if (t.type === 'deposit' || t.type === 'admin_credit' || t.type === 'deposit_reversal') deposited += walletLedgerAmount(t);
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
    // deposit_reversal carries a negative amount (a manual correction row)
    // and must be included here for the same reason as computeUserRealTotals().
    if (t.type === 'deposit' || t.type === 'admin_credit' || t.type === 'deposit_reversal') row.deposited += walletLedgerAmount(t);
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

app.get('/', (_req, res) => res.json({ status: 'ok', service: 'Petro backend' }));

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
    // PesaJet's own pending/initiating deposits. This sweep matters MORE for
    // this gateway than for the other two: PesaJet's webhook URL is
    // configured in their dashboard rather than sent per request, so until
    // the owner sets it there this loop and the member's own status poll are
    // the ONLY things that resolve a deposit. Same posture regardless --
    // never trust anything but our own live re-check.
    //
    // Excluded by `pesajetTxId > ''` for the same starvation reason spelled
    // out for the two loops above: a row whose create call never returned a
    // transaction id can never be checked, and without the exclusion 50 of
    // those would reselect themselves every tick forever and starve genuinely
    // pending newer ones.
    const pjSnap = await db.collection('pendingDeposits').where('status', 'in', ['pending', 'initiating']).where('provider', '==', 'pesajet').where('pesajetTxId', '>', '').orderBy('createdAt', 'asc').limit(50).get();
    for (const doc of pjSnap.docs) {
      const dep = doc.data();
      const t = await pesajetGetTx(dep.pesajetTxId);
      if (t.providerDown) continue;
      const realStatus = pesajetStatusLabel(t.status);
      if (realStatus === 'success') { await creditDeposit(doc); settled++; }
      else if (realStatus === 'failed') await markDepositFailed(doc.ref, dep.userId, pesajetFailureMsg(t.status));
    }
    // ...and the rows the sweep above deliberately cannot touch: PesaJet
    // deposits with NO transaction id, because the create response was lost
    // while PesaJet may well have accepted it. Nothing could ever check these
    // and they sat pending forever -- the worst shape a money row can be in,
    // since the member's money may have left and no path here would credit
    // it. Their LIST endpoint is what makes them findable, by our own
    // reference.
    //
    // Ordered DESCENDING, unlike every other sweep here: a row is only
    // recoverable while it is still inside the window we can page, so the
    // recent ones are the ones worth spending calls on. Older ones age out
    // rather than starving the young ones, which is the same starvation the
    // `pesajetTxId > ''` exclusion above exists to avoid.
    const pjLostSnap = await db.collection('pendingDeposits').where('status', 'in', ['pending', 'initiating']).where('provider', '==', 'pesajet').orderBy('createdAt', 'desc').limit(60).get();
    let lookedUp = 0;
    for (const doc of pjLostSnap.docs) {
      if (lookedUp >= PESAJET_LOST_PER_TICK) break;
      const dep = doc.data();
      if (dep.pesajetTxId) continue;                       // the sweep above owns it
      const madeMs = tsMillis(dep.createdAt);
      if (!madeMs) continue;
      const age = Date.now() - madeMs;
      // Young rows belong to the member's own status poll; older than the
      // window is past what a lookup can see.
      if (age < PESAJET_LOST_MIN_AGE_MS || age > PESAJET_LOST_WINDOW_MS) continue;
      lookedUp++;
      const hit = await pesajetFindByReference(dep.ref || doc.id, { sinceMs: madeMs });
      if (hit.providerDown || hit.unreadable) continue;
      if (hit.found && hit.transactionId) {
        await doc.ref.update({ pesajetTxId: hit.transactionId }).catch(() => {});
        const realStatus = pesajetStatusLabel(hit.status);
        if (realStatus === 'success') { await creditDeposit(doc); settled++; }
        else if (realStatus === 'failed') await markDepositFailed(doc.ref, dep.userId, pesajetFailureMsg(hit.status));
        continue;
      }
      // Failed ONLY on a window scanned right to its end. PesaJet has no
      // record of this reference, so no prompt was ever raised and nothing
      // can have been taken. Anything less certain -- a short read, an
      // unreadable envelope, a gateway blip -- leaves the row pending, which
      // is the outcome that cannot cost anybody money.
      if (hit.complete) await markDepositFailed(doc.ref, dep.userId, DEPOSIT_FAILED_MSG);
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
    // PesaJet's own outstanding disbursements -- same starvation-avoiding
    // `.where(field,'>','')` shape and the same independent re-check the
    // webhook route uses. Deliberately scans 'processing' ONLY, not
    // 'sending': a 'sending' row is ambiguous (we never learned whether the
    // send landed) and resolving one as failed from an automated path would
    // refund a member on top of money that may already have gone out. That
    // stays a human decision in /admin/withdraw/reject, exactly as it is for
    // the other two gateways.
    const pjSnap = await db.collection('withdrawals').where('status', '==', 'processing').where('pesajetTxId', '>', '').orderBy('createdAt', 'asc').limit(50).get();
    for (const doc of pjSnap.docs) {
      const wit = doc.data();
      if (!wit.pesajetTxId) continue;
      const t = await pesajetGetTx(wit.pesajetTxId);
      if (t.providerDown) continue;
      const realStatus = pesajetStatusLabel(t.status);
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
// Runs once per region, because auto-approval is one of the settings each
// region owns: Uganda can be auto-paying while Kenya is still hand-checked,
// and each region's own interval and safety cap apply to its own members'
// cash-outs. A withdrawal with no regionKey (raised before regions existed)
// belongs to the founding region.
async function autoApproveWithdrawalsTick() {
  try {
    for (const region of await getRegions()) {
      await runInRegion(region, () => _autoApproveTickForRegion(region.key))
        .catch(e => console.error('Auto-approve tick error (' + region.key + '):', e.message));
    }
  } catch (e) { console.error('Auto-approve tick error:', e.message); }
}
async function _autoApproveTickForRegion(regionKey) {
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
    // Filter before limiting: manual-region and over-cap rows must not
    // occupy every slot forever. Mongo's $in:null includes missing legacy
    // regionKey fields, which belong to Uganda.
    let eligible = db.collection('withdrawals').where('status', '==', 'pending')
      .where('regionKey', 'in', regionKey === DEFAULT_REGION_KEY ? [regionKey, null, ''] : [regionKey])
      .where('createdAt', '<=', cutoff);
    const cap = Number(sett.autoApproveMaxAmount) || 0;
    if (cap > 0) eligible = eligible.where('amount', '<=', cap);
    const snap = await eligible.orderBy('createdAt', 'asc').limit(50).get();
    for (const doc of snap.docs) {
      const wit = doc.data();
      if (String(wit.regionKey || DEFAULT_REGION_KEY) !== regionKey) continue; // another region's rules apply
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
  } catch (e) { console.error('State sweep error:', e.message); }
}

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || '';
if (!MONGODB_URI) { console.error('MONGODB_URI env var is required'); process.exit(1); }
connectMongo(MONGODB_URI)
  .then(() => {
    app.listen(PORT, () => console.log(`Petro backend listening on :${PORT}`));
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
  })
  .catch(e => { console.error('Mongo connection failed:', e.message); process.exit(1); });
