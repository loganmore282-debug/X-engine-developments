'use strict';
// Referral codes are 5 characters of capital letters and numbers (S62BV, GST3V); a code typed in any case still finds its owner.
// The Deposit page has a phone-number box (the number the member pays from) right after the amount box, and it is required and sent.
const fs = require('fs'), crypto = require('crypto');
const src = fs.readFileSync(__dirname + '/server.js', 'utf8');
const mod = fs.readFileSync(__dirname + '/user-src/original_module.js', 'utf8');
const cut = (a, b) => src.slice(src.indexOf(a), src.indexOf(b));
let n = 0; const ok = (c, m) => { n++; if (!c) { console.error('FAIL: ' + m); process.exit(1); } };
const GIFTCODE_UPPER = 'abcdefghjkmnpqrstuvwxyz23456789'.toUpperCase();
const { randCode, REFERRAL_CHARS, REFERRAL_LENGTH } = new Function('crypto', 'GIFTCODE_UPPER',
  cut('const REFERRAL_CHARS', 'async function findUserByReferralCode') + '\nreturn { randCode, REFERRAL_CHARS, REFERRAL_LENGTH };')(crypto, GIFTCODE_UPPER);
ok(REFERRAL_LENGTH === 5, 'referral codes are 5 characters');
const codes = Array.from({ length: 20000 }, () => randCode());
ok(codes.every(c => /^[A-Z0-9]{5}$/.test(c)), 'every code is 5 capital letters / numbers');
ok(codes.some(c => /[A-Z]/.test(c)) && codes.some(c => /[0-9]/.test(c)), 'both letters and numbers occur');
ok(codes.every(c => !/[ILO01]/.test(c)), 'no I, L, O, 0 or 1 (unambiguous)');
for (const ex of ['S62BV', 'GST3V']) ok([...ex].every(ch => REFERRAL_CHARS.includes(ch)), 'the owner\'s example ' + ex + ' is a code this generator could produce');
ok(/referralCodeLower: codeLower/.test(src) && /where\('referralCodeLower', '==', lower\)/.test(src), 'a code typed in any case is found (lower-case twin)');
ok(/String\(code\)\.toUpperCase\(\)/.test(mod), 'the invite link carries the code in capitals');
// deposit page (ChocoMCC's: the amount, the network and the number the member pays FROM, which may be a different number from the account's)
const page = fs.readFileSync(__dirname + '/user-src/index.html', 'utf8');
ok(page.indexOf('id="depAmt"') > 0 && page.indexOf('id="depPhone"') > 0 && page.indexOf('id="depNetworkRow"') > 0, 'the Deposit page has the amount box, the network and the number to pay from');
const sub = mod.slice(mod.indexOf('async function doDeposit'), mod.indexOf('async function doDeposit') + 2500);
ok(/if \(!\$\('depPhone'\)\.value\.trim\(\)\)/.test(sub) && /localDigits\(\$\('depPhone'\)\.value\)/.test(sub), 'the number to pay from is asked for and checked');
ok(/phone: '\+256' \+ local/.test(sub) && /network: _depNetwork/.test(sub) && /body\.slot = _depSlot/.test(sub), 'the payment request carries the typed number, the network and the pay button position');
console.log('PASS: referral code format and deposit phone box (' + n + ' checks)');
