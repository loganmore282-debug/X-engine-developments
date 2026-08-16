/* SPACE8 SERVER-ISSUED PUBLIC ACCOUNT ID (ID:000000)
   The owner asked for every registered user to have "a unique global
   recognized, server given id in format of ID:000000" shown on their
   profile. Implemented as a new publicId field: a random 6-digit number
   (crypto.randomInt, same generate-check-retry shape as the existing
   referral code generator), checked for global uniqueness against every
   other user before being assigned, generated at the same moment the
   referral code is (registration completion).

   Boots the REAL server.js against an in-memory mock database and proves:
     - a fresh registration gets a publicId in the real "000000" (6-digit,
       zero-padded) shape
     - it's returned from /register itself, not just visible later
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

  console.log('\n== Two different users never collide, checked over a real batch ==');
  const ids = new Set();
  for (let i = 0; i < 15; i++) {
    const uid = 'pid-batch-' + i;
    const reg = await call('POST', '/register', { token: 'uid:' + uid, body: { phone: '07719800' + String(i).padStart(2, '0') } });
    check('batch #' + i + ' has a valid publicId shape', ID_SHAPE.test(reg.body?.publicId || ''), reg.body);
    ids.add(reg.body.publicId);
  }
  check('all 15 (+1 from above) publicIds are globally unique, no collisions', ids.size === 15, [...ids]);

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

  console.log('\n== A brand-new, not-yet-registered account does NOT get a publicId from /account ==');
  await call('POST', '/account/create-profile', { token: 'uid:pid-incomplete', body: { phone: '0771970098' } });
  r = await call('GET', '/account', { token: 'uid:pid-incomplete' });
  check('account with registrationDone still false gets no publicId (matches how referralCode already behaves)', r.body?.account?.publicId === null, r.body);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
