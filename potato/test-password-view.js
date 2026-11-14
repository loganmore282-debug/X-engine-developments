// "Show password" is OWNER ONLY: real server, fake MongoDB. The password is kept locked beside the hash; only /admin/user/password opens it, only for the owner.
const path = require('path'), Module = require('module'), fs = require('fs'), assert = require('assert');
const D = process.env.APPDIR || __dirname; process.chdir(D);
const fm = require(path.join(D, 'test-helpers', 'fake-mongodb.js'));
const o = Module._resolveFilename;
Module._resolveFilename = function (r, ...a) { return r === 'mongodb' ? path.join(D, 'test-helpers', 'fake-mongodb.js') : o.call(this, r, ...a); };
const BACK = 7400 + Math.floor(Math.random() * 400);
process.env.PORT = String(BACK); process.env.MONGODB_URI = 'mongodb://fake/app'; process.env.ADMIN_KEY = 'pwview-admin-key-1234567890'; process.env.NODE_ENV = 'development';
process.env.POTATO_SECRETS_DIR = fs.mkdtempSync(path.join(require('os').tmpdir(), 'potato-pwv-')); process.env.COOKIE_SECRETS_DIR = process.env.POTATO_SECRETS_DIR;
const L = console.log; console.log = () => {}; console.warn = () => {}; console.error = () => {};
require(path.join(D, 'server.js'));
const base = 'http://127.0.0.1:' + BACK, sleep = ms => new Promise(r => setTimeout(r, ms));
const J = async (m, p, b, tok, adm) => { const r = await fetch(base + p, { method: m, headers: Object.assign({ 'content-type': 'application/json' }, tok ? { authorization: 'Bearer ' + tok } : {}, adm ? { authorization: 'Bearer ' + (adm === true ? process.env.ADMIN_KEY : adm) } : {}), body: (b === undefined || m === 'GET') ? undefined : JSON.stringify(b) }); const t = await r.text(); let j = {}; try { j = JSON.parse(t); } catch (_) {} return { s: r.status, j, t, h: r.headers }; };
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); }; const eq = (a, b, m) => { n++; assert.deepStrictEqual(a, b, m); };
(async () => {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/health')).ok) break; } catch (_) {} await sleep(250); }
  const phone = '0701234567', pw1 = 'First pass 12';
  const su = await J('POST', '/auth/signup', { phone, password: pw1 }); eq(su.s, 200, 'signup'); await J('POST', '/register', { pin: '123456', referralCode: '' }, su.j.token);
  let uid; for (const [id, u] of fm.__stores.users) uid = id;
  const acctDoc = () => [...fm.__stores.authAccounts.values()].find(a => a.uid === uid);
  // owner sees it
  let r = await J('POST', '/admin/user/password', { userId: uid }, null, true);
  eq([r.s, r.j.available, r.j.password], [200, true, pw1], 'the owner reads the password'); ok(/no-store/.test(r.h.get('cache-control') || ''), 'and it is never cached');
  // everyone else is refused: nobody, a member, a staff login
  eq((await J('POST', '/admin/user/password', { userId: uid })).s, 401, 'no login: refused');
  r = await J('POST', '/admin/user/password', { userId: uid }, su.j.token); eq(r.s, 401, 'a member (even this one) is refused'); ok(!/First pass/.test(r.t), 'and gets nothing');
  r = await J('POST', '/admin/user/password', { userId: uid }, null, 'wrong-key'); eq(r.s, 401, 'a wrong admin key is refused');
  const mk = await J('POST', '/admin/admins/create', { username: 'clerk1', password: 'Clerk password 9' }, null, true); eq(mk.s, 200, 'staff login created: ' + JSON.stringify(mk.j));
  const sl = await J('POST', '/admin/login', { username: 'clerk1', password: 'Clerk password 9' }); ok(sl.j.token, 'staff can sign in to the panel: ' + JSON.stringify(sl.j).slice(0, 100));
  r = await J('POST', '/admin/user/password', { userId: uid }, null, sl.j.token); eq(r.s, 401, 'a STAFF login is refused (owner only)'); ok(!/First pass/.test(r.t), 'and gets nothing');
  eq((await J('POST', '/admin/user/detail', { userId: uid }, null, sl.j.token)).s < 500, true, 'staff can still open the member (no regression)');
  // what is stored: locked, not plain; never in any other answer
  const stored = acctDoc(); ok(stored.pwSealed && !stored.pwSealed.includes(pw1) && /^v1\./.test(stored.pwSealed), 'the stored copy is locked, not the plain password'); ok(/^scrypt|^\$|^s1|:/.test(stored.passwordHash), 'the login hash is still there');
  for (const [m, p, b] of [['POST', '/admin/user/detail', { userId: uid }], ['GET', '/admin/users'], ['POST', '/admin/user/referral-chain', { userId: uid }]]) { const x = await J(m, p, b, null, true); ok(!/pwSealed|passwordHash|First pass/.test(x.t), p + ' never carries the password or its copy'); }
  const me = await J('GET', '/account', null, su.j.token); ok(!/pwSealed|passwordHash|First pass/.test(me.t), 'the member\'s own account answer has none of it');
  // the look is logged, without the password
  const logs = [...fm.__stores.adminAuditLog.values()].filter(x => x.action === 'user_password_viewed'); ok(logs.length >= 1, 'every look is in the activity log'); ok(!JSON.stringify(logs).includes(pw1), 'and the log does not hold the password');
  // member changes it, owner resets it: the copy follows
  const si = await J('POST', '/auth/login', { phone, password: pw1 }); const pw2 = 'Second pass 34';
  eq((await J('POST', '/auth/password/change', { oldPassword: pw1, newPassword: pw2 }, si.j.token)).s, 200, 'member changes the password');
  eq((await J('POST', '/admin/user/password', { userId: uid }, null, true)).j.password, pw2, 'the owner sees the new one');
  const pw3 = 'Owner set 56 pass'; eq((await J('POST', '/admin/user/reset-password', { userId: uid, newPassword: pw3 }, null, true)).s, 200, 'owner resets it');
  eq((await J('POST', '/admin/user/password', { userId: uid }, null, true)).j.password, pw3, 'the owner sees the reset one');
  // an account made before this existed: no copy yet -> says so; the next sign-in stores it
  delete acctDoc().pwSealed;
  r = await J('POST', '/admin/user/password', { userId: uid }, null, true); eq([r.j.available, r.j.password], [false, undefined], 'an older account says "not stored yet" and reveals nothing');
  const si2 = await J('POST', '/auth/login', { phone, password: pw3 }); eq(si2.s, 200, 'member signs in');
  eq((await J('POST', '/admin/user/password', { userId: uid }, null, true)).j.password, pw3, 'after the next sign-in the owner can see it');
  // a wrong password does not store anything; a copy moved to another member does not open
  const before = acctDoc().pwSealed; await J('POST', '/auth/login', { phone, password: 'wrong wrong' }); eq(acctDoc().pwSealed, before, 'a failed sign-in changes nothing');
  const su2 = await J('POST', '/auth/signup', { phone: '0709876543', password: 'Other member 78' }); const uid2 = [...fm.__stores.authAccounts.values()].find(a => a.uid !== uid).uid;
  [...fm.__stores.authAccounts.values()].find(a => a.uid === uid2).pwSealed = before;
  r = await J('POST', '/admin/user/password', { userId: uid2 }, null, true); eq(r.j.available, false, 'a copy moved onto another member does not open');
  eq((await J('POST', '/admin/user/password', { userId: 'nope' }, null, true)).s, 404, 'unknown member'); eq((await J('POST', '/admin/user/password', {}, null, true)).s, 400, 'no id');
  // unit: the vault
  const pv = require(path.join(D, 'password-vault.js')), k = pv.loadKeys({ env: { ADMIN_KEY: 'a', POTATO_SECRETS_DIR: '/nonexistent' }, log: { log() {}, warn() {}, error() {} } }), c = pv.createPasswordVault(k.keys);
  const b = c.seal('u1', 'x y z'); eq([c.open('u1', b), c.open('u2', b), c.open('u1', b + 'a'), c.open('u1', 'junk')], ['x y z', null, null, null], 'vault: opens only for its member, rubbish does not open');
  const tw = require(path.join(D, 'twofa-vault.js')).createVault(require(path.join(D, 'twofa-vault.js')).loadKeys({ env: { ADMIN_KEY: 'a', POTATO_SECRETS_DIR: '/nonexistent' }, log: { log() {}, warn() {}, error() {} } }).keys);
  eq(tw.open('pw|u1', b), null, 'the Google Authenticator key cannot open a password copy (separate keys)');
  L(`PASS: owner-only Show password (${n} checks)`); process.exit(0);
})().catch(e => { L('FAIL', e.stack || e); process.exit(1); });
