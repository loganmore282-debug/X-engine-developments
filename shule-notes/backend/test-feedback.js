#!/usr/bin/env node
// Feedback from the app and the update prompt's version numbers.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-'));
process.env.DOWNLOAD_DIR = dir;
const { makeDb, stubDb } = require('./fake-mongo.testlib');
const db = makeDb();
stubDb(db);
const feedback = require('./feedback');
const settings = require('./settings');
const { publishedVersion, clearVersionCache } = require('./app-version');
const { eraseUser } = require('./accounts');

let bad = 0;
const ck = (ok, label) => { if (!ok) bad++; console.log((ok ? 'PASS  ' : 'FAIL  ') + label); };

(async () => {
  const user = await db.collection('users').insertOne({ name: 'Amina Nakato', phone: '0772123456', classLevel: 'Senior 2' });
  const userId = String(user.insertedId);
  const note = await db.collection('notes').insertOne({ title: 'Photosynthesis' });

  console.log('— sending feedback —');
  ck((await feedback.submitFeedback({ userId, type: 'bug', message: 'hello there' })).ok === false, 'an unknown type is refused');
  ck((await feedback.submitFeedback({ userId, type: 'problem', message: 'hi' })).ok === false, 'a message that is too short is refused');
  ck((await feedback.submitFeedback({ userId: 'nope', type: 'idea', message: 'a good idea here' })).status === 404, 'feedback from an unknown account is refused');
  const sent = await feedback.submitFeedback({ userId, type: 'problem', message: '<b>The page</b> will not open<script>alert(1)</script>', noteId: String(note.insertedId), appVersion: '1.0.7', device: 'Samsung A14' });
  ck(sent.ok, 'a proper message is accepted');
  const list = await feedback.listFeedback({});
  const item = list.items[0];
  ck(list.total === 1 && item.name === 'Amina Nakato' && item.phone === '0772123456' && item.noteTitle === 'Photosynthesis' && item.appVersion === '1.0.7', 'it is stored with who sent it, the note and the app version');
  ck(!/[<>]/.test(item.message) && item.message.includes('will not open'), 'markup is stripped from the message');
  ck(item.status === 'new' && await feedback.countNewFeedback() === 1, 'it starts as new');

  console.log('\n— the daily limit —');
  for (let i = 0; i < feedback.DAILY_LIMIT; i++) await feedback.submitFeedback({ userId, type: 'idea', message: 'idea number ' + i });
  const blocked = await feedback.submitFeedback({ userId, type: 'idea', message: 'one more idea' });
  ck(blocked.ok === false && blocked.status === 429, `after ${feedback.DAILY_LIMIT} in a day another is refused politely`);

  console.log('\n— the owner\'s list —');
  const id = item.id;
  ck((await feedback.setFeedbackStatus(id, 'done')).ok && (await feedback.listFeedback({ status: 'done' })).total === 1, 'a message can be marked done');
  ck((await feedback.listFeedback({ status: 'new' })).items.every((f) => f.id !== id), 'and then leaves the new list');
  ck((await feedback.setFeedbackStatus(id, 'weird')).ok === false, 'an unknown status is refused');
  ck((await feedback.deleteFeedback(id)).ok && (await feedback.listFeedback({})).items.every((f) => f.id !== id), 'a message can be deleted');

  console.log('\n— deleting an account —');
  await eraseUser(userId);
  ck((await feedback.listFeedback({})).total === 0, 'the student\'s feedback goes with their account');

  console.log('\n— update prompt settings —');
  ck((await settings.saveSettings({ latestVersionCode: 'abc' })).ok === false && (await settings.saveSettings({ minVersionCode: -3 })).ok === false, 'version numbers must be whole numbers');
  ck((await settings.saveSettings({ updateUrl: 'http://example.com/app' })).ok === false, 'the update link must be https');
  const saved = await settings.saveSettings({ latestVersionCode: 12, minVersionCode: '9', updateUrl: 'https://play.google.com/store/apps/details?id=com.shulenotes.app', updateNote: 'Faster downloads' });
  const pub = settings.publicConfig(saved.settings);
  ck(saved.ok && pub.latestVersion === 12 && pub.minVersion === 9 && pub.updateNote === 'Faster downloads', 'saved numbers reach the app through the public settings');
  ck((await settings.saveSettings({ latestVersionCode: '' })).settings.latestVersionCode === 0, 'a blank number means "not set"');

  console.log('\n— the newest build, read from the download page —');
  clearVersionCache();
  ck(publishedVersion() === 0, 'with no download page there is nothing to announce');
  fs.writeFileSync(path.join(dir, 'version.json'), JSON.stringify({ versionCode: 41 }));
  clearVersionCache();
  ck(publishedVersion() === 41, 'the version written by the refresh job is read');
  fs.writeFileSync(path.join(dir, 'version.json'), 'garbage');
  clearVersionCache();
  ck(publishedVersion() === 0, 'a damaged file is ignored, not a crash');

  console.log(bad ? `\n${bad} check(s) FAILED` : '\nall feedback checks pass');
  process.exit(bad ? 1 : 0);
})();
