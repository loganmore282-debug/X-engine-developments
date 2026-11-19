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
const { extractInThread } = require('./pdf');
const { pageTextsFor } = require('./note-pages');
const feedback = require('./feedback');
const { publishedVersion } = require('./app-version');
const { sendPush } = require('./push');
const media = require('./media');
const revision = require('./revision');
const loginGuard = require('./login-guard');
const stamp = require('./stamp');
const onboarding = require('./onboarding');
const { askAboutDocument, classifyClaudeError } = require('./claude');
const { privacyPage, accountDeletionPage, termsPage } = require('./legal');
const { GROUPS: LEVEL_GROUPS, isValidLevel } = require('./levels');
const { normalizePhone, isValidPhone } = require('./phone');
const { eraseUser, changePassword, updateProfile, cleanName, toId } = require('./accounts');
const { getSettings, saveSettings, publicConfig, adminView, AI_MODELS } = require('./settings');
const adminData = require('./admin-data');

// More threads for background work (password hashing, file reads); must be set before first use.
if (!process.env.UV_THREADPOOL_SIZE) process.env.UV_THREADPOOL_SIZE = '8';
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
  return { id: String(u._id), name: u.name || '', phone: u.phone || null, classLevel: u.classLevel || null, avatarVersion: u.avatarVersion || 0 };
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
      name, phone, passwordHash: await hashPassword(password),
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
    // Too many wrong passwords for this number lately (from anywhere): wait, whoever is typing.
    if (loginGuard.isLocked(phone)) {
      return res.status(429).json({ status: 'error', message: `Too many wrong passwords. Try again in ${loginGuard.minutesLeft(phone)} minutes, or ask support to reset it.` });
    }

    const db = getDb();
    const user = await db.collection('users').findOne({ phone });
    // A dummy hash so a nonexistent account costs the same time as a wrong
    // password -- a login attempt must not reveal which account exists.
    const DUMMY = '0000000000000000000000000000000:0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000';
    const ok = await verifyPassword(password, user ? user.passwordHash : DUMMY);
    if (!user || !ok) {
      loginGuard.recordFailure(phone);
      return res.status(401).json({ status: 'error', message: 'Incorrect phone number or password' });
    }
    loginGuard.clear(phone);
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

// What phones poll (every few seconds while the app is open): a tiny answer that changes whenever the admin does.
app.get('/sync', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ status: 'success', revision: revision.current() });
});
app.use('/admin', revision.adminChangeTracker);

// Contacts and switches the app and the sign-in screen need before anyone is signed in.
app.get('/config', ah(async (req, res) => {
  const config = publicConfig(await getSettings());
  // Nothing typed in the panel: use the newest build the download page is serving.
  if (!config.latestVersion) config.latestVersion = publishedVersion();
  res.json({ status: 'success', config });
}));

// The introduction slides: public, because they are shown before anyone has an account.
app.get('/onboarding', ah(async (req, res) => {
  res.set('Cache-Control', 'public, max-age=60');
  res.json({ status: 'success', ...(await onboarding.publicSlides()) });
}));
app.get('/onboarding/:id/image', ah(async (req, res) => {
  const file = media.filePath('onboarding', req.params.id);
  const slide = file ? await getDb().collection('slides').findOne({ _id: new ObjectId(req.params.id) }) : null;
  if (!slide || !slide.imageType || !fs.existsSync(file)) return res.status(404).end();
  res.set('Content-Type', slide.imageType);
  res.set('Cross-Origin-Resource-Policy', 'cross-origin'); // the admin panel, on its own address, shows these
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.sendFile(file);
}));

app.post('/feedback', requireAuth, rateLimit({ windowMs: 60 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false }), ah(async (req, res) => {
  const result = await feedback.submitFeedback({
    userId: req.userId, type: req.body.type, message: req.body.message, noteId: req.body.noteId,
    appVersion: req.body.appVersion, device: req.body.device,
  });
  sendResult(res, result);
}));

app.get('/announcements', requireAuth, ah(async (req, res) => {
  const user = await getDb().collection('users').findOne({ _id: toId(req.userId) });
  res.json({ status: 'success', announcements: await adminData.listActiveAnnouncements(user ? user.classLevel : null) });
}));
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
  if (!(await verifyPassword(password, user.passwordHash))) return { ok: false, status: 403, message: 'Incorrect password' };
  await eraseUser(userId);
  return { ok: true };
}

// A student's own profile photo. The phone shrinks it first; the server still checks what it is.
const avatarUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: media.MAX_AVATAR_BYTES, files: 1 } });
app.post('/auth/avatar', requireAuth, rateLimit({ windowMs: 60 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false }),
  (req, res, next) => avatarUpload.single('photo')(req, res, (err) => (err
    ? res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ status: 'error', message: err.code === 'LIMIT_FILE_SIZE' ? 'That picture is too large' : 'Could not read the picture' })
    : next())),
  ah(async (req, res) => {
    if (!req.file) return res.status(400).json({ status: 'error', message: 'Choose a picture' });
    const result = await media.setAvatar(req.userId, req.file.buffer);
    sendResult(res, result, result.ok ? { user: publicUser(result.user) } : {});
  }));
