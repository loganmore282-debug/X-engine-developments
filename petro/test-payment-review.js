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

  // 2. saved-account cap
  ok(/const MAX_SAVED_PAYOUT_ACCOUNTS = 10;/.test(src), 'cap is defined');
  async function save(existing, phone) {
    const rows = existing.map((p, i) => ({ id: 'b' + i, userId: 'u1', phone: p })); let added = 0, code = 200, body;
    const chain = (list, f = []) => ({ where: (k, o, v) => chain(list, [...f, [k, v]]), limit: () => chain(list, f),
      get: async () => { const got = list.filter(r => f.every(([k, v]) => r[k] === v)); return { empty: !got.length, size: got.length, docs: got.map(r => ({ id: r.id, data: () => r })) }; } });
    const db = { collection: n => n === 'bankAccounts' ? { ...chain(rows), add: async () => { added++; } } : { doc: () => ({ get: async () => ({ exists: true, data: () => ({ phone: '0700000000', status: 'active' }) }) }) } };
    let handler; const app = { post: (p, h) => { if (p === '/bank/save') handler = h; } };
    const i = src.indexOf('const MAX_SAVED_PAYOUT_ACCOUNTS'), j = src.indexOf('app.get(\'/bank/list\'');
    new Function('app', 'db', 'verifyAuth', 'stripHtml', 'NETWORK_NAMES', 'cleanPhone', 'badPhoneMessage', 'getSettings', 'getSupportedBanks', 'consumeOtpTicket', 'marzValidateBankAccount', 'marzUserMsg', 'withLock', 'FieldValue',
      src.slice(i, j))(app, db, async () => 'u1', s => String(s || '').trim(), new Set(['MTN Mobile Money']), p => String(p).replace(/\D/g, ''), () => 'bad phone',
      async () => ({ otpVerificationEnabled: false }), async () => [], async () => true, async () => ({}), () => '', (k, g) => g(), { serverTimestamp: () => 1 });
    const res = { status(c) { code = c; return this; }, json(b) { body = b; return this; } };
    await handler({ body: { holder: 'A B', network: 'MTN Mobile Money', phone } }, res); return { code, body, added };
  }
  let r = await save(Array.from({ length: 9 }, (_, i) => '07000000' + (10 + i)), '0770000099');
  eq([r.code, r.added], [200, 1], 'the 10th account is accepted');
  r = await save(Array.from({ length: 10 }, (_, i) => '07000000' + (10 + i)), '0770000099');
  ok(r.code === 400 && /up to 10/.test(r.body.message) && r.added === 0, 'the 11th is refused: ' + r.body.message);
  r = await save(Array.from({ length: 10 }, (_, i) => '07000000' + (10 + i)), '0700000010');
  ok(r.code === 400 && /already saved/.test(r.body.message), 'a duplicate still gets the duplicate message');

  // 3. sweep
  const sweep = fn('sweepEphemeralState');
  ok(/_usdtSubmitDebounce/.test(sweep) && /_cardSubmitDebounce/.test(sweep), 'USDT and card debounce maps are swept');
  console.log(`PASS: payment review fixes (${checks} checks)`); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
