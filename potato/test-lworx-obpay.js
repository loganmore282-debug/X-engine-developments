'use strict';
// LworxPay (Pay-D) and ObPay (Pay-C) RECHARGES. Real server.js against an in-memory MongoDB and fake gateways (https.request is replaced for their
// hosts): request shapes (auth header, body, reference, callback), acceptance is not payment, the signed LworxPay webhook settles by itself, an
// unsigned one is re-read, ObPay is ALWAYS re-read before crediting (its document says so), a wrong amount is parked for review, refusals and a
// busy gateway are told apart, the member's poll and the reconciler settle, and a replay never pays twice.
const path = require('path'), Module = require('module'), crypto = require('node:crypto'), https = require('node:https'), EventEmitter = require('node:events');
const root = __dirname;
const fm = require('./test-helpers/fake-mongodb.js');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...a) { return req === 'mongodb' ? path.join(root, 'test-helpers', 'fake-mongodb.js') : origResolve.call(this, req, ...a); };
const PORT = 3600 + Math.floor(Math.random() * 90);
Object.assign(process.env, { PORT: String(PORT), MONGODB_URI: 'mongodb://fake/potato', ADMIN_KEY: 'e2e-admin-key-123456', NODE_ENV: 'development',
  LWORXPAY_API_KEY: 'lw_key_123', LWORXPAY_CALLBACK_URL: 'https://hook.example/h-abc/lworxpay', LWORXPAY_READ_GAP_MS: '0',
  OBPAY_SECRET_KEY: 'sk_live_abc', OBPAY_WEBHOOK_SECRET: 'whsec_test', OBPAY_CALLBACK_URL: 'https://hook.example/h-abc/obpay', OBPAY_READ_GAP_MS: '0', GATEWAY_WATCH_MS: '400' });
const LW_SECRET = crypto.createHmac('sha256', 'lw_key_123').update('potato-lworxpay-callback').digest('hex');
const cap = require('./captcha.js'); const realVerify = cap.verify; cap.verify = (id, code) => code === '0000' ? true : realVerify(id, code);

