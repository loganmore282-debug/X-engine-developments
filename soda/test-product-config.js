#!/usr/bin/env node
/**
 * Exercises the two per-product money rules against the REAL code pulled out
 * of server.js, rather than a paraphrase of it:
 *   1. productExpectedReturn -- each product's own multiplier decides its
 *      payout, so two products can run different rates.
 *   2. sanitizeProductInput -- what a product save accepts and how a refusal names its field.
 *
 * Both decide what a member is actually paid, and neither can be tested by
 * booting the server here (it needs MongoDB), so they are tested directly.
 */
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/server.js', 'utf8');
// READ out of server.js, not restated. These feed the real
// sanitizeProductInput() lifted below, so a wrong value here would test a
// validator that does not exist. A constant that is only ever read cannot drift.
const serverConst = name => {
  const m = new RegExp('const ' + name + ' = ([0-9_]+)').exec(src);
  if (!m) throw new Error(`server.js no longer declares ${name} as a plain number`);
  return Number(m[1].replace(/_/g, ''));
};
const MAX_MONEY_AMOUNT = serverConst('MAX_MONEY_AMOUNT');
const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const slice = (a, b) => src.slice(src.indexOf(a), src.indexOf(b));
eval(slice('function productExpectedReturn', 'function sanitizeProductInput'));
eval(slice('function sanitizeProductInput', "app.post('/admin/products/add-starters'"));
// Lifted here rather than further down (where publicProductView is needed)
// because sanitizeProductInput() calls the HH:MM parser for a product's daily
// window -- the field-naming cases below exercise that path, and without this
// they would die on an undefined helper instead of failing an assertion. The
// slice runs to /public/products because the product view calls
// productOpenState, which sits between the two.
eval(slice('function hhmmToMin', "app.get('/public/products'"));

// A product needs a cycle (days) and a multiplier or total payout now; the cases below are about OTHER fields, so they get an ordinary one unless they set their own.
const sanitize = (p, order, why) => sanitizeProductInput({ cycle: 8, multiplier: 3, ...p }, order, why);
let failed = 0;
const check = (ok, label) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); };

console.log('— per-product multiplier —');
for (const [p, expected, label] of [
  [{ price: 30000, multiplier: 3 }, 90000, 'multiplier 3x'],
  [{ price: 30000, multiplier: 5 }, 150000, 'multiplier 5x — a different product may run a different rate'],
  [{ price: 30000, expectedReturn: 120000 }, 120000, 'explicit total payout, no multiplier'],
  [{ price: 30000, multiplier: 4, expectedReturn: 1 }, 120000, 'multiplier wins over a stale expectedReturn'],
  [{ price: 30000 }, 900000, 'neither set — falls back to the global multiple'],
]) check(productExpectedReturn(p, { returnMultiple: 30 }) === expected, label);

console.log('\n— what a product save accepts —');
for (const [p, shouldAccept, label] of [
  [{ key: 'p1', name: 'Product-1', price: 30000 }, true, 'an ordinary product is accepted'],
  [{ key: 'p5', name: 'Product-5', price: 1, multiplier: -2 }, false, 'negative multiplier rejected'],
]) check(!!sanitize(p, 0) === shouldAccept, label);

// ── A refused save must name the field that refused it ──
// Report that prompted this: a product failed to save and the panel printed "has an invalid key, name,
// price, or (if given) cycle/return" -- which did not name the box that was wrong. There are many separate
// refusals in sanitize() and they all shared that sentence.
//
// Asserted by RUNNING the validator with the out-parameter and then RUNNING
// the route's own message builder over what it wrote: a text match on the
// template would pass for a route that fills in the wrong field, or none.
console.log('\n— a refused product save names the failing field —');
for (const [p, field, label] of [
  [{ key: 'bad key!', name: 'X', price: 1 }, 'Key', 'a key with a space'],
  [{ key: 'p', name: '', price: 1 }, 'Name', 'a blank name'],
  [{ key: 'p', name: 'X' }, 'Price', 'no price'],
  [{ key: 'p', name: 'X', price: 1, cycle: 1.5 }, 'Cycle (days)', 'a fractional cycle'],
  [{ key: 'p', name: 'X', price: 1, expectedReturn: -5 }, 'Total payout', 'a negative payout'],
  [{ key: 'p', name: 'X', price: 1, multiplier: 5000 }, 'Multiplier (×)', 'a multiplier past the ×1000 ceiling'],
  [{ key: 'p', name: 'X', price: 1, openAt: 'not a date' }, 'Opens at (one-off)', 'an unreadable one-off date'],
  [{ key: 'p', name: 'X', price: 1, openFrom: '25:00', openTo: '16:45' }, 'Open daily from', 'an impossible from-time'],
  [{ key: 'p', name: 'X', price: 1, openFrom: '15:00', openTo: '16:99' }, 'until', 'an impossible until-time'],
  [{ key: 'p', name: 'X', price: 1, openFrom: '15:00' }, 'Open daily from / until', 'half a daily window'],
  [{ key: 'p', name: 'X', price: 1, openFrom: '15:00', openTo: '15:00' }, 'Open daily from / until', 'a zero-length window'],
]) {
  const why = {};
  const clean = sanitize(p, 0, why);
  check(clean === null && why.field === field && !!why.why,
    `${label} -> "${why.field}" ${why.why || '(no reason)'}`);
}
// The route's own sentence, built from what the validator reported.
{
  const start = src.indexOf('const who = list[i]?.name');
  const endMark = "field: why.field || '' });";
  const refusal = src.slice(start, src.indexOf(endMark, start) + endMark.length);
  check(start > 0 && refusal.includes('res.status(400)'), 'the route refusal block was found to run');
  const build = new Function('list', 'i', 'why', 'res', refusal);
  const why = {};
  const p = { key: 'product-12', name: 'Product-12', price: 1000, cycle: 1.5 };
  sanitize(p, 0, why);
  let sent = null;
  build([p], 0, why, { status: () => ({ json: o => (sent = o) }) });
  check(!!sent && sent.status === 'error' && sent.message.includes('Product-12')
    && sent.message.includes('Cycle (days)') && sent.field === 'Cycle (days)',
    `route says: ${sent && sent.message}`);
}

// An <input type="time"> always hands over "HH:MM", but a document written
// before this validator existed (or a direct POST) can carry "9:00", and
// hhmmToMin() demands a two-digit hour. The cash-out-hours settings route
// already pads before parsing; this one used not to, so the two routes
// disagreed about what a valid time is.
console.log('\n— a one-digit hour is padded, not refused —');
for (const [p, ok, label] of [
  [{ key: 'p', name: 'X', price: 1, openFrom: '9:00', openTo: '17:00' }, true, 'from "9:00" accepted'],
  [{ key: 'p', name: 'X', price: 1, openFrom: '09:00', openTo: '5:30' }, true, 'until "5:30" accepted'],
  [{ key: 'p', name: 'X', price: 1, openFrom: '15:00', openTo: '16:45' }, true, 'an ordinary padded window'],
]) check(!!sanitize(p, 0) === ok, label);
check(sanitize({ key: 'p', name: 'X', price: 1, openFrom: '9:00', openTo: '17:00' }, 0).openFrom === '09:00',
  'the padded form is what gets STORED, so productOpenState can read it back');

// (The app / admin-panel payout-quoting checks that used to follow here need a browser DOM and are covered by test-screens-v2.js.)
console.log(failed ? `\n${failed} FAILED` : '\nall product-config cases pass');
process.exit(failed ? 1 : 0);
