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

// Speed settings (the database is on the SAME machine, so the network is not the cost, waiting on the disk is):
//  - writeConcern w:1, j:false: a write is confirmed as soon as MongoDB has it in memory instead of waiting for the disk
//    to confirm it (MongoDB still writes its journal to disk every 100 ms, so a crash can lose at most that last
//    fraction of a second; the payment code re-checks with MarzPay, so no payment is lost for good).
//  - a warm pool of connections so a busy minute never waits for a new one; no compression (same machine).
const client = new MongoClient(MONGODB_URI, {
  maxPoolSize: 60, minPoolSize: 10, maxIdleTimeMS: 120000,
  writeConcern: { w: 1, j: false },
  readConcernLevel: 'local',
  compressors: 'none',
  retryReads: true, retryWrites: true,
  serverSelectionTimeoutMS: 8000, connectTimeoutMS: 8000, socketTimeoutMS: 45000,
  appName: 'shule-notes',
});
let db = null;

async function connect() {
  await client.connect();
  // The database name comes from the connection string itself
  // (mongodb+srv://.../shulenotesdb?...) -- never defaulted here, so a typo'd
  // URI cannot silently land writes in Atlas's "test" database.
  db = client.db();
  await ensureIndexes();
  await ensureSpeedIndexes();
  await tidyOldNotes();
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
  await db.collection('sessions').createIndex({ userId: 1 });
  await db.collection('notices').createIndex({ userId: 1, createdAt: -1 });
  await db.collection('notices').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await db.collection('notes').createIndex({ subjectId: 1, active: 1 });
  await db.collection('subjects').createIndex({ order: 1 });
  // One row per (user, day) -- the whole mechanism the AI daily cap depends
  // on. A duplicate key error here is the rate limiter itself, not a bug.
  await db.collection('payments').createIndex({ reference: 1 }, { unique: true });
  await db.collection('payments').createIndex({ userId: 1, createdAt: -1 });
  await db.collection('adminSessions').createIndex({ tokenHash: 1 }, { unique: true });
  await db.collection('adminSessions').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await db.collection('auditLog').createIndex({ at: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 365 });
  await db.collection('aiUsage').createIndex({ userId: 1, date: 1 }, { unique: true });
}

// Indexes that only make reads faster (the admin counts, lists and the student library). A failure here is logged, never fatal.
async function ensureSpeedIndexes() {
  const want = [
    ['users', { status: 1 }], ['users', { classLevel: 1 }], ['users', { accessUntil: 1 }], ['users', { lastSeen: -1 }],
    ['sessions', { userId: 1, _id: 1 }],
    ['notes', { active: 1, uploadedAt: -1 }], ['notes', { views: -1 }], ['notes', { uploadedAt: -1 }],
    ['payments', { status: 1, createdAt: -1 }], ['payments', { userId: 1, status: 1, classLevel: 1 }],
    ['feedback', { createdAt: -1 }], ['feedback', { status: 1, createdAt: -1 }], ['feedback', { userId: 1, createdAt: -1 }],
    ['slides', { order: 1, createdAt: 1 }],
    ['announcements', { active: 1, createdAt: -1 }],
    ['aiUsage', { date: 1 }],
    ['auditLog', { at: -1 }],
  ];
  await Promise.all(want.map(([name, spec]) => db.collection(name).createIndex(spec).catch((e) => console.error('index on', name, 'skipped:', e.message))));
}

// Notes uploaded by older versions have no textStatus; the library list no longer loads each note's (large) text, so say it once here.
async function tidyOldNotes() {
  try {
    const notes = db.collection('notes');
    await notes.updateMany({ textStatus: { $exists: false }, extractedText: { $gt: '' } }, { $set: { textStatus: 'ready' } });
    await notes.updateMany({ textStatus: { $exists: false } }, { $set: { textStatus: 'none' } });
  } catch (e) { console.error('could not tidy old notes:', e.message); }
}

function getDb() {
  if (!db) throw new Error('getDb() called before connect()');
  return db;
}

module.exports = { connect, getDb, client };
