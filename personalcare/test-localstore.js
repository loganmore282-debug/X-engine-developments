'use strict';
// PersonalCare's own database (localstore.js, no MongoDB): the MongoDB behaviours the app relies on, the indexes (a lookup through an index must
// give the SAME answer as scanning everything), unique indexes, and that nothing acknowledged is ever lost -- reopen, torn journal line,
// a compaction that died half way, a backup and a restore.
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('node:assert/strict'), zlib = require('zlib');
const { openStore, LocalStore, compileFilter } = require('./localstore');
let checks = 0; const ok = (c, m) => { checks++; assert.ok(c, m); }; const eq = (a, b, m) => { checks++; assert.deepEqual(a, b, m); };
const quiet = { log() {}, warn() {}, error() {} };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pcdb-'));
const rm = d => fs.rmSync(d, { recursive: true, force: true });

(async () => {
  // ───────────────── reading and filters ─────────────────
  let dir = tmp(); let st = openStore({ dir, log: quiet }); let u = st.collection('users');
  const D = s => new Date(s);
  await u.insertOne({ _id: 'a', phone: '0707', status: 'active', bal: 100, tags: ['x', 'y'], team: { l1: 2, l2: 0 }, createdAt: D('2026-01-02T00:00:00Z'), ids: ['d1', 'd2'] });
  await u.insertOne({ _id: 'b', phone: '0505', status: 'banned', bal: 50, tags: ['y'], team: { l1: 0, l2: 0 }, createdAt: D('2026-01-03T00:00:00Z'), ids: [] });
  await u.insertOne({ _id: 'c', phone: '0101', bal: 0, createdAt: D('2026-01-01T00:00:00Z') });
  const ids = async f => (await u.find(f).toArray()).map(d => d._id).sort();
  eq(await ids({}), ['a', 'b', 'c'], 'all');
  eq(await ids({ status: 'active' }), ['a'], 'equality');
  eq(await ids({ status: null }), ['c'], 'null equals a missing field');
  eq(await ids({ status: { $ne: 'banned' } }), ['a', 'c'], '$ne matches a missing field too');
  eq(await ids({ tags: 'x' }), ['a'], 'equality against an array field matches an element (array-contains)');
  eq(await ids({ tags: { $ne: 'y' } }), ['c'], '$ne against an array');
  eq(await ids({ bal: { $gte: 50 } }), ['a', 'b'], '$gte'); eq(await ids({ bal: { $gt: 50 } }), ['a'], '$gt'); eq(await ids({ bal: { $lte: 50, $gt: 0 } }), ['b'], 'range');
  eq(await ids({ bal: { $lt: 50 } }), ['c'], '$lt');
  eq(await ids({ status: { $in: ['active', 'x'] } }), ['a'], '$in'); eq(await ids({ status: { $nin: ['active'] } }), ['b', 'c'], '$nin includes missing');
  eq(await ids({ 'team.l1': 2 }), ['a'], 'dotted path'); eq(await ids({ 'team.l1': { $gte: 0 } }), ['a', 'b'], 'dotted range');
  eq(await ids({ createdAt: { $gte: D('2026-01-02T00:00:00Z') } }), ['a', 'b'], 'dates compare as dates');
  eq(await ids({ createdAt: D('2026-01-03T00:00:00Z') }), ['b'], 'date equality');
  eq(await ids({ bal: { $gte: 'x' } }), [], 'a number is never compared with a string');
  eq(await ids({ status: { $exists: true } }), ['a', 'b'], '$exists true'); eq(await ids({ status: { $exists: false } }), ['c'], '$exists false');
  eq(await ids({ $or: [{ status: 'active' }, { bal: 0 }] }), ['a', 'c'], '$or'); eq(await ids({ $and: [{ bal: { $gt: 0 } }, { tags: 'y' }] }), ['a', 'b'], '$and');
  eq(await ids({ $nor: [{ status: 'active' }] }), ['b', 'c'], '$nor'); eq(await ids({ phone: { $regex: '^07' } }), ['a'], '$regex');
  eq(await ids({ ids: { $size: 0 } }), ['b'], '$size'); eq(await ids({ status: { $not: { $eq: 'active' } } }), ['b', 'c'], '$not');
  let threw = null; try { await ids({ bal: { $near: 1 } }); } catch (e) { threw = e; } ok(threw && /Unsupported filter operator/.test(threw.message), 'an operator it does not know throws, it never quietly matches nothing');
  threw = null; try { await ids({ $where: 'x' }); } catch (e) { threw = e; } ok(threw, '$where is refused');
  // sort / limit / skip / project / count
  eq((await u.find({}).sort({ bal: -1 }).toArray()).map(d => d._id), ['a', 'b', 'c'], 'sort desc');
  eq((await u.find({}).sort({ createdAt: 1 }).limit(2).toArray()).map(d => d._id), ['c', 'a'], 'sort asc + limit');
  eq((await u.find({}).sort({ status: 1 }).toArray()).map(d => d._id)[0], 'c', 'a missing field sorts first');
  eq((await u.find({}).sort({ bal: 1 }).skip(1).limit(1).toArray()).map(d => d._id), ['b'], 'skip');
  eq(await u.find({ _id: 'a' }).project({ _id: 1, phone: 1 }).toArray(), [{ _id: 'a', phone: '0707' }], 'projection');
  eq(await u.countDocuments({ bal: { $gte: 0 } }), 3, 'count'); eq(await u.countDocuments({ bal: { $gte: 0 } }, { limit: 2 }), 2, 'count with a limit');
  // what is handed out is a copy
  const copy = await u.findOne({ _id: 'a' }); copy.tags.push('HACK'); copy.team.l1 = 99; copy.createdAt.setFullYear(1999);
  const again = await u.findOne({ _id: 'a' });
  ok(again.tags.length === 2 && again.team.l1 === 2 && again.createdAt.getFullYear() === 2026, 'changing what a read returned never changes the stored document');
  eq(await u.findOne({ _id: 'zzz' }), null, 'findOne of nothing is null');

  // ───────────────── updates ─────────────────
  let r = await u.updateOne({ _id: 'a' }, { $set: { status: 'x', 'team.l2': 5 }, $inc: { bal: 25, fresh: 3 }, $unset: { phone: '' } });
  eq([r.matchedCount], [1], 'matched'); let a = await u.findOne({ _id: 'a' });
  ok(a.status === 'x' && a.team.l2 === 5 && a.team.l1 === 2 && a.bal === 125 && a.fresh === 3 && a.phone === undefined, '$set (dotted), $inc (also on a missing field), $unset');
  await u.updateOne({ _id: 'a' }, { $addToSet: { ids: 'd2' } }); await u.updateOne({ _id: 'a' }, { $addToSet: { ids: 'd3' } }); await u.updateOne({ _id: 'a' }, { $addToSet: { ids: { $each: ['d3', 'd4'] } } });
  eq((await u.findOne({ _id: 'a' })).ids, ['d1', 'd2', 'd3', 'd4'], '$addToSet adds once');
  await u.updateOne({ _id: 'a' }, { $pull: { ids: 'd1' } }); await u.updateOne({ _id: 'a' }, { $pull: { ids: { $in: ['d2', 'd3'] } } });
  eq((await u.findOne({ _id: 'a' })).ids, ['d4'], '$pull a value and a list');
  threw = null; try { await u.updateOne({ _id: 'a' }, { $inc: { status: 1 } }); } catch (e) { threw = e; } ok(threw, '$inc on a non-number throws');
  threw = null; try { await u.updateOne({ _id: 'a' }, { $rename: { a: 'b' } }); } catch (e) { threw = e; } ok(threw && /Unsupported update operator/.test(threw.message), 'an update operator it does not know throws');
  r = await u.updateOne({ _id: 'nope' }, { $set: { a: 1 } }); eq([r.matchedCount, r.upsertedCount], [0, 0], 'no match, no upsert: nothing');
  // the conditional update the money paths use (updateIf): one atomic check-and-write
  r = await u.updateOne({ _id: 'a', creditedDepositIds: { $ne: 'dep1' } }, { $inc: { bal: 10 }, $addToSet: { creditedDepositIds: 'dep1' } });
  eq(r.matchedCount, 1, 'first credit applies');
  r = await u.updateOne({ _id: 'a', creditedDepositIds: { $ne: 'dep1' } }, { $inc: { bal: 10 }, $addToSet: { creditedDepositIds: 'dep1' } });
  eq(r.matchedCount, 0, 'the same credit again matches nothing (no double credit)'); eq((await u.findOne({ _id: 'a' })).bal, 135, 'and the balance moved once');
  r = await u.updateOne({ _id: 'b', bal: { $gte: 60 } }, { $inc: { bal: -60 } }); eq(r.matchedCount, 0, 'a debit that would overdraw matches nothing');
  // 20 racing conditional debits of 10 on a balance of 50: exactly 5 win
  await u.insertOne({ _id: 'race', bal: 50 });
  const wins = (await Promise.all(Array.from({ length: 20 }, () => u.updateOne({ _id: 'race', bal: { $gte: 10 } }, { $inc: { bal: -10 } })))).filter(x => x.matchedCount === 1).length;
  eq([wins, (await u.findOne({ _id: 'race' })).bal], [5, 0], '20 racing debits on a balance of 50: exactly 5 apply, never below 0');
  // upsert / create-if-absent
  r = await u.updateOne({ _id: 'z1' }, { $setOnInsert: { _id: 'z1', n: 1 } }, { upsert: true }); eq([r.upsertedCount, (await u.findOne({ _id: 'z1' })).n], [1, 1], 'create if absent creates');
  r = await u.updateOne({ _id: 'z1' }, { $setOnInsert: { _id: 'z1', n: 2 } }, { upsert: true }); eq([r.upsertedCount, (await u.findOne({ _id: 'z1' })).n], [0, 1], 'and never changes an existing one');
  r = await u.updateOne({ _id: 'z2' }, { $set: { q: 1 } }, { upsert: true }); eq([r.upsertedCount, (await u.findOne({ _id: 'z2' }))], [1, { _id: 'z2', q: 1 }], 'upsert with $set');
  r = await u.replaceOne({ _id: 'z2' }, { w: 5 }, { upsert: true }); eq(await u.findOne({ _id: 'z2' }), { _id: 'z2', w: 5 }, 'replace drops the old fields');
  r = await u.replaceOne({ _id: 'z3' }, { w: 6 }, { upsert: true }); eq((await u.findOne({ _id: 'z3' })).w, 6, 'replace + upsert creates');
  threw = null; try { await u.insertOne({ _id: 'a' }); } catch (e) { threw = e; } ok(threw && threw.code === 11000, 'inserting an existing _id is a duplicate-key error (11000)');
  await u.insertOne({ _id: 'u1', v: undefined, nested: { k: undefined } }); eq(await u.findOne({ _id: 'u1' }), { _id: 'u1', v: null, nested: { k: null } }, 'undefined is stored as null, like the MongoDB driver');
  eq((await u.deleteOne({ _id: 'u1' })).deletedCount, 1, 'delete'); eq((await u.deleteOne({ _id: 'u1' })).deletedCount, 0, 'delete again');
  eq((await u.deleteMany({ _id: { $in: ['z1', 'z2', 'z3'] } })).deletedCount, 3, 'deleteMany');
  // an update that changes nothing writes nothing
  const before = st.journalBytes + st.buf.join('').length; await u.updateOne({ _id: 'a' }, { $set: { status: 'x' } }); await u.updateOne({ _id: 'a' }, { $setOnInsert: { q: 1 } }, { upsert: true });
  eq(st.journalBytes + st.buf.join('').length, before, 'an update that changes nothing writes nothing');
  await st.close(); rm(dir);

  // ───────────────── indexes ─────────────────
  dir = tmp(); st = openStore({ dir, log: quiet }); u = st.collection('users');
  // the partial unique indexes db.js really builds: unique only over STRING values ($type: "string")
  await u.createIndex({ referralCodeLower: 1 }, { unique: true, name: 'ref_unique', partialFilterExpression: { referralCodeLower: { $type: 'string' } } });
  await u.insertOne({ _id: 'p1', referralCodeLower: 'abc' }); await u.insertOne({ _id: 'p2' }); await u.insertOne({ _id: 'p3', referralCodeLower: null }); await u.insertOne({ _id: 'p4', referralCodeLower: null });
  threw = null; try { await u.insertOne({ _id: 'p5', referralCodeLower: 'abc' }); } catch (e) { threw = e; } ok(threw && threw.code === 11000, 'a $type:string partial unique index refuses a second identical string');
  eq(await u.countDocuments({}), 4, 'while documents with the field missing or null can be any number');
  await u.deleteMany({});
  threw = null; try { await st.collection('t1').createIndex({ k: 1 }, { unique: true, partialFilterExpression: { k: { $near: 1 } } }); await st.collection('t1').insertOne({ _id: '1', k: 'a' }); } catch (e) { threw = e; }
  ok(threw && /Unsupported filter operator/.test(threw.message), 'an unsupported partial filter is refused loudly');
  st.cols.delete('t1');
  // the filters the real indexes use: $exists / $gt on strings
  const U = st.collection('promo');
  await U.createIndex({ code: 1 }, { unique: true, partialFilterExpression: { code: { $exists: true } }, name: 'code_unique' });
  await U.insertOne({ _id: '1', code: 'AAA' }); await U.insertOne({ _id: '2' }); await U.insertOne({ _id: '3' });
  eq(await U.countDocuments({}), 3, 'a partial unique index lets any number of documents WITHOUT the field exist');
  threw = null; try { await U.insertOne({ _id: '4', code: 'AAA' }); } catch (e) { threw = e; } ok(threw && threw.code === 11000, 'a second document with the same unique value is refused (11000)');
  eq(await U.countDocuments({}), 3, 'and nothing was written');
  threw = null; try { await U.updateOne({ _id: '2' }, { $set: { code: 'AAA' } }); } catch (e) { threw = e; } ok(threw && threw.code === 11000, 'so is an update that would create a duplicate');
  eq((await U.findOne({ _id: '2' })).code, undefined, 'the refused update changed nothing');
  threw = null; try { await U.updateOne({ _id: '9' }, { $setOnInsert: { _id: '9', code: 'AAA' } }, { upsert: true }); } catch (e) { threw = e; } ok(threw && threw.code === 11000, 'and an upsert');
  await U.updateOne({ _id: '1' }, { $set: { code: 'BBB' } }); await U.insertOne({ _id: '5', code: 'AAA' }); ok(true, 'a value freed by an update can be used again');
  await U.deleteOne({ _id: '5' }); await U.insertOne({ _id: '6', code: 'AAA' }); ok(true, 'and one freed by a delete');
  // a unique index cannot be built over data that already violates it
  const V = st.collection('dups'); await V.insertOne({ _id: '1', k: 'z' }); await V.insertOne({ _id: '2', k: 'z' });
  threw = null; try { await V.createIndex({ k: 1 }, { unique: true }); } catch (e) { threw = e; } ok(threw && threw.code === 11000, 'building a unique index over existing duplicates fails');
  // an index lookup gives EXACTLY what a scan gives (random data and queries)
  const W = st.collection('inv'); await W.createIndex({ userId: 1, status: 1 }); await W.createIndex({ status: 1, createdAt: 1 });
  let seed = 7; const rnd = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const statuses = ['active', 'matured', 'x', null], docs = [];
  for (let i = 0; i < 600; i++) { const d = { _id: 'i' + i, userId: 'u' + rnd(12), status: statuses[rnd(4)], createdAt: new Date(1e12 + rnd(1000) * 1e6), n: rnd(5) }; if (rnd(10) === 0) d.userId = ['u1', 'u2']; if (rnd(15) === 0) delete d.status; docs.push(d); await W.insertOne(d); }
  for (let i = 0; i < 150; i++) {   // churn: updates and deletes keep the index right
    const id = 'i' + rnd(600); if (rnd(3) === 0) await W.deleteOne({ _id: id }); else await W.updateOne({ _id: id }, { $set: { status: statuses[rnd(4)], userId: 'u' + rnd(12) } });
  }
  const all = [...W._docs.docs.values()];
  let mismatches = 0;
  for (let i = 0; i < 300; i++) {
    const f = {}; const k = rnd(5);
    if (k === 0) f.userId = 'u' + rnd(12); else if (k === 1) { f.userId = 'u' + rnd(12); f.status = statuses[rnd(3)]; } else if (k === 2) f.status = statuses[rnd(3)]; else if (k === 3) f.userId = { $in: ['u' + rnd(12), 'u' + rnd(12)] }; else { f.status = 'active'; f.n = { $gte: rnd(5) }; }
    const scan = all.filter(d => compileFilter(f)(d)).map(d => d._id).sort();
    const idx = (await W.find(f).toArray()).map(d => d._id).sort();
    if (JSON.stringify(scan) !== JSON.stringify(idx)) { mismatches++; console.log('MISMATCH', JSON.stringify(f), scan.length, idx.length); }
  }
  eq(mismatches, 0, '300 random queries: the indexed answer equals the scan answer (arrays, nulls, missing fields, churn)');
  await st.close(); rm(dir);

  // ───────────────── expiry (TTL index) ─────────────────
  dir = tmp(); st = openStore({ dir, log: quiet });
  const S = st.collection('memberSessions'); await S.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 86400 });
  await S.insertOne({ _id: 'old', expiresAt: new Date(Date.now() - 3 * 86400000) }); await S.insertOne({ _id: 'recent', expiresAt: new Date(Date.now() - 3600000) }); await S.insertOne({ _id: 'future', expiresAt: new Date(Date.now() + 3600000) }); await S.insertOne({ _id: 'nodate' });
  eq(st.sweepExpired(), 1, 'one session expired more than a day ago');
  eq((await S.find({}).toArray()).map(d => d._id).sort(), ['future', 'nodate', 'recent'], 'only the one past its expiry + 1 day is deleted');
  await st.close(); rm(dir);

  // ───────────────── durability ─────────────────
  dir = tmp(); st = openStore({ dir, log: quiet }); u = st.collection('users');
  await u.createIndex({ phone: 1 }, { unique: true, partialFilterExpression: { phone: { $exists: true } } });
  // a burst of 3000 writes: all acknowledged, far fewer than 3000 fsyncs (group commit)
  const realFsync = fs.fsync; let fsyncs = 0; fs.fsync = (fd, cb) => { fsyncs++; realFsync(fd, cb); };
  await Promise.all(Array.from({ length: 3000 }, (_, i) => u.insertOne({ _id: 'm' + i, phone: 'p' + i, bal: i, at: new Date(1e12 + i) })));
  fs.fsync = realFsync;
  ok(fsyncs > 0 && fsyncs < 300, `3000 writes shared ${fsyncs} fsync(s) (group commit), and every one was acknowledged only after it`);
  await u.updateOne({ _id: 'm5' }, { $inc: { bal: 1000 } }); await u.deleteOne({ _id: 'm6' });
  // "crash": reopen WITHOUT closing (the old process just vanishes); a torn half line is on the end of the journal
  const jf = path.join(dir, `journal-${st.gen}.jsonl`); const sizeGood = fs.statSync(jf).size;
  fs.appendFileSync(jf, '{"o":"p","c":"users","i":"torn","d":{"_id":"torn","bal":');
  const st2 = new LocalStore({ dir, log: quiet }); st2.open(); const u2 = st2.collection('users');
  eq(await u2.countDocuments({}), 2999, 'after a crash every acknowledged change is back (3000 inserted, one deleted)');
  eq([(await u2.findOne({ _id: 'm5' })).bal, await u2.findOne({ _id: 'm6' }), await u2.findOne({ _id: 'torn' })], [1005, null, null], 'the update, the delete, and the torn line ignored');
  eq((await u2.findOne({ _id: 'm10' })).at instanceof Date, true, 'dates come back as dates');
  await u2.createIndex({ phone: 1 }, { unique: true, partialFilterExpression: { phone: { $exists: true } } });
  threw = null; try { await u2.insertOne({ _id: 'new', phone: 'p77' }); } catch (e) { threw = e; } ok(threw && threw.code === 11000, 'uniqueness holds on the reloaded data');
  ok(fs.readdirSync(dir).filter(f => /^(snapshot|journal)-/.test(f)).length === 2, 'one snapshot and one journal are left (the old generation is gone)');
  await st2.close();
  // a compaction that died: a half-written snapshot (.tmp) and a snapshot with no end line are ignored, the previous generation wins
  const st3 = openStore({ dir, log: quiet }); const u3 = st3.collection('users'); const g = st3.gen;
  await u3.insertOne({ _id: 'late', bal: 1 }); await st3.close();
  fs.writeFileSync(path.join(dir, `snapshot-${g + 1}.jsonl.tmp`), '{"snapshot":true}\n{"c":"users","d":{"_id":"ghost"}}\n');
  fs.writeFileSync(path.join(dir, `snapshot-${g + 5}.jsonl`), '{"snapshot":true}\n{"c":"users","d":{"_id":"ghost2"}}\n');   // no end line: incomplete
  const st4 = openStore({ dir, log: quiet });
  eq([await st4.collection('users').findOne({ _id: 'ghost' }), await st4.collection('users').findOne({ _id: 'ghost2' }), (await st4.collection('users').findOne({ _id: 'late' })).bal], [null, null, 1], 'a half-written or incomplete snapshot is ignored; the last complete state is used');
  await st4.close();
  // the lock: a second process on the same folder is refused
  fs.writeFileSync(path.join(dir, 'LOCK'), String(process.ppid));
  threw = null; try { new LocalStore({ dir, log: quiet }).open(); } catch (e) { threw = e; } ok(threw && /already in use/.test(threw.message), 'a folder in use by another live process is refused');
  fs.writeFileSync(path.join(dir, 'LOCK'), '999999');
  const st5 = openStore({ dir, log: quiet }); ok(true, 'a stale lock (a dead process) is taken over'); await st5.close();
  // a disk that stops working: nothing more is acknowledged, health says so
  const st6 = openStore({ dir, log: quiet }); const realWrite = fs.write; fs.write = (fd, b, o, l, p, cb) => cb(new Error('ENOSPC: no space left on device'));
  threw = null; try { await st6.collection('users').insertOne({ _id: 'x1' }); } catch (e) { threw = e; } fs.write = realWrite;
  ok(threw && /could not write to disk/.test(threw.message) && !st6.isHealthy(), 'a write that cannot reach the disk is NOT acknowledged and the store reports unhealthy');
  threw = null; try { await st6.collection('users').insertOne({ _id: 'x2' }); } catch (e) { threw = e; } ok(threw, 'and nothing after it is acknowledged either');
  await st6.command({ ping: 1 }).then(() => ok(false, 'ping must fail'), () => ok(true, 'ping fails'));
  await st6.close();

  // ───────────────── backup and restore ─────────────────
  const st7 = openStore({ dir, log: quiet, keepBackups: 2 }); const bdir = path.join(dir, 'bk');
  const b1 = await st7.backup(bdir); ok(fs.existsSync(b1.file) && b1.docs === 3000, 'a backup file with every document (' + b1.docs + ')');
  await new Promise(r => setTimeout(r, 1100)); await st7.backup(bdir); await new Promise(r => setTimeout(r, 1100)); await st7.backup(bdir);
  eq(fs.readdirSync(bdir).filter(f => /\.gz$/.test(f)).length, 2, 'only the newest 2 backups are kept');
  const newest = fs.readdirSync(bdir).filter(f => /\.gz$/.test(f)).sort().pop();
  await st7.collection('users').deleteMany({}); eq(await st7.collection('users').countDocuments({}), 0, 'everything erased (a disaster)');
  await st7.close();
  const restored = LocalStore.restoreFromBackup(path.join(bdir, newest), dir);
  const st8 = openStore({ dir, log: quiet });
  eq(await st8.collection('users').countDocuments({}), 3000, 'restoring the backup brings all ' + restored.docs + ' documents back');
  eq((await st8.collection('users').findOne({ _id: 'm5' })).bal, 1005, 'with their values');
  await st8.close();
  threw = null; const bad = path.join(bdir, 'bad.jsonl.gz'); fs.writeFileSync(bad, zlib.gzipSync('{"c":"users","d":{"_id":"1"}}\n'));
  try { LocalStore.restoreFromBackup(bad, tmp()); } catch (e) { threw = e; } ok(threw && /incomplete/.test(threw.message), 'an incomplete backup file is refused');
  rm(dir);

  // ───────────────── fast sorted reads and the two durability modes ─────────────────
  { const dd = tmp(); const sa = openStore({ dir: dd, log: quiet }); const c = sa.collection('t');
    await c.createIndex({ userId: 1 });
    for (let i = 0; i < 600; i++) await c.insertOne({ _id: 'r' + i, userId: i % 3 ? 'a' : 'b', when: new Date(1e12 + ((i * 7919) % 211) * 1000), n: (i * 31) % 17 });
    for (const [f, sp, lim, sk] of [[{ userId: 'a' }, { when: -1 }, 20, 0], [{ userId: 'a' }, { when: 1 }, 5, 3], [{}, { n: -1, when: 1 }, 40, 10], [{ userId: 'b' }, { n: 1 }, 0, 0], [{}, { when: -1 }, 1, 0]]) {
      const fast = await c.find(f).sort(sp).limit(lim).skip(sk).toArray();
      const all = await c.find(f).sort(sp).toArray(); const want = all.slice(sk, lim ? sk + lim : undefined);
      eq(fast.map(d => d._id).join(), want.map(d => d._id).join(), 'sorted + limit gives exactly the first rows of the full sort ' + JSON.stringify(sp) + ' limit ' + lim + ' skip ' + sk);
    }
    await sa.close(); rm(dd);
    for (const mode of ['fast', 'strict']) {
      const d2 = tmp(); const sm = openStore({ dir: d2, log: quiet, sync: mode }); eq(sm.syncMode, mode, mode + ' mode is selected');
      await Promise.all(Array.from({ length: 300 }, (_, i) => sm.collection('m').insertOne({ _id: 'k' + i, v: i })));
      await sm.collection('m').updateOne({ _id: 'k5' }, { $inc: { v: 1000 } }); await sm.compact(); await sm.collection('m').insertOne({ _id: 'after', v: 1 });
      await sm.close(); const s2 = openStore({ dir: d2, log: quiet });
      eq(await s2.collection('m').countDocuments({}), 301, mode + ': every acknowledged change is there after a restart (also across a compaction)'); eq((await s2.collection('m').findOne({ _id: 'k5' })).v, 1005, mode + ': with its value');
      await s2.close(); rm(d2);
    }
    const d3 = tmp(); const sd = openStore({ dir: d3, log: quiet }); eq(sd.syncMode, 'fast', 'fast is the default'); await sd.close(); rm(d3);
  }

  console.log(`PASS: PersonalCare local database (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
