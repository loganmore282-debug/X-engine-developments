/* NOVERA DEPOSIT RACE-CONDITION AUDIT
   Withdrawals and purchases both already have a live concurrency test that
   fires simultaneous requests at the real server; deposits never did,
   despite deposit crediting having THREE independent triggers that can all
   fire for the same pending deposit around the same moment in production —
   the client's auto-poll (every 3s) + a manual "Verify Payment" tap, the
   MarzPay webhook landing, and the 30s background reconciler sweep. This
   is exactly the "webhook + status-poll race doubles the deposit" bug
   class this app's sibling products have hit before. Proves it can't
   happen here by racing creditDeposit()'s real triggers against each
   other, not by re-reading the lock code and asserting it's fine.

   Run: node test-deposit-concurrency.js   (exits 0 = all green)            */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '4093';

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

// Stub MarzPay: collect-money always "succeeds" immediately (so the deposit
// gets a marzTxUuid to poll against), and the collect-money STATUS check
// always reports "successful" — the realistic state once a customer has
// actually paid and everyone (webhook, poll, reconciler) is racing to be
// the one that credits it.
const realFetch = global.fetch;
let marzN = 0;
global.fetch = async (url, opts) => {
  const u = String(url);
  const json = body => ({ ok: true, status: 200, json: async () => body });
  if (u.includes('wearemarz.com') && u.endsWith('/collect-money')) {
    return json({ status: 'success', data: { transaction: { uuid: 'DTX-' + (++marzN), status: 'pending' } } });
  }
  if (u.includes('wearemarz.com') && u.includes('/collect-money/')) {
    return json({ status: 'success', data: { transaction: { status: 'successful' } } });
  }
  return realFetch(url, opts);
};

require('./server.js');

const BASE = 'http://127.0.0.1:4093';
async function call(method, p, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await realFetch(BASE + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
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
const txns = () => collMap('transactions');
const countDepositTxns = uid => [...txns().values()].filter(t => t.userId === uid && t.type === 'deposit').length;

async function setupUser(uid, phone) {
  await call('POST', '/account/create-profile', { token: 'uid:' + uid, body: { phone } });
  await call('POST', '/register', { token: 'uid:' + uid, body: {} });
}

(async () => {
  await new Promise(r => setTimeout(r, 600));
  const AMOUNT = 50000;

  console.log('\n== Client auto-poll racing a manual "Verify Payment" tap on the same deposit ==');
  const A = 'dep-race-a';
  await setupUser(A, '0771000301');
  let r = await call('POST', '/deposit/marzpay', { token: 'uid:' + A, body: { amount: AMOUNT, phone: '0771000301', network: 'MTN Mobile Money' } });
  check('deposit initiated successfully', r.body?.status === 'success', r.body);
  const depIdA = r.body?.depositId;
  const balBeforeA = userDoc(A).walletBalance;

  // Simulate 5 near-simultaneous status checks — exactly what happens when
  // the 3s auto-poll interval and a manual tap land close together, or the
  // app is open on two devices/tabs at once.
  const polls = await Promise.all(Array.from({ length: 5 }, () =>
    call('POST', '/deposit/marzpay/status', { token: 'uid:' + A, body: { depositId: depIdA } })
  ));
  check('all 5 concurrent status checks report matched', polls.every(p => p.body?.state === 'matched'), polls.map(p => p.body));
  check('wallet credited exactly once (not 5x) from 5 simultaneous polls', userDoc(A).walletBalance === balBeforeA + AMOUNT, userDoc(A).walletBalance);
  check('exactly ONE deposit transaction record, not five', countDepositTxns(A) === 1, countDepositTxns(A));

  console.log('\n== The MarzPay webhook landing at the exact same moment as a status poll ==');
  const B = 'dep-race-b';
  await setupUser(B, '0771000302');
  r = await call('POST', '/deposit/marzpay', { token: 'uid:' + B, body: { amount: AMOUNT, phone: '0771000302', network: 'MTN Mobile Money' } });
  const depIdB = r.body?.depositId;
  const balBeforeB = userDoc(B).walletBalance;
  const depDocB = collMap('pendingDeposits').get(depIdB);

  const [pollResult, webhookResult] = await Promise.all([
    call('POST', '/deposit/marzpay/status', { token: 'uid:' + B, body: { depositId: depIdB } }),
    call('POST', '/deposit/callback', { body: {
      data: { reference: depDocB.marzReference, transaction: { uuid: depDocB.marzTxUuid, status: 'successful' } }
    } }),
  ]);
  check('poll request completes cleanly', pollResult.code === 200, pollResult.body);
  check('webhook request completes cleanly (always 200 to MarzPay per the ack-immediately pattern)', webhookResult.code === 200, webhookResult.body);
  await new Promise(r2 => setTimeout(r2, 200)); // webhook does its real work async after replying 200
  check('wallet credited exactly once from webhook+poll racing, not twice', userDoc(B).walletBalance === balBeforeB + AMOUNT, userDoc(B).walletBalance);
  check('exactly ONE deposit transaction record from the webhook+poll race', countDepositTxns(B) === 1, countDepositTxns(B));

  console.log('\n== A burst of 10 simultaneous status checks on one deposit ==');
  const C = 'dep-race-c';
  await setupUser(C, '0771000303');
  r = await call('POST', '/deposit/marzpay', { token: 'uid:' + C, body: { amount: AMOUNT, phone: '0771000303', network: 'MTN Mobile Money' } });
  const depIdC = r.body?.depositId;
  const balBeforeC = userDoc(C).walletBalance;
  await Promise.all(Array.from({ length: 10 }, () =>
    call('POST', '/deposit/marzpay/status', { token: 'uid:' + C, body: { depositId: depIdC } })
  ));
  check('wallet credited exactly once from a burst of 10 simultaneous checks', userDoc(C).walletBalance === balBeforeC + AMOUNT, userDoc(C).walletBalance);
  check('exactly ONE deposit transaction record from the burst', countDepositTxns(C) === 1, countDepositTxns(C));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
