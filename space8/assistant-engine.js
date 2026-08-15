/* SPACE8 ASSISTANT ENGINE
   Self-hosted support intelligence for POST /assistant/chat — no external LLM
   API, no per-message cost. Every reply is grounded in the same live data the
   admin actually configured (getSettings()/getProducts()) and the caller's
   own account, so answers are always numerically correct even as the admin
   changes fees/rates/products — the old client-side regex FAQ this replaced
   could silently go stale, this can't.

   This is a rule-based engine, not a language model — there is no external
   API and nothing was "trained" on external text. What makes it feel more
   capable than a flat FAQ table is: ~25 weighted intents covering the whole
   platform in real depth (not just "how do I X" but "why does X work that
   way", timing, safety, edge cases), live product-name + money-amount
   extraction so answers react to specifics in the message, and two-turn
   context blending so short follow-ups land on the right topic.

   How it decides what to say:
     1. Normalize + tokenize the message, stem each token (crude suffix
        folding) so "deposits"/"depositing"/"deposited" all match "deposit".
     2. Score every intent by keyword weight + regex phrase bonus.
     3. If the message is short/ambiguous (low top score) and there's prior
        history, blend in the last TWO user turns' scores (most recent
        weighted highest) so a one-word follow-up ("and the fee?", "why
        though?") still lands on the right topic across a short back-and-forth.
     4. Separately try to match a live product by name against the message —
        this lets a specific-plan question ("how much is Voyager 1") get a
        real, numeric answer instead of a generic "browse Products" reply.
     5. Extract a money amount from the message (comma-grouped or 4+ digit
        number) so deposit/withdraw replies can react to it directly (e.g.
        compute the real fee on a withdrawal amount).
     6. Highest-scoring intent's handler runs against that context and
        returns plain text. Below a confidence floor, a fallback lists what
        it can actually help with instead of guessing.

   Most reply handlers return one of several phrasings (pick()) so the same
   question asked twice, or a run of short greetings, doesn't read as a
   stuck robot repeating itself verbatim.
*/

