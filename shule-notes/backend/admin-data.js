// What the admin panel reads and does: the student list, the dashboard
// numbers and the announcements. Every function returns plain data; the
// routes in server.js only check the admin key and call these.
'use strict';
const { getDb } = require('./db');
const { hashPassword, forgetUser } = require('./auth');
const { eraseUser, toId, MIN_PASSWORD, MAX_PASSWORD } = require('./accounts');
const { normalizePhone } = require('./phone');
const { NAMES: LEVEL_NAMES, isValidLevel } = require('./levels');
const { countNewFeedback } = require('./feedback');

function todayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── students ────────────────────────────────────────────────────────────────
async function listUsers({ q, status, classLevel, page, pageSize } = {}) {
  const db = getDb();
  const size = Math.min(Math.max(parseInt(pageSize, 10) || 25, 1), 100);
  const current = Math.max(parseInt(page, 10) || 1, 1);
  const filter = {};

  const search = String(q || '').trim().slice(0, 60);
  if (search) {
    const ors = [{ name: { $regex: escapeRegex(search), $options: 'i' } }];
    const digits = search.replace(/\D/g, '');
    if (digits.length >= 3) ors.push({ phone: { $regex: escapeRegex(normalizePhone(search).length >= 9 ? normalizePhone(search) : digits) } });
    filter.$or = ors;
  }
  if (status === 'banned') filter.status = 'banned';
  else if (status === 'active') filter.status = { $ne: 'banned' };
  if (classLevel === 'none') filter.classLevel = null;
  else if (classLevel) filter.classLevel = String(classLevel);

  const users = db.collection('users');
  const total = await users.countDocuments(filter);
  const rows = await users.find(filter).sort({ createdAt: -1 }).skip((current - 1) * size).limit(size).toArray();

  const ids = rows.map((u) => String(u._id));
  const usage = ids.length ? await db.collection('aiUsage').find({ userId: { $in: ids } }).toArray() : [];
  const today = todayKey();
  const perUser = {};
  for (const row of usage) {
    const entry = (perUser[row.userId] = perUser[row.userId] || { today: 0, total: 0 });
    entry.total += row.count || 0;
    if (row.date === today) entry.today += row.count || 0;
  }

  return {
    total, page: current, pageSize: size,
    users: rows.map((u) => ({
      id: String(u._id), name: u.name || '', phone: u.phone || '', classLevel: u.classLevel || null,
      status: u.status === 'banned' ? 'banned' : 'active',
      accessUntil: (() => { const t = require('./payments').untilFor(u, u.classLevel); return t ? new Date(t) : null; })(),
      passes: require('./payments').livePasses(u),
      createdAt: u.createdAt || null, lastLoginAt: u.lastLoginAt || null,
      aiToday: (perUser[String(u._id)] || {}).today || 0, aiTotal: (perUser[String(u._id)] || {}).total || 0,
    })),
  };
}

// The owner correcting a student's name or class.
async function updateStudent(userId, { name, classLevel }) {
  const id = toId(userId);
  const user = id ? await getDb().collection('users').findOne({ _id: id }) : null;
  if (!user) return { ok: false, status: 404, message: 'Student not found' };
  const patch = {};
  if (name !== undefined) {
    const clean = require('./accounts').cleanName(name);
    if (clean.length < 2) return { ok: false, status: 400, message: 'Enter the student\'s full name' };
    patch.name = clean;
  }
  if (classLevel !== undefined) {
    const level = String(classLevel || '').trim();
    if (level && !isValidLevel(level)) return { ok: false, status: 400, message: 'Choose a class from the list' };
    patch.classLevel = level || null;
  }
  if (Object.keys(patch).length) await getDb().collection('users').updateOne({ _id: id }, { $set: patch });
  return { ok: true };
}

