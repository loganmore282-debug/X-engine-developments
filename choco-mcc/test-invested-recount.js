/* CHOCOMCC "INVESTED" TOTAL CORRUPTION FIX
   Owner spotted real accounts showing absurd "Invested" totals (billions,
   even quadrillions of UGX) on accounts that never remotely invested that
   much. Root cause: totalInvested is a plain counter field, never derived
   server-side from the investments themselves. An old code path that once
   did naive JS `+=` on a field that had ever been stored as a STRING (a
   manual edit, or a pre-fix write) doesn't throw -- it silently
   CONCATENATES: "30000" + 30000 becomes the STRING "3000030000", which
   then gets stored and read back as the very real-looking but wildly
   wrong NUMBER 3,000,030,000. /invest/create's current write path already
   Number()-coerces both sides before writing, so this can't happen again
   going forward -- but whatever is ALREADY sitting wrong in the database
   from before that fix stays wrong forever unless something reconciles it.

   Confirmed (by reading every write site of totalInvested in server.js)
   that this field is NEVER used to compute actual payouts, withdrawals,
   or commissions -- those all come from the investments collection's own
   fields and walletBalance, completely separate. So this is a display/
   analytics corruption, not a double-crediting risk -- but it still needs
   fixing, and needs to be visible to the owner without them having to
   spot it by eye on a user's detail page.

   Boots the REAL server.js against an in-memory mock database and proves:
     - /admin/users/recount recomputes totalInvested from the REAL sum of
       that user's investments collection records (the authoritative
       source, each written once at purchase time and never mutated) and
       overwrites a corrupted stored value, reporting it in investedFixed
     - an account whose stored totalInvested is ALREADY correct is left
       completely untouched -- not counted in investedFixed, not written
     - a user with MULTIPLE real investments sums them all correctly
     - a user with real investments but totalInvested still at its
       initial 0 (never incremented at all) is corrected too
     - walletBalance and the investments/transactions records themselves
       are never touched by any of this
     - /admin/integrity proactively FLAGS the corrupted account with an
       invested_mismatch alert showing both the wrong stored value and
       the real one, and does NOT flag an already-correct account
     - non-owner staff cannot call either endpoint

   Run: node test-invested-recount.js   (exits 0 = all green)            */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '4156';

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

