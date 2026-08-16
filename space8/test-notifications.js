/* SPACE8 MEMBER NOTIFICATIONS
   Codex added GET /notifications, POST /notifications/read and owner
   POST /admin/notifications/create, plus notification creation on
   check-in/plan-activation/withdrawal-request (see AGENT_LOG.md). Verified
   against the real server.js rather than taken on faith, and two real bugs
   were found and fixed here:

     1. POST /admin/notifications/create (pushes a message to EVERY member)
        was gated by verifyAdmin -- reachable by any staff login -- despite
        its own commit message calling it "owner-only", and despite the
        equivalent existing broadcast mechanism (/admin/settings/update's
        annEnabled/annTitle/annBody) already being verifyOwner-gated. Fixed
        to verifyOwner so a staff account can no longer message every user.

     2. POST /notifications/read only ever wrote a single readAt field,
        checked against `doc.userId === caller`. A broadcast doc (audience:
        'all') has no userId, so that check silently failed for every
        member on every broadcast -- broadcasts could never be marked read
        by ANYONE, staying permanently unread in every user's bell. Fixed
        with a per-member readBy array (FieldValue.arrayUnion) for
        broadcasts, read back as this member's own unread state in
        GET /notifications, while member-specific notifications keep the
        original single readAt field (only one user could ever read those).

   This test proves: member notifications are correctly scoped per-user
   (never visible to nor markable-read by another user), the 3 real
   creation triggers (check-in/invest/withdraw) actually produce a visible
   notification, broadcasts are visible to every member and independently
   markable-read per member, and the owner-only gate on creating one.

   Run: node test-notifications.js   (exits 0 = all green)                */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '4157';

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
  if (u.includes('wearemarz.com') && u.endsWith('/send-money'))
    return json({ status: 'success', data: { transaction: { uuid: 'WTX-' + (++marzN), status: 'pending' } } });
  return realFetch(url, opts);
};

require('./server.js');

const BASE = 'http://127.0.0.1:4157';
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
const users = () => collMap('users');

async function registerFresh(uid, phone) {
  await call('POST', '/account/create-profile', { token: 'uid:' + uid, body: { phone } });
  return call('POST', '/register', { token: 'uid:' + uid, body: {} });
}
function cleanPhoneLocal(raw) {
  const s = String(raw || '').replace(/\D/g, '');
  let local9 = null;
  if (s.startsWith('256') && s.length === 12) local9 = s.slice(3);
  else if (s.startsWith('0') && s.length === 10) local9 = s.slice(1);
  else if (s.length === 9) local9 = s;
  return local9 ? '+256' + local9 : raw;
}

