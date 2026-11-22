// Mongo connection + the indexes this app relies on for correctness, not
// just speed: a unique index on phone (so two accounts can never claim
// the same login), and a TTL index on sessions (expired tokens are deleted
// by MongoDB itself rather than trusted to a `now < expiresAt` check at
// every call site forever).
'use strict';
const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('MONGODB_URI is not set. Refusing to start with no database.');
  process.exit(1);
}

const client = new MongoClient(MONGODB_URI, { maxPoolSize: 20 });
let db = null;

async function connect() {
  await client.connect();
  // The database name comes from the connection string itself
  // (mongodb+srv://.../shulenotesdb?...) -- never defaulted here, so a typo'd
  // URI cannot silently land writes in Atlas's "test" database.
  db = client.db();
  await ensureIndexes();
  console.log('MongoDB connected (' + db.databaseName + ')');
  return db;
}

async function ensureIndexes() {
  // Accounts are identified by phone number only.
  await db.collection('users').createIndex(
    { phone: 1 }, { unique: true, partialFilterExpression: { phone: { $type: 'string' } } }
  );
  await db.collection('users').createIndex({ createdAt: -1 });
  await db.collection('sessions').createIndex({ tokenHash: 1 }, { unique: true });
  await db.collection('sessions').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await db.collection('notes').createIndex({ subjectId: 1, active: 1 });
  await db.collection('subjects').createIndex({ order: 1 });
  // One row per (user, day) -- the whole mechanism the AI daily cap depends
  // on. A duplicate key error here is the rate limiter itself, not a bug.
  await db.collection('payments').createIndex({ reference: 1 }, { unique: true });
  await db.collection('payments').createIndex({ userId: 1, createdAt: -1 });
  await db.collection('aiUsage').createIndex({ userId: 1, date: 1 }, { unique: true });
}

function getDb() {
  if (!db) throw new Error('getDb() called before connect()');
  return db;
}

module.exports = { connect, getDb, client };
