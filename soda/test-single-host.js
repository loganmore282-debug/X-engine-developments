'use strict';
// App, API and admin panel share ONE host: the server answers under /api, the
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
ok(/var API_BASE = '\/api';/.test(read('user-src/original_module.js')), 'the app talks to /api on its own host');
ok(/const SODA_AUTH_API = '\/api';/.test(read('user-src/index.html')), 'so does its sign-in module');
ok(/const SERVER = '\/api';/.test(read('admin-src/index.html')), 'and the admin panel');
for (const f of ['user-src/index.html', 'admin-src/index.html']) {
  const csp = read(f).match(/Content-Security-Policy" content="([^"]*)"/)[1];
  ok(/connect-src 'self'(;| https:\/\/\*\.googleapis\.com)/.test(csp) && !/https?:\/\/(?!\*\.googleapis)[a-z0-9.-]+\.(com|net|org)/.test(csp.replace(/fonts\.(googleapis|gstatic)\.com/g, '')), f + ': connect-src is the page\'s own origin');
}
ok(!/gstatic\.com\/firebasejs|firebase-app\.js/.test(read('user-src/index.html')) && !/www\.gstatic\.com/.test(read('user-src/index.html').match(/script-src[^;]*/)[0]), 'the member page loads no Google script');

// 2. the admin panel addresses its own files relative to its (secret) path
const admin = read('admin-src/index.html').replace(/<!--[\s\S]*?-->/g, '');
ok(!/(href|src)="\/(?!\/|api\/)/.test(admin), 'no root-absolute href/src in the panel (except /api/...)');
ok(!/register\('\/sw\.js'/.test(admin) && /register\('sw\.js'/.test(admin), 'the panel registers its worker relative to its own path');
eq([JSON.parse(read('admin/manifest.json')).start_url, JSON.parse(read('admin/manifest.json')).scope], ['./', './'], 'panel manifest is scoped to its own path');
eq([JSON.parse(read('user/manifest.json')).start_url, JSON.parse(read('user/manifest.json')).scope], ['/', '/'], 'member manifest keeps the root');

// the generated file is included next to other sites' files in one http block: a top-level
// server_tokens there is a duplicate-directive error that stops every reload (seen live)
for (const args of [['dev', 'Panel7x9k'], ['prod', 'mysoda.example.com', 'Panel7x9k']]) {
  const out = require('child_process').execFileSync('node', ['deploy/make-nginx.js', ...args], { encoding: 'utf8' });
  ok(!/^server_tokens/m.test(out), `${args[0]} nginx file has no top-level server_tokens (it clashes with other sites)`);
}
// two-host setup: the admin panel lives ONLY on its own hidden host
{
  const gen = (...a) => require('child_process').execFileSync('node', ['deploy/make-nginx.js', ...a], { encoding: 'utf8' });
  const two = gen('prod', 'example.com', 'Panel7x9k', 'sv37ah.example.com');
  const blocks = two.split(/^server \{/m).slice(1);
  ok(blocks.length === 2, 'two-host mode writes two server blocks');
  const [mem, adm] = blocks;
  ok(/server_name example\.com;/.test(mem) && /server_name sv37ah\.example\.com;/.test(adm), 'each block has its own host');
  ok(!/Panel7x9k/.test(mem) && /location \^~ \/api\/admin\/ \{ return 404; \}/.test(mem), 'the member host serves no admin path and refuses /api/admin/');
  ok(/location \^~ \/Panel7x9k\//.test(adm) && /location \/ \{ return 404; \}/.test(adm) && !/refCode|share\.html|\/user;/.test(adm), 'the admin host serves only the admin path, the API behind it, and 404 for everything else');
  ok(!/\/api\/admin\/ \{ return 404/.test(adm) && /location ~ \^\/api\/admin\/\(login\|check-key\)\$/.test(adm), 'the admin host still reaches the admin API');
  ok(gen('prod', 'example.com', 'Panel7x9k') === gen('prod', 'example.com', 'Panel7x9k'), 'one-host output is stable');
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
  eq(u.fetchEvent('https://h.example/api/account').responded, 0, 'the member worker never touches /api (per-user data is never cached)');
  eq(u.fetchEvent('https://h.example/api/public/settings').responded, 0);
  ok(u.fetchEvent('https://h.example/index.html', 'navigate').responded === 1, 'but still serves its own pages');
  let a = boot('admin/sw.js', 'https://h.example/panel/');
  const del2 = await a.activate(['soda-admin-shell-v1', curA, curU, 'soda-brand-v1']);
  eq(del2, ['soda-admin-shell-v1'], "the admin worker clears only its own old caches, never the member app's");
  const r = a.fetchEvent('https://h.example/api/admin/stats'); eq(r.responded, 1, 'the panel passes /api straight to the network');
  console.log(`PASS: one host for app, API and admin (${n} checks)`); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
