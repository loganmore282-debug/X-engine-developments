'use strict';
// The Reset database button on the BUILT admin panel: only the owner sees it, the Erase button stays off until
// the phrase AND the admin key are typed, and the request carries exactly what the server checks.
const { chromium } = require('playwright'); const http = require('http'), fs = require('fs'), path = require('path');
const assert = require('node:assert/strict'); let checks = 0; const ok = (c, m) => { checks++; assert.ok(c, m); };
const ROOT = path.join(__dirname, 'admin');
const SERVER = (fs.readFileSync(path.join(__dirname, 'admin-src/index.html'), 'utf8').match(/const SERVER = '([^']+)'/) || [])[1];
const sent = [];
const srv = http.createServer((q, r) => { let f = path.join(ROOT, q.url.split('?')[0]); if (f.endsWith('/')) f += 'index.html'; fs.readFile(f, (e, d) => { if (e) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', f.endsWith('.html') ? 'text/html' : f.endsWith('.js') ? 'text/javascript' : 'application/octet-stream'); r.end(d); }); }).listen(8868, async () => {
  const b = await chromium.launch(); let failed = null;
  try {
    for (const role of ['owner', 'staff']) {
      const page = await (await b.newContext({ viewport: { width: 420, height: 900 }, serviceWorkers: 'block' })).newPage();
      const errs = []; page.on('pageerror', e => errs.push(String(e)));
      await page.route(SERVER + '/**', async route => {
        const p = new URL(route.request().url()).pathname; const body = route.request().postData() ? JSON.parse(route.request().postData()) : {};
        const send = o => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
        if (p === '/admin/check-key') return send({ status: 'success', token: 'tok', username: 'owner', role: 'owner' });
        if (p === '/admin/login') return send({ status: 'success', token: 'tok2', username: 'staff1', role: 'staff' });
        if (p === '/admin/database/reset-preview') return send({ status: 'success', phrase: 'RESET DATABASE', wipe: ['users', 'transactions'], keep: [], counts: { users: 12, transactions: 340 }, unfinishedDeposits: 1, unfinishedWithdrawals: 0, walletTotal: 2500 });
        if (p === '/admin/database/reset') { sent.push(body); return send({ status: 'success', erased: { users: 12, transactions: 340 }, loginsRemoved: 12, loginError: '' }); }
        return send({ status: 'success', settings: {}, deposits: [], users: [], counts: {}, pendingWithdrawals: 0 });
      });
      await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
      await page.goto('http://127.0.0.1:8868/index.html', { waitUntil: 'load' });
      if (role === 'staff') { await page.fill('#userInput', 'staff1'); }
      await page.fill('#keyInput', 'secret'); await page.click('#loginBtn');
      await page.waitForSelector('#shell:not(.hidden)', { timeout: 8000 });
      if (role === 'staff') { await page.waitForTimeout(600); ok(!(await page.$('#dbResetOpen')), 'staff never gets the reset button'); await page.close(); continue; }
      await page.click('#settingsTab'); await page.waitForSelector('#dbResetOpen', { timeout: 8000 });
      ok(true, 'the owner sees Reset database in Settings');
      await page.click('#dbResetOpen'); await page.waitForSelector('#dbGo');
      const txt = await page.textContent('#dbResetBody');
      ok(/Members/.test(txt) && /12/.test(txt) && /340/.test(txt), 'the modal lists what will be erased, with counts');
      ok(/Kept:/.test(txt) && /payment numbers/.test(txt), 'and what is kept');
      ok(await page.isDisabled('#dbGo'), 'Erase is off at first');
      await page.fill('#dbPhrase', 'RESET DATABASE'); await page.fill('#dbKey', 'MASTER');
      ok(await page.isDisabled('#dbGo'), 'still off while unfinished money is not acknowledged');
      await page.check('#dbAck'); ok(!(await page.isDisabled('#dbGo')), 'on once phrase, key and acknowledgement are there');
      await page.fill('#dbPhrase', 'reset'); ok(await page.isDisabled('#dbGo'), 'a wrong phrase turns it off again');
      await page.fill('#dbPhrase', 'RESET DATABASE'); await page.click('#dbGo'); await page.waitForSelector('#dbClose');
      eq(sent[0]);
      function eq(s) { ok(s && s.confirm === 'RESET DATABASE' && s.key === 'MASTER' && s.ack === true, 'the request carries the phrase, the key and the acknowledgement'); }
      ok(/Done/.test(await page.textContent('#dbResetBody')), 'the result is shown');
      ok(errs.length === 0, 'no page errors: ' + errs.join(' | '));
      await page.close();
    }
    console.log('PASS: admin Reset database button (' + checks + ' checks)');
  } catch (e) { failed = e; }
  await b.close(); srv.close(); if (failed) { console.error(failed); process.exitCode = 1; }
});
