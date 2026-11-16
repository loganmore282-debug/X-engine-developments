'use strict';
// Lucky Cards (Rewards tab): a chance for every credited recharge, one flip spends one chance and pays what the server drew (earnings in the admin's range, or a listed
// robot), the VIP gate, the chance given back when the prize cannot be paid, and that a member cannot flip without a chance or twice at once. Real server.js source against mocks.
//   node test-lucky.js
const fs = require('node:fs'), assert = require('node:assert/strict'), crypto = require('node:crypto');
let checks = 0; const ok = (c, m) => { checks++; assert.ok(c, m); }; const eq = (a, b, m) => { checks++; assert.deepEqual(a, b, m); };
const src = fs.readFileSync(__dirname + '/server.js', 'utf8');
const a = src.indexOf('/* ====================== LUCKY CARDS'), b = src.indexOf('// The live-activity strip on Home', a);
ok(a >= 0 && b > a, 'the Lucky Cards block is in server.js');
const block = src.slice(a, b);
ok(/'\/withdraw\/request', '\/invest\/create', '\/lucky\/flip'/.test(src), 'a flip has the strict per-member rate limit');
ok(/const chance = lk\.on && depAmount >= lk\.minDeposit \? \{ luckyChances: FieldValue\.increment\(1\) \} : \{\};/.test(src) && /creditedDepositIds: FieldValue\.arrayUnion\(depDoc\.id\), \.\.\.referral, \.\.\.chance/.test(src),
  'the chance is written in the SAME atomic update as the recharge credit (so a retry can never give a second one)');
ok(/'mission_deposit_reward', 'checkin', 'lucky_card'\]/.test(src), 'the integrity audit counts a Lucky Cards prize as earnings');

const INC = { __inc: true };
function makeDb() {
  const cols = new Map(); let failNext = null, failSkip = 0;
  const col = name => { if (!cols.has(name)) cols.set(name, new Map()); return cols.get(name); };
  const apply = (row, v) => { for (const [k, x] of Object.entries(structuredClone(v))) { if (x && x.__inc) row[k] = (row[k] || 0) + x.n; else row[k] = x; } };
  const matches = (r, f) => Object.keys(f).every(k => { const c = f[k]; if (c && typeof c === 'object') { if ('$ne' in c) return r[k] !== c.$ne; if ('$gt' in c) return (r[k] || 0) > c.$gt; } return r[k] === c; });
  const refOf = (name, id) => ({
    id,
    get: async () => { const r = col(name).get(id); return { id, exists: !!r, data: () => r && structuredClone(r), ref: refOf(name, id) }; },
    set: async v => { const r = {}; apply(r, v); col(name).set(id, r); },
    update: async v => { if (failNext === name && !failSkip--) { failNext = null; throw new Error('boom'); } const r = col(name).get(id); if (!r) throw new Error('NOT_FOUND'); apply(r, v); },
    updateIf: async (f, v) => { const r = col(name).get(id); if (!r || !matches(r, f)) return false; if (failNext === name && !failSkip--) { failNext = null; throw new Error('boom'); } apply(r, v); return true; },
    createIfAbsent: async v => { if (col(name).has(id)) return false; const r = {}; apply(r, v); col(name).set(id, r); return true; },
  });
  return { col, failOn: (n, skip) => { failNext = n; failSkip = skip || 0; }, collection: name => ({ doc: id => refOf(name, id) }) };
}
function build(db, ctx) {
  const handlers = {};
  const app = { post: (p, h) => { handlers['POST ' + p] = h; } };
  const locks = new Map();
  const withLock = async (key, fn) => { while (locks.get(key)) await locks.get(key); let done; locks.set(key, new Promise(r => { done = r; })); try { return await fn(); } finally { locks.delete(key); done(); } };
  const mk = new Function('app', 'db', 'crypto', 'FieldValue', 'getSettings', 'getProducts', 'verifyAuth', 'withLock', 'memberVipLevel', 'nowStr', 'newStatementId', 'productExpectedReturn', 'payoutDueAtMs', '_vipCache',
    'const armPayoutAt = () => {};\n' + block + '\nreturn { luckyCfg, luckyRollAmount, luckyView };');
  const api = mk(app, db, crypto, { increment: n => ({ __inc: true, n }), serverTimestamp: () => 'ts' }, async () => ctx.sett, async () => ctx.products, async () => ctx.user, withLock,
    async () => ctx.vip, () => ({ date: '01-01-2026', time: '10:00' }), () => 'S1', p => (Number(p.price) || 0) * 3, () => Date.now() + 86400000, new Map());
  return { H: handlers, api };
}
async function call(h, body = {}) { const out = { code: 200, body: null }; await h({ body, headers: {} }, { status(c) { out.code = c; return this; }, json(x) { out.body = x; return this; } }); return out; }

