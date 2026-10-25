'use strict';
// Saves ONE secret into the VPS secrets file without it ever appearing on screen, in the shell history or in a chat.
//   node deploy/set-secret.js PESAJET_API_KEY      (then paste the value, nothing is shown as you type, press Enter)
// Non-interactive form for values that are not secret (used by deploy/change-app-host.sh):  POTATO_SECRET_VALUE=... node deploy/set-secret.js PUBLIC_URL
const fs = require('fs'), readline = require('readline');
const FILE = process.env.POTATO_SECRETS_FILE || '/srv/potato-secrets/secrets.local.js';
const name = process.argv[2] || '';
const ALLOWED = /^[A-Z][A-Z0-9_]{2,60}$/;
if (!ALLOWED.test(name)) { console.error('Give the secret\'s name in capitals, e.g. PESAJET_API_KEY'); process.exit(1); }
let cur; try { cur = fs.readFileSync(FILE, 'utf8'); } catch (e) { console.error('Cannot find the secrets file ' + FILE); process.exit(1); }
const save = value => {
  const lineRe = new RegExp('^module\\.exports\\.' + name + '\\s*=.*$\\n?', 'gm');
  fs.copyFileSync(FILE, FILE + '.prev');
  fs.writeFileSync(FILE, cur.replace(lineRe, '').replace(/\n*$/, '\n') + 'module.exports.' + name + ' = ' + JSON.stringify(value) + ';\n', { mode: 0o600 });
  console.log('Saved ' + name + ' (' + value.length + ' characters). The old file is kept as secrets.local.js.prev until you delete it.');
};
if (process.env.POTATO_SECRET_VALUE) { save(String(process.env.POTATO_SECRET_VALUE).replace(/[\r\n]/g, '').trim()); process.exit(0); }
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
rl._writeToOutput = s => { if (s.includes('\n') || s.includes(name)) process.stdout.write(s); };
rl.question('Paste the value for ' + name + ' (it will not be shown), then press Enter: ', answer => {
  rl.close(); const value = String(answer).replace(/[\r\n]/g, '').trim();
  console.log('');
  if (!value) { console.log('Nothing entered. NOTHING was changed.'); process.exit(2); }
  save(value);
  process.exit(0);
});
