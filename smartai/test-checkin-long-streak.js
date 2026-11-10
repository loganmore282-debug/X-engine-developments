'use strict';
// The streak is read from the member's NEWEST check-in rows. Before, only the first 500 rows (the oldest) were read, so a member past 500 days saw the streak restart at 1.
//   node test-checkin-long-streak.js
const path = require('path'), Module = require('module'), fs = require('fs');
const D = __dirname; process.chdir(D);
const fm = require(path.join(D, 'test-helpers', 'fake-mongodb.js'));
const o = Module._resolveFilename; Module._resolveFilename = function (r, ...a) { return r === 'mongodb' ? path.join(D, 'test-helpers', 'fake-mongodb.js') : o.call(this, r, ...a); };
const BACK = 5600 + Math.floor(Math.random() * 300);
process.env.PORT = String(BACK); process.env.MONGODB_URI = 'mongodb://fake/app'; process.env.ADMIN_KEY = 'ck-admin-key-1234567890'; process.env.NODE_ENV = 'development';
process.env.POTATO_SECRETS_DIR = fs.mkdtempSync(path.join(require('os').tmpdir(), 'sa-ck-'));
const L = console.log; console.log = () => {}; console.warn = () => {}; console.error = () => {};
require(path.join(D, 'server.js'));
const sleep = ms => new Promise(r => setTimeout(r, ms)), base = 'http://127.0.0.1:' + BACK;
const J = async (m, p, b, tok) => { const r = await fetch(base + p, { method: m, headers: Object.assign({ 'content-type': 'application/json' }, tok ? { authorization: 'Bearer ' + tok } : {}), body: b ? JSON.stringify(b) : undefined }); let j = {}; try { j = await r.json(); } catch (_) {} return { s: r.status, j }; };
(async () => {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/health')).ok) break; } catch (_) {} await sleep(250); }
  const su = await J('POST', '/auth/signup', { phone: '0771234567', password: 'secret12' });
  await J('POST', '/register', { pin: '123456', referralCode: '' }, su.j.token);
  let uid; for (const [id, u] of fm.__stores.users) uid = id;
  const tx = fm.__stores.transactions || (fm.__stores.transactions = new Map());
  const DAY = 86400000, now = Date.now();
  // 600 consecutive days, ending YESTERDAY
  for (let k = 1; k <= 600; k++) tx.set('c' + k, { userId: uid, type: 'checkin', amount: 100, status: 'success', createdAt: new Date(now - k * DAY) });
  const r = await J('POST', '/checkin', null, su.j.token);
  const okk = r.s === 200 && r.j.streak === 601 && r.j.bonus === 100;
  L(okk ? 'PASS: a 600-day check-in run keeps counting (streak 601, day 1 of the 30-day cycle pays 100)' : 'FAIL: ' + r.s + ' ' + JSON.stringify(r.j));
  process.exit(okk ? 0 : 1);
})();
