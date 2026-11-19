'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const multer = require('multer');
const { ObjectId } = require('mongodb');

const { connect, getDb } = require('./db');
const { hashPassword, verifyPassword, createSession, resolveSession, destroySession, bearerToken, requireAuth } = require('./auth');
const { verifyAdmin } = require('./admin-auth');
const { extractPdfText } = require('./pdf');
const { askAboutDocument, classifyClaudeError } = require('./claude');
const { privacyPage, accountDeletionPage, termsPage } = require('./legal');
const { GROUPS: LEVEL_GROUPS, isValidLevel } = require('./levels');
const { normalizePhone, isValidPhone } = require('./phone');
const { eraseUser, changePassword, updateProfile, cleanName } = require('./accounts');
const { getSettings, saveSettings, publicConfig } = require('./settings');
const adminData = require('./admin-data');

const PORT = process.env.PORT || 4000;
// 127.0.0.1 in production (nginx is the only way in); 0.0.0.0 by default so the emulator can reach a dev server.
const HOST = process.env.HOST || '0.0.0.0';
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
const AI_DAILY_LIMIT = Number(process.env.AI_DAILY_LIMIT) || 20;
const MAX_PDF_BYTES = 50 * 1024 * 1024; // 50MB per note
const AI_HISTORY_TURNS = 8; // last N messages kept, each resent every question

fs.mkdirSync(path.join(UPLOAD_DIR, 'notes'), { recursive: true });

const app = express();
app.disable('x-powered-by');
// Behind nginx every request arrives from 127.0.0.1; trusting the proxy's
// X-Forwarded-For is what makes the rate limits count each student separately
// instead of all students together. Set TRUST_PROXY=0 if the server is ever
// exposed directly with no proxy in front (the header could then be forged).
const TRUST_PROXY = process.env.TRUST_PROXY === undefined ? 1 : Number(process.env.TRUST_PROXY);
if (TRUST_PROXY > 0) app.set('trust proxy', TRUST_PROXY);
app.use(helmet());
app.use(cors({
  origin: (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
}));
app.use(express.json({ limit: '256kb' }));
app.use(mongoSanitize());

app.use(rateLimit({ windowMs: 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false }));

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function publicUser(u) {
  return { id: String(u._id), name: u.name || '', phone: u.phone || null, classLevel: u.classLevel || null };
}

// ── AUTH ──────────────────────────────────────────────────────────────────
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });

app.post('/auth/register', authLimiter, async (req, res) => {
  try {
    const name = cleanName(req.body.name);
    const phone = normalizePhone(req.body.phone);
    const password = String(req.body.password || '');
    if (!name) return res.status(400).json({ status: 'error', message: 'Name is required' });
    if (!isValidPhone(phone)) return res.status(400).json({ status: 'error', message: 'Enter a valid phone number' });
    if (password.length < 6) return res.status(400).json({ status: 'error', message: 'Password must be at least 6 characters' });

    const db = getDb();
    const doc = {
      name, phone, passwordHash: hashPassword(password),
      status: 'active', createdAt: new Date(), lastLoginAt: new Date(),
    };
    let result;
    try {
      result = await db.collection('users').insertOne(doc);
    } catch (e) {
      if (e && e.code === 11000) return res.status(409).json({ status: 'error', message: 'An account with that phone number already exists. Sign in instead.' });
      throw e;
    }
    const { token } = await createSession(String(result.insertedId));
    res.json({ status: 'success', token, user: publicUser({ _id: result.insertedId, name, phone }) });
  } catch (e) {
    console.error('register error:', e.message);
    res.status(500).json({ status: 'error', message: 'Could not create the account right now' });
  }
});

app.post('/auth/login', authLimiter, async (req, res) => {
  try {
    const phone = normalizePhone(req.body.phone);
    const password = String(req.body.password || '');
    if (!phone || !password) return res.status(400).json({ status: 'error', message: 'Enter your phone number and password' });

    const db = getDb();
    const user = await db.collection('users').findOne({ phone });
    // A dummy hash so a nonexistent account costs the same time as a wrong
    // password -- a login attempt must not reveal which account exists.
    const DUMMY = '0000000000000000000000000000000:0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000';
    const ok = verifyPassword(password, user ? user.passwordHash : DUMMY);
    if (!user || !ok) return res.status(401).json({ status: 'error', message: 'Incorrect phone number or password' });
    if (user.status === 'banned') return res.status(403).json({ status: 'error', message: 'This account has been suspended' });

    await db.collection('users').updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } });
    const { token } = await createSession(String(user._id));
    res.json({ status: 'success', token, user: publicUser(user) });
  } catch (e) {
    console.error('login error:', e.message);
    res.status(500).json({ status: 'error', message: 'Could not sign in right now' });
  }
});

