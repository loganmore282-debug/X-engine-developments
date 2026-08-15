/* NOVERA DAILY CASHBACK RACE-CONDITION AUDIT
   The owner asked specifically: daily cashback must land every 24h of the
   investment's OWN clock (not calendar-day), throughout the full cycle,
   safeguarded against a crash, and never double-credited.

   The 24h-rolling-from-purchase-time and full-cycle-catch-up behavior is
   already covered by test-investments.js (5-elapsed-days accuracy, exact
   maturity cap). What was never proven under a REAL race: settlement is
   triggered by BOTH /account and /investments, and the client's own
   refreshFromServer() calls them via Promise.all — meaning on every single
   app refresh, two requests hit settleAllForUser() for the same user at
   virtually the same instant. That's not a rare edge case, it's normal,
   constant traffic. This file proves that real race can't double-pay.

   Run: node test-cashback-concurrency.js   (exits 0 = all green)          */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '4099';

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

const BASE = 'http://127.0.0.1:4099';
async function call(method, p, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await fetch(BASE + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
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
const txns = () => collMap('transactions');
const countCashbackTxns = (uid, invId) => [...txns().values()].filter(t => t.userId === uid && t.type === 'cashback' && t.investmentId === invId).length;

async function setupFundedUser(uid, phone, balance) {
  await call('POST', '/account/create-profile', { token: 'uid:' + uid, body: { phone } });
  await call('POST', '/register', { token: 'uid:' + uid, body: {} });
  userDoc(uid).walletBalance = balance;
}

(async () => {
  await new Promise(r => setTimeout(r, 600));

  console.log('\n== The exact real-world race: /account and /investments fire together (refreshFromServer) ==');
  const A = 'race-cashback-a';
  await setupFundedUser(A, '0771000501', 1000000);
  let r = await call('POST', '/invest/create', { token: 'uid:' + A, body: { tierKey: 'comet' } }); // 30,000 -> 1,200,000 / 180 days
  const invIdA = r.body.investmentId;
  const invA = investments().get(invIdA);
  invA.createdAt = new Date(Date.now() - 5 * 86400000); // 5 days of cashback now due
  const dailyA = invA.dailyPayout;
  const balBeforeA = userDoc(A).walletBalance;

  const [accR, invR] = await Promise.all([
    call('GET', '/account', { token: 'uid:' + A }),
    call('GET', '/investments', { token: 'uid:' + A }),
  ]);
  check('both requests succeed', accR.body?.status === 'success' && invR.body?.status === 'success', { accR: accR.body?.status, invR: invR.body?.status });
  check('exactly 5 days worth credited once, not doubled by the simultaneous /account + /investments race', userDoc(A).walletBalance === balBeforeA + dailyA * 5, { got: userDoc(A).walletBalance, expected: balBeforeA + dailyA * 5 });
  check('exactly ONE cashback transaction recorded for this settlement, not two', countCashbackTxns(A, invIdA) === 1, countCashbackTxns(A, invIdA));
  check('payoutsMade advanced by exactly 5, not 10', investments().get(invIdA).payoutsMade === 5, investments().get(invIdA).payoutsMade);

  console.log('\n== A burst of 10 simultaneous /investments reads on the same investment ==');
  const B = 'race-cashback-b';
  await setupFundedUser(B, '0771000502', 1000000);
  r = await call('POST', '/invest/create', { token: 'uid:' + B, body: { tierKey: 'comet' } });
  const invIdB = r.body.investmentId;
  const invB = investments().get(invIdB);
  invB.createdAt = new Date(Date.now() - 8 * 86400000); // 8 days due
  const dailyB = invB.dailyPayout;
  const balBeforeB = userDoc(B).walletBalance;

  await Promise.all(Array.from({ length: 10 }, () => call('GET', '/investments', { token: 'uid:' + B })));
  check('wallet credited exactly once for the 8 due days despite 10 concurrent settlement triggers', userDoc(B).walletBalance === balBeforeB + dailyB * 8, { got: userDoc(B).walletBalance, expected: balBeforeB + dailyB * 8 });
  check('exactly ONE cashback transaction from the burst of 10', countCashbackTxns(B, invIdB) === 1, countCashbackTxns(B, invIdB));
  check('payoutsMade advanced by exactly 8', investments().get(invIdB).payoutsMade === 8, investments().get(invIdB).payoutsMade);

  console.log('\n== Maturity under a concurrent race: full remaining payout credited exactly once, never doubled ==');
  const C = 'race-cashback-c';
  await setupFundedUser(C, '0771000503', 1000000);
  r = await call('POST', '/invest/create', { token: 'uid:' + C, body: { tierKey: 'comet' } }); // 180-day cycle, 1,200,000 total
  const invIdC = r.body.investmentId;
  const invC = investments().get(invIdC);
  invC.createdAt = new Date(Date.now() - 400 * 86400000); // far past full cycle
  const balBeforeC = userDoc(C).walletBalance;

  const results = await Promise.all([
    call('GET', '/account', { token: 'uid:' + C }),
    call('GET', '/investments', { token: 'uid:' + C }),
    call('GET', '/investments', { token: 'uid:' + C }),
  ]);
  check('all 3 concurrent requests succeed cleanly', results.every(x => x.body?.status === 'success'), results.map(x => x.body?.status));
  check('matured investment pays exactly expectedReturn once, never doubled by the 3-way race', userDoc(C).walletBalance === balBeforeC + 1200000, { got: userDoc(C).walletBalance, expected: balBeforeC + 1200000 });
  check('investment correctly marked matured exactly once', investments().get(invIdC).status === 'matured', investments().get(invIdC).status);
  check('paidOut caps exactly at expectedReturn, no overpay from the race', investments().get(invIdC).paidOut === 1200000, investments().get(invIdC).paidOut);
  check('exactly ONE cashback transaction for the matured payout', countCashbackTxns(C, invIdC) === 1, countCashbackTxns(C, invIdC));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
