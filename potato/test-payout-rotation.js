'use strict';
// Withdrawals through all four gateways in turn (Admin > Settings > Withdrawals > "All gateways in turn"):
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
  // ── even round robin: 8 withdrawals, each of the four gateways takes exactly two ──
  let w = world({ count: 8 });
  for (let i = 1; i <= 8; i++) { const r = await w.c._processWithdrawalNow('w' + i, 'auto'); eq(r.code, 200, 'w' + i + ' sent: ' + JSON.stringify(r.body)); }
  const tally = {}; w.calls.forEach(g => tally[g] = (tally[g] || 0) + 1);
  eq(Object.keys(tally).sort(), ['lworxpay', 'obpay', 'pesajet', 'tavupay'], 'all four gateways were used'); eq(Object.values(tally), [2, 2, 2, 2], 'evenly: two each: ' + JSON.stringify(tally));
  ok(!w.calls.includes('marzpay'), 'MarzPay is not part of the rotation');
  eq(w.user().totalWithdrawn, 8 * 17000, 'totalWithdrawn counted once per payout');
  // fields stored by the generic gateways
  const gwRows = Object.values(w.db.rows.withdrawals).filter(r => r.payGw);
  ok(gwRows.length === 6 && gwRows.every(r => r.payGwRef && r.payGwTxId && r.status === 'processing'), 'TavuPay/LworxPay/ObPay payouts record payGw, payGwRef, payGwTxId and sit on processing');
  eq(gwRows.map(r => r.payGwRef).sort(), Object.keys(w.db.rows.withdrawals).filter(id => w.row(id).payGw).sort(), 'our reference is the withdrawal id');

  // ── failover: the first gateway refuses cleanly, the next one sends it, nothing is paid twice ──
  w = world({ gw: { pesajet: () => ({ ok: false, providerDown: false, httpStatus: 400, data: { message: 'no float' } }), tavupay: refuse('INSUFFICIENT_BALANCE', 'x'), lworxpay: refuse('INSUFFICIENT_BALANCE', 'low') } });
  turn(w, 0);                      // start the circle at PesaJet
  let r = await w.c._processWithdrawalNow('w1', 'auto');
  eq(r.code, 200); eq(w.calls, ['pesajet', 'tavupay', 'lworxpay', 'obpay'], 'tried in turn until one took it'); eq(w.row('w1').payGw, 'obpay'); eq(w.row('w1').status, 'processing');
  eq(w.user().totalWithdrawn, 17000, 'paid once');
  // refused gateways are skipped for the next withdrawals (5 minutes), so they do not queue behind them
  const w2 = world({ count: 2, gw: { pesajet: () => ({ ok: false, providerDown: false, httpStatus: 400, data: {} }) } });
  turn(w2, 0); await w2.c._processWithdrawalNow('w1', 'a'); const first = w2.calls.length; await w2.c._processWithdrawalNow('w2', 'a');
  ok(!w2.calls.slice(first).includes('pesajet'), 'a gateway that just refused is skipped for the next withdrawal');

  // ── every gateway refuses: stays pending, untouched, says why for each ──
  w = world({ gw: { pesajet: () => ({ ok: false, providerDown: false, httpStatus: 400, data: { message: 'a' } }), tavupay: refuse('X', 'b'), lworxpay: refuse('INSUFFICIENT_BALANCE', 'c'), obpay: refuse('X', 'd') } });
  r = await w.c._processWithdrawalNow('w1', 'auto');
  eq(r.code, 400); ok(/Every payout gateway refused/.test(r.body.message) && /LworxPay/.test(r.body.message) && /too little balance/.test(r.body.message), r.body.message);
  eq(w.row('w1').status, 'pending'); ok(!w.row('w1').payGw && !w.row('w1').sendingReference, 'back on Pending with no gateway marks'); eq(w.user().totalWithdrawn, 0);

  // ── a LOST REPLY is never handed on: it stays on Sending and no other gateway is called ──
  w = world({ gw: { pesajet: () => ({ ok: false, providerDown: true, httpStatus: 0, data: { message: 'timeout' } }), tavupay: down, lworxpay: down, obpay: down } });
  turn(w, 0); r = await w.c._processWithdrawalNow('w1', 'auto');
  eq(r.code, 500); eq(w.calls, ['pesajet'], 'only ONE gateway was asked'); eq(w.row('w1').status, 'sending', 'left on Sending for a person / the lookup'); eq(w.user().totalWithdrawn, 0);
  w = world({ gw: { tavupay: down, lworxpay: down, obpay: down } }); turn(w, 1); r = await w.c._processWithdrawalNow('w1', 'auto');
  eq(w.calls, ['tavupay'], 'same for TavuPay'); eq(w.row('w1').status, 'sending'); eq(w.row('w1').payGw, 'tavupay');
  // HTTP 429 is "too many requests" = not taken: that is a clean refusal
  w = world({ gw: { tavupay: () => ({ ok: false, providerDown: true, httpStatus: 429, data: {} }) } }); turn(w, 1); r = await w.c._processWithdrawalNow('w1', 'auto');
  eq(r.code, 200); eq(w.calls[0], 'tavupay'); ok(w.calls.length === 2, '429 moves on to the next gateway');

  // ── only configured gateways are in the circle; none configured says so ──
  w = world({ configured: ['lworxpay', 'obpay'], count: 4 });
  for (let i = 1; i <= 4; i++) await w.c._processWithdrawalNow('w' + i, 'auto');
  eq(w.calls.slice().sort(), ['lworxpay', 'lworxpay', 'obpay', 'obpay'], 'unconfigured gateways are left out');
  w = world({ configured: [] }); r = await w.c._processWithdrawalNow('w1', 'auto'); eq(r.code, 400); ok(/No automatic payout gateway/.test(r.body.message)); eq(w.row('w1').status, 'pending');

  // ── a single pinned gateway behaves as before: no failover ──
  w = world({ mode: 'lworxpay', gw: { lworxpay: refuse('INSUFFICIENT_BALANCE', 'low') } }); r = await w.c._processWithdrawalNow('w1', 'auto');
  eq(r.code, 400); eq(w.calls, ['lworxpay'], 'pinned means pinned'); ok(/too little balance/.test(r.body.message)); eq(w.row('w1').status, 'pending');
  w = world({ mode: 'pesajet' }); r = await w.c._processWithdrawalNow('w1', 'auto'); eq(r.code, 200); eq(w.row('w1').pesajetTxId, 'PJ1', 'PesaJet keeps its own fields');
  w = world({ mode: 'marzpay' }); r = await w.c._processWithdrawalNow('w1', 'auto'); eq(r.code, 200); eq(w.row('w1').marzTxUuid, 'MZ1', 'MarzPay path unchanged');

  // ── what each gateway is sent ──
  let seen = {};
  w = world({ gw: {
    tavupay: o => { seen.tavupay = o.body; return { ok: true, providerDown: false, data: { data: { reference: 'T' } } }; },
    lworxpay: o => { seen.lworxpay = o.body; return { ok: true, providerDown: false, data: { data: { transaction_id: 'L' } } }; },
    obpay: o => { seen.obpay = o.body; return { ok: true, providerDown: false, data: { data: { reference: 'x' } } }; } }, count: 4 });
  turn(w, 0); for (let i = 1; i <= 4; i++) await w.c._processWithdrawalNow('w' + i, 'auto');
  eq([seen.tavupay.type, seen.tavupay.amount, seen.tavupay.idempotencyKey], ['disbursement', 17000, 'w2'], 'TavuPay: a disbursement of the NET amount, id as idempotency key');
  eq([seen.lworxpay.amount, seen.lworxpay.phone, seen.lworxpay.reference, !!seen.lworxpay.callback_url], [17000, '256700000001', 'w3', true], 'LworxPay /payout body');
  eq([seen.obpay.amount, seen.obpay.currency, seen.obpay.phone_number, seen.obpay.customer_name, seen.obpay.reference], [17000, 'UGX', '256700000001', 'Jo Ann', 'w4'], 'ObPay /payouts body (the holder name is required)');

  // ── settling: success, failure with refund, and the lookup of a lost reply ──
  w = world({ gw: {} }); turn(w, 2); await w.c._processWithdrawalNow('w1', 'auto');       // LworxPay
  let doc = await w.db.collection('withdrawals').doc('w1').get();
  eq(await w.c.payGwApplyPayout(doc, 'success', { amount: 17000 }), 'success'); eq(w.row('w1').status, 'processed'); eq(w.user().totalWithdrawn, 17000, 'success does not count twice');
  eq(await w.c.payGwApplyPayout(await w.db.collection('withdrawals').doc('w1').get(), 'failed'), 'ignored', 'a finished payout is never touched again');
  w = world({}); turn(w, 3); await w.c._processWithdrawalNow('w1', 'auto');                // ObPay
  doc = await w.db.collection('withdrawals').doc('w1').get(); w.user().walletBalance = 0;
  eq(await w.c.payGwApplyPayout(doc, 'failed'), 'failed'); eq(w.row('w1').status, 'declined'); eq(w.user().walletBalance, 20000, 'the member is refunded the full amount'); eq(w.user().totalWithdrawn, 0, 'and the payout is unwound from totalWithdrawn');
  // the reconciler reads accepted payouts at their gateway
  w = world({ extra: { gatewayGetTx: async () => ({ status: 'success', amount: 17000 }) } }); turn(w, 2); await w.c._processWithdrawalNow('w1', 'auto');
  ok(await w.c.reconcileGatewayPayouts() === 1 && w.row('w1').status === 'processed', 'the reconciler settles an accepted payout from the live read');
  w = world({ extra: { gatewayGetTx: async () => ({ providerDown: true }) } }); turn(w, 2); await w.c._processWithdrawalNow('w1', 'auto');
  eq(await w.c.reconcileGatewayPayouts(), 0); eq(w.row('w1').status, 'processing', 'a gateway that will not answer leaves it alone');
  // a lost reply on LworxPay is found again by OUR reference; a gateway with no such payout hands it back to Pending
  w = world({ gw: { lworxpay: down }, extra: { gatewayGetTx: async () => ({ status: 'success', amount: 17000 }) } }); turn(w, 2); await w.c._processWithdrawalNow('w1', 'auto');
  eq(w.row('w1').status, 'sending'); eq(await w.c.reconcileGatewayPayouts(), 1); eq(w.row('w1').status, 'processed'); eq(w.user().totalWithdrawn, 17000, 'recovered payout counted exactly once');
  w = world({ gw: { lworxpay: down }, extra: { gatewayGetTx: async () => ({ unavailable: true, httpStatus: 404 }) } }); turn(w, 2); await w.c._processWithdrawalNow('w1', 'auto');
  await w.c.reconcileGatewayPayouts(); eq(w.row('w1').status, 'pending', 'no record at the gateway: never taken, back on Pending'); ok(!w.row('w1').payGw);
  w = world({ gw: { lworxpay: down }, extra: { gatewayGetTx: async () => ({ unavailable: true, httpStatus: 401 }) } }); turn(w, 2); await w.c._processWithdrawalNow('w1', 'auto');
  await w.c.reconcileGatewayPayouts(); eq(w.row('w1').status, 'sending', 'a gateway that refuses the question changes nothing');

  // ── wiring ──
  ok(/'rotate'/.test(src) && /w === 'rotate' \|\| w === 'tavupay'/.test(src), 'withdrawProvider knows rotate and the pinned gateways');
  ok(/settled \+= await reconcileGatewayPayouts\(\)/.test(src), 'the periodic reconciler reads accepted payouts');
  ok(/payGwPayoutWebhookWork\(provider, wh\.refs/.test(src) && /payGwPayoutWebhookWork\('tavupay'/.test(src), 'payout webhooks of all three look the payout up again');
  const adm = fs.readFileSync(__dirname + '/admin-src/index.html', 'utf8');
  ok(/value="rotate"/.test(adm) && /All gateways in turn/.test(adm), 'Admin > Settings > Withdrawals has "All gateways in turn"');
  console.log('PASS: payout rotation and failover (' + n + ' checks)');
})().catch(e => { console.error(e); process.exit(1); });
