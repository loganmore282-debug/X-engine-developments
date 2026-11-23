// Paying for access with MarzPay (MTN / Airtel mobile money).
//
// The rules that keep this safe:
//  * The SERVER picks the price (from the plan), never the app.
//  * A student gets access ONLY after MarzPay itself says the money arrived: the webhook is just a nudge, and every
//    "paid" is checked again against MarzPay's own status endpoint before anything is granted.
//  * A payment turns pending -> paid with ONE atomic update that only one caller can win, so a webhook and a status
//    check arriving together can never grant twice.
//  * A pass opens ONE class (the owner's rule): `users.classAccess = { "Senior 4": <until>, ... }`. Paying again for the same
//    class adds time on top of what is left. A note with no class ("All classes") opens with a pass for any class.
//    `users.accessUntil` is the OLD all-classes pass: still honoured until it runs out (students paid for it), and the
//    owner can still give one from the admin panel ("All classes"); new purchases never create it.
'use strict';
const crypto = require('crypto');
const { ObjectId } = require('mongodb');
const { getDb } = require('./db');
const { isValidLevel } = require('./levels');

const MARZPAY_BASE = 'https://wallet.wearemarz.com/api/v1';
const MARZ_TIMEOUT = 20000;
const PENDING_LABEL_AFTER_MS = 15 * 60 * 1000; // a prompt nobody approved is shown as "expired" (a late approval still counts)

const DEFAULT_PLANS = [
  { id: '3h', name: '3 hours', price: 1000, minutes: 180, active: true },
  { id: '1d', name: '1 day', price: 1500, minutes: 1440, active: true },
  { id: '1w', name: '1 week', price: 5000, minutes: 10080, active: true },
  { id: '1m', name: '1 month', price: 12500, minutes: 43200, active: true },
  { id: '3m', name: '3 months', price: 30000, minutes: 129600, active: true },
];

// ── plans (the owner edits them in the admin panel) ─────────────────────────
function planList(settings) {
  return Array.isArray(settings.plans) && settings.plans.length ? settings.plans : DEFAULT_PLANS;
}
const activePlans = (settings) => planList(settings).filter((p) => p.active !== false);

// Returns { ok, plans } with a clean list, or { ok:false, message }.
function cleanPlans(input) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 12) return { ok: false, message: 'Add between 1 and 12 passes' };
  const seen = new Set();
  const out = [];
  for (const raw of input) {
    const id = String((raw && raw.id) || '').trim().toLowerCase();
    if (!/^[a-z0-9]{1,12}$/.test(id)) return { ok: false, message: 'Each pass needs a short code of letters and numbers' };
    if (seen.has(id)) return { ok: false, message: 'Two passes have the same code' };
    seen.add(id);
    const name = String(raw.name || '').trim().slice(0, 30);
    if (!name) return { ok: false, message: 'Every pass needs a name' };
    const price = Number(raw.price);
    if (!Number.isInteger(price) || price < 500 || price > 5000000) return { ok: false, message: `"${name}": the price must be a whole number from 500 to 5,000,000` };
    const minutes = Number(raw.minutes);
    if (!Number.isInteger(minutes) || minutes < 30 || minutes > 525600) return { ok: false, message: `"${name}": the length must be from 30 minutes to 1 year` };
    out.push({ id, name, price, minutes, active: raw.active !== false });
  }
  if (!out.some((p) => p.active)) return { ok: false, message: 'Keep at least one pass switched on' };
  return { ok: true, plans: out };
}

// ── who may read what ───────────────────────────────────────────────────────
const ms = (d) => (d ? new Date(d).getTime() : 0);
// When the pass for this class ends (the later of the class pass and an old all-classes pass), or 0.
function untilFor(user, classLevel) {
  if (!user) return 0;
  const own = classLevel && user.classAccess ? ms(user.classAccess[classLevel]) : 0;
  return Math.max(own, ms(user.accessUntil));
}
// Every live pass: [{ classLevel, until }] (classLevel null = all classes).
function livePasses(user, now = new Date()) {
  if (!user) return [];
  const out = Object.entries(user.classAccess || {}).filter(([, d]) => ms(d) > now.getTime()).map(([classLevel, d]) => ({ classLevel, until: new Date(d) }));
  if (ms(user.accessUntil) > now.getTime()) out.push({ classLevel: null, until: new Date(user.accessUntil) });
  return out;
}
// With a class: may this student read that class? Without one: do they have any live pass at all?
function hasAccess(user, now = new Date(), classLevel) {
  if (classLevel) return untilFor(user, classLevel) > now.getTime();
  return livePasses(user, now).length > 0;
}
// Free to read: payments are off, or the owner marked the note free, or the student has a pass for the note's class.
// A note for "All classes" (or a class no longer in the list) opens with a pass for any class.
function canRead({ settings, user, note, now }) {
  if (settings.paymentsEnabled !== true) return true;
  if (note && note.free === true) return true;
  const level = note && isValidLevel(note.classLevel) ? note.classLevel : null;
  return hasAccess(user, now || new Date(), level);
}
const PAYMENT_REQUIRED = { status: 'error', code: 'payment_required', message: 'This document needs a pass for its class. Choose one to keep reading.' };

