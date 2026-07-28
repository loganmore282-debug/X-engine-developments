/* CHRONOVA — MULTI-ADMIN ACCOUNTS / SESSIONS / AUDIT LOG
   Boots the REAL server.js against an in-memory database and drives the new
   per-admin-account auth system end-to-end: owner master key still works,
   staff accounts login with their own username/password, a deactivated or
   password-reset account is locked out immediately (existing sessions die
   too, not just future logins), staff can never reach owner-only endpoints,
   repeated bad logins lock out that one username, and sensitive actions
   land in the audit log with the correct actor attached.
   Run:  node test-admin-accounts.js      (exits 0 = all green)                */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'super-secret-owner-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '3996';

const Module = require('module');
const mockdb = require('./test-mockdb.js');
const dbPath = require.resolve('./db.js');
const dbMod = new Module(dbPath); dbMod.exports = mockdb; dbMod.loaded = true;
require.cache[dbPath] = dbMod;

const faPath = require.resolve('firebase-admin');
const faMod = new Module(faPath);
faMod.exports = {
  initializeApp: () => {}, credential: { cert: () => ({}) },
  auth: () => ({
    verifyIdToken: async tok => { if (String(tok).startsWith('uid:')) return { uid: tok.slice(4) }; throw new Error('invalid token'); },
    updateUser: async () => ({}), createCustomToken: async uid => 'ct:' + uid,
  }),
};
faMod.loaded = true;
require.cache[faPath] = faMod;

require('./server.js');

const BASE = 'http://127.0.0.1:3996';
async function call(method, p, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (_) {}
  return { code: r.status, body: j };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}