app.post('/auth/avatar/remove', requireAuth, ah(async (req, res) => {
  const result = await media.removeAvatar(req.userId);
  sendResult(res, result, result.ok ? { user: publicUser(result.user) } : {});
}));
app.get('/auth/avatar', requireAuth, ah(async (req, res) => {
  const id = (() => { try { return new ObjectId(req.userId); } catch (_) { return null; } })();
  const user = id ? await getDb().collection('users').findOne({ _id: id }) : null;
  const file = user && user.avatarVersion ? media.filePath('avatars', id) : null;
  if (!file || !fs.existsSync(file)) return res.status(404).json({ status: 'error', message: 'No photo' });
  res.set('Content-Type', user.avatarType || 'image/jpeg');
  res.set('Cache-Control', 'private, max-age=31536000, immutable'); // the address carries the version
  res.sendFile(file);
}));

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

// What kind of document it is: ordinary notes, or a past paper.
const NOTE_KINDS = ['notes', 'past-paper'];
const cleanKind = (value) => (NOTE_KINDS.includes(String(value || '').trim()) ? String(value).trim() : null);

function publicNote(n) {
  return {
    id: String(n._id), subjectId: n.subjectId ? String(n.subjectId) : null,
    title: n.title, description: n.description || '', classLevel: n.classLevel || null,
    kind: NOTE_KINDS.includes(n.kind) ? n.kind : 'notes',
    views: n.views || 0,
    pageCount: n.pageCount || 0, fileSize: n.fileSize || 0, uploadedAt: n.uploadedAt,
    hasAiContext: !!(n.extractedText && n.extractedText.length > 0),
  };
}

