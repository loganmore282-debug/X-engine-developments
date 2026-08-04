/* CHOCOMCC STUCK-WITHDRAWAL DIAGNOSIS + SAFE MANUAL RESOLUTION
   Owner reported a real incident: a payout's own MTN Mobile Money SMS
   confirmed it arrived, but ChocoMCC's own record stayed stuck on
   "Processing" indefinitely -- /withdraw/callback, the 30s reconciler, and
   the on-demand "Sync MarzPay" button all rely on the same MarzPay
   status-lookup, so if THAT keeps failing (network hiccup, an unrecognised
   status string, anything), every one of them silently keeps treating a
   genuinely-completed payout as still in flight, forever, with nothing in
   the server logs explaining why (the lookup's error was swallowed with a
   bare catch()).

   Two real gaps closed:
     1. /admin/integrity now flags a 'processing' withdrawal that DOES have
        a gateway reference (marzTxUuid) but has sat that way for more than
        15 minutes -- previously only a MISSING reference was ever flagged,
        so exactly this scenario (reference present, lookup silently
        failing) was invisible to the audit.
     2. New /admin/withdraw/force-processed: before this, the ONLY action
        available on a still-processing withdrawal besides waiting was
        Reject -- which REFUNDS the wallet. Using Reject on a payout that
        genuinely already arrived would have paid the member twice. This
        endpoint corrects the status label only, after an admin has
        independently confirmed the payout really happened, and proves
        here that it never touches walletBalance or totalWithdrawn again.

   Proves, against the real server:
     - a processing withdrawal WITH a gateway reference, stuck past the
       window, IS now flagged by /admin/integrity (was invisible before)
     - one WITHOUT a reference still uses the original, separate alert kind
     - one that's simply young (just started processing) is not flagged
     - force-processed flips status to 'processed' and does NOT move the
       wallet or totalWithdrawn a second time
     - force-processed is owner-only (a staff admin session is rejected)
     - force-processed refuses a 'pending' withdrawal (nothing was ever
       sent, so there's nothing to confirm) and no-ops cleanly on an
       already-'processed' one

   Run: node test-withdrawal-stuck-force-processed.js   (exits 0 = all green) */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '4107';

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

const BASE = 'http://127.0.0.1:4107';
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

async function setupUser(uid, phone) {
  await call('POST', '/account/create-profile', { token: 'uid:' + uid, body: { phone } });
  await call('POST', '/register', { token: 'uid:' + uid, body: {} });
}
// Seeds a withdrawal directly in the store, already in the state a real
// /admin/withdraw/process call leaves it in (money already reserved,
// totalWithdrawn already incremented) -- avoids depending on the live
// MarzPay send-money mock just to get a 'processing' record to test with.
function seedProcessingWithdrawal(id, userId, { amount, net, marzTxUuid, ageMs }) {
  withdrawals().set(id, {
    userId, amount, net, phone: '0771234567', holder: 'Test Holder', network: 'MTN Mobile Money',
    status: 'processing', marzReference: 'REF-' + id, marzTxUuid: marzTxUuid || null,
    createdAt: new Date(Date.now() - ageMs), processedAt: new Date(Date.now() - ageMs), processedBy: 'owner-key',
  });
}

