/* SPACE8 REFERRAL CODE FORMAT & SECURITY TEST
   Owner (2026-08-18): "let the referral code be not capital letters, it
   should be mixed, plus also should be 5 characters, also it should be
   globally recognized by server, unique globally, accurate, encrypted,
   safeguarded, and secured... there might be a same similarity, one can
   put a referral code as gift code, so let it be referral code of 6
   characters to avoid such, check and recheck." Final spec, confirmed by
   the owner's own correction mid-message: 6 characters, mixed case, never
   the same shape as a 5-character gift code.

   Boots the REAL server.js against an in-memory mock database (Firebase
   auth stubbed) and proves, over real HTTP:
     - a freshly generated referral code is exactly 6 characters, drawn
       only from the unambiguous mixed-case alphabet (no I/l/O/0/1), and
       genuinely mixed case across a real sample (not silently still
       all-caps)
     - a batch of real registrations never produces two referral codes
       that are identical even case-insensitively (the collision the
       owner is worried about, proven directly against the real
       generation path, not a reimplementation)
     - referral codes (6 chars) and gift codes (5 chars) can never be
       mistaken for each other by LENGTH alone, on top of already living
       in separate database collections entirely
     - redemption is CASE-SENSITIVE, same established philosophy this
       codebase already uses for gift codes: the exact code, typed with
       the exact case it was issued in, is required -- a case-flipped
       variant of a real code is rejected as BAD_REFERRAL, not silently
       normalized and accepted
     - a LEGACY (pre-2026-08-18, all-caps, no referralCodeLower field)
       referral code still works exactly as before -- this is a live app
       with real users holding real, already-shared old-format codes, and
       nothing here may break them
     - a case-flipped variant of a legacy all-caps code is ALSO rejected
       (proves the matching logic didn't just happen to work because old
       codes are already uppercase -- it's a real exact-match check)

   Run: node test-referral-code-format.js   (exits 0 = all green)         */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '4303';

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