app.post('/auth/logout', requireAuth, async (req, res) => {
  await destroySession(bearerToken(req));
  res.json({ status: 'success' });
});

// A rejected async handler must answer, not leave the request hanging.
const ah = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  console.error(req.method, req.path, 'failed:', e.message);
  if (!res.headersSent) res.status(500).json({ status: 'error', message: 'Something went wrong on the server' });
});
const sendResult = (res, result, extra = {}) => (result.ok
  ? res.json({ status: 'success', ...extra })
  : res.status(result.status || 400).json({ status: 'error', message: result.message }));

// Contacts and switches the app and the sign-in screen need before anyone is signed in.
app.get('/config', ah(async (req, res) => res.json({ status: 'success', config: publicConfig(await getSettings()) })));

app.get('/announcement', requireAuth, ah(async (req, res) => res.json({ status: 'success', announcement: await adminData.activeAnnouncement() })));

app.post('/auth/change-password', authLimiter, requireAuth, ah(async (req, res) => {
  const result = await changePassword(req.userId, req.body.currentPassword, req.body.newPassword, bearerToken(req));
  sendResult(res, result);
}));

app.post('/auth/update-profile', requireAuth, ah(async (req, res) => {
  const result = await updateProfile(req.userId, req.body.name);
  sendResult(res, result, result.ok ? { user: publicUser(result.user) } : {});
}));

app.get('/levels', (req, res) => res.json({ status: 'success', groups: LEVEL_GROUPS }));

app.post('/auth/class-level', requireAuth, async (req, res) => {
  try {
    const result = await setClassLevel(req.userId, req.body.classLevel);
    if (!result.ok) return res.status(result.status).json({ status: 'error', message: result.message });
    res.json({ status: 'success', user: publicUser(result.user) });
  } catch (e) {
    console.error('class-level error:', e.message);
    res.status(500).json({ status: 'error', message: 'Could not save your class right now' });
  }
});

async function setClassLevel(userId, classLevel) {
  if (!isValidLevel(classLevel)) return { ok: false, status: 400, message: 'Choose your class from the list' };
  const db = getDb();
  let id;
  try { id = new ObjectId(userId); } catch (_) { return { ok: false, status: 404, message: 'Account not found' }; }
  const user = await db.collection('users').findOne({ _id: id });
  if (!user) return { ok: false, status: 404, message: 'Account not found' };
  await db.collection('users').updateOne({ _id: id }, { $set: { classLevel } });
  return { ok: true, user: { ...user, classLevel } };
}

// Google Play requires in-app account deletion for any app with sign-up.
app.post('/auth/delete-account', authLimiter, requireAuth, async (req, res) => {
  try {
    const result = await deleteAccount(req.userId, String(req.body.password || ''));
    if (!result.ok) return res.status(result.status).json({ status: 'error', message: result.message });
    res.json({ status: 'success' });
  } catch (e) {
    console.error('delete-account error:', e.message);
    res.status(500).json({ status: 'error', message: 'Could not delete the account right now' });
  }
});

async function deleteAccount(userId, password) {
  const db = getDb();
  let user = null;
  try { user = await db.collection('users').findOne({ _id: new ObjectId(userId) }); } catch (_) { user = null; }
  if (!user) return { ok: false, status: 404, message: 'Account not found' };
  // 403, not 401: the app treats 401 as "your session expired" and signs out.
  if (!verifyPassword(password, user.passwordHash)) return { ok: false, status: 403, message: 'Incorrect password' };
  await eraseUser(userId);
  return { ok: true };
}

app.get('/auth/me', requireAuth, async (req, res) => {
  const user = await getDb().collection('users').findOne({ _id: new ObjectId(req.userId) });
  if (!user) return res.status(404).json({ status: 'error', message: 'Account not found' });
  res.json({ status: 'success', user: publicUser(user) });
});

