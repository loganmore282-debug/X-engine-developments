'use strict';
// Quality guards for the member app:
//   1. the page's CSS has no class nobody uses and no selector written twice (dead rules and overrides stay out), and is keyboard/touch friendly;
//   2. the live activity strip asks the server one request at a time, not while the app is in the background, and again at once when it returns;
//   3. getSettings() (called on every paint) parses the stored settings only when they changed.
//   node test-app-quality.js
const path = require('path'), Module = require('module'), http = require('http'), fs = require('fs'), zlib = require('zlib');
process.chdir(__dirname);
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...a) { return req === 'mongodb' ? path.join(__dirname, 'test-helpers', 'fake-mongodb.js') : origResolve.call(this, req, ...a); };
const BACK = 4100 + Math.floor(Math.random() * 400), FRONT = 4600 + Math.floor(Math.random() * 400);
process.env.PORT = String(BACK); process.env.MONGODB_URI = 'mongodb://fake/app'; process.env.ADMIN_KEY = 'quality-test-admin-key-123456'; process.env.NODE_ENV = 'development';
process.env.POTATO_SECRETS_DIR = fs.mkdtempSync(path.join(require('os').tmpdir(), 'sa-qual-'));
const realLog = console.log, serverErrors = [];
console.log = () => {}; console.warn = () => {}; console.error = (...a) => { serverErrors.push(a.map(x => (x && x.message) || String(x)).join(' ').slice(0, 300)); };
require(path.join(__dirname, 'server.js'));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; realLog('  ok   - ' + m); } else { fail++; realLog('  FAIL - ' + m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const base = 'http://127.0.0.1:' + BACK;
const J = async (m, p, b, tok, adm) => { const r = await fetch(base + p, { method: m, headers: Object.assign({ 'content-type': 'application/json' }, tok ? { authorization: 'Bearer ' + tok } : {}, adm ? { authorization: 'Bearer quality-test-admin-key-123456' } : {}), body: b ? JSON.stringify(b) : undefined }); let j = null; try { j = await r.json(); } catch (_) {} return { s: r.status, j }; };
const read = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(zlib.crc32(td) >>> 0); return Buffer.concat([len, td, c]); }
function pngBuf(r, g, b) {
  const w = 8, h = 8, raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; } }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const pic = 'data:image/png;base64,' + pngBuf(220, 60, 60).toString('base64');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp' };
