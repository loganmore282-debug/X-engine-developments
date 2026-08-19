/* SPACE8 ADMIN DASHBOARD STATS REGRESSION TEST
   The admin panel's dashboard permanently showed "Could not load stats.
   Network error" — /admin/stats and /admin/badges were registered as
   app.post() only, but the admin client's api() helper calls both with no
   body, which makes it send a plain GET. Express had no GET handler for
   either path, so every real request 404'd with Express's default HTML
   error page; the client's fetch then threw parsing that as JSON, and the
   generic catch block reported it as "Network error" every single time.
   Fixed by registering both as app.get(). This test hits them exactly the
   way the real admin panel does (GET, no body) and would have failed
   before the fix (404, not JSON).

   Run: node test-admin-stats.js   (exits 0 = all green)                   */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '4062';

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
    verifyIdToken: async tok => {
      if (String(tok).startsWith('uid:')) return { uid: tok.slice(4) };
      throw new Error('invalid token');
    },
  }),
};
faMod.loaded = true;
require.cache[faPath] = faMod;

require('./server.js');

const realFetch = global.fetch;
const BASE = 'http://127.0.0.1:4062';
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   - ' + name); }
  else { fail++; console.log('  FAIL - ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}

(async () => {
  await new Promise(r => setTimeout(r, 600));
  const adminHeaders = { Authorization: 'Bearer test-admin-key' };

  console.log('\n== GET /admin/stats (exactly how the real admin panel calls it) ==');
  let r = await realFetch(BASE + '/admin/stats', { method: 'GET', headers: adminHeaders });
  let body = null; try { body = await r.json(); } catch (e) { /* would throw pre-fix */ }
  check('response is real JSON, not a 404 HTML page', body !== null, { httpStatus: r.status });
  check('status success', body?.status === 'success', body);
  check('has userCount field', typeof body?.userCount === 'number', body);
  check('has healthBalance field', typeof body?.healthBalance === 'number', body);

  console.log('\n== GET /admin/badges (exactly how the real admin panel calls it) ==');
  r = await realFetch(BASE + '/admin/badges', { method: 'GET', headers: adminHeaders });
  body = null; try { body = await r.json(); } catch (e) {}
  check('response is real JSON, not a 404 HTML page', body !== null, { httpStatus: r.status });
  check('status success', body?.status === 'success', body);
  check('has pendingWithdrawals field', typeof body?.pendingWithdrawals === 'number', body);

  console.log('\n-- Both still reject an unauthenticated GET --');
  r = await realFetch(BASE + '/admin/stats', { method: 'GET' });
  check('/admin/stats -> 401 with no admin auth', r.status === 401, await r.text());
  r = await realFetch(BASE + '/admin/badges', { method: 'GET' });
  check('/admin/badges -> 401 with no admin auth', r.status === 401, await r.text());

  console.log('\n-- Dashboard "Pending payouts"/"Payout amount due" actually reflects a real pending withdrawal --');
  // Was querying withdrawals.status == 'processing' -- the brief window
  // AFTER an admin clicks Send, awaiting MarzPay's own confirmation --
  // instead of 'pending', the status a withdrawal actually sits at from
  // the moment a member requests it until an admin sends it. The dashboard
  // card showed 0 forever unless something happened to be mid-send at the
  // exact instant the page loaded. Now sums 'pending'+'sending'+'processing'.
  async function call(method, p, { token, body } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    const resp = await realFetch(BASE + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    let j = null; try { j = await resp.json(); } catch (_) {}
    return { code: resp.status, body: j };
  }
  const mockdb2 = require('./test-mockdb.js');
  function collMap(name) {
    if (!mockdb2.__store.has(name)) mockdb2.__store.set(name, new Map());
    return mockdb2.__store.get(name);
  }
  const uid = 'stats-wit-user';
  await call('POST', '/account/create-profile', { token: 'uid:' + uid, body: { phone: '0771999001' } });
  await call('POST', '/register', { token: 'uid:' + uid, body: {} });
  const u = collMap('users').get(uid);
  u.walletBalance = 500000; u.totalInvested = 500000;
  await call('POST', '/bank/save', { token: 'uid:' + uid, body: { holder: 'Stats Tester', network: 'MTN Mobile Money', phone: '0771999001' } });
  collMap('bankAccounts').set('fx1', { userId: uid, holder: 'Stats Tester', network: 'MTN Mobile Money', phone: '+256771999001', createdAt: new Date() });
  const witR = await call('POST', '/withdraw/request', { token: 'uid:' + uid, body: { amount: 60000, holder: 'Stats Tester', network: 'MTN Mobile Money', phone: '0771999001', pin: '1234' } });
  check('withdrawal request accepted (status stays "pending", nothing sent yet)', witR.body?.status === 'success', witR.body);
  const witId = witR.body?.withdrawalId;
  check('confirmed sitting at status "pending" in the store', collMap('withdrawals').get(witId)?.status === 'pending', collMap('withdrawals').get(witId));

  r = await realFetch(BASE + '/admin/stats', { method: 'GET', headers: adminHeaders });
  body = await r.json();
  check('pendingWithdrawals now counts the real pending request, not 0', body.pendingWithdrawals >= 1, body.pendingWithdrawals);
  check('pendingPayouts (amount due) now includes its net amount, not 0', body.pendingPayouts >= collMap('withdrawals').get(witId).net, { pendingPayouts: body.pendingPayouts, net: collMap('withdrawals').get(witId).net });

  console.log('\n-- teamRewardsPaid reflects what was ACTUALLY paid historically, not today\'s ladder rate --');
  // Codex-verified real gap (2026-08-19): teamRewardsPaid used to sum
  // claim flags against the CURRENT TEAM_MILESTONES/TEAM_DEPOSIT_MILESTONES
  // reward values -- correct only as long as the ladder never changes
  // after launch. Once the owner started editing the count ladder's rate
  // (1,500 -> 1,000 -> 500, all 2026-08-19), this platform-wide total
  // silently understated every historical claim made under an older,
  // higher rate. The real record already exists: /team/milestone/claim
  // writes an immutable `team_reward` transaction with the exact amount
  // paid at claim time -- teamRewardsPaid now sums those directly instead.
  // Two synthetic historical rows here (amounts that don't match ANY
  // current ladder tier's reward, so the old buggy per-flag recompute
  // could never have produced these numbers by coincidence).
  collMap('transactions').set('hist-reward-a', {
    userId: 'stats-hist-user-a', type: 'team_reward', milestone: 25, amount: 37500,
    status: 'success', description: 'Task Center: 25 active referrals', date: '2026-08-01', time: '00:00',
  });
  collMap('transactions').set('hist-reward-b', {
    userId: 'stats-hist-user-b', type: 'team_reward', milestone: 10, amount: 15000,
    status: 'success', description: 'Task Center: 10 active referrals', date: '2026-08-01', time: '00:00',
  });
  const realTeamRewardsPaid = [...collMap('transactions').values()]
    .filter(t => t.type === 'team_reward')
    .reduce((s, t) => s + t.amount, 0);
  // teamRewardsPaid actually lives under /admin/analytics's kpis (a POST
  // endpoint, not /admin/stats).
  r = await realFetch(BASE + '/admin/analytics', { method: 'POST', headers: { ...adminHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ days: 30 }) });
  body = await r.json();
  check(
    'teamRewardsPaid sums the REAL transaction amounts (37,500 + 15,000 historical claims), not the current ladder rate for those targets',
    body.kpis?.teamRewardsPaid === realTeamRewardsPaid, { got: body.kpis?.teamRewardsPaid, expected: realTeamRewardsPaid }
  );

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