// Every student, for a spreadsheet (the panel turns it into a CSV file).
async function exportStudents() {
  const rows = await getDb().collection('users').find({}).sort({ createdAt: -1 }).limit(50000).toArray();
  return rows.map((u) => ({ name: u.name || '', phone: u.phone || '', classLevel: u.classLevel || '', status: u.status === 'banned' ? 'banned' : 'active', joined: u.createdAt || '', lastSeen: u.lastLoginAt || '', accessUntil: u.accessUntil || '' }));
}

async function setUserStatus(userId, status) {
  if (status !== 'active' && status !== 'banned') return { ok: false, status: 400, message: 'Unknown status' };
  const db = getDb();
  const id = toId(userId);
  const user = id ? await db.collection('users').findOne({ _id: id }) : null;
  if (!user) return { ok: false, status: 404, message: 'Student not found' };
  await db.collection('users').updateOne({ _id: id }, { $set: { status } });
  // A ban takes effect at once: signed-in phones are signed out.
  if (status === 'banned') { await db.collection('sessions').deleteMany({ userId: String(userId) }); forgetUser(userId); }
  return { ok: true };
}

// The way a student who forgot their password gets back in: the owner sets a
// new one and tells them. Every device is signed out.
async function resetUserPassword(userId, password) {
  const next = String(password || '');
  if (next.length < MIN_PASSWORD) return { ok: false, status: 400, message: `The password needs at least ${MIN_PASSWORD} characters` };
  if (next.length > MAX_PASSWORD || require('./auth').tooLong(next)) return { ok: false, status: 400, message: 'That password is too long (72 characters at most)' };
  const db = getDb();
  const id = toId(userId);
  const user = id ? await db.collection('users').findOne({ _id: id }) : null;
  if (!user) return { ok: false, status: 404, message: 'Student not found' };
  await db.collection('users').updateOne({ _id: id }, { $set: { passwordHash: await hashPassword(next), passwordChangedAt: new Date() } });
  await db.collection('sessions').deleteMany({ userId: String(userId) });
  forgetUser(userId);
  return { ok: true };
}

async function adminDeleteUser(userId) {
  const db = getDb();
  const id = toId(userId);
  const user = id ? await db.collection('users').findOne({ _id: id }) : null;
  if (!user) return { ok: false, status: 404, message: 'Student not found' };
  await eraseUser(userId);
  return { ok: true };
}

// ── dashboard ──────────────────────────────────────────────────────────────
async function dashboardStats() {
  const db = getDb();
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const users = db.collection('users');
  const notes = db.collection('notes');

  const [students, newThisWeek, banned, withoutClass, noteTotal, noteHidden, subjects] = await Promise.all([
    users.countDocuments({}),
    users.countDocuments({ createdAt: { $gte: weekAgo } }),
    users.countDocuments({ status: 'banned' }),
    users.countDocuments({ classLevel: null }),
    notes.countDocuments({}),
    notes.countDocuments({ active: false }),
    db.collection('subjects').countDocuments({}),
  ]);

  const today = todayKey(now);
  const sixDaysAgo = todayKey(new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000));
  const usage = await db.collection('aiUsage').find({ date: { $gte: sixDaysAgo } }).toArray();
  const daily = {};
  for (let i = 6; i >= 0; i--) daily[todayKey(new Date(now.getTime() - i * 24 * 60 * 60 * 1000))] = 0;
  let aiToday = 0;
  let studentsAskingToday = 0;
  for (const row of usage) {
    if (row.date in daily) daily[row.date] += row.count || 0;
    if (row.date === today) { aiToday += row.count || 0; studentsAskingToday += 1; }
  }

  const byClass = [];
  for (const name of LEVEL_NAMES) {
    const count = await users.countDocuments({ classLevel: name });
    if (count > 0) byClass.push({ classLevel: name, count });
  }

  const topNotes = (await notes.find({ views: { $gt: 0 } }).sort({ views: -1 }).limit(5).toArray())
    .map((n) => ({ id: String(n._id), title: n.title, views: n.views || 0 }));
  const recentStudents = (await users.find({}).sort({ createdAt: -1 }).limit(5).toArray())
    .map((u) => ({ id: String(u._id), name: u.name || '', phone: u.phone || '', classLevel: u.classLevel || null, createdAt: u.createdAt || null }));

  return {
    students, newThisWeek, banned, withoutClass,
    notes: noteTotal, notesHidden: noteHidden, subjects,
    aiToday, studentsAskingToday,
    feedbackNew: await countNewFeedback(),
    aiLast7Days: Object.entries(daily).map(([date, count]) => ({ date, count })),
    byClass, topNotes, recentStudents,
  };
}

