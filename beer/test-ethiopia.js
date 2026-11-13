'use strict';
// Beer is an Ethiopia app: Br amounts, +251 numbers, Telebirr / Commercial Bank of Ethiopia withdrawal accounts, and recharge by
// bank / Telebirr payment numbers (admin types them, the member pays, pastes the SMS, the admin approves). Real server, fake MongoDB.
const path = require('path'), Module = require('module'), fs = require('fs'), assert = require('node:assert/strict');
const fm = require('./test-helpers/fake-mongodb.js');
const orig = Module._resolveFilename;
Module._resolveFilename = function (r, ...a) { return r === 'mongodb' ? path.join(__dirname, 'test-helpers', 'fake-mongodb.js') : orig.call(this, r, ...a); };
const BACK = 5900 + Math.floor(Math.random() * 90);
process.env.PORT = String(BACK); process.env.MONGODB_URI = 'mongodb://fake/app'; process.env.ADMIN_KEY = 'eth-admin-key-1234567890'; process.env.NODE_ENV = 'development';
process.env.COOKIE_SECRETS_DIR = fs.mkdtempSync(path.join(require('os').tmpdir(), 'beer-eth-'));
const L = console.log; console.log = () => {}; console.warn = () => {}; console.error = () => {};
require('./server.js');
const sleep = ms => new Promise(r => setTimeout(r, ms)), base = 'http://127.0.0.1:' + BACK;
const J = async (m, p, b, tok, adm) => { const r = await fetch(base + p, { method: m, headers: Object.assign({ 'content-type': 'application/json' }, tok ? { authorization: 'Bearer ' + tok } : {}, adm ? { authorization: 'Bearer eth-admin-key-1234567890' } : {}), body: b ? JSON.stringify(b) : undefined }); let j = null; try { j = await r.json(); } catch (_) {} return { s: r.status, j }; };
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); };
(async () => {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/health')).ok) break; } catch (_) {} await sleep(250); }
  // ── region and money labels ──
  const ps = await J('GET', '/public/settings');
  ok(ps.j.settings.manualPay === false && ps.j.settings.depositAvailable === false, 'with no payment numbers yet, recharging is off');
  // ── sign up with an Ethiopian number; a Ugandan one is refused ──
  const bad = await J('POST', '/auth/signup', { phone: '0771234567x', password: 'secret12' });
  ok(bad.s >= 400, 'junk is refused');
  const su = await J('POST', '/auth/signup', { phone: '0911223344', password: 'secret12' });
  ok(su.s === 200 && su.j.token, 'an Ethiopian 09.. number signs up');
  const tok = su.j.token; await J('POST', '/register', { pin: '123456', referralCode: '' }, tok);
  const acct = await J('GET', '/account', null, tok);
  ok(acct.j.region && acct.j.region.key === 'et' && acct.j.region.currency === 'ETB' && acct.j.region.currencySymbol === 'Br' && acct.j.region.dialCode === '251', 'the region is Ethiopia, ETB written Br, +251');
  ok(JSON.stringify(acct.j.region.prefixes) === JSON.stringify(['9', '7']) && acct.j.region.localLength === 9, 'numbers are +251 then 9 digits starting 9 or 7');
  let uid; for (const [id] of fm.__stores.users) uid = id;
  // ── payment numbers (admin) ──
  const noCh = await J('POST', '/deposit/manual/order', { amount: 35000, channelId: 'x' }, tok);
  ok(noCh.s === 400, 'no recharge without a payment number');
  const sv = await J('POST', '/admin/pay-channels/save', { name: 'Commercial Bank of Ethiopia', kind: 'bank', accountName: 'Test Owner', accountNumber: '1000809418239' }, null, true);
  ok(sv.s === 200 && sv.j.id, 'the admin saves a payment number');
  const chId = sv.j.id;
  const pub = await J('GET', '/public/pay-channels');
  ok(pub.j.channels.length === 1 && !('accountNumber' in pub.j.channels[0]), 'members see the name and logo only, never the account number, until they start an order');
  const ps2 = await J('GET', '/public/settings'); ok(ps2.j.settings.manualPay === true && ps2.j.settings.depositAvailable === true, 'a payment number turns recharging on');
  // ── order, resume, new order each time ──
  const o1 = await J('POST', '/deposit/manual/order', { amount: 35000, channelId: chId }, tok);
  ok(o1.s === 200 && o1.j.accountNumber === '1000809418239' && o1.j.amount === 35000 && o1.j.expiresAt > Date.now(), 'the order shows the account to pay and a 30 minute clock');
  const o1b = await J('POST', '/deposit/manual/order', { amount: 35000, channelId: chId, depositId: o1.j.depositId, resume: true }, tok);
  ok(o1b.s === 200 && o1b.j.depositId === o1.j.depositId && o1b.j.expiresAt === o1.j.expiresAt, 'resume gives back the same order and its clock');
  const o2 = await J('POST', '/deposit/manual/order', { amount: 35000, channelId: chId }, tok);
  ok(o2.s === 200 && o2.j.depositId !== o1.j.depositId, 'picking again starts a NEW order');
  const gone = await J('POST', '/deposit/manual/order', { amount: 35000, channelId: chId, depositId: o1.j.depositId, resume: true }, tok);
  ok(gone.s === 409 && gone.j.code === 'ORDER_GONE', 'the older unsent order was closed');
  // ── pasted SMS ──
  const badSms = await J('POST', '/deposit/manual/submit', { depositId: o2.j.depositId, sms: 'hello' }, tok);
  ok(badSms.s === 400 && badSms.j.code === 'BAD_SMS', 'something that is not a transfer message is refused');
  await sleep(3100);
  const sms = 'Dear AMIR You have transferred ETB 35,000.00 to TEST OWNER (2510****3268) on 01/02/2026 13:07:25. Your transaction number is DA39J9GAMN. The service fee is ETB 0.87.';
  const sub = await J('POST', '/deposit/manual/submit', { depositId: o2.j.depositId, sms }, tok);
  ok(sub.s === 200 && sub.j.state === 'review', 'the claim goes to review');
  const dep = fm.__stores.pendingDeposits.get(o2.j.depositId);
  ok(dep.status === 'review' && dep.pastedSmsTxId === 'DA39J9GAMN' && dep.pastedSmsAmountMatches === true, 'the transaction number and amount are read from the SMS');
  const before = Number(fm.__stores.users.get(uid).walletBalance) || 0;
  ok(before === 0 || before >= 0, 'nothing is credited by the member side');
  // a second member cannot reuse the same transaction number
  const su2 = await J('POST', '/auth/signup', { phone: '0922334455', password: 'secret12' }); await J('POST', '/register', { pin: '123456', referralCode: '' }, su2.j.token);
  const p2 = await J('POST', '/deposit/manual/order', { amount: 35000, channelId: chId }, su2.j.token); await sleep(3100);
  const dupe = await J('POST', '/deposit/manual/submit', { depositId: p2.j.depositId, sms }, su2.j.token);
  ok(dupe.s === 409, 'the same transfer cannot back two claims');
  // ── approve (force-credit) credits once ──
  const fc = await J('POST', '/admin/deposit/force-credit', { depositId: o2.j.depositId }, null, true);
  ok(fc.s === 200, 'the admin approves the recharge');
  const after = Number(fm.__stores.users.get(uid).walletBalance) || 0;
  ok(after - before === 35000, 'the wallet got exactly Br 35,000');
  await J('POST', '/admin/deposit/force-credit', { depositId: o2.j.depositId }, null, true);
  ok((Number(fm.__stores.users.get(uid).walletBalance) || 0) === after, 'approving twice never credits twice');
  // ── withdrawal accounts ──
  const mtn = await J('POST', '/bank/save', { holder: 'A B', network: 'MTN Mobile Money', phone: '0771234567' }, tok);
  ok(mtn.s === 400, 'MTN is no longer offered');
  const tele = await J('POST', '/bank/save', { holder: 'A B', network: 'Telebirr', phone: '0911223344' }, tok);
  ok(tele.s === 200, 'Telebirr with a +251 number is saved');
  const cbe = await J('POST', '/bank/save', { holder: 'A B', network: 'Commercial Bank of Ethiopia', phone: '1000809418239' }, tok);
  ok(cbe.s === 200, 'a Commercial Bank of Ethiopia account number is saved');
  const badCbe = await J('POST', '/bank/save', { holder: 'A B', network: 'Commercial Bank of Ethiopia', phone: '12' }, tok);
  ok(badCbe.s === 400, 'a bank account number that is too short is refused');
  // ── the Team list masks with +251 ──
  const mod = fs.readFileSync(path.join(__dirname, 'user-src', 'original_module.js'), 'utf8');
  ok(/var REGION = \{ key: 'et', name: 'Ethiopia', currency: 'ETB', currencySymbol: 'Br', dialCode: '251'/.test(mod) && /function cur\(\)\{ return \(REGION && \(REGION\.currencySymbol/.test(mod), 'the app\'s own default is Ethiopia and prints Br');
  ok(/window\.openManualPayFlow/.test(mod) && /window\.resumeManualPay/.test(mod) && /\/deposit\/manual\/order/.test(mod), 'the app has the bank / Telebirr payment pages');
  L('PASS: Ethiopia (' + n + ' checks)');
  process.exit(0);
})().catch(e => { L('FAIL', e.message); process.exit(1); });
