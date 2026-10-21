'use strict';
// Account ids are random, server-issued, five digits like 57356 (six only if the five-digit pool is used up), and never repeat.
const fs = require('fs'), vm = require('vm'), crypto = require('crypto'), assert = require('assert');
const acorn = require('acorn');
const src = fs.readFileSync(__dirname + '/server.js', 'utf8');
const tree = acorn.parse(src, { ecmaVersion: 'latest' });
const fn = name => { const n = tree.body.find(x => x.type === 'FunctionDeclaration' && x.id.name === name); assert(n, 'missing ' + name); return src.slice(n.start, n.end); };
let k = 0; const ok = (c, m) => { k++; if (!c) { console.error('FAIL: ' + m); process.exit(1); } };

// source rules
ok(/const PUBLIC_ID_DIGITS = 5;/.test(src), 'five digits');
ok(!/nextSequentialPublicId/.test(src), 'the sequential counter is gone');
ok(/crypto\.randomInt\(10000, 100000\)/.test(src) && !/Math\.random/.test(fn('nextRandomPublicId')), 'ids come from the secure random generator, never Math.random');
ok(/nextRandomPublicId\(\)\]\)/.test(src), 'registration asks the server allocator for the id (nothing from the phone)');
ok(!/publicId:\s*(req|body)/.test(src) && !/req\.body\.publicId/.test(src), 'no route lets a client choose its id');

// behaviour, with a mock database
function setup(usersHolding) {
  const claimed = new Set(), users = new Set(usersHolding || []);
  const db = { collection: name => ({
    where: (f, op, v) => ({ limit: () => ({ get: async () => ({ empty: !(name === 'users' && users.has(v)) }) }) }),
    doc: id => ({ createIfAbsent: async () => { if (name !== 'publicIds') throw new Error('wrong collection'); if (claimed.has(id)) return false; claimed.add(id); return true; } }),
  }) };
  const tails = new Map();
  const withLock = (key, f) => { const prev = tails.get(key) || Promise.resolve(); const next = prev.then(f, f); tails.set(key, next.catch(() => {})); return next; };
  const c = vm.createContext({ crypto, db, FieldValue: { serverTimestamp: () => new Date() }, withLock, Set });
  vm.runInContext('const PUBLIC_ID_DIGITS = 5;\n' + fn('nextRandomPublicId'), c);
  return { c, claimed, users };
}
(async () => {
  {
    const { c, claimed } = setup();
    const ids = await Promise.all(Array.from({ length: 3000 }, () => c.nextRandomPublicId()));
    ok(ids.every(i => /^[1-9]\d{4}$/.test(i)), 'every id is five digits with no leading zero (like 57356)');
    ok(new Set(ids).size === ids.length && claimed.size === ids.length, '3,000 sign-ups at the same instant: no two ids are the same');
    ok(new Set(ids.map(i => i[0])).size >= 8 && new Set(ids.map(i => i[4])).size >= 8, 'the ids are spread out, not counting up');
    const sorted = [...ids].map(Number); let ascending = 0; for (let i = 1; i < sorted.length; i++) if (sorted[i] > sorted[i - 1]) ascending++;
    ok(ascending > 1200 && ascending < 1800, 'and in no order (' + ascending + ' of ' + (ids.length - 1) + ' steps go up)');
  }
  {
    // an id an existing member already holds (an account numbered under the old rule) is never issued again
    const held = Array.from({ length: 5000 }, (_, i) => String(10000 + i));
    const { c } = setup(held);
    const ids = await Promise.all(Array.from({ length: 800 }, () => c.nextRandomPublicId()));
    ok(ids.every(i => !held.includes(i)), 'no id an existing member holds is issued');
  }
  {
    // the five-digit pool used up: sign-ups still work, with six digits
    const all = Array.from({ length: 90000 }, (_, i) => String(10000 + i));
    const { c } = setup(all);
    const id = await c.nextRandomPublicId();
    ok(/^[1-9]\d{5}$/.test(id), 'when every five-digit id is taken the next id has six digits (' + id + ')');
  }
  console.log('PASS: random account ids, unique, server-side (' + k + ' checks)');
})().catch(e => { console.error(e); process.exit(1); });
