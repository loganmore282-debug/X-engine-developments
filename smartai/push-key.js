'use strict';
/**
 * The admin push-alert key (FIREBASE_SERVICE_ACCOUNT), brought over from a sibling app on the same VPS.
 *
 * Every app here sends its admin alerts through the SAME Firebase project (the admin panel's own config names it), so Smart AI does not need a new
 * key: when its own secrets file has none, the one already in a sibling app's secrets file (/srv/<app>-secrets/secrets.local.js) is copied in,
 * ONCE, and from then on it is Smart AI's own line in Smart AI's own file. Only that ONE secret is ever read from another file, only a key whose
 * Firebase project matches is accepted, and nothing but the project name and where it came from is ever printed.
 *
 * It is a module of plain functions (no process.env, no logging, the folder is a parameter) so a test can run every branch against a temp folder.
 */
const fs = require('fs'), path = require('path');
const NAME = 'FIREBASE_SERVICE_ACCOUNT';

// The value written in a secrets file, as one line of JSON text ('' when absent or unreadable).
function readSecret(file, name) {
  let v;
  try { delete require.cache[require.resolve(path.resolve(file))]; v = require(path.resolve(file))[name]; } catch (_) { return ''; }
  if (v && typeof v === 'object') v = JSON.stringify(v);
  return String(v || '').replace(/[\r\n]/g, '').trim();
}
// True when the text is a whole service account of the wanted Firebase project.
function isKeyFor(text, project) {
  let sa; try { sa = JSON.parse(text); } catch (_) { return false; }
  return !!(sa && sa.project_id === project && sa.client_email && sa.private_key);
}
/**
 * @param {{root?: string, ownFile: string, project: string}} o  root = the folder holding every app's secrets folder (/srv)
 * @returns {null | {value: string, from: string, saved: boolean}}  null = nothing to do (already set) or nothing found
 */
function borrowPushKey(o) {
  const root = o.root || '/srv', own = path.resolve(o.ownFile);
  if (readSecret(own, NAME)) return null;   // Smart AI already has one (right or wrong): never overwritten here
  let dirs; try { dirs = fs.readdirSync(root); } catch (_) { return null; }
  dirs = dirs.filter(d => /^[a-z0-9-]+-secrets$/.test(d) && path.join(root, d, 'secrets.local.js') !== own).sort((x, y) => (x === 'soda-secrets' ? -1 : y === 'soda-secrets' ? 1 : x < y ? -1 : 1));
  for (const d of dirs) {
    const file = path.join(root, d, 'secrets.local.js'), value = readSecret(file, NAME);
    if (!value || !isKeyFor(value, o.project)) continue;
    let saved = false;
    try {
      const cur = fs.readFileSync(own, 'utf8');
      fs.copyFileSync(own, own + '.prev');
      const lineRe = new RegExp('^module\\.exports\\.' + NAME + '\\s*=.*$\\n?', 'gm');
      fs.writeFileSync(own, cur.replace(lineRe, '').replace(/\n*$/, '\n') + 'module.exports.' + NAME + ' = ' + JSON.stringify(value) + ';\n', { mode: 0o600 });
      saved = true;
    } catch (_) { /* the key still works for this run; it will be borrowed again next time */ }
    return { value, from: d, saved };
  }
  return null;
}
module.exports = { borrowPushKey, isKeyFor, readSecret, NAME };
