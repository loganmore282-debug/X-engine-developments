// Pictures kept on the server's disk: each student's profile photo and the introduction slides'
// images. Only real pictures are accepted (the file's own first bytes are checked, never the
// name or the type the sender claims), and ids are checked so no path can escape the folder.
'use strict';
const fs = require('fs');
const path = require('path');
const { ObjectId } = require('mongodb');
const { getDb } = require('./db');

const MAX_AVATAR_BYTES = 1024 * 1024;
const MAX_SLIDE_BYTES = 3 * 1024 * 1024;

// Read on every call, so a test can point it at a temporary folder.
const root = () => process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');

// JPEG, PNG or WebP, judged by the first bytes.
function detectImageType(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

function filePath(kind, id) {
  if (!['avatars', 'onboarding'].includes(kind) || !/^[a-f0-9]{24}$/.test(String(id))) return null;
  return path.join(root(), kind, String(id));
}

function writeImage(kind, id, buffer) {
  const file = filePath(kind, id);
  if (!file) throw new Error('bad image id');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, buffer);
  fs.renameSync(tmp, file); // a reader never sees half a picture
}

function removeImage(kind, id) {
  const file = filePath(kind, id);
  if (file) fs.rmSync(file, { force: true });
}

const toId = (id) => { try { return new ObjectId(String(id)); } catch (_) { return null; } };

// A student's own profile photo.
async function setAvatar(userId, buffer) {
  const type = detectImageType(buffer);
  if (!type) return { ok: false, status: 400, message: 'Choose a JPEG, PNG or WebP picture' };
  if (buffer.length > MAX_AVATAR_BYTES) return { ok: false, status: 413, message: 'That picture is too large' };
  const id = toId(userId);
  const db = getDb();
  const user = id ? await db.collection('users').findOne({ _id: id }) : null;
  if (!user) return { ok: false, status: 404, message: 'Account not found' };
  writeImage('avatars', id, buffer);
  const avatarVersion = Date.now();
  await db.collection('users').updateOne({ _id: id }, { $set: { avatarVersion, avatarType: type } });
  return { ok: true, user: { ...user, avatarVersion, avatarType: type } };
}

async function removeAvatar(userId) {
  const id = toId(userId);
  const db = getDb();
  const user = id ? await db.collection('users').findOne({ _id: id }) : null;
  if (!user) return { ok: false, status: 404, message: 'Account not found' };
  removeImage('avatars', id);
  await db.collection('users').updateOne({ _id: id }, { $unset: { avatarVersion: '', avatarType: '' } });
  const { avatarVersion, avatarType, ...rest } = user;
  return { ok: true, user: rest };
}

module.exports = { MAX_AVATAR_BYTES, MAX_SLIDE_BYTES, detectImageType, filePath, writeImage, removeImage, setAvatar, removeAvatar };
