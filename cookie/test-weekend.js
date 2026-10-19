'use strict';
// No weekend rest and no weekend withdrawal block: every local midnight pays, any day of the week can withdraw. The four settings
// (weekend rest, weekend withdrawals, Trade Password, referral code required) are gone from the server, the admin panel and the app.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const acorn = require('acorn');
const src = fs.readFileSync(__dirname + '/server.js', 'utf8');
const ast = acorn.parse(src, { ecmaVersion: 'latest' });
const pick = names => names.map(n => { const f = ast.body.find(x => x.type === 'FunctionDeclaration' && x.id.name === n); assert.ok(f, n); return src.slice(f.start, f.end); }).join('\n');
const sched = new Function(`const tzOffMs = () => 10800000;
${pick(['eatNextMidnight', 'payoutFirstMs', 'payoutDueAtMs', 'payoutsDueCount', 'payoutInstants'])}
return { payoutDueAtMs, payoutsDueCount, payoutInstants };`)();
const eat = s => Date.parse(s + '+03:00');
const iso = ms => new Date(ms + 10800000).toISOString().slice(0, 16).replace('T', ' ');
// Bought Friday 15:00: Saturday, Sunday, Monday, Tuesday ... every midnight, no rest.
const fri = eat('2026-10-16T15:00:00');
assert.deepEqual(sched.payoutInstants(fri, 5).map(iso), ['2026-10-17 00:00', '2026-10-18 00:00', '2026-10-19 00:00', '2026-10-20 00:00', '2026-10-21 00:00']);
assert.equal(iso(sched.payoutDueAtMs(fri, 1)), '2026-10-17 00:00');
assert.equal(iso(sched.payoutDueAtMs(fri, 3)), '2026-10-19 00:00');
// What is due, to the second: nothing before the first midnight, one at it, one more each day, never beyond the cycle.
assert.equal(sched.payoutsDueCount(fri, eat('2026-10-16T23:59:59'), 8), 0);
assert.equal(sched.payoutsDueCount(fri, eat('2026-10-17T00:00:00'), 8), 1);
assert.equal(sched.payoutsDueCount(fri, eat('2026-10-18T00:00:00'), 8), 2);
assert.equal(sched.payoutsDueCount(fri, eat('2026-10-19T12:00:00'), 8), 3);
assert.equal(sched.payoutsDueCount(fri, eat('2027-03-01T00:00:00'), 8), 8);
// Bought on a Sunday: pays at Monday 00:00 as on any other day.
assert.equal(iso(sched.payoutDueAtMs(eat('2026-10-18T09:00:00'), 1)), '2026-10-19 00:00');
// Gone everywhere.
const admin = fs.readFileSync(__dirname + '/admin-src/index.html', 'utf8'), member = fs.readFileSync(__dirname + '/user-src/original_module.js', 'utf8'), html = fs.readFileSync(__dirname + '/user-src/index.html', 'utf8');
for (const [name, text] of [['server', src], ['admin', admin], ['app', member + html]]) {
  assert.ok(!/weekendCashbackPause|weekendWithdrawBlock|WEEKEND_CLOSED|weekendShut|weekendWithdrawShut|midnightPays/.test(text), name + ': no weekend rest or weekend withdrawal block');
  assert.ok(!/requireTradePassword|regTradeRow|openChangeTradePasswordSheet|witPin/.test(text), name + ': no Trade Password setting or screen');
  assert.ok(!/requireReferralCode|referralRequired|referralIsRequired|REFERRAL_REQUIRED|referralRequiredNow/.test(text), name + ': the referral code is simply optional');
}
assert.ok(!/Rest products at the weekend|No withdrawals on Saturday and Sunday|Ask for a Trade Password|Require a referral code to sign up/.test(admin), 'the four admin switches are gone');
assert.ok(!/transaction-pin|pinCheck|reset-payout-pin|transactionPinHash = /.test(src), 'no Trade Password code on the server');
console.log('PASS: no weekend rest, no weekend withdrawal block, no Trade Password, referral code optional');
