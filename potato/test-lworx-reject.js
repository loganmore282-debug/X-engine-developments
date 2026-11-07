'use strict';
// Stuck LworxPay payouts can be rejected (after the owner confirms); a completed one never; a late completion is flagged.
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const src = fs.readFileSync(__dirname + '/server.js', 'utf8');
const section = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i + a.length); assert(i >= 0 && j > i, 'anchor ' + a); return src.slice(i, j); };
const t0 = fs.readFileSync(__dirname + '/test-audit-money-regressions.js', 'utf8');
const { FV, makeDb } = new Function('structuredClone', 'assert', t0.slice(t0.indexOf('const FV = {'), t0.indexOf('function response()')) + '\nreturn { FV, makeDb };')(structuredClone, assert);
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); }; const eq = (a, b, m) => { n++; assert.deepEqual(a, b, m); };
function world(wit, readReply) {
  const db = makeDb({ users: { u: { walletBalance: 0, totalWithdrawn: wit.status === 'processing' ? 17000 : 0 } }, withdrawals: { w1: Object.assign({ userId: 'u', amount: 20000, net: 17000, payGw: 'lworxpay', payGwRef: 'w1', payGwTxId: 'LX1', createdAt: new Date() }, wit) }, transactions: { tx: { withdrawalId: 'w1', status: 'processing' } } });
  const routes = {}; const reads = [];
  const c = vm.createContext({ db, FieldValue: FV, crypto, Date, Math, Map, Set, Number, String, console: { log() {}, warn() {}, error(...a) { c._errors.push(a.join(' ')); } }, _errors: [],
    app: { post: (p, h) => { routes[p] = h; }, get() {} }, _lockTails: new Map(), _withdrawInFlight: new Set(), verifyOwner: () => true, stripHtml: x => String(x), textOf: x => String(x || ''), logAdminAction() {},
    tsMillis: v => (v instanceof Date ? v.getTime() : Number(v) || 0), finalizeWithdrawalTransactionRecord: async () => {}, PAYOUT_NAMES: { lworxpay: 'LworxPay' },
    PAYOUT_ADAPTERS: { lworxpay: { read: async () => { reads.push(1); const r = typeof readReply === 'function' ? readReply() : readReply; if (r instanceof Error) throw r; return r; } } },
    pesajetGetTx: async () => ({}), pesajetFindByReference: async () => ({}), marzGetSendStatus: async () => '', FAILED_STATUSES: new Set(['failed']) });
  vm.runInContext(section('function withLock(key, fn)', 'const _userBeingDeleted'), c);
  vm.runInContext(section('async function completeWithdrawalRefund(', 'async function markWithdrawalProcessed('), c);
  vm.runInContext(section('async function payoutRejectGuard(', "app.get('/admin/stats'"), c);
  vm.runInContext(section('async function watchRejectedLworxPayouts()', 'async function processWithdrawalCore('), c);
  const call = async (body) => { const res = { code: 200, status(x) { this.code = x; return this; }, json(b) { this.body = b; return this; } }; await routes['/admin/withdraw/reject']({ body, adminUser: { username: 'o' } }, res); return res; };
  return { call, db, c, row: () => db.rows.withdrawals.w1, user: () => db.rows.users.u, reads };
}
(async () => {
  // pending at LworxPay: refused first, with the reason and a request to confirm; nothing refunded
  let w = world({ status: 'processing' }, { status: 'processing', rawStatus: 'pending' });
  let r = await w.call({ withdrawalId: 'w1', reason: 'x' });
  eq([r.code, r.body.needsConfirm], [409, true]); ok(/LworxPay shows this payout as pending/.test(r.body.message) && /paid twice/.test(r.body.message), r.body.message);
  eq([w.row().status, w.user().walletBalance], ['processing', 0], 'not rejected, not refunded');
  // confirmed: rejected, refunded in full, payout unwound, watched
  r = await w.call({ withdrawalId: 'w1', reason: 'LworxPay removed', confirmPending: true });
  eq([r.code, r.body.status], [200, 'success']); eq([w.row().status, w.row().rejectedWhilePending], ['declined', true]); eq(w.user().walletBalance, 20000, 'the member is refunded the full amount'); eq(w.user().totalWithdrawn, 0, 'and the payout is unwound from totalWithdrawn');
  // pending approval, a payout left on Sending, no record, unreachable: all need the confirmation, then work
  for (const [wit, reply, text] of [[{ status: 'processing' }, { status: 'processing', rawStatus: 'pending_approval' }, /pending_approval/], [{ status: 'sending' }, { status: 'processing', rawStatus: 'pending' }, /pending/], [{ status: 'sending' }, { unavailable: true, httpStatus: 404 }, /has no record/], [{ status: 'sending' }, { providerDown: true }, /could not be asked/]]) {
    w = world(wit, reply); r = await w.call({ withdrawalId: 'w1' }); eq([r.code, r.body.needsConfirm], [409, true]); ok(text.test(r.body.message), r.body.message);
    r = await w.call({ withdrawalId: 'w1', confirmPending: true }); eq([r.code, w.row().status, w.user().walletBalance], [200, 'declined', 20000]);
  }
  // LworxPay says it was sent: never rejectable, even with the confirmation
  w = world({ status: 'processing' }, { status: 'success', rawStatus: 'completed' });
  r = await w.call({ withdrawalId: 'w1', confirmPending: true }); eq(r.code, 409); ok(/SENT \(completed\)/.test(r.body.message) && !r.body.needsConfirm, r.body.message); eq([w.row().status, w.user().walletBalance], ['processing', 0]);
  // LworxPay says failed: rejected at once, no confirmation needed
  w = world({ status: 'processing' }, { status: 'failed', rawStatus: 'failed' }); r = await w.call({ withdrawalId: 'w1' }); eq([r.code, w.row().status, w.user().walletBalance], [200, 'declined', 20000]);
  // a double tap cannot refund twice
  r = await w.call({ withdrawalId: 'w1' }); ok(r.code === 400 || r.code === 409, 'a second reject is refused'); eq(w.user().walletBalance, 20000);
  // watch: a rejected payout that LworxPay later completes is flagged (not changed), and is not asked again within 30 minutes
  w = world({ status: 'declined', rejectedWhilePending: true, rejectedAtMs: Date.now() - 3600 * 1000 }, { status: 'success', rawStatus: 'completed' });
  await w.c.watchRejectedLworxPayouts(); eq(w.row().paidAfterReject, true, 'flagged: paid after it was rejected'); ok(w.c._errors.some(e => /COMPLETED payout/.test(e)), 'and logged'); eq(w.user().walletBalance, 0, 'no money is moved automatically');
  w = world({ status: 'declined', rejectedWhilePending: true, rejectedAtMs: Date.now() - 3600 * 1000, lateCheckedAtMs: Date.now() - 60 * 1000 }, { status: 'success' }); await w.c.watchRejectedLworxPayouts(); eq(w.reads.length, 0, 'asked at most every 30 minutes');
  w = world({ status: 'declined', rejectedWhilePending: true, rejectedAtMs: Date.now() - 20 * 24 * 3600 * 1000 }, { status: 'success' }); await w.c.watchRejectedLworxPayouts(); eq(w.reads.length, 0, 'and for 14 days');
  w = world({ status: 'declined', rejectedWhilePending: true, rejectedAtMs: Date.now() - 3600 * 1000 }, { status: 'processing' }); await w.c.watchRejectedLworxPayouts(); ok(!w.row().paidAfterReject, 'a payout still pending is not flagged');
  const adm = fs.readFileSync(__dirname + '/admin-src/index.html', 'utf8');
  ok(/d\.needsConfirm && confirm\(d\.message/.test(adm) && /confirmPending:true/.test(adm), 'the admin asks for the explicit OK and then re-sends with it');
  ok(/w\.paidAfterReject\?/.test(adm), 'and shows a late payment on the row');
  console.log('test-lworx-reject: ' + n + ' checks passed');
})().catch(e => { console.error(e); process.exit(1); });
