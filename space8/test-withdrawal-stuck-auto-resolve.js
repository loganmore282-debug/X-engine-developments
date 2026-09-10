/* SPACE8 STUCK-WITHDRAWAL AUTO-RESOLUTION AUDIT
   Owner reported a real incident: a payout's own MTN Mobile Money SMS
   confirmed it arrived, but Space8's own record stayed stuck on
   "Processing" indefinitely. /withdraw/callback, the 30s background
   reconciler, and the on-demand "Sync MarzPay" button all depend on the
   same provider status-lookup before any of them will ever flip a
   withdrawal to 'processed' -- and that lookup was swallowing every
   failure with a bare catch(), trying exactly one field path for the
   status value, and never retrying a transient failure. So a single bad
   response from MarzPay could leave a genuinely-completed payout stuck
   forever with zero trace in the logs of why.

   Owner explicitly asked for this to be resolved by making the PROVIDER
   check itself reliable -- no manual admin override button. Fixed:
     1. marzGetSendTx/marzGetCollectTx now retry up to 3 times (800ms
        apart) on a network error or non-2xx response, instead of giving
        up on the first hiccup and waiting a full extra 30s cycle.
     2. They now parse several plausible field names/locations for the
        status value (status/state/transaction_status/payment_status, at
        a couple of nesting depths), not just one exact path -- MarzPay's
        send-money and collect-money resources are not guaranteed to
        shape their response identically.
     3. Every failure is now logged with the real HTTP status or network
        error, so a repeat of this incident leaves an actual trace instead
        of just vanishing.
     4. /admin/integrity flags a 'processing' withdrawal that HAS a
        gateway reference but has sat that way past 15 minutes (was
        previously invisible -- only a MISSING reference was ever
        flagged), so a stuck payout gets surfaced even before anyone
        notices and asks.

   Proves, against the real server:
     - a transient failure (first attempt errors, second succeeds) still
       resolves within ONE reconciler pass, automatically, no manual step
     - a real "successful" transaction with the status field in a
       different location than the original single-path lookup expected
       (tx.state instead of tx.status) still resolves automatically
     - /admin/integrity flags a processing withdrawal WITH a reference
       that's stuck past the window (was invisible before), and does NOT
       flag one that's simply young or one that lacks a reference (that
       keeps using the original, separate alert kind)
     - there is no manual "mark processed" endpoint anymore -- the only
       route to 'processed' on a still-processing withdrawal is the real,
       automatic, provider-verified reconciliation path

   SECOND real incident, same shape, different rail: a bank-transfer payout
   showed "Completed" on MarzPay's own dashboard while sitting stuck
   "processing" here indefinitely. marzGetBankTransferStatus() had never
   received the same treatment as send-money above -- one unretried attempt,
   no /transactions/{reference} fallback, no logging on failure. It's now
   routed through the exact same _marzFetchTxStatus retry+fallback+logging
   pipeline (see server.js), just parsed via _marzExtractBankTransfer
   instead of _marzExtractTx. The bank-transfer cases below mirror the
   send-money ones as directly as the two rails' shapes allow.

   Run: node test-withdrawal-stuck-auto-resolve.js   (exits 0 = all green) */

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