(async () => {
  await sleep(300);

  console.log('\n── 1. Owner logs in with the master key, gets a session token');
  let r = await call('POST', '/admin/check-key', { body: { key: 'wrong-key' } });
  check('wrong master key rejected', r.code === 401, r.body);
  r = await call('POST', '/admin/check-key', { body: { key: 'super-secret-owner-key' } });
  check('correct master key accepted', r.body?.status === 'success' && !!r.body.token && r.body.role === 'owner', r.body);
  const ownerToken = r.body.token;
  r = await call('POST', '/admin/stats', { token: ownerToken, body: {} });
  check('owner session token works on a normal admin endpoint', r.body?.status === 'success', r.body);

  console.log('\n── 2. Owner creates a staff account; staff cannot yet do owner-only things');
  r = await call('POST', '/admin/admins/create', { token: ownerToken, body: { username: 'alice', password: 'correct horse battery' } });
  check('owner creates staff account "alice"', r.body?.status === 'success', r.body);
  r = await call('POST', '/admin/admins/create', { token: ownerToken, body: { username: 'alice', password: 'whatever12' } });
  check('duplicate username rejected', r.body?.status !== 'success', r.body);

  r = await call('POST', '/admin/login', { body: { username: 'alice', password: 'wrong password here' } });
  check('wrong password rejected', r.code === 401, r.body);
  r = await call('POST', '/admin/login', { body: { username: 'alice', password: 'correct horse battery' } });
  check('correct staff login succeeds', r.body?.status === 'success' && !!r.body.token && r.body.role === 'staff', r.body);
  const aliceToken = r.body.token;

  r = await call('POST', '/admin/stats', { token: aliceToken, body: {} });
  check('staff session works on a normal admin endpoint', r.body?.status === 'success', r.body);
  r = await call('POST', '/admin/admins/create', { token: aliceToken, body: { username: 'mallory', password: 'trytoescalate1' } });
  check('staff CANNOT create more admin accounts (owner-only)', r.code === 401, r.body);
  r = await call('POST', '/admin/admins/list', { token: aliceToken, body: {} });
  check('staff CANNOT list admin accounts (owner-only)', r.code === 401, r.body);

  console.log('\n── 3. Deactivating one account kills it immediately, others untouched');
  r = await call('POST', '/admin/admins/create', { token: ownerToken, body: { username: 'bob', password: 'another-good-pass1' } });
  check('owner creates a second staff account "bob"', r.body?.status === 'success', r.body);
  r = await call('POST', '/admin/login', { body: { username: 'bob', password: 'another-good-pass1' } });
  const bobToken = r.body?.token;
  check('bob logs in fine', r.body?.status === 'success' && !!bobToken, r.body);

  r = await call('POST', '/admin/admins/deactivate', { token: ownerToken, body: { username: 'alice' } });
  check('owner deactivates alice', r.body?.status === 'success', r.body);
  r = await call('POST', '/admin/stats', { token: aliceToken, body: {} });
  check('alice\'s EXISTING session token stops working the instant she is deactivated', r.code === 401, r.body);
  r = await call('POST', '/admin/login', { body: { username: 'alice', password: 'correct horse battery' } });
  check('alice cannot even log back in while deactivated', r.code === 401, r.body);
  r = await call('POST', '/admin/stats', { token: bobToken, body: {} });
  check('bob (never touched) is completely unaffected by alice\'s deactivation', r.body?.status === 'success', r.body);

  console.log('\n── 4. Resetting a password revokes that person\'s old sessions too');
  r = await call('POST', '/admin/admins/reset-password', { token: ownerToken, body: { username: 'bob', password: 'brand-new-password1' } });
  check('owner resets bob\'s password', r.body?.status === 'success', r.body);
  r = await call('POST', '/admin/stats', { token: bobToken, body: {} });
  check('bob\'s OLD session token is dead after the reset', r.code === 401, r.body);
  r = await call('POST', '/admin/login', { body: { username: 'bob', password: 'another-good-pass1' } });
  check('bob\'s OLD password no longer works', r.code === 401, r.body);
  r = await call('POST', '/admin/login', { body: { username: 'bob', password: 'brand-new-password1' } });
  check('bob logs in fine with the NEW password', r.body?.status === 'success', r.body);

  console.log('\n── 5. Per-username lockout after repeated failed logins');
  for (let i = 0; i < 5; i++) await call('POST', '/admin/login', { body: { username: 'carol-nobody', password: 'guess' + i } });
  r = await call('POST', '/admin/login', { body: { username: 'carol-nobody', password: 'guess-again' } });
  check('username gets locked out after 5 failed attempts', r.code === 429, r.body);

  console.log('\n── 6. Logout invalidates the session server-side');
  r = await call('POST', '/admin/login', { body: { username: 'bob', password: 'brand-new-password1' } });
  const bobToken2 = r.body?.token;
  r = await call('POST', '/admin/logout', { token: bobToken2, body: {} });
  check('logout call succeeds', r.body?.status === 'success', r.body);
  r = await call('POST', '/admin/stats', { token: bobToken2, body: {} });
  check('the logged-out token is dead — cannot be replayed', r.code === 401, r.body);

  console.log('\n── 7. Sensitive actions land in the audit log with the right actor');
  r = await call('POST', '/admin/settings/update', { token: ownerToken, body: { maintenanceMode: true } });
  check('owner flips maintenance mode on', r.body?.status === 'success', r.body);
  r = await call('POST', '/admin/settings/update', { token: ownerToken, body: { maintenanceMode: false } });
  check('owner flips it back off', r.body?.status === 'success', r.body);
  r = await call('POST', '/admin/audit-log', { token: ownerToken, body: {} });
  const log = r.body?.log || [];
  check('audit log is reachable and has entries', r.body?.status === 'success' && log.length > 0, log.length);
  check('audit log records the owner session actions as actor "owner"',
    log.some(e => e.actor === 'owner' && e.action === 'settings_updated'), log.map(e => e.actor + ':' + e.action));
  check('audit log recorded the admin_created / deactivated / password_reset actions too',
    ['admin_created', 'admin_deactivated', 'admin_password_reset'].every(a => log.some(e => e.action === a)),
    log.map(e => e.action));
  r = await call('POST', '/admin/audit-log', { token: bobToken, body: {} });
  check('staff CANNOT read the audit log (owner-only)', r.code === 401, r.body);

  console.log('\n── 8. Settings, Products and Banners are owner-only too');
  r = await call('POST', '/admin/settings', { token: ownerToken, body: {} });
  check('owner CAN read settings', r.body?.status === 'success', r.body);
  r = await call('POST', '/admin/settings', { token: bobToken, body: {} });
  check('staff CANNOT read settings', r.code === 401, r.body);
  r = await call('POST', '/admin/settings/update', { token: bobToken, body: { maintenanceMode: true } });
  check('staff CANNOT write settings', r.code === 401, r.body);
  r = await call('POST', '/admin/banners', { token: bobToken, body: {} });
  check('staff CANNOT read banners', r.code === 401, r.body);
  r = await call('POST', '/admin/banners/set', { token: bobToken, body: { key: 'bannerHero', url: 'https://evil.example/x.png' } });
  check('staff CANNOT write banners', r.code === 401, r.body);
  r = await call('POST', '/admin/products/list', { token: bobToken, body: {} });
  check('staff CANNOT list products', r.code === 401, r.body);
  r = await call('POST', '/admin/products/save', { token: bobToken, body: { label: 'Hijacked', price: 1 } });
  check('staff CANNOT create/edit products', r.code === 401, r.body);
  r = await call('POST', '/admin/products/clear', { token: bobToken, body: {} });
  check('staff CANNOT clear the product catalogue', r.code === 401, r.body);
  r = await call('POST', '/admin/products/list', { token: ownerToken, body: {} });
  check('owner CAN still list products', r.body?.status === 'success', r.body);
  r = await call('POST', '/admin/deposit', { token: bobToken, body: { userId: 'x', amount: 1000 } });
  check('staff CANNOT credit a wallet (owner-only)', r.code === 401, r.body);
  r = await call('POST', '/admin/deposit', { token: ownerToken, body: { userId: 'nonexistent-uid', amount: 1000 } });
  check('owner CAN reach the credit-wallet endpoint (fails on missing user, not auth)', r.code !== 401, r.body);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
