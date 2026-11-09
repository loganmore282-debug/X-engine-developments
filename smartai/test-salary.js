'use strict';
// Team rewards (the Task Center): each tier is claimed ONCE, for good. The server's tier validation and the claim route's money guards (server helpers
// run via vm). The member page for it (tiers, Claim, Claimed) is driven in a real browser by test-smartai-app.js.
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
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
console.log('test-salary: ' + n + ' checks passed');
