'use strict';
// twofa-vault.js: the key that locks the members' Google Authenticator secrets is made by the server itself (nothing for the owner to set up), and a secret
// locked by the first version of the feature (key made from the ADMIN_KEY) still opens. Checked against a verbatim copy of that first version's own lock and
// unlock code (test-helpers/twofa-first-version.js), including the key file being made by many processes at the very same moment.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const vault = require('./twofa-vault.js'), first = require('./test-helpers/twofa-first-version.js');
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); }; const eq = (a, b, m) => { n++; assert.deepEqual(a, b, m); };
const sink = () => { const l = { log: [], error: [], warn: [] }; return { l, log: { log: s => l.log.push(String(s)), error: s => l.error.push(String(s)), warn: s => l.warn.push(String(s)) } }; };
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'twofa-vault-'));
const ADMIN = 'tf-admin-key-123456', NORM = 'ABCDE23456';
const hex = b => b.toString('hex');
const modeOf = f => fs.statSync(f).mode & 0o777;

// ---- 1. compatible with the first version, in both directions
{
  const oldKey = first.key(ADMIN);
  const r = vault.loadKeys({ env: { ADMIN_KEY: ADMIN, SMARTAI_SECRETS_DIR: '/nonexistent/smartai-secrets' }, log: sink().log });
  eq(r.source, 'ADMIN_KEY', 'no secrets folder: the ADMIN_KEY is the key, as in the first version');
  ok(r.keys.length === 1 && r.keys[0].equals(oldKey), 'and it is exactly the key the first version made');
  const v = vault.createVault(r.keys);
  const blob = first.seal(oldKey, 'u-1', 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP');
  eq(v.open('u-1', blob), 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP', 'a secret locked by the first version opens');
  eq(first.open(oldKey, 'u-1', v.seal('u-1', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567')), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', 'and what this one locks opens with the first version\'s code (same format)');
  eq(v.backupHashes('u-1', NORM)[0], first.backupHash(oldKey, 'u-1', NORM), 'a backup code is kept in the same form as the first version kept it');
  // the first version with TWOFA_ENC_KEY set
  const own = 'a-long-random-text-the-owner-chose';
  const r2 = vault.loadKeys({ env: { ADMIN_KEY: ADMIN, TWOFA_ENC_KEY: own, SMARTAI_SECRETS_DIR: '/nonexistent/smartai-secrets' }, log: sink().log });
  ok(r2.source === 'TWOFA_ENC_KEY' && r2.keys[0].equals(first.key(own)), 'TWOFA_ENC_KEY, if the owner ever sets it, is the key for new secrets, derived as before');
  eq(vault.createVault(r2.keys).open('u-2', first.seal(first.key(own), 'u-2', 'SECRET')), 'SECRET', 'and what the first version locked with it opens');
  // no ADMIN_KEY at all (the first version fell back to a fixed text)
  const r3 = vault.loadKeys({ env: { SMARTAI_SECRETS_DIR: '/nonexistent/smartai-secrets' }, log: sink().log });
  ok(r3.keys.length === 1 && r3.keys[0].equals(first.key('smartai-dev')), 'with no ADMIN_KEY either, the same fallback as the first version');
}

// ---- 2. locking and unlocking
{
  const v = vault.createVault([first.key('k1')]);
  for (let i = 0; i < 200; i++) {
    const uid = 'user-' + i + '-é', secret = totpLike();
    const blob = v.seal(uid, secret);
    ok(/^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$/.test(blob), 'the stored form is v1.iv.tag.ciphertext');
    ok(v.open(uid, blob) === secret, 'locked then opened gives the secret back');
    ok(!blob.includes(secret), 'and the secret is not in the stored text');
  }
  ok(v.seal('u', 'S') !== v.seal('u', 'S'), 'locking the same thing twice gives different text (a fresh random value each time)');
  const blob = v.seal('alice', 'JBSWY3DPEHPK3PXP'), parts = blob.split('.');
  eq(v.open('bob', blob), null, 'a secret copied onto another member\'s account does not open');
  const flip = s => (s[0] === 'A' ? 'B' : 'A') + s.slice(1);
  eq(v.open('alice', ['v1', flip(parts[1]), parts[2], parts[3]].join('.')), null, 'a changed first byte of the random value does not open');
  eq(v.open('alice', ['v1', parts[1], flip(parts[2]), parts[3]].join('.')), null, 'a changed tag does not open');
  eq(v.open('alice', ['v1', parts[1], parts[2], flip(parts[3])].join('.')), null, 'a changed ciphertext does not open');
  const tag = Buffer.from(parts[2], 'base64url');
  eq(v.open('alice', ['v1', parts[1], tag.subarray(0, 4).toString('base64url'), parts[3]].join('.')), null, 'a tag cut down to 4 bytes is refused (that would be forgeable)');
  eq(v.open('alice', ['v1', parts[1], tag.subarray(0, 12).toString('base64url'), parts[3]].join('.')), null, 'a tag cut down to 12 bytes is refused too');
  eq(v.open('alice', blob + '.x'), null, 'an extra part is refused');
  eq(v.open('alice', 'v2.' + parts.slice(1).join('.')), null, 'another version is refused');
  eq(v.open('alice', ['v1', parts[1].slice(0, 8), parts[2], parts[3]].join('.')), null, 'a short random value is refused');
  for (const junk of [null, undefined, '', 'v1', 'v1..', 'v1.a.b', 'a.b.c.d', 123, {}, [], true, '...', 'v1.%%%.%%%.%%%']) eq(v.open('alice', junk), null, 'rubbish never opens and never throws: ' + JSON.stringify(junk));
  eq(vault.createVault([first.key('other')]).open('alice', blob), null, 'another key does not open it');
  for (const bad of [undefined, null, [], [Buffer.alloc(31)], ['text'], [Buffer.alloc(32), 'x'], 'abc']) {
    let threw = false; try { vault.createVault(bad); } catch (_) { threw = true; }
    ok(threw, 'a vault needs real 32-byte keys: ' + JSON.stringify(bad));
  }
}
function totpLike() { const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let s = ''; for (let i = 0; i < 32; i++) s += A[crypto.randomInt(32)]; return s; }

// ---- 3. several keys: the first one locks new secrets, every one opens
{
  const A = first.key('A'), B = first.key('B');
  const vA = vault.createVault([A]), vBA = vault.createVault([B, A]), vB = vault.createVault([B]);
  const blobA = vA.seal('u', 'OLD-SECRET'), blobB = vBA.seal('u', 'NEW-SECRET');
  eq(vBA.open('u', blobA), 'OLD-SECRET', 'a secret locked with the earlier key still opens when a newer key is added');
  eq(vBA.open('u', blobB), 'NEW-SECRET', 'and the newer key opens what it locked');
  eq(vB.open('u', blobB), 'NEW-SECRET', 'new secrets are locked with the FIRST key only');
  eq(vA.open('u', blobB), null, 'so the earlier key alone cannot open them');
  const hs = vBA.backupHashes('u', NORM);
  ok(hs.length === 2 && hs[0] === vB.backupHashes('u', NORM)[0] && hs[1] === vA.backupHashes('u', NORM)[0] && hs[0] !== hs[1], 'a backup code has one stored form per key, the first key\'s first');
  ok(vA.backupHashes('u', NORM)[0] !== vA.backupHashes('v', NORM)[0] && vA.backupHashes('u', NORM)[0] !== vA.backupHashes('u', 'ABCDE23457')[0], 'a backup code\'s form depends on the member and on the code');
}

// ---- 4. finding the key
{
  // 4a. a folder that exists, no key file yet: the server makes it
  const dir = tmpDir(), file = path.join(dir, 'twofa.key'), s = sink();
  const oldMask = process.umask(0);
  const r = vault.loadKeys({ env: { ADMIN_KEY: ADMIN }, keyFile: file, log: s.log });
  process.umask(oldMask);
  const text = fs.readFileSync(file, 'utf8');
  ok(/^[0-9a-f]{64}\n$/.test(text), 'the key file holds 32 random bytes as 64 hex characters');
  eq(modeOf(file), 0o600, 'readable and writable by its owner only, even with a wide-open umask');
  eq(fs.readdirSync(dir), ['twofa.key'], 'nothing else is left in the folder (no temporary file)');
  ok(r.made === true && r.source === 'file' && r.keys.length === 2 && r.keys[0].equals(first.key(text.trim())) && r.keys[1].equals(first.key(ADMIN)), 'the file\'s key is the first (new secrets), the ADMIN_KEY one is kept only for opening');
  ok(s.l.log.length === 1 && s.l.log[0].includes(file) && !s.l.log.join('').includes(text.trim()) && !s.l.error.length && !s.l.warn.length, 'one line says where it is, and the key itself is never written to a log');
  // 4b. the next start uses the same key and does not touch the file
  const m1 = fs.statSync(file).mtimeMs, ino = fs.statSync(file).ino, s2 = sink();
  const r2 = vault.loadKeys({ env: { ADMIN_KEY: ADMIN }, keyFile: file, log: s2.log });
  ok(r2.made === false && r2.keys[0].equals(r.keys[0]) && fs.readFileSync(file, 'utf8') === text && fs.statSync(file).mtimeMs === m1 && fs.statSync(file).ino === ino, 'the next start reads the same key and leaves the file alone');
  ok(!s2.l.log.length && !s2.l.error.length && !s2.l.warn.length, 'and says nothing');
  // 4c. the file's key keeps working when the ADMIN_KEY is changed later
  const r3 = vault.loadKeys({ env: { ADMIN_KEY: 'a-brand-new-admin-password' }, keyFile: file, log: sink().log });
  const blob = vault.createVault(r.keys).seal('u', 'SECRET');
  eq(vault.createVault(r3.keys).open('u', blob), 'SECRET', 'changing the ADMIN_KEY later does not lock anybody out (the whole point of a key of its own)');
  // 4d. a secret locked by the first version (ADMIN_KEY) opens now that the file exists
  eq(vault.createVault(r.keys).open('u9', first.seal(first.key(ADMIN), 'u9', 'FIRST-VERSION')), 'FIRST-VERSION', 'a member who set it up before the key file existed is not locked out when it appears');
  // 4e. the owner sets TWOFA_ENC_KEY later: both the file's and the owner's keys open
  const r4 = vault.loadKeys({ env: { ADMIN_KEY: ADMIN, TWOFA_ENC_KEY: 'owner-chosen-text' }, keyFile: file, log: sink().log });
  ok(r4.source === 'TWOFA_ENC_KEY' && r4.keys.length === 3 && vault.createVault(r4.keys).open('u', blob) === 'SECRET', 'TWOFA_ENC_KEY set later becomes the key for new secrets and the file\'s key still opens the old ones');
  // 4f. TWOFA_ENC_KEY set from the start: no file is made
  const dir2 = tmpDir(), s5 = sink();
  const r5 = vault.loadKeys({ env: { ADMIN_KEY: ADMIN, TWOFA_ENC_KEY: 'owner-chosen-text' }, keyFile: path.join(dir2, 'twofa.key'), log: s5.log });
  ok(r5.source === 'TWOFA_ENC_KEY' && fs.readdirSync(dir2).length === 0 && !s5.l.log.length, 'with TWOFA_ENC_KEY set from the start the server makes no file');
}
{
  // 4g. no secrets folder (a test run, a developer's computer): the ADMIN_KEY, quietly; loudly on the real server
  const missing = path.join(tmpDir(), 'no-such-folder', 'twofa.key'), s = sink();
  const r = vault.loadKeys({ env: { ADMIN_KEY: ADMIN }, keyFile: missing, log: s.log });
  ok(r.source === 'ADMIN_KEY' && r.keys.length === 1 && !fs.existsSync(path.dirname(missing)) && !s.l.warn.length && !s.l.error.length, 'no folder: it uses the ADMIN_KEY, makes no folder and makes no noise outside production');
  const sp = sink(); vault.loadKeys({ env: { ADMIN_KEY: ADMIN, NODE_ENV: 'production' }, keyFile: missing, log: sp.log });
  ok(sp.l.warn.length === 1 && sp.l.warn[0].includes(missing), 'in production the same situation is warned about, once, naming the file');
  // 4h. a short file is not used and not replaced
  const dir = tmpDir(), file = path.join(dir, 'twofa.key'), s2 = sink(); fs.writeFileSync(file, 'abc');
  const r2 = vault.loadKeys({ env: { ADMIN_KEY: ADMIN }, keyFile: file, log: s2.log });
  ok(r2.source === 'ADMIN_KEY' && fs.readFileSync(file, 'utf8') === 'abc' && s2.l.error.length === 1 && s2.l.error[0].includes(file), 'a file with too little in it is not used and is NOT replaced (something may be locked with it), and the owner is told');
  // 4i. things that go wrong never stop the server starting
  const dirAsFile = path.join(tmpDir(), 'twofa.key'); fs.mkdirSync(dirAsFile);
  const s3 = sink(); let r3; try { r3 = vault.loadKeys({ env: { ADMIN_KEY: ADMIN }, keyFile: dirAsFile, log: s3.log }); } catch (e) { r3 = { threw: e }; }
  ok(!r3.threw && r3.source === 'ADMIN_KEY' && s3.l.error.length === 1, 'a folder where the file should be: logged, ADMIN_KEY used, no crash');
  const notDir = path.join(tmpDir(), 'plain-file'); fs.writeFileSync(notDir, 'x');
  const s4 = sink(); let r4; try { r4 = vault.loadKeys({ env: { ADMIN_KEY: ADMIN }, keyFile: path.join(notDir, 'twofa.key'), log: s4.log }); } catch (e) { r4 = { threw: e }; }
  ok(!r4.threw && r4.source === 'ADMIN_KEY', 'a path that cannot hold a file: no crash, ADMIN_KEY used');
  // 4j. where the file is looked for
  const dirEnv = tmpDir(); const r5 = vault.loadKeys({ env: { ADMIN_KEY: ADMIN, SMARTAI_SECRETS_DIR: dirEnv }, log: sink().log });
  ok(r5.file === path.join(dirEnv, 'twofa.key') && fs.existsSync(r5.file) && r5.source === 'file', 'SMARTAI_SECRETS_DIR (the folder the VPS scripts use) decides the folder; the file is twofa.key in it');
  const dirEnv2 = tmpDir(); const own = path.join(dirEnv2, 'mine.key'); const r6 = vault.loadKeys({ env: { ADMIN_KEY: ADMIN, TWOFA_KEY_FILE: own, SMARTAI_SECRETS_DIR: dirEnv }, log: sink().log });
  ok(r6.file === own && fs.existsSync(own), 'TWOFA_KEY_FILE names the file itself');
  eq(vault.loadKeys({ env: {}, log: sink().log }).file, '/srv/smartai-secrets/twofa.key', 'by default: /srv/smartai-secrets/twofa.key, next to the other secrets');
}

// ---- 5. the file made by many processes at the very same moment: one key, whoever wins
const kidCode = `
const v = require(process.argv[1]); const START = Number(process.argv[2]);
while (Date.now() < START) {}
const r = v.loadKeys({ env: { ADMIN_KEY: 'x' }, keyFile: process.argv[3], log: { log() {}, warn() {}, error(e) { console.error(e); } } });
console.log(JSON.stringify({ k: require('crypto').createHash('sha256').update(r.keys[0]).digest('hex'), made: r.made, source: r.source, count: r.keys.length }));
`;
const runKid = (file, start) => new Promise((resolve, reject) => {
  const p = spawn(process.execPath, ['-e', kidCode, path.join(__dirname, 'twofa-vault.js'), String(start), file], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = ''; p.stdout.on('data', d => out += d); p.stderr.on('data', d => err += d);
  p.on('error', reject); p.on('close', code => code === 0 ? resolve(JSON.parse(out)) : reject(new Error('child exited ' + code + ': ' + err)));
});
(async () => {
  for (let round = 0; round < 6; round++) {
    const dir = tmpDir(), file = path.join(dir, 'twofa.key'), start = Date.now() + 900;
    const res = await Promise.all(Array.from({ length: 16 }, () => runKid(file, start)));
    ok(new Set(res.map(r => r.k)).size === 1, 'round ' + round + ': all 16 processes ended up with the same key');
    ok(res.filter(r => r.made).length === 1, 'round ' + round + ': exactly one of them made the file');
    ok(res.every(r => r.source === 'file' && r.count === 2), 'round ' + round + ': and every one is using it');
    eq(fs.readdirSync(dir), ['twofa.key'], 'round ' + round + ': no temporary file is left behind');
    ok(/^[0-9a-f]{64}\n$/.test(fs.readFileSync(file, 'utf8')) && modeOf(file) === 0o600, 'round ' + round + ': and the file is complete and private');
    ok(res[0].k === crypto.createHash('sha256').update(first.key(fs.readFileSync(file, 'utf8').trim())).digest('hex'), 'round ' + round + ': it is the key in the file');
  }
  console.log('test-twofa-vault: ' + n + ' checks passed');
})().catch(e => { console.error(e); process.exit(1); });
