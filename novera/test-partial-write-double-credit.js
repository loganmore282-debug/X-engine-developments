/* NOVERA PARTIAL-WRITE DOUBLE-CREDIT AUDIT
   db.js's runTransaction is NOT atomic on MongoDB M0 (the free tier has no
   multi-document transactions) — it simply replays the queued writes one at a
   time. So if a write fails part-way through, everything before it is already
   committed and nothing rolls back.

   Every money path used to queue the WALLET CREDIT FIRST and the guard flag
   that marks the payout as done SECOND. That ordering is the dangerous one:
   a failure in between leaves money credited with the guard still unset, and
   every one of these paths is automatically retried —
     - cashback     -> reconcileCashback() re-runs every single second
     - deposits     -> MarzPay webhook + the client's own status poll + reconciler
     - promo codes  -> the member simply taps Redeem again after seeing an error
   so the retry recomputes the exact same "still owed" amount and credits it
   AGAIN. For cashback that is unbounded: it would re-credit every second until
   the failing write finally landed.

   The fix inverts the order everywhere — write the guard first, credit second
   — so a failure leaves the money UNPAID (safe, and either rolled back for a
   clean retry or flagged for manual credit) rather than PAID-BUT-UNRECORDED.

   This file injects a real transient write failure at exactly that window and
   proves money is never invented. Every check here FAILS against the old
   credit-first ordering and passes against the fixed one.

   Run: node test-partial-write-double-credit.js   (exits 0 = all green)     */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '4121';

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
let marzN = 0;
let _nextCollectStatus = 'pending';
global.fetch = async (url, opts) => {
  const u = String(url);
  const json = body => ({ ok: true, status: 200, json: async () => body });
  if (u.includes('wearemarz.com') && u.endsWith('/collect-money'))
    return json({ status: 'success', data: { transaction: { uuid: 'DTX-' + (++marzN), status: 'pending' } } });
  if (u.includes('wearemarz.com') && u.includes('/collect-money/'))
    return json({ status: 'success', data: { transaction: { status: _nextCollectStatus } } });
  return realFetch(url, opts);
};

require('./server.js');

const BASE = 'http://127.0.0.1:4121';
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
const userDoc = id => collMap('users').get(id);
const adminHeaders = { 'Content-Type': 'application/json', Authorization: 'Bearer test-admin-key' };
async function adminCall(path, body) {
  const r = await realFetch(BASE + path, { method: 'POST', headers: adminHeaders, body: JSON.stringify(body || {}) });
  let j = null; try { j = await r.json(); } catch (_) {}
  return { code: r.status, body: j };
}
async function setupFundedUser(uid, phone, balance) {
  await call('POST', '/account/create-profile', { token: 'uid:' + uid, body: { phone } });
  await call('POST', '/register', { token: 'uid:' + uid, body: {} });
  userDoc(uid).walletBalance = balance;
}
// Make the NEXT write to `users` fail once, simulating the transient M0 blip
// that opens the partial-write window in the first place.
function failNextUserWrite() { global.__mockDbFailUpdateOnce.add('users'); }

