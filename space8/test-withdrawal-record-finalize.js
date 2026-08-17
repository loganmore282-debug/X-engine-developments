/* SPACE8 WITHDRAWAL RECORDS-WRITING AUDIT
   Owner: "bro now check on deposits, withdrawals, callbacks speed, records
   writing, and status validation."

   Deposits, callback speed, and status validation were all found solid on
   inspection (deposit crediting is claim-before-credit + independently
   re-verified against MarzPay's own API, never trusting a webhook's bare
   claim; both /deposit/callback and /withdraw/callback ack 200 as their
   very first statement, before any processing, so MarzPay's own retry
   logic is never triggered by slow work; status values are validated
   against strict allowlisted Sets, never loose string matching).

   Records writing had a REAL bug, confirmed by reading the code: a
   withdrawal's matching `transactions` row (what the combined Records
   view actually renders) is written once at request time (status
   'pending', description ending "...net X after Y% fee, processing") and
   updated once more to 'processing' when an admin approves and sends it --
   but nothing EVER updated it again once the withdrawal reached its REAL
   final outcome. That resolution can happen in three completely different
   places -- the MarzPay webhook (/withdraw/callback), the member's own
   client-side poll (/withdraw/marzpay/status), or the background
   reconciler (reconcilePendingWithdrawals, also reachable via GET
   /admin/payments/sync's "Sync MarzPay" button) -- and NONE of the three
   ever touched the transactions collection. The `withdrawals` collection
   itself (and the dedicated Deposit/Withdrawal History screen, which reads
   it directly) always showed the correct live status; a member's combined
   Records entry for the SAME withdrawal would keep reading "...processing"
   verbatim forever, even for a payout that completed or failed days ago,
   because that literal word was baked into the description string at
   request time and nothing ever revisited it.

   Fixed with one shared, idempotent helper (finalizeWithdrawalTransactionRecord,
   server.js) called from all three places. This test proves each of the
   three actually calls it, for both outcomes (processed AND declined).

   Run: node test-withdrawal-record-finalize.js   (exits 0 = all green)   */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '4212';

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
// uuid -> status string GET /send-money/{uuid} should report live.
let sendTxForUuid = {};
global.fetch = async (url, opts) => {
  const u = String(url);
  const json = body => ({ ok: true, status: 200, json: async () => body });
  const sendMatch = u.match(/\/send-money\/([^/?]+)/);
  if (sendMatch) {
    const status = sendTxForUuid[sendMatch[1]];
    if (status === undefined) return { ok: false, status: 500, json: async () => ({ error: 'no mock for this uuid' }) };
    return json({ status: 'success', data: { transaction: { status, reference: 'ref-' + sendMatch[1] } } });
  }
  return realFetch(url, opts);
};

require('./server.js');

