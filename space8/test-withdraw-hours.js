/* SPACE8 -- ADMIN-SETTABLE WITHDRAWAL REQUEST HOURS (EAT), SERVER-ENFORCED
   Owner: "let us control withdrawal requests time, so this will be EAT
   time, so SETTABLE IN admin settings, so this can regulate someone not
   to request a withdrawal in a wrong time, so it will be server side,
   encrypted, and safeguarded, and secure."

   Boots the REAL server.js against an in-memory mock database and proves,
   over real HTTP:
     - off by default -- a request at any hour succeeds (past the hours
       check specifically; it may still fail later for unrelated reasons
       like an unbound payout account, which is fine, that's not what
       this file is testing)
     - once enabled, a request DURING the configured window is allowed
       past the hours check
     - a request OUTSIDE the configured window is rejected with a clear
       OUTSIDE_WITHDRAW_HOURS code and message, BEFORE the PIN/bind checks
       even run (nothing about the destination account is validated for a
       request that was never going to be allowed anyway)
     - a window that WRAPS past midnight (closes-at earlier than
       opens-at, e.g. 10pm-6am) is evaluated correctly in both directions
     - a misconfigured window (opens-at === closes-at, genuinely
       ambiguous) fails OPEN -- never accidentally locks every member out
       of withdrawing their own money platform-wide
     - the enforcement runs off the SERVER's clock, not anything the
       client sends -- there is no client-suppliable time parameter to
       this endpoint at all, so this is implicit but explicitly asserted
       by never sending one and confirming the server still enforces
       correctly
     - /admin/settings/update range-validates the two hour fields (0-23)
       same as every other settings field, and only the owner can change
       them
     - /public/settings echoes the configured window so the client can
       show the informational note

   Every "inside/outside the window" scenario is computed relative to the
   REAL current EAT hour at test time (not a hardcoded hour), so this file
   never flakes depending on when it happens to run.

   Run: node test-withdraw-hours.js   (exits 0 = all green)              */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '4306';

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

const BASE = 'http://127.0.0.1:4306';
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
const mod24 = h => ((h % 24) + 24) % 24;
const realEatHour = () => new Date(Date.now() + 3 * 3600000).getUTCHours();
async function attemptWithdraw(uid) {
  // holder/phone/network filled in (even though this account never binds
  // a real payout account, so it would fail LATER at the bind check) --
  // the hours check must be the very first settings-driven rejection, so
  // it has to be reached before the holder/network presence check below.
  // Deliberately never sends any time/hour field -- the endpoint has no
  // such parameter, so this also proves the check can only be driven by
  // the SERVER's own clock.
  return call('POST', '/withdraw/request', { token: 'uid:' + uid, body: { amount: 50000, holder: 'Test Holder', phone: '0771960301', network: 'MTN Mobile Money' } });
}

