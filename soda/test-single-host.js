'use strict';
// App, API and admin panel share ONE host: the server answers under a private prefix (not /api), the
// panel lives under a secret path. Checks that no host is baked into the
// files, that the two service workers cannot interfere (separate caches, the
// API never cached, panel windows never confused with member windows), and
// that the panel's own files are addressed relative to its path.
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); }; const eq = (a, b, m) => { n++; assert.deepEqual(a, b, m); };
const read = f => fs.readFileSync(__dirname + '/' + f, 'utf8');

// 1. nothing is tied to a domain, port or other app
const FILES = ['user-src/index.html', 'user-src/original_module.js', 'admin-src/index.html', 'user/sw.js', 'admin/sw.js', 'user/manifest.json', 'admin/manifest.json'];
for (const f of FILES) {
  const code = read(f).replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n');
  // TEMPORARY: the admin panel's old push (Firebase Cloud Messaging) still carries Petro's
  // project id until Web Push replaces it (step 7); that exemption goes with it.
  const checked = /^admin(-src\/index\.html|\/sw\.js)$/.test(f) ? code.replace(/chnpetrol/g, '') : code;
  ok(!/p-colasoda|mysoda|cchnug|179\.198\.197|petro/i.test(checked), f + ' has no domain, IP or Petro name baked in');
}
ok(/var API_BASE = '\/k7x2';/.test(read('user-src/original_module.js')), 'the app talks to /k7x2 on its own host');
ok(/const SODA_AUTH_API = '\/k7x2';/.test(read('user-src/index.html')), 'so does its sign-in module');
ok(/const SERVER = '\/k7x2';/.test(read('admin-src/index.html')), 'and the admin panel');
for (const f of ['user-src/index.html', 'admin-src/index.html']) {
  const csp = read(f).match(/Content-Security-Policy" content="([^"]*)"/)[1];
  ok(/connect-src 'self'(;| https:\/\/\*\.googleapis\.com)/.test(csp) && !/https?:\/\/(?!\*\.googleapis)[a-z0-9.-]+\.(com|net|org)/.test(csp.replace(/fonts\.(googleapis|gstatic)\.com/g, '')), f + ': connect-src is the page\'s own origin');
}
ok(!/gstatic\.com\/firebasejs|firebase-app\.js/.test(read('user-src/index.html')) && !/www\.gstatic\.com/.test(read('user-src/index.html').match(/script-src[^;]*/)[0]), 'the member page loads no Google script');

// the API prefix is ONE word everywhere (and is not the guessable /api)
{
  const PREFIX = /const API = '([^']+)';/.exec(read('deploy/make-nginx.js'))[1];
  ok(PREFIX !== 'api' && /^[a-z0-9]{3,16}$/.test(PREFIX), 'the API prefix is a private word, not /api');
  const want = {
    'user-src/original_module.js': [`var API_BASE = '/${PREFIX}';`],
    'user-src/index.html': [`const SODA_AUTH_API = '/${PREFIX}';`, `/${PREFIX}/public/loader-image`, `/${PREFIX}/public/app-icon-192.png`],
    'admin-src/index.html': [`const SERVER = '/${PREFIX}';`, `/${PREFIX}/public/app-icon-192.png`],
    'user/sw.js': [`const API_ORIGIN = '/${PREFIX}';`, `'/${PREFIX}/'`],
    'admin/sw.js': [`'/${PREFIX}'`, `'/${PREFIX}/'`, `/${PREFIX}/public/app-icon-192.png`],
    'user/manifest.json': [`/${PREFIX}/public/app-icon-512.png`],
    'admin/manifest.json': [`/${PREFIX}/public/app-icon-512.png`],
  };
  for (const [f, needles] of Object.entries(want)) {
    const src = read(f);
    for (const n of needles) ok(src.includes(n), `${f} uses the API prefix: ${n}`);
    ok(!/['"`(]\/api[\/'"`]/.test(src.replace(/\/\/.*$/gm, '')), `${f} no longer calls /api`);
  }
  for (const f of ['user/index.html', 'user/share.html', 'admin/index.html']) ok(!/\/api\/public|SODA_AUTH_API = '\/api'|SERVER = '\/api'/.test(read(f)), `built ${f} no longer calls /api`);
  const prod = require('child_process').execFileSync('node', ['deploy/make-nginx.js', 'prod', 'example.com', 'Panel7x9k'], { encoding: 'utf8' });
  ok(prod.includes(`location /${PREFIX}/ {`) && prod.includes(`rewrite ^/${PREFIX}/(.*)$ /$1 break;`) && !/location[^\n]*\/api\b/.test(prod) && !/Disallow: \/\w/.test(prod.split('location = /robots.txt')[1] || ''), 'nginx proxies the prefix, has no /api location, and robots.txt does not give the prefix away');
}
// 2. the admin panel addresses its own files relative to its (secret) path
const admin = read('admin-src/index.html').replace(/<!--[\s\S]*?-->/g, '');
ok(!/(href|src)="\/(?!\/|k7x2\/)/.test(admin), 'no root-absolute href/src in the panel (except /k7x2/...)');
ok(!/register\('\/sw\.js'/.test(admin) && /register\('sw\.js'/.test(admin), 'the panel registers its worker relative to its own path');
eq([JSON.parse(read('admin/manifest.json')).start_url, JSON.parse(read('admin/manifest.json')).scope], ['./', './'], 'panel manifest is scoped to its own path');
eq([JSON.parse(read('user/manifest.json')).start_url, JSON.parse(read('user/manifest.json')).scope], ['/', '/'], 'member manifest keeps the root');

// the generated file is included next to other sites' files in one http block: a top-level
// server_tokens there is a duplicate-directive error that stops every reload (seen live)
for (const args of [['dev', 'Panel7x9k'], ['prod', 'mysoda.example.com', 'Panel7x9k']]) {
  const out = require('child_process').execFileSync('node', ['deploy/make-nginx.js', ...args], { encoding: 'utf8' });
  ok(!/^server_tokens/m.test(out), `${args[0]} nginx file has no top-level server_tokens (it clashes with other sites)`);
  // seen live: Petro's file already sets these at the top level, so a second copy fails nginx -t
  ok(!/^\s*ssl_(protocols|ciphers|prefer_server_ciphers|session_(cache|timeout|tickets))\b/m.test(out), `${args[0]} nginx file sets no TLS defaults of its own (they clash with other sites and certbot)`);
}
// two-host setup: the admin panel lives ONLY on its own hidden host
{
  const gen = (...a) => require('child_process').execFileSync('node', ['deploy/make-nginx.js', ...a], { encoding: 'utf8' });
  const two = gen('prod', 'example.com', 'Panel7x9k', 'sv37ah.example.com');
  const blocks = two.split(/^server \{/m).slice(1);
  ok(blocks.length === 2, 'two-host mode writes two server blocks');
  const [mem, adm] = blocks;
  ok(/server_name example\.com;/.test(mem) && /server_name sv37ah\.example\.com;/.test(adm), 'each block has its own host');
  ok(!/Panel7x9k/.test(mem) && /location \^~ \/k7x2\/admin\/ \{ return 404; \}/.test(mem), 'the member host serves no admin path and refuses /k7x2/admin/');
  ok(/location \^~ \/Panel7x9k\//.test(adm) && /location \/ \{ return 404; \}/.test(adm) && !/refCode|share\.html|\/user;/.test(adm), 'the admin host serves only the admin path, the API behind it, and 404 for everything else');
  ok(!/\/k7x2\/admin\/ \{ return 404/.test(adm) && /location ~ \^\/k7x2\/admin\/\(login\|check-key\)\$/.test(adm), 'the admin host still reaches the admin API');
  ok(gen('prod', 'example.com', 'Panel7x9k') === gen('prod', 'example.com', 'Panel7x9k'), 'one-host output is stable');
  // extra member addresses typed as words
  const also = gen('prod', 'example.com', 'Panel7x9k', 'sv37ah.example.com', '--also=mysoda, Go ,mysoda,promo.other.com');
  const ab = also.split(/^server \{/m).slice(1);
  ok(/server_name example\.com mysoda\.example\.com go\.example\.com promo\.other\.com;/.test(ab[0]), 'each word becomes <word>.<host> on the member block (once, any case)');
  ok(/server_name sv37ah\.example\.com;/.test(ab[1]) && !/mysoda/.test(ab[1]), 'the hidden admin host stays alone on its own block');
  ok(gen('prod', 'example.com', 'Panel7x9k', '--also=mysoda').includes('server_name example.com mysoda.example.com;'), 'words also work without a separate admin host');
  for (const badArgs of [['prod', 'example.com', 'Panel7x9k', 'sv37ah.example.com', '--also=sv37ah'], ['prod', 'example.com', 'Panel7x9k', '--also=bad word'], ['dev', 'Panel7x9k', '--also=x']]) {
    let refused = false; try { gen(...badArgs); } catch (e) { refused = true; }
    ok(refused, 'refused: ' + badArgs.slice(3).join(' '));
  }
  let bad = false; try { gen('prod', 'example.com', 'Panel7x9k', 'example.com'); } catch (e) { bad = true; }
  ok(bad, 'the admin host must differ from the member host');
}
// 3. the two service workers share a host without trampling each other
function boot(file, scope) {
  const L = {}, cacheOps = { deleted: [] }; let responded = 0, respondedWith;
  const self = { location: { origin: 'https://h.example' }, registration: { scope }, addEventListener: (t, f) => { L[t] = f; }, skipWaiting() {}, clients: { claim: async () => {}, matchAll: async () => [] } };
  const ctx = { self, importScripts() {}, URL, Response, fetch: async () => new Response('net'), console, Promise, JSON, Date,
    caches: { open: async () => ({ addAll: async () => {}, put: async () => {}, match: async () => undefined }), keys: async () => cacheOps.keys, delete: async k => { cacheOps.deleted.push(k); return true; }, match: async () => undefined },
    firebase: { initializeApp() {}, messaging: () => ({ onBackgroundMessage() {} }) } };
  vm.runInNewContext(read(file), ctx);
  const fetchEvent = (url, mode = 'cors') => { responded = 0; respondedWith = null; L.fetch({ request: { url, mode }, respondWith: p => { responded++; respondedWith = p; } }); return { responded, respondedWith }; };
  const activate = async keys => { cacheOps.keys = keys; cacheOps.deleted = []; let p; L.activate({ waitUntil: x => { p = x; } }); await p; return cacheOps.deleted.slice(); };
  return { fetchEvent, activate, L };
}
(async () => {
  const curU = /const CACHE = '([^']+)'/.exec(read('user/sw.js'))[1], curA = /const CACHE = '([^']+)'/.exec(read('admin/sw.js'))[1];
  let u = boot('user/sw.js', 'https://h.example/');
  const del = await u.activate(['soda-shell-v1', curU, curA, 'soda-brand-v1', 'soda-vendor-firebase-v1']);
  eq(del.sort(), ['soda-shell-v1', 'soda-vendor-firebase-v1'], "the member worker clears only its own old caches, never the admin panel's");
  eq(u.fetchEvent('https://h.example/k7x2/account').responded, 0, 'the member worker never touches /k7x2 (per-user data is never cached)');
  eq(u.fetchEvent('https://h.example/k7x2/public/settings').responded, 0);
  ok(u.fetchEvent('https://h.example/index.html', 'navigate').responded === 1, 'but still serves its own pages');
  let a = boot('admin/sw.js', 'https://h.example/panel/');
  const del2 = await a.activate(['soda-admin-shell-v1', curA, curU, 'soda-brand-v1']);
  eq(del2, ['soda-admin-shell-v1'], "the admin worker clears only its own old caches, never the member app's");
  const r = a.fetchEvent('https://h.example/k7x2/admin/stats'); eq(r.responded, 1, 'the panel passes /k7x2 straight to the network');
  console.log(`PASS: one host for app, API and admin (${n} checks)`); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
