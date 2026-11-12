'use strict';
// Admin "Wave payments" tab on the BUILT panel, driven like a person: sign in, add a Wave payment (link + QR picture),
// and read the exact bytes the panel sends to the server. Wave is the only payment type: no bank/wallet type,
// no account name or number, no logo upload.
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
      const u = new URL(route.request().url()); const p = u.pathname.slice(SERVER.length);
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
    ok(/Wave payments/.test(await page.textContent('#payNumbersTab')), 'the owner sees the Wave payments tab');
    await page.click('#payNumbersTab'); await page.waitForSelector('#pcAdd');
    const first = await page.textContent('#content');
    ok(first.includes('No Wave payment yet'), 'empty state is explained');
    await page.click('#pcAdd');
    // the form is Wave only: a link, a QR picture, an order and a switch -- no type, no account name or number, no logo upload
    for (const gone of ['#pcKind', '#pcName', '#pcAccName', '#pcAccNo', '#pcLogoFile']) ok(!(await page.$(gone)), 'the old field ' + gone + ' is gone');
    const form = await page.textContent('#content');
    ok(!/Telebirr|Commercial Bank|Ethiopia|Upload logo|Account number|Account name/i.test(form), 'no Ethiopian payment wording in the form');
    ok(/Payment link/.test(form) && /Upload QR picture/.test(form), 'the form asks for the Wave link and QR picture');
    // a link that is not on wave.com is refused by the panel itself (and by the server)
    for (const evil of ['https://evil.com/pay', 'http://pay.wave.com/m/x', 'https://pay.wave.com@evil.com/m/x']) {
      await page.fill('#pcLink', evil); await page.click('#pcSave'); await page.waitForTimeout(150);
      ok(saved.length === 0 && await page.$('#pcSave'), 'not saved: ' + evil);
    }
    await page.fill('#pcLink', 'https://pay.wave.com/m/test/');
    const qr = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const tmp = path.join(require('os').tmpdir(), 'wave-qr-test.png'); fs.writeFileSync(tmp, Buffer.from(qr.split(',')[1], 'base64'));
    await page.setInputFiles('#pcQrFile', tmp);
    await page.waitForFunction(() => /QR picture ready/.test(document.getElementById('content').textContent), null, { timeout: 8000 });
    ok(await page.inputValue('#pcLink') === 'https://pay.wave.com/m/test/', 'what was typed survives choosing the QR picture');
    await page.click('#pcSave'); await page.waitForSelector('[data-pcid]');
    ok(saved.length === 1, 'one save request');
    ok(saved[0].payLink === 'https://pay.wave.com/m/test/' && saved[0].qrImage === qr && saved[0].active === true, 'the link and QR picture are sent');
    ok(!('kind' in saved[0]) && !('logo' in saved[0]) && !('accountNumber' in saved[0]), 'no type, logo or account number is sent');
    ok((await page.textContent('#content')).includes('Wave'), 'the saved entry is listed');
    // edit the link only -> the QR is not resent (the server keeps it)
    await page.click('[data-pc-edit]'); await page.waitForSelector('#pcLink');
    await page.fill('#pcLink', 'https://pay.wave.com/m/other/'); await page.click('#pcSave'); await page.waitForSelector('[data-pcid]');
    ok(saved.length === 2 && saved[1].payLink === 'https://pay.wave.com/m/other/' && !('qrImage' in saved[1]), 'editing without a new QR picture does not resend it');
    // the poster Wave gives is over 1 MB: it is shrunk by the panel instead of being refused
    const bigUrl = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 1057; c.height = 1488; const x = c.getContext('2d'); const im = x.createImageData(1057, 1488);
      for (let i = 0; i < im.data.length; i += 4) { im.data[i] = (Math.random() * 256) | 0; im.data[i + 1] = (Math.random() * 256) | 0; im.data[i + 2] = (Math.random() * 256) | 0; im.data[i + 3] = 255; }
      x.putImageData(im, 0, 0); return c.toDataURL('image/png'); });
    const bigFile = path.join(require('os').tmpdir(), 'wave-big-test.png'); fs.writeFileSync(bigFile, Buffer.from(bigUrl.split(',')[1], 'base64'));
    ok(fs.statSync(bigFile).size > 1000 * 1024, 'the test poster is over 1 MB (' + fs.statSync(bigFile).size + ' bytes)');
    await page.click('[data-pc-edit]'); await page.waitForSelector('#pcQrFile', { state: 'attached' });
    await page.setInputFiles('#pcQrFile', bigFile);
    await page.waitForFunction(() => /QR picture ready/.test(document.getElementById('content').textContent), null, { timeout: 15000 });
    await page.click('#pcSave'); await page.waitForSelector('[data-pcid]');
    const last = saved[saved.length - 1];
    ok(/^data:image\/(png|jpeg);base64,/.test(last.qrImage) && last.qrImage.length <= 480000, 'a poster over 1 MB is shrunk to fit (' + last.qrImage.length + ' characters)');
    // delete
    page.once('dialog', d => d.accept());
    await page.click('[data-pc-del]'); await page.waitForSelector('text=No Wave payment yet');
    ok(store.length === 0, 'delete removes it');
    ok(errs.length === 0, 'no page errors: ' + errs.join(' | '));
    console.log('PASS: admin Wave payments tab (' + checks + ' checks)');
  } catch (e) { failed = e; }
  await b.close(); srv.close();
  if (failed) { console.error(failed); process.exitCode = 1; }
});
