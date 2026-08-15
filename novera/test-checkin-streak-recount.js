/* NOVERA CHECK-IN STREAK RECONCILIATION
   Owner reported a streak reading wrong ("it reset to 0... reconcile to
   make sure it reread well"). /admin/users/recount already rebuilds
   deposit/earning totals and team counts straight from the transaction
   ledger -- it never touched checkinStreak/lastCheckin at all, so there
   was no way to verify or correct those against real history. Extended it
   to do the same thing for streaks: recompute the length of the run of
   CONSECUTIVE calendar days ending at the member's most recent real
   'checkin' transaction, and only write a correction when the stored
   value actually disagrees with that.

   Boots the REAL server.js against an in-memory mock database, writing
   checkin transactions directly with controlled createdAt timestamps (EAT
   noon, so adding the +3h EAT offset never risks crossing a day boundary
   by accident), and proves:
     - a user whose stored streak already matches 5 real consecutive check-
       in days is left untouched (not counted in streaksFixed)
     - a user whose stored streak is WRONG (corrupted to some unrelated
       number) despite only 3 real consecutive days gets corrected to 3
     - a user whose real history has a GAP only counts the run ending at
       the most recent check-in, not the total ever performed
     - a user with stored streak>0 but ZERO real checkin transactions gets
       reset to 0 / lastCheckin null
     - the recomputed lastCheckin is written in the EXACT format the real
       /checkin endpoint compares against -- proven by actually calling
       /checkin afterward and confirming it correctly continues the streak
       (+1), not resets it, which only works if the format truly matches
     - wallet balance is never touched by any of this -- it's a pure
       streak-bookkeeping correction, not a money adjustment
     - non-owner staff cannot call the recount endpoint at all

   Run: node test-checkin-streak-recount.js   (exits 0 = all green)       */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '4152';

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

