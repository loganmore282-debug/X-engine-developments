'use strict';
// Daily cashback every 24 hours from the purchase: the due times, the one-per-midnight count, the payments adding up to the full return, and the
// Orders countdown reading the same midnight. The real functions are cut out of server.js and run on a fake clock.
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const server = fs.readFileSync(__dirname + '/server.js', 'utf8'), mod = fs.readFileSync(__dirname + '/user-src/original_module.js', 'utf8');
const cut = (src, name) => { const a = src.indexOf('function ' + name + '('); assert.ok(a >= 0, name); let d = 0, i = src.indexOf('{', a); for (let j = i; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) return src.slice(a, j + 1); } };
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); };
const DAY = 86400000;
for (const off of [180, 60]) {   // Uganda (UTC+3) and Nigeria (UTC+1)
  const c = vm.createContext({ tzOffMs: () => off * 60000 });
  vm.runInContext(['payoutDueAtMs', 'payoutsDueCount', 'payoutInstants'].map(f => cut(server, f)).join('\n'), c);
  const local = (y, mo, d, h, mi, s, ms) => Date.UTC(y, mo - 1, d, h, mi, s, ms || 0) - off * 60000;   // an instant given as local wall-clock time
  const buy = local(2026, 10, 26, 15, 2, 7);
  ok(c.payoutDueAtMs(buy, 1) === local(2026, 10, 27, 15, 2, 7), 'bought at 15:02:07 -> the first payment is exactly 24 hours later (UTC+' + off / 60 + ')');
  ok(c.payoutDueAtMs(buy, 3) === local(2026, 10, 29, 15, 2, 7), 'the third payment is three days after the purchase');
  const late = local(2026, 10, 26, 23, 59, 59, 500);
  ok(c.payoutDueAtMs(late, 1) === local(2026, 10, 27, 23, 59, 59, 500), 'bought just before 00:00 -> still paid 24 hours later, not at midnight');
  const exact = local(2026, 10, 26, 15, 2, 34, 217);
  ok(c.payoutDueAtMs(exact, 1) === local(2026, 10, 27, 15, 2, 34, 217) && c.payoutDueAtMs(exact, 8) === local(2026, 11, 3, 15, 2, 34, 217), 'bought at 15:02:34.217 -> paid at exactly 15:02:34.217 every day, to the millisecond');
  ok(c.payoutsDueCount(exact, local(2026, 10, 27, 15, 2, 34, 216), 8) === 0 && c.payoutsDueCount(exact, local(2026, 10, 27, 15, 2, 34, 217), 8) === 1, 'not due one millisecond early, due on the millisecond');
  const total = 8;
  ok(c.payoutsDueCount(buy, local(2026, 10, 27, 15, 2, 6, 999), total) === 0, 'nothing is due one millisecond before 24 hours');
  ok(c.payoutsDueCount(buy, local(2026, 10, 27, 0, 0, 0), total) === 0, 'midnight pays nothing');
  ok(c.payoutsDueCount(buy, local(2026, 10, 27, 15, 2, 7), total) === 1, 'the first payment is due at 24 hours');
  ok(c.payoutsDueCount(buy, local(2026, 10, 28, 15, 2, 6, 999), total) === 1 && c.payoutsDueCount(buy, local(2026, 10, 28, 15, 2, 7), total) === 2, 'one more every 24 hours');
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
ok(/setInterval\(reconcileCashback, 500\)/.test(server) && !/armMidnightSweep/.test(server), 'the sweep runs every half second; there is no midnight timer');
// The member app does not draw a countdown any more (ChocoMCC's pages); it still notes the server's own clock (X-Server-Time) for the cash-out hours.
ok(/X-Server-Time/.test(mod) && /X-Server-Time/.test(server) && /exposedHeaders: \['X-Server-Time'\]/.test(server), 'the server sends its clock on every reply and the app reads it');
ok((server.match(/const boughtAt = new Date\(\);/g) || []).length === 3 && (server.match(/createdAt: boughtAt/g) || []).length === 3 && (server.match(/payoutDueAtMs\(boughtAt\.getTime\(\), 1\)/g) || []).length === 3, 'every purchase path stamps createdAt and the first payout time from ONE instant');
ok((server.match(/armPayoutAt\(boughtAt\.getTime\(\) \+ 86400000\)/g) || []).length === 3 && /armPayoutAt\(payoutDueAtMs\(createdMs, newMade \+ 1\)\)/.test(server) && /_sweepAgain/.test(server), 'a one-shot timer is aimed at each exact due instant, and an overlapping sweep re-runs at once');
console.log('PASS: daily cashback every 24 hours (' + n + ' checks)');
