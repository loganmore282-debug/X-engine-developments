#!/usr/bin/env node
/**
 * Exercises the two per-product money rules against the REAL code pulled out
 * of server.js, rather than a paraphrase of it:
 *   1. productExpectedReturn -- each product's own multiplier decides its
 *      payout, so two products can run different rates.
 *   2. sanitizeProductInput / rollSpinReward -- each product's own turntable
 *      band and spin count, and the payout staying inside that band.
 *
 * Both decide what a member is actually paid, and neither can be tested by
 * booting the server here (it needs MongoDB), so they are tested directly.
 */
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/server.js', 'utf8');
// READ out of server.js, not restated. These feed the real
// sanitizeProductInput() lifted below, so a wrong value here would test a
// validator that does not exist -- and the spin cap has already been raised
// once (20 -> 200, owner: "stop limiting everything bro, they are above 25
// even"), which left four hand-copied 20s scattered through this suite. A
// constant that is only ever read cannot drift.
const serverConst = name => {
  const m = new RegExp('const ' + name + ' = ([0-9_]+)').exec(src);
  if (!m) throw new Error(`server.js no longer declares ${name} as a plain number`);
  return Number(m[1].replace(/_/g, ''));
};
const MAX_MONEY_AMOUNT = serverConst('MAX_MONEY_AMOUNT');
const MAX_SPINS_PER_PURCHASE = serverConst('MAX_SPINS_PER_PURCHASE');
const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
// rollSpinReward() below is lifted out of server.js and now leans on two
// more things from that file's scope: crypto (it draws the payout from a
// CSPRNG rather than Math.random) and finiteMoney (it clamps the band).
// Both are restated here exactly as server.js defines them.
const crypto = require('crypto');
// Restated EXACTLY as server.js defines it -- it rejects NaN/Infinity and
// nothing else. An earlier copy here added `&& n > 0`, which would have
// made this test exercise a stricter function than the one that ships.
const finiteMoney = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const slice = (a, b) => src.slice(src.indexOf(a), src.indexOf(b));
eval(slice('function productExpectedReturn', 'function sanitizeProductInput'));
eval(slice('function sanitizeProductInput', "app.get('/admin/products'"));
// From the wheel's slice list through the roll, not just rollSpinReward:
// rollSpinReward is a wrapper over rollSpinSlice now, so lifting the wrapper
// alone leaves it calling something that is not in scope.
eval(slice('var SPIN_SLICES', "app.get('/turntable/status'"));
// Lifted here rather than further down (where publicProductView is needed)
// because sanitizeProductInput() calls the HH:MM parser for a product's daily
// window -- the field-naming cases below exercise that path, and without this
// they would die on an undefined helper instead of failing an assertion. The
// slice runs to /public/products because the product view calls
// productOpenState, which sits between the two.
eval(slice('function hhmmToMin', "app.get('/public/products'"));

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

console.log('\n— per-product turntable config —');
for (const [p, shouldAccept, label] of [
  [{ key: 'p2', name: 'Product-2', price: 90000, spinCount: 2, spinMin: 200, spinMax: 1000 }, true, 'valid band, 2 spins per purchase'],
  [{ key: 'p1', name: 'Product-1', price: 30000, spinCount: 0 }, true, 'a product that earns no spins'],
  [{ key: 'p3', name: 'Product-3', price: 1, spinCount: 1, spinMin: 1000, spinMax: 200 }, false, 'backwards band rejected at save, not clamped later'],
  [{ key: 'p4', name: 'Product-4', price: 1, spinCount: 25 }, true, '25 spins per purchase — the owner said his are above that'],
  [{ key: 'p4', name: 'Product-4', price: 1, spinCount: MAX_SPINS_PER_PURCHASE + 1 }, false, 'a count past the cap rejected'],
  [{ key: 'p5', name: 'Product-5', price: 1, multiplier: -2 }, false, 'negative multiplier rejected'],
]) check(!!sanitizeProductInput(p, 0) === shouldAccept, label);

