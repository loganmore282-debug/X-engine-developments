/* SPACE8 WITHDRAWAL REQUEST-CREATION CONCURRENCY GUARD
   Reviewed for double-submission safety, 2026-08-16 (a second AI reviewer
   flagged it independently after the fact): withLock('bal:'+userId) inside
   /withdraw/request only SERIALISES two requests racing each other -- the
   first fully reserves balance, THEN the second runs -- it does not
   collapse them into one. A genuinely concurrent double-submit (a UI
   double-tap, or a client that gives up on a slow response and fires a
   second request while the first is still being handled) used to create
   two separate real withdrawals, both individually valid on their own.

   Fixed with _witRequestInFlight, a Set guarding just the CREATION of a
   new withdrawal request per user (released in `finally`, so it can never
   leak) -- deliberately NOT a time-based cooldown like /deposit/marzpay's
   _depCreateDebounce, since this endpoint itself completes in milliseconds
   (no external gateway call happens during /withdraw/request, only later
   at admin-approval time): a real user's second, later, genuinely
   different withdrawal a few seconds after the first should never be
   blocked, only two requests actually overlapping in time should be.

   This gets its own file rather than folding into test-withdrawal-
   security.js -- that file's fake "uid:x" tokens don't parse as real JWTs,
   so every request in it shares ONE rate-limit bucket (rlKeyByUser falls
   back to req.ip), and it's already close to that shared budget.

   Boots the REAL server.js against an in-memory mock database and proves:
     - two truly concurrent identical /withdraw/request calls from the
       same user: exactly one succeeds, the other is rejected 429 "already
       being processed" (not a normal validation error)
     - exactly one withdrawal doc and one wallet debit result, never two
     - once the first request has FULLY completed, a genuinely later
       (sequential, not overlapping) second withdrawal is NOT blocked --
       the guard only ever blocks true overlap, not a later distinct
       request
     - the guard is per-user: two DIFFERENT users racing concurrently each
       get their own withdrawal through, neither blocks the other

   Run: node test-withdrawal-concurrency-guard.js   (exits 0 = all green) */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '4201';

const Module = require('module');
const mockdb = require('./test-mockdb.js');
// Local to THIS file/process only (each test-*.js file runs as its own
// process, so this never touches the shared test-mockdb.js module other
// test files see): the in-memory mock resolves every DB op as one
// unbroken microtask chain with no genuine yield point, unlike a real
// MongoDB call's actual network round-trip -- that makes it structurally
// impossible for two truly concurrent /withdraw/request calls to ever
// interleave here (whichever handler starts running first monopolizes the
// event loop clear through to sending its response, since Node drains all
// pending microtasks before it will service another connection's pending
// work), which would make the very race this guard defends against
// impossible to reproduce in a test at all. Inserting one real macrotask
// yield here reproduces the yield point a genuine network call would have.
const _origRunTransaction = mockdb.db.runTransaction.bind(mockdb.db);
mockdb.db.runTransaction = async function (fn) {
  await new Promise(r => setTimeout(r, 10));
  return _origRunTransaction(fn);
};
const dbPath = require.resolve('./db.js');
const dbMod = new Module(dbPath); dbMod.exports = mockdb; dbMod.loaded = true;
require.cache[dbPath] = dbMod;

const faPath = require.resolve('firebase-admin');
const faMod = new Module(faPath);
faMod.exports = {
  initializeApp: () => {}, credential: { cert: () => ({}) },
  // A tiny artificial delay (macrotask, not microtask) on verifyIdToken --
  // local to this file's own stub, doesn't affect any other test. Without
  // it, the in-memory mock DB has no real I/O latency at all, so two
  // "concurrent" fetch() calls never actually overlap at the server: the
  // first request's entire handler resolves via microtasks before Node's
  // event loop even gets to processing the second connection, making them
  // serialize in practice despite being fired via Promise.all. In
  // production, verifyAuth/DB calls involve real network I/O with enough
  // latency for genuine overlap -- this delay reproduces that condition
  // so the guard's actual concurrency behavior gets exercised for real.
  auth: () => ({ verifyIdToken: async tok => {
    await new Promise(r => setTimeout(r, 5));
    if (String(tok).startsWith('uid:')) return { uid: tok.slice(4) };
    throw new Error('bad');
  } }),
};
faMod.loaded = true;
require.cache[faPath] = faMod;

