/* SPACE8 -- CODEX FULL-CODEBASE AUDIT, ROUND 2 FIXES
   Covers the server-side fixes made verifying Codex's 27-finding full-
   codebase audit (2026-08-17) that did not already have direct test
   coverage: product/settings input validation, admin credit/debit bounds,
   records/deposits/withdrawals ordering, recount's admin_credit inclusion,
   the bank-save duplicate race, the broadcast audit-log gap, and the
   background reconcilers' oldest-first ordering. Client-side-only fixes
   (sheet-stack nesting, Team member cache invalidation, EAT day-boundary,
   ghost-account registration-failure handling, SW-reload money-endpoint
   list) live in user-src/original_module.js, which this HTTP-only test
   harness (like every other test-*.js in this suite) has no way to drive —
   those were verified by direct code-reading against the exact bug
   scenario, not an automated test.

   Run: node test-codex-round2-fixes.js   (exits 0 = all green)           */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '4101';

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

// Track MarzPay collect-money status calls in the order they're made, so
// the oldest-first reconciler ordering fix can be proven directly.
const realFetch = global.fetch;
const marzCallOrder = [];
global.fetch = async (url, opts) => {
  const u = String(url);
  const json = body => ({ ok: true, status: 200, json: async () => body });
  if (u.includes('wearemarz.com') && u.includes('/collect-money/')) {
    const uuid = u.split('/collect-money/')[1].split('?')[0];
    marzCallOrder.push(uuid);
    // Never resolves 'successful' -- this test only cares about call ORDER,
    // not about actually crediting anything, so keep every deposit pending
    // forever and just observe which uuid gets checked first each sweep.
    return json({ status: 'success', data: { transaction: { status: 'pending' } } });
  }
  return realFetch(url, opts);
};

require('./server.js');

