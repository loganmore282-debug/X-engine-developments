'use strict';
// Safeguards against interception and request attacks, on the REAL server and the REAL page:
//   - the page sends a real address that was opened over plain http to https at once (the IP preview and localhost stay as they are);
//   - the https site's CSP upgrades insecure requests (the IP preview's does not, it would break it);
//   - hostile requests: a foreign origin gets no CORS permission, an oversized body / token is refused, __proto__ in a body pollutes nothing, wrong methods and
//     the admin routes without the key are refused, a forged MarzPay callback credits nothing, the callback log cannot be written to by the caller;
//   - the app's inline handlers never carry data inside a JavaScript string (esc() turns ' into &#39; which the browser turns back into ' inside an onclick).
const path = require('path'), Module = require('module'), http = require('http'), fs = require('fs'), cp = require('child_process');
process.chdir(__dirname);
const fm = require('./test-helpers/fake-mongodb.js');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...a) { return req === 'mongodb' ? path.join(__dirname, 'test-helpers', 'fake-mongodb.js') : origResolve.call(this, req, ...a); };
const BACK = 4100 + Math.floor(Math.random() * 400), FRONT = 4600 + Math.floor(Math.random() * 400);
process.env.PORT = String(BACK); process.env.MONGODB_URI = 'mongodb://fake/app'; process.env.ADMIN_KEY = 'sg-admin-key-1234567'; process.env.NODE_ENV = 'production';
process.env.POTATO_SECRETS_DIR = fs.mkdtempSync(path.join(require('os').tmpdir(), 'sa-sg-'));
const realLog = console.log, logged = []; console.log = (...a) => logged.push(a.join(' ')); console.warn = () => {}; console.error = () => {};
require('./server.js');
let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; realLog('  ok   - ' + m); } else { fail++; realLog('  FAIL - ' + m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const base = 'http://127.0.0.1:' + BACK, read = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
const html = read('user-src/index.html'), app = read('user-src/original_module.js');
ok(/location\.protocol === 'http:'/.test(html) && /location\.replace\('https:\/\/'/.test(html), 'the page has the http-to-https guard');
ok(/data-key="' \+ esc\(p\.key\) \+ '" onclick="buyProduct\(this,this\.dataset\.key\)"/.test(app) && /goToShopProduct\(this\.dataset\.key\)/.test(app) && !/onclick="[^"]*\\'' \+ esc\(/.test(app), 'no inline handler carries data inside a JavaScript string');
const prodConf = cp.execFileSync('node', ['deploy/make-nginx.js', 'prod', 'a.example.com', 'N85d57j4'], { encoding: 'utf8' }), devConf = cp.execFileSync('node', ['deploy/make-nginx.js', 'dev', 'N85d57j4'], { encoding: 'utf8' });
ok(/upgrade-insecure-requests/.test(prodConf) && !/upgrade-insecure-requests/.test(devConf), "the https site's CSP upgrades insecure requests; the IP preview's does not");
ok(/connect-src 'self'/.test(prodConf) && /frame-ancestors 'none'/.test(prodConf) && /Strict-Transport-Security/.test(prodConf), 'and it keeps connect-src self, no framing and HSTS');
(async () => {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/health')).ok) break; } catch (_) {} await sleep(250); }
  let r = await fetch(base + '/public/settings', { headers: { Origin: 'https://evil.example' } });
  ok(!r.headers.get('access-control-allow-origin'), 'a foreign origin gets no CORS permission');
  ok(r.headers.get('x-content-type-options') === 'nosniff' && r.headers.get('x-frame-options') === 'DENY' && /max-age/.test(r.headers.get('strict-transport-security') || '') && !r.headers.get('x-powered-by'), 'security headers are on and the server does not name itself');
  r = await fetch(base + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: 'x', password: 'y'.repeat(2000000) }) });
  ok(r.status === 413, 'a 2 MB body is refused');
  r = await fetch(base + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"__proto__":{"polluted":true},"phone":"0771234567","password":"abcdef"}' });
  ok(r.status === 401 && ({}).polluted === undefined, '__proto__ in a body pollutes nothing');
  r = await fetch(base + '/account', { headers: { Authorization: 'Bearer ' + 'a'.repeat(100000) } });
  ok(r.status === 431 || r.status === 400, 'a 100 KB token is refused');
  for (const m of ['PUT', 'DELETE', 'PATCH']) { r = await fetch(base + '/account', { method: m }); ok(r.status === 404 || r.status === 405, m + ' is not a route'); }
  for (const p of ['/admin/users', '/admin/settings', '/admin/smartai-images', '/admin/live']) { r = await fetch(base + p); ok(r.status === 401, p + ' needs the admin key'); }
  r = await fetch(base + '/account', { headers: { Authorization: 'Bearer ' + 'a'.repeat(43) } }); ok(r.status === 401, 'a forged session token is refused');
  r = await fetch(base + '/deploy/webhook', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); ok(r.status === 401, 'the deploy webhook refuses an unsigned call');
  const before = fm.__stores.pendingDeposits ? fm.__stores.pendingDeposits.size : 0;
  r = await fetch(base + '/deposit/callback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data: { reference: 'x\nFAKE LOG LINE: admin logged in', status: 'success' } }) });
  await sleep(300);
  ok(r.status === 200 && (fm.__stores.users ? [...fm.__stores.users.values()].every(u => !(u.walletBalance > 0)) : true), 'a forged MarzPay callback is acknowledged and credits nothing');
  ok(!logged.some(l => /\nFAKE LOG LINE/.test(l)) && logged.some(l => /MarzPay deposit callback/.test(l) && !/\n/.test(l)), 'and the caller cannot write a fake line into the log');
  // the page in a real browser
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ args: ['--host-resolver-rules=MAP app.test 127.0.0.1'] });
  const front = http.createServer((q, s) => { s.writeHead(200, { 'content-type': 'text/html' }); s.end(read('user/index.html')); });
  await new Promise(rs => front.listen(FRONT, '127.0.0.1', rs));
  const page = await (await browser.newContext({ serviceWorkers: 'block' })).newPage();
  const asked = []; page.on('request', q => { if (q.isNavigationRequest()) asked.push(q.url()); });
  await page.goto('http://app.test:' + FRONT + '/?x=1#/a', { waitUntil: 'commit' }).catch(() => {});
  await sleep(900);
  ok(asked.some(u => /^https:\/\/app\.test:\d+\/\?x=1/.test(u)), 'a real address opened over http is sent to https, query kept (' + asked.join(' , ') + ')');
  await page.goto('http://127.0.0.1:' + FRONT + '/', { waitUntil: 'domcontentloaded' }); await sleep(400);
  ok(page.url().startsWith('http://127.0.0.1:'), 'the IP preview and localhost stay on http');
  await browser.close(); front.close();
  realLog('\n' + (fail ? 'FAIL' : 'PASS') + ': http safeguards (' + pass + ' ok, ' + fail + ' failed)'); process.exit(fail ? 1 : 0);
})().catch(e => { realLog('CRASH ' + (e && e.stack || e)); process.exit(1); });
