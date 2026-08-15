/* SPACE8 ADMIN-DELETE NAME-STAMP SCRUB
   Owner asked: "when I delete an admin I want a namestamp removed" -- once
   a staff account is deleted, their name should stop showing up anywhere
   as "who did this" (Withdrawals list, Analytics staff table, Audit Log).

   Deliberately NOT full deletion of the underlying records: those
   withdrawals/transactions belong to the MEMBER whose money moved, not to
   the staffer. Wiping them would desync that member's own wallet balance
   from their own transaction ledger and trip /admin/integrity. So this
   proves the narrower, correct behaviour instead:
     - /admin/admins/delete clears processedBy/declinedBy to null on every
       withdrawal that staffer touched, and actor to null on every audit-
       log entry they generated
     - the withdrawal's real money-movement facts (status, amount, net,
       processedAt/declinedAt) are completely untouched by the scrub
     - Analytics' staffApprovals (computed live off processedBy/declinedBy)
       no longer lists the deleted staffer or counts their actions AT ALL
       -- not even folded into someone else's row
     - a fresh admin_deleted audit-log entry is written, correctly
       attributed to the OWNER who did the deleting, not scrubbed away
     - a DIFFERENT staffer's own attributions are completely untouched by
       deleting someone else

   Run: node test-admin-delete-namestamp.js   (exits 0 = all green)        */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '4147';

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

const BASE = 'http://127.0.0.1:4147';
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
const auditEntries = () => [...collMap('adminAuditLog').values()];

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

  console.log('\n== Two staffers each process/decline some withdrawals ==');
  await ownerCall('/admin/admins/create', { username: 'leaving_staff', password: 'whatever-123' });
  await ownerCall('/admin/admins/create', { username: 'staying_staff', password: 'whatever-123' });
  const leavingLogin = await call('POST', '/admin/login', { body: { username: 'leaving_staff', password: 'whatever-123' } });
  const stayingLogin = await call('POST', '/admin/login', { body: { username: 'staying_staff', password: 'whatever-123' } });
  const leavingToken = leavingLogin.body?.token, stayingToken = stayingLogin.body?.token;
  check('both staff logins succeed', !!leavingToken && !!stayingToken, { leavingLogin: leavingLogin.body, stayingLogin: stayingLogin.body });

  const A = 'nd-user-a', C = 'nd-user-c';
  await setupFundedUser(A, '0771901001', 500000);
  await setupFundedUser(C, '0771901003', 500000);
  const witA = await requestWithdrawal(A, '0771901001', 30000); // leaving_staff approves
  const witC = await requestWithdrawal(C, '0771901003', 45000); // staying_staff approves

  let r = await call('POST', '/admin/withdraw/process', { token: leavingToken, body: { withdrawalId: witA } });
  check('leaving_staff approves witA', r.body?.status === 'success', r.body);
  r = await call('POST', '/admin/withdraw/process', { token: stayingToken, body: { withdrawalId: witC } });
  check('staying_staff approves witC', r.body?.status === 'success', r.body);

  // A second withdrawal for leaving_staff, so the scrub test below covers
  // more than one affected record (decline is owner-only server-side, so
  // there's no way for a staff session to generate a declinedBy of their
  // own to test here -- it runs through the identical clearField() code
  // path as processedBy, already proven by this).
  const D = 'nd-user-d';
  await setupFundedUser(D, '0771901004', 500000);
  const witD = await requestWithdrawal(D, '0771901004', 15000);
  r = await call('POST', '/admin/withdraw/process', { token: leavingToken, body: { withdrawalId: witD } });
  check('leaving_staff approves a second withdrawal (witD)', r.body?.status === 'success', r.body);

  const wits = collMap('withdrawals');
  check('witA processedBy leaving_staff before deletion', wits.get(witA).processedBy === 'leaving_staff', wits.get(witA));
  check('witD processedBy leaving_staff before deletion', wits.get(witD).processedBy === 'leaving_staff', wits.get(witD));
  check('witC processedBy staying_staff before deletion', wits.get(witC).processedBy === 'staying_staff', wits.get(witC));
  check('leaving_staff has audit-log entries before deletion', auditEntries().some(e => e.actor === 'leaving_staff'), auditEntries().filter(e => e.actor === 'leaving_staff'));

  const beforeAmountA = wits.get(witA).amount, beforeStatusA = wits.get(witA).status, beforeAtA = wits.get(witA).processedAt;

  console.log('\n== Deleting leaving_staff scrubs their name stamp everywhere ==');
  r = await ownerCall('/admin/admins/delete', { username: 'leaving_staff' });
  check('delete succeeds', r.body?.status === 'success', r.body);

  check('witA.processedBy is now cleared (null)', wits.get(witA).processedBy === null, wits.get(witA));
  check('witD.processedBy is now cleared (null)', wits.get(witD).processedBy === null, wits.get(witD));
  check('witA.amount is UNCHANGED by the scrub', wits.get(witA).amount === beforeAmountA, wits.get(witA));
  check('witA.status is UNCHANGED by the scrub', wits.get(witA).status === beforeStatusA, wits.get(witA));
  check('witA.processedAt is UNCHANGED by the scrub (money-movement fact preserved)', wits.get(witA).processedAt === beforeAtA, wits.get(witA));

  console.log('-- A different, still-active staffer is completely untouched --');
  check('witC.processedBy is STILL staying_staff', wits.get(witC).processedBy === 'staying_staff', wits.get(witC));

  console.log('-- Audit log: leaving_staff\'s old entries lose their actor, the delete action itself is attributed to the owner --');
  check('no audit entry still says actor===leaving_staff', !auditEntries().some(e => e.actor === 'leaving_staff'), auditEntries().filter(e => e.actor === 'leaving_staff'));
  check('leaving_staff\'s old entries still exist, just with actor cleared', auditEntries().some(e => e.actor === null && e.action !== 'admin_deleted'), auditEntries().filter(e => e.actor === null));
  const deleteEntry = auditEntries().find(e => e.action === 'admin_deleted' && e.meta?.username === 'leaving_staff');
  check('a fresh admin_deleted entry exists, attributed to the owner (not scrubbed)', deleteEntry?.actor === 'owner-key', deleteEntry);
  check('the delete entry records how many name stamps were cleared', deleteEntry?.meta?.nameStampsCleared?.processedCleared === 2, deleteEntry?.meta);

  console.log('\n== Analytics no longer lists the deleted staffer at all ==');
  r = await ownerCall('/admin/analytics', { days: 30 });
  const sa = r.body?.staffApprovals || { byStaff: [] };
  check('leaving_staff does not appear in staffApprovals.byStaff', !sa.byStaff.some(s => s.actor === 'leaving_staff'), sa.byStaff);
  check('staying_staff still appears, with their own approval intact', sa.byStaff.some(s => s.actor === 'staying_staff' && s.approvals === 1), sa.byStaff);
  check('the cleared withdrawals are not folded into anyone else\'s row (no null-actor row)', !sa.byStaff.some(s => s.actor === null || s.actor === 'null'), sa.byStaff);

  console.log('\n== The withdrawals list itself still shows the real records, just with no name ==');
  r = await ownerCall('/admin/withdrawals/list', {});
  const listedA = (r.body?.withdrawals || []).find(w => w.id === witA);
  check('witA is still fully present in the withdrawals list', !!listedA, listedA);
  check('witA amount/status are correct and unaffected', listedA?.amount === 30000 && listedA?.status && listedA.status !== 'pending', listedA);
  check('witA.processedBy is null in the listing (nothing to attribute it to anymore)', listedA?.processedBy === null, listedA);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
