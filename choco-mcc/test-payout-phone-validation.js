/* CHOCOMCC PAYOUT PHONE VALIDATION
   Real production bug: an account bound the payout number +25625607541000
   (a stray extra "256" mashed onto the front) via /bank/save. The old
   cleanPhone() only checked "starts with 256 and is >=12 digits, no upper
   bound" -- that garbled 14-digit string passed straight through, got
   stored as a real payout destination, and was later sent to MarzPay's
   /send-money as-is. MarzPay's own API choked on it and left that ONE
   withdrawal stuck "processing" forever -- and because MarzPay only allows
   ONE send-money payout in flight per business account at a time, that
   single stuck-and-invisible withdrawal silently blocked every OTHER
   admin's attempt to send ANY pending withdrawal, with a toast reading
   "A withdrawal is already being processed for this account."

   Boots the REAL server.js against an in-memory mock database and proves,
   against /bank/save (where a payout number is first bound) AND
   /withdraw/request (which can also take a phone directly, bypassing
   /bank/save entirely):
     - the EXACT real-world garbled number is rejected outright, at both
       endpoints, before anything is saved/reserved
     - a wrong-country number (Kenya +254) is rejected -- Uganda only
     - too-short / too-long / wrong-mobile-prefix numbers are all rejected
     - every real Uganda mobile shape is accepted: 07XXXXXXXX, bare
       7XXXXXXXX, 2567XXXXXXXX, and +2567XXXXXXXX
     - a rejected /bank/save never creates a bankAccounts row; a rejected
       /withdraw/request never reserves balance or creates a withdrawal doc
     - registration (/account/create-profile) is deliberately NOT tightened
       by this same strict check -- that phone already succeeded as the
       user's Firebase login identity client-side before this call, so a
       weird-but-already-working profile phone is still accepted rather
       than blocking someone out of their own account after the fact

   Isolated in its own process/port on purpose: test-withdrawal-security.js
   already runs every request in the file through ONE shared rate-limit
   bucket (its fake "uid:x" tokens don't parse as real JWTs, so the limiter
   falls back to keying by IP) and is already tightly budgeted against that
   60/min ceiling -- adding this file's ~20 extra calls there tipped an
   unrelated later section over the limit. A fresh process starts its own
   limiter state, so none of that budget is shared here.

   Run: node test-payout-phone-validation.js   (exits 0 = all green)      */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '4143';

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
let marzN = 0;
global.fetch = async (url, opts) => {
  const u = String(url);
  const json = body => ({ ok: true, status: 200, json: async () => body });
  if (u.includes('wearemarz.com') && u.endsWith('/send-money')) {
    return json({ status: 'success', data: { transaction: { uuid: 'WTX-' + (++marzN), status: 'pending' } } });
  }
  return realFetch(url, opts);
};

require('./server.js');

const BASE = 'http://127.0.0.1:4143';
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
const bankAccountsOf = uid => [...collMap('bankAccounts').values()].filter(b => b.userId === uid);
const withdrawalsOf = uid => [...collMap('withdrawals').values()].filter(w => w.userId === uid);

let n = 0;
async function freshFundedUser() {
  const uid = 'phone-test-' + (++n);
  await call('POST', '/account/create-profile', { token: 'uid:' + uid, body: { phone: '0771000000' } });
  await call('POST', '/register', { token: 'uid:' + uid, body: {} });
  userDoc(uid).walletBalance = 1000000;
  userDoc(uid).totalInvested = 1000000; // clears requireInvestToWithdraw
  return uid;
}