require('./server.js');

const BASE = 'http://127.0.0.1:4201';
async function call(method, p, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  headers['Connection'] = 'close';
  const r = await fetch(BASE + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, keepalive: false });
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

async function setupFundedUser(uid, phone, balance) {
  await call('POST', '/account/create-profile', { token: 'uid:' + uid, body: { phone } });
  await call('POST', '/register', { token: 'uid:' + uid, body: {} });
  userDoc(uid).walletBalance = balance;
  userDoc(uid).totalInvested = balance; // clears requireInvestToWithdraw
  collMap('bankAccounts').set(uid + '-acct', { userId: uid, holder: 'Test Holder', network: 'MTN Mobile Money', phone: '+256700111222', createdAt: new Date() });
}

(async () => {
  await new Promise(r => setTimeout(r, 600));

  console.log('\n== Two truly concurrent identical requests: exactly one wins ==');
  const A = 'guard-a';
  await setupFundedUser(A, '0771900011', 1000000);
  const aBalBefore = userDoc(A).walletBalance;
  const [r1, r2] = await Promise.all([
    call('POST', '/withdraw/request', { token: 'uid:' + A, body: { amount: 20000, holder: 'Test Holder', network: 'MTN Mobile Money', phone: '700111222', pin: '1234' } }),
    call('POST', '/withdraw/request', { token: 'uid:' + A, body: { amount: 20000, holder: 'Test Holder', network: 'MTN Mobile Money', phone: '700111222', pin: '1234' } }),
  ]);
  const results = [r1, r2];
  const successes = results.filter(x => x.body?.status === 'success').length;
  const rejected = results.filter(x => x.code === 429 && /already being processed/i.test(x.body?.message || ''));
  check('exactly ONE of two truly concurrent identical requests succeeds', successes === 1, results.map(x => x.body));
  check('the other is rejected 429 "already being processed", not a normal validation error', rejected.length === 1, results.map(x => ({ code: x.code, body: x.body })));
  check('exactly ONE withdrawal doc created (never two from the same double-submit)',
    [...withdrawals().values()].filter(w => w.userId === A).length === 1,
    [...withdrawals().values()].filter(w => w.userId === A).length);
  check('wallet debited exactly once, not twice', userDoc(A).walletBalance === aBalBefore - 20000, userDoc(A).walletBalance);

  console.log('\n== Once the first request has FULLY completed, a later distinct withdrawal is NOT blocked ==');
  const r3 = await call('POST', '/withdraw/request', { token: 'uid:' + A, body: { amount: 15000, holder: 'Test Holder', network: 'MTN Mobile Money', phone: '700111222', pin: '1234' } });
  check('a genuinely sequential (non-overlapping) second withdrawal succeeds normally -- the guard only blocks true overlap', r3.body?.status === 'success', r3.body);
  check('two withdrawal docs total now (the sequential one landed)', [...withdrawals().values()].filter(w => w.userId === A).length === 2,
    [...withdrawals().values()].filter(w => w.userId === A).length);

  console.log('\n== The guard is per-user: two different users racing concurrently never block each other ==');
  const B = 'guard-b', C = 'guard-c';
  await setupFundedUser(B, '0771900012', 1000000);
  await setupFundedUser(C, '0771900013', 1000000);
  const [rb, rc] = await Promise.all([
    call('POST', '/withdraw/request', { token: 'uid:' + B, body: { amount: 20000, holder: 'Test Holder', network: 'MTN Mobile Money', phone: '700111222', pin: '1234' } }),
    call('POST', '/withdraw/request', { token: 'uid:' + C, body: { amount: 20000, holder: 'Test Holder', network: 'MTN Mobile Money', phone: '700111222', pin: '1234' } }),
  ]);
  check('user B succeeds despite racing a concurrent request from a DIFFERENT user', rb.body?.status === 'success', rb.body);
  check('user C succeeds despite racing a concurrent request from a DIFFERENT user', rc.body?.status === 'success', rc.body);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
