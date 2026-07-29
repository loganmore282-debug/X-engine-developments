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
  return json({ status: 'error', message: 'unknown stub route' });
};

require('./server.js');

const BASE = 'http://127.0.0.1:3998';
async function call(method, p, body) {
  const r = await realFetch(BASE + p, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
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
    call('POST', '/admin/withdraw/process', { ...ADMIN, withdrawalId: 'wit-race-1' }),
    call('POST', '/admin/withdraw/process', { ...ADMIN, withdrawalId: 'wit-race-1' }),
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
  const r3 = await call('POST', '/admin/withdraw/process', { ...ADMIN, withdrawalId: 'wit-race-1' });
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
    call('POST', '/admin/withdraw/process', { ...ADMIN, withdrawalId: 'wit-race-2' }),
    call('POST', '/admin/withdraw/reject', { ...ADMIN, withdrawalId: 'wit-race-2', reason: 'race test' }),
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

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('SUITE CRASH:', e); process.exit(1); });
