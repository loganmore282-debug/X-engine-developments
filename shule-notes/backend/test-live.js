#!/usr/bin/env node
/**
 * Live updates through the real routes: a student's open stream hears a sign-in elsewhere AT ONCE (with the reason),
 * the owner's changes, its new alerts and pass changes; the admin stream hears new students and feedback; nobody can
 * open a stream without signing in.
 */
'use strict';
process.env.UPLOAD_DIR = require('os').tmpdir() + '/shule-notes-test-live-' + Date.now();
process.env.ADMIN_KEY = 'a-long-test-admin-key-with-lots-of-characters-123';
const { makeDb, stubDb } = require('./fake-mongo.testlib');
const db = makeDb(); stubDb(db);
let bad = 0;
const ck = (ok, label) => { if (!ok) bad++; console.log((ok ? 'PASS  ' : 'FAIL  ') + label); };

// Opens a stream and collects its events.
async function stream(url, headers) {
  const ac = new AbortController();
  const res = await fetch(url, { headers, signal: ac.signal });
  const events = []; let closed = false;
  if (res.status === 200) {
    (async () => {
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
      try {
        for (;;) {
          const { value, done } = await reader.read(); if (done) break;
          buf += dec.decode(value, { stream: true });
          let i; while ((i = buf.indexOf('\n\n')) >= 0) {
            const block = buf.slice(0, i); buf = buf.slice(i + 2);
            const ev = /event: (.*)/.exec(block); const data = /data: (.*)/.exec(block);
            if (ev) events.push({ event: ev[1], data: data ? JSON.parse(data[1]) : {} });
          }
        }
      } catch (_) { /* aborted */ }
      closed = true;
    })();
  }
  return { status: res.status, type: res.headers.get('content-type') || '', events, isClosed: () => closed, close: () => ac.abort() };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 2000) { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await wait(20); } return false; }

(async () => {
  const { app } = require('./server');
  const server = app.listen(0); const base = 'http://127.0.0.1:' + server.address().port;
  const post = (url, body, headers = {}) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body || {}) });

  const adminToken = (await (await post('/admin/login', { key: process.env.ADMIN_KEY })).json()).token;
  const adminLive = await stream(base + '/admin/live', { Authorization: 'Bearer ' + adminToken });
  ck(adminLive.status === 200 && /text\/event-stream/.test(adminLive.type), 'the admin panel can open its live stream');
  ck((await stream(base + '/admin/live', {})).status === 401, 'nobody else can');
  ck((await stream(base + '/live', {})).status === 401, 'a student stream needs a signed-in student');

  const reg = await (await post('/auth/register', { name: 'Amina Nakato', phone: '0772123456', password: 'study2026' }, { 'User-Agent': 'ShuleNotes/1 (Android 14; TECNO KI5k)' })).json();
  ck(await until(() => adminLive.events.some((e) => e.event === 'signup' && e.data.name === 'Amina Nakato')), 'a new student appears in the admin panel at once (no reload)');

  const phone = await stream(base + '/live', { Authorization: 'Bearer ' + reg.token });
  ck(phone.status === 200 && await until(() => phone.events.some((e) => e.event === 'hello')), 'the student stream opens');
  ck(await until(() => adminLive.events.some((e) => e.event === 'presence' && e.data.online === 1)), 'the admin panel sees 1 student online');

  require('./revision').bump();
  ck(await until(() => phone.events.some((e) => e.event === 'revision')), "the owner's change reaches the student's screen at once");

  const t0 = Date.now();
  await post('/auth/login', { phone: '0772123456', password: 'study2026' }, { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 Safari/537.36' });
  const kicked = await until(() => phone.events.some((e) => e.event === 'signed_out'));
  const ev = phone.events.find((e) => e.event === 'signed_out');
  ck(kicked && Date.now() - t0 < 1500, 'a sign-in on another device signs this one out AT ONCE (' + (Date.now() - t0) + ' ms)');
  ck(ev && ev.data.code === 'signed_in_elsewhere' && /Chrome on Windows/.test(ev.data.message), 'and says where the account was opened');
  ck(await until(() => phone.isClosed()), 'the signed-out stream is closed');

  const web = (await (await post('/auth/login', { phone: '0772123456', password: 'study2026' }, { 'User-Agent': 'ShuleNotes/1 (Android 14; TECNO KI5k)' })).json()).token;
  const s2 = await stream(base + '/live', { Authorization: 'Bearer ' + web });
  await until(() => s2.events.some((e) => e.event === 'hello'));
  const uid = String(db.data.users[0]._id);
  await require('./payments').grantAccess(uid, 60, 'Senior 2');
  ck(await until(() => s2.events.some((e) => e.event === 'access' && e.data.classLevel === 'Senior 2')), 'a pass added for the student reaches their screen at once');

  await post('/feedback', { type: 'idea', message: 'Please add more exams for Senior 2' }, { Authorization: 'Bearer ' + web });
  ck(await until(() => adminLive.events.some((e) => e.event === 'feedback' && /more exams/.test(e.data.message))), 'feedback appears in the admin panel at once');

  await post('/admin/users/status', { id: uid, status: 'banned' }, { Authorization: 'Bearer ' + adminToken });
  ck(await until(() => s2.events.some((e) => e.event === 'signed_out' && e.data.code === 'banned')), 'a banned student is signed out at once');

  phone.close(); s2.close(); adminLive.close();
  server.close();
  console.log(bad ? `\n${bad} FAILED` : '\nall live checks passed');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
