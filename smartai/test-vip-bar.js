'use strict';
// The VIP bar under the number card on Me (VIP 0 = empty, filled to the member's level, a segment per level) and the dot loader that shows while the payment page opens.
//   node test-vip-bar.js
const path = require('path'), Module = require('module'), http = require('http'), fs = require('fs'), zlib = require('zlib');
process.chdir(__dirname);
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...a) { return req === 'mongodb' ? path.join(__dirname, 'test-helpers', 'fake-mongodb.js') : origResolve.call(this, req, ...a); };
const BACK = 4100 + Math.floor(Math.random() * 400), FRONT = 4600 + Math.floor(Math.random() * 400);
process.env.PORT = String(BACK); process.env.MONGODB_URI = 'mongodb://fake/app'; process.env.ADMIN_KEY = 'vipbar-test-admin-key-123456'; process.env.NODE_ENV = 'development';
process.env.POTATO_SECRETS_DIR = fs.mkdtempSync(path.join(require('os').tmpdir(), 'sa-vip-'));
const realLog = console.log, serverErrors = [];
console.log = () => {}; console.warn = () => {}; console.error = (...a) => { serverErrors.push(a.map(x => (x && x.message) || String(x)).join(' ').slice(0, 300)); };
require(path.join(__dirname, 'server.js'));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; realLog('  ok   - ' + m); } else { fail++; realLog('  FAIL - ' + m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const base = 'http://127.0.0.1:' + BACK;
const J = async (m, p, b, tok, adm) => { const r = await fetch(base + p, { method: m, headers: Object.assign({ 'content-type': 'application/json' }, tok ? { authorization: 'Bearer ' + tok } : {}, adm ? { authorization: 'Bearer vipbar-test-admin-key-123456' } : {}), body: b ? JSON.stringify(b) : undefined }); let j = null; try { j = await r.json(); } catch (_) {} return { s: r.status, j }; };
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
  const { chromium } = require('playwright'); const browser = await chromium.launch();
  const front = staticServer(path.join(__dirname, 'user'), true); await new Promise(r => front.listen(FRONT, '127.0.0.1', r));
  const phone = '0771234567', su = await J('POST', '/auth/signup', { phone, password: 'secret12' });
  await J('POST', '/register', { pin: '123456', referralCode: '' }, su.j.token);
  await J('POST', '/admin/settings/update', { settings: { welcomeBonus: 500000 } }, null, true);
  await J('POST', '/admin/products/number-vips', {}, null, true);
  await J('POST', '/admin/pay-channels/save', { network: 'MTN', accountName: 'Test Co', accountNumber: '0771111111' }, null, true);
  const prods = (await J('GET', '/public/products')).j.products.filter(p => !p.deleted && p.price > 0).sort((a, b) => a.vip - b.vip);
  const maxVip = Math.max(...prods.map(p => p.vip));
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
  const bar = () => p.evaluate(() => { const b = document.getElementById('vipBar'), t = document.getElementById('vipTrack'), f = document.getElementById('vipFill'); return { shown: getComputedStyle(b).display !== 'none', badge: document.getElementById('vipBadge').textContent, w: f.getBoundingClientRect().width, tw: t.getBoundingClientRect().width, now: t.getAttribute('aria-valuenow'), max: t.getAttribute('aria-valuemax'), top: b.getBoundingClientRect().top, bottom: b.getBoundingClientRect().bottom, numBottom: document.getElementById('acctPhone').getBoundingClientRect().bottom, cardBottom: document.querySelector('.acct-card').getBoundingClientRect().bottom, statTop: document.querySelector('#viewAccount .cards').getBoundingClientRect().top, h: b.getBoundingClientRect().height, cardH: document.querySelector('.acct-card').getBoundingClientRect().height, cardH0: 78 }; });
  await p.evaluate(() => { switchTab('account'); }); await p.waitForTimeout(1500);
  let b0 = await bar();
  ok(b0.shown && b0.badge === 'VIP 0' && b0.w < 1 && b0.now === '0' && Number(b0.max) === maxVip, 'nothing bought: it says VIP 0 and the bar is empty (' + JSON.stringify([b0.badge, b0.w, b0.max]) + ')');
  ok(b0.top >= b0.numBottom - 1 && b0.bottom <= b0.cardBottom && Math.round(b0.cardH) === Math.round(b0.cardH0), 'the bar is inside the number card, under the number, and the card keeps its size (' + Math.round(b0.cardH) + ' px)');
  await p.screenshot({ path: path.join(require('os').tmpdir(), 'vip-0.png') });
  // buy a robot of VIP 2 (the wallet has the welcome gift): the bar fills to 2 of N
  const two = prods.find(x => x.vip === 2) || prods[1];
  await J('POST', '/admin/deposit', { userId: su.j.uid, amount: 3000000, note: 'test' }, null, true);
  const buy = await J('POST', '/invest/create', { tierKey: two.key }, su.j.token); ok(buy.j.status === 'success', 'the member buys a VIP 2 robot', buy.j);
  await p.evaluate(async () => { await refreshFromServer(); renderAll(); }); await p.waitForTimeout(1300);
  const b2 = await bar();
  ok(b2.badge === 'VIP 2' && b2.now === '2' && Math.abs(b2.w / b2.tw - 2 / maxVip) < 0.03, 'after a VIP 2 robot it says VIP 2 and the bar is two of ' + maxVip + ' (' + (b2.w / b2.tw).toFixed(3) + ')');
  await p.screenshot({ path: path.join(require('os').tmpdir(), 'vip-2.png') });
  const top = prods[prods.length - 1];
  await J('POST', '/invest/create', { tierKey: top.key }, su.j.token);
  await p.evaluate(async () => { await refreshFromServer(); renderAll(); }); await p.waitForTimeout(1300);
  const bt = await bar();
  ok(bt.badge === 'VIP ' + maxVip && bt.w / bt.tw > 0.98, 'at the top level the bar is full');
  // the dot loader while the payment page opens
  await p.evaluate(() => { window._smartaiNavMs = 450; openOverlay('deposit'); }); await p.waitForTimeout(700);
  await p.evaluate(() => { window._smartaiNavMs = 450; document.getElementById('depAmt').value = '30000'; });
  await p.evaluate(() => { window.__seen = []; const v = document.getElementById('navVeil'); window.__obs = setInterval(() => { window.__seen.push([v.classList.contains('on'), document.getElementById('ovGpPick').classList.contains('show')]); }, 30); continueDeposit(); });
  await p.waitForTimeout(1600);
  const seen = await p.evaluate(() => { clearInterval(window.__obs); return window.__seen; });
  const firstOn = seen.findIndex(x => x[0]), pageAt = seen.findIndex(x => x[1]), lastOn = seen.map(x => x[0]).lastIndexOf(true);
  ok(firstOn >= 0 && firstOn <= (pageAt < 0 ? 99 : pageAt) && pageAt >= 0 && lastOn >= pageAt, 'tapping Continue shows the dots first, the payment page opens under them, then they lift (dots at sample ' + firstOn + ', page at ' + pageAt + ', dots gone after ' + lastOn + ')');
  ok(await p.evaluate(() => document.getElementById('ovGpPick').classList.contains('show') && !document.getElementById('navVeil').classList.contains('on')), 'afterwards the member sees the payment page to choose the network and number');
  ok(await p.evaluate(() => document.getElementById('gpM_Airtel').dataset.off === '1' && document.getElementById('gpM_MTN').dataset.off !== '1'), 'the networks with no number are still greyed');
  await p.evaluate(() => { gpLeave(); closeOverlay(); });
  ok(errs.length === 0, 'no script error' + (errs.length ? ': ' + errs.join(' | ') : ''));
  ok(serverErrors.length === 0, 'the server logged no error' + (serverErrors.length ? ': ' + serverErrors.slice(0, 3).join(' | ') : ''));
  await browser.close(); front.close();
  realLog(fail ? `FAIL: ${fail} failed` : `PASS: VIP bar and payment-page loader (${pass} checks)`);
  process.exit(fail ? 1 : 0);
})().catch(e => { realLog('FAIL:', e.stack || e.message); process.exit(1); });
