/* NOVERA OWNER-ONLY SUSPICIOUS-ACTIVITY ANALYTICS
   Owner asked for visibility into abuse patterns by name: accounts with
   many failed deposits, accounts repeatedly trying to withdraw more than
   their balance, accounts repeatedly re-tapping check-in after already
   claiming today, and accounts guessing gift/promo codes that don't exist.
   Explicitly owner-only -- "put in admin, owner only" -- never disclosed
   to staff, same treatment as Integrity audit and the other owner-only
   tools already in this panel.

   Deposits already have status:'failed' records (nothing new to log);
   the other three signals are newly logged to a 'securityEvents'
   collection at the exact point /checkin, /withdraw/request, and /redeem
   already reject them -- this test never touches that collection
   directly, it only ever drives the real endpoints and then reads back
   through the real new GET-style POST /admin/analytics/abuse endpoint.

   Boots the REAL server.js against an in-memory mock database and proves:
     - a user who fails a deposit 5 times shows up under "repeated failed
       deposits" with the right count
     - a user who tries to withdraw more than their balance 4 times shows
       up under "repeated insufficient-funds withdrawal attempts", with
       the attempted/balance amounts visible in the samples -- and their
       wallet is never touched (nothing to reverse, nothing was ever
       reserved)
     - a user who taps check-in twice in the same day (1 real claim + 3
       "already claimed" rejections) shows up under "repeated already-
       claimed check-ins" with count 3, not 4 (the one real claim isn't
       counted as suspicious)
     - a user who tries 4 gift codes that don't exist shows up under
       "gift/promo code guessing", with the actual codes tried visible
     - a user with only 1-2 of any of these (below the 3-repeat threshold)
       never appears at all -- ordinary mistakes aren't flagged
     - a real, valid gift-code rejection (already used / usage cap) is
       NOT counted as "guessing" -- only codes that don't exist at all are
     - non-owner staff is refused outright (401), proving this is
       genuinely gated separately from the general /admin/analytics staff
       can already read
     - raising minCount actually changes who appears

   Run: node test-abuse-analytics.js   (exits 0 = all green)              */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '4155';

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

