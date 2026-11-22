#!/usr/bin/env node
/**
 * The admin panel's sign-in and defences, through the real routes: keys only at sign-in, session tokens that expire and
 * can be revoked, lockouts, nothing reaches an upload without signing in, the key is refused in a URL or body,
 * two-step codes (including RFC 6238's own test numbers, replay refusal and the key-alone-is-not-enough rule), allowed IPs.
 */
'use strict';
process.env.UPLOAD_DIR = require('os').tmpdir() + '/shule-notes-test-sec-' + Date.now();
process.env.ADMIN_KEY = 'a-long-test-admin-key-with-lots-of-characters-123';
const { makeDb, stubDb } = require('./fake-mongo.testlib');
const db = makeDb(); stubDb(db);
const totp = require('./totp');
const session = require('./admin-session');

let bad = 0;
const ck = (ok, label) => { if (!ok) bad++; console.log((ok ? 'PASS  ' : 'FAIL  ') + label); };
const KEY = process.env.ADMIN_KEY;

(async () => {
  console.log('— the code generator —');
  ck(totp.hotp(totp.base32Decode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'), 1) === '287082', "matches RFC 6238's own test number (287082)");
  const sec = totp.generateSecret(); const now = Date.now(); const c = totp.hotp(totp.base32Decode(sec), Math.floor(now / 30000));
  ck(totp.verify(sec, c, now) !== null && totp.verify(sec, '000000', now) === null && totp.verify(sec, 'abcdef', now) === null, 'the right code is accepted; wrong and junk codes are not');

  const { app } = require('./server');
  const server = app.listen(0); const base = 'http://127.0.0.1:' + server.address().port;
  const post = (url, body, headers = {}) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body || {}) });
  const login = (key, code) => post('/admin/login', { key, code });

  console.log('— signing in —');
  const wrong = await login('not-the-key');
  ck(wrong.status === 401, 'a wrong key is refused');
  const ok = await (await login(KEY)).json();
  ck(ok.status === 'success' && ok.token && ok.token.length === 64, 'the right key gives a session token');
  const tok = ok.token; const S = { Authorization: 'Bearer ' + tok };
  ck(JSON.stringify(db.data.adminSessions).includes(tok) === false, 'the token itself is never stored (only its hash)');
  ck((await post('/admin/stats', {}, S)).status === 200, 'the token opens the panel');
  ck((await post('/admin/stats', {})).status === 401, 'no token, no key: refused');
  ck((await post('/admin/stats', {}, { Authorization: 'Bearer ' + 'f'.repeat(64) })).status === 401, 'a made-up token is refused');
  ck((await post('/admin/stats', {}, { 'x-admin-key': KEY })).status === 200, 'scripts may still send the key in a header (while two-step is off)');

  console.log('— the key is never taken from a URL or the body —');
  ck((await post('/admin/stats?adminKey=' + encodeURIComponent(KEY), {})).status === 401, 'the key in the web address is refused');
  ck((await post('/admin/stats', { adminKey: KEY })).status === 401, 'the key in the request body is refused');

  console.log('— uploads need signing in FIRST —');
  const boundary = '----x'; const big = Buffer.alloc(2 * 1024 * 1024, 65);
  const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\nx\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.pdf"\r\nContent-Type: application/pdf\r\n\r\n`), big, Buffer.from(`\r\n--${boundary}--\r\n`)]);
  const up = await fetch(base + '/admin/notes/upload', { method: 'POST', headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary }, body });
  ck(up.status === 401, 'an upload with no sign-in is refused before the file is even read');

  console.log('— sessions end —');
  const sessions = await (await post('/admin/security/status', {}, S)).json();
  ck(sessions.sessions.length >= 1 && sessions.sessions.some((s) => s.current), 'the panel lists signed-in devices and marks this one');
  ck(sessions.keyWeak === false, 'a long key is not flagged');
  await post('/admin/logout', {}, S);
  session._reset();
  ck((await post('/admin/stats', {}, S)).status === 401, 'after signing out the token stops working at once');
  const t2 = (await (await login(KEY)).json()).token;
  const row = db.data.adminSessions.find((r) => r.tokenHash);
  row.lastSeen = new Date(Date.now() - 9 * 3600 * 1000); session._reset();
  ck((await post('/admin/stats', {}, { Authorization: 'Bearer ' + t2 })).status === 401, 'a session idle for 9 hours has ended');
  const t3 = (await (await login(KEY)).json()).token;
  db.data.adminSessions.forEach((r) => { r.lastSeen = new Date(); r.expiresAt = new Date(Date.now() - 1000); }); session._reset();
  ck((await post('/admin/stats', {}, { Authorization: 'Bearer ' + t3 })).status === 401, 'a session older than 3 days has ended');
  const t4 = (await (await login(KEY)).json()).token; const t5 = (await (await login(KEY)).json()).token;
  const r = await (await post('/admin/security/sessions/revoke-others', {}, { Authorization: 'Bearer ' + t4 })).json();
  ck(r.count >= 1 && (await post('/admin/stats', {}, { Authorization: 'Bearer ' + t5 })).status === 401 && (await post('/admin/stats', {}, { Authorization: 'Bearer ' + t4 })).status === 200, '"sign out other devices" ends the others and keeps this one');

  console.log('— two-step sign-in —');
  const S4 = { Authorization: 'Bearer ' + t4 };
  const begin = await (await post('/admin/security/2fa/begin', {}, S4)).json();
  ck(begin.secret && /^otpauth:\/\/totp\//.test(begin.uri), 'set-up gives a key for the authenticator app');
  ck((await post('/admin/security/2fa/enable', { code: '123456' }, S4)).status === 400, 'switching it on needs a real code first');
  const code = () => totp.hotp(totp.base32Decode(begin.secret), Math.floor(Date.now() / 30000));
  ck((await post('/admin/security/2fa/enable', { code: code() }, S4)).status === 200, 'with a real code it switches on');
  session._reset();
  ck((await post('/admin/stats', {}, { 'x-admin-key': KEY })).status === 401, 'now the key in a header opens NOTHING (the code is needed)');
  const noCode = await login(KEY); const nc = await noCode.json();
  ck(noCode.status === 401 && nc.needCode === true, 'the key alone asks for the code');
  ck((await login(KEY, '000000')).status === 401, 'a wrong code is refused');
  const goodLogin = await login(KEY, code());
  ck(goodLogin.status === 200, 'key + right code signs in');
  const replay = await login(KEY, code());
  ck(replay.status === 401, 'the same code cannot be used twice (no replay)');
  const sessTok = (await goodLogin.json()).token;
  ck((await post('/admin/security/2fa/disable', { code: '111111' }, { Authorization: 'Bearer ' + sessTok })).status === 400, 'switching it off needs a code too');
  process.env.ADMIN_DISABLE_2FA = '1'; session._reset();
  ck((await post('/admin/stats', {}, { 'x-admin-key': KEY })).status === 200, 'emergency: ADMIN_DISABLE_2FA=1 on the server switches it off if the phone is lost');
  delete process.env.ADMIN_DISABLE_2FA; session._reset();

  console.log('— lockout —');
  await db.collection('settings').updateOne({ _id: 'admin-security' }, { $set: { totpEnabled: false } }); session._reset();
  let last;
  for (let i = 0; i < 5; i++) last = await login('guess-' + i);
  const locked = await login(KEY);
  const lm = await locked.json();
  ck(locked.status === 429 && /Try again in/.test(lm.message), 'after 5 wrong tries even the RIGHT key is refused for a while');
  ck(last.status === 401, '(the first five were plain wrong-key answers)');
  const log = db.data.auditLog.map((e) => e.action);
  ck(log.filter((a) => a === 'Failed admin sign-in').length >= 5 && log.includes('Signed in to the admin panel'), 'failed and successful sign-ins are written to the activity log');
  ck(!JSON.stringify(db.data.auditLog).includes(KEY), 'and the key is never written anywhere in it');
  session._reset();

  console.log('— allowed addresses —');
  process.env.ADMIN_ALLOWED_IPS = '203.0.113.9';
  ck((await login(KEY)).status === 403, 'with ADMIN_ALLOWED_IPS set, any other address is turned away');
  process.env.ADMIN_ALLOWED_IPS = '127.0.0.1,::1,::ffff:127.0.0.1';
  ck((await login(KEY)).status === 200, 'an allowed address still works');
  delete process.env.ADMIN_ALLOWED_IPS;
  const h = await post('/admin/stats', {}, { 'x-admin-key': KEY });
  ck(h.headers.get('cache-control') === 'no-store', 'admin answers are marked no-store (never kept by a browser or proxy)');

  server.close();
  console.log(bad ? `\n${bad} FAILED` : '\nall admin-security checks passed');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('crashed:', e); process.exit(1); });