app.get('/notes', requireAuth, async (req, res) => {
  // A note still being read after upload (a few seconds) is not shown yet.
  const q = { active: { $ne: false }, textStatus: { $ne: 'reading' } };
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

// The text of every page, so the app can search inside a document and jump to the page.
app.get('/notes/:id/pages', requireAuth, ah(async (req, res) => {
  let note;
  try { note = await getDb().collection('notes').findOne({ _id: new ObjectId(req.params.id) }); }
  catch (_) { return res.status(400).json({ status: 'error', message: 'Invalid note id' }); }
  if (!note || note.active === false) return res.status(404).json({ status: 'error', message: 'Note not found' });
  if (note.textStatus === 'reading') return res.status(409).json({ status: 'error', message: 'This document is still being prepared. Try again in a moment.' });
  let pages = [];
  try { pages = await pageTextsFor({ db: getDb(), note, uploadDir: UPLOAD_DIR, extract: extractInThread }); }
  catch (e) { console.error('could not read the pages of', note.title, ':', e.message); }
  // A note's text never changes, so a phone may keep this answer.
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.json({ status: 'success', pages });
}));

app.get('/notes/:id/file', requireAuth, async (req, res) => {
  let note;
  try { note = await getDb().collection('notes').findOne({ _id: new ObjectId(req.params.id) }); }
  catch (_) { return res.status(400).json({ status: 'error', message: 'Invalid note id' }); }
  if (!note || note.active === false) return res.status(404).json({ status: 'error', message: 'Note not found' });
  if (!fs.existsSync(path.join(UPLOAD_DIR, 'notes', note.fileName))) return res.status(404).json({ status: 'error', message: 'File missing on server' });
  // Counted when the file is opened, so the admin can see what students read.
  getDb().collection('notes').updateOne({ _id: note._id }, { $inc: { views: 1 } }).catch(() => {});
  // Every page carries a footer (where it came from, how to reach the owner), unless the owner turned that off.
  const settings = await getSettings();
  const lines = stamp.footerLines(settings, `${req.protocol}://${req.get('host')}/download/`);
  const { file: filePath } = await stamp.fileToSend({ uploadDir: UPLOAD_DIR, fileName: note.fileName, lines, enabled: settings.pdfStamp !== false });
  const { size, mtime } = await fs.promises.stat(filePath);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Length', size);
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(note.title || 'note')}.pdf"`);
  // The footer follows the owner's contact details, so the file is checked again rather than kept forever.
  res.setHeader('Cache-Control', 'private, no-cache');
  res.setHeader('Last-Modified', mtime.toUTCString());
  require('stream').pipeline(fs.createReadStream(filePath), res, () => {});
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
    if (note.textStatus === 'reading') {
      return res.status(409).json({ status: 'error', message: 'This document is still being prepared. Try again in a moment.' });
    }
    if (!note.extractedText) {
      return res.status(400).json({ status: 'error', message: 'This document has no readable text (it is likely a scanned image), so the AI helper cannot read it.' });
    }

    const settings = await getSettings();
    if (settings.aiEnabled === false) return res.status(503).json({ status: 'error', message: 'The AI helper is switched off for now. Please try again later.' });
    const limit = settings.aiDailyLimit || AI_DAILY_LIMIT;
    const allowed = await consumeAiQuota(req.userId, limit);
    if (!allowed) return res.status(429).json({ status: 'error', message: `You've reached today's limit of ${limit} AI questions. Try again tomorrow.` });

    const result = await askAboutDocument({ documentText: note.extractedText, noteTitle: note.title, question, history, apiKey: settings.anthropicKey, model: settings.aiModel || undefined });
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
// Wrong admin keys on ANY admin route count (not only the sign-in check): 30 per 15 minutes, then locked out.
// Requests with the right key never count, so normal use cannot trip it.
app.use('/admin', rateLimit({
  windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false,
  skipSuccessfulRequests: true, requestWasSuccessful: (req, res) => res.statusCode !== 401,
}));

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

// Background half of an upload: read the PDF's text on a worker thread, then publish the note.
function finishReading(noteId, buffer, title) {
  extractInThread(buffer).then(
    (r) => getDb().collection('notes').updateOne({ _id: noteId }, { $set: { extractedText: r.text, pageTexts: r.pages, pageCount: r.pageCount, textStatus: r.text ? 'ready' : 'none' } }),
    (e) => { console.error('PDF text extraction failed for', title, ':', e.message); return getDb().collection('notes').updateOne({ _id: noteId }, { $set: { textStatus: 'failed' } }); },
  ).then(() => revision.bump()).catch((e) => console.error('could not save the extracted text for', title, ':', e.message));
}

app.post('/admin/notes/upload', upload.single('file'), async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    const title = String(req.body.title || '').trim().slice(0, 150);
    if (!title) return res.status(400).json({ status: 'error', message: 'Title is required' });
    if (!req.file) return res.status(400).json({ status: 'error', message: 'A PDF file is required' });
    // The declared type is only the sender's word: a real PDF starts with "%PDF-" near the top of the file.
    if (req.file.mimetype !== 'application/pdf' || req.file.buffer.subarray(0, 1024).indexOf('%PDF-') < 0) return res.status(400).json({ status: 'error', message: 'Only PDF files are accepted' });

    const classLevel = req.body.classLevel ? String(req.body.classLevel).trim() : null;
    if (classLevel && !isValidLevel(classLevel)) return res.status(400).json({ status: 'error', message: 'Choose a class from the list' });

    const kind = req.body.kind ? cleanKind(req.body.kind) : 'notes';
    if (!kind) return res.status(400).json({ status: 'error', message: 'Choose Notes or Past paper' });

    let subjectId = null;
    if (req.body.subjectId) {
      try { subjectId = new ObjectId(String(req.body.subjectId)); }
      catch (_) { return res.status(400).json({ status: 'error', message: 'Invalid subjectId' }); }
    }

    const fileName = crypto.randomUUID() + '.pdf';
    const filePath = path.join(UPLOAD_DIR, 'notes', fileName);
    await fs.promises.writeFile(filePath, req.file.buffer);

    // The admin gets their answer as soon as the file is saved. Reading the text (for the
    // AI helper and the page count) takes a few seconds, so it finishes in the background;
    // until then the note is held back from students ("reading").
    const doc = {
      title, description: String(req.body.description || '').trim().slice(0, 1000),
      subjectId, classLevel, kind,
      fileName, fileSize: req.file.size, pageCount: 0,
      extractedText: '', textStatus: 'reading', active: true, uploadedAt: new Date(),
    };
    const result = await getDb().collection('notes').insertOne(doc);
    finishReading(result.insertedId, req.file.buffer, title);
    res.json({ status: 'success', id: String(result.insertedId), reading: true });
  } catch (e) {
    console.error('note upload error:', e.message);
    res.status(500).json({ status: 'error', message: 'Could not upload the note' });
  }
});

app.post('/admin/notes/list', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const rows = await getDb().collection('notes').find({}).sort({ uploadedAt: -1 }).limit(1000).toArray();
  res.json({ status: 'success', notes: rows.map((n) => ({ ...publicNote(n), active: n.active !== false, views: n.views || 0, textStatus: n.textStatus || (n.extractedText ? 'ready' : 'none') })) });
});

