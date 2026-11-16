'use strict';
// After sign-up a NEW member is sent once to the community link the admin chose (and only then).
//   node test-signup-join.js
const path = require('path'), Module = require('module'), fs = require('fs'), vm = require('vm');
process.chdir(__dirname);
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...a) { return req === 'mongodb' ? path.join(__dirname, 'test-helpers', 'fake-mongodb.js') : origResolve.call(this, req, ...a); };
const BACK = 4100 + Math.floor(Math.random() * 400);
process.env.PORT = String(BACK); process.env.MONGODB_URI = 'mongodb://fake/app'; process.env.ADMIN_KEY = 'signupjoin-test-admin-key-123456'; process.env.NODE_ENV = 'development';
process.env.POTATO_SECRETS_DIR = fs.mkdtempSync(path.join(require('os').tmpdir(), 'sa-join-'));
const realLog = console.log;
console.log = () => {}; console.warn = () => {}; console.error = () => {};
require(path.join(__dirname, 'server.js'));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; realLog('  ok   - ' + m); } else { fail++; realLog('  FAIL - ' + m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const base = 'http://127.0.0.1:' + BACK;
const J = async (m, p, b) => { const r = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer signupjoin-test-admin-key-123456' }, body: b ? JSON.stringify(b) : undefined }); let j = null; try { j = await r.json(); } catch (_) {} return { s: r.status, j }; };
const read = f => fs.readFileSync(path.join(__dirname, f), 'utf8');

(async () => {
  for (let i = 0; i < 60; i++) { try { const r = await fetch(base + '/public/settings'); if (r.ok) break; } catch (_) {} await sleep(250); }
  // Client: the picking rule, run from the real source.
  const src = read('user-src/original_module.js');
  const grab = name => { const m = src.match(new RegExp('function ' + name + '\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}', 'm')) || src.match(new RegExp('function ' + name + '\\([^)]*\\)\\{[^\\n]*\\}')); return m && m[0]; };
  const fSafe = grab('safeUrl'), fJoin = grab('signupJoinUrl');
  ok(!!fSafe && !!fJoin, 'both functions found in the app source');
  const pick = settings => { const ctx = { getSettings: () => settings }; vm.createContext(ctx); vm.runInContext(fSafe + '\n' + fJoin + '\nthis.r = signupJoinUrl();', ctx); return ctx.r; };
  const WA = 'https://chat.whatsapp.com/abc', TG = 'https://t.me/group', CH = 'https://t.me/channel';
  ok(pick({ signupJoin: 'auto', whatsappGroup: WA, telegramGroup: TG, telegramChannel: CH }) === WA, 'automatic: WhatsApp group first');
  ok(pick({ signupJoin: 'auto', whatsappGroup: '', telegramGroup: TG, telegramChannel: CH }) === TG, 'automatic: Telegram group when there is no WhatsApp group');
  ok(pick({ signupJoin: 'auto', telegramChannel: CH }) === CH, 'automatic: Telegram channel last');
  ok(pick({}) === '', 'nothing set: no redirect');
  ok(pick({ signupJoin: 'telegramChannel', whatsappGroup: WA, telegramChannel: CH }) === CH, 'a chosen target wins');
  ok(pick({ signupJoin: 'telegramGroup', whatsappGroup: WA }) === '', 'a chosen target that is empty: no redirect (no fallback elsewhere)');
  ok(pick({ signupJoin: 'off', whatsappGroup: WA }) === '', 'off: no redirect');
  ok(pick({ signupJoin: 'auto', whatsappGroup: 'javascript:alert(1)' }) === '', 'an unsafe link is never followed');
  // Client: only a brand-new account is sent, never a later sign-in.
  ok(/var joinUrl = regR\.status === 'success' \? signupJoinUrl\(\) : '';/.test(src), 'only a freshly created account is sent');
  ok(/window\.location\.href = url/.test(src), 'goes by moving the page (not a popup a browser would block)');
  // Admin + server.
  ok(/id="spJoin"/.test(read('admin-src/index.html')) && /signupJoin:\$\('spJoin'\)\.value/.test(read('admin-src/index.html')), 'admin has the choice and saves it');
  let r = await J('GET', '/public/settings');
  ok(r.j && r.j.settings && r.j.settings.signupJoin === 'auto', 'default is automatic');
  r = await J('POST', '/admin/settings/update', { settings: { signupJoin: 'telegramGroup' } });
  r = await J('GET', '/public/settings');
  ok(r.j.settings.signupJoin === 'telegramGroup', 'the admin choice is saved and reaches the app');
  await J('POST', '/admin/settings/update', { settings: { signupJoin: '<script>' } });
  r = await J('GET', '/public/settings');
  ok(r.j.settings.signupJoin === 'auto', 'a junk value falls back to automatic');
  realLog(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { realLog('CRASH', e); process.exit(1); });
