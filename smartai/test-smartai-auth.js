'use strict';
// Sign-in and sign-up, with things going wrong, in a real phone-sized Chromium against the REAL server.js on the in-memory database.
// The property defended throughout: whatever goes wrong (wrong password, no network, a server error, a slow answer, a double tap, a sign-up that
// stopped half way, a locked account), a member is never left on a dead spinner or an unchanged screen with nothing said: every attempt ends with
// the app open, or the sign-in screen showing a plain sentence and a button that can be tapped again.
//   node test-smartai-auth.js
const path = require('path'), Module = require('module'), http = require('http'), fs = require('fs');
process.chdir(__dirname);
const fm = require(path.join(__dirname, 'test-helpers', 'fake-mongodb.js'));
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...a) { return req === 'mongodb' ? path.join(__dirname, 'test-helpers', 'fake-mongodb.js') : origResolve.call(this, req, ...a); };
const BACK = 5100 + Math.floor(Math.random() * 400), FRONT = 5600 + Math.floor(Math.random() * 400);
process.env.PORT = String(BACK); process.env.MONGODB_URI = 'mongodb://fake/app'; process.env.ADMIN_KEY = 'auth-test-admin-key-123456'; process.env.NODE_ENV = 'development';
process.env.POTATO_SECRETS_DIR = fs.mkdtempSync(path.join(require('os').tmpdir(), 'sa-auth-'));
const realLog = console.log, serverErrors = [];
console.log = () => {}; console.warn = () => {}; console.error = (...a) => { serverErrors.push(a.map(x => (x && x.message) || String(x)).join(' ').slice(0, 300)); };
require(path.join(__dirname, 'server.js'));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; realLog('  ok   - ' + m); } else { fail++; realLog('  FAIL - ' + m); } };
const base = 'http://127.0.0.1:' + BACK, ADMIN = 'Bearer auth-test-admin-key-123456';
const J = async (m, p, b, tok, adm) => { const r = await fetch(base + p, { method: m, headers: Object.assign({ 'content-type': 'application/json' }, tok ? { authorization: 'Bearer ' + tok } : {}, adm ? { authorization: ADMIN } : {}), body: b ? JSON.stringify(b) : undefined }); let j = null; try { j = await r.json(); } catch (_) {} return { s: r.status, j }; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
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
let phoneN = 0; const ph = () => '07' + String(70500000 + (++phoneN) * 41).padStart(8, '0').slice(-8);
const asLocal = p => p.replace(/^0/, '');
async function member() {
  const phone = ph(), su = await J('POST', '/auth/signup', { phone, password: 'secret12' });
  const reg = await J('POST', '/register', { pin: '123456', referralCode: '' }, su.j.token);
  return { tok: su.j.token, uid: su.j.uid, code: reg.j.referralCode, phone };
}
const userByPhone = phone => [...fm.__stores.users.values()].find(u => String(u.phone || '').replace(/\D/g, '').slice(-9) === phone.replace(/\D/g, '').slice(-9));

(async () => {
  for (let i = 0; i < 60; i++) { try { const h = await fetch(base + '/health'); if (h.ok) break; } catch (_) {} await sleep(250); }
  await J('POST', '/admin/settings/update', { settings: { welcomeBonus: 7000 } }, null, true);
  await new Promise(r => front.listen(FRONT, '127.0.0.1', r));
  const { chromium } = require('playwright'); const browser = await chromium.launch();
  const url = 'http://127.0.0.1:' + FRONT + '/';
  const errs = [];
  async function fresh(hash) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
    await ctx.addInitScript(() => { window._smartaiLoaderMinMs = 0; });
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push('pageerror: ' + String(e.message || e).slice(0, 200)));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR|Content Security Policy|Function\(/.test(m.text())) errs.push('console: ' + m.text().slice(0, 200)); });
    await page.goto(url + (hash || ''), { waitUntil: 'domcontentloaded' });
    const t = { ctx, page,
      until: async (fn, arg, ms) => { try { await page.waitForFunction(fn, arg, { timeout: ms || 8000 }); return true; } catch (_) { return false; } },
      toast: () => page.evaluate(() => document.getElementById('toast').textContent),
      appOpen: () => page.evaluate(() => document.getElementById('app').style.display === 'block'),
      btn: () => page.evaluate(() => { const b = document.getElementById('authGo'); return { text: b.textContent.trim(), disabled: b.disabled }; }),
      errLine: () => page.evaluate(() => { const e = document.getElementById('authErr'); return e.style.display === 'none' ? '' : e.textContent; }),
      mode: () => page.evaluate(() => document.getElementById('authTitle').textContent) };
    await t.until(() => document.getElementById('authScreen').style.display === 'flex');
    t.login = async (phone, pw) => { await page.fill('#fPhone', asLocal(phone)); await page.fill('#fPass', pw); await page.click('#authGo'); };
    return t;
  }
  // after a failed attempt: the sentence is on screen and the button is tappable again, within a few seconds
  const settled = async (t, ms) => { const end = Date.now() + (ms || 6000); while (Date.now() < end) { const b = await t.btn(); if (!b.disabled && b.text !== 'Please wait…' && !/Please wait/.test(b.text)) return b; await sleep(100); } return await t.btn(); };

  const M1 = await member();
  // ---- 1. wrong password, unknown number ----
  { const t = await fresh();
    await t.login(M1.phone, 'wrongpass1');
    ok(await t.until(() => /Incorrect phone number or password/.test(document.getElementById('toast').textContent)), 'a wrong password says so in plain words');
    const b = await settled(t); ok(!b.disabled && b.text === 'Continue' && !await t.appOpen() && /Incorrect/.test(await t.errLine()), 'and the button is ready again, the app stays shut, the sentence stays under the boxes');
    await t.login(ph(), 'secret12');
    ok(await t.until(() => /Incorrect phone number or password/.test(document.getElementById('toast').textContent)), 'a number nobody signed up with gets the same sentence (it does not say which part was wrong)');
    await t.login(M1.phone, 'secret12');
    ok(await t.until(() => document.getElementById('app').style.display === 'block'), 'the right password then opens the app on the same screen');
    await t.ctx.close(); }

  // ---- 2. no network, a server error, too many attempts ----
  { const t = await fresh(), page = t.page;
    await page.route('**/k7x2/auth/login', r => r.abort());
    await t.login(M1.phone, 'secret12');
    ok(await t.until(() => /Could not reach the server/.test(document.getElementById('toast').textContent)), 'no network: it says it could not reach the server');
    let b = await settled(t); ok(!b.disabled && b.text === 'Continue' && !await t.appOpen(), 'no network: the button is tappable again (no dead spinner)');
    await page.unroute('**/k7x2/auth/login');
    await page.route('**/k7x2/auth/login', r => r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ status: 'error', message: 'boom' }) }));
    await sleep(2700); await page.click('#authGo');
    ok(await t.until(() => /Something went wrong, try again/.test(document.getElementById('toast').textContent)), 'a server error says something went wrong, never the raw text');
    b = await settled(t); ok(!b.disabled && b.text === 'Continue', 'a server error: the button is tappable again');
    await page.unroute('**/k7x2/auth/login');
    await page.route('**/k7x2/auth/login', r => r.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ status: 'error', code: 'TOO_MANY_ATTEMPTS', message: 'Too many attempts. Try again in 5 minutes.' }) }));
    await sleep(2700); await page.click('#authGo');
    ok(await t.until(() => /Too many attempts/.test(document.getElementById('toast').textContent)), 'too many attempts shows the server\'s own sentence');
    await page.unroute('**/k7x2/auth/login');
    await sleep(2700); await page.click('#authGo');
    ok(await t.until(() => document.getElementById('app').style.display === 'block'), 'once the connection is back the same screen signs in without a reload');
    await t.ctx.close(); }

  // ---- 3. a slow answer and a double tap ----
  { const t = await fresh(), page = t.page; let calls = 0;
    await page.route('**/k7x2/auth/login', async r => { calls++; await sleep(1500); r.continue(); });
    await t.login(M1.phone, 'secret12');
    await sleep(300);
    const mid = await t.btn(); ok(mid.disabled && /Please wait/.test(mid.text), 'while it waits the button says Please wait and cannot be tapped');
    await page.evaluate(() => { document.getElementById('authGo').click(); document.getElementById('authGo').click(); });
    ok(await t.until(() => document.getElementById('app').style.display === 'block', null, 10000), 'a slow answer still ends with the app open');
    ok(calls === 1, 'three taps while it waited sent ONE sign-in request (' + calls + ')');
    await t.ctx.close(); }

  // ---- 4. a sign-up that stops half way is finished by trying again ----
  { const t = await fresh(), page = t.page; const phone = ph(); let regCalls = 0, fail1 = true;
    await page.route('**/k7x2/register', r => { regCalls++; if (fail1) return r.abort(); r.continue(); });
    await page.click('#authSwitchBtn');
    ok(await t.until(() => document.getElementById('regPinField').style.display === 'block'), 'Create Account opens from the sign-in screen');
    await page.fill('#fPhone', asLocal(phone)); await page.fill('#fPass', 'secret12'); await page.fill('#fPassConfirm', 'secret12'); await page.fill('#fPin', '246810');
    await page.click('#authGo');
    // (the profile step is safe to repeat, so the app asks up to three times, 0 / 2.5 / 6 s apart, before it gives up)
    ok(await t.until(() => /Could not|try again|connection/i.test(document.getElementById('toast').textContent) || document.getElementById('authErr').style.display !== 'none', null, 16000) && regCalls === 3, 'the profile step failing is asked three times and then says so (' + regCalls + ' asks)');
    const b = await settled(t); ok(!b.disabled && b.text === 'Create Account' && !await t.appOpen(), 'and the sign-up button is ready to try again');
    ok(!!userByPhone(phone) === false || (userByPhone(phone) || {}).registrationDone !== true, 'the account is not marked finished on the server');
    fail1 = false; await sleep(2700);
    await page.fill('#fPassConfirm', 'secret12'); await page.fill('#fPin', '246810');
    await page.click('#authGo');
    ok(await t.until(() => document.getElementById('app').style.display === 'block', null, 10000), 'trying again with the same number and password finishes the sign-up and opens the app');
    const u = userByPhone(phone);
    ok(u && u.walletBalance === 7000 && fm.__stores.users.size > 0 && [...fm.__stores.users.values()].filter(x => String(x.phone || '').slice(-9) === asLocal(phone)).length === 1, 'one account, the welcome gift paid once (UGX ' + (u && u.walletBalance) + ')');
    await t.ctx.close(); }

  // ---- 5. a wrong invitation code does not stop a sign-up ----
  { const t = await fresh('#/inviteRegister?invitecode=ZZZZ99'), page = t.page; const phone = ph();
    ok(await t.mode() === 'Create your account' && await page.evaluate(() => document.getElementById('fCode').value) === 'ZZZZ99', 'an invitation link fills the code in');
    await page.fill('#fPhone', asLocal(phone)); await page.fill('#fPass', 'secret12'); await page.fill('#fPassConfirm', 'secret12'); await page.fill('#fPin', '135790');
    await page.click('#authGo');
    ok(await t.until(() => document.getElementById('app').style.display === 'block', null, 10000), 'a code nobody owns is dropped and the account is made without an upline');
    ok(!!userByPhone(phone) && userByPhone(phone).registrationDone !== false, 'the account exists and is finished');
    await t.ctx.close(); }

  // ---- 6. Create Account with a number that already has an account ----
  { const t = await fresh('#/inviteRegister?invitecode=ABCDEF'), page = t.page;
    await page.fill('#fPhone', asLocal(M1.phone)); await page.fill('#fPass', 'not-their-password'); await page.fill('#fPassConfirm', 'not-their-password'); await page.fill('#fPin', '123123');
    await page.click('#authGo');
    ok(await t.until(() => /already has an account/.test(document.getElementById('toast').textContent)), 'someone else\'s number: it says the number already has an account');
    ok(await t.until(() => document.getElementById('regPinField').style.display === 'none') && await page.evaluate(() => document.getElementById('fPass').value) === '' && !await t.appOpen(), 'and the screen switches to Sign In with the password box emptied');
    await t.ctx.close(); }

  // ---- 7. an account whose sign-up was never finished ----
  { const phone = ph(); await J('POST', '/auth/signup', { phone, password: 'secret12' });
    const t = await fresh(), page = t.page;
    await t.login(phone, 'secret12');
    ok(await t.until(() => /sign-up was not finished/i.test(document.getElementById('toast').textContent)), 'signing in to an unfinished account says the sign-up was not finished');
    ok(await t.until(() => document.getElementById('regPinField').style.display === 'block') && !await t.appOpen(), 'and Create Account opens by itself');
    await page.fill('#fPassConfirm', 'secret12'); await page.fill('#fPin', '121212'); await page.click('#authGo');
    ok(await t.until(() => document.getElementById('app').style.display === 'block', null, 10000), 'finishing it there opens the app');
    await t.ctx.close(); }

  // ---- 8. a locked account ----
  { const L = await member(); userByPhone(L.phone).status = 'banned';
    const t = await fresh();
    await t.login(L.phone, 'secret12');
    ok(await t.until(() => /Account locked/i.test(document.getElementById('toast').textContent)), 'a banned member is told the account is locked');
    const b = await settled(t); ok(!b.disabled && !await t.appOpen() && /locked/i.test(await t.errLine()), 'and stays on the sign-in screen with the sentence');
    await t.ctx.close(); }

  // ---- 9. the app is reopened while the server cannot be reached ----
  { const t = await fresh(), page = t.page;
    await t.login(M1.phone, 'secret12');
    ok(await t.until(() => document.getElementById('app').style.display === 'block'), 'signed in');
    await page.waitForTimeout(1200);
    await page.route('**/k7x2/account', r => r.abort()); await page.route('**/k7x2/investments', r => r.abort());
    await page.reload({ waitUntil: 'domcontentloaded' });
    ok(await t.until(() => document.getElementById('app').style.display === 'block', null, 10000), 'reopened with no connection: the member is still signed in and the app opens from what it remembers');
    await page.waitForTimeout(2500);
    ok(await t.appOpen() && await page.evaluate(() => document.getElementById('authScreen').style.display !== 'flex'), 'and a dropped connection is not a reason to sign anybody out');
    await page.unroute('**/k7x2/account'); await page.unroute('**/k7x2/investments');
    await t.ctx.close(); }

  // ---- 10. no stray errors ----
  ok(errs.length === 0, 'no script error in any of these runs' + (errs.length ? ' -> ' + errs.slice(0, 3).join(' | ') : ''));
  const bad = serverErrors.filter(e => !/Login failed|Too many|ECONNRESET|aborted/i.test(e));
  ok(bad.length === 0, 'and the server logged no error' + (bad.length ? ' -> ' + bad.slice(0, 3).join(' | ') : ''));

  await browser.close(); front.close();
  realLog(fail ? fail + ' FAILED, ' + pass + ' passed' : 'PASS: sign-in and sign-up, with things going wrong (' + pass + ' checks)');
  process.exit(fail ? 1 : 0);
})().catch(e => { realLog('FATAL', e); process.exit(1); });
