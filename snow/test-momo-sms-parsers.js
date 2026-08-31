// Regression tests for the manual-deposit SMS parsers, built from REAL
// MTN and Airtel Uganda messages the owner supplied (screenshots + copied
// text), not invented examples.
//
// These two parsers decide whether real money gets matched to a real
// deposit order, and both operators phrase things differently enough that
// a small regex change can silently break one network while the other
// keeps working. Run this after touching parseMoMoSms /
// parseSentMoMoSms / the _sms* helpers in server.js.
//
//   node test-momo-sms-parsers.js
//
// The parsers are extracted from server.js at runtime so this can never
// drift from the shipped implementation.
'use strict';

const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const start = src.indexOf('function _smsAmount');
const end = src.indexOf('// Picks the next number');
if (start < 0 || end < 0 || end <= start) {
  console.error('Could not locate the SMS parsers in server.js -- did the surrounding code move?');
  process.exit(1);
}
const { parseMoMoSms, parseSentMoMoSms } = (function () {
  const module = { exports: {} };
  // _smsCounterparty() consults cleanPhone() to prefer a Ugandan mobile
  // among candidates, so pull that in from server.js too.
  const cpStart = src.indexOf('function cleanPhone');
  const cpEnd = src.indexOf('\n}', cpStart) + 2;
  eval(src.slice(cpStart, cpEnd) + src.slice(start, end) + '\nmodule.exports = { parseMoMoSms, parseSentMoMoSms };');
  return module.exports;
})();

let pass = 0, fail = 0;
function check(label, cond) {
  if (cond) { pass++; console.log('PASS -', label); }
  else { fail++; console.log('FAIL -', label); }
}

// ── INCOMING: what lands on an admin payment phone; the forwarder posts these ──
// Real messages, verbatim.
const RECEIVED = [
  { name: 'Airtel received (large)',
    sms: 'RECEIVED. TID 155198427834. UGX 663,850 from 759926715, JOHN BUYUNGO. Bal UGX 667,111.',
    amount: 663850, txId: '155198427834', sender: '759926715' },
  { name: 'Airtel received (small)',
    sms: 'RECEIVED. TID 155219549418. UGX 12,325 from 746882457, DIDAS MANYIRE. Bal UGX 122,061.',
    amount: 12325, txId: '155219549418', sender: '746882457' },
  { name: 'MTN received',
    sms: 'You have received UGX 3400 from UMAR KIZITO, 256764628233 on 2026-08-30 16:45:11. fee:0. Reason: 2094058808912928768. New balance: UGX 35922. ID: 43140073868. Download MoMo App http://bit.ly/3KGlEJJ to get 500MBs.',
    amount: 3400, txId: '43140073868', sender: '256764628233' },
  { name: 'MTN received (zero balance left)',
    sms: 'You have received UGX 9435 from VICENT KANAMWANGI, 256769723708 on 2026-08-30 17:01:43. fee:0. Reason: 2094062959868796929. New balance: UGX 0. ID: 43140463902. Download MoMo App http://bit.ly/3KGlEJJ to get 500MBs.',
    amount: 9435, txId: '43140463902', sender: '256769723708' },
  { name: 'MTN received, CROSS-NETWORK from an Airtel payer',
    // The important one. "from" is the OPERATOR ("Airtel Money"), not the
    // payer -- the payer's actual name and number are in the Reason field.
    // Anything that assumes the number sits near "from" breaks here.
    sms: 'You have received UGX 500 from Airtel Money on 2026-08-31 01:10:24. fee:0. Reason: IBRAHIM NANKOOLA , 0731880221. New balance: UGX 1205258. ID: 43151361165. Dial *165# or use the MoMo app to pay, borrow, invest and more.',
    amount: 500, txId: '43151361165', sender: '0731880221' },
  { name: 'cross-network with a long numeric Reason before the payer number',
    // Guards the (?<!\d)...(?!\d) boundary: MTN puts a 19-digit value in
    // Reason on same-network transfers, and without the boundary a 13-digit
    // slice of it gets returned as the payer's number.
    sms: 'You have received UGX 500 from Airtel Money on 2026-08-31 01:10:24. fee:0. Reason: 2094058808912928768 , 0731880221. New balance: UGX 1205258. ID: 43151361165.',
    amount: 500, txId: '43151361165', sender: '0731880221' },
];

console.log('== incoming (admin phone) ==');
for (const c of RECEIVED) {
  const r = parseMoMoSms(c.sms);
  check(c.name + ': recognised', !!r);
  if (!r) continue;
  // Amount must be the transacted figure, never the trailing balance.
  check(c.name + ': amount ' + r.amount, r.amount === c.amount);
  check(c.name + ': txId ' + r.txId, r.txId === c.txId);
  // Sender number is what the (number, amount) match is cross-checked against.
  check(c.name + ': sender ' + r.sender, r.sender === c.sender);
  check(c.name + ': not mistaken for outgoing', parseSentMoMoSms(c.sms) === null);
}

// ── OUTGOING: what the MEMBER's own phone gets; they paste these in ──
// The member never receives an incoming message, so this direction is the
// one the paste-SMS fallback actually has to handle.
const SENT = [
  { name: 'Airtel to MTN, real cross-network',
    // Note the shape: "to NAME on NUMBER" -- the number follows "on", not
    // "to", and the TID trails at the end. Fee and balance both appear
    // after the real amount.
    sms: 'SENT UGX 500 to MANGALITA NAMUGABWE on 256769968158. Fee UGX 100.0 Bal UGX 3,149. TID 155265255805.',
    amount: 500, txId: '155265255805', recipient: '256769968158' },
  { name: 'MTN sent',
    sms: 'You have sent UGX 30,000 to SNOW MTN 1, 256770000001 on 2026-08-30 17:04:02. fee:330. New balance: UGX 1200. ID: 43140999111.',
    amount: 30000, txId: '43140999111', recipient: '256770000001' },
  { name: 'MTN sent, recipient name ends in TO',
    // Guards the word-boundary fix: KIZITO must not be read as the "to" keyword.
    sms: 'You have sent UGX 3400 to UMAR KIZITO, 256764628233 on 2026-08-30 16:45:11. fee:0. ID: 43140073868.',
    amount: 3400, txId: '43140073868', recipient: '256764628233' },
];

console.log('\n== outgoing (member phone, pasted) ==');
for (const c of SENT) {
  const r = parseSentMoMoSms(c.sms);
  check(c.name + ': recognised', !!r);
  if (!r) continue;
  check(c.name + ': amount ' + r.amount, r.amount === c.amount);
  check(c.name + ': txId ' + r.txId, r.txId === c.txId);
  // This is compared against the order's assignedNumber, so it must be the
  // number paid TO, never the member's own.
  check(c.name + ': paid-to ' + r.recipient, r.recipient === c.recipient);
  check(c.name + ': not mistaken for incoming', parseMoMoSms(c.sms) === null);
}

// ── Things that must never be treated as a deposit ──
console.log('\n== rejections ==');
const JUNK = [
  ['airtime purchase', 'You have bought airtime of UGX 5000.'],
  ['data bundle', 'You have bought a data bundle UGX 2000.'],
  ['OTP', 'Your OTP is 123456'],
  ['marketing', 'Download MoMo App http://bit.ly/3KGlEJJ to get 500MBs.'],
  ['empty', ''],
];
for (const [name, sms] of JUNK) {
  check(name + ': not incoming', parseMoMoSms(sms) === null);
  check(name + ': not outgoing', parseSentMoMoSms(sms) === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
