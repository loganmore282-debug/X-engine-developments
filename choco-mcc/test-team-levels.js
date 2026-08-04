/* CHOCOMCC TEAM LEVEL MEMBERS TEST
   Boots the REAL server.js against an in-memory mock database and proves
   /team/members?level=1|2|3 correctly walks the live referredBy graph one
   hop at a time (never a stored/spoofable "level" field), defaults to
   level 1 for backward compatibility, and returns nothing for a level with
   no one in it rather than erroring.

   Level 2/3 lists are, and remain, fully viewable through this endpoint --
   the owner only asked to mask the raw COUNT digit shown on the Team
   overview screen for those two levels (a display-only change in
   index.html/original_module.js), never to block browsing the actual
   member lists. That's covered by this same test unchanged.

   Run: node test-team-levels.js   (exits 0 = all green)                   */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '4060';

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
const BASE = 'http://127.0.0.1:4060';
async function call(method, p, { token } = {}) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await realFetch(BASE + p, { method, headers });
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

(async () => {
  await new Promise(r => setTimeout(r, 600));

  // Build: root -> {a1, a2} (L1) -> a1 -> {b1, b2} (L2), a2 -> {b3} (L2)
  //        -> b1 -> {c1} (L3), b3 -> {c2} (L3)
  const users = collMap('users');
  const mk = (id, phone, referredBy) => users.set(id, { phone, referredBy: referredBy || null, totalInvested: 0, totalDeposited: 0, createdAt: new Date() });
  mk('root', '0771000000', null);
  mk('a1', '0771000001', 'root');
  mk('a2', '0771000002', 'root');
  mk('b1', '0771000011', 'a1');
  mk('b2', '0771000012', 'a1');
  mk('b3', '0771000013', 'a2');
  mk('c1', '0771000021', 'b1');
  mk('c2', '0771000022', 'b3');

  console.log('\n== Level 1 (direct referrals) ==');
  let r = await call('GET', '/team/members', { token: 'uid:root' });
  check('level 1 returns root\'s 2 direct referrals', r.body?.members?.length === 2, r.body);
  check('level defaults to 1 when omitted', r.body?.level === 1, r.body?.level);
  let ids = (r.body.members || []).map(m => m.id).sort();
  check('level 1 members are exactly a1, a2', JSON.stringify(ids) === JSON.stringify(['a1', 'a2']), ids);

  console.log('\n== Level 2 (referrals of referrals) ==');
  r = await call('GET', '/team/members?level=2', { token: 'uid:root' });
  check('level 2 returns 3 members (b1, b2 via a1; b3 via a2)', r.body?.members?.length === 3, r.body);
  ids = (r.body.members || []).map(m => m.id).sort();
  check('level 2 members are exactly b1, b2, b3', JSON.stringify(ids) === JSON.stringify(['b1', 'b2', 'b3']), ids);

  console.log('\n== Level 3 ==');
  r = await call('GET', '/team/members?level=3', { token: 'uid:root' });
  check('level 3 returns 2 members (c1 via b1, c2 via b3)', r.body?.members?.length === 2, r.body);
  ids = (r.body.members || []).map(m => m.id).sort();
  check('level 3 members are exactly c1, c2', JSON.stringify(ids) === JSON.stringify(['c1', 'c2']), ids);

  console.log('\n-- A leaf user with no downstream team gets an empty list, not an error --');
  r = await call('GET', '/team/members?level=1', { token: 'uid:c1' });
  check('leaf user level 1 succeeds with an empty list', r.body?.status === 'success' && r.body.members.length === 0, r.body);
  r = await call('GET', '/team/members?level=3', { token: 'uid:c1' });
  check('leaf user level 3 also succeeds with an empty list (no crash walking past the end of the chain)', r.body?.status === 'success' && r.body.members.length === 0, r.body);

  console.log('\n-- Out-of-range level is clamped, not rejected --');
  r = await call('GET', '/team/members?level=99', { token: 'uid:root' });
  check('level clamped to 3 for an absurd input', r.body?.level === 3, r.body?.level);
  r = await call('GET', '/team/members?level=0', { token: 'uid:root' });
  check('level clamped to 1 for a zero/invalid input', r.body?.level === 1, r.body?.level);

  console.log('\n-- Unauthenticated request is rejected --');
  r = await call('GET', '/team/members');
  check('no token -> 401', r.code === 401, r.body);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
