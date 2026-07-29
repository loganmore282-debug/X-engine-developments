/* RATE-LIMIT SAFETY NET
   Boots the REAL server.js against an in-memory database (test-mockdb.js)
   with Firebase auth and MarzPay stubbed, then proves the global baseline
   rate limiter actually engages — a flood against an endpoint with no
   specific limiter of its own (a public, unauthenticated read) gets cut off,
   and /health stays reachable throughout so uptime monitoring never trips.

   Run:  node test-rate-limit.js            (exits 0 = all green)            */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '3999';

const Module = require('module');
const mockdb = require('./test-mockdb.js');
const dbPath = require.resolve('./db.js');
const dbMod = new Module(dbPath); dbMod.exports = mockdb; dbMod.loaded = true;
require.cache[dbPath] = dbMod;

const faPath = require.resolve('firebase-admin');
const faMod = new Module(faPath);
faMod.exports = {
  initializeApp: () => {}, credential: { cert: () => ({}) },
  auth: () => ({ verifyIdToken: async () => { throw new Error('n/a'); }, updateUser: async () => ({}), createCustomToken: async uid => 'ct:' + uid }),
};
faMod.loaded = true;
require.cache[faPath] = faMod;

require('./server.js');

const BASE = 'http://127.0.0.1:3999';
async function call(path) {
  const r = await fetch(BASE + path);
  let j = null; try { j = await r.json(); } catch (_) {}
  return { code: r.status, body: j };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}

(async () => {
  await sleep(1200);

  console.log('\n── 1. Responses are actually compressed over the wire — /products ships a base64 image per item and was going out raw');
  // Runs FIRST, before the flood tests below burn through this IP's rate-limit
  // budget for the next 60s (a later 429 here would look identical to a
  // failed compression check but mean something else entirely).
  mockdb.__store.get('products') || mockdb.__store.set('products', new Map());
  // A stand-in for a real compressed-JPEG-as-base64 product image: repetitive
  // enough that gzip meaningfully shrinks it (a real photo compresses less,
  // but this proves the middleware itself is wired in and doing its job).
  const fakeImage = 'data:image/jpeg;base64,' + 'A'.repeat(200000);
  for (let i = 0; i < 5; i++) mockdb.__store.get('products').set('prod-' + i, { key: 'p'+i, label: 'Watch '+i, price: 30000, cycle: 120, active: true, image: fakeImage });
  const rawRes = await fetch(BASE + '/products');
  const encoding = rawRes.headers.get('content-encoding');
  check('the /products response (large, image-heavy) carries a content-encoding header (gzip/br) instead of going out uncompressed', !!encoding, { encoding, contentLength: rawRes.headers.get('content-length') });
  const decoded = await rawRes.json();
  check('the compressed response still decodes to the correct, complete data (roundtrip integrity)',
    decoded.status === 'success' && decoded.products?.length === 5 && decoded.products.every(p => p.image === fakeImage), { count: decoded.products?.length });

  console.log('\n── 2. A flood against a PUBLIC, unauthenticated endpoint with no specific limiter of its own gets cut off by the global floor');
  // /settings/public has no path-specific limiter registered anywhere — it is
  // exactly the kind of endpoint that used to be able to take unlimited
  // traffic from a single source. globalLimiter caps it at 400/min per IP.
  const results = [];
  for (let i = 0; i < 420; i++) results.push(await call('/settings/public'));
  const ok429 = results.filter(r => r.code === 429);
  const okSuccess = results.filter(r => r.code === 200);
  check('most of the flood succeeded (limiter is not overly aggressive on light reads)', okSuccess.length >= 380, okSuccess.length);
  check('the flood eventually got THROTTLED (429) once past the 400/min floor', ok429.length > 0, { total: results.length, ok: okSuccess.length, throttled: ok429.length });
  check('a throttled response carries the friendly message, not a stack trace or raw error', ok429[0]?.body?.status === 'error' && typeof ok429[0]?.body?.message === 'string', ok429[0]?.body);

  console.log('\n── 3. /health is exempt from the global limiter — uptime monitoring must never be the thing that gets throttled');
  const healthResults = [];
  for (let i = 0; i < 50; i++) healthResults.push(await call('/health'));
  check('50 rapid /health checks all succeed with no throttling', healthResults.every(r => r.code === 200), healthResults.map(r => r.code).filter(c => c !== 200));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('SUITE CRASH:', e); process.exit(1); });
