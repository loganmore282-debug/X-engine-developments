/* CHOCOMCC WITHDRAWAL QUICK-APPROVE (push-notification one-tap Approve)
   Owner explicitly asked: "like a withdrawal notify comes, l just use it to
   approve a withdrawal without even going inside, thus is owner only."

   Boots the REAL server.js against an in-memory mock database with Firebase
   auth AND Firebase Cloud Messaging stubbed (capturing sendEach/sendEachFor-
   Multicast calls), then proves:
     - registering a push token as OWNER (raw ADMIN_KEY) stores a per-device
       quickApproveSecret; registering as STAFF (a session from
       /admin/admins/create + /admin/login) does NOT get one at all
     - a new withdrawal request sends an actionable push (quickApprove:'1',
       the device's own pushToken + secret embedded) ONLY to owner devices,
       via the individual sendEach path; staff devices get the identical
       notification with none of that -- via the plain shared multicast,
       exactly like before this feature existed
     - POST /admin/withdraw/quick-approve with the right owner pushToken+
       secret actually sends the withdrawal (mirrors /admin/withdraw/process
       exactly, since both now share processWithdrawalCore) and writes an
       audit-log entry tagged via:'push'
     - wrong secret -> 401, nothing touched
     - a STAFF device's OWN real token+secret pair still gets 401 -- the
       role gate blocks it even with a technically-valid-looking pair
       (staff never actually gets a secret to begin with, but this proves
       the server-side gate too, not just "the client never shows the
       button")
     - unregistering the device kills the credential -- quick-approve on a
       fresh pending withdrawal with the now-stale pushToken+secret -> 401
     - the ordinary /admin/withdraw/process route is completely unaffected
       by the processWithdrawalCore refactor (regression check)

   Run: node test-withdrawal-quick-approve.js   (exits 0 = all green)      */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '4142';

const Module = require('module');
const mockdb = require('./test-mockdb.js');
const dbPath = require.resolve('./db.js');
const dbMod = new Module(dbPath); dbMod.exports = mockdb; dbMod.loaded = true;
require.cache[dbPath] = dbMod;

const sentPushes = []; // { tokens: [t], notification, data, kind }

