/* CHRONOVA — Welcome-bonus write ORDER matters when a batch is interrupted.
   M0 batches apply sequentially with no rollback (see db.js). This directly
   simulates a process crash landing exactly between the two writes inside
   /register's batch (a redeploy landing at the wrong instant — precisely
   the risk on a day with several redeploys) and proves the fix: the user's
   OWN doc (registrationDone + the actual wallet credit) is written FIRST,
   so a crash there always leaves the user correctly paid — the only
   possible casualty is the cosmetic "Welcome gift" history line. Confirmed
   this test FAILS against the pre-fix code (crash leaves a ledger row with
   NO wallet credit at all — the real bug the Integrity Audit found live)
   and PASSES against the fix.
   Run:  node test-welcome-bonus-crash.js      (exits 0 = all green)        */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '4000';

const Module = require('module');
const mockdb = require('./test-mockdb.js');
const dbPath = require.resolve('./db.js');
const dbMod = new Module(dbPath); dbMod.exports = mockdb; dbMod.loaded = true;
require.cache[dbPath] = dbMod;

const faPath = require.resolve('firebase-admin');
const faMod = new Module(faPath);
faMod.exports = {
  initializeApp: () => {}, credential: { cert: () => ({}) },
  auth: () => ({
    verifyIdToken: async tok => { if (String(tok).startsWith('uid:')) return { uid: tok.slice(4) }; throw new Error('invalid token'); },
    updateUser: async () => ({}), createCustomToken: async uid => 'ct:' + uid,
  }),
};
faMod.loaded = true;
require.cache[faPath] = faMod;

require('./server.js');

const BASE = 'http://127.0.0.1:4000';
async function call(method, p, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (_) {}
  return { code: r.status, body: j };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}

(async () => {
  await sleep(1200);

  console.log('\n── A process crash landing mid-batch during /register must always leave the user paid, never a ledger-only phantom credit');

  await call('POST', '/account/create-profile', { token: 'uid:zack-uid', body: { phone: '0771000099' } });

  // Simulate the exact real-world failure: the batch's ops apply one at a
  // time (matching db.js's real, non-atomic WriteBatch.commit), and the
  // "process" dies after exactly the FIRST op lands.
  const origBatch = mockdb.db.batch;
  mockdb.db.batch = () => {
    const ops = [];
    return {
      set:    (ref, d, o) => { ops.push(() => ref.set(d, o)); return this; },
      update: (ref, d)    => { ops.push(() => ref.update(d)); return this; },
      delete: (ref)       => { ops.push(() => ref.delete()); return this; },
      async commit() {
        if (ops.length === 0) return;
        await ops[0](); // only the FIRST queued write ever lands
        throw new Error('SIMULATED CRASH: process died right after the first write');
      },
    };
  };

  const r = await call('POST', '/register', { token: 'uid:zack-uid', body: { referralCode: '' } });
  mockdb.db.batch = origBatch; // restore for anything after this test

  check('the /register call itself surfaces the crash as a 500 (client sees a failure, correctly — but let\'s see what actually landed)',
    r.code === 500, r.body);

  const zack = mockdb.__store.get('users').get('zack-uid');
  const zackTx = [...mockdb.__store.get('transactions').values()].filter(t => t.userId === 'zack-uid' && t.type === 'admin_credit');

  check('zack was still correctly credited the welcome bonus despite the crash — this is the fix',
    (zack.walletBalance || 0) === 5000, zack.walletBalance);
  check('registrationDone landed too, so a retry will be a safe no-op instead of running the whole flow again',
    zack.registrationDone === true, zack.registrationDone);
  check('the missing "Welcome gift" ledger row (if any) is the only possible casualty — never a duplicate, never a phantom credit',
    zackTx.length <= 1, zackTx.length);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('SUITE CRASH:', e); process.exit(1); });
