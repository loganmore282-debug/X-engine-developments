'use strict';
// ONE-TIME COPY of petro's whole database from MongoDB to this VPS, with proof that nothing was lost.
// Run by deploy/migrate-to-vps-db.sh with the server STOPPED (so nothing changes while it copies). It never changes MongoDB.
//   1. reads every collection from MongoDB and writes it to a NEW folder (/srv/petro-data) in one pass,
//   2. closes that database, opens it again from the disk, and compares every collection (record count and a fingerprint of every record) with
//      what MongoDB held,
//   3. only if all of that matches, takes a first backup and writes ENGINE.json -- the file that makes the server use the VPS database.
// If anything is off it stops, changes nothing, and the server simply goes on using MongoDB.
const fs = require('fs'), path = require('path'), crypto = require('crypto'), cp = require('child_process');
const APP = 'petro', PM2_NAME = 'petro-server', ROOT = path.join(__dirname, '..');
const dbEngine = require(path.join(ROOT, 'dbengine.js'));
const { openStore } = require(path.join(ROOT, 'localstore.js'));
const args = new Set(process.argv.slice(2));
const quiet = { log() {}, warn() {}, error() {} };
const out = (...a) => console.log(...a);
const eng = dbEngine.resolve(APP);

// ── BSON values -> what the local database stores (plain JSON, dates kept) ──
const conv = { objectId: 0, long: 0, decimal: 0, binary: 0, other: 0 };
function fromBson(v) {
  if (v === null || v === undefined) return null;
  const t = typeof v;
  if (t === 'string' || t === 'boolean') return v;
  if (t === 'number') return v;
  if (t === 'bigint') { conv.long++; return Number(v); }
  if (v instanceof Date) return new Date(v.getTime());
  if (Array.isArray(v)) return v.map(fromBson);
  if (Buffer.isBuffer(v)) { conv.binary++; return v.toString('base64'); }
  const bt = v._bsontype;
  if (bt === 'ObjectId' || bt === 'ObjectID') { conv.objectId++; return v.toHexString(); }
  if (bt === 'Long') { conv.long++; return v.toNumber(); }
  if (bt === 'Int32' || bt === 'Double') return Number(v.value !== undefined ? v.value : v.valueOf());
  if (bt === 'Decimal128') { conv.decimal++; return parseFloat(v.toString()); }
  if (bt === 'Binary') { conv.binary++; return v.buffer.toString('base64'); }
  if (bt === 'Timestamp') { conv.other++; return Number(v.toString()); }
  if (bt) { conv.other++; return String(v); }
  if (v instanceof RegExp) { conv.other++; return v.toString(); }
  const o = {}; for (const k of Object.keys(v)) { if (v[k] !== undefined) o[k] = fromBson(v[k]); } return o;
}
// a stable text for one record: keys sorted, dates as milliseconds
function canon(v) {
  if (v === null || v === undefined) return 'null';
  if (v instanceof Date) return '"$d' + v.getTime() + '"';
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'null';
  return JSON.stringify(v);
}
// order-independent fingerprint of a collection: record count + the sum of every record's hash (64 bits)
class Fp { constructor() { this.n = 0; this.sum = 0n; } add(doc) { const h = crypto.createHash('sha256').update(canon(doc)).digest(); this.sum = (this.sum + h.readBigUInt64BE(0)) & 0xffffffffffffffffn; this.n++; } toString() { return this.n + ':' + this.sum.toString(16); } }

// ── the MongoDB side (a stand-in can be supplied for tests: MIGRATE_SOURCE_MODULE exports open(uri)) ──
async function openSource() {
  if (process.env.MIGRATE_SOURCE_MODULE) return require(process.env.MIGRATE_SOURCE_MODULE).open();
  const { MongoClient } = require(path.join(ROOT, 'node_modules', 'mongodb'));
  let uri = process.env.MONGODB_URI || '';
  if (!uri) { try { const e = require(path.join(__dirname, 'ecosystem.config.js')).apps[0].env || {}; uri = e.MONGODB_URI || ''; } catch (_) {} }
  if (!uri) throw new Error('MONGODB_URI is not set (it is read from the same secrets the server uses)');
  const dbName = new URL(uri).pathname.slice(1); if (!dbName) throw new Error('MONGODB_URI has no database name');
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000, connectTimeoutMS: 15000, socketTimeoutMS: 120000 });
  await client.connect(); const db = client.db(dbName);
  return {
    name: dbName,
    async collections() { return (await db.listCollections({}, { nameOnly: true }).toArray()).map(c => c.name).filter(n => !n.startsWith('system.')).sort(); },
    async count(n) { return db.collection(n).countDocuments({}); },
    async *docs(n) { const cur = db.collection(n).find({}).batchSize(2000); try { for await (const d of cur) yield d; } finally { await cur.close(); } },
    async close() { await client.close(); },
  };
}