// ── MarzPay ─────────────────────────────────────────────────────────────────
const SUCCESS = ['completed', 'successful', 'success', 'paid'];
const FAILURE = ['failed', 'cancelled', 'canceled', 'error', 'declined', 'rejected', 'expired'];
function normalizeStatus(raw) {
  const s = String(raw || '').toLowerCase();
  if (SUCCESS.includes(s)) return 'paid';
  if (FAILURE.includes(s)) return 'failed';
  return 'pending';
}

// The key is entered in the admin panel as the credentials string MarzPay gives (already base64), or as user:key.
function credentialsFor(key) {
  const k = String(key || '').trim();
  if (!k) return '';
  return k.includes(':') ? Buffer.from(k).toString('base64') : k;
}

function makeMarz({ getKey, fetchImpl = fetch }) {
  const headers = async () => ({ Authorization: `Basic ${credentialsFor(await getKey())}`, 'Content-Type': 'application/json' });
  return {
    async configured() { return !!credentialsFor(await getKey()); },
    async collect({ amount, phone, reference, description, callbackUrl }) {
      const attempt = async (withCallback) => {
        const payload = { amount: Number(amount), phone_number: phone, country: 'UG', reference, description: description || 'Shule Notes pass' };
        if (withCallback && callbackUrl) payload.callback_url = callbackUrl;
        const resp = await fetchImpl(`${MARZPAY_BASE}/collect-money`, { method: 'POST', signal: AbortSignal.timeout(MARZ_TIMEOUT), headers: await headers(), body: JSON.stringify(payload) });
        let data = {};
        try { data = await resp.json(); } catch (_) { /* not JSON */ }
        const sandbox = data.status === 'sandbox' || (data.data && data.data.collection && data.data.collection.mode === 'sandbox');
        const ok = data.status === 'success' || sandbox;
        // MarzPay's own reasons (which field it did not like), kept for the admin panel.
        let detail = '';
        if (!ok && data.errors && typeof data.errors === 'object') detail = Object.entries(data.errors).map(([k, v]) => `${k}: ${[].concat(v).join(' ')}`).join('; ');
        return { ok, sandbox, uuid: (data.data && data.data.transaction && data.data.transaction.uuid) || null, message: data.message || '', detail, http: resp.status };
      };
      let r = await attempt(true);
      // The callback address is only a convenience (the app asks for the status itself): if MarzPay does not like it, go without it.
      if (!r.ok && callbackUrl) r = await attempt(false);
      if (!r.ok) console.error('MarzPay refused the payment request:', r.http, r.message, r.detail);
      return r;
    },
    // 'paid' | 'failed' | 'pending' | '' (could not be read right now)
    async status(uuid) {
      try {
        const resp = await fetchImpl(`${MARZPAY_BASE}/collect-money/${encodeURIComponent(uuid)}`, { signal: AbortSignal.timeout(MARZ_TIMEOUT), headers: await headers() });
        const d = await resp.json();
        const raw = (d && d.data && d.data.transaction && d.data.transaction.status) || (d && d.transaction && d.transaction.status) || (d && d.status) || '';
        return raw ? normalizeStatus(raw) : '';
      } catch (_) { return ''; }
    },
  };
}

// MTN and Airtel Uganda only. Returns { ok, local, intl } (0772123456 / +256772123456).
function mobileMoneyPhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  let local = '';
  if (/^256\d{9}$/.test(digits)) local = '0' + digits.slice(3);
  else if (/^0\d{9}$/.test(digits)) local = digits;
  else if (/^\d{9}$/.test(digits)) local = '0' + digits;
  if (!/^0(7[0-9]|39|20)\d{7}$/.test(local)) return { ok: false };
  return { ok: true, local, intl: '+256' + local.slice(1) };
}

