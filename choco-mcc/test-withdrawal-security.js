/* CHOCOMCC WITHDRAWAL SECURITY TEST
   Boots the REAL server.js against an in-memory mock database
   (test-mockdb.js) with Firebase auth stubbed and MarzPay's send-money call
   stubbed over global.fetch, then drives /withdraw/request and /bank/save
   over real HTTP to prove: the daily withdrawal cap (2/day by default) can
   never be exceeded — including under a concurrent race for the last slot
   of the day — the cap is genuinely admin-editable and takes effect
   immediately, a banned account is locked out, an invalid/forged `network`
   value can never reach storage, and an object/HTML-injection-style
   `holder` payload can never store raw markup (defense in depth on top of
   the render-time escaping already covered elsewhere).

   Run: node test-withdrawal-security.js   (exits 0 = all green)           */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '4000';

const Module = require('module');

const mockdb = require('./test-mockdb.js');
const dbPath = require.resolve('./db.js');
const dbMod = new Module(dbPath); dbMod.exports = mockdb; dbMod.loaded = true;
require.cache[dbPath] = dbMod;

const faPath = require.resolve('firebase-admin');
const faMod = new Module(faPath);
faMod.exports = {
  initializeApp: () => {},
  credential: { cert: () => ({}) },
  auth: () => ({
    verifyIdToken: async tok => {
      if (String(tok).startsWith('uid:')) return { uid: tok.slice(4) };
      throw new Error('invalid token');
    },
  }),
};
faMod.loaded = true;
require.cache[faPath] = faMod;

const realFetch = global.fetch;
let marzN = 0;
let marzSendShouldFail = false;
global.fetch = async (url, opts) => {
  const u = String(url);
  const json = body => ({ ok: true, status: 200, json: async () => body });
  if (u.includes('wearemarz.com') && u.endsWith('/send-money')) {
    if (marzSendShouldFail) return json({ status: 'error', message: 'Gateway busy' });
    return json({ status: 'success', data: { transaction: { uuid: 'WTX-' + (++marzN), status: 'pending' } } });
  }
  return realFetch(url, opts);
};

require('./server.js');

