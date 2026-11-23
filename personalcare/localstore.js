'use strict';
// PersonalCare's own database: it lives ON the VPS, in this process's memory, and is made durable with a journal on the VPS disk. No MongoDB.
//
// What it is: every collection is a Map of documents (each with a string `_id`). Every change is applied in memory at once (so reads are
// instant) and is written to an append-only journal file that is fsync'ed before the caller's promise resolves, so a member is never told
// "done" for a change that a power cut could still lose. Many changes made in the same moment share ONE fsync (group commit), which is
// what keeps it fast. From time to time the journal is folded into a full snapshot (compaction) and a dated, compressed backup is kept.
//
// What it speaks: the small part of MongoDB's collection API that db.js uses -- findOne, find(filter).sort().limit().skip().project(),
// insertOne, replaceOne, updateOne (+ upsert, $set $inc $unset $addToSet $pull $push $setOnInsert), deleteOne, deleteMany,
// countDocuments, createIndex (plain, unique and partial-unique), command({ ping }). Filters: equality, $eq $ne $gt $gte $lt $lte $in $nin
// $exists $not $regex $size $all, and $and $or $nor. An operator it does not know THROWS (it never quietly matches nothing), so a future
// query cannot silently misbehave.
//
// Files in the data directory (one generation number N, always the highest complete snapshot):
//   snapshot-N.jsonl   every document at one moment ("{c, d}" per line) and a closing {"end":true,"n":count} line that proves it is complete
//   journal-N.jsonl    every change after that snapshot, one JSON line each: put {o:"p",c,i,d} (the whole new document) or delete {o:"d",c,i}
//   LOCK               the pid of the process that owns the directory (a second process is refused, two writers would corrupt it)
//   backups/           backup-YYYYMMDD-HHMMSS.jsonl.gz, the newest KEEP of them
// Because a journal line carries the WHOLE new document, replaying it is idempotent: replay it twice, or over a newer snapshot, and the end
// state is the same. A torn last line (power cut mid-write) is ignored and cut off.
const fs = require('fs'), path = require('path'), zlib = require('zlib');

// ───────────────────────── values ─────────────────────────
const isPlain = v => v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && !(v instanceof RegExp);
// Deep copy for storing and for handing out. undefined becomes null (what the MongoDB driver stores for it), so a field set to undefined is
// never silently absent.
function toStore(v) {
  if (v === undefined) return null;
  if (v === null || typeof v !== 'object') return v;
  if (v instanceof Date) return new Date(v.getTime());
  if (Array.isArray(v)) return v.map(toStore);
  const o = {};
  for (const k of Object.keys(v)) o[k] = toStore(v[k]);
  return o;
}
const clone = toStore;
function ser(obj) {
  return JSON.stringify(obj, function (k, v) { const raw = this[k]; return raw instanceof Date ? { $date: raw.getTime() } : v; });
}
function revive(k, v) {
  if (v && typeof v === 'object' && !Array.isArray(v)) { const ks = Object.keys(v); if (ks.length === 1 && ks[0] === '$date') return new Date(v.$date); }
  return v;
}
function parse(line) { return JSON.parse(line, revive); }
function typeRank(v) {
  if (v === null || v === undefined) return 1;
  if (typeof v === 'number') return 2;
  if (typeof v === 'string') return 3;
  if (Array.isArray(v)) return 5;
  if (v instanceof Date) return 9;
  if (typeof v === 'object') return 4;
  if (typeof v === 'boolean') return 8;
  return 10;
}
function cmp(a, b) {
  const ra = typeRank(a), rb = typeRank(b);
  if (ra !== rb) return ra < rb ? -1 : 1;
  if (ra === 1) return 0;
  if (ra === 2 || ra === 3 || ra === 8) return a < b ? -1 : a > b ? 1 : 0;
  if (ra === 9) { const x = a.getTime(), y = b.getTime(); return x < y ? -1 : x > y ? 1 : 0; }
  const x = ser(a), y = ser(b); return x < y ? -1 : x > y ? 1 : 0;
}
function eq(a, b) {
  if (a === b) return true;
  if (a === null || a === undefined) return b === null || b === undefined;
  if (b === null || b === undefined) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  if (a instanceof Date || b instanceof Date) return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => eq(x, b[i]));
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every(k => Object.prototype.hasOwnProperty.call(b, k) && eq(a[k], b[k]));
}

// ───────────────────────── paths ─────────────────────────
// Every value a dotted path reaches in a document (arrays are walked into, like MongoDB). A missing field gives [].
function valuesAt(doc, p) {
  const parts = p.split('.');
  let cur = [doc];
  for (const part of parts) {
    const next = [];
    for (const c of cur) {
      if (c === null || c === undefined) continue;
      if (Array.isArray(c)) {
        if (/^\d+$/.test(part)) { if (c[+part] !== undefined) next.push(c[+part]); }
        else for (const el of c) if (isPlain(el) && el[part] !== undefined) next.push(el[part]);
      } else if (isPlain(c) && c[part] !== undefined) next.push(c[part]);
    }
    cur = next;
  }
  return cur;
}
function getOne(doc, p) {
  let cur = doc;
  for (const part of p.split('.')) { if (cur === null || cur === undefined || typeof cur !== 'object') return undefined; cur = cur[part]; }
  return cur;
}
function setPath(doc, p, value) {
  const parts = p.split('.'); let cur = doc;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!isPlain(cur[parts[i]])) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}
