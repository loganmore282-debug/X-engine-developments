/* SPACE8 -- GIFT CODE EXPIRY IN MINUTES (not days)
   Owner: "l want to assign the duration of giftCodes to minutes not
   days." Gift codes never expired at all before this -- no expiresAt
   concept existed -- so this is a genuinely new optional field with
   minute-level granularity, not a unit conversion of something that
   already existed. Minute granularity specifically so a short flash-
   promo code (e.g. "expires in 30 minutes") is actually expressible.

   Boots the REAL server.js against an in-memory mock database and proves,
   over real HTTP:
     - a code generated with NO duration has no expiresAt at all and
       redeems successfully (unchanged default behaviour -- an admin who
       never touches the new field sees zero change)
     - a code generated WITH a duration carries the right expiresAt
       (computed relative to generation time, in minutes) and is visible
       in /admin/promocodes/list
     - such a code redeems successfully before it expires
     - a code whose expiry has already passed is rejected at /redeem with
       a clear "expired" message, and — critically — no reward is
       credited and the code is NOT marked used by the failed attempt
     - a genuinely LEGACY code (seeded with no expiresAt field at all,
       exactly like every code issued before this feature existed) keeps
       working exactly as before
     - input validation on durationMinutes: 0, negative, non-numeric, and
       past the sanity cap are all rejected; a blank/omitted value is the
       valid "never expires" case, not an error

   Run: node test-giftcode-expiry.js   (exits 0 = all green)             */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '4308';

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

const BASE = 'http://127.0.0.1:4308';
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
function collMap(name) {
  if (!mockdb.__store.has(name)) mockdb.__store.set(name, new Map());
  return mockdb.__store.get(name);
}
const promoCodes = () => collMap('promoCodes');
const users = () => collMap('users');

