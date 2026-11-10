'use strict';
// Robot categories (Class A, Class B, VIP ...): the admin makes, renames, orders and removes them and puts a product in one with one tap; the app shows "All" first and then
// the admin's tabs above the robots. REAL server + in-memory database; the member app and the admin panel are driven in a real browser.
//   node test-categories.js
const path = require('path'), Module = require('module'), http = require('http'), fs = require('fs');
process.chdir(__dirname);
const fm = require(path.join(__dirname, 'test-helpers', 'fake-mongodb.js'));
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...a) { return req === 'mongodb' ? path.join(__dirname, 'test-helpers', 'fake-mongodb.js') : origResolve.call(this, req, ...a); };
const BACK = 4100 + Math.floor(Math.random() * 400), FRONT = 4600 + Math.floor(Math.random() * 300), AFRONT = 4950 + Math.floor(Math.random() * 300);
const KEY = 'cat-admin-key-123456';
process.env.PORT = String(BACK); process.env.MONGODB_URI = 'mongodb://fake/app'; process.env.ADMIN_KEY = KEY; process.env.NODE_ENV = 'development';
process.env.POTATO_SECRETS_DIR = fs.mkdtempSync(path.join(require('os').tmpdir(), 'sa-cat-'));
const realLog = console.log, serverErrors = [];
console.log = () => {}; console.warn = () => {}; console.error = (...a) => { serverErrors.push(a.map(x => (x && x.message) || String(x)).join(' ').slice(0, 300)); };
require(path.join(__dirname, 'server.js'));
let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; realLog('  ok   - ' + m); } else { fail++; realLog('  FAIL - ' + m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const base = 'http://127.0.0.1:' + BACK;
const J = async (m, p, b, tok, adm) => { const r = await fetch(base + p, { method: m, headers: Object.assign({ 'content-type': 'application/json' }, tok ? { authorization: 'Bearer ' + tok } : {}, adm ? { authorization: 'Bearer ' + KEY } : {}), body: b ? JSON.stringify(b) : undefined }); let j = null; try { j = await r.json(); } catch (_) {} return { s: r.status, j }; };
const read = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
const proxy = (root, port) => http.createServer((req, res) => {
  if (req.url.startsWith('/k7x2/')) {
    const p = http.request({ host: '127.0.0.1', port: BACK, path: req.url.slice(5), method: req.method, headers: Object.assign({}, req.headers, { host: '127.0.0.1:' + BACK }) }, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    p.on('error', () => { res.writeHead(502); res.end(); }); req.pipe(p); return;
  }
  let f = req.url.split('?')[0]; if (f === '/' || !/\.[a-z0-9]+$/i.test(f)) f = '/index.html';
  fs.readFile(path.join(root, path.normalize(f).replace(/^(\.\.[\/\\])+/, '')), (e, buf) => { if (e) { res.writeHead(404); res.end('nf'); return; } res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(buf); });
});
// ---- the code
const app = read('user-src/original_module.js'), page = read('user-src/index.html');
ok(!/Every robot pays a daily reward until it matures/.test(page) && !/<div class="view-title">AI Robots<\/div>/.test(page), 'the "AI Robots" title and the "Every robot pays a daily reward..." line are gone from the AI Robots page');
ok(/id="shopCats"/.test(page) && /function renderShopTabs\(\)/.test(app) && /\{ id: '', name: 'All' \}/.test(app), 'the tabs row is there and "All" is the built-in first tab');
(async () => {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/health')).ok) break; } catch (_) {} await sleep(250); }
  await J('POST', '/admin/products/add-starters', {}, null, true);
  const prods = (await J('GET', '/public/products')).j.products.sort((a, b) => a.price - b.price);
  ok(prods.length >= 10 && (await J('GET', '/public/products')).j.categories.length === 0, 'to start with there are products and no categories (everything is in All)');
  // ---- the admin's routes
  const noKey = await J('POST', '/admin/categories/save', { categories: [{ id: '', name: 'Class A' }] });
  ok(noKey.s === 401, 'saving categories needs the admin key');
  for (const [bad, why] of [[[{ id: '', name: 'All' }], '"All" is built in'], [[{ id: '', name: 'A' }, { id: '', name: 'a' }], 'the same name twice'], [[{ id: '', name: '   ' }], 'an empty name'], [[{ id: '', name: 'x'.repeat(31) }], 'a name over 30 characters'],
    [Array.from({ length: 13 }, (_, i) => ({ id: '', name: 'C' + i })), 'more than 12'], [[{ id: '', name: 5 }], 'a name that is not text'], ['nope', 'not a list']]) {
    const r = await J('POST', '/admin/categories/save', { categories: bad }, null, true); ok(r.s === 400, 'refused: ' + why);
  }
  let r = await J('POST', '/admin/categories/save', { categories: [{ id: '', name: 'Class A' }, { id: '', name: 'Class B' }, { id: '', name: 'VIP' }] }, null, true);
  ok(r.s === 200 && r.j.categories.length === 3 && r.j.categories.every(c => /^c[0-9a-f]{8}$/.test(c.id)), 'three categories are made, each with its own id');
  let [A, B, V] = r.j.categories;
  let pub = (await J('GET', '/public/products')).j;
  ok(pub.categories.map(c => c.name).join() === 'Class A,Class B,VIP', 'members get the categories in the admin\'s order');
  // putting products in categories
  const k = prods.slice(0, 5).map(p => p.key);
  for (const [key, cat] of [[k[0], A.id], [k[1], A.id], [k[2], B.id], [k[3], V.id]]) { const m = await J('POST', '/admin/products/category', { key, category: cat }, null, true); ok(m.s === 200, 'one tap puts ' + key + ' in its category'); }
  ok((await J('POST', '/admin/products/category', { key: k[4], category: 'nope' }, null, true)).s === 400, 'a category that does not exist is refused');
  ok((await J('POST', '/admin/products/category', { key: 'no-such', category: A.id }, null, true)).s === 404, 'a product that does not exist is refused');
  ok((await J('POST', '/admin/products/category', { key: k[0], category: A.id })).s === 401, 'moving a product needs the admin key');
  await sleep(50); pub = (await J('GET', '/public/products')).j;
  const inCat = id => pub.products.filter(p => p.category === id).map(p => p.key).sort().join();
  ok(inCat(A.id) === [k[0], k[1]].sort().join() && inCat(B.id) === k[2] && inCat(V.id) === k[3], 'the public list says which product is in which category');
  ok(pub.products.length === prods.length, 'every product is still in All (nothing was moved out)');
  // saving a product from its editor does not move it
  const edit = pub.products.find(p => p.key === k[0]);
  await J('POST', '/admin/products/save', { products: [{ key: edit.key, name: edit.name + ' x', price: edit.price, cycle: edit.cycle, multiplier: edit.multiplier || 3, order: edit.order }] }, null, true);
  ok((await J('GET', '/public/products')).j.products.find(p => p.key === k[0]).category === A.id, 'saving a product from its editor keeps its category');
  // rename + reorder + remove
  r = await J('POST', '/admin/categories/save', { categories: [{ id: V.id, name: 'VIP 1' }, { id: A.id, name: 'Class A' }, { id: B.id, name: 'Class B' }] }, null, true);
  ok(r.s === 200 && r.j.categories.map(c => c.name).join() === 'VIP 1,Class A,Class B' && r.j.categories[0].id === V.id, 'a category can be renamed and moved: the id stays, so does its products');
  pub = (await J('GET', '/public/products')).j; ok(pub.products.find(p => p.key === k[3]).category === V.id && pub.categories[0].name === 'VIP 1', 'and the product is still in the renamed category');
  r = await J('POST', '/admin/categories/save', { categories: [{ id: V.id, name: 'VIP 1' }, { id: B.id, name: 'Class B' }] }, null, true);
  ok(r.s === 200 && r.j.moved === 2, 'removing Class A sends its two products back to All only');
  pub = (await J('GET', '/public/products')).j; ok(pub.products.find(p => p.key === k[0]).category === '' && pub.products.length === prods.length, 'they are still there, with no category');
  r = await J('POST', '/admin/categories/save', { categories: [{ id: V.id, name: 'VIP 1' }, { id: B.id, name: 'Class B' }, { id: '', name: 'Class A' }] }, null, true);
  const A2 = r.j.categories[2]; ok(A2.id !== A.id, 'a new category with an old name is a new category');

  // ---- the member app
  const front = proxy(path.join(__dirname, 'user'), FRONT); await new Promise(rs => front.listen(FRONT, '127.0.0.1', rs));
  const su = await J('POST', '/auth/signup', { phone: '0771234567', password: 'secret12' }); await J('POST', '/register', { pin: '123456', referralCode: '' }, su.j.token);
  const { chromium } = require('playwright'); const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 360, height: 760 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  await ctx.addInitScript(() => { window._smartaiLoaderMinMs = 0; });
  const pg = await ctx.newPage(); const errs = [];
  pg.on('pageerror', e => errs.push('pageerror: ' + String(e.message || e).slice(0, 200)));
  pg.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR|Content Security Policy|Function\(/.test(m.text())) errs.push('console: ' + m.text().slice(0, 200)); });
  const ev = (fn, a) => pg.evaluate(fn, a), until = async (fn, a, ms) => { try { await pg.waitForFunction(fn, a, { timeout: ms || 8000 }); return true; } catch (_) { return false; } };
  await pg.goto('http://127.0.0.1:' + FRONT + '/', { waitUntil: 'domcontentloaded' });
  await until(() => document.getElementById('authScreen').style.display === 'flex');
  await pg.fill('#fPhone', '771234567'); await pg.fill('#fPass', 'secret12'); await pg.click('#authGo');
  ok(await until(() => document.getElementById('app').style.display === 'block', null, 15000), 'a member signs in');
  await ev(() => { try { dismissAnnouncement(); } catch (e) {} try { dismissInstallSheet(); } catch (e) {} });
  await ev(() => switchTab('shop')); await sleep(300);
  const tabs = () => ev(() => [...document.querySelectorAll('#shopCats .cat-tab')].map(b => b.textContent + (b.classList.contains('active') ? '*' : '')));
  const cards = () => ev(() => [...document.querySelectorAll('#shopGrid .prod-card')].map(c => c.id.replace('prodCard-', '')));
  ok((await tabs()).join() === 'All*,VIP 1,Class B,Class A', 'AI Robots shows All first (selected), then the admin\'s tabs in his order: ' + (await tabs()).join(' | '));
  ok((await cards()).length === prods.length, 'All shows every robot');
  const ranks = await ev(() => [...document.querySelectorAll('#shopGrid .prod-rank')].map(x => x.textContent));
  await ev(() => document.querySelector('#shopCats .cat-tab[data-cat]:nth-child(3)').click()); await sleep(150);
  ok((await tabs()).join() === 'All,VIP 1,Class B*,Class A' && (await cards()).join() === k[2], 'tapping Class B shows only the robots in Class B');
  const rank2 = await ev(() => document.querySelector('#shopGrid .prod-rank').textContent);
  ok(rank2 === ranks[prods.findIndex(p => p.key === k[2])], 'the robot keeps its own number in a category (' + rank2 + ')');
  await ev(() => document.querySelector('#shopCats .cat-tab[data-cat]:nth-child(4)').click()); await sleep(150);
  ok((await cards()).length === 0 && /No AI robots in this category yet/.test(await ev(() => document.getElementById('shopGrid').textContent)), 'a category with no robot says so');
  await ev(() => document.querySelector('#shopCats .cat-tab:first-child').click()); await sleep(150);
  ok((await cards()).length === prods.length, 'All brings every robot back');
  if (process.env.SHOTS) { await ev(() => document.querySelector('#shopCats .cat-tab[data-cat]:nth-child(3)').click()); await sleep(200); await ev(() => window.scrollTo(0, 0)); await pg.screenshot({ path: process.env.SHOTS + '/shop-tabs.png' }); await ev(() => document.querySelector('#shopCats .cat-tab:first-child').click()); }
  // no categories at all: no tabs
  await J('POST', '/admin/categories/save', { categories: [] }, null, true);
  const pg2 = await ctx.newPage(); await pg2.goto('http://127.0.0.1:' + FRONT + '/', { waitUntil: 'domcontentloaded' });
  await pg2.waitForFunction(() => document.getElementById('app').style.display === 'block', null, { timeout: 15000 });
  await pg2.evaluate(() => { try { dismissAnnouncement(); } catch (e) {} try { dismissInstallSheet(); } catch (e) {} switchTab('shop'); });
  ok(await pg2.evaluate(() => getComputedStyle(document.getElementById('shopCats')).display === 'none') && await pg2.evaluate(() => document.querySelectorAll('#shopGrid .prod-card').length) === prods.length, 'with no category made there are no tabs and every robot is listed');
  // restore three for the admin-panel part
  r = await J('POST', '/admin/categories/save', { categories: [{ id: '', name: 'Class A' }, { id: '', name: 'Class B' }] }, null, true);

  // ---- the admin panel, driven by hand
  const afront = proxy(path.join(__dirname, 'admin'), AFRONT); await new Promise(rs => afront.listen(AFRONT, '127.0.0.1', rs));
  const actx = await browser.newContext({ viewport: { width: 420, height: 900 }, serviceWorkers: 'block' }); const ap = await actx.newPage(); const aerrs = [];
  ap.on('pageerror', e => aerrs.push(String(e.message || e)));
  let dialogs = 0; ap.on('dialog', d => { dialogs++; d.accept(); });
  await ap.goto('http://127.0.0.1:' + AFRONT + '/', { waitUntil: 'domcontentloaded' }); await sleep(500);
  await ap.fill('#keyInput', KEY); await ap.click('#loginBtn'); await sleep(1200);
  await ap.click('[data-tab="products"]'); await ap.waitForSelector('#catAdd', { timeout: 10000 });
  const names = () => ap.evaluate(() => [...document.querySelectorAll('.cat-name')].map(i => i.value));
  ok((await names()).join() === 'Class A,Class B', 'Admin > Products shows the Categories card with the two categories');
  if (process.env.SHOTS) { const sl = ap.locator('[data-catof]').first(); await ap.screenshot({ path: process.env.SHOTS + '/admin-categories.png' }); }
  await ap.fill('#catNew', 'VIP'); await ap.click('#catAdd'); await ap.waitForFunction(() => document.querySelectorAll('.cat-name').length === 3, null, { timeout: 8000 });
  ok((await names()).join() === 'Class A,Class B,VIP', 'a category is added from the card');
  await ap.click('[data-catup="2"]'); await ap.waitForFunction(() => document.querySelector('.cat-name').value === 'Class A' && document.querySelectorAll('.cat-name')[1].value === 'VIP', null, { timeout: 8000 });
  ok((await names()).join() === 'Class A,VIP,Class B', 'the up arrow moves a category up');
  const first = ap.locator('.cat-name').first(); await first.fill('Class Alpha'); await first.dispatchEvent('change');
  await ap.waitForFunction(() => document.querySelector('.cat-name').value === 'Class Alpha', null, { timeout: 8000 }); await sleep(300);
  ok((await names())[0] === 'Class Alpha', 'a name is edited in place');
  const sel = ap.locator('[data-catof]').first(); const firstKey = await sel.getAttribute('data-catof');
  const opts = await sel.locator('option').allTextContents(); ok(opts[0] === 'Category: All only' && opts.length === 4, 'every product card has a category box (All only + the three categories)');
  await sel.selectOption({ label: 'VIP' }); await sleep(600);
  const vipId = (await J('GET', '/public/products')).j.categories.find(c => c.name === 'VIP').id;
  ok((await J('GET', '/public/products')).j.products.find(p => p.key === firstKey).category === vipId, 'choosing a category in the box puts the product there at once');
  await ap.click('[data-catrm="1"]'); await ap.waitForFunction(() => document.querySelectorAll('.cat-name').length === 2, null, { timeout: 8000 });
  ok(dialogs >= 1 && (await names()).join() === 'Class Alpha,Class B', 'Remove asks first, then the category is gone');
  ok((await J('GET', '/public/products')).j.products.find(p => p.key === firstKey).category === '', 'and its product is back in All only');
  ok(aerrs.length === 0, 'the admin panel raised no errors' + (aerrs.length ? ': ' + aerrs.join(' | ') : ''));
  ok(errs.length === 0, 'the member app raised no errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  ok(serverErrors.length === 0, 'no server errors' + (serverErrors.length ? ': ' + serverErrors.slice(0, 2).join(' | ') : ''));
  await browser.close(); front.close(); afront.close();
  realLog('\n' + (fail ? 'FAIL' : 'PASS') + ': robot categories (' + pass + ' ok, ' + fail + ' failed)'); process.exit(fail ? 1 : 0);
})().catch(e => { realLog('CRASH ' + (e && e.stack || e)); process.exit(1); });
