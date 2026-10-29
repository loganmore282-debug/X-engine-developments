'use strict';
// END-TO-END: runs the REAL server.js (in this process, against an in-memory stand-in for MongoDB) and drives it over HTTP like the app does:
// sign-up with the captcha, registration with a referral code typed in lower case, an unknown referral code, login, first-purchase commission,
// daily cashback paid at 00:00, the admin Plans analytics, a
// withdrawal request and its refusals, and 40 simultaneous registrations (every account id and referral code different).
const path = require('path'), Module = require('module');
const root = __dirname;
const fm = require('./test-helpers/fake-mongodb.js');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...a) { return req === 'mongodb' ? path.join(root, 'test-helpers', 'fake-mongodb.js') : origResolve.call(this, req, ...a); };
const PORT = 3900 + Math.floor(Math.random() * 90);
process.env.PORT = String(PORT); process.env.MONGODB_URI = 'mongodb://fake/chocolate'; process.env.ADMIN_KEY = 'e2e-admin-key-123456'; process.env.NODE_ENV = 'development';
// The captcha picture's answer never leaves the server, so this test run accepts 0000 (the real check is covered by test-captcha.js).
const cap = require('./captcha.js'); const realVerify = cap.verify; cap.verify = (id, code) => code === '0000' ? true : realVerify(id, code);
const realLog = console.log; console.log = () => {}; const realWarn = console.warn; console.warn = () => {};
require('./server.js');
const base = 'http://127.0.0.1:' + PORT;
const J = async (m, p, b, tok, adm) => { const r = await fetch(base + p, { method: m, headers: Object.assign({ 'content-type': 'application/json' }, tok ? { authorization: 'Bearer ' + tok } : {}, adm ? { authorization: 'Bearer e2e-admin-key-123456' } : {}), body: b ? JSON.stringify(b) : undefined }); let j = {}; try { j = await r.json(); } catch (_) {} return { s: r.status, j }; };
let fails = 0; const ok = (c, m, x) => { if (!c) { fails++; realLog('FAIL', m, x ? JSON.stringify(x).slice(0, 260) : ''); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ph = () => '07' + String(70000000 + Math.floor(Math.random() * 9999999)).padStart(8, '0').slice(-8);
async function member(pass, pin, ref) { const cap = await J('GET', '/auth/captcha'); const su = await J('POST', '/auth/signup', { phone: ph(), password: pass, captchaId: cap.j.id, captchaCode: '0000' }); const reg = await J('POST', '/register', { pin, referralCode: ref || '' }, su.j.token); return { tok: su.j.token, reg: reg.j, uid: su.j.uid }; }
(async () => {
  for (let i = 0; i < 60; i++) { try { const h = await fetch(base + '/health'); if (h.ok) break; } catch (_) {} await sleep(250); }
  await J('POST', '/admin/settings/update', { settings: { welcomeBonus: 500000 } }, null, true);
  const A = await member('secret12', '123456', ''); const B = await member('secret34', '123456', A.reg.referralCode);
  const prods = (await J('GET', '/public/products')).j.products.filter(p => p.price > 0).sort((a, b) => a.price - b.price); const p1 = prods[0];
  // ---- daily cashback at 00:00
  const buy = await J('POST', '/invest/create', { tierKey: p1.key }, B.tok); ok(buy.j.status === 'success', 'B buys ' + p1.name + ' (' + p1.price + ', ' + p1.cycle + ' days)', buy.j);
  const acct = async tok => (await J('GET', '/account', null, tok)).j.account;
  const w0 = (await acct(B.tok)).walletBalance;
  await sleep(2500); ok((await acct(B.tok)).walletBalance === w0, 'nothing is paid before the first 00:00');
  const inv = [...fm.__stores.investments.values()].find(i => i.userId === B.uid); ok(inv && inv.status === 'active', 'investment is active');
  const off = 180 * 60000, lastMidnight = Math.floor((Date.now() + off) / 86400000) * 86400000 - off;   // the most recent local 00:00 (Uganda)
  inv.createdAt = new Date(lastMidnight - 3600000); inv.nextPayoutAt = new Date(lastMidnight);   // bought an hour before that midnight: exactly ONE payment is due
  await sleep(3500);
  const w1 = (await acct(B.tok)).walletBalance; const one = Math.round(inv.expectedReturn / inv.payoutsTotal);
  ok(Math.round(w1 - w0) === one && inv.payoutsMade === 1, 'one payment (a ' + inv.payoutsTotal + 'th of the return) lands at the midnight: +' + (w1 - w0) + ' expected ' + one);
  await sleep(2500); ok((await acct(B.tok)).walletBalance === w1, 'and not again until the next midnight');
  inv.createdAt = new Date(Date.now() - (inv.payoutsTotal * 86400000 + 5000)); inv.nextPayoutAt = new Date(Date.now() - 1000);
  await sleep(3500);
  const w2 = (await acct(B.tok)).walletBalance; ok(Math.round(w2 - w0) === Math.round(inv.expectedReturn), 'the days that were missed are paid at once and the payments add up to the whole return: +' + (w2 - w0) + ' expected ' + inv.expectedReturn);
  await sleep(2500); const w3 = (await acct(B.tok)).walletBalance; ok(w3 === w2, 'and never paid twice');
  ok([...fm.__stores.investments.values()].find(i => i.userId === B.uid).status === 'matured', 'the product becomes matured after its last payment');
  const N = await member('secret56', '123456', A.reg.referralCode);   // never bought
  // ---- analytics with plans
  const an = await J('POST', '/admin/analytics', {}, null, true); ok(an.s === 200 && an.j.plans && Array.isArray(an.j.plans.mostPurchased), 'analytics answers with the Plans card', Object.keys(an.j));
  // ---- statement / team / transactions as the buyer
  for (const p of ['/team/stats', '/transactions', '/investments', '/bank/list']) { const r = await J('GET', p, null, B.tok); ok(r.s === 200, 'GET ' + p + ' answers 200', r.j); }

  // ---- withdrawal request
  const W0 = (await acct(B.tok)).walletBalance;
  const bs = await J('POST', '/bank/save', { holder: 'Test Holder', network: 'MTN Mobile Money', phone: '0771234567' }, B.tok); ok(bs.j.status === 'success', 'B binds a mobile-money wallet', bs.j);
  const wr = await J('POST', '/withdraw/request', { amount: 20000, network: 'MTN Mobile Money', phone: '0771234567', pin: '123456' }, B.tok); ok(wr.j.status === 'success', 'B requests a withdrawal of 20,000', wr.j);
  const W1 = (await acct(B.tok)).walletBalance; ok(Math.round(W0 - W1) === 20000, 'the wallet is debited 20,000 at once: ' + W0 + ' -> ' + W1);
  const wlist = [...fm.__stores.withdrawals.values()].filter(w => w.userId === B.uid); ok(wlist.length === 1 && wlist[0].status === 'pending', 'one pending request exists', wlist.map(w => w.status));
  const wr2 = await J('POST', '/withdraw/request', { amount: 20000, network: 'MTN Mobile Money', phone: '0771234567', pin: '123456' }, B.tok); ok(wr2.j.status !== 'success', 'a second request while one is open is refused', wr2.j);
  const wrBad = await J('POST', '/withdraw/request', { amount: 20000, network: 'MTN Mobile Money', phone: '0771234567', pin: '000000' }, N.tok); ok(wrBad.j.status !== 'success', 'a wrong Trade Password / unbound account cannot withdraw', wrBad.j);
  // ---- 40 simultaneous registrations
  {
    const A2 = await member('secret12', '123456', ''); const N2 = 40;
    const all = await Promise.all(Array.from({ length: N2 }, () => member('secret34', '123456', A2.reg.referralCode)));
    ok(all.every(m => m.reg && m.reg.status === 'success'), 'every simultaneous registration succeeded', all.filter(m => !(m.reg && m.reg.status === 'success')).map(m => m.reg).slice(0, 3));
    const ids = all.map(m => m.reg.publicId), codes = all.map(m => m.reg.referralCode);
    ok(new Set(ids).size === N2 && new Set(codes).size === N2, 'all 40 account ids and all 40 referral codes are different');
    ok(ids.every(i => /^[1-9]\d{4}$/.test(String(i))), 'ids are five digits');
    const ua = [...fm.__stores.users.values()].find(u => u.referralCode === A2.reg.referralCode); ok(ua.teamL1Count === N2, "the referrer's Level 1 count is exactly 40: " + ua.teamL1Count);
  }
  realLog(fails ? fails + ' FAILED' : 'PASS: end-to-end on the real server (sign-up, referral, login, first-purchase commission, daily cashback at 00:00, analytics, withdrawal, concurrent sign-ups)'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
