'use strict';
// TavuPay recharges. The REAL source block runs against fakes: request shape (headers, payload, IPv4), status words, amount agreement, the
// signed webhook (both documented shapes), the settle rules (credit once, mismatch parked, failure marked, an unverifiable call credits nothing),
// provider plumbing (payouts never follow a TavuPay recharge) and the secret nginx address.
const fs = require('node:fs'), vm = require('node:vm'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const cp = require('node:child_process');
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); }; const eq = (a, b, m) => { n++; assert.deepEqual(JSON.parse(JSON.stringify(a === undefined ? null : a)), JSON.parse(JSON.stringify(b)), m); };
const src = fs.readFileSync(__dirname + '/server.js', 'utf8');
const a = src.indexOf('// TAVUPAY (recharges, and payouts when the owner picks them)'), b = src.indexOf('// ── DAILY CASHBACK AT 00:00');
ok(a > 0 && b > a, 'the TavuPay block exists');
const block = src.slice(a, b);

function harness(env, rows = {}) {
  const calls = [], credited = [], failed = [], http = [];
  const store = new Map(Object.entries(rows));
  const ref = id => ({ get: async () => ({ id, exists: store.has(id), data: () => JSON.parse(JSON.stringify(store.get(id))) }),
    update: async p => { store.set(id, { ...store.get(id), ...p }); } });
  const snap = id => ({ id, ref: ref(id), data: () => JSON.parse(JSON.stringify(store.get(id))) });
  const db = { collection: () => ({
    doc: id => ref(id),
    where: (f, op, v) => ({ limit: () => ({ get: async () => { const docs = [...store.entries()].filter(([, r]) => r[f] === v).map(([id]) => snap(id)); return { empty: !docs.length, docs }; } }) }) }) };
  const ctx = { crypto, Buffer, URL, console: { error() {}, log() {} }, setTimeout, process: { env }, require,
    pesajetPhone: raw => { let s = String(raw || '').replace(/[\s-]/g, ''); if (s.startsWith('0')) return '+256' + s.slice(1); if (s.startsWith('256')) return '+' + s; return s.startsWith('+') ? s : '+' + s; },
    PROVIDER_BUSY_MSG: 'busy', DEPOSIT_FAILED_MSG: 'not completed', db,
    withLock: async (k, f) => f(), creditDeposit: async (d, s) => { credited.push([d.id, s]); store.set(d.id, { ...store.get(d.id), status: 'matched' }); return true; },
    markDepositFailed: async (r, u, m) => { failed.push([m]); return true; },
    retryCallbackWork() {} };
  vm.createContext(ctx);
  vm.runInContext(block + '\n;this.__x = { tavupayCollect, tavupayGetTx, tavupayStatusLabel, tavupayAmountOk, tavupayApply, tavupayVerifyWebhook, tavupayWebhookFields, tavupayWebhookWork, tavupayUserMsg, tavupayConfigured, _tavupayRequest, tavupayHookUrl, setHttp: f => { _tavupayHttp = f; } };', ctx);
  const X = ctx.__x;
  X.setHttp(async (method, url, headers, body, timeout) => { http.push({ method, url, headers, body: body ? JSON.parse(body) : null }); return ctx.__reply || { status: 200, text: '{}' }; });
  return { X, ctx, store, credited, failed, http, snap };
}
const ENV = { TAVUPAY_API_KEY: 'ep_live_key', TAVUPAY_API_SECRET: 'the-secret' };

