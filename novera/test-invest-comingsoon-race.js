/* NOVERA "COMING SOON" PURCHASE-TIME DOUBLE-CHECK
   Owner reported (with screenshots) that the SHOP SCREEN itself briefly
   showed a coming-soon product as a completely normal, tappable item on
   app open, before the real admin-set status finished syncing -- fixed
   client-side by caching the last synced product list (see the sw.js v39
   changelog). Owner then asked, correctly, for a server-side guarantee on
   top of that: even if a client (buggy, tampered, or a raw API call) ever
   shows a buy button for a product that isn't actually available, the
   server itself must refuse the purchase, unconditionally.

   /invest/create already checked this once, at the top of the request.
   This round adds a SECOND check of the exact same thing, re-read live,
   immediately before the transaction that actually spends the buyer's
   money -- closing the (already extremely narrow) gap between "checked"
   and "money moves". getProductByKey()'s cache is invalidated the instant
   an admin saves ANY product change, so both checks always see the
   freshest possible status.

   This does NOT touch or reverse any investment a member already
   legitimately holds from before a product was later paused -- it is a
   pure purchase-time gate, nothing else. Auto-reversing existing holdings
   on status change would be actively wrong: products get paused/sold-out
   AFTER people already legitimately hold them constantly, and those
   holders must keep earning normally.

   Proves, against the real server:
     - a product already comingSoon at request time is rejected, wallet
       untouched, no investment record created (baseline)
     - a product that WAS active and was legitimately bought stays bought
       (the new check causes no false positive on a normal purchase)
     - the exact same product, now marked comingSoon by the admin, is
       rejected on the very next purchase attempt -- exercising the full,
       real, updated /invest/create path end-to-end after a real admin
       toggle, not just a hand-set fixture
     - an existing investment on a product the admin pauses AFTERWARD is
       left completely alone (still active, still earning) -- the fix is
       purchase-time only, never retroactive

   Run: node test-invest-comingsoon-race.js   (exits 0 = all green)      */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '4105';

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

const BASE = 'http://127.0.0.1:4105';
async function call(method, p, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await fetch(BASE + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (_) {}
  return { code: r.status, body: j };
}
async function ownerCall(path, body) {
  const r = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-admin-key' }, body: JSON.stringify(body || {}) });
  let j = null; try { j = await r.json(); } catch (_) {}
  return { code: r.status, body: j };
}
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   - ' + name); }
  else { fail++; console.log('  FAIL - ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}
function collMap(name) {
  if (!mockdb.__store.has(name)) mockdb.__store.set(name, new Map());
  return mockdb.__store.get(name);
}
const users = () => collMap('users');
const userDoc = id => users().get(id);

(async () => {
  await new Promise(r => setTimeout(r, 600));
  const U = 'race-buyer';
  await call('POST', '/account/create-profile', { token: 'uid:' + U, body: { phone: '0771000801' } });
  await call('POST', '/register', { token: 'uid:' + U, body: {} });
  await ownerCall('/admin/deposit', { userId: U, amount: 5000000, note: 'test funding' });

  console.log('\n== Baseline: a product already coming-soon at request time is rejected ==');
  await ownerCall('/admin/products/save', { products: [{ key: 'supernova', name: 'Supernova', price: 1000000, cycle: 180, expectedReturn: 20000000, comingSoon: true }] });
  const balBefore = userDoc(U).walletBalance;
  let r = await call('POST', '/invest/create', { token: 'uid:' + U, body: { tierKey: 'supernova' } });
  check('rejected with the "not available" message', r.code === 400 && /not available/i.test(r.body?.message || ''), r.body);
  check('wallet untouched', userDoc(U).walletBalance === balBefore, userDoc(U).walletBalance);
  check('no investment record created', [...collMap('investments').values()].filter(i => i.userId === U && i.tierKey === 'supernova').length === 0);

  console.log('\n== A genuinely active product still purchases normally (no false positive from the extra check) ==');
  await ownerCall('/admin/products/save', { products: [{ key: 'blackhole', name: 'Black Hole', price: 2000000, cycle: 180, expectedReturn: 40000000, active: true, comingSoon: false }] });
  const balBefore2 = userDoc(U).walletBalance;
  r = await call('POST', '/invest/create', { token: 'uid:' + U, body: { tierKey: 'blackhole' } });
  check('purchase of a genuinely active product still succeeds', r.body?.status === 'success', r.body);
  check('wallet correctly debited', userDoc(U).walletBalance === balBefore2 - 2000000, userDoc(U).walletBalance);
  const rocherInv = [...collMap('investments').values()].find(i => i.userId === U && i.tierKey === 'blackhole');
  check('investment record created and active', rocherInv && rocherInv.status === 'active', rocherInv);

  console.log('\n== The admin pauses that SAME product right after purchase -- the existing holding is left completely alone ==');
  await ownerCall('/admin/products/save', { products: [{ key: 'blackhole', name: 'Black Hole', price: 2000000, cycle: 180, expectedReturn: 40000000, comingSoon: true }] });
  const rocherInvAfterPause = [...collMap('investments').values()].find(i => i.userId === U && i.tierKey === 'blackhole');
  check('the already-held investment is untouched -- still active, same amount, not reversed or cancelled', rocherInvAfterPause && rocherInvAfterPause.status === 'active' && rocherInvAfterPause.amount === 2000000, rocherInvAfterPause);
  check('this purchase-time fix never refunds/reverses an existing holding', userDoc(U).walletBalance === balBefore2 - 2000000, userDoc(U).walletBalance);

  console.log('\n== And a NEW attempt to buy that now-paused product (real admin toggle, real end-to-end request) is rejected ==');
  const balBefore3 = userDoc(U).walletBalance;
  r = await call('POST', '/invest/create', { token: 'uid:' + U, body: { tierKey: 'blackhole' } });
  check('second purchase attempt on the now-paused product is rejected', r.code === 400 && /not available/i.test(r.body?.message || ''), r.body);
  check('wallet untouched by the rejected second attempt', userDoc(U).walletBalance === balBefore3, userDoc(U).walletBalance);
  check('still only ONE rocher investment exists for this user (no duplicate slipped through)', [...collMap('investments').values()].filter(i => i.userId === U && i.tierKey === 'blackhole').length === 1);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
