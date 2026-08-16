'use strict';

const assert = require('assert');
const { answerAssistant } = require('./assistant-engine');

const context = {
  history: [],
  settings: {
    minDeposit: 20000, minWithdraw: 5000, withdrawFeePct: 15,
    dailyCheckin: 1000, welcomeBonus: 5000,
    commL1: 28, commL2: 2, commL3: 1,
    maintenanceMode: false,
    rulesText: 'One account per person.',
    annEnabled: true, annTitle: 'Deposits open', annBody: 'Services are running.'
  },
  products: [{ name: 'Sputnik 1', price: 15000, cycle: 210, expectedReturn: 525000 }],
  account: { walletBalance: 75000, totalInvested: 15000, totalEarned: 2500, checkinStreak: 3, referralCode: 'ABC123' }
};

function ask(message, history) {
  return answerAssistant({ ...context, message, history: history || [] });
}
function contains(message, expected) {
  const reply = ask(message);
  for (const text of expected) assert(reply.includes(text), message + ' -> expected "' + text + '" in: ' + reply);
}

contains('depost 25000', ['UGX 25,000', 'UGX 20,000']);
contains('my deposit is pending', ['transaction reference', 'Do not create repeated']);
contains('withdraw 10000', ['UGX 1,500', 'UGX 8,500']);
contains('withdrawal stuck processing', ['Sending/Processing', 'must not']);
contains('my refferal commision is zero', ['first investment', '28% / 2% / 1%']);
contains('how is investment paid', ['credited daily']);
contains('how much is Sputnik 1', ['UGX 15,000', 'UGX 2,500/day']);
contains('what are the rules', ['One account per person.']);
contains('forgot password', ['Firebase Authentication', 'password recovery']);
contains('welcome registration bonus', ['UGX 5,000']);
contains('MTN mobile money number', ['07XXXXXXXX', '+2567XXXXXXXX']);
contains('my referral code didnt apply', ["can't be added", 'Support']);
contains('i registered with the wrong phone number', ["isn't self-editable", 'Support']);

const noRulesText = answerAssistant({ ...context, settings: { ...context.settings, rulesText: '' }, message: 'what are the rules and terms', history: [] });
assert(!noRulesText.includes('Privacy'), 'rules fallback should not mention the removed Privacy Policy page: ' + noRulesText);
assert(noRulesText.includes('Rules or Terms'), 'rules fallback should point to the two pages that still exist: ' + noRulesText);

const contextual = answerAssistant({
  ...context,
  message: 'and the fee?',
  history: [{ role: 'user', text: 'how do I withdraw?' }, { role: 'assistant', text: 'Use Withdraw on Home.' }]
});
assert(contextual.includes('15%'), 'short follow-up should preserve withdrawal context: ' + contextual);

console.log('Assistant engine checks passed');
