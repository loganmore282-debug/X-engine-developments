// LIVE test: real clicks in a real browser against the real server (fake MongoDB).
const path = require('path'), Module = require('module'), http = require('http'), fs = require('fs');
const D = process.env.APPDIR || __dirname;
process.chdir(D);
const fm = require(path.join(D, 'test-helpers', 'fake-mongodb.js'));
const o = Module._resolveFilename;
Module._resolveFilename = function (r, ...a) { return r === 'mongodb' ? path.join(D, 'test-helpers', 'fake-mongodb.js') : o.call(this, r, ...a); };
const BACK = 6100 + Math.floor(Math.random() * 200), FRONT = 6400 + Math.floor(Math.random() * 200);
process.env.PORT = String(BACK); process.env.MONGODB_URI = 'mongodb://fake/app'; process.env.ADMIN_KEY = 'live-admin-key-1234567890'; process.env.NODE_ENV = 'development';
process.env.COOKIE_SECRETS_DIR = fs.mkdtempSync(path.join(require('os').tmpdir(), 'beer-live-'));
const L = console.log; console.log = () => {}; console.warn = () => {}; console.error = () => {};
require(path.join(D, 'server.js'));
const sleep = ms => new Promise(r => setTimeout(r, ms)), base = 'http://127.0.0.1:' + BACK;
const J = async (m, p, b, tok, adm) => { const r = await fetch(base + p, { method: m, headers: Object.assign({ 'content-type': 'application/json' }, tok ? { authorization: 'Bearer ' + tok } : {}, adm ? { authorization: 'Bearer live-admin-key-1234567890' } : {}), body: b ? JSON.stringify(b) : undefined }); let j = null; try { j = await r.json(); } catch (_) {} return { s: r.status, j }; };
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg' };
const front = http.createServer((req, res) => {
  if (req.url.startsWith('/k7x2/')) { const p = http.request({ host: '127.0.0.1', port: BACK, path: req.url.slice(5), method: req.method, headers: Object.assign({}, req.headers, { host: '127.0.0.1:' + BACK }) }, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); }); req.pipe(p); return; }
  let f = req.url.split('?')[0]; if (f === '/' || !/\.[a-z0-9]+$/i.test(f)) f = '/index.html';
  fs.readFile(path.join(D, 'user', path.normalize(f).replace(/^(\.\.[\/\\])+/, '')), (e, b) => { if (e) { res.writeHead(404); res.end('nf'); return; } res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(b); });
});
const results = []; const check = (name, ok, extra) => { results.push([ok, name, extra || '']); L((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  -- ' + extra : '')); };
(async () => {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/health')).ok) break; } catch (_) {} await sleep(250); }
  await J('POST', '/admin/settings/update', { settings: { welcomeBonus: 7000, minDeposit: 5000, minWithdraw: 5000 } }, null, true);
  await J('POST', '/admin/products/add-starters', {}, null, true);
  await J('POST', '/admin/pay-channels/save', { name: 'Commercial Bank of Ethiopia', kind: 'bank', accountName: 'Test Owner', accountNumber: '1000809418239', order: 0 }, null, true);
  const su = await J('POST', '/auth/signup', { phone: '0911223344', password: 'secret12' }); await J('POST', '/register', { pin: '123456', referralCode: '' }, su.j.token);
  let uid; for (const [id] of fm.__stores.users) uid = id; fm.__stores.users.get(uid).walletBalance = 500000;
  await new Promise(r => front.listen(FRONT, '127.0.0.1', r));
  const { chromium } = require('playwright'); const br = await chromium.launch();
  const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(String(e.message)));
  const OUT = process.argv[2] || require('os').tmpdir() + '/beer-live'; fs.mkdirSync(OUT, { recursive: true });
  await page.goto('http://127.0.0.1:' + FRONT + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.getElementById('authScreen') && document.getElementById('authScreen').style.display !== 'none' && document.getElementById('loadingScreen').style.display === 'none', null, { timeout: 20000 });
  await page.fill('#loginPhone', '911223344'); await page.fill('#loginPassword', 'secret12'); await page.tap('#loginBtn');
  await page.waitForFunction(() => document.getElementById('app').style.display !== 'none', null, { timeout: 20000 });
  await sleep(2500);
  // the welcome dialog: close it with a real tap
  const ann = await page.$('.ck-ann-x'); if (ann) { await ann.tap(); await sleep(900); }
  await page.screenshot({ path: OUT + '/1-home.png' });
  // 1. BUY: tap the first Buy now with a real tap
  const before = await page.evaluate(() => (STATE.investments || []).length);
  const buy = await page.$('.v-buy'); check('Buy now button exists', !!buy);
  await buy.tap(); await sleep(1200);
  await page.screenshot({ path: OUT + '/2-buy-tapped.png' });
  const dlg = await page.evaluate(() => { const b = document.getElementById('confirmBg'); if (!b) return 'no #confirmBg'; const cs = getComputedStyle(b); const sh = b.querySelector('.confirm-sheet'); const r = sh ? sh.getBoundingClientRect() : null; return JSON.stringify({ show: b.classList.contains('show'), disp: cs.display, vis: cs.visibility, op: cs.opacity, pe: cs.pointerEvents, sheet: r ? [Math.round(r.width), Math.round(r.height), getComputedStyle(sh).opacity, getComputedStyle(sh).transform] : null, text: (sh && sh.textContent || '').trim().slice(0, 80) }); });
  L('confirm dialog state:', dlg);
  check('a confirm dialog appears after tapping Buy, on screen', /"show":true/.test(dlg) && /"sheet":\[[1-9]/.test(dlg));
  // find the confirm / OK button and tap it
  const okBtn = await page.$('.confirm-bg.show .confirm-ok, .confirm-bg.show button.primary, .confirm-bg.show .ck-prompt-ok, #confirmOk');
  check('the dialog has a confirm button', !!okBtn);
  if (okBtn) { const bb = await okBtn.boundingBox(); L('confirm button box', JSON.stringify(bb)); await okBtn.tap(); await sleep(2500); }
  await page.screenshot({ path: OUT + '/3-after-confirm.png' });
  const after = await page.evaluate(async () => { try { const r = await api('/investments'); return (r.investments || []).length; } catch (e) { return -1; } });
  check('the purchase really went through (an investment exists on the server)', after > before, 'before ' + before + ' after ' + after);
  const frozen = await page.evaluate(() => { const b = document.getElementById('confirmBg'); return b && b.classList.contains('show'); });
  check('the app is not stuck behind a dialog afterwards', !frozen);
  // 2. the app still answers taps: go through every tab
  for (const [n, nav] of [['income', 'assets'], ['team', 'network'], ['share', 'share'], ['my', 'account'], ['home', 'home']]) {
    await page.tap(`.navitem[data-nav="${nav}"]`); await sleep(1300);
    const active = await page.evaluate(k => { const e = document.querySelector('.navitem.active'); return e && e.dataset.nav; }, nav);
    check('tab ' + n + ' opens by tapping', active === nav, 'active=' + active);
  }
  { const x = await page.$('.ck-ann-x'); if (x) { await x.tap(); await sleep(900); } }   // the welcome dialog comes back with Home
  // 3. deposit flow
  await page.tap('.ck-quick button:nth-child(1)'); await sleep(1400);
  check('Deposit page opens', await page.evaluate(() => !!document.getElementById('depAmount')));
  await page.fill('#depAmount', '35000'); await sleep(300); await page.tap('#depSubmitBtn'); await sleep(1800);
  check('Pay opens the payment pages', await page.evaluate(() => !!document.querySelector('#mpFlow.show .mpf-row')));
  await page.screenshot({ path: OUT + '/4-pay-choose.png' });
  await page.tap('.mpf-row'); await sleep(2000);
  check('picking a payment shows the pay page with a clock', await page.evaluate(() => !!document.querySelector('#mpFlow.show .mpf-clock')));
  await page.evaluate(() => mpClose()); await sleep(600);
  // 4. withdraw page opens
  await page.evaluate(() => { try { closeSheet(); } catch (e) {} }); await sleep(500);
  await page.tap('.ck-quick button:nth-child(2)'); await sleep(1400);
  check('Withdraw page opens', await page.evaluate(() => !!document.getElementById('witAmount')));
  await page.screenshot({ path: OUT + '/5-withdraw.png' });
  // 5. wallet bind, language, share, my pages
  await page.evaluate(() => { try { closeSheet(); } catch (e) {} }); await sleep(400);
  await page.evaluate(() => { try { closeAnnouncement(); } catch (e) {} }); await sleep(500);
  await page.evaluate(() => navigatePage('account')); await sleep(1200);
  await page.evaluate(() => { try { closeAnnouncement(); } catch (e) {} }); await sleep(300);
  await page.tap('.ck-menu-row, .ck-pi-row, [onclick*="openPersonalInfo"]'); await sleep(1200);
  check('Personal information page opens', await page.evaluate(() => !!document.querySelector('.ck-pi-card, .ck-pi-row')));
  await page.evaluate(() => { openWalletSheet(); }); await sleep(1300);
  await page.fill('#walHolder', 'Test Holder'); await page.fill('#walPhone', '0911223344').catch(() => {});
  check('Bind wallet page has the Telebirr and bank choices', await page.evaluate(() => /Telebirr/.test(document.getElementById('sheetBody').innerHTML) || /Telebirr/.test(String(walProviders())) ));
  await page.screenshot({ path: OUT + '/6-wallet.png' });
  await page.evaluate(() => { try { closeSheet(); } catch (e) {} }); await sleep(400);
  await page.evaluate(() => { openLangPicker(); }); await sleep(800);
  check('language list shows English and Amharic', await page.evaluate(() => /English/.test(document.body.innerText) && /አማርኛ/.test(document.body.innerText)));
  await page.evaluate(() => { pickLang('am'); }); await sleep(900);
  check('switching to Amharic translates the page', await page.evaluate(() => /[\u1200-\u137f]/.test(document.querySelector('.bottom-nav').innerText)));
  await page.evaluate(() => { pickLang('en'); }); await sleep(700);
  await page.tap('.navitem[data-nav="share"]'); await sleep(1500);
  check('Share page has the QR code picture', await page.evaluate(() => { const i = document.querySelector('.ck-sc-qr img'); return !!i && i.complete && i.naturalWidth > 0; }));
  await page.screenshot({ path: OUT + '/7-share.png' });
  check('no script errors during the whole run', errs.length === 0, errs.join(' | ').slice(0, 300));
  const bad = results.filter(r => !r[0]).length; L(bad ? 'LIVE TEST: ' + bad + ' FAILED' : 'LIVE TEST: ALL PASSED');
  await br.close(); process.exit(bad ? 1 : 0);
})().catch(e => { L('FAIL crash', e.message); process.exit(1); });
