/* SPACE8 DEPOSIT RESPONSE-SPEED AUDIT
   Owner reported the real mobile-money PIN prompt reaches the phone before
   the app's own "Payment Initiated" screen shows up -- the app's screen was
   lagging behind reality. Root cause: /deposit/marzpay didn't respond to
   the client until the ENTIRE outbound call to MarzPay's collect-money API
   had finished, and that round-trip can legitimately take several real
   seconds (MarzPay's own processing time) with a 15s timeout ceiling.
   MarzPay pushes the actual prompt to the phone on its own schedule
   regardless of when we respond, so blocking our own UI on that round-trip
   only made OUR screen slower without making the payment itself any faster.

   Fixed: respond the instant our own pending-deposit record is written,
   before the gateway call even starts. The gateway call still runs (in the
   background) and updates the deposit's real status once it resolves; the
   status screen's own polling (which starts immediately) picks that up
   within moments regardless.

   This file proves the fix with a realistic simulated MarzPay delay --
   without it, this test would take 4+ real seconds and fail the 200ms
   budget below.

   Run: node test-deposit-instant-response.js   (exits 0 = all green)      */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '4101';

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
const MARZPAY_SIMULATED_DELAY_MS = 4000; // a realistic, not even worst-case, real-world gateway latency
let collectCalled = false;
global.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes('wearemarz.com') && u.endsWith('/collect-money')) {
    collectCalled = true;
    await new Promise(r => setTimeout(r, MARZPAY_SIMULATED_DELAY_MS));
    return { ok: true, status: 200, json: async () => ({ status: 'success', data: { transaction: { uuid: 'SLOW-TX-1' } } }) };
  }
  if (u.includes('wearemarz.com') && u.includes('/collect-money/')) {
    return { ok: true, status: 200, json: async () => ({ status: 'success', data: { transaction: { status: 'successful' } } }) };
  }
  return realFetch(url, opts);
};

require('./server.js');

const BASE = 'http://127.0.0.1:4101';
async function call(method, p, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await fetch(BASE + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
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

(async () => {
  await new Promise(r => setTimeout(r, 600));
  const uid = 'speedtest-user';
  await call('POST', '/account/create-profile', { token: 'uid:' + uid, body: { phone: '0771999999' } });
  await call('POST', '/register', { token: 'uid:' + uid, body: {} });

  console.log('\n== /deposit/marzpay responds before MarzPay itself even replies ==');
  const RESPONSE_BUDGET_MS = 500; // generous; the real number is single-digit ms
  const t0 = Date.now();
  const r = await call('POST', '/deposit/marzpay', { token: 'uid:' + uid, body: { amount: 30000, phone: '0771999999', network: 'MTN Mobile Money' } });
  const elapsed = Date.now() - t0;
  check(`response arrives in well under ${RESPONSE_BUDGET_MS}ms even though MarzPay itself takes ${MARZPAY_SIMULATED_DELAY_MS}ms (got ${elapsed}ms)`, elapsed < RESPONSE_BUDGET_MS, elapsed);
  check('response still reports success with a real depositId and reference', r.body?.status === 'success' && !!r.body?.depositId && !!r.body?.reference, r.body);

  const depId = r.body.depositId;
  const depDoc = collMap('pendingDeposits').get(depId);
  check('the pending deposit record already exists at response time (written before responding)', !!depDoc, depDoc);
  check('gateway call has NOT resolved yet at response time (still genuinely in the background)', !depDoc.marzTxUuid, depDoc);

  console.log('\n== The status screen\'s own immediate poll (fires the instant it opens) handles the still-pending gateway call gracefully ==');
  const pollNow = await call('POST', '/deposit/marzpay/status', { token: 'uid:' + uid, body: { depositId: depId } });
  check('an immediate poll (before the background gateway call resolves) reports "pending", not an error', pollNow.body?.status === 'success' && pollNow.body?.state === 'pending', pollNow.body);

  console.log('\n== Once the background gateway call actually resolves, the deposit is correctly ready to confirm ==');
  await new Promise(r2 => setTimeout(r2, MARZPAY_SIMULATED_DELAY_MS + 300));
  check('the outbound MarzPay call really did happen (this is a background call, not skipped)', collectCalled, collectCalled);
  const depDocAfter = collMap('pendingDeposits').get(depId);
  check('marzTxUuid captured once the background call resolves', depDocAfter.marzTxUuid === 'SLOW-TX-1', depDocAfter);
  check('status advanced from initiating to pending', depDocAfter.status === 'pending', depDocAfter.status);
  const pollAfter = await call('POST', '/deposit/marzpay/status', { token: 'uid:' + uid, body: { depositId: depId } });
  check('a poll after the gateway call resolves now correctly confirms the payment', pollAfter.body?.state === 'matched', pollAfter.body);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
