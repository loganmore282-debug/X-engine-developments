/* SPACE8 REFERRAL COMMISSION — FIRST INVESTMENT ONLY
   L1/L2/L3 commission (28% / 2% / 1%) used to fire on EVERY investment a
   referred member ever made. Changed to a one-time reward: it only pays out
   on that member's first-ever investment. Every later purchase they make is
   still real, valid activity for the Task Center's active-referral-count and
   L1-deposit-total milestones — it just never pays L1/L2/L3 again.

   Also covers the backward-compatible migration path: an account that
   already had totalInvested > 0 before this change shipped (no
   firstInvestmentDone flag ever set) must NOT have its next purchase
   mistaken for a "first" investment and double-pay its referrer.

   Run: node test-commission-first-only.js   (exits 0 = all green)         */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '4063';

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

const realFetch = global.fetch;
const BASE = 'http://127.0.0.1:4063';
async function call(method, p, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await realFetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
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

(async () => {
  await sleep(600);

  console.log('\n== Setup: referrer + a fresh buyer under them ==');
  users().set('ref1', { phone: '0771000000', walletBalance: 0, totalInvested: 0, referredBy: null, registrationDone: true, status: 'active', referralCode: 'REFCODE' });
  users().set('buyer1', { phone: '0771000001', walletBalance: 10_000_000, totalInvested: 0, referredBy: 'ref1', registrationDone: true, status: 'active' });

  console.log('\n-- buyer1\'s FIRST investment pays L1 commission to ref1 --');
  let r = await call('POST', '/invest/create', { token: 'uid:buyer1', body: { tierKey: 'explorer1' } });
  check('first purchase succeeds', r.body?.status === 'success', r.body);
  await sleep(150); // commission is fired async (.catch, not awaited) in /invest/create
  const balAfterFirst = users().get('ref1').walletBalance;
  check('ref1 got paid 28% of 30,000 = 8,400 on buyer1\'s first purchase', balAfterFirst === 8400, balAfterFirst);
  check('buyer1.firstInvestmentDone is now true', users().get('buyer1').firstInvestmentDone === true, users().get('buyer1').firstInvestmentDone);

  console.log('\n-- buyer1\'s SECOND investment does NOT pay commission again --');
  r = await call('POST', '/invest/create', { token: 'uid:buyer1', body: { tierKey: 'tiros1' } });
  check('second purchase succeeds', r.body?.status === 'success', r.body);
  await sleep(150);
  const balAfterSecond = users().get('ref1').walletBalance;
  check('ref1\'s balance UNCHANGED after buyer1\'s second purchase (still 8,400)', balAfterSecond === 8400, balAfterSecond);

  console.log('\n-- A third investment, even re-run through the reconciler-style call, still pays nothing --');
  r = await call('POST', '/invest/create', { token: 'uid:buyer1', body: { tierKey: 'telstar1' } });
  check('third purchase succeeds', r.body?.status === 'success', r.body);
  await sleep(150);
  check('ref1\'s balance still unchanged (8,400) after a third purchase', users().get('ref1').walletBalance === 8400, users().get('ref1').walletBalance);

  console.log('\n== Backward-compatible migration path ==');
  console.log('-- An account that already invested BEFORE this fix (totalInvested > 0, no firstInvestmentDone flag) --');
  users().set('ref2', { phone: '0771000010', walletBalance: 0, totalInvested: 0, referredBy: null, registrationDone: true, status: 'active' });
  users().set('oldBuyer', {
    phone: '0771000011', walletBalance: 10_000_000, totalInvested: 30000 /* pre-existing, pre-fix investment */,
    referredBy: 'ref2', registrationDone: true, status: 'active'
    // NOTE: no firstInvestmentDone field at all — simulates a real account from before this change.
  });
  r = await call('POST', '/invest/create', { token: 'uid:oldBuyer', body: { tierKey: 'explorer1' } });
  check('pre-existing investor\'s new purchase succeeds', r.body?.status === 'success', r.body);
  await sleep(150);
  check('ref2 is NOT paid a phantom "first investment" commission for oldBuyer\'s actually-later purchase',
    (users().get('ref2').walletBalance || 0) === 0, users().get('ref2').walletBalance);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