function serverIsRunning() {
  try { const l = JSON.parse(cp.execSync('pm2 jlist', { stdio: ['ignore', 'pipe', 'ignore'] }).toString()); return l.some(p => p.name === PM2_NAME && p.pm2_env && p.pm2_env.status === 'online'); }
  catch (_) { return false; }
}
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

(async () => {
  out('== ' + APP + ': copying the database from MongoDB to this VPS (' + eng.dir + ')');
  if (eng.engine === 'local' && fs.existsSync(eng.marker) && !args.has('--again')) { out('Already on the VPS database (' + eng.reason + '). Nothing to do. (--again copies afresh from MongoDB and keeps the old folder aside.)'); return 0; }
  if (!args.has('--force-online') && serverIsRunning()) { console.error('STOP: ' + PM2_NAME + ' is still running, so records could change while copying. Use deploy/migrate-to-vps-db.sh (it stops the server first).'); return 2; }
  // an old half-done attempt, or the previous local database for --again, is moved aside, never deleted
  if (fs.existsSync(eng.dir) && fs.readdirSync(eng.dir).length) { const aside = eng.dir + '.old-' + stamp(); fs.renameSync(eng.dir, aside); out('The existing folder was moved aside to ' + aside); }
  fs.mkdirSync(eng.dir, { recursive: true, mode: 0o700 });
  const src = await openSource(); const t0 = Date.now();
  let store = null;
  try {
    const names = await src.collections(); out('MongoDB database "' + src.name + '": ' + names.length + ' collection(s)');
    const srcCount = {}, srcFp = {};
    for (const n of names) srcCount[n] = await src.count(n);
    store = openStore({ dir: eng.dir, backupDir: eng.backupDir, log: quiet });
    for (const n of names) {
      const fp = new Fp(); const col = store.collection(n); let batch = [], total = 0;
      for await (const raw of src.docs(n)) {
        const doc = fromBson(raw);
        if (typeof doc._id !== 'string') { conv.objectId++; doc._id = String(doc._id); }
        fp.add(doc); batch.push(doc);
        if (batch.length >= 2000) { await col.insertMany(batch); total += batch.length; batch = []; }
      }
      if (batch.length) { await col.insertMany(batch); total += batch.length; }
      srcFp[n] = fp.toString();
      out('  ' + n.padEnd(28) + String(total).padStart(9) + ' record(s)' + (total !== srcCount[n] ? '   <-- MongoDB counted ' + srcCount[n] + ' at the start' : ''));
      if (total !== srcCount[n]) throw new Error(n + ': copied ' + total + ' but MongoDB counted ' + srcCount[n]);
    }
    await store.compact(); await store.close(); store = null;
    // ── proof: open it again from the disk and compare everything ──
    out('Checking the copy from the disk...');
    store = openStore({ dir: eng.dir, backupDir: eng.backupDir, log: quiet });
    let bad = 0, docsTotal = 0;
    for (const n of names) {
      const fp = new Fp(); const rows = await store.collection(n).find({}).toArray(); for (const d of rows) fp.add(d);
      docsTotal += rows.length;
      const same = fp.toString() === srcFp[n];
      if (!same) { bad++; out('  MISMATCH in ' + n + ': MongoDB ' + srcFp[n] + ' vs VPS ' + fp.toString()); }
    }
    if (bad) throw new Error(bad + ' collection(s) differ between MongoDB and the copy');
    out('  every record of every collection is identical (' + docsTotal + ' records).');
    if (conv.objectId || conv.long || conv.decimal || conv.binary || conv.other) out('  value conversions made (all stored as plain text/numbers): ' + JSON.stringify(conv));
    const bk = await store.backup(); out('First backup: ' + bk.file);
    await store.close(); store = null;
    const info = { migratedAt: new Date().toISOString(), fromDatabase: src.name, collections: srcCount, records: docsTotal, fingerprints: srcFp, firstBackup: bk.file };
    dbEngine.writeMarker(APP, info);
    out('DONE in ' + Math.round((Date.now() - t0) / 1000) + ' s. ' + APP + ' will use the VPS database from its next start (' + eng.marker + ').');
    return 0;
  } catch (e) {
    console.error('\nFAILED: ' + (e && e.message));
    console.error('NOTHING was switched: ' + APP + ' keeps using MongoDB, which was not changed.');
    try { if (store) await store.close(); } catch (_) {}
    try { if (fs.existsSync(eng.dir)) fs.renameSync(eng.dir, eng.dir + '.failed-' + stamp()); } catch (_) {}
    return 1;
  } finally { try { await src.close(); } catch (_) {} }
})().then(c => process.exit(c)).catch(e => { console.error(e); process.exit(1); });