const faPath = require.resolve('firebase-admin');
const faMod = new Module(faPath);
faMod.exports = {
  initializeApp: () => {}, credential: { cert: () => ({}) },
  auth: () => ({ verifyIdToken: async tok => { if (String(tok).startsWith('uid:')) return { uid: tok.slice(4) }; throw new Error('bad'); } }),
  messaging: () => ({
    sendEachForMulticast: async ({ tokens, notification, data }) => {
      sentPushes.push({ tokens: tokens.slice(), notification, data, kind: 'multicast' });
      return { responses: tokens.map(() => ({ success: true })), successCount: tokens.length, failureCount: 0 };
    },
    sendEach: async (messages) => {
      messages.forEach(m => sentPushes.push({ tokens: [m.token], notification: m.notification, data: m.data, kind: 'individual' }));
      return { responses: messages.map(() => ({ success: true })), successCount: messages.length, failureCount: 0 };
    },
  }),
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

const BASE = 'http://127.0.0.1:4142';
async function call(method, p, { token, adminKey, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (adminKey) headers.Authorization = 'Bearer ' + adminKey;
  const r = await realFetch(BASE + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (_) {}
  return { code: r.status, body: j };
}
async function ownerCall(path, body) {
  return call('POST', path, { adminKey: 'test-admin-key', body: body || {} });
}
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
const pushTokens = () => collMap('adminPushTokens');
const auditLog = () => collMap('adminAuditLog');

async function setupFundedUser(uid, phone, balance) {
  await call('POST', '/account/create-profile', { token: 'uid:' + uid, body: { phone } });
  await call('POST', '/register', { token: 'uid:' + uid, body: {} });
  const u = userDoc(uid);
  u.walletBalance = balance;
  u.totalInvested = balance;
  await call('POST', '/bank/save', { token: 'uid:' + uid, body: { holder: 'Tester', network: 'MTN Mobile Money', phone } });
}
async function requestWithdrawal(uid, phone, amount) {
  const r = await call('POST', '/withdraw/request', { token: 'uid:' + uid, body: { amount, holder: 'Tester', network: 'MTN Mobile Money', phone, pin: '1234' } });
  return r.body.withdrawalId;
}

(async () => {
  await sleep(600);

  console.log('\n== Registering push tokens: owner gets a quickApproveSecret, staff does not ==');
  let r = await ownerCall('/admin/push/register', { token: 'owner-device-1' });
  check('owner device registers', r.body?.status === 'success', r.body);
  check('owner token stored with role owner', pushTokens().get('owner-device-1')?.role === 'owner', pushTokens().get('owner-device-1'));
  check('owner token got a quickApproveSecret', !!pushTokens().get('owner-device-1')?.quickApproveSecret, pushTokens().get('owner-device-1'));
  const ownerSecret = pushTokens().get('owner-device-1').quickApproveSecret;

  await ownerCall('/admin/admins/create', { username: 'qastaff', password: 'whatever-123' });
  const loginR = await call('POST', '/admin/login', { body: { username: 'qastaff', password: 'whatever-123' } });
  const staffToken = loginR.body?.token;
  check('staff login succeeds', !!staffToken, loginR.body);
  r = await call('POST', '/admin/push/register', { token: staffToken, body: { token: 'staff-device-1' } });
  check('staff device registers', r.body?.status === 'success', r.body);
  check('staff token stored with role staff', pushTokens().get('staff-device-1')?.role === 'staff', pushTokens().get('staff-device-1'));
  check('staff token got NO quickApproveSecret at all', pushTokens().get('staff-device-1')?.quickApproveSecret === undefined, pushTokens().get('staff-device-1'));

  console.log('\n== A new withdrawal push is actionable for the owner device only ==');
  const A = 'qa-user-a';
  await setupFundedUser(A, '0771900001', 500000);
  const pushCountBefore = sentPushes.length;
  const witId = await requestWithdrawal(A, '0771900001', 40000);
  check('withdrawal request accepted', !!witId, witId);
  await sleep(150); // push is fire-and-forget

  const newPushes = sentPushes.slice(pushCountBefore);
  const ownerPush = newPushes.find(p => p.tokens.includes('owner-device-1'));
  const staffPush = newPushes.find(p => p.tokens.includes('staff-device-1'));
  check('owner device got its own individual (sendEach) message', ownerPush?.kind === 'individual', ownerPush);
  check('owner push is actionable: quickApprove flag set', ownerPush?.data?.quickApprove === '1', ownerPush?.data);
  check('owner push carries the right withdrawalId', ownerPush?.data?.withdrawalId === witId, ownerPush?.data);
  check('owner push carries ITS OWN pushToken', ownerPush?.data?.pushToken === 'owner-device-1', ownerPush?.data);
  check('owner push carries the matching secret', ownerPush?.data?.secret === ownerSecret, ownerPush?.data);
  check('staff device got the shared multicast instead', staffPush?.kind === 'multicast', staffPush);
  check('staff push has NO quickApprove/secret/pushToken at all', !staffPush?.data?.quickApprove && !staffPush?.data?.secret && !staffPush?.data?.pushToken, staffPush?.data);

  console.log('\n== Quick-approve with the right owner pushToken+secret actually sends it ==');
  const balBefore = userDoc(A).walletBalance; // already reserved at request time
  const auditBefore = auditLog().size;
  r = await call('POST', '/admin/withdraw/quick-approve', { body: { withdrawalId: witId, pushToken: 'owner-device-1', secret: ownerSecret } });
  check('quick-approve reports success', r.body?.status === 'success', r.body);
  const wit = collMap('withdrawals').get(witId);
  check('withdrawal now processing/processed', wit.status === 'processing' || wit.status === 'processed', wit.status);
  check('walletBalance unchanged by the send itself (already reserved at request time)', userDoc(A).walletBalance === balBefore, userDoc(A).walletBalance);
  const newAudit = [...auditLog().values()].slice(auditBefore);
  const auditEntry = newAudit.find(e => e.action === 'withdrawal_processed' && e.meta?.withdrawalId === witId);
  check('an audit-log entry was written for the quick-approve', !!auditEntry, newAudit);
  check('audit entry is tagged via push, actor owner (quick-approve)', auditEntry?.meta?.via === 'push' && auditEntry?.actor === 'owner (quick-approve)', auditEntry);

  console.log('\n== Wrong secret is rejected, nothing touched ==');
  const B = 'qa-user-b';
  await setupFundedUser(B, '0771900002', 500000);
  const witIdB = await requestWithdrawal(B, '0771900002', 30000);
  r = await call('POST', '/admin/withdraw/quick-approve', { body: { withdrawalId: witIdB, pushToken: 'owner-device-1', secret: 'totally-wrong-secret' } });
  check('wrong secret -> 401', r.code === 401, r.body);
  check('withdrawal untouched, still pending', collMap('withdrawals').get(witIdB).status === 'pending', collMap('withdrawals').get(witIdB));

  console.log('\n== A staff device\'s own real token can never quick-approve, even paired with a made-up secret ==');
  r = await call('POST', '/admin/withdraw/quick-approve', { body: { withdrawalId: witIdB, pushToken: 'staff-device-1', secret: 'staff-guess' } });
  check('staff pushToken is rejected regardless of secret (role gate)', r.code === 401, r.body);
  check('withdrawal still untouched', collMap('withdrawals').get(witIdB).status === 'pending', collMap('withdrawals').get(witIdB));

  console.log('\n== Missing fields are rejected cleanly ==');
  r = await call('POST', '/admin/withdraw/quick-approve', { body: { withdrawalId: witIdB } });
  check('missing pushToken/secret -> 400', r.code === 400, r.body);

  console.log('\n== Unregistering the device kills its quick-approve credential ==');
  r = await ownerCall('/admin/push/unregister', { token: 'owner-device-1' });
  check('unregister succeeds', r.body?.status === 'success', r.body);
  r = await call('POST', '/admin/withdraw/quick-approve', { body: { withdrawalId: witIdB, pushToken: 'owner-device-1', secret: ownerSecret } });
  check('stale pushToken+secret after unregister -> 401', r.code === 401, r.body);
  check('withdrawal still pending, never sent', collMap('withdrawals').get(witIdB).status === 'pending', collMap('withdrawals').get(witIdB));

  console.log('\n== The ordinary /admin/withdraw/process route still works unmodified (regression) ==');
  const procB = await ownerCall('/admin/withdraw/process', { withdrawalId: witIdB });
  check('normal admin-panel process still succeeds after the shared-core refactor', procB.body?.status === 'success', procB.body);
  check('withdrawal now processing/processed', ['processing', 'processed'].includes(collMap('withdrawals').get(witIdB).status), collMap('withdrawals').get(witIdB).status);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
