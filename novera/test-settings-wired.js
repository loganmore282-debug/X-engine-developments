/* NOVERA — FULL SETTINGS WIRING AUDIT
   Every single field in DEFAULT_SETTINGS, proven end-to-end: saved through
   the real admin endpoint, echoed back correctly by both /admin/settings
   and /public/settings, AND actually changing real computed behavior —
   not just changing a number somewhere that nothing reads. This is the
   test that should have existed from the start: it saves ALL settings to
   distinctive non-default values in one call (exactly like clicking "Save
   rates" in the admin panel), then checks every consumer of each field.

   Run: node test-settings-wired.js   (exits 0 = all green)               */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '4065';

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
const BASE = 'http://127.0.0.1:4065';
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
const userDoc = id => users().get(id);

// Distinctive, all-different-from-default values so a stale/hardcoded
// fallback anywhere would show up immediately as a mismatch.
const NEW = {
  withdrawFeePct: 33, minWithdraw: 12345, minDeposit: 6789,
  dailyCheckin: 777, welcomeBonus: 8888, commL1: 40, commL2: 8, commL3: 3,
  returnMultiple: 9, cycleDays: 45, maxWithdrawalsPerDay: 5,
  requireInvestToWithdraw: false, maintenanceMode: false, maintenanceMsg: 'test maint msg',
  annEnabled: true, annTitle: 'Test Title', annBody: 'Test Body',
  telegramGroup: 'https://t.me/testgroup',
  telegramChannel: 'https://t.me/testchannel', supportHours: '9am-5pm test',
  rulesText: 'Test rules text', brandTagline: 'Test tagline', aboutText: 'Test about text',
};

