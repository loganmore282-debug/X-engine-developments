'use strict';
// Owner removes a member's saved withdrawal account (POST /admin/user/remove-bank-account). The REAL route source runs against an
// in-memory store: owner-only, only that member's own account, the number is free again, a missing/foreign account is refused,
// two simultaneous clicks remove it once, and the audit log is written.
const fs = require('node:fs'), assert = require('node:assert/strict');
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); }; const eq = (a, b, m) => { n++; assert.deepEqual(a, b, m); };
const src = fs.readFileSync(__dirname + '/server.js', 'utf8');
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i + 1); assert.ok(i > 0 && j > i, 'markers ' + a); return src.slice(i, j); };
const routeSrc = cut("app.post('/admin/user/remove-bank-account'", "app.post('/admin/user/reset-password'");
const lockSrc = cut('function withLock(key, fn) {', 'const _userBeingDeleted');
function setup(rows) {
  const store = new Map(Object.entries(rows));
  const delay = () => new Promise(r => setImmediate(r));
  const db = { collection: () => ({ doc: id => ({
    get: async () => { await delay(); const v = store.get(id); return { id, exists: v !== undefined, data: () => JSON.parse(JSON.stringify(v)) }; },
    delete: async () => { await delay(); store.delete(id); } }) }) };
  let handler; const app = { post: (p, h) => { if (p === '/admin/user/remove-bank-account') handler = h; } };
  const audit = [];
  const factory = new Function('app', 'db', 'verifyOwner', 'logAdminAction', 'const _lockTails = new Map();\n' + lockSrc + '\n' + routeSrc);
  factory(app, db, req => req.__owner === true, (req, a, m) => audit.push([a, m]));
  const call = async (body, owner = true) => { const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await handler({ body, __owner: owner }, res); return res; };
  return { store, call, audit };
}
(async () => {
  const mk = () => setup({ b1: { userId: 'u1', network: 'MTN', phone: '0771234567', holder: 'A' }, b2: { userId: 'u2', network: 'Airtel', phone: '0750000000', holder: 'B' } });
  let t = mk(), r;
  r = await t.call({ userId: 'u1', accountId: 'b1' }, false); eq(r.code, 401, 'staff cannot remove'); ok(t.store.has('b1'), 'nothing removed');
  r = await t.call({ userId: 'u1' }); eq(r.code, 400, 'accountId required');
  r = await t.call({ userId: 'u1', accountId: 'b2' }); eq(r.code, 404, "another member's account is refused"); ok(t.store.has('b2'), 'the other account is untouched');
  r = await t.call({ userId: 'u1', accountId: 'nope' }); eq(r.code, 404, 'unknown account');
  r = await t.call({ userId: 'u1', accountId: 'b1' }); eq(r.code, 200, 'owner removes it'); ok(!t.store.has('b1'), 'deleted'); ok(t.store.has('b2'), 'other member keeps theirs');
  eq(t.audit.length, 1, 'one audit row'); eq(t.audit[0][0], 'bank_account_removed'); eq(t.audit[0][1].phone, '0771234567');
  t = mk(); const both = await Promise.all([t.call({ userId: 'u1', accountId: 'b1' }), t.call({ userId: 'u1', accountId: 'b1' })]);
  eq(both.map(x => x.code).sort(), [200, 404], 'two clicks: one removes it, the other is told it is already gone'); eq(t.audit.length, 1, 'logged once');
  const admin = fs.readFileSync(__dirname + '/admin-src/index.html', 'utf8');
  ok(/data-rmbank/.test(admin) && /\/admin\/user\/remove-bank-account/.test(admin) && /SESSION_ROLE==='owner'\?` <button class="btn danger sm" data-rmbank/.test(admin), 'the Remove button is in the member panel, owner only');
  console.log('PASS: admin removes a saved withdrawal account (' + n + ' checks)');
})().catch(e => { console.error(e); process.exit(1); });
