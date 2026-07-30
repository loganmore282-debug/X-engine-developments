/* CHRONOVA — a crash landing DURING the gateway call must never leave a
   real money-moving attempt with zero trace.

   Real incident this fixes: a customer paid via MTN MoMo, MarzPay's own
   dashboard confirmed the collection "Completed", but the app showed no
   deposit record at all and never credited the wallet. Root cause: the
   deposit/withdrawal record was written AFTER calling marzCollect/
   marzSendMoney — a real charge/payout can already be in flight at MarzPay
   when this process dies (a redeploy landing at the wrong instant), and
   with nothing written yet, that attempt becomes permanently invisible.

   Fixed by writing the record BEFORE the gateway call, in a transient
   'initiating' (deposits) / 'sending' (withdrawals) status carrying OUR OWN
   reference, so a crash right after the gateway call always leaves a
   findable trace — and the Integrity Audit flags anything stuck there past
   a couple of minutes for the owner to check against the gateway dashboard.

   This test simulates the exact crash: the gateway call throws (as it would
   if the network/process died before a response ever came back), and
   confirms the record survives with the right status + reference, then
   confirms the Integrity Audit flags it once it's been stuck a while.
   Run:  node test-crash-before-gateway.js      (exits 0 = all green)       */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '4001';

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

// The gateway call itself "crashes" — simulates the process dying (or the
// network dropping) before a response ever comes back, indistinguishable
// from our side whether MarzPay actually processed the charge/payout or not.
const realFetch = global.fetch;
let killCollect = false, killSend = false;
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (killCollect && u.includes('/collect-money')) throw new Error('SIMULATED CRASH: process died mid-call');
  if (killSend && u.endsWith('/send-money')) throw new Error('SIMULATED CRASH: process died mid-call');
  return realFetch(url, opts);
};

require('./server.js');

const BASE = 'http://127.0.0.1:4001';
async function call(method, p, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await realFetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (_) {}
  return { code: r.status, body: j };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}
const ADMIN = { adminKey: 'test-admin-key' };
function seedUser(uid, overrides = {}) {
  mockdb.__store.get('users') || mockdb.__store.set('users', new Map());
  mockdb.__store.get('users').set(uid, {
    registrationDone: true, walletBalance: 500000, name: uid, phone: '0771000001', status: 'active', ...overrides,
  });
}

(async () => {
  await sleep(1200);

  console.log('\n── Deposit: a crash during the gateway call leaves a findable record, not nothing');
  seedUser('daniel-uid');
  killCollect = true;
  const r1 = await call('POST', '/deposit/marzpay', { token: 'uid:daniel-uid', body: { amount: 80000, phone: '0767255700' } });
  killCollect = false;
  check('the client sees the call fail (500) — correctly, since we genuinely don\'t know what happened', r1.code === 500, r1.body);
  const deps = [...mockdb.__store.get('pendingDeposits').values()].filter(d => d.userId === 'daniel-uid');
  check('but a deposit record WAS written — findable by phone/reference, not invisible', deps.length === 1, deps);
  check('it carries the status \'initiating\' and our own reference, ready for a reconciler to pick up', deps[0]?.status === 'initiating' && !!deps[0]?.marzReference, deps[0]);
  check('the wallet is correctly untouched — we never confirmed the gateway actually succeeded', mockdb.__store.get('users').get('daniel-uid').walletBalance === 500000, mockdb.__store.get('users').get('daniel-uid').walletBalance);

  // Backdate it to simulate real elapsed time, then run the audit.
  const depId = [...mockdb.__store.get('pendingDeposits').entries()].find(([, d]) => d.userId === 'daniel-uid')[0];
  mockdb.__store.get('pendingDeposits').get(depId).createdAt = new Date(Date.now() - 5 * 60000);
  let r = await call('POST', '/admin/integrity', { body: { ...ADMIN } });
  const stuckDep = (r.body?.alerts || []).find(a => a.kind === 'deposit_stuck_initiating' && a.depositId === depId);
  check('the Integrity Audit flags the stuck deposit once it\'s been sitting a few minutes, with its reference for the owner to check on the gateway dashboard',
    !!stuckDep && !!stuckDep.reference, r.body?.alerts);

  console.log('\n── Withdrawal: a crash during the gateway call leaves a findable record, not a silently-stuck "pending"');
  seedUser('paul-uid', { walletBalance: 50000 });
  mockdb.__store.get('withdrawals') || mockdb.__store.set('withdrawals', new Map());
  mockdb.__store.get('withdrawals').set('wit-paul-1', {
    userId: 'paul-uid', userName: 'paul-uid', userPhone: '0771000002', withdrawalPhone: '0771000002',
    amount: 20000, fee: 0, netAmount: 20000, status: 'pending', createdAt: new Date(),
  });
  killSend = true;
  const r2 = await call('POST', '/admin/withdraw/process', { body: { ...ADMIN, withdrawalId: 'wit-paul-1' } });
  killSend = false;
  check('the client sees the call fail (500)', r2.code === 500, r2.body);
  const witAfter = mockdb.__store.get('withdrawals').get('wit-paul-1');
  check('the withdrawal is NOT silently stuck at plain \'pending\' with no trace — it shows \'sending\' + our reference',
    witAfter.status === 'sending' && !!witAfter.sendingReference, witAfter);

  witAfter.sendingAt = new Date(Date.now() - 5 * 60000);
  r = await call('POST', '/admin/integrity', { body: { ...ADMIN } });
  const stuckWit = (r.body?.alerts || []).find(a => a.kind === 'withdrawal_stuck_sending' && a.withdrawalId === 'wit-paul-1');
  check('the Integrity Audit flags the stuck withdrawal too, with its reference for the owner to check against the gateway',
    !!stuckWit && !!stuckWit.reference, r.body?.alerts);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('SUITE CRASH:', e); process.exit(1); });
