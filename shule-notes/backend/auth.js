// Self-rolled auth: scrypt-hashed passwords, random session tokens stored
// HASHED (never the raw token -- a leaked database must not hand out usable
// sessions), with a fixed expiry enforced by Mongo's own TTL index (db.js)
// rather than re-checked by hand at every call site.
'use strict';
const crypto = require('crypto');
const { promisify } = require('util');
const { getDb } = require('./db');

const SESSION_DAYS = 30;

// scrypt runs on a background thread (crypto.scrypt), not on the thread that answers
// requests: one password check is ~50 ms of CPU, and the synchronous version froze
// EVERY other student's request for that long. Same cost settings, so passwords
// saved earlier still verify.
const scrypt = promisify(crypto.scrypt);

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = (await scrypt(password, salt, 64)).toString('hex');
  return `${salt}:${hash}`;
}

// Constant-time by construction: scrypt always runs, and the final
// comparison uses timingSafeEqual rather than ===, so neither a missing
// salt/hash nor a wrong password is distinguishable by timing.
async function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  let hashBuf, testBuf;
  try {
    hashBuf = Buffer.from(hash, 'hex');
    testBuf = await scrypt(String(password || ''), salt, 64);
  } catch (_) { return false; }
  if (hashBuf.length !== testBuf.length) return false;
  return crypto.timingSafeEqual(hashBuf, testBuf);
}

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await getDb().collection('sessions').insertOne({
    tokenHash: sha256(token), userId, createdAt: new Date(), expiresAt,
  });
  return { token, expiresAt };
}

async function resolveSession(token) {
  if (!token) return null;
  const row = await getDb().collection('sessions').findOne({ tokenHash: sha256(token) });
  if (!row) return null;
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null;
  return row.userId;
}

async function destroySession(token) {
  if (!token) return;
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
  const userId = await resolveSession(bearerToken(req));
  if (!userId) return res.status(401).json({ status: 'error', message: 'Please sign in again' });
  req.userId = userId;
  next();
}

module.exports = {
  hashPassword, verifyPassword, createSession, resolveSession, destroySession,
  bearerToken, requireAuth, sha256,
};
