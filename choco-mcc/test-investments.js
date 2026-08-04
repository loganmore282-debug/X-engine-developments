/* CHOCOMCC INVESTMENT / CASHBACK ACCURACY & SECURITY TEST
   Boots the REAL server.js against an in-memory mock database and proves:
   a purchase can never exceed the wallet balance, a banned account can
   never buy, an inactive/sold-out product can never be bought via a direct
   API call even though the shop UI would never show it, the investment
   record stores the PRODUCT'S OWN cycle/expectedReturn/dailyPayout (not the
   global settings default) when the product sets its own, and daily
   cashback settlement pays exactly the capped total with no double-credit
   on repeated calls.

   Run: node test-investments.js   (exits 0 = all green)                   */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '4050';

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
    verifyIdToken: async tok => {
      if (String(tok).startsWith('uid:')) return { uid: tok.slice(4) };
      throw new Error('invalid token');
    },
  }),
};
faMod.loaded = true;
require.cache[faPath] = faMod;

require('./server.js');

const realFetch = global.fetch;
const BASE = 'http://127.0.0.1:4050';
const adminHeaders = { 'Content-Type': 'application/json', Authorization: 'Bearer test-admin-key' };
async function call(method, p, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await realFetch(BASE + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (_) {}
  return { code: r.status, body: j };
}
async function adminCall(path, body) {
  const r = await realFetch(BASE + path, { method: 'POST', headers: adminHeaders, body: JSON.stringify(body || {}) });
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
const investments = () => collMap('investments');

async function setupFundedUser(uid, phone, balance) {
  await call('POST', '/account/create-profile', { token: 'uid:' + uid, body: { phone } });
  await call('POST', '/register', { token: 'uid:' + uid, body: {} });
  userDoc(uid).walletBalance = balance;
}

(async () => {
  await new Promise(r => setTimeout(r, 600));

  console.log('\n== Basic purchase accuracy ==');
  const A = 'alice-uid';
  await setupFundedUser(A, '0771000001', 1000000);
  let r = await call('POST', '/invest/create', { token: 'uid:' + A, body: { tierKey: 'hersheys' } });
  check('purchase of an active default product succeeds', r.body?.status === 'success', r.body);
  const invId = r.body?.investmentId;
  const inv = investments().get(invId);
  check('investment stores the PRODUCT\'S OWN cycle (180), not a stale global default', inv?.cycle === 180, inv);
  check('investment stores the product\'s own expectedReturn (600,000 = 30,000 x 20)', inv?.expectedReturn === 600000, inv);
  check('dailyPayout computed correctly (600000/180=3333.33 rounds to 3333)', inv?.dailyPayout === Math.round(600000 / 180), inv);
  check('wallet debited by the product price (30,000)', userDoc(A).walletBalance === 1000000 - 30000, userDoc(A).walletBalance);
  check('totalInvested credited', userDoc(A).totalInvested === 30000, userDoc(A).totalInvested);

  console.log('\n-- Per-product override actually used over the global fallback --');
  await adminCall('/admin/settings/update', { settings: { returnMultiple: 3, cycleDays: 10 } }); // deliberately different from the product's own fields
  r = await call('POST', '/invest/create', { token: 'uid:' + A, body: { tierKey: 'mars' } });
  const marsInv = investments().get(r.body?.investmentId);
  check('mars still uses ITS OWN 180-day/20x fields, ignoring the now-different global settings', marsInv?.cycle === 180 && marsInv?.expectedReturn === 1800000, marsInv);
  await adminCall('/admin/settings/update', { settings: { returnMultiple: 20, cycleDays: 180 } }); // restore

  console.log('\n== Balance / auth security ==');
  const B = 'bob-uid';
  await setupFundedUser(B, '0771000002', 10000); // not enough for any tier
  r = await call('POST', '/invest/create', { token: 'uid:' + B, body: { tierKey: 'hersheys' } });
  check('purchase rejected for insufficient balance', r.code === 400 && /need|have/i.test(r.body?.message || ''), r.body);
  check('no wallet change on rejected purchase', userDoc(B).walletBalance === 10000, userDoc(B).walletBalance);

  r = await call('POST', '/invest/create', { body: { tierKey: 'hersheys' } }); // no token at all
  check('purchase rejected with no auth token', r.code === 401, r.body);

  const C = 'carol-uid';
  await setupFundedUser(C, '0771000003', 1000000);
  userDoc(C).status = 'banned';
  r = await call('POST', '/invest/create', { token: 'uid:' + C, body: { tierKey: 'hersheys' } });
  check('banned account cannot buy', r.code === 400 && r.body?.code === 'BANNED', r.body);
  check('banned account wallet untouched', userDoc(C).walletBalance === 1000000, userDoc(C).walletBalance);

  console.log('\n-- Unknown product key is rejected --');
  const D = 'dave-uid';
  await setupFundedUser(D, '0771000004', 1000000);
  r = await call('POST', '/invest/create', { token: 'uid:' + D, body: { tierKey: 'not-a-real-product' } });
  check('unknown tierKey rejected', r.code === 400 && /unknown/i.test(r.body?.message || ''), r.body);

  console.log('\n-- An inactive product can never be bought via a direct API call --');
  const godivaProdSnap = await adminCall('/admin/products/save', { products: [{ key: 'kitkat', name: 'KitKat Chunky', price: 500000, cycle: 180, expectedReturn: 10000000, active: false }] });
  check('admin deactivates kitkat', godivaProdSnap.body?.status === 'success', godivaProdSnap.body);
  r = await call('POST', '/invest/create', { token: 'uid:' + D, body: { tierKey: 'kitkat' } });
  check('inactive product rejected even via direct API call', r.code === 400 && /not available/i.test(r.body?.message || ''), r.body);

  console.log('\n-- A sold-out (comingSoon) product can never be bought via a direct API call --');
  await adminCall('/admin/products/save', { products: [{ key: 'toblerone', name: 'Toblerone', price: 800000, cycle: 180, expectedReturn: 16000000, comingSoon: true }] });
  r = await call('POST', '/invest/create', { token: 'uid:' + D, body: { tierKey: 'toblerone' } });
  check('sold-out product rejected even via direct API call', r.code === 400 && /not available/i.test(r.body?.message || ''), r.body);
  check('wallet untouched by the two rejected purchase attempts', userDoc(D).walletBalance === 1000000, userDoc(D).walletBalance);

  console.log('\n== Daily cashback settlement accuracy ==');
  const E = 'erin-uid';
  await setupFundedUser(E, '0771000005', 1000000);
  r = await call('POST', '/invest/create', { token: 'uid:' + E, body: { tierKey: 'hersheys' } }); // 30,000 -> 600,000 over 180 days
  const erinInvId = r.body?.investmentId;
  const erinInv = investments().get(erinInvId);
  // Backdate createdAt so settle-on-read thinks several days have elapsed.
  erinInv.createdAt = new Date(Date.now() - 5 * 86400000);
  const balBeforeSettle = userDoc(E).walletBalance;
  await call('GET', '/investments', { token: 'uid:' + E });
  const expectedFiveDays = erinInv.dailyPayout * 5;
  check('5 elapsed days pays exactly 5x the daily payout, no more no less', userDoc(E).walletBalance === balBeforeSettle + expectedFiveDays, { balance: userDoc(E).walletBalance, expected: balBeforeSettle + expectedFiveDays });
  check('totalEarned credited to match', userDoc(E).totalEarned === expectedFiveDays, userDoc(E).totalEarned);

  console.log('\n-- Re-reading immediately after does not double-pay (idempotent settle-on-read) --');
  const balAfterFirstSettle = userDoc(E).walletBalance;
  await call('GET', '/investments', { token: 'uid:' + E });
  check('no additional cashback on an immediate re-read (nothing newly due yet)', userDoc(E).walletBalance === balAfterFirstSettle, userDoc(E).walletBalance);

  console.log('\n-- Maturity pays the exact remaining total, never more than expectedReturn --');
  erinInv.createdAt = new Date(Date.now() - 400 * 86400000); // far past the 180-day cycle
  await call('GET', '/investments', { token: 'uid:' + E });
  const freshInv = investments().get(erinInvId);
  check('investment marked matured', freshInv.status === 'matured', freshInv);
  check('total paid out exactly equals expectedReturn (no more, no less — no decimal drift)', freshInv.paidOut === 600000, freshInv.paidOut);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
