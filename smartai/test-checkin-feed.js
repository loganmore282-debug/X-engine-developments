'use strict';
// END-TO-END for the routes the Rewards tab, Home and Ledger of the member app need: the daily check-in (one a day, however many taps, the streak
// counted from the real history, the admin's amount, banned / unfinished / maintenance refusals), the live-activity strip (shape, floors, shared),
// and the member's own top-up and cash-out lists (only their rows, only the fields the Ledger shows, newest first). Runs the REAL server.js against
// the in-memory MongoDB stand-in.
const fs = require('fs'), path = require('path'), Module = require('module'), vm = require('vm');
const root = __dirname;
const fm = require('./test-helpers/fake-mongodb.js');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...a) { return req === 'mongodb' ? path.join(root, 'test-helpers', 'fake-mongodb.js') : origResolve.call(this, req, ...a); };
const PORT = 3900 + Math.floor(Math.random() * 90);
process.env.PORT = String(PORT); process.env.MONGODB_URI = 'mongodb://fake/smartai'; process.env.ADMIN_KEY = 'e2e-admin-key-123456'; process.env.NODE_ENV = 'development';
const realLog = console.log; console.log = () => {}; console.warn = () => {};
require('./server.js');
const base = 'http://127.0.0.1:' + PORT;
const J = async (m, p, b, tok, adm) => {
  const r = await fetch(base + p, { method: m, headers: Object.assign({ 'content-type': 'application/json' }, tok ? { authorization: 'Bearer ' + tok } : {}, adm ? { authorization: 'Bearer e2e-admin-key-123456', 'x-admin-key': 'e2e-admin-key-123456' } : {}), body: b ? JSON.stringify(b) : undefined });
  let j = null; try { j = await r.json(); } catch (_) {} return { s: r.status, j, h: r.headers };
};
let fails = 0, checks = 0;
const ok = (c, m, x) => { checks++; if (!c) { fails++; realLog('FAIL', m, x ? JSON.stringify(x).slice(0, 300) : ''); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ph = () => '07' + String(70000000 + Math.floor(Math.random() * 9999999)).padStart(8, '0').slice(-8);
async function member() {
  const phone = ph();
  const su = await J('POST', '/auth/signup', { phone, password: 'secret12' });
  const reg = await J('POST', '/register', { referralCode: '', pin: '123456', phone }, su.j.token);
  return { tok: su.j.token, uid: su.j.uid, phone, reg };
}
const user = uid => fm.__stores.users.get(uid);
const DAY = 86400000;
const seedCheckin = (uid, daysAgo) => { const id = 'seed:' + uid + ':' + daysAgo; fm.__stores.transactions.set(id, { _id: id, userId: uid, type: 'checkin', amount: 250, status: 'success', createdAt: new Date(Date.now() - daysAgo * DAY) }); };
const eatDate = () => { const d = new Date(Date.now() + 3 * 3600000), p = n => String(n).padStart(2, '0'); return p(d.getUTCMonth() + 1) + '/' + p(d.getUTCDate()) + '/' + d.getUTCFullYear(); };

(async () => {
  for (let i = 0; i < 60; i++) { try { const h = await fetch(base + '/health'); if (h.ok) break; } catch (_) {} await sleep(250); }
  await J('POST', '/admin/settings/update', { settings: { welcomeBonus: 0, requireTwofaToWithdraw: false, dailyCheckin: 500 } }, null, true);

  // ---- the first check-in
  const A = await member();
  ok(A.reg.j && A.reg.j.status === 'success', 'a member registers', A.reg.j);
  const a0 = user(A.uid).walletBalance || 0;
  let r = await J('POST', '/checkin', {}, A.tok);
  ok(r.s === 200 && r.j.status === 'success' && r.j.bonus === 500 && r.j.streak === 1, 'the first check-in pays the admin\'s amount and starts a streak of 1', r.j);
  ok(user(A.uid).walletBalance - a0 === 500 && user(A.uid).lastCheckin === eatDate() && user(A.uid).checkinStreak === 1, 'the wallet got exactly 500 and today is marked (' + user(A.uid).lastCheckin + ')');
  const earned0 = user(A.uid).totalEarned;
  const rows = [...fm.__stores.transactions.values()].filter(t => t.userId === A.uid && t.type === 'checkin');
  ok(rows.length === 1 && rows[0].amount === 500 && rows[0]._id === 'checkin:' + A.uid + ':' + eatDate().replace(/\//g, '-') && /day 1/.test(rows[0].description), 'one ledger row, keyed on the member and the day', rows);
  const acct = (await J('GET', '/account', null, A.tok)).j.account;
  ok(acct.checkinStreak === 1 && acct.lastCheckin === eatDate(), '/account tells the app the streak and the last day', { s: acct.checkinStreak, l: acct.lastCheckin });
  r = await J('POST', '/checkin', {}, A.tok);
  ok(r.s === 400 && r.j.code === 'ALREADY_CHECKED_IN' && user(A.uid).walletBalance - a0 === 500, 'a second tap the same day is refused and pays nothing', r.j);
  const tx = (await J('GET', '/transactions', null, A.tok)).j.transactions || [];
  ok(tx.some(t => t.type === 'checkin' && t.amount === 500), 'the member sees the reward in their history', tx.map(t => t.type));

  // ---- many taps at once, from many phones
  const B = await member(); const b0 = user(B.uid).walletBalance || 0;
  const burst = await Promise.all(Array.from({ length: 6 }, () => J('POST', '/checkin', {}, B.tok)));
  ok(burst.filter(x => x.s === 200).length === 1 && burst.filter(x => x.j && x.j.code === 'ALREADY_CHECKED_IN').length === 5, 'six taps at the same instant pay exactly once', burst.map(x => x.s));
  ok(user(B.uid).walletBalance - b0 === 500 && [...fm.__stores.transactions.values()].filter(t => t.userId === B.uid && t.type === 'checkin').length === 1, 'one credit and one ledger row');

  // ---- the streak comes from the real history
  const C = await member(); seedCheckin(C.uid, 1); seedCheckin(C.uid, 2);
  r = await J('POST', '/checkin', {}, C.tok); ok(r.j.streak === 3, 'yesterday and the day before, then today: a streak of 3', r.j);
  const D = await member(); seedCheckin(D.uid, 3);
  r = await J('POST', '/checkin', {}, D.tok); ok(r.j.streak === 1, 'the last check-in was three days ago: the streak starts again at 1', r.j);
  const E = await member(); seedCheckin(E.uid, 1); seedCheckin(E.uid, 3); seedCheckin(E.uid, 4);
  r = await J('POST', '/checkin', {}, E.tok); ok(r.j.streak === 2, 'a gap ends the old run: yesterday + today = 2 (the older days do not count)', r.j);
  const F = await member(); user(F.uid).checkinStreak = 99;   // a damaged stored number cannot keep a streak that is not real
  r = await J('POST', '/checkin', {}, F.tok); ok(r.j.streak === 1 && user(F.uid).checkinStreak === 1, 'a wrong stored streak is ignored: the history decides', r.j);

  // ---- who may not
  r = await J('POST', '/checkin', {}); ok(r.s === 401, 'signing in is required');
  const G = await member(); user(G.uid).status = 'banned'; const g0 = user(G.uid).walletBalance || 0;
  r = await J('POST', '/checkin', {}, G.tok); ok(r.s >= 400 && r.j.status === 'error' && (user(G.uid).walletBalance || 0) === g0, 'a banned member gets nothing', { s: r.s, j: r.j });
  const su = await J('POST', '/auth/signup', { phone: ph(), password: 'secret12' });
  r = await J('POST', '/checkin', {}, su.j.token); ok(r.s >= 400 && r.j.status === 'error', 'someone who has not finished signing up cannot check in', { s: r.s, j: r.j });
  await J('POST', '/admin/settings/update', { settings: { dailyCheckin: 0 } }, null, true);
  const H = await member(); const h0 = user(H.uid).walletBalance || 0;
  r = await J('POST', '/checkin', {}, H.tok); ok(r.s === 400 && /not available/.test(r.j.message) && (user(H.uid).walletBalance || 0) === h0 && !user(H.uid).lastCheckin, 'with the amount set to 0 the check-in is closed, and the day is not used up', r.j);
  r = await J('POST', '/admin/settings/update', { settings: { dailyCheckin: -5 } }, null, true); ok(r.j.status === 'error', 'a negative amount cannot be saved', r.j);
  r = await J('POST', '/admin/settings/update', { settings: { dailyCheckin: 1e12 } }, null, true); ok(r.j.status === 'error', 'nor an absurd one', r.j);
  await J('POST', '/admin/settings/update', { settings: { dailyCheckin: 750 } }, null, true);
  ok(((await J('GET', '/public/settings')).j.settings || {}).dailyCheckin === 750, 'the amount is public, so the app shows the real figure');
  r = await J('POST', '/checkin', {}, H.tok); ok(r.j.status === 'success' && r.j.bonus === 750, 'opened again, the member checks in for the new amount', r.j);
  await J('POST', '/admin/settings/update', { settings: { maintenanceMode: true } }, null, true);
  const I = await member().catch(() => null);
  r = await J('POST', '/checkin', {}, H.tok); ok(r.s === 503 && r.j.code === 'MAINTENANCE', 'in maintenance mode the check-in is closed with the others', { s: r.s, j: r.j });
  await J('POST', '/admin/settings/update', { settings: { maintenanceMode: false } }, null, true);
  void I;

  // ---- the live-activity strip
  r = await J('GET', '/public/activity-feed');
  const feed = r.j.feed || [];
  ok(r.s === 200 && r.j.status === 'success' && feed.length === 18 && /no-store/.test(r.h.get('cache-control') || ''), 'the strip is public, eighteen rows, never cached by the phone', { n: feed.length });
  ok(feed.every(f => (f.kind === 'deposit' || f.kind === 'withdraw') && /^256\*{4}\d{4}$/.test(f.phone) && Number.isFinite(f.amount)), 'every row is a kind, a hidden number and an amount', feed.slice(0, 3));
  ok(new Set(feed.map(f => f.phone)).size === feed.length, 'no number repeats within the strip');
  const st = (await J('GET', '/public/settings')).j.settings;
  ok(feed.filter(f => f.kind === 'deposit').every(f => f.amount >= st.minDeposit) && feed.filter(f => f.kind === 'withdraw').every(f => f.amount >= st.minWithdraw && f.amount % 5000 === 0), 'no row is below what the app itself allows (minimum top-up ' + st.minDeposit + ', minimum cash-out ' + st.minWithdraw + ')');
  const again = (await J('GET', '/public/activity-feed')).j.feed;
  ok(JSON.stringify(again) === JSON.stringify(feed), 'everybody sees the same strip for a while (it is made once and kept)');
  // the maker itself, with strict minimums
  { const src = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
    const a = src.indexOf('const _DEPOSIT_LADDER'), b = src.indexOf('let _activityFeed');
    const ctx = vm.createContext({ Math, Set, Array, Number, getSettings: async () => ({ minDeposit: 600000, minWithdraw: 250000 }), getProducts: async () => [{ price: 1500000 }, { price: 40000, deleted: true }, { price: 0 }] });
    vm.runInContext(src.slice(a, b) + '\nthis.build = buildActivityFeed;', ctx);
    const rowsHi = await ctx.build();
    ok(rowsHi.length === 18 && rowsHi.filter(x => x.kind === 'deposit').every(x => x.amount >= 600000) && rowsHi.filter(x => x.kind === 'withdraw').every(x => x.amount >= 250000 && x.amount <= 500000), 'raise the admin minimums and the strip follows them', rowsHi.slice(0, 4));
    ctx.getSettings = async () => ({ minDeposit: 5000000, minWithdraw: 9000000 });
    const rowsAbove = await ctx.build();
    ok(rowsAbove.length === 18 && rowsAbove.filter(x => x.kind === 'deposit').every(x => x.amount === 5000000) && rowsAbove.filter(x => x.kind === 'withdraw').every(x => x.amount === 9000000), 'a minimum above the whole ladder never leaves an empty pool: the floor itself is shown', rowsAbove.slice(0, 3)); }

  // ---- the member's own top-ups and cash-outs
  const K = await member(), L = await member();
  const put = (coll, id, doc) => fm.__stores[coll].set(id, Object.assign({ _id: id }, doc));
  put('pendingDeposits', 'd1', { userId: K.uid, ref: 'REF-1', amount: 30000, network: 'MTN', phone: '+256770000001', status: 'pending', date: '11/08/2026', time: '10:00:00', createdAt: new Date(Date.now() - 3000), marzUuid: 'SECRET-UUID', tavupayRef: 'tv-secret', adminNote: 'internal', syncNote: 'internal2', failureReason: 'should not show while pending' });
  put('pendingDeposits', 'd2', { userId: K.uid, ref: 'REF-2', amount: 50000, network: 'Airtel', phone: '+256750000002', status: 'matched', date: '11/07/2026', time: '09:00:00', createdAt: new Date(Date.now() - 2 * DAY), providerResponse: { raw: 'secret' } });
  put('pendingDeposits', 'd3', { userId: K.uid, ref: 'REF-3', amount: 20000, network: 'MTN', phone: '+256770000003', status: 'failed', failureReason: 'Insufficient funds', date: '11/06/2026', time: '08:00:00', createdAt: new Date(Date.now() - 3 * DAY), failedVia: 'internal path' });
  put('pendingDeposits', 'dX', { userId: L.uid, ref: 'OTHER', amount: 99999, network: 'MTN', phone: '+256770009999', status: 'matched', createdAt: new Date() });
  r = await J('GET', '/deposits', null, K.tok);
  const deps = r.j.deposits || [];
  ok(r.s === 200 && deps.length === 3 && deps.map(d => d.ref).join() === 'REF-1,REF-2,REF-3', 'a member sees their own top-ups, newest first, and nobody else\'s', deps.map(d => d.ref));
  ok(deps.every(d => Object.keys(d).every(k => ['id', 'ref', 'amount', 'network', 'phone', 'status', 'failureReason', 'date', 'time', 'createdAt'].includes(k))), 'only the fields the Ledger shows leave the server', Object.keys(deps[0]));
  ok(!/SECRET|tv-secret|internal|raw/.test(JSON.stringify(deps)), 'no gateway reference or internal note is in the answer');
  ok(deps[0].failureReason === '' && deps[2].failureReason === 'Insufficient funds', 'the reason shows only on a failed top-up');
  r = await J('GET', '/deposits'); ok(r.s === 401, 'the list needs a sign-in');
  put('withdrawals', 'w1', { userId: K.uid, ref: 'WD-1', amount: 20000, fee: 3000, net: 17000, holder: 'Jane Doe', network: 'MTN Mobile Money', phone: '+256770000001', status: 'pending', date: '11/08/2026', time: '11:00:00', createdAt: new Date(Date.now() - 1000), pinHash: 'HASH', payGw: 'tavupay', payGwRef: 'secret-ref', adminNote: 'internal' });
  put('withdrawals', 'w2', { userId: K.uid, ref: 'WD-2', amount: 25000, fee: 3750, net: 21250, holder: 'Jane Doe', network: 'Airtel Money', phone: '+256750000002', status: 'declined', rejectReason: 'Wrong number', failureReason: '', date: '11/05/2026', time: '11:00:00', createdAt: new Date(Date.now() - 4 * DAY) });
  put('withdrawals', 'w3', { userId: K.uid, ref: 'WD-3', amount: 30000, fee: 4500, net: 25500, holder: 'Jane Doe', network: 'MTN Mobile Money', phone: '+256770000001', status: 'processed', failureReason: 'old', date: '11/04/2026', time: '11:00:00', createdAt: new Date(Date.now() - 5 * DAY) });
  put('withdrawals', 'wX', { userId: L.uid, ref: 'OTHER-WD', amount: 77777, fee: 1, net: 1, status: 'processed', createdAt: new Date() });
  r = await J('GET', '/withdrawals', null, K.tok);
  const wds = r.j.withdrawals || [];
  ok(r.s === 200 && wds.map(w => w.ref).join() === 'WD-1,WD-2,WD-3', 'a member sees their own cash-outs, newest first, and nobody else\'s', wds.map(w => w.ref));
  ok(wds.every(w => Object.keys(w).every(k => ['id', 'ref', 'amount', 'fee', 'net', 'holder', 'network', 'phone', 'status', 'failureReason', 'date', 'time', 'createdAt'].includes(k))) && !/HASH|secret-ref|tavupay|internal/.test(JSON.stringify(wds)), 'only the fields the Ledger shows leave the server (no Trade Password hash, no gateway, no note)', Object.keys(wds[0]));
  ok(wds[0].failureReason === '' && wds[1].failureReason === 'Wrong number' && wds[2].failureReason === '', 'the reason shows only on a declined cash-out (the admin\'s reject reason included)');
  r = await J('GET', '/withdrawals'); ok(r.s === 401, 'this list needs a sign-in too');
  const none = await member();
  ok(((await J('GET', '/deposits', null, none.tok)).j.deposits || []).length === 0 && ((await J('GET', '/withdrawals', null, none.tok)).j.withdrawals || []).length === 0, 'a member with nothing gets empty lists, not an error');
  for (let i = 0; i < 130; i++) put('pendingDeposits', 'bulk' + i, { userId: none.uid, ref: 'B' + i, amount: 1000 + i, status: 'matched', createdAt: new Date(Date.now() - i * 1000) });
  const big = (await J('GET', '/deposits', null, none.tok)).j.deposits || [];
  ok(big.length === 100 && big[0].ref === 'B0', 'a very long history is cut at the newest 100', { n: big.length });

  realLog(fails ? fails + ' FAILED of ' + checks : 'PASS: check-in, activity strip and ledger lists (' + checks + ' checks)');
  process.exit(fails ? 1 : 0);
})().catch(e => { realLog('FATAL', e); process.exit(1); });
