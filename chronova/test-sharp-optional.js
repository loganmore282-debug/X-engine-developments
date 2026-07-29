/* CHRONOVA — sharp must be an OPTIONAL, lazily-loaded dependency.
   sharp is a native addon: its prebuilt binary has to match the exact host
   (libc/arch) it runs on, and a mismatch throws at require() time. Requiring
   it at the top of server.js meant that failure took the ENTIRE server down
   before Express even started — every endpoint, not just image-shrinking.
   This simulates that exact failure (stubbing 'sharp' to throw on require)
   and proves the server still boots and every other endpoint still works;
   only the one feature that actually needs sharp degrades gracefully.
   Run:  node test-sharp-optional.js      (exits 0 = all green)              */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'super-secret-owner-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '3997';

const Module = require('module');
const mockdb = require('./test-mockdb.js');
const dbPath = require.resolve('./db.js');
const dbMod = new Module(dbPath); dbMod.exports = mockdb; dbMod.loaded = true;
require.cache[dbPath] = dbMod;

const faPath = require.resolve('firebase-admin');
const faMod = new Module(faPath);
faMod.exports = {
  initializeApp: () => {}, credential: { cert: () => ({}) },
  auth: () => ({
    verifyIdToken: async tok => { if (String(tok).startsWith('uid:')) return { uid: tok.slice(4) }; throw new Error('invalid token'); },
    updateUser: async () => ({}), createCustomToken: async uid => 'ct:' + uid,
  }),
};
faMod.loaded = true;
require.cache[faPath] = faMod;

// The actual simulated failure: on THIS host, sharp's native binary doesn't
// load (wrong libc/arch/etc.) — require('sharp') throws, exactly like it
// would in a real mismatched deploy environment.
const sharpPath = require.resolve('sharp');
const sharpMod = new Module(sharpPath);
Object.defineProperty(sharpMod, 'exports', {
  get() { throw new Error('Simulated: sharp prebuilt binary does not match this host'); },
});
sharpMod.loaded = true;
require.cache[sharpPath] = sharpMod;

require('./server.js');

const BASE = 'http://127.0.0.1:3997';
async function call(method, p, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
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
  await sleep(300);

  console.log('\n── sharp failing to load must never take the whole server down');
  let r = await call('GET', '/health');
  check('the server booted at all and /health responds', r.code === 200, r.body);

  r = await call('POST', '/admin/check-key', { body: { key: 'super-secret-owner-key' } });
  check('owner login still works — auth is completely unaffected by sharp being unavailable', r.body?.status === 'success' && !!r.body.token, r.body);
  const ownerToken = r.body?.token;

  mockdb.__store.get('products') || mockdb.__store.set('products', new Map());
  mockdb.__store.get('products').set('prod-a', { key: 'a', label: 'Watch A', price: 50000, cycle: 120, active: true, image: 'data:image/jpeg;base64,' + 'A'.repeat(70000) });
  r = await call('GET', '/products');
  check('the public /products endpoint still works fine without sharp', r.body?.status === 'success' && Array.isArray(r.body.products), r.body?.status);

  r = await call('POST', '/admin/products/recompress-images', { token: ownerToken, body: {} });
  check('ONLY the image-shrinking endpoint degrades — a clear 503, not a crash or a silent fake-success',
    r.code === 503 && /not available/i.test(r.body?.message || ''), r.body);

  r = await call('POST', '/admin/check-key', { body: { key: 'super-secret-owner-key' } });
  check('the server is still alive and responsive after that failed call', r.body?.status === 'success', r.body);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
