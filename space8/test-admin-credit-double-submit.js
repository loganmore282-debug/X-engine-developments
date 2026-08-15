/* SPACE8 ADMIN CREDIT/DEBIT DOUBLE-SUBMIT AUDIT
   Owner reported a manual admin credit landing TWICE on the same user --
   unsure whether it was a network retry or a double-tap in the admin
   panel. Turned out BOTH layers were unprotected: the admin panel's
   Credit/Debit buttons never disabled themselves while a request was in
   flight (client-side double-submit fixed separately in admin-src/index.html),
   and /admin/deposit + /admin/debit had zero server-side protection against
   two genuinely-concurrent requests crediting/debiting the same user twice.

   Proves, against the real server:
     - two truly concurrent /admin/deposit calls for the SAME user only
       ever apply once -- the second is refused (429), wallet moves by
       exactly one credit's worth, only one admin_credit transaction exists
     - same proof for /admin/debit
     - the debounce is keyed per-user: crediting a DIFFERENT user right
       after is never blocked by the first user's recent credit
     - the debounce is a cooldown, not permanent -- once it expires, a
       genuinely new credit on the same user goes through normally

   Run: node test-admin-credit-double-submit.js   (exits 0 = all green)  */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '4106';

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

const BASE = 'http://127.0.0.1:4106';
async function call(method, p, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await fetch(BASE + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (_) {}
  return { code: r.status, body: j };
}
async function ownerCall(path, body) {
  const r = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-admin-key' }, body: JSON.stringify(body || {}) });
  let j = null; try { j = await r.json(); } catch (_) {}
  return { code: r.status, body: j };
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

async function setupUser(uid, phone) {
  await call('POST', '/account/create-profile', { token: 'uid:' + uid, body: { phone } });
  await call('POST', '/register', { token: 'uid:' + uid, body: {} });
}

(async () => {
  await new Promise(r => setTimeout(r, 600));

  console.log('\n== Two genuinely concurrent /admin/deposit calls for the SAME user only apply once ==');
  const A = 'dup-credit-user';
  await setupUser(A, '0771000901');
  const balBefore = userDoc(A).walletBalance;
  const [r1, r2] = await Promise.all([
    ownerCall('/admin/deposit', { userId: A, amount: 50000, note: 'compensation' }),
    ownerCall('/admin/deposit', { userId: A, amount: 50000, note: 'compensation' }),
  ]);
  const codes = [r1.code, r2.code].sort();
  check('exactly one of the two concurrent requests succeeds, the other is refused (429)', codes[0] === 200 && codes[1] === 429, { r1: r1.code, r2: r2.code });
  check('wallet moved by exactly ONE credit, not two', userDoc(A).walletBalance === balBefore + 50000, userDoc(A).walletBalance);
  // Registration's own welcome-gift bonus also writes an 'admin_credit'
  // transaction (a separate, pre-existing, unrelated feature) -- filter to
  // just this test's own credit by its description so that doesn't produce
  // a false positive here.
  const credits = [...collMap('transactions').values()].filter(t => t.userId === A && t.type === 'admin_credit' && t.description === 'compensation');
  check('exactly one admin_credit transaction record exists for THIS credit, not two', credits.length === 1, credits);

  console.log('\n== Same proof for /admin/debit ==');
  const B = 'dup-debit-user';
  await setupUser(B, '0771000902');
  await ownerCall('/admin/deposit', { userId: B, amount: 200000, note: 'seed funds' });
  await new Promise(r => setTimeout(r, 10100)); // clear B's own credit debounce before testing debit
  const balBeforeDebit = userDoc(B).walletBalance;
  const [d1, d2] = await Promise.all([
    ownerCall('/admin/debit', { userId: B, amount: 30000, note: 'correction' }),
    ownerCall('/admin/debit', { userId: B, amount: 30000, note: 'correction' }),
  ]);
  const dcodes = [d1.code, d2.code].sort();
  check('exactly one of the two concurrent debit requests succeeds, the other refused (429)', dcodes[0] === 200 && dcodes[1] === 429, { d1: d1.code, d2: d2.code });
  check('wallet moved by exactly ONE debit, not two', userDoc(B).walletBalance === balBeforeDebit - 30000, userDoc(B).walletBalance);
  const debits = [...collMap('transactions').values()].filter(t => t.userId === B && t.type === 'admin_debit');
  check('exactly one admin_debit transaction record exists, not two', debits.length === 1, debits);

  console.log('\n== The debounce is per-user -- crediting a DIFFERENT user is never blocked by A\'s recent credit ==');
  const C = 'unrelated-user';
  await setupUser(C, '0771000903');
  const rC = await ownerCall('/admin/deposit', { userId: C, amount: 10000, note: 'unrelated' });
  check('a fresh credit to a different, unrelated user succeeds immediately', rC.body?.status === 'success', rC.body);

  console.log('\n== The debounce is a cooldown, not permanent -- a later genuine credit on the same user still works ==');
  await new Promise(r => setTimeout(r, 10100));
  const balBeforeLater = userDoc(A).walletBalance;
  const rLater = await ownerCall('/admin/deposit', { userId: A, amount: 15000, note: 'later, separate credit' });
  check('a genuinely later credit (after the cooldown) succeeds normally', rLater.body?.status === 'success', rLater.body);
  check('wallet reflects that later credit', userDoc(A).walletBalance === balBeforeLater + 15000, userDoc(A).walletBalance);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
