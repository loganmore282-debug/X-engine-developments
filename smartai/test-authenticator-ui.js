'use strict';
// The member app's Google Authenticator screens (Me > Google Authenticator) and the code step of a cash-out, plus the admin's reset button and the
// build wiring. The screen logic is the REAL code from user-src/original_module.js run in jsdom with the server calls stubbed; the setup picture is checked
// square by square against the vendored qrcode-generator (its own output decoded by an independent reader in the one-off browser run, see CLAUDE.md).
// The same flow on a real server (set-up with a real code, cash-out with Trade Password and code) is in test-smartai-app.js.
const fs = require('node:fs'), assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); }; const eq = (a, b, m) => { n++; assert.deepEqual(a, b, m); };
const mod = fs.readFileSync(__dirname + '/user-src/original_module.js', 'utf8');
const html = fs.readFileSync(__dirname + '/user-src/index.html', 'utf8');
const vendor = fs.readFileSync(__dirname + '/user-src/vendor-qrcode.js', 'utf8');
const admin = fs.readFileSync(__dirname + '/admin-src/index.html', 'utf8');
const server = fs.readFileSync(__dirname + '/server.js', 'utf8');
const build = fs.readFileSync(__dirname + '/build-core.js', 'utf8');
const cut = (from, to) => { const a = mod.indexOf(from), b = mod.indexOf(to, a + 1); assert.ok(a > 0 && b > a, 'anchor ' + from); return mod.slice(a, b); };
const block = cut('/* ====================== GOOGLE AUTHENTICATOR ======================', '/* ====================== DAILY REWARD, GIFT CODE');
const dlg = cut('var _totpResolve = null, _totpBackup = false;', '/* ====================== PICTURES');
const rule = cut('function authFeatureOn(){', '// The hours cash-out is open') + '\n' + cut('var _gaReturn = null;', 'var _withdrawBusy = false;');

