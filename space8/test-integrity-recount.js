/* Sanity checks for /admin/users/recount and /admin/integrity. */
process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '4020';

const Module = require('module');
const mockdb = require('./test-mockdb.js');
const dbPath = require.resolve('./db.js');
const dbMod = new Module(dbPath); dbMod.exports = mockdb; dbMod.loaded = true;
require.cache[dbPath] = dbMod;
const faPath = require.resolve('firebase-admin');
const faMod = new Module(faPath);
faMod.exports = { initializeApp: () => {}, credential: { cert: () => ({}) }, auth: () => ({ verifyIdToken: async () => { throw new Error('n/a'); } }) };
faMod.loaded = true;
require.cache[faPath] = faMod;
require('./server.js');

const realFetch = global.fetch;
const BASE = 'http://127.0.0.1:4020';
const adminHeaders = { 'Content-Type': 'application/json', Authorization: 'Bearer test-admin-key' };
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   - ' + name); }
  else { fail++; console.log('  FAIL - ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}
function collMap(name) {
  if (!mockdb.__store.has(name)) mockdb.__store.set(name, new Map());
  return mockdb.__store.get(name);
}

(async () => {
  await new Promise(r => setTimeout(r, 600));

  const users = collMap('users');
  const txs = collMap('transactions');
  users.set('u1', { phone: '0771000001', walletBalance: 100, totalDeposited: 0, totalEarned: 0 });
  users.set('u2', { phone: '0771000002', walletBalance: -50, totalDeposited: 0, totalEarned: 0 });
  txs.set('t1', { userId: 'u1', type: 'deposit', amount: 30000, ref: 'B1' });
  txs.set('t2', { userId: 'u1', type: 'deposit', amount: 30000, ref: 'B1' }); // duplicate ref -> flagged
  txs.set('t3', { userId: 'u1', type: 'cashback', amount: 5000 });
  txs.set('t4', { userId: 'u1', type: 'withdraw', amount: -100 });

  console.log('\n== /admin/users/recount ==');
  let r = await realFetch(BASE + '/admin/users/recount', { method: 'GET', headers: adminHeaders });
  let body = await r.json();
  check('recount succeeds', body.status === 'success', body);
  check('recount rebuilt totalDeposited from ledger (60000)', users.get('u1').totalDeposited === 60000, users.get('u1'));
  check('recount rebuilt totalEarned from ledger (5000)', users.get('u1').totalEarned === 5000, users.get('u1'));
  check('recount never touched walletBalance', users.get('u1').walletBalance === 100, users.get('u1').walletBalance);

  console.log('\n== /admin/integrity ==');
  r = await realFetch(BASE + '/admin/integrity', { method: 'GET', headers: adminHeaders });
  body = await r.json();
  check('integrity succeeds', body.status === 'success', body);
  check('flags negative balance for u2', body.alerts.some(a => a.kind === 'negative_balance' && a.userId === 'u2'), body.alerts);
  check('flags duplicate credit for u1/B1', body.alerts.some(a => a.kind === 'duplicate_credit' && a.userId === 'u1' && a.ref === 'B1' && a.times === 2), body.alerts);
  check('flags balance mismatch for u1 (wallet 100 vs ledger 60000+5000-100=64900)', body.alerts.some(a => a.kind === 'balance_mismatch' && a.userId === 'u1'), body.alerts);
  check('not reported healthy given real issues exist', body.healthy === false, body);

  console.log('\n== Non-owner cannot call either endpoint ==');
  r = await realFetch(BASE + '/admin/users/recount', { method: 'GET' });
  check('recount rejects unauthenticated', r.status === 401, await r.text());
  r = await realFetch(BASE + '/admin/integrity', { method: 'GET' });
  check('integrity rejects unauthenticated', r.status === 401, await r.text());

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
