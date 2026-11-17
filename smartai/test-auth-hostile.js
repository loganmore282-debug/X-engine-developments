'use strict';
// Authentication on the real server with hostile input: every way of writing a phone number is ONE account, bad phones / passwords / bodies / operator injection are refused,
// 12 signups of one number at once make one account, tokens that are tampered / unsigned / revoked (after a password change or a ban) are refused, many wrong guesses lock
// even the right password, registering twice never makes a second profile, referral codes in any case attach, a member is never their own referrer.
//   node test-auth-hostile.js
// shared boot for the probes: the real server on the in-memory database
const path = require('path'), Module = require('module'), fs = require('fs');
const root = __dirname; process.chdir(root);
const fm = require(root + '/test-helpers/fake-mongodb.js');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...a) { return req === 'mongodb' ? path.join(root, 'test-helpers', 'fake-mongodb.js') : origResolve.call(this, req, ...a); };
const BACK = 4100 + Math.floor(Math.random() * 500), AK = 'probe-admin-key-123456';
Object.assign(process.env, { PORT: String(BACK), MONGODB_URI: 'mongodb://fake/app', ADMIN_KEY: AK, NODE_ENV: 'development', POTATO_SECRETS_DIR: fs.mkdtempSync(require('os').tmpdir() + '/pr-') });
const realLog = console.log, serverErrors = [];
console.log = () => {}; console.warn = () => {}; console.error = (...a) => { serverErrors.push(a.map(x => (x && x.message) || String(x)).join(' ').slice(0, 300)); };
require(root + '/server.js');
const base = 'http://127.0.0.1:' + BACK, sleep = ms => new Promise(r => setTimeout(r, ms));
const J = async (m, p, b, tok, adm) => { const r = await fetch(base + p, { method: m, headers: Object.assign({ 'content-type': 'application/json' }, tok ? { authorization: 'Bearer ' + tok } : {}, adm ? { authorization: 'Bearer ' + AK } : {}), body: (b !== undefined && b !== null && m !== 'GET') ? JSON.stringify(b) : undefined }); let j = null; try { j = await r.json(); } catch (_) {} return { s: r.status, j }; };
const ready = async () => { for (let i = 0; i < 80; i++) { try { if ((await fetch(base + '/health')).ok) return; } catch (_) {} await sleep(250); } };
let pass = 0, fail = 0;
const chk = (c, m, x) => { if (c) { pass++; realLog('  ok   - ' + m); } else { fail++; realLog('  FAIL - ' + m + (x !== undefined ? ' ' + JSON.stringify(x).slice(0, 260) : '')); } };


