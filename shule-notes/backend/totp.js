// Two-step sign-in codes (the 6-digit numbers in Google Authenticator and similar apps), RFC 6238, no library.
'use strict';
const crypto = require('crypto');

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Encode(buf) {
  let bits = ''; let out = '';
  for (const b of buf) bits += b.toString(2).padStart(8, '0');
  for (let i = 0; i < bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
  return out;
}
function base32Decode(str) {
  let bits = '';
  for (const c of String(str).replace(/[\s=]+/g, '').toUpperCase()) {
    const v = B32.indexOf(c);
    if (v < 0) throw new Error('not base32');
    bits += v.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
function hotp(secret, counter) {
  const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', secret).update(buf).digest();
  const o = h[19] & 0xf;
  const code = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(code % 1000000).padStart(6, '0');
}
const generateSecret = () => base32Encode(crypto.randomBytes(20));

// The time step of the matching code (this step, or one either side for clock drift), or null.
function verify(secretB32, code, now = Date.now()) {
  const clean = String(code || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(clean)) return null;
  let key;
  try { key = base32Decode(secretB32); } catch (_) { return null; }
  const step = Math.floor(now / 30000);
  for (const w of [0, -1, 1]) {
    const expected = Buffer.from(hotp(key, step + w));
    if (crypto.timingSafeEqual(expected, Buffer.from(clean))) return step + w;
  }
  return null;
}
const otpauthUri = (secret, account = 'Admin', issuer = 'Shule Notes') => `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&digits=6&period=30`;

module.exports = { generateSecret, verify, otpauthUri, base32Encode, base32Decode, hotp };
