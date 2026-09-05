'use strict';
// MongoDB ↔ Firestore compatibility layer
// Wraps the MongoDB native driver in a Firestore-like API so server.js needs
// minimal changes. Collections use `_id` as the document ID (string, not ObjectId).
//
// NOTE on transactions, corrected 2026-09-05 (the owner upgraded from Atlas
// M0 to a paid Flex cluster + Render's paid Pro plan, and asked whether that
// changes anything here -- it doesn't, for a reason worth being precise
// about): the earlier comment here blamed "M0 free tier" for the lack of
// real multi-document ACID transactions. That was never actually the cause.
// Transaction/WriteBatch below are hand-written to mimic Firestore's API and
// just run each queued operation sequentially with a plain loop (see their
// own class comments) -- they never call MongoDB's real session-based
// transaction API (client.startSession()/session.withTransaction()) at all.
// That's a property of THIS FILE's own implementation, not of the Atlas
// tier -- it would behave identically on M0, Flex, or a dedicated M40.
// Upgrading the cluster tier does not unlock atomic multi-document writes
// for this app; only rewriting this compat layer to use real sessions
// would. The financial dedup flags in server.js's own business logic
// already guard against double-credits regardless (claim-before-credit
// ordering, updateIf()'s atomic single-document conditionals, and the
// in-process withLock() single-writer locks around every money-crediting
// path) -- all of that stays correct and necessary no matter what tier the
// database runs on, since it's really guarding against concurrent requests
// within this one Node process, not against a missing DB feature. Not
// something to rip out or "upgrade away" just because a bigger cluster is
// now available.
const { MongoClient } = require('mongodb');

let _client = null;
let _mdb    = null;

async function connectMongo(uri) {
  _client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 10000, // give up finding a server after 10s
    connectTimeoutMS:         15000,
    socketTimeoutMS:          45000, // don't let a slow query hang a socket forever
    maxPoolSize:              50,    // generous for a single Node process regardless of cluster tier
    // Owner upgraded Render to its paid Pro plan (2026-09-05) -- this
    // process no longer spins down between requests the way a free-tier
    // service did, so it's worth keeping a couple of connections warm
    // instead of opening a fresh one from cold on every request after an
    // idle stretch. Was 0 (open nothing until actually needed) -- a
    // sensible default on a free tier that could spin down anyway, less so
    // now that the process legitimately stays up continuously.
    minPoolSize:              3,
    retryReads:               true,  // auto-retry reads through a transient blip
    retryWrites:              true,  // auto-retry writes through a transient blip
    waitQueueTimeoutMS:       10000
  });
  await _client.connect();
  const dbName = new URL(uri).pathname.slice(1) || 'snow';
  _mdb = _client.db(dbName);
  _client.on('serverHeartbeatFailed', e => console.warn('Mongo heartbeat failed:', e && e.failure && e.failure.message));
  _client.on('close', () => console.warn('Mongo connection closed'));
  console.log(`MongoDB connected (${dbName})`);
  ensureIndexes().catch(e => console.warn('Index build warning:', e.message));
  return _mdb;
}

