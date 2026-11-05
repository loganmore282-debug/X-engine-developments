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
  // read: one id, or the whole screen at once (the page shows every message in full)
  const rs = src.slice(src.indexOf("app.post('/messages/read'"), src.indexOf('// ADMIN', src.indexOf("app.post('/messages/read'")));
  const reads = new Map(); let handler;
  new Function('app', 'verifyAuth', 'db', rs)({ post: (p, h) => { handler = h; } }, async () => 'u1', { collection: () => ({ doc: id => ({ set: async v => { reads.set(id, v); } }) }) });
  const call = async body => { const res = { code: 200, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } }; await handler({ body }, res); return res; };
  ok((await call({ messageId: 'a' })).body.status === 'success' && reads.has('u1_a'), 'one message marked read');
  ok((await call({ messageIds: ['b', 'c', 'b', ''] })).body.status === 'success' && reads.has('u1_b') && reads.has('u1_c') && reads.size === 3, 'many marked read in one call, no duplicates');
  ok((await call({ messageIds: Array.from({ length: 150 }, (_, k) => 'm' + k) })) && reads.size === 103, 'at most 100 per call');
  ok((await call({})).code === 400, 'nothing to mark is refused');
  // the page: grouped by date in striped cards, full text and picture shown, no second tap
  const page = fs.readFileSync(__dirname + '/user-src/original_module.js', 'utf8');
  const r = page.slice(page.indexOf('function renderMessagesList()'), page.indexOf('window.openMessageDetail'));
  ok(/pt-day/.test(r) && /pt-rec-in/.test(r) && /pt-msg/.test(r) && /message-image/.test(r) && !/openMessageDetail\(/.test(r), 'Messages: one striped card per date, each message shown in full');
  console.log('test-messages: ' + n + ' checks passed');
})().catch(e => { console.error(e); process.exit(1); });
