'use strict';
// Task Center: the Team page button and badge, the page (tabs, card states, claim), the win card handing back to the page,
// and the server's validation of what the admin saves. Drives source (and --built) in JSDOM; server helpers via vm.
const fs = require('node:fs'), zlib = require('node:zlib'), vm = require('node:vm'), assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const built = process.argv.includes('--built');
const html = fs.readFileSync(__dirname + (built ? '/user/index.html' : '/user-src/index.html'), 'utf8');
const source = fs.readFileSync(__dirname + '/user-src/original_module.js', 'utf8');
const server = fs.readFileSync(__dirname + '/server.js', 'utf8');
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); };

// ── server helpers: what an admin may save ──
{
  const i = server.indexOf('const TASK_MAX_ROWS'), j = server.indexOf('async function activeL1Count');
  const ctx = { crypto: require('node:crypto'), MAX_MONEY_AMOUNT: 999999999 }; vm.createContext(ctx);
  vm.runInContext(server.slice(i, j) + '\nthis.sanitizeTaskRows=sanitizeTaskRows;this.taskRows=taskRows;', ctx);
  const S = ctx.sanitizeTaskRows, T = ctx.taskRows;
  const good = S([{ id: 'r1', target: 10, reward: 20000 }, { target: 5, reward: 10000 }], 'count');
  ok(good.rows && good.rows.map(r => r.target).join() === '5,10', 'rows are sorted by target');
  ok(good.rows.find(r => r.target === 10).id === 'r1' && /^t[0-9a-f]{8}$/.test(good.rows.find(r => r.target === 5).id), 'an existing row keeps its id, a new row gets one');
  for (const [name, rows] of [['same target', [{ target: 5, reward: 1 }, { target: 5, reward: 2 }]], ['negative', [{ target: 5, reward: -1 }]], ['decimal', [{ target: 5.5, reward: 1 }]], ['text', [{ target: 'a', reward: 1 }]], ['zero', [{ target: 0, reward: 1 }]], ['huge reward', [{ target: 1, reward: 1e12 }]], ['not a list', 'x'], ['31 rows', Array.from({ length: 31 }, (_, k) => ({ target: k + 1, reward: 1 }))]])
    ok(S(rows, 'count').error, 'refused: ' + name);
  ok(S([{ target: 1000000, reward: 5 }], 'deposit').rows, 'a deposit target can be large');
  ok(S([{ target: 1000000, reward: 5 }], 'count').error, 'a referral target cannot be a million');
  ok(T([{ id: 'a', target: 5, reward: 1 }, { target: 3, reward: 2 }, null, { id: 'b', target: -1, reward: 1 }], 'count').length === 1, 'malformed stored rows are quietly left out');
  // a task typed again gets its old id back (so it cannot be claimed twice); a new target gets a fresh one
  const re = S([{ target: 5, reward: 7 }, { target: 9, reward: 1 }], 'count', { 5: 'r1' });
  ok(re.rows.find(r => r.target === 5).id === 'r1', 'a removed task typed again gets its old id back');
  ok(/^t[0-9a-f]{8}$/.test(re.rows.find(r => r.target === 9).id), 'a target that never existed gets a fresh id');
  const clash = S([{ id: 'r1', target: 6, reward: 1 }, { target: 5, reward: 1 }], 'count', { 5: 'r1' });
  ok(clash.rows.find(r => r.target === 6).id === 'r1' && clash.rows.find(r => r.target === 5).id !== 'r1', 'an id already taken by another row is never handed out twice');
  ok(/taskIdByTarget/.test(server) && /Task reward ledger row failed/.test(server), 'the server remembers ids and a failed ledger write does not turn a paid claim into an error');
  ok(/app\.post\('\/team\/task\/claim'/.test(server) && /creditedTaskKeys: \{ \$ne: key \}/.test(server) && /withLock\('taskclaim:' \+ userId/.test(server), 'the claim is locked per member and guarded by an atomic token');
  ok(/app\.post\('\/admin\/tasks\/save', async \(req, res\) => \{\s*if \(!verifyOwner/.test(server), 'only the owner can save the tasks');
  ok(!/TEAM_MILESTONES|TEAM_DEPOSIT_MILESTONES/.test(server), 'the old hard-coded ladders are gone');
}

// ── the member app ──
const dom = new JSDOM(html, { url: 'https://mysoda.p-colasoda.com/', runScripts: 'outside-only', pretendToBeVisual: true });
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
  const ms = [
    { type: 'count', id: 'r1', target: 5, reward: 10000, current: 6, achieved: true, claimed: false },
    { type: 'count', id: 'r2', target: 10, reward: 20000, current: 6, achieved: false, claimed: false },
    { type: 'count', id: 'r3', target: 20, reward: 40000, current: 6, achieved: false, claimed: false },
    { type: 'deposit', id: 'd1', target: 250000, reward: 10000, current: 400000, achieved: true, claimed: true },
    { type: 'deposit', id: 'd2', target: 500000, reward: 25000, current: 400000, achieved: false, claimed: false },
    { type: 'count', target: 99, reward: 1, current: 0, achieved: false, claimed: false }, // an old cached row with no id
  ];
  w.eval('STATE.page="network"; STATE.account={referralCode:"ABCD",walletBalance:5000}; STATE.teamStats=' + JSON.stringify({ referralCode: 'ABCD', commRates: { l1: 20, l2: 5, l3: 1 }, team: { l1: 6, l2: 0, l3: 0 }, totalTeam: 6, teamDeposits: 400000, l1ActiveCount: 6, levelCommission: {}, milestones: ms }));
  const calls = [];
  w.api = async (p) => { calls.push(p); if (p === '/account') return { status: 'success', account: { referralCode: 'ABCD', walletBalance: 15000 } }; return { status: 'success', ...JSON.parse(JSON.stringify(w.STATE.teamStats)), members: [] }; };
  w.post = async (p, b) => { calls.push(p + ' ' + JSON.stringify(b)); return { status: 'success', amount: 10000, walletBalance: 15000 }; };
  w.eval('paintNetwork()'); await new Promise(r => setTimeout(r, 20));
  ok(d.querySelector('.v-task-btn b').textContent === 'Task Center', 'the Team page has the Task Center button');
  ok(d.getElementById('tkBadge').textContent === '1' && d.getElementById('tkBadge').style.display !== 'none', 'its badge counts the rewards ready to claim (1)');
  ok(d.querySelector('.v-share').nextElementSibling === d.querySelector('.v-task-btn'), 'it sits right under the invite link card');
  // open the page
  await w.openTaskCenter(); await new Promise(r => setTimeout(r, 20));
  ok(d.getElementById('sheetTitle').textContent === 'Task Center', 'it opens as a full page titled Task Center');
  ok(d.querySelectorAll('.v-tk-tabs button').length === 2 && /Referrals/.test(d.querySelectorAll('.v-tk-tabs button')[0].textContent) && /Deposits/.test(d.querySelectorAll('.v-tk-tabs button')[1].textContent), 'two tabs: Referrals and Deposits');
  ok(/Level 1 active referrals/.test(d.querySelector('.v-tk-hero').textContent) && /Team deposits/.test(d.querySelector('.v-tk-hero').textContent) && /UGX400,000/.test(d.querySelector('.v-tk-hero').textContent), 'the summary shows both figures');
  let cards = [...d.querySelectorAll('.v-tk-card')];
  ok(cards.length === 3, 'Referrals lists its 3 tasks (the cached row without an id is skipped)');
  ok(cards[0].classList.contains('ready') && cards[1].classList.contains('next') && cards[2].classList.contains('locked'), 'states: ready, next, locked');
  ok(/Progress: 5 \/ 5/.test(cards[0].textContent) && /Progress: 6 \/ 10/.test(cards[1].textContent), 'progress is capped at the target');
  ok(cards[0].querySelector('.v-tk-btn.go') && !cards[1].querySelector('.v-tk-btn.go') && cards[1].querySelector('.v-tk-btn').getAttribute('onclick').indexOf('taskNotReached') === 0, 'only the reached task has an active Claim button; the others answer "not reached"');
  w.taskNotReached('count'); ok(/Referral target not reached/.test(d.getElementById('notifyMsg').textContent), 'tapping Claim on an unreached referral task says Referral target not reached');
  w.taskNotReached('deposit'); ok(/Deposit target not reached/.test(d.getElementById('notifyMsg').textContent), 'and on an unreached deposit task says Deposit target not reached');
  ok(/UGX10,000/.test(cards[0].querySelector('.v-tk-reward').textContent), 'the reward is shown');
  w.switchTaskTab('deposit'); cards = [...d.querySelectorAll('.v-tk-card')];
  ok(cards.length === 2 && cards[0].classList.contains('done') && /Claimed/.test(cards[0].textContent) && /UGX250,000/.test(cards[0].textContent), 'Deposits tab: a claimed task shows Claimed');
  w.switchTaskTab('count');
  // claim
  const btn = d.querySelector('.v-tk-btn.go'); const onclick = btn.getAttribute('onclick'); w.eval(onclick.replace(/this\)/, 'document.querySelector(".v-tk-btn.go"))'));
  await new Promise(r => setTimeout(r, 30));
  ok(calls.some(c => c === '/team/task/claim {"type":"count","id":"r1"}'), 'tapping Claim posts the task type and id');
  ok(d.getElementById('chestWinBg') && /UGX10,000\.00/.test(d.getElementById('chestWinBg').textContent) && /New Balance: UGX15,000\.00/.test(d.getElementById('chestWinBg').textContent), 'the Congratulations card shows the reward and the new balance');
  cards = [...d.querySelectorAll('.v-tk-card')]; ok(cards[0].classList.contains('done'), 'the task now shows as claimed');
  ok(d.getElementById('tkBadge').style.display === 'none', 'the badge on the Team page is cleared');
  w.collectChestWin();
  ok(!d.getElementById('chestWinBg') && d.getElementById('sheetBg').classList.contains('show') && d.getElementById('sheetTitle').textContent === 'Task Center', 'COLLECT returns to the Task Center page instead of closing it');
  ok(w.eval('STATE.account.walletBalance') === 15000, 'the wallet figure in the app is updated');
  // a refused claim says why and shows the true state
  w.post = async () => ({ status: 'error', message: 'Already claimed' });
  w.eval('STATE.teamStats.milestones[1].achieved=true'); w.switchTaskTab('count');
  w.eval(d.querySelectorAll('.v-tk-btn.go')[0].getAttribute('onclick').replace(/this\)/, 'document.querySelectorAll(".v-tk-btn.go")[0])'));
  await new Promise(r => setTimeout(r, 30));
  ok(d.getElementById('notifyMsg').textContent === 'Already claimed', 'a refused claim shows the server\'s message');
  // a failed load never reads as "no tasks"
  w.eval('STATE.teamStats=null; _taskFailed=false'); w.api = async () => ({ status: 'error', message: 'x' });
  await w.openTaskCenter(); await new Promise(r => setTimeout(r, 20));
  ok(d.getElementById('tkBody').textContent === 'Could not load your team' && !/No tasks yet/.test(d.getElementById('tkBody').textContent), 'a failed first load says it could not load (not "No tasks yet.")');
  w.eval('STATE.teamStats=' + JSON.stringify({ l1ActiveCount: 1, teamDeposits: 0, milestones: [{ type: 'count', id: 'r1', target: 5, reward: 10000, current: 1, achieved: false, claimed: false }] }));
  await w.refreshTaskCenter(); await new Promise(r => setTimeout(r, 20));
  ok(d.querySelectorAll('.v-tk-card').length === 1, 'a failed refresh keeps the list that is on screen');
  w.closeSheet();
  console.log('test-task-center: ' + n + ' checks passed' + (built ? ' (built)' : ''));
})().catch(e => { console.error(e); process.exit(1); });
