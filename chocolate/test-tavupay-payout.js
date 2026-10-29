'use strict';
// TavuPay PAYOUTS (withdrawals). Runs the REAL server.js against an in-memory MongoDB and a fake TavuPay (https.request is replaced for that host):
// the admin may pick TavuPay; the disbursement request has the documented shape (type, phone, amount = the member's net, idempotencyKey = the
// withdrawal id, the two key headers); acceptance lands on 'processing' with totalWithdrawn counted once; a signed transfer.success finishes it
// (and a replay changes nothing); an unsigned one is only a hint (the payout is re-read); a clean refusal puts the row back on Pending with the
// wallet untouched; a signed transfer.failed refunds the member and unwinds totalWithdrawn; a lost reply stays on 'sending' (never pending) and
// can only be rejected after the owner confirms; Verify never says "nothing was sent" about a payout that may have gone.
const path = require('path'), Module = require('module'), crypto = require('node:crypto'), https = require('node:https'), EventEmitter = require('node:events'), fs = require('node:fs');
const root = __dirname;
const fm = require('./test-helpers/fake-mongodb.js');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...a) { return req === 'mongodb' ? path.join(root, 'test-helpers', 'fake-mongodb.js') : origResolve.call(this, req, ...a); };
const PORT = 3800 + Math.floor(Math.random() * 90);
process.env.PORT = String(PORT); process.env.MONGODB_URI = 'mongodb://fake/chocolate'; process.env.ADMIN_KEY = 'e2e-admin-key-123456'; process.env.NODE_ENV = 'development';
process.env.TAVUPAY_API_KEY = 'ep_live_key'; process.env.TAVUPAY_API_SECRET = 'the-secret';
const cap = require('./captcha.js'); const realVerify = cap.verify; cap.verify = (id, code) => code === '0000' ? true : realVerify(id, code);

