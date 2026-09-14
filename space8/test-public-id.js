/* SPACE8 SERVER-ISSUED PUBLIC ACCOUNT ID (ID:000000)
   The owner asked for every registered user to have "a unique global
   recognized, server given id in format of ID:000000" shown on their
   profile. Originally a random 6-digit number; changed 2026-08-16 to
   SEQUENTIAL ("new accounts only: sequential IDs 000001, 000002, etc.
   Existing account IDs remain unchanged") -- a single shared counter doc,
   read-increment-write serialized through one lock (nextSequentialPublicId()
   in server.js), generated at the same moment the referral code is
   (registration completion), with a uniqueness check-and-skip as a safety
   net against colliding with an account that still holds one of the
   original random ids.

   Boots the REAL server.js against an in-memory mock database and proves:
     - a fresh registration gets a publicId in the real "000000" (6-digit,
       zero-padded) shape
     - it's returned from /register itself, not just visible later
     - a run of consecutive registrations gets STRICTLY INCREASING,
       CONTIGUOUS ids (not just "unique", the actual sequential requirement)
     - two different users never collide (checked over a real batch, not
       just eyeballing two IDs)
     - an account that registered BEFORE this feature existed (no publicId
       on its doc at all, matching every real pre-existing account) gets
       one lazily assigned the next time GET /account reads it -- and it
       stays the SAME value on every subsequent read, it doesn't keep
       reassigning
     - a brand-new, not-yet-registered account (registrationDone still
       false) does NOT get a publicId from /account -- only a completed
       registration ever gets one, matching how referralCode already works

   Run: node test-public-id.js   (exits 0 = all green)                    */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '4160';

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

const BASE = 'http://127.0.0.1:4160';
async function call(method, p, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await fetch(BASE + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
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
const userDoc = id => collMap('users').get(id);
const ID_SHAPE = /^\d{6}$/;

(async () => {
  await sleep(600);

  console.log('\n== A fresh registration gets a real 6-digit publicId ==');
  let r = await call('POST', '/register', { token: 'uid:pid-fresh', body: { phone: '0771970001' } });
  check('registration succeeds', r.body?.status === 'success', r.body);
  check('/register itself returns a publicId in the right shape', ID_SHAPE.test(r.body?.publicId || ''), r.body);
  check('the same id landed on the stored doc', userDoc('pid-fresh')?.publicId === r.body.publicId, userDoc('pid-fresh'));
  const sequence = [r.body.publicId];

  console.log('\n== A run of consecutive registrations gets STRICTLY SEQUENTIAL ids, not just unique ones ==');
  const ids = new Set(sequence);
  for (let i = 0; i < 15; i++) {
    const uid = 'pid-batch-' + i;
    const reg = await call('POST', '/register', { token: 'uid:' + uid, body: { phone: '07719800' + String(i).padStart(2, '0') } });
    check('batch #' + i + ' has a valid publicId shape', ID_SHAPE.test(reg.body?.publicId || ''), reg.body);
    ids.add(reg.body.publicId);
    sequence.push(reg.body.publicId);
  }
  check('all 15 (+1 from above) publicIds are globally unique, no collisions', ids.size === 15 + 1, [...ids]);
  const contiguous = sequence.every((id, i) => i === 0 || parseInt(id, 10) === parseInt(sequence[i - 1], 10) + 1);
  check('the whole run is CONTIGUOUS -- each id is exactly one more than the previous (the actual "sequential" requirement, not just "unique")', contiguous, sequence);

  console.log('\n== An account that registered BEFORE this feature existed self-heals on read ==');
  // Simulate exactly what every real pre-existing account looks like:
  // fully registered, but with no publicId field at all on the doc.
  collMap('users').set('pid-legacy', {
    phone: '+256771970099', walletBalance: 0, totalDeposited: 0, totalEarned: 0, totalWithdrawn: 0, totalInvested: 0,
    checkinStreak: 0, lastCheckin: null, teamL1Count: 0, teamL2Count: 0, teamL3Count: 0, teamCommission: 0,
    referredBy: null, referralCode: 'LEGACY1', registrationDone: true, status: 'active', createdAt: new Date()
  });
  check('sanity: no publicId on the legacy doc yet', !userDoc('pid-legacy').publicId, userDoc('pid-legacy'));
  r = await call('GET', '/account', { token: 'uid:pid-legacy' });
  check('/account succeeds', r.body?.status === 'success', r.body);
  check('a real publicId was self-healed onto the response', ID_SHAPE.test(r.body?.account?.publicId || ''), r.body);
  check('it was actually persisted onto the doc, not just returned once', ID_SHAPE.test(userDoc('pid-legacy')?.publicId || ''), userDoc('pid-legacy'));
  const healedId = r.body.account.publicId;

  console.log('\n-- Reading /account again returns the SAME id, doesn\'t keep reassigning --');
  r = await call('GET', '/account', { token: 'uid:pid-legacy' });
  check('second read returns the identical publicId', r.body?.account?.publicId === healedId, { first: healedId, second: r.body?.account?.publicId });

  console.log('\n== The counter skips past a value already held by a legacy RANDOM-id account (never overwrites it) ==');
  const counterDoc = () => collMap('counters').get('publicId');
  const nextValue = String((counterDoc() && counterDoc().next) || 1).padStart(6, '0');
  // Plant a fake pre-existing account squatting on exactly the value the
  // counter is about to hand out next -- simulating one of the original
  // RANDOM ids from before this feature switched to sequential.
  collMap('users').set('pid-squatter', {
    phone: '+256771970098', walletBalance: 0, totalDeposited: 0, totalEarned: 0, totalWithdrawn: 0, totalInvested: 0,
    checkinStreak: 0, lastCheckin: null, teamL1Count: 0, teamL2Count: 0, teamL3Count: 0, teamCommission: 0,
    referredBy: null, referralCode: 'SQUAT01', registrationDone: true, status: 'active', publicId: nextValue, createdAt: new Date()
  });
  r = await call('POST', '/register', { token: 'uid:pid-skip-test', body: { phone: '0771970097' } });
  check('registration past the collision still succeeds', r.body?.status === 'success', r.body);
  check('the new account did NOT get the squatted value', r.body?.publicId !== nextValue, { squatted: nextValue, got: r.body?.publicId });
  check('the squatter\'s own id is completely untouched', userDoc('pid-squatter')?.publicId === nextValue, userDoc('pid-squatter'));
  check('the new account still got a valid, properly-shaped id despite the skip', ID_SHAPE.test(r.body?.publicId || ''), r.body);

  console.log('\n== A brand-new, not-yet-registered account does NOT get a publicId from /account ==');
  await call('POST', '/account/create-profile', { token: 'uid:pid-incomplete', body: { phone: '0771970098' } });
  r = await call('GET', '/account', { token: 'uid:pid-incomplete' });
  check('account with registrationDone still false gets no publicId (matches how referralCode already behaves)', r.body?.account?.publicId === null, r.body);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
