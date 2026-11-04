'use strict';
// Earnings are credited at local midnight (00:00 Ethiopia time), every night of the week: the k-th payment falls at the k-th midnight after the purchase.
const fs = require('node:fs'), assert = require('node:assert/strict'), acorn = require('acorn');
const src = fs.readFileSync(__dirname + '/server.js', 'utf8');
const ast = acorn.parse(src, { ecmaVersion: 'latest' });
const pick = names => names.map(n => { const f = ast.body.find(x => x.type === 'FunctionDeclaration' && x.id.name === n); assert.ok(f, n); return src.slice(f.start, f.end); }).join('\n');
const api = new Function(`const tzOffMs = () => 10800000;\n${pick(['eatNextMidnight', 'payoutDueAtMs', 'payoutsDueCount', 'payoutInstants'])}\nreturn { payoutDueAtMs, payoutsDueCount, payoutInstants };`)();
const eat = s => Date.parse(s + '+03:00');
const show = ms => new Date(ms + 10800000).toISOString().slice(0, 16).replace('T', ' ');
// 2026-10-20 is a Tuesday. Bought at 15:00 -> the first payment is at 00:00 the next day, then every midnight.
const bought = eat('2026-10-20T15:00:00');
assert.equal(show(api.payoutDueAtMs(bought, 1)), '2026-10-21 00:00');
assert.equal(show(api.payoutDueAtMs(bought, 2)), '2026-10-22 00:00');
assert.equal(show(api.payoutDueAtMs(bought, 5)), '2026-10-25 00:00', 'Sunday 00:00 pays like any other night');
assert.equal(show(api.payoutDueAtMs(bought, 6)), '2026-10-26 00:00', 'and so does Monday 00:00');
assert.equal(api.payoutsDueCount(bought, eat('2026-10-20T23:59:59'), 30), 0, 'nothing a second before midnight');
assert.equal(api.payoutsDueCount(bought, eat('2026-10-21T00:00:00'), 30), 1, 'one at exactly 00:00');
assert.equal(api.payoutsDueCount(bought, eat('2026-10-26T00:00:00'), 30), 6, 'six by the Monday midnight: no night is skipped');
assert.equal(api.payoutsDueCount(bought, eat('2027-03-01T00:00:00'), 8), 8, 'never more than the total');
assert.deepEqual(api.payoutInstants(bought, 3).map(show), ['2026-10-21 00:00', '2026-10-22 00:00', '2026-10-23 00:00']);
// bought a second after midnight: the first payment is the NEXT midnight, a full day later
const justAfter = eat('2026-10-20T00:00:01');
assert.equal(show(api.payoutDueAtMs(justAfter, 1)), '2026-10-21 00:00');
// the code has no weekend rule left anywhere
assert.ok(!/weekend|midnightPays|eatWeekday|WEEKEND_CLOSED/i.test(src.replace(/\/\/[^\n]*/g, '')), 'no weekend code in the server');
assert.ok(!/weekend/i.test(fs.readFileSync(__dirname + '/user-src/original_module.js', 'utf8')), 'none in the member app');
assert.ok(!/weekend/i.test(fs.readFileSync(__dirname + '/admin-src/index.html', 'utf8')), 'none in the admin panel');
console.log('PASS: earnings are credited at 00:00 every night (no weekend rule left)');