(async () => {
  await sleep(600);

  console.log('\n== Routing/auth ==');
  let r = await call('GET', '/notifications');
  check('no auth -> 401', r.code === 401, r.body);

  console.log('\n== Two members, each gets their own check-in notification ==');
  await registerFresh('nt-user-a', '0771950001');
  await registerFresh('nt-user-b', '0771950002');
  users().get('nt-user-a').walletBalance = 0;
  users().get('nt-user-b').walletBalance = 0;

  r = await call('POST', '/checkin', { token: 'uid:nt-user-a' });
  check('user A check-in succeeds', r.body?.status === 'success', r.body);

  r = await call('GET', '/notifications', { token: 'uid:nt-user-a' });
  const aNotifs = r.body?.notifications || [];
  check('user A sees a check-in notification', aNotifs.some(n => n.type === 'checkin'), aNotifs);
  check('user A\'s check-in notification starts unread', aNotifs.find(n => n.type === 'checkin')?.readAt === null, aNotifs);

  r = await call('GET', '/notifications', { token: 'uid:nt-user-b' });
  const bNotifs = r.body?.notifications || [];
  check('user B does NOT see user A\'s check-in notification (scoped per-user)', !bNotifs.some(n => n.type === 'checkin'), bNotifs);

  console.log('\n== A member cannot mark another member\'s notification read ==');
  const aCheckinId = aNotifs.find(n => n.type === 'checkin').id;
  r = await call('POST', '/notifications/read', { token: 'uid:nt-user-b', body: { ids: [aCheckinId] } });
  check('user B\'s read call for user A\'s id returns success (silently no-ops)', r.body?.status === 'success', r.body);
  r = await call('GET', '/notifications', { token: 'uid:nt-user-a' });
  check('user A\'s notification is STILL unread after user B tried to mark it read', r.body.notifications.find(n => n.id === aCheckinId)?.readAt === null, r.body.notifications);

  console.log('\n== A member CAN mark their own notification read ==');
  r = await call('POST', '/notifications/read', { token: 'uid:nt-user-a', body: { ids: [aCheckinId] } });
  check('user A\'s own read call succeeds', r.body?.status === 'success', r.body);
  r = await call('GET', '/notifications', { token: 'uid:nt-user-a' });
  check('user A\'s notification is now read', !!r.body.notifications.find(n => n.id === aCheckinId)?.readAt, r.body.notifications);

  console.log('\n== Plan activation and withdrawal requests also notify ==');
  users().get('nt-user-a').walletBalance = 5000000;
  r = await call('GET', '/public/products');
  const tierKey = (r.body?.products || [])[0]?.key;
  check('a product tier is available to invest in', !!tierKey, r.body);
  if (tierKey) {
    r = await call('POST', '/invest/create', { token: 'uid:nt-user-a', body: { tierKey } });
    check('invest/create succeeds', r.body?.status === 'success', r.body);
  }
  collMap('bankAccounts').set('fx-nt-user-a', { userId: 'nt-user-a', holder: 'Tester', network: 'MTN Mobile Money', phone: cleanPhoneLocal('0771950001'), createdAt: new Date() });
  r = await call('POST', '/withdraw/request', { token: 'uid:nt-user-a', body: { amount: 20000, holder: 'Tester', network: 'MTN Mobile Money', phone: '0771950001', pin: '1234' } });
  check('withdraw/request succeeds', r.body?.status === 'success', r.body);

  await sleep(150); // notification creation is fire-and-forget (.catch), give it a tick
  r = await call('GET', '/notifications', { token: 'uid:nt-user-a' });
  const types = (r.body?.notifications || []).map(n => n.type);
  check('investment notification created', types.includes('investment'), types);
  check('withdrawal notification created', types.includes('withdrawal'), types);

  console.log('\n== Broadcasts: owner-only to create, visible to everyone, independently read per member ==');
  await ownerCall('/admin/admins/create', { username: 'ntstaff', password: 'whatever-123' });
  const staffLogin = await call('POST', '/admin/login', { body: { username: 'ntstaff', password: 'whatever-123' } });
  const staffToken = staffLogin.body?.token;
  check('staff login succeeds', !!staffToken, staffLogin.body);

  r = await call('POST', '/admin/notifications/create', { token: staffToken, body: { title: 'Should be blocked', body: 'Staff must not be able to send this.' } });
  check('staff CANNOT create a broadcast (owner-only)', r.code === 401, r.body);

  r = await ownerCall('/admin/notifications/create', { title: 'Scheduled maintenance', body: 'Space8 will be briefly unavailable tonight.' });
  check('owner CAN create a broadcast', r.body?.status === 'success', r.body);

  r = await call('GET', '/notifications', { token: 'uid:nt-user-a' });
  let aBroadcast = (r.body?.notifications || []).find(n => n.type === 'announcement');
  check('user A sees the broadcast', !!aBroadcast, r.body?.notifications);
  check('broadcast starts unread for user A', aBroadcast?.readAt === null, aBroadcast);

  r = await call('GET', '/notifications', { token: 'uid:nt-user-b' });
  let bBroadcast = (r.body?.notifications || []).find(n => n.type === 'announcement');
  check('user B ALSO sees the same broadcast', !!bBroadcast, r.body?.notifications);
  check('broadcast starts unread for user B too', bBroadcast?.readAt === null, bBroadcast);

  r = await call('POST', '/notifications/read', { token: 'uid:nt-user-a', body: { ids: [aBroadcast.id] } });
  check('user A marks the broadcast read', r.body?.status === 'success', r.body);

  r = await call('GET', '/notifications', { token: 'uid:nt-user-a' });
  aBroadcast = (r.body.notifications || []).find(n => n.id === aBroadcast.id);
  check('broadcast is now read for user A', !!aBroadcast?.readAt, aBroadcast);

  r = await call('GET', '/notifications', { token: 'uid:nt-user-b' });
  bBroadcast = (r.body.notifications || []).find(n => n.id === bBroadcast.id);
  check('broadcast is STILL unread for user B (per-member read state, not shared)', bBroadcast?.readAt === null, bBroadcast);

  console.log('\n== Banned member cannot list notifications ==');
  await registerFresh('nt-user-banned', '0771950003');
  users().get('nt-user-banned').status = 'banned';
  r = await call('GET', '/notifications', { token: 'uid:nt-user-banned' });
  check('banned member -> 403', r.code === 403, r.body);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
