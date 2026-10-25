'use strict';
// Daily Salary (the Salary tab): the server's tier validation and wage book (accrual rules), the claim route's money guards,
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
  const k = server.indexOf('const SALARY_BACKFILL_DAYS'), l = server.indexOf('async function salaryView');
  const ctx = { crypto: require('node:crypto'), MAX_MONEY_AMOUNT: 999999999, tzOffMs: () => 3 * 3600000 }; vm.createContext(ctx);
  vm.runInContext(server.slice(i, j) + '\n' + server.slice(k, l) + '\nthis.S=sanitizeTaskRows;this.T=taskRows;this.accrue=salaryAccrue;this.tierFor=salaryTierFor;this.day=salaryDayNumber;', ctx);
  const good = ctx.S([{ id: 's1', target: 500000, reward: 2000 }, { target: 100, reward: 5 }], 'salary');
  ok(good.rows.map(r => r.target).join() === '100,500000' && good.rows[1].id === 's1', 'tiers are sorted and keep their id');
  ok(ctx.S([{ target: 5, reward: 1 }, { target: 5, reward: 2 }], 'salary').error, 'two tiers cannot share a target');
  ok(ctx.S([{ target: 5, reward: 0 }], 'salary').error, 'a reward must be positive');
  ok(ctx.S([{ target: 50000000, reward: 14000 }], 'salary').rows, 'a large team total is allowed');
  const tiers = ctx.T([{ id: 'a', target: 500000, reward: 2000 }, { id: 'b', target: 1000000, reward: 4000 }], 'salary');
  ok(ctx.tierFor(tiers, 499999) === null && ctx.tierFor(tiers, 500000).id === 'a' && ctx.tierFor(tiers, 2500000).id === 'b', 'the highest tier reached is the member\'s tier');
  // day numbers follow the region clock (UTC+3): 22:00 UTC is already the next day in Uganda
  ok(ctx.day(Date.UTC(2026, 9, 19, 22, 0)) === ctx.day(Date.UTC(2026, 9, 20, 1, 0)) && ctx.day(Date.UTC(2026, 9, 19, 20, 0)) !== ctx.day(Date.UTC(2026, 9, 20, 1, 0)), 'a salary day is a calendar day on the Uganda clock');
  const T1 = tiers[0], T2 = tiers[1], today = 20000;
  let b = ctx.accrue({}, null, today);
  ok(b.accrued.length === 0 && b.last === null, 'below the lowest tier nothing accrues');
  b = ctx.accrue({}, T1, today);
  ok(b.accrued.length === 1 && b.accrued[0].d === today && b.accrued[0].r === 2000, 'the day the lowest tier is reached accrues one day');
  // two days later, tier went up to T2 in between: yesterday is paid at the old reward, today at the new one
  let u = { salaryAccrued: b.accrued, salaryLastDay: b.last, salaryTierReward: b.tierReward };
  b = ctx.accrue(u, T2, today + 2);
  ok(b.accrued.map(e => e.d + ':' + e.r).join() === `${today}:2000,${today + 1}:2000,${today + 2}:4000`, 'missed days are paid at the reward recorded at the last look, today at today\'s tier');
  // a day already paid never accrues again
  u = { salaryAccrued: [], salaryLastDay: today, salaryTierReward: 2000, creditedSalaryDays: [today, today + 1] };
  b = ctx.accrue(u, T1, today + 1);
  ok(b.accrued.length === 0, 'a day already paid is never accrued again');
  // looking twice on the same day changes nothing
  u = { salaryAccrued: [{ d: today, r: 2000 }], salaryLastDay: today, salaryTierReward: 2000 };
  b = ctx.accrue(u, T1, today);
  ok(b.accrued.length === 1, 'looking twice on one day does not add a second day');
  // a long absence is capped
  b = ctx.accrue({ salaryLastDay: today - 1000, salaryTierReward: 2000 }, T1, today);
  ok(b.accrued.length === 60, 'at most 60 days are back-filled');
  ok(/app\.get\('\/salary\/status'/.test(server) && /app\.post\('\/salary\/claim'/.test(server), 'the salary routes exist');
  const claim = server.slice(server.indexOf("app.post('/salary/claim'"), server.indexOf("app.post('/salary/claim'") + 4500);
  ok(/withLock\('salary:' \+ userId/.test(claim) && /creditedSalaryDays: \{ \$ne: entry\.d \}/.test(claim) && /FieldValue\.arrayUnion\(entry\.d\)/.test(claim) && /FieldValue\.increment\(entry\.r\)/.test(claim), 'the claim is locked per member and one atomic update carries the credit and the day\'s paid token');
  ok(/createIfAbsent/.test(claim) && /salary:\$\{userId\}:\$\{entry\.d\}/.test(claim), 'the ledger row is keyed by the day');
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
  let status = { status: 'success', total: 700000, accruedDays: 2, nextReward: 2000, tierId: 's0', tiers };
  const calls = [];
  w.api = async (p) => { calls.push(p); if (p === '/salary/status') return JSON.parse(JSON.stringify(status)); if (p === '/account') return { status: 'success', account: { walletBalance: 1 } }; return { status: 'success', transactions: [], messages: [] }; };
  w.post = async (p, b) => { calls.push(p + ' ' + JSON.stringify(b)); status = Object.assign({}, status, { accruedDays: 1 }); return { status: 'success', amount: 2000, walletBalance: 9000, accruedDays: 1 }; };
  w.eval('STATE.account={walletBalance:5000}; STATE.page="salary"');
  await w.renderSalary(); await new Promise(r => setTimeout(r, 20));
  ok(d.querySelectorAll('.bottom-nav .navitem').length === 6, 'six tabs');
  ok([...d.querySelectorAll('.bottom-nav .lbl')].map(e => e.textContent).join() === 'Home,Orders,Promotion,Team,Salary,Profile', 'tab names: Home, Orders, Promotion, Team, Salary, Profile');
  ok(/Daily Salary Standard/.test(d.querySelector('.mg-shead').textContent) && /Team Total Consumption: NGN 700,000/.test(d.querySelector('.mg-spill').textContent), 'title and the team total');
  ok(/Accrued wages: 2 day\(s\)/.test(d.querySelector('.mg-sacc').textContent), 'accrued days');
  const cards = [...d.querySelectorAll('.mg-stier')];
  ok(cards.length === 3 && /Reach NGN 500,000/.test(cards[0].textContent) && /Reward NGN 2,000/.test(cards[0].textContent), 'one card per tier with its reward');
  ok(cards[0].querySelector('.mg-sbtn.go') && !cards[1].querySelector('.mg-sbtn.go') && cards[1].querySelector('.mg-sbtn').textContent === 'Locked', 'a reached tier shows Claim, an unreached one Locked');
  w.eval(cards[1].querySelector('.mg-sbtn').getAttribute('onclick')); ok(/Need NGN 300,000 more to claim/.test(d.getElementById('notifyMsg').textContent), 'Locked says how much more is needed');
  ok(!d.querySelector('.notify-ok') && d.getElementById('notifyIc').innerHTML.length > 10, 'the notice has its picture and no OK button');
  w.closeNotify();
  ok(/Daily wage rules/.test(d.querySelector('.mg-rules').textContent) && d.querySelectorAll('.mg-rules li').length === 2, 'the wage rules are listed');
  w.claimSalary(d.querySelector('.mg-sbtn.go')); await new Promise(r => setTimeout(r, 40));
  ok(calls.includes('/salary/claim {}'), 'Claim posts to the server');
  ok(/NGN 2,000 added to your wallet/.test(d.getElementById('notifyMsg').textContent), 'the member is told what was paid');
  ok(/Accrued wages: 1 day\(s\)/.test(d.querySelector('.mg-sacc').textContent) && w.eval('STATE.account.walletBalance') === 9000, 'the page and the wallet figure are updated');
  w.closeNotify();
  w.post = async () => ({ status: 'error', message: 'No wages to claim yet. Come back tomorrow.' });
  w.claimSalary(null); await new Promise(r => setTimeout(r, 40));
  ok(/No wages to claim yet/.test(d.getElementById('notifyMsg').textContent), 'a refused claim shows the server\'s message');
  console.log('test-salary: ' + n + ' checks passed' + (built ? ' (built)' : ''));
})().catch(e => { console.error(e); process.exit(1); });