function unsetPath(doc, p) {
  const parts = p.split('.'); let cur = doc;
  for (let i = 0; i < parts.length - 1; i++) { cur = cur[parts[i]]; if (!isPlain(cur)) return; }
  delete cur[parts[parts.length - 1]];
}

// ───────────────────────── filters ─────────────────────────
function compare(op, v, operand) {
  const r = typeRank(v);
  if (r !== typeRank(operand) || r === 1 && operand !== null) return false;
  const c = cmp(v, operand);
  return op === '$gt' ? c > 0 : op === '$gte' ? c >= 0 : op === '$lt' ? c < 0 : c <= 0;
}
// Does ONE field condition hold for a document? `vals` are the values at the field's path ([] when missing).
function fieldMatches(vals, cond) {
  const isOps = isPlain(cond) && Object.keys(cond).length && Object.keys(cond).every(k => k[0] === '$');
  if (!isOps) return equalityMatches(vals, cond);
  for (const op of Object.keys(cond)) {
    const operand = cond[op];
    switch (op) {
      case '$eq': if (!equalityMatches(vals, operand)) return false; break;
      case '$ne': if (equalityMatches(vals, operand)) return false; break;
      case '$gt': case '$gte': case '$lt': case '$lte': {
        const any = vals.some(v => (Array.isArray(v) ? v.some(e => compare(op, e, operand)) : compare(op, v, operand)));
        if (!any) return false; break;
      }
      case '$in': {
        if (!Array.isArray(operand)) throw new Error('$in needs an array');
        if (!operand.some(o => equalityMatches(vals, o))) return false; break;
      }
      case '$nin': {
        if (!Array.isArray(operand)) throw new Error('$nin needs an array');
        if (operand.some(o => equalityMatches(vals, o))) return false; break;
      }
      case '$exists': if ((vals.length > 0) !== !!operand) return false; break;
      case '$not': if (fieldMatches(vals, operand)) return false; break;
      case '$regex': {
        const re = operand instanceof RegExp ? operand : new RegExp(operand, cond.$options || '');
        if (!vals.some(v => (Array.isArray(v) ? v.some(e => typeof e === 'string' && re.test(e)) : typeof v === 'string' && re.test(v)))) return false; break;
      }
      case '$options': break;
      case '$type': {
        const names = [].concat(operand);
        const nameOf = v => v === null ? 'null' : typeof v === 'string' ? 'string' : typeof v === 'number' ? 'number' : typeof v === 'boolean' ? 'bool' : v instanceof Date ? 'date' : Array.isArray(v) ? 'array' : 'object';
        const aliases = { double: 'number', int: 'number', long: 'number', decimal: 'number', boolean: 'bool', null: 'null', string: 'string', date: 'date', array: 'array', object: 'object', number: 'number', bool: 'bool' };
        const want = names.map(n => { if (!aliases[n]) throw new Error('Unsupported $type ' + n); return aliases[n]; });
        if (!vals.some(v => want.includes(nameOf(v)) || (Array.isArray(v) && v.some(e => want.includes(nameOf(e)))))) return false; break;
      }
      case '$size': if (!vals.some(v => Array.isArray(v) && v.length === operand)) return false; break;
      case '$all': if (!vals.some(v => Array.isArray(v) && operand.every(o => v.some(e => eq(e, o))))) return false; break;
      default: throw new Error('Unsupported filter operator ' + op);
    }
  }
  return true;
}
function equalityMatches(vals, want) {
  if (want instanceof RegExp) return vals.some(v => (Array.isArray(v) ? v.some(e => typeof e === 'string' && want.test(e)) : typeof v === 'string' && want.test(v)));
  if (want === null || want === undefined) return vals.length === 0 || vals.some(v => v === null);
  return vals.some(v => eq(v, want) || (Array.isArray(v) && v.some(e => eq(e, want))));
}
function compileFilter(filter) {
  const f = filter || {};
  const parts = [];
  for (const key of Object.keys(f)) {
    const cond = f[key];
    if (key === '$and') parts.push(d => cond.every(sub => compileFilter(sub)(d)));
    else if (key === '$or') { const subs = cond.map(compileFilter); parts.push(d => subs.some(fn => fn(d))); }
    else if (key === '$nor') { const subs = cond.map(compileFilter); parts.push(d => !subs.some(fn => fn(d))); }
    else if (key[0] === '$') throw new Error('Unsupported filter operator ' + key);
    else parts.push(d => fieldMatches(valuesAt(d, key), cond));
  }
  return d => { for (const p of parts) if (!p(d)) return false; return true; };
}
// Scalars an index can be looked up by.
const scalarKey = v => (v === null || v === undefined ? 'n' : typeof v === 'string' ? 's' + v : typeof v === 'number' ? 'd' + v : typeof v === 'boolean' ? 'b' + v : null);

