/* Quick smoke check for POST /assistant/chat -- boots the real server.js
   against the in-memory mock db/auth (same harness as test-payout-pin.js).
   No ANTHROPIC_API_KEY is set here, so this only proves routing, auth, rate
   limiting and the no-key fallback path -- NOT real model output (that
   needs a live key on Render, exercised separately). Run: node test-assistant-smoke.js */
process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '4145';

const Module = require('module');
const mockdb = require('./test-mockdb.js');
const dbPath = require.resolve('./db.js');
const dbMod = new Module(dbPath); dbMod.exports = mockdb; dbMod.loaded = true;
require.cache[dbPath] = dbMod;

const faPath = require.resolve('firebase-admin');
const faMod = new Module(faPath);
faMod.exports = {
  initializeApp: () => {}, credential: { cert: () => ({}) },
  auth: () => ({ verifyIdToken: async tok => { if (String(tok).startsWith('uid:')) return { uid: tok.slice(4) }; throw new Error('bad'); } }),
};
faMod.loaded = true;
require.cache[faPath] = faMod;

require('./server.js');

const BASE = 'http://127.0.0.1:4145';
async function call(method, p, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await fetch(BASE + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (_) {}
  return { code: r.status, body: j };
}
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   - ' + name); }
  else { fail++; console.log('  FAIL - ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}

(async () => {
  await new Promise(r => setTimeout(r, 400));

  console.log('\n== POST /assistant/chat ==');
  let r = await call('POST', '/assistant/chat', { body: { message: 'How do I deposit?' } });
  check('no auth -> 401', r.code === 401, r);

  await mockdb.__seedUser && mockdb.__seedUser('u1', {}); // no-op if helper absent

  r = await call('POST', '/assistant/chat', { token: 'uid:u1', body: { message: '' } });
  check('empty message -> 400', r.code === 400, r);

  r = await call('POST', '/assistant/chat', { token: 'uid:u1', body: { message: 'How do I deposit?' } });
  check('authed message -> 200', r.code === 200, r);
  check('no ANTHROPIC_API_KEY set -> graceful fallback reply, no crash', r.body && r.body.status === 'success' && typeof r.body.reply === 'string' && r.body.reply.length > 0, r.body);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
