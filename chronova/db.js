'use strict';
// MongoDB ↔ Firestore compatibility layer
// Wraps the MongoDB native driver in a Firestore-like API so server.js needs
// minimal changes. Collections use `_id` as the document ID (string, not ObjectId).
//
// NOTE: MongoDB Atlas M0 free tier does not support multi-document ACID transactions.
// runTransaction() runs operations sequentially; financial dedup flags in the business
// logic already guard against double-credits on failure.

const { MongoClient } = require('mongodb');

let _client = null;
let _mdb    = null;

async function connectMongo(uri) {
  _client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 10000, // give up finding a server after 10s
    connectTimeoutMS:         15000,
    socketTimeoutMS:          45000, // don't let a slow query hang a socket forever
    maxPoolSize:              50,    // cap connections so one instance can't exhaust M0
    minPoolSize:              0,
    retryReads:               true,  // auto-retry reads through a transient blip
    retryWrites:              true,  // auto-retry writes through a transient blip
    waitQueueTimeoutMS:       10000
  });
  await _client.connect();
  const dbName = new URL(uri).pathname.slice(1) || 'chronova';
  _mdb = _client.db(dbName);
  // Surface pool/topology problems in the logs instead of failing silently.
  _client.on('serverHeartbeatFailed', e => console.warn('Mongo heartbeat failed:', e && e.failure && e.failure.message));
  _client.on('close', () => console.warn('Mongo connection closed'));
  console.log(`MongoDB connected (${dbName})`);
  ensureIndexes().catch(e => console.warn('Index build warning:', e.message));
  return _mdb;
}

// Every field server.js filters on via .where() needs an index here — without
// one, MongoDB does a full collection scan on every single request for it
// (userId, referredBy, status, marzReference...), and that scan gets slower
// as each collection grows. createIndex is a cheap no-op if the index already
// exists, so this just runs on every boot instead of needing a one-time
// migration step. Fired in the background (not awaited by connectMongo) so a
// slow first-time build on an already-large collection never delays startup —
// queries run at their old (scan) speed until it finishes, then stay fast.
async function ensureIndexes() {
  const specs = [
    ['users',           { referredBy: 1 }],
    ['users',           { referralCode: 1 }],
    ['users',           { usernameLower: 1 }],
    ['investments',     { userId: 1 }],
    ['investments',     { status: 1 }],
    ['transactions',    { userId: 1 }],
    ['transactions',    { withdrawalId: 1 }],
    ['transactions',    { code: 1 }],
    ['withdrawals',     { userId: 1 }],
    ['withdrawals',     { status: 1 }],
    ['withdrawals',     { marzReference: 1 }],
    ['withdrawals',     { marzTxUuid: 1 }],
    ['pendingDeposits', { userId: 1 }],
    ['pendingDeposits', { marzReference: 1 }],
    ['pendingDeposits', { status: 1 }],
    ['pendingDeposits', { userId: 1, manualPending: 1 }],
    ['redemptionCodes', { code: 1 }],
    ['redemptionCodes', { codeKey: 1 }],
    ['adminPushTokens', { token: 1 }],
    ['adminSessions',   { username: 1 }],
    ['captchas',        { expires: 1 }],
    ['products',        { key: 1 }],
  ];
  // ONE AT A TIME — M0's free tier has very little real concurrency headroom.
  // Firing all of these at once (Promise.all/allSettled) queued ~22 simultaneous
  // operations against the same small connection pool at the exact moment the
  // rest of server startup (recount migration, rate patches, crons) was ALSO
  // opening connections — that combination exhausted the pool and produced
  // cascading "Timed out while checking out a connection" errors across
  // completely unrelated requests (login, registration, reconcilers) for the
  // first several seconds after every single deploy. Sequential keeps peak
  // concurrent demand from this function at 1, at the cost of a few more
  // seconds before every index is confirmed built — a trade very worth making
  // since nothing blocks on this finishing (it's fire-and-forget from connectMongo).
  let failed = 0;
  for (const [col, keys] of specs) {
    try { await _mdb.collection(col).createIndex(keys); }
    catch (e) { failed++; console.warn(`Index build failed (${col} ${JSON.stringify(keys)}):`, e.message); }
  }
  console.log(`MongoDB indexes ensured (${specs.length - failed}/${specs.length})`);
}

// Lightweight liveness check for the /health endpoint — pings the DB with a
// short deadline so monitoring can see an outage before users do.
async function pingDb() {
  try {
    await _mdb.command({ ping: 1 }, { maxTimeMS: 4000 });
    return true;
  } catch (_) { return false; }
}

// ── FieldValue replacements ──────────────────────────────────────────────────
const FieldValue = {
  increment:        (n)         => ({ __fv: 'inc',       n }),
  serverTimestamp:  ()          => ({ __fv: 'ts' }),
  arrayUnion:       (...items)  => ({ __fv: 'union',     items }),
  arrayRemove:      (...items)  => ({ __fv: 'remove',    items }),
  delete:           ()          => ({ __fv: 'del' }),
};

