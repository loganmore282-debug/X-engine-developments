/* CHOCOMCC CHECK-IN + GIFT CODE SECURITY TEST
   Boots the REAL server.js against an in-memory mock database
   (test-mockdb.js) with Firebase auth stubbed, then drives /checkin and
   /redeem over real HTTP to prove: no double-crediting (including under a
   concurrent double-tap), a banned account is locked out of both, a
   multi-use gift code can never exceed its usage cap even under concurrent
   redemptions from different users, a used-up/invalid/inactive code is
   rejected without crediting anything, and a NoSQL-injection-style payload
   in the code field can never widen the database match (it's coerced to a
   plain string before it ever reaches a query).

   Run: node test-checkin-giftcode-security.js   (exits 0 = all green)     */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '3999';

const Module = require('module');

const mockdb = require('./test-mockdb.js');
const dbPath = require.resolve('./db.js');
const dbMod = new Module(dbPath); dbMod.exports = mockdb; dbMod.loaded = true;
require.cache[dbPath] = dbMod;

const faPath = require.resolve('firebase-admin');
const faMod = new Module(faPath);
faMod.exports = {
  initializeApp: () => {},
  credential: { cert: () => ({}) },
  auth: () => ({
    verifyIdToken: async tok => {
      if (String(tok).startsWith('uid:')) return { uid: tok.slice(4) };
      throw new Error('invalid token');
    },
  }),
};
faMod.loaded = true;
require.cache[faPath] = faMod;

const realFetch = global.fetch;

require('./server.js');

