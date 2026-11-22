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

// Who is an admin is decided ONCE per request, before any route (or file upload) runs: see the gate in server.js and
// admin-session.js. A key in the request body or in the web address is NOT accepted (it would end up in logs).
function verifyAdmin(req) {
  return req.isAdmin === true;
}

module.exports = { verifyAdmin, safeEqual };
