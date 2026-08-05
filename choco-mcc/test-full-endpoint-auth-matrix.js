/* CHOCOMCC FULL ENDPOINT AUTH MATRIX + RATE-LIMIT AUDIT
   Owner asked to "cement all endpoints... to prevent hacking". Rather than
   spot-checking a handful of routes, this walks EVERY non-public route in
   server.js (60 of them: 41 admin, 19 signed-in-user) and proves each one
   rejects a request carrying NO credentials at all with 401 -- not a 500,
   not a 404, not a silent pass-through. Missing even one of these from a
   list like this is exactly how an endpoint quietly ships unprotected.

   Also proves the two concrete gaps closed this round:
     - /team/milestone/claim (a money-crediting endpoint) previously had NO
       per-route rate limit, only the blanket 400/min global one -- it's now
       in the same tight 60/min bucket as every other money endpoint
       (checkin, withdraw, invest, deposit, redeem, bank/save, etc.),
       proven here by reading its own RateLimit-Limit response header.
     - /public/settings, /public/products, /admin/settings, /admin/banners,
       /admin/products are now wrapped in their own try/catch (defense in
       depth to match every other route's convention) -- proven here by
       confirming their normal success responses are unaffected.

   Run: node test-full-endpoint-auth-matrix.js   (exits 0 = all green)    */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '4104';

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

const BASE = 'http://127.0.0.1:4104';
async function call(method, p, body) {
  const headers = { 'Content-Type': 'application/json' };
  const r = await fetch(BASE + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : (method === 'POST' ? '{}' : undefined) });
  let j = null; try { j = await r.json(); } catch (_) {}
  return { code: r.status, body: j, headers: r.headers };
}
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   - ' + name); }
  else { fail++; console.log('  FAIL - ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}

// Every admin-only route (verifyAdmin or verifyOwner gated) in server.js.
const ADMIN_ROUTES = [
  ['POST', '/admin/push/register'], ['POST', '/admin/push/unregister'],
  ['POST', '/admin/withdraw/process'], ['POST', '/admin/withdraw/verify'],
  ['GET', '/admin/admins/list'], ['POST', '/admin/admins/create'],
  ['POST', '/admin/admins/deactivate'], ['POST', '/admin/admins/reactivate'],
  ['POST', '/admin/admins/reset-password'], ['POST', '/admin/admins/delete'],
  ['POST', '/admin/audit-log'], ['GET', '/admin/settings'], ['POST', '/admin/settings/update'],
  ['GET', '/admin/banners'], ['POST', '/admin/banners/set'], ['POST', '/admin/banners/clear'],
  ['GET', '/admin/products'], ['POST', '/admin/products/save'], ['POST', '/admin/products/delete'],
  ['POST', '/admin/products/clear'], ['GET', '/admin/users'], ['GET', '/admin/users/recount'],
  ['GET', '/admin/integrity'], ['POST', '/admin/user/detail'], ['POST', '/admin/deposit'],
  ['POST', '/admin/debit'], ['POST', '/admin/ban'], ['POST', '/admin/user/reset-password'],
  ['POST', '/admin/user/delete'], ['POST', '/admin/deposits/list'], ['POST', '/admin/deposit/force-credit'],
  ['POST', '/admin/withdrawals/list'], ['POST', '/admin/withdraw/reject'], ['POST', '/admin/transactions/list'],
  ['GET', '/admin/referrals/list'], ['POST', '/admin/promocodes/generate'], ['GET', '/admin/promocodes/list'],
  ['POST', '/admin/promocodes/deactivate'], ['GET', '/admin/stats'], ['GET', '/admin/badges'],
  ['POST', '/admin/analytics'], ['GET', '/admin/payments/sync']
];
// Every signed-in-user route (verifyAuth gated) in server.js.
const USER_ROUTES = [
  ['GET', '/team/members'], ['GET', '/team/stats'], ['POST', '/team/milestone/claim'],
  ['POST', '/account/create-profile'], ['POST', '/register'], ['GET', '/account'],
  ['POST', '/checkin'], ['POST', '/invest/create'], ['GET', '/investments'],
  ['POST', '/deposit/marzpay'], ['POST', '/deposit/marzpay/status'], ['POST', '/withdraw/request'],
  ['POST', '/withdraw/marzpay/status'], ['POST', '/bank/save'], ['GET', '/bank/list'], ['POST', '/bank/delete'],
  ['POST', '/redeem'], ['GET', '/transactions'], ['GET', '/deposits'], ['GET', '/withdrawals']
];

(async () => {
  await new Promise(r => setTimeout(r, 600));

  console.log(`\n== ${ADMIN_ROUTES.length} admin routes -- every one must 401 with zero credentials ==`);
  for (const [method, path] of ADMIN_ROUTES) {
    const r = await call(method, path);
    check(`${method} ${path} rejects with no admin auth (401)`, r.code === 401, { code: r.code, body: r.body });
  }

  console.log(`\n== ${USER_ROUTES.length} signed-in-user routes -- every one must 401 with zero credentials ==`);
  for (const [method, path] of USER_ROUTES) {
    const r = await call(method, path);
    check(`${method} ${path} rejects with no Bearer token (401)`, r.code === 401, { code: r.code, body: r.body });
  }

  console.log('\n== /team/milestone/claim closed: now in the same tight rate-limit bucket as other money endpoints ==');
  const rClaim = await call('POST', '/team/milestone/claim');
  check('carries the 60/min apiLimiter header (was previously only the 400/min global one)', rClaim.headers.get('ratelimit-limit') === '60', rClaim.headers.get('ratelimit-limit'));
  const rAccount = await call('GET', '/account');
  check('sanity check: an endpoint NOT in the tight list still shows the 400/min global limiter', rAccount.headers.get('ratelimit-limit') === '400', rAccount.headers.get('ratelimit-limit'));

  console.log('\n== Newly try/catch-wrapped GET routes still work normally (no regression) ==');
  let r = await call('GET', '/public/settings');
  check('/public/settings still returns success', r.body?.status === 'success' && !!r.body.settings, r.body);
  r = await call('GET', '/public/products');
  check('/public/products still returns success', r.body?.status === 'success' && Array.isArray(r.body.products), r.body);
  r = await call('GET', '/admin/settings', undefined); // no auth on purpose -- expect 401, not 500/hang
  check('/admin/settings still 401s cleanly with no auth (no crash)', r.code === 401, r.body);
  const ownerHeaders = { Authorization: 'Bearer test-admin-key' };
  async function ownerCall(method, path) {
    const rr = await fetch(BASE + path, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, ownerHeaders) });
    let jj = null; try { jj = await rr.json(); } catch (_) {}
    return { code: rr.status, body: jj };
  }
  r = await ownerCall('GET', '/admin/settings');
  check('/admin/settings returns success for the real owner key', r.body?.status === 'success' && !!r.body.settings, r.body);
  r = await ownerCall('GET', '/admin/banners');
  check('/admin/banners returns success for the real owner key', r.body?.status === 'success' && !!r.body.banners, r.body);
  r = await ownerCall('GET', '/admin/products');
  check('/admin/products returns success for the real owner key', r.body?.status === 'success' && Array.isArray(r.body.products), r.body);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
