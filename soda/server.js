const sessionPolicy = require('./session-policy');
const express     = require('express');
const admin       = require('firebase-admin');
const cors        = require('cors');
const crypto      = require('crypto');
const fs          = require('fs');
const path        = require('path');
const os          = require('os'); // used by /admin/system-health below
const helmet      = require('helmet');
const compression = require('compression');
const rateLimit   = require('express-rate-limit');
const { execFile } = require('child_process'); // used by the auto-deploy webhook, see /deploy/webhook below
const PDFDocument = require('pdfkit'); // used by GET /statement/pdf below
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

// This process is reached ONLY via api.SODA_DOMAIN now (see
// deploy/nginx-soda.conf.template -- app./qumx. each get their own nginx
// `root`, straight off disk, independent of this backend). Serving the
// member app's static files here too was a leftover from the bare-IP-only
// era, before that split existed, when this process had to double as the
// static host. Owner: "why also api visits website? is it normal" -- it
// isn't needed anymore, and having api. quietly mirror the whole app
// undercuts the point of hardening it (noindex/nofollow, hidden server
// version, etc. -- see CLAUDE.md's Follow-up 33) by making it look like
// just another copy of the site to a scanner or a curious visitor.

// ── RATE LIMITERS ──
// Money endpoints are keyed per signed-in member (a hash of the session
// token), not shared IP -- Ugandan carrier-NAT puts many real users behind
// one IP. The token is random, never decoded; an invalid one just gets its
// own bucket, and ipOnlyLimiter below caps what a fake-token flood can do.
function rlKeyByUser(req) {
  const auth = req.headers.authorization || '';
  // Pre-sign-in routes (OTP sms, reset, sign-up) stay keyed by IP: a caller
  // there could attach a made-up token to every request to dodge the cap.
  const open = /^\/(auth|register)\b/.test(req.originalUrl || '');
  if (!open && auth.startsWith('Bearer ') && auth.length > 7) {
    return 'u:' + crypto.createHash('sha256').update(auth.slice(7)).digest('hex').slice(0, 16);
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
// Owner: "let it poll every 1 second, we have a VPS KVM1 and MongoDB flex" --
// these are exactly the read-only routes user-src/original_module.js's
// live-refresh loop hits every tick (see liveRefreshVisible()). At 1s, one
// actively open Assets-page session alone can generate ~3 requests/second
// (180/min) from polling ALONE, before the member has tapped anything
// themselves -- that would have quietly eaten most of globalLimiter's
// 400/min-per-user budget, the SAME shared budget apiLimiter-protected money
// routes below also draw from, so a member's own background polling could
// have started rate-limiting their own withdraw/invest taps. And since
// Ugandan mobile carriers NAT many real members behind one IP (see
// ipOnlyLimiter's own comment above), a couple of concurrently-open sessions
// on the same carrier IP could approach ipOnlyLimiter's 900/min ceiling from
// polling alone too. Either would silently produce exactly the "stale data"
// complaint this loop exists to fix -- a 429 here just makes liveTick() back
// off quietly, not error loudly, so it would have looked like the app "isn't
// updating" all over again. Own, more generously-sized limiters instead of
// sharing the general-purpose ones, same "route-specific limiter sized for
// what that route actually does" precedent apiLimiter already established
// for the money-moving POSTs below -- 1200/min-per-user and 3600/min-per-IP
// give roughly 5x headroom over the 1s-poll worst case on top of normal
// use, not an unbounded exemption. /public/settings and /public/products are
// the two unauthenticated routes in this set, which is a real widened-abuse-
// surface question in isolation -- but both are already served from
// getSettings()/getProducts()'s own 60s in-process cache (see their own
// comments), so a flood here costs cheap memory reads, not repeated Mongo
// hits, regardless of how generous this ceiling is.
const LIVE_POLL_ROUTES = new Set(['/account', '/public/settings', '/investments', '/public/products', '/team/stats', '/transactions', '/messages']);
const livePollLimiter = rateLimit({ windowMs: 60 * 1000, max: 1200, keyGenerator: rlKeyByUser,
  standardHeaders: true, legacyHeaders: false,
  message: { status: 'error', message: 'Too many requests. Slow down.' } });
const livePollIpLimiter = rateLimit({ windowMs: 60 * 1000, max: 3600, standardHeaders: false, legacyHeaders: false,
  message: { status: 'error', message: 'Too many requests from this network. Slow down.' } });
app.use((req, res, next) => (req.path === '/health' ? healthLimiter(req, res, next) : LIVE_POLL_ROUTES.has(req.path) ? livePollIpLimiter(req, res, next) : ipOnlyLimiter(req, res, next)));
app.use((req, res, next) => (req.path === '/health' ? next() : LIVE_POLL_ROUTES.has(req.path) ? livePollLimiter(req, res, next) : globalLimiter(req, res, next)));

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
    try { req.adminUser = await resolveSession(header, req.path === '/session/activity'); }
    catch (e) { console.error('Admin session resolve error:', e.message); return _res.status(503).json({ status:'error', message:'Session service unavailable. Try again.' }); }
  }
  next();
});
// '/turntable/spin' belongs here because it
// pays real money on an unauthenticated-body POST, so it gets the strict
// 60/min per-user cap rather than only the 400/min global one.
['/withdraw/request', '/invest/create', '/deposit/marzpay', '/bank/save', '/bank/delete',
 '/account/create-profile', '/register', '/account/transaction-pin/change', '/redeem',
 '/turntable/spin', '/auth/otp/send', '/auth/otp/verify', '/auth/reset/confirm']
  .forEach(p => app.use(p, apiLimiter));
// Owner: "some people can deplete sms costs, so block too many requests of
// otp requests I think 10 requests, the ip should be said too many
// requests, not ip being banned." A real money risk, not just abuse --
// every successful send is a real MarzSms charge (~30 UGX). The existing
// otpDailyLimitReset/Bank caps (see DEFAULT_SETTINGS) are keyed
// per PHONE NUMBER, so they do nothing against one source spamming SMS
// requests across many DIFFERENT numbers -- apiLimiter's blanket 60/min
// above already covers this route too, but 60 real sends a minute left
// running is still a real bill. This is a tighter, SMS-cost-specific
// ceiling stacked on top of it, IP-keyed by default (no rlKeyByUser
// override) so it can't be evaded by claiming a fresh fake uid on an
// unauthenticated 'register'/'reset' send the way apiLimiter's own
// per-user keying could be. A plain temporary throttle, same "too many
// requests, slow down" message convention every other limiter in this
// file already uses -- never anything reading as a ban, which is exactly
// what express-rate-limit's own window-based 429 already is: it clears
// itself after windowMs, not a persistent block. Owner follow-up: window
// widened from 1 minute to 5 -- same 10-request cap, just spread over a
// longer stretch, so 10 sends can no longer be burned in the first minute
// and then sit fully open for the rest of a longer session.
const otpSendLimiter = rateLimit({ windowMs: 5 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false,
  message: { status: 'error', message: 'Too many requests. Please wait a moment and try again.' } });
app.use('/auth/otp/send', otpSendLimiter);

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
const IMAGE_BODY_ROUTES = new Set(['/admin/products/save', '/admin/banner/set', '/admin/help-banner/set', '/admin/announcement-image/set', '/admin/soda-image/set', '/admin/app-icon/set']);
const HUGE_JSON_ROUTES = new Set(['/admin/about-content/set', '/admin/rules-content/set']);
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

// Soda runs entirely on one Hostinger VPS -- backend (pm2, :3000) and both
// static frontends (nginx, app./admin. subdomains) on the same box. The
// browser still treats app./admin. as cross-origin from api. (different
// subdomains are different origins), so their exact origins must be listed
// here. Get this wrong and the failure is deeply misleading: the `cors`
// middleware answers an unlisted origin with NO CORS headers at all, the
// browser blocks the response, and the app reports its own generic "Network
// error. Check your connection." -- identical to a real connectivity
// problem, on a backend that is actually up and healthy. If a Soda screen
// ever reports a network error while the server is fine, check this list
// FIRST.
//
// Snow's own live domain (chn-snow2beer.com) was deliberately dropped from
// this copy -- it has no business reaching Soda's database.
const CORS_ALLOWED_ORIGINS = new Set([
  'https://soda-platform.com', 'https://www.soda-platform.com',
  // The real domain the owner actually bought (2026-09-29). app./qumx.
  // are the two frontend subdomains nginx-soda.conf.template serves;
  // api. itself never needs to be in this list (a same-origin API call
  // carries no Origin header requiring a CORS allowance). qumx. is the
  // admin panel's own subdomain -- deliberately a random 4-letter string,
  // not "admin", per the owner's own request once the domain went public
  // (see nginx-soda.conf.template's matching comment); if it's ever
  // regenerated, this entry, the template, and the live certbot cert all
  // have to agree.
  'https://mysoda.p-colasoda.com', 'https://mysoda.p-colasoda.com',
  // Direct VPS frontend used while Soda is served/tested on port 8080.
  // Different ports are different browser origins, so without this exact
  // entry the member page loads but every API call to :3000 is blocked by CORS.
  'http://179.198.197.114:8090',
]);
// Suffix-matched hosts, for a platform that hands out subdomains under one
// shared suffix (Vercel's *.vercel.app, Cloudflare Pages' *.pages.dev,
// etc.) rather than a fixed origin -- not needed for Soda's own fixed VPS
// domains, which live in CORS_ALLOWED_ORIGINS/_corsExtraHosts above/below
// instead, but kept here (empty) as the mechanism to add one back through
// if this ever moves off a single fixed VPS again.
const CORS_ALLOWED_SUFFIXES = [];
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
// path/port stripped, so the owner can paste "https://soda-platform.com/" or
// type "soda-platform.com" and get the same result.
// Matching is EXACT hostname only -- no wildcards, no suffix matching. A
// suffix entry typed as ".com" would hand every site on the internet access
// to this backend, and there is no phrasing of that field that makes the
// mistake obvious enough to risk.
function normalizeAllowedHost(raw) {
  let s = String(raw == null ? '' : raw).trim().toLowerCase();
  if (!s) return { skip: true };
  s = s.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '');
  if (!s) return { error: 'Enter a domain such as soda-platform.com' };
  if (s.length > 253) return { error: `"${raw}" is too long to be a domain.` };
  if (s.includes('*')) return { error: `Wildcards are not allowed ("${raw}"). Add each domain on its own line.` };
  const labels = s.split('.');
  if (labels.length < 2) return { error: `"${raw}" is not a full domain. Use something like soda-platform.com.` };
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
// "soda-platform.com.evil.com" ends with ".evil.com", not
// ".soda-platform.com".
//
// Deliberately NOT dependent on the base domain being set correctly: that
// is a separate setting for a separate job (deciding which COUNTRY a label
// belongs to), and reaching the backend at all must not be gated on it.
function corsHostAllowed(host) {
  const h = String(host || '').trim().toLowerCase();
  if (!h) return false;
  return _corsExtraHosts.some(d => h === d || h.endsWith('.' + d));
}
// See _decodeAuth(): when a token could not be CHECKED (as opposed to being
// found invalid), every route that answers 401 for it is rewritten here, in
// one place, to a 503 the app reads as "try again" rather than "logged out".
// Routes need no changes, and nothing is touched unless _decodeAuth() flagged
// this exact request.
app.use((req, res, next) => {
  const send = res.json.bind(res);
  res.json = function (body) {
    if (req._authTransient && res.statusCode === 401) {
      res.status(503);
      body = { status: 'error', code: 'AUTH_UNAVAILABLE', message: 'We could not check your sign-in just now. Please try again in a moment.' };
    }
    return send(body);
  };
  next();
});
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

// ── FIREBASE: NOT USED FOR SIGN-IN ANY MORE ──
// Member login is our own (see "MEMBER LOGIN" below): passwords and sessions
// live in MongoDB. firebase-admin is kept ONLY for the admin push alerts (FCM)
// until Web Push replaces them, and only when a service account is supplied --
// the server starts and members sign in with no Firebase at all.
let pushAdminReady = false;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    const { sa: pushSa, fatal: pushFatal } = require('./service-account').loadServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT);
    if (pushFatal) throw new Error(pushFatal);
    admin.initializeApp({ credential: admin.credential.cert(pushSa) });
    pushAdminReady = true;
  } catch (e) { console.warn('Admin push (FCM) disabled:', e.message); }
}

// ── MONGODB ──
const { connectMongo, db, FieldValue, pingDb } = require('./db');

