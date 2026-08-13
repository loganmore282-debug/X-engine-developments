/* CHOCOMCC AMBIGUOUS-GATEWAY-FAILURE AUDIT (double-payout risk)
   Found comparing /admin/withdraw/process against Chronova's own, already-
   proven equivalent (same money-safety review that produced the
   /withdraw/callback fixes in test-callback-forgery.js).

   The bug: a network exception calling MarzPay's send-money endpoint
   (timeout, dropped connection, malformed response) means we genuinely do
   NOT know whether MarzPay received and started processing the payout
   before we lost the response -- that is a real, well-known distributed-
   systems failure mode, not the same thing as MarzPay cleanly answering
   "rejected". The OLD code folded BOTH cases into one branch and reverted
   the withdrawal straight back to 'pending', inviting an admin to retry --
   if MarzPay HAD actually received the first request, a retry sends the
   SAME payout a second time, paying the recipient twice.

   Chronova's own /admin/withdraw/process deliberately does NOT revert to
   'pending' on this ambiguous case -- it leaves the record at 'sending'
   (which blocks any further /admin/withdraw/process call on it, since that
   requires status 'pending') and lets /admin/integrity surface it so the
   owner checks the reference on MarzPay's own dashboard directly, rather
   than the server guessing. Ported the same distinction here, plus the
   matching deposit-side alert for a deposit stuck 'initiating' past the
   same ambiguous-failure window.

   Proves, against the real server:
     - a genuine network exception on send-money leaves the withdrawal on
       'sending', NOT reverted to 'pending' -- so nothing can retry it
     - a second /admin/withdraw/process attempt on that same withdrawal is
       correctly refused (status is 'sending', not 'pending')
     - /admin/integrity flags it as withdrawal_stuck_sending once it has
       aged past the window, with the reference an owner needs to check
     - a genuinely young 'sending' withdrawal is NOT flagged yet
     - by contrast, a CLEAN rejection from MarzPay (a real HTTP round-trip
       with an explicit error) still correctly reverts to 'pending' and CAN
       be retried -- this fix only changes the ambiguous case, not the
       already-correct one
     - a deposit stuck 'initiating' past the window gets the matching
       deposit_stuck_initiating alert

   Run: node test-withdrawal-ambiguous-failure.js   (exits 0 = all green) */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '4108';

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

const realFetch = global.fetch;
// nextSendMoneyBehavior: 'throw' | 'reject' | undefined(=success)
let nextSendMoneyBehavior;
global.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes('wearemarz.com') && u.endsWith('/send-money') && (!opts || opts.method === 'POST')) {
    const behavior = nextSendMoneyBehavior;
    nextSendMoneyBehavior = undefined;
    if (behavior === 'throw') throw new Error('fetch failed: network timeout');
    if (behavior === 'reject')
      return { ok: false, status: 400, json: async () => ({ status: 'error', message: 'Insufficient disbursement balance', error_code: 'INSUFFICIENT_BALANCE' }) };
    return { ok: true, status: 200, json: async () => ({ status: 'success', data: { transaction: { uuid: 'MTX-OK-' + Date.now(), status: 'processing' } } }) };
  }
  if (u.includes('wearemarz.com') && u.match(/\/send-money\/([^/?]+)/)) {
    return { ok: false, status: 500, json: async () => ({ error: 'not needed for this test' }) };
  }
  return realFetch(url, opts);
};

require('./server.js');

