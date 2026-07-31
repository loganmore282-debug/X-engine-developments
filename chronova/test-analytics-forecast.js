/* CHRONOVA — Analytics "Tomorrow's estimate": the admin panel now forecasts
   next-day deposits and withdrawals-to-process from the platform's own recent
   history, so the owner can see roughly what's coming without guessing.

   Deliberately simple and explainable rather than a black-box model: the
   daily average of the most recent 7 days, nudged by how much that week grew
   or shrank versus the 7 days before it (growth clamped to [-40%, +60%] so
   one freak day can't send the estimate somewhere absurd). This test seeds
   two clean 7-day windows with known flat daily amounts and checks the
   server's math against the same formula by hand, then confirms the
   forecast always looks at a fixed 14-day window regardless of whatever
   chart period (7/30/90 days) the admin has selected.
   Run:  node test-analytics-forecast.js      (exits 0 = all green)          */

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
let txN = 0, witN = 0;
function seedTopup(daysAgo, amount) {
  mockdb.__store.get('transactions') || mockdb.__store.set('transactions', new Map());
  mockdb.__store.get('transactions').set('tx' + (++txN), {
    userId: 'someone', type: 'topup', amount, status: 'success',
    createdAt: new Date(Date.now() - daysAgo * 86400000 - 3600000), // an hour clear of midnight
  });
}
function seedWithdrawal(daysAgo, amount) {
  mockdb.__store.get('withdrawals') || mockdb.__store.set('withdrawals', new Map());
  mockdb.__store.get('withdrawals').set('wit' + (++witN), {
    userId: 'someone', amount, status: 'processed',
    createdAt: new Date(Date.now() - daysAgo * 86400000 - 3600000),
  });
}

(async () => {
  await sleep(1200);

  console.log('\n── Seed two clean 7-day windows with known flat daily amounts');
  // Deposits: growing week (100,000/day -> 150,000/day) = +50% growth.
  // Withdrawals: shrinking week (50,000/day -> 40,000/day) = -20% growth.
  for (let d = 13; d >= 7; d--) { seedTopup(d, 100000); seedWithdrawal(d, 50000); }
  for (let d = 6; d >= 0; d--)  { seedTopup(d, 150000); seedWithdrawal(d, 40000); }

  console.log('\n── The forecast matches the documented formula by hand');
  let r = await call('POST', '/admin/analytics', { body: { ...ADMIN, days: 30 } });
  check('analytics call succeeds', r.body?.status === 'success', r.body);
  const f = r.body?.forecast || {};
  check('deposits: last-7 daily average is 150,000', f.depositsAvgLast7 === 150000, f);
  check('deposits: growth vs the prior week is +50%', f.depositsGrowthPct === 50, f);
  check('deposits: estimate = 150,000 * 1.5 = 225,000', f.estimatedNextDayDeposits === 225000, f);
  check('withdrawals: last-7 daily average is 40,000', f.withdrawalsAvgLast7 === 40000, f);
  check('withdrawals: growth vs the prior week is -20%', f.withdrawalsGrowthPct === -20, f);
  check('withdrawals: estimate = 40,000 * 0.8 = 32,000', f.estimatedNextDayWithdrawals === 32000, f);
  check('the forecast looks at a fixed 14-day window', f.basisDays === 14, f);

  console.log('\n── The forecast is unaffected by the chart\'s selected period (7/30/90 days)');
  r = await call('POST', '/admin/analytics', { body: { ...ADMIN, days: 7 } });
  const f7 = r.body?.forecast || {};
  check('a 7-day chart period still sees the full 14-day forecast window', f7.estimatedNextDayDeposits === 225000 && f7.estimatedNextDayWithdrawals === 32000, f7);
  check('but the 7-day chart itself only shows 7 days', (r.body?.byDay || []).length === 7, (r.body?.byDay || []).length);

  console.log('\n── An extreme week-over-week swing is clamped, not left to explode');
  // Wipe and reseed: prior week nearly zero, latest week enormous -> would be
  // a huge multiple of growth without clamping.
  mockdb.__store.set('transactions', new Map());
  mockdb.__store.set('withdrawals', new Map());
  for (let d = 13; d >= 7; d--) seedTopup(d, 1000);
  for (let d = 6; d >= 0; d--)  seedTopup(d, 1000000);
  r = await call('POST', '/admin/analytics', { body: { ...ADMIN, days: 30 } });
  const fx = r.body?.forecast || {};
  check('growth is clamped at +60%, not the raw (huge) ratio', fx.depositsGrowthPct === 60, fx);
  check('the estimate reflects the clamp, not an absurd raw projection', fx.estimatedNextDayDeposits === Math.round(1000000 * 1.6), fx);

  console.log('\n── No history at all never crashes and estimates zero, not NaN/undefined');
  mockdb.__store.set('transactions', new Map());
  mockdb.__store.set('withdrawals', new Map());
  r = await call('POST', '/admin/analytics', { body: { ...ADMIN, days: 30 } });
  const fz = r.body?.forecast || {};
  check('estimate is a clean 0 with zero history, not NaN', fz.estimatedNextDayDeposits === 0 && fz.estimatedNextDayWithdrawals === 0, fz);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('SUITE CRASH:', e); process.exit(1); });