// ── SUBJECTS & NOTES (student-facing, read-only) ───────────────────────────
app.get('/subjects', requireAuth, async (req, res) => {
  const rows = await getDb().collection('subjects').find({}).sort({ order: 1 }).toArray();
  res.json({ status: 'success', subjects: rows.map((s) => ({ id: String(s._id), name: s.name })) });
});

function publicNote(n) {
  return {
    id: String(n._id), subjectId: n.subjectId ? String(n.subjectId) : null,
    title: n.title, description: n.description || '', classLevel: n.classLevel || null,
    pageCount: n.pageCount || 0, fileSize: n.fileSize || 0, uploadedAt: n.uploadedAt,
    hasAiContext: !!(n.extractedText && n.extractedText.length > 0),
  };
}

app.get('/notes', requireAuth, async (req, res) => {
  const q = { active: { $ne: false } };
  if (req.query.subjectId) {
    try { q.subjectId = new ObjectId(String(req.query.subjectId)); }
    catch (_) { return res.status(400).json({ status: 'error', message: 'Invalid subjectId' }); }
  }
  const rows = await getDb().collection('notes').find(q).sort({ uploadedAt: -1 }).limit(500).toArray();
  res.json({ status: 'success', notes: rows.map(publicNote) });
});

app.get('/notes/:id', requireAuth, async (req, res) => {
  let note;
  try { note = await getDb().collection('notes').findOne({ _id: new ObjectId(req.params.id) }); }
  catch (_) { return res.status(400).json({ status: 'error', message: 'Invalid note id' }); }
  if (!note || note.active === false) return res.status(404).json({ status: 'error', message: 'Note not found' });
  res.json({ status: 'success', note: publicNote(note) });
});

app.get('/notes/:id/file', requireAuth, async (req, res) => {
  let note;
  try { note = await getDb().collection('notes').findOne({ _id: new ObjectId(req.params.id) }); }
  catch (_) { return res.status(400).json({ status: 'error', message: 'Invalid note id' }); }
  if (!note || note.active === false) return res.status(404).json({ status: 'error', message: 'Note not found' });
  const filePath = path.join(UPLOAD_DIR, 'notes', note.fileName);
  if (!fs.existsSync(filePath)) return res.status(404).json({ status: 'error', message: 'File missing on server' });
  // Counted when the file is opened, so the admin can see what students read.
  getDb().collection('notes').updateOne({ _id: note._id }, { $inc: { views: 1 } }).catch(() => {});
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(note.title || 'note')}.pdf"`);
  fs.createReadStream(filePath).pipe(res);
});

// ── AI: ask about the open document ────────────────────────────────────────
// A per-user, per-day cap enforced by a UNIQUE index on (userId,date) in
// Mongo -- an $inc past the cap is refused by re-reading the row, never
// trusted to in-process state (this process may not be the only one).
async function consumeAiQuota(userId, limit = AI_DAILY_LIMIT) {
  const db = getDb();
  const date = todayKey();
  const row = await db.collection('aiUsage').findOneAndUpdate(
    { userId, date },
    { $inc: { count: 1 }, $setOnInsert: { userId, date } },
    { upsert: true, returnDocument: 'after' }
  );
  const count = row && row.value ? row.value.count : (row ? row.count : 1);
  return count <= limit;
}

const aiLimiter = rateLimit({ windowMs: 60 * 1000, max: 15, standardHeaders: true, legacyHeaders: false });

app.post('/ai/ask', requireAuth, aiLimiter, async (req, res) => {
  try {
    const noteId = String(req.body.noteId || '');
    const question = String(req.body.question || '').trim();
    const history = Array.isArray(req.body.history) ? req.body.history.slice(-AI_HISTORY_TURNS) : [];
    if (!question) return res.status(400).json({ status: 'error', message: 'Type a question first' });

    let note;
    try { note = await getDb().collection('notes').findOne({ _id: new ObjectId(noteId) }); }
    catch (_) { return res.status(400).json({ status: 'error', message: 'Invalid noteId' }); }
    if (!note || note.active === false) return res.status(404).json({ status: 'error', message: 'Note not found' });
    if (!note.extractedText) {
      return res.status(400).json({ status: 'error', message: 'This document has no readable text (it is likely a scanned image), so the AI helper cannot read it.' });
    }

    const settings = await getSettings();
    if (settings.aiEnabled === false) return res.status(503).json({ status: 'error', message: 'The AI helper is switched off for now. Please try again later.' });
    const limit = settings.aiDailyLimit || AI_DAILY_LIMIT;
    const allowed = await consumeAiQuota(req.userId, limit);
    if (!allowed) return res.status(429).json({ status: 'error', message: `You've reached today's limit of ${limit} AI questions. Try again tomorrow.` });

    const result = await askAboutDocument({ documentText: note.extractedText, noteTitle: note.title, question, history });
    res.json({ status: 'success', answer: result.answer });
  } catch (e) {
    const { status, message } = classifyClaudeError(e);
    res.status(status).json({ status: 'error', message });
  }
});

