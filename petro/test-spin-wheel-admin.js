'use strict';
// Admin "Spin wheel" card (Settings tab) on the BUILT panel, driven like a person: sign in, add a Wave payment (link + QR picture),
// and read the exact bytes the panel sends to the server. Wave is the only payment type: no bank/wallet type,
// no account name or number, no logo upload.
const { chromium } = require('playwright'); const http = require('http'), fs = require('fs'), path = require('path');
const assert = require('node:assert/strict');
let checks = 0; const ok = (c, m) => { checks++; assert.ok(c, m); };
const ROOT = path.join(__dirname, 'admin');
const SERVER = (fs.readFileSync(path.join(__dirname, 'admin-src/index.html'), 'utf8').match(/const SERVER = '([^']+)'/) || [])[1];
ok(SERVER, 'panel API origin found');
const SETTINGS = { turntableEnabled: false, brandName: 'Petro' };
const store = [];          // what the stubbed server holds
let cap413Hits = 0; const saved = [];          // every save body the panel sent
const srv = http.createServer((q, r) => {
  let f = path.join(ROOT, q.url.split('?')[0]); if (f.endsWith('/')) f += 'index.html';
  fs.readFile(f, (e, d) => { if (e) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', f.endsWith('.html') ? 'text/html' : f.endsWith('.js') ? 'text/javascript' : 'application/octet-stream'); r.end(d); });
}).listen(8866, async () => {
  let failed = null;
  const b = await chromium.launch();
  try {
    const page = await (await b.newContext({ viewport: { width: 420, height: 900 }, serviceWorkers: 'block' })).newPage();
    const errs = []; page.on('pageerror', e => errs.push(String(e)));
    await page.route(SERVER + '/**', async route => {
      const u = new URL(route.request().url()); const p = u.pathname;
      const body = route.request().postData() ? JSON.parse(route.request().postData()) : {};
      const send = o => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
      if (p === '/admin/check-key') return send({ status: 'success', token: 'tok', username: 'owner', role: 'owner' });
      if (p === '/admin/pay-channels/list') return send({ status: 'success', channels: store });
      if (p === '/admin/pay-channels/save') {
        if (globalThis.__cap413 && body.qrImage && body.qrImage.length > 200000) { cap413Hits++; return send({ status: 'error', message: 'La requête est trop volumineuse' }); }
        saved.push(body);
        const at = body.id ? store.findIndex(c => c.id === body.id) : -1;
        if (at >= 0) { store[at] = { ...store[at], ...body }; return send({ status: 'success', id: body.id }); }
        store.push({ id: 'c' + (store.length + 1), ...body, active: body.active !== false }); return send({ status: 'success', id: 'c' + store.length });
      }
      if (p === '/admin/pay-channels/delete') { const i = store.findIndex(c => c.id === body.id); if (i >= 0) store.splice(i, 1); return send({ status: 'success' }); }
      if (p === '/admin/settings') return send({ status: 'success', settings: SETTINGS });
      if (p === '/admin/settings/update') { saved.push(body); if (globalThis.__reject) return send({ status: 'error', message: 'The spin wheel needs exactly 10 sections' }); Object.assign(SETTINGS, body.settings); return send({ status: 'success' }); }
      return send({ status: 'success', settings: {}, deposits: [], users: [], counts: {}, pendingWithdrawals: 0 });
    });
    await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await page.goto('http://127.0.0.1:8866/index.html', { waitUntil: 'load' });
    await page.fill('#keyInput', 'secret'); await page.click('#loginBtn');
    await page.waitForSelector('#settingsTab:not(.hidden)', { timeout: 8000 });
    await page.click('#settingsTab'); await page.waitForSelector('#wheelCard', { timeout: 8000 });
    ok((await page.$$('.wl-amt')).length === 10 && (await page.$$('.wl-chance')).length === 10, 'ten sections to edit');
    ok(!(await page.$eval('#wlOn', e => e.checked)), 'the switch shows the saved state (off)');
    const amts0 = await page.$$eval('.wl-amt', els => els.map(e => +e.value));
    ok(amts0.join() === '200,250,300,400,500,600,700,800,900,1000', 'the default amounts are shown when nothing was saved: ' + amts0.join());
    const pct0 = await page.$$eval('.wl-pct', els => els.map(e => parseFloat(e.textContent)));
    ok(Math.abs(pct0.reduce((a, b) => a + b, 0) - 100) < 0.6, 'the % column adds up to 100 (' + pct0.join(' ') + ')');
    // edit: section 1 pays 5000 with chance 1, section 2 chance 3, the rest chance 0
    const amt = await page.$$('.wl-amt'), ch = await page.$$('.wl-chance');
    for (let i = 0; i < 10; i++) { await ch[i].fill(i === 0 ? '1' : i === 1 ? '3' : '0'); }
    await amt[0].fill('5000'); await amt[1].fill('0');
    const pct1 = await page.$$eval('.wl-pct', els => els.map(e => e.textContent));
    ok(pct1[0] === '25.0%' && pct1[1] === '75.0%' && pct1[2] === '0.0%', 'the % follows the chances live: ' + pct1.slice(0, 3).join(' '));
    ok(await page.$eval('#wlDeposit', e => e.checked) && !(await page.$eval('#wlDaily', e => e.checked)) && !(await page.$eval('#wlBuy', e => e.checked)), 'defaults shown: a spin per recharge on, daily free off, spins from buying off');
    await page.check('#wlDaily');
    await page.check('#wlOn');
    await page.click('#saveWheel'); await page.waitForTimeout(500);
    const body = saved[saved.length - 1];
    ok(body && body.settings.turntableEnabled === true && body.settings.turntableSlices.length === 10, 'the switch and ten sections are sent');
    ok(body.settings.turntableSlices[0].reward === 5000 && body.settings.turntableSlices[0].weight === 1 && body.settings.turntableSlices[1].reward === 0 && body.settings.turntableSlices[1].weight === 3, 'the typed amounts and chances are sent exactly');
    ok(body.settings.turntablePerDeposit === true && body.settings.turntableDailyFree === true && body.settings.turntablePurchaseSpins === false, 'the three spin-source switches are sent');
    ok(/Spin wheel saved/.test(await page.textContent('#adToast')), 'the owner is told it saved');
    // nothing to win is refused before it is sent
    const n = saved.length;
    for (let i = 0; i < 10; i++) await (await page.$$('.wl-chance'))[i].fill('0');
    await page.click('#saveWheel'); await page.waitForTimeout(300);
    ok(saved.length === n && /at least one section/.test(await page.textContent('#adToast')), 'all chances 0 is refused on the spot, nothing sent');
    // a negative amount too
    await (await page.$$('.wl-chance'))[0].fill('2'); await (await page.$$('.wl-amt'))[3].fill('-5');
    await page.click('#saveWheel'); await page.waitForTimeout(300);
    ok(saved.length === n && /0 or more/.test(await page.textContent('#adToast')), 'a negative amount is refused on the spot');
    // the server's refusal is shown
    await (await page.$$('.wl-amt'))[3].fill('400'); globalThis.__reject = true;
    await page.click('#saveWheel'); await page.waitForTimeout(400);
    ok(/exactly 10 sections/.test(await page.textContent('#adToast')), 'the server\'s reason is shown');
    globalThis.__reject = false;
    // reset puts the default back (not saved until Save)
    await page.click('#wlReset'); await page.waitForTimeout(200);
    ok((await page.$$eval('.wl-amt', els => els.map(e => +e.value))).join() === '200,250,300,400,500,600,700,800,900,1000', 'reset brings the default wheel back');
    ok(errs.length === 0, 'no page errors: ' + errs.join(' | '));
    console.log('PASS: admin spin wheel card (' + checks + ' checks)');
    await b.close(); srv.close(); process.exit(0);
  } catch (e) { console.log('FAIL', e.message); process.exit(1); }
});
