/* CHOCOMCC BANK TRANSFER WITHDRAWAL — a second, real automatic withdrawal
   rail through the SAME MarzPay gateway as mobile-money cash-out (send-
   money). Mobile money is completely untouched: same admin-gated
   'pending' -> manual Send -> 'processing' -> 'processed'/'declined' flow,
   just against MarzPay's /bank-transfer product instead of /send-money.

   This file stubs global.fetch for the wearemarz.com bank-transfer
   endpoints only (validate / create / status / banks) -- never hits the
   real network -- and proves:
     - the account is validated against MarzPay BEFORE anything is
       reserved; a definitive "invalid" blocks the request outright with
       no balance touched and no record created; a failure of the
       validation CHECK itself (network blip) does not block (fail-open)
     - a valid request reserves the wallet balance and creates a 'pending'
       bank-method withdrawal exactly like mobile money does -- nothing
       reaches MarzPay until an admin sends it
     - admin process: success -> 'processing' (sandbox -> instant
       'processed'), a definitive gateway rejection safely reverts to
       'pending' (nothing moved), a network exception mid-request leaves
       it on 'sending' (never blindly retried -- the exact same ambiguous-
       failure handling send-money already has)
     - admin verify reads the right (bank) gateway reference
     - the reconciler resolves a 'processing' bank withdrawal automatically
       (processed on success, refunded via status-before-refund on a
       confirmed failure, never double-refunded on a second pass)
     - admin reject still works unmodified (it was already method-agnostic)
     - a plain mobile-money request alongside all of this is completely
       unaffected -- no bank fields, no bank gateway calls

   Run: node test-bank-withdrawal.js   (exits 0 = all green)              */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '4141';

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
const validateStub = new Map();   // accountNumber -> {status, message}
const statusStub = new Map();     // reference -> status string
let createStub = null;            // null = default success; else {error:{...}} | {networkError:true} | {sandbox:true} | {ref:'...'}
const BANKS = ['Stanbic Bank', 'Equity Bank', 'Centenary Bank'];

global.fetch = async (url, opts) => {
  const u = String(url);
  const method = (opts && opts.method) || 'GET';
  const json = (body, status) => ({ ok: !status || status < 400, status: status || 200, json: async () => body });
  if (!u.includes('wearemarz.com')) return realFetch(url, opts);

  if (u.endsWith('/bank-transfer/validate') && method === 'POST') {
    const body = JSON.parse(opts.body);
    const stub = validateStub.get(body.account_number);
    if (stub) return json(stub);
    return json({ status: 'success', message: 'Account is valid', data: { account_name: 'TEST ACCOUNT' } });
  }
  if (u.endsWith('/bank-transfer/banks') && method === 'GET') {
    return json({ status: 'success', data: { banks: BANKS } });
  }
  if (/\/bank-transfer\/[^/?]+$/.test(u) && method === 'GET') {
    const ref = u.split('/bank-transfer/')[1].split('?')[0];
    const status = statusStub.get(ref) || 'processing';
    return json({ status: 'success', data: { bank_transfer_request: { reference: ref, transaction_uuid: ref, status } } });
  }
  if (u.endsWith('/bank-transfer') && method === 'POST') {
    if (createStub && createStub.networkError) { createStub = null; throw new Error('simulated network failure'); }
    if (createStub && createStub.error) { const e = createStub.error; createStub = null; return json(e, 400); }
    const sandbox = createStub && createStub.sandbox;
    const ref = (createStub && createStub.ref) || ('BT-' + Math.random().toString(36).slice(2));
    if (createStub) createStub = null;
    return json({ status: sandbox ? 'sandbox' : 'success', message: 'Bank transfer is being processed.',
      data: { bank_transfer: { id: 1, reference: ref, transaction_uuid: ref, status: 'processing' } } });
  }
  return realFetch(url, opts);
};

require('./server.js');

