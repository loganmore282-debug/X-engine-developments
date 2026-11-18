'use strict';
// A debit (the owner's Debit button) only takes money out of a wallet: it must NEVER change "Total topped up" (the dashboard card, a member's own "Topped up", or the team
// deposit totals). Also: an earlier server version wrongly took debits off those figures; the start-up fix puts them back. Real server, in-memory database.
//   node test-debit-total.js
const path = require('path'), Module = require('module'), fs = require('fs');
process.chdir(__dirname);
const fm = require('./test-helpers/fake-mongodb.js');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...a) { return req === 'mongodb' ? path.join(__dirname, 'test-helpers', 'fake-mongodb.js') : origResolve.call(this, req, ...a); };
const BACK = 5000 + Math.floor(Math.random() * 400), AK = 'debit-total-admin-key-123456';
process.env.PORT = String(BACK); process.env.MONGODB_URI = 'mongodb://fake/app'; process.env.ADMIN_KEY = AK; process.env.NODE_ENV = 'development';
process.env.POTATO_SECRETS_DIR = fs.mkdtempSync(path.join(require('os').tmpdir(), 'sa-debit-'));
const realLog = console.log; console.log = () => {}; console.warn = () => {}; console.error = () => {};
// A member the wrong version touched: recharged 100,000, owner debited 30,000 (a wallet adjustment), the old server took 30,000 off "Topped up" (70,000) and stamped the row.
const seed = (n, id, d) => { (fm.__stores[n] = fm.__stores[n] || new Map()).set(id, Object.assign({ _id: id }, d)); };
seed('users', 'old1', { phone: '+256773000111', status: 'active', registrationDone: true, walletBalance: 70000, totalDeposited: 70000, totalEarned: 0, totalInvested: 0, totalWithdrawn: 0 });
seed('transactions', 'o-dep', { userId: 'old1', type: 'deposit', status: 'success', amount: 100000, createdAt: new Date() });
seed('transactions', 'o-deb', { userId: 'old1', type: 'admin_debit', status: 'success', amount: -30000, depositApplied: true, createdAt: new Date() });
seed('transactions', 'o-plain', { userId: 'old1', type: 'admin_debit', status: 'success', amount: -1000, createdAt: new Date() });   // never stamped: nothing to put back
require(path.join(__dirname, 'server.js'));
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; realLog('  ok   - ' + m); } else { fail++; realLog('  FAIL - ' + m + (x ? ' ' + JSON.stringify(x).slice(0, 300) : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const base = 'http://127.0.0.1:' + BACK;
const J = async (m, p, b, tok, adm) => { const r = await fetch(base + p, { method: m, headers: Object.assign({ 'content-type': 'application/json' }, tok ? { authorization: 'Bearer ' + tok } : {}, adm ? { authorization: 'Bearer ' + AK } : {}), body: b ? JSON.stringify(b) : undefined }); let j = null; try { j = await r.json(); } catch (_) {} return { s: r.status, j }; };
(async () => {
  for (let i = 0; i < 60; i++) { try { const hh = await fetch(base + '/health'); if (hh.ok) break; } catch (_) {} await sleep(250); }
  for (let i = 0; i < 40 && !fm.__stores.meta.get('debitToppedUpReverted'); i++) await sleep(100);
  ok(fm.__stores.users.get('old1').totalDeposited === 100000, 'start-up: what the wrong version took off "Topped up" is put back (70,000 -> 100,000)', fm.__stores.users.get('old1'));
  ok(fm.__stores.users.get('old1').walletBalance === 70000, 'and the wallet is not touched');
  ok(fm.__stores.transactions.get('o-deb').depositApplied === false && fm.__stores.transactions.get('o-plain').depositApplied === undefined, 'the stamp is cleared (so it is never added twice); a debit that was never stamped is left alone');
  const su = await J('POST', '/auth/signup', { phone: '0771112222', password: 'secret12' }); await J('POST', '/register', { pin: '123456', referralCode: '' }, su.j.token);
  const uid = su.j.uid;
  fm.__stores.pendingDeposits.set('d1', { userId: uid, status: 'matched', amount: 100000, createdAt: Date.now() });
  fm.__stores.pendingDeposits.set('d2', { userId: uid, status: 'matched', amount: 35000, createdAt: Date.now() });
  fm.__stores.users.get(uid).walletBalance = 142000; fm.__stores.users.get(uid).totalDeposited = 135000;
  fm.__stores.transactions.set('l1', { userId: uid, type: 'deposit', status: 'success', amount: 100000, createdAt: new Date() });
  fm.__stores.transactions.set('l2', { userId: uid, type: 'deposit', status: 'success', amount: 35000, createdAt: new Date() });
  let s = await J('GET', '/admin/stats', null, null, true);
  ok(s.j.stats.depositAmount === 135000, 'Total topped up is the real recharges (135,000), debits made earlier do not count', s.j.stats);
  let d = await J('POST', '/admin/debit', { userId: uid, amount: 110000, note: 'adjustment' }, null, true);
  ok(d.j.status === 'success' && fm.__stores.users.get(uid).walletBalance === 32000, 'the owner debits 110,000: the wallet drops by exactly that (142,000 -> 32,000)', fm.__stores.users.get(uid));
  ok(fm.__stores.users.get(uid).totalDeposited === 135000, 'the member\'s own "Topped up" does NOT change (135,000)');
  s = await J('GET', '/admin/stats', null, null, true);
  ok(s.j.stats.depositAmount === 135000, 'the dashboard "Total topped up" does NOT change (135,000)', s.j.stats);
  const row = [...fm.__stores.transactions.values()].find(x => x.type === 'admin_debit' && x.userId === uid);
  ok(row && row.amount === -110000 && !row.depositApplied, 'the debit is recorded as a wallet adjustment only');
  const ig = await J('GET', '/admin/integrity', null, null, true);
  ok(ig.j.status === 'success' && !ig.j.mismatches.some(m => m.field === 'totalDeposited'), 'the books agree: "Topped up" = recharges', ig.j.mismatches);
  realLog(fail ? `FAIL: ${fail} failed` : `PASS: a debit never changes Total topped up (${pass} checks)`);
  process.exit(fail ? 1 : 0);
})().catch(e => { realLog('FAIL:', e); process.exit(1); });