const BASE = 'http://127.0.0.1:4303';
async function call(method, p, { token, adminKey, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (adminKey) headers.Authorization = 'Bearer ' + adminKey;
  const r = await fetch(BASE + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (_) {}
  return { code: r.status, body: j };
}
async function ownerCall(path, body) { return call('POST', path, { adminKey: 'test-admin-key', body: body || {} }); }
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
const userDoc = id => users().get(id);

async function registerFully(uid, phone, referralCode) {
  await call('POST', '/account/create-profile', { token: 'uid:' + uid, body: { phone } });
  return call('POST', '/register', { token: 'uid:' + uid, body: referralCode !== undefined ? { referralCode } : {} });
}

const UNAMBIGUOUS_MIXED_RE = /^[A-HJ-NP-Za-hj-np-z2-9]{6}$/;
const flipCase = s => [...s].map(c => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase())).join('');

(async () => {
  await sleep(600);

  console.log('\n== A freshly generated referral code is 6 chars, unambiguous alphabet, genuinely mixed case ==');
  const seed = await registerFully('rc-seed', '0771970001');
  const seedCode = seed.body.referralCode;
  check('registration succeeded', seed.body?.status === 'success', seed.body);
  check('code is exactly 6 chars from the unambiguous mixed-case alphabet', UNAMBIGUOUS_MIXED_RE.test(seedCode || ''), seedCode);

  console.log('\n== Across a real batch, codes are genuinely mixed case (not silently still all-caps) and never collide, even case-insensitively ==');
  // Kept modest (not larger) -- every call in this file shares ONE
  // rate-limit bucket, since the fake 'uid:xxx' tokens this test suite
  // uses don't parse as a real JWT, so rlKeyByUser() falls back to keying
  // by IP for every request in this process (same documented gotcha as
  // every other test-*.js file here). 2 calls per registered account
  // (create-profile + register) plus ~10 more calls elsewhere in this
  // file stays comfortably under the real 60/min apiLimiter cap.
  const N = 20;
  const batchUids = Array.from({ length: N }, (_, i) => 'rc-batch-' + i);
  for (const uid of batchUids) {
    await call('POST', '/account/create-profile', { token: 'uid:' + uid, body: { phone: '07719701' + String(batchUids.indexOf(uid)).padStart(2, '0') } });
  }
  const batchResults = [];
  for (const uid of batchUids) batchResults.push((await call('POST', '/register', { token: 'uid:' + uid, body: {} })).body);
  check('all registrations in the batch succeeded', batchResults.every(b => b?.status === 'success'), batchResults);
  const codes = batchResults.map(b => b.referralCode);
  check('every code is 6 chars from the unambiguous mixed-case alphabet', codes.every(c => UNAMBIGUOUS_MIXED_RE.test(c || '')), codes);
  const hasLower = codes.some(c => /[a-z]/.test(c));
  const hasUpper = codes.some(c => /[A-Z]/.test(c));
  check('the batch genuinely contains both lowercase AND uppercase letters across different codes (not just capitals)', hasLower && hasUpper, { hasLower, hasUpper, sample: codes.slice(0, 8) });
  check('no two codes in the batch are identical', new Set(codes).size === codes.length, codes);
  check('no two codes in the batch collide even case-insensitively (the exact ambiguity the owner flagged)', new Set(codes.map(c => c.toLowerCase())).size === codes.length, codes);

  console.log('\n== Referral codes (6 chars) can never be mistaken for a gift code (5 chars) by shape alone ==');
  const giftGen = await ownerCall('/admin/promocodes/generate', { minAmount: 1000, maxAmount: 2000, count: 1, maxUses: 1 });
  const giftCode = giftGen.body?.codes?.[0]?.code;
  check('gift code generation succeeded', giftGen.body?.status === 'success' && !!giftCode, giftGen.body);
  check('gift code is exactly 5 characters', giftCode.length === 5, giftCode);
  check('referral code is exactly 6 characters -- structurally distinct lengths, same alphabet', seedCode.length === 6 && seedCode.length !== giftCode.length, { seedCode, giftCode });

  console.log('\n== Redemption is case-sensitive: the exact code works, a case-flipped variant is rejected ==');
  let r = await registerFully('rc-exact', '0771970101', seedCode);
  check('registering with the EXACT issued code (correct case) succeeds', r.body?.status === 'success', r.body);
  check('referredBy correctly set to the seed account', userDoc('rc-exact')?.referredBy === 'rc-seed', userDoc('rc-exact'));

  const flipped = flipCase(seedCode);
  check('sanity: the flipped variant is actually a different string', flipped !== seedCode, { seedCode, flipped });
  r = await registerFully('rc-flipped', '0771970102', flipped);
  check('registering with a CASE-FLIPPED variant of a real code is rejected (BAD_REFERRAL, not silently accepted)', r.code === 400 && r.body?.code === 'BAD_REFERRAL', r.body);
  check('the rejected attempt did not attach any referrer', !userDoc('rc-flipped')?.referredBy, userDoc('rc-flipped'));

  console.log('\n== A LEGACY (pre-mixed-case, all-caps) referral code still works exactly as before ==');
  // Seeds a user doc shaped exactly like one created before this change --
  // an all-caps code with no referralCodeLower field at all, proving old
  // real codes already shared with real members keep working.
  users().set('rc-legacy-referrer', {
    phone: '0771970200', referralCode: 'ABCD9X', walletBalance: 0, totalDeposited: 0, totalInvested: 0,
    totalWithdrawn: 0, totalEarned: 0, teamCommission: 0, teamL1Count: 0, teamL2Count: 0, teamL3Count: 0,
    status: 'active', registrationDone: true, checkinStreak: 0, publicId: '900001', createdAt: new Date(),
  });
  r = await registerFully('rc-legacy-child', '0771970201', 'ABCD9X');
  check('registering with the exact legacy all-caps code succeeds', r.body?.status === 'success', r.body);
  check('referredBy correctly set to the legacy account', userDoc('rc-legacy-child')?.referredBy === 'rc-legacy-referrer', userDoc('rc-legacy-child'));

  r = await registerFully('rc-legacy-flipped', '0771970202', 'abcd9x');
  check('a case-flipped variant of the legacy code is ALSO rejected -- real exact-match, not luck', r.code === 400 && r.body?.code === 'BAD_REFERRAL', r.body);
  check('the rejected legacy-flip attempt did not attach any referrer', !userDoc('rc-legacy-flipped')?.referredBy, userDoc('rc-legacy-flipped'));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