// ── A refused save must name the field that refused it ──
// Report that prompted this: "product 12 failed to save spins". The panel
// printed "has an invalid key, name, price, or (if given) cycle/return" --
// spins are not in that list, so the one thing the owner had actually changed
// was the one thing the message did not mention. There are fifteen separate
// refusals in sanitizeProductInput() and they all shared that sentence.
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
  [{ key: 'p', name: 'X', price: 1, spinMin: -1 }, 'Win from', 'a negative win floor'],
  [{ key: 'p', name: 'X', price: 1, spinMax: MAX_MONEY_AMOUNT + 1 }, 'Win to', 'a win ceiling past the money cap'],
  [{ key: 'p', name: 'X', price: 1, spinMin: 1000, spinMax: 200 }, 'Win to', 'a backwards band'],
  [{ key: 'p', name: 'X', price: 1, spinCount: MAX_SPINS_PER_PURCHASE + 1 }, 'Spins per purchase', 'more spins than the cap — THE REPORTED CASE'],
  [{ key: 'p', name: 'X', price: 1, openAt: 'not a date' }, 'Opens at (one-off)', 'an unreadable one-off date'],
  [{ key: 'p', name: 'X', price: 1, openFrom: '25:00', openTo: '16:45' }, 'Open daily from', 'an impossible from-time'],
  [{ key: 'p', name: 'X', price: 1, openFrom: '15:00', openTo: '16:99' }, 'until', 'an impossible until-time'],
  [{ key: 'p', name: 'X', price: 1, openFrom: '15:00' }, 'Open daily from / until', 'half a daily window'],
  [{ key: 'p', name: 'X', price: 1, openFrom: '15:00', openTo: '15:00' }, 'Open daily from / until', 'a zero-length window'],
]) {
  const why = {};
  const clean = sanitizeProductInput(p, 0, why);
  check(clean === null && why.field === field && !!why.why,
    `${label} -> "${why.field}" ${why.why || '(no reason)'}`);
}
// A refusal that quotes a number must quote the REAL one. This was a MISSED
// mutation: hardcoding "0 and 20" into the spins message left every assertion
// above green while the sentence told the owner a cap that no longer existed.
{
  const w = {};
  sanitizeProductInput({ key: 'p', name: 'X', price: 1, spinCount: MAX_SPINS_PER_PURCHASE + 1 }, 0, w);
  check(String(w.why).includes(String(MAX_SPINS_PER_PURCHASE)),
    `the spins refusal quotes the live cap: "${w.why}"`);
}
// The route's own sentence, built from what the validator reported.
{
  const start = src.indexOf('const who = list[i]?.name');
  const endMark = "field: why.field || '' });";
  const refusal = src.slice(start, src.indexOf(endMark, start) + endMark.length);
  check(start > 0 && refusal.includes('res.status(400)'), 'the route refusal block was found to run');
  const build = new Function('list', 'i', 'why', 'res', refusal);
  const why = {};
  const p = { key: 'product-12', name: 'Product-12', price: 1000, spinCount: MAX_SPINS_PER_PURCHASE + 1 };
  sanitizeProductInput(p, 0, why);
  let sent = null;
  build([p], 0, why, { status: () => ({ json: o => (sent = o) }) });
  check(!!sent && sent.status === 'error' && sent.message.includes('Product-12')
    && sent.message.includes('Spins per purchase') && sent.field === 'Spins per purchase',
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
]) check(!!sanitizeProductInput(p, 0) === ok, label);
check(sanitizeProductInput({ key: 'p', name: 'X', price: 1, openFrom: '9:00', openTo: '17:00' }, 0).openFrom === '09:00',
  'the padded form is what gets STORED, so productOpenState can read it back');

// The panel's own cap must be the server's, or the input hints at one number
// and the save refuses at another.
console.log('\n— the panel and the server agree on the spin cap —');
{
  const adminFile = fs.readFileSync(__dirname + '/admin-src/index.html', 'utf8');
  // The panel's pre-flight checks, RUN rather than grepped. They are only a
  // courtesy -- /admin/products/save is the guarantee -- but the courtesy is
  // the whole point here: a max attribute on a number input is a hint a
  // bigger typed value sails straight past, and the owner then meets a
  // refusal from the server instead of a sentence next to the box.
  const vFrom = '    if (!!body.openFrom !== !!body.openTo)';
  const vTo = "'err');";
  const vStart = adminFile.indexOf(vFrom);
  const vLast = adminFile.indexOf("+ADMIN_MAX_SPINS,'err');", vStart);
  const block = adminFile.slice(vStart, vLast + "+ADMIN_MAX_SPINS,'err');".length);
  check(vStart > 0 && vLast > vStart && block.includes('spinCount'),
    "the panel's product pre-flight block was found to run");
  const preflight = new Function('body', 'toast', 'ADMIN_MAX_SPINS', block + '\nreturn null;');
  // The cap is handed in from server.js, so the panel is checked against the
  // real number rather than against one written down here twice.
  const run = b => preflight({ price: '30000', spinCount: '0', spinMin: '', spinMax: '', openFrom: '', openTo: '', ...b }, m => m, MAX_SPINS_PER_PURCHASE);
  const overCap = String(MAX_SPINS_PER_PURCHASE + 1);
  for (const [b, want, label] of [
    [{}, null, 'an ordinary product passes'],
    [{ spinCount: String(MAX_SPINS_PER_PURCHASE), spinMax: '1000' }, null, `a count at the cap (${MAX_SPINS_PER_PURCHASE}) passes`],
    [{ spinCount: '25', spinMax: '1000' }, null, '25 spins passes — the owner said his are above that'],
    [{ spinCount: overCap, spinMax: '1000' }, new RegExp('0 to ' + MAX_SPINS_PER_PURCHASE), `${overCap} is caught BEFORE the round trip`],
    [{ spinCount: '2.5', spinMax: '1000' }, /whole number/, 'a fractional count is caught'],
    [{ spinCount: '3' }, /Set what a spin can win/, 'spins with no win band is caught'],
    [{ spinCount: '1', spinMin: '1000', spinMax: '200' }, /cannot be less than/, 'a backwards band is caught'],
    [{ price: '' }, /Enter a price/, 'a missing price is caught'],
    [{ openFrom: '15:00' }, /BOTH/, 'half a daily window is caught'],
    [{ openFrom: '15:00', openTo: '15:00' }, /same minute/, 'a zero-length window is caught'],
  ]) {
    const got = run(b);
    check(want === null ? got === null : (typeof got === 'string' && want.test(got)),
      `${label} -> ${got === null ? 'saves' : JSON.stringify(got)}`);
  }
  const adminMax = /const ADMIN_MAX_SPINS = (\d+);/.exec(adminFile);
  const serverMax = /const MAX_SPINS_PER_PURCHASE = (\d+)/.exec(src);
  check(!!adminMax && !!serverMax && adminMax[1] === serverMax[1],
    `ADMIN_MAX_SPINS ${adminMax && adminMax[1]} === MAX_SPINS_PER_PURCHASE ${serverMax && serverMax[1]}`);
  check(!!serverMax && Number(serverMax[1]) === MAX_SPINS_PER_PURCHASE,
    'and the number this file read back is the same one');
  check(MAX_SPINS_PER_PURCHASE > 25,
    `the cap leaves room above 25 (owner: "they are above 25 even") — it is ${MAX_SPINS_PER_PURCHASE}`);
}