// ───────────────────────── updates ─────────────────────────
function applyUpdate(doc, update, inserting) {
  for (const op of Object.keys(update)) {
    const spec = update[op];
    switch (op) {
      case '$set': for (const k of Object.keys(spec)) { if (k === '_id') continue; setPath(doc, k, toStore(spec[k])); } break;
      case '$setOnInsert': if (inserting) for (const k of Object.keys(spec)) setPath(doc, k, toStore(spec[k])); break;
      case '$unset': for (const k of Object.keys(spec)) unsetPath(doc, k); break;
      case '$inc': for (const k of Object.keys(spec)) {
        const cur = getOne(doc, k), n = spec[k];
        if (typeof n !== 'number') throw new Error('$inc needs a number');
        if (cur === undefined || cur === null) setPath(doc, k, n);
        else if (typeof cur !== 'number') throw new Error('Cannot $inc the non-number field ' + k);
        else setPath(doc, k, cur + n);
      } break;
      case '$addToSet': for (const k of Object.keys(spec)) {
        let arr = getOne(doc, k);
        if (arr === undefined || arr === null) { arr = []; setPath(doc, k, arr); }
        if (!Array.isArray(arr)) throw new Error('Cannot $addToSet to the non-array field ' + k);
        const items = isPlain(spec[k]) && Array.isArray(spec[k].$each) ? spec[k].$each : [spec[k]];
        for (const it of items) if (!arr.some(e => eq(e, it))) arr.push(toStore(it));
      } break;
      case '$push': for (const k of Object.keys(spec)) {
        let arr = getOne(doc, k);
        if (arr === undefined || arr === null) { arr = []; setPath(doc, k, arr); }
        if (!Array.isArray(arr)) throw new Error('Cannot $push to the non-array field ' + k);
        const items = isPlain(spec[k]) && Array.isArray(spec[k].$each) ? spec[k].$each : [spec[k]];
        for (const it of items) arr.push(toStore(it));
      } break;
      case '$pull': for (const k of Object.keys(spec)) {
        const arr = getOne(doc, k); if (!Array.isArray(arr)) continue;
        const cond = spec[k];
        const drop = isPlain(cond) && Array.isArray(cond.$in) ? (e => cond.$in.some(o => eq(e, o))) : (e => eq(e, cond));
        setPath(doc, k, arr.filter(e => !drop(e)));
      } break;
      default: throw new Error('Unsupported update operator ' + op);
    }
  }
}

// ───────────────────────── the store ─────────────────────────
class DuplicateKeyError extends Error {
  constructor(msg) { super(msg); this.code = 11000; this.name = 'MongoServerError'; }
}
function writeAllSync(fd, buf) { let off = 0; while (off < buf.length) off += fs.writeSync(fd, buf, off, buf.length - off); }

class Index {
  constructor(spec) {
    this.keys = spec.keys;                       // [[field, dir], ...]
    this.fields = spec.keys.map(k => k[0]);
    this.unique = !!spec.unique;
    this.partial = spec.partial ? compileFilter(spec.partial) : null;
    this.name = spec.name || this.fields.join('_');
    this.map = new Map();                        // keyString -> Set(_id)
    this.uniq = new Map();                       // unique indexes only: uniqueKey -> _id
    this.other = new Set();                      // ids whose value cannot be looked up by hash (arrays, dates, objects): always candidates
  }
  // undefined = left out (a partial index that does not cover this document); null = cannot be looked up by hash; else the key
  keyOf(doc) {
    if (this.partial && !this.partial(doc)) return undefined;
    const out = [];
    for (const f of this.fields) {
      const v = getOne(doc, f);
      const sk = Array.isArray(v) ? null : (scalarKey(v === undefined ? null : v) ?? (v instanceof Date ? 't' + v.getTime() : null));
      if (sk === null) return null;
      out.push(sk);
    }
    return out.join('\u0001');
  }
  // The identity a UNIQUE index guards: arrays and dates count too.
  uniqueKey(doc) {
    if (this.partial && !this.partial(doc)) return undefined;
    return ser(this.fields.map(f => { const v = getOne(doc, f); return v === undefined ? null : v; }));
  }
  add(id, doc) {
    if (this.unique) { const u = this.uniqueKey(doc); if (u !== undefined) this.uniq.set(u, id); }
    const k = this.keyOf(doc);
    if (k === undefined) return;
    if (k === null) { this.other.add(id); return; }
    let s = this.map.get(k); if (!s) this.map.set(k, s = new Set()); s.add(id);
  }
  remove(id, doc) {
    if (this.unique) { const u = this.uniqueKey(doc); if (u !== undefined && this.uniq.get(u) === id) this.uniq.delete(u); }
    const k = this.keyOf(doc);
    if (k === undefined) return;
    if (k === null) { this.other.delete(id); return; }
    const s = this.map.get(k); if (s) { s.delete(id); if (!s.size) this.map.delete(k); }
  }
}

class Collection {
  constructor(store, name) { this.store = store; this.name = name; }
  get _docs() { return this.store._col(this.name); }

  async createIndex(keys, opts = {}) { return this.store._createIndex(this.name, keys, opts); }

