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
  ck(old.body.code === 'signed_in_elsewhere' && /signed out because this account was opened on/.test(old.body.message), 'and is told why (signed_in_elsewhere)');
  ck((await call('/auth/logout', {}, A)).status === 401, 'the old device cannot sign out the new one');
  ck((await me(B)).status === 200, 'the new device is still signed in');
  ck(JSON.stringify(db.data.sessions).includes(B) === false, 'tokens are still stored only as hashes');
  ck(db.data.sessions.filter((s) => !s.replaced).length === 1, 'exactly one live session for the student');

  console.log('— sign-in alerts —');
  const sec = require('./security-notices');
  ck(sec.describeDevice('ShuleNotes/1.0.41 (Android 14; samsung SM-A155F)') === 'Shule Notes app on samsung SM-A155F', 'our app is named with the phone model');
  ck(sec.describeDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36') === 'Chrome on Windows', 'a browser is named "Chrome on Windows"');
  ck(sec.describeDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1') === 'Safari on iPhone', 'an iPhone is named "Safari on iPhone"');
  const appUa = 'ShuleNotes/1.0.41 (Android 14; TECNO KI5k)';
  const webUa = 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
  const onPhone = (await (await call('/auth/login', { phone: '0772123456', password: 'study2026' }, null, appUa)).json()).token;
  const before = (await (await call('/notices', undefined, onPhone)).json()).notices.length;
  const again = (await (await call('/auth/login', { phone: '0772123456', password: 'study2026' }, null, appUa)).json()).token;
  ck((await (await call('/notices', undefined, again)).json()).notices.length === before, 'signing in again on the SAME device adds no alert');
  const onWeb = (await (await call('/auth/login', { phone: '0772123456', password: 'study2026' }, null, webUa)).json()).token;
  const kicked = await me(again);
  ck(/Chrome on Windows/.test(kicked.body.message || ''), 'the signed-out phone is told WHERE the account was opened ("' + (kicked.body.message || '').slice(0, 70) + '…")');
  const list = (await (await call('/notices', undefined, onWeb)).json()).notices;
  ck(list.length === before + 1 && list[0].title === 'New sign-in' && /Chrome on Windows/.test(list[0].message) && /TECNO KI5k was signed out/.test(list[0].message), 'a new device adds ONE alert naming both devices');
  ck(list[0].own === true, 'the device that caused it sees it as "this device" (not unread)');
  const back = (await (await call('/auth/login', { phone: '0772123456', password: 'study2026' }, null, appUa)).json()).token;
  const onPhoneList = (await (await call('/notices', undefined, back)).json()).notices;
  ck(onPhoneList.some((n) => /Chrome on Windows/.test(n.message) && !n.own), 'back on the phone, the student sees that Chrome on Windows opened the account');
  ck((await call('/notices')).status === 401, 'nobody else can read them');

  console.log('— payment history —');
  const uid = String(db.data.users.find((u) => u.phone === '+256772123456' || /772123456/.test(u.phone))._id);
  await db.collection('payments').insertOne({ userId: uid, planName: '1 week', amount: 5000, status: 'paid', createdAt: new Date(Date.now() - 3600000), grantedUntil: new Date(Date.now() + 6 * 86400000) });
  await db.collection('payments').insertOne({ userId: uid, planName: '1 day', amount: 1500, status: 'failed', createdAt: new Date() });
  await db.collection('payments').insertOne({ userId: uid, planName: 'Gift', amount: 9999, manual: true, status: 'paid', createdAt: new Date(Date.now() - 7200000) });
  await db.collection('payments').insertOne({ userId: 'someone-else', planName: '1 month', amount: 12500, status: 'paid', createdAt: new Date() });
  const hist = (await (await call('/payments/mine', undefined, back)).json()).payments;
  ck(hist.length === 3 && hist[0].status === 'failed' && hist[1].amount === 5000 && hist[2].gift === true && hist[2].amount === 0, 'a student sees only their own payments, newest first, gifts at 0');

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
