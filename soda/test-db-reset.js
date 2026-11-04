'use strict';
// Admin "Reset database": what it erases, what it keeps, and every guard in front of it.
// Real server.js source against an in-memory database.
const fs = require('node:fs'), assert = require('node:assert/strict');
let checks = 0; const ok = (c, m) => { checks++; assert.ok(c, m); }; const eq = (a, b, m) => { checks++; assert.deepEqual(a, b, m); };
const src = fs.readFileSync(__dirname + '/server.js', 'utf8');
const a = src.indexOf('// ── RESET DATABASE (owner only) ──'), b = src.indexOf('const _adminCreditDebounce = new Map();', a);
ok(a >= 0 && b > a, 'reset block found');
const block = src.slice(a, b);
function makeDb() {
  const cols = new Map(); let n = 0;
  const col = name => { if (!cols.has(name)) cols.set(name, new Map()); return cols.get(name); };
  const snapOf = (name, id) => ({ id, exists: col(name).has(id), data: () => structuredClone(col(name).get(id)), ref: refOf(name, id) });
  const refOf = (name, id) => ({ id, delete: async () => { col(name).delete(id); }, get: async () => snapOf(name, id) });
  const query = (name, filters = []) => ({
    where: (f, o, v) => query(name, filters.concat([[f, o, v]])),
    get: async () => { const docs = [...col(name).keys()].map(id => snapOf(name, id)).filter(s => filters.every(([f, o, v]) => o === 'in' ? v.includes(s.data()[f]) : s.data()[f] === v)); return { docs, size: docs.length, forEach: fn => docs.forEach(fn) }; },
    count: async () => (await query(name, filters).get()).size,
  });
  return { col, collection: name => ({ ...query(name), doc: id => refOf(name, id || ('i' + (++n))) }) };
}
function build(db, ctx) {
  const handlers = {};
  const app = { post: (p, h) => { handlers[p] = h; } };
  const fbUsers = ctx.fbUsers;
  const authApi = { listUsers: async () => ({ users: fbUsers.slice(), pageToken: undefined }), deleteUsers: async ids => { for (const id of ids) { const i = fbUsers.findIndex(u => u.uid === id); if (i >= 0) fbUsers.splice(i, 1); } } };
  new Function('app', 'db', 'verifyOwner', 'ADMIN_KEY', 'safeEqual', 'loginLocked', 'recordLoginFail', 'clearLoginFails', 'logAdminAction', 'admin', block)(
    app, db, () => ctx.owner, 'MASTER', (x, y) => x === y, k => (ctx.fails[k] || 0) >= 5, k => { ctx.fails[k] = (ctx.fails[k] || 0) + 1; }, k => { delete ctx.fails[k]; },
    (req, action, meta) => ctx.log.push([action, meta]), { auth: () => authApi });
  return handlers;
}
async function call(h, body) {
  const out = { code: 200, body: null };
  await h({ body }, { status(c) { out.code = c; return this; }, json(x) { out.body = x; return this; } });
  return out;
}
(async () => {
  const db = makeDb();
  const ctx = { owner: true, fails: {}, log: [], fbUsers: [] };
  const seed = (c, rows) => rows.forEach((r, i) => db.col(c).set(c + i, r));
  seed('users', [{ walletBalance: 1000 }, { walletBalance: 500 }]); seed('transactions', [{}, {}, {}]); seed('withdrawals', [{ status: 'processed' }]);
  seed('pendingDeposits', [{ status: 'matched' }]); seed('investments', [{}]); seed('memberSessions', [{}]); seed('authAccounts', [{}, {}]); seed('counters', [{ n: 7 }]); seed('promoCodes', [{}]);
  seed('settings', [{ minDeposit: 300 }]); seed('products', [{}, {}]); seed('payChannels', [{ name: 'CBE' }]); seed('adminUsers', [{ username: 'staff' }]);
  seed('messages', [{}]); seed('banners', [{}]); seed('content', [{}]); seed('adminAuditLog', [{}]);
  const H = build(db, ctx);
  const R = 'RESET DATABASE';
  // guards
  ctx.owner = false;
  eq((await call(H['/admin/database/reset'], { confirm: R, key: 'MASTER' })).code, 401, 'staff cannot reset');
  eq((await call(H['/admin/database/reset-preview'], {})).code, 401, 'staff cannot even preview');
  ctx.owner = true;
  eq((await call(H['/admin/database/reset'], { key: 'MASTER' })).code, 400, 'no phrase, no reset');
  eq((await call(H['/admin/database/reset'], { confirm: 'reset database', key: 'MASTER' })).code, 400, 'the phrase must match exactly');
  eq((await call(H['/admin/database/reset'], { confirm: R, key: 'wrong' })).code, 401, 'wrong admin key refused');
  eq((await call(H['/admin/database/reset'], { confirm: R })).code, 401, 'missing admin key refused');
  eq(db.col('users').size, 2, 'nothing was erased by the refusals');
  for (let i = 0; i < 6; i++) await call(H['/admin/database/reset'], { confirm: R, key: 'bad' + i });
  eq((await call(H['/admin/database/reset'], { confirm: R, key: 'MASTER' })).code, 429, 'repeated wrong keys lock the button');
  ctx.fails = {};
  // preview
  let r = await call(H['/admin/database/reset-preview'], {});
  eq([r.body.counts.users, r.body.counts.transactions, r.body.walletTotal], [2, 3, 1500], 'preview counts what would go');
  ok(r.body.wipe.includes('users') && !r.body.wipe.includes('settings') && !r.body.wipe.includes('payChannels') && !r.body.wipe.includes('adminUsers'), 'configuration is not in the wipe list');
  eq([r.body.unfinishedDeposits, r.body.unfinishedWithdrawals], [0, 0], 'nothing unfinished');
  // unfinished money needs a second acknowledgement
  db.col('pendingDeposits').set('gw', { status: 'pending', method: undefined });
  db.col('withdrawals').set('w2', { status: 'processing' });
  r = await call(H['/admin/database/reset'], { confirm: R, key: 'MASTER' });
  eq([r.code, r.body.code], [409, 'UNFINISHED'], 'unfinished money stops the reset until acknowledged');
  eq(db.col('users').size, 2, 'still nothing erased');
  // an unpaid manual order is not "unfinished money"
  db.col('pendingDeposits').set('gw', { status: 'pending', method: 'manual' });
  db.col('withdrawals').delete('w2');
  r = await call(H['/admin/database/reset-preview'], {});
  eq([r.body.unfinishedDeposits, r.body.unfinishedWithdrawals], [0, 0], 'an unpaid manual order does not block the reset');
  // the reset
  r = await call(H['/admin/database/reset'], { confirm: R, key: 'MASTER' });
  eq(r.code, 200, 'reset runs'); eq(r.body.erased.users, 2, 'members erased'); eq(r.body.loginsRemoved, 2, 'the two member sign-in accounts are removed with the members');
  for (const c of ['users', 'transactions', 'pendingDeposits', 'withdrawals', 'investments', 'authAccounts', 'memberSessions', 'counters', 'promoCodes']) eq(db.col(c).size, 0, c + ' is empty');
  eq([db.col('settings').size, db.col('products').size, db.col('payChannels').size, db.col('adminUsers').size, db.col('messages').size, db.col('banners').size, db.col('content').size, db.col('adminAuditLog').size], [1, 2, 1, 1, 1, 1, 1, 1], 'configuration is untouched');
  eq(ctx.log[0][0], 'database_reset', 'the reset is written to the activity log');
  console.log('PASS: admin Reset database (' + checks + ' checks)');
})().catch(e => { console.error(e); process.exitCode = 1; });
