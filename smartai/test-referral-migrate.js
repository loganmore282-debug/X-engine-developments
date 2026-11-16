'use strict';
// Members who already have a referral code in the old format are moved to the new 6-character format by the server itself at start-up, and the OLD code still finds them.
//   node test-referral-migrate.js
const path = require('path'), Module = require('module');
const root = __dirname;
const fm = require('./test-helpers/fake-mongodb.js');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...a) { return req === 'mongodb' ? path.join(root, 'test-helpers', 'fake-mongodb.js') : origResolve.call(this, req, ...a); };
const PORT = 4300 + Math.floor(Math.random() * 90);
process.env.PORT = String(PORT); process.env.MONGODB_URI = 'mongodb://fake/smartai'; process.env.ADMIN_KEY = 'refmig-admin-key-123456'; process.env.NODE_ENV = 'development';
const realLog = console.log; console.log = () => {}; console.warn = () => {};
const errs = []; console.error = (...a) => errs.push(a.join(' ').slice(0, 200));
// members that exist BEFORE the server starts
const users = new Map(); fm.__stores.users = users;
const mk = (id, code) => users.set(id, { _id: id, phone: '07700000' + id.slice(-2), status: 'active', registrationDone: true, walletBalance: 0, ...(code ? { referralCode: code, referralCodeLower: code.toLowerCase() } : {}) });
mk('u01', 'S62BV'); mk('u02', 'gy2f'); mk('u03', 'abcdefghijkl'); mk('u04', 'K9P4M2'); mk('u05', null);
users.set('u06', { _id: 'u06', phone: '0770000099', status: 'active', registrationDone: false });
require('./server.js');
const base = 'http://127.0.0.1:' + PORT;
const J = async (m, p, b, tok) => { const r = await fetch(base + p, { method: m, headers: Object.assign({ 'content-type': 'application/json' }, tok ? { authorization: 'Bearer ' + tok } : {}), body: b ? JSON.stringify(b) : undefined }); let j = {}; try { j = await r.json(); } catch (_) {} return { s: r.status, j }; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) { pass++; realLog('  ok   - ' + m); } else { fail++; realLog('  FAIL - ' + m, x || ''); } };
const NEW = /^(?:[BCDFGHJKMNPQRTVWXYZ][2-9]){3}$/;
(async () => {
  for (let i = 0; i < 60; i++) { try { const h = await fetch(base + '/health'); if (h.ok) break; } catch (_) {} await sleep(250); }
  await sleep(1500);
  const u = id => users.get(id);
  ok(NEW.test(u('u01').referralCode) && NEW.test(u('u02').referralCode) && NEW.test(u('u03').referralCode), 'old codes (5 characters, lower case, long) became the new format: ' + ['u01', 'u02', 'u03'].map(i => u(i).referralCode).join(', '));
  ok(u('u01').referralCodeLower === u('u01').referralCode.toLowerCase(), 'the lower-case twin follows the new code');
  ok(u('u01').legacyReferralCodeLower === 's62bv' && u('u02').legacyReferralCodeLower === 'gy2f' && u('u03').legacyReferralCodeLower === 'abcdefghijkl', 'the old code is kept as the legacy twin');
  ok(u('u04').referralCode === 'K9P4M2' && !u('u04').legacyReferralCodeLower, 'a member already in the new format is not touched');
  ok(!u('u05').referralCode && !u('u06').referralCode, 'members with no code (unfinished sign-ups) are left alone');
  ok(new Set(['u01', 'u02', 'u03', 'u04'].map(i => u(i).referralCode)).size === 4, 'every code is different');
  ok(fm.__stores.meta && fm.__stores.meta.get('referralCode6'), 'the migration marks itself done (it never runs twice)');
  // an old shared link still finds its owner: sign up a new member with the OLD code S62BV, written in lower case too
  const phone = '0771230001', su = await J('POST', '/auth/signup', { phone, password: 'secret12' });
  const reg = await J('POST', '/register', { pin: '123456', referralCode: 's62bv' }, su.j.token);
  ok(reg.s === 200 && reg.j.status === 'success' && NEW.test(reg.j.referralCode), 'a new member who types an OLD code is accepted, and gets a new-format code: ' + JSON.stringify(reg.j));
  const mine = [...users.values()].find(x => x.phone === '+256771230001' || x.phone === phone || (x._id === su.j.uid));
  ok(mine && mine.referredBy === 'u01', 'and the old code reached its owner (the referrer is u01)', mine && mine.referredBy);
  // the new code works as well
  const su2 = await J('POST', '/auth/signup', { phone: '0771230002', password: 'secret12' });
  const reg2 = await J('POST', '/register', { pin: '123456', referralCode: u('u01').referralCode.toLowerCase() }, su2.j.token);
  ok(reg2.j.status === 'success' && users.get(su2.j.uid).referredBy === 'u01', 'the new code (typed in lower case) finds the same owner');
  const su3 = await J('POST', '/auth/signup', { phone: '0771230003', password: 'secret12' });
  const reg3 = await J('POST', '/register', { pin: '123456', referralCode: '' }, su3.j.token);
  ok(NEW.test(reg3.j.referralCode) && ![...users.values()].some(x => x._id !== su3.j.uid && x.referralCode === reg3.j.referralCode), 'a brand-new member gets a unique new-format code: ' + reg3.j.referralCode);
  ok(errs.length === 0, 'the server logged no error' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  realLog(fail ? `FAIL: ${fail} failed` : `PASS: referral code migration (${pass} checks)`);
  process.exit(fail ? 1 : 0);
})().catch(e => { realLog('FAIL:', e.stack || e.message); process.exit(1); });
