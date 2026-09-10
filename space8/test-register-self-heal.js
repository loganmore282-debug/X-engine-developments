/* SPACE8 /register SELF-HEAL -- fixes a real "User not found" bug
   The owner reported "check registration and login functions, sometimes it
   brings user not found errors." Root cause, confirmed by reading both the
   frontend and backend: the register button handler in
   user-src/original_module.js calls window.fbCreateUser(...) then goes
   STRAIGHT to POST /register -- it never calls POST /account/create-profile
   first. But /register's underlying completeRegistrationCore() REQUIRES the
   member's Mongo doc to already exist and 404s "User not found" if it
   doesn't. /account/create-profile is the ONLY endpoint that ever created
   that doc -- and grepping the whole frontend source confirms it is never
   called from anywhere in the real app. So every brand-new registration
   through the real UI hit that 404 and failed with exactly the message the
   owner described. (Every OTHER test file in this suite calls
   /account/create-profile manually before /register, which is why 58
   passing tests never caught this -- none of them exercised the real
   frontend's actual call sequence. This file deliberately does NOT.)

   Fixed in server.js: POST /register now creates the doc itself (via the
   same defaultProfileDoc() shape /account/create-profile uses) if it's
   missing, before calling completeRegistrationCore -- safe specifically
   because /register's userId always comes from verifyAuth() (a real,
   currently-authenticated Firebase uid), unlike the ADMIN reconciliation
   endpoint (/admin/user/complete-registration), which takes an unverified
   userId straight from the request body and must stay 404-on-missing so a
   typo'd/bogus id can never phantom-create an account. That endpoint's own
   "nonexistent user -> 404" test in test-registration-reconciliation.js is
   the proof this fix didn't loosen that path too.

   Boots the REAL server.js against an in-memory mock database and proves:
     - POST /register with NO prior /account/create-profile call --
       exactly what the real app does -- now succeeds instead of 404ing
     - the resulting user doc has the phone from the register call, a real
       referral code, and the welcome bonus actually credited
     - a referral code passed on that same first call still links the
       referrer correctly (the self-heal doesn't skip the rest of
       registration)
     - calling /register again afterwards is the normal idempotent
       already_done response, not a second doc-creation attempt
     - POST /admin/user/complete-registration is UNCHANGED: a bogus/
       nonexistent userId from an admin request still 404s, never
       phantom-creates an account

   Run: node test-register-self-heal.js   (exits 0 = all green)           */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '4158';

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

const BASE = 'http://127.0.0.1:4158';
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

