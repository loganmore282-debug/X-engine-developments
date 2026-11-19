#!/usr/bin/env node
/**
 * Runs the real admin and account code (student list, ban, password reset,
 * delete, dashboard numbers, announcements, settings, changing your own
 * password) against an in-memory database -- the logic that decides what the
 * owner sees and what a student can do, not just that the routes exist.
 */
'use strict';
process.env.UPLOAD_DIR = require('os').tmpdir() + '/shule-notes-test-admin-' + Date.now();
const { makeDb, stubDb, ObjectId } = require('./fake-mongo.testlib');
const db = makeDb();
stubDb(db);

const { hashPassword, verifyPassword, createSession, resolveSession, sha256 } = require('./auth');
const admin = require('./admin-data');
const accounts = require('./accounts');
const settings = require('./settings');

let bad = 0;
const ck = (ok, label) => { if (!ok) bad++; console.log((ok ? 'PASS  ' : 'FAIL  ') + label); };
const day = (offset) => new Date(Date.now() + offset * 24 * 60 * 60 * 1000);
const dateKey = (offset) => day(offset).toISOString().slice(0, 10);

(async () => {
  // ---- a school of students ----
  const names = ['Amina Nakato', 'Brian Okello', 'Cissy Namuli', 'David Mugisha', 'Esther Achieng', 'Faith Nabirye'];
  const ids = [];
  for (let i = 0; i < names.length; i++) {
    const r = await db.collection('users').insertOne({
      name: names[i], phone: '07720000' + String(10 + i), passwordHash: hashPassword('password' + i),
      status: i === 4 ? 'banned' : 'active', createdAt: day(-i * 2), classLevel: i < 3 ? 'Senior 2' : i === 3 ? 'Primary 7' : null,
    });
    ids.push(String(r.insertedId));
  }
  await db.collection('aiUsage').insertOne({ userId: ids[0], date: dateKey(0), count: 4 });
  await db.collection('aiUsage').insertOne({ userId: ids[0], date: dateKey(-1), count: 6 });
  await db.collection('aiUsage').insertOne({ userId: ids[1], date: dateKey(0), count: 2 });
  await db.collection('aiUsage').insertOne({ userId: ids[2], date: dateKey(-20), count: 9 });

  console.log('— the student list —');
  {
    const all = await admin.listUsers({});
    ck(all.total === 6 && all.users.length === 6, 'lists every student');
    ck(all.users[0].name === 'Amina Nakato' && all.users[5].name === 'Faith Nabirye', 'newest signup first');
    const amina = all.users.find((u) => u.name === 'Amina Nakato');
    ck(amina.aiToday === 4 && amina.aiTotal === 10, 'shows each student\'s AI questions today and in total');
    ck(all.users.find((u) => u.name === 'Cissy Namuli').aiTotal === 9 && all.users.find((u) => u.name === 'Cissy Namuli').aiToday === 0, 'old usage counts in the total but not in today');
    ck(!JSON.stringify(all).includes('passwordHash') && !JSON.stringify(all).includes('scrypt'), 'never includes a password hash');

    ck((await admin.listUsers({ q: 'brian' })).users.map((u) => u.name).join() === 'Brian Okello', 'search finds a name, ignoring case');
    ck((await admin.listUsers({ q: '0772000013' })).users[0].name === 'David Mugisha', 'search finds a phone number');
    ck((await admin.listUsers({ q: '+256772000013' })).users[0].name === 'David Mugisha', 'search finds a phone number written with the country code');
    ck((await admin.listUsers({ q: '(.*)' })).total === 0, 'search text is not treated as a pattern');
    ck((await admin.listUsers({ status: 'banned' })).users.map((u) => u.name).join() === 'Esther Achieng', 'can show only banned students');
    ck((await admin.listUsers({ status: 'active' })).total === 5, 'and only active ones');
    ck((await admin.listUsers({ classLevel: 'Senior 2' })).total === 3, 'can show one class');
    ck((await admin.listUsers({ classLevel: 'none' })).total === 2, 'can show students who have not chosen a class');

    const p1 = await admin.listUsers({ page: 1, pageSize: 4 });
    const p2 = await admin.listUsers({ page: 2, pageSize: 4 });
    ck(p1.users.length === 4 && p2.users.length === 2 && p1.total === 6 && p2.page === 2, 'pages through the list');
    ck((await admin.listUsers({ pageSize: 9999 })).pageSize === 100, 'a page cannot be asked to be enormous');
  }

  console.log('\n— banning, resetting a password, deleting —');
  {
    const token = (await createSession(ids[1])).token;
    ck(await resolveSession(token) === ids[1], 'a signed-in student has a working session');
    ck((await admin.setUserStatus(ids[1], 'banned')).ok, 'a student can be banned');
    ck(await resolveSession(token) === null, 'and is signed out at once, not when their session expires');
    ck((await db.collection('users').findOne({ _id: new ObjectId(ids[1]) })).status === 'banned', 'the ban is saved');
    ck((await admin.setUserStatus(ids[1], 'active')).ok && (await admin.listUsers({ status: 'banned' })).total === 1, 'and can be lifted');
    ck((await admin.setUserStatus(ids[1], 'deleted')).status === 400, 'an unknown status is refused');
    ck((await admin.setUserStatus('65f0a1b2c3d4e5f6a7b8c9ff', 'banned')).status === 404, 'a student who does not exist reports 404');

    const t2 = (await createSession(ids[2])).token;
    const short = await admin.resetUserPassword(ids[2], 'abc');
    ck(short.ok === false && short.status === 400, 'a too-short new password is refused');
    ck((await admin.resetUserPassword(ids[2], 'brand-new-pass')).ok, 'the owner can set a new password');
    const row = await db.collection('users').findOne({ _id: new ObjectId(ids[2]) });
    ck(verifyPassword('brand-new-pass', row.passwordHash) && !verifyPassword('password2', row.passwordHash), 'the new password works and the old one does not');
    ck(row.passwordHash.indexOf('brand-new-pass') === -1, 'it is stored hashed');
    ck(await resolveSession(t2) === null, 'every device is signed out by a reset');

    await createSession(ids[5]);
    await db.collection('aiUsage').insertOne({ userId: ids[5], date: dateKey(0), count: 1 });
    ck((await admin.adminDeleteUser(ids[5])).ok, 'the owner can delete a student');
    ck(!(await db.collection('users').findOne({ _id: new ObjectId(ids[5]) })), 'the student is gone');
    ck((await db.collection('sessions').find({ userId: ids[5] }).toArray()).length === 0 && (await db.collection('aiUsage').find({ userId: ids[5] }).toArray()).length === 0, 'with their sessions and AI usage');
    ck((await db.collection('users').countDocuments({})) === 5, 'nobody else was touched');
    ck((await admin.adminDeleteUser(ids[5])).status === 404, 'deleting twice reports 404');
  }

  console.log('\n— a student changing their own password and name —');
  {
    const mine = (await createSession(ids[0])).token;
    const other = (await createSession(ids[0])).token;
    ck((await accounts.changePassword(ids[0], 'wrong', 'newpass99', mine)).status === 403, 'a wrong current password is refused with 403 (401 would sign the app out)');
    ck((await accounts.changePassword(ids[0], 'password0', '123', mine)).status === 400, 'a too-short new password is refused');
    ck((await accounts.changePassword(ids[0], 'password0', 'newpass99', mine)).ok, 'the right current password changes it');
    const row = await db.collection('users').findOne({ _id: new ObjectId(ids[0]) });
    ck(verifyPassword('newpass99', row.passwordHash) && !verifyPassword('password0', row.passwordHash), 'the new password is the one that works');
    ck(await resolveSession(mine) === ids[0], 'the device that made the change stays signed in');
    ck(await resolveSession(other) === null, 'every other device is signed out');
    ck((await accounts.updateProfile(ids[0], '  Amina   <b>Nakato</b> Joy ')).user.name === 'Amina Nakato Joy', 'a name is tidied: extra spaces and HTML tags removed');
    ck(accounts.cleanName('<script>alert(1)</script>Bob') === 'alert(1)Bob' && accounts.cleanName('a < b') === 'a b', 'angle brackets can never survive in a name');
    ck((await accounts.updateProfile(ids[0], 'A')).status === 400, 'a one-letter name is refused');
  }

  console.log('\n— the dashboard —');
  {
    await db.collection('notes').insertOne({ title: 'A', views: 12, active: true });
    await db.collection('notes').insertOne({ title: 'B', views: 3 });
    await db.collection('notes').insertOne({ title: 'C', views: 0, active: false });
    await db.collection('subjects').insertOne({ name: 'Biology' });
    const s = await admin.dashboardStats();
    ck(s.students === 5 && s.banned === 1 && s.withoutClass === 1, 'counts students, banned and those with no class');
    ck(s.newThisWeek === 4, 'counts the students who joined this week');
    ck(s.notes === 3 && s.notesHidden === 1 && s.subjects === 1, 'counts notes, hidden notes and subjects');
    ck(s.aiToday === 6 && s.studentsAskingToday === 2, 'counts AI questions today and who asked them');
    ck(s.aiLast7Days.length === 7 && s.aiLast7Days[6].count === 6 && s.aiLast7Days[5].count === 6, 'gives seven days of AI usage, ending today');
    ck(s.byClass.find((c) => c.classLevel === 'Senior 2').count === 3 && s.byClass.find((c) => c.classLevel === 'Primary 7').count === 1, 'groups students by class');
    ck(s.topNotes.map((n) => n.title).join() === 'A,B', 'lists the most-read notes, most first, leaving out unread ones');
    ck(s.recentStudents.length === 5, 'lists the newest students');
  }

  console.log('\n— announcements —');
  {
    ck(await admin.activeAnnouncement() === null, 'nothing is shown when there are no announcements');
    ck((await admin.saveAnnouncement({ title: '', message: 'x' })).status === 400, 'an announcement needs a title');
    ck((await admin.saveAnnouncement({ title: 'x', message: '  ' })).status === 400, 'and a message');
    ck((await admin.saveAnnouncement({ title: 'x', message: 'y', expiresAt: 'not a date' })).status === 400, 'and a real date if it has one');
    const first = await admin.saveAnnouncement({ title: 'Mock exams', message: 'Mocks start on Monday.' });
    ck(first.ok && (await admin.activeAnnouncement()).title === 'Mock exams', 'a new announcement is shown');
    await new Promise((r) => setTimeout(r, 5));
    await admin.saveAnnouncement({ title: 'Holiday', message: 'School closes Friday.' });
    ck((await admin.activeAnnouncement()).title === 'Holiday', 'the newest one wins');
    const expired = await admin.saveAnnouncement({ title: 'Old', message: 'Past.', expiresAt: '2020-01-01' });
    await db.collection('announcements').updateOne({ _id: new ObjectId(expired.id) }, { $set: { createdAt: day(1) } });
    ck((await admin.activeAnnouncement()).title === 'Holiday', 'an expired announcement is not shown, even if it is the newest');
    await admin.saveAnnouncement({ id: first.id, title: 'Mock exams', message: 'Mocks start on Monday.', active: false });
    const list = await admin.listAnnouncements();
    ck(list.length === 3 && list.find((a) => a.id === first.id).active === false, 'an announcement can be switched off');
    const holiday = list.find((a) => a.title === 'Holiday');
    await admin.deleteAnnouncement(holiday.id);
    ck(await admin.activeAnnouncement() === null, 'deleting the last live one leaves nothing showing');
  }

  console.log('\n— settings —');
  {
    ck((await settings.getSettings()).aiEnabled === true && (await settings.getSettings()).aiDailyLimit === null, 'starts with the AI on and the limit taken from the server setting');
    ck((await settings.saveSettings({ aiDailyLimit: 0 })).ok === false && (await settings.saveSettings({ aiDailyLimit: 9999 })).ok === false, 'a daily limit outside 1 to 500 is refused');
    ck((await settings.saveSettings({ supportEmail: 'not-an-email' })).ok === false, 'a bad email is refused');
    ck((await settings.saveSettings({ supportWhatsapp: 'call me maybe' })).ok === false, 'and a bad phone number');
    const saved = await settings.saveSettings({ aiEnabled: false, aiDailyLimit: '30', supportPhone: '+256 700 111 222', supportEmail: 'help@example.com', supportHours: 'Mon-Fri 8am-5pm' });
    ck(saved.ok && saved.settings.aiEnabled === false && saved.settings.aiDailyLimit === 30, 'saved changes take effect straight away (the cache is cleared)');
    const publicView = settings.publicConfig(saved.settings);
    ck(publicView.supportPhone === '+256 700 111 222' && publicView.aiEnabled === false && !('aiDailyLimit' in publicView), 'the app is told the contacts and the switch, not the limit');
    ck((await settings.saveSettings({ aiDailyLimit: null })).settings.aiDailyLimit === null, 'the limit can go back to the server default');
  }

  console.log(bad ? `\n${bad} check(s) FAILED` : '\nall admin checks pass');
  process.exit(bad ? 1 : 0);
})();