// Every field server.js filters on via .where() needs an index here -- without
// one, MongoDB does a full collection scan on every request for it. Fired in
// the background (not awaited by connectMongo) so a slow first-time build on
// an already-large collection never delays startup.
async function ensureIndexes() {
  const specs = [
    ['users',           { referredBy: 1 }],
    ['users',           { referralCode: 1 }],
    ['users',           { referralCodeLower: 1 }],
    ['users',           { usernameLower: 1 }],
    ['investments',     { userId: 1 }],
    ['investments',     { status: 1 }],
    ['investments',     { status: 1, createdAt: 1 }],
    ['investments',     { commissionPending: 1 }],
    ['investments',     { commissionPending: 1, createdAt: 1 }],
    // Round 104 -- reconcileCommissions()'s real query filters on
    // commissionBanBlocked too (Round 80's ban-starvation fix), not covered
    // by the plain commissionPending+createdAt index above.
    ['investments',     { commissionPending: 1, commissionBanBlocked: 1, createdAt: 1 }],
    ['investments',     { userId: 1, createdAt: -1 }],
    ['transactions',    { userId: 1 }],
    ['transactions',    { withdrawalId: 1 }],
    // Round 106 -- markDepositFailed()/creditDeposit() both look up the
    // up-front "Processing" ledger row by depositId on EVERY deposit
    // resolution (success or failure) -- transactions is the busiest,
    // fastest-growing, unbounded collection in the schema, so this was a
    // full COLLSCAN on the hot money-crediting path.
    ['transactions',    { depositId: 1 }],
    ['transactions',    { marzReference: 1 }],
    ['transactions',    { ref: 1 }],
    ['transactions',    { userId: 1, createdAt: -1 }],
    ['withdrawals',     { userId: 1 }],
    ['withdrawals',     { status: 1 }],
    ['withdrawals',     { marzReference: 1 }],
    ['withdrawals',     { marzTxUuid: 1 }],
    ['withdrawals',     { lipaOutTradeNo: 1 }], // Round 102 -- LipaPay's own OutTradeNo lookup, mirrors marzTxUuid/marzReference above
    ['withdrawals',     { ref: 1 }],
    ['withdrawals',     { userId: 1, createdAt: -1 }],
    ['withdrawals',     { status: 1, createdAt: 1 }],
    // Round 106 -- reconcilePendingWithdrawals()'s real query shape (status
    // + marzTxUuid/lipaOutTradeNo + createdAt), mirroring the exact compound
    // indexes pendingDeposits already got in Round 104 for the identical
    // starvation-avoidance fix on the deposit side.
    ['withdrawals',     { status: 1, marzTxUuid: 1, createdAt: 1 }],
    ['withdrawals',     { status: 1, lipaOutTradeNo: 1, createdAt: 1 }],
    ['pendingDeposits', { userId: 1 }],
    ['pendingDeposits', { marzReference: 1 }],
    ['pendingDeposits', { status: 1 }],
    ['pendingDeposits', { provider: 1, status: 1, createdAt: 1 }], // Round 102 -- reconcilePendingDeposits()'s LipaPay sweep
    ['pendingDeposits', { ref: 1 }],
    ['pendingDeposits', { userId: 1, createdAt: -1 }],
    ['pendingDeposits', { status: 1, createdAt: 1 }],
    ['pendingDeposits', { needsManualCredit: 1 }],
    // Round 104 -- reconcilePendingDeposits()'s actual MarzPay query shape
    // (status in [...], marzTxUuid>'', orderBy createdAt) and its LipaPay
    // sibling (status in [...], provider=='lipapay', lipaTransactionId>'',
    // orderBy createdAt) -- neither was fully covered by the specs above.
    ['pendingDeposits', { status: 1, marzTxUuid: 1, createdAt: 1 }],
    ['pendingDeposits', { provider: 1, status: 1, lipaTransactionId: 1, createdAt: 1 }],
    ['withdrawals',     { refundPending: 1 }],
    ['products',        { key: 1 }],
    ['bankAccounts',    { userId: 1 }],
    ['adminSessions',   { username: 1 }],
    ['adminAuditLog',   { createdAt: -1 }],
    ['adminUsers',      { role: 1 }],
    ['adminPushTokens', { role: 1 }],
    ['promoCodes',      { code: 1 }],
    ['promoCodes',      { codeLower: 1 }],
    ['promoCodes',      { createdAt: -1 }],
    ['promoRedemptions',{ userId: 1 }],
    ['securityEvents',  { userId: 1 }],
    ['securityEvents',  { createdAt: -1 }],
    ['users',           { publicId: 1 }],
    ['transactions',    { type: 1 }],
    // Manual deposits (admin-managed MTN/Airtel numbers, SMS-matched) --
    // pendingDeposits already has method-agnostic indexes above; this one
    // is specific to assignManualNumber()'s own collision-check query.
    ['pendingDeposits', { method: 1, assignedNumber: 1, amount: 1, status: 1 }],
    ['manualPaymentNumbers', { network: 1, active: 1, order: 1 }],
    // Per-number activity tracking (owner: "l can track every number").
    ['manualPaymentNumbers', { number: 1 }],
    ['manualNumberDaily', { number: 1, day: 1 }],
    ['manualNumberDaily', { day: 1 }],
    // Owner: "server should have a review list" for genuine money that
    // arrived with nowhere to go -- unmatched, unknown-number and unparsed
    // SMS. Queried by recency in the admin panel.
    ['manualSmsLog', { createdAt: -1 }],
    // Round 106 -- unresolvedManualSmsLog()'s real query shape after the
    // matched/resolved exclusion was pushed into the query itself.
    ['manualSmsLog', { matched: 1, resolved: 1, createdAt: -1 }],
  ];
  // Built in small parallel batches, not strictly one at a time -- was
  // sequential because a shared M0 cluster had very little real
  // concurrency headroom; a paid Flex/dedicated cluster tolerates several
  // index builds at once comfortably, so this converges faster after a
  // fresh deploy or when new indexes are added. Kept batched (not one big
  // Promise.all) rather than fully unbounded, since this is still
  // background work with no user waiting on it -- no need to hit the
  // cluster with 30+ simultaneous index builds just to save a few seconds.
  const BATCH = 5;
  let failed = 0;
  for (let i = 0; i < specs.length; i += BATCH) {
    const batch = specs.slice(i, i + BATCH);
    const results = await Promise.allSettled(batch.map(([col, keys]) => _mdb.collection(col).createIndex(keys)));
    results.forEach((r, j) => {
      if (r.status === 'rejected') {
        failed++;
        const [col, keys] = batch[j];
        console.warn(`Index build failed (${col} ${JSON.stringify(keys)}):`, r.reason && r.reason.message);
      }
    });
  }
  console.log(`MongoDB indexes ensured (${specs.length - failed}/${specs.length})`);
}

