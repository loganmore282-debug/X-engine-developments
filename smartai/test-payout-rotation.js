'use strict';
// Withdrawals through PesaJet, TavuPay and ObPay in turn (Admin > Settings > Withdrawals > "All gateways in turn"; LworxPay is NOT part of it):
// an even round robin, and a gateway that CLEANLY refuses hands the withdrawal to the next one. A lost reply is never handed on.
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const src = fs.readFileSync(__dirname + '/server.js', 'utf8');
const section = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i + a.length); assert(i >= 0 && j > i, 'anchor: ' + a); return src.slice(i, j); };
// the in-memory database of the existing money tests
const t0 = fs.readFileSync(__dirname + '/test-audit-money-regressions.js', 'utf8');
const dbSrc = t0.slice(t0.indexOf('const FV = {'), t0.indexOf('function response()'));
const { FV, makeDb } = new Function('structuredClone', 'assert', dbSrc + '\nreturn { FV, makeDb };')(structuredClone, assert);
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); }; const eq = (a, b, m) => { n++; assert.deepEqual(a, b, m); };

function world({ mode = 'rotate', gw = {}, configured = ['pesajet', 'tavupay', 'lworxpay', 'obpay'], count = 1, extra = {} } = {}) {
  const seed = { users: { u: { walletBalance: 0, totalWithdrawn: 0 } }, withdrawals: {}, transactions: {} };
  for (let i = 1; i <= count; i++) { seed.withdrawals['w' + i] = { userId: 'u', status: 'pending', amount: 20000, net: 17000, phone: '+256700000001', holder: 'Jo Ann', network: 'MTN Mobile Money', createdAt: new Date() }; seed.transactions['tx' + i] = { withdrawalId: 'w' + i, status: 'pending' }; }
  const db = makeDb(seed), calls = [];
  const reply = (p, ok_, extra_) => ({ ok: ok_, providerDown: false, httpStatus: ok_ ? 200 : 400, data: {}, ...extra_ });
  const c = vm.createContext({
    db, FieldValue: FV, crypto, Date, Math, Map, Set, Number, String, Boolean, JSON, Promise, setTimeout, process: { env: {} }, console: { log() {}, warn() {}, error() {} },
    _withdrawInFlight: new Set(), _lockTails: new Map(),
    getSettings: async () => ({ withdrawMethod: mode }), payoutIsManual: () => false, withdrawProvider: () => mode, fmtMoney: x => 'UGX ' + x,
    gatewayServesRegion: () => true, pesajetConfigured: () => configured.includes('pesajet'), tavupayConfigured: () => configured.includes('tavupay'),
    GATEWAY_DEFS: { lworxpay: { configured: () => configured.includes('lworxpay'), callback: () => 'https://x.example/hook' }, obpay: { configured: () => configured.includes('obpay'), callback: () => '' } },
    pesajetPhone: p => p, lworxPhone: p => String(p).replace(/\D/g, ''), tavupayIdempotencyKey: k => k, tsMillis: v => (v instanceof Date ? v.getTime() : Number(v) || 0), SENDING_RECOVER_AFTER_MS: 0,
    gwError: d => ({ code: (d && d.error && d.error.code) || '', message: (d && d.error && d.error.message) || '' }),
    pesajetDisburse: async (a) => { calls.push('pesajet'); return (gw.pesajet || (() => ({ ok: true, providerDown: false, data: { data: { transactionId: 'PJ1' } } })))(a); },
    pesajetUserMsg: (r, f) => (r.data && r.data.message) || f,
    marzSendMoney: async () => { calls.push('marzpay'); return { status: 'success', data: { transaction: { uuid: 'MZ1' } } }; }, marzUserMsg: (d, f) => f,
    _tavupayRequest: async (path, o) => { calls.push('tavupay'); return (gw.tavupay || (() => ({ ok: true, providerDown: false, data: { data: { reference: 'TV1' } } })))(o); },
    _gwRequest: async (p, path, o) => { calls.push(p); return (gw[p] || (() => ({ ok: true, providerDown: false, data: { data: { transaction_id: 'LX1', reference: 'x' } } })))(o); },
    gatewayGetTx: async () => ({ status: 'processing' }), tavupayGetTx: async () => ({ status: 'processing' }),
    finalizeWithdrawalTransactionRecord: async () => {}, PUBLIC_URL: '', brandName: () => 'P', ...extra,
  });
  vm.runInContext(section('function withLock(key, fn)', 'const _userBeingDeleted'), c);
  vm.runInContext(section('async function completeWithdrawalRefund(', 'async function processWithdrawalCore('), c);
  vm.runInContext(section('async function _processWithdrawalNow(', "app.post('/admin/withdraw/process'"), c);
  return { c, db, calls, row: id => db.rows.withdrawals[id], user: () => db.rows.users.u };
}
const turn = (w, k) => vm.runInContext('_payoutTurn = ' + k, w.c);   // a `let` in the lifted source is not a property of the context
const refuse = (code, message) => () => ({ ok: false, providerDown: false, httpStatus: 400, data: { error: { code, message }, message } });
const down = () => ({ ok: false, providerDown: true, httpStatus: 0, data: { message: 'timeout' } });

