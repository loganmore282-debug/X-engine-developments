/* Smoke check for POST /assistant/chat -- boots the real server.js against
   the in-memory mock db/auth (same harness as test-payout-pin.js). The
   assistant is fully self-hosted (assistant-engine.js, no external API), so
   this exercises the REAL reply logic end-to-end through the real route --
   auth, validation, rate limiting, live-data grounding (settings/products/
   account), and a few representative intents. Run: node test-assistant-smoke.js */
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

  await mockdb.db.collection('users').doc('u1').set({
    phone: '+256701234567', walletBalance: 125000, totalInvested: 90000, totalEarned: 43000,
    referralCode: 'ABC123', checkinStreak: 4, registrationDone: true, status: 'active'
  });
  await mockdb.db.collection('settings').doc('main').set({
    minDeposit: 20000, minWithdraw: 5000, withdrawFeePct: 15, dailyCheckin: 250,
    commL1: 27, commL2: 2, commL3: 1
  });

  console.log('\n== POST /assistant/chat -- routing/validation ==');
  let r = await call('POST', '/assistant/chat', { body: { message: 'How do I deposit?' } });
  check('no auth -> 401', r.code === 401, r);

  r = await call('POST', '/assistant/chat', { token: 'uid:u1', body: { message: '' } });
  check('empty message -> 400', r.code === 400, r);

  r = await call('POST', '/assistant/chat', { token: 'uid:u1', body: { message: '   ' } });
  check('whitespace-only message -> 400', r.code === 400, r);

  console.log('\n== POST /assistant/chat -- real reply content (no external API involved) ==');
  r = await call('POST', '/assistant/chat', { token: 'uid:u1', body: { message: 'How do I deposit?' } });
  check('deposit question -> 200 success', r.code === 200 && r.body.status === 'success', r);
  check('deposit reply mentions the LIVE minimum (20,000), not a hardcoded/stale figure', /20,000/.test(r.body.reply), r.body);

  r = await call('POST', '/assistant/chat', { token: 'uid:u1', body: { message: 'if I withdraw 100000 how much do I get' } });
  check('withdraw-with-amount reply computes the real fee (15,000) and net (85,000)', /15,000/.test(r.body.reply) && /85,000/.test(r.body.reply), r.body);

  r = await call('POST', '/assistant/chat', { token: 'uid:u1', body: { message: 'what is my balance' } });
  check("balance question answers with THIS user's real live data (125,000)", /125,000/.test(r.body.reply), r.body);

  r = await call('POST', '/assistant/chat', { token: 'uid:u1', body: { message: 'what is my pin' } });
  check('asking to reveal the PIN is refused, not answered', /can't see or share/i.test(r.body.reply), r.body);

  r = await call('POST', '/assistant/chat', {
    token: 'uid:u1',
    body: {
      message: 'and the fee?',
      history: [{ role: 'user', text: 'how do I withdraw' }, { role: 'assistant', text: 'Bind a payout account...' }]
    }
  });
  check('short ambiguous follow-up uses prior-turn context (still lands on withdraw/fees)', /fee/i.test(r.body.reply), r.body);

  console.log('\n== Rate limiting ==');
  let limited = false;
  for (let i = 0; i < 35; i++) {
    const rr = await call('POST', '/assistant/chat', { token: 'uid:u1', body: { message: 'hello ' + i } });
    if (rr.code === 429) { limited = true; break; }
  }
  check('assistLimiter eventually kicks in on rapid-fire messages', limited);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
