'use strict';
// The admin push key is brought over once from a sibling app's secrets file (push-key.js): every branch, against a temp folder.
//   node test-push-key.js
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert/strict');
const { borrowPushKey, isKeyFor } = require('./push-key');
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); }; const eq = (a, b, m) => { n++; assert.deepEqual(a, b, m); };
const sa = (project, extra) => JSON.stringify(Object.assign({ type: 'service_account', project_id: project, client_email: 'x@' + project + '.iam.gserviceaccount.com', private_key: '-----BEGIN PRIVATE KEY-----\nAAA\n-----END PRIVATE KEY-----\n' }, extra || {}));
const world = spec => {   // spec: { 'soda-secrets': { FIREBASE_SERVICE_ACCOUNT: '...', MONGODB_URI: '...' }, ... }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pk-'));
  for (const [dir, vars] of Object.entries(spec)) { fs.mkdirSync(path.join(root, dir)); fs.writeFileSync(path.join(root, dir, 'secrets.local.js'), Object.entries(vars).map(([k, v]) => 'module.exports.' + k + ' = ' + JSON.stringify(v) + ';\n').join(''), { mode: 0o600 }); }
  return { root, own: path.join(root, 'smartai-secrets', 'secrets.local.js') };
};
const readOwn = w => { delete require.cache[require.resolve(w.own)]; return require(w.own); };
const KEY = sa('chnpetrol');

ok(isKeyFor(KEY, 'chnpetrol') && !isKeyFor(sa('other'), 'chnpetrol') && !isKeyFor('not json', 'chnpetrol') && !isKeyFor(sa('chnpetrol', { private_key: '' }), 'chnpetrol'), 'only a whole key of the right Firebase project is accepted');
// 1. taken from Soda, saved, nothing else copied
let w = world({ 'soda-secrets': { FIREBASE_SERVICE_ACCOUNT: KEY, MONGODB_URI: 'mongodb://secret-soda', ADMIN_KEY: 'soda-admin' }, 'smartai-secrets': { MONGODB_URI: 'mongodb://smartai' } });
let r = borrowPushKey({ root: w.root, ownFile: w.own, project: 'chnpetrol' });
ok(r && r.from === 'soda-secrets' && r.saved && r.value === KEY, 'the key is taken from Soda and saved');
let own = readOwn(w);
eq([own.FIREBASE_SERVICE_ACCOUNT, own.MONGODB_URI, own.ADMIN_KEY], [KEY, 'mongodb://smartai', undefined], 'Smart AI\'s own line is there, its own other secrets are untouched, and nothing else was copied from Soda');
ok((fs.statSync(w.own).mode & 0o777) === 0o600, 'the secrets file stays private (600)');
ok(fs.existsSync(w.own + '.prev'), 'the old file is kept as .prev');
eq(borrowPushKey({ root: w.root, ownFile: w.own, project: 'chnpetrol' }), null, 'the second start finds it already there and does nothing');
// 2. never overwrites a key Smart AI already has
w = world({ 'soda-secrets': { FIREBASE_SERVICE_ACCOUNT: KEY }, 'smartai-secrets': { FIREBASE_SERVICE_ACCOUNT: sa('mine') } });
eq(borrowPushKey({ root: w.root, ownFile: w.own, project: 'chnpetrol' }), null, 'a key Smart AI already has (even a wrong one) is never replaced');
eq(readOwn(w).FIREBASE_SERVICE_ACCOUNT, sa('mine'), 'and its file is unchanged');
// 3. wrong-project and broken keys are skipped, Soda first, then the others in order
w = world({ 'cookie-secrets': { FIREBASE_SERVICE_ACCOUNT: sa('other') }, 'mint-secrets': { FIREBASE_SERVICE_ACCOUNT: 'not json' }, 'potato-secrets': { FIREBASE_SERVICE_ACCOUNT: KEY }, 'smartai-secrets': {} });
r = borrowPushKey({ root: w.root, ownFile: w.own, project: 'chnpetrol' }); ok(r && r.from === 'potato-secrets', 'a key of another Firebase project, or an unreadable one, is skipped');
w = world({ 'cookie-secrets': { FIREBASE_SERVICE_ACCOUNT: KEY }, 'soda-secrets': { FIREBASE_SERVICE_ACCOUNT: KEY }, 'smartai-secrets': {} });
r = borrowPushKey({ root: w.root, ownFile: w.own, project: 'chnpetrol' }); ok(r && r.from === 'soda-secrets', 'Soda is asked first');
// 4. nothing to find
w = world({ 'soda-secrets': { FIREBASE_SERVICE_ACCOUNT: sa('other') }, 'smartai-secrets': {} });
eq(borrowPushKey({ root: w.root, ownFile: w.own, project: 'chnpetrol' }), null, 'no key of the right project anywhere: nothing happens');
eq(borrowPushKey({ root: path.join(os.tmpdir(), 'no-such-folder-' + Date.now()), ownFile: w.own, project: 'chnpetrol' }), null, 'no /srv at all: nothing happens');
w = world({ 'soda-secrets': { MONGODB_URI: 'x' }, 'smartai-secrets': {} });
eq(borrowPushKey({ root: w.root, ownFile: w.own, project: 'chnpetrol' }), null, 'a sibling with no push key is no help');
// 5. folders that are not an app's secrets folder are never read
w = world({ 'backup': { FIREBASE_SERVICE_ACCOUNT: KEY }, 'smartai-secrets': {} });
eq(borrowPushKey({ root: w.root, ownFile: w.own, project: 'chnpetrol' }), null, 'only /srv/<app>-secrets folders are looked in');
// 6. own file cannot be written: the key still serves this run
w = world({ 'soda-secrets': { FIREBASE_SERVICE_ACCOUNT: KEY } });
r = borrowPushKey({ root: w.root, ownFile: w.own, project: 'chnpetrol' }); ok(r && r.value === KEY && r.saved === false, 'if the file cannot be written the key is still used for this run (and borrowed again next start)');
// wiring in the server
const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
ok(src.indexOf("require('./push-key').borrowPushKey") > src.indexOf("const PUSH_PROJECT = 'chnpetrol';") && src.indexOf("require('./push-key').borrowPushKey") < src.indexOf('if (process.env.FIREBASE_SERVICE_ACCOUNT) {\n  try {\n    const { sa: pushSa'), 'the server looks for the key at start-up, before it decides whether push is on');
ok(/project: PUSH_PROJECT/.test(src), 'and only accepts a key of the admin panel\'s own Firebase project');
console.log(`PASS: the push key is brought over from a sibling app once (${n} checks)`);