const realFetch = global.fetch;
// Per-uuid scripted behavior for GET .../send-money/{uuid}, so each test
// case can simulate a different real-world provider response shape.
const _sendStatusScript = new Map(); // uuid -> { calls: 0, script: fn(callNum) => {ok, status, body} }
// Separate script for the GET .../transactions/{uuid} fallback endpoint --
// shared by both send-money and bank-transfer, exactly like the real one.
const _transactionsScript = new Map(); // uuid -> { calls: 0, script: fn(callNum) => {ok, status, body} }
// Same idea, for GET .../bank-transfer/{reference}.
const _bankStatusScript = new Map(); // reference -> { calls: 0, script: fn(callNum) => {ok, status, body} }
global.fetch = async (url, opts) => {
  const u = String(url);
  const isGet = !opts || opts.method === undefined || opts.method === 'GET';
  const tm = u.match(/\/transactions\/([^/?]+)/);
  if (u.includes('wearemarz.com') && tm && isGet) {
    const uuid = tm[1];
    const entry = _transactionsScript.get(uuid);
    if (entry) {
      entry.calls++;
      const r = entry.script(entry.calls);
      return { ok: r.ok, status: r.ok ? 200 : (r.httpStatus || 500), json: async () => r.body };
    }
  }
  const m = u.match(/\/send-money\/([^/?]+)/);
  if (u.includes('wearemarz.com') && m && isGet) {
    const uuid = m[1];
    const entry = _sendStatusScript.get(uuid);
    if (entry) {
      entry.calls++;
      const r = entry.script(entry.calls);
      return { ok: r.ok, status: r.ok ? 200 : (r.httpStatus || 500), json: async () => r.body };
    }
  }
  const bm = u.match(/\/bank-transfer\/([^/?]+)/);
  if (u.includes('wearemarz.com') && bm && isGet) {
    const ref = bm[1];
    const entry = _bankStatusScript.get(ref);
    if (entry) {
      entry.calls++;
      const r = entry.script(entry.calls);
      return { ok: r.ok, status: r.ok ? 200 : (r.httpStatus || 500), json: async () => r.body };
    }
  }
  return realFetch(url, opts);
};

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
function seedProcessingWithdrawal(id, userId, { amount, net, marzTxUuid, ageMs }) {
  withdrawals().set(id, {
    userId, amount, net, phone: '0771234567', holder: 'Test Holder', network: 'MTN Mobile Money',
    status: 'processing', marzReference: 'REF-' + id, marzTxUuid: marzTxUuid || null,
    createdAt: new Date(Date.now() - ageMs), processedAt: new Date(Date.now() - ageMs), processedBy: 'owner-key',
  });
}
function seedBankProcessingWithdrawal(id, userId, { amount, net, marzBankReference, ageMs }) {
  withdrawals().set(id, {
    userId, amount, net, method: 'bank', bankName: 'DFCU Bank', accountName: 'Test Holder', accountNumber: '0146001886466',
    status: 'processing', marzBankReference: marzBankReference || null,
    createdAt: new Date(Date.now() - ageMs), processedAt: new Date(Date.now() - ageMs), processedBy: 'owner-key',
  });
}
async function syncNow() { return ownerCall('GET', '/admin/payments/sync'); }

