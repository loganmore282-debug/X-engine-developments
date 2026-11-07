'use strict';
// The member app's Google Authenticator screens (Profile > Google Authenticator) and the code step of a withdrawal, plus the admin's reset button and the
// build wiring. The screen logic is the REAL code from user-src/original_module.js run in jsdom with the server calls stubbed; the setup picture is checked
// square by square against the vendored qrcode-generator (its own output decoded by an independent reader in the one-off browser run, see CLAUDE.md).
const fs = require('node:fs'), assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); }; const eq = (a, b, m) => { n++; assert.deepEqual(a, b, m); };
const mod = fs.readFileSync(__dirname + '/user-src/original_module.js', 'utf8');
const html = fs.readFileSync(__dirname + '/user-src/index.html', 'utf8');
const vendor = fs.readFileSync(__dirname + '/user-src/vendor-qrcode.js', 'utf8');
const admin = fs.readFileSync(__dirname + '/admin-src/index.html', 'utf8');
const server = fs.readFileSync(__dirname + '/server.js', 'utf8');
const build = fs.readFileSync(__dirname + '/build-core.js', 'utf8');
const a = mod.indexOf('// ── GOOGLE AUTHENTICATOR (the optional second step of a withdrawal) ──'), b = mod.indexOf('// ── TREASURE CHEST');
ok(a > 0 && b > a, 'the Google Authenticator block is in the member app');
const block = mod.slice(a, b);
const dlg = mod.slice(mod.indexOf('function askAuthCode(){'), mod.indexOf('// Transaction Statement (openBalanceRecordSheet()) is cache-first'));

