'use strict';
// Referral rewards on the real server: 27 / 2 / 1 percent to three levels, paid once on a member's FIRST purchase even when two are made at the same instant, nothing for
// later purchases or the fourth level, a referral loop is refused, the team pages and the VIP-task team total count levels 1 to 3 only, the ledger agrees with every wallet.
//   node test-referral-rewards.js
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
  await J('POST', '/admin/settings/update', { settings: { welcomeBonus: 0, minDeposit: 5000 } }, null, true);
  await J('POST', '/admin/products/number-vips', {}, null, true);
  const prods = (await J('GET', '/public/products')).j.products.filter(p => !p.deleted && p.price > 0).sort((a, b) => a.price - b.price);
  const P1 = prods[0], P2 = prods[1];
  const mk = async (i, parent) => { const phone = '07712' + String(40200 + i).padStart(5, '0'), su = await J('POST', '/auth/signup', { phone, password: 'secret12' }); await J('POST', '/register', { referralCode: parent ? fm.__stores.users.get(parent.uid).referralCode : '' }, su.j.token); const m = { tok: su.j.token, uid: su.j.uid, phone }; await J('POST', '/admin/deposit', { userId: m.uid, amount: 5000000, note: 'seed' }, null, true); return m; };
  const A = await mk(0), B = await mk(1, A), C = await mk(2, B), D = await mk(3, C), E = await mk(4, D);
  const bal = async m => (await J('GET', '/account', null, m.tok)).j.account.walletBalance;
  const before = { A: await bal(A), B: await bal(B), C: await bal(C), D: await bal(D), E: await bal(E) };
  const sett = (await J('GET', '/public/settings')).j.settings; const rates = [sett.commL1, sett.commL2, sett.commL3];
  // D buys twice at once: only ONE is the first purchase, and the reward is paid once
  const both = await Promise.all([J('POST', '/invest/create', { tierKey: P1.key }, D.tok), J('POST', '/invest/create', { tierKey: P1.key }, D.tok)]);
  await sleep(600);
  const dep = x => Math.round(P1.price * x / 100 * 100) / 100;
  const after = { A: await bal(A), B: await bal(B), C: await bal(C), D: await bal(D), E: await bal(E) };
  chk(both.every(r => r.s === 200), 'two simultaneous first purchases both succeed', both.map(r => r.j));
  chk(Math.abs(after.C - before.C - dep(rates[0])) < 0.01, 'level 1 (C) got exactly ' + rates[0] + '% once, not twice', [after.C - before.C, dep(rates[0])]);
  chk(Math.abs(after.B - before.B - dep(rates[1])) < 0.01, 'level 2 (B) got exactly ' + rates[1] + '%', [after.B - before.B, dep(rates[1])]);
  chk(Math.abs(after.A - before.A - dep(rates[2])) < 0.01, 'level 3 (A) got exactly ' + rates[2] + '%', [after.A - before.A, dep(rates[2])]);
  chk(after.E === before.E, 'the buyer\'s own downline (E) got nothing');
  chk(Math.abs(after.D - before.D + 2 * P1.price) < 0.01, 'the buyer paid exactly the price twice', after.D - before.D);
  // a later purchase pays no more rewards
  const cBefore = await bal(C); await J('POST', '/invest/create', { tierKey: P2.key }, D.tok); await sleep(500);
  chk(await bal(C) === cBefore, 'a second purchase by the same member pays no further referral reward');
  // E buys: D (L1), C (L2), B (L3), A nothing
  const pre = { A: await bal(A), B: await bal(B), C: await bal(C), D: await bal(D) };
  await J('POST', '/invest/create', { tierKey: P1.key }, E.tok); await sleep(600);
  chk(Math.abs(await bal(D) - pre.D - dep(rates[0])) < 0.01 && Math.abs(await bal(C) - pre.C - dep(rates[1])) < 0.01 && Math.abs(await bal(B) - pre.B - dep(rates[2])) < 0.01 && await bal(A) === pre.A, 'a fourth-level buyer pays three levels up and the top (4 levels away) gets nothing');
  // ledger rows
  const rows = [...fm.__stores.transactions.values()].filter(t => t.type === 'commission');
  chk(rows.length === 6 && rows.every(t => t.amount > 0), 'six reward rows in the ledger, all positive', rows.map(t => [t.userId.slice(0, 4), t.amount, t.description]));
  // team pages
  const ts = await J('GET', '/team/stats', null, A.tok); chk(ts.j.team.l1 === 1 && ts.j.team.l2 === 1 && ts.j.team.l3 === 1 && ts.j.totalTeam === 3, 'A\'s team counts are 1 / 1 / 1', ts.j.team);
  const tm = await J('GET', '/team/members?level=3', null, A.tok); chk(tm.j.members.length === 1 && tm.j.members[0].invested > 0, 'A\'s level 3 list shows D with what D invested', tm.j.members);
  // VIP tasks: team purchases of levels 1-3 count for A
  const st = await J('GET', '/salary/status', null, A.tok);
  const teamBuys = [...fm.__stores.investments.values()].filter(i => [B.uid, C.uid, D.uid].includes(i.userId) && i.granted !== true).reduce((s, i) => s + i.amount, 0);
  chk(st.j.total === teamBuys, 'A\'s team purchases total is exactly what levels 1-3 bought (E, level 4, does not count)', [st.j.total, teamBuys]);
  // self-referral and edit: attach-referrer cycle
  const x = await J('POST', '/admin/user/attach-referrer', { userId: A.uid, referrerId: E.uid }, null, true); chk(x.s !== 200, 'a referral loop cannot be made (A under E)', x.j);
  const integ = await J('GET', '/admin/integrity', null, null, true); chk(integ.j.mismatches.length === 0, 'the ledger agrees with every wallet', integ.j.mismatches);
  chk(serverErrors.length === 0, 'server logged no error', serverErrors.slice(0, 3));
  realLog(fail ? `FAIL: ${fail} failed` : `PASS: referral rewards, team pages and team total (${pass} checks)`); process.exit(fail ? 1 : 0);
})().catch(e => { realLog('CRASH', e.stack); process.exit(1); });
