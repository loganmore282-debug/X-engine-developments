/* SPACE8 -- ADMIN CAN SEE SENT NOTIFICATIONS AND DELETE THEM FOR EVERYONE
   Owner: "make sure l can see sent notification, delete them and gets
   deleted from all accounts."

   A broadcast notification (audience:'all') is a SINGLE shared document --
   every member's GET /notifications queries it fresh, with no per-user
   copy ever made. That means the new /admin/notifications/delete doesn't
   need any per-account cleanup: deleting the one document is both
   necessary and sufficient for it to vanish from every account's bell.

   Boots the REAL server.js against an in-memory mock database and proves,
   over real HTTP:
     - a sent broadcast appears in /admin/notifications/list (title, body,
       who sent it, when, and how many members have read it)
     - it also appears in a real member's own GET /notifications
     - deleting it removes it from BOTH /admin/notifications/list AND
       every member's GET /notifications immediately -- proven against
       TWO separate member accounts, not just one, to actually
       demonstrate "all accounts", not just "the one account tested"
     - deleting an already-deleted / nonexistent id is a clean 404, never
       a silent success
     - only the owner can list or delete (a staff admin session is
       rejected outright on both)
     - readCount reflects real reads: a member marking it read bumps the
       count /admin/notifications/list reports, using the SAME
       /notifications/read endpoint the real app uses (not a
       reimplementation)
     - deleting a notification does not touch any OTHER notification
       still sitting in members' bells

   Run: node test-notifications-management.js   (exits 0 = all green)    */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '4307';

const Module = require('module');
const mockdb = require('./test-mockdb.js');
const dbPath = require.resolve('./db.js');
const dbMod = new Module(dbPath); dbMod.exports = mockdb; dbMod.loaded = true;
require.cache[dbPath] = dbMod;

const faPath = require.resolve('firebase-admin');
const faMod = new Module(faPath);
faMod.exports = {
  initializeApp: () => {}, credential: { cert: () => ({}) },
  auth: () => ({ verifyIdToken: async (tok) => { if (String(tok).startsWith('uid:')) return { uid: tok.slice(4) }; throw new Error('bad'); } }),
};
faMod.loaded = true;
require.cache[faPath] = faMod;

require('./server.js');

const BASE = 'http://127.0.0.1:4307';
async function call(method, p, { token, adminKey, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (adminKey) headers.Authorization = 'Bearer ' + adminKey;
  const r = await fetch(BASE + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (_) {}
  return { code: r.status, body: j };
}
async function ownerCall(path, body) { return call('POST', path, { adminKey: 'test-admin-key', body: body || {} }); }
async function ownerGet(path) { return call('GET', path, { adminKey: 'test-admin-key' }); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   - ' + name); }
  else { fail++; console.log('  FAIL - ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}
async function setupUser(uid, phone) {
  await call('POST', '/account/create-profile', { token: 'uid:' + uid, body: { phone } });
  return call('POST', '/register', { token: 'uid:' + uid, body: {} });
}

(async () => {
  await sleep(600);

  console.log('\n== Sending a notification makes it visible in the admin list and every member\'s bell ==');
  const M1 = 'nm-member1', M2 = 'nm-member2';
  await setupUser(M1, '0771990401');
  await setupUser(M2, '0771990402');

  let r = await ownerCall('/admin/notifications/create', { title: 'Scheduled maintenance', body: 'We will be down for 10 minutes at midnight.' });
  check('broadcast sent', r.body?.status === 'success', r.body);

  r = await ownerGet('/admin/notifications/list');
  check('admin list request succeeded', r.body?.status === 'success', r.body);
  check('the sent notification appears in the admin list', (r.body?.notifications || []).some(n => n.title === 'Scheduled maintenance'), r.body?.notifications);
  const listedNotif = (r.body.notifications || []).find(n => n.title === 'Scheduled maintenance');
  const notifId = listedNotif.id;
  check('admin list reports who sent it', listedNotif.createdBy === 'owner-key' || listedNotif.createdBy === 'owner', listedNotif);
  check('admin list starts readCount at 0 (nobody has opened their bell yet)', listedNotif.readCount === 0, listedNotif);

  r = await call('GET', '/notifications', { token: 'uid:' + M1 });
  check('member 1 sees it in their own bell', (r.body?.notifications || []).some(n => n.id === notifId), r.body?.notifications);
  r = await call('GET', '/notifications', { token: 'uid:' + M2 });
  check('member 2 ALSO sees it (same shared broadcast, not per-account)', (r.body?.notifications || []).some(n => n.id === notifId), r.body?.notifications);

  console.log('\n== readCount tracks real reads through the real /notifications/read endpoint ==');
  await call('POST', '/notifications/read', { token: 'uid:' + M1, body: { ids: [notifId] } });
  r = await ownerGet('/admin/notifications/list');
  const afterRead = (r.body.notifications || []).find(n => n.id === notifId);
  check('readCount is now 1 after member 1 marked it read', afterRead?.readCount === 1, afterRead);

  console.log('\n== Only the owner can list or delete notifications ==');
  await ownerCall('/admin/admins/create', { username: 'nm_staff', password: 'whatever-123' });
  const staffLogin = await call('POST', '/admin/login', { body: { username: 'nm_staff', password: 'whatever-123' } });
  r = await call('GET', '/admin/notifications/list', { token: staffLogin.body?.token });
  check('non-owner staff cannot list', r.code === 401, r.body);
  r = await call('POST', '/admin/notifications/delete', { token: staffLogin.body?.token, body: { id: notifId } });
  check('non-owner staff cannot delete', r.code === 401, r.body);
  check('the notification is untouched by the refused staff attempt (still visible to members)', !!(await call('GET', '/notifications', { token: 'uid:' + M2 })).body.notifications.find(n => n.id === notifId));

  console.log('\n== A second, unrelated broadcast is untouched by anything so far ==');
  r = await ownerCall('/admin/notifications/create', { title: 'Unrelated announcement', body: 'This one should survive everything above.' });
  const unrelatedId = (await ownerGet('/admin/notifications/list')).body.notifications.find(n => n.title === 'Unrelated announcement').id;

  console.log('\n== Deleting the notification removes it from the admin list AND every member\'s bell, immediately ==');
  r = await ownerCall('/admin/notifications/delete', { id: notifId });
  check('delete succeeded', r.body?.status === 'success', r.body);

  r = await ownerGet('/admin/notifications/list');
  check('gone from the admin list', !(r.body.notifications || []).some(n => n.id === notifId), r.body.notifications);
  check('the OTHER notification is still in the admin list, untouched', (r.body.notifications || []).some(n => n.id === unrelatedId), r.body.notifications);

  r = await call('GET', '/notifications', { token: 'uid:' + M1 });
  check('gone from member 1\'s bell', !(r.body.notifications || []).some(n => n.id === notifId), r.body.notifications);
  r = await call('GET', '/notifications', { token: 'uid:' + M2 });
  check('gone from member 2\'s bell too -- proves "all accounts", not just the one tested first', !(r.body.notifications || []).some(n => n.id === notifId), r.body.notifications);
  check('member 2 still sees the unrelated one', (r.body.notifications || []).some(n => n.id === unrelatedId), r.body.notifications);

  console.log('\n== Deleting an already-gone id is a clean 404, never a silent success ==');
  r = await ownerCall('/admin/notifications/delete', { id: notifId });
  check('deleting the same id again returns 404', r.code === 404, r.body);
  r = await ownerCall('/admin/notifications/delete', { id: 'totally-made-up-id' });
  check('deleting a never-existed id also returns 404', r.code === 404, r.body);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
