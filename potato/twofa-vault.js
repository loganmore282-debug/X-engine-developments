'use strict';
// The key that locks every member's Google Authenticator secret (so none of them is ever readable in the database), and the locking itself.
//
// NOTHING for the owner to set up. The key is found in this order:
//   1. TWOFA_ENC_KEY -- only if the owner ever chooses to set it; then it is the key for new secrets.
//   2. A key file the server makes ITSELF the first time it starts on the VPS: 32 random bytes in /srv/potato-secrets/twofa.key. It is readable by root
//      only (mode 600), outside git, so a deploy (git pull) can never replace it, and it sits with the other secrets. Never delete it: without it every
//      member's authenticator setup is unreadable and the owner has to reset them one by one (Admin > Users > the member > Google Authenticator > Reset).
//   3. No secrets folder at all (a test run, a developer's computer): the ADMIN_KEY, which is how the first version of this feature worked.
// NEW secrets are always locked with the first key found. When something is OPENED every key is tried (the owner's, the file's, and the ADMIN_KEY one),
// so a member who set Google Authenticator up before the key file existed is never locked out when it appears.
// Locking = AES-256-GCM, bound to the member's id (a secret copied onto another member's account does not open). Backup codes are kept as keyed hashes.
const crypto = require('crypto'), fs = require('fs'), path = require('path');

const DOMAIN = 'potato-member-2fa-v1|';           // never change: it is part of every key that was ever made
const derive = text => crypto.createHash('sha256').update(DOMAIN + String(text)).digest();
const MIN_KEY_CHARS = 32;
const TAG_BYTES = 16, IV_BYTES = 12;

// Makes the key file only if it is not there yet, and safely even if several processes try at the same instant: the key is written and flushed to a
// private temporary file first, then linked into place (a link refuses to replace a file that exists), so the real name never holds half a key.
// Returns { text: what the real file holds, whoever made it, won: true only for the process whose key it is }.
function makeKeyFile(file) {
  const tmp = file + '.' + process.pid + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
  const fd = fs.openSync(tmp, 'wx', 0o600);
  try { fs.fchmodSync(fd, 0o600); fs.writeSync(fd, crypto.randomBytes(32).toString('hex') + '\n'); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  let won = false;
  try { fs.linkSync(tmp, file); won = true; }
  catch (e) { if (e.code !== 'EEXIST') throw e; }
  finally { try { fs.unlinkSync(tmp); } catch (_) {} }
  try { const d = fs.openSync(path.dirname(file), 'r'); try { fs.fsyncSync(d); } finally { fs.closeSync(d); } } catch (_) {}
  return { text: fs.readFileSync(file, 'utf8').trim(), won };
}

// Finds the keys. Never throws: whatever goes wrong is logged and the next source is used, so the server always starts.
// opts: { env, log, keyFile }.  Returns { keys: [Buffer, ...] (the first one locks new secrets), source, file, made }.
function loadKeys(opts) {
  opts = opts || {};
  const env = opts.env || process.env, log = opts.log || console;
  const dir = env.POTATO_SECRETS_DIR || '/srv/potato-secrets';
  const file = opts.keyFile || env.TWOFA_KEY_FILE || path.join(dir, 'twofa.key');
  const list = [];
  const add = (text, from) => { const key = derive(text); if (!list.some(x => x.key.equals(key))) list.push({ key, from }); };
  const owner = env.TWOFA_ENC_KEY || '';
  if (owner) add(owner, 'TWOFA_ENC_KEY');
  let text = null, made = false;
  try {
    if (fs.existsSync(file)) text = fs.readFileSync(file, 'utf8').trim();
    else if (!owner && fs.existsSync(path.dirname(file))) { const r = makeKeyFile(file); text = r.text; made = r.won; }
    if (text !== null && text.length < MIN_KEY_CHARS) {
      log.error('2-step: ' + file + ' holds less than ' + MIN_KEY_CHARS + ' characters, so it is NOT used (and NOT replaced -- something may be locked with it). Delete it only if no member has set up Google Authenticator.');
      text = null;
    }
  } catch (e) {
    log.error('2-step: the key file ' + file + ' could not be read or made (' + e.message + ')');
    text = null;
  }
  if (text) add(text, 'file');
  add(env.ADMIN_KEY || 'potato-dev', 'ADMIN_KEY');   // the first version's key: kept only so what it locked still opens
  const source = list[0].from;
  if (made) log.log('2-step: made the key that locks members\' Google Authenticator secrets: ' + file + ' (root only). Keep it with the other secrets and never delete it.');
  else if (source === 'ADMIN_KEY' && env.NODE_ENV === 'production') log.warn('2-step: no key file (' + file + ' and its folder are missing or unusable), so members\' Google Authenticator secrets are locked with a key made from ADMIN_KEY. Fix the folder and restart.');
  return { keys: list.map(x => x.key), source, file, made };
}

// The locking. `keys[0]` seals; every key is tried when opening.
function createVault(keys) {
  if (!Array.isArray(keys) || !keys.length || !keys.every(k => Buffer.isBuffer(k) && k.length === 32)) throw new Error('twofa-vault: needs one or more 32-byte keys');
  const aad = userId => Buffer.from('2fa|' + userId);
  return {
    seal(userId, plain) {
      const iv = crypto.randomBytes(IV_BYTES), c = crypto.createCipheriv('aes-256-gcm', keys[0], iv, { authTagLength: TAG_BYTES });
      c.setAAD(aad(userId));
      const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
      return 'v1.' + iv.toString('base64url') + '.' + c.getAuthTag().toString('base64url') + '.' + ct.toString('base64url');
    },
    // null for anything that does not open: wrong key, another member's account, a changed byte, a shortened tag, rubbish.
    open(userId, blob) {
      const [v, ivText, tagText, ctText, extra] = String(blob == null ? '' : blob).split('.');
      if (v !== 'v1' || !ivText || !tagText || !ctText || extra !== undefined) return null;
      const iv = Buffer.from(ivText, 'base64url'), tag = Buffer.from(tagText, 'base64url'), ct = Buffer.from(ctText, 'base64url');
      if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) return null;
      for (const key of keys) {
        try {
          const d = crypto.createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
          d.setAAD(aad(userId)); d.setAuthTag(tag);
          return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
        } catch (_) { /* not this key */ }
      }
      return null;
    },
    // The stored form of a backup code under each key, the first being the one used for new codes. `norm` is the code already tidied by the caller.
    backupHashes(userId, norm) {
      return keys.map(k => crypto.createHmac('sha256', k).update('backup|' + userId + '|' + norm).digest('hex'));
    },
  };
}

module.exports = { loadKeys, createVault, makeKeyFile, derive };
