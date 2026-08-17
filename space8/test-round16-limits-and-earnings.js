/* SPACE8 ROUND 16 — AMOUNT/PHONE CAPS, ADMIN TOTAL POISONING, CUMULATIVE EARNINGS
   Covers the owner's "limit everything to prevent overrides and glitch" round:

   1. /deposit/marzpay and /withdraw/request now reject any amount over
      MAX_MONEY_AMOUNT (999,999,999 — 9 digits), server-side, independent of
      the client's new maxlength="9" inputs (which a direct API call bypasses
      entirely).
   2. The admin dashboard's (/admin/stats) aggregation loop used to do a bare
      `total += u.totalInvested` — if even one stored user field was ever a
      STRING (leftover from the historical totalInvested string-concat
      corruption), `+=` silently coerced the WHOLE running total to a string
      from that account onward, producing an absurd figure for every
      following user. Now Number()-coerces each addend.
   3. "Cumulative Earnings" (totalEarned) previously only ever moved on
      maturity/cashback payout and Task Center rewards. Check-in bonus and
      referral commission credited the wallet but silently never counted
      toward it, and gift-code redemption did the same. All three now also
      increment totalEarned.
   4. /admin/users/recount (the "Recalculate totals" admin tool) rebuilds
      totalEarned from transaction history — it used to only sum 'cashback'
      transactions, which would have UNDONE fix #3 for every existing user
      the very next time an admin clicked recalculate. Now sums all 5
      earning transaction types.

   Run: node test-round16-limits-and-earnings.js   (exits 0 = all green)   */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '4099';

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
global.fetch = async (url, opts) => {
  const u = String(url);
  const json = body => ({ ok: true, status: 200, json: async () => body });
  if (u.includes('wearemarz.com') && u.endsWith('/collect-money')) {
    return json({ status: 'success', data: { transaction: { uuid: 'RTX-' + Date.now(), status: 'pending' } } });
  }
  if (u.includes('wearemarz.com') && u.includes('/collect-money/')) {
    return json({ status: 'success', data: { transaction: { status: 'successful' } } });
  }
  return realFetch(url, opts);
};

require('./server.js');

