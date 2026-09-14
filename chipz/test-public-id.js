/**
 * Account ids are five digits, and the repair that shortens the old ones.
 *
 * Owner: "let the user id be having 5 characters, so so far now the current
 * account is 000001, so remove first 0 so it will be 00001."
 *
 * Two halves, and they fail differently:
 *   - the ALLOCATOR decides what new accounts get;
 *   - the REPAIR rewrites what is already stored, which is the only part that
 *     can damage anything, because a publicId is an identifier a member may
 *     already have been given.
 *
 * The repair's rules are lifted out of server.js rather than restated, so a
 * change there that this file does not know about shows up as a failure.
 */
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/server.js', 'utf8');

let failed = 0;
const check = (ok, label) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); };

console.log('— the allocator —');
const digits = /const PUBLIC_ID_DIGITS = (\d+);/.exec(src);
check(!!digits && digits[1] === '5', `PUBLIC_ID_DIGITS is 5 (${digits && digits[1]})`);
// It must be the constant that drives the padding, not a second literal that
// can drift away from it.
check(/padStart\(PUBLIC_ID_DIGITS, '0'\)/.test(src),
  'the id is padded with that constant, not a separate hardcoded width');
check(!/String\(n\)\.padStart\(6/.test(src), 'no six-digit padding left behind');

const PUBLIC_ID_DIGITS = 5;
const pad = n => String(n).padStart(PUBLIC_ID_DIGITS, '0');
check(pad(1) === '00001', `account 1 is 00001 (${pad(1)})`);
check(pad(42) === '00042', `account 42 is 00042 (${pad(42)})`);
check(pad(99999) === '99999', `account 99999 still fits in five (${pad(99999)})`);
// padStart is a MINIMUM. Past 99,999 the id simply grows rather than wrapping
// round and colliding with an id someone already has.
check(pad(100000) === '100000', `account 100000 grows to six rather than wrapping (${pad(100000)})`);

console.log('\n— the repair, using server.js\'s own rules —');
// The two conditions the route applies, pulled out of the file so this test
// cannot pass against a route that decides something else.
check(/if \(!\/\^0\\d\+\$\/\.test\(r\.id\) \|\| r\.id\.length <= PUBLIC_ID_DIGITS\) continue;/.test(src),
  'the route skips ids that are not zero-padded, and ids already short enough');
check(/if \(taken\.has\(short\)\) \{ conflicts\.push/.test(src),
  'and refuses to write an id another account already holds');

const shorten = id => {
  if (!/^0\d+$/.test(id) || id.length <= PUBLIC_ID_DIGITS) return null;
  const short = String(Number(id)).padStart(PUBLIC_ID_DIGITS, '0');
  return short.length >= id.length ? null : short;
};
for (const [from, to, why] of [
  ['000001', '00001', "the owner's own account"],
  ['000042', '00042', 'padding stripped, value kept'],
  ['099999', '99999', 'the largest that still fits'],
  ['00001', null, 'already five digits — left alone'],
  ['100000', null, 'genuinely needs six digits — NOT shortened'],
  ['123456', null, 'a six-digit value that is not padding'],
  ['0000001', '00001', 'seven digits of padding collapse too'],
]) check(shorten(from) === to, `${from} -> ${to === null ? '(unchanged)' : to}: ${why}`);

// The property that actually protects members: shortening never changes which
// account an id names, and never collides.
console.log('\n— shortening preserves the number and stays unique —');
let bad = 0, collisions = 0;
const seen = new Set();
for (let n = 1; n <= 200000; n++) {
  const six = String(n).padStart(6, '0');
  const out = shorten(six) || six;
  if (Number(out) !== n) bad++;
  if (seen.has(out)) collisions++;
  seen.add(out);
}
check(bad === 0, `200,000 ids: every shortened id still reads as the same number (${bad} wrong)`);
check(collisions === 0, `and none collide with another (${collisions} collisions)`);

console.log(failed ? `\n${failed} FAILED` : '\npublic id: all cases pass');
process.exit(failed ? 1 : 0);