// ── ADMIN ───────────────────────────────────────────────────────────────────
// Guessing the admin key is the one thing worth slowing down hard.
const adminKeyLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });
const adminLimiter = rateLimit({ windowMs: 60 * 1000, max: 200, standardHeaders: true, legacyHeaders: false });
app.use('/admin', adminLimiter);

app.post('/admin/check-key', adminKeyLimiter, (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Wrong admin key' });
  res.json({ status: 'success' });
});

app.post('/admin/subjects/save', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const name = String(req.body.name || '').trim().slice(0, 100);
  if (!name) return res.status(400).json({ status: 'error', message: 'Name is required' });
  const doc = { name, order: Number(req.body.order) || 0 };
  if (req.body.id) {
    try { await getDb().collection('subjects').updateOne({ _id: new ObjectId(req.body.id) }, { $set: doc }); }
    catch (_) { return res.status(400).json({ status: 'error', message: 'Invalid id' }); }
  } else {
    await getDb().collection('subjects').insertOne(doc);
  }
  res.json({ status: 'success' });
});

app.post('/admin/subjects/list', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const rows = await getDb().collection('subjects').find({}).sort({ order: 1 }).toArray();
  res.json({ status: 'success', subjects: rows.map((s) => ({ id: String(s._id), name: s.name, order: s.order })) });
});

app.post('/admin/subjects/delete', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try { await getDb().collection('subjects').deleteOne({ _id: new ObjectId(req.body.id) }); }
  catch (_) { return res.status(400).json({ status: 'error', message: 'Invalid id' }); }
  res.json({ status: 'success' });
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PDF_BYTES },
});

app.post('/admin/notes/upload', upload.single('file'), async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const title = String(req.body.title || '').trim().slice(0, 150);
    if (!title) return res.status(400).json({ status: 'error', message: 'Title is required' });
    if (!req.file) return res.status(400).json({ status: 'error', message: 'A PDF file is required' });
    if (req.file.mimetype !== 'application/pdf') return res.status(400).json({ status: 'error', message: 'Only PDF files are accepted' });

    const classLevel = req.body.classLevel ? String(req.body.classLevel).trim() : null;
    if (classLevel && !isValidLevel(classLevel)) return res.status(400).json({ status: 'error', message: 'Choose a class from the list' });

    let subjectId = null;
    if (req.body.subjectId) {
      try { subjectId = new ObjectId(String(req.body.subjectId)); }
      catch (_) { return res.status(400).json({ status: 'error', message: 'Invalid subjectId' }); }
    }

    const fileName = crypto.randomUUID() + '.pdf';
    const filePath = path.join(UPLOAD_DIR, 'notes', fileName);
    fs.writeFileSync(filePath, req.file.buffer);

    let extracted = { text: '', pageCount: 0 };
    try { extracted = await extractPdfText(req.file.buffer); }
    catch (e) { console.error('PDF text extraction failed for', title, ':', e.message); }

    const doc = {
      title, description: String(req.body.description || '').trim().slice(0, 1000),
      subjectId, classLevel,
      fileName, fileSize: req.file.size, pageCount: extracted.pageCount,
      extractedText: extracted.text, active: true, uploadedAt: new Date(),
    };
    const result = await getDb().collection('notes').insertOne(doc);
    res.json({
      status: 'success', id: String(result.insertedId),
      warning: extracted.text ? null : 'No text could be read from this PDF. It may be a scanned image. The AI helper will not work for this note.',
    });
  } catch (e) {
    console.error('note upload error:', e.message);
    res.status(500).json({ status: 'error', message: 'Could not upload the note' });
  }
});

app.post('/admin/notes/list', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const rows = await getDb().collection('notes').find({}).sort({ uploadedAt: -1 }).limit(1000).toArray();
  res.json({ status: 'success', notes: rows.map((n) => ({ ...publicNote(n), active: n.active !== false, views: n.views || 0 })) });
});

