/* CHOCOMCC WEBHOOK-FORGERY AUDIT
   /deposit/callback and /withdraw/callback are public, unauthenticated
   endpoints — MarzPay sends no shared secret to check, so anyone who
   obtains a marzReference can POST a forged body. The only real defense is
   never trusting the webhook's own claimed status without an independent
   live re-check against MarzPay's real API first.

   CONFIRMED LIVE (before this fix): a user creates a real deposit, reads
   their own marzReference back off their own /deposits history (a normal,
   intended, authenticated call), then POSTs a forged /deposit/callback
   claiming success. If MarzPay's initial collect-money response happened
   not to include a transaction uuid — a real, documented possibility, not
   attacker-controlled — the old code skipped live verification entirely
   whenever there was no uuid to check, and credited the wallet purely on
   the forged webhook's say-so. Verified exploit: 30,000 UGX credited with
   zero actual payment. This is the exact "people waking up with huge
   funds" scenario raised earlier.

   This file proves the fix holds: a forged webhook with no verifiable uuid
   now credits/declines NOTHING, on both deposits and withdrawals, while a
   forged webhook that DOES carry a real, verifiable uuid still can't
   override what MarzPay's own live status check actually says.

   Run: node test-callback-forgery.js   (exits 0 = all green)               */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '4097';

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
// Controls what the live "GET /collect-money/:uuid" and "GET /send-money/:uuid"
// status checks report, per test scenario below.
let collectStatusForUuid = {};
let sendStatusForUuid = {};
global.fetch = async (url, opts) => {
  const u = String(url);
  const json = body => ({ ok: true, status: 200, json: async () => body });
  if (u.includes('wearemarz.com') && u.endsWith('/collect-money')) {
    // Simulates the real, documented MarzPay behavior of sometimes NOT
    // returning a transaction uuid on the initial collect response.
    return json({ status: 'success', data: { transaction: {} } });
  }
  if (u.includes('wearemarz.com') && u.endsWith('/send-money')) {
    return json({ status: 'success', data: { transaction: { uuid: 'WTX-' + (++marzN), status: 'pending' } } });
  }
  const collectMatch = u.match(/\/collect-money\/([^/?]+)/);
  if (collectMatch) {
    const uuid = collectMatch[1];
    const status = collectStatusForUuid[uuid];
    if (status === undefined) return json({ status: 'error', message: 'transaction not found' });
    return json({ status: 'success', data: { transaction: { status } } });
  }
  const sendMatch = u.match(/\/send-money\/([^/?]+)/);
  if (sendMatch) {
    const uuid = sendMatch[1];
    const status = sendStatusForUuid[uuid];
    if (status === undefined) return json({ status: 'error', message: 'transaction not found' });
    return json({ status: 'success', data: { transaction: { status } } });
  }
  return realFetch(url, opts);
};

require('./server.js');

const BASE = 'http://127.0.0.1:4097';
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

async function setupUser(uid, phone) {
  await call('POST', '/account/create-profile', { token: 'uid:' + uid, body: { phone } });
  await call('POST', '/register', { token: 'uid:' + uid, body: {} });
}

