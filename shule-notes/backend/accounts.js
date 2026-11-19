// Things done TO an account, by the student or by the admin.
'use strict';
const { ObjectId } = require('mongodb');
const { getDb } = require('./db');
const { hashPassword, verifyPassword, sha256 } = require('./auth');

function toId(id) {
  try { return new ObjectId(String(id)); } catch (_) { return null; }
}

// Removes the account and everything stored about it. Sessions go first: if
// a later step fails the account still exists and the delete can be retried,
// rather than being deleted but still signed in.
async function eraseUser(userId) {
  const db = getDb();
  const id = toId(userId);
  if (!id) return false;
  await db.collection('sessions').deleteMany({ userId: String(userId) });
  await db.collection('aiUsage').deleteMany({ userId: String(userId) });
  await db.collection('users').deleteOne({ _id: id });
  return true;
}

const MIN_PASSWORD = 6;
const MAX_PASSWORD = 100;

// A student changing their own password. Every OTHER device is signed out;
// the one making the change stays signed in. 403 on a wrong password, since
// the app treats 401 as "your session expired".
async function changePassword(userId, currentPassword, newPassword, keepToken) {
  const next = String(newPassword || '');
  if (next.length < MIN_PASSWORD) return { ok: false, status: 400, message: `Choose a password with at least ${MIN_PASSWORD} characters` };
  if (next.length > MAX_PASSWORD) return { ok: false, status: 400, message: 'That password is too long' };
  const db = getDb();
  const id = toId(userId);
  const user = id ? await db.collection('users').findOne({ _id: id }) : null;
  if (!user) return { ok: false, status: 404, message: 'Account not found' };
  if (!(await verifyPassword(String(currentPassword || ''), user.passwordHash))) return { ok: false, status: 403, message: 'Your current password is not right' };
  await db.collection('users').updateOne({ _id: id }, { $set: { passwordHash: await hashPassword(next), passwordChangedAt: new Date() } });
  const keepHash = keepToken ? sha256(keepToken) : null;
  const sessions = await db.collection('sessions').find({ userId: String(userId) }).toArray();
  for (const s of sessions) {
    if (s.tokenHash !== keepHash) await db.collection('sessions').deleteOne({ _id: s._id });
  }
  return { ok: true };
}

// A display name: HTML tags and stray angle brackets removed, spaces tidied.
function cleanName(name) {
  return String(name || '').replace(/<[^>]*>/g, '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
}

async function updateProfile(userId, name) {
  const clean = cleanName(name);
  if (clean.length < 2) return { ok: false, status: 400, message: 'Enter your full name' };
  const db = getDb();
  const id = toId(userId);
  const user = id ? await db.collection('users').findOne({ _id: id }) : null;
  if (!user) return { ok: false, status: 404, message: 'Account not found' };
  await db.collection('users').updateOne({ _id: id }, { $set: { name: clean } });
  return { ok: true, user: { ...user, name: clean } };
}

module.exports = { eraseUser, changePassword, updateProfile, cleanName, toId, MIN_PASSWORD, MAX_PASSWORD };
