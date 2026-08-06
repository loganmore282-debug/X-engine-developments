/* CHOCOMCC PRODUCTS MERGE/TOMBSTONE TEST
   Boots the REAL server.js against an in-memory mock database and proves:
   editing ONE product never makes every other never-touched default vanish
   (the actual bug reported — getProducts() used to return ONLY whatever was
   in the `products` collection, with zero merge against DEFAULT_PRODUCTS),
   deleting a default product actually stays gone instead of being silently
   resurrected by the merge, saving a single product doesn't reset its own
   `order` to 0, and "Clear all" genuinely reverts to the full default set.

   Run: node test-products-merge.js   (exits 0 = all green)                */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '4040';

const Module = require('module');
const mockdb = require('./test-mockdb.js');
const dbPath = require.resolve('./db.js');
const dbMod = new Module(dbPath); dbMod.exports = mockdb; dbMod.loaded = true;
require.cache[dbPath] = dbMod;

const faPath = require.resolve('firebase-admin');
const faMod = new Module(faPath);
faMod.exports = {
  initializeApp: () => {}, credential: { cert: () => ({}) },
  auth: () => ({ verifyIdToken: async () => { throw new Error('n/a'); } }),
};
faMod.loaded = true;
require.cache[faPath] = faMod;

require('./server.js');

