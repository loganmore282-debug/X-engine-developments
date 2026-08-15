/* NOVERA MALFORMED-PHONE DETECTION + RECONCILIATION
   Owner reported real complaints: some members' phones show up as bare
   fragments (e.g. "43750320" instead of a real Uganda number) on their own
   Account page, admin search for their real number returns "No matching
   users", and the owner had no idea how a number like that ever got
   accepted or how to find/fix accounts already stuck this way.

   Root cause: /account/create-profile deliberately never rejects a
   malformed phone (it's already this person's working Firebase login
   identity, not the money-moving path -- see the comment there), so a
   typo/dropped-digit at signup silently becomes a permanent, unsearchable
   phone with zero visibility to the owner until a member complains.

   Boots the REAL server.js against an in-memory mock database and proves:
     - /admin/integrity now flags every account whose phone doesn't reduce
       to a valid Uganda mobile shape (phone_malformed), and every account
       that has a profile but never finished /register more than an hour
       ago (registration_incomplete) -- a signed-up-but-no-bonus account
     - a fresh signup (<1h old, mid-flow) is NOT flagged as incomplete yet
     - a normal, well-formed, fully-registered account triggers neither
     - POST /admin/user/set-phone (owner-only) corrects a malformed phone
       to a real one, validated exactly as strictly as a payout number
     - after the fix, that same account is immediately findable by the
       admin panel's own phone search logic (phoneCore matching) and no
       longer flagged by a re-run of the integrity audit
     - a badly-formatted "correction" (still not a real UG number) is
       rejected outright, leaving the broken value untouched
     - non-owner staff cannot call set-phone

   Run: node test-phone-reconciliation.js   (exits 0 = all green)         */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '4148';

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

const BASE = 'http://127.0.0.1:4148';
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

async function registerFully(uid, phone) {
  await call('POST', '/account/create-profile', { token: 'uid:' + uid, body: { phone } });
  await call('POST', '/register', { token: 'uid:' + uid, body: {} });
}

(async () => {
  await sleep(600);

  console.log('\n== Seeding: a normal account, a malformed-phone account, an old incomplete signup, a fresh one ==');
  const NORMAL = 'phr-normal';
  await registerFully(NORMAL, '0771234567');

  // The real-world case from the owner's report: a profile phone that's
  // just a bare fragment, not a real Uganda number.
  const BROKEN = 'phr-broken';
  await registerFully(BROKEN, '43750320');
  check('sanity: the broken account really is stored exactly as garbled', userDoc(BROKEN).phone === '43750320', userDoc(BROKEN));

  // Signed up (profile exists) but never finished /register -- no bonus,
  // no referral code -- and old enough that it's not just "still signing
  // up right now".
  const STUCK = 'phr-stuck';
  await call('POST', '/account/create-profile', { token: 'uid:' + STUCK, body: { phone: '0771234999' } });
  userDoc(STUCK).createdAt = new Date(Date.now() - 5 * 3600000);

  // A brand new signup mid-flow (created seconds ago) should NOT be
  // flagged yet -- nothing wrong with someone still on step 1.
  const FRESH = 'phr-fresh';
  await call('POST', '/account/create-profile', { token: 'uid:' + FRESH, body: { phone: '0771234998' } });

  console.log('\n== /admin/integrity flags exactly the right accounts ==');
  let r = await call('GET', '/admin/integrity', { adminKey: 'test-admin-key' });
  check('integrity call succeeds', r.body?.status === 'success', r.body);
  const alerts = r.body.alerts || [];
  const phoneAlert = alerts.find(a => a.kind === 'phone_malformed' && a.userId === BROKEN);
  const stuckAlert = alerts.find(a => a.kind === 'registration_incomplete' && a.userId === STUCK);
  check('BROKEN is flagged phone_malformed', !!phoneAlert, alerts.filter(a => a.userId === BROKEN));
  check('the alert carries the actual broken value', phoneAlert?.phone === '43750320', phoneAlert);
  check('STUCK is flagged registration_incomplete', !!stuckAlert, alerts.filter(a => a.userId === STUCK));
  check('NORMAL is flagged with nothing', !alerts.some(a => a.userId === NORMAL), alerts.filter(a => a.userId === NORMAL));
  check('FRESH (signed up moments ago) is NOT flagged incomplete yet', !alerts.some(a => a.userId === FRESH), alerts.filter(a => a.userId === FRESH));

  console.log('\n== The admin panel\'s own search logic genuinely cannot find the broken account by its real number ==');
  // Mirrors admin-src's phoneCore(): strip non-digits, drop a leading 256
  // or 0. A real search for "0743750320" would never match a value that's
  // missing digits -- proving the bug is unrecoverable data, not a search
  // bug, and reconciliation (fixing the stored value) is the only real fix.
  function phoneCore(p) {
    let n = String(p || '').replace(/\D/g, '');
    if (n.startsWith('256')) n = n.slice(3);
    if (n.startsWith('0') && n.length >= 10) n = n.slice(1);
    return n;
  }
  const searchCore = phoneCore('0743750320');
  check('sanity: the broken stored value cannot possibly match a real search for it', !phoneCore(userDoc(BROKEN).phone).includes(searchCore), { stored: userDoc(BROKEN).phone, searchCore });

  console.log('\n== Non-owner staff cannot correct a phone ==');
  await ownerCall('/admin/admins/create', { username: 'phr_staff', password: 'whatever-123' });
  const staffLogin = await call('POST', '/admin/login', { body: { username: 'phr_staff', password: 'whatever-123' } });
  r = await call('POST', '/admin/user/set-phone', { token: staffLogin.body?.token, body: { userId: BROKEN, phone: '0743750320' } });
  check('staff (non-owner) cannot set a phone', r.code === 401, r.body);
  check('phone still broken after the rejected staff attempt', userDoc(BROKEN).phone === '43750320', userDoc(BROKEN));

  console.log('\n== A badly-formatted "fix" is rejected outright ==');
  r = await ownerCall('/admin/user/set-phone', { userId: BROKEN, phone: 'not-a-real-number' });
  check('garbage correction rejected', r.code === 400, r.body);
  check('phone untouched by the rejected correction', userDoc(BROKEN).phone === '43750320', userDoc(BROKEN));

  console.log('\n== Owner corrects the phone to the member\'s real number ==');
  r = await ownerCall('/admin/user/set-phone', { userId: BROKEN, phone: '0743750320' });
  check('correction succeeds', r.body?.status === 'success', r.body);
  check('stored phone is now the real, normalized number', userDoc(BROKEN).phone === '+256743750320', userDoc(BROKEN));

  console.log('-- Now genuinely findable by the same search logic that failed before --');
  check('phoneCore of the corrected value now matches a real search for it', phoneCore(userDoc(BROKEN).phone).includes(searchCore) || phoneCore(userDoc(BROKEN).phone) === searchCore, { stored: userDoc(BROKEN).phone, searchCore });

  console.log('\n== A re-run of the integrity audit no longer flags the fixed account ==');
  r = await call('GET', '/admin/integrity', { adminKey: 'test-admin-key' });
  const stillFlagged = (r.body.alerts || []).find(a => a.kind === 'phone_malformed' && a.userId === BROKEN);
  check('BROKEN no longer appears in phone_malformed alerts', !stillFlagged, stillFlagged);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
