#!/usr/bin/env node
/**
 * The referral-code rule, exercised against the REAL code from server.js and
 * user-src/original_module.js rather than a paraphrase.
 *
 * The owner's rule is that a referral code is a MUST. Taken literally that
 * makes the platform impossible to launch: the first person to sign up has
 * no code to type, and without them nobody else ever gets one either -- the
 * owner's own question, "how to create user account yet no referral code???"
 *
 * So the requirement resolves from TWO things: the admin setting, and
 * whether any member exists yet. This pins that resolution, and pins the app
 * to the same answer the server will act on.
 */
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/server.js', 'utf8');
const userSrc = fs.readFileSync(__dirname + '/user-src/original_module.js', 'utf8');

let failed = 0;
const check = (ok, label) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); };

// --- the server's resolver, with getSettings/db swapped for the scenario ---
function makeResolver({ setting, membersExist, readFails }) {
  let _anyMemberExists = false;
  const getSettings = async () => ({ requireReferralCode: setting });
  const db = { collection: () => ({ where: () => ({ limit: () => ({ get: async () => {
    if (readFails) throw new Error('mongo down');
    return { empty: !membersExist };
  } }) }) }) };
  eval(src.slice(src.indexOf('async function anyMemberExists'), src.indexOf('// Shared by the member\'s own /register')));
  return { referralRequiredNow, latch: () => { _anyMemberExists = true; } };
}

(async () => {
  console.log('— when a code is required —');
  for (const [scenario, expected, label] of [
    [{ setting: true,  membersExist: false }, false, 'brand-new platform, nobody registered: the founder gets in'],
    [{ setting: true,  membersExist: true  }, true,  'once one member exists, a code is required'],
    [{ setting: false, membersExist: true  }, false, 'admin switched the rule off: code optional again'],
    [{ setting: false, membersExist: false }, false, 'off and empty: still optional'],
    [{ setting: undefined, membersExist: true }, true, 'setting absent (old database) defaults to required'],
    [{ setting: true, membersExist: false, readFails: true }, true,
      'a failed database read must NOT hand out the founder exemption'],
  ]) check(await makeResolver(scenario).referralRequiredNow() === expected, label);

  console.log('\n— the exemption closes for good —');
  const r = makeResolver({ setting: true, membersExist: false });
  check(await r.referralRequiredNow() === false, 'before the first sign-up: not required');
  r.latch(); // what /register does the moment a registration commits
  check(await r.referralRequiredNow() === true, 'immediately after the first member registers: required');

  console.log('\n— the app agrees with the server —');
  eval(userSrc.slice(userSrc.indexOf('function referralIsRequired'), userSrc.indexOf('// Says out loud whether')));
  // referralIsRequired() reads STATE, so it must close over THIS binding --
  // reassigning a global would leave the eval'd function looking elsewhere.
  var STATE = {};
  for (const [settings, expected, label] of [
    [{ referralRequired: true },  true,  'server says required -> app requires it'],
    [{ referralRequired: false }, false, 'server says optional -> app allows an empty box'],
    [{}, true, 'flag missing -> app assumes required rather than letting a doomed sign-up through'],
    [null, true, 'settings never loaded -> still required'],
  ]) { STATE.settings = settings; check(referralIsRequired() === expected, label); }

  console.log(failed ? `\n${failed} FAILED` : '\nall referral-rule cases pass');
  process.exit(failed ? 1 : 0);
})();
