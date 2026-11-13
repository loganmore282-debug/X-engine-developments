'use strict';
// END-TO-END for the owner-only "Reset database" (Admin > Settings > Danger zone): the preview counts, the exact phrase and the admin key are both
// required, unfinished money needs a second tick, then members and everything of theirs (including their sign-in accounts) are erased while the
// configuration (settings, assets, payment numbers, admin log) stays. Runs the REAL server.js against the in-memory MongoDB stand-in.
const path = require('path'), Module = require('module');
const root = __dirname;
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...a) { return req === 'mongodb' ? path.join(root, 'test-helpers', 'fake-mongodb.js') : origResolve.call(this, req, ...a); };
const PORT = 3900 + Math.floor(Math.random() * 90);
const KEY = 'e2e-admin-key-123456';
process.env.PORT = String(PORT); process.env.MONGODB_URI = 'mongodb://fake/potato'; process.env.ADMIN_KEY = KEY; process.env.NODE_ENV = 'development';
const realLog = console.log; console.log = () => {}; console.warn = () => {};
require('./server.js');
const base = 'http://127.0.0.1:' + PORT;
const J = async (m, p, b, tok, adm) => {
  const r = await fetch(base + p, { method: m, headers: Object.assign({ 'content-type': 'application/json' }, tok ? { authorization: 'Bearer ' + tok } : {}, adm ? { authorization: 'Bearer ' + KEY } : {}), body: b ? JSON.stringify(b) : undefined });
  let j = null; try { j = await r.json(); } catch (_) {} return { s: r.status, j };
};
let fails = 0, checks = 0;
const ok = (c, m, x) => { checks++; if (!c) { fails++; realLog('FAIL', m, x ? JSON.stringify(x).slice(0, 260) : ''); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ph = () => '09' + String(10000000 + Math.floor(Math.random() * 8999999)).padStart(8, '0').slice(-8);
(async () => {
  for (let i = 0; i < 60; i++) { try { const h = await fetch(base + '/health'); if (h.ok) break; } catch (_) {} await sleep(250); }
  await J('POST', '/admin/settings/update', { settings: { welcomeBonus: 5000, brandName: 'Kept Name' } }, null, true);
  const phone = ph();
  const su = await J('POST', '/auth/signup', { phone, password: 'secret12' });
  await J('POST', '/register', { referralCode: '', pin: '123456', phone }, su.j.token);
  ok(((await J('GET', '/account', null, su.j.token)).j.account || {}).walletBalance === 5000, 'a member exists with the welcome bonus');
  const pre = await J('POST', '/admin/database/reset-preview', {}, null, true);
  ok(pre.j.status === 'success' && pre.j.phrase === 'RESET DATABASE' && pre.j.counts.users >= 1 && pre.j.counts.authAccounts >= 1 && pre.j.walletTotal >= 5000, 'the preview counts members, sign-in accounts and wallet money', pre.j);
  ok((await J('POST', '/admin/database/reset-preview', {})).s === 401, 'the preview needs the admin');
  ok((await J('POST', '/admin/database/reset', { confirm: 'reset database', key: KEY }, null, true)).s === 400, 'a wrong phrase is refused');
  ok((await J('POST', '/admin/database/reset', { confirm: 'RESET DATABASE', key: 'wrong' }, null, true)).s === 401, 'a wrong admin key is refused');
  ok((await J('POST', '/admin/database/reset', { confirm: 'RESET DATABASE', key: KEY })).s === 401, 'no admin session is refused');
  ok(((await J('GET', '/account', null, su.j.token)).j.account || {}).walletBalance === 5000, 'nothing was erased by the refused attempts');
  const r = await J('POST', '/admin/database/reset', { confirm: 'RESET DATABASE', key: KEY }, null, true);
  ok(r.s === 200 && r.j.status === 'success' && r.j.erased.users >= 1 && r.j.erased.authAccounts >= 1, 'the reset erases the members and their sign-in accounts', r.j);
  const pre2 = await J('POST', '/admin/database/reset-preview', {}, null, true);
  ok(Object.values(pre2.j.counts).every(n => n === 0) && pre2.j.walletTotal === 0, 'afterwards every member table is empty', pre2.j);
  ok((await J('GET', '/account', null, su.j.token)).s !== 200, 'the old member session no longer works');
  const login = await J('POST', '/auth/login', { phone, password: 'secret12' });
  ok(login.s !== 200 || !login.j.token, 'the old member can no longer sign in', login.j);
  const st = (await J('GET', '/public/settings')).j.settings || {};
  ok(st.brandName === 'Kept Name', 'the settings are kept', st.brandName);
  const su2 = await J('POST', '/auth/signup', { phone, password: 'secret12' });
  ok(su2.s === 200 && su2.j.token, 'the same number can sign up again on the clean database', su2.j);
  realLog(fails ? 'FAILED ' + fails + ' of ' + checks : 'PASS: reset database (' + checks + ' checks)');
  process.exit(fails ? 1 : 0);
})().catch(e => { realLog('FATAL', e); process.exit(1); });