  _candidates(filter) {
    const docs = this._docs.docs;
    const f = filter || {};
    if (typeof f._id === 'string') { const d = docs.get(f._id); return d ? [d] : []; }
    const idx = this._docs.indexes;
    let best = null;
    for (const ix of idx) {
      if (ix.partial) continue;                       // a partial index does not hold every document
      let ok = true;
      const parts = [];
      for (const fld of ix.fields) {
        const cond = f[fld];
        const sk = cond === undefined || isPlain(cond) || Array.isArray(cond) || cond instanceof RegExp ? null : scalarKey(cond);
        if (sk === null || (cond === null)) { ok = false; break; }
        parts.push(sk);
      }
      if (ok && (!best || ix.fields.length > best.ix.fields.length)) best = { ix, key: parts.join('\u0001') };
    }
    if (best) { const s = best.ix.map.get(best.key); const out = s ? [...s] : []; for (const id of best.ix.other) out.push(id); return out.map(id => docs.get(id)); }
    // $in on a single-field index: union of lookups
    for (const ix of idx) {
      if (ix.partial || ix.fields.length !== 1) continue;
      const cond = f[ix.fields[0]];
      if (isPlain(cond) && Array.isArray(cond.$in) && Object.keys(cond).length === 1 && cond.$in.every(v => v !== null && v !== undefined && scalarKey(v) !== null)) {
        const out = new Set();
        for (const v of cond.$in) { const s = ix.map.get(scalarKey(v)); if (s) for (const id of s) out.add(id); }
        for (const id of ix.other) out.add(id);
        return [...out].map(id => docs.get(id));
      }
    }
    return docs.values();
  }
  _match(filter) {
    const test = compileFilter(filter);
    const out = [];
    for (const d of this._candidates(filter)) if (d && test(d)) out.push(d);
    return out;
  }
  _first(filter) {
    const test = compileFilter(filter);
    for (const d of this._candidates(filter)) if (d && test(d)) return d;
    return null;
  }

  async findOne(filter) { const d = this._first(filter); return d ? clone(d) : null; }
  find(filter) { return new Cursor(this, filter); }
  async countDocuments(filter, opts = {}) {
    const n = this._match(filter).length;
    return opts && opts.limit ? Math.min(n, opts.limit) : n;
  }

  async insertOne(doc) {
    const id = doc && doc._id;
    if (typeof id !== 'string' || !id) throw new Error('insertOne needs a string _id');
    if (this._docs.docs.has(id)) throw new DuplicateKeyError(`E11000 duplicate key error: ${this.name} _id ${id}`);
    const stored = toStore(doc);
    this.store._put(this.name, id, stored);
    await this.store._commit();
    return { acknowledged: true, insertedId: id };
  }
  async replaceOne(filter, doc, opts = {}) {
    const cur = this._first(filter);
    if (!cur) {
      if (!opts.upsert) return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
      const id = typeof filter._id === 'string' ? filter._id : doc._id;
      if (typeof id !== 'string' || !id) throw new Error('upsert needs a string _id');
      this.store._put(this.name, id, Object.assign(toStore(doc), { _id: id }));
      await this.store._commit();
      return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1, upsertedId: id };
    }
    const next = Object.assign(toStore(doc), { _id: cur._id });
    this.store._put(this.name, cur._id, next);
    await this.store._commit();
    return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
  }
  async updateOne(filter, update, opts = {}) {
    const cur = this._first(filter);
    if (!cur) {
      if (!opts.upsert) return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
      const doc = {};
      for (const k of Object.keys(filter || {})) {
        const c = filter[k];
        if (k[0] === '$') continue;
        if (!isPlain(c) || !Object.keys(c).some(x => x[0] === '$')) setPath(doc, k, toStore(c));
        else if (c.$eq !== undefined) setPath(doc, k, toStore(c.$eq));
      }
      applyUpdate(doc, update, true);
      const id = doc._id;
      if (typeof id !== 'string' || !id) throw new Error('upsert needs a string _id');
      this.store._put(this.name, id, doc);
      await this.store._commit();
      return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1, upsertedId: id };
    }
    const next = clone(cur);
    applyUpdate(next, update, false);
    if (eq(next, cur)) return { matchedCount: 1, modifiedCount: 0, upsertedCount: 0 };   // nothing changed: nothing to write
    this.store._put(this.name, cur._id, next);
    await this.store._commit();
    return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
  }
  async deleteOne(filter) {
    const cur = this._first(filter);
    if (!cur) return { deletedCount: 0 };
    this.store._del(this.name, cur._id);
    await this.store._commit();
    return { deletedCount: 1 };
  }
  async deleteMany(filter) {
    const hit = this._match(filter);
    for (const d of hit) this.store._del(this.name, d._id);
    if (hit.length) await this.store._commit();
    return { deletedCount: hit.length };
  }
}

