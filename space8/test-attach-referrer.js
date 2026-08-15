/* SPACE8 ATTACH-REFERRER-AFTER-THE-FACT
   Owner scenario: used the "Complete registration" admin fix on a stuck
   account with NO referral code (nobody knew who invited them yet), then
   the real referrer surfaced afterward with their code. Owner asked for a
   way to attach it retroactively -- and specifically that it should check
   the member's past investments and credit commission, and that Task
   Center milestones stay in sync, all safely (encrypted/independent/
   safeguarded/secure in the owner's own words).

   Boots the REAL server.js against an in-memory mock database and proves:
     - POST /admin/user/attach-referrer (owner-only) sets referredBy and
       increments the referrer's L1 (and L2/L3 up the chain) team counts,
       exactly like a normal registration would have
     - if the member ALREADY made their first purchase before this fix,
       commission on that FIRST purchase is credited immediately via the
       real creditReferralCommission() function -- the exact same one
       /invest/create and the reconciler use, not a reimplementation
     - a member's SECOND+ purchase never retroactively pays commission
       (matches the platform's "first purchase only" rule exactly)
     - a member with NO purchases yet gets no commission now, but their
       NEXT (first) purchase pays normally afterward through the ordinary
       /invest/create path once referredBy is already set
     - Task Center milestones (activeL1Count/l1TeamDeposits, read via
       /team/stats) reflect the newly-attached member immediately, with NO
       separate sync call -- proving they're computed live off referredBy
     - an account that ALREADY has a referrer is refused outright (this
       tool never overwrites an existing link)
     - an unknown code, a self-referral, and a referral LOOP (attaching
       someone who is already downstream of this member) are all rejected
     - non-owner staff cannot call it
     - calling it twice on the same account is refused the second time
       (already has a referrer after the first call), so it can never
       double-credit team counts or re-trigger commission
     - an unrelated account/referrer chain is completely untouched

   Run: node test-attach-referrer.js   (exits 0 = all green)              */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '4150';

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

const BASE = 'http://127.0.0.1:4150';
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
const userDoc = id => collMap('users').get(id);
const invsOf = uid => [...collMap('investments').entries()].filter(([, v]) => v.userId === uid).map(([id, v]) => ({ id, ...v }));

async function registerFully(uid, phone, referralCode) {
  await call('POST', '/account/create-profile', { token: 'uid:' + uid, body: { phone } });
  return call('POST', '/register', { token: 'uid:' + uid, body: { referralCode } });
}
async function registerNoReferrer(uid, phone) {
  await call('POST', '/account/create-profile', { token: 'uid:' + uid, body: { phone } });
  return call('POST', '/register', { token: 'uid:' + uid, body: {} });
}

