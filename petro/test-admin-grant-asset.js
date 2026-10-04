'use strict';
// Owner gives a member an asset (POST /admin/user/grant-asset). The REAL route
// source is extracted from server.js and run against an in-memory database.
// Checks: owner-only, no wallet debit, one plan per request id however many
// times it is sent (including at the same instant), totals stay in step with
// what "Recalculate totals" would compute, no commission, banned/unknown/bad
// input refused, audit logged. Admin panel wiring is checked in the page source.
const fs = require('node:fs'), assert = require('node:assert/strict');
let checks = 0;
const ok = (c, m) => { checks++; assert.ok(c, m); };
const eq = (a, b, m) => { checks++; assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), m); };
const src = fs.readFileSync(__dirname + '/server.js', 'utf8');
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i + 1); assert.ok(i > 0 && j > i, 'markers ' + a); return src.slice(i, j); };

const routeSrc = cut("app.post('/admin/user/grant-asset'", "// Rebuilds one user's totalDeposited");
const lockSrc = cut('function withLock(key, fn) {', 'const _userBeingDeleted');

function setup({ users, products }) {
  const store = { users: new Map(Object.entries(users)), investments: new Map(), transactions: new Map() };
  const clone = v => JSON.parse(JSON.stringify(v));
  const FieldValue = { serverTimestamp: () => 'TS', increment: n => ({ __inc: n }) };
  const apply = (cur, patch) => { const o = { ...cur }; for (const [k, v] of Object.entries(patch)) o[k] = v && v.__inc !== undefined ? (Number(o[k]) || 0) + v.__inc : v; return o; };
  const delay = () => new Promise(r => setImmediate(r));
  const db = { collection: n => ({ doc: id => ({
    get: async () => { await delay(); const v = store[n].get(id); return { id, exists: v !== undefined, data: () => clone(v) }; },
    update: async p => { await delay(); if (!store[n].has(id)) throw new Error('NOT_FOUND'); store[n].set(id, apply(store[n].get(id), p)); },
    createIfAbsent: async d => { await delay(); if (store[n].has(id)) return false; store[n].set(id, apply({}, clone(d))); return true; },
  }) }) };
  let handler; const app = { post: (p, h) => { if (p === '/admin/user/grant-asset') handler = h; } };
  const audit = [];
  const factory = new Function('app', 'db', 'FieldValue', 'verifyOwner', 'getProductByKey', 'getSettings', 'productExpectedReturn', 'nowStr', 'newStatementId', 'logAdminAction', 'console',
    'const _lockTails = new Map();\n' + lockSrc + '\n' + routeSrc + '\nreturn withLock;');
  factory(app, db, FieldValue, req => req.__owner === true, async k => products[k] || null, async () => ({ cycleDays: 8 }),
    (p, s) => Math.round(p.price * (p.multiplier || 3)), () => ({ date: '2026-10-04', time: '10:00' }), () => 'B2TEST', (req, a, m) => audit.push([a, m]), { warn() {} });
  const call = async (body, owner = true) => { const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await handler({ body, __owner: owner, adminUser: { username: 'boss', role: 'owner' } }, res); return res; };
  return { store, call, audit };
}

