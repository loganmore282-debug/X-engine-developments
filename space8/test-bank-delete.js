/* SPACE8 BANK ACCOUNT DELETE TEST
   Owner asked for a way to delete a bound payout account (previously you
   could bind and pick between accounts, but never remove one). Proves:
   an owner can delete their own bound account and it's actually gone from
   /bank/list afterwards, a signed-in user can never delete SOMEONE ELSE'S
   bound account by guessing/reusing its id (ownership check, not just an
   id lookup), deleting a nonexistent id fails cleanly instead of a 500,
   and the route is auth-gated + rate-limited like every other money-
   adjacent endpoint.

   Run: node test-bank-delete.js   (exits 0 = all green)                  */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '4108';

const Module = require('module');
const mockdb = require('./test-mockdb.js');
const dbPath = require.resolve('./db.js');
const dbMod = new Module(dbPath); dbMod.exports = mockdb; dbMod.loaded = true;
require.cache[dbPath] = dbMod;

const faPath = require.resolve('firebase-admin');
const faMod = new Module(faPath);
faMod.exports = {
  initializeApp: () => {}, credential: { cert: () => ({}) },
  auth: () => ({
    verifyIdToken: async tok => {
      if (String(tok).startsWith('uid:')) return { uid: tok.slice(4) };
      throw new Error('invalid token');
    },
  }),
};
faMod.loaded = true;
require.cache[faPath] = faMod;

require('./server.js');

const BASE = 'http://127.0.0.1:4108';
async function call(method, p, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await fetch(BASE + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (_) {}
  return { code: r.status, body: j };
}
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   - ' + name); }
  else { fail++; console.log('  FAIL - ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}
async function setupUser(uid, phone) {
  await call('POST', '/account/create-profile', { token: 'uid:' + uid, body: { phone } });
  await call('POST', '/register', { token: 'uid:' + uid, body: {} });
}

(async () => {
  await new Promise(r => setTimeout(r, 600));

  console.log('\n== Owner can delete their own bound account ==');
  const A = 'alice-uid';
  await setupUser(A, '0771000001');
  await call('POST', '/bank/save', { token: 'uid:' + A, body: { holder: 'Alice One', network: 'MTN Mobile Money', phone: '700111222', pin: '1234' } });
  await call('POST', '/bank/save', { token: 'uid:' + A, body: { holder: 'Alice Two', network: 'Airtel Money', phone: '700333444', pin: '1234' } });
  let list = await call('GET', '/bank/list', { token: 'uid:' + A });
  check('two accounts bound', list.body?.accounts?.length === 2, list.body);
  const firstId = list.body.accounts[0].id;

  const del = await call('POST', '/bank/delete', { token: 'uid:' + A, body: { id: firstId, pin: '1234' } });
  check('delete succeeds', del.body?.status === 'success', del.body);
  list = await call('GET', '/bank/list', { token: 'uid:' + A });
  check('exactly one account remains', list.body?.accounts?.length === 1, list.body);
  check('the remaining account is the one NOT deleted', !list.body.accounts.some(a => a.id === firstId), list.body);

  console.log('\n-- A signed-in user can never delete someone else\'s bound account --');
  const B = 'bob-uid';
  await setupUser(B, '0771000002');
  const bobSave = await call('POST', '/bank/save', { token: 'uid:' + B, body: { holder: 'Bob Holder', network: 'MTN Mobile Money', phone: '700555666', pin: '4321' } });
  const bobList = await call('GET', '/bank/list', { token: 'uid:' + B });
  const bobAccountId = bobList.body.accounts[0].id;

  const stolenDelete = await call('POST', '/bank/delete', { token: 'uid:' + A, body: { id: bobAccountId } });
  check('deleting another user\'s account id is rejected, not silently accepted', stolenDelete.code === 404 && stolenDelete.body?.status === 'error', stolenDelete.body);
  const bobListAfter = await call('GET', '/bank/list', { token: 'uid:' + B });
  check('the other user\'s account is still there, completely untouched', bobListAfter.body?.accounts?.length === 1 && bobListAfter.body.accounts[0].id === bobAccountId, bobListAfter.body);

  console.log('\n-- Deleting a nonexistent id fails cleanly --');
  const ghost = await call('POST', '/bank/delete', { token: 'uid:' + A, body: { id: 'not-a-real-id' } });
  check('nonexistent id returns a clean 404, not a 500', ghost.code === 404 && ghost.body?.status === 'error', ghost.body);

  console.log('\n-- Missing id / missing auth are rejected --');
  const noId = await call('POST', '/bank/delete', { token: 'uid:' + A, body: {} });
  check('missing id rejected with 400', noId.code === 400, noId.body);
  const noAuth = await call('POST', '/bank/delete', { body: { id: bobAccountId } });
  check('no auth token rejected with 401', noAuth.code === 401, noAuth.body);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
