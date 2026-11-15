// Rejecting a manual recharge (admin Recharges tab) on the real server with the fake MongoDB: a recharge in review can be rejected, nothing is credited,
// the member's record reads Failed, a credited one cannot be rejected, Approve and Reject in parallel never both win, and a wrong rejection can still be approved.
const path = require('path'), Module = require('module'), fs = require('fs'), assert = require('assert');
const D = process.env.APPDIR || __dirname; process.chdir(D);
const fm = require(path.join(D, 'test-helpers', 'fake-mongodb.js'));
const o = Module._resolveFilename;
Module._resolveFilename = function (r, ...a) { return r === 'mongodb' ? path.join(D, 'test-helpers', 'fake-mongodb.js') : o.call(this, r, ...a); };
const BACK = 7900 + Math.floor(Math.random() * 300);
process.env.PORT = String(BACK); process.env.MONGODB_URI = 'mongodb://fake/app'; process.env.ADMIN_KEY = 'reject-admin-key-1234567890'; process.env.NODE_ENV = 'development';
process.env.COOKIE_SECRETS_DIR = fs.mkdtempSync(path.join(require('os').tmpdir(), 'beer-reject-'));
const L = console.log; console.log = () => {}; console.warn = () => {}; console.error = () => {};
require(path.join(D, 'server.js'));
const base = 'http://127.0.0.1:' + BACK, sleep = ms => new Promise(r => setTimeout(r, ms));
const J = async (m, p, b, tok, adm) => { const r = await fetch(base + p, { method: m, headers: Object.assign({ 'content-type': 'application/json' }, tok ? { authorization: 'Bearer ' + tok } : {}, adm ? { authorization: 'Bearer ' + process.env.ADMIN_KEY } : {}), body: (b === undefined || m === 'GET') ? undefined : JSON.stringify(b) }); return { s: r.status, j: await r.json().catch(() => ({})) }; };
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); }; const eq = (a, b, m) => { n++; assert.deepStrictEqual(a, b, m); };
(async () => {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/health')).ok) break; } catch (_) {} await sleep(250); }
  await J('POST', '/admin/settings/update', { settings: { minDeposit: 5000 } }, null, true);
  const ch = await J('POST', '/admin/pay-channels/save', { name: 'Telebirr', kind: 'wallet', accountName: 'Owner', accountNumber: '0911000111', order: 0 }, null, true); eq(ch.s, 200, 'payment number saved');
  const su = await J('POST', '/auth/signup', { phone: '0911000001', password: 'secret12' }); await J('POST', '/register', { pin: '123456', referralCode: '' }, su.j.token); const T = su.j.token;
  let uid; for (const [id] of fm.__stores.users) uid = id; const bal = () => fm.__stores.users.get(uid).walletBalance || 0, dep = id => fm.__stores.pendingDeposits.get(id);
  const txOf = id => [...fm.__stores.transactions.values()].filter(t => t.depositId === id);
  let smsN = 0;
  const order = async amount => { const o = await J('POST', '/deposit/manual/order', { amount, channelId: ch.j.id }, T); eq(o.s, 200, 'order made'); return o.j.depositId; };
  const submit = async id => { smsN++; await sleep(3100); const r = await J('POST', '/deposit/manual/submit', { depositId: id, sms: 'Your transaction number is AB12CD34E' + (smsN % 10) + ' you have sent ETB 10,000.00' }, T); eq([r.s, r.j.state], [200, 'review'], 'payment message accepted for review'); };
  // 1. reject a recharge in review
  const d1 = await order(10000); await submit(d1); const before = bal();
  { const bz = await J('GET', '/admin/badges', undefined, null, true); eq([bz.j.reviewDeposits, bz.j.pendingDeposits], [1, 1], 'the Deposits tab badge counts the recharge waiting for review'); }
  eq((await J('POST', '/admin/deposit/reject', { depositId: d1 }, T)).s, 401, 'a member cannot reject');
  eq((await J('POST', '/admin/deposit/reject', { depositId: '' }, null, true)).s, 400, 'an id is required');
  eq((await J('POST', '/admin/deposit/reject', { depositId: 'nope' }, null, true)).s, 404, 'an unknown recharge is 404');
  let r = await J('POST', '/admin/deposit/reject', { depositId: d1, reason: '<b>no money</b>' }, null, true);
  eq(r.s, 200, 'rejected'); eq(dep(d1).status, 'failed', 'the order is failed'); eq(dep(d1).failureReason, 'no money', 'the reason is stored without markup'); eq(bal(), before, 'nothing was credited');
  eq(txOf(d1).map(t => [t.status, t.amount, /Failed/.test(t.description)]), [['failed', 0, true]], 'the member record reads Failed and counts as zero');
  r = await J('POST', '/admin/deposit/reject', { depositId: d1 }, null, true); eq([r.s, r.j.message], [200, 'Already rejected'], 'rejecting twice is harmless');
  const badges = await J('GET', '/admin/badges', undefined, null, true); eq([badges.j.pendingDeposits, badges.j.reviewDeposits], [0, 0], 'the Recharges badge is clear again');
  // 2. a wrong rejection can still be approved, and the record is restored
  r = await J('POST', '/admin/deposit/force-credit', { depositId: d1 }, null, true); eq(r.s, 200, 'a rejected recharge can still be approved');
  eq(bal() - before, 10000, 'approved once'); eq(txOf(d1).map(t => [t.status, t.amount]), [['success', 10000]], 'the record reads Success again with its amount');
  r = await J('POST', '/admin/deposit/reject', { depositId: d1 }, null, true); eq(r.s, 400, 'a credited recharge cannot be rejected'); eq(bal() - before, 10000, 'and the wallet keeps the money');
  // 3. Approve and Reject at the same moment: exactly one outcome
  const d2 = await order(10000); await submit(d2); const b2 = bal();
  const both = await Promise.all([J('POST', '/admin/deposit/force-credit', { depositId: d2 }, null, true), J('POST', '/admin/deposit/reject', { depositId: d2 }, null, true)]);
  const st = dep(d2).status, delta = bal() - b2;
  ok((st === 'matched' && delta === 10000) || (st === 'failed' && delta === 0), 'approve + reject together end as one clean outcome: ' + st + ' ' + delta + ' ' + both.map(x => x.s).join());
  // 4. an order with no message yet can be rejected too; an expired/other status cannot
  const d3 = await order(7000); r = await J('POST', '/admin/deposit/reject', { depositId: d3 }, null, true); eq([r.s, dep(d3).status], [200, 'failed'], 'a waiting order can be rejected');
  // 5. the integrity check is still clean for this member
  const integ = await J('GET', '/admin/integrity', undefined, null, true);
  eq((integ.j.mismatches || []).filter(m => m.userId === uid), [], 'wallet and totals still match the records');
  L(`PASS: reject a recharge (${n} checks)`); process.exit(0);
})().catch(e => { L('FAIL', e.stack || e); process.exit(1); });