class Cursor {
  constructor(col, filter) { this.col = col; this.filter = filter || {}; this._sort = null; this._limit = 0; this._skip = 0; this._proj = null; }
  sort(spec) { this._sort = spec; return this; }
  limit(n) { this._limit = n; return this; }
  skip(n) { this._skip = n; return this; }
  project(p) { this._proj = p; return this; }
  async toArray() {
    let hit = this.col._match(this.filter);
    if (this._sort) {
      const keys = Object.keys(this._sort), dirs = keys.map(k => this._sort[k] < 0 ? -1 : 1), nk = keys.length;
      // Sort keys are worked out ONCE per document (not on every comparison); with a limit only the first skip+limit are kept in order.
      const rows = new Array(hit.length);
      for (let i = 0; i < hit.length; i++) { const d = hit[i], kv = new Array(nk); for (let j = 0; j < nk; j++) kv[j] = valuesAt(d, keys[j])[0]; rows[i] = { d, kv, i }; }
      const before = (x, y) => { for (let j = 0; j < nk; j++) { const c = cmp(x.kv[j], y.kv[j]); if (c) return c * dirs[j] < 0; } return x.i < y.i; };
      const want = this._limit ? this._skip + this._limit : 0;
      let top;
      if (want && want * 8 < rows.length) {
        top = [];
        for (const r of rows) {
          if (top.length === want && !before(r, top[want - 1])) continue;
          let lo = 0, hi = top.length;
          while (lo < hi) { const mid = (lo + hi) >> 1; if (before(top[mid], r)) lo = mid + 1; else hi = mid; }
          top.splice(lo, 0, r); if (top.length > want) top.pop();
        }
      } else top = rows.sort((x, y) => before(x, y) ? -1 : before(y, x) ? 1 : 0);
      hit = top.map(r => r.d);
    }
    if (this._skip) hit = hit.slice(this._skip);
    if (this._limit) hit = hit.slice(0, this._limit);
    return hit.map(d => {
      if (!this._proj) return clone(d);
      const o = {};
      const incl = Object.keys(this._proj).filter(k => this._proj[k]);
      for (const k of incl) { const v = getOne(d, k); if (v !== undefined) setPath(o, k, clone(v)); }
      if (this._proj._id !== 0) o._id = d._id;
      return o;
    });
  }
}

class LocalStore {
  // opts: { dir, keepBackups = 14, compactBytes = 64 MB, log = console }
  constructor(opts) {
    this.dir = opts.dir; this.backupDir = opts.backupDir || path.join(opts.dir, 'backups'); this.keep = opts.keepBackups || 14; this.compactBytes = opts.compactBytes || 64 * 1024 * 1024;
    this.log = opts.log || console;
    this.cols = new Map(); this.gen = 0; this.fd = null; this.journalBytes = 0;
    this.buf = []; this.waiters = []; this.flushing = false; this.broken = null; this.closed = false; this.lockPath = path.join(this.dir, 'LOCK');
    this.timers = [];
    // 'fast' (default): a change is acknowledged as soon as it is in the operating system's file cache (it survives the program being killed) and is
    // forced onto the disk a moment later, off the critical path. 'strict': acknowledged only after the disk confirmed it (survives a power cut, slower).
    this.syncMode = opts.sync === 'strict' ? 'strict' : 'fast'; this.syncing = false; this.syncAgain = false;
  }
  _col(name) {
    let c = this.cols.get(name);
    if (!c) { c = { docs: new Map(), indexes: [], ttl: null }; this.cols.set(name, c); }
    return c;
  }
  collection(name) { return new Collection(this, name); }