const BASE = 'http://127.0.0.1:4108';
async function call(method, p, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await fetch(BASE + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (_) {}
  return { code: r.status, body: j };
}
async function ownerCall(method, path, body) {
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-admin-key' }, body: body !== undefined ? JSON.stringify(body) : undefined });
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
const withdrawals = () => collMap('withdrawals');
const pendingDeposits = () => collMap('pendingDeposits');

async function setupUser(uid, phone) {
  await call('POST', '/account/create-profile', { token: 'uid:' + uid, body: { phone } });
  await call('POST', '/register', { token: 'uid:' + uid, body: {} });
}

(async () => {
  await new Promise(r => setTimeout(r, 600));

  console.log('\n== A genuine network exception on send-money leaves the withdrawal on "sending", NOT reverted to pending ==');
  const A = 'ambig-user-a';
  await setupUser(A, '0771002001');
  await ownerCall('POST', '/admin/deposit', { userId: A, amount: 500000, note: 'seed funds' });
  userDoc(A).totalInvested = 500000;
  await call('POST', '/bank/save', { token: 'uid:' + A, body: { holder: 'A', network: 'MTN Mobile Money', phone: '0771002001' } });
  collMap('bankAccounts').set('fx1', { userId: A, holder: 'A', network: 'MTN Mobile Money', phone: '+256771002001', createdAt: new Date() });
  let r = await call('POST', '/withdraw/request', { token: 'uid:' + A, body: { amount: 20000, holder: 'A', network: 'MTN Mobile Money', phone: '0771002001', pin: '1234' } });
  const witIdA = r.body.withdrawalId;
  const balBeforeA = userDoc(A).walletBalance;

  nextSendMoneyBehavior = 'throw';
  r = await ownerCall('POST', '/admin/withdraw/process', { withdrawalId: witIdA });
  check('the process call itself reports it could not confirm what happened (HTTP 500)', r.code === 500, r);
  check('the withdrawal stayed on "sending", NOT reverted to pending', withdrawals().get(witIdA).status === 'sending', withdrawals().get(witIdA).status);
  check('the sending reference was recorded for the owner to check on the MarzPay dashboard', !!withdrawals().get(witIdA).sendingReference, withdrawals().get(witIdA));
  check('wallet/totalWithdrawn are untouched by the ambiguous attempt itself', userDoc(A).walletBalance === balBeforeA, userDoc(A).walletBalance);

  console.log('\n== A second /admin/withdraw/process attempt on that same withdrawal is refused, so nothing can retry it ==');
  r = await ownerCall('POST', '/admin/withdraw/process', { withdrawalId: witIdA });
  check('refused: status is "sending", not "pending" -- cannot double-send', r.code === 400 && /sending/.test(r.body.message || ''), r);

  console.log('\n== /admin/integrity flags a "sending" withdrawal once it has aged past the window ==');
  withdrawals().get(witIdA).sendingAt = new Date(Date.now() - 5 * 60000);
  r = await ownerCall('GET', '/admin/integrity');
  let alert = (r.body.alerts || []).find(a => a.withdrawalId === witIdA);
  check('flagged as withdrawal_stuck_sending', alert && alert.kind === 'withdrawal_stuck_sending', alert);
  check('the alert carries the reference to check on the MarzPay dashboard', alert && alert.reference === withdrawals().get(witIdA).sendingReference, alert);

  console.log('\n== A freshly-ambiguous "sending" withdrawal is NOT flagged yet ==');
  const B = 'ambig-user-b';
  await setupUser(B, '0771002002');
  await ownerCall('POST', '/admin/deposit', { userId: B, amount: 500000, note: 'seed funds' });
  userDoc(B).totalInvested = 500000;
  await call('POST', '/bank/save', { token: 'uid:' + B, body: { holder: 'B', network: 'MTN Mobile Money', phone: '0771002002' } });
  collMap('bankAccounts').set('fx2', { userId: B, holder: 'B', network: 'MTN Mobile Money', phone: '+256771002002', createdAt: new Date() });
  r = await call('POST', '/withdraw/request', { token: 'uid:' + B, body: { amount: 15000, holder: 'B', network: 'MTN Mobile Money', phone: '0771002002', pin: '1234' } });
  const witIdB = r.body.withdrawalId;
  nextSendMoneyBehavior = 'throw';
  await ownerCall('POST', '/admin/withdraw/process', { withdrawalId: witIdB });
  r = await ownerCall('GET', '/admin/integrity');
  alert = (r.body.alerts || []).find(a => a.withdrawalId === witIdB);
  check('a genuinely fresh "sending" withdrawal is not flagged yet', !alert, alert);

  console.log('\n== By contrast, a CLEAN rejection from MarzPay still correctly reverts to pending and CAN be retried (unchanged behavior) ==');
  const C = 'ambig-user-c';
  await setupUser(C, '0771002003');
  await ownerCall('POST', '/admin/deposit', { userId: C, amount: 500000, note: 'seed funds' });
  userDoc(C).totalInvested = 500000;
  await call('POST', '/bank/save', { token: 'uid:' + C, body: { holder: 'C', network: 'MTN Mobile Money', phone: '0771002003' } });
  collMap('bankAccounts').set('fx3', { userId: C, holder: 'C', network: 'MTN Mobile Money', phone: '+256771002003', createdAt: new Date() });
  r = await call('POST', '/withdraw/request', { token: 'uid:' + C, body: { amount: 12000, holder: 'C', network: 'MTN Mobile Money', phone: '0771002003', pin: '1234' } });
  const witIdC = r.body.withdrawalId;
  nextSendMoneyBehavior = 'reject';
  r = await ownerCall('POST', '/admin/withdraw/process', { withdrawalId: witIdC });
  check('a clean rejection reports 400, not 500', r.code === 400, r);
  check('a clean rejection correctly reverts to pending (this case never moved money)', withdrawals().get(witIdC).status === 'pending', withdrawals().get(witIdC).status);
  nextSendMoneyBehavior = undefined; // let the retry succeed
  r = await ownerCall('POST', '/admin/withdraw/process', { withdrawalId: witIdC });
  check('a retry after a clean rejection is allowed and succeeds', r.code === 200 && withdrawals().get(witIdC).status === 'processing', { code: r.code, status: withdrawals().get(witIdC).status });

  console.log('\n== A deposit stuck "initiating" past the window gets the matching deposit_stuck_initiating alert ==');
  const D = 'ambig-user-d';
  await setupUser(D, '0771002004');
  pendingDeposits().set('dep-stuck-d', {
    userId: D, phone: '+256771002004', amount: 30000, ref: 'B-STUCK-D', marzReference: 'REF-STUCK-D',
    status: 'initiating', createdAt: new Date(Date.now() - 5 * 60000),
  });
  r = await ownerCall('GET', '/admin/integrity');
  alert = (r.body.alerts || []).find(a => a.depositId === 'dep-stuck-d');
  check('flagged as deposit_stuck_initiating', alert && alert.kind === 'deposit_stuck_initiating', alert);
  check('the alert carries the reference to check on the MarzPay dashboard', alert && alert.reference === 'REF-STUCK-D', alert);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
