#!/usr/bin/env node
/**
 * FIREBASE_SERVICE_ACCOUNT: every way it can be wrong says which one it is.
 *
 * WHY THIS EXISTS. The check used to be
 *
 *     JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}')
 *     if (!serviceAccount.project_id) throw new Error('Missing project_id');
 *
 * so an UNSET variable and a MALFORMED one produced the same sentence -- '{}'
 * parses cleanly and carries no project_id. On the Railway migration that is
 * exactly the state the server was in, and the message sent us to re-copy a
 * credential that had never been pasted in the first place.
 *
 * This RUNS the real loadServiceAccount() out of server.js rather than reading
 * it: what matters is which sentence a given value produces, and a text match
 * on the source cannot tell a correct branch from one that always fires.
 *
 * The property being pinned is NOT the exact wording -- it is that the states
 * are DISTINGUISHABLE from each other, and that every genuinely bad value is
 * still refused. A message that is merely friendlier but still ambiguous is
 * the bug this file exists to prevent coming back.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const src = fs.readFileSync(path.join(HERE, 'server.js'), 'utf8');

let bad = 0;
const ck = (o, l) => { if (!o) bad++; console.log((o ? 'PASS  ' : 'FAIL  ') + l); };

const { loadServiceAccount, REQUIRED } = require(path.join(HERE, 'service-account'));

// The real function, called exactly as server.js calls it. No slicing: the
// validation lives in its own module precisely so this needs none. A brace
// counter cannot cut it out of server.js anyway -- its messages contain a
// literal closing brace and its checks contain regex literals holding quote
// characters, so a naive counter and a string-aware one both mis-slice it.
const load = v => loadServiceAccount(v);

const PEM = '-----BEGIN PRIVATE KEY-----\\nMIIBVgIBADANB\\n-----END PRIVATE KEY-----\\n';
const good = {
  type: 'service_account',
  project_id: 'chipz-23a4c',
  private_key_id: 'abc123',
  private_key: '-----BEGIN PRIVATE KEY-----\nMIIBVgIBADANB\n-----END PRIVATE KEY-----\n',
  client_email: 'firebase-adminsdk@chipz-23a4c.iam.gserviceaccount.com',
  client_id: '1234567890',
};
const goodJson = JSON.stringify(good);

console.log('— a real service account is accepted —');
{
  const r = load(goodJson);
  ck(!r.fatal, 'the whole file parses with no complaint');
  ck(r.sa && r.sa.project_id === 'chipz-23a4c', 'and the parsed account is handed back');
}
// Whitespace around a pasted value is the host's doing, not the operator's.
ck(!load('  ' + goodJson + '\n  ').fatal, 'surrounding whitespace is tolerated');

console.log('\n— the state the migration was actually in —');
const unset = load(undefined);
const empty = load('');
const braces = load('{}');
ck(!!unset.fatal, 'an unset variable is refused');
ck(/not set/i.test(unset.fatal), '  and is described as NOT SET, not as invalid');
ck(!/invalid/i.test(unset.fatal),
   '  so nobody is sent to re-copy a credential they never pasted');
ck(unset.fatal === empty.fatal, 'an empty string reads the same as unset');
ck(!!braces.fatal, 'a bare {} is still refused');
// THE regression this file is named after. Before the fix these two sentences
// were byte-identical, and that is what cost the deploy.
ck(unset.fatal !== braces.fatal,
   'AND "not set" and "{} with no fields" are DIFFERENT sentences');

console.log('\n— malformed JSON says what is wrong with the paste —');
// NOTE both quoting mistakes, because they take DIFFERENT paths and only one
// of them is a parse error. Escaped-and-wrapped is valid JSON that parses to a
// STRING; wrapped without escaping is a parse error that happens to start with
// a quote. A single "quoted" case would leave whichever path it missed
// reporting something that explains nothing.
const quotedValid = load(`"${goodJson.replace(/"/g, '\\"')}"`);
const quotedBroken = load(`"${goodJson}"`);
const multiline = load('{\n  "project_id": "chipz-23a4c",\n');
const truncated = load(goodJson.slice(0, 60));
const notObject = load('[1,2,3]');
for (const [r, what] of [[quotedValid, 'an escaped quote-wrapped value'],
                         [quotedBroken, 'a naively quote-wrapped value'],
                         [multiline, 'a value with line breaks'],
                         [truncated, 'a truncated paste'], [notObject, 'a JSON array']]) {
  ck(!!r.fatal, `${what} is refused`);
}
ck(/quoted string/i.test(quotedValid.fatal),
   '  the one that parses to a string says it was pasted quoted');
ck(/quote/i.test(quotedBroken.fatal), '  and the unparseable one also names the quote');
ck(/one line|line break/i.test(multiline.fatal), '  the multi-line one names the line breaks');
ck(/truncat|end/i.test(truncated.fatal), '  the truncated one says it looks cut short');
ck(/not a JSON object/i.test(notObject.fatal), '  an array is not mistaken for an account');
// Three different paste mistakes must not collapse into one sentence, or the
// hint is decoration.
ck(new Set([quotedValid.fatal, quotedBroken.fatal, multiline.fatal,
            truncated.fatal, notObject.fatal]).size === 5,
   'and the five paste mistakes are five different sentences');

console.log('\n— a partial account names EVERY missing field at once —');
{
  const noProject = Object.assign({}, good); delete noProject.project_id;
  const r = load(JSON.stringify(noProject));
  ck(!!r.fatal && /project_id/.test(r.fatal), 'a missing project_id is named');

  const bare = load(JSON.stringify({ type: 'service_account' }));
  ck(/project_id/.test(bare.fatal) && /client_email/.test(bare.fatal) &&
     /private_key/.test(bare.fatal),
     'all three missing fields are named in ONE message');
  // Reporting them one at a time is one redeploy per field to discover the
  // next one is also absent -- on a host where a deploy is minutes.
  ck(bare.fatal.split(',').length >= 2, '  rather than one per restart');
}

console.log('\n— the mangled private key, which fails later and reads as a PEM bug —');
{
  const litNewlines = Object.assign({}, good, { private_key: PEM });
  ck(!load(JSON.stringify(litNewlines)).fatal,
     'a key whose \\n survived JSON encoding is fine');
  const flattened = Object.assign({}, good, {
    private_key: good.private_key.replace(/\n/g, ' '),
  });
  ck(!load(JSON.stringify(flattened)).fatal,
     'and one with spaces for newlines still carries its PEM header, so it passes here');
  const notAKey = Object.assign({}, good, { private_key: 'hunter2' });
  const r = load(JSON.stringify(notAKey));
  ck(!!r.fatal && /PEM/i.test(r.fatal),
     'but a private_key that is not a PEM key at all is caught HERE');
  ck(/private_key/.test(r.fatal), '  and the field is named');
}

console.log('\n— it still refuses to boot, which is the point —');
// A server that cannot verify a member's ID token must not serve requests: it
// would treat every caller as unauthenticated, or worse, be made to.
{
  // Anchors are checked before they are used. An indexOf that misses returns
  // -1, and slicing from -1 silently yields a scrap of the file -- so a stale
  // anchor reads as "the code does not do this" rather than as a broken test.
  // That happened to this very block when the function moved into its module.
  const callAt = src.indexOf('loadServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT)');
  const initAt = src.indexOf('admin.initializeApp({ credential');
  const endAt = src.indexOf('── MONGODB ──', initAt);
  ck(callAt > -1, 'server.js calls loadServiceAccount with the env var');
  ck(initAt > callAt, 'and does it BEFORE initialising Firebase');
  ck(endAt > initAt, 'and the auth block ends where the Mongo block begins');
  if (callAt > -1 && initAt > callAt && endAt > initAt) {
    ck(/process\.exit\(1\)/.test(src.slice(callAt, initAt)),
       'a fatal verdict exits the process rather than carrying on');
    // Bounded to THIS block, not the rest of the file. Searched file-wide, the
    // regex matched an unrelated `catch (e)` 682,867 characters further on --
    // beside the MONGODB_URI exit -- so deleting this block's own exit went
    // undetected. Check inside the block, not across the file.
    ck(/catch \(e\) \{[\s\S]{0,400}?process\.exit\(1\)/.test(src.slice(initAt, endAt)),
       'and a cert() rejection exits too, instead of throwing an unhandled error');
  }
  ck(!/FIREBASE_SERVICE_ACCOUNT \|\| '\{\}'/.test(src),
     "the `|| '{}'` that caused all this is gone");
  // The module's own list is what gets checked, so a field added to cert()'s
  // requirements is added in one place.
  ck(REQUIRED.join(',') === 'project_id,client_email,private_key',
     'and the required-field list is the three cert() needs');
}

console.log(bad ? `\n${bad} FAILED` : '\nservice account: all cases pass');
process.exit(bad ? 1 : 0);
