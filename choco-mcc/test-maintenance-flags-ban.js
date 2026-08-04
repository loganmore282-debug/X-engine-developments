/* CHOCOMCC MAINTENANCE-MODE, PRODUCT-FLAG, AND BAN-COVERAGE AUDIT
   Owner reported flagging a product "coming soon" and it still being live —
   traced to two real gaps: (1) /team/milestone/claim was never in the
   maintenance-mode block list, so claims kept paying out during a declared
   maintenance window, and (2) /bank/save had no banned-account check, so a
   banned user could still rebind their payout account. Both are fixed in
   server.js; this proves it against the real server, not just the diff.
   Also proves /public/products actually carries the comingSoon/active flags
   the client now renders a "Sold out" badge from.

   Run: node test-maintenance-flags-ban.js   (exits 0 = all green)          */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '4092';

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

require('./server.js');

const realFetch = global.fetch;
const BASE = 'http://127.0.0.1:4092';
const adminHeaders = { 'Content-Type': 'application/json', Authorization: 'Bearer test-admin-key' };
async function call(method, p, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await realFetch(BASE + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (_) {}
  return { code: r.status, body: j };
}
async function adminCall(path, body) {
  const r = await realFetch(BASE + path, { method: 'POST', headers: adminHeaders, body: JSON.stringify(body || {}) });
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
const userDoc = id => users().get(id);

async function setupUser(uid, phone) {
  await call('POST', '/account/create-profile', { token: 'uid:' + uid, body: { phone } });
  await call('POST', '/register', { token: 'uid:' + uid, body: {} });
}

(async () => {
  await new Promise(r => setTimeout(r, 600));

  console.log('\n== A product flagged coming-soon/sold-out is actually flagged in what the client reads ==');
  await adminCall('/admin/products/save', { products: [{ key: 'godiva', name: 'Godiva Gold Box', price: 4000000, cycle: 180, expectedReturn: 80000000, comingSoon: true }] });
  let r = await call('GET', '/public/products');
  const godiva = (r.body?.products || []).find(p => p.key === 'godiva');
  check('/public/products actually carries comingSoon:true through to the client', godiva?.comingSoon === true, godiva);
  const D = 'sold-out-buyer';
  await setupUser(D, '0771000201');
  userDoc(D).walletBalance = 10000000;
  r = await call('POST', '/invest/create', { token: 'uid:' + D, body: { tierKey: 'godiva' } });
  check('buying a flagged-sold-out product is still rejected server-side', r.code === 400, r.body);
  check('wallet untouched by the rejected sold-out purchase attempt', userDoc(D).walletBalance === 10000000, userDoc(D).walletBalance);

  console.log('\n== Maintenance mode now actually blocks Task Center claims (was the real gap) ==');
  const E = 'maint-claimer';
  await setupUser(E, '0771000202');
  // Fabricate an achieved-but-unclaimed milestone so a claim attempt is real.
  const refA = 'maint-ref-a', refB = 'maint-ref-b', refC = 'maint-ref-c', refD = 'maint-ref-d', refE = 'maint-ref-e';
  for (const rid of [refA, refB, refC, refD, refE]) {
    await setupUser(rid, '07710002' + Math.floor(Math.random() * 90 + 10));
    userDoc(rid).referredBy = E;
    userDoc(rid).totalInvested = 50000;
  }
  await adminCall('/admin/settings/update', { settings: { maintenanceMode: true, maintenanceMsg: 'be right back' } });
  r = await call('POST', '/team/milestone/claim', { token: 'uid:' + E, body: { target: 5, type: 'count' } });
  check('milestone claim is blocked during maintenance mode (503/MAINTENANCE)', r.code === 503 && r.body?.code === 'MAINTENANCE', r.body);
  r = await call('GET', '/team/stats', { token: 'uid:' + E });
  check('reading Team stats is also paused during maintenance (matches /account read behavior)', r.code === 503, r.body);
  await adminCall('/admin/settings/update', { settings: { maintenanceMode: false } });
  r = await call('POST', '/team/milestone/claim', { token: 'uid:' + E, body: { target: 5, type: 'count' } });
  check('the SAME claim works normally again once maintenance is turned off', r.body?.status === 'success', r.body);

  console.log('\n== A banned account can no longer rebind its payout (bank) account ==');
  const F = 'banned-bank-user';
  await setupUser(F, '0771000203');
  userDoc(F).status = 'banned';
  r = await call('POST', '/bank/save', { token: 'uid:' + F, body: { holder: 'Banned Guy', network: 'MTN Mobile Money', phone: '0771000203' } });
  check('a banned account is rejected from binding/rebinding a payout account', r.code === 403, r.body);
  const savedAccounts = [...collMap('bankAccounts').values()].filter(a => a.userId === F);
  check('no bank account was actually saved for the banned attempt', savedAccounts.length === 0, savedAccounts);

  console.log('\n== The actual bug the owner found: a banned account could still use /account and get into the app ==');
  // Every WRITE endpoint (checkin, invest, deposit, withdraw, bank/save,
  // redeem) already refused a banned account -- but /account itself, the
  // one endpoint that runs on every login and every background poll and
  // decides whether the app lets someone in at all, had no ban check
  // whatsoever. A banned account could sign in and use the app normally for
  // as long as it never happened to hit one of those specific write
  // endpoints. Proven here against the real server, not just the diff.
  const H = 'banned-account-user';
  await setupUser(H, '0771000205');
  r = await call('GET', '/account', { token: 'uid:' + H });
  check('a banned account can still reach /account before being banned (sanity check)', r.body?.status === 'success', r.body);
  userDoc(H).status = 'banned';
  r = await call('GET', '/account', { token: 'uid:' + H });
  check('SECURITY: /account now refuses a banned account (403/BANNED) -- this was the real gap', r.code === 403 && r.body?.code === 'BANNED', r.body);

  console.log('\n== code: \'BANNED\' is consistent across every endpoint, not just some ==');
  const I = 'banned-everywhere-user';
  await setupUser(I, '0771000206');
  userDoc(I).walletBalance = 5000000;
  userDoc(I).status = 'banned';
  r = await call('POST', '/checkin', { token: 'uid:' + I, body: {} });
  check('checkin: code is BANNED', r.body?.code === 'BANNED', r.body);
  r = await call('POST', '/invest/create', { token: 'uid:' + I, body: { tierKey: 'hersheys' } });
  check('invest/create (thrown inside a transaction): code still reaches BANNED', r.body?.code === 'BANNED', r.body);
  r = await call('POST', '/withdraw/request', { token: 'uid:' + I, body: { amount: 20000, holder: 'x', network: 'MTN Mobile Money', phone: '0771000206' } });
  check('withdraw/request (thrown inside a transaction): code still reaches BANNED', r.body?.code === 'BANNED', r.body);
  r = await call('POST', '/deposit/marzpay', { token: 'uid:' + I, body: { amount: 30000, phone: '0771000206', network: 'MTN Mobile Money' } });
  check('deposit/marzpay: code is BANNED', r.body?.code === 'BANNED', r.body);
  r = await call('POST', '/redeem', { token: 'uid:' + I, body: { code: 'WHATEVER' } });
  check('redeem: code is BANNED', r.body?.code === 'BANNED', r.body);

  console.log('\n-- An active (non-banned) account can still bind normally --');
  const G = 'active-bank-user';
  await setupUser(G, '0771000204');
  r = await call('POST', '/bank/save', { token: 'uid:' + G, body: { holder: 'Active Guy', network: 'MTN Mobile Money', phone: '0771000204' } });
  check('a normal active account can still bind a payout account', r.body?.status === 'success', r.body);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
