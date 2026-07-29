/* WITHDRAWAL CONCURRENCY GUARD
   Boots the REAL server.js against an in-memory database (test-mockdb.js) with
   Firebase auth and MarzPay stubbed, then proves two admins (or the owner)
   hitting "Process" on the SAME withdrawal at the same instant can never both
   reach MarzPay — and that a "Process" racing a "Reject" can't either (which
   would pay the user AND refund their wallet).

   Run:  node test-withdraw-concurrency.js            (exits 0 = all green)   */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '3998';

const Module = require('module');

const mockdb = require('./test-mockdb.js');
const dbPath = require.resolve('./db.js');
const dbMod = new Module(dbPath); dbMod.exports = mockdb; dbMod.loaded = true;
require.cache[dbPath] = dbMod;

const faPath = require.resolve('firebase-admin');
const faMod = new Module(faPath);
faMod.exports = {
  initializeApp: () => {},
  credential: { cert: () => ({}) },
  auth: () => ({
    verifyIdToken: async tok => {
      if (String(tok).startsWith('uid:')) return { uid: tok.slice(4) };
      throw new Error('invalid token');
    },
    updateUser: async () => ({}),
    createCustomToken: async uid => 'ct:' + uid,
  }),
};
faMod.loaded = true;
require.cache[faPath] = faMod;

// ── Stub MarzPay: send-money resolves slowly (simulates real gateway latency,
//    the exact window where a second concurrent request used to race in) and
//    counts how many times it was actually called. ──
const realFetch = global.fetch;
let sendMoneyCalls = 0;
let marzN = 0;
const marzStatusMap = new Map(); // uuid -> status, for the GET /send-money/:uuid check
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  const json = body => ({ ok: true, status: 200, json: async () => body });
  if (!u.includes('wearemarz.com')) return realFetch(url, opts);
  if (u.endsWith('/send-money')) {
    sendMoneyCalls++;
    await new Promise(r => setTimeout(r, 40)); // hold the "in flight" window open
    const uuid = 'WTX-' + (++marzN);
    return json({ status: 'success', data: { transaction: { uuid, status: 'pending' } } });
  }
  const m = u.match(/\/send-money\/([^/]+)$/);
  if (m) return json({ data: { transaction: { status: marzStatusMap.get(m[1]) || 'pending' } } });
  return json({ status: 'error', message: 'unknown stub route' });
};

require('./server.js');

const BASE = 'http://127.0.0.1:3998';
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
// Matches server.js's nowStr() date format exactly (EAT, MM/DD/YYYY) — the
// daily withdrawal cap counts rows by this exact string field.
function todayDateStr() {
  const d = new Date(Date.now() + 3 * 3600000);
  const pad = n => String(n).padStart(2, '0');
  return pad(d.getUTCMonth() + 1) + '/' + pad(d.getUTCDate()) + '/' + d.getUTCFullYear();
}
function seedUser(uid, overrides = {}) {
  mockdb.__store.get('users') || mockdb.__store.set('users', new Map());
  mockdb.__store.get('users').set(uid, {
    registrationDone: true, walletBalance: 1000000, totalInvested: 100000,
    name: uid, phone: '0771000001', status: 'active', ...overrides,
  });
}
function seedWithdrawal(id, uid, amount = 50000) {
  mockdb.__store.get('withdrawals') || mockdb.__store.set('withdrawals', new Map());
  mockdb.__store.get('withdrawals').set(id, {
    userId: uid, userName: uid, userPhone: '0771000001', withdrawalPhone: '0771000001',
    amount, fee: 0, netAmount: amount, status: 'pending', createdAt: new Date(),
  });
  return id;
}

