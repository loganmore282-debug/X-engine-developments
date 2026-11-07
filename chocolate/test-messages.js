'use strict';
// The Messages screen shows only what the admin wrote: no built-in or welcome message of ours.
const fs = require('node:fs'), assert = require('node:assert/strict');
const src = fs.readFileSync(__dirname + '/server.js', 'utf8');
const i = src.indexOf('async function listBroadcastMessages'), j = src.indexOf("app.get('/messages'", i);
assert.ok(i > 0 && j > i, 'listBroadcastMessages found');
const fn = src.slice(i, j);
const mk = docs => new Function('db', fn + '; return listBroadcastMessages;')({ collection: () => ({ orderBy: () => ({ limit: () => ({ get: async () => ({ docs: docs.map(d => ({ id: d.id, data: () => d })) }) }) }) }) });
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); };
(async () => {
  ok((await mk([])()).length === 0, 'nothing written in the admin panel -> no messages at all (empty screen)');
  const rows = await mk([{ id: 'b', title: 'Second', body: 'x' }, { id: 'a', title: 'First', body: 'y' }])();
  ok(rows.map(r => r.id).join() === 'b,a', 'the admin\'s messages are shown, in the order stored');
  ok((await mk([{ id: 'gone', deleted: true }, { id: 'k', title: 'Kept' }])()).map(r => r.id).join() === 'k', 'a deleted message is hidden');
  ok(!/Investment Returns app|defaultWelcomeMessage|id: 'welcome'/.test(src), 'no built-in welcome message remains in the server');
  // ── Renew: the message becomes the latest and unread again for everyone ──
  const vm = require('node:vm'), crypto = require('node:crypto');
  const t0 = fs.readFileSync(__dirname + '/test-audit-money-regressions.js', 'utf8');
  const { FV, makeDb } = new Function('structuredClone', 'assert', t0.slice(t0.indexOf('const FV = {'), t0.indexOf('function response()')) + '\nreturn { FV, makeDb };')(structuredClone, assert);
  const sec = (a, b) => { const x = src.indexOf(a), y = src.indexOf(b, x + a.length); assert.ok(x >= 0 && y > x, 'anchor ' + a); return src.slice(x, y); };
  const db = makeDb({ messages: { old: { title: 'Old', body: 'o', date: '01/01/2026', time: '08:00', createdAt: 1000 }, mid: { title: 'Mid', body: 'm', date: '02/01/2026', time: '09:00', createdAt: 2000 }, gone: { title: 'G', body: 'g', createdAt: 3000, deleted: true } },
    messageReads: { u_old: { userId: 'u', messageId: 'old', readAt: 5000 }, u_mid: { userId: 'u', messageId: 'mid', readAt: 5000 }, v_old: { userId: 'v', messageId: 'old', readAt: 5000 } } });
  // the in-memory database's set() ignores {merge:true}; the real one merges, so the test's does too
  const rawCol = db.collection.bind(db); db.collection = name => { const c0 = rawCol(name), d0 = c0.doc.bind(c0); c0.doc = id => { const r0 = d0(id), set0 = r0.set; r0.set = async (data, o) => { if (o && o.merge) { const cur = db.rows[name] && db.rows[name][id] ? db.rows[name][id] : {}; return set0(Object.assign({}, cur, data)); } return set0(data); }; return r0; }; return c0; };
  const routes = {}; let verifyAdmin = () => true, uid = 'u'; const logs = [];
  const c = vm.createContext({ db, crypto, Date, Math, Number, String, Set, Map, console, app: { get: (p, h) => { routes['GET ' + p] = h; }, post: (p, h) => { routes[p] = h; } },
    verifyAuth: async () => uid, verifyAdmin: () => verifyAdmin(), nowStr: () => ({ date: '07/11/2026', time: '12:34' }), logAdminAction: (r, k, d) => logs.push([k, d.id]), stripHtml: x => x });
  vm.runInContext(sec('async function listBroadcastMessages', "app.get('/public/message-image/:id'"), c);
  vm.runInContext(sec("app.post('/admin/messages/renew'", "app.post('/admin/messages/delete'"), c);
  const call = async (key, body) => { const res = { code: 200, status(x) { this.code = x; return this; }, json(b) { this.body = b; return this; } }; await routes[key]({ body: body || {}, headers: {} }, res); return res; };
  let r = await call('GET /messages'); ok(r.body.messages.map(m => m.id).join() === 'mid,old' && r.body.messages.every(m => m.read), 'before: both messages read, newest first (deleted hidden)');
  r = await call('/admin/messages/renew', { id: 'old' });
  ok(r.code === 200 && r.body.status === 'success', 'renew works');
  const rowNow = db.rows.messages.old; ok(rowNow.date === '07/11/2026' && rowNow.time === '12:34' && rowNow.createdAt > 5000 && rowNow.renewedAt === rowNow.createdAt && rowNow.title === 'Old' && rowNow.body === 'o', 'it gets today\'s date and time, keeps its text');
  r = await call('GET /messages'); ok(r.body.messages.map(m => m.id).join() === 'old,mid', 'it is now the LATEST: first in the list');
  ok(r.body.messages[0].read === false && r.body.messages[1].read === true, 'it shows as new again, the others stay read');
  uid = 'v'; r = await call('GET /messages'); ok(r.body.messages.find(m => m.id === 'old').read === false, 'for every member who had read it');
  uid = 'u'; await new Promise(x => setTimeout(x, 5)); await db.collection('messageReads').doc('u_old').set({ userId: 'u', messageId: 'old', readAt: Date.now() + 1 }, { merge: true });
  r = await call('GET /messages'); ok(r.body.messages.find(m => m.id === 'old').read === true, 'and reading it again marks it read');
  ok(db.rows.messageReads.v_old.readAt === 5000, 'nobody\'s read rows were rewritten');
  r = await call('/admin/messages/renew', { id: 'gone' }); ok(r.code === 404, 'a deleted message cannot be renewed');
  r = await call('/admin/messages/renew', { id: 'nope' }); ok(r.code === 404, 'nor one that does not exist');
  r = await call('/admin/messages/renew', {}); ok(r.code === 400, 'an id is required');
  verifyAdmin = () => false; r = await call('/admin/messages/renew', { id: 'old' }); ok(r.code === 401, 'admins only'); verifyAdmin = () => true;
  ok(logs.some(l => l[0] === 'message_renewed' && l[1] === 'old'), 'it is written to the activity log');
  const adm = fs.readFileSync(__dirname + '/admin-src/index.html', 'utf8');
  ok(/data-mren=/.test(adm) && /\/admin\/messages\/renew/.test(adm), 'each posted message has a Renew button');
  console.log('test-messages: ' + n + ' checks passed');
})().catch(e => { console.error(e); process.exit(1); });