// ── Timestamp compat (just a Date wrapper) ───────────────────────────────────
const Timestamp = {
  fromDate: (d) => d,
  now:      ()  => new Date(),
};

// ── Convert FieldValue-decorated update object → MongoDB $operators ──────────
function buildMongoUpdate(updates) {
  const $set = {}, $inc = {}, $unset = {}, $addToSet = {}, $pull = {};
  for (const [k, v] of Object.entries(updates)) {
    if (v && typeof v === 'object' && v.__fv) {
      if      (v.__fv === 'inc')    $inc[k]     = v.n;
      else if (v.__fv === 'ts')     $set[k]     = new Date();
      else if (v.__fv === 'union')  $addToSet[k] = v.items.length === 1 ? v.items[0] : { $each: v.items };
      else if (v.__fv === 'remove') $pull[k]    = v.items.length === 1 ? v.items[0] : { $in: v.items };
      else if (v.__fv === 'del')    $unset[k]   = '';
    } else {
      $set[k] = v;
    }
  }
  const op = {};
  if (Object.keys($set).length)     op.$set     = $set;
  if (Object.keys($inc).length)     op.$inc     = $inc;
  if (Object.keys($unset).length)   op.$unset   = $unset;
  if (Object.keys($addToSet).length) op.$addToSet = $addToSet;
  if (Object.keys($pull).length)    op.$pull    = $pull;
  return op;
}

// Merge FieldValue-decorated set data into upsert operators
function buildMergeUpdate(data) {
  return buildMongoUpdate(data);
}

// ── Attach .toDate() / .toMillis() / .seconds to Date objects returned from Mongo ──
function stampDate(d) {
  if (!(d instanceof Date)) return d;
  if (!d.toDate)   d.toDate   = () => d;
  if (!d.toMillis) d.toMillis = () => d.getTime();
  if (d.seconds === undefined) d.seconds = Math.floor(d.getTime() / 1000);
  return d;
}
function deepStamp(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (obj instanceof Date) return stampDate(obj);
  for (const k of Object.keys(obj)) {
    if (obj[k] instanceof Date) { stampDate(obj[k]); }
    else if (obj[k] && typeof obj[k] === 'object' && !Array.isArray(obj[k])) deepStamp(obj[k]);
  }
  return obj;
}

// ── DocumentSnapshot ─────────────────────────────────────────────────────────
class DocumentSnapshot {
  constructor(mongoDoc, colName) {
    this._col    = colName;
    this.exists  = !!mongoDoc;
    this.id      = mongoDoc ? String(mongoDoc._id) : null;
    this._raw    = mongoDoc ? deepStamp({ ...mongoDoc }) : null;
    this.ref     = new DocumentReference(colName, this.id);
  }
  data() {
    if (!this._raw) return null;
    const d = { ...this._raw };
    delete d._id;
    return d;
  }
}

// ── QuerySnapshot ────────────────────────────────────────────────────────────
class QuerySnapshot {
  constructor(mongoDocs, colName) {
    this.docs  = mongoDocs.map(d => new DocumentSnapshot(d, colName));
    this.empty = this.docs.length === 0;
    this.size  = this.docs.length;
  }
  forEach(fn) { this.docs.forEach(fn); }
}

// ── DocumentReference ────────────────────────────────────────────────────────
class DocumentReference {
  constructor(colName, id) {
    this._col = colName;
    this.id   = id || require('crypto').randomUUID();
  }
  async get() {
    const doc = await _mdb.collection(this._col).findOne({ _id: this.id });
    return new DocumentSnapshot(doc, this._col);
  }
  async set(data, opts = {}) {
    const docData = flattenFieldValues(data);
    if (opts.merge) {
      const op = buildMergeUpdate(docData);
      if (!Object.keys(op).length) return;
      await _mdb.collection(this._col).updateOne({ _id: this.id }, op, { upsert: true });
    } else {
      const plain = resolveFieldValues(data);
      await _mdb.collection(this._col).replaceOne({ _id: this.id }, { ...plain, _id: this.id }, { upsert: true });
    }
  }
  async update(updates) {
    const op = buildMongoUpdate(updates);
    if (!Object.keys(op).length) return;
    await _mdb.collection(this._col).updateOne({ _id: this.id }, op);
  }
  async delete() {
    await _mdb.collection(this._col).deleteOne({ _id: this.id });
  }
}

// Resolve FieldValue sentinels in a plain set() call (no $set wrapping)
function resolveFieldValues(data) {
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === 'object' && v.__fv) {
      if      (v.__fv === 'ts')    out[k] = new Date();
      else if (v.__fv === 'inc')   out[k] = v.n;   // fresh doc — treat as initial value
      else if (v.__fv === 'del')   {}               // omit the field
      else                         out[k] = undefined;
    } else {
      out[k] = v;
    }
  }
  return out;
}
// Alias — flattens nested FieldValues for merge path
function flattenFieldValues(data) { return data; }

