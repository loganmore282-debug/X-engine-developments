'use strict';
const assert = require('node:assert/strict');
const { createFailGuard } = require('./security-guard');
const totp = require('./totp');
const { weakPasswordReason } = require('./weak-passwords');
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); }; const eq = (a, b, m) => { n++; assert.deepEqual(a, b, m); };

// ---- failure guard
let g = createFailGuard({ max: 5, windowMs: 1000, lockMs: 5000 }); const t0 = 1000000;
for (let i = 0; i < 4; i++) eq(g.fail('a', t0 + i), 0, 'four failures do not lock');
ok(g.fail('a', t0 + 5) > 0, 'the fifth failure locks'); ok(g.locked('a', t0 + 100) > 0, 'locked'); eq(g.locked('b', t0), 0, 'another key is not affected');
ok(g.locked('a', t0 + 5004) > 0 && g.locked('a', t0 + 5006) === 0, 'the lock ends after lockMs');
for (let i = 0; i < 4; i++) g.fail('w', t0 + i * 400); eq(g.locked('w', t0 + 1600), 0, 'failures older than the window do not add up'); 
g.fail('c', t0); g.clear('c'); for (let i = 0; i < 4; i++) g.fail('c', t0 + i); eq(g.locked('c', t0 + 10), 0, 'clear() forgets earlier failures');
g = createFailGuard({ max: 3, windowMs: 1000, lockMs: 1000, maxKeys: 100 }); for (let i = 0; i < 5000; i++) g.fail('ip' + i, t0); ok(g.size() <= 100, 'a flood of different keys cannot grow the table past its cap (' + g.size() + ')');

// ---- TOTP: the RFC 6238 test vectors (SHA-1, secret "12345678901234567890", last 6 digits of the 8-digit codes)
const RFC = totp.base32Encode(Buffer.from('12345678901234567890'));
for (const [t, want] of [[59, '287082'], [1111111109, '081804'], [1111111111, '050471'], [1234567890, '005924'], [2000000000, '279037'], [20000000000, '353130']])
  eq(totp.codeAt(RFC, t * 1000), want, 'RFC 6238 vector at ' + t);
eq(totp.base32Decode(totp.base32Encode(Buffer.from('hello world'))).toString(), 'hello world', 'base32 round trip');
ok(/^[A-Z2-7]{32}$/.test(totp.generateSecret()), 'a generated secret is 32 base32 characters'); const S = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const now = 1700000000000, code = totp.codeAt(S, now);
let v = totp.verify(S, code, now); ok(v.ok && Number.isInteger(v.step), 'the current code is accepted');
ok(!totp.verify(S, code, now, v.step).ok, 'the same code cannot be used twice');
ok(totp.verify(S, totp.codeAt(S, now - 30000), now).ok, 'one step old is accepted (clock drift)');
ok(totp.verify(S, totp.codeAt(S, now + 30000), now).ok, 'one step ahead is accepted');
ok(!totp.verify(S, totp.codeAt(S, now - 90000), now).ok, 'three steps old is refused');
const wrong = code.slice(0, 5) + String((Number(code[5]) + 1) % 10); const near = [-1, 0, 1].map(d => totp.codeAt(S, now + d * 30000)); ok(!near.includes(wrong), 'test sanity: the wrong code is not any of the three valid ones'); ok(!totp.verify(S, wrong, now).ok, 'a wrong code is refused');
for (const bad of ['', '12345', '1234567', 'abcdef', null, undefined, '12 34 5', {}]) ok(!totp.verify(S, bad, now).ok, 'refused input: ' + JSON.stringify(bad));
ok(totp.verify(S, code.slice(0, 3) + ' ' + code.slice(3), now + 1).ok, 'a code typed with a space in the middle (123 456) is accepted');
ok(!totp.verify('!!!notbase32', code, now).ok && !totp.verify('', code, now).ok, 'a bad secret never verifies');

// ---- weak passwords
for (const w of ['123456', 'Password', 'qwerty123', '111111', 'aaaaaa', 'abcdef', '987654', '1234567890', 'Cookie123', '0700123456']) ok(weakPasswordReason(w, '0700123456') !== '', 'refused: ' + w);
for (const s of ['Pass12345', 'tr4ctor!', 'maama2024', 'K9mXq2', 'Blue-Goat-71']) eq(weakPasswordReason(s, '0700123456'), '', 'accepted: ' + s);
console.log(`PASS: security helpers (${n} checks)`);
