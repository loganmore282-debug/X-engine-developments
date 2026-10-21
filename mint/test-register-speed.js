'use strict';
// Sign-up speed: the Trade Password hash, the member's own referral code / account number and the referrer's look-up run TOGETHER, and a sign-up that
// is refused gives its claimed account number back. Runs the real completeRegistrationCore against a mock database.
const fs = require('fs'), vm = require('vm'), assert = require('assert'), acorn = require('acorn');
const src = fs.readFileSync(__dirname + '/server.js', 'utf8');
const tree = acorn.parse(src, { ecmaVersion: 'latest' });
const fn = name => { const n = tree.body.find(x => x.type === 'FunctionDeclaration' && x.id.name === name); assert(n, 'missing ' + name); return src.slice(n.start, n.end); };
let k = 0; const ok = (c, m) => { k++; if (!c) { console.error('FAIL: ' + m); process.exit(1); } };
const order = [];
function setup(users, publicIds) {
  const rows = { users: structuredClone(users), transactions: {}, publicIds: structuredClone(publicIds || {}) };
  const apply = (row, patch) => { for (const [kk, v] of Object.entries(patch)) row[kk] = (v && v.op === 'inc') ? (row[kk] || 0) + v.n : v; };
  const ref = (col, id) => ({ id, get: async () => ({ id, exists: !!(rows[col] && rows[col][id]), data: () => structuredClone(rows[col][id]) }),
    set: async d => { rows[col] ||= {}; rows[col][id] = structuredClone(d); }, update: async p => { apply(rows[col][id], p); },
    createIfAbsent: async d => { rows[col] ||= {}; if (rows[col][id]) return false; rows[col][id] = structuredClone(d); return true; },
    delete: async () => { delete rows[col][id]; } });
  const q = (col, f = []) => ({ where: (a, b, v) => q(col, [...f, [a, v]]), limit: () => q(col, f),
    get: async () => { const docs = Object.entries(rows[col] || {}).filter(([, r]) => f.every(([a, v]) => r[a] === v)).map(([id, r]) => ({ id, data: () => structuredClone(r), ref: ref(col, id) })); return { docs, empty: !docs.length }; } });
  const db = { collection: c => Object.assign(q(c), { doc: id => ref(c, id) }) };
  const tails = new Map(); const withLock = (key, f) => { const p = tails.get(key) || Promise.resolve(); const nx = p.then(f, f); tails.set(key, nx.catch(() => {})); return nx; };
  const c = vm.createContext({ db, rows, crypto: require('crypto'), FieldValue: { increment: n => ({ op: 'inc', n }), serverTimestamp: () => new Date() }, withLock, Set,
    defaultProfileDoc: phone => ({ phone, walletBalance: 0, registrationDone: false, status: 'active' }), DEFAULT_REGION_KEY: 'ug', getSettings: async () => ({ welcomeBonus: 7000 }),
    nowStr: () => ({ date: '2026-10-21', time: '10:00' }), newStatementId: () => 's1', _anyMemberExists: false, console,
    scryptHashAsync: async pin => { order.push('hash'); await new Promise(r => setTimeout(r, 30)); return 'h:' + pin; },
    generateUniqueReferralCode: async () => { order.push('refcode'); await new Promise(r => setTimeout(r, 10)); return 'ABCDE'; },
    findUserByReferralCode: async code => { order.push('lookup'); const e = Object.entries(rows.users).find(([, u]) => u.referralCode === code); return e ? { id: e[0], data: () => e[1] } : null; } });
  vm.runInContext(fn('nextRandomPublicId') + '\n' + fn('completeRegistrationCore'), c);
  return { c, rows };
}
(async () => {
  {
    const { c, rows } = setup({ ref1: { referralCode: 'XYZ12', walletBalance: 0, status: 'active' } });
    order.length = 0; const t0 = Date.now();
    const r = await c.completeRegistrationCore('new1', 'XYZ12', '123456', '256700000001');
    ok(r.code === 200 && r.body.status === 'success', 'a valid sign-up succeeds');
    ok(order.slice(0, 3).sort().join() === 'hash,lookup,refcode', 'the hash, the referral-code look-up and the member\'s own code all start before any of them finishes (' + order.join(',') + ')');
    ok(rows.users.new1.transactionPinHash === 'h:123456' && rows.users.new1.referralCode === 'ABCDE' && /^[1-9]\d{4}$/.test(rows.users.new1.publicId), 'the member gets the hash, their own code and a random account number');
    ok(rows.users.new1.walletBalance === 7000 && rows.users.new1.referredBy === 'ref1', 'welcome gift and the referrer are recorded');
    ok(Object.keys(rows.publicIds).length === 1, 'one account number claimed');
  }
  {
    const { c, rows } = setup({});
    const r = await c.completeRegistrationCore('new2', 'NOSUCH', '123456', '256700000002');
    ok(r.code === 400 && r.body.code === 'BAD_REFERRAL', 'an unknown referral code is refused');
    await new Promise(r => setTimeout(r, 80));
    ok(Object.keys(rows.publicIds).length === 0, 'and the account number it claimed is given back');
    ok(!rows.users.new2.registrationDone, 'the member is not marked as registered');
  }
  console.log('PASS: sign-up runs its slow steps together and gives back a refused sign-up\'s account number (' + k + ' checks)');
})().catch(e => { console.error(e); process.exit(1); });
