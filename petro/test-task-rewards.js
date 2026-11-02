'use strict';
// Task Center rewards editable from the admin panel: validation, defaults, who may save, and that the member-facing
// ladder (stats + claim) follows what was saved. Real server.js source against mocks.
const fs = require('node:fs'), assert = require('node:assert/strict');
let checks = 0; const ok = (c, m) => { checks++; assert.ok(c, m); }; const eq = (a, b, m) => { checks++; assert.deepEqual(a, b, m); };
const src = fs.readFileSync(__dirname + '/server.js', 'utf8');
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i + 1); assert.ok(i >= 0 && j > i, a); return src.slice(i, j); };
const helpers = cut('const TASK_LADDER_MAX_ROWS', 'async function activeL1Count');
const routes = cut("app.post('/admin/task-rewards/get'", '// ── MISSION CENTER — REMOVED ──');
const DEF_C = [{ target: 5, reward: 10000 }, { target: 15, reward: 20000 }], DEF_D = [{ target: 250000, reward: 10000 }];
const store = { settings: {} }, handlers = {}, log = [];
const ctx = { owner: true, admin: true };
const mk = new Function('app', 'db', 'getSettings', 'verifyOwner', 'verifyAdmin', 'logAdminAction', 'FieldValue', 'MAX_MONEY_AMOUNT', 'TEAM_MILESTONES', 'TEAM_DEPOSIT_MILESTONES', 'state',
  helpers + routes + '\nreturn { cleanTaskLadder, taskTablesFrom };');
const FieldValue = { delete: () => ({ __delete: true }) };
const api = mk({ post: (p, h) => { handlers[p] = h; } },
  { collection: () => ({ doc: () => ({ set: async (u) => { for (const [k, v] of Object.entries(u)) { if (v && v.__delete) delete store.settings[k]; else store.settings[k] = v; } } }) }) },
  async () => store.settings, () => ctx.owner, () => ctx.admin, (r, a, m) => log.push([a, m]), FieldValue, 1e9, DEF_C, DEF_D, {});
async function call(path, body) { const o = { code: 200 }; await handlers[path]({ body }, { status(c) { o.code = c; return this; }, json(b) { o.body = b; return this; } }); return o; }
(async () => {
  // defaults when nothing is stored, and when what is stored is junk
  eq(api.taskTablesFrom({}).count, DEF_C, 'no setting: the standard referral ladder');
  eq(api.taskTablesFrom({ taskCountMilestones: 'x', taskDepositMilestones: [] }), { count: DEF_C, deposit: DEF_D }, 'junk or empty: the standard ladders');
  eq(api.taskTablesFrom({ taskCountMilestones: [{ target: 5, reward: 1 }, { target: 5, reward: 2 }] }).count, DEF_C, 'a repeated target is not accepted from storage either');
  eq(api.taskTablesFrom({ taskCountMilestones: [{ target: 9, reward: 90 }, { target: 3, reward: 30 }] }).count, [{ target: 3, reward: 30 }, { target: 9, reward: 90 }], 'a good stored ladder is used, smallest target first');
  // reading
  let r = await call('/admin/task-rewards/get', {}); eq([r.body.count, r.body.custom.count], [DEF_C, false], 'get: defaults, not customised');
  ctx.admin = false; eq((await call('/admin/task-rewards/get', {})).code, 401, 'get needs an admin'); ctx.admin = true;
  // saving
  ctx.owner = false; eq((await call('/admin/task-rewards/save', { count: [{ target: 1, reward: 1 }] })).code, 401, 'staff cannot save'); ctx.owner = true;
  const bad = [[], [{ target: 0, reward: 5 }], [{ target: 5, reward: 0 }], [{ target: 1.5, reward: 5 }], [{ target: 5, reward: 'a' }], [{ target: 5, reward: 5 }, { target: 5, reward: 6 }], [{ target: 200000, reward: 5 }], Array.from({ length: 21 }, (_, i) => ({ target: i + 1, reward: 1 })), 'nope'];
  for (const b of bad) { r = await call('/admin/task-rewards/save', { count: b }); eq(r.code, 400, 'refused: ' + JSON.stringify(b).slice(0, 50)); ok(/referral tasks need/.test(r.body.message), 'and says what is wrong'); }
  eq(store.settings, {}, 'nothing was stored by the refusals');
  eq((await call('/admin/task-rewards/save', {})).code, 400, 'an empty request is refused');
  r = await call('/admin/task-rewards/save', { count: [{ target: 10, reward: 500 }, { target: 2, reward: 100 }], deposit: [{ target: 100000, reward: 2500 }] });
  eq(r.code, 200, 'a good save is accepted');
  eq(store.settings.taskCountMilestones, [{ target: 2, reward: 100 }, { target: 10, reward: 500 }], 'stored sorted by target');
  r = await call('/admin/task-rewards/get', {}); eq([r.body.count.length, r.body.custom.count, r.body.custom.deposit], [2, true, true], 'get now shows the custom ladders');
  eq(api.taskTablesFrom(store.settings).deposit, [{ target: 100000, reward: 2500 }], 'the member side now uses the saved deposit ladder');
  // saving only one list leaves the other alone
  await call('/admin/task-rewards/save', { count: [{ target: 7, reward: 70 }] });
  eq(store.settings.taskDepositMilestones, [{ target: 100000, reward: 2500 }], 'saving one list does not touch the other');
  // back to the standard
  r = await call('/admin/task-rewards/save', { count: null, deposit: null });
  eq([r.code, 'taskCountMilestones' in store.settings, 'taskDepositMilestones' in store.settings], [200, false, false], 'restore standard removes the saved ladders');
  eq(api.taskTablesFrom(store.settings), { count: DEF_C, deposit: DEF_D }, 'and the member side is back to the standard');
  ok(log.some(l => l[0] === 'task_rewards_updated'), 'every save is in the activity log');
  // wiring: stats and claim read the same tables
  ok(/const tasks = taskTablesFrom\(sett\);[\s\S]{0,120}tasks\.count\.map/.test(src), '/team/stats uses the saved ladders');
  ok(/const tasks = taskTablesFrom\(await getSettings\(\)\);[\s\S]{0,160}isDeposit \? tasks\.deposit : tasks\.count/.test(src), '/team/milestone/claim uses the saved ladders');
  console.log('PASS: Task Center rewards settings (' + checks + ' checks)');
})().catch(e => { console.error(e); process.exitCode = 1; });