// ── granting access ─────────────────────────────────────────────────────────
// One grant at a time per student, so two payments landing together add up instead of overwriting each other.
// classLevel: the class the pass opens; '*' = every class (the old kind, only given by the owner).
const chains = new Map();
function grantAccess(userId, minutes, classLevel, now = new Date()) {
  const key = String(userId);
  const run = async () => {
    const users = getDb().collection('users');
    const id = new ObjectId(key);
    const user = await users.findOne({ _id: id });
    if (!user) throw new Error('Student not found');
    const level = classLevel === '*' ? '*' : (isValidLevel(classLevel) ? classLevel : (isValidLevel(user.classLevel) ? user.classLevel : '*'));
    if (level === '*') {
      const from = Math.max(now.getTime(), ms(user.accessUntil));
      const until = new Date(from + minutes * 60000);
      await users.updateOne({ _id: id }, { $set: { accessUntil: until } });
      return { until, classLevel: null };
    }
    const current = user.classAccess && typeof user.classAccess === 'object' ? { ...user.classAccess } : {};
    // Expired classes are dropped so the record stays small.
    for (const [k, d] of Object.entries(current)) if (ms(d) <= now.getTime()) delete current[k];
    const from = Math.max(now.getTime(), ms(current[level]));
    const until = new Date(from + minutes * 60000);
    current[level] = until;
    await users.updateOne({ _id: id }, { $set: { classAccess: current } });
    return { until, classLevel: level };
  };
  const next = (chains.get(key) || Promise.resolve()).catch(() => {}).then(run);
  chains.set(key, next);
  next.finally(() => { if (chains.get(key) === next) chains.delete(key); }).catch(() => {});
  return next;
}

// The payment is already marked paid; make sure the student has the time (once, even if called twice).
async function ensureGranted(paymentId) {
  const col = getDb().collection('payments');
  const claim = await col.updateOne({ _id: paymentId, status: 'paid', granted: false }, { $set: { granted: true } });
  if (!claim.matchedCount) return false;
  try {
    const p = await col.findOne({ _id: paymentId });
    // A payment started before passes were per class has no class: it opens the student's class at that moment.
    const g = await grantAccess(p.userId, p.minutes, p.classLevel || null);
    await col.updateOne({ _id: paymentId }, { $set: { grantedUntil: g.until, classLevel: g.classLevel } });
    return true;
  } catch (e) {
    await col.updateOne({ _id: paymentId }, { $set: { granted: false } }); // an admin can press "Check again"
    throw e;
  }
}

// Money confirmed by MarzPay: flip to paid (only one caller wins) and grant.
async function completePayment(paymentId) {
  const col = getDb().collection('payments');
  const won = await col.updateOne({ _id: paymentId, status: { $in: ['pending', 'expired'] } }, { $set: { status: 'paid', paidAt: new Date(), granted: false } });
  if (won.matchedCount) await ensureGranted(paymentId);
  else await ensureGranted(paymentId).catch(() => {}); // already paid: finish a grant that failed earlier
  return col.findOne({ _id: paymentId });
}

async function failPayment(paymentId, reason) {
  await getDb().collection('payments').updateOne({ _id: paymentId, status: { $in: ['pending', 'expired'] } }, { $set: { status: 'failed', failedAt: new Date(), failureReason: String(reason || 'Payment was not completed').slice(0, 200) } });
}

// Ask MarzPay what happened to one pending payment, and act on a final answer.
async function refreshPayment(payment, marz) {
  if (!payment || (payment.status !== 'pending' && payment.status !== 'expired')) return payment;
  if (payment.marzUuid) {
    const real = await marz.status(payment.marzUuid);
    if (real === 'paid') return completePayment(payment._id);
    if (real === 'failed') { await failPayment(payment._id); return getDb().collection('payments').findOne({ _id: payment._id }); }
  }
  if (payment.status === 'pending' && Date.now() - new Date(payment.createdAt).getTime() > PENDING_LABEL_AFTER_MS) {
    await getDb().collection('payments').updateOne({ _id: payment._id, status: 'pending' }, { $set: { status: 'expired' } });
    return getDb().collection('payments').findOne({ _id: payment._id });
  }
  return payment;
}

