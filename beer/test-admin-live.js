// LIVE admin test: the built admin panel in a real browser against the real server (fake MongoDB). Logs in, opens EVERY tab by a real tap, makes a withdrawal
// and checks the "Mark as paid" / "Reject" buttons, and fails on any script error or any tab that stays empty. Needs NODE_PATH=/opt/node-tools/node_modules.
const path = require('path'), Module = require('module'), http = require('http'), fs = require('fs');
const D = process.env.APPDIR || __dirname;
process.chdir(D);
const fm = require(path.join(D, 'test-helpers', 'fake-mongodb.js'));
const o = Module._resolveFilename;
Module._resolveFilename = function (r, ...a) { return r === 'mongodb' ? path.join(D, 'test-helpers', 'fake-mongodb.js') : o.call(this, r, ...a); };
const BACK = 6700 + Math.floor(Math.random() * 100), FRONT = 6900 + Math.floor(Math.random() * 100);
process.env.PORT = String(BACK); process.env.MONGODB_URI = 'mongodb://fake/app'; process.env.ADMIN_KEY = 'live-admin-key-1234567890'; process.env.NODE_ENV = 'development';
process.env.COOKIE_SECRETS_DIR = fs.mkdtempSync(path.join(require('os').tmpdir(), 'beer-adminlive-'));
const L = console.log; console.log = () => {}; console.warn = () => {}; console.error = () => {};
require(path.join(D, 'server.js'));
const sleep = ms => new Promise(r => setTimeout(r, ms)), base = 'http://127.0.0.1:' + BACK;
const J = async (m, p, b, tok, adm) => { const r = await fetch(base + p, { method: m, headers: Object.assign({ 'content-type': 'application/json' }, tok ? { authorization: 'Bearer ' + tok } : {}, adm ? { 'x-admin-key': process.env.ADMIN_KEY } : {}), body: b ? JSON.stringify(b) : undefined }); return { s: r.status, j: await r.json().catch(() => ({})) }; };
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg' };
const front = http.createServer((req, res) => {
  if (req.url.startsWith('/k7x2/')) { const p = http.request({ host: '127.0.0.1', port: BACK, path: req.url.slice(5), method: req.method, headers: Object.assign({}, req.headers, { host: '127.0.0.1:' + BACK }) }, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); }); p.on('error', () => { res.writeHead(502); res.end(); }); req.pipe(p); return; }
  let f = req.url.split('?')[0]; if (f === '/' || !/\.[a-z0-9]+$/i.test(f)) f = '/index.html';
  fs.readFile(path.join(D, 'admin', path.normalize(f).replace(/^(\.\.[\/\\])+/, '')), (e, b) => { if (e) { res.writeHead(404); res.end('nf'); return; } res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(b); });
});
const results = []; const check = (name, ok, extra) => { results.push([ok, name, extra || '']); L((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  -- ' + extra : '')); };
(async () => {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/health')).ok) break; } catch (_) {} await sleep(250); }
  await J('POST', '/admin/settings/update', { settings: { welcomeBonus: 7000, minDeposit: 5000, minWithdraw: 5000, requireInvestToWithdraw: false } }, null, true);
  await J('POST', '/admin/products/add-starters', {}, null, true);
  await J('POST', '/admin/pay-channels/save', { name: 'Commercial Bank of Ethiopia', kind: 'bank', accountName: 'Test Owner', accountNumber: '1000809418239', order: 0 }, null, true);
  const su = await J('POST', '/auth/signup', { phone: '0911223344', password: 'secret12' }); await J('POST', '/register', { pin: '123456', referralCode: '' }, su.j.token);
  let uid; for (const [id] of fm.__stores.users) uid = id; fm.__stores.users.get(uid).walletBalance = 500000;
  const pr = await J('GET', '/public/products', null, su.j.token); const tier = ((pr.j.products || pr.j.tiers || [])[0]) || {};
  const bu = await J('POST', '/invest/create', { tierKey: tier.key || tier.id, expectedPrice: tier.price }, su.j.token);
  if (bu.j.status !== 'success') L('purchase not made: ' + JSON.stringify(bu.j).slice(0, 120));
  fm.__stores.users.get(uid).walletBalance = Math.max(fm.__stores.users.get(uid).walletBalance, 300000);
  // a withdrawal request made the real way (wallet saved, then Withdraw)
  await J('POST', '/bank/save', { holder: 'A Tester', network: 'Telebirr', phone: '0911223344' }, su.j.token);
  const wr = await J('POST', '/withdraw/request', { amount: 20000, network: 'Telebirr', phone: '0911223344' }, su.j.token);
  if (wr.j.status !== 'success') L('withdraw request not made: ' + JSON.stringify(wr.j));
  await new Promise(r => front.listen(FRONT, '127.0.0.1', r));
  const { chromium } = require('playwright'); const br = await chromium.launch();
  const ctx = await br.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(String(e.message)));
  await page.goto('http://127.0.0.1:' + FRONT + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#keyInput', { timeout: 20000 });
  await page.fill('#keyInput', process.env.ADMIN_KEY); await page.click('#loginBtn');
  await page.waitForSelector('[data-tab="dashboard"]', { timeout: 20000 }); await sleep(1500);
  const tabs = await page.$$eval('[data-tab]', els => els.map(e => e.getAttribute('data-tab')));
  for (const t of tabs) {
    await page.click('[data-tab="' + t + '"]'); await sleep(1400);
    const len = await page.evaluate(() => (document.getElementById('content') || {}).innerText.trim().length);
    check('tab ' + t + ' opens and shows something', len > 20, 'text length ' + len);
  }
  // withdrawals: the buttons say what they do, nothing about a gateway
  await page.click('[data-tab="withdrawals"]'); await sleep(1400);
  const wtxt = await page.evaluate(() => document.getElementById('content').innerText);
  check('Withdrawals names no payment provider', !/marz|pesajet|gateway|sync payments|send via/i.test(wtxt));
  const proc = await page.$('[data-proc]'), rej = await page.$('[data-rej]');
  check('the pending withdrawal row has a Mark as paid button and a Reject button', !!proc && !!rej && /Mark as paid/.test(await proc.innerText()), wr.s + ' ' + JSON.stringify(wr.j).slice(0, 80));
  if (proc) { page.once('dialog', d => d.accept()); await proc.click(); await sleep(1500);
    const st = [...fm.__stores.withdrawals.values()][0] || {}; check('Mark as paid really records it as processed (by hand)', st.status === 'processed' && st.payoutMethod === 'manual', st.status + ' ' + st.payoutMethod); }
  // settings + dashboard + deposits: no provider words
  for (const t of ['settings', 'dashboard', 'deposits']) { await page.click('[data-tab="' + t + '"]'); await sleep(1400);
    const tx = await page.evaluate(() => document.getElementById('content').innerText);
    check(t + ' page names no payment gateway', !/marz|pesajet|gateway|mtn|airtel|automatic withdrawals/i.test(tx)); }
  check('no script errors during the whole run', errs.length === 0, errs.slice(0, 2).join(' | '));
  await br.close(); const bad = results.filter(r => !r[0]);
  L(bad.length ? 'ADMIN LIVE TEST: ' + bad.length + ' FAILED' : 'ADMIN LIVE TEST: ALL PASSED'); process.exit(bad.length ? 1 : 0);
})().catch(e => { L('CRASH ' + e.stack); process.exit(2); });
