'use strict';
// The owner can set how solid (opacity 0-100) and how soft (blur 0-40) the picture behind the Me page is, end to end:
//   1. the server keeps 100 / 0 by default, accepts the owner's values, refuses anything outside the range, and members get the values from /public/settings;
//   2. the admin Settings tab has the two boxes and sends them when saved;
//   3. a real phone-sized browser: the Me page picture really is that see-through and that soft; with the defaults it is left exactly as uploaded.
//   node test-me-banner-look.js
const path = require('path'), Module = require('module'), http = require('http'), fs = require('fs'), zlib = require('zlib');
process.chdir(__dirname);
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...a) { return req === 'mongodb' ? path.join(__dirname, 'test-helpers', 'fake-mongodb.js') : origResolve.call(this, req, ...a); };
const BACK = 4100 + Math.floor(Math.random() * 400), FRONT = 4600 + Math.floor(Math.random() * 400);
process.env.PORT = String(BACK); process.env.MONGODB_URI = 'mongodb://fake/app'; process.env.ADMIN_KEY = 'mebanner-test-admin-key-123456'; process.env.NODE_ENV = 'development';
process.env.POTATO_SECRETS_DIR = fs.mkdtempSync(path.join(require('os').tmpdir(), 'sa-meb-'));
const realLog = console.log, serverErrors = [];
console.log = () => {}; console.warn = () => {}; console.error = (...a) => { serverErrors.push(a.map(x => (x && x.message) || String(x)).join(' ').slice(0, 300)); };
require(path.join(__dirname, 'server.js'));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; realLog('  ok   - ' + m); } else { fail++; realLog('  FAIL - ' + m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const base = 'http://127.0.0.1:' + BACK;
const J = async (m, p, b, tok, adm) => { const r = await fetch(base + p, { method: m, headers: Object.assign({ 'content-type': 'application/json' }, tok ? { authorization: 'Bearer ' + tok } : {}, adm ? { authorization: 'Bearer mebanner-test-admin-key-123456' } : {}), body: b ? JSON.stringify(b) : undefined }); let j = null; try { j = await r.json(); } catch (_) {} return { s: r.status, j }; };
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
  // ---- 1. the server
  const d0 = await J('GET', '/public/settings');
  ok(d0.j.settings.myBannerOpacity === 100 && d0.j.settings.myBannerBlur === 0, 'untouched, the picture is fully solid and sharp (100 / 0)');
  const up = async (o) => J('POST', '/admin/settings/update', { settings: o }, null, true);
  let r = await up({ myBannerOpacity: 55, myBannerBlur: 8 });
  ok(r.s === 200, 'the owner can save opacity 55 and blur 8');
  const d1 = await J('GET', '/public/settings');
  ok(d1.j.settings.myBannerOpacity === 55 && d1.j.settings.myBannerBlur === 8, 'members receive the saved values');
  for (const bad of [{ myBannerOpacity: 101 }, { myBannerOpacity: -1 }, { myBannerBlur: 41 }, { myBannerBlur: -3 }, { myBannerOpacity: 'abc' }, { myBannerBlur: 'x' }]) {
    r = await up(bad); ok(r.s === 400, 'refused: ' + JSON.stringify(bad));
  }
  const d2 = await J('GET', '/public/settings');
  ok(d2.j.settings.myBannerOpacity === 55 && d2.j.settings.myBannerBlur === 8, 'a refused value changes nothing');
  r = await up({ myBannerOpacity: 12.6, myBannerBlur: 3.4 });
  const d3 = await J('GET', '/public/settings');
  ok(d3.j.settings.myBannerOpacity === 13 && d3.j.settings.myBannerBlur === 3, 'fractions are rounded to whole numbers');
  r = await J('POST', '/admin/settings/update', { settings: { myBannerOpacity: 10 } });
  ok(r.s === 401, 'without the admin key nothing is saved');

  // ---- 2. the admin panel
  const src = read('admin-src/index.html');
  ok(/id="myOpInput"[^>]*min="0"[^>]*max="100"/.test(src) && /id="myBlurInput"[^>]*min="0"[^>]*max="40"/.test(src), 'the Settings tab has an Opacity box (0 to 100) and a Blur box (0 to 40)');
  ok(/myBannerOpacity:[\s\S]{0,160}myOpInput/.test(src) && /myBannerBlur:[\s\S]{0,160}myBlurInput/.test(src), 'Save sends both values');
  const { chromium } = require('playwright'); const browser = await chromium.launch();
  const sent = [];
  const settings = { brandName: 'Smart AI', minDeposit: 5000, minWithdraw: 5000, welcomeBonus: 7000, commL1: 27, commL2: 2, commL3: 1, withdrawFeePct: 15, maxWithdrawalsPerDay: 2, dailyCheckin: 250, depositMethodNames: 'Pay-B, Pay-A, Pay-D, Pay-C', myBannerOpacity: 40, myBannerBlur: 12 };
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
  await ap.waitForSelector('#myOpInput', { timeout: 8000 });
  ok(await ap.inputValue('#myOpInput') === '40' && await ap.inputValue('#myBlurInput') === '12', 'the boxes show what is saved (40 and 12)');
  await ap.fill('#myOpInput', '70'); await ap.fill('#myBlurInput', '99');
  await ap.click('#saveDepMethod'); await sleep(500);
  const last = sent[sent.length - 1] || {};
  ok(last.myBannerOpacity === 70 && last.myBannerBlur === 40, 'Save sends opacity 70 and blur held to the 40 limit (' + last.myBannerOpacity + ' / ' + last.myBannerBlur + ')');
  await ap.fill('#myOpInput', ''); await ap.click('#saveDepMethod'); await sleep(500);
  ok((sent[sent.length - 1] || {}).myBannerOpacity === 100, 'an empty Opacity box means fully solid (100), never invisible');
  ok(aerrs.length === 0, 'the admin panel raised no errors' + (aerrs.length ? ': ' + aerrs.join(' | ') : ''));
  adm1.close(); await ctx2.close();

  // ---- 3. the member app
  await J('POST', '/admin/smartai-image/set', { slot: 'mybanner', image: pic }, null, true);
  await up({ myBannerOpacity: 100, myBannerBlur: 0 });
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
  await p.evaluate(() => _artPromise);
  await p.evaluate(() => switchTab('account')); await sleep(500);   // on the Me page itself, so the picture has a size
  const look = () => p.evaluate(() => { const i = document.querySelector('#accountBanner img.art-photo'); if (!i) return null; const c = getComputedStyle(i); return { op: c.opacity, filter: c.filter, tf: c.transform }; });
  let l = await look();
  ok(l && l.op === '1' && (l.filter === 'none' || l.filter === '') && (l.tf === 'none' || l.tf === ''), 'with the defaults the Me picture is exactly as uploaded (opacity 1, no blur, no zoom)');
  // the owner changes it; the app picks it up the next time it reads the settings
  await up({ myBannerOpacity: 40, myBannerBlur: 10 });
  await p.evaluate(() => syncPublicConfig()).catch(() => {});
  ok(await until(() => { const i = document.querySelector('#accountBanner img.art-photo'); return !!i && getComputedStyle(i).opacity === '0.4'; }, null, 8000), 'after the owner saves 40, the Me picture is 40 percent solid');
  await until(() => getComputedStyle(document.querySelector('#accountBanner img.art-photo')).transform !== 'none', null, 4000);
  l = await look();
  ok(l && /blur\(10px\)/.test(l.filter), 'and blurred by 10 px (' + (l && l.filter) + ')');
  ok(l && /^matrix\(1\.1/.test(l.tf), 'with a small zoom so the blur leaves no soft edge (' + JSON.stringify(l) + ')');
  const shot = path.join(process.env.SHOT_DIR || require('os').tmpdir(), 'me-banner-look.png');
  await p.screenshot({ path: shot });
  await up({ myBannerOpacity: 0, myBannerBlur: 0 });
  await p.evaluate(() => syncPublicConfig()).catch(() => {});
  ok(await until(() => { const i = document.querySelector('#accountBanner img.art-photo'); return !!i && getComputedStyle(i).opacity === '0'; }, null, 8000), 'opacity 0 hides the picture so only the blue shows');
  ok(await p.evaluate(() => !!document.querySelector('#accountBanner .art-fill')), 'and the blue art underneath is still there');
  ok(errs.length === 0, 'the member app raised no errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  ok(serverErrors.length === 0, 'no server errors' + (serverErrors.length ? ': ' + serverErrors.slice(0, 2).join(' | ') : ''));
  await browser.close(); front.close();
  realLog('screenshot: ' + shot);
  realLog('\n' + (fail ? 'FAIL' : 'PASS') + ': Me page picture look (' + pass + ' ok, ' + fail + ' failed)');
  process.exit(fail ? 1 : 0);
})().catch(e => { realLog('CRASH ' + (e && e.stack || e)); process.exit(1); });
