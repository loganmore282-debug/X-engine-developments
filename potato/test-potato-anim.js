'use strict';
// Motion and flip clock measured from the owner's two screen recordings (see the PT-ANIM block in user-src/index.html): the keyframes carry the
// measured numbers, the flip clock changes only the digits that changed, and an uploaded icon is shown as an <img> or not at all.
const fs = require('node:fs'), assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); }; const eq = (a, b, m) => { n++; assert.deepEqual(a, b, m); };
const html = fs.readFileSync(__dirname + '/user-src/index.html', 'utf8');
const mod = fs.readFileSync(__dirname + '/user-src/original_module.js', 'utf8');
const css = html.slice(html.indexOf('/* PT-ANIM-START'), html.indexOf('/* PT-ANIM-END */'));
ok(css.length > 500, 'the PT-ANIM block exists');
// the measured motion
ok(/@keyframes ptGiftBounce\{[\s\S]*20%\{transform:translateY\(13\.9%\)[\s\S]*44\.7%\{transform:translateY\(6\.9%\)[\s\S]*70\.1%\{transform:translateY\(13\.9%\)[\s\S]*94%,100%\{transform:translateY\(0\)/.test(css), 'order gift: drops 13.9%, back to 6.9%, 13.9% again, home');
ok(/\.pt-icon\.pt-gift\{animation:ptGiftBounce 1\.2s infinite/.test(css), 'order gift cycle is 1.2 s');
ok(/@keyframes ptAppFloat\{0%\{transform:translateY\(0\);\}25%\{transform:translateY\(-9%\);\}47%\{transform:translateY\(-9%\);\}76%\{transform:translateY\(0\);\}100%/.test(css), 'download app: up 9%, hold, down');
ok(/\.pt-icon\.pt-appfloat\{animation:ptAppFloat 1\.6s linear infinite/.test(css), 'download app cycle is 1.6 s, straight lines');
// the flip clock look
ok(/\.pt-fd\{[^}]*width:27\.7px;height:39px;[^}]*font:700 25px\/39px Roboto/.test(css) && /background:#191919/.test(css) && /background:#e0211f/.test(css), 'tiles 27.7 x 39, bold 25 px digits, dark tile, red dots');
ok(/animation:ptFoldTop 267ms 58ms linear both/.test(css) && /animation:ptUnfoldBot 233ms 317ms cubic-bezier\(\.3,\.5,\.7,\.8\) both/.test(css) && /ptHideBot 550ms/.test(css), 'fold 0.06-0.33 s, unfold 0.32-0.55 s');

// behaviour of the clock (jsdom, no layout)
const a = mod.indexOf('// ── Admin-uploaded cut-out icons'), b = mod.indexOf('// Home has two lists that never mix');
const dom = new JSDOM('<body><div id="h"></div></body>', { runScripts: 'outside-only' });
const w = dom.window;
w.eval('var STATE={icons:{ordergift:"data:image/png;base64,AAAA"}};var esc=function(s){return String(s).replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;");};' + mod.slice(a, b));
const $ = s => w.document.querySelector(s), $$ = s => [...w.document.querySelectorAll(s)];
w.document.getElementById('h').innerHTML = w.ptFlipClockHtml('08:47:17');
eq($$('.pt-fd').length, 6, 'six digit tiles'); eq($$('.pt-fcol').length, 2, 'two colons'); eq($$('.pt-fp').length, 3, 'three pairs');
eq($$('.pt-fd').map(d => d.getAttribute('data-v')).join(''), '084717');
w.ptFlipClockSet($('.pt-fc'), '08:47:16');
const goes = $$('.pt-fd').map(d => d.classList.contains('pt-go'));
eq(goes, [false, false, false, false, false, true], 'only the changed digit flips');
const u = $$('.pt-fd')[5];
eq([u.querySelector('.pt-fl-t i').textContent, u.querySelector('.pt-ft i').textContent, u.querySelector('.pt-fb i').textContent, u.querySelector('.pt-fl-b i').textContent], ['7', '6', '6', '6'], 'old digit on the folding top flap, new digit everywhere else');
w.ptFlipClockSet($('.pt-fc'), '08:47:16'); eq($$('.pt-go').length, 1, 'the same time again flips nothing new');
w.ptFlipClockSet($('.pt-fc'), '08:46:59');
eq($$('.pt-fd').map(d => d.classList.contains('pt-go')), [false, false, false, true, true, true], 'minutes and seconds digits that changed flip together');
w.ptFlipSettle(u); ok(!u.classList.contains('pt-go') && u.querySelector('.pt-fb i').textContent === u.getAttribute('data-v'), 'settling leaves every layer on the current digit');
// icons
ok(/class="pt-icon pt-gift" src="data:image\/png;base64,AAAA"/.test(w.ptIconHtml('ordergift', 'gift')), 'an uploaded icon is an <img> with its motion class');
eq(w.ptIconHtml('downloadapp', 'appfloat'), '', 'an icon that was not uploaded shows nothing');
ok(/STATE\.icons = \(ci\.status === 'success' && ci\.icons/.test(mod), 'the app reads the icons from /public/potato-images');
console.log('PASS: Potato motion and flip clock (' + n + ' checks)');