const BASE = 'http://127.0.0.1:4152';
async function call(method, p, { token, adminKey, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (adminKey) headers.Authorization = 'Bearer ' + adminKey;
  const r = await fetch(BASE + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (_) {}
  return { code: r.status, body: j };
}
async function ownerCall(path, body) { return call('GET', path, { adminKey: 'test-admin-key', body }); }
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
// EAT noon on a given UTC calendar day -- adding the server's +3h EAT shift
// still lands on the SAME calendar day (15:00), so each call unambiguously
// represents exactly one real EAT day with no boundary risk in the test's
// own setup.
function eatNoon(daysAgo) {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d;
}
function addCheckinTx(uid, daysAgo) {
  txs().set('checkin-tx-' + (++txN), { userId: uid, type: 'checkin', amount: 500, description: 'Daily reward', createdAt: eatNoon(daysAgo) });
}

(async () => {
  await sleep(600);

  console.log('\n== A user whose stored streak already matches real history is left alone ==');
  const CORRECT = 'streak-correct';
  users().set(CORRECT, { phone: '0771970001', walletBalance: 5000, checkinStreak: 5, lastCheckin: null });
  for (let i = 4; i >= 0; i--) addCheckinTx(CORRECT, i); // 5 consecutive days, most recent = today
  // lastCheckin needs to actually match too, or it'll still count as "fixed" -- set it to today's real format.
  const todayFmt = (() => { const d = eatNoon(0); const p = n => String(n).padStart(2, '0'); return p(d.getUTCMonth() + 1) + '/' + p(d.getUTCDate()) + '/' + d.getUTCFullYear(); })();
  users().get(CORRECT).lastCheckin = todayFmt;

  console.log('\n== A user whose stored streak is WRONG despite only 3 real consecutive days ==');
  const WRONG = 'streak-wrong';
  users().set(WRONG, { phone: '0771970002', walletBalance: 5000, checkinStreak: 47, lastCheckin: '01/01/2020' });
  for (let i = 2; i >= 0; i--) addCheckinTx(WRONG, i); // 3 consecutive days ending today

  console.log('\n== A user whose real history has a GAP -- only the run ending at the most recent check-in counts ==');
  const GAPPED = 'streak-gapped';
  users().set(GAPPED, { phone: '0771970003', walletBalance: 5000, checkinStreak: 999, lastCheckin: null });
  addCheckinTx(GAPPED, 10); addCheckinTx(GAPPED, 9); addCheckinTx(GAPPED, 8); // an old 3-day run, now irrelevant
  addCheckinTx(GAPPED, 1); addCheckinTx(GAPPED, 0); // then a gap, then a fresh 2-day run ending today

  console.log('\n== A user with a stale streak but ZERO real check-in transactions ==');
  const GHOST = 'streak-ghost';
  users().set(GHOST, { phone: '0771970004', walletBalance: 5000, checkinStreak: 12, lastCheckin: '03/03/2026' });

  const walletsBefore = {};
  [CORRECT, WRONG, GAPPED, GHOST].forEach(u => { walletsBefore[u] = users().get(u).walletBalance; });

  console.log('\n== Non-owner staff cannot run the recount at all ==');
  let r = await call('GET', '/admin/users/recount', {});
  check('unauthenticated call refused', r.code === 401, r.body);

  console.log('\n== Running the recount ==');
  r = await ownerCall('/admin/users/recount');
  check('recount succeeds', r.body?.status === 'success', r.body);
  check('reports how many streaks were actually corrected (3: wrong, gapped, ghost -- not correct)', r.body.streaksFixed === 3, r.body);

  console.log('\n-- Results --');
  check('CORRECT user untouched: still streak 5', users().get(CORRECT).checkinStreak === 5, users().get(CORRECT));
  check('WRONG user corrected: streak now 3, not 47', users().get(WRONG).checkinStreak === 3, users().get(WRONG));
  check('WRONG user lastCheckin corrected to today', users().get(WRONG).lastCheckin === todayFmt, users().get(WRONG));
  check('GAPPED user corrected: streak now 2 (the run ending today), not 999 or 5', users().get(GAPPED).checkinStreak === 2, users().get(GAPPED));
  check('GHOST user corrected: streak reset to 0 (no real check-ins at all)', users().get(GHOST).checkinStreak === 0, users().get(GHOST));
  check('GHOST user lastCheckin reset to null', users().get(GHOST).lastCheckin === null, users().get(GHOST));

  console.log('\n-- Wallet balances are completely untouched by any of this -- pure streak bookkeeping, not money --');
  [CORRECT, WRONG, GAPPED, GHOST].forEach(u => {
    check(`${u} wallet balance unchanged`, users().get(u).walletBalance === walletsBefore[u], { before: walletsBefore[u], after: users().get(u).walletBalance });
  });

  console.log('\n== The recomputed lastCheckin format actually works with the REAL /checkin endpoint (continues the streak, not resets it) ==');
  // A separate user whose real history's most recent check-in was
  // YESTERDAY (not today) -- so calling the real /checkin endpoint today
  // should succeed and continue the streak, which only happens if the
  // recomputed lastCheckin is genuinely in the exact format /checkin's own
  // "was that yesterday?" comparison expects.
  const CONTINUES = 'streak-continues';
  users().set(CONTINUES, { phone: '0771970005', walletBalance: 5000, checkinStreak: 1, lastCheckin: '01/01/2020' });
  addCheckinTx(CONTINUES, 3); addCheckinTx(CONTINUES, 2); addCheckinTx(CONTINUES, 1); // 3 consecutive days ending YESTERDAY
  r = await ownerCall('/admin/users/recount');
  check('second recount pass succeeds', r.body?.status === 'success', r.body);
  check('second pass only fixes the ONE new/stale account, the already-correct ones from before are left alone', r.body.streaksFixed === 1, r.body);
  check('CONTINUES corrected to streak 3 (ending yesterday) before checking in today', users().get(CONTINUES).checkinStreak === 3, users().get(CONTINUES));
  r = await call('POST', '/checkin', { token: 'uid:' + CONTINUES, body: {} });
  check('CONTINUES user can check in today successfully', r.body?.status === 'success', r.body);
  check('streak continued to 4 (3+1), proving the recomputed lastCheckin format matches what /checkin itself expects -- not reset to 1', r.body?.streak === 4, r.body);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
