'use strict';
// Sealed payment requests. The member's phone, provider and order number leave the app encrypted with a key only this server can open, on top of
// the encryption of HTTPS, so nothing in between (a proxy, a log, a captured request) can read or replay them.
//
// How: the server holds an ECDH P-256 key pair (made when the server starts; the app asks for the public half each time it pays). The app makes a
// fresh pair for every payment, agrees a shared secret with the server's public key, hashes it to an AES-256 key and encrypts the request with
// AES-GCM. The tag binds the key id and the app's public key, so a changed byte fails. A request is only accepted within two minutes of its own
// time stamp and once (its random number is remembered), so a copy of it is useless. The answer comes back sealed with the same key.
const crypto = require('crypto');
const SKEW_MS = 2 * 60 * 1000;
const b64u = buf => Buffer.from(buf).toString('base64url');

function createPaySeal(now = Date.now) {
  const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const kid = crypto.randomBytes(6).toString('hex');
  const jwk = pair.publicKey.export({ format: 'jwk' });
  const seen = new Map();   // random number -> when it stops mattering
  const keyOf = shared => crypto.createHash('sha256').update(shared).digest();

  function publicKey() { return { kid, jwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y } }; }

  // -> { body, key } for a good envelope, or { error: 'SEAL_KEY' | 'SEAL_BAD' | 'SEAL_REPLAY' | 'SEAL_OLD' }
  function open(env) {
    try {
      if (!env || typeof env !== 'object') return { error: 'SEAL_BAD' };
      if (env.kid !== kid) return { error: 'SEAL_KEY' };               // the server restarted: the app asks for the new key and tries again
      const epk = Buffer.from(String(env.epk), 'base64url'), iv = Buffer.from(String(env.iv), 'base64url'), ct = Buffer.from(String(env.ct), 'base64url');
      if (epk.length !== 65 || epk[0] !== 4 || iv.length !== 12 || ct.length < 17 || ct.length > 4096) return { error: 'SEAL_BAD' };
      const peer = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(epk.subarray(1, 33)), y: b64u(epk.subarray(33)) }, format: 'jwk' });
      const key = keyOf(crypto.diffieHellman({ privateKey: pair.privateKey, publicKey: peer }));
      const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
      d.setAAD(Buffer.from(kid + '.' + env.epk));
      d.setAuthTag(ct.subarray(ct.length - 16));
      const body = JSON.parse(Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]).toString('utf8'));
      if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'SEAL_BAD' };
      const t = now(), ts = Number(body.ts), nonce = String(body.nonce || '');
      if (!Number.isFinite(ts) || Math.abs(t - ts) > SKEW_MS) return { error: 'SEAL_OLD' };
      if (nonce.length < 16 || nonce.length > 64) return { error: 'SEAL_BAD' };
      for (const [n, until] of seen) if (until < t) seen.delete(n);
      if (seen.has(nonce)) return { error: 'SEAL_REPLAY' };
      seen.set(nonce, t + 2 * SKEW_MS + 1000);
      return { body, key };
    } catch (_) { return { error: 'SEAL_BAD' }; }
  }

  function seal(key, obj) {
    const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key, iv);
    c.setAAD(Buffer.from(kid + '.res'));
    const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final(), c.getAuthTag()]);
    return { iv: b64u(iv), ct: b64u(ct) };
  }

  return { publicKey, open, seal, kid };
}
module.exports = { createPaySeal };
