'use strict';
// Admin Recharges on the BUILT panel: a member's claim is visible at once (own tab, status badge, the message they
// sent), the button says Approve (not Force-credit), a "waiting" order cannot be approved blind, and nothing about
// PesaJet / MarzPay / card payments / OTP is left in the panel.
const { chromium } = require('playwright'); const http = require('http'), fs = require('fs'), path = require('path');
const assert = require('node:assert/strict'); let checks = 0; const ok = (c, m) => { checks++; assert.ok(c, m); };
const ROOT = path.join(__dirname, 'admin');
const SERVER = (fs.readFileSync(path.join(__dirname, 'admin-src/index.html'), 'utf8').match(/const SERVER = '([^']+)'/) || [])[1];
const DEPS = [
  { id: 'd1', userId: 'u1', accountPhone: '+251912345678', referralCode: 'ABC123', method: 'manual', status: 'review', amount: 550, ref: 'M1', network: 'Telebirr Wallet', assignedName: 'Chala', assignedNumber: '0962499914', pastedSms: 'Dear AMIR You have transferred ETB 550.00. Your transaction number is DA39J9GAMN.', pastedSmsTxId: 'DA39J9GAMN', pastedSmsAmount: 550, pastedSmsAmountMatches: true, createdAt: Date.now() },
  { id: 'd2', userId: 'u2', accountPhone: '+251922222222', method: 'manual', status: 'pending', amount: 300, ref: 'M2', network: 'Commercial Bank of Ethiopia', assignedNumber: '1000809418239', createdAt: Date.now() },
  { id: 'd3', userId: 'u3', accountPhone: '+251933333333', method: 'usdt', status: 'awaiting_verification', amount: 1200, ref: 'U1', txid: 'a'.repeat(64), createdAt: Date.now() },
  { id: 'd4', userId: 'u4', accountPhone: '+251944444444', method: 'manual', status: 'matched', amount: 900, ref: 'M4', createdAt: Date.now() },
  { id: 'd5', userId: 'u5', accountPhone: '+251955555555', method: 'manual', status: 'failed', failureReason: 'Rejected by admin', amount: 700, ref: 'M5', createdAt: Date.now() },
];
const calls = [];
const srv = http.createServer((q, r) => { let f = path.join(ROOT, q.url.split('?')[0]); if (f.endsWith('/')) f += 'index.html'; fs.readFile(f, (e, d) => { if (e) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', f.endsWith('.html') ? 'text/html' : f.endsWith('.js') ? 'text/javascript' : 'application/octet-stream'); r.end(d); }); }).listen(8871, async () => {
  const b = await chromium.launch(); let failed = null;
  try {
    const page = await (await b.newContext({ viewport: { width: 420, height: 900 }, serviceWorkers: 'block' })).newPage();
    const errs = []; page.on('pageerror', e => errs.push(String(e)));
    await page.route('**' + SERVER + '/**', async route => {
      const p = new URL(route.request().url()).pathname.slice(SERVER.length); const body = route.request().postData() ? JSON.parse(route.request().postData()) : {};
      calls.push([p, body]);
      const send = o => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
      if (p === '/admin/check-key') return send({ status: 'success', token: 'tok', username: 'owner', role: 'owner' });
      if (p === '/admin/deposits/list') return send({ status: 'success', deposits: DEPS, counts: {}, processedByDay: [], processedAmount: 900 });
      if (p === '/admin/deposit/force-credit') return send({ status: 'success', message: 'Credited' });
      return send({ status: 'success', settings: {}, users: [], counts: {}, transactions: [], stats: {}, pendingWithdrawals: 0 });
    });
    await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await page.goto('http://127.0.0.1:8871/index.html', { waitUntil: 'load' });
    await page.fill('#keyInput', 'secret'); await page.click('#loginBtn'); await page.waitForSelector('#shell:not(.hidden)');
    // dashboard + settings carry no gateway / card / OTP stuff and never ask for them
    await page.waitForTimeout(800);
    const dash = await page.textContent('#content');
    ok(!/MarzPay|PesaJet|available balance/i.test(dash), 'dashboard has no MarzPay / PesaJet cards');
    ok(!calls.some(c => /marzpay|pesajet/i.test(c[0])), 'and never asks the server for them');
    await page.click('#settingsTab'); await page.waitForSelector('#saveRates'); await page.waitForTimeout(500);
    const set = await page.textContent('#content');
    ok(!/MarzPay|PesaJet|OTP|Card recharges|Recharge gateway|Save payment method/i.test(set), 'settings has no gateway, card or OTP controls');
    ok(/Payment Numbers/.test(set), 'settings points to Payment Numbers');
    // recharges
    await page.click('[data-tab="deposits"]'); await page.waitForSelector('#depRows .dep-card');
    ok(!/Sync payments|MarzPay|PesaJet|Force-credit|Force credit/i.test(await page.textContent('#content')), 'Recharges has no sync button, no gateway names, no "Force-credit"');
    const tabs = await page.$$eval('[data-df]', els => els.map(e => e.textContent.trim()));
    ok(tabs.join('|') === 'To approve (2)|Waiting for message (1)|Approved (1)|Rejected (1)|All (5)', 'tabs: ' + tabs.join('|'));
    ok(await page.$eval('[data-df="review"]', e => e.classList.contains('active')), 'it opens on To approve');
    const cards = await page.$$eval('#depRows .dep-card', els => els.map(e => e.innerText));
    ok(cards.length === 2, 'two claims are waiting for approval');
    const manual = cards.find(c => /Telebirr/.test(c));
    ok(/To approve/.test(manual), 'the claim shows its status badge');
    ok(/payment message from the member/i.test(manual) && /DA39J9GAMN/.test(manual) && /matches the order/.test(manual), 'it shows the message the member sent, the code and the amount check');
    ok(/Approve/.test(manual) && /Reject/.test(manual), 'with Approve and Reject buttons');
    // waiting
    await page.click('[data-df="pending"]');
    const wait = (await page.$$eval('#depRows .dep-card', els => els.map(e => e.innerText)))[0];
    ok(/Waiting for message/.test(wait) && /has not sent a payment message yet/.test(wait), 'a waiting order says so');
    ok(!/Approve/.test(wait) && /Reject/.test(wait), 'and cannot be approved before a message exists (Reject only)');
    // rejected card shows why
    await page.click('[data-df="failed"]');
    ok(/Rejected by admin/.test(await page.textContent('#depRows')), 'a rejected one shows the reason');
    // approve posts the credit
    await page.click('[data-df="review"]');
    page.once('dialog', d => { ok(/Approve this recharge/.test(d.message()), 'the confirmation says Approve'); d.accept(); });
    await page.click('#depRows [data-force="d1"]'); await page.waitForTimeout(500);
    ok(calls.some(c => c[0] === '/admin/deposit/force-credit' && c[1].depositId === 'd1'), 'Approve sends the credit for that recharge');
    ok(errs.length === 0, 'no page errors: ' + errs.join(' | '));
    console.log('PASS: admin Recharges (' + checks + ' checks)');
  } catch (e) { failed = e; }
  await b.close(); srv.close(); if (failed) { console.error(failed); process.exitCode = 1; }
});