(async () => {
  await sleep(1200);

  console.log('\n── 1. Two admins hit "Process" on the SAME withdrawal at the same instant');
  seedUser('alice-uid');
  seedWithdrawal('wit-race-1', 'alice-uid');
  sendMoneyCalls = 0;
  const [r1, r2] = await Promise.all([
    call('POST', '/admin/withdraw/process', { body: { ...ADMIN, withdrawalId: 'wit-race-1' } }),
    call('POST', '/admin/withdraw/process', { body: { ...ADMIN, withdrawalId: 'wit-race-1' } }),
  ]);
  const results = [r1, r2];
  const successes = results.filter(r => r.body?.status === 'success');
  const conflicts  = results.filter(r => r.code === 409);
  check('exactly ONE of the two simultaneous requests succeeded', successes.length === 1, results.map(r => r.body));
  check('the other was rejected as a conflict (409), not double-processed', conflicts.length === 1, results.map(r => [r.code, r.body?.message]));
  check('MarzPay send-money was called exactly ONCE despite two requests', sendMoneyCalls === 1, sendMoneyCalls);
  const w1 = mockdb.__store.get('withdrawals').get('wit-race-1');
  check('withdrawal ended up in a single consistent state (processing)', w1.status === 'processing', w1.status);

  console.log('\n── 2. A third, later request against the now-processing withdrawal is cleanly rejected (not a 409 — the lock already released)');
  const r3 = await call('POST', '/admin/withdraw/process', { body: { ...ADMIN, withdrawalId: 'wit-race-1' } });
  check('follow-up call gets the normal "already processing" 400, proving the lock was released after the race', r3.code === 400 && /processing/.test(r3.body?.message || ''), r3.body);

  console.log('\n── 3. "Process" racing "Reject" on the same withdrawal — must never pay AND refund');
  // Real life: the wallet is already debited by the 50000 the moment the user
  // SUBMITS a withdrawal request (see /withdraw/request) — the money is "held"
  // long before an admin ever touches it. Seed that already-debited state so
  // the invariant under test is realistic: reject must credit it back exactly
  // once; process must leave it exactly as-is (money already out of the wallet,
  // now in flight to the gateway instead).
  seedUser('bob-uid', { walletBalance: 950000 });
  seedWithdrawal('wit-race-2', 'bob-uid');
  sendMoneyCalls = 0;
  const [rp, rj] = await Promise.all([
    call('POST', '/admin/withdraw/process', { body: { ...ADMIN, withdrawalId: 'wit-race-2' } }),
    call('POST', '/admin/withdraw/reject', { body: { ...ADMIN, withdrawalId: 'wit-race-2', reason: 'race test' } }),
  ]);
  const w2 = mockdb.__store.get('withdrawals').get('wit-race-2');
  const bobBal = mockdb.__store.get('users').get('bob-uid').walletBalance;
  check('final withdrawal status is a single coherent outcome (processing XOR failed)', w2.status === 'processing' || w2.status === 'failed', w2.status);
  if (w2.status === 'failed') {
    check('rejected path: wallet was refunded exactly once (no double refund)', bobBal === 1000000, bobBal);
    check('rejected path: MarzPay was never actually called', sendMoneyCalls === 0, sendMoneyCalls);
  } else {
    check('processed path: wallet was NOT also refunded (still debited, money in flight)', bobBal === 950000, bobBal);
    check('processed path: MarzPay was called exactly once', sendMoneyCalls === 1, sendMoneyCalls);
  }

  console.log('\n── 4. Admin "Sync MarzPay" button settles a stuck processing withdrawal on demand');
  seedUser('carol-uid', { walletBalance: 500000 });
  mockdb.__store.get('withdrawals').set('wit-sync-1', {
    userId: 'carol-uid', userName: 'carol-uid', userPhone: '0771000003', withdrawalPhone: '0771000003',
    amount: 20000, fee: 0, netAmount: 20000, status: 'processing', marzTxUuid: 'WTX-SYNC-1', createdAt: new Date(),
  });
  marzStatusMap.set('WTX-SYNC-1', 'completed'); // MarzPay says it actually landed
  const carolBalPre = mockdb.__store.get('users').get('carol-uid').walletBalance;
  const r4 = await call('POST', '/admin/payments/sync', { body: { ...ADMIN } });
  check('sync call succeeds and reports at least one withdrawal settled', r4.body?.status === 'success' && r4.body?.withdrawalsSettled >= 1, r4.body);
  const witSync1 = mockdb.__store.get('withdrawals').get('wit-sync-1');
  check('the stuck withdrawal is now marked processed', witSync1.status === 'processed', witSync1.status);
  check('totalWithdrawn was credited on the settle (money was already out of the wallet at request time)',
    mockdb.__store.get('users').get('carol-uid').totalWithdrawn === 20000, mockdb.__store.get('users').get('carol-uid').totalWithdrawn);
  const r5 = await call('POST', '/admin/payments/sync', { body: { ...ADMIN } });
  check('running sync again does not re-settle (or double-pay) the same withdrawal', r5.body?.status === 'success', r5.body);
  check('wallet/totalWithdrawn unchanged by the second sync', mockdb.__store.get('users').get('carol-uid').walletBalance === carolBalPre, mockdb.__store.get('users').get('carol-uid').walletBalance);
  const r6 = await call('POST', '/admin/payments/sync', { body: {} });
  check('an unauthenticated sync call is rejected', r6.code === 401, r6.body);

  console.log('\n── 5. Daily withdrawal cap: 2 requests per user per day, any status, race-proof');
  seedUser('dana-uid', { walletBalance: 500000, totalInvested: 100000 });
  const DANA = 'uid:dana-uid';
  let rd = await call('POST', '/withdraw/request', { token: DANA, body: { amount: 20000, phone: '0771000004' } });
  check('1st withdrawal today succeeds', rd.body?.status === 'success', rd.body);
  rd = await call('POST', '/withdraw/request', { token: DANA, body: { amount: 20000, phone: '0771000004' } });
  check('2nd withdrawal today succeeds (still within the default cap of 2)', rd.body?.status === 'success', rd.body);
  rd = await call('POST', '/withdraw/request', { token: DANA, body: { amount: 20000, phone: '0771000004' } });
  check('3rd withdrawal today is rejected — daily cap reached', rd.body?.status !== 'success' && /limit/i.test(rd.body?.message || ''), rd.body);
  const danaBalAfterCap = mockdb.__store.get('users').get('dana-uid').walletBalance;
  check('the rejected 3rd attempt did not touch the wallet', danaBalAfterCap === 500000 - 40000, danaBalAfterCap);

  console.log('\n── 5b. The cap survives two SIMULTANEOUS requests at the boundary (no race past the limit)');
  seedUser('erin-uid', { walletBalance: 500000, totalInvested: 100000 });
  const ERIN = 'uid:erin-uid';
  mockdb.__store.get('withdrawals').set('wit-erin-existing', {
    userId: 'erin-uid', userName: 'erin-uid', userPhone: '0771000005', withdrawalPhone: '0771000005',
    amount: 20000, fee: 0, netAmount: 20000, status: 'pending', date: todayDateStr(), createdAt: new Date(),
  });
  const [re1, re2] = await Promise.all([
    call('POST', '/withdraw/request', { token: ERIN, body: { amount: 20000, phone: '0771000005' } }),
    call('POST', '/withdraw/request', { token: ERIN, body: { amount: 20000, phone: '0771000005' } }),
  ]);
  const erinResults = [re1, re2];
  const erinSuccesses = erinResults.filter(r => r.body?.status === 'success');
  check('exactly ONE of the two simultaneous requests succeeded (bringing today\'s total to exactly 2)', erinSuccesses.length === 1, erinResults.map(r => r.body));
  check('the other was rejected for the daily cap, not silently allowed through', erinResults.some(r => r.body?.status !== 'success' && /limit/i.test(r.body?.message || '')), erinResults.map(r => r.body));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('SUITE CRASH:', e); process.exit(1); });
