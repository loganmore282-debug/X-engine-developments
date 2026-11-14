'use strict';
// Regression tests for the manual deposit/withdrawal review fixes, run against the real server.js source with stubs:
//  1. "Mark as paid" records a payout the admin already sent by hand: it never contacts a provider, counts totalWithdrawn once and a repeat does nothing
//  2. a member can save at most MAX_SAVED_PAYOUT_ACCOUNTS withdrawal accounts (saving edits the one wallet in place)
//  3. the per-user debounce maps are swept (no slow memory growth)
const fs = require('node:fs'), assert = require('node:assert/strict');
let checks = 0; const ok = (c, m) => { checks++; assert.ok(c, m); }; const eq = (a, b, m) => { checks++; assert.deepEqual(a, b, m); };
const src = fs.readFileSync(__dirname + '/server.js', 'utf8');
function fn(name) { let s = src.indexOf('async function ' + name + '('); if (s < 0) s = src.indexOf('function ' + name + '(');
  assert.ok(s >= 0, name); let d = 0; for (let k = src.indexOf('{', s); k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}' && --d === 0) return src.slice(s, k + 1); } throw new Error('braces'); }

(async () => {
  // 1. mark as paid
  function mark(status) {
    const wit = { userId: 'u1', status, network: 'Telebirr', phone: '+251911000000', net: 8500, amount: 10000, holder: 'A' };
    const calls = [], inc = [];
    const witRef = { get: async () => ({ exists: true, data: () => ({ ...wit }) }),
      updateIf: async (f, p) => { if (wit.status !== f.status) return false; calls.push(['updateIf', p.status, p.payoutMethod]); wit.status = p.status; return true; }, update: async () => {} };
    const db = { collection: n => n === 'withdrawals' ? { doc: () => witRef } : { doc: () => ({ get: async () => ({ exists: true, data: () => ({ status: 'active' }) }), update: async u => { inc.push(u.totalWithdrawn); } }) } };
    const f = new Function('db', '_withdrawInFlight', 'FieldValue', 'withLock', 'finalizeWithdrawalTransactionRecord', 'fmtMoney', 'console',
      fn('_processWithdrawalNow') + '\nreturn _processWithdrawalNow;')(db, new Set(), { serverTimestamp: () => 1, increment: n => n }, (k, g) => g(), async () => {}, n => n, console);
    return { f, calls, inc };
  }
  let t = mark('pending');
  let r = await t.f('w1', 'boss');
  eq(r.code, 200, 'a pending payout is recorded as paid'); eq(t.calls[0], ['updateIf', 'processed', 'manual'], 'status goes straight to processed, method manual');
  eq(t.inc, [8500], 'totalWithdrawn counts the net amount once');
  r = await t.f('w1', 'boss');
  eq(r.code, 400, 'a repeat tap is refused'); eq(t.inc, [8500], 'and counts nothing again');
  t = mark('declined'); r = await t.f('w1', 'boss'); eq(r.code, 400, 'a declined withdrawal cannot be marked paid'); eq(t.calls.length, 0, 'nothing written');
  ok(!/marz|pesajet/i.test(fn('_processWithdrawalNow')), 'the payout code names no payment provider');

  // 2. one payout wallet per member: saving edits it in place
  ok(/const MAX_SAVED_PAYOUT_ACCOUNTS = 1;/.test(src), 'one wallet per member');
  async function save(existing, phone) {
    const rows = existing.map((p, i) => ({ id: 'b' + i, userId: 'u1', phone: p, holder: 'OLD', network: 'Telebirr' }));
    const log = { added: 0, updated: [], deleted: [] }; let code = 200, body;
    const mkDoc = r => ({ id: r.id, data: () => r, ref: { update: async u => { log.updated.push([r.id, u]); }, delete: async () => { log.deleted.push(r.id); } } });
    const chain = (list, f = []) => ({ where: (k, o, v) => chain(list, [...f, [k, v]]), limit: () => chain(list, f),
      get: async () => { const got = list.filter(r => f.every(([k, v]) => r[k] === v)); return { empty: !got.length, size: got.length, docs: got.map(mkDoc) }; } });
    const db = { collection: n => n === 'bankAccounts' ? { ...chain(rows), add: async () => { log.added++; } } : { doc: () => ({ get: async () => ({ exists: true, data: () => ({ phone: '0700000000', status: 'active' }) }) }) } };
    let handler; const app = { post: (p, h) => { if (p === '/bank/save') handler = h; } };
    const i = src.indexOf('const MAX_SAVED_PAYOUT_ACCOUNTS'), j = src.indexOf("app.get('/bank/list'");
    new Function('textOf', 'app', 'db', 'verifyAuth', 'stripHtml', 'PAYOUT_ACCOUNT_TYPES', 'NETWORK_NAMES', 'cleanPhone', 'badPhoneMessage', 'getSettings', 'withLock', 'FieldValue', 'console',
      src.slice(i, j))(v => typeof v === 'string' ? v : (typeof v === 'number' && Number.isFinite(v) ? String(v) : ''), app, db, async () => 'u1', s => String(s || '').trim(), { 'Commercial Bank of Ethiopia': 'bank', 'Telebirr': 'wallet' }, new Set(['Telebirr']),
      v => String(v || '').replace(/\D/g, '') || '', () => 'bad phone', async () => ({}), (k, g) => g(), { serverTimestamp: () => 1 }, console);
    const res = { status(c) { code = c; return this; }, json(b) { body = b; return this; } };
    await handler({ body: { holder: 'A B', network: 'Telebirr', phone } }, res); return { code, body, ...log };
  }
  let s = await save([], '0770000099');
  eq([s.code, s.added, s.updated.length], [200, 1, 0], 'the first wallet is added');
  s = await save(['0700000010'], '0770000099');
  eq([s.code, s.added, s.updated.length, s.deleted.length], [200, 0, 1, 0], 'saving again edits the one wallet in place, no second row');
  ok(s.updated[0][1].phone === '0770000099' && s.updated[0][1].holder === 'A B', 'with the new number and holder');
  s = await save(['0700000010', '0700000011', '0700000012'], '0770000099');
  eq([s.added, s.updated.length, s.deleted.length], [0, 1, 2], 'any older extra wallets are removed');

  // 3. sweep
  const sweep = fn('sweepEphemeralState');
  ok(/_adminCreditDebounce/.test(sweep) && /_loginFails/.test(sweep), 'the debounce maps and failed-login counters are swept');
  console.log(`PASS: payment review fixes (${checks} checks)`); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