(async () => {
  await new Promise(r => setTimeout(r, 600));
  const A = 'stuck-payout-user';
  await setupUser(A, '0771001001');
  await ownerCall('POST', '/admin/deposit', { userId: A, amount: 500000, note: 'seed funds' });
  await userDoc(A); // ensure exists

  console.log('\n== /admin/integrity now catches a processing withdrawal WITH a reference, stuck past the window ==');
  seedProcessingWithdrawal('wit-stuck-with-ref', A, { amount: 10000, net: 8500, marzTxUuid: 'MTX-STUCK-1', ageMs: 20 * 60000 });
  let r = await ownerCall('GET', '/admin/integrity');
  let alert = (r.body.alerts || []).find(a => a.withdrawalId === 'wit-stuck-with-ref');
  check('flagged as withdrawal_processing_stuck (previously invisible to the audit)', alert && alert.kind === 'withdrawal_processing_stuck', alert);

  console.log('\n== A processing withdrawal with NO reference still uses the original, separate alert kind ==');
  seedProcessingWithdrawal('wit-no-ref', A, { amount: 5000, net: 4250, marzTxUuid: null, ageMs: 20 * 60000 });
  r = await ownerCall('GET', '/admin/integrity');
  alert = (r.body.alerts || []).find(a => a.withdrawalId === 'wit-no-ref');
  check('flagged as the pre-existing withdrawal_no_gateway_ref kind, not the new one', alert && alert.kind === 'withdrawal_no_gateway_ref', alert);

  console.log('\n== A processing withdrawal that just started is NOT flagged yet ==');
  seedProcessingWithdrawal('wit-fresh', A, { amount: 7000, net: 5950, marzTxUuid: 'MTX-FRESH', ageMs: 5000 });
  r = await ownerCall('GET', '/admin/integrity');
  alert = (r.body.alerts || []).find(a => a.withdrawalId === 'wit-fresh');
  check('a genuinely fresh processing withdrawal is not flagged (still within its normal window)', !alert, alert);

  console.log('\n== force-processed: flips status, does NOT touch the wallet or totalWithdrawn again ==');
  const balBefore = userDoc(A).walletBalance;
  const totalWithdrawnBefore = userDoc(A).totalWithdrawn || 0;
  r = await ownerCall('POST', '/admin/withdraw/force-processed', { withdrawalId: 'wit-stuck-with-ref', note: 'confirmed via MoMo SMS' });
  check('force-processed succeeds', r.body?.status === 'success', r.body);
  check('withdrawal status is now processed', withdrawals().get('wit-stuck-with-ref').status === 'processed', withdrawals().get('wit-stuck-with-ref'));
  check('forceConfirmedBy recorded', !!withdrawals().get('wit-stuck-with-ref').forceConfirmedBy, withdrawals().get('wit-stuck-with-ref'));
  check('wallet balance untouched (was already reserved at request time, not this endpoint\'s job)', userDoc(A).walletBalance === balBefore, userDoc(A).walletBalance);
  check('totalWithdrawn untouched (was already incremented once at send time)', (userDoc(A).totalWithdrawn || 0) === totalWithdrawnBefore, userDoc(A).totalWithdrawn);

  console.log('\n== force-processed is owner-only ==');
  await ownerCall('POST', '/admin/admins/create', { username: 'stuckstaff', password: 'whatever-123' });
  const loginR = await call('POST', '/admin/login', { body: { username: 'stuckstaff', password: 'whatever-123' } });
  const staffToken = loginR.body?.token;
  r = await call('POST', '/admin/withdraw/force-processed', { token: staffToken, body: { withdrawalId: 'wit-no-ref' } });
  check('staff (non-owner) admin session rejected (401)', r.code === 401, r.body);
  check('the no-ref withdrawal is untouched, still processing', withdrawals().get('wit-no-ref').status === 'processing', withdrawals().get('wit-no-ref'));

  console.log('\n== force-processed refuses a withdrawal that was never actually sent ==');
  const pendingId = 'wit-still-pending';
  withdrawals().set(pendingId, { userId: A, amount: 3000, net: 2550, phone: '0771234567', holder: 'Test', network: 'MTN Mobile Money', status: 'pending', createdAt: new Date() });
  r = await ownerCall('POST', '/admin/withdraw/force-processed', { withdrawalId: pendingId });
  check('rejected -- nothing was ever sent for a still-pending withdrawal', r.code === 400, r.body);

  console.log('\n== force-processed no-ops cleanly on an already-processed withdrawal ==');
  r = await ownerCall('POST', '/admin/withdraw/force-processed', { withdrawalId: 'wit-stuck-with-ref' });
  check('calling it again on an already-processed withdrawal succeeds as a harmless no-op', r.body?.status === 'success', r.body);
  check('wallet still untouched after the repeat call', userDoc(A).walletBalance === balBefore, userDoc(A).walletBalance);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
