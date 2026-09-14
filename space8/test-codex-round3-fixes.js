/* SPACE8 -- CODEX ROUND-3 FULL-CODEBASE REVIEW, FIXES
   Owner asked Codex for a fresh full-codebase review (not just a diff
   re-check) on top of everything already fixed through the 2026-08-17
   audits documented in AGENT_LOG.md/CLAUDE.md. It found several real,
   previously-unnoticed issues plus a few genuine "worth a second look"
   items. Every finding was independently verified against the real code
   before anything was touched, same discipline as every prior round. This
   file covers what the HTTP-only test harness can actually exercise:

   1. Deleting a member no longer races a concurrent deposit/withdrawal for
      that SAME account -- a deposit/withdrawal request landing after
      deletion has started is now rejected instead of being wiped without
      a trace once its money-moving gateway call resolves.
   2. Deleting a member who is, at that exact moment, being claimed as
      someone else's referrer no longer races that registration into a
      permanently orphaned referredBy (creditReferralCommission silently
      abandons commission for a missing referrer forever, with no
      reconciler able to repair a dangling reference). Both
      completeRegistrationCore and /admin/user/attach-referrer now share a
      'referrer-guard:'+id lock with /admin/user/delete, keyed by the
      account being claimed/deleted.
   3. /admin/deposits/list, /admin/withdrawals/list, and
      /admin/promocodes/list all merge in every still-UNRESOLVED (or, for
      promo codes, still-ACTIVE) row regardless of how far back it is, so
      real volume past their newest-N display cap can no longer hide a
      deposit/withdrawal an admin still needs to act on, or an active gift
      code they still need to be able to deactivate.
   4. /admin/user/detail and /admin/transactions/list's userId branch both
      added an orderBy() before their limit() -- previously, for a member
      with more rows than the cap, the newest one wasn't guaranteed to be
      among the ones actually fetched.
   5. /admin/admins/deactivate|reactivate|reset-password now check the
      target username actually exists first, instead of db.js's update()
      silently "succeeding" against a missing document (unlike real
      Firestore) and reporting a change that never happened.
   6. /admin/payments/sync (the manual "Sync MarzPay" button) is now
      audit-logged like every other state-changing admin action.

   NOT covered here, verified by direct code-reading instead (same
   documented practice as every other client-only or scale-prohibitive fix
   this project has made):
   - Client-only fixes in user-src/original_module.js (the gift-code input's
     maxlength/autocapitalize, the PIN-status authEpoch guard, the
     announcement dialog now closing on sign-out, the autofill-retry reset
     after a failed login) and admin-src/index.html (_tabBusy -> a real
     counter, including the SW-reload script's own separate read of it).
   - /admin/users/recount's new truncation-refusal guard (refuses to WRITE
     reconstructed totals if any of its three scans hit their cap):
     reproducing the actual 200,000/10,000-row caps in a unit test is
     prohibitively expensive to seed for what the boundary check itself is
     (a single `>=` comparison against `.size`) -- verified by reading the
     code, not by seeding six-figure fixtures.
   - The broader "several other admin dashboards (/admin/users,
     /admin/stats, /admin/integrity, /admin/analytics,
     recomputeTeamCounts) are ALSO capped at 10,000 users / 200,000 ledger
     rows and would silently under-report past that" finding: a genuine
     architectural scale limit, not a containable bug -- documented in
     AGENT_LOG.md/CLAUDE.md rather than rushed into a partial pagination
     rewrite, same treatment this project already gives
     reconcileCashback()'s poll-everything-active shape.

   Run: node test-codex-round3-fixes.js   (exits 0 = all green)          */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '4301';

const Module = require('module');
const mockdb = require('./test-mockdb.js');
const dbPath = require.resolve('./db.js');
const dbMod = new Module(dbPath); dbMod.exports = mockdb; dbMod.loaded = true;
require.cache[dbPath] = dbMod;

