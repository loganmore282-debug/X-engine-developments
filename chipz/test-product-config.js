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
// Both restated from server.js. Keep them in step with it: these feed the
// real sanitizeProductInput() lifted below, so a wrong value here tests a
// validator that does not exist.
const MAX_MONEY_AMOUNT = 999_999_999;
const MAX_SPINS_PER_PURCHASE = 20;
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
eval(slice('function rollSpinReward', "app.get('/turntable/status'"));

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
  [{ key: 'p4', name: 'Product-4', price: 1, spinCount: 99 }, false, 'absurd spin count rejected'],
  [{ key: 'p5', name: 'Product-5', price: 1, multiplier: -2 }, false, 'negative multiplier rejected'],
]) check(!!sanitizeProductInput(p, 0) === shouldAccept, label);

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
// Starts at hhmmToMin, not at publicProductView: the view now reports whether
// a product is open, so it calls productOpenState, and lifting the view alone
// leaves that undefined. The schedule helpers sit directly above it.
eval(slice('function hhmmToMin', "app.get('/public/products'"));
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