(async () => {
  // ── even round robin: 9 withdrawals, each of the three gateways takes exactly three; LworxPay (configured) is never asked to send ──
  let w = world({ count: 9 });
  for (let i = 1; i <= 9; i++) { const r = await w.c._processWithdrawalNow('w' + i, 'auto'); eq(r.code, 200, 'w' + i + ' sent: ' + JSON.stringify(r.body)); }
  const tally = {}; w.calls.forEach(g => tally[g] = (tally[g] || 0) + 1);
  eq(Object.keys(tally).sort(), ['obpay', 'pesajet', 'tavupay'], 'PesaJet, TavuPay and ObPay were used, LworxPay was not'); eq(Object.values(tally), [3, 3, 3], 'evenly: three each: ' + JSON.stringify(tally));
  ok(!w.calls.includes('marzpay'), 'MarzPay is not part of the rotation');
  eq(w.user().totalWithdrawn, 9 * 17000, 'totalWithdrawn counted once per payout');
  // fields stored by the generic gateways
  const gwRows = Object.values(w.db.rows.withdrawals).filter(r => r.payGw);
  ok(gwRows.length === 6 && gwRows.every(r => r.payGwRef && r.payGwTxId && r.status === 'processing' && (r.payGw === 'tavupay' || r.payGw === 'obpay')), 'TavuPay/ObPay payouts record payGw, payGwRef, payGwTxId and sit on processing');
  eq(gwRows.map(r => r.payGwRef).sort(), Object.keys(w.db.rows.withdrawals).filter(id => w.row(id).payGw).sort(), 'our reference is the withdrawal id');

  // ── failover: the first gateway refuses cleanly, the next one sends it, nothing is paid twice ──
  w = world({ gw: { pesajet: () => ({ ok: false, providerDown: false, httpStatus: 400, data: { message: 'no float' } }), tavupay: refuse('INSUFFICIENT_BALANCE', 'x') } });
  turn(w, 0);                      // start the circle at PesaJet
  let r = await w.c._processWithdrawalNow('w1', 'auto');
  eq(r.code, 200); eq(w.calls, ['pesajet', 'tavupay', 'obpay'], 'tried in turn until one took it'); eq(w.row('w1').payGw, 'obpay'); eq(w.row('w1').status, 'processing');
  eq(w.user().totalWithdrawn, 17000, 'paid once');
  // refused gateways are skipped for the next withdrawals (5 minutes), so they do not queue behind them
  const w2 = world({ count: 2, gw: { pesajet: () => ({ ok: false, providerDown: false, httpStatus: 400, data: {} }) } });
  turn(w2, 0); await w2.c._processWithdrawalNow('w1', 'a'); const first = w2.calls.length; await w2.c._processWithdrawalNow('w2', 'a');
  ok(!w2.calls.slice(first).includes('pesajet'), 'a gateway that just refused is skipped for the next withdrawal');

  // ── every gateway refuses: stays pending, untouched, says why for each ──
  w = world({ gw: { pesajet: () => ({ ok: false, providerDown: false, httpStatus: 400, data: { message: 'a' } }), tavupay: refuse('X', 'b'), obpay: refuse('INSUFFICIENT_BALANCE', 'c') } });
  r = await w.c._processWithdrawalNow('w1', 'auto');
  eq(r.code, 400); ok(/Every payout gateway refused/.test(r.body.message) && /ObPay/.test(r.body.message) && !/LworxPay/.test(r.body.message) && /too little balance/.test(r.body.message), r.body.message);
  eq(w.row('w1').status, 'pending'); ok(!w.row('w1').payGw && !w.row('w1').sendingReference, 'back on Pending with no gateway marks'); eq(w.user().totalWithdrawn, 0);

  // ── a LOST REPLY is never handed on: it stays on Sending and no other gateway is called ──
  w = world({ gw: { pesajet: () => ({ ok: false, providerDown: true, httpStatus: 0, data: { message: 'timeout' } }), tavupay: down, obpay: down } });
  turn(w, 0); r = await w.c._processWithdrawalNow('w1', 'auto');
  eq(r.code, 500); eq(w.calls, ['pesajet'], 'only ONE gateway was asked'); eq(w.row('w1').status, 'sending', 'left on Sending for a person / the lookup'); eq(w.user().totalWithdrawn, 0);
  w = world({ gw: { tavupay: down, obpay: down } }); turn(w, 1); r = await w.c._processWithdrawalNow('w1', 'auto');
  eq(w.calls, ['tavupay'], 'same for TavuPay'); eq(w.row('w1').status, 'sending'); eq(w.row('w1').payGw, 'tavupay');
  // HTTP 429 is "too many requests" = not taken: that is a clean refusal
  w = world({ gw: { tavupay: () => ({ ok: false, providerDown: true, httpStatus: 429, data: {} }) } }); turn(w, 1); r = await w.c._processWithdrawalNow('w1', 'auto');
  eq(r.code, 200); eq(w.calls[0], 'tavupay'); ok(w.calls.length === 2, '429 moves on to the next gateway');

  // ── only configured gateways are in the circle; none configured says so ──
  w = world({ configured: ['lworxpay', 'obpay'], count: 4 });
  for (let i = 1; i <= 4; i++) await w.c._processWithdrawalNow('w' + i, 'auto');
  eq(w.calls.slice().sort(), ['obpay', 'obpay', 'obpay', 'obpay'], 'unconfigured gateways are left out, and a configured LworxPay is still never used');
  w = world({ configured: [] }); r = await w.c._processWithdrawalNow('w1', 'auto'); eq(r.code, 400); ok(/No automatic payout gateway/.test(r.body.message)); eq(w.row('w1').status, 'pending');

  // ── a single pinned gateway behaves as before: no failover ──
  w = world({ mode: 'obpay', gw: { obpay: refuse('INSUFFICIENT_BALANCE', 'low') } }); r = await w.c._processWithdrawalNow('w1', 'auto');
  eq(r.code, 400); eq(w.calls, ['obpay'], 'pinned means pinned'); ok(/too little balance/.test(r.body.message)); eq(w.row('w1').status, 'pending');
  // LworxPay can no longer send: even if something asked for it, nothing is sent and the withdrawal falls through to nothing (never to MarzPay)
  w = world({ mode: 'lworxpay' }); r = await w.c._processWithdrawalNow('w1', 'auto');
  eq(r.code, 400); ok(/does not send payouts/.test(r.body.message), r.body.message); eq(w.calls, [], 'no gateway was called, MarzPay included'); eq(w.row('w1').status, 'pending'); eq(w.user().totalWithdrawn, 0);
  w = world({ mode: 'pesajet' }); r = await w.c._processWithdrawalNow('w1', 'auto'); eq(r.code, 200); eq(w.row('w1').pesajetTxId, 'PJ1', 'PesaJet keeps its own fields');
  w = world({ mode: 'marzpay' }); r = await w.c._processWithdrawalNow('w1', 'auto'); eq(r.code, 200); eq(w.row('w1').marzTxUuid, 'MZ1', 'MarzPay path unchanged');

  // ── what each gateway is sent ──
  let seen = {};
  w = world({ gw: {
    tavupay: o => { seen.tavupay = o.body; return { ok: true, providerDown: false, data: { data: { reference: 'T' } } }; },
    obpay: o => { seen.obpay = o.body; return { ok: true, providerDown: false, data: { data: { reference: 'x' } } }; } }, count: 3 });
  turn(w, 0); for (let i = 1; i <= 3; i++) await w.c._processWithdrawalNow('w' + i, 'auto');
  eq([seen.tavupay.type, seen.tavupay.amount, seen.tavupay.idempotencyKey], ['disbursement', 17000, 'w2'], 'TavuPay: a disbursement of the NET amount, id as idempotency key');
  eq([seen.obpay.amount, seen.obpay.currency, seen.obpay.phone_number, seen.obpay.customer_name, seen.obpay.reference], [17000, 'UGX', '256700000001', 'Jo Ann', 'w3'], 'ObPay /payouts body (the holder name is required)');

  // ── settling: success, failure with refund, and the lookup of a lost reply ──
  // A payout LworxPay took earlier (it sends no new ones) still finishes: seeded rows stand for those.
  const seedLworx = (w, status) => { w.db.rows.withdrawals.w1 = Object.assign({}, w.db.rows.withdrawals.w1, { status, payGw: 'lworxpay', payGwRef: 'w1', payGwTxId: 'LX1', sendingAt: new Date(Date.now() - 10 * 60 * 1000) }); if (status === 'processing') w.user().totalWithdrawn = 17000; };
  w = world({}); seedLworx(w, 'processing');
  let doc = await w.db.collection('withdrawals').doc('w1').get();
  eq(await w.c.payGwApplyPayout(doc, 'success', { amount: 17000 }), 'success'); eq(w.row('w1').status, 'processed'); eq(w.user().totalWithdrawn, 17000, 'a payout LworxPay took earlier still finishes, and success does not count twice');
  eq(await w.c.payGwApplyPayout(await w.db.collection('withdrawals').doc('w1').get(), 'failed'), 'ignored', 'a finished payout is never touched again');
  w = world({}); turn(w, 2); await w.c._processWithdrawalNow('w1', 'auto');                // ObPay
  doc = await w.db.collection('withdrawals').doc('w1').get(); w.user().walletBalance = 0;
  eq(await w.c.payGwApplyPayout(doc, 'failed'), 'failed'); eq(w.row('w1').status, 'declined'); eq(w.user().walletBalance, 20000, 'the member is refunded the full amount'); eq(w.user().totalWithdrawn, 0, 'and the payout is unwound from totalWithdrawn');
  // the reconciler reads accepted payouts at their gateway (ObPay's, and one LworxPay took earlier)
  w = world({ extra: { gatewayGetTx: async () => ({ status: 'success', amount: 17000 }) } }); turn(w, 2); await w.c._processWithdrawalNow('w1', 'auto');
  ok(await w.c.reconcileGatewayPayouts() === 1 && w.row('w1').status === 'processed', 'the reconciler settles an accepted payout from the live read');
  w = world({ extra: { gatewayGetTx: async () => ({ status: 'success', amount: 17000 }) } }); seedLworx(w, 'processing');
  ok(await w.c.reconcileGatewayPayouts() === 1 && w.row('w1').status === 'processed', 'and one LworxPay took earlier');
  w = world({ extra: { gatewayGetTx: async () => ({ providerDown: true }) } }); turn(w, 2); await w.c._processWithdrawalNow('w1', 'auto');
  eq(await w.c.reconcileGatewayPayouts(), 0); eq(w.row('w1').status, 'processing', 'a gateway that will not answer leaves it alone');
  // a lost reply is found again by OUR reference; a gateway with no such payout hands it back to Pending
  w = world({ gw: { obpay: down }, extra: { gatewayGetTx: async () => ({ status: 'success', amount: 17000 }) } }); turn(w, 2); await w.c._processWithdrawalNow('w1', 'auto');
  eq(w.row('w1').status, 'sending'); eq(await w.c.reconcileGatewayPayouts(), 1); eq(w.row('w1').status, 'processed'); eq(w.user().totalWithdrawn, 17000, 'recovered payout counted exactly once');
  w = world({ extra: { gatewayGetTx: async () => ({ status: 'success', amount: 17000 }) } }); seedLworx(w, 'sending');
  eq(await w.c.reconcileGatewayPayouts(), 1); eq(w.row('w1').status, 'processed'); eq(w.user().totalWithdrawn, 17000, 'a LworxPay payout left on Sending is recovered too, counted once');
  w = world({ gw: { obpay: down }, extra: { gatewayGetTx: async () => ({ unavailable: true, httpStatus: 404 }) } }); turn(w, 2); await w.c._processWithdrawalNow('w1', 'auto');
  await w.c.reconcileGatewayPayouts(); eq(w.row('w1').status, 'pending', 'no record at the gateway: never taken, back on Pending'); ok(!w.row('w1').payGw);
  w = world({ gw: { obpay: down }, extra: { gatewayGetTx: async () => ({ unavailable: true, httpStatus: 401 }) } }); turn(w, 2); await w.c._processWithdrawalNow('w1', 'auto');
  await w.c.reconcileGatewayPayouts(); eq(w.row('w1').status, 'sending', 'a gateway that refuses the question changes nothing');

  // ── wiring ──
  ok(/const PAYOUT_ROTATION = Object\.freeze\(\['pesajet', 'tavupay', 'obpay'\]\);/.test(src), 'LworxPay is not in the rotation');
  ok(!/send\(\{ wit, id \}\)[^]{0,400}_gwRequest\('lworxpay'/.test(src) && !/_gwRequest\('lworxpay', '\/payout'/.test(src), 'and its payout request is gone: nothing can send through it');
  ok(/w === 'rotate' \|\| w === 'lworxpay' \) \? 'rotate'/.test(src), 'a setting still saved as lworxpay is read as "all gateways in turn", never as MarzPay');
  ok(!/'tavupay', 'lworxpay', 'obpay', 'rotate'/.test(src), 'and it can no longer be saved as a withdrawal method');
  ok(/settled \+= await reconcileGatewayPayouts\(\)/.test(src), 'the periodic reconciler reads accepted payouts');
  ok(/payGwPayoutWebhookWork\(provider, wh\.refs/.test(src) && /payGwPayoutWebhookWork\('tavupay'/.test(src), 'payout webhooks look the payout up again');
  const adm = fs.readFileSync(__dirname + '/admin-src/index.html', 'utf8');
  ok(/value="rotate"/.test(adm) && /All gateways in turn/.test(adm) && !/witMethodLworx|value="lworxpay"/.test(adm), 'Admin > Settings > Withdrawals has "All gateways in turn" and no LworxPay option');
  console.log('PASS: payout rotation and failover (' + n + ' checks)');
})().catch(e => { console.error(e); process.exit(1); });