const calls = []; let script = () => null;
const realRequest = https.request;
https.request = function (opts, cb) {
  if (!opts || !['www.lworx-pay.com', 'obpay.online'].includes(opts.hostname)) return realRequest.apply(https, arguments);
  const req = new EventEmitter(); let body = '';
  req.write = c => { body += c; }; req.destroy = () => {};
  req.end = () => {
    const call = { host: opts.hostname, method: opts.method, path: opts.path, headers: opts.headers, body: body ? JSON.parse(body) : null, family: opts.family };
    calls.push(call);
    const r = script(call) || { status: 200, body: { success: true, data: { status: 'pending' } } };
    if (r.error) { setImmediate(() => req.emit('error', new Error(r.error))); return; }
    const resp = new EventEmitter(); resp.statusCode = r.status;
    setImmediate(() => { cb(resp); resp.emit('data', Buffer.from(JSON.stringify(r.body || {}))); resp.emit('end'); });
  };
  return req;
};
const realLog = console.log; console.log = () => {}; console.warn = () => {}; const realErr = console.error; console.error = () => {};
require('./server.js');
const base = 'http://127.0.0.1:' + PORT;
const J = async (m, p, b, tok, adm) => { const r = await fetch(base + p, { method: m, headers: Object.assign({ 'content-type': 'application/json' }, tok ? { authorization: 'Bearer ' + tok } : {}, adm ? { authorization: 'Bearer e2e-admin-key-123456' } : {}), body: b ? JSON.stringify(b) : undefined }); let j = {}; try { j = await r.json(); } catch (_) {} return { s: r.status, j }; };
let fails = 0, n = 0; const ok = (c, m, x) => { n++; if (!c) { fails++; realLog('FAIL', m, x ? JSON.stringify(x).slice(0, 300) : ''); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ph = () => '07' + String(70000000 + Math.floor(Math.random() * 9999999)).padStart(8, '0').slice(-8);
async function member() { const c = await J('GET', '/auth/captcha'); const su = await J('POST', '/auth/signup', { phone: ph(), password: 'secret12', captchaId: c.j.id, captchaCode: '0000' }); await J('POST', '/register', { pin: '123456', referralCode: '' }, su.j.token); return { tok: su.j.token, uid: su.j.uid }; }
const wallet = uid => fm.__stores.users.get(uid).walletBalance;
const depOf = uid => [...fm.__stores.pendingDeposits.entries()].filter(([, d]) => d.userId === uid).map(([id, d]) => ({ id, ...d })).pop();
async function deposit(m, slot, amount = 30000) { const r = await J('POST', '/deposit/marzpay', { amount, slot }, m.tok); await sleep(300); return r; }
const hook = async (route, body, header, secret, sig) => {
  const raw = JSON.stringify(body); const headers = { 'content-type': 'application/json' };
  if (sig === 'bad') headers[header] = '0'.repeat(64); else if (secret) headers[header] = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  const r = await fetch(base + route, { method: 'POST', headers, body: raw }); await sleep(350); return r.status;
};
const LW = 'x-lworxpay-signature', OB = 'x-obpay-signature';
const lwEv = (ev, d, extra) => ({ event: ev, timestamp: '2026-10-02T08:16:12+00:00', data: { transaction_id: d.tx || 'LWSK1', reference: d.id, merchant_reference: d.id, amount: d.amount === undefined ? 30000 : d.amount, status: ev.endsWith('success') ? 'completed' : 'failed', type: 'deposit', phone: '0770000000', provider: 'mtn', ...(extra || {}) } });
const obEv = (ev, d) => ({ event: ev, created_at: '2026-09-26T11:02:41.000Z', data: { reference: d.id, type: 'collection', status: ev.endsWith('success') ? 'success' : 'failed', amount: d.amount === undefined ? 30000 : d.amount, fee: 0, net_amount: 30000, currency: 'UGX' } });
const lwAccept = tx => call => call.method === 'POST' ? { status: 200, body: { success: true, message: 'Approve the prompt', data: { transaction_id: tx, reference: call.body.reference, status: 'pending', amount: call.body.amount, charge_amount: call.body.amount, phone: '0770000000' } } } : null;

(async () => {
  for (let i = 0; i < 60; i++) { try { const h = await fetch(base + '/health'); if (h.ok) break; } catch (_) {} await sleep(250); }
  await J('POST', '/admin/settings/update', { settings: { depositGateways: 'tavupay, pesajet, lworxpay, obpay' } }, null, true);

  // ═════ LworxPay (button 3)
  let m = await member(); script = lwAccept('LWSK1'); const w0 = wallet(m.uid);
  let r = await deposit(m, 2); ok(r.j.status === 'success', 'LworxPay deposit accepted', r.j);
  let d = depOf(m.uid); const c = calls.find(x => x.host === 'www.lworx-pay.com' && x.method === 'POST');
  ok(c && c.path === '/api/v1/collect-stanbic' && c.family === 4, 'POST /api/v1/collect-stanbic over IPv4 (the free collection)', c);
  ok(c.headers.Authorization === 'Bearer lw_key_123', 'Bearer key');
  ok(c.body.amount === 30000 && /^256\d{9}$/.test(c.body.phone) && c.body.reference === d.id && c.body.callback_url === 'https://hook.example/h-abc/lworxpay' && c.body.webhook_secret === LW_SECRET, 'body: amount, 256 phone, reference = deposit id, callback_url and the signing secret', c.body);
  ok(d.provider === 'lworxpay' && d.status === 'pending' && d.lworxpayTxId === 'LWSK1' && d.lworxpayRef === d.id && wallet(m.uid) === w0, 'accepted = pending with their id saved, wallet untouched', d);
  // unsigned success, gateway still says pending -> nothing
  script = call => call.method === 'GET' ? { status: 200, body: { success: true, data: { status: 'pending', amount: 30000 } } } : null;
  await hook('/lworxpay/webhook', lwEv('payment.success', d), LW, null);
  ok(depOf(m.uid).status === 'pending' && wallet(m.uid) === w0, 'an unsigned success with the gateway saying pending credits nothing');
  ok(await hook('/lworxpay/webhook', lwEv('payment.success', d), LW, null, 'bad') === 200 && depOf(m.uid).status === 'pending', 'a wrongly signed call is acknowledged and is only a hint');
  // signed success settles by itself; a replay pays nothing more
  const callsBefore = calls.length;
  await hook('/lworxpay/webhook', lwEv('payment.success', d), LW, LW_SECRET);
  ok(depOf(m.uid).status === 'matched' && wallet(m.uid) === w0 + 30000, 'a signed payment.success credits the wallet once: +' + (wallet(m.uid) - w0), depOf(m.uid));
  ok(calls.length === callsBefore, 'and needed no second call');
  await hook('/lworxpay/webhook', lwEv('payment.success', d), LW, LW_SECRET);
  await hook('/lworxpay/webhook', lwEv('payment.failed', d), LW, LW_SECRET);
  ok(wallet(m.uid) === w0 + 30000 && depOf(m.uid).status === 'matched', 'a replay and a late failure change nothing');
  // wrong amount from a signed call -> review
  m = await member(); script = lwAccept('LWSK2'); await deposit(m, 2); d = depOf(m.uid); const w1 = wallet(m.uid);
  await hook('/lworxpay/webhook', lwEv('payment.success', d, { amount: 500, transaction_id: 'LWSK2' }), LW, LW_SECRET);
  ok(depOf(m.uid).status === 'review' && wallet(m.uid) === w1, 'a different amount is parked for review, not credited', depOf(m.uid));
  // signed failure
  m = await member(); script = lwAccept('LWSK3'); await deposit(m, 2); d = depOf(m.uid);
  await hook('/lworxpay/webhook', lwEv('payment.failed', d, { transaction_id: 'LWSK3' }), LW, LW_SECRET);
  ok(depOf(m.uid).status === 'failed', 'a signed payment.failed marks it failed');
  // payout / bill events are not recharges
  m = await member(); script = lwAccept('LWSK4'); await deposit(m, 2); d = depOf(m.uid); const w2 = wallet(m.uid);
  await hook('/lworxpay/webhook', { ...lwEv('payout.success', d), event: 'payout.success' }, LW, LW_SECRET);
  ok(depOf(m.uid).status === 'pending' && wallet(m.uid) === w2, 'payout.* events are ignored');
  // the server's own watcher reads the gateway every few seconds and settles; the member's poll then just reports it
  script = call => call.method === 'GET' ? { status: 200, body: { success: true, data: { status: 'completed', amount: 30000, fee: 0, type: 'deposit' } } } : null;
  await sleep(1500);
  ok(depOf(m.uid).status === 'matched' && wallet(m.uid) === w2 + 30000, 'the watcher settles a completed payment', depOf(m.uid));
  const poll = await J('POST', '/deposit/marzpay/status', { depositId: d.id }, m.tok);
  ok(poll.j.state === 'matched' && wallet(m.uid) === w2 + 30000, 'the member\'s poll reports it, no second credit', poll.j);
  ok(calls.filter(x => x.method === 'GET').some(x => x.path === '/api/v1/status?reference=' + d.id), 'status is read by our reference');
  // refusals vs a busy gateway
  const refuse = async (reply) => { const mm = await member(); script = call => call.method === 'POST' ? reply : null; await deposit(mm, 2); return depOf(mm.uid); };
  d = await refuse({ status: 400, body: { success: false, error: { code: 'INVALID_PHONE', message: 'Enter a valid 10-digit phone number starting with 07.' } } });
  ok(d.status === 'failed' && /valid MTN or Airtel/.test(d.failureReason), 'INVALID_PHONE fails it with a plain message', d);
  d = await refuse({ status: 403, body: { success: false, error: { code: 'IP_NOT_ALLOWED', message: 'Your server IP is not on your IP whitelist.' } } });
  ok(d.status === 'failed' && !/whitelist|IP/i.test(d.failureReason), 'an owner-side problem is never shown to the member', d);
  d = await refuse({ status: 503, body: { success: false, error: { code: 'GATEWAY_UNAVAILABLE', message: 'Try later' } } });
  ok(d.status === 'failed', '503 GATEWAY_UNAVAILABLE (documented safe to retry) fails it', d);
  d = await refuse({ status: 504, body: { success: false, error: { code: 'GATEWAY_TIMEOUT', message: 'No answer' } } });
  ok(d.status === 'initiating', '504 GATEWAY_TIMEOUT (the prompt may have been sent) leaves it for the reconciler', d);
  d = await refuse({ error: 'socket hang up' });
  ok(d.status === 'initiating', 'a lost reply leaves it too', d);

  // ═════ ObPay (button 4)
  m = await member(); script = call => call.method === 'POST' ? { status: 200, body: { success: true, data: { reference: call.body.reference, status: 'pending', prompt_sent: true, checkout_url: null, amount: call.body.amount, currency: 'UGX', type: 'collection' } } } : null;
  const o0 = wallet(m.uid); r = await deposit(m, 3); ok(r.j.status === 'success', 'ObPay deposit accepted', r.j);
  d = depOf(m.uid); const oc = calls.filter(x => x.host === 'obpay.online' && x.method === 'POST').pop();
  ok(oc.path === '/api/public/v1/collect' && oc.headers.Authorization === 'Bearer sk_live_abc', 'POST /api/public/v1/collect with the secret key', oc);
  ok(oc.body.amount === 30000 && oc.body.currency === 'UGX' && /^256\d{9}$/.test(oc.body.phone_number) && oc.body.reference === d.id && oc.body.reference.length <= 40 && oc.body.customer_name && /@.+\.invalid$/.test(oc.body.customer_email) && oc.body.callback_url === 'https://hook.example/h-abc/obpay', 'body: amount, currency, phone_number, name, email, reference, callback_url', oc.body);
  ok(d.provider === 'obpay' && d.status === 'pending' && d.obpayRef === d.id && wallet(m.uid) === o0, 'accepted = pending, wallet untouched', d);
  // ObPay is ALWAYS re-read: a signed success while the read says pending credits nothing
  script = call => call.method === 'GET' ? { status: 200, body: { success: true, data: { reference: d.id, type: 'collection', status: 'pending', amount: 30000 } } } : null;
  await hook('/obpay/webhook', obEv('collection.success', d), OB, 'whsec_test');
  ok(depOf(m.uid).status === 'pending' && wallet(m.uid) === o0, 'a SIGNED collection.success with the read saying pending credits nothing');
  script = call => call.method === 'GET' ? { status: 404, body: { success: false, error: 'Not found' } } : null;
  await hook('/obpay/webhook', obEv('collection.success', d), OB, 'whsec_test');
  ok(depOf(m.uid).status === 'pending' && wallet(m.uid) === o0, 'and with the read unavailable it credits nothing either');
  script = call => call.method === 'GET' ? { status: 200, body: { success: true, data: { reference: d.id, status: 'success', amount: 30000, fee_amount: 0 } } } : null;
  await hook('/obpay/webhook', obEv('collection.success', d), OB, 'whsec_test');
  ok(depOf(m.uid).status === 'matched' && wallet(m.uid) === o0 + 30000, 'once the read says success the wallet is credited once', depOf(m.uid));
  ok(calls.filter(x => x.method === 'GET').pop().path === '/api/public/v1/transactions/' + d.id, 'read by GET /transactions/<our reference>');
  await hook('/obpay/webhook', obEv('collection.success', d), OB, 'whsec_test');
  ok(wallet(m.uid) === o0 + 30000, 'a replay pays nothing more');
  // an UNSIGNED call is just as good a trigger, because the read decides
  m = await member(); script = call => call.method === 'POST' ? { status: 200, body: { success: true, data: { reference: call.body.reference, status: 'pending', prompt_sent: true } } } : null; await deposit(m, 3); d = depOf(m.uid);
  script = call => call.method === 'GET' ? { status: 200, body: { success: true, data: { status: 'failed', amount: 30000 } } } : null;
  ok(await hook('/obpay/webhook', obEv('collection.failed', d), OB, null) === 200, 'an unsigned call is acknowledged');
  ok(depOf(m.uid).status === 'failed', 'and the read saying failed marks it failed');
  // amount mismatch on the read
  m = await member(); script = call => call.method === 'POST' ? { status: 200, body: { success: true, data: { reference: call.body.reference, status: 'pending', prompt_sent: true } } } : null; await deposit(m, 3); d = depOf(m.uid); const o2 = wallet(m.uid);
  script = call => call.method === 'GET' ? { status: 200, body: { success: true, data: { status: 'success', amount: 1000 } } } : null;
  await hook('/obpay/webhook', obEv('collection.success', d), OB, 'whsec_test');
  ok(depOf(m.uid).status === 'review' && wallet(m.uid) === o2, 'a read with a different amount is parked for review');
  // prompt_sent:false -> failed at once
  m = await member(); script = call => call.method === 'POST' ? { status: 200, body: { success: true, data: { reference: call.body.reference, status: 'pending', prompt_sent: false, checkout_url: 'https://obpay.online/pay/x' } } } : null; await deposit(m, 3);
  ok(depOf(m.uid).status === 'failed' && /could not send the payment prompt/i.test(depOf(m.uid).failureReason), 'prompt_sent:false is failed with a plain message', depOf(m.uid));
  // HTTP 200 + success:false is a refusal
  m = await member(); script = call => call.method === 'POST' ? { status: 200, body: { success: false, error: 'Reference already used' } } : null; await deposit(m, 3);
  ok(depOf(m.uid).status === 'failed' && /Reference already used/.test(depOf(m.uid).failureReason), 'HTTP 200 with success:false is a refusal, its words shown', depOf(m.uid));
  m = await member(); script = call => call.method === 'POST' ? { status: 401, body: { success: false, error: 'Invalid secret key' } } : null; await deposit(m, 3);
  ok(depOf(m.uid).status === 'failed' && !/secret|key/i.test(depOf(m.uid).failureReason), '401 is the owner\'s problem, not shown to a member', depOf(m.uid));
  // the watcher settles a successful payment; the member's poll reports it
  m = await member(); script = call => call.method === 'POST' ? { status: 200, body: { success: true, data: { reference: call.body.reference, status: 'pending', prompt_sent: true } } } : null; await deposit(m, 3); d = depOf(m.uid); const o3 = wallet(m.uid);
  script = call => call.method === 'GET' ? { status: 200, body: { success: true, data: { status: 'success', amount: 30000 } } } : null;
  await sleep(1500);
  const poll2 = await J('POST', '/deposit/marzpay/status', { depositId: d.id }, m.tok);
  ok(depOf(m.uid).status === 'matched' && poll2.j.state === 'matched' && wallet(m.uid) === o3 + 30000, 'the watcher settles it and the poll reports it', poll2.j);
  // the admin Sync (reconciler) settles one the webhook never reached
  m = await member(); script = call => call.method === 'POST' ? { status: 200, body: { success: true, data: { reference: call.body.reference, status: 'pending', prompt_sent: true } } } : null; await deposit(m, 3); d = depOf(m.uid); const o4 = wallet(m.uid);
  script = call => call.method === 'GET' ? { status: 404, body: { success: false, error: 'Not found' } } : null;
  await sleep(1000);   // the watcher gets "cannot answer" and ends its watch
  ok(depOf(m.uid).status === 'pending', 'a gateway that cannot answer leaves the row pending');
  script = call => call.method === 'GET' ? { status: 200, body: { success: true, data: { status: 'success', amount: 30000 } } } : null;
  await J('GET', '/admin/payments/sync', null, null, true); await sleep(300);
  ok(depOf(m.uid).status === 'matched' && wallet(m.uid) === o4 + 30000, 'Sync (the reconciler) settles it', depOf(m.uid));
  // never credited twice across watcher + poll + sync + webhook
  await J('GET', '/admin/payments/sync', null, null, true); await J('POST', '/deposit/marzpay/status', { depositId: d.id }, m.tok);
  ok(wallet(m.uid) === o4 + 30000, 'and never twice');

  const src = require('fs').readFileSync(path.join(root, 'server.js'), 'utf8'), ng = require('child_process').execFileSync('node', ['deploy/make-nginx.js', 'prod', 'a.example.com', 'Tq5m8zr'], { encoding: 'utf8', cwd: root, env: { ...process.env, POTATO_HOOK_TOKEN: '0123456789abcdef0123456789abcdef' } });
  ok(/RAW_BODY_ROUTES = new Set\([^)]*'\/lworxpay\/webhook', '\/obpay\/webhook'/.test(src) && /GUARD_EXEMPT = new Set\([^)]*'\/lworxpay\/webhook', '\/obpay\/webhook'/.test(src), 'raw body and maintenance exemptions for both webhooks');
  ok(/location = \/k7x2\/h-0123456789abcdef0123456789abcdef\/lworxpay \{[\s\S]*?rewrite \^ \/lworxpay\/webhook break;/.test(ng) && /location = \/k7x2\/h-0123456789abcdef0123456789abcdef\/obpay \{[\s\S]*?rewrite \^ \/obpay\/webhook break;/.test(ng), 'secret nginx addresses reach both webhooks');
  ok(/location = \/k7x2\/lworxpay\/webhook \{ return 404; \}/.test(ng) && /location = \/k7x2\/obpay\/webhook \{ return 404; \}/.test(ng), 'the plain addresses are closed');
  realLog(fails ? fails + ' FAILED' : 'PASS: LworxPay and ObPay recharges (' + n + ' checks)');
  process.exit(fails ? 1 : 0);
})().catch(e => { realErr(e); process.exit(2); });
