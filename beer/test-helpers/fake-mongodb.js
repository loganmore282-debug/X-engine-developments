'use strict';
// A small in-memory stand-in for the parts of the `mongodb` driver that db.js uses, so the REAL server.js can run end to end in a test
// (test-e2e.js) without a database. Supports exactly what db.js sends: equality, $ne/$gt/$gte/$lt/$lte/$in/$nin, $set/$inc/$unset/$addToSet/$pull,
// upserts, sort/limit/project.
const clone = v => v instanceof Date ? new Date(v) : (v && typeof v === 'object') ? (Array.isArray(v) ? v.map(clone) : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)]))) : v;
const getp = (o, p) => p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
const setp = (o, p, v) => { const ks = p.split('.'); let a = o; for (let i = 0; i < ks.length - 1; i++) { if (a[ks[i]] == null || typeof a[ks[i]] !== 'object') a[ks[i]] = {}; a = a[ks[i]]; } a[ks[ks.length - 1]] = v; };
const delp = (o, p) => { const ks = p.split('.'); let a = o; for (let i = 0; i < ks.length - 1; i++) { if (a == null) return; a = a[ks[i]]; } if (a) delete a[ks[ks.length - 1]]; };
const eq = (a, b) => a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : (a === b);
const val = v => v instanceof Date ? v.getTime() : v;
function matchField(doc, field, cond) {
  const v = getp(doc, field);
  const one = c => Array.isArray(v) ? (v.some(x => eq(x, c)) || (Array.isArray(c) && JSON.stringify(v) === JSON.stringify(c))) : eq(v, c) || (v == null && c == null);
  if (cond && typeof cond === 'object' && !(cond instanceof Date) && !Array.isArray(cond) && Object.keys(cond).some(k => k.startsWith('$'))) {
    return Object.entries(cond).every(([op, c]) => {
      switch (op) {
        case '$ne': return Array.isArray(v) ? !v.some(x => eq(x, c)) : !(eq(v, c) || (v == null && c == null));
        case '$gt': return v != null && val(v) > val(c); case '$gte': return v != null && val(v) >= val(c);
        case '$lt': return v != null && val(v) < val(c); case '$lte': return v != null && val(v) <= val(c);
        case '$in': return c.some(x => Array.isArray(v) ? v.some(y => eq(y, x)) : eq(v, x));
        case '$nin': return !c.some(x => Array.isArray(v) ? v.some(y => eq(y, x)) : eq(v, x));
        case '$exists': return (v !== undefined) === !!c;
        default: throw new Error('fake mongo: unsupported operator ' + op);
      }
    });
  }
  return one(cond);
}
const matches = (doc, filter) => Object.entries(filter || {}).every(([f, c]) => matchField(doc, f, c));
function applyUpdate(doc, op) {
  for (const [k, v] of Object.entries(op.$set || {})) setp(doc, k, clone(v));
  for (const [k, v] of Object.entries(op.$inc || {})) setp(doc, k, (Number(getp(doc, k)) || 0) + v);
  for (const k of Object.keys(op.$unset || {})) delp(doc, k);
  for (const [k, v] of Object.entries(op.$addToSet || {})) { const arr = getp(doc, k) || []; const items = v && v.$each ? v.$each : [v]; for (const it of items) if (!arr.some(x => JSON.stringify(x) === JSON.stringify(it))) arr.push(clone(it)); setp(doc, k, arr); }
  for (const [k, v] of Object.entries(op.$pull || {})) { const arr = getp(doc, k) || []; const rm = v && v.$in ? v.$in : [v]; setp(doc, k, arr.filter(x => !rm.some(r => JSON.stringify(r) === JSON.stringify(x)))); }
}
class Cursor { constructor(rows) { this.rows = rows; } sort(s) { const [[k, d]] = Object.entries(s); this.rows.sort((a, b) => { const x = val(getp(a, k)), y = val(getp(b, k)); return (x > y ? 1 : x < y ? -1 : 0) * d; }); return this; } limit(n) { this.rows = this.rows.slice(0, n); return this; } project(p) { this.rows = this.rows.map(r => Object.fromEntries(Object.entries(r).filter(([k]) => p[k]))); return this; } async toArray() { return this.rows.map(clone); } }
const stores = {};
class Coll {
  constructor(n) { this.n = n; stores[n] = stores[n] || new Map(); this.s = stores[n]; }
  async findOne(f) { for (const d of this.s.values()) if (matches(d, f)) return clone(d); return null; }
  find(f) { return new Cursor([...this.s.values()].filter(d => matches(d, f))); }
  async countDocuments(f, o) { let n = 0; for (const d of this.s.values()) if (matches(d, f)) n++; return o && o.limit ? Math.min(n, o.limit) : n; }
  async insertOne(d) { if (this.s.has(d._id)) { const e = new Error('dup'); e.code = 11000; throw e; } this.s.set(d._id, clone(d)); return { insertedId: d._id }; }
  async replaceOne(f, d, o) { const id = f._id; if (this.s.has(id)) { this.s.set(id, clone(d)); return { matchedCount: 1 }; } if (o && o.upsert) { this.s.set(id, clone(d)); return { matchedCount: 0, upsertedCount: 1 }; } return { matchedCount: 0 }; }
  async updateOne(f, op, o) {
    let hit = null; for (const d of this.s.values()) if (matches(d, f)) { hit = d; break; }
    if (hit) { applyUpdate(hit, op); return { matchedCount: 1, upsertedCount: 0 }; }
    if (o && o.upsert) { const d = { _id: f._id }; if (op.$setOnInsert) Object.assign(d, clone(op.$setOnInsert)); applyUpdate(d, op); if (this.s.has(d._id)) { const e = new Error('dup'); e.code = 11000; throw e; } this.s.set(d._id, d); return { matchedCount: 0, upsertedCount: 1 }; }
    return { matchedCount: 0, upsertedCount: 0 };
  }
  async deleteOne(f) { for (const [id, d] of this.s) if (matches(d, f)) { this.s.delete(id); return { deletedCount: 1 }; } return { deletedCount: 0 }; }
  async createIndex() { return 'ok'; }
}
class MongoClient { constructor() { this.h = {}; } async connect() { return this; } on() {} db() { return { collection: n => new Coll(n), command: async () => ({ ok: 1 }) }; } async close() {} }
module.exports = { MongoClient, __stores: stores };
