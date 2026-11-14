// Team bonuses (Home > Bonus) on the real server with the fake MongoDB: progress, a claim pays once (even in parallel), re-adding a deleted bonus cannot be claimed again,
// bad rows are refused, and the rows are not exposed through the public settings.
const path = require('path'), Module = require('module'), fs = require('fs'), assert = require('assert');
const D = process.env.APPDIR || __dirname; process.chdir(D);
const fm = require(path.join(D, 'test-helpers', 'fake-mongodb.js'));
const o = Module._resolveFilename;
Module._resolveFilename = function (r, ...a) { return r === 'mongodb' ? path.join(D, 'test-helpers', 'fake-mongodb.js') : o.call(this, r, ...a); };
const BACK = 7600 + Math.floor(Math.random() * 300);
process.env.PORT = String(BACK); process.env.MONGODB_URI = 'mongodb://fake/app'; process.env.ADMIN_KEY = 'bonus-admin-key-1234567890'; process.env.NODE_ENV = 'development';
process.env.COOKIE_SECRETS_DIR = fs.mkdtempSync(path.join(require('os').tmpdir(), 'beer-bonus-'));
const L = console.log; console.log = () => {}; console.warn = () => {}; console.error = () => {};
require(path.join(D, 'server.js'));
const base = 'http://127.0.0.1:' + BACK, sleep = ms => new Promise(r => setTimeout(r, ms));
const J = async (m, p, b, tok, adm) => { const r = await fetch(base + p, { method: m, headers: Object.assign({ 'content-type': 'application/json' }, tok ? { authorization: 'Bearer ' + tok } : {}, adm ? { authorization: 'Bearer ' + process.env.ADMIN_KEY } : {}), body: (b === undefined || m === 'GET') ? undefined : JSON.stringify(b) }); return { s: r.status, j: await r.json().catch(() => ({})) }; };
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); }; const eq = (a, b, m) => { n++; assert.deepStrictEqual(a, b, m); };
(async () => {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/health')).ok) break; } catch (_) {} await sleep(250); }
  const mk = async (phone, ref) => { const su = await J('POST', '/auth/signup', { phone, password: 'secret12' }); await J('POST', '/register', { pin: '123456', referralCode: ref || '' }, su.j.token); let uid; for (const [id, u] of fm.__stores.users) if (String(u.phone).endsWith(phone.slice(-9))) uid = id; return { tok: su.j.token, uid, code: fm.__stores.users.get(uid).referralCode }; };
  const A = await mk('0911000001'), B = await mk('0911000002', A.code), C = await mk('0911000003', B.code), X = await mk('0911000009');
  const U = id => fm.__stores.users.get(id), bal = id => U(id).walletBalance || 0;
  // admin saves rows
  let r = await J('POST', '/admin/bonuses/save', { bonuses: [{ target: 150000, reward: 3500 }, { target: 50000, reward: 1500 }] }, null, true);
  eq(r.s, 200, 'saved'); eq(r.j.bonuses.map(b => b.target), [50000, 150000], 'rows are kept in order of target'); const ids = r.j.bonuses.map(b => b.id); ok(ids.every(i => /^b[0-9a-f]{8}$/.test(i)), 'each row got an id');
  for (const bad of [[{ target: 0, reward: 5 }], [{ target: 5, reward: 0 }], [{ target: 1.5, reward: 5 }], [{ target: 'x', reward: 5 }], [{ target: 5, reward: 5 }, { target: 5, reward: 6 }], 'nope', [{ target: 1e12, reward: 5 }], Array.from({ length: 51 }, (_, i) => ({ target: i + 1, reward: 1 }))]) {
    r = await J('POST', '/admin/bonuses/save', { bonuses: bad }, null, true); ok(r.s === 400, 'refused: ' + JSON.stringify(bad).slice(0, 50) + ' got ' + r.s); }
  eq((await J('GET', '/admin/bonuses', undefined, null, true)).j.bonuses.length, 2, 'refused saves changed nothing');
  eq((await J('POST', '/admin/bonuses/save', { bonuses: [] }, X.tok)).s, 401, 'a member cannot save bonuses');
  eq((await J('GET', '/bonus/list')).s, 401, 'the list needs a login');
  // the settings route cannot be used to write the rows around the checks
  await J('POST', '/admin/settings/update', { settings: { teamBonuses: [{ id: 'evil', target: 1, reward: 999999 }], bonusIdByTarget: { 1: 'evil' } } }, null, true);
  eq((await J('GET', '/admin/bonuses', undefined, null, true)).j.bonuses.map(b => b.id), ids, 'settings/update ignores teamBonuses');
  const pub = await J('GET', '/public/settings'); ok(!/teamBonuses|bonusIdByTarget/.test(JSON.stringify(pub.j)), 'public settings do not expose the bonus rows');
  // progress: B and C recharged (A's whole team is B and C; banned members and A herself are not counted)
  U(B.uid).totalDeposited = 30000; U(C.uid).totalDeposited = 25000;
  let l = await J('GET', '/bonus/list', undefined, A.tok); eq(l.j.teamDeposits, 55000, 'team recharge = level 1 + level 2');
  eq(l.j.bonuses.map(b => [b.n, b.target, b.reward, b.current, b.achieved, b.claimed]), [[1, 50000, 1500, 50000, true, false], [2, 150000, 3500, 55000, false, false]], 'progress per bonus (current never above the target)');
  l = await J('GET', '/bonus/list', undefined, X.tok); eq(l.j.teamDeposits, 0, 'someone with no team has no progress');
  // claims
  const bonus1 = ids[0], bonus2 = ids[1];
  r = await J('POST', '/bonus/claim', { id: bonus2 }, A.tok); eq([r.s, r.j.code], [400, 'NOT_REACHED'], 'a bonus not reached cannot be claimed'); ok(/Br 55,000/.test(r.j.message) && /Br 150,000/.test(r.j.message), 'and the message says how far the team is, in Br: ' + r.j.message);
  r = await J('POST', '/bonus/claim', { id: 'nope' }, A.tok); eq(r.s, 400, 'an unknown bonus is refused');
  r = await J('POST', '/bonus/claim', {}, A.tok); eq(r.s, 400, 'no id is refused');
  r = await J('POST', '/bonus/claim', { id: bonus1 }, X.tok); eq(r.j.code, 'NOT_REACHED', 'another member cannot claim on A\'s team');
  const before = bal(A.uid);
  const many = await Promise.all([1, 2, 3, 4, 5].map(() => J('POST', '/bonus/claim', { id: bonus1 }, A.tok)));
  eq(many.filter(x => x.s === 200).length, 1, 'five parallel claims: exactly one pays'); eq(bal(A.uid) - before, 1500, 'the wallet got the reward once');
  eq(many.filter(x => x.s === 409).length, 4, 'the others are told it is already claimed');
  const rows = [...fm.__stores.transactions.values()].filter(t => t.type === 'team_reward' && t.userId === A.uid); eq(rows.length, 1, 'one ledger row'); eq([rows[0].amount, rows[0].status], [1500, 'success'], 'for the reward');
  ok(/Team Bonus-1/.test(rows[0].description) && /Br 50,000/.test(rows[0].description), 'readable in Records: ' + rows[0].description);
  ok(U(A.uid).totalEarned >= 1500, 'counted as earned');
  l = await J('GET', '/bonus/list', undefined, A.tok); ok(l.j.bonuses[0].claimed && !l.j.bonuses[1].claimed, 'the list shows it claimed');
  // delete and type the same target again: same id, still claimed
  await J('POST', '/admin/bonuses/save', { bonuses: [{ target: 150000, reward: 3500 }] }, null, true);
  r = await J('POST', '/admin/bonuses/save', { bonuses: [{ target: 50000, reward: 9999 }, { target: 150000, reward: 3500 }] }, null, true);
  eq(r.j.bonuses[0].id, bonus1, 'the same target gets the same id back'); r = await J('POST', '/bonus/claim', { id: bonus1 }, A.tok); eq(r.s, 409, 'so it cannot be claimed a second time'); eq(bal(A.uid) - before, 1500, 'and the wallet is unchanged');
  // editing a reward keeps the id; a banned member cannot claim; reaching the second target
  U(C.uid).totalDeposited = 125000; r = await J('POST', '/bonus/claim', { id: bonus2 }, A.tok); eq([r.s, r.j.amount], [200, 3500], 'the second bonus pays once the team reaches it');
  r = await J('POST', '/admin/ban', { userId: B.uid, action: 'ban', reason: 't' }, null, true); l = await J('GET', '/bonus/list', undefined, A.tok);
  ok(l.j.teamDeposits === 125000, 'a banned member in the team is not counted');
  r = await J('POST', '/admin/ban', { userId: A.uid, action: 'ban', reason: 't' }, null, true); r = await J('POST', '/bonus/claim', { id: bonus1 }, A.tok); ok(r.s >= 400, 'a banned member cannot claim');
  L(`PASS: team bonuses (${n} checks)`); process.exit(0);
})().catch(e => { L('FAIL', e.stack || e); process.exit(1); });