// ── CollectionReference / Query ──────────────────────────────────────────────
class Query {
  constructor(colName) {
    this._col    = colName;
    this._filter = {};
    this._sort   = null;
    this._lim    = 0;
    this._proj   = null;
  }
  _clone() {
    const q      = new Query(this._col);
    q._filter    = { ...this._filter };
    q._sort      = this._sort ? { ...this._sort } : null;
    q._lim       = this._lim;
    q._proj      = this._proj;
    return q;
  }
  where(field, op, value) {
    const q = this._clone();
    if      (op === '==')              q._filter[field] = value;
    else if (op === '!=')              q._filter[field] = { $ne: value };
    else if (op === '>=')              q._filter[field] = { ...(q._filter[field] || {}), $gte: value };
    else if (op === '>')               q._filter[field] = { ...(q._filter[field] || {}), $gt:  value };
    else if (op === '<=')              q._filter[field] = { ...(q._filter[field] || {}), $lte: value };
    else if (op === '<')               q._filter[field] = { ...(q._filter[field] || {}), $lt:  value };
    else if (op === 'in')              q._filter[field] = { $in: value };
    else if (op === 'not-in')          q._filter[field] = { $nin: value };
    else if (op === 'array-contains')  q._filter[field] = value;
    return q;
  }
  orderBy(field, direction = 'asc') {
    const q = this._clone();
    q._sort = { ...(q._sort || {}), [field]: direction === 'desc' ? -1 : 1 };
    return q;
  }
  limit(n) {
    const q = this._clone();
    q._lim = n;
    return q;
  }
  select(...fields) {
    const q = this._clone();
    q._proj = fields.reduce((a, f) => ({ ...a, [f]: 1 }), { _id: 1 });
    return q;
  }
  async get() {
    let cursor = _mdb.collection(this._col).find(this._filter);
    if (this._sort)  cursor = cursor.sort(this._sort);
    if (this._lim)   cursor = cursor.limit(this._lim);
    if (this._proj)  cursor = cursor.project(this._proj);
    const docs = await cursor.toArray();
    return new QuerySnapshot(docs, this._col);
  }
}

class CollectionReference extends Query {
  constructor(colName) { super(colName); }
  doc(id) {
    return new DocumentReference(this._col, id || require('crypto').randomUUID());
  }
  async add(data) {
    const id   = require('crypto').randomUUID();
    const plain = resolveFieldValues(data);
    await _mdb.collection(this._col).insertOne({ ...plain, _id: id });
    return new DocumentReference(this._col, id);
  }
}

// ── Transaction proxy (sequential — M0 free tier doesn't support sessions) ───
class Transaction {
  constructor() { this._ops = []; }

  get(ref) {
    // Immediate read — returns a Promise<DocumentSnapshot>
    return ref.get();
  }

  set(ref, data, opts = {}) {
    this._ops.push({ type: 'set', ref, data, opts });
  }

  update(ref, updates) {
    this._ops.push({ type: 'update', ref, updates });
  }

  create(ref, data) {
    this._ops.push({ type: 'create', ref, data });
  }

  delete(ref) {
    this._ops.push({ type: 'delete', ref });
  }

  async _commit() {
    for (const op of this._ops) {
      if      (op.type === 'set')    await op.ref.set(op.data, op.opts);
      else if (op.type === 'update') await op.ref.update(op.updates);
      else if (op.type === 'create') await op.ref.set(op.data);
      else if (op.type === 'delete') await op.ref.delete();
    }
  }
}

// ── WriteBatch proxy ─────────────────────────────────────────────────────────
class WriteBatch {
  constructor() { this._ops = []; }
  set(ref, data, opts = {})  { this._ops.push({ type: 'set',    ref, data, opts }); return this; }
  update(ref, updates)       { this._ops.push({ type: 'update', ref, updates });    return this; }
  delete(ref)                { this._ops.push({ type: 'delete', ref });             return this; }
  async commit() {
    for (const op of this._ops) {
      if      (op.type === 'set')    await op.ref.set(op.data, op.opts);
      else if (op.type === 'update') await op.ref.update(op.updates);
      else if (op.type === 'delete') await op.ref.delete();
    }
  }
}

// ── Main db object (Firestore-compatible API) ────────────────────────────────
const db = {
  collection: (name) => new CollectionReference(name),
  batch:      ()     => new WriteBatch(),
  runTransaction: async (fn) => {
    const t = new Transaction();
    const result = await fn(t);
    await t._commit();
    return result;
  },
};

module.exports = { connectMongo, db, FieldValue, Timestamp, pingDb };
