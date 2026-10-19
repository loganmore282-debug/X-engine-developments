'use strict';
// No double crediting: the real registration, gift-code and Task Center routes run with many requests at once (and with a crash in the middle) on an in-memory database.
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
function route(path) {
  const node = tree.body.find(n => n.type === 'ExpressionStatement' && n.expression.type === 'CallExpression'
    && n.expression.callee.object?.name === 'app' && n.expression.arguments[0]?.value === path);
  assert(node, 'Missing route ' + path);
  return source.slice(node.start, node.end);
}
const tick = () => new Promise(r => setImmediate(r));
function database(seed) {
  const rows = structuredClone(seed), faults = [];
  let serial = 0;
  const fail = (col, id, patch) => {
    const at = faults.findIndex(f => f(col, id, patch));
    if (at >= 0) { faults.splice(at, 1); throw new Error('Injected storage failure'); }
  };
  function apply(row, patch) {
    for (const [key, value] of Object.entries(patch)) {
      if (value?.op === 'inc') row[key] = (row[key] || 0) + value.n;
      else if (value?.op === 'union') row[key] = [...new Set([...(row[key] || []), ...value.items])];
      else if (value?.op === 'remove') row[key] = (row[key] || []).filter(x => !value.items.includes(x));
      else if (value?.op === 'delete') { if (key.includes('.')) { const [a, b] = key.split('.'); if (row[a]) delete row[a][b]; } else delete row[key]; }
      else if (key.includes('.')) { const [a, b] = key.split('.'); row[a] ||= {}; row[a][b] = structuredClone(value); }
      else row[key] = value instanceof Date ? value : structuredClone(value);
    }
  }
  function snapshot(col, id) {
    const value = rows[col]?.[id] && structuredClone(rows[col][id]);
    return { id, exists: !!value, data: () => structuredClone(value), ref: ref(col, id) };
  }
  function ref(col, id) {
    return { id, get: async () => { await tick(); return snapshot(col, id); },
      update: async patch => { await tick(); fail(col, id, patch); assert(rows[col]?.[id]); apply(rows[col][id], patch); },
      updateIf: async (filter, patch) => {
        await tick(); fail(col, id, patch);
        const row = rows[col]?.[id];
        if (!row || !Object.entries(filter).every(([k,v]) => v && '$ne' in Object(v)
          ? (Array.isArray(row[k]) ? !row[k].includes(v.$ne) : row[k] !== v.$ne) : row[k] === v)) return false;
        apply(row, patch); return true;
      },
      createIfAbsent: async data => { await tick(); fail(col, id, data); rows[col] ||= {}; if (rows[col][id]) return false; rows[col][id] = {}; apply(rows[col][id], data); return true; },
      set: async data => { fail(col, id, data); rows[col] ||= {}; rows[col][id] = {}; apply(rows[col][id], data); },
      delete: async () => { delete rows[col]?.[id]; }
    };
  }
  function query(col, filters = [], limit = Infinity) {
    return { where: (key, op, value) => query(col, [...filters, [key, op, value]], limit),
      limit: n => query(col, filters, n), orderBy: () => query(col, filters, limit),
      doc: id => ref(col, id || 'generated-' + ++serial),
      add: async data => { const r = ref(col, 'generated-' + ++serial); await r.set(data); return r; },
      get: async () => {
        const docs = Object.entries(rows[col] || {}).filter(([,r]) => filters.every(([k,op,v]) => {
          if (op === '==') return r[k] === v;
          if (op === 'in' && Array.isArray(v)) return v.includes(r[k]);
          if (op === '!=') return r[k] !== v;
          if (op === 'in') return v.includes(r[k]);
          throw new Error('Unknown mock operator ' + op);
        })).slice(0, limit).map(([id]) => snapshot(col,id));
        await tick();
        return { docs, empty: !docs.length, size: docs.length, forEach: cb => docs.forEach(cb) };
      }
    };
  }
  return { rows, faults, collection: col => query(col) };
}