(async () => {
  await new Promise(r => setTimeout(r, 600));

  console.log('\n== /bank/save (payout account binding) ==');

  const A = await freshFundedUser();
  let r = await call('POST', '/bank/save', { token: 'uid:' + A, body: { holder: 'Bad Number', network: 'MTN Mobile Money', phone: '+25625607541000' } });
  check('the EXACT real-world garbled number is rejected', r.code === 400, r.body);
  check('nothing saved to bankAccounts', bankAccountsOf(A).length === 0, bankAccountsOf(A));

  const cases = [
    ['Kenyan (+254) number', '+254712345678'],
    ['too short', '07712345'],
    ['too long', '077123456789'],
    ['wrong mobile prefix (086, not 07)', '0861234567'],
    ['landline-shaped (0414XXXXXX)', '0414123456'],
    ['letters mixed in', '07712abc67'],
    ['empty string', ''],
  ];
  for (const [label, phone] of cases) {
    const uid = await freshFundedUser();
    r = await call('POST', '/bank/save', { token: 'uid:' + uid, body: { holder: 'Test', network: 'MTN Mobile Money', phone } });
    check(`rejected: ${label} ("${phone}")`, r.code === 400, r.body);
    check(`  -> nothing saved for it`, bankAccountsOf(uid).length === 0, bankAccountsOf(uid));
  }

  const goodCases = [
    ['07XXXXXXXX', '0771234567'],
    ['bare 7XXXXXXXX (no leading 0/256)', '771234567'],
    ['256 + 9 digits, no plus', '256771234567'],
    ['+2567XXXXXXXX', '+256771234567'],
    ['spaces/dashes stripped', '077 123 4567'],
  ];
  for (const [label, phone] of goodCases) {
    const uid = await freshFundedUser();
    r = await call('POST', '/bank/save', { token: 'uid:' + uid, body: { holder: 'Test', network: 'Airtel Money', phone, pin: '1234' } });
    check(`accepted: ${label} ("${phone}")`, r.body?.status === 'success', r.body);
    check(`  -> stored normalized as +2567XXXXXXXX`, bankAccountsOf(uid)[0]?.phone === '+256771234567', bankAccountsOf(uid));
  }

  console.log('\n== /withdraw/request (phone can also be submitted directly, bypassing /bank/save) ==');

  const B = await freshFundedUser();
  const balBefore = userDoc(B).walletBalance;
  r = await call('POST', '/withdraw/request', { token: 'uid:' + B, body: { amount: 20000, holder: 'Bad Number', network: 'MTN Mobile Money', phone: '+25625607541000', pin: '1234' } });
  check('withdraw/request rejects the exact real-world garbled number outright', r.code === 400, r.body);
  check('no balance reserved', userDoc(B).walletBalance === balBefore, userDoc(B).walletBalance);
  check('no withdrawal record created', withdrawalsOf(B).length === 0, withdrawalsOf(B));

  const C = await freshFundedUser();
  r = await call('POST', '/withdraw/request', { token: 'uid:' + C, body: { amount: 20000, holder: 'Kenyan', network: 'Airtel Money', phone: '+254712345678', pin: '1234' } });
  check('withdraw/request rejects a Kenyan number', r.code === 400, r.body);
  check('no balance reserved', userDoc(C).walletBalance === 1000000, userDoc(C).walletBalance);

  const D = await freshFundedUser();
  r = await call('POST', '/withdraw/request', { token: 'uid:' + D, body: { amount: 20000, holder: 'Good', network: 'MTN Mobile Money', phone: '0771234567', pin: '1234' } });
  check('withdraw/request accepts a valid number directly', r.body?.status === 'success', r.body);
  check('balance correctly reserved', userDoc(D).walletBalance === 1000000 - 20000, userDoc(D).walletBalance);

  console.log('\n== Registration is deliberately NOT tightened -- not the money-moving path ==');
  const E = 'phone-test-reg-oddball';
  r = await call('POST', '/account/create-profile', { token: 'uid:' + E, body: { phone: 'not-a-real-phone-at-all' } });
  check('create-profile still succeeds even with an unparseable phone (unrelated to the payout bug)', r.body?.status === 'success', r.body);
  check('profile phone stored as best-effort raw input, not silently dropped to null', userDoc(E)?.phone === 'not-a-real-phone-at-all', userDoc(E));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