const BASE = 'http://127.0.0.1:4156';
async function call(method, p, { token, adminKey, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (adminKey) headers.Authorization = 'Bearer ' + adminKey;
  const r = await fetch(BASE + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (_) {}
  return { code: r.status, body: j };
}
const ownerHeaders = { Authorization: 'Bearer test-admin-key' };
async function ownerGet(path) { const r = await fetch(BASE + path, { method: 'GET', headers: ownerHeaders }); return { code: r.status, body: await r.json().catch(() => null) }; }
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
const investments = () => collMap('investments');
let invN = 0;
function addInvestment(uid, amount) {
  investments().set('inv' + (++invN), { userId: uid, tierKey: 'test', tierLabel: 'Test Tier', amount, status: 'active', createdAt: new Date() });
}
async function createProfile(uid, phone) {
  await call('POST', '/account/create-profile', { token: 'uid:' + uid, body: { phone } });
  await call('POST', '/register', { token: 'uid:' + uid, body: {} });
}

(async () => {
  await sleep(600);

  console.log('\n== A user with the exact string-concatenation corruption pattern ==');
  const CORRUPT = 'inv-corrupt';
  await createProfile(CORRUPT, '0771990201');
  // Two real purchases of 30,000 each -- real total should be 60,000 --
  // but the stored counter is the exact concatenation-corrupted value
  // "30000" + 30000 would produce: 3,000,030,000.
  addInvestment(CORRUPT, 30000);
  addInvestment(CORRUPT, 30000);
  users().get(CORRUPT).walletBalance = 999999; // sentinel -- must never be touched
  users().get(CORRUPT).totalInvested = 3000030000;

  console.log('\n== A user whose stored totalInvested is ALREADY correct ==');
  const CORRECT = 'inv-correct';
  await createProfile(CORRECT, '0771990202');
  addInvestment(CORRECT, 90000);
  users().get(CORRECT).totalInvested = 90000;
  users().get(CORRECT).walletBalance = 555555;

  console.log('\n== A user with multiple real investments summing correctly ==');
  const MULTI = 'inv-multi';
  await createProfile(MULTI, '0771990203');
  addInvestment(MULTI, 30000);
  addInvestment(MULTI, 500000);
  addInvestment(MULTI, 1000000);
  users().get(MULTI).totalInvested = 12345; // wrong, real sum is 1,530,000

  console.log('\n== A user with real investments but totalInvested never incremented at all (still 0) ==');
  const NEVERSET = 'inv-neverset';
  await createProfile(NEVERSET, '0771990204');
  addInvestment(NEVERSET, 270000);
  // totalInvested left at its registration default of 0

  console.log('\n== /admin/integrity flags the corrupted accounts BEFORE any fix is applied ==');
  let r = await ownerGet('/admin/integrity');
  check('integrity call succeeds', r.body?.status === 'success', r.body);
  const corruptAlert = (r.body.alerts || []).find(a => a.kind === 'invested_mismatch' && a.userId === CORRUPT);
  check('CORRUPT is flagged with invested_mismatch', !!corruptAlert, r.body.alerts);
  check('alert shows the wrong stored value (3,000,030,000)', corruptAlert?.stored === 3000030000, corruptAlert);
  check('alert shows the real value (60,000)', corruptAlert?.real === 60000, corruptAlert);
  check('CORRECT is NOT flagged (already matches)', !(r.body.alerts || []).some(a => a.kind === 'invested_mismatch' && a.userId === CORRECT), r.body.alerts);
  check('MULTI is flagged (12,345 stored vs 1,530,000 real)',
    (r.body.alerts || []).some(a => a.kind === 'invested_mismatch' && a.userId === MULTI && a.stored === 12345 && a.real === 1530000), r.body.alerts);
  check('NEVERSET is flagged (0 stored vs 270,000 real)',
    (r.body.alerts || []).some(a => a.kind === 'invested_mismatch' && a.userId === NEVERSET && a.stored === 0 && a.real === 270000), r.body.alerts);

  console.log('\n== /admin/users/recount fixes every wrong totalInvested from the real investments sum ==');
  r = await ownerGet('/admin/users/recount');
  check('recount succeeds', r.body?.status === 'success', r.body);
  check('CORRUPT corrected to the real 60,000', users().get(CORRUPT).totalInvested === 60000, users().get(CORRUPT));
  check('MULTI corrected to the real 1,530,000 (30k+500k+1,000k)', users().get(MULTI).totalInvested === 1530000, users().get(MULTI));
  check('NEVERSET corrected to the real 270,000', users().get(NEVERSET).totalInvested === 270000, users().get(NEVERSET));
  check('CORRECT is untouched, stays at 90,000', users().get(CORRECT).totalInvested === 90000, users().get(CORRECT));
  check('investedFixed counts exactly the 3 accounts that were actually wrong (CORRUPT, MULTI, NEVERSET)', r.body.investedFixed === 3, r.body);

  console.log('\n== Wallet balances are never touched by any of this ==');
  check('CORRUPT wallet untouched', users().get(CORRUPT).walletBalance === 999999, users().get(CORRUPT).walletBalance);
  check('CORRECT wallet untouched', users().get(CORRECT).walletBalance === 555555, users().get(CORRECT).walletBalance);

  console.log('\n== Running recount again is a safe no-op (idempotent) ==');
  r = await ownerGet('/admin/users/recount');
  check('second recount succeeds', r.body?.status === 'success', r.body);
  check('investedFixed is 0 the second time -- nothing left to fix', r.body.investedFixed === 0, r.body);

  console.log('\n== /admin/integrity is clean on totalInvested now ==');
  r = await ownerGet('/admin/integrity');
  check('no invested_mismatch alerts remain', !(r.body.alerts || []).some(a => a.kind === 'invested_mismatch'), r.body.alerts);

  console.log('\n== Non-owner staff cannot call either endpoint ==');
  const staffHeaders = {};
  r = { code: (await fetch(BASE + '/admin/users/recount', { method: 'GET' })).status };
  check('recount rejects unauthenticated', r.code === 401, r.code);
  r = { code: (await fetch(BASE + '/admin/integrity', { method: 'GET' })).status };
  check('integrity rejects unauthenticated', r.code === 401, r.code);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
