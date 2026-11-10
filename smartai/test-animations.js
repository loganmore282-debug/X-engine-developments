'use strict';
// The owner's animations (his screen recordings): the dots loader and the three Team-page level medals, end to end:
//   1. the numbers in the code are the measured ones (the loader's angles, the medals' timelines) and the sprite sheets are there;
//   2. the real server takes, serves and clears a picture for each of the four slots (Back to default);
//   3. a real phone-sized browser: the dots move and are blue, the medals play, a custom picture stands still, Back to default brings the animation back,
//      and every page change shows the dots for a moment;
//   4. the admin panel's Animations card has Upload / Back to default for each of the four.
//   The same for the second set of recordings: the gift that wants to open, the burst with a coin, the payment tick and cross, and the Rewards page they live on.
//   node test-animations.js
const path = require('path'), Module = require('module'), http = require('http'), fs = require('fs'), zlib = require('zlib');
process.chdir(__dirname);
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...a) { return req === 'mongodb' ? path.join(__dirname, 'test-helpers', 'fake-mongodb.js') : origResolve.call(this, req, ...a); };
const BACK = 4100 + Math.floor(Math.random() * 400), FRONT = 4600 + Math.floor(Math.random() * 400);
process.env.PORT = String(BACK); process.env.MONGODB_URI = 'mongodb://fake/app'; process.env.ADMIN_KEY = 'anim-test-admin-key-123456'; process.env.NODE_ENV = 'development';
process.env.POTATO_SECRETS_DIR = fs.mkdtempSync(path.join(require('os').tmpdir(), 'sa-anim-'));
const realLog = console.log, serverErrors = [];
console.log = () => {}; console.warn = () => {}; console.error = (...a) => { serverErrors.push(a.map(x => (x && x.message) || String(x)).join(' ').slice(0, 300)); };
require(path.join(__dirname, 'server.js'));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; realLog('  ok   - ' + m); } else { fail++; realLog('  FAIL - ' + m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const base = 'http://127.0.0.1:' + BACK;
const J = async (m, p, b, tok, adm) => { const r = await fetch(base + p, { method: m, headers: Object.assign({ 'content-type': 'application/json' }, tok ? { authorization: 'Bearer ' + tok } : {}, adm ? { authorization: 'Bearer anim-test-admin-key-123456' } : {}), body: b ? JSON.stringify(b) : undefined }); let j = null; try { j = await r.json(); } catch (_) {} return { s: r.status, j }; };
const read = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(zlib.crc32(td) >>> 0); return Buffer.concat([len, td, c]); }
function pngBuf(r, g, b) {
  const w = 8, h = 8, raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; } }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const pic = 'data:image/png;base64,' + pngBuf(220, 60, 60).toString('base64');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp' };
