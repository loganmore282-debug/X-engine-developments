/* In-memory Firestore-compat mock used by test-liveness.js.
   Implements exactly the subset of db.js that server.js uses, so the whole
   server can run against it with no MongoDB — letting the liveness suite
   exercise every real endpoint, lock and transaction path. */

const OP = Symbol.for('fg.op');
const store = new Map();            // collection name -> Map(id -> plain object)
let _idc = 0;
const genId = () => 'doc' + (++_idc).toString(36).padStart(6, '0');

const coll = name => {
  if (!store.has(name)) store.set(name, new Map());
  return store.get(name);
};
// A naive JSON.stringify(v, replacer)/JSON.parse(json, reviver) round-trip
// can't preserve Date fields the way it looks like it should: Date has its
// own .toJSON() (returns an ISO string), and JSON.stringify calls THAT
// before the replacer ever sees the value — so `val instanceof Date` inside
// the replacer is always false, and every Date field silently becomes a
// plain string. That's invisible for code that only reads amounts/status,
// but it broke settle-on-read date math (tsMillis() doesn't parse a plain
// string) as soon anything needed to manipulate/re-read a timestamp field
// through .data(). Walk the object manually instead of relying on
// JSON.stringify's replacer for this.
function clone(v) {
  if (v instanceof Date) return new Date(v.getTime());
  if (Array.isArray(v)) return v.map(clone);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v)) out[k] = clone(v[k]);
    return out;
  }
  return v;
}

function applyPatch(target, patch) {
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === 'object' && v[OP] === 'inc') target[k] = (Number(target[k]) || 0) + v.n;
    else if (v && typeof v === 'object' && v[OP] === 'ts') target[k] = new Date();
    else if (v && typeof v === 'object' && v[OP] === 'union') {
      const arr = Array.isArray(target[k]) ? target[k] : [];
      for (const item of v.vs) if (!arr.some(x => JSON.stringify(x) === JSON.stringify(item))) arr.push(item);
      target[k] = arr;
    } else if (v && typeof v === 'object' && v[OP] === 'del') delete target[k];
    else target[k] = clone(v);
  }
}

// Test-only hook (mirrors global.__marzSendFail elsewhere): put a collection
// name in this Set to make its NEXT .get() throw once, simulating a transient
// Mongo hiccup (cold-start, dropped connection) rather than a real "not
// found" — the two must be handled differently by server.js.
global.__mockDbFailOnce = new Set();

function docRef(cname, id) {
  const ref = {
    id,
    async get() {
      if (global.__mockDbFailOnce.has(cname)) {
        global.__mockDbFailOnce.delete(cname);
        throw new Error('Simulated transient DB error');
      }
      const raw = coll(cname).get(id);
      return snap(cname, id, raw);
    },
    async set(data, opts) {
      const existing = coll(cname).get(id);
      const base = (opts && opts.merge && existing) ? existing : {};
      const next = (opts && opts.merge && existing) ? existing : base;
      applyPatch(next, data);
      coll(cname).set(id, next);
    },
    async update(data) {
      const existing = coll(cname).get(id);
      if (!existing) throw new Error(`No document to update: ${cname}/${id}`);
      applyPatch(existing, data);
    },
    async delete() { coll(cname).delete(id); },
  };
  return ref;
}

function snap(cname, id, raw) {
  return {
    id,
    exists: raw !== undefined,
    ref: docRef(cname, id),
    data: () => raw === undefined ? undefined : clone(raw),
  };
}

function query(cname, filters = [], order = null, lim = 0) {
  return {
    where(f, op, v) {
      if (op !== '==' && op !== 'in') throw new Error('mockdb: only == and in supported');
      return query(cname, [...filters, [f, op, v]], order, lim);
    },
    orderBy(f, dir) { return query(cname, filters, [f, dir || 'asc'], lim); },
    limit(n) { return query(cname, filters, order, n); },
    select() { return query(cname, filters, order, lim); }, // projection: no-op in mock
    async get() {
      // '_id' isn't a field inside the stored data object here (the Map key IS
      // the id) — real Mongo docs DO carry a genuine _id field (see db.js's
      // set()), so this matches against the entry key to stay faithful to that.
      let rows = [...coll(cname).entries()]
        .filter(([id, d]) => filters.every(([f, op, v]) => {
          const actual = f === '_id' ? id : d[f];
          if (op === 'in') return Array.isArray(v) && v.some(x => actual === x || String(actual) === String(x));
          return actual === v || String(actual) === String(v);
        }));
      if (order) {
        const [f, dir] = order;
        const ms = x => x instanceof Date ? x.getTime() : (typeof x === 'number' ? x : new Date(x).getTime() || 0);
        rows.sort((a, b) => (ms(a[1][f]) - ms(b[1][f])) * (dir === 'desc' ? -1 : 1));
      }
      if (lim) rows = rows.slice(0, lim);
      const docs = rows.map(([id, d]) => snap(cname, id, d));
      return { empty: docs.length === 0, size: docs.length, docs, forEach: cb => docs.forEach(cb) };
    },
  };
}

const db = {
  collection(name) {
    const q = query(name);
    return {
      doc: id => docRef(name, id || genId()),
      async add(data) { const r = docRef(name, genId()); await r.set(data); return r; },
      where: q.where, orderBy: q.orderBy, limit: q.limit, get: q.get, select: q.select,
    };
  },
  async runTransaction(fn) {
    // Single-process test: apply reads/writes immediately (server code always
    // re-checks fresh state inside the txn, which is what we want to exercise).
    const t = {
      get: ref => ref.get(),
      set: (ref, d, o) => ref.set(d, o),
      update: (ref, d) => ref.update(d),
    };
    return fn(t);
  },
  batch() {
    const ops = [];
    return {
      set: (ref, d, o) => ops.push(() => ref.set(d, o)),
      update: (ref, d) => ops.push(() => ref.update(d)),
      delete: ref => ops.push(() => ref.delete()),
      async commit() { for (const op of ops) await op(); },
    };
  },
};

const FieldValue = {
  increment: n => ({ [OP]: 'inc', n }),
  serverTimestamp: () => ({ [OP]: 'ts' }),
  arrayUnion: (...vs) => ({ [OP]: 'union', vs }),
  delete: () => ({ [OP]: 'del' }),
};

module.exports = {
  db, FieldValue,
  connectMongo: async () => {},
  pingDb: async () => true,
  __store: store,                          // test hook: direct state access/manipulation
  __mockDbFailOnce: global.__mockDbFailOnce, // test hook: force the next .get() on a collection to throw once
};
