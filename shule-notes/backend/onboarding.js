// The introduction a student sees the first time they open the app: a few slides, each with a
// picture, a short heading and a line of text, all set from the admin panel.
'use strict';
const { ObjectId } = require('mongodb');
const { getDb } = require('./db');
const media = require('./media');

const MAX_SLIDES = 8;
const toId = (id) => { try { return new ObjectId(String(id)); } catch (_) { return null; } };
const clean = (v, max) => String(v || '').replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, max);

const publicSlide = (s) => ({
  id: String(s._id), title: s.title, text: s.text,
  imageUrl: s.imageType ? `/onboarding/${s._id}/image?v=${s.imageVersion || 0}` : null,
});
const adminSlide = (s) => ({ ...publicSlide(s), active: s.active !== false, order: s.order || 0 });

// For the student's phone. `configured` tells the app whether the owner has made any slides at all:
// none yet means "use the built-in introduction", slides that are all switched off means "no introduction".
async function publicSlides() {
  const all = await getDb().collection('slides').find({}).sort({ order: 1, createdAt: 1 }).toArray();
  return { configured: all.length > 0, slides: all.filter((s) => s.active !== false).map(publicSlide) };
}

async function listSlides() {
  const all = await getDb().collection('slides').find({}).sort({ order: 1, createdAt: 1 }).toArray();
  return all.map(adminSlide);
}

// Creates a slide, or edits one when `id` is given. `image` is optional when editing.
async function saveSlide({ id, title, text, active }, image) {
  const t = clean(title, 60);
  const body = clean(text, 160);
  if (!t) return { ok: false, status: 400, message: 'Give the slide a heading' };
  const db = getDb();
  let type = null;
  if (image) {
    type = media.detectImageType(image);
    if (!type) return { ok: false, status: 400, message: 'The picture must be a JPEG, PNG or WebP' };
    if (image.length > media.MAX_SLIDE_BYTES) return { ok: false, status: 413, message: 'That picture is too large' };
  }
  if (id) {
    const _id = toId(id);
    const existing = _id ? await db.collection('slides').findOne({ _id }) : null;
    if (!existing) return { ok: false, status: 404, message: 'Slide not found' };
    const set = { title: t, text: body, active: active !== false && active !== 'false' };
    if (image) { media.writeImage('onboarding', _id, image); set.imageType = type; set.imageVersion = Date.now(); }
    await db.collection('slides').updateOne({ _id }, { $set: set });
    return { ok: true, id: String(_id) };
  }
  if ((await db.collection('slides').countDocuments({})) >= MAX_SLIDES) return { ok: false, status: 400, message: `An introduction can have at most ${MAX_SLIDES} slides` };
  const last = await db.collection('slides').find({}).sort({ order: -1 }).limit(1).toArray();
  const doc = { title: t, text: body, active: active !== false && active !== 'false', order: (last[0]?.order || 0) + 1, createdAt: new Date() };
  const result = await db.collection('slides').insertOne(doc);
  if (image) {
    media.writeImage('onboarding', result.insertedId, image);
    await db.collection('slides').updateOne({ _id: result.insertedId }, { $set: { imageType: type, imageVersion: Date.now() } });
  }
  return { ok: true, id: String(result.insertedId) };
}

async function deleteSlide(id) {
  const _id = toId(id);
  const res = _id ? await getDb().collection('slides').deleteOne({ _id }) : { deletedCount: 0 };
  if (!res.deletedCount) return { ok: false, status: 404, message: 'Slide not found' };
  media.removeImage('onboarding', _id);
  return { ok: true };
}

// Swaps a slide with its neighbour. Orders are renumbered 1..n first, so they never collide.
async function moveSlide(id, direction) {
  const db = getDb();
  const all = await db.collection('slides').find({}).sort({ order: 1, createdAt: 1 }).toArray();
  const i = all.findIndex((s) => String(s._id) === String(id));
  if (i < 0) return { ok: false, status: 404, message: 'Slide not found' };
  const j = direction === 'up' ? i - 1 : direction === 'down' ? i + 1 : i;
  if (j < 0 || j >= all.length) return { ok: true };
  [all[i], all[j]] = [all[j], all[i]];
  for (let k = 0; k < all.length; k++) await db.collection('slides').updateOne({ _id: all[k]._id }, { $set: { order: k + 1 } });
  return { ok: true };
}

module.exports = { MAX_SLIDES, publicSlides, listSlides, saveSlide, deleteSlide, moveSlide };
