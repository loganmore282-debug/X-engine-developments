'use strict';
// Referral codes are 6 characters, capital letters and numbers in the pattern letter-digit x3 (K9P4M2, X7W8R3); a code typed in any case still finds its owner.
// The Deposit page has a phone-number box (the number the member pays from) right after the amount box, and it is required and sent.
const fs = require('fs'), crypto = require('crypto');
const src = fs.readFileSync(__dirname + '/server.js', 'utf8');
const mod = fs.readFileSync(__dirname + '/user-src/original_module.js', 'utf8');
const cut = (a, b) => src.slice(src.indexOf(a), src.indexOf(b));
let n = 0; const ok = (c, m) => { n++; if (!c) { console.error('FAIL: ' + m); process.exit(1); } };
const GIFTCODE_UPPER = 'abcdefghjkmnpqrstuvwxyz23456789'.toUpperCase();
const { randCode, REFERRAL_CHARS, REFERRAL_LENGTH } = new Function('crypto', 'GIFTCODE_UPPER',
  cut('const REFERRAL_LETTERS', 'async function findUserByReferralCode') + '\nreturn { randCode, REFERRAL_CHARS, REFERRAL_LENGTH };')(crypto, GIFTCODE_UPPER);
ok(REFERRAL_LENGTH === 6, 'referral codes are 6 characters');
const codes = Array.from({ length: 20000 }, () => randCode());
ok(codes.every(c => /^(?:[A-Z][0-9]){3}$/.test(c)), 'every code is letter-digit-letter-digit-letter-digit in capitals');
ok(codes.some(c => /[A-Z]/.test(c)) && codes.some(c => /[0-9]/.test(c)), 'both letters and numbers occur');
ok(codes.every(c => !/[AEIOULS01]/.test(c)), 'no vowels, L, S, 0 or 1 (no words, nothing that looks like another character)');
for (const ex of ['K9P4M2', 'X7W8R3', 'V4N6T9', 'H8Q2Z5', 'B3J7Y4']) ok(/^(?:[BCDFGHJKMNPQRTVWXYZ][2-9]){3}$/.test(ex), 'the owner\'s example ' + ex + ' is a code this generator could produce');
ok(new Set(codes).size > 19900, 'codes spread out (20,000 drawn, ' + new Set(codes).size + ' different)');
ok(/referralCodeLower: codeLower/.test(src) && /where\('referralCodeLower', '==', lower\)/.test(src), 'a code typed in any case is found (lower-case twin)');
ok(/String\(code\)\.toUpperCase\(\)/.test(mod), 'the invite link carries the code in capitals');
// deposit page (ChocoMCC's: the amount, the network and the number the member pays FROM, which may be a different number from the account's)
const page = fs.readFileSync(__dirname + '/user-src/index.html', 'utf8');
ok(page.indexOf('id="depAmt"') > 0 && page.indexOf('id="depPhone"') < 0 && page.indexOf('id="depNetworkRow"') < 0 && page.indexOf('id="gpPhone"') > 0 && page.indexOf('id="gpM_MTN"') > 0, 'Add Funds has only the amount box; the network and the number to pay from are asked on payment page 1');
const sub = mod.slice(mod.indexOf('async function gpConfirm'), mod.indexOf('async function gpConfirm') + 1500);
ok(/\$\('gpPhone'\)\.value\.trim\(\)/.test(sub) && /localDigits\(raw\)/.test(sub), 'the number to pay from is asked for and checked');
ok(/phone: '\+256' \+ local/.test(sub) && /network: _gp\.network/.test(sub) && /\/deposit\/manual\/order/.test(sub), 'the payment request carries the typed number and the network to the order route');
console.log('PASS: referral code format and deposit phone box (' + n + ' checks)');
