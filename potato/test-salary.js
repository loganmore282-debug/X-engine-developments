'use strict';
// Team rewards (the Reward tab of Myteam): each tier is claimed ONCE, for good. The server's tier validation, the claim route's money guards,
// and the member page. Drives source (and --built) in JSDOM; server helpers via vm.
const fs = require('node:fs'), zlib = require('node:zlib'), vm = require('node:vm'), assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const built = process.argv.includes('--built');
const html = fs.readFileSync(__dirname + (built ? '/user/index.html' : '/user-src/index.html'), 'utf8');
const source = fs.readFileSync(__dirname + '/user-src/original_module.js', 'utf8');
const server = fs.readFileSync(__dirname + '/server.js', 'utf8');
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); };

// ── server helpers ──
{
  const i = server.indexOf('const TASK_MAX_ROWS'), j = server.indexOf('// The WHOLE team (L1+L2+L3)');
  const k = server.indexOf('function salaryTierFor'), l = server.indexOf('async function salaryView');
  const ctx = { crypto: require('node:crypto'), MAX_MONEY_AMOUNT: 999999999, tzOffMs: () => 3 * 3600000 }; vm.createContext(ctx);
  vm.runInContext(server.slice(i, j) + '\n' + server.slice(k, l) + '\nthis.S=sanitizeTaskRows;this.T=taskRows;this.tierFor=salaryTierFor;this.claimedSet=salaryClaimedSet;', ctx);
  const good = ctx.S([{ id: 's1', target: 500000, reward: 2000 }, { target: 100, reward: 5 }], 'salary');
  ok(good.rows.map(r => r.target).join() === '100,500000' && good.rows[1].id === 's1', 'tiers are sorted and keep their id');
  ok(ctx.S([{ target: 5, reward: 1 }, { target: 5, reward: 2 }], 'salary').error, 'two tiers cannot share a target');
  ok(ctx.S([{ target: 5, reward: 0 }], 'salary').error, 'a reward must be positive');
  ok(ctx.S([{ target: 50000000, reward: 14000 }], 'salary').rows, 'a large team total is allowed');
  const tiers = ctx.T([{ id: 'a', target: 500000, reward: 2000 }, { id: 'b', target: 1000000, reward: 4000 }], 'salary');
  ok(ctx.tierFor(tiers, 499999) === null && ctx.tierFor(tiers, 500000).id === 'a' && ctx.tierFor(tiers, 2500000).id === 'b', 'the highest tier reached is the member\'s tier');
  // a member's claimed tiers: the ones they claimed, plus (from the earlier daily wage) the tiers up to the one they were paid at
  ok([...ctx.claimedSet({}, tiers)].length === 0, 'a new member has claimed nothing');
  ok([...ctx.claimedSet({ claimedSalaryTiers: ['b'] }, tiers)].join() === 'b', 'a claimed tier stays claimed');
  ok([...ctx.claimedSet({ salaryTierReward: 2000 }, tiers)].length === 0, 'salaryTierReward (set by merely opening the old tab) is NOT proof of payment: nothing is Claimed from it');
  ok([...ctx.claimedSet({ salaryTierReward: 4000, claimedSalaryTiers: ['b'] }, tiers)].join() === 'b', 'only the written-down claimed tiers count');
  ok(/app\.get\('\/salary\/status'/.test(server) && /app\.post\('\/salary\/claim'/.test(server), 'the salary routes exist');
  const claim = server.slice(server.indexOf("app.post('/salary/claim'"), server.indexOf("app.post('/salary/claim'") + 5200);
  ok(/withLock\('salary:' \+ userId/.test(claim) && /claimedSalaryTiers: \{ \$ne: tier\.id \}/.test(claim) && /FieldValue\.arrayUnion\(tier\.id\)/.test(claim) && /FieldValue\.increment\(tier\.reward\)/.test(claim), 'the claim is locked per member and one atomic update carries the credit and the tier\'s claimed mark');
  ok(/createIfAbsent/.test(claim) && /salary:\$\{userId\}:tier:\$\{tier\.id\}/.test(claim), 'the ledger row is keyed by the tier');
  ok(!/salaryAccrue|creditedSalaryDays|salaryDayNumber|Come back tomorrow/.test(server.slice(server.indexOf('TEAM REWARDS (the Reward tab'), server.indexOf('ONE-TIME, at start-up'))), 'no daily wage left in the reward code');
  ok(/app\.post\('\/admin\/salary\/save', async \(req, res\) => \{\s*if \(!verifyOwner/.test(server), 'only the owner can save the tiers');
  ok(!/team\/task\/claim|taskReferrals|taskDeposits|creditedTaskKeys/.test(server), 'the Task Center is gone from the server');
}

// ── the member app ──
const dom = new JSDOM(html, { url: 'https://mypotato.potato.example.com/', runScripts: 'outside-only', pretendToBeVisual: true });
const w = dom.window, d = w.document;
w.scrollTo = () => {}; w.HTMLElement.prototype.scrollIntoView = () => {}; w.matchMedia = () => ({ matches: true, addListener() {}, removeListener() {} });
w.fetch = async () => ({ json: async () => ({ status: 'success', settings: {}, products: [], messages: [], accounts: [] }) }); w.open = () => null;
for (const s of d.scripts) {
  if (s.type === 'module' || s.src) continue;
  if (s.hasAttribute('data-nx-core')) w.eval(built ? zlib.inflateSync(Buffer.from(s.textContent.match(/atob\("([A-Za-z0-9+/=]+)"\)/)[1], 'base64')).toString() : source);
  else if (s.textContent.trim()) w.eval(s.textContent);
}
(async () => {
  await new Promise(r => setTimeout(r, 30));
  const tiers = [[500000, 2000], [1000000, 4000], [3000000, 6000]].map(([t, r], i) => ({ id: 's' + i, target: t, reward: r, reached: 700000 >= t }));
  let status = { status: 'success', total: 700000, accruedDays: 1, nextReward: 2000, tierId: 's0', tiers };
  const calls = [];
  w.api = async (p) => { calls.push(p); if (p === '/salary/status') return JSON.parse(JSON.stringify(status)); if (p === '/account') return { status: 'success', account: { walletBalance: 1 } }; if (p === '/team/stats') return { status: 'success', referralCode: 'ABCDE', commRates: { l1: 20, l2: 5, l3: 1 }, team: { l1: 0, l2: 0, l3: 0 }, totalTeam: 0, teamCommission: 0, teamDeposits: 0, levelCommission: {}, levelPurchase: {} }; return { status: 'success', transactions: [], messages: [] }; };
  w.post = async (p, b) => { calls.push(p + ' ' + JSON.stringify(b)); status = Object.assign({}, status, { accruedDays: 0, tiers: status.tiers.map((t, i) => i === 0 ? Object.assign({}, t, { claimed: true }) : t) }); return { status: 'success', amount: 2000, walletBalance: 9000, accruedDays: 0 }; };
  w.eval('STATE.account={walletBalance:5000}; STATE.page="network"; STATE.teamTab="reward"');
  await w.renderNetwork(); await new Promise(r => setTimeout(r, 20));
  ok(d.querySelectorAll('.bottom-nav .navitem').length === 5, 'five tabs');
  ok([...d.querySelectorAll('.bottom-nav .lbl')].map(e => e.textContent).join() === 'Home,Income,Myteam,Share,My', 'tab names: Home, Income, Myteam, Share, My');
  ok(calls.includes('/salary/status'), 'the Myteam page reads the salary status');
  const cards = [...d.querySelectorAll('.pt-tier')];
  ok(cards.length === 3 && /Tier 1/.test(cards[0].textContent) && /\+Br 2,000/.test(cards[0].textContent) && /Br 500,000/.test(cards[0].textContent), 'one card per tier with its reward and threshold');
  ok(/Br 500,000 \/ Br 500,000/.test(cards[0].querySelector('.pt-tn').textContent) && /Br 700,000 \/ Br 1,000,000/.test(cards[1].querySelector('.pt-tn').textContent), 'the progress line shows the team total against the threshold');
  ok(cards[0].querySelector('.pt-rbtn.go') && !cards[1].querySelector('.pt-rbtn.go') && cards[1].querySelector('.pt-rbtn').textContent === 'Share to Unlock', 'a reached tier shows Claim, an unreached one Share to Unlock');
  w.claimSalary(d.querySelector('.pt-rbtn.go'), 's0'); await new Promise(r => setTimeout(r, 40));
  ok(calls.includes('/salary/claim {"tierId":"s0"}'), 'Claim names its tier');
  ok(/Br 2,000 added to your wallet/.test(d.getElementById('notifyMsg').textContent), 'the member is told what was paid');
  ok(w.eval('STATE.account.walletBalance') === 9000 && w.eval('STATE.salary.tiers[0].claimed') === true, 'the wallet figure and the tier\'s claimed mark are updated');
  const after = [...d.querySelectorAll('.pt-tier')];
  ok(after[0].querySelector('.pt-rbtn.done') && after[0].querySelector('.pt-rbtn').textContent === 'Claimed' && !after[0].querySelector('.pt-rbtn.go'), 'a claimed tier reads Claimed and offers no Claim');
  ok(!/tomorrow/i.test(after[0].textContent) && !/tomorrow/.test(w.eval('String(ptRewardHtml)')), 'and nothing says it will be claimable again tomorrow');
  w.closeNotify();
  w.post = async () => ({ status: 'error', message: 'You have already claimed every reward you have reached.' });
  w.claimSalary(null); await new Promise(r => setTimeout(r, 40));
  ok(/already claimed every reward/.test(d.getElementById('notifyMsg').textContent), 'a refused claim shows the server\'s message');
  console.log('test-salary: ' + n + ' checks passed' + (built ? ' (built)' : ''));
})().catch(e => { console.error(e); process.exit(1); });
