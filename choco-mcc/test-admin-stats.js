/* CHOCOMCC ADMIN DASHBOARD STATS REGRESSION TEST
   The admin panel's dashboard permanently showed "Could not load stats.
   Network error" — /admin/stats and /admin/badges were registered as
   app.post() only, but the admin client's api() helper calls both with no
   body, which makes it send a plain GET. Express had no GET handler for
   either path, so every real request 404'd with Express's default HTML
   error page; the client's fetch then threw parsing that as JSON, and the
   generic catch block reported it as "Network error" every single time.
   Fixed by registering both as app.get(). This test hits them exactly the
   way the real admin panel does (GET, no body) and would have failed
   before the fix (404, not JSON).

   Run: node test-admin-stats.js   (exits 0 = all green)                   */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '4062';

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
const BASE = 'http://127.0.0.1:4062';
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   - ' + name); }
  else { fail++; console.log('  FAIL - ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}

(async () => {
  await new Promise(r => setTimeout(r, 600));
  const adminHeaders = { Authorization: 'Bearer test-admin-key' };

  console.log('\n== GET /admin/stats (exactly how the real admin panel calls it) ==');
  let r = await realFetch(BASE + '/admin/stats', { method: 'GET', headers: adminHeaders });
  let body = null; try { body = await r.json(); } catch (e) { /* would throw pre-fix */ }
  check('response is real JSON, not a 404 HTML page', body !== null, { httpStatus: r.status });
  check('status success', body?.status === 'success', body);
  check('has userCount field', typeof body?.userCount === 'number', body);
  check('has healthBalance field', typeof body?.healthBalance === 'number', body);

  console.log('\n== GET /admin/badges (exactly how the real admin panel calls it) ==');
  r = await realFetch(BASE + '/admin/badges', { method: 'GET', headers: adminHeaders });
  body = null; try { body = await r.json(); } catch (e) {}
  check('response is real JSON, not a 404 HTML page', body !== null, { httpStatus: r.status });
  check('status success', body?.status === 'success', body);
  check('has pendingWithdrawals field', typeof body?.pendingWithdrawals === 'number', body);

  console.log('\n-- Both still reject an unauthenticated GET --');
  r = await realFetch(BASE + '/admin/stats', { method: 'GET' });
  check('/admin/stats -> 401 with no admin auth', r.status === 401, await r.text());
  r = await realFetch(BASE + '/admin/badges', { method: 'GET' });
  check('/admin/badges -> 401 with no admin auth', r.status === 401, await r.text());

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
