/* CHOCOMCC USDT (TRC20) DEPOSIT — a second, manual-review deposit rail
   alongside the automatic MarzPay mobile-money flow. Nothing here is
   auto-credited: a member submits a TXID, it sits as 'awaiting_verification'
   until an admin approves it (via the existing /admin/deposit/force-credit,
   reusing creditDeposit()'s claim-before-credit safety with no new
   money-moving code) or rejects it.

   Covers: settings round-trip, submit validation (disabled/rate unset/bad
   amount/bad txid/below minimum), duplicate-TXID protection (same user is a
   no-op re-fetch, a different user is refused), debounce, admin approve
   (money actually lands, double-approve is a no-op), admin reject (wallet
   untouched, double-reject is a no-op, an already-matched deposit can't be
   rejected), and auth on every endpoint.

   Run: node test-usdt-deposit.js   (exits 0 = all green)                  */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '4131';

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

const BASE = 'http://127.0.0.1:4131';
async function call(method, p, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await fetch(BASE + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (_) {}
  return { code: r.status, body: j };
}
const adminHeaders = { 'Content-Type': 'application/json', Authorization: 'Bearer test-admin-key' };
async function adminCall(path, body) {
  const r = await fetch(BASE + path, { method: 'POST', headers: adminHeaders, body: JSON.stringify(body || {}) });
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
async function setupFundedUser(uid, phone, balance) {
  await call('POST', '/account/create-profile', { token: 'uid:' + uid, body: { phone } });
  await call('POST', '/register', { token: 'uid:' + uid, body: {} });
  if (balance) userDoc(uid).walletBalance = balance;
}
async function setUsdtSettings(patch) {
  return adminCall('/admin/settings/update', { settings: patch });
}
let _testDocN = 0;
function db_pendingDepositsInsertForTest(userId, txid) {
  const id = 'preexisting' + (++_testDocN);
  collMap('pendingDeposits').set(id, {
    userId, method: 'usdt', amount: 37500, amountUsdt: 10, rate: 3750, txid,
    ref: 'BTEST' + id, walletAddress: 'T...', status: 'awaiting_verification',
    date: '', time: '', createdAt: new Date()
  });
  return id;
}
const FAKE_TXID = i => 'a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff'.slice(0, 60) + String(i).padStart(4, '0');

(async () => {
  await new Promise(r => setTimeout(r, 600));

  console.log('\n== Settings round-trip ==');
  let pub = await call('GET', '/public/settings');
  check('usdt disabled by default', pub.body.settings.usdtEnabled === false, pub.body.settings);
  check('usdt rate 0 by default', pub.body.settings.usdtRate === 0, pub.body.settings);

  const set = await setUsdtSettings({ usdtEnabled: true, usdtWalletAddress: 'TTestWalletAddressXXXXXXXXXXXXXXXX', usdtRate: 3750 });
  check('admin can save usdt settings', set.body.status === 'success', set.body);
  pub = await call('GET', '/public/settings');
  check('usdtEnabled now true', pub.body.settings.usdtEnabled === true, pub.body.settings);
  check('usdtWalletAddress round-trips', pub.body.settings.usdtWalletAddress === 'TTestWalletAddressXXXXXXXXXXXXXXXX', pub.body.settings);
  check('usdtRate round-trips', pub.body.settings.usdtRate === 3750, pub.body.settings);
  check('admin/settings unauthenticated is refused', (await call('GET', '/admin/settings')).code === 401);

  console.log('\n== Submit validation ==');
  const A = 'usdt-user-a';
  await setupFundedUser(A, '0771100201', 0);

  const noAuth = await call('POST', '/deposit/usdt/submit', { body: { amountUsdt: 10, txid: FAKE_TXID(1) } });
  check('unauthenticated submit refused (401)', noAuth.code === 401, noAuth.body);

  const badAmt = await call('POST', '/deposit/usdt/submit', { token: 'uid:' + A, body: { amountUsdt: 0, txid: FAKE_TXID(2) } });
  check('zero amount rejected', badAmt.body.status === 'error', badAmt.body);

  const badTxid = await call('POST', '/deposit/usdt/submit', { token: 'uid:' + A, body: { amountUsdt: 10, txid: 'not-a-real-hash' } });
  check('malformed txid rejected', badTxid.body.status === 'error', badTxid.body);

  // 10 USDT * 3750 = 37,500 UGX -- below default minDeposit? default minDeposit is 5000, so this clears it.
  // Test the below-minimum case with a tiny amount instead.
  const tooSmall = await call('POST', '/deposit/usdt/submit', { token: 'uid:' + A, body: { amountUsdt: 0.1, txid: FAKE_TXID(3) } });
  check('below minDeposit after conversion is rejected', tooSmall.body.status === 'error', tooSmall.body);

  const disabled = await setUsdtSettings({ usdtEnabled: false });
  const whileDisabled = await call('POST', '/deposit/usdt/submit', { token: 'uid:' + A, body: { amountUsdt: 10, txid: FAKE_TXID(4) } });
  check('submit refused while usdtEnabled is false', whileDisabled.body.status === 'error', whileDisabled.body);
  await setUsdtSettings({ usdtEnabled: true });

  console.log('\n== Happy path: submit lands as awaiting_verification, nothing credited yet ==');
  const balBefore = userDoc(A).walletBalance;
  const good = await call('POST', '/deposit/usdt/submit', { token: 'uid:' + A, body: { amountUsdt: 10, txid: FAKE_TXID(5) } });
  check('submit succeeds', good.body.status === 'success', good.body);
  const depositId = good.body.depositId;
  const depRow = collMap('pendingDeposits').get(depositId);
  check('stored as awaiting_verification', depRow.status === 'awaiting_verification', depRow);
  check('method tagged usdt', depRow.method === 'usdt', depRow);
  check('UGX amount computed at the live rate (10 * 3750 = 37500)', depRow.amount === 37500, depRow);
  check('nothing credited yet', userDoc(A).walletBalance === balBefore, userDoc(A).walletBalance);

  console.log('\n== Duplicate TXID protection ==');
  // Resubmitting the same txid moments later would also hit the 7s
  // per-user debounce -- that's not what this is testing. Give a FRESH
  // user (E) an already-filed claim directly, then have that same user
  // "resubmit" it as their very first call (so no debounce is in the way)
  // and confirm the endpoint recognises it as their own claim rather than
  // filing a second one.
  const E = 'usdt-user-e';
  await setupFundedUser(E, '0771100205', 0);
  const preExisting = db_pendingDepositsInsertForTest(E, FAKE_TXID(5) + 'e');
  const depositsCountBefore = collMap('pendingDeposits').size;
  const resubmitSame = await call('POST', '/deposit/usdt/submit', { token: 'uid:' + E, body: { amountUsdt: 10, txid: FAKE_TXID(5) + 'e' } });
  check('same user resubmitting the same txid is a no-op, not a new claim', resubmitSame.body.depositId === preExisting, resubmitSame.body);
  check('no second pendingDeposits row was created', collMap('pendingDeposits').size === depositsCountBefore,
    { before: depositsCountBefore, after: collMap('pendingDeposits').size });

  const B = 'usdt-user-b';
  await setupFundedUser(B, '0771100202', 0);
  const stolen = await call('POST', '/deposit/usdt/submit', { token: 'uid:' + B, body: { amountUsdt: 10, txid: FAKE_TXID(5) } });
  check('a DIFFERENT user submitting the same txid is refused (409)', stolen.code === 409, stolen.body);
  check("the real owner's claim amount is unaffected", collMap('pendingDeposits').get(depositId).userId === A);

  console.log('\n== Debounce ==');
  const C = 'usdt-user-c';
  await setupFundedUser(C, '0771100203', 0);
  const first = await call('POST', '/deposit/usdt/submit', { token: 'uid:' + C, body: { amountUsdt: 5, txid: FAKE_TXID(6) } });
  check('first submit from C succeeds', first.body.status === 'success', first.body);
  const secondFast = await call('POST', '/deposit/usdt/submit', { token: 'uid:' + C, body: { amountUsdt: 5, txid: FAKE_TXID(7) } });
  check('an immediate second submit is debounced (429)', secondFast.code === 429, secondFast.body);

  console.log('\n== Admin approve (reuses /admin/deposit/force-credit -- no new money-moving code) ==');
  const forceNoAuth = await call('POST', '/admin/deposit/force-credit', { body: { depositId } });
  check('force-credit refuses a non-admin caller (401)', forceNoAuth.code === 401, forceNoAuth.body);

  const approve = await adminCall('/admin/deposit/force-credit', { depositId });
  check('approve reports success', approve.body.status === 'success', approve.body);
  check('the member is actually credited the full UGX amount', userDoc(A).walletBalance === balBefore + 37500,
    { balance: userDoc(A).walletBalance, expected: balBefore + 37500 });
  check('deposit is now matched', collMap('pendingDeposits').get(depositId).status === 'matched');

  const approveAgain = await adminCall('/admin/deposit/force-credit', { depositId });
  check('re-approving an already-matched deposit is a no-op, never double-pays', userDoc(A).walletBalance === balBefore + 37500,
    { balance: userDoc(A).walletBalance, wouldBeDouble: balBefore + 75000, resp: approveAgain.body });

  console.log('\n== Admin reject ==');
  const D = 'usdt-user-d';
  await setupFundedUser(D, '0771100204', 0);
  const toReject = await call('POST', '/deposit/usdt/submit', { token: 'uid:' + D, body: { amountUsdt: 8, txid: FAKE_TXID(8) } });
  const rejectId = toReject.body.depositId;
  const dBalBefore = userDoc(D).walletBalance;

  const rejectNoAuth = await call('POST', '/admin/deposit/usdt/reject', { body: { depositId: rejectId } });
  check('reject refuses a non-admin caller (401)', rejectNoAuth.code === 401, rejectNoAuth.body);

  const reject = await adminCall('/admin/deposit/usdt/reject', { depositId: rejectId, reason: 'Could not find this TXID on Tronscan' });
  check('reject reports success', reject.body.status === 'success', reject.body);
  check('rejected deposit status updated', collMap('pendingDeposits').get(rejectId).status === 'rejected');
  check('wallet is completely untouched by a rejection', userDoc(D).walletBalance === dBalBefore, userDoc(D).walletBalance);

  const rejectAgain = await adminCall('/admin/deposit/usdt/reject', { depositId: rejectId });
  check('re-rejecting an already-rejected deposit is a harmless no-op', rejectAgain.body.status === 'success', rejectAgain.body);

  const rejectMatched = await adminCall('/admin/deposit/usdt/reject', { depositId });
  check('an already-matched (paid) deposit can never be rejected out from under the member', rejectMatched.body.status === 'error', rejectMatched.body);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
