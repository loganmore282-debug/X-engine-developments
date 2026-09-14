#!/usr/bin/env node
/**
 * Gift (treasure chest) code format, exercised against the REAL generator
 * pulled out of server.js.
 *
 * Owner: "treasure chest codes are 12 character alphanumeric random letters
 * and numbers ie HDG27RHRFT64, NO PUTTING SMALL LETTERS."
 */
const fs = require('fs');
const crypto = require('crypto');
const src = fs.readFileSync(__dirname + '/server.js', 'utf8');
const cut = (a, b) => src.slice(src.indexOf(a), src.indexOf(b));
const { genGiftCode, GIFTCODE_CHARS, GIFTCODE_LENGTH } = new Function('crypto',
  cut('const GIFTCODE_CHARS', 'async function generateUniqueGiftCode') +
  '\nreturn { genGiftCode, GIFTCODE_CHARS, GIFTCODE_LENGTH };')(crypto);

let failed = 0;
const check = (ok, label) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); };

const N = 20000;
const codes = Array.from({ length: N }, genGiftCode);

check(GIFTCODE_LENGTH === 12, `length is 12 (got ${GIFTCODE_LENGTH})`);
check(codes.every(c => c.length === 12), 'every generated code is exactly 12 characters');
check(codes.every(c => /^[A-Z0-9]+$/.test(c)), 'uppercase letters and digits only -- no small letters');
check(!codes.some(c => /[a-z]/.test(c)), 'not one lowercase character in 20,000 codes');
check(codes.every(c => !/[IOL01]/.test(c)), 'no I, O, L, 0 or 1 -- unambiguous when read off a screen');

const EX = 'HDG27RHRFT64';
check(EX.length === 12 && [...EX].every(ch => GIFTCODE_CHARS.includes(ch)),
  `the owner's example ${EX} is a valid code for this alphabet`);

check(codes.some(c => /[A-Z]/.test(c)) && codes.some(c => /[0-9]/.test(c)), 'letters and digits both occur');
// How often a code contains BOTH a letter and a digit is fixed by the
// alphabet, not a choice: with 23 letters and 8 digits over 12 draws,
// P(no digit) = (23/31)^12 = 2.68%, so ~97.3% is exactly right. Asserting
// ">99%" here was my arithmetic being wrong, not the generator. An all-letter
// code is still a valid code -- the owner asked for alphanumeric characters,
// not for every code to contain one of each.
const mixed = codes.filter(c => /[A-Z]/.test(c) && /[0-9]/.test(c)).length;
const expectedMix = 1 - Math.pow(23 / 31, 12) - Math.pow(8 / 31, 12);
check(Math.abs(mixed / N - expectedMix) < 0.01,
  `share mixing letters and digits matches the alphabet: ${(mixed / N * 100).toFixed(2)}% vs ${(expectedMix * 100).toFixed(2)}% expected`);

check(new Set(codes).size === N, `no duplicates in ${N.toLocaleString()} codes`);

const used = new Set(codes.join(''));
check(used.size === GIFTCODE_CHARS.length,
  `all ${GIFTCODE_CHARS.length} alphabet characters appear (saw ${used.size})`);

const refLen = (src.match(/function randCode\(n = (\d+)\)/) || [])[1];
check(Number(refLen) !== GIFTCODE_LENGTH, `cannot be confused with a referral code (${refLen} vs ${GIFTCODE_LENGTH} chars)`);

console.log('\nsample:', codes.slice(0, 5).join('  '));
console.log(failed ? `\n${failed} FAILED` : '\nall gift-code format cases pass');
process.exit(failed ? 1 : 0);