  // ── open / lock / load ──
  open() {
    fs.mkdirSync(this.dir, { recursive: true });
    this._lock();
    this._load();
    // Fold whatever the last run left in its journal into a fresh snapshot: the journal then starts small.
    if (this.journalBytes > 0 || this.gen === 0) this.compact();
    this._schedule();
    return this;
  }
  _lock() {
    for (let tries = 0; tries < 2; tries++) {
      try { const fd = fs.openSync(this.lockPath, 'wx'); fs.writeSync(fd, String(process.pid)); fs.closeSync(fd); this._ownsLock = true; return; }
      catch (e) {
        if (e.code !== 'EEXIST') throw e;
        let pid = 0; try { pid = parseInt(fs.readFileSync(this.lockPath, 'utf8'), 10); } catch (_) {}
        let alive = false;
        if (pid && pid !== process.pid) { try { process.kill(pid, 0); alive = true; } catch (er) { alive = er.code === 'EPERM'; } }
        if (alive) throw new Error(`The database folder ${this.dir} is already in use by process ${pid}. Two processes must never share it (run ONE server).`);
        try { fs.unlinkSync(this.lockPath); } catch (_) {}
      }
    }
    throw new Error('Could not lock ' + this.dir);
  }
  _readLines(file, onLine) {
    // Reads a (possibly huge) file line by line; returns the byte offset just past the last COMPLETE line.
    const fd = fs.openSync(file, 'r'); const chunk = Buffer.allocUnsafe(4 * 1024 * 1024);
    let carry = Buffer.alloc(0), pos = 0, good = 0;
    try {
      for (;;) {
        const n = fs.readSync(fd, chunk, 0, chunk.length, pos);
        if (!n) break;
        pos += n;
        let data = carry.length ? Buffer.concat([carry, chunk.subarray(0, n)]) : Buffer.from(chunk.subarray(0, n));
        let start = 0, nl;
        const base = pos - n - carry.length;
        while ((nl = data.indexOf(10, start)) !== -1) {
          const line = data.toString('utf8', start, nl);
          if (line.length) onLine(line);
          start = nl + 1; good = base + start;
        }
        carry = data.subarray(start);
      }
    } finally { fs.closeSync(fd); }
    return { good, tail: carry.length };
  }
  _load() {
    const files = fs.readdirSync(this.dir);
    for (const f of files) if (/\.tmp$/.test(f)) { try { fs.unlinkSync(path.join(this.dir, f)); } catch (_) {} }
    const gens = files.map(f => /^snapshot-(\d+)\.jsonl$/.exec(f)).filter(Boolean).map(m => +m[1]).sort((a, b) => b - a);
    let loaded = false;
    for (const g of gens) {
      const tmp = new Map(); let end = false, count = 0, bad = false;
      try {
        this._readLines(path.join(this.dir, `snapshot-${g}.jsonl`), line => {
          const r = parse(line);
          if (r.end) { end = true; if (r.n !== count) bad = true; }
          else if (r.c) { let m = tmp.get(r.c); if (!m) tmp.set(r.c, m = new Map()); m.set(r.d._id, r.d); count++; }
        });
      } catch (e) { bad = true; }
      if (!end || bad) { this.log.warn && this.log.warn(`PersonalCare database: snapshot ${g} is incomplete, trying an older one`); continue; }
      for (const [c, m] of tmp) this._col(c).docs = m;
      this.gen = g; loaded = true; break;
    }
    if (!loaded && gens.length) throw new Error('No complete snapshot found in ' + this.dir + ' -- restore a backup (see deploy/restore-backup.sh).');
    const jf = path.join(this.dir, `journal-${this.gen}.jsonl`);
    this.journalBytes = 0;
    if (fs.existsSync(jf)) {
      let replayed = 0;
      const { good } = this._readLines(jf, line => {
        let r; try { r = parse(line); } catch (_) { return; }
        if (r.o === 'p') this._col(r.c).docs.set(r.i, r.d); else if (r.o === 'd') this._col(r.c).docs.delete(r.i);
        replayed++;
      });
      const size = fs.statSync(jf).size;
      if (good < size) { fs.truncateSync(jf, good); this.log.warn && this.log.warn(`PersonalCare database: cut a torn last line off the journal (${size - good} bytes)`); }
      this.journalBytes = good;
      if (replayed) this.log.log && this.log.log(`PersonalCare database: replayed ${replayed} journal change(s)`);
    }
    this.fd = fs.openSync(jf, 'a');
  }

  // ── writing ──
  _put(c, id, doc) {
    const col = this._col(c); const old = col.docs.get(id);
    this._checkUnique(col, c, id, doc);
    if (old) for (const ix of col.indexes) ix.remove(id, old);
    col.docs.set(id, doc);
    for (const ix of col.indexes) ix.add(id, doc);
    this._log({ o: 'p', c, i: id, d: doc });
  }
  _del(c, id) {
    const col = this._col(c); const old = col.docs.get(id);
    if (!old) return;
    for (const ix of col.indexes) ix.remove(id, old);
    col.docs.delete(id);
    this._log({ o: 'd', c, i: id });
  }
  _checkUnique(col, c, id, doc) {
    for (const ix of col.indexes) {
      if (!ix.unique) continue;
      const k = ix.uniqueKey(doc); if (k === undefined) continue;
      const owner = ix.uniq.get(k);
      if (owner !== undefined && owner !== id) throw new DuplicateKeyError(`E11000 duplicate key error collection: ${c} index: ${ix.name} dup key: ${k}`);
    }
  }
  _log(rec) {
    if (this.broken) throw this.broken;
    this.buf.push(ser(rec) + '\n');
  }
  _commit() {
    if (this.broken) return Promise.reject(this.broken);
    if (!this.buf.length) return Promise.resolve();
    return new Promise((res, rej) => {
      this.waiters.push([res, rej]);
      if (!this.flushing) { this.flushing = true; setImmediate(() => this._flush()); }
    });
  }
  async _flush() {
    try {
      while (this.buf.length) {
        const data = Buffer.from(this.buf.join('')); const ws = this.waiters; this.buf = []; this.waiters = [];
        try {
          await new Promise((res, rej) => { let off = 0; const fd = this.fd;
            const step = () => fs.write(fd, data, off, data.length - off, null, (e, n) => { if (e) return rej(e); off += n; if (off < data.length) return step(); if (this.syncMode === 'fast') { this._syncSoon(); return res(); } fs.fsync(fd, er => er ? rej(er) : res()); });
            step(); });
          this.journalBytes += data.length;
          for (const w of ws) w[0]();
        } catch (e) {
          this.broken = new Error('PersonalCare database: could not write to disk (' + e.message + '). The server must be restarted after the disk problem is fixed.');
          this.log.error && this.log.error(this.broken.message);
          for (const w of ws) w[1](this.broken);
        }
      }
    } finally { this.flushing = false; }
  }
  _syncSoon() {
    if (this.syncing) { this.syncAgain = true; return; }
    this.syncing = true;
    const fd = this.fd;
    fs.fsync(fd, er => {
      this.syncing = false;
      if (er && !this.closed && this.fd === fd) { this.broken = new Error('PersonalCare database: could not write to disk (' + er.message + '). The server must be restarted after the disk problem is fixed.'); this.log.error && this.log.error(this.broken.message); return; }
      if (this.syncAgain && !this.closed && this.fd !== null) { this.syncAgain = false; this._syncSoon(); } else this.syncAgain = false;
    });
  }
  // After a failed flush nothing more is acknowledged.
  isHealthy() { return !this.broken && !this.closed; }