const staticServer = (dir, withProxy) => http.createServer((req, res) => {
  if (withProxy && req.url.startsWith('/k7x2/')) {
    const p = http.request({ host: '127.0.0.1', port: BACK, path: req.url.slice(5), method: req.method, headers: Object.assign({}, req.headers, { host: '127.0.0.1:' + BACK }) }, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    p.on('error', () => { res.writeHead(502); res.end(); }); req.pipe(p); return;
  }
  let f = req.url.split('?')[0]; if (f === '/' || !/\.[a-z0-9]+$/i.test(f)) f = '/index.html';
  fs.readFile(path.join(dir, path.normalize(f).replace(/^(\.\.[\/\\])+/, '')), (e, buf) => { if (e) { res.writeHead(404); res.end('nf'); return; } res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(buf); });
});

(async () => {
  // ---- 1. CSS
  const page = read('user-src/index.html'), js = read('user-src/original_module.js');
  const css = page.slice(page.indexOf('<style>') + 7, page.indexOf('</style>')).replace(/\/\*[\s\S]*?\*\//g, '');
  const markup = page.replace(/<style>[\s\S]*?<\/style>/, '');
  const classes = new Set([...css.replace(/\{[^}]*\}/g, '{}').matchAll(/\.([a-zA-Z_][\w-]*)/g)].map(m => m[1]));
  const unused = [...classes].filter(c => !new RegExp('(?<![\\w-])' + c.replace(/[-]/g, '\\-') + '(?![\\w-])').test(markup + js));
  ok(unused.length === 0, 'every CSS class is used by the page or the app' + (unused.length ? ': ' + unused.join(', ') : ''));
  const seen = {}, dup = [];
  for (const m of css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) { const s = m[1].trim().replace(/\s+/g, ' '); if (/^(\d+%|from|to)(,|$)/.test(s)) continue; if (seen[s]) dup.push(s); seen[s] = 1; }
  ok(dup.length === 0, 'no selector is written twice' + (dup.length ? ': ' + dup.join(' | ') : ''));
  ok(/button:focus-visible/.test(css) && /touch-action:manipulation/.test(css) && /prefers-reduced-motion/.test(css), 'keyboard focus rings, no tap delay and reduced motion are handled');

  const admin = read('admin-src/index.html'), man = JSON.parse(read('admin/manifest.json'));
  ok(/--gold:#137aef;/.test(admin) && /--gold-deep:#0d5fd2;/.test(admin) && !/e5231d|c9161d/i.test(admin) && man.theme_color === '#137aef', 'the admin panel is blue like the app (no leftover red theme in the page, its colour bar or its manifest)');
  // ---- 2 and 3. the real app
  for (let i = 0; i < 60; i++) { try { const hh = await fetch(base + '/health'); if (hh.ok) break; } catch (_) {} await sleep(250); }
  const front = staticServer(path.join(__dirname, 'user'), true); await new Promise(r => front.listen(FRONT, '127.0.0.1', r));
  const phone = '0771234567', su = await J('POST', '/auth/signup', { phone, password: 'secret12' });
  await J('POST', '/register', { pin: '123456', referralCode: '' }, su.j.token);
  const { chromium } = require('playwright'); const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
  await ctx.addInitScript(() => { window._smartaiLoaderMinMs = 0; });
  const p = await ctx.newPage(); const errs = []; let feedCalls = 0;
  p.on('pageerror', e => errs.push(String(e.message || e).slice(0, 200)));
  p.on('request', r => { if (/\/public\/activity-feed/.test(r.url())) feedCalls++; });
  await p.goto('http://127.0.0.1:' + FRONT + '/', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => document.getElementById('authScreen').style.display === 'flex', null, { timeout: 10000 });
  await p.fill('#fPhone', phone.replace(/^0/, '')); await p.fill('#fPass', 'secret12'); await p.click('#authGo');
  ok(await p.waitForFunction(() => document.getElementById('app').style.display === 'block', null, { timeout: 15000 }).then(() => true, () => false), 'a member signs in');
  await p.evaluate(() => { try { dismissAnnouncement(); } catch (e) {} try { dismissInstallSheet(); } catch (e) {} stopAccountPoll(); });
  await sleep(600);
  ok(await p.evaluate(() => !!document.querySelector('#tickerBox .ticker-track')), 'the live activity strip is showing');
  // fast clock for the test
  await p.evaluate(() => { ACTIVITY_FEED_MS = 250; startActivityFeed(); });
  await sleep(1300); const running = feedCalls;
  ok(running >= 4, 'while the app is in front the strip asks again and again (' + running + ' requests in about 1.3 s)');
  await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  await sleep(200); const atHide = feedCalls; await sleep(1200);
  ok(feedCalls === atHide, 'in the background it asks for nothing (' + (feedCalls - atHide) + ' requests in 1.2 s)');
  await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
  await sleep(150);
  ok(feedCalls > atHide, 'and asks again at once when the app comes back');
  // the same rows again leave the running strip alone
  const trackBefore = await p.evaluate(() => { const t = document.querySelector('#tickerBox .ticker-track'); t.dataset.mark = 'same'; return !!t; });
  await sleep(700);
  ok(trackBefore && await p.evaluate(() => { const t = document.querySelector('#tickerBox .ticker-track'); return !!t && t.dataset.mark === 'same'; }), 'when the server sends the same rows the running strip is not rebuilt');
  await p.evaluate(() => stopActivityFeed());
  await sleep(300); const atStop = feedCalls; await sleep(900);
  ok(feedCalls === atStop, 'stopping it (sign out) stops the requests');
  // settings are parsed once, not on every paint
  const parses = await p.evaluate(() => { var n = 0, orig = JSON.parse; JSON.parse = function () { n++; return orig.apply(this, arguments); }; for (var i = 0; i < 200; i++) getSettings(); JSON.parse = orig; return n; });
  ok(parses <= 1, '200 reads of the settings parse them at most once (' + parses + ')');
  const changed = await p.evaluate(() => { var raw = JSON.parse(localStorage.getItem(SETTINGS_CACHE_KEY) || '{}'); raw.brandName = 'Quality Test'; localStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify(raw)); return getSettings().brandName; });
  ok(changed === 'Quality Test', 'a changed setting is still picked up at once');
  ok(errs.length === 0, 'the member app raised no errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  ok(serverErrors.length === 0, 'no server errors' + (serverErrors.length ? ': ' + serverErrors.slice(0, 2).join(' | ') : ''));
  await browser.close(); front.close();
  realLog('\n' + (fail ? 'FAIL' : 'PASS') + ': app quality (' + pass + ' ok, ' + fail + ' failed)');
  process.exit(fail ? 1 : 0);
})().catch(e => { realLog('CRASH ' + (e && e.stack || e)); process.exit(1); });