// ── starting a payment ──────────────────────────────────────────────────────
// Returns { ok, payment } or { ok:false, status, message }.
async function startPayment({ settings, user, planId, phone, marz, callbackUrl, classLevel }) {
  if (settings.paymentsEnabled !== true) return { ok: false, status: 400, message: 'Payments are not open yet.' };
  if (!(await marz.configured())) return { ok: false, status: 503, message: 'Payments are not set up yet. Please try again later.' };
  if (user.status === 'banned') return { ok: false, status: 403, message: 'This account is suspended.' };
  const plan = activePlans(settings).find((p) => p.id === String(planId || ''));
  if (!plan) return { ok: false, status: 400, message: 'Choose one of the passes.' };
  // The class this pass opens: the one asked for (the class on screen), else the student's own class.
  const level = classLevel ? String(classLevel) : user.classLevel;
  if (!isValidLevel(level)) return { ok: false, status: 400, message: 'Choose your class first. A pass opens the notes of one class.' };
  const number = mobileMoneyPhone(phone || user.phone);
  if (!number.ok) return { ok: false, status: 400, message: 'Enter an MTN or Airtel mobile money number, like 0772 123 456.' };

  const col = getDb().collection('payments');
  const userId = String(user._id);
  // The same student tapping twice: carry on with the payment already waiting instead of asking MarzPay again.
  const waiting = await col.find({ userId, status: 'pending', classLevel: level }).sort({ createdAt: -1 }).limit(1).toArray();
  if (waiting[0] && Date.now() - new Date(waiting[0].createdAt).getTime() < 60 * 1000) return { ok: true, payment: waiting[0], resumed: true };

  const reference = crypto.randomUUID();
  const doc = { userId, classLevel: level, planId: plan.id, planName: plan.name, amount: plan.price, minutes: plan.minutes, phone: number.local, reference, marzUuid: null, status: 'pending', granted: false, createdAt: new Date() };
  const inserted = await col.insertOne(doc);
  doc._id = inserted.insertedId;
  let result;
  try { result = await marz.collect({ amount: plan.price, phone: number.intl, reference, description: `Shule Notes ${plan.name} ${level}`, callbackUrl }); }
  catch (e) { result = { ok: false, message: '' }; }
  if (!result.ok) {
    await failPayment(doc._id, [result.message, result.detail].filter(Boolean).join(' | ') || 'Could not start the payment');
    return { ok: false, status: 502, message: result.message || 'We could not start the payment. Check the number and try again.' };
  }
  await col.updateOne({ _id: doc._id }, { $set: { marzUuid: result.uuid } });
  doc.marzUuid = result.uuid;
  return { ok: true, payment: doc };
}

// ── MarzPay's webhook ───────────────────────────────────────────────────────
// A nudge only: whatever it says, the real status is asked from MarzPay before anyone is given access.
async function handleCallback(body, marz) {
  const reference = String((body && body.transaction && body.transaction.reference) || (body && body.reference) || (body && body.merchant_reference) || '');
  if (!reference) return { handled: false };
  const col = getDb().collection('payments');
  const payment = await col.findOne({ reference });
  if (!payment) return { handled: false };
  if (payment.status === 'paid' || payment.status === 'failed') return { handled: true, status: payment.status };
  const updated = await refreshPayment(payment, marz);
  return { handled: true, status: updated.status };
}

// What a student may see of a payment.
function publicPayment(p) {
  return { id: String(p._id), status: p.status, planName: p.planName, classLevel: p.classLevel || null, amount: p.amount, phone: p.phone, createdAt: p.createdAt, accessUntil: p.grantedUntil || null, message: p.failureReason || '' };
}

// A student's own history: what they paid, when, and what it gave them. Free passes from the owner are shown as gifts.
async function studentHistory(userId) {
  const rows = await getDb().collection('payments').find({ userId: String(userId) }).sort({ createdAt: -1 }).limit(50).toArray();
  return rows.map((p) => ({
    id: String(p._id), planName: p.planName || 'Pass', classLevel: p.classLevel || null, amount: p.manual ? 0 : (p.amount || 0), gift: !!p.manual,
    status: p.status === 'paid' ? 'paid' : p.status === 'failed' ? 'failed' : p.status === 'expired' ? 'expired' : 'pending',
    createdAt: p.createdAt, accessUntil: p.grantedUntil || null, phone: p.phone || '',
  }));
}

