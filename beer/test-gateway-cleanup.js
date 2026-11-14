'use strict';
// The one-time clean-up of old payment-gateway fields, settings and indexes (db.js removeGatewayLeftovers), run against a recording stand-in for MongoDB.
const assert = require('node:assert/strict');
const Module = require('node:module'), path = require('node:path');
const o = Module._resolveFilename;
Module._resolveFilename = function (r, ...a) { return r === 'mongodb' ? path.join(__dirname, 'test-helpers', 'fake-mongodb.js') : o.call(this, r, ...a); };
const { removeGatewayLeftovers } = require('./db');
function stand() {
  const log = [], marker = { done: false };
  const idx = { withdrawals: [{ name: '_id_', key: { _id: 1 } }, { name: 'userId_1', key: { userId: 1 } }, { name: 'marzReference_unique', key: { marzReference: 1 } }, { name: 'status_1_marzTxUuid_1_createdAt_1', key: { status: 1, marzTxUuid: 1, createdAt: 1 } }],
    pendingDeposits: [{ name: 'provider_1_status_1_createdAt_1', key: { provider: 1, status: 1, createdAt: 1 } }, { name: 'userId_1', key: { userId: 1 } }, { name: 'pesajetTxId_unique', key: { pesajetTxId: 1 } }], transactions: [{ name: 'marzReference_1', key: { marzReference: 1 } }, { name: 'userId_1_createdAt_-1', key: { userId: 1, createdAt: -1 } }] };
  const col = n => ({
    findOne: async f => (n === 'meta' && marker.done ? { _id: f._id } : null),
    updateMany: async (f, op) => { log.push(['updateMany', n, f, op]); },
    updateOne: async (f, op, opt) => { if (n === 'meta') marker.done = true; log.push(['updateOne', n, f, op]); },
    indexes: async () => idx[n] || [], dropIndex: async name => { log.push(['dropIndex', n, name]); },
  });
  return { mdb: { collection: col }, log };
}
(async () => {
  const { mdb, log } = stand();
  await removeGatewayLeftovers(mdb);
  const drops = log.filter(l => l[0] === 'dropIndex').map(l => l[1] + ':' + l[2]).sort();
  assert.deepEqual(drops, ['pendingDeposits:pesajetTxId_unique', 'pendingDeposits:provider_1_status_1_createdAt_1', 'transactions:marzReference_1', 'withdrawals:marzReference_unique', 'withdrawals:status_1_marzTxUuid_1_createdAt_1'], 'only gateway indexes are dropped, never _id or userId ones');
  const rowOps = log.filter(l => l[0] === 'updateMany' && l[2].$or);
  assert.equal(rowOps.length, 3, 'withdrawals, deposits and ledger rows are cleaned');
  for (const r of rowOps) { assert.ok('marzReference' in r[3].$unset && 'pesajetTxId' in r[3].$unset && 'autoSendAt' in r[3].$unset); assert.ok(!('amount' in r[3].$unset) && !('net' in r[3].$unset) && !('status' in r[3].$unset), 'no money or status field is touched'); }
  const st = log.find(l => l[0] === 'updateOne' && l[1] === 'settings'); assert.ok(st && 'depositMethod' in st[3].$unset && 'autoApproveWithdrawalsEnabled' in st[3].$unset && !('minDeposit' in st[3].$unset), 'only the gateway settings are removed');
  assert.ok(log.some(l => l[0] === 'updateOne' && l[1] === 'meta'), 'a marker row is written');
  const n = log.length; await removeGatewayLeftovers(mdb); assert.equal(log.length, n, 'a second run does nothing');
  // a database that cannot do these operations is skipped quietly, never an error
  await removeGatewayLeftovers({ collection: () => ({ findOne: async () => null, updateOne: async () => {} }) });
  console.log('PASS: old gateway fields, settings and indexes are cleaned once, safely');
})().catch(e => { console.error(e); process.exit(1); });
