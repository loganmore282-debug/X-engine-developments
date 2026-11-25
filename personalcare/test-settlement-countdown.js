'use strict';
// The settlement countdown: the time left to the product's next cashback (24 hours after the one before; older products: the next midnight), on the SERVER's clock.
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const mod = fs.readFileSync(__dirname + '/user-src/original_module.js', 'utf8'), server = fs.readFileSync(__dirname + '/server.js', 'utf8');
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); };
const grab = (name) => { const a = mod.indexOf('function ' + name + '('); assert(a > -1, name); let d = 0, i = mod.indexOf('{', a); for (; i < mod.length; i++) { if (mod[i] === '{') d++; else if (mod[i] === '}' && --d === 0) break; } return mod.slice(a, i + 1); };
const sync = mod.slice(mod.indexOf('var _clockSkew = 0'), mod.indexOf('function api(path, opts){'));
const DAY = 86400000;
function load(offMin) {
  const c = { REGION: { utcOffsetMin: offMin }, Date, Math, Number, String };
  vm.createContext(c);
  vm.runInContext([grab('tzOffMs'), sync, grab('nextMidnightMs'), grab('nextPayoutMs'), grab('fmtCountdown'), grab('fmtPayLeft')].join('\n'), c);
  return c;
}
// 1. every region offset, hundreds of instants: the target is a real local midnight, never more than a day away, never in the past
for (const off of [180, 0, -300, 330, 545, -210, 60, 720]) {
  const c = load(off);
  for (let k = 0; k < 400; k++) {
    const now = 1.76e12 + Math.floor(Math.random() * 40 * DAY);
    const t = c.nextMidnightMs(now);
    ok(t > now && t - now <= DAY, 'within the next 24 hours (offset ' + off + ')');
    ok((t + off * 60000) % DAY === 0, 'lands exactly on 00:00:00 of the region (offset ' + off + ')');
  }
}
// 2. the rollover: one millisecond before midnight there is one second left; at midnight a whole new day starts
{
  const c = load(180), mid = Date.UTC(2026, 9, 18, 21, 0, 0);   // 00:00 on 19 Oct in Kampala (UTC+3)
  ok(c.nextMidnightMs(mid - 1) === mid, '1 ms before midnight the target is that midnight');
  ok(c.nextMidnightMs(mid) === mid + DAY, 'at midnight the target is the next one');
  ok(c.fmtCountdown(mid - (mid - 1), true) === '00:00:01', 'the last millisecond reads 00:00:01');
  ok(c.fmtCountdown(0, true) === '00:00:00', 'zero reads 00:00:00');
  ok(c.fmtCountdown(DAY, true) === '23:59:59', 'a full day left reads 23:59:59, never 24:00:00');
  ok(c.fmtCountdown(DAY - 1, true) === '23:59:59', '23:59:59.999 left reads 23:59:59');
  ok(c.fmtCountdown(3 * 3600000 + 25 * 60000 + 7000, true) === '03:25:07', 'hours, minutes, seconds');
  ok(c.nextMidnightMs(Date.UTC(2026, 9, 18, 12, 0, 0)) - Date.UTC(2026, 9, 18, 12, 0, 0) === 9 * 3600000, 'noon in Kampala (09:00 UTC) is 12 hours before midnight');
}
// 3. a phone clock that is wrong still counts correctly because the server's clock is used
{
  const c = load(180), real = Date.UTC(2026, 9, 18, 20, 59, 0);   // server: one minute before midnight in Kampala
  const phone = real + 7 * 60000;                                  // phone clock seven minutes fast
  c.Date = Date; const sentAt = phone, gotAt = phone + 200;
  vm.runInContext('Date.now = () => 0', c);   // not used by ckSyncClock beyond arguments
  c.ckSyncClock(real + 100, sentAt, gotAt);
  vm.runInContext('globalThis.__phone = ' + phone + '; Date = { now: () => globalThis.__phone + 500 }', c);
  const now = vm.runInContext('ckNow()', c);
  ok(Math.abs(now - (real + 500 + 0)) <= 120, 'the figure follows the server clock, not the phone clock (off by ' + (now - real - 500) + ' ms)');
  const left = vm.runInContext('nextMidnightMs() - ckNow()', c);
  ok(left > 58000 && left < 60000, 'about a minute left, as the server says (' + left + ' ms)');
}
// 4. wiring
ok(/serverNow: Date\.now\(\)/.test(server), 'the investments list carries the server clock');
ok(/r\.serverNow === 'number'\) ckSyncClock/.test(mod), 'every investments answer re-syncs the phone against the server');
ok(/const left = Number\(el\.getAttribute\('data-pay-at'\)\) - now/.test(mod) && !/Date\.now\(\)\s*-\s*Number\(el/.test(mod), 'the countdown never reads the phone clock directly');
ok(/setTimeout\(tick, \(\(isFinite\(soonest\) \? soonest % 1000 : 0\) \|\| 1000\) \+ 15\)/.test(mod), 'it ticks on the second boundary');
ok(/fmtPayLeft\(nextPayoutMs\(inv\) - ckNow\(\), st\.newRule\)/.test(mod) && /fmtPayLeft\(left, el\.getAttribute\('data-long'\) === '1'\)/.test(mod), 'the first figure on a card uses the same rule as the ticks');
ok(/left <= 0/.test(mod) && /api\('\/investments'\)/.test(mod), 'when a payment falls due the list is read again so the cashback shows');
// 5. cashback every 24 hours: the countdown runs to this product's next payment
{
  const c = load(180), now = Date.UTC(2026, 9, 18, 12, 0, 0), first = now - 5 * 3600000;
  const iso = new Date(first).toISOString();
  ok(c.nextPayoutMs({ payoutFirstAt: iso, payoutsMade: 0 }, now) === first, 'a product whose first payment is still ahead counts to it');
  ok(c.nextPayoutMs({ payoutFirstAt: iso, payoutsMade: 1 }, now) === first + DAY, 'one payment made: the next is 24 hours after the first');
  ok(c.nextPayoutMs({ payoutFirstAt: iso, payoutsMade: 3 }, now) === first + 3 * DAY, 'three payments made: first + 3 days');
  ok(c.nextPayoutMs({ payoutsMade: 2 }, now) === c.nextMidnightMs(now), 'a product bought before this rule still counts to midnight');
  const bought = now; ok(c.fmtCountdown(bought + DAY - now, true) === '23:59:59', 'a product bought this second reads 23:59:59');
}
// 3. the new hourly / Locking rule: the real time left, never capped at 23:59:59; days shown once there are any
{
  const c = load(180), H = 3600000;
  ok(c.fmtPayLeft(7 * DAY, true) === '7d 00:00:00', 'a Locking product 7 days from release reads 7d 00:00:00, not a stuck 23:59:59');
  ok(c.fmtPayLeft(7 * DAY - 1000, true) === '6d 23:59:59' && c.fmtPayLeft(7 * DAY - 2000, true) === '6d 23:59:58', 'and it counts down every second');
  ok(c.fmtPayLeft(DAY + 3661000, true) === '1d 01:01:01', 'one day and a bit');
  ok(c.fmtPayLeft(DAY, true) === '1d 00:00:00' && c.fmtPayLeft(DAY - 1000, true) === '23:59:59', 'under a day it is plain HH:MM:SS');
  ok(c.fmtPayLeft(H, true) === '01:00:00' && c.fmtPayLeft(1, true) === '00:00:01' && c.fmtPayLeft(0, true) === '00:00:00' && c.fmtPayLeft(-5, true) === '00:00:00', 'an hourly share: an hour down to the last second, never negative');
  ok(c.fmtPayLeft(DAY, false) === '23:59:59', 'an older product keeps the midnight style');
  const first = Date.UTC(2026, 10, 25, 12, 0, 0);
  ok(c.nextPayoutMs({ payoutFirstAt: new Date(first).toISOString(), payoutsMade: 5, periodMs: H }, first) === first + 5 * H, 'an hourly product counts to the next hour after the shares made');
  ok(c.nextPayoutMs({ payoutFirstAt: new Date(first).toISOString(), payoutsMade: 0, periodMs: 7 * DAY }, first - 3 * H) === first, 'a Locking product counts to its release');
}
console.log('PASS: settlement countdown (' + n + ' checks)');
