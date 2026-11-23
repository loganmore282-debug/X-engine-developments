#!/usr/bin/env node
// Profile photos and the introduction slides: only real pictures are kept, ids cannot escape the
// folder, ordering holds, and a deleted account leaves no photo behind.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'media-'));
const { makeDb, stubDb } = require('./fake-mongo.testlib');
const db = makeDb();
stubDb(db);
const media = require('./media');
const onboarding = require('./onboarding');
const { eraseUser } = require('./accounts');
const { publicUser } = require('./server');

let bad = 0;
const ck = (ok, label) => { if (!ok) bad++; console.log((ok ? 'PASS  ' : 'FAIL  ') + label); };

const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]);
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 2)]);
const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(50)]);
const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200, 3)]);

(async () => {
  console.log('— what counts as a picture —');
  ck(media.detectImageType(jpeg) === 'image/jpeg' && media.detectImageType(png) === 'image/png' && media.detectImageType(webp) === 'image/webp', 'JPEG, PNG and WebP are recognised by their first bytes');
  ck(media.detectImageType(exe) === null && media.detectImageType(Buffer.from('<svg onload=alert(1)>............')) === null && media.detectImageType(Buffer.alloc(3)) === null, 'a program, an SVG and a tiny file are not pictures');
  ck(media.filePath('avatars', '../../etc/passwd') === null && media.filePath('secrets', 'a'.repeat(24)) === null && media.filePath('avatars', 'a'.repeat(24)).startsWith(process.env.UPLOAD_DIR), 'an id with dots or slashes, or a made-up folder, is refused');

  console.log('\n— a student\'s profile photo —');
  const u = await db.collection('users').insertOne({ name: 'Amina', phone: '0772123456', classLevel: 'Senior 2' });
  const id = String(u.insertedId);
  ck(publicUser({ _id: u.insertedId, name: 'Amina' }).avatarVersion === 0, 'a new account has no photo (version 0)');
  ck((await media.setAvatar(id, exe)).status === 400, 'a non-picture is refused');
  ck((await media.setAvatar(id, Buffer.concat([jpeg, Buffer.alloc(media.MAX_AVATAR_BYTES)]))).status === 413, 'a picture over 1 MB is refused');
  ck((await media.setAvatar('nope', jpeg)).status === 404, 'an unknown account is refused');
  const set = await media.setAvatar(id, jpeg);
  ck(set.ok && set.user.avatarVersion > 0 && fs.readFileSync(media.filePath('avatars', id)).equals(jpeg), 'a real picture is saved and the account gets a version');
  const stored = await db.collection('users').findOne({ _id: u.insertedId });
  ck(stored.avatarType === 'image/jpeg' && publicUser(stored).avatarVersion === stored.avatarVersion, 'the type is remembered and the version reaches the app');
  await new Promise((r) => setTimeout(r, 3));
  const second = await media.setAvatar(id, png);
  ck(second.ok && second.user.avatarVersion > set.user.avatarVersion, 'a new photo gets a newer version, so phones fetch it again');
  const removed = await media.removeAvatar(id);
  ck(removed.ok && !fs.existsSync(media.filePath('avatars', id)) && !('avatarVersion' in removed.user), 'removing it deletes the file and the version');
  await media.setAvatar(id, jpeg);
  await eraseUser(id);
  ck(!fs.existsSync(media.filePath('avatars', id)), 'deleting the account deletes the photo too');

  console.log('\n— the introduction —');
  ck(JSON.stringify(await onboarding.publicSlides()) === '{"configured":false,"slides":[]}', 'before the owner makes any slide, the app is told to use its own introduction');
  ck((await onboarding.saveSlide({ title: '  ', text: 'x' }, null)).status === 400, 'a slide needs a heading');
  ck((await onboarding.saveSlide({ title: 'Hi', text: 'x' }, exe)).status === 400, 'a slide picture must be a picture');
  const a = await onboarding.saveSlide({ title: 'Every note in one place', text: 'Notes and exams for your class.' }, jpeg);
  const b = await onboarding.saveSlide({ title: 'Ask when you are stuck', text: 'The AI helper reads the page with you.' }, png);
  const c = await onboarding.saveSlide({ title: 'Study offline', text: 'Download and read anywhere.' }, null);
  ck(a.ok && b.ok && c.ok, 'three slides are created');
  let pub = await onboarding.publicSlides();
  ck(pub.configured && pub.slides.map((s) => s.title).join('|') === 'Every note in one place|Ask when you are stuck|Study offline', 'they are listed in the order they were made');
  ck(pub.slides[0].imageUrl.startsWith(`/onboarding/${a.id}/image?v=`) && pub.slides[2].imageUrl === null, 'a slide with a picture gets an address for it; one without gets none');
  ck(fs.existsSync(media.filePath('onboarding', a.id)), 'the picture is on disk');
  await onboarding.moveSlide(c.id, 'up');
  ck((await onboarding.publicSlides()).slides.map((s) => s.id).join() === [a.id, c.id, b.id].join(), 'moving a slide up swaps it with the one above');
  await onboarding.moveSlide(a.id, 'up');
  ck((await onboarding.publicSlides()).slides[0].id === a.id, 'moving the first slide up changes nothing');
  await onboarding.saveSlide({ id: b.id, title: 'Ask the AI', text: 'Changed.', active: false });
  pub = await onboarding.publicSlides();
  ck(pub.slides.length === 2 && pub.configured, 'a slide switched off is hidden from students (and the intro is still "configured")');
  ck((await onboarding.listSlides()).length === 3, 'the admin still sees it');
  const before = (await db.collection('slides').findOne({ title: 'Every note in one place' })).imageVersion;
  await new Promise((r) => setTimeout(r, 3));
  await onboarding.saveSlide({ id: a.id, title: 'Every note in one place', text: 'New text' }, png);
  ck((await db.collection('slides').findOne({ title: 'Every note in one place' })).imageVersion > before, 'a new picture on a slide gets a new version');
  ck((await onboarding.saveSlide({ id: 'nope', title: 'x' })).status === 404, 'editing an unknown slide fails');
  for (let i = 0; i < 5; i++) await onboarding.saveSlide({ title: 'More ' + i, text: '' }, null);
  ck((await onboarding.saveSlide({ title: 'One too many', text: '' }, null)).ok === false, 'no more than 8 slides');
  await onboarding.deleteSlide(a.id);
  ck(!fs.existsSync(media.filePath('onboarding', a.id)) && (await onboarding.deleteSlide(a.id)).status === 404, 'deleting a slide deletes its picture');
  await onboarding.deleteSlide(c.id);
  const trimmed = await onboarding.saveSlide({ title: 'T'.repeat(200), text: 'x'.repeat(500) }, null);
  const doc = await db.collection('slides').findOne({ _id: new (require('mongodb').ObjectId)(trimmed.id) });
  ck(doc.title.length === 60 && doc.text.length === 160, 'a very long heading or text is shortened');

  console.log(bad ? `\n${bad} check(s) FAILED` : '\nall media checks pass');
  process.exit(bad ? 1 : 0);
})();