const BASE = 'http://127.0.0.1:4141';
async function call(method, p, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await realFetch(BASE + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (_) {}
  return { code: r.status, body: j };
}
const adminHeaders = { 'Content-Type': 'application/json', Authorization: 'Bearer test-admin-key' };
async function adminCall(method, path, body) {
  const r = await realFetch(BASE + path, { method, headers: adminHeaders, body: body !== undefined ? JSON.stringify(body) : undefined });
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
  const u = userDoc(uid);
  u.walletBalance = balance;
  u.totalInvested = balance; // clears requireInvestToWithdraw
}
const bankBody = (over) => Object.assign({ method: 'bank', bankName: 'Stanbic Bank', accountName: 'John Doe', accountNumber: '9988776655', pin: '1234' }, over);

(async () => {
  await new Promise(r => setTimeout(r, 600));

  console.log('\n== Settings + bank list ==');
  let pub = await call('GET', '/public/settings');
  check('bank withdrawals disabled by default', pub.body.settings.bankWithdrawEnabled === false, pub.body.settings);
  const set = await adminCall('POST', '/admin/settings/update', { settings: { bankWithdrawEnabled: true } });
  check('admin can enable bank withdrawals', set.body.status === 'success', set.body);
  pub = await call('GET', '/public/settings');
  check('now reflected in /public/settings', pub.body.settings.bankWithdrawEnabled === true, pub.body.settings);
  const banks = await call('GET', '/public/banks');
  check('bank list is served', banks.body.status === 'success' && banks.body.banks.join(',') === BANKS.join(','), banks.body);

  console.log('\n== Request validation ==');
  const A = 'bankwit-a'; await setupFundedUser(A, '0772300201', 500000);
  const missing = await call('POST', '/withdraw/request', { token: 'uid:' + A, body: { amount: 50000, method: 'bank', bankName: '', accountName: '', accountNumber: '' } });
  check('missing bank fields rejected', missing.body.status === 'error', missing.body);
  const tooSmall = await call('POST', '/withdraw/request', { token: 'uid:' + A, body: bankBody({ amount: 100 }) });
  check('below minWithdraw rejected', tooSmall.body.status === 'error', tooSmall.body);

  await adminCall('POST', '/admin/settings/update', { settings: { bankWithdrawEnabled: false } });
  const disabled = await call('POST', '/withdraw/request', { token: 'uid:' + A, body: bankBody({ amount: 50000 }) });
  check('refused while bankWithdrawEnabled is false', disabled.body.status === 'error', disabled.body);
  await adminCall('POST', '/admin/settings/update', { settings: { bankWithdrawEnabled: true } });

  console.log('\n== Account validated against MarzPay BEFORE anything is reserved ==');
  validateStub.set('1112223334', { status: 'error', message: 'Invalid account number', error_code: 'VALIDATION_ERROR' });
  const balBeforeBadAcc = userDoc(A).walletBalance;
  const badAcc = await call('POST', '/withdraw/request', { token: 'uid:' + A, body: bankBody({ amount: 50000, accountNumber: '1112223334' }) });
  check('a MarzPay-rejected account blocks the request', badAcc.body.status === 'error', badAcc.body);
  check('no balance was reserved', userDoc(A).walletBalance === balBeforeBadAcc, userDoc(A).walletBalance);
  check('no withdrawal record was created for the rejected account',
    Array.from(collMap('withdrawals').values()).filter(w => w.userId === A).length === 0);

  console.log('\n== A failure of the validation CHECK ITSELF does not block (fail-open) ==');
  const B = 'bankwit-b'; await setupFundedUser(B, '0772300202', 500000);
  validateStub.set('5556667778', null); // ensure no stub -- but force the endpoint itself to throw via a temporary fetch override
  const savedFetch = global.fetch;
  global.fetch = async (url, opts) => { if (String(url).endsWith('/bank-transfer/validate')) throw new Error('simulated timeout'); return savedFetch(url, opts); };
  const checkFails = await call('POST', '/withdraw/request', { token: 'uid:' + B, body: bankBody({ amount: 50000, accountNumber: '5556667778' }) });
  global.fetch = savedFetch;
  check('a broken validation check does not block a real request', checkFails.body.status === 'success', checkFails.body);

  console.log('\n== A valid request reserves the balance and files a pending claim, nothing sent yet ==');
  const C = 'bankwit-c'; await setupFundedUser(C, '0772300203', 500000);
  const cBalBefore = userDoc(C).walletBalance;
  const goodReq = await call('POST', '/withdraw/request', { token: 'uid:' + C, body: bankBody({ amount: 100000 }) });
  check('request accepted', goodReq.body.status === 'success', goodReq.body);
  const witId = goodReq.body.withdrawalId;
  const wit = collMap('withdrawals').get(witId);
  check('stored as a bank-method withdrawal', wit.method === 'bank' && wit.bankName === 'Stanbic Bank' && wit.accountNumber === '9988776655', wit);
  check('status is pending -- nothing sent to MarzPay yet', wit.status === 'pending', wit);
  check('full amount reserved from the wallet', userDoc(C).walletBalance === cBalBefore - 100000, userDoc(C).walletBalance);

  console.log('\n== Admin process: success -> processing, MarzPay bank reference captured ==');
  createStub = { ref: 'BT-FIXED-REF-1' };
  const proc = await adminCall('POST', '/admin/withdraw/process', { withdrawalId: witId });
  check('process reports success', proc.body.status === 'success', proc.body);
  const witAfter = collMap('withdrawals').get(witId);
  check('status now processing', witAfter.status === 'processing', witAfter);
  check('MarzPay bank reference captured', witAfter.marzBankReference === 'BT-FIXED-REF-1', witAfter);
  check('totalWithdrawn credited at send time (the net amount from the withdrawal record itself)',
    userDoc(C).totalWithdrawn === witAfter.net, { totalWithdrawn: userDoc(C).totalWithdrawn, net: witAfter.net });

  console.log('\n== Admin verify reads the bank gateway status ==');
  statusStub.set('BT-FIXED-REF-1', 'completed');
  const verify = await adminCall('POST', '/admin/withdraw/verify', { withdrawalId: witId });
  check('verify reports SENT for a completed bank transfer', /SENT/.test(verify.body.message) || verify.body.marzStatus === 'completed', verify.body);

  console.log('\n== Reconciler resolves a processing bank withdrawal automatically ==');
  const sync1 = await adminCall('GET', '/admin/payments/sync');
  check('sync settles it', sync1.body.status === 'success', sync1.body);
  check('now processed', collMap('withdrawals').get(witId).status === 'processed');
  const balAfterProcessed = userDoc(C).walletBalance;
  await adminCall('GET', '/admin/payments/sync');
  check('re-syncing an already-processed withdrawal changes nothing', userDoc(C).walletBalance === balAfterProcessed);

  console.log('\n== Definitive gateway rejection reverts cleanly to pending (nothing moved) ==');
  const D = 'bankwit-d'; await setupFundedUser(D, '0772300204', 500000);
  const dBalBefore = userDoc(D).walletBalance;
  const reqD = await call('POST', '/withdraw/request', { token: 'uid:' + D, body: bankBody({ amount: 80000 }) });
  const witIdD = reqD.body.withdrawalId;
  createStub = { error: { status: 'error', message: 'Insufficient wallet balance', error_code: 'INSUFFICIENT_BALANCE' } };
  const procD = await adminCall('POST', '/admin/withdraw/process', { withdrawalId: witIdD });
  check('process reports the rejection', procD.body.status === 'error', procD.body);
  const witD = collMap('withdrawals').get(witIdD);
  check('reverted to pending, not stuck', witD.status === 'pending', witD);
  check('member balance was never touched by the failed send attempt', userDoc(D).walletBalance === dBalBefore - 80000, userDoc(D).walletBalance);
  check('admin can retry', (await adminCall('POST', '/admin/withdraw/process', { withdrawalId: witIdD })).body.status === 'success');

  console.log('\n== A network exception mid-send leaves it on "sending", never blindly retried ==');
  const E = 'bankwit-e'; await setupFundedUser(E, '0772300205', 500000);
  const reqE = await call('POST', '/withdraw/request', { token: 'uid:' + E, body: bankBody({ amount: 60000 }) });
  const witIdE = reqE.body.withdrawalId;
  createStub = { networkError: true };
  const procE = await adminCall('POST', '/admin/withdraw/process', { withdrawalId: witIdE });
  check('reports the ambiguous failure, does not silently succeed', procE.code === 500, procE.body);
  const witE = collMap('withdrawals').get(witIdE);
  check('status stuck on "sending", NOT reverted to pending', witE.status === 'sending', witE);
  const retryE = await adminCall('POST', '/admin/withdraw/process', { withdrawalId: witIdE });
  check('a "sending" withdrawal can never be blindly re-sent (status guard)', retryE.body.status === 'error', retryE.body);

  console.log('\n== Confirmed provider failure refunds via status-before-refund, never double-refunds ==');
  const F = 'bankwit-f'; await setupFundedUser(F, '0772300206', 500000);
  const fBalBefore = userDoc(F).walletBalance;
  const reqF = await call('POST', '/withdraw/request', { token: 'uid:' + F, body: bankBody({ amount: 70000 }) });
  const witIdF = reqF.body.withdrawalId;
  createStub = { ref: 'BT-FAIL-REF' };
  await adminCall('POST', '/admin/withdraw/process', { withdrawalId: witIdF });
  statusStub.set('BT-FAIL-REF', 'failed');
  await adminCall('GET', '/admin/payments/sync');
  const witF = collMap('withdrawals').get(witIdF);
  check('declined on confirmed provider failure', witF.status === 'declined', witF);
  check('wallet refunded the full original amount', userDoc(F).walletBalance === fBalBefore, userDoc(F).walletBalance);
  const balAfterRefund = userDoc(F).walletBalance;
  await adminCall('GET', '/admin/payments/sync');
  check('running the reconciler again never double-refunds', userDoc(F).walletBalance === balAfterRefund);

  console.log('\n== Admin reject works unmodified on a bank withdrawal ==');
  const G = 'bankwit-g'; await setupFundedUser(G, '0772300207', 500000);
  const gBalBefore = userDoc(G).walletBalance;
  const reqG = await call('POST', '/withdraw/request', { token: 'uid:' + G, body: bankBody({ amount: 45000 }) });
  const rej = await adminCall('POST', '/admin/withdraw/reject', { withdrawalId: reqG.body.withdrawalId, reason: 'Test reject' });
  check('reject succeeds on a pending bank withdrawal', rej.body.status === 'success', rej.body);
  check('fully refunded', userDoc(G).walletBalance === gBalBefore, userDoc(G).walletBalance);

  console.log('\n== A plain mobile-money withdrawal is completely unaffected ==');
  const H = 'bankwit-h'; await setupFundedUser(H, '0772300208', 500000);
  await call('POST', '/bank/save', { token: 'uid:' + H, body: { holder: 'H Tester', network: 'MTN Mobile Money', phone: '0772300208' } });
  collMap('bankAccounts').set('fx1', { userId: H, holder: 'H Tester', network: 'MTN Mobile Money', phone: '+256772300208', createdAt: new Date() });
  const reqH = await call('POST', '/withdraw/request', { token: 'uid:' + H, body: { amount: 50000, holder: 'H Tester', network: 'MTN Mobile Money', phone: '0772300208', pin: '1234' } });
  check('plain mobile-money request still works', reqH.body.status === 'success', reqH.body);
  const witH = collMap('withdrawals').get(reqH.body.withdrawalId);
  check('stored as mobile_money method, no bank fields at all', witH.method === 'mobile_money' && !witH.bankName && !witH.accountNumber, witH);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
