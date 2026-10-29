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
];
for (const [collection,keys] of required) {
  const exact = `['${collection}', ${'{'} ${keys} ${'}'}]`;
  assert(src.includes(exact), `missing Mongo index: ${collection} { ${keys} }`);
}
// Webhook look-ups by a gateway's own id (partial indexes, so only rows that carry the field are indexed): TavuPay's reference, LworxPay's and ObPay's transaction id.
for (const f of ['tavupayRef', 'lworxpayTxId', 'obpayTxId']) assert(src.includes(`['pendingDeposits', { ${f}: 1 }, { name: '${f}_idx', partialFilterExpression: { ${f}: { $type: 'string' } } }]`), `missing Mongo index: pendingDeposits { ${f}: 1 } (every webhook that looks a deposit up by it would scan the collection)`);
console.log(`PASS: ${required.length + 3} high-traffic Mongo query shapes have supporting indexes`);
