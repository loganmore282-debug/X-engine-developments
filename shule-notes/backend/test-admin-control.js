#!/usr/bin/env node
/**
 * The owner's controls, through the real admin routes: custom hours, access for a whole class, a welcome pass for
 * new students, closing sign-ups, a student's full details, editing a student, spreadsheet exports, and the activity log.
 */
'use strict';
process.env.UPLOAD_DIR = require('os').tmpdir() + '/shule-notes-test-ctl-' + Date.now();
process.env.ADMIN_KEY = 'test-admin-key-123456';
const { makeDb, stubDb } = require('./fake-mongo.testlib');
const db = makeDb(); stubDb(db);
const pay = require('./payments');
const settingsLib = require('./settings');
const { hashPassword } = require('./auth');

let bad = 0;
const ck = (ok, label) => { if (!ok) bad++; console.log((ok ? 'PASS  ' : 'FAIL  ') + label); };
const MIN = 60000;

(async () => {
  const { app } = require('./server');
  const server = app.listen(0); const base = 'http://127.0.0.1:' + server.address().port;
  const adm = { 'x-admin-key': process.env.ADMIN_KEY };
  const post = (url, body, headers = {}) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body || {}) });
  const A = (url, body) => post(url, body, adm);
  const mk = async (name, phone, classLevel, status) => String((await db.collection('users').insertOne({ name, phone, classLevel, status: status || 'active', passwordHash: await hashPassword('password1'), createdAt: new Date() })).insertedId);
  const s2a = await mk('Amina Nakato', '0772000001', 'Senior 2'); const s2b = await mk('Brian Okello', '0772000002', 'Senior 2');
  const s4 = await mk('Cissy Namuli', '0772000003', 'Senior 4'); const banned = await mk('Dan Banned', '0772000004', 'Senior 2', 'banned');
  const until = async (id) => { const u = await db.collection('users').findOne({ _id: new (require('mongodb').ObjectId)(id) }); return u.accessUntil ? new Date(u.accessUntil).getTime() - Date.now() : 0; };

  console.log('— custom hours —');
  const g = await A('/admin/users/grant', { id: s2a, minutes: 90 });
  ck(g.status === 200 && (await until(s2a)) > 89 * MIN && (await until(s2a)) <= 90 * MIN + 2000, 'the owner can give exactly 90 minutes');
  ck((await A('/admin/users/grant', { id: s2a, minutes: 5 })).status === 400, 'less than 30 minutes is refused');

  console.log('— a whole class, or everyone —');
  const cls = await (await A('/admin/users/grant-bulk', { scope: 'class', classLevel: 'Senior 2', minutes: 180 })).json();
  ck(cls.count === 2 && (await until(s2b)) > 179 * MIN && (await until(s4)) === 0, 'Senior 2 (2 active students) gets 3 hours; Senior 4 is untouched');
  ck((await until(banned)) === 0, 'a banned student is not given anything');
  ck((await until(s2a)) > 269 * MIN, 'a student who had time keeps it and the gift is added on top');
  const all = await (await A('/admin/users/grant-bulk', { scope: 'all', minutes: 60 })).json();
  ck(all.count === 3 && (await until(s4)) > 59 * MIN, 'everyone active can be given time at once');
  ck((await A('/admin/users/grant-bulk', { scope: 'class', minutes: 60 })).status === 400 && (await A('/admin/users/grant-bulk', { scope: 'nobody', minutes: 60 })).status === 400, 'a missing class or scope is refused');

  console.log('— a student in full —');
  const d = await (await A('/admin/users/detail', { id: s2a })).json();
  ck(d.student.name === 'Amina Nakato' && d.student.classLevel === 'Senior 2' && Array.isArray(d.payments), 'the details show the student and their payments');
  ck((await A('/admin/users/detail', { id: 'nonsense' })).status === 404, 'an unknown student is a clear 404');
  ck((await A('/admin/users/update', { id: s4, name: 'Cissy N. Namuli', classLevel: 'Senior 3' })).status === 200 && (await db.collection('users').findOne({ phone: '0772000003' })).classLevel === 'Senior 3', 'the owner can correct a name and a class');
  ck((await A('/admin/users/update', { id: s4, classLevel: 'Senior 99' })).status === 400 && (await A('/admin/users/update', { id: s4, name: 'x' })).status === 400, 'a class that does not exist and a too-short name are refused');

  console.log('— new students —');
  await settingsLib.saveSettings({ trialMinutes: 120 });
  const reg = await (await post('/auth/register', { name: 'New Student', phone: '0772000009', password: 'secret12' })).json();
  ck(reg.status === 'success' && reg.user.accessUntil && new Date(reg.user.accessUntil).getTime() - Date.now() > 119 * MIN, 'a new student gets the welcome pass set in Settings (2 hours)');
  await settingsLib.saveSettings({ trialMinutes: 0, signupsOpen: false });
  const closed = await post('/auth/register', { name: 'Late Student', phone: '0772000010', password: 'secret12' });
  ck(closed.status === 403 && /closed/.test((await closed.json()).message), 'with sign-ups closed nobody can register');
  ck((await db.collection('users').findOne({ phone: '0772000010' })) === null, 'and no account was made');
  await settingsLib.saveSettings({ signupsOpen: true });
  ck((await post('/auth/register', { name: 'Open Student', phone: '0772000011', password: 'secret12' })).status === 200, 'open again: registering works');
  ck(!(await settingsLib.saveSettings({ trialMinutes: -5 })).ok && !(await settingsLib.saveSettings({ trialMinutes: 999999999 })).ok, 'a silly welcome-pass length is refused');

  console.log('— exports —');
  const ex = await (await A('/admin/export/students', {})).json();
  ck(ex.rows.length >= 4 && ex.rows[0].phone && !('passwordHash' in ex.rows[0]), 'the student export has the details and never a password');
  const exp = await (await A('/admin/export/payments', {})).json();
  ck(exp.status === 'success' && Array.isArray(exp.rows), 'the payments export works');
  ck((await post('/admin/export/students', {})).status === 401, 'exports need the admin key');

  console.log('— the activity log —');
  await A('/admin/settings/save', { marzpayKey: 'dGVzdC1tYXJ6cGF5LWtleS0xMjM0NQ==', supportPhone: '+256 700 000 000' });
  await A('/admin/users/revoke', { id: s2a });
  await new Promise((r) => setTimeout(r, 100));
  const log = await (await A('/admin/activity/list', {})).json();
  const actions = log.events.map((e) => e.action);
  ck(actions.includes('Gave access') && actions.includes('Removed access') && actions.includes('Changed settings') && actions.includes('Gave access to many students'), 'grants, revokes and settings changes are all in the log');
  ck(!JSON.stringify(log).includes('dGVzdC1t') && !JSON.stringify(log).includes('password'), 'and no secret or password ever appears in it');
  ck(log.events[0].at && log.events[0].ip !== undefined, 'each entry has a time');
  ck(!actions.includes('Edited a student') === false, 'edits are logged too');
  ck((await post('/admin/activity/list', {})).status === 401, 'the log needs the admin key');

  server.close();
  console.log(bad ? `\n${bad} FAILED` : '\nall admin-control checks passed');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('crashed:', e); process.exit(1); });
