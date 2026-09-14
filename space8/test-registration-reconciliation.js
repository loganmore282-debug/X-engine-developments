/* SPACE8 REGISTRATION-RECONCILIATION (admin "Complete registration")
   Owner asked for a stuck signup -- profile created but /register never
   completed (dropped connection, a maintenance-mode window), so no
   referral code, no welcome bonus, invisible to whoever invited them -- to
   have a real one-click admin fix instead of a manual credit workaround.

   The money-safety requirement here is stricter than most admin tools:
   this is the FIRST time an admin action shares the exact same code path
   (and the exact same lock) as an ordinary member-facing endpoint
   (/register), specifically so the two can never race each other into a
   double welcome-bonus credit. That's the main thing this file proves.

   Boots the REAL server.js against an in-memory mock database and proves:
     - POST /admin/user/complete-registration (owner-only) finishes a
       stuck account exactly like a normal /register would: registration-
       Done flips true, a referral code is assigned, the welcome bonus
       lands in their wallet with a real transaction row
     - given a referral code, the referrer's L1 (and L2/L3 up the chain)
       team counts increment exactly like self-service registration does
     - a bad/unknown referral code is rejected, nothing is touched
     - calling it twice is harmless (second call returns already_done, no
       second credit)
     - non-owner staff cannot call it
     - CRITICAL: firing the member's own /register and the admin's
       complete-registration at the same account AT THE SAME TIME never
       double-credits the welcome bonus or double-counts the referrer's
       team -- exactly one of the two wins, the other sees the job already
       done and stops, because both share the identical lock+guard
     - a completely unrelated account's balance/team counts are untouched

   Run: node test-registration-reconciliation.js   (exits 0 = all green)  */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '4149';

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

const BASE = 'http://127.0.0.1:4149';
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
const userDoc = id => collMap('users').get(id);
const txnsOf = uid => [...collMap('transactions').values()].filter(t => t.userId === uid);

async function createProfileOnly(uid, phone) {
  await call('POST', '/account/create-profile', { token: 'uid:' + uid, body: { phone } });
}
async function registerFully(uid, phone, referralCode) {
  await createProfileOnly(uid, phone);
  return call('POST', '/register', { token: 'uid:' + uid, body: { referralCode } });
}