(async () => {
  const products = { volt: { key: 'volt', name: 'Volt Go', price: 30000, cycle: 8, multiplier: 3 }, gone: { key: 'gone', name: 'Old', price: 1000, deleted: true }, free: { key: 'free', name: 'Free', price: 0 } };
  const mk = () => setup({ users: { u1: { phone: '0700', walletBalance: 5000, totalInvested: 0, status: 'active' }, bad: { status: 'banned', walletBalance: 0 } }, products });

  // owner-only
  let t = mk(); let r = await t.call({ userId: 'u1', tierKey: 'volt', requestId: 'req-12345678' }, false);
  eq(r.code, 401, 'staff cannot give assets'); eq(t.store.investments.size, 0, 'nothing created');

  // the plan
  t = mk(); r = await t.call({ userId: 'u1', tierKey: 'volt', requestId: 'req-12345678' });
  eq(r.code, 200); ok(r.body.status === 'success' && !r.body.alreadyGiven, 'given');
  eq(t.store.investments.size, 1, 'one plan'); const inv = [...t.store.investments.values()][0];
  eq([inv.userId, inv.tierKey, inv.amount, inv.status, inv.expectedReturn, inv.payoutsTotal, inv.payoutsMade, inv.paidOut, inv.granted, inv.grantedBy],
     ['u1', 'volt', 30000, 'active', 90000, 8, 0, 0, true, 'boss'], 'an ordinary active plan, flagged as granted');
  eq([inv.isFirstInvestment, inv.commissionPending, inv.commissionPaidLevels], [false, false, []], 'no referral commission can come from a gift');
  const u = t.store.users.get('u1');
  eq(u.walletBalance, 5000, 'wallet untouched: nothing is debited'); eq(u.totalInvested, 30000, 'counts as invested, matching Recalculate totals');
  eq(u.firstInvestmentDone, true);
  eq(t.store.transactions.size, 1, 'a statement row is written'); eq([...t.store.transactions.values()][0].amount, 0, 'worth zero cash');
  eq(t.audit.map(a => a[0]), ['asset_grant'], 'audit logged');
  // what "Recalculate totals" adds up must equal the stored figure
  eq([...t.store.investments.values()].reduce((s, d) => s + d.amount, 0), u.totalInvested, 'integrity audit stays consistent');

  // replay, retry, and simultaneous taps: still one plan
  r = await t.call({ userId: 'u1', tierKey: 'volt', requestId: 'req-12345678' });
  ok(r.body.status === 'success' && r.body.alreadyGiven, 'a replay is recognised'); eq(t.store.investments.size, 1); eq(t.store.users.get('u1').totalInvested, 30000, 'not counted twice');
  t = mk(); const rs = await Promise.all([1, 2, 3, 4, 5].map(() => t.call({ userId: 'u1', tierKey: 'volt', requestId: 'same-id-99999' })));
  eq(t.store.investments.size, 1, 'five simultaneous taps create one plan'); eq(t.store.users.get('u1').totalInvested, 30000);
  eq(rs.filter(x => x.body.alreadyGiven).length, 4, 'four of them told it already exists');
  // a deliberate second gift uses a new request id
  await t.call({ userId: 'u1', tierKey: 'volt', requestId: 'another-id-1234' }); eq(t.store.investments.size, 2); eq(t.store.users.get('u1').totalInvested, 60000);

  // refusals
  t = mk();
  for (const [body, why] of [[{ userId: 'u1', tierKey: 'volt', requestId: 'short' }, 'bad request id'], [{ tierKey: 'volt', requestId: 'req-12345678' }, 'no user'],
    [{ userId: 'u1', tierKey: 'nope', requestId: 'req-12345678' }, 'unknown asset'], [{ userId: 'u1', tierKey: 'gone', requestId: 'req-12345678' }, 'deleted asset'],
    [{ userId: 'u1', tierKey: 'free', requestId: 'req-12345678' }, 'no price'], [{ userId: 'ghost', tierKey: 'volt', requestId: 'req-12345678' }, 'unknown user'],
    [{ userId: 'bad', tierKey: 'volt', requestId: 'req-12345678' }, 'banned user']]) {
    r = await t.call(body); ok(r.code === 400 && r.body.status === 'error', 'refused: ' + why + ' -> ' + r.code);
  }
  eq(t.store.investments.size, 0, 'no refusal leaves a plan behind'); eq(t.store.users.get('u1').totalInvested, 0);

  // admin panel wiring
  const page = fs.readFileSync(__dirname + '/admin-src/index.html', 'utf8');
  ok(/id="grantAsset"/.test(page) && /\/admin\/user\/grant-asset/.test(page), 'panel has the selector and calls the route');
  ok(/SESSION_ROLE==='owner'\?`<h4[^`]*Give an asset/.test(page), 'only shown to owners');
  ok(/requestId:grantRequestId/.test(page), 'sends one request id per opened modal');
  console.log(`PASS: give an asset to a member (${checks} checks)`); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
