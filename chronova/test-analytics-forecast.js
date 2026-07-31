/* CHRONOVA — Analytics "Tomorrow's estimate" is a real bottom-up model, not
   just a trend line, per the owner's explicit request:

   WITHDRAWALS are read member by member — balance + tomorrow's daily-cashback
   payout (every active watch pays once more) + each member's OWN trailing
   average of commission/check-in income (some earn these steadily, most
   don't) must clear the minimum withdrawal, AND the member has to actually
   be "due" by THEIR OWN historical withdrawal cadence (falling back to
   "counted the moment they're able" when they have no established habit
   yet). The owner's own example is tested directly: a 25,000 watch's daily
   cashback (~6,250) alone never clears a 10,000 minimum, so that member
   should NOT show up as a likely withdrawer tomorrow.

   DEPOSITS keep the simple historical trend for ordinary organic top-ups,
   but add two bottom-up signals read from real platform state: watches
   maturing tomorrow (people who matured before and deposited again shortly
   after set the historical "reinvestment rate"), and new signups still
   inside their typical first-deposit window ("mid-funnel" conversions).
   Both are excluded from the organic trend so they're never counted twice.

   This test seeds every scenario directly into the mock store with precise
   timestamps (a live server can't be driven this deterministically) and
   checks the server's math against the same formulas by hand.
   Run:  node test-analytics-forecast.js      (exits 0 = all green)         */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '4002';

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