console.log('\n— spin payout stays inside its product band —');
for (const [lo, hi] of [[200, 1000], [5000, 5000], [0, 300]]) {
  let bad = 0;
  for (let i = 0; i < 20000; i++) { const x = rollSpinReward(lo, hi); if (x < lo || x > Math.max(lo, hi)) bad++; }
  check(bad === 0, `band ${lo}-${hi}: 20,000 draws, ${bad} outside`);
}

// ── The app, the admin panel and the credit must quote ONE number ──
// A product card, the buy-confirm dialog, the admin product list and the
// money actually credited at /invest/create used to derive the payout four
// different ways. With a multiplier set on a product that still carried an
// inherited expectedReturn they disagreed outright: the app quoted the old
// stored total, the server paid price x multiplier. This pins all four to
// the same function by pulling each one out of the file that ships it.
// The schedule helpers and publicProductView were lifted at the top of this
// file: the view reports whether a product is open, so it calls
// productOpenState, and lifting the view alone leaves that undefined.
const userSrc = fs.readFileSync(__dirname + '/user-src/original_module.js', 'utf8');
const uslice = (a, b) => userSrc.slice(userSrc.indexOf(a), userSrc.indexOf(b));
eval(uslice('function planFigures', '// One shared product-card renderer'));
const adminSrc = fs.readFileSync(__dirname + '/admin-src/index.html', 'utf8');
eval(adminSrc.slice(adminSrc.indexOf('function resolvedPayout'), adminSrc.indexOf('async function renderProducts')));

console.log('\n— app / admin / server quote the same payout —');
const sett = { returnMultiple: 30, cycleDays: 150 };
for (const raw of [
  { key:'a', name:'A', price: 30000, cycle: 150, multiplier: 3, expectedReturn: 900000 }, // the dangerous one
  { key:'b', name:'B', price: 30000, cycle: 150, expectedReturn: 90000, multiplier: null },
  { key:'c', name:'C', price: 90000, cycle: 100, multiplier: 2.5, expectedReturn: null },
  { key:'d', name:'D', price: 30000, cycle: null, multiplier: null, expectedReturn: null },
  { key:'e', name:'E', price: 197000, cycle: 150, multiplier: 4, expectedReturn: 5910000 },
]) {
  // what /invest/create would stamp on the investment and pay out
  const credited = productExpectedReturn(raw, sett);
  const creditCycle = Number(raw.cycle) || sett.cycleDays;
  const creditDaily = Math.round(credited / creditCycle);
  // what the app shows, fed the resolved server view exactly as it would be
  const shown = planFigures(publicProductView(raw, sett));
  // what the admin product list prints, fed the RAW doc as /admin/products sends it
  const adminShows = resolvedPayout(raw);
  check(shown.expected === credited && shown.daily === creditDaily && shown.cycle === creditCycle && adminShows === credited,
    `${raw.name}: app ${shown.expected}/${shown.daily}pd, admin ${adminShows}, credited ${credited}/${creditDaily}pd`);
}

console.log('\n— the app can still stand alone against an older server —');
// planFigures() only trusts a pre-resolved expectedReturn when dailyPayout
// is present, so a raw (unresolved) product must still resolve correctly.
for (const raw of [
  { price: 30000, cycle: 150, multiplier: 3, expectedReturn: 900000 },
  { price: 30000, cycle: 150, expectedReturn: 90000 },
  { price: 30000, cycle: 150 },
]) check(planFigures(raw).expected === productExpectedReturn(raw, sett),
  `raw ${JSON.stringify(raw)} -> ${planFigures(raw).expected}`);

console.log(failed ? `\n${failed} FAILED` : '\nall product-config cases pass');
process.exit(failed ? 1 : 0);