// ── admin ───────────────────────────────────────────────────────────────────
async function listPayments({ status, q, page, pageSize } = {}) {
  const db = getDb();
  const size = Math.min(Math.max(parseInt(pageSize, 10) || 25, 1), 100);
  const current = Math.max(parseInt(page, 10) || 1, 1);
  const filter = {};
  if (['pending', 'paid', 'failed', 'expired'].includes(status)) filter.status = status;
  const search = String(q || '').trim().slice(0, 40);
  if (search) {
    const digits = search.replace(/\D/g, '');
    const ors = [];
    if (digits.length >= 4) ors.push({ phone: { $regex: digits.slice(-9) } });
    const users = await db.collection('users').find({ name: { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }).limit(50).toArray();
    if (users.length) ors.push({ userId: { $in: users.map((u) => String(u._id)) } });
    if (!ors.length) return { total: 0, page: current, pageSize: size, payments: [] };
    filter.$or = ors;
  }
  const col = db.collection('payments');
  const total = await col.countDocuments(filter);
  const rows = await col.find(filter).sort({ createdAt: -1 }).skip((current - 1) * size).limit(size).toArray();
  const ids = [...new Set(rows.map((r) => r.userId))].filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));
  const people = ids.length ? await db.collection('users').find({ _id: { $in: ids } }).toArray() : [];
  const byId = Object.fromEntries(people.map((u) => [String(u._id), u]));
  return {
    total, page: current, pageSize: size,
    payments: rows.map((r) => ({
      id: String(r._id), userId: r.userId, student: (byId[r.userId] && byId[r.userId].name) || 'Deleted student',
      planName: r.planName, classLevel: r.classLevel || null, amount: r.amount, phone: r.phone, status: r.status, manual: !!r.manual,
      createdAt: r.createdAt, paidAt: r.paidAt || null, accessUntil: r.grantedUntil || null, needsAttention: r.status === 'paid' && r.granted === false,
      failureReason: r.failureReason || '', reference: r.reference || '',
    })),
  };
}

async function exportPayments() {
  const rows = await getDb().collection('payments').find({}).sort({ createdAt: -1 }).limit(50000).toArray();
  const ids = [...new Set(rows.map((r) => r.userId))].filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));
  const people = ids.length ? await getDb().collection('users').find({ _id: { $in: ids } }).toArray() : [];
  const byId = Object.fromEntries(people.map((u) => [String(u._id), u]));
  return rows.map((r) => ({ student: (byId[r.userId] && byId[r.userId].name) || 'Deleted student', phone: r.phone || '', pass: r.planName || '', class: r.classLevel || 'All classes', amount: r.manual ? 0 : r.amount || 0, status: r.manual ? 'given by admin' : r.status, date: r.createdAt || '', accessUntil: r.grantedUntil || '' }));
}

async function paymentSummary(now = new Date()) {
  const rows = await getDb().collection('payments').find({ status: 'paid', manual: { $ne: true } }).toArray();
  const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
  const sum = (since) => rows.filter((r) => !since || new Date(r.paidAt || r.createdAt) >= since).reduce((a, r) => a + (r.amount || 0), 0);
  const ago = (days) => new Date(now.getTime() - days * 86400000);
  const pending = await getDb().collection('payments').countDocuments({ status: 'pending' });
  const attention = rows.filter((r) => r.granted === false).length;
  const holders = await getDb().collection('users').find({ $or: [{ accessUntil: { $gt: now } }, { classAccess: { $exists: true } }] }).toArray();
  const withAccess = holders.filter((u) => hasAccess(u, now)).length;
  return { today: sum(startOfDay), week: sum(ago(7)), month: sum(ago(30)), all: sum(null), paidCount: rows.length, pending, attention, withAccess };
}

async function adminGrant(userId, { minutes, planId, classLevel }, settings) {
  const id = ObjectId.isValid(String(userId)) ? new ObjectId(String(userId)) : null;
  const user = id ? await getDb().collection('users').findOne({ _id: id }) : null;
  if (!user) return { ok: false, status: 404, message: 'Student not found' };
  let mins = Number(minutes);
  let label = 'Granted by admin';
  if (planId) {
    const plan = planList(settings).find((p) => p.id === String(planId));
    if (!plan) return { ok: false, status: 400, message: 'Choose one of the passes' };
    mins = plan.minutes; label = plan.name;
  }
  if (!Number.isInteger(mins) || mins < 30 || mins > 525600) return { ok: false, status: 400, message: 'Choose how long the access lasts' };
  // Which class it opens: the one chosen, '*' for every class, or (nothing chosen) the student's own class.
  const level = classLevel === '*' ? '*' : (classLevel ? String(classLevel) : user.classLevel);
  if (level !== '*' && !isValidLevel(level)) return { ok: false, status: 400, message: 'This student has no class yet: choose one, or All classes' };
  const g = await grantAccess(user._id, mins, level);
  await getDb().collection('payments').insertOne({ userId: String(user._id), classLevel: g.classLevel, planId: planId || 'manual', planName: label, amount: 0, minutes: mins, phone: user.phone || '', reference: crypto.randomUUID(), status: 'paid', manual: true, granted: true, grantedUntil: g.until, createdAt: new Date(), paidAt: new Date() });
  return { ok: true, accessUntil: g.until, classLevel: g.classLevel };
}

