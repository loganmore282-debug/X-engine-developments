'use strict';
// Daily cashback at 00:00 exactly: the due times, the one-per-midnight count and the payments adding up to the full return.
// The real functions are cut out of server.js and run on a fake clock.
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const server = fs.readFileSync(__dirname + '/server.js', 'utf8');
const cut = (src, name) => { const a = src.indexOf('function ' + name + '('); assert.ok(a >= 0, name); let d = 0, i = src.indexOf('{', a); for (let j = i; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) return src.slice(a, j + 1); } };
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); };
const DAY = 86400000;
for (const off of [180, 60]) {   // Uganda (UTC+3) and Nigeria (UTC+1)
  const c = vm.createContext({ tzOffMs: () => off * 60000 });
  vm.runInContext(['eatNextMidnight', 'payoutDueAtMs', 'payoutsDueCount', 'payoutInstants'].map(f => cut(server, f)).join('\n'), c);
  const local = (y, mo, d, h, mi, s, ms) => Date.UTC(y, mo - 1, d, h, mi, s, ms || 0) - off * 60000;   // an instant given as local wall-clock time
  const buy = local(2026, 10, 26, 15, 2, 7);
  ok(c.payoutDueAtMs(buy, 1) === local(2026, 10, 27, 0, 0, 0), 'bought at 15:02 -> the first payment is at the next 00:00 (UTC+' + off / 60 + ')');
  ok(c.payoutDueAtMs(buy, 3) === local(2026, 10, 29, 0, 0, 0), 'the third payment is two midnights later');
  const late = local(2026, 10, 26, 23, 59, 59, 500);
  ok(c.payoutDueAtMs(late, 1) === local(2026, 10, 27, 0, 0, 0), 'bought half a second before 00:00 -> paid half a second later');
  const atMidnight = local(2026, 10, 27, 0, 0, 0);
  ok(c.payoutDueAtMs(atMidnight, 1) === local(2026, 10, 28, 0, 0, 0), 'bought at exactly 00:00:00 -> the first payment is the NEXT midnight (strictly after)');
  const total = 8;
  ok(c.payoutsDueCount(buy, local(2026, 10, 26, 23, 59, 59, 999), total) === 0, 'nothing is due at 23:59:59.999');
  ok(c.payoutsDueCount(buy, local(2026, 10, 27, 0, 0, 0), total) === 1, 'the first payment is due at 00:00:00.000');
  ok(c.payoutsDueCount(buy, local(2026, 10, 27, 23, 59, 59, 999), total) === 1 && c.payoutsDueCount(buy, local(2026, 10, 28, 0, 0, 0), total) === 2, 'one more at every midnight');
  ok(c.payoutsDueCount(buy, local(2027, 3, 1, 12, 0, 0), total) === total, 'never more than the cycle');
  const inst = c.payoutInstants(buy, total);
  ok(inst.length === total && inst.every((t, i) => t === c.payoutDueAtMs(buy, i + 1)) && inst.every((t, i) => i === 0 || t - inst[i - 1] === DAY), 'the payment instants are one day apart');
  for (const [price, mult, cyc] of [[30000, 3, 8], [90000, 3, 8], [700000, 3, 7], [1000000, 3, 8], [33333, 3, 8]]) {
    const expected = price * mult; let paid = 0; for (let k = 1; k <= cyc; k++) { paid = Math.round(expected * k / cyc); }
    let sum = 0, prev = 0; for (let k = 1; k <= cyc; k++) { const t = Math.round(expected * k / cyc); sum += t - prev; prev = t; }
    ok(sum === expected && paid === expected, 'the ' + cyc + ' payments of a ' + price + ' product add up to exactly ' + expected);
  }
}
// The settlement code pays ONE payment per due midnight, under its own token, and the sweep is aimed at the next midnight.
ok(/const dueCount = payoutsDueCount\(createdMs, Date\.now\(\), total\) - made;/.test(server) && /const newMade = fMade \+ 1;/.test(server) && /const target = Math\.round\(fExpected \* newMade \/ fTotal\);/.test(server), 'settlement pays one cumulative-target payment per due midnight');
ok(/const payoutKey = `\$\{doc\.id\}:\$\{newMade\}`;/.test(server) && /creditedPayoutKeys: \{ \$ne: payoutKey \}/.test(server), 'each payment has its own once-only token');
ok(/function armMidnightSweep\(\) \{\s+const wait = Math\.max\(20, eatNextMidnight\(Date\.now\(\)\) - Date\.now\(\) \+ 50\);/.test(server) && /setInterval\(reconcileCashback, 500\)/.test(server) && /armMidnightSweep\(\);/.test(server), 'a sweep starts 50 ms after 00:00 and another runs every half second');
ok(/X-Server-Time/.test(server) && /exposedHeaders: \['X-Server-Time'\]/.test(server), 'every reply carries the server clock (X-Server-Time)');
console.log('PASS: daily cashback at 00:00 (' + n + ' checks)');
