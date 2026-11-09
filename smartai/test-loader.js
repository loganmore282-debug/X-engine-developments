'use strict';
// Start-up loader: the admin's box picture, the app name, a bar and "Loading... N%" counting up, then "Ready" for a moment and the page opens
// (never earlier than 2.5 s from the page start). The sign-in script and the app unpack in either order and still meet (otherwise the loader
// would stay for ever). Source, and the built page with --built.
const fs = require('node:fs'), assert = require('node:assert/strict');
const built = process.argv.includes('--built');
const html = fs.readFileSync(__dirname + (built ? '/user/index.html' : '/user-src/index.html'), 'utf8');
const server = fs.readFileSync(__dirname + '/server.js', 'utf8');
const admin = fs.readFileSync(__dirname + '/admin-src/index.html', 'utf8');
const mod = fs.readFileSync(__dirname + '/user-src/original_module.js', 'utf8');
const htmlText = html.replace(/<script data-nx-core>[\s\S]*?<\/script>/, '');   // the built bundle's base64 blob can contain any short word by chance
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); };
ok(/id="ldBox"/.test(htmlText) && /class="ld-name" data-brandname/.test(htmlText) && /<i id="ldFill">/.test(htmlText) && /id="ldPct"[^>]*>Loading\.\.\. 0%/.test(htmlText), 'the loader is the box picture, the app name, a bar and "Loading... N%"');
ok(/#loadingScreen\{[^}]*background:#0964cd/.test(htmlText) && /\.ld-box\{width:150px;height:150px;border-radius:14px/.test(htmlText), 'the start-up page is blue and the box picture is 150 px with rounded corners done by the app');
ok(/\.sr-only\{/.test(htmlText), 'the screen-reader word is hidden');
ok(/'profilelogo', 'loaderbg'/.test(server) && /app\.get\('\/public\/loader-image'/.test(server), 'server stores and serves the loader picture');
ok(/id="loaderBgFile"/.test(admin) && /wireSmartAIImageSlot\('loaderbg'/.test(admin), 'admin can upload and remove it');
ok(!/loaderBgOpacity|loaderBgBlur|X-Loader-Opacity|ld-bg/.test(htmlText + mod + server + admin), 'the loader has no opacity or blur setting');
ok(/<script data-smartai-loader>/.test(htmlText) && /localStorage\.getItem\(KEY\)/.test(htmlText) && /box\.style\.backgroundImage = 'url\("' \+ kept/.test(htmlText) && /window\._smartaiLoaderStart = Date\.now\(\)/.test(htmlText), 'the kept loading picture is painted inline on the first frame, before any network request');
ok(/fetch\('\/k7x2\/public\/loader-image', \{ cache: 'no-cache' \}\)/.test(htmlText) && /localStorage\.setItem\(KEY, u\)/.test(htmlText), 'and refreshed in the background for the next visit');
ok(/window\._smartaiLoaderReady = function\(\)\{ if \(pct\) pct\.textContent = 'Ready'/.test(htmlText) && /LOADED_MS = 150, READY_MS = 350/.test(mod) && /_smartaiLoaderReady\(\); _ldTimer = setTimeout\(go, READY_MS\)/.test(mod), 'after Loading... 100% the loader says Ready for a few hundred milliseconds and then opens the page');
ok(/var LOADER_MIN_MS = 2500/.test(mod) && /function hideLoadingScreen\(\)/.test(mod), 'the loading screen stays for 2.5 seconds before the page opens, through one function');
ok(!/\$\('loadingScreen'\)\.style\.display = 'none'/.test(mod), 'and nothing hides it any other way');
ok(/window\._smartaiLoaderProgress = function/.test(htmlText) && /'Loading\.\.\. ' \+ n \+ '%'/.test(htmlText) && /window\._smartaiLoaderProgress\(100\)/.test(mod), 'the percentage counts up from the start of the page and reads 100 when the page opens');
ok(/window\._smartaiAuthFired = true;\s*window\.dispatchEvent\(new CustomEvent\('snow-auth'/.test(htmlText), 'the sign-in script records that it has announced who is signed in');
ok(/window\.addEventListener\('snow-auth', function\(ev\)\{ onFbAuthChanged\(ev\.detail\); \}\);[\s\S]{0,700}if \(window\._smartaiAuthFired && window\.fbAuth\) onFbAuthChanged\(window\.fbAuth\.currentUser\);/.test(mod), 'and the app picks that announcement up itself when its own code unpacks later (otherwise the loading screen stays for ever)');
ok(!/fireConfetti|confettiCanvas/.test(mod + htmlText), 'no confetti or sparkles anywhere');
ok(/_smartaiLoaderMinMs/.test(mod) && /_smartaiLoaderReadyMs/.test(mod), 'tests can shorten the loader (min time and Ready pause)');
console.log(`PASS: loader (${n} checks${built ? ', built bundle' : ''})`);
