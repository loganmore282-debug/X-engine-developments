// How the admin panel signs in.
//
//  * The admin key is used ONCE, at sign-in (/admin/login). After that the panel holds a random session token that
//    expires (8 hours idle, 3 days at most), can be revoked, and is only ever stored hashed here. A stolen token is
//    far less useful than a stolen key, and the key itself never sits in the browser.
//  * Wrong keys / codes lock the sender's address out, for longer each time.
//  * Optional two-step sign-in (an authenticator app). With it on, the key alone opens nothing.
//  * Optional ADMIN_ALLOWED_IPS limits the panel to chosen addresses.
'use strict';
const crypto = require('crypto');
const { getDb } = require('./db');
const { safeEqual } = require('./admin-auth');
const totp = require('./totp');
const audit = require('./audit');

const IDLE_MS = 8 * 60 * 60 * 1000;
const ABSOLUTE_MS = 3 * 24 * 60 * 60 * 1000;
const TOUCH_EVERY_MS = 60 * 1000;
const MAX_FAILS = 5;
const FAIL_WINDOW_MS = 15 * 60 * 1000;
const BASE_LOCK_MS = 15 * 60 * 1000;
const MAX_LOCK_MS = 24 * 60 * 60 * 1000;

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

// ── lockouts (per address, in memory: a restart gives a fresh start, which is fine) ──
const failures = new Map(); // ip -> { n, first, lockedUntil, locks }
function lockedMinutes(ip) {
  const f = failures.get(ip);
  return f && f.lockedUntil > Date.now() ? Math.ceil((f.lockedUntil - Date.now()) / 60000) : 0;
}
function recordFailure(ip, why) {
  const now = Date.now();
  let f = failures.get(ip);
  if (!f || now - f.first > FAIL_WINDOW_MS) f = { n: 0, first: now, lockedUntil: f ? f.lockedUntil : 0, locks: f ? f.locks : 0 };
  f.n += 1;
  if (f.n >= MAX_FAILS) { f.locks += 1; f.lockedUntil = now + Math.min(MAX_LOCK_MS, BASE_LOCK_MS * 2 ** (f.locks - 1)); f.n = 0; f.first = now; }
  failures.set(ip, f);
  if (failures.size > 5000) failures.delete(failures.keys().next().value);
  audit.record('Failed admin sign-in', { reason: why }, ip).catch(() => {});
}
const clearFailures = (ip) => { const f = failures.get(ip); if (f) { f.n = 0; f.lockedUntil = 0; f.locks = 0; } };

// ── two-step settings ──
let totpCache = { at: 0, enabled: false, secret: '', lastStep: 0 };
async function totpState(force) {
  if (!force && Date.now() - totpCache.at < 10000) return totpCache;
  const doc = (await getDb().collection('settings').findOne({ _id: 'admin-security' })) || {};
  totpCache = { at: Date.now(), enabled: doc.totpEnabled === true && !!doc.totpSecret && process.env.ADMIN_DISABLE_2FA !== '1', secret: doc.totpSecret || '', pending: doc.totpPending || '', lastStep: doc.lastStep || 0 };
  return totpCache;
}
const legacyKeyAllowed = (t) => process.env.ADMIN_ALLOW_KEY_HEADER !== '0' && !t.enabled;

// ── who is calling ──
function ipAllowed(ip) {
  const list = (process.env.ADMIN_ALLOWED_IPS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!list.length) return true;
  const plain = String(ip || '').replace(/^::ffff:/, '');
  return list.includes(plain);
}
const bearer = (req) => { const h = String(req.headers.authorization || ''); return h.startsWith('Bearer ') ? h.slice(7).trim() : ''; };

const cache = new Map(); // tokenHash -> { id, until }  (a few seconds, so a revoked session is refused almost at once)
async function authenticate(req) {
  const token = bearer(req);
  if (token) {
    const hash = sha(token);
    const c = cache.get(hash);
    if (c && c.until > Date.now()) { req.adminSessionId = c.id; return true; }
    cache.delete(hash);
    const row = await getDb().collection('adminSessions').findOne({ tokenHash: hash });
    const now = Date.now();
    if (row && row.expiresAt.getTime() > now && now - row.lastSeen.getTime() < IDLE_MS) {
      if (now - row.lastSeen.getTime() > TOUCH_EVERY_MS) await getDb().collection('adminSessions').updateOne({ _id: row._id }, { $set: { lastSeen: new Date() } });
      cache.set(hash, { id: String(row._id), until: now + 5000 });
      if (cache.size > 500) cache.delete(cache.keys().next().value);
      req.adminSessionId = String(row._id);
      return true;
    }
    return false;
  }
  // Scripts (and older copies of the panel) may still send the key itself in a header, unless two-step sign-in is on.
  const key = req.headers['x-admin-key'];
  if (key) {
    if (lockedMinutes(req.ip)) return false; // a locked-out address gets nothing, even with the right key
    const t = await totpState();
    const real = process.env.ADMIN_KEY || '';
    if (legacyKeyAllowed(t) && real && safeEqual(key, real)) return true;
    recordFailure(req.ip, 'wrong key in a request header');
  }
  return false;
}

