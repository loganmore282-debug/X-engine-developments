'use strict';
// The Smart AI member app (ChocoMCC's pages in blue and white) driven in a real phone-sized Chromium against the REAL server.js on the in-memory
// database: sign up from an invitation link, log out and in, buy, daily check-in, gift code, payout cards, the compulsory Google Authenticator set-up and
// a cash-out with the Trade Password and the code, messages, team and Task Center, the ledger lists, a session the server ended, and the Back button.
//   node test-smartai-app.js
const path = require('path'), Module = require('module'), http = require('http'), fs = require('fs');
process.chdir(__dirname);
const fm = require(path.join(__dirname, 'test-helpers', 'fake-mongodb.js'));
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...a) { return req === 'mongodb' ? path.join(__dirname, 'test-helpers', 'fake-mongodb.js') : origResolve.call(this, req, ...a); };
const BACK = 4100 + Math.floor(Math.random() * 400), FRONT = 4600 + Math.floor(Math.random() * 400);
process.env.PORT = String(BACK); process.env.MONGODB_URI = 'mongodb://fake/app'; process.env.ADMIN_KEY = 'app-test-admin-key-123456'; process.env.NODE_ENV = 'development';
process.env.POTATO_SECRETS_DIR = fs.mkdtempSync(path.join(require('os').tmpdir(), 'sa-app-'));
const realLog = console.log, serverErrors = [];
console.log = () => {}; console.warn = () => {}; console.error = (...a) => { serverErrors.push(a.map(x => (x && x.message) || String(x)).join(' ').slice(0, 300)); };
require(path.join(__dirname, 'server.js'));
const totp = require('./totp');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; realLog('  ok   - ' + m); } else { fail++; realLog('  FAIL - ' + m); } };
const base = 'http://127.0.0.1:' + BACK, ADMIN = 'Bearer app-test-admin-key-123456';
const J = async (m, p, b, tok, adm) => { const r = await fetch(base + p, { method: m, headers: Object.assign({ 'content-type': 'application/json' }, tok ? { authorization: 'Bearer ' + tok } : {}, adm ? { authorization: ADMIN } : {}), body: b ? JSON.stringify(b) : undefined }); let j = {}; try { j = await r.json(); } catch (_) {} return { s: r.status, j }; };
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
let phoneN = 0; const ph = () => '07' + String(70400000 + (++phoneN) * 37).padStart(8, '0').slice(-8);
const asLocal = p => p.replace(/^0/, '');
async function member(ref) {
  const phone = ph(), su = await J('POST', '/auth/signup', { phone, password: 'secret12' });
  const reg = await J('POST', '/register', { pin: '123456', referralCode: ref || '' }, su.j.token);
  return { tok: su.j.token, uid: su.j.uid, code: reg.j.referralCode, phone };
}
(async () => {
  for (let i = 0; i < 60; i++) { try { const h = await fetch(base + '/health'); if (h.ok) break; } catch (_) {} await sleep(250); }
  await J('POST', '/admin/settings/update', { settings: { welcomeBonus: 7000, withdrawMethod: 'manual', withdrawOpenFrom: '00:00', withdrawOpenTo: '23:59', dailyCheckin: 250, minWithdraw: 8000, minDeposit: 30000,
    supportTelegram: 'https://t.me/help_acct', telegramGroup: 'https://t.me/grp_acct', rulesText: 'Be honest.\n\nOne account each.', supportHours: '9am – 6pm' } }, null, true);
  await J('POST', '/admin/salary/save', { tiers: [{ id: 'sx1', target: 20000, reward: 1500 }, { id: 'sx2', target: 9000000, reward: 9000 }] }, null, true);
  await J('POST', '/admin/products/add-starters', {}, null, true);
  const prods = (await J('GET', '/public/products')).j.products.filter(p => p.price > 0).sort((a, b) => a.price - b.price);
  const P1 = prods[0];
  await J('POST', '/admin/announcement-image/set', { image: 'data:image/webp;base64,' + fs.readFileSync(path.join(userDir, 'icons', 'robots.webp')).toString('base64') }, null, true);
  const A = await member('');                    // the upline: the invitation link of this member is used to sign up below
  await new Promise(r => front.listen(FRONT, '127.0.0.1', r));
  const { chromium } = require('playwright'); const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
  await ctx.addInitScript(() => { window._smartaiLoaderMinMs = 0; window._smartaiLoaderReadyMs = 0; });
  const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + String(e.message || e).slice(0, 200)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR|Content Security Policy|Function\(/.test(m.text())) errs.push('console: ' + m.text().slice(0, 200)); });
  const url = 'http://127.0.0.1:' + FRONT + '/';
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const until = async (fn, arg, ms) => { try { await page.waitForFunction(fn, arg, { timeout: ms || 8000 }); return true; } catch (_) { return false; } };
  const toastText = () => ev(() => document.getElementById('toast').textContent);
  const shown = id => ev(i => document.getElementById(i).classList.contains('show'), id);
  const appOpen = () => ev(() => document.getElementById('app').style.display === 'block');

  // ---- 1. sign up from an invitation link ----
  const newPhone = ph();
  await page.goto(url + '#/inviteRegister?invitecode=' + A.code, { waitUntil: 'domcontentloaded' });
  ok(await until(() => document.getElementById('authScreen').style.display === 'flex' && document.getElementById('authTitle').textContent.length > 0), 'a signed-out visitor sees the sign-in screen');
  ok(await ev(() => document.getElementById('authTitle').textContent) === 'Create your account' && await ev(() => document.getElementById('fCode').value) === await Promise.resolve(A.code), 'an invitation link opens Create Account with the code already typed');
  ok(await ev(() => ['regPassConfirmField', 'regPinField', 'regCodeField'].every(i => document.getElementById(i).style.display === 'block')), 'Create Account shows confirm password, the 6-digit Trade Password and the invitation code');
  await page.fill('#fPhone', asLocal(newPhone)); await page.fill('#fPass', 'secret12'); await page.fill('#fPassConfirm', 'different'); await page.fill('#fPin', '123456');
  await page.click('#authGo'); await sleep(250);
  ok(/do not match/i.test(await toastText()) && !await appOpen(), 'two different passwords are refused on the phone');
  await page.fill('#fPassConfirm', 'secret12'); await page.fill('#fPin', '12ab');
  await page.click('#authGo'); await sleep(250);
  ok(/6 digits/i.test(await toastText()) && !await appOpen(), 'a Trade Password that is not 6 digits is refused');
  await page.fill('#fPin', '123456'); await page.fill('#fPhone', '12345');
  await page.click('#authGo'); await sleep(250);
  ok(/valid Uganda mobile/i.test(await toastText()) && !await appOpen(), 'a number that is not a Uganda mobile is refused');
  await page.fill('#fPhone', asLocal(newPhone));
  await page.click('#authGo');
  ok(await until(() => document.getElementById('app').style.display === 'block', null, 15000), 'sign-up opens the app');
  ok(await until(() => document.getElementById('announcementBg').classList.contains('show'), null, 8000), 'the welcome picture opens when the app opens');
  await ev(() => dismissAnnouncement());
  ok(await until(() => document.getElementById('installSheetBg').classList.contains('show'), null, 9000), 'the install offer comes once, after the welcome picture, right after sign-up');
  await ev(() => dismissInstallSheet());
  ok(await ev(() => STATE.balance) === 7000, 'the welcome gift is in the wallet (UGX 7,000)');
  const upStats = await J('GET', '/team/stats', null, A.tok);
  ok(upStats.j.team && upStats.j.team.l1 === 1, 'the new member is on the inviter\'s Level 1 team');
  ok(await ev(() => document.querySelectorAll('#featStrip .choc-card').length) > 0 && await ev(() => document.querySelectorAll('#shopGrid .prod-card').length) === prods.length, 'Home lists the featured AI robots and AI Robots lists every one');
  ok(await ev(() => document.getElementById('acctPhone').textContent) === '0' + asLocal(newPhone).slice(0, 3) + ' ' + asLocal(newPhone).slice(3, 6) + ' ' + asLocal(newPhone).slice(6), 'Me shows the member\'s own number');

  // ---- 2. log out, wrong password, log in ----
  await ev(() => logout()); ok(await until(() => document.getElementById('authScreen').style.display === 'flex' && document.getElementById('app').style.display === 'none'), 'Sign Out returns to the sign-in screen');
  const gone = await J('GET', '/account', null, 'x'.repeat(43));
  ok(gone.s === 401, 'a made-up token is refused by the server');
  await page.fill('#fPhone', asLocal(newPhone)); await page.fill('#fPass', 'wrongpass1'); await page.click('#authGo'); await sleep(900);
  ok(/Incorrect phone number or password/.test(await ev(() => document.getElementById('authErr').textContent)) && !await appOpen(), 'a wrong password says so and stays on the sign-in screen');
  await page.fill('#fPass', 'secret12'); await page.click('#authGo');
  ok(await until(() => document.getElementById('app').style.display === 'block', null, 15000), 'the right password signs in');
  await sleep(500);
  ok(await until(() => document.getElementById('announcementBg').classList.contains('show'), null, 8000), 'the welcome picture comes again on the next sign-in');
  await ev(() => dismissAnnouncement());
  const me = await J('POST', '/auth/login', { phone: newPhone, password: 'secret12' });
  const MEtok = me.j.token;

  // ---- 3. buy ----
  await ev(() => switchTab('shop')); await sleep(300);
  await ev(k => buyProduct(null, k), P1.key); await sleep(600);
  ok(/Not enough balance/i.test(await toastText()), 'buying without enough money says so and takes nothing');
  await J('POST', '/admin/deposit', { userId: await ev(() => STATE.uid), amount: 200000, note: 'app test' }, null, true);
  await ev(() => refreshFromServer()); await ev(() => renderAll());
  ok(await ev(() => STATE.balance) === 207000, 'a credit made by the admin shows in the wallet');
  await page.click('#prodCard-' + P1.key + ' .btn-buy-glow'); await sleep(1500);
  ok(await ev(() => STATE.balance) === 207000 - P1.price && await ev(() => STATE.investments.length) === 1, 'Buy takes the price and the robot is running');
  await ev(() => openOverlay('mychoc')); await sleep(300);
  ok(await ev(() => document.querySelectorAll('#mychocList .choc-hold-card').length) === 1 && /0 \/ \d+ days/.test(await ev(() => document.getElementById('mychocList').textContent)), 'My Products lists it with its day counter');
  await ev(() => closeOverlay());

  // ---- 4. daily check-in ----
  await ev(() => switchTab('rewards')); await sleep(300);
  const before = await ev(() => STATE.balance);
  await page.click('#checkinBtn'); await sleep(1500);
  ok(await ev(() => STATE.balance) === before + 250 && await ev(() => STATE.checkinStreak) === 1, 'Check in pays the daily reward and starts the streak');
  ok(await ev(() => document.getElementById('checkinBtn').disabled) === true && /Claimed today/.test(await ev(() => document.getElementById('checkinBtn').textContent)), 'the button then reads Claimed today');
  const again = await J('POST', '/checkin', {}, MEtok);
  ok(again.s === 400 && again.j.code === 'ALREADY_CHECKED_IN', 'a second check-in the same day is refused by the server');
  const dbl = await Promise.all([1, 2, 3].map(() => J('POST', '/checkin', {}, A.tok)));
  ok(dbl.filter(r => r.s === 200).length === 1, 'three check-ins at the same instant pay once');

  // ---- 5. gift code ----
  const gen = await J('POST', '/admin/promocodes/generate', { minReward: 3000, maxReward: 3000, maxUses: 5 }, null, true);
  const code = gen.j.code; const bal0 = await ev(() => STATE.balance);
  await page.fill('#giftCodeInput', code); await page.click('#redeemBtn');
  ok(await until(() => document.getElementById('giftRevealBg').classList.contains('show'), null, 8000), 'a right gift code opens the reveal');
  await sleep(1300);
  ok(/3,000/.test(await ev(() => document.getElementById('giftRevealAmount').textContent)) && await ev(() => STATE.balance) === bal0 + 3000, 'the reveal counts up to the real reward and the wallet has it');
  await ev(() => closeGiftReveal());
  await page.fill('#giftCodeInput', code); await page.click('#redeemBtn'); await sleep(1200);
  ok(!await shown('giftRevealBg') && (await toastText()).length > 0 && await ev(() => STATE.balance) === bal0 + 3000, 'the same code again pays nothing and says why');
  await page.fill('#giftCodeInput', 'WRONGWRONG'); await page.click('#redeemBtn'); await sleep(1000);
  ok(!await shown('giftRevealBg'), 'a wrong code opens nothing');

  // ---- 6. payout accounts ----
  await ev(() => goBindBank(false)); await sleep(300);
  ok(await ev(() => document.getElementById('bankList').textContent.includes('No accounts bound')), 'Payout Account starts empty');
  await ev(() => openNetworkPicker()); await ev(() => pickNetwork('MTN Mobile Money'));
  await page.fill('#npName', 'App Tester'); await page.fill('#npPhone', 'abc'); await page.click('#npSaveBtn'); await sleep(300);
  ok(/valid Uganda mobile/i.test(await toastText()), 'a card number that is not a mobile is refused');
  await page.fill('#npPhone', '0772 000 111'); await page.click('#npSaveBtn'); await sleep(1200);
  ok(await ev(() => STATE.bankAccounts.length) === 1 && await ev(() => document.querySelectorAll('#bankList .bank-row').length) === 1, 'a card is saved and listed');
  await ev(() => openNetworkPicker()); await ev(() => pickNetwork('Airtel Money'));
  await page.fill('#npName', 'Second Card'); await page.fill('#npPhone', '0752000222'); await page.click('#npSaveBtn'); await sleep(1200);
  ok(await ev(() => STATE.bankAccounts.length) === 2, 'a second card is saved');
  const secondId = await ev(() => STATE.bankAccounts.filter(b => b.network === 'Airtel Money')[0].id);
  await ev(id => pickBankAccount(id), secondId); await sleep(1000);
  const list = await J('GET', '/bank/list', null, MEtok);
  ok(list.j.accounts.filter(b => b.isDefault).length === 1 && list.j.accounts.filter(b => b.isDefault)[0].id === secondId, 'tapping a card makes it the active one (on the server)');
  await ev(id => pickBankAccount(id), await ev(() => STATE.bankAccounts.filter(b => b.network === 'MTN Mobile Money')[0].id)); await sleep(900);
  await ev(() => closeOverlay());

  // ---- 7. cash out: Google Authenticator is compulsory ----
  await ev(() => openOverlay('withdraw')); await sleep(400);
  ok(await ev(() => document.getElementById('witGaNote').style.display !== 'none'), 'Cash Out says Google Authenticator is required before it is set up');
  await page.fill('#witAmt', '20000'); await sleep(200);
  ok(await ev(() => document.getElementById('witFee').textContent) === 'UGX 3,000' && await ev(() => document.getElementById('witNet').textContent) === 'UGX 17,000', 'the fee and what the member receives follow the setting (15%)');
  await page.fill('#witAmt', '500'); await page.click('#witGoBtn'); await sleep(300);
  ok(/Minimum cash-out/.test(await toastText()), 'an amount under the minimum is refused on the phone');
  await page.fill('#witAmt', '20000'); await page.click('#witGoBtn'); await sleep(300);
  ok(/Google Authenticator is required/.test(await toastText()), 'Request Cash Out without Google Authenticator says it is required');
  ok(await until(() => document.getElementById('ovAuthenticator').classList.contains('show'), null, 4000), 'and takes the member to the set-up page');
  await until(() => !!document.getElementById('gaPin'), null, 6000);
  await page.fill('#gaPin', '654321'); await page.click('#gaStartBtn'); await sleep(900);
  ok(/Incorrect Trade Password/i.test(await ev(() => document.getElementById('gaErr').textContent)), 'a wrong Trade Password is refused on the set-up page');
  await page.fill('#gaPin', '123456'); await page.click('#gaStartBtn');
  ok(await until(() => !!document.getElementById('gaKey'), null, 8000), 'the right Trade Password shows the setup key');
  const secret = (await ev(() => _ga.setup.secret));
  ok(/^[A-Z2-7]{32}$/.test(secret) && await ev(() => document.querySelectorAll('#gaQr svg path').length) === 1, 'the key is a 32-character base32 key and the setup picture is drawn on the phone');
  await page.fill('#gaCode', '000000'); await page.click('#gaConfirmBtn'); await sleep(900);
  ok((await ev(() => document.getElementById('gaErr').textContent)).length > 0, 'a wrong first code does not turn it on');
  await page.fill('#gaCode', totp.codeAt(secret)); await page.click('#gaConfirmBtn');
  ok(await until(() => document.querySelectorAll('.ga-codes span').length === 8, null, 8000), 'a right first code turns it on and shows 8 backup codes');
  await page.click('.ga-card .btn-primary'); await sleep(900);
  ok(await shown('ovWithdraw') && await ev(() => document.getElementById('witAmt').value) === '20000', 'after the set-up Cash Out opens again with the amount kept');
  ok(await ev(() => STATE.twofaEnabled) === true, 'the app knows Google Authenticator is on');
  // wrong Trade Password
  await page.click('#witGoBtn'); await until(() => document.getElementById('tradePinBg').classList.contains('show'), null, 4000);
  await page.fill('#tradePinInput', '111111'); await page.click('#tradePinOk');
  await until(() => document.getElementById('totpBg').classList.contains('show'), null, 4000);
  await page.fill('#totpInput', totp.codeAt(secret, Date.now() + 30000)); await page.click('#totpOk'); await sleep(1200);
  ok(/Incorrect Trade Password/i.test(await toastText()) && await ev(() => STATE.balance) === bal0 + 3000, 'a wrong Trade Password takes nothing');
  // right everything
  const balBefore = await ev(() => STATE.balance);
  await page.click('#witGoBtn'); await until(() => document.getElementById('tradePinBg').classList.contains('show'), null, 4000);
  await page.fill('#tradePinInput', '123456'); await page.click('#tradePinOk');
  await until(() => document.getElementById('totpBg').classList.contains('show'), null, 4000);
  await page.fill('#totpInput', totp.codeAt(secret, Date.now() + 30000)); await page.click('#totpOk');
  ok(await until(() => /Withdrawal submitted successfully/.test(document.getElementById('toast').textContent), null, 10000), 'a cash-out with the Trade Password and the code is submitted');
  await sleep(1500);
  ok(await ev(() => STATE.balance) === balBefore - 20000 && !await shown('ovWithdraw'), 'the wallet is debited and the page closes');
  const wl = await J('GET', '/withdrawals', null, MEtok);
  ok(wl.j.withdrawals && wl.j.withdrawals.length === 1 && wl.j.withdrawals[0].amount === 20000 && wl.j.withdrawals[0].net === 17000 && !('userId' in wl.j.withdrawals[0]) && !('payGw' in wl.j.withdrawals[0]), '/withdrawals lists it with only the fields the Ledger shows');
  await ev(() => openOverlay('records')); await ev(() => setRecordsTab('cashouts')); await sleep(1500);
  ok(/Settling/.test(await ev(() => document.getElementById('recordsList').textContent)) && /17,000/.test(await ev(() => document.getElementById('recordsList').textContent)), 'Ledger > Cash Outs shows it settling with the amount received');
  await ev(() => setRecordsTab('topups')); await sleep(1200);
  ok(/No top-ups yet/.test(await ev(() => document.getElementById('recordsList').textContent)), 'Ledger > Topups is empty for a member who has not paid by mobile money');
  await ev(() => setRecordsTab('accrued')); await sleep(500);
  const accrued = await ev(() => document.getElementById('recordsList').textContent);
  ok(/Daily reward/.test(accrued) && /Welcome gift/.test(accrued) && /Gift code/.test(accrued), 'Ledger > Accrued lists the daily reward, the welcome gift and the gift code');
  await ev(() => closeOverlay());
  const dr = await J('GET', '/deposits', null, MEtok);
  ok(dr.s === 200 && Array.isArray(dr.j.deposits), '/deposits answers');

  // ---- 8. messages ----
  await J('POST', '/admin/messages/save', { title: 'App test message', body: 'Line one\nLine two', id: '' }, null, true);
  await ev(() => refreshMessageBadge()); await sleep(800);
  ok(await ev(() => document.querySelector('.msg-badge').style.display) === 'flex' && await ev(() => document.querySelector('.msg-badge').textContent) === '1', 'a new message shows a count on Messages');
  await ev(() => switchTab('account')); await ev(() => openOverlay('messages')); await sleep(1500);
  ok(/App test message/.test(await ev(() => document.getElementById('messagesList').textContent)) && await ev(() => document.querySelector('.msg-badge').style.display) === 'none', 'opening Messages shows the message and clears the count');
  await ev(() => closeOverlay());

  // ---- 9. team and Task Center ----
  const L1 = await member(await ev(() => STATE.referralCode));
  await J('POST', '/admin/deposit', { userId: L1.uid, amount: 100000, note: 'app test' }, null, true);
  await J('POST', '/invest/create', { tierKey: P1.key }, L1.tok);
  await ev(() => switchTab('team')); await sleep(1500);
  ok(await ev(() => document.getElementById('teamL1').textContent) === '1' && /inviteRegister\?invitecode=/.test(await ev(() => document.getElementById('teamLink').textContent)), 'Team shows the Level 1 count and the invitation link');
  await ev(() => openTeamLevel(1)); await sleep(1200);
  ok(await ev(() => document.querySelectorAll('#teamLevelList .flat-row').length) === 1 && /\*\*\*\*/.test(await ev(() => document.getElementById('teamLevelList').textContent)), 'Level 1 lists the member with a hidden number');
  await ev(() => closeOverlay());
  await ev(() => openOverlay('taskcenter')); await sleep(1500);
  ok(await ev(() => document.querySelectorAll('#taskCenterList .tk-card').length) === 2 && await ev(() => document.querySelectorAll('#taskCenterList .tk-pill.is-ready').length) === 1, 'Task Center shows both tiers and the reached one can be claimed');
  const bT = await ev(() => STATE.balance);
  await page.click('#taskCenterList .tk-pill.is-ready'); await sleep(1800);
  ok(await ev(() => STATE.balance) === bT + 1500 && await ev(() => document.querySelectorAll('#taskCenterList .tk-pill.is-done').length) === 1, 'claiming pays the tier once and it reads Claimed');
  const tierIds = (await J('GET', '/salary/status', null, MEtok)).j.tiers.map(t => t.id);
  const claimAgain = await J('POST', '/salary/claim', { tierId: tierIds[0] }, MEtok);
  ok(claimAgain.s >= 400, 'claiming the same tier again is refused');
  await ev(() => closeOverlay());

  // ---- 10. support, rules, about, announcement ----
  await ev(() => openOverlay('support')); await sleep(300);
  ok(await ev(() => document.querySelectorAll('#supportLinks [data-open-url]').length) === 2 && /9am – 6pm/.test(await ev(() => document.getElementById('supportLinks').textContent)), 'Support lists the links the admin set and the hours');
  await ev(() => closeOverlay());
  await ev(() => openOverlay('rules')); await sleep(200);
  ok(/Be honest/.test(await ev(() => document.getElementById('rulesBody').textContent)), 'Terms & Rules shows the admin\'s text');
  await ev(() => closeOverlay());
  await ev(() => switchTab('shop')); await ev(() => switchTab('home')); await sleep(1500);
  ok(await shown('announcementBg'), 'with a welcome picture set, Home shows the announcement when it is entered from another tab');
  await ev(() => dismissAnnouncement());

  // ---- 11. the Back button closes a page instead of leaving the app ----
  await ev(() => switchTab('account')); await ev(() => openOverlay('about')); await sleep(300);
  ok(await shown('ovAbout'), 'About opens as a full page');
  await page.goBack(); await sleep(500);
  ok(!await shown('ovAbout') && await appOpen(), 'the Back button closes the page and the app stays open');
  await ev(() => openOverlay('records')); await ev(() => openOverlay('bindbank')); await sleep(200);
  await page.goBack(); await sleep(400);
  ok(!await shown('ovBindbank') && !await shown('ovRecords') && await appOpen(), 'one Back closes the page even when one page opened another');

  // ---- 12. a login the server ended ----
  const stale = await J('POST', '/auth/password/change', { oldPassword: 'secret12', newPassword: 'secret34' }, MEtok);
  ok(stale.s === 200, 'the password is changed from elsewhere (every session ends)');
  await ev(() => refreshFromServer());
  ok(await until(() => document.getElementById('authScreen').style.display === 'flex' && document.getElementById('app').style.display === 'none', null, 8000), 'the app goes back to the sign-in screen when the server ended the login');
  ok(/session ended/i.test(await toastText()), 'and says why');
  ok(await ev(() => sessionStorage.length) === 0 || !(await ev(() => Object.keys(sessionStorage).some(k => k.indexOf('smartai_state_') === 0))), 'no copy of the member\'s account is left on the phone');

  ok(errs.length === 0, 'no script error on any page' + (errs.length ? ': ' + JSON.stringify(errs.slice(0, 4)) : ''));
  ok(serverErrors.length === 0, 'the server logged no error' + (serverErrors.length ? ': ' + JSON.stringify(serverErrors.slice(0, 3)) : ''));
  await browser.close();
  realLog(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { realLog('CRASH', e && e.stack || e); process.exit(2); });
