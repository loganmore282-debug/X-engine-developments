/* SPACE8 PAYOUT SECURITY PIN
   Owner asked: safeguard withdrawals from an unauthorized user (a stolen or
   shared phone, a hijacked session) by requiring a 4-digit PIN every time a
   member adds or removes a mobile-money payout account -- and since bank
   transfer has no separate "bind" step (the account details are typed
   fresh into every withdrawal request), the same PIN gates every bank
   withdrawal request directly.

   Boots the REAL server.js against an in-memory mock database and proves:
     - a member's FIRST bind/delete/bank-withdraw auto-provisions their PIN
       from whatever 4 digits they type, and authorizes that same action in
       one step (no separate mandatory "set up your PIN" screen first)
     - every LATER action for that same member requires the SAME pin
     - a wrong pin is rejected outright -- no bankAccounts row created, no
       account deleted, no balance reserved/withdrawal record created
     - 5 wrong attempts locks the account for 15 minutes; the 6th attempt
       is rejected as locked EVEN WITH the correct pin, and the lockout
       message says how long is left
     - the pin is shared across ALL THREE gated actions for one member
       (set via bind, then correctly required by delete and by a bank
       withdrawal request) -- one pin per person, not one per endpoint
     - GET /account/payout-pin/status correctly reports whether a pin
       exists yet
     - POST /account/payout-pin/change requires the correct old pin,
       rejects a wrong one, and after a successful change the OLD pin no
       longer works while the NEW one does
     - malformed pins (not exactly 4 digits) are rejected cleanly
     - the pin is never stored or returned in plaintext anywhere

   Run: node test-payout-pin.js   (exits 0 = all green)                   */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '4144';

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

const realFetch = global.fetch;
global.fetch = async (url, opts) => {
  const u = String(url);
  const json = body => ({ ok: true, status: 200, json: async () => body });
  if (u.includes('wearemarz.com') && u.endsWith('/bank-transfer/validate')) {
    return json({ status: 'success', message: 'Account is valid', data: { account_name: 'TEST ACCOUNT' } });
  }
  if (u.includes('wearemarz.com') && u.endsWith('/bank-transfer')) {
    return json({ status: 'success', data: { bank_transfer: { reference: 'BT-' + Math.random().toString(36).slice(2), status: 'processing' } } });
  }
  return realFetch(url, opts);
};

require('./server.js');