const BASE = 'http://127.0.0.1:4155';
async function call(method, p, { token, adminKey, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (adminKey) headers.Authorization = 'Bearer ' + adminKey;
  const r = await fetch(BASE + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (_) {}
  return { code: r.status, body: j };
}
async function ownerCall(path, body) { return call('POST', path, { adminKey: 'test-admin-key', body: body || {} }); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
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
let fxN = 0;

async function createProfile(uid, phone) {
  await call('POST', '/account/create-profile', { token: 'uid:' + uid, body: { phone } });
  await call('POST', '/register', { token: 'uid:' + uid, body: {} });
}
function bindMomo(uid, phone) {
  collMap('bankAccounts').set('fx' + (++fxN), { userId: uid, holder: 'Tester', network: 'MTN Mobile Money', phone, createdAt: new Date() });
}
function addFailedDeposit(uid, amount) {
  collMap('pendingDeposits').set('dep' + (++fxN), { userId: uid, amount, status: 'failed', failureReason: 'test', createdAt: new Date() });
}

function findRow(list, uid) { return (list || []).find(r => r.userId === uid); }

(async () => {
  await sleep(600);

  console.log('\n== A user with 5 failed deposits shows up under repeated failed deposits ==');
  const DEP = 'ab-dep';
  await createProfile(DEP, '0771980101');
  for (let i = 0; i < 5; i++) addFailedDeposit(DEP, 10000 + i * 1000);

  console.log('\n== A user who tries to withdraw more than their balance 4 times ==');
  const WIT = 'ab-wit';
  await createProfile(WIT, '0771980102');
  userDoc(WIT).totalInvested = 50000; // clears requireInvestToWithdraw
  userDoc(WIT).walletBalance = 5000;
  const witPhoneClean = '+256771980102';
  bindMomo(WIT, witPhoneClean);
  const balBeforeWit = userDoc(WIT).walletBalance;
  let r;
  for (let i = 0; i < 4; i++) {
    r = await call('POST', '/withdraw/request', { token: 'uid:' + WIT, body: { amount: 300000, holder: 'Tester', network: 'MTN Mobile Money', phone: '0771980102', pin: '1234' } });
    check(`insufficient-funds attempt ${i + 1} correctly rejected`, r.body?.status === 'error' && /Not enough balance/.test(r.body?.message || ''), r.body);
  }
  check('wallet never touched by any of the rejected attempts', userDoc(WIT).walletBalance === balBeforeWit, { before: balBeforeWit, after: userDoc(WIT).walletBalance });

  console.log('\n== A user who taps check-in 4 times same day (1 real claim + 3 already-claimed) ==');
  const CHK = 'ab-chk';
  await createProfile(CHK, '0771980103');
  r = await call('POST', '/checkin', { token: 'uid:' + CHK });
  check('first check-in of the day succeeds', r.body?.status === 'success', r.body);
  for (let i = 0; i < 3; i++) {
    r = await call('POST', '/checkin', { token: 'uid:' + CHK });
    check(`repeat check-in ${i + 1} correctly rejected as already claimed`, r.body?.message === 'Already checked in today', r.body);
  }

  console.log('\n== A user who tries 4 gift codes that do not exist (guessing) ==');
  const GFT = 'ab-gft';
  await createProfile(GFT, '0771980104');
  for (const code of ['NOPE1', 'NOPE2', 'NOPE3', 'NOPE4']) {
    r = await call('POST', '/redeem', { token: 'uid:' + GFT, body: { code } });
    check(`guess "${code}" correctly rejected`, r.body?.message === "That code isn't valid", r.body);
  }

  console.log('\n== A REAL code, already used, is NOT counted as guessing (only nonexistent codes are) ==');
  const REAL = 'ab-real';
  await createProfile(REAL, '0771980105');
  collMap('promoCodes').set('promo1', { code: 'REALCODE', active: true, reward: 1000, usedBy: [REAL] });
  for (let i = 0; i < 4; i++) {
    r = await call('POST', '/redeem', { token: 'uid:' + REAL, body: { code: 'REALCODE' } });
    check(`already-used real code attempt ${i + 1} rejected, but not as guessing`, r.body?.message === "You've already used this code", r.body);
  }

  console.log('\n== A user with only 2 failed deposits stays below the default 3-repeat threshold ==');
  const BELOW = 'ab-below';
  await createProfile(BELOW, '0771980106');
  addFailedDeposit(BELOW, 5000);
  addFailedDeposit(BELOW, 5000);

  console.log('\n== Non-owner staff is refused outright ==');
  await ownerCall('/admin/admins/create', { username: 'ab_staff', password: 'whatever-123' });
  const staffLogin = await call('POST', '/admin/login', { body: { username: 'ab_staff', password: 'whatever-123' } });
  r = await call('POST', '/admin/analytics/abuse', { token: staffLogin.body?.token, body: {} });
  check('staff (non-owner) refused with 401', r.code === 401, r.body);

  console.log('\n== Owner reads the aggregated abuse analytics ==');
  r = await ownerCall('/admin/analytics/abuse', { days: 30 });
  check('owner call succeeds', r.body?.status === 'success', r.body);
  const b = r.body || {};

  const depRow = findRow(b.repeatedFailedDeposits, DEP);
  check('DEP appears under repeated failed deposits with count 5', depRow?.count === 5, depRow);
  check('DEP has the right phone shown', depRow?.phone === '+256771980101', depRow);

  const witRow = findRow(b.repeatedInsufficientWithdrawals, WIT);
  check('WIT appears under repeated insufficient-funds withdrawals with count 4', witRow?.count === 4, witRow);
  check('WIT samples show the attempted amount', (witRow?.samples || []).some(s => s.attempted === 300000), witRow);

  const chkRow = findRow(b.repeatedCheckinAlreadyClaimed, CHK);
  check('CHK appears under repeated already-claimed check-ins with count 3 (not 4 -- the real claim does not count)', chkRow?.count === 3, chkRow);

  const gftRow = findRow(b.giftcodeGuessing, GFT);
  check('GFT appears under gift-code guessing with count 4', gftRow?.count === 4, gftRow);
  check('GFT samples show the actual codes tried', (gftRow?.samples || []).includes('NOPE1'), gftRow);

  check('REAL (already-used, valid code) never appears under guessing', !findRow(b.giftcodeGuessing, REAL), b.giftcodeGuessing);
  check('BELOW (only 2 failed deposits) never appears at all', !findRow(b.repeatedFailedDeposits, BELOW), b.repeatedFailedDeposits);

  console.log('\n== Raising minCount changes who appears ==');
  r = await ownerCall('/admin/analytics/abuse', { days: 30, minCount: 5 });
  check('at minCount=5, WIT (only 4 attempts) drops out', !findRow(r.body.repeatedInsufficientWithdrawals, WIT), r.body.repeatedInsufficientWithdrawals);
  check('at minCount=5, DEP (exactly 5 failures) still appears', !!findRow(r.body.repeatedFailedDeposits, DEP), r.body.repeatedFailedDeposits);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
