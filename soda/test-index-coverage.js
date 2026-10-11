'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const src = fs.readFileSync(__dirname + '/db.js', 'utf8').replace(/\s+/g, ' ').replace(/,\s*/g, ', ');
const required = [
  ['users','phone: 1, registrationDone: 1'],
  ['investments','userId: 1, isFirstInvestment: 1'],
  ['transactions','investmentId: 1'],
  ['transactions','investmentId: 1, commissionLevel: 1'],
  ['transactions','referralDepositId: 1, commissionLevel: 1'],
  ['transactions','userId: 1, type: 1, giftCode: 1'],
  ['transactions','userId: 1, type: 1, milestone: 1'],
  ['withdrawals','userId: 1, date: 1'],
  ['withdrawals','userId: 1, network: 1, phone: 1'],
  ['withdrawals','pesajetRef: 1'],
  ['pendingDeposits','txid: 1'],
  ['turntableSpins','investmentId: 1'],
  ['turntableSpins','userId: 1, used: 1, createdAt: 1'],
  ['promoRedemptions','userId: 1, code: 1'],
  ['messageReads','userId: 1'],
  ['statementDownloads','createdAt: -1'],
];
for (const [collection,keys] of required) {
  const exact = `['${collection}', ${'{'} ${keys} ${'}'}]`;
  assert(src.includes(exact), `missing Mongo index: ${collection} { ${keys} }`);
}
console.log(`PASS: ${required.length} high-traffic Mongo query shapes have supporting indexes`);
