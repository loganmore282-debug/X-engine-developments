/* CHRONOVA — REFERRALS / INVESTMENT PROGRESS / TASK CENTER LIVENESS SUITE
   Boots the REAL server.js against an in-memory database (test-mockdb.js)
   with Firebase auth and MarzPay stubbed, then drives every referral,
   commission, daily-cashback and Task-Center-milestone flow end-to-end over
   real HTTP. This is a focused companion to test-liveness.js, written to
   pin down the exact bugs found in a manual audit:
     - /account/create-profile crashing for every signup with no username
       (the real client never sends one) because it referenced a variable
       out of scope on success.
     - payCommissions marking a deposit "commDone" even when the investor had
       NO referrer yet, permanently forfeiting that commission once the
       referral link was made later (reconcileCommissions would skip it
       forever since commDone was already true).
     - The undefined-cron crashes (runDailyPayouts / pollPendingPayments)
       that silently stopped every background job including this one.

   Run:  node test-referrals-milestones.js      (exits 0 = all green)        */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '3998';

const Module = require('module');

// ── Inject the mock DB in place of ./db ──
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
    updateUser: async () => ({}),
    createCustomToken: async uid => 'ct:' + uid,
  }),
};
faMod.loaded = true;
require.cache[faPath] = faMod;

// ── Stub MarzPay over global fetch — collections settle the instant the
// test flips marzTx to 'completed' and fires the webhook, matching prod. ──
const realFetch = global.fetch;
let marzN = 0;
const marzTx = new Map(); // uuid -> status
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  const json = body => ({ ok: true, status: 200, json: async () => body });
  if (!u.includes('wearemarz.com')) return realFetch(url, opts);
  if (u.endsWith('/collect-money') || u.endsWith('/send-money')) {
    const uuid = (u.endsWith('/collect-money') ? 'CTX-' : 'WTX-') + (++marzN);
    marzTx.set(uuid, 'processing');
    return json({ status: 'success', data: { transaction: { uuid, status: 'pending' } } });
  }
  const m = u.match(/\/(collect-money|send-money)\/([^/]+)$/);
  if (m) return json({ data: { transaction: { status: marzTx.get(m[2]) || 'processing' } } });
  return json({ status: 'error', message: 'unknown stub route' });
};

require('./server.js');

// ── tiny HTTP client + assertions ──
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
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}
const users = () => mockdb.__store.get('users');
const deposits = () => mockdb.__store.get('pendingDeposits');
const investments = () => mockdb.__store.get('investments');
const txns = () => mockdb.__store.get('transactions');
const userDoc = id => users().get(id);
const countTx = (uid, type) => [...txns().values()].filter(t => t.userId === uid && t.type === type).length;
const sumTx = (uid, type) => [...txns().values()].filter(t => t.userId === uid && t.type === type).reduce((s, t) => s + (t.amount || 0), 0);

// Drives a full MarzPay deposit to completion (initiate -> webhook), the
// exact real-world path creditMarzDeposit + payCommissions run through.
async function realDeposit(token, amount, phone) {
  const r = await call('POST', '/deposit/marzpay', { token, body: { amount, phone } });
  if (r.body?.status !== 'success') throw new Error('deposit initiate failed: ' + JSON.stringify(r.body));
  const dep = deposits().get(r.body.depositId);
  marzTx.set(dep.marzTxUuid, 'completed');
  await call('POST', '/deposit/callback', {
    body: { event_type: 'collection.completed',
      transaction: { reference: dep.marzReference, status: 'completed', amount: { raw: amount } },
      collection: { provider_transaction_id: 'MTN-' + (++marzN) } }
  });
  await sleep(200);
  return r.body.depositId;
}

