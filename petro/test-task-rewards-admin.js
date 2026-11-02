'use strict';
// The Task Center rewards card in admin Settings (built panel): shows both ladders, edits survive adding / removing
// rows, and Save sends exactly the edited ladders.
const { chromium } = require('playwright'); const http = require('http'), fs = require('fs'), path = require('path');
const assert = require('node:assert/strict'); let checks = 0; const ok = (c, m) => { checks++; assert.ok(c, m); };
const ROOT = path.join(__dirname, 'admin');
const SERVER = (fs.readFileSync(path.join(__dirname, 'admin-src/index.html'), 'utf8').match(/const SERVER = '([^']+)'/) || [])[1];
const saves = [];
const srv = http.createServer((q, r) => { let f = path.join(ROOT, q.url.split('?')[0]); if (f.endsWith('/')) f += 'index.html'; fs.readFile(f, (e, d) => { if (e) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', f.endsWith('.html') ? 'text/html' : f.endsWith('.js') ? 'text/javascript' : 'application/octet-stream'); r.end(d); }); }).listen(8872, async () => {
  const b = await chromium.launch(); let failed = null;
  try {
    const page = await (await b.newContext({ viewport: { width: 420, height: 900 }, serviceWorkers: 'block' })).newPage();
    const errs = []; page.on('pageerror', e => errs.push(String(e)));
    await page.route(SERVER + '/**', async route => {
      const p = new URL(route.request().url()).pathname; const body = route.request().postData() ? JSON.parse(route.request().postData()) : {};
      const send = o => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
      if (p === '/admin/check-key') return send({ status: 'success', token: 'tok', username: 'owner', role: 'owner' });
      if (p === '/admin/task-rewards/get') return send({ status: 'success', count: [{ target: 5, reward: 10000 }, { target: 15, reward: 20000 }], deposit: [{ target: 250000, reward: 10000 }], defaults: {}, custom: {} });
      if (p === '/admin/task-rewards/save') { saves.push(body); return send({ status: 'success' }); }
      return send({ status: 'success', settings: {}, users: [], counts: {}, transactions: [], stats: {}, pendingWithdrawals: 0 });
    });
    await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await page.goto('http://127.0.0.1:8872/index.html', { waitUntil: 'load' });
    await page.fill('#keyInput', 'secret'); await page.click('#loginBtn'); await page.waitForSelector('#shell:not(.hidden)');
    await page.click('#settingsTab'); await page.waitForSelector('#taskSave', { timeout: 8000 });
    const targets = await page.$$eval('[data-tt]', els => els.map(e => e.value)), rewards = await page.$$eval('[data-tr]', els => els.map(e => e.value));
    ok(targets.join() === '5,15,250000' && rewards.join() === '10000,20000,10000', 'both ladders are shown with their current numbers');
    await page.fill('[data-tr="count:0"]', '12000');            // edit a reward
    await page.click('[data-tadd="count"]');                    // add a row: the edit must survive the redraw
    ok(await page.inputValue('[data-tr="count:0"]') === '12000', 'an edit survives adding a row');
    await page.fill('[data-tt="count:2"]', '60'); await page.fill('[data-tr="count:2"]', '300000');
    await page.click('[data-tdel="count:1"]');                  // remove the 15 row
    ok((await page.$$eval('[data-tt]', els => els.map(e => e.value))).join() === '5,60,250000', 'removing a row removes the right one');
    await page.click('#taskSave'); await page.waitForTimeout(400);
    ok(saves.length === 1, 'one save request');
    ok(JSON.stringify(saves[0].count) === JSON.stringify([{ target: 5, reward: 12000 }, { target: 60, reward: 300000 }]), 'the referral ladder is sent as edited');
    ok(JSON.stringify(saves[0].deposit) === JSON.stringify([{ target: 250000, reward: 10000 }]), 'and the recharge ladder as it was');
    page.once('dialog', d => d.accept());
    await page.click('#taskDefault'); await page.waitForTimeout(400);
    ok(saves.length === 2 && saves[1].count === null && saves[1].deposit === null, 'Restore the standard rewards sends null for both');
    ok(errs.length === 0, 'no page errors: ' + errs.join(' | '));
    console.log('PASS: admin Task Center rewards card (' + checks + ' checks)');
  } catch (e) { failed = e; }
  await b.close(); srv.close(); if (failed) { console.error(failed); process.exitCode = 1; }
});
