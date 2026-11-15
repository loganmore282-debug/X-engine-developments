// A single shared admin key, same shape as Voltra's own ADMIN_KEY -- correct
// for a one-operator admin panel. Timing-safe so a partially-correct key
// cannot be distinguished from a wrong one by response time.
'use strict';
const crypto = require('crypto');

function safeEqual(a, b) {
  const ab = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function verifyAdmin(req) {
  const key = req.headers['x-admin-key'] || req.body.adminKey || req.query.adminKey || '';
  const real = process.env.ADMIN_KEY || '';
  return !!real && safeEqual(key, real);
}

module.exports = { verifyAdmin, safeEqual };
