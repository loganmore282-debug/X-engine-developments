/* FURAGEMZ LIVENESS SUITE
   Boots the REAL server.js against an in-memory database (test-mockdb.js) with
   Firebase auth and MarzPay stubbed, then drives every money flow end-to-end
   over real HTTP: registration + referral graph, deposits (incl. webhook
   REPLAY / double-credit), investing + 3-level commissions (idempotency),
   daily cashback (no double payout), check-in, redeem codes, withdrawals
   (process + callback replay, reject double-refund), account isolation
   between users, maintenance gate, banning, and the totals recount.

   Run:  node test-liveness.js            (exits 0 = all green)                */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.PORT = '3997';

const Module = require('module');
const path = require('path');

// ── Inject the mock DB in place of ./db ──
const mockdb = require('./test-mockdb.js');
const dbPath = require.resolve('./db.js');
const dbMod = new Module(dbPath); dbMod.exports = mockdb; dbMod.loaded = true;
require.cache[dbPath] = dbMod;

// ── Stub firebase-admin: token "uid:<x>" verifies as user <x> ──
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
  }),
};
faMod.loaded = true;
require.cache[faPath] = faMod;

// ── Stub MarzPay over global fetch (everything else passes through) ──
const realFetch = global.fetch;
let marzN = 0;
const marzTx = new Map(); // uuid -> status
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (!u.includes('wearemarz.com')) return realFetch(url, opts);
  const json = body => ({ ok: true, status: 200, json: async () => body });
  if (u.endsWith('/collect-money') || u.endsWith('/send-money')) {
    const uuid = (u.endsWith('/collect-money') ? 'CTX-' : 'WTX-') + (++marzN);
    marzTx.set(uuid, 'processing');
    return json({ status: 'success', data: { transaction: { uuid, status: 'processing' } } });
  }
  const m = u.match(/\/(collect-money|send-money)\/([^/]+)$/);
  if (m) return json({ data: { transaction: { status: marzTx.get(m[2]) || 'processing' } } });
  return json({ status: 'error', message: 'unknown stub route' });
};

require('./server.js');

// ── tiny HTTP client + assertions ──
const BASE = 'http://127.0.0.1:3997';
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
const users = () => mockdb.__store.get('users');
const txns = () => mockdb.__store.get('transactions');
const userDoc = id => users().get(id);
const countTx = (uid, type) => [...txns().values()].filter(t => t.userId === uid && t.type === type).length;

