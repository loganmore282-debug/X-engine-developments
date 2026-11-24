// Self-rolled auth: bcrypt-hashed passwords, random session tokens stored
// HASHED (never the raw token -- a leaked database must not hand out usable
// sessions), with a fixed expiry enforced by Mongo's own TTL index (db.js)
// rather than re-checked by hand at every call site.
'use strict';
const crypto = require('crypto');
const { promisify } = require('util');
const { getDb } = require('./db');

const SESSION_DAYS = 30;

// Passwords are hashed with bcrypt (cost 12, a fresh random salt inside every hash). The native `bcrypt` package runs
// on a background thread, so a check never freezes other students' requests; `bcryptjs` (pure JavaScript, same
// hashes) is the automatic fallback if the native one cannot load on some machine.
let bcrypt;
try { bcrypt = require('bcrypt'); } catch (_) { bcrypt = require('bcryptjs'); }
const COST = 12;
// bcrypt only reads the first 72 bytes of a password; longer ones are refused at sign-up instead of silently cut.
const MAX_PASSWORD_BYTES = 72;
const tooLong = (password) => Buffer.byteLength(String(password || ''), 'utf8') > MAX_PASSWORD_BYTES;

const isBcrypt = (stored) => /^\$2[abxy]\$\d\d\$/.test(String(stored || ''));

async function hashPassword(password) {
  return bcrypt.hash(String(password), COST);
}

// A real bcrypt hash of a password nobody knows: compared when an account does not exist (or is still in the old
// format), so every sign-in attempt costs about the same time and never reveals which accounts exist.
let dummy = null;
async function dummyHash() {
  if (!dummy) dummy = await bcrypt.hash('this-is-not-anybodys-password', COST);
  return dummy;
}

// Accounts made before bcrypt were saved as "salt:scrypt-hash". They still sign in, and are changed to bcrypt at that
// moment (see needsRehash and the sign-in route), so nobody has to reset anything.
const legacyScrypt = promisify(crypto.scrypt);
async function verifyLegacy(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  let hashBuf, testBuf;
  try {
    hashBuf = Buffer.from(hash, 'hex');
    testBuf = await legacyScrypt(String(password || ''), salt, 64);
  } catch (_) { return false; }
  if (hashBuf.length !== testBuf.length) return false;
  return crypto.timingSafeEqual(hashBuf, testBuf);
}

async function verifyPassword(password, stored) {
  const text = String(password || '');
  if (isBcrypt(stored)) {
    try { return await bcrypt.compare(text, String(stored)); } catch (_) { return false; }
  }
  const ok = await verifyLegacy(text, stored);
  await bcrypt.compare(text, await dummyHash()).catch(() => {}); // the old check is faster: spend the difference
  return ok;
}

// True when a stored hash should be replaced: the old format, or a lower cost than today's.
function needsRehash(stored) {
  if (!isBcrypt(stored)) return true;
  return Number(String(stored).slice(4, 6)) < COST;
}

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

