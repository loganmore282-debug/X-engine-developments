// "Show password" in the BUILT admin panel, in a real browser against the real server (fake MongoDB): the owner sees the Show password control and the
// password appears after confirming; a staff login does not get the control at all. Needs NODE_PATH=/opt/node-tools/node_modules.
const path = require('path'), Module = require('module'), http = require('http'), fs = require('fs');
const D = process.env.APPDIR || __dirname; process.chdir(D);
const fm = require(path.join(D, 'test-helpers', 'fake-mongodb.js'));
const o = Module._resolveFilename;
Module._resolveFilename = function (r, ...a) { return r === 'mongodb' ? path.join(D, 'test-helpers', 'fake-mongodb.js') : o.call(this, r, ...a); };
const BACK = 7800 + Math.floor(Math.random() * 100), FRONT = 7950 + Math.floor(Math.random() * 40);
process.env.PORT = String(BACK); process.env.MONGODB_URI = 'mongodb://fake/app'; process.env.ADMIN_KEY = 'pwview-ui-key-1234567890'; process.env.NODE_ENV = 'development';
process.env.POTATO_SECRETS_DIR = fs.mkdtempSync(path.join(require('os').tmpdir(), 'potato-pwvui-')); process.env.COOKIE_SECRETS_DIR = process.env.POTATO_SECRETS_DIR;
const L = console.log; console.log = () => {}; console.warn = () => {}; console.error = () => {};
require(path.join(D, 'server.js'));
const sleep = ms => new Promise(r => setTimeout(r, ms)), base = 'http://127.0.0.1:' + BACK;
const J = async (m, p, b, tok, adm) => { const r = await fetch(base + p, { method: m, headers: Object.assign({ 'content-type': 'application/json' }, tok ? { authorization: 'Bearer ' + tok } : {}, adm ? { authorization: 'Bearer ' + process.env.ADMIN_KEY } : {}), body: (b === undefined || m === 'GET') ? undefined : JSON.stringify(b) }); return { s: r.status, j: await r.json().catch(() => ({})) }; };
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png' };
const front = http.createServer((req, res) => {
  if (req.url.startsWith('/k7x2/')) { const p = http.request({ host: '127.0.0.1', port: BACK, path: req.url.slice(5), method: req.method, headers: Object.assign({}, req.headers, { host: '127.0.0.1:' + BACK }) }, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); }); p.on('error', () => { res.writeHead(502); res.end(); }); req.pipe(p); return; }
  let f = req.url.split('?')[0]; if (f === '/' || !/\.[a-z0-9]+$/i.test(f)) f = '/index.html';
  fs.readFile(path.join(D, 'admin', path.normalize(f).replace(/^(\.\.[\/\\])+/, '')), (e, b) => { if (e) { res.writeHead(404); res.end('nf'); return; } res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(b); });
});
const results = []; const check = (name, ok, extra) => { results.push([ok, name]); L((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  -- ' + extra : '')); };
(async () => {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/health')).ok) break; } catch (_) {} await sleep(250); }
  const pw = 'Visible pass 12'; const su = await J('POST', '/auth/signup', { phone: '0701234567', password: pw }); await J('POST', '/register', { pin: '123456', referralCode: '' }, su.j.token);
  await J('POST', '/admin/admins/create', { username: 'clerk1', password: 'Clerk password 9' }, null, true);
  await new Promise(r => front.listen(FRONT, '127.0.0.1', r));
  const { chromium } = require('playwright'); const br = await chromium.launch(); const errs = [];
  const open = async (user, secret) => {
    const ctx = await br.newContext({ viewport: { width: 1100, height: 900 }, serviceWorkers: 'block' }); const page = await ctx.newPage(); page.on('pageerror', e => errs.push(String(e.message)));
    await page.goto('http://127.0.0.1:' + FRONT + '/'); await page.waitForSelector('#keyInput', { timeout: 20000 });
    if (user) await page.fill('#userInput', user); await page.fill('#keyInput', secret); await page.click('#loginBtn'); await page.waitForSelector('[data-tab="users"]', { timeout: 20000 });
    await page.click('[data-tab="users"]'); await page.waitForSelector('#userRows tr[data-uid]', { timeout: 15000 }); await page.click('#userRows tr[data-uid]'); await page.waitForSelector('#modalRoot .kv, #modalRoot h3', { timeout: 15000 }); await sleep(800);
    return page;
  };
  let page = await open('', process.env.ADMIN_KEY);
  check('the owner sees the Show password control', !!(await page.$('#pwShowBtn')) && !!(await page.$('#pwShown')));
  check('the password is hidden until asked', (await page.inputValue('#pwShown')) === '');
  page.once('dialog', d => d.dismiss()); await page.click('#pwShowBtn'); await sleep(500); check('declining the confirmation shows nothing', (await page.inputValue('#pwShown')) === '');
  page.once('dialog', d => d.accept()); await page.click('#pwShowBtn'); await sleep(1500);
  check('after confirming, the owner sees the member\'s password', (await page.inputValue('#pwShown')) === pw, await page.inputValue('#pwShown'));
  check('a Copy button appears with it', await page.isVisible('#pwCopyBtn'));
  await page.context().close();
  page = await open('clerk1', 'Clerk password 9');
  check('a staff login has NO Show password control and no password field', !(await page.$('#pwShowBtn')) && !(await page.$('#pwShown')) && !/Show password/.test(await page.evaluate(() => document.getElementById('modalRoot').innerText)));
  check('no script errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  await br.close(); const bad = results.filter(r => !r[0]); L(bad.length ? 'PASSWORD VIEW UI: ' + bad.length + ' FAILED' : 'PASSWORD VIEW UI: ALL PASSED'); process.exit(bad.length ? 1 : 0);
})().catch(e => { L('CRASH ' + (e.stack || e)); process.exit(2); });
