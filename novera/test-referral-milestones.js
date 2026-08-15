/* NOVERA TASK CENTER TEST
   Boots the REAL server.js against an in-memory mock database (test-mockdb.js)
   with Firebase auth stubbed, then drives the referral-milestone (Task
   Center) system end to end over real HTTP: activeL1Count/l1TeamDeposits are
   computed live (never trusted from the client), claiming pays exactly once
   per tier, an unreached tier is rejected, the two ladders (active-referral
   count vs level-1 team deposits) can never cross-collide or double-pay each
   other, and a concurrent double-claim on the same tier never double-pays.

   Run: node test-referral-milestones.js   (exits 0 = all green)            */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '3998';

const Module = require('module');

// ── Inject the mock DB in place of ./db.js ──
const mockdb = require('./test-mockdb.js');
const dbPath = require.resolve('./db.js');
const dbMod = new Module(dbPath); dbMod.exports = mockdb; dbMod.loaded = true;
require.cache[dbPath] = dbMod;

// ── Stub firebase-admin: token "uid:<x>" verifies as user <x> ──
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

require('./server.js');

const BASE = 'http://127.0.0.1:3998';
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
const users = () => mockdb.__store.get('users');
const userDoc = id => users().get(id);

(async () => {
  await sleep(600); // server + Mongo mock "connect" settled

  console.log('\n-- Setup: referrer + 7 level-1 referrals seeded directly --');
  const REF = 'ref-uid';
  let r = await call('POST', '/account/create-profile', { token: 'uid:' + REF, body: { phone: '0771000000' } });
  check('referrer profile created', r.body?.status === 'success', r.body);
  r = await call('POST', '/register', { token: 'uid:' + REF, body: {} });
  check('referrer registered', r.body?.status === 'success', r.body);
  // Registering also credits the standard welcome bonus to REF itself — every
  // wallet assertion below is relative to this starting balance, not zero.
  const START_BAL = userDoc(REF).walletBalance;

  // 5 of the 7 have invested (active); all 7 exist as level-1 referrals.
  // Deposit totals only on the 5 active ones: 100k+200k+300k+400k+500k = 1,500,000.
  for (let i = 1; i <= 7; i++) {
    users().set('l1-' + i, {
      phone: '07710002' + String(i).padStart(2, '0'), walletBalance: 0,
      totalDeposited: i <= 5 ? 100000 * i : 0,
      totalInvested: i <= 5 ? 30000 : 0,
      referredBy: REF, registrationDone: true, status: 'active',
    });
  }

  console.log('\n-- /team/stats reflects LIVE numbers, never a stored counter --');
  r = await call('GET', '/team/stats', { token: 'uid:' + REF });
  check('l1ActiveCount = 5 (only invested referrals count)', r.body?.l1ActiveCount === 5, r.body?.l1ActiveCount);
  const expectedDeposits = 100000 + 200000 + 300000 + 400000 + 500000;
  check('l1DepositTotal = sum of level-1 deposits = 1,500,000', r.body?.l1DepositTotal === expectedDeposits, r.body?.l1DepositTotal);
  const m5 = (r.body?.milestones || []).find(m => m.type === 'count' && m.target === 5);
  check('5-count milestone: achieved, not yet claimed', m5 && m5.achieved === true && m5.claimed === false, m5);
  const m10 = (r.body?.milestones || []).find(m => m.type === 'count' && m.target === 10);
  check('10-count milestone NOT achieved (only 5 active)', m10 && m10.achieved === false, m10);

  console.log('\n-- Claiming the 5-count milestone pays exactly once --');
  r = await call('POST', '/team/milestone/claim', { token: 'uid:' + REF, body: { target: 5 } });
  check('claim succeeds, pays UGX 10,000', r.body?.status === 'success' && r.body?.amount === 10000, r.body);
  check('wallet credited +10,000 over starting balance', userDoc(REF).walletBalance === START_BAL + 10000, userDoc(REF).walletBalance);
  r = await call('POST', '/team/milestone/claim', { token: 'uid:' + REF, body: { target: 5 } });
  check('re-claim rejected (already claimed)', r.code === 400 && /already/i.test(r.body?.message || ''), r.body);
  check('wallet unchanged after re-claim attempt', userDoc(REF).walletBalance === START_BAL + 10000, userDoc(REF).walletBalance);

  console.log('\n-- Claiming an unreached tier is rejected, no partial credit --');
  r = await call('POST', '/team/milestone/claim', { token: 'uid:' + REF, body: { target: 10 } });
  check('claiming 10-count tier rejected (only 5 active)', r.code === 400 && !/already/i.test(r.body?.message || ''), r.body);
  check('wallet unchanged', userDoc(REF).walletBalance === START_BAL + 10000, userDoc(REF).walletBalance);

  console.log('\n-- Deposit ladder is independent of the count ladder --');
  r = await call('POST', '/team/milestone/claim', { token: 'uid:' + REF, body: { target: 500000, type: 'deposit' } });
  check('500,000 deposit-tier claim succeeds (UGX 12,000)', r.body?.status === 'success' && r.body?.amount === 12000, r.body);
  check('wallet now +10,000+12,000=+22,000 over starting balance', userDoc(REF).walletBalance === START_BAL + 22000, userDoc(REF).walletBalance);
  r = await call('POST', '/team/milestone/claim', { token: 'uid:' + REF, body: { target: 2000000, type: 'deposit' } });
  check('2,000,000 deposit-tier rejected (only 1.5M so far)', r.code === 400 && !/already/i.test(r.body?.message || ''), r.body);
  r = await call('POST', '/team/milestone/claim', { token: 'uid:' + REF, body: { target: 5 } });
  check('count-ladder target 5 still "already claimed" (namespaces never collided)', r.code === 400 && /already/i.test(r.body?.message || ''), r.body);

  console.log('\n-- Concurrent double-claim on the SAME tier never double-pays --');
  const BAL = userDoc(REF).walletBalance;
  const [r1, r2] = await Promise.all([
    call('POST', '/team/milestone/claim', { token: 'uid:' + REF, body: { target: 90000, type: 'deposit' } }),
    call('POST', '/team/milestone/claim', { token: 'uid:' + REF, body: { target: 90000, type: 'deposit' } }),
  ]);
  const successes = [r1, r2].filter(x => x.body?.status === 'success').length;
  check('exactly ONE of two concurrent claims on the same tier succeeds', successes === 1, { r1: r1.body, r2: r2.body });
  check('wallet credited exactly once (UGX 2,000)', userDoc(REF).walletBalance === BAL + 2000, userDoc(REF).walletBalance);

  console.log('\n-- A banned L1 referral no longer pads the referrer\'s Task Center numbers --');
  users().set('l1-5', Object.assign({}, userDoc('l1-5'), { status: 'banned' }));
  r = await call('GET', '/team/stats', { token: 'uid:' + REF });
  check('l1ActiveCount drops from 5 to 4 once that referral is banned', r.body?.l1ActiveCount === 4, r.body?.l1ActiveCount);
  check('l1DepositTotal drops by the banned referral\'s 500,000 (1,500,000 -> 1,000,000)', r.body?.l1DepositTotal === 1000000, r.body?.l1DepositTotal);
  users().set('l1-5', Object.assign({}, userDoc('l1-5'), { status: 'active' }));
  r = await call('GET', '/team/stats', { token: 'uid:' + REF });
  check('unbanning restores the count and deposit total', r.body?.l1ActiveCount === 5 && r.body?.l1DepositTotal === 1500000, r.body);

  console.log('\n-- Auth / validation guards --');
  r = await call('POST', '/team/milestone/claim', { body: { target: 5 } });
  check('no token -> 401', r.code === 401, r.code);
  r = await call('POST', '/team/milestone/claim', { token: 'uid:' + REF, body: { target: 999999 } });
  check('unknown tier -> 400', r.code === 400, r.code);
  r = await call('GET', '/team/members', { token: 'uid:' + REF });
  check('/team/members lists only this user\'s direct referrals', Array.isArray(r.body?.members) && r.body.members.length === 7, r.body?.members?.length);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
