'use strict';
const crypto = require('crypto');
const IDLE_MS = 15 * 60 * 1000;
const MAX_MS = 8 * 60 * 60 * 1000;
const millis = value => value instanceof Date ? value.getTime() : Number(value) || Date.parse(value) || 0;
function validSession(session, now = Date.now()) {
  return !!session && !session.revoked && millis(session.expiresAt) > now &&
    millis(session.lastActiveAt) > now - IDLE_MS;
}
function memberKey(decoded) {
  return crypto.createHash('sha256').update(decoded.uid + ':' + decoded.auth_time).digest('hex');
}
async function checkMember(db, decoded, touch = false, now = Date.now()) {
  const issued = Number(decoded.auth_time) * 1000;
  if (!Number.isFinite(issued) || issued > now + 60000 || issued + MAX_MS <= now) return false;
  const ref = db.collection('memberSessions').doc(memberKey(decoded));
  // createIfAbsent cannot revive an expired or explicitly revoked record.
  let snap = await ref.get();
  if (!snap.exists && now - issued < IDLE_MS) { await ref.createIfAbsent({
    lastActiveAt: new Date(issued), expiresAt: new Date(issued + MAX_MS), revoked: false
  }); snap = await ref.get(); }
  if (!snap.exists || !validSession(snap.data(), now)) return false;
  if (touch) return ref.updateIf({ revoked: false, expiresAt: { $gt: new Date(now) },
    lastActiveAt: { $gt: new Date(now - IDLE_MS) } }, { lastActiveAt: new Date(now) });
  return true;
}
module.exports = { IDLE_MS, MAX_MS, validSession, memberKey, checkMember };
