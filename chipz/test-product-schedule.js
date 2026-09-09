/**
 * When a product is open, and what the app is told about it.
 *
 * Owner: "make when l can time any product on its opening duration ie it can
 * say coming soon in hh:mm:ss, make when l can put that this and this product
 * should be coming or opening at this time of day from this minute to this
 * minute, or even just putting as it is that coming soon."
 *
 * Three ways to close a product, and productOpenState() is the ONE place that
 * decides between them -- /public/products publishes its answer and
 * /invest/create enforces it, so the button and the money can never disagree.
 *
 * This runs the real function out of server.js rather than a copy: a test with
 * its own reimplementation of the schedule would pass while the server did
 * something else entirely.
 *
 * Everything here is in EAT (UTC+3), which is what the owner sets his times in
 * and what the rest of the server already uses (eatDayKey/eatNextMidnight).
 * The cases that matter are the ones that are easy to get wrong: a window whose
 * next opening is TOMORROW, and a window that WRAPS MIDNIGHT.
 */
const fs = require('fs');

const src = fs.readFileSync(__dirname + '/server.js', 'utf8');
const from = src.indexOf('function hhmmToMin');
const to = src.indexOf('function publicProductView');
if (from === -1 || to === -1 || to <= from) {
  console.log('FAIL  could not lift productOpenState out of server.js');
  process.exit(1);
}
const { hhmmToMin, productOpenState } =
  new Function(src.slice(from, to) + '; return { hhmmToMin, productOpenState };')();

let failed = 0;
const check = (ok, label) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); };
const iso = ms => (ms ? new Date(ms).toISOString() : '-');

// 15:00 EAT on a Wednesday.
const NOW = Date.parse('2026-09-09T12:00:00Z');
const at = (p, now = NOW) => productOpenState(p, now);

console.log('— the time parser —');
check(hhmmToMin('00:00') === 0, 'midnight is minute 0');
check(hhmmToMin('14:30') === 870, '14:30 is minute 870');
check(hhmmToMin('23:59') === 1439, '23:59 is the last minute');
for (const bad of ['24:00', '9:00', '14:60', '', 'noon', '1400', null]) {
  check(hhmmToMin(bad) === null, `${JSON.stringify(bad)} is rejected, not coerced`);
}

console.log('\n— the three ways to close a product —');
check(at({}).open === true, 'a product with no schedule is open');

const soon = at({ comingSoon: true });
check(soon.open === false && soon.mode === 'soon' && soon.opensAt === null,
  'comingSoon closes it with NO clock -- "or even just putting as it is that coming soon"');

const until = at({ openAt: NOW + 3600000 });
check(until.open === false && until.mode === 'until' && until.opensAt === NOW + 3600000,
  `openAt in the future counts down to it (${iso(until.opensAt)})`);
check(at({ openAt: NOW - 1 }).open === true,
  'and once that moment passes it is open for good');

console.log('\n— a daily window —');
check(at({ openFrom: '14:00', openTo: '16:00' }).open === true,
  'inside the window: open');
const before = at({ openFrom: '16:00', openTo: '18:00' });
check(before.open === false && before.opensAt === Date.parse('2026-09-09T13:00:00Z'),
  `before it: opens later TODAY (${iso(before.opensAt)})`);
// The one that is easy to get wrong -- yesterday's start time has passed, so
// the next opening is tomorrow's, not a moment in the past.
const after = at({ openFrom: '08:00', openTo: '10:00' });
check(after.open === false && after.opensAt === Date.parse('2026-09-10T05:00:00Z'),
  `after it: opens TOMORROW, not in the past (${iso(after.opensAt)})`);
check(after.opensAt > NOW, 'a countdown target is never behind us');

console.log('\n— a window that wraps midnight (22:00 → 02:00) —');
const W = { openFrom: '22:00', openTo: '02:00' };
const dayTime = at(W);                                        // 15:00 EAT
check(dayTime.open === false && dayTime.opensAt === Date.parse('2026-09-09T19:00:00Z'),
  `mid-afternoon: closed, opens 22:00 tonight (${iso(dayTime.opensAt)})`);
const lateNight = at(W, Date.parse('2026-09-09T20:30:00Z'));  // 23:30 EAT
check(lateNight.open === true, 'half an hour before midnight: OPEN');
check(lateNight.closesAt === Date.parse('2026-09-09T23:00:00Z'),
  `and it closes at 02:00, after midnight (${iso(lateNight.closesAt)})`);
const smallHours = at(W, Date.parse('2026-09-10T00:00:00Z')); // 03:00 EAT
check(smallHours.open === false, 'past 02:00: closed again');
check(smallHours.opensAt === Date.parse('2026-09-10T19:00:00Z'),
  `reopening tonight at 22:00 (${iso(smallHours.opensAt)})`);
// A wrapping window must not be mistaken for "no schedule".
check(at({ openFrom: '02:00', openTo: '22:00' }).open === true,
  'and the same times the other way round are an ordinary daytime window');

console.log('\n— precedence, and half-configured schedules —');
check(at({ comingSoon: true, openFrom: '00:00', openTo: '23:59' }).mode === 'soon',
  'comingSoon beats a window that would otherwise be open');
check(at({ comingSoon: true, openAt: NOW - 1 }).open === false,
  'and beats an openAt that has already passed');
// Half a window is not a schedule: it would read as "opens at 14:00" and then
// never close. Treated as no schedule here; REJECTED at save time by
// normaliseProduct, which is where the owner finds out.
check(at({ openFrom: '14:00' }).open === true, 'a from with no until is ignored, not half-applied');
check(at({ openTo: '14:00' }).open === true, 'and an until with no from likewise');
check(at({ openFrom: '14:00', openTo: '14:00' }).open === true,
  'a zero-length window is ignored rather than closing the product forever');

console.log('\n— what the app is sent —');
// publicProductView must publish an ABSOLUTE instant. A duration computed
// here and counted down on the phone would be wrong by hours for anyone whose
// clock is not on EAT.
const pv = src.slice(to, to + 900);
check(/opensAt: st\.opensAt/.test(pv), 'publicProductView sends opensAt as an instant');
check(/isOpen: st\.open/.test(pv), 'and isOpen, so the client never decides this itself');
// And the money path re-checks it rather than trusting the button.
check(/productOpenState\(liveTier, Date\.now\(\)\)\.open/.test(src),
  'and /invest/create re-checks the LIVE product against the clock');

console.log(failed ? `\n${failed} FAILED` : '\nproduct schedule: all cases pass');
process.exit(failed ? 1 : 0);