const faPath = require.resolve('firebase-admin');
const faMod = new Module(faPath);
faMod.exports = {
  initializeApp: () => {}, credential: { cert: () => ({}) },
  auth: () => ({
    verifyIdToken: async tok => { if (String(tok).startsWith('uid:')) return { uid: tok.slice(4) }; throw new Error('bad'); },
    // A small real delay on the delete route's Firebase-first step -- so a
    // concurrently-fired registration racing to claim this same account as
    // its referrer (test 3 below) has a real, reliable window to win the
    // referrer-guard lock FIRST, rather than the mock's synchronous-
    // microtask chain always letting deletion resolve before registration
    // gets anywhere near its own lock attempt (same reasoning as the
    // artificial macrotask yield test-withdrawal-concurrency-guard.js
    // already documents needing for this exact class of test).
    deleteUser: async () => { await new Promise(r => setTimeout(r, 20)); },
  }),
};
faMod.loaded = true;
require.cache[faPath] = faMod;

// This test's own /admin/user/delete + concurrent-deposit/withdrawal
// scenarios (tests 1-2) and /admin/payments/sync (test 9) can reach real
// MarzPay-calling code paths -- mock that host so those calls resolve
// immediately with an "unresolved" shape instead of hitting (or hanging
// on) the real network, which this sandbox may not even have a route to.
const realFetch = global.fetch;
global.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes('wearemarz.com')) {
    return { ok: false, status: 502, json: async () => ({ status: 'error', message: 'mock: no live gateway in tests' }) };
  }
  return realFetch(url, opts);
};

require('./server.js');

