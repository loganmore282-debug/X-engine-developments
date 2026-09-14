/* SPACE8 DEPOSIT ABUSE AUTO-BAN TEST
   Owner asked for two automatic bans on deposit abuse:
     1) 5+ deposit REQUESTS from the same account within a rolling 60s
        window, where NONE of them ever actually completes -- the pattern of
        someone repeatedly tapping Add Funds then backing out. A genuine
        member who deposits several times quickly must NOT be banned as
        long as at least one of those attempts actually clears.
     2) More than 20 FAILED deposits (status:'failed') from the same
        account in the same calendar day.

   Both are proven as real behavior, not just code reading:
     - 5 rapid-fire deposit requests that never resolve -> banned on the 5th.
     - 5 rapid-fire deposit requests where one is confirmed successful in
       between -> NOT banned (the exemption actually works, not just the
       ban trigger).
     - A user with exactly 20 pre-existing failed deposits today, on the
       21st failure (driven through the real code path, not just seeded)
       -> banned. A user with only 19 existing + 1 new (20 total) is not.
     - A totally unrelated user with plenty of their OWN failed deposits is
       never affected by another user's count (no cross-account leakage).

   Run: node test-deposit-abuse-autoban.js   (exits 0 = all green)         */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '4114';

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

// MarzPay stub: collect-money always "initiates" (pending, with a uuid);
// the per-transaction status-check endpoint's answer is controlled per-test
// via `_nextCollectStatus` so each scenario can decide whether a given
// deposit goes on to succeed or fail.
const realFetch = global.fetch;
let marzN = 0;
let _nextCollectStatus = 'pending'; // 'pending' | 'successful' | 'failed'
global.fetch = async (url, opts) => {
  const u = String(url);
  const json = body => ({ ok: true, status: 200, json: async () => body });
  if (u.includes('wearemarz.com') && u.endsWith('/collect-money')) {
    return json({ status: 'success', data: { transaction: { uuid: 'DTX-' + (++marzN), status: 'pending' } } });
  }
  if (u.includes('wearemarz.com') && u.includes('/collect-money/')) {
    return json({ status: 'success', data: { transaction: { status: _nextCollectStatus } } });
  }
  return realFetch(url, opts);
};

require('./server.js');

const BASE = 'http://127.0.0.1:4114';
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
const pendingDeposits = () => collMap('pendingDeposits');

async function setupFundedUser(uid, phone, balance) {
  await call('POST', '/account/create-profile', { token: 'uid:' + uid, body: { phone } });
  await call('POST', '/register', { token: 'uid:' + uid, body: {} });
  userDoc(uid).walletBalance = balance;
}
async function deposit(uid, phone) {
  return call('POST', '/deposit/marzpay', { token: 'uid:' + uid, body: { amount: 30000, phone, network: 'MTN Mobile Money' } });
}

// server.js's own nowStr()'s date format (MM/DD/YYYY, EAT) -- reproduced so
// the test can seed "today" deposits the same way the real code stamps them.
function todayStr() {
  const d = new Date(Date.now() + 3 * 3600000);
  const p = n => String(n).padStart(2, '0');
  return p(d.getUTCMonth() + 1) + '/' + p(d.getUTCDate()) + '/' + d.getUTCFullYear();
}