const staticServer = (dir, withProxy) => http.createServer((req, res) => {
  if (withProxy && req.url.startsWith('/k7x2/')) {
    const p = http.request({ host: '127.0.0.1', port: BACK, path: req.url.slice(5), method: req.method, headers: Object.assign({}, req.headers, { host: '127.0.0.1:' + BACK }) }, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    p.on('error', () => { res.writeHead(502); res.end(); }); req.pipe(p); return;
  }
  let f = req.url.split('?')[0]; if (f === '/' || !/\.[a-z0-9]+$/i.test(f)) f = '/index.html';
  fs.readFile(path.join(dir, path.normalize(f).replace(/^(\.\.[\/\\])+/, '')), (e, buf) => { if (e) { res.writeHead(404); res.end('nf'); return; } res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(buf); });
});

(async () => {
  const src = read('user-src/original_module.js'), css = read('user-src/index.html'), adm = read('admin-src/index.html');
  // ---- 1. the numbers
  const th = (src.match(/var DL_THETA = \[([^\]]*)\]/) || [, ''])[1].split(',').map(Number);
  ok(th.length === 101 && th[0] === 0 && th[100] === 360 && th.every((v, i) => i === 0 || v >= th[i - 1]), 'the loader turns once round in 2 s (101 steps of 20 ms, 0 to 360 degrees, never backwards)');
  const fn = new Function(src.slice(src.indexOf('var DL_THETA'), src.indexOf('function dlMarkup')) + '; return { dlCircles: dlCircles };')();
  const c0 = fn.dlCircles(0), r2 = x => Math.round(x * 10) / 10;
  ok(c0.length === 12 && r2(Math.hypot(c0[0][0], c0[0][1])) === 224.9 && r2(c0[0][2]) === 46.9 && r2(Math.hypot(c0[4][0], c0[4][1])) === 192.2 && r2(c0[4][2]) === 40.1 && r2(Math.hypot(c0[8][0], c0[8][1])) === 80.9 && r2(c0[8][2]) === 16.4, 'at the start: 4 big dots on a ring of 224.9, 4 middle ones on 192.2 (smaller), 4 small ones on 80.9, as measured');
  const c1 = fn.dlCircles(0.5), c15 = fn.dlCircles(1.5);
  ok(r2(Math.hypot(c1[4][0], c1[4][1])) > 214 && r2(Math.hypot(c15[4][0], c15[4][1])) < 172, 'the middle ring breathes out (about 224.9 at 0.5 s) and in (about 160 at 1.5 s)');
  const tl = (src.match(/var MEDAL_TL = \{([\s\S]*?)\};/) || [, ''])[1];
  const tls = [1, 2, 3].map(n => (tl.match(new RegExp(n + ':\\[([^\\]]*)\\]')) || [, ''])[1].split(',').map(Number));
  ok(tls.every(a => a.length === 90 && a.every(v => v >= 0 && v < 90)), 'each medal has 90 steps (30 a second, a 3 s loop) of picture numbers');
  const dim = f => { const b = fs.readFileSync(path.join(__dirname, f)); return b.toString('ascii', 0, 4) === 'RIFF' ? { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) } : null; };
  ok([1, 2, 3].every(n => { const d = dim('user/anim/medal-' + n + '.webp'); return d && d.w === 1280 && d.h === 1152; }), 'the three medal sheets are there (10 x 9 pictures of 128 px)');
  ok([1, 2, 3].every(n => fs.existsSync(path.join(__dirname, 'user/icons/level' + n + '.webp'))) && fs.existsSync(path.join(__dirname, 'user/icons/loader.webp')), 'the resting pictures (shown while a sheet loads, and the admin\'s default) are there');
  ok(!/team-badge/.test(css) && (css.match(/class="medal"/g) || []).length === 3, 'the static 1, 2, 3 of the Team page are gone: three animated medals take their place');
  ok(/svg\.dl circle\{fill:var\(--caramel\)/.test(css), 'the loader is the app\'s blue');

  const dims = f => { const b = fs.readFileSync(path.join(__dirname, f)); return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) }; };
  const go = dims('user/anim/gift-open.webp');
  ok(go.w === 512 && !fs.existsSync(path.join(__dirname, 'user/anim/gift-idle.webp')), 'the opened box (vector in the app) also has a 512 px picture for the admin preview; the gift that wants to open is NOT a blurry video cut any more');
  ok(/<svg class="go"/.test(css) && !/\bgi-star\b/.test(css) && (css.match(/class="go-heap"/g) || []).length === 1 && !/<text/.test(((css.match(/<svg class="go"[\s\S]*?<\/svg>/) || [''])[0].match(/<g class="go-heap">[\s\S]*?<\/g>/) || [''])[0]) && /<text[^>]*>UGX<\/text>/.test((css.match(/<svg class="go"[\s\S]*?<\/svg>/) || [''])[0]), 'the opened box is drawn as vector: plain gold coins in the heap (no stars, no letters) and ONE big UGX coin');
  ok(/var GB_SVG = gbSvg\(/.test(src) && /function gbWarp/.test(src) && /% 433\) \/ 433/.test(src) && !/gbWob|gbLid/.test(css) && /id="gbL"/.test(css), 'the gift is drawn as SVG (sharp at any size) and moves like the recording: a 0.433 s loop where the walls really bend (barrel when squashed, pinched when tall), the lid lifting over the yellow glow');
  ok(/\.ok-disc\{animation:anPop \.27s/.test(css) && /\.ok-halo\{animation:anHalo \.3s[^}]*\.08s/.test(css) && /\.ok-check\{[^}]*\.15s/.test(css) && /r="182"/.test(src) && /r="300"/.test(src), 'the tick: disc grows in 0.27 s, halo follows after 0.08 s, the check is drawn after 0.15 s (measured), disc 182 and halo 300');
  ok(/\.no-halo\{animation:anSpring \.34s/.test(css) && /r="187"/.test(src) && /r="303"/.test(src) && /#fe1e3d/.test(src), 'the cross: red disc 187 with a springing halo 303, as measured');
  ok(!/\bstars?\b/i.test((css.match(/\.gs[\s\S]*?\/\* ---- Smart AI additions/) || [''])[0].replace(/\/\*[\s\S]*?\*\//g, '')) && /UGX/.test(css) && /class="c"|i\.c\{/.test(css), 'the burst has a coin where the recording had a star, and little coins instead of star bits');
  ok(/\.photo-banner\.pb-full\{height:150px/.test(css), 'the AI Robots header is 150 px (was 240)');

  // ---- 2. the server
  for (let i = 0; i < 60; i++) { try { const hh = await fetch(base + '/health'); if (hh.ok) break; } catch (_) {} await sleep(250); }
  const png = 'data:image/png;base64,' + pngBuf(30, 120, 230).toString('base64');
  const slots = ['level1', 'level2', 'level3', 'loader', 'giftbox', 'giftopen', 'tick', 'cross'];
  for (const k of slots) { const r = await J('POST', '/admin/smartai-image/set', { slot: k, image: png }, null, true); ok(r.s === 200, 'the admin can upload a picture for ' + k); }
  let pub = (await J('GET', '/public/smartai-images')).j;
  ok(slots.every(k => pub.icons && pub.icons[k] === png), 'members receive them with the other icons');
  const bad = await J('POST', '/admin/smartai-image/set', { slot: 'level1', image: 'data:image/jpeg;base64,/9j/4AAQ' }, null, true);
  ok(bad.s === 400, 'a picture that is not a transparent PNG is refused for a medal');
  for (const k of slots) { const r = await J('POST', '/admin/smartai-image/clear', { slot: k }, null, true); ok(r.s === 200, 'Back to default clears ' + k); }
  await J('POST', '/admin/smartai-image/set', { slot: 'level1', image: png }, null, true);   // used below, then cleared

  // ---- 3. the member app
  const { chromium } = require('playwright'); const browser = await chromium.launch();
  const front = staticServer(path.join(__dirname, 'user'), true); await new Promise(r => front.listen(FRONT, '127.0.0.1', r));
  const phone = '0771234567', su = await J('POST', '/auth/signup', { phone, password: 'secret12' });
  await J('POST', '/register', { pin: '123456', referralCode: '' }, su.j.token);
  await J('POST', '/admin/smartai-image/clear', { slot: 'level1' }, null, true);
  const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
  await ctx.addInitScript(() => { window._smartaiLoaderMinMs = 0; window._smartaiNavMs = 400; });
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(String(e.message || e).slice(0, 200)));
  const until = async (fn, arg, ms) => { try { await p.waitForFunction(fn, arg, { timeout: ms || 8000 }); return true; } catch (_) { return false; } };
  await p.goto('http://127.0.0.1:' + FRONT + '/', { waitUntil: 'domcontentloaded' });
  await until(() => document.getElementById('authScreen').style.display === 'flex');
  await p.fill('#fPhone', phone.replace(/^0/, '')); await p.fill('#fPass', 'secret12'); await p.click('#authGo');
  ok(await until(() => document.getElementById('app').style.display === 'block', null, 15000), 'a member signs in');
  await p.evaluate(() => { try { dismissAnnouncement(); } catch (e) {} try { dismissInstallSheet(); } catch (e) {} try { stopAccountPoll(); } catch (e) {} });
  // the dots loader
  await p.evaluate(() => { document.getElementById('shopGrid').innerHTML = spinnerHtml(); });
  const snap = () => p.evaluate(() => [...document.querySelectorAll('#shopGrid svg.dl circle')].map(c => c.getAttribute('cx') + ',' + c.getAttribute('cy') + ',' + c.getAttribute('r')).join('|'));
  const a = await snap(); await sleep(330); const b = await snap();
  ok(a.split('|').length === 12 && a !== b, 'the page loader is 12 dots and they move');
  ok(await p.evaluate(() => getComputedStyle(document.querySelector('#shopGrid svg.dl circle')).fill) === 'rgb(19, 122, 239)', 'and they are the app\'s blue');
  // a custom loader picture
  await p.evaluate(png => { STATE_ICONS = { loader: png }; document.getElementById('shopGrid').innerHTML = spinnerHtml(); }, png);
  ok(await p.evaluate(() => !!document.querySelector('#shopGrid img.dl-custom') && !document.querySelector('#shopGrid svg.dl')), 'a picture uploaded for the loader replaces the dots');
  await p.evaluate(() => { STATE_ICONS = {}; });
  // medals
  await p.evaluate(() => switchTab('team'));
  ok(await until(() => document.querySelectorAll('.medal.live').length === 3, null, 10000), 'on the Team page the three medals switch to their animation (sheets loaded)');
  const pos = () => p.evaluate(() => [...document.querySelectorAll('.medal')].map(m => m.style.backgroundPosition).join('|'));
  const seen = new Set(); for (let i = 0; i < 12; i++) { seen.add(await pos()); await sleep(260); }
  ok(seen.size >= 5 && [...seen].every(x => x.split('|').every(Boolean)), 'and they play (' + seen.size + ' different pictures in 3 s)');
  ok(await p.evaluate(() => { const m = document.querySelector('.medal'); const r = m.getBoundingClientRect(); return Math.round(r.width) === 56 && getComputedStyle(m).backgroundImage.includes('/anim/medal-1.webp'); }), 'a medal is 56 px and uses the owner\'s sheet');
  await p.evaluate(png => { STATE_ICONS = { level2: png }; paintMedals(); }, png);
  ok(await p.evaluate(() => { const m = document.querySelector('.medal[data-medal="2"]'); return m.classList.contains('custom') && !m.classList.contains('live') && /^url\(/.test(m.style.backgroundImage); }) && await p.evaluate(() => document.querySelector('.medal[data-medal="1"]').classList.contains('live')), 'a picture uploaded for Level 2 stands still in its place; the other medals keep playing');
  await p.evaluate(() => { STATE_ICONS = {}; paintMedals(); });
  ok(await p.evaluate(() => { const m = document.querySelector('.medal[data-medal="2"]'); return m.classList.contains('live') && !m.classList.contains('custom') && m.style.backgroundImage === ''; }), 'Back to default: the animation is back');
  // Team page share buttons: Telegram, WhatsApp, TikTok, Facebook, each a 3 s loop of a brand-coloured fill with the icon inside
  await p.evaluate(() => switchTab('team')); await sleep(300);
  const shr = await p.evaluate(() => [...document.querySelectorAll('#viewTeam .sh-btn')].map(b => ({ k: b.dataset.share, anim: getComputedStyle(b.querySelector('.sh-fill')).animationName, dur: getComputedStyle(b.querySelector('.sh-fill')).animationDuration, svg: !!b.querySelector('.sh-fill svg'), word: b.querySelector('.sh-word').textContent, h: b.offsetHeight })));
  ok(shr.length === 4 && shr.map(x => x.k).join() === 'tg,wa,tt,fb' && shr.every(x => x.anim === 'shFill' && x.dur === '3s' && x.svg && x.word === 'share' && x.h >= 44), 'the Team page has four animated share buttons (Telegram, WhatsApp, TikTok, Facebook), 3 s loop, the word share under the fill');
  const opened = await p.evaluate(() => { const got = []; window.open = (u) => { got.push(u); }; ['tg','wa','fb'].forEach(k => shareTo(k)); return got; });
  ok(/^https:\/\/t\.me\/share\/url\?url=/.test(opened[0]) && /^https:\/\/wa\.me\/\?text=/.test(opened[1]) && /^https:\/\/www\.facebook\.com\/sharer\/sharer\.php\?u=/.test(opened[2]) && opened.every(u => /inviteRegister/i.test(decodeURIComponent(u))), 'Telegram, WhatsApp and Facebook open their own share screen carrying the invite link');
  // Support page: Telegram and WhatsApp app icons that pop in a 2.67 s loop (traced off the recordings)
  const sup = await p.evaluate(() => { const o = JSON.parse(localStorage.getItem(SETTINGS_CACHE_KEY) || '{}'); Object.assign(o, { telegramChannel: 'https://t.me/a', supportTelegram: 'https://t.me/c', whatsappGroup: 'https://chat.whatsapp.com/d', whatsappContact: 'https://wa.me/256700000000' }); localStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify(o)); renderStaticPages(); const r = [...document.querySelectorAll('#supportLinks .menu-item')]; return { n: r.length, labels: r.map(x => x.querySelector('.menu-lbl').textContent), anim: r.map(x => getComputedStyle(x.querySelector('.sup-ic')).animationName + '|' + getComputedStyle(x.querySelector('.sup-ic')).animationDuration), paths: r.every(x => x.querySelectorAll('.sup-ic path').length === 2) }; });
  ok(sup.n === 4 && sup.labels.join() === 'Telegram Channel,Telegram Support,WhatsApp Group,WhatsApp Support' && sup.anim.every(a => a === 'supPop|2.667s') && sup.paths, 'the Support page shows the animated Telegram and WhatsApp icons beside Channel, Group, Support links');
  // the Rewards page: the gift first, the daily reward second
  await p.evaluate(() => switchTab('rewards'));
  ok(await p.evaluate(() => { const g = document.getElementById('giftBoxBtn'), c = document.getElementById('checkinCard'); return !!g && !!c && (g.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0; }), 'on the Rewards page the gift is the first thing, the daily check-in calendar comes after it');
  ok(await p.evaluate(() => !document.getElementById('rewardsBanner') && !document.querySelector('#viewRewards .photo-banner')), 'the banner at the top of the Rewards page is gone');
  ok(await p.evaluate(() => !!document.querySelector('#giftBoxBtn .gbox svg.gb') && !document.getElementById('giftCodeInput').offsetParent), 'the page shows only the gift (the code field lives in the popup)');
  const gseen = new Set(); for (let i = 0; i < 14; i++) { gseen.add(await p.evaluate(() => document.querySelector('#giftBoxBtn .gb-body > path').getAttribute('d') + '|' + document.querySelector('#giftBoxBtn .gb-lid > path').getAttribute('d')).catch(() => '')); await sleep(31); }
  ok(gseen.size >= 6, 'the gift moves (' + gseen.size + ' different shapes in 0.45 s)');
  // the walls bend: at the fattest pose the side edge is bowed out, at the tallest it is pinched in (the same wall has points off its straight line)
  ok(await p.evaluate(() => { const bend = (t) => { const o = gbPose(t), d = gbPath([[[38,182],[38,52]]], o, 0, true), n = d.match(/[\d.-]+ [\d.-]+/g).map(q => q.split(' ').map(Number)); const a = n[0], z = n[n.length - 1], m = n[Math.floor(n.length / 2)]; return m[0] - (a[0] + (z[0] - a[0]) * (m[1] - a[1]) / (z[1] - a[1])); }; return bend(0) < -3 && bend(0.2) > 3 && gbPose(0.4).lift > 20 && gbPose(0).lift === 0; }), 'the walls bow out when the box is squashed, pinch in when it stretches tall, and the lid is lifted at the top of the loop');
  await p.evaluate(() => document.getElementById('giftBoxBtn').click()); await sleep(450);
  const ask = await p.evaluate(() => { const st = document.getElementById('giftStage'), bg = document.getElementById('giftRevealBg'), inp = document.getElementById('giftCodeInput'), sp = document.querySelector('.gs-spokes'); return { show: bg.classList.contains('show'), ask: st.classList.contains('gs-ask'), blur: getComputedStyle(bg).backdropFilter || getComputedStyle(bg).webkitBackdropFilter, field: !!inp.offsetParent, spokes: getComputedStyle(sp).animationName, gold: /ffc93d|ffe27a/i.test(sp.innerHTML) && sp.querySelectorAll('path').length >= 48, box: !!document.querySelector('.gs-box svg.gb'), card: !!document.getElementById('gsCard').offsetParent }; });
  ok(ask.show && ask.ask && /blur/.test(ask.blur) && ask.field && ask.card && ask.spokes === 'gsSpin' && ask.gold && ask.box, 'tapping the gift opens the popup: blurred page, rotating GOLD spoke rings, the gift behind, and the field for the gift code');
  // codes are written in capitals and cut to length as they go in: a gift code is 10 characters (25LVI2IRLX), a referral code 5
  const caps = await p.evaluate(() => { const g = document.getElementById('giftCodeInput'), r = document.getElementById('fCode'); g.value = 'ab-cd ef12345xyz'; g.dispatchEvent(new Event('input', { bubbles: true })); r.value = 'ab-c d9z8'; r.dispatchEvent(new Event('input', { bubbles: true })); const out = { gift: g.value, ref: r.value, gUp: getComputedStyle(g).textTransform, rUp: getComputedStyle(r).textTransform }; g.value = ''; r.value = ''; return out; });
  ok(caps.gift === 'ABCDEF1234' && caps.ref === 'ABCD9' && caps.gUp === 'uppercase' && caps.rUp === 'uppercase', 'a gift code is capitals and 10 characters (ab-cd ef12345xyz becomes ' + caps.gift + '), a referral code capitals and 5 (' + caps.ref + ')');
  await p.evaluate(() => { document.getElementById('giftCodeInput').value = ''; document.getElementById('redeemBtn').click(); }); await sleep(200);
  ok(await p.evaluate(() => document.getElementById('giftStage').classList.contains('gs-ask') && document.getElementById('giftRevealBg').classList.contains('show')), 'opening with an empty field says so and keeps the popup');
  await p.evaluate(() => { document.getElementById('giftCodeInput').value = 'WRONGWRONG'; document.getElementById('redeemBtn').click(); });
  ok(await until(() => document.getElementById('giftStage').classList.contains('gs-ask') && !document.getElementById('redeemBtn').disabled, null, 6000) && await p.evaluate(() => !document.getElementById('giftStage').classList.contains('gs-burst')), 'a wrong code brings the popup back (nothing opened, nothing paid)');
  await p.evaluate(() => closeGiftReveal()); await sleep(100);
  ok(await p.evaluate(() => !document.getElementById('giftRevealBg').classList.contains('show')), 'the X closes the popup');
  const gen = await J('POST', '/admin/promocodes/generate', { minReward: 3000, maxReward: 3000, maxUses: 5 }, null, true);
  await p.evaluate(() => document.getElementById('giftBoxBtn').click()); await sleep(300);
  await p.evaluate(c => { document.getElementById('giftCodeInput').value = c; document.getElementById('redeemBtn').click(); }, gen.j.code); await sleep(250);
  const stage = await p.evaluate(() => { const bg = document.getElementById('giftRevealBg'), st = document.getElementById('giftStage'), sp = document.querySelector('.gs-spokes'); return { show: bg.classList.contains('show'), opening: st.classList.contains('gs-opening'), blur: getComputedStyle(bg).backdropFilter || getComputedStyle(bg).webkitBackdropFilter, spokes: getComputedStyle(sp).animationName, glitter: document.querySelectorAll('#gsGlitter i').length, spin: getComputedStyle(document.querySelector('.gs-box')).animationName, label: document.getElementById('gsLabel').textContent }; });
  ok(stage.show && stage.opening && /blur/.test(stage.blur) && stage.spokes === 'gsSpin' && stage.glitter === 16 && /Opening/.test(stage.label), 'pressing Open gift: the card goes, the gift shakes and swells with glitter inside the gold spoke rings ("Opening your gift...")');
  const swell = await p.evaluate(async () => { const out = []; for (let i = 0; i < 6; i++) { out.push(document.querySelector('.gs-box .gb-body > path').getAttribute('d')); await new Promise(r => setTimeout(r, 90)); } const a = gbSwellPose(1000), z = gbSwellPose(0); return { shapes: new Set(out).size, big: a.s > 1.1 && a.b > 15 && z.b < 8, bang: gbBangPose(260).lift > 60 && gbBangPose(260).s > 1.35 }; });
  ok(swell.shapes >= 4 && swell.big && swell.bang, 'while the code is checked the closed box shakes and SWELLS (walls bulge more and more), and on the answer it bangs: puffs up and its lid is blown off');
  ok(await until(() => document.getElementById('giftStage').classList.contains('gs-burst'), null, 8000), 'a right code bursts it open');
  await sleep(1400);
  const burst = await p.evaluate(() => ({ coin: getComputedStyle(document.querySelector('.gs-coin')).display, inCoin: !!document.querySelector('.gs-open svg.go .go-bigcoin') && getComputedStyle(document.querySelector('.go-bigcoin')).animationName === 'goCoinOut', shine: getComputedStyle(document.querySelector('.go-shine')).animationName === 'goShine' && document.querySelectorAll('.go-tw').length >= 8, halo: getComputedStyle(document.querySelector('.gs-main'), '::before').animationName === 'gsHalo', open: getComputedStyle(document.querySelector('.gs-open')).display, box: getComputedStyle(document.querySelector('.gs-box')).display, conf: document.querySelectorAll('#gsConfetti i').length, coins: document.querySelectorAll('#gsConfetti i.c').length, balloons: document.querySelectorAll('.gs-balloon').length, amount: document.getElementById('giftRevealAmount').textContent, uses: document.querySelector('.gs-coin text') && document.querySelector('.gs-coin text').textContent }));
  ok(burst.coin === 'none' && burst.inCoin && burst.shine && burst.halo, 'the big coin is INSIDE the opened box (it pops out, spins and settles in the heap, no floating coin), a band of light sweeps over the box, glints twinkle and a gold halo pulses behind it');
  ok(burst.open === 'block' && burst.box === 'none' && burst.conf === 30 && burst.coins >= 15 && burst.balloons === 3 && /3,000/.test(burst.amount) && burst.uses === 'UGX', 'the burst: the opened box, 30 pieces (20 of them little coins), 3 balloons, UGX 3,000');
  await p.evaluate(() => closeGiftReveal());
  await p.evaluate(png => { STATE_ICONS = { giftbox: png, giftopen: png }; paintGift(); }, png);
  ok(await p.evaluate(() => { const g = document.querySelector('#giftBoxBtn .gbox'); return g.classList.contains('custom') && !g.querySelector('svg') && /^url\(/.test(g.style.backgroundImage) && /^data:image\/png/.test(document.querySelector('.go-custom').getAttribute('src')) && !document.querySelector('.go-custom').hidden && document.querySelector('.gs-open svg.go').style.display === 'none'; }), 'a picture uploaded for the gift stands still in its place (and for the opened gift)');
  await p.evaluate(() => { STATE_ICONS = {}; paintGift(); });
  ok(await p.evaluate(() => { const g = document.querySelector('#giftBoxBtn .gbox'); return !g.classList.contains('custom') && !!g.querySelector('svg.gb') && g.style.backgroundImage === '' && document.querySelector('.go-custom').hidden && document.querySelector('.gs-open svg.go').style.display === ''; }), 'Back to default: the animated gift and the vector opened box are back');
  // the daily check-in calendar
  await p.evaluate(() => { renderCheckin(); });
  const cal = await p.evaluate(() => ({ n: document.querySelectorAll('#calGrid .cal-d').length, amts: [...document.querySelectorAll('#calGrid .cal-a')].slice(0, 12).map(e => e.textContent), today: [...document.querySelectorAll('#calGrid .cal-d')].findIndex(e => e.classList.contains('today')) + 1, btn: document.getElementById('checkinBtn').textContent.trim(), ring: !!document.getElementById('checkinRing') }));
  ok(cal.n === 30 && cal.amts.join() === '100,200,300,500,600,700,800,1,000,100,200,300,500' && cal.today === 1 && /Check in for UGX 100/.test(cal.btn) && !cal.ring, 'the check-in is a 30-day calendar climbing 100, 200, 300, 500, 600, 700, 800, 1,000 and starting again; today is day 1; the ring is gone');
  await p.evaluate(() => { STATE.checkinStreak = 3; STATE.lastCheckin = serverYesterdayKey(); renderCheckin(); });
  const cal2 = await p.evaluate(() => ({ done: document.querySelectorAll('#calGrid .cal-d.done').length, today: [...document.querySelectorAll('#calGrid .cal-d')].findIndex(e => e.classList.contains('today')) + 1, btn: document.getElementById('checkinBtn').textContent.trim() }));
  ok(cal2.done === 3 && cal2.today === 4 && /Check in for UGX 500/.test(cal2.btn), 'after three days in a row: three filled days, today is day 4 and pays UGX 500');
  // today's box breathes a soft blue glow every 2.5 s (an opacity-only layer); the other boxes stay still
  const glow = await p.evaluate(() => { const t = document.querySelector('#calGrid .cal-d.today'), g = getComputedStyle(t, '::after'), o = [...document.querySelectorAll('#calGrid .cal-d:not(.today)')].filter(e => e.getAnimations({ subtree: true }).length); return { name: g.animationName, dur: g.animationDuration, iter: g.animationIterationCount, others: o.length, w: Math.round(t.getBoundingClientRect().width) }; });
  ok(glow.name === 'calGlow' && glow.dur === '2.5s' && glow.iter === 'infinite' && glow.others === 0, 'today\'s check-in box has the soft blue glow breathing every 2.5 s and no other box moves');
  // a claim: that day turns solid blue and its tick pops in 0.3 s (once); a later repaint does not replay it
  const pop = await p.evaluate(() => { STATE.checkinStreak = 3; STATE.lastCheckin = serverYesterdayKey(); renderCheckin(); _calPop = _calToday; STATE.checkinStreak = 4; STATE.lastCheckin = serverTodayKey(); renderCheckin(); const c = [...document.querySelectorAll('#calGrid .cal-d')][3], a = getComputedStyle(c, '::after'), b = getComputedStyle(c, '::before'); const first = { done: c.classList.contains('done'), pop: c.classList.contains('pop'), tick: a.animationName, tickDur: a.animationDuration, fill: b.animationName, fillDur: b.animationDuration }; renderCheckin(); first.again = document.querySelectorAll('#calGrid .cal-d.pop').length; return first; });
  ok(pop.done && pop.pop && pop.tick === 'calTick' && pop.tickDur === '0.3s' && pop.fill === 'calFill' && pop.fillDur === '0.3s' && pop.again === 0, 'claiming turns the box solid blue with the tick popping in 0.3 s, once');
  await p.evaluate(() => { STATE.checkinStreak = 3; STATE.lastCheckin = serverYesterdayKey(); renderCheckin(); });
  await p.evaluate(() => { STATE.lastCheckin = serverTodayKey(); renderCheckin(); });
  ok(await p.evaluate(() => document.querySelectorAll('#calGrid .cal-d.done').length === 3 && !document.querySelector('#calGrid .cal-d.today') && document.getElementById('checkinBtn').disabled && /Claimed today/.test(document.getElementById('checkinBtn').textContent)), 'once claimed today the button reads Claimed today');
  await p.evaluate(() => { STATE.checkinStreak = 5; STATE.lastCheckin = '01/01/2020'; renderCheckin(); });
  ok(await p.evaluate(() => document.querySelectorAll('#calGrid .cal-d.done').length === 0 && [...document.querySelectorAll('#calGrid .cal-d')].findIndex(e => e.classList.contains('today')) === 0), 'a missed day sends the calendar back to day 1');
  // the tick and the cross on the payment pages
  await p.evaluate(() => { openOverlay('depositStatus'); showDepositSuccess(); }); await sleep(120);
  ok(await p.evaluate(() => { const ic = document.getElementById('depStatusIc'); return ic.className === 'pay-status-ic anim' && !!ic.querySelector('.ok-check') && getComputedStyle(ic.querySelector('.ok-disc')).animationName === 'anPop'; }), 'a successful payment shows the animated green tick');
  await p.evaluate(() => { _depConfirmed = false; showDepositFailed(); }); await sleep(120);
  ok(await p.evaluate(() => { const ic = document.getElementById('depStatusIc'); return !!ic.querySelector('.no-x') && /Not Completed/.test(document.getElementById('depStatusTitle').textContent); }), 'a failed payment shows the animated red cross and "Payment Not Completed"');
  await p.evaluate(png => { STATE_ICONS = { tick: png, cross: png }; showDepositSuccess(); }, png);
  ok(await p.evaluate(() => !!document.querySelector('#depStatusIc img') && !document.querySelector('#depStatusIc .ok-check')), 'a picture uploaded for the tick stands still in its place');
  await p.evaluate(() => { STATE_ICONS = {}; closeOverlay(); });
  await p.evaluate(() => switchTab('shop')); await sleep(80);
  ok(await p.evaluate(() => Math.round(document.getElementById('shopBanner').getBoundingClientRect().height) === 104), 'the AI Robots header (My AI robots / Accrued earnings) is 104 px high');
  // an uploaded page picture is shown whole at its own proportions (not cropped to a fixed box); the AI Robots header stays short
  const fit = await p.evaluate(async () => { const c = document.createElement('canvas'); c.width = 600; c.height = 300; const x = c.getContext('2d'); x.fillStyle = '#c33'; x.fillRect(0, 0, 600, 300); const url = c.toDataURL('image/png'); ART.recordsbanner = url; ART.shopbanner = url; ART.home = url; paintArt(); await new Promise(r => setTimeout(r, 500)); const q = id => document.getElementById(id), w = q('homeBanner').getBoundingClientRect(); return { home: Math.round(w.height), want: Math.round(w.width / 2), records: q('recordsBanner').classList.contains('fit'), shop: Math.round(q('shopBanner').getBoundingClientRect().height) }; });
  ok(Math.abs(fit.home - fit.want) <= 2 && fit.records && fit.shop === 104, 'a 2:1 picture on Home is shown whole (' + fit.home + ' px high for ' + fit.want + ' wide, not cropped to 150), and the AI Robots header keeps its short ' + fit.shop + ' px');
  // every page change shows the dots
  await p.evaluate(() => switchTab('home')); await sleep(60);
  ok(await p.evaluate(() => { const v = document.getElementById('navVeil'); return v.classList.contains('on') && !!v.querySelector('svg.dl') && getComputedStyle(v).opacity === '1'; }), 'moving to another tab shows the dots over the page');
  ok(await until(() => !document.getElementById('navVeil').classList.contains('on') && getComputedStyle(document.getElementById('navVeil')).opacity === '0', null, 3000), 'and they go away by themselves');
  await p.evaluate(() => openOverlay('about')); await sleep(60);
  ok(await p.evaluate(() => { const v = document.getElementById('navVeil'); return v.classList.contains('on') && v.classList.contains('over') && getComputedStyle(v).zIndex === '90'; }), 'opening a page (About) shows the dots above it');
  await sleep(700);
  await p.evaluate(() => closeOverlay()); await sleep(60);
  ok(await p.evaluate(() => document.getElementById('navVeil').classList.contains('on')), 'going back shows them too');
  // the dots are real loading: the Team page asks the server for its figures, and the dots stay for as long as that answer takes (here 1.6 s, longer than the 400 ms a pure design veil would stay)
  await p.evaluate(() => { _lastDataAt = 0; _lastCfgAt = 0; switchTab('home'); }); await sleep(900);
  await p.route('**/team/stats', async (route) => { await sleep(1600); route.continue().catch(() => {}); });
  await p.evaluate(() => switchTab('team')); await sleep(1000);
  ok(await p.evaluate(() => document.getElementById('navVeil').classList.contains('on')), 'while the Team page is still waiting for the server the dots stay on (not a fixed timer)');
  ok(await until(() => !document.getElementById('navVeil').classList.contains('on'), null, 4000), 'and they lift when the answer has come');
  await p.unroute('**/team/stats');
  // no blue flashes on product pictures: a repaint with nothing new keeps the very same picture elements, and a framed picture is never shown on an empty blue frame
  const flash = await p.evaluate(async () => { switchTab('shop'); await new Promise(r => setTimeout(r, 600)); const a = document.querySelector('.prod-img'); renderAll(); renderAll(); const b = document.querySelector('.prod-img'); const cs = getComputedStyle(b); return { same: a === b, op: cs.opacity, bg: cs.backgroundColor, blue: /221, ?233, ?252/.test(cs.backgroundColor) }; });
  ok(flash.same && flash.op === '1' && !flash.blue, 'repainting the shop keeps the same picture elements and never shows the blue empty frame');
  // a closed product: slanting SOLD OUT plate, blurred picture and figures
  const sold = await p.evaluate(() => { const c = document.querySelector('.prod-card'); const k = c.id.replace('prodCard-', ''); const pr = PRODUCTS.find(x => x.key === k); const old = pr.active; pr.active = false; renderShop(); const card = document.getElementById('prodCard-' + k); const tag = card.querySelector('.prod-sold-tag'), cs = tag && getComputedStyle(tag); const out = { text: tag && tag.textContent, rot: cs && cs.transform !== 'none', border: cs && cs.borderTopColor, blurImg: getComputedStyle(card.querySelector('.prod-img-wrap')).filter.indexOf('blur') >= 0, blurBody: getComputedStyle(card.querySelector('.prod-body-full')).filter.indexOf('blur') >= 0, btn: card.querySelector('button').textContent.trim(), noClick: getComputedStyle(card.querySelector('.prod-sold')).pointerEvents === 'none' }; pr.active = old; renderShop(); return out; });
  ok(sold.text === 'Coming soon' && sold.rot && sold.border === 'rgb(180, 83, 9)' && sold.blurImg && sold.blurBody && sold.btn === 'Coming soon' && sold.noClick, 'a closed product shows the slanting COMING SOON plate (orange edge, like Upcoming) over its lightly blurred picture and figures');
  // the owner sets the blur behind the COMING SOON plate (Admin > Settings): the card follows
  const sb = await p.evaluate(() => { const o = JSON.parse(localStorage.getItem(SETTINGS_CACHE_KEY) || '{}'); o.comingSoonBlur = 7; localStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify(o)); paintIconSizes(); const c = document.querySelector('.prod-card'), k = c.id.replace('prodCard-', ''), pr = PRODUCTS.find(x => x.key === k), old = pr.active; pr.active = false; renderShop(); const f = getComputedStyle(document.getElementById('prodCard-' + k).querySelector('.prod-img-wrap')).filter; const v = getComputedStyle(document.documentElement).getPropertyValue('--soon-blur').trim(); pr.active = old; o.comingSoonBlur = 2; localStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify(o)); paintIconSizes(); renderShop(); return { f, v }; });
  ok(/blur\(7px\)/.test(sb.f) && sb.v === '7px', 'a blur of 7 set by the owner shows on the closed product (' + sb.f + ')');
  // the Me page balances count up when the page is shown (a tab tap, or coming back from a page opened from it)
  await p.evaluate(() => { try { stopAccountPoll(); } catch (e) {} _lastDataAt = Date.now() + 600000; STATE.balance = 48000; STATE.totalWithdrawn = 12000; switchTab('home'); }); await sleep(900);
  await p.evaluate(() => switchTab('account')); await sleep(60);
  const cm0 = await p.evaluate(() => document.getElementById('acctBalNum').textContent);
  await sleep(900);
  const cm1 = await p.evaluate(() => document.getElementById('acctBalNum').textContent);
  await sleep(1500);
  const cm2 = await p.evaluate(() => ({ b: document.getElementById('acctBalNum').textContent, w: document.getElementById('acctWitNum').textContent }));
  const nm = t => Number(String(t).replace(/[^0-9.]/g, ''));
  ok(nm(cm0) < 2000 && nm(cm1) > nm(cm0) && nm(cm1) < 48000 && cm2.b === 'UGX 48,000' && cm2.w === 'UGX 12,000', 'arriving on Me: the balances start at 0 and count up to their figure (' + cm0 + ' -> ' + cm1 + ' -> ' + cm2.b + ')');
  await p.evaluate(() => openOverlay('records')); await sleep(700);
  await p.evaluate(() => closeOverlay()); await sleep(700);
  const dm1 = await p.evaluate(() => document.getElementById('acctBalNum').textContent);
  await sleep(1800);
  const dm2 = await p.evaluate(() => document.getElementById('acctBalNum').textContent);
  ok(nm(dm1) < 48000 && dm2 === 'UGX 48,000', 'coming back to Me from a page opened from it counts up again (' + dm1 + ' -> ' + dm2 + ')');
  await p.evaluate(() => { STATE.balance = 55000; renderAll(); }); await sleep(250);
  const em1 = await p.evaluate(() => document.getElementById('acctBalNum').textContent); await sleep(1200);
  const em2 = await p.evaluate(() => document.getElementById('acctBalNum').textContent);
  ok(nm(em1) > 48000 && nm(em1) < 55000 && em2 === 'UGX 55,000', 'a balance that changes while Me is open runs up from the old figure to the new one (' + em1 + ' -> ' + em2 + ')');
  await p.evaluate(() => { _lastDataAt = 0; STATE.balance = 0; STATE.totalWithdrawn = 0; renderAll(); switchTab('home'); });
  // tapping a Featured robot on Home must still scroll to its card while the dots are up and the page data is on its way
  await p.evaluate(() => { _lastDataAt = 0; _lastCfgAt = 0; switchTab('home'); }); await sleep(1200);
  await p.route('**/k7x2/investments', async (route) => { await sleep(900); route.continue().catch(() => {}); });
  const lastKey = await p.evaluate(() => { const c = [...document.querySelectorAll('[id^="prodCard-"]')]; return c.length ? c[c.length - 1].id.replace('prodCard-', '') : ''; });
  await p.evaluate((k) => { _lastDataAt = 0; goToShopProduct(k); }, lastKey); await sleep(250);
  const early = await p.evaluate(() => ({ veil: document.getElementById('navVeil').classList.contains('on'), y: Math.round(window.scrollY) }));
  ok(early.veil && early.y < 50, 'tapping a Featured robot shows the dots first, the page has not scrolled yet (scrollY ' + early.y + ')');
  ok(await until(() => !document.getElementById('navVeil').classList.contains('on'), null, 4000), 'the dots lift when the page data has come');
  await sleep(1800);
  ok(lastKey && await p.evaluate((k) => { const r = document.getElementById('prodCard-' + k).getBoundingClientRect(); return window.scrollY > 100 && Math.abs((r.top + r.height / 2) - innerHeight / 2) < 160; }, lastKey), 'and after they lift the page scrolls to that robot (its card ends up in the middle of the screen)');
  await p.unroute('**/k7x2/investments');
  await p.evaluate(() => { window._smartaiNavMs = 0; }); await sleep(700);
  await p.evaluate(() => switchTab('shop')); await sleep(60);
  ok(await p.evaluate(() => !document.getElementById('navVeil').classList.contains('on')), 'with window._smartaiNavMs = 0 (tests) no veil comes');
  ok(errs.length === 0, 'the member app raised no errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await ctx.close(); front.close();

  // ---- 4. the admin panel
  const sent = [];
  const settings = { brandName: 'Smart AI', minDeposit: 5000, minWithdraw: 5000, welcomeBonus: 7000, commL1: 27, commL2: 2, commL3: 1, withdrawFeePct: 15, maxWithdrawalsPerDay: 2, dailyCheckin: 250, depositMethodNames: 'Pay-B, Pay-A, Pay-D, Pay-C' };
  const icons = { level1: png, loader: png };
  const adm1 = staticServer(path.join(__dirname, 'admin'), false); await new Promise(r => adm1.listen(0, r));
  const ctx2 = await browser.newContext({ viewport: { width: 400, height: 900 }, serviceWorkers: 'block' });
  const ap = await ctx2.newPage(); const aerrs = [];
  ap.on('pageerror', e => aerrs.push(e.message));
  await ap.route('**/k7x2/**', route => { const rq = route.request(), pth = new URL(rq.url()).pathname.replace(/^\/k7x2/, ''); let body = {}; try { body = JSON.parse(rq.postData() || '{}'); } catch (_) {}
    let out = { status: 'success', message: 'ok', stats: {}, products: [], users: [], transactions: [], deposits: [], withdrawals: [] };
    if (pth === '/admin/check-key' || pth === '/admin/login') out = { status: 'success', token: 'tok', username: 'owner', role: 'owner' };
    if (pth === '/admin/settings') out = { status: 'success', settings };
    if (pth === '/admin/smartai-images') out = { status: 'success', icons, linkpreview: null };
    if (pth === '/admin/banner' || pth === '/admin/announcement-image') out = { status: 'success', image: null };
    if (pth === '/admin/brand-assets') out = { status: 'success', appIcon: null, appIconCustom: false };
    if (pth === '/admin/about-html') out = { status: 'success', html: '<p>About</p>' };
    if (pth === '/admin/smartai-image/clear') { sent.push(body.slot); delete icons[body.slot]; }
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(out) }); });
  await ap.goto('http://127.0.0.1:' + adm1.address().port + '/'); await sleep(500);
  await ap.fill('#keyInput', 'k'); await ap.click('#loginBtn'); await sleep(900);
  await ap.click('[data-tab="banners"]');
  await ap.waitForSelector('#iconFile_loader', { state: 'attached', timeout: 8000 });
  const heads = await ap.evaluate(() => [...document.querySelectorAll('#content h2.sec')].map(h => h.textContent.trim()));
  ok(heads.some(h => /^Animations/.test(h)), 'the Banners tab has an Animations card (' + heads.filter(h => /Animations|Icons/.test(h)).join(' | ') + ')');
  ok(await ap.evaluate(() => ['loader', 'level1', 'level2', 'level3', 'giftbox', 'giftopen', 'tick', 'cross'].every(k => !!document.getElementById('iconFile_' + k))), 'with an upload box for the loader, each level medal, the gift, the opened gift, the tick and the cross');
  ok(await ap.evaluate(() => /Default animation/.test(document.getElementById('iconFile_level2').closest('label').previousElementSibling.textContent)) && await ap.evaluate(() => /Custom picture/.test(document.getElementById('iconClear_level1').parentElement.textContent)), 'it says "Default animation" or "Custom picture" for each');
  ok(await ap.evaluate(() => document.getElementById('iconClear_level1').textContent.trim() === 'Back to default'), 'and the button to undo a custom picture reads Back to default');
  ok(await ap.evaluate(() => !document.querySelector('#iconFile_level1') || [...document.querySelectorAll('#content h2.sec')].filter(h => /^Icons/.test(h.textContent)).every(h => !h.nextElementSibling.querySelector('#iconFile_level1'))), 'the animations are not repeated in the long Icons box');
  await ap.click('#iconClear_level1'); for (let i = 0; i < 40 && !sent.includes('level1'); i++) await sleep(100);
  ok(sent.includes('level1'), 'Back to default sends the clear for the level1 slot');
  ok(aerrs.length === 0, 'the admin panel raised no errors' + (aerrs.length ? ': ' + aerrs.join(' | ') : ''));
  ok(serverErrors.length === 0, 'no server errors' + (serverErrors.length ? ': ' + serverErrors.slice(0, 2).join(' | ') : ''));
  await browser.close(); adm1.close();
  realLog('\n' + (fail ? 'FAIL' : 'PASS') + ': animations (' + pass + ' ok, ' + fail + ' failed)');
  process.exit(fail ? 1 : 0);
})().catch(e => { realLog('CRASH ' + (e && e.stack || e)); process.exit(1); });