const BASE = 'http://127.0.0.1:4002';
async function call(method, p, { body } = {}) {
  const r = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
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
const DAY = 86400000;
const ago = days => new Date(Date.now() - days * DAY);

function coll(name) { mockdb.__store.get(name) || mockdb.__store.set(name, new Map()); return mockdb.__store.get(name); }
let n = 0;
function seedUser(uid, { regDaysAgo = 200, balance = 0 } = {}) {
  coll('users').set(uid, { registrationDone: true, walletBalance: balance, createdAt: ago(regDaysAgo), name: uid, phone: '07' + (++n) });
}
function seedInvestment(uid, { createdAt, status, dailyPayout = 0, payoutsMade = 0, payoutsTotal = 120, amount = 0 }) {
  coll('investments').set('inv' + (++n), { userId: uid, createdAt, status, dailyPayout, payoutsMade, payoutsTotal, amount });
}
function seedTopup(uid, when, amount) {
  coll('transactions').set('tx' + (++n), { userId: uid, type: 'topup', amount, status: 'success', createdAt: when });
}
function seedCommission(uid, when, amount) {
  coll('transactions').set('tx' + (++n), { userId: uid, type: 'commission', amount, status: 'success', createdAt: when });
}
function seedCheckin(uid, when, amount) {
  coll('transactions').set('tx' + (++n), { userId: uid, type: 'checkin', amount, status: 'success', createdAt: when });
}
function seedWithdrawal(uid, when, amount) {
  coll('withdrawals').set('wit' + (++n), { userId: uid, amount, status: 'processed', createdAt: when });
}

(async () => {
  await sleep(1200);

  console.log('\n── Withdrawals: the owner\'s own example — a 25,000 watch\'s ~6,250 daily cashback alone can\'t clear the 10,000 minimum');
  seedUser('ana', { balance: 0 });
  seedInvestment('ana', { createdAt: ago(20), status: 'active', dailyPayout: 6250, payoutsMade: 20, payoutsTotal: 120, amount: 25000 });

  console.log('── A second day\'s worth of the same cashback DOES clear it, and with no withdrawal history she\'s counted the moment she\'s able');
  seedUser('bob', { balance: 6250 });
  seedInvestment('bob', { createdAt: ago(20), status: 'active', dailyPayout: 6250, payoutsMade: 20, payoutsTotal: 120, amount: 25000 });

  console.log('── A member with an established 2-day withdrawal cadence, due right on schedule, is counted for her OWN typical amount');
  seedUser('cara', { balance: 100000 });
  seedWithdrawal('cara', ago(6), 20000);
  seedWithdrawal('cara', ago(4), 20000);
  seedWithdrawal('cara', ago(2), 20000); // last one exactly 2 days ago = her own average gap -> due today

  console.log('── The same cadence, but her LAST withdrawal was only 1 day ago — not due yet by her own habit');
  seedUser('dan', { balance: 100000 });
  seedWithdrawal('dan', ago(5), 20000);
  seedWithdrawal('dan', ago(3), 20000);
  seedWithdrawal('dan', ago(1), 20000); // only 1 day since the last -> not due (her/his own 2-day gap)

  console.log('── Commission/check-in income is read PER-USER, not assumed for everyone — a low earner never clears the minimum from it alone');
  seedUser('eve', { balance: 0 });
  for (let d = 13; d >= 0; d--) { seedCommission('eve', ago(d), 1000); seedCheckin('eve', ago(d), 500); }

  console.log('── A generous, steady earner DOES get topped up over the minimum by her own trailing commission + check-in average');
  seedUser('finn', { balance: 8000 });
  for (let d = 13; d >= 0; d--) { seedCommission('finn', ago(d), 2000); seedCheckin('finn', ago(d), 500); }

  let r = await call('POST', '/admin/analytics', { body: { ...ADMIN, days: 30 } });
  check('analytics call succeeds', r.body?.status === 'success', r.body);
  const fw = r.body?.forecast?.withdrawals || {};
  check('exactly 3 members are likely + due tomorrow (bob, cara, finn) — not ana or eve (too little income) or dan (not due yet)', fw.likelyWithdrawerCount === 3, fw);
  check('the total is bob(12,500) + cara(20,000 typical) + finn(10,500) = 43,000', fw.estimate === 43000, fw);

  console.log('\n── (reset the store — deposits are checked against a clean, isolated set of members so the rates below are exact round numbers)');
  mockdb.__store.set('users', new Map());
  mockdb.__store.set('transactions', new Map());
  mockdb.__store.set('withdrawals', new Map());
  mockdb.__store.set('investments', new Map());

  console.log('── Deposits: organic trend (a growing week, unrelated to any maturity or new signup) matches the same formula as before');
  seedUser('greg', { regDaysAgo: 200 });
  for (let d = 13; d >= 7; d--) seedTopup('greg', ago(d), 100000);
  for (let d = 6; d >= 0; d--)  seedTopup('greg', ago(d), 150000);

  console.log('── Reinvestment signal: of 2 members whose watch matured, only 1 deposited again within 5 days — a 50% historical rate');
  seedUser('hank', { regDaysAgo: 200 });
  const hankMaturedAt = ago(8);
  seedInvestment('hank', { createdAt: new Date(hankMaturedAt.getTime() - 120 * DAY), status: 'matured', payoutsMade: 120, payoutsTotal: 120, amount: 30000 });
  seedTopup('hank', new Date(hankMaturedAt.getTime() + 2 * DAY), 30000); // reinvested within the 5-day window
  seedInvestment('hank', { createdAt: ago(1), status: 'active', dailyPayout: 333, payoutsMade: 119, payoutsTotal: 120, amount: 40000 }); // matures TOMORROW

  seedUser('ivan', { regDaysAgo: 200 });
  const ivanMaturedAt = ago(9);
  seedInvestment('ivan', { createdAt: new Date(ivanMaturedAt.getTime() - 120 * DAY), status: 'matured', payoutsMade: 120, payoutsTotal: 120, amount: 50000 });
  // ivan never deposited again -> this maturity does NOT count as reinvested

  console.log('── Pipeline signal: greg/hank/ivan are ALSO old-enough-to-judge signups who never converted within 3 days of THEIR OWN registration (200 days ago) — only jane did, so the historical rate is 1 of 5 = 20%; 2 members are in that window right now');
  seedUser('jane', { regDaysAgo: 10 });
  seedTopup('jane', new Date(userCreatedAt('jane').getTime() + 2 * DAY), 25000); // converted within 3 days
  seedUser('kim', { regDaysAgo: 10 }); // never converted
  seedUser('liz', { regDaysAgo: 1 });  // currently mid-funnel, no deposit yet
  seedUser('mo',  { regDaysAgo: 2 });  // currently mid-funnel, no deposit yet

  r = await call('POST', '/admin/analytics', { body: { ...ADMIN, days: 30 } });
  const fd = r.body?.forecast?.deposits || {};
  check('organic trend is 150,000 avg last-7 * 1.5 growth = 225,000, unaffected by the tagged deposits', fd.organicTrend === 225000, fd);
  check('reinvestment rate is exactly 50% (1 of 2 matured members deposited again)', fd.reinvestRatePct === 50, fd);
  check('1 watch (hank\'s 40,000) matures tomorrow, so the reinvestment estimate is 40,000 * 50% = 20,000', fd.maturingCount === 1 && fd.maturingReinvestEstimate === 20000, fd);
  check('conversion rate is exactly 20% (1 of 5 old-enough signups converted within 3 days of THEIR OWN registration)', fd.conversionRatePct === 20, fd);
  check('2 members (liz, mo) are currently mid-funnel', fd.pipelineUserCount === 2, fd);
  check('pipeline estimate is 2 * (20%/3 days) * 25,000 avg first deposit = 3,333', fd.pipelineEstimate === 3333, fd);
  check('the total is organic(225,000) + reinvestment(20,000) + pipeline(3,333) = 248,333', fd.estimate === 248333, fd);

  console.log('\n── No history at all never crashes and estimates zero, not NaN/undefined');
  mockdb.__store.set('users', new Map());
  mockdb.__store.set('transactions', new Map());
  mockdb.__store.set('withdrawals', new Map());
  mockdb.__store.set('investments', new Map());
  r = await call('POST', '/admin/analytics', { body: { ...ADMIN, days: 30 } });
  check('withdrawal estimate is a clean 0 with zero history, not NaN', r.body?.forecast?.withdrawals?.estimate === 0, r.body?.forecast);
  check('deposit estimate is a clean 0 with zero history, not NaN', r.body?.forecast?.deposits?.estimate === 0, r.body?.forecast);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('SUITE CRASH:', e); process.exit(1); });

function userCreatedAt(uid) { return coll('users').get(uid).createdAt; }