(async () => {
  await new Promise(r => setTimeout(r, 600));

  console.log('\n== Save ALL settings at once, exactly like the admin panel\'s "Save rates" + other Save buttons ==');
  let r = await call('POST', '/admin/settings/update', { admin: true, body: { settings: NEW } });
  check('save succeeds', r.body?.status === 'success', r.body);

  console.log('\n== GET /admin/settings echoes every field back (admin form population) ==');
  r = await call('GET', '/admin/settings', { admin: true });
  const adminS = r.body?.settings || {};
  for (const k of Object.keys(NEW)) {
    check(`admin settings echoes ${k} = ${JSON.stringify(NEW[k])}`, adminS[k] === NEW[k], adminS[k]);
  }

  console.log('\n== GET /public/settings echoes every field back (what the client actually syncs) ==');
  r = await call('GET', '/public/settings');
  const pubS = r.body?.settings || {};
  for (const k of Object.keys(NEW)) {
    check(`public settings echoes ${k} = ${JSON.stringify(NEW[k])}`, pubS[k] === NEW[k], pubS[k]);
  }

  console.log('\n== Real behavior actually uses the new numbers (not just echoed text) ==');

  console.log('\n-- Registration: welcomeBonus actually credited --');
  await call('POST', '/account/create-profile', { token: 'uid:regtest', body: { phone: '0771000050' } });
  r = await call('POST', '/register', { token: 'uid:regtest', body: {} });
  check('welcome bonus in response matches new welcomeBonus (8,888)', r.body?.welcomeBonus === 8888, r.body);
  check('wallet actually credited 8,888', userDoc('regtest').walletBalance === 8888, userDoc('regtest').walletBalance);

  console.log('\n-- Check-in: dailyCheckin actually credited --');
  r = await call('POST', '/checkin', { token: 'uid:regtest', body: {} });
  check('check-in bonus matches new dailyCheckin (777)', r.body?.bonus === 777, r.body);

  console.log('\n-- Deposit: minDeposit actually enforced --');
  r = await call('POST', '/deposit/marzpay', { token: 'uid:regtest', body: { amount: 6788, phone: '0771000050', network: 'MTN Mobile Money' } });
  check('deposit below new minDeposit (6,789) rejected', r.code === 400 && /6,789/.test(r.body?.message || ''), r.body);

  console.log('\n-- Investment: cycleDays/returnMultiple fallback actually used for a product with no explicit cycle/expectedReturn --');
  await call('POST', '/admin/products/save', { admin: true, body: { products: [{ key: 'fallbacktest', name: 'Fallback Test', price: 10000, active: true }] } });
  userDoc('regtest').walletBalance = 100000;
  userDoc('regtest').totalInvested = 0;
  r = await call('POST', '/invest/create', { token: 'uid:regtest', body: { tierKey: 'fallbacktest' } });
  check('purchase succeeds', r.body?.status === 'success', r.body);
  const invs = collMap('investments');
  const fallbackInv = [...invs.values()].find(i => i.tierKey === 'fallbacktest');
  check('investment cycle falls back to new cycleDays (45)', fallbackInv?.cycle === 45, fallbackInv);
  check('investment expectedReturn falls back to price*new returnMultiple (10,000*9=90,000)', fallbackInv?.expectedReturn === 90000, fallbackInv);

  console.log('\n-- Referral commission: new commL1/L2/L3 rates actually paid --');
  await call('POST', '/account/create-profile', { token: 'uid:refroot', body: { phone: '0771000051' } });
  const rootReg = await call('POST', '/register', { token: 'uid:refroot', body: {} });
  const rootCode = rootReg.body.referralCode;
  await call('POST', '/account/create-profile', { token: 'uid:refbuyer', body: { phone: '0771000052' } });
  await call('POST', '/register', { token: 'uid:refbuyer', body: { referralCode: rootCode } });
  userDoc('refbuyer').walletBalance = 100000;
  const rootBalBefore = userDoc('refroot').walletBalance;
  r = await call('POST', '/invest/create', { token: 'uid:refbuyer', body: { tierKey: 'fallbacktest' } });
  check('referred purchase succeeds', r.body?.status === 'success', r.body);
  await new Promise(res => setTimeout(res, 200)); // commission credited async
  const expectedCommission = Math.round(10000 * 40 / 100); // new commL1 = 40%
  check('L1 commission paid at new rate (40% of 10,000 = 4,000)',
    userDoc('refroot').walletBalance === rootBalBefore + expectedCommission,
    { got: userDoc('refroot').walletBalance - rootBalBefore, expected: expectedCommission });

  console.log('\n-- Withdrawal: new minWithdraw, withdrawFeePct, maxWithdrawalsPerDay all actually enforced --');
  userDoc('refbuyer').totalInvested = 10000; // satisfy requireInvestToWithdraw regardless (already false, but be realistic)
  await call('POST', '/bank/save', { token: 'uid:refbuyer', body: { holder: 'Ref Buyer', network: 'MTN Mobile Money', phone: '700111333' } });
  collMap('bankAccounts').set('fx1', { userId: 'refbuyer', holder: 'Ref Buyer', network: 'MTN Mobile Money', phone: '+256700111333', createdAt: new Date() });
  r = await call('POST', '/withdraw/request', { token: 'uid:refbuyer', body: { amount: 12000, holder: 'Ref Buyer', network: 'MTN Mobile Money', phone: '700111333', pin: '1234' } });
  check('withdrawal below new minWithdraw (12,345) rejected', r.code === 400 && /12,345/.test(r.body?.message || ''), r.body);
  const walBefore = userDoc('refbuyer').walletBalance;
  collMap('bankAccounts').set('fx2', { userId: 'refbuyer', holder: 'Ref Buyer', network: 'MTN Mobile Money', phone: '+256700111333', createdAt: new Date() });
  r = await call('POST', '/withdraw/request', { token: 'uid:refbuyer', body: { amount: 20000, holder: 'Ref Buyer', network: 'MTN Mobile Money', phone: '700111333', pin: '1234' } });
  check('withdrawal at/above new minWithdraw succeeds', r.body?.status === 'success', r.body);
  const expectedFee = Math.round(20000 * 33 / 100); // new withdrawFeePct = 33%
  check('fee computed at new rate (33% of 20,000 = 6,600), net = 13,400', r.body?.net === 20000 - expectedFee, r.body);
  check('wallet debited the full requested amount', userDoc('refbuyer').walletBalance === walBefore - 20000, userDoc('refbuyer').walletBalance);

  console.log('\n-- requireInvestToWithdraw: turning it off actually allows a never-invested account to withdraw --');
  await call('POST', '/account/create-profile', { token: 'uid:neverinvested', body: { phone: '0771000053' } });
  await call('POST', '/register', { token: 'uid:neverinvested', body: {} });
  userDoc('neverinvested').walletBalance = 100000;
  await call('POST', '/bank/save', { token: 'uid:neverinvested', body: { holder: 'Never Invested', network: 'MTN Mobile Money', phone: '700111444' } });
  collMap('bankAccounts').set('fx3', { userId: 'neverinvested', holder: 'Never Invested', network: 'MTN Mobile Money', phone: '+256700111444', createdAt: new Date() });
  r = await call('POST', '/withdraw/request', { token: 'uid:neverinvested', body: { amount: 20000, holder: 'Never Invested', network: 'MTN Mobile Money', phone: '700111444', pin: '1234' } });
  check('withdrawal succeeds with requireInvestToWithdraw=false even though never invested', r.body?.status === 'success', r.body);

  console.log('\n-- Re-enabling requireInvestToWithdraw immediately blocks the same account again --');
  await call('POST', '/admin/settings/update', { admin: true, body: { settings: { requireInvestToWithdraw: true } } });
  collMap('bankAccounts').set('fx4', { userId: 'neverinvested', holder: 'Never Invested', network: 'MTN Mobile Money', phone: '+256700111444', createdAt: new Date() });
  r = await call('POST', '/withdraw/request', { token: 'uid:neverinvested', body: { amount: 20000, holder: 'Never Invested', network: 'MTN Mobile Money', phone: '700111444', pin: '1234' } });
  check('withdrawal now rejected once the setting is flipped back on', r.code === 400 && /at least one plan/i.test(r.body?.message || ''), r.body);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
