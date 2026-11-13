'use strict';
// Admin analytics "Plans": active plans, maturity dates and most purchased, using the server's own code on fake contract snapshots.
const fs = require('node:fs'), assert = require('node:assert/strict'), acorn = require('acorn');
const src = fs.readFileSync(__dirname + '/server.js', 'utf8'), admin = fs.readFileSync(__dirname + '/admin-src/index.html', 'utf8');
const tree = acorn.parse(src, { ecmaVersion: 'latest' });
const fn = name => { const n = tree.body.find(x => x.type === 'FunctionDeclaration' && x.id.name === name); assert(n, name); return src.slice(n.start, n.end); };
const a = src.indexOf('    const plans = { active:'), endMark = 'plans._upcoming = upcoming.sort((a, b) => a.at - b.at).slice(0, 25);\n    }\n';
const block = src.slice(a, src.indexOf(endMark, a) + endMark.length);
const run = new Function('contractSnap', 'activeInvSnap', 'mine', 'nowMs', 'accounts', `const tzOffMs = () => 10800000;
${['tsMillis', 'eatDayKey', 'eatNextMidnight', 'payoutFirstMs', 'payoutDueAtMs', 'finiteMoney'].map(fn).join('\n')}
${block}
plans.nextMaturing = plans._upcoming.map(u => ({ phone: (accounts.get(u.userId) || {}).phone || '', product: u.product, amount: u.amount, cashback: u.cashback, at: u.at })); delete plans._upcoming;
return plans;`);
const snap = rows => ({ forEach: f => rows.forEach((r, i) => f({ id: 'i' + i, data: () => r })) });
const at = s => new Date(s);
const base = { status: 'active', userId: 'u1', tierKey: 'p1', tierLabel: 'Product-1', createdAt: at('2026-10-02T21:00:00Z'), payoutsTotal: 3, payoutsMade: 0, expectedReturn: 900, amount: 300, paidOut: 0 };
const rows = [base, { ...base, userId: 'u2' }, { ...base, tierKey: 'p2', tierLabel: 'Product-2', amount: 600, expectedReturn: 1800 }, { ...base, status: 'matured', payoutsMade: 3, paidOut: 900 }];
const active = rows.filter(r => r.status === 'active');
const accounts = new Map([['u1', { phone: '256700000001' }]]);
const early = run(snap(rows), snap(active), () => true, Date.parse('2026-10-04T21:00:00Z'), accounts);
const plans = run(snap(rows), snap(active), () => true, Date.parse('2026-10-07T09:00:00Z'), accounts);
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); };
ok(plans.active.count === 3 && plans.active.invested === 1200 && plans.active.expected === 3600 && plans.active.remaining === 3600, 'active plans: count, invested, expected, still to pay');
ok(plans.mostPurchased[0].key === 'p1' && plans.mostPurchased[0].purchases === 3 && plans.mostPurchased[0].active === 2 && plans.mostPurchased[1].key === 'p2' && plans.mostPurchased[1].purchases === 1, 'most purchased: p1 bought 3 times (2 still active), p2 once');
ok(plans.maturities.length === 1 && plans.maturities[0].count === 3 && plans.maturities[0].cashback === 3600, 'overdue plans are counted on today');
ok(plans.active.dueNow === 3 && early.active.dueNow === 0, 'plans past their last payment time are counted');
ok(early.maturities.length === 1 && early.maturities[0].day === '2026-10-06' && early.nextMaturing[0].at === Date.parse('2026-10-05T21:00:00Z'), 'a plan that has not closed yet is listed on the day of its last payment (6 October, Uganda time)');
ok(plans.nextMaturing.length === 3 && plans.nextMaturing[0].phone === '256700000001', 'the next plans to mature carry the member phone');
ok(/Plans: active, maturity dates and most purchased/.test(admin) && /Most purchased products/.test(admin) && /Maturity dates/.test(admin) && /Next plans to mature/.test(admin), 'the admin Analytics tab shows the Plans card');
console.log('PASS: admin plans analytics (' + n + ' checks)');