(async () => {
  await sleep(1200); // server listening + crons/seed done (pingDb resolves instantly)
  const A = 'uid:alice-uid', B = 'uid:bob-uid';
  const ADMIN = { adminKey: 'test-admin-key' };

  console.log('\n── 1. Registration + referral graph');
  let r = await call('POST', '/account/create-profile', { token: A, body: { username: 'alice', phone: '0771000001' } });
  check('alice profile created', r.body?.status === 'success', r.body);
  r = await call('POST', '/register', { token: A, body: { referralCode: '' } });
  check('alice registered, welcome bonus 5000', r.body?.welcomeBonus === 5000, r.body);
  r = await call('POST', '/account/create-profile', { token: B, body: { username: 'bob', phone: '0771000002' } });
  check('bob profile created', r.body?.status === 'success', r.body);
  r = await call('POST', '/register', { token: B, body: { referralCode: 'ALICE' } }); // case-insensitive
  check('bob registered under alice (case-insensitive code)', r.body?.referrerId === 'alice-uid', r.body);
  check('alice teamL1Count = 1', userDoc('alice-uid').teamL1Count === 1);
  r = await call('POST', '/register', { token: B, body: { referralCode: 'alice' } });
  check('re-register is idempotent (no double welcome)', r.body?.status === 'already_done' && userDoc('bob-uid').walletBalance === 5000, r.body);

  console.log('\n── 2. Account security / isolation');
  r = await call('POST', '/register', { body: { userId: 'alice-uid' } });
  check('unauthenticated /register rejected (401)', r.code === 401, r.code);
  r = await call('POST', '/account/create-profile', { body: { userId: 'alice-uid', username: 'evil', phone: '0770000000' } });
  check('unauthenticated create-profile rejected (401)', r.code === 401, r.code);
  r = await call('POST', '/account/create-profile', { token: B, body: { userId: 'alice-uid', username: 'evil2', phone: '0770000000' } });
  check('cross-user create-profile rejected (403)', r.code === 403, r.code);
  r = await call('GET', '/account', { token: B });
  check('bob /account returns only bob', r.body?.account?.username === 'bob', r.body?.account?.username);
  r = await call('GET', '/account/transactions', { token: B });
  check('bob sees only his own transactions', (r.body?.transactions || []).every(t => t.userId === 'bob-uid'));

  console.log('\n── 3. Deposit via MarzPay + webhook double-credit guard');
  r = await call('POST', '/deposit/marzpay', { token: A, body: { amount: 30000, phone: '0771000001' } });
  check('deposit initiated', r.body?.status === 'success', r.body);
  const depId = r.body.depositId;
  const depDoc = mockdb.__store.get('pendingDeposits').get(depId);
  // Forged-callback guard: while MarzPay itself still says "processing", a
  // success webhook must NOT credit (server re-verifies with the MarzPay API).
  const forged = {
    event_type: 'collection.completed',
    transaction: { reference: depDoc.marzReference, status: 'completed', amount: { raw: 30000 } },
  };
  await call('POST', '/deposit/callback', { body: forged }); await sleep(250);
  check('FORGED success webhook refused (MarzPay still says processing)', userDoc('alice-uid').walletBalance === 5000, userDoc('alice-uid').walletBalance);
  marzTx.set(depDoc.marzTxUuid, 'completed'); // customer really paid
  const cb = {
    event_type: 'collection.completed',
    transaction: { reference: depDoc.marzReference, status: 'completed', amount: { raw: 30000 } },
    collection: { provider_transaction_id: 'MTN123' },
  };
  await call('POST', '/deposit/callback', { body: cb }); await sleep(250);
  check('deposit credited once (balance 5000+30000)', userDoc('alice-uid').walletBalance === 35000, userDoc('alice-uid').walletBalance);
  check('totalDeposited = 30000', userDoc('alice-uid').totalDeposited === 30000, userDoc('alice-uid').totalDeposited);
  await call('POST', '/deposit/callback', { body: cb }); await sleep(250);
  await call('POST', '/deposit/callback', { body: cb }); await sleep(250);
  check('webhook REPLAYED twice → still credited exactly once', userDoc('alice-uid').walletBalance === 35000 && countTx('alice-uid', 'topup') === 1,
    { bal: userDoc('alice-uid').walletBalance, topups: countTx('alice-uid', 'topup') });
  r = await call('GET', '/deposit/status/' + depId, { token: B });
  check("bob cannot read alice's deposit status (403)", r.code === 403, r.code);
  r = await call('GET', '/deposit/status/' + depId, { token: A });
  check('alice reads own deposit status', r.body?.deposit?.depositStatus === 'matched', r.body);

  console.log('\n── 4. Invest + 3-level commission idempotency');
  await call('POST', '/admin/deposit', { body: { ...ADMIN, userId: 'bob-uid', amount: 100000, note: 'test credit' } });
  check('admin credit lands (bob 5000+100000)', userDoc('bob-uid').walletBalance === 105000, userDoc('bob-uid').walletBalance);
  r = await call('POST', '/invest/create', { token: B, body: { tierKey: 'quartz' } });
  check('bob buys Quartz 30000', r.body?.status === 'success', r.body);
  await sleep(400); // commissions fire async
  const aliceAfterComm = userDoc('alice-uid');
  check('alice got L1 commission 35% of 30000 = 10500', aliceAfterComm.commissionEarned === 10500, aliceAfterComm.commissionEarned);
  check('commission also counted into totalEarned', aliceAfterComm.totalEarned === 10500, aliceAfterComm.totalEarned);
  r = await call('POST', '/admin/commissions/reconcile', { body: ADMIN }); await sleep(300);
  check('commission reconciler NEVER double-pays', userDoc('alice-uid').commissionEarned === 10500, userDoc('alice-uid').commissionEarned);

  console.log('\n── 5. Daily cashback engine (server-governed, no double payout)');
  const invEntry = [...mockdb.__store.get('investments').entries()].find(([, v]) => v.userId === 'bob-uid');
  const inv = invEntry[1];
  check('investment has server-set nextPayoutAt + dailyPayout 6500', !!inv.nextPayoutAt && inv.dailyPayout === 6500,
    { next: !!inv.nextPayoutAt, daily: inv.dailyPayout });
  r = await call('GET', '/account/investments', { token: B });
  check('app receives nextPayoutAt for the live countdown', !!(r.body?.investments?.[0]?.nextPayoutAt), r.body?.investments?.[0] && Object.keys(r.body.investments[0]));
  const balBefore = userDoc('bob-uid').walletBalance;
  inv.nextPayoutAt = new Date(Date.now() - 60000); // 1 payout due
  await call('POST', '/admin/check-maturities', { body: ADMIN }); await sleep(200);
  check('one daily cashback of 6500 credited', userDoc('bob-uid').walletBalance === balBefore + 6500, userDoc('bob-uid').walletBalance - balBefore);
  await call('POST', '/admin/check-maturities', { body: ADMIN }); await sleep(200);
  check('running the cron again pays NOTHING extra', userDoc('bob-uid').walletBalance === balBefore + 6500, userDoc('bob-uid').walletBalance - balBefore);
  check('nextPayoutAt advanced ~24h by the server', new Date(invEntry[1].nextPayoutAt).getTime() > Date.now() + 22 * 3600000);

  console.log('\n── 6. Check-in + redeem');
  r = await call('POST', '/checkin', { token: B });
  check('check-in pays 300', r.body?.bonus === 300, r.body);
  check('check-in counted into totalEarned', userDoc('bob-uid').totalEarned >= 300, userDoc('bob-uid').totalEarned);
  r = await call('POST', '/checkin', { token: B });
  check('second check-in same day blocked', r.code === 400 && r.body?.alreadyDone === true, r.body);
  await call('POST', '/admin/codes/generate', { body: { ...ADMIN, amount: 5000, count: 1 } });
  const code = [...mockdb.__store.get('redemptionCodes').values()][0].code;
  r = await call('POST', '/redeem', { token: B, body: { code } });
  check('code redeems 5000', r.body?.status === 'success', r.body);
  r = await call('POST', '/redeem', { token: B, body: { code } });
  check('same code cannot be redeemed twice by same user', r.body?.status !== 'success', r.body);

  console.log('\n── 7. Withdrawal: process, callback replay, reject double-refund');
  const bobBal = userDoc('bob-uid').walletBalance;
  r = await call('POST', '/withdraw/request', { token: B, body: { amount: 10000, phone: '0771000002' } });
  check('withdrawal accepted, balance debited once', r.body?.status === 'success' && userDoc('bob-uid').walletBalance === bobBal - 10000, r.body);
  const witId = r.body.withdrawalId;
  r = await call('POST', '/admin/withdraw/process', { body: { ...ADMIN, withdrawalId: witId } });
  check('admin pays it out via MarzPay', r.body?.status === 'success', r.body);
  const witDoc = mockdb.__store.get('withdrawals').get(witId);
  marzTx.set(witDoc.marzTxUuid, 'completed');
  const wcb = { event_type: 'disbursement.completed', transaction: { uuid: witDoc.marzTxUuid, status: 'completed' } };
  await call('POST', '/withdraw/callback', { body: wcb }); await sleep(250);
  check('withdrawal processed, totalWithdrawn = net 9500', userDoc('bob-uid').totalWithdrawn === 9500, userDoc('bob-uid').totalWithdrawn);
  await call('POST', '/withdraw/callback', { body: wcb }); await sleep(250);
  check('withdraw callback REPLAY does not double-count', userDoc('bob-uid').totalWithdrawn === 9500, userDoc('bob-uid').totalWithdrawn);
  // reject double-refund
  r = await call('POST', '/withdraw/request', { token: B, body: { amount: 10000, phone: '0771000002' } });
  const wit2 = r.body.withdrawalId;
  const balAfterReq = userDoc('bob-uid').walletBalance;
  r = await call('POST', '/withdraw/reject', { body: { ...ADMIN, withdrawalId: wit2, reason: 'test' } });
  check('reject refunds once', r.body?.status === 'success' && userDoc('bob-uid').walletBalance === balAfterReq + 10000, r.body);
  r = await call('POST', '/withdraw/reject', { body: { ...ADMIN, withdrawalId: wit2, reason: 'test again' } });
  check('second reject refunds NOTHING', r.body?.status === 'error' && userDoc('bob-uid').walletBalance === balAfterReq + 10000, r.body);
  r = await call('GET', '/withdraw/status/' + witId, { token: A });
  check("alice cannot read bob's withdrawal status (403)", r.code === 403, r.code);

  console.log('\n── 8. Maintenance gate + banning');
  await call('POST', '/admin/settings/update', { body: { ...ADMIN, maintenanceMode: true } });
  r = await call('POST', '/checkin', { token: A });
  check('maintenance blocks money endpoints (503)', r.code === 503 && r.body?.code === 'MAINTENANCE', r.code);
  r = await call('POST', '/deposit/callback', { body: cb });
  check('payment webhooks STILL accepted during maintenance', r.code === 200, r.code);
  await call('POST', '/admin/settings/update', { body: { ...ADMIN, maintenanceMode: false } });
  await call('POST', '/admin/ban', { body: { ...ADMIN, userId: 'bob-uid', action: 'ban' } });
  r = await call('POST', '/invest/create', { token: B, body: { tierKey: 'quartz' } });
  check('banned user cannot invest (403)', r.code === 403, r.code);
  await call('POST', '/admin/ban', { body: { ...ADMIN, userId: 'bob-uid', action: 'unban' } });

  console.log('\n── 9. Totals recount agrees with live counters');
  const before = { dep: userDoc('alice-uid').totalDeposited, earned: userDoc('bob-uid').totalEarned, wd: userDoc('bob-uid').totalWithdrawn };
  r = await call('POST', '/admin/users/recount', { body: ADMIN });
  check('recount runs', r.body?.status === 'success', r.body);
  const after = { dep: userDoc('alice-uid').totalDeposited, earned: userDoc('bob-uid').totalEarned, wd: userDoc('bob-uid').totalWithdrawn };
  check('ledger recount matches incremental counters exactly', JSON.stringify(before) === JSON.stringify(after), { before, after });

  console.log(`\n══ RESULT: ${pass} passed, ${fail} failed ══`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('SUITE CRASH:', e); process.exit(1); });
