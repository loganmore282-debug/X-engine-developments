'use strict';
// totp.js against the published test vectors (RFC 4226 Appendix D, RFC 6238 Appendix B, RFC 4648 section 10) and against a SECOND, independently written
// implementation, so Google Authenticator and this server cannot disagree. Also the use-once and clock-drift rules the withdrawal check relies on.
const assert = require('node:assert/strict'), crypto = require('node:crypto');
const totp = require('./totp.js');
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); }; const eq = (a, b, m) => { n++; assert.deepEqual(a, b, m); };

// ---- RFC 4648 base32 (no padding is what authenticator apps use)
for (const [plain, b32] of [['', ''], ['f', 'MY'], ['fo', 'MZXQ'], ['foo', 'MZXW6'], ['foob', 'MZXW6YQ'], ['fooba', 'MZXW6YTB'], ['foobar', 'MZXW6YTBOI']]) {
  eq(totp.base32Encode(Buffer.from(plain)), b32, 'base32 encode "' + plain + '"');
  eq(totp.base32Decode(b32).toString(), plain, 'base32 decode ' + b32);
}
eq(totp.base32Decode('mzxw 6ytb-oi==').toString(), 'foobar', 'spaces, dashes, padding and lower case are ignored when a member types a key');
eq(totp.base32Decode('MZXW1'), null, 'a character that is not base32 is refused');
// ---- RFC 4226 Appendix D: the HOTP values for the secret "12345678901234567890"
const key = Buffer.from('12345678901234567890');
['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'].forEach((want, counter) => eq(totp.hotp(key, counter), want, 'HOTP counter ' + counter));
// ---- RFC 6238 Appendix B (SHA-1): 8-digit values; our 6 digits are the last six of them
const B32KEY = totp.base32Encode(key);
for (const [t, eight] of [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037'], [20000000000, '65353130']]) {
  eq(totp.codeAt(B32KEY, t * 1000, 8), eight, 'TOTP 8 digits at t=' + t);
  eq(totp.codeAt(B32KEY, t * 1000), eight.slice(2), 'TOTP 6 digits at t=' + t);
}
// ---- a second implementation, written differently (manual big-endian counter, manual truncation), against random secrets and times
function independent(secretBytes, unixSeconds) {
  let counter = Math.floor(unixSeconds / 30); const msg = Buffer.alloc(8);
  for (let i = 7; i >= 0; i--) { msg[i] = counter % 256; counter = Math.floor(counter / 256); }
  const h = crypto.createHmac('sha1', secretBytes).update(msg).digest();
  const o = h[19] & 0xf;
  const bin = (h[o] & 0x7f) * 16777216 + h[o + 1] * 65536 + h[o + 2] * 256 + h[o + 3];
  return String(bin % 1000000).padStart(6, '0');
}
for (let i = 0; i < 2000; i++) {
  const secret = crypto.randomBytes(20), t = crypto.randomInt(0, 4102444800);
  const b32 = totp.base32Encode(secret);
  eq(totp.codeAt(b32, t * 1000), independent(secret, t), 'random secret and time agree with the independent implementation');
  eq(totp.base32Decode(b32).equals(secret), true, 'base32 round trip');
}
// ---- generated secrets: 160 bits, base32, different every time
const s1 = totp.generateSecret(), s2 = totp.generateSecret();
ok(/^[A-Z2-7]{32}$/.test(s1) && s1 !== s2 && totp.base32Decode(s1).length === 20, 'a generated secret is 20 random bytes in 32 base32 characters');
// ---- match(): the step of a code, one step either side allowed, nothing else; no use-once rule (the caller owns that)
const secret = totp.generateSecret(), now = 1700000000000, cur = Math.floor(now / 30000);
eq(totp.match(secret, totp.codeAt(secret, now), now), { step: cur }, 'the current code matches the current step');
eq(totp.match(secret, totp.codeAt(secret, now - 30000), now), { step: cur - 1 }, 'the code of the step before (phone a little behind) matches');
eq(totp.match(secret, totp.codeAt(secret, now + 30000), now), { step: cur + 1 }, 'the code of the next step (phone a little ahead) matches');
eq(totp.match(secret, totp.codeAt(secret, now - 60000), now), null, 'two steps back (over a minute) does not match');
eq(totp.match(secret, totp.codeAt(secret, now + 60000), now), null, 'two steps ahead does not match');
eq(totp.match(secret, totp.codeAt(secret, now - 60000), now, 2), { step: cur - 2 }, 'a wider window can be asked for');
for (const bad of ['', '12345', '1234567', 'abcdef', '12 3456x', null, undefined, 123456.5]) eq(totp.match(secret, bad, now), null, 'not a 6-digit code: ' + JSON.stringify(bad));
eq(totp.match(secret, ' ' + totp.codeAt(secret, now).slice(0, 3) + ' ' + totp.codeAt(secret, now).slice(3) + ' ', now), { step: cur }, 'a code typed with spaces still matches');
eq(totp.match('not base32!', '123456', now), null, 'an unreadable secret never matches');
// a wrong code is never accepted by accident: of 1000 random codes only the (at most 3) valid ones match
let accepted = 0; for (let i = 0; i < 1000; i++) if (totp.match(secret, String(crypto.randomInt(0, 1000000)).padStart(6, '0'), now)) accepted++;
ok(accepted <= 3, 'random codes are not accepted (' + accepted + ' of 1000)');
// ---- verify() (the admin sign-in) still spends a step once
const c0 = totp.codeAt(secret, now);
eq(totp.verify(secret, c0, now, -1), { ok: true, step: cur }, 'verify accepts a fresh code');
eq(totp.verify(secret, c0, now, cur), { ok: false, step: null }, 'and refuses it once its step was used');
console.log('test-totp: ' + n + ' checks passed');
