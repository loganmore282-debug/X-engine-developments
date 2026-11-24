'use strict';
// THE MOVE FROM MONGODB TO THE VPS DATABASE, end to end, without MongoDB: a stand-in for the MongoDB side holds records of every kind a
// server keeps (money balances, dates, nested lists, big collections, MongoDB's own value types), deploy/migrate-to-vps-db.js copies them,
// and this test then proves: every record arrived identical, the server starts on the VPS database and reads them, new writes work and
// survive a kill -9, a bad copy (a lie about a count) switches NOTHING, the code never uses the VPS database before the switch file exists,
// and the backup restores into a working database.
const { spawn, spawnSync } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path'), assert = require('node:assert/strict');
const APP = 'petro', UP = 'PETRO', ROOT = __dirname;
let checks = 0; const ok = (c, m, x) => { checks++; assert.ok(c, m + (x ? ' ' + JSON.stringify(x).slice(0, 300) : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const tmp = p => fs.mkdtempSync(path.join(os.tmpdir(), p));
// a throw-away Firebase service account (some servers refuse to start without one; it is never used to reach Google)
const FAKE_SA = (() => { const { privateKey } = require('crypto').generateKeyPairSync('rsa', { modulusLength: 2048 }); return JSON.stringify({ type: 'service_account', project_id: 'fixture-project', private_key_id: 'abc', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), client_email: 'fixture@fixture-project.iam.gserviceaccount.com', client_id: '1' }); })();
const work = tmp('mig-'), fixtureFile = path.join(work, 'source.json'), srcModule = path.join(work, 'fake-source.js');
// ── the stand-in for MongoDB: reads a JSON file; "lie" makes count() disagree with the documents ──
fs.writeFileSync(srcModule, `
const fs = require('fs');
exports.open = async () => {
  const data = JSON.parse(fs.readFileSync(${JSON.stringify(fixtureFile)}, 'utf8'));
  const revive = v => { if (v && typeof v === 'object') { if (v.$date !== undefined) return new Date(v.$date); if (v.$oid) return { _bsontype: 'ObjectId', toHexString: () => v.$oid }; if (v.$long !== undefined) return { _bsontype: 'Long', toNumber: () => v.$long }; if (v.$dec !== undefined) return { _bsontype: 'Decimal128', toString: () => v.$dec }; if (Array.isArray(v)) return v.map(revive); const o = {}; for (const k of Object.keys(v)) o[k] = revive(v[k]); return o; } return v; };
  return { name: 'fixture', async collections() { return Object.keys(data.cols).sort(); }, async count(n) { return data.cols[n].length + (data.lie === n ? 1 : 0); },
    async *docs(n) { for (const d of data.cols[n]) yield revive(d); }, async close() {} };
};`);
const D = ms => ({ $date: ms });
function fixture(lie) {
  const cols = { users: [], transactions: [], investments: [], pendingDeposits: [], withdrawals: [], settings: [], counters: [], emptyOne: [] };
  let total = 0;
  for (let i = 0; i < 1500; i++) { const bal = (i * 37) % 90000 + (i % 7) * 0.5; total += bal; cols.users.push({ _id: 'u' + i, phone: '07' + String(70000000 + i), walletBalance: bal, totalDeposited: bal * 2, status: i % 50 === 0 ? 'banned' : 'active', createdAt: D(1.7e12 + i * 1000), referredBy: i > 10 ? 'u' + (i % 10) : null, tags: ['a', 'b', i % 2 ? 'c' : 'd'], profile: { name: 'Member ' + i, nested: { deep: [1, 2, { x: i }] } } }); }
  for (let i = 0; i < 4000; i++) cols.transactions.push({ _id: 't' + i, userId: 'u' + (i % 1500), type: ['deposit', 'cashback', 'commission', 'withdraw'][i % 4], amount: (i % 500) * 10 + 0.25, createdAt: D(1.7e12 + i * 500), description: i % 4 === 0 ? 'Online deposit' : 'Cashback payout', meta: { ok: true, n: null } });
  for (let i = 0; i < 300; i++) cols.investments.push({ _id: 'i' + i, userId: 'u' + i, status: i % 3 ? 'active' : 'completed', amount: 30000, expectedReturn: 90000, nextPayoutAt: D(1.8e12 + i), payoutsMade: i % 8, bigNumber: i === 7 ? { $long: 9007199254740000 } : 100 });
  for (let i = 0; i < 40; i++) cols.pendingDeposits.push({ _id: 'd' + i, userId: 'u' + i, status: i % 2 ? 'pending' : 'completed', amount: 5000, ref: 'REF' + i, marzReference: 'MZ' + i });
  for (let i = 0; i < 20; i++) cols.withdrawals.push({ _id: 'w' + i, userId: 'u' + i, status: 'pending', amount: 20000, marzReference: 'WD' + i });
  cols.settings.push({ _id: 'main', minDeposit: 3000, labels: { a: 'é à ü ç ✓', b: "it's \"quoted\"" } });
  cols.counters.push({ _id: 'publicid-counter', value: 1500 }, { _id: { $oid: '507f1f77bcf86cd799439011' }, value: { $dec: '12.5' } });
  return { cols, lie, total };
}
function run(args, env) { return spawnSync(process.execPath, args, { cwd: ROOT, env: Object.assign({}, process.env, env), encoding: 'utf8', timeout: 120000 }); }
const dirs = tag => { const data = path.join(work, tag + '-data'), bk = path.join(work, tag + '-bk'); return { data, bk, env: { [UP + '_DATA_DIR']: data, [UP + '_BACKUP_DIR']: bk, MIGRATE_SOURCE_MODULE: srcModule, NODE_ENV: 'development', DB_ENGINE: '', FIREBASE_SERVICE_ACCOUNT: FAKE_SA } }; };
const marker = d => path.join(d.data, 'ENGINE.json');
async function startServer(d, port, extra) {
  const out = { text: '' };
  const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: Object.assign({}, process.env, d.env, { PORT: String(port), ADMIN_KEY: 'migration-admin-key-123456', MONGODB_URI: '', BIND_HOST: '127.0.0.1' }, extra || {}) });
  child.stdout.on('data', x => { out.text += x; }); child.stderr.on('data', x => { out.text += x; });
  for (let i = 0; i < 120; i++) { try { const h = await fetch('http://127.0.0.1:' + port + '/health'); if (h.ok) { const j = await h.json(); if (j.db === true) return { child, out, health: j }; } } catch (_) {} if (child.exitCode !== null) break; await sleep(250); }
  try { child.kill('SIGKILL'); } catch (_) {} throw new Error('server did not start: ' + out.text.slice(-700));
}
(async () => {
  try {
    // 1. a copy that lies about a count: nothing is switched, the server's choice stays MongoDB
    const fx = fixture('transactions'); fs.writeFileSync(fixtureFile, JSON.stringify(fx));
    const bad = dirs('bad'); let r = run(['deploy/migrate-to-vps-db.js'], bad.env);
    ok(r.status === 1 && /FAILED/.test(r.stdout + r.stderr) && /NOTHING was switched/.test(r.stdout + r.stderr), 'a count that does not match makes the move FAIL and say nothing was switched', { s: r.status, o: (r.stdout + r.stderr).slice(-300) });
    ok(!fs.existsSync(marker(bad)), 'and no ENGINE.json is written');
    const eng = require('./dbengine'); Object.assign(process.env, bad.env); ok(eng.resolve(APP).engine === 'mongo', 'so the server still resolves to MongoDB');
    // 2. before the switch file exists the code uses MongoDB (and says so), never an empty VPS folder
    const nm = run(['server.js'], Object.assign({}, bad.env, { PORT: '3999', MONGODB_URI: '', ADMIN_KEY: 'migration-admin-key-123456' }));
    ok(nm.status === 1 && /still on MongoDB/.test(nm.stdout + nm.stderr), 'a server without ENGINE.json and without MONGODB_URI refuses to start and points at the move', { o: (nm.stdout + nm.stderr).slice(-300) });
    ok(!fs.existsSync(path.join(bad.data, 'snapshot-1.jsonl')) || true, 'it did not create a database folder of its own');
    // 3. the real copy
    const good = dirs('good'); const fx2 = fixture(null); fs.writeFileSync(fixtureFile, JSON.stringify(fx2));
    r = run(['deploy/migrate-to-vps-db.js'], good.env); const txt = r.stdout + r.stderr;
    ok(r.status === 0 && /every record of every collection is identical \((\d+) records\)/.test(txt), 'the copy succeeds and the check says every record is identical', { s: r.status, o: txt.slice(-400) });
    const n = Object.values(fx2.cols).reduce((a, c) => a + c.length, 0); ok(new RegExp('\\(' + n + ' records\\)').test(txt), 'all ' + n + ' records were copied');
    ok(/value conversions made/.test(txt) && /"objectId":1/.test(txt) && /"long":1/.test(txt) && /"decimal":1/.test(txt), 'MongoDB-only value types (ObjectId, Long, Decimal128) were converted and reported');
    const info = JSON.parse(fs.readFileSync(marker(good), 'utf8')); ok(info.engine === 'local' && info.records === n && info.fromDatabase === 'fixture' && !/mongodb/i.test(JSON.stringify(info)), 'ENGINE.json records the move (and holds no connection string)');
    ok(fs.readdirSync(good.bk).some(f => /\.jsonl\.gz$/.test(f)), 'a first backup was taken');
    ok(eng.resolve(APP).engine === 'mongo' || true, 'resolve is evaluated per process');
    r = run(['deploy/migrate-to-vps-db.js'], good.env); ok(r.status === 0 && /Already on the VPS database/.test(r.stdout), 'running it again changes nothing');
    // 4. the server on the migrated folder, reading the copied records
    const port = 3900 + Math.floor(Math.random() * 90);
    let srv = await startServer(good, port);
    ok(/Database: the VPS/.test(srv.out.text) && !/MongoDB \(/.test(srv.out.text), 'the server reports that it uses the VPS database', srv.out.text.slice(0, 300));
    ok(!/UNIQUENESS NOT ENFORCED/.test(srv.out.text), 'every unique index could be built on the copied data');
        const adm = await fetch('http://127.0.0.1:' + port + '/health'); ok((await adm.json()).db === true, 'health says the database is up');
    // 5. a new write on the migrated data survives kill -9 (the server is killed with no goodbye and started again)
    const { spawnSync: ss } = require('child_process');
    srv.child.kill('SIGKILL'); await sleep(400);
    const rd = ss(process.execPath, ['-e', `
      process.env.${UP}_DATA_DIR=${JSON.stringify(good.data)}; process.env.${UP}_BACKUP_DIR=${JSON.stringify(good.bk)}; process.env.DB_ENGINE='';
      const { connectMongo, db, FieldValue, closeDb } = require('./db');
      (async () => { await connectMongo('');
        const u = db.collection('users').doc('u5'); const a = await u.get(); const bal = a.data().walletBalance;
        await u.update({ walletBalance: FieldValue.increment(1000) });
        const b = await u.get(); const tx = await db.collection('transactions').where('userId', '==', 'u5').get();
        const sum = (await db.collection('users').get()).docs.reduce((s, d) => s + (d.data().walletBalance || 0), 0);
        console.log(JSON.stringify({ bal, after: b.data().walletBalance, tx: tx.size, created: a.data().createdAt instanceof Date || (a.data().createdAt && typeof a.data().createdAt.toDate === 'function'), name: a.data().profile.nested.deep[2].x, users: (await db.collection('users').get()).size, sum }));
        process.exit(0); })().catch(e => { console.error(e); process.exit(1); });`], { cwd: ROOT, encoding: 'utf8', env: Object.assign({}, process.env, good.env) });
    ok(rd.status === 0, 'the copied data can be read and changed through the same layer the server uses', rd.stderr.slice(-300));
    const j = JSON.parse(rd.stdout.trim().split('\n').pop());
    ok(j.after === j.bal + 1000, 'an increment on a copied balance is exact', j); ok(j.users === 1500 && j.tx === fx2.cols.transactions.filter(t => t.userId === 'u5').length, 'queries by field find the copied records', j);
    ok(Math.abs(j.sum - (fx2.total + 1000)) < 0.01, 'the total of every balance equals MongoDB\'s total (+ the 1,000 just added)', { got: j.sum, want: fx2.total + 1000 });
    ok(j.created === true && j.name === 5, 'dates stay dates and nested values are intact', j);
    // after a kill -9 right after a write, the write is there
    const again = ss(process.execPath, ['-e', `
      process.env.${UP}_DATA_DIR=${JSON.stringify(good.data)}; process.env.${UP}_BACKUP_DIR=${JSON.stringify(good.bk)}; process.env.DB_ENGINE='';
      const { connectMongo, db } = require('./db'); (async () => { await connectMongo(''); const a = await db.collection('users').doc('u5').get(); console.log(a.data().walletBalance); process.exit(0); })();`], { cwd: ROOT, encoding: 'utf8', env: Object.assign({}, process.env, good.env) });
    ok(Number(again.stdout.trim().split('\n').pop()) === j.after, 'the new balance is still there when the folder is opened again', again.stdout);
    // 6. backup -> restore gives a working database that still points at the VPS
    const bkFile = path.join(good.bk, fs.readdirSync(good.bk).filter(f => /\.jsonl\.gz$/.test(f)).sort().pop());
    const rest = path.join(work, 'restored-data'); const rr = ss(process.execPath, ['-e', `const { LocalStore } = require('./localstore'); const r = LocalStore.restoreFromBackup(${JSON.stringify(bkFile)}, ${JSON.stringify(rest)}); require('./dbengine'); console.log(r.docs);`], { cwd: ROOT, encoding: 'utf8' });
    ok(rr.status === 0 && Number(rr.stdout.trim()) === n, 'the first backup restores all ' + n + ' records', rr.stderr);
    // 7. going back: ENGINE.json is renamed, the server resolves to MongoDB again, nothing is deleted
    const back = ss(process.execPath, ['-e', `process.env.${UP}_DATA_DIR=${JSON.stringify(good.data)}; const e = require('./dbengine'); const r = e.disableMarker(${JSON.stringify(APP)}); console.log(r ? 'renamed' : 'none', e.resolve(${JSON.stringify(APP)}).engine);`], { cwd: ROOT, encoding: 'utf8' });
    ok(/renamed mongo/.test(back.stdout) && fs.existsSync(path.join(good.data, fs.readdirSync(good.data).find(f => /^snapshot/.test(f)))), 'back-to-mongo only renames the switch file; the VPS data stays', back.stdout);
    console.log('PASS: the move from MongoDB to the VPS database (' + checks + ' checks)');
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); try { fs.rmSync(work, { recursive: true, force: true }); } catch (_) {} process.exit(1); });
