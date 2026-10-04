#!/usr/bin/env node
// Exercise the actual read-only route with DB snapshots and the server's time helpers.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const acorn = require('acorn');
const src = fs.readFileSync(__dirname + '/server.js', 'utf8');
const ast = acorn.parse(src, { ecmaVersion: 'latest' });
const names = ['tsMillis', 'eatDayKey', 'eatNextMidnight', 'eatParts', 'bandOf', 'finiteMoney', 'analyticsContractDay'];
const helpers = names.map(name => {
  const n = ast.body.find(n => n.type === 'FunctionDeclaration' && n.id.name === name);
  assert.ok(n, name); return src.slice(n.start, n.end);
}).join('\n');
const routeStart = src.indexOf("app.post('/admin/analytics',");
const route = src.slice(routeStart, src.indexOf('// Owner-only visibility', routeStart));
let now = Date.parse('2026-10-04T08:30:00Z');
function Clock(...args) { return new Date(...(args.length ? args : [now])); }
Clock.prototype = Date.prototype;
Clock.now = () => now; Clock.parse = Date.parse;
const at = s => new Date(s);
const dep = (amount, createdAt, extra = {}) => ({ amount, createdAt: at(createdAt), status: 'matched', ...extra });
const wit = (net, createdAt, extra = {}) => ({ amount: net + 30, net, createdAt: at(createdAt), status: 'processed', ...extra });
let rows = {}, rewardFailure = false, cap = false;
const db = { collection(name) {
  let statusFilter;
  return { orderBy() { return this; }, where(field, op, value) { if (name === 'investments' && field === 'status') statusFilter = op === 'in' ? value : [value]; return this; }, limit() { return this; }, async get() {
    if (name === 'transactions' && rewardFailure) throw Error('offline fixture');
    const docs = (rows[name] || []).filter(data => !statusFilter || statusFilter.includes(data.status)).map((data, i) => ({ id: String(i), data: () => data }));
    return { docs: cap && name === 'users' ? { length: 10000 } : docs, forEach: fn => docs.forEach(fn) };
  } };
} };
let handler;
new Function('app', 'db', 'Date', 'console', `
const tzOffMs = () => 180 * 60000;
const DEFAULT_REGION_KEY = 'ug';
const verifyAdmin = req => req.authorized !== false;
const adminRegionFilter = () => null;
const rowRegionKey = () => 'ug';
${helpers}\n${route}
`)({ post(path, fn) { handler = fn; } }, db, Clock, { error() {} });
async function read(body = {}, authorized = true) {
  let code = 200, data;
  await handler({ body, authorized }, { status(n) { code = n; return this; }, json(d) { data = d; } });
  assert.equal(code, authorized ? 200 : 401, JSON.stringify(data)); return data;
}
(async () => {
  rows = {
    pendingDeposits: [
      dep(100, '2026-10-01T12:00:00Z', { creditedAt: at('2026-10-03T21:00:00Z') }),
      dep(40, '2026-10-03T20:59:59Z', { creditedAt: at('2026-10-03T20:59:59Z') }),
      dep(200, '2026-10-04T01:00:00Z', { needsManualCredit: true }),
      dep(300, '2026-10-04T02:00:00Z', { needsManualCredit: true, walletCredited: true }),
      dep(50, '2026-10-04T03:00:00Z', { status: 'pending' }),
      dep(900, '2026-10-04T04:00:00Z', { status: 'failed' }),
      dep(70, '2026-09-01T10:00:00Z'),
    ],
    withdrawals: [
      wit(60, '2026-10-01T01:00:00Z', { processedAt: at('2026-10-03T21:00:00Z') }),
      wit(80, '2026-10-04T02:00:00Z', { status: 'processing' }),
      wit(0, '2026-10-04T02:00:00Z'),
      wit(500, '2026-10-04T02:00:00Z', { status: 'declined' }),
      wit(35, '2026-09-01T10:00:00Z'),
    ],
    users: [{ totalInvested: 50000 }, { totalInvested: 0 }],
    investments: [
      { status: 'active', userId: 'u1', tierKey: 'p1', tierLabel: 'Product', amount: 1000, expectedReturn: 3000, paidOut: 700 },
      { status: 'active', userId: 'u1', tierKey: 'p1', tierLabel: 'Product', amount: 2000, expectedReturn: 6000, paidOut: 1000 },
      { status: 'active', userId: 'u2', tierKey: '__proto__', amount: 10, expectedReturn: 20, paidOut: 5 },
    ], transactions: [{ amount: 25 }],
  };
  const a = await read({ days: 1 });
  assert.equal(a.today, '2026-10-04');
  assert.equal(a.kpis.depositsAmount, 400);
  assert.equal(a.kpis.withdrawalsAmount, 60);
  assert.equal(a.kpis.withdrawalsCount, 2); // Recorded zero net is not gross money paid.
  assert.equal(a.selectedDay.depositsOpenAmount, 250);
  assert.equal(a.selectedDay.withdrawalsOpenAmount, 80);
  assert.equal(a.byHour[0].depAmt, 100);
  assert.equal(a.byHour[0].witAmt, 60);
  assert.equal(a.byDay.reduce((sum, d) => sum + d.dep, 0), a.kpis.depositsAmount);
  assert.equal(a.kpis.activeInvestors, 2); // Distinct live owners, not all-time buyers.
  assert.equal(a.runningProducts.find(p => p.key === 'p1').remainingPayout, 7300);
  assert.equal(a.runningProducts.find(p => p.key === '__proto__').count, 1);
  assert.equal(a.forecast, undefined);
  const old = await read({ days: 1, day: '2026-09-01' });
  assert.equal(old.selectedDay.depositsCompletedAmount, 70);
  assert.equal(old.selectedDay.withdrawalsCompletedAmount, 35);
  assert.equal(old.kpis.depositsAmount, 400);
  const yesterday = await read({ days: 1, day: '2026-10-03' });
  assert.equal(yesterday.selectedDay.depositsCompletedAmount, 40);
  assert.equal((await read({ day: '2026-99-99' })).selectedDay.day, '2026-10-04');
  cap = true; assert.equal((await read()).truncated, true); cap = false;
  rewardFailure = true;
  const failed = await read();
  assert.equal(failed.rewardsUnavailable, true); assert.equal(failed.kpis.teamRewardsPaid, null);
  rewardFailure = false;
  await read({}, false);
  now = Date.parse('2026-10-04T21:00:00Z');
  assert.equal((await read()).selectedDay.day, '2026-10-05');
  const contractDay = new Function(`${helpers}; return analyticsContractDay;`)();
  const start = Date.parse('2026-10-03T21:00:00Z');
  const end = start + 86400000;
  const base = { status: 'active', userId: '0', tierKey: 'p1', createdAt: at('2026-10-02T21:00:00Z'), payoutsTotal: 3, payoutsMade: 0, expectedReturn: 100, paidOut: 0 };
  assert.equal(contractDay(base, start, end, start).scheduled, 33);
  assert.equal(contractDay(base, start + 86400000, end + 86400000, start).scheduled, 34);
  assert.equal(contractDay(base, start + 2 * 86400000, end + 2 * 86400000, start).scheduled, 33);
  assert.equal(contractDay(base, start - 86400000, start, start).scheduled, 0);
  assert.equal(contractDay(base, start, end, start - 1).overdue, 0);
  assert.equal(contractDay(base, start, end, start).overdue, 33);
  assert.equal(contractDay({ ...base, payoutsMade: 1, paidOut: 33 }, start, end, end).unpaid, 0);
  assert.equal(contractDay({ ...base, payoutsMade: 1, paidOut: 33 }, start, end, end).overdue, 34);
  assert.equal(contractDay({ ...base, status: 'matured', payoutsMade: 3, paidOut: 100 }, start, end, end).scheduled, 33);
  assert.equal(contractDay({ ...base, status: 'matured', payoutsMade: 3, paidOut: 100 }, start, end, end).unpaid, 0);
  assert.equal(contractDay({ ...base, createdAt: at('2026-10-03T08:30:00Z') }, start, end, start).scheduled, 33);
  assert.equal(contractDay({ ...base, payoutsTotal: 0 }, start, end, start), null);
  assert.equal(contractDay({ ...base, createdAt: null }, start, end, start), null);
  rows.users = [{ status: 'active' }, { status: 'banned' }];
  rows.investments = [base, { ...base, userId: '1' }, { ...base, userId: 'missing' },
    { ...base, status: 'matured', payoutsMade: 3, paidOut: 100 }, { ...base, payoutsTotal: 0 }];
  now = start;
  const schedules = await read({ day: '2026-10-04' });
  assert.equal(schedules.schedule.scheduledAmount, 132);
  assert.equal(schedules.schedule.unpaidAmount, 33);
  assert.equal(schedules.schedule.pausedUnpaidAmount, 66);
  assert.equal(schedules.schedule.overdueNowAmount, 33);
  assert.equal(schedules.schedule.pausedOverdueAmount, 66);
  assert.equal(schedules.schedule.invalidContracts, 1);
  const future = await read({ day: '2026-10-06' });
  assert.equal(future.schedule.maturingCount, 4);
  assert.equal(future.schedule.scheduledAmount, 132);
  rows.pendingDeposits.push(dep(11, '2026-09-01T10:00:00Z', { status: 'pending' }));
  rows.withdrawals.push(wit(12, '2026-09-01T10:00:00Z', { status: 'pending' }));
  const queues = await read({ day: '2026-10-04' });
  assert.equal(queues.openRequests.depositsAmount, 261);
  assert.equal(queues.openRequests.withdrawalsAmount, 92);
  assert.equal(queues.selectedDay.depositsOpenAmount, 250);
  const { JSDOM } = require('jsdom');
  const html = fs.readFileSync(__dirname + '/admin-src/index.html', 'utf8');
  const view = html.slice(html.indexOf('let _anPeriod ='), html.indexOf('// ── USERS ──'));
  const dom = new JSDOM('<div id="content"></div>', { runScripts: 'outside-only' });
  const calls = [];
  dom.window.api = async (path, body) => {
    if (path !== '/admin/analytics') return null;
    calls.push(body);
    return { ...a, selectedDay: { ...a.selectedDay, day: body.day || a.today } };
  };
  dom.window.eval(`const SESSION_ROLE = 'staff';
    const $ = id => document.getElementById(id);
    const staleTab = () => false;
    const ugx = n => 'UGX ' + n;
    const esc = s => String(s ?? '');
    const fdate = n => String(n);
    ${view}`);
  await dom.window.renderAnalytics();
  assert.equal(dom.window.document.getElementById('analytics-day').value, '2026-10-04');
  assert.match(dom.window.document.getElementById('content').textContent, /Deposits credited/);
  const input = dom.window.document.getElementById('analytics-day');
  input.value = '2026-09-01'; input.dispatchEvent(new dom.window.Event('change'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.at(-1).day, '2026-09-01');
  dom.window.document.getElementById('analytics-today').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.at(-1).day, '');
  assert.equal(dom.window.document.getElementById('analytics-day').hasAttribute('max'), false);
  dom.window.close();
  console.log('PASS: analytics settlement dates, EAT midnight, historical day selection, unresolved credits, zero net, live contracts, caps, query failure, authorization and midnight rollover');
})().catch(e => { console.error(e); process.exitCode = 1; });
