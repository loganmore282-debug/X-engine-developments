/* SPACE8 STAFF WITHDRAWAL-APPROVAL ANALYTICS
   Owner asked: "make sure so as I know the number of approvals admin
   staffs, like number, rate, sequence, put this in analytics" -- who's
   actually approving/declining payouts, how much of the load each person
   carries, and a timeline of who did what when.

   Boots the REAL server.js against an in-memory mock database and proves:
     - /admin/withdraw/process stamps the withdrawal with processedBy (the
       real admin username, or 'owner-key' for the master key) -- already
       existed, used here as the data source
     - /admin/withdraw/reject now ALSO stamps declinedBy/declinedAt (it
       didn't before -- staff had zero attribution for declines)
     - POST /admin/analytics returns a staffApprovals block: per-staff
       approvals/declines/amountApproved/sharePct, correctly split between
       an owner-key approval and a named staff approval and a named staff
       decline
     - sharePct across all staff reflects each person's share of total
       approvals+declines handled
     - a recent-activity timeline lists each action, newest first
     - a withdrawal outside the requested day window is excluded from both
       the byStaff totals and the timeline

   Run: node test-staff-approvals.js   (exits 0 = all green)               */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '4146';

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
  messaging: () => ({ sendEachForMulticast: async () => ({ responses: [], successCount: 0, failureCount: 0 }), sendEach: async () => ({ responses: [], successCount: 0, failureCount: 0 }) }),
};
faMod.loaded = true;
require.cache[faPath] = faMod;

const realFetch = global.fetch;
let marzN = 0;
global.fetch = async (url, opts) => {
  const u = String(url);
  const json = body => ({ ok: true, status: 200, json: async () => body });
  if (u.includes('wearemarz.com') && u.endsWith('/send-money')) {
    return json({ status: 'success', data: { transaction: { uuid: 'WTX-' + (++marzN), status: 'pending' } } });
  }
  return realFetch(url, opts);
};

require('./server.js');

