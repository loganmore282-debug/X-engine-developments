/* SPACE8 RATE-LIMIT EVASION VIA UNVERIFIED TOKEN CLAIM
   Security audit finding: rlKeyByUser() (used by BOTH the global limiter
   and every per-route apiLimiter) buckets requests by the uid CLAIMED in
   a Bearer token's payload -- but it never verifies the token's signature
   to do that (real verification happens later, inside each handler, via
   verifyAuth/verifyAdmin). A request carrying a well-formed-but-fake token
   with a DIFFERENT fake uid claimed every time gets a brand-new rate-limit
   bucket every single request, on every limiter keyed this way -- fully
   defeating them. No real account or money is ever at risk this way (the
   forged token still fails real verification inside the handler), but the
   limiters meant to bound abuse wouldn't actually bound anything.

   Fix: a second limiter, keyed purely by IP (nothing in a request body or
   token header can change it), runs in addition to the existing ones as a
   backstop nobody can evade by rotating a claimed identity. Deliberately
   looser than the per-user ceiling so it doesn't reintroduce the exact
   problem per-user keying exists to solve (real Ugandan carrier-NAT
   traffic sharing one IP).

   Boots the REAL server.js against an in-memory mock database and proves:
     - many DIFFERENT genuine-looking fake uids from the SAME IP, staying
       under the IP backstop's ceiling, are NOT blocked by it (a shared-IP
       NAT scenario with real distinct users still works)
     - enough requests with a FRESH fake uid claimed on every single one
       (the evasion technique) EVENTUALLY gets a 429 anyway, proving the
       IP-only backstop actually engages and can't be dodged by varying
       the claim
     - a real forged token, even one that dodges every rate limiter, still
       gets a clean 401 from actual auth on the endpoint itself -- rate-
       limit evasion was never a path to touching real data or money

   Run: node test-ratelimit-evasion.js   (exits 0 = all green)            */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '4151';

const Module = require('module');
const mockdb = require('./test-mockdb.js');
const dbPath = require.resolve('./db.js');
const dbMod = new Module(dbPath); dbMod.exports = mockdb; dbMod.loaded = true;
require.cache[dbPath] = dbMod;

const faPath = require.resolve('firebase-admin');
const faMod = new Module(faPath);
faMod.exports = {
  initializeApp: () => {}, credential: { cert: () => ({}) },
  auth: () => ({ verifyIdToken: async () => { throw new Error('bad'); } }), // every forged token fails real verification, always
};
faMod.loaded = true;
require.cache[faPath] = faMod;

require('./server.js');

const BASE = 'http://127.0.0.1:4151';
// A forged, unsigned-but-well-formed JWT shape: header.payload.signature,
// where payload is valid base64 JSON carrying a claimed user_id -- exactly
// what an attacker would send, and exactly what rlKeyByUser() reads without
// verifying.
function forgedToken(uid) {
  const payload = Buffer.from(JSON.stringify({ user_id: uid })).toString('base64');
  return `x.${payload}.y`;
}
async function callWithFakeUid(uid) {
  return fetch(BASE + '/account', { headers: { Authorization: 'Bearer ' + forgedToken(uid) } });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   - ' + name); }
  else { fail++; console.log('  FAIL - ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}

(async () => {
  await sleep(600);

  console.log('\n== A real forged token, even a fresh one, fails real auth on the endpoint itself ==');
  let r = await callWithFakeUid('legit-looking-uid-1');
  check('forged token is refused by actual auth (401), never reaches account data', r.status === 401, r.status);

  console.log('\n== Modest, distinct-uid traffic from one IP (a real shared-NAT scenario) is NOT blocked by the IP backstop ==');
  let blocked = 0;
  for (let i = 0; i < 50; i++) {
    const resp = await callWithFakeUid('distinct-uid-' + i);
    if (resp.status === 429) blocked++;
  }
  check('50 requests, 50 different claimed uids, none hit the IP-only backstop (well under its ceiling)', blocked === 0, { blocked });

  console.log('\n== CRITICAL: rotating a FRESH fake uid on every request eventually still gets rate-limited by IP ==');
  // The IP backstop is deliberately looser than the per-route ceiling (900 vs
  // 60/min) specifically so it never bothers real shared-IP traffic -- proving
  // it engages at all means sending enough requests to cross that higher bar.
  // Batched concurrently since this is all localhost.
  let total = 0, sawBlock = false;
  const BATCH = 100, MAX_REQUESTS = 1100;
  while (total < MAX_REQUESTS && !sawBlock) {
    const batch = [];
    for (let i = 0; i < BATCH; i++) batch.push(callWithFakeUid('evader-' + total + '-' + i));
    const results = await Promise.all(batch);
    total += BATCH;
    if (results.some(resp => resp.status === 429)) sawBlock = true;
  }
  check(`rotating-uid flood was eventually blocked by the IP backstop (after ~${total} requests, all with distinct claimed uids)`, sawBlock, { total });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
