'use strict';
// MONEY GOING OUT through PesaJet, TavuPay and ObPay in turn, end to end: the REAL server.js against the in-memory MongoDB stand-in, with the three
// gateways faked at the network edge. Covers: an even round robin; a gateway that CLEANLY refuses hands the withdrawal to the next one in the same
// click; a LOST reply is never handed on (only one gateway is ever asked, the row stays on Sending); every gateway refusing leaves the request pending
// and untouched; completed payouts settle once (totalWithdrawn once, history Success); a payout that fails afterwards is refunded exactly once; three
// simultaneous Send clicks reach the gateway once; and the server's own integrity check agrees with every wallet afterwards.
const path = require('path'), Module = require('module'), https = require('node:https'), { EventEmitter } = require('node:events');
const root = __dirname;
const fm = require('./test-helpers/fake-mongodb.js');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...a) { return req === 'mongodb' ? path.join(root, 'test-helpers', 'fake-mongodb.js') : origResolve.call(this, req, ...a); };
const PORT = 3400 + Math.floor(Math.random() * 90);
Object.assign(process.env, { PORT: String(PORT), MONGODB_URI: 'mongodb://fake/potato', ADMIN_KEY: 'po-admin-key-123456', NODE_ENV: 'development', PESAJET_API_KEY: 'pj-key', TAVUPAY_API_KEY: 'tv-key', TAVUPAY_API_SECRET: 'tv-secret', OBPAY_SECRET_KEY: 'ob-key' });
const cap = require('./captcha.js'); const realVerify = cap.verify; cap.verify = (id, code) => code === '0000' ? true : realVerify(id, code);
const realLog = console.log; console.log = () => {}; console.warn = () => {};
const serverErrors = []; console.error = (...a) => { serverErrors.push(a.map(x => (x && x.message) || String(x)).join(' ').slice(0, 200)); };
// ---- the gateways' side of the world. mode[gateway][withdrawalId] = 'accept' (default) | 'refuse' | 'lost'; status[gateway][theirId] = their word ----
const gw = { mode: { pesajet: {}, tavupay: {}, obpay: {} }, status: { pesajet: {}, tavupay: {}, obpay: {} }, posts: { pesajet: [], tavupay: [], obpay: [] }, listed: [] };
const modeOf = (g, id) => gw.mode[g][id] || 'accept';
const realRequest = https.request, realFetch = global.fetch;
https.request = function (opts, cb) {
  const host = opts && opts.hostname;
  if (host !== 'api.tavupay.lat' && host !== 'obpay.online') return realRequest.apply(this, arguments);
  const req = new EventEmitter(); let body = ''; req.write = c => { body += c; }; req.destroy = e => req.emit('error', e);
  req.end = () => {
    const reply = (code, obj) => { const resp = new EventEmitter(); resp.statusCode = code; setImmediate(() => { cb(resp); resp.emit('data', Buffer.from(JSON.stringify(obj))); resp.emit('end'); }); };
    const p = String(opts.path || ''), method = opts.method || 'GET';
    if (host === 'api.tavupay.lat') {
      if (method === 'POST' && /\/payments$/.test(p)) {
        const b = JSON.parse(body); const id = b.idempotencyKey; gw.posts.tavupay.push(id); const m = modeOf('tavupay', id);
        if (m === 'lost') return setImmediate(() => req.emit('error', new Error('socket hang up')));
        if (m === 'refuse') return reply(400, { message: 'Insufficient balance in the TavuPay wallet' });
        const ref = 'TVOUT-' + id.slice(-8); gw.status.tavupay[ref] = 'pending'; return reply(200, { data: { reference: ref, status: 'pending' } });
      }
      const mm = /reference=([^&]+)/.exec(p); if (method === 'GET' && mm) { const ref = decodeURIComponent(mm[1]); const s = gw.status.tavupay[ref]; return s ? reply(200, { data: { reference: ref, status: s, amount: 17000 } }) : reply(404, { message: 'not found' }); }
    } else {
      if (method === 'POST' && /\/payouts$/.test(p)) {
        const b = JSON.parse(body); const id = b.reference; gw.posts.obpay.push(id); const m = modeOf('obpay', id);
        if (m === 'lost') return setImmediate(() => req.emit('error', new Error('socket hang up')));
        if (m === 'refuse') return reply(400, { success: false, error: 'Insufficient wallet balance' });
        gw.status.obpay[id] = 'pending'; return reply(200, { success: true, data: { reference: id, status: 'pending' } });
      }
      const mm = /\/transactions\/([^/?]+)/.exec(p); if (method === 'GET' && mm) { const s = gw.status.obpay[mm[1]]; return s ? reply(200, { success: true, data: { reference: mm[1], status: s, amount: 17000 } }) : reply(404, { success: false, error: 'not found' }); }
    }
    reply(404, { message: 'unexpected ' + method + ' ' + host + p });
  };
  return req;
};
global.fetch = async function (url, init) {
  const u = String(url);
  const json = (code, body) => ({ ok: code >= 200 && code < 300, status: code, json: async () => body, text: async () => JSON.stringify(body) });
  if (/payments\.pesajet\.com\/api\/v1\/payments(\?|$)/.test(u) && init && init.method === 'POST') {
    const b = JSON.parse(init.body); gw.posts.pesajet.push(b.reference); const m = modeOf('pesajet', b.reference);
    if (m === 'lost') throw new Error('socket hang up');
    if (m === 'refuse') return json(400, { error: { code: 'INSUFFICIENT_BALANCE', message: 'The PesaJet wallet has too little balance' } });
    const txId = 'PJOUT-' + b.reference.slice(-8); gw.status.pesajet[txId] = 'pending'; gw.listed.push({ reference: b.reference, transactionId: txId });
    return json(200, { data: { transactionId: txId, status: 'PENDING', reference: b.reference } });
  }
  let m;
  if ((m = /payments\.pesajet\.com\/api\/v1\/payments\/([^/?]+)/.exec(u))) { const s = gw.status.pesajet[m[1]]; return s ? json(200, { data: { transactionId: m[1], status: s.toUpperCase() } }) : json(404, { error: { code: 'NOT_FOUND', message: 'unknown' } }); }
  if (/payments\.pesajet\.com\/api\/v1\/payments\?/.test(u)) return json(200, { data: /page=1\b/.test(u) ? gw.listed.map(r => Object.assign({}, r, { status: (gw.status.pesajet[r.transactionId] || 'pending').toUpperCase() })) : [] });
  if (/pesajet\.com|wearemarz\.com|tavupay\.lat|obpay\.online|lworx-pay\.com/.test(u)) return json(404, { message: 'unexpected call to ' + u });
  return realFetch.apply(this, arguments);
};
require('./server.js');
const base = 'http://127.0.0.1:' + PORT;
const J = async (m, p, b, tok, adm) => { const r = await realFetch(base + p, { method: m, headers: Object.assign({ 'content-type': 'application/json' }, tok ? { authorization: 'Bearer ' + tok } : {}, adm ? { authorization: 'Bearer po-admin-key-123456' } : {}), body: b ? JSON.stringify(b) : undefined }); let j = {}; try { j = await r.json(); } catch (_) {} return { s: r.status, j }; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0, n = 0; const ok = (c, m, x) => { n++; if (!c) { fails++; realLog('FAIL', m, x ? JSON.stringify(x).slice(0, 320) : ''); } };
let phoneN = 0;
async function member() {
  const c = await J('GET', '/auth/captcha'); const phone = '07712' + String(30000 + (++phoneN) * 7);
  const su = await J('POST', '/auth/signup', { phone, password: 'secret12', captchaId: c.j.id, captchaCode: '0000' });
  await J('POST', '/register', { pin: '123456', referralCode: '' }, su.j.token);
  const prods = (await J('GET', '/public/products')).j.products.filter(p => p.price > 0).sort((a, b) => a.price - b.price);
  await J('POST', '/invest/create', { tierKey: prods[0].key }, su.j.token);
  const bank = '07713' + String(40000 + phoneN * 11); await J('POST', '/bank/save', { holder: 'Pay Test', network: 'MTN Mobile Money', phone: bank }, su.j.token);
  return { tok: su.j.token, uid: su.j.uid, bank };
}
const user = id => fm.__stores.users.get(id), wit = id => fm.__stores.withdrawals.get(id);
const request = (m, amount) => J('POST', '/withdraw/request', { amount, network: 'MTN Mobile Money', phone: m.bank, pin: '123456' }, m.tok);
const send = wid => J('POST', '/admin/withdraw/process', { withdrawalId: wid }, null, true);
const sync = () => J('GET', '/admin/payments/sync', null, null, true);
const txOf = wid => [...fm.__stores.transactions.values()].find(t => t.withdrawalId === wid);
const totalPosts = () => gw.posts.pesajet.length + gw.posts.tavupay.length + gw.posts.obpay.length;
const postsFor = wid => ['pesajet', 'tavupay', 'obpay'].filter(g => gw.posts[g].includes(wid));
const usedGateway = w => w.payGw || (w.pesajetTxId ? 'pesajet' : '');
(async () => {
  for (let i = 0; i < 60; i++) { try { const h = await realFetch(base + '/health'); if (h.ok) break; } catch (_) {} await sleep(250); }
  const sv = await J('POST', '/admin/settings/update', { settings: { welcomeBonus: 400000, withdrawMethod: 'rotate', requireTwofaToWithdraw: false } }, null, true); ok(sv.s === 200, 'settings saved: all gateways in turn', sv);
  const M = []; for (let i = 0; i < 8; i++) M.push(await member());
  // ---- 1. an even round robin: three withdrawals, three gateways, one each
  const w1 = []; for (let i = 0; i < 3; i++) { const r = await request(M[i], 20000); ok(r.s === 200, 'withdrawal ' + (i + 1) + ' requested', r); w1.push(r.j.withdrawalId); }
  for (const w of w1) { const r = await send(w); ok(r.s === 200, 'sent', r); }
  const used = w1.map(w => usedGateway(wit(w))).sort();
  ok(used.join() === 'obpay,pesajet,tavupay', 'three withdrawals went to three DIFFERENT gateways (an even turn)', used);
  ok(w1.every(w => wit(w).status === 'processing') && totalPosts() === 3, 'each gateway was asked exactly once and every row is Processing', { posts: totalPosts(), st: w1.map(w => wit(w).status) });
  ok(w1.every((w, i) => user(M[i].uid).totalWithdrawn === wit(w).net), 'totalWithdrawn counted once each', w1.map((w, i) => user(M[i].uid).totalWithdrawn));
  // each gateway completes its payout; the server reads them and settles
  for (const g of ['pesajet', 'tavupay', 'obpay']) for (const k of Object.keys(gw.status[g])) gw.status[g][k] = g === 'obpay' ? 'success' : (g === 'tavupay' ? 'successful' : 'completed');
  await sync(); await sleep(700);
  ok(w1.every(w => wit(w).status === 'processed' && txOf(w).status === 'success'), 'all three settle as Processed with the history row Success', w1.map(w => [wit(w).status, txOf(w).status]));
  ok(w1.every((w, i) => user(M[i].uid).totalWithdrawn === wit(w).net), 'and nothing is counted twice', w1.map((w, i) => user(M[i].uid).totalWithdrawn));
  const before = totalPosts(); await sync(); await sleep(300); ok(totalPosts() === before, 'a settled payout is never sent again');
  // ---- 2. failover: two gateways refuse CLEANLY, the third takes it, all in ONE click
  const r2 = await request(M[3], 20000); const w2 = r2.j.withdrawalId; gw.mode.pesajet[w2] = 'refuse'; gw.mode.tavupay[w2] = 'refuse';
  const s2 = await send(w2);
  ok(s2.s === 200 && usedGateway(wit(w2)) === 'obpay' && wit(w2).status === 'processing', 'two gateways refuse, ObPay takes it: Processing on ObPay', { s: s2.s, gw: usedGateway(wit(w2)), st: wit(w2).status });
  ok(postsFor(w2).length >= 1 && gw.posts.obpay.filter(x => x === w2).length === 1, 'ObPay was asked exactly once', postsFor(w2));
  ok(user(M[3].uid).totalWithdrawn === wit(w2).net, 'counted once', user(M[3].uid).totalWithdrawn);
  // ---- 3. a LOST reply is never handed on: only one gateway is ever asked, the row stays on Sending
  const r3 = await request(M[4], 20000); const w3 = r3.j.withdrawalId; for (const g of ['pesajet', 'tavupay', 'obpay']) gw.mode[g][w3] = 'lost';
  const s3 = await send(w3);
  ok(wit(w3).status === 'sending' && postsFor(w3).length === 1, 'the reply is lost: ONE gateway was asked, the row stays on Sending', { st: wit(w3).status, asked: postsFor(w3), s: s3.s });
  const s3b = await send(w3); ok(s3b.s !== 200 && postsFor(w3).length === 1, 'pressing Send again is refused and asks nobody else', { s: s3b.s, asked: postsFor(w3) });
  ok(user(M[4].uid).walletBalance < 400000 + 0 && user(M[4].uid).totalWithdrawn !== wit(w3).net, 'the wallet keeps the debit; totalWithdrawn is NOT counted for an unconfirmed payout', { tw: user(M[4].uid).totalWithdrawn });
  // ---- 4. every gateway refuses: the request goes back to Pending untouched; rejected -> refunded once
  const r4 = await request(M[5], 20000); const w4 = r4.j.withdrawalId; const m50 = user(M[5].uid).walletBalance + 20000; for (const g of ['pesajet', 'tavupay', 'obpay']) gw.mode[g][w4] = 'refuse';
  const s4 = await send(w4);
  ok(s4.s === 400 && wit(w4).status === 'pending' && !wit(w4).payGw && !wit(w4).pesajetTxId, 'all three refuse: back to Pending, nothing sent', { s: s4.s, st: wit(w4).status });
  ok(postsFor(w4).length === 3, 'each gateway was asked once', postsFor(w4));
  const j1 = await J('POST', '/admin/withdraw/reject', { withdrawalId: w4 }, null, true), j2 = await J('POST', '/admin/withdraw/reject', { withdrawalId: w4 }, null, true);
  ok(j1.s === 200 && user(M[5].uid).walletBalance === m50, 'rejected: refunded in full', { s: j1.s, wallet: user(M[5].uid).walletBalance - m50 });
  ok(j2.s !== 200 && user(M[5].uid).walletBalance === m50, 'rejected twice: refunded once', { s: j2.s, wallet: user(M[5].uid).walletBalance - m50 });
  // ---- 5. accepted, then FAILS at the gateway: refunded exactly once, totalWithdrawn unwound
  const r5 = await request(M[6], 20000); const w5 = r5.j.withdrawalId; const m60 = user(M[6].uid).walletBalance + 20000;
  await send(w5); ok(wit(w5).status === 'processing', 'accepted', wit(w5).status);
  const g5 = usedGateway(wit(w5)); const k5 = Object.keys(gw.status[g5]).find(k => k.endsWith(w5.slice(-8)) || k === w5); gw.status[g5][k5] = g5 === 'obpay' ? 'failed' : 'failed';
  await sync(); await sleep(700); await sync(); await sleep(400);
  ok(['declined', 'rejected'].includes(wit(w5).status), 'the gateway says failed: the withdrawal is closed (' + g5 + ')', wit(w5).status);
  ok(user(M[6].uid).walletBalance === m60 && !user(M[6].uid).totalWithdrawn, 'refunded in full exactly once and totalWithdrawn unwound', { back: user(M[6].uid).walletBalance - m60, tw: user(M[6].uid).totalWithdrawn });
  // ---- 6. three admins press Send at the same moment: one request reaches a gateway
  const r6 = await request(M[7], 20000); const w6 = r6.j.withdrawalId;
  const t0 = totalPosts(); const three = await Promise.all([send(w6), send(w6), send(w6)]);
  ok(totalPosts() - t0 === 1, 'three simultaneous Send clicks: exactly one request reached a gateway', totalPosts() - t0);
  ok(three.filter(x => x.s === 200).length === 1 && user(M[7].uid).totalWithdrawn === wit(w6).net, 'one succeeded and totalWithdrawn is counted once', three.map(x => x.s));
  // ---- the server's own books
  const ig = await J('GET', '/admin/integrity', null, null, true);
  ok(ig.s === 200 && ig.j.mismatches.length === 0, 'the integrity check finds every wallet and total equal to its history', ig.j.mismatches);
  ok(!(ig.j.alerts || []).some(a => a.kind === 'negative_balance' || a.kind === 'duplicate_credit'), 'no negative balance, no duplicate credit', ig.j.alerts);
  const fatal = serverErrors.filter(e => /ReferenceError|TypeError|is not a function|is not defined|Cannot read/i.test(e)); ok(fatal.length === 0, 'no code errors logged', fatal);
  realLog(fails ? 'FAIL: ' + fails + ' of ' + n : 'test-payout-e2e: ' + n + ' checks passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { realLog(e); process.exit(1); });
