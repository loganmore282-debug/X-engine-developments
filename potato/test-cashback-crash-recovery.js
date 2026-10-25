'use strict';
// Inject a process loss after an atomic wallet credit and verify recovery.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const acorn = require('acorn');
const source = fs.readFileSync(__dirname + '/server.js', 'utf8');
const tree = acorn.parse(source, { ecmaVersion: 'latest' });
function fn(name) {
  const node = tree.body.find(n => n.type === 'FunctionDeclaration' && n.id.name === name);
  assert(node, 'Missing production function ' + name);
  return source.slice(node.start, node.end);
}

function harness() {
  const state = {
    users: { member: { walletBalance: 0, totalEarned: 0, status: 'active' } },
    investments: { inv1: { userId: 'member', status: 'active', payoutsTotal: 2, payoutsMade: 0,
      expectedReturn: 2000, paidOut: 0, createdAt: new Date(Date.now() - 3 * 86400000), tierLabel: 'Asset' } },
    transactions: {},
    crashAfterWalletWrite: true,
  };
  function apply(row, patch) {
    for (const [key, value] of Object.entries(patch)) {
      if (value?.op === 'inc') row[key] = (row[key] || 0) + value.n;
      else if (value?.op === 'union') row[key] = [...new Set([...(row[key] || []), ...value.items])];
      else row[key] = structuredClone(value);
    }
  }
  function snapshot(col, id) {
    const row = state[col]?.[id];
    const frozen = row && structuredClone(row);
    return { id, exists: !!row, data: () => structuredClone(frozen), ref: ref(col, id) };
  }
  function ref(col, id) {
    return {
      id,
      get: async () => snapshot(col, id),
      update: async patch => {
        assert(state[col]?.[id], `missing ${col}/${id}`);
        apply(state[col][id], patch);
      },
      updateIf: async (filter, patch) => {
        const row = state[col]?.[id];
        if (!row || !Object.entries(filter).every(([key, value]) => {
          if (value && '$ne' in Object(value)) return Array.isArray(row[key]) ? !row[key].includes(value.$ne) : row[key] !== value.$ne;
          return row[key] === value;
        })) return false;
        apply(row, patch);
        if (col === 'users' && state.crashAfterWalletWrite && patch.creditedPayoutKeys) {
          state.crashAfterWalletWrite = false;
          throw new Error('SIMULATED_PROCESS_CRASH_AFTER_WALLET_WRITE');
        }
        return true;
      },
      createIfAbsent: async data => {
        state[col] ||= {};
        if (state[col][id]) return false;
        state[col][id] = {};
        apply(state[col][id], data);
        return true;
      },
    };
  }
  function query(col, filters = [], limit = Infinity) {
    return {
      where: (key, op, value) => query(col, [...filters, [key, op, value]], limit),
      orderBy: () => query(col, filters, limit),
      limit: n => query(col, filters, n),
      doc: id => ref(col, id),
      add: async data => { const id = 'tx' + Object.keys(state.transactions).length; await ref(col, id).createIfAbsent(data); return ref(col, id); },
      get: async () => {
        const docs = Object.entries(state[col] || {}).filter(([, row]) => filters.every(([key, op, value]) => op === '==' ? row[key] === value : true))
          .slice(0, limit).map(([id]) => snapshot(col, id));
        return { docs, empty: !docs.length };
      },
    };
  }
  const db = { collection: col => query(col) };
  const c = vm.createContext({ db, console: { error() {}, warn() {} }, Date,
    FieldValue: { increment: n => ({ op: 'inc', n }), arrayUnion: (...items) => ({ op: 'union', items }), serverTimestamp: () => new Date() },
    tsMillis: value => value instanceof Date ? value.getTime() : Date.parse(value),
    nowStr: () => ({ date: '2026-10-06', time: '13:00' }), newStatementId: () => 'statement',
    tzOffMs: () => 10800000, CASHBACK_PARALLEL: 8, setImmediate, withLock: async (_key, work) => work(), _creditingPayouts: new Set(), _sweepingCashback: false, _lastFullCashbackSweep: 0,
  });
  vm.runInContext([fn('eatNextMidnight'), fn('payoutDueAtMs'), fn('payoutsDueCount'), fn('investmentMaturityMs'), fn('settleInvestmentIfDue'), fn('_settleDueInvestmentNow'), fn('settleMany'), fn('reconcileCashback')].join('\n'), c);
  return { state, c };
}

