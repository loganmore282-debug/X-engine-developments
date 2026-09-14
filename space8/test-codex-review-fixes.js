/* SPACE8 CODEX REVIEW FIXES VERIFICATION
   The owner relayed a Codex review of this branch. Each finding was verified
   against the real code (not taken on faith) before anything was changed;
   this file proves the ones that were real and got fixed:

     1. creditReferralCommission() used to credit the wallet THEN mark the
        level paid -- a crash in that window left a real credit with no
        marker, so the reconciler's next pass saw the level as still unpaid
        and credited it again, repeating on every restart. Fixed to
        claim-before-credit (same pattern /redeem already used): a crash now
        can only leave a level "claimed but not credited" (a single lost
        payment, safe and fixable by hand), never a silently repeating
        double-pay. The reorder itself was verified by direct inspection
        (both writes are plain sequential awaits on one investment doc, and
        Mongo single-document updates are atomic, so there's no partial state
        within either write to race against). What this test proves
        end-to-end is the property that actually stops the double-pay bug:
        a level already present in commissionPaidLevels -- exactly the state
        any crash in that window now leaves behind -- is never credited
        again, from any real trigger.

     2. processWithdrawalCore() updated the withdrawal record AND incremented
        totalWithdrawn inside one Promise.all -- a failure in only one of the
        two (they're separate documents, no cross-doc transaction on M0)
        could leave them disagreeing with no way to tell which one actually
        landed. Fixed to sequential writes, with the totalWithdrawn increment
        (a derived stat, not money -- the real payout already went out via
        MarzPay before either write) wrapped so a failure there is logged
        loudly instead of throwing past a payout that genuinely succeeded.
        This test injects a failure on exactly that second write and proves
        the withdrawal is still correctly marked sent and the API still
        correctly reports success.

     3. completeRegistrationCore() incremented the referrer's L1/L2/L3 team
        counts BEFORE marking the new user's registrationDone true -- a
        crash in that window meant a retry (which only checks
        registrationDone) would re-run and increment every one of those
        counts again, inflating team size on every crash-retry. Fixed by
        moving the team-count increments to AFTER registrationDone is set,
        so a retry after that point is guaranteed to skip them entirely
        (the existing guard already does this) -- verified here by directly
        exercising that guard: a user already marked done, with an
        as-yet-uncounted referral (simulating exactly the state a
        crash-before-the-fix would produce), gets a second /register call
        and the referrer's count MUST NOT move.

     4. /assistant/chat had no ban check, unlike every other authenticated
        endpoint (/checkin, /invest/create, /account, etc). Fixed to match.

     5. The check-in streak's ledger read used .limit(500) with NO orderBy --
        on Mongo, an unsorted query returns natural/insertion order, which in
        practice is oldest-first. For any account with >500 lifetime
        check-ins, that fetched the 500 OLDEST records and completely missed
        real recent activity, wrongly resetting a long-lived daily user's
        streak. Fixed with orderBy('createdAt','desc') before the limit.
        This test seeds 510 ancient check-ins plus a genuine recent 4-day
        streak and proves the recent run is what gets counted.

   Two Codex findings were checked and found NOT to apply to this codebase
   and were deliberately left alone (see AGENT_LOG.md for the full writeup):
   the "/team/members Firestore 'in' limit" claim doesn't hold because this
   project runs on MongoDB (via a Firestore-shaped compat layer) whose $in
   has no such small cap; and the "--blue should revert to #2e6bff" design
   suggestion directly contradicts the owner's own explicit instruction
   earlier this same session to move away from that color.

   Run: node test-codex-review-fixes.js   (exits 0 = all green)            */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '4200';

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
  if (u.includes('wearemarz.com') && u.endsWith('/send-money'))
    return json({ status: 'success', data: { transaction: { uuid: 'WTX-' + (++marzN), status: 'pending' } } });
  return realFetch(url, opts);
};

require('./server.js');