// Give the same time to many students at once (a whole class, or everyone): a prize, an exam-week gift, an apology.
async function adminGrantMany({ scope, classLevel, minutes }) {
  const mins = Number(minutes);
  if (!Number.isInteger(mins) || mins < 30 || mins > 525600) return { ok: false, status: 400, message: 'Choose how long the access lasts' };
  const filter = { status: { $ne: 'banned' } };
  if (scope === 'class') {
    if (!classLevel) return { ok: false, status: 400, message: 'Choose a class' };
    filter.classLevel = String(classLevel);
  } else if (scope !== 'all') return { ok: false, status: 400, message: 'Choose who receives it' };
  const users = await getDb().collection('users').find(filter).limit(20000).toArray();
  let done = 0;
  // A whole class gets that class; "everyone" gets every class.
  const level = scope === 'class' ? String(classLevel) : '*';
  for (const u of users) { try { await grantAccess(u._id, mins, level); done += 1; } catch (_) { /* skip one that vanished */ } }
  return { ok: true, count: done };
}

// Everything about one student for the admin: their details, passes and payments.
async function adminStudentDetail(userId) {
  const id = ObjectId.isValid(String(userId)) ? new ObjectId(String(userId)) : null;
  const user = id ? await getDb().collection('users').findOne({ _id: id }) : null;
  if (!user) return { ok: false, status: 404, message: 'Student not found' };
  const pays = await getDb().collection('payments').find({ userId: String(user._id) }).sort({ createdAt: -1 }).limit(30).toArray();
  const usage = await getDb().collection('aiUsage').find({ userId: String(user._id) }).toArray();
  const paid = pays.filter((p) => p.status === 'paid' && !p.manual).reduce((a, p) => a + (p.amount || 0), 0);
  return {
    ok: true,
    student: { id: String(user._id), name: user.name || '', phone: user.phone || '', classLevel: user.classLevel || null, status: user.status === 'banned' ? 'banned' : 'active', createdAt: user.createdAt || null, lastLoginAt: user.lastLoginAt || null, accessUntil: untilFor(user, user.classLevel) ? new Date(untilFor(user, user.classLevel)) : null, passes: livePasses(user), aiTotal: usage.reduce((a, u) => a + (u.count || 0), 0), totalPaid: paid },
    payments: pays.map((p) => ({ id: String(p._id), planName: p.planName, classLevel: p.classLevel || null, amount: p.amount, status: p.status, manual: !!p.manual, createdAt: p.createdAt, accessUntil: p.grantedUntil || null })),
  };
}

async function adminRevoke(userId) {
  const id = ObjectId.isValid(String(userId)) ? new ObjectId(String(userId)) : null;
  const user = id ? await getDb().collection('users').findOne({ _id: id }) : null;
  if (!user) return { ok: false, status: 404, message: 'Student not found' };
  await getDb().collection('users').updateOne({ _id: id }, { $set: { accessUntil: null, classAccess: {} } });
  return { ok: true };
}

async function adminRecheck(paymentId, marz) {
  const id = ObjectId.isValid(String(paymentId)) ? new ObjectId(String(paymentId)) : null;
  const p = id ? await getDb().collection('payments').findOne({ _id: id }) : null;
  if (!p) return { ok: false, status: 404, message: 'Payment not found' };
  if (p.status === 'paid') await ensureGranted(p._id).catch(() => {});
  else await refreshPayment(p, marz);
  return { ok: true };
}

module.exports = {
  studentHistory,
  DEFAULT_PLANS, planList, activePlans, cleanPlans, hasAccess, canRead, untilFor, livePasses, PAYMENT_REQUIRED,
  makeMarz, normalizeStatus, credentialsFor, mobileMoneyPhone,
  grantAccess, startPayment, refreshPayment, handleCallback, completePayment, publicPayment,
  listPayments, exportPayments, paymentSummary, adminGrant, adminGrantMany, adminStudentDetail, adminRevoke, adminRecheck,
};