(async () => {
  const db = makeDb();
  const ctx = { user: 'u1', vip: 0, products: [{ key: 'p1', name: 'Smart AI C', price: 90000, vip: 3, cycle: 8, image: '' }, { key: 'p2', name: 'Smart AI D', price: 270000, vip: 4, deleted: true }],
    sett: { luckyOn: true, luckyMinDeposit: 0, luckyMinAmount: 1000, luckyMaxAmount: 1000, luckyMinVip: 0, luckyProductPct: 0, luckyProducts: [] } };
  const { H, api } = build(db, ctx);
  const flip = () => call(H['POST /lucky/flip']);
  db.col('users').set('u1', { status: 'active', walletBalance: 0, totalEarned: 0, luckyChances: 2, registrationDone: true });

  // ---- the settings ----
  const C = api.luckyCfg;
  eq(C({}), { on: true, minDeposit: 0, minAmount: 500, maxAmount: 5000, minVip: 0, productPct: 10, productKeys: [] }, 'the defaults');
  eq([C({ luckyMinAmount: 9000, luckyMaxAmount: 100 }).minAmount, C({ luckyMinAmount: 9000, luckyMaxAmount: 100 }).maxAmount], [100, 9000], 'a reversed range is put the right way round');
  ok(C({ luckyOn: false }).on === false, 'switched off');
  for (let i = 0; i < 300; i++) { const v = api.luckyRollAmount({ minAmount: 500, maxAmount: 5000 }); if (v < 500 || v > 5000 || v % 100 !== 0) ok(false, 'a wide range gives whole hundreds inside the range: ' + v); }
  for (let i = 0; i < 100; i++) { const v = api.luckyRollAmount({ minAmount: 10, maxAmount: 20 }); if (v < 10 || v > 20 || !Number.isInteger(v)) ok(false, 'a narrow range gives whole numbers inside it: ' + v); }
  ok(api.luckyRollAmount({ minAmount: 700, maxAmount: 700 }) === 700, 'min = max pays exactly that');

  // ---- a plain flip pays the earnings ----
  let r = await flip();
  ok(r.code === 200 && r.body.prize.kind === 'cash' && r.body.prize.amount === 1000 && r.body.chances === 1 && r.body.others.length === 8, 'a flip pays UGX 1,000 and shows the other eight cards: ' + JSON.stringify(r.body).slice(0, 120));
  let u = db.col('users').get('u1');
  ok(u.walletBalance === 1000 && u.totalEarned === 1000 && u.luckyChances === 1, 'wallet +1,000, earned +1,000, one chance left');
  const tx = [...db.col('transactions').values()];
  ok(tx.length === 1 && tx[0].type === 'lucky_card' && tx[0].amount === 1000 && tx[0].status === 'success', 'one ledger row, type lucky_card');
  ok(db.col('luckyFlips').size === 0 || [...db.col('luckyFlips').values()][0].kind === 'cash', 'the flip is recorded');

  // ---- no chance, then no flip ----
  r = await flip(); ok(r.code === 200 && db.col('users').get('u1').luckyChances === 0, 'the last chance is used');
  r = await flip(); ok(r.code === 400 && r.body.code === 'NO_CHANCE' && db.col('users').get('u1').walletBalance === 2000, 'with no chance left a flip is refused and pays nothing');

  // ---- two taps at once spend only one chance ----
  db.col('users').get('u1').luckyChances = 1;
  const both = await Promise.all([flip(), flip()]);
  ok(both.filter(x => x.code === 200).length === 1 && both.filter(x => x.body.code === 'NO_CHANCE').length === 1 && db.col('users').get('u1').walletBalance === 3000, 'two taps at once pay once');

  // ---- the VIP gate ----
  ctx.sett.luckyMinVip = 3; ctx.vip = 2; db.col('users').get('u1').luckyChances = 3;
  r = await flip(); ok(r.code === 403 && r.body.code === 'VIP_REQUIRED' && /VIP 3/.test(r.body.message) && db.col('users').get('u1').luckyChances === 3, 'below VIP 3: refused, and the chances are kept');
  ctx.vip = 3; r = await flip(); ok(r.code === 200 && db.col('users').get('u1').luckyChances === 2, 'at VIP 3 the same member can flip');
  ctx.sett.luckyMinVip = 0;

  // ---- switched off / banned / not signed up ----
  ctx.sett.luckyOn = false; r = await flip(); ok(r.code === 400 && r.body.code === 'LUCKY_OFF', 'off: refused'); ctx.sett.luckyOn = true;
  db.col('users').get('u1').status = 'banned'; r = await flip(); ok(r.code === 403, 'a banned member cannot flip'); db.col('users').get('u1').status = 'active';
  db.col('users').get('u1').registrationDone = false; r = await flip(); ok(r.code === 409, 'sign-up not finished: refused'); db.col('users').get('u1').registrationDone = true;
  ctx.user = null; r = await flip(); ok(r.code === 401, 'signed out: 401'); ctx.user = 'u1';

  // ---- robots ----
  ctx.sett.luckyProductPct = 100; ctx.sett.luckyProducts = ['p1', 'p2', 'ghost'];
  const before = db.col('users').get('u1').walletBalance;
  r = await flip();
  ok(r.code === 200 && r.body.prize.kind === 'robot' && r.body.prize.key === 'p1' && r.body.prize.name === 'Smart AI C', 'with 100% robot chance the card is the listed robot (a deleted or unknown key is never given)');
  const inv = [...db.col('investments').entries()];
  ok(inv.length === 1 && inv[0][1].userId === 'u1' && inv[0][1].tierKey === 'p1' && inv[0][1].granted === true && inv[0][1].grantedBy === 'lucky-cards' && inv[0][1].status === 'active' && inv[0][1].expectedReturn === 270000, 'the robot is an active plan for the member, paying like any other');
  ok(db.col('users').get('u1').walletBalance === before && db.col('users').get('u1').totalInvested === 90000, 'no wallet money; the robot counts as invested');
  ok(r.body.others.every(o => o.kind === 'robot' || o.kind === 'cash'), 'the other cards are shown as earnings or robots');
  ctx.sett.luckyProducts = []; r = await flip(); ok(r.body.prize.kind === 'cash', 'no robot listed: earnings only, whatever the robot chance');

  // ---- a prize that cannot be paid gives the chance back ----
  ctx.sett.luckyProductPct = 0; const chBefore = db.col('users').get('u1').luckyChances; db.col('users').get('u1').luckyChances = 5;
  db.failOn('users', 1); // the chance is taken (1st write), then the wallet credit (2nd) throws once
  r = await flip();
  ok(r.code === 500 && /still there/.test(r.body.message), 'a failed payout says the chance is still there');
  ok(db.col('users').get('u1').luckyChances === 5, 'and the chance is back (5 of 5)');
  void chBefore;

  // ---- what the page is told ----
  const view = await api.luckyView({ luckyChances: 4.7 }, 5);
  ok(view.chances === 4 && view.vip === 5 && view.on === true && view.minAmount === 1000, 'luckyView: whole chances, the VIP, the range');
  ctx.sett.luckyProductPct = 10; ctx.sett.luckyProducts = ['p1'];
  ok((await api.luckyView({ luckyChances: 0 }, 0)).hasProducts === true, 'luckyView: robots are on offer when one is listed');
  ctx.sett.luckyProducts = ['p2']; ok((await api.luckyView({}, 0)).hasProducts === false, 'a deleted robot does not count');

  console.log('test-lucky: ' + checks + ' checks passed');
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