(async () => {
  await ready();
  let r;
  // phone variants are one account
  r = await J('POST', '/auth/signup', { phone: '0771230001', password: 'secret12' }); chk(r.s === 200 && r.j.token, 'signup works', r);
  for (const v of ['771230001', '+256771230001', '256771230001', '0771 230 001', '0771-230-001']) { r = await J('POST', '/auth/signup', { phone: v, password: 'secret12' }); chk(r.s === 409, 'same number written as ' + v + ' is the same account (409)', r.s); }
  // invalid phones
  for (const v of ['', '123', '0701234', 'abcdefghij', null, {}, [], '0'.repeat(500), '07712300019999', '0171230001', '+1 202 555 0100', '0771230001; DROP', '<b>0771230001</b>']) { r = await J('POST', '/auth/signup', { phone: v, password: 'secret12' }); chk(r.s === 400 || r.s === 409, 'bad phone ' + JSON.stringify(v).slice(0, 30) + ' refused (' + r.s + ')', r.j && r.j.code); }
  // passwords
  for (const pw of ['', 'short', 'a'.repeat(1000), {}, [], null, '       ']) { r = await J('POST', '/auth/signup', { phone: '0771230002', password: pw }); chk(r.s === 400, 'bad password ' + JSON.stringify(pw).slice(0, 20) + ' refused (' + r.s + ')', r.j && r.j.code); }
  // body shapes
  for (const b of [undefined, null, [], 'x', 5]) { r = await fetch('http://127.0.0.1:' + String(BACK) + '/auth/signup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: b === undefined ? '' : JSON.stringify(b) }); chk(r.status >= 400 && r.status < 500, 'odd body ' + JSON.stringify(b) + ' gives a client error (' + r.status + ')'); }
  // concurrent signups of one number
  const rs = await Promise.all(Array.from({ length: 12 }, () => J('POST', '/auth/signup', { phone: '0771230003', password: 'secret12' })));
  chk(rs.filter(x => x.s === 200).length === 1 && rs.filter(x => x.s === 409).length === 11, '12 simultaneous signups of one number: exactly one account', rs.map(x => x.s));
  // injection in login
  for (const b of [{ phone: { $ne: null }, password: { $ne: null } }, { phone: '0771230001', password: { $gt: '' } }, { phone: ['0771230001'], password: 'secret12' }]) { r = await J('POST', '/auth/login', b); chk(r.s === 400 || r.s === 401, 'operator injection in login refused (' + r.s + ')', r.j && r.j.code); }
  // login ok + wrong
  r = await J('POST', '/auth/login', { phone: '0771230001', password: 'secret12' }); chk(r.s === 200 && r.j.token, 'login works');
  const tok = r.j.token, uid = r.j.uid;
  r = await J('POST', '/auth/login', { phone: '771230001', password: 'secret12 ' }); chk(r.s === 200, 'a stray trailing space in the password still signs in (the app tidies it)', r.s);
  r = await J('POST', '/auth/login', { phone: '0771239999', password: 'secret12' }); chk(r.s === 401 && r.j.code === 'INVALID_CREDENTIAL', 'unknown number and wrong password give the same answer', r.j);
  // session
  r = await J('POST', '/auth/session/activity', {}, tok); chk(r.s === 200, 'session is valid');
  r = await J('POST', '/auth/session/activity', {}, tok + 'x'); chk(r.s === 401, 'a tampered token is refused');
  r = await J('POST', '/auth/session/activity', {}, 'null'); chk(r.s === 401, 'token "null" refused');
  r = await J('POST', '/auth/session/activity', {}, 'eyJhbGciOiJub25lIn0.eyJ1aWQiOiJ4In0.'); chk(r.s === 401, 'an unsigned (alg none) token refused');
  // register
  r = await J('POST', '/register', { referralCode: '' }, tok); chk(r.s === 200, 'register', r);
  const regs = await Promise.all(Array.from({ length: 6 }, () => J('POST', '/register', { referralCode: '' }, tok)));
  chk(regs.every(x => x.s === 200 || x.s === 409) && [...fm.__stores.users.values()].filter(u => u.phone && u.phone.endsWith('771230001')).length === 1, 'registering again / 6 at once never makes a second profile', regs.map(x => x.s));
  const me = await J('GET', '/account', null, tok); chk(me.s === 200 && me.j.account && me.j.account.walletBalance !== undefined, 'account loads');
  // referral edge cases
  const code = (fm.__stores.users.get(uid) || {}).referralCode; chk(/^[A-Z0-9]{6}$/.test(code || ''), 'the member got a 6-character referral code', code);
  const s2 = await J('POST', '/auth/signup', { phone: '0771230004', password: 'secret12' });
  r = await J('POST', '/register', { referralCode: code.toLowerCase() }, s2.j.token); chk(r.s === 200 && fm.__stores.users.get(s2.j.uid).referredBy === uid, 'a referral code typed in lower case still attaches', fm.__stores.users.get(s2.j.uid) && fm.__stores.users.get(s2.j.uid).referredBy);
  const s3 = await J('POST', '/auth/signup', { phone: '0771230005', password: 'secret12' });
  r = await J('POST', '/register', { referralCode: 'ZZZZZZ' }, s3.j.token); chk(r.s === 200 || r.s === 400, 'a wrong referral code does not crash (' + r.s + ')', r.j && r.j.message);
  r = await J('POST', '/register', { referralCode: { $ne: 1 } }, (await J('POST', '/auth/signup', { phone: '0771230006', password: 'secret12' })).j.token); chk(r.s < 500, 'an object as referral code does not crash (' + r.s + ')');
  // self referral
  const s4 = await J('POST', '/auth/signup', { phone: '0771230007', password: 'secret12' });
  await J('POST', '/register', { referralCode: '' }, s4.j.token); const c4 = fm.__stores.users.get(s4.j.uid).referralCode;
  r = await J('POST', '/register', { referralCode: c4 }, s4.j.token); chk(fm.__stores.users.get(s4.j.uid).referredBy !== s4.j.uid, 'a member can never be their own referrer');
  // password change revokes sessions
  r = await J('POST', '/auth/password/change', { oldPassword: 'wrong', newPassword: 'newsecret1' }, tok); chk(r.s === 401, 'password change needs the old password');
  r = await J('POST', '/auth/password/change', { oldPassword: 'secret12', newPassword: 'newsecret1' }, tok); chk(r.s === 200, 'password change works');
  r = await J('POST', '/auth/session/activity', {}, tok); chk(r.s === 401, 'after a password change the old session is dead');
  r = await J('POST', '/auth/login', { phone: '0771230001', password: 'secret12' }); chk(r.s === 401, 'the old password no longer works');
  r = await J('POST', '/auth/login', { phone: '0771230001', password: 'newsecret1' }); chk(r.s === 200, 'the new one does');
  const tok2 = r.j.token;
  // lockout
  for (let i = 0; i < 12; i++) await J('POST', '/auth/login', { phone: '0771230001', password: 'bad' + i });
  r = await J('POST', '/auth/login', { phone: '0771230001', password: 'newsecret1' }); chk(r.s === 429, 'after many wrong guesses even the right password waits (' + r.s + ')');
  // ban
  const b = await J('POST', '/auth/signup', { phone: '0771230008', password: 'secret12' }); await J('POST', '/register', { referralCode: '' }, b.j.token);
  r = await J('POST', '/admin/ban', { userId: b.j.uid, action: 'ban' }, null, true); realLog('  (ban route answered', r.s, JSON.stringify(r.j).slice(0, 80) + ')');
  r = await J('GET', '/account', null, b.j.token); chk(r.s === 401 || r.s === 403, 'a banned member\'s session is ended: the account call is refused', [r.s, r.j && r.j.code]);
  r = await J('POST', '/invest/create', { tierKey: 'x' }, b.j.token); chk(r.s !== 200, 'a banned member cannot buy');
  chk(serverErrors.length === 0, 'the server logged no error', serverErrors.slice(0, 4));
  realLog(fail ? `FAIL: ${fail} failed` : `PASS: authentication with hostile input (${pass} checks)`); process.exit(fail ? 1 : 0);
})().catch(e => { realLog('CRASH', e.stack); process.exit(1); });
