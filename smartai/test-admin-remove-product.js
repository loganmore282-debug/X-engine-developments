'use strict';
// Owner removes a product from a member (POST /admin/user/remove-product). The REAL route source is run against an
// in-memory store: owner-only, the member's wallet and totalInvested, the optional refund, a gifted product, two
// simultaneous clicks, a retry after a crash between the wallet update and the delete, and the audit log.
const fs = require('node:fs'), assert = require('node:assert/strict');
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); }; const eq = (a, b, m) => { n++; assert.deepEqual(a, b, m); };
const src = fs.readFileSync(__dirname + '/server.js', 'utf8');
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i + 1); assert.ok(i > 0 && j > i, 'markers ' + a); return src.slice(i, j); };
const routeSrc = cut("app.post('/admin/user/remove-product'", '// Owner gives a member');
const lockSrc = cut('function withLock(key, fn) {', 'const _userBeingDeleted');

function setup(users, invs) {
  const store = { users: new Map(Object.entries(users)), investments: new Map(Object.entries(invs)), transactions: new Map() };
  const clone = v => JSON.parse(JSON.stringify(v));
  const FieldValue = { serverTimestamp: () => 'TS', increment: n => ({ __inc: n }), arrayUnion: (...a) => ({ __union: a }) };
  const apply = (cur, patch) => { const o = { ...cur }; for (const [k, v] of Object.entries(patch)) {
    if (v && v.__inc !== undefined) o[k] = (Number(o[k]) || 0) + v.__inc;
    else if (v && v.__union) o[k] = Array.from(new Set([...(o[k] || []), ...v.__union]));
    else o[k] = v; } return o; };
  const delay = () => new Promise(r => setImmediate(r));
  const db = { collection: n => ({ doc: id => ({
    get: async () => { await delay(); const v = store[n].get(id); return { id, exists: v !== undefined, data: () => clone(v) }; },
    update: async p => { await delay(); if (!store[n].has(id)) throw new Error('NOT_FOUND'); store[n].set(id, apply(store[n].get(id), p)); },
    updateIf: async (f, p) => { await delay(); const cur = store[n].get(id); if (!cur) return false;
      for (const [k, c] of Object.entries(f)) if (c && c.$ne !== undefined && Array.isArray(cur[k]) && cur[k].includes(c.$ne)) return false;
      store[n].set(id, apply(cur, p)); return true; },
    createIfAbsent: async d => { await delay(); if (store[n].has(id)) return false; store[n].set(id, apply({}, clone(d))); return true; },
    delete: async () => { await delay(); store[n].delete(id); },
  }) }) };
  let handler; const app = { post: (p, h) => { if (p === '/admin/user/remove-product') handler = h; } };
  const audit = [], vip = [];
  const factory = new Function('app', 'db', 'FieldValue', 'verifyOwner', 'finiteMoney', 'nowStr', 'newStatementId', 'logAdminAction', 'fmtMoney', '_vipCache',
    'const _lockTails = new Map();\n' + lockSrc + '\n' + routeSrc + '\nreturn withLock;');
  factory(app, db, FieldValue, req => req.__owner === true, v => (Number.isFinite(Number(v)) ? Number(v) : 0), () => ({ date: 'd', time: 't' }), () => 'S1',
    (req, a, m) => audit.push([a, m]), v => 'UGX ' + v, { delete: id => vip.push(id) });
  const call = async (body, owner = true) => { const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await handler({ body, __owner: owner }, res); return res; };
  return { store, call, audit, vip };
}
const mk = () => setup(
  { u1: { phone: '0700', walletBalance: 10000, totalInvested: 90000, status: 'active' }, u2: { phone: '0701', walletBalance: 0, totalInvested: 30000 } },
  { i1: { userId: 'u1', tierKey: 'p', tierLabel: 'Bought', amount: 30000, paidOut: 22500, payoutsMade: 2, status: 'active' },
    g1: { userId: 'u1', tierKey: 'p', tierLabel: 'Gift', amount: 30000, granted: true, paidOut: 0, status: 'active' },
    i2: { userId: 'u1', tierKey: 'p', tierLabel: 'Bought2', amount: 30000, paidOut: 0, status: 'active' },
    x1: { userId: 'u2', tierKey: 'p', tierLabel: 'Other', amount: 30000, status: 'active' } });

