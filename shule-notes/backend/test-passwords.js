#!/usr/bin/env node
/**
 * Passwords are bcrypt. Run for real: the hash format and cost, the 72-byte limit, old scrypt accounts still sign in and are
 * upgraded to bcrypt the moment they do (nobody has to reset anything), and the same time is spent whether or not an account exists.
 */
'use strict';
process.env.UPLOAD_DIR = require('os').tmpdir() + '/shule-notes-test-pw-' + Date.now();
process.env.ADMIN_KEY = 'test-admin-key-123456';
const crypto = require('crypto');
const { makeDb, stubDb } = require('./fake-mongo.testlib');
const db = makeDb(); stubDb(db);
const auth = require('./auth');

let bad = 0;
const ck = (ok, label) => { if (!ok) bad++; console.log((ok ? 'PASS  ' : 'FAIL  ') + label); };

(async () => {
  console.log('— the hash —');
  const h = await auth.hashPassword('correct horse battery');
  ck(/^\$2[ab]\$12\$[./A-Za-z0-9]{53}$/.test(h), 'a password is stored as a bcrypt hash with cost 12 (' + h.slice(0, 7) + '…)');
  ck(h !== await auth.hashPassword('correct horse battery'), 'two hashes of the same password differ (the salt is inside each)');
  ck(await auth.verifyPassword('correct horse battery', h) && !(await auth.verifyPassword('wrong', h)) && !(await auth.verifyPassword('', h)), 'right password verifies; wrong and empty ones do not');
  ck(!(await auth.verifyPassword('x', '$2b$12$short')) && !(await auth.verifyPassword('x', null)), 'a broken stored value fails safely');
  ck(auth.needsRehash(h) === false && auth.needsRehash('salt:hash') === true && auth.needsRehash('$2b$08$' + 'a'.repeat(53)) === true, 'only an old-format or lower-cost hash is flagged for upgrade');
  ck(auth.tooLong('a'.repeat(72)) === false && auth.tooLong('a'.repeat(73)) === true && auth.tooLong('é'.repeat(37)) === true, 'the 72-BYTE limit counts bytes, not letters');

  console.log('— old accounts keep working and are upgraded —');
  const legacy = 'aabbccddeeff00112233445566778899:' + crypto.scryptSync('old-password', 'aabbccddeeff00112233445566778899', 64).toString('hex');
  ck(await auth.verifyPassword('old-password', legacy) && !(await auth.verifyPassword('nope', legacy)), 'an old scrypt password still verifies');

  const { app } = require('./server');
  const server = app.listen(0); const base = 'http://127.0.0.1:' + server.address().port;
  const post = (url, body) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  await db.collection('users').insertOne({ name: 'Old Student', phone: '0772000001', passwordHash: legacy, status: 'active', createdAt: new Date() });
  const bad1 = await post('/auth/login', { phone: '0772000001', password: 'nope' });
  ck(bad1.status === 401 && db.data.users[0].passwordHash === legacy, 'a wrong password fails and changes nothing');
  const r = await post('/auth/login', { phone: '0772000001', password: 'old-password' });
  ck(r.status === 200, 'the old account signs in with its old password');
  await new Promise((res) => setTimeout(res, 800));
  const upgraded = db.data.users[0].passwordHash;
  ck(/^\$2[ab]\$12\$/.test(upgraded) && upgraded !== legacy, 'and its password is now stored as bcrypt');
  ck((await post('/auth/login', { phone: '0772000001', password: 'old-password' })).status === 200, 'the same password still works after the upgrade');

  console.log('— new accounts, limits, timing —');
  const reg = await post('/auth/register', { name: 'New Student', phone: '0772000002', password: 'brand-new-secret' });
  ck(reg.status === 200 && /^\$2[ab]\$12\$/.test(db.data.users[1].passwordHash), 'a new account is stored as bcrypt from the start');
  const long = await post('/auth/register', { name: 'Long Pass', phone: '0772000003', password: 'x'.repeat(73) });
  ck(long.status === 400 && /72/.test((await long.json()).message), 'a password over 72 bytes is refused at sign-up, not silently cut');
  await auth.dummyHash();
  const time = async (phone) => { const t = process.hrtime.bigint(); await post('/auth/login', { phone, password: 'wrong-password-1' }); return Number(process.hrtime.bigint() - t) / 1e6; };
  const real = await time('0772000002'); const ghost = await time('0799999999');
  ck(Math.abs(real - ghost) < Math.max(real, ghost) * 0.5, `a wrong password for a real account (${real.toFixed(0)} ms) and for a missing account (${ghost.toFixed(0)} ms) take about the same time`);

  server.close();
  console.log(bad ? `\n${bad} FAILED` : '\nall password checks passed');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('crashed:', e); process.exit(1); });
