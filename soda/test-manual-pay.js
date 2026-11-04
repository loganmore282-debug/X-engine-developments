'use strict';
// Manual bank / wallet recharge (Ethiopia): payment numbers typed in the admin panel, the member's
// order + claim, and the guarantee that NOTHING here credits a wallet. Real server.js source against mocks.
const fs = require('node:fs'), assert = require('node:assert/strict');
let checks = 0; const ok = (c, m) => { checks++; assert.ok(c, m); }; const eq = (a, b, m) => { checks++; assert.deepEqual(a, b, m); };
const src = fs.readFileSync(__dirname + '/server.js', 'utf8');
const a = src.indexOf('// ── MANUAL BANK / WALLET RECHARGE (Ethiopia) ──'), b = src.indexOf('// END MANUAL BANK / WALLET RECHARGE', a);
ok(a >= 0 && b > a, 'manual recharge block found');
const block = src.slice(a, b);

// ── in-memory database with just what the block uses ──
const SERVER_TS = { __ts: true };
function makeDb() {
  const cols = new Map(); let n = 0;
  const col = name => { if (!cols.has(name)) cols.set(name, new Map()); return cols.get(name); };
  const snapOf = (name, id) => { const row = col(name).get(id); return { id, exists: !!row, data: () => row && structuredClone(row), ref: refOf(name, id) }; };
  const refOf = (name, id) => ({
    id,
    get: async () => snapOf(name, id),
    set: async v => { col(name).set(id, structuredClone(v)); },
    update: async v => { const r = col(name).get(id); if (!r) throw new Error('NOT_FOUND'); Object.assign(r, structuredClone(v)); },
    updateIf: async (f, v) => { const r = col(name).get(id); if (!r) return false; for (const k of Object.keys(f)) if (r[k] !== f[k]) return false; Object.assign(r, structuredClone(v)); return true; },
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
    'verifyAuth', 'verifyAdmin', 'verifyOwner', 'logAdminAction', 'uniqueRef', 'nowStr', 'newStatementId', '_userBeingDeleted',
    block + '\nreturn { extractManualRef, extractManualAmount, sweepManualOrders, activePayChannels, dropPayChannelsCache };');
  const api = mk(app, db, ctx, { serverTimestamp: () => SERVER_TS }, v => (v && v.getTime ? v.getTime() : 0), () => 'et', 1e9,
    n => 'Br ' + n, v => Number(v), async () => ({ minDeposit: 300 }),
    async () => ctx.user, () => ctx.admin, () => ctx.owner, () => {}, async l => l + (++ctx.refN), () => ({ date: '01/01/2026', time: '10:00' }), () => 'S' + (++ctx.refN), new Set());
  return { handlers, api };
}
async function call(h, body, opts = {}) {
  const out = { code: 200, body: null };
  const res = { status(c) { out.code = c; return this; }, json(b) { out.body = b; return this; }, set() { return this; } };
  await h({ body, headers: {}, ...opts }, res);
  return out;
}
const LOGO = 'data:image/png;base64,iVBORw0KGgo=';

(async () => {
  const db = makeDb();
  const ctx = { user: 'u1', owner: true, admin: true, refN: 0 };
  const { handlers: H, api } = build(db, ctx);
  db.col('users').set('u1', { phone: '+251911111111', status: 'active', walletBalance: 100, totalDeposited: 0 });
  db.col('users').set('u2', { phone: '+251922222222', status: 'active', walletBalance: 0, totalDeposited: 0 });
  db.col('users').set('ban', { phone: '+251933333333', status: 'banned' });

  // ── reference extraction (what a pasted SMS / receipt may be) ──
  const X = api.extractManualRef;
  eq(X('https://mbreciept.cbe.com.et/v2-hfHCxFT8tBhc0zxe95aa'), { ref: 'v2-hfhcxft8tbhc0zxe95aa', kind: 'cbe-v2' }, 'CBE v2- receipt link');
  eq(X('https://apps.cbe.com.et:100/?id=FT25512S26V825101122'), { ref: 'FT25512S26V8', kind: 'cbe-ft' }, 'CBE FT link: first 12 characters');
  eq(X('FT25512S26V8'), { ref: 'FT25512S26V8', kind: 'cbe-ft' }, 'bare FT code');
  eq(X('Dear AMIR You have transferred ETB 5.00 to MASFIN. Your transaction number is DA39J9GAMN. The service fee is ETB 0.87'), { ref: 'DA39J9GAMN', kind: 'telebirr' }, 'Telebirr SMS');
  eq(X('https://transactioninfo.ethiotelecom.et/receipt/DA39J9GAMN.'), { ref: 'DA39J9GAMN', kind: 'telebirr' }, 'Telebirr receipt link');
  eq(X('DA39J9GAMN'), { ref: 'DA39J9GAMN', kind: 'telebirr' }, 'bare Telebirr number');
  for (const bad of ['', 'hello', '1234567890', 'ABCDEFGHIJ', 'I paid', 'v2-', 'FT12']) eq(X(bad), null, 'refused: ' + bad);
  eq(api.extractManualAmount('You have transferred ETB 5.00 to X'), 5, 'amount from a Telebirr SMS');
  eq(api.extractManualAmount('Your account has been debited with ETB 1,550.50 on'), 1550.5, 'amount with comma and cents');
  eq(api.extractManualAmount('no money here'), null, 'no amount');

  // ── admin: payment numbers ──
  let r = await call(H['POST /admin/pay-channels/save'], { name: 'Commercial Bank of Ethiopia', kind: 'bank', accountName: 'Ashenafi', accountNumber: '1000809418239', logo: LOGO });
  eq(r.code, 200, 'owner can add a payment number'); const c1 = r.body.id;
  r = await call(H['POST /admin/pay-channels/save'], { name: 'Telebirr Wallet', kind: 'wallet', accountName: 'Chala', accountNumber: '0962499914' });
  const c2 = r.body.id; ok(c2 && c2 !== c1, 'second payment number');
  r = await call(H['POST /admin/pay-channels/save'], { name: 'Hidden', kind: 'bank', accountName: 'X', accountNumber: '55555555', active: false });
  const c3 = r.body.id;
  for (const bad of [{ name: '', accountName: 'a', accountNumber: '12345678' }, { name: 'n', accountName: '', accountNumber: '12345678' }, { name: 'n', accountName: 'a', accountNumber: '12' }, { name: 'n', accountName: 'a', accountNumber: 'ab cd<>' + '9'.repeat(3), logo: 'data:image/jpeg;base64,AAAA' }]) {
    r = await call(H['POST /admin/pay-channels/save'], bad); eq(r.code, 400, 'refused: ' + JSON.stringify(bad).slice(0, 60));
  }
  r = await call(H['POST /admin/pay-channels/save'], { name: 'n', accountName: 'a', accountNumber: '12345678', logo: 'data:image/png;base64,' + 'A'.repeat(300000) });
  eq(r.code, 400, 'an oversized logo is refused');
  ctx.owner = false;
  r = await call(H['POST /admin/pay-channels/save'], { name: 'n', accountName: 'a', accountNumber: '12345678' }); eq(r.code, 401, 'staff cannot add a payment number');
  r = await call(H['POST /admin/pay-channels/delete'], { id: c3 }); eq(r.code, 401, 'staff cannot delete one');
  ctx.owner = true;
  r = await call(H['POST /admin/pay-channels/save'], { id: c1, name: 'CBE', kind: 'bank', accountName: 'Ashenafi', accountNumber: '1000809418239' });
  eq(db.col('payChannels').get(c1).logo, LOGO, 'editing without sending a logo keeps the logo');
  r = await call(H['POST /admin/pay-channels/save'], { id: c1, name: 'Commercial Bank of Ethiopia', kind: 'bank', accountName: 'Ashenafi', accountNumber: '1000809418239', logo: '' });
  eq(db.col('payChannels').get(c1).logo, '', 'an empty logo removes it');
  await call(H['POST /admin/pay-channels/save'], { id: c1, name: 'Commercial Bank of Ethiopia', kind: 'bank', accountName: 'Ashenafi', accountNumber: '1000809418239', logo: LOGO });
  r = await call(H['POST /admin/pay-channels/list'], {}); eq(r.body.channels.length, 3, 'admin sees all three');
  ok(r.body.channels.every(c => c.accountNumber), 'admin list carries the account numbers');
  r = await call(H['GET /public/pay-channels'], {});
  eq(r.body.channels.map(c => c.name), ['Commercial Bank of Ethiopia', 'Telebirr Wallet'], 'members see only the shown ones, in order');
  ok(r.body.channels.every(c => !('accountNumber' in c) && !('accountName' in c)), 'the public list never carries an account number');

  // ── member: order ──
  r = await call(H['POST /deposit/manual/order'], { amount: 100, channelId: c1 }); eq(r.code, 400, 'below the minimum is refused');
  r = await call(H['POST /deposit/manual/order'], { amount: 550, channelId: 'nope' }); eq(r.code, 400, 'unknown channel refused');
  r = await call(H['POST /deposit/manual/order'], { amount: 550, channelId: c3 }); eq(r.code, 400, 'a hidden channel cannot be ordered');
  ctx.user = 'ban'; r = await call(H['POST /deposit/manual/order'], { amount: 550, channelId: c1 }); eq(r.code, 403, 'a banned member is refused'); ctx.user = 'u1';
  r = await call(H['POST /deposit/manual/order'], { amount: 550, channelId: c1 });
  eq(r.code, 200, 'order created'); const o1 = r.body;
  eq([o1.accountName, o1.accountNumber, o1.channel.name], ['Ashenafi', '1000809418239', 'Commercial Bank of Ethiopia'], 'the account to pay is returned');
  ok(o1.expiresAt - Date.now() > 29 * 60 * 1000 && o1.expiresAt - Date.now() <= 30 * 60 * 1000, 'thirty minute clock');
  const dep1 = db.col('pendingDeposits').get(o1.depositId);
  eq([dep1.status, dep1.method, dep1.amount, dep1.userId], ['pending', 'manual', 550, 'u1'], 'a pending manual order is stored');
  r = await call(H['POST /deposit/manual/order'], { amount: 550, channelId: c2, depositId: o1.depositId });
  eq(r.body.depositId, o1.depositId, 'switching moves the SAME order');
  eq([r.body.accountNumber, r.body.expiresAt, r.body.reference], ['0962499914', o1.expiresAt, o1.reference], 'new account, same clock and reference');
  eq(db.col('pendingDeposits').size, 1, 'still exactly one order');
  r = await call(H['POST /deposit/manual/order'], { amount: 700, channelId: c2 });
  eq([r.body.depositId, db.col('pendingDeposits').get(o1.depositId).amount], [o1.depositId, 700], 'a member never has two open orders; the amount follows the latest');

  // ── member: claim ──
  const bal = () => db.col('users').get('u1').walletBalance + ':' + db.col('users').get('u1').totalDeposited;
  const before = bal();
  r = await call(H['POST /deposit/manual/submit'], { depositId: o1.depositId, sms: 'I paid' });
  eq([r.code, r.body.message], [400, 'please enter the correct transfer sms'], 'text without a code is refused with the owner\'s wording');
  r = await call(H['POST /deposit/manual/submit'], { depositId: 'missing', sms: 'FT25512S26V8' }); eq(r.code, 404, 'unknown order');
  ctx.user = 'u2'; r = await call(H['POST /deposit/manual/submit'], { depositId: o1.depositId, sms: 'FT25512S26V8' }); eq(r.code, 404, 'somebody else\'s order'); ctx.user = 'u1';
  const realNow = Date.now; Date.now = () => realNow() + 10000;
  r = await call(H['POST /deposit/manual/submit'], { depositId: o1.depositId, sms: 'Dear AMIR You have transferred ETB 700.00 to X. Your transaction number is DA39J9GAMN. Done' });
  eq([r.code, r.body.state], [200, 'review'], 'a Telebirr SMS is accepted for review');
  const dep = db.col('pendingDeposits').get(o1.depositId);
  eq([dep.status, dep.pastedSmsTxId, dep.pastedSmsAmount, dep.pastedSmsAmountMatches], ['review', 'DA39J9GAMN', 700, true], 'claim stored with the code and the amount check');
  eq(bal(), before, 'submitting credits NOTHING');
  eq([...db.col('transactions').values()].filter(t => t.depositId === o1.depositId).length, 1, 'a Processing record appears in the member\'s history');
  Date.now = () => realNow() + 20000;
  r = await call(H['POST /deposit/manual/submit'], { depositId: o1.depositId, sms: 'DA39J9GAMN' });
  ok(r.body.alreadySubmitted, 'submitting the same order again changes nothing');
  eq([...db.col('transactions').values()].filter(t => t.depositId === o1.depositId).length, 1, 'and adds no second record');
  // the same real transfer cannot back a second claim by someone else
  ctx.user = 'u2';
  Date.now = () => realNow() + 30000;
  r = await call(H['POST /deposit/manual/order'], { amount: 550, channelId: c2 }); const o2 = r.body;
  Date.now = () => realNow() + 40000;
  r = await call(H['POST /deposit/manual/submit'], { depositId: o2.depositId, sms: 'Your transaction number is DA39J9GAMN' });
  eq(r.code, 409, 'a code that is already claimed cannot be claimed again');
  eq(db.col('pendingDeposits').get(o2.depositId).status, 'pending', 'the refused order stays open');
  Date.now = () => realNow() + 50000;
  r = await call(H['POST /deposit/manual/submit'], { depositId: o2.depositId, sms: 'FT25512S26V825101122' });
  eq(r.body.state, 'review', 'a different code is fine');
  Date.now = realNow;
  eq(db.col('users').get('u2').walletBalance, 0, 'and still no credit');

  // ── expiry sweep ──
  ctx.user = 'u1'; ctx.owner = true;
  db.col('pendingDeposits').set('old', { userId: 'u1', method: 'manual', status: 'pending', amount: 1, expiresAt: new Date(Date.now() - 3 * 3600 * 1000) });
  db.col('pendingDeposits').set('fresh', { userId: 'u1', method: 'manual', status: 'pending', amount: 1, expiresAt: new Date(Date.now() + 600000) });
  db.col('pendingDeposits').set('gw', { userId: 'u1', method: undefined, status: 'pending', amount: 1 });
  await api.sweepManualOrders();
  eq([db.col('pendingDeposits').get('old').status, db.col('pendingDeposits').get('fresh').status, db.col('pendingDeposits').get('gw').status], ['failed', 'pending', 'pending'], 'only an old unpaid manual order is closed');
  // ── delete ──
  r = await call(H['POST /admin/pay-channels/delete'], { id: c3 }); eq(r.code, 200, 'owner can delete'); api.dropPayChannelsCache();
  r = await call(H['POST /admin/pay-channels/list'], {}); eq(r.body.channels.length, 2, 'it is gone');
  // wiring
  ok(/manualPay: manualPayOn,\s+depositAvailable: manualPayOn/.test(src), 'public settings publish manualPay and open Recharge when numbers exist');
  console.log('PASS: manual bank / wallet recharge (' + checks + ' checks)');
})().catch(e => { console.error(e); process.exitCode = 1; });
