'use strict';
// The start-up screen (the owner's robot loading GIF: 357 x 356, 12 frames, 130 ms each): static checks of the page and the sprite sheets, then a real phone-sized browser
// that plays it, reads the pixels back and checks that it moves at the GIF's own pace and that the words "SMART AI Loading..." are live text in the place of the GIF's own.
//   node test-loader.js           (source)      node test-loader.js --built      (the built page)
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
const built = process.argv.includes('--built');
const html = fs.readFileSync(__dirname + (built ? '/user/index.html' : '/user-src/index.html'), 'utf8');
const server = fs.readFileSync(__dirname + '/server.js', 'utf8');
const admin = fs.readFileSync(__dirname + '/admin-src/index.html', 'utf8');
const mod = fs.readFileSync(__dirname + '/user-src/original_module.js', 'utf8');
const htmlText = html.replace(/<script data-nx-core>[\s\S]*?<\/script>/, '');   // the built bundle's base64 blob can contain any short word by chance
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); };

// ---- the page ----
ok(/<div id="loadingScreen">\s*<div id="ldBox">\s*<canvas id="ldCanvas" aria-hidden="true"><\/canvas>\s*<div id="ldText" role="status" aria-live="polite">SMART AI Loading\.\.\.<\/div>/.test(htmlText), 'the start-up screen is the animation (one canvas) and the live words "SMART AI Loading..."');
ok(/#loadingScreen\{[^}]*background:#fefefe/.test(htmlText) && /\.sr-only\{/.test(htmlText), "it is white (the GIF's own white, #fefefe) from the first frame");
ok(/<link rel="preload" as="image" href="\/anim\/loader-robot\.webp"/.test(htmlText), 'the robot sheet starts downloading in the page head');
ok(!/loader-sphere|000a0e|ld-name|id="ldFill"|id="ldPct"|ld-bar/.test(htmlText + mod), 'the old glass-sphere loader, its dark page and the old name / bar / percentage are gone');
const script = (htmlText.match(/<script data-smartai-loader>([\s\S]*?)<\/script>/) || [, ''])[1];
ok(script.length > 2000, 'the animation script is in the page, before anything else');
ok(/var FW = 357, FH = 356, COLS = 4, N = 12, MS = 130;/.test(script), "a loop is the GIF's 12 frames of 130 ms (1.56 s), 357 x 356 each in a 4 x 3 sheet");
ok(/im\.src = '\/anim\/loader-robot\.webp'/.test(script), 'the frames come from the sheet');
ok(/window\._smartaiLoaderEnded = function/.test(script) && /window\._smartaiLoaderEnded\)\s*window\._smartaiLoaderEnded\(\)/.test(mod) && /setAttribute\('content', '#fefefe'\)/.test(script), "the phone's status bar is white with the animation and goes back when the app opens");
ok(/window\._smartaiLoaderStart = Date\.now\(\)/.test(script) && /window\._smartaiLoaderRestart = function/.test(script) && /window\._smartaiLoaderDraw = function/.test(script), 'the app and the tests have their hooks');
ok(/if \(ls\.style\.display === 'none'\) return;/.test(script), 'the animation stops by itself when the screen is hidden');
ok(!/fireConfetti|confettiCanvas/.test(mod + htmlText), 'no confetti anywhere');
const manifest = JSON.parse(fs.readFileSync(__dirname + '/user/manifest.json', 'utf8'));
ok(manifest.background_color === '#fefefe', "the installed app's splash colour is the same white");

