'use strict';
// Admin "Payment Numbers" tab on the BUILT panel, driven like a person: sign in, add a payment number,
// upload a logo that has a WHITE BACKGROUND with white detail inside it, and read the exact bytes the
// panel sends to the server. The background around the logo must be cleared (transparent), the logo
// itself must stay whole, and the picture must be small enough for the server to accept.
const { chromium } = require('playwright'); const http = require('http'), fs = require('fs'), path = require('path');
const assert = require('node:assert/strict');
let checks = 0; const ok = (c, m) => { checks++; assert.ok(c, m); };
const ROOT = path.join(__dirname, 'admin');
const SERVER = (fs.readFileSync(path.join(__dirname, 'admin-src/index.html'), 'utf8').match(/const SERVER = '([^']+)'/) || [])[1];
ok(SERVER, 'panel API origin found');
const store = [];          // what the stubbed server holds
const saved = [];          // every save body the panel sent
const srv = http.createServer((q, r) => {
  let f = path.join(ROOT, q.url.split('?')[0]); if (f.endsWith('/')) f += 'index.html';
  fs.readFile(f, (e, d) => { if (e) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', f.endsWith('.html') ? 'text/html' : f.endsWith('.js') ? 'text/javascript' : 'application/octet-stream'); r.end(d); });
}).listen(8866, async () => {
  let failed = null;
  const b = await chromium.launch();
  try {
    const page = await (await b.newContext({ viewport: { width: 420, height: 900 }, serviceWorkers: 'block' })).newPage();
    const errs = []; page.on('pageerror', e => errs.push(String(e)));
    await page.route('**' + SERVER + '/**', async route => {
      const u = new URL(route.request().url()); const p = u.pathname.replace(SERVER, '');
      const body = route.request().postData() ? JSON.parse(route.request().postData()) : {};
      const send = o => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
      if (p === '/admin/check-key') return send({ status: 'success', token: 'tok', username: 'owner', role: 'owner' });
      if (p === '/admin/pay-channels/list') return send({ status: 'success', channels: store });
      if (p === '/admin/pay-channels/save') {
        saved.push(body);
        const at = body.id ? store.findIndex(c => c.id === body.id) : -1;
        if (at >= 0) { store[at] = { ...store[at], ...body }; return send({ status: 'success', id: body.id }); }
        store.push({ id: 'c' + (store.length + 1), ...body, active: body.active !== false }); return send({ status: 'success', id: 'c' + store.length });
      }
      if (p === '/admin/pay-channels/delete') { const i = store.findIndex(c => c.id === body.id); if (i >= 0) store.splice(i, 1); return send({ status: 'success' }); }
      return send({ status: 'success', settings: {}, deposits: [], users: [], counts: {}, pendingWithdrawals: 0 });
    });
    await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await page.goto('http://127.0.0.1:8866/index.html', { waitUntil: 'load' });
    await page.fill('#keyInput', 'secret'); await page.click('#loginBtn');
    await page.waitForSelector('#payNumbersTab:not(.hidden)', { timeout: 8000 });
    ok(true, 'the owner sees the Payment Numbers tab');
    await page.click('#payNumbersTab'); await page.waitForSelector('#pcAdd');
    ok((await page.textContent('#content')).includes('No payment numbers yet'), 'empty state is explained');
    await page.click('#pcAdd');
    await page.fill('#pcName', 'Commercial Bank of Ethiopia'); await page.selectOption('#pcKind', 'bank');
    await page.fill('#pcAccName', 'Ashenafi'); await page.fill('#pcAccNo', '1000809418239');
    // A logo drawn in the page: a white 400x300 canvas, a blue disc, a WHITE ring inside the disc.
    const dataUrl = await page.evaluate(() => {
      const c = document.createElement('canvas'); c.width = 400; c.height = 300; const x = c.getContext('2d');
      x.fillStyle = '#fff'; x.fillRect(0, 0, 400, 300);
      x.fillStyle = '#1d4ea1'; x.beginPath(); x.arc(200, 150, 100, 0, 7); x.fill();
      x.strokeStyle = '#fff'; x.lineWidth = 14; x.beginPath(); x.arc(200, 150, 45, 0, 7); x.stroke();
      return c.toDataURL('image/png');
    });
    const tmp = path.join(require('os').tmpdir(), 'pay-logo-test.png'); fs.writeFileSync(tmp, Buffer.from(dataUrl.split(',')[1], 'base64'));
    await page.setInputFiles('#pcLogoFile', tmp);
    await page.waitForFunction(() => /Logo ready/.test(document.getElementById('content').textContent), null, { timeout: 8000 });
    ok(await page.inputValue('#pcName') === 'Commercial Bank of Ethiopia' && await page.inputValue('#pcAccNo') === '1000809418239', 'what was typed survives choosing a logo');
    await page.click('#pcSave'); await page.waitForSelector('[data-pcid]');
    eqSaved(); 
    function eqSaved() {
      ok(saved.length === 1, 'one save request');
      const s = saved[0];
      ok(s.name === 'Commercial Bank of Ethiopia' && s.kind === 'bank' && s.accountName === 'Ashenafi' && s.accountNumber === '1000809418239' && s.active === true, 'the typed fields are sent');
      ok(/^data:image\/png;base64,/.test(s.logo), 'the logo is sent as a PNG');
      ok(s.logo.length < 220 * 1024, 'and is small enough for the server (' + s.logo.length + ' characters)');
    }
    // read the pixels of what was sent
    const px = await page.evaluate(async src => {
      const img = new Image(); await new Promise(r => { img.onload = r; img.src = src; });
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0);
      const at = (fx, fy) => Array.from(x.getImageData(Math.min(img.width - 1, Math.floor(img.width * fx)), Math.min(img.height - 1, Math.floor(img.height * fy)), 1, 1).data);
      return { w: img.width, h: img.height, corner: at(0.01, 0.01), centreRing: at(0.5, 0.5 - 45 / 200 / 2 * 0.0 ), disc: at(0.5, 0.12), maxSide: Math.max(img.width, img.height) };
    }, saved[0].logo);
    ok(px.maxSide <= 256, 'the logo is scaled to at most 256 pixels (' + px.w + 'x' + px.h + ')');
    ok(px.corner[3] === 0, 'the white background at the corner is gone (transparent)');
    ok(px.disc[3] === 255 && px.disc[2] > 120 && px.disc[0] < 90, 'the logo itself is untouched (blue disc stays)');
    ok(Math.abs(px.w - px.h) <= 2, 'cropped tight: the disc fills the picture (' + px.w + 'x' + px.h + ')');
    // edit without touching the logo -> no logo field sent (server keeps it)
    await page.click('[data-pc-edit]'); await page.waitForSelector('#pcName');
    await page.fill('#pcAccNo', '1000809418240'); await page.click('#pcSave'); await page.waitForSelector('[data-pcid]');
    ok(saved.length === 2 && !('logo' in saved[1]), 'editing without a new logo does not resend the logo');
    // delete
    page.once('dialog', d => d.accept());
    await page.click('[data-pc-del]'); await page.waitForSelector('text=No payment numbers yet');
    ok(store.length === 0, 'delete removes it');
    ok(errs.length === 0, 'no page errors: ' + errs.join(' | '));
    console.log('PASS: admin Payment Numbers tab, logo background removal (' + checks + ' checks)');
  } catch (e) { failed = e; }
  await b.close(); srv.close();
  if (failed) { console.error(failed); process.exitCode = 1; }
});
