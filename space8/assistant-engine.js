/* SPACE8 ASSISTANT ENGINE
   Self-hosted support intelligence for POST /assistant/chat — no external LLM
   API, no per-message cost. Every reply is grounded in the same live data the
   admin actually configured (getSettings()/getProducts()) and the caller's
   own account, so answers are always numerically correct even as the admin
   changes fees/rates/products — the old client-side regex FAQ this replaced
   could silently go stale, this can't.

   This is a rule-based engine, not a language model — there is no external
   API and nothing was "trained" on external text. What makes it feel more
   capable than a flat FAQ table is: 100 weighted intents covering the whole
   platform in real depth (not just "how do I X" but "why does X work that
   way", timing, safety, edge cases, stuck/pending problem reports), typo
   normalization + conservative one-edit fuzzy keyword matching, live
   product-name + money-amount
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
const TOKEN_ALIASES={depost:'deposit',depsit:'deposit',deposite:'deposit',withdrawl:'withdrawal',withdrawel:'withdrawal',withraw:'withdrawal',invesment:'investment',investement:'investment',refferal:'referral',referal:'referral',commision:'commission',comission:'commission',promocode:'giftcode',momo:'mobilemoney',passwd:'password'};
function tokenize(s){return normalize(s).split(' ').filter(Boolean).map(w=>TOKEN_ALIASES[w]||w);}
function editDistanceOne(a,b){if(a===b)return true;if(a.length<5||b.length<5||Math.abs(a.length-b.length)>1)return false;let i=0,j=0,e=0;while(i<a.length&&j<b.length){if(a[i]===b[j]){i++;j++;continue;}if(++e>1)return false;if(a.length>b.length)i++;else if(b.length>a.length)j++;else{i++;j++;}}return e+(i<a.length||j<b.length?1:0)<=1;}
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
    phrase: [/what('?s| is) my (pin|password)/i, /tell me my (pin|password)/i, /show (me )?my (pin|password)/i, /can you see my (pin|password)/i, /forgot (my )?password/i],
    reply: (ctx) => /forgot/i.test(ctx.message)
      ? '🔐 Passwords are handled by Firebase Authentication and are never readable by staff or by me. The sign-in screen has no self-service reset — contact Support with your registered phone number and they can reset it for you. Your withdrawal PIN is separate — see Account → Security PIN.'
      : "🔒 I can't see or share your PIN or password — they're never stored anywhere in a readable form, only as a one-way hash, so there's genuinely nothing to hand over even if I wanted to. You can change your PIN anytime from Account → Security PIN." },

  { id: 'greeting', priority: 1,
    kw: { hi: 2, hii: 2, hello: 2, hallo: 2, morning: 2, afternoon: 2, evening: 2, sup: 1, yo: 1, yoo: 1, greeting: 2, howdy: 2 },
    phrase: [/^good day/i, /^h+[ei]+y*!*$/i, /^y+o+!*$/i, /^s+u+p+!*$/i, /^(hi|hey|hello|yo|hallo)( there| again| bro| man| sir| madam| space8)?[\s!.]*$/i, /^good (morning|afternoon|evening)/i],
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

  { id: 'thanks', priority: 1, kw: { tnx: 3, thx: 3, thank: 2, thanks: 2, appreciate: 2, appreciated: 2 },
    reply: () => pick(["You're welcome! 😊 Anything else I can help with?", "Happy to help! 🙌 Let me know if you need anything else.", "Anytime! 👍"]) },

  { id: 'bye', priority: 1, kw: { goodnight: 3, bye: 2, goodbye: 2, cya: 2, later: 2 }, phrase: [/^(bye|cya|goodbye)/i, /see you (later|around|soon)/i],
    reply: () => pick(['Take care! 👋 Come back anytime you have a question.', 'See you around! 🛰️']) },

  { id: 'whoami', priority: 1,
    phrase: [/are you (real|a machine)/i, /is this a human/i, /who are you/i, /are you (a )?(human|real person|robot|ai|bot)/i, /what are you\??$/i, /what are you exactly/i],
    reply: () => "🤖 I'm the Space8 in-app assistant — I answer using your platform's live settings and your own account data, computed fresh every time you ask, not from a script that can go stale. I can't perform actions myself (I can't move money or change settings), only explain how things work and what the numbers are right now." },

  { id: 'capability', priority: 1,
    phrase: [/what are you for/i, /what (else )?can you (do|help)/i, /how can you help/i, /what questions can i ask/i, /what are you for/i, /what can you (do|help)/i, /help me with/i, /what do you know/i],
    reply: () => "🛰️ I can help with deposits, withdrawals, investing (including specific plan details), referrals and commissions, check-ins, your live balance, the security PIN, and general questions about how Space8 works. Ask away!" },

  { id: 'deposit', priority: 2, kw: { deposit: 3, topup: 2, fund: 1, recharge: 2, addmoney: 2, addfund: 2, momo: 1 },
    phrase: [/how do i pay in/i, /add (funds|money|cash)/i, /top ?up/i, /fund my account/i, /put money (in|into)/i, /load (my )?(wallet|account)/i],
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
    phrase: [/cash ?out/i, /take (my )?money out/i, /get my money( out)?/i],
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
      return `💸 Bind a withdrawal account first (Account → Withdrawal Account) if you haven't already, then tap Withdraw on Home. Minimum withdrawal is ${fmt(m)}, and a ${f}% fee applies. You'll need your withdrawal PIN to confirm — that's what keeps a withdrawal safe even if your phone isn't.${extra}`;
    } },

  { id: 'withdraw_timing', priority: 6, kw: { long: 1 },
    phrase: [/how soon will i be paid/i, /how many hours for withdrawal/i, /time taken to withdraw/i, /when does withdrawal arrive/i, /how long (does|will|do) (a |the )?withdraw/i, /when (will|do) i (get|receive) (my )?(money|withdraw|cash|payout)/i, /withdrawal.{0,20}(take|time|long)/i, /how long (until|till|before).{0,25}(paid|money|withdraw)/i],
    reply: (ctx) => `⏱️ Withdrawals go out via mobile money once approved — typically within minutes to a few hours, depending on network load. You can always check the status under Account → Withdrawals.` },

  { id: 'fees', priority: 1, kw: { fee: 2, fees: 2, charge: 2, charges: 2, cost: 2 },
    reply: (ctx) => `💵 Deposits are free — the full amount goes into your wallet. Withdrawals carry a ${ctx.settings.withdrawFeePct}% fee, taken from the amount you withdraw, which covers mobile-money transfer costs. Minimum deposit is ${fmt(ctx.settings.minDeposit)}, minimum withdrawal is ${fmt(ctx.settings.minWithdraw)}.` },

  { id: 'why_fee', priority: 3,
    phrase: [/why the deduction/i, /reason for the fee/i, /why do i pay a fee/i, /why (is there|do you charge|the) .*fee/i, /why.*(charge|deduct).*withdraw/i],
    reply: (ctx) => `💵 The ${ctx.settings.withdrawFeePct}% withdrawal fee covers the real cost of moving money out over mobile-money networks — those transfers aren't free on our end either. Deposits stay free since there's no equivalent outbound cost.` },

  { id: 'invest', priority: 2, phrase: [/buy a satellite/i], kw: { invest: 3, investment: 2, plan: 2, product: 2, return: 2, profit: 2, cycle: 1, buy: 1 },
    reply: (ctx) => {
      const list = ctx.products.slice(0, 5).map(p => `${p.name} (${fmt(p.price)}, ${p.cycle} days, total ${fmt(p.expectedReturn)})`).join('; ');
      return `🚀 Browse plans on the Products tab — each shows price, cycle length and total return. A few: ${list || 'plans are being set up — check back soon'}. Tap Invest on any plan to confirm; cashback is credited daily throughout the plan cycle, and you can hold more than one plan at a time if you want to diversify.`;
    } },

  { id: 'maturity', priority: 2,
    kw: { maturity: 3, mature: 3 },
    phrase: [/end of cycle/i, /when is my payout/i, /when (do|does|will) i get (paid|my (money|return|payout))/i, /what happens when (my )?(plan|investment) (ends|finishes|matures)/i, /when (does|will) (my |the )?(plan|investment) (finish|end|complete|mature)/i],
    reply: (ctx) => `🚀 Each plan runs for its full cycle length. Cashback is credited automatically day by day, and final settlement makes the paid total match the promised return. No manual claim is needed; track each plan separately under Products → My Products.` },

  { id: 'multi_invest', priority: 2,
    phrase: [/(own|have|hold) (two|three|several|multiple) (plans|investments)/i, /more than one investment/i, /several plans/i, /can i (buy|invest in|hold) (more than one|multiple|two|several|many)/i, /how many (plans|investments) can i/i],
    reply: () => `🚀 Yes — you can invest in as many plans as your wallet balance allows, at the same time. Each one runs its own independent cycle and credits its own daily cashback on its own schedule.` },

  { id: 'cancel', priority: 6, kw: {refund:3},
    phrase: [/cancel (my |the )?plan/i, /take my money back/i, /can i cancel/i, /get (a )?refund/i, /undo (my |the )?(investment|purchase|deposit)/i, /changed? my mind/i],
    reply: () => `Investments can't be cancelled or refunded once confirmed — the terms (price, cycle, total return) lock in at purchase and run to maturity. Double-check the plan details in the confirmation sheet before tapping Confirm & Invest.` },

  { id: 'referral', priority: 2, kw: { referral: 3, invite: 2, commission: 3, team: 2, downline: 2, share: 1, upline: 2 },
    phrase: [/how to refer people/i, /how do referrals? work/i, /earn (from|with|off) (my )?(team|referrals?|downline)/i],
    reply: (ctx) => `🤝 Share your referral code from the Account tab. You earn ${ctx.settings.commL1}% on Level 1 (people you directly invite), ${ctx.settings.commL2}% on Level 2, and ${ctx.settings.commL3}% on Level 3 — calculated on what each person invests, credited automatically the moment they make their first investment.${ctx.account.referralCode ? ' Your code is ' + ctx.account.referralCode + '. 🔗' : ''}` },

  { id: 'milestone', priority: 2,
    kw: { milestone: 3, milestones: 3, mission: 3, missions: 3, task: 1 },
    phrase: [/what are the tasks/i, /task ?cent(er|re)/i, /referral (bonus|reward|milestone)/i],
    reply: () => `🎯 The Team tab's Task Center tracks milestones based on your team size and how much they've invested — hit a target and a bonus becomes claimable there. These are on top of the normal per-level commission, not instead of it.` },

  { id: 'checkin', priority: 2, kw: { checkin: 3, daily: 2, bonus: 2, streak: 2 },
    phrase: [/check ?in bonus info/i, /how do i check ?in/i, /what is check ?in/i, /(tell me about|explain).{0,15}(daily bonus|check ?in|streak)/i, /^daily reward/i],
    reply: (ctx) => `📅 Tap Check In on Home once a day for ${fmt(ctx.settings.dailyCheckin)}. It follows the platform’s Uganda calendar day, and missing a day resets your streak, so consistency is what it rewards${ctx.account.checkinStreak ? ` — you're currently on a ${ctx.account.checkinStreak}-day streak 🔥` : ''}.` },

  { id: 'pin', priority: 3, kw: { pin: 3, pincode: 3 },
    phrase: [/(withdrawal|security|payout) pin/i, /what is the pin for/i, /why do i need a pin/i],
    reply: () => "🔒 Your withdrawal PIN was set when you registered. To change it, go to Account → Security PIN — you'll need your current one first. It's required to bind a withdrawal account and for every withdrawal, so even someone with your unlocked phone can't move money out without it." },

  { id: 'balance', priority: 2, kw: { balance: 3, earning: 2, earned: 2, invested: 2, wallet: 2, worth: 1 },
    phrase: [/how much (do i|have i) (have|got|hold)/i, /how much have i (invested|earned)/i, /show (me )?my (wallet|balance)/i],
    reply: (ctx) => `📊 Your wallet balance is ${fmt(ctx.account.walletBalance || 0)}, you've invested ${fmt(ctx.account.totalInvested || 0)} in total, and earned ${fmt(ctx.account.totalEarned || 0)} so far. Wallet balance is what you can deposit toward a new plan or withdraw right now — it's separate from money already locked into an active plan until that plan matures.` },

  { id: 'banned', priority: 2, kw: {banned:3,suspended:3,restricted:3,disabled:2},
    phrase: [/why (am i|is my account) (banned|suspended|blocked)/i, /account (is )?(suspended|banned|blocked|locked)/i],
    reply: (ctx) => {
      const s = ctx.settings;
      const contact = s.supportTelegram || s.whatsappContact ? ` Reach ${s.supportTelegram ? 'Telegram ' + s.supportTelegram : 'WhatsApp ' + s.whatsappContact} to ask about it.` : ' Reach Support from the Account tab to ask about it.';
      return `A suspended account is usually a manual action from the platform team, tied to a specific security or policy concern — but a small number of accounts are also auto-suspended by the system itself, for patterns like a burst of deposit attempts that never actually clears. Either way I don't have visibility into why any individual account was flagged.${contact}`;
    } },

  { id: 'support', priority: 2, kw: { support: 3, contact: 2, human: 2, agent: 2, complaint: 2, problem: 1, issue: 1 },
    phrase: [/help me please/i, /who do i talk to/i, /customer (care|service|support)/i, /need help from (someone|a person|staff)/i, /how do i contact/i],
    reply: (ctx) => {
      const s = ctx.settings, parts = [];
      if (s.supportTelegram) parts.push(`Telegram: ${s.supportTelegram}`);
      if (s.whatsappContact) parts.push(`WhatsApp: ${s.whatsappContact}`);
      return parts.length ? `🎧 Reach our team directly — ${parts.join(', ')}.` : '🎧 Reach our support team from Account → Support.';
    } },

  { id: 'giftcode', priority: 2,
    kw: { giftcode: 3, redeem: 3, code: 1, voucher: 2, gift: 2 },
    phrase: [/^promo code$/i, /where.{0,20}enter.{0,20}(promo|gift)? ?code/i, /what is a gift code/i],
    reply: () => `🎁 If you have a gift/redeem code, open Account and enter it in the Gift Code box — a valid code credits your wallet immediately. Codes are single-use per account.` },

  { id: 'security_general', priority: 1,
    kw: { secure: 2, security: 2, encrypted: 2, encryption: 2, twofactor: 2 },
    phrase: [/how do you protect my account/i, /two.?factor|2fa/i, /encrypt/i, /how secure/i],
    reply: () => `🔒 Your login is protected by Firebase Authentication, and every sensitive action (binding a withdrawal account, withdrawing) is gated behind your withdrawal PIN on top of that. Your PIN itself is never stored in a readable form — only as a one-way hash.` },

  { id: 'about', priority: 1, phrase: [/is (this|it) (genuine|real|legit|trustworthy)/i, /what is this (app|platform|site)/i], kw: { space8: 2, platform: 2, legit: 2, legitimate: 2, safe: 2, scam: 2, trust: 2 },
    reply: () => pick([
      '🛰️ Space8 is a mobile-money investment platform — you invest in a satellite-themed plan and it pays out a fixed, pre-stated return through automatic daily cashback across its cycle. Deposits and withdrawals run through mobile money, and every transaction (deposit, investment, cashback, withdrawal) is logged on your Account history, nothing happens silently.',
      "🛰️ On Space8, what you invest and what you're owed back is locked in and shown to you at purchase time — the price, cycle length and total return never change after you buy, even if the plan's terms change for future buyers. That's the core mechanic: fixed terms, automatic daily cashback, and transparent history."
    ]) },


  { id:'deposit_pending',priority:8,kw:{pending:3,stuck:3,missing:3,failed:3,deposit:2},phrase:[/paid but wallet not updated/i, /wallet not updated/i, /my money was deducted/i, /paid but wallet not updated/i, /deposit.{0,25}(pending|stuck|not (showing|credited|received)|failed)/i,/(paid|money deducted).{0,25}(deposit|nothing happened)/i,/i paid but nothing happened/i],reply:()=> '⏳ Confirm the mobile-money prompt was approved and keep the app open briefly while it checks MarzPay. Do not create repeated deposits rapidly. If money was deducted but the wallet is unchanged after several minutes, save the transaction reference and contact Support — never share your PIN.' },
  { id:'withdraw_pending',priority:6,phrase:[/(withdraw\w*|cash ?out).{0,25}(pending|stuck|missing|processing|sending)/i,/(withdraw\w*|cash ?out).{0,25}not (received|arrived|come)/i],reply:()=> '⏳ Check Account → Withdrawals. Pending awaits approval; Sending/Processing means a payout attempt is underway and must not be submitted again blindly. If it stays unchanged unusually long, contact Support with the Space8 reference — never share your PIN.' },
  { id:'commission_missing',priority:6,kw:{missing:3,zero:3,unpaid:3,commission:2,referral:1},phrase:[/no commission (received|paid)/i, /commission did ?n.?t come/i, /(commission|referral).{0,25}(missing|zero|unpaid)/i,/(did ?n.?t|did not|never|not).{0,20}(get|got|receiv|paid|credited).{0,25}(commission|referral)/i,/(commission|referral).{0,25}not (paid|credited|showing|received)/i],reply:c=>`🤝 Commission is credited when an eligible referred member completes their first investment, not merely registration or deposit. Current Levels 1–3 are ${c.settings.commL1}% / ${c.settings.commL2}% / ${c.settings.commL3}%. If an eligible purchase completed with no credit, contact Support with the approximate time — never send passwords or PINs.`},
  { id:'investment_missing',priority:5,phrase:[/purchase not showing/i, /(bought|paid).{0,20}no plan/i, /plan not appearing/i, /(investment|plan).*(missing|not showing|disappeared|failed)/i,/money deducted.*(invest|plan)/i],reply:()=> '🚀 Refresh Home and Products → My Products. If wallet money was deducted but no plan appears, stop retrying and contact Support with the time and plan name so the records can be reconciled safely.' },
  { id:'payout_account',priority:4,phrase:[/(bind|save|register|add) (my )?(mobile money |payout |withdrawal )?(number|account)/i, /(bind|add|change|remove|delete).*(payout|withdrawal) account/i,/(bind|add|change|remove|delete).*(mobile money|momo) account/i,/(payout|withdrawal) account/i],reply:()=> '📱 Use Account → Withdrawal Account. Enter your real Uganda mobile-money number and correct network. You can bind more than one account and switch between them when withdrawing; adding, deleting or picking one still requires your withdrawal PIN for deletes.' },
  { id:'password',priority:4,kw:{password:3,login:2,signin:2},phrase:[/cannot log ?in|can.t log ?in/i, /login failed/i, /forgot.*password/i,/change.*password/i,/can.t (login|sign in)/i],reply:()=> '🔐 Firebase Authentication handles your login password; staff and this assistant cannot read it. There is no self-service reset on the sign-in screen — contact Support with your registered phone number and they can reset it for you. Your withdrawal PIN is separate under Account → Security PIN.' },
  { id:'history',priority:3,kw:{history:3,transaction:2,record:2,receipt:2},reply:()=> '🧾 Account contains Deposit and Withdrawal histories. Investment progress is under Products → My Products. Keep the Space8 reference for anything Support must investigate.' },
  { id:'notifications',priority:3,kw:{notification:3,alert:2,bell:2,push:2},reply:()=> '🔔 Tap the Home bell for announcements. Push alerts also require phone/browser notification permission; enable it in device settings and reopen Space8.' },
  { id:'maintenance',priority:4, phrase: [/(platform|site|app) (is )?down/i],kw:{maintenance:3,offline:2,unavailable:2,downtime:2},reply:c=>c.settings.maintenanceMode?`🛠️ Space8 is under maintenance. ${c.settings.maintenanceMsg||'Please try again shortly.'}`:'✅ Space8 is not marked as under maintenance. Check your connection, avoid repeating money actions, and give Support the exact error.'},
  { id:'rules',priority:3,kw:{rule:3,rules:3,policy:2,terms:2},reply:c=>c.settings.rulesText?`📋 Current rules: ${String(c.settings.rulesText).slice(0,900)}`:'📋 Open Account → Rules or Terms. Those admin-managed pages are the source of truth.'},
  { id:'announcement',priority:3,kw:{ notice: 3,announcement:3,update:2,news:2,updates:2},reply:c=>c.settings.annEnabled?`📢 ${c.settings.annTitle||'Announcement'}: ${c.settings.annBody||'Open Home for details.'}`:'📢 There is no active platform announcement right now.'},
  { id:'network_error',priority:4,phrase:[/cannot connect|can.t connect/i, /(network|connection|server).*(error|failed|problem|unavailable|down)/i,/something went wrong/i],reply:()=> '📶 Check data/Wi-Fi and reopen the app. Before retrying a deposit, investment or withdrawal, verify its status; save the exact error and reference for Support.'},
  { id:'mobile_networks',priority:3,kw:{mtn:3,airtel:3,mobilemoney:2},phrase:[/what networks/i, /which (mobile money )?networks?/i,/mobile money (network|provider)/i],reply:()=> '📱 Select the same network as the Uganda mobile-money number entered. Use 07XXXXXXXX or +2567XXXXXXXX, and never approve an unfamiliar prompt.'},
  { id:'welcome_bonus',priority:6,phrase:[/free money when i join/i, /new user bonus/i, /(welcome|registration|signup|sign up|joining|join).{0,20}(bonus|gift|reward)/i],reply:c=>`🎉 The current registration bonus is ${fmt(c.settings.welcomeBonus||0)}. It is credited once after registration; withdrawal rules may require buying a plan first.`},
  { id:'referral_not_applied',priority:5,phrase:[/code not applied/i, /add (my )?(invite|referral) code now/i, /referral code.*(didn.?t|did not|wasn.?t|was not|never) (apply|work|credit)/i,/(forgot|didn.?t|did not).{0,8}(enter|add|use).*(referral|invite) code/i,/add.*(referral|invite) code (after|later)/i],reply:()=> "🤝 A referral code only attaches if it's entered during registration, before the account is created — it can't be added or changed afterward, even by Support in most cases. If you registered with the correct code and it still isn't reflected on the referrer's Team tab, contact Support with both phone numbers and the registration date so it can be checked." },
  { id:'phone_change',priority:4,phrase:[/(change|correct|wrong).{0,20}(registered )?(phone )?number/i, /(change|update|correct|fix).{0,20}(my )?(registered )?phone/i,/phone.{0,20}(is |was )?(wrong|incorrect)/i,/registered.{0,20}(wrong|incorrect) (phone|number)/i],reply:()=> "📱 Your registered phone number isn't self-editable in the app — it's tied to your account and payout history. If it's wrong or you've changed numbers, contact Support with your old and new number so it can be corrected safely." },

  { id: 'howworks', priority: 2,
    phrase: [/explain how it works/i, /how do i make money here/i, /how does (this|the) platform operate/i, /how does (space8|it|this) work/i, /how does the platform work/i, /explain (space8|how this works)/i],
    reply: (ctx) => `🛰️ Here's the flow: 1) Deposit mobile money into your wallet (free, min ${fmt(ctx.settings.minDeposit)}). 2) Invest wallet balance into a plan on the Products tab — price/cycle/return lock in at purchase. 3) Cashback is credited automatically each day until the plan completes. 4) Withdraw to mobile money anytime from your wallet (min ${fmt(ctx.settings.minWithdraw)}, ${ctx.settings.withdrawFeePct}% fee). Referring people earns you a cut of what they invest, and daily check-ins add a small bonus on top. Ask me about any one of those steps for more detail.` },

  { id: 'install_app', priority: 3,
    kw: { apk: 3, install: 3, app: 2, homescreen: 3, download: 2 },
    phrase: [/play ?store/i, /(install|download|add).*(app|to (my )?home ?screen)/i, /get the app/i, /is there an app/i],
    reply: () => "📲 Space8 works as an installable app right from your browser — no app store needed. Open Account and tap Get App (it's just above Log Out). If your browser doesn't support one-tap install, use its menu and choose \"Add to Home Screen\" instead." },

  { id: 'cumulative_earnings', priority: 3,
    kw: { cumulative: 3, earning: 2, earnings: 2 },
    phrase: [/cumulative earning/i, /how (are|is) .*(cumulative|total) earning.*(count|calculat|work)/i],
    reply: (ctx) => `📊 Cumulative Earnings (shown on Products) adds up plan payouts (cashback plus final maturity), referral commission, Task Center rewards, gift-code credits and daily check-in bonuses — everything you've genuinely earned. The one thing it leaves out is the one-time welcome bonus on registration, since that's a signup gift rather than something earned. Team → Total Commission shows the referral slice on its own; your wallet balance is everything combined, including the welcome bonus.${ctx.account.totalEarned != null ? ' Yours is currently ' + fmt(ctx.account.totalEarned) + '.' : ''}` },

  { id: 'account_id', priority: 3,
    kw: { id: 2, memberid: 3, publicid: 3, accountid: 3 },
    phrase: [/account number/i, /(my|the) (account|member|user) id/i, /what('?s| is) my id/i],
    reply: (ctx) => `🆔 Every Space8 account gets a permanent, unique ID (shown as "ID:" on your Account screen) — it's assigned automatically when you register and never changes.${ctx.account.publicId ? ' Yours is ID:' + ctx.account.publicId + '.' : ''}` },

  { id: 'telegram_community', priority: 2,
    kw: { whatsapp: 3, telegram: 3, community: 2, group: 1, channel: 1 },
    phrase: [/social media/i, /telegram (group|channel)/i, /join.*(community|telegram)/i],
    reply: (ctx) => {
      const s = ctx.settings, parts = [];
      if (s.telegramGroup) parts.push('Group: ' + s.telegramGroup);
      if (s.telegramChannel) parts.push('Channel: ' + s.telegramChannel);
      return parts.length ? `💬 Join us on Telegram — ${parts.join(', ')}. You'll also find both links under Account → Join The Community.` : '💬 Telegram links aren\'t set up yet — check Account → Join The Community for updates.';
    } },

  { id: 'giftcode_case', priority: 4,
    phrase: [/code says invalid/i, /(promo|gift) code (error|rejected)/i, /(gift|redeem|promo) code.*(not work|invalid|wrong|failed|didn.?t work)/i, /code (not working|invalid)/i],
    reply: () => "🎁 Gift codes are case-sensitive, so double check you're typing capital and lowercase letters exactly as given — a code like \"fsT63\" won't work as \"fst63\" or \"FST63\". If you've copied it directly and it still fails, it may already be used or expired." },

  { id: 'multi_withdrawal_accounts', priority: 7,
    phrase: [/(another|second|two|several) (mobile money|payout|withdrawal) (account|number)s?/i, /(more than one|multiple|two|several).*(withdrawal|payout) account/i, /add (another|a second) (withdrawal|payout) account/i],
    reply: () => '📱 Yes — you can bind more than one withdrawal account. Add each one from Account → Withdrawal Account, then pick which one to use each time you withdraw by tapping the account row on the Withdraw screen.' },

  { id: 'checkin_streak_reset', priority: 6,
    phrase: [/streak went to zero/i, /(streak|check ?in).{0,25}(broke|broken|lost|missed)/i, /(lost|broke|missed).{0,20}(my |a )?(streak|check ?in|day)/i, /missed (a|my) (day|check ?in)/i, /(my )?streak (reset|has reset|was reset)/i],
    reply: (ctx) => `📅 The check-in streak needs a check-in every calendar day to keep growing — miss a day and it resets back to day 1 on your next check-in. The bonus itself (${fmt(ctx.settings.dailyCheckin)}) doesn't change either way, only the streak count does.` },

  { id:'min_deposit_specific',priority:3,phrase:[/min(imum)?( amount to)? deposit/i, /smallest deposit/i, /minimum deposit/i,/least (i|you) can deposit/i,/lowest deposit/i],reply:c=>`💰 The minimum deposit is ${fmt(c.settings.minDeposit)}, with a system cap of ${fmt(999999999)} per single deposit. Within that range, deposit as much as you're comfortable investing.` },
  { id:'min_withdraw_specific',priority:3,phrase:[/min(imum)?( amount to)? withdraw/i, /smallest withdrawal/i, /minimum withdraw/i,/least (i|you) can (withdraw|cash ?out)/i,/lowest withdrawal/i],reply:c=>`💸 The minimum withdrawal is ${fmt(c.settings.minWithdraw)}, and a ${c.settings.withdrawFeePct}% fee applies on whatever amount you withdraw.` },
  { id:'max_withdraw_limit',priority:3, kw: {cap:3},phrase:[/how much can i withdraw per day/i, /maximum withdraw/i,/withdraw(al)? limit/i,/how many (times|withdrawals) .*(day|daily)/i],reply:c=>c.settings.maxWithdrawalsPerDay?`💸 You can make up to ${c.settings.maxWithdrawalsPerDay} withdrawal${c.settings.maxWithdrawalsPerDay===1?'':'s'} per day. There's no fixed maximum amount beyond your available wallet balance.`:'💸 There\'s no fixed daily withdrawal limit beyond your available wallet balance.' },
  { id:'multiple_deposits_per_day',priority:3,phrase:[/(more than one|multiple|several|two).*(deposit)/i,/deposit (more than once|twice|again)/i],reply:()=> '💰 Yes — deposit as many times as you like in a day. Each one is a separate transaction, credited independently once confirmed.' },
  { id:'deposit_confirmation',priority:6,phrase:[/was my deposit successful/i, /check if (my )?deposit worked/i, /how (do|will|to) .{0,15}(know|confirm).{0,25}(deposit|payment)/i,/did my deposit (work|go through|succeed)/i,/confirm payment succeeded/i],reply:()=> '💰 Check Account → Deposits — a successful deposit shows there with a reference number, and your wallet balance updates automatically. No separate confirmation message is needed.' },
  { id:'wrong_network_deposit',priority:4,phrase:[/picked (the )?wrong network/i, /network mismatch/i, /(wrong|different) network.*(deposit|selected|chose)/i,/selected .*(wrong|different) network/i],reply:()=> '📱 If the network doesn\'t match the phone number you entered, the mobile-money prompt usually won\'t arrive at all. Cancel and retry the deposit with the correct network selected — don\'t keep resubmitting the same one.' },
  { id:'plan_comparison',priority:5,phrase:[/which one is better/i, /recommend a plan/i, /which plan (is|should)/i,/compare (the )?plans/i,/best plan/i,/what plan (do you|would you) recommend/i],reply:c=>{const p=c.products||[];if(!p.length)return '🚀 Plans are being set up — check back soon.';const cheapest=p.reduce((a,b)=>b.price<a.price?b:a);const priciest=p.reduce((a,b)=>b.price>a.price?b:a);return `🚀 Every plan pays the same fixed return multiple — bigger plans return more in absolute UGX, not a better rate. ${cheapest.name} (${fmt(cheapest.price)}) is the smallest entry point; ${priciest.name} (${fmt(priciest.price)}) is the largest. Pick based on how much you're comfortable committing, not which "performs better" — they don't differ that way.`;} },
  { id:'cheapest_plan',priority:3, kw: {cheapest:3,smallest:2},phrase:[/least expensive/i, /minimum plan price/i, /(cheapest|smallest|lowest) plan/i,/cheapest (product|investment)/i],reply:c=>{const p=c.products||[];if(!p.length)return '🚀 Plans are being set up — check back soon.';const cheapest=p.reduce((a,b)=>b.price<a.price?b:a);return `🚀 The smallest plan is ${cheapest.name} at ${fmt(cheapest.price)}, a ${cheapest.cycle}-day cycle returning ${fmt(cheapest.expectedReturn)} total.`;} },
  { id:'priciest_plan',priority:3, kw: {priciest:3},phrase:[/(biggest|largest) investment/i, /(highest|top) (priced )?plan/i, /(biggest|largest|most expensive|highest) plan/i],reply:c=>{const p=c.products||[];if(!p.length)return '🚀 Plans are being set up — check back soon.';const top=p.reduce((a,b)=>b.price>a.price?b:a);return `🚀 The largest plan is ${top.name} at ${fmt(top.price)}, a ${top.cycle}-day cycle returning ${fmt(top.expectedReturn)} total.`;} },
  { id:'daily_income_explain',priority:2,phrase:[/daily (cashback|payout|income) (meaning|explained)/i, /how is daily (income|cashback)? ?calculat/i, /explain daily (payout|income|cashback)/i, /what('?s| is) daily (income|cashback)/i,/how (is|does) daily (income|cashback) (work|calculat)/i],reply:()=> '📈 Daily income (cashback) is your plan\'s total return divided evenly across its cycle length, credited to your wallet automatically once a day until the plan completes — no manual claim needed.' },
  { id:'total_return_explain',priority:6,phrase:[/how much will i get in total/i, /total profit/i, /what('?s| is) total return/i,/total (return|payout) (mean|meaning)/i,/what do i (get|earn) back/i],reply:c=>`📈 Total return is the full amount a plan pays back across its whole cycle — currently ×${c.settings.returnMultiple||42} of what you put in, shown upfront on every plan before you buy.` },
  { id:'cycle_explain',priority:2,phrase:[/cycle duration/i, /how long is (a|the) cycle/i, /plan period/i, /what('?s| is|does) (a |the )?cycle/i,/what does cycle mean/i],reply:c=>`🔄 The cycle is how many days a plan runs for before it fully matures — currently ${c.settings.cycleDays||210} days by default, though it's shown per plan since not all plans use the same length.` },
  { id:'compounding',priority:6,phrase:[/\bcompound(s|ed|ing)?\b/i,/reinvest.{0,20}(automat|itself)/i],reply:()=> '📈 No — daily cashback is credited straight to your wallet, not automatically reinvested into the same plan. You decide separately whether to buy another plan with it.' },
  { id:'reinvest_earnings',priority:7,phrase:[/buy another plan with (my )?earnings/i, /invest my profits again/i, /can i reinvest/i,/reinvest (my )?(earning|cashback|profit)/i,/use my (cashback|earnings|profit).{0,25}(buy|another plan)/i],reply:()=> '🚀 Yes — any cashback or earnings sitting in your wallet can be used to purchase another plan on the Products tab, same as a deposit would.' },
  { id:'plan_upgrade',priority:3,phrase:[/move to a (bigger|larger|higher) plan/i, /(upgrade|switch).{0,20}(plan|investment)/i,/can i upgrade/i,/change (my |the )?(plan|investment)\b/i],reply:()=> '🚀 Plans can\'t be upgraded or swapped mid-cycle — the terms lock in at purchase. You can always buy a second, larger plan alongside an existing one instead.' },
  { id:'after_maturity',priority:3,phrase:[/renew(s| automatically)?/i, /plan finished.{0,20}what next/i, /(after|once) .*(matures|maturity|finishes|ends)/i,/does .*(plan|investment) auto.?renew/i],reply:()=> '🚀 A plan doesn\'t auto-renew — once it matures, the final payout lands in your wallet and that\'s it for that plan. Buy a fresh one anytime if you want to keep it going.' },
  { id:'how_share_referral',priority:3,phrase:[/(copy|send|get) (my )?referral link/i, /how to invite/i, /how do i share (my )?referral/i,/share (my )?(referral|invite) link/i],reply:()=> '🔗 Open Account and tap the share icon next to Your Referral Link — it opens your phone\'s share sheet if available, or copies the link so you can paste it anywhere.' },
  { id:'referral_levels_explain',priority:6,phrase:[/levels? (meaning|explained)/i, /level one two three/i, /what (are|is) level[s]? ?(1|2|3|one|two|three)/i,/what does level (1|2|3) mean/i,/explain the levels/i],reply:c=>`🤝 Level 1 is people you directly invite (${c.settings.commL1}% commission), Level 2 is people they invite (${c.settings.commL2}%), and Level 3 is people those people invite (${c.settings.commL3}%). Commission on all three pays once, on that person's first investment.` },
  { id:'self_referral',priority:4,phrase:[/(use|refer) my own (code|account)/i, /(refer|invite) myself/i,/use (my )?own (referral|invite) code/i],reply:()=> '🤝 A referral code can\'t be used on the same account it belongs to — you\'d need a separate phone number and account for it to count, and that\'s only meant for genuinely different people.' },
  { id:'referral_code_lookup',priority:6,phrase:[/find my (referral|invite) code/i,/^my (referral|invite) code$/i,/referral code please/i,/what('?s|s| is) my (referral|invite) code/i,/where('?s|s| is) my (referral|invite) code/i],reply:c=>c.account.referralCode?`🔗 Your referral code is ${c.account.referralCode} — find it anytime under Account.`:'🔗 Your referral code is on the Account screen, just below your profile details.' },
  { id:'team_size_view',priority:6, kw: {downline:3},phrase:[/(my|see|view) team (members|list)?/i, /^team (list|members)$/i, /how (do i|to) see my team/i,/(where|find).{0,20}my team( list)?/i,/how many (people|members) (have i|did i) (referred|invited)/i],reply:()=> '👥 Open the Team tab — it shows Level 1, 2 and 3 members separately, with total referrals and total commission at the top.' },
  { id:'task_center_claim_how',priority:7,phrase:[/claim (my reward|mission)/i, /how (do i|to) claim/i,/claim (my |a )?(task|mission|milestone) reward/i],reply:()=> '🎯 Once a Task Center mission\'s target is reached, a Claim Reward button appears on that card in the Team tab — tap it to credit the reward. It won\'t claim itself automatically.' },
  { id:'task_center_types',priority:7,phrase:[/mission categories/i, /(types|kinds) of (mission|task)/i,/what missions (are there|exist)/i],reply:()=> '🎯 Two kinds: Active Level-1 Missions (based on how many direct referrals have invested) and Whole Team Deposit Missions (based on your entire team\'s combined deposits, 3 levels deep). Both pay a one-time manual-claim reward on top of normal commission.' },
  { id:'checkin_reset_time',priority:8,phrase:[/when is the next check ?in/i, /check ?in reset time/i, /what time does check ?in reset/i,/when (does|do|will).{0,20}(the |my )?(streak|check ?in).{0,15}reset/i,/when can i check ?in again/i],reply:()=> '📅 Check-in follows the calendar day, so it resets at midnight. You can check in once per calendar day, and the button shows a checkmark once you\'ve already claimed today\'s.' },
  { id:'checkin_amount_specific',priority:6,phrase:[/how much per check ?in/i, /(daily bonus|check ?in bonus) amount/i, /how much is (the )?check ?in/i,/check ?in (bonus|reward)/i,/how much.{0,20}(do i get|for).{0,20}check(ing)? ?in/i],reply:c=>`📅 The daily check-in bonus is ${fmt(c.settings.dailyCheckin)}, credited instantly when you tap Check In on Home.` },
  { id:'checkin_twice',priority:6,phrase:[/two check ?ins/i, /check ?in twice/i,/check ?in.{0,20}(multiple times|again|twice)/i,/claim check ?in.{0,20}(again|twice)/i],reply:()=> '📅 No — check-in is once per calendar day. The button greys out and shows a checkmark after you\'ve claimed, and stays that way until the next day.' },
  { id:'security_tips',priority:6,phrase:[/how (to|do i) protect my account/i, /stay secure/i, /(safety|security) (tips|advice)/i,/how (do i|to) (keep|stay) safe/i,/avoid (getting )?scammed/i],reply:()=> '🔒 Never share your PIN, password, or the mobile-money prompt PIN with anyone — including anyone claiming to be Space8 staff, since we never ask for those. Only approve mobile-money prompts you personally triggered, and double-check any link claiming to be Space8 before entering details.' },
  { id:'phishing_warning',priority:4,phrase:[/suspicious (message|link)/i, /is this link safe/i, /someone wants my (password|pin)/i, /(fake|phishing) (link|site|message)/i,/someone (asked|messaged) .*(pin|password)/i,/is this (a )?scam (message|link)/i],reply:()=> '⚠️ Space8 staff will never ask for your PIN, password, or a mobile-money approval code over chat, SMS, or a phone call. If you received a message like that, don\'t respond or click anything — it\'s not us. Report it to Support.' },
  { id:'multiple_accounts_allowed',priority:3,phrase:[/register twice/i, /second account/i, /(more than one|multiple|two|several) (space8 )?account/i,/can i (open|create|have) (another|a second) account/i],reply:()=> '👤 Each phone number can only register one account. Using multiple accounts to abuse referral or bonus systems can get accounts suspended, so stick to one per person.' },
  { id:'account_deletion',priority:6, kw: {deactivate:3},phrase:[/delete (my )?profile/i, /i want to (quit|leave)/i, /(delete|close|remove|deactivate) (my )?account/i,/how (do i|to) deactivate/i],reply:()=> '👤 Account deletion isn\'t self-service in the app right now — contact Support with your registered phone number and they\'ll guide you through it.' },
  { id:'data_privacy',priority:2,phrase:[/data protection/i, /sell my data/i, /personal information/i, /is my data (safe|private|secure)/i,/privacy/i,/what (data|information) do you (collect|store)/i],reply:()=> '🔒 Only what\'s needed to run your account — phone number, transaction history, and your hashed PIN (never readable, even by staff). See Account → Rules for the full picture.' },
  { id:'currency_support',priority:6, kw: {currency:3,shillings:3},phrase:[/\b(usd|dollars?)\b/i,/other currenc/i,/only ugx/i],reply:()=> '💵 Space8 runs entirely in Ugandan Shillings (UGX) — deposits, withdrawals, plans and every figure shown are all UGX, no other currency supported.' },
  { id:'country_support',priority:6, kw: {kenya:3,tanzania:3,rwanda:3,foreigners:3},phrase:[/(available|works?|work).{0,15}(outside|only in|in other)/i,/other countries/i,/only in uganda/i],reply:()=> '📍 Space8 is built around Uganda mobile money (MTN and Airtel), so it works best for Uganda-registered numbers. Deposits/withdrawals outside that network aren\'t supported.' },
  { id:'support_hours_check',priority:3,phrase:[/are you open/i, /working hours/i, /support (time|hours)/i, /support (hours|available|24)/i,/when (is|are) support (open|available)/i],reply:c=>c.settings.supportHours?`🎧 Support hours: ${c.settings.supportHours}.`:'🎧 Check Account → Support for current hours — reach out any time and the team will respond as soon as they can.' },
  { id:'response_time',priority:2,phrase:[/when will support (answer|reply|respond)/i, /how (fast|long|quick).*(support|reply|respond)/i,/response time/i],reply:()=> '🎧 Response time varies, but the team checks Telegram/WhatsApp regularly. For anything money-related, always include your reference number so it can be looked up quickly.' },
  { id:'app_update_how',priority:6,phrase:[/update space8/i, /latest (app )?version/i, /how (do i|to) update the app/i,/new version/i,/(get|download).{0,20}latest version/i],reply:()=> '📲 Space8 updates itself automatically in the background the next time you open it with a connection — no manual download needed. If something looks outdated, fully close and reopen the app.' },
  { id:'clear_cache_stale',priority:7,phrase:[/app not refreshing/i, /stale app/i, /(old|outdated|stale) (data|version|screen)/i,/app (looks|is)( so| very)? (old|outdated|broken|weird)/i,/not updating/i,/showing old data/i],reply:()=> '🔄 Fully close the app (swipe it away, don\'t just background it) and reopen — that forces it to pull the latest version. A stale cache is almost always the cause of an old-looking screen.' },
  { id:'offline_usage',priority:3,phrase:[/works? without (data|internet)/i, /(use|work).*(offline|without internet)/i,/no internet/i],reply:()=> '📶 Space8 needs an internet connection for anything involving your account or money — deposits, withdrawals, and balance updates all require a live connection to the server.' },
  { id:'notification_permission',priority:6,phrase:[/(allow|enable|turn on) (push|notifications|alerts)/i, /not (getting|receiving) notifications/i,/notifications (are )?(not working|off|disabled)/i],reply:()=> '🔔 Push notifications need permission granted in your phone/browser settings. If you denied it before, re-enable notifications for Space8 in your device settings, then reopen the app.' },
  { id:'dark_mode_question',priority:2, kw: {dark:3},phrase:[/(dark|black|night) (mode|theme)/i, /dark mode/i,/night mode/i],reply:()=> '🎨 Space8 is light-theme only right now — there\'s no dark mode toggle.' },
  { id:'language_support',priority:2,phrase:[/english only/i, /(other|different|another) language/i,/\b(luganda|swahili)\b/i,/\btranslate\b/i],reply:()=> '🌐 The app is currently English-only.' },
  { id:'minimum_age',priority:2, kw: {age:3},phrase:[/use it at \d\d/i, /age limit/i, /(minimum|what) age/i,/can (a )?minor/i,/how old (do|to) (you|i)/i],reply:()=> '👤 You should be a legal adult in your jurisdiction to register and manage money on Space8 — the app itself doesn\'t verify age, so this is on the honor system between you and the platform terms.' },
  { id:'tax_question',priority:2,phrase:[/tax(es)?/i,/does space8 (pay|handle|deduct) tax/i],reply:()=> '💵 Space8 doesn\'t withhold or file taxes on your behalf — any personal tax obligation on your earnings is yours to handle. Keep your transaction history (Account → Deposits/Withdrawals) for your own records.' },
  { id:'company_info',priority:6,phrase:[/company details/i, /^management/i, /who (owns|runs|is behind)/i,/who is the (ceo|founder|owner)/i],reply:()=> '🛰️ I don\'t have details on ownership or company structure to share — that\'s outside what I can answer. Reach Support if you need that kind of information.' },
  { id:'investment_risk',priority:2, kw: {risky:3,risk:3},phrase:[/lose everything/i, /is (it|investing) risky/i,/can i lose (my )?money/i,/what('?s| is) the risk/i],reply:()=> '⚠️ Any investment platform carries some risk — Space8 states fixed terms upfront (price, cycle, total return) so you always know exactly what a plan promises before buying, but no platform can guarantee zero risk. Invest what you\'re comfortable with.' },
  { id:'guaranteed_returns',priority:6,phrase:[/sure returns/i, /guarantee(d)? (returns?|profits?|money)/i,/(returns?|profits?) .{0,20}guarantee/i,/is (the |it )?return(s|ed)? guaranteed/i],reply:()=> '📈 The return figure shown on each plan is the stated payout structure the platform commits to, credited automatically day by day — it\'s fixed at purchase and doesn\'t fluctuate with market conditions, but see the Terms for the full commitment.' },
  { id:'plan_quantity_limit',priority:8,phrase:[/(limit|cap).{0,25}(buy|buying|purchas|same plan)/i,/how many times.{0,20}(buy|purchase)/i],reply:()=> '🚀 There\'s no cap on buying the same plan more than once — each purchase runs as its own independent plan with its own cycle and payout.' },
  { id:'giftcode_where',priority:6,phrase:[/(how to |where to )?find (promo|gift) codes/i, /source of gift codes/i, /where (do i|to) (get|find) (a )?gift code/i,/where to find gift code/i,/how (do i|to) get a (gift|promo) code/i],reply:()=> '🎁 Gift codes are issued by the Space8 team, usually shared through the Telegram community or a promotion. Watch Account → Join The Community and any active announcement for new codes.' },
  { id:'giftcode_value',priority:2,phrase:[/how much do codes give/i, /how much (is|are) (a )?gift code/i,/gift code (worth|value|amount)/i],reply:()=> '🎁 Gift code values vary by promotion — the exact amount is credited the moment you redeem a valid one, and you\'ll see it confirmed immediately.' },
  { id:'money_format_why',priority:1,phrase:[/why .*(full number|not.*\b(k|m)\b)/i,/why (don.?t|dont) you (show|use) (k|m) for/i],reply:()=> '🔢 Space8 always shows full UGX figures instead of shortened ones (like "23k") — it keeps money amounts unambiguous, especially for larger numbers.' },

  // ── DEPOSITS, deeper ──
  { id:'deposit_max',priority:3,phrase:[/max(imum)? i can deposit/i, /maximum deposit/i,/deposit limit/i,/most i can deposit/i],reply:()=> '💰 There is no maximum deposit — deposit as much as you intend to invest. Only the minimum is enforced.' },
  { id:'deposit_someone_else',priority:6,phrase:[/another person deposits? for me/i, /use my (brother|sister|friend|wife|husband).{0,15}(number|phone)/i, /deposit (from|using|with) (someone|another|a friend|my (wife|husband|brother|sister|friend))/i,/(someone else|another person|my (friend|wife|husband|brother|sister)).{0,20}(pay|deposit) for me/i],reply:()=> '📱 The deposit prompt goes to whichever mobile-money number you enter, so another person can approve it on their phone. The money still lands in YOUR Space8 wallet since the deposit is tied to your logged-in account, not to the paying number.' },
  { id:'deposit_reference',priority:3,phrase:[/ref(erence)? number/i, /where is the reference/i, /transaction reference/i, /deposit reference/i,/reference (number|id|code)/i,/where.{0,15}(find|get).{0,15}reference/i],reply:()=> '🧾 Every deposit and withdrawal gets a unique reference (starting with "B") shown on its row under Account → Deposits / Withdrawals and in Records. Quote that reference whenever you contact Support about a specific transaction.' },
  { id:'deposit_not_in_records',priority:6,phrase:[/deposit not listed/i, /not in my history/i, /deposit.{0,25}not (in|showing in) (records|history)/i,/(records|history).{0,20}missing.{0,15}deposit/i,/deposit.{0,20}missing (from )?(records|history)/i],reply:()=> '🧾 A deposit only appears in Records once it has actually been confirmed. If it succeeded but is missing there, pull to refresh or fully close and reopen the app first — then contact Support with the reference if it still is not listed.' },
  { id:'deposit_wrong_amount',priority:4,phrase:[/sent more than i wanted/i, /wrong deposit amount/i, /deposited (the )?wrong amount/i,/deposit(ed)?.{0,20}(too much|too little|by mistake)/i],reply:()=> '💰 A completed deposit cannot be reversed from the app — the money is in your wallet and is yours to use or withdraw. If you deposited more than intended you can simply withdraw the excess (the standard fee applies) or leave it toward a future plan.' },
  { id:'deposit_charges',priority:6,phrase:[/cost to deposit/i, /deposit (fee|charge)/i,/(charge|charged|charges).{0,20}(to |for )?deposit/i,/is there a deposit (fee|charge)/i],reply:(c)=>`💰 Space8 charges nothing to deposit — the full amount reaches your wallet. Your mobile-money provider may apply its own standard transaction charge, which is separate from Space8 and not something the platform receives.` },

  // ── WITHDRAWALS, deeper ──
  { id:'withdraw_cancel',priority:8,phrase:[/cancel (my |a |the )?(withdraw|cash ?out)/i,/(stop|undo|reverse).{0,15}(withdraw|cash ?out)/i],reply:()=> '💸 A withdrawal request cannot be cancelled from the app once submitted. If it has not yet been sent, contact Support quickly with its reference and ask them to stop it; once it is Sending or Successful the money is already on its way.' },
  { id:'withdraw_name_mismatch',priority:6,phrase:[/(name|account name).{0,25}(mismatch|different|not match|wrong)/i,/wrong (account )?name/i,/withdraw.{0,20}different name/i],reply:()=> '📱 The account holder name you save must match the name registered on that mobile-money number. A mismatch can cause the payout to be rejected by the provider. Fix it by deleting the account under Account → Withdrawal Account and adding it again with the correct name.' },
  { id:'withdraw_other_network',priority:3,phrase:[/withdraw to (mtn|airtel)/i, /different network payout/i, /withdraw.{0,25}(other|different|another) network/i,/(mtn|airtel).{0,20}(to|into) (mtn|airtel)/i],reply:()=> '📱 Withdrawals go to whichever mobile-money account you bound, on its own network. Just make sure the network selected on that saved account matches the number — an MTN number must be saved as MTN, an Airtel number as Airtel.' },
  { id:'withdraw_rejected',priority:6,phrase:[/payout declined/i, /(withdraw\w*|cash ?out).{0,20}(rejected|declined|refused|denied|failed)/i],reply:()=> '💸 A declined withdrawal returns the money to your wallet — you do not lose it. The usual causes are a name/number mismatch on the payout account or a provider-side failure. Check the reason shown on the row under Account → Withdrawals, correct the account details, and request again.' },
  { id:'withdraw_weekend',priority:2,phrase:[/weekend payout/i, /withdraw.{0,20}(weekend|sunday|saturday|holiday|night)/i],reply:()=> '⏱️ Withdrawals are processed every day, including weekends and at night. Timing depends on review and mobile-money network conditions rather than office hours.' },
  { id:'withdraw_history_where',priority:6,phrase:[/(past|see my) withdrawals/i, /where.{0,25}(see|check|find).{0,20}(withdraw\w*|cash ?out)/i,/withdrawal history/i],reply:()=> '🧾 Account → Withdrawals lists every request with its amount, date, reference and current status. Records (the doc icon on Home) shows them alongside every other transaction type.' },
  { id:'withdraw_to_bank',priority:6,phrase:[/send to my bank/i, /bank payout/i, /withdraw.{0,20}bank/i,/bank (transfer|account).{0,20}withdraw/i,/^bank transfer withdrawal/i],reply:()=> '📱 Withdrawals are mobile money only — MTN or Airtel. There is no bank-transfer payout option; bind a mobile-money account under Account → Withdrawal Account.' },

  // ── PLANS / PRODUCTS, deeper ──
  { id:'my_plans_where',priority:3, kw: {portfolio:3},phrase:[/see my active plans/i, /where.{0,25}(see|check|find).{0,20}(my )?(plan|product|investment)/i,/my (plans|products|investments)/i],reply:()=> '🚀 Tap My Products on the Products tab to see your active plans — tap any plan there for its purchase details and a live countdown to its next cashback.' },
  { id:'plan_progress',priority:6,phrase:[/plan day count/i, /progress of my investment/i, /(track|check|see).{0,20}(progress|how far|day count)/i,/how many days (are )?(left|remaining|to go)/i,/how far (is|along).{0,15}(my )?plan/i],reply:()=> '🚀 Tap My Products on the Products tab, then tap a plan — its day counter (day X of Y) and a live countdown to the next cashback are computed server-side from the exact purchase time, so it never drifts from what you are actually owed.' },
  { id:'buy_without_deposit',priority:6,phrase:[/purchase without funds/i, /invest with (zero|no) balance/i, /buy.{0,25}with(out)? (no |any )?(deposit|money|funds|balance)/i,/invest.{0,20}(no|without) (money|balance|deposit)/i],reply:()=> '🚀 A plan is bought with wallet balance, so you need funds in your wallet first — from a deposit, cashback, commission, a gift code or the welcome bonus. Any of those sources spend the same way.' },
  { id:'partial_investment',priority:3,phrase:[/(custom|small) (investment )?amount/i, /invest small/i, /(part|partial|half).{0,20}(invest|plan|amount)/i,/invest.{0,20}(any|custom) amount/i],reply:()=> '🚀 Plans are bought whole at their listed price — you cannot invest a custom or partial amount. Pick the plan whose price matches what you want to commit.' },
  { id:'beginner_plan',priority:6, kw: {beginner:3,starter:3,starters:3},phrase:[/(good|best) plan (for|to) (start|begin)/i, /(beginner|starter|first time|new user|starting out).{0,25}(plan|invest|recommend)/i,/(which|what) plan.{0,20}(start|begin)/i],reply:(c)=>{const p=c.products||[];if(!p.length)return '🚀 Check the Products tab for the current catalogue.';const ch=p.reduce((a,b)=>b.price<a.price?b:a);return `🚀 The smallest plan is the usual starting point — ${ch.name} at ${fmt(ch.price)}, returning ${fmt(ch.expectedReturn)} over ${ch.cycle} days. Every plan uses the same return multiple, so starting small costs you nothing in rate.`;} },
  { id:'plan_sold_out',priority:6,phrase:[/why is it upcoming/i, /not purchasable/i, /(sold out|upcoming|coming soon|greyed out|disabled).{0,20}(plan|product)/i,/plan.{0,20}(sold out|upcoming|not available|unavailable|is unavailable)/i],reply:()=> '🚀 A plan marked Upcoming is not open for purchase yet — the button stays disabled until the team activates it. Nothing is lost by waiting; the other plans remain fully available.' },
  { id:'same_plan_again',priority:7,phrase:[/buy it twice/i, /repeat the same plan/i, /buy.{0,20}same plan/i,/(two|multiple|several) of the same plan/i],reply:()=> '🚀 Yes — the same plan can be bought as many times as you like. Each purchase runs as a completely separate plan with its own cycle and its own daily payout.' },

  // ── REFERRALS / TEAM, deeper ──
  { id:'referral_link_vs_code',priority:3,phrase:[/code vs link|link vs code/i, /(difference|vs|or).{0,20}(referral (link|code))/i,/link or code/i],reply:()=> '🔗 They do the same job. The code is the short text someone types into the invite field when registering; the link just pre-fills that code for them automatically. Share whichever is easier — both credit the referral to you.' },
  { id:'referral_earnings_where',priority:3,phrase:[/(check )?referral income/i, /commission total/i, /where.{0,25}(see|check|find).{0,20}(commission|referral earning)/i,/how much.{0,20}(commission|referral).{0,15}(earned|made)/i],reply:()=> '🤝 The Team tab shows Total Commission at the top, and every individual commission payment appears in Records labelled as a Level 1/2/3 reward.' },
  { id:'referral_expire',priority:3,phrase:[/referral validity/i, /referral.{0,20}(expire|end|stop|time limit)/i,/how long.{0,20}referral/i],reply:()=> '🤝 A referral never expires. Once someone registers under your code they stay in your team permanently, and commission pays whenever they make their first investment — whether that is the same day or months later.' },
  { id:'team_not_counting',priority:4,phrase:[/(my )?referral did ?n.?t show/i, /team member not added/i, /(team|referral).{0,25}(not counting|not showing|missing|not appearing)/i,/referred someone.{0,25}(not|isn.?t) (there|showing)/i],reply:()=> '🤝 A referred member appears on your Team tab only if they entered your code during registration — it cannot be attached afterwards. If they definitely used your code and are still missing, contact Support with both phone numbers and their registration date.' },
  { id:'how_many_referrals',priority:6,phrase:[/how many can i invite/i, /max(imum)? referrals/i, /how many (people|members|referrals).{0,20}(can i|allowed)/i,/(limit|cap).{0,20}referral/i,/referral limit/i],reply:()=> '🤝 There is no cap on how many people you can refer, and no cap on commission earned. Task Center missions keep rewarding larger teams at higher targets.' },

  // ── TASK CENTER, deeper ──
  { id:'milestone_already_claimed',priority:7,phrase:[/claimed already/i, /mission already done/i, /already claimed.{0,20}(mission|milestone|task)/i,/(mission|milestone|task).{0,25}(already claimed|claimed again|twice)/i,/claim.{0,15}(a )?(mission|milestone).{0,15}twice/i],reply:()=> '🎯 Each mission target pays once. Once claimed it shows as complete and cannot be claimed again — the next, higher target becomes the one to work toward.' },
  { id:'milestone_not_showing',priority:7,phrase:[/missions not loading/i, /no missions visible/i, /(mission|milestone|task ?cent(er|re)).{0,25}(not showing|missing|empty|blank|is blank)/i,/my missions are missing/i],reply:()=> '🎯 Task Center sits at the bottom of the Team tab. If it looks empty, give it a moment to load, then fully close and reopen the app. If it is still blank, contact Support.' },
  { id:'milestone_progress_source',priority:3,phrase:[/how is progress measured/i, /(mission|milestone).{0,25}(progress|count|counted|calculat)/i,/how.{0,20}team deposit.{0,20}(count|calculat)/i],reply:()=> '🎯 Referral-count missions count your direct Level 1 members who have actually invested. Deposit missions count the combined deposits of your entire team across all three levels. Both update automatically as your team grows.' },

  // ── ACCOUNT / SECURITY, deeper ──
  { id:'forgot_pin',priority:7,phrase:[/pin forgotten/i, /recover (my )?pin/i, /(dont|do not|don.t) remember my pin/i, /forgot.{0,15}(my )?(withdrawal |payout |security )?pin/i,/(lost|cannot remember|can.?t remember).{0,15}pin/i,/reset.{0,15}pin/i],reply:()=> '🔒 A forgotten PIN cannot be recovered or read by anyone — it is stored only as a one-way hash. If you still know your current PIN you can change it under Account → Security PIN. If you genuinely cannot remember it, contact Support from the Account tab; only they can arrange a reset, and they will never ask you to send them a PIN.' },
  { id:'change_pin',priority:7,phrase:[/update (my )?pin/i, /change.{0,15}(my )?(withdrawal |payout |security )?pin/i,/new pin/i],reply:()=> '🔒 Account → Security PIN. You will need your current PIN to set a new one. A new PIN cannot be four identical digits (1111, 0000 and so on) — pick four digits that are not all the same.' },
  { id:'pin_weak_rule',priority:4,phrase:[/weak pin/i, /pin.{0,25}(too easy|not accepted|rejected|weak|same digit)/i,/why.{0,20}(1111|0000|repeated digit)/i],reply:()=> '🔒 A PIN made of four identical digits (0000, 1111, 2222 …) is rejected because it is among the first combinations anyone guesses. Choose four digits that are not all the same — everything else is accepted.' },
  { id:'multiple_devices',priority:7,phrase:[/two phones/i, /another device/i, /(log|sign) ?in.{0,25}(another|second|different|two) (phone|device)/i,/(multiple|two|second) devices?/i],reply:()=> '📱 You can sign in on more than one device with the same phone number and password. Your balance and history are held server-side, so every device shows the same live data. Only sign in on devices you personally control.' },
  { id:'session_expired',priority:6,phrase:[/session ended/i, /signed out automatically/i, /(session|login).{0,20}(expired|timed out)/i,/logged me out/i,/why.{0,20}logged out/i],reply:()=> '🔐 Sessions expire periodically as a security measure, and signing out on one device or changing your password ends the session. Just sign in again with your phone number and password.' },
  { id:'change_password',priority:7,phrase:[/reset (my )?password/i, /change.{0,15}(my )?password/i,/(new|different) password/i],reply:()=> '🔐 Passwords are handled by Firebase Authentication, not stored by Space8. There is no self-service reset on the sign-in screen — contact Support with your registered phone number and they can reset it for you. Your withdrawal PIN is completely separate and is changed under Account → Security PIN.' },
  { id:'change_name',priority:6,phrase:[/(edit|change) my name/i, /name change/i, /(change|update).{0,20}(my )?(name|profile name|display name)/i],reply:()=> '👤 There is no editable display name — your account is identified by your registered phone number and your server-issued account ID. The holder name saved on a withdrawal account is separate and can be corrected by deleting and re-adding that account.' },
  { id:'account_hacked',priority:7, kw: {compromised:3,hacked:3},phrase:[/hacked/i,/unauthori[sz]ed/i,/someone (else )?(is )?(using|accessed).{0,20}(my )?account/i,/someone.{0,20}(took|stole).{0,15}money/i],reply:()=> '🚨 Act immediately: change your password from the sign-in screen, then change your withdrawal PIN under Account → Security PIN, then check Account → Withdrawal Account and delete any payout account you do not recognise. Contact Support straight away with your registered number. Never share your PIN or password with anyone, including anyone claiming to be staff.' },

  // ── TRUST / POLICY ──
  { id:'pyramid_scheme',priority:3,phrase:[/network marketing/i, /(pyramid|ponzi|mlm|scheme)/i],reply:()=> '🛰️ Space8 earns from investment plans; referral commission is an additional marketing reward, not the source of returns — you can invest and earn without ever referring anyone. As with any investment platform, review the Terms under Account and only commit what you are comfortable with.' },
  { id:'how_platform_earns',priority:3,phrase:[/revenue model/i, /how do you profit/i, /how (does|do) (space8|the platform|you) (make|earn) money/i,/where.{0,20}money come from/i],reply:()=> '🛰️ The platform operates the investment plans and takes the withdrawal fee on payouts. Full details of the commercial terms are in Account → Rules, which is the authoritative source rather than anything I summarise here.' },
  { id:'platform_closes',priority:3,phrase:[/if you shut down/i, /platform closure/i, /(what|happens) if.{0,25}(platform|space8|site|app).{0,20}(close|shut|stop|down)/i],reply:()=> '🛰️ I cannot speak to future business decisions. What I can tell you is that your balance, plans and full transaction history are held server-side and visible to you at all times under Records. For anything about platform guarantees, Account → Rules and Support are the right places.' },
  { id:'regulated',priority:3, kw: {regulation:3,regulated:3},phrase:[/(regulated|licence|license|registered company|legal|bank of uganda)/i],reply:()=> '🛰️ I do not hold licensing or registration details. Account → Rules carries the platform\'s official statements, and Support can answer questions that page does not cover.' },
  { id:'testimonials',priority:2,phrase:[/proof of payment/i, /real withdrawals/i, /(other people|anyone|others).{0,25}(paid|earning|withdrawn|received)/i,/does it (really )?pay/i],reply:()=> '🛰️ The activity ticker on Home shows platform-wide movement, and the Telegram community under Account → Join The Community is where members talk to each other directly. Your own Records is the definitive record of what YOUR account has been paid.' },

  // ── TECHNICAL / APP ──
  { id:'app_slow',priority:3, kw: {slow:3,laggy:3,lagging:3,freezing:2},phrase:[/loading slowly/i, /(app|site|page).{0,20}(slow|lagging|freezing|hanging)/i],reply:()=> '📶 Try a stronger connection first, then fully close and reopen the app (swipe it away rather than just backgrounding it). That also pulls the newest build. If it stays slow on a good connection, tell Support which screen is affected.' },
  { id:'blank_screen',priority:6,phrase:[/app shows nothing/i, /(blank|white|black|empty) (screen|page)/i,/(screen|page) is (blank|white|empty)/i,/nothing (loads|shows|appears)/i],reply:()=> '📶 Fully close the app and reopen it — that forces a fresh load of the latest version, which resolves most blank-screen cases. If it persists, check your connection, then report it to Support with your phone model and browser.' },
  { id:'button_not_working',priority:3, kw: {button:3},phrase:[/(button|tap|click).{0,25}(not working|does nothing|unresponsive)/i],reply:()=> '📶 A disabled-looking button is often intentional (an Upcoming plan, or an action already completed today like check-in). If a button that should work does nothing, fully close and reopen the app to pull the latest build, then tell Support exactly which button and screen.' },
  { id:'balance_wrong',priority:7,phrase:[/(balance|wallet).{0,20}(not correct|not right)/i, /wrong (wallet|balance) amount/i, /(balance|wallet).{0,25}(wrong|incorrect|not updated|did ?n.?t update|not right|is not right)/i],reply:()=> '📊 The wallet refreshes on its own every few seconds while the app is open, so give it a moment. Remember money inside an active plan is not wallet balance — it returns gradually as daily cashback. If a figure still looks wrong, open Records: every credit and debit is itemised there, which usually explains the difference. Contact Support if it does not.' },
  { id:'how_to_refresh',priority:2,phrase:[/refresh (my )?data/i, /reload (the )?page/i, /how.{0,20}refresh/i,/(reload|update).{0,15}(the )?(app|data|balance)/i],reply:()=> '🔄 The app refreshes balances automatically while open. To force a full reload, fully close it (swipe it away) and reopen — that also pulls the newest version.' },
  { id:'report_bug',priority:3,phrase:[/bug report/i, /there is an error/i, /(report|found).{0,15}(a )?(bug|glitch|error|problem)/i,/something.{0,15}broken/i],reply:()=> '🛠️ Report it through Account → Support. Include the screen, exactly what you tapped, what happened versus what you expected, and the transaction reference if money was involved — that is what makes it fixable quickly.' },
  { id:'suggest_feature',priority:2,phrase:[/add a feature/i, /(suggest|request|idea|feature request|you should add)/i],reply:()=> '💡 Suggestions are welcome — send them through Account → Support or the Telegram community. Ideas raised by members do get considered.' },

  // ── CONVERSATIONAL / META ──
  { id:'are_you_sure',priority:2,phrase:[/^(really|for sure|you (sure|certain))[\s?.!]*$/i, /are you (sure|certain|correct|right)/i,/is that (right|correct|true)/i],reply:()=> '✅ Every figure I quote is read live from the platform settings and your own account at the moment you ask, not from a stored script — so the numbers are current. For anything about policy or a specific transaction, Account → Rules and Support are the authoritative sources.' },
  { id:'talk_to_human',priority:7,phrase:[/(human|agent) (support|please)/i, /(talk|speak|chat|connect).{0,20}(to |me to )?(a )?(human|person|agent|someone real|staff)/i,/real person/i],reply:(c)=>{const s=c.settings,p=[];if(s.supportTelegram)p.push(`Telegram: ${s.supportTelegram}`);if(s.whatsappContact)p.push(`WhatsApp: ${s.whatsappContact}`);return p.length?`🎧 Of course — reach the team directly on ${p.join(' or ')}. You can also open Account → Support.`:'🎧 Open Account → Support to reach the team directly.';} },
  { id:'sorry_apology',priority:1,phrase:[/^(am|i am|i.m) sorry/i, /^(sorry|my bad|apologies)/i],reply:()=> 'No need to apologise at all 🙂 What can I help you with?' },
  { id:'compliment',priority:1,phrase:[/(well done|nice one|good one)/i, /(you.?re|you are|thats|that.?s) (great|good|helpful|smart|nice|awesome|amazing)/i,/(good|nice|great) (job|work|bot)/i],reply:()=> 'Thank you! 😊 Glad that helped — ask me anything else about your account.' },
  { id:'complaint_frustration',priority:3, kw: {disappointed:3},phrase:[/(this is|you are|its|it.?s) (useless|rubbish|nonsense|stupid|terrible|bad)/i,/(annoyed|frustrated|angry|fed up)/i],reply:(c)=>{const s=c.settings;const contact=s.supportTelegram?` Reach the team on Telegram ${s.supportTelegram}`:' Reach the team through Account → Support';return `😔 Sorry this has been frustrating. If it is about a specific transaction, give me the detail and I will explain exactly what the status means — or for anything I cannot resolve,${contact} with your reference number and they will look at your account directly.`;} },
  { id:'joke_smalltalk',priority:1,phrase:[/say something funny/i, /how is your day/i, /tell me a joke/i,/are you (bored|tired|happy)/i,/what.?s up/i],reply:()=> '😄 I keep it to Space8 questions — deposits, withdrawals, plans, referrals, check-ins, your balance. What can I help with?' },
  { id:'repeat_answer',priority:2,phrase:[/^(again|huh|sorry what|come again)[\s?.!]*$/i, /^(what|say that again|repeat|come again|pardon)[\s?.!]*$/i],reply:()=> 'Happy to go again — which part would you like me to repeat? You can also just ask the question a different way.' },
  { id:'nothing_else',priority:1,phrase:[/^(none|no thanks|that is all|thats all)[\s?.!]*$/i, /^(no|nope|nothing|that.?s (all|it)|im good|i.?m good)[\s?.!]*$/i],reply:()=> 'Alright 👍 I am here whenever you need anything about your Space8 account.' },
  { id:'yes_ack',priority:1,phrase:[/^(yes|yeah|yep|sure|ok(ay)?|alright|fine)[\s?.!]*$/i],reply:()=> 'Great 🙂 What would you like to know?' }
];

const FALLBACKS = [
  "🤔 I can help with deposits, withdrawals, investing, referrals, check-ins, your balance, or the security PIN — try asking about one of those!",
  "🛰️ Not sure I caught that — I'm best with deposits, withdrawals, investing, referrals, check-ins, and your account. Try rephrasing?",
  "Hmm, I can help with things like deposits, withdrawals, investing or referrals 🙂 — or reach Support from the Account tab for anything else."
];

// An explicit phrase pattern is a MUCH stronger signal of intent than loose
// keywords, and the scoring has to say so. Originally keywords accumulated
// without limit while a phrase match was worth a flat 4 -- so a broad intent
// stacking 3-4 common keywords ("plan", "invest", "return") beat a specific
// intent that matched the member's actual sentence. That is how "how many
// plans can i have" answered as generic `invest`, and "i forgot my pin"
// answered as `security_secret` instead of `forgot_pin`.
//
// Keyword contribution is therefore capped (KW_CAP) below the value of a
// single phrase match (PHRASE_HIT), which makes the rule unambiguous: a
// matched phrase always outranks any amount of keyword overlap, while
// keywords still order intents among themselves and still break ties between
// two intents that both matched a phrase.
const PHRASE_HIT = 6;
const KW_CAP = 5;
function scoreText(text, tokens, intent) {
  let kwScore = 0;
  if(intent.kw)for(const[w,weight]of Object.entries(intent.kw)){const target=stem(w);if(tokens.includes(target))kwScore+=weight;else if(tokens.some(t=>editDistanceOne(t,target)))kwScore+=Math.max(1,weight-1);}
  let score = Math.min(kwScore, KW_CAP);
  // Boolean, not additive: an intent's phrase list is a set of ALTERNATIVE
  // ways to say the same thing, so matching two of them is not twice the
  // evidence. Summing them let an intent with overlapping patterns inflate
  // its own score -- `payout_account` scored 12 on "add a second payout
  // account" by matching both its broad and its narrow regex, beating the
  // dedicated multi_withdrawal_accounts intent that matched once at 6.
  // Specificity has to be a real term in the score, not just a tiebreak.
  // A broad intent matching a phrase AND several keywords (e.g. `withdraw` on
  // "reverse my cashout": phrase + kw = 9) otherwise beat the narrow intent
  // that matched only its own precise phrase (`withdraw_cancel` = 6), so the
  // specific answer was unreachable for its own wording.
  //
  // The bonus applies ONLY when the intent's own phrase pattern fired, never
  // on keyword-only overlap. Adding it to keyword matches instead made the
  // high-priority problem-report intents hijack ordinary questions -- plain
  // "how to deposit money" started answering as `deposit_pending` purely
  // because that intent lists "deposit" as a keyword and outranks `deposit`.
  // A phrase match means the member's actual sentence matched; a stray
  // keyword means almost nothing, and must not buy specificity credit.
  if (intent.phrase && intent.phrase.some(re => re.test(text))) {
    score += PHRASE_HIT + (intent.priority || 1);
  }
  return score;
}
function classify(text) {
  const tokens = tokenize(text).map(stem);
  return INTENTS.map(intent => ({ intent, score: scoreText(text, tokens, intent) }))
    .sort((a,b)=>b.score-a.score||b.intent.priority-a.intent.priority);
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
function dailyOf(p) { return Math.round((p.expectedReturn || 0) / (p.cycle || 1)); }

// ── CONVERSATIONAL LAYER ─────────────────────────────────────────────────
// Three capabilities layered on top of flat intent matching, so the same
// intent set answers far more real questions than it has rules:
//
//   1. FOLLOW-UPS. A bare "why?", "explain more", "how so?" carries no
//      keywords of its own, so it can never match an intent directly. These
//      resolve against whatever topic the conversation is already on and
//      serve that intent's `deep` reply (a longer explanation) when it has
//      one. Anchored ^...$ on purpose: "why is there a fee" is a real
//      question that must still reach why_fee, not be treated as a bare
//      follow-up.
//   2. PRODUCT × ASPECT. Any of the live catalogue's products crossed with
//      any of the aspects below is a specific, numerically-real answer
//      ("how much is Hubble", "what does Terra pay daily") without needing
//      one rule per product per aspect.
//   3. AMOUNT MATH. A figure in the message drives real arithmetic against
//      live settings/products rather than a canned range.
const FOLLOWUP_RE = /^(ok(ay)?[,. ]*)?(so[,. ]*)?(but[,. ]*)?(explain( it| this| that| more| again| further)?|tell me more|more( details?| info(rmation)?)?|elaborate|go on|continue|why( is that| though| so)?|how( so| come| does that work)?|i don'?t (get|understand)( it| that)?|what do you mean|meaning|clarify|details?|expand)[\s?.!]*$/i;

// Longer, genuinely different explanations served when a member asks a bare
// follow-up ("why?", "explain more") on a topic. Keyed by intent id, kept
// OUT of the intent objects themselves so the intent list stays scannable.
// An intent with no entry here just repeats its normal reply, which is the
// correct degradation -- never a dead end.
const DEEP = {
  deposit: (c) => `💰 In detail: tapping Deposit sends a collection request to your mobile-money provider through our payment partner. Your phone gets a prompt; approving it with your mobile-money PIN authorises the transfer. The money moves provider → platform, and a confirmation callback credits your Space8 wallet automatically — usually within a minute or two. Nothing is deducted if you decline the prompt or let it expire. Minimum is ${fmt(c.settings.minDeposit)}, there's no deposit fee, and every attempt is recorded under Account → Deposits with a reference number you can quote to Support.`,
  withdraw: (c) => `💸 In detail: a withdrawal moves money the opposite way — Space8 wallet → your bound mobile-money account. You pick which withdrawal account receives it, enter an amount (minimum ${fmt(c.settings.minWithdraw)}), and confirm with your withdrawal PIN. The ${c.settings.withdrawFeePct}% fee is deducted from the amount you request, so requesting 100,000 at ${c.settings.withdrawFeePct}% sends you ${fmt(100000 - Math.round(100000 * c.settings.withdrawFeePct / 100))}. The request is reviewed before the payout is released — that review is what protects you if someone ever gets into your account, which is also why the PIN is required separately from your password.`,
  invest: (c) => `🚀 In detail: buying a plan moves money from your wallet into that plan, and locks its terms permanently at that moment — price, cycle length and total return never change afterwards, even if the plan's terms change for future buyers. From then on the plan credits cashback to your wallet automatically once a day, every day, until its cycle completes. You can hold as many plans at once as your balance allows; each runs its own independent clock from its own purchase moment. Plans can't be cancelled, sold, or upgraded mid-cycle, so treat the confirmation screen as the decision point.`,
  referral: (c) => `🤝 In detail: your referral code creates a three-level tree. Someone who registers with your code is Level 1 (${c.settings.commL1}%). Anyone THEY refer is your Level 2 (${c.settings.commL2}%), and one more layer down is Level 3 (${c.settings.commL3}%). Commission is calculated on what each person invests and is paid once — on that person's first-ever investment, not on later purchases. It's credited automatically the moment their purchase completes; you don't claim it. Task Center missions sit on top of this as a separate, additional reward.`,
  fees: (c) => `💵 In detail: deposits are free because money coming in costs the platform nothing to receive. Withdrawals carry ${c.settings.withdrawFeePct}%, taken from the requested amount, because sending money out over mobile-money rails has a real per-transaction cost the platform absorbs. There are no hidden charges anywhere else — no account fee, no plan purchase fee, no fee on cashback or commission being credited. Minimum deposit ${fmt(c.settings.minDeposit)}, minimum withdrawal ${fmt(c.settings.minWithdraw)}.`,
  checkin: (c) => `📅 In detail: check-in is a once-per-calendar-day tap that credits ${fmt(c.settings.dailyCheckin)} instantly. It tracks a streak — consecutive days checked in — and missing a single day resets that streak to zero, though the bonus amount itself never changes. The day boundary follows the platform's Uganda calendar day, not a rolling 24 hours, so checking in at 11pm and again at 1am counts as two separate days. The button greys out with a checkmark once you've claimed today's.`,
  pin: () => `🔒 In detail: your withdrawal PIN is a second, separate secret from your login password, and it exists specifically so that a stolen password alone can't move money. It's required to add or delete a withdrawal account and to confirm every withdrawal. It's stored only as a one-way hash — nobody, including platform staff and this assistant, can read it back. Nobody legitimate will ever ask you for it: not support, not an admin, not anyone on Telegram or WhatsApp. Change it anytime under Account → Security PIN using your current PIN.`,
  maturity: (c) => `🚀 In detail: a plan's total return is divided evenly across its cycle and credited a day at a time, so by the final day the amount actually paid out equals the promised total. Maturity isn't a separate payday you wait for — it's simply the point at which the last daily credit lands and the plan stops. Nothing needs claiming, and the plan doesn't renew itself; if you want to keep earning you buy a fresh one. Track each plan's day count under Products → My Products.`,
  balance: (c) => `📊 In detail: your wallet balance is spendable money — you can invest it or withdraw it right now. It is NOT the same as your total holdings: money already inside an active plan isn't in your wallet, it's working, and it returns to your wallet gradually as daily cashback. So a falling wallet balance right after a purchase is expected, not an error. Cumulative earnings tracks what your plans and Task Center rewards have paid you overall; total invested tracks what you've put in.`,
  cumulative_earnings: (c) => `📊 In detail: Cumulative Earnings sums money your plans have actually paid out (daily cashback plus final settlement), referral commission, Task Center mission rewards, gift-code credits and daily check-in bonuses — every way you've genuinely earned on the platform. The one exception is the one-time welcome bonus at registration, which is a signup gift rather than earnings, so it's left out to keep this number honest. Team → Total Commission shows the referral slice on its own; your wallet balance is everything combined, welcome bonus included.`,
  giftcode: () => `🎁 In detail: a gift code is a promotional credit issued by the Space8 team, usually through the Telegram community or a campaign. You redeem it under Account by typing it into the Gift Code box. Codes are case-sensitive — capitals and lowercase must match exactly as issued — and each one can normally be used once per account. A valid code credits your wallet immediately and shows up in your records as a gift-code entry.`,
  milestone: () => `🎯 In detail: Task Center has two mission ladders. The first tracks how many of your direct Level 1 referrals have actually invested — reaching a target unlocks a fixed reward. The second tracks the combined deposits of your WHOLE team, all three levels deep, against escalating totals. Both are one-time rewards per target, they must be claimed manually with the Claim button on the Team tab, and they're paid on top of normal referral commission rather than instead of it.`,
  security_general: () => `🔒 In detail: there are two independent layers. Your login is handled by Firebase Authentication, an external identity service — Space8 itself never stores or sees your password. On top of that, every money-moving action needs your withdrawal PIN, which is stored only as a one-way hash. That separation is deliberate: password compromise alone doesn't let anyone cash out. What neither layer can protect against is you sharing the PIN, which is why nobody legitimate will ever ask for it.`,
  howworks: (c) => `🛰️ In detail, end to end: (1) You deposit mobile money into your Space8 wallet — free, minimum ${fmt(c.settings.minDeposit)}. (2) You buy a plan from the Products tab; its price, cycle and total return lock in permanently at purchase. (3) That plan credits cashback to your wallet automatically every day until its cycle finishes. (4) You withdraw wallet money back to mobile money whenever you like, minimum ${fmt(c.settings.minWithdraw)} with a ${c.settings.withdrawFeePct}% fee. Alongside that, referring people pays you ${c.settings.commL1}%/${c.settings.commL2}%/${c.settings.commL3}% across three levels on their first investment, Task Center pays milestone bonuses, and a daily check-in adds ${fmt(c.settings.dailyCheckin)}.`,
  deposit_pending: () => `⏳ In detail: a deposit sits pending while the platform waits for confirmation from the mobile-money provider. Most resolve in under two minutes. The usual causes of a longer wait are: the prompt was never approved on the phone, the prompt expired, the phone had no network at the moment of approval, or the provider is slow. Do NOT submit the same deposit repeatedly — that risks paying twice for one intended top-up. If money genuinely left your mobile-money account and the wallet hasn't moved after several minutes, take the reference from Account → Deposits and give it to Support. Never share your PIN with anyone helping you.`,
  withdraw_pending: () => `⏳ In detail: withdrawals move through a short pipeline. Pending means it's queued for review. Sending or Processing means a payout attempt is already underway with the provider — at that stage it must not be resubmitted, since a duplicate request would be a second, separate withdrawal. Successful means the provider accepted and sent it. If a request sits unchanged far longer than usual, quote its reference from Account → Withdrawals to Support rather than creating another one.`,
  commission_missing: (c) => `🤝 In detail: commission pays on a referred member's FIRST investment only, and only once. Registering with your code isn't enough, and neither is them depositing — money has to actually go into a plan. Later purchases by that same person don't pay commission again (they do still count toward Task Center missions). So a Level 1 member showing on your team with no commission received almost always means they've deposited but not yet bought a plan. Levels currently pay ${c.settings.commL1}% / ${c.settings.commL2}% / ${c.settings.commL3}%.`,
  welcome_bonus: (c) => `🎉 In detail: the registration bonus (${fmt(c.settings.welcomeBonus || 0)}) is credited once, automatically, when your account finishes registering. It lands in your wallet like any other credit and appears in your records. It's intended as a starting balance toward your first plan — note that platform rules may require you to have purchased a plan before withdrawing, so it isn't necessarily immediately cashable on its own.`,
  payout_account: () => `📱 In detail: a withdrawal account is a mobile-money destination you bind in advance, under Account → Withdrawal Account. You can bind several and choose which one receives each withdrawal by tapping the account row on the Withdraw screen. Binding requires the account holder's name, the correct network, and a valid Uganda mobile-money number; deleting one requires your withdrawal PIN. Withdrawals only ever go to an account bound here — never to a number typed fresh at withdrawal time — which is a deliberate safeguard against someone redirecting your money.`,
  install_app: () => `📲 In detail: Space8 is a progressive web app, so it installs straight from the browser with no app store involved. Account → Get App triggers your browser's install prompt where supported (most Android browsers). On iPhone, or any browser that doesn't offer the prompt, use the browser menu and pick "Add to Home Screen". Once installed it opens in its own window like a normal app, works from your home screen, and updates itself automatically in the background.`,
  banned: () => `🔒 In detail: account suspension is always a manual action by the platform team, tied to a specific concern on that account — it isn't automatic and this assistant has no visibility into individual cases. While suspended, money actions are blocked. The only route is Support: contact them with your registered phone number and ask what triggered it and what's needed to resolve it.`,
  about: () => `🛰️ In detail: Space8 is a mobile-money investment platform. You fund a wallet, buy a satellite-themed plan with fixed pre-stated terms, and that plan pays a defined return through automatic daily cashback across its cycle. What you're owed is fixed and shown to you before you commit, and never changes afterwards. Every movement — deposit, purchase, cashback, commission, withdrawal — is written to your own records, so nothing about your balance is unexplained. Referrals and Task Center missions layer additional earnings on top of plan returns.`,
  min_deposit_specific: (c) => `💰 In detail: the ${fmt(c.settings.minDeposit)} minimum exists because each mobile-money collection carries a fixed processing cost — below that threshold the transaction isn't viable. A single deposit is also capped at ${fmt(999999999)} as a system safety limit. You can deposit as many separate times as you like within that cap, and multiple deposits simply accumulate in your wallet until you choose to buy a plan.`,
  min_withdraw_specific: (c) => `💸 In detail: the ${fmt(c.settings.minWithdraw)} minimum exists for the same reason as the deposit floor — each payout carries a fixed cost to send. The ${c.settings.withdrawFeePct}% fee applies on top of that minimum, so the smallest withdrawal nets you ${fmt(c.settings.minWithdraw - Math.round(c.settings.minWithdraw * c.settings.withdrawFeePct / 100))}. There's no maximum beyond your available wallet balance.`,
  referral_levels_explain: (c) => `🤝 In detail: picture a tree with you at the top. People who register using YOUR code sit directly under you — Level 1, paying ${c.settings.commL1}%, the largest share because you brought them in personally. When a Level 1 member refers someone, that new person is Level 2 relative to you, paying ${c.settings.commL2}%. One more layer down is Level 3 at ${c.settings.commL3}%. You earn from all three, on each person's first investment, without doing anything beyond the original referral.`
};

function lastTopicIntent(history) {
  if (!Array.isArray(history)) return null;
  const priorUsers = history.filter(h => h && h.role === 'user' && typeof h.text === 'string');
  for (let i = priorUsers.length - 1; i >= 0; i--) {
    const s = classify(priorUsers[i].text);
    if (s[0] && s[0].score >= 2) return s[0].intent;
  }
  return null;
}

const PRODUCT_ASPECTS = [
  // Price deliberately carries the return figures too. Answering "how much is
  // Hubble" with the bare price is technically correct but useless on its own
  // -- it just forces an immediate "and what does it pay?" follow-up, and the
  // whole point of a plan's price is what it returns.
  { id: 'price',  re: /\b(price|cost|costs|how much|expensive|cheap|afford|buy in|entry)\b/i,
    ans: (p) => `🛰️ ${p.name} costs ${fmt(p.price)} to buy in, and returns ${fmt(p.expectedReturn)} over its ${p.cycle}-day cycle — ${fmt(dailyOf(p))}/day.` },
  { id: 'daily',  re: /\b(daily|per day|a day|each day|every day|day)\b/i,
    ans: (p) => `📈 ${p.name} pays ${fmt(dailyOf(p))} per day, credited automatically, across its ${p.cycle}-day cycle.` },
  { id: 'total',  re: /\b(total|return|returns|payout|profit|earn|make|get back|altogether)\b/i,
    ans: (p) => `📈 ${p.name} returns ${fmt(p.expectedReturn)} in total across its ${p.cycle}-day cycle — that's ${fmt(dailyOf(p))} a day on a ${fmt(p.price)} entry.` },
  { id: 'cycle',  re: /\b(cycle|duration|how long|days|length|last|period|mature|maturity)\b/i,
    ans: (p) => `🔄 ${p.name} runs for ${p.cycle} days, then completes. Cashback lands daily throughout.` },
  { id: 'worth',  re: /\b(worth it|good|best|recommend|should i|worthwhile)\b/i,
    ans: (p) => `🚀 ${p.name}: ${fmt(p.price)} in, ${fmt(p.expectedReturn)} back over ${p.cycle} days (${fmt(dailyOf(p))}/day). Every plan uses the same return multiple, so bigger plans return more in absolute UGX, not at a better rate — pick by what you're comfortable committing.` }
];

// Most recent product named anywhere in the conversation, newest turn first --
// what "it"/"that" refers back to in a follow-up.
function lastMentionedProduct(history, products) {
  if (!Array.isArray(history) || !products || !products.length) return null;
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    if (!h || typeof h.text !== 'string') continue;
    const p = matchProduct(products, tokenize(h.text).map(stem));
    if (p) return p;
  }
  return null;
}

function productAnswer(product, text) {
  for (const a of PRODUCT_ASPECTS) if (a.re.test(text)) return a.ans(product);
  return `🛰️ ${product.name}: price ${fmt(product.price)}, ${product.cycle}-day cycle, ${fmt(dailyOf(product))}/day, total return ${fmt(product.expectedReturn)} across the cycle. Tap Purchase on the Products tab to buy in.`;
}

// "if I invest 500,000 what do I get" / "what does 2,000,000 return"
const INVEST_MATH_RE = /\b(invest|put in|buy|purchase|spend|deposit)\b/i;
const RETURN_MATH_RE = /\b(get|return|make|earn|profit|back|worth)\b/i;
function investMathAnswer(amount, products) {
  if (!amount || !Array.isArray(products) || !products.length) return null;
  const exact = products.find(p => p.price === amount);
  if (exact) {
    return `📈 ${fmt(amount)} is exactly the ${exact.name} plan: it returns ${fmt(exact.expectedReturn)} over ${exact.cycle} days, about ${fmt(dailyOf(exact))} a day.`;
  }
  const affordable = products.filter(p => p.price <= amount).sort((a, b) => b.price - a.price);
  if (!affordable.length) {
    const cheapest = products.reduce((a, b) => (b.price < a.price ? b : a));
    return `💡 ${fmt(amount)} is below the smallest plan — ${cheapest.name} starts at ${fmt(cheapest.price)}, returning ${fmt(cheapest.expectedReturn)} over ${cheapest.cycle} days.`;
  }
  const best = affordable[0];
  const left = amount - best.price;
  return `💡 With ${fmt(amount)} the largest single plan you can buy is ${best.name} at ${fmt(best.price)} — it returns ${fmt(best.expectedReturn)} over ${best.cycle} days (${fmt(dailyOf(best))}/day)` +
    (left > 0 ? `, leaving ${fmt(left)} in your wallet toward another plan.` : '.');
}

// Fallback that names the closest things it DID partially match, instead of
// repeating the same generic capability list every time.
function prettyTopic(id) { return String(id || '').replace(/_/g, ' '); }
function smartFallback(scored) {
  const near = (scored || []).filter(s => s.score > 0).slice(0, 3).map(s => prettyTopic(s.intent.id));
  if (near.length) {
    return `🤔 I'm not certain what you meant. Did you want to know about ${near.slice(0, 2).join(' or ')}? ` +
      `You can also ask me about deposits, withdrawals, plans, referrals, check-ins or your balance.`;
  }
  return pick(FALLBACKS);
}

function answerAssistant({ message, history, settings, products, account }) {
  const text = String(message || '').slice(0, 500).trim();
  if (!text) return "Type a message and I'll help. 🙂";

  const sett = settings || {};
  const prods = Array.isArray(products) ? products : [];
  const acct = account || {};

  const tokensEarly = tokenize(text).map(stem);
  const ctx = {
    message: text, history, settings: sett, products: prods, account: acct,
    entities: { amount: extractAmount(text) }
  };

  // A bare follow-up ("why?", "explain more") has no keywords of its own --
  // resolve it against whatever topic we're already on and go DEEPER if that
  // intent has a longer explanation, rather than repeating the same reply.
  if (FOLLOWUP_RE.test(text)) {
    const prev = lastTopicIntent(history);
    if (prev) return DEEP[prev.id] ? DEEP[prev.id](ctx) : prev.reply(ctx);
  }

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

  const tokens = tokensEarly;

  // A named product beats a generic topic match: "how much is Hubble" should
  // answer about Hubble, not recite the generic pricing intent.
  const product = matchProduct(prods, tokens);
  if (product && (!top || top.score < 4)) return productAnswer(product, text);

  // Pronoun carry-over: "what does IT pay daily" right after asking about
  // Hubble names no product, so it would otherwise fall through to whatever
  // generic intent the loose keywords hit -- "does it pay" was matching the
  // `testimonials` intent and answering about the activity ticker.
  //
  // This deliberately runs AFTER, and outranks, the normal intent match: a
  // product already in context plus an explicit aspect word is a stronger
  // signal than a loose keyword hit on an unrelated intent. It stays narrow
  // by requiring all three of -- no product named outright, a pronoun
  // present, and a real aspect asked -- so a stray "it" elsewhere cannot
  // hijack an unrelated question.
  if (!product && /\b(it|that|this one|the plan)\b/i.test(text) && PRODUCT_ASPECTS.some(a => a.re.test(text))) {
    const prior = lastMentionedProduct(history, prods);
    if (prior) return productAnswer(prior, text);
  }

  // Real arithmetic on a figure the member actually typed.
  if (ctx.entities.amount && INVEST_MATH_RE.test(text) && RETURN_MATH_RE.test(text) && (!top || top.score < 4)) {
    const m = investMathAnswer(ctx.entities.amount, prods);
    if (m) return m;
  }

  if (top && top.score >= 2) {
    const primary = top.intent.reply(ctx);
    const second = scored.find(s => s.intent.id !== top.intent.id && s.score >= 3);
    if (/\b(and|also|plus|both)\b/i.test(text) && second) return primary + '\n\n' + second.intent.reply(ctx);
    return primary;
  }

  return smartFallback(scored);
}

// Exported for the corpus test (test-assistant-corpus.js), which asserts every
// training utterance still routes to the intent that owns it -- the guard that
// makes growing this intent set safe instead of a collision minefield.
function classifyTop(text) {
  const s = classify(text);
  return s[0] && s[0].score >= 2 ? s[0].intent.id : null;
}
module.exports = { answerAssistant, classifyTop, INTENTS, PRODUCT_ASPECTS, DEEP };
