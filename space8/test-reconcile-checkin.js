/* SPACE8 ADMIN "RECONCILE STREAK" BUTTON (single user, on demand)
   /checkin already self-heals on every call, and /admin/users/recount can
   bulk-fix everyone, but the owner explicitly asked for a button in admin
   they can click right now on ONE account to see/trigger the correct
   streak, rather than waiting for that member's next check-in or running
   the bulk tool: "introduce a button in admin so as l trigger and
   Reconcile to right number of streak".

   Boots the REAL server.js against an in-memory mock database and proves,
   calling ONLY the new POST /admin/user/reconcile-checkin endpoint:
     - a user whose stored checkinStreak/lastCheckin is wrong gets
       corrected to match their real 'checkin' transaction history, and
       the response reports changed:true with clear before/after values
     - a user whose stored value is ALREADY correct is left alone
       (changed:false, no write), proving it's idempotent/safe to click
       repeatedly or "just in case"
     - a user with stored streak>0 but zero real checkin transactions is
       corrected down to 0 / lastCheckin null
     - the corrected lastCheckin actually works with a real subsequent
       /checkin call afterward (continues rather than resets), proving the
       written format matches exactly what /checkin itself expects
     - wallet balance is never touched -- pure streak bookkeeping
     - non-owner staff cannot call it
     - an unknown userId is refused cleanly

   Run: node test-reconcile-checkin.js   (exits 0 = all green)             */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '4154';

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

const BASE = 'http://127.0.0.1:4154';
async function call(method, p, { token, adminKey, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (adminKey) headers.Authorization = 'Bearer ' + adminKey;
  const r = await fetch(BASE + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (_) {}
  return { code: r.status, body: j };
}
async function ownerCall(path, body) { return call('POST', path, { adminKey: 'test-admin-key', body: body || {} }); }
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
function eatNoon(daysAgo) {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d;
}
function addCheckinTx(uid, daysAgo) {
  txs().set('rc-tx-' + (++txN), { userId: uid, type: 'checkin', amount: 500, description: 'Daily reward', createdAt: eatNoon(daysAgo) });
}
async function createProfile(uid, phone) {
  await call('POST', '/account/create-profile', { token: 'uid:' + uid, body: { phone } });
  await call('POST', '/register', { token: 'uid:' + uid, body: {} });
}

(async () => {
  await sleep(600);

  console.log('\n== A wrong stored streak gets corrected to match real history, with clear before/after ==');
  const A = 'rc-a';
  await createProfile(A, '0771990001');
  addCheckinTx(A, 2); addCheckinTx(A, 1); addCheckinTx(A, 0); // 3 real consecutive days, ending TODAY
  users().get(A).checkinStreak = 1;
  users().get(A).lastCheckin = '01/01/2020';

  let r = await ownerCall('/admin/user/reconcile-checkin', { userId: A });
  check('call succeeds', r.body?.status === 'success', r.body);
  check('reports changed:true', r.body?.changed === true, r.body);
  check('before reflects the corrupted stored value', r.body?.before?.checkinStreak === 1, r.body);
  check('after reflects the real 3-day streak', r.body?.after?.checkinStreak === 3, r.body);
  check('actually written back to the user doc', users().get(A).checkinStreak === 3, users().get(A));

  console.log('\n== Calling it again on an already-correct account is a safe no-op ==');
  r = await ownerCall('/admin/user/reconcile-checkin', { userId: A });
  check('call succeeds', r.body?.status === 'success', r.body);
  check('reports changed:false the second time', r.body?.changed === false, r.body);
  check('before === after, both 3', r.body?.before?.checkinStreak === 3 && r.body?.after?.checkinStreak === 3, r.body);

  console.log('\n== A stored streak with ZERO real check-in transactions is corrected down to 0 / null ==');
  const B = 'rc-b';
  await createProfile(B, '0771990002');
  users().get(B).checkinStreak = 30;
  users().get(B).lastCheckin = '06/06/2026';

  r = await ownerCall('/admin/user/reconcile-checkin', { userId: B });
  check('corrected to streak 0', r.body?.after?.checkinStreak === 0, r.body);
  check('lastCheckin corrected to null', r.body?.after?.lastCheckin === null, r.body);
  check('written back to the user doc', users().get(B).checkinStreak === 0 && !users().get(B).lastCheckin, users().get(B));

  console.log('\n== The corrected lastCheckin format really works with a real subsequent /checkin call ==');
  const C = 'rc-c';
  await createProfile(C, '0771990003');
  addCheckinTx(C, 3); addCheckinTx(C, 2); addCheckinTx(C, 1); // ends yesterday
  users().get(C).checkinStreak = 999; // corrupted
  users().get(C).lastCheckin = '01/01/2020';

  r = await ownerCall('/admin/user/reconcile-checkin', { userId: C });
  check('corrected to 3 (real 3-day run ending yesterday)', r.body?.after?.checkinStreak === 3, r.body);
  r = await call('POST', '/checkin', { token: 'uid:' + C });
  check('real /checkin afterward continues to 4, not reset to 1 -- written format matches exactly', r.body?.streak === 4, r.body);

  console.log('\n== Wallet balance is never touched by reconciliation ==');
  const balC = users().get(C).walletBalance;
  r = await ownerCall('/admin/user/reconcile-checkin', { userId: C });
  check('wallet unchanged by a reconcile call', users().get(C).walletBalance === balC, { before: balC, after: users().get(C).walletBalance });

  console.log('\n== Non-owner staff cannot call it ==');
  await ownerCall('/admin/admins/create', { username: 'rc_staff', password: 'whatever-123' });
  const staffLogin = await call('POST', '/admin/login', { body: { username: 'rc_staff', password: 'whatever-123' } });
  r = await call('POST', '/admin/user/reconcile-checkin', { token: staffLogin.body?.token, body: { userId: A } });
  check('staff (non-owner) refused', r.code === 401, r.body);

  console.log('\n== Unknown userId is refused cleanly ==');
  r = await ownerCall('/admin/user/reconcile-checkin', { userId: 'no-such-user' });
  check('404 for unknown user', r.code === 404, r.body);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
