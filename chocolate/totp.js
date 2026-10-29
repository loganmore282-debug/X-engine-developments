'use strict';
// Time-based one-time passwords (RFC 6238, SHA-1, 6 digits, 30 s) for the owner's admin sign-in, with no dependency.
// The secret lives only in the server's secrets file (ADMIN_TOTP_SECRET, base32) and in the owner's authenticator app.
const crypto = require('crypto');
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) { value = (value << 8) | byte; bits += 8; while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
function base32Decode(str) {
  const clean = String(str || '').toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0, value = 0; const out = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) return null;
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
function hotp(secret, counter, digits = 6) {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', secret).update(msg).digest();
  const off = h[h.length - 1] & 15;
  const code = ((h[off] & 127) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(code % 10 ** digits).padStart(digits, '0');
}
const STEP_MS = 30000;
function codeAt(secretB32, now = Date.now(), digits = 6) {
  const secret = base32Decode(secretB32);
  if (!secret || !secret.length) return null;
  return hotp(secret, Math.floor(now / STEP_MS), digits);
}
// ok when the code matches the current 30-second step or one step either side (clock drift) AND that step is newer than
// `lastStep` (a code can be used only once). Returns { ok, step }.
function verify(secretB32, code, now = Date.now(), lastStep = -1, window = 1) {
  const secret = base32Decode(secretB32);
  const given = String(code || '').replace(/\s/g, '');
  if (!secret || !secret.length || !/^\d{6}$/.test(given)) return { ok: false, step: null };
  const cur = Math.floor(now / STEP_MS);
  let found = null;
  for (let d = -window; d <= window; d++) {
    const step = cur + d;
    const want = Buffer.from(hotp(secret, step)), have = Buffer.from(given);
    if (crypto.timingSafeEqual(want, have) && found === null) found = step;   // no early exit: every step is always compared
  }
  if (found === null || found <= lastStep) return { ok: false, step: null };
  return { ok: true, step: found };
}
const generateSecret = () => base32Encode(crypto.randomBytes(20));
module.exports = { base32Encode, base32Decode, hotp, codeAt, verify, generateSecret, STEP_MS };