// ---- wiring
ok(/id="gaRow"[^>]*onclick="openOverlay\('authenticator'\)"/.test(html) && /id="ovAuthenticator"/.test(html) && /id="gaBody"/.test(html), 'the Me page has a Google Authenticator row that opens its page');
ok(/var row = \$\('gaRow'\); if \(row\) row\.style\.display = on \? '' : 'none';/.test(mod), 'the row is shown only while the owner\'s switch is on (the settings check redraws it)');
ok(/id="totpBg"/.test(html) && /id="totpInput"/.test(html) && /id="totpOk"/.test(html) && /id="totpNo"/.test(html) && /id="totpAlt"/.test(html), 'the code dialog exists in the page');
ok(/\.ga-card/.test(html) && /\.ga-key/.test(html) && /\.ga-qr/.test(html) && /\.ga-codes/.test(html), 'the page has its styles');
ok(/if \(authFeatureOn\(\) && STATE\.twofaEnabled\) \{\s*code = await askAuthCode\(\);/.test(mod) && /Object\.assign\(\{ amount: amt, network: card\.network, phone: card\.phone, pin: pin \}, code \? \{ totp: code \} : \{\}\)/.test(mod), 'a cash-out asks the code right after the Trade Password and sends it as totp');
ok(/\['networkPickerBg', 'tradePinBg', 'totpBg'/.test(mod), 'a session that ends takes the code dialog down with it');
ok(/rel="noopener"/.test(block) && !/[\u{1F300}-\u{1FAFF}]/u.test(block + dlg), 'safe store links and no emoji on the page');
ok(!/\b2FA\b/.test(block) && !/\b2FA\b/.test(dlg), 'no abbreviation "2FA" in anything the member reads');
ok(/vendor-\.\*\\\.js/.test(build) && /vendored/.test(build), 'build-core.js puts the vendored library in front of the app code');
ok(/MIT/.test(vendor) && /Kazuhiko Arase/.test(vendor) && /qrcode-generator 1\.4\.4/.test(vendor), 'the vendored QR library keeps its licence and version');
ok(/id="reset2faBtn"/.test(admin) && /\/admin\/user\/reset-2fa/.test(admin) && /u\.twofaEnabled===true/.test(admin), 'the admin shows the status and has the reset button');
ok(/app\.post\('\/admin\/user\/reset-2fa'[\s\S]{0,200}verifyOwner/.test(server), 'only the owner can reset it');
// ---- compulsory: the rule, the owner's switch and where the app checks it
ok(/requireTwofaToWithdraw: true,/.test(server) && /SETTINGS_BOOLEAN_FIELDS = \[[^\]]*'requireTwofaToWithdraw'/.test(server), 'the rule is on by default and can be saved from Admin > Settings');
ok(/const twofaFeature = sett\.requireTwofaToWithdraw !== false;[\s\S]{0,1400}code: 'TWOFA_SETUP_REQUIRED'/.test(server), 'the server refuses a member who has not set it up, and asks nothing at all when the owner has switched the feature off');
ok(/code: 'TWOFA_DISABLED'/.test(server) && /available: m\.featureOn/.test(server), 'with the feature off the member routes are closed and the status says so');
ok(/id="sReqTwofa"/.test(admin) && /requireTwofaToWithdraw:\$\('sReqTwofa'\)\.checked/.test(admin) && /twofaReq/.test(admin), 'the admin has the switch and saves it');
ok(/if \(needsAuthSetup\(\)\) \{ gaRequiredNotice\(\); return; \}\s*var pin = await askTradePin/.test(mod), 'the app checks the rule when Cash Out is tapped, BEFORE the Trade Password is asked');
ok(/r\.code === 'TWOFA_SETUP_REQUIRED'\) \{ STATE\.twofaEnabled = false; gaRequiredNotice\(\); return; \}/.test(mod), 'and when the server says so (an old copy of the account or rule)');
ok(/if \(r\.code === 'TWOFA_REQUIRED'\) STATE\.twofaEnabled = true;/.test(mod), 'a server that asks for a code teaches the app that it is on');

// ---- the screens (real code, stubbed server)
const dom = new JSDOM('<body><div class="overlay" id="ovAuthenticator"><div id="gaBody"></div></div><input id="witAmt" value="">' +
  '<div class="modal-bg" id="totpBg"><input id="totpInput" maxlength="6" inputmode="numeric"><p id="totpHelp"></p><p id="totpWarn"></p><span id="totpAlt"></span><span id="totpNo"></span></div></body>', { url: 'https://mysmartai.smartai.example.com/', runScripts: 'outside-only' });
const w = dom.window;
w.eval(`
  var STATE = { twofaEnabled: false }, _skewMs = 0, __calls = [], __toasts = [], __answers = {}, __settings = {}, __opened = [], _ovName = 'withdraw', SETTINGS_CACHE_KEY = 'smartai_settings_cache';
  function $(id){ return document.getElementById(id); }
  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; }); }
  function spinnerHtml(){ return '<i class="spin"></i>'; }
  function fmtStamp(ms){ return 'WHEN'; }
  function clockOffSecs(){ return Math.round(Math.abs(_skewMs) / 1000); }
  function copyText(t, m){ __toasts.push('copied:' + t); }
  function toast(m){ __toasts.push(m); }
  function getSettings(){ return __settings; }
  function renderMeRows(){ __calls.push(['renderMeRows']); }
  function renderWitCalc(){ __calls.push(['renderWitCalc']); }
  function shakeVibrate(){}
  function openOverlay(name){ __opened.push(name); _ovName = name; }
  function api(p, body){ __calls.push([p, body]); var r = __answers[p]; return Promise.resolve(typeof r === 'function' ? r(body) : (r || { status: 'error', message: 'no answer' })); }
`);
w.eval(vendor); w.eval(rule); w.eval(block); w.eval(dlg);
const $ = id => w.document.getElementById(id), txt = () => $('gaBody').textContent.replace(/\s+/g, ' ');
const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));
const ev = expr => JSON.parse(JSON.stringify(w.eval(expr)));   // objects made inside jsdom belong to another realm: compare them as plain data
const answer = (p, a) => w.eval(`__answers[${JSON.stringify(p)}] = ${JSON.stringify(a)};`);
const callsTo = p => ev(`__calls.filter(function(c){ return c[0] === ${JSON.stringify(p)}; }).length`);
(async () => {
  // off
  answer('/account/2fa/status', { status: 'success', enabled: false, backupLeft: 0 });
  w.gaOpen(); await tick();
  ok(/Google Authenticator is required/.test(txt()) && /Download Google Authenticator/.test(txt()) && $('gaPin') && $('gaStartBtn'), 'off: it says it is required, then the stores and the Trade Password box');
  ok([...w.document.querySelectorAll('.ga-stores a')].length === 2 && [...w.document.querySelectorAll('.ga-stores a')].every(x => /noopener/.test(x.rel) && x.target === '_blank'), 'off: the store links open safely');
  // a short Trade Password is refused before anything is sent
  $('gaPin').value = '12'; await w.gaStart(); ok($('gaErr').textContent === 'Enter your 6-digit Trade Password.' && callsTo('/account/2fa/start') === 0, 'start: a short Trade Password is refused without a request');
  // a server refusal is shown on the page
  answer('/account/2fa/start', { status: 'error', code: 'WRONG_PIN', message: 'Incorrect Trade Password.' });
  $('gaPin').value = '654321'; await w.gaStart(); ok($('gaErr').textContent === 'Incorrect Trade Password.' && !$('gaQr'), 'start: the server\'s reason is shown and nothing starts');
  // success -> the setup view
  const secret = 'B334PITH2GQ3FON4RON25AADNPZ7GG3Q', link = 'otpauth://totp/Smart AI:%2B256770300047?secret=' + secret + '&issuer=Smart AI&algorithm=SHA1&digits=6&period=30';
  answer('/account/2fa/start', { status: 'success', secret, otpauth: link, issuer: 'Smart AI', account: '+256770300047', expiresInSec: 900 });
  $('gaPin').value = '123456'; await w.gaStart(); await tick();
  eq(ev('__calls.filter(function(c){ return c[0] === "/account/2fa/start"; }).pop()[1]'), { pin: '123456' }, 'start: the Trade Password is what is sent');
  ok($('gaKey').innerHTML === 'B334 PITH 2GQ3 FON4<br>RON2 5AAD NPZ7 GG3Q', 'setup: the key is shown in two tidy lines of four groups: ' + $('gaKey').innerHTML);
  ok(w.document.querySelector('a.btn[href^="otpauth:"]').getAttribute('href') === link, 'setup: the button opens the exact otpauth link');
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
  $('gaCode').value = '12345'; await w.gaConfirm(); ok(/6-digit code/.test($('gaErr').textContent) && callsTo('/account/2fa/confirm') === 0, 'confirm: not 6 digits: refused without a request');
  answer('/account/2fa/confirm', { status: 'error', code: 'TWOFA_INVALID', message: 'That code is not right (4 tries left). Open Google Authenticator.' });
  $('gaCode').value = '000000'; await w.gaConfirm(); ok(/not right \(4 tries left\)/.test($('gaErr').textContent) && w.eval('STATE.twofaEnabled') === false, 'confirm: a wrong code shows the server\'s words and turns nothing on');
  const codes = ['ABCDE-FGHJK', 'LMNPQ-RSTUV', 'WXYZ2-34567', '89ABC-DEFGH', 'JKLMN-PQRST', 'UVWXY-Z2345', '6789A-BCDEF', 'GHJKL-MNPQR'];
  answer('/account/2fa/confirm', { status: 'success', backupCodes: codes });
  $('gaCode').value = '123 456'; await w.gaConfirm(); await tick();
  eq(ev('__calls.filter(function(c){ return c[0] === "/account/2fa/confirm"; }).pop()[1]'), { code: '123456' }, 'confirm: spaces are removed from the typed code');
  eq([...w.document.querySelectorAll('.ga-codes span')].map(e => e.textContent), codes, 'confirm: the 8 backup codes are listed');
  ok(w.eval('STATE.twofaEnabled') === true && /Each code works one time only/.test(txt()) && /Copy all codes/.test(txt()) && /I have saved them/.test(txt()), 'confirm: the app now knows it is on, and says each code works once');
  ok(!/B334PITH2GQ3FON4/.test($('gaBody').innerHTML) && !$('gaQr'), 'confirm: the secret and the picture are gone from the screen');
  // "I have saved them" -> the On view with the count
  answer('/account/2fa/status', { status: 'success', enabled: true, enabledAt: 1700000000000, backupLeft: 2 });
  w.gaCodesDone(); await tick(); await tick();
  ok(/Google Authenticator is on/.test(txt()) && /Backup codes left: 2 of 8/.test(txt()) && /running low/.test(txt()) && /Turn Off/.test(txt()) && /New backup codes/.test(txt()), 'on: the count, a warning when only 2 are left, and the two actions');
  // new backup codes need the Trade Password and a code
  w.gaManage('codes'); $('gaPin').value = '123456'; $('gaCode').value = ''; await w.gaDoManage(); ok(/Enter the 6-digit code/.test($('gaErr').textContent) && callsTo('/account/2fa/backup-codes') === 0, 'new codes: a code is required');
  $('gaPin').value = '12'; $('gaCode').value = '654321'; await w.gaDoManage(); ok(/6-digit Trade Password/.test($('gaErr').textContent), 'new codes: a short Trade Password is refused');
  answer('/account/2fa/backup-codes', { status: 'success', backupCodes: codes.slice().reverse() });
  $('gaPin').value = '123456'; $('gaCode').value = '654321'; await w.gaDoManage();
  eq(ev('__calls.filter(function(c){ return c[0] === "/account/2fa/backup-codes"; }).pop()[1]'), { pin: '123456', code: '654321' }, 'new codes: the Trade Password and the code are sent');
  eq([...w.document.querySelectorAll('.ga-codes span')].map(e => e.textContent), codes.slice().reverse(), 'new codes: the new list is shown');
  // turning it off (a backup code works here too)
  w.gaManage('off'); $('gaPin').value = '123456'; $('gaCode').value = 'abcde-fghjk';
  answer('/account/2fa/disable', { status: 'error', code: 'TWOFA_INVALID', message: 'That code is not right.' }); await w.gaDoManage();
  ok($('gaErr').textContent === 'That code is not right.' && w.eval('STATE.twofaEnabled') === true, 'off: a refusal is shown and it stays on');
  answer('/account/2fa/disable', { status: 'success' }); await w.gaDoManage(); await tick();
  eq(ev('__calls.filter(function(c){ return c[0] === "/account/2fa/disable"; }).pop()[1]'), { pin: '123456', code: 'abcde-fghjk' }, 'off: the Trade Password and the typed code are sent as typed');
  ok(w.eval('STATE.twofaEnabled') === false && /Google Authenticator is required/.test(txt()) && w.eval('__toasts').includes('Google Authenticator is off'), 'off: the app knows, and the page is back to the intro');
  w.gaManage('off'); ok(/You will not be able to cash out until you set Google Authenticator up again/.test(txt()), 'turn off: warns that cashing out stops until it is set up again');
  w.gaBack(); ok(/Google Authenticator is on/.test(txt()), 'Cancel on that page goes back to the On page');
  // a phone clock far from the server's is called out
  w.eval('_skewMs = 45000'); w.gaPaint(); ok(/clock is about 45 seconds away/.test(txt()), 'a phone clock more than 20 seconds off is warned about');
  w.eval('_skewMs = 8000'); w.gaPaint(); ok(!/clock is about/.test(txt()), 'a small difference is not');
  // ---- the code dialog at cash-out time
  w.eval('_skewMs = 0');
  const asked = w.askAuthCode(); ok($('totpBg').classList.contains('show') && $('totpInput').maxLength === 6, 'dialog: opens for a 6-digit code');
  $('totpInput').value = '123 456'; w.totpSubmit(); eq(await asked, '123456', 'dialog: Confirm hands back what was typed (spaces removed)');
  const asked2 = w.askAuthCode(); w.totpMode(!w._totpBackup);
  ok($('totpInput').maxLength === 11 && /backup code/i.test($('totpInput').placeholder) && /Use the 6-digit code instead/.test($('totpAlt').textContent), 'dialog: "Use a backup code instead" makes room for a backup code');
  $('totpInput').value = 'ABCDE-FGHJK'; w.totpSubmit(); eq(await asked2, 'ABCDE-FGHJK', 'dialog: a backup code is handed back');
  const asked3 = w.askAuthCode(); w.totpCancel(); eq(await asked3, null, 'dialog: Cancel hands back nothing');
  ok(!$('totpBg').classList.contains('show'), 'dialog: closes');
  const asked5 = w.askAuthCode(); const asked6 = w.askAuthCode(); eq(await asked5, null, 'dialog: opening it again settles the earlier question with nothing (never left hanging)'); w.totpCancel(); await asked6;
  w.eval('_skewMs = 40000'); const asked4 = w.askAuthCode(); ok(/clock is about 40 seconds away/.test($('totpWarn').textContent), 'dialog: warns about a wrong phone clock'); w.totpCancel(); await asked4;
  // ---- COMPULSORY: the rule, the wording, and the way back to Cash Out
  w.eval(`__settings = {}; STATE = { twofaEnabled: false }; _skewMs = 0;`);
  ok(w.needsAuthSetup() === true && w.authFeatureOn() === true, 'rule: a member without it must set it up (the rule is on unless the owner says otherwise)');
  w.eval(`__settings = { requireTwofaToWithdraw: true }`); ok(w.needsAuthSetup() === true, 'rule: on, said so');
  w.eval(`__settings = { requireTwofaToWithdraw: false }`); ok(w.needsAuthSetup() === false && w.authFeatureOn() === false, 'rule: the owner\'s switch off: nobody is sent to set it up');
  w.eval(`__settings = {}; STATE.twofaEnabled = true`); ok(w.needsAuthSetup() === false, 'rule: already on: nothing to set up');
  w.eval(`STATE = null`); ok(w.needsAuthSetup() === false, 'rule: before the account is loaded the app does not guess (the server decides)');
  w.eval(`STATE = { twofaEnabled: false }`);
  // tapping Cash Out: the notice, then the set-up page with the amount remembered
  $('witAmt').value = '25,000'; w.eval(`__toasts.length = 0; __opened.length = 0; _ovName = 'withdraw';`);
  w.gaRequiredNotice();
  eq(ev('__toasts'), ['Google Authenticator is required to cash out. Set it up first.'], 'tap Cash Out: says why, in plain words');
  ok(ev('__opened').length === 0, 'tap Cash Out: the set-up page does not open until the member has had time to read it');
  await tick(1000);
  eq(ev('__opened'), ['authenticator'], 'tap Cash Out: and then goes on to the set-up page');
  // a member who has already left the Cash Out page is not dragged to the set-up
  w.eval(`__opened.length = 0; _ovName = 'withdraw';`); w.gaRequiredNotice(); w.eval(`_ovName = 'support'`); await tick(1000);
  ok(ev('__opened').length === 0, 'tap Cash Out: if the member has already gone to another page, nothing opens over it');
  // the whole set-up from Cash Out, then back to Cash Out with the amount
  $('witAmt').value = '25,000'; w.eval(`_ovName = 'withdraw'; __toasts.length = 0; __opened.length = 0; __calls.length = 0;`);
  w.gaRequiredNotice(); await tick(1000);
  answer('/account/2fa/status', { status: 'success', enabled: false, backupLeft: 0 });
  w.gaOpen(); await tick();
  answer('/account/2fa/start', { status: 'success', secret, otpauth: link, issuer: 'Smart AI', account: '+256770300047', expiresInSec: 900 });
  $('gaPin').value = '123456'; await w.gaStart(); await tick();
  answer('/account/2fa/confirm', { status: 'success', backupCodes: codes });
  $('gaCode').value = '123456'; await w.gaConfirm(); await tick();
  ok(/Google Authenticator is on/.test(txt()) && /I have saved them/.test(txt()) && w.eval('STATE.twofaEnabled') === true, 'set-up from Cash Out: the backup codes are still shown first');
  w.eval(`__opened.length = 0`); $('witAmt').value = '';
  w.gaCodesDone(); await tick();
  eq(ev('__opened'), ['withdraw'], 'set-up from Cash Out: "I have saved them" returns to the Cash Out page');
  ok($('witAmt').value === '25,000' && callsTo('renderWitCalc') === 1 && w.eval('__toasts').includes('Google Authenticator setup done. You can cash out now.'), 'set-up from Cash Out: the amount is back, the fee is worked out again, and the member is told they can cash out');
  ok(w.eval('_gaReturn') === null, 'set-up from Cash Out: the way back is used once');
  // opened from Cash Out but it was already on (the app held an old copy): straight back
  w.eval(`STATE = { twofaEnabled: false }; _gaReturn = { amount: '9,000' }; __opened.length = 0; __toasts.length = 0; __calls.length = 0;`); $('witAmt').value = '';
  answer('/account/2fa/status', { status: 'success', enabled: true, backupLeft: 8 });
  w.gaOpen(); await tick(20);
  ok(w.eval('STATE.twofaEnabled') === true && ev('__opened').join() === 'withdraw' && $('witAmt').value === '9,000', 'already on: the app learns it and goes straight back to Cash Out');
  // opened from the Me page (no Cash Out behind it): "I have saved them" shows the On page, as before
  w.eval(`STATE = { twofaEnabled: false }; _gaReturn = null; __opened.length = 0;`);
  answer('/account/2fa/status', { status: 'success', enabled: false, backupLeft: 0 });
  w.gaOpen(); await tick();
  ok(/Google Authenticator is required/.test(txt()) && ev('__opened').length === 0, 'from the Me page: the same page, and no jump to Cash Out');
  // a server that cannot be reached: a retry line, not a blank page
  answer('/account/2fa/status', { status: 'error', message: 'offline' });
  w.gaOpen(); await tick(); ok(/Could not load\. Tap to try again\./.test(txt()), 'a failed read says so and can be tried again');
  // ---- the owner's switch OFF: an open page says so and the app drops the rule from its own copy of the settings
  w.eval(`__settings = {}; STATE = { twofaEnabled: false }; __calls.length = 0;`);
  answer('/account/2fa/status', { status: 'success', available: false, enabled: false, backupLeft: 0 });
  w.gaOpen(); await tick();
  ok(/Google Authenticator is switched off/.test(txt()) && /ask only for your Trade Password/.test(txt()) && !$('gaPin'), 'switch off: an open page says it is switched off and offers nothing to set up');
  ok(w.eval('__settings.requireTwofaToWithdraw') === false && callsTo('renderMeRows') === 1, 'and the app drops the rule from its own copy of the settings and redraws the Me rows');
  console.log('test-authenticator-ui: ' + n + ' checks passed');
})().catch(e => { console.error(e); process.exit(1); });
