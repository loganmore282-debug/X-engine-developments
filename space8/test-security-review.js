/* SPACE8 SECURITY REVIEW -- login/registration hardening (ChatGPT audit)
   The owner asked for a security review of login/registration/PIN/referral
   code generation. ChatGPT found several real, confirmed issues (verified
   by reading the actual code before touching anything). This test proves
   the fixes that landed in server.js as a result:

     1. /account/create-profile and /register now derive `phone` from the
        CALLER'S OWN verified Firebase email first (phoneFromVerifiedEmail),
        not from the client-supplied body alone -- an authenticated caller
        can no longer label their own profile with an arbitrary phone
        number that has nothing to do with the account they signed up with.
        (This does NOT by itself prove real phone ownership -- that needs
        SMS/Phone-Auth OTP, a separate feature this app doesn't have.)
     2. /register's member-facing response no longer leaks the referring
        account's raw Firebase uid (`referrerId`) -- redacted from the
        response only; the referral link itself still works exactly the
        same underneath (referredBy set, team counts incremented).
     3. A banned account's referral code is now rejected at registration
        instead of still linking/incrementing team counts toward them.
     4. /admin/login runs scryptVerify against a fixed dummy hash for a
        nonexistent/inactive username instead of short-circuiting before
        ever calling it -- closes a timing side-channel. This test checks
        CORRECTNESS (same generic error, same shape) since timing itself
        isn't reliably assertable in a test.
     5. generateUniqueReferralCode() is now lock-guarded and its post-20-
        collision fallback keeps verifying uniqueness instead of returning
        an unchecked code -- sanity-checked by generating a batch and
        confirming they're all unique and well-formed.
     6. The publicId lazy self-heal in GET /account is now per-user
        lock-guarded -- sanity-checked that it still assigns a valid,
        correctly-formatted id to a legacy-shaped account.

   Run: node test-security-review.js   (exits 0 = all green)              */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '4211';

const Module = require('module');
const mockdb = require('./test-mockdb.js');
const dbPath = require.resolve('./db.js');
const dbMod = new Module(dbPath); dbMod.exports = mockdb; dbMod.loaded = true;
require.cache[dbPath] = dbMod;

const faPath = require.resolve('firebase-admin');
const faMod = new Module(faPath);
faMod.exports = {
  initializeApp: () => {}, credential: { cert: () => ({}) },
  // Token format for this file only: 'uid:<uid>' (no email, same as every
  // other test file) OR 'uid:<uid>|<email>' (adds a verified email) -- lets
  // this file specifically prove the email-derived-phone behavior without
  // changing the shared 'uid:xxx' convention every other test relies on.
  auth: () => ({ verifyIdToken: async tok => {
    const s = String(tok);
    if (!s.startsWith('uid:')) throw new Error('bad');
    const rest = s.slice(4);
    const bar = rest.indexOf('|');
    if (bar === -1) return { uid: rest };
    return { uid: rest.slice(0, bar), email: rest.slice(bar + 1) };
  } }),
};
faMod.loaded = true;
require.cache[faPath] = faMod;

require('./server.js');

const BASE = 'http://127.0.0.1:4211';
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