(async () => {
  await new Promise(r => setTimeout(r, 600));

  console.log('\n== Cashback: a failed wallet write must never leave a payout credited-but-unrecorded ==');
  const A = 'partial-cashback';
  await setupFundedUser(A, '0771000201', 5000000);
  let r = await call('POST', '/invest/create', { token: 'uid:' + A, body: { tierKey: 'comet' } });
  check('investment created', r.body?.status === 'success', r.body);
  const invId = r.body.investmentId;
  const inv = collMap('investments').get(invId);
  const daily = inv.dailyPayout;

  // Exactly one day owed.
  inv.createdAt = new Date(Date.now() - 1 * 86400000);
  const balBefore = userDoc(A).walletBalance;

  // First settle attempt: the investment's own payout record is written, then
  // the wallet credit fails.
  failNextUserWrite();
  await call('GET', '/investments', { token: 'uid:' + A });
  check('no money was credited on the failed attempt', userDoc(A).walletBalance === balBefore,
    { balance: userDoc(A).walletBalance, expected: balBefore });
  check('the payout record was rolled back, so the day is not silently lost',
    (collMap('investments').get(invId).payoutsMade || 0) === 0, collMap('investments').get(invId));

  // Retry — this is the every-second reconciler / next app open.
  await call('GET', '/investments', { token: 'uid:' + A });
  check('retry pays that day exactly ONCE, never twice', userDoc(A).walletBalance === balBefore + daily,
    { balance: userDoc(A).walletBalance, expectedOnce: balBefore + daily, wouldBeDouble: balBefore + daily * 2 });
  check('payoutsMade advanced by exactly 1', (collMap('investments').get(invId).payoutsMade || 0) === 1,
    collMap('investments').get(invId));

  // And settling repeatedly with nothing newly due stays flat.
  await call('GET', '/investments', { token: 'uid:' + A });
  await call('GET', '/investments', { token: 'uid:' + A });
  check('further settles with nothing due credit nothing more', userDoc(A).walletBalance === balBefore + daily,
    userDoc(A).walletBalance);

  console.log('\n== Deposit: a failed wallet write must never let the same deposit credit twice ==');
  const B = 'partial-deposit';
  await setupFundedUser(B, '0771000202', 0);
  _nextCollectStatus = 'pending';
  const dep = await call('POST', '/deposit/marzpay', { token: 'uid:' + B, body: { amount: 30000, phone: '0771000202', network: 'MTN Mobile Money' } });
  check('deposit initiated', dep.body?.status === 'success', dep.body);
  const depositId = dep.body.depositId;
  const depBalBefore = userDoc(B).walletBalance;

  _nextCollectStatus = 'successful';
  failNextUserWrite();
  await call('POST', '/deposit/marzpay/status', { token: 'uid:' + B, body: { depositId } });
  const depRow = collMap('pendingDeposits').get(depositId);
  check('deposit is claimed as matched even though the credit failed', depRow.status === 'matched', depRow);
  check('it is flagged for manual credit rather than silently lost', depRow.needsManualCredit === true, depRow);
  check('no money was credited on the failed attempt', userDoc(B).walletBalance === depBalBefore, userDoc(B).walletBalance);

  // Every retry route converges on the same already-claimed deposit.
  await call('POST', '/deposit/marzpay/status', { token: 'uid:' + B, body: { depositId } });
  await call('POST', '/deposit/callback', { body: { reference: depRow.marzReference, data: { transaction: { status: 'successful', uuid: depRow.marzTxUuid } } } });
  await new Promise(r => setTimeout(r, 150));
  check('retries never re-credit an already-claimed deposit', userDoc(B).walletBalance === depBalBefore,
    { balance: userDoc(B).walletBalance, wouldBeDouble: depBalBefore + 60000 });

  // A claimed-but-uncredited deposit is 'matched', so force-credit's normal
  // "already credited" short-circuit would strand the member's money forever.
  // Assert the money genuinely LANDS, not merely that the call returns success.
  const forced = await adminCall('/admin/deposit/force-credit', { depositId });
  check('admin force-credit reports success', forced.body?.status === 'success', forced.body);
  check('force-credit actually pays the stranded deposit into the wallet',
    userDoc(B).walletBalance === depBalBefore + 30000,
    { balance: userDoc(B).walletBalance, expected: depBalBefore + 30000 });
  check('the manual-credit flag is cleared once recovered',
    collMap('pendingDeposits').get(depositId).needsManualCredit !== true,
    collMap('pendingDeposits').get(depositId));

  // And recovering twice must not pay twice.
  const forcedAgain = await adminCall('/admin/deposit/force-credit', { depositId });
  check('a second force-credit is a no-op, never a second payment',
    userDoc(B).walletBalance === depBalBefore + 30000,
    { balance: userDoc(B).walletBalance, wouldBeDouble: depBalBefore + 60000, resp: forcedAgain.body });

  console.log('\n== Promo code: a failed claim write must never credit the reward anyway ==');
  // Fixed reward (min === max) so the expected balance below is exact.
  const gen = await adminCall('/admin/promocodes/generate', { count: 1, minAmount: 7500, maxAmount: 7500, maxUses: 50 });
  const code = (gen.body?.codes || [])[0]?.code;
  check('promo code generated', !!code, gen.body);

  const C = 'partial-redeem';
  await setupFundedUser(C, '0771000203', 0);
  const redeemBalBefore = userDoc(C).walletBalance;

  // Fail the CLAIM write (promoCodes) — under the old credit-first ordering the
  // reward had already landed by this point, so the member's retry doubled it.
  global.__mockDbFailUpdateOnce.add('promoCodes');
  const bad = await call('POST', '/redeem', { token: 'uid:' + C, body: { code } });
  check('the failed redeem reports an error rather than succeeding', bad.body?.status !== 'success', bad.body);
  check('nothing was credited when the claim failed', userDoc(C).walletBalance === redeemBalBefore, userDoc(C).walletBalance);

  const good = await call('POST', '/redeem', { token: 'uid:' + C, body: { code } });
  check('the retry succeeds', good.body?.status === 'success', good.body);
  check('the reward is credited exactly ONCE across both attempts',
    userDoc(C).walletBalance === redeemBalBefore + 7500,
    { balance: userDoc(C).walletBalance, expectedOnce: redeemBalBefore + 7500, wouldBeDouble: redeemBalBefore + 15000 });

  const again = await call('POST', '/redeem', { token: 'uid:' + C, body: { code } });
  check('a third attempt is refused as already used', again.body?.status !== 'success', again.body);
  check('balance still reflects exactly one reward', userDoc(C).walletBalance === redeemBalBefore + 7500, userDoc(C).walletBalance);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
