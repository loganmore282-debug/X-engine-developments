'use strict';
// A withdrawal request whose debit does not go through (the member's account changed between the checks and the charge): nothing is charged, the
// request row is closed AT ONCE (it must not block the next request until a sweep declines it), and the member is told the real reason, not
// "your withdrawal is being checked". END TO END on the real server.js against the in-memory MongoDB stand-in.
const path = require('path'), Module = require('module');
const root = __dirname;
const fm = require('./test-helpers/fake-mongodb.js');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...a) { return req === 'mongodb' ? path.join(root, 'test-helpers', 'fake-mongodb.js') : origResolve.call(this, req, ...a); };
const PORT = 3600 + Math.floor(Math.random() * 90);
Object.assign(process.env, { PORT: String(PORT), MONGODB_URI: 'mongodb://fake/choc', ADMIN_KEY: 'wd-admin-key-123456', NODE_ENV: 'development' });
const cap = require('./captcha.js'); const realVerify = cap.verify; cap.verify = (id, code) => code === '0000' ? true : realVerify(id, code);
const realLog = console.log; console.log = () => {}; console.warn = () => {}; console.error = () => {};
require('./server.js');
const base = 'http://127.0.0.1:' + PORT;
const J = async (m, p, b, tok, adm) => { const r = await fetch(base + p, { method: m, headers: Object.assign({ 'content-type': 'application/json' }, tok ? { authorization: 'Bearer ' + tok } : {}, adm ? { authorization: 'Bearer wd-admin-key-123456' } : {}), body: b ? JSON.stringify(b) : undefined }); let j = {}; try { j = await r.json(); } catch (_) {} return { s: r.status, j }; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0, n = 0; const ok = (c, m, x) => { n++; if (!c) { fails++; realLog('FAIL', m, x ? JSON.stringify(x).slice(0, 300) : ''); } };
(async () => {
  for (let i = 0; i < 60; i++) { try { const h = await fetch(base + '/health'); if (h.ok) break; } catch (_) {} await sleep(250); }
  await J('POST', '/admin/settings/update', { settings: { welcomeBonus: 400000 } }, null, true);
  const c = await J('GET', '/auth/captcha'); const su = await J('POST', '/auth/signup', { phone: '0771200001', password: 'secret12', captchaId: c.j.id, captchaCode: '0000' });
  await J('POST', '/register', { pin: '123456', referralCode: '' }, su.j.token);
  const prods = (await J('GET', '/public/products')).j.products.filter(p => p.price > 0).sort((a, b) => a.price - b.price);
  await J('POST', '/invest/create', { tierKey: prods[0].key }, su.j.token);
  await J('POST', '/bank/save', { holder: 'Test Holder', network: 'MTN Mobile Money', phone: '0771234567' }, su.j.token);
  const uid = su.j.uid, before = fm.__stores.users.get(uid).walletBalance;
  // the account changes (it is suspended) right after the request row is written and before the charge
  const W = fm.__stores.withdrawals, realSet = W.set.bind(W);
  W.set = (k, v) => { const r = realSet(k, v); if (v && v.status === 'creating') fm.__stores.users.get(v.userId).status = 'banned'; return r; };
  const res = await J('POST', '/withdraw/request', { amount: 20000, network: 'MTN Mobile Money', phone: '0771234567', pin: '123456' }, su.j.token);
  W.set = realSet;
  ok(res.s === 400 && /balance or account status changed/i.test(res.j.message || ''), 'the member is told the real reason (not "being checked")', res);
  ok(res.j.code !== 'WITHDRAWAL_RECOVERY_PENDING', 'and it is not the "recovery pending" answer', res.j);
  const rows = [...W.values()].filter(w => w.userId === uid);
  ok(rows.length === 1 && rows[0].status === 'declined' && /Not charged/.test(rows[0].failureReason || ''), 'the request row is closed at once as not charged', rows);
  ok(fm.__stores.users.get(uid).walletBalance === before, 'nothing was taken from the wallet', { before, after: fm.__stores.users.get(uid).walletBalance });
  ok(![...fm.__stores.transactions.values()].some(t => t.userId === uid && t.type === 'withdraw'), 'and no withdrawal history row exists');
  // the account is fine again: a new request is NOT blocked by the closed row
  fm.__stores.users.get(uid).status = 'active';
  const again = await J('POST', '/withdraw/request', { amount: 20000, network: 'MTN Mobile Money', phone: '0771234567', pin: '123456' }, su.j.token);
  ok(again.s === 200 && again.j.status === 'success', 'the next request goes straight through', again);
  realLog(fails ? 'FAIL: ' + fails + ' of ' + n : 'test-withdraw-not-charged: ' + n + ' checks passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { realLog(e); process.exit(1); });
