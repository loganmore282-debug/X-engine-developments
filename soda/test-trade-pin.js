// The REAL pinCheck() from server.js against an in-memory user doc: right code passes,
// wrong codes count, the 5th wrong one locks for 15 minutes (even the right code is
// refused while locked), a good code resets the counter, and no-PIN / bad shape are refused.
const fs = require('fs'), crypto = require('crypto'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/server.js', 'utf8');
function fnSource(name) {
  let start = src.indexOf(`async function ${name}(`); if (start === -1) start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error('no such function ' + name);
  let depth = 0;
  for (let k = src.indexOf('{', start); k < src.length; k++) { if (src[k] === '{') depth++; else if (src[k] === '}') { depth--; if (depth === 0) return src.slice(start, k + 1); } }
}
let n = 0; const ok = (c, m) => { assert(c, m); n++; };
const mk = () => {
  const doc = { transactionPinHash: null };
  const db = { collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => doc }), update: async u => { Object.assign(doc, u); } }) }) };
  return { doc, db };
};
const build = db => new Function('crypto', 'db', 'withLock', 'tsMillis', `
  const PIN_LOCK_MS = 15 * 60 * 1000, PIN_MAX_FAILS = 5;
  ${fnSource('scryptHash')}
  ${fnSource('scryptVerify')}
  ${fnSource('pinCheck')}
  return { scryptHash, pinCheck };`)(crypto, db, (_k, fn) => fn(), v => v instanceof Date ? v.getTime() : Number(v) || 0);
(async () => {
  const { doc, db } = mk(); const { scryptHash, pinCheck } = build(db);
  doc.transactionPinHash = scryptHash('123456');
  ok(!doc.transactionPinHash.includes('123456'), 'the code itself is never stored');
  ok((await pinCheck('u', '123456')).ok, 'right code passes');
  for (const bad of [undefined, '', '12345', '1234567', 'abcdef']) ok((await pinCheck('u', bad)).code === 'INVALID_PIN', 'bad shape refused: ' + bad);
  ok(doc.pinFailCount === 0, 'a badly shaped code does not count as a guess');
  for (let i = 1; i <= 4; i++) { const r = await pinCheck('u', '000000'); ok(r.code === 'WRONG_PIN' && doc.pinFailCount === i, 'wrong guess ' + i); }
  ok((await pinCheck('u', '123456')).ok && doc.pinFailCount === 0, 'a right code resets the counter');
  for (let i = 0; i < 4; i++) await pinCheck('u', '000000');
  const fifth = await pinCheck('u', '000000');
  ok(fifth.code === 'LOCKED' && doc.pinLockedUntil, '5th wrong guess locks');
  ok((await pinCheck('u', '123456')).code === 'LOCKED', 'while locked even the right code is refused');
  doc.pinLockedUntil = new Date(Date.now() - 1000);
  ok((await pinCheck('u', '123456')).ok, 'after the lock expires the right code works again');
  const m2 = mk(); const c2 = build(m2.db);
  ok((await c2.pinCheck('u', '123456')).code === 'NO_PIN', 'an account with no Trade Password is refused, not waved through');
  // registration stores it hashed and requires 6 digits
  const reg = src.slice(src.indexOf('async function completeRegistrationCore'), src.indexOf('// ── OTP endpoints ──'));
  ok(/INVALID_TRADE_PIN/.test(reg) && /transactionPinHash = scryptHash\(tradePin\)/.test(reg), 'sign-up requires and hashes the 6-digit Trade Password');
  console.log(`PASS: trade password (${n} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