function normalize(s) {
  return String(s || '').toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
function tokenize(s) { return normalize(s).split(' ').filter(Boolean); }
function stem(w) {
  if (w.length > 6 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 5 && w.endsWith('ed'))  return w.slice(0, -2);
  if (w.length > 5 && w.endsWith('es'))  return w.slice(0, -2);
  if (w.length > 4 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}
function fmt(n) { return 'UGX ' + Number(n || 0).toLocaleString('en-UG'); }
function fmt2(n) { return Number(n || 0).toLocaleString('en-UG'); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function extractAmount(text) {
  const m = text.match(/\d{1,3}(?:,\d{3})+|\d{4,}/g);
  if (!m) return null;
  const n = parseInt(m[0].replace(/,/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

// ── INTENTS ──────────────────────────────────────────────────────────────
// kw: stemmed keyword -> weight. phrase: regexes tested against the raw
// message for a bigger, high-confidence bonus. priority only breaks ties.
const INTENTS = [
  { id: 'security_secret', priority: 5,
    phrase: [/what('?s| is) my (pin|password)/i, /tell me my (pin|password)/i, /show (me )?my (pin|password)/i, /forgot (my )?(pin|password)/i, /reset (my )?pin/i, /lost (my )?pin/i],
    reply: (ctx) => /forgot|lost|reset/i.test(ctx.message)
      ? '🔒 To change your withdrawal PIN, go to Account → Security PIN. If you never set one, it should have been created at registration — contact Support if that looks wrong.'
      : "🔒 I can't see or share your PIN or password — they're never stored anywhere in a readable form, only as a one-way hash, so there's genuinely nothing to hand over even if I wanted to. You can change your PIN anytime from Account → Security PIN." },

  { id: 'greeting', priority: 1,
    kw: { hi: 2, hii: 2, hello: 2, hallo: 2, morning: 2, afternoon: 2, evening: 2, sup: 1, yo: 1, yoo: 1, greeting: 2, howdy: 2 },
    phrase: [/^h+[ei]+y*!*$/i, /^y+o+!*$/i, /^s+u+p+!*$/i],
    reply: () => pick([
      "Hey! 👋 I'm the Space8 assistant. Ask me about deposits, withdrawals, investing, referrals, check-ins or your account.",
      "Hi there! 🛰️ What can I help you with on Space8 today?",
      "Hello! 😊 Deposits, withdrawals, investing, referrals, check-ins — ask away."
    ]) },

  { id: 'howareyou', priority: 1,
    phrase: [/how('?s| is| are) (it going|you doing|you)\b/i, /how you dey/i, /wassup/i],
    reply: () => pick([
      "I'm doing great, thanks for asking! 😊 How can I help with your Space8 account today?",
      "All good here! 🚀 What do you need help with — deposits, withdrawals, investing?"
    ]) },

  { id: 'thanks', priority: 1, kw: { thank: 2, thanks: 2, appreciate: 2, appreciated: 2 },
    reply: () => pick(["You're welcome! 😊 Anything else I can help with?", "Happy to help! 🙌 Let me know if you need anything else.", "Anytime! 👍"]) },

  { id: 'bye', priority: 1, kw: { bye: 2, goodbye: 2, cya: 1, later: 1 },
    reply: () => pick(['Take care! 👋 Come back anytime you have a question.', 'See you around! 🛰️']) },

  { id: 'whoami', priority: 1,
    phrase: [/who are you/i, /are you (a )?(human|real person|robot|ai|bot)/i, /what are you/i],
    reply: () => "🤖 I'm the Space8 in-app assistant — I answer using your platform's live settings and your own account data, computed fresh every time you ask, not from a script that can go stale. I can't perform actions myself (I can't move money or change settings), only explain how things work and what the numbers are right now." },

  { id: 'capability', priority: 1,
    phrase: [/what can you (do|help)/i, /help me with/i, /what do you know/i],
    reply: () => "🛰️ I can help with deposits, withdrawals, investing (including specific plan details), referrals and commissions, check-ins, your live balance, the security PIN, and general questions about how Space8 works. Ask away!" },

  { id: 'deposit', priority: 2, kw: { deposit: 3, topup: 2, fund: 1, recharge: 2, addmoney: 2, addfund: 2, momo: 1 },
    reply: (ctx) => {
      const m = ctx.settings.minDeposit;
      let extra = '';
      if (ctx.entities.amount) {
        extra = ctx.entities.amount < m
          ? ` UGX ${fmt2(ctx.entities.amount)} is below the minimum — deposit at least ${fmt(m)}.`
          : ` UGX ${fmt2(ctx.entities.amount)} works — that's above the minimum of ${fmt(m)}. ✅`;
      }
      return pick([
        `💰 Tap Deposit on Home, enter an amount (minimum ${fmt(m)}), choose your mobile-money network and confirm the prompt on your phone. It's usually credited within a minute or two once you approve the prompt.${extra}`,
        `To add funds 💵: Home → Deposit → enter an amount (min ${fmt(m)}) → confirm on your phone. There's no deposit fee — the full amount lands in your wallet.${extra}`
      ]);
    } },

  { id: 'withdraw', priority: 2, kw: { withdraw: 3, withdrawal: 3, cashout: 3, payout: 2, payouts: 2 },
    reply: (ctx) => {
      const m = ctx.settings.minWithdraw, f = ctx.settings.withdrawFeePct;
      let extra = '';
      if (ctx.entities.amount) {
        if (ctx.entities.amount < m) extra = ` UGX ${fmt2(ctx.entities.amount)} is below the minimum of ${fmt(m)}.`;
        else {
          const feeAmt = Math.round(ctx.entities.amount * f / 100);
          extra = ` On UGX ${fmt2(ctx.entities.amount)}, the ${f}% fee is ${fmt(feeAmt)}, so you'd receive ${fmt(ctx.entities.amount - feeAmt)}. 💸`;
        }
      }
      return `💸 Bind a payout account first (Account → Payout Account) if you haven't already, then tap Withdraw on Home. Minimum withdrawal is ${fmt(m)}, and a ${f}% fee applies. You'll need your withdrawal PIN to confirm — that's what keeps a withdrawal safe even if your phone isn't.${extra}`;
    } },

  { id: 'withdraw_timing', priority: 2, kw: { long: 1 },
    phrase: [/how long (does|will|do) (a |the )?withdraw/i, /when (will|do) i (get|receive) (my )?(money|withdraw|cash|payout)/i, /withdrawal.*(take|time|long)/i],
    reply: (ctx) => `⏱️ Withdrawals go out via mobile money once approved — typically within minutes to a few hours, depending on network load. You can always check the status under Account → Withdrawals.` },

  { id: 'fees', priority: 1, kw: { fee: 2, fees: 2, charge: 1, charges: 1, cost: 1 },
    reply: (ctx) => `💵 Deposits are free — the full amount goes into your wallet. Withdrawals carry a ${ctx.settings.withdrawFeePct}% fee, taken from the amount you withdraw, which covers mobile-money transfer costs. Minimum deposit is ${fmt(ctx.settings.minDeposit)}, minimum withdrawal is ${fmt(ctx.settings.minWithdraw)}.` },

  { id: 'why_fee', priority: 3,
    phrase: [/why (is there|do you charge|the) .*fee/i, /why.*(charge|deduct).*withdraw/i],
    reply: (ctx) => `💵 The ${ctx.settings.withdrawFeePct}% withdrawal fee covers the real cost of moving money out over mobile-money networks — those transfers aren't free on our end either. Deposits stay free since there's no equivalent outbound cost.` },

  { id: 'invest', priority: 2, kw: { invest: 3, investment: 2, plan: 2, product: 2, return: 2, profit: 2, cycle: 1, buy: 1 },
    reply: (ctx) => {
      const list = ctx.products.slice(0, 5).map(p => `${p.name} (${fmt(p.price)}, ${p.cycle} days, total ${fmt(p.expectedReturn)})`).join('; ');
      return `🚀 Browse plans on the Products tab — each shows price, cycle length and total return. A few: ${list || 'plans are being set up — check back soon'}. Tap Invest on any plan to confirm; your return is paid in full once the plan matures, and you can hold more than one plan at a time if you want to diversify.`;
    } },

  { id: 'maturity', priority: 2,
    kw: { maturity: 3, mature: 3, matures: 3 },
    phrase: [/when (do|does|will) i get (paid|my (money|return|payout))/i, /what happens (when|after) (my )?(plan|investment) (ends|finishes|matures)/i],
    reply: (ctx) => `🚀 Each plan runs for its full cycle length (shown as "Cycle" on the plan card), and the entire total return is credited to your wallet automatically the moment it matures — no manual claim needed. You can track progress on the Home tab's active-plan cards.` },

  { id: 'multi_invest', priority: 2,
    phrase: [/can i (buy|invest in|hold) (more than one|multiple|two|several|many)/i, /how many (plans|investments) can i/i],
    reply: () => `🚀 Yes — you can invest in as many plans as your wallet balance allows, at the same time. Each one runs its own independent cycle and pays out its own return on its own schedule.` },

  { id: 'cancel', priority: 2,
    phrase: [/can i cancel/i, /get (a )?refund/i, /undo (my |the )?(investment|purchase|deposit)/i, /change my mind/i],
    reply: () => `Investments can't be cancelled or refunded once confirmed — the terms (price, cycle, total return) lock in at purchase and run to maturity. Double-check the plan details in the confirmation sheet before tapping Confirm & Invest.` },

  { id: 'referral', priority: 2, kw: { referral: 3, invite: 2, commission: 3, team: 2, downline: 2, share: 1, upline: 2 },
    reply: (ctx) => `🤝 Share your referral code from the Account tab. You earn ${ctx.settings.commL1}% on Level 1 (people you directly invite), ${ctx.settings.commL2}% on Level 2, and ${ctx.settings.commL3}% on Level 3 — calculated on what each person invests, credited automatically the moment they make their first investment.${ctx.account.referralCode ? ' Your code is ' + ctx.account.referralCode + '. 🔗' : ''}` },

  { id: 'milestone', priority: 2,
    kw: { milestone: 3, milestones: 3, task: 1 },
    phrase: [/task center/i, /referral (bonus|reward|milestone)/i],
    reply: () => `🎯 The Team tab's Task Center tracks milestones based on your team size and how much they've invested — hit a target and a bonus becomes claimable there. These are on top of the normal per-level commission, not instead of it.` },

  { id: 'checkin', priority: 2, kw: { checkin: 3, daily: 2, bonus: 2, streak: 2 },
    reply: (ctx) => `📅 Tap Check In on Home once a day for ${fmt(ctx.settings.dailyCheckin)}. It resets every 24 hours, and missing a day resets your streak, so consistency is what it rewards${ctx.account.checkinStreak ? ` — you're currently on a ${ctx.account.checkinStreak}-day streak 🔥` : ''}.` },

  { id: 'pin', priority: 2, kw: { pin: 3, pincode: 3 },
    reply: () => "🔒 Your withdrawal PIN was set when you registered. To change it, go to Account → Security PIN — you'll need your current one first. It's required to bind a payout account and for every withdrawal, so even someone with your unlocked phone can't move money out without it." },

  { id: 'balance', priority: 2, kw: { balance: 3, earning: 2, earned: 2, invested: 2, wallet: 2, worth: 1 },
    reply: (ctx) => `📊 Your wallet balance is ${fmt(ctx.account.walletBalance || 0)}, you've invested ${fmt(ctx.account.totalInvested || 0)} in total, and earned ${fmt(ctx.account.totalEarned || 0)} so far. Wallet balance is what you can deposit toward a new plan or withdraw right now — it's separate from money already locked into an active plan until that plan matures.` },

  { id: 'banned', priority: 2,
    phrase: [/why (am i|is my account) (banned|suspended|blocked)/i, /account (suspended|banned|blocked|locked)/i],
    reply: (ctx) => {
      const s = ctx.settings;
      const contact = s.supportTelegram || s.whatsappContact ? ` Reach ${s.supportTelegram ? 'Telegram ' + s.supportTelegram : 'WhatsApp ' + s.whatsappContact} to ask about it.` : ' Reach Support from the Account tab to ask about it.';
      return `A suspended account is a manual action from the platform team, usually tied to a specific security or policy concern on the account — I don't have visibility into why any individual account was flagged.${contact}`;
    } },

  { id: 'support', priority: 2, kw: { support: 3, contact: 2, human: 2, agent: 2, complaint: 2, problem: 1, issue: 1 },
    reply: (ctx) => {
      const s = ctx.settings, parts = [];
      if (s.supportTelegram) parts.push(`Telegram: ${s.supportTelegram}`);
      if (s.whatsappContact) parts.push(`WhatsApp: ${s.whatsappContact}`);
      return parts.length ? `🎧 Reach our team directly — ${parts.join(', ')}.` : '🎧 Reach our support team from Account → Support.';
    } },

  { id: 'giftcode', priority: 2,
    kw: { giftcode: 3, redeem: 3, code: 1, voucher: 2, gift: 2 },
    reply: () => `🎁 If you have a gift/redeem code, enter it wherever the app prompts for one during account actions — a valid code credits your wallet immediately. Codes are single-use per account.` },

  { id: 'security_general', priority: 1,
    kw: { secure: 2, security: 2, encrypted: 1, twofactor: 2 },
    reply: () => `🔒 Your login is protected by Firebase Authentication, and every sensitive action (binding a payout account, withdrawing) is gated behind your withdrawal PIN on top of that. Your PIN itself is never stored in a readable form — only as a one-way hash.` },

  { id: 'about', priority: 1, kw: { space8: 2, platform: 2, legit: 2, legitimate: 2, safe: 2, scam: 2, trust: 2 },
    reply: () => pick([
      '🛰️ Space8 is a mobile-money investment platform — you invest in a satellite-themed plan and it pays out a fixed, pre-stated return at the end of its cycle. Deposits and withdrawals run through mobile money, and every transaction (deposit, investment, cashback, withdrawal) is logged on your Account history, nothing happens silently.',
      "🛰️ On Space8, what you invest and what you're owed back is locked in and shown to you at purchase time — the price, cycle length and total return never change after you buy, even if the plan's terms change for future buyers. That's the core mechanic: fixed terms, transparent history."
    ]) },

  { id: 'howworks', priority: 2,
    phrase: [/how does (space8|it|this) work/i, /how does the platform work/i, /explain (space8|how this works)/i],
    reply: (ctx) => `🛰️ Here's the flow: 1) Deposit mobile money into your wallet (free, min ${fmt(ctx.settings.minDeposit)}). 2) Invest wallet balance into a plan on the Products tab — price/cycle/return lock in at purchase. 3) The full return is credited automatically at maturity. 4) Withdraw to mobile money anytime from your wallet (min ${fmt(ctx.settings.minWithdraw)}, ${ctx.settings.withdrawFeePct}% fee). Referring people earns you a cut of what they invest, and daily check-ins add a small bonus on top. Ask me about any one of those steps for more detail.` }
];

const FALLBACKS = [
  "🤔 I can help with deposits, withdrawals, investing, referrals, check-ins, your balance, or the security PIN — try asking about one of those!",
  "🛰️ Not sure I caught that — I'm best with deposits, withdrawals, investing, referrals, check-ins, and your account. Try rephrasing?",
  "Hmm, I can help with things like deposits, withdrawals, investing or referrals 🙂 — or reach Support from the Account tab for anything else."
];

function scoreText(text, tokens, intent) {
  let score = 0;
  if (intent.kw) for (const [w, weight] of Object.entries(intent.kw)) if (tokens.includes(stem(w))) score += weight;
  if (intent.phrase) for (const re of intent.phrase) if (re.test(text)) score += 4;
  return score;
}
function classify(text) {
  const tokens = tokenize(text).map(stem);
  return INTENTS.map(intent => ({ intent, score: scoreText(text, tokens, intent) }))
    .sort((a, b) => b.score - a.score || a.intent.priority - b.intent.priority);
}

function matchProduct(products, tokens) {
  let best = null, bestScore = 0;
  for (const p of products || []) {
    const nameTokens = tokenize(p.name).filter(w => w.length > 2);
    if (!nameTokens.length) continue;
    let score = 0;
    for (const nt of nameTokens) if (tokens.includes(stem(nt))) score++;
    if (score > bestScore) { bestScore = score; best = p; }
  }
  return bestScore > 0 ? best : null;
}

function answerAssistant({ message, history, settings, products, account }) {
  const text = String(message || '').slice(0, 500).trim();
  if (!text) return "Type a message and I'll help. 🙂";

  const sett = settings || {};
  const prods = Array.isArray(products) ? products : [];
  const acct = account || {};

  let scored = classify(text);
  let top = scored[0];

  // Only blend in prior-turn context for SHORT ambiguous follow-ups ("and the
  // fee?", "why though?", "how about withdrawing?") -- a longer message that
  // still scores low is more likely a genuinely new, unrelated question and
  // should hit the honest fallback rather than get silently reattributed to
  // whatever topic came before it. Uses the last TWO user turns (most recent
  // weighted highest) so a short back-and-forth ("what about deposits?" ->
  // "and the fee?" -> "why though?") still tracks the right topic across
  // more than one hop.
  const isShort = tokenize(text).length <= 6;
  if ((!top || top.score < 2) && isShort && Array.isArray(history) && history.length) {
    const priorUsers = history.filter(h => h && h.role === 'user' && typeof h.text === 'string').slice(-2).reverse();
    if (priorUsers.length) {
      const curByIntent = new Map(scored.map(s => [s.intent, s.score]));
      const priorScored = priorUsers.map(u => new Map(classify(u.text).map(s => [s.intent, s.score])));
      const blended = INTENTS
        .map(intent => {
          let score = (curByIntent.get(intent) || 0) * 3;
          priorScored.forEach((m, i) => { score += (m.get(intent) || 0) * (i === 0 ? 2 : 1); });
          return { intent, score };
        })
        .sort((a, b) => b.score - a.score);
      if (blended[0].score > (top ? top.score : 0)) top = blended[0];
    }
  }

  const tokens = tokenize(text).map(stem);
  const entities = { amount: extractAmount(text) };
  const ctx = { message: text, history, settings: sett, products: prods, account: acct, entities };

  const product = matchProduct(prods, tokens);
  if (product && (!top || top.score < 4)) {
    const daily = Math.round((product.expectedReturn || 0) / (product.cycle || 1));
    return `🛰️ ${product.name}: price ${fmt(product.price)}, ${product.cycle}-day cycle, ${fmt(daily)}/day, total payout ${fmt(product.expectedReturn)} at maturity. Tap Invest on the Products tab to buy in.`;
  }

  if (top && top.score >= 2) return top.intent.reply(ctx);

  return pick(FALLBACKS);
}

module.exports = { answerAssistant };
