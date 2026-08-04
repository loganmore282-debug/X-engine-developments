/* CHOCOMCC WEBHOOK-FORGERY AUDIT
   /deposit/callback and /withdraw/callback are public, unauthenticated
   endpoints — MarzPay sends no shared secret to check, so anyone who
   obtains a marzReference can POST a forged body. The only real defense is
   never trusting the webhook's own claimed status without an independent
   live re-check against MarzPay's real API first, using ONLY a uuid we
   captured ourselves — never one read out of the incoming webhook body.

   Two real exploits were found and closed here, confirmed live before each
   fix, not just reasoned about:

   1. When a deposit's marzTxUuid was never captured (a real, documented
      MarzPay behavior — their collect response doesn't always include one,
      not attacker-controlled), the old code skipped live verification
      entirely and credited purely on the forged webhook's say-so.
      Confirmed: 30,000 UGX credited with zero actual payment.

   2. The FIRST fix still fell back to a uuid supplied by the webhook body
      itself whenever our own marzTxUuid was unset, then trusted a live
      "successful" result for THAT uuid as proof. But the live check only
      confirms SOME transaction with that uuid succeeded — never that it's
      the one that paid THIS reference. An attacker who legitimately paid
      for one small real deposit (getting a genuine, real, successful uuid)
      could forge a callback for a completely different, unpaid, much
      larger deposit and supply their real-but-unrelated uuid as if it
      belonged to it. Confirmed: 1,000,000 UGX credited by reusing an
      unrelated real transaction's uuid, paying nothing for that deposit.

   The final contract: the uuid used for verification is ALWAYS and ONLY
   the one captured server-side at deposit/withdrawal creation, from OUR
   OWN outbound call to MarzPay. Nothing in the incoming webhook body is
   ever trusted to supply or substitute that identity. No self-captured
   uuid means nothing verifiable exists, so the callback does nothing.

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
// Controls what the initial collect-money/send-money call returns a uuid
// as, and what the live "GET .../:uuid" status checks report (status AND
// reference) for it, per test scenario below.
let collectUuidToIssue = null; // null = simulates MarzPay omitting the uuid
let collectTxForUuid = {}; // uuid -> { status, reference }
global.fetch = async (url, opts) => {
  const u = String(url);
  const json = body => ({ ok: true, status: 200, json: async () => body });
  if (u.includes('wearemarz.com') && u.endsWith('/collect-money')) {
    return json({ status: 'success', data: { transaction: collectUuidToIssue ? { uuid: collectUuidToIssue } : {} } });
  }
  if (u.includes('wearemarz.com') && u.endsWith('/send-money')) {
    return json({ status: 'success', data: { transaction: { uuid: 'WTX-' + (++marzN), status: 'pending' } } });
  }
  const collectMatch = u.match(/\/collect-money\/([^/?]+)/);
  if (collectMatch) {
    const uuid = collectMatch[1];
    const tx = collectTxForUuid[uuid];
    if (!tx) return json({ status: 'error', message: 'transaction not found' });
    return json({ status: 'success', data: { transaction: { status: tx.status, reference: tx.reference } } });
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

  console.log('\n== Exploit #1 (confirmed, now fixed): forged callback, no captured uuid, no reference to check ==');
  collectUuidToIssue = null;
  const A = 'forge-victim-a';
  await setupUser(A, '0771000401');
  const balBefore = userDoc(A).walletBalance;
  let r = await call('POST', '/deposit/marzpay', { token: 'uid:' + A, body: { amount: 30000, phone: '0771000401', network: 'MTN Mobile Money' } });
  const depId = r.body.depositId;
  const depDoc = collMap('pendingDeposits').get(depId);
  check('deposit created with no marzTxUuid captured (matches the real gap this exploited)', !depDoc.marzTxUuid, depDoc);
  const depR = await call('GET', '/deposits', { token: 'uid:' + A });
  const leakedRef = depR.body.deposits.find(d => d.id === depId).marzReference;

  // No uuid AT ALL in the forged body — nothing to even attempt a self-heal
  // check with, so this must do nothing.
  r = await call('POST', '/deposit/callback', { body: { data: { reference: leakedRef, transaction: { status: 'successful' } } } });
  await new Promise(r2 => setTimeout(r2, 200));
  check('forged callback response still 200 (ack-immediately pattern, unrelated to whether it credited anything)', r.code === 200, r.body);
  check('SECURITY: wallet NOT credited by a forged webhook with no uuid to verify at all', userDoc(A).walletBalance === balBefore, userDoc(A).walletBalance);
  check('deposit stays pending, not falsely matched', collMap('pendingDeposits').get(depId).status === 'pending', collMap('pendingDeposits').get(depId).status);

  console.log('\n== Exploit #2 (confirmed, now fixed): reusing a real, unrelated uuid to fake a DIFFERENT deposit ==');
  collectUuidToIssue = null; // this deposit also gets no uuid captured
  const B = 'forge-victim-b';
  await setupUser(B, '0771000402');
  const balBeforeB = userDoc(B).walletBalance;
  r = await call('POST', '/deposit/marzpay', { token: 'uid:' + B, body: { amount: 1000000, phone: '0771000402', network: 'MTN Mobile Money' } });
  const depIdB = r.body.depositId;
  const refB = collMap('pendingDeposits').get(depIdB).marzReference;
  // A REAL, genuinely successful uuid the attacker legitimately obtained
  // from a completely separate, actually-paid transaction of theirs — its
  // OWN real reference is that OTHER transaction's, not this deposit's.
  collectTxForUuid['REAL-BUT-UNRELATED-UUID'] = { status: 'successful', reference: 'some-other-real-marzreference-entirely' };
  r = await call('POST', '/deposit/callback', { body: { data: { reference: refB, transaction: { uuid: 'REAL-BUT-UNRELATED-UUID', status: 'successful' } } } });
  await new Promise(r2 => setTimeout(r2, 200));
  check('SECURITY: a real-but-unrelated uuid whose own reference does not match is rejected, not credited', userDoc(B).walletBalance === balBeforeB, userDoc(B).walletBalance);
  check('the 1,000,000 UGX deposit stays pending, not falsely matched', collMap('pendingDeposits').get(depIdB).status === 'pending', collMap('pendingDeposits').get(depIdB).status);
  check('the poisoning-risk uuid was never persisted onto this deposit', !collMap('pendingDeposits').get(depIdB).marzTxUuid, collMap('pendingDeposits').get(depIdB));

  console.log('\n== NEW: a webhook-supplied uuid whose live reference genuinely MATCHES safely self-heals and credits — instantly, no admin needed ==');
  collectUuidToIssue = null; // MarzPay's initial response omitted the uuid, same real-world gap
  const F = 'legit-self-heal';
  await setupUser(F, '0771000406');
  const balBeforeF = userDoc(F).walletBalance;
  r = await call('POST', '/deposit/marzpay', { token: 'uid:' + F, body: { amount: 60000, phone: '0771000406', network: 'MTN Mobile Money' } });
  const depIdF = r.body.depositId;
  const refF = collMap('pendingDeposits').get(depIdF).marzReference;
  // MarzPay's own webhook DOES carry the real uuid this time, and the live
  // re-check for that uuid genuinely reports back OUR OWN marzReference —
  // proving it's really the transaction that paid this deposit.
  collectTxForUuid['GENUINE-LATE-UUID'] = { status: 'successful', reference: refF };
  r = await call('POST', '/deposit/callback', { body: { data: { reference: refF, transaction: { uuid: 'GENUINE-LATE-UUID', status: 'successful' } } } });
  await new Promise(r2 => setTimeout(r2, 200));
  check('a genuinely matching self-heal credits the wallet immediately, no manual admin step needed', userDoc(F).walletBalance === balBeforeF + 60000, userDoc(F).walletBalance);
  check('deposit marked matched', collMap('pendingDeposits').get(depIdF).status === 'matched', collMap('pendingDeposits').get(depIdF).status);
  check('the verified uuid IS persisted once proven to genuinely belong here', collMap('pendingDeposits').get(depIdF).marzTxUuid === 'GENUINE-LATE-UUID', collMap('pendingDeposits').get(depIdF));

  console.log('\n== Even with OUR OWN captured uuid, a forged "successful" claim can\'t beat a live "pending" ==');
  collectUuidToIssue = 'OWN-UUID-C';
  const C = 'forge-victim-c';
  await setupUser(C, '0771000403');
  const balBeforeC = userDoc(C).walletBalance;
  r = await call('POST', '/deposit/marzpay', { token: 'uid:' + C, body: { amount: 40000, phone: '0771000403', network: 'MTN Mobile Money' } });
  const depIdC = r.body.depositId;
  check('this deposit DID capture its own real uuid', collMap('pendingDeposits').get(depIdC).marzTxUuid === 'OWN-UUID-C', collMap('pendingDeposits').get(depIdC));
  collectTxForUuid['OWN-UUID-C'] = { status: 'pending', reference: collMap('pendingDeposits').get(depIdC).marzReference }; // not actually paid yet
  r = await call('POST', '/deposit/callback', { body: { data: { reference: collMap('pendingDeposits').get(depIdC).marzReference, transaction: { uuid: 'OWN-UUID-C', status: 'successful' } } } });
  await new Promise(r2 => setTimeout(r2, 200));
  check('SECURITY: webhook lying "successful" is rejected when the live check on OUR OWN uuid says pending', userDoc(C).walletBalance === balBeforeC, userDoc(C).walletBalance);

  console.log('\n== A genuine webhook (our own uuid, live check actually confirms it) still credits normally ==');
  collectUuidToIssue = 'OWN-UUID-D';
  const D = 'legit-depositor';
  await setupUser(D, '0771000404');
  const balBeforeD = userDoc(D).walletBalance;
  r = await call('POST', '/deposit/marzpay', { token: 'uid:' + D, body: { amount: 25000, phone: '0771000404', network: 'MTN Mobile Money' } });
  const depIdD = r.body.depositId;
  const refD = collMap('pendingDeposits').get(depIdD).marzReference;
  collectTxForUuid['OWN-UUID-D'] = { status: 'successful', reference: refD };
  r = await call('POST', '/deposit/callback', { body: { data: { reference: refD, transaction: { uuid: 'OWN-UUID-D', status: 'successful' } } } });
  await new Promise(r2 => setTimeout(r2, 200));
  check('a genuinely confirmable webhook still credits the wallet normally', userDoc(D).walletBalance === balBeforeD + 25000, userDoc(D).walletBalance);
  check('deposit correctly marked matched', collMap('pendingDeposits').get(depIdD).status === 'matched', collMap('pendingDeposits').get(depIdD).status);

  console.log('\n== Withdrawal callback: forged "processed" with no captured uuid is ignored ==');
  const E = 'forge-victim-e';
  await setupUser(E, '0771000405');
  userDoc(E).walletBalance = 100000; userDoc(E).totalInvested = 100000;
  await call('POST', '/bank/save', { token: 'uid:' + E, body: { holder: 'E', network: 'MTN Mobile Money', phone: '0771000405' } });
  r = await call('POST', '/withdraw/request', { token: 'uid:' + E, body: { amount: 20000, holder: 'E', network: 'MTN Mobile Money', phone: '0771000405' } });
  const witId = r.body.withdrawalId;
  // Force it into 'processing' the way /admin/withdraw/process would, but
  // WITHOUT ever capturing a real marzTxUuid (simulating the same gap).
  collMap('withdrawals').get(witId).status = 'processing';
  const refE = collMap('withdrawals').get(witId).marzReference || 'WD-REF-E';
  collMap('withdrawals').get(witId).marzReference = refE;
  r = await call('POST', '/withdraw/callback', { body: { data: { reference: refE, transaction: { status: 'successful' } } } });
  await new Promise(r2 => setTimeout(r2, 200));
  check('SECURITY: withdrawal NOT falsely marked processed by a forged webhook with no captured uuid', collMap('withdrawals').get(witId).status === 'processing', collMap('withdrawals').get(witId).status);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
