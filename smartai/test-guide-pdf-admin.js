'use strict';
// The admin Guide card: "Upload PDF" sends the file, shows what is uploaded, refuses a file that is not a PDF or is over 8 MB, and "Remove PDF" asks first.
//   node test-guide-pdf-admin.js
const path = require('path'), http = require('http'), fs = require('fs');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok   - ' + m); } else { fail++; console.log('  FAIL - ' + m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp' };
const dir = path.join(__dirname, 'admin');
const srv = http.createServer((req, res) => { let f = req.url.split('?')[0]; if (f === '/' || !/\.[a-z0-9]+$/i.test(f)) f = '/index.html'; fs.readFile(path.join(dir, path.normalize(f).replace(/^(\.\.[\/\\])+/, '')), (e, buf) => { if (e) { res.writeHead(404); res.end('nf'); return; } res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(buf); }); });
(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const { chromium } = require('playwright'); const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 400, height: 900 }, serviceWorkers: 'block' });
  const p = await ctx.newPage(); const errs = [], sent = []; let stored = null;
  p.on('pageerror', e => errs.push(e.message));
  let dialogs = 0; p.on('dialog', d => { dialogs++; d.accept(); });
  await p.route('**/k7x2/**', route => {
    const rq = route.request(), pth = new URL(rq.url()).pathname.replace(/^\/k7x2/, ''); let body = {}; try { body = JSON.parse(rq.postData() || '{}'); } catch (_) {}
    let out = { status: 'success', message: 'ok', stats: {}, products: [], users: [], transactions: [], deposits: [], withdrawals: [] };
    if (pth === '/admin/check-key' || pth === '/admin/login') out = { status: 'success', token: 'tok', username: 'owner', role: 'owner' };
    if (pth === '/admin/settings') out = { status: 'success', settings: { brandName: 'Smart AI' } };
    if (pth === '/admin/guide') out = { status: 'success', title: '', blocks: [], pdf: stored };
    if (pth === '/admin/guide/pdf/set') { sent.push(body); stored = { name: body.name, size: 1234 }; out = { status: 'success', name: body.name, size: 1234 }; }
    if (pth === '/admin/guide/pdf/clear') { stored = null; sent.push({ cleared: true }); }
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(out) });
  });
  await p.goto('http://127.0.0.1:' + srv.address().port + '/'); await sleep(500);
  await p.fill('#keyInput', 'k'); await p.click('#loginBtn'); await sleep(900);
  await p.click('[data-tab="banners"]'); await p.waitForSelector('#guidePdfFile', { state: 'attached', timeout: 8000 });
  ok(/No PDF uploaded/.test(await p.textContent('#guidePdfInfo')) && await p.isHidden('#guidePdfDel'), 'with no PDF the card says so and shows no Remove button');
  await p.setInputFiles('#guidePdfFile', { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') }); await sleep(300);
  ok(sent.length === 0, 'a file that is not a PDF is not sent');
  await p.setInputFiles('#guidePdfFile', { name: 'big.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(8 * 1024 * 1024 + 5) }); await sleep(500);
  ok(sent.length === 0, 'a PDF over 8 MB is not sent');
  const pdf = Buffer.from('%PDF-1.4\n% test pdf ' + 'x'.repeat(300));
  await p.setInputFiles('#guidePdfFile', { name: 'My Guide.pdf', mimeType: 'application/pdf', buffer: pdf }); await sleep(900);
  ok(sent.length === 1 && sent[0].name === 'My Guide.pdf' && sent[0].pdf.startsWith('data:application/pdf;base64,') && Buffer.from(sent[0].pdf.split(',')[1], 'base64').equals(pdf), 'a real PDF is sent exactly as it is');
  ok(/My Guide\.pdf/.test(await p.textContent('#guidePdfInfo')) && await p.isVisible('#guidePdfDel'), 'the card shows the uploaded file and a Remove button');
  await p.click('#guidePdfDel'); await sleep(700);
  ok(dialogs === 1 && sent[sent.length - 1].cleared === true && /No PDF uploaded/.test(await p.textContent('#guidePdfInfo')) && await p.isHidden('#guidePdfDel'), 'Remove asks first, then takes the PDF away');
  ok(errs.length === 0, 'the admin panel raised no errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await browser.close(); srv.close();
  console.log(fail ? `FAIL: ${fail} failed` : `PASS: guide PDF upload in the admin (${pass} checks)`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL:', e.message); process.exit(1); });
