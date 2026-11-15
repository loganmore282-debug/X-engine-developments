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
const { privacyPage, accountDeletionPage } = require('./legal');

const PORT = process.env.PORT || 4000;
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
const AI_DAILY_LIMIT = Number(process.env.AI_DAILY_LIMIT) || 20;
const MAX_PDF_BYTES = 50 * 1024 * 1024; // 50MB per note
const AI_HISTORY_TURNS = 8; // last N messages kept, each resent every question

fs.mkdirSync(path.join(UPLOAD_DIR, 'notes'), { recursive: true });

const app = express();
app.disable('x-powered-by');
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
  return { id: String(u._id), name: u.name || '', phone: u.phone || null, email: u.email || null };
}

// ── AUTH ──────────────────────────────────────────────────────────────────
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });

app.post('/auth/register', authLimiter, async (req, res) => {
  try {
    const name = String(req.body.name || '').trim().slice(0, 80);
    const phone = req.body.phone ? String(req.body.phone).trim().slice(0, 20) : null;
    const email = req.body.email ? String(req.body.email).trim().toLowerCase().slice(0, 120) : null;
    const password = String(req.body.password || '');
    if (!name) return res.status(400).json({ status: 'error', message: 'Name is required' });
    if (!phone && !email) return res.status(400).json({ status: 'error', message: 'A phone number or email is required' });
    if (password.length < 6) return res.status(400).json({ status: 'error', message: 'Password must be at least 6 characters' });

    const db = getDb();
    const doc = {
      name, phone, email, passwordHash: hashPassword(password),
      status: 'active', createdAt: new Date(),
    };
    let result;
    try {
      result = await db.collection('users').insertOne(doc);
    } catch (e) {
      if (e && e.code === 11000) return res.status(409).json({ status: 'error', message: 'An account with that phone or email already exists' });
      throw e;
    }
    const { token } = await createSession(String(result.insertedId));
    res.json({ status: 'success', token, user: publicUser({ _id: result.insertedId, name, phone, email }) });
  } catch (e) {
    console.error('register error:', e.message);
    res.status(500).json({ status: 'error', message: 'Could not create the account right now' });
  }
});

app.post('/auth/login', authLimiter, async (req, res) => {
  try {
    const identifier = String(req.body.identifier || req.body.phone || req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (!identifier || !password) return res.status(400).json({ status: 'error', message: 'Enter your phone/email and password' });

    const db = getDb();
    const user = await db.collection('users').findOne({ $or: [{ phone: identifier }, { email: identifier }] });
    // A dummy hash so a nonexistent account costs the same time as a wrong
    // password -- a login attempt must not reveal which account exists.
    const DUMMY = '0000000000000000000000000000000:0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000';
    const ok = verifyPassword(password, user ? user.passwordHash : DUMMY);
    if (!user || !ok) return res.status(401).json({ status: 'error', message: 'Incorrect phone/email or password' });
    if (user.status === 'banned') return res.status(403).json({ status: 'error', message: 'This account has been suspended' });

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
  // Sessions first: if a later step fails, the account still exists and the
  // member can retry, rather than being deleted but still signed in.
  await db.collection('sessions').deleteMany({ userId });
  await db.collection('aiUsage').deleteMany({ userId });
  await db.collection('users').deleteOne({ _id: user._id });
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
  res.json({ status: 'success', subjects: rows.map((s) => ({ id: String(s._id), name: s.name, classLevel: s.classLevel || null })) });
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
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(note.title || 'note')}.pdf"`);
  fs.createReadStream(filePath).pipe(res);
});

// ── AI: ask about the open document ────────────────────────────────────────
// A per-user, per-day cap enforced by a UNIQUE index on (userId,date) in
// Mongo -- an $inc past the cap is refused by re-reading the row, never
// trusted to in-process state (this process may not be the only one).
async function consumeAiQuota(userId) {
  const db = getDb();
  const date = todayKey();
  const row = await db.collection('aiUsage').findOneAndUpdate(
    { userId, date },
    { $inc: { count: 1 }, $setOnInsert: { userId, date } },
    { upsert: true, returnDocument: 'after' }
  );
  const count = row && row.value ? row.value.count : (row ? row.count : 1);
  return count <= AI_DAILY_LIMIT;
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

    const allowed = await consumeAiQuota(req.userId);
    if (!allowed) return res.status(429).json({ status: 'error', message: `You've reached today's limit of ${AI_DAILY_LIMIT} AI questions. Try again tomorrow.` });

    const result = await askAboutDocument({ documentText: note.extractedText, noteTitle: note.title, question, history });
    res.json({ status: 'success', answer: result.answer });
  } catch (e) {
    const { status, message } = classifyClaudeError(e);
    res.status(status).json({ status: 'error', message });
  }
});

// ── ADMIN ───────────────────────────────────────────────────────────────────
app.post('/admin/check-key', (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Wrong admin key' });
  res.json({ status: 'success' });
});

app.post('/admin/subjects/save', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const name = String(req.body.name || '').trim().slice(0, 100);
  if (!name) return res.status(400).json({ status: 'error', message: 'Name is required' });
  const doc = { name, classLevel: req.body.classLevel ? String(req.body.classLevel).trim().slice(0, 40) : null, order: Number(req.body.order) || 0 };
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
  res.json({ status: 'success', subjects: rows.map((s) => ({ id: String(s._id), name: s.name, classLevel: s.classLevel, order: s.order })) });
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
      subjectId, classLevel: req.body.classLevel ? String(req.body.classLevel).trim().slice(0, 40) : null,
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
  res.json({ status: 'success', notes: rows.map((n) => ({ ...publicNote(n), active: n.active !== false })) });
});

app.post('/admin/notes/update', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const patch = {};
  if (req.body.title !== undefined) patch.title = String(req.body.title).trim().slice(0, 150);
  if (req.body.description !== undefined) patch.description = String(req.body.description).trim().slice(0, 1000);
  if (req.body.active !== undefined) patch.active = !!req.body.active;
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

const LEGAL = {
  appName: process.env.APP_NAME || 'Shule Notes',
  supportEmail: process.env.SUPPORT_EMAIL || '',
  updated: process.env.PRIVACY_UPDATED || '15 November 2026',
};
app.get('/privacy', (req, res) => res.type('html').send(privacyPage(LEGAL)));
app.get('/account-deletion', (req, res) => res.type('html').send(accountDeletionPage(LEGAL)));

app.get('/health', (req, res) => res.json({ status: 'success', time: new Date().toISOString() }));

async function start() {
  await connect();
  app.listen(PORT, () => console.log(`Shule Notes server listening on :${PORT}`));
}

if (require.main === module) {
  start().catch((e) => { console.error('Failed to start:', e); process.exit(1); });
}

module.exports = { app, todayKey, publicUser, publicNote, consumeAiQuota, deleteAccount, AI_DAILY_LIMIT };
