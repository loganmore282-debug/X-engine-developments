/* NOVERA SECURITY HARDENING AUDIT
   Proves — with real requests against the real server.js, not just a read
   of the code — that the protections the owner keeps asking about actually
   fire: NoSQL-operator injection is stripped from every request body
   before any handler sees it, staff admin logins get brute-force-locked
   after 5 wrong passwords (independent of the IP rate limiter), a staff
   account created by the owner can never escalate to the owner role no
   matter what it sends, expired admin sessions are rejected, and every
   response carries the security headers (HSTS, clickjacking, MIME-sniffing)
   that make the transport-level story real, not just a helmet() call
   nobody verified actually applies.

   Run: node test-security-hardening.js   (exits 0 = all green)           */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '4066';

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

const realFetch = global.fetch;
const BASE = 'http://127.0.0.1:4066';
async function call(method, p, { token, body, headers } = {}) {
  const h = { 'Content-Type': 'application/json', ...(headers || {}) };
  if (token) h.Authorization = 'Bearer ' + token;
  const r = await realFetch(BASE + p, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (_) {}
  return { code: r.status, body: j, headers: r.headers };
}
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
const userDoc = id => users().get(id);

(async () => {
  await new Promise(r => setTimeout(r, 600));

  console.log('\n== Security headers are actually present on real responses ==');
  let r = await call('GET', '/health');
  check('Strict-Transport-Security (HSTS) present', /max-age=\d+/.test(r.headers.get('strict-transport-security') || ''), r.headers.get('strict-transport-security'));
  check('X-Frame-Options blocks clickjacking (DENY)', (r.headers.get('x-frame-options') || '').toUpperCase() === 'DENY', r.headers.get('x-frame-options'));
  check('X-Content-Type-Options prevents MIME-sniffing', (r.headers.get('x-content-type-options') || '').toLowerCase() === 'nosniff', r.headers.get('x-content-type-options'));
  check('Referrer-Policy set', !!r.headers.get('referrer-policy'), r.headers.get('referrer-policy'));

  console.log('\n== NoSQL-operator injection is stripped from every request body ==');
  await call('POST', '/account/create-profile', { token: 'uid:injtest', body: { phone: '0771000060' } });
  await call('POST', '/register', { token: 'uid:injtest', body: {} });
  // A classic NoSQL injection attempt: try to make an "equality" check
  // always match by sending an operator object instead of a real value.
  r = await call('POST', '/withdraw/request', { token: 'uid:injtest', body: { amount: { '$gt': 0 }, holder: 'x', network: { '$ne': null }, phone: '700111222' } });
  check('operator-object amount is rejected as invalid, never coerced into a real query', r.code === 400, r.body);
  const stored = userDoc('injtest');
  check('no injected operator ever survives into the stored user doc', JSON.stringify(stored).indexOf('$gt') === -1 && JSON.stringify(stored).indexOf('$ne') === -1, stored);
  // Directly probe stripMongoOperators' effect via the login endpoint,
  // which reads username/password straight off req.body.
  r = await call('POST', '/admin/login', { body: { username: { '$ne': null }, password: { '$ne': null } } });
  check('login with operator-object credentials is rejected, not an auth bypass', r.code === 400 || r.code === 401, r.body);

  console.log('\n== Admin login: brute-force lockout is independent of the IP rate limiter ==');
  await call('POST', '/admin/admins/create', { headers: { Authorization: 'Bearer test-admin-key' }, body: { username: 'bruteforcetarget', password: 'correct-horse-battery' } });
  // The 5th failure itself still returns a plain 401 (the lock is armed by
  // that failure but only takes effect on the NEXT request) — the 6th
  // attempt is what proves the lockout actually engaged.
  for (let i = 0; i < 5; i++) {
    await call('POST', '/admin/login', { body: { username: 'bruteforcetarget', password: 'wrong-guess-' + i } });
  }
  r = await call('POST', '/admin/login', { body: { username: 'bruteforcetarget', password: 'wrong-guess-5' } });
  check('6th attempt is locked out (not just rejected as wrong credentials)', r.code === 429, r.body);
  r = await call('POST', '/admin/login', { body: { username: 'bruteforcetarget', password: 'correct-horse-battery' } });
  check('even the CORRECT password is locked out during the lockout window', r.code === 429, r.body);

  console.log('\n-- A different, never-attacked username logs in normally at the same time --');
  await call('POST', '/admin/admins/create', { headers: { Authorization: 'Bearer test-admin-key' }, body: { username: 'innocentstaff', password: 'a-real-password-99' } });
  r = await call('POST', '/admin/login', { body: { username: 'innocentstaff', password: 'a-real-password-99' } });
  check('unrelated account is unaffected by another account\'s lockout', r.body?.status === 'success', r.body);
  const staffToken = r.body?.token;

  console.log('\n== A staff-created account can never escalate to the owner role ==');
  check('login grants "staff" role, never "owner", for any account made via /admin/admins/create', r.body?.role === 'staff', r.body?.role);
  r = await call('GET', '/admin/users', { token: staffToken });
  check('staff session CAN do ordinary any-admin-readable work (view users)', r.body?.status === 'success', r.body);
  r = await call('GET', '/admin/admins/list', { token: staffToken });
  check('staff session CANNOT list other admin accounts (owner-only)', r.code === 401, r.body);
  r = await call('POST', '/admin/deposit', { token: staffToken, body: { userId: 'injtest', amount: 999999, note: 'staff trying an owner-only credit' } });
  check('staff session is REJECTED from an owner-only money action (wallet credit)', r.code === 401, r.body);
  check('no money was actually credited by the rejected attempt', (userDoc('injtest').walletBalance || 0) < 999999, userDoc('injtest').walletBalance);
  r = await call('POST', '/admin/admins/create', { token: staffToken, body: { username: 'staffmadeadmin', password: 'whatever123' } });
  check('staff session cannot create MORE admin accounts (owner-only)', r.code === 401, r.body);
  r = await call('POST', '/admin/products/clear', { token: staffToken, body: {} });
  check('staff session cannot run the destructive "clear all products" action (owner-only)', r.code === 401, r.body);

  console.log('\n== Session tokens are real, unguessable, and actually expire ==');
  check('session token is 64 hex chars (256 bits of real randomness, not a guessable id)', /^[0-9a-f]{64}$/.test(staffToken || ''), staffToken);
  r = await call('GET', '/admin/admins/list', { token: 'a'.repeat(64) });
  check('a random 64-hex-char token that was never actually issued is rejected', r.code === 401, r.body);
  // Directly age the session doc past its TTL to prove expiry is enforced,
  // not just set-and-forgotten.
  const sessions = collMap('adminSessions');
  const sessDoc = sessions.get(staffToken);
  check('session was actually persisted server-side to look up later', !!sessDoc, sessDoc);
  sessions.set(staffToken, Object.assign({}, sessDoc, { expiresAt: new Date(Date.now() - 1000) }));
  r = await call('GET', '/admin/admins/list', { token: staffToken });
  check('an expired session token is rejected even though it was once valid', r.code === 401, r.body);

  console.log('\n== Passwords are never stored in plaintext ==');
  const staffDoc = collMap('adminUsers').get('innocentstaff');
  check('stored passwordHash never contains the raw password', staffDoc && !JSON.stringify(staffDoc).includes('a-real-password-99'), staffDoc);
  check('passwordHash is salt:hash formatted (scrypt), not a raw/plain value', staffDoc && /^[0-9a-f]{32}:[0-9a-f]{128}$/.test(staffDoc.passwordHash || ''), staffDoc?.passwordHash);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
