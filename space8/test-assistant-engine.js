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
// Codex-verified real bug (2026-08-17): the sign-in screen has no
// self-service password reset (confirmed against user-src/index.html's
// #screenLogin markup) -- the assistant used to claim one existed. Now it
// correctly points to Customer Service instead.
contains('forgot password', ['Firebase Authentication', 'contact Customer Service']);
contains('welcome registration bonus', ['UGX 5,000']);
contains('MTN mobile money number', ['07XXXXXXXX', '+2567XXXXXXXX']);
contains('my referral code didnt apply', ["can't be added", 'Customer Service']);
contains('i registered with the wrong phone number', ["isn't self-editable", 'Customer Service']);

const noRulesText = answerAssistant({ ...context, settings: { ...context.settings, rulesText: '' }, message: 'what are the rules and terms', history: [] });
assert(!noRulesText.includes('Privacy'), 'rules fallback should not mention the removed Privacy Policy page: ' + noRulesText);
assert(noRulesText.includes('Rules or Terms'), 'rules fallback should point to the two pages that still exist: ' + noRulesText);

const contextual = answerAssistant({
  ...context,
  message: 'and the fee?',
  history: [{ role: 'user', text: 'how do I withdraw?' }, { role: 'assistant', text: 'Use Withdraw on Home.' }]
});
assert(contextual.includes('15%'), 'short follow-up should preserve withdrawal context: ' + contextual);

// Real bug (2026-08-19): a filler turn ("ok") between a real question and its
// follow-up used to become "the last topic" itself, since yes_ack/thanks/etc
// score confidently on their own trigger words -- so the thread was lost the
// moment a member said "ok". Chases the thread through several filler hops.
const fillerChain = answerAssistant({
  ...context,
  message: 'reset',
  history: [
    { role: 'user', text: 'i forgot my pin' }, { role: 'assistant', text: 'x' },
    { role: 'user', text: 'ok' }, { role: 'assistant', text: 'x' },
    { role: 'user', text: 'thanks' }, { role: 'assistant', text: 'x' }
  ]
});
assert(/pin/i.test(fillerChain), 'filler-chain follow-up should still resolve to the PIN topic, not a generic fallback: ' + fillerChain);

const ackStaysOnTopic = answerAssistant({
  ...context,
  message: 'ok',
  history: [{ role: 'user', text: 'how do i deposit' }, { role: 'assistant', text: 'x' }]
});
assert(!/what would you like to know/i.test(ackStaysOnTopic), 'a bare ack right after a real question should acknowledge the topic instead of resetting to a blank "what would you like to know": ' + ackStaysOnTopic);

// Real bug (2026-08-19): normalize() turns "check-in" into "check in", but
// phrase regexes were tested against the RAW un-normalized text, so the
// hyphen (exactly how the app's own UI spells "Check-in") broke every
// checkin phrase pattern written as "check ?in".
contains('tell me about check-in', ['Check In', 'streak']);
contains('how do i top-up', ['Deposit']);

// Real bug (2026-08-19): "withdrawal" scores higher on the generic `withdraw`
// intent's own keyword weight than "fee" scores on the dedicated `fees`
// intent, so a direct fee question lost to the how-to-withdraw reply.
contains('what is the withdrawal fee', ['15%', 'free']);

console.log('Assistant engine checks passed');