(async () => {
  await sleep(600);

  console.log('\n== Registration phone is derived from the VERIFIED Firebase email, not blindly trusted from the request body ==');
  const SPOOF = 'sr-spoof-user';
  // Real phone behind this account (per the mocked verified email) is
  // 256700111222 -- the request body claims a COMPLETELY DIFFERENT number.
  let r = await call('POST', '/register', {
    token: 'uid:' + SPOOF + '|256700111222@space8.com',
    body: { phone: '0799888777' } // an unrelated number the caller does NOT own
  });
  check('registration succeeds', r.body?.status === 'success', r.body);
  check('stored phone matches the VERIFIED email, not the spoofed body value', userDoc(SPOOF)?.phone === '+256700111222', userDoc(SPOOF));
  check('stored phone is NOT the attacker-supplied body value', userDoc(SPOOF)?.phone !== '+256799888777', userDoc(SPOOF));

  console.log('\n-- Same protection on /account/create-profile directly --');
  const SPOOF2 = 'sr-spoof-user2';
  r = await call('POST', '/account/create-profile', {
    token: 'uid:' + SPOOF2 + '|256700333444@space8.com',
    body: { phone: '0799888777' }
  });
  check('create-profile succeeds', r.body?.status === 'success', r.body);
  check('stored phone matches the verified email here too', userDoc(SPOOF2)?.phone === '+256700333444', userDoc(SPOOF2));

  console.log('\n-- No email on the token (every other test file\'s shape) still falls back to the body phone exactly like before --');
  const NOEMAIL = 'sr-noemail-user';
  r = await call('POST', '/register', { token: 'uid:' + NOEMAIL, body: { phone: '0771950099' } });
  check('registration succeeds with no email on the token', r.body?.status === 'success', r.body);
  check('falls back to the body-supplied phone when no verified email is available', userDoc(NOEMAIL)?.phone === '+256771950099', userDoc(NOEMAIL));

  console.log('\n== /register no longer leaks the referring account\'s raw uid, but the referral link still works underneath ==');
  const REFERRER = 'sr-referrer';
  await call('POST', '/account/create-profile', { token: 'uid:' + REFERRER, body: { phone: '0771950010' } });
  const refReg = await call('POST', '/register', { token: 'uid:' + REFERRER, body: {} });
  const refCode = refReg.body.referralCode;
  const REFERRED = 'sr-referred';
  r = await call('POST', '/register', { token: 'uid:' + REFERRED, body: { phone: '0771950011', referralCode: refCode } });
  check('referral registration succeeds', r.body?.status === 'success', r.body);
  check('referrerId is NOT present in the member-facing response', !('referrerId' in (r.body || {})), r.body);
  check('the referral link itself still worked (referredBy set correctly)', userDoc(REFERRED)?.referredBy === REFERRER, userDoc(REFERRED));
  check('referrer L1 count still incremented', (userDoc(REFERRER)?.teamL1Count || 0) === 1, userDoc(REFERRER));

  console.log('\n== A banned account\'s referral code is rejected at registration ==');
  const BANNEDREF = 'sr-banned-referrer';
  await call('POST', '/account/create-profile', { token: 'uid:' + BANNEDREF, body: { phone: '0771950020' } });
  const bannedReg = await call('POST', '/register', { token: 'uid:' + BANNEDREF, body: {} });
  const bannedCode = bannedReg.body.referralCode;
  userDoc(BANNEDREF).status = 'banned';
  const VICTIM = 'sr-would-be-referred';
  r = await call('POST', '/register', { token: 'uid:' + VICTIM, body: { phone: '0771950021', referralCode: bannedCode } });
  check('registration is REJECTED when the referral code belongs to a banned account', r.code === 400 && r.body?.code === 'BAD_REFERRAL', r.body);
  check('no account was left half-registered by the rejected attempt', !userDoc(VICTIM) || userDoc(VICTIM).registrationDone !== true, userDoc(VICTIM));
  check('the banned referrer\'s team count was NOT incremented', (userDoc(BANNEDREF)?.teamL1Count || 0) === 0, userDoc(BANNEDREF));

  console.log('\n== Admin login: nonexistent username gets the same generic rejection as a real wrong password (timing side-channel closed) ==');
  await ownerCall('/admin/admins/create', { username: 'srrealstaff', password: 'a-real-password-1' });
  const wrongPwd = await call('POST', '/admin/login', { body: { username: 'srrealstaff', password: 'totally-wrong' } });
  const noSuchUser = await call('POST', '/admin/login', { body: { username: 'sr-does-not-exist-at-all', password: 'anything' } });
  check('wrong password on a real username -> 401 generic message', wrongPwd.code === 401 && wrongPwd.body?.message === 'Invalid username or password', wrongPwd.body);
  check('nonexistent username -> SAME 401 generic message (not a different/faster-failing shape)', noSuchUser.code === 401 && noSuchUser.body?.message === 'Invalid username or password', noSuchUser.body);

  console.log('\n== Referral code generation: lock-guarded, still produces valid unique codes ==');
  const codes = new Set();
  for (let i = 0; i < 8; i++) {
    const uid = 'sr-code-batch-' + i;
    await call('POST', '/account/create-profile', { token: 'uid:' + uid, body: { phone: '07719501' + String(30 + i).padStart(2, '0') } });
    const reg = await call('POST', '/register', { token: 'uid:' + uid, body: {} });
    check('registration ' + i + ' succeeded', reg.body?.status === 'success', reg.body);
    codes.add(reg.body.referralCode);
  }
  check('all 8 generated referral codes are unique', codes.size === 8, [...codes]);
  check('every code matches the expected 6-char alphabet shape', [...codes].every(c => /^[A-HJ-NP-Z2-9]{6}$/.test(c)), [...codes]);

  console.log('\n== publicId lazy self-heal (now per-user lock-guarded) still assigns a valid id to a legacy-shaped account ==');
  const LEGACY = 'sr-legacy-account';
  const users = collMap('users');
  users.set(LEGACY, {
    phone: '+256771950099', walletBalance: 0, totalDeposited: 0, totalEarned: 0, totalWithdrawn: 0, totalInvested: 0,
    checkinStreak: 0, lastCheckin: null, teamL1Count: 0, teamL2Count: 0, teamL3Count: 0, teamCommission: 0,
    referredBy: null, referralCode: 'LEGACY1', registrationDone: true, status: 'active', publicId: null,
    createdAt: new Date()
  });
  r = await call('GET', '/account', { token: 'uid:' + LEGACY });
  check('self-heal assigns a real publicId on first read', typeof r.body?.account?.publicId === 'string' && /^\d{6}$/.test(r.body.account.publicId), r.body);
  const assigned = r.body.account.publicId;
  r = await call('GET', '/account', { token: 'uid:' + LEGACY });
  check('second read returns the SAME id, not a freshly-minted second one', r.body?.account?.publicId === assigned, r.body);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
