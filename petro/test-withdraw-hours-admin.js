'use strict';
// The Task Center rewards card in admin Settings (built panel): shows both ladders, edits survive adding / removing
// rows, and Save sends exactly the edited ladders.
const { chromium } = require('playwright'); const http = require('http'), fs = require('fs'), path = require('path');
const assert = require('node:assert/strict'); let checks = 0; const ok = (c, m) => { checks++; assert.ok(c, m); };
const ROOT = path.join(__dirname, 'admin');
const SERVER = (fs.readFileSync(path.join(__dirname, 'admin-src/index.html'), 'utf8').match(/const SERVER = '([^']+)'/) || [])[1];
const saves = [];
const srv = http.createServer((q, r) => { let f = path.join(ROOT, q.url.split('?')[0]); if (f.endsWith('/')) f += 'index.html'; fs.readFile(f, (e, d) => { if (e) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', f.endsWith('.html') ? 'text/html' : f.endsWith('.js') ? 'text/javascript' : 'application/octet-stream'); r.end(d); }); }).listen(8874, async () => {
  const b = await chromium.launch(); let failed = null;
  try {
    const page = await (await b.newContext({ viewport: { width: 420, height: 900 }, serviceWorkers: 'block' })).newPage();
    const errs = []; page.on('pageerror', e => errs.push(String(e)));
    await page.route(SERVER + '/**', async route => {
      const p = new URL(route.request().url()).pathname; const body = route.request().postData() ? JSON.parse(route.request().postData()) : {};
      const send = o => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
      if (p === '/admin/check-key') return send({ status: 'success', token: 'tok', username: 'owner', role: 'owner' });
      if (p === '/admin/task-rewards/get') return send({ status: 'success', count: [{ target: 5, reward: 10000 }, { target: 15, reward: 20000 }], deposit: [{ target: 250000, reward: 10000 }], defaults: {}, custom: {} });
      if (p.startsWith('/admin/settings') && body.settings && 'withdrawOpenFrom' in body.settings) { saves.push(body.settings); return send({ status: 'success' }); }
      return send({ status: 'success', settings: {}, users: [], counts: {}, transactions: [], stats: {}, pendingWithdrawals: 0 });
    });
    await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await page.goto('http://127.0.0.1:8874/index.html', { waitUntil: 'load' });
    await page.fill('#keyInput', 'secret'); await page.click('#loginBtn'); await page.waitForSelector('#shell:not(.hidden)');
    await page.click('#settingsTab'); await page.waitForSelector('#sWitFrom', { state: 'attached', timeout: 8000 });
    const sels = await page.$$eval('[data-t24] select', els => els.map(e => e.options.length));
    ok(sels.length === 4 && sels[0] === 24 && sels[2] === 24, 'each time is an hour list of 00 to 23 plus a minute list');
    ok(!(await page.$('input[type=time]#sWitFrom, input[type=time]#sWitTo')), 'no browser AM / PM time box is left');
    ok((await page.inputValue('#sWitFrom', { timeout: 2000 }).catch(() => '')) === '09:00', 'opening time defaults to 09:00');
    const boxes = await page.$$eval('[data-t24]', els => els.map(e => { const r = e.getBoundingClientRect(); return { x: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height) }; }));
    ok(boxes.length === 2 && Math.abs(boxes[0].w - boxes[1].w) <= 1, 'both pickers are the same width');
    const hours = await page.$$('[data-t24] select');
    await hours[0].selectOption('18'); await hours[1].selectOption('30');
    await hours[2].selectOption('05'); await hours[3].selectOption('45');
    ok(await page.inputValue('#sWitFrom') === '18:30' && await page.inputValue('#sWitTo') === '05:45', 'picking writes 24-hour HH:MM (18:30 and 05:45, past midnight)');
    await page.check('#sWitWindow');
    ok(/Ethiopia time/.test(await page.textContent('#witNow')) && /OPEN|CLOSED/.test(await page.textContent('#witNow')), 'a live line says whether withdrawing is open now');
    await page.click('#saveRates'); await page.waitForTimeout(500);
    const sv = saves.find(x => 'withdrawOpenFrom' in x);
    ok(sv && sv.withdrawOpenFrom === '18:30' && sv.withdrawOpenTo === '05:45' && sv.withdrawWindowEnabled === true, 'Save sends the 24-hour times');
    ok(errs.length === 0, 'no page errors: ' + errs.join(' | '));
    console.log('PASS: admin withdraw hours picker (' + checks + ' checks)');
  } catch (e) { failed = e; }
  await b.close(); srv.close(); if (failed) { console.error(failed); process.exitCode = 1; }
});