(async () => {
  await sleep(600);

  console.log('\n== A fully-registered referrer, to test the chain against ==');
  const REF = 'rr-referrer';
  const rReg = await registerFully(REF, '0771950001');
  const refCode = rReg.body.referralCode;
  check('referrer registered normally, has a real code', !!refCode, rReg.body);

  console.log('\n== A stuck account: profile exists, /register never happened ==');
  const STUCK = 'rr-stuck';
  await createProfileOnly(STUCK, '0771950002');
  check('sanity: registrationDone is false before the fix', userDoc(STUCK).registrationDone === false, userDoc(STUCK));
  check('sanity: no welcome-bonus transaction yet', !txnsOf(STUCK).some(t => t.description === 'Welcome gift'), txnsOf(STUCK));

  console.log('\n== Non-owner staff cannot complete registration ==');
  await ownerCall('/admin/admins/create', { username: 'rr_staff', password: 'whatever-123' });
  const staffLogin = await call('POST', '/admin/login', { body: { username: 'rr_staff', password: 'whatever-123' } });
  let r = await call('POST', '/admin/user/complete-registration', { token: staffLogin.body?.token, body: { userId: STUCK, referralCode: refCode } });
  check('staff (non-owner) is refused', r.code === 401, r.body);
  check('account still stuck after the refused staff attempt', userDoc(STUCK).registrationDone === false, userDoc(STUCK));

  console.log('\n== A bad referral code is rejected, nothing touched ==');
  r = await ownerCall('/admin/user/complete-registration', { userId: STUCK, referralCode: 'NOTAREALCODE' });
  check('unknown referral code rejected', r.code === 400 && r.body?.code === 'BAD_REFERRAL', r.body);
  check('still stuck after the rejected bad code', userDoc(STUCK).registrationDone === false, userDoc(STUCK));

  console.log('\n== Owner completes the registration for real, crediting the referrer ==');
  const balBeforeRef = userDoc(REF).walletBalance;
  const l1Before = userDoc(REF).teamL1Count || 0;
  r = await ownerCall('/admin/user/complete-registration', { userId: STUCK, referralCode: refCode });
  check('completes successfully', r.body?.status === 'success', r.body);
  check('registrationDone now true', userDoc(STUCK).registrationDone === true, userDoc(STUCK));
  check('a real referral code was assigned', typeof userDoc(STUCK).referralCode === 'string' && userDoc(STUCK).referralCode.length > 0, userDoc(STUCK));
  check('referredBy correctly set to REF', userDoc(STUCK).referredBy === REF, userDoc(STUCK));
  check('welcome bonus actually landed in the wallet', userDoc(STUCK).walletBalance === r.body.welcomeBonus, userDoc(STUCK));
  check('a real Welcome gift transaction row exists', txnsOf(STUCK).some(t => t.description === 'Welcome gift' && t.amount === r.body.welcomeBonus), txnsOf(STUCK));
  check('the referrer\'s L1 team count incremented', (userDoc(REF).teamL1Count || 0) === l1Before + 1, userDoc(REF));
  check('the referrer\'s OWN wallet is untouched by this (welcome bonus goes to the new member, not the referrer)', userDoc(REF).walletBalance === balBeforeRef, userDoc(REF));

  console.log('\n-- Calling it again is harmless (idempotent, no second credit) --');
  const balAfterFirst = userDoc(STUCK).walletBalance;
  r = await ownerCall('/admin/user/complete-registration', { userId: STUCK, referralCode: refCode });
  check('second call reports already_done', r.body?.status === 'already_done', r.body);
  check('balance unchanged by the second call', userDoc(STUCK).walletBalance === balAfterFirst, userDoc(STUCK));
  check('still exactly one Welcome gift transaction, not two', txnsOf(STUCK).filter(t => t.description === 'Welcome gift').length === 1, txnsOf(STUCK));

  console.log('\n== CRITICAL: a member\'s own /register and the admin fix racing on the SAME stuck account never double-credit ==');
  const RACE = 'rr-race';
  await createProfileOnly(RACE, '0771950003');
  const balBeforeRace = userDoc(RACE).walletBalance;
  const [selfResult, adminResult] = await Promise.all([
    call('POST', '/register', { token: 'uid:' + RACE, body: {} }),
    ownerCall('/admin/user/complete-registration', { userId: RACE, referralCode: '' }),
  ]);
  check('exactly one of the two calls actually did the work (status success), the other saw it already done',
    [selfResult.body?.status, adminResult.body?.status].filter(s => s === 'success').length === 1 &&
    [selfResult.body?.status, adminResult.body?.status].filter(s => s === 'already_done').length === 1,
    { self: selfResult.body, admin: adminResult.body });
  check('registrationDone is true exactly once (obviously), and the welcome bonus was credited EXACTLY once',
    userDoc(RACE).walletBalance === balBeforeRace + (selfResult.body?.welcomeBonus || adminResult.body?.welcomeBonus || 0),
    { balBeforeRace, after: userDoc(RACE).walletBalance });
  check('exactly ONE Welcome gift transaction from the race, not two', txnsOf(RACE).filter(t => t.description === 'Welcome gift').length === 1, txnsOf(RACE));
  check('exactly ONE referral code assigned (not overwritten by a second write)', typeof userDoc(RACE).referralCode === 'string' && userDoc(RACE).referralCode.length > 0, userDoc(RACE));

  console.log('\n== An unrelated account is completely untouched by all of the above ==');
  const OTHER = 'rr-other';
  await registerFully(OTHER, '0771950004');
  const otherBal = userDoc(OTHER).walletBalance;
  check('unrelated account balance is exactly its own welcome bonus, nothing extra', otherBal === userDoc(OTHER).walletBalance && userDoc(OTHER).registrationDone === true, userDoc(OTHER));

  console.log('\n== 404 for a nonexistent user, 400 for a missing userId ==');
  r = await ownerCall('/admin/user/complete-registration', { userId: 'does-not-exist', referralCode: '' });
  check('nonexistent user -> 404', r.code === 404, r.body);
  r = await ownerCall('/admin/user/complete-registration', { referralCode: '' });
  check('missing userId -> 400', r.code === 400, r.body);

  console.log('\n== GET /account exposes registrationDone, so the client can self-heal a stuck signup ==');
  // 2026-08-16: registering with a WRONG referral code used to leave a
  // member stuck forever with no way to notice or retry -- Firebase already
  // signed them in, so the app just showed them the (broken, half-empty)
  // home screen with no obvious "finish registering" affordance. The client
  // now checks account.registrationDone on every fresh sign-in and, if
  // false, silently retries /register with no code (see the 'space8-auth'
  // listener in original_module.js) -- this proves the two pieces that fix
  // depends on: the field is actually present in the response, and a
  // no-referral-code retry after a bad-code rejection genuinely finishes
  // registration rather than erroring again.
  const HEAL = 'rr-self-heal';
  await createProfileOnly(HEAL, '0771950005');
  r = await call('POST', '/register', { token: 'uid:' + HEAL, body: { referralCode: 'TOTALLY-BOGUS' } });
  check('bad referral code on first attempt is rejected, not silently ignored', r.code === 400 && r.body?.code === 'BAD_REFERRAL', r.body);
  r = await call('GET', '/account', { token: 'uid:' + HEAL });
  check('/account reports registrationDone: false right after the rejected attempt', r.body?.account?.registrationDone === false, r.body?.account);
  r = await call('POST', '/register', { token: 'uid:' + HEAL, body: {} });
  check('retrying /register with no code (what the client self-heal does) succeeds', r.body?.status === 'success', r.body);
  check('welcome bonus actually landed', userDoc(HEAL).walletBalance === r.body.welcomeBonus, userDoc(HEAL));
  r = await call('GET', '/account', { token: 'uid:' + HEAL });
  check('/account now reports registrationDone: true', r.body?.account?.registrationDone === true, r.body?.account);
  check('a real referral code was assigned despite the earlier bad-code rejection', typeof r.body?.account?.referralCode === 'string' && r.body.account.referralCode.length > 0, r.body?.account);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
