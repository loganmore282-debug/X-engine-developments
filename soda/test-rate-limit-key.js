// Rate-limit bucket per signed-in member + removed payout routes stay removed.
const fs = require('fs'), assert = require('assert'), crypto = require('crypto');
const src = fs.readFileSync(__dirname + '/server.js', 'utf8');
const a = src.indexOf('function rlKeyByUser'), b = src.indexOf('const globalLimiter');
const rlKeyByUser = new Function('crypto', src.slice(a, b) + '; return rlKeyByUser;')(crypto);
const req = (token, url, ip = '1.1.1.1') => ({ headers: token ? { authorization: 'Bearer ' + token } : {}, originalUrl: url, ip });
const k1 = rlKeyByUser(req('a'.repeat(64), '/withdraw/request'));
const k2 = rlKeyByUser(req('b'.repeat(64), '/withdraw/request'));
assert.notStrictEqual(k1, k2, 'two members on one IP get separate buckets');
assert.strictEqual(k1, rlKeyByUser(req('a'.repeat(64), '/invest/create', '9.9.9.9')), 'same member, same bucket');
assert.strictEqual(rlKeyByUser(req(null, '/withdraw/request')), '1.1.1.1', 'no token -> IP');
assert.strictEqual(rlKeyByUser(req('x'.repeat(64), '/auth/otp/send')), '1.1.1.1', 'pre-sign-in routes stay on IP');
assert.strictEqual(rlKeyByUser(req('x'.repeat(64), '/register')), '1.1.1.1');
assert(!k1.includes('a'.repeat(10)), 'token never appears in the key');
for (const gone of ["app.post('/checkin'", "app.post('/team/milestone/claim'"]) assert(!src.includes(gone), gone + ' must stay removed');
console.log('PASS: per-member rate-limit key, IP key before sign-in, removed payout routes');