async function main() {
  // Locked cashback: the whole cashback is ONE payment at maturity (here: both days have passed). A crash right after the wallet write is retried
  // under the same token and never pays twice.
  const { state, c } = harness();
  await assert.rejects(c.settleInvestmentIfDue(await c.db.collection('investments').doc('inv1').get()), /SIMULATED_PROCESS_CRASH_AFTER_WALLET_WRITE/);
  assert.equal(state.investments.inv1.status, 'active', 'the investment is still retryable after the crash');
  assert.equal(state.users.member.walletBalance, 2000, 'the atomic credit of the WHOLE cashback landed before the process stopped');
  await c.reconcileCashback();
  assert.equal(state.investments.inv1.status, 'matured', 'the reconciler finishes the product on retry');
  assert.equal(state.users.member.walletBalance, 2000, 'the retry does not double-credit');
  assert.equal(Object.keys(state.transactions).length, 1, 'one durable cashback ledger row, at maturity');
  assert.equal(state.investments.inv1.paidOut, 2000, 'the product records the full payout');
  // Before maturity nothing is paid, however many days have passed.
  const h2 = harness(); h2.state.crashAfterWalletWrite = false;
  h2.state.investments.inv1.payoutsTotal = 5; h2.state.investments.inv1.createdAt = new Date(Date.now() - 2 * 86400000);   // 5-day product, 2 days in
  await h2.c.reconcileCashback(); await h2.c.settleInvestmentIfDue(await h2.c.db.collection('investments').doc('inv1').get());
  assert.equal(h2.state.users.member.walletBalance, 0, 'a running product pays nothing before its last day');
  assert.equal(h2.state.investments.inv1.status, 'active');
  assert.equal(Object.keys(h2.state.transactions).length, 0, 'and writes no cashback row');
  // A product that an older daily-paying version had already paid 750 of gets only the remainder at maturity.
  const h3 = harness(); h3.state.crashAfterWalletWrite = false;
  h3.state.investments.inv1.paidOut = 750; h3.state.investments.inv1.payoutsMade = 1; h3.state.users.member.walletBalance = 750;
  await h3.c.settleInvestmentIfDue(await h3.c.db.collection('investments').doc('inv1').get());
  assert.equal(h3.state.users.member.walletBalance, 2000, 'the carried-over product receives expectedReturn minus what was already paid');
  assert.equal(h3.state.investments.inv1.status, 'matured');
  // The closing time is the purchase time plus the cycle's days, NOT midnight: a product bought 2 days minus 1 minute ago (5-day product bought
  // at 14:35, now 2 d 13 h later...) -- here a 2-day product bought 47 h 59 min ago is not paid, one bought 48 h 1 min ago is.
  const h4 = harness(); h4.state.crashAfterWalletWrite = false;
  h4.state.investments.inv1.createdAt = new Date(Date.now() - (2 * 86400000 - 60000));
  await h4.c.settleInvestmentIfDue(await h4.c.db.collection('investments').doc('inv1').get());
  assert.equal(h4.state.users.member.walletBalance, 0, '1 minute before its closing time nothing is paid, even if a midnight has passed');
  h4.state.investments.inv1.createdAt = new Date(Date.now() - (2 * 86400000 + 60000));
  await h4.c.settleInvestmentIfDue(await h4.c.db.collection('investments').doc('inv1').get());
  assert.equal(h4.state.users.member.walletBalance, 2000, '1 minute after its closing time the whole cashback is paid');
  console.log('PASS: locked cashback is paid once at maturity, never before; crash retry does not double-credit; carried-over daily products get the remainder');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
