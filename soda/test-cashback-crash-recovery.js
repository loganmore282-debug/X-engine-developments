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
    tzOffMs: () => 10800000, withLock: async (_key, work) => work(), _creditingPayouts: new Set(), _sweepingCashback: false, _lastFullCashbackSweep: 0,
  });
  vm.runInContext([fn('eatNextMidnight'), fn('payoutDueAtMs'), fn('payoutsDueCount'), fn('settleInvestmentIfDue'), fn('_settleDueInvestmentNow'), fn('reconcileCashback')].join('\n'), c);
  return { state, c };
}

async function main() {
  const { state, c } = harness();
  await assert.rejects(c.settleInvestmentIfDue(await c.db.collection('investments').doc('inv1').get()), /SIMULATED_PROCESS_CRASH_AFTER_WALLET_WRITE/);
  assert.equal(state.investments.inv1.status, 'active', 'the payout cursor is still retryable');
  assert.equal(state.users.member.walletBalance, 2000, 'the atomic wallet credit landed before the process stopped');
  await c.reconcileCashback();
  assert.equal(state.investments.inv1.status, 'matured', 'the reconciler advances the cursor on retry');
  assert.equal(state.users.member.walletBalance, 2000, 'the retry does not double-credit the wallet');
  assert.equal(Object.keys(state.transactions).length, 1, 'the retry creates one durable cashback ledger row');
  console.log('PASS: crash after wallet credit is retried once; maturity and ledger recover without a duplicate credit');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
