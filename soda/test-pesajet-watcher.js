'use strict';
// The server-side fast confirmation of PesaJet recharges (watchPesajetDeposit in server.js): real source, stubbed database/gateway.
const fs = require('node:fs'), assert = require('node:assert/strict');
const src = fs.readFileSync(__dirname + '/server.js', 'utf8');
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); }; const eq = (a, b, m) => { n++; assert.deepEqual(a, b, m); };
const a = src.indexOf('const PESAJET_WATCH_EVERY_MS'), b = src.indexOf("// PesaJet's status -> the three words the rest of this file already speaks");
assert.ok(a > 0 && b > a, 'watcher source found');
const block = src.slice(a, b).replace('PESAJET_WATCH_EVERY_MS = 700', 'PESAJET_WATCH_EVERY_MS = 5').replace('PESAJET_WATCH_SPREAD_MS = 125', 'PESAJET_WATCH_SPREAD_MS = 0').replace('PESAJET_WATCH_BACKOFF_MS = 1000', 'PESAJET_WATCH_BACKOFF_MS = 20').replace('PESAJET_WATCH_BACKOFF_MAX_MS = 8000', 'PESAJET_WATCH_BACKOFF_MAX_MS = 80').replace('PESAJET_WATCH_BUDGET_MS = 120000', 'PESAJET_WATCH_BUDGET_MS = 300');
const wait = ms => new Promise(r => setTimeout(r, ms));
function env(rows) {
  const calls = { pj: 0, credit: [], failed: [], errors: [] };
  const state = { rows, script: [] };           // script: successive PesaJet answers
  const db = { collection: () => ({ doc: id => ({ get: async () => { const r = state.rows[id]; return { exists: !!r, id, ref: { id }, data: () => r }; } }) }) };
  const pesajetGetTx = async () => { calls.pj++; return state.script.length > 1 ? state.script.shift() : state.script[0]; };
  const creditDeposit = async snap => { if (state.creditThrows) throw new Error('boom'); calls.credit.push(snap.id); state.rows[snap.id].status = 'matched'; };
  const markDepositFailed = async (ref, uid, msg) => { calls.failed.push([ref.id, uid, msg]); state.rows[ref.id].status = 'failed'; return true; };
  const f = new Function('db', 'pesajetGetTx', 'creditDeposit', 'markDepositFailed', 'pesajetStatusLabel', 'pesajetFailureMsg', 'console',
    block + '\nreturn { watchPesajetDeposit, pesajetWatcherFresh, _pesajetWatchers, waitDepositSettled, _notifyDeposit, _depWaiters };')
    (db, pesajetGetTx, creditDeposit, markDepositFailed, s => ({ completed: 'success', failed: 'failed', expired: 'failed' }[s] || 'processing'), s => 'failed:' + s, { error: m => calls.errors.push(m) });
  return { ...f, calls, state };
}
(async () => {
  // credits as soon as PesaJet says completed, then lets go
  let e = env({ d1: { status: 'pending', userId: 'u1', pesajetTxId: 'tx1' } });
  e.state.script = [{ status: 'pending' }, { status: 'pending' }, { status: 'completed' }];
  e.watchPesajetDeposit('d1'); ok(e._pesajetWatchers.has('d1'), 'watching starts at once');
  await wait(120);
  eq(e.calls.credit, ['d1'], 'credited exactly once'); eq(e.calls.pj, 3, 'asked PesaJet until it said completed'); ok(!e._pesajetWatchers.has('d1'), 'the watcher is gone afterwards');
  // failed / expired -> marked failed with the gateway's wording, not credited
  e = env({ d2: { status: 'pending', userId: 'u2', pesajetTxId: 'tx2' } }); e.state.script = [{ status: 'expired' }];
  e.watchPesajetDeposit('d2'); await wait(60);
  eq(e.calls.failed, [['d2', 'u2', 'failed:expired']], 'expired is a failure for that member'); eq(e.calls.credit, [], 'and nothing is credited');
  // a webhook (or poll) got there first: no more PesaJet calls, no credit
  e = env({ d3: { status: 'matched', userId: 'u3', pesajetTxId: 'tx3' } }); e.state.script = [{ status: 'completed' }];
  e.watchPesajetDeposit('d3'); await wait(40);
  eq(e.calls.pj, 0, 'already settled elsewhere: PesaJet is not even asked'); eq(e.calls.credit, [], 'and it is not credited a second time'); ok(!e._pesajetWatchers.has('d3'), 'watcher gone');
  // waits for the gateway to accept the payment (no pesajetTxId yet), and rides through outages
  e = env({ d4: { status: 'initiating', userId: 'u4' } }); e.state.script = [{ providerDown: true }, { providerDown: true }, { status: 'completed' }];
  e.watchPesajetDeposit('d4'); await wait(25); eq(e.calls.pj, 0, 'no transaction id yet: no gateway call');
  e.state.rows.d4.pesajetTxId = 'tx4'; e.state.rows.d4.status = 'pending'; await wait(120);
  eq(e.calls.credit, ['d4'], 'credited after two outage answers'); 
  // a struggling gateway is asked less and less often (not hammered at the normal pace)
  e = env({ b1: { status: 'pending', userId: 'u', pesajetTxId: 'x' } }); e.state.script = [{ providerDown: true }]; e.watchPesajetDeposit('b1'); await wait(250);
  const askedDown = e.calls.pj; ok(askedDown >= 3 && askedDown <= 8, 'while the gateway is down it is asked with growing gaps (' + askedDown + ' asks in 250 ms, a flat 5 ms pace would be ~40)');
  e.state.rows.b1.status = 'matched'; await wait(120); ok(!e._pesajetWatchers.has('b1'), 'and the watcher still ends when the deposit is settled elsewhere');
  ok(/PESAJET_WATCH_SPREAD_MS = 125/.test(src) && /_pesajetWatchers\.size \* PESAJET_WATCH_SPREAD_MS/.test(src), 'with many watchers the pace stretches (about 8 asks per second in total)');
  // the same deposit is never watched twice; the number of watchers is capped
  e = env({ dup: { status: 'pending', userId: 'u', pesajetTxId: 'x' } }); e.state.script = [{ status: 'pending' }];
  e.watchPesajetDeposit('dup'); e.watchPesajetDeposit('dup'); eq(e._pesajetWatchers.size, 1, 'one watcher per deposit');
  const rows = {}; for (let i = 0; i < 25; i++) rows['c' + i] = { status: 'pending', userId: 'u', pesajetTxId: 't' + i };
  e = env(rows); e.state.script = [{ status: 'pending' }]; for (let i = 0; i < 25; i++) e.watchPesajetDeposit('c' + i);
  eq(e._pesajetWatchers.size, 20, 'at most 20 watchers at once (the rest fall back to the poll-driven check)'); await wait(400);
  eq(e._pesajetWatchers.size, 0, 'every watcher ends by itself when its time budget is over');
  // freshness: the member's poll skips PesaJet only while a watcher is really alive
  e = env({ f: { status: 'pending', userId: 'u', pesajetTxId: 'x' } }); e.state.script = [{ status: 'pending' }];
  ok(!e.pesajetWatcherFresh('f'), 'no watcher: the poll must ask PesaJet itself'); e.watchPesajetDeposit('f'); ok(e.pesajetWatcherFresh('f'), 'live watcher: the poll only reads the database');
  ok(!e.pesajetWatcherFresh('f', -1), 'a stale watcher does not count'); await wait(400); ok(!e.pesajetWatcherFresh('f'), 'ended watcher: back to asking PesaJet');
  // a crash inside never escapes and never leaves a watcher behind
  e = env({ x: { status: 'pending', userId: 'u', pesajetTxId: 'x' } }); e.state.script = [{ status: 'completed' }]; e.state.creditThrows = true;
  e.watchPesajetDeposit('x'); await wait(60); ok(!e._pesajetWatchers.has('x') && e.calls.errors.length === 1, 'an error is logged and the watcher is removed');
  // held (long-poll) status requests: answered the instant the deposit settles, never longer than asked, nothing left behind
  e = env({}); let t0 = Date.now(); const w1 = e.waitDepositSettled('h1', 1000), w2 = e.waitDepositSettled('h1', 1000), w3 = e.waitDepositSettled('other', 1000);
  eq(e._depWaiters.get('h1').size, 2, 'two requests held on the same deposit');
  setTimeout(() => e._notifyDeposit('h1'), 30); await Promise.all([w1, w2]);
  ok(Date.now() - t0 < 300, 'both are released as soon as the deposit settles (' + (Date.now() - t0) + ' ms), not at their 1 s limit'); ok(!e._depWaiters.has('h1'), 'and nothing is left registered');
  ok(e._depWaiters.has('other'), 'a different deposit keeps waiting'); e._notifyDeposit('other'); await w3;
  t0 = Date.now(); await e.waitDepositSettled('h2', 40); ok(Date.now() - t0 >= 35 && Date.now() - t0 < 250, 'with no news it answers at the limit it was given'); ok(!e._depWaiters.has('h2'), 'and cleans up');
  e._notifyDeposit('nobody-waiting'); ok(true, 'notifying a deposit nobody waits for is harmless');
  // the real callers wake held requests, and the route only holds under the right conditions
  ok(/async function creditDeposit\(depDoc, source\) \{[\s\S]*?_notifyDeposit\(depDoc\.id\)/.test(src), 'creditDeposit wakes held requests');
  ok(/async function markDepositFailed\(depRef, userId, reason\) \{\s*try \{ return await _markDepositFailedNow[\s\S]*?finally \{[^}]*_notifyDeposit\(depRef\.id\)/.test(src), 'markDepositFailed wakes held requests (also on errors)');
  const rs0 = src.indexOf("app.post('/deposit/marzpay/status'"); const route0 = src.slice(rs0, src.indexOf("// ── CARD DEPOSIT (MarzPay) ──", rs0));
  ok(/Math\.min\(Math\.max\(parseInt\(req\.body\.waitMs, 10\) \|\| 0, 0\), 9000\)/.test(route0), 'the hold is capped at 9 s whatever the client asks');
  ok(/holdMs > 0 && dep\.provider === 'pesajet' && \(dep\.status === 'pending' \|\| dep\.status === 'initiating'\) && pesajetWatcherFresh\(depSnap\.id\)/.test(route0), 'it holds only a PesaJet deposit that is still pending AND has a live watcher');
  const app = fs.readFileSync(__dirname + '/user-src/original_module.js', 'utf8');
  ok(/function depositStatusHold\(depositId\)\{\s*return post\('\/deposit\/marzpay\/status', \{ depositId, waitMs: DEP_HOLD_MS \}\)/.test(app), 'the app autopoll asks the server to hold');
  ok(/function depositStatusCheck\(depositId\)\{[\s\S]*?post\('\/deposit\/marzpay\/status', \{ depositId \}\)/.test(app), 'the Verify button still asks for an immediate answer (never waits behind a held request)');
  // wiring in the real routes
  const marker = src.slice(src.indexOf("if (pesajetTxId) watchPesajetDeposit(depRef.id)") - 600, src.indexOf("if (pesajetTxId) watchPesajetDeposit(depRef.id)") + 80);
  ok(/status: 'pending', pesajetTxId/.test(marker), 'the watcher starts only AFTER the transaction id is saved');
  const rs = src.indexOf("app.post('/deposit/marzpay/status'"); const route = src.slice(rs, src.indexOf("// ── CARD DEPOSIT (MarzPay) ──", rs));
  ok(route.indexOf('pesajetWatcherFresh(depSnap.id)') > route.indexOf("dep.provider === 'pesajet'") && route.indexOf('pesajetWatcherFresh(depSnap.id)') < route.indexOf('pesajetGetTx(dep.pesajetTxId'), 'the status route skips its own PesaJet call only while a watcher is fresh');
  console.log(`PASS: fast PesaJet confirmation: server-side watcher (${n} checks)`); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
