'use strict';
// MONEY COMING IN, end to end: a member recharges through PesaJet and through TavuPay on the REAL server.js (in-memory MongoDB stand-in, gateways faked at
// the network edge). Paid -> credited exactly once whichever path gets there first (the server's own watcher, the webhook, the member's poll, the Sync
// button, all firing together); a prompt the member never answers stays pending and is never credited; a payment first reported FAILED and later PAID
// (mobile money does that) is credited by the re-check, once, with the history row going back to Success; the wallet, the history and the server's own
// integrity check agree at the end.
const path = require('path'), Module = require('module'), https = require('node:https'), { EventEmitter } = require('node:events');
const root = __dirname;
const fm = require('./test-helpers/fake-mongodb.js');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...a) { return req === 'mongodb' ? path.join(root, 'test-helpers', 'fake-mongodb.js') : origResolve.call(this, req, ...a); };
const PORT = 3300 + Math.floor(Math.random() * 90);
Object.assign(process.env, { PORT: String(PORT), MONGODB_URI: 'mongodb://fake/potato', ADMIN_KEY: 'dp-admin-key-123456', NODE_ENV: 'development', PESAJET_API_KEY: 'pj-key', TAVUPAY_API_KEY: 'tv-key', TAVUPAY_API_SECRET: 'tv-secret' });
const cap = require('./captcha.js'); const realVerify = cap.verify; cap.verify = (id, code) => code === '0000' ? true : realVerify(id, code);
const realLog = console.log; console.log = () => {}; console.warn = () => {};
const serverErrors = []; console.error = (...a) => { serverErrors.push(a.map(x => (x && x.message) || String(x)).join(' ').slice(0, 200)); };
const gw = { pesajet: {}, tavupay: {}, byRef: {}, collects: { pesajet: [], tavupay: [] } };   // gw[provider][theirId] = their word
const realRequest = https.request, realFetch = global.fetch;
https.request = function (opts, cb) {
  if (!opts || opts.hostname !== 'api.tavupay.lat') return realRequest.apply(this, arguments);
  const req = new EventEmitter(); let body = ''; req.write = c => { body += c; }; req.destroy = e => req.emit('error', e);
  req.end = () => {
    const reply = (code, obj) => { const resp = new EventEmitter(); resp.statusCode = code; setImmediate(() => { cb(resp); resp.emit('data', Buffer.from(JSON.stringify(obj))); resp.emit('end'); }); };
    const p = String(opts.path || ''), method = opts.method || 'GET';
    if (method === 'POST' && /\/payments$/.test(p)) { const b = JSON.parse(body); const ref = 'TVIN-' + String(b.idempotencyKey || Math.random()).slice(-10); gw.tavupay[ref] = 'pending'; gw.byRef[b.idempotencyKey] = ref; gw.collects.tavupay.push(ref); return reply(200, { data: { reference: ref, status: 'pending' } }); }
    const mm = /reference=([^&]+)/.exec(p); if (method === 'GET' && mm) { const ref = decodeURIComponent(mm[1]); const s = gw.tavupay[ref]; return s ? reply(200, { data: { reference: ref, status: s, amount: 30000, fee: 0 } }) : reply(404, { message: 'nf' }); }
    reply(404, { message: 'unexpected ' + method + p });
  };
  return req;
};
global.fetch = async function (url, init) {
  const u = String(url);
  const json = (code, body) => ({ ok: code >= 200 && code < 300, status: code, json: async () => body, text: async () => JSON.stringify(body) });
  if (/payments\.pesajet\.com\/api\/v1\/payments(\?|$)/.test(u) && init && init.method === 'POST') {
    const b = JSON.parse(init.body); const txId = 'PJIN-' + String(b.reference).slice(-10); gw.pesajet[txId] = 'pending'; gw.byRef[b.reference] = txId; gw.collects.pesajet.push(txId);
    return json(200, { data: { transactionId: txId, status: 'PENDING', reference: b.reference } });
  }
  let m;
  if ((m = /payments\.pesajet\.com\/api\/v1\/payments\/([^/?]+)/.exec(u))) { const s = gw.pesajet[m[1]]; return s ? json(200, { data: { transactionId: m[1], status: s.toUpperCase() } }) : json(404, { error: { code: 'NOT_FOUND', message: 'unknown' } }); }
  if (/payments\.pesajet\.com\/api\/v1\/payments\?/.test(u)) return json(200, { data: [] });
  if (/pesajet\.com|wearemarz\.com|tavupay\.lat/.test(u)) return json(404, { message: 'unexpected call to ' + u });
  return realFetch.apply(this, arguments);
};
process.env.POTATO_REGION = 'ug';   // this test drives the Uganda payment gateways (Ethiopia has none: its recharges are manual)
require('./server.js');
const base = 'http://127.0.0.1:' + PORT;
const J = async (m, p, b, tok, adm) => { const r = await realFetch(base + p, { method: m, headers: Object.assign({ 'content-type': 'application/json' }, tok ? { authorization: 'Bearer ' + tok } : {}, adm ? { authorization: 'Bearer dp-admin-key-123456' } : {}), body: b ? JSON.stringify(b) : undefined }); let j = {}; try { j = await r.json(); } catch (_) {} return { s: r.status, j }; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0, n = 0; const ok = (c, m, x) => { n++; if (!c) { fails++; realLog('FAIL', m, x ? JSON.stringify(x).slice(0, 320) : ''); } };
let phoneN = 0;
async function member() { const c = await J('GET', '/auth/captcha'); const phone = '07714' + String(50000 + (++phoneN) * 9); const su = await J('POST', '/auth/signup', { phone, password: 'secret12', captchaId: c.j.id, captchaCode: '0000' }); await J('POST', '/register', { pin: '123456', referralCode: '' }, su.j.token); return { tok: su.j.token, uid: su.j.uid, phone }; }
const user = id => fm.__stores.users.get(id), dep = id => fm.__stores.pendingDeposits.get(id);
const rowOf = did => [...fm.__stores.transactions.values()].find(t => t.depositId === did);
const adminSync = () => J('GET', '/admin/payments/sync', null, null, true);
(async () => {
  for (let i = 0; i < 60; i++) { try { const h = await realFetch(base + '/health'); if (h.ok) break; } catch (_) {} await sleep(250); }
  for (const provider of ['pesajet', 'tavupay']) {
    const name = provider === 'pesajet' ? 'PesaJet' : 'TavuPay';
    const sv = await J('POST', '/admin/settings/update', { settings: { welcomeBonus: 0, depositMethod: provider } }, null, true); ok(sv.s === 200, name + ': settings saved', sv);
    const A = await member(), B = await member(), C = await member();
    const word = { ok: provider === 'pesajet' ? 'completed' : 'successful', bad: 'failed' };
    const idOf = d => (provider === 'pesajet' ? dep(d).pesajetTxId : dep(d).tavupayRef);
    // ---- paid: credited exactly once, even with the watcher, the webhook, the member's poll and Sync all firing at once
    const w0 = user(A.uid).walletBalance;
    const r1 = await J('POST', '/deposit/marzpay', { amount: 30000, phone: A.phone }, A.tok); ok(r1.s === 200 && r1.j.depositId, name + ': the recharge starts', r1);
    const d1 = r1.j.depositId; await sleep(400);
    ok(dep(d1).status === 'pending' && idOf(d1), name + ': pending, with the gateway\'s id saved', dep(d1));
    ok(user(A.uid).walletBalance === w0, name + ': nothing credited before the member pays');
    gw[provider][idOf(d1)] = word.ok;
    const hits = await Promise.all([J('POST', '/deposit/marzpay/status', { depositId: d1 }, A.tok), J('POST', '/deposit/marzpay/status', { depositId: d1 }, A.tok), provider === 'pesajet' ? J('POST', '/pesajet/webhook', { event: 'payment.completed', reference: dep(d1).ref, status: 'completed' }) : J('POST', '/tavupay/webhook', { event: 'payment.success', reference: idOf(d1) }), adminSync()]);
    await sleep(3500);   // the server's own watcher (every 2 s) as well
    ok(dep(d1).status === 'matched' && dep(d1).walletCredited === true && !dep(d1).needsManualCredit, name + ': credited', dep(d1));
    ok(user(A.uid).walletBalance === w0 + 30000 && user(A.uid).totalDeposited === 30000, name + ': the wallet got 30,000 exactly once (poll, webhook, Sync and watcher all raced)', { got: user(A.uid).walletBalance - w0, td: user(A.uid).totalDeposited });
    ok(rowOf(d1).status === 'success' && rowOf(d1).amount === 30000, name + ': the history row reads Success', rowOf(d1));
    // ---- a prompt the member never answers: still pending, never credited
    const r2 = await J('POST', '/deposit/marzpay', { amount: 30000, phone: B.phone }, B.tok); const d2 = r2.j.depositId; await sleep(3500);
    await adminSync(); await J('POST', '/deposit/marzpay/status', { depositId: d2 }, B.tok);
    ok(dep(d2).status === 'pending' && user(B.uid).walletBalance === 0, name + ': an unanswered prompt stays pending and credits nothing', { st: dep(d2).status, w: user(B.uid).walletBalance });
    // ---- first FAILED, later PAID: closed as failed, then credited by the re-check, once
    gw[provider][idOf(d2)] = word.bad; await J('POST', '/deposit/marzpay/status', { depositId: d2 }, B.tok); await sleep(2800);
    ok(dep(d2).status === 'failed' && user(B.uid).walletBalance === 0 && rowOf(d2).status === 'failed', name + ': reported failed: closed as Failed, nothing credited', { st: dep(d2).status });
    gw[provider][idOf(d2)] = word.ok;   // ... and the member DID approve it after all
    const sy = await adminSync(); await sleep(500);
    ok(dep(d2).status === 'matched' && user(B.uid).walletBalance === 30000 && user(B.uid).totalDeposited === 30000, name + ': it was PAID after all: the Sync re-check credits it once', { st: dep(d2).status, w: user(B.uid).walletBalance, sync: sy.j });
    ok(rowOf(d2).status === 'success' && rowOf(d2).amount === 30000, name + ': and the history row is back to Success with the amount', rowOf(d2));
    await adminSync(); await J('POST', '/deposit/marzpay/status', { depositId: d2 }, B.tok); await sleep(300);
    ok(user(B.uid).walletBalance === 30000, name + ': asking again credits nothing more', user(B.uid).walletBalance);
    // ---- failed for real: stays failed however often it is re-checked
    const r3 = await J('POST', '/deposit/marzpay', { amount: 30000, phone: C.phone }, C.tok); const d3 = r3.j.depositId; await sleep(400);
    gw[provider][idOf(d3)] = word.bad; await sleep(2800); await J('POST', '/deposit/marzpay/status', { depositId: d3 }, C.tok);
    await adminSync(); await adminSync(); await sleep(300);
    ok(dep(d3).status === 'failed' && user(C.uid).walletBalance === 0, name + ': a payment that really failed stays failed and credits nothing', { st: dep(d3).status });
    ok(rowOf(d3).status === 'failed' && /Failed/.test(rowOf(d3).description) && rowOf(d3).amount === 0, name + ': its history row stays Failed (not rewritten)', rowOf(d3));
    // a new attempt by the same member goes through at once
    await sleep(7500);
  }
  const ig = await J('GET', '/admin/integrity', null, null, true);
  ok(ig.s === 200 && ig.j.mismatches.length === 0, 'the integrity check finds every wallet and total equal to its history', ig.j.mismatches);
  ok(!(ig.j.alerts || []).some(a => a.kind === 'negative_balance' || a.kind === 'duplicate_credit'), 'no negative balance, no duplicate credit', ig.j.alerts);
  const fatal = serverErrors.filter(e => /ReferenceError|TypeError|is not a function|is not defined|Cannot read/i.test(e)); ok(fatal.length === 0, 'no code errors logged', fatal);
  realLog(fails ? 'FAIL: ' + fails + ' of ' + n : 'test-deposit-e2e: ' + n + ' checks passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { realLog(e); process.exit(1); });