// One device at a time: a NEW sign-in marks every OLDER session of the same student as replaced (kept, not deleted, so the old
// device can be told why it was signed out). Only sessions older than the new one are touched (by _id order), so two sign-ins
// that race each other leave exactly one winner instead of cancelling each other out.
const REPLACED_KEEP_MS = 7 * 24 * 60 * 60 * 1000;
async function createSession(userId, opts = {}) {
  const db = getDb();
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  const device = String(opts.device || '').replace(/[^\x20-\x7E]/g, '').slice(0, 120);
  const r = await db.collection('sessions').insertOne({
    tokenHash: sha256(token), userId: String(userId), createdAt: new Date(), expiresAt, device,
  });
  let signedOut = 0;
  if (opts.single !== false) {
    const now = new Date();
    // The devices about to be signed out, so they can be told straight away (live.js) instead of on their next request.
    const older = await db.collection('sessions').find({ userId: String(userId), _id: { $lt: r.insertedId }, replaced: { $ne: true } }).toArray();
    const res = await db.collection('sessions').updateMany(
      { userId: String(userId), _id: { $lt: r.insertedId }, replaced: { $ne: true } },
      { $set: { replaced: true, replacedAt: now, replacedBy: String(opts.deviceLabel || '').slice(0, 80) } },
    );
    signedOut = (res && (res.modifiedCount || res.matchedCount)) || 0;
    const where = opts.deviceLabel ? `on ${String(opts.deviceLabel).slice(0, 80)}` : 'on another device';
    for (const s of older) {
      require('./live').publishAndClose('session:' + String(s._id), 'signed_out', {
        code: 'signed_in_elsewhere',
        message: `You were signed out because this account was opened ${where}. Sign in again to use it here. If that was not you, contact support.`,
      });
    }
    // A signed-out device is only told about it for a week; after that the row is just clutter.
    await db.collection('sessions').deleteMany({ userId: String(userId), replaced: true, replacedAt: { $lt: new Date(now.getTime() - REPLACED_KEEP_MS) } });
    forgetUser(userId); // the other device must find out on its very next request, not after the 5 s memory
  }
  return { token, expiresAt, sessionId: String(r.insertedId), signedOut };
}

// Every request carries a token, so every request used to cost a database read. A session found is remembered for a few
// seconds; signing out, a ban and a password reset clear it at once (forgetUser), so none of them is delayed.
const SESSION_CACHE_MS = 30000;
const SESSION_CACHE_MAX = 5000;
const sessionCache = new Map(); // tokenHash -> { userId, until }

async function lookupSession(token) {
  if (!token) return { userId: null };
  const hash = sha256(token);
  const cached = sessionCache.get(hash);
  if (cached && cached.until > Date.now()) return { userId: cached.userId, sessionId: cached.sessionId };
  sessionCache.delete(hash);
  const row = await getDb().collection('sessions').findOne({ tokenHash: hash });
  if (!row) return { userId: null };
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return { userId: null };
  if (row.replaced) return { userId: null, replaced: true, replacedBy: row.replacedBy || '' };
  if (sessionCache.size >= SESSION_CACHE_MAX) sessionCache.delete(sessionCache.keys().next().value);
  sessionCache.set(hash, { userId: row.userId, sessionId: String(row._id), until: Date.now() + SESSION_CACHE_MS });
  return { userId: row.userId, sessionId: String(row._id) };
}
async function resolveSession(token) { return (await lookupSession(token)).userId; }

// Called whenever sessions are deleted for a student (ban, password reset, account removal).
function forgetUser(userId) {
  for (const [hash, entry] of sessionCache) if (entry.userId === String(userId)) sessionCache.delete(hash);
}

async function destroySession(token) {
  if (!token) return;
  sessionCache.delete(sha256(token));
  await getDb().collection('sessions').deleteOne({ tokenHash: sha256(token) });
}

function bearerToken(req) {
  const h = String(req.headers.authorization || '');
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}

// Attaches req.userId, or refuses the request outright -- every money-safety
// and privacy rule in this app depends on no route ever trusting a
// caller-supplied userId instead of this.
async function requireAuth(req, res, next) {
  const found = await lookupSession(bearerToken(req));
  if (!found.userId) {
    if (found.replaced) {
      const where = found.replacedBy ? `on ${found.replacedBy}` : 'on another device';
      return res.status(401).json({ status: 'error', code: 'signed_in_elsewhere', message: `You were signed out because this account was opened ${where}. Sign in again to use it here. If that was not you, contact support.` });
    }
    return res.status(401).json({ status: 'error', message: 'Please sign in again' });
  }
  const userId = found.userId;
  req.sessionId = found.sessionId || null;
  req.userId = userId;
  next();
}

module.exports = {
  hashPassword, verifyPassword, needsRehash, dummyHash, tooLong, MAX_PASSWORD_BYTES, createSession, resolveSession, lookupSession, destroySession, forgetUser,
  bearerToken, requireAuth, sha256,
};