// ── CONFIG ──
const ADMIN_KEY   = process.env.ADMIN_KEY   || '';
// This server's own public address, which is what MarzPay is told to call
// back on (PesaJet's webhook URL is dashboard-configured instead -- see the
// PESAJET section below). Set explicitly in secrets.local.js on the VPS --
// unlike a PaaS, a plain VPS has no platform env var to fall back to, so if
// this is ever unset, `callbackUrl`/`notifyUrl` is simply OMITTED from every
// payment request. The deposit would still be created and the prompt would
// still reach the phone, but nothing would ever call back -- the reconciler
// and the member's own poll would cover for it, so the only symptom is money
// taking minutes instead of seconds to appear.
const PUBLIC_URL  = (() => {
  let u = (process.env.PUBLIC_URL || '').trim().replace(/\/$/, '');
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
// wallet API. MARZSMS_KEY is unset until the owner supplies it (a VPS
// secret, never committed); every OTP send refuses cleanly until then.
const MARZSMS_BASE = 'https://sms.wearemarz.com/api/v1';
const MARZSMS_KEY  = process.env.MARZSMS_KEY || '';

// Uganda is the only supported currency and phone market. Historical accounts
// with another currency remain in storage for review, but cannot transact.
const DEFAULT_REGION_KEY = 'ug';
const DEFAULT_REGION = Object.freeze({
  key: 'ug', name: 'Uganda', currency: 'UGX', dialCode: '256',
  localLength: 9, prefixes: ['7'], utcOffsetMin: 180,
  active: true, isDefault: true, languages: ['en'], defaultLang: 'en',
});
let _mainAllowedHosts = [];
let _baseDomain = 'soda-platform.com';
let _blockRootDomain = true;
let _parkedHosts = [];
function refreshCorsSnapshot() {
  const all = _mainAllowedHosts.concat(_parkedHosts, _baseDomain ? [_baseDomain, 'www.' + _baseDomain] : []);
  _corsExtraHosts = all.filter((h, i) => h && all.indexOf(h) === i);
}
function refreshHostPolicy(sett) {
  const bd = normalizeAllowedHost(sett && sett.baseDomain);
  if (bd.host) _baseDomain = bd.host;
  _blockRootDomain = (sett && sett.blockRootDomain) !== false;
  _parkedHosts = sanitizeAllowedOrigins(sett && sett.parkedHosts).hosts || [];
  refreshCorsSnapshot();
}
function hostOnly(raw) {
  return String(raw || '').trim().toLowerCase()
    .replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '');
}
function isInfraHost(h) {
  if (!h) return false;
  if (h === 'localhost' || h === '127.0.0.1' || /^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return true;
  return CORS_ALLOWED_SUFFIXES.some(sfx => h.endsWith(sfx));
}
function hostIsParked(rawHost) {
  const h = hostOnly(rawHost);
  if (!h || isInfraHost(h)) return false;
  if (_parkedHosts.includes(h)) return true;
  return !!(_blockRootDomain && _baseDomain && (h === _baseDomain || h === 'www.' + _baseDomain));
}
function requestHost(req) {
  return hostOnly((req && req.headers && (req.headers.origin || req.headers.host)) || '');
}
function currentRegion() { return DEFAULT_REGION; }
function currentRegionKey() { return DEFAULT_REGION_KEY; }
app.use(async (req, res, next) => {
  await getSettings();
  next();
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
  if (!hostIsParked(requestHost(req))) return next();
  return res.status(403).json({
    status: 'error', code: 'HOST_PARKED',
    message: 'This address does not serve the app. Please open the correct Soda link.',
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
  // Background treatment for signed-in Home/Assets/Network/Profile and
  // secondary pages. Authentication screens keep their own controls above.
  innerBgOpacity: 100, innerBgBlur: 0,
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
  baseDomain: 'soda-platform.com',
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
  // Owner: "when I disable otp verification system the functions go away
  // completely" -- one master switch, separate from bankOtpRequired above.
  // Default ON for payout-account verification. Registration uses the
  // screenshot fields and no longer requests an OTP. Reset Password always
  // requires its code; disabling this switch turns off payout-account codes.
  otpVerificationEnabled: true,
  // The hours withdraw is open. Owner: "one withdrawal time should be
  // SETTABLE IN ADMIN, such that when one tries to withdrawal he sees, that
  // withdrawals start from this time to this time, nothing much ie 6pm to
  // 5pm."
  //
  // Stored as "HH:MM" 24-hour strings in EAT, and the window is allowed to
  // WRAP past midnight -- his own example, 18:00 to 17:00, is a 23-hour
  // window that does, and a from<=to-only check would have read it as
  // "closed always".
  //
  // Off by default: a fresh install must not lock withdraw behind hours
  // nobody has set yet.
  withdrawWindowEnabled: false, withdrawOpenFrom: '09:00', withdrawOpenTo: '17:00',
  // Off by default — approves every pending withdrawal automatically a few
  // seconds after it's requested, server-driven, idempotent (shares the
  // exact same processWithdrawalCore path a manual admin approval uses).
  // autoApproveMaxAmount: 0 = unlimited; a nonzero value leaves anything
  // above it for manual review instead.
  autoApproveWithdrawalsEnabled: false, autoApproveIntervalSec: 10, autoApproveMaxAmount: 0,
  supportTelegram: '', telegramGroup: '', telegramChannel: '', supportHours: '', supportEmail: '',
  rulesText: '', aboutText: '',
  // Owner: "l would like to also to edit the app name soda, so make it when
  // it can be editable everywhere." The platform's own name, previously
  // written into about a dozen strings across the client by hand. It has a
  // real DEFAULT (unlike brandTagline, which is stored only if set) because
  // every screen that shows the name needs SOMETHING: a blank here would
  // paint an app with no name on it during the first boot after a bad save.
  // Length is capped in the update route -- the name goes into the Home
  // wordmark and the Account profile mark, where a long one wraps the layout.
  brandName: 'Soda',
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
  // The line that scrolls across the Home screen under the four buttons. Empty = the built-in sentence.
  tickerText: '',
  // When annTitle/annBody last actually changed -- stamped by
  // /admin/settings/update below, never set directly by an admin. Backs the
  // Home screen's inline "Latest Announcement" row (its own preview of this
  // same announcement, distinct from the full announceBg dialog), which
  // shows a real date rather than inventing one.
  annUpdatedAt: null,
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
  // ── OTP (SMS one-time codes via MarzSms) ──
  // Used by password reset and payout-account verification. Daily limits
  // are per phone; 0 means send none, not unlimited.
  otpDailyLimitReset: 3, otpDailyLimitBank: 2,
  // ── USDT (TRC20) DEPOSIT ── a third deposit rail alongside the automatic
  // MarzPay mobile-money flow (untouched by this) -- see the "USDT (TRC20)
  // DEPOSIT" section below /deposit/marzpay/status for the actual route.
  // Off by default; the app only shows the option once an owner turns it
  // on with a real wallet address and rate set.
  usdtEnabled: false, usdtWalletAddress: '', usdtRate: 0,
  // ── CARD DEPOSIT (MarzPay) ── a fourth deposit rail. Uses the SAME
  // MarzPay account/API key as mobile money above regardless of which
  // gateway (MarzPay or PesaJet) is picked for mobile-money deposits --
  // card payments are a MarzPay-only product, so this always goes through
  // MarzPay even when depositMethod is 'pesajet'. Off by default: the
  // owner's MarzPay business needs an active Card Payments subscription
  // before this can work at all (MarzPay refuses with SERVICE_NOT_SUBSCRIBED
  // otherwise), so it must not turn itself on.
  cardDepositEnabled: false,
};
// Keep this exact list of keys in sync with NUMBER_FONT_STACKS in
// user-src/original_module.js (the client-side fallback-stack lookup) and
// the <select> options in admin-src/index.html -- all three must agree on
// the same set of names for a saved value to actually render correctly.
const NUMBER_FONT_OPTIONS = ['Bodoni Moda', 'Playfair Display', 'DM Serif Display', 'Georgia', 'Roboto Mono', 'JetBrains Mono', 'Orbitron', 'System default'];
// Daily Cashback × 150 = Total Return = Investment × 30, per tier — every
// figure below is stamped explicitly rather than derived, matching the
// owner-supplied table exactly.
// Placeholder catalog — Soda has no confirmed product names/images yet (see
// CLAUDE.md "Product config"). Formula reused from Snow: expectedReturn = price * 30
// over a 150-day cycle. Rename/replace images once the owner supplies real ones.
// Soda starts with NO built-in assets. The twelve placeholder "Product-N" rows this list used to
// carry came from another app (x30 over 150 days) and showed up in front of members until each one
// was deleted by hand. Every asset a member sees is now one the admin created in Products.
const DEFAULT_PRODUCTS = [];

// The active settings document is settings/main.
let _settingsCache = null, _settingsCacheTs = 0;
async function getSettings() {
  if (_settingsCache && Date.now() - _settingsCacheTs < 60 * 1000) return _settingsCache;
  try {
    const snap = await db.collection('settings').doc('main').get();
    const stored = snap.exists ? snap.data() : {};
    _settingsCache = Object.assign({}, DEFAULT_SETTINGS, stored);
    _mainAllowedHosts = sanitizeAllowedOrigins(stored.allowedOrigins).hosts || [];
    refreshHostPolicy(_settingsCache);
    _settingsCacheTs = Date.now();
    return _settingsCache;
  } catch (_) { return _settingsCache || DEFAULT_SETTINGS; }
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
// Soda accepts Uganda mobile money only.
const MARZPAY_MARKETS = Object.freeze({
  '256': { code: 'UG', currency: 'UGX' },
});
// The market a region belongs to, or null if MarzPay does not serve it.
function marzMarket(region) {
  const r = region || currentRegion();
  return MARZPAY_MARKETS[String((r && r.dialCode) || '').replace(/\D/g, '')] || null;
}

// Both configured automatic gateways are limited to Uganda.
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
async function getProducts() {
  const raw = await getProductsRaw();
  return raw.map(p => { const { regions, ...product } = p; return product; });
}
async function getProductByKey(key) {
  const list = await getProducts();
  return list.find(p => p.key === key) || null;
}
// Single admin-configurable Home banner (per snow/CLAUDE.md Nav/IA). Kept
// deliberately minimal compared to space8's many-slot system — Snow's
// design has exactly one banner surface right now. Used to also carry an
// optional video (Home.dc.html's "ADMIN VIDEO BANNER") -- removed entirely,
// owner: "video banner remove it" -- along with the /public/banner-video
// streaming route, the home-video Mongo doc, and the up-to-4s preload wait
// it cost the client's loading screen on a first open after every upload.
let _bannerCache = null, _bannerCacheTs = 0;
async function getHomeBanner() {
  if (Date.now() - _bannerCacheTs < 60 * 1000 && _bannerCache !== null) return _bannerCache;
  try {
    const snap = await db.collection('banners').doc('home').get();
    const d = snap.exists ? snap.data() : {};
    _bannerCache = { image: d.image || null };
  } catch (_) { _bannerCache = _bannerCache || { image: null }; }
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
// Two Soda-only image slots -- the Referral page banner and the brand logo
// shown on the Account profile card. Same 'banners' collection and same
// 60s cache shape as getHomeBanner()/getHelpBanner() above, but written
// once generically rather than copy-pasted per slot: `soda-<slot>` doc ids
// keep them from colliding with Snow's inherited 'home'/'help' docs.
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
// which also accepts video), not duplicated here. Both reuse this exact
// already-built upload mechanism rather than adding a new one; see
// CLAUDE.md's "Design system" section.
//
// 'homefooter' (the "Clean Energy Stronger Communities"-style image at the
// bottom of Home) and 'profilecard' (the Account screen's refinery-photo
// header background) REMOVED (owner, circling both upload rows directly:
// "the headers l meant were those ones, and account screen header photos
// those were what l meant") -- along with their admin upload rows and every
// client render site (Home's footer image, the Account profile card's
// background image).
//
// 'profilegif' and 'authcard' REMOVED (owner: "every idle code which has no
// function it is really doing should be removed") -- both were confirmed
// genuinely dead, not just unused-for-now: neither has had an admin upload
// row for several rounds (grep of admin-src/index.html: zero hits for
// either), 'profilegif's own consumers (homeGifHtml()/fitHomeGif()) were
// already deleted entirely in an earlier round, leaving only a pointless
// STATE.profileGif assignment nothing ever read, and 'authcard's own target
// element (#authCardBg) was removed from the markup when the auth screen
// went single-photo -- its own CSS comment already said so. Removing the
// slots here means an admin can no longer even try to set them, not just
// that nothing currently reads the result.
//
// 'downloadbg' REMOVED too (owner: "remove that stuff of download app
// background... remove download app back image input") -- Download App is
// no longer its own screen with a backdrop; Account's new Download App row
// (downloadAppRowHtml()) now triggers the existing promptInstallApp() PWA
// prompt directly, in user-src/original_module.js -- see its own comment.
const SODA_IMAGE_SLOTS = ['logo', 'authhero', 'banner2', 'banner3', 'checkinbanner', 'profilelogo', 'loaderbg'];
const _sodaImageCache = {};
const LEGACY_IMAGE_PREFIX = ['c','h','i','p','z','-'].join('');
async function getSodaImage(slot) {
  if (!SODA_IMAGE_SLOTS.includes(slot)) return null;
  const cached = _sodaImageCache[slot];
  if (cached && Date.now() - cached.ts < 60 * 1000) return cached.image;
  let image = null;
  try {
    const ref = db.collection('banners').doc('soda-' + slot);
    const snap = await ref.get();
    image = (snap.exists && snap.data().image) || null;
    // One-time data migration only: older uploads lived under the fork's
    // document prefix. If Soda has no value yet, copy that image into the
    // Soda document and delete the obsolete source document.
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
  _sodaImageCache[slot] = { image, ts: Date.now() };
  return image;
}
// ── BRAND ASSETS: the installed-app icon ──
//
// Unlike every other admin image in this file, this is NOT read by the
// app's own JavaScript -- it's read by Android/Chrome out of manifest.json
// when a member installs the app. That consumer can't use a data: URI and
// runs no line of our code, so it has to be a real image FILE at a fixed,
// permanent URL. That is what this serves, and it is why it can't just be
// one more slot on /public/soda-images.
//
// The bytes live in their own document and are never part of any per-boot
// payload, for the same two reasons the banner video isn't: Mongo caps a
// document at 16 MB, and no member's phone should download it on app
// start. Members' phones never fetch this at all.
//
// Used to also hold a 'link-preview' slot for the og:image share card, with
// its own admin upload and enable toggle -- owner: "remove stuffs of link
// preview, here there will be no link preview." Removed entirely, along
// with the toggle (DEFAULT_SETTINGS.linkPreviewEnabled), the admin upload
// UI, the /public/link-preview.jpg route, and the og:image/twitter:image
// tags in index.html's <head>.
const BRAND_ASSET_SLOTS = {
  'app-icon-512': { mime: 'image/png',  w: 512,  h: 512, max: 600 * 1024, file: 'icon-512.png' },
  'app-icon-192': { mime: 'image/png',  w: 192,  h: 192, max: 300 * 1024, file: 'icon-192.png' },
};
const _brandAssetCache = {}, _bundledAssetCache = {};
// The icon that ships inside the static build, read off disk. soda-server's
// rootDir is `soda/`, so `user/icon-512.png` is right there beside this
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
const BRAND_SLOT_LABEL = { 'app-icon-512': 'app icon', 'app-icon-192': 'app icon' };
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
// The Rules and Regulations article is an independent, admin-authored list
// of text/image blocks. Keep its images out of /public/settings so every app
// boot does not download rules-page artwork that most members never open.
let _rulesCache = null, _rulesCacheTs = 0;
async function getRulesContent() {
  if (Date.now() - _rulesCacheTs < 60 * 1000 && _rulesCache !== null) return _rulesCache;
  try {
    const snap = await db.collection('content').doc('rules').get();
    _rulesCache = (snap.exists && Array.isArray(snap.data().blocks)) ? snap.data().blocks : null;
  } catch (_) { _rulesCache = _rulesCache || null; }
  _rulesCacheTs = Date.now();
  return _rulesCache;
}

// ── HELPERS ──
// Gift-code rewards carry cents (owner: "make gift codes to have decimal places
// ie 647.72, 212.36 instead of whole number"): the random roll is made in whole
// cents and paid as e.g. 647.72. Every other money amount (deposits, asset
// prices, withdrawals) stays a whole shilling. fmtMoney shows cents only when
// the figure has them.
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
// Rounds to the nearest UGX cent (2 decimal places). Used by gift codes, the spin
// wheel/turntable and reporting math.
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function stripHtml(s) { return String(s || '').replace(/<[^>]*>/g, '').trim(); }
// The region's own wall clock. Kampala (UTC+3) for Uganda, and whatever
// utcOffsetMin the admin set for any other country -- a withdraw window of
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
// Public member-facing transaction reference. Format:
// B2 + YYMMDDHHMMSS + 4 digits, for example B2609220514561788.
// New rows receive a cryptographically-random suffix server-side. Older
// ledger rows predate this field, so /transactions derives the SAME stable
// B2 reference from the immutable transaction document id instead of
// inventing a different id on every read.
function statementStamp(ts) {
  const ms = tsMillis(ts) || Date.now();
  const d = new Date(ms + tzOffMs());
  const pad = n => String(n).padStart(2, '0');
  return String(d.getUTCFullYear()).slice(-2)
    + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate())
    + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds());
}
function newStatementId() {
  return 'B2' + statementStamp(Date.now()) + String(crypto.randomInt(0, 10000)).padStart(4, '0');
}
function statementIdFor(doc) {
  const row = doc.data() || {};
  if (/^B2\d{16}$/.test(String(row.statementId || ''))) return row.statementId;
  const digest = crypto.createHash('sha256').update(String(doc.id)).digest();
  const suffix = String(digest.readUInt32BE(0) % 10000).padStart(4, '0');
  let stamp = '';
  const createdMs = tsMillis(row.createdAt);
  if (createdMs) {
    stamp = statementStamp(row.createdAt);
  } else {
    // Some very old ledger rows predate createdAt but still carry the
    // immutable MM/DD/YYYY + HH:MM:SS fields. Use them so their public
    // statement reference remains stable instead of borrowing "now".
    const dm = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(row.date || ''));
    const tm = /^(\d{2}):(\d{2}):(\d{2})/.exec(String(row.time || ''));
    if (dm && tm) stamp = dm[3].slice(-2) + dm[1] + dm[2] + tm[1] + tm[2] + tm[3];
  }
  if (!stamp) {
    // Last-resort stable numeric segment for malformed legacy rows.
    const a = digest.readUInt32BE(4).toString().padStart(10, '0').slice(-10);
    const b = String(digest.readUInt16BE(8) % 100).padStart(2, '0');
    stamp = a + b;
  }
  return 'B2' + stamp + suffix;
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
// ── The withdraw window ──────────────────────────────────────────────────
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
// Whether withdraw is open right now, plus the labels the client shows.
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
  const founding = DEFAULT_REGION;
  return String(r.dialCode || '') === String(founding.dialCode || '');
}
function phoneToEmail(phone, region) {
  const r = region || currentRegion();
  const local = localDigits(phone, r) || String(phone).replace(/\D/g, '').replace(/^0+/, '');
  return (regionUsesBareLocal(r) ? local : String(r.dialCode || '') + local) + '@soda-platform.com';
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
// Owner, 2026-09-28 (second round the same day, this time with two
// reference screenshots of the exact target shapes): referral codes are
// now one flat 8-character block with no dashes (e.g. "mrxwpqr3"); gift
// codes keep their existing 3-groups-of-4 dash shape (e.g.
// "5sr3-4ao5-zi3g") but lowercase now instead of uppercase. Both
// alphabets stay the unambiguous set (no i/l/o/0/1) -- just lowercased,
// not widened to include them -- because a code read off a screenshot
// must never require guessing between o and 0, the same requirement
// that has held across every previous format change; the reference
// screenshots (which happened to mix in a few 0s/o's, being generic
// examples rather than hand-picked for this) were read as a length/
// case/grouping style to copy, not a request to drop that guarantee.
//
// "make sure fixed character" -- every referral code generated from now
// on is EXACTLY 8 characters, full stop, never longer. The alphabet is
// wide enough on its own (31 characters ^ 8 places is ~852 billion) that
// the old escalate-past-collision fallback (5 -> 6 -> 7 characters) is
// no longer needed at all -- length is now a guarantee, not a starting
// point that can grow.
//
// /redeem already accepted dashes in its input regex before this round
// (`[A-Za-z0-9-]+`), and tolerates a member typing a gift code WITHOUT
// the dashes too -- see /redeem's own fallback below, now rewritten to
// match case-insensitively via codeLower regardless of which case a
// given code happens to be stored in (old uppercase ones and new
// lowercase ones alike).
const GIFTCODE_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';
const GIFTCODE_GROUP_LEN = 4;
const GIFTCODE_GROUPS = 3;
const GIFTCODE_LENGTH = GIFTCODE_GROUP_LEN * GIFTCODE_GROUPS; // 12 meaningful characters, unchanged
function genGiftCode() {
  const raw = randFromAlphabet(GIFTCODE_CHARS, GIFTCODE_LENGTH);
  const groups = [];
  for (let i = 0; i < GIFTCODE_LENGTH; i += GIFTCODE_GROUP_LEN) groups.push(raw.slice(i, i + GIFTCODE_GROUP_LEN));
  return groups.join('-');
}
// One flat block, no dashes -- the previous round's own reasoning for
// referral codes (spoken aloud more often than typed) still holds; a
// dash in a code someone is reading out over a phone call is one more
// thing to mishear ("dash" vs "hyphen" vs a pause). 8 characters, always.
const REFERRAL_CHARS = GIFTCODE_CHARS; // same unambiguous alphabet, now lowercase, not a new one
const REFERRAL_LENGTH = 8;
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
    // No length-escalation fallback -- "make sure fixed character" means
    // every referral code is 8 characters, always. The space is wide
    // enough (31^8, ~852 billion) that 50 collisions in a row would mean
    // something is actually broken, not that the space is crowded; that
    // case throws rather than silently handing out a longer code.
    for (let attempt = 0; attempt < 50; attempt++) {
      const claimed = await tryClaim(randCode(REFERRAL_LENGTH));
      if (claimed) return claimed;
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
// Task Center rewards are earned from deposits, never from a referral's
// investment. A Level 1 member becomes active only after their deposit has
// genuinely credited their account. Each listed task remains claimable once.
const TEAM_MILESTONES = [
  { target: 5, reward: 10000 }, { target: 15, reward: 20000 },
  { target: 20, reward: 40000 }, { target: 35, reward: 80000 },
  { target: 50, reward: 160000 }, { target: 100, reward: 320000 },
];
const TEAM_DEPOSIT_MILESTONES = [
  { target: 250000, reward: 10000 }, { target: 500000, reward: 10000 },
  { target: 750000, reward: 20000 }, { target: 1000000, reward: 20000 },
  { target: 1500000, reward: 50000 }, { target: 2000000, reward: 50000 },
];
async function activeL1Count(userId) {
  const snap = await db.collection('users').where('referredBy', '==', userId).get();
  let n = 0;
  snap.forEach(d => {
    const v = d.data();
    if (v.status !== 'banned' && finiteMoney(v.totalDeposited) > 0) n += 1;
  });
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

// Verifies the caller's login token ONCE per request and remembers the answer
// on the request object (the region middleware needs the member's uid before
// any handler runs, and every handler then asks again).
//
// Our own tokens: the app sends the random token it was given at login; the
// server looks up its SHA-256 in `memberSessions` (see session-policy.js). A
// token that is unknown, revoked, idle too long or past 8 hours is a plain
// 401. If the session store itself cannot be read, that says nothing about the
// member, so the request is flagged and answered 503 AUTH_UNAVAILABLE (see the
// response hook above) -- the app reads that as "try again", never "you are
// logged out".
async function _decodeAuth(req) {
  if (req && '_authDecoded' in req) return req._authDecoded;
  const header = (req && req.headers.authorization) || '';
  let decoded = null;
  if (header.startsWith('Bearer ')) {
    try { decoded = await sessionPolicy.checkMemberSession(db, header.slice(7), req.path === '/auth/session/activity'); }
    catch (e) {
      console.error('Session check failed:', e.message);
      decoded = null;
      if (req) req._authTransient = true;
    }
  }
  if (req) { try { req._authDecoded = decoded; } catch (_) {} }
  return decoded;
}
async function verifyAuth(req) {
  const decoded = await _decodeAuth(req);
  return decoded ? decoded.uid : null;
}
// `phone` is the phone number the account was created with (kept on the
// session), so /register and /account/create-profile never trust a phone the
// caller types in.
async function verifyAuthWithEmail(req) {
  const decoded = await _decodeAuth(req);
  return decoded ? { uid: decoded.uid, phone: cleanPhone(decoded.phone || '') || null, key: decoded.key } : null;
}
function paymentAmount(value) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/.test(value))) return NaN;
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : NaN;
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
//
// ── DATA-ONLY ON PURPOSE ──
// These used to carry a `notification` block. The Firebase web SDK shows any
// message that has one by itself when the page is in the background, and the
// admin service worker's own onBackgroundMessage ALSO showed one, so a single
// event produced two notifications on the same phone. (That was blamed on two
// registered tokens, which can also happen, but this alone doubled every
// alert.) The title and body now travel in `data`, and the service worker is
// the only thing that displays them -- which is also what lets it attach an
// Approve button and a per-event `tag` so a repeat replaces rather than stacks.
// `Urgency: high` asks the push service to deliver at once even when the phone
// is idle, and the TTL drops an alert nobody saw within two hours.
//
// Messages go out one per device (sendEach), not as one shared multicast,
// because an owner device's copy of a withdrawal alert carries that device's
// own quick-approve secret (see /admin/withdraw/quick-approve).
const ADMIN_PUSH_HEADERS = { Urgency: 'high', TTL: '7200' };
// How long an Approve button on an alert that was delivered before the device's
// push token rotated keeps working (the secret is tied to the retired token).
const PUSH_RETIRED_GRACE_MS = 48 * 60 * 60 * 1000;
function pushRetiredExpired(t) { return !!t.retiredAt && Date.now() - tsMillis(t.retiredAt) > PUSH_RETIRED_GRACE_MS; }
async function sendAdminPush(title, body, data = {}, opts = {}) {
  if (typeof pushAdminReady !== 'undefined' && !pushAdminReady) return; // admin push needs its own setup (see the FIREBASE note near the top)
  try {
    const all = await db.collection('adminPushTokens').get();
    if (all.empty) return;
    // A token the browser replaced is "retired", not deleted: alerts already on
    // the phone keep working for a while (see PUSH_RETIRED_GRACE_MS) but nothing
    // new is sent to it, and it is purged once the grace is over.
    const snap = { docs: all.docs.filter(d => !d.data().retiredAt) };
    const purge = all.docs.filter(d => d.data().retiredAt && pushRetiredExpired(d.data()));
    if (purge.length) Promise.all(purge.map(d => db.collection('adminPushTokens').doc(d.id).delete().catch(() => {}))).catch(() => {});
    if (!snap.docs.length) return;
    const base = {};
    for (const [k, v] of Object.entries(data)) base[k] = String(v);
    base.title = String(title); base.body = String(body);
    const messages = snap.docs.map(d => {
      const t = d.data(), dd = Object.assign({}, base);
      // Only an owner device that has a secret is ever offered the button.
      // Staff devices get the same alert with no action at all.
      if (opts.quickApprove && t.role === 'owner' && t.quickApproveSecret) {
        dd.quickApprove = '1'; dd.pushToken = d.id; dd.secret = String(t.quickApproveSecret);
      }
      return { token: d.id, data: dd, webpush: { headers: ADMIN_PUSH_HEADERS } };
    });
    const stale = [];
    for (let i = 0; i < messages.length; i += 500) {
      const chunk = messages.slice(i, i + 500);
      const resp = await admin.messaging().sendEach(chunk);
      resp.responses.forEach((r, j) => {
        const code = r.success ? null : (r.error && r.error.code);
        if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token')
          stale.push(chunk[j].token);
      });
    }
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
const ADMIN_SESSION_TTL_MS = sessionPolicy.MAX_MS; // 8h maximum, plus 15 minute idle expiry
// Used by /admin/login to run scryptVerify against SOMETHING even when the
// username doesn't exist, so that path costs the same as a real wrong-
// password attempt instead of returning near-instantly (timing side-channel).
const DUMMY_PASSWORD_HASH = scryptHash(crypto.randomBytes(24).toString('hex'));
async function createSession(username, role) {
  const token = crypto.randomBytes(32).toString('hex');
  await db.collection('adminSessions').doc(token).set({
    username, role, createdAt: FieldValue.serverTimestamp(), lastActiveAt: new Date(),
    expiresAt: new Date(Date.now() + ADMIN_SESSION_TTL_MS)
  });
  return token;
}
async function resolveSession(token, touch = false) {
  if (!token) return null;
  const snap = await db.collection('adminSessions').doc(token).get();
  if (!snap.exists) return null;
  const s = snap.data();
  if (!sessionPolicy.validSession(s, Date.now(), sessionPolicy.ADMIN_IDLE_MS)) return null;
  if (touch && !(await db.collection('adminSessions').doc(token).updateIf({
    expiresAt: { $gt: new Date() }, lastActiveAt: { $gt: new Date(Date.now() - sessionPolicy.ADMIN_IDLE_MS) }
  }, { lastActiveAt: new Date() }))) return null;
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
// Owner asked for "due to insufficient funds" on this exact screen. Checked
// against MarzPay's own integration guide (docs/marzpay-integration-guide.pdf,
// sections 5.5/11.5/12) before wording this: a collection that moves past
// "processing" into "failed"/"cancelled" -- via GET /collect-money/{uuid} or
// the collection.failed webhook -- carries only that terminal status, no
// reason field anywhere in the documented transaction/collection/webhook
// shapes. MarzPay's only documented per-transaction reason
// (INSUFFICIENT_BALANCE, an error_code in section 12.2) belongs to the
// error envelope a bad /collect-money REQUEST gets back immediately --
// already surfaced separately via marzUserMsg() at submission time (see
// "Could not start the payment"/"Could not start the card payment"), and it
// describes the BUSINESS's own MarzPay wallet running low, not a customer's
// mobile money balance. There is no live data source for "why" a customer's
// own payment failed once MarzPay accepted it and sent the prompt -- stating
// a specific cause here would be a guess, not a fact (this app's own
// standing rule, see setDepositStatusFailed()'s comment). Lists the real
// possibilities instead of asserting one.
const DEPOSIT_FAILED_MSG = 'This payment was not completed. This can happen if you did not approve the prompt in time, cancelled it, or had insufficient funds. Please try again.';
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
// Card collection -- a different shape from marzMoneyBody() above: no
// phone_number at all (the docs are explicit: "Do not send phone_number
// for card payments"), and `method: 'card'` is what actually selects the
// card gateway instead of a mobile-money push prompt. Funds land in a
// SEPARATE card wallet on MarzPay's side (card_balance, not the main
// balance) -- nothing in this app cares about that distinction, since a
// member's own wallet credit here is always driven by our own
// creditDeposit(), never by which MarzPay wallet the money sits in.
async function marzCollectCard({ amount, reference, description, callbackUrl, region }) {
  const market = marzMarket(region);
  if (!market) return marzNoMarket(region);
  const payload = { amount: Number(amount), method: 'card', country: market.code, reference, description: description || 'Card payment' };
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
// ── BANK TRANSFER (MarzPay) ── a payout rail alongside mobile-money
// send-money, always via MarzPay regardless of withdrawProvider() (the
// same "always this one gateway" reasoning as card deposits, which stay
// on MarzPay even when depositMethod is 'pesajet' -- bank transfer is a
// MarzPay-only product). Unlike marzMoneyBody() above, there is no
// `country`/`currency` field at all -- the docs show none for this
// endpoint (Uganda-primary today) -- and no client-supplied `reference`
// either: MarzPay generates its own and hands it back in the response, so
// (unlike collect/send, where OUR pre-generated reference is what lets a
// network-error retry be matched up later) there is nothing to pre-write
// before calling out. A network error here is exactly as ambiguous as the
// send-money one and handled the same way by the caller: never assume
// nothing was sent.
async function marzBankTransfer({ amount, bankName, accountNumber, accountName, description }) {
  const payload = { amount: Number(amount), description: description || 'Withdrawal', bank_name: bankName, bank_account_number: accountNumber };
  if (accountName) payload.bank_account_name = accountName;
  const resp = await fetch(`${MARZPAY_BASE}/bank-transfer`, {
    method: 'POST', signal: AbortSignal.timeout(MARZ_TIMEOUT),
    headers: { 'Authorization': `Basic ${MARZPAY_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return _marzParse(resp);
}
// Validates a recipient account BEFORE it is saved as a withdrawal
// destination -- MarzPay's own docs recommend this ("avoids failed
// transfers and refunds... returns the account holder name"). Called from
// /bank/save, not at withdrawal time -- catching a typo'd account number
// the moment it is entered is far better than finding out only once real
// money is already being sent.
//
// Owner: "make sure bro there is supernatural validation" -- found while
// testing: a real submit came back "UNABLE TO COMPLETE COMMUNICATION",
// reading exactly like a bank switch's own transient "could not reach
// that bank's systems just now" response, not a clean rejection. One
// retry, but ONLY for a failure that actually looks transient (a network
// exception, or anything _marzParse/the bank switch itself already
// signals as provider trouble rather than a real answer about the
// account) -- a clean, definitive rejection (VALIDATION_FAILED,
// BANK_NOT_SUPPORTED, a genuinely nonexistent account) would fail the
// exact same way again, so retrying it only adds latency to an answer
// that was already correct. No retry at all on the common path (success,
// or a clean rejection) -- the "callback speed very fast" half of the
// same ask.
async function marzValidateBankAccount(bankName, accountNumber) {
  const attempt = async () => {
    try {
      const resp = await fetch(`${MARZPAY_BASE}/bank-transfer/validate`, {
        method: 'POST', signal: AbortSignal.timeout(MARZ_TIMEOUT),
        headers: { 'Authorization': `Basic ${MARZPAY_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ bank_name: bankName, account_number: accountNumber })
      });
      return await _marzParse(resp);
    } catch (netErr) {
      return { status: 'error', providerDown: true, message: netErr.message };
    }
  };
  let result = await attempt();
  const transient = result.providerDown || /communicat/i.test(String(result.message || ''));
  if (transient) result = await attempt();
  return result;
}
function _marzExtractBankTransfer(d) {
  // GET /bank-transfer/{reference}'s own response key is
  // bank_transfer_request (named differently from the CREATE response's
  // bank_transfer -- the docs call this out explicitly), so both are
  // tried rather than assuming one.
  const bt = d?.data?.bank_transfer_request || d?.data?.bank_transfer || d?.data || d || {};
  return { status: String(bt.status || d?.status || '').toLowerCase() };
}
async function marzGetBankTransferStatus(reference) {
  let lastErr = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const resp = await fetch(`${MARZPAY_BASE}/bank-transfer/${reference}`, {
        signal: AbortSignal.timeout(MARZ_TIMEOUT), headers: { 'Authorization': `Basic ${MARZPAY_KEY}` }
      });
      const d = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        console.error(`marzGetBankTransferStatus(${reference}) attempt ${attempt}: HTTP ${resp.status}`, JSON.stringify(d).slice(0, 300));
        lastErr = new Error(`HTTP ${resp.status}`);
      } else {
        return _marzExtractBankTransfer(d).status;
      }
    } catch (e) { lastErr = e; console.error(`marzGetBankTransferStatus(${reference}) attempt ${attempt} failed:`, e.message); }
    if (attempt < 2) await new Promise(r => setTimeout(r, 350));
  }
  console.error(`marzGetBankTransferStatus(${reference}): gave up after 2 attempts, last error:`, lastErr && lastErr.message);
  return '';
}
// Cached (10 min -- this changes rarely, no reason to hit MarzPay on every
// wallet-bind screen open), populated from MarzPay's own live list rather
// than hardcoded here: bank codes "must match exactly for the provider to
// accept the transfer" per their own docs, and this project has no
// reliable source for all ~25 of them, only the 6 shown as examples on the
// docs page. A stale/incomplete hardcoded list would silently reject real
// banks or, worse, send a transfer under the wrong code.
let _bankListCache = null, _bankListCacheTs = 0;
const BANK_LIST_CACHE_MS = 10 * 60 * 1000;
async function getSupportedBanks() {
  if (_bankListCache && Date.now() - _bankListCacheTs < BANK_LIST_CACHE_MS) return _bankListCache;
  try {
    const resp = await fetch(`${MARZPAY_BASE}/bank-transfer/banks`, {
      signal: AbortSignal.timeout(MARZ_TIMEOUT), headers: { 'Authorization': `Basic ${MARZPAY_KEY}` }
    });
    const d = await resp.json().catch(() => ({}));
    if (resp.ok && d.status === 'success' && Array.isArray(d.data?.banks)) {
      _bankListCache = d.data.banks.map(b => ({ code: String(b.code || ''), name: String(b.name || '') })).filter(b => b.code && b.name);
      _bankListCacheTs = Date.now();
    }
  } catch (e) { console.error('getSupportedBanks failed:', e.message); }
  return _bankListCache || [];
}
// A withdrawal account's `network` is only ever one of NETWORK_NAMES
// (mobile money, checked at /bank/save time) or a bank name that
// getSupportedBanks() had ALREADY confirmed real at that same save time --
// so classifying a bound account at withdrawal time needs no live MarzPay
// call at all, only this. Keeps the payout-processing path from taking on
// a MarzPay dependency just to decide which of its own two endpoints to
// call.
function isBankNetwork(network) { return !NETWORK_NAMES.has(String(network || '')); }
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
// A code that never arrives is worse than a slow one, so one transient
// failure (a network error, a timeout, or a 5xx from the provider) is retried
// once before giving up. A 4xx is a definite answer (bad key, bad number,
// out of credit) and is never retried. Both attempts carry the same message,
// so a timeout that actually delivered still leaves the member holding a
// valid code; the worst case is one extra 30 UGX text.
const MARZSMS_TIMEOUT = 10000;
async function marzSmsSend(recipients, message) {
  const attempt = async () => {
    let resp;
    try {
      resp = await fetch(`${MARZSMS_BASE}/sms/send`, {
        method: 'POST', signal: AbortSignal.timeout(MARZSMS_TIMEOUT),
        headers: { 'Authorization': `Basic ${MARZSMS_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient: recipients, message }),
      });
    } catch (e) { e.transient = true; throw e; }
    const data = await resp.json().catch(() => ({}));
    // MarzSms's own documented error shape is {success:false,message,error}
    // (no `status` field, unlike the wallet API) -- resp.ok is the reliable
    // signal here; an explicit success:false on a 200 is also a refusal.
    if (!resp.ok || data.success === false) {
      const err = new Error(data.message || data.error || `MarzSms HTTP ${resp.status}`);
      err.transient = resp.status >= 500;
      throw err;
    }
    return data;
  };
  try { return await attempt(); }
  catch (e) {
    if (!e.transient) throw e;
    await new Promise(r => setTimeout(r, 400));
    return attempt();
  }
}
// ── OTP (SMS one-time codes, via MarzSms above) ──
// Owner: registration goes phone -> password -> confirm -> trade PIN;
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
const OTP_PURPOSES = new Set(['reset', 'bank']);
const OTP_SETTINGS_FIELD = { reset: 'otpDailyLimitReset', bank: 'otpDailyLimitBank' };
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
// Resolves to the day key the send was counted against (so a refund hits the
// same day even if midnight passes mid-request), or false when refused.
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
    return day;
  });
}
// A text that could not be sent was never delivered, so it must not use up
// one of the member's few daily codes (the registration default is 2 -- two
// provider hiccups would otherwise lock a real member out until tomorrow).
async function otpRefundDailyLimit(phone, purpose, day) {
  try {
    await withLock('otp-limit:' + phone + ':' + purpose, async () => {
      await db.collection('otpSendLog').doc(`${phone}:${purpose}:${day}`)
        .set({ count: FieldValue.increment(-1), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    });
  } catch (e) { console.error('OTP quota refund failed:', e.message); }
}
// The text itself: code first, so a lock-screen preview shows it without
// opening the message. The optional last line ("@host #code") is the format
// Android Chrome's WebOTP API reads to offer the code to the page that
// requested it -- only added when the caller's origin is one of our own
// https app origins, so it can never point a browser at somebody else's host.
function otpOriginHost(req) {
  try {
    const o = new URL(String(req.headers.origin || ''));
    if (o.protocol !== 'https:' || o.port) return '';
    const h = o.hostname.toLowerCase();
    if (CORS_ALLOWED_ORIGINS.has(o.origin) || corsHostAllowed(h)) return h;
  } catch (_) {}
  return '';
}
function otpSmsText(code, sett, req) {
  const brand = String((sett && sett.brandName) || 'Soda').replace(/[^\x20-\x7e]/g, '').trim().slice(0, 20) || 'Soda';
  const host = otpOriginHost(req);
  return `${code} is your ${brand} verification code. It expires in 10 minutes. Never share it with anyone.` +
    (host ? `\n\n@${host} #${code}` : '');
}
// Looks the code up by its ticket (not by the otpCodes doc id, which the
// caller of /auth/otp/verify never learns), and only ever consumes it once:
// updateIf's conditional match is a single atomic Mongo call, so two
// requests racing on the same ticket cannot both succeed (see updateIf's
// own comment in db.js -- the identical pattern this file already uses for
// creditedDepositIds/refundedWithdrawalIds).
async function consumeOtpTicket(ticket, phone, purpose, registrationUserId) {
  if (!ticket || !phone) return false;
  const snap = await db.collection('otpCodes').where('ticket', '==', ticket).limit(1).get();
  if (snap.empty) return false;
  const ref = snap.docs[0].ref;
  return withLock('otp:' + ref.id, async () => {
    const fresh = await ref.get();
    if (!fresh.exists) return false;
    const o = fresh.data(), now = Date.now();
    if (o.ticket !== ticket || !o.verified || o.phone !== phone || o.purpose !== purpose || !(tsMillis(o.ticketExpiresAt) > now)) return false;
    // A failed referral validation may retry only this same registration.
    // Reset and payout tickets remain strictly single-use.
    if (o.consumedAt) return purpose === 'register' && !!registrationUserId && o.registrationUserId === registrationUserId;
    return ref.updateIf({ ticket, consumedAt: null, verified: true, ticketExpiresAt: { $gt: new Date(now) } }, {
      consumedAt: FieldValue.serverTimestamp(),
      ...(purpose === 'register' && registrationUserId ? { registrationUserId } : {})
    });
  });
}
function _marzExtractTx(d) {
  const tx = d?.data?.transaction || d?.transaction || d?.data || d || {};
  const rawStatus = tx.status || tx.state || tx.transaction_status || tx.payment_status || d?.status || '';
  // Speculative, checked against MarzPay's own integration guide afterward
  // (docs/marzpay-integration-guide.pdf) rather than assumed correct:
  // neither the collection-status response (5.5) nor the webhook payloads
  // (11.5) document a reason field anywhere on a failed/cancelled
  // collection -- only a terminal status. Kept anyway as a genuinely
  // harmless forward-compatible read (costs nothing if MarzPay ever adds
  // one; marzDepositFailureMsg() below already falls back safely when it's
  // absent, which per the docs is every real case today).
  const message = tx.message || tx.reason || tx.status_reason || tx.failure_reason ||
    d?.message || d?.data?.message || null;
  return {
    status: String(rawStatus).toLowerCase(),
    reference: tx.reference || tx.transaction_reference || null,
    message,
  };
}
// The real reason a MarzPay collection failed, on the rare/undocumented
// chance MarzPay ever actually supplies one on tx.message -- reuses
// marzUserMsg()'s own filter so an infrastructure complaint ("gateway
// timeout", "database error") never leaks to a member as if it were
// something about THEIR payment. Falls back to DEPOSIT_FAILED_MSG's own
// honest, cause-agnostic wording otherwise -- confirmed against MarzPay's
// own docs to be the normal case for every failed/cancelled collection,
// not a gap in this function.
function marzDepositFailureMsg(tx) {
  return marzUserMsg({ message: tx && tx.message }, DEPOSIT_FAILED_MSG);
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
// sending a wrong operator is worse than sending none. Soda stores the
// network as NETWORK_NAMES ('MTN Mobile Money' / 'Airtel Money') when the
// member picked one; when it did not, this returns null and the field is
// omitted from the payload so PesaJet resolves it itself.
//
// NOTE the prefix lists differ: PesaJet's SDK maps 77/78/76/79/39 -> mtn and
// 70/75/74 -> airtel, while Soda's own UGANDA_MOBILE_PREFIXES does not carry
// 39. Deliberately NOT reconciled by widening Soda's list -- that list
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
  return _settleDueInvestmentNow(doc);
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
      // Credit first with a deterministic per-investment payout token in the
      // same atomic user-document update. If the process stops after the
      // wallet write but before the investment cursor advances, the active
      // investment is retried and this token prevents a second credit. The
      // reverse order can permanently lose a maturity payout: the investment
      // becomes `matured` before the wallet write, so the active-only sweep
      // never sees it after a crash.
      const payoutKey = `${doc.id}:${newMade}`;
      let payoutBlocked = false;
      await withLock('bal:' + f.userId, async () => {
        if (amount > 0) {
          const userRef = db.collection('users').doc(f.userId);
          const applied = await userRef.updateIf(
            { creditedPayoutKeys: { $ne: payoutKey }, status: { $ne: 'banned' } },
            {
              walletBalance: FieldValue.increment(amount), totalEarned: FieldValue.increment(amount),
              creditedPayoutKeys: FieldValue.arrayUnion(payoutKey)
            }
          );
          if (!applied) {
            const check = await userRef.get();
            if (!check.exists) throw new Error(`Maturity payout ${payoutKey} could not be verified -- user ${f.userId} is missing.`);
            if (!(check.data().creditedPayoutKeys || []).includes(payoutKey)) {
              if (check.data().status === 'banned') { payoutBlocked = true; return; }
              throw new Error(`Maturity payout ${payoutKey} could not be verified.`);
            }
          }
          const { date, time } = nowStr();
          await db.collection('transactions').doc(`cashback:${payoutKey}`).createIfAbsent({
            userId: f.userId, statementId: newStatementId(), type: 'cashback', description: `${f.tierLabel} daily cashback`,
            amount, status: 'success', date, time, investmentId: doc.id, createdAt: FieldValue.serverTimestamp()
          });
        }
        // Keep this inside bal:<userId> too: recountAllTotals() re-reads its
        // source ledger while holding that same lock, so it cannot snapshot
        // between the wallet increment and this deterministic transaction row.
        // Advancing the cursor comes only after both are durable.
        await doc.ref.update({
          payoutsMade: newMade, paidOut: FieldValue.increment(amount),
          status: willComplete ? 'matured' : 'active'
        });
      });
      if (payoutBlocked) return;
      if (amount <= 0) return;
    });
    return true;
  } finally { _creditingPayouts.delete(doc.id); }
}
async function settleAllForUser(userId) {
  const snap = await db.collection('investments').where('userId', '==', userId).where('status', '==', 'active').get();
  // Was a sequential for-await loop -- harmless in the common case (nothing
  // due yet is pure math on the already-fetched doc, no I/O at all), but a
  // real, measurable slowdown for a member with several investments that all
  // became due the same day (e.g. a few assets bought around the same time,
  // all paying their daily figure together): each one paid its own ~4-round-
  // trip settlement one after another instead of together. Found while
  // investigating "statement download takes long on a powerful VPS" -- this
  // runs at the top of both /account and GET /statement/pdf, so every load
  // was paying that serial cost for exactly that member shape. Safe to run
  // in parallel: each investment settles under its OWN 'payout:<id>' lock
  // (see settleInvestmentIfDue()), and the actual wallet credit inside it is
  // separately, correctly serialized per-user via 'bal:<userId>' regardless
  // of how many callers reach it concurrently -- withLock() is a proper
  // promise-chain mutex per key, not a per-call one, so parallel investments
  // for the same user still queue safely at that one critical section.
  await Promise.all(snap.docs.map(doc => settleInvestmentIfDue(doc).catch(e => console.error('Settle error:', e.message))));
}

// ── REFERRAL COMMISSION (L1/L2/L3, first confirmed deposit) ──
// New accounts qualify on their first credited deposit. Legacy pending
// investment commissions retain their original entitlement at changeover.
// Each wallet credit and its idempotency token are written atomically;
// ledger and source markers are repaired on retry without paying twice.
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
  return _payReferralCommissionNow(investmentId, buyerId, amount);
}
async function creditDepositReferralCommission(depositId, buyerId) {
  return _payReferralCommissionNow(depositId, buyerId, 0, 'deposit');
}
async function _payReferralCommissionNow(investmentId, buyerId, amount, basis = 'investment') {
  const isDeposit = basis === 'deposit';
  // Keep commission linkage separate from the depositor's own ledger row.
  // Deposit status repair queries depositId and must never rewrite rewards.
  const sourceField = isDeposit ? 'referralDepositId' : 'investmentId';
  const eventKey = (isDeposit ? 'deposit:' : '') + investmentId;
  return withLock('comm:' + eventKey, async () => {
    let paidAny = false;
    const invRef = db.collection(isDeposit ? 'pendingDeposits' : 'investments').doc(investmentId);
    const invSnap = await invRef.get();
    if (!invSnap.exists) return paidAny;
    const source = invSnap.data();
    if (isDeposit) {
      // Only new deposit-based events participate. Historic deposits are not
      // retroactively paid, and provider success alone is not a wallet credit.
      if (source.commissionBasis !== 'deposit' || !source.walletCredited || !depositFullyCredited(source)) return false;
      amount = finiteMoney(source.amount);
    } else if (source.commissionBasis === 'deposit' || source.isFirstInvestment !== true) {
      await invRef.update({ commissionPending: false }); return paidAny;
    }
    const paidLevels = invSnap.data().commissionPaidLevels || [];

    const sett = await getSettings();
    const buyerSnap = await db.collection('users').doc(buyerId).get();
    if (!buyerSnap.exists) { await invRef.update({ commissionPending: false }); return paidAny; }
    if (isDeposit && buyerSnap.data().firstReferralDepositId !== investmentId) {
      await invRef.update({ commissionPending: false }); return false;
    }
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
    let chain = l1Id !== buyerId ? [{ id: l1Id, snap: l1Snap }] : [];
    const l2Id = l1Snap.exists ? l1Snap.data().referredBy : null;
    if (chain.length && l2Id && l2Id !== l1Id && l2Id !== buyerId) {
      const l2Snap = await db.collection('users').doc(l2Id).get();
      chain.push({ id: l2Id, snap: l2Snap });
      const l3Id = l2Snap.exists ? l2Snap.data().referredBy : null;
      if (l3Id && l3Id !== l2Id && l3Id !== l1Id && l3Id !== buyerId) {
        const l3Snap = await db.collection('users').doc(l3Id).get();
        chain.push({ id: l3Id, snap: l3Snap });
      }
    }
    let plan = source.commissionPlan;
    if (!Array.isArray(plan)) {
      plan = chain.map(({id}, i) => ({ id, reward: Math.max(0, Math.round(amount * (Number(rates[i]) || 0) / 100)) }));
      await invRef.update({ commissionPlan: plan });
    }
    chain = await Promise.all(plan.map(async item => ({ id: item.id, snap: await db.collection('users').doc(item.id).get() })));
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
      if (id === buyerId || chain.slice(0, i).some(parent => parent.id === id)) continue;
      // A referrer banned at this exact instant is a TEMPORARY block, not a
      // permanent forfeiture -- see the anyLevelBlockedByBan comment below.
      if (snap.data().status === 'banned') { anyLevelBlockedByBan = true; continue; }
      const reward = Number(plan[i].reward) || 0;
      if (reward <= 0) continue;
      // A level is not considered paid merely because we STARTED paying it.
      // Put a durable idempotency token beside the wallet increment in the
      // same atomic user-document update. If anything after this line fails,
      // a retry sees the token and repairs history/metadata without crediting
      // the wallet twice; if this update itself fails, nothing was claimed.
      const commissionKey = eventKey + ':' + i;
      const payeeRef = db.collection('users').doc(id);
      const applied = await withLock('bal:' + id, () => payeeRef.updateIf(
        { creditedCommissionKeys: { $ne: commissionKey }, status: { $ne: 'banned' } },
        {
          walletBalance: FieldValue.increment(reward),
          teamCommission: FieldValue.increment(reward),
          totalEarned: FieldValue.increment(reward),
          creditedCommissionKeys: FieldValue.arrayUnion(commissionKey),
        }
      ));
      if (!applied) {
        const check = await payeeRef.get();
        if (!check.exists) continue;
        if (!(check.data().creditedCommissionKeys || []).includes(commissionKey)) {
          if (check.data().status === 'banned') { anyLevelBlockedByBan = true; continue; }
          throw new Error('Referral credit could not be verified');
        }
      }
      // History is idempotent too. A retry after the wallet landed but this
      // insert failed must fill the missing row, not append a duplicate.
      const priorCommissionTx = await db.collection('transactions')
        .where('userId', '==', id)
        .where('type', '==', 'commission')
        .where(sourceField, '==', investmentId)
        .where('commissionLevel', '==', i)
        .limit(1).get();
      if (priorCommissionTx.empty) {
        const commissionTxId = `commission:${eventKey}:${i}:${id}`;
        await db.collection('transactions').doc(commissionTxId).createIfAbsent({
          userId: id, statementId: newStatementId(), type: 'commission', description: `Level ${i + 1} reward`,
          amount: reward, status: 'success', date, time, [sourceField]: investmentId, commissionLevel: i,
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
// Validate member sessions once before protected routes. A DB outage is 503,
// not a false expired-session response that signs out an active member.
app.use(async (req, res, next) => {
  if (!req.headers.authorization || req.path.startsWith('/admin/') || req.path.startsWith('/public/') || GUARD_EXEMPT.has(req.path)) return next();
  try { await _decodeAuth(req); next(); }
  catch (_) { res.status(503).json({ status:'error', message:'Session service unavailable. Try again.' }); }
});
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
    // "active"/"inactive" per member, for the All Referrals list -- whether
    // this downline member currently has a live investment running, the
    // one status a referrer actually cares about (an inactive member pays
    // no ongoing commission). One extra query against the target level's
    // own ids only, never per intermediate level.
    if (members.length) {
      const activeSnap = await db.collection('investments')
        .where('userId', 'in', members.map(m => m.id))
        .where('status', '==', 'active').get();
      const activeIds = new Set();
      activeSnap.forEach(d => activeIds.add(d.data().userId));
      members = members.map(m => ({ ...m, active: activeIds.has(m.id) }));
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
    // What each level has paid this member, for the three Level cards on the
    // Team screen. commissionLevel is 0-based (0 = Level 1) on every row.
    const levelCommission = { l1: 0, l2: 0, l3: 0 };
    try {
      const commSnap = await db.collection('transactions').where('userId', '==', userId).where('type', '==', 'commission').get();
      commSnap.forEach(d => {
        const v = d.data(), n = Number(v.commissionLevel);
        if (n >= 0 && n <= 2) levelCommission['l' + (n + 1)] += finiteMoney(v.amount);
      });
    } catch (_) { /* the cards then read 0.00; the rest of the stats still load */ }
    res.json({
      status: 'success',
      referralCode: u.referralCode || null,
      commRates: { l1: sett.commL1, l2: sett.commL2, l3: sett.commL3 },
      team: { l1: u.teamL1Count || 0, l2: u.teamL2Count || 0, l3: u.teamL3Count || 0 },
      totalTeam: (u.teamL1Count || 0) + (u.teamL2Count || 0) + (u.teamL3Count || 0),
      teamCommission: finiteMoney(u.teamCommission),
      teamDeposits: deposits, l1ActiveCount, milestones, teamRewards, levelCommission,
    });
  } catch (e) {
    console.error('Team stats error:', e.message);
    res.status(500).json({ status: 'error', message: 'Could not load team stats' });
  }
});
// The Task Center reward claim (/team/milestone/claim) is removed: no screen calls
// it and it paid money. Team progress is still reported by /team/stats.

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
// SSH out (see soda/CLAUDE.md's "Hosting" section), so the only direction
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
const DEPLOY_BRANCH = process.env.DEPLOY_BRANCH || 'claude/soda-build';
// The sparse checkout root (git lives here) vs. the actual soda/ app
// directory inside it (npm/pm2 commands run from here) -- see
// soda/CLAUDE.md's "Hosting" section for why these are two different
// directories on this VPS.
const DEPLOY_GIT_DIR = process.env.DEPLOY_GIT_DIR || '/srv/soda-src';
const DEPLOY_APP_DIR = process.env.DEPLOY_APP_DIR || (DEPLOY_GIT_DIR + '/soda');
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
    await runDeployCmd('pm2', ['reload', 'soda-server'], DEPLOY_APP_DIR);
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
    } });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
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
// /public/soda-images alone -- every admin-uploaded image travels as a
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
// The installed-app icon, as a real image file. Nothing in the app fetches
// this -- Chrome does, out of manifest.json at install time. Its URL is
// hard-coded in manifest.json and in index.html's <head>, so it must stay
// exactly what it is forever; changing a path here silently breaks the icon.
//
// Used to also serve a link-preview (og:image) card at a second slot, with
// its own admin toggle (linkPreviewEnabled) -- owner: "remove stuffs of
// link preview, here there will be no link preview." Removed entirely
// (the slot, the toggle, the admin upload UI, the og:image/twitter:image
// tags in index.html's <head>), not just switched off, per that request.
function serveBrandAsset(slot) {
  return async (req, res) => {
    try {
      const a = await getBrandAsset(slot);
      if (!a || !a.buf) return res.status(404).end();
      const etag = '"ba-' + slot + '-' + a.version + '"';
      // A manifest icon is a no-cors subresource load, which the global
      // same-site CORP default gates -- IP:port access during testing is
      // cross-site regardless of the real domain. Without this line the
      // browser drops the icon silently -- API calls keep working, so
      // nothing looks wrong except an install prompt with no icon on it.
      res.set('Cross-Origin-Resource-Policy', 'cross-origin');
      // Five minutes and revalidate: manifest.json and the og: tags are
      // static files with fixed hrefs, so the cache is the ONLY thing that
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
// The start-up loader's background, served as a real image (not JSON) so the
// browser can paint it from its own cache in the first frame of the next
// launch. stale-while-revalidate: it is painted from the cache at once and
// refreshed in the background, so it never delays the app; a re-upload
// shows on the open after next.
app.get('/public/loader-image', async (req, res) => {
  try {
    const image = await getSodaImage('loaderbg');
    const m = /^data:(image\/(?:png|jpe?g|webp|gif));base64,(.+)$/.exec(image || '');
    if (!m) return res.status(404).end();
    const buf = Buffer.from(m[2], 'base64');
    const etag = '"' + crypto.createHash('sha1').update(buf).digest('hex') + '"';
    res.set({ 'Content-Type': m[1], 'Cache-Control': 'public, max-age=0, stale-while-revalidate=604800', ETag: etag });
    if (req.headers['if-none-match'] === etag) return res.status(304).end();
    res.send(buf);
  } catch (e) { res.status(500).end(); }
});
// Soda artwork needed by the current member surfaces, fetched together.
app.get('/public/soda-images', async (req, res) => {
  try {
    const [logo, authhero, banner2, banner3, checkinbanner, profilelogo] = await Promise.all([
      getSodaImage('logo'),
      getSodaImage('authhero'), getSodaImage('banner2'),
      getSodaImage('banner3'), getSodaImage('checkinbanner'), getSodaImage('profilelogo'),
    ]);
    publicJson(req, res, { status: 'success', logo, authhero, banner2, banner3, checkinbanner, profilelogo }, IMAGE_CACHE);
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
// Lazy-loaded only when a member actually opens the About page -- not part
// of /public/settings, see getAboutContent()'s own comment for why.
app.get('/public/about-content', async (_req, res) => {
  try { res.json({ status: 'success', blocks: await getAboutContent() }); }
  catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
app.get('/public/rules-content', async (_req, res) => {
  try { res.json({ status: 'success', blocks: await getRulesContent() }); }
  catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});

// ═══════════════════════════════════════════
// REGISTRATION / ACCOUNT
// ═══════════════════════════════════════════
// A 6-digit trade password, per Soda's registration spec (Snow used 5) —
// rejects the weakest shape
// (all-same-digit) whenever a NEW PIN is being chosen, never when an
// existing one is being verified.
function isWeakPin(pin) { return /^(\d)\1{5}$/.test(String(pin || '')); }

// `regionKey` is stamped here, ONCE, from the region that owns the hostname
// the account was created on, and is never written again. Everything the
// member ever sees or is charged -- currency, product prices, minimums,
// withdraw hours, their number's shape -- is read from it for the life of
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
  const phone = auth.phone;
  if (!phone) return res.status(400).json({ status: 'error', message: 'Sign in with your Soda phone account.' });
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
    const userSnap = await userRef.get();
    // A freshly-created doc's data is already known -- it's the exact
    // object we're about to write ourselves -- so there's no need to read
    // it back from Mongo a second time. Safe because the 'reg:'+userId
    // lock is held for the rest of this function, so nothing else can
    // touch this doc in between.
    let userData;
    if (!userSnap.exists) {
      userData = defaultProfileDoc(phone);
      await userRef.set(userData);
    } else {
      userData = userSnap.data();
    }
    if (userData.status === 'banned') return { code: 403, body: { status: 'error', code: 'BANNED', message: 'Account suspended. Contact customer service.' } };
    if (userData.registrationDone)
      return { code: 200, body: { status: 'already_done', referralCode: userData.referralCode || null } };

    // Registration saves the six-digit Trade Password as a server-side
    // scrypt hash. It is never returned to the client.
    const tradePin = String(pin || '');
    if (!/^\d{6}$/.test(tradePin))
      return { code: 400, body: { status: 'error', code: 'INVALID_TRADE_PIN', message: 'Trade Password must be exactly 6 digits.' } };
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
      if (String(refDoc.data().regionKey || DEFAULT_REGION_KEY) !== DEFAULT_REGION_KEY)
        return { code: 400, body: { status: 'error', code: 'BAD_REFERRAL_REGION', message: 'This referral code is unavailable. Ask for a Uganda referral code.' } };
      referrerId = refDoc.id;
    }

    const [myRefCode, myPublicId] = await Promise.all([generateUniqueReferralCode(userId), nextSequentialPublicId()]);
    const sett = await getSettings();
    const WELCOME = Number(sett.welcomeBonus) || 0;
    const commit = async () => {
      let refData = null;
      if (referrerId) {
        const refCheck = await db.collection('users').doc(referrerId).get();
        if (!refCheck.exists || refCheck.data().status === 'banned') referrerId = null;
        else refData = refCheck.data();
      }
      const update = {
        registrationDone: true, referralCode: myRefCode, publicId: myPublicId,
        walletBalance: FieldValue.increment(WELCOME),
      };
      if (/^\d{6}$/.test(tradePin)) update.transactionPinHash = scryptHash(tradePin);
      if (referrerId) update.referredBy = referrerId;
      // The user's own doc is written FIRST, in one atomic single-document
      // update — a crash right after this leaves the member fully and
      // correctly paid and marked done; a retry hits registrationDone above
      // and stops. Referrer team-count increments run AFTER on purpose (see
      // the same pattern space8 uses) so a crash here can only under-count,
      // never double-count on a retry.
      await userRef.update(update);
      if (referrerId) {
        // referrerId's own referredBy (= L2's id) is already sitting in
        // refData from the fetch above, under this same referrer-guard
        // lock -- re-fetching the identical document a moment later just
        // to read that one field back was a wasted round trip. L1's own
        // count increment and L2's count increment + discovery read
        // (needed to find L3) touch three different documents with
        // nothing depending on each other, so they now run together
        // instead of one after another; only L3 genuinely has to wait,
        // since its id isn't known until L2's own doc comes back.
        const l2Id = refData ? refData.referredBy : null;
        const tasks = [db.collection('users').doc(referrerId).update({ teamL1Count: FieldValue.increment(1) })];
        if (l2Id && l2Id !== referrerId) {
          tasks.push(db.collection('users').doc(l2Id).update({ teamL2Count: FieldValue.increment(1) }));
          tasks.push(db.collection('users').doc(l2Id).get());
        }
        const results = await Promise.all(tasks);
        if (l2Id && l2Id !== referrerId) {
          const l2Snap = results[2];
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
        userId, statementId: newStatementId(), type: 'welcome_bonus', description: 'Welcome gift',
        amount: WELCOME, status: 'success', date, time, createdAt: FieldValue.serverTimestamp()
      });
    }
    return { code: 200, body: { status: 'success', referrerId, welcomeBonus: WELCOME, referralCode: myRefCode, publicId: myPublicId } };
  });
}
// ── OTP endpoints ──
// /auth/otp/send is deliberately reachable WITHOUT a Firebase session for
// 'reset' -- a phone verifying itself while its owner cannot sign in -- is
// exactly what OTP is for. 'bank' requires a session:
// the phone texted is resolved from the caller's own account on file, never
// from the request body, so a logged-in member cannot use this to spam an
// arbitrary number.
app.post('/auth/otp/send', async (req, res) => {
  try {
    const purpose = String(req.body.purpose || '');
    if (!OTP_PURPOSES.has(purpose)) return res.status(400).json({ status: 'error', message: 'Invalid verification purpose' });
    // The master switch turns off OTP requests for saving a payout account.
    // Password reset keeps asking for a code regardless: it hands an existing
    // account to whoever asks, and the code is the only proof it is them.
    const sett = await getSettings();
    if (sett.otpVerificationEnabled === false && purpose !== 'reset') {
      return res.status(503).json({ status: 'error', code: 'OTP_DISABLED', message: 'Verification codes are turned off right now.' });
    }
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
      const existing = purpose === 'reset'
        ? await db.collection('users').where('phone', '==', phone).where('registrationDone', '==', true).limit(1).get()
        : await db.collection('users').where('phone', '==', phone).limit(1).get();
      // 'register' checks registrationDone specifically, not just any row --
      // a Mongo profile can exist with registrationDone:false from an earlier
      // attempt that crashed between Firebase account creation and finishing
      // /register (the same "ghost account" doRegister()'s own comment
      // already handles). Blocking THAT here would wrongly refuse a member
      // simply retrying their own incomplete signup.
      if (purpose === 'register' && existing.docs.some(d => d.data().registrationDone))
        return res.status(400).json({ status: 'error', message: 'An account with this phone number already exists.' });
      if (purpose === 'reset' && !existing.docs.some(d => d.data().registrationDone))
        return res.status(400).json({ status: 'error', message: 'No account found with this phone number.' });
    }
    if (!MARZSMS_KEY) return res.status(503).json({ status: 'error', message: 'SMS verification is not available right now. Try again later.' });
    const countedDay = await otpCheckAndBumpDailyLimit(phone, purpose);
    if (!countedDay) return res.status(429).json({ status: 'error', message: 'Too many verification codes requested for this number today. Try again tomorrow.' });
    const code = generateOtpCode();
    const otpRef = db.collection('otpCodes').doc();
    // The member cannot type the code before this response arrives, so the
    // database write and the SMS hand-off do not need to run one after the
    // other -- both start now and the response waits for whichever is slower
    // instead of for their sum.
    const [saved, sent] = await Promise.allSettled([
      otpRef.set({
        phone, purpose, codeHash: scryptHash(code), attempts: 0, verified: false,
        ticket: null, ticketExpiresAt: null, consumedAt: null,
        expiresAt: new Date(Date.now() + OTP_EXPIRES_MS), createdAt: FieldValue.serverTimestamp(),
      }),
      marzSmsSend(phone, otpSmsText(code, sett, req)),
    ]);
    if (sent.status === 'rejected') {
      await otpRef.delete().catch(() => {});
      await otpRefundDailyLimit(phone, purpose, countedDay);
      throw sent.reason;
    }
    // The text went out but there is no record to check it against: the code
    // is useless, so remove any partial row and ask for a fresh one. No
    // refund here -- the SMS was really sent and really billed.
    if (saved.status === 'rejected') {
      await otpRef.delete().catch(() => {});
      throw saved.reason;
    }
    res.json({ status: 'success', otpId: otpRef.id, expiresInSec: OTP_EXPIRES_MS / 1000 });
  } catch (e) {
    console.error('OTP send error:', e.message);
    res.status(500).json({ status: 'error', message: 'We could not send the code just now. Please try again in a moment.' });
  }
});
app.post('/auth/otp/verify', async (req, res) => {
  try {
    const otpId = String(req.body.otpId || '');
    const code = String(req.body.code || '').trim();
    if (!otpId || otpId.length > 100 || !/^\d{6}$/.test(code)) return res.status(400).json({ status: 'error', message: 'Enter the 6-digit verification code.' });
    await withLock('otp:' + otpId, async () => {
      const ref = db.collection('otpCodes').doc(otpId);
      const snap = await ref.get();
      if (!snap.exists) return res.status(400).json({ status: 'error', message: 'Invalid or expired code. Request a new one.' });
      const o = snap.data(), now = Date.now();
      if (o.consumedAt) return res.status(400).json({ status: 'error', message: 'This code has already been used.' });
      if (!(tsMillis(o.expiresAt) > now)) return res.status(400).json({ status: 'error', message: 'This code has expired. Request a new one.' });
      if ((o.attempts || 0) >= OTP_MAX_ATTEMPTS) return res.status(429).json({ status: 'error', message: 'Too many incorrect attempts. Request a new code.' });
      // Reserve an attempt atomically before checking the hash.
      const attempted = await ref.updateIf({ consumedAt: null, attempts: { $lt: OTP_MAX_ATTEMPTS } }, { attempts: FieldValue.increment(1) });
      if (!attempted) return res.status(429).json({ status: 'error', message: 'Code unavailable. Request a new code.' });
      if (!scryptVerify(code, o.codeHash)) return res.status(400).json({ status: 'error', message: 'Incorrect code.' });
      if (o.verified && o.ticket && tsMillis(o.ticketExpiresAt) > now)
        return res.json({ status: 'success', ticket: o.ticket, expiresInSec: Math.ceil((tsMillis(o.ticketExpiresAt) - now) / 1000) });
      const ticket = crypto.randomUUID();
      const stored = await ref.updateIf({ consumedAt: null, ticket: o.ticket || null }, { verified: true, ticket, ticketExpiresAt: new Date(now + OTP_TICKET_EXPIRES_MS) });
      if (!stored) return res.status(409).json({ status: 'error', message: 'Verification changed. Please try again.' });
      res.json({ status: 'success', ticket, expiresInSec: OTP_TICKET_EXPIRES_MS / 1000 });
    });
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
    // Password reset always needs its OTP ticket (checked below), whatever the
    // master OTP switch says -- see /auth/otp/send.
    const phone = cleanPhone(req.body.phone || '');
    if (!phone) return res.status(400).json({ status: 'error', message: badPhoneMessage() });
    const newPassword = String(req.body.newPassword || '');
    if (newPassword.length < 6) return res.status(400).json({ status: 'error', message: 'Password must be at least 6 characters.' });
    const ticketOk = await consumeOtpTicket(String(req.body.ticket || ''), phone, 'reset');
    if (!ticketOk) return res.status(400).json({ status: 'error', code: 'OTP_REQUIRED', message: 'Please verify your phone number first.' });
    const uSnap = await db.collection('users').where('phone', '==', phone).where('registrationDone', '==', true).limit(1).get();
    if (uSnap.empty) return res.status(404).json({ status: 'error', message: 'No account found with this phone number.' });
    const userId = uSnap.docs[0].id;
    await setMemberPassword(userId, newPassword);
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
    const phone = auth.phone;
    if (!phone) return res.status(400).json({ status: 'error', message: badPhoneMessage() });
    // Skip the ticket check on a retry of an ALREADY-completed registration
    // (network drop after success, client resubmits) -- completeRegistrationCore
    // is idempotent for that case on its own (registrationDone short-circuit
    // below), and the ticket from the original successful call is already
    // consumed, so requiring it again would fail a registration that in fact
    // already succeeded.
    const already = await db.collection('users').doc(userId).get();
    if (!already.exists || !already.data().registrationDone) {
      const tradePin = String(req.body.pin || '');
      if (!/^\d{6}$/.test(tradePin)) return res.status(400).json({ status: 'error', code: 'INVALID_TRADE_PIN', message: 'Trade Password must be exactly 6 digits.' });
    }
    const result = await completeRegistrationCore(userId, req.body.referralCode, req.body.pin, phone);
    const { referrerId, ...memberBody } = result.body;
    res.status(result.code).json(memberBody);
  } catch (e) {
    console.error('Register error:', e.message);
    res.status(500).json({ status: 'error', message: 'Could not complete your registration right now' });
  }
});
// VIP level = the highest VIP number among the assets the member owns (bought or
// given by the admin, running or finished). Read from the live asset list, so
// changing an asset's VIP in the admin panel applies to current owners too.
async function memberVipLevel(userId) {
  const [snap, products] = await Promise.all([
    db.collection('investments').where('userId', '==', userId).get(),
    getProducts(),
  ]);
  const vipByKey = new Map(products.filter(p => !p.deleted).map(p => [p.key, Number(p.vip) || 0]));
  let best = 0;
  snap.forEach(d => { best = Math.max(best, vipByKey.get(d.data().tierKey) || 0); });
  return best;
}
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
    if (preSnap.data().registrationDone === false) return res.status(409).json({ status: 'error', code: 'REGISTRATION_REQUIRED', message: 'Please finish signing up and verify your phone.' });
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
    const vipLevel = await memberVipLevel(uid).catch(() => 0);
    res.json({ status: 'success', account: {
      phone: u.phone, walletBalance: round2(u.walletBalance), totalDeposited: u.totalDeposited || 0,
      totalEarned: round2(u.totalEarned), totalWithdrawn: u.totalWithdrawn || 0, totalInvested: u.totalInvested || 0,
      checkinStreak: u.checkinStreak || 0, lastCheckinAt: u.lastCheckinAt || null,
      referralCode: u.referralCode || null, publicId: u.publicId || null, registrationDone: !!u.registrationDone,
      hasTradePin: !!u.transactionPinHash, vipLevel,
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
// The daily check-in claim (/checkin) is removed: no screen calls it and it paid money.

// ═══════════════════════════════════════════
// TURNTABLE (daily spin wheel)
// ═══════════════════════════════════════════
// A Soda-only feature -- Snow has no equivalent, so none of this is a port.
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
          userId: uid, statementId: newStatementId(), type: 'turntable', description: label, amount: reward,
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
      // Per-member purchase limit (admin-set per asset; 0 = none). Counted inside the
      // balance lock, from the investments themselves, so two quick taps cannot both pass.
      const limit = Number(liveTier.buyLimit) || 0;
      if (limit > 0) {
        const ownedSnap = await db.collection('investments').where('userId', '==', userId).where('tierKey', '==', liveTier.key).get();
        if (ownedSnap.size >= limit) {
          const limErr = new Error(`You can own at most ${limit} of this asset and already have ${ownedSnap.size}.`);
          limErr.code = 'PURCHASE_LIMIT';
          throw limErr;
        }
      }
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
          isFirstInvestment, commissionBasis: 'deposit', commissionPaidLevels: [], commissionPending: false,
          date, time, createdAt: FieldValue.serverTimestamp()
        });
        await db.collection('transactions').add({
          userId, statementId: newStatementId(), type: 'investment', description: `Bought ${liveTier.name}`, amount: -liveTier.price,
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
    // Referral commission belongs to the first confirmed deposit. A spin is
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
  const amt = paymentAmount(req.body.amount);
  if (isNaN(amt) || amt <= 0) return res.status(400).json({ status: 'error', message: 'Invalid amount' });
  if (amt > MAX_MONEY_AMOUNT) return res.status(400).json({ status: 'error', message: `Amount is too large (max ${fmtMoney(MAX_MONEY_AMOUNT)}).` });
  try {
    const [uSnap, sett] = await Promise.all([db.collection('users').doc(userId).get(), getSettings()]);
    if (!uSnap.exists) return res.status(404).json({ status: 'error', message: 'User not found' });
    if (uSnap.data().status === 'banned') return res.status(403).json({ status: 'error', code: 'BANNED', message: 'Account suspended. Contact customer service.' });
    if (_userBeingDeleted.has(userId)) return res.status(400).json({ status: 'error', message: 'This account is currently being processed. Try again shortly.' });
    if (uSnap.data().registrationDone === false) return res.status(403).json({ status: 'error', code: 'REGISTRATION_REQUIRED', message: 'Finish signing up before topping up.' });
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
      return res.status(429).json({ status: 'error', message: 'A recharge is already being processed. Please wait a moment.' });

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
      commissionBasis: 'deposit', commissionPending: true, commissionPaidLevels: [],
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
      userId, statementId: newStatementId(), type: 'deposit', description: `Deposit: Processing (${fmtMoney(amt)})`,
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
  const userId = depDoc && depDoc.data() && depDoc.data().userId;
  const credited = await _creditDepositNow(depDoc);
  if (credited) await creditDepositReferralCommission(depDoc.id, userId).catch(e => console.error('Deposit commission error:', e.message));
  return credited;
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
        await depDoc.ref.update({ status: 'matched', needsManualCredit: true, creditedAt: FieldValue.serverTimestamp() });
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
          const applied = await withLock('bal:' + depUserId, async () => {
            const userRef = db.collection('users').doc(depUserId);
            const user = await userRef.get();
            const referral = {};
            if (fd.commissionBasis === 'deposit' && user.exists && finiteMoney(user.data().totalDeposited) === 0 && !user.data().firstReferralDepositId) {
              // Preserve existing first-investment commissions across the
              // changeover. Buying a new asset never creates a second bonus.
              const legacy = await db.collection('investments').where('userId', '==', depUserId).where('isFirstInvestment', '==', true).get();
              const alreadyQualified = legacy.docs.some(d => {
                const inv = d.data();
                return inv.commissionBasis !== 'deposit' && (inv.commissionPending === true || (inv.commissionPaidLevels || []).length > 0);
              });
              if (!alreadyQualified) referral.firstReferralDepositId = depDoc.id;
            }
            return userRef.updateIf({ creditedDepositIds: { $ne: depDoc.id } }, {
              walletBalance: FieldValue.increment(depAmount), totalDeposited: FieldValue.increment(depAmount),
              creditedDepositIds: FieldValue.arrayUnion(depDoc.id), ...referral,
            });
          });
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
          await depDoc.ref.update({ walletCredited: true });
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
            userId: depUserId, statementId: newStatementId(), type: 'deposit', description: `Deposit: Success (${fmtMoney(depAmount)})`,
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
      // Names the member so the alert is useful on a lock screen; the lookup is
      // best-effort and never delays or blocks the credit that already happened.
      db.collection('users').doc(String(dep.userId)).get().then(u => {
        const who = u.exists && u.data().phone ? ' by ' + u.data().phone : '';
        return sendAdminPush('Deposit completed', `${fmtMoney(creditedAmount)} credited${who || ' to a wallet'}`, { type: 'deposit', depositId: depDoc.id });
      }).catch(() => sendAdminPush('Deposit completed', `${fmtMoney(creditedAmount)} credited to a wallet`, { type: 'deposit', depositId: depDoc.id })).catch(() => {});
    }
    return credited;
  } finally { _creditingDeposits.delete(depDoc.id); }
}

// ── USDT (TRC20) DEPOSIT ──
// A third deposit rail alongside the automatic MarzPay mobile-money flow
// above -- that flow (and its instant crediting) is completely untouched
// by any of this. The member sends USDT to the admin's own wallet address
// OUTSIDE this app, then submits the transaction hash here.
//
// Every claim is filed as 'awaiting_verification' first (a value nothing
// else in this file's money logic switches on -- depositFullyCredited()
// only ever checks for 'matched', so introducing a new pre-credit status
// here is safe by construction). If TRONGRID_API_KEY is configured, a
// background check against the real TRON blockchain (verifyUsdtTx below)
// runs right after filing, and again on every 30s reconciler sweep for
// anything still unresolved -- a clean, unambiguous match (right
// contract, right destination address, amount at least what was claimed,
// confirmed on-chain) auto-credits it via the exact same claim-before-
// credit creditDeposit() every other deposit path on this platform uses,
// so this never adds a second way to move money, only a second way to
// DECIDE to. A conclusively wrong claim is declined through the same
// markDepositFailed() every other deposit path uses too (Soda's own
// hardened version -- locked, checks for a concurrent credit before
// overwriting, flips the ledger row, zeroes displayAmount correctly --
// not a bespoke status write). Anything inconclusive (no key configured,
// TronGrid down, no match yet) is never rejected -- it just stays
// awaiting_verification for the admin's own Approve (force-credit,
// already exists)/Reject (new, below) in the Deposits tab.
const TRONGRID_BASE = 'https://api.trongrid.io';
const TRONGRID_API_KEY = process.env.TRONGRID_API_KEY || '';
const TRONGRID_TIMEOUT = 15000;
// The one, official USDT TRC20 contract on TRON mainnet -- matches the
// "Contract Information ...jLj6t" every real TRC20 wallet shows on its own
// Deposit USDT screen. Hardcoded (not admin-settable): accepting transfers
// of a DIFFERENT token to the same address must never be treated as if it
// were real USDT.
const USDT_TRC20_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
// TRON/TRC20 addresses show up in at least three different textual forms
// depending on which part of TronGrid's response they came from: base58check
// ("T...", what every wallet app and our own settings field use), TRON hex
// ("41" + 20-byte hash), or bare EVM-style hex ("0x" + 20-byte hash, the
// same 20-byte hash TRON reuses from Ethereum's address derivation).
// Comparing two addresses for equality only works if they're both reduced
// to that shared 20-byte core first -- a naive direct string comparison
// between a base58 address and TronGrid's hex-formatted event data would
// NEVER match, silently making auto-verification never fire (safe, since
// it just falls back to manual review either way, but pointless). Only the
// DECODE direction is needed (never re-encode to base58), so this is a
// plain big-integer base58 decode -- no external library required.
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58Decode(str) {
  let num = 0n;
  for (const ch of str) {
    const idx = BASE58_ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error('Invalid base58 character');
    num = num * 58n + BigInt(idx);
  }
  let hex = num.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  let leadingZeros = 0;
  for (const ch of str) { if (ch === '1') leadingZeros++; else break; }
  return '00'.repeat(leadingZeros) + hex;
}
function addrCore(addr) {
  addr = String(addr || '').trim();
  if (!addr) return '';
  if (addr.startsWith('0x') || addr.startsWith('0X')) addr = addr.slice(2);
  if (/^[0-9a-fA-F]+$/.test(addr) && addr.length >= 40) {
    let hex = addr.toLowerCase();
    if (hex.length === 42 && hex.startsWith('41')) hex = hex.slice(2);
    return hex.length === 40 ? hex : '';
  }
  try {
    let full = base58Decode(addr);
    if (full.length < 50) full = full.padStart(50, '0');
    const body = full.slice(0, full.length - 8); // strip the 4-byte (8 hex char) checksum
    const core = body.length === 42 && body.startsWith('41') ? body.slice(2) : body;
    return core.length === 40 ? core.toLowerCase() : '';
  } catch (_) { return ''; }
}
// Distinguishes two very different kinds of "not verified":
//   conclusive:true  -- the transaction WAS found confirmed on-chain, but it
//                        plainly isn't a valid payment to us (wrong token,
//                        wrong destination, or short of the claimed amount).
//                        The blockchain itself proves this claim is wrong --
//                        safe to decline immediately, no waiting needed.
//   conclusive:false -- nothing usable came back yet (TronGrid has no record
//                        of this txid at all, or the request itself failed).
//                        This does NOT prove the claim is wrong -- a real
//                        transaction can simply not have confirmed yet, or
//                        TronGrid can be having a bad moment. Must be
//                        retried, never declined outright.
// opts (new-style claims, see /deposit/usdt/intent): { exactMicros, notBeforeMs }.
// A claim made from a payment request must match its unique amount to the last
// digit and must have been sent after the request was made -- that is what
// stops one member claiming a payment another member sent (a TXID is public).
// Older claims (no opts) keep the previous rule: at least the claimed amount.
async function verifyUsdtTx(txid, expectWalletAddress, expectAmountUsdt, opts = {}) {
  if (!TRONGRID_API_KEY) return { verified: false, conclusive: false, reason: 'TRONGRID_API_KEY not configured' };
  if (!expectWalletAddress) return { verified: false, conclusive: false, reason: 'No receiving wallet address configured' };
  try {
    const resp = await fetch(`${TRONGRID_BASE}/v1/transactions/${txid}/events?only_confirmed=true`, {
      signal: AbortSignal.timeout(TRONGRID_TIMEOUT),
      headers: { 'TRON-PRO-API-KEY': TRONGRID_API_KEY }
    });
    if (!resp.ok) return { verified: false, conclusive: false, reason: `TronGrid HTTP ${resp.status}` };
    const d = await resp.json().catch(() => null);
    const events = d && Array.isArray(d.data) ? d.data : null;
    if (!events) return { verified: false, conclusive: false, reason: 'Unexpected TronGrid response shape' };
    if (events.length === 0) return { verified: false, conclusive: false, reason: 'Not confirmed on-chain yet' };
    const expectCore = addrCore(expectWalletAddress);
    const contractCore = addrCore(USDT_TRC20_CONTRACT);
    const toUs = events.filter(e =>
      e && e.event_name === 'Transfer' &&
      addrCore(e.contract_address) === contractCore &&
      e.result && addrCore(e.result.to) === expectCore && expectCore !== ''
    );
    // Something DID confirm under this txid, it just isn't a matching USDT
    // payment to our wallet (wrong token, wrong recipient, or not a
    // Transfer at all) -- the chain itself proves this one is wrong.
    if (!toUs.length) return { verified: false, conclusive: true, reason: 'The confirmed transaction is not a matching USDT transfer to our wallet' };
    const exact = opts.exactMicros != null ? BigInt(opts.exactMicros) : null;
    let transfer = toUs[0];
    if (exact !== null) {
      const valueOf = e => { try { return BigInt(String(e.result.value)); } catch (_) { return null; } };
      transfer = toUs.find(e => valueOf(e) === exact);
      if (!transfer) return { verified: false, conclusive: true, reason: `The confirmed amount does not match the exact amount of this request (${usdtMicrosText(opts.exactMicros)} USDT). Start a new request and send exactly the amount shown.` };
      const when = Number(transfer.block_timestamp);
      if (!Number.isFinite(when) || when <= 0) return { verified: false, conclusive: false, reason: 'TronGrid gave no block time for this transfer' };
      if (opts.notBeforeMs && when < opts.notBeforeMs)
        return { verified: false, conclusive: true, reason: 'This transfer was sent before the payment request was made, so it cannot be used for it.' };
      return { verified: true, onChainAmount: Number(exact) / 1e6 };
    }
    // USDT on TRON has 6 decimals -- the raw on-chain value is an integer.
    const onChainAmount = Number(transfer.result.value) / 1e6;
    if (!isFinite(onChainAmount)) return { verified: false, conclusive: false, reason: 'Could not parse on-chain amount' };
    // The member could only ever be credited the AMOUNT THEY CLAIMED (that's
    // what the UGX figure on the record was computed from) -- so it's only
    // ever safe to auto-credit when the real on-chain payment is at least
    // that much. A genuine shortfall must never round up to a match, but it
    // IS confirmed and conclusive -- the member sent less than they claimed.
    if (onChainAmount < expectAmountUsdt - 0.000001)
      return { verified: false, conclusive: true, reason: `The confirmed on-chain amount (${onChainAmount} USDT) is less than the ${expectAmountUsdt} USDT claimed` };
    return { verified: true, onChainAmount };
  } catch (e) {
    return { verified: false, conclusive: false, reason: e.message };
  }
}
// 123456789 micro-USDT -> "123.456789"
function usdtMicrosText(m) { const t = String(m).padStart(7, '0'); return t.slice(0, -6) + '.' + t.slice(-6); }
// How long an INCONCLUSIVE claim (TronGrid simply has no record of it yet)
// is allowed to keep waiting before the reconciler gives up and declines it
// -- guarantees every claim eventually reaches a definitive completed/
// declined outcome on its own, never sitting unresolved forever. Real
// transactions confirm on TRON within seconds to low minutes, so 15 minutes
// is a generous margin, not a tight one.
const USDT_UNRESOLVED_TIMEOUT_MS = 15 * 60 * 1000;
// The transaction hash itself is the database identity for new USDT claims.
// A "query for this TXID, then insert a random document" sequence is not
// atomic: two accounts can both see no row and submit the same on-chain
// payment at the same instant. createIfAbsent() on this deterministic id
// gives MongoDB one atomic winner even across overlapping server processes.
// Failed claims may still be corrected and resubmitted by conditionally
// replacing that same document while its status is exactly `failed`.
function usdtDepositDocId(txid) { return 'usdt:' + txid; }
// The one function that decides a USDT claim's fate -- used by the
// synchronous check-loop at submit time, the client's own status poll, and
// the 30s reconciler sweep, so there is exactly one path that can ever move
// a claim out of 'awaiting_verification', not three slightly different ones.
async function resolveUsdtDeposit(depositId) {
  try {
    const snap = await db.collection('pendingDeposits').doc(depositId).get();
    if (!snap.exists || snap.data().status !== 'awaiting_verification') return { outcome: 'unchanged' };
    const dep = snap.data();
    const result = await verifyUsdtTx(dep.txid, dep.walletAddress, dep.amountUsdt,
      dep.exactMicros ? { exactMicros: dep.exactMicros, notBeforeMs: Number(dep.intentCreatedMs) ? Number(dep.intentCreatedMs) - USDT_CLOCK_SKEW_MS : undefined } : {});
    if (result.verified) {
      // autoVerified is set BEFORE the credit for the same claim-before-credit
      // reason as everywhere else -- if this update lands but the credit call
      // below fails, the retry sees autoVerified already true and simply
      // proceeds straight to creditDeposit() again (idempotent) rather than
      // re-running the on-chain check.
      await snap.ref.update({ autoVerified: true, onChainAmountUsdt: result.onChainAmount }).catch(() => {});
      const ok = await creditDeposit(snap);
      if (ok) console.log(`USDT deposit ${depositId} auto-credited (on-chain confirmed).`);
      return { outcome: ok ? 'matched' : 'unchanged' };
    }
    if (result.conclusive) {
      await markDepositFailed(snap.ref, dep.userId, result.reason);
      await snap.ref.update({ autoDeclined: true }).catch(() => {});
      console.log(`USDT deposit ${depositId} auto-declined (on-chain proof): ${result.reason}`);
      return { outcome: 'rejected', reason: result.reason };
    }
    // Inconclusive -- only give up and decline once it's been unresolved for
    // longer than any real confirmation should ever take. Gated on a key
    // actually being configured: with none set, automatic mode isn't
    // active at all (pure-manual behavior), so nothing should ever
    // auto-decline on a timer -- it just waits for an admin, exactly as if
    // this whole feature didn't exist.
    if (TRONGRID_API_KEY && Date.now() - tsMillis(dep.createdAt) > USDT_UNRESOLVED_TIMEOUT_MS) {
      const reason = 'Could not confirm this transaction on-chain. Please check the TXID or contact support.';
      await markDepositFailed(snap.ref, dep.userId, reason);
      await snap.ref.update({ autoDeclined: true }).catch(() => {});
      console.log(`USDT deposit ${depositId} auto-declined (unresolved past ${USDT_UNRESOLVED_TIMEOUT_MS / 60000} min): ${result.reason}`);
      return { outcome: 'rejected', reason };
    }
    console.log(`USDT auto-verify not yet resolved for ${depositId}: ${result.reason}`);
    return { outcome: 'pending', reason: result.reason };
  } catch (e) {
    console.error(`USDT resolve error for ${depositId}:`, e.message);
    return { outcome: 'pending', reason: e.message };
  }
}
// ── PAYMENT REQUESTS (the fix for TXID hijacking) ──
// A transaction hash is public the moment it is on-chain, and the old flow
// credited whoever submitted it first, so anyone watching the wallet could
// claim another member's payment. Now a member first asks for a payment
// request: the server reserves a UNIQUE exact amount for them (their amount
// plus a random 1-999 micro-USDT tail, e.g. 25.000417) and only a transfer of
// exactly that amount, sent after the request was made, can be credited to
// that request's owner. Nobody else can hold the same amount at the same time.
// The reservation is the document id (the exact micro-USDT figure), so two
// requests can never share an amount; an expired one is reclaimed atomically.
const USDT_INTENT_TTL_MS = 60 * 60 * 1000;
const USDT_MAX_OPEN_INTENTS = 3;
const USDT_OFFSET_MAX = 999;
const USDT_CLOCK_SKEW_MS = 30 * 1000;
const _usdtIntentDebounce = new Map();
async function allocateUsdtIntent(userId, baseCents, extra) {
  const col = db.collection('usdtIntents');
  for (let attempt = 0; attempt < 15; attempt++) {
    const micros = baseCents * 10000 + crypto.randomInt(1, USDT_OFFSET_MAX + 1);
    const now = Date.now();
    const doc = { userId, baseUsdt: baseCents / 100, exactMicros: micros, status: 'open', createdMs: now,
      createdAt: FieldValue.serverTimestamp(), expiresAt: new Date(now + USDT_INTENT_TTL_MS), ...extra };
    const ref = col.doc(String(micros));
    if (await ref.createIfAbsent(doc)) return { id: ref.id, ...doc };
    // Taken. Reclaimable only if it has expired; the condition makes the
    // takeover atomic, so two requests cannot both win the same amount.
    const reclaimed = await ref.updateIf({ expiresAt: { $lt: new Date() } }, { ...doc, txid: FieldValue.delete() });
    if (reclaimed) return { id: ref.id, ...doc };
  }
  return null;
}
app.post('/deposit/usdt/intent', async (req, res) => {
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Please sign in again' });
  try {
    const [uSnap, sett] = await Promise.all([db.collection('users').doc(userId).get(), getSettings()]);
    if (!uSnap.exists) return res.status(404).json({ status: 'error', message: 'User not found' });
    if (uSnap.data().status === 'banned') return res.status(403).json({ status: 'error', code: 'BANNED', message: 'Account suspended. Contact customer service.' });
    if (uSnap.data().registrationDone === false) return res.status(403).json({ status: 'error', code: 'REGISTRATION_REQUIRED', message: 'Finish signing up before recharging.' });
    if (!sett.usdtEnabled) return res.status(400).json({ status: 'error', message: 'USDT recharges are not available right now.' });
    const rate = Number(sett.usdtRate) || 0;
    if (rate <= 0 || !sett.usdtWalletAddress) return res.status(400).json({ status: 'error', message: 'USDT recharges are not configured yet. Please try again later.' });
    const baseCents = Math.round(Number(req.body.amountUsdt) * 100);
    if (!Number.isFinite(baseCents) || baseCents < 1) return res.status(400).json({ status: 'error', message: 'Enter a valid USDT amount' });
    const amountUgx = Math.round((baseCents / 100) * rate);
    if (amountUgx > MAX_MONEY_AMOUNT) return res.status(400).json({ status: 'error', message: `Amount is too large (max ${fmtMoney(MAX_MONEY_AMOUNT)}).` });
    if (amountUgx < sett.minDeposit)
      return res.status(400).json({ status: 'error', message: `Minimum amount is ${fmtMoney(sett.minDeposit)} (about ${(sett.minDeposit / rate).toFixed(2)} USDT)` });
    const last = _usdtIntentDebounce.get(userId) || 0;
    if (Date.now() - last < 2000) return res.status(429).json({ status: 'error', message: 'Please wait a moment.' });
    _usdtIntentDebounce.set(userId, Date.now());
    const view = i => ({ status: 'success', intentId: i.id, exactAmount: usdtMicrosText(i.exactMicros), amountUgx: i.amountUgx,
      walletAddress: i.walletAddress, expiresAt: tsMillis(i.expiresAt) || new Date(i.expiresAt).getTime() });
    // The same amount asked for again gives the same request back; a member
    // can only hold a few open ones at a time.
    const mineSnap = await db.collection('usdtIntents').where('userId', '==', userId).where('status', '==', 'open').get();
    const open = mineSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(i => tsMillis(i.expiresAt) > Date.now());
    const same = open.find(i => Math.round(Number(i.baseUsdt) * 100) === baseCents && i.walletAddress === sett.usdtWalletAddress);
    if (same) return res.json(view(same));
    if (open.length >= USDT_MAX_OPEN_INTENTS)
      return res.status(429).json({ status: 'error', message: 'You already have open USDT requests. Use one of them, or wait for it to expire.' });
    const intent = await allocateUsdtIntent(userId, baseCents, { amountUgx, rate, walletAddress: sett.usdtWalletAddress });
    if (!intent) return res.status(503).json({ status: 'error', message: 'Could not reserve an amount right now. Please try again in a moment.' });
    res.json(view(intent));
  } catch (e) {
    console.error('USDT intent error:', e.message);
    res.status(500).json({ status: 'error', message: 'Could not create your payment request. Please try again.' });
  }
});
const _usdtSubmitDebounce = new Map();
app.post('/deposit/usdt/submit', async (req, res) => {
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Please sign in again' });
  try {
    const [uSnap, sett] = await Promise.all([db.collection('users').doc(userId).get(), getSettings()]);
    if (!uSnap.exists) return res.status(404).json({ status: 'error', message: 'User not found' });
    if (uSnap.data().status === 'banned') return res.status(403).json({ status: 'error', code: 'BANNED', message: 'Account suspended. Contact customer service.' });
    if (uSnap.data().registrationDone === false) return res.status(403).json({ status: 'error', code: 'REGISTRATION_REQUIRED', message: 'Finish signing up before recharging.' });
    if (!sett.usdtEnabled) return res.status(400).json({ status: 'error', message: 'USDT recharges are not available right now.' });
    // Only a payment request (see /deposit/usdt/intent) can be claimed. The old
    // "type any amount and a hash" claim could be used to take someone else's
    // public transaction, so it is no longer accepted.
    const intentId = String(req.body.intentId || '');
    if (!/^\d{6,15}$/.test(intentId))
      return res.status(400).json({ status: 'error', message: 'Start a new USDT recharge to get your exact payment amount first.' });
    const intentRef = db.collection('usdtIntents').doc(intentId);
    const intentSnap = await intentRef.get();
    if (!intentSnap.exists || intentSnap.data().userId !== userId)
      return res.status(404).json({ status: 'error', message: 'Payment request not found. Start a new USDT recharge.' });
    const intent = intentSnap.data();
    const amountUsdt = Number(intent.baseUsdt);
    const rate = Number(intent.rate);
    const amountUgx = Number(intent.amountUgx);
    // Tron TXIDs are 64 hex chars -- a loose format check to keep obvious
    // junk/typos out. The real verification is TronGrid (or the admin's own
    // Tronscan check before they approve it); this is not relied on for
    // security.
    const txid = String(req.body.txid || '').trim().toLowerCase();
    if (!/^[a-f0-9]{60,66}$/.test(txid)) return res.status(400).json({ status: 'error', message: 'Enter a valid transaction hash (TXID)' });
    // One request, one transaction: a second hash for a request that already
    // has a live claim is refused (a failed claim may be corrected).
    if (intent.status === 'used' && intent.txid && intent.txid !== txid) {
      const prev = await db.collection('pendingDeposits').doc(usdtDepositDocId(intent.txid)).get();
      if (prev.exists && prev.data().status !== 'failed')
        return res.status(409).json({ status: 'error', message: 'A transaction was already submitted for this payment request.' });
    }

    const lastSub = _usdtSubmitDebounce.get(userId) || 0;
    if (Date.now() - lastSub < 7000)
      return res.status(429).json({ status: 'error', message: 'A recharge is already being submitted. Please wait a moment.' });
    _usdtSubmitDebounce.set(userId, Date.now());

    // A TXID can only ever back ONE OPEN OR CREDITED claim, by anyone --
    // without this the same real payment could be submitted by multiple
    // accounts (or resubmitted after already being credited) to farm repeat
    // credits off a single real transfer. A claim that was previously
    // DECLINED doesn't count as a conflict -- the member is allowed to
    // correct a mistaken claim (e.g. the right amount) against the same
    // real transaction rather than being permanently locked out over it.
    const dupSnap = await db.collection('pendingDeposits').where('txid', '==', txid).get();
    const openOrPaid = dupSnap.docs.filter(d => d.data().status !== 'failed');
    if (openOrPaid.length) {
      const matched = openOrPaid.find(d => d.data().status === 'matched');
      if (matched) {
        if (matched.data().userId === userId)
          return res.json({ status: 'success', state: 'matched', depositId: matched.id, message: 'This transaction was already credited.' });
        return res.status(409).json({ status: 'error', message: 'This transaction hash has already been used.' });
      }
      const existing = openOrPaid[0];
      if (existing.data().userId === userId)
        return res.json({ status: 'success', state: 'awaiting_verification', depositId: existing.id, alreadySubmitted: true, message: 'This transaction was already submitted and is being verified.' });
      return res.status(409).json({ status: 'error', message: 'This transaction hash has already been submitted.' });
    }

    // Older releases used random document IDs for USDT claims. If one of
    // those claims failed, reuse that existing row on correction instead of
    // creating a second claim under the newer deterministic ID.
    const failedPrior = dupSnap.docs.find(d => d.data().status === 'failed' && d.data().userId === userId);
    // A declined claim can be corrected by its original submitter, but the
    // same TXID must never be transferred to a different account after a
    // decline. Older releases allowed random-ID duplicates, so inspect every
    // matching row rather than only a capped prefix.
    // Claims made from a payment request (they carry exactMicros) are different:
    // they can only succeed for the request whose unique amount the transfer
    // really matches, so someone else's failed attempt on this hash (e.g. an
    // attacker submitting a hash that is not theirs) must not lock the real
    // owner out of it. Only older, amount-less claims keep the hard lock.
    if (!failedPrior && dupSnap.docs.some(d => d.data().status === 'failed' && !d.data().exactMicros))
      return res.status(409).json({ status: 'error', message: 'This transaction hash has already been used.' });

    const ref = await uniqueRef('U');
    const { date, time } = nowStr();
    const depRef = db.collection('pendingDeposits').doc(failedPrior ? failedPrior.id : usdtDepositDocId(txid));
    const claimData = {
      userId, method: 'usdt', amount: amountUgx, amountUsdt, rate, txid, ref,
      intentId, exactMicros: intent.exactMicros, intentCreatedMs: intent.createdMs,
      walletAddress: intent.walletAddress, status: 'awaiting_verification',
      commissionBasis: 'deposit', commissionPending: true, commissionPaidLevels: [],
      regionKey: currentRegionKey(),
      date, time, createdAt: FieldValue.serverTimestamp()
    };
    let claimed = await depRef.createIfAbsent(claimData);
    let raced = null;
    if (!claimed) {
      raced = await depRef.get();
      // A conclusively failed claim is deliberately reusable: the member may
      // have pasted the right hash with the wrong amount. Only one retry can
      // move it back to awaiting_verification.
      if (raced.exists && raced.data().status === 'failed' && (raced.data().userId === userId || raced.data().exactMicros)) {
        claimed = await depRef.updateIf({ status: 'failed', txid }, {
          ...claimData,
          failureReason: FieldValue.delete(), autoDeclined: FieldValue.delete(),
          autoVerified: FieldValue.delete(), onChainAmountUsdt: FieldValue.delete(),
        });
        if (!claimed) raced = await depRef.get();
      }
      if (!claimed) {
        if (!raced || !raced.exists) throw new Error('USDT claim changed while it was being submitted');
        const prior = raced.data();
        if (prior.userId === userId) {
          if (prior.status === 'matched')
            return res.json({ status: 'success', state: 'matched', depositId: raced.id, message: 'This transaction was already credited.' });
          return res.json({ status: 'success', state: 'awaiting_verification', depositId: raced.id, alreadySubmitted: true, message: 'This transaction was already submitted and is being verified.' });
        }
        return res.status(409).json({ status: 'error', message: 'This transaction hash has already been submitted.' });
      }
    }
    await intentRef.update({ status: 'used', txid }).catch(() => {});
    // Same ledger-row-up-front pattern as /deposit/marzpay -- Records shows
    // this immediately as Processing rather than staying invisible until
    // credited.
    const ledgerData = {
      userId, statementId: newStatementId(), type: 'deposit', description: `Deposit: Processing (${fmtMoney(amountUgx)})`,
      amount: amountUgx, displayAmount: amountUgx, status: 'pending', date, time, ref, depositId: depRef.id, createdAt: FieldValue.serverTimestamp()
    };
    try {
      // A corrected retry reuses the deterministic claim document. Reuse its
      // failed/zeroed ledger row too: creating another row with the same
      // depositId would make creditDeposit() restore BOTH rows to the full
      // amount and double the integrity totals even though the wallet credit
      // itself stayed idempotent.
      const priorLedger = await db.collection('transactions').where('depositId', '==', depRef.id).limit(5).get();
      if (priorLedger.empty) await db.collection('transactions').add(ledgerData);
      else {
        const priorRow = priorLedger.docs[0];
        const priorData = priorRow.data();
        await priorRow.ref.update({ ...ledgerData, statementId: priorData.statementId || ledgerData.statementId });
      }
    } catch (e) { console.error(`USDT deposit ledger row create failed for dep=${depRef.id}:`, e.message); }

    // Try to resolve it right here, a few times, before answering at all --
    // in practice the member usually already sent the crypto and waited for
    // their OWN wallet to show it confirmed before coming back to paste the
    // hash, so the payment is very often already settled by this point.
    // This is what turns "submitted, wait and see" into an immediate,
    // definitive Completed/Declined answer for the common case. Anything
    // still unresolved after this falls back to the 30s reconciler sweep
    // (reconcileUsdtDeposits), which keeps retrying until it resolves --
    // and after 15 minutes unresolved, resolves itself to Declined rather
    // than sitting there forever. An admin's manual Approve/Reject stays
    // available as a backstop throughout, but is never required.
    let resolved = { outcome: 'pending' };
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, 2000));
      resolved = await resolveUsdtDeposit(depRef.id);
      if (resolved.outcome === 'matched' || resolved.outcome === 'rejected') break;
    }
    if (resolved.outcome === 'matched')
      return res.json({ status: 'success', state: 'matched', depositId: depRef.id, reference: ref, message: 'Payment completed! Credited to your wallet.' });
    if (resolved.outcome === 'rejected')
      return res.json({ status: 'success', state: 'rejected', depositId: depRef.id, reference: ref, message: 'Payment declined: ' + resolved.reason });
    res.json({ status: 'success', state: 'awaiting_verification', depositId: depRef.id, reference: ref,
      message: 'Submitted. Verifying on-chain — this can take a minute.' });
  } catch (e) {
    console.error('USDT deposit submit error:', e.message);
    res.status(500).json({ status: 'error', message: 'Could not submit your recharge. Please try again.' });
  }
});
// Lets the client poll a still-pending claim (the common early-return case
// above, or one revived by the background reconciler) until it resolves --
// same role as /deposit/marzpay/status for the mobile-money flow.
app.post('/deposit/usdt/status', async (req, res) => {
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const snap = await db.collection('pendingDeposits').doc(String(req.body.depositId || '')).get();
    if (!snap.exists || snap.data().userId !== userId) return res.status(404).json({ status: 'error', message: 'Recharge not found' });
    const dep = snap.data();
    if (dep.status === 'matched') return res.json({ status: 'success', state: 'matched' });
    if (dep.status === 'failed') return res.json({ status: 'success', state: 'rejected', message: dep.failureReason || 'Payment declined.' });
    // Give this specific poll one more real attempt rather than just
    // reporting the stale stored status -- the member is actively watching,
    // so it's worth trying to resolve it right now instead of waiting for
    // the next 30s reconciler tick.
    const resolved = await resolveUsdtDeposit(snap.id);
    if (resolved.outcome === 'matched') return res.json({ status: 'success', state: 'matched' });
    if (resolved.outcome === 'rejected') return res.json({ status: 'success', state: 'rejected', message: 'Payment declined: ' + resolved.reason });
    res.json({ status: 'success', state: 'awaiting_verification' });
  } catch (e) {
    console.error('USDT deposit status error:', e.message);
    res.status(500).json({ status: 'error', message: 'Could not check payment status' });
  }
});
// Manual admin decline -- the backstop for a claim that isn't resolving on
// its own (or when TRONGRID_API_KEY isn't configured at all, so every claim
// is manual-only). Approve reuses the existing /admin/deposit/force-credit
// (creditDeposit() doesn't care which rail a pendingDeposits row came from).
app.post('/admin/deposit/usdt/reject', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const depositId = String(req.body.depositId || '');
  if (!depositId) return res.status(400).json({ status: 'error', message: 'depositId required' });
  try {
    const snap = await db.collection('pendingDeposits').doc(depositId).get();
    if (!snap.exists) return res.status(404).json({ status: 'error', message: 'Recharge not found' });
    const dep = snap.data();
    if (depositFullyCredited(dep)) return res.status(400).json({ status: 'error', message: 'This recharge was already credited -- cannot reject it now.' });
    const reason = String(req.body.reason || '').trim() || 'Rejected by admin';
    await markDepositFailed(snap.ref, dep.userId, reason);
    logAdminAction(req, 'usdt_deposit_rejected', { depositId, reason });
    res.json({ status: 'success' });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
// Retries on-chain resolution for any USDT claim still sitting at
// 'awaiting_verification' -- covers the case where TronGrid was briefly
// down (or the transaction hadn't confirmed yet) at submit time, so a real
// payment still gets auto-credited on its own rather than needing an admin
// to notice and force-credit it, AND guarantees the 15-minute unresolved
// timeout (see resolveUsdtDeposit) actually gets a chance to fire even if
// the member never reopens the app to poll for status themselves. A no-op
// entirely (and cheap) when TRONGRID_API_KEY isn't configured -- pure
// manual mode is untouched by any of this.
let _sweepingUsdt = false;
async function reconcileUsdtDeposits() {
  if (_sweepingUsdt || !TRONGRID_API_KEY) return 0;
  _sweepingUsdt = true;
  let settled = 0;
  try {
    const snap = await db.collection('pendingDeposits').where('status', '==', 'awaiting_verification').limit(50).get();
    for (const doc of snap.docs) {
      const result = await resolveUsdtDeposit(doc.id);
      if (result.outcome === 'matched' || result.outcome === 'rejected') settled++;
    }
  } catch (e) { console.error('Reconcile USDT deposits error:', e.message); }
  finally { _sweepingUsdt = false; }
  return settled;
}

app.post('/deposit/marzpay/status', async (req, res) => {
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const depSnap = await db.collection('pendingDeposits').doc(String(req.body.depositId || '')).get();
    if (!depSnap.exists || depSnap.data().userId !== userId)
      return res.status(404).json({ status: 'error', message: 'Recharge not found' });
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
    const marzTx = await marzGetCollectTx(dep.marzTxUuid);
    if (SUCCESS_STATUSES.has(marzTx.status)) { await creditDeposit(depSnap); return res.json({ status: 'success', state: 'matched' }); }
    if (FAILED_STATUSES.has(marzTx.status)) {
      // Own test-caught bug: markDepositFailed() can now correctly no-op
      // (returns false) when this exact deposit was already credited by a
      // DIFFERENT in-flight check that won the race -- reporting "failed"
      // here regardless, as this used to, would show a member "Deposit
      // failed" for money that genuinely landed moments earlier. Report
      // what actually happened instead.
      const failMsg = marzDepositFailureMsg(marzTx);
      const reallyFailed = await markDepositFailed(depSnap.ref, userId, failMsg);
      if (!reallyFailed) return res.json({ status: 'success', state: 'matched' });
      return res.json({ status: 'success', state: 'failed', message: failMsg });
    }
    res.json({ status: 'success', state: 'pending' });
  } catch (e) {
    console.error('Deposit status error:', e.message);
    res.status(500).json({ status: 'error', message: 'Could not check payment status' });
  }
});
// ── CARD DEPOSIT (MarzPay) ──
// A fourth deposit rail. The member never leaves the app for mobile money
// (a push prompt lands on their phone) -- for a card, they leave to
// MarzPay's own hosted card-gateway page (`redirect_url`) and come back.
// Nothing about crediting is new here: this reuses the exact same
// pendingDeposits row shape, the exact same creditDeposit()/
// markDepositFailed(), and even the exact same /deposit/marzpay/status
// poll route and reconcilePendingDeposits() sweep as mobile money -- both
// are already keyed only on `marzTxUuid`/`marzReference`, never on HOW the
// row was created, so a card row is invisible to them by nothing more than
// coincidence of shape, not a special case anyone had to add.
const _cardSubmitDebounce = new Map();
// MarzPay's own stated range for card collections, independent of this
// platform's admin-set minDeposit -- enforced as a floor/ceiling regardless
// of what the admin has minDeposit set to, since a card charge below/above
// this is refused at the gateway either way; better to say so up front.
const CARD_MIN_UGX = 500, CARD_MAX_UGX = 10_000_000;
app.post('/deposit/card/submit', async (req, res) => {
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Please sign in again' });
  const amt = paymentAmount(req.body.amount);
  if (isNaN(amt) || amt <= 0) return res.status(400).json({ status: 'error', message: 'Invalid amount' });
  if (amt > MAX_MONEY_AMOUNT || amt > CARD_MAX_UGX) return res.status(400).json({ status: 'error', message: `Amount is too large (max ${fmtMoney(CARD_MAX_UGX)}).` });
  try {
    const [uSnap, sett] = await Promise.all([db.collection('users').doc(userId).get(), getSettings()]);
    if (!uSnap.exists) return res.status(404).json({ status: 'error', message: 'User not found' });
    if (uSnap.data().status === 'banned') return res.status(403).json({ status: 'error', code: 'BANNED', message: 'Account suspended. Contact customer service.' });
    if (_userBeingDeleted.has(userId)) return res.status(400).json({ status: 'error', message: 'This account is currently being processed. Try again shortly.' });
    if (uSnap.data().registrationDone === false) return res.status(403).json({ status: 'error', code: 'REGISTRATION_REQUIRED', message: 'Finish signing up before topping up.' });
    if (!sett.cardDepositEnabled) return res.status(400).json({ status: 'error', message: 'Card payments are not available right now.' });
    const min = Math.max(Number(sett.minDeposit) || 0, CARD_MIN_UGX);
    if (amt < min) return res.status(400).json({ status: 'error', message: `Minimum amount is ${fmtMoney(min)}` });

    const lastSub = _cardSubmitDebounce.get(userId) || 0;
    if (Date.now() - lastSub < 7000)
      return res.status(429).json({ status: 'error', message: 'A recharge is already being processed. Please wait a moment.' });
    _cardSubmitDebounce.set(userId, Date.now());

    const ref = await uniqueRef('C');
    const marzReference = crypto.randomUUID();
    const { date, time } = nowStr();
    const depRef = db.collection('pendingDeposits').doc();
    await depRef.set({
      userId, method: 'card', amount: amt, ref, marzReference, status: 'initiating', provider: 'marzpay',
      commissionBasis: 'deposit', commissionPending: true, commissionPaidLevels: [],
      regionKey: currentRegionKey(),
      date, time, createdAt: FieldValue.serverTimestamp()
    });
    let mpData;
    try {
      mpData = await marzCollectCard({
        amount: amt, reference: marzReference, description: 'Card payment',
        callbackUrl: PUBLIC_URL ? PUBLIC_URL + '/deposit/callback' : undefined
      });
    } catch (netErr) {
      console.error('MarzPay card collect network error (ref ' + ref + '):', netErr.message);
      await markDepositFailed(depRef, userId, 'Could not reach the card payment gateway. Please try again.');
      return res.status(500).json({ status: 'error', message: 'Could not start the card payment. Please try again.' });
    }
    if (mpData.status !== 'success' && mpData.status !== 'sandbox') {
      console.error('MarzPay card collect rejected:', JSON.stringify(mpData));
      await markDepositFailed(depRef, userId, marzUserMsg(mpData, 'Could not start the card payment'));
      return res.status(400).json({ status: 'error', message: marzUserMsg(mpData, 'Could not start the card payment') });
    }
    const redirectUrl = mpData.data?.redirect_url;
    const txUuid = mpData.data?.transaction?.uuid;
    if (!redirectUrl) {
      console.error('MarzPay card collect: no redirect_url in response', JSON.stringify(mpData));
      await markDepositFailed(depRef, userId, 'Card payment could not be started. Please try again.');
      return res.status(500).json({ status: 'error', message: 'Card payment could not be started. Please try again.' });
    }
    // Same "capture our own uuid" step MoMo's collect does -- this is what
    // lets the webhook (and the reconciler, and the status poll) trust a
    // matching uuid outright instead of only ever accepting one the webhook
    // itself supplies (see /deposit/callback's own comment on that exploit).
    if (txUuid) await depRef.update({ marzTxUuid: txUuid, status: 'pending' }).catch(() => {});
    res.json({ status: 'success', depositId: depRef.id, reference: ref, redirectUrl });
  } catch (e) {
    console.error('Card deposit submit error:', e.message);
    res.status(500).json({ status: 'error', message: 'Could not start the card payment. Please try again.' });
  }
});
// Browser-return leg for the card gateway. MarzPay's own docs describe
// `callback_url` as doing double duty for a card collection -- the same URL
// the CUSTOMER's browser lands back on after paying, and the URL MarzPay
// POSTs the real server-to-server result to (handled by the POST handler
// of this exact path, just below, completely unchanged for this feature).
// A GET here is always the browser leg, never the webhook (MarzPay's own
// webhook POST never hits this branch), so this is purely cosmetic --
// crediting the deposit never depends on a member's browser successfully
// making it back here. Deliberately NOT redirecting to a separate frontend
// origin: the VPS has no domain yet (still a bare IP -- see CLAUDE.md), so
// hardcoding one here would break the moment that changes. The app itself
// resumes checking the real result on its own (see doCardDeposit()'s own
// localStorage-based resume, user-src) whether or not this page is ever
// even seen.
app.get('/deposit/callback', (req, res) => {
  res.set('Content-Type', 'text/html; charset=utf-8').send(
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Payment received</title><style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#1d130f;color:#fff;' +
    'display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;text-align:center;box-sizing:border-box}' +
    'div{max-width:340px}h1{font-size:18px;margin:0 0 8px}p{color:rgba(255,255,255,.7);font-size:14px;line-height:1.5}</style></head>' +
    '<body><div><h1>Payment received</h1><p>You can close this page and return to the app. Your balance will update automatically once the payment is confirmed.</p></div></body></html>'
  );
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
      await markDepositFailed(doc.ref, dep.userId, marzDepositFailureMsg(tx));
    }
  } catch (e) { console.error('Deposit callback error:', e.message); }
});
// ═══════════════════════════════════════════
// WITHDRAWAL (MarzPay send-money, mobile money only)
// ═══════════════════════════════════════════
const _withdrawInFlight = new Set();
const _witRequestInFlight = new Set();
// The Trade Password set at registration is the ONLY PIN in Soda -- it
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
// Caller holds bal:<userId>. A restart can finish a charged request, but
// must never charge an unconfirmed request on the member's behalf.
async function finishWithdrawalCreation(witRef, userId) {
  const snap = await witRef.get();
  if (!snap.exists || snap.data().status !== 'creating') return;
  const w = snap.data();
  const user = await db.collection('users').doc(userId).get();
  if (!user.exists) throw new Error('Withdrawal owner is unavailable');
  if (!(user.data().debitedWithdrawalIds || []).includes(witRef.id)) {
    await witRef.updateIf({ status: 'creating' }, { status: 'declined', failureReason: 'Request was not charged. No payout was sent.' });
    return;
  }
  await db.collection('transactions').doc('withdrawal:' + witRef.id).createIfAbsent({
    userId, statementId: newStatementId(), type: 'withdraw', description: `Withdrawal: Processing (${fmtMoney(w.amount)})`,
    amount: -w.amount, displayAmount: -w.amount, status: 'pending', date: w.date, time: w.time, ref: w.ref,
    withdrawalId: witRef.id, createdAt: FieldValue.serverTimestamp()
  });
  await witRef.updateIf({ status: 'creating' }, { status: 'pending' });
}
async function reconcileWithdrawalCreations() {
  const snap = await db.collection('withdrawals').where('status', '==', 'creating').orderBy('createdAt', 'asc').limit(100).get();
  for (const doc of snap.docs) {
    const userId = doc.data().userId;
    try { await withLock('bal:' + userId, () => finishWithdrawalCreation(doc.ref, userId)); }
    catch (e) { console.error('Withdrawal creation recovery failed:', doc.id, e.message); }
  }
}
app.post('/withdraw/request', async (req, res) => {
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Please sign in again' });
  if (_witRequestInFlight.has(userId))
    return res.status(429).json({ status: 'error', message: 'A withdrawal is already being processed. Please wait a moment.' });
  if (_userBeingDeleted.has(userId))
    return res.status(400).json({ status: 'error', message: 'This account is currently being processed. Try again shortly.' });
  _witRequestInFlight.add(userId);
  let witId;
  try {
    const amt = paymentAmount(req.body.amount);
    if (isNaN(amt) || amt <= 0) return res.status(400).json({ status: 'error', message: 'Invalid amount' });
    if (amt > MAX_MONEY_AMOUNT) return res.status(400).json({ status: 'error', message: `Amount is too large (max ${fmtMoney(MAX_MONEY_AMOUNT)}).` });
    const rawNetwork = String(req.body.network || '').trim();
    if (!rawNetwork) return res.status(400).json({ status: 'error', message: 'Bind a withdrawal account first.' });
    // cleanPhone() only applies to mobile money -- it enforces this
    // region's phone SHAPE, which a bank account number is not. The bound-
    // account lookup right below (boundSnap) is the real gate either way:
    // a value that doesn't match a real saved bankAccounts doc is refused
    // there regardless of which branch validated its shape here.
    const destValue = NETWORK_NAMES.has(rawNetwork) ? cleanPhone(req.body.phone || '') : String(req.body.phone || '').replace(/\s+/g, '').trim();
    if (!destValue) return res.status(400).json({ status: 'error', message: 'Bind a withdrawal account first.' });
    const sett = await getSettings();
    // The withdraw window, enforced HERE and not only shown in the app.
    // Owner: "one withdrawal time should be SETTABLE IN ADMIN, such that when
    // one tries to withdrawal he sees, that withdrawals start from this time
    // to this time." The app draws the hours on the screen, but this route is
    // a plain authenticated POST -- a rule that lives only in the client is
    // not a rule.
    const win = withdrawWindowState(sett, Date.now());
    if (win.enabled && !win.open)
      return res.status(400).json({ status: 'error', code: 'WINDOW_CLOSED',
        message: `Withdraw is open from ${win.from} to ${win.to}. Please come back then.` });
    if (amt < sett.minWithdraw) return res.status(400).json({ status: 'error', message: `Minimum withdraw is ${fmtMoney(sett.minWithdraw)}` });
    // Checked HERE, not only in the app: the client's own check is a
    // courtesy so a member sees the rule before submitting, but /withdraw/
    // request is a plain authenticated POST and the amount in its body is
    // whatever the caller chose to send.
    const wMult = Math.max(0, Math.floor(Number(sett.withdrawMultiple) || 0));
    if (wMult > 0 && amt % wMult !== 0) {
      const low = Math.floor(amt / wMult) * wMult, high = low + wMult;
      return res.status(400).json({ status: 'error',
        message: `Withdraw must be a multiple of ${fmtMoney(wMult)}. Try ${fmtMoney(Math.max(low, sett.minWithdraw))} or ${fmtMoney(high)}.` });
    }
    // Trade Password gate. The six-digit Trade Password chosen at sign-up is asked
    // on the Withdraw screen and checked HERE, before anything is charged:
    // pinCheck() verifies the scrypt hash and locks the account for 15 minutes
    // after 5 wrong tries (a 6-digit code has only a million values, so the
    // lock is what makes it a real gate). The app's own check is a courtesy.
    const pinResult = await pinCheck(userId, req.body.pin);
    if (!pinResult.ok)
      return res.status(pinResult.code === 'LOCKED' ? 429 : 400).json({ status: 'error', code: pinResult.code, message: pinResult.message });
    const boundSnap = await db.collection('bankAccounts')
      .where('userId', '==', userId).where('network', '==', rawNetwork).where('phone', '==', destValue).limit(1).get();
    if (boundSnap.empty)
      return res.status(400).json({ status: 'error', code: 'UNBOUND_ACCOUNT', message: "That withdrawal account isn't saved to your profile. Bind it first, then try again." });
    const holder = boundSnap.docs[0].data().holder;

    const feePct = Number(sett.withdrawFeePct);
    if (!Number.isFinite(feePct) || feePct < 0 || feePct >= 100) throw new Error('Withdraw fees are unavailable. Contact support.');
    if (Number(sett.maxWithdraw) > 0 && amt > Number(sett.maxWithdraw)) throw new Error(`Maximum withdraw is ${fmtMoney(sett.maxWithdraw)}`);
    const fee = Math.round(amt * feePct / 100);
    const net = amt - fee;
    if (net <= 0) throw new Error('Withdraw amount is too small after fees.');
    const ref = await uniqueRef('S');
    // This adapter has no real multi-document rollback. Persist the request
    // first, then charge once with a durable token that recovery can inspect.
    await withLock('bal:' + userId, async () => {
      const uRef = db.collection('users').doc(userId);
      const fresh = await uRef.get();
      if (!fresh.exists) throw new Error('User not found');
      if (fresh.data().status === 'banned') { const banErr = new Error('Account suspended. Contact customer service.'); banErr.code = 'BANNED'; throw banErr; }
      if (fresh.data().registrationDone === false) throw new Error('Finish signing up before withdrawing.');
      if (sett.requireInvestToWithdraw !== false && (fresh.data().totalInvested || 0) <= 0)
        throw new Error('Purchase at least one plan before you can withdraw.');
      const bal = fresh.data().walletBalance || 0;
      if (bal < amt) {
        logSecurityEvent(userId, 'withdraw_insufficient_funds', { attempted: amt, balance: bal });
        throw new Error(`Not enough balance, you have ${fmtMoney(bal)}`);
      }
      // ONE UNRESOLVED WITHDRAWAL AT A TIME. Owner: "no requesting another
      // withdrawal yet another one is on pending, so one should have got his
      // processing one to be paid then requests another."
      //
      // Inside the balance lock and before the debit, so two taps cannot both
      // find nothing pending. The three statuses are exactly the ones
      // /admin/withdrawals/list treats as unresolved -- 'processed' and
      // 'rejected' are finished and must not block anything, or a member's
      // first ever withdrawal would be their last.
      const openSnap = await db.collection('withdrawals')
        .where('userId', '==', userId).where('status', 'in', ['creating', 'pending', 'sending', 'processing'])
        .limit(1).get();
      if (!openSnap.empty) {
        const w = openSnap.docs[0].data();
        const e = new Error(`You already have a withdrawal of ${fmtMoney(w.amount || 0)} waiting. Once it is paid you can request another.`);
        e.code = 'WITHDRAW_PENDING';
        throw e;
      }
      const maxPerDay = Number(sett.maxWithdrawalsPerDay) || 0;
      if (maxPerDay > 0) {
        const today = nowStr().date;
        const todaySnap = await db.collection('withdrawals').where('userId', '==', userId).where('date', '==', today).get();
        // A declined request was refunded in full and paid nothing, so it must not
        // use up the member's allowance (a provider failure would otherwise lock
        // them out of trying again until tomorrow).
        const usedToday = todaySnap.docs.filter(d => d.data().status !== 'declined').length;
        if (usedToday >= maxPerDay)
          throw new Error(`You've reached today's limit of ${maxPerDay} withdrawal${maxPerDay === 1 ? '' : 's'}. Try again tomorrow.`);
      }
      const witRef = db.collection('withdrawals').doc();
      witId = witRef.id;
      const { date, time } = nowStr();
      // Persist a non-payable recovery record before the debit. The debit and
      // its token are one atomic user update; ledger failures never refund a
      // request that an administrator could still send.
      await witRef.set({ userId, amount: amt, fee, net, holder, network: rawNetwork, phone: destValue, ref,
        status: 'creating', regionKey: currentRegionKey(), date, time, createdAt: FieldValue.serverTimestamp() });
      const debited = await uRef.updateIf({ walletBalance: { $gte: amt }, status: { $ne: 'banned' }, debitedWithdrawalIds: { $ne: witId } }, {
        walletBalance: FieldValue.increment(-amt), debitedWithdrawalIds: FieldValue.arrayUnion(witId)
      });
      if (!debited) throw new Error('Your balance or account status changed. Please refresh and try again.');
      await finishWithdrawalCreation(witRef, userId);
    });
    sendAdminPush('New withdrawal request', `${fmtMoney(amt)} requested via ${rawNetwork}`, { type: 'withdrawal', withdrawalId: witId }, { quickApprove: true }).catch(() => {});
    res.json({ status: 'success', withdrawalId: witId, reference: ref, net, message: 'Withdrawal requested, processing now' });
  } catch (e) {
    if (witId) return res.status(503).json({ status: 'error', code: 'WITHDRAWAL_RECOVERY_PENDING', withdrawalId: witId, message: 'Your withdrawal request is being checked. Check Transaction Statement before submitting again.' });
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
  return _finalizeWithdrawalTxNow(withdrawalId, outcome, refunded);
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
    return await _processWithdrawalNow(withdrawalId, processedBy);
  } catch (e) {
    console.error('Withdrawal processing failed:', e.message);
    return { code: 503, body: { status: 'error', message: 'Could not process the payout. Please retry shortly.' } };
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

    // A suspended member's pending request is not paid by an automatic send
    // (one tap on a notification could otherwise pay someone who was banned
    // after asking). The admin can still Reject (refunds) or unban and send.
    // Recording a payout already made by hand (manual mode, above) is unaffected.
    const owner = await db.collection('users').doc(wit.userId).get();
    if (owner.exists && owner.data().status === 'banned')
      return { code: 409, body: { status: 'error', message: 'This member is suspended, so the payout was not sent. Reject it to refund them, or unban the account first.' } };

    if (isBankNetwork(wit.network)) {
      // Bank transfer payout -- always MarzPay, never PesaJet (bank
      // transfer is not a PesaJet product), so this branch runs regardless
      // of withdrawProvider()'s own setting. Same "write the marker before
      // ever calling out, a network error is ambiguous, acceptance is not
      // completion" shape as the MarzPay send-money branch below, with one
      // real difference: /bank-transfer takes no client-supplied reference
      // at all (unlike collect/send-money), so unlike those two there is
      // nothing of our own to pre-write as the lookup key for a later
      // webhook or reconciler tick -- only whatever reference MarzPay
      // itself hands back in the response, captured the instant it exists.
      const sendingMarker = crypto.randomUUID();
      const sendingClaimed = await witRef.updateIf({ status: 'pending' }, { status: 'sending', sendingReference: sendingMarker, sendingBy: processedBy, sendingAt: FieldValue.serverTimestamp() });
      if (!sendingClaimed) return { code: 409, body: { status: 'error', message: 'Withdrawal status changed. Refresh the list.' } };

      let mpData, ambiguous = false;
      try {
        mpData = await marzBankTransfer({ amount: wit.net, bankName: wit.network, accountNumber: wit.phone, accountName: wit.holder, description: 'Withdrawal' });
      } catch (netErr) {
        // Ambiguous, exactly like the MarzPay send-money branch's own
        // comment on this: never revert to 'pending' here, that would
        // invite a retry that could double-pay. Leave it at 'sending' for
        // the admin to check on MarzPay's own dashboard.
        console.error('MarzPay bank transfer network error (ambiguous, NOT reverting to pending):', netErr.message);
        ambiguous = true;
        mpData = { status: 'error', providerDown: true, message: netErr.message };
      }
      if (ambiguous || mpData.providerDown) {
        return { code: 500, body: { status: 'error', message: 'Lost contact with MarzPay mid-request. We cannot confirm whether this bank transfer was actually sent. It stays on "Sending" (not pending) so nobody retries it blindly.', sendingReference: sendingMarker } };
      }
      if (mpData.status !== 'success' && mpData.status !== 'sandbox') {
        await witRef.updateIf({ status: 'sending', sendingReference: sendingMarker }, { status: 'pending', sendingReference: null, sendingBy: null, sendingAt: null }).catch(() => {});
        return { code: 400, body: { status: 'error', message: marzUserMsg(mpData, 'MarzPay could not send this bank transfer right now. The withdrawal stays pending and untouched. Try again in a moment.') } };
      }
      const sandbox = mpData.status === 'sandbox';
      // MarzPay's own reference (the create response's data.bank_transfer.
      // reference/transaction_uuid, same value under both keys per the
      // docs) is what GET /bank-transfer/{reference} and the reconciler
      // both need -- stored into the SAME marzReference field the other
      // two payout rails already use, so every downstream reader
      // (/admin/withdraw/verify, reconcilePendingWithdrawals) needs no
      // bank-specific field to look for.
      const bankRef = mpData.data?.bank_transfer?.reference || mpData.data?.bank_transfer?.transaction_uuid || null;
      const updateFields = { status: sandbox ? 'processed' : 'processing', processedBy, processedAt: FieldValue.serverTimestamp(), marzReference: bankRef || sendingMarker, isBankTransfer: true };
      await withLock('bal:' + wit.userId, async () => {
        await witRef.update({ marzReference: bankRef || sendingMarker, isBankTransfer: true });
        const claimed = await witRef.updateIf({ status: 'sending' }, updateFields);
        if (!claimed) return;
        try {
          await db.collection('users').doc(wit.userId).update({ totalWithdrawn: FieldValue.increment(wit.net) });
        } catch (twErr) {
          console.error(`MONEY-SAFETY: totalWithdrawn increment failed AFTER bank withdrawal ${withdrawalId} was marked sent — user ${wit.userId} is missing +${wit.net} in their totalWithdrawn stat. Backfill by hand.`, twErr.message);
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
        body: { status: 'success', sandbox, message: sandbox ? `Sandbox: withdrawal marked complete, ${fmtMoney(wit.net)} to ${wit.network} ${wit.phone}` : `Sending ${fmtMoney(wit.net)} to ${wit.network} ${wit.phone}` },
        meta: { amount: wit.net, dest: wit.phone, userId: wit.userId }
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
      const sendingClaimed = await witRef.updateIf({ status: 'pending' }, { status: 'sending', sendingReference: sendingMarker, pesajetRef: sendingMarker, sendingBy: processedBy, sendingAt: FieldValue.serverTimestamp() });
      if (!sendingClaimed) return { code: 409, body: { status: 'error', message: 'Withdrawal status changed. Refresh the list.' } };
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
        await witRef.updateIf({ status: 'sending', sendingReference: sendingMarker }, { status: 'pending', sendingReference: null, pesajetRef: null, pesajetTxId: null, sendingBy: null, sendingAt: null }).catch(() => {});
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
    const sendingClaimed = await witRef.updateIf({ status: 'pending' }, { status: 'sending', sendingReference: sendingMarker, marzReference: sendingMarker, sendingBy: processedBy, sendingAt: FieldValue.serverTimestamp() });
    if (!sendingClaimed) return { code: 409, body: { status: 'error', message: 'Withdrawal status changed. Refresh the list.' } };

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
      await witRef.updateIf({ status: 'sending', sendingReference: sendingMarker }, { status: 'pending', sendingReference: null, marzReference: null, sendingBy: null, sendingAt: null }).catch(() => {});
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
// Owner-only "Approve" straight from a push notification, with the admin panel
// closed (no page, no login session). The device's own service worker posts the
// withdrawal id plus the token/secret pair that arrived inside the push it
// received (see sendAdminPush and /admin/push/register). It is checked here,
// constant-time; the credential can reach processWithdrawalCore and nothing
// else, and dies the moment the device unregisters. The account that
// registered the device must STILL be an active owner, so removing or
// demoting an admin cuts this off even though their device is still
// subscribed. Everything past the credential check is the same code path as
// the Send button in the panel (one-at-a-time lock, status must be pending,
// idempotent), so a double tap or a replay cannot pay twice.
const quickApproveLimiter = rateLimit({ windowMs: 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false,
  message: { status: 'error', message: 'Too many requests. Slow down.' } });
app.post('/admin/withdraw/quick-approve', quickApproveLimiter, async (req, res) => {
  try {
    const withdrawalId = String(req.body.withdrawalId || '').trim();
    const pushToken = String(req.body.pushToken || '').trim();
    const secret = String(req.body.secret || '');
    if (!withdrawalId || !pushToken || !secret || pushToken.length > 4096) return res.status(400).json({ status: 'error', message: 'Missing fields' });
    // Each refusal says WHY (still a 401, no money moves), because a bare
    // "Unauthorized" on a lock screen gives the owner nothing to act on. None of
    // these is a login expiry: this route does not use the panel's login at all,
    // only the per-device credential that came inside the notification.
    const refuse = (code, message) => res.status(401).json({ status: 'error', code, message });
    const tokDoc = await db.collection('adminPushTokens').doc(pushToken).get();
    const tok = tokDoc.exists && !pushRetiredExpired(tokDoc.data()) ? tokDoc.data() : null;
    if (!tok)
      return refuse('DEVICE_NOT_REGISTERED', 'This device is no longer registered for quick approve (its notification token changed). Open the admin panel once to turn it back on, then approve from the next alert. You can approve this one in the panel.');
    if (tok.role !== 'owner' || !tok.quickApproveSecret)
      return refuse('DEVICE_NOT_OWNER', 'Quick approve is only on for devices signed in as the owner. Open the admin panel signed in as owner, then approve from the next alert.');
    if (!safeEqual(String(tok.quickApproveSecret), secret))
      return refuse('ALERT_OUT_OF_DATE', 'This alert is out of date. Approve it in the admin panel; the next alert will have a working button.');
    const username = String(tok.username || 'owner-key');
    // The owner signing in with the master key gets a session named 'owner'
    // (see /admin/check-key; a device registered without a session is
    // 'owner-key'). Neither has an adminUsers row -- looking one up refused the
    // real owner as "no longer an owner". Those names are reserved (staff can
    // not be created with them), so a record with one of them can only have
    // come from the master-key owner. Any other name is a staff-table account
    // and must still be an active owner there.
    if (username !== 'owner-key' && username !== 'owner') {
      const u = await db.collection('adminUsers').doc(username).get();
      if (!u.exists || u.data().active === false || u.data().role !== 'owner')
        return refuse('NOT_OWNER_ANYMORE', 'The account this device was registered with is no longer an active owner. Sign in to the admin panel to check.');
    }
    const result = await processWithdrawalCore(withdrawalId, username + ' (notification)');
    if (result.code === 200)
      logAdminAction({ adminUser: { username, role: 'owner' }, ip: req.ip }, 'withdrawal_processed', { withdrawalId, via: 'push', ...result.meta });
    res.status(result.code).json(result.body);
  } catch (e) {
    console.error('Quick-approve error:', e.message);
    res.status(500).json({ status: 'error', message: 'Could not approve right now. Open the admin panel to check.' });
  }
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
    // Bank transfer -- neither marzTxUuid nor a PesaJet reference is ever
    // set on this rail (see the branch in _processWithdrawalNow); it has
    // its own reference, stored in the SAME marzReference field the other
    // two rails use, checked against MarzPay's own bank-transfer status
    // endpoint rather than the send-money one below.
    if (w.isBankTransfer) {
      if (!w.marzReference) {
        return res.json({ status: 'success', ourStatus: w.status, marzStatus: 'no_reference', message: 'This bank transfer never reached MarzPay (no gateway reference). Nothing was sent.' });
      }
      const btStatus = await marzGetBankTransferStatus(w.marzReference);
      const sent = SUCCESS_STATUSES.has(btStatus);
      const failed = FAILED_STATUSES.has(btStatus);
      let btMessage;
      if (!btStatus) btMessage = `A send attempt WAS made (reference: ${w.marzReference}) but MarzPay did not respond just now -- this does NOT mean nothing was sent. Try Verify again in a moment.`;
      else if (sent && w.status !== 'processed') btMessage = `MarzPay says this bank transfer was SENT, but our record is "${w.status}". Check the recipient bank account before doing anything else.`;
      else if (sent) btMessage = 'MarzPay confirms the bank transfer was SENT and our record already shows it processed.';
      else if (failed) btMessage = `MarzPay says this bank transfer FAILED (status: ${btStatus}).`;
      else btMessage = `MarzPay reports status: ${btStatus || 'unknown'}. Not finished, not failed.`;
      return res.json({ status: 'success', ourStatus: w.status, marzStatus: btStatus || 'unknown', message: btMessage });
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
      return res.status(404).json({ status: 'error', message: 'Withdrawal not found' });
    const wit = witSnap.data();
    if (wit.status !== 'processing') return res.json({ status: 'success', state: wit.status });
    // Bank transfer branch, checked against marzReference/the bank-transfer
    // status endpoint instead of marzTxUuid/send-money -- see the same
    // branch in /admin/withdraw/verify above for the full reasoning.
    if (wit.isBankTransfer) {
      if (!wit.marzReference) return res.json({ status: 'success', state: 'processing' });
      const btStatus = await marzGetBankTransferStatus(wit.marzReference);
      if (SUCCESS_STATUSES.has(btStatus)) {
        if (await markWithdrawalProcessed(witSnap.ref, userId)) {
          await finalizeWithdrawalTransactionRecord(witSnap.id, 'processed');
          return res.json({ status: 'success', state: 'processed' });
        }
        const nowSnap = await witSnap.ref.get();
        return res.json({ status: 'success', state: nowSnap.exists ? nowSnap.data().status : 'processed' });
      }
      if (FAILED_STATUSES.has(btStatus)) {
        // Same discarded-`declined` guard as the send-money branch right
        // below -- a concurrent check (reconciler, another poll) may have
        // already won the decline race; only finalize with what actually happened.
        const { declined, refunded } = await declineWithdrawalAndRefund(witSnap.ref, userId, 'Payout failed at the bank', ['processing']);
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
    res.status(500).json({ status: 'error', message: 'Could not check withdrawal status' });
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
// WITHDRAWAL ACCOUNTS (mobile money + bank)
// ═══════════════════════════════════════════
// Public bank list for the wallet-bind picker (owner: "add all supported
// banks so withdrawals will also be processed through banks... where there
// is select network, it should be select bank, so mtn and airtel will also
// be there"). Requires auth (same as every other /bank/* route) even
// though the list itself isn't secret -- no reason to expose a MarzPay
// proxy to an unauthenticated caller.
app.get('/bank/supported-banks', async (req, res) => {
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const banks = await getSupportedBanks();
  res.json({ status: 'success', banks: banks.map(b => b.name) });
});
const MAX_SAVED_PAYOUT_ACCOUNTS = 1; // one wallet per member; /bank/save edits it in place
app.post('/bank/save', async (req, res) => {
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const holder = stripHtml(req.body.holder);
  const rawNetwork = String(req.body.network || '').trim();
  if (!holder || !rawNetwork) return res.status(400).json({ status: 'error', message: 'Fill in all fields' });
  const isMobileMoney = NETWORK_NAMES.has(rawNetwork);
  // Owner: "so some bank account exceed character limit so no capping of
  // characters please" -- cleanPhone() enforces this region's phone SHAPE
  // (exact digit count, dial code), which is correct for MTN/Airtel but
  // would reject or truncate a genuine bank account number. Banks get their
  // own, deliberately loose check instead: present, plausible length,
  // digits/letters only (some banks' account numbers aren't purely
  // numeric) -- no upper cap tighter than what a real account number could
  // need.
  let destValue;
  if (isMobileMoney) {
    destValue = cleanPhone(req.body.phone || '');
    if (!destValue) return res.status(400).json({ status: 'error', message: badPhoneMessage() });
  } else {
    destValue = String(req.body.phone || req.body.accountNumber || '').replace(/\s+/g, '').trim();
    if (!/^[A-Za-z0-9]{4,34}$/.test(destValue)) return res.status(400).json({ status: 'error', message: 'Enter a valid bank account number' });
    // Validated against the SAME live/cached list #bank/supported-banks
    // serves -- a bank name the picker never offered has no business
    // reaching MarzPay's own bank-transfer create call, where an unknown
    // code is what its docs describe as UNSUPPORTED/UNKNOWN BANK.
    const banks = await getSupportedBanks();
    if (!banks.some(b => b.name === rawNetwork)) return res.status(400).json({ status: 'error', message: 'That bank is not currently supported. Pick one from the list.' });
  }
  try {
    const uSnap = await db.collection('users').doc(userId).get();
    if (uSnap.exists && uSnap.data().status === 'banned') return res.status(403).json({ status: 'error', code: 'BANNED', message: 'Account suspended. Contact customer service.' });
    // No OTP step when saving a payout wallet (owner decision): the member is
    // already signed in, and withdrawals still need the Trade Password.
    // MarzPay's own recommended step, done here rather than only at
    // withdrawal time: catches a mistyped account number the moment it is
    // entered, with the member still looking at the form, instead of only
    // once a real payout is being sent. Also cross-checks/fills the
    // account holder name the same way -- if MarzPay's own validation
    // returns one and the member left the name field close to it, prefer
    // the verified name; a real mismatch is left to the member's own
    // entry rather than silently overwritten, since a shared/company
    // account can legitimately have a different registered name.
    let verifiedHolder = holder;
    if (!isMobileMoney) {
      // marzValidateBankAccount() now handles its own network errors and
      // one transient-failure retry internally (never throws) -- providerDown
      // is the one signal to check for either case.
      const v = await marzValidateBankAccount(rawNetwork, destValue);
      if (v.providerDown) return res.status(500).json({ status: 'error', message: 'Could not verify this account right now. Please try again in a moment.' });
      if (v.status !== 'success' || !v.data?.valid) {
        return res.status(400).json({ status: 'error', message: marzUserMsg(v, 'Account could not be validated. Please check the account number and bank.') });
      }
      if (v.data?.account_name) verifiedHolder = String(v.data.account_name).trim() || holder;
    }
    // Saving/removing a payout destination here doesn't move any money by
    // itself -- see /withdraw/request for the actual money-moving path.
    // One payout wallet per member: saving EDITS it in place (any older extra rows are dropped), it never adds a second.
    await withLock('bank-save:' + userId, async () => {
      const mine = await db.collection('bankAccounts').where('userId', '==', userId).get();
      const rows = mine.docs || [];
      if (rows.length) {
        await rows[0].ref.update({ holder: verifiedHolder, network: rawNetwork, phone: destValue, updatedAt: FieldValue.serverTimestamp() });
        for (const extra of rows.slice(1)) await extra.ref.delete();
        return;
      }
      await db.collection('bankAccounts').add({ userId, holder: verifiedHolder, network: rawNetwork, phone: destValue, createdAt: FieldValue.serverTimestamp() });
    });
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
    // A member who has no Trade Password yet (an account made before it existed) sets the first one
    // here without an old one; once one exists, changing it always needs the old one.
    if (uSnap.exists && uSnap.data().transactionPinHash) {
      const check = await pinCheck(userId, req.body.oldPin);
      if (!check.ok) return res.status(400).json({ status: 'error', code: check.code, message: check.message });
    }
    await db.collection('users').doc(userId).update({ transactionPinHash: scryptHash(newPin), pinFailCount: 0, pinLockedUntil: null });
    res.json({ status: 'success' });
  } catch (e) { res.status(500).json({ status: 'error', message: 'Could not change your PIN' }); }
});

// ═══════════════════════════════════════════
// GIFT CODES
// ═══════════════════════════════════════════
app.post('/redeem', async (req, res) => {
  const userId = await verifyAuth(req);
  if (!userId) return res.status(401).json({ status: 'error', message: 'Please sign in again' });
  const raw = String(req.body.code || '').trim().slice(0, 32);
  if (!raw) return res.status(400).json({ status: 'error', message: 'Please enter the treasure chest key' });
  if (!/^[A-Za-z0-9-]+$/.test(raw)) return res.status(400).json({ status: 'error', message: 'Wrong treasure chest password' });
  try {
    let result = null;
    // Lock on the lowercased code, not the raw input: two members submitting
    // the same code in different casing must serialise against each other.
    await withLock('redeem:' + raw.toLowerCase(), async () => {
      const userSnap = await db.collection('users').doc(userId).get();
      if (!userSnap.exists) { result = { code: 404, body: { status: 'error', message: 'User not found' } }; return; }
      if (userSnap.data().status === 'banned') { result = { code: 403, body: { status: 'error', code: 'BANNED', message: 'Account suspended. Contact customer service.' } }; return; }
      // Matched via codeLower (case-insensitive by construction, and
      // already the field the promoCodes uniqueness index enforces on) --
      // this reads correctly regardless of which case a given code
      // happens to be STORED in, so a code issued under the old uppercase
      // alphabet and one issued under the new lowercase alphabet are both
      // found the same way, with no case-guessing needed.
      const lower = raw.toLowerCase();
      let codeSnap = await db.collection('promoCodes').where('codeLower', '==', lower).limit(1).get();
      // A member who reads a code off a screenshot and types it by hand may
      // reasonably leave the dashes out, or put them somewhere else -- the
      // code itself, read as characters, is still exactly right. If
      // stripping non-alphanumerics leaves precisely GIFTCODE_LENGTH
      // characters, re-segment them into the canonical shape and try that
      // too, rather than telling a member holding a genuine code that it
      // is invalid over punctuation alone.
      if (codeSnap.empty) {
        const stripped = lower.replace(/[^a-z0-9]/g, '');
        if (stripped.length === GIFTCODE_LENGTH) {
          const groups = [];
          for (let i = 0; i < GIFTCODE_LENGTH; i += GIFTCODE_GROUP_LEN) groups.push(stripped.slice(i, i + GIFTCODE_GROUP_LEN));
          const resegmented = groups.join('-');
          if (resegmented !== lower) {
            codeSnap = await db.collection('promoCodes').where('codeLower', '==', resegmented).limit(1).get();
          }
        }
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
        // Rolled ONCE per claim, in whole cents, so a payout can be e.g. 647.72.
        // crypto.randomInt's upper bound is exclusive, hence +1; min===max (a
        // code with no real range) always returns that one value.
        reward = crypto.randomInt(Math.round(minReward * 100), Math.round(maxReward * 100) + 1) / 100;
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
          userId, statementId: newStatementId(), type: 'promocode', description: `Gift code redeemed: ${code}`, giftCode: code,
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
        if (Number.isFinite(bal)) body.walletBalance = round2(bal);
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
    const transactions = snap.docs.map(d => ({ id: d.id, ...d.data(), statementId: statementIdFor(d) }));
    res.json({ status: 'success', transactions, truncated: transactions.length >= TX_LIST_LIMIT });
  } catch (e) { res.status(500).json({ status: 'error', message: 'Could not load your records' }); }
});

// ── DOWNLOAD STATEMENT (server-generated PDF) ──
// Owner: "put a server side advanced feature called download statement, so
// it downloads statement of the account as pdf very well organized
// statement with all data... check how the statement looks you can check
// the branch of voltrapower, it was downloading a good account statement so
// do it." Voltra's own equivalent (original_module.js's downloadStatement)
// builds the PDF client-side with jsPDF loaded from a CDN -- the owner
// explicitly asked for this one server-side instead, so the PDF bytes are
// generated here with `pdfkit` (pure JS, no native deps, no browser needed)
// and streamed back as a real file download; the client only triggers the
// request and saves the blob, per doDownloadStatement() in
// user-src/original_module.js.
//
// Category labels/status text are a deliberate re-implementation of the
// same logic the in-app Transaction Statement screen already uses
// (statementDescription()/statementStatus() in original_module.js) --
// duplicated on purpose, same "must match" precedent as phoneToEmail()
// elsewhere in this file, so a PDF and the in-app screen never disagree
// about what a given transaction type is called.
function statementRowLabel(t, brand) {
  const type = t.type;
  if (type === 'deposit') return 'Recharge';
  if (type === 'withdraw') return 'Withdraw';
  if (type === 'cashback') return 'Daily Income';
  if (type === 'commission') return 'Referral Commission';
  if (type === 'promocode') return 'Gift Code';
  if (type === 'checkin') return 'Check-in Reward';
  if (type === 'welcome_bonus') return 'Welcome Bonus';
  if (type === 'team_reward') return 'Team Reward';
  if (type === 'mission_salary') return 'Mission Salary';
  if (type === 'mission_deposit_reward') return 'Mission Reward';
  if (type === 'turntable' || type === 'spin' || type === 'spin_bonus') return 'Reward';
  if (type === 'admin_credit') return brand + ' Credit';
  if (type === 'admin_debit') return brand + ' Adjustment';
  return 'Transaction';
}
function statementRowStatus(t) {
  const raw = (String(t.status || '').toLowerCase() + ' ' + String(t.description || '').toLowerCase());
  if (/fail|declin|reject|cancel|error/.test(raw)) return 'Failed';
  if (/pend|process|await|initiating/.test(raw)) return 'Pending';
  return 'Completed';
}
app.get('/statement/pdf', async (req, res) => {
  const uid = await verifyAuth(req);
  if (!uid) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    await settleAllForUser(uid);
    // settleAllForUser() must finish first (it can change the wallet total
    // and add a fresh transaction row) -- but everything below only depends
    // on ITS result, not on each other, so they no longer wait in a line.
    // This was the real cause of "why does downloading a statement take a
    // few seconds on a powerful VPS" -- four independent round trips
    // (user doc, settings, up to 2000 transactions, the logo image) were
    // running one after another instead of together.
    const STATEMENT_TX_LIMIT = 2000; // same cap as GET /transactions above
    const [userSnap, sett, snap, logoDataUri] = await Promise.all([
      db.collection('users').doc(uid).get(),
      getSettings(),
      db.collection('transactions').where('userId', '==', uid).orderBy('createdAt', 'desc').limit(STATEMENT_TX_LIMIT).get(),
      getSodaImage('logo'),
    ]);
    if (!userSnap.exists) return res.status(404).json({ status: 'error', message: 'User not found' });
    const u = userSnap.data();
    if (u.status === 'banned') return res.status(403).json({ status: 'error', message: 'Account suspended.' });
    const brand = sett.brandName || 'Soda';
    const currency = currentRegion().currency || 'UGX';
    const rows = snap.docs.map(d => ({ id: d.id, ...d.data(), statementId: statementIdFor(d) }));
    // Same admin-uploaded 'logo' slot the app itself shows on Home/Account/
    // Auth (STATE.brandLogo) -- so uploading a logo once already covers the
    // PDF too, no separate upload needed. Stored as a data: URI (same shape
    // an <img src> takes client-side); pdfkit's doc.image() wants real
    // bytes, so it's decoded here rather than trusting doc.image() to
    // understand a data: URI string across every pdfkit version.
    let logoBuf = null;
    if (logoDataUri) {
      const m = /^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/.exec(logoDataUri);
      if (m) { try { logoBuf = Buffer.from(m[1], 'base64'); } catch (_) { logoBuf = null; } }
    }

    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    const done = new Promise((resolve, reject) => {
      doc.on('end', resolve);
      doc.on('error', reject);
    });

    const PAGE_W = doc.page.width;
    const RED = '#e30613', GOLD = '#f5a000', INK = '#25262b', MUTED = '#6b6d76';
    const GREEN = '#1a7a3e', ROSE = '#b10510';
    const COL = { id: 40, date: 150, desc: 235, status: 375, amt: 430 };
    const AMT_W = PAGE_W - 40 - COL.amt;

    function drawHeader() {
      doc.rect(0, 0, PAGE_W, 92).fill(RED);
      doc.rect(0, 88, PAGE_W, 4).fill(GOLD);
      // Same admin-uploaded logo the app shows everywhere else -- text
      // shifts right to make room for it only when one is actually set, so
      // a fresh deploy with no logo uploaded yet still looks intentional.
      let textX = 40;
      if (logoBuf) {
        try { doc.image(logoBuf, 40, 22, { fit: [48, 48] }); textX = 98; } catch (_) { textX = 40; }
      }
      doc.fillColor('#fff').font('Helvetica-Bold').fontSize(22).text(brand.toUpperCase(), textX, 28);
      doc.font('Helvetica').fontSize(11).text('Financial Statement', textX, 56);
      doc.fillColor(INK);
    }
    function drawColumnHeads(y) {
      doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED);
      doc.text('REFERENCE', COL.id, y);
      doc.text('DATE / TIME', COL.date, y);
      doc.text('DESCRIPTION', COL.desc, y);
      doc.text('STATUS', COL.status, y);
      doc.text('AMOUNT', COL.amt, y, { width: AMT_W, align: 'right' });
      doc.moveTo(40, y + 12).lineTo(PAGE_W - 40, y + 12).strokeColor('#dcdde0').lineWidth(0.5).stroke();
    }
    drawHeader();
    let y = 112;
    doc.font('Helvetica-Bold').fontSize(10).fillColor(INK);
    // Owner: "remove stuffs for account ids everywhere" -- Account ID
    // dropped. "Statement should be EAST AFRICAN TIME" -- eatNow() is the
    // same region-wall-clock helper every stored transaction date/time on
    // this statement was already written against (see its own comment
    // above), so the generated-at stamp now uses the identical clock as
    // every row beneath it instead of a separate UTC one.
    const genAt = eatNow();
    const padGen = n => String(n).padStart(2, '0');
    // Owner: "Generated Sep 28, 2026 at 11:12 EAT" -- month name, no
    // leading zeros on day/year, seconds dropped. Same eatNow() clock as
    // every row on the statement, just formatted for a human to read
    // rather than sorted by a machine.
    const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const generatedStr = MONTH_NAMES[genAt.getUTCMonth()] + ' ' + genAt.getUTCDate() + ', ' + genAt.getUTCFullYear()
      + ' at ' + padGen(genAt.getUTCHours()) + ':' + padGen(genAt.getUTCMinutes()) + ' EAT';
    // Owner: "put also document reference bro" -- a per-download reference
    // distinct from each row's own statementId (the unrelated "B2<16
    // digits>" ledger format below) and deliberately NOT shaped like the
    // owner's own example (a giant raw timestamp + date + random tail).
    // Three short groups from the same unambiguous alphabet already used
    // for gift/referral codes -- easy to read aloud, and its 3-3-3 shape
    // (vs. gift codes' 4-4-4 and referral codes' flat 5) keeps it from
    // being mistaken for either. Purely a display label for this one PDF,
    // not looked up anywhere, so no uniqueness check is needed.
    const docRef = 'REF-' + randFromAlphabet(GIFTCODE_CHARS, 3) + '-' + randFromAlphabet(GIFTCODE_CHARS, 3) + '-' + randFromAlphabet(GIFTCODE_CHARS, 3);
    const meta = [
      ['Reference', docRef],
      ['Account holder', u.phone || '-'],
      ['Wallet balance', fmtMoney(u.walletBalance || 0, currency)],
      ['Total topped up', fmtMoney(u.totalDeposited || 0, currency)],
      ['Total cashed out', fmtMoney(u.totalWithdrawn || 0, currency)],
      ['Generated', generatedStr],
    ];
    meta.forEach(([label, value]) => {
      doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED).text(label + ':', 40, y, { continued: false });
      doc.font('Helvetica').fontSize(9).fillColor(INK).text(String(value), 175, y);
      y += 15;
    });
    y += 8;
    drawColumnHeads(y);
    y += 20;

    let totalIn = 0, totalOut = 0;
    if (!rows.length) {
      doc.font('Helvetica').fontSize(9).fillColor(MUTED).text('No transactions yet.', 40, y);
      y += 16;
    }
    rows.forEach(t => {
      if (y > doc.page.height - 90) {
        doc.addPage();
        y = 40;
        drawColumnHeads(y);
        y += 20;
      }
      const amt = Number(t.amount) || 0;
      if (amt >= 0) totalIn += amt; else totalOut += -amt;
      const label = statementRowLabel(t, brand);
      const status = statementRowStatus(t);
      const dateTime = (t.date || '') + (t.time ? ' ' + t.time : '');
      doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(String(t.statementId || t.id || '-').slice(0, 20), COL.id, y, { width: COL.date - COL.id - 6 });
      doc.font('Helvetica').fontSize(8.5).fillColor(INK).text(dateTime, COL.date, y, { width: COL.desc - COL.date - 6 });
      doc.font('Helvetica').fontSize(8.5).fillColor(INK).text(label.slice(0, 26), COL.desc, y, { width: COL.status - COL.desc - 6 });
      doc.font('Helvetica').fontSize(8.5).fillColor(status === 'Failed' ? ROSE : status === 'Pending' ? GOLD : GREEN).text(status, COL.status, y, { width: COL.amt - COL.status - 6 });
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(amt >= 0 ? GREEN : ROSE)
        .text((amt >= 0 ? '+' : '-') + fmtMoney(Math.abs(amt), currency), COL.amt, y, { width: AMT_W, align: 'right' });
      y += 16;
    });

    if (y > doc.page.height - 120) { doc.addPage(); y = 40; }
    y += 6;
    doc.moveTo(40, y).lineTo(PAGE_W - 40, y).strokeColor('#dcdde0').lineWidth(0.5).stroke();
    y += 14;
    const summary = [
      ['Total received', '+' + fmtMoney(totalIn, currency), GREEN],
      ['Total paid out', '-' + fmtMoney(totalOut, currency), ROSE],
      ['Current wallet balance', fmtMoney(u.walletBalance || 0, currency), INK],
    ];
    summary.forEach(([label, value, color]) => {
      doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(label, 40, y);
      doc.font('Helvetica-Bold').fontSize(10).fillColor(color).text(value, COL.amt, y, { width: AMT_W, align: 'right' });
      y += 16;
    });
    doc.font('Helvetica').fontSize(8).fillColor(MUTED)
      .text(brand + ' — Clean Energy, Green Development', 40, doc.page.height - 50, { width: PAGE_W - 80, align: 'center' });

    doc.end();
    await done;
    const buffer = Buffer.concat(chunks);
    const filename = brand + '-Statement-' + genAt.getUTCFullYear() + padGen(genAt.getUTCMonth() + 1) + padGen(genAt.getUTCDate()) + '.pdf';
    // Owner: "the statement should be saved in admin panel under
    // transactions so as l see the downloaded statements and their
    // references" -- a record of the download itself, separate from the
    // `transactions` money ledger (it isn't a wallet movement and must
    // never be summed into totalIn/totalOut or any other money figure).
    // phone/ref denormalized onto the row at write time so the admin list
    // below never needs a per-row user lookup. Never lets a logging
    // failure block a member's own already-generated PDF.
    // Fire-and-forget: this is a log write, not part of the PDF the member
    // is waiting on. Awaiting it here would make every download pay for a
    // write round trip it doesn't need -- the try/catch above this comment
    // already established a logging failure must never block the download,
    // so it must not be allowed to slow it down either.
    db.collection('statementDownloads').add({
      userId: uid, phone: u.phone || '', ref: docRef, createdAt: FieldValue.serverTimestamp(),
    }).catch(logErr => console.error('statementDownloads log failed:', logErr.message));
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', 'attachment; filename="' + filename.replace(/[^A-Za-z0-9_.-]/g, '') + '"');
    res.send(buffer);
  } catch (e) {
    console.error('Statement PDF failed:', e.message);
    res.status(500).json({ status: 'error', message: 'Could not generate your statement right now.' });
  }
});
app.get('/deposits', async (req, res) => {
  const uid = await verifyAuth(req);
  if (!uid) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const snap = await db.collection('pendingDeposits').where('userId', '==', uid).orderBy('createdAt', 'desc').limit(200).get();
    res.json({ status: 'success', deposits: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
  } catch (e) { res.status(500).json({ status: 'error', message: 'Could not load recharge history' }); }
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
// Soda has a real inbox -- Snow deliberately does not (see soda/CLAUDE.md's
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
async function listBroadcastMessages() {
  const snap = await db.collection('messages').orderBy('createdAt', 'desc').limit(100).get();
  const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const rows = all.filter(m => !m.deleted);
  // A brand-new deployment has no admin-authored messages yet; the welcome
  // note the mockups show is served as a virtual row so the inbox is never
  // blank on day one. The moment an admin writes a real 'welcome' doc it
  // takes over (same id), so this can't ever duplicate it. Tested against
  // `all`, not `rows` -- an admin who DELETED the welcome message left a
  // tombstone behind, and checking the filtered list would resurrect it.
  //
  if (!all.some(m => m.id === 'welcome')) {
    rows.push({ ...defaultWelcomeMessage(await getSettings()), createdAt: 0, date: '', time: '' });
  }
  return rows;
}
app.get('/messages', async (req, res) => {
  const uid = await verifyAuth(req);
  if (!uid) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const rows = await listBroadcastMessages();
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
  try {
    const token = await createSession('owner', 'owner');
    res.json({ status: 'success', token, username: 'owner', role: 'owner' });
  } catch (_) { res.status(503).json({ status: 'error', message: 'Could not start session. Try again.' }); }
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
// ═══════════════════════════════════════════
// MEMBER LOGIN (MongoDB only -- no Firebase)
// ═══════════════════════════════════════════
// `authAccounts`: one document per member login. The document id is the phone
// ("p" + digits), so a phone can only ever have one account: createIfAbsent()
// is the whole uniqueness guarantee, with no index to forget. The password is
// scrypt-hashed (same helper as admin passwords); the plain password is never
// stored or logged. Sessions are in `memberSessions` (see session-policy.js).
const LOGIN_MAX_FAILS = 6;
const LOGIN_LOCK_MS = 15 * 60 * 1000;
const MEMBER_PASSWORD_MIN = 6, MEMBER_PASSWORD_MAX = 128;
const DUMMY_MEMBER_HASH = scryptHash(crypto.randomBytes(24).toString('hex'));
const memberAccountId = phone => 'p' + String(phone).replace(/\D/g, '');
const newMemberUid = () => crypto.randomBytes(12).toString('hex');
async function findAccountByUid(uid) {
  const snap = await db.collection('authAccounts').where('uid', '==', String(uid)).limit(1).get();
  return snap.empty ? null : { ref: snap.docs[0].ref, id: snap.docs[0].id, ...snap.docs[0].data() };
}
// Sets a new password, clears any lockout and ends the member's sessions
// (except the one that made the change). Used by self-service change, the
// SMS-code reset and the owner's reset.
async function setMemberPassword(uid, newPassword, exceptKey) {
  const acct = await findAccountByUid(uid);
  if (!acct) { const e = new Error('No login exists for this member'); e.code = 'NO_ACCOUNT'; throw e; }
  await acct.ref.update({ passwordHash: scryptHash(newPassword), failCount: 0, lockedUntil: FieldValue.delete(), passwordChangedAt: FieldValue.serverTimestamp() });
  await sessionPolicy.revokeAllMemberSessions(db, uid, exceptKey);
}
async function deleteMemberLogin(uid) {
  const acct = await findAccountByUid(uid);
  if (acct) await acct.ref.delete();
  await sessionPolicy.revokeAllMemberSessions(db, uid);
}
async function recordLoginFailure(id) {
  await withLock('login:' + id, async () => {
    const ref = db.collection('authAccounts').doc(id);
    const snap = await ref.get();
    if (!snap.exists) return;
    const fails = (Number(snap.data().failCount) || 0) + 1;
    if (fails >= LOGIN_MAX_FAILS) await ref.update({ failCount: 0, lockedUntil: new Date(Date.now() + LOGIN_LOCK_MS) });
    else await ref.update({ failCount: fails });
  });
}
// Brute-force limits: this per-IP ceiling on top of the per-phone lockout in
// the document (which survives a restart). Generous because many members share
// one mobile-carrier address.
const memberAuthLimiter = rateLimit({ windowMs: 5 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false,
  message: { status: 'error', code: 'TOO_MANY_REQUESTS', message: 'Too many attempts. Please wait a few minutes and try again.' } });
const memberSignupLimiter = rateLimit({ windowMs: 5 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false,
  message: { status: 'error', code: 'TOO_MANY_REQUESTS', message: 'Too many attempts. Please wait a few minutes and try again.' } });
const sessionReply = (res, uid, sess) => res.json({ status: 'success', token: sess.token, uid, authTime: sess.authTime, expiresAt: sess.expiresAt });
app.post('/auth/signup', memberSignupLimiter, async (req, res) => {
  try {
    const phone = cleanPhone(req.body.phone || '');
    if (!phone) return res.status(400).json({ status: 'error', code: 'INVALID_PHONE', message: badPhoneMessage() });
    const password = String(req.body.password || '');
    if (password.length < MEMBER_PASSWORD_MIN || password.length > MEMBER_PASSWORD_MAX)
      return res.status(400).json({ status: 'error', code: 'WEAK_PASSWORD', message: `Password must be ${MEMBER_PASSWORD_MIN} to ${MEMBER_PASSWORD_MAX} characters.` });
    const uid = newMemberUid();
    const created = await db.collection('authAccounts').doc(memberAccountId(phone)).createIfAbsent({
      uid, phone, passwordHash: scryptHash(password), failCount: 0, createdAt: FieldValue.serverTimestamp()
    });
    if (!created) return res.status(409).json({ status: 'error', code: 'PHONE_IN_USE', message: 'An account with this phone number already exists.' });
    sessionReply(res, uid, await sessionPolicy.createMemberSession(db, uid, phone));
  } catch (e) {
    console.error('Signup error:', e.message);
    res.status(500).json({ status: 'error', code: 'SERVER_ERROR', message: 'Could not create your account right now. Please try again.' });
  }
});
app.post('/auth/login', memberAuthLimiter, async (req, res) => {
  try {
    const phone = cleanPhone(req.body.phone || '');
    const password = String(req.body.password || '');
    const bad = () => res.status(401).json({ status: 'error', code: 'INVALID_CREDENTIAL', message: 'Incorrect phone number or password.' });
    if (!phone || !password || password.length > MEMBER_PASSWORD_MAX) return bad();
    const id = memberAccountId(phone);
    const snap = await db.collection('authAccounts').doc(id).get();
    const acct = snap.exists ? snap.data() : null;
    if (acct && acct.lockedUntil && tsMillis(acct.lockedUntil) > Date.now()) {
      const wait = Math.ceil((tsMillis(acct.lockedUntil) - Date.now()) / 1000);
      return res.status(429).json({ status: 'error', code: 'TOO_MANY_ATTEMPTS', retryAfterSec: wait,
        message: `Too many wrong attempts. Try again in ${Math.ceil(wait / 60)} minute${wait > 60 ? 's' : ''}.` });
    }
    // The dummy hash makes an unknown phone cost the same as a wrong password,
    // so the answer's timing cannot be used to find which numbers have accounts.
    const ok = scryptVerify(password, acct ? acct.passwordHash : DUMMY_MEMBER_HASH);
    if (!acct || !ok) { if (acct) await recordLoginFailure(id); return bad(); }
    if (Number(acct.failCount) > 0) await snap.ref.update({ failCount: 0 }).catch(() => {});
    sessionReply(res, acct.uid, await sessionPolicy.createMemberSession(db, acct.uid, acct.phone));
  } catch (e) {
    console.error('Login error:', e.message);
    res.status(500).json({ status: 'error', code: 'SERVER_ERROR', message: 'Could not sign you in right now. Please try again.' });
  }
});
app.post('/auth/password/change', memberAuthLimiter, async (req, res) => {
  try {
    const decoded = await _decodeAuth(req);
    if (!decoded) return res.status(401).json({ status: 'error', message: 'Please sign in again' });
    const oldPassword = String(req.body.oldPassword || ''), newPassword = String(req.body.newPassword || '');
    if (newPassword.length < MEMBER_PASSWORD_MIN || newPassword.length > MEMBER_PASSWORD_MAX)
      return res.status(400).json({ status: 'error', code: 'WEAK_PASSWORD', message: `Password must be ${MEMBER_PASSWORD_MIN} to ${MEMBER_PASSWORD_MAX} characters.` });
    const acct = await findAccountByUid(decoded.uid);
    if (!acct) return res.status(404).json({ status: 'error', message: 'Account not found' });
    if (acct.lockedUntil && tsMillis(acct.lockedUntil) > Date.now())
      return res.status(429).json({ status: 'error', code: 'TOO_MANY_ATTEMPTS', message: 'Too many wrong attempts. Try again in a few minutes.' });
    if (!scryptVerify(oldPassword, acct.passwordHash)) {
      await recordLoginFailure(acct.id);
      return res.status(401).json({ status: 'error', code: 'INVALID_CREDENTIAL', message: 'Your current password is incorrect.' });
    }
    await setMemberPassword(decoded.uid, newPassword, decoded.key);
    res.json({ status: 'success', message: 'Password changed.' });
  } catch (e) {
    console.error('Password change error:', e.message);
    res.status(500).json({ status: 'error', message: 'Could not change your password right now.' });
  }
});
app.post('/auth/session/activity', async (req, res) => {
  if (!(await verifyAuth(req))) return res.status(401).json({ status: 'error', message: 'Session expired. Log in again.' });
  res.json({ status: 'success' });
});
app.post('/auth/session/logout', async (req, res) => {
  // update() throws NOT_FOUND for a missing record, and in an async Express 4
  // handler that left the request hanging with no answer. Signing out must
  // always answer, whether or not there was a session record to revoke.
  try {
    const decoded = await _decodeAuth(req);
    if (decoded) await db.collection('memberSessions').doc(decoded.key).update({ revoked: true });
  } catch (e) { console.error('Session logout error:', e.message); }
  res.json({ status: 'success' });
});
app.post('/admin/session/activity', (req, res) => {
  if (!req.adminUser) return res.status(401).json({ status: 'error', message: 'Session expired. Sign in again.' });
  res.json({ status: 'success' });
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
  if (username === 'owner' || username === 'owner-key') return res.status(400).json({ status: 'error', message: 'That username is reserved.' });
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
  if (!token || token.length > 4096) return res.status(400).json({ status: 'error', message: 'Missing token' });
  try {
    const owner = verifyOwner(req);
    const ref = db.collection('adminPushTokens').doc(token);
    const prev = await ref.get();
    const was = prev.exists ? prev.data() : {};
    // A one-off secret for THIS device's "Approve" button on a withdrawal
    // alert. It is deliberately not the master ADMIN_KEY or a login session
    // (so it can only ever reach one route), it is never sent back to the
    // page, and it exists only for owner devices -- a staff registration
    // writes the record WITHOUT one (a full replace, so a device that changes
    // from owner to staff loses it). It survives re-registration of the same
    // token so it does not rotate on every refresh.
    const fields = {
      token, username: req.adminUser?.username || 'owner-key', role: owner ? 'owner' : 'staff',
      registeredAt: was.registeredAt || FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    };
    if (owner) fields.quickApproveSecret = was.quickApproveSecret || crypto.randomUUID();
    await ref.set(fields);
    res.json({ status: 'success', quickApprove: owner });
  } catch (e) { res.status(500).json({ status: 'error', message: 'Could not register for notifications' }); }
});
app.post('/admin/push/unregister', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const token = String(req.body.token || '').trim();
  if (!token) return res.status(400).json({ status: 'error', message: 'Missing token' });
  try {
    const ref = db.collection('adminPushTokens').doc(token);
    // `rotated`: the browser replaced this token with a new one (service-worker
    // update, routine rotation). Keep the record, retired, so an alert that was
    // already delivered with its Approve button still works; switching Notify
    // off sends a plain unregister, which deletes it at once.
    if (req.body.rotated === true && (await ref.get()).exists) await ref.update({ retiredAt: new Date() });
    else await ref.delete();
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
    res.json({ status: 'success', count: snap.size, tokens: snap.docs.map(d => ({ token: d.id.slice(0, 16) + '…', role: d.data().role || null, quickApprove: !!d.data().quickApproveSecret, registeredAt: d.data().registeredAt || null })) });
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
  try { res.json({ status: 'success', settings: await getSettings() }); }
  catch (e) { res.status(500).json({ status: 'error', message: 'Could not load settings' }); }
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
  // Signed-in member pages only. These do NOT affect Login/Sign Up/Forgot.
  innerBgOpacity: [0, 100], innerBgBlur: [0, 40],
  otpDailyLimitReset: [0, 50], otpDailyLimitBank: [0, 50],
  // UGX per 1 USDT. Upper bound is a sanity cap (nobody's rate is anywhere
  // near this), not a business one -- same reasoning as withdrawMultiple.
  usdtRate: [0, MAX_MONEY_AMOUNT],
};
const SETTINGS_BOOLEAN_FIELDS = ['maintenanceMode', 'openingCountdownEnabled', 'requireInvestToWithdraw', 'autoApproveWithdrawalsEnabled', 'annEnabled', 'turntableEnabled', 'requireReferralCode', 'withdrawWindowEnabled', 'blockRootDomain', 'bankOtpRequired', 'usdtEnabled', 'cardDepositEnabled', 'otpVerificationEnabled'];
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
// Same XSS class as SETTINGS_URL_FIELDS above: supportEmail is rendered
// into href="mailto:${esc(...)}" (openSupportSheet() and the Home Support
// tile in user-src/original_module.js), and esc() does not touch the URI
// scheme. A plain "looks like an email" check keeps a "javascript:..."
// value from ever being savable here in the first place.
const SETTINGS_EMAIL_FIELDS = ['supportEmail'];
function isSafeEmail(v) {
  if (!v) return true; // blank clears the field -- always allowed
  return /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(String(v)) && String(v).length <= 120;
}
app.post('/admin/settings/update', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const updates = req.body.settings || {};
    if ('strictRegionHosts' in updates || 'rotateEntry' in updates)
      return res.status(400).json({ status: 'error', message: 'Country address options have been retired.' });
    if (req.body.region && req.body.region !== DEFAULT_REGION_KEY)
      return res.status(400).json({ status: 'error', message: 'Only Uganda settings are supported.' });
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
    for (const key of SETTINGS_EMAIL_FIELDS) {
      if (key in updates && !isSafeEmail(updates[key]))
        return res.status(400).json({ status: 'error', message: `${key} must be a valid email address, or left blank.` });
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
    // The USDT receiving wallet address. A real TRC20 address is base58
    // (letters/digits only, no I/l/O/0 by construction of that alphabet) and
    // 34 characters -- rejected outright rather than silently accepted and
    // shown to every member as a place to send real money to, on a typo.
    // Blank is always allowed (clears the field / leaves the feature
    // unusable until a real one is set, same as usdtRate defaulting to 0).
    if ('usdtWalletAddress' in updates) {
      const addr = String(updates.usdtWalletAddress == null ? '' : updates.usdtWalletAddress).trim();
      if (addr && !/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(addr))
        return res.status(400).json({ status: 'error', message: 'That does not look like a valid TRC20 wallet address (should start with T, 34 characters).' });
      updates.usdtWalletAddress = addr;
    }
    // The two withdraw times. Refused rather than coerced: a silently
    // repaired time is a window the owner did not choose, on a screen whose
    // whole job is telling members exactly when they can withdraw.
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
        return res.status(400).json({ status: 'error', message: 'Withdraw opening and closing times cannot be the same.' });
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
    // Stamped whenever the admin saves either announcement field, so the
    // Home screen's inline "Latest Announcement" row can show a real date
    // instead of inventing one. Not conditioned on the text actually being
    // different from what's stored -- "the admin just touched this" is a
    // fine enough definition of "updated" here, and checking for a real
    // diff would cost an extra read for a purely cosmetic date.
    if ('annTitle' in updates || 'annBody' in updates) updates.annUpdatedAt = FieldValue.serverTimestamp();
    await db.collection('settings').doc('main').set(updates, { merge: true });
    _settingsCacheTs = 0;
    // Apply a domain change NOW rather than up to 60s later: the owner saves
    // this field precisely because a site is currently being refused, and
    // being told "wait a minute" while staring at a broken page is how a
    // working fix gets mistaken for a broken one.
    if ('allowedOrigins' in updates) { _mainAllowedHosts = updates.allowedOrigins; refreshCorsSnapshot(); }
    // Apply the host rules NOW rather than up to 60s later: the owner saves
    // these precisely because an address is behaving wrongly, and being
    // told to wait a minute while staring at it is how a working fix gets
    // mistaken for a broken one. Same reasoning as allowedOrigins above.
    if (['baseDomain', 'blockRootDomain', 'parkedHosts'].some(k => k in updates)) {
      try { refreshHostPolicy(await getSettings(DEFAULT_REGION_KEY)); } catch (_) {}
    }
    logAdminAction(req, 'settings_updated', { fields: Object.keys(updates) });
    res.json({ status: 'success' });
  } catch (e) { res.status(500).json({ status: 'error', message: 'Could not save settings' }); }
});
app.get('/admin/soda-images', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const [logo, authhero, banner2, banner3, checkinbanner, profilelogo, loaderbg] = await Promise.all([
      getSodaImage('logo'),
      getSodaImage('authhero'), getSodaImage('banner2'),
      getSodaImage('banner3'), getSodaImage('checkinbanner'), getSodaImage('profilelogo'), getSodaImage('loaderbg'),
    ]);
    res.json({ status: 'success', logo, authhero, banner2, banner3, checkinbanner, profilelogo, loaderbg });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/soda-image/set', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const slot = String(req.body.slot || '');
  if (!SODA_IMAGE_SLOTS.includes(slot)) return res.status(400).json({ status: 'error', message: 'Unknown image slot' });
  const image = String(req.body.image || '');
  if (!/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(image) || image.length > 2_800_000)
    return res.status(400).json({ status: 'error', message: 'Invalid image' });
  try {
    await db.collection('banners').doc('soda-' + slot).set({ image });
    delete _sodaImageCache[slot];
    logAdminAction(req, 'soda_image_set', { slot });
    res.json({ status: 'success' });
  } catch (e) { res.status(500).json({ status: 'error', message: 'Could not save this image' }); }
});
app.post('/admin/soda-image/clear', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const slot = String(req.body.slot || '');
  if (!SODA_IMAGE_SLOTS.includes(slot)) return res.status(400).json({ status: 'error', message: 'Unknown image slot' });
  try {
    await db.collection('banners').doc('soda-' + slot).set({ image: null });
    delete _sodaImageCache[slot];
    logAdminAction(req, 'soda_image_cleared', { slot });
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
    const icon = await getBrandAsset('app-icon-512');
    const url = a => (a && a.buf) ? `data:${a.mime};base64,${a.buf.toString('base64')}` : null;
    res.json({
      status: 'success',
      appIcon: url(icon), appIconCustom: !!(icon && icon.custom),
      sizes: { appIcon: '512 × 512' }
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
app.get('/admin/banner', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try { res.json({ status: 'success', ...(await getHomeBanner()) }); }
  catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/banner/set', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const image = String(req.body.image || '');
  if (!/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(image) || image.length > 2_800_000)
    return res.status(400).json({ status: 'error', message: 'Invalid image' });
  try {
    const ref = db.collection('banners').doc('home');
    const snap = await ref.get();
    await ref.set({ ...(snap.exists ? snap.data() : {}), image });
    _bannerCacheTs = 0;
    logAdminAction(req, 'banner_set', { fields: 'image' });
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
app.get('/admin/rules-content', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try { res.json({ status: 'success', blocks: await getRulesContent() }); }
  catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
app.post('/admin/rules-content/set', async (req, res) => {
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
  if (totalSize > 11_000_000) return res.status(400).json({ status: 'error', message: 'Total content is too large -- remove or compress some images' });
  try {
    await db.collection('content').doc('rules').set({ blocks });
    _rulesCache = blocks;
    _rulesCacheTs = Date.now();
    logAdminAction(req, 'rules_content_set', { blockCount: blocks.length });
    res.json({ status: 'success' });
  } catch (e) { res.status(500).json({ status: 'error', message: 'Could not save the Rules and Regulations page' }); }
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
  // Padded BEFORE parsing, exactly as the withdraw-hours settings route does:
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
  // Without these the purchase would quietly fall back to the built-in
  // x30 over 150 days and promise the member a payout nobody chose.
  if (cycle == null) return refuse('Cycle (days)', 'is required');
  if (multiplier == null && expectedReturn == null) return refuse('Multiplier (×)', 'or the total payout is required');
  const image = typeof p?.image === 'string' ? p.image.slice(0, 2_800_000) : '';
  const order = p?.order != null ? Number(p.order) : fallbackOrder;
  // How many of this asset one member may own (the "0/3" badge on the card). 0 or blank = no limit.
  let buyLimit = 0;
  if (p?.buyLimit != null && p.buyLimit !== '') {
    buyLimit = Number(p.buyLimit);
    if (!Number.isInteger(buyLimit) || buyLimit < 0 || buyLimit > 1000) return refuse('Purchase limit', 'must be a whole number from 0 to 1000 (0 = no limit)');
  }
  // The VIP number this asset gives its owner (0 = none). A member's VIP is the
  // highest number among the assets they own, bought or given.
  let vip = 0;
  if (p?.vip != null && p.vip !== '') {
    vip = Number(p.vip);
    if (!Number.isInteger(vip) || vip < 0 || vip > 100) return refuse('VIP level', 'must be a whole number from 0 to 100');
  }
  return { key, name, price, cycle, expectedReturn, multiplier, buyLimit, vip, spinMin, spinMax, spinCount, image, active: p?.active !== false, comingSoon: p?.comingSoon === true, openAt, openFrom, openTo, order: Number.isFinite(order) ? order : fallbackOrder, deleted: false };
}
// `?region=ke` hands the editor that region's view of every product -- its
// own price where it has one, Uganda's where it has not -- plus `overrides`,
// the per-product list of fields that region has actually set, so the panel
// can show which figures are its own and which are still inherited.
// Without a region it returns the RAW documents exactly as before, which is
// the founding region's own editor.
// ── STARTER ASSETS: Soda A to Soda J ──
// Owner: "name them Soda A, B, C, D ... so they will be 10, I will come and edit the
// existing prices from the admin panel, and the names are editable too." They are
// ordinary saved assets (name, price, cycle, multiplier, VIP, picture all editable or
// deletable in Admin > Assets). The prices below are only placeholders for the owner to
// replace. Created once ever, on the first start with an empty asset list, and on demand
// by the admin button "Add Soda A to J" (which never touches an asset that already exists).
const STARTER_ASSETS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'].map((letter, i) => ({
  key: 'soda' + letter.toLowerCase(), name: 'Soda ' + letter,
  price: [30000, 60000, 90000, 120000, 150000, 200000, 300000, 500000, 700000, 1000000][i],
  cycle: 8, multiplier: 3, buyLimit: 0, vip: 0, order: i,
}));
async function createStarterAssets() {
  let created = 0;
  for (let i = 0; i < STARTER_ASSETS.length; i++) {
    const clean = sanitizeProductInput(STARTER_ASSETS[i], i);
    if (!clean) continue;
    const ref = db.collection('products').doc(clean.key);
    const snap = await ref.get();
    if (snap.exists && !snap.data().deleted) continue;      // an existing asset is never touched
    await ref.set(clean);                                    // missing, or deleted earlier: bring it back
    created++;
  }
  _productsCacheTs = 0;
  return created;
}
async function seedStarterAssetsOnce() {
  const marker = await db.collection('meta').doc('starterAssets').createIfAbsent({ at: new Date() });
  if (!marker) return 0;                                   // already decided on an earlier start
  const existing = await db.collection('products').limit(1).get();
  if (!existing.empty) return 0;                           // the owner already has assets: leave them alone
  return createStarterAssets();
}
app.post('/admin/products/add-starters', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const created = await createStarterAssets();
    logAdminAction(req, 'starter_assets_added', { created });
    res.json({ status: 'success', created });
  } catch (e) { res.status(500).json({ status: 'error', message: 'Could not add the starter assets' }); }
});
app.get('/admin/products', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try { res.json({ status: 'success', products: await getProducts() }); }
  catch (e) { res.status(500).json({ status: 'error', message: 'Could not load assets' }); }
});
app.post('/admin/products/save', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const list = Array.isArray(req.body.products) ? req.body.products : [];
    if (req.body.region && req.body.region !== DEFAULT_REGION_KEY)
      return res.status(400).json({ status: 'error', message: 'Only Uganda assets are supported.' });
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
    sanitized.forEach(p => {
      const rename = renames.find(r => r.newKey === p.key);
      if (rename) {
        batch.delete(db.collection('products').doc(rename.oldKey));
        batch.set(db.collection('products').doc(p.key), p);
      } else {
        batch.set(db.collection('products').doc(p.key), p, { merge: true });
      }
    });
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

// ═══════════════════════════════════════════
// ADMIN — MESSAGES
// ═══════════════════════════════════════════
app.get('/admin/messages/list', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const messages = await listBroadcastMessages();
    res.json({ status: 'success', messages });
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
    await db.collection('messages').doc(id).set({
      title, body, date: stamp.date, time: stamp.time, createdAt: Date.now(), deleted: false,
    }, { merge: true });
    logAdminAction(req, 'message_saved', { id, title });
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
// and /redeem below rolls a real random amount (in cents, e.g. 647.72) for
// each claim, independently. Setting minReward===maxReward
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

// Legacy rows may carry a currency tag, but all new Soda activity is UGX.
function adminRegionFilter() { return null; }
async function adminUserRegions() { return new Map(); }
function rowRegionKey() { return DEFAULT_REGION_KEY; }
function scopeRowsToRegion(rows) {
  return rows.map(row => { row.regionKey = DEFAULT_REGION_KEY; return row; });
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
    await setMemberPassword(userId, newPassword);
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
    // The login lives in authAccounts under an id built from the phone, so
    // moving the number means moving that document -- changing users.phone
    // alone would leave the member signing in with the old number and let
    // someone else register the new one.
    const acct = await findAccountByUid(userId);
    if (!acct) return res.status(404).json({ status: 'error', message: 'No login exists for this member' });
    if (acct.id !== memberAccountId(phone)) {
      const { ref: _ref, id: _id, ...fields } = acct;
      const created = await db.collection('authAccounts').doc(memberAccountId(phone)).createIfAbsent({ ...fields, phone });
      if (!created) return res.status(409).json({ status: 'error', message: 'Another account already uses that phone number.' });
      await acct.ref.delete();
    }
    await db.collection('users').doc(userId).update({ phone });
    await sessionPolicy.revokeAllMemberSessions(db, userId);
    logAdminAction(req, 'user_phone_set', { userId, phone });
    res.json({ status: 'success' });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});
// Owner gives a member an asset ("select a product and activate it for this
// member"). No wallet debit: the member pays nothing, so there is no cash to
// move and nothing to refund. It is an ordinary active investment from then
// on (same cashback schedule, same maturity payout as a purchase), flagged
// `granted` so it is never mistaken for a bought one.
// - Idempotent: the investment document id is derived from a request id the
//   panel generates once per open modal, so a double tap, a retry or a replayed
//   request can only ever create one plan (createIfAbsent).
// - It counts toward totalInvested like any plan, so "Recalculate totals" and
//   the integrity audit (which add up investments.amount) keep agreeing with the
//   member's stored figure, and "Purchase a plan before withdrawing" is met.
// - No referral commission: commissions are paid on deposits only.
app.post('/admin/user/grant-asset', async (req, res) => {
  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const userId = String(req.body.userId || '');
  const requestId = String(req.body.requestId || '');
  if (!userId || !/^[A-Za-z0-9_-]{8,64}$/.test(requestId))
    return res.status(400).json({ status: 'error', message: 'userId and a valid requestId are required' });
  try {
    const tier = await getProductByKey(String(req.body.tierKey || ''));
    if (!tier || tier.deleted) return res.status(400).json({ status: 'error', message: 'Unknown asset' });
    const sett = await getSettings();
    const invId = 'grant-' + requestId;
    const invRef = db.collection('investments').doc(invId);
    let alreadyGiven = false;
    await withLock('bal:' + userId, async () => {
      const uRef = db.collection('users').doc(userId);
      const u = await uRef.get();
      if (!u.exists) throw new Error('User not found');
      if (u.data().status === 'banned') throw new Error('This account is suspended. Unban it before giving an asset.');
      const price = Number(tier.price) || 0;
      if (!(price > 0)) throw new Error('This asset has no price set');
      const cycle = Number(tier.cycle) || sett.cycleDays;
      const expectedReturn = productExpectedReturn(tier, sett);
      const { date, time } = nowStr();
      const created = await invRef.createIfAbsent({
        userId, tierKey: tier.key, tierLabel: tier.name, amount: price, cycle, expectedReturn,
        status: 'active', dailyPayout: Math.round(expectedReturn / cycle), payoutsTotal: cycle, payoutsMade: 0, paidOut: 0,
        isFirstInvestment: false, commissionBasis: 'deposit', commissionPaidLevels: [], commissionPending: false,
        granted: true, grantedBy: (req.adminUser && req.adminUser.username) || 'owner', requestId,
        date, time, createdAt: FieldValue.serverTimestamp()
      });
      if (!created) { alreadyGiven = true; return; }
      // The plan exists first: if anything below fails, the worst case is a
      // total that is short by this plan, which "Recalculate totals" repairs.
      await uRef.update({ totalInvested: FieldValue.increment(price), firstInvestmentDone: true });
      await db.collection('transactions').doc('grant-asset:' + invId).createIfAbsent({
        userId, statementId: newStatementId(), type: 'investment', description: `${tier.name} activated`, amount: 0,
        status: 'success', date, time, investmentId: invId, createdAt: FieldValue.serverTimestamp()
      }).catch(e => console.warn('grant-asset ledger row failed (plan is active):', e.message));
    });
    if (!alreadyGiven) logAdminAction(req, 'asset_grant', { userId, tierKey: tier.key, investmentId: invId, price: Number(tier.price) || 0 });
    res.json({ status: 'success', alreadyGiven, investmentId: invId, message: alreadyGiven ? 'That asset was already given.' : `${tier.name} activated for this member` });
  } catch (e) { res.status(400).json({ status: 'error', message: e.message }); }
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
      // Deliberately does NOT write a new transactions row for this recharge --
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
    try { const acct = await findAccountByUid(userId); phone = acct ? (cleanPhone(acct.phone) || '') : ''; } catch (_) {}
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
    const commissionUser = await db.collection('users').doc(userId).get();
    const firstDepositId = commissionUser.exists && commissionUser.data().firstReferralDepositId;
    if (firstDepositId) {
      const depositRef = db.collection('pendingDeposits').doc(firstDepositId);
      await depositRef.update({ commissionPending: true });
      commissionTriggered = await creditDepositReferralCommission(firstDepositId, userId);
    } else {
      const invSnap = await db.collection('investments').where('userId', '==', userId).where('isFirstInvestment', '==', true).limit(1).get();
      if (!invSnap.empty && invSnap.docs[0].data().commissionBasis !== 'deposit') {
        const inv = invSnap.docs[0];
        commissionTriggered = await creditReferralCommission(inv.id, userId, inv.data().amount);
      }
    }
    logAdminAction(req, 'referrer_attached', { userId, referralCode: code, referrerId, commissionTriggered });
    res.json({ status: 'success', commissionTriggered });
  } catch (e) { res.status(e.code || 500).json({ status: 'error', message: e.message }); }
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
    if (!inFlightDepSnap.empty) return res.status(409).json({ status: 'error', message: 'This account has a recharge still being confirmed with the payment provider. Wait a moment for it to settle, then try deleting again.' });
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
    try { await deleteMemberLogin(userId); } catch (_) {}
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
      t.set(db.collection('transactions').doc(), { userId, statementId: newStatementId(), type: 'admin_credit', description: creditDesc, amount: amt, status: 'success', date, time, createdAt: FieldValue.serverTimestamp() });
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
      t.set(db.collection('transactions').doc(), { userId, statementId: newStatementId(), type: 'admin_debit', description: note || 'Balance adjustment', amount: -amt, status: 'success', date, time, createdAt: FieldValue.serverTimestamp() });
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
    if (!snap.exists) return res.status(404).json({ status: 'error', message: 'Recharge not found' });
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
    let totalUsers = 0, activeUsers = 0, bannedUsers = 0, walletTotal = 0;
    usersSnap.forEach(d => {
      const u = d.data();
      totalUsers++;
      if (u.status === 'banned') bannedUsers++; else activeUsers++;
      walletTotal += finiteMoney(u.walletBalance);
    });
    let depositAmount = 0;
    depSnap.forEach(d => { depositAmount += finiteMoney(d.data().amount); });
    let withdrawAmount = 0;
    witSnap.forEach(d => { withdrawAmount += finiteMoney(d.data().net); });
    let investedAmount = 0, activeInvestments = 0;
    invSnap.forEach(d => {
      investedAmount += finiteMoney(d.data().amount);
      if (d.data().status === 'active') activeInvestments++;
    });
    const [pendDepSnap, pendWitSnap] = await Promise.all([
      db.collection('pendingDeposits').where('status', 'in', ['pending', 'initiating', 'review']).limit(STATS_SCAN_LIMIT).get(),
      db.collection('withdrawals').where('status', '==', 'pending').limit(STATS_SCAN_LIMIT).get(),
    ]);
    const pendingDepCount = pendDepSnap.docs.length;
    const pendingWitCount = pendWitSnap.docs.length;
    // In a one-country view the scalar fields stay backward-compatible. In
    // All countries they are null on purpose: UGX + KES is not money. The
    // grouped rows are the only meaningful financial totals in that mode.
    // Judged on the RAW reads, before the country filter: the ceiling was hit
    // or it was not, and calling one country's share of a capped scan
    // "complete" would be the very lie the cap is being flagged for.
    const truncated = [usersSnap, depSnap, witSnap, invSnap, pendDepSnap, pendWitSnap]
      .some(snap => snap.docs.length >= STATS_SCAN_LIMIT);
    res.json({
      status: 'success', truncated,
      stats: {
        totalUsers, activeUsers, bannedUsers,
        walletTotal, depositAmount, withdrawAmount, investedAmount,
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
    const region = DEFAULT_REGION;
    const d = await marzGetBalance(region);
    if (d.status !== 'success') return res.status(502).json({ status: 'error', message: marzUserMsg(d, 'Could not reach MarzPay') });
    res.json({ status: 'success', amount: d.amount, formatted: d.formatted, currency: d.currency, accountStatus: d.accountStatus });
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
// has gone in and out through this gateway" -- from SODA'S OWN RECORDS,
// which are exact for what we sent and received. It is NOT their float: it
// cannot see settlements to a bank account, their fees, or anything moved
// outside Soda, and the panel says so in those words rather than letting a
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
    const [depSnap, witSnap, sett] = await Promise.all([
      db.collection('pendingDeposits').where('provider', '==', 'pesajet').limit(PESAJET_SUMMARY_SCAN).get(),
      db.collection('withdrawals').where('pesajetRef', '>', '').limit(PESAJET_SUMMARY_SCAN).get(),
      getSettings(),
    ]);
    const truncated = depSnap.size >= PESAJET_SUMMARY_SCAN || witSnap.size >= PESAJET_SUMMARY_SCAN;
    const zero = () => ({ collected: 0, collectedCount: 0, paidOut: 0, paidOutCount: 0,
                          pendingIn: 0, pendingInCount: 0, pendingOut: 0, pendingOutCount: 0 });
    const summary = Object.assign({ regionKey: 'ug', currency: 'UGX' }, zero());
    for (const d of depSnap.docs) {
      const row = d.data();
      const amt = finiteMoney(row.displayAmount != null ? row.displayAmount : row.amount);
      const b = summary;
      // depositFullyCredited() is the same test the rest of this file uses for
      // "this deposit really landed" -- status alone is not enough, because
      // claim-before-credit can leave 'matched' with the wallet write unfinished.
      if (depositFullyCredited(row)) { b.collected += amt; b.collectedCount++; }
      else if (row.status === 'pending' || row.status === 'initiating') { b.pendingIn += amt; b.pendingInCount++; }
    }
    for (const w of witSnap.docs) {
      const row = w.data();
      const amt = finiteMoney(row.net != null ? row.net : row.amount);
      const b = summary;
      if (row.status === 'processed') { b.paidOut += amt; b.paidOutCount++; }
      else if (row.status === 'processing' || row.status === 'sending') { b.pendingOut += amt; b.pendingOutCount++; }
    }
    summary.net = round2(summary.collected - summary.paidOut);
    res.json({
      status: 'success', truncated, regions: [summary],
      configured: pesajetConfigured(),
      // Whether this gateway is actually in the path right now, so the panel
      // can keep the card out of the way of an operator who does not use it.
      selected: depositProvider(sett) === 'pesajet' || withdrawProvider(sett) === 'pesajet',
      // Said here rather than only in the panel, so an operator reading the
      // raw response is not misled either.
      note: 'Soda\'s own record of money moved through PesaJet. PesaJet publishes no balance endpoint, so this is not the float in their account.',
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
// Owner: "the statement should be saved in admin panel under transactions
// so as l see the downloaded statements and their references" -- lists
// `statementDownloads` rows (written by GET /statement/pdf above), same
// shape/cap convention as /admin/transactions/list. Kept as its own
// endpoint/collection rather than folded into `transactions` itself: a
// statement download is not a wallet movement, and mixing it into the
// money ledger would risk it getting summed into totalIn/totalOut
// somewhere down the line.
app.post('/admin/statements/list', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const requested = parseInt(req.body.limit, 10);
    const LIST_LIMIT = Number.isFinite(requested) ? Math.min(5000, Math.max(50, requested)) : 300;
    const snap = await db.collection('statementDownloads').orderBy('createdAt', 'desc').limit(LIST_LIMIT).get();
    const statements = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json({ status: 'success', statements, truncated: statements.length >= LIST_LIMIT });
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
// Read-only schedule math mirrors settlement's cumulative rounding. Each
// instalment falls 24 hours after purchase, never at calendar midnight.
function analyticsContractDay(inv, start, end, now) {
  const created = tsMillis(inv.createdAt);
  const total = Number(inv.payoutsTotal);
  const expected = Number(inv.expectedReturn);
  const made = Number(inv.payoutsMade);
  const paid = Number(inv.paidOut);
  if (!created || !Number.isInteger(total) || total <= 0 ||
      !Number.isFinite(expected) || expected < 0 || !Number.isInteger(made) ||
      made < 0 || made > total || !Number.isFinite(paid) || paid < 0) return null;
  const target = n => Math.round(expected * n / total);
  const first = Math.max(1, Math.ceil((start - created) / 86400000));
  const last = Math.min(total, Math.ceil((end - created) / 86400000) - 1);
  const scheduled = last >= first ? target(last) - target(first - 1) : 0;
  const unpaidFirst = Math.max(first, made + 1);
  const unpaid = inv.status === 'active' && last >= unpaidFirst
    ? Math.max(0, target(last) - Math.max(paid, target(unpaidFirst - 1))) : 0;
  const due = Math.max(0, Math.min(total, Math.floor((now - created) / 86400000)));
  const overdue = inv.status === 'active' && due > made ? Math.max(0, target(due) - paid) : 0;
  const maturity = created + total * 86400000;
  return { scheduled, unpaid, overdue, matures: maturity >= start && maturity < end };
}
app.post('/admin/analytics', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const days = Math.min(Math.max(parseInt(req.body.days) || 30, 1), 180);
  const nowMs = Date.now();
  const sinceMs = eatNextMidnight(nowMs) - days * 86400000;
  const today = eatDayKey(new Date(nowMs));
  const requestedDay = String(req.body.day || '');
  const requestedDayMs = /^\d{4}-\d{2}-\d{2}$/.test(requestedDay) ? Date.parse(`${requestedDay}T00:00:00Z`) : NaN;
  const selectedDay = Number.isFinite(requestedDayMs) && new Date(requestedDayMs).toISOString().slice(0, 10) === requestedDay ? requestedDay : today;
  const selectedDayStart = Date.parse(`${selectedDay}T00:00:00Z`) - tzOffMs();
  const selectedDayEnd = selectedDayStart + 86400000;
  try {
    const [depSnap, witSnap, usersSnap, activeInvSnap, contractSnap] = await Promise.all([
      db.collection('pendingDeposits').orderBy('createdAt', 'desc').limit(10000).get(),
      db.collection('withdrawals').orderBy('createdAt', 'desc').limit(10000).get(),
      db.collection('users').limit(10000).get(),
      db.collection('investments').where('status', '==', 'active').limit(10000).get(),
      db.collection('investments').where('status', 'in', ['active', 'matured']).orderBy('createdAt', 'desc').limit(10000).get(),
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
    const dayTotals = { day: selectedDay, depositsCompletedAmount: 0, depositsCompletedCount: 0,
      withdrawalsCompletedAmount: 0, withdrawalsCompletedCount: 0,
      depositsOpenAmount: 0, depositsOpenCount: 0, withdrawalsOpenAmount: 0, withdrawalsOpenCount: 0 };
    const openRequests = { depositsAmount: 0, depositsCount: 0, withdrawalsAmount: 0, withdrawalsCount: 0 };
    depSnap.forEach(d => {
      const dep = d.data();
      if (!mine(dep)) return;
      const createdMs = tsMillis(dep.createdAt);
      const completedMs = tsMillis(dep.creditedAt) || createdMs;
      const credited = dep.status === 'matched' && (dep.walletCredited === true || !dep.needsManualCredit);
      const open = ['pending', 'initiating', 'review'].includes(dep.status) || (dep.status === 'matched' && !credited);
      if (open) { openRequests.depositsAmount += finiteMoney(dep.amount); openRequests.depositsCount++; }
      if (open && createdMs >= selectedDayStart && createdMs < selectedDayEnd) {
        dayTotals.depositsOpenAmount += finiteMoney(dep.amount); dayTotals.depositsOpenCount++;
      }
      if (!credited || !completedMs || completedMs > nowMs) return;
      const a = finiteMoney(dep.amount);
      if (completedMs >= selectedDayStart && completedMs < selectedDayEnd) {
        dayTotals.depositsCompletedAmount += a; dayTotals.depositsCompletedCount++;
      }
      if (completedMs < sinceMs) return;
      depAmount += a; depCount++;
      const { hour, day } = eatParts(new Date(completedMs));
      byHour[hour].depAmt += a; byHour[hour].depCnt++;
      bands[bandOf(hour)].dep += a;
      ensureDay(day).dep += a;
    });

    let witAmount = 0, witCount = 0;
    const bigWits = [];
    witSnap.forEach(d => {
      const w = d.data();
      if (!mine(w)) return;
      const createdMs = tsMillis(w.createdAt);
      const completedMs = tsMillis(w.processedAt) || createdMs;
      const a = w.net == null ? finiteMoney(w.amount) : finiteMoney(w.net);
      const open = ['pending', 'sending', 'processing'].includes(w.status);
      if (open) { openRequests.withdrawalsAmount += a; openRequests.withdrawalsCount++; }
      if (open && createdMs >= selectedDayStart && createdMs < selectedDayEnd) {
        dayTotals.withdrawalsOpenAmount += a; dayTotals.withdrawalsOpenCount++;
      }
      if (w.status !== 'processed' || !completedMs || completedMs > nowMs) return;
      if (completedMs >= selectedDayStart && completedMs < selectedDayEnd) {
        dayTotals.withdrawalsCompletedAmount += a; dayTotals.withdrawalsCompletedCount++;
      }
      if (completedMs < sinceMs) return;
      bigWits.push({ phone: w.phone || w.holder || '', amount: a, when: completedMs });
      witAmount += a; witCount++;
      const { hour, day } = eatParts(new Date(completedMs));
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
      if (ms >= sinceMs && ms <= nowMs) { newUsers++; const { day } = eatParts(u.createdAt); ensureDay(day).users++; }
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
    let teamRewardsPaid = 0, rewardsTruncated = false, rewardsUnavailable = false;
    try {
      const rewardTxSnap = await db.collection('transactions').where('type', '==', 'team_reward').limit(200000).get();
      rewardsTruncated = rewardTxSnap.docs.length >= 200000;
      rewardTxSnap.forEach(d => { const t = d.data(); if (mine(t)) teamRewardsPaid += finiteMoney(t.amount); });
    } catch (e) { teamRewardsPaid = null; rewardsUnavailable = true; console.error('teamRewardsPaid query error:', e.message); }
    referrers.sort((a, b) => (b.team - a.team) || (b.earned - a.earned));
    depositors.sort((a, b) => b.amount - a.amount);

    const byDay = [];
    for (let i = days - 1; i >= 0; i--) {
      const k = new Date(nowMs + tzOffMs() - i * 86400000).toISOString().slice(0, 10);
      byDay.push(dayMap[k] || { day: k, dep: 0, wit: 0, users: 0 });
    }
    const peakDepositHour = byHour.reduce((p, c) => c.depCnt > p.depCnt ? c : p, byHour[0]).h;
    const peakWithdrawHour = byHour.reduce((p, c) => c.witCnt > p.witCnt ? c : p, byHour[0]).h;
    const busiestBand = Object.entries(bands).reduce((p, c) => (c[1].dep + c[1].wit) > (p[1].dep + p[1].wit) ? c : p)[0];

    // Current live contracts use the terms stored when each member bought
    // the product. They remain accurate if an admin later changes the catalog.
    const runningProducts = Object.create(null);
    const activeMemberIds = new Set();
    activeInvSnap.forEach(d => {
      const inv = d.data();
      if (!mine(inv)) return;
      if (inv.userId) activeMemberIds.add(inv.userId);
      const key = String(inv.tierKey || inv.tierLabel || 'Unknown product');
      const row = runningProducts[key] || (runningProducts[key] = { key, name: inv.tierLabel || key, count: 0, invested: 0, paidOut: 0, remainingPayout: 0 });
      row.count++;
      row.invested += finiteMoney(inv.amount);
      row.paidOut += finiteMoney(inv.paidOut);
      row.remainingPayout += Math.max(0, finiteMoney(inv.expectedReturn) - finiteMoney(inv.paidOut));
    });

    const accounts = new Map();
    usersSnap.forEach(d => accounts.set(d.id, d.data()));
    const schedule = { scheduledAmount: 0, unpaidAmount: 0, overdueNowAmount: 0,
      pausedUnpaidAmount: 0, pausedOverdueAmount: 0, maturingCount: 0, invalidContracts: 0 };
    // Include matured contracts so selecting a past day does not lose its
    // schedule merely because the contract has since finished.
    contractSnap.forEach(d => {
      const inv = d.data();
      if (!mine(inv)) return;
      const day = analyticsContractDay(inv, selectedDayStart, selectedDayEnd, nowMs);
      if (!day) { schedule.invalidContracts++; return; }
      schedule.scheduledAmount += day.scheduled;
      if (day.matures) schedule.maturingCount++;
      const account = accounts.get(inv.userId);
      const paused = !account || account.status === 'banned';
      if (paused) schedule.pausedUnpaidAmount += day.unpaid;
      else schedule.unpaidAmount += day.unpaid;
    });
    // Current arrears use the separate active scan, not the historical cap.
    activeInvSnap.forEach(d => {
      const inv = d.data();
      if (!mine(inv)) return;
      const day = analyticsContractDay(inv, selectedDayStart, selectedDayEnd, nowMs);
      if (!day) return;
      const account = accounts.get(inv.userId);
      if (!account || account.status === 'banned') schedule.pausedOverdueAmount += day.overdue;
      else schedule.overdueNowAmount += day.overdue;
    });
    activeInvestors = activeMemberIds.size;
    const truncated = depSnap.docs.length >= 10000 || witSnap.docs.length >= 10000 || usersSnap.docs.length >= 10000 || activeInvSnap.docs.length >= 10000 || contractSnap.docs.length >= 10000 || rewardsTruncated;

    res.json({
      status: 'success', period: days, regionKey: want || 'all',
      kpis: {
        depositsAmount: depAmount, depositsCount: depCount,
        withdrawalsAmount: witAmount, withdrawalsCount: witCount,
        netFlow: depAmount - witAmount, totalUsers, newUsers, activeInvestors,
        investedAmount, commissionsPaid, teamRewardsPaid
      },
      byHour, bands, byDay, peakDepositHour, peakWithdrawHour, busiestBand,
      today, selectedDay: dayTotals, schedule, openRequests, runningProducts: Object.values(runningProducts).sort((a, b) => b.invested - a.invested), truncated, rewardsUnavailable, staffApprovals,
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
// ── EVENT-LOOP LAG (feeds /admin/system-health below) ──
// A cheap, continuous responsiveness probe: a 1s timer that measures how
// much LATE it actually fired. Near-zero on a healthy process; climbs when
// the event loop is busy or blocked (GC pause, a slow sync call, a runaway
// handler) -- exactly the "does this feel slow" signal raw CPU/RAM numbers
// alone can't show, and the thing that actually predicts whether a member's
// tap will get a fast callback (owner: "callback speed should be very very
// fast", "everything can get processed in milliseconds"). .unref() so this
// timer never keeps the process alive by itself.
let _eventLoopLagMs = 0;
(function trackEventLoopLag() {
  let last = Date.now();
  setInterval(() => {
    const now = Date.now();
    _eventLoopLagMs = Math.max(0, now - last - 1000);
    last = now;
  }, 1000).unref();
})();
// Live VPS health for the admin panel's Analytics tab (owner: "Make
// investment admin panel when l can see vps healthy or speed, in analytics
// so it will be live"). Deliberately admin-gated, not public like /health
// above -- process memory/load numbers are operational detail, not
// something to expose unauthenticated. Polled by the SAME 30s live-refresh
// tick renderAnalytics() already runs on, so "live" here means the same
// cadence as the rest of that tab, not a separate faster timer.
app.get('/admin/system-health', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const dbStart = Date.now();
    const dbUp = await pingDb();
    const dbPingMs = Date.now() - dbStart;
    const memTotal = os.totalmem(), memFree = os.freemem();
    const mem = process.memoryUsage();
    res.json({
      status: 'success',
      uptimeSec: Math.floor(process.uptime()),
      cpuCount: os.cpus().length,
      loadAvg: os.loadavg(), // [1m, 5m, 15m]
      memTotalBytes: memTotal,
      memFreeBytes: memFree,
      memUsedPct: Math.round(((memTotal - memFree) / memTotal) * 100),
      rssBytes: mem.rss,
      heapUsedBytes: mem.heapUsed,
      eventLoopLagMs: _eventLoopLagMs,
      db: { up: dbUp, pingMs: dbPingMs },
    });
  } catch (e) { console.error('System health error:', e.message); res.status(500).json({ status: 'error', message: e.message }); }
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
  return { deposited, earned: round2(earned), invested, withdrawn };
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
    let updated = 0, investedFixed = 0, streaksFixed = 0, teamCountsFixed = 0;
    const usersSnap = await db.collection('users').limit(10000).get();

    // Cheap in-memory pre-filter for teamL1/L2/L3Count, reusing usersSnap's
    // own docs instead of paying for a second users query. childrenOf maps
    // referrerId -> [childId,...] straight from every doc's own referredBy
    // field, so L1/L2/L3 for any user in THIS snapshot can be derived by
    // walking the map instead of re-querying -- same snapshot-then-
    // live-reverify pattern as moneyLooksStale/streakLooksStale above: this
    // is only ever used to decide WHETHER a user might be stale, never
    // trusted as the value to write. A genuinely stale user gets its counts
    // rebuilt fresh from the live referredBy chain via the already-existing
    // recomputeTeamCounts() (subagent-audit-caught Finding #6, see its own
    // comment above) -- reused rather than duplicated, so this and
    // /admin/user/delete can never disagree about how a team count is
    // derived.
    const childrenOf = new Map();
    for (const d of usersSnap.docs) {
      const parent = d.data().referredBy;
      if (!parent) continue;
      if (!childrenOf.has(parent)) childrenOf.set(parent, []);
      childrenOf.get(parent).push(d.id);
    }
    function snapshotTeamCounts(rootId) {
      let ids = [rootId];
      const counts = [0, 0, 0];
      for (let level = 0; level < 3; level++) {
        if (!ids.length) break;
        const next = [];
        for (const id of ids) next.push(...(childrenOf.get(id) || []));
        counts[level] = next.length;
        ids = next;
      }
      return counts;
    }

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
        round2(u.totalEarned) !== round2(row.earned) ||
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
          if (round2(fd.totalEarned) !== round2(fresh.earned)) moneyUpdate.totalEarned = round2(fresh.earned);
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

      // Team counts -- see snapshotTeamCounts()'s own comment above for why
      // this is a pre-filter, not the write itself. u (this user's doc data,
      // read at the top of this loop iteration) is stale by the time we get
      // here in exactly the same sense moneyLooksStale/streakLooksStale
      // already tolerate -- recomputeTeamCounts() re-derives from the live
      // referredBy chain, not from usersSnap, so a live signup/deletion
      // landing mid-run can only ever be caught fresh, never baked over.
      const [snapL1, snapL2, snapL3] = snapshotTeamCounts(doc.id);
      const teamCountsLookStale = (u.teamL1Count || 0) !== snapL1 ||
        (u.teamL2Count || 0) !== snapL2 || (u.teamL3Count || 0) !== snapL3;
      let wroteTeamCounts = false;
      if (teamCountsLookStale) {
        await recomputeTeamCounts(doc.id);
        wroteTeamCounts = true;
      }

      if (moneyWrote || wroteStreak || wroteTeamCounts) {
        updated++;
        if (investedChanged) investedFixed++;
        if (wroteStreak) streaksFixed++;
        if (wroteTeamCounts) teamCountsFixed++;
      }
    }
    return { ok: true, updated, investedFixed, streaksFixed, teamCountsFixed };
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
      const marzTx = await marzGetCollectTx(dep.marzTxUuid);
      if (SUCCESS_STATUSES.has(marzTx.status)) { await creditDeposit(doc); settled++; }
      else if (FAILED_STATUSES.has(marzTx.status)) await markDepositFailed(doc.ref, dep.userId, marzDepositFailureMsg(marzTx));
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
    await reconcileWithdrawalCreations();
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
    // Bank transfers -- polled rather than webhook-driven. MarzPay's own
    // docs describe this product's result as "poll GET /bank-transfer/
    // {reference} OR use webhooks", not webhook-only like collections/
    // disbursements, and this codebase has no confirmed documentation of
    // the webhook payload SHAPE for this specific product (unlike
    // collection.completed/disbursement.completed, both fully documented).
    // Guessing at an unverified webhook shape risks silently never firing
    // on a real payload; polling the same status endpoint the create
    // response's own reference points at is simple and independently
    // correct regardless of whether a webhook is even configured for it.
    // isBankTransfer:true narrows this to exactly the rows the branch in
    // _processWithdrawalNow above actually created.
    const btSnap = await db.collection('withdrawals').where('status', '==', 'processing').where('isBankTransfer', '==', true).where('marzReference', '>', '').orderBy('createdAt', 'asc').limit(50).get();
    for (const doc of btSnap.docs) {
      const wit = doc.data();
      if (!wit.marzReference) continue;
      const btStatus = await marzGetBankTransferStatus(wit.marzReference);
      if (SUCCESS_STATUSES.has(btStatus)) {
        if (await markWithdrawalProcessed(doc.ref, wit.userId)) await finalizeWithdrawalTransactionRecord(doc.id, 'processed');
        settled++;
      } else if (FAILED_STATUSES.has(btStatus)) {
        const { declined, refunded } = await declineWithdrawalAndRefund(doc.ref, wit.userId, 'Payout failed at the bank', ['processing']);
        if (declined) await finalizeWithdrawalTransactionRecord(doc.id, 'declined', refunded);
        settled++;
      }
      // '' (providerDown/inconclusive), 'pending', 'processing' -- genuinely
      // not finished yet or the live check itself failed; next tick retries.
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
    const deposits = await db.collection('pendingDeposits').where('commissionPending', '==', true).where('walletCredited', '==', true).where('commissionBanBlocked', '!=', true).orderBy('createdAt', 'asc').limit(500).get();
    for (const doc of deposits.docs) {
      await creditDepositReferralCommission(doc.id, doc.data().userId).catch(e => console.error('Reconcile deposit commission error:', e.message));
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
    const deposits = await db.collection('pendingDeposits').where('commissionPending', '==', true).where('walletCredited', '==', true).where('commissionBanBlocked', '==', true).limit(2000).get();
    for (const doc of deposits.docs) {
      await creditDepositReferralCommission(doc.id, doc.data().userId).catch(e => console.error('Reconcile blocked deposit commission error:', e.message));
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
  reconcilePendingDeposits().then(reconcilePendingWithdrawals).then(reconcileStuckWithdrawalRefunds).then(reconcileCommissions).then(reconcileUsdtDeposits).catch(() => {});
}
// Owner-toggleable: approves every still-pending withdrawal automatically,
// a few seconds after it was requested — shares processWithdrawalCore with
// the manual "Send" button, so it's exactly as safe/idempotent.
// Runs once per region, because auto-approval is one of the settings each
// region owns: Uganda can be auto-paying while Kenya is still hand-checked,
// and each region's own interval and safety cap apply to its own members'
// withdrawals. A withdrawal with no regionKey (raised before regions existed)
// belongs to the founding region.
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
    // Filter before limiting: manual-region and over-cap rows must not
    // occupy every slot forever. Mongo's $in:null includes missing legacy
    // regionKey fields, which belong to Uganda.
    let eligible = db.collection('withdrawals').where('status', '==', 'pending')
      .where('createdAt', '<=', cutoff);
    const cap = Number(sett.autoApproveMaxAmount) || 0;
    if (cap > 0) eligible = eligible.where('amount', '<=', cap);
    const snap = await eligible.orderBy('createdAt', 'asc').limit(50).get();
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
    const [depSettled, witSettled, usdtSettled] = await Promise.all([reconcilePendingDeposits(), reconcilePendingWithdrawals(), reconcileUsdtDeposits()]);
    res.json({ status: 'success', depositsSettled: depSettled, withdrawalsSettled: witSettled, usdtSettled });
  } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});

// ── IN-MEMORY STATE SWEEPER ──
function sweepEphemeralState() {
  const now = Date.now();
  const dropStale = (map, maxAgeMs) => { for (const [k, ts] of map) if (now - ts > maxAgeMs) map.delete(k); };
  try {
    dropStale(_depCreateDebounce, 5 * 60 * 1000);
    dropStale(_usdtSubmitDebounce, 5 * 60 * 1000);
    dropStale(_cardSubmitDebounce, 5 * 60 * 1000);
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
    app.listen(PORT, () => console.log(`Soda backend listening on :${PORT}`));
    seedStarterAssetsOnce().then(n => { if (n) console.log(`Created ${n} starter assets (Soda A to J)`); }).catch(e => console.error('Starter assets:', e.message));
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
