'use strict';
// "Debiting can't reduce Total topped up": what the owner takes back with the Debit button comes off the dashboard's Total topped up in full. Real server, in-memory database.
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
// A member who was debited BEFORE debits reduced "Topped up": recharged 100,000, owner took back 30,000, the figure still says 100,000 (and the debit row has no stamp).
const seed = (n, id, d) => { (fm.__stores[n] = fm.__stores[n] || new Map()).set(id, Object.assign({ _id: id }, d)); };
seed('users', 'old1', { phone: '+256773000111', status: 'active', registrationDone: true, walletBalance: 70000, totalDeposited: 100000, totalEarned: 0, totalInvested: 0, totalWithdrawn: 0 });
seed('transactions', 'o-dep', { userId: 'old1', type: 'deposit', status: 'success', amount: 100000, createdAt: new Date() });
seed('transactions', 'o-deb', { userId: 'old1', type: 'admin_debit', status: 'success', amount: -30000, createdAt: new Date() });
seed('transactions', 'o-gone', { userId: 'nobody', type: 'admin_debit', status: 'success', amount: -500, createdAt: new Date() });
require(path.join(__dirname, 'server.js'));
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; realLog('  ok   - ' + m); } else { fail++; realLog('  FAIL - ' + m + (x ? ' ' + JSON.stringify(x).slice(0, 300) : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const base = 'http://127.0.0.1:' + BACK;
const J = async (m, p, b, tok, adm) => { const r = await fetch(base + p, { method: m, headers: Object.assign({ 'content-type': 'application/json' }, tok ? { authorization: 'Bearer ' + tok } : {}, adm ? { authorization: 'Bearer ' + AK } : {}), body: b ? JSON.stringify(b) : undefined }); let j = null; try { j = await r.json(); } catch (_) {} return { s: r.status, j }; };
(async () => {
  for (let i = 0; i < 60; i++) { try { const hh = await fetch(base + '/health'); if (hh.ok) break; } catch (_) {} await sleep(250); }
  const su = await J('POST', '/auth/signup', { phone: '0771112222', password: 'secret12' }); await J('POST', '/register', { pin: '123456', referralCode: '' }, su.j.token);
  const uid = su.j.uid;
  // the start-up fix for the earlier debit
  for (let i = 0; i < 40 && !fm.__stores.meta.get('debitToppedUp'); i++) await sleep(100);
  ok(fm.__stores.users.get('old1').totalDeposited === 70000, 'at start-up an earlier debit (30,000) was taken off that member\'s Topped up: 100,000 -> 70,000', fm.__stores.users.get('old1'));
  ok(fm.__stores.users.get('old1').walletBalance === 70000, 'and the wallet was not touched');
  ok(fm.__stores.transactions.get('o-deb').depositApplied === true && !fm.__stores.transactions.get('o-gone').depositApplied, 'the debit row is stamped (so it can never be taken off twice); a debit of a member that no longer exists is left alone');
  ok(!!fm.__stores.meta.get('debitToppedUp'), 'the fix is recorded as done (it runs once)');
  // two real, fully credited recharges: 100,000 + 35,000 = 135,000 (the figure on the owner's screenshot)
  fm.__stores.pendingDeposits.set('d1', { userId: uid, status: 'matched', amount: 100000, createdAt: Date.now() });
  fm.__stores.pendingDeposits.set('d2', { userId: uid, status: 'matched', amount: 35000, createdAt: Date.now() });
  fm.__stores.users.get(uid).walletBalance = 142000; fm.__stores.users.get(uid).totalDeposited = 135000;
  fm.__stores.transactions.set('l1', { userId: uid, type: 'deposit', status: 'success', amount: 100000, createdAt: new Date() });
  fm.__stores.transactions.set('l2', { userId: uid, type: 'deposit', status: 'success', amount: 35000, createdAt: new Date() });
  let s = await J('GET', '/admin/stats', null, null, true);
  ok(s.j.status === 'success' && s.j.stats.depositAmount === 135000 - 30500, 'Total topped up starts at the real recharges 135,000 less the 30,500 debited earlier (104,500)', s.j.stats);
  let d = await J('POST', '/admin/debit', { userId: uid, amount: 20000, note: 'wrong recharge' }, null, true);
  ok(d.j.status === 'success', 'the owner debits 20,000', d.j);
  ok(fm.__stores.users.get(uid).totalDeposited === 115000 && fm.__stores.users.get(uid).walletBalance === 122000, 'the member\'s own Topped up figure drops by exactly 20,000 (135,000 -> 115,000), with the wallet', fm.__stores.users.get(uid));
  s = await J('GET', '/admin/stats', null, null, true);
  ok(s.j.stats.depositAmount === 84500, 'Total topped up drops by exactly the 20,000 debited (84,500)', s.j.stats);
  await sleep(10100);
  d = await J('POST', '/admin/debit', { userId: uid, amount: 5000 }, null, true);
  s = await J('GET', '/admin/stats', null, null, true);
  ok(d.j.status === 'success' && s.j.stats.depositAmount === 79500, 'a second debit comes off in full too (79,500)', s.j.stats);
  ok(fm.__stores.users.get(uid).totalDeposited === 110000, 'and the member\'s figure follows (110,000)');
  let ig = await J('GET', '/admin/integrity', null, null, true);
  ok(ig.j.status === 'success' && !ig.j.mismatches.some(m => m.field === 'totalDeposited'), 'the books agree for both members: stored Topped up = recharges - debits', ig.j.mismatches);
  fm.__stores.transactions.set('t-failed', { userId: uid, type: 'admin_debit', status: 'failed', amount: -9999 });
  s = await J('GET', '/admin/stats', null, null, true);
  ok(s.j.stats.depositAmount === 79500, 'a debit that did not go through is not subtracted');
  realLog(fail ? `FAIL: ${fail} failed` : `PASS: debits come off Total topped up (${pass} checks)`);
  process.exit(fail ? 1 : 0);
})().catch(e => { realLog('FAIL:', e); process.exit(1); });
