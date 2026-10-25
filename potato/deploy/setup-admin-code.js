'use strict';
// Switches the admin panel's 6-digit authenticator code on (or off). Nothing is saved until the code typed from the phone is proven right,
// so a mistake can never lock the owner out.   node deploy/setup-admin-code.js        (on)    node deploy/setup-admin-code.js off
const fs = require('fs'), readline = require('readline'), { spawnSync } = require('child_process');
const totp = require('../totp');
const FILE = process.env.POTATO_SECRETS_FILE || '/srv/potato-secrets/secrets.local.js';
const LINE = /^module\.exports\.ADMIN_TOTP_SECRET\s*=.*$\n?/gm;
const read = () => { try { return fs.readFileSync(FILE, 'utf8'); } catch (e) { return null; } };
const cur = read();
if (cur === null) { console.error('Cannot find the secrets file ' + FILE); process.exit(1); }
if (process.argv[2] === 'off') {
  // Written as an EMPTY value, not deleted: pm2's `reload --update-env` adds and changes variables but does not remove ones that disappeared, so a deleted line could leave the code switched on.
  fs.writeFileSync(FILE, cur.replace(LINE, '').replace(/\n*$/, '\n') + "module.exports.ADMIN_TOTP_SECRET = '';\n", { mode: 0o600 });
  console.log('The admin 6-digit code is switched OFF (the admin key alone works again). Restart Potato to apply.');
  process.exit(0);
}
const secret = totp.generateSecret();
const label = encodeURIComponent('Potato Admin');
const url = `otpauth://totp/${label}?secret=${secret}&issuer=Potato&digits=6&period=30`;
console.log('\n1) Install "Google Authenticator" (or Microsoft Authenticator) on your phone.');
console.log('2) In it tap  +  ->  "Enter a setup key"  (or scan the picture below).');
console.log('   Account name: Potato Admin     Type: time based\n');
console.log('   SETUP KEY:   ' + secret.match(/.{1,4}/g).join(' ') + '\n');
const qr = spawnSync('qrencode', ['-t', 'ANSIUTF8', url], { encoding: 'utf8' });
if (qr.status === 0) console.log(qr.stdout); else console.log('(no QR picture on this server; typing the setup key above works the same)\n');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('3) Type the 6-digit number the app now shows for "Potato Admin" and press Enter: ', answer => {
  rl.close();
  const v = totp.verify(secret, String(answer).replace(/\s/g, ''), Date.now(), -1, 1);
  if (!v.ok) { console.log('\nThat number is not right. NOTHING was changed. Run the command again and use the new setup key.'); process.exit(2); }
  fs.writeFileSync(FILE, cur.replace(LINE, '').replace(/\n*$/, '\n') + `module.exports.ADMIN_TOTP_SECRET = '${secret}';\n`, { mode: 0o600 });
  console.log('\nCorrect. The admin 6-digit code is saved. After Potato restarts, the admin login asks for the admin key AND the number from the app.');
  console.log('If you ever lose the phone, run:  node /srv/potato-src/potato/deploy/setup-admin-code.js off   (then restart Potato).');
  process.exit(0);
});
