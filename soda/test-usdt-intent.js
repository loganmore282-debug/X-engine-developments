'use strict';
// USDT payment requests (the fix for hijacking a public TXID):
//  - verifyUsdtTx: new-style claims need the EXACT amount and a block time after
//    the request; older claims keep the "at least the amount" rule
//  - /deposit/usdt/intent: unique exact amounts, idempotent per amount, capped,
//    expired amounts reclaimed atomically, validation
// Real server.js source against mocks.
const fs = require('node:fs'), assert = require('node:assert/strict'), nodeCrypto = require('node:crypto');
let checks = 0; const ok = (c, m) => { checks++; assert.ok(c, m); }; const eq = (a, b, m) => { checks++; assert.deepEqual(a, b, m); };
const src = fs.readFileSync(__dirname + '/server.js', 'utf8');
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i + 1); assert.ok(i >= 0 && j > i, a); return src.slice(i, j); };

(async () => {
  // ── verifyUsdtTx ──
  const chainSrc = 'const BASE58_ALPHABET' + cut('const BASE58_ALPHABET', '// Distinguishes two very different kinds') .slice('const BASE58_ALPHABET'.length)
    + 'const USDT_TRC20_CONTRACT' + cut('const USDT_TRC20_CONTRACT', '// TRON/TRC20 addresses show up').slice('const USDT_TRC20_CONTRACT'.length);
  const vSrc = cut('async function verifyUsdtTx(', '// How long an INCONCLUSIVE claim');
  const WALLET = '0x' + 'ab'.repeat(20), USDT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
  const mk = events => new Function('fetch', 'AbortSignal', 'TRONGRID_BASE', 'TRONGRID_API_KEY', 'TRONGRID_TIMEOUT',
    chainSrc + '\n' + vSrc + '\nreturn verifyUsdtTx;')(async () => ({ ok: true, json: async () => ({ data: events }) }), AbortSignal, 'x', 'key', 1000);
  const ev = (value, ts, extra = {}) => ({ event_name: 'Transfer', contract_address: USDT, result: { to: '0x' + 'ab'.repeat(20), value: String(value) }, block_timestamp: ts, ...extra });
  const NOW = 1_800_000_000_000, EXACT = 25_000_417;
  let v = await mk([ev(EXACT, NOW + 5000)])('t', WALLET, 25, { exactMicros: EXACT, notBeforeMs: NOW });
  ok(v.verified && v.onChainAmount === 25.000417, 'exact amount, sent after the request: verified');
  v = await mk([ev(EXACT + 1, NOW + 5000)])('t', WALLET, 25, { exactMicros: EXACT, notBeforeMs: NOW });
  ok(!v.verified && v.conclusive && /exact amount/.test(v.reason) && /25\.000417/.test(v.reason), 'one micro more is not a match: ' + v.reason);
  v = await mk([ev(EXACT - 1, NOW + 5000)])('t', WALLET, 25, { exactMicros: EXACT, notBeforeMs: NOW });
  ok(!v.verified && v.conclusive, 'one micro less is not a match');
  v = await mk([ev(25_000_000, NOW + 5000)])('t', WALLET, 25, { exactMicros: EXACT, notBeforeMs: NOW });
  ok(!v.verified && v.conclusive, 'the plain amount without the unique tail is not a match (this is what an old public payment looks like)');
  v = await mk([ev(EXACT, NOW - 60_000)])('t', WALLET, 25, { exactMicros: EXACT, notBeforeMs: NOW });
  ok(!v.verified && v.conclusive && /before the payment request/.test(v.reason), 'a transfer older than the request is refused');
  v = await mk([ev(EXACT, undefined)])('t', WALLET, 25, { exactMicros: EXACT, notBeforeMs: NOW });
  ok(!v.verified && !v.conclusive, 'no block time: not credited, but not declined either (retry)');
  v = await mk([ev(5, NOW), ev(EXACT, NOW + 1000)])('t', WALLET, 25, { exactMicros: EXACT, notBeforeMs: NOW });
  ok(v.verified, 'a transaction with several transfers to us: the matching one counts');
  v = await mk([ev(EXACT, NOW + 1, { contract_address: 'TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj' })])('t', WALLET, 25, { exactMicros: EXACT, notBeforeMs: NOW });
  ok(!v.verified && v.conclusive, 'the wrong token is refused');
  v = await mk([ev(EXACT, NOW + 1, { result: { to: '0x' + 'cd'.repeat(20), value: String(EXACT) } })])('t', WALLET, 25, { exactMicros: EXACT, notBeforeMs: NOW });
  ok(!v.verified && v.conclusive, 'a payment to somebody else is refused');
  // older claims
  v = await mk([ev(30_000_000, NOW)])('t', WALLET, 25, {});
  ok(v.verified, 'legacy claim: at least the amount is still accepted');
  v = await mk([ev(20_000_000, NOW)])('t', WALLET, 25);
  ok(!v.verified && v.conclusive, 'legacy claim: a shortfall is still declined');

  // ── intents ──
  const routeSrc = cut('const USDT_INTENT_TTL_MS', "const _usdtSubmitDebounce = new Map();\napp.post('/deposit/usdt/submit'");
  const store = new Map();
  const clone = x => structuredClone(x);
  const intentsCol = { doc: id => ({ id,
      get: async () => ({ id, exists: store.has(id), data: () => clone(store.get(id)) }),
      createIfAbsent: async d => { if (store.has(id)) return false; store.set(id, clone(d)); return true; },
      updateIf: async (f, d) => { const r = store.get(id); if (!r) return false; if (f.expiresAt && !(r.expiresAt < f.expiresAt.$lt)) return false;
        const n = { ...r, ...clone(d) }; for (const k of Object.keys(n)) if (n[k] && n[k].__del) delete n[k]; store.set(id, n); return true; } }),
    where: (k, o, v) => { const fs = [[k, v]]; const q = { where: (k2, o2, v2) => { fs.push([k2, v2]); return q; },
      get: async () => { const rows = [...store].filter(([, r]) => fs.every(([a, b]) => r[a] === b)); return { docs: rows.map(([id, r]) => ({ id, data: () => clone(r) })) }; } }; return q; } };
  const DEL = { __del: 1 };
  const users = { u: { status: 'active', registrationDone: true }, banned: { status: 'banned' } };
  const db = { collection: n => n === 'usdtIntents' ? intentsCol : { doc: id => ({ get: async () => ({ exists: id in users, data: () => users[id] }) }) } };
  let settings = { usdtEnabled: true, usdtRate: 4000, minDeposit: 20000, usdtWalletAddress: 'TWallet' };
  let rnd = n => nodeCrypto.randomInt(1, n);
  let handler; const app = { post: (p, h) => { if (p === '/deposit/usdt/intent') handler = h; } };
  const crypto = { randomInt: (a, b) => rnd(b) };
  const MAKE = () => new Function('app', 'db', 'verifyAuth', 'getSettings', 'MAX_MONEY_AMOUNT', 'fmtMoney', 'tsMillis', 'crypto', 'FieldValue', 'console',
    'function usdtMicrosText(m) { const t = String(m).padStart(7, "0"); return t.slice(0, -6) + "." + t.slice(-6); }\n' + routeSrc + '\nreturn { reset: () => _usdtIntentDebounce.clear() };')
    (app, db, async req => req.uid, async () => settings, 1e12, n => 'UGX ' + n, v => v instanceof Date ? v.getTime() : Number(v) || 0, crypto, { serverTimestamp: () => 'TS', delete: () => DEL }, console);
  const ctl = MAKE();
  const call = async (uid, body) => { ctl.reset(); const r = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } }; await handler({ uid, body }, r); return r; };

  let r = await call('u', { amountUsdt: 25 });
  ok(r.code === 200 && /^25\.000(00[1-9]|0[1-9]\d|[1-9]\d\d)$/.test(r.body.exactAmount), 'exact amount is the base plus a 1-999 micro tail: ' + r.body.exactAmount);
  eq([r.body.amountUgx, r.body.walletAddress], [100000, 'TWallet'], 'credit is for the base amount, address included');
  ok(r.body.expiresAt > Date.now() + 59 * 60000, 'reserved for about an hour');
  const first = r.body;
  r = await call('u', { amountUsdt: 25 }); eq(r.body.intentId, first.intentId, 'asking again for the same amount returns the same request');
  await call('u', { amountUsdt: 26 }); await call('u', { amountUsdt: 27 });
  r = await call('u', { amountUsdt: 28 }); ok(r.code === 429, 'a member can hold only three open requests');
  // uniqueness across many members asking for the same amount
  store.clear(); const seen = new Set();
  for (let i = 0; i < 150; i++) { users['m' + i] = { status: 'active', registrationDone: true }; const x = await call('m' + i, { amountUsdt: 25 }); ok(x.code === 200, 'allocated ' + i); seen.add(x.body.exactAmount); }
  eq(seen.size, 150, 'no two members were ever given the same exact amount');
  // exhaustion, then reclaim after expiry
  store.clear(); const saved = rnd; rnd = () => 7;
  users.a = users.b = { status: 'active', registrationDone: true };
  r = await call('a', { amountUsdt: 30 }); eq(r.body.exactAmount, '30.000007');
  r = await call('b', { amountUsdt: 30 }); ok(r.code === 503, 'amount taken and unexpired: nobody else can have it');
  eq(store.get('30000007').userId, 'a', 'the holder keeps it');
  store.get('30000007').expiresAt = new Date(Date.now() - 1000);
  r = await call('b', { amountUsdt: 30 }); ok(r.code === 200 && r.body.exactAmount === '30.000007', 'once expired it can be reclaimed');
  eq(store.get('30000007').userId, 'b', 'by exactly one new holder'); rnd = saved;
  // validation
  r = await call('u', { amountUsdt: 'x' }); eq(r.code, 400, 'junk amount');
  r = await call('u', { amountUsdt: 1 }); ok(r.code === 400 && /Minimum/.test(r.body.message), 'below the minimum');
  r = await call('banned', { amountUsdt: 25 }); eq(r.code, 403, 'suspended member');
  settings = { ...settings, usdtEnabled: false }; r = await call('u', { amountUsdt: 25 }); eq(r.code, 400, 'switched off');
  settings = { ...settings, usdtEnabled: true, usdtWalletAddress: '' }; r = await call('u', { amountUsdt: 25 }); eq(r.code, 400, 'no wallet configured');

  // wiring
  ok(/dep\.exactMicros \? \{ exactMicros: dep\.exactMicros/.test(src), 'resolveUsdtDeposit passes the exact amount to the verifier');
  const mod = fs.readFileSync(__dirname + '/user-src/original_module.js', 'utf8');
  ok(!/\/deposit\/usdt/.test(mod), 'the member app no longer carries a USDT deposit flow (removed from the design; the server routes stay)');
  ok(!/post\('\/deposit\/usdt\/submit', \{ amountUsdt/.test(mod), 'and no longer submits the old amount-and-hash form');
  console.log(`PASS: USDT payment requests (${checks} checks)`); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
