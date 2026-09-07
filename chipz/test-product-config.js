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
const MAX_MONEY_AMOUNT = 1e12;
const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
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

console.log(failed ? `\n${failed} FAILED` : '\nall product-config cases pass');
process.exit(failed ? 1 : 0);
