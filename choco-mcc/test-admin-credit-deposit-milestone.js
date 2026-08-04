/* CHOCOMCC ADMIN-CREDIT-COUNTS-AS-DEPOSIT AUDIT
   Owner explicitly asked: admin wallet credits (/admin/deposit — usually
   standing in for a real payment MarzPay's own gateway declined) should
   count toward totalDeposited, exactly like a real deposit, so a referrer's
   Task Center "Level 1 team deposits" milestone reflects it too.

   Proves, against the real server:
     - an admin credit increments the CREDITED USER's totalDeposited
     - that increase is visible to their REFERRER's l1TeamDeposits total
     - it can push the referrer's deposit-milestone ladder from not-yet-
       achieved to achieved, and the referrer can actually claim it
     - a staff (non-owner) admin still can't use this endpoint at all —
       the owner-only gate on /admin/deposit is unchanged by this fix

   Run: node test-admin-credit-deposit-milestone.js   (exits 0 = all green) */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '4102';

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

const BASE = 'http://127.0.0.1:4102';
async function call(method, p, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await fetch(BASE + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (_) {}
  return { code: r.status, body: j };
}
async function ownerCall(path, body) {
  const r = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-admin-key' }, body: JSON.stringify(body || {}) });
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

async function setupUser(uid, phone, referralCode) {
  await call('POST', '/account/create-profile', { token: 'uid:' + uid, body: { phone } });
  await call('POST', '/register', { token: 'uid:' + uid, body: referralCode ? { referralCode } : {} });
}

(async () => {
  await new Promise(r => setTimeout(r, 600));

  console.log('\n== An admin credit increments the credited user\'s totalDeposited ==');
  const A = 'credit-recipient';
  await setupUser(A, '0771000601');
  const depBefore = userDoc(A).totalDeposited || 0;
  const balBefore = userDoc(A).walletBalance;
  let r = await ownerCall('/admin/deposit', { userId: A, amount: 90000, note: 'Compensation for declined MarzPay payment' });
  check('admin credit succeeds', r.body?.status === 'success', r.body);
  check('walletBalance credited', userDoc(A).walletBalance === balBefore + 90000, userDoc(A).walletBalance);
  check('totalDeposited now counts the admin credit exactly like a real deposit', userDoc(A).totalDeposited === depBefore + 90000, userDoc(A).totalDeposited);

  console.log('\n== A staff (non-owner) admin still cannot touch this endpoint at all ==');
  await ownerCall('/admin/admins/create', { username: 'creditstaff', password: 'whatever-123' });
  const loginR = await call('POST', '/admin/login', { body: { username: 'creditstaff', password: 'whatever-123' } });
  const staffToken = loginR.body?.token;
  const depBeforeStaffAttempt = userDoc(A).totalDeposited;
  r = await call('POST', '/admin/deposit', { token: staffToken, body: { userId: A, amount: 500000, note: 'staff trying to credit' } });
  check('staff (non-owner) admin session rejected from /admin/deposit', r.code === 401, r.body);
  check('totalDeposited untouched by the rejected staff attempt', userDoc(A).totalDeposited === depBeforeStaffAttempt, userDoc(A).totalDeposited);

  console.log('\n== That increase is visible to the REFERRER\'s l1TeamDeposits total ==');
  const REF = 'the-referrer';
  await setupUser(REF, '0771000602');
  const refCode = userDoc(REF).referralCode;
  const B = 'referred-member-b';
  await setupUser(B, '0771000603', refCode);
  check('B is genuinely referred by REF', userDoc(B).referredBy === REF, userDoc(B));

  r = await call('GET', '/team/stats', { token: 'uid:' + REF });
  const depositMilestoneBefore = r.body.milestones.find(m => m.type === 'deposit' && m.target === 90000);
  check('before any credit, the 90,000 deposit milestone is not yet achieved', depositMilestoneBefore && !depositMilestoneBefore.achieved, depositMilestoneBefore);

  await ownerCall('/admin/deposit', { userId: B, amount: 90000, note: 'Compensation for declined MarzPay payment' });
  r = await call('GET', '/team/stats', { token: 'uid:' + REF });
  check('l1DepositTotal now reflects the admin-credited amount', r.body.l1DepositTotal === 90000, r.body.l1DepositTotal);
  const depositMilestoneAfter = r.body.milestones.find(m => m.type === 'deposit' && m.target === 90000);
  check('the 90,000 deposit milestone is now achieved because of the admin credit', depositMilestoneAfter && depositMilestoneAfter.achieved, depositMilestoneAfter);

  console.log('\n== The referrer can actually claim the milestone the admin credit unlocked ==');
  const refBalBefore = userDoc(REF).walletBalance;
  r = await call('POST', '/team/milestone/claim', { token: 'uid:' + REF, body: { target: 90000, type: 'deposit' } });
  check('claim succeeds', r.body?.status === 'success', r.body);
  check('referrer actually paid the milestone reward (2,000)', userDoc(REF).walletBalance === refBalBefore + 2000, userDoc(REF).walletBalance);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
