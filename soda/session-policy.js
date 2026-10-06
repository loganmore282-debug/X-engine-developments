'use strict';
const crypto = require('crypto');
const IDLE_MS = 4 * 60 * 60 * 1000;
const ADMIN_IDLE_MS = 15 * 60 * 1000;
const MAX_MS = 8 * 60 * 60 * 1000; // admin sessions
const MEMBER_MAX_MS = 4 * 60 * 60 * 1000;
const millis = value => value instanceof Date ? value.getTime() : Number(value) || Date.parse(value) || 0;
function validSession(session, now = Date.now(), idleMs = IDLE_MS) {
  return !!session && !session.revoked && millis(session.expiresAt) > now &&
    millis(session.lastActiveAt) > now - idleMs;
}
// ── Member sessions (our own login tokens; no Firebase) ──
// A login creates one record in `memberSessions`. The token handed to the app
// is 32 random bytes; only its SHA-256 is stored (as the document id), so a
// database leak does not leak usable tokens. Every request looks the record
// up, so logging out, changing a password or banning takes effect at once.
const tokenKey = token => crypto.createHash('sha256').update(String(token || '')).digest('hex');
const newToken = () => crypto.randomBytes(32).toString('base64url');
async function createMemberSession(db, uid, phone, now = Date.now()) {
  const token = newToken();
  await db.collection('memberSessions').doc(tokenKey(token)).set({
    uid, phone: phone || '', authTime: Math.floor(now / 1000),
    lastActiveAt: new Date(now), expiresAt: new Date(now + MEMBER_MAX_MS), revoked: false,
  });
  return { token, authTime: Math.floor(now / 1000), expiresAt: now + MEMBER_MAX_MS };
}
// Returns { uid, phone, auth_time, key } for a live session, else null. `touch`
// renews the idle window (the app's activity ping); everything else only reads.
async function checkMemberSession(db, token, touch = false, now = Date.now()) {
  if (!token || typeof token !== 'string' || token.length < 20 || token.length > 200) return null;
  const key = tokenKey(token);
  const ref = db.collection('memberSessions').doc(key);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const s = snap.data();
  if (!validSession(s, now)) return null;
  if (touch && !(await ref.updateIf({ revoked: false, expiresAt: { $gt: new Date(now) },
    lastActiveAt: { $gt: new Date(now - IDLE_MS) } }, { lastActiveAt: new Date(now) }))) return null;
  return { uid: s.uid, phone: s.phone || '', auth_time: Number(s.authTime) || 0, key };
}
async function revokeMemberSession(db, token) {
  const ref = db.collection('memberSessions').doc(tokenKey(token));
  const snap = await ref.get();
  if (snap.exists) await ref.update({ revoked: true });
}
// Ends every session of one member (password changed/reset, account deleted or
// suspended). `exceptKey` keeps the session that made the change.
async function revokeAllMemberSessions(db, uid, exceptKey) {
  const snap = await db.collection('memberSessions').where('uid', '==', uid).get();
  await Promise.all(snap.docs.filter(d => d.id !== exceptKey && !d.data().revoked).map(d => d.ref.update({ revoked: true })));
}
module.exports = { IDLE_MS, ADMIN_IDLE_MS, MAX_MS, MEMBER_MAX_MS, validSession, tokenKey, createMemberSession, checkMemberSession, revokeMemberSession, revokeAllMemberSessions };