const BASE = 'http://127.0.0.1:4099';
async function call(method, p, { token, body, admin } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (admin) headers.Authorization = 'Bearer test-admin-key';
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
async function setupUser(uid, phone) {
  await call('POST', '/account/create-profile', { token: 'uid:' + uid, body: { phone } });
  await call('POST', '/register', { token: 'uid:' + uid, body: {} });
}

(async () => {
  await new Promise(r => setTimeout(r, 600));

  console.log('\n== /deposit/marzpay rejects amounts over the 9-digit cap ==');
  const dep = 'r16-dep';
  await setupUser(dep, '0771600001');
  let r = await call('POST', '/deposit/marzpay', { token: 'uid:' + dep, body: { amount: 9999999990, phone: '0771600001', network: 'MTN Mobile Money' } });
  check('10-digit amount rejected (400)', r.code === 400 && r.body?.status === 'error', r.body);
  r = await call('POST', '/deposit/marzpay', { token: 'uid:' + dep, body: { amount: 999999999, phone: '0771600001', network: 'MTN Mobile Money' } });
  check('exactly 999,999,999 (max) accepted', r.body?.status === 'success', r.body);

  console.log('\n== /withdraw/request rejects amounts over the 9-digit cap ==');
  const wit = 'r16-wit';
  await setupUser(wit, '0771600002');
  users().get(wit).walletBalance = 5_000_000_000;
  await call('POST', '/bank/save', { token: 'uid:' + wit, body: { holder: 'Round16 Tester', network: 'MTN Mobile Money', phone: '0771600002' } });
  const bankId = [...collMap('bankAccounts').entries()].find(([, v]) => v.userId === wit)?.[0];
  r = await call('POST', '/withdraw/request', { token: 'uid:' + wit, body: { amount: 9999999990, holder: 'Round16 Tester', network: 'MTN Mobile Money', phone: '0771600002', pin: '1234' } });
  check('10-digit withdrawal amount rejected (400)', r.code === 400 && r.body?.status === 'error', r.body);

  console.log('\n== Admin dashboard total is immune to one user\'s string-poisoned field ==');
  const p1 = 'r16-poison-1', p2 = 'r16-poison-2';
  await setupUser(p1, '0771600003');
  await setupUser(p2, '0771600004');
  // Simulate a legacy-corrupted account: totalInvested stored as a STRING
  // (exactly what the historical string-concat bug left behind).
  users().get(p1).totalInvested = '500000';
  users().get(p2).totalInvested = 300000;
  r = await call('GET', '/admin/stats', { admin: true });
  check('admin/stats responds success', r.body?.status === 'success', r.body);
  check('totalInvested stays a real sane number, not a poisoned concatenated string',
    typeof r.body?.totalInvested === 'number' && r.body.totalInvested >= 800000 && r.body.totalInvested < 10_000_000,
    r.body?.totalInvested);

  console.log('\n== Cumulative Earnings (totalEarned) now includes check-in, referral commission, gift code ==');
  const referrer = 'r16-referrer', buyer = 'r16-buyer';
  await setupUser(referrer, '0771600005');
  await setupUser(buyer, '0771600006');
  const refCode = users().get(referrer).referralCode;
  check('referrer has a referral code', !!refCode, refCode);

  const earnedBefore = users().get(referrer).totalEarned || 0;
  r = await call('POST', '/checkin', { token: 'uid:' + referrer });
  check('check-in succeeded', r.body?.status === 'success', r.body);
  const earnedAfterCheckin = users().get(referrer).totalEarned || 0;
  check('totalEarned increased by the check-in bonus', earnedAfterCheckin > earnedBefore, { earnedBefore, earnedAfterCheckin });

  // Let buyer make their first purchase (tiers are hardcoded server-side,
  // not DB-seeded) so creditReferralCommission() fires for the referrer.
  users().get(buyer).walletBalance = 5_000_000;
  users().get(buyer).referredBy = referrer;
  const earnedBeforeCommission = users().get(referrer).totalEarned || 0;
  r = await call('POST', '/invest/create', { token: 'uid:' + buyer, body: { tierKey: 'sputnik1' } });
  check('buyer investment succeeded', r.body?.status === 'success', r.body);
  await new Promise(res => setTimeout(res, 300));
  const earnedAfterCommission = users().get(referrer).totalEarned || 0;
  check('totalEarned increased from referral commission', earnedAfterCommission > earnedBeforeCommission, { earnedBeforeCommission, earnedAfterCommission });

  console.log('\n== Gift code redemption also credits totalEarned ==');
  const giftUser = 'r16-gift';
  await setupUser(giftUser, '0771600007');
  collMap('promoCodes').set('gc1', { code: 'ABCDE', active: true, usedBy: [], maxUses: 5, reward: 12345 });
  const earnedBeforeGift = users().get(giftUser).totalEarned || 0;
  r = await call('POST', '/redeem', { token: 'uid:' + giftUser, body: { code: 'ABCDE' } });
  check('gift code redeemed', r.body?.status === 'success', r.body);
  const earnedAfterGift = users().get(giftUser).totalEarned || 0;
  check('totalEarned increased by exactly the gift code reward', earnedAfterGift === earnedBeforeGift + 12345, { earnedBeforeGift, earnedAfterGift });

  console.log('\n== /admin/users/recount rebuilds totalEarned from ALL 5 earning transaction types, not just cashback ==');
  const rc = 'r16-recount';
  await setupUser(rc, '0771600008');
  // Corrupt the stored totalEarned so the recount is forced to actually
  // recompute it from the transaction ledger, not just leave it alone.
  users().get(rc).totalEarned = 999999999;
  collMap('transactions').set('t1', { userId: rc, type: 'checkin', amount: 500, createdAt: new Date() });
  collMap('transactions').set('t2', { userId: rc, type: 'commission', amount: 1000, createdAt: new Date() });
  collMap('transactions').set('t3', { userId: rc, type: 'team_reward', amount: 2000, createdAt: new Date() });
  collMap('transactions').set('t4', { userId: rc, type: 'promocode', amount: 3000, createdAt: new Date() });
  collMap('transactions').set('t5', { userId: rc, type: 'cashback', amount: 4000, createdAt: new Date() });
  r = await call('GET', '/admin/users/recount', { admin: true });
  check('recount succeeded', r.body?.status === 'success', r.body);
  const recomputed = users().get(rc).totalEarned;
  check('totalEarned recomputed as the sum of all 5 earning transaction types (500+1000+2000+3000+4000=10500)', recomputed === 10500, recomputed);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
