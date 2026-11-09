'use strict';
// The lock and unlock of the FIRST version of the Google Authenticator feature (commit 644f587), copied as it shipped, with its key made from the ADMIN_KEY.
// The tests use it to prove that a secret locked back then still opens now, and that what the vault locks stays readable by that code.
const crypto = require('crypto');
const key = text => crypto.createHash('sha256').update('smartai-member-2fa-v1|' + text).digest();
function seal(k, userId, plain) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', k, iv);
  c.setAAD(Buffer.from('2fa|' + userId));
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return 'v1.' + iv.toString('base64url') + '.' + c.getAuthTag().toString('base64url') + '.' + ct.toString('base64url');
}
function open(k, userId, blob) {
  try {
    const [v, iv, tag, ct] = String(blob || '').split('.');
    if (v !== 'v1' || !iv || !tag || !ct) return null;
    const d = crypto.createDecipheriv('aes-256-gcm', k, Buffer.from(iv, 'base64url'));
    d.setAAD(Buffer.from('2fa|' + userId)); d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
  } catch (_) { return null; }
}
const backupHash = (k, userId, norm) => crypto.createHmac('sha256', k).update('backup|' + userId + '|' + norm).digest('hex');
module.exports = { key, seal, open, backupHash };
