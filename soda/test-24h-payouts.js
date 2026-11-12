'use strict';
// Earnings are credited 24 hours after the purchase, then every 24 hours: the k-th payment falls exactly k x 24 hours after the purchase instant,
// whatever the clock says (owner: "make sure cashback is 24hrs not midnight").
const fs = require('node:fs'), assert = require('node:assert/strict'), acorn = require('acorn');
const src = fs.readFileSync(__dirname + '/server.js', 'utf8');
const ast = acorn.parse(src, { ecmaVersion: 'latest' });
const pick = names => names.map(n => { const f = ast.body.find(x => x.type === 'FunctionDeclaration' && x.id.name === n); assert.ok(f, n); return src.slice(f.start, f.end); }).join('\n');
const api = new Function(`${pick(['payoutDueAtMs', 'payoutsDueCount', 'payoutInstants'])}\nreturn { payoutDueAtMs, payoutsDueCount, payoutInstants };`)();
const at = s => Date.parse(s + 'Z');
const show = ms => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
const DAY = 86400000;
const bought = at('2026-10-20T15:07:00');
assert.equal(show(api.payoutDueAtMs(bought, 1)), '2026-10-21 15:07', 'first payment 24 hours after purchase');
assert.equal(show(api.payoutDueAtMs(bought, 2)), '2026-10-22 15:07');
assert.equal(show(api.payoutDueAtMs(bought, 6)), '2026-10-26 15:07', 'every day alike, weekends too');
assert.equal(api.payoutDueAtMs(bought, 3) - api.payoutDueAtMs(bought, 2), DAY, 'always exactly 24 hours apart');
assert.equal(api.payoutsDueCount(bought, bought + DAY - 1, 30), 0, 'nothing a millisecond before 24 hours');
assert.equal(api.payoutsDueCount(bought, bought + DAY, 30), 1, 'one at exactly 24 hours');
assert.equal(api.payoutsDueCount(bought, at('2026-10-21T00:00:00'), 30), 0, 'and NOT at the next midnight');
assert.equal(api.payoutsDueCount(bought, bought + 6 * DAY, 30), 6, 'six after six days: no day is skipped');
assert.equal(api.payoutsDueCount(bought, bought + 400 * DAY, 8), 8, 'never more than the total');
assert.deepEqual(api.payoutInstants(bought, 3).map(show), ['2026-10-21 15:07', '2026-10-22 15:07', '2026-10-23 15:07']);
// the due-count and the due-instant agree for every k
for (let k = 1; k <= 10; k++) assert.equal(api.payoutsDueCount(bought, api.payoutDueAtMs(bought, k), 30), k);
// no midnight timer is left in the server
assert.ok(!/armMidnightSweep/.test(src), 'no midnight sweep timer');
assert.ok(!/payoutEatMidnight|migratePayoutsToMidnightOnce/.test(src), 'no midnight migration');
assert.ok(!/weekend/i.test(src.replace(/\/\/[^\n]*/g, '')), 'no weekend code in the server');
assert.ok(!/weekend/i.test(fs.readFileSync(__dirname + '/user-src/original_module.js', 'utf8')), 'none in the member app');
assert.ok(!/weekend/i.test(fs.readFileSync(__dirname + '/admin-src/index.html', 'utf8')), 'none in the admin panel');
console.log('PASS: earnings are credited 24 hours after purchase, then every 24 hours');
