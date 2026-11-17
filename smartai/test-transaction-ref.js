'use strict';
// Every new transaction id (a payment reference or a ledger id) is 24 random characters, digits and letters alternating evenly (4a5f6e7d8c9b0a1f2e3d4c5b), shown on ONE line.
//   node test-transaction-ref.js
const fs = require('node:fs'), crypto = require('node:crypto'), assert = require('node:assert/strict'), vm = require('node:vm');
const src = fs.readFileSync(__dirname + '/server.js', 'utf8'), admin = fs.readFileSync(__dirname + '/admin-src/index.html', 'utf8'), page = fs.readFileSync(__dirname + '/user-src/index.html', 'utf8');
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); }; const eq = (a, b, m) => { n++; assert.deepEqual(a, b, m); };
const a = src.indexOf('const TXN_ID_RE'), b = src.indexOf('function tsMillis(v)');
ok(a > 0 && b > a, 'the id maker is in the server');
const refA = src.indexOf('async function uniqueRef()'), refB = src.indexOf('// DAILY SALARY tiers');
const mk = db => { const ctx = { crypto, db }; vm.createContext(ctx); vm.runInContext(src.slice(a, b) + '\n' + src.slice(refA, refB) + '\nthis.newTxnId = newTxnId; this.newStatementId = newStatementId; this.statementIdFor = statementIdFor; this.uniqueRef = uniqueRef;', ctx); return ctx; };
const emptyDb = { collection: () => ({ where: () => ({ limit: () => ({ get: async () => ({ empty: true }) }) }) }) };
const c = mk(emptyDb);
const ids = Array.from({ length: 20000 }, () => c.newTxnId());
ok(ids.every(x => /^(?:\d[a-f]){12}$/.test(x)), 'every id is exactly 24 lowercase hexadecimal characters');
ok(new Set(ids).size === ids.length, 'no id repeats in 20,000');
const dig = new Array(10).fill(0), let6 = new Array(6).fill(0); let badMix = 0;
ids.forEach(x => { for (let i = 0; i < 24; i++) { const ch = x[i]; if (i % 2 === 0) { if (!/\d/.test(ch)) badMix++; dig[+ch]++; } else { if (!/[a-f]/.test(ch)) badMix++; let6['abcdef'.indexOf(ch)]++; } } });
ok(badMix === 0, 'digits and letters alternate all the way: a digit, a letter, a digit, a letter ... (never two digits or two letters side by side)');
const per = ids.length * 12;
ok(dig.every(k => k > per / 10 * 0.95 && k < per / 10 * 1.05) && let6.every(k => k > per / 6 * 0.95 && k < per / 6 * 1.05), 'every digit 0-9 and every letter a-f turns up equally often (an even mix, nothing in the id follows the clock or a counter)');
const cols = Array.from({ length: 24 }, (_, i) => new Set(ids.map(x => x[i])).size); ok(cols.every((k, i) => k === (i % 2 ? 6 : 10)), 'every position takes all of its possible values');
ok(/crypto\.randomInt\(10\) \+ 'abcdef'\[crypto\.randomInt\(6\)\]/.test(src), 'every character is drawn with the operating system\'s cryptographic random generator, without bias');
ok(!/Math\.random\(\)[^;\n]*(ref|Ref|txn|Txn)/.test(src.slice(a, refB)), 'no weak random generator in the id code');
ok(/^(?:\d[a-f]){12}$/.test(c.newStatementId()), 'ledger rows get the same kind of id');
// an old ledger row (no id stored, or one in an older shape) shows a stable id of the same kind, different for each row
const doc = (id, row) => ({ id, data: () => row });
const s1 = c.statementIdFor(doc('abc', {})), s1b = c.statementIdFor(doc('abc', { statementId: 'B2260922051456178' })), s2 = c.statementIdFor(doc('abd', {}));
ok(/^(?:\d[a-f]){12}$/.test(s1) && s1 === c.statementIdFor(doc('abc', {})) && s1 === s1b && s1 !== s2, 'an old row shows the same new-shape id every time, and a different one per row');
eq(c.statementIdFor(doc('abc', { statementId: '4a5f6e7d8c9b0a1f2e3d4c5b' })), '4a5f6e7d8c9b0a1f2e3d4c5b', 'a stored id of the new kind is kept');
// payment references: random, checked against both lists, and a clash draws again
(async () => {
  const r = await c.uniqueRef(); ok(/^(?:\d[a-f]){12}$/.test(r), 'a payment reference is the same kind of id (no letter, no date)');
  let calls = 0; const clash = mk({ collection: () => ({ where: () => ({ limit: () => ({ get: async () => ({ empty: ++calls > 2 }) }) }) }) });
  const r2 = await clash.uniqueRef(); ok(/^(?:\d[a-f]){12}$/.test(r2) && calls >= 4, 'an id already used by a recharge or a withdrawal is thrown away and another is drawn');
  // retired settings and where the ids are used
  ok(!/mobileMoneyRefPrefix|sanitizeRefPrefix|stampRef/.test(src) && !/uniqueRef\('/.test(src), 'the old letter + date + digits reference is gone from the server');
  ok(!/sRefPrefix/.test(admin) && !/referencePrefix/.test(admin), 'the "Payment reference starts with" box is gone from the admin panel');
  ok(/delete updates\.referencePrefix/.test(src), 'an old admin page that still sends it is ignored');
  ok((src.match(/await uniqueRef\(\)/g) || []).length === 3, 'recharges (automatic and manual) and withdrawals all use it');
  ok(/\.rec-ref\{[^}]*white-space:nowrap/.test(page) && !/\.rec-ref\{[^}]*break-all/.test(page), 'in the Ledger the id stays on one line');
  ok(/id="depStatusRef" style="[^"]*white-space:nowrap/.test(page) && !/id="depStatusRef" style="[^"]*break-all/.test(page), 'on the payment review page it stays on one line too');
  console.log(`PASS: transaction ids are 24 random characters, digits and letters alternating (${n} checks)`);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