const BASE = 'http://127.0.0.1:4212';
async function call(method, p, { adminKey, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (adminKey) headers.Authorization = 'Bearer ' + adminKey;
  const r = await realFetch(BASE + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (_) {}
  return { code: r.status, body: j };
}
async function ownerCall(method, path, body) { return call(method, path, { adminKey: 'test-admin-key', body }); }
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   - ' + name); }
  else { fail++; console.log('  FAIL - ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}
function collMap(name) {
  if (!mockdb.__store.has(name)) mockdb.__store.set(name, new Map());
  return mockdb.__store.get(name);
}

// Fabricates a withdrawal already at 'processing' plus the matching
// transactions row exactly as /withdraw/request + processWithdrawalCore
// would have left it -- lets this file test ONLY the finalize step, not
// re-derive the whole request/approve flow (already covered elsewhere).
function seedProcessingWithdrawal(id, userId, uuid) {
  collMap('users').set(userId, { walletBalance: 100000, totalWithdrawn: 0, status: 'active' });
  collMap('withdrawals').set(id, {
    userId, amount: 50000, fee: 7500, net: 42500, method: 'mobile_money',
    holder: 'Test Holder', network: 'MTN Mobile Money', phone: '+256771234567',
    ref: 'B' + id, status: 'processing', marzReference: 'mref-' + id, marzTxUuid: uuid,
    date: '08/17/2026', time: '10:00 AM', createdAt: new Date()
  });
  const txId = 'tx-' + id;
  collMap('transactions').set(txId, {
    userId, type: 'withdraw', withdrawalId: id,
    description: 'Cash out to Test Holder (MTN Mobile Money), net UGX 42,500 after 15% fee, processing',
    amount: -50000, status: 'processing', date: '08/17/2026', time: '10:00 AM', ref: 'B' + id, createdAt: new Date()
  });
  return txId;
}
const txDoc = txId => collMap('transactions').get(txId);

(async () => {
  await new Promise(r => setTimeout(r, 600));

  console.log('\n== Path 1: MarzPay webhook (/withdraw/callback) success -- transaction record must be finalized ==');
  const tx1 = seedProcessingWithdrawal('wf-webhook-ok', 'wf-user-1', 'WTX-webhook-ok');
  sendTxForUuid['WTX-webhook-ok'] = 'success';
  await call('POST', '/withdraw/callback', { body: {
    event_type: 'disbursement.completed',
    data: { reference: 'mref-wf-webhook-ok', transaction: { status: 'success', uuid: 'WTX-webhook-ok' } }
  } });
  await new Promise(r => setTimeout(r, 150));
  check('withdrawal itself moved to processed', collMap('withdrawals').get('wf-webhook-ok')?.status === 'processed', collMap('withdrawals').get('wf-webhook-ok'));
  check('transaction record status updated to success', txDoc(tx1)?.status === 'success', txDoc(tx1));
  check('transaction description no longer says "processing"', !/processing$/.test(txDoc(tx1)?.description || ''), txDoc(tx1)?.description);

  console.log('\n== Path 1b: webhook FAILURE -- transaction record must reflect the decline/refund ==');
  const tx1b = seedProcessingWithdrawal('wf-webhook-fail', 'wf-user-1b', 'WTX-webhook-fail');
  sendTxForUuid['WTX-webhook-fail'] = 'failed';
  await call('POST', '/withdraw/callback', { body: {
    event_type: 'disbursement.failed',
    data: { reference: 'mref-wf-webhook-fail', transaction: { status: 'failed', uuid: 'WTX-webhook-fail' } }
  } });
  await new Promise(r => setTimeout(r, 150));
  check('withdrawal itself moved to declined', collMap('withdrawals').get('wf-webhook-fail')?.status === 'declined', collMap('withdrawals').get('wf-webhook-fail'));
  check('wallet was refunded', collMap('users').get('wf-user-1b')?.walletBalance === 150000, collMap('users').get('wf-user-1b'));
  check('transaction record status updated to failed', txDoc(tx1b)?.status === 'failed', txDoc(tx1b));
  check('transaction description reflects the failure, not still "processing"', /refunded/.test(txDoc(tx1b)?.description || '') && !/, processing$/.test(txDoc(tx1b)?.description || ''), txDoc(tx1b)?.description);

  console.log('\n== Path 2: member\'s own poll (/withdraw/marzpay/status) success -- transaction record must be finalized ==');
  const tx2 = seedProcessingWithdrawal('wf-poll-ok', 'wf-user-2', 'WTX-poll-ok');
  sendTxForUuid['WTX-poll-ok'] = 'success';
  let r;
  {
    const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer uid:wf-user-2' };
    const resp = await realFetch(BASE + '/withdraw/marzpay/status', { method: 'POST', headers, body: JSON.stringify({ withdrawalId: 'wf-poll-ok' }) });
    r = { code: resp.status, body: await resp.json() };
  }
  check('poll reports processed', r.body?.state === 'processed', r.body);
  check('transaction record status updated to success', txDoc(tx2)?.status === 'success', txDoc(tx2));
  check('transaction description no longer says "processing"', !/processing$/.test(txDoc(tx2)?.description || ''), txDoc(tx2)?.description);

  console.log('\n== Path 2b: member\'s own poll, FAILURE -- transaction record must reflect the decline/refund ==');
  const tx2b = seedProcessingWithdrawal('wf-poll-fail', 'wf-user-2b', 'WTX-poll-fail');
  sendTxForUuid['WTX-poll-fail'] = 'failed';
  {
    const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer uid:wf-user-2b' };
    const resp = await realFetch(BASE + '/withdraw/marzpay/status', { method: 'POST', headers, body: JSON.stringify({ withdrawalId: 'wf-poll-fail' }) });
    r = { code: resp.status, body: await resp.json() };
  }
  check('poll reports declined', r.body?.state === 'declined', r.body);
  check('transaction record status updated to failed', txDoc(tx2b)?.status === 'failed', txDoc(tx2b));
  check('transaction description reflects the failure', /refunded/.test(txDoc(tx2b)?.description || ''), txDoc(tx2b)?.description);

  console.log('\n== Path 3: background reconciler (GET /admin/payments/sync) -- transaction record must be finalized for both outcomes ==');
  const tx3 = seedProcessingWithdrawal('wf-reconcile-ok', 'wf-user-3', 'WTX-reconcile-ok');
  const tx3b = seedProcessingWithdrawal('wf-reconcile-fail', 'wf-user-3b', 'WTX-reconcile-fail');
  sendTxForUuid['WTX-reconcile-ok'] = 'success';
  sendTxForUuid['WTX-reconcile-fail'] = 'failed';
  const syncR = await ownerCall('GET', '/admin/payments/sync');
  check('sync call succeeds', syncR.body?.status === 'success', syncR.body);
  check('reconciler settled BOTH withdrawals', collMap('withdrawals').get('wf-reconcile-ok')?.status === 'processed' && collMap('withdrawals').get('wf-reconcile-fail')?.status === 'declined',
    { ok: collMap('withdrawals').get('wf-reconcile-ok')?.status, fail: collMap('withdrawals').get('wf-reconcile-fail')?.status });
  check('reconciler finalized the SUCCESS transaction record', txDoc(tx3)?.status === 'success' && !/processing$/.test(txDoc(tx3)?.description || ''), txDoc(tx3));
  check('reconciler finalized the FAILURE transaction record', txDoc(tx3b)?.status === 'failed' && /refunded/.test(txDoc(tx3b)?.description || ''), txDoc(tx3b));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