(async () => {
  await sleep(600);

  console.log('\n== A brand-new user, registering exactly like the real frontend does (no create-profile call first) ==');
  const FRESH = 'sh-fresh-user';
  check('sanity: no doc exists at all for this uid yet', !userDoc(FRESH), userDoc(FRESH));
  let r = await call('POST', '/register', { token: 'uid:' + FRESH, body: { phone: '0771960001' } });
  check('registration now SUCCEEDS instead of 404ing "User not found"', r.body?.status === 'success', r.body);
  check('a real referral code was assigned', typeof r.body?.referralCode === 'string' && r.body.referralCode.length > 0, r.body);
  check('the doc now exists with the phone from the register call', userDoc(FRESH)?.phone === '+256771960001', userDoc(FRESH));
  check('registrationDone is true', userDoc(FRESH)?.registrationDone === true, userDoc(FRESH));
  check('welcome bonus actually credited', userDoc(FRESH)?.walletBalance === r.body.welcomeBonus && r.body.welcomeBonus > 0, { doc: userDoc(FRESH), body: r.body });
  check('a real Welcome gift transaction row exists', txnsOf(FRESH).some(t => t.description === 'Welcome gift'), txnsOf(FRESH));

  console.log('\n== A referral code on that same first call still links the referrer (self-heal does not skip the rest of registration) ==');
  const REFERRER = 'sh-referrer';
  await call('POST', '/account/create-profile', { token: 'uid:' + REFERRER, body: { phone: '0771960002' } });
  const refReg = await call('POST', '/register', { token: 'uid:' + REFERRER, body: {} });
  const refCode = refReg.body.referralCode;
  const REFERRED = 'sh-referred-fresh';
  check('sanity: no doc exists for the referred user either', !userDoc(REFERRED), userDoc(REFERRED));
  r = await call('POST', '/register', { token: 'uid:' + REFERRED, body: { phone: '0771960003', referralCode: refCode } });
  check('referred user registers successfully with no prior profile', r.body?.status === 'success', r.body);
  check('referredBy correctly set on the self-healed doc', userDoc(REFERRED)?.referredBy === REFERRER, userDoc(REFERRED));
  check('referrer L1 count incremented', (userDoc(REFERRER)?.teamL1Count || 0) === 1, userDoc(REFERRER));

  console.log('\n== Calling /register a second time is the normal idempotent no-op, not a second doc-creation ==');
  const balAfterFirst = userDoc(FRESH).walletBalance;
  r = await call('POST', '/register', { token: 'uid:' + FRESH, body: { phone: '0771960001' } });
  check('second call reports already_done', r.body?.status === 'already_done', r.body);
  check('balance unchanged by the second call', userDoc(FRESH).walletBalance === balAfterFirst, userDoc(FRESH));
  check('still exactly one Welcome gift transaction, not two', txnsOf(FRESH).filter(t => t.description === 'Welcome gift').length === 1, txnsOf(FRESH));

  console.log('\n== The admin reconciliation endpoint is UNCHANGED: it still refuses to phantom-create an account for a bogus userId ==');
  r = await ownerCall('/admin/user/complete-registration', { userId: 'sh-does-not-exist-and-should-not-be-created', referralCode: '' });
  check('bogus/nonexistent userId from an admin request -> still 404, no account created', r.code === 404 && !userDoc('sh-does-not-exist-and-should-not-be-created'), { code: r.code, body: r.body });

  console.log('\n== Logging in right after this kind of registration works too (the actual "login sometimes user not found" symptom) ==');
  r = await call('GET', '/account', { token: 'uid:' + FRESH });
  check('/account now finds the self-healed user (this used to 404 for anyone caught by the bug)', r.code === 200 && r.body?.status === 'success', r.body);

  console.log('\n== The OTHER half of the same bug: /account\'s 404 now carries a stable code the client can self-heal against ==');
  // Owner report (2026-08-17): a real member's phone signed in fine (a
  // Firebase account existed) but the app showed a blank referral code, no
  // ID, UGX 0 everywhere, and "User not found" on every action -- root
  // cause was a Firebase account whose very first /register call never
  // landed (a dropped connection right after signup), leaving NO doc at
  // all. The client's OWN self-heal (in the 'space8-auth' listener) only
  // ever retried /register when GET /account came back status:'success'
  // with registrationDone:false -- a genuinely MISSING doc instead returns
  // a plain 404 status:'error', which that check never matched, so the
  // account was permanently stranded with zero automatic recovery. Fixed
  // by giving this 404 a stable `code: 'NOT_FOUND'` (same pattern as the
  // existing `code: 'BANNED'`) so the client can tell "genuinely no
  // profile" apart from an unrelated network failure and retry /register
  // for it too -- /register already self-heals a missing doc on its own,
  // confirmed by every check above; the only gap was ever telling the
  // client TO call it.
  const GHOST = 'sh-ghost-account';
  check('sanity: no doc exists for this uid (simulates a /register call that never landed)', !userDoc(GHOST), userDoc(GHOST));
  r = await call('GET', '/account', { token: 'uid:' + GHOST });
  check('GET /account 404s for a genuinely missing doc', r.code === 404 && r.body?.status === 'error', r.body);
  check('...and carries code: NOT_FOUND, the exact signal the client\'s self-heal now checks for', r.body?.code === 'NOT_FOUND', r.body);
  check('...distinct from the BANNED code used elsewhere, so the client can never confuse the two', r.body?.code !== 'BANNED', r.body);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