const realFetch = global.fetch;
const BASE = 'http://127.0.0.1:4040';
const adminHeaders = { 'Content-Type': 'application/json', Authorization: 'Bearer test-admin-key' };
async function adminCall(path, body) {
  const r = await realFetch(BASE + path, { method: 'POST', headers: adminHeaders, body: JSON.stringify(body || {}) });
  let j = null; try { j = await r.json(); } catch (_) {}
  return { code: r.status, body: j };
}
async function getProductsViaAdmin() {
  const r = await realFetch(BASE + '/admin/products', { headers: adminHeaders });
  return r.json();
}
async function getPublicProducts() {
  const r = await realFetch(BASE + '/public/products');
  return r.json();
}

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   - ' + name); }
  else { fail++; console.log('  FAIL - ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}

(async () => {
  await new Promise(r => setTimeout(r, 600));

  console.log('\n== Fresh install: no products saved yet ==');
  let r = await getProductsViaAdmin();
  check('returns all 10 defaults with nothing ever saved', r.products.length === 10, r.products.map(p => p.key));
  const keys = r.products.map(p => p.key);
  check('includes every known default key', ['hersheys','mars','snickers','cadbury','kitkat','toblerone','rondnoir','rocher','raffaello','godiva'].every(k => keys.includes(k)));

  console.log('\n-- THE ACTUAL BUG: editing ONE product must not delete the other 9 --');
  const hersheys = r.products.find(p => p.key === 'hersheys');
  const editedHersheys = Object.assign({}, hersheys, { price: 35000 });
  let sr = await adminCall('/admin/products/save', { products: [editedHersheys] });
  check('save succeeds', sr.body?.status === 'success', sr.body);

  r = await getProductsViaAdmin();
  check('all 10 products still present after editing only one', r.products.length === 10, r.products.map(p => p.key));
  const savedHersheys = r.products.find(p => p.key === 'hersheys');
  check('the edited product actually reflects the new price', savedHersheys?.price === 35000, savedHersheys);
  const stillDefaultMars = r.products.find(p => p.key === 'mars');
  check('an untouched default (mars) is still there with its original price', stillDefaultMars?.price === 90000, stillDefaultMars);
  check('untouched default (mars) still has its 180-day/40x fields', stillDefaultMars?.cycle === 180 && stillDefaultMars?.expectedReturn === 3600000, stillDefaultMars);

  console.log('\n-- Same merge applies to the public (user-app) products endpoint --');
  const pub = await getPublicProducts();
  check('public endpoint also shows all 10 (not just the edited one)', pub.products.length === 10, pub.products.map(p => p.key));

  console.log('\n-- order is preserved from the submitted product, not reset to 0 for a single-item save --');
  const cadbury = r.products.find(p => p.key === 'cadbury');
  const editedCadbury = Object.assign({}, cadbury, { order: 7 });
  await adminCall('/admin/products/save', { products: [editedCadbury] });
  r = await getProductsViaAdmin();
  const savedCadbury = r.products.find(p => p.key === 'cadbury');
  check('single-product save keeps the order value it was given (7), not forced to 0', savedCadbury?.order === 7, savedCadbury);

  console.log('\n-- Deleting a default product actually stays gone (soft-delete tombstone) --');
  const dr = await adminCall('/admin/products/delete', { key: 'mars' });
  check('delete succeeds', dr.body?.status === 'success', dr.body);
  r = await getProductsViaAdmin();
  check('mars is gone right after delete', !r.products.some(p => p.key === 'mars'), r.products.map(p => p.key));
  check('exactly 9 products remain', r.products.length === 9, r.products.length);

  // Force the 60s in-process cache to actually re-read from the DB, proving
  // this isn't just a stale cache hiding mars — the fix has to hold on a
  // genuinely fresh read too.
  await adminCall('/admin/settings/update', { settings: {} }); // no-op, just a round-trip
  r = await getProductsViaAdmin();
  check('mars stays deleted on a subsequent read (not resurrected by the default-merge)', !r.products.some(p => p.key === 'mars'), r.products.map(p => p.key));

  console.log('\n-- Re-saving a previously-deleted key actually revives it --');
  const revived = { key: 'mars', name: 'Mars', price: 90000, cycle: 180, expectedReturn: 1800000, order: 1 };
  await adminCall('/admin/products/save', { products: [revived] });
  r = await getProductsViaAdmin();
  check('mars is back after being explicitly re-saved', r.products.some(p => p.key === 'mars'), r.products.map(p => p.key));
  check('back to 10 products total', r.products.length === 10, r.products.length);

  console.log('\n-- Clear all reverts genuinely to the full default set --');
  const editedAgain = Object.assign({}, r.products.find(p => p.key === 'godiva'), { price: 9999999 });
  await adminCall('/admin/products/save', { products: [editedAgain] });
  const cr = await adminCall('/admin/products/clear');
  check('clear succeeds', cr.body?.status === 'success', cr.body);
  r = await getProductsViaAdmin();
  check('back to exactly 10 products', r.products.length === 10, r.products.length);
  const godivaAfterClear = r.products.find(p => p.key === 'godiva');
  check('the edited price is gone — reverted to the true default (4,000,000)', godivaAfterClear?.price === 4000000, godivaAfterClear);

  console.log('\n-- sync-pricing: the real-world bug -- a rate change (e.g. 20x -> 40x) does nothing for an already-saved tier --');
  // Simulate exactly what actually happened live: mars got individually
  // saved a while back (say, just to reorder it) while pricing was still
  // 20x, so its saved doc is now stuck holding the OLD price/expectedReturn
  // even though DEFAULT_PRODUCTS has since moved to the new 40x table.
  // Give it a custom image + a deliberately different order too, to prove
  // sync-pricing leaves everything except price/cycle/expectedReturn alone.
  const staleMars = { key: 'mars', name: 'Mars', price: 90000, cycle: 180, expectedReturn: 1800000, order: 7, image: 'data:image/png;base64,CUSTOM' };
  await adminCall('/admin/products/save', { products: [staleMars] });
  r = await getProductsViaAdmin();
  const marsBeforeSync = r.products.find(p => p.key === 'mars');
  check('sanity: mars is stuck on the stale 20x figure before syncing', marsBeforeSync?.expectedReturn === 1800000, marsBeforeSync);
  const snickersBeforeSync = r.products.find(p => p.key === 'snickers');
  check('sanity: snickers (never individually saved) is already on the current default', snickersBeforeSync?.expectedReturn === 8000000, snickersBeforeSync);

  const syncR = await adminCall('/admin/products/sync-pricing');
  check('sync-pricing succeeds', syncR.body?.status === 'success', syncR.body);
  check('exactly one product needed syncing (mars)', syncR.body?.synced === 1 && syncR.body?.keys?.[0] === 'mars', syncR.body);

  r = await getProductsViaAdmin();
  const marsAfterSync = r.products.find(p => p.key === 'mars');
  check('mars price/expectedReturn/cycle now match the current default (40x)', marsAfterSync?.price === 90000 && marsAfterSync?.expectedReturn === 3600000 && marsAfterSync?.cycle === 180, marsAfterSync);
  check('mars\' custom image and order were left completely untouched', marsAfterSync?.image === 'data:image/png;base64,CUSTOM' && marsAfterSync?.order === 7, marsAfterSync);
  const snickersAfterSync = r.products.find(p => p.key === 'snickers');
  check('an already-correct, never-saved product is unaffected (nothing to sync)', snickersAfterSync?.expectedReturn === 8000000, snickersAfterSync);

  console.log('\n-- Re-running sync-pricing again is a safe no-op (idempotent) --');
  const syncAgainR = await adminCall('/admin/products/sync-pricing');
  check('second run reports zero synced (mars already matches, nothing else was ever saved)', syncAgainR.body?.synced === 0, syncAgainR.body);

  console.log('\n-- Non-owner cannot save/delete/clear/sync products --');
  const noAuthHeaders = { 'Content-Type': 'application/json' };
  let nr = await realFetch(BASE + '/admin/products/save', { method: 'POST', headers: noAuthHeaders, body: JSON.stringify({ products: [{ key: 'x' }] }) });
  check('save rejects unauthenticated', nr.status === 401);
  nr = await realFetch(BASE + '/admin/products/delete', { method: 'POST', headers: noAuthHeaders, body: JSON.stringify({ key: 'hersheys' }) });
  check('delete rejects unauthenticated', nr.status === 401);
  nr = await realFetch(BASE + '/admin/products/clear', { method: 'POST', headers: noAuthHeaders, body: '{}' });
  check('clear rejects unauthenticated', nr.status === 401);
  nr = await realFetch(BASE + '/admin/products/sync-pricing', { method: 'POST', headers: noAuthHeaders, body: '{}' });
  check('sync-pricing rejects unauthenticated', nr.status === 401);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