const FIELD = { increment: n => ({ op: 'inc', n }), arrayUnion: (...items) => ({ op: 'union', items }), arrayRemove: (...items) => ({ op: 'remove', items }), delete: () => ({ op: 'delete' }), serverTimestamp: () => new Date() };
function response() { return { code: 200, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } }; }
const ZERO = { welcomeBonus: 7000, taskReferrals: [{ id: 'r1', target: 2, reward: 10000 }], taskDeposits: [{ id: 'd1', target: 100000, reward: 5000 }] };
function make(seed, settings = ZERO) {
  const db = database(seed); let serial = 0; const routes = {};
  const ctx = vm.createContext({ db, console: { log() {}, warn() {}, error() {} }, FieldValue: FIELD, crypto: require('node:crypto'), Date, Math, Number, String, Set, Map, Array, Object, Promise, JSON,
    tsMillis: v => v instanceof Date ? v.getTime() : Number(v) || 0, round2: n => Math.round((Number(n) || 0) * 100) / 100, nowStr: () => ({ date: 'd', time: 't' }), newStatementId: () => 's' + ++serial,
    verifyAuth: async req => req.uid, logSecurityEvent() {}, fmtMoney: n => 'UGX ' + n, getSettings: async () => settings, textOf: v => typeof v === 'string' ? v : '',
    currentRegionKey: () => 'ug', verifyAuthWithEmail: async req => ({ uid: req.uid, phone: req.phone }), badPhoneMessage: () => 'bad', app: { post: (p, h) => { routes[p] = h; }, get() {} } });
  vm.runInContext('const _lockTails = new Map(); const DEFAULT_REGION_KEY = "ug"; const REFERRAL_CHARS = "abcdefghjkmnpqrstuvwxyz23456789"; const REFERRAL_LENGTH = 8; const PUBLIC_ID_DIGITS = 5; const GIFTCODE_LENGTH = 12, GIFTCODE_GROUP_LEN = 4; const TASK_MAX_ROWS = 30, TASK_MAX_REFERRALS = 100000; const MAX_MONEY_AMOUNT = 999999999;\n' +
    ['withLock', 'finiteMoney', 'randFromAlphabet', 'randCode', 'findUserByReferralCode', 'generateUniqueReferralCode', 'nextSequentialPublicId', 'defaultProfileDoc', 'completeRegistrationCore', 'sanitizeTaskRows', 'taskRows', 'activeL1Count', 'wholeTeamStats'].map(fn).join('\n') + '\n' + route('/redeem') + '\n' + route('/team/task/claim'), ctx);
  const call = (path, uid, body = {}) => { const res = response(); return routes[path]({ uid, body, headers: {} }, res).then(() => res); };
  return { db, ctx, call, reg: (uid, phone, code) => ctx.completeRegistrationCore(uid, code, phone) };
}
const tx = (db, type) => Object.values(db.rows.transactions || {}).filter(t => t.type === type);
async function main() {
  // 1. REGISTRATION: the same sign-up sent 6 times at once pays the welcome gift once, counts the referrer once, and codes / account numbers are unique
  {
    const { db, reg } = make({ users: {} });
    await Promise.all(Array.from({ length: 6 }, () => reg('a', '0700000001', '')));
    const A = db.rows.users.a;
    assert.equal(A.walletBalance, 7000, 'welcome gift paid once'); assert.equal(tx(db, 'welcome_bonus').length, 1, 'one welcome row'); assert.equal(A.registrationDone, true);
    // a chain: b under a, c under b, d under c; each registered 5 times at once
    for (const [id, ph, up] of [['b', '0700000002', 'a'], ['c', '0700000003', 'b'], ['d', '0700000004', 'c']])
      await Promise.all(Array.from({ length: 5 }, () => reg(id, ph, db.rows.users[up].referralCode)));
    assert.deepEqual([db.rows.users.a.teamL1Count, db.rows.users.a.teamL2Count, db.rows.users.a.teamL3Count], [1, 1, 1], 'each level is counted once for a');
    assert.deepEqual([db.rows.users.b.teamL1Count, db.rows.users.b.teamL2Count, db.rows.users.b.teamL3Count], [1, 1, 0]);
    assert.deepEqual([db.rows.users.c.teamL1Count, db.rows.users.c.teamL2Count, db.rows.users.c.teamL3Count], [1, 0, 0]);
    for (const id of 'abcd') assert.equal(db.rows.users[id].walletBalance, 7000, id + ' got the welcome gift once');
    assert.equal(tx(db, 'welcome_bonus').length, 4);
    assert.equal(db.rows.users.b.referredBy, 'a'); assert.equal(db.rows.users.d.referredBy, 'c');
    const codes = 'abcd'.split('').map(i => db.rows.users[i].referralCode), ids = 'abcd'.split('').map(i => db.rows.users[i].publicId);
    assert.equal(new Set(codes).size, 4, 'referral codes are unique'); assert.equal(new Set(ids).size, 4, 'account numbers are unique');
    assert.ok(codes.every(c => /^[a-hj-km-np-z2-9]{8}$/.test(c)), 'codes are 8 plain characters');
    // typing a code in capitals still finds the owner; an unknown code, your own code, and a banned referrer's code are refused
    const up = make({ users: { x: { registrationDone: true, referralCode: 'abcd2345', referralCodeLower: 'abcd2345', status: 'active', walletBalance: 0 }, z: { registrationDone: true, referralCode: 'zzzz2222', referralCodeLower: 'zzzz2222', status: 'banned', walletBalance: 0 } } });
    assert.equal((await up.reg('n1', '0700000011', 'ABCD2345')).body.status, 'success'); assert.equal(up.db.rows.users.n1.referredBy, 'x');
    assert.equal((await up.reg('n2', '0700000012', 'nope9999')).body.code, 'BAD_REFERRAL');
    assert.equal((await up.reg('n3', '0700000013', 'zzzz2222')).body.code, 'BAD_REFERRAL', 'a banned referrer\'s code is refused');
    const own = await up.reg('n1', '0700000011', up.db.rows.users.n1.referralCode); assert.equal(own.body.status, 'already_done', 'registering again pays nothing');
    assert.equal(up.db.rows.users.n1.walletBalance, 7000);
    // two members registering at the same moment under one referrer: the count is exactly 2, not 1 and not 3
    const both = make({ users: { r: { registrationDone: true, referralCode: 'rrrr2222', referralCodeLower: 'rrrr2222', status: 'active', walletBalance: 0, teamL1Count: 0, teamL2Count: 0, teamL3Count: 0 } } });
    await Promise.all(['p1', 'p2', 'p3', 'p4'].flatMap((u, i) => Array.from({ length: 3 }, () => both.reg(u, '07000001' + i, 'rrrr2222'))));
    assert.equal(both.db.rows.users.r.teamL1Count, 4, 'four members, counted four times, however many times each request arrived');
    assert.equal(new Set(['p1', 'p2', 'p3', 'p4'].map(u => both.db.rows.users[u].publicId)).size, 4);
  }
  // 2. GIFT CODES: one claim per member, however many taps; the usage limit holds when many members claim at once; a crash in the middle pays once on retry
  {
    const code = { code: 'abcd-efgh-jkmn', codeLower: 'abcd-efgh-jkmn', active: true, minReward: 1000, maxReward: 1000, usedBy: [] };
    const seed = () => ({ users: { u1: { walletBalance: 0, status: 'active', registrationDone: true }, u2: { walletBalance: 0, status: 'active', registrationDone: true }, u3: { walletBalance: 0, status: 'active', registrationDone: true }, u4: { walletBalance: 0, status: 'active', registrationDone: true }, u5: { walletBalance: 0, status: 'active', registrationDone: true } }, promoCodes: { c1: structuredClone(code) } });
    { const { db, call } = make(seed());
      const rs = await Promise.all(Array.from({ length: 8 }, () => call('/redeem', 'u1', { code: 'ABCD-EFGH-JKMN' })));
      assert.equal(rs.filter(r => r.code === 200).length, 1, 'only one tap pays'); assert.equal(db.rows.users.u1.walletBalance, 1000, 'paid once'); assert.equal(tx(db, 'promocode').length, 1);
      const again = await call('/redeem', 'u1', { code: 'abcdefghjkmn' }); assert.equal(again.code, 400); assert.equal(db.rows.users.u1.walletBalance, 1000, 'typing it again (no dashes) pays nothing'); }
    { const s = seed(); s.promoCodes.c1.maxUses = 2; const { db, call } = make(s);
      const rs = await Promise.all(['u1', 'u2', 'u3', 'u4', 'u5'].flatMap(u => [call('/redeem', u, { code: 'abcd-efgh-jkmn' }), call('/redeem', u, { code: 'abcd-efgh-jkmn' })]));
      const paid = ['u1', 'u2', 'u3', 'u4', 'u5'].filter(u => db.rows.users[u].walletBalance > 0);
      assert.equal(paid.length, 2, 'the usage limit of 2 holds when five members claim at once'); assert.ok(paid.every(u => db.rows.users[u].walletBalance === 1000)); assert.equal(tx(db, 'promocode').length, 2); }
    { const { db, call } = make(seed());
      db.faults.push((col, id, patch) => col === 'users' && id === 'u1' && patch.redeemedGiftCodeIds);   // dies right before the wallet credit
      const bad = await call('/redeem', 'u1', { code: 'abcd-efgh-jkmn' }); assert.equal(bad.code, 500); assert.equal(db.rows.users.u1.walletBalance, 0, 'nothing was credited by the failed attempt');
      const retry = await Promise.all([call('/redeem', 'u1', { code: 'abcd-efgh-jkmn' }), call('/redeem', 'u1', { code: 'abcd-efgh-jkmn' })]);
      assert.equal(db.rows.users.u1.walletBalance, 1000, 'the retry pays exactly once'); assert.equal(tx(db, 'promocode').length, 1);
      assert.equal(retry.filter(r => r.code === 200).length, 1); }
  }
  // 3. TASK CENTER: a task reward is paid once however many taps, and the ledger has one row
  {
    const seed = { users: { m: { walletBalance: 0, totalEarned: 0, status: 'active' }, k1: { referredBy: 'm', status: 'active', totalDeposited: 30000 }, k2: { referredBy: 'm', status: 'active', totalDeposited: 5000 }, k3: { referredBy: 'm', status: 'banned', totalDeposited: 9000 } } };
    const { db, call } = make(seed);
    const rs = await Promise.all(Array.from({ length: 7 }, () => call('/team/task/claim', 'm', { type: 'count', id: 'r1' })));
    assert.equal(rs.filter(r => r.code === 200).length, 1, 'one claim pays ' + JSON.stringify(rs.map(r => [r.code, r.body && r.body.message]))); assert.equal(db.rows.users.m.walletBalance, 10000); assert.equal(tx(db, 'team_reward').length, 1);
    const dep = await call('/team/task/claim', 'm', { type: 'deposit', id: 'd1' }); assert.equal(dep.code, 400, 'not reached yet: 35,000 of 100,000 (a banned member does not count)');
    db.rows.users.k1.totalDeposited = 100000; const d2 = await Promise.all([call('/team/task/claim', 'm', { type: 'deposit', id: 'd1' }), call('/team/task/claim', 'm', { type: 'deposit', id: 'd1' })]);
    assert.equal(d2.filter(r => r.code === 200).length, 1); assert.equal(db.rows.users.m.walletBalance, 15000); assert.equal(tx(db, 'team_reward').length, 2);
    const fail = make(seed); fail.db.faults.push((col, id) => col === 'transactions');   // the history row fails once: money paid once, row repaired
    const f1 = await fail.call('/team/task/claim', 'm', { type: 'count', id: 'r1' }); assert.equal(f1.code, 200); assert.equal(fail.db.rows.users.m.walletBalance, 10000); assert.equal(tx(fail.db, 'team_reward').length, 1, 'the row is repaired at once');
    const f2 = await fail.call('/team/task/claim', 'm', { type: 'count', id: 'r1' }); assert.equal(f2.code, 409); assert.equal(fail.db.rows.users.m.walletBalance, 10000);
  }
  console.log('PASS: no double crediting (registration, referral counts and codes, gift codes, Task Center rewards)');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
