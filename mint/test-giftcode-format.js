#!/usr/bin/env node
/**
 * Treasure code format and storage, exercised against the REAL generator and helpers pulled out of server.js.
 *
 * Owner: treasure codes are 10 characters, capital letters and digits, no dashes (HPDABM8C5L, XEZT5ODBNA, 0QXN9JO2G4 are examples),
 * random, encrypted/secured and unguessable.
 */
const fs = require('fs');
const crypto = require('crypto');
const src = fs.readFileSync(__dirname + '/server.js', 'utf8');
const cut = (a, b) => src.slice(src.indexOf(a), src.indexOf(b));
const { genGiftCode, TREASURE_ALPHABET, TREASURE_CODE_LENGTH, tcHash, tcEncrypt, tcDecrypt } = new Function('crypto', 'process',
  cut('const TREASURE_ALPHABET', '// One flat block, no dashes').replace(/^\s*\/\/.*$/gm, '') +
  '\nreturn { genGiftCode, TREASURE_ALPHABET, TREASURE_CODE_LENGTH, tcHash, tcEncrypt, tcDecrypt };')(crypto, { env: { ADMIN_KEY: 'k1' } });

let failed = 0;
const check = (ok, label) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); };
const N = 20000;
const codes = Array.from({ length: N }, genGiftCode);

check(TREASURE_CODE_LENGTH === 10, `length is 10 (got ${TREASURE_CODE_LENGTH})`);
check(codes.every(c => /^[A-Z0-9]{10}$/.test(c)), 'every code is exactly 10 capital letters/digits, no dashes, no small letters');
check(new Set(codes).size === N, `no duplicates in ${N.toLocaleString()} codes`);
check(codes.some(c => /[A-Z]/.test(c)) && codes.some(c => /[0-9]/.test(c)), 'letters and digits both occur');
check(new Set(codes.join('')).size === 36 && TREASURE_ALPHABET.length === 36, 'all 36 characters (A-Z, 0-9) are used');
// uniform: each character about 1/36 of the draws (no modulo bias, no favourite)
const counts = {}; for (const ch of codes.join('')) counts[ch] = (counts[ch] || 0) + 1;
const exp = N * 10 / 36, worst = Math.max(...Object.values(counts).map(v => Math.abs(v - exp) / exp));
check(worst < 0.08, `characters are evenly spread (worst deviation ${(worst * 100).toFixed(1)}%)`);
check(/crypto\.randomInt\(TREASURE_ALPHABET\.length\)/.test(src) && !/Math\.random/.test(cut('function genGiftCode', '// One flat block, no dashes')), 'drawn with the secure random generator, never Math.random');
check(/^[A-Z0-9]{10}$/.test('HPDABM8C5L') && /^[A-Z0-9]{10}$/.test('0QXN9JO2G4'), "the owner's examples fit the format");
check(/^[a-z0-9]+$/.test(src.match(/const GIFTCODE_CHARS = '([^']+)'/)[1]) && /REFERRAL_CHARS = GIFTCODE_CHARS/.test(src), 'referral codes keep their own alphabet');
// storage
const c = 'HPDABM8C5L';
check(tcHash(c) === tcHash('HPDABM8C5L') && tcHash(c) !== tcHash('HPDABM8C5M') && /^[0-9a-f]{64}$/.test(tcHash(c)), 'a code is looked up by its SHA-256, one code one hash');
const blob = tcEncrypt(c);
check(tcDecrypt(blob) === c && !blob.includes(c) && tcEncrypt(c) !== blob, 'the stored copy is AES-GCM encrypted (different every time, the code is not in it) and reads back');
check(tcDecrypt(blob.slice(0, -2) + 'AA') === '' && tcDecrypt('garbage') === '' && tcDecrypt('') === '', 'a tampered or broken copy reads as empty, never as a wrong code');
check(/codeLower: hash, codeEnc: tcEncrypt\(code\)/.test(src) && /code: 'tc_' \+ hash\.slice\(0, 20\)/.test(src), 'a new code is saved by hash with an encrypted copy, never in clear');
check(/code: tcDecrypt\(c\.codeEnc\) \|\| c\.code/.test(src), 'the admin list decrypts it (older codes show as before)');
check(/function treasureKeyLockedOut/.test(src) && /rec\.length >= 8/.test(src) && /TOO_MANY_WRONG_KEYS/.test(src), 'eight wrong keys in 10 minutes lock a member out of the chest for the rest of the 10 minutes');
check(/where\('codeLower', '==', tcHash\(typed10\)\)/.test(src) && /where\('codeLower', '==', lower\)/.test(src), 'redeeming finds the new code by hash and still finds older dashed codes');
console.log('\nsample:', codes.slice(0, 3).join('  '));
console.log(failed ? `\n${failed} FAILED` : '\nall treasure-code cases pass');
process.exit(failed ? 1 : 0);
