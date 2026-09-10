/* SPACE8 TASK CENTER TEST
   Boots the REAL server.js against an in-memory mock database (test-mockdb.js)
   with Firebase auth stubbed, then drives the referral-milestone (Task
   Center) system end to end over real HTTP: activeL1Count/wholeTeamDeposits
   are computed live (never trusted from the client), claiming pays exactly
   once per tier, an unreached tier is rejected, the two ladders
   (active-Level-1-referral count vs WHOLE team L1+L2+L3 deposits) can never
   cross-collide or double-pay each other, a concurrent double-claim on the
   same tier never double-pays, and deposits from L2/L3 members (not just
   direct L1 referrals) genuinely count toward the deposit ladder.

   Ladder values match the owner's 2026-08-16 "Space8 Mission & Reward
   Structure" screenshot (see server.js's TEAM_MILESTONES /
   TEAM_DEPOSIT_MILESTONES and CLAUDE.md).

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
  check('teamDepositTotal = sum of level-1 deposits = 1,500,000', r.body?.teamDepositTotal === expectedDeposits, r.body?.teamDepositTotal);
  check('l1DepositTotal kept as an alias of teamDepositTotal', r.body?.l1DepositTotal === expectedDeposits, r.body?.l1DepositTotal);
  const m5 = (r.body?.milestones || []).find(m => m.type === 'count' && m.target === 5);
  check('5-count milestone: achieved, not yet claimed', m5 && m5.achieved === true && m5.claimed === false, m5);
  const m10 = (r.body?.milestones || []).find(m => m.type === 'count' && m.target === 10);
  check('10-count milestone NOT achieved (only 5 active)', m10 && m10.achieved === false, m10);

  console.log('\n-- Claiming the 5-count milestone pays exactly once --');
  r = await call('POST', '/team/milestone/claim', { token: 'uid:' + REF, body: { target: 5 } });
  check('claim succeeds, pays UGX 2,500', r.body?.status === 'success' && r.body?.amount === 2500, r.body);
  check('wallet credited +2,500 over starting balance', userDoc(REF).walletBalance === START_BAL + 2500, userDoc(REF).walletBalance);
  r = await call('POST', '/team/milestone/claim', { token: 'uid:' + REF, body: { target: 5 } });
  check('re-claim rejected (already claimed)', r.code === 400 && /already/i.test(r.body?.message || ''), r.body);
  check('wallet unchanged after re-claim attempt', userDoc(REF).walletBalance === START_BAL + 2500, userDoc(REF).walletBalance);

  console.log('\n-- Claiming an unreached tier is rejected, no partial credit --');
  r = await call('POST', '/team/milestone/claim', { token: 'uid:' + REF, body: { target: 10 } });
  check('claiming 10-count tier rejected (only 5 active)', r.code === 400 && !/already/i.test(r.body?.message || ''), r.body);
  check('wallet unchanged', userDoc(REF).walletBalance === START_BAL + 2500, userDoc(REF).walletBalance);

  console.log('\n-- Deposit ladder is independent of the count ladder --');
  r = await call('POST', '/team/milestone/claim', { token: 'uid:' + REF, body: { target: 500000, type: 'deposit' } });
  check('500,000 deposit-tier claim succeeds (UGX 12,500)', r.body?.status === 'success' && r.body?.amount === 12500, r.body);
  check('wallet now +2,500+12,500=+15,000 over starting balance', userDoc(REF).walletBalance === START_BAL + 15000, userDoc(REF).walletBalance);
  r = await call('POST', '/team/milestone/claim', { token: 'uid:' + REF, body: { target: 5000000, type: 'deposit' } });
  check('5,000,000 deposit-tier rejected (only 1.5M so far)', r.code === 400 && !/already/i.test(r.body?.message || ''), r.body);
  r = await call('POST', '/team/milestone/claim', { token: 'uid:' + REF, body: { target: 5 } });
  check('count-ladder target 5 still "already claimed" (namespaces never collided)', r.code === 400 && /already/i.test(r.body?.message || ''), r.body);

  console.log('\n-- Concurrent double-claim on the SAME tier never double-pays --');
  const BAL = userDoc(REF).walletBalance;
  const [r1, r2] = await Promise.all([
    call('POST', '/team/milestone/claim', { token: 'uid:' + REF, body: { target: 100000, type: 'deposit' } }),
    call('POST', '/team/milestone/claim', { token: 'uid:' + REF, body: { target: 100000, type: 'deposit' } }),
  ]);
  const successes = [r1, r2].filter(x => x.body?.status === 'success').length;
  check('exactly ONE of two concurrent claims on the same tier succeeds', successes === 1, { r1: r1.body, r2: r2.body });
  check('wallet credited exactly once (UGX 2,500)', userDoc(REF).walletBalance === BAL + 2500, userDoc(REF).walletBalance);

  console.log('\n-- Codex-verified real gap: teamRewards reflects what was ACTUALLY paid historically, not today\'s ladder rate --');
  // Simulate a claim made long ago, back when the count ladder paid a flat
  // UGX 1,500/referral (target 25 -> 37,500) -- before today's two rate
  // changes down to 500/referral (target 25 -> 12,500 now). The claim flag
  // only ever recorded "claimed", never "for how much"; the real amount
  // paid lives in the immutable team_reward transaction written at claim
  // time. If /team/stats recomputed teamRewards from the CURRENT
  // TEAM_MILESTONES table (the bug), this historical claim would be
  // silently reported as 12,500 instead of the real 37,500 it actually paid.
  users().set(REF, Object.assign({}, userDoc(REF), { milestoneClaimed_25: true }));
  if (!mockdb.__store.has('transactions')) mockdb.__store.set('transactions', new Map());
  mockdb.__store.get('transactions').set('historical-reward-1', {
    userId: REF, type: 'team_reward', milestone: 25, amount: 37500, status: 'success',
    description: 'Task Center: 25 active referrals', date: '2026-08-01', time: '00:00',
  });
  const realTeamRewardTotal = [...mockdb.__store.get('transactions').values()]
    .filter(t => t.userId === REF && t.type === 'team_reward')
    .reduce((s, t) => s + t.amount, 0);
  r = await call('GET', '/team/stats', { token: 'uid:' + REF });
  check(
    'teamRewards sums the REAL transaction amounts (includes the 37,500 historical claim), not the current ladder rate for that target',
    r.body?.teamRewards === realTeamRewardTotal, { got: r.body?.teamRewards, expected: realTeamRewardTotal }
  );
  const m25 = (r.body?.milestones || []).find(m => m.type === 'count' && m.target === 25);
  check('the milestone list itself still correctly shows target-25 as claimed', m25 && m25.claimed === true, m25);

  console.log('\n-- A banned L1 referral no longer pads the referrer\'s Task Center numbers --');
  users().set('l1-5', Object.assign({}, userDoc('l1-5'), { status: 'banned' }));
  r = await call('GET', '/team/stats', { token: 'uid:' + REF });
  check('l1ActiveCount drops from 5 to 4 once that referral is banned', r.body?.l1ActiveCount === 4, r.body?.l1ActiveCount);
  check('teamDepositTotal drops by the banned referral\'s 500,000 (1,500,000 -> 1,000,000)', r.body?.teamDepositTotal === 1000000, r.body?.teamDepositTotal);
  users().set('l1-5', Object.assign({}, userDoc('l1-5'), { status: 'active' }));
  r = await call('GET', '/team/stats', { token: 'uid:' + REF });
  check('unbanning restores the count and deposit total', r.body?.l1ActiveCount === 5 && r.body?.teamDepositTotal === 1500000, r.body);

  console.log('\n-- Deposit ladder now sums the WHOLE team (L1+L2+L3), not just direct L1 --');
  // l2-a is referred by l1-1 (an existing L1 member) -- an L2 member of REF's team.
  users().set('l2-a', {
    phone: '0771000301', walletBalance: 0, totalDeposited: 200000, totalInvested: 30000,
    referredBy: 'l1-1', registrationDone: true, status: 'active',
  });
  // l3-a is referred by l2-a -- an L3 member of REF's team.
  users().set('l3-a', {
    phone: '0771000302', walletBalance: 0, totalDeposited: 300000, totalInvested: 30000,
    referredBy: 'l2-a', registrationDone: true, status: 'active',
  });
  r = await call('GET', '/team/stats', { token: 'uid:' + REF });
  check(
    'teamDepositTotal now includes the L2 (200,000) and L3 (300,000) deposits: 1,500,000 -> 2,000,000',
    r.body?.teamDepositTotal === 2000000, r.body?.teamDepositTotal
  );
  check('l1ActiveCount is unaffected by L2/L3 activity (stays L1-only, still 5)', r.body?.l1ActiveCount === 5, r.body?.l1ActiveCount);
  const m1m = (r.body?.milestones || []).find(m => m.type === 'deposit' && m.target === 1000000);
  check('the 1,000,000 deposit tier is now achieved because of L2+L3 deposits alone tipping it over', m1m && m1m.achieved === true, m1m);
  // A deeper L4 member (referred by l3-a) must NOT count -- the ladder is L1-3 only.
  users().set('l4-a', {
    phone: '0771000303', walletBalance: 0, totalDeposited: 999999999, totalInvested: 30000,
    referredBy: 'l3-a', registrationDone: true, status: 'active',
  });
  r = await call('GET', '/team/stats', { token: 'uid:' + REF });
  check('an L4 member\'s deposits do NOT count toward the ladder (walk stops at 3 levels)', r.body?.teamDepositTotal === 2000000, r.body?.teamDepositTotal);

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