(async () => {
  await sleep(1200); // server listening + crons booted
  const ADMIN = { adminKey: 'test-admin-key' };

  // Pin every rate to the documented production defaults explicitly, so this
  // suite proves the real numbers, not whatever happens to be hardcoded.
  await call('POST', '/admin/settings/update', { body: { ...ADMIN, welcomeBonus: 5000, commL1: 0.30, commL2: 0.03, commL3: 0.01 } });
  // A clean, round-number product so cashback arithmetic is easy to verify.
  await call('POST', '/admin/products/save', { body: { ...ADMIN, key: 'watch1', label: 'Test Watch', price: 30000, cycle: 120 } });
  // A SECOND product whose expectedReturn does NOT divide evenly by its cycle,
  // specifically to prove the final payout absorbs the rounding remainder.
  await call('POST', '/admin/products/save', { body: { ...ADMIN, key: 'watch2', label: 'Remainder Watch', price: 33333, cycle: 120 } });

  const A = 'uid:alice-uid', B = 'uid:bob-uid', C = 'uid:carol-uid', D = 'uid:dave-uid';

  console.log('\n── 1. Registration WITHOUT a username (the real client never sends one)');
  // This is the exact shape the real app sends: no username field at all.
  // Regression test for the create-profile crash that made every signup fail.
  let r = await call('POST', '/account/create-profile', { token: A, body: { phone: '0771000001' } });
  check('create-profile succeeds with no username supplied', r.body?.status === 'success', r.body);
  check('an auto-generated code is returned', typeof r.body?.username === 'string' && r.body.username.length >= 6, r.body);
  r = await call('POST', '/register', { token: A, body: { referralCode: '' } });
  check('alice registered, welcome bonus 5000', r.body?.status === 'success' && r.body?.welcomeBonus === 5000, r.body);
  const aliceCode = userDoc('alice-uid').referralCode;
  check('referralCode persisted on the user doc', typeof aliceCode === 'string' && aliceCode.length >= 6, aliceCode);

  console.log('\n── 2. Build a 4-deep referral chain: alice ← bob ← carol ← dave');
  r = await call('POST', '/account/create-profile', { token: B, body: { phone: '0771000002' } });
  check('bob profile created (no username)', r.body?.status === 'success', r.body);
  r = await call('POST', '/register', { token: B, body: { referralCode: aliceCode } });
  check('bob registered under alice', r.body?.referrerId === 'alice-uid', r.body);
  const bobCode = userDoc('bob-uid').referralCode;

  r = await call('POST', '/account/create-profile', { token: C, body: { phone: '0771000003' } });
  check('carol profile created (no username)', r.body?.status === 'success', r.body);
  r = await call('POST', '/register', { token: C, body: { referralCode: bobCode } });
  check('carol registered under bob', r.body?.referrerId === 'bob-uid', r.body);
  const carolCode = userDoc('carol-uid').referralCode;

  r = await call('POST', '/account/create-profile', { token: D, body: { phone: '0771000004' } });
  check('dave profile created (no username)', r.body?.status === 'success', r.body);
  r = await call('POST', '/register', { token: D, body: { referralCode: carolCode } });
  check('dave registered under carol', r.body?.referrerId === 'carol-uid', r.body);

  check('team counts propagate up the whole chain', userDoc('carol-uid').teamL1Count === 1 && userDoc('bob-uid').teamL2Count === 1 && userDoc('alice-uid').teamL3Count === 1,
    { carolL1: userDoc('carol-uid').teamL1Count, bobL2: userDoc('bob-uid').teamL2Count, aliceL3: userDoc('alice-uid').teamL3Count });

  console.log('\n── 3. Deposit-based commission propagates exactly 3 levels (30% / 3% / 1%)');
  const carolPre = userDoc('carol-uid').commissionEarned || 0;
  const bobPre = userDoc('bob-uid').commissionEarned || 0;
  const alicePre = userDoc('alice-uid').commissionEarned || 0;
  await realDeposit(D, 100000, '0771000004');
  check('dave deposit credited', userDoc('dave-uid').walletBalance === 5000 + 100000, userDoc('dave-uid').walletBalance);
  check('L1 (carol) earns 30% = 30000', (userDoc('carol-uid').commissionEarned || 0) === carolPre + 30000, userDoc('carol-uid').commissionEarned);
  check('L2 (bob) earns 3% = 3000', (userDoc('bob-uid').commissionEarned || 0) === bobPre + 3000, userDoc('bob-uid').commissionEarned);
  check('L3 (alice) earns 1% = 1000', (userDoc('alice-uid').commissionEarned || 0) === alicePre + 1000, userDoc('alice-uid').commissionEarned);
  check('commission ledger rows carry the right level', sumTx('carol-uid', 'commission') === carolPre + 30000, sumTx('carol-uid', 'commission'));
  r = await call('POST', '/admin/commissions/reconcile', { body: ADMIN }); await sleep(200);
  check('reconciler re-run NEVER double-pays any level',
    (userDoc('carol-uid').commissionEarned || 0) === carolPre + 30000 &&
    (userDoc('bob-uid').commissionEarned || 0) === bobPre + 3000 &&
    (userDoc('alice-uid').commissionEarned || 0) === alicePre + 1000,
    { carol: userDoc('carol-uid').commissionEarned, bob: userDoc('bob-uid').commissionEarned, alice: userDoc('alice-uid').commissionEarned });

  console.log('\n── 4. THE BUG FIX: a deposit made BEFORE attribution still pays once linked later');
  const E = 'uid:eve-uid';
  await call('POST', '/account/create-profile', { token: E, body: { phone: '0771000005' } });
  await call('POST', '/register', { token: E, body: { referralCode: '' } }); // no referrer at all yet
  check('eve has no referrer at registration', !userDoc('eve-uid').referredBy);
  const eveDepId = await realDeposit(E, 50000, '0771000005');
  check('eve deposit credited with no referrer to pay', userDoc('eve-uid').walletBalance === 5000 + 50000, userDoc('eve-uid').walletBalance);
  check('commDone is LEFT UNSET on a deposit with no referrer (so it is never forfeited)',
    deposits().get(eveDepId).commDone !== true, deposits().get(eveDepId).commDone);
  const aliceCommPre2 = userDoc('alice-uid').commissionEarned || 0;
  r = await call('POST', '/admin/user/set-referrer', { body: { ...ADMIN, userId: 'eve-uid', referrerCode: aliceCode } });
  check('admin links eve under alice after the fact', r.body?.status === 'success', r.body);
  r = await call('POST', '/admin/commissions/reconcile', { body: ADMIN }); await sleep(200);
  check('reconciler now pays alice the commission on the PRE-ATTRIBUTION deposit (30% of 50000 = 15000)',
    (userDoc('alice-uid').commissionEarned || 0) === aliceCommPre2 + 15000, userDoc('alice-uid').commissionEarned);
  check('the deposit is now marked commDone', deposits().get(eveDepId).commDone === true, deposits().get(eveDepId).commDone);
  r = await call('POST', '/admin/commissions/reconcile', { body: ADMIN }); await sleep(200);
  check('re-running reconcile again does NOT double-pay the recovered commission',
    (userDoc('alice-uid').commissionEarned || 0) === aliceCommPre2 + 15000, userDoc('alice-uid').commissionEarned);

  console.log('\n── 5. Investment progress fields are set correctly at purchase');
  await call('POST', '/admin/deposit', { body: { ...ADMIN, userId: 'dave-uid', amount: 30000, note: 'seed for purchase' } });
  r = await call('POST', '/invest/create', { token: D, body: { tierKey: 'watch1' } });
  check('dave buys watch1', r.body?.status === 'success', r.body);
  const daveInv = [...investments().entries()].find(([, v]) => v.userId === 'dave-uid')[1];
  check('payoutsTotal = cycle (120)', daveInv.payoutsTotal === 120, daveInv.payoutsTotal);
  check('payoutsMade starts at 0', daveInv.payoutsMade === 0, daveInv.payoutsMade);
  check('dailyPayout = price*30/120 = 7500', daveInv.dailyPayout === 7500, daveInv.dailyPayout);
  check('expectedReturn = price*30 = 900000', daveInv.expectedReturn === 900000, daveInv.expectedReturn);
  check('status starts active', daveInv.status === 'active', daveInv.status);

  console.log('\n── 6. Daily cashback: first payout exactly at +24h, never twice');
  const daveBalPre = userDoc('dave-uid').walletBalance;
  daveInv.createdAt = new Date(Date.now() - 25 * 3600000); // 25h elapsed -> exactly 1 due
  await call('POST', '/admin/check-maturities', { body: ADMIN }); await sleep(200);
  check('exactly one payout of 7500 credited', userDoc('dave-uid').walletBalance === daveBalPre + 7500, userDoc('dave-uid').walletBalance - daveBalPre);
  check('payoutsMade advanced to 1', daveInv.payoutsMade === 1, daveInv.payoutsMade);
  await call('POST', '/admin/check-maturities', { body: ADMIN }); await sleep(200);
  check('running the cron again within the same day pays NOTHING extra', userDoc('dave-uid').walletBalance === daveBalPre + 7500, userDoc('dave-uid').walletBalance - daveBalPre);

  console.log('\n── 7. Cron catch-up: if days were missed, all of them land in ONE pass');
  daveInv.createdAt = new Date(Date.now() - (4 * 24 + 1) * 3600000); // pretend 4 days have now passed since purchase
  const daveBalPre2 = userDoc('dave-uid').walletBalance;
  await call('POST', '/admin/check-maturities', { body: ADMIN }); await sleep(200);
  check('3 MORE days catch up in one sweep (was at 1, now at 4) = 3*7500 = 22500', userDoc('dave-uid').walletBalance === daveBalPre2 + 22500, { got: userDoc('dave-uid').walletBalance - daveBalPre2, payoutsMade: daveInv.payoutsMade });
  check('payoutsMade is now 4', daveInv.payoutsMade === 4, daveInv.payoutsMade);

  console.log('\n── 8. Settle-on-open: opening the app pays a due cashback instantly');
  daveInv.createdAt = new Date(Date.now() - (5 * 24 + 1) * 3600000);
  const daveBalPre3 = userDoc('dave-uid').walletBalance;
  r = await call('GET', '/account/investments', { token: D });
  await sleep(150);
  check('opening /account/investments settles the due payout with no separate cron call', userDoc('dave-uid').walletBalance === daveBalPre3 + 7500, userDoc('dave-uid').walletBalance - daveBalPre3);
  check('the API response already reflects the fresh payoutsMade (5)', r.body?.investments?.[0]?.payoutsMade === 5, r.body?.investments?.[0]?.payoutsMade);

  console.log('\n── 8b. Settle-on-open is scoped to the CALLER only — it must never settle another user\'s due investment too');
  // Performance fix: opening your own page used to run the GLOBAL payout sweep
  // (every active investment on the platform) if your own payout happened to
  // be due, so one user's page load paid for crediting everyone else's too.
  // It must now touch ONLY the caller's own investments.
  await call('POST', '/admin/deposit', { body: { ...ADMIN, userId: 'bob-uid', amount: 30000, note: 'seed for isolation check' } });
  r = await call('POST', '/invest/create', { token: B, body: { tierKey: 'watch1' } });
  check('bob buys watch1 for the isolation check', r.body?.status === 'success', r.body);
  const bobInv = [...investments().entries()].find(([, v]) => v.userId === 'bob-uid' && v.status === 'active')[1];
  bobInv.createdAt = new Date(Date.now() - 25 * 3600000); // bob also has a payout due right now
  const bobBalPre = userDoc('bob-uid').walletBalance;
  daveInv.createdAt = new Date(Date.now() - (6 * 24 + 1) * 3600000); // dave due again too
  const daveBalPreIso = userDoc('dave-uid').walletBalance;
  r = await call('GET', '/account/investments', { token: D }); // dave opens HIS OWN page
  await sleep(150);
  check('dave\'s own due payout still settles on his own page load', userDoc('dave-uid').walletBalance === daveBalPreIso + 7500, userDoc('dave-uid').walletBalance - daveBalPreIso);
  check('bob\'s due payout was NOT touched by dave opening his page (no cross-user settlement)',
    userDoc('bob-uid').walletBalance === bobBalPre && bobInv.payoutsMade === 0, { bobBal: userDoc('bob-uid').walletBalance, bobBalPre, bobPayoutsMade: bobInv.payoutsMade });
  r = await call('GET', '/account/investments', { token: B }); // bob opens HIS OWN page next
  await sleep(150);
  check('bob\'s own due payout settles once HE opens his page', userDoc('bob-uid').walletBalance === bobBalPre + 7500, userDoc('bob-uid').walletBalance - bobBalPre);

  console.log('\n── 9. Final payout absorbs the rounding remainder exactly');
  await call('POST', '/admin/deposit', { body: { ...ADMIN, userId: 'dave-uid', amount: 33333, note: 'seed for remainder watch' } });
  r = await call('POST', '/invest/create', { token: D, body: { tierKey: 'watch2' } });
  check('dave buys watch2 (remainder test)', r.body?.status === 'success', r.body);
  const remInv = [...investments().entries()].find(([, v]) => v.userId === 'dave-uid' && v.tierKey === 'watch2')[1];
  check('dailyPayout rounds to 8333 (999990/120)', remInv.dailyPayout === 8333, remInv.dailyPayout);
  // Jump straight to "the whole cycle has elapsed" in one shot.
  remInv.createdAt = new Date(Date.now() - (120 * 24 + 1) * 3600000);
  const daveBalPre4 = userDoc('dave-uid').walletBalance;
  await call('POST', '/admin/check-maturities', { body: ADMIN }); await sleep(300);
  check('paidOut lands EXACTLY on expectedReturn (999990), not a drifted flat sum', remInv.paidOut === 999990, remInv.paidOut);
  check('wallet received exactly the expectedReturn total in this one settlement', userDoc('dave-uid').walletBalance === daveBalPre4 + 999990, userDoc('dave-uid').walletBalance - daveBalPre4);
  check('investment marked matured, not left active forever', remInv.status === 'matured', remInv.status);
  await call('POST', '/admin/check-maturities', { body: ADMIN }); await sleep(200);
  check('a completed investment is never paid again', remInv.paidOut === 999990 && userDoc('dave-uid').walletBalance === daveBalPre4 + 999990, remInv.paidOut);

  console.log('\n── 10. Task Center: milestone reached vs claimed are genuinely different things');
  // Build 5 fresh direct referrals of alice, each becoming "active" (invested).
  const l1DepositTotalBefore = (await call('GET', '/team/stats', { token: A })).body?.l1DepositTotal || 0;
  const memberTokens = [];
  for (let i = 1; i <= 5; i++) {
    const uid = `uid:m${i}-uid`;
    await call('POST', '/account/create-profile', { token: uid, body: { phone: '07710009' + (10 + i) } });
    await call('POST', '/register', { token: uid, body: { referralCode: aliceCode } });
    await call('POST', '/admin/deposit', { body: { ...ADMIN, userId: `m${i}-uid`, amount: 30000, note: 'seed' } });
    memberTokens.push(uid);
  }
  r = await call('GET', '/team/stats', { token: A });
  check('before anyone invests, activeL1Count does not yet include the 5 new members', (r.body?.l1ActiveCount || 0) < 5, r.body?.l1ActiveCount);
  for (const t of memberTokens) await call('POST', '/invest/create', { token: t, body: { tierKey: 'watch1' } });
  r = await call('GET', '/team/stats', { token: A });
  check('l1ActiveCount now includes all 5 newly-active members', (r.body?.l1ActiveCount || 0) >= 5, r.body?.l1ActiveCount);
  const m5 = (r.body?.milestones || []).find(m => m.target === 5);
  check('5-target milestone shows achieved but NOT claimed', m5?.achieved === true && m5?.claimed === false, m5);
  const m10 = (r.body?.milestones || []).find(m => m.target === 10);
  check('10-target milestone NOT achieved yet (only 5+ active)', m10?.achieved === false, m10);

  console.log('\n── 11. Task Center: claim is server-verified, not client-trusted');
  const aliceBalPreClaim = userDoc('alice-uid').walletBalance;
  r = await call('POST', '/team/milestone/claim', { token: B, body: { target: 5 } }); // bob does NOT have 5 active L1s
  check("bob cannot claim a milestone he hasn't reached", r.body?.status !== 'success', r.body);
  r = await call('POST', '/team/milestone/claim', { token: A, body: { target: 7 } }); // not a real tier
  check('claiming a bogus target is rejected', r.body?.status !== 'success', r.body);
  r = await call('POST', '/team/milestone/claim', { token: A, body: { target: 10 } }); // real tier, not yet reached
  check('claiming an unreached real tier is rejected', r.body?.status !== 'success', r.body);
  r = await call('POST', '/team/milestone/claim', { token: A, body: { target: 5 } });
  check('alice claims the reached 5-target milestone for exactly 5000', r.body?.status === 'success' && r.body?.amount === 5000, r.body);
  check('wallet credited by exactly the reward', userDoc('alice-uid').walletBalance === aliceBalPreClaim + 5000, userDoc('alice-uid').walletBalance - aliceBalPreClaim);
  r = await call('POST', '/team/milestone/claim', { token: A, body: { target: 5 } });
  check('claiming the SAME milestone twice is rejected (no double-pay)', r.body?.status !== 'success', r.body);
  check('wallet did not move on the double-claim attempt', userDoc('alice-uid').walletBalance === aliceBalPreClaim + 5000, userDoc('alice-uid').walletBalance);
  r = await call('GET', '/team/stats', { token: A });
  const m5b = (r.body?.milestones || []).find(m => m.target === 5);
  check('/team/stats now reflects the claim (claimed:true)', m5b?.claimed === true, m5b);

  console.log('\n── 11b. Task Center: LEVEL 1 team-DEPOSIT milestones are a separate ladder, also server-verified');
  // alice's 5 L1 members were each admin-credited 30000 above -> l1DepositTotal
  // must have grown by exactly 150,000 from whatever it was before (alice's L1
  // already includes bob/eve from earlier sections, so it isn't starting from 0).
  r = await call('GET', '/team/stats', { token: A });
  check('l1DepositTotal grew by exactly the 5 x 30000 admin credits', r.body?.l1DepositTotal === l1DepositTotalBefore + 150000, { before: l1DepositTotalBefore, after: r.body?.l1DepositTotal });
  const d100k = (r.body?.milestones || []).find(m => m.type === 'deposit' && m.target === 100000);
  check('100,000 deposit-tier shows achieved but NOT claimed', d100k?.achieved === true && d100k?.claimed === false, d100k);
  const d250k = (r.body?.milestones || []).find(m => m.type === 'deposit' && m.target === 250000);
  check('250,000 deposit-tier NOT achieved yet', d250k?.achieved === false, d250k);
  r = await call('POST', '/team/milestone/claim', { token: A, body: { target: 250000, type: 'deposit' } });
  check('claiming an unreached deposit tier is rejected', r.body?.status !== 'success', r.body);
  r = await call('POST', '/team/milestone/claim', { token: A, body: { target: 100000 } }); // no type -> COUNT table, no such tier
  check('the same numeric target without type:"deposit" does not accidentally match the count ladder', r.body?.status !== 'success', r.body);
  const aliceBalPreDepClaim = userDoc('alice-uid').walletBalance;
  r = await call('POST', '/team/milestone/claim', { token: A, body: { target: 100000, type: 'deposit' } });
  check('alice claims the 100,000 deposit-tier for exactly 1000', r.body?.status === 'success' && r.body?.amount === 1000, r.body);
  check('wallet credited by exactly the deposit-tier reward', userDoc('alice-uid').walletBalance === aliceBalPreDepClaim + 1000, userDoc('alice-uid').walletBalance - aliceBalPreDepClaim);
  r = await call('POST', '/team/milestone/claim', { token: A, body: { target: 100000, type: 'deposit' } });
  check('claiming the SAME deposit-tier twice is rejected (no double-pay)', r.body?.status !== 'success', r.body);
  check('wallet did not move on the double-claim attempt', userDoc('alice-uid').walletBalance === aliceBalPreDepClaim + 1000, userDoc('alice-uid').walletBalance);
  r = await call('GET', '/team/stats', { token: A });
  const m5c = (r.body?.milestones || []).find(m => m.type === 'count' && m.target === 5);
  check('the earlier COUNT-tier claim is untouched by the deposit-tier claims (separate claim flags)', m5c?.claimed === true, m5c);

  console.log('\n── 12. Balance-tab capstone: the ledger recount matches the live counters EXACTLY');
  // Everything above moved money through commissions, cashback, milestones and
  // deposits via their normal incremental updates. Independently rebuilding
  // every counter from the raw transactions ledger (the same rebuild the admin
  // panel's "Users" recount button runs) must land on IDENTICAL numbers — any
  // mismatch here means some code path is updating a counter incorrectly.
  const before = {};
  for (const uid of ['alice-uid', 'bob-uid', 'carol-uid', 'dave-uid', 'eve-uid']) {
    const u = userDoc(uid);
    before[uid] = { totalEarned: u.totalEarned || 0, commissionEarned: u.commissionEarned || 0,
      commissionL1Earned: u.commissionL1Earned || 0, commissionL2Earned: u.commissionL2Earned || 0,
      commissionL3Earned: u.commissionL3Earned || 0, totalDeposited: u.totalDeposited || 0 };
  }
  r = await call('POST', '/admin/users/recount', { body: ADMIN });
  check('recount endpoint runs successfully', r.body?.status === 'success', r.body);
  let allMatch = true; const mismatches = [];
  for (const uid of ['alice-uid', 'bob-uid', 'carol-uid', 'dave-uid', 'eve-uid']) {
    const u = userDoc(uid);
    const after = { totalEarned: u.totalEarned || 0, commissionEarned: u.commissionEarned || 0,
      commissionL1Earned: u.commissionL1Earned || 0, commissionL2Earned: u.commissionL2Earned || 0,
      commissionL3Earned: u.commissionL3Earned || 0, totalDeposited: u.totalDeposited || 0 };
    if (JSON.stringify(before[uid]) !== JSON.stringify(after)) { allMatch = false; mismatches.push({ uid, before: before[uid], after }); }
  }
  check('every counter matches its ledger-rebuilt value exactly (zero drift)', allMatch, mismatches);

  console.log('\n── 13. Team counts (LV1/LV2/LV3) are recount-verified against the live referral graph');
  // teamL1/L2/L3Count are otherwise pure increment/decrement counters with no
  // independent source of truth. Recount must rebuild them from referredBy
  // itself. Expected shape at this point: alice ← bob ← carol ← dave, plus
  // eve + m1..m5 all directly under alice.
  check("alice's L1 = bob, eve, m1..m5 (7)", userDoc('alice-uid').teamL1Count === 7, userDoc('alice-uid').teamL1Count);
  check("alice's L2 = carol (bob's referral) (1)", userDoc('alice-uid').teamL2Count === 1, userDoc('alice-uid').teamL2Count);
  check("alice's L3 = dave (carol's referral) (1)", userDoc('alice-uid').teamL3Count === 1, userDoc('alice-uid').teamL3Count);
  check("bob's L1 = carol (1)", userDoc('bob-uid').teamL1Count === 1, userDoc('bob-uid').teamL1Count);
  check("bob's L2 = dave (1)", userDoc('bob-uid').teamL2Count === 1, userDoc('bob-uid').teamL2Count);
  check("carol's L1 = dave (1)", userDoc('carol-uid').teamL1Count === 1, userDoc('carol-uid').teamL1Count);

  console.log('\n── 14. A deleted referrer never leaves a commission stuck retrying forever');
  const F = 'uid:frank-uid', G = 'uid:gina-uid';
  await call('POST', '/account/create-profile', { token: F, body: { phone: '0771000090' } });
  await call('POST', '/register', { token: F, body: { referralCode: '' } });
  const frankCode = userDoc('frank-uid').referralCode;
  await call('POST', '/account/create-profile', { token: G, body: { phone: '0771000091' } });
  await call('POST', '/register', { token: G, body: { referralCode: frankCode } });
  check('gina registered under frank', userDoc('gina-uid').referredBy === 'frank-uid', userDoc('gina-uid').referredBy);
  r = await call('POST', '/admin/user/delete', { body: { ...ADMIN, userId: 'frank-uid', confirm: 'DELETE' } });
  check('frank (the referrer) is deleted', r.body?.status === 'success', r.body);
  check("gina's referredBy still points at the now-deleted frank", userDoc('gina-uid').referredBy === 'frank-uid');
  const ginaDepId = await realDeposit(G, 40000, '0771000091');
  r = await call('POST', '/admin/commissions/reconcile', { body: ADMIN });
  check('reconcile does not error out on the dangling deleted referrer', r.body?.status === 'success', r.body);
  check('the deposit is marked commDone (terminal — stops being retried forever)', deposits().get(ginaDepId).commDone === true, deposits().get(ginaDepId).commDone);
  check("gina's own deposit still credited normally despite the dead referrer", userDoc('gina-uid').walletBalance === 5000 + 40000, userDoc('gina-uid').walletBalance);
  r = await call('POST', '/admin/commissions/reconcile', { body: ADMIN });
  check('re-running reconcile again is a clean no-op, not an infinite retry', r.body?.status === 'success', r.body);

  console.log('\n── 15. Welcome-bonus retry safety: a repeated /register can never re-credit or duplicate the ledger row');
  // Real production bug found via the Integrity Audit: the OLD code wrote the
  // "Welcome gift" transaction row BEFORE the user doc's registrationDone +
  // wallet credit, inside a batch that applies sequentially with no rollback
  // (M0 has no real transactions). A process restart landing between those
  // two writes (exactly what several redeploys in one day risk) left a
  // "Welcome gift" ledger row with registrationDone still false; a retried
  // /register call (the client, or the documented boot self-heal) then ran
  // the WHOLE flow again, writing a SECOND Welcome-gift row once it finally
  // succeeded — ledger over-counted by one welcome bonus per orphaned
  // attempt, wallet only ever credited once. Fixed by writing the user's own
  // doc FIRST, so an interruption always leaves the user paid; this proves a
  // retry after that reorder is now a safe, silent no-op.
  const H = 'uid:henry-uid';
  await call('POST', '/account/create-profile', { token: H, body: { phone: '0771000092' } });
  r = await call('POST', '/register', { token: H, body: { referralCode: '' } });
  check('henry registers normally, welcome bonus 5000', r.body?.status === 'success' && r.body?.welcomeBonus === 5000, r.body);
  check('exactly ONE "Welcome gift" transaction row exists', countTx('henry-uid', 'admin_credit') === 1, countTx('henry-uid', 'admin_credit'));
  check('wallet shows exactly one welcome credit', userDoc('henry-uid').walletBalance === 5000, userDoc('henry-uid').walletBalance);
  // Directly simulate the failure this fix targets: a process restart landing
  // between the two writes means the "Welcome gift" ledger row never actually
  // gets written, even though registrationDone + the wallet credit (the SAME
  // single batch op under the fix) already fully landed. Deleting the row
  // here reproduces exactly that end state without needing to kill the
  // process mid-batch.
  const henryTxId = [...txns().entries()].find(([, t]) => t.userId === 'henry-uid' && t.type === 'admin_credit')[0];
  txns().delete(henryTxId);
  check('(simulated) the Welcome-gift ledger row is now missing, as an interrupted batch would leave it', countTx('henry-uid', 'admin_credit') === 0, countTx('henry-uid', 'admin_credit'));
  check('the wallet credit is UNAFFECTED — it was written in the same op as registrationDone, not the missing one', userDoc('henry-uid').walletBalance === 5000, userDoc('henry-uid').walletBalance);
  r = await call('POST', '/register', { token: H, body: { referralCode: '' } });
  check('a retried /register — even with the ledger row missing — is recognised as already done, not re-run', r.body?.status === 'already_done', r.body);
  check('the retry did NOT grant a second welcome bonus on top of the one already paid', userDoc('henry-uid').walletBalance === 5000, userDoc('henry-uid').walletBalance);
  check('the retry did NOT resurrect or duplicate the ledger row (missing history line stays cosmetic, never compounds)', countTx('henry-uid', 'admin_credit') === 0, countTx('henry-uid', 'admin_credit'));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('SUITE CRASH:', e); process.exit(1); });
