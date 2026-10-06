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
// A live session is remembered in this process for a short while, so a request does not have to read the
// database again just to be recognised (a member's phone asks for fresh data every few seconds). It is
// re-validated against the clock on every use (idle limit, expiry), and it is dropped at once whenever
// this process revokes it (logout, password change, ban, delete). The server runs as ONE process, so that
// is exact; the 30-second cap is only a safety net for changes made outside it. Only used when the caller
// does not pass its own clock, so tests that move time still hit the store.
const SESSION_CACHE_MS = 30 * 1000, SESSION_CACHE_MAX = 20000;
const _caches = new WeakMap();
const cacheFor = db => { let c = _caches.get(db); if (!c) { c = new Map(); _caches.set(db, c); } return c; };
// Returns { uid, phone, auth_time, key } for a live session, else null. `touch`
// renews the idle window (the app's activity ping); everything else only reads.
async function checkMemberSession(db, token, touch = false, clock) {
  if (!token || typeof token !== 'string' || token.length < 20 || token.length > 200) return null;
  const useCache = clock === undefined, now = useCache ? Date.now() : clock;
  const key = tokenKey(token), cache = cacheFor(db);
  let s = null;
  const hit = useCache ? cache.get(key) : null;
  if (hit && now - hit.at < SESSION_CACHE_MS) s = hit.s;
  const ref = db.collection('memberSessions').doc(key);
  if (!s) {
    const snap = await ref.get();
    if (!snap.exists) { cache.delete(key); return null; }
    s = snap.data();
  }
  if (!validSession(s, now)) { cache.delete(key); return null; }
  if (touch) {
    if (!(await ref.updateIf({ revoked: false, expiresAt: { $gt: new Date(now) },
      lastActiveAt: { $gt: new Date(now - IDLE_MS) } }, { lastActiveAt: new Date(now) }))) { cache.delete(key); return null; }
    s = Object.assign({}, s, { lastActiveAt: new Date(now) });
  }
  if (useCache) {
    if (cache.size >= SESSION_CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(key, { s, at: hit && hit.s === s ? hit.at : now });
  }
  return { uid: s.uid, phone: s.phone || '', auth_time: Number(s.authTime) || 0, key };
}
// Drops the remembered copy of one session (by its stored key) after it was revoked elsewhere.
function forgetSession(db, key) { cacheFor(db).delete(key); }
async function revokeMemberSession(db, token) {
  const key = tokenKey(token);
  cacheFor(db).delete(key);
  const ref = db.collection('memberSessions').doc(key);
  const snap = await ref.get();
  if (snap.exists) await ref.update({ revoked: true });
}
// Ends every session of one member (password changed/reset, account deleted or
// suspended). `exceptKey` keeps the session that made the change.
async function revokeAllMemberSessions(db, uid, exceptKey) {
  const cache = cacheFor(db);
  for (const [k, v] of cache) if (v.s && v.s.uid === uid && k !== exceptKey) cache.delete(k);
  const snap = await db.collection('memberSessions').where('uid', '==', uid).get();
  await Promise.all(snap.docs.filter(d => d.id !== exceptKey && !d.data().revoked).map(d => d.ref.update({ revoked: true })));
}
module.exports = { forgetSession, IDLE_MS, ADMIN_IDLE_MS, MAX_MS, MEMBER_MAX_MS, validSession, tokenKey, createMemberSession, checkMemberSession, revokeMemberSession, revokeAllMemberSessions };
