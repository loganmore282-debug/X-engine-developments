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
  console.log('test-messages: ' + n + ' checks passed');
})().catch(e => { console.error(e); process.exit(1); });