// ---- wiring
ok(/\$\{ptMenuRow\('shield', 'Trade Password', 'openChangeTradePasswordSheet\(\)'\)\}\s*\$\{ptMenuRow\('auth', 'Google Authenticator', 'openAuthenticatorSheet\(\)'\)\}/.test(mod), 'the My page lists Google Authenticator right after the Trade Password');
ok(/id="totpBg"/.test(html) && /id="totpInput"/.test(html) && /id="totpOk"/.test(html) && /id="totpNo"/.test(html) && /id="totpAlt"/.test(html), 'the code dialog exists in the page');
ok(/\.pt-ga-card/.test(html) && /\.pt-ga-qr/.test(html) && /\.pt-ga-codes/.test(html), 'the page has its styles');
ok(/if \(STATE\.account && STATE\.account\.twofaEnabled\) \{\s*witCode = await askAuthCode\(\);/.test(mod) && /Object\.assign\(\{ amount, network: acct\.network, phone: acct\.phone, pin: witPin \}, witCode \? \{ totp: witCode \} : \{\}\)/.test(mod), 'a withdrawal asks for the code after the Trade Password, only when it is on, and sends it as `totp`');
ok(/const tp = \$\('totpBg'\); if \(tp\) tp\.classList\.remove\('show'\);/.test(mod), 'a session that ends takes the code dialog down with it');
ok(/Ensure|noopener/.test(block) && !/\\ud83|\\u26|[\u{1F300}-\u{1FAFF}]/u.test(block), 'safe store links and no emoji on the page');
ok(!/\b2FA\b/.test(block) && !/\b2FA\b/.test(dlg), 'no abbreviation "2FA" in anything the member reads');
ok(/vendor-\.\*\\\.js/.test(build) && /vendored/.test(build), 'build-core.js puts the vendored library in front of the app code');
ok(/MIT/.test(vendor) && /Kazuhiko Arase/.test(vendor) && /qrcode-generator 1\.4\.4/.test(vendor), 'the vendored QR library keeps its licence and version');
ok(/id="reset2faBtn"/.test(admin) && /\/admin\/user\/reset-2fa/.test(admin) && /u\.twofaEnabled===true/.test(admin), 'the admin shows the status and has the reset button');
ok(/app\.post\('\/admin\/user\/reset-2fa'[\s\S]{0,200}verifyOwner/.test(server), 'only the owner can reset it');

// ---- the screens (real code, stubbed server)
const dom = new JSDOM('<body><div id="sheetBg"><div id="sheetBody"></div></div><div class="pin-bg" id="totpBg"><div class="pin-card"><input id="totpInput" maxlength="6"><p id="totpHelp"></p><p id="totpWarn"></p><button id="totpAlt"></button><button id="totpNo"></button><button id="totpOk"></button></div></div></body>', { runScripts: 'outside-only', pretendToBeVisual: true });
const w = dom.window;
w.eval(`
  var STATE = { account: { twofaEnabled: false } }, _ptSkewMs = 0, __calls = [], __notes = [], __answers = {};
  function $(id){ return document.getElementById(id); }
  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  var PT_MENU_IC = { auth: '<svg id="icAuth"></svg>', tick: '<svg id="icTick"></svg>' };
  function vPwBox(id, ph){ return '<div class="pt-pbox"><input id="' + id + '" type="password" placeholder="' + ph + '"></div>'; }
  function joinedStamp(ts){ return 'WHEN'; }
  function ptPwClear(){ var e = $('ptPwErr'); if (e) e.textContent = ''; }
  function ptPwError(m){ var e = $('ptPwErr'); if (e) e.textContent = m; }
  function notify(m){ __notes.push(m); }
  async function post(p, body){ __calls.push([p, body]); var r = __answers[p]; return typeof r === 'function' ? r(body) : (r || { status: 'error', message: 'no answer' }); }
  async function api(p){ __calls.push([p]); var r = __answers[p]; return typeof r === 'function' ? r() : (r || { status: 'error' }); }
  function openSheet(title, body){ document.getElementById('sheetBody').innerHTML = body; }
  window.copyText = function(t){ __notes.push('copied:' + t); };
`);
w.eval(vendor); w.eval(block); w.eval(dlg);
const $ = id => w.document.getElementById(id), body = () => w.document.getElementById('sheetBody').innerHTML, txt = () => w.document.getElementById('sheetBody').textContent.replace(/\s+/g, ' ');
const tick = () => new Promise(r => setTimeout(r, 5));
const ev = expr => JSON.parse(JSON.stringify(w.eval(expr)));   // objects made inside jsdom belong to another realm: compare them as plain data
(async () => {
  // off
  w.eval(`__answers['/account/2fa/status'] = { status: 'success', enabled: false, backupLeft: 0 };`);
  w.openAuthenticatorSheet(); await tick();
  ok(/Secure your withdrawals/.test(txt()) && /Download Google Authenticator/.test(txt()) && $('gaPin') && $('gaStartBtn'), 'off: the intro, the stores and the Trade Password box');
  ok([...w.document.querySelectorAll('.pt-ga-stores a')].every(x => /noopener/.test(x.rel) && x.target === '_blank'), 'off: the store links open safely');
  // a short Trade Password is refused before anything is sent
  $('gaPin').value = '12'; await w.gaStart(); ok($('ptPwErr').textContent === 'Enter your 6-digit Trade Password.' && w.eval('__calls.filter(c => c[0] === "/account/2fa/start").length') === 0, 'start: a short Trade Password is refused without a request');
  // a server refusal is shown on the page
  w.eval(`__answers['/account/2fa/start'] = { status: 'error', code: 'WRONG_PIN', message: 'Incorrect Trade Password.' };`);
  $('gaPin').value = '654321'; await w.gaStart(); ok($('ptPwErr').textContent === 'Incorrect Trade Password.' && !$('gaQr'), 'start: the server\'s reason is shown and nothing starts');
  // success -> the setup view
  const secret = 'B334PITH2GQ3FON4RON25AADNPZ7GG3Q', link = 'otpauth://totp/Potato:%2B256770300047?secret=' + secret + '&issuer=Potato&algorithm=SHA1&digits=6&period=30';
  w.eval(`__answers['/account/2fa/start'] = { status: 'success', secret: '${secret}', otpauth: '${link}', issuer: 'Potato', account: '+256770300047', expiresInSec: 900 };`);
  $('gaPin').value = '123456'; await w.gaStart(); await tick();
  eq(ev('__calls.filter(c => c[0] === "/account/2fa/start").pop()[1]'), { pin: '123456' }, 'start: the Trade Password is what is sent');
  ok($('gaKey').innerHTML === 'B334 PITH 2GQ3 FON4<br>RON2 5AAD NPZ7 GG3Q', 'setup: the key is shown in two tidy lines of four groups', $('gaKey').innerHTML);
  ok(w.document.querySelector('a.pt-ga-btn[href^="otpauth:"]').getAttribute('href') === link, 'setup: the button opens the exact otpauth link');
  ok(/Enter a setup key/.test(txt()) && /Time based/.test(txt()) && $('gaCode') && $('gaConfirmBtn'), 'setup: says how to type the key, and asks for the first code');
  // the picture: parse the SVG path back into squares and compare with the library's own matrix
  const svg = w.document.querySelector('#gaQr svg'); ok(svg && /^0 0 \d+ \d+$/.test(svg.getAttribute('viewBox')), 'setup: a picture is drawn');
  const q = w.qrcode(0, 'L'); q.addData(link); q.make(); const nn = q.getModuleCount(), size = nn + 8;
  eq(svg.getAttribute('viewBox'), '0 0 ' + size + ' ' + size, 'setup: a 4-square white border around the squares');
  const got = Array.from({ length: nn }, () => Array(nn).fill(false));
  for (const m of svg.querySelector('path').getAttribute('d').matchAll(/M(\d+) (\d+)h(\d+)v1h-\3z/g)) { const x = +m[1] - 4, y = +m[2] - 4, len = +m[3]; for (let i = 0; i < len; i++) got[y][x + i] = true; }
  let diff = 0; for (let r = 0; r < nn; r++) for (let c = 0; c < nn; c++) if (got[r][c] !== q.isDark(r, c)) diff++;
  ok(diff === 0, 'setup: every square of the picture equals the library\'s own code (' + nn + ' x ' + nn + ')');
  ok(/#fff/.test(svg.innerHTML) && /fill="#000"/.test(svg.innerHTML), 'setup: black squares on white');
  // a wrong code is shown, the right one turns it on and shows 8 backup codes once
  $('gaCode').value = '12345'; await w.gaConfirm(); ok(/6-digit code/.test($('ptPwErr').textContent) && w.eval('__calls.filter(c => c[0] === "/account/2fa/confirm").length') === 0, 'confirm: not 6 digits: refused without a request');
  w.eval(`__answers['/account/2fa/confirm'] = { status: 'error', code: 'TWOFA_INVALID', message: 'That code is not right (4 tries left). Open Google Authenticator.' };`);
  $('gaCode').value = '000000'; await w.gaConfirm(); ok(/not right \(4 tries left\)/.test($('ptPwErr').textContent) && w.eval('STATE.account.twofaEnabled') === false, 'confirm: a wrong code shows the server\'s words and turns nothing on');
  const codes = ['ABCDE-FGHJK', 'LMNPQ-RSTUV', 'WXYZ2-34567', '89ABC-DEFGH', 'JKLMN-PQRST', 'UVWXY-Z2345', '6789A-BCDEF', 'GHJKL-MNPQR'];
  w.eval(`__answers['/account/2fa/confirm'] = { status: 'success', backupCodes: ${JSON.stringify(codes)} };`);
  $('gaCode').value = '123456'; await w.gaConfirm(); await tick();
  eq([...w.document.querySelectorAll('.pt-ga-codes span')].map(e => e.textContent), codes, 'confirm: the 8 backup codes are listed');
  ok(w.eval('STATE.account.twofaEnabled') === true && /Each code works one time only/.test(txt()) && /Copy all codes/.test(txt()) && /I have saved them/.test(txt()), 'confirm: the app now knows it is on, and says each code works once');
  ok(!/B334PITH2GQ3FON4/.test(body()) && !$('gaQr'), 'confirm: the secret and the picture are gone from the screen');
  // "I have saved them" -> the On view with the count
  w.eval(`__answers['/account/2fa/status'] = { status: 'success', enabled: true, enabledAt: 1700000000000, backupLeft: 2 };`);
  w.gaCodesDone(); await tick(); await tick();
  ok(/Google Authenticator is on/.test(txt()) && /Backup codes left: 2 of 8/.test(txt()) && /running low/.test(txt()) && /Turn Off/.test(txt()) && /New backup codes/.test(txt()), 'on: the count, a warning when only 2 are left, and the two actions');
  // new backup codes need the Trade Password and a code
  w.gaManage('codes'); $('gaPin').value = '123456'; $('gaCode').value = ''; await w.gaDoManage(); ok(/Enter the 6-digit code/.test($('ptPwErr').textContent), 'new codes: a code is required');
  w.eval(`__answers['/account/2fa/backup-codes'] = { status: 'success', backupCodes: ${JSON.stringify(codes.slice().reverse())} };`);
  $('gaCode').value = '654321'; await w.gaDoManage();
  eq(ev('__calls.filter(c => c[0] === "/account/2fa/backup-codes").pop()[1]'), { pin: '123456', code: '654321' }, 'new codes: the Trade Password and the code are sent');
  eq([...w.document.querySelectorAll('.pt-ga-codes span')].map(e => e.textContent), codes.slice().reverse(), 'new codes: the new list is shown');
  // turning it off (a backup code works here too)
  w.gaManage('off'); $('gaPin').value = '123456'; $('gaCode').value = 'abcde-fghjk';
  w.eval(`__answers['/account/2fa/disable'] = { status: 'error', code: 'TWOFA_INVALID', message: 'That code is not right.' };`); await w.gaDoManage();
  ok($('ptPwErr').textContent === 'That code is not right.' && w.eval('STATE.account.twofaEnabled') === true, 'off: a refusal is shown and it stays on');
  w.eval(`__answers['/account/2fa/disable'] = { status: 'success' };`); await w.gaDoManage(); await tick();
  eq(ev('__calls.filter(c => c[0] === "/account/2fa/disable").pop()[1]'), { pin: '123456', code: 'abcde-fghjk' }, 'off: the Trade Password and the typed code are sent as typed');
  ok(w.eval('STATE.account.twofaEnabled') === false && /Secure your withdrawals/.test(txt()) && w.eval('__notes').includes('Google Authenticator is off'), 'off: the app knows, and the page is back to the intro');
  // a phone clock far from the server's is called out
  w.eval('_ptSkewMs = 45000'); w.gaPaint(); ok(/clock is about 45 seconds away/.test(txt()), 'a phone clock more than 20 seconds off is warned about');
  w.eval('_ptSkewMs = 8000'); w.gaPaint(); ok(!/clock is about/.test(txt()), 'a small difference is not');
  // ---- the code dialog at withdrawal time
  w.eval('_ptSkewMs = 0');
  const asked = w.askAuthCode(); ok($('totpBg').classList.contains('show') && $('totpInput').maxLength === 6, 'dialog: opens for a 6-digit code');
  $('totpInput').value = '123456'; $('totpOk').onclick(); eq(await asked, '123456', 'dialog: Confirm hands back what was typed');
  const asked2 = w.askAuthCode(); $('totpAlt').onclick();
  ok($('totpInput').maxLength === 11 && /backup code/i.test($('totpInput').placeholder) && /Use the 6-digit code instead/.test($('totpAlt').textContent), 'dialog: "Use a backup code instead" makes room for a backup code');
  $('totpInput').value = 'ABCDE-FGHJK'; $('totpOk').onclick(); eq(await asked2, 'ABCDE-FGHJK', 'dialog: a backup code is handed back');
  const asked3 = w.askAuthCode(); $('totpNo').onclick(); eq(await asked3, null, 'dialog: Cancel hands back nothing');
  ok(!$('totpBg').classList.contains('show'), 'dialog: closes');
  w.eval('_ptSkewMs = 40000'); const asked4 = w.askAuthCode(); ok(/clock is about 40 seconds away/.test($('totpWarn').textContent), 'dialog: warns about a wrong phone clock'); $('totpNo').onclick(); await asked4;
  console.log('test-authenticator-ui: ' + n + ' checks passed');
})().catch(e => { console.error(e); process.exit(1); });
