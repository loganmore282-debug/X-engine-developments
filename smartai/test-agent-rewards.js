'use strict';
// VIP Tasks > Agent rewards, on the REAL server (in-memory database): the admin's agent levels (name, active subordinates, monthly salary), who counts as an
// active subordinate (invited directly, not suspended, a robot RUNNING), the member's level (the highest reached), one salary every 30 days, and a double claim.
//   node test-agent-rewards.js
const path = require('path'), Module = require('module');
const root = __dirname;
const fm = require('./test-helpers/fake-mongodb.js');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...a) { return req === 'mongodb' ? path.join(root, 'test-helpers', 'fake-mongodb.js') : origResolve.call(this, req, ...a); };
const PORT = 4400 + Math.floor(Math.random() * 90);
process.env.PORT = String(PORT); process.env.MONGODB_URI = 'mongodb://fake/smartai'; process.env.ADMIN_KEY = 'agent-admin-key-123456'; process.env.NODE_ENV = 'development';
const realLog = console.log; console.log = () => {}; console.warn = () => {};
const errs = []; console.error = (...a) => errs.push(a.join(' ').slice(0, 200));
require('./server.js');
const base = 'http://127.0.0.1:' + PORT;
const J = async (m, p, b, tok, adm) => { const r = await fetch(base + p, { method: m, headers: Object.assign({ 'content-type': 'application/json' }, tok ? { authorization: 'Bearer ' + tok } : {}, adm ? { authorization: 'Bearer agent-admin-key-123456' } : {}), body: b ? JSON.stringify(b) : undefined }); let j = {}; try { j = await r.json(); } catch (_) {} return { s: r.status, j }; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const ok = (c, m, x) => { if (c) { pass++; realLog('  ok   - ' + m); } else { fail++; realLog('  FAIL - ' + m, x ? JSON.stringify(x).slice(0, 300) : ''); } };
let seq = 0; const ph = () => '07712' + String(10000 + (seq++)).slice(-5);
async function member(ref) { const su = await J('POST', '/auth/signup', { phone: ph(), password: 'secret12' }); const reg = await J('POST', '/register', { pin: '123456', referralCode: ref || '' }, su.j.token); return { tok: su.j.token, uid: su.j.uid, code: reg.j.referralCode }; }
const S = () => fm.__stores;
const giveRobot = (uid, status) => { const id = 'inv-' + uid + '-' + Math.random().toString(36).slice(2, 8); S().investments = S().investments || new Map(); S().investments.set(id, { _id: id, userId: uid, tierKey: 'x', tierLabel: 'X', amount: 30000, status: status || 'active', payoutsTotal: 8, payoutsMade: 0, paidOut: 0, expectedReturn: 90000, createdAt: new Date() }); return id; };
(async () => {
  for (let i = 0; i < 60; i++) { try { const h = await fetch(base + '/health'); if (h.ok) break; } catch (_) {} await sleep(250); }
  // ---- the admin's levels
  let r = await J('POST', '/admin/agent-levels/save', { levels: [{ name: 'Junior Agent', target: 2, salary: 50000 }] });
  ok(r.s === 401, 'only the owner can save agent levels');
  r = await J('POST', '/admin/agent-levels/save', { levels: [{ name: '', target: 2, salary: 50000 }] }, null, true); ok(r.s === 400, 'a level needs a name');
  r = await J('POST', '/admin/agent-levels/save', { levels: [{ name: 'A', target: 0, salary: 50000 }] }, null, true); ok(r.s === 400, 'a level needs at least 1 active subordinate');
  r = await J('POST', '/admin/agent-levels/save', { levels: [{ name: 'A', target: 2, salary: 1.5 }] }, null, true); ok(r.s === 400, 'a salary is a whole amount');
  r = await J('POST', '/admin/agent-levels/save', { levels: [{ name: 'A', target: 2, salary: 5 }, { name: 'B', target: 2, salary: 6 }] }, null, true); ok(r.s === 400, 'two levels cannot need the same number');
  r = await J('POST', '/admin/agent-levels/save', { levels: [{ name: 'Senior <b>Agent</b>', target: 4, salary: 150000 }, { name: 'Junior Agent', target: 2, salary: 50000 }] }, null, true);
  ok(r.s === 200 && r.j.levels.length === 2 && r.j.levels[0].name === 'Junior Agent' && r.j.levels[1].name === 'Senior Agent' && r.j.levels.every(l => /^[a-z0-9]{1,16}$/.test(l.id)), 'the owner saves two levels: sorted by number, names cleaned of tags, each with an id', r.j);
  const ids = r.j.levels.map(l => l.id);
  r = await J('POST', '/admin/agent-levels/save', { levels: [{ id: ids[0], name: 'Junior Agent', target: 2, salary: 60000 }, { id: ids[1], name: 'Senior Agent', target: 4, salary: 150000 }] }, null, true);
  ok(r.j.levels[0].id === ids[0] && r.j.levels[0].salary === 60000, 'editing a level keeps its id');
  ok((await J('GET', '/admin/agent-levels', null, null, true)).j.levels.length === 2, 'the admin reads the levels back');
  ok(!('agentLevels' in (await J('GET', '/public/settings')).j.settings), 'the levels are not sent with the public settings');
  // ---- a member and their subordinates
  const A = await member('');
  const subs = []; for (let i = 0; i < 5; i++) subs.push(await member(A.code));
  const deep = await member(subs[0].code);   // a Level 2 member: never counted
  ok((await J('GET', '/agent/status')).s === 401, 'sign-in is required');
  r = await J('GET', '/agent/status', null, A.tok);
  ok(r.s === 200 && r.j.active === 0 && r.j.direct === 5 && r.j.levelId === null && r.j.canClaim === false && r.j.levels.length === 2, 'five invited, none active yet: no agent level', r.j);
  ok((await J('POST', '/agent/claim', {}, A.tok)).j.code === 'NOT_REACHED', 'no level, no salary');
  giveRobot(subs[0].uid); giveRobot(subs[0].uid);   // two robots, still ONE active subordinate
  giveRobot(subs[1].uid, 'matured');                 // a finished robot is not a running one
  giveRobot(deep.uid);                                // Level 2
  r = await J('GET', '/agent/status', null, A.tok); ok(r.j.active === 1, 'one subordinate with running robots counts once; a finished robot and a Level 2 member do not count', r.j);
  giveRobot(subs[1].uid); giveRobot(subs[2].uid);
  S().users.get(subs[2].uid).status = 'banned';
  r = await J('GET', '/agent/status', null, A.tok); ok(r.j.active === 2 && r.j.levelName === 'Junior Agent' && r.j.salary === 60000 && r.j.canClaim === true, 'a suspended subordinate does not count; two active = Junior Agent', r.j);
  // ---- the salary
  const bal0 = S().users.get(A.uid).walletBalance;
  const [c1, c2] = await Promise.all([J('POST', '/agent/claim', {}, A.tok), J('POST', '/agent/claim', {}, A.tok)]);
  const okN = [c1, c2].filter(x => x.j.status === 'success').length;
  ok(okN === 1 && Math.round(S().users.get(A.uid).walletBalance - bal0) === 60000, 'two claims at the same instant pay ONE salary (' + okN + ' succeeded, wallet +' + (S().users.get(A.uid).walletBalance - bal0) + ')');
  const tx = [...S().transactions.values()].filter(t => t.userId === A.uid && t.type === 'agent_salary');
  ok(tx.length === 1 && tx[0].amount === 60000 && tx[0].description === 'Junior Agent monthly salary', 'one ledger row: Junior Agent monthly salary');
  r = await J('GET', '/agent/status', null, A.tok);
  ok(r.j.canClaim === false && r.j.nextAt - Date.now() > 29.9 * 86400000 && r.j.nextAt - Date.now() < 30.1 * 86400000, 'the next salary opens 30 days later');
  ok((await J('POST', '/agent/claim', {}, A.tok)).j.code === 'TOO_SOON', 'a second claim inside the 30 days is refused');
  // a month later, now with four active: Senior Agent
  S().users.get(subs[2].uid).status = 'active'; giveRobot(subs[3].uid);
  S().users.get(A.uid).agentSalaryNextAt = new Date(Date.now() - 1000);
  r = await J('GET', '/agent/status', null, A.tok); ok(r.j.active === 4 && r.j.levelName === 'Senior Agent' && r.j.canClaim === true, 'four active a month later: Senior Agent, and the salary is open again', r.j);
  const bal1 = S().users.get(A.uid).walletBalance;
  r = await J('POST', '/agent/claim', {}, A.tok);
  ok(r.j.status === 'success' && r.j.amount === 150000 && Math.round(S().users.get(A.uid).walletBalance - bal1) === 150000, 'the highest level reached is the one paid (150,000)', r.j);
  ok([...S().transactions.values()].filter(t => t.userId === A.uid && t.type === 'agent_salary').length === 2, 'a second ledger row for the second month');
  // a suspended member
  S().users.get(A.uid).agentSalaryNextAt = new Date(Date.now() - 1000); S().users.get(A.uid).status = 'banned';
  ok((await J('POST', '/agent/claim', {}, A.tok)).s === 403, 'a suspended member is not paid');
  ok(errs.length === 0, 'the server logged no error' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  realLog(fail ? `FAIL: ${fail} failed` : `PASS: agent rewards (${pass} checks)`);
  process.exit(fail ? 1 : 0);
})().catch(e => { realLog('FAIL:', e.stack || e.message); process.exit(1); });