const BASE = 'http://127.0.0.1:3999';
async function call(method, p, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await realFetch(BASE + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (_) {}
  return { code: r.status, body: j };
}
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
const promoCodes = () => collMap('promoCodes');
const userDoc = id => users().get(id);
const txns = () => collMap('transactions');
const countTx = (uid, type) => [...txns().values()].filter(t => t.userId === uid && t.type === type).length;

(async () => {
  await sleep(600);

  console.log('\n== CHECK-IN ==');
  const A = 'alice-uid';
  let r = await call('POST', '/account/create-profile', { token: 'uid:' + A, body: { phone: '0771000001' } });
  check('alice profile created', r.body?.status === 'success', r.body);
  r = await call('POST', '/register', { token: 'uid:' + A, body: {} });
  check('alice registered', r.body?.status === 'success', r.body);
  const startBal = userDoc(A).walletBalance;

  console.log('\n-- Unauthenticated check-in is rejected --');
  r = await call('POST', '/checkin', {});
  check('no token -> 401', r.code === 401, r.code);

  console.log('\n-- Normal check-in credits exactly once --');
  r = await call('POST', '/checkin', { token: 'uid:' + A });
  check('check-in succeeds', r.body?.status === 'success' && typeof r.body?.bonus === 'number', r.body);
  const bonus = r.body.bonus;
  check('wallet credited by the bonus amount', userDoc(A).walletBalance === startBal + bonus, userDoc(A).walletBalance);
  check('exactly 1 checkin transaction recorded', countTx(A, 'checkin') === 1, countTx(A, 'checkin'));

  console.log('\n-- Re-checking in the SAME day is rejected, no partial credit --');
  r = await call('POST', '/checkin', { token: 'uid:' + A });
  check('second check-in same day rejected (400)', r.code === 400, r.body);
  check('wallet unchanged after rejected re-checkin', userDoc(A).walletBalance === startBal + bonus, userDoc(A).walletBalance);
  check('still exactly 1 checkin transaction (no phantom credit)', countTx(A, 'checkin') === 1, countTx(A, 'checkin'));

  console.log('\n-- Concurrent double-tap on a FRESH day never double-credits --');
  // Force "yesterday" by clearing lastCheckin so a fresh claim is possible again,
  // then fire two check-in requests at once — only one may ever win.
  const doc = userDoc(A);
  doc.lastCheckin = null;
  const balBeforeRace = doc.walletBalance;
  const [r1, r2] = await Promise.all([
    call('POST', '/checkin', { token: 'uid:' + A }),
    call('POST', '/checkin', { token: 'uid:' + A }),
  ]);
  const raceSuccesses = [r1, r2].filter(x => x.body?.status === 'success').length;
  check('exactly ONE of two concurrent check-ins succeeds', raceSuccesses === 1, { r1: r1.body, r2: r2.body });
  check('wallet credited exactly once from the race', userDoc(A).walletBalance === balBeforeRace + bonus, userDoc(A).walletBalance);
  check('exactly 2 checkin transactions total (1 original + 1 from the race)', countTx(A, 'checkin') === 2, countTx(A, 'checkin'));

  console.log('\n-- A banned account cannot check in --');
  const BND = 'banned-uid';
  r = await call('POST', '/account/create-profile', { token: 'uid:' + BND, body: { phone: '0771000099' } });
  check('banned-to-be profile created', r.body?.status === 'success', r.body);
  r = await call('POST', '/register', { token: 'uid:' + BND, body: {} });
  check('banned-to-be registered', r.body?.status === 'success', r.body);
  userDoc(BND).status = 'banned';
  const bannedBal = userDoc(BND).walletBalance;
  r = await call('POST', '/checkin', { token: 'uid:' + BND });
  check('banned account check-in rejected (403)', r.code === 403, r.body);
  check('banned account wallet unchanged', userDoc(BND).walletBalance === bannedBal, userDoc(BND).walletBalance);

  console.log('\n== GIFT / PROMO CODES ==');
  const B = 'bob-uid', C = 'carol-uid', D = 'dave-uid';
  for (const u of [B, C, D]) {
    r = await call('POST', '/account/create-profile', { token: 'uid:' + u, body: { phone: '07720000' + u.slice(0, 2) } });
    check(u + ' profile created', r.body?.status === 'success', r.body);
    r = await call('POST', '/register', { token: 'uid:' + u, body: {} });
    check(u + ' registered', r.body?.status === 'success', r.body);
  }

  // Seed a promo code directly: single-use-per-user, capped at 2 total uses.
  promoCodes().set('code-1', { code: 'SWEET1', reward: 5000, active: true, maxUses: 2, usedBy: [] });

  console.log('\n-- Valid code credits exactly once, then blocks re-use by the same user --');
  const bobStart = userDoc(B).walletBalance;
  r = await call('POST', '/redeem', { token: 'uid:' + B, body: { code: 'sweet1' } }); // lowercase on purpose
  check('redeem succeeds (case-insensitive) and pays 5000', r.body?.status === 'success' && r.body?.reward === 5000, r.body);
  check('wallet credited 5000', userDoc(B).walletBalance === bobStart + 5000, userDoc(B).walletBalance);
  r = await call('POST', '/redeem', { token: 'uid:' + B, body: { code: 'SWEET1' } });
  check('same user re-redeeming rejected', r.code === 400 && /already/i.test(r.body?.message || ''), r.body);
  check('wallet unchanged after re-redeem attempt', userDoc(B).walletBalance === bobStart + 5000, userDoc(B).walletBalance);
  check('exactly 1 promocode transaction for bob', countTx(B, 'promocode') === 1, countTx(B, 'promocode'));

  console.log('\n-- A maxUses-limited code can never be redeemed more than its cap, even concurrently --');
  const carolStart = userDoc(C).walletBalance, daveStart = userDoc(D).walletBalance;
  // carol takes the 2nd (and final) legitimate use; dave's concurrent attempt on
  // the SAME already-nearly-exhausted code must lose the race cleanly.
  const [rc, rd] = await Promise.all([
    call('POST', '/redeem', { token: 'uid:' + C, body: { code: 'SWEET1' } }),
    call('POST', '/redeem', { token: 'uid:' + D, body: { code: 'SWEET1' } }),
  ]);
  const codeSuccesses = [rc, rd].filter(x => x.body?.status === 'success').length;
  check('exactly ONE of the two concurrent redemptions succeeds (cap=2, already used once)', codeSuccesses === 1, { rc: rc.body, rd: rd.body });
  const totalCredited = (userDoc(C).walletBalance - carolStart) + (userDoc(D).walletBalance - daveStart);
  check('exactly 5000 credited total across both concurrent attempts (never both)', totalCredited === 5000, totalCredited);
  const finalCode = promoCodes().get('code-1');
  check('usedBy never exceeds maxUses (2)', finalCode.usedBy.length === 2, finalCode.usedBy);

  console.log('\n-- A 3rd redemption attempt after the cap is reached is rejected --');
  const E = 'erin-uid';
  r = await call('POST', '/account/create-profile', { token: 'uid:' + E, body: { phone: '0772000010' } });
  r = await call('POST', '/register', { token: 'uid:' + E, body: {} });
  const erinStart = userDoc(E).walletBalance;
  r = await call('POST', '/redeem', { token: 'uid:' + E, body: { code: 'SWEET1' } });
  check('redemption after cap reached is rejected', r.code === 400 && /limit/i.test(r.body?.message || ''), r.body);
  check('erin wallet unchanged', userDoc(E).walletBalance === erinStart, userDoc(E).walletBalance);

  console.log('\n-- Inactive / nonexistent codes are rejected, no credit --');
  promoCodes().set('code-2', { code: 'DEAD1', reward: 99999, active: false, maxUses: 0, usedBy: [] });
  const fStart = userDoc(E).walletBalance;
  r = await call('POST', '/redeem', { token: 'uid:' + E, body: { code: 'DEAD1' } });
  check('inactive code rejected', r.code === 400, r.body);
  r = await call('POST', '/redeem', { token: 'uid:' + E, body: { code: 'GHOSTCODE' } });
  check('nonexistent code rejected', r.code === 400, r.body);
  check('wallet unchanged after both rejections', userDoc(E).walletBalance === fStart, userDoc(E).walletBalance);

  console.log('\n-- NoSQL-injection-style payloads can never widen the match --');
  r = await call('POST', '/redeem', { token: 'uid:' + E, body: { code: { $ne: null } } });
  check('object payload as code is coerced to a harmless string and rejected, not treated as a query operator',
    r.code === 400 && !/successful|success/i.test(String(r.body?.status)), r.body);
  r = await call('POST', '/redeem', { token: 'uid:' + E, body: { code: { $regex: '.*' } } });
  check('regex-operator-shaped payload also rejected as an invalid code, never matches every doc',
    r.code === 400, r.body);
  check('wallet unchanged after both injection attempts', userDoc(E).walletBalance === fStart, userDoc(E).walletBalance);

  console.log('\n-- A banned account cannot redeem a valid code --');
  const F = 'frank-uid';
  r = await call('POST', '/account/create-profile', { token: 'uid:' + F, body: { phone: '0772000020' } });
  r = await call('POST', '/register', { token: 'uid:' + F, body: {} });
  userDoc(F).status = 'banned';
  promoCodes().set('code-3', { code: 'FRESH1', reward: 8000, active: true, maxUses: 10, usedBy: [] });
  const frankStart = userDoc(F).walletBalance;
  r = await call('POST', '/redeem', { token: 'uid:' + F, body: { code: 'FRESH1' } });
  check('banned account redeem rejected (403)', r.code === 403, r.body);
  check('banned account wallet unchanged', userDoc(F).walletBalance === frankStart, userDoc(F).walletBalance);
  const untouchedCode = promoCodes().get('code-3');
  check('code usedBy list untouched by the rejected banned attempt', untouchedCode.usedBy.length === 0, untouchedCode.usedBy);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
