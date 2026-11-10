'use strict';
// The page loader is the RING (owner: "Return back ring loaders"). Every page that waits for something shows it, is replaced by the content, and a failed read says so with Try again.
// Driven in a real phone-sized Chromium against the REAL server.js on the in-memory database; the pages' own requests are held back so the loader can be seen.
//   node test-page-loader.js          (SHOTS=/some/folder also saves a picture of every page while it loads)
const path = require('path'), Module = require('module'), http = require('http'), fs = require('fs');
process.chdir(__dirname);
const fm = require(path.join(__dirname, 'test-helpers', 'fake-mongodb.js'));
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...a) { return req === 'mongodb' ? path.join(__dirname, 'test-helpers', 'fake-mongodb.js') : origResolve.call(this, req, ...a); };
const BACK = 4100 + Math.floor(Math.random() * 400), FRONT = 4600 + Math.floor(Math.random() * 400);
process.env.PORT = String(BACK); process.env.MONGODB_URI = 'mongodb://fake/app'; process.env.ADMIN_KEY = 'orb-test-admin-key-123456'; process.env.NODE_ENV = 'development';
process.env.POTATO_SECRETS_DIR = fs.mkdtempSync(path.join(require('os').tmpdir(), 'sa-orb-'));
const realLog = console.log, serverErrors = [];
console.log = () => {}; console.warn = () => {}; console.error = (...a) => { serverErrors.push(a.map(x => (x && x.message) || String(x)).join(' ').slice(0, 300)); };
require(path.join(__dirname, 'server.js'));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; realLog('  ok   - ' + m); } else { fail++; realLog('  FAIL - ' + m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const base = 'http://127.0.0.1:' + BACK;
const J = async (m, p, b, tok, adm) => { const r = await fetch(base + p, { method: m, headers: Object.assign({ 'content-type': 'application/json' }, tok ? { authorization: 'Bearer ' + tok } : {}, adm ? { authorization: 'Bearer orb-test-admin-key-123456' } : {}), body: b ? JSON.stringify(b) : undefined }); let j = null; try { j = await r.json(); } catch (_) {} return { s: r.status, j }; };
const SHOTS = process.env.SHOTS || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

// ---------------------------------------------------------------- 1. the files and the code (no browser)
const read = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
const src = read('user-src/original_module.js'), html = read('user-src/index.html');
ok(/function spinnerHtml\(\)/.test(src) && /svg\.dl\{/.test(html) && /function dlCircles/.test(src) && !/cmSpinRotate/.test(html), 'the dots loader (the owner\'s recording, in blue) is in the app and the ring is gone');
ok(!/orbHtml|orbTick|orbLoad|orb-free|orb-ld|orb-wrap/.test(src + html), 'the glass-orb page loader is gone from the app (the payment page keeps its own animation)');
ok(!fs.existsSync(path.join(__dirname, 'user', 'anim', 'orb-free.webp')), 'and its sheet is not shipped any more');
ok(/showPayOrb/.test(src) && fs.existsSync(path.join(__dirname, 'user', 'anim', 'pay-orb.webp')), 'the payment (polling) page still plays the owner\'s payment animation');
ok(/function btnBusyHtml\(/.test(src) && /\.verify-spin\{/.test(html), 'a busy BUTTON keeps its own small turning icon');
ok((src.match(/spinnerHtml\(\)/g) || []).length >= 8, 'every page that waits uses the ring (About Us, Ledger, My Team, Task Center, My Products, Accrued earnings, Payout Account, the robot lists)');
if (process.argv.includes('--built')) { const built = read('user/index.html'); ok(/svg\.dl\{/.test(built) && !/orb-ld/.test(built), 'the built page carries the dots loader styles'); }

// ---------------------------------------------------------------- 2. the real app
const userDir = path.join(__dirname, 'user');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
const front = http.createServer((req, res) => {
  if (req.url.startsWith('/k7x2/')) {
    const p = http.request({ host: '127.0.0.1', port: BACK, path: req.url.slice(5), method: req.method, headers: Object.assign({}, req.headers, { host: '127.0.0.1:' + BACK }) }, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    p.on('error', () => { res.writeHead(502); res.end(); }); req.pipe(p); return;
  }
  let f = req.url.split('?')[0]; if (f === '/' || !/\.[a-z0-9]+$/i.test(f)) f = '/index.html';
  fs.readFile(path.join(userDir, path.normalize(f).replace(/^(\.\.[\/\\])+/, '')), (e, buf) => { if (e) { res.writeHead(404); res.end('nf'); return; } res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(buf); });
});
(async () => {
  for (let i = 0; i < 60; i++) { try { const hh = await fetch(base + '/health'); if (hh.ok) break; } catch (_) {} await sleep(250); }
  await J('POST', '/admin/settings/update', { settings: { welcomeBonus: 7000, dailyCheckin: 250, minWithdraw: 5000, minDeposit: 5000 } }, null, true);
  await J('POST', '/admin/salary/save', { tiers: [{ id: 'sx1', target: 20000, reward: 1500 }] }, null, true);
  await J('POST', '/admin/products/add-starters', {}, null, true);
  await J('POST', '/admin/about-html/set', { html: '<p>About this app</p>' }, null, true);
  const phone = '0771234567', su = await J('POST', '/auth/signup', { phone, password: 'secret12' });
  await J('POST', '/register', { pin: '123456', referralCode: '' }, su.j.token);
  await new Promise(r => front.listen(FRONT, '127.0.0.1', r));
  const { chromium } = require('playwright'); const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
  await ctx.addInitScript(() => { window._smartaiLoaderMinMs = 0; });
  const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + String(e.message || e).slice(0, 200)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR|Content Security Policy|Function\(/.test(m.text())) errs.push('console: ' + m.text().slice(0, 200)); });
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const until = async (fn, arg, ms) => { try { await page.waitForFunction(fn, arg, { timeout: ms || 8000 }); return true; } catch (_) { return false; } };

  // sign in the way a member does
  await page.goto('http://127.0.0.1:' + FRONT + '/', { waitUntil: 'domcontentloaded' });
  await until(() => document.getElementById('authScreen').style.display === 'flex');
  await page.fill('#fPhone', phone.replace(/^0/, '')); await page.fill('#fPass', 'secret12'); await page.click('#authGo');
  ok(await until(() => document.getElementById('app').style.display === 'block', null, 15000), 'a member signs in and the app opens');
  await until(() => document.getElementById('announcementBg').classList.contains('show'), null, 6000).catch(() => {});
  await ev(() => { try { dismissAnnouncement(); } catch (e) {} try { dismissInstallSheet(); } catch (e) {} });
  await sleep(400);
  ok(await ev(() => !document.querySelector('svg.dl')), 'with nothing loading there is no loader');

  await ev(() => stopAccountPoll());   // the app's own 8 s refresh would otherwise fill the lists in the middle of a step (a race only seen when the machine is busy)
  // hold back one kind of request until told to go on (or answer it with an error)
  const held = {};
  async function hold(pattern) {
    const h = { waiting: [], mode: 'hold' };
    h.release = () => { h.mode = 'go'; h.waiting.splice(0).forEach(r => r.continue().catch(() => {})); };
    h.fail = () => { h.mode = 'fail'; h.waiting.splice(0).forEach(r => r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ status: 'error', message: 'down' }) }).catch(() => {})); };
    h.hold = () => { h.mode = 'hold'; };
    await page.route(pattern, route => {
      if (h.mode === 'go') return route.continue();
      if (h.mode === 'fail') return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ status: 'error', message: 'down' }) });
      h.waiting.push(route);
    });
    held[pattern] = h; return h;
  }
  // what the loader in a box looks like, read from the page itself
  const look = sel => ev(s => { const box = document.querySelector(s); if (!box) return null; const r = box.querySelector('svg.dl'); if (!r) return { canvas: false }; const b = r.getBoundingClientRect(); return { canvas: true, shown: b.width > 0 && !!r.offsetParent, w: Math.round(b.width), h: Math.round(b.height) }; }, sel);
  async function waitLoader(sel, what) {
    const got = await until(s => { const b = document.querySelector(s), c = b && b.querySelector('svg.dl'); return !!(c && c.getBoundingClientRect().width > 0); }, sel, 6000);
    ok(got, what + ': the ring shows while it waits');
    return look(sel);
  }
  async function checkFree(sel, what) { return waitLoader(sel, what); }
  async function animates() {}
  const shot = async name => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png') }); };

  // ---- About Us
  const hAbout = await hold('**/public/about-content');
  await ev(() => switchTab('account')); await sleep(200);
  await ev(() => openOverlay('about'));
  await checkFree('#aboutBody', 'About Us');
  await animates('#aboutBody', 'About Us');
  await shot('about-us-loading');
  hAbout.release();
  ok(await until(() => /About this app/.test(document.getElementById('aboutBody').textContent) && !document.querySelector('#aboutBody svg.dl'), null, 6000), 'About Us: the page replaces the ring when it arrives');
  await ev(() => closeOverlay());

  // ---- Ledger: Topups and Cash Outs (and what happens when the list cannot be read)
  const hDep = await hold('**/k7x2/deposits'), hWit = await hold('**/k7x2/withdrawals');
  await ev(() => openOverlay('records'));
  await ev(() => setRecordsTab('topups'));
  await checkFree('#recordsList', 'Ledger, Topups'); await shot('ledger-topups-loading');
  hDep.fail();
  ok(await until(() => /Could not load this list/.test(document.getElementById('recordsList').textContent) && !!document.querySelector('#recordsList button'), null, 6000), 'Ledger, Topups: when the list cannot be read it says so with Try again (the loader does not turn for ever)');
  hDep.hold(); await ev(() => document.querySelector('#recordsList button').click());
  await waitLoader('#recordsList', 'Ledger, Topups, after Try again');
  hDep.release();
  ok(await until(() => /No top-ups yet|Mobile-money top-up/.test(document.getElementById('recordsList').textContent) && !document.querySelector('#recordsList svg.dl'), null, 6000), 'Ledger, Topups: the list replaces the ring');
  await ev(() => setRecordsTab('cashouts'));
  await checkFree('#recordsList', 'Ledger, Cash Outs');
  hWit.release();
  ok(await until(() => /No cash-outs yet|Cash out/.test(document.getElementById('recordsList').textContent) && !document.querySelector('#recordsList svg.dl'), null, 6000), 'Ledger, Cash Outs: the list replaces the ring');
  await ev(() => closeOverlay());

  // ---- My Team: a level's members
  const hTeam = await hold('**/k7x2/team/members**');
  await ev(() => switchTab('team'));
  await ev(() => { openTeamLevel(1); });   // not awaited: the page is waiting for the held request, and so would the test
  await checkFree('#teamLevelList', 'My Team'); await shot('my-team-loading');
  hTeam.release();
  ok(await until(() => /No Level 1 members yet|member/.test(document.getElementById('teamLevelList').textContent) && !document.querySelector('#teamLevelList svg.dl'), null, 6000), 'My Team: the list replaces the ring');
  await ev(() => closeOverlay());

  // ---- Task Center
  const hTask = await hold('**/k7x2/salary/status');
  await ev(() => switchTab('rewards')); await ev(() => openOverlay('taskcenter'));
  await checkFree('#taskCenterList', 'Task Center');
  hTask.release();
  ok(await until(() => !!document.querySelector('#taskCenterList .tk-card, #taskCenterList .empty, #taskCenterList [class*=tk]') && !document.querySelector('#taskCenterList svg.dl'), null, 6000), 'Task Center: the tiers replace the ring');
  await ev(() => closeOverlay());

  // ---- My Products, Accrued earnings, Payout Account, Ledger Accrued: while the phone has not yet been given the list
  const hInv = await hold('**/k7x2/investments'), hBank = await hold('**/k7x2/bank/list'), hTx = await hold('**/k7x2/transactions'), hAcc = await hold('**/k7x2/account');
  const forget = () => ev(() => { STATE.ok = { inv: false, bank: false, tx: false }; STATE.investments = []; STATE.bankAccounts = []; STATE.transactions = []; });
  for (const hh of [hInv, hBank, hTx, hAcc]) hh.hold();
  await forget();
  await ev(() => openOverlay('mychoc'));
  await checkFree('#mychocList', 'My Products'); await shot('my-products-loading');
  ok(!await ev(() => /No AI robots running yet/.test(document.getElementById('mychocList').textContent)), 'My Products: while the list has not arrived it does not claim "none yet"');
  for (const hh of [hInv, hBank, hTx, hAcc]) hh.release();
  ok(await until(() => /No AI robots running yet/.test(document.getElementById('mychocList').textContent) && !document.querySelector('#mychocList svg.dl'), null, 6000), 'My Products: the real answer replaces the ring');
  await ev(() => closeOverlay());
  for (const hh of [hInv, hBank, hTx, hAcc]) hh.hold();
  await forget();
  await ev(() => openOverlay('bindbank'));
  await checkFree('#bankList', 'Payout Account'); await shot('payout-account-loading');
  for (const hh of [hInv, hBank, hTx, hAcc]) hh.release();
  ok(await until(() => /No accounts bound yet/.test(document.getElementById('bankList').textContent) && !document.querySelector('#bankList svg.dl'), null, 6000), 'Payout Account: the real answer replaces the ring');
  await ev(() => closeOverlay());
  for (const hh of [hInv, hBank, hTx, hAcc]) hh.hold();
  await forget();
  await ev(() => openOverlay('earnings'));
  await checkFree('#earningsList', 'Accrued earnings');
  for (const hh of [hInv, hBank, hTx, hAcc]) hh.release();
  ok(await until(() => /No AI robots running yet/.test(document.getElementById('earningsList').textContent) && !document.querySelector('#earningsList svg.dl'), null, 6000), 'Accrued earnings: the real answer replaces the ring');
  await ev(() => closeOverlay());
  for (const hh of [hInv, hBank, hTx, hAcc]) hh.hold();
  await forget();
  await ev(() => { openOverlay('records'); setRecordsTab('accrued'); });
  await checkFree('#recordsList', 'Ledger, Accrued');
  for (const hh of [hInv, hBank, hTx, hAcc]) hh.release();
  ok(await until(() => !document.querySelector('#recordsList svg.dl') && /accrued|Completed/i.test(document.getElementById('recordsList').textContent), null, 6000), 'Ledger, Accrued: the real answer replaces the ring');
  await ev(() => closeOverlay());
  // a member who HAS the list sees it at once, never a loader
  await ev(() => { STATE.ok = { inv: false, bank: false, tx: false }; STATE.bankAccounts = [{ id: 'b1', holder: 'Test Holder', network: 'MTN Mobile Money', phone: '+256771234567', isDefault: true }]; });
  await ev(() => openOverlay('bindbank'));
  ok(await ev(() => !document.querySelector('#bankList svg.dl') && /Test Holder/.test(document.getElementById('bankList').textContent)), 'Payout Account: a phone that already holds the cards shows them at once, with no loader');
  await ev(() => closeOverlay());
  // the page must say so when the lists cannot be read at all
  hInv.fail(); hBank.fail(); hTx.fail(); hAcc.fail();
  await ev(() => { STATE.ok = { inv: false, bank: false, tx: false }; STATE.investments = []; });
  await ev(() => openOverlay('mychoc'));
  ok(await until(() => /Could not load this page/.test(document.getElementById('mychocList').textContent) && !!document.querySelector('#mychocList button'), null, 6000), 'My Products: when the list cannot be read it says so with Try again');
  for (const hh of [hInv, hBank, hTx, hAcc]) hh.release();
  await ev(() => document.querySelector('#mychocList button').click());
  ok(await until(() => /No AI robots running yet/.test(document.getElementById('mychocList').textContent), null, 6000), 'My Products: Try again reads it and shows the real answer');
  await ev(() => closeOverlay());

  // ---- the robot lists (AI Robots and Home) before the first list has come
  await ev(() => { window.__products = PRODUCTS; PRODUCTS = []; _productsOk = false; renderShop(); renderFeatured(); });
  ok(await ev(() => !!document.querySelector('#shopGrid svg.dl') && !!document.querySelector('#featStrip svg.dl') && !/No AI robots yet/.test(document.getElementById('shopGrid').textContent)), 'AI Robots and Home: the ring stands in until the robot list has come (never "no robots")');
  await ev(() => { PRODUCTS = window.__products; _productsOk = true; renderShop(); renderFeatured(); });
  ok(await ev(() => !document.querySelector('#shopGrid svg.dl') && document.querySelectorAll('#shopGrid .prod-card').length > 0), 'AI Robots: the robots replace the ring');

  // ---- all gone: nothing is left turning, the timer sleeps
  await sleep(300);
  ok(await ev(() => !document.querySelector('svg.dl') && !document.querySelector('svg.dl, .cm-spin-wrap')), 'when every page has its content there is no loader and no ring anywhere');
  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  ok(serverErrors.length === 0, 'no server errors' + (serverErrors.length ? ': ' + serverErrors.slice(0, 2).join(' | ') : ''));
  await browser.close(); front.close();
  realLog('\n' + (fail ? 'FAIL' : 'PASS') + ': page loader (' + pass + ' ok, ' + fail + ' failed)');
  process.exit(fail ? 1 : 0);
})().catch(e => { realLog('CRASH ' + (e && e.stack || e)); process.exit(1); });
