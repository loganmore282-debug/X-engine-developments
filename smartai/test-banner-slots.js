'use strict';
// Every banner of the member app can be replaced from the admin panel (as in ChocoMCC, where the owner can upload all of them), end to end:
//   1. the three lists agree (server slots, the admin panel's cards, the app's pictures) and the app paints every banner from its own slot;
//   2. the real server stores, serves, and clears each slot (members and admin), refuses an unknown slot and a caller without the admin key;
//   3. a real phone-sized browser: with a picture uploaded for every slot, every banner on every page (Log In, Sign Up, Home, AI Robots, Rewards, Team, Me and its logo,
//      Add Funds, Cash Out, Support, About, Ledger, Payout Account) shows that picture, and falls back to the blue art when the picture is removed;
//   4. the admin panel in a real browser: the Banners tab lists the pictures in the order a member meets them (Login & Sign Up first, the Icons box last) and each Upload
//      button sends its own slot.
//   node test-banner-slots.js
const path = require('path'), Module = require('module'), http = require('http'), fs = require('fs'), zlib = require('zlib');
process.chdir(__dirname);
const fm = require(path.join(__dirname, 'test-helpers', 'fake-mongodb.js'));
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...a) { return req === 'mongodb' ? path.join(__dirname, 'test-helpers', 'fake-mongodb.js') : origResolve.call(this, req, ...a); };
const BACK = 4100 + Math.floor(Math.random() * 400), FRONT = 4600 + Math.floor(Math.random() * 400);
process.env.PORT = String(BACK); process.env.MONGODB_URI = 'mongodb://fake/app'; process.env.ADMIN_KEY = 'banner-test-admin-key-123456'; process.env.NODE_ENV = 'development';
process.env.POTATO_SECRETS_DIR = fs.mkdtempSync(path.join(require('os').tmpdir(), 'sa-ban-'));
const realLog = console.log, serverErrors = [];
console.log = () => {}; console.warn = () => {}; console.error = (...a) => { serverErrors.push(a.map(x => (x && x.message) || String(x)).join(' ').slice(0, 300)); };
require(path.join(__dirname, 'server.js'));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; realLog('  ok   - ' + m); } else { fail++; realLog('  FAIL - ' + m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const base = 'http://127.0.0.1:' + BACK;
const J = async (m, p, b, tok, adm) => { const r = await fetch(base + p, { method: m, headers: Object.assign({ 'content-type': 'application/json' }, tok ? { authorization: 'Bearer ' + tok } : {}, adm ? { authorization: 'Bearer banner-test-admin-key-123456' } : {}), body: b ? JSON.stringify(b) : undefined }); let j = null; try { j = await r.json(); } catch (_) {} return { s: r.status, j }; };
const read = f => fs.readFileSync(path.join(__dirname, f), 'utf8');

// a tiny, different PNG for every slot, so a picture can be told from any other
function crc(buf) { return zlib.crc32(buf) >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); }
function pngBuf(r, g, b) {
  const w = 8, h = 8, raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; } }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const dataUrl = (r, g, b) => 'data:image/png;base64,' + pngBuf(r, g, b).toString('base64');