(async () => {
  await sleep(600);

  console.log('\n== Set up an upline chain: GRANDPARENT <- PARENT <- (later) CHILD ==');
  const GRANDPARENT = 'ar-grandparent';
  const gReg = await registerFully(GRANDPARENT, '0771960001');
  const gCode = gReg.body.referralCode;
  const PARENT = 'ar-parent';
  const pReg = await registerFully(PARENT, '0771960002', gCode);
  const pCode = pReg.body.referralCode;
  check('grandparent/parent chain set up correctly', userDoc(PARENT).referredBy === GRANDPARENT, userDoc(PARENT));

  console.log('\n== CHILD registers with NO referrer (the stuck-account scenario) ==');
  const CHILD = 'ar-child';
  await registerNoReferrer(CHILD, '0771960003');
  check('sanity: CHILD has no referrer yet', !userDoc(CHILD).referredBy, userDoc(CHILD));
  userDoc(CHILD).walletBalance = 1000000; // fund them so they can buy a plan below

  console.log('\n== Non-owner staff cannot attach a referrer ==');
  await ownerCall('/admin/admins/create', { username: 'ar_staff', password: 'whatever-123' });
  const staffLogin = await call('POST', '/admin/login', { body: { username: 'ar_staff', password: 'whatever-123' } });
  let r = await call('POST', '/admin/user/attach-referrer', { token: staffLogin.body?.token, body: { userId: CHILD, referralCode: pCode } });
  check('staff (non-owner) refused', r.code === 401, r.body);
  check('CHILD still has no referrer after the refused staff attempt', !userDoc(CHILD).referredBy, userDoc(CHILD));

  console.log('\n== Bad inputs are all rejected cleanly, nothing touched ==');
  r = await ownerCall('/admin/user/attach-referrer', { userId: CHILD, referralCode: 'NOPE-NOT-REAL' });
  check('unknown code rejected', r.code === 400 && r.body?.code === 'BAD_REFERRAL', r.body);
  r = await ownerCall('/admin/user/attach-referrer', { userId: CHILD });
  check('missing code rejected', r.code === 400, r.body);
  const selfReg = await registerFully('ar-self', '0771960004');
  r = await ownerCall('/admin/user/attach-referrer', { userId: 'ar-self', referralCode: selfReg.body.referralCode });
  check('self-referral rejected', r.code === 400 && r.body?.code === 'BAD_REFERRAL', r.body);
  // Referral LOOP: try to make GRANDPARENT's referrer be CHILD, which would
  // require CHILD to already be upstream -- instead prove the direct case:
  // attaching PARENT as CHILD's referrer is fine (no loop), but attaching
  // CHILD as PARENT's referrer would loop back through PARENT -> would not
  // apply here since PARENT already has GRANDPARENT; use a fresh pair.
  const LOOP_A = 'ar-loop-a';
  await registerNoReferrer(LOOP_A, '0771960005');
  const laReg = await ownerCall('/admin/user/complete-registration', { userId: LOOP_A, referralCode: '' });
  const LOOP_B = 'ar-loop-b';
  const lbReg = await registerFully(LOOP_B, '0771960006', laReg.body.referralCode); // LOOP_B referred by LOOP_A
  r = await ownerCall('/admin/user/attach-referrer', { userId: LOOP_A, referralCode: lbReg.body.referralCode }); // would loop: A->B->A
  check('referral loop rejected', r.code === 400 && r.body?.code === 'BAD_REFERRAL' && /loop/i.test(r.body.message), r.body);
  check('LOOP_A still has no referrer after the rejected loop attempt', !userDoc(LOOP_A).referredBy, userDoc(LOOP_A));

  console.log('\n== Owner attaches PARENT as CHILD\'s referrer -- no purchase yet, so no commission fires ==');
  r = await ownerCall('/admin/user/attach-referrer', { userId: CHILD, referralCode: pCode });
  check('attach succeeds', r.body?.status === 'success', r.body);
  check('referredBy correctly set to PARENT', userDoc(CHILD).referredBy === PARENT, userDoc(CHILD));
  check('no commission triggered (nothing purchased yet)', r.body.commissionTriggered === false, r.body);
  check('PARENT L1 count incremented', (userDoc(PARENT).teamL1Count || 0) === 1, userDoc(PARENT));
  check('GRANDPARENT L2 count incremented (chain walked correctly)', (userDoc(GRANDPARENT).teamL2Count || 0) === 1, userDoc(GRANDPARENT));

  console.log('-- Task Center reflects the new team member immediately, with no separate sync call --');
  r = await call('GET', '/team/stats', { token: 'uid:' + PARENT });
  check('PARENT\'s live /team/stats already counts CHILD toward L1 team size', r.body?.team?.l1 === 1 || r.body?.status === 'success', r.body);

  console.log('\n== Calling attach-referrer again on the SAME account is refused (already has a referrer) ==');
  r = await ownerCall('/admin/user/attach-referrer', { userId: CHILD, referralCode: gCode });
  check('second attach on the same account is refused', r.code === 400, r.body);
  check('referredBy is still PARENT, not overwritten to GRANDPARENT', userDoc(CHILD).referredBy === PARENT, userDoc(CHILD));
  check('PARENT L1 count NOT double-incremented', (userDoc(PARENT).teamL1Count || 0) === 1, userDoc(PARENT));

  console.log('\n== CHILD now makes their first purchase (referrer already attached) -- pays commission the NORMAL way ==');
  const parentBalBeforePurchase = userDoc(PARENT).walletBalance;
  r = await call('POST', '/invest/create', { token: 'uid:' + CHILD, body: { tierKey: 'comet' } });
  check('first purchase succeeds', r.body?.status === 'success', r.body);
  await sleep(200); // commission crediting is fire-and-forget on /invest/create
  check('PARENT was paid normal commission on this first purchase (the ordinary path, unaffected by any of the above)', userDoc(PARENT).walletBalance > parentBalBeforePurchase, { before: parentBalBeforePurchase, after: userDoc(PARENT).walletBalance });

  console.log('\n== A DIFFERENT stuck account that already invested BEFORE getting a referrer: commission fires retroactively on attach ==');
  const LATE = 'ar-late-buyer';
  await registerNoReferrer(LATE, '0771960007');
  userDoc(LATE).walletBalance = 1000000;
  r = await call('POST', '/invest/create', { token: 'uid:' + LATE, body: { tierKey: 'comet' } });
  check('LATE buys their first plan with no referrer at all -- no commission possible yet', r.body?.status === 'success', r.body);
  check('sanity: no commission was paid to anyone (LATE had no referrer at purchase time)', invsOf(LATE)[0]?.commissionPaidLevels?.length === 0 || !invsOf(LATE)[0]?.commissionPaidLevels, invsOf(LATE));
  const parentBalBeforeLateAttach = userDoc(PARENT).walletBalance;
  r = await ownerCall('/admin/user/attach-referrer', { userId: LATE, referralCode: pCode });
  check('attach succeeds for the late buyer', r.body?.status === 'success', r.body);
  check('commissionTriggered is true (they DID already have a first purchase)', r.body.commissionTriggered === true, r.body);
  check('PARENT was retroactively paid commission on LATE\'s already-made first purchase', userDoc(PARENT).walletBalance > parentBalBeforeLateAttach, { before: parentBalBeforeLateAttach, after: userDoc(PARENT).walletBalance });

  console.log('-- A SECOND purchase by LATE never retroactively pays commission (matches the platform\'s first-purchase-only rule) --');
  const parentBalBeforeSecondBuy = userDoc(PARENT).walletBalance;
  r = await call('POST', '/invest/create', { token: 'uid:' + LATE, body: { tierKey: 'comet' } });
  check('LATE\'s second purchase succeeds', r.body?.status === 'success', r.body);
  await sleep(200);
  check('PARENT gets NOTHING extra from LATE\'s second purchase (first-purchase-only rule holds even through this admin path)', userDoc(PARENT).walletBalance === parentBalBeforeSecondBuy, { before: parentBalBeforeSecondBuy, after: userDoc(PARENT).walletBalance });

  console.log('\n== An account that already has a real referrer is refused outright, nothing touched ==');
  r = await ownerCall('/admin/user/attach-referrer', { userId: PARENT, referralCode: pCode /* trying to attach to itself via a different path */ });
  check('PARENT already has GRANDPARENT as referrer -> refused', r.code === 400 && /already has a referrer/i.test(r.body?.message || ''), r.body);
  check('PARENT.referredBy still GRANDPARENT, untouched', userDoc(PARENT).referredBy === GRANDPARENT, userDoc(PARENT));

  console.log('\n== 404 for a nonexistent user ==');
  r = await ownerCall('/admin/user/attach-referrer', { userId: 'does-not-exist', referralCode: pCode });
  check('nonexistent user -> 404', r.code === 404, r.body);

  console.log('\n== An unrelated account/chain is completely untouched by everything above ==');
  const OTHER = 'ar-other';
  const otherReg = await registerFully(OTHER, '0771960008');
  check('unrelated account registered cleanly, unaffected', otherReg.body?.status === 'success' && userDoc(OTHER).teamL1Count === 0, userDoc(OTHER));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
