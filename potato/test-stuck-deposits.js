'use strict';
// Recharges stuck on "Needs Review" / gateway rows with no saved reference: Sync asks the provider and settles them.
const fs = require('node:fs'), assert = require('node:assert/strict');
const src = fs.readFileSync(__dirname + '/server.js', 'utf8');
const a = src.indexOf('// ── STUCK RECHARGES'), b = src.indexOf('// A MarzPay payment that never got a gateway id');
assert.ok(a > 0 && b > a, 'block found');
const block = src.slice(a, b);
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); };
const eq = (x, y, m) => { n++; assert.deepEqual(x, y, m); };
const fullyCredited = d => d.status === 'matched' && !d.needsManualCredit;

function world(rows, gw) {
  const store = new Map(Object.entries(rows).map(([id, v]) => [id, { ...v }]));
  const log = { credited: [], failed: [], asked: [] };
  const snapOf = id => ({ id, exists: store.has(id), data: () => store.get(id), ref: { get: async () => snapOf(id), update: async v => { Object.assign(store.get(id), v); } } });
  const db = { collection: () => ({
    doc: id => ({ get: async () => snapOf(id) }),
    where: () => ({ orderBy: () => ({ limit: () => ({ get: async () => ({ docs: [...store.keys()].filter(k => ['review', 'pending', 'initiating'].includes(store.get(k).status)).map(snapOf) }) }) }) }),
  }) };
  const fns = {
    tsMillis: v => (v instanceof Date ? v.getTime() : Number(v) || 0), depositFullyCredited: fullyCredited, DEPOSIT_FAILED_MSG: 'failed msg',
    GATEWAY_DEFS: { lworxpay: { name: 'LworxPay' }, obpay: { name: 'ObPay' } },
    gatewayGetTx: async (p, ref) => { log.asked.push(p + ':' + ref); return gw(p, ref); },
    gatewayApply: async (p, doc, t) => { if (t.status === 'success') { Object.assign(store.get(doc.id), { status: 'matched', walletCredited: true }); log.credited.push(doc.id); return 'success'; } log.failed.push(doc.id); store.get(doc.id).status = 'failed'; return 'failed'; },
    markDepositFailed: async (ref, uid, why) => { log.failed.push(ref === undefined ? '?' : why); },
    creditDeposit: async () => true, inChunks: async (items, size, fn) => { for (const i of items) await fn(i); },
    tavupayGetTx: async () => ({}), tavupayApply: async () => 'pending', pesajetGetTx: async () => ({}), pesajetFindByReference: async () => ({}), pesajetStatusLabel: () => '', pesajetFailureMsg: () => '',
    marzGetCollectTx: async () => ({}), SUCCESS_STATUSES: new Set(['success']), FAILED_STATUSES: new Set(['failed']), marzDepositFailureMsg: () => 'm', db, console: { error() {} },
  };
  const names = Object.keys(fns);
  const run = new Function(...names, block + '\nreturn { syncDepositById, resolveStuckDeposits };')(...names.map(k => fns[k]));
  return { run, store, log };
}
const old = new Date(Date.now() - 3 * 3600 * 1000), fresh = new Date(Date.now() - 10 * 1000);
(async () => {
  // a parked row with no reference: asked by OUR id; paid -> credited
  let w = world({ d1: { status: 'review', provider: 'lworxpay', userId: 'u', amount: 32000, createdAt: old } }, () => ({ status: 'success', rawStatus: 'completed', amount: 32000 }));
  let r = await w.run.syncDepositById('d1');
  eq(r.outcome, 'credited'); eq(w.log.asked, ['lworxpay:d1'], 'asked by the deposit id when no reference was saved'); eq(w.log.credited, ['d1']);
  // provider says failed -> closed
  w = world({ d1: { status: 'review', provider: 'obpay', userId: 'u', amount: 1, createdAt: old } }, () => ({ status: 'failed', rawStatus: 'failed', amount: 1 }));
  r = await w.run.syncDepositById('d1'); eq(r.outcome, 'failed');
  // provider has no record (404) on a parked row -> closed as failed, nothing taken
  w = world({ d1: { status: 'review', provider: 'lworxpay', userId: 'u', amount: 1, createdAt: old } }, () => ({ unavailable: true, httpStatus: 404 }));
  r = await w.run.syncDepositById('d1'); eq(r.outcome, 'failed'); ok(/no record/.test(r.message), r.message); eq(w.log.failed, ['failed msg']);
  // 404 on a young pending row: left alone (the prompt may still be starting)
  w = world({ d1: { status: 'pending', provider: 'lworxpay', userId: 'u', amount: 1, createdAt: fresh } }, () => ({ unavailable: true, httpStatus: 404 }));
  r = await w.run.syncDepositById('d1'); eq(r.outcome, 'waiting'); eq(w.log.failed, []); eq(w.store.get('d1').status, 'pending');
  // gateway refuses the question (401) or is down: never concluded, reason written on the row
  w = world({ d1: { status: 'review', provider: 'lworxpay', userId: 'u', amount: 1, createdAt: old } }, () => ({ unavailable: true, httpStatus: 401 }));
  r = await w.run.syncDepositById('d1'); eq(r.outcome, 'waiting'); ok(/HTTP 401/.test(w.store.get('d1').syncNote), 'reason is saved on the row');
  w = world({ d1: { status: 'review', provider: 'obpay', userId: 'u', amount: 1, createdAt: old } }, () => ({ providerDown: true }));
  eq((await w.run.syncDepositById('d1')).outcome, 'waiting');
  // still processing at the provider
  w = world({ d1: { status: 'pending', provider: 'obpay', obpayRef: 'd1', userId: 'u', amount: 1, createdAt: old } }, () => ({ status: 'processing', rawStatus: 'pending' }));
  r = await w.run.syncDepositById('d1'); eq(r.outcome, 'waiting'); ok(/pending/.test(r.message));
  // already credited / failed / manual: never touched
  w = world({ a: { status: 'matched', provider: 'lworxpay', createdAt: old }, b: { status: 'failed', provider: 'lworxpay', createdAt: old }, c: { status: 'review', method: 'manual', createdAt: old } }, () => { throw new Error('must not ask'); });
  eq([(await w.run.syncDepositById('a')).outcome, (await w.run.syncDepositById('b')).outcome, (await w.run.syncDepositById('c')).outcome], ['already', 'already', 'skipped']);
  eq((await w.run.syncDepositById('nope')).outcome, 'missing');
  // the sweep: review rows and ref-less gateway rows only; cooldown respected unless forced; young rows left
  w = world({
    rev: { status: 'review', provider: 'lworxpay', userId: 'u', amount: 1, createdAt: old },
    lost: { status: 'initiating', provider: 'obpay', userId: 'u', amount: 1, createdAt: old },
    ok: { status: 'pending', provider: 'obpay', obpayRef: 'ok', userId: 'u', amount: 1, createdAt: old },      // has its reference: the normal sweep's row
    young: { status: 'review', provider: 'lworxpay', userId: 'u', amount: 1, createdAt: fresh },
    man: { status: 'review', method: 'manual', createdAt: old },
    cool: { status: 'review', provider: 'lworxpay', userId: 'u', amount: 1, createdAt: old, syncedAtMs: Date.now() - 1000 },
  }, () => ({ status: 'success', rawStatus: 'completed', amount: 1 }));
  let out = await w.run.resolveStuckDeposits();
  eq(w.log.asked.sort(), ['lworxpay:rev', 'lworxpay:young', 'obpay:lost'], 'only rows no sweep could read (cooldown, manual and referenced rows skipped)'); eq(out.credited, 3);
  w = world({ cool: { status: 'review', provider: 'lworxpay', userId: 'u', amount: 1, createdAt: old, syncedAtMs: Date.now() - 1000 } }, () => ({ status: 'success', amount: 1 }));
  eq((await w.run.resolveStuckDeposits()).checked, 0, 'recently checked: left'); eq((await w.run.resolveStuckDeposits({ force: true })).checked, 1, 'forced Sync ignores the cooldown');
  // wiring: the reconciler and the admin routes use it
  ok(/reconcilePendingDeposits\(\)\.then\(\(\) => resolveStuckDeposits\(\)\)\.then\(parkLostMarzDeposits\)/.test(src), 'the periodic reconciler resolves stuck rows before parking');
  ok(/app\.get\('\/admin\/payments\/sync'[\s\S]{0,900}resolveStuckDeposits\(\{ force: true/.test(src), 'the Sync button asks the provider about stuck rows');
  ok(/app\.post\('\/admin\/deposit\/sync'/.test(src), 'a per-row sync route exists');
  const adm = fs.readFileSync(__dirname + '/admin-src/index.html', 'utf8');
  ok(/data-sync=/.test(adm) && /\/admin\/deposit\/sync/.test(adm), 'the admin has a Sync button on each stuck row');
  console.log('test-stuck-deposits: ' + n + ' checks passed');
})().catch(e => { console.error(e); process.exit(1); });