// Lightweight liveness check for the /health endpoint.
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
  if (Object.keys($set).length)      op.$set      = $set;
  if (Object.keys($inc).length)      op.$inc      = $inc;
  if (Object.keys($unset).length)    op.$unset    = $unset;
  if (Object.keys($addToSet).length) op.$addToSet = $addToSet;
  if (Object.keys($pull).length)     op.$pull     = $pull;
  return op;
}

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
    const result = await _mdb.collection(this._col).updateOne({ _id: this.id }, op);
    // Real Firestore's .update() throws NOT_FOUND when the target document
    // doesn't exist -- this codebase's business logic (deposit/withdrawal
    // crediting, registration, etc.) is written assuming that failure is
    // loud, not silent. Mongo's updateOne() matching zero documents
    // otherwise resolves "successfully" with nothing written, which would
    // let a caller believe a credit/debit landed when it didn't.
    if (result.matchedCount === 0) {
      const err = new Error(`update() on ${this._col}/${this.id} matched no document`);
      err.code = 'NOT_FOUND';
      throw err;
    }
  }
  async delete() {
    await _mdb.collection(this._col).deleteOne({ _id: this.id });
  }
  // Conditional atomic update: applies `updates` only if this document ALSO
  // matches `extraFilter` (in addition to its own _id). Returns whether the
  // update actually applied (false means either the doc doesn't exist, or
  // extraFilter's condition already failed -- e.g. an idempotency token is
  // already present). Unlike two separate writes (increment a value, then
  // separately mark "done" on the SAME or a different document), this is
  // ONE atomic Mongo operation -- there is no window where the increment
  // has landed but the "done" marker hasn't (or vice versa), which is what
  // makes it safe to retry after a crash with no risk of double-applying.
  // See server.js's creditedDepositIds/refundedWithdrawalIds for the
  // pattern this exists for.
  async updateIf(extraFilter, updates) {
    const op = buildMongoUpdate(updates);
    if (!Object.keys(op).length) return false;
    const result = await _mdb.collection(this._col).updateOne({ _id: this.id, ...extraFilter }, op);
    return result.matchedCount > 0;
  }
}

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

// ── Transaction proxy (sequential — never wired to Mongo's real session API,
// see this file's own header note; not a tier limitation) ───────────────────
class Transaction {
  constructor() { this._ops = []; }
  get(ref) { return ref.get(); }
  set(ref, data, opts = {}) { this._ops.push({ type: 'set', ref, data, opts }); }
  update(ref, updates) { this._ops.push({ type: 'update', ref, updates }); }
  create(ref, data) { this._ops.push({ type: 'create', ref, data }); }
  delete(ref) { this._ops.push({ type: 'delete', ref }); }
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
