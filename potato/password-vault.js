'use strict';
// "Show password" for the OWNER: the member's password is kept a second time, LOCKED (AES-256-GCM, bound to the member's id), next to the one-way hash that
// the login uses. The hash is what protects the account; this copy exists only so the owner can read a password out to a member who asks for it.
//
// NOTHING for the owner to set up. The key is found like the Google Authenticator key (twofa-vault.js) but is a DIFFERENT key, in a different file, so
// neither can open the other's secrets:
//   1. PASSWORD_VIEW_KEY -- only if the owner ever chooses to set it.
//   2. /srv/potato-secrets/password-view.key -- made by the server itself the first time it starts there (32 random bytes, root only, outside git).
//      Never delete it: without it the stored copies cannot be opened any more (members still sign in; the owner would reset a password instead).
//   3. No secrets folder (a test run, a developer's computer): the ADMIN_KEY.
// A copy is made when a member signs up, changes or resets their password, and (for accounts that existed before this feature) the next time they sign in.
const crypto = require('crypto'), path = require('path');
const { makeKeyFile, createVault } = require('./twofa-vault');
const fs = require('fs');

const DOMAIN = 'potato-member-password-view-v1|';   // never change: it is part of every key that was ever made
const derive = text => crypto.createHash('sha256').update(DOMAIN + String(text)).digest();
const MIN_KEY_CHARS = 32;

function loadKeys(opts) {
  opts = opts || {};
  const env = opts.env || process.env, log = opts.log || console;
  const dir = env.POTATO_SECRETS_DIR || '/srv/potato-secrets';
  const file = opts.keyFile || env.PASSWORD_VIEW_KEY_FILE || path.join(dir, 'password-view.key');
  const list = [];
  const add = (text, from) => { const key = derive(text); if (!list.some(x => x.key.equals(key))) list.push({ key, from }); };
  const owner = env.PASSWORD_VIEW_KEY || '';
  if (owner) add(owner, 'PASSWORD_VIEW_KEY');
  let text = null, made = false;
  try {
    if (fs.existsSync(file)) text = fs.readFileSync(file, 'utf8').trim();
    else if (!owner && fs.existsSync(path.dirname(file))) { const r = makeKeyFile(file); text = r.text; made = r.won; }
    if (text !== null && text.length < MIN_KEY_CHARS) {
      log.error('password-view: ' + file + ' holds less than ' + MIN_KEY_CHARS + ' characters, so it is NOT used (and NOT replaced).');
      text = null;
    }
  } catch (e) { log.error('password-view: the key file ' + file + ' could not be read or made (' + e.message + ')'); text = null; }
  if (text) add(text, 'file');
  add(env.ADMIN_KEY || 'potato-dev', 'ADMIN_KEY');
  const source = list[0].from;
  if (made) log.log('password-view: made the key that locks the stored copies of members\' passwords: ' + file + ' (root only). Keep it with the other secrets and never delete it.');
  else if (source === 'ADMIN_KEY' && env.NODE_ENV === 'production') log.warn('password-view: no key file (' + file + ' and its folder are missing), so the stored copies are locked with the ADMIN_KEY.');
  return { keys: list.map(x => x.key), source, file, made };
}

function createPasswordVault(keys) {
  const v = createVault(keys);
  return {
    // `uid` binds the copy to one member: a copy moved onto another member's account does not open.
    seal: (uid, password) => v.seal('pw|' + uid, password),
    open: (uid, blob) => v.open('pw|' + uid, blob),
  };
}

module.exports = { loadKeys, createPasswordVault, derive };