  // ── indexes ──
  _createIndex(c, keys, opts) {
    const fields = Object.entries(keys);
    const col = this._col(c);
    const name = opts.name || fields.map(([f, d]) => f + '_' + d).join('_');
    if (col.indexes.some(ix => ix.name === name)) return name;
    if (opts.expireAfterSeconds != null) { if (fields.length !== 1) throw new Error('A TTL index needs exactly one field'); col.ttl = { field: fields[0][0], secs: Number(opts.expireAfterSeconds) }; }
    const ix = new Index({ keys: fields, unique: opts.unique, partial: opts.partialFilterExpression, name });
    for (const [id, d] of col.docs) {
      if (ix.unique) { const u = ix.uniqueKey(d); if (u !== undefined && ix.uniq.has(u)) throw new DuplicateKeyError(`E11000 duplicate key error building index ${name} on ${c}: ${u}`); }
      ix.add(id, d);
    }
    col.indexes.push(ix);
    if (fields.length > 1 && !col.indexes.some(x => x.fields.length === 1 && x.fields[0] === fields[0][0] && !x.partial)) this._createIndex(c, { [fields[0][0]]: fields[0][1] }, {});
    return name;
  }

  // ── compaction (journal -> snapshot) ──
  compact() {
    if (this.broken) throw this.broken;
    if (this.flushing) throw new Error('compact() while a write is in flight; use compactWhenIdle()');
    const next = this.gen + 1;
    const snapTmp = path.join(this.dir, `snapshot-${next}.jsonl.tmp`);
    const fd = fs.openSync(snapTmp, 'w');
    let n = 0, parts = [], size = 0;
    const flushParts = () => { if (parts.length) { writeAllSync(fd, Buffer.from(parts.join(''))); parts = []; size = 0; } };
    try {
      writeAllSync(fd, Buffer.from(ser({ snapshot: true, gen: next, at: Date.now() }) + '\n'));
      for (const [c, col] of this.cols) for (const d of col.docs.values()) {
        const line = ser({ c, d }) + '\n'; parts.push(line); size += line.length; n++;
        if (size > 4 * 1024 * 1024) flushParts();
      }
      parts.push(ser({ end: true, n }) + '\n'); flushParts();
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    const snapFinal = path.join(this.dir, `snapshot-${next}.jsonl`);
    fs.renameSync(snapTmp, snapFinal);
    const newJournal = path.join(this.dir, `journal-${next}.jsonl`);
    const nfd = fs.openSync(newJournal, 'a'); fs.fsyncSync(nfd);
    try { const dfd = fs.openSync(this.dir, 'r'); fs.fsyncSync(dfd); fs.closeSync(dfd); } catch (_) {}
    const oldFd = this.fd, oldGen = this.gen;
    this.fd = nfd; this.gen = next; this.journalBytes = 0;
    // Everything buffered is already inside the snapshot, which is now durable.
    const ws = this.waiters; this.buf = []; this.waiters = [];
    for (const w of ws) w[0]();
    if (oldFd !== null) { try { fs.closeSync(oldFd); } catch (_) {} }
    for (const f of [`snapshot-${oldGen}.jsonl`, `journal-${oldGen}.jsonl`]) { try { fs.unlinkSync(path.join(this.dir, f)); } catch (_) {} }
    return { gen: next, docs: n };
  }

  compactWhenIdle() {
    return new Promise((res, rej) => { const go = () => { if (this.flushing) return setImmediate(go); try { res(this.compact()); } catch (e) { rej(e); } }; go(); });
  }

  // ── backups ──
  async backup(destDir) {
    const dir = destDir || this.backupDir; fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    const raw = path.join(dir, `backup-${stamp}.jsonl.tmp`), out = path.join(dir, `backup-${stamp}.jsonl.gz`);
    // The copy is taken in one synchronous pass, so it is one consistent moment.
    const fd = fs.openSync(raw, 'w'); let parts = [], size = 0, n = 0;
    const fl = () => { if (parts.length) { writeAllSync(fd, Buffer.from(parts.join(''))); parts = []; size = 0; } };
    try {
      for (const [c, col] of this.cols) for (const d of col.docs.values()) { const l = ser({ c, d }) + '\n'; parts.push(l); size += l.length; n++; if (size > 4 * 1024 * 1024) fl(); }
      parts.push(ser({ end: true, n }) + '\n'); fl();
    } finally { fs.closeSync(fd); }
    await new Promise((res, rej) => {
      const gz = zlib.createGzip({ level: 6 }); const o = fs.createWriteStream(out);
      fs.createReadStream(raw).pipe(gz).pipe(o); o.on('finish', res); o.on('error', rej); gz.on('error', rej);
    });
    fs.unlinkSync(raw);
    const all = fs.readdirSync(dir).filter(f => /^backup-.*\.jsonl\.gz$/.test(f)).sort();
    for (const f of all.slice(0, Math.max(0, all.length - this.keep))) { try { fs.unlinkSync(path.join(dir, f)); } catch (_) {} }
    return { file: out, docs: n };
  }
  static restoreFromBackup(backupFile, dir) {
    // Rebuilds a data folder from a backup file: a new snapshot generation, an empty journal. The folder must not be in use.
    fs.mkdirSync(dir, { recursive: true });
    const lock = path.join(dir, 'LOCK');
    if (fs.existsSync(lock)) { let pid = 0; try { pid = parseInt(fs.readFileSync(lock, 'utf8'), 10); } catch (_) {} let alive = false; if (pid) { try { process.kill(pid, 0); alive = true; } catch (_) {} } if (alive) throw new Error('The server is running (pid ' + pid + '). Stop it first.'); }
    const text = zlib.gunzipSync(fs.readFileSync(backupFile)).toString('utf8').split('\n').filter(Boolean);
    const last = parse(text[text.length - 1]);
    if (!last.end || last.n !== text.length - 1) throw new Error('This backup file is incomplete.');
    const existing = fs.readdirSync(dir).map(f => /^(?:snapshot|journal)-(\d+)\.jsonl/.exec(f)).filter(Boolean).map(m => +m[1]);
    const gen = (existing.length ? Math.max(...existing) : 0) + 1;
    const snap = path.join(dir, `snapshot-${gen}.jsonl`);
    fs.writeFileSync(snap + '.tmp', ser({ snapshot: true, gen, at: Date.now() }) + '\n' + text.join('\n') + '\n');
    const fd = fs.openSync(snap + '.tmp', 'r'); fs.fsyncSync(fd); fs.closeSync(fd);
    fs.renameSync(snap + '.tmp', snap); fs.writeFileSync(path.join(dir, `journal-${gen}.jsonl`), '');
    return { gen, docs: last.n };
  }

  // ── housekeeping ──
  // Documents whose TTL field (a Date) is older than the index's expireAfterSeconds are deleted, like MongoDB's own TTL monitor does.
  sweepExpired(now = Date.now()) {
    let n = 0;
    for (const [c, col] of this.cols) {
      if (!col.ttl) continue;
      const cutoff = now - col.ttl.secs * 1000;
      for (const [id, d] of col.docs) { const v = getOne(d, col.ttl.field); if (v instanceof Date && v.getTime() <= cutoff) { this._del(c, id); n++; } }
    }
    if (n) this._commit().catch(() => {});
    return n;
  }
  _schedule() {
    const tt = setInterval(() => { if (!this.closed && !this.broken) { try { this.sweepExpired(); } catch (e) { this.log.error && this.log.error('Expiry sweep failed: ' + e.message); } } }, 60 * 1000);
    tt.unref && tt.unref(); this.timers.push(tt);
    // Every minute: fold a big journal. Every night at 03:30 (server time): fold it and take a dated backup.
    const t1 = setInterval(() => { if (!this.closed && !this.broken && !this.flushing && this.journalBytes > this.compactBytes) { try { this.compact(); } catch (e) { this.log.error && this.log.error('Compaction failed: ' + e.message); } } }, 60 * 1000);
    t1.unref && t1.unref(); this.timers.push(t1);
    const nightly = () => {
      const now = new Date(), at = new Date(now); at.setHours(3, 30, 0, 0); if (at <= now) at.setDate(at.getDate() + 1);
      const t = setTimeout(async () => {
        try { if (!this.broken) { await this.compactWhenIdle(); await this.backup(); this.log.log && this.log.log('PersonalCare database: nightly compaction and backup done'); } }
        catch (e) { this.log.error && this.log.error('Nightly backup failed: ' + e.message); }
        if (!this.closed) nightly();
      }, at - now);
      t.unref && t.unref(); this.timers.push(t);
    };
    nightly();
  }
  async close() {
    if (this.closed) return;
    // Let writes that are already queued reach the disk, then stop.
    while (this.flushing || this.buf.length) { await new Promise(r => setTimeout(r, 5)); if (this.buf.length && !this.flushing) { this.flushing = true; this._flush(); } }
    this.closed = true;
    for (const t of this.timers) { clearInterval(t); clearTimeout(t); }
    if (this.fd !== null) { try { fs.fsyncSync(this.fd); fs.closeSync(this.fd); } catch (_) {} this.fd = null; }
    if (this._ownsLock) { try { fs.unlinkSync(this.lockPath); } catch (_) {} }
  }
  stats() { let docs = 0; const per = {}; for (const [c, col] of this.cols) { per[c] = col.docs.size; docs += col.docs.size; } return { docs, collections: per, journalBytes: this.journalBytes, gen: this.gen }; }
  async command(cmd) { if (cmd && cmd.ping) { if (!this.isHealthy()) throw this.broken || new Error('closed'); return { ok: 1 }; } throw new Error('Unsupported command'); }
}

function openStore(opts) { return new LocalStore(opts).open(); }
module.exports = { LocalStore, openStore, DuplicateKeyError, compileFilter, applyUpdate };