(async () => {
  await sleep(600);

  console.log('\n== No duration given: the code has no expiry at all (unchanged default behaviour) ==');
  let r = await ownerCall('/admin/promocodes/generate', { minAmount: 1000, maxAmount: 1000, count: 1, maxUses: 1 });
  check('generation without a duration succeeded', r.body?.status === 'success', r.body);
  const foreverCode = r.body.codes[0].code;
  r = await ownerGet('/admin/promocodes/list');
  const foreverRow = r.body.codes.find(c => c.code === foreverCode);
  check('the listed code has no expiresAt field at all', foreverRow && foreverRow.expiresAt === undefined, foreverRow);
  const U1 = 'ge-forever';
  await setupUser(U1, '0771990501');
  r = await call('POST', '/redeem', { token: 'uid:' + U1, body: { code: foreverCode } });
  check('redeeming it succeeds with no expiry set', r.body?.status === 'success', r.body);

  console.log('\n== A duration IS given: expiresAt is set correctly, and it redeems fine before expiring ==');
  const beforeGen = Date.now();
  r = await ownerCall('/admin/promocodes/generate', { minAmount: 2000, maxAmount: 2000, count: 1, maxUses: 1, durationMinutes: 30 });
  check('generation with a 30-minute duration succeeded', r.body?.status === 'success', r.body);
  const soonCode = r.body.codes[0].code;
  r = await ownerGet('/admin/promocodes/list');
  const soonRow = r.body.codes.find(c => c.code === soonCode);
  check('the listed code has an expiresAt roughly 30 minutes out', !!soonRow?.expiresAt, soonRow);
  const expiresAtMs = new Date(soonRow.expiresAt).getTime();
  const expectedMs = beforeGen + 30 * 60000;
  check('expiresAt is within a few seconds of "generation time + 30 minutes"', Math.abs(expiresAtMs - expectedMs) < 5000, { expiresAtMs, expectedMs, diff: expiresAtMs - expectedMs });
  const U2 = 'ge-soon';
  await setupUser(U2, '0771990502');
  r = await call('POST', '/redeem', { token: 'uid:' + U2, body: { code: soonCode } });
  check('redeeming it succeeds well before its 30-minute expiry', r.body?.status === 'success', r.body);

  console.log('\n== A code whose expiry has already passed is rejected, credits nothing, and is not marked used ==');
  r = await ownerCall('/admin/promocodes/generate', { minAmount: 3000, maxAmount: 3000, count: 1, maxUses: 1, durationMinutes: 5 });
  const expiredCode = r.body.codes[0].code;
  // Directly backdate the stored expiresAt to the past -- this file's own
  // way of simulating "time has passed" without an actual multi-minute
  // sleep, same approach test-checkin-* files use for day-boundary tests.
  for (const [id, doc] of promoCodes()) { if (doc.code === expiredCode) doc.expiresAt = new Date(Date.now() - 60000); }
  const U3 = 'ge-expired';
  await setupUser(U3, '0771990503');
  const balBefore = users().get(U3).walletBalance;
  r = await call('POST', '/redeem', { token: 'uid:' + U3, body: { code: expiredCode } });
  check('redeeming an expired code is rejected (400)', r.code === 400, r.body);
  check('the rejection message says the code has expired', /expired/i.test(r.body?.message || ''), r.body?.message);
  check('no reward was credited to the wallet', users().get(U3).walletBalance === balBefore, { before: balBefore, after: users().get(U3).walletBalance });
  const stillUnused = [...promoCodes().values()].find(c => c.code === expiredCode);
  check('the code was NOT marked used by the failed/expired attempt', !(stillUnused.usedBy || []).includes(U3), stillUnused.usedBy);

  console.log('\n== A genuinely LEGACY code (no expiresAt field, seeded exactly like a pre-existing real code) still works ==');
  promoCodes().set('legacy-code-doc', { code: 'LEGCY1', codeLower: 'legcy1', reward: 4000, active: true, usedBy: [], maxUses: 1, createdAt: new Date(Date.now() - 999 * 86400000), createdBy: 'owner-key' });
  const U4 = 'ge-legacy';
  await setupUser(U4, '0771990504');
  r = await call('POST', '/redeem', { token: 'uid:' + U4, body: { code: 'LEGCY1' } });
  check('a legacy code with no expiresAt field at all redeems exactly as before', r.body?.status === 'success', r.body);

  console.log('\n== Input validation on durationMinutes ==');
  r = await ownerCall('/admin/promocodes/generate', { minAmount: 1000, maxAmount: 1000, count: 1, durationMinutes: 0 });
  check('durationMinutes=0 rejected (0 is not a valid duration, use blank for "never expires")', r.code === 400, r.body);
  r = await ownerCall('/admin/promocodes/generate', { minAmount: 1000, maxAmount: 1000, count: 1, durationMinutes: -5 });
  check('a negative durationMinutes rejected', r.code === 400, r.body);
  r = await ownerCall('/admin/promocodes/generate', { minAmount: 1000, maxAmount: 1000, count: 1, durationMinutes: 'not-a-number' });
  check('a non-numeric durationMinutes rejected', r.code === 400, r.body);
  r = await ownerCall('/admin/promocodes/generate', { minAmount: 1000, maxAmount: 1000, count: 1, durationMinutes: 999999999 });
  check('an absurdly large durationMinutes (past the sanity cap) rejected', r.code === 400, r.body);
  r = await ownerCall('/admin/promocodes/generate', { minAmount: 1000, maxAmount: 1000, count: 1, durationMinutes: 1 });
  check('durationMinutes=1 (the smallest valid value) is accepted', r.body?.status === 'success', r.body);
  // ChatGPT-verified real gap (2026-08-18): parseFloat() (the original
  // implementation) stops at the first non-numeric character instead of
  // rejecting the whole string, so "30minutes" silently became 30 --
  // looser than every other numeric admin input in this file. Fixed to
  // use strict Number(), matching SETTINGS_CRITICAL_RANGES's own
  // validation loop.
  r = await ownerCall('/admin/promocodes/generate', { minAmount: 1000, maxAmount: 1000, count: 1, durationMinutes: '30minutes' });
  check('a malformed numeric string ("30minutes") is rejected outright, not silently parsed as 30', r.code === 400, r.body);
  r = await ownerCall('/admin/promocodes/generate', { minAmount: 1000, maxAmount: 1000, count: 1, durationMinutes: 'Infinity' });
  check('the literal string "Infinity" is rejected', r.code === 400, r.body);
  r = await ownerCall('/admin/promocodes/generate', { minAmount: 1000, maxAmount: 1000, count: 1, durationMinutes: '  15  ' });
  check('a genuinely numeric value with surrounding whitespace is still accepted (Number() tolerates that, same as every other settings field)', r.body?.status === 'success', r.body);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
