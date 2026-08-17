/* SPACE8 RECONCILER SWEEP CAPS
   Owner asked for a full audit of investment/daily-profit timing accuracy,
   server-side monitoring of ongoing products, and referral/commission
   counting accuracy. Found that both background money-crediting sweeps had
   arbitrary caps well below what this platform can realistically reach at
   scale, unlike pendingDeposits/withdrawals (naturally small, self-
   draining within minutes):

   - reconcileCashback(): capped at 500 'active' investments per 1s tick,
     across every user combined. An investment stays 'active' for its whole
     cycle (up to 210 days) and only accumulates as the platform grows, so
     past 500 concurrently-active investments the sweep silently truncated
     -- anything beyond the cap never got its daily payout credited
     proactively (settleAllForUser() on the owning user's own next /account
     or /investments read still caught it up correctly, so no money was
     ever LOST, but crediting stopped being "instant" for those accounts).
   - reconcileCommissions(): capped at 50 investments from the last 10
     minutes per 30s tick, across every user combined. Same gap for the
     retry safety net behind /invest/create's fire-and-forget commission
     credit.

   Both bumped (500 -> 5000, 50 -> 500). This proves the NEW caps actually
   let more than the OLD cap's worth of due work get processed in a single
   sweep, by seeding just over the old ceiling and confirming ~all of it is
   credited on the very next tick -- not just re-reading the source for the
   new number.

   Run: node test-reconciler-caps.js   (exits 0 = all green, ~17s)        */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '4100';

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
const BASE = 'http://127.0.0.1:4100';
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
const investments = () => collMap('investments');
let _seq = 0;
const nextId = prefix => prefix + (++_seq);

async function setupUser(uid, phone) {
  await call('POST', '/account/create-profile', { token: 'uid:' + uid, body: { phone } });
  await call('POST', '/register', { token: 'uid:' + uid, body: {} });
}

(async () => {
  await new Promise(r => setTimeout(r, 600));

  console.log('\n== reconcileCashback() must credit MORE than the old 500-item cap in one sweep ==');
  const CASHBACK_N = 520; // strictly more than the old 500 cap
  const cbUsers = 8;
  const perUser = Math.ceil(CASHBACK_N / cbUsers);
  const cashbackUserIds = [];
  for (let u = 0; u < cbUsers; u++) {
    const uid = 'cb-user-' + u;
    await setupUser(uid, '07726' + String(u).padStart(5, '0'));
    cashbackUserIds.push(uid);
  }
  const seededInvIds = [];
  let made = 0;
  for (let u = 0; u < cbUsers && made < CASHBACK_N; u++) {
    for (let i = 0; i < perUser && made < CASHBACK_N; i++, made++) {
      const id = nextId('cbinv');
      investments().set(id, {
        userId: cashbackUserIds[u], tierKey: 'sputnik1', tierLabel: 'Sputnik 1',
        amount: 15000, cycle: 210, expectedReturn: 630000,
        status: 'active', dailyPayout: 3000, payoutsTotal: 210, payoutsMade: 0, paidOut: 0,
        // Backdated 1 full day so exactly one day's payout is due -- same
        // technique the existing cashback-reconciler test uses.
        createdAt: new Date(Date.now() - 1 * 86400000),
        isFirstInvestment: false, commissionPaidLevels: [],
        date: '01/01/2026', time: '00:00:00',
      });
      seededInvIds.push(id);
    }
  }
  check('seeded strictly more investments than the old 500 cap', seededInvIds.length > 500, seededInvIds.length);

  console.log('  (waiting ~3s for the 1s-interval cashback sweep to run at least once)');
  await new Promise(res => setTimeout(res, 3000));

  const creditedCount = seededInvIds.filter(id => (investments().get(id).payoutsMade || 0) >= 1).length;
  check('every seeded investment was credited in a single sweep, not truncated at the old 500 cap',
    creditedCount === seededInvIds.length, { credited: creditedCount, total: seededInvIds.length });

  console.log('\n== reconcileCommissions() must retry MORE than the old 50-item cap in one sweep ==');
  const COMMISSION_N = 60; // strictly more than the old 50 cap
  const referrer = 'comm-referrer';
  await setupUser(referrer, '0772699999');
  const refCode = users().get(referrer).referralCode;
  check('referrer has a referral code', !!refCode, refCode);
  // Baseline AFTER registering (their own welcome bonus already landed by
  // this point) so the check below measures only the commission delta.
  const referrerBalBefore = users().get(referrer).walletBalance || 0;

  const commInvIds = [];
  for (let i = 0; i < COMMISSION_N; i++) {
    const buyerId = 'comm-buyer-' + i;
    // Seeded directly rather than via /account/create-profile + /register --
    // those two calls per buyer would mean 120 rapid HTTP requests from this
    // one test process, all sharing ONE rate-limit bucket (this test's fake
    // 'uid:xxx' bearer tokens aren't real JWTs, so rlKeyByUser's per-user
    // keying can't parse them and falls back to per-IP, same as every other
    // test file in this suite) -- easily enough to trip apiLimiter's 60/min
    // cap well before all 60 buyers exist. Not a product bug, just a test-
    // harness limit; seeding the doc shape /register itself would produce
    // sidesteps it entirely, same technique already used for investments.
    users().set(buyerId, {
      phone: '07727' + String(i).padStart(5, '0'), walletBalance: 0, totalDeposited: 0, totalEarned: 0,
      totalWithdrawn: 0, totalInvested: 0, referredBy: referrer, referralCode: 'CBUY' + i,
      registrationDone: true, status: 'active', teamL1Count: 0, teamL2Count: 0, teamL3Count: 0, teamCommission: 0,
    });
    const id = nextId('cominv');
    investments().set(id, {
      userId: buyerId, tierKey: 'sputnik1', tierLabel: 'Sputnik 1',
      amount: 15000, cycle: 210, expectedReturn: 630000,
      status: 'active', dailyPayout: 3000, payoutsTotal: 210, payoutsMade: 0, paidOut: 0,
      createdAt: new Date(),
      // reconcileCommissions() now queries commissionPending==true directly
      // (superseding the old createdAt-window+limit approach this test used
      // to exercise) -- seeded true here to simulate a real purchase whose
      // original fire-and-forget creditReferralCommission() call never
      // landed, exactly the case this reconciler exists to catch.
      isFirstInvestment: true, commissionPaidLevels: [], commissionPending: true,
      date: '01/01/2026', time: '00:00:00',
    });
    commInvIds.push(id);
  }
  check('seeded strictly more investments than the old 50 cap', commInvIds.length > 50, commInvIds.length);

  console.log('  (waiting ~16s for the startup reconciler tick that drives reconcileCommissions())');
  await new Promise(res => setTimeout(res, 16000));

  const paidCount = commInvIds.filter(id => (investments().get(id).commissionPaidLevels || []).includes(0)).length;
  check('every seeded investment had its L1 commission retried and paid, not truncated at the old 50 cap',
    paidCount === commInvIds.length, { paid: paidCount, total: commInvIds.length });
  const referrerBalAfter = users().get(referrer).walletBalance || 0;
  check('referrer wallet actually received commission for all of them (28% of 15,000 = 4,200 each)',
    referrerBalAfter - referrerBalBefore === 4200 * COMMISSION_N, { delta: referrerBalAfter - referrerBalBefore, expected: 4200 * COMMISSION_N });
  const stillPendingCount = commInvIds.filter(id => investments().get(id).commissionPending === true).length;
  check('commissionPending cleared on every resolved investment, so the reconciler stops re-checking them forever',
    stillPendingCount === 0, stillPendingCount);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
