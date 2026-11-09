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
  vm.runInContext('_rewardRepair.done = true', c);   // the start-up repair has finished (its own test is below)
  const call = async (key, body) => { const res = { code: 200, status(x) { this.code = x; return this; }, json(b) { this.body = b; return this; } }; await routes[key]({ body: body || {}, headers: {} }, res); return res; };
  return { call, db, ledger, ctx: c, user: () => db.rows.users.u };
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
  // THE BUG THE OWNER SAW: the old daily code wrote `salaryTierReward` just for opening the tab, so it proves nothing -- a member who only LOOKED
  // (nothing paid) must see every tier open, not Claimed
  w = world({ salaryTierReward: 6000 }, total);
  r = await w.call('GET /salary/status'); eq(r.body.tiers.map(t => t.claimed), [false, false, false], 'a recorded tier reward alone never marks a tier Claimed');
  r = await w.call('/salary/claim', { tierId: 's1' }); eq([r.code, r.body.amount], [200, 2000], 'and it can still be claimed'); eq(w.user().walletBalance, 2000);
  // until the start-up repair has finished, neither route answers (a stale claimed list could pay a tier twice)
  w = world({}, total); vm.runInContext('_rewardRepair.done = false', w.ctx);
  r = await w.call('GET /salary/status'); eq(r.code, 503, 'status waits for the repair'); r = await w.call('/salary/claim', { tierId: 's1' }); eq(r.code, 503, 'claim waits for the repair'); eq(w.user().walletBalance, 0, 'nothing paid meanwhile');
  vm.runInContext('_rewardRepair.done = true', w.ctx); r = await w.call('/salary/claim', { tierId: 's1' }); eq(r.code, 200, 'and works once it has finished');
  // a banned member is refused
  w = world({ status: 'banned' }, total); r = await w.call('/salary/claim', { tierId: 's1' }); eq(r.code, 403); eq(w.user().walletBalance, 0);
  // ── the one-time migration: tiers written down as claimed ONLY from real payment rows, replacing wrong marks left by the first version ──
  {
    const mig = src.slice(src.indexOf('async function migrateRewardsToClaimOnce'), src.indexOf('// The old Task Center and Mission Center claim routes'));
    const db = makeDb({ meta: { rewardClaimOnce: { at: 1 } }, transactions: {
      t1: { type: 'mission_salary', userId: 'a', amount: 4000 }, t2: { type: 'mission_salary', userId: 'a', amount: 2000 },
      t3: { type: 'mission_salary', userId: 'b', amount: 2000 }, t4: { type: 'cashback', userId: 'c', amount: 9999 },
      t5: { type: 'mission_salary', userId: 'f', amount: 6000, salaryTier: 's3' } },
      users: { a: {}, b: { creditedSalaryDays: [1] }, c: { salaryTierReward: 6000, claimedSalaryTiers: ['s1', 's2', 's3'] }, d: { salaryTierReward: 6000 },
        e: { claimedSalaryTiers: ['s1', 's2'] }, f: {}, g: { claimedSalaryTiers: ['s1'] } } });
    const tiers = [{ id: 's1', target: 1, reward: 2000 }, { id: 's2', target: 2, reward: 4000 }, { id: 's3', target: 3, reward: 6000 }];
    const c = vm.createContext({ db, FieldValue: FV, getSettings: async () => ({ salaryTiers: tiers }), taskRows: r => r, Math, Number, Array, Date, Map, Set, _lockTails: new Map(), Promise, setTimeout, console: { log() {}, warn() {}, error() {} } });
    vm.runInContext(section('function withLock(key, fn)', 'const _userBeingDeleted'), c);
    vm.runInContext(mig, c);
    // the OLD marker (first version) does not stop the repair
    eq(await c.migrateRewardsToClaimOnce(), 6, 'a, b, c (wrong marks removed), e (wrong marks removed), f, g (wrong mark removed) change; d is untouched');
    const U = id => db.rows.users[id].claimedSalaryTiers;
    eq([U('a'), U('b'), U('c'), U('d'), U('e'), U('f'), U('g')], [['s1', 's2'], ['s1'], [], undefined, [], ['s3'], []],
      'a: paid up to 4000 -> tiers 1-2; b: paid 2000 -> tier 1; c/e/g: never paid -> the wrong marks are cleared; d: only looked -> nothing; f: a tier-3 claim row -> tier 3');
    eq(await c.migrateRewardsToClaimOnce(), 0, 'it runs once'); ok(db.rows.meta.rewardClaimOnceV2, 'and leaves its marker');
    // a member CLAIMS a tier while the repair is running (after the members were read): that claim survives, even before its ledger row exists
    const db2 = makeDb({ meta: {}, transactions: {}, users: { h: { claimedSalaryTiers: ['s1'] }, i: {} } });
    const col2 = db2.collection.bind(db2);
    db2.collection = name => { const cc = col2(name); if (name === 'transactions') { const w = cc.where.bind(cc); cc.where = (...a) => { db2.rows.users.i.claimedSalaryTiers = ['s2']; db2.rows.users.h.claimedSalaryTiers = ['s1', 's3']; return w(...a); }; } return cc; };
    const c2 = vm.createContext({ db: db2, FieldValue: FV, getSettings: async () => ({ salaryTiers: tiers }), taskRows: r => r, Math, Number, Array, Date, Map, Set, _lockTails: new Map(), Promise, setTimeout, console: { log() {}, warn() {}, error() {} } });
    vm.runInContext(section('function withLock(key, fn)', 'const _userBeingDeleted'), c2); vm.runInContext(mig, c2);
    await c2.migrateRewardsToClaimOnce();
    eq([db2.rows.users.h.claimedSalaryTiers, db2.rows.users.i.claimedSalaryTiers], [['s3'], ['s2']], 'h: the unpaid wrong mark (tier 1) is cleared but the tier claimed DURING the repair (tier 3) is kept; i: a claim made during the repair is kept');
  }
  ok(/startRewardRepair\(\);/.test(src.slice(src.indexOf('app.listen') - 4000)) || /^\s+startRewardRepair\(\);/m.test(src), 'the repair is started at boot');
  console.log('PASS: Myteam rewards are claim-once (' + n + ' checks)');
})().catch(e => { console.error(e); process.exit(1); });
