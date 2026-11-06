'use strict';
// Myteam > Reward: each tier is claimed ONCE per member, for good (no "tomorrow"). Runs the real /salary/claim and /salary/status handlers.
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const src = fs.readFileSync(__dirname + '/server.js', 'utf8');
const section = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i + a.length); assert(i >= 0 && j > i, 'anchor ' + a); return src.slice(i, j); };
const t0 = fs.readFileSync(__dirname + '/test-audit-money-regressions.js', 'utf8');
const { FV, makeDb } = new Function('structuredClone', 'assert', t0.slice(t0.indexOf('const FV = {'), t0.indexOf('function response()')) + '\nreturn { FV, makeDb };')(structuredClone, assert);
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); }; const eq = (a, b, m) => { n++; assert.deepEqual(a, b, m); };

function world(user, total) {
  const db = makeDb({ users: { u: Object.assign({ walletBalance: 0, totalEarned: 0, status: 'active' }, user) }, transactions: {} });
  const col = db.collection.bind(db);
  const ledger = {};
  db.collection = name => { const c = col(name); const d = c.doc.bind(c); c.doc = id => { const r = d(id); r.createIfAbsent = async v => { if (ledger[name + '/' + id]) return false; ledger[name + '/' + id] = v; return true; }; return r; }; return c; };
  const routes = {};
  const tiers = [{ id: 's1', target: 500000, reward: 2000 }, { id: 's2', target: 1000000, reward: 4000 }, { id: 's3', target: 3000000, reward: 6000 }];
  const c = vm.createContext({ db, FieldValue: FV, crypto, Date, Math, Map, Set, Number, String, Array, console: { log() {}, warn() {}, error() {} },
    app: { get: (p, h) => { routes['GET ' + p] = h; }, post: (p, h) => { routes[p] = h; } }, _lockTails: new Map(),
    verifyAuth: async () => 'u', getSettings: async () => ({ salaryTiers: tiers }), wholeTeamStats: async () => ({ purchases: total.v }), taskRows: r => r,
    nowStr: () => ({ date: 'd', time: 't' }), newStatementId: () => 'st', round2: x => Math.round(x * 100) / 100, fmtMoney: x => 'UGX ' + x });
  vm.runInContext(section('function withLock(key, fn)', 'const _userBeingDeleted'), c);
  vm.runInContext(section('function salaryTierFor', "// The old Task Center and Mission Center claim routes"), c);
  const call = async (key, body) => { const res = { code: 200, status(x) { this.code = x; return this; }, json(b) { this.body = b; return this; } }; await routes[key]({ body: body || {}, headers: {} }, res); return res; };
  return { call, db, ledger, user: () => db.rows.users.u };
}
(async () => {
  const total = { v: 700000 };
  let w = world({}, total);
  let r = await w.call('GET /salary/status');
  eq(r.body.tiers.map(t => [t.id, t.reached, t.claimed]), [['s1', true, false], ['s2', false, false], ['s3', false, false]], 'status: tier 1 reached, none claimed');
  r = await w.call('/salary/claim', { tierId: 's1' }); eq([r.code, r.body.amount], [200, 2000]); eq(w.user().walletBalance, 2000); eq(w.user().claimedSalaryTiers, ['s1']);
  ok(w.ledger['transactions/salary:u:tier:s1'] && w.ledger['transactions/salary:u:tier:s1'].amount === 2000, 'one ledger row for the tier');
  // the SAME tier again -- now, "tomorrow", any time: never again
  r = await w.call('/salary/claim', { tierId: 's1' }); eq(r.code, 409); ok(/already claimed/.test(r.body.message)); eq(w.user().walletBalance, 2000, 'not paid twice');
  r = await w.call('/salary/claim', {}); eq(r.code, 400); ok(/already claimed every reward/.test(r.body.message), 'an older app that names no tier is told the same'); eq(w.user().walletBalance, 2000);
  r = await w.call('GET /salary/status'); eq(r.body.tiers[0].claimed, true, 'status keeps it Claimed'); eq(r.body.accruedDays, 0);
  // an unreached tier cannot be claimed, even by naming it
  r = await w.call('/salary/claim', { tierId: 's2' }); eq(r.code, 400); ok(/more to claim/.test(r.body.message)); eq(w.user().walletBalance, 2000);
  r = await w.call('/salary/claim', { tierId: 'nope' }); eq(r.code, 400);
  // the team grows: the next tier opens, once
  total.v = 1200000; r = await w.call('/salary/claim', { tierId: 's2' }); eq([r.code, r.body.amount], [200, 4000]); eq(w.user().walletBalance, 6000);
  r = await w.call('/salary/claim', { tierId: 's2' }); eq(r.code, 409); eq(w.user().walletBalance, 6000);
  // two taps at once pay once
  total.v = 5000000; w = world({}, total);
  const both = await Promise.all([w.call('/salary/claim', { tierId: 's3' }), w.call('/salary/claim', { tierId: 's3' })]);
  eq(both.map(x => x.code).sort(), [200, 409], 'a double tap pays once'); eq(w.user().walletBalance, 6000);
  // an older app with no tier id claims the lowest open reward, one per tap, then runs out
  w = world({}, total); const paid = [];
  for (let i = 0; i < 4; i++) { r = await w.call('/salary/claim', {}); paid.push(r.code === 200 ? r.body.amount : r.code); }
  eq(paid, [2000, 4000, 6000, 400], 'one tap, one reward, each tier once'); eq(w.user().walletBalance, 12000);
  // a member from the earlier DAILY wage (paid at the second tier) does not get those tiers again
  w = world({ salaryTierReward: 4000 }, total);
  r = await w.call('GET /salary/status'); eq(r.body.tiers.map(t => t.claimed), [true, true, false], 'tiers up to the one they were paid at count as claimed');
  r = await w.call('/salary/claim', { tierId: 's1' }); eq(r.code, 409, 'not paid again'); eq(w.user().walletBalance, 0);
  // a banned member is refused
  w = world({ status: 'banned' }, total); r = await w.call('/salary/claim', { tierId: 's1' }); eq(r.code, 403); eq(w.user().walletBalance, 0);
  // ── the one-time migration: members paid under the old daily wage get their tiers written down as claimed, even if the amounts are edited later ──
  {
    const mig = src.slice(src.indexOf('async function migrateRewardsToClaimOnce'), src.indexOf('// The old Task Center and Mission Center claim routes'));
    const db = makeDb({ meta: {}, transactions: { t1: { type: 'mission_salary', userId: 'a', amount: 4000 }, t2: { type: 'mission_salary', userId: 'a', amount: 2000 }, t3: { type: 'mission_salary', userId: 'b', amount: 2000 }, t4: { type: 'cashback', userId: 'c', amount: 9999 } },
      users: { a: {}, b: { creditedSalaryDays: [1] }, c: { salaryTierReward: 6000 }, d: {}, e: { salaryTierReward: 2000, claimedSalaryTiers: ['s1'] } } });
    const tiers = [{ id: 's1', target: 1, reward: 2000 }, { id: 's2', target: 2, reward: 4000 }, { id: 's3', target: 3, reward: 6000 }];
    const c = vm.createContext({ db, FieldValue: FV, getSettings: async () => ({ salaryTiers: tiers }), taskRows: r => r, Math, Number, Array, Date, Map });
    vm.runInContext(mig, c);
    eq(await c.migrateRewardsToClaimOnce(), 4, 'four members had been paid the daily wage');
    const U = id => db.rows.users[id].claimedSalaryTiers;
    eq([U('a'), U('b'), U('c'), U('d'), U('e')], [['s1', 's2'], ['s1'], ['s1', 's2', 's3'], undefined, ['s1']], 'a: largest ledger payment 4000 -> tiers 1-2; b: 2000 -> tier 1; c: recorded tier reward 6000 -> all; d never claimed -> nothing');
    eq(await c.migrateRewardsToClaimOnce(), 0, 'it runs once'); ok(db.rows.meta.rewardClaimOnce, 'and leaves its marker');
  }
  ok(/migrateRewardsToClaimOnce\(\)\.then/.test(src), 'it is started at boot');
  console.log('PASS: Myteam rewards are claim-once (' + n + ' checks)');
})().catch(e => { console.error(e); process.exit(1); });
