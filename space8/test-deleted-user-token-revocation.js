/* SPACE8 -- DELETED USER'S STALE TOKEN CAN NO LONGER RESURRECT THE ACCOUNT
   Codex-verified real bug (2026-08-18, HIGH severity): verifyIdToken() was
   called with no second argument, which only checks a token's SIGNATURE
   and expiry -- a stateless JWT check that never contacts Firebase to
   confirm the account still exists. A token issued minutes before an
   admin deletes the account stays cryptographically valid for up to an
   hour afterward. Since /register's own missing-doc self-heal recreates a
   fresh Mongo profile (including a brand-new welcome bonus) whenever the
   doc is gone, a deleted member replaying their still-valid old token
   against /register would silently undo the deletion.

   This test's Firebase mock is the key piece: unlike every other test-
   *.js file's mock (which never models revocation at all), this one
   tracks which uids have been "deleted" and makes verifyIdToken(token,
   checkRevoked) fail for a deleted uid ONLY when checkRevoked is true --
   exactly mirroring real Firebase Admin SDK behaviour. This means the
   test is a genuine regression guard: if the checkRevoked:true argument
   were ever removed from verifyAuth()/verifyAuthWithEmail() again, this
   file would fail, not just look coincidentally green.

   Proves:
     - a deleted user's still-valid token is now rejected (401) by
       /register, /account, and /deposit/marzpay alike -- the fix lives in
       the SHARED verifyAuth()/verifyAuthWithEmail() helpers, not a single
       endpoint, so it has to hold everywhere those are used
     - specifically, /register no longer resurrects the account: no new
       user document exists after the rejected attempt, no new welcome-
       bonus transaction was created
     - a NON-deleted, genuinely active user's token keeps working exactly
       as before (checkRevoked:true doesn't introduce false rejections for
       real, current sessions)

   Run: node test-deleted-user-token-revocation.js   (exits 0 = all green) */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '4304';

const Module = require('module');
const mockdb = require('./test-mockdb.js');
const dbPath = require.resolve('./db.js');
const dbMod = new Module(dbPath); dbMod.exports = mockdb; dbMod.loaded = true;
require.cache[dbPath] = dbMod;

// Tracks which uids have had admin.auth().deleteUser() called on them --
// verifyIdToken below consults this to decide whether checkRevoked should
// reject a given token, the same way real Firebase would once the account
// backing that token no longer exists.
const _deletedUids = new Set();
const faPath = require.resolve('firebase-admin');
const faMod = new Module(faPath);
faMod.exports = {
  initializeApp: () => {}, credential: { cert: () => ({}) },
  auth: () => ({
    verifyIdToken: async (tok, checkRevoked) => {
      if (!String(tok).startsWith('uid:')) throw new Error('invalid token');
      const uid = tok.slice(4);
      // The whole point of this mock: WITHOUT checkRevoked truthy, a
      // deleted user's token still verifies fine (matching real Firebase's
      // stateless-by-default behaviour) -- only checkRevoked:true makes
      // deletion actually matter, exactly like the real SDK.
      if (checkRevoked && _deletedUids.has(uid)) {
        const e = new Error('Firebase ID token has been revoked');
        e.code = 'auth/id-token-revoked';
        throw e;
      }
      return { uid, email: uid.replace(/\D/g, '') + '@space8.com' };
    },
    deleteUser: async (uid) => { _deletedUids.add(uid); },
  }),
};
faMod.loaded = true;
require.cache[faPath] = faMod;

require('./server.js');

const BASE = 'http://127.0.0.1:4304';
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
const transactions = () => collMap('transactions');

(async () => {
  await sleep(600);

  console.log('\n== Set up a normal member, confirm the account and their token both work ==');
  const UID = 'du-victim';
  const TOKEN = 'uid:' + UID;
  await call('POST', '/account/create-profile', { token: TOKEN, body: { phone: '0771980001' } });
  const reg = await call('POST', '/register', { token: TOKEN, body: {} });
  check('registration succeeded', reg.body?.status === 'success', reg.body);
  check('user doc exists right after registration', !!users().get(UID), users().get(UID));
  let r = await call('GET', '/account', { token: TOKEN });
  check('the account is reachable with the real token before deletion', r.body?.status === 'success', r.body);

  console.log('\n== Owner deletes the account ==');
  r = await ownerCall('/admin/user/delete', { userId: UID, confirm: 'DELETE' });
  check('admin delete succeeded', r.body?.status === 'success', r.body);
  check('user doc is genuinely gone from the database', !users().get(UID), users().get(UID));

  console.log('\n== The SAME still-cryptographically-valid token can no longer do anything as that account ==');
  r = await call('GET', '/account', { token: TOKEN });
  check('/account with the deleted user\'s old token -> 401, not a stale-but-successful read', r.code === 401, r.body);

  r = await call('POST', '/register', { token: TOKEN, body: {} });
  check('/register with the deleted user\'s old token -> 401 (rejected outright), not a resurrected profile', r.code === 401, r.body);
  check('THE ACTUAL INVARIANT: no user document was recreated for this uid', !users().get(UID), users().get(UID));
  const anyWelcomeBack = [...transactions().values()].some(t => t.userId === UID && t.description === 'Welcome gift');
  check('no new welcome-bonus transaction was created by the rejected resurrection attempt', !anyWelcomeBack);

  r = await call('POST', '/deposit/marzpay', { token: TOKEN, body: { amount: 50000, phone: '0771980001', network: 'MTN Mobile Money' } });
  check('/deposit/marzpay with the deleted user\'s old token -> 401, not a real deposit attempt on a ghost account', r.code === 401, r.body);

  console.log('\n== A genuinely active (never deleted) user\'s token keeps working exactly as before ==');
  const UID2 = 'du-still-alive';
  const TOKEN2 = 'uid:' + UID2;
  await call('POST', '/account/create-profile', { token: TOKEN2, body: { phone: '0771980002' } });
  await call('POST', '/register', { token: TOKEN2, body: {} });
  r = await call('GET', '/account', { token: TOKEN2 });
  check('checkRevoked:true does NOT introduce a false rejection for a real, active, undeleted user', r.body?.status === 'success', r.body);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