// ── announcements ──────────────────────────────────────────────────────────
function publicAnnouncement(a) {
  return {
    id: String(a._id), title: a.title || '', message: a.message || '',
    active: a.active !== false, expiresAt: a.expiresAt || null, createdAt: a.createdAt || null,
    classLevel: a.classLevel || null,
  };
}

async function listAnnouncements() {
  const rows = await getDb().collection('announcements').find({}).sort({ createdAt: -1 }).limit(100).toArray();
  return rows.map(publicAnnouncement);
}

// expiresAt arrives as a day ("2026-12-01"); the notice stays up until that day ends.
async function saveAnnouncement({ id, title, message, active, expiresAt, classLevel }) {
  const cleanTitle = String(title || '').trim().slice(0, 80);
  const cleanMessage = String(message || '').trim().slice(0, 400);
  if (!cleanTitle) return { ok: false, status: 400, message: 'Give the announcement a title' };
  if (!cleanMessage) return { ok: false, status: 400, message: 'Write the message students will see' };
  let expires = null;
  if (expiresAt) {
    const parsed = new Date(`${String(expiresAt).slice(0, 10)}T23:59:59.999Z`);
    if (Number.isNaN(parsed.getTime())) return { ok: false, status: 400, message: 'That date does not look right' };
    expires = parsed;
  }
  const level = classLevel ? String(classLevel).trim() : null;
  if (level && !isValidLevel(level)) return { ok: false, status: 400, message: 'Choose a class from the list' };
  const doc = { title: cleanTitle, message: cleanMessage, active: active !== false, expiresAt: expires, classLevel: level };
  const col = getDb().collection('announcements');
  if (id) {
    const oid = toId(id);
    if (!oid) return { ok: false, status: 400, message: 'Invalid id' };
    await col.updateOne({ _id: oid }, { $set: doc });
    return { ok: true };
  }
  const result = await col.insertOne({ ...doc, createdAt: new Date() });
  return { ok: true, id: String(result.insertedId) };
}

async function deleteAnnouncement(id) {
  const oid = toId(id);
  if (!oid) return { ok: false, status: 400, message: 'Invalid id' };
  await getDb().collection('announcements').deleteOne({ _id: oid });
  return { ok: true };
}

// The one notice the app shows: the newest switched-on one that has not expired.
async function activeAnnouncement() {
  const rows = await getDb().collection('announcements').find({ active: true }).sort({ createdAt: -1, _id: -1 }).limit(10).toArray();
  const now = Date.now();
  const hit = rows.find((a) => !a.expiresAt || new Date(a.expiresAt).getTime() > now);
  return hit ? publicAnnouncement(hit) : null;
}

// Everything a student may see in their notification inbox: switched on, not expired, meant for everyone or for their class; newest first.
async function listActiveAnnouncements(classLevel) {
  const rows = await getDb().collection('announcements').find({ active: true }).sort({ createdAt: -1, _id: -1 }).limit(50).toArray();
  const now = Date.now();
  return rows
    .filter((a) => (!a.expiresAt || new Date(a.expiresAt).getTime() > now) && (!a.classLevel || a.classLevel === classLevel))
    .slice(0, 20).map(publicAnnouncement);
}

module.exports = {
  updateStudent, exportStudents,
  listUsers, setUserStatus, resetUserPassword, adminDeleteUser, dashboardStats,
  listAnnouncements, saveAnnouncement, deleteAnnouncement, activeAnnouncement, listActiveAnnouncements,
};
