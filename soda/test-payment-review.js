'use strict';
// Regression tests for the deposit/withdrawal review fixes, run against the real
// server.js source with stubs:
//  1. an automatic payout is never sent for a suspended member (manual "mark as
//     paid" bookkeeping is unaffected)
//  2. a member can save at most MAX_SAVED_PAYOUT_ACCOUNTS withdrawal accounts
//  3. the per-user debounce maps are swept (no slow memory growth)
// (the daily-limit fix is covered in test-withdraw-rules.js)
const fs = require('node:fs'), assert = require('node:assert/strict');
let checks = 0; const ok = (c, m) => { checks++; assert.ok(c, m); }; const eq = (a, b, m) => { checks++; assert.deepEqual(a, b, m); };
const src = fs.readFileSync(__dirname + '/server.js', 'utf8');
function fn(name) { let s = src.indexOf('async function ' + name + '('); if (s < 0) s = src.indexOf('function ' + name + '(');
  assert.ok(s >= 0, name); let d = 0; for (let k = src.indexOf('{', s); k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}' && --d === 0) return src.slice(s, k + 1); } throw new Error('braces'); }

(async () => {
  // 1. payout guard
  function payout({ banned, manual }) {
    const wit = { userId: 'u1', status: 'pending', network: 'MTN Mobile Money', phone: '0770', net: 8500, amount: 10000, holder: 'A' };
    const calls = []; const witRef = { get: async () => ({ exists: true, data: () => ({ ...wit }) }), updateIf: async (f, p) => { calls.push(['updateIf', p.status]); return true; }, update: async () => {} };
    const db = { collection: n => n === 'withdrawals' ? { doc: () => witRef } : { doc: () => ({ get: async () => ({ exists: true, data: () => ({ status: banned ? 'banned' : 'active' }) }), update: async () => {} }) } };
    const f = new Function('db', '_withdrawInFlight', 'getSettings', 'payoutIsManual', 'FieldValue', 'withLock', 'finalizeWithdrawalTransactionRecord', 'fmtMoney', 'isBankNetwork', 'crypto', 'marzUserMsg', 'console',
      fn('_processWithdrawalNow') + '\nreturn _processWithdrawalNow;')(db, new Set(), async () => ({}), () => manual, { serverTimestamp: () => 1, increment: n => n }, (k, g) => g(), async () => {}, n => n, () => false, require('node:crypto'), () => '', console);
    return f('w1', 'boss').then(r => ({ r, calls }));
  }
  let t = await payout({ banned: true, manual: false });
  eq(t.r.code, 409, 'banned member: automatic payout refused'); ok(/suspended/.test(t.r.body.message), 'and says why'); eq(t.calls.length, 0, 'nothing claimed or sent');
  t = await payout({ banned: true, manual: true });
  eq(t.r.code, 200, 'manual mark-as-paid for an already-made payment still records'); eq(t.calls[0][1], 'processed');
  // (an active member in automatic mode proceeds past the guard to the gateway code, covered by the existing payout tests)

  // 2. one payout wallet per member: saving edits it in place
  ok(/const MAX_SAVED_PAYOUT_ACCOUNTS = 1;/.test(src), 'one wallet per member');
  async function save(existing, phone) {
    const rows = existing.map((p, i) => ({ id: 'b' + i, userId: 'u1', phone: p, holder: 'OLD', network: 'MTN Mobile Money' }));
    const log = { added: 0, updated: [], deleted: [] }; let code = 200, body;
    const mkDoc = r => ({ id: r.id, data: () => r, ref: { update: async u => { log.updated.push([r.id, u]); }, delete: async () => { log.deleted.push(r.id); } } });
    const chain = (list, f = []) => ({ where: (k, o, v) => chain(list, [...f, [k, v]]), limit: () => chain(list, f),
      get: async () => { const got = list.filter(r => f.every(([k, v]) => r[k] === v)); return { empty: !got.length, size: got.length, docs: got.map(mkDoc) }; } });
    const db = { collection: n => n === 'bankAccounts' ? { ...chain(rows), add: async () => { log.added++; } } : { doc: () => ({ get: async () => ({ exists: true, data: () => ({ phone: '0700000000', status: 'active' }) }) }) } };
    let handler; const app = { post: (p, h) => { if (p === '/bank/save') handler = h; } };
    const i = src.indexOf('const MAX_SAVED_PAYOUT_ACCOUNTS'), j = src.indexOf("app.get('/bank/list'");
    new Function('app', 'db', 'verifyAuth', 'stripHtml', 'NETWORK_NAMES', 'cleanPhone', 'badPhoneMessage', 'getSettings', 'getSupportedBanks', 'consumeOtpTicket', 'marzValidateBankAccount', 'marzUserMsg', 'withLock', 'FieldValue', 'console',
      src.slice(i, j))(app, db, async () => 'u1', s => String(s || '').trim(), new Set(['MTN Mobile Money']), p => String(p).replace(/\D/g, ''), () => 'bad phone',
      async () => ({ otpVerificationEnabled: false }), async () => [], async () => true, async () => ({}), () => '', (k, g) => g(), { serverTimestamp: () => 1 }, console);
    const res = { status(c) { code = c; return this; }, json(b) { body = b; return this; } };
    await handler({ body: { holder: 'A B', network: 'MTN Mobile Money', phone } }, res); return { code, body, ...log };
  }
  let r = await save([], '0770000099');
  eq([r.code, r.added, r.updated.length], [200, 1, 0], 'the first wallet is added');
  r = await save(['0700000010'], '0770000099');
  eq([r.code, r.added, r.updated.length, r.deleted.length], [200, 0, 1, 0], 'saving again edits the one wallet in place, no second row');
  ok(r.updated[0][1].phone === '0770000099' && r.updated[0][1].holder === 'A B', 'with the new number and holder');
  r = await save(['0700000010', '0700000011', '0700000012'], '0770000099');
  eq([r.added, r.updated.length, r.deleted.length], [0, 1, 2], 'any older extra wallets are removed');
  r = await save(['0770000099'], '0770000099');
  eq([r.code, r.added, r.updated.length], [200, 0, 1], 'saving the same number again just updates the holder');

  // 3. sweep
  const sweep = fn('sweepEphemeralState');
  ok(/_usdtSubmitDebounce/.test(sweep) && /_cardSubmitDebounce/.test(sweep), 'USDT and card debounce maps are swept');
  console.log(`PASS: payment review fixes (${checks} checks)`); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
