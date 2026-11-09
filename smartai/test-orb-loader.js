'use strict';
// The page loader: every ring loader of the member app is the glass orb of the owner's payment animation, on its own (no tile, no background).
// Driven in a real phone-sized Chromium against the REAL server.js on the in-memory database; the pages' own requests are held back so the loader can be seen.
//   node test-orb-loader.js          (SHOTS=/some/folder also saves a picture of every page while it loads)
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
const sheetFile = path.join(__dirname, 'user', 'anim', 'orb-free.webp');
const sheet = fs.readFileSync(sheetFile);
ok(sheet.slice(0, 4).toString() === 'RIFF' && sheet.slice(8, 12).toString() === 'WEBP' && sheet.slice(12, 16).toString() === 'VP8X', 'the orb sheet is a WebP with the extended header (it can carry transparency)');
ok((sheet[20] & 0x10) !== 0, 'its header says it has an alpha channel (the orb is cut out of its background)');
const w = 1 + sheet.readUIntLE(24, 3), h = 1 + sheet.readUIntLE(27, 3);
ok(w === 1920 && h === 1920, 'the sheet is 10 x 10 frames of 192 px (' + w + ' x ' + h + ')');
ok(sheet.length > 100000 && sheet.length < 400000, 'and light enough to fetch once (' + Math.round(sheet.length / 1024) + ' kB)');
ok(fs.existsSync(path.join(__dirname, 'tools', 'make-anim-sprites.py')) && /orb-free\.webp/.test(read('tools/make-anim-sprites.py')), 'the tool that cuts it from the owner\'s GIF is in the repo');
ok(/function orbHtml\(\)/.test(src) && /function orbTick\(\)/.test(src) && /\/anim\/orb-free\.webp/.test(src), 'the app has the orb loader and fetches the sheet');
ok(!/spinnerHtml|cm-spinner|cm-spin-wrap|cmSpinRotate|cmSpinDash/.test(src + html), 'no ring loader is left in the app (code or styles)');
ok(/function btnBusyHtml\(/.test(src) && /\.verify-spin\{/.test(html), 'a busy BUTTON keeps its own small turning icon (the owner meant the loaders, not the buttons)');
const orbCss = (html.match(/\.orb-wrap\{[^}]*\}/) || [''])[0] + (html.match(/\.orb-ld\{[^}]*\}/) || [''])[0];
ok(orbCss.length > 20 && !/box-shadow|border-radius|border:|background:(?!none)|background-color|filter/.test(orbCss), 'the loader has no tile, no box, no shadow and no background of its own');
ok((src.match(/orbHtml\(\)/g) || []).length >= 8, 'every page that waits uses it (About Us, Ledger, My Team, Task Center, My Products, Accrued earnings, Payout Account, the robot lists)');
if (process.argv.includes('--built')) { const built = read('user/index.html'); ok(!/cm-spinner|cm-spin-wrap/.test(built) && /\.orb-ld\{/.test(built), 'the built page carries the orb styles and no ring styles'); }

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
  const sheetReqs = []; page.on('request', r => { if (/\/anim\/orb-free\.webp/.test(r.url())) sheetReqs.push(r.url()); });

  // sign in the way a member does
  await page.goto('http://127.0.0.1:' + FRONT + '/', { waitUntil: 'domcontentloaded' });
  await until(() => document.getElementById('authScreen').style.display === 'flex');
  await page.fill('#fPhone', phone.replace(/^0/, '')); await page.fill('#fPass', 'secret12'); await page.click('#authGo');
  ok(await until(() => document.getElementById('app').style.display === 'block', null, 15000), 'a member signs in and the app opens');
  await until(() => document.getElementById('announcementBg').classList.contains('show'), null, 6000).catch(() => {});
  await ev(() => { try { dismissAnnouncement(); } catch (e) {} try { dismissInstallSheet(); } catch (e) {} });
  await sleep(400);
  ok(await ev(() => !document.querySelector('canvas.orb-ld')) && await ev(() => window._orbRaf === 0), 'with nothing loading there is no loader and its timer is asleep');

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
  const look = sel => ev(s => {
    const box = document.querySelector(s); if (!box) return null;
    const cv = box.querySelector('canvas.orb-ld'); if (!cv) return { canvas: false };
    const r = cv.getBoundingClientRect(), cs = getComputedStyle(cv), ws = getComputedStyle(cv.parentElement);
    const c = cv.getContext('2d'), px = (x, y) => c.getImageData(x, y, 1, 1).data[3];
    let hash = 0; const d = c.getImageData(40, 40, 112, 112).data; for (let i = 0; i < d.length; i += 97) hash = (hash * 31 + d[i]) >>> 0;
    let ink = 0; const all = c.getImageData(0, 0, cv.width, cv.height).data; for (let i = 3; i < all.length; i += 4) if (all[i] > 0) ink++;
    return { canvas: true, w: Math.round(r.width), h: Math.round(r.height), shown: r.width > 0 && !!cv.offsetParent, painted: cv._orbFrame !== undefined,
      cornerAlpha: px(2, 2) + px(189, 2) + px(2, 189) + px(189, 189), centreAlpha: px(96, 96), hash, inkShare: ink / (cv.width * cv.height),
      bg: cs.backgroundColor + '|' + cs.backgroundImage + '|' + cs.boxShadow + '|' + cs.borderRadius + '||' + ws.backgroundColor + '|' + ws.backgroundImage + '|' + ws.boxShadow + '|' + ws.borderRadius, shownFrame: cv._orbFrame };
  }, sel);
  const NOBG = 'rgba(0, 0, 0, 0)|none|none|0px||rgba(0, 0, 0, 0)|none|none|0px';
  async function waitLoader(sel, what) {
    const got = await until(s => { const b = document.querySelector(s), c = b && b.querySelector('canvas.orb-ld'); return !!(c && c.offsetParent && c._orbFrame !== undefined); }, sel, 6000);
    ok(got, what + ': the orb shows while it waits');
    // a page may redraw its box once more (a new canvas): read it only once the canvas on screen has been painted
    let a = await look(sel);
    for (let i = 0; i < 40 && a && a.canvas && (!a.painted || a.inkShare === 0); i++) { await sleep(50); a = await look(sel); }
    return a;
  }
  async function checkFree(sel, what) {
    const a = await waitLoader(sel, what); if (!a || !a.canvas) return;
    ok(a.w === 84 && a.h === 84, what + ': 84 px, nothing else around it (' + a.w + ' x ' + a.h + ')');
    ok(a.cornerAlpha === 0 && a.centreAlpha === 255, what + ': its corners are see-through and its middle is the ball (no tile behind it)');
    ok(a.bg === NOBG, what + ': the orb and its box have no background, shadow or rounded tile');
    ok(a.inkShare > 0.6 && a.inkShare < 0.85, what + ': only the round ball is painted (' + Math.round(a.inkShare * 100) + ' % of the square)');
    return a;
  }
  async function animates(sel, what) {
    // the loader has to be MOVING: wait for the sheet, then see different frames
    await until(() => window._orbSheetOk === true, null, 8000);
    const seen = new Set(); for (let i = 0; i < 10; i++) { const a = await look(sel); if (a && a.canvas) seen.add(a.hash); await sleep(90); }
    ok(seen.size >= 4, what + ': it is the animation, not a still picture (' + seen.size + ' different frames in 0.9 s)');
  }
  const shot = async name => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png') }); };

  // ---- About Us
  const hAbout = await hold('**/public/about-content');
  await ev(() => switchTab('account')); await sleep(200);
  await ev(() => openOverlay('about'));
  await checkFree('#aboutBody', 'About Us');
  await animates('#aboutBody', 'About Us');
  await shot('about-us-loading');
  ok(sheetReqs.length >= 1 && sheetReqs.every(u => /\/anim\/orb-free\.webp/.test(u)), 'the sheet was fetched from /anim/orb-free.webp');
  hAbout.release();
  ok(await until(() => /About this app/.test(document.getElementById('aboutBody').textContent) && !document.querySelector('#aboutBody canvas'), null, 6000), 'About Us: the page replaces the orb when it arrives');
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
  ok(await until(() => /No top-ups yet|Mobile-money top-up/.test(document.getElementById('recordsList').textContent) && !document.querySelector('#recordsList canvas'), null, 6000), 'Ledger, Topups: the list replaces the orb');
  await ev(() => setRecordsTab('cashouts'));
  await checkFree('#recordsList', 'Ledger, Cash Outs');
  hWit.release();
  ok(await until(() => /No cash-outs yet|Cash out/.test(document.getElementById('recordsList').textContent) && !document.querySelector('#recordsList canvas'), null, 6000), 'Ledger, Cash Outs: the list replaces the orb');
  await ev(() => closeOverlay());

  // ---- My Team: a level's members
  const hTeam = await hold('**/k7x2/team/members**');
  await ev(() => switchTab('team'));
  await ev(() => { openTeamLevel(1); });   // not awaited: the page is waiting for the held request, and so would the test
  await checkFree('#teamLevelList', 'My Team'); await shot('my-team-loading');
  hTeam.release();
  ok(await until(() => /No Level 1 members yet|member/.test(document.getElementById('teamLevelList').textContent) && !document.querySelector('#teamLevelList canvas'), null, 6000), 'My Team: the list replaces the orb');
  await ev(() => closeOverlay());

  // ---- Task Center
  const hTask = await hold('**/k7x2/salary/status');
  await ev(() => switchTab('rewards')); await ev(() => openOverlay('taskcenter'));
  await checkFree('#taskCenterList', 'Task Center');
  hTask.release();
  ok(await until(() => !!document.querySelector('#taskCenterList .tk-card, #taskCenterList .empty, #taskCenterList [class*=tk]') && !document.querySelector('#taskCenterList canvas'), null, 6000), 'Task Center: the tiers replace the orb');
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
  ok(await until(() => /No AI robots running yet/.test(document.getElementById('mychocList').textContent) && !document.querySelector('#mychocList canvas'), null, 6000), 'My Products: the real answer replaces the orb');
  await ev(() => closeOverlay());
  for (const hh of [hInv, hBank, hTx, hAcc]) hh.hold();
  await forget();
  await ev(() => openOverlay('bindbank'));
  await checkFree('#bankList', 'Payout Account'); await shot('payout-account-loading');
  for (const hh of [hInv, hBank, hTx, hAcc]) hh.release();
  ok(await until(() => /No accounts bound yet/.test(document.getElementById('bankList').textContent) && !document.querySelector('#bankList canvas'), null, 6000), 'Payout Account: the real answer replaces the orb');
  await ev(() => closeOverlay());
  for (const hh of [hInv, hBank, hTx, hAcc]) hh.hold();
  await forget();
  await ev(() => openOverlay('earnings'));
  await checkFree('#earningsList', 'Accrued earnings');
  for (const hh of [hInv, hBank, hTx, hAcc]) hh.release();
  ok(await until(() => /No AI robots running yet/.test(document.getElementById('earningsList').textContent) && !document.querySelector('#earningsList canvas'), null, 6000), 'Accrued earnings: the real answer replaces the orb');
  await ev(() => closeOverlay());
  for (const hh of [hInv, hBank, hTx, hAcc]) hh.hold();
  await forget();
  await ev(() => { openOverlay('records'); setRecordsTab('accrued'); });
  await checkFree('#recordsList', 'Ledger, Accrued');
  for (const hh of [hInv, hBank, hTx, hAcc]) hh.release();
  ok(await until(() => !document.querySelector('#recordsList canvas') && /accrued|Completed/i.test(document.getElementById('recordsList').textContent), null, 6000), 'Ledger, Accrued: the real answer replaces the orb');
  await ev(() => closeOverlay());
  // a member who HAS the list sees it at once, never a loader
  await ev(() => { STATE.ok = { inv: false, bank: false, tx: false }; STATE.bankAccounts = [{ id: 'b1', holder: 'Test Holder', network: 'MTN Mobile Money', phone: '+256771234567', isDefault: true }]; });
  await ev(() => openOverlay('bindbank'));
  ok(await ev(() => !document.querySelector('#bankList canvas') && /Test Holder/.test(document.getElementById('bankList').textContent)), 'Payout Account: a phone that already holds the cards shows them at once, with no loader');
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
  ok(await ev(() => !!document.querySelector('#shopGrid canvas.orb-ld') && !!document.querySelector('#featStrip canvas.orb-ld') && !/No AI robots yet/.test(document.getElementById('shopGrid').textContent)), 'AI Robots and Home: the orb stands in until the robot list has come (never "no robots")');
  await ev(() => { PRODUCTS = window.__products; _productsOk = true; renderShop(); renderFeatured(); });
  ok(await ev(() => !document.querySelector('#shopGrid canvas') && document.querySelectorAll('#shopGrid .prod-card').length > 0), 'AI Robots: the robots replace the orb');

  // ---- all gone: nothing is left turning, the timer sleeps
  await sleep(300);
  ok(await ev(() => !document.querySelector('canvas.orb-ld') && !document.querySelector('.cm-spinner, .cm-spin-wrap')), 'when every page has its content there is no loader and no ring anywhere');
  ok(await ev(() => window._orbRaf === 0), 'and the loader timer is asleep again');
  ok(sheetReqs.length === 1, 'the sheet is fetched once for all of it (' + sheetReqs.length + ' request)');
  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  ok(serverErrors.length === 0, 'no server errors' + (serverErrors.length ? ': ' + serverErrors.slice(0, 2).join(' | ') : ''));
  await browser.close(); front.close();
  realLog('\n' + (fail ? 'FAIL' : 'PASS') + ': orb loader (' + pass + ' ok, ' + fail + ' failed)');
  process.exit(fail ? 1 : 0);
})().catch(e => { realLog('CRASH ' + (e && e.stack || e)); process.exit(1); });