(async () => {
  await new Promise(r => setTimeout(r, 600));

  console.log('\n== The exact confirmed exploit: forged deposit callback, no captured uuid ==');
  const A = 'forge-victim-a';
  await setupUser(A, '0771000401');
  const balBefore = userDoc(A).walletBalance;
  let r = await call('POST', '/deposit/marzpay', { token: 'uid:' + A, body: { amount: 30000, phone: '0771000401', network: 'MTN Mobile Money' } });
  const depId = r.body.depositId;
  const depDoc = collMap('pendingDeposits').get(depId);
  check('deposit created with no marzTxUuid captured (matches the real gap this exploited)', !depDoc.marzTxUuid, depDoc);
  const depR = await call('GET', '/deposits', { token: 'uid:' + A });
  const leakedRef = depR.body.deposits.find(d => d.id === depId).marzReference;

  r = await call('POST', '/deposit/callback', { body: { data: { reference: leakedRef, transaction: { status: 'successful' } } } });
  await new Promise(r2 => setTimeout(r2, 200));
  check('forged callback response still 200 (ack-immediately pattern, unrelated to whether it credited anything)', r.code === 200, r.body);
  check('SECURITY: wallet NOT credited by a forged webhook with no verifiable uuid', userDoc(A).walletBalance === balBefore, userDoc(A).walletBalance);
  check('deposit stays pending, not falsely matched', collMap('pendingDeposits').get(depId).status === 'pending', collMap('pendingDeposits').get(depId).status);

  console.log('\n== A forged callback CAN\'T override what MarzPay\'s real status actually says ==');
  const B = 'forge-victim-b';
  await setupUser(B, '0771000402');
  const balBeforeB = userDoc(B).walletBalance;
  r = await call('POST', '/deposit/marzpay', { token: 'uid:' + B, body: { amount: 40000, phone: '0771000402', network: 'MTN Mobile Money' } });
  const depIdB = r.body.depositId;
  // Self-heal path: webhook supplies a uuid we never captured. Real MarzPay
  // status for THAT uuid is "pending" (not actually paid yet) — a forged
  // "successful" claim in the webhook body must not win over the live check.
  collectStatusForUuid['FAKE-UUID-1'] = 'pending';
  r = await call('POST', '/deposit/callback', { body: { data: { reference: collMap('pendingDeposits').get(depIdB).marzReference, transaction: { uuid: 'FAKE-UUID-1', status: 'successful' } } } });
  await new Promise(r2 => setTimeout(r2, 200));
  check('SECURITY: webhook claiming success is REJECTED when the live re-check says pending', userDoc(B).walletBalance === balBeforeB, userDoc(B).walletBalance);

  console.log('\n== A genuine webhook (real uuid, live check actually confirms it) still credits normally ==');
  const C = 'legit-depositor';
  await setupUser(C, '0771000403');
  const balBeforeC = userDoc(C).walletBalance;
  r = await call('POST', '/deposit/marzpay', { token: 'uid:' + C, body: { amount: 25000, phone: '0771000403', network: 'MTN Mobile Money' } });
  const depIdC = r.body.depositId;
  const refC = collMap('pendingDeposits').get(depIdC).marzReference;
  collectStatusForUuid['REAL-UUID-C'] = 'successful';
  r = await call('POST', '/deposit/callback', { body: { data: { reference: refC, transaction: { uuid: 'REAL-UUID-C', status: 'successful' } } } });
  await new Promise(r2 => setTimeout(r2, 200));
  check('a genuinely confirmable webhook still credits the wallet normally', userDoc(C).walletBalance === balBeforeC + 25000, userDoc(C).walletBalance);
  check('deposit correctly marked matched', collMap('pendingDeposits').get(depIdC).status === 'matched', collMap('pendingDeposits').get(depIdC).status);

  console.log('\n== Withdrawal callback: forged "processed" with no verifiable uuid is ignored ==');
  const D = 'forge-victim-d';
  await setupUser(D, '0771000404');
  userDoc(D).walletBalance = 100000; userDoc(D).totalInvested = 100000;
  await call('POST', '/bank/save', { token: 'uid:' + D, body: { holder: 'D', network: 'MTN Mobile Money', phone: '0771000404' } });
  r = await call('POST', '/withdraw/request', { token: 'uid:' + D, body: { amount: 20000, holder: 'D', network: 'MTN Mobile Money', phone: '0771000404' } });
  const witId = r.body.withdrawalId;
  // Force it into 'processing' the way /admin/withdraw/process would, but
  // WITHOUT ever capturing a real marzTxUuid (simulating the same gap).
  collMap('withdrawals').get(witId).status = 'processing';
  const refD = collMap('withdrawals').get(witId).marzReference || 'WD-REF-D';
  collMap('withdrawals').get(witId).marzReference = refD;
  r = await call('POST', '/withdraw/callback', { body: { data: { reference: refD, transaction: { status: 'successful' } } } });
  await new Promise(r2 => setTimeout(r2, 200));
  check('SECURITY: withdrawal NOT falsely marked processed by a forged webhook with no verifiable uuid', collMap('withdrawals').get(witId).status === 'processing', collMap('withdrawals').get(witId).status);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