(async () => {
  await sleep(600);
  const now = realEatHour();

  console.log('\n== Off by default: a withdrawal attempt is never rejected for "wrong hour" ==');
  const U1 = 'wh-off';
  await setupUser(U1, '0771960301');
  let r = await attemptWithdraw(U1);
  check('not rejected with OUTSIDE_WITHDRAW_HOURS while the feature is off', r.body?.code !== 'OUTSIDE_WITHDRAW_HOURS', r.body);

  console.log('\n== /public/settings reports the feature as off with no window set ==');
  r = await call('GET', '/public/settings');
  check('withdrawHoursEnabled is false by default', r.body?.settings?.withdrawHoursEnabled === false, r.body?.settings);

  console.log('\n== Enabling it, with the CURRENT hour inside the window ==');
  const insideStart = now, insideEnd = mod24(now + 2);
  r = await ownerCall('/admin/settings/update', { settings: { withdrawHoursEnabled: true, withdrawHoursStart: insideStart, withdrawHoursEnd: insideEnd } });
  check('settings save succeeded', r.body?.status === 'success', r.body);
  r = await call('GET', '/public/settings');
  check('/public/settings now reflects the enabled window', r.body?.settings?.withdrawHoursEnabled === true && r.body?.settings?.withdrawHoursStart === insideStart && r.body?.settings?.withdrawHoursEnd === insideEnd, r.body?.settings);
  const U2 = 'wh-inside';
  await setupUser(U2, '0771960302');
  r = await attemptWithdraw(U2);
  check('a request DURING the window is not rejected for hours (window [' + insideStart + ',' + insideEnd + '), current hour ' + now + ')', r.body?.code !== 'OUTSIDE_WITHDRAW_HOURS', r.body);

  console.log('\n== A narrow window that EXCLUDES the current hour rejects the request ==');
  const outsideStart = mod24(now + 3), outsideEnd = mod24(now + 4);
  r = await ownerCall('/admin/settings/update', { settings: { withdrawHoursEnabled: true, withdrawHoursStart: outsideStart, withdrawHoursEnd: outsideEnd } });
  check('settings save succeeded', r.body?.status === 'success', r.body);
  const U3 = 'wh-outside';
  await setupUser(U3, '0771960303');
  r = await attemptWithdraw(U3);
  check('rejected with OUTSIDE_WITHDRAW_HOURS (window [' + outsideStart + ',' + outsideEnd + '), current hour ' + now + ')', r.code === 400 && r.body?.code === 'OUTSIDE_WITHDRAW_HOURS', r.body);
  check('the rejection message names East Africa Time', /East Africa Time/.test(r.body?.message || ''), r.body?.message);
  check('rejected BEFORE any PIN/bind validation ran (no PIN sent at all, yet the error is about hours, not a missing PIN)', r.body?.message && !/PIN/i.test(r.body.message));

  console.log('\n== A window that WRAPS past midnight is evaluated correctly ==');
  // Rather than trying to force inclusion/exclusion by offsetting from
  // "now" (awkward at the hour-23 edge: any wrapping start<=23 always
  // satisfies "hour>=start" for hour=23, so a wrapping window can never
  // structurally exclude hour 23 -- that's real 0-23 arithmetic, not a
  // bug), this computes the SAME predicate the server uses locally and
  // asserts the real HTTP response matches it, for a handful of fixed
  // wrapping windows. This exercises the actual wrap logic (start>end)
  // robustly regardless of what "now" happens to be when this file runs.
  const withinWindow = (hour, start, end) => start < end ? (hour >= start && hour < end) : (hour >= start || hour < end);
  const wrapCases = [[22, 6], [20, 4], [23, 1], [1, 0]]; // all genuinely wrap: start > end
  let wrapIdx = 0;
  for (const [wStart, wEnd] of wrapCases) {
    wrapIdx++;
    const expectRejected = !withinWindow(now, wStart, wEnd);
    r = await ownerCall('/admin/settings/update', { settings: { withdrawHoursEnabled: true, withdrawHoursStart: wStart, withdrawHoursEnd: wEnd } });
    check(`wrap case [${wStart},${wEnd}) save succeeded`, r.body?.status === 'success', r.body);
    const UW = 'wh-wrap-' + wrapIdx;
    await setupUser(UW, '077196031' + wrapIdx);
    r = await attemptWithdraw(UW);
    const actuallyRejected = r.code === 400 && r.body?.code === 'OUTSIDE_WITHDRAW_HOURS';
    check(`wrapping window [${wStart},${wEnd}) at current hour ${now}: server's decision matches the expected predicate (expect rejected=${expectRejected})`, actuallyRejected === expectRejected, { wStart, wEnd, now, expectRejected, actuallyRejected, body: r.body });
  }

  console.log('\n== A misconfigured window (opens-at === closes-at) fails OPEN, never locks everyone out ==');
  r = await ownerCall('/admin/settings/update', { settings: { withdrawHoursEnabled: true, withdrawHoursStart: 9, withdrawHoursEnd: 9 } });
  check('settings save succeeded (9===9 is a valid range value even though it\'s a degenerate window)', r.body?.status === 'success', r.body);
  const U6 = 'wh-degenerate';
  await setupUser(U6, '0771960306');
  r = await attemptWithdraw(U6);
  check('start===end never rejects for hours, regardless of current time', r.body?.code !== 'OUTSIDE_WITHDRAW_HOURS', r.body);

  console.log('\n== Turning it back off restores unrestricted withdrawal requests ==');
  r = await ownerCall('/admin/settings/update', { settings: { withdrawHoursEnabled: false } });
  check('settings save succeeded', r.body?.status === 'success', r.body);
  const U7 = 'wh-back-off';
  await setupUser(U7, '0771960307');
  r = await attemptWithdraw(U7);
  check('never rejected for hours once disabled again', r.body?.code !== 'OUTSIDE_WITHDRAW_HOURS', r.body);

  console.log('\n== Admin input validation: the hour fields are range-checked like every other settings field ==');
  r = await ownerCall('/admin/settings/update', { settings: { withdrawHoursStart: 24 } });
  check('withdrawHoursStart=24 (out of 0-23 range) rejected', r.code === 400, r.body);
  r = await ownerCall('/admin/settings/update', { settings: { withdrawHoursEnd: -1 } });
  check('withdrawHoursEnd=-1 rejected', r.code === 400, r.body);
  r = await ownerCall('/admin/settings/update', { settings: { withdrawHoursStart: 'not-a-number' } });
  check('a non-numeric value rejected', r.code === 400, r.body);

  console.log('\n== Only the owner can change it ==');
  await ownerCall('/admin/admins/create', { username: 'wh_staff', password: 'whatever-123' });
  const staffLogin = await call('POST', '/admin/login', { body: { username: 'wh_staff', password: 'whatever-123' } });
  r = await call('POST', '/admin/settings/update', { token: staffLogin.body?.token, body: { settings: { withdrawHoursEnabled: true } } });
  check('non-owner staff session is rejected outright', r.code === 401, r.body);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