const BASE = 'http://127.0.0.1:4301';
async function call(method, p, { token, admin, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (admin) headers.Authorization = 'Bearer test-admin-key';
  const r = await realFetch(BASE + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (_) {}
  return { code: r.status, body: j };
}
async function ownerCall(path, body) { return call('POST', path, { admin: true, body }); }
async function ownerGet(path) { return call('GET', path, { admin: true }); }
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
const pendingDeposits = () => collMap('pendingDeposits');
const withdrawals = () => collMap('withdrawals');
const promoCodes = () => collMap('promoCodes');
const investments = () => collMap('investments');
const transactions = () => collMap('transactions');
const adminAuditLog = () => collMap('adminAuditLog');
let _seq = 0;
const nextId = prefix => prefix + (++_seq);

async function setupUser(uid, phone) {
  await call('POST', '/account/create-profile', { token: 'uid:' + uid, body: { phone } });
  return call('POST', '/register', { token: 'uid:' + uid, body: {} });
}

(async () => {
  await new Promise(r => setTimeout(r, 600));

  console.log('\n== 1. Deleting a member no longer races a concurrent deposit/withdrawal for that same account ==');
  // Fired via Promise.all over REAL fetch() calls (not a sequential loop) --
  // this test suite's own established way to get genuine interleaving
  // through the mock, same technique test-security-review.js's referral-
  // code race test uses. The invariant that must ALWAYS hold, whichever
  // side wins the race: deletion and a deposit for that same account can
  // never BOTH report success -- either the deposit's own new guard blocks
  // it while deletion is in flight, or the deposit legitimately created its
  // record before deletion even started, in which case deletion's existing
  // "unsettled activity" check must have seen it and refused to proceed.
  // Kept to 3 iterations (not more) -- every call in this file shares ONE
  // rate-limit bucket, since the fake 'uid:xxx' tokens this test suite uses
  // don't parse as a real JWT, so rlKeyByUser() falls back to keying by IP
  // (127.0.0.1) for every request in this process, same as every other
  // test-*.js file. apiLimiter caps that shared bucket at 60/min across
  // /account/create-profile, /register, /deposit/marzpay, /withdraw/request
  // combined -- this file's overall iteration counts are sized to stay
  // comfortably under that real, working limiter, not to work around it.
  for (let i = 0; i < 3; i++) {
    const DU = 'r3-del-dep-' + i;
    await setupUser(DU, '077280010' + i);
    const [delRes, depRes] = await Promise.all([
      call('POST', '/admin/user/delete', { admin: true, body: { userId: DU, confirm: 'DELETE' } }),
      call('POST', '/deposit/marzpay', { token: 'uid:' + DU, body: { amount: 50000, phone: '077280010' + i } }),
    ]);
    const deleteSucceeded = delRes.body?.status === 'success';
    const depositSucceeded = depRes.body?.status === 'success';
    check('iteration ' + i + ': deletion and a same-account deposit never both succeed', !(deleteSucceeded && depositSucceeded),
      { deleteSucceeded, depositSucceeded, delRes: delRes.body, depRes: depRes.body });
  }

  console.log('\n== 2. Same guard on a concurrent withdrawal request ==');
  for (let i = 0; i < 3; i++) {
    const WU = 'r3-del-wit-' + i;
    await setupUser(WU, '077280020' + i);
    users().get(WU).walletBalance = 1000000; // needs a real balance to reach the guard check at all
    const [delRes, witRes] = await Promise.all([
      call('POST', '/admin/user/delete', { admin: true, body: { userId: WU, confirm: 'DELETE' } }),
      call('POST', '/withdraw/request', { token: 'uid:' + WU, body: { amount: 50000, holder: 'Test Holder', network: 'MTN', phone: '077280020' + i } }),
    ]);
    const deleteSucceeded = delRes.body?.status === 'success';
    const witSucceeded = witRes.body?.status === 'success';
    check('iteration ' + i + ': deletion and a same-account withdrawal never both succeed', !(deleteSucceeded && witSucceeded),
      { deleteSucceeded, witSucceeded, delRes: delRes.body, witRes: witRes.body });
  }

  console.log('\n== 3. Deleting a referrer no longer races a registration that\'s claiming them, into a dangling referredBy ==');
  // Same real-concurrency technique. The invariant: after both settle, IF
  // the new member ended up with a referredBy set, that referenced account
  // must still actually exist in the database -- never a reference to an
  // account this same request just finished deleting.
  let danglingFound = false;
  for (let i = 0; i < 5; i++) {
    const REF = 'r3-guard-ref-' + i;
    const refReg = await setupUser(REF, '077280030' + i);
    const refCode = refReg.body.referralCode;
    const NEW = 'r3-guard-new-' + i;
    await call('POST', '/account/create-profile', { token: 'uid:' + NEW, body: { phone: '077280040' + i } });
    const [delRes, regRes] = await Promise.all([
      call('POST', '/admin/user/delete', { admin: true, body: { userId: REF, confirm: 'DELETE' } }),
      call('POST', '/register', { token: 'uid:' + NEW, body: { referralCode: refCode } }),
    ]);
    // Several legitimate outcomes depending on which side actually won the
    // race (Promise.all doesn't guarantee true simultaneity), including
    // deletion completing AFTER registration already attached the referrer
    // -- in which case deletion's own downline query correctly finds NEW
    // (since referredBy is already set to REF by then) and reparents NEW
    // right along with any other real downline member, same as any normal
    // deletion. So the fresh CURRENT value of referredBy is what has to be
    // checked, not any id from the registration response -- /register's
    // own response deliberately never exposes referrerId at all (redacted
    // in an earlier round, see completeRegistrationCore's own comments),
    // and even if it did, it may have legitimately changed since. What
    // must NEVER happen: NEW ending up pointing at an account that no
    // longer exists in the database.
    const freshDoc = users().get(NEW);
    const currentReferredBy = freshDoc ? freshDoc.referredBy : null;
    if (currentReferredBy) {
      const referrerStillExists = !!users().get(currentReferredBy);
      if (!referrerStillExists) danglingFound = true;
      check('iteration ' + i + ': current referredBy (' + currentReferredBy + ') points to an account that still exists', referrerStillExists,
        { delRes: delRes.body, regRes: regRes.body, currentReferredBy });
    } else {
      check('iteration ' + i + ': registration itself still succeeded (no referrer attached, or a real BAD_REFERRAL)',
        regRes.body?.status === 'success' || regRes.body?.code === 'BAD_REFERRAL', regRes.body);
    }
  }
  check('no iteration produced a referral pointing at a deleted account', !danglingFound);

  console.log('\n== 4. /admin/deposits/list surfaces a genuinely old UNRESOLVED deposit even past the newest-5000 display cap ==');
  const OLDDEP_USER = 'r3-olddep-user';
  await setupUser(OLDDEP_USER, '0772800500');
  const oldDepId = nextId('olddep');
  pendingDeposits().set(oldDepId, {
    userId: OLDDEP_USER, phone: '0772800500', amount: 30000, ref: 'B_OLDDEP', status: 'pending',
    createdAt: new Date(Date.now() - 999 * 86400000), // ancient
  });
  for (let i = 0; i < 5000; i++) {
    pendingDeposits().set('recentdep' + i, {
      userId: OLDDEP_USER, phone: '0772800500', amount: 1000, ref: 'B_R' + i, status: 'matched',
      createdAt: new Date(Date.now() - i * 1000), // all newer than the ancient one above
    });
  }
  let r = await ownerCall('/admin/deposits/list', {});
  check('deposits list request succeeded', r.body?.status === 'success', r.code);
  const foundOldDep = (r.body?.deposits || []).some(d => d.id === oldDepId);
  check('the ancient still-pending deposit is present despite 5000 newer rows existing', foundOldDep);
  const dupCount = (r.body?.deposits || []).filter(d => d.id === oldDepId).length;
  check('it appears exactly once (no duplicate from the merge)', dupCount === 1, dupCount);
  // Codex/self-review-verified real bug: referral code display + "search by
  // code" on the Deposits/Withdrawals admin tabs used to depend entirely on
  // the client having a shared _users array populated -- which only ever
  // happens by visiting the Users tab first. Landing on Deposits/Withdrawals
  // first (the approval queue -- a very plausible first stop) meant the code
  // column silently rendered blank and code search silently matched nothing.
  // Fixed by having the server send referralCode directly on every row, same
  // as it already does for accountPhone.
  const depRow = (r.body?.deposits || []).find(d => d.id === oldDepId);
  const oldDepUser = users().get(OLDDEP_USER);
  check('deposit row carries the user\'s real referralCode directly from the server',
    !!depRow?.referralCode && depRow.referralCode === oldDepUser?.referralCode,
    { rowCode: depRow?.referralCode, userCode: oldDepUser?.referralCode });

  console.log('\n== 5. Same rescue for /admin/withdrawals/list ==');
  const OLDWIT_USER = 'r3-oldwit-user';
  await setupUser(OLDWIT_USER, '0772800600');
  const oldWitId = nextId('oldwit');
  withdrawals().set(oldWitId, {
    userId: OLDWIT_USER, amount: 20000, net: 17000, ref: 'B_OLDWIT', status: 'pending',
    createdAt: new Date(Date.now() - 999 * 86400000),
  });
  for (let i = 0; i < 5000; i++) {
    withdrawals().set('recentwit' + i, {
      userId: OLDWIT_USER, amount: 5000, net: 4000, ref: 'B_RW' + i, status: 'processed',
      createdAt: new Date(Date.now() - i * 1000),
    });
  }
  r = await ownerCall('/admin/withdrawals/list', {});
  check('withdrawals list request succeeded', r.body?.status === 'success', r.code);
  const foundOldWit = (r.body?.withdrawals || []).some(w => w.id === oldWitId);
  check('the ancient still-pending withdrawal is present despite 5000 newer rows existing', foundOldWit);
  const witRow = (r.body?.withdrawals || []).find(w => w.id === oldWitId);
  const oldWitUser = users().get(OLDWIT_USER);
  check('withdrawal row carries the user\'s real referralCode directly from the server',
    !!witRow?.referralCode && witRow.referralCode === oldWitUser?.referralCode,
    { rowCode: witRow?.referralCode, userCode: oldWitUser?.referralCode });

  console.log('\n== 6. /admin/promocodes/list surfaces a genuinely old ACTIVE code even past the newest-300 display cap ==');
  const oldCodeId = nextId('oldcode');
  promoCodes().set(oldCodeId, { code: 'OLDACTV', codeLower: 'oldactv', reward: 1000, active: true, usedBy: [], createdAt: new Date(Date.now() - 999 * 86400000) });
  for (let i = 0; i < 300; i++) {
    promoCodes().set('newcode' + i, { code: 'NEW' + i, codeLower: 'new' + i, reward: 500, active: false, usedBy: [], createdAt: new Date(Date.now() - i * 1000) });
  }
  r = await ownerGet('/admin/promocodes/list');
  check('promo codes list request succeeded', r.body?.status === 'success', r.code);
  const foundOldCode = (r.body?.codes || []).some(c => c.id === oldCodeId);
  check('the old still-active code is present despite 300 newer inactive codes existing', foundOldCode);

  console.log('\n== 7. /admin/user/detail and /admin/transactions/list sort BEFORE truncating, not after ==');
  const SORTU = 'r3-sort-user';
  await setupUser(SORTU, '0772800700');
  // Backdate the real welcome-gift transaction registration just created --
  // otherwise it (genuinely created at "now") would legitimately outrank
  // every synthetically-backdated row below, making tx#59 NOT actually the
  // newest row for this user and silently defeating the point of this check.
  for (const d of transactions().values()) {
    if (d.userId === SORTU && d.description === 'Welcome gift') d.createdAt = new Date(Date.now() - 999 * 86400000);
  }
  for (let i = 0; i < 60; i++) {
    transactions().set(nextId('sorttx'), {
      userId: SORTU, type: 'checkin', description: 'tx#' + i, amount: 100, status: 'success',
      date: '01/01/2026', time: '00:00:00', createdAt: new Date(Date.now() - (60 - i) * 60000), // i=59 is the NEWEST
    });
  }
  r = await ownerCall('/admin/user/detail', { userId: SORTU });
  check('user detail request succeeded', r.body?.status === 'success', r.code);
  check('transactions returned newest-first (top row is tx#59, not whatever natural/insertion order left in the first 50)',
    r.body?.transactions?.[0]?.description === 'tx#59', r.body?.transactions?.[0]);
  r = await ownerCall('/admin/transactions/list', { userId: SORTU });
  check('transactions/list (by userId) also returns newest-first', r.body?.transactions?.[0]?.description === 'tx#59', r.body?.transactions?.[0]);

  console.log('\n== 8. /admin/admins/deactivate|reactivate|reset-password now 404 on a username that does not exist ==');
  r = await ownerCall('/admin/admins/deactivate', { username: 'r3-does-not-exist' });
  check('deactivate on a nonexistent username -> 404, not a silent fake success', r.code === 404, r.body);
  r = await ownerCall('/admin/admins/reactivate', { username: 'r3-does-not-exist' });
  check('reactivate on a nonexistent username -> 404', r.code === 404, r.body);
  r = await ownerCall('/admin/admins/reset-password', { username: 'r3-does-not-exist', password: 'a-real-password-1' });
  check('reset-password on a nonexistent username -> 404', r.code === 404, r.body);
  await ownerCall('/admin/admins/create', { username: 'r3-real-staff', password: 'a-real-password-1' });
  r = await ownerCall('/admin/admins/deactivate', { username: 'r3-real-staff' });
  check('deactivate on a REAL username still succeeds normally', r.code === 200 && r.body?.status === 'success', r.body);

  console.log('\n== 9. /admin/payments/sync is now audit-logged ==');
  const beforeLogSize = adminAuditLog().size;
  await ownerGet('/admin/payments/sync');
  const afterLogSize = adminAuditLog().size;
  check('a payments_synced audit entry was written', afterLogSize > beforeLogSize, { beforeLogSize, afterLogSize });
  const syncedEntry = Array.from(adminAuditLog().values()).find(e => e.action === 'payments_synced');
  check('the audit entry is the right action', !!syncedEntry, syncedEntry);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
