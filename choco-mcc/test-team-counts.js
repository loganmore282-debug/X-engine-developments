/* CHOCOMCC TEAM-COUNT ACCURACY TEST
   Two things fixed together and verified here:

   1. /register used to only ever increment teamL1Count and teamL2Count on
      the referral chain — teamL3Count was decremented on user-delete but
      NEVER incremented anywhere, so it silently stayed 0 forever no matter
      how many real Level-3 members someone had. Fixed to mirror the
      L1/L2 pattern one hop further.

   2. /admin/users/recount used to only rebuild totalDeposited/totalEarned
      from the transaction ledger — it left teamL1/L2/L3Count untouched, so
      any account that registered before fix #1 (or drifted for any other
      reason) stayed wrong forever with no way to correct it. Fixed to also
      rebuild all three counts fresh from the live referredBy graph.

   Run: node test-team-counts.js   (exits 0 = all green)                    */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '4061';

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

const realFetch = global.fetch;
const BASE = 'http://127.0.0.1:4061';
async function call(method, p, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await realFetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (_) {}
  return { code: r.status, body: j };
}
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   - ' + name); }
  else { fail++; console.log('  FAIL - ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}
const users = () => mockdb.__store.get('users');

(async () => {
  await new Promise(r => setTimeout(r, 600));

  console.log('\n== Real /register calls build a 3-level chain: root -> a -> b -> c ==');
  await call('POST', '/account/create-profile', { token: 'uid:root', body: { phone: '0771000000' } });
  let r = await call('POST', '/register', { token: 'uid:root', body: {} });
  check('root registers', r.body?.status === 'success', r.body);
  const rootCode = r.body.referralCode;

  await call('POST', '/account/create-profile', { token: 'uid:a', body: { phone: '0771000001' } });
  r = await call('POST', '/register', { token: 'uid:a', body: { referralCode: rootCode } });
  check('a registers under root', r.body?.status === 'success', r.body);
  const aCode = r.body.referralCode;

  await call('POST', '/account/create-profile', { token: 'uid:b', body: { phone: '0771000002' } });
  r = await call('POST', '/register', { token: 'uid:b', body: { referralCode: aCode } });
  check('b registers under a', r.body?.status === 'success', r.body);
  const bCode = r.body.referralCode;

  await call('POST', '/account/create-profile', { token: 'uid:c', body: { phone: '0771000003' } });
  r = await call('POST', '/register', { token: 'uid:c', body: { referralCode: bCode } });
  check('c registers under b', r.body?.status === 'success', r.body);

  console.log('\n-- teamL1/L2/L3Count on root are correct straight out of /register (the actual fix) --');
  check('root.teamL1Count = 1 (a)', users().get('root').teamL1Count === 1, users().get('root').teamL1Count);
  check('root.teamL2Count = 1 (b)', users().get('root').teamL2Count === 1, users().get('root').teamL2Count);
  check('root.teamL3Count = 1 (c) — THIS is the field that used to never increment', users().get('root').teamL3Count === 1, users().get('root').teamL3Count);
  check('a.teamL1Count = 1 (b)', users().get('a').teamL1Count === 1, users().get('a').teamL1Count);
  check('a.teamL2Count = 1 (c)', users().get('a').teamL2Count === 1, users().get('a').teamL2Count);
  check('b.teamL1Count = 1 (c)', users().get('b').teamL1Count === 1, users().get('b').teamL1Count);

  console.log('\n-- GET /account for root reflects the same correct counts a real client would render --');
  r = await call('GET', '/account', { token: 'uid:root' });
  check('/account team.l1 = 1', r.body?.account?.team?.l1 === 1, r.body?.account?.team);
  check('/account team.l2 = 1', r.body?.account?.team?.l2 === 1, r.body?.account?.team);
  check('/account team.l3 = 1', r.body?.account?.team?.l3 === 1, r.body?.account?.team);

  console.log('\n== Corrupt the counts (simulating pre-fix accounts / drift), then recount ==');
  users().get('root').teamL1Count = 99;
  users().get('root').teamL2Count = 99;
  users().get('root').teamL3Count = 99;
  users().get('a').teamL2Count = 0;

  r = await call('GET', '/admin/users/recount', { token: 'test-admin-key' });
  check('recount succeeds', r.body?.status === 'success', r.body);
  check('root.teamL1Count rebuilt to 1', users().get('root').teamL1Count === 1, users().get('root').teamL1Count);
  check('root.teamL2Count rebuilt to 1', users().get('root').teamL2Count === 1, users().get('root').teamL2Count);
  check('root.teamL3Count rebuilt to 1 (recovers accounts that predate the /register fix)', users().get('root').teamL3Count === 1, users().get('root').teamL3Count);
  check('a.teamL2Count rebuilt to 1', users().get('a').teamL2Count === 1, users().get('a').teamL2Count);
  check('c.teamL1/L2/L3Count all 0 (leaf, no downstream team)',
    users().get('c').teamL1Count === 0 && users().get('c').teamL2Count === 0 && users().get('c').teamL3Count === 0,
    { l1: users().get('c').teamL1Count, l2: users().get('c').teamL2Count, l3: users().get('c').teamL3Count });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