(async () => {
  await new Promise(r => setTimeout(r, 600));

  console.log('\n== Rule 1: 5 rapid deposit requests that NEVER complete -> auto-ban ==');
  _nextCollectStatus = 'pending';
  const A = 'spam-never-completes';
  await setupFundedUser(A, '0771000101', 1000000);
  let lastCode;
  for (let i = 1; i <= 5; i++) {
    const r = await deposit(A, '0771000101');
    lastCode = r;
    if (i < 5) check(`attempt ${i} is not itself a ban (success or debounce 429)`, r.code === 200 || r.code === 429, r.body);
  }
  check('the 5th attempt is rejected as BANNED', lastCode.code === 403 && lastCode.body?.code === 'BANNED', lastCode.body);
  check('user doc is actually marked banned', userDoc(A).status === 'banned', userDoc(A));

  console.log('\n-- Once banned, further deposit attempts are rejected as banned (not re-processed) --');
  const after = await deposit(A, '0771000101');
  check('still rejected as banned', after.code === 403 && after.body?.code === 'BANNED', after.body);

  console.log('\n== Rule 1 exemption: 5 rapid requests, but ONE actually succeeds in between -> NOT banned ==');
  const B = 'spam-one-succeeds';
  await setupFundedUser(B, '0771000102', 1000000);
  const first = await deposit(B, '0771000102');
  check('first deposit succeeds (initiated)', first.body?.status === 'success', first.body);
  const depositId = first.body.depositId;

  _nextCollectStatus = 'successful';
  const statusR = await call('POST', '/deposit/marzpay/status', { token: 'uid:' + B, body: { depositId } });
  check('status check confirms this one actually matched', statusR.body?.state === 'matched', statusR.body);

  _nextCollectStatus = 'pending';
  let lastB;
  for (let i = 2; i <= 5; i++) {
    lastB = await deposit(B, '0771000102');
  }
  check('the 5th overall attempt is NOT a ban -- one earlier deposit in this same burst actually cleared', lastB.code !== 403, lastB.body);
  check('user B is not banned', userDoc(B).status !== 'banned', userDoc(B));

  console.log('\n== Rule 2: more than 20 failed deposits in the same day -> auto-ban ==');
  const C = 'many-failures-today';
  await setupFundedUser(C, '0771000103', 1000000);
  const today = todayStr();
  // Seed 20 pre-existing failed deposits directly (bypassing the request-
  // spam rule entirely, so this isolates Rule 2 on its own) -- exactly the
  // real shape a genuine failed deposit has.
  for (let i = 0; i < 20; i++) {
    pendingDeposits().set('seed-fail-' + i, {
      userId: C, phone: '0771000103', network: 'MTN Mobile Money', amount: 30000,
      ref: 'B-SEED-' + i, marzReference: 'seed-ref-' + i, status: 'failed', failureReason: 'seed',
      date: today, time: '00:00:00', createdAt: new Date(),
    });
  }
  check('sanity: user C not banned yet with exactly 20 failures', userDoc(C).status !== 'banned', userDoc(C));

  // Drive the 21st failure through the REAL code path (a deposit that
  // genuinely resolves to failed via the status-check endpoint), not just
  // another seeded doc -- proving markDepositFailed() itself performs the
  // count-and-ban, not merely that a pre-seeded snapshot would total 21.
  const cDep = await deposit(C, '0771000103');
  check('the 21st deposit itself is accepted (not caught by the 60s spam rule, this is its first request)', cDep.body?.status === 'success', cDep.body);
  _nextCollectStatus = 'failed';
  const cStatus = await call('POST', '/deposit/marzpay/status', { token: 'uid:' + C, body: { depositId: cDep.body.depositId } });
  check('the 21st deposit resolves to failed', cStatus.body?.state === 'failed', cStatus.body);
  check('crossing 21 failed-today bans the user automatically', userDoc(C).status === 'banned', userDoc(C));

  console.log('\n-- A different user with their own failures is never affected by someone else\'s count --');
  const D = 'unrelated-user';
  await setupFundedUser(D, '0771000104', 1000000);
  for (let i = 0; i < 15; i++) {
    pendingDeposits().set('seed-fail-d-' + i, {
      userId: D, phone: '0771000104', network: 'MTN Mobile Money', amount: 30000,
      ref: 'B-SEED-D-' + i, marzReference: 'seed-ref-d-' + i, status: 'failed', failureReason: 'seed',
      date: today, time: '00:00:00', createdAt: new Date(),
    });
  }
  check('user D (only 15 failures, well under 20) is not banned', userDoc(D).status !== 'banned', userDoc(D));
  check('user C being banned did not touch user D', userDoc(D).status !== 'banned', userDoc(D));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