// ---------------------------------------------------------------- 1. the three lists agree (no browser)
const server = read('server.js'), app = read('user-src/original_module.js'), adminSrc = read('admin-src/index.html'), page = read('user-src/index.html');
const listOf = (txt, re) => { const m = txt.match(re); return m ? [...m[1].matchAll(/'([a-z]+)'/g)].map(x => x[1]) : null; };
const serverSlots = listOf(server, /const SMARTAI_BANNER_SLOTS = \[([^\]]*)\]/);
const appSlots = listOf(app, /var ART_SLOTS = \[([^\]]*)\]/);
const adminSlots = [...adminSrc.matchAll(/\{ slot:'([a-z]+)', title:/g)].map(m => m[1]).concat('aboutbanner');   // About has its own card (banner + page text)
const sameSet = (a, b) => !!a && !!b && a.length === b.length && a.every(x => b.includes(x));
ok(serverSlots && serverSlots.length === 12, 'the server knows twelve member pictures (' + (serverSlots || []).join(', ') + ')');
ok(sameSet(serverSlots, appSlots), 'the app reads exactly those slots');
ok(sameSet(serverSlots, adminSlots), 'the admin panel has a card for exactly those slots');
const need = ['authhero', 'authlogo', 'mybanner', 'profilelogo', 'shopbanner', 'depositbanner', 'withdrawbanner', 'supportbanner', 'recordsbanner', 'bindbankbanner', 'teambanner', 'aboutbanner'];
ok(need.every(k => serverSlots.includes(k)), 'Login banner, Login circle logo, Me page banner (account background), Profile logo, AI Robots, Add Funds, Cash Out, Support, Ledger, Payout Account, Rewards, Team and About are all there');
const paint = (app.match(/function paintArt\(\)\{[\s\S]*?\n\}/) || [''])[0];
const entries = [...paint.matchAll(/\['([A-Za-z]+)', ([^,]+), '([a-z]+)'\]/g)];
ok(entries.length === 10 && entries.every(e => /^ART\.[a-z]+$/.test(e[2])), 'paintArt() gives every page banner its own picture (Team and Share pages both use the Team banner slot), none is left on the blue art for good (' + entries.length + ' banners)');
ok(entries.every(e => new RegExp('id="' + e[1] + '"').test(page)), 'and each of those banners exists on its page');
ok(/img data-icon="robots"|\(ART\.profilelogo \? '' : ' data-icon="robots"'\)/.test(paint) && /ART\.profilelogo/.test(paint) && /ART\.authlogo/.test(app), 'the profile logo and the Login circle logo come from their slots too');
ok(!/id="[A-Za-z]*Banner"[^>]*>\s*<img/.test(page), 'no banner is a fixed picture in the page');

// ---------------------------------------------------------------- 2. the real server
(async () => {
  for (let i = 0; i < 60; i++) { try { const hh = await fetch(base + '/health'); if (hh.ok) break; } catch (_) {} await sleep(250); }
  const colour = {}; serverSlots.forEach((k, n) => { colour[k] = dataUrl(20 + n * 17, 200 - n * 11, 40 + n * 13); });
  for (const k of serverSlots) {
    const r = await J('POST', '/admin/smartai-image/set', { slot: k, image: colour[k] }, null, true);
    ok(r.s === 200 && r.j.status === 'success', 'the admin can upload the ' + k + ' picture');
  }
  const pub = await J('GET', '/public/smartai-images');
  ok(serverSlots.every(k => pub.j[k] === colour[k]), 'members get every picture from /public/smartai-images, each in its own slot');
  const adm = await J('GET', '/admin/smartai-images', null, null, true);
  ok(serverSlots.every(k => adm.j[k] === colour[k]) && 'linkpreview' in adm.j && 'icons' in adm.j, 'and the admin panel reads the same pictures');
  ok(!('linkpreview' in pub.j), 'the link-preview picture is not sent to members');
  const bad = await J('POST', '/admin/smartai-image/set', { slot: 'nonsense', image: colour.authhero }, null, true);
  ok(bad.s === 400, 'an unknown slot is refused');
  const anon = await J('POST', '/admin/smartai-image/set', { slot: 'authhero', image: colour.authhero });
  ok(anon.s === 401, 'a caller without the admin key is refused');
  const notImg = await J('POST', '/admin/smartai-image/set', { slot: 'authhero', image: 'data:text/html;base64,PGI+' }, null, true);
  ok(notImg.s === 400, 'something that is not a picture is refused');
  await J('POST', '/admin/banner/set', { image: colour.authhero }, null, true);          // the Home banner has its own route

  // ---------------------------------------------------------------- 3. the real app
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
  await new Promise(r => front.listen(FRONT, '127.0.0.1', r));
  const phone = '0771234567', su = await J('POST', '/auth/signup', { phone, password: 'secret12' });
  await J('POST', '/register', { pin: '123456', referralCode: '' }, su.j.token);
  const { chromium } = require('playwright'); const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
  await ctx.addInitScript(() => { window._smartaiLoaderMinMs = 0; });
  const page1 = await ctx.newPage(); const errs = [];
  page1.on('pageerror', e => errs.push('pageerror: ' + String(e.message || e).slice(0, 200)));
  page1.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR|Content Security Policy|Function\(/.test(m.text())) errs.push('console: ' + m.text().slice(0, 200)); });
  const ev = (fn, arg) => page1.evaluate(fn, arg);
  const until = async (fn, arg, ms) => { try { await page1.waitForFunction(fn, arg, { timeout: ms || 8000 }); return true; } catch (_) { return false; } };
  await page1.goto('http://127.0.0.1:' + FRONT + '/', { waitUntil: 'domcontentloaded' });
  await until(() => document.getElementById('authScreen').style.display === 'flex');
  ok(await until(a => { const i = document.querySelector('#authBanner img.art-photo'), m = document.querySelector('#authMark img'); return !!i && i.getAttribute('src') === a.hero && !!m && m.getAttribute('src') === a.logo; }, { hero: colour.authhero, logo: colour.authlogo }, 8000), 'Log In and Sign Up show the uploaded banner and the uploaded circle logo, before anyone signs in');
  await page1.fill('#fPhone', phone.replace(/^0/, '')); await page1.fill('#fPass', 'secret12'); await page1.click('#authGo');
  ok(await until(() => document.getElementById('app').style.display === 'block', null, 15000), 'a member signs in');
  await ev(() => { try { dismissAnnouncement(); } catch (e) {} try { dismissInstallSheet(); } catch (e) {} });
  await ev(() => _artPromise);
  const map = { homeBanner: colour.authhero, shopBannerArt: colour.shopbanner, teamBanner: colour.teambanner, accountBanner: colour.mybanner,
    depositBanner: colour.depositbanner, withdrawBanner: colour.withdrawbanner, supportBanner: colour.supportbanner, aboutBanner: colour.aboutbanner,
    recordsBanner: colour.recordsbanner, bindbankBanner: colour.bindbankbanner };
  const got = await ev(m => Object.keys(m).map(id => { const el = document.getElementById(id), i = el && el.querySelector('img.art-photo'); return [id, i ? i.getAttribute('src') : null]; }), map);
  for (const [id, src] of got) ok(src === map[id], id + ' shows the picture the admin uploaded for it');
  ok(await ev(() => { const i = document.querySelector('#acctIcon img'); return !!i; }) && await ev(c => document.querySelector('#acctIcon img').getAttribute('src') === c, colour.profilelogo), 'the logo beside the phone number on the Me page is the uploaded Profile logo');
  const dup = new Set(got.map(g => g[1])); ok(dup.size >= 10, 'each page has its own picture, not one picture everywhere');
  // take them away again: every banner is the blue art once more
  for (const k of serverSlots) await J('POST', '/admin/smartai-image/clear', { slot: k }, null, true);
  await J('POST', '/admin/banner/clear', {}, null, true);
  await sleep(100);
  const cleared = await J('GET', '/public/smartai-images');
  ok(serverSlots.every(k => cleared.j[k] === null), 'removing a picture clears its slot');
  await ctx.close();
  // a phone that opens the app after that (a new browser: the pictures are kept for 60 s on purpose, so the old one would still hold them)
  const ctx3 = await browser.newContext({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
  await ctx3.addInitScript(() => { window._smartaiLoaderMinMs = 0; });
  const page3 = await ctx3.newPage();
  await page3.goto('http://127.0.0.1:' + FRONT + '/', { waitUntil: 'domcontentloaded' });
  await page3.waitForFunction(() => document.getElementById('authScreen').style.display === 'flex', null, { timeout: 8000 });
  await page3.fill('#fPhone', phone.replace(/^0/, '')); await page3.fill('#fPass', 'secret12'); await page3.click('#authGo');
  await page3.waitForFunction(() => document.getElementById('app').style.display === 'block', null, { timeout: 15000 });
  await page3.evaluate(() => _artPromise);
  const after = await page3.evaluate(m => Object.keys(m).map(id => { const el = document.getElementById(id); return [id, !!el.querySelector('img.art-photo'), !!el.querySelector('.art-fill')]; }), map);
  ok(after.every(a => !a[1] && a[2]), 'with the pictures removed every banner is the blue art again (' + after.length + ' checked)');
  ok(await page3.evaluate(() => /\/icons\/robots\.webp(\?v=\d+)?$/.test(document.querySelector('#acctIcon img').getAttribute('src'))), 'and the logo beside the phone number is the blue robot again');
  await ctx3.close();

  // ---------------------------------------------------------------- 4. the admin panel
  const ADMIN = path.join(__dirname, 'admin');
  const images = {}; serverSlots.forEach(k => { images[k] = null; });
  const posts = [];
  const adm1 = http.createServer((req, res) => { let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html'; const f = path.join(ADMIN, p);
    if (!f.startsWith(ADMIN) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(fs.readFileSync(f)); });
  await new Promise(r => adm1.listen(0, r)); const abase = 'http://127.0.0.1:' + adm1.address().port;
  const settings = { brandName: 'Smart AI', minDeposit: 5000, minWithdraw: 5000, welcomeBonus: 7000, commL1: 27, commL2: 2, commL3: 1, withdrawFeePct: 15, maxWithdrawalsPerDay: 2, dailyCheckin: 250, depositMethodNames: 'Pay-B, Pay-A, Pay-D, Pay-C' };
  const reply = (p, body) => {
    if (p === '/admin/check-key' || p === '/admin/login') return { status: 'success', token: 'tok', username: 'owner', role: 'owner' };
    if (p === '/admin/settings') return { status: 'success', settings };
    if (p === '/admin/smartai-images') return Object.assign({ status: 'success', icons: {}, linkpreview: null }, images);
    if (p === '/admin/banner') return { status: 'success', image: null };
    if (p === '/admin/brand-assets') return { status: 'success', appIcon: null, appIconCustom: false };
    if (p === '/admin/announcement-image') return { status: 'success', image: null };
    if (p === '/admin/about-html') return { status: 'success', html: '<p>About</p>' };
    if (p === '/admin/settings/update') { posts.push({ op: 'settings', settings: body.settings }); return { status: 'success' }; }
    if (p === '/admin/smartai-image/set') { posts.push({ op: 'set', slot: body.slot, image: body.image }); images[body.slot] = body.image; return { status: 'success' }; }
    if (p === '/admin/smartai-image/clear') { posts.push({ op: 'clear', slot: body.slot }); images[body.slot] = null; return { status: 'success' }; }
    return { status: 'success', message: 'ok', stats: {}, products: [], users: [], transactions: [], deposits: [], withdrawals: [] };
  };
  const ctx2 = await browser.newContext({ viewport: { width: 400, height: 900 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
  const ap = await ctx2.newPage(); const aerrs = [];
  ap.on('pageerror', e => aerrs.push('pageerror: ' + e.message));
  await ap.route('**/k7x2/**', route => { const rq = route.request(), p = new URL(rq.url()).pathname.replace(/^\/k7x2/, ''); let body = {}; try { body = JSON.parse(rq.postData() || '{}'); } catch (_) {} route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reply(p, body)) }); });
  await ap.goto(abase + '/'); await sleep(500);
  await ap.fill('#keyInput', 'k'); await ap.click('#loginBtn'); await sleep(900);
  await ap.click('[data-tab="banners"]');
  await ap.waitForFunction(() => document.querySelectorAll('#content h2.sec').length > 5, null, { timeout: 8000 }).catch(() => {});
  const heads = await ap.evaluate(() => [...document.querySelectorAll('#content h2.sec')].map(h => h.textContent.trim()));
  ok(heads[0] === 'Login & Sign Up banner' && heads[1] === 'Login & Sign Up circle logo', 'the Banners tab starts with the Login & Sign Up banner and circle logo (' + heads.slice(0, 2).join(' | ') + ')');
  ok(/^Icons/.test(heads[heads.length - 1]), 'the long Icons box is last, so every banner is found before it');
  const wanted = ['Home banner', 'AI Robots page banner', 'Team page banner', 'Me page banner (account background)', 'Profile logo (account logo)', 'Add Funds page banner', 'Cash Out page banner',
    'Support page banner', 'About page', 'Ledger page banner', 'Payout Account page banner', 'Welcome announcement', 'Link preview (Telegram)', 'App icon'];
  ok(wanted.every(t => heads.includes(t)), 'every banner has its own card: ' + wanted.filter(t => !heads.includes(t)).join(', ') + (wanted.every(t => heads.includes(t)) ? 'all ' + wanted.length + ' found' : ' MISSING'));
  // the seven animated emoji buttons put a :word: into the title or the text, at the cursor
  ok(await ap.evaluate(() => document.querySelectorAll('#annEmojiRow .emo-opt').length) === 7, 'the Welcome announcement card has seven emoji buttons');
  await ap.fill('#aBody', 'Hello world'); await ap.evaluate(() => { const f = document.getElementById('aBody'); f.focus(); f.setSelectionRange(5, 5); });
  await ap.click('#annEmojiRow [data-emo="fire"]'); await ap.click('#annEmojiRow [data-emo="tick"]');
  ok(await ap.evaluate(() => document.getElementById('aBody').value) === 'Hello:fire::tick: world', 'tapping Fire then Tick puts :fire::tick: into the text where the cursor was');
  await ap.fill('#aTitle', 'News'); await ap.click('#aTitle'); await ap.click('#annEmojiRow [data-emo="robot"]');
  ok(/:robot:/.test(await ap.evaluate(() => document.getElementById('aTitle').value)) && !/:robot:/.test(await ap.evaluate(() => document.getElementById('aBody').value)), 'with the cursor in the title, the emoji goes into the title');
  const bs = posts.length; await ap.click('#saveAnn'); for (let i = 0; i < 40 && posts.length === bs; i++) await sleep(100);
  const sv = posts[posts.length - 1];
  ok(sv && sv.op === 'settings' && sv.settings.annBody === 'Hello:fire::tick: world' && /:robot:/.test(sv.settings.annTitle) && !('annEmoji' in sv.settings), 'Save announcement sends the title and the text with the emoji words in them');
  const bp = posts.length; await ap.evaluate(() => { const s = document.getElementById('pfSwitch'); s.checked = true; s.dispatchEvent(new Event('change', { bubbles: true })); });
  for (let i = 0; i < 40 && posts.length === bp; i++) await sleep(100);
  ok(posts.length > bp && posts[posts.length - 1].op === 'settings' && posts[posts.length - 1].settings.pageParticles === true, 'the Animations card has the switch "Particle background on every page" and it saves at once');
  const slotsInPanel = [...adminSrc.matchAll(/\{ slot:'([a-z]+)', title:'[^']*',(?: round:true,)? file:'([A-Za-z]+)', clear:'([A-Za-z]+)'/g)].map(m => ({ slot: m[1], file: m[2], clear: m[3] }));
  ok(slotsInPanel.length === 11, 'eleven plain picture cards (About keeps its own card with the page text)');
  for (const o of slotsInPanel) {
    const before = posts.length;
    await ap.setInputFiles('#' + o.file, { name: 'pic.png', mimeType: 'image/png', buffer: pngBuf(200, 30, 30) });
    for (let i = 0; i < 40 && posts.length === before; i++) await sleep(100);
    const last = posts[posts.length - 1];
    ok(posts.length > before && last.op === 'set' && last.slot === o.slot && /^data:image\/(jpeg|png|webp);base64,/.test(last.image), 'Upload on the ' + o.slot + ' card sends a picture for the ' + o.slot + ' slot');
    await sleep(500);   // the panel redraws itself after a save
  }
  const hasRemove = await ap.evaluate(l => l.every(o => !!document.getElementById(o.clear)), slotsInPanel);
  ok(hasRemove, 'after an upload every card offers Remove');
  const b2 = posts.length;
  await ap.click('#' + slotsInPanel.find(o => o.slot === 'depositbanner').clear);
  for (let i = 0; i < 40 && posts.length === b2; i++) await sleep(100);
  ok(posts.length > b2 && posts[posts.length - 1].op === 'clear' && posts[posts.length - 1].slot === 'depositbanner', 'Remove on the Add Funds card clears the depositbanner slot');
  ok(aerrs.length === 0, 'the admin panel raised no errors' + (aerrs.length ? ': ' + aerrs.join(' | ') : ''));
  ok(errs.length === 0, 'the member app raised no errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  ok(serverErrors.length === 0, 'no server errors' + (serverErrors.length ? ': ' + serverErrors.slice(0, 2).join(' | ') : ''));
  await browser.close(); front.close(); adm1.close();
  realLog('\n' + (fail ? 'FAIL' : 'PASS') + ': banner slots (' + pass + ' ok, ' + fail + ' failed)');
  process.exit(fail ? 1 : 0);
})().catch(e => { realLog('CRASH ' + (e && e.stack || e)); process.exit(1); });
