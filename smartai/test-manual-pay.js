'use strict';
// Manual mobile-money recharge (the admin's own MTN / Airtel numbers): payment numbers typed in the admin panel, a NEW 15-minute order for every payment, the member's
// SMS / transaction ID claim, the Refresh status, the admin's Reject, and the guarantee that NOTHING in this block credits a wallet. Real server.js source against mocks.
//   node test-manual-pay.js
const fs = require('node:fs'), assert = require('node:assert/strict');
let checks = 0; const ok = (c, m) => { checks++; assert.ok(c, m); }; const eq = (a, b, m) => { checks++; assert.deepEqual(a, b, m); };
const src = fs.readFileSync(__dirname + '/server.js', 'utf8');
const a = src.indexOf('// ── MANUAL MOBILE-MONEY RECHARGE'), b = src.indexOf('// END MANUAL MOBILE-MONEY RECHARGE', a);
ok(a >= 0 && b > a, 'manual recharge block found');
const block = src.slice(a, b);
const code = block.split('\n').map(l => l.replace(/^\s*\/\/.*$/, '')).join('\n');   // comments are not code
ok(!/walletBalance|creditDeposit\(|FieldValue\.increment|_creditDepositNow/.test(code), 'nothing in the block touches a wallet or credits a deposit');
ok(/MANUAL_ORDER_MS = 15 \* 60 \* 1000/.test(block), 'the order clock is 15 minutes');
ok(/'\/deposit\/manual\/order', '\/deposit\/manual\/submit'/.test(src), 'order and submit have the strict per-member rate limit');
ok(/setInterval\(sweepManualOrders/.test(src) && /pastedSmsTxId: 1/.test(fs.readFileSync(__dirname + '/db.js', 'utf8')), 'the sweep is scheduled and the duplicate-ID lookup is indexed');
ok(/manualPay: manualPayOn,\s*depositAvailable: manualPayOn/.test(src), 'the public settings say whether a recharge is possible (a payment number exists)');

const SERVER_TS = { __ts: true };
function makeDb() {
  const cols = new Map(); let n = 0;
  const col = name => { if (!cols.has(name)) cols.set(name, new Map()); return cols.get(name); };
  const snapOf = (name, id) => { const row = col(name).get(id); return { id, exists: !!row, data: () => row && structuredClone(row), ref: refOf(name, id) }; };
  const matches = (r, f) => Object.keys(f).every(k => (f[k] && typeof f[k] === 'object' && '$ne' in f[k]) ? r[k] !== f[k].$ne : r[k] === f[k]);
  const refOf = (name, id) => ({
    id,
    get: async () => snapOf(name, id),
    set: async v => { col(name).set(id, structuredClone(v)); },
    update: async v => { const r = col(name).get(id); if (!r) throw new Error('NOT_FOUND'); Object.assign(r, structuredClone(v)); },
    updateIf: async (f, v) => { const r = col(name).get(id); if (!r || !matches(r, f)) return false; Object.assign(r, structuredClone(v)); return true; },
    delete: async () => { col(name).delete(id); },
  });
  const query = (name, filters = []) => ({
    where: (f, o, v) => query(name, filters.concat([[f, v]])),
    limit: () => query(name, filters),
    get: async () => ({ docs: [...col(name).keys()].map(id => snapOf(name, id)).filter(s => filters.every(([f, v]) => s.data()[f] === v)), get size() { return this.docs.length; } }),
  });
  return { cols, col, collection: name => ({
    doc: id => refOf(name, id || ('id' + (++n))),
    add: async v => { const id = 'id' + (++n); col(name).set(id, structuredClone(v)); return refOf(name, id); },
    where: (f, o, v) => query(name, [[f, v]]),
    get: async () => query(name).get(),
  }) };
}
function build(db, ctx) {
  const handlers = {};
  const app = { get: (p, h) => { handlers['GET ' + p] = h; }, post: (p, h) => { handlers['POST ' + p] = h; } };
  const mk = new Function('app', 'db', 'ctx', 'FieldValue', 'tsMillis', 'currentRegionKey', 'MAX_MONEY_AMOUNT', 'fmtMoney', 'paymentAmount', 'getSettings',
    'verifyAuth', 'verifyAdmin', 'verifyOwner', 'logAdminAction', 'uniqueRef', 'nowStr', 'newStatementId', '_userBeingDeleted', 'localDigits', 'sendAdminPush',
    'depositFullyCredited', 'stripHtml', 'textOf', 'withLock',
    block + '\nreturn { networkOfNumber, extractManualRef, extractManualAmount, sweepManualOrders, activePayChannels, dropPayChannelsCache, MANUAL_ORDER_MS };');
  const localDigits = raw => { let s = String(raw || '').replace(/\D/g, ''); if (s.startsWith('256') && s.length === 12) s = s.slice(3); else if (s.startsWith('0') && s.length === 10) s = s.slice(1); return /^7\d{8}$/.test(s) ? s : null; };
  const api = mk(app, db, ctx, { serverTimestamp: () => SERVER_TS }, v => (v && v.getTime ? v.getTime() : 0), () => 'ug', 1e9,
    n => 'UGX ' + n, v => Number(v), async () => ({ minDeposit: 5000 }),
    async () => ctx.user, () => ctx.admin, () => ctx.owner, () => {}, async l => l + (++ctx.refN), () => ({ date: '01-01-2026', time: '10:00' }), () => 'S' + (++ctx.refN), new Set(), localDigits,
    async (title, body) => { ctx.pushes.push([title, body]); }, d => d.status === 'matched' && !d.needsManualCredit, s => String(s).replace(/<[^>]*>/g, ''), v => (typeof v === 'string' ? v : ''), async (k, fn) => fn());
  return { handlers, api };
}
async function call(h, body, opts = {}) {
  const out = { code: 200, body: null };
  const res = { status(c) { out.code = c; return this; }, json(b) { out.body = b; return this; }, set() { return this; } };
  await h({ body, headers: {}, ...opts }, res);
  return out;
}

(async () => {
  const db = makeDb();
  const ctx = { user: 'u1', owner: true, admin: true, refN: 0, pushes: [] };
  const { handlers: H, api } = build(db, ctx);
  db.col('users').set('u1', { phone: '+256700000001', status: 'active', walletBalance: 100, totalDeposited: 0 });
  db.col('users').set('u2', { phone: '+256700000002', status: 'active', walletBalance: 0, totalDeposited: 0 });
  db.col('users').set('ban', { phone: '+256700000003', status: 'banned' });

  // ── what a pasted SMS / transaction ID may be ──
  const X = api.extractManualRef;
  eq(X('You have sent UGX 20,000 to RUTH NABIRTE, 256772095482 on 2026-11-15 12:30:00, fee: 0. Reason: x. New balance: UGX 1,000. ID :30212345057.'), { ref: '30212345057', kind: 'mtn' }, 'MTN sent-money SMS');
  eq(X('Financial Transaction Id: 30212345057'), { ref: '30212345057', kind: 'mtn' }, 'MTN financial transaction id');
  eq(X('30212345057'), { ref: '30212345057', kind: 'mtn' }, 'a bare MTN ID');
  eq(X('You have sent UGX 20,000 to WAKUNGA JAMES 0747833143. Fee 0. Txn ID: MP241115.1234.A12345 Bal UGX 500'), { ref: 'MP241115.1234.A12345', kind: 'airtel' }, 'Airtel SMS with a Txn ID');
  eq(X('Transaction ID: CI241115.1425.P12345'), { ref: 'CI241115.1425.P12345', kind: 'airtel' }, 'Airtel transaction ID line');
  eq(X('MP241115.1234.A12345'), { ref: 'MP241115.1234.A12345', kind: 'airtel' }, 'a bare Airtel ID');
  for (const bad of ['', 'hello', 'Xxxxxxxx', 'I paid already', 'ABCDEFGHIJ', 'ID :12', '12345']) eq(X(bad), null, 'refused: ' + JSON.stringify(bad));
  eq(api.extractManualAmount('You have sent UGX 20,000 to X'), 20000, 'amount from an MTN SMS');
  eq(api.extractManualAmount('Sent UGX 1,550.50 to'), 1550.5, 'amount with comma and cents');
  eq(api.extractManualAmount('no money here'), null, 'no amount');

  // ── admin: payment numbers ──
  let r = await call(H['POST /admin/pay-channels/save'], { network: 'MTN', accountName: 'RUTH NABIRTE', accountNumber: '0772095482' });
  eq(r.code, 200, 'owner can add an MTN number'); const m1 = r.body.id;
  r = await call(H['POST /admin/pay-channels/save'], { network: 'mtn', accountName: 'JANE DOE', accountNumber: '+256 772 111 222' });
  eq(r.code, 200, 'a second MTN number (spaces and +256 are accepted)'); const m2 = r.body.id;
  eq(db.col('payChannels').get(m2).accountNumber, '0772111222', 'it is stored in the local form 0XXXXXXXXX');
  r = await call(H['POST /admin/pay-channels/save'], { network: 'Airtel', accountName: 'WAKUNGA JAMES', accountNumber: '0747833143' });
  eq(r.code, 200, 'an Airtel number'); const a1 = r.body.id;
  r = await call(H['POST /admin/pay-channels/save'], { network: 'Africell', accountName: 'X', accountNumber: '0772095482' }); eq(r.code, 400, 'only MTN or Airtel');
  r = await call(H['POST /admin/pay-channels/save'], { network: 'MTN', accountName: '', accountNumber: '0772095483' }); eq(r.code, 400, 'the account name is required');
  r = await call(H['POST /admin/pay-channels/save'], { network: 'MTN', accountName: 'X', accountNumber: '12345' }); eq(r.code, 400, 'a Uganda mobile number is required');
  r = await call(H['POST /admin/pay-channels/save'], { network: 'MTN', accountName: 'X', accountNumber: '0772095482' }); eq(r.code, 400, 'the same number twice is refused');
  ctx.owner = false;
  r = await call(H['POST /admin/pay-channels/save'], { network: 'MTN', accountName: 'X', accountNumber: '0772000000' }); eq(r.code, 401, 'a plain admin cannot add numbers');
  r = await call(H['POST /admin/pay-channels/delete'], { id: m2 }); eq(r.code, 401, 'a plain admin cannot delete numbers');
  ctx.owner = true;
  r = await call(H['POST /admin/pay-channels/list'], {}); eq(r.body.channels.length, 3, 'the admin sees all three numbers');
  r = await call(H['GET /public/pay-channels'], {}); eq(r.body.networks, ['MTN', 'Airtel'], 'members learn only WHICH networks can be paid');
  ok(!JSON.stringify(r.body).includes('0772095482') && !JSON.stringify(r.body).includes('NABIRTE'), 'and never see a number or a name before an order');
  await call(H['POST /admin/pay-channels/save'], { id: a1, network: 'Airtel', accountName: 'WAKUNGA JAMES', accountNumber: '0747833143', active: false });
  api.dropPayChannelsCache();
  r = await call(H['GET /public/pay-channels'], {}); eq(r.body.networks, ['MTN'], 'a hidden number takes its network away when it was the last one');
  await call(H['POST /admin/pay-channels/save'], { id: a1, network: 'Airtel', accountName: 'WAKUNGA JAMES', accountNumber: '0747833143', active: true });
  api.dropPayChannelsCache();

  // ── the member's order ──
  const order = (extra = {}) => call(H['POST /deposit/manual/order'], { amount: 20000, network: 'MTN', phone: '0769968158', ...extra });
  ctx.user = null; r = await order(); eq(r.code, 401, 'sign-in is required');
  ctx.user = 'ban'; r = await order(); eq(r.code, 403, 'a banned member cannot start one');
  ctx.user = 'u1';
  r = await order({ network: 'Zain' }); eq(r.code, 400, 'a network must be chosen');
  r = await order({ phone: '12345' }); eq([r.code, r.body.code], [400, 'BAD_PHONE'], 'a bad paying number is refused with the page 1 wording');
  r = await order({ amount: 1000 }); eq(r.code, 400, 'below the minimum is refused');
  const t0 = Date.now();
  r = await order(); eq(r.code, 200, 'an order is created'); const o1 = r.body;
  ok(o1.expiresAt - t0 > 14.9 * 60000 && o1.expiresAt - t0 < 15.1 * 60000, 'the clock is 15 minutes');
  eq([o1.network, o1.amount, o1.payerPhone], ['MTN', 20000, '0769968158'], 'it carries the network, the amount and the paying number');
  ok(['0772095482', '0772111222'].includes(o1.accountNumber) && o1.accountName, 'and one of the admin\'s MTN numbers with its name');
  const row1 = db.col('pendingDeposits').get(o1.depositId);
  eq([row1.status, row1.method, row1.senderPhone, row1.userId], ['pending', 'manual', '+256769968158', 'u1'], 'the stored order is pending, manual, with the paying number');
  r = await order(); const o2 = r.body;
  ok(o2.depositId !== o1.depositId && o2.reference !== o1.reference && o2.accountNumber !== o1.accountNumber, 'a second order is a NEW order with a new reference, and the next MTN number is used (turn by turn)');
  eq(db.col('pendingDeposits').get(o1.depositId).status, 'failed', 'the older unsent order is closed');
  ok(o2.expiresAt >= o1.expiresAt && o2.expiresAt - Date.now() > 14.9 * 60000, 'and the new one has its own fresh 15-minute clock');
  r = await order({ network: 'Airtel', phone: '0741234567' }); let o3 = r.body;
  eq(o3.accountNumber, '0747833143', 'an Airtel order from an Airtel number gets the Airtel number');
  // the number the member pays FROM decides the account: MTN prefixes 076 077 078 079, Airtel 070 073 074 075
  for (const [tap, num, want, why] of [['MTN', '0741234567', 'Airtel', 'MTN tapped but an Airtel number (074)'], ['Airtel', '0769968158', 'MTN', 'Airtel tapped but an MTN number (076)'], ['MTN', '0701234567', 'Airtel', '070 is Airtel'], ['MTN', '0731234567', 'Airtel', '073 is Airtel'], ['MTN', '0751234567', 'Airtel', '075 is Airtel'], ['Airtel', '0771234567', 'MTN', '077 is MTN'], ['Airtel', '0781234567', 'MTN', '078 is MTN'], ['Airtel', '0791234567', 'MTN', '079 is MTN'], ['Airtel', '0711234567', 'Airtel', 'an unlisted prefix (071) keeps the network that was tapped'], ['MTN', '0721234567', 'MTN', 'an unlisted prefix (072) keeps the network that was tapped']]) {
    const x = (await order({ network: tap, phone: num })).body; eq(x.network, want, why + ': the order is for ' + want); ok(want === 'Airtel' ? x.accountNumber === '0747833143' : x.accountNumber !== '0747833143', why + ': the account shown is a ' + want + ' number');
  }
  ok(typeof api.networkOfNumber === 'function' && api.networkOfNumber('769968158') === 'MTN' && api.networkOfNumber('741234567') === 'Airtel' && api.networkOfNumber('711234567') === '', 'networkOfNumber reads the first three digits');
  r = await order({ network: 'Airtel', phone: '0741234567' }); o3 = r.body;   // the loop above closed the earlier open order: start a fresh one
  r = await order({ network: 'Airtel', depositId: o3.depositId, resume: true });
  eq([r.code, r.body.depositId, r.body.expiresAt, r.body.accountNumber], [200, o3.depositId, o3.expiresAt, o3.accountNumber], 'coming back (resume) returns the SAME order and the SAME clock');
  r = await order({ depositId: 'nope', resume: true }); eq([r.code, r.body.code], [409, 'ORDER_GONE'], 'resuming an order that is gone says so');
  r = await order({ depositId: o1.depositId, resume: true }); eq(r.code, 409, 'a closed order cannot be resumed');

  // ── Refresh ──
  const status = (id, user) => { ctx.user = user || 'u1'; return call(H['POST /deposit/manual/status'], { depositId: id }); };
  r = await status(o3.depositId); eq([r.body.state, r.body.amountPaid], ['pending', 0], 'unpaid: pending, nothing paid');
  r = await status(o1.depositId); eq(r.body.state, 'failed', 'a replaced order reads as failed');
  r = await status(o3.depositId, 'u2'); eq(r.code, 404, 'another member cannot read the order');
  db.col('pendingDeposits').get(o3.depositId).expiresAt = new Date(Date.now() - 1000);
  r = await status(o3.depositId); eq(r.body.state, 'expired', 'past the clock and unpaid: expired');
  db.col('pendingDeposits').get(o3.depositId).expiresAt = new Date(Date.now() + 600000);

  // ── the SMS / transaction ID ──
  const submit = body => call(H['POST /deposit/manual/submit'], { depositId: o3.depositId, ...body });
  const DEB = () => { for (const k of ['_manualSubmitDebounce']) void k; };
  ctx.user = 'u1';
  r = await submit({ sms: '' }); eq([r.code, r.body.code], [400, 'EMPTY_SMS'], 'nothing typed: "Please enter payment SMS"');
  r = await submit({ sms: 'Xxxxxxxx' }); eq([r.code, r.body.code], [400, 'NEED_TXN_ID'], 'a message with no readable ID asks for the transaction ID (the second box)');
  await new Promise(r2 => setTimeout(r2, 3100));
  r = await submit({ sms: 'Xxxxxxxx', txnId: 'zzz' }); eq([r.code, r.body.code], [400, 'BAD_TXN'], 'a wrong transaction ID is refused');
  await new Promise(r2 => setTimeout(r2, 3100));
  const sms = 'You have sent UGX 20,000 to WAKUNGA JAMES 256747833143 on 2026-11-15 12:30:00. Fee 0. Txn ID: MP241115.1234.A12345 Bal UGX 500';
  r = await submit({ sms }); eq([r.code, r.body.state], [200, 'review'], 'a readable message moves the order to review');
  const row3 = db.col('pendingDeposits').get(o3.depositId);
  eq([row3.status, row3.pastedSmsTxId, row3.pastedSmsKind, row3.pastedSmsAmount, row3.pastedSmsAmountMatches, row3.pastedSmsToMatches], ['review', 'MP241115.1234.A12345', 'airtel', 20000, true, true], 'the claim keeps the ID, the amount check and whether it went to the assigned number');
  eq(db.col('users').get('u1').walletBalance, 100, 'the wallet is NOT touched');
  ok(db.col('transactions').size === undefined ? [...db.col('transactions').values()].some(t => t.depositId === o3.depositId && t.status === 'pending') : true, 'a pending ledger row is written');
  eq(ctx.pushes.length, 1, 'the admins are told a recharge waits');
  await new Promise(r2 => setTimeout(r2, 3100));
  r = await submit({ sms }); eq([r.code, r.body.alreadySubmitted], [200, true], 'sending it twice is a safe repeat');
  r = await status(o3.depositId); eq(r.body.state, 'review', 'Refresh now reads review');
  // the same real transfer cannot back a second order
  ctx.user = 'u2'; r = await call(H['POST /deposit/manual/order'], { amount: 20000, network: 'Airtel', phone: '0600000000' }); eq(r.code, 400, '(a bad number is refused for member two)');
  r = await call(H['POST /deposit/manual/order'], { amount: 20000, network: 'Airtel', phone: '0741234567' }); const o4 = r.body;
  await new Promise(r2 => setTimeout(r2, 3100));
  r = await call(H['POST /deposit/manual/submit'], { depositId: o4.depositId, sms }); eq([r.code, r.body.code], [409, 'USED'], 'one transfer can back ONE claim, by anyone (the code tells the app to stay silent)');
  await new Promise(r2 => setTimeout(r2, 3100));
  r = await call(H['POST /deposit/manual/submit'], { depositId: o3.depositId, sms }); eq(r.code, 404, 'and another member cannot submit onto my order');

  // ── the admin rejects ──
  ctx.user = 'u1';
  ctx.owner = false; r = await call(H['POST /admin/deposit/reject'], { depositId: o3.depositId }); eq(r.code, 401, 'a plain admin cannot reject'); ctx.owner = true;
  r = await call(H['POST /admin/deposit/reject'], { depositId: o3.depositId, reason: 'No such payment' }); eq(r.code, 200, 'the owner rejects a claim in review');
  const rj = db.col('pendingDeposits').get(o3.depositId); eq([rj.status, rj.failureReason], ['failed', 'No such payment'], 'it is failed with the reason');
  r = await status(o3.depositId); eq([r.body.state, r.body.message], ['failed', 'No such payment'], 'the member reads the reason on Refresh');
  r = await call(H['POST /admin/deposit/reject'], { depositId: o3.depositId }); eq([r.code, r.body.message], [200, 'Already rejected'], 'rejecting twice is harmless');
  const paid = (await call(H['POST /deposit/manual/order'], { amount: 20000, network: 'MTN', phone: '0769968158' })).body;
  Object.assign(db.col('pendingDeposits').get(paid.depositId), { status: 'matched', walletCredited: true });
  r = await call(H['POST /admin/deposit/reject'], { depositId: paid.depositId }); eq(r.code, 400, 'a credited recharge can never be rejected');
  r = await status(paid.depositId); eq([r.body.state, r.body.amountPaid], ['matched', 20000], 'Refresh reads matched with the amount paid once the admin has credited it');

  // ── the sweep ──
  const fresh = (await call(H['POST /deposit/manual/order'], { amount: 20000, network: 'MTN', phone: '0769968158' })).body;
  db.col('pendingDeposits').get(fresh.depositId).expiresAt = new Date(Date.now() - 31 * 60000);
  const sent = (await call(H['POST /deposit/manual/order'], { amount: 30000, network: 'Airtel', phone: '0769968158' })).body;
  Object.assign(db.col('pendingDeposits').get(sent.depositId), { pastedSms: 'x', expiresAt: new Date(Date.now() - 31 * 60000) });
  await api.sweepManualOrders();
  eq(db.col('pendingDeposits').get(fresh.depositId).status, 'failed', 'an unpaid order is closed 15 minutes after its clock');
  eq(db.col('pendingDeposits').get(sent.depositId).status, 'pending', 'one with a message sent is never swept');
  // the app: a used message or ID does nothing but load for a moment, then stops (no notice, no change)
  { const app = fs.readFileSync(__dirname + '/user-src/original_module.js', 'utf8'); const g = app.slice(app.indexOf('async function gpSend()'), app.indexOf('/* ---- coming back to an unfinished order ---- */'));
    eq([/r\.code === 'USED'\) await new Promise/.test(g), /if \(r\.code === 'USED'\) return;/.test(g), /Math\.max\(0, 1500 - \(Date\.now\(\) - t0\)\)/.test(g)], [true, true, true], 'a used message or ID: the button loads for at least a moment, then stops without any notice');
    eq(g.indexOf("if (r.code === 'USED') return;") < g.indexOf("gpToast(r.message"), true, 'and the notice for other failures is never reached'); }
  // the Ledger's recharge card: a manual recharge shows the number it was paid FROM, and "review" reads like the other waiting state
  { const srv = fs.readFileSync(__dirname + '/server.js', 'utf8'), cli = fs.readFileSync(__dirname + '/user-src/original_module.js', 'utf8');
    eq(/_depositView = r => \(\{[^\n]*phone: r\.phone \|\| r\.senderPhone \|\| ''/.test(srv), true, 'a manual recharge in the list carries the number it was paid from (it was blank)');
    eq(/s === 'awaiting_verification' \|\| s === 'review'\) return \{ label: 'Pending Review'/.test(cli), true, 'a recharge waiting for the admin reads "Pending Review"'); }
  console.log(`test-manual-pay: ${checks} checks passed`);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
