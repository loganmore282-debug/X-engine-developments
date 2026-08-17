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

   Extended after asking Codex to re-verify these fixes against the code:
   it confirmed most, found 6 real gaps (a fractional-price product could
   round to a free UGX-0 plan, delete-user's team-count math was wrong for
   a multi-level chain, a purchase could charge stale price/cycle/return
   after an admin edit mid-request, a few assistant replies still claimed
   no deposit/withdrawal cap, Team's Pending->Active cache staleness, and a
   real shared-device data leak through open sheets/notifications/the live-
   refresh timer that authEpoch didn't yet cover everywhere) -- all fixed,
   the two highest-value ones (zero-cost product, delete-user team counts)
   get direct coverage below.

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
  auth: () => ({
    verifyIdToken: async tok => { if (String(tok).startsWith('uid:')) return { uid: tok.slice(4) }; throw new Error('bad'); },
    deleteUser: async () => {}, // /admin/user/delete's Firebase-first step -- always "succeeds" here
  }),
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
  // Codex-verified real test gap (2026-08-17): the original version of this
  // check asserted `... || newest.description === 'x'`, and every seeded
  // row shared that same description -- the ordering half of the OR could
  // never actually fail, so this never proved anything about order. Each
  // seeded row now carries a UNIQUE marker in its description (its
  // insertion index) instead, so asserting on that marker is an exact,
  // non-vacuous proof of which row genuinely landed first -- and all three
  // endpoints (not just /transactions) are covered.
  async function assertNewestFirst(kind, endpoint, coll, extraFields, tokenPrefix) {
    const user = tokenPrefix + '-order-user';
    // Seeded directly rather than via /account/create-profile + /register --
    // /register's own welcome-bonus write adds an EXTRA transaction row
    // outside this test's control, which would shift the expected marker
    // positions below by one. Same "seed the doc shape directly" technique
    // test-reconciler-caps.js already uses for this exact reason.
    users().set(user, {
      phone: '077260' + (tokenPrefix === 'tx' ? '0010' : tokenPrefix === 'dep' ? '0011' : '0012'),
      walletBalance: 0, totalDeposited: 0, totalEarned: 0, totalWithdrawn: 0, totalInvested: 0,
      registrationDone: true, status: 'active', teamL1Count: 0, teamL2Count: 0, teamL3Count: 0,
    });
    const N = 120; // exceeds the route's own limit(100)
    const ids = [];
    for (let i = 0; i < N; i++) {
      const id = nextId(tokenPrefix + 'ord');
      // Insert in REVERSE chronological insertion order on purpose: the
      // NEWEST record (i = N-1) is added FIRST, so a naive "insertion
      // order" read (no real orderBy) would put it at the wrong end and a
      // limit(100)-then-sort could drop it.
      const created = new Date(Date.now() - (N - 1 - i) * 1000);
      coll().set(id, Object.assign({ userId: user, createdAt: created, marker: 'M' + i }, extraFields(i)));
      ids.push(id);
    }
    const r = await call('GET', endpoint, { token: 'uid:' + user });
    const items = r.body[kind] || [];
    check(endpoint + ' returns exactly 100 (capped, but the newest 100 -- none of the true newest dropped)', items.length === 100, items.length);
    check(endpoint + " returns the GENUINELY newest row (marker 'M119') first -- exact match, not a vacuous OR",
      items[0] && items[0].marker === 'M119', items[0]);
    check(endpoint + " row 99 back is marker 'M20' (the 100th-newest), proving the whole window is correctly ordered, not just the first row",
      items[99] && items[99].marker === 'M20', items[99]);
  }
  await assertNewestFirst('transactions', '/transactions', transactions,
    i => ({ type: 'cashback', description: 'x', amount: 1, status: 'success', date: '01/01/2026', time: '00:00:00' }), 'tx');
  await assertNewestFirst('deposits', '/deposits', pendingDeposits,
    i => ({ amount: 1000, status: 'matched', date: '01/01/2026', time: '00:00:00' }), 'dep');
  await assertNewestFirst('withdrawals', '/withdrawals', () => collMap('withdrawals'),
    i => ({ amount: 20000, net: 17000, status: 'processed', date: '01/01/2026', time: '00:00:00' }), 'wit');

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

  console.log('\n== Product save: fractional price/expectedReturn can no longer round down to a free (UGX 0) product ==');
  r = await call('POST', '/admin/products/save', { admin: true, body: { products: [{ key: 'zerocost', name: 'Zero Cost', price: 0.4, cycle: 1, expectedReturn: 1000 }] } });
  check('price:0.4 (rounds to 0) rejected, not silently saved as a free product', r.code === 400, r.body);
  r = await call('POST', '/admin/products/save', { admin: true, body: { products: [{ key: 'zeroret', name: 'Zero Return', price: 15000, cycle: 1, expectedReturn: 0.4 }] } });
  check('expectedReturn:0.4 (rounds to 0) also rejected', r.code === 400, r.body);
  const zeroCostSaved = [...collMap('products').values()].some(p => p.key === 'zerocost');
  check('the rejected zero-cost product was never actually persisted', !zeroCostSaved, zeroCostSaved);

  console.log('\n== Delete-user: team counts correctly recomputed for a multi-level chain, not just decremented by 1 ==');
  // A -> B -> C -> D. Delete B. True post-delete tree is A -> C -> D, so A's
  // counts should become L1=1 (C, was L2)/L2=1 (D, was L3)/L3=0 -- NOT the
  // old buggy behavior of just decrementing A's L1Count by 1 and leaving
  // L2/L3 untouched (which left A at L1=0/L2=1/L3=1, the exact wrong values
  // Codex reproduced).
  const A = 'chain-A', B = 'chain-B', C = 'chain-C', D = 'chain-D';
  users().set(A, { phone: '0772610001', walletBalance: 0, totalDeposited: 0, totalEarned: 0, totalWithdrawn: 0, totalInvested: 0, referredBy: null, registrationDone: true, status: 'active', teamL1Count: 1, teamL2Count: 1, teamL3Count: 1 });
  users().set(B, { phone: '0772610002', walletBalance: 0, totalDeposited: 0, totalEarned: 0, totalWithdrawn: 0, totalInvested: 0, referredBy: A, registrationDone: true, status: 'active', teamL1Count: 1, teamL2Count: 1, teamL3Count: 0 });
  users().set(C, { phone: '0772610003', walletBalance: 0, totalDeposited: 0, totalEarned: 0, totalWithdrawn: 0, totalInvested: 0, referredBy: B, registrationDone: true, status: 'active', teamL1Count: 1, teamL2Count: 0, teamL3Count: 0 });
  users().set(D, { phone: '0772610004', walletBalance: 0, totalDeposited: 0, totalEarned: 0, totalWithdrawn: 0, totalInvested: 0, referredBy: C, registrationDone: true, status: 'active', teamL1Count: 0, teamL2Count: 0, teamL3Count: 0 });
  const delR = await call('POST', '/admin/user/delete', { admin: true, body: { userId: B, confirm: 'DELETE' } });
  check('delete succeeds', delR.code === 200, delR.body);
  const cAfter = users().get(C);
  check('C reparented directly onto A (was B -> A, B deleted)', cAfter.referredBy === A, cAfter.referredBy);
  const aAfter = users().get(A);
  check('A.teamL1Count is now 1 (C, promoted from L2)', aAfter.teamL1Count === 1, aAfter.teamL1Count);
  check('A.teamL2Count is now 1 (D, promoted from L3)', aAfter.teamL2Count === 1, aAfter.teamL2Count);
  check('A.teamL3Count is now 0 (nothing left 3 hops down)', aAfter.teamL3Count === 0, aAfter.teamL3Count);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
