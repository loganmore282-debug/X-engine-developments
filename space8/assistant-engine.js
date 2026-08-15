/* SPACE8 ASSISTANT ENGINE
   Self-hosted support intelligence for POST /assistant/chat — no external LLM
   API, no per-message cost. Every reply is grounded in the same live data the
   admin actually configured (getSettings()/getProducts()) and the caller's
   own account, so answers are always numerically correct even as the admin
   changes fees/rates/products — the old client-side regex FAQ this replaced
   could silently go stale, this can't.

   How it decides what to say:
     1. Normalize + tokenize the message, stem each token (crude suffix
        folding) so "deposits"/"depositing"/"deposited" all match "deposit".
     2. Score every intent by keyword weight + regex phrase bonus.
     3. If the message is short/ambiguous (low top score) and there's prior
        history, blend in the previous user message's scores so a one-word
        follow-up ("and the fee?") still lands on the right topic.
     4. Separately try to match a live product by name against the message —
        this lets a specific-plan question ("how much is Voyager 1") get a
        real, numeric answer instead of a generic "browse Products" reply.
     5. Extract a money amount from the message (comma-grouped or 4+ digit
        number) so deposit/withdraw replies can react to it directly (e.g.
        compute the real fee on a withdrawal amount).
     6. Highest-scoring intent's handler runs against that context and
        returns plain text. Below a confidence floor, a fallback lists what
        it can actually help with instead of guessing.
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
      ? 'To change your withdrawal PIN, go to Account → Security PIN. If you never set one, it should have been created at registration — contact Support if that looks wrong.'
      : "I can't see or share your PIN or password — they're never stored anywhere in a readable form. You can change your PIN anytime from Account → Security PIN." },

  { id: 'greeting', priority: 1, kw: { hi: 2, hello: 2, hey: 2, hallo: 2, morning: 1, afternoon: 1, evening: 1, sup: 1, yo: 1, greeting: 2 },
    reply: () => pick([
      "Hi! I'm the Space8 assistant. Ask me about deposits, withdrawals, investing, referrals, check-ins or your account.",
      "Hello! What can I help you with on Space8 today?"
    ]) },

  { id: 'thanks', priority: 1, kw: { thank: 2, thanks: 2, appreciate: 2, appreciated: 2, nice: 1, great: 1 },
    reply: () => pick(["You're welcome! Anything else I can help with?", 'Happy to help — let me know if you need anything else.']) },

  { id: 'bye', priority: 1, kw: { bye: 2, goodbye: 2, cya: 1, later: 1 },
    reply: () => 'Take care! Come back anytime you have a question.' },

  { id: 'whoami', priority: 1,
    phrase: [/who are you/i, /are you (a )?(human|real person|robot|ai|bot)/i, /what are you/i],
    reply: () => "I'm the Space8 in-app assistant — I answer using your platform's live settings and your own account data. I can't perform actions myself, only explain how things work." },

  { id: 'capability', priority: 1,
    phrase: [/what can you (do|help)/i, /help me with/i, /what do you know/i],
    reply: () => 'I can help with deposits, withdrawals, investing, referrals, check-ins, your account balance, and your security PIN. Ask away.' },

  { id: 'deposit', priority: 2, kw: { deposit: 3, topup: 2, fund: 1, recharge: 2, addmoney: 2, addfund: 2, momo: 1 },
    reply: (ctx) => {
      const m = ctx.settings.minDeposit;
      let extra = '';
      if (ctx.entities.amount) {
        extra = ctx.entities.amount < m
          ? ` UGX ${fmt2(ctx.entities.amount)} is below the minimum — deposit at least ${fmt(m)}.`
          : ` UGX ${fmt2(ctx.entities.amount)} works — that's above the minimum of ${fmt(m)}.`;
      }
      return `Tap Deposit on Home, enter an amount (minimum ${fmt(m)}), choose your mobile-money network and confirm the prompt on your phone.${extra}`;
    } },

  { id: 'withdraw', priority: 2, kw: { withdraw: 3, withdrawal: 3, cashout: 3, payout: 2, payouts: 2 },
    reply: (ctx) => {
      const m = ctx.settings.minWithdraw, f = ctx.settings.withdrawFeePct;
      let extra = '';
      if (ctx.entities.amount) {
        if (ctx.entities.amount < m) extra = ` UGX ${fmt2(ctx.entities.amount)} is below the minimum of ${fmt(m)}.`;
        else {
          const feeAmt = Math.round(ctx.entities.amount * f / 100);
          extra = ` On UGX ${fmt2(ctx.entities.amount)}, the ${f}% fee is ${fmt(feeAmt)}, so you'd receive ${fmt(ctx.entities.amount - feeAmt)}.`;
        }
      }
      return `Bind a payout account first (Account → Payout Account) if you haven't already, then tap Withdraw on Home. Minimum withdrawal is ${fmt(m)}, and a ${f}% fee applies.${extra}`;
    } },

  { id: 'fees', priority: 1, kw: { fee: 2, fees: 2, charge: 1, charges: 1, cost: 1 },
    reply: (ctx) => `Deposits are free. Withdrawals carry a ${ctx.settings.withdrawFeePct}% fee, taken from the amount you withdraw. Minimum deposit is ${fmt(ctx.settings.minDeposit)}, minimum withdrawal is ${fmt(ctx.settings.minWithdraw)}.` },

  { id: 'invest', priority: 2, kw: { invest: 3, investment: 2, plan: 2, product: 2, return: 2, profit: 2, cycle: 1, maturity: 1, buy: 1 },
    reply: (ctx) => {
      const list = ctx.products.slice(0, 5).map(p => `${p.name} (${fmt(p.price)}, ${p.cycle} days, total ${fmt(p.expectedReturn)})`).join('; ');
      return `Browse plans on the Products tab — each shows price, cycle length and total return. A few: ${list || 'plans are being set up — check back soon'}. Tap Invest on any plan to confirm; the full amount is paid out at maturity.`;
    } },

  { id: 'referral', priority: 2, kw: { referral: 3, invite: 2, commission: 3, team: 2, downline: 2, share: 1, upline: 2 },
    reply: (ctx) => `Share your referral code from the Account tab. You earn ${ctx.settings.commL1}% on Level 1, ${ctx.settings.commL2}% on Level 2 and ${ctx.settings.commL3}% on Level 3 of what your team invests.${ctx.account.referralCode ? ' Your code is ' + ctx.account.referralCode + '.' : ''}` },

  { id: 'checkin', priority: 2, kw: { checkin: 3, daily: 2, bonus: 2, streak: 2 },
    reply: (ctx) => `Tap Check In on Home once a day for ${fmt(ctx.settings.dailyCheckin)}. It resets every 24 hours${ctx.account.checkinStreak ? ` — you're on a ${ctx.account.checkinStreak}-day streak` : ''}.` },

  { id: 'pin', priority: 2, kw: { pin: 3, pincode: 3 },
    reply: () => "Your withdrawal PIN was set when you registered. To change it, go to Account → Security PIN. It's required to bind a payout account and for every withdrawal." },

  { id: 'balance', priority: 2, kw: { balance: 3, earning: 2, earned: 2, invested: 2, wallet: 2, worth: 1 },
    reply: (ctx) => `Your wallet balance is ${fmt(ctx.account.walletBalance || 0)}, you've invested ${fmt(ctx.account.totalInvested || 0)} in total, and earned ${fmt(ctx.account.totalEarned || 0)} so far.` },

  { id: 'support', priority: 2, kw: { support: 3, contact: 2, human: 2, agent: 2, complaint: 2, problem: 1, issue: 1 },
    reply: (ctx) => {
      const s = ctx.settings, parts = [];
      if (s.supportTelegram) parts.push(`Telegram: ${s.supportTelegram}`);
      if (s.whatsappContact) parts.push(`WhatsApp: ${s.whatsappContact}`);
      return parts.length ? `Reach our team directly — ${parts.join(', ')}.` : 'Reach our support team from Account → Support.';
    } },

  { id: 'about', priority: 1, kw: { space8: 2, platform: 2, legit: 2, legitimate: 2, safe: 2, scam: 2, trust: 2 },
    reply: () => 'Space8 is a mobile-money investment platform — you invest in a plan and it pays out a fixed return at the end of its cycle. Deposits and withdrawals run through mobile money, and every transaction is logged on your account.' }
];

function fmt2(n) { return Number(n || 0).toLocaleString('en-UG'); }

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
  if (!text) return "Type a message and I'll help.";

  const sett = settings || {};
  const prods = Array.isArray(products) ? products : [];
  const acct = account || {};

  let scored = classify(text);
  let top = scored[0];

  // Only blend in prior-turn context for SHORT ambiguous follow-ups ("and the
  // fee?", "how about withdrawing?") -- a longer message that still scores
  // low is more likely a genuinely new, unrelated question and should hit
  // the honest fallback rather than get silently reattributed to whatever
  // topic came before it.
  const isShort = tokenize(text).length <= 6;
  if ((!top || top.score < 2) && isShort && Array.isArray(history) && history.length) {
    const lastUser = [...history].reverse().find(h => h && h.role === 'user' && typeof h.text === 'string');
    if (lastUser) {
      const curByIntent = new Map(scored.map(s => [s.intent, s.score]));
      const prevByIntent = new Map(classify(lastUser.text).map(s => [s.intent, s.score]));
      const blended = INTENTS
        .map(intent => ({ intent, score: (curByIntent.get(intent) || 0) * 2 + (prevByIntent.get(intent) || 0) }))
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
    return `${product.name}: price ${fmt(product.price)}, ${product.cycle}-day cycle, ${fmt(daily)}/day, total payout ${fmt(product.expectedReturn)} at maturity. Tap Invest on the Products tab to buy in.`;
  }

  if (top && top.score >= 2) return top.intent.reply(ctx);

  return "I can help with deposits, withdrawals, investing, referrals, check-ins, your balance, or the security PIN — try asking about one of those, or reach Support from the Account tab for anything else.";
}

module.exports = { answerAssistant };
