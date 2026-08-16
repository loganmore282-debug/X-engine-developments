/* SPACE8 CHECK-IN SELF-HEALING (live endpoint, not the admin tool)
   Owner kept seeing the streak stuck at 1 despite claiming several days in
   a row, and asked the server itself to reconcile by looking at the real
   check-in records -- not just via a manual admin button.

   /checkin used to trust the user doc's own checkinStreak/lastCheckin
   fields outright. If those ever went stale or got corrupted by ANY past
   issue -- a bad write, hand-edited data, a since-fixed bug -- every
   future check-in would keep computing off the wrong baseline forever,
   with no way to recover except an admin manually running the recount
   tool. Fixed by having /checkin itself recompute the true streak from
   real 'checkin' transactions on every single call, before deciding
   whether today continues or resets it -- self-healing, no admin action
   required, ever.

   Boots the REAL server.js against an in-memory mock database and proves,
   calling ONLY the live /checkin endpoint (never /admin/users/recount):
     - a user whose STORED checkinStreak is wildly wrong (e.g. 1, or 99)
       but whose real transaction history shows 4 genuine consecutive days
       ending yesterday still correctly continues to 5 today -- the live
       endpoint reads real history itself, not the corrupted field
     - a user whose stored lastCheckin falsely claims "yesterday" but has
       NO real check-in transactions at all correctly starts at streak 1,
       not some inflated number
     - a user with a genuine unbroken real history (nothing corrupted)
       continues to increment normally -- this fix doesn't break the
       ordinary case
     - the corrected checkinStreak actually gets WRITTEN back to the user
       doc (so it stays fixed, not just correct for one response)
     - wallet balance is credited exactly once per real check-in, same as
       always -- this is a pure streak-counting fix, not a money change

   Run: node test-checkin-self-heal.js   (exits 0 = all green)            */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '4153';

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

const BASE = 'http://127.0.0.1:4153';
async function call(method, p, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await fetch(BASE + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
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
const txs = () => collMap('transactions');
let txN = 0;
// Noon on the EAT (UTC+3) calendar day `daysAgo` days back, returned as the
// real UTC instant that corresponds to it.
//
// This used to anchor to the UTC calendar day (`new Date()` then
// setUTCHours(12)), which silently disagrees with the server for the three
// hours between 00:00 and 03:00 EAT -- during that window the UTC date is
// still the previous day, so every fixture landed one day earlier than
// intended and streak-continuation assertions failed. That made the whole
// check-in suite go red every night between 21:00 and 24:00 UTC and green
// again afterwards. The server keys check-in days off eatNow() (UTC+3), so
// the fixtures have to be built on that same calendar.
function eatNoon(daysAgo) {
  const e = new Date(Date.now() + 3 * 3600000); // EAT wall clock
  e.setUTCHours(12, 0, 0, 0);                   // noon on the EAT calendar day
  e.setUTCDate(e.getUTCDate() - daysAgo);       // step back whole EAT days
  return new Date(e.getTime() - 3 * 3600000);   // EAT wall clock -> UTC instant
}
function addCheckinTx(uid, daysAgo) {
  txs().set('sh-tx-' + (++txN), { userId: uid, type: 'checkin', amount: 500, description: 'Daily reward', createdAt: eatNoon(daysAgo) });
}
async function createProfile(uid, phone) {
  await call('POST', '/account/create-profile', { token: 'uid:' + uid, body: { phone } });
  await call('POST', '/register', { token: 'uid:' + uid, body: {} });
}

(async () => {
  await sleep(600);

  console.log('\n== A user whose STORED streak is wildly wrong, but real history shows 4 real consecutive days ending yesterday ==');
  const A = 'sh-a';
  await createProfile(A, '0771980001');
  addCheckinTx(A, 4); addCheckinTx(A, 3); addCheckinTx(A, 2); addCheckinTx(A, 1); // 4 real days, ending yesterday
  // Corrupt the stored fields directly -- exactly the "still counting 1"
  // bug: a stale/wrong number sitting on the account, never touched by
  // any admin tool before this check-in happens.
  users().get(A).checkinStreak = 1;
  users().get(A).lastCheckin = '01/01/2020';

  let r = await call('POST', '/checkin', { token: 'uid:' + A });
  check('check-in succeeds', r.body?.status === 'success', r.body);
  check('streak correctly continues to 5 (4 real days + today), NOT reset to 1 from the corrupted stored value', r.body?.streak === 5, r.body);
  check('the corrected streak is actually written back to the user doc', users().get(A).checkinStreak === 5, users().get(A));

  console.log('\n== A user whose stored lastCheckin FALSELY claims "yesterday" but has zero real check-in transactions ==');
  const B = 'sh-b';
  await createProfile(B, '0771980002');
  const yesterdayFmt = (() => { const d = eatNoon(1); const p = n => String(n).padStart(2, '0'); return p(d.getUTCMonth() + 1) + '/' + p(d.getUTCDate()) + '/' + d.getUTCFullYear(); })();
  users().get(B).checkinStreak = 30; // a fabricated/corrupted high streak
  users().get(B).lastCheckin = yesterdayFmt; // claims yesterday, but no real transaction backs it up

  r = await call('POST', '/checkin', { token: 'uid:' + B });
  check('check-in succeeds', r.body?.status === 'success', r.body);
  check('streak correctly starts at 1 -- the claimed "yesterday" has no real check-in behind it, so it can\'t be trusted', r.body?.streak === 1, r.body);
  check('written back correctly, not left at the fabricated 30', users().get(B).checkinStreak === 1, users().get(B));

  console.log('\n== A user with a genuine, unbroken real history (nothing corrupted) still increments normally ==');
  const C = 'sh-c';
  await createProfile(C, '0771980003');
  addCheckinTx(C, 6); addCheckinTx(C, 5); addCheckinTx(C, 4); addCheckinTx(C, 3); addCheckinTx(C, 2); addCheckinTx(C, 1);
  users().get(C).checkinStreak = 6; // correctly matches real history
  const cLastCheckinFmt = (() => { const d = eatNoon(1); const p = n => String(n).padStart(2, '0'); return p(d.getUTCMonth() + 1) + '/' + p(d.getUTCDate()) + '/' + d.getUTCFullYear(); })();
  users().get(C).lastCheckin = cLastCheckinFmt;

  r = await call('POST', '/checkin', { token: 'uid:' + C });
  check('ordinary correct case: continues to 7, unaffected by the self-heal logic', r.body?.streak === 7, r.body);

  console.log('\n== Wallet is credited exactly once per real check-in -- this is a streak-counting fix, not a money change ==');
  const D = 'sh-d';
  await createProfile(D, '0771980004'); // registration itself may also credit a welcome bonus -- capture balance AFTER that, before checkin
  const balBeforeD = users().get(D).walletBalance;
  r = await call('POST', '/checkin', { token: 'uid:' + D });
  check('fresh user check-in succeeds', r.body?.status === 'success', r.body);
  check('wallet increased by exactly the daily bonus amount, once', users().get(D).walletBalance === balBeforeD + r.body.bonus, { before: balBeforeD, after: users().get(D).walletBalance, bonus: r.body.bonus });
  check('exactly one checkin transaction recorded', [...txs().values()].filter(t => t.userId === D && t.type === 'checkin').length === 1, null);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