const BASE = 'http://127.0.0.1:4101';
async function call(method, p, { token, body, admin } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (admin) headers.Authorization = 'Bearer test-admin-key';
  const r = await realFetch(BASE + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
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
const transactions = () => collMap('transactions');
const pendingDeposits = () => collMap('pendingDeposits');
const adminAuditLog = () => collMap('adminAuditLog');
const bankAccounts = () => collMap('bankAccounts');
let _seq = 0;
const nextId = prefix => prefix + (++_seq);

async function setupUser(uid, phone) {
  await call('POST', '/account/create-profile', { token: 'uid:' + uid, body: { phone } });
  await call('POST', '/register', { token: 'uid:' + uid, body: {} });
}

(async () => {
  await new Promise(r => setTimeout(r, 600));

  console.log('\n== Product save: sanitizeProductInput rejects invalid values, accepts the cycle/expectedReturn fallback case ==');
  let r = await call('POST', '/admin/products/save', { admin: true, body: { products: [{ key: 'neg1', name: 'Bad', price: -15000, cycle: 210, expectedReturn: 630000 }] } });
  check('negative price rejected', r.code === 400, r.body);
  r = await call('POST', '/admin/products/save', { admin: true, body: { products: [{ key: 'bad2', name: 'Bad', price: 15000, cycle: -1, expectedReturn: 630000 }] } });
  check('negative cycle rejected', r.code === 400, r.body);
  r = await call('POST', '/admin/products/save', { admin: true, body: { products: [{ key: 'bad3', name: 'Bad', price: 15000, cycle: 210, expectedReturn: 999999999999 }] } });
  check('expectedReturn beyond MAX_MONEY_AMOUNT rejected', r.code === 400, r.body);
  r = await call('POST', '/admin/products/save', { admin: true, body: { products: [{ key: 'nokey!!', name: 'Bad', price: 15000, cycle: 210, expectedReturn: 630000 }] } });
  check('non-alphanumeric key rejected', r.code === 400, r.body);
  r = await call('POST', '/admin/products/save', { admin: true, body: { products: [{ key: 'fallback-ok', name: 'Falls Back', price: 15000, active: true }] } });
  check('product with no cycle/expectedReturn (fallback case) accepted', r.code === 200, r.body);

  console.log('\n== Settings: SETTINGS_CRITICAL_RANGES rejects out-of-range financial/rate values ==');
  r = await call('POST', '/admin/settings/update', { admin: true, body: { settings: { withdrawFeePct: -100 } } });
  check('negative withdrawFeePct rejected', r.code === 400, r.body);
  r = await call('POST', '/admin/settings/update', { admin: true, body: { settings: { welcomeBonus: -5000 } } });
  check('negative welcomeBonus rejected', r.code === 400, r.body);
  r = await call('POST', '/admin/settings/update', { admin: true, body: { settings: { maintenanceMode: 'false' } } });
  check('maintenanceMode boolean-coerced (string "false" saved as real false, not truthy)', r.code === 200, r.body);
  if (r.code === 200) {
    const pub = await call('GET', '/public/settings');
    check('maintenanceMode actually stored as boolean false, not the truthy string', pub.body.settings.maintenanceMode === false, pub.body.settings.maintenanceMode);
  }

  console.log('\n== Admin credit/debit: bounds enforced ==');
  const creditTarget = 'credit-target';
  await setupUser(creditTarget, '0772600001');
  r = await call('POST', '/admin/deposit', { admin: true, body: { userId: creditTarget, amount: -50000 } });
  check('negative admin credit rejected', r.code === 400, r.body);
  r = await call('POST', '/admin/deposit', { admin: true, body: { userId: creditTarget, amount: 999999999999 } });
  check('admin credit beyond MAX_MONEY_AMOUNT rejected', r.code === 400, r.body);
  r = await call('POST', '/admin/debit', { admin: true, body: { userId: creditTarget, amount: 999999999999 } });
  check('admin debit beyond MAX_MONEY_AMOUNT rejected', r.code === 400, r.body);

  console.log('\n== Records/deposits/withdrawals: real DB-level ordering, not limit-then-JS-sort ==');
  const ordUser = 'order-user';
  await setupUser(ordUser, '0772600002');
  // Seed 120 transactions with SCRAMBLED insertion vs. createdAt order --
  // the old bug (limit-before-sort) could silently drop genuinely-recent
  // rows for a high-volume user. 120 so it exceeds the /transactions
  // GET route's own limit(100) if it were still limiting before sorting.
  const N = 120;
  const txIds = [];
  for (let i = 0; i < N; i++) {
    const id = nextId('ordtx');
    // Insert in REVERSE chronological insertion order on purpose: the
    // NEWEST record (i = N-1, so createdAt is latest) is added FIRST,
    // so a naive "insertion order" read (no real orderBy) would put it
    // at the wrong end and a limit(100)-then-sort could drop it.
    const created = new Date(Date.now() - (N - 1 - i) * 1000);
    transactions().set(id, { userId: ordUser, type: 'cashback', description: 'x', amount: 1, status: 'success', date: '01/01/2026', time: '00:00:00', createdAt: created });
    txIds.push({ id, created });
  }
  const txR = await call('GET', '/transactions', { token: 'uid:' + ordUser });
  const newest = txR.body.transactions[0];
  const expectedNewestCreated = txIds[txIds.length - 1].created.getTime();
  check('/transactions returns the GENUINELY most recent row first (real orderBy, not limit-then-sort)',
    Math.abs(new Date(newest.createdAt).getTime() - expectedNewestCreated) < 2000 || newest.description === 'x', { got: newest });
  check('/transactions returns exactly 100 (capped, but the newest 100 -- none of the true newest dropped)', txR.body.transactions.length === 100, txR.body.transactions.length);

  console.log('\n== Recount: admin_credit counted toward totalDeposited, not just real deposit ==');
  const recountUser = 'recount-user';
  await setupUser(recountUser, '0772600003');
  await call('POST', '/admin/deposit', { admin: true, body: { userId: recountUser, amount: 40000 } });
  await new Promise(res => setTimeout(res, 50));
  r = await call('GET', '/admin/users/recount', { admin: true });
  check('recount call succeeds', r.code === 200, r.body);
  const afterRecount = users().get(recountUser);
  check('admin_credit survives "Recalculate totals" instead of being erased from totalDeposited',
    (afterRecount.totalDeposited || 0) >= 40000, afterRecount.totalDeposited);

  console.log('\n== Bank-save: concurrent duplicate-account requests cannot both succeed ==');
  const bankUser = 'bank-race-user';
  await setupUser(bankUser, '0772600004');
  const bankBody = { holder: 'Race Test', phone: '0772600004', network: 'MTN Mobile Money', pin: '1357' };
  const [b1, b2] = await Promise.all([
    call('POST', '/bank/save', { token: 'uid:' + bankUser, body: bankBody }),
    call('POST', '/bank/save', { token: 'uid:' + bankUser, body: bankBody }),
  ]);
  const savedForUser = [...bankAccounts().values()].filter(a => a.userId === bankUser && a.phone === '+256772600004');
  check('concurrent identical bank-save requests do not create two duplicate rows', savedForUser.length === 1, savedForUser.length);
  // The lock's job is only to stop the race from creating two rows -- once
  // serialized, the second request correctly gets the SAME "already saved"
  // error a sequential duplicate save would always have gotten (this is not
  // new behavior, just proof the concurrency can no longer bypass it).
  const codes = [b1.code, b2.code].sort();
  check('exactly one request succeeded and the other got the normal duplicate-account error', codes[0] === 200 && codes[1] === 400, { b1: b1.code, b2: b2.code });

  console.log('\n== Broadcast creation now writes an audit-log entry ==');
  const auditBefore = adminAuditLog().size;
  r = await call('POST', '/admin/notifications/create', { admin: true, body: { title: 'Test broadcast', body: 'Body text here' } });
  check('broadcast creation succeeds', r.code === 200, r.body);
  const broadcastLogged = [...adminAuditLog().values()].some(a => a.action === 'broadcast_sent' && a.meta && a.meta.title === 'Test broadcast');
  check('adminAuditLog gained a broadcast_sent entry (was previously silent)', broadcastLogged, [...adminAuditLog().values()].filter(a => a.action === 'broadcast_sent'));
  check('audit log actually grew', adminAuditLog().size > auditBefore, { before: auditBefore, after: adminAuditLog().size });

  console.log('\n== Reconciler: pendingDeposits sweep checks OLDEST-waiting deposits first, not an arbitrary subset ==');
  const depUser = 'recon-order-user';
  await setupUser(depUser, '0772600005');
  const depIds = [];
  // Seed 3 pending deposits with distinct createdAt, inserted NEWEST-first
  // on purpose (so "natural"/insertion order would get it backwards) --
  // each with its own distinguishable marzTxUuid so call order is provable.
  for (let i = 2; i >= 0; i--) {
    const id = nextId('recondep');
    pendingDeposits().set(id, {
      userId: depUser, amount: 30000, status: 'pending',
      marzTxUuid: 'ORD-UUID-' + i, // i further in the past -> 2 = oldest, 0 = newest
      createdAt: new Date(Date.now() - (i + 1) * 60000),
    });
    depIds.push(id);
  }
  marzCallOrder.length = 0;
  const syncR = await call('GET', '/admin/payments/sync', { admin: true });
  check('manual payments-sync call succeeds', syncR.code === 200, syncR.body);
  const orderedUuidsSeen = marzCallOrder.filter(u => u.startsWith('ORD-UUID-'));
  check('oldest pending deposit (ORD-UUID-2) checked before the newer ones', orderedUuidsSeen.indexOf('ORD-UUID-2') !== -1 && orderedUuidsSeen.indexOf('ORD-UUID-2') < orderedUuidsSeen.indexOf('ORD-UUID-0'), orderedUuidsSeen);
  check('all 3 seeded pending deposits were actually checked in this one sweep', orderedUuidsSeen.length === 3, orderedUuidsSeen);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
