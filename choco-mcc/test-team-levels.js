/* CHOCOMCC TEAM LEVEL MEMBERS TEST
   Boots the REAL server.js against an in-memory mock database and proves
   /team/members correctly walks the live referredBy graph one hop at a time
   (never a stored/spoofable "level" field) for a member's own direct
   (Level 1) referrals, defaults to level 1 when omitted, and returns
   nothing for a leaf account with no downstream team rather than erroring.

   Per owner request: Level 2 and Level 3 member LISTS are no longer
   browsable at all -- only Level 1 (direct referrals) can ever be viewed,
   by anyone, through any client. Deeper levels stay commission-only (the
   rate and the running earned total are still shown elsewhere; the list of
   WHO is in them is not). This is enforced server-side, not just left off
   the UI, so a raw ?level=2/3 API call is rejected exactly like the app
   itself would never even attempt one.

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

  console.log('\n== Level 1 (direct referrals) -- the only level anyone can ever browse ==');
  let r = await call('GET', '/team/members', { token: 'uid:root' });
  check('level 1 returns root\'s 2 direct referrals', r.body?.members?.length === 2, r.body);
  check('level defaults to 1 when omitted', r.body?.level === 1, r.body?.level);
  let ids = (r.body.members || []).map(m => m.id).sort();
  check('level 1 members are exactly a1, a2', JSON.stringify(ids) === JSON.stringify(['a1', 'a2']), ids);
  r = await call('GET', '/team/members?level=1', { token: 'uid:root' });
  check('explicit level=1 works the same as omitting it', r.body?.status === 'success' && r.body.members.length === 2, r.body);

  console.log('\n== Level 2 and Level 3 member lists are rejected outright, not walked at all ==');
  r = await call('GET', '/team/members?level=2', { token: 'uid:root' });
  check('level=2 is refused (403), not silently clamped or answered', r.code === 403, r.body);
  check('...with no member data leaked in the response', !r.body?.members, r.body);
  r = await call('GET', '/team/members?level=3', { token: 'uid:root' });
  check('level=3 is refused (403) too', r.code === 403, r.body);
  r = await call('GET', '/team/members?level=3', { token: 'uid:c1' });
  check('rejected the same way even for an account with no team at all (not level-dependent on having data)', r.code === 403, r.body);

  console.log('\n-- A leaf user with no downstream team still gets an empty Level 1 list, not an error --');
  r = await call('GET', '/team/members?level=1', { token: 'uid:c1' });
  check('leaf user level 1 succeeds with an empty list', r.body?.status === 'success' && r.body.members.length === 0, r.body);

  console.log('\n-- Any level other than exactly 1 is rejected, including nonsense input --');
  r = await call('GET', '/team/members?level=99', { token: 'uid:root' });
  check('absurd level input is rejected (not silently clamped into range)', r.code === 403, r.body);
  r = await call('GET', '/team/members?level=0', { token: 'uid:root' });
  check('level=0 falls back to the level-1 default (parseInt(...)||1) and succeeds', r.body?.status === 'success' && r.body.level === 1, r.body);

  console.log('\n-- Unauthenticated request is rejected --');
  r = await call('GET', '/team/members');
  check('no token -> 401', r.code === 401, r.body);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
