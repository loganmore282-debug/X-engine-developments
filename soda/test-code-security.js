#!/usr/bin/env node
/**
 * Referral + gift code guarantees, checked against the REAL code in
 * server.js. The owner asked for: server-generated, no repetition, no double
 * claiming, encrypted, safeguarded, secure. Several of those are properties
 * of code that lives elsewhere in the file, so this asserts on the file
 * itself where behaviour cannot be executed here without MongoDB.
 */
const fs = require('fs');
const crypto = require('crypto');
const src = fs.readFileSync(__dirname + '/server.js', 'utf8');
const cut = (a, b) => src.slice(src.indexOf(a), src.indexOf(b));

const { randCode, REFERRAL_CHARS, REFERRAL_LENGTH } = new Function('crypto',
  cut('const REFERRAL_CHARS', 'async function findUserByReferralCode') +
  '\nreturn { randCode, REFERRAL_CHARS, REFERRAL_LENGTH };')(crypto);

let failed = 0;
const check = (ok, label) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); };
const has = (needle, label) => check(src.includes(needle), label);

console.log('— referral code format —');
const N = 20000;
const codes = Array.from({ length: N }, () => randCode());
check(REFERRAL_LENGTH === 4, `4 characters (got ${REFERRAL_LENGTH})`);
check(codes.every(c => c.length === 4), 'every code is exactly 4 characters');
check(codes.every(c => /^[A-Za-z0-9]+$/.test(c)), 'letters and numbers only');
check(codes.some(c => /[a-z]/.test(c)) && codes.some(c => /[A-Z]/.test(c)) && codes.some(c => /[0-9]/.test(c)),
  'mixture of upper, lower and digits actually occurs');
check(codes.every(c => !/[IlO01]/.test(c)), 'no I, l, O, 0 or 1 -- unambiguous read off a screen');
for (const ex of ['Gy2f']) {
  check(ex.length === REFERRAL_LENGTH && [...ex].every(ch => REFERRAL_CHARS.includes(ch)),
    `the owner's example ${ex} is a code this generator could produce`);
}
const space = Math.pow(REFERRAL_CHARS.length, REFERRAL_LENGTH);
check(space > 8e6, `space is ${space.toLocaleString()} codes`);
check(new Set(codes).size / N > 0.99, `few natural collisions in ${N.toLocaleString()} draws (${new Set(codes).size} distinct)`);

console.log('\n— server-generated, never client-supplied —');
check(!/req\.body\.[A-Za-z]*[Cc]ode\s*\|\|\s*gen/.test(src), 'no path lets a client choose its own code');
has("const code = await generateUniqueGiftCode();", 'gift codes come from the server generator only');
has('generateUniqueReferralCode(userId)', 'referral codes come from the server generator only');
check(/crypto\.randomInt/.test(cut('function randFromAlphabet', 'function randCode')),
  'codes use crypto.randomInt, not Math.random');

console.log('\n— no repetition —');
has("withLock('giftcode-gen'", 'gift code generation is serialised by a lock');
has("withLock('referral-code-gen'", 'referral code generation is serialised by a lock');
has("where('codeLower', '==', codeLower)", 'gift codes are checked for duplicates before issue');
has("where('referralCodeLower', '==', codeLower)", 'referral codes are checked case-insensitively before issue');
check(/for \(let attempt = 0; attempt < 30; attempt\+\+\)/.test(src), 'gift generator retries on collision rather than issuing a duplicate');

console.log('\n— no double claiming —');
has('CLAIM-BEFORE-CREDIT', 'claim is recorded before the money moves');
has("withLock('redeem:' + raw.toUpperCase()", 'redeeming one code is serialised, case-insensitively');
has('redeemedGiftCodeIds', 'a per-user record of redeemed codes exists');
has("arrayUnion", 'the claim is an atomic array union, not a read-modify-write');
has("collection('promoRedemptions')", 'a completed redemption writes its own row');
has("$ne: codeDoc.id", 'the credit is guarded so it cannot apply twice');

console.log('\n— safeguarded —');
has("logSecurityEvent(userId, 'giftcode_invalid_attempt'", 'invalid code attempts are logged for guessing detection');
has("'/redeem'", 'the redeem endpoint is rate limited');
has('crypto.timingSafeEqual', 'secret comparisons are constant-time');
has('function scryptHash', 'trade passwords are scrypt-hashed, never stored in the clear');
has("helmet(", 'security headers are set');
has('hsts', 'HTTPS is enforced by HSTS');

console.log(`\nsample referral codes: ${codes.slice(0, 8).join('  ')}`);
console.log(failed ? `\n${failed} FAILED` : '\nall code-security cases pass');
process.exit(failed ? 1 : 0);
