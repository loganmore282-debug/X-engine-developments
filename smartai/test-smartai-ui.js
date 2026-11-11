'use strict';
// Static checks on the member app's pages (user-src/index.html + user-src/original_module.js): the mistakes that silently break a button or a page and
// that a run of the happy path might never touch. A real browser walks the pages in test-smartai-app.js; this file reads every one of them.
//   - every function an onclick / oninput / ... attribute calls is defined,
//   - every element the code looks up by id exists, and no id is used twice,
//   - nothing from another app (names, words) and no emoji pictures reach a member,
//   - full-page screens cannot be dragged sideways and do not pass their scroll on,
//   - money reads "UGX 23,000" (full numbers, never "23k"),
//   - the toast closes by itself and never blocks a tap,
//   - the service worker, manifest and page agree on the app's name and cache.
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const built = process.argv.includes('--built');
const html = fs.readFileSync(__dirname + '/user-src/index.html', 'utf8');
const mod = fs.readFileSync(__dirname + '/user-src/original_module.js', 'utf8');
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); };

// ---- what is defined ----
const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
const code = mod + '\n' + scripts;
const defined = new Set();
for (const m of code.matchAll(/(?:^|[^.\w$])(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/g)) defined.add(m[1]);
for (const m of code.matchAll(/(?:^|[^.\w$])window\.([A-Za-z_$][\w$]*)\s*=/g)) defined.add(m[1]);
for (const m of code.matchAll(/(?:^|[;\n{}]\s*)(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=/g)) defined.add(m[1]);
ok(defined.size > 300, 'the app defines its functions at the top level (' + defined.size + ' names found)');

// ---- handlers: every attribute that runs code calls only things that exist ----
const JS_WORDS = new Set(['if', 'else', 'for', 'while', 'return', 'function', 'typeof', 'new', 'this', 'event', 'void', 'null', 'true', 'false', 'delete', 'in', 'of', 'var', 'let', 'const',
  'parseInt', 'parseFloat', 'String', 'Number', 'Math', 'Date', 'JSON', 'Array', 'Object', 'document', 'window', 'history', 'navigator', 'console', 'location', 'setTimeout', 'clearTimeout', 'alert', 'Boolean', 'isNaN', 'encodeURIComponent']);
function calledNames(js) {
  const bare = js.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, "''");   // text inside quotes is not code
  const out = new Set();
  for (const m of bare.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) if (!JS_WORDS.has(m[2])) out.add(m[2]);
  return out;
}
const attrRe = /\son(?:click|input|change|keydown|keyup|keypress|submit|focus|blur|load|error|touchstart|pointerdown|mousedown)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const missing = new Map(); let handlers = 0;
function scan(text, label) {
  for (const m of text.matchAll(attrRe)) {
    handlers++;
    const js = (m[1] != null ? m[1] : m[2]).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\\'/g, "'");
    for (const name of calledNames(js)) if (!defined.has(name)) missing.set(name, (missing.get(name) || []).concat(label + ': ' + js.slice(0, 60)));
  }
}
scan(html.replace(/<script[\s\S]*?<\/script>/g, ''), 'page');
// handlers written inside the app's own HTML strings (quotes escaped with a backslash in a '...' string, or written in a "..." string)
scan(mod.replace(/\\"/g, '"'), 'code');
ok(handlers > 70, 'the page and the app\'s own markup carry many handlers (' + handlers + ' read)');
ok(missing.size === 0, 'every function a handler calls exists' + (missing.size ? ' -> missing: ' + [...missing].map(([k, v]) => k + ' (' + v[0] + ')').join('; ') : ''));

// ---- ids ----
const pageHtml = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
const staticIds = [...pageHtml.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
const dup = staticIds.filter((id, i) => staticIds.indexOf(id) !== i);
ok(dup.length === 0, 'no id is used twice in the page' + (dup.length ? ' -> ' + [...new Set(dup)].join(', ') : ''));
const madeIds = new Set([...mod.matchAll(/\bid=\\?["']([A-Za-z][\w-]*)\\?["']/g)].map(m => m[1]).concat([...mod.matchAll(/\.id\s*=\s*'([^']+)'/g)].map(m => m[1]), [...mod.matchAll(/\bgaBox\('([A-Za-z]+)'/g)].map(m => m[1])));   // (gaBox makes the box whose id it is given)
const looked = new Set([...mod.matchAll(/(?:\$|getElementById)\('([A-Za-z][\w-]*)'\)/g)].map(m => m[1]));
const lost = [...looked].filter(id => !staticIds.includes(id) && !madeIds.has(id));
ok(looked.size > 100 && lost.length === 0, 'every element the app looks up by id exists (' + looked.size + ' looked up)' + (lost.length ? ' -> not found: ' + lost.join(', ') : ''));
const labelled = [...pageHtml.matchAll(/<(?:button|a)\b[^>]*>(?:\s|<[^>]+>)*<\/(?:button|a)>/g)].filter(m => !/aria-label|title=|<img|<svg|display:none/.test(m[0]));   // (a hidden one is filled in by the code when it is shown)
ok(labelled.length === 0, 'no button or link is empty (every one has words, a picture or a label)' + (labelled.length ? ' -> ' + labelled[0][0].slice(0, 80) : ''));

// ---- no other app, no emoji pictures ----
const noComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1').replace(/<!--[\s\S]*?-->/g, '');
const visible = noComments(pageHtml) + '\n' + noComments(mod);
const others = visible.match(/ChocoMCC|Choco-MCC|\bChocolate\b|\bPotato\b|\bVoltra\b|\bNexus\b|\bSoda\b|\bMint\b|Petro\b|Cookie\b/g) || [];
ok(others.length === 0, 'nothing from another app reaches a member (names, words)' + (others.length ? ' -> ' + [...new Set(others)].join(', ') : ''));
const pics = visible.match(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{2712}\u{2715}-\u{27BF}\u{2B00}-\u{2BFF}]/gu) || [];
ok(pics.length === 0, 'no emoji pictures in the pages or the code (SVG icons and the owner\'s pictures only)' + (pics.length ? ' -> ' + [...new Set(pics)].join(' ') : ''));
ok(!/\bUGX\s*\d+(?:\.\d+)?\s*[kKmM]\b|\b\d+(?:\.\d+)?\s*[kK]\b(?!g|m|b)/.test(visible.replace(/\b0x[0-9a-f]+\b/gi, '')), 'no abbreviated money ("23k") in anything a member reads');

// ---- only ChocoMCC's things (owner: "use only things of ChocoMCC, do not introduce anything without my consent") ----
const tiles = [...pageHtml.matchAll(/<div class="menu-tile-lbl"[^>]*>([^<]+)<\/div>/g)].map(m => m[1].replace(/&amp;/g, '&'));
ok(JSON.stringify(tiles) === JSON.stringify(['My AI robots', 'Ledger', 'My Team', 'Payout Account', 'Security', 'About Us', 'Terms & Rules', 'Support', 'Download App', 'Sign Out']), 'the Me page has exactly ChocoMCC\'s ten tiles, in its order: ' + tiles.join(', '));
const overlayIds = [...pageHtml.matchAll(/<div class="overlay" id="(ov[A-Za-z]+)"/g)].map(m => m[1]).sort();
ok(JSON.stringify(overlayIds) === JSON.stringify(['ovAbout', 'ovBindbank', 'ovChangepass', 'ovDeposit', 'ovDepositStatus', 'ovEarnings', 'ovMychoc', 'ovRecords', 'ovRules', 'ovSupport', 'ovTaskcenter', 'ovTeamlevel', 'ovWithdraw'].sort()), 'the full-page screens are exactly ChocoMCC\'s thirteen: ' + overlayIds.join(', '));
const serverSrc = fs.readFileSync(__dirname + '/server.js', 'utf8'), adminSrc = fs.readFileSync(__dirname + '/admin-src/index.html', 'utf8').replace(/base64,[A-Za-z0-9+\/=]{200,}/g, 'base64,...');   // (the panel's embedded font and pictures are not words)
ok(!/authenticator|twofa|2fa|totp/i.test(pageHtml + mod), 'no Google Authenticator anywhere in the member app');
ok(!/twofa|2fa|Google Authenticator/i.test(serverSrc + adminSrc), 'no Google Authenticator in the server or the admin panel (the admin LOGIN keeps its own optional 6-digit code, as in Potato, Mint and Chocolate)');
ok(!/api\('\/(messages|gifts|app\/claim|account\/2fa)/.test(mod) && !/app\.(get|post)\('\/(messages|gifts|app\/claim|account\/2fa|admin\/messages)/.test(serverSrc), 'no Messages, Order Gifts or app-reward route is called or served');
ok(!/orderGift|appClaim|order_gift|app_claim/.test(mod + serverSrc + adminSrc), 'no order gift or app reward setting, field or ledger kind is left');
ok(/<img class="ugx-coin" src="\/icons\/ugx-coin\.png" alt="UGX">/.test(pageHtml) && (pageHtml.match(/class="ugx-coin"/g) || []).length === 2, 'the Balance and Cash Outs figures have ChocoMCC\'s two UGX coin pictures');

// ---- layout: a full-page screen cannot be dragged sideways or hand its scroll to the page behind ----
const ovRule = (html.match(/\.overlay\{[^}]*\}/) || [''])[0];
ok(/position:fixed/.test(ovRule) && /inset:0/.test(ovRule) && /overflow-y:auto/.test(ovRule) && /overflow-x:hidden/.test(ovRule) && /overscroll-behavior:contain/.test(ovRule), 'a full-page screen fills the phone, scrolls up and down only, and keeps its scroll to itself');
ok(/\.modal-bg\{[^}]*position:fixed;inset:0/.test(html), 'dialogs cover the whole phone');
ok(/\.ov-top\{position:relative;/.test(html) && !/\.ov-top\{[^}]*position:sticky/.test(html), 'a page\'s blue header scrolls away with the page (not sticky), like Potato');
ok(/<meta name="viewport" content="[^"]*width=device-width[^"]*"/.test(html) && /viewport-fit=cover/.test(html), 'the page fits the phone width and the notch');
ok(/padding-bottom:calc\(66px \+ env\(safe-area-inset-bottom/.test(html), 'the last card of a tab ends above the bottom bar');

// ---- money, the way a member reads it ----
const ugxSrc = (mod.match(/function ugx\(n\)\{[^\n]*\}/) || [''])[0];
ok(!!ugxSrc, 'ugx() is in the app');
const ctx = vm.createContext({}); vm.runInContext(ugxSrc, ctx);
const money = v => vm.runInContext('ugx(' + JSON.stringify(v) + ')', ctx);
ok(money(23000) === 'UGX 23,000' && money(1000000) === 'UGX 1,000,000' && money(0) === 'UGX 0' && money(500) === 'UGX 500', 'money is written in full: UGX 23,000, UGX 1,000,000');
ok(money(1234.5) === 'UGX 1,234.50' && money(null) === 'UGX 0' && money('abc') === 'UGX 0' && money(-5000) === 'UGX -5,000', 'cents are shown only when there are some; nothing odd prints NaN');

// ---- the toast ----
ok(/function toast\(msg\)\{[\s\S]*?setTimeout\(function\(\)\{ bg\.classList\.remove\('show'\); \}, 2600\)/.test(mod), 'a notice closes by itself after 2.6 seconds');
ok(/\.toast-bg\{[^}]*pointer-events:none/.test(html) && !/\.toast-bg\.show[^{]*\{[^}]*pointer-events:(?:auto|all)/.test(html), 'and never blocks a tap on the page behind it');

// ---- no dialog of the browser's own ("179.198.197.114:8100 says Sign out?") ----
{
  const stripJs = js => js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/[^\n]*/g, '$1').replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, "''");
  const dialogCall = /(^|[^.\w$])(?:confirm|alert|prompt)\s*\(/;
  const attrJs = [...html.matchAll(/\son[a-z]+="([^"]*)"/g)].map(m => m[1].replace(/'(?:[^'\\]|\\.)*'/g, "''")).join('\n');
  ok(dialogCall.test('if(confirm(\'x\')) go()') && dialogCall.test(stripJs('var a = 1; alert(a);')), 'the check below can see a confirm( or alert( call');
  ok(!dialogCall.test(stripJs(mod)) && !dialogCall.test(stripJs(scripts)) && !dialogCall.test(attrJs), 'the app never opens the browser\'s own confirm / alert / prompt box: every question or message is the app\'s own');
  ok(/<button class="menu-tile" onclick="logout\(\)"><div class="menu-tile-ic pic"><img src="\/icons\/signout\.webp"/.test(html), 'Sign Out on the Me page signs out at once, with no question');
}
// ---- ChocoMCC's starting numbers (owner: "all should be for chocomcc"), the same on the server, in the app and in the admin panel ----
{
  const srvText = fs.readFileSync(__dirname + '/server.js', 'utf8'), adm = fs.readFileSync(__dirname + '/admin-src/index.html', 'utf8');
  const sd = srvText.match(/const DEFAULT_SETTINGS = \{[\s\S]*?withdrawFeePct: (\d+), minWithdraw: (\d+), minDeposit: (\d+),\s*welcomeBonus: (\d+), commL1: (\d+), commL2: (\d+), commL3: (\d+),/);
  ok(sd && sd.slice(1).join(',') === '15,5000,5000,7000,27,2,1', 'the server starts with fee 15%, minimum UGX 5,000 to top up and to cash out, welcome UGX 7,000 and commissions 27 / 2 / 1 % (' + (sd && sd.slice(1).join(',')) + ')');
  ok(/maxWithdrawalsPerDay: 2,/.test(srvText) && /dailyCheckin: 250,/.test(srvText), 'two cash-outs a day and a daily check-in of UGX 250');
  const cd = mod.match(/var DEFAULT_SETTINGS = \{\s*withdrawFeePct: (\d+), minWithdraw: (\d+), minDeposit: (\d+), welcomeBonus: (\d+),\s*commL1: (\d+), commL2: (\d+), commL3: (\d+), checkinLadder: \[[^\]]*\], dailyCheckin: (\d+), maxWithdrawalsPerDay: (\d+)/);
  ok(cd && cd.slice(1).join(',') === '15,5000,5000,7000,27,2,1,250,2', 'the app\'s own fallback is the same (' + (cd && cd.slice(1).join(',')) + ')');
  ok(/v\('minDeposit',5000\)/.test(adm) && /v\('minWithdraw',5000\)/.test(adm) && /v\('welcomeBonus',7000\)/.test(adm) && /v\('commL1',27\)/.test(adm) && /v\('maxWithdrawalsPerDay',2\)/.test(adm), 'and so are the admin panel\'s boxes');
}

// ---- shell, name, cache ----
const sw = fs.readFileSync(__dirname + '/user/sw.js', 'utf8'), manifest = JSON.parse(fs.readFileSync(__dirname + '/user/manifest.json', 'utf8'));
ok(/const CACHE = 'smartai-shell-v\d+'/.test(sw), 'the service worker has its own cache name');
ok(manifest.name === 'Smart AI' && manifest.short_name && /Smart/.test(manifest.short_name) && manifest.display === 'standalone', 'the installed app is called Smart AI and opens like an app');
ok(/<title>Smart AI<\/title>/.test(html), 'the page title is the app name');
ok(manifest.theme_color && /^#[0-9a-f]{6}$/i.test(manifest.theme_color) && manifest.background_color, 'the manifest has its colours');
if (built) {
  const b = fs.readFileSync(__dirname + '/user/index.html', 'utf8');
  ok(/<script data-nx-core>/.test(b) && !/function onFbAuthChanged/.test(b), 'the built page carries the app only as the packed core (not as readable code)');
  ok(b === fs.readFileSync(__dirname + '/user/share.html', 'utf8'), 'the invitation-link page is an identical copy');
}
console.log(`PASS: member app pages, static (${n} checks${built ? ', built' : ''})`);
