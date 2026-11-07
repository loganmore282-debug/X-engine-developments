'use strict';
// MONEY GOING OUT, end to end: the REAL server.js against the in-memory MongoDB stand-in, with PesaJet faked at the network edge.
// A withdrawal is requested by a member and sent by the admin. Covers: accepted -> processing -> completed (totalWithdrawn once, history Success);
// a clean refusal (back to Pending, nothing sent, then rejected and refunded exactly once); a LOST reply (stays on Sending, never sent a second time,
// found again by our reference); a payout that fails at the provider (refunded exactly once, totalWithdrawn unwound); two admins clicking Send at the
// same moment (ONE request reaches the provider); and the server's own integrity check agreeing with every wallet afterwards.
const path = require('path'), Module = require('module');
const root = __dirname;
const fm = require('./test-helpers/fake-mongodb.js');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...a) { return req === 'mongodb' ? path.join(root, 'test-helpers', 'fake-mongodb.js') : origResolve.call(this, req, ...a); };
const PORT = 3500 + Math.floor(Math.random() * 90);
Object.assign(process.env, { PORT: String(PORT), MONGODB_URI: 'mongodb://fake/choc', ADMIN_KEY: 'po-admin-key-123456', NODE_ENV: 'development', PESAJET_API_KEY: 'pj-key' });
const cap = require('./captcha.js'); const realVerify = cap.verify; cap.verify = (id, code) => code === '0000' ? true : realVerify(id, code);
const realLog = console.log; console.log = () => {}; console.warn = () => {};
const serverErrors = []; console.error = (...a) => { serverErrors.push(a.map(x => (x && x.message) || String(x)).join(' ').slice(0, 200)); };
// ---- PesaJet's side of the world ----
const pj = { mode: {}, status: {}, listed: [], posts: [] };   // mode[reference] = 'accept' | 'refuse' | 'lost'; status[txId] = 'pending'|'completed'|'failed'
const realFetch = global.fetch;
global.fetch = async function (url, init) {
  const u = String(url);
  const json = (code, body) => ({ ok: code >= 200 && code < 300, status: code, json: async () => body, text: async () => JSON.stringify(body) });
  if (/payments\.pesajet\.com\/api\/v1\/payments(\?|$)/.test(u) && init && init.method === 'POST') {
    const b = JSON.parse(init.body); pj.posts.push(b.reference);
    const mode = pj.mode[b.reference] || 'accept';
    if (mode === 'lost') throw new Error('socket hang up');
    if (mode === 'refuse') return json(400, { error: { code: 'INSUFFICIENT_BALANCE', message: 'The PesaJet wallet has too little balance' } });
    const txId = 'PJ-' + b.reference.slice(-8); pj.status[txId] = 'pending'; pj.listed.push({ reference: b.reference, transactionId: txId, status: 'pending' });
    return json(200, { data: { transactionId: txId, status: 'PENDING', reference: b.reference } });
  }
  let m;
  if ((m = /payments\.pesajet\.com\/api\/v1\/payments\/([^/?]+)/.exec(u))) { const s = pj.status[m[1]]; return s ? json(200, { data: { transactionId: m[1], status: s.toUpperCase() } }) : json(404, { error: { code: 'NOT_FOUND', message: 'unknown' } }); }
  if (/payments\.pesajet\.com\/api\/v1\/payments\?/.test(u)) { const page = Number((/page=(\d+)/.exec(u) || [])[1] || 1); return json(200, { data: page === 1 ? pj.listed.map(r => Object.assign({}, r, { status: (pj.status[r.transactionId] || r.status).toUpperCase() })) : [] }); }
  if (/pesajet\.com|wearemarz\.com|tavupay\.lat/.test(u)) return json(404, { message: 'unexpected call to ' + u });
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
async function request(m, amount) { const r = await J('POST', '/withdraw/request', { amount, network: 'MTN Mobile Money', phone: m.bank, pin: '123456' }, m.tok); return r; }
const txOf = wid => [...fm.__stores.transactions.values()].find(t => t.withdrawalId === wid);
(async () => {
  for (let i = 0; i < 60; i++) { try { const h = await realFetch(base + '/health'); if (h.ok) break; } catch (_) {} await sleep(250); }
  const sv = await J('POST', '/admin/settings/update', { settings: { welcomeBonus: 400000, withdrawMethod: 'pesajet' } }, null, true); ok(sv.s === 200, 'settings saved', sv);
  const [A, B, C, D, E] = [await member(), await member(), await member(), await member(), await member()];
  // ---- 1. accepted, then completed
  const a0 = user(A.uid).walletBalance; const ra = await request(A, 20000); ok(ra.s === 200, 'A requests 20,000', ra);
  const wa = ra.j.withdrawalId; ok(user(A.uid).walletBalance === a0 - 20000, 'the request takes the 20,000 from the wallet at once', user(A.uid).walletBalance - a0);
  const pa = await J('POST', '/admin/withdraw/process', { withdrawalId: wa }, null, true); ok(pa.s === 200, 'admin sends it', pa);
  ok(wit(wa).status === 'processing' && /^PJ-/.test(wit(wa).pesajetTxId), 'accepted by PesaJet: Processing, with PesaJet\'s id saved', wit(wa));
  ok(user(A.uid).totalWithdrawn === wit(wa).net, 'totalWithdrawn counted once (the net amount ' + wit(wa).net + ')', user(A.uid).totalWithdrawn);
  ok(txOf(wa).status === 'processing', 'the history row reads Processing', txOf(wa));
  pj.status[wit(wa).pesajetTxId] = 'completed';
  await J('POST', '/pesajet/webhook', { event: 'payout.completed', reference: wa, status: 'completed' }); await sleep(500);
  ok(wit(wa).status === 'processed' && txOf(wa).status === 'success', 'PesaJet says completed: Processed and the history row reads Success', { w: wit(wa).status, t: txOf(wa).status });
  ok(user(A.uid).totalWithdrawn === wit(wa).net && user(A.uid).walletBalance === a0 - 20000, 'a completed payout changes nothing more', { tw: user(A.uid).totalWithdrawn, wallet: user(A.uid).walletBalance - a0 });
  await J('POST', '/pesajet/webhook', { event: 'payout.completed', reference: wa, status: 'completed' }); await sleep(300);
  ok(user(A.uid).totalWithdrawn === wit(wa).net, 'a repeated webhook counts nothing twice');
  // ---- 2. a clean refusal: nothing was sent, back to Pending; then rejected and refunded exactly once
  const b0 = user(B.uid).walletBalance; const rb = await request(B, 20000); const wb = rb.j.withdrawalId; pj.mode[wb] = 'refuse';
  const pb = await J('POST', '/admin/withdraw/process', { withdrawalId: wb }, null, true);
  ok(pb.s === 400 && wit(wb).status === 'pending' && !wit(wb).pesajetTxId, 'PesaJet refuses: the request goes back to Pending, nothing sent', { s: pb.s, st: wit(wb).status });
  ok(user(B.uid).walletBalance === b0 - 20000 && !user(B.uid).totalWithdrawn, 'and the wallet / totals are untouched', { w: user(B.uid).walletBalance - b0, tw: user(B.uid).totalWithdrawn });
  const rj1 = await J('POST', '/admin/withdraw/reject', { withdrawalId: wb }, null, true); const rj2 = await J('POST', '/admin/withdraw/reject', { withdrawalId: wb }, null, true);
  ok(rj1.s === 200 && user(B.uid).walletBalance === b0, 'rejecting refunds the member in full', { s: rj1.s, back: user(B.uid).walletBalance - b0 });
  ok(rj2.s !== 200 && user(B.uid).walletBalance === b0, 'rejecting twice refunds only once', { s: rj2.s, back: user(B.uid).walletBalance - b0 });
  // ---- 3. a LOST reply: stays on Sending, never sent twice, found again by our reference
  const c0 = user(C.uid).walletBalance; const rc = await request(C, 20000); const wc = rc.j.withdrawalId; pj.mode[wc] = 'lost';
  const pc = await J('POST', '/admin/withdraw/process', { withdrawalId: wc }, null, true);
  ok(pc.s === 500 && wit(wc).status === 'sending', 'the reply is lost: the row stays on Sending (not Pending)', { s: pc.s, st: wit(wc).status });
  const pc2 = await J('POST', '/admin/withdraw/process', { withdrawalId: wc }, null, true);
  ok(pc2.s === 400 && pj.posts.filter(r => r === wc).length === 1, 'sending it AGAIN is refused: PesaJet was asked exactly once', { s: pc2.s, posts: pj.posts.filter(r => r === wc).length });
  ok(user(C.uid).walletBalance === c0 - 20000, 'the wallet still holds the debit', user(C.uid).walletBalance - c0);
  // PesaJet did take it after all: it shows in their list under OUR reference
  pj.status['PJ-late'] = 'pending'; pj.listed.push({ reference: wc, transactionId: 'PJ-late', status: 'pending' });
  wit(wc).sendingAt = new Date(Date.now() - 10 * 60000);
  await J('GET', '/admin/payments/sync', null, null, true); await sleep(500);
  ok(wit(wc).status === 'processing' && wit(wc).pesajetTxId === 'PJ-late', 'found by our reference: Processing with PesaJet\'s id', { st: wit(wc).status, id: wit(wc).pesajetTxId });
  ok(user(C.uid).totalWithdrawn === wit(wc).net, 'totalWithdrawn counted once when it was found', user(C.uid).totalWithdrawn);
  pj.status['PJ-late'] = 'completed'; await J('GET', '/admin/payments/sync', null, null, true); await sleep(500);
  ok(wit(wc).status === 'processed' && txOf(wc).status === 'success', 'and then completed', wit(wc).status);
  // ---- 4. accepted, then it FAILS at the provider: refunded exactly once, totalWithdrawn unwound
  const d0 = user(D.uid).walletBalance; const rd = await request(D, 20000); const wd = rd.j.withdrawalId;
  await J('POST', '/admin/withdraw/process', { withdrawalId: wd }, null, true); ok(wit(wd).status === 'processing', 'D\'s payout is accepted', wit(wd).status);
  pj.status[wit(wd).pesajetTxId] = 'failed';
  await J('POST', '/pesajet/webhook', { event: 'payout.failed', reference: wd, status: 'failed' }); await sleep(700);
  ok(['declined', 'rejected'].includes(wit(wd).status), 'PesaJet says failed: the withdrawal is closed', wit(wd).status);
  ok(user(D.uid).walletBalance === d0 && !user(D.uid).totalWithdrawn, 'the member is refunded in full and totalWithdrawn is unwound', { back: user(D.uid).walletBalance - d0, tw: user(D.uid).totalWithdrawn });
  await J('POST', '/pesajet/webhook', { event: 'payout.failed', reference: wd, status: 'failed' }); await J('GET', '/admin/payments/sync', null, null, true); await sleep(500);
  ok(user(D.uid).walletBalance === d0, 'a repeated failure refunds nothing more', user(D.uid).walletBalance - d0);
  // ---- 5. two admins press Send at the same moment: ONE request reaches the provider
  const e0 = user(E.uid).walletBalance; const re = await request(E, 20000); const we = re.j.withdrawalId;
  const both = await Promise.all([J('POST', '/admin/withdraw/process', { withdrawalId: we }, null, true), J('POST', '/admin/withdraw/process', { withdrawalId: we }, null, true), J('POST', '/admin/withdraw/process', { withdrawalId: we }, null, true)]);
  ok(pj.posts.filter(r => r === we).length === 1, 'three simultaneous Send clicks: PesaJet is asked exactly once', pj.posts.filter(r => r === we).length);
  ok(both.filter(x => x.s === 200).length === 1, 'exactly one of them succeeded', both.map(x => x.s));
  ok(user(E.uid).totalWithdrawn === wit(we).net, 'totalWithdrawn counted once', user(E.uid).totalWithdrawn);
  // ---- the server's own books
  const ig = await J('GET', '/admin/integrity', null, null, true);
  ok(ig.s === 200 && ig.j.mismatches.length === 0, 'the integrity check finds every wallet and total equal to its history', ig.j.mismatches);
  ok(!(ig.j.alerts || []).some(a => a.kind === 'negative_balance' || a.kind === 'duplicate_credit'), 'no negative balance, no duplicate credit', ig.j.alerts);
  const fatal = serverErrors.filter(e => /ReferenceError|TypeError|is not a function|is not defined|Cannot read/i.test(e)); ok(fatal.length === 0, 'no code errors logged', fatal);
  realLog(fails ? 'FAIL: ' + fails + ' of ' + n : 'test-payout-e2e: ' + n + ' checks passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { realLog(e); process.exit(1); });
