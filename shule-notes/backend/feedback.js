// "Send feedback" from the app, and the list the owner reads in the admin panel.
// Every function returns plain data; the routes in server.js only check who is
// asking and call these.
'use strict';
const { getDb } = require('./db');
const { toId } = require('./accounts');

const TYPES = ['problem', 'idea', 'other'];
const DAILY_LIMIT = 5;          // messages one student may send per day
const MIN_LENGTH = 5;
const MAX_LENGTH = 1000;

// Plain text only: the admin panel shows it, and a student must not be able to put markup in front of the owner.
function cleanMessage(value) {
  return String(value == null ? '' : value)
    .replace(/<[^>]*>/g, '')
    .replace(/[<>]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_LENGTH);
}

const cleanShort = (value, max) => String(value == null ? '' : value).replace(/[<>\n\r]/g, '').trim().slice(0, max);

async function submitFeedback({ userId, type, message, noteId, appVersion, device }) {
  const db = getDb();
  if (!TYPES.includes(type)) return { ok: false, status: 400, message: 'Choose what this is about' };
  const text = cleanMessage(message);
  if (text.length < MIN_LENGTH) return { ok: false, status: 400, message: `Please write a little more (at least ${MIN_LENGTH} characters)` };

  const id = toId(userId);
  const user = id ? await db.collection('users').findOne({ _id: id }) : null;
  if (!user) return { ok: false, status: 404, message: 'Account not found' };

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const sentToday = await db.collection('feedback').countDocuments({ userId: String(user._id), createdAt: { $gte: since } });
  if (sentToday >= DAILY_LIMIT) return { ok: false, status: 429, message: 'You have sent a lot of feedback today. Please try again tomorrow.' };

  let noteTitle = null;
  const noteOid = noteId ? toId(noteId) : null;
  if (noteOid) {
    const note = await db.collection('notes').findOne({ _id: noteOid }, { projection: { title: 1 } });
    noteTitle = note ? note.title : null;
  }

  await db.collection('feedback').insertOne({
    userId: String(user._id), name: user.name || '', phone: user.phone || '', classLevel: user.classLevel || null,
    type, message: text, noteId: noteTitle ? String(noteOid) : null, noteTitle,
    appVersion: cleanShort(appVersion, 20), device: cleanShort(device, 80),
    status: 'new', createdAt: new Date(),
  });
  return { ok: true };
}

const publicItem = (f) => ({
  id: String(f._id), name: f.name, phone: f.phone, classLevel: f.classLevel || null,
  type: f.type, message: f.message, noteTitle: f.noteTitle || null,
  appVersion: f.appVersion || '', device: f.device || '', status: f.status === 'done' ? 'done' : 'new', createdAt: f.createdAt || null,
});

async function listFeedback({ status, page, pageSize } = {}) {
  const size = Math.min(Math.max(parseInt(pageSize, 10) || 25, 1), 100);
  const current = Math.max(parseInt(page, 10) || 1, 1);
  const filter = {};
  if (status === 'new') filter.status = { $ne: 'done' };
  else if (status === 'done') filter.status = 'done';
  const col = getDb().collection('feedback');
  const total = await col.countDocuments(filter);
  const rows = await col.find(filter).sort({ createdAt: -1, _id: -1 }).skip((current - 1) * size).limit(size).toArray();
  return { total, page: current, pageSize: size, items: rows.map(publicItem) };
}

async function setFeedbackStatus(id, status) {
  if (status !== 'new' && status !== 'done') return { ok: false, status: 400, message: 'Unknown status' };
  const oid = toId(id);
  if (!oid) return { ok: false, status: 400, message: 'Invalid id' };
  await getDb().collection('feedback').updateOne({ _id: oid }, { $set: { status } });
  return { ok: true };
}

async function deleteFeedback(id) {
  const oid = toId(id);
  if (!oid) return { ok: false, status: 400, message: 'Invalid id' };
  await getDb().collection('feedback').deleteOne({ _id: oid });
  return { ok: true };
}

async function countNewFeedback() {
  return getDb().collection('feedback').countDocuments({ status: { $ne: 'done' } });
}

module.exports = { submitFeedback, listFeedback, setFeedbackStatus, deleteFeedback, countNewFeedback, TYPES, DAILY_LIMIT };
