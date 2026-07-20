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
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '3997';

const Module = require('module');
const path = require('path');

// ── Inject the mock DB in place of ./db ──
const mockdb = require('./test-mockdb.js');
const dbPath = require.resolve('./db.js');
const dbMod = new Module(dbPath); dbMod.exports = mockdb; dbMod.loaded = true;
require.cache[dbPath] = dbMod;

// ── Stub firebase-admin: token "uid:<x>" verifies as user <x> ──
const __fbUsers = new Map(); // uid -> last props set via updateUser (proves password reset ran)
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
    updateUser: async (uid, props) => { __fbUsers.set(uid, { ...(props || {}) }); return { uid }; },
    createCustomToken: async uid => 'ct:' + uid,
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
    let body = {}; try { body = JSON.parse(opts.body || '{}'); } catch (_) {}
    // Test hook: simulate MarzPay's provider-side disbursement fault.
    if (u.endsWith('/send-money') && global.__marzSendFail)
      return json({ status: 'error', message: 'An unexpected error occurred. Please try again.' });
    const uuid = (u.endsWith('/collect-money') ? 'CTX-' : 'WTX-') + (++marzN);
    marzTx.set(uuid, 'processing');
    const data = { transaction: { uuid, status: 'pending' } };
    // Card collections return a redirect_url instead of a phone prompt.
    if (body.method === 'card') data.redirect_url = 'https://wallet.wearemarz.com/pay/card-gateway?reference=' + body.reference;
    return json({ status: 'success', data });
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
  // Pin the welcome bonus to 5000 for this suite so the many downstream balance
  // assertions stay valid regardless of the production default (now 7000). This
  // proves the bonus is CONFIG-DRIVEN, not hardcoded.
  await call('POST', '/admin/settings/update', { body: { ...ADMIN, welcomeBonus: 5000 } });

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

  console.log('\n── 1b. Forged referral codes are REJECTED');
  const Z = 'uid:zed-uid';
  r = await call('POST', '/account/create-profile', { token: Z, body: { username: 'zed', phone: '0771000009' } });
  check('zed profile created', r.body?.status === 'success', r.body);
  r = await call('POST', '/register', { token: Z, body: { referralCode: 'GHOST999' } });
  check('nonexistent referral code rejected (400 BAD_REFERRAL)', r.code === 400 && r.body?.code === 'BAD_REFERRAL', r.body);
  check('zed NOT registered after forged code', !userDoc('zed-uid').registrationDone);
  r = await call('POST', '/register', { token: Z, body: { referralCode: 'zed' } });
  check('own referral code rejected (400)', r.code === 400 && r.body?.code === 'BAD_REFERRAL', r.body);
  r = await call('POST', '/auth/check-referral', { body: { referralCode: 'GHOST999' } });
  check('check-referral flags a fake code invalid', r.body?.status === 'success' && r.body?.valid === false, r.body);
  r = await call('POST', '/auth/check-referral', { body: { referralCode: 'ALICE' } });
  check('check-referral accepts a real code (case-insensitive)', r.body?.valid === true, r.body);
  r = await call('POST', '/auth/check-referral', { body: { referralCode: '' } });
  check('check-referral: empty code is allowed', r.body?.valid === true && r.body?.empty === true, r.body);
  r = await call('POST', '/register', { token: Z, body: { referralCode: 'ALICE' } });
  check('zed registers fine with a REAL code after the forged attempt', r.body?.status === 'success' && r.body?.referrerId === 'alice-uid', r.body);

  console.log('\n── 1c. Interrupted sign-up can NEVER lose the referral');
  const DV = 'uid:dave-uid';
  r = await call('POST', '/account/create-profile', { token: DV, body: { username: 'dave', phone: '0771000010', referralCode: 'BOB' } });
  check('dave profile created with referral stored server-side', r.body?.status === 'success', r.body);
  check('pendingReferral persisted on the user doc', userDoc('dave-uid').pendingReferral === 'BOB');
  // The app "dies" here — /register never ran with the typed code. The boot
  // self-heal later calls /register with an EMPTY body:
  r = await call('POST', '/register', { token: DV, body: {} });
  check('self-heal /register recovers the stored referral -> bob', r.body?.status === 'success' && r.body?.referrerId === 'bob-uid', r.body);
  check('bob teamL1Count incremented by the recovered referral', userDoc('bob-uid').teamL1Count === 1);
  check('pendingReferral cleared after success', (userDoc('dave-uid').pendingReferral || '') === '');
  check('dave got his welcome bonus exactly once', userDoc('dave-uid').walletBalance === 5000);

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

  console.log('\n── 3b. Failed deposits appear in history');
  // Use zed for the failed attempt so bob stays free of the 7s deposit debounce
  // (bob makes a real deposit in section 4).
  r = await call('POST', '/deposit/marzpay', { token: Z, body: { amount: 50000, phone: '0771000009' } });
  check('deposit attempt initiated', r.body?.status === 'success', r.body);
  const dep2Id = r.body.depositId;
  const dep2 = mockdb.__store.get('pendingDeposits').get(dep2Id);
  marzTx.set(dep2.marzTxUuid, 'failed'); // MarzPay itself confirms the failure
  await call('POST', '/deposit/callback', { body: { event_type: 'collection.failed', transaction: { reference: dep2.marzReference, status: 'failed' } } });
  await sleep(250);
  check('failed deposit did NOT credit', userDoc('zed-uid').walletBalance === 5000, userDoc('zed-uid').walletBalance);
  r = await call('GET', '/account/transactions', { token: Z });
  const failedRow = (r.body?.transactions || []).find(t => t.type === 'topup' && t.status === 'failed');
  check('failed deposit shows in history with Failed status', !!failedRow && failedRow.amount === 50000, failedRow);

  console.log('\n── 4. Team milestones pay on team DEPOSITS (level-1 money in)');
  check('no milestone before the team crosses a target', !userDoc('alice-uid').teamMilestone_60000);
  const aBalPre = userDoc('alice-uid').walletBalance;
  // alice's level-1 team = bob + zed. Their combined DEPOSITS drive alice's
  // milestones (as designed originally). Bob makes a REAL 70000 deposit — that
  // alone takes the L1 team over the 60000 target but not the 100000 one.
  let bdr = await call('POST', '/deposit/marzpay', { token: B, body: { amount: 70000, phone: '0771000002' } });
  const bdep = mockdb.__store.get('pendingDeposits').get(bdr.body.depositId);
  marzTx.set(bdep.marzTxUuid, 'completed');
  await call('POST', '/deposit/callback', { body: { event_type: 'collection.completed',
    transaction: { reference: bdep.marzReference, status: 'completed', amount: { raw: 70000 } },
    collection: { provider_transaction_id: 'MTN999' } } });
  await sleep(300);
  check('bob real deposit credited (5000+70000)', userDoc('bob-uid').walletBalance === 75000, userDoc('bob-uid').walletBalance);
  check('bob realDeposited 70000 (real network)', userDoc('bob-uid').realDeposited === 70000, userDoc('bob-uid').realDeposited);
  check('team deposits 70000 → 60k milestone paid instantly', userDoc('alice-uid').teamMilestone_60000 === true, userDoc('alice-uid').teamMilestone_60000);
  check('100k milestone NOT yet (70000 < 100000)', !userDoc('alice-uid').teamMilestone_100000, userDoc('alice-uid').teamMilestone_100000);
  // An ADMIN credit to zed also counts as team money-in (team volume), pushing the
  // L1 team past 100000 → the 100k milestone pays too.
  await call('POST', '/admin/deposit', { body: { ...ADMIN, userId: 'zed-uid', amount: 40000, note: 'seed' } });
  await sleep(300);
  check('team deposits 110000 → 100k milestone paid', userDoc('alice-uid').teamMilestone_100000 === true, userDoc('alice-uid').teamMilestone_100000);
  check('exactly 2 team_reward payments (3000 + 10000)', countTx('alice-uid', 'team_reward') === 2, countTx('alice-uid', 'team_reward'));
  // A deposit pays NO referral commission — only team-milestone rewards move alice.
  check('alice balance rose by team rewards only (3000 + 10000)', userDoc('alice-uid').walletBalance === aBalPre + 13000,
    { bal: userDoc('alice-uid').walletBalance, pre: aBalPre });
  r = await call('GET', '/team/stats', { token: A });
  check('/team/stats l1DepositTotal = team DEPOSITS (110000)', r.body?.l1DepositTotal === 110000, r.body?.l1DepositTotal);
  await call('GET', '/team/stats', { token: A });
  check('re-opening team screen NEVER double-pays milestones', countTx('alice-uid', 'team_reward') === 2, countTx('alice-uid', 'team_reward'));

  console.log('\n── 4r. Server AUTO-reconciles a MISSED milestone reward');
  // Simulate the real-world failure the owner hit: a deposit landed but its
  // instant milestone hook never fired (cold start / race), so the reward was
  // missed. Bump zed's deposit total directly (bypassing the hook) past 250000.
  const zdoc = userDoc('zed-uid');
  zdoc.totalDeposited = (zdoc.totalDeposited || 0) + 150000; // L1 team now 260000
  check('250k milestone unpaid before reconcile (hook was missed)', !userDoc('alice-uid').teamMilestone_250000);
  r = await call('POST', '/admin/milestones/reconcile', { body: ADMIN });
  await sleep(300);
  check('reconciler paid the missed 250k milestone (15000)', userDoc('alice-uid').teamMilestone_250000 === true, userDoc('alice-uid').teamMilestone_250000);
  check('now exactly 3 team_reward payments', countTx('alice-uid', 'team_reward') === 3, countTx('alice-uid', 'team_reward'));
  await call('POST', '/admin/milestones/reconcile', { body: ADMIN }); await sleep(200);
  check('milestone reconciler NEVER double-pays', countTx('alice-uid', 'team_reward') === 3, countTx('alice-uid', 'team_reward'));

  console.log('\n── 4a. Admin credit = team volume, but NOT a real deposit');
  const bobVolBefore  = userDoc('bob-uid').totalDeposited;
  const bobRealBefore = userDoc('bob-uid').realDeposited || 0;
  const bobBalBefore  = userDoc('bob-uid').walletBalance;
  await call('POST', '/admin/deposit', { body: { ...ADMIN, userId: 'bob-uid', amount: 40000, note: 'manual top-up' } });
  check('admin credit adds to the wallet', userDoc('bob-uid').walletBalance === bobBalBefore + 40000, userDoc('bob-uid').walletBalance);
  check('admin credit COUNTS toward team volume (totalDeposited)', userDoc('bob-uid').totalDeposited === bobVolBefore + 40000, userDoc('bob-uid').totalDeposited);
  check('admin credit does NOT count as a real deposit (dashboard = real only)', (userDoc('bob-uid').realDeposited || 0) === bobRealBefore, userDoc('bob-uid').realDeposited);
  r = await call('POST', '/admin/stats', { body: ADMIN });
  check('dashboard Total deposits (real) is LESS than team volume (all money)',
    r.body?.status === 'success' && r.body.totalDeposited < r.body.totalVolume, { real: r.body?.totalDeposited, volume: r.body?.totalVolume });

  console.log('\n── 4c. Coming-soon gems are shown but NOT buyable');
  await call('POST', '/admin/products/save', { body: { ...ADMIN, label: 'Ruby', key: 'ruby', price: 200000, expectedReturn: 2600000, cycle: 60, comingSoon: true } });
  r = await call('GET', '/products');
  const ruby = (r.body?.products || []).find(p => p.key === 'ruby');
  check('coming-soon gem still appears in the product list', !!ruby && ruby.comingSoon === true, ruby);
  const bobBalCS = userDoc('bob-uid').walletBalance;
  r = await call('POST', '/invest/create', { token: B, body: { tierKey: 'ruby' } });
  check('buying a coming-soon gem is rejected', r.body?.status !== 'success' && /coming soon/i.test(r.body?.message || ''), r.body);
  check('no money moved on the blocked purchase', userDoc('bob-uid').walletBalance === bobBalCS, userDoc('bob-uid').walletBalance);

  console.log('\n── 4b. Invest + 3-level commission idempotency');
  const aCommPre = userDoc('alice-uid').commissionEarned || 0;
  r = await call('POST', '/invest/create', { token: B, body: { tierKey: 'quartz' } });
  check('bob buys Quartz 30000', r.body?.status === 'success', r.body);
  await sleep(400); // commissions fire async
  check('alice L1 commission += 35% of 30000 = 10500', (userDoc('alice-uid').commissionEarned || 0) === aCommPre + 10500, userDoc('alice-uid').commissionEarned);
  r = await call('POST', '/admin/commissions/reconcile', { body: ADMIN }); await sleep(300);
  check('commission reconciler NEVER double-pays', (userDoc('alice-uid').commissionEarned || 0) === aCommPre + 10500, userDoc('alice-uid').commissionEarned);

  console.log('\n── 4d. Team screen exposes each member DEPOSIT (milestone driver) separate from gems');
  r = await call('GET', '/team/members', { token: A });
  const mem = (r.body?.members || []);
  const bobMem = mem.find(m => m.id === 'bob-uid');
  const zedMem = mem.find(m => m.id === 'zed-uid');
  check('member row carries the DEPOSIT that drives milestones', bobMem && typeof bobMem.deposited === 'number', bobMem);
  check('bob member shows deposits AND gem-active (both true)', bobMem?.deposited === userDoc('bob-uid').totalDeposited && bobMem?.hasInvested === true,
    { deposited: bobMem?.deposited, real: userDoc('bob-uid').totalDeposited, invested: bobMem?.hasInvested });
  check('zed member shows deposits but NO gem (deposits ≠ investing)', zedMem?.deposited === userDoc('zed-uid').totalDeposited && zedMem?.hasInvested === false,
    { deposited: zedMem?.deposited, invested: zedMem?.hasInvested });

  console.log('\n── 5. Daily cashback engine (server-governed, no double payout)');
  const invEntry = [...mockdb.__store.get('investments').entries()].find(([, v]) => v.userId === 'bob-uid');
  const inv = invEntry[1];
  check('investment has server-set nextPayoutAt + dailyPayout 6500', !!inv.nextPayoutAt && inv.dailyPayout === 6500,
    { next: !!inv.nextPayoutAt, daily: inv.dailyPayout });
  r = await call('GET', '/account/investments', { token: B });
  check('app receives nextPayoutAt for the live countdown', !!(r.body?.investments?.[0]?.nextPayoutAt), r.body?.investments?.[0] && Object.keys(r.body.investments[0]));
  const balBefore = userDoc('bob-uid').walletBalance;
  // Deterministic engine: elapsed time comes from createdAt, not the stored
  // nextPayoutAt. Backdate purchase by 25h -> exactly ONE 24h mark has passed.
  const created0 = Date.now() - 25 * 3600000;
  inv.createdAt = new Date(created0);
  await call('POST', '/admin/check-maturities', { body: ADMIN }); await sleep(200);
  check('one daily cashback of 6500 credited', userDoc('bob-uid').walletBalance === balBefore + 6500, userDoc('bob-uid').walletBalance - balBefore);
  await call('POST', '/admin/check-maturities', { body: ADMIN }); await sleep(200);
  check('running the cron again pays NOTHING extra', userDoc('bob-uid').walletBalance === balBefore + 6500, userDoc('bob-uid').walletBalance - balBefore);
  // nextPayoutAt must equal createdAt + 2×24h EXACTLY (aligned to purchase time,
  // not a drifted minute) — this is the countdown the app shows.
  const expectNext = created0 + 2 * 86400000;
  check('nextPayoutAt is EXACTLY purchase-time + 2×24h (no drift)',
    Math.abs(new Date(invEntry[1].nextPayoutAt).getTime() - expectNext) < 2000,
    { got: new Date(invEntry[1].nextPayoutAt).getTime(), want: expectNext });
  // DRIFT HEAL: corrupt the stored nextPayoutAt to a bogus 3h-from-now value.
  // The server must ignore it and re-anchor to the purchase schedule.
  invEntry[1].nextPayoutAt = new Date(Date.now() + 3 * 3600000);
  await call('POST', '/admin/check-maturities', { body: ADMIN }); await sleep(200);
  check('drifted nextPayoutAt is HEALED back to the true schedule',
    Math.abs(new Date(invEntry[1].nextPayoutAt).getTime() - expectNext) < 2000,
    new Date(invEntry[1].nextPayoutAt).getTime());
  // Settle-on-open at the next real mark: backdate to 49h -> a 2nd payout is due.
  invEntry[1].createdAt = new Date(Date.now() - 49 * 3600000);
  const balPre2 = userDoc('bob-uid').walletBalance;
  r = await call('GET', '/account/investments', { token: B });
  await sleep(150);
  check('settle-on-open: cashback lands the instant the app opens at zero', userDoc('bob-uid').walletBalance === balPre2 + 6500,
    userDoc('bob-uid').walletBalance - balPre2);

  console.log('\n── 5b. Boost = EARLY MATURITY (normal daily continues, final day pays the rest)');
  const bInv = invEntry[1];
  check('before boost: normal daily 6500, 13000 paid so far (2 payouts)', bInv.dailyPayout === 6500 && bInv.paidOut === 13000, { daily: bInv.dailyPayout, paid: bInv.paidOut });
  bInv.boostUnlockDate = new Date(Date.now() - 1000);          // unlock the boost
  await call('POST', '/admin/deposit', { body: { ...ADMIN, userId: 'bob-uid', amount: 200000, note: 'boost funds' } });
  const balBeforeBoost = userDoc('bob-uid').walletBalance;
  const boostCost = Math.round(390000 * 0.30);                 // 30% of TOTAL return = 117000
  r = await call('POST', '/invest/boost', { token: B, body: { investmentId: invEntry[0] } });
  check('boost accepted', r.body?.status === 'success', r.body);
  check('boost fee = 30% of total return (117000) debited', userDoc('bob-uid').walletBalance === balBeforeBoost - boostCost, userDoc('bob-uid').walletBalance - balBeforeBoost);
  check('daily rate STAYS the normal 6500 after boost (NOT remaining/5)', bInv.dailyPayout === 6500, bInv.dailyPayout);
  check('maturity accelerated: payoutsTotal = made(2) + 5 = 7', bInv.payoutsTotal === 7, bInv.payoutsTotal);
  // 4 interim boosted days: each pays the NORMAL 6500 (payouts 3,4,5,6).
  bInv.createdAt = new Date(Date.now() - (6 * 24 + 1) * 3600000);
  let bp = userDoc('bob-uid').walletBalance;
  await call('POST', '/admin/check-maturities', { body: ADMIN }); await sleep(200);
  check('4 interim days each pay the normal 6500 (4×6500 = 26000)', userDoc('bob-uid').walletBalance === bp + 26000, userDoc('bob-uid').walletBalance - bp);
  // Final (5th) boosted day: pays the ENTIRE remaining balance in one lump.
  bInv.createdAt = new Date(Date.now() - (7 * 24 + 1) * 3600000);
  bp = userDoc('bob-uid').walletBalance;
  await call('POST', '/admin/check-maturities', { body: ADMIN }); await sleep(200);
  check('final day pays the whole remaining balance at once (351000)', userDoc('bob-uid').walletBalance === bp + 351000, userDoc('bob-uid').walletBalance - bp);
  check('gem matured after the final lump', bInv.status === 'matured', bInv.status);
  check('lifetime cashback equals EXACTLY the expected 390000 (boost added no extra)', bInv.paidOut === 390000, bInv.paidOut);

  console.log('\n── 6. Check-in + redeem');
  r = await call('POST', '/checkin', { token: B });
  check('check-in pays 500', r.body?.bonus === 500, r.body);
  check('check-in counted into totalEarned', userDoc('bob-uid').totalEarned >= 500, userDoc('bob-uid').totalEarned);
  r = await call('POST', '/checkin', { token: B });
  check('second check-in same day blocked', r.code === 400 && r.body?.alreadyDone === true, r.body);
  await call('POST', '/admin/codes/generate', { body: { ...ADMIN, amount: 5000, count: 1 } });
  const code = [...mockdb.__store.get('redemptionCodes').values()][0].code;
  check('generated code is 10 characters', code.length === 10, code);
  r = await call('POST', '/redeem', { token: B, body: { code } });
  check('code redeems 5000', r.body?.status === 'success', r.body);
  r = await call('POST', '/redeem', { token: B, body: { code: 'FAKEFAKE11' } });
  check('nonexistent redeem code rejected', r.body?.status !== 'success', r.body);
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
  check('withdrawal processed, totalWithdrawn = net 8600 (14% fee)', userDoc('bob-uid').totalWithdrawn === 8600, userDoc('bob-uid').totalWithdrawn);
  await call('POST', '/withdraw/callback', { body: wcb }); await sleep(250);
  check('withdraw callback REPLAY does not double-count', userDoc('bob-uid').totalWithdrawn === 8600, userDoc('bob-uid').totalWithdrawn);
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
  // rejected withdrawal must show honestly in the user's history (not stuck on Processing)
  r = await call('GET', '/account/transactions', { token: B });
  const rejRow = (r.body?.transactions || []).find(t => t.withdrawalId === wit2);
  check('rejected withdrawal shows Failed in history (not Processing)', rejRow && ['failed', 'rejected'].includes(rejRow.status), rejRow && rejRow.status);
  const refundRow = (r.body?.transactions || []).find(t => t.type === 'refund' && t.description.includes('rejected'));
  check('rejection refund appears as a visible record', !!refundRow, refundRow);

  console.log('\n── 7a. MarzPay payout FAULT leaves the withdrawal pending + money untouched');
  const balPreFail = userDoc('bob-uid').walletBalance;
  r = await call('POST', '/withdraw/request', { token: B, body: { amount: 10000, phone: '0771000002' } });
  const witFail = r.body.withdrawalId;
  check('withdrawal held (balance debited on request)', userDoc('bob-uid').walletBalance === balPreFail - 10000, userDoc('bob-uid').walletBalance);
  global.__marzSendFail = true;
  r = await call('POST', '/admin/withdraw/process', { body: { ...ADMIN, withdrawalId: witFail } });
  global.__marzSendFail = false;
  check('provider fault returns a CLEAR error (not a raw MarzPay dump)', r.body?.status === 'error' && /MarzPay could not send|payment provider/i.test(r.body?.message || ''), r.body?.message);
  check('withdrawal stays PENDING after the fault (retryable)', mockdb.__store.get('withdrawals').get(witFail).status === 'pending', mockdb.__store.get('withdrawals').get(witFail).status);
  check('money still held — nothing double-moved', userDoc('bob-uid').walletBalance === balPreFail - 10000, userDoc('bob-uid').walletBalance);
  // Now MarzPay recovers → the SAME withdrawal pays out on retry.
  r = await call('POST', '/admin/withdraw/process', { body: { ...ADMIN, withdrawalId: witFail } });
  check('retry after recovery succeeds on the same withdrawal', r.body?.status === 'success', r.body);
  check('withdrawal now processing/processed after retry', ['processing', 'processed'].includes(mockdb.__store.get('withdrawals').get(witFail).status), mockdb.__store.get('withdrawals').get(witFail).status);

  console.log('\n── 7b. Background sweep settles payments with NO callback and NO app open');
  await sleep(7100); // clear the per-user deposit debounce
  r = await call('POST', '/deposit/marzpay', { token: A, body: { amount: 40000, phone: '0771000001' } });
  check('new deposit initiated (user then closes the app)', r.body?.status === 'success', r.body);
  const dep3 = mockdb.__store.get('pendingDeposits').get(r.body.depositId);
  marzTx.set(dep3.marzTxUuid, 'completed'); // customer paid, but NO callback ever arrives
  const aliceBalPre = userDoc('alice-uid').walletBalance;
  r = await call('POST', '/admin/payments/sync', { body: ADMIN }); await sleep(250);
  check('background sweep credits the paid deposit by itself', userDoc('alice-uid').walletBalance === aliceBalPre + 40000,
    { before: aliceBalPre, after: userDoc('alice-uid').walletBalance });
  await call('POST', '/admin/payments/sync', { body: ADMIN }); await sleep(250);
  check('sweep re-run never double-credits', userDoc('alice-uid').walletBalance === aliceBalPre + 40000, userDoc('alice-uid').walletBalance);

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

  console.log('\n── 10. Admin force-credit (owner verified payment manually)');
  // dep2Id is zed's failed 50000 deposit from section 3b.
  const zedBalFc = userDoc('zed-uid').walletBalance;
  r = await call('POST', '/admin/deposit/force-credit', { body: { ...ADMIN, depositId: dep2Id } });
  check('failed-but-verified deposit force-credited once', r.body?.status === 'success' && userDoc('zed-uid').walletBalance === zedBalFc + 50000,
    { resp: r.body, bal: userDoc('zed-uid').walletBalance });
  r = await call('POST', '/admin/deposit/force-credit', { body: { ...ADMIN, depositId: dep2Id } });
  check('force-credit re-run never double-credits', userDoc('zed-uid').walletBalance === zedBalFc + 50000 && /Already/i.test(r.body?.message || ''), r.body);

  console.log('\n── 11. Admin account deletion (full data wipe)');
  const C = 'uid:carol-uid';
  await call('POST', '/account/create-profile', { token: C, body: { username: 'carol', phone: '0771000003' } });
  await call('POST', '/register', { token: C, body: { referralCode: 'alice' } });
  await call('POST', '/checkin', { token: C });
  check('carol exists with data (alice teamL1Count = 3: bob+zed+carol)', !!userDoc('carol-uid') && userDoc('alice-uid').teamL1Count === 3,
    { carol: !!userDoc('carol-uid'), l1: userDoc('alice-uid').teamL1Count });
  r = await call('POST', '/admin/user/delete', { body: { ...ADMIN, userId: 'carol-uid' } });
  check('delete without typed confirmation refused', r.code === 400, r.body);
  r = await call('POST', '/admin/user/delete', { body: { ...ADMIN, userId: 'carol-uid', confirm: 'DELETE' } });
  check('account deleted with confirmation', r.body?.status === 'success', r.body);
  check('user document gone', !userDoc('carol-uid'));
  check('all her transactions wiped', countTx('carol-uid', 'checkin') === 0 && countTx('carol-uid', 'admin_credit') === 0);
  check('referral link records wiped', ![...(mockdb.__store.get('referrals')||new Map()).values()].some(x => x.referredUserId === 'carol-uid'));
  check("alice's team count corrected back to 2", userDoc('alice-uid').teamL1Count === 2, userDoc('alice-uid').teamL1Count);
  r = await call('GET', '/account', { token: C });
  check('deleted account can no longer be fetched', r.code === 404, r.code);

  console.log('\n── 12. Concurrency: parallel debits cannot double-spend');
  const D = 'uid:dave-uid';
  await call('POST', '/account/create-profile', { token: D, body: { username: 'dave', phone: '0771000004' } });
  await call('POST', '/register', { token: D, body: {} });
  await call('POST', '/admin/deposit', { body: { ...ADMIN, userId: 'dave-uid', amount: 30000, note: 'seed' } });
  const daveStart = userDoc('dave-uid').walletBalance; // 5000 welcome + 30000 = 35000
  // Fire TWO Quartz (30000) buys at the same instant with only enough for one.
  const [pr1, pr2] = await Promise.all([
    call('POST', '/invest/create', { token: D, body: { tierKey: 'quartz' } }),
    call('POST', '/invest/create', { token: D, body: { tierKey: 'quartz' } }),
  ]);
  await sleep(200);
  const successes = [pr1, pr2].filter(x => x.body?.status === 'success').length;
  const daveInv = [...mockdb.__store.get('investments').values()].filter(i => i.userId === 'dave-uid').length;
  check('exactly ONE of two parallel buys succeeds', successes === 1, { s: successes, r1: pr1.body?.status, r2: pr2.body?.status });
  check('exactly ONE gem created (no double activation)', daveInv === 1, daveInv);
  check('balance debited exactly once (35000-30000=5000, not lost/doubled)', userDoc('dave-uid').walletBalance === daveStart - 30000, userDoc('dave-uid').walletBalance);

  console.log('\n── 13. Late MarzPay confirmation NEVER loses a paid deposit');
  const F = 'uid:finn-uid';
  await call('POST', '/account/create-profile', { token: F, body: { username: 'finn', phone: '0771000005' } });
  await call('POST', '/register', { token: F, body: {} });
  r = await call('POST', '/deposit/marzpay', { token: F, body: { amount: 30000, phone: '0771000005' } });
  const fdep = mockdb.__store.get('pendingDeposits').get(r.body.depositId);
  const fdepId = r.body.depositId;
  // The network dies mid-payment: MarzPay first reports failed…
  marzTx.set(fdep.marzTxUuid, 'failed');
  await call('POST', '/deposit/callback', { body: { event_type: 'collection.failed', transaction: { reference: fdep.marzReference, status: 'failed' } } });
  await sleep(200);
  check('deposit marked failed after the failure report', mockdb.__store.get('pendingDeposits').get(fdepId).status === 'failed');
  check('no money credited yet', userDoc('finn-uid').walletBalance === 5000, userDoc('finn-uid').walletBalance);
  // …but the customer HAD paid (carrier SMS!): MarzPay later confirms success.
  marzTx.set(fdep.marzTxUuid, 'completed');
  await call('POST', '/deposit/callback', { body: { event_type: 'collection.completed',
    transaction: { reference: fdep.marzReference, status: 'completed', amount: { raw: 30000 } } } });
  await sleep(250);
  check('late success CREDITS the already-expired deposit', userDoc('finn-uid').walletBalance === 35000, userDoc('finn-uid').walletBalance);
  check('exactly one topup row (no double credit)', countTx('finn-uid', 'topup') === 1, countTx('finn-uid', 'topup'));
  await call('POST', '/deposit/callback', { body: { event_type: 'collection.completed',
    transaction: { reference: fdep.marzReference, status: 'completed', amount: { raw: 30000 } } } });
  await sleep(200);
  check('replaying the late success still credits ONCE',
    userDoc('finn-uid').walletBalance === 35000 && countTx('finn-uid', 'topup') === 1,
    { bal: userDoc('finn-uid').walletBalance, topups: countTx('finn-uid', 'topup') });

  console.log('\n── 13b. Redemption codes: messy input + lost-credit healer');
  await call('POST', '/admin/codes/generate', { body: { ...ADMIN, amount: 2000, count: 2 } });
  const allCodes = [...mockdb.__store.get('redemptionCodes').entries()];
  const [cId1, cD1] = allCodes[allCodes.length - 2];
  const [cId2, cD2] = allCodes[allCodes.length - 1];
  // Paste with spaces + lowercase must still be recognised globally.
  const messy = ' ' + cD1.code.slice(0, 4).toLowerCase() + ' ' + cD1.code.slice(4).toLowerCase() + ' ';
  const finnBal = userDoc('finn-uid').walletBalance;
  r = await call('POST', '/redeem', { token: F, body: { code: messy } });
  check('lowercase + spaced code still redeems', r.body?.status === 'success', r.body);
  check('credit landed', userDoc('finn-uid').walletBalance === finnBal + 2000, userDoc('finn-uid').walletBalance);
  // Simulate the crash window: user marked in usedBy but the credit never ran.
  mockdb.__store.get('redemptionCodes').get(cId2).usedBy = ['zed-uid'];
  const zedBal = userDoc('zed-uid').walletBalance;
  r = await call('POST', '/admin/redemptions/reconcile', { body: { ...ADMIN } });
  check('reconciler detects and heals the lost credit', r.body?.status === 'success' && r.body?.healed === 1, r.body);
  check('zed received the missing money', userDoc('zed-uid').walletBalance === zedBal + 2000, userDoc('zed-uid').walletBalance);
  r = await call('POST', '/admin/redemptions/reconcile', { body: { ...ADMIN } });
  check('re-running the healer never double-pays', r.body?.healed === 0 && userDoc('zed-uid').walletBalance === zedBal + 2000,
    { healed: r.body?.healed, bal: userDoc('zed-uid').walletBalance });

  console.log('\n── 13c. Forged FAILURE callbacks cannot move money (attack simulation)');
  // (a) Deposit: alice's credited deposit — a forged failure must not downgrade
  // it (a downgrade would re-open it for the rescue pass to credit AGAIN).
  const aDep = mockdb.__store.get('pendingDeposits').get(depId);
  const aliceBalNow = userDoc('alice-uid').walletBalance;
  await call('POST', '/deposit/callback', { body: { event_type: 'collection.failed',
    transaction: { reference: aDep.marzReference, status: 'failed' } } });
  await sleep(250);
  check('credited deposit CANNOT be downgraded by a forged failure',
    mockdb.__store.get('pendingDeposits').get(depId).status === 'matched',
    mockdb.__store.get('pendingDeposits').get(depId).status);
  check('no deposit money moved by the forgery', userDoc('alice-uid').walletBalance === aliceBalNow, userDoc('alice-uid').walletBalance);
  // (b) Withdrawal: bob was REALLY paid (MarzPay says completed). A forged
  // "failed" webhook must NOT refund him on top of the payout (double money).
  const bobBalNow = userDoc('bob-uid').walletBalance;
  const paidWit = mockdb.__store.get('withdrawals').get(witId);
  await call('POST', '/withdraw/callback', { body: { event_type: 'disbursement.failed',
    transaction: { uuid: paidWit.marzTxUuid, status: 'failed' } } });
  await sleep(250);
  check('paid withdrawal NOT refunded by a forged failure (no double money)',
    userDoc('bob-uid').walletBalance === bobBalNow && mockdb.__store.get('withdrawals').get(witId).status === 'processed',
    { bal: userDoc('bob-uid').walletBalance, status: mockdb.__store.get('withdrawals').get(witId).status });
  // (c) A processing withdrawal + forged failure while MarzPay still says
  // "processing" — the refund must wait for the gateway's real verdict.
  r = await call('POST', '/withdraw/request', { token: B, body: { amount: 10000, phone: '0771000002' } });
  const wit3 = r.body.withdrawalId;
  await call('POST', '/admin/withdraw/process', { body: { ...ADMIN, withdrawalId: wit3 } });
  const wit3Doc = mockdb.__store.get('withdrawals').get(wit3); // marz says 'processing'
  const bobBal3 = userDoc('bob-uid').walletBalance;
  await call('POST', '/withdraw/callback', { body: { event_type: 'disbursement.failed',
    transaction: { uuid: wit3Doc.marzTxUuid, status: 'failed' } } });
  await sleep(250);
  check('forged failure while gateway says processing → NO refund',
    userDoc('bob-uid').walletBalance === bobBal3 && mockdb.__store.get('withdrawals').get(wit3).status === 'processing',
    { bal: userDoc('bob-uid').walletBalance, status: mockdb.__store.get('withdrawals').get(wit3).status });
  // …and when MarzPay REALLY reports the failure, the refund flows normally.
  marzTx.set(wit3Doc.marzTxUuid, 'failed');
  await call('POST', '/withdraw/callback', { body: { event_type: 'disbursement.failed',
    transaction: { uuid: wit3Doc.marzTxUuid, status: 'failed' } } });
  await sleep(250);
  check('gateway-confirmed failure refunds exactly once',
    userDoc('bob-uid').walletBalance === bobBal3 + 10000 && mockdb.__store.get('withdrawals').get(wit3).status === 'failed',
    { bal: userDoc('bob-uid').walletBalance, status: mockdb.__store.get('withdrawals').get(wit3).status });

  console.log('\n── 13d. Card deposits (global) credit via the same guarded path');
  const cardBal = userDoc('bob-uid').walletBalance;
  r = await call('POST', '/deposit/card', { token: B, body: { amount: 40000 } });
  check('card deposit returns a gateway redirect_url', r.body?.status === 'success' && /card-gateway/.test(r.body?.redirectUrl || ''), r.body);
  const cardDepId = r.body.depositId;
  const cardDep = mockdb.__store.get('pendingDeposits').get(cardDepId);
  check('card deposit stored as method=card, no phone, processing', cardDep.method === 'card' && cardDep.phone === null && cardDep.status === 'processing', cardDep);
  check('no money credited before the card payment completes', userDoc('bob-uid').walletBalance === cardBal, userDoc('bob-uid').walletBalance);
  // Customer pays on the gateway → MarzPay confirms → webhook (provider "card payments").
  marzTx.set(cardDep.marzTxUuid, 'completed');
  await call('POST', '/deposit/callback', { body: { event_type: 'collection.completed',
    transaction: { reference: cardDep.marzReference, status: 'completed', amount: { raw: 40000 }, provider: 'card payments', phone_number: null } } });
  await sleep(250);
  check('card payment credits the wallet once (40000)', userDoc('bob-uid').walletBalance === cardBal + 40000, userDoc('bob-uid').walletBalance);
  await call('POST', '/deposit/callback', { body: { event_type: 'collection.completed',
    transaction: { reference: cardDep.marzReference, status: 'completed', amount: { raw: 40000 }, provider: 'card payments', phone_number: null } } });
  await sleep(200);
  check('replayed card webhook never double-credits', userDoc('bob-uid').walletBalance === cardBal + 40000 && countTx('bob-uid', 'topup') >= 1, userDoc('bob-uid').walletBalance);

  // The card gateway uses ONE callback_url for both the webhook (POST) and the
  // customer's browser return (GET) — the GET must 302 the customer to the app.
  const retResp = await realFetch(BASE + '/deposit/return', { redirect: 'manual' });
  check('card GET return 302-redirects the customer to the app',
    retResp.status === 302 && /card=1/.test(retResp.headers.get('location') || ''),
    { code: retResp.status, loc: retResp.headers.get('location') });
  // And the POST on that same path still credits (webhook path). Fresh user to
  // avoid the 7s per-user deposit debounce hit above.
  const G = 'uid:gina-uid';
  await call('POST', '/account/create-profile', { token: G, body: { username: 'gina', phone: '0771000021' } });
  await call('POST', '/register', { token: G, body: {} });
  const cr2 = await call('POST', '/deposit/card', { token: G, body: { amount: 35000 } });
  const cd2 = mockdb.__store.get('pendingDeposits').get(cr2.body.depositId);
  marzTx.set(cd2.marzTxUuid, 'completed');
  const preRet = userDoc('gina-uid').walletBalance;
  await call('POST', '/deposit/return', { body: { event_type: 'collection.completed',
    transaction: { reference: cd2.marzReference, status: 'completed', amount: { raw: 35000 }, provider: 'card payments', phone_number: null } } });
  await sleep(250);
  check('POST /deposit/return webhook credits the card deposit', userDoc('gina-uid').walletBalance === preRet + 35000, userDoc('gina-uid').walletBalance);

  console.log('\n── 13e. Admin password reset via Firebase Admin SDK');
  r = await call('POST', '/admin/user/reset-password', { body: { ...ADMIN, userId: 'bob-uid', newPassword: 'newpass123' } });
  check('admin resets a user password', r.body?.status === 'success', r.body);
  check('Firebase updateUser was called with the new password', __fbUsers.get('bob-uid')?.password === 'newpass123', __fbUsers.get('bob-uid'));
  r = await call('POST', '/admin/user/reset-password', { body: { ...ADMIN, userId: 'bob-uid', newPassword: '123' } });
  check('password under 6 chars rejected', r.code === 400, r.body);
  r = await call('POST', '/admin/user/reset-password', { body: { userId: 'bob-uid', newPassword: 'nope123' } });
  check('reset without admin key rejected (401)', r.code === 401, r.code);

  console.log('\n── 13f. Referral attribution self-heal (joined by link but not recorded)');
  // gina finishes sign-up with NO code (the link param was lost on a PWA reopen),
  // so she is recorded under nobody.
  const GINA = 'uid:gina-uid';
  await call('POST', '/account/create-profile', { token: GINA, body: { username: 'gina', phone: '0771000021' } });
  await call('POST', '/register', { token: GINA, body: { referralCode: '' } });
  check('gina registered with NO referrer', !userDoc('gina-uid').referredBy, userDoc('gina-uid').referredBy);
  // gina INVESTS while still unattributed — no referrer exists, so no commission
  // is paid to anyone at this point (this is the exact complaint scenario).
  await call('POST', '/admin/deposit', { body: { ...ADMIN, userId: 'gina-uid', amount: 40000, note: 'seed' } });
  const aliceCommBefore = userDoc('alice-uid').commissionEarned || 0;
  r = await call('POST', '/invest/create', { token: GINA, body: { tierKey: 'quartz' } }); // 30000
  check('gina buys a gem while unattributed', r.body?.status === 'success', r.body);
  await sleep(300);
  check('no commission paid yet (gina has no referrer)', (userDoc('alice-uid').commissionEarned || 0) === aliceCommBefore, userDoc('alice-uid').commissionEarned);
  const aliceL1Before = userDoc('alice-uid').teamL1Count || 0;
  // Her intended code survived only as the stored pendingReferral (the durable copy).
  userDoc('gina-uid').pendingReferral = 'alice';
  r = await call('POST', '/admin/referrals/reconcile', { body: ADMIN });
  await sleep(300);
  check('reconciler LINKS gina under alice automatically', userDoc('gina-uid').referredBy === 'alice-uid', userDoc('gina-uid').referredBy);
  check('alice team L1 count went up by exactly 1', (userDoc('alice-uid').teamL1Count || 0) === aliceL1Before + 1, userDoc('alice-uid').teamL1Count);
  check('linking PAYS the owed 35% on gina\'s earlier gem (10500)', (userDoc('alice-uid').commissionEarned || 0) === aliceCommBefore + 10500, (userDoc('alice-uid').commissionEarned || 0) - aliceCommBefore);
  check('gina pendingReferral cleared after linking', (userDoc('gina-uid').pendingReferral || '') === '');
  r = await call('POST', '/admin/referrals/reconcile', { body: ADMIN }); await sleep(200);
  check('re-linking never double-pays the commission', (userDoc('alice-uid').commissionEarned || 0) === aliceCommBefore + 10500, userDoc('alice-uid').commissionEarned);
  r = await call('POST', '/admin/referrals/reconcile', { body: ADMIN });
  check('re-running the healer NEVER double-counts', (userDoc('alice-uid').teamL1Count || 0) === aliceL1Before + 1, userDoc('alice-uid').teamL1Count);
  // Fully-lost case (no pendingReferral at all): admin attaches harry under bob by hand.
  const HARRY = 'uid:harry-uid';
  await call('POST', '/account/create-profile', { token: HARRY, body: { username: 'harry', phone: '0771000022' } });
  await call('POST', '/register', { token: HARRY, body: { referralCode: '' } });
  const bobL1Before = userDoc('bob-uid').teamL1Count || 0;
  r = await call('POST', '/admin/user/set-referrer', { body: { ...ADMIN, userId: 'harry-uid', referrerCode: 'bob' } });
  check('admin manually attaches harry under bob', r.body?.status === 'success' && userDoc('harry-uid').referredBy === 'bob-uid', r.body);
  check('bob team L1 count went up by exactly 1', (userDoc('bob-uid').teamL1Count || 0) === bobL1Before + 1, userDoc('bob-uid').teamL1Count);
  r = await call('POST', '/admin/user/set-referrer', { body: { ...ADMIN, userId: 'harry-uid', referrerCode: 'alice' } });
  check('reassigning an already-referred user is REFUSED', r.code === 400, r.body);

  console.log('\n── 14. GLOBAL INTEGRITY AUDIT — every balance must equal its ledger');
  r = await call('POST', '/admin/integrity', { body: { ...ADMIN } });
  check('audit endpoint runs', r.body?.status === 'success', r.body?.message);
  check('audit checked every registered user', (r.body?.usersChecked || 0) >= 5, r.body?.usersChecked);
  check('EVERY balance matches its ledger — no mismatches, duplicates or stuck payouts',
    r.body?.healthy === true, r.body?.alerts);

  console.log(`\n══ RESULT: ${pass} passed, ${fail} failed ══`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('SUITE CRASH:', e); process.exit(1); });
