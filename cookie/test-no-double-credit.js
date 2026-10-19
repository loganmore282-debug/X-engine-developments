'use strict';
// No double crediting: the real registration code runs with many requests at once (and with a crash in the middle) on an in-memory database.
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
  vm.runInContext('const _lockTails = new Map(); const DEFAULT_REGION_KEY = "ug"; const REFERRAL_CHARS = "abcdefghjkmnpqrstuvwxyz23456789"; const REFERRAL_LENGTH = 8; const PUBLIC_ID_DIGITS = 5; const GIFTCODE_LENGTH = 12, GIFTCODE_GROUP_LEN = 4;\n' +
    ['withLock', 'finiteMoney', 'randFromAlphabet', 'randCode', 'findUserByReferralCode', 'generateUniqueReferralCode', 'nextSequentialPublicId', 'defaultProfileDoc', 'completeRegistrationCore'].map(fn).join('\n'), ctx);
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
  // 2. gift codes and the Task Center are gone: nothing can be claimed by calling their old addresses
  { const src = fs.readFileSync(__dirname + '/server.js', 'utf8'); assert.ok(!/app\.post\('\/redeem'/.test(src) && !/app\.post\('\/team\/task\/claim'/.test(src) && !/\/admin\/promocodes|\/admin\/tasks/.test(src), 'no gift code / Task Center route'); }
  console.log('PASS: no double crediting (registration, referral counts and codes; no gift code or Task Center route)');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
