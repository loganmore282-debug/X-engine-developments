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

   ROUND 2 (a follow-up ChatGPT pass on this same fix found real gaps --
   all fixed, all covered here):

   1. A FOURTH real resolution path was missed entirely: an owner manually
      force-declining a withdrawal via /admin/withdraw/reject correctly
      refunded the wallet but never finalized the Records row either.
      Fixed by adding the same finalize call there.
   2. processWithdrawalCore's SANDBOX-immediate-success branch set the
      transaction's status straight to 'success' but never touched its
      description, leaving "...processing" in the text despite the status
      field disagreeing. Fixed by routing sandbox success through the same
      finalize helper as every other path.
   3. The real one: every FAILURE/refund branch in server.js already goes
      through withLock('bal:'+userId, ...) + a status-checked transaction
      (db.runTransaction here is NOT a real MongoDB transaction -- no
      session, no optimistic concurrency, see db.js -- withLock is the
      ONLY actual serialization this codebase has), but the SUCCESS
      branches (webhook/poll/reconciler) each did a bare, unconditional
      `update({status:'processed'})` with NO lock and no re-check at all.
      That's a real race: a failure branch could correctly decline-and-
      refund a withdrawal, and a success branch resolving via a different,
      unsynchronized path moments later could silently overwrite that back
      to 'processed' with no re-verification. Fixed with a new shared
      markWithdrawalProcessed() helper using the SAME 'bal:'+userId lock
      key as the failure paths, so success and failure are now mutually
      exclusive -- and the Records row is only ever finalized when the
      transition is CONFIRMED to have actually happened, closing a related
      gap where a swallowed write failure used to still finalize the
      Records row as successful regardless.
   4. finalizeWithdrawalTransactionRecord's `.limit(1)` only ever repaired
      ONE matching transaction row. Widened to repair every matching row
      (bounded, not unbounded) in case old data ever left more than one.

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
  // POST .../send-money (processWithdrawalCore's initial gateway call) --
  // this file only needs the sandbox branch, never the normal async-send
  // path (every other case here seeds withdrawals directly as already
  // 'processing'), so always report sandbox.
  if (u.includes('wearemarz.com') && u.endsWith('/send-money') && opts?.method === 'POST') {
    return json({ status: 'sandbox' });
  }
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

  console.log('\n== Path 4 (round 2, was missing entirely): owner force-decline (/admin/withdraw/reject) must also finalize the Records row ==');
  const tx4 = seedProcessingWithdrawal('wf-admin-reject', 'wf-user-4', 'WTX-admin-reject');
  const rejR = await ownerCall('POST', '/admin/withdraw/reject', { withdrawalId: 'wf-admin-reject', reason: 'test reason' });
  check('reject call succeeds', rejR.body?.status === 'success', rejR.body);
  check('withdrawal moved to declined', collMap('withdrawals').get('wf-admin-reject')?.status === 'declined', collMap('withdrawals').get('wf-admin-reject'));
  check('wallet was refunded', collMap('users').get('wf-user-4')?.walletBalance === 150000, collMap('users').get('wf-user-4'));
  check('transaction record status updated to failed', txDoc(tx4)?.status === 'failed', txDoc(tx4));
  check('transaction description reflects the failure, not still "processing"', /refunded/.test(txDoc(tx4)?.description || ''), txDoc(tx4)?.description);

  console.log('\n== Path 5 (round 2, was inconsistent): sandbox immediate-success approval must ALSO strip "processing" from the description ==');
  // Sandbox mode is reached through processWithdrawalCore's own success
  // branch when MarzPay's response itself says {status:'sandbox'} -- this
  // file's fetch mock always answers POST .../send-money that way (see
  // above), so /admin/withdraw/process on a real 'pending' withdrawal
  // drives the actual sandbox branch, not a hand-simulated shortcut.
  collMap('users').set('wf-user-5', { walletBalance: 100000, totalWithdrawn: 0, status: 'active' });
  collMap('withdrawals').set('wf-sandbox', {
    userId: 'wf-user-5', amount: 50000, fee: 7500, net: 42500, method: 'mobile_money',
    holder: 'Test Holder', network: 'MTN Mobile Money', phone: '+256771234567',
    ref: 'Bwf-sandbox', status: 'pending', marzReference: null, marzTxUuid: null,
    date: '08/17/2026', time: '10:00 AM', createdAt: new Date()
  });
  const tx5Id = 'tx-wf-sandbox';
  collMap('transactions').set(tx5Id, {
    userId: 'wf-user-5', type: 'withdraw', withdrawalId: 'wf-sandbox',
    description: 'Cash out to Test Holder (MTN Mobile Money), net UGX 42,500 after 15% fee, processing',
    amount: -50000, status: 'pending', date: '08/17/2026', time: '10:00 AM', ref: 'Bwf-sandbox', createdAt: new Date()
  });
  const sandboxR = await ownerCall('POST', '/admin/withdraw/process', { withdrawalId: 'wf-sandbox' });
  check('sandbox approval reports success', sandboxR.body?.status === 'success' && sandboxR.body?.sandbox === true, sandboxR.body);
  check('withdrawal moved straight to processed (sandbox skips the normal "processing" wait)', collMap('withdrawals').get('wf-sandbox')?.status === 'processed', collMap('withdrawals').get('wf-sandbox'));
  check('transaction status updated to success', collMap('transactions').get(tx5Id)?.status === 'success', collMap('transactions').get(tx5Id));
  check('transaction description ALSO stripped of "processing" (this was the actual bug -- status alone used to update, description never did)',
    !/, processing$/.test(collMap('transactions').get(tx5Id)?.description || ''), collMap('transactions').get(tx5Id)?.description);

  console.log('\n== Path 6 (round 2, the real bug): genuine concurrent race between a success resolution and an admin force-decline must not corrupt state ==');
  // Fires /withdraw/marzpay/status (mocked to see MarzPay as 'success') and
  // /admin/withdraw/reject for the SAME withdrawal via Promise.all -- real
  // concurrency, not a sequential loop -- to prove the shared
  // 'bal:'+userId lock actually makes these two paths mutually exclusive
  // now. Before this fix, the success path had no lock at all and could
  // silently overwrite a decline that had already refunded the wallet.
  const tx6 = seedProcessingWithdrawal('wf-race', 'wf-user-6', 'WTX-race');
  sendTxForUuid['WTX-race'] = 'success';
  const [pollResult, rejectResult] = await Promise.all([
    (async () => {
      const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer uid:wf-user-6' };
      const resp = await realFetch(BASE + '/withdraw/marzpay/status', { method: 'POST', headers, body: JSON.stringify({ withdrawalId: 'wf-race' }) });
      return { code: resp.status, body: await resp.json() };
    })(),
    ownerCall('POST', '/admin/withdraw/reject', { withdrawalId: 'wf-race', reason: 'race test' })
  ]);
  const finalStatus = collMap('withdrawals').get('wf-race')?.status;
  const finalBalance = collMap('users').get('wf-user-6')?.walletBalance;
  check('withdrawal ended in EXACTLY ONE terminal state (processed or declined, not corrupted)', finalStatus === 'processed' || finalStatus === 'declined', finalStatus);
  check('wallet balance is consistent with whichever outcome actually won (100000 if processed -- no refund; 150000 if declined -- refunded)',
    (finalStatus === 'processed' && finalBalance === 100000) || (finalStatus === 'declined' && finalBalance === 150000),
    { finalStatus, finalBalance });
  check('the Records row status agrees with the real withdrawal outcome, not stuck or contradicting it',
    txDoc(tx6)?.status === (finalStatus === 'processed' ? 'success' : 'failed'), { txStatus: txDoc(tx6)?.status, finalStatus });
  check('the Records description was actually finalized either way (no longer says "processing")', !/, processing$/.test(txDoc(tx6)?.description || ''), txDoc(tx6)?.description);

  console.log('\n== Path 7 (round 2): finalizeWithdrawalTransactionRecord repairs EVERY matching row, not just the first ==');
  collMap('users').set('wf-user-7', { walletBalance: 100000, totalWithdrawn: 0, status: 'active' });
  collMap('withdrawals').set('wf-multi-tx', {
    userId: 'wf-user-7', amount: 50000, fee: 7500, net: 42500, method: 'mobile_money',
    holder: 'Test Holder', network: 'MTN Mobile Money', phone: '+256771234567',
    ref: 'Bwf-multi-tx', status: 'processing', marzReference: 'mref-wf-multi-tx', marzTxUuid: 'WTX-multi-tx',
    date: '08/17/2026', time: '10:00 AM', createdAt: new Date()
  });
  // Simulates a pre-existing data-integrity issue (should never happen
  // under current code -- there's exactly one creation path -- but the fix
  // is defensive against it anyway): two transaction rows sharing one
  // withdrawalId, as a prior bug or manual repair might have left behind.
  collMap('transactions').set('tx-multi-a', { userId: 'wf-user-7', type: 'withdraw', withdrawalId: 'wf-multi-tx', description: 'Cash out, processing', status: 'processing', amount: -50000, createdAt: new Date() });
  collMap('transactions').set('tx-multi-b', { userId: 'wf-user-7', type: 'withdraw', withdrawalId: 'wf-multi-tx', description: 'Cash out (duplicate), processing', status: 'processing', amount: -50000, createdAt: new Date() });
  sendTxForUuid['WTX-multi-tx'] = 'success';
  {
    const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer uid:wf-user-7' };
    const resp = await realFetch(BASE + '/withdraw/marzpay/status', { method: 'POST', headers, body: JSON.stringify({ withdrawalId: 'wf-multi-tx' }) });
    await resp.json();
  }
  check('BOTH duplicate transaction rows were repaired, not just one', collMap('transactions').get('tx-multi-a')?.status === 'success' && collMap('transactions').get('tx-multi-b')?.status === 'success',
    { a: collMap('transactions').get('tx-multi-a'), b: collMap('transactions').get('tx-multi-b') });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
