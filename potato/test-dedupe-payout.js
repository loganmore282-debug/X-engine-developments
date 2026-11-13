'use strict';
// A payout number saved by two members before the one-number-one-member rule existed: the server keeps the member who saved it FIRST and deletes the
// later copy (on start-up and from the owner-only route), keeps each member's other cards, gives a member who lost the active card a new active one,
// and writes what it removed to the audit log.   node test-dedupe-payout.js
const path = require('path'), Module = require('module'), fs = require('fs');
process.chdir(__dirname);
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...a) { return req === 'mongodb' ? path.join(__dirname, 'test-helpers', 'fake-mongodb.js') : origResolve.call(this, req, ...a); };
const BACK = 5800 + Math.floor(Math.random() * 300);
process.env.PORT = String(BACK); process.env.MONGODB_URI = 'mongodb://fake/app'; process.env.ADMIN_KEY = 'dedupe-test-admin-key-123456'; process.env.NODE_ENV = 'development';
process.env.POTATO_SECRETS_DIR = fs.mkdtempSync(path.join(require('os').tmpdir(), 'po-dd-'));
const realLog = console.log; console.log = () => {}; console.warn = () => {}; console.error = () => {};
const fm = require(path.join(__dirname, 'test-helpers', 'fake-mongodb.js'));
require(path.join(__dirname, 'server.js'));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; realLog('  ok   - ' + m); } else { fail++; realLog('  FAIL - ' + m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const base = 'http://127.0.0.1:' + BACK;
const J = async (m, p, b, tok, adm) => { const r = await fetch(base + p, { method: m, headers: Object.assign({ 'content-type': 'application/json' }, tok ? { authorization: 'Bearer ' + tok } : {}, adm ? { authorization: 'Bearer ' + process.env.ADMIN_KEY } : {}), body: b ? JSON.stringify(b) : undefined }); let j = null; try { j = await r.json(); } catch (_) {} return { s: r.status, j }; };
(async () => {
  for (let i = 0; i < 60; i++) { try { const h = await fetch(base + '/health'); if (h.ok) break; } catch (_) {} await sleep(250); }
  const mk = async (phone) => { const su = await J('POST', '/auth/signup', { phone, password: 'secret12' }); await J('POST', '/register', { pin: '123456', referralCode: '' }, su.j.token); return su.j; };
  const A = await mk('0771110001'), B = await mk('0771110002'), C = await mk('0771110003');
  const uidByPhone = (ph) => { for (const [id, u] of fm.__stores.users) if (String(u.phone || '').replace(/\D/g, '').endsWith(ph.slice(-9))) return id; return null; };
  A.uid = uidByPhone('0771110001'); B.uid = uidByPhone('0771110002'); C.uid = uidByPhone('0771110003');
  ok(A.uid && B.uid && C.uid && new Set([A.uid, B.uid, C.uid]).size === 3, 'three members exist');
  const ban = fm.__stores.bankAccounts || (fm.__stores.bankAccounts = new Map());
  const put = (id, userId, phone, network, ms, isDefault) => ban.set(id, { _id: id, userId, holder: 'H ' + id, network, phone, isDefault, createdAt: new Date(ms) });
  // 0781112223: B saved it first, then A (later) and C (latest); A also keeps a card of their own and it was A's active card
  put('b1', B.uid, '+251781112223', 'Telebirr', 1000, true);
  put('a1', A.uid, '+251781112223', 'Telebirr', 2000, true);
  put('a2', A.uid, '+251709990001', 'Telebirr', 3000, false);
  put('c1', C.uid, '+251781112223', 'Telebirr', 4000, true);
  put('c2', C.uid, '+251709990002', 'Telebirr', 5000, false);
  // a number only one member holds is left alone
  put('b2', B.uid, '+251709990003', 'Telebirr', 6000, false);
  const r0 = await J('POST', '/admin/payout-numbers/dedupe', {}, null, false); ok(r0.s === 401, 'without the owner key nothing happens');
  const r = await J('POST', '/admin/payout-numbers/dedupe', {}, null, true);
  ok(r.s === 200 && r.j.removed === 2, 'the owner run removes exactly the two later copies (' + (r.j && r.j.removed) + ')');
  ok(ban.has('b1') && !ban.has('a1') && !ban.has('c1'), 'the member who saved the number first keeps it; the later ones are deleted');
  ok(ban.has('a2') && ban.has('c2') && ban.has('b2'), 'every other card of every member is untouched');
  ok(ban.get('a2').isDefault === true && ban.get('c2').isDefault === true, 'a member who lost their active card gets their oldest remaining card as the active one');
  const log = [...(fm.__stores.adminAuditLog || new Map()).values()].find(x => x.action === 'shared_payout_numbers_removed');
  ok(log && log.meta.removed.length === 2 && log.meta.removed.every(x => x.keptBy === B.uid), 'what was removed is written to the audit log');
  const r2 = await J('POST', '/admin/payout-numbers/dedupe', {}, null, true); ok(r2.s === 200 && r2.j.removed === 0, 'running it again removes nothing');
  // and a late save of the freed number is still refused while B holds it
  const sv = await J('POST', '/bank/save', { holder: 'Late', network: 'Telebirr', phone: '0781112223' }, A.token);
  ok(sv.s === 409 && sv.j.code === 'WALLET_TAKEN', 'the number stays B\'s: a new save by another member is refused');
  realLog(fail ? 'FAIL: dedupe shared payout numbers (' + pass + ' ok, ' + fail + ' failed)' : 'PASS: dedupe shared payout numbers (' + pass + ' checks)');
  process.exit(fail ? 1 : 0);
})();