app.post('/admin/notes/update', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const patch = {};
  if (req.body.title !== undefined) patch.title = String(req.body.title).trim().slice(0, 150);
  if (req.body.description !== undefined) patch.description = String(req.body.description).trim().slice(0, 1000);
  if (req.body.active !== undefined) patch.active = !!req.body.active;
  if (req.body.classLevel !== undefined) {
    const level = String(req.body.classLevel || '').trim();
    if (level && !isValidLevel(level)) return res.status(400).json({ status: 'error', message: 'Choose a class from the list' });
    patch.classLevel = level || null;
  }
  if (req.body.subjectId !== undefined) {
    try { patch.subjectId = req.body.subjectId ? new ObjectId(String(req.body.subjectId)) : null; }
    catch (_) { return res.status(400).json({ status: 'error', message: 'Invalid subjectId' }); }
  }
  try { await getDb().collection('notes').updateOne({ _id: new ObjectId(req.body.id) }, { $set: patch }); }
  catch (_) { return res.status(400).json({ status: 'error', message: 'Invalid id' }); }
  res.json({ status: 'success' });
});

app.post('/admin/notes/delete', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  let note;
  try { note = await getDb().collection('notes').findOne({ _id: new ObjectId(req.body.id) }); }
  catch (_) { return res.status(400).json({ status: 'error', message: 'Invalid id' }); }
  if (note) {
    const filePath = path.join(UPLOAD_DIR, 'notes', note.fileName);
    fs.unlink(filePath, () => {});
    await getDb().collection('notes').deleteOne({ _id: note._id });
  }
  res.json({ status: 'success' });
});

// The admin panel's students, dashboard, announcements and settings.
const guard = (fn) => ah(async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  return fn(req, res);
});
app.post('/admin/stats', guard(async (req, res) => res.json({ status: 'success', stats: await adminData.dashboardStats() })));
app.post('/admin/users/list', guard(async (req, res) => res.json({ status: 'success', ...(await adminData.listUsers(req.body)) })));
app.post('/admin/users/status', guard(async (req, res) => sendResult(res, await adminData.setUserStatus(req.body.id, req.body.status))));
app.post('/admin/users/reset-password', guard(async (req, res) => sendResult(res, await adminData.resetUserPassword(req.body.id, req.body.password))));
app.post('/admin/users/delete', guard(async (req, res) => sendResult(res, await adminData.adminDeleteUser(req.body.id))));
app.post('/admin/announcements/list', guard(async (req, res) => res.json({ status: 'success', announcements: await adminData.listAnnouncements() })));
app.post('/admin/announcements/save', guard(async (req, res) => sendResult(res, await adminData.saveAnnouncement(req.body))));
app.post('/admin/announcements/delete', guard(async (req, res) => sendResult(res, await adminData.deleteAnnouncement(req.body.id))));
app.post('/admin/settings/get', guard(async (req, res) => res.json({ status: 'success', settings: await getSettings(), defaultAiDailyLimit: AI_DAILY_LIMIT })));
app.post('/admin/settings/save', guard(async (req, res) => {
  const result = await saveSettings(req.body);
  sendResult(res, result, result.ok ? { settings: result.settings } : {});
}));

const LEGAL = {
  appName: process.env.APP_NAME || 'Shule Notes',
  supportEmail: process.env.SUPPORT_EMAIL || '',
  updated: process.env.PRIVACY_UPDATED || '15 November 2026',
};
app.get('/privacy', (req, res) => res.type('html').send(privacyPage(LEGAL)));
app.get('/terms', (req, res) => res.type('html').send(termsPage(LEGAL)));
app.get('/account-deletion', (req, res) => res.type('html').send(accountDeletionPage(LEGAL)));

app.get('/health', (req, res) => res.json({ status: 'success', time: new Date().toISOString() }));

async function start() {
  await connect();
  app.listen(PORT, HOST, () => console.log(`Shule Notes server listening on ${HOST}:${PORT}`));
}

if (require.main === module) {
  start().catch((e) => { console.error('Failed to start:', e); process.exit(1); });
}

module.exports = { app, todayKey, normalizePhone, isValidPhone, publicUser, publicNote, consumeAiQuota, deleteAccount, setClassLevel, AI_DAILY_LIMIT };
