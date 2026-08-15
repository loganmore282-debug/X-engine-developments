/* SPACE8 CASHBACK RECONCILER TEST
   Owner reported real drift: bought at 13:30:47, the day-1 cashback
   transaction landed at 13:33:13 -- about 2.5 minutes late. Root cause:
   settleInvestmentIfDue() only ever ran when the OWNING USER's own
   /account or /investments got read, so exactly when a payout landed
   depended entirely on when that user's client happened to poll after
   the 24-hour mark passed -- if the app was backgrounded, that could be
   minutes late (or longer).

   Fix: a company-wide reconcileCashback() sweep now runs on the same 30s
   reconciler tick as deposits/withdrawals/commissions, checking every
   active investment regardless of which user owns it.

   This proves the sweep actually credits a due investment WITHOUT the
   owning user's client ever touching /account or /investments -- the
   real bug scenario -- by waiting for the server's own startup
   setTimeout(runReconciler, 15000) to fire once and checking the mock DB
   directly, never through a request that would itself trigger
   settle-on-read.

   Run: node test-cashback-reconciler.js   (exits 0 = all green, ~16s)   */

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
const BASE = 'http://127.0.0.1:4099';
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
const transactions = () => collMap('transactions');

async function setupFundedUser(uid, phone, balance) {
  await call('POST', '/account/create-profile', { token: 'uid:' + uid, body: { phone } });
  await call('POST', '/register', { token: 'uid:' + uid, body: {} });
  userDoc(uid).walletBalance = balance;
}

(async () => {
  await new Promise(r => setTimeout(r, 600));

  console.log('\n== A due cashback payout is credited by the background sweep alone, with no read from the owning user ==');
  const A = 'reconciler-user-a';
  await setupFundedUser(A, '0771000301', 1000000);
  let r = await call('POST', '/invest/create', { token: 'uid:' + A, body: { tierKey: 'comet' } }); // 30,000 -> 600,000 over 180 days
  check('purchase succeeds', r.body?.status === 'success', r.body);
  const invId = r.body?.investmentId;
  const inv = investments().get(invId);
  // Backdate createdAt so 3 days of cashback are already due, exactly as
  // if real wall-clock time had simply passed -- no user action needed.
  inv.createdAt = new Date(Date.now() - 3 * 86400000);
  const balBefore = userDoc(A).walletBalance;
  const txCountBefore = [...transactions().values()].filter(t => t.investmentId === invId && t.type === 'cashback').length;
  check('sanity: nothing credited yet before the sweep runs', investments().get(invId).payoutsMade === 0, investments().get(invId));

  console.log('  (waiting ~15s for the server\'s own startup reconciler tick -- not calling /account or /investments for this user at all)');
  await new Promise(res => setTimeout(res, 15500));

  const freshInv = investments().get(invId);
  const expectedDaily = freshInv.dailyPayout;
  check('the sweep alone advanced payoutsMade to 3, with zero reads from the owning user', freshInv.payoutsMade === 3, freshInv);
  check('wallet was credited exactly 3x the daily payout by the sweep alone', userDoc(A).walletBalance === balBefore + expectedDaily * 3, { balance: userDoc(A).walletBalance, expected: balBefore + expectedDaily * 3 });
  const txCountAfter = [...transactions().values()].filter(t => t.investmentId === invId && t.type === 'cashback').length;
  check('exactly one cashback transaction record was written by the sweep (one settle call covering all 3 due days at once)', txCountAfter === txCountBefore + 1, { before: txCountBefore, after: txCountAfter });

  console.log('\n-- A second, not-yet-due investment is untouched by the same sweep --');
  const B = 'reconciler-user-b';
  await setupFundedUser(B, '0771000302', 1000000);
  r = await call('POST', '/invest/create', { token: 'uid:' + B, body: { tierKey: 'comet' } });
  const invIdB = r.body?.investmentId;
  // Freshly created (a few seconds old) -- zero full days elapsed, nothing due yet.
  check('a freshly-bought investment is not touched by the sweep (nothing due)', investments().get(invIdB).payoutsMade === 0, investments().get(invIdB));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