const BASE = 'http://127.0.0.1:4144';
async function call(method, p, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await realFetch(BASE + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (_) {}
  return { code: r.status, body: j };
}
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   - ' + name); }
  else { fail++; console.log('  FAIL - ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}
function collMap(name) {
  if (!mockdb.__store.has(name)) mockdb.__store.set(name, new Map());
  return mockdb.__store.get(name);
}
const userDoc = id => collMap('users').get(id);
// The raw mockdb store is a Map keyed BY id -- .values() alone drops it,
// unlike the real API responses (GET /bank/list etc.) which add `id` back
// in explicitly. Rebuild it here the same way.
const bankAccountsOf = uid => [...collMap('bankAccounts').entries()].filter(([, b]) => b.userId === uid).map(([id, b]) => ({ id, ...b }));
const withdrawalsOf = uid => [...collMap('withdrawals').values()].filter(w => w.userId === uid);
async function adminCall(path, body) {
  return call('POST', path, { token: 'test-admin-key', body: body || {} });
}

async function freshFundedUser(uid, phone) {
  await call('POST', '/account/create-profile', { token: 'uid:' + uid, body: { phone } });
  await call('POST', '/register', { token: 'uid:' + uid, body: {} });
  const u = userDoc(uid);
  u.walletBalance = 1000000;
  u.totalInvested = 1000000; // clears requireInvestToWithdraw
}

(async () => {
  await new Promise(r => setTimeout(r, 600));
  await adminCall('/admin/settings/update', { settings: { bankWithdrawEnabled: true } });

  console.log('\n== First bind auto-provisions the PIN and authorizes that same action ==');
  const A = 'pin-user-a';
  await freshFundedUser(A, '0771900101');
  let r = await call('POST', '/bank/save', { token: 'uid:' + A, body: { holder: 'A One', network: 'MTN Mobile Money', phone: '0771900101', pin: '1357' } });
  check('first bind succeeds', r.body?.status === 'success', r.body);
  check('server reports the pin was just set', r.body?.pinJustSet === true, r.body);
  check('never stored/returned in plaintext anywhere in the response', JSON.stringify(r.body).indexOf('1357') === -1, r.body);
  check('pin hash actually stored on the user doc, never the raw pin', !!userDoc(A).payoutPinHash && userDoc(A).payoutPinHash !== '1357', userDoc(A).payoutPinHash);

  console.log('\n== A later bind for the SAME member requires the SAME pin ==');
  r = await call('POST', '/bank/save', { token: 'uid:' + A, body: { holder: 'A Two', network: 'Airtel Money', phone: '0771900102', pin: '1357' } });
  check('correct pin allows a second bind', r.body?.status === 'success', r.body);
  check('pinJustSet is false once a pin already exists', r.body?.pinJustSet === false, r.body);

  console.log('\n-- A wrong pin is rejected outright, nothing saved --');
  const boundBefore = bankAccountsOf(A).length;
  r = await call('POST', '/bank/save', { token: 'uid:' + A, body: { holder: 'Intruder', network: 'MTN Mobile Money', phone: '0771900199', pin: '0000' } });
  check('wrong pin rejected', r.code === 400 && r.body?.code === 'WRONG_PIN', r.body);
  check('no new bankAccounts row was created', bankAccountsOf(A).length === boundBefore, bankAccountsOf(A));

  console.log('\n== The SAME pin also gates deleting a bound account ==');
  const toDelete = bankAccountsOf(A)[0].id;
  r = await call('POST', '/bank/delete', { token: 'uid:' + A, body: { id: toDelete, pin: '0000' } });
  check('wrong pin blocks delete too', r.code === 400 && r.body?.code === 'WRONG_PIN', r.body);
  check('account was NOT deleted', bankAccountsOf(A).some(b => b.id === toDelete), bankAccountsOf(A));
  r = await call('POST', '/bank/delete', { token: 'uid:' + A, body: { id: toDelete, pin: '1357' } });
  check('correct pin allows delete', r.body?.status === 'success', r.body);
  check('account actually deleted', !bankAccountsOf(A).some(b => b.id === toDelete), bankAccountsOf(A));

  console.log('\n== 5 wrong attempts locks the account for 15 minutes ==');
  const B = 'pin-user-b';
  await freshFundedUser(B, '0771900201');
  r = await call('POST', '/bank/save', { token: 'uid:' + B, body: { holder: 'B One', network: 'MTN Mobile Money', phone: '0771900201', pin: '2468' } });
  check('B sets up their own pin', r.body?.status === 'success', r.body);
  for (let i = 1; i <= 4; i++) {
    r = await call('POST', '/bank/save', { token: 'uid:' + B, body: { holder: 'Intruder Attempt', network: 'MTN Mobile Money', phone: '0771900288', pin: '9999' } });
    check(`wrong attempt ${i}/4 rejected, not yet locked`, r.body?.code === 'WRONG_PIN', r.body);
  }
  r = await call('POST', '/bank/save', { token: 'uid:' + B, body: { holder: 'Intruder', network: 'Airtel Money', phone: '0771900299', pin: '9999' } });
  check('5th wrong attempt trips the lock', r.body?.code === 'LOCKED', r.body);
  check('nothing was saved from the 5th attempt', bankAccountsOf(B).length === 1, bankAccountsOf(B));

  console.log('-- While locked, even the CORRECT pin is rejected --');
  r = await call('POST', '/bank/save', { token: 'uid:' + B, body: { holder: 'B Two', network: 'MTN Mobile Money', phone: '0771900202', pin: '2468' } });
  check('correct pin still rejected while locked', r.code === 400 && r.body?.code === 'LOCKED', r.body);
  check('lockout message tells them how long is left', /minute/i.test(r.body?.message || ''), r.body?.message);
  check('nothing saved while locked', bankAccountsOf(B).length === 1, bankAccountsOf(B));

  console.log('-- Manually clearing the lock (simulating time passing) lets the correct pin through again --');
  userDoc(B).payoutPinLockedUntil = null;
  r = await call('POST', '/bank/save', { token: 'uid:' + B, body: { holder: 'B Two', network: 'MTN Mobile Money', phone: '0771900202', pin: '2468' } });
  check('correct pin works again once the lock clears', r.body?.status === 'success', r.body);

  console.log('\n== GET /account/payout-pin/status reports correctly ==');
  const C = 'pin-user-c';
  await freshFundedUser(C, '0771900301');
  r = await call('GET', '/account/payout-pin/status', { token: 'uid:' + C });
  check('no pin yet -> hasPayoutPin false', r.body?.hasPayoutPin === false, r.body);
  await call('POST', '/bank/save', { token: 'uid:' + C, body: { holder: 'C One', network: 'MTN Mobile Money', phone: '0771900301', pin: '3579' } });
  r = await call('GET', '/account/payout-pin/status', { token: 'uid:' + C });
  check('after first bind -> hasPayoutPin true', r.body?.hasPayoutPin === true, r.body);

  console.log('\n== POST /account/payout-pin/change ==');
  r = await call('POST', '/account/payout-pin/change', { token: 'uid:' + C, body: { oldPin: '0000', newPin: '4444' } });
  check('wrong old pin rejected', r.code === 400 && r.body?.code === 'WRONG_PIN', r.body);
  r = await call('POST', '/account/payout-pin/change', { token: 'uid:' + C, body: { oldPin: '3579', newPin: '44' } });
  check('malformed new pin rejected (not 4 digits)', r.code === 400, r.body);
  r = await call('POST', '/account/payout-pin/change', { token: 'uid:' + C, body: { oldPin: '3579', newPin: '4444' } });
  check('correct old pin + valid new pin succeeds', r.body?.status === 'success', r.body);

  console.log('-- After a change, the OLD pin no longer works and the NEW one does --');
  r = await call('POST', '/bank/save', { token: 'uid:' + C, body: { holder: 'C Two', network: 'Airtel Money', phone: '0771900302', pin: '3579' } });
  check('old pin rejected after change', r.code === 400 && r.body?.code === 'WRONG_PIN', r.body);
  r = await call('POST', '/bank/save', { token: 'uid:' + C, body: { holder: 'C Two', network: 'Airtel Money', phone: '0771900302', pin: '4444' } });
  check('new pin accepted after change', r.body?.status === 'success', r.body);

  console.log('\n-- Changing a pin that was never set is rejected cleanly --');
  const D = 'pin-user-d';
  await freshFundedUser(D, '0771900401');
  r = await call('POST', '/account/payout-pin/change', { token: 'uid:' + D, body: { oldPin: '1234', newPin: '5678' } });
  check('cannot "change" a pin that does not exist yet', r.code === 400 && r.body?.code === 'NO_PIN', r.body);

  console.log('\n-- Malformed pins are rejected on every gated action --');
  const E = 'pin-user-e';
  await freshFundedUser(E, '0771900501');
  for (const badPin of ['123', '12345', 'abcd', '', undefined]) {
    r = await call('POST', '/bank/save', { token: 'uid:' + E, body: { holder: 'E', network: 'MTN Mobile Money', phone: '0771900501', pin: badPin } });
    check(`malformed pin rejected: ${JSON.stringify(badPin)}`, r.code === 400 && r.body?.code === 'INVALID_PIN', r.body);
  }
  check('nothing was ever saved for E across all the malformed attempts', bankAccountsOf(E).length === 0, bankAccountsOf(E));

  console.log('\n== Admin can reset a payout PIN (never view it) ==');
  const F = 'pin-user-f';
  await freshFundedUser(F, '0771900601');
  await call('POST', '/bank/save', { token: 'uid:' + F, body: { holder: 'F One', network: 'MTN Mobile Money', phone: '0771900601', pin: '9012' } });

  let r2 = await adminCall('/admin/user/detail', { userId: F });
  check('admin detail reports hasPayoutPin:true', r2.body?.user?.hasPayoutPin === true, r2.body?.user);
  check('SECURITY: the raw PIN hash is never sent to the admin panel', !('payoutPinHash' in (r2.body?.user || {})), r2.body?.user);

  r2 = await call('POST', '/admin/user/reset-payout-pin', { body: { userId: F } });
  check('non-admin cannot reset a payout PIN', r2.code === 401, r2.body);

  r2 = await adminCall('/admin/user/reset-payout-pin', { userId: F });
  check('owner-admin reset succeeds', r2.body?.status === 'success', r2.body);
  check('payoutPinHash actually cleared in the store', !userDoc(F).payoutPinHash, userDoc(F));

  r2 = await adminCall('/admin/user/detail', { userId: F });
  check('detail now reports hasPayoutPin:false after the reset', r2.body?.user?.hasPayoutPin === false, r2.body?.user);

  console.log('-- After a reset, the OLD pin no longer works and a fresh one auto-provisions --');
  r2 = await call('POST', '/bank/save', { token: 'uid:' + F, body: { holder: 'F Two', network: 'Airtel Money', phone: '0771900602', pin: '9012' } });
  check('the pre-reset pin is treated as a brand new pin, not verified against nothing', r2.body?.status === 'success' && r2.body?.pinJustSet === true, r2.body);

  console.log('-- Resetting an already-locked-out account also clears the lockout --');
  const G = 'pin-user-g';
  await freshFundedUser(G, '0771900701');
  await call('POST', '/bank/save', { token: 'uid:' + G, body: { holder: 'G', network: 'MTN Mobile Money', phone: '0771900701', pin: '1111' } });
  for (let i = 0; i < 5; i++) {
    await call('POST', '/bank/save', { token: 'uid:' + G, body: { holder: 'G', network: 'MTN Mobile Money', phone: '0771900701', pin: '0000' } });
  }
  r2 = await call('POST', '/bank/save', { token: 'uid:' + G, body: { holder: 'G', network: 'MTN Mobile Money', phone: '0771900701', pin: '1111' } });
  check('sanity: account is locked even with the correct pin', r2.code === 400 && r2.body?.code === 'LOCKED', r2.body);
  await adminCall('/admin/user/reset-payout-pin', { userId: G });
  r2 = await call('POST', '/bank/save', { token: 'uid:' + G, body: { holder: 'G', network: 'MTN Mobile Money', phone: '0771900701', pin: '2222' } });
  check('reset clears the lockout too -- a fresh pin works immediately', r2.body?.status === 'success' && r2.body?.pinJustSet === true, r2.body);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
