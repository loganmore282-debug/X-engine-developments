/* SPACE8 — ASSISTANT CORPUS ROUTING TEST
   Asserts every training utterance in assistant-corpus.js routes to the intent
   that owns it, and that the engine answers every one without throwing.

   Why this exists: intent collisions grow with the SQUARE of the intent count
   and they are SILENT -- a colliding intent does not error, it quietly answers
   the wrong question. Four were found by hand at 100 intents (one of them had
   "how do I delete my account" replying with withdrawal-account instructions).
   Hand-checking does not scale past that, so it is mechanical from here.

   Also reports the real answerable-question surface, which is much larger than
   the intent count: intents + (products x aspects) + follow-up depth + amount
   math are all separate answerable questions.

   Run: node test-assistant-corpus.js   (exits 0 = all green)                  */

const { answerAssistant, classifyTop, INTENTS, PRODUCT_ASPECTS, DEEP } = require('./assistant-engine.js');
const CORPUS = require('./assistant-corpus.js');

const settings = {
  minDeposit: 20000, minWithdraw: 5000, withdrawFeePct: 15, dailyCheckin: 300,
  welcomeBonus: 5000, commL1: 28, commL2: 2, commL3: 1, returnMultiple: 42,
  cycleDays: 210, maxWithdrawalsPerDay: 2, maintenanceMode: false,
  supportTelegram: '@space8support', telegramGroup: 'https://t.me/space8grp',
  telegramChannel: 'https://t.me/space8ch', supportHours: '9am - 6pm', rulesText: 'Standard rules.'
};
const products = [
  { key: 'sputnik1', name: 'Sputnik 1', price: 15000, cycle: 210, expectedReturn: 630000 },
  { key: 'hubble', name: 'Hubble Space Telescope', price: 500000, cycle: 210, expectedReturn: 21000000 },
  { key: 'terra', name: 'Terra', price: 850000, cycle: 210, expectedReturn: 35700000 },
  { key: 'jwst', name: 'James Webb Space Telescope', price: 20000000, cycle: 210, expectedReturn: 840000000 }
];
const account = {
  walletBalance: 250000, totalInvested: 500000, totalEarned: 120000,
  referralCode: 'AB12CD', checkinStreak: 4, publicId: '000123'
};

let pass = 0, fail = 0;
const failures = [];

// ── 1. Every corpus utterance routes to its owning intent ──
const ids = new Set(INTENTS.map(i => i.id));
let utteranceCount = 0;

for (const [intentId, utterances] of Object.entries(CORPUS)) {
  if (!ids.has(intentId)) {
    fail++;
    failures.push(`CORPUS references unknown intent id "${intentId}" — intent removed or renamed without updating the corpus`);
    continue;
  }
  for (const u of utterances) {
    utteranceCount++;
    const got = classifyTop(u);
    if (got === intentId) pass++;
    else {
      fail++;
      failures.push(`"${u}"\n      expected: ${intentId}\n      got:      ${got || '(no confident match — fell through to fallback)'}`);
    }
  }
}

// ── 2. Every intent actually produces a reply without throwing ──
for (const intent of INTENTS) {
  const ctx = {
    message: 'test', history: [], settings, products, account,
    entities: { amount: 100000 }
  };
  try {
    const r = intent.reply(ctx);
    if (typeof r === 'string' && r.length > 0) pass++;
    else { fail++; failures.push(`intent "${intent.id}" reply() returned a non-string or empty value`); }
  } catch (e) {
    fail++;
    failures.push(`intent "${intent.id}" reply() threw: ${e.message}`);
  }
}

// ── 3. Every intent has at least one training utterance ──
const untrained = INTENTS.filter(i => !CORPUS[i.id] || !CORPUS[i.id].length).map(i => i.id);
if (untrained.length) {
  fail++;
  failures.push(`${untrained.length} intent(s) have NO training utterances (add them to assistant-corpus.js): ${untrained.join(', ')}`);
} else pass++;

// ── 4. End-to-end: the full engine answers every utterance without throwing ──
for (const utterances of Object.values(CORPUS)) {
  for (const u of utterances) {
    try {
      const r = answerAssistant({ message: u, history: [], settings, products, account });
      if (typeof r === 'string' && r.length > 0) pass++;
      else { fail++; failures.push(`answerAssistant returned empty for "${u}"`); }
    } catch (e) {
      fail++;
      failures.push(`answerAssistant threw on "${u}": ${e.message}`);
    }
  }
}

// ── 5. Conversational layer behaviours ──
function check(name, cond, extra) {
  if (cond) { pass++; }
  else { fail++; failures.push(name + (extra !== undefined ? `  -> ${JSON.stringify(extra)}` : '')); }
}
const ask = (m, h) => answerAssistant({ message: m, history: h || [], settings, products, account });

// follow-up resolves against prior topic and goes deeper
const wHist = [{ role: 'user', text: 'how do i withdraw' }];
check('follow-up "explain more" deepens the prior topic', /In detail/.test(ask('explain more', wHist)));
check('follow-up "why?" deepens the prior topic', /In detail/.test(ask('why?', wHist)));
// a real question containing "why" must NOT be swallowed as a bare follow-up
check('"why is there a fee" still reaches why_fee', classifyTop('why is there a fee') === 'why_fee');
// product x aspect
check('product + price aspect', /costs/.test(ask('how much is hubble')));
check('product + daily aspect', /per day/.test(ask('what does terra pay daily')));
check('product + cycle aspect', /runs for/.test(ask('how long does sputnik 1 last')));
// amount math
check('exact-price amount math', /exactly the/.test(ask('if i invest 500000 what do i get')));
// 4+ digits on purpose: extractAmount deliberately ignores small bare numbers
// so "day 3" or "level 2" are never mistaken for money amounts.
check('below-minimum amount math', /below the smallest/.test(ask('what do i get if i invest 5000')));
check('mid-range amount math', /largest single plan/.test(ask('what do i get if i invest 900000')));
// fallback names near matches rather than repeating a generic list
check('unmatched input still answers', typeof ask('zxcvbnm qwerty asdf') === 'string');
// no crash on hostile / empty input
check('empty message handled', typeof ask('') === 'string');
check('very long message handled', typeof ask('a'.repeat(5000)) === 'string');
check('injection-ish input handled', typeof ask('<script>alert(1)</script>') === 'string');

// ── REPORT ──
// The real answerable surface is much larger than the intent count: each live
// product crossed with each aspect is its own specific answer, and each DEEP
// entry is a second, different answer reachable by asking a follow-up. Counted
// against the 15-product live catalogue rather than this test's 4 fixtures.
const LIVE_CATALOGUE = 15;
const productAspectCombos = LIVE_CATALOGUE * PRODUCT_ASPECTS.length;
const deepCount = Object.keys(DEEP).length;
const answerable = INTENTS.length + productAspectCombos + deepCount;
console.log('');
console.log('  Intents defined ................. ' + INTENTS.length);
console.log('  Training utterances (verified) .. ' + utteranceCount);
console.log('  Product x aspect answers ........ ' + productAspectCombos + '  (' + LIVE_CATALOGUE + ' products x ' + PRODUCT_ASPECTS.length + ' aspects)');
console.log('  Follow-up deep explanations ..... ' + deepCount);
console.log('  Distinct answers reachable ...... ' + answerable);
console.log('');

if (failures.length) {
  console.log('  FAILURES:');
  failures.forEach(f => console.log('   - ' + f));
  console.log('');
}
console.log(`  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
