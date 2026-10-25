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
// deposit page
const form = mod.slice(mod.indexOf('function openDepositFormSheet'), mod.indexOf('window.pickPayLabel'));
ok(form.indexOf('id="depAmount"') > 0 && form.indexOf('id="depPhone"') > form.indexOf('id="depAmount"') && form.indexOf('id="depPhone"') < form.indexOf('Select Payment Method'), 'the phone box comes right after the amount box, before the payment methods');
ok(/<h2>Input Payment Number<\/h2><\/div>\s*<input class="v-amount" id="depPhone"/.test(form), 'the phone box sits under its own heading "Input Payment Number", between Select Amount and Select Payment Method');
ok(/class="v-amount" id="depPhone"/.test(form), 'the phone box has the amount box\'s own class (same size)');
const sub = mod.slice(mod.indexOf('window.submitDeposit'), mod.indexOf('window.submitDeposit') + 4000);
ok(/cleanPhone\(\(\$\('depPhone'\)/.test(sub) && /if \(!phone\) return notify\(/.test(sub), 'the typed number is required and checked with cleanPhone');
ok(/post\('\/deposit\/marzpay', \{ amount, phone \}\)/.test(sub), 'the typed number is sent with the deposit');
console.log('PASS: referral code format and deposit phone box (' + n + ' checks)');
