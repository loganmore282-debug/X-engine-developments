#!/usr/bin/env node
/**
 * One device at a time, through the real routes: a new sign-in signs every older device out at once (even inside the 5-second
 * session memory), the old device is told WHY, sign-ins that race leave exactly one winner, the owner can switch it off,
 * another student is never affected, and a sign-out on the old device cannot sign out the new one.
 */
'use strict';
process.env.UPLOAD_DIR = require('os').tmpdir() + '/shule-notes-test-sd-' + Date.now();
process.env.ADMIN_KEY = 'a-long-test-admin-key-with-lots-of-characters-123';
const { makeDb, stubDb } = require('./fake-mongo.testlib');
const db = makeDb(); stubDb(db);
const settings = require('./settings');
let bad = 0;
const ck = (ok, label) => { if (!ok) bad++; console.log((ok ? 'PASS  ' : 'FAIL  ') + label); };

(async () => {
  const { app } = require('./server');
  const server = app.listen(0); const base = 'http://127.0.0.1:' + server.address().port;
  const call = (url, body, token, ua) => fetch(base + url, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(ua ? { 'User-Agent': ua } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const me = async (t) => { const r = await call('/auth/me', undefined, t); return { status: r.status, body: await r.json().catch(() => ({})) }; };

  const reg = await (await call('/auth/register', { name: 'Amina Nakato', phone: '0772123456', password: 'study2026' })).json();
  const phone = await call('/auth/login', { phone: '0772123456', password: 'study2026' }, null, 'Phone A');
  const A = (await phone.json()).token;
  ck((await me(A)).status === 200, 'the first device is signed in');
  ck((await me(reg.token)).status === 401, 'the sign-up session from before was replaced by this sign-in');

  const laptop = await (await call('/auth/login', { phone: '0772123456', password: 'study2026' }, null, 'Laptop B')).json();
  const B = laptop.token;
  ck((await me(B)).status === 200, 'the new device works');
  const old = await me(A);
  ck(old.status === 401, 'the OLD device is refused on its very next request (not after the 5 s memory)');
  ck(old.body.code === 'signed_in_elsewhere' && /another device/.test(old.body.message), 'and is told why (signed_in_elsewhere)');
  ck((await call('/auth/logout', {}, A)).status === 401, 'the old device cannot sign out the new one');
  ck((await me(B)).status === 200, 'the new device is still signed in');
  ck(JSON.stringify(db.data.sessions).includes(B) === false, 'tokens are still stored only as hashes');
  ck(db.data.sessions.filter((s) => !s.replaced).length === 1, 'exactly one live session for the student');

  console.log('— another student is never touched —');
  const other = await (await call('/auth/register', { name: 'Brian Okello', phone: '0701222333', password: 'another2026' })).json();
  await call('/auth/login', { phone: '0772123456', password: 'study2026' });
  ck((await me(other.token)).status === 200, "signing in as one student leaves another student's device alone");

  console.log('— two sign-ins racing —');
  const [x, y] = await Promise.all([1, 2].map(() => call('/auth/login', { phone: '0772123456', password: 'study2026' }).then((r) => r.json())));
  const live = [(await me(x.token)).status, (await me(y.token)).status].filter((s) => s === 200).length;
  ck(live === 1, 'two sign-ins at the same moment leave exactly one winner (' + live + ')');

  console.log('— the owner can switch it off —');
  await settings.saveSettings({ singleDevice: false });
  const t1 = (await (await call('/auth/login', { phone: '0772123456', password: 'study2026' })).json()).token;
  const t2 = (await (await call('/auth/login', { phone: '0772123456', password: 'study2026' })).json()).token;
  ck((await me(t1)).status === 200 && (await me(t2)).status === 200, 'with the setting off, several devices may stay signed in');
  await settings.saveSettings({ singleDevice: true });

  console.log('— old rows do not pile up —');
  const rows = db.data.sessions;
  for (const r of rows) if (r.replaced) r.replacedAt = new Date(Date.now() - 8 * 86400000);
  await call('/auth/login', { phone: '0772123456', password: 'study2026' });
  ck(db.data.sessions.every((s) => !s.replaced || s.replacedAt > new Date(Date.now() - 7 * 86400000)), 'a device signed out more than a week ago is forgotten');

  server.close();
  console.log(bad ? `\n${bad} FAILED` : '\nAll single-device checks passed');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
