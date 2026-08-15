/* SPACE8 PURCHASE RACE-CONDITION AUDIT
   The owner asked directly: "how sure are you a purchase can never double-pay
   or leak funds — check again and see." Every other money endpoint already had
   a live concurrent-race test (checkin, gift codes, milestone claims,
   withdrawals) except /invest/create itself — this fills that gap by actually
   firing simultaneous purchase requests at the real server.js (not asserting
   from a read of the code) and proving the lock holds:
     - two simultaneous purchases from a wallet that can only afford ONE never
       both succeed, and the wallet is debited exactly once
     - a burst of 10 simultaneous purchases against a wallet funded for
       exactly 3 lets exactly 3 through, no more no less
     - a purchase attempt with insufficient funds is rejected and touches
       nothing

   Run: node test-invest-concurrency.js   (exits 0 = all green)              */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '4091';

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
const BASE = 'http://127.0.0.1:4091';
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
const investments = () => collMap('investments');
const txns = () => collMap('transactions');
const countInvestments = uid => [...investments().values()].filter(i => i.userId === uid).length;
const countInvestTxns = uid => [...txns().values()].filter(t => t.userId === uid && t.type === 'investment').length;

async function setupFundedUser(uid, phone, balance) {
  await call('POST', '/account/create-profile', { token: 'uid:' + uid, body: { phone } });
  await call('POST', '/register', { token: 'uid:' + uid, body: {} });
  userDoc(uid).walletBalance = balance;
}

(async () => {
  await new Promise(r => setTimeout(r, 600));
  const PRICE = 30000; // hersheys tier

  console.log('\n== Two simultaneous purchases, wallet can only afford ONE ==');
  const A = 'race-a';
  await setupFundedUser(A, '0771000101', PRICE); // exactly one tier's worth, no more
  const [r1, r2] = await Promise.all([
    call('POST', '/invest/create', { token: 'uid:' + A, body: { tierKey: 'comet' } }),
    call('POST', '/invest/create', { token: 'uid:' + A, body: { tierKey: 'comet' } }),
  ]);
  const successesA = [r1, r2].filter(x => x.body?.status === 'success').length;
  check('exactly ONE of two simultaneous purchases succeeds', successesA === 1, { r1: r1.body, r2: r2.body });
  check('the loser gets a clean insufficient-funds rejection, not a crash/500', [r1, r2].some(x => x.code === 400 && /Need/.test(x.body?.message || '')), { r1: r1.body, r2: r2.body });
  check('wallet debited exactly once (balance is now 0, not negative)', userDoc(A).walletBalance === 0, userDoc(A).walletBalance);
  check('exactly ONE investment record created, not two', countInvestments(A) === 1, countInvestments(A));
  check('exactly ONE investment transaction record, not two', countInvestTxns(A) === 1, countInvestTxns(A));

  console.log('\n== Burst of 10 simultaneous purchases, wallet funded for exactly 3 ==');
  const B = 'race-b';
  await setupFundedUser(B, '0771000102', PRICE * 3);
  const burst = await Promise.all(Array.from({ length: 10 }, () =>
    call('POST', '/invest/create', { token: 'uid:' + B, body: { tierKey: 'comet' } })
  ));
  const successesB = burst.filter(x => x.body?.status === 'success').length;
  check('exactly 3 of 10 simultaneous purchases succeed (wallet only affords 3)', successesB === 3, { successes: successesB, bodies: burst.map(x => x.body?.status) });
  check('the other 7 are cleanly rejected as insufficient funds, no crashes (all HTTP 400)', burst.filter(x => x.body?.status !== 'success').every(x => x.code === 400), burst.map(x => x.code));
  check('wallet lands at exactly 0, never negative, never left with leftover from a phantom debit', userDoc(B).walletBalance === 0, userDoc(B).walletBalance);
  check('exactly 3 investment records created from the burst, not more, not fewer', countInvestments(B) === 3, countInvestments(B));
  check('exactly 3 investment transaction records from the burst', countInvestTxns(B) === 3, countInvestTxns(B));

  console.log('\n== A single purchase attempt with insufficient funds touches nothing ==');
  const C = 'race-c';
  await setupFundedUser(C, '0771000103', PRICE - 1000); // just short
  const rC = await call('POST', '/invest/create', { token: 'uid:' + C, body: { tierKey: 'comet' } });
  check('purchase rejected (400) when short by even a small amount', rC.code === 400, rC.body);
  check('exact shortfall reported in the message', /Need/.test(rC.body?.message || ''), rC.body);
  check('wallet balance completely untouched by the rejected attempt', userDoc(C).walletBalance === PRICE - 1000, userDoc(C).walletBalance);
  check('no investment record created for the rejected attempt', countInvestments(C) === 0, countInvestments(C));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
