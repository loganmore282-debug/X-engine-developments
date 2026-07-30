/* CHRONOVA — Recently-FAILED deposits are automatically re-verified against
   the real gateway and credited if the money actually landed.
   A user who says "I paid but never got credited" is usually right that the
   payment cleared — our side just marked it 'failed' early (a cancelled
   status-poll, a timeout, a transient gateway hiccup). pollPendingPayments()
   already re-checks every 'processing' deposit on a 30s cron; this proves it
   ALSO re-checks recently-'failed' ones and credits them the moment the real
   gateway confirms success — fully automatic, no admin click needed — while
   a stale (>48h) failed deposit is correctly left alone.
   Run:  node test-deposit-reconcile.js      (exits 0 = all green)           */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '3999';

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

// Stub MarzPay's collect-money status-check endpoint only — everything else
// (send-money, etc.) falls through to the real fetch (unused in this test).
const realFetch = global.fetch;
const collectStatusMap = new Map(); // uuid -> status
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  const json = body => ({ ok: true, status: 200, json: async () => body });
  const m = u.match(/\/collect-money\/([^/]+)$/);
  if (m) return json({ data: { transaction: { status: collectStatusMap.get(m[1]) || 'pending' } } });
  return realFetch(url, opts);
};

require('./server.js');

const BASE = 'http://127.0.0.1:3999';
async function call(method, p, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await realFetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (_) {}
  return { code: r.status, body: j };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}
const ADMIN = { adminKey: 'test-admin-key' };
function seedUser(uid, overrides = {}) {
  mockdb.__store.get('users') || mockdb.__store.set('users', new Map());
  mockdb.__store.get('users').set(uid, {
    registrationDone: true, walletBalance: 0, totalDeposited: 0, realDeposited: 0,
    name: uid, phone: '0771000001', status: 'active', ...overrides,
  });
}
function seedDeposit(id, uid, overrides = {}) {
  mockdb.__store.get('pendingDeposits') || mockdb.__store.set('pendingDeposits', new Map());
  mockdb.__store.get('pendingDeposits').set(id, {
    userId: uid, phone: '0771000001', amount: 40000, status: 'failed', marzReference: 'ref-' + id,
    marzTxUuid: 'MTX-' + id, failedAt: new Date(), createdAt: new Date(), ...overrides,
  });
  return id;
}

(async () => {
  await sleep(1200);

  console.log('\n── Recently-FAILED deposits are auto-revived if the gateway actually confirms success');
  seedUser('gina-uid');
  seedDeposit('dep-gina-1', 'gina-uid');
  collectStatusMap.set('MTX-dep-gina-1', 'successful'); // MarzPay: it actually landed

  seedUser('hank-uid');
  seedDeposit('dep-hank-1', 'hank-uid');
  collectStatusMap.set('MTX-dep-hank-1', 'failed'); // MarzPay: genuinely never paid — must stay failed

  seedUser('ivy-uid');
  seedDeposit('dep-ivy-old', 'ivy-uid', { failedAt: new Date(Date.now() - 100 * 3600000), createdAt: new Date(Date.now() - 100 * 3600000) });
  collectStatusMap.set('MTX-dep-ivy-old', 'successful'); // would also credit if wrongly re-checked — must NOT be, it's stale

  const r = await call('POST', '/admin/payments/sync', { body: { ...ADMIN } });
  check('sync call succeeds', r.body?.status === 'success', r.body);

  const gina = mockdb.__store.get('users').get('gina-uid');
  check('gina (recently failed, gateway says it landed) was credited automatically', gina.walletBalance === 40000, gina.walletBalance);
  const ginaDep = mockdb.__store.get('pendingDeposits').get('dep-gina-1');
  check('her deposit doc now shows matched', ginaDep.status === 'matched', ginaDep.status);

  const hank = mockdb.__store.get('users').get('hank-uid');
  check('hank (recently failed, gateway confirms it truly failed) is NOT credited', hank.walletBalance === 0, hank.walletBalance);

  const ivy = mockdb.__store.get('users').get('ivy-uid');
  check('ivy (stale >48h failure) is left alone even though the gateway would say success — bounded lookback, not ancient history', ivy.walletBalance === 0, ivy.walletBalance);
  const ivyDep = mockdb.__store.get('pendingDeposits').get('dep-ivy-old');
  check('her old deposit stays failed, untouched', ivyDep.status === 'failed', ivyDep.status);

  // Running the sync again must never double-credit gina.
  const r2 = await call('POST', '/admin/payments/sync', { body: { ...ADMIN } });
  check('running sync again succeeds', r2.body?.status === 'success', r2.body);
  const ginaAfter = mockdb.__store.get('users').get('gina-uid');
  check('gina was NOT double-credited by a second sync', ginaAfter.walletBalance === 40000, ginaAfter.walletBalance);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('SUITE CRASH:', e); process.exit(1); });
