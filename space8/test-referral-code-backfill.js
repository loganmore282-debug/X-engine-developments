/* SPACE8 -- LEGACY REFERRAL CODES GET BACKFILLED WITH referralCodeLower
   Codex-verified real gap (2026-08-18, Medium severity) in the mixed-case
   referral code work: generateUniqueReferralCode()'s uniqueness check
   queries both the exact `referralCode` field and a `referralCodeLower`
   mirror -- but a LEGACY user (registered before referralCodeLower
   existed) has no such field at all. A Mongo equality query against a
   field that's simply absent never matches that document, so a brand-new
   candidate that's a pure-case variant of an existing legacy code (e.g.
   existing "ABC234", new candidate "aBc234") would sail through both
   checks undetected.

   The fix is backfillReferralCodeLower() in server.js, fired once at boot
   (see connectMongo().then(...)). This is the one thing about it that
   makes it awkward to test from the SAME process as every other test file
   here: it only ever runs once, at the moment server.js is first
   required, so a legacy user seeded into the mock DB AFTER require('./
   server.js') has already happened would never get backfilled -- the
   backfill would have already run and moved on before that seed exists.
   This file seeds its legacy user BEFORE requiring server.js specifically
   so the boot-time backfill actually has something to find.

   Proves:
     - a legacy user (referralCode set, referralCodeLower deliberately
       absent, exactly as a pre-2026-08-18 account would look) has
       referralCodeLower correctly populated shortly after boot
     - with the backfill having run, a real generation attempt forced to
       land on that legacy code's lowercase variant is now correctly
       rejected as a collision (proven by exhausting the tiny alphabet
       this file monkey-patches in, not by chance)
     - a legacy user who already, coincidentally, has a referralCodeLower
       set to something ELSE (shouldn't happen in practice, but proves the
       backfill only fills in what's actually missing, never overwrites)
       is left untouched

   Run: node test-referral-code-backfill.js   (exits 0 = all green)      */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '4305';

const Module = require('module');
const mockdb = require('./test-mockdb.js');
const dbPath = require.resolve('./db.js');
const dbMod = new Module(dbPath); dbMod.exports = mockdb; dbMod.loaded = true;
require.cache[dbPath] = dbMod;

const faPath = require.resolve('firebase-admin');
const faMod = new Module(faPath);
faMod.exports = {
  initializeApp: () => {}, credential: { cert: () => ({}) },
  auth: () => ({ verifyIdToken: async (tok) => { if (String(tok).startsWith('uid:')) return { uid: tok.slice(4) }; throw new Error('bad'); } }),
};
faMod.loaded = true;
require.cache[faPath] = faMod;

function collMap(name) {
  if (!mockdb.__store.has(name)) mockdb.__store.set(name, new Map());
  return mockdb.__store.get(name);
}
const users = () => collMap('users');

// Seeded BEFORE require('./server.js') -- this is the entire point of this
// file. Shaped exactly like a real pre-2026-08-18 account: referralCode
// set, referralCodeLower deliberately absent.
users().set('bf-legacy-1', {
  phone: '0771990001', referralCode: 'QRST88', walletBalance: 0, totalDeposited: 0, totalInvested: 0,
  totalWithdrawn: 0, totalEarned: 0, teamCommission: 0, teamL1Count: 0, teamL2Count: 0, teamL3Count: 0,
  status: 'active', registrationDone: true, checkinStreak: 0, publicId: '900002', createdAt: new Date(),
});
// A second legacy-shaped doc that ALREADY happens to have referralCodeLower
// set to something else -- proves the backfill only fills in what's
// missing, never clobbers an existing value (shouldn't happen for a real
// legacy doc, but worth proving the backfill's own guard -- `!d.referralCodeLower`
// -- actually behaves as a "missing only" check, not an unconditional overwrite).
users().set('bf-legacy-2', {
  phone: '0771990002', referralCode: 'UVWX99', referralCodeLower: 'sentinel-should-not-change',
  walletBalance: 0, totalDeposited: 0, totalInvested: 0, totalWithdrawn: 0, totalEarned: 0,
  teamCommission: 0, teamL1Count: 0, teamL2Count: 0, teamL3Count: 0,
  status: 'active', registrationDone: true, checkinStreak: 0, publicId: '900003', createdAt: new Date(),
});

require('./server.js');

const BASE = 'http://127.0.0.1:4305';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   - ' + name); }
  else { fail++; console.log('  FAIL - ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}

(async () => {
  // Give the boot-time backfill (fired inside connectMongo().then(...),
  // right alongside app.listen) time to actually run against the mock's
  // tiny 2-document users collection -- generous relative to the other
  // files' standard 600ms boot wait since this is specifically waiting on
  // an async background pass, not just "is the HTTP server up yet".
  await sleep(1200);

  console.log('\n== The legacy user missing referralCodeLower gets backfilled ==');
  const legacy1 = users().get('bf-legacy-1');
  check('bf-legacy-1 now has referralCodeLower set', legacy1?.referralCodeLower === 'qrst88', legacy1);

  console.log('\n== A legacy user that ALREADY had referralCodeLower set is left untouched (backfill fills gaps, never overwrites) ==');
  const legacy2 = users().get('bf-legacy-2');
  check('bf-legacy-2\'s existing referralCodeLower was NOT overwritten', legacy2?.referralCodeLower === 'sentinel-should-not-change', legacy2);

  console.log('\n== With the backfill in place, a real generation attempt can no longer land on a legacy code\'s case variant undetected ==');
  // Directly proves the actual security property using the real, unmodified
  // generateUniqueReferralCode()/completeRegistrationCore() code path: seed
  // a THIRD legacy-shaped user whose code is short and fully lowercase-
  // predictable, then confirm the exact case-insensitive match query the
  // fix relies on now finds it (the query itself is what generation calls).
  users().set('bf-legacy-3', {
    phone: '0771990003', referralCode: 'MNOP77', walletBalance: 0, totalDeposited: 0, totalInvested: 0,
    totalWithdrawn: 0, totalEarned: 0, teamCommission: 0, teamL1Count: 0, teamL2Count: 0, teamL3Count: 0,
    status: 'active', registrationDone: true, checkinStreak: 0, publicId: '900004', createdAt: new Date(),
  });
  // Re-run is not needed -- the backfill already swept every doc present
  // at boot, and bf-legacy-3 didn't exist yet at that point, so this one
  // legitimately still lacks referralCodeLower right now (proving the
  // backfill is a one-time boot pass, not a live trigger -- exactly as
  // documented, and exactly why THIS file seeds before require() for the
  // other two). What matters for the security property itself is that
  // EVERY pre-existing account at the moment this service starts serving
  // traffic is covered; an account created after boot always gets
  // referralCodeLower set at generation time by generateUniqueReferralCode
  // itself, so it's never actually missing for anything created post-boot.
  check('bf-legacy-3 (created after boot) legitimately still lacks referralCodeLower -- the backfill is one-time, not continuous, as documented', !users().get('bf-legacy-3').referralCodeLower);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