// ── signing in ──
async function login({ key, code, ip, userAgent }) {
  const mins = lockedMinutes(ip);
  if (mins) return { ok: false, status: 429, message: `Too many wrong attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.` };
  const real = process.env.ADMIN_KEY || '';
  await new Promise((r) => setTimeout(r, 250)); // every attempt takes the same time, right or wrong
  if (!real || !safeEqual(key, real)) { recordFailure(ip, 'wrong key'); return { ok: false, status: 401, message: 'Wrong admin key' }; }
  const t = await totpState(true);
  if (t.enabled) {
    if (!code) return { ok: false, status: 401, needCode: true, message: 'Enter the 6-digit code from your authenticator app.' };
    const step = totp.verify(t.secret, code);
    if (step === null || step <= t.lastStep) { recordFailure(ip, 'wrong two-step code'); return { ok: false, status: 401, needCode: true, message: 'That code is not right. Wait for a new one and try again.' }; }
    await getDb().collection('settings').updateOne({ _id: 'admin-security' }, { $set: { lastStep: step } }, { upsert: true });
    totpCache.lastStep = step;
  }
  clearFailures(ip);
  const token = crypto.randomBytes(32).toString('hex');
  const now = new Date();
  await getDb().collection('adminSessions').insertOne({ tokenHash: sha(token), createdAt: now, lastSeen: now, expiresAt: new Date(now.getTime() + ABSOLUTE_MS), ip: String(ip || ''), device: String(userAgent || '').slice(0, 120) });
  audit.record('Signed in to the admin panel', { twoStep: t.enabled ? 'yes' : 'no' }, ip).catch(() => {});
  return { ok: true, token, expiresAt: new Date(now.getTime() + ABSOLUTE_MS) };
}

async function logout(req) {
  const token = bearer(req);
  if (token) { cache.delete(sha(token)); await getDb().collection('adminSessions').deleteOne({ tokenHash: sha(token) }); }
}
async function listSessions(req) {
  const rows = await getDb().collection('adminSessions').find({}).sort({ lastSeen: -1 }).limit(50).toArray();
  return rows.filter((r) => r.expiresAt.getTime() > Date.now()).map((r) => ({ id: String(r._id), createdAt: r.createdAt, lastSeen: r.lastSeen, ip: r.ip, device: r.device, current: String(r._id) === req.adminSessionId }));
}
// Signs out every other device (the one asking stays).
async function revokeOthers(req) {
  const rows = await getDb().collection('adminSessions').find({}).toArray();
  let n = 0;
  for (const r of rows) if (String(r._id) !== req.adminSessionId) { await getDb().collection('adminSessions').deleteOne({ _id: r._id }); n += 1; }
  cache.clear();
  return n;
}

// ── two-step sign-in set-up ──
async function twoStepStatus() { const t = await totpState(true); return { enabled: t.enabled, forcedOff: process.env.ADMIN_DISABLE_2FA === '1' }; }
async function twoStepBegin() {
  const secret = totp.generateSecret();
  await getDb().collection('settings').updateOne({ _id: 'admin-security' }, { $set: { totpPending: secret } }, { upsert: true });
  totpCache.at = 0;
  return { secret, uri: totp.otpauthUri(secret) };
}
async function twoStepEnable(code) {
  const t = await totpState(true);
  if (!t.pending) return { ok: false, status: 400, message: 'Start again: ask for a new set-up key first.' };
  if (totp.verify(t.pending, code) === null) return { ok: false, status: 400, message: 'That code is not right. Check the app and try again.' };
  await getDb().collection('settings').updateOne({ _id: 'admin-security' }, { $set: { totpSecret: t.pending, totpEnabled: true, lastStep: 0 }, $unset: { totpPending: '' } }, { upsert: true });
  totpCache.at = 0;
  return { ok: true };
}
async function twoStepDisable(code) {
  const t = await totpState(true);
  if (!t.enabled) return { ok: true };
  if (totp.verify(t.secret, code) === null) return { ok: false, status: 400, message: 'Enter a current code from your authenticator app to switch it off.' };
  await getDb().collection('settings').updateOne({ _id: 'admin-security' }, { $set: { totpEnabled: false }, $unset: { totpSecret: '', totpPending: '' } });
  totpCache.at = 0;
  return { ok: true };
}

module.exports = { authenticate, login, logout, listSessions, revokeOthers, ipAllowed, lockedMinutes, recordFailure, twoStepStatus, twoStepBegin, twoStepEnable, twoStepDisable, _reset: () => { failures.clear(); cache.clear(); totpCache = { at: 0, enabled: false, secret: '', lastStep: 0 }; } };