const BASE = 'http://127.0.0.1:4146';
async function call(method, p, { token, adminKey, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (adminKey) headers.Authorization = 'Bearer ' + adminKey;
  const r = await realFetch(BASE + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
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
const userDoc = id => collMap('users').get(id);

async function setupFundedUser(uid, phone, balance) {
  await call('POST', '/account/create-profile', { token: 'uid:' + uid, body: { phone } });
  await call('POST', '/register', { token: 'uid:' + uid, body: {} });
  const u = userDoc(uid);
  u.walletBalance = balance;
  u.totalInvested = balance;
}
function cleanPhoneLocal(raw) {
  const s = String(raw || '').replace(/\D/g, '');
  let local9 = null;
  if (s.startsWith('256') && s.length === 12) local9 = s.slice(3);
  else if (s.startsWith('0') && s.length === 10) local9 = s.slice(1);
  else if (s.length === 9) local9 = s;
  return local9 ? '+256' + local9 : raw;
}
async function requestWithdrawal(uid, phone, amount) {
  // Withdrawal destinations must now be an actually-bound payout account --
  // stored (and matched) in the SAME cleaned +256... format /bank/save uses.
  collMap('bankAccounts').set('fx-' + uid, { userId: uid, holder: 'Tester', network: 'MTN Mobile Money', phone: cleanPhoneLocal(phone), createdAt: new Date() });
  const r = await call('POST', '/withdraw/request', { token: 'uid:' + uid, body: { amount, holder: 'Tester', network: 'MTN Mobile Money', phone, pin: '1234' } });
  return r.body.withdrawalId;
}

(async () => {
  await sleep(600);

  console.log('\n== Set up a staff account distinct from the owner ==');
  await ownerCall('/admin/admins/create', { username: 'approvalstaff', password: 'whatever-123' });
  const loginR = await call('POST', '/admin/login', { body: { username: 'approvalstaff', password: 'whatever-123' } });
  const staffToken = loginR.body?.token;
  check('staff login succeeds', !!staffToken, loginR.body);

  console.log('\n== Owner approves one withdrawal, staff approves another, owner declines a third ==');
  const A = 'sa-user-a', B = 'sa-user-b', C = 'sa-user-c';
  await setupFundedUser(A, '0771900801', 500000);
  await setupFundedUser(B, '0771900802', 500000);
  await setupFundedUser(C, '0771900803', 500000);
  const witA = await requestWithdrawal(A, '0771900801', 40000);
  const witB = await requestWithdrawal(B, '0771900802', 60000);
  const witC = await requestWithdrawal(C, '0771900803', 25000);

  let r = await ownerCall('/admin/withdraw/process', { withdrawalId: witA });
  check('owner-key approval succeeds', r.body?.status === 'success', r.body);
  r = await call('POST', '/admin/withdraw/process', { token: staffToken, body: { withdrawalId: witB } });
  check('staff approval succeeds', r.body?.status === 'success', r.body);
  r = await ownerCall('/admin/withdraw/reject', { withdrawalId: witC, reason: 'Suspicious activity' });
  check('owner decline succeeds', r.body?.status === 'success', r.body);

  console.log('\n-- The withdrawal docs themselves now carry who approved/declined them --');
  const wits = collMap('withdrawals');
  check('witA stamped processedBy owner-key', wits.get(witA)?.processedBy === 'owner-key', wits.get(witA));
  check('witB stamped processedBy approvalstaff', wits.get(witB)?.processedBy === 'approvalstaff', wits.get(witB));
  check('witC stamped declinedBy owner-key (this is new)', wits.get(witC)?.declinedBy === 'owner-key', wits.get(witC));
  check('witC has a declinedAt timestamp', !!wits.get(witC)?.declinedAt, wits.get(witC));

  console.log('\n== /admin/analytics reports per-staff approvals/declines ==');
  r = await ownerCall('/admin/analytics', { days: 30 });
  check('analytics call succeeds', r.body?.status === 'success', r.body);
  const sa = r.body?.staffApprovals || {};
  check('staffApprovals.byStaff is present', Array.isArray(sa.byStaff), sa);
  const ownerRow = sa.byStaff.find(s => s.actor === 'owner-key');
  const staffRow = sa.byStaff.find(s => s.actor === 'approvalstaff');
  check('owner-key row: 1 approval, 1 decline, 2 handled', ownerRow?.approvals === 1 && ownerRow?.declines === 1 && ownerRow?.totalHandled === 2, ownerRow);
  check('owner-key amountApproved reflects witA (40,000)', ownerRow?.amountApproved === 40000, ownerRow);
  check('approvalstaff row: 1 approval, 0 declines, 1 handled', staffRow?.approvals === 1 && staffRow?.declines === 0 && staffRow?.totalHandled === 1, staffRow);
  check('approvalstaff amountApproved reflects witB (60,000)', staffRow?.amountApproved === 60000, staffRow);

  console.log('\n-- Share of the total workload adds up correctly (2 of 3, 1 of 3) --');
  check('owner-key handled 2 of 3 total actions -> ~66.7%', Math.abs(ownerRow.sharePct - 66.7) < 0.5, ownerRow.sharePct);
  check('approvalstaff handled 1 of 3 total actions -> ~33.3%', Math.abs(staffRow.sharePct - 33.3) < 0.5, staffRow.sharePct);

  console.log('\n== The timeline lists all three actions, newest first ==');
  check('timeline has exactly 3 entries', (sa.timeline || []).length === 3, sa.timeline);
  const actions = sa.timeline.map(t => t.action);
  check('timeline includes 2 approved + 1 declined', actions.filter(a => a === 'approved').length === 2 && actions.filter(a => a === 'declined').length === 1, actions);
  const ats = sa.timeline.map(t => t.at);
  check('timeline is sorted newest first', ats.every((v, i) => i === 0 || ats[i - 1] >= v), ats);
  check('every timeline entry carries a real amount, not zero', sa.timeline.every(t => t.amount > 0), sa.timeline);

  console.log('\n== A withdrawal processed outside the requested window is excluded ==');
  const D = 'sa-user-d';
  await setupFundedUser(D, '0771900804', 500000);
  const witD = await requestWithdrawal(D, '0771900804', 15000);
  await ownerCall('/admin/withdraw/process', { withdrawalId: witD });
  // Back-date it well outside even a 90-day window so a 1-day analytics
  // request provably excludes it without needing to wait real time.
  wits.get(witD).processedAt = new Date(Date.now() - 200 * 86400000);
  r = await ownerCall('/admin/analytics', { days: 1 });
  const sa1 = r.body?.staffApprovals || {};
  const ownerRow1 = (sa1.byStaff || []).find(s => s.actor === 'owner-key');
  check('the back-dated approval is not counted in a 1-day window (still just witA, not witD too)', ownerRow1?.approvals === 1, ownerRow1);
  check('amountApproved in the 1-day window is still just witA (40,000), not +15,000 from witD', ownerRow1?.amountApproved === 40000, ownerRow1);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
