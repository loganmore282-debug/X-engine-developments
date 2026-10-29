'use strict';
// A treasure code made "only for members who have bought a product" is refused to everyone else, before anything is claimed.
const fs = require('node:fs'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const server = fs.readFileSync(__dirname + '/server.js', 'utf8'), admin = fs.readFileSync(__dirname + '/admin-src/index.html', 'utf8');
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); };
const start = server.indexOf("app.post('/redeem'");
const end = server.indexOf("\napp.", start + 20);
const routeSrc = server.slice(start, end);
function run(user, code, opts = {}) {
  let handler = null; const writes = [], looked = [];
  const app = { post: (p, h) => { handler = h; } };
  const snap = (id, data) => ({ id, exists: !!data, data: () => data, ref: { update: async p => writes.push(['update', id, p]), id } });
  const db = { collection: col => ({
    doc: id => ({ get: async () => snap(id, col === 'users' ? user : null), update: async p => writes.push([col, id, p]), set: async p => writes.push([col, id, p]) }),
    where: (k, op, v) => ({ where: () => ({ limit: () => ({ get: async () => ({ empty: true, docs: [] }) }) }), limit: () => ({ get: async () => { if (col === 'promoCodes') looked.push(v); return col === 'promoCodes' && (!opts.only || v === opts.only) ? { empty: false, docs: [snap('c1', code)] } : { empty: true, docs: [] }; } }) }),
  }) };
  new Function('app', 'verifyAuth', 'db', 'withLock', 'round2', 'logSecurityEvent', 'GIFTCODE_LENGTH', 'GIFTCODE_GROUP_LEN', 'tsMillis', 'crypto', 'FieldValue', 'console', 'treasureKeyLockedOut', 'noteWrongTreasureKey', 'TREASURE_CODE_LENGTH', 'tcHash', routeSrc)(
    app, async () => 'u1', db, (_k, fn) => fn(), n => Math.round(n * 100) / 100, () => {}, 12, 4, v => v instanceof Date ? v.getTime() : Date.parse(v), crypto, { increment: x => x, arrayUnion: (...a) => a, serverTimestamp: () => 0 }, { error() {}, warn() {}, log() {} }, () => !!opts.locked, () => {}, 10, v => crypto.createHash('sha256').update('chocolate-tc|' + v).digest('hex'));
  return async () => { let status = 200, body = null; const res = { status(c) { status = c; return this; }, json(b) { body = b; return this; } };
    await handler({ headers: {}, body: { code: opts.typed || 'ABCD-EFGH-JKLM' } }, res); return { status, body, writes, looked }; };
}
(async () => {
  const base = { code: 'ABCD-EFGH-JKLM', codeLower: 'abcd-efgh-jklm', minReward: 100, maxReward: 100, active: true, usedBy: [] };
  const member = extra => Object.assign({ status: 'active', registrationDone: true, totalInvested: 0 }, extra);
  let r = await run(member(), Object.assign({}, base, { buyersOnly: true }))();
  ok(r.status === 403 && r.body.code === 'BUYERS_ONLY' && /bought a product/.test(r.body.message), 'a member who has not bought a product is refused a buyers-only code');
  ok(r.writes.length === 0, 'and nothing is claimed or written, so the code is still free after their first purchase');
  r = await run(member({ totalInvested: 37700 }), Object.assign({}, base, { buyersOnly: true }))();
  ok(!(r.body && r.body.code === 'BUYERS_ONLY'), 'a member who has bought a product is not stopped by the buyers-only rule');
  r = await run(member(), base)();
  ok(!(r.body && r.body.code === 'BUYERS_ONLY'), 'an ordinary code is still claimable by anyone');
  // The 10-character code: typed in any case, with stray dashes or spaces, it is found by its hash (never by the plain text).
  const hash = crypto.createHash('sha256').update('chocolate-tc|HPDABM8C5L').digest('hex');
  r = await run(member(), Object.assign({}, base, { codeLower: hash, buyersOnly: false }), { typed: 'hpdab-m8c5l', only: hash })();
  ok(r.looked[0] === hash && !(r.body && r.body.message === 'Wrong treasure chest password'), 'a 10-character code is looked up by its SHA-256, whatever case or dashes were typed');
  r = await run(member(), base, { typed: 'ZZZZZZZZZZ', only: 'nothing-matches' })();
  ok(r.status === 400 && r.body.message === 'Wrong treasure chest password', 'a wrong key is refused with the owner\'s wording');
  r = await run(member(), base, { locked: true })();
  ok(r.status === 429 && r.body.code === 'TOO_MANY_WRONG_KEYS', 'after too many wrong keys the chest refuses everything for a while');
  // wiring
  ok(/const buyersOnly = req\.body\.buyersOnly === true;/.test(server) && /usedBy: \[\], active: true, buyersOnly,/.test(server) && /buyersOnly: c\.buyersOnly === true,/.test(server), 'the server stores and lists the flag');
  ok(/id="cWho"/.test(admin) && /value="buyers">Only members who have bought a product/.test(admin) && /buyersOnly \}\);/.test(admin) && /Buyers only/.test(admin), 'the admin can choose who can claim, and sees which codes are buyers-only');
  console.log('PASS: buyers-only treasure codes (' + n + ' checks)');
})().catch(e => { console.error(e); process.exit(1); });