const BASE = 'http://127.0.0.1:4200';
async function call(method, p, { token, adminKey, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (adminKey) headers.Authorization = 'Bearer ' + adminKey;
  const r = await realFetch(BASE + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
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
const investments = () => collMap('investments');
const withdrawals = () => collMap('withdrawals');

async function registerFresh(uid, phone, referralCode) {
  await call('POST', '/account/create-profile', { token: 'uid:' + uid, body: { phone } });
  return call('POST', '/register', { token: 'uid:' + uid, body: referralCode ? { referralCode } : {} });
}
function cleanPhoneLocal(raw) {
  const s = String(raw || '').replace(/\D/g, '');
  let local9 = null;
  if (s.startsWith('256') && s.length === 12) local9 = s.slice(3);
  else if (s.startsWith('0') && s.length === 10) local9 = s.slice(1);
  else if (s.length === 9) local9 = s;
  return local9 ? '+256' + local9 : raw;
}

(async () => {
  await sleep(600);

  // ── 1. Referral commission: claim-before-credit crash safety ──────────
  console.log('\n== [1] Referral commission: a level already marked claimed is NEVER credited again, from any trigger ==');
  // The reordering itself (claim written before credit, both plain sequential
  // awaits on the same investment doc) was verified by direct inspection --
  // Mongo single-document updates are atomic, so if the SECOND write throws,
  // the FIRST has unconditionally already landed; there's no partial state
  // within one .update() call to race against. What this test proves
  // end-to-end is the property that actually stops the double-pay-on-restart
  // bug: once a level is present in commissionPaidLevels (exactly the state
  // any crash between claim and credit now leaves behind), NO subsequent
  // invocation of creditReferralCommission -- from any of its three real call
  // sites -- ever credits it again. Exercised here via the real
  // /admin/user/attach-referrer path (the one call site reachable without a
  // ~15s wait for the periodic reconciler, and without racing an unrelated
  // earlier write the way going through POST /invest/create would).
  const buyerA = await registerFresh('cx-buyer-a', '0771700002'); // no referrer yet
  userDoc('cx-buyer-a').walletBalance = 1000000;
  const purchaseA = await call('POST', '/invest/create', { token: 'uid:cx-buyer-a', body: { tierKey: 'explorer1' } });
  check('buyer\'s first purchase succeeds (no referrer yet, so no commission is even attempted)', purchaseA.body?.status === 'success', purchaseA.body);
  const invIdA = purchaseA.body.investmentId;
  // Simulate exactly the state the fix guarantees a crash can produce:
  // level 0 claimed, but (as far as this test can tell) never actually paid.
  investments().get(invIdA).commissionPaidLevels = [0];

  const refA = await registerFresh('cx-ref-a', '0771700001');
  const refABalanceBeforeAttach = userDoc('cx-ref-a').walletBalance; // includes their own welcome bonus, unrelated to commission
  const attachR = await ownerCall('/admin/user/attach-referrer', { userId: 'cx-buyer-a', referralCode: refA.body.referralCode });
  check('attach-referrer succeeds', attachR.body?.status === 'success', attachR.body);
  check('referrer wallet balance UNCHANGED by attach-referrer -- level 0 was already claimed, so crediting it is correctly skipped, not repeated', userDoc('cx-ref-a').walletBalance === refABalanceBeforeAttach, { before: refABalanceBeforeAttach, after: userDoc('cx-ref-a').walletBalance });
  const commissionTx = [...collMap('transactions').values()].find(t => t.investmentId === invIdA && t.type === 'commission');
  check('no commission transaction record was created for this already-claimed level either', !commissionTx, commissionTx);

  // ── 2. Withdrawal bookkeeping: sequential + non-fatal totalWithdrawn ──
  console.log('\n== [2] Withdrawal: a totalWithdrawn write failure never blocks or misreports a real payout ==');
  const wUser = await registerFresh('cx-wit-a', '0771700003');
  userDoc('cx-wit-a').walletBalance = 500000;
  userDoc('cx-wit-a').totalInvested = 500000;
  collMap('bankAccounts').set('cx-bank-a', { userId: 'cx-wit-a', holder: 'Tester', network: 'MTN Mobile Money', phone: cleanPhoneLocal('0771700003'), createdAt: new Date() });
  const witReqR = await call('POST', '/withdraw/request', { token: 'uid:cx-wit-a', body: { amount: 100000, holder: 'Tester', network: 'MTN Mobile Money', phone: '0771700003', pin: '1234' } });
  check('withdrawal request created', witReqR.body?.status === 'success', witReqR.body);
  const witId = witReqR.body.withdrawalId;
  const totalWithdrawnBefore = userDoc('cx-wit-a').totalWithdrawn || 0;

  global.__mockDbFailUpdateOnce.add('users'); // fails the totalWithdrawn increment specifically (withdrawals is a different collection, so the status write below is unaffected)
  const procR = await ownerCall('/admin/withdraw/process', { withdrawalId: witId });
  check('the payout still reports success to the admin -- money genuinely went out, the response must say so', procR.code === 200 && procR.body?.status === 'success', procR.body);
  check('the withdrawal record itself is correctly marked sent, not left pending or lost', ['processing', 'processed'].includes(withdrawals().get(witId).status), withdrawals().get(witId));
  check('totalWithdrawn did NOT get incremented on this failed write (the accepted, logged, fixable-by-hand gap -- not a crash, not a false failure report)', (userDoc('cx-wit-a').totalWithdrawn || 0) === totalWithdrawnBefore, userDoc('cx-wit-a').totalWithdrawn);

  // ── 3. Registration: a retry after registrationDone can never inflate team counts ──
  console.log('\n== [3] Registration retry-safety: once registrationDone is true, team counts can never be re-incremented ==');
  const refB = await registerFresh('cx-ref-b', '0771700004');
  const refBCode = refB.body.referralCode;
  await call('POST', '/account/create-profile', { token: 'uid:cx-retry-user', body: { phone: '0771700005' } });
  // Simulate exactly the state a crash-before-this-fix would have produced:
  // registrationDone already true and referredBy already set (as if the
  // user's own atomic update succeeded), but the referrer's teamL1Count was
  // never incremented (as if the process died right there, before this fix
  // moved that increment to AFTER registrationDone).
  userDoc('cx-retry-user').registrationDone = true;
  userDoc('cx-retry-user').referredBy = 'cx-ref-b';
  userDoc('cx-retry-user').referralCode = 'CXRETRY1';
  check('sanity: referrer team count starts at 0 (never incremented in this simulated partial state)', (userDoc('cx-ref-b').teamL1Count || 0) === 0, userDoc('cx-ref-b'));

  const retryR = await call('POST', '/register', { token: 'uid:cx-retry-user', body: { referralCode: refBCode } });
  check('retry is recognized as already done, not re-run', retryR.body?.status === 'already_done', retryR.body);
  check('referrer team count is UNCHANGED by the retry -- no inflation (the accepted tradeoff: a crash-missed count stays missed, never doubles)', (userDoc('cx-ref-b').teamL1Count || 0) === 0, userDoc('cx-ref-b'));

  // ── 4. Assistant rejects banned accounts ───────────────────────────────
  console.log('\n== [4] /assistant/chat now rejects a banned account, matching every other authenticated endpoint ==');
  await registerFresh('cx-banned-a', '0771700006');
  userDoc('cx-banned-a').status = 'banned';
  const assistR = await call('POST', '/assistant/chat', { token: 'uid:cx-banned-a', body: { message: 'how do I deposit?' } });
  check('banned account is refused (403/BANNED), same code as every other endpoint', assistR.code === 403 && assistR.body?.code === 'BANNED', assistR.body);

  // ── 5. Checkin streak reads the RECENT 500, not an arbitrary oldest slice ──
  console.log('\n== [5] Checkin streak: reads the MOST RECENT check-ins, not whatever order the DB happens to store them in ==');
  const streakUser = await registerFresh('cx-streak-a', '0771700007');
  let seedN = 0;
  function seedCheckin(daysAgo) {
    const id = 'cx-seed-checkin-' + (++seedN);
    collMap('transactions').set(id, {
      userId: 'cx-streak-a', type: 'checkin', description: 'seed', amount: 250, status: 'success',
      date: '01/01/2000', time: '00:00:00', createdAt: new Date(Date.now() - daysAgo * 86400000)
    });
  }
  // 510 ancient, distinct-day check-ins, inserted oldest-first (matches real
  // insertion order) -- with NO orderBy, a bare .limit(500) would return
  // exactly these 510 in insertion order and truncate to the first 500,
  // missing the 4 genuinely recent ones seeded below entirely.
  for (let d = 900; d >= 391; d--) seedCheckin(d);
  // A genuine, real, unbroken 4-day streak ending YESTERDAY.
  seedCheckin(4); seedCheckin(3); seedCheckin(2); seedCheckin(1);

  const checkinR = await call('POST', '/checkin', { token: 'uid:cx-streak-a', body: {} });
  check('check-in succeeds', checkinR.body?.status === 'success', checkinR.body);
  check('streak correctly counts the real recent 4-day run (+ today = 5), not corrupted by 510 ancient unsorted records', checkinR.body?.streak === 5, checkinR.body);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
