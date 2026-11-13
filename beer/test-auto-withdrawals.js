// Automatic withdrawals (Admin > Settings): each pending withdrawal is sent by the server after its OWN random wait.
const fs = require('fs'), assert = require('assert'), vm = require('vm');
const rd = f => fs.readFileSync(__dirname + '/' + f, 'utf8');
const src = rd('server.js'), admin = rd('admin-src/index.html');
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); };
const a = src.indexOf('let _autoTickRunning'), b = src.indexOf("app.get('/admin/payments/sync'"); ok(a > 0 && b > a, 'tick source found');
const tickSrc = src.slice(a, b);

(async () => {
  const mkDb = rows => ({ collection: () => { const filters = []; const q = { where(f, op, v) { filters.push([f, op, v]); return q; }, orderBy() { return q; }, limit() { return q; },
    async get() { const out = rows.filter(r => filters.every(([f, op, v]) => op === '==' ? r[f] === v : op === '<=' ? r[f] <= v : true)); return { docs: out.map(r => ({ id: r.id, data: () => r })) }; },
    doc: id => ({ update: async u => { Object.assign(rows.find(r => r.id === id), u); } }) }; return q; } });
  async function run(rows, sett, opts = {}) {
    const calls = []; const ctx = { console, Math, Date: opts.Date || Date, Number, db: mkDb(rows), getSettings: async () => sett, payoutIsManual: () => !!opts.manual,
      processWithdrawalCore: async id => { calls.push(id); return opts.out || { code: 200 }; } };
    vm.createContext(ctx); vm.runInContext(tickSrc + ';this.tick=autoApproveWithdrawalsTick;this.delay=autoApproveDelayMs;', ctx); await ctx.tick(); return { calls, ctx };
  }
  const base = { autoApproveWithdrawalsEnabled: true, autoApproveMinSec: 10, autoApproveMaxSec: 60, autoApproveMaxAmount: 0, autoApproveEnabledAt: 0 };
  // the wait is inside the range and differs between withdrawals
  let rows = Array.from({ length: 30 }, (_, i) => ({ id: 'w' + i, status: 'pending', amount: 25000 }));
  let r = await run(rows, base); const now = Date.now();
  ok(r.calls.length === 0, 'nothing is sent on first sight: every request first gets its own wait');
  ok(rows.every(w => w.autoSendAt >= now + 9000 && w.autoSendAt <= now + 61000), 'every wait is between the shortest and the longest');
  ok(new Set(rows.map(w => w.autoSendAt)).size > 20, 'the waits are random (not one rhythm)');
  // due ones are sent, future ones are not
  rows = [{ id: 'due', status: 'pending', amount: 1, autoSendAt: Date.now() - 1000 }, { id: 'later', status: 'pending', amount: 1, autoSendAt: Date.now() + 50000 }];
  r = await run(rows, base); ok(r.calls.join() === 'due', 'only a withdrawal whose wait is over is sent');
  // off / manual payout mode: nothing
  r = await run([{ id: 'x', status: 'pending', amount: 1, autoSendAt: 1 }], { ...base, autoApproveWithdrawalsEnabled: false }); ok(r.calls.length === 0, 'switched off: nothing is sent');
  r = await run([{ id: 'x', status: 'pending', amount: 1, autoSendAt: 1 }], base, { manual: true }); ok(r.calls.length === 0, 'manual payout mode: nothing is sent (nobody has paid anything)');
  // a wait chosen before the switch was last turned on is thrown away
  rows = [{ id: 'old', status: 'pending', amount: 1, autoSendAt: Date.now() - 5000 }];
  r = await run(rows, { ...base, autoApproveEnabledAt: Date.now() - 1000 }); ok(r.calls.length === 0 && rows[0].autoSendAt > Date.now(), 'an old wait from before the switch was turned on is picked again');
  // over the limit stays for a person
  rows = [{ id: 'big', status: 'pending', amount: 90000, autoSendAt: 1 }, { id: 'small', status: 'pending', amount: 9000, autoSendAt: 1 }];
  r = await run(rows, { ...base, autoApproveMaxAmount: 10000 }); ok(r.calls.join() === 'small', 'above the automatic limit it stays for a person');
  // failures: wait longer, give up after 5
  rows = [{ id: 'f', status: 'pending', amount: 1, autoSendAt: 1 }]; r = await run(rows, base, { out: { code: 503, body: { message: 'x' } } });
  ok(rows[0].autoAttempts === 1 && rows[0].autoSendAt > Date.now() + 50000, 'a refused payout is retried later, not every second');
  rows = [{ id: 'g', status: 'pending', amount: 1, autoSendAt: 1, autoAttempts: 4 }]; r = await run(rows, base, { out: { code: 503 } }); ok(rows[0].autoHold === true, 'after 5 failed tries it is left for a person');
  rows = [{ id: 'h', status: 'pending', amount: 1, autoSendAt: 1, autoHold: true }]; r = await run(rows, base); ok(r.calls.length === 0, 'a held withdrawal is never sent automatically');
  // the delay function
  const d = r.ctx.delay({ autoApproveMinSec: 5, autoApproveMaxSec: 5 }); ok(d === 5000, 'equal shortest and longest = a fixed wait');
  ok(r.ctx.delay({ autoApproveMinSec: 0, autoApproveMaxSec: 0 }) === 0, '0 to 0 = send at once');

  // settings plumbing and the admin panel
  ok(/autoApproveMinSec: 10, autoApproveMaxSec: 60/.test(src) && /autoApproveMinSec: \[0, 86400\], autoApproveMaxSec: \[0, 86400\]/.test(src), 'defaults and ranges exist');
  ok(/The longest wait cannot be shorter than the shortest wait/.test(src) && /autoApproveEnabledAt = Date\.now\(\)/.test(src), 'the save checks the range and stamps when the switch is turned on');
  ok(/setInterval\(autoApproveWithdrawalsTick, 1000\)/.test(src), 'the server looks every second');
  ok(/id="sAutoWit"/.test(admin) && /id="sAutoMin"/.test(admin) && /id="sAutoMax"/.test(admin) && /id="sAutoCap"/.test(admin), 'the admin Settings page has the switch, the two waits and the limit');
  ok(/autoApproveWithdrawalsEnabled:\$\('sAutoWit'\)\.checked, autoApproveMinSec:\+\$\('sAutoMin'\)\.value, autoApproveMaxSec:\+\$\('sAutoMax'\)\.value/.test(admin), 'and Save rates sends them');
  ok(/autoWithdrawals: !!sett\.autoApproveWithdrawalsEnabled && !payoutIsManual\(sett\)/.test(src) && /_witAuto/.test(admin), 'the Withdrawals list tells the panel automatic mode is on, and shows each send time');
  console.log(`PASS: automatic withdrawals (${n} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