app.post('/admin/notes/update', async (req, res) => {
  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  const patch = {};
  if (req.body.title !== undefined) patch.title = String(req.body.title).trim().slice(0, 150);
  if (req.body.description !== undefined) patch.description = String(req.body.description).trim().slice(0, 1000);
  if (req.body.active !== undefined) patch.active = !!req.body.active;
  if (req.body.kind !== undefined) {
    const kind = cleanKind(req.body.kind);
    if (!kind) return res.status(400).json({ status: 'error', message: 'Choose Notes or Past paper' });
    patch.kind = kind;
  }
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
    stamp.removeStamped(UPLOAD_DIR, note.fileName);
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
app.post('/admin/announcements/save', guard(async (req, res) => {
  const result = await adminData.saveAnnouncement(req.body);
  if (!result.ok) return sendResult(res, result);
  // A NEW announcement can also be pushed to phones. A push that fails never loses the announcement.
  let push = null;
  if (req.body.push && !req.body.id && req.body.active !== false) {
    const settings = await getSettings();
    push = await sendPush({
      account: settings.firebaseServiceAccount, title: req.body.title, body: req.body.message,
      classLevel: req.body.classLevel || null, announcementId: result.id,
    });
  }
  res.json({ status: 'success', id: result.id || null, push });
}));
app.post('/admin/announcements/delete', guard(async (req, res) => sendResult(res, await adminData.deleteAnnouncement(req.body.id))));
const slideUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: media.MAX_SLIDE_BYTES, files: 1 } });
app.post('/admin/onboarding/list', guard(async (req, res) => res.json({ status: 'success', slides: await onboarding.listSlides(), max: onboarding.MAX_SLIDES })));
app.post('/admin/onboarding/save',
  (req, res, next) => (verifyAdmin(req) ? next() : res.status(401).json({ status: 'error', message: 'Unauthorized' })),
  (req, res, next) => slideUpload.single('image')(req, res, (err) => (err
    ? res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ status: 'error', message: err.code === 'LIMIT_FILE_SIZE' ? 'That picture is too large' : 'Could not read the picture' })
    : next())),
  ah(async (req, res) => {
    const result = await onboarding.saveSlide(req.body, req.file ? req.file.buffer : null);
    sendResult(res, result, result.ok ? { id: result.id } : {});
  }));
app.post('/admin/onboarding/delete', guard(async (req, res) => sendResult(res, await onboarding.deleteSlide(req.body.id))));
app.post('/admin/onboarding/move', guard(async (req, res) => sendResult(res, await onboarding.moveSlide(req.body.id, req.body.direction))));
app.post('/admin/feedback/list', guard(async (req, res) => res.json({ status: 'success', ...(await feedback.listFeedback(req.body)) })));
app.post('/admin/feedback/status', guard(async (req, res) => sendResult(res, await feedback.setFeedbackStatus(req.body.id, req.body.status))));
app.post('/admin/feedback/delete', guard(async (req, res) => sendResult(res, await feedback.deleteFeedback(req.body.id))));
app.post('/admin/settings/get', guard(async (req, res) => res.json({ status: 'success', settings: adminView(await getSettings()), defaultAiDailyLimit: AI_DAILY_LIMIT, models: AI_MODELS, publishedVersion: publishedVersion() })));
app.post('/admin/settings/save', guard(async (req, res) => {
  const result = await saveSettings(req.body);
  sendResult(res, result, result.ok ? { settings: adminView(result.settings) } : {});
}));

// The contact details on the public pages come from Settings in the admin panel
// (SUPPORT_EMAIL in the environment still works as a fallback for the email).
async function legalFor() {
  const st = await getSettings();
  return {
    appName: process.env.APP_NAME || 'Shule Notes',
    contact: { email: st.supportEmail || process.env.SUPPORT_EMAIL || '', phone: st.supportPhone, whatsapp: st.supportWhatsapp },
    updated: process.env.PRIVACY_UPDATED || '15 November 2026',
  };
}
app.get('/privacy', ah(async (req, res) => res.type('html').send(privacyPage(await legalFor()))));
app.get('/terms', ah(async (req, res) => res.type('html').send(termsPage(await legalFor()))));
app.get('/account-deletion', ah(async (req, res) => res.type('html').send(accountDeletionPage(await legalFor()))));

app.get('/health', (req, res) => res.json({ status: 'success', app: 'shule-notes', time: new Date().toISOString() }));

async function start() {
  await connect();
  // A note left "reading" means the server stopped mid-upload; say so instead of hiding it forever.
  await getDb().collection('notes').updateMany({ textStatus: 'reading' }, { $set: { textStatus: 'failed' } });
  app.listen(PORT, HOST, () => console.log(`Shule Notes server listening on ${HOST}:${PORT}`));
}

if (require.main === module) {
  start().catch((e) => { console.error('Failed to start:', e); process.exit(1); });
}

module.exports = { NOTE_KINDS, app, todayKey, normalizePhone, isValidPhone, publicUser, publicNote, consumeAiQuota, deleteAccount, setClassLevel, AI_DAILY_LIMIT };