(async () => {
  let t = mk(), r;
  r = await t.call({ userId: 'u1', investmentId: 'i1', refund: true }, false); eq(r.code, 401, 'staff cannot remove products'); ok(t.store.investments.has('i1'), 'nothing removed');
  r = await t.call({ userId: 'u1' }); eq(r.code, 400, 'investmentId required');
  r = await t.call({ userId: 'u1', investmentId: 'x'.repeat(200) }); eq(r.code, 400, 'absurd id refused');
  r = await t.call({ userId: 'u1', investmentId: 'nope' }); eq(r.code, 404, 'unknown product');
  r = await t.call({ userId: 'u1', investmentId: 'x1', refund: true }); eq(r.code, 404, "another member's product is not found on this member"); ok(t.store.investments.has('x1'));
  r = await t.call({ userId: 'u1', investmentId: { $ne: 1 } }); ok(r.code >= 400 && r.code < 500, 'object id refused cleanly');

  // no refund
  t = mk(); r = await t.call({ userId: 'u1', investmentId: 'i1', refund: false });
  eq([r.code, r.body.status, r.body.refunded], [200, 'success', 0], 'removed without refund');
  eq([t.store.users.get('u1').walletBalance, t.store.users.get('u1').totalInvested], [10000, 60000], 'wallet untouched, totalInvested down by the amount');
  ok(!t.store.investments.has('i1') && t.store.investments.size === 3, 'the product is deleted, the others stay');
  eq(t.store.transactions.size, 0, 'no refund row'); eq(t.audit.map(a => a[0]), ['product_removed'], 'audit logged');
  eq([t.audit[0][1].amount, t.audit[0][1].paidOut, t.audit[0][1].refunded, t.audit[0][1].payoutsMade], [30000, 22500, 0, 2], 'the audit keeps what the product had paid'); eq(t.vip, ['u1'], 'VIP cache cleared');

  // refund
  t = mk(); r = await t.call({ userId: 'u1', investmentId: 'i1', refund: true });
  eq([r.code, r.body.refunded], [200, 30000], 'removed with refund');
  eq([t.store.users.get('u1').walletBalance, t.store.users.get('u1').totalInvested], [40000, 60000], 'wallet +30,000 once, totalInvested -30,000');
  const rows = [...t.store.transactions.values()]; eq(rows.length, 1); eq([rows[0].type, rows[0].amount, rows[0].userId, rows[0].investmentId], ['investment_refund', 30000, 'u1', 'i1'], 'one refund row in the ledger');
  r = await t.call({ userId: 'u1', investmentId: 'i1', refund: true }); eq(r.code, 404, 'again: not found'); eq(t.store.users.get('u1').walletBalance, 40000, 'no second refund');

  // the refund flag must be exactly true
  t = mk(); r = await t.call({ userId: 'u1', investmentId: 'i1', refund: 'yes' }); eq(r.body.refunded, 0, 'the string "yes" does not refund'); eq(t.store.users.get('u1').walletBalance, 10000);

  // gifted
  t = mk(); r = await t.call({ userId: 'u1', investmentId: 'g1', refund: true }); eq(r.code, 400, 'gifted + refund refused'); ok(/never paid for/.test(r.body.message) && t.store.investments.has('g1'), 'and nothing changed');
  r = await t.call({ userId: 'u1', investmentId: 'g1', refund: false }); eq([r.code, t.store.users.get('u1').walletBalance, t.store.users.get('u1').totalInvested], [200, 10000, 60000], 'gifted removed without refund');

  // two simultaneous clicks
  t = mk(); const par = await Promise.all(Array.from({ length: 6 }, () => t.call({ userId: 'u1', investmentId: 'i2', refund: true })));
  eq(par.filter(x => x.code === 200).length, 1, 'exactly one of six simultaneous removals succeeds'); eq(par.filter(x => x.code === 404).length, 5);
  eq(t.store.users.get('u1').walletBalance, 40000, 'refunded once'); eq([...t.store.transactions.values()].length, 1);

  // crash after the atomic user update but before the delete: the retry must not refund again and must repair the row
  t = mk(); const u = t.store.users.get('u1'); u.walletBalance += 30000; u.totalInvested -= 30000; u.creditedPayoutKeys = ['remove:i1'];
  r = await t.call({ userId: 'u1', investmentId: 'i1', refund: true });
  eq([r.code, t.store.users.get('u1').walletBalance, t.store.users.get('u1').totalInvested], [200, 40000, 60000], 'retry: no second refund, no second totalInvested drop');
  ok(!t.store.investments.has('i1') && t.store.transactions.has('remove-refund:i1'), 'retry: the product is deleted and the ledger row is repaired');

  // lock order matches the cashback settlement (payout first, then balance) so the two cannot deadlock
  ok(routeSrc.indexOf("withLock('payout:' + invId") > -1 && routeSrc.indexOf("withLock('payout:' + invId") < routeSrc.indexOf("withLock('bal:' + userId"), 'locks are taken in the same order as the cashback settlement');
  // panel and app wiring
  const admin = fs.readFileSync(__dirname + '/admin-src/index.html', 'utf8'), app = fs.readFileSync(__dirname + '/user-src/original_module.js', 'utf8');
  ok(/data-rmprod/.test(admin) && /\/admin\/user\/remove-product/.test(admin) && /SESSION_ROLE==='owner'\?`<div style="margin-top:5px"><button class="btn danger sm" data-rmprod/.test(admin), 'the owner sees a Remove button under each product in the user window');
  ok(/investment_refund: 'Product refund'/.test(admin) && /investment_refund'\) return 'Refund'/.test(app), 'a refund row has a name in the panel and on the member\'s Balance Record');
  console.log(`PASS: remove a product from a member (${n} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