(async () => {
  await new Promise(r => setTimeout(r, 600));
  const A = 'stuck-payout-user';
  await setupUser(A, '0771001001');
  await ownerCall('POST', '/admin/deposit', { userId: A, amount: 500000, note: 'seed funds' });

  console.log('\n== A transient failure (attempt 1 errors, attempt 2 succeeds) still resolves in ONE reconciler pass ==');
  seedProcessingWithdrawal('wit-transient', A, { amount: 10000, net: 8500, marzTxUuid: 'MTX-TRANSIENT', ageMs: 60000 });
  _sendStatusScript.set('MTX-TRANSIENT', { calls: 0, script: n => n === 1 ? { ok: false, httpStatus: 503, body: { error: 'temporary' } } : { ok: true, body: { data: { transaction: { status: 'successful', reference: 'REF-wit-transient' } } } } });
  await syncNow();
  check('resolved automatically despite the first attempt failing', withdrawals().get('wit-transient').status === 'processed', withdrawals().get('wit-transient'));

  console.log('\n== A real completed transaction with status in a DIFFERENT field (tx.state, not tx.status) still resolves ==');
  seedProcessingWithdrawal('wit-altfield', A, { amount: 6000, net: 5100, marzTxUuid: 'MTX-ALTFIELD', ageMs: 60000 });
  _sendStatusScript.set('MTX-ALTFIELD', { calls: 0, script: () => ({ ok: true, body: { data: { transaction: { state: 'completed', reference: 'REF-wit-altfield' } } } }) });
  await syncNow();
  check('resolved automatically reading the status from tx.state instead of tx.status', withdrawals().get('wit-altfield').status === 'processed', withdrawals().get('wit-altfield'));

  console.log('\n== Real production case: MarzPay\'s own /send-money/{uuid} throws a server-side bug on EVERY attempt (HTTP 422 "Undefined variable $currency") -- the /transactions/{uuid} fallback still resolves it ==');
  // Confirmed live in Render logs for a real stuck payout: not a transient
  // network blip (retries don't help, it's deterministic), a genuine bug in
  // MarzPay's own send-money status code. Their docs list GET
  // /transactions/{uuid} as the documented fallback "when webhooks are
  // delayed" -- a different resource/code path on their side.
  seedProcessingWithdrawal('wit-marzbug', A, { amount: 8000, net: 6800, marzTxUuid: 'MTX-MARZBUG', ageMs: 60000 });
  _sendStatusScript.set('MTX-MARZBUG', { calls: 0, script: () => ({ ok: false, httpStatus: 422, body: { status: 'error', message: 'Undefined variable $currency', error_code: 'REQUEST_ERROR' } }) });
  _transactionsScript.set('MTX-MARZBUG', { calls: 0, script: () => ({ ok: true, body: { data: { transaction: { status: 'completed', reference: 'REF-wit-marzbug' } } } }) });
  await syncNow();
  check('resolved automatically via the /transactions/{uuid} fallback despite the primary endpoint being permanently broken', withdrawals().get('wit-marzbug').status === 'processed', withdrawals().get('wit-marzbug'));

  console.log('\n== ...and if BOTH the primary endpoint AND the fallback are broken, it correctly stays unresolved (never guesses) ==');
  seedProcessingWithdrawal('wit-bothbroken', A, { amount: 9000, net: 7650, marzTxUuid: 'MTX-BOTHBROKEN', ageMs: 60000 });
  _sendStatusScript.set('MTX-BOTHBROKEN', { calls: 0, script: () => ({ ok: false, httpStatus: 422, body: { error: 'Undefined variable $currency' } }) });
  _transactionsScript.set('MTX-BOTHBROKEN', { calls: 0, script: () => ({ ok: false, httpStatus: 500, body: { error: 'also broken' } }) });
  await syncNow();
  check('stays "processing", not falsely resolved, when neither endpoint answers', withdrawals().get('wit-bothbroken').status === 'processing', withdrawals().get('wit-bothbroken'));

  console.log('\n== SECOND real incident, bank-transfer rail: a real payout shows "Completed" on MarzPay\'s own dashboard but was stuck "processing" here forever ==');
  console.log('-- A transient failure on /bank-transfer/{reference} still resolves in ONE reconciler pass --');
  seedBankProcessingWithdrawal('bwit-transient', A, { amount: 22000, net: 18700, marzBankReference: 'BTX-TRANSIENT', ageMs: 60000 });
  _bankStatusScript.set('BTX-TRANSIENT', { calls: 0, script: n => n === 1 ? { ok: false, httpStatus: 503, body: { error: 'temporary' } } : { ok: true, body: { data: { bank_transfer_request: { status: 'completed', reference: 'BTX-TRANSIENT' } } } } });
  await syncNow();
  check('resolved automatically despite the first attempt failing', withdrawals().get('bwit-transient').status === 'processed', withdrawals().get('bwit-transient'));

  console.log('-- The EXACT real incident: MarzPay\'s /bank-transfer/{reference} fails on every attempt, but it already shows "Completed" on MarzPay\'s own dashboard -- the /transactions/{reference} fallback resolves it --');
  seedBankProcessingWithdrawal('bwit-marzbug', A, { amount: 22000, net: 18700, marzBankReference: 'BTX-MARZBUG', ageMs: 60000 });
  _bankStatusScript.set('BTX-MARZBUG', { calls: 0, script: () => ({ ok: false, httpStatus: 500, body: { status: 'error', message: 'Internal error' } }) });
  _transactionsScript.set('BTX-MARZBUG', { calls: 0, script: () => ({ ok: true, body: { data: { bank_transfer_request: { status: 'completed', reference: 'BTX-MARZBUG' } } } }) });
  await syncNow();
  check('resolved automatically via the /transactions/{reference} fallback, exactly like the send-money incident', withdrawals().get('bwit-marzbug').status === 'processed', withdrawals().get('bwit-marzbug'));

  console.log('-- ...and if BOTH endpoints are broken, a bank-transfer withdrawal also correctly stays unresolved (never guesses) --');
  seedBankProcessingWithdrawal('bwit-bothbroken', A, { amount: 22000, net: 18700, marzBankReference: 'BTX-BOTHBROKEN', ageMs: 60000 });
  _bankStatusScript.set('BTX-BOTHBROKEN', { calls: 0, script: () => ({ ok: false, httpStatus: 500, body: { error: 'broken' } }) });
  _transactionsScript.set('BTX-BOTHBROKEN', { calls: 0, script: () => ({ ok: false, httpStatus: 500, body: { error: 'also broken' } }) });
  await syncNow();
  check('stays "processing", not falsely resolved, when neither endpoint answers', withdrawals().get('bwit-bothbroken').status === 'processing', withdrawals().get('bwit-bothbroken'));

  console.log('-- A genuinely failed bank transfer is still correctly declined and refunded --');
  const balBeforeBankFail = userDoc(A).walletBalance;
  seedBankProcessingWithdrawal('bwit-realfail', A, { amount: 15000, net: 12750, marzBankReference: 'BTX-REALFAIL', ageMs: 60000 });
  _bankStatusScript.set('BTX-REALFAIL', { calls: 0, script: () => ({ ok: true, body: { data: { bank_transfer_request: { status: 'failed', reference: 'BTX-REALFAIL' } } } }) });
  await syncNow();
  check('genuinely failed bank transfer is declined, not processed', withdrawals().get('bwit-realfail').status === 'declined', withdrawals().get('bwit-realfail'));
  check('wallet refunded for the real failure', userDoc(A).walletBalance === balBeforeBankFail + 15000, userDoc(A).walletBalance);

  console.log('\n== A genuinely failed payout is still correctly declined and refunded (not incorrectly marked processed) ==');
  const balBeforeFail = userDoc(A).walletBalance;
  seedProcessingWithdrawal('wit-realfail', A, { amount: 4000, net: 3400, marzTxUuid: 'MTX-REALFAIL', ageMs: 60000 });
  _sendStatusScript.set('MTX-REALFAIL', { calls: 0, script: () => ({ ok: true, body: { data: { transaction: { status: 'failed', reference: 'REF-wit-realfail' } } } }) });
  await syncNow();
  check('genuinely failed payout is declined, not processed', withdrawals().get('wit-realfail').status === 'declined', withdrawals().get('wit-realfail'));
  check('wallet refunded for the real failure', userDoc(A).walletBalance === balBeforeFail + 4000, userDoc(A).walletBalance);

  console.log('\n== /admin/integrity flags a processing withdrawal WITH a reference stuck past the window ==');
  seedProcessingWithdrawal('wit-stuck-with-ref', A, { amount: 10000, net: 8500, marzTxUuid: 'MTX-STUCK-1', ageMs: 20 * 60000 });
  _sendStatusScript.set('MTX-STUCK-1', { calls: 0, script: () => ({ ok: false, httpStatus: 500, body: {} }) }); // keeps genuinely failing every attempt
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

  console.log('\n== No manual override exists -- the endpoint is gone ==');
  r = await ownerCall('POST', '/admin/withdraw/force-processed', { withdrawalId: 'wit-stuck-with-ref' });
  check('there is no /admin/withdraw/force-processed route anymore (404)', r.code === 404, r.code);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
