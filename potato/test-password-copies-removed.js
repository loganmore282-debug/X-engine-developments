'use strict';
// The old locked password copies (pwSealed) are removed once at start-up; nothing else is touched. And the "Show password" feature is gone from server and panel.
const fs = require('fs'), assert = require('assert'), path = require('path'), Module = require('module');
const o = Module._resolveFilename;
Module._resolveFilename = function (r, ...a) { return r === 'mongodb' ? path.join(__dirname, 'test-helpers', 'fake-mongodb.js') : o.call(this, r, ...a); };
const { removePasswordCopies } = require('./db');
(async () => {
  const log = [], done = { v: false };
  const mdb = { collection: n => ({ findOne: async f => (n === 'meta' && done.v ? { _id: f._id } : null), updateMany: async (f, op) => { log.push([n, f, op]); }, updateOne: async (f, op) => { if (n === 'meta') done.v = true; log.push([n, 'marker']); } }) };
  await removePasswordCopies(mdb);
  assert.deepStrictEqual(log[0], ['authAccounts', { pwSealed: { $exists: true } }, { $unset: { pwSealed: '' } }], 'only pwSealed is unset, on authAccounts');
  const n = log.length; await removePasswordCopies(mdb); assert.strictEqual(log.length, n, 'a second run does nothing');
  await removePasswordCopies({ collection: () => ({ findOne: async () => null, updateOne: async () => {} }) });   // a database without updateMany: skipped quietly
  const srv = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8'), adm = fs.readFileSync(path.join(__dirname, 'admin-src/index.html'), 'utf8');
  assert.ok(!/pwSealed|password-vault|\/admin\/user\/password/.test(srv.replace(/\/\/[^\n]*/g, '')), 'no password copy or reveal route in the server');
  assert.ok(!/Show password|pwShowBtn/.test(adm), 'no Show password in the admin panel');
  assert.ok(!fs.existsSync(path.join(__dirname, 'password-vault.js')), 'password-vault.js is gone');
  console.log('PASS: old password copies removed, Show password gone');
})().catch(e => { console.error(e); process.exit(1); });
