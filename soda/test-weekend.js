'use strict';
// Weekend rest: no cashback credited at 00:00 Sunday or 00:00 Monday (for Saturday / Sunday), and no withdrawal requests on Saturday or Sunday.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const acorn = require('acorn');
const src = fs.readFileSync(__dirname + '/server.js', 'utf8');
const ast = acorn.parse(src, { ecmaVersion: 'latest' });
const pick = names => names.map(n => { const f = ast.body.find(x => x.type === 'FunctionDeclaration' && x.id.name === n); assert.ok(f, n); return src.slice(f.start, f.end); }).join('\n');
const make = paused => new Function(`const tzOffMs = () => 10800000; let _settingsCache = { weekendCashbackPause: ${paused} }; const DEFAULT_SETTINGS = {};
${pick(['eatNextMidnight', 'weekendCashbackPaused', 'midnightPays', 'eatWeekday', 'payoutDueAtMs', 'payoutsDueCount', 'payoutInstants'])}
return { payoutDueAtMs, payoutsDueCount, payoutInstants, eatWeekday };`)();
const on = make(true), off = make(false);
const eat = s => Date.parse(s + '+03:00');
const iso = ms => new Date(ms + 10800000).toISOString().slice(0, 16).replace('T', ' ');
// 2026-10-16 is a Friday, 10-17 Saturday, 10-18 Sunday, 10-19 Monday, 10-20 Tuesday.
assert.equal(on.eatWeekday(eat('2026-10-17T10:00:00')), 6); assert.equal(on.eatWeekday(eat('2026-10-18T10:00:00')), 0);
// Bought Friday afternoon: Friday's day is credited at 00:00 Saturday, then the product rests until Monday's day is credited at 00:00 Tuesday.
const fri = eat('2026-10-16T15:00:00');
assert.equal(iso(on.payoutDueAtMs(fri, 1)), '2026-10-17 00:00');
assert.equal(iso(on.payoutDueAtMs(fri, 2)), '2026-10-20 00:00');
assert.equal(iso(on.payoutDueAtMs(fri, 3)), '2026-10-21 00:00');
assert.equal(iso(on.payoutDueAtMs(fri, 6)), '2026-10-24 00:00');   // Saturday 00:00 (for Friday)
assert.equal(iso(on.payoutDueAtMs(fri, 7)), '2026-10-27 00:00');   // then the next Tuesday
// Bought Saturday or Sunday: nothing is credited until Tuesday 00:00.
assert.equal(iso(on.payoutDueAtMs(eat('2026-10-17T09:00:00'), 1)), '2026-10-20 00:00');
assert.equal(iso(on.payoutDueAtMs(eat('2026-10-18T23:59:00'), 1)), '2026-10-20 00:00');
// Bought Monday: Tue, Wed, Thu, Fri, Sat midnights, then Tuesday again.
const mon = eat('2026-10-19T08:00:00');
assert.deepEqual(on.payoutInstants(mon, 6).map(iso), ['2026-10-20 00:00', '2026-10-21 00:00', '2026-10-22 00:00', '2026-10-23 00:00', '2026-10-24 00:00', '2026-10-27 00:00']);
// Counting what is due: Sunday 00:00 and Monday 00:00 add nothing; the exact Saturday and Tuesday midnights do.
assert.equal(on.payoutsDueCount(fri, eat('2026-10-16T23:59:59'), 8), 0);
assert.equal(on.payoutsDueCount(fri, eat('2026-10-17T00:00:00'), 8), 1);
assert.equal(on.payoutsDueCount(fri, eat('2026-10-18T00:00:00'), 8), 1);
assert.equal(on.payoutsDueCount(fri, eat('2026-10-19T12:00:00'), 8), 1);
assert.equal(on.payoutsDueCount(fri, eat('2026-10-20T00:00:00'), 8), 2);
assert.equal(on.payoutsDueCount(fri, eat('2027-03-01T00:00:00'), 8), 8);            // never more than the cycle
// Switched off: the old every-midnight schedule, exactly.
assert.equal(iso(off.payoutDueAtMs(fri, 2)), '2026-10-18 00:00');
assert.equal(off.payoutsDueCount(fri, eat('2026-10-19T12:00:00'), 8), 3);
// The server really applies the rule: the withdrawal route, the purchase hints, the admin switches and the member screen.
assert.match(src, /sett\.weekendWithdrawBlock !== false && !unrestricted && \[0, 6\]\.includes\(eatWeekday\(Date\.now\(\)\)\)/);
assert.match(src, /code: 'WEEKEND_CLOSED'/);
assert.equal((src.match(/nextPayoutAt: new Date\(payoutDueAtMs\(Date\.now\(\), 1\)\)/g) || []).length, 2);
assert.match(src, /weekendCashbackPause: true, weekendWithdrawBlock: true/);
assert.match(src, /'weekendCashbackPause', 'weekendWithdrawBlock'/);
const admin = fs.readFileSync(__dirname + '/admin-src/index.html', 'utf8');
assert.ok(/id="sWeekendCash"/.test(admin) && /id="sWeekendWit"/.test(admin) && /weekendCashbackPause:\$\('sWeekendCash'\)\.checked, weekendWithdrawBlock:\$\('sWeekendWit'\)\.checked/.test(admin));
const member = fs.readFileSync(__dirname + '/user-src/original_module.js', 'utf8');
assert.ok(/function weekendWithdrawShut\(s\)/.test(member) && /Withdrawals are closed on Saturday and Sunday/.test(member));
console.log('PASS: weekend rest (cashback skips Saturday and Sunday credits; no weekend withdrawals)');
