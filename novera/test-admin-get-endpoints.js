/* NOVERA ADMIN GET-ENDPOINT SWEEP
   The same bug fixed once already for /admin/stats and /admin/badges
   (app.post-only routes the admin panel calls with no body, which its
   api() helper sends as a plain GET, 404ing against Express and reporting
   as a silent empty result or "Network error") turned out to affect SEVEN
   endpoints, not two — this one was caught because the owner spotted the
   Dashboard showing "5 Total users" while the Users tab showed "Users (0)"
   with "No matching users": /admin/users was POST-only, so the tab's fetch
   404'd and silently fell back to an empty array with no error shown.

   The other six had the identical bug, just not yet reported because
   nobody had happened to click Referrals, Recalculate totals, Integrity
   audit, Sync MarzPay, Gift Codes, or Admins recently: /admin/users,
   /admin/users/recount, /admin/integrity, /admin/payments/sync,
   /admin/promocodes/list, /admin/admins/list, /admin/referrals/list.

   All seven are now app.get() to match the real admin panel's api(path)
   calls (no second argument -> GET). This test hits every one of them
   exactly as the real admin panel does and would have failed (404, not
   JSON) on any of the seven before this fix.

   An eighth mismatch turned up in the same sweep: /admin/products/clear
   (the destructive "delete every product" button) was called as
   api('/admin/products/clear') with no body -> sent as GET, but the server
   route is (correctly, since it deletes data) app.post-only. Unlike the
   other seven, the fix here is on the CLIENT side — it now passes an empty
   object body so api() sends a real POST, matching the other mutating
   admin actions — rather than weakening the server to accept GET for a
   delete-everything operation. Covered below by calling it exactly as the
   now-fixed client does.

   Run: node test-admin-get-endpoints.js   (exits 0 = all green)          */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '4064';

const Module = require('module');
const mockdb = require('./test-mockdb.js');
const dbPath = require.resolve('./db.js');
const dbMod = new Module(dbPath); dbMod.exports = mockdb; dbMod.loaded = true;
require.cache[dbPath] = dbMod;

const faPath = require.resolve('firebase-admin');
const faMod = new Module(faPath);
faMod.exports = {
  initializeApp: () => {}, credential: { cert: () => ({}) },
  auth: () => ({ verifyIdToken: async () => { throw new Error('not used'); } }),
};
faMod.loaded = true;
require.cache[faPath] = faMod;

require('./server.js');

const realFetch = global.fetch;
const BASE = 'http://127.0.0.1:4064';
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   - ' + name); }
  else { fail++; console.log('  FAIL - ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}
function collMap(name) {
  if (!mockdb.__store.has(name)) mockdb.__store.set(name, new Map());
  return mockdb.__store.get(name);
}

(async () => {
  await new Promise(r => setTimeout(r, 600));
  const adminHeaders = { Authorization: 'Bearer test-admin-key' };

  const users = collMap('users');
  users.set('u1', { phone: '0771000001', walletBalance: 0, totalDeposited: 0, totalEarned: 0, referredBy: null, registrationDone: true, status: 'active' });
  users.set('u2', { phone: '0771000002', walletBalance: 0, totalDeposited: 0, totalEarned: 0, referredBy: 'u1', registrationDone: true, status: 'active' });

  const endpoints = [
    { path: '/admin/users', field: 'users' },
    { path: '/admin/users/recount', field: 'updated' },
    { path: '/admin/integrity', field: 'alerts' },
    { path: '/admin/payments/sync', field: 'settled' },
    { path: '/admin/promocodes/list', field: 'codes' },
    { path: '/admin/admins/list', field: 'admins' },
    { path: '/admin/referrals/list', field: 'referrals' },
  ];

  console.log('\n== Every admin GET-style endpoint, called exactly as the real admin panel does (GET, no body) ==');
  for (const { path, field } of endpoints) {
    const r = await realFetch(BASE + path, { method: 'GET', headers: adminHeaders });
    let body = null; try { body = await r.json(); } catch (e) { /* would throw pre-fix (404 HTML page) */ }
    check(`${path} -> real JSON, not a 404 HTML page`, body !== null, { httpStatus: r.status });
    check(`${path} -> status success`, body?.status === 'success', body);
    check(`${path} -> has expected "${field}" field`, body != null && field in body, body);
  }

  console.log('\n-- All seven still reject an unauthenticated GET --');
  for (const { path } of endpoints) {
    const r = await realFetch(BASE + path, { method: 'GET' });
    check(`${path} -> 401 with no admin auth`, r.status === 401, await r.text());
  }

  console.log('\n== /admin/products/clear, called exactly as the now-fixed admin panel does (POST with an empty {} body) ==');
  let r = await realFetch(BASE + '/admin/products/clear', {
    method: 'POST', headers: { ...adminHeaders, 'Content-Type': 'application/json' }, body: '{}'
  });
  let body = await r.json();
  check('/admin/products/clear -> status success', body?.status === 'success', body);
  check('/admin/products/clear -> has expected "removed" field', body != null && 'removed' in body, body);
  r = await realFetch(BASE + '/admin/products/clear', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  check('/admin/products/clear -> 401 with no admin auth', r.status === 401, await r.text());

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
