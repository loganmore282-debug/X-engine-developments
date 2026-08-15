/* SPACE8 INVESTMENT / CASHBACK ACCURACY & SECURITY TEST
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
  let r = await call('POST', '/invest/create', { token: 'uid:' + A, body: { tierKey: 'explorer1' } });
  check('purchase of an active default product succeeds', r.body?.status === 'success', r.body);
  const invId = r.body?.investmentId;
  const inv = investments().get(invId);
  check('investment stores the PRODUCT\'S OWN cycle (210), not a stale global default', inv?.cycle === 210, inv);
  check('investment stores the product\'s own expectedReturn (1,260,000 = 30,000 x 42)', inv?.expectedReturn === 1260000, inv);
  check('dailyPayout computed correctly (1260000/210=6000)', inv?.dailyPayout === Math.round(1260000 / 210), inv);
  check('wallet debited by the product price (30,000)', userDoc(A).walletBalance === 1000000 - 30000, userDoc(A).walletBalance);
  check('totalInvested credited', userDoc(A).totalInvested === 30000, userDoc(A).totalInvested);

  console.log('\n-- Per-product override actually used over the global fallback --');
  await adminCall('/admin/settings/update', { settings: { returnMultiple: 3, cycleDays: 10 } }); // deliberately different from the product's own fields
  r = await call('POST', '/invest/create', { token: 'uid:' + A, body: { tierKey: 'tiros1' } });
  const marsInv = investments().get(r.body?.investmentId);
  check('mars still uses ITS OWN 210-day/42x fields, ignoring the now-different global settings', marsInv?.cycle === 210 && marsInv?.expectedReturn === 4200000, marsInv);
  await adminCall('/admin/settings/update', { settings: { returnMultiple: 40, cycleDays: 180 } }); // restore

  console.log('\n== Balance / auth security ==');
  const B = 'bob-uid';
  await setupFundedUser(B, '0771000002', 10000); // not enough for any tier
  r = await call('POST', '/invest/create', { token: 'uid:' + B, body: { tierKey: 'explorer1' } });
  check('purchase rejected for insufficient balance', r.code === 400 && /need|have/i.test(r.body?.message || ''), r.body);
  check('no wallet change on rejected purchase', userDoc(B).walletBalance === 10000, userDoc(B).walletBalance);

  r = await call('POST', '/invest/create', { body: { tierKey: 'explorer1' } }); // no token at all
  check('purchase rejected with no auth token', r.code === 401, r.body);

  const C = 'carol-uid';
  await setupFundedUser(C, '0771000003', 1000000);
  userDoc(C).status = 'banned';
  r = await call('POST', '/invest/create', { token: 'uid:' + C, body: { tierKey: 'explorer1' } });
  check('banned account cannot buy', r.code === 400 && r.body?.code === 'BANNED', r.body);
  check('banned account wallet untouched', userDoc(C).walletBalance === 1000000, userDoc(C).walletBalance);

  console.log('\n-- Unknown product key is rejected --');
  const D = 'dave-uid';
  await setupFundedUser(D, '0771000004', 1000000);
  r = await call('POST', '/invest/create', { token: 'uid:' + D, body: { tierKey: 'not-a-real-product' } });
  check('unknown tierKey rejected', r.code === 400 && /unknown/i.test(r.body?.message || ''), r.body);

  console.log('\n-- An inactive product can never be bought via a direct API call --');
  const godivaProdSnap = await adminCall('/admin/products/save', { products: [{ key: 'quasar', name: 'Quasar', price: 500000, cycle: 180, expectedReturn: 10000000, active: false }] });
  check('admin deactivates kitkat', godivaProdSnap.body?.status === 'success', godivaProdSnap.body);
  r = await call('POST', '/invest/create', { token: 'uid:' + D, body: { tierKey: 'quasar' } });
  check('inactive product rejected even via direct API call', r.code === 400 && /not available/i.test(r.body?.message || ''), r.body);

  console.log('\n-- A sold-out (comingSoon) product can never be bought via a direct API call --');
  await adminCall('/admin/products/save', { products: [{ key: 'neutron_star', name: 'Neutron Star', price: 800000, cycle: 180, expectedReturn: 16000000, comingSoon: true }] });
  r = await call('POST', '/invest/create', { token: 'uid:' + D, body: { tierKey: 'neutron_star' } });
  check('sold-out product rejected even via direct API call', r.code === 400 && /not available/i.test(r.body?.message || ''), r.body);
  check('wallet untouched by the two rejected purchase attempts', userDoc(D).walletBalance === 1000000, userDoc(D).walletBalance);

  console.log('\n== Daily cashback settlement accuracy ==');
  const E = 'erin-uid';
  await setupFundedUser(E, '0771000005', 1000000);
  r = await call('POST', '/invest/create', { token: 'uid:' + E, body: { tierKey: 'explorer1' } }); // 30,000 -> 1,200,000 over 180 days
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
  check('total paid out exactly equals expectedReturn (no more, no less — no decimal drift)', freshInv.paidOut === 1260000, freshInv.paidOut);

  console.log('\n-- A totalInvested field corrupted to a STRING (seen live in production) no longer blocks a purchase --');
  // MongoDB's real $inc throws "Cannot increment with non-numeric argument"
  // outright if the stored field isn't already a number -- reproduced here
  // by writing the field as a string directly into the store, exactly like
  // a live account was found with totalInvested: "30000". The purchase
  // transaction now computes the new value itself instead of using
  // FieldValue.increment() for this field, so it must both succeed AND
  // self-heal the field back to numeric.
  const F = 'faith-uid';
  await setupFundedUser(F, '0771000006', 1000000);
  userDoc(F).totalInvested = '30000'; // corrupted, as a string -- not a number
  r = await call('POST', '/invest/create', { token: 'uid:' + F, body: { tierKey: 'explorer1' } });
  check('purchase succeeds despite a string-corrupted totalInvested', r.body?.status === 'success', r.body);
  check('totalInvested self-healed to a real number (30000 + 30000 = 60000)', userDoc(F).totalInvested === 60000, userDoc(F).totalInvested);
  check('walletBalance debited correctly regardless', userDoc(F).walletBalance === 1000000 - 30000, userDoc(F).walletBalance);

  console.log('\n-- An admin rename reaches an already-running investment\'s display name, but never its locked-in terms --');
  const G = 'grace-uid';
  await setupFundedUser(G, '0771000007', 1000000);
  r = await call('POST', '/invest/create', { token: 'uid:' + G, body: { tierKey: 'explorer1' } });
  const graceInvId = r.body?.investmentId;
  check('purchase succeeds before the rename', r.body?.status === 'success', r.body);
  let list = await call('GET', '/investments', { token: 'uid:' + G });
  let graceInv = list.body.investments.find(i => i.id === graceInvId);
  check('shows the original product name before any rename', graceInv?.tierLabel === "Explorer 1", graceInv);

  await adminCall('/admin/products/save', { products: [{ key: 'explorer1', name: 'VIP 1: Hershey’s Milk Chocolate', price: 30000, cycle: 180, expectedReturn: 1200000 }] });
  list = await call('GET', '/investments', { token: 'uid:' + G });
  graceInv = list.body.investments.find(i => i.id === graceInvId);
  check('the ALREADY-RUNNING investment now shows the renamed product live, not the frozen purchase-time label', graceInv?.tierLabel === 'VIP 1: Hershey’s Milk Chocolate', graceInv);
  check('cycle/amount/expectedReturn/dailyPayout stay exactly what was locked in at purchase, unaffected by the rename',
    graceInv?.cycle === 210 && graceInv?.amount === 30000 && graceInv?.expectedReturn === 1260000 && graceInv?.dailyPayout === Math.round(1260000 / 210), graceInv);

  const godivaTierKey = 'sentinel6';
  userDoc(G).walletBalance = 10000000; // top up -- godiva costs more than Grace's remaining balance
  r = await call('POST', '/invest/create', { token: 'uid:' + G, body: { tierKey: godivaTierKey } });
  check('godiva purchase succeeds after top-up', r.body?.status === 'success', r.body);
  const godivaInvId = r.body?.investmentId;
  const godivaBefore = collMap('investments').get(godivaInvId);
  await adminCall('/admin/products/delete', { key: godivaTierKey });
  list = await call('GET', '/investments', { token: 'uid:' + G });
  const godivaAfterDelete = list.body.investments.find(i => i.id === godivaInvId);
  check('a deleted product key falls back to the frozen purchase-time label instead of breaking', godivaAfterDelete?.tierLabel === godivaBefore.tierLabel, godivaAfterDelete);
  await adminCall('/admin/products/save', { products: [{ key: godivaTierKey, name: 'Sentinel-6 Michael Freilich', price: 5000000, cycle: 210, expectedReturn: 210000000 }] }); // restore for other tests

  console.log('\n-- The rename reaches the Records/Accrued transaction history too ("Bought X" and "X daily cashback") --');
  let txList = await call('GET', '/transactions', { token: 'uid:' + G });
  let boughtTx = txList.body.transactions.find(t => t.investmentId === graceInvId && t.type === 'investment');
  check('the purchase transaction\'s description now uses the renamed product, not the frozen one from purchase time',
    boughtTx?.description === 'Bought VIP 1: Hershey’s Milk Chocolate', boughtTx);

  const graceInvDoc = collMap('investments').get(graceInvId);
  graceInvDoc.createdAt = new Date(Date.now() - 3 * 86400000); // backdate so settle-on-read credits cashback
  await call('GET', '/investments', { token: 'uid:' + G }); // triggers settleAllForUser
  txList = await call('GET', '/transactions', { token: 'uid:' + G });
  const cashbackTx = txList.body.transactions.find(t => t.investmentId === graceInvId && t.type === 'cashback');
  check('a cashback transaction was actually created', !!cashbackTx, txList.body.transactions);
  check('its description also uses the renamed product live, not the name frozen when it was credited',
    cashbackTx?.description === 'VIP 1: Hershey’s Milk Chocolate daily cashback', cashbackTx);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