// ---- the app side: still at least 2.5 s, one way to hide it, no percentage or "Ready" ----
ok(/var LOADER_MIN_MS = 2500/.test(mod) && /function hideLoadingScreen\(\)/.test(mod), 'the screen stays for 2.5 seconds before the page opens, through one function');
ok(!/\$\('loadingScreen'\)\.style\.display = 'none'/.test(mod), 'and nothing hides it any other way');
ok(!/_smartaiLoaderProgress|_smartaiLoaderReady|LOADED_MS|READY_MS/.test(mod + htmlText), 'there is no percentage and no "Ready" step');
ok(/_smartaiLoaderMinMs/.test(mod), 'tests can shorten the minimum time');
ok(/window\._smartaiAuthFired = true;\s*window\.dispatchEvent\(new CustomEvent\('snow-auth'/.test(htmlText), 'the sign-in script records that it has announced who is signed in');
ok(/window\.addEventListener\('snow-auth', function\(ev\)\{ onFbAuthChanged\(ev\.detail\); \}\);[\s\S]{0,700}if \(window\._smartaiAuthFired && window\.fbAuth\) onFbAuthChanged\(window\.fbAuth\.currentUser\);/.test(mod), 'and the app picks that announcement up even when it came first');
ok(!/loaderbg|loader-image/.test(server + admin + htmlText + mod), 'no loading-screen picture slot, route or upload box is left');

// ---- the sprite sheets ----
function webp(buf) {
  if (buf.length < 30 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') return null;
  let off = 12;
  while (off + 8 <= buf.length) {
    const tag = buf.toString('ascii', off, off + 4), len = buf.readUInt32LE(off + 4);
    if (tag === 'VP8X') return { w: 1 + buf.readUIntLE(off + 12, 3), h: 1 + buf.readUIntLE(off + 15, 3) };
    if (tag === 'VP8 ') return { w: buf.readUInt16LE(off + 14) & 0x3fff, h: buf.readUInt16LE(off + 16) & 0x3fff };
    off += 8 + len + (len & 1);
  }
  return null;
}
const dir = path.join(__dirname, 'user', 'anim');
ok(!fs.existsSync(path.join(dir, 'loader-sphere.webp')), 'the old sphere sheet is not shipped any more');
const robot = fs.readFileSync(path.join(dir, 'loader-robot.webp')), orb = fs.readFileSync(path.join(dir, 'pay-orb.webp'));
const rd = webp(robot), od = webp(orb);
ok(rd && rd.w === 1428 && rd.h === 1068, 'loader-robot.webp is a 4 x 3 sheet of 357 x 356 frames (' + JSON.stringify(rd) + ')');
ok(od && od.w === 2240 && od.h === 2240, 'pay-orb.webp (the payment page) is still its 10 x 10 sheet of 224 px frames');
ok(robot.length < 200000, 'the robot sheet is light (' + Math.round(robot.length / 1024) + ' kB)');
ok(fs.existsSync(__dirname + '/tools/make-robot-loader.py'), "the tool that cuts it from the owner's GIF is in the repo");

// ---- a real browser (a phone) ----
const { chromium } = require('playwright');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
const ROOT = path.join(__dirname, 'user');
const srv = http.createServer((req, res) => {
  let u = decodeURIComponent(req.url.split('?')[0]); if (u === '/') u = '/index.html';
  const f = path.join(ROOT, u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(fs.readFileSync(f));
});
(async () => {
  await new Promise(r => srv.listen(0, r));
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, isMobile: true, serviceWorkers: 'block' });
    await ctx.addInitScript(() => { window._smartaiLoaderMinMs = 1e9; });
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', e => errs.push(String(e)));
    await page.goto('http://127.0.0.1:' + srv.address().port + '/', { waitUntil: 'load' });
    await page.waitForFunction(() => window._smartaiLoaderDraw && window._smartaiLoaderDraw(0).sprite, null, { timeout: 15000 });
    // the box, the words and the page colour
    const lay = await page.evaluate(() => {
      const r = id => document.getElementById(id).getBoundingClientRect(), box = r('ldBox'), t = r('ldText'), cv = r('ldCanvas');
      return { box: [box.left, box.top, box.width, box.height], t: [t.left, t.top, t.width, t.height], cv: [cv.width, cv.height], text: document.getElementById('ldText').textContent, bg: getComputedStyle(document.getElementById('loadingScreen')).backgroundColor,
        weight: getComputedStyle(document.getElementById('ldText')).fontWeight, color: getComputedStyle(document.getElementById('ldText')).color, theme: document.querySelector('meta[name="theme-color"]').content };
    });
    ok(lay.text === 'SMART AI Loading...' && lay.text.indexOf('SMART AI') < lay.text.indexOf('Loading...'), 'the words read "SMART AI Loading..." (SMART AI before Loading...)');
    ok(lay.bg === 'rgb(254, 254, 254)' && lay.theme === '#fefefe', 'the page and the phone\'s status bar are white');
    ok(lay.box[2] >= 240 && lay.box[2] <= 300 && Math.abs(lay.box[0] + lay.box[2] / 2 - 180) <= 1 && Math.abs(lay.box[1] + lay.box[3] / 2 - 370) <= 1, 'on a 360 px phone the animation is about 290 px wide, in the middle of the screen (' + lay.box.map(Math.round) + ')');
    const tcy = lay.t[1] + lay.t[3] / 2, rel = (tcy - lay.box[1]) / lay.box[3];
    ok(Math.abs(rel - 0.809) < 0.012 && lay.t[0] >= 0 && lay.t[0] + lay.t[2] <= 360 && lay.weight >= 700 && /^rgb\(11, 26, 79\)$/.test(lay.color), 'the words sit where the GIF\'s "Loading..." was (81 % down), inside the screen, bold navy');
    // every frame: the GIF's own "Loading..." is wiped out (the band is white), the faces and arcs differ, the progress dots are there
    const frames = [];
    for (let f = 0; f < 12; f++) {
      frames.push(await page.evaluate(f => {
        const info = window._smartaiLoaderDraw(f), cv = document.getElementById('ldCanvas'), c = cv.getContext('2d'), W = cv.width, H = cv.height;
        const row = fy => Math.round(fy / 356 * H);
        const band = c.getImageData(0, row(270), W, row(304) - row(270)).data; let dark = 0; for (let i = 0; i < band.length; i += 4) if (band[i] + band[i + 1] + band[i + 2] < 600) dark++;
        const dots = c.getImageData(0, row(310), W, row(338) - row(310)).data; let blue = 0, grey = 0;
        for (let i = 0; i < dots.length; i += 4) { if (dots[i + 2] - dots[i] > 80 && dots[i + 2] > 180) blue++; else if (dots[i] < 215 && Math.abs(dots[i] - dots[i + 2]) < 40) grey++; }
        const top = c.getImageData(0, 0, W, row(262)).data; let h = 0; for (let i = 0; i < top.length; i += 37) h = (h * 31 + top[i]) >>> 0;
        return { frame: info.frame, dark, blue, grey, h };
      }, f));
    }
    ok(frames.every((x, i) => x.frame === i), 'all 12 frames of the sheet can be drawn');
    ok(frames.every(x => x.dark === 0), 'the GIF\'s own "Loading..." is gone from every frame (the band where it was is white)');
    ok(frames.filter(x => x.blue > 40).length >= 10 && frames.every(x => x.grey > 150), 'the five progress dots are in the frames: grey dots always, the blue one moving (' + frames.map(x => x.blue > 40 ? 'o' : '-').join('') + ')');
    ok(new Set(frames.map(x => x.h)).size === 12, 'the 12 frames are all different pictures (faces, arcs, sparkles)');
    // it runs by itself at the GIF's pace: sample the canvas every 20 ms for two loops and look at the changes
    await page.evaluate(() => window._smartaiLoaderRestart());
    const seq = await page.evaluate(async () => {
      const cv = document.getElementById('ldCanvas'), out = [], t0 = performance.now();
      while (performance.now() - t0 < 3300) { out.push([Math.round(performance.now() - t0), cv.toDataURL('image/png', 0.1).length + ':' + cv.toDataURL().slice(-60)]); await new Promise(r => setTimeout(r, 15)); }
      return out;
    });
    const changes = []; let prev = null; for (const [t, k] of seq) { if (k !== prev) { changes.push(t); prev = k; } }
    const gaps = changes.slice(1).map((t, i) => t - changes[i]).filter(g => g > 30);
    const median = gaps.slice().sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
    ok(changes.length >= 22 && Math.abs(median - 130) <= 25, 'it plays by itself, a new picture about every 130 ms (' + changes.length + ' changes in 3.3 s, typical gap ' + median + ' ms)');
    const first = seq.find(s => s[0] > 200)[1];   // the picture seen after the first frame is repeated once per loop: every 1.56 s
    const again = seq.filter(s => s[1] === first).map(s => s[0]);
    ok(again.length >= 2 && again.some(t => t > 1400 && t < 1800), 'and it loops: the same picture comes back after 1.56 s (' + again.filter((t, i) => i === 0 || t - again[i - 1] > 300).join(', ') + ' ms)');
    ok(errs.length === 0, 'no script errors: ' + errs.join(' | '));
  } finally { await browser.close(); srv.close(); }
  console.log(`PASS: start-up animation (${n} checks${built ? ', built bundle' : ''})`);
})().catch(e => { console.error('FAIL', e && e.message || e); process.exit(1); });
