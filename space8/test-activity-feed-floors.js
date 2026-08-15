/* SPACE8 ACTIVITY FEED — LIVE MINIMUM FLOORS TEST
   The simulated "global activity" feed (Home screen ticker) used to draw
   deposit amounts from a hardcoded ladder starting at 10,000 and withdrawal
   amounts from a hardcoded 5,000-step ladder -- both fixed constants,
   never actually reading the admin's live minDeposit/minWithdraw settings.
   That's an obvious tell the feed is fake the moment an admin raises the
   real minimum above what the "simulated" activity still shows (e.g. a
   30,000 minimum deposit next to a feed casually showing someone "topping
   up 10,000"), and isn't "global" in the sense of tracking the one real
   configured value everywhere else in the app already does.

   This sets minDeposit/minWithdraw to deliberately unusual values BEFORE
   the feed is ever built for the first time in this process (so the very
   first build reflects them, no waiting on the ~25s async refresh), then
   proves every single generated row -- all 18 -- respects its own floor.

   Run: node test-activity-feed-floors.js   (exits 0 = all green)         */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '4113';

const Module = require('module');
const mockdb = require('./test-mockdb.js');
const dbPath = require.resolve('./db.js');
const dbMod = new Module(dbPath); dbMod.exports = mockdb; dbMod.loaded = true;
require.cache[dbPath] = dbMod;

const faPath = require.resolve('firebase-admin');
const faMod = new Module(faPath);
faMod.exports = {
  initializeApp: () => {}, credential: { cert: () => ({}) },
  auth: () => ({ verifyIdToken: async () => { throw new Error('n/a'); } }),
};
faMod.loaded = true;
require.cache[faPath] = faMod;

require('./server.js');

const BASE = 'http://127.0.0.1:4113';
const adminHeaders = { 'Content-Type': 'application/json', Authorization: 'Bearer test-admin-key' };
async function adminCall(path, body) {
  const r = await fetch(BASE + path, { method: 'POST', headers: adminHeaders, body: JSON.stringify(body || {}) });
  let j = null; try { j = await r.json(); } catch (_) {}
  return { code: r.status, body: j };
}
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   - ' + name); }
  else { fail++; console.log('  FAIL - ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}

(async () => {
  await new Promise(r => setTimeout(r, 600));

  console.log('\n== Set deliberately unusual minimums BEFORE the feed is ever built ==');
  const settR = await adminCall('/admin/settings/update', { settings: { minDeposit: 230000, minWithdraw: 115000 } });
  check('settings save succeeds', settR.body?.status === 'success', settR.body);

  console.log('\n== First-ever activity feed build reflects those live minimums, not any hardcoded floor ==');
  const r = await fetch(BASE + '/public/activity-feed');
  const feed = (await r.json()).feed || [];
  check('feed has rows', feed.length > 0, feed.length);
  const deposits = feed.filter(f => f.kind === 'deposit');
  const withdrawals = feed.filter(f => f.kind === 'withdraw');
  check('at least one of each kind showed up across 18 rows (sanity)', deposits.length > 0 && withdrawals.length > 0, { deposits: deposits.length, withdrawals: withdrawals.length });
  const badDeposit = deposits.find(d => d.amount < 230000);
  check('every simulated top-up is >= the live minDeposit (230,000), none below it', !badDeposit, badDeposit);
  const badWithdraw = withdrawals.find(w => w.amount < 115000);
  check('every simulated payout is >= the live minWithdraw (115,000), none below it', !badWithdraw, badWithdraw);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
