'use strict';
// Copies ONE secret from another app's secrets file into Cookie's, without it ever appearing on screen or in the shell history.
//   node deploy/copy-secret.js FIREBASE_SERVICE_ACCOUNT [/srv/soda-secrets/secrets.local.js]
// Used to give Cookie the same push-notification (Firebase) key Soda and Petro use. Only the name and the length are printed.
const fs = require('fs');
const FILE = process.env.COOKIE_SECRETS_FILE || '/srv/cookie-secrets/secrets.local.js';
const name = process.argv[2] || '';
const from = process.argv[3] || '/srv/soda-secrets/secrets.local.js';
if (!/^[A-Z][A-Z0-9_]{2,60}$/.test(name)) { console.error('Give the secret\'s name in capitals, e.g. FIREBASE_SERVICE_ACCOUNT'); process.exit(1); }
let value;
try { value = require(require('path').resolve(from))[name]; } catch (e) { console.error('Cannot read ' + from + ' (' + e.code + '). Nothing was changed.'); process.exit(1); }
if (value && typeof value === 'object') value = JSON.stringify(value);
value = String(value || '').replace(/[\r\n]/g, '').trim();
if (!value) { console.error(name + ' is not in ' + from + '. NOTHING was changed.'); process.exit(2); }
if (name === 'FIREBASE_SERVICE_ACCOUNT') {
  let sa; try { sa = JSON.parse(value); } catch (e) { console.error('That value is not valid JSON. NOTHING was changed.'); process.exit(2); }
  if (!sa.project_id || !sa.client_email || !sa.private_key) { console.error('That service account is missing project_id, client_email or private_key. NOTHING was changed.'); process.exit(2); }
  console.log('Firebase project: ' + sa.project_id);
}
let cur; try { cur = fs.readFileSync(FILE, 'utf8'); } catch (e) { console.error('Cannot find the secrets file ' + FILE); process.exit(1); }
const lineRe = new RegExp('^module\\.exports\\.' + name + '\\s*=.*$\\n?', 'gm');
fs.copyFileSync(FILE, FILE + '.prev');
fs.writeFileSync(FILE, cur.replace(lineRe, '').replace(/\n*$/, '\n') + 'module.exports.' + name + ' = ' + JSON.stringify(value) + ';\n', { mode: 0o600 });
console.log('Copied ' + name + ' (' + value.length + ' characters) into ' + FILE + '. The old file is kept as secrets.local.js.prev until you delete it.');