// ── a fake TavuPay: every call is recorded, the next reply is set by the test
const calls = []; let nextReply = () => ({ status: 200, body: { ok: true, reference: 'TVP-DEFAULT' } });
const realRequest = https.request;
https.request = function (opts, cb) {
  if (!opts || opts.hostname !== 'api.tavupay.lat') return realRequest.apply(https, arguments);
  const req = new EventEmitter(); let body = '';
  req.write = c => { body += c; }; req.destroy = () => {};
  req.end = () => {
    const call = { method: opts.method, path: opts.path, headers: opts.headers, body: body ? JSON.parse(body) : null, family: opts.family };
    calls.push(call);
    const r = nextReply(call);
    if (r.error) { setImmediate(() => req.emit('error', new Error(r.error))); return; }
    const resp = new EventEmitter(); resp.statusCode = r.status;
    setImmediate(() => { cb(resp); resp.emit('data', Buffer.from(JSON.stringify(r.body || {}))); resp.emit('end'); });
  };
  return req;
};
const realLog = console.log; console.log = () => {}; const realWarn = console.warn; console.warn = () => {}; const realErr = console.error; console.error = () => {};
require('./server.js');
const base = 'http://127.0.0.1:' + PORT;
const J = async (m, p, b, tok, adm) => { const r = await fetch(base + p, { method: m, headers: Object.assign({ 'content-type': 'application/json' }, tok ? { authorization: 'Bearer ' + tok } : {}, adm ? { authorization: 'Bearer e2e-admin-key-123456' } : {}), body: b ? JSON.stringify(b) : undefined }); let j = {}; try { j = await r.json(); } catch (_) {} return { s: r.status, j }; };
let fails = 0, checks = 0; const ok = (c, m, x) => { checks++; if (!c) { fails++; realLog('FAIL', m, x ? JSON.stringify(x).slice(0, 300) : ''); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ph = () => '07' + String(70000000 + Math.floor(Math.random() * 9999999)).padStart(8, '0').slice(-8);
async function member(pass, pin) { const c = await J('GET', '/auth/captcha'); const su = await J('POST', '/auth/signup', { phone: ph(), password: pass, captchaId: c.j.id, captchaCode: '0000' }); const reg = await J('POST', '/register', { pin, referralCode: '' }, su.j.token); return { tok: su.j.token, reg: reg.j, uid: su.j.uid }; }
const hook = async (body, signed) => {
  const raw = JSON.stringify(body); const headers = { 'content-type': 'application/json' };
  if (signed === true) headers['x-tavupay-signature'] = crypto.createHmac('sha256', 'the-secret').update(raw).digest('hex');
  if (signed === 'bad') headers['x-tavupay-signature'] = '0'.repeat(64);
  const r = await fetch(base + '/tavupay/webhook', { method: 'POST', headers, body: raw }); await sleep(250); return r.status;
};
const wits = () => [...fm.__stores.withdrawals.entries()].map(([id, w]) => ({ id, ...w }));
const wOf = uid => wits().filter(w => w.userId === uid).sort((a, b) => String(a.id) < String(b.id) ? -1 : 1).pop();
const userOf = uid => fm.__stores.users.get(uid);

(async () => {
  for (let i = 0; i < 60; i++) { try { const h = await fetch(base + '/health'); if (h.ok) break; } catch (_) {} await sleep(250); }
  await J('POST', '/admin/settings/update', { settings: { welcomeBonus: 500000 } }, null, true);
  // ---- the admin choice
  const bad = await J('POST', '/admin/settings/update', { settings: { withdrawMethod: 'bogus' } }, null, true); ok(bad.s === 400 && /tavupay/.test(bad.j.message), 'an unknown payout method is refused and the message lists tavupay', bad.j);
  const good = await J('POST', '/admin/settings/update', { settings: { withdrawMethod: 'tavupay' } }, null, true); ok(good.j.status === 'success', 'the admin can pin payouts to TavuPay', good.j);
  const lst0 = await J('POST', '/admin/withdrawals/list', {}, null, true); ok(lst0.j.payoutMode === 'tavupay', 'the withdrawals list reports payoutMode tavupay', lst0.j.payoutMode);

  // one member per scenario (a member may have only one open request)
  const prods = (await J('GET', '/public/products')).j.products.filter(p => p.price > 0).sort((a, b) => a.price - b.price);
  async function request(m) {
    const buy = await J('POST', '/invest/create', { tierKey: prods[0].key }, m.tok); ok(buy.j.status === 'success', 'the member bought a product first (withdrawing needs one)', buy.j);
    m.num = '077' + String(1000000 + Math.floor(Math.random() * 8999999));
    const bs = await J('POST', '/bank/save', { holder: 'Test Holder', network: 'MTN Mobile Money', phone: m.num }, m.tok); ok(bs.j.status === 'success', 'wallet bound', bs.j);
    const wr = await J('POST', '/withdraw/request', { amount: 20000, network: 'MTN Mobile Money', phone: m.num, pin: '123456' }, m.tok); ok(wr.j.status === 'success', 'withdrawal requested', wr.j);
    return wOf(m.uid);
  }

  // ---- 1. accepted -> processing -> signed success -> processed
  const A = await member('secret12', '123456'); let w = await request(A);
  const bal0 = userOf(A.uid).walletBalance, tw0 = Number(userOf(A.uid).totalWithdrawn) || 0;
  nextReply = () => ({ status: 200, body: { ok: true, message: 'Request sent.', reference: 'TVP-AAA111' } });
  const p1 = await J('POST', '/admin/withdraw/process', { withdrawalId: w.id, expectManual: false }, null, true); ok(p1.s === 200 && p1.j.status === 'success', 'Send via TavuPay works', p1.j);
  const c1 = calls[calls.length - 1];
  ok(c1.method === 'POST' && c1.path === '/v1/payments' && c1.family === 4, 'POST /v1/payments over IPv4', c1);
  ok(c1.headers['X-API-Key'] === 'ep_live_key' && c1.headers['X-API-Secret'] === 'the-secret' && !c1.headers.Authorization, 'the two key headers, no Bearer');
  ok(c1.body.type === 'disbursement' && c1.body.phone === '+256' + A.num.slice(1) && c1.body.amount === Math.round(w.net) && c1.body.idempotencyKey === w.id, 'disbursement body: type, +256 phone, the member\'s NET, idempotencyKey = withdrawal id', c1.body);
  w = wits().find(x => x.id === w.id);
  ok(w.status === 'processing' && w.tavupayTxId === 'TVP-AAA111' && w.tavupayRef === w.id, 'accepted lands on processing with TavuPay\'s reference saved', w);
  ok((Number(userOf(A.uid).totalWithdrawn) || 0) - tw0 === w.net, 'totalWithdrawn counted once');
  // an unsigned success is only a hint: the payout is re-read
  nextReply = () => ({ status: 200, body: { ok: true, status: 'pending' } });
  await hook({ event: 'transfer.success', reference: 'TVP-AAA111', idempotencyKey: w.id, amount: w.net }, false);
  ok(wits().find(x => x.id === w.id).status === 'processing', 'an unsigned success with TavuPay still saying pending changes nothing');
  nextReply = () => ({ status: 404, body: {} });
  await hook({ event: 'transfer.success', reference: 'TVP-AAA111' }, false);
  ok(wits().find(x => x.id === w.id).status === 'processing', 'unsigned and the status call unavailable: nothing changes');
  ok(await hook({ event: 'transfer.success', reference: 'TVP-AAA111' }, 'bad') === 202, 'a wrongly signed call is still acknowledged');
  ok(wits().find(x => x.id === w.id).status === 'processing', 'and treated as a hint only');
  await hook({ event: 'transfer.success', reference: 'TVP-AAA111', idempotencyKey: w.id, amount: w.net }, true);
  ok(wits().find(x => x.id === w.id).status === 'processed', 'a signed transfer.success finishes it');
  const twAfter = Number(userOf(A.uid).totalWithdrawn) || 0;
  await hook({ event: 'transfer.success', reference: 'TVP-AAA111', idempotencyKey: w.id }, true);
  ok(wits().find(x => x.id === w.id).status === 'processed' && (Number(userOf(A.uid).totalWithdrawn) || 0) === twAfter, 'a replay changes nothing');
  await hook({ event: 'transfer.failed', reference: 'TVP-AAA111', idempotencyKey: w.id }, true);
  ok(wits().find(x => x.id === w.id).status === 'processed', 'a late failure never undoes a processed payout');
  ok(userOf(A.uid).walletBalance === bal0, 'the wallet was not touched by settling');

  // ---- 2. a clean refusal: back to pending, wallet untouched
  const B = await member('secret34', '123456'); let wb = await request(B);
  const balB = userOf(B.uid).walletBalance;
  nextReply = () => ({ status: 403, body: { ok: false, error: 'IP address 1.2.3.4 is not whitelisted.' } });
  const p2 = await J('POST', '/admin/withdraw/process', { withdrawalId: wb.id, expectManual: false }, null, true);
  ok(p2.s === 400 && /whitelist/i.test(p2.j.message), 'a refused payout tells the admin why (whitelist)', p2.j);
  wb = wits().find(x => x.id === wb.id);
  ok(wb.status === 'pending' && !wb.tavupayRef && !wb.tavupayTxId, 'a clean refusal puts the row back on pending', wb);
  ok(userOf(B.uid).walletBalance === balB && !(Number(userOf(B.uid).totalWithdrawn) > 0), 'wallet and totalWithdrawn untouched');
  nextReply = () => ({ status: 400, body: { ok: false, message: 'The number is not in your saved withdrawal numbers' } });
  const p2b = await J('POST', '/admin/withdraw/process', { withdrawalId: wb.id, expectManual: false }, null, true);
  ok(p2b.s === 400 && /saved withdrawal numbers/.test(p2b.j.message), 'TavuPay\'s own reason is shown to the admin', p2b.j);
  ok(wits().find(x => x.id === wb.id).status === 'pending', 'still pending');
  // then accepted, then a SIGNED failure refunds the member
  nextReply = () => ({ status: 200, body: { ok: true, reference: 'TVP-BBB222' } });
  const p2c = await J('POST', '/admin/withdraw/process', { withdrawalId: wb.id, expectManual: false }, null, true); ok(p2c.j.status === 'success', 'sent on the next try', p2c.j);
  ok(calls[calls.length - 1].body.idempotencyKey === wb.id, 'the retry carries the SAME idempotency key (TavuPay de-duplicates)');
  const amtB = wits().find(x => x.id === wb.id).amount;
  await hook({ event: 'transfer.failed', data: { transactionReference: 'TVP-BBB222', transactionStatus: 'FAILED' } }, true);
  wb = wits().find(x => x.id === wb.id);
  ok(wb.status === 'declined', 'a signed transfer.failed declines the payout', wb.status);
  await sleep(300);
  ok(Math.round(userOf(B.uid).walletBalance - balB) === Math.round(amtB), 'the member is refunded in full: ' + balB + ' -> ' + userOf(B.uid).walletBalance + ' (amount ' + amtB + ')');
  ok(!(Number(userOf(B.uid).totalWithdrawn) > 0), 'and totalWithdrawn is unwound');

  // ---- 3. a lost reply stays on 'sending'
  const C = await member('secret56', '123456'); let wc = await request(C);
  nextReply = () => ({ error: 'socket hang up' });
  const p3 = await J('POST', '/admin/withdraw/process', { withdrawalId: wc.id, expectManual: false }, null, true);
  ok(p3.s === 500 && /Sending/.test(p3.j.message), 'a lost reply is reported as ambiguous', p3.j);
  wc = wits().find(x => x.id === wc.id);
  ok(wc.status === 'sending' && wc.tavupayRef === wc.id, 'it stays on sending (never pending) with our reference written first', wc);
  const balC = userOf(C.uid).walletBalance;
  // an unsigned failure cannot refund a sending row
  nextReply = () => ({ status: 200, body: { ok: true, status: 'failed' } });
  await hook({ event: 'transfer.failed', idempotencyKey: wc.id }, false);
  ok(wits().find(x => x.id === wc.id).status === 'sending', 'an unsigned failure does not touch a sending row');
  // Verify never claims "nothing was sent"
  const v3 = await J('POST', '/admin/withdraw/verify', { withdrawalId: wc.id }, null, true);
  ok(v3.j.marzStatus === 'unverifiable' && /does NOT mean nothing was sent/.test(v3.j.message), 'Verify on a sending row warns it may have gone out', v3.j);
  // Reject needs the owner's confirmation while TavuPay cannot be asked
  const r3 = await J('POST', '/admin/withdraw/reject', { withdrawalId: wc.id, reason: 'x' }, null, true);
  ok(r3.s === 409 && r3.j.needsConfirm === true, 'reject without confirmation is refused', r3.j);
  ok(wits().find(x => x.id === wc.id).status === 'sending', 'and nothing changed');
  const r3b = await J('POST', '/admin/withdraw/reject', { withdrawalId: wc.id, reason: 'checked TavuPay, nothing went out', confirmedNotSent: true }, null, true);
  ok(r3b.j.status === 'success' && wits().find(x => x.id === wc.id).status === 'declined', 'after the owner confirms, the reject refunds', r3b.j);
  await sleep(200);
  ok(Math.round(userOf(C.uid).walletBalance - balC) === Math.round(wc.amount), 'refunded the requested amount once: ' + balC + ' -> ' + userOf(C.uid).walletBalance);

  // ---- 4. a SIGNED failure for a row still on 'sending' (TavuPay received and refused it)
  const D = await member('secret78', '123456'); let wd = await request(D);
  nextReply = () => ({ error: 'timeout' });
  await J('POST', '/admin/withdraw/process', { withdrawalId: wd.id, expectManual: false }, null, true);
  ok(wits().find(x => x.id === wd.id).status === 'sending', 'another lost reply');
  const balD = userOf(D.uid).walletBalance;
  await hook({ event: 'transfer.failed', idempotencyKey: wd.id, reference: 'TVP-DDD444' }, true);
  ok(wits().find(x => x.id === wd.id).status === 'declined', 'a signed failure that carries our idempotency key declines it');
  await sleep(200);
  ok(Math.round(userOf(D.uid).walletBalance - balD) === Math.round(wd.amount) && !(Number(userOf(D.uid).totalWithdrawn) > 0), 'refunded once, totalWithdrawn never counted');
  // and a signed success for a sending row records it as paid, counted once
  const E = await member('secret90', '123456'); let we = await request(E);
  nextReply = () => ({ error: 'timeout' });
  await J('POST', '/admin/withdraw/process', { withdrawalId: we.id, expectManual: false }, null, true);
  await hook({ event: 'transfer.success', idempotencyKey: we.id, reference: 'TVP-EEE555' }, true);
  we = wits().find(x => x.id === we.id);
  ok(we.status === 'processed' && Math.round(Number(userOf(E.uid).totalWithdrawn)) === Math.round(we.net), 'a signed success for a sending row is recorded and counted once', we);

  // ---- 5. accepted without a reference stays on sending and cannot be rejected blindly
  const F = await member('secret11', '123456'); let wf = await request(F);
  nextReply = () => ({ status: 200, body: { ok: true, message: 'Request sent.' } });
  const p5 = await J('POST', '/admin/withdraw/process', { withdrawalId: wf.id, expectManual: false }, null, true);
  ok(p5.s === 500 && wits().find(x => x.id === wf.id).status === 'sending', 'accepted with no reference stays on sending', p5.j);

  // ---- verify on a normal processing row, with the status call answering
  const G = await member('secret22', '123456'); let wg = await request(G);
  nextReply = () => ({ status: 200, body: { ok: true, reference: 'TVP-GGG777' } });
  await J('POST', '/admin/withdraw/process', { withdrawalId: wg.id, expectManual: false }, null, true);
  nextReply = () => ({ status: 200, body: { ok: true, status: 'pending' } });
  const v6 = await J('POST', '/admin/withdraw/verify', { withdrawalId: wg.id }, null, true); ok(/still has this payout in flight/.test(v6.j.message), 'Verify reads TavuPay\'s status', v6.j);
  const r6 = await J('POST', '/admin/withdraw/reject', { withdrawalId: wg.id, reason: 'x' }, null, true); ok(r6.s === 409 && !r6.j.needsConfirm, 'a payout TavuPay still has in flight cannot be rejected', r6.j);
  nextReply = () => ({ status: 200, body: { ok: true, status: 'failed' } });
  const r6b = await J('POST', '/admin/withdraw/reject', { withdrawalId: wg.id, reason: 'failed at TavuPay' }, null, true); ok(r6b.j.status === 'success', 'once TavuPay says failed, reject refunds', r6b.j);

  // ---- the reconciler / admin Sync re-reads accepted payouts
  const H = await member('secret33', '123456'); let wh = await request(H);
  nextReply = () => ({ status: 200, body: { ok: true, reference: 'TVP-HHH888' } });
  await J('POST', '/admin/withdraw/process', { withdrawalId: wh.id, expectManual: false }, null, true);
  nextReply = () => ({ status: 404, body: {} });
  let sy = await J('GET', '/admin/payments/sync', null, null, true); ok(sy.j.status === 'success' && wits().find(x => x.id === wh.id).status === 'processing', 'Sync with the status call unavailable leaves it processing', sy.j);
  nextReply = () => ({ status: 200, body: { ok: true, status: 'pending' } });
  sy = await J('GET', '/admin/payments/sync', null, null, true); ok(wits().find(x => x.id === wh.id).status === 'processing', 'Sync with TavuPay still pending leaves it');
  nextReply = () => ({ status: 200, body: { ok: true, status: 'successful', amount: wh.net } });
  sy = await J('GET', '/admin/payments/sync', null, null, true); ok(wits().find(x => x.id === wh.id).status === 'processed', 'Sync with TavuPay successful records it as paid', sy.j);
  const I = await member('secret44', '123456'); let wi = await request(I); const balI = userOf(I.uid).walletBalance;
  nextReply = () => ({ status: 200, body: { ok: true, reference: 'TVP-III999' } });
  await J('POST', '/admin/withdraw/process', { withdrawalId: wi.id, expectManual: false }, null, true);
  nextReply = () => ({ status: 200, body: { ok: true, status: 'failed' } });
  await J('GET', '/admin/payments/sync', null, null, true); await sleep(200);
  ok(wits().find(x => x.id === wi.id).status === 'declined' && Math.round(userOf(I.uid).walletBalance - balI) === Math.round(wi.amount), 'Sync with TavuPay failed declines and refunds once');
  // a 'sending' row is never touched by Sync
  nextReply = () => ({ status: 200, body: { ok: true, status: 'failed' } });
  await J('GET', '/admin/payments/sync', null, null, true);
  ok(wits().find(x => x.id === wf.id).status === 'sending', 'Sync never settles a sending row');

  // ---- wiring that needs no live call
  const src = fs.readFileSync(path.join(root, 'server.js'), 'utf8'); const admin = fs.readFileSync(path.join(root, 'admin-src/index.html'), 'utf8');
  ok(/where\('status', '==', 'processing'\)\.where\('tavupayTxId', '>', ''\)/.test(src), 'the reconciler re-reads accepted TavuPay payouts');
  ok(/id="witMethodTavu" value="tavupay"/.test(admin) && /TavuPay sends payouts/.test(admin) && /confirmedNotSent:true/.test(admin), 'the admin has the TavuPay payout choice and the owner confirmation');
  ok(/withdrawProvider\(\{depositMethod:'tavupay'\}\)/.test(fs.readFileSync(path.join(root, 'test-tavupay.js'), 'utf8')), 'recharge-follow behaviour is still tested');

  realLog(fails ? fails + ' FAILED' : 'PASS: TavuPay payouts on the real server (' + checks + ' checks)');
  process.exit(fails ? 1 : 0);
})().catch(e => { realErr(e); process.exit(2); });