const BASE = 'http://127.0.0.1:4000';
async function call(method, p, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await realFetch(BASE + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (_) {}
  return { code: r.status, body: j };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
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

async function setupFundedUser(uid, phone, balance) {
  await call('POST', '/account/create-profile', { token: 'uid:' + uid, body: { phone } });
  await call('POST', '/register', { token: 'uid:' + uid, body: {} });
  userDoc(uid).walletBalance = balance;
  // requireInvestToWithdraw (default true) blocks a withdrawal from anyone
  // who has never bought a product — simulate that precondition here so
  // these withdrawal tests exercise the cap/security logic, not this gate.
  userDoc(uid).totalInvested = balance;
  await call('POST', '/bank/save', { token: 'uid:' + uid, body: { holder: 'Test Holder', network: 'MTN Mobile Money', phone: '700111222' } });
}

(async () => {
  await sleep(600);

  console.log('\n== Field validation / injection resistance ==');
  const A = 'alice-uid';
  await setupFundedUser(A, '0771000001', 1000000);

  console.log('\n-- /bank/save rejects a forged/unknown network --');
  let r = await call('POST', '/bank/save', { token: 'uid:' + A, body: { holder: 'Someone', network: 'Bitcoin Wallet', phone: '700111333' } });
  check('unknown network rejected on bind', r.code === 400, r.body);

  console.log('\n-- /withdraw/request rejects a forged network even if bank binding is bypassed --');
  r = await call('POST', '/withdraw/request', { token: 'uid:' + A, body: { amount: 20000, holder: 'Alice', network: 'FAKE_NETWORK', phone: '700111222' } });
  check('forged network in withdraw request rejected (never reaches storage)', r.code === 400, r.body);
  check('no withdrawal doc created for the rejected request', [...withdrawals().values()].filter(w => w.userId === A).length === 0, [...withdrawals().values()]);

  console.log('\n-- object/markup payload in holder is neutralized, never stored as raw HTML --');
  r = await call('POST', '/withdraw/request', { token: 'uid:' + A, body: { amount: 20000, holder: { $ne: null }, network: 'MTN Mobile Money', phone: '700111222' } });
  // Either rejected outright, or (if it somehow proceeds) the stored holder must never contain live HTML tags.
  const storedAfterObjHolder = [...withdrawals().values()].find(w => w.userId === A);
  const holderIsSafe = !storedAfterObjHolder || !/<[^>]+>/.test(String(storedAfterObjHolder.holder));
  check('object-shaped holder payload never results in stored raw HTML', holderIsSafe, storedAfterObjHolder);
  r = await call('POST', '/withdraw/request', { token: 'uid:' + A, body: { amount: 20000, holder: '<img src=x onerror=alert(1)>', network: 'MTN Mobile Money', phone: '700111222' } });
  const htmlDoc = [...withdrawals().values()].filter(w => w.userId === A).slice(-1)[0];
  check('HTML tags in holder are stripped before storage', htmlDoc && !/<[^>]+>/.test(htmlDoc.holder), htmlDoc);

  console.log('\n-- Any amount at or above the minimum is accepted — no "multiple of 5,000" restriction --');
  // Reuses Alice (already set up above) rather than a fresh user, to add
  // exactly one extra request instead of the three a new setupFundedUser()
  // call would cost — this file's fake "uid:x" tokens don't parse as real
  // JWTs, so every request in it shares ONE rate-limit bucket keyed by IP.
  r = await call('POST', '/withdraw/request', { token: 'uid:' + A, body: { amount: 17000, holder: 'Alice', network: 'MTN Mobile Money', phone: '700111222' } });
  check('17,000 (not a multiple of 5,000) is accepted', r.body?.status === 'success', r.body);
  const oddAmountDoc = [...withdrawals().values()].find(w => w.userId === A && w.amount === 17000);
  check('withdrawal stored with the exact amount requested (17,000)', !!oddAmountDoc, oddAmountDoc);

  console.log('\n== Daily withdrawal cap (default 2/day) ==');
  const B = 'bob-uid';
  await setupFundedUser(B, '0771000002', 1000000);
  const bobStart = userDoc(B).walletBalance;

  r = await call('POST', '/withdraw/request', { token: 'uid:' + B, body: { amount: 20000, holder: 'Bob', network: 'MTN Mobile Money', phone: '700111222' } });
  check('1st withdrawal of the day succeeds', r.body?.status === 'success', r.body);
  r = await call('POST', '/withdraw/request', { token: 'uid:' + B, body: { amount: 20000, holder: 'Bob', network: 'MTN Mobile Money', phone: '700111222' } });
  check('2nd withdrawal of the day succeeds', r.body?.status === 'success', r.body);
  r = await call('POST', '/withdraw/request', { token: 'uid:' + B, body: { amount: 20000, holder: 'Bob', network: 'MTN Mobile Money', phone: '700111222' } });
  check('3rd withdrawal of the SAME day is rejected (cap=2)', r.code === 400 && /limit/i.test(r.body?.message || ''), r.body);
  check('exactly 2 withdrawal docs created for bob today', [...withdrawals().values()].filter(w => w.userId === B).length === 2, [...withdrawals().values()].filter(w => w.userId === B).length);
  check('wallet debited for exactly 2 withdrawals, not 3', userDoc(B).walletBalance === bobStart - 40000, userDoc(B).walletBalance);

  console.log('\n-- Concurrent race for the last slot of the day never exceeds the cap --');
  const C = 'carol-uid';
  await setupFundedUser(C, '0771000003', 1000000);
  // Use up 1 of 2 slots first, then fire two concurrent requests for the last slot.
  await call('POST', '/withdraw/request', { token: 'uid:' + C, body: { amount: 20000, holder: 'Carol', network: 'MTN Mobile Money', phone: '700111222' } });
  const carolBalBeforeRace = userDoc(C).walletBalance;
  const [rc1, rc2] = await Promise.all([
    call('POST', '/withdraw/request', { token: 'uid:' + C, body: { amount: 20000, holder: 'Carol', network: 'MTN Mobile Money', phone: '700111222' } }),
    call('POST', '/withdraw/request', { token: 'uid:' + C, body: { amount: 20000, holder: 'Carol', network: 'MTN Mobile Money', phone: '700111222' } }),
  ]);
  const raceSuccesses = [rc1, rc2].filter(x => x.body?.status === 'success').length;
  check('exactly ONE of two concurrent requests wins the last daily slot', raceSuccesses === 1, { rc1: rc1.body, rc2: rc2.body });
  check('exactly 2 withdrawal docs total for carol (never 3)', [...withdrawals().values()].filter(w => w.userId === C).length === 2,
    [...withdrawals().values()].filter(w => w.userId === C).length);
  check('wallet debited for exactly one more withdrawal from the race', userDoc(C).walletBalance === carolBalBeforeRace - 20000, userDoc(C).walletBalance);

  console.log('\n-- The cap is genuinely admin-editable and takes effect immediately --');
  // Admin master key goes in the Authorization header, per verifyAdmin()'s legacy-key path.
  const adminHeaders = { 'Content-Type': 'application/json', Authorization: 'Bearer test-admin-key' };
  const rr = await realFetch(BASE + '/admin/settings/update', { method: 'POST', headers: adminHeaders, body: JSON.stringify({ settings: { maxWithdrawalsPerDay: 1 } }) });
  const rrBody = await rr.json();
  check('admin lowers the cap to 1/day', rrBody?.status === 'success', rrBody);

  const D = 'dave-uid';
  await setupFundedUser(D, '0771000004', 1000000);
  r = await call('POST', '/withdraw/request', { token: 'uid:' + D, body: { amount: 20000, holder: 'Dave', network: 'MTN Mobile Money', phone: '700111222' } });
  check('1st withdrawal succeeds under the new cap=1', r.body?.status === 'success', r.body);
  r = await call('POST', '/withdraw/request', { token: 'uid:' + D, body: { amount: 20000, holder: 'Dave', network: 'MTN Mobile Money', phone: '700111222' } });
  check('2nd withdrawal SAME day now rejected under the lowered cap=1', r.code === 400 && /limit/i.test(r.body?.message || ''), r.body);

  console.log('\n-- Disabling the cap (0) removes the limit entirely --');
  await realFetch(BASE + '/admin/settings/update', { method: 'POST', headers: adminHeaders, body: JSON.stringify({ settings: { maxWithdrawalsPerDay: 0 } }) });
  const E = 'erin-uid';
  await setupFundedUser(E, '0771000005', 1000000);
  for (let i = 0; i < 4; i++) {
    r = await call('POST', '/withdraw/request', { token: 'uid:' + E, body: { amount: 20000, holder: 'Erin', network: 'MTN Mobile Money', phone: '700111222' } });
    check('withdrawal #' + (i + 1) + ' succeeds with cap disabled', r.body?.status === 'success', r.body);
  }
  // Restore default for cleanliness of any later assertions in this file.
  await realFetch(BASE + '/admin/settings/update', { method: 'POST', headers: adminHeaders, body: JSON.stringify({ settings: { maxWithdrawalsPerDay: 2 } }) });

  console.log('\n-- A banned account cannot withdraw at all, regardless of the cap --');
  const F = 'frank-uid';
  await setupFundedUser(F, '0771000006', 1000000);
  userDoc(F).status = 'banned';
  const frankStart = userDoc(F).walletBalance;
  r = await call('POST', '/withdraw/request', { token: 'uid:' + F, body: { amount: 20000, holder: 'Frank', network: 'MTN Mobile Money', phone: '700111222' } });
  check('banned account withdrawal rejected', r.code === 400 && /paused/i.test(r.body?.message || ''), r.body);
  check('banned account wallet unchanged', userDoc(F).walletBalance === frankStart, userDoc(F).walletBalance);

  console.log('\n== requireInvestToWithdraw (default: on) ==');
  const K = 'kim-uid';
  await call('POST', '/account/create-profile', { token: 'uid:' + K, body: { phone: '0771000011' } });
  await call('POST', '/register', { token: 'uid:' + K, body: {} });
  userDoc(K).walletBalance = 1000000; // funded, but never invested
  await call('POST', '/bank/save', { token: 'uid:' + K, body: { holder: 'Kim', network: 'MTN Mobile Money', phone: '700111222' } });
  r = await call('POST', '/withdraw/request', { token: 'uid:' + K, body: { amount: 20000, holder: 'Kim', network: 'MTN Mobile Money', phone: '700111222' } });
  check('withdrawal blocked for a user who never invested', r.code === 400 && /chocolate|invest/i.test(r.body?.message || ''), r.body);
  check('wallet untouched by the blocked attempt', userDoc(K).walletBalance === 1000000, userDoc(K).walletBalance);

  await realFetch(BASE + '/admin/settings/update', { method: 'POST', headers: adminHeaders, body: JSON.stringify({ settings: { requireInvestToWithdraw: false } }) });
  r = await call('POST', '/withdraw/request', { token: 'uid:' + K, body: { amount: 20000, holder: 'Kim', network: 'MTN Mobile Money', phone: '700111222' } });
  check('withdrawal allowed once requireInvestToWithdraw is turned off', r.body?.status === 'success', r.body);
  await realFetch(BASE + '/admin/settings/update', { method: 'POST', headers: adminHeaders, body: JSON.stringify({ settings: { requireInvestToWithdraw: true } }) });

  console.log('\n== Admin manual withdrawal approval gate ==');
  const adminHeaders2 = { 'Content-Type': 'application/json', Authorization: 'Bearer test-admin-key' };
  async function adminCall(p, body) {
    const rr = await realFetch(BASE + p, { method: 'POST', headers: adminHeaders2, body: JSON.stringify(body || {}) });
    let j = null; try { j = await rr.json(); } catch (_) {}
    return { code: rr.status, body: j };
  }

  console.log('\n-- A fresh withdrawal request never reaches MarzPay, stays "pending" --');
  const G = 'grace-uid';
  await setupFundedUser(G, '0771000007', 1000000);
  const graceStart = userDoc(G).walletBalance;
  r = await call('POST', '/withdraw/request', { token: 'uid:' + G, body: { amount: 20000, holder: 'Grace', network: 'MTN Mobile Money', phone: '700111222' } });
  check('withdraw/request succeeds without touching MarzPay', r.body?.status === 'success', r.body);
  const graceWitId = r.body?.withdrawalId;
  const graceWit = withdrawals().get(graceWitId);
  check('withdrawal doc created with status "pending"', graceWit?.status === 'pending', graceWit);
  check('wallet balance reserved (debited) at request time', userDoc(G).walletBalance === graceStart - 20000, userDoc(G).walletBalance);
  check('totalWithdrawn NOT credited yet (nothing sent)', !userDoc(G).totalWithdrawn, userDoc(G).totalWithdrawn);

  console.log('\n-- A non-admin cannot approve/send a withdrawal --');
  r = await call('POST', '/admin/withdraw/process', { body: { withdrawalId: graceWitId } });
  check('unauthenticated process call rejected', r.code === 401, r.body);

  console.log('\n-- Gateway rejection leaves the withdrawal pending and untouched --');
  marzSendShouldFail = true;
  let ar = await adminCall('/admin/withdraw/process', { withdrawalId: graceWitId });
  check('gateway-rejected process call returns an error', ar.code === 400, ar.body);
  check('withdrawal reverted to "pending" (not stuck at "sending")', withdrawals().get(graceWitId)?.status === 'pending', withdrawals().get(graceWitId));
  check('wallet unaffected by the failed attempt', userDoc(G).walletBalance === graceStart - 20000, userDoc(G).walletBalance);
  marzSendShouldFail = false;

  console.log('\n-- Admin approves & sends: moves to "processing", totalWithdrawn credited --');
  ar = await adminCall('/admin/withdraw/process', { withdrawalId: graceWitId });
  check('admin process succeeds', ar.body?.status === 'success', ar.body);
  const graceWitAfter = withdrawals().get(graceWitId);
  check('withdrawal now "processing"', graceWitAfter?.status === 'processing', graceWitAfter);
  check('totalWithdrawn credited with net amount once actually sent', userDoc(G).totalWithdrawn === graceWitAfter.net, userDoc(G).totalWithdrawn);

  console.log('\n-- Cannot re-process an already-processing withdrawal --');
  ar = await adminCall('/admin/withdraw/process', { withdrawalId: graceWitId });
  check('re-processing a non-pending withdrawal is rejected', ar.code === 400, ar.body);

  console.log('\n-- Two admins racing to process the same pending withdrawal: only one wins --');
  const H = 'henry-uid';
  await setupFundedUser(H, '0771000008', 1000000);
  r = await call('POST', '/withdraw/request', { token: 'uid:' + H, body: { amount: 20000, holder: 'Henry', network: 'MTN Mobile Money', phone: '700111222' } });
  const henryWitId = r.body?.withdrawalId;
  const [pr1, pr2] = await Promise.all([
    adminCall('/admin/withdraw/process', { withdrawalId: henryWitId }),
    adminCall('/admin/withdraw/process', { withdrawalId: henryWitId }),
  ]);
  const processWins = [pr1, pr2].filter(x => x.body?.status === 'success').length;
  // The in-flight guard means the loser gets either a 409 (true overlap) or a
  // clean 400 "not pending anymore" (the winner's DB write landed first) —
  // either way the real invariant is that MarzPay is never hit twice for the
  // same withdrawal, i.e. exactly one call ever succeeds.
  check('exactly one concurrent process call succeeds, never both', processWins === 1, { pr1: pr1.body, pr2: pr2.body });

  console.log('\n-- Rejecting a still-pending withdrawal refunds ONLY the wallet, no totalWithdrawn change --');
  const I = 'ivy-uid';
  await setupFundedUser(I, '0771000009', 1000000);
  const ivyStart = userDoc(I).walletBalance;
  r = await call('POST', '/withdraw/request', { token: 'uid:' + I, body: { amount: 20000, holder: 'Ivy', network: 'MTN Mobile Money', phone: '700111222' } });
  const ivyWitId = r.body?.withdrawalId;
  ar = await adminCall('/admin/withdraw/reject', { withdrawalId: ivyWitId, reason: 'test reject while pending' });
  check('reject-while-pending succeeds', ar.body?.status === 'success', ar.body);
  check('wallet fully refunded', userDoc(I).walletBalance === ivyStart, userDoc(I).walletBalance);
  check('totalWithdrawn untouched (nothing was ever sent)', !userDoc(I).totalWithdrawn, userDoc(I).totalWithdrawn);
  check('withdrawal doc marked declined', withdrawals().get(ivyWitId)?.status === 'declined', withdrawals().get(ivyWitId));

  console.log('\n-- Rejecting an already-processing withdrawal reverses totalWithdrawn too --');
  const J = 'jack-uid';
  await setupFundedUser(J, '0771000010', 1000000);
  const jackStart = userDoc(J).walletBalance;
  r = await call('POST', '/withdraw/request', { token: 'uid:' + J, body: { amount: 20000, holder: 'Jack', network: 'MTN Mobile Money', phone: '700111222' } });
  const jackWitId = r.body?.withdrawalId;
  await adminCall('/admin/withdraw/process', { withdrawalId: jackWitId });
  check('jack totalWithdrawn credited after send', userDoc(J).totalWithdrawn > 0, userDoc(J).totalWithdrawn);
  ar = await adminCall('/admin/withdraw/reject', { withdrawalId: jackWitId, reason: 'test reject while processing' });
  check('reject-while-processing succeeds', ar.body?.status === 'success', ar.body);
  check('wallet fully refunded after processing-stage reject', userDoc(J).walletBalance === jackStart, userDoc(J).walletBalance);
  check('totalWithdrawn reversed back to zero', userDoc(J).totalWithdrawn === 0, userDoc(J).totalWithdrawn);

  console.log('\n-- Cannot reject an already-settled (declined) withdrawal twice --');
  ar = await adminCall('/admin/withdraw/reject', { withdrawalId: jackWitId, reason: 'double reject' });
  check('double reject on an already-declined withdrawal is rejected', ar.code === 400, ar.body);

  console.log('\n-- /admin/withdraw/verify is read-only and never moves money --');
  const balBeforeVerify = userDoc(G).walletBalance, totalWithdrawnBeforeVerify = userDoc(G).totalWithdrawn;
  ar = await adminCall('/admin/withdraw/verify', { withdrawalId: graceWitId });
  check('verify call succeeds', ar.body?.status === 'success', ar.body);
  check('verify never changes wallet balance', userDoc(G).walletBalance === balBeforeVerify, userDoc(G).walletBalance);
  check('verify never changes totalWithdrawn', userDoc(G).totalWithdrawn === totalWithdrawnBeforeVerify, userDoc(G).totalWithdrawn);

  console.log('\n-- /admin/badges counts "pending" (awaiting-approval), not "processing" --');
  const badgesR = await realFetch(BASE + '/admin/badges', { method: 'GET', headers: adminHeaders2 });
  const badgesBody = await badgesR.json();
  const stillPending = [...withdrawals().values()].filter(w => w.status === 'pending').length;
  check('pendingWithdrawals badge reflects "pending" count', badgesBody?.pendingWithdrawals === stillPending, { badgesBody, stillPending });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