(async () => {
  // ── request shape
  let h = harness(ENV);
  h.ctx.__reply = { status: 200, text: JSON.stringify({ ok: true, message: 'Request sent.', reference: 'C0123456789ABCDEF' }) };
  let r = await h.X.tavupayCollect({ amount: 30000.4, phone: '0770000000', description: 'Deposit AB12', idempotencyKey: '65f1a2b3c4d5e6f7a8b9c0d1' });
  ok(r.ok && r.data.reference === 'C0123456789ABCDEF', 'an accepted request returns the reference');
  eq(h.http[0].url, 'https://api.tavupay.lat/v1/payments'); eq(h.http[0].method, 'POST');
  eq(h.http[0].headers['X-API-Key'], 'ep_live_key'); eq(h.http[0].headers['X-API-Secret'], 'the-secret'); ok(!('Authorization' in h.http[0].headers), 'two headers, never a Bearer token');
  eq(h.http[0].body, { type: 'collection', phone: '+256770000000', amount: 30000, idempotencyKey: '65f1a2b3c4d5e6f7a8b9c0d1', description: 'Deposit AB12' });
  r = await h.X.tavupayCollect({ amount: 500, phone: '256770000000', idempotencyKey: 'short', callback: 'http://x.example/cb' });
  ok(!('idempotencyKey' in h.http[1].body) && !('callback' in h.http[1].body), 'a key outside 8-64 characters and a non-https callback are left out');
  r = await h.X.tavupayCollect({ amount: 500, phone: '256770000000', callback: 'https://hook.example/h-abc/tavupay' });
  eq(h.http[2].body.callback, 'https://hook.example/h-abc/tavupay', 'an https callback is sent');
  ok(/family: 4/.test(block), 'calls are forced onto IPv4 (the TavuPay whitelist holds the VPS IPv4)');
  // not configured / refused / busy
  const none = harness({}); r = await none.X.tavupayCollect({ amount: 500, phone: '0770000000' });
  ok(!r.ok && r.notConfigured && none.http.length === 0, 'with no key set nothing is sent');
  h.ctx.__reply = { status: 403, text: JSON.stringify({ ok: false, error: 'IP address 1.2.3.4 is not whitelisted. Add it in IP Whitelist on your dashboard.' }) };
  r = await h.X.tavupayCollect({ amount: 500, phone: '0770000000' }); ok(!r.ok && !r.providerDown && r.httpStatus === 403, 'a 403 is a refusal, not an outage');
  eq(h.X.tavupayUserMsg(r), 'busy', 'a whitelist/credential problem is never shown to a member');
  h.ctx.__reply = { status: 503, text: '{}' }; r = await h.X.tavupayCollect({ amount: 500, phone: '0770000000' }); ok(r.providerDown, '5xx = gateway busy');
  h.ctx.__reply = { status: 200, text: JSON.stringify({ ok: false, message: 'Minimum is 500' }) }; r = await h.X.tavupayCollect({ amount: 100, phone: '0770000000' });
  ok(!r.ok && !r.providerDown, 'ok:false in a 200 is a refusal'); eq(h.X.tavupayUserMsg(r), 'Minimum is 500', 'a plain refusal reason is shown');

  // ── status words and amounts
  const L = h.X.tavupayStatusLabel;
  eq([L({ status: 'successful', success: true }), L({ status: 'SUCCEEDED' }), L({ transactionStatus: 'SUCCEEDED' }), L({ success: true })], ['success', 'success', 'success', 'success']);
  eq([L({ status: 'failed' }), L({ status: 'FAILED' }), L({ status: 'expired' })], ['failed', 'failed', 'failed']);
  eq([L({ status: 'pending' }), L({ status: 'INDETERMINATE' }), L({})], ['processing', 'processing', '']);
  ok(L({ status: 'failed', success: true }) === 'failed', 'a failed word beats success:true');
  const A = h.X.tavupayAmountOk;
  ok(A({ amount: 30000 }, 30000, 0) && A({ amount: 30000 }, 30450, 450) && A({ amount: 30000 }, NaN, 0) && A({ amount: 30000 }, undefined, 0), 'equal, equal after the fee, or not reported');
  ok(!A({ amount: 30000 }, 500, 0) && !A({ amount: 30000 }, 30001, 0), 'a different figure is not accepted');

  // ── re-reading a payment
  h = harness(ENV);
  h.ctx.__reply = { status: 200, text: JSON.stringify({ ok: true, reference: 'C1', type: 'deposit', status: 'successful', success: true, amount: 515, fee: 15, currency: 'UGX' }) };
  let t = await h.X.tavupayGetTx('C1'); eq([t.status, t.amount, t.fee], ['success', 515, 15]); ok(/payments\?reference=C1$/.test(h.http[0].url), 'GET /payments?reference=');
  h.ctx.__reply = { status: 404, text: '{}' }; t = await h.X.tavupayGetTx('C1'); ok(t.unavailable && !t.providerDown && t.status === '', 'a refusal of the status call is "cannot re-check", never a verdict');
  h.ctx.__reply = { status: 500, text: '{}' }; t = await h.X.tavupayGetTx('C1', { attempts: 1 }); ok(t.providerDown, 'a 500 = busy');

  // ── settling
  const dep = () => ({ d1: { userId: 'u1', amount: 30000, provider: 'tavupay', status: 'pending', ref: 'R1', tavupayRef: 'C1' } });
  h = harness(ENV, dep());
  eq(await h.X.tavupayApply(h.snap('d1'), { status: 'success', amount: 30000, fee: 0 }, 'x'), 'success'); eq(h.credited.length, 1, 'credited once');
  h = harness(ENV, dep());
  eq(await h.X.tavupayApply(h.snap('d1'), { status: 'success', amount: 500, fee: 0 }, 'x'), 'review'); eq(h.credited.length, 0, 'a wrong amount credits nothing');
  eq(h.store.get('d1').status, 'review'); ok(/Force-credit/.test(h.store.get('d1').reviewReason), 'parked for a person');
  h = harness(ENV, dep());
  eq(await h.X.tavupayApply(h.snap('d1'), { status: 'failed' }, 'x'), 'failed'); eq(h.failed.length, 1);
  eq(await h.X.tavupayApply(h.snap('d1'), { status: 'processing' }, 'x'), 'pending'); eq(h.credited.length + h.failed.length, 1, 'pending does nothing');

  // ── the signed webhook
  const body = { event: 'collection.success', data: { transactionReference: 'C1', transactionStatus: 'SUCCEEDED', amount: '30000', msisdn: '256770000000', transactionEntryGeneralType: 'CREDIT' } };
  const raw = Buffer.from(JSON.stringify(body));
  const sig = crypto.createHmac('sha256', 'the-secret').update(raw).digest('hex');
  h = harness(ENV, dep());
  eq(h.X.tavupayVerifyWebhook(sig, raw), { verified: true, reason: 'ok' }); eq(h.X.tavupayVerifyWebhook('0'.repeat(64), raw).reason, 'mismatch');
  eq(h.X.tavupayVerifyWebhook('', raw).reason, 'no-signature'); eq(harness({}).X.tavupayVerifyWebhook(sig, raw).reason, 'no-secret');
  eq(h.X.tavupayVerifyWebhook('sha256=' + sig.toUpperCase(), raw).verified, true, 'a sha256= prefix and capitals are tolerated');
  let wf = h.X.tavupayWebhookFields(body); eq([wf.label, wf.isPayout, wf.candidates[0], wf.amount], ['success', false, 'C1', 30000], 'nested shape');
  wf = h.X.tavupayWebhookFields({ event: 'collection.failed', reference: 'C9', type: 'deposit', amount: 500, phone: '+256770000000', status: 'failed' }); eq([wf.label, wf.candidates[0]], ['failed', 'C9'], 'flat shape');
  ok(h.X.tavupayWebhookFields({ event: 'transfer.success', data: { transactionReference: 'T1' } }).isPayout, 'payout events are ignored');
  // signed -> credited without any re-read
  await h.X.tavupayWebhookWork(body, true); eq(h.credited, [['d1', 'TavuPay webhook']]); eq(h.http.length, 0, 'a signed webhook needs no second call');
  // unsigned -> only a hint: re-read decides
  h = harness(ENV, dep()); h.ctx.__reply = { status: 200, text: JSON.stringify({ ok: true, status: 'pending' }) };
  await h.X.tavupayWebhookWork(body, false); eq(h.credited.length, 0, 'an unsigned "success" with the gateway saying pending credits nothing'); eq(h.http.length, 1, 'it re-reads');
  h.ctx.__reply = { status: 200, text: JSON.stringify({ ok: true, status: 'successful', success: true, amount: 30000 }) };
  await h.X.tavupayWebhookWork(body, false); eq(h.credited.length, 1, 'an unsigned call credits once the re-read says paid');
  h = harness(ENV, dep()); h.ctx.__reply = { status: 404, text: '{}' };
  await h.X.tavupayWebhookWork(body, false); eq(h.credited.length, 0, 'unsigned and the re-read unavailable: nothing is credited');
  // found by our own reference or the deposit id; a PesaJet/MarzPay row is never touched
  h = harness(ENV, { d1: { userId: 'u1', amount: 30000, provider: 'tavupay', status: 'pending', ref: 'R1', tavupayRef: null } });
  await h.X.tavupayWebhookWork({ event: 'collection.success', reference: 'R1', status: 'successful' }, true); eq(h.credited.length, 1, 'matched by our ref');
  h = harness(ENV, { d1: { userId: 'u1', amount: 30000, provider: 'marzpay', status: 'pending', ref: 'R1', tavupayRef: 'C1' } });
  await h.X.tavupayWebhookWork(body, true); eq(h.credited.length, 0, 'another gateway\'s row is ignored');
  h = harness(ENV, { d1: { userId: 'u1', amount: 30000, provider: 'tavupay', status: 'matched', ref: 'R1', tavupayRef: 'C1' } });
  await h.X.tavupayWebhookWork(body, true); eq(h.credited.length, 0, 'an already-settled row is left alone');

  // ── plumbing
  const pv = new vm.Script('1'); void pv;
  const grab = name => { const i = src.indexOf('function ' + name + '('); const j = src.indexOf('\n}\n', i); return src.slice(i, j + 2); };
  const pc = vm.createContext({ gatewayServesRegion: () => true, console });
  vm.runInContext(grab('normalizeProviderValue') + grab('depositProvider') + grab('depositAutomaticProvider') + grab('withdrawProvider') + grab('payoutIsManual'), pc);
  const run = e => vm.runInContext(e, pc);
  eq(run("depositAutomaticProvider({depositMethod:'tavupay'})"), 'tavupay'); eq(run("depositAutomaticProvider({depositMethod:'pesajet'})"), 'pesajet'); eq(run("depositAutomaticProvider({depositMethod:'zzz'})"), 'marzpay');
  eq(run("withdrawProvider({depositMethod:'tavupay',withdrawMethod:'follow'})"), 'marzpay', 'payouts never follow a TavuPay recharge');
  eq(run("withdrawProvider({depositMethod:'tavupay'})"), 'marzpay'); eq(run("withdrawProvider({depositMethod:'marzpay',withdrawMethod:'tavupay'})"), 'tavupay', 'pinned TavuPay payouts are used'); eq(run("withdrawProvider({depositMethod:'pesajet',withdrawMethod:'tavupay'})"), 'tavupay'); eq(run("withdrawProvider({depositMethod:'tavupay',withdrawMethod:'manual'})"), 'manual');
  eq(run("withdrawProvider({depositMethod:'pesajet',withdrawMethod:'follow'})"), 'pesajet', 'PesaJet behaviour unchanged');

  // ── wiring in the server, admin and nginx
  ok(/app\.post\('\/tavupay\/webhook'/.test(src) && /RAW_BODY_ROUTES = new Set\(\['\/pesajet\/webhook', '\/tavupay\/webhook'/.test(src) && /GUARD_EXEMPT = new Set\([^)]*'\/tavupay\/webhook'/.test(src) && /req\.path === '\/tavupay\/webhook'\) return next\(\)/.test(src), 'route, raw body, maintenance and settings-read exemptions');
  ok(/if \(provider === 'tavupay'\) \{/.test(src) && /dep\.provider === 'tavupay'/.test(src) && /where\('provider', '==', 'tavupay'\)/.test(src), 'deposit branch, status poll and reconciler');
  ok(/\['marzpay', 'pesajet', 'tavupay'\]\.includes\(updates\.depositMethod\)/.test(src), 'the admin may choose TavuPay');
  const admin = fs.readFileSync(__dirname + '/admin-src/index.html', 'utf8');
  ok(/id="depGatewayTavu" value="tavupay"/.test(admin) && /tavupay:'TavuPay'/.test(admin), 'the admin has a TavuPay choice');
  const ng = cp.execFileSync('node', ['deploy/make-nginx.js', 'prod', 'a.example.com', 'Pw3k9zt6'], { encoding: 'utf8', cwd: __dirname, env: { ...process.env, CHOCOLATE_HOOK_TOKEN: '0123456789abcdef0123456789abcdef' } });
  ok(/location = \/k7x2\/h-0123456789abcdef0123456789abcdef\/tavupay \{[\s\S]*?rewrite \^ \/tavupay\/webhook break;/.test(ng), 'secret TavuPay address reaches /tavupay/webhook');
  ok(/location = \/k7x2\/tavupay\/webhook \{ return 404; \}/.test(ng), 'the plain TavuPay address is closed');
  ok(/rewrite \^ \/pesajet\/webhook break;/.test(ng), 'PesaJet address unchanged');
  console.log('PASS: TavuPay recharges (' + n + ' checks)');
})().catch(e => { console.error(e); process.exit(1); });
