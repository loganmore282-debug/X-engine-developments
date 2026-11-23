#!/usr/bin/env node
/**
 * Speed features, run for real through the HTTP routes: the library is sent once and then as 304s, answers are
 * compressed, the session cache never delays a sign-out or a ban, a PDF can be fetched in ranges and unchanged
 * copies cost nothing, and a quick look-ahead does not count as a read.
 */
'use strict';
process.env.UPLOAD_DIR = require('os').tmpdir() + '/shule-notes-test-perf-' + Date.now();
process.env.ADMIN_KEY = 'test-admin-key-123456';
const { makeDb, stubDb } = require('./fake-mongo.testlib');
const db = makeDb(); stubDb(db);
const fs = require('fs'); const path = require('path');
const { hashPassword, createSession, resolveSession, destroySession } = require('./auth');
const admin = require('./admin-data');
const perf = require('./perf');
const revision = require('./revision');

let bad = 0;
const ck = (ok, label) => { if (!ok) bad++; console.log((ok ? 'PASS  ' : 'FAIL  ') + label); };

(async () => {
  const { app } = require('./server');
  const server = app.listen(0); const base = 'http://127.0.0.1:' + server.address().port;
  const get = (url, token, headers = {}) => fetch(base + url, { headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers } });

  const uid = String((await db.collection('users').insertOne({ name: 'Amina', phone: '0772000001', passwordHash: await hashPassword('x1y2z3'), classLevel: 'Senior 2', createdAt: new Date() })).insertedId);
  const token = (await createSession(uid)).token;
  const { PDFDocument } = require('pdf-lib');
  const doc = await PDFDocument.create(); for (let i = 0; i < 6; i++) doc.addPage([300, 300]);
  fs.mkdirSync(path.join(process.env.UPLOAD_DIR, 'notes'), { recursive: true });
  fs.writeFileSync(path.join(process.env.UPLOAD_DIR, 'notes', 'a.pdf'), Buffer.from(await doc.save()));
  for (let i = 0; i < 60; i++) await db.collection('notes').insertOne({ title: 'Note number ' + i + ' about photosynthesis and cells', description: 'A short summary of this note for revision', fileName: 'a.pdf', active: true, textStatus: 'ready', extractedText: 'x', pageCount: 6, uploadedAt: new Date(Date.now() - i * 1000), views: i });
  const noteRow = await db.collection('notes').findOne({ title: 'Note number 0 about photosynthesis and cells' });
  const noteId = String(noteRow._id);

  console.log('— the library is sent once, then as 304s —');
  let reads = 0; const realFind = db.collection('notes').find;
  const first = await get('/notes', token, { 'Accept-Encoding': 'identity' });
  const etag = first.headers.get('etag'); const full = await first.text();
  ck(first.status === 200 && etag && JSON.parse(full).notes.length === 60, 'the first request gets the full library with an ETag');
  const again = await get('/notes', token, { 'If-None-Match': etag });
  ck(again.status === 304 && (await again.text()) === '', 'asking again with that ETag gets a 304 and no body');
  const other = await createSession(uid, { single: false });
  const elseTok = await get('/notes', other.token, { 'If-None-Match': etag });
  ck(elseTok.status === 304, 'another device of the same student shares the same copy');
  // an owner change must show up at once
  await db.collection('notes').insertOne({ title: 'Brand new note', fileName: 'a.pdf', active: true, textStatus: 'ready', extractedText: 'x', pageCount: 1, uploadedAt: new Date() });
  revision.bump();
  const changed = await get('/notes', token, { 'If-None-Match': etag });
  ck(changed.status === 200 && JSON.parse(await changed.text()).notes.length === 61, 'after the owner changes something the new library is sent straight away');
  const sub = await get('/notes?subjectId=zzzz', token);
  ck(sub.status === 400, 'a bad subject filter is still refused');

  console.log('— compression —');
  const zipped = await get('/notes', token, { 'Accept-Encoding': 'gzip' });
  const zlen = Number(zipped.headers.get('content-length') || 0);
  ck(zipped.headers.get('content-encoding') === 'gzip', 'JSON is sent gzip-compressed');
  await zipped.arrayBuffer();
  const wire = await new Promise((resolve) => {
    require('http').get(base + '/notes', { headers: { Authorization: 'Bearer ' + token, 'Accept-Encoding': 'gzip' } }, (r) => { let n = 0; r.on('data', (c) => { n += c.length; }); r.on('end', () => resolve(n)); });
  });
  ck(wire < full.length / 3, `and is under a third of its size on the wire (${wire} bytes instead of ${full.length})`);
  const levels = await get('/levels'); const lt = levels.headers.get('etag');
  ck((await get('/levels', null, { 'If-None-Match': lt })).status === 304, 'the class list is a 304 once known');

  console.log('— signing out and bans are not delayed by the session cache —');
  const t1 = (await createSession(uid)).token;
  ck((await resolveSession(t1)) === uid && (await resolveSession(t1)) === uid, 'a session is found (and remembered)');
  await destroySession(t1);
  ck((await resolveSession(t1)) === null, 'after signing out it is refused at once');
  const t2 = (await createSession(uid, { single: false })).token;
  ck((await get('/auth/me', t2)).status === 200, 'a second session works');
  await admin.setUserStatus(uid, 'banned');
  ck((await get('/auth/me', t2)).status === 401 && (await get('/notes', token)).status === 401, 'after a ban every device is refused at once');

  console.log('— the PDF —');
  await admin.setUserStatus(uid, 'active');
  const tok = (await createSession(uid)).token;
  const views = async () => (await db.collection('notes').findOne({ _id: noteRow._id })).views;
  const v0 = await views();
  const full1 = await get(`/notes/${noteId}/file`, tok);
  const body = Buffer.from(await full1.arrayBuffer());
  ck(full1.status === 200 && body.slice(0, 5).toString() === '%PDF-' && full1.headers.get('accept-ranges') === 'bytes', 'the PDF is served and can be resumed (Accept-Ranges)');
  await new Promise((r) => setTimeout(r, 50));
  ck((await views()) === v0 + 1, 'opening it counts as one read');
  const lastMod = full1.headers.get('last-modified'); const et = full1.headers.get('etag');
  // (a raw request: fetch() itself adds "Cache-Control: no-cache" to conditional requests, which a phone's HTTP client does not)
  const status = await new Promise((resolve) => require('http').get(base + `/notes/${noteId}/file`, { headers: { Authorization: 'Bearer ' + tok, 'If-None-Match': et } }, (r) => { r.resume(); resolve(r.statusCode); }));
  ck(status === 304, 'a phone that already has this copy gets a 304 (no download)');
  const part = await get(`/notes/${noteId}/file`, tok, { Range: 'bytes=0-99' });
  ck(part.status === 206 && (await part.arrayBuffer()).byteLength === 100, 'a broken download can be resumed with a byte range');
  const v1 = await views();
  await get(`/notes/${noteId}/file?prefetch=1`, tok); await new Promise((r) => setTimeout(r, 50));
  ck((await views()) === v1, 'a look-ahead (prefetch) does not count as a read');

  console.log('— shared answers build once for many callers —');
  perf.clear(); let builds = 0;
  const results = await Promise.all(Array.from({ length: 50 }, () => perf.shared('k', 1000, async () => { builds++; await new Promise((r) => setTimeout(r, 20)); return { a: 1 }; })));
  ck(builds === 1 && results.every((r) => r === results[0]), 'fifty students asking at the same instant cause ONE database read');

  server.close();
  console.log(bad ? `\n${bad} FAILED` : '\nall speed checks passed');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('crashed:', e); process.exit(1); });
