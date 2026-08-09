/* CHOCOMCC ADMIN PUSH NOTIFICATIONS TEST
   Boots the REAL server.js against an in-memory mock database
   (test-mockdb.js) with Firebase auth AND Firebase Cloud Messaging stubbed,
   then proves: any verified admin (not owner-only) can register/unregister
   a push token, a regular (non-admin) user cannot, a new withdrawal request
   fans a push out to every registered token, a REPEATED/idempotent deposit
   credit never fires a duplicate push, and a token Firebase reports as
   dead/unregistered gets pruned automatically.

   Run: node test-push-notifications.js   (exits 0 = all green)            */

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

const sentPushes = []; // { tokens, notification, data }
let deadTokenToReport = null; // if set, sendEachForMulticast reports this token as dead

const faPath = require.resolve('firebase-admin');
const faMod = new Module(faPath);
faMod.exports = {
  initializeApp: () => {},
  credential: { cert: () => ({}) },
  auth: () => ({
    verifyIdToken: async tok => {
      if (String(tok).startsWith('uid:')) return { uid: tok.slice(4) };
      throw new Error('invalid token');
    },
  }),
  messaging: () => ({
    sendEachForMulticast: async ({ tokens, notification, data }) => {
      sentPushes.push({ tokens: tokens.slice(), notification, data });
      const responses = tokens.map(t => {
        if (t === deadTokenToReport) return { success: false, error: { code: 'messaging/registration-token-not-registered' } };
        return { success: true };
      });
      return { responses, successCount: responses.filter(r => r.success).length, failureCount: responses.filter(r => !r.success).length };
    },
    // Owner devices get a withdrawal push through sendEach (one message per
    // device, since each carries that device's OWN quick-approve secret) --
    // see sendWithdrawalPush in server.js. Recorded the same way as
    // sendEachForMulticast above so the existing assertions below (which
    // only care about .tokens/.notification) keep working unmodified.
    sendEach: async (messages) => {
      messages.forEach(m => sentPushes.push({ tokens: [m.token], notification: m.notification, data: m.data }));
      const responses = messages.map(m => {
        if (m.token === deadTokenToReport) return { success: false, error: { code: 'messaging/registration-token-not-registered' } };
        return { success: true };
      });
      return { responses, successCount: responses.filter(r => r.success).length, failureCount: responses.filter(r => !r.success).length };
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
  // /deposit/callback now REQUIRES an independent live re-check against
  // MarzPay before crediting anything (a webhook's own claimed status is
  // never trusted alone — see server.js's security fix). Stub the
  // collect-money status-check endpoint so a webhook carrying a real
  // captured uuid can actually verify, matching test-deposit-concurrency.js.
  if (u.includes('wearemarz.com') && u.includes('/collect-money/')) {
    return json({ status: 'success', data: { transaction: { status: 'successful' } } });
  }
  return realFetch(url, opts);
};

require('./server.js');

const BASE = 'http://127.0.0.1:4002';
async function call(method, p, { token, adminKey, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (adminKey) headers.Authorization = 'Bearer ' + adminKey;
  const r = await realFetch(BASE + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (_) {}
  return { code: r.status, body: j };
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

(async () => {
  await sleep(600);

  console.log('\n-- Registration requires a real admin, not a regular user --');
  let r = await call('POST', '/admin/push/register', { body: { token: 'device-A' } });
  check('no credentials -> 401', r.code === 401, r.code);
  r = await call('POST', '/admin/push/register', { token: 'uid:some-regular-user', body: { token: 'device-B' } });
  check('a regular authenticated user (not admin) -> 401', r.code === 401, r.code);
  r = await call('POST', '/admin/push/register', { adminKey: 'test-admin-key', body: { token: 'device-owner-1' } });
  check('owner master key can register a device', r.body?.status === 'success', r.body);
  check('token actually stored', pushTokens().has('device-owner-1'), [...pushTokens().keys()]);

  console.log('\n-- Unregister removes the token --');
  r = await call('POST', '/admin/push/register', { adminKey: 'test-admin-key', body: { token: 'device-owner-2' } });
  check('register a second device', r.body?.status === 'success', r.body);
  r = await call('POST', '/admin/push/unregister', { adminKey: 'test-admin-key', body: { token: 'device-owner-2' } });
  check('unregister succeeds', r.body?.status === 'success', r.body);
  check('token actually removed', !pushTokens().has('device-owner-2'), [...pushTokens().keys()]);

  console.log('\n-- A new withdrawal request fans a push out to every registered device --');
  const A = 'alice-uid';
  await call('POST', '/account/create-profile', { token: 'uid:' + A, body: { phone: '0771000001' } });
  await call('POST', '/register', { token: 'uid:' + A, body: {} });
  userDoc(A).walletBalance = 1000000;
  userDoc(A).totalInvested = 1000000; // requireInvestToWithdraw (default true) gates on this
  await call('POST', '/bank/save', { token: 'uid:' + A, body: { holder: 'Alice', network: 'MTN Mobile Money', phone: '700111222' } });

  const pushCountBefore = sentPushes.length;
  r = await call('POST', '/withdraw/request', { token: 'uid:' + A, body: { amount: 20000, holder: 'Alice', network: 'MTN Mobile Money', phone: '700111222' } });
  check('withdrawal succeeds', r.body?.status === 'success', r.body);
  await sleep(100); // sendAdminPush is fire-and-forget
  check('exactly one new push was sent', sentPushes.length === pushCountBefore + 1, sentPushes.length);
  const wPush = sentPushes[sentPushes.length - 1];
  check('push went to the currently-registered token (device-owner-1)', wPush.tokens.includes('device-owner-1'), wPush.tokens);
  check('push title mentions a withdrawal', /withdrawal/i.test(wPush.notification.title), wPush.notification);

  console.log('\n-- A deposit crediting fires exactly one push, never a duplicate on replay --');
  collMap('pendingDeposits').set('dep-1', {
    userId: A, phone: '+256700111222', network: 'MTN Mobile Money', amount: 50000,
    ref: 'B999', marzReference: 'MZ-REF-1', marzTxUuid: 'DTX-dep-1', status: 'initiating',
  });
  const depBalBefore = userDoc(A).walletBalance;
  const pushCountBeforeDep = sentPushes.length;
  const webhookBody = { data: { reference: 'MZ-REF-1', transaction: { uuid: 'DTX-dep-1', status: 'completed' } } };
  r = await call('POST', '/deposit/callback', { body: webhookBody });
  await sleep(200); // callback responds immediately, credits asynchronously
  check('deposit credited exactly once', userDoc(A).walletBalance === depBalBefore + 50000, userDoc(A).walletBalance);
  check('exactly one push fired for the new deposit', sentPushes.length === pushCountBeforeDep + 1, sentPushes.length - pushCountBeforeDep);
  const dPush = sentPushes[sentPushes.length - 1];
  check('deposit push title mentions a deposit', /deposit/i.test(dPush.notification.title), dPush.notification);

  // Replay the SAME webhook (as MarzPay sometimes does) — must NOT double-credit or double-push.
  r = await call('POST', '/deposit/callback', { body: webhookBody });
  await sleep(200);
  check('replayed webhook does not double-credit', userDoc(A).walletBalance === depBalBefore + 50000, userDoc(A).walletBalance);
  check('replayed webhook does not fire a second push', sentPushes.length === pushCountBeforeDep + 1, sentPushes.length - pushCountBeforeDep);

  console.log('\n-- A token Firebase reports as dead/unregistered is pruned automatically --');
  await call('POST', '/admin/push/register', { adminKey: 'test-admin-key', body: { token: 'device-dead-1' } });
  deadTokenToReport = 'device-dead-1';
  check('dead token is registered before the next push', pushTokens().has('device-dead-1'));
  r = await call('POST', '/withdraw/request', { token: 'uid:' + A, body: { amount: 20000, holder: 'Alice', network: 'MTN Mobile Money', phone: '700111222' } });
  await sleep(150);
  check('withdrawal that triggers the push still succeeds', r.body?.status === 'success', r.body);
  check('the dead token was pruned from adminPushTokens', !pushTokens().has('device-dead-1'), [...pushTokens().keys()]);
  check('the still-good token (device-owner-1) was NOT pruned', pushTokens().has('device-owner-1'), [...pushTokens().keys()]);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
