'use strict';
// A recharge closed as FAILED is asked about again at its provider, and credited if the provider says it was PAID.
// END TO END: the REAL server.js against the in-memory MongoDB stand-in, with the three payment providers faked at the network edge
// (TavuPay over https, PesaJet and MarzPay over fetch). Covers: the Sync button, the periodic re-check timing, a late success webhook / callback,
// a provider that still says failed (stays failed, ledger untouched), a different amount (parked for review), no reference (cannot be looked up),
// double credits (never), and the wallet, the ledger row and the server's own integrity check all agreeing afterwards.
const path = require('path'), Module = require('module'), https = require('node:https'), { EventEmitter } = require('node:events');
const root = __dirname;
const fm = require('./test-helpers/fake-mongodb.js');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...a) { return req === 'mongodb' ? path.join(root, 'test-helpers', 'fake-mongodb.js') : origResolve.call(this, req, ...a); };
const PORT = 3700 + Math.floor(Math.random() * 90);
Object.assign(process.env, { PORT: String(PORT), MONGODB_URI: 'mongodb://fake/choc', ADMIN_KEY: 'recheck-admin-key-123456', NODE_ENV: 'development', PESAJET_API_KEY: 'pj-key', TAVUPAY_API_KEY: 'tv-key', TAVUPAY_API_SECRET: 'tv-secret', MARZPAY_KEY: 'bWFyejprZXk=' });
const realLog = console.log; console.log = () => {}; console.warn = () => {};
const serverErrors = []; console.error = (...a) => { serverErrors.push(a.map(x => (x && x.message) || String(x)).join(' ').slice(0, 200)); };
// ---- the providers' side of the world: what each says about each payment (changed from inside the test) ----
const says = { tavupay: {}, pesajet: {}, marzpay: {} };
const asked = [];
const realRequest = https.request;
https.request = function (opts, cb) {
  if (opts && opts.hostname === 'api.tavupay.lat') {
    const req = new EventEmitter(); req.write = () => {}; req.destroy = e => req.emit('error', e);
    req.end = () => {
      const m = /reference=([^&]+)/.exec(opts.path || ''); const ref = m ? decodeURIComponent(m[1]) : '';
      asked.push('tavupay:' + ref);
      const v = says.tavupay[ref];
      const resp = new EventEmitter(); resp.statusCode = v ? 200 : 404;
      setImmediate(() => { cb(resp); resp.emit('data', Buffer.from(JSON.stringify(v ? { data: Object.assign({ reference: ref }, v) } : { message: 'not found' }))); resp.emit('end'); });
    };
    return req;
  }
  return realRequest.apply(this, arguments);
};
const realFetch = global.fetch;
global.fetch = async function (url, init) {
  const u = String(url);
  const json = (code, body) => ({ ok: code >= 200 && code < 300, status: code, json: async () => body, text: async () => JSON.stringify(body) });
  let m;
  if ((m = /payments\.pesajet\.com\/api\/v1\/payments\/([^/?]+)/.exec(u))) { asked.push('pesajet:' + m[1]); const v = says.pesajet[m[1]]; return v ? json(200, { data: Object.assign({ transactionId: m[1] }, v) }) : json(404, { error: { code: 'NOT_FOUND', message: 'no such payment' } }); }
  if ((m = /wallet\.wearemarz\.com\/api\/v1\/collect-money\/([^/?]+)/.exec(u))) { asked.push('marzpay:' + m[1]); const v = says.marzpay[m[1]]; return v ? json(200, { data: { transaction: Object.assign({ uuid: m[1] }, v) } }) : json(404, { message: 'nf' }); }
  if (/wearemarz\.com|pesajet\.com|tavupay\.lat/.test(u)) return json(404, { message: 'unexpected call to ' + u });
  return realFetch.apply(this, arguments);
};
const S = n => (fm.__stores[n] = fm.__stores[n] || new Map());
const MIN = 60000, old = ms => new Date(Date.now() - ms);
const user = id => S('users').set(id, { _id: id, phone: '0770' + String(id.charCodeAt(0)).padStart(6, '0'), status: 'active', walletBalance: 0, totalDeposited: 0, registrationDone: true, referralCode: 'R' + id, createdAt: old(9 * 3600 * 1000) });
function failedDeposit(id, userId, over) {
  S('pendingDeposits').set(id, Object.assign({ _id: id, userId, amount: 32000, status: 'failed', provider: 'tavupay', ref: 'ref-' + id, failureReason: 'This payment was not completed.', failedVia: 'member poll: said failed', createdAt: old(5 * MIN) }, over));
  S('transactions').set('tx-' + id, { _id: 'tx-' + id, userId, type: 'deposit', status: 'failed', amount: 0, displayAmount: 32000, description: 'Deposit: Failed (UGX 32,000)', depositId: id, ref: 'ref-' + id });
}
['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].forEach(user);
failedDeposit('dTava', 'a', { provider: 'tavupay', tavupayRef: 'TV1' }); says.tavupay.TV1 = { status: 'successful', amount: 32640, fee: 0 };     // paid (the customer's own charge on top)
failedDeposit('dPesa', 'b', { provider: 'pesajet', pesajetTxId: 'PJ1' }); says.pesajet.PJ1 = { status: 'completed' };
failedDeposit('dMarz', 'c', { provider: 'marzpay', marzTxUuid: 'MZ1', marzReference: 'mzref-c' }); says.marzpay.MZ1 = { status: 'successful', reference: 'mzref-c' };
failedDeposit('dReal', 'd', { provider: 'tavupay', tavupayRef: 'TV2' }); says.tavupay.TV2 = { status: 'failed', amount: 32000 };                    // really failed
failedDeposit('dLess', 'e', { provider: 'tavupay', tavupayRef: 'TV3' }); says.tavupay.TV3 = { status: 'successful', amount: 1000 };                 // paid LESS
failedDeposit('dNoRef', 'f', { provider: 'tavupay' });                                                                                              // never got a reference
failedDeposit('dWait', 'g', { provider: 'pesajet', pesajetTxId: 'PJ2' }); says.pesajet.PJ2 = { status: 'pending' };
failedDeposit('dOld', 'h', { provider: 'tavupay', tavupayRef: 'TV4', createdAt: old(9 * 24 * 3600 * 1000) }); says.tavupay.TV4 = { status: 'successful', amount: 32000 };   // older than 7 days: left alone
require('./server.js');
const base = 'http://127.0.0.1:' + PORT;
const J = async (m, p, b, adm) => { const r = await fetch(base + p, { method: m, headers: Object.assign({ 'content-type': 'application/json' }, adm ? { authorization: 'Bearer recheck-admin-key-123456' } : {}), body: b ? JSON.stringify(b) : undefined }); let j = {}; try { j = await r.json(); } catch (_) {} return { s: r.status, j }; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0, n = 0; const ok = (c, m, x) => { n++; if (!c) { fails++; realLog('FAIL', m, x ? JSON.stringify(x).slice(0, 300) : ''); } };
const wallet = id => fm.__stores.users.get(id).walletBalance, dep = id => fm.__stores.pendingDeposits.get(id), tx = id => fm.__stores.transactions.get('tx-' + id);
(async () => {
  for (let i = 0; i < 60; i++) { try { const h = await realFetch(base + '/health'); if (h.ok) break; } catch (_) {} await sleep(250); }
  // ---- the Sync button asks every failed recharge of the last 7 days
  const sync = await J('GET', '/admin/payments/sync', null, true);
  ok(sync.s === 200 && sync.j.status === 'success', 'Sync answers', sync);
  ok(sync.j.depositsRecovered === 3 && sync.j.depositsSettled >= 3, 'Sync recovered the three recharges that were really paid', sync.j);
  for (const [d, u, amt] of [['dTava', 'a', 32000], ['dPesa', 'b', 32000], ['dMarz', 'c', 32000]]) {
    ok(dep(d).status === 'matched' && dep(d).walletCredited === true && !dep(d).needsManualCredit, d + ' is credited', dep(d));
    ok(wallet(u) === amt && fm.__stores.users.get(u).totalDeposited === amt, d + ': the wallet got OUR stored amount, once (' + amt + ')', fm.__stores.users.get(u));
    ok(tx(d).status === 'success' && tx(d).amount === amt, d + ': the history row reads Success with the amount again', tx(d));
  }
  ok(dep('dTava').failedVia === 'member poll: said failed', 'the path that first closed it is still on the record');
  ok(dep('dReal').status === 'failed' && wallet('d') === 0 && tx('dReal').status === 'failed' && tx('dReal').amount === 0, 'a recharge the provider still calls failed stays failed, wallet and history untouched');
  ok(dep('dReal').recheckedAtMs > 0, 'and it is stamped as just re-checked');
  ok(dep('dLess').status === 'review' && wallet('e') === 0 && /reports 1000 for a recharge of 32000/.test(dep('dLess').reviewReason), 'paid but LESS than asked: parked for review, nothing credited', dep('dLess'));
  ok(dep('dNoRef').status === 'failed' && wallet('f') === 0, 'no provider reference: cannot be looked up, left failed');
  ok(dep('dWait').status === 'failed' && wallet('g') === 0, 'provider still pending: left failed');
  ok(dep('dOld').status === 'failed' && wallet('h') === 0 && !asked.includes('tavupay:TV4'), 'older than 7 days: not asked');
  ok(!asked.includes('tavupay:undefined'), 'a row with no reference never reaches the provider');
  // ---- nothing is credited twice by a second Sync, the periodic sweep or a late webhook
  const asked1 = asked.length;
  const sync2 = await J('GET', '/admin/payments/sync', null, true);
  ok(sync2.j.depositsRecovered === 0 && wallet('a') === 32000 && wallet('b') === 32000 && wallet('c') === 32000, 'a second Sync credits nothing more', sync2.j);
  ok(!asked.slice(asked1).some(x => /TV1|PJ1|MZ1/.test(x)), 'credited rows are not asked about again');
  await J('POST', '/tavupay/webhook', { event: 'payment.success', reference: 'TV1', data: { amount: 32000 } }); await sleep(300);
  ok(wallet('a') === 32000, 'a late success webhook for an already credited recharge pays nothing', wallet('a'));
  // ---- the provider later flips: dReal / dWait / dLess are paid after all
  says.tavupay.TV2 = { status: 'successful', amount: 32000 }; says.pesajet.PJ2 = { status: 'completed' };
  const sync3 = await J('GET', '/admin/payments/sync', null, true);
  ok(wallet('d') === 32000 && wallet('g') === 32000 && sync3.j.depositsRecovered === 2, 'rows that flip to paid later are credited by the next Sync', { d: wallet('d'), g: wallet('g'), j: sync3.j });
  // ---- a late success WEBHOOK / CALLBACK settles a failed recharge by itself (each re-reads the provider first)
  failedDeposit('wTava', 'a', { provider: 'tavupay', tavupayRef: 'TV5', createdAt: old(5 * MIN), recheckedAtMs: Date.now() }); says.tavupay.TV5 = { status: 'successful', amount: 32000 };
  const w0 = wallet('a');
  await J('POST', '/tavupay/webhook', { event: 'payment.success', reference: 'TV5', data: { amount: 32000 } }); await sleep(600);
  ok(dep('wTava').status === 'matched' && wallet('a') === w0 + 32000, 'TavuPay success webhook credits a recharge that had been closed as failed', { s: dep('wTava').status, w: wallet('a') - w0 });
  failedDeposit('wMarz', 'b', { provider: 'marzpay', marzTxUuid: 'MZ2', marzReference: 'mzref-w', recheckedAtMs: Date.now() }); says.marzpay.MZ2 = { status: 'successful', reference: 'mzref-w' };
  const w1 = wallet('b');
  await J('POST', '/deposit/callback', { data: { reference: 'mzref-w', transaction: { status: 'successful', uuid: 'MZ2', reference: 'mzref-w' } } }); await sleep(600);
  ok(dep('wMarz').status === 'matched' && wallet('b') === w1 + 32000, 'MarzPay success callback credits a recharge that had been closed as failed', { s: dep('wMarz').status, w: wallet('b') - w1 });
  failedDeposit('wPesa', 'c', { provider: 'pesajet', pesajetTxId: 'PJ3', recheckedAtMs: Date.now() }); says.pesajet.PJ3 = { status: 'completed' };
  const w2 = wallet('c');
  await J('POST', '/pesajet/webhook', { event: 'payment.completed', reference: 'ref-wPesa', status: 'completed' }); await sleep(600);
  ok(dep('wPesa').status === 'matched' && wallet('c') === w2 + 32000, 'PesaJet success webhook credits a recharge that had been closed as failed', { s: dep('wPesa').status, w: wallet('c') - w2 });
  // a FAILED webhook never rewrites or credits anything on a row that is already failed
  failedDeposit('wFail', 'd', { provider: 'tavupay', tavupayRef: 'TV6', recheckedAtMs: Date.now(), failedVia: 'first' }); says.tavupay.TV6 = { status: 'failed' };
  const w3 = wallet('d');
  await J('POST', '/tavupay/webhook', { event: 'payment.failed', reference: 'TV6' }); await sleep(400);
  ok(dep('wFail').status === 'failed' && dep('wFail').failedVia === 'first' && wallet('d') === w3, 'a failed webhook leaves an already failed row exactly as it was');
  // ---- the admin presses Force-credit on a failed row while the re-check, a webhook and a second Force-credit all fire: the member is paid ONCE
  failedDeposit('dRace', 'h', { provider: 'tavupay', tavupayRef: 'TV7', createdAt: old(5 * MIN) }); says.tavupay.TV7 = { status: 'successful', amount: 32000 };
  const wr0 = wallet('h');
  const race = await Promise.all([J('POST', '/admin/deposit/force-credit', { depositId: 'dRace' }, true), J('GET', '/admin/payments/sync', null, true), J('POST', '/tavupay/webhook', { event: 'payment.success', reference: 'TV7', data: { amount: 32000 } }), J('POST', '/admin/deposit/force-credit', { depositId: 'dRace' }, true)]);
  await sleep(800);
  ok(wallet('h') === wr0 + 32000, 'Force-credit + Sync + a webhook + a second Force-credit on one failed row: paid exactly once', { paid: wallet('h') - wr0, answers: race.map(x => x.s) });
  ok(dep('dRace').status === 'matched' && tx('dRace').status === 'success' && tx('dRace').amount === 32000, 'and the row and its history are consistent', { st: dep('dRace').status, tx: tx('dRace') });
  const again2 = await J('POST', '/admin/deposit/force-credit', { depositId: 'dRace' }, true);
  ok(again2.s === 200 && /Already credited/.test(again2.j.message || '') && wallet('h') === wr0 + 32000, 'pressing Force-credit later says Already credited and pays nothing', again2);
  // ---- the periodic sweep: only rows that are due (new: every 10 minutes; older than 2 hours: hourly)
  failedDeposit('p1', 'a', { tavupayRef: 'P1' }); failedDeposit('p2', 'a', { tavupayRef: 'P2', recheckedAtMs: Date.now() - 1000 });
  failedDeposit('p3', 'a', { tavupayRef: 'P3', createdAt: old(30 * MIN), recheckedAtMs: old(20 * MIN).getTime() });
  failedDeposit('p4', 'a', { tavupayRef: 'P4', createdAt: old(3 * 3600 * 1000), recheckedAtMs: old(20 * MIN).getTime() });
  failedDeposit('p5', 'a', { tavupayRef: 'P5', createdAt: old(3 * 3600 * 1000), recheckedAtMs: old(70 * MIN).getTime() });
  failedDeposit('p6', 'a', { tavupayRef: 'P6', method: 'manual' });
  for (const k of ['P1', 'P2', 'P3', 'P4', 'P5', 'P6']) says.tavupay[k] = { status: 'successful', amount: 32000 };
  asked.length = 0; const w4 = wallet('a');
  const sweep = await new Promise(r => { const src = require('fs').readFileSync(path.join(root, 'server.js'), 'utf8'); r(/reconcilePendingDeposits\(\)\.then\(\(\) => resolveFailedDeposits\(\)\)\.then\(parkLostMarzDeposits\)/.test(src)); });
  ok(sweep, 'the periodic reconciler re-asks failed recharges');
  // the reconciler itself fires every 30 s; wait for the first pass (15 s after start) instead of calling anything by hand
  for (let i = 0; i < 60 && !(dep('p1').status === 'matched'); i++) await sleep(500);
  ok(dep('p1').status === 'matched' && dep('p3').status === 'matched' && dep('p5').status === 'matched', 'the periodic pass credited the due rows (new, 10-minute and hourly rules)', ['p1', 'p3', 'p5'].map(k => dep(k).status));
  ok(dep('p2').status === 'failed' && dep('p4').status === 'failed' && dep('p6').status === 'failed', 'and left alone: just checked, checked 20 minutes ago after 2 hours, manual', ['p2', 'p4', 'p6'].map(k => dep(k).status));
  ok(wallet('a') === w4 + 3 * 32000, 'exactly three credits of 32,000', wallet('a') - w4);
  // ---- the server's own integrity check: every wallet equals its history
  const ig = await J('GET', '/admin/integrity', null, true);
  ok(ig.s === 200 && ig.j.mismatches.length === 0, 'the integrity check finds no wallet that disagrees with its history', ig.j.mismatches);
  // ---- markDepositFailed itself (the function every path uses to close a row): a credited row is never closed, a repeated failure never rewrites the history row
  {
    const text = require('fs').readFileSync(path.join(root, 'server.js'), 'utf8');
    const a = text.indexOf('async function markDepositFailed(depRef, userId, reason, via)'), b = text.indexOf('// ── MARZPAY (mobile money collect/send) ──');
    const store = { dep: { status: 'matched', walletCredited: true, needsManualCredit: true, amount: 32000 }, tx: { status: 'failed', amount: 0, description: 'Deposit: Failed (UGX 32,000)' } };
    const depRef = { id: 'dep', get: async () => ({ exists: true, data: () => store.dep }), update: async v => { Object.assign(store.dep, v); } };
    const txRef = { update: async v => { Object.assign(store.tx, v); } };
    const dbStub = { collection: () => ({ where: () => ({ limit: () => ({ get: async () => ({ docs: [{ data: () => store.tx, ref: txRef }] }) }) }) }) };
    const run = new Function('depositFullyCredited', 'withLock', 'db', 'fmtMoney', 'console', '_depCreateDebounce', '_depAttempts', 'Promise', text.slice(a, b).split('\n// ── MARZPAY')[0] + '\nreturn markDepositFailed;')(d => d.status === 'matched' && !d.needsManualCredit, (k, fn) => fn(), dbStub, x => 'UGX ' + x, { warn() {}, error() {} }, new Map(), new Map(), Promise);
    ok((await run(depRef, 'u', 'why', 'test')) === false && store.dep.status === 'matched', 'a recharge whose wallet was already credited is never closed as failed, even with its bookkeeping still pending');
    store.dep.status = 'failed'; store.dep.walletCredited = false; delete store.dep.needsManualCredit;
    await run(depRef, 'u', 'why', 'test');
    ok(store.tx.description === 'Deposit: Failed (UGX 32,000)' && store.tx.amount === 0, 'a repeated failed verdict does not rewrite the history row as "Failed (UGX 0)"', store.tx);
  }
  const fatal = serverErrors.filter(e => /ReferenceError|TypeError|is not a function|is not defined|Cannot read/i.test(e));
  ok(fatal.length === 0, 'no code errors were logged by the server', fatal);
  const src = require('fs').readFileSync(path.join(root, 'server.js'), 'utf8');
  ok(/app\.get\('\/admin\/payments\/sync'[\s\S]{0,1200}resolveFailedDeposits\(\{ force: true/.test(src), 'the Sync button re-asks failed rows');
  realLog(fails ? 'FAIL: ' + fails + ' of ' + n : 'test-failed-recheck: ' + n + ' checks passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { realLog(e); process.exit(1); });
