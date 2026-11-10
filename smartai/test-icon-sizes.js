'use strict';
// The owner sets the size of the navigation, Home and Me icons in the admin panel, end to end:
//   1. the server keeps 26 / 34 / 36 px by default, accepts the owner's values, refuses anything outside the ranges, and members receive them;
//   2. the admin Settings tab has the three boxes and sends them when saved;
//   3. a real phone-sized browser: the icons really are that size (and the box around each one follows).
//   node test-icon-sizes.js
const path = require('path'), Module = require('module'), http = require('http'), fs = require('fs'), zlib = require('zlib');
process.chdir(__dirname);
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...a) { return req === 'mongodb' ? path.join(__dirname, 'test-helpers', 'fake-mongodb.js') : origResolve.call(this, req, ...a); };
const BACK = 4100 + Math.floor(Math.random() * 400), FRONT = 4600 + Math.floor(Math.random() * 400);
process.env.PORT = String(BACK); process.env.MONGODB_URI = 'mongodb://fake/app'; process.env.ADMIN_KEY = 'iconsz-test-admin-key-123456'; process.env.NODE_ENV = 'development';
process.env.POTATO_SECRETS_DIR = fs.mkdtempSync(path.join(require('os').tmpdir(), 'sa-isz-'));
const realLog = console.log, serverErrors = [];
console.log = () => {}; console.warn = () => {}; console.error = (...a) => { serverErrors.push(a.map(x => (x && x.message) || String(x)).join(' ').slice(0, 300)); };
require(path.join(__dirname, 'server.js'));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; realLog('  ok   - ' + m); } else { fail++; realLog('  FAIL - ' + m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const base = 'http://127.0.0.1:' + BACK;
const J = async (m, p, b, tok, adm) => { const r = await fetch(base + p, { method: m, headers: Object.assign({ 'content-type': 'application/json' }, tok ? { authorization: 'Bearer ' + tok } : {}, adm ? { authorization: 'Bearer iconsz-test-admin-key-123456' } : {}), body: b ? JSON.stringify(b) : undefined }); let j = null; try { j = await r.json(); } catch (_) {} return { s: r.status, j }; };
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
  for (let i = 0; i < 60; i++) { try { const hh = await fetch(base + '/health'); if (hh.ok) break; } catch (_) {} await sleep(250); }
  const up = async (o) => J('POST', '/admin/settings/update', { settings: o }, null, true);
  const d0 = (await J('GET', '/public/settings')).j.settings;
  ok(d0.navIconSize === 26 && d0.homeIconSize === 34 && d0.meIconSize === 36, 'untouched sizes are 26 / 34 / 36 px (smaller than the old 34 / 44 / 46)');
  let r = await up({ navIconSize: 22, homeIconSize: 30, meIconSize: 32 });
  const d1 = (await J('GET', '/public/settings')).j.settings;
  ok(r.s === 200 && d1.navIconSize === 22 && d1.homeIconSize === 30 && d1.meIconSize === 32, 'the owner can save 22 / 30 / 32 and members receive them');
  for (const bad of [{ navIconSize: 13 }, { navIconSize: 49 }, { homeIconSize: 19 }, { homeIconSize: 65 }, { meIconSize: 19 }, { meIconSize: 65 }, { meIconSize: 'big' }, { navIconSize: -5 }]) {
    r = await up(bad); ok(r.s === 400, 'refused: ' + JSON.stringify(bad));
  }
  const d2 = (await J('GET', '/public/settings')).j.settings;
  ok(d2.navIconSize === 22 && d2.homeIconSize === 30 && d2.meIconSize === 32, 'a refused value changes nothing');
  ok(d2.comingSoonBlur === 2, 'the COMING SOON blur is 2 px until the owner sets it');
  r = await up({ comingSoonBlur: 6 }); const d4 = (await J('GET', '/public/settings')).j.settings;
  ok(r.s === 200 && d4.comingSoonBlur === 6, 'the owner can save a blur of 6 and members receive it');
  for (const bad of [{ comingSoonBlur: 13 }, { comingSoonBlur: -1 }, { comingSoonBlur: 'lots' }]) { r = await up(bad); ok(r.s === 400, 'refused: ' + JSON.stringify(bad)); }
  r = await up({ comingSoonBlur: 0 }); ok(r.s === 200 && (await J('GET', '/public/settings')).j.settings.comingSoonBlur === 0, '0 (sharp) is allowed');
  await up({ comingSoonBlur: 2 });
  r = await J('POST', '/admin/settings/update', { settings: { navIconSize: 20 } });
  ok(r.s === 401, 'without the admin key nothing is saved');

  const src = read('admin-src/index.html'), css = read('user-src/index.html');
  ok(/id="navSzInput"[^>]*min="14"[^>]*max="48"/.test(src) && /id="homeSzInput"[^>]*min="20"[^>]*max="64"/.test(src) && /id="meSzInput"[^>]*min="20"[^>]*max="64"/.test(src), 'the Settings tab has Navigation, Home and Me size boxes');
  ok(/\.tab \.ti img\{width:var\(--nav-ic/.test(css) && /\.act-ic\{width:var\(--home-ic/.test(css) && /\.menu-tile-ic\.pic img\{width:var\(--me-ic/.test(css), 'the three kinds of icon take their size from the owner\'s numbers');
  ok(/id="soonBlurInput"[^>]*min="0"[^>]*max="12"/.test(src) && /comingSoonBlur: sz\('soonBlurInput', 0, 12, 2\)/.test(src), 'the Settings tab has the Coming soon blur box (0 to 12) and Save sends it');
  ok(/blur\(var\(--soon-blur,2px\)\)/.test(css), 'the blur behind the COMING SOON plate reads the owner\'s value');
  const { chromium } = require('playwright'); const browser = await chromium.launch();
  const sent = [];
  const settings = { brandName: 'Smart AI', minDeposit: 5000, minWithdraw: 5000, welcomeBonus: 7000, commL1: 27, commL2: 2, commL3: 1, withdrawFeePct: 15, maxWithdrawalsPerDay: 2, dailyCheckin: 250, depositMethodNames: 'Pay-B, Pay-A, Pay-D, Pay-C', navIconSize: 20, homeIconSize: 28, meIconSize: 30 };
  const adm1 = staticServer(path.join(__dirname, 'admin'), false); await new Promise(r => adm1.listen(0, r));
  const ctx2 = await browser.newContext({ viewport: { width: 400, height: 900 }, serviceWorkers: 'block' });
  const ap = await ctx2.newPage(); const aerrs = [];
  ap.on('pageerror', e => aerrs.push(e.message));
  await ap.route('**/k7x2/**', route => { const rq = route.request(), p = new URL(rq.url()).pathname.replace(/^\/k7x2/, ''); let body = {}; try { body = JSON.parse(rq.postData() || '{}'); } catch (_) {}
    let out = { status: 'success', message: 'ok', stats: {}, products: [], users: [], transactions: [], deposits: [], withdrawals: [] };
    if (p === '/admin/check-key' || p === '/admin/login') out = { status: 'success', token: 'tok', username: 'owner', role: 'owner' };
    if (p === '/admin/settings') out = { status: 'success', settings };
    if (p === '/admin/settings/update') sent.push(body.settings);
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(out) }); });
  await ap.goto('http://127.0.0.1:' + adm1.address().port + '/'); await sleep(500);
  await ap.fill('#keyInput', 'k'); await ap.click('#loginBtn'); await sleep(900);
  await ap.click('[data-tab="settings"]');
  await ap.waitForSelector('#navSzInput', { timeout: 8000 });
  ok(await ap.inputValue('#navSzInput') === '20' && await ap.inputValue('#homeSzInput') === '28' && await ap.inputValue('#meSzInput') === '30', 'the boxes show what is saved (20, 28, 30)');
  await ap.fill('#navSzInput', '99'); await ap.fill('#homeSzInput', '2'); await ap.fill('#meSzInput', '');
  await ap.click('#saveDepMethod'); await sleep(500);
  const last = sent[sent.length - 1] || {};
  ok(last.navIconSize === 48 && last.homeIconSize === 20 && last.meIconSize === 36, 'Save holds sizes to their limits and an empty box means the standard size (' + [last.navIconSize, last.homeIconSize, last.meIconSize] + ')');
  ok(aerrs.length === 0, 'the admin panel raised no errors' + (aerrs.length ? ': ' + aerrs.join(' | ') : ''));
  adm1.close(); await ctx2.close();

  const front = staticServer(path.join(__dirname, 'user'), true); await new Promise(r => front.listen(FRONT, '127.0.0.1', r));
  const phone = '0771234567', su = await J('POST', '/auth/signup', { phone, password: 'secret12' });
  await J('POST', '/register', { pin: '123456', referralCode: '' }, su.j.token);
  const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
  await ctx.addInitScript(() => { window._smartaiLoaderMinMs = 0; });
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(String(e.message || e).slice(0, 200)));
  const until = async (fn, arg, ms) => { try { await p.waitForFunction(fn, arg, { timeout: ms || 8000 }); return true; } catch (_) { return false; } };
  await p.goto('http://127.0.0.1:' + FRONT + '/', { waitUntil: 'domcontentloaded' });
  await until(() => document.getElementById('authScreen').style.display === 'flex');
  await p.fill('#fPhone', phone.replace(/^0/, '')); await p.fill('#fPass', 'secret12'); await p.click('#authGo');
  ok(await until(() => document.getElementById('app').style.display === 'block', null, 15000), 'a member signs in');
  await p.evaluate(() => { try { dismissAnnouncement(); } catch (e) {} try { dismissInstallSheet(); } catch (e) {} try { stopAccountPoll(); } catch (e) {} });
  await p.evaluate(() => syncPublicConfig());
  const size = sel => p.evaluate(s => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; }, sel);
  const want = (a, n) => a && a[0] === n && a[1] === n;
  ok(await until(() => getComputedStyle(document.documentElement).getPropertyValue('--nav-ic').trim() === '22px', null, 8000), 'the app takes the owner\'s numbers (navigation 22 px)');
  ok(want(await size('.tab[data-tab="shop"] .ti img'), 22), 'a navigation icon is 22 px');
  ok(want(await size('.act-ic'), 30), 'a Home icon box is 30 px');
  await p.evaluate(() => switchTab('account')); await sleep(400);
  ok(want(await size('.menu-tile-ic.pic img'), 32), 'a Me tile icon is 32 px');
  const tile1 = await size('.menu-tile');
  await up({ navIconSize: 16, homeIconSize: 22, meIconSize: 24 });
  await p.evaluate(() => syncPublicConfig()); await sleep(300);
  ok(want(await size('.tab[data-tab="shop"] .ti img'), 16) && want(await size('.menu-tile-ic.pic img'), 24), 'smaller numbers shrink them at once (16 and 24)');
  const tile2 = await size('.menu-tile');
  ok(tile2[1] < tile1[1], 'and the tile around each Me icon gets smaller too (' + tile1[1] + ' to ' + tile2[1] + ' px tall)');
  await p.evaluate(() => switchTab('home')); await sleep(300);
  ok(want(await size('.act-ic'), 22), 'the Home icon box is 22 px');
  const navH = await size('.tabbar');
  ok(navH && navH[1] < 80, 'the bottom bar is slim (' + (navH && navH[1]) + ' px tall)');
  const shot = path.join(process.env.SHOT_DIR || require('os').tmpdir(), 'icon-sizes-home.png');
  await up({ navIconSize: 26, homeIconSize: 34, meIconSize: 36 }); await p.evaluate(() => syncPublicConfig()); await sleep(300);
  await p.screenshot({ path: shot });
  await p.evaluate(() => switchTab('account')); await sleep(400);
  await p.screenshot({ path: path.join(process.env.SHOT_DIR || require('os').tmpdir(), 'icon-sizes-me.png') });
  ok(errs.length === 0, 'the member app raised no errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  ok(serverErrors.length === 0, 'no server errors' + (serverErrors.length ? ': ' + serverErrors.slice(0, 2).join(' | ') : ''));
  await browser.close(); front.close();
  realLog('\n' + (fail ? 'FAIL' : 'PASS') + ': icon sizes (' + pass + ' ok, ' + fail + ' failed)');
  process.exit(fail ? 1 : 0);
})().catch(e => { realLog('CRASH ' + (e && e.stack || e)); process.exit(1); });
