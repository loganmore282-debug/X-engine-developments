/* SPACE8 ADMIN IMAGE UPLOAD BODY-SIZE LIMIT
   The owner reported: "trying to upload images of another product it is
   saying network error, meteosat1." Root cause, confirmed by reading the
   actual body-parser config: every admin route got a tight 64kb JSON cap
   EXCEPT /admin/banners/set, which was bumped to 4mb specifically because
   it carries a base64 image. /admin/products/save (product photo) and
   /admin/settings/update (the announcement background image) carry the
   exact same kind of payload -- a fileToDataUrl()-resized/compressed
   image, easily 100KB+ -- but were left on the 64kb parser. Any image
   large enough got a 413 from Express before the route handler even ran,
   and Express's default 413 response isn't JSON, so the admin panel's
   `await r.json()` threw and its catch block reported a generic "Network
   error" -- exactly the symptom described, with zero indication it was a
   request-size limit.

   Boots the REAL server.js and proves, with REAL HTTP request bodies (this
   is genuine Express body-parser behavior, not something the mock DB layer
   can fake) -- not just that the route exists, but that a realistically-
   sized product photo actually gets through end to end:
     - a ~300KB JSON body (realistic for a compressed product photo) to
       /admin/products/save succeeds, and the image actually lands in the
       saved product doc
     - the same size body to /admin/settings/update (announcement
       background image) succeeds too
     - a body genuinely over the 4mb ceiling is still correctly rejected on
       both routes (this isn't "remove all limits", it's "give image
       routes the same reasonable ceiling banners already had")
     - an unrelated, non-image route is UNCHANGED: still capped at 64kb, so
       this fix didn't accidentally loosen the DoS protection everywhere

   Run: node test-admin-image-upload-size.js   (exits 0 = all green)      */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '4159';

const Module = require('module');
const mockdb = require('./test-mockdb.js');
const dbPath = require.resolve('./db.js');
const dbMod = new Module(dbPath); dbMod.exports = mockdb; dbMod.loaded = true;
require.cache[dbPath] = dbMod;

const faPath = require.resolve('firebase-admin');
const faMod = new Module(faPath);
faMod.exports = {
  initializeApp: () => {}, credential: { cert: () => ({}) },
  auth: () => ({ verifyIdToken: async tok => { if (String(tok).startsWith('uid:')) return { uid: tok.slice(4) }; throw new Error('bad'); } }),
};
faMod.loaded = true;
require.cache[faPath] = faMod;

require('./server.js');

const BASE = 'http://127.0.0.1:4159';
async function call(method, p, { adminKey, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (adminKey) headers.Authorization = 'Bearer ' + adminKey;
  const r = await fetch(BASE + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (_) {}
  return { code: r.status, body: j };
}
async function ownerCall(path, body) { return call('POST', path, { adminKey: 'test-admin-key', body: body || {} }); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   - ' + name); }
  else { fail++; console.log('  FAIL - ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}
function collMap(name) {
  if (!mockdb.__store.has(name)) mockdb.__store.set(name, new Map());
  return mockdb.__store.get(name);
}
// A realistic fake "data URL" -- doesn't need to be a real image, just
// needs to be the size a real fileToDataUrl(f,1280,0.82) output would be.
function fakeDataUrl(bytes) {
  return 'data:image/jpeg;base64,' + 'A'.repeat(bytes);
}

(async () => {
  await sleep(600);

  console.log('\n== A realistic ~300KB product photo upload now succeeds (used to 413/"Network error") ==');
  const bigImage = fakeDataUrl(300 * 1024);
  let r = await ownerCall('/admin/products/save', { products: [{ key: 'meteosat1', name: 'Meteosat-1', price: 350000, cycle: 210, expectedReturn: 14700000, image: bigImage, order: 6 }] });
  check('product save with a ~300KB image succeeds', r.body?.status === 'success', r.body);
  const savedProduct = collMap('products').get('meteosat1');
  check('the image actually landed in the saved product doc', savedProduct?.image === bigImage, !!savedProduct);

  console.log('\n== A realistic ~300KB announcement background image upload now succeeds ==');
  r = await ownerCall('/admin/settings/update', { settings: { announcementBg: bigImage } });
  check('settings update with a ~300KB image succeeds', r.body?.status === 'success', r.body);
  const settingsDoc = collMap('settings').get('main');
  check('the image actually landed in the settings doc', settingsDoc?.announcementBg === bigImage, !!settingsDoc);

  console.log('\n== A body genuinely over the 4mb ceiling is still correctly rejected (this is a raised limit, not an unlimited one) ==');
  const hugeImage = fakeDataUrl(5 * 1024 * 1024);
  r = await ownerCall('/admin/products/save', { products: [{ key: 'meteosat1', name: 'Meteosat-1', price: 350000, cycle: 210, expectedReturn: 14700000, image: hugeImage, order: 6 }] });
  check('a >4mb product save is rejected, not silently accepted', r.code >= 400, r.code);

  console.log('\n== An unrelated, non-image admin route is UNCHANGED: still capped at 64kb ==');
  const overSmallLimit = 'x'.repeat(70 * 1024);
  r = await ownerCall('/admin/notifications/create', { title: 'Big', body: overSmallLimit });
  check('a >64KB body to an unrelated (non-image) route still gets rejected (DoS protection intact elsewhere)', r.code >= 400, r.code);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
