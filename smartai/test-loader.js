'use strict';
// The start-up animation (the owner's first GIF, built in code): static checks of the page, the two sprite sheets and the picture slots that went with the
// old red loader, then a real browser (the built page, 800 x 600 at one css pixel per GIF pixel) that draws chosen frames of the loop and reads the pixels back:
// the teal wedge, the dots and the sphere must sit where they sit in the GIF (the numbers below were measured on it).
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
ok(/<div id="loadingScreen">\s*<canvas id="ldCanvas" aria-hidden="true"><\/canvas>\s*<span class="sr-only" role="status" aria-live="polite">Loading<\/span>/.test(htmlText), 'the start-up screen is one canvas (and a hidden "Loading" for screen readers)');
ok(/#loadingScreen\{[^}]*background:#000a0e/.test(htmlText) && /\.sr-only\{/.test(htmlText), 'it is dark (the GIF\'s own background) from the first frame');
ok(!/id="ldBox"|class="ld-name"|id="ldFill"|id="ldPct"|ld-bar|ld-box|Loading\.\.\. /.test(htmlText + mod), 'the old loader (box picture, name, bar, "Loading... N%") is gone');
ok(/<link rel="preload" as="image" href="\/anim\/loader-sphere\.webp"/.test(htmlText), 'the sphere sheet starts downloading in the page head');
const script = (htmlText.match(/<script data-smartai-loader>([\s\S]*?)<\/script>/) || [, ''])[1];
ok(script.length > 6000, 'the animation script is in the page, before anything else');
ok(/var LOOP = 100, FRAME_MS = 40,/.test(script) && /3\.6 \* p/.test(script) && /35 - 3\.6 \* p/.test(script), 'a loop is 100 frames of 40 ms; the wedge turns 3.6 degrees a frame, the lit dots turn the other way');
ok(/for \(var j = 0; j < 36; j\+\+\)/.test(script) && /128\.73/.test(script), 'there are 36 dots on a ring of radius 128.73');
ok(/j < 71/.test(script) && /i < 365/.test(script) && /p - 34/.test(script), '71 sparkles trail the wedge and 365 fly out once a loop (frames 34 to 47)');
ok(/im\.src = '\/anim\/loader-sphere\.webp'/.test(script) && /var POSTER = 'data:image\/webp;base64,/.test(script), 'the sphere comes from its sheet; a tiny copy of frame 0 stands in until it has arrived');
ok(/window\._smartaiLoaderEnded = function/.test(script) && /window\._smartaiLoaderEnded\)\s*window\._smartaiLoaderEnded\(\)/.test(mod) && /setAttribute\('content', '#000a0e'\)/.test(script), 'the phone\'s status bar is dark with the animation and the sheet is let go of when the screen closes');
ok(/window\._smartaiLoaderStart = Date\.now\(\)/.test(script) && /window\._smartaiLoaderRestart = function/.test(script) && /window\._smartaiLoaderDraw = function/.test(script) && /_smartaiLoaderScale/.test(script), 'the app and the tests have their hooks');
ok(/if \(ls\.style\.display === 'none'\) return;/.test(script), 'the animation stops by itself when the screen is hidden');
ok(!/fireConfetti|confettiCanvas/.test(mod + htmlText), 'no confetti anywhere');

// ---- the app side: still at least 2.5 s, one way to hide it, no percentage or "Ready" any more ----
ok(/var LOADER_MIN_MS = 2500/.test(mod) && /function hideLoadingScreen\(\)/.test(mod), 'the screen stays for 2.5 seconds before the page opens, through one function');
ok(!/\$\('loadingScreen'\)\.style\.display = 'none'/.test(mod), 'and nothing hides it any other way');
ok(!/_smartaiLoaderProgress|_smartaiLoaderReady|LOADED_MS|READY_MS/.test(mod + htmlText), 'there is no percentage and no "Ready" step');
ok(/_smartaiLoaderMinMs/.test(mod), 'tests can shorten the minimum time');
ok(/window\._smartaiAuthFired = true;\s*window\.dispatchEvent\(new CustomEvent\('snow-auth'/.test(htmlText), 'the sign-in script records that it has announced who is signed in');
ok(/window\.addEventListener\('snow-auth', function\(ev\)\{ onFbAuthChanged\(ev\.detail\); \}\);[\s\S]{0,700}if \(window\._smartaiAuthFired && window\.fbAuth\) onFbAuthChanged\(window\.fbAuth\.currentUser\);/.test(mod), 'and the app picks that announcement up whichever of the two scripts is ready first');

// ---- the old loader picture is gone from the server and the admin panel ----
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
const sphere = fs.readFileSync(path.join(dir, 'loader-sphere.webp')), orb = fs.readFileSync(path.join(dir, 'pay-orb.webp'));
const sd = webp(sphere), od = webp(orb);
ok(sd && sd.w === 1920 && sd.h === 1920, 'loader-sphere.webp is a 10 x 10 sheet of 192 px frames (' + JSON.stringify(sd) + ')');
ok(od && od.w === 2240 && od.h === 2240, 'pay-orb.webp is a 10 x 10 sheet of 224 px frames (' + JSON.stringify(od) + ')');
ok(sphere.length < 260000 && orb.length < 260000, 'each sheet is under 260 kB (' + Math.round(sphere.length / 1024) + ' and ' + Math.round(orb.length / 1024) + ' kB)');
ok(/var CELL = 192|CELL = 192,/.test(script) && /var PAY_ORB_CELL = 224/.test(mod), 'the page reads the sheets with the same frame sizes');

// ---- a real browser: draw frames of the loop and read the pixels back ----
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
    const ctx = await browser.newContext({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 });
    await ctx.addInitScript(() => { window._smartaiLoaderScale = 1; window._smartaiLoaderMinMs = 1e9; });
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', e => errs.push(String(e)));
    await page.goto('http://127.0.0.1:' + srv.address().port + '/', { waitUntil: 'load' });
    await page.waitForFunction(() => window._smartaiLoaderDraw && window._smartaiLoaderDraw(0).sprite, null, { timeout: 15000 });
    // GIF pixels around the sphere's centre -> canvas pixels (the canvas is 300 x 300 at scale 1)
    const probe = (frame, pts) => page.evaluate(({ frame, pts }) => {
      const info = window._smartaiLoaderDraw(frame), cv = document.getElementById('ldCanvas'), c = cv.getContext('2d'), k = info.k;
      return { info, px: pts.map(([x, y]) => Array.from(c.getImageData(Math.round(cv.width / 2 + x * k), Math.round(cv.height / 2 + y * k), 1, 1).data)) };
    }, { frame, pts });
    const polar = (deg, r, dx = 0, dy = 0) => [dx + r * Math.sin(deg * Math.PI / 180), dy - r * Math.cos(deg * Math.PI / 180)];
    // frame 0: the wedge's hard edge is on the 12 o'clock line, its body to the left (330 to 360 degrees fully teal, fading out towards 306)
    const f0 = await probe(0, [polar(345, 110), polar(318, 110), polar(20, 110), polar(30, 128.73, 1.37, 1.11), polar(100, 128.73, 1.37, 1.11), polar(0, 0), polar(250, 118)]);
    const [wedgeSolid, wedgeTail, beyondEdge, dotLit, dotOff, sphereMid, empty] = f0.px;
    ok(wedgeSolid[3] > 235 && Math.abs(wedgeSolid[0] - 23) < 14 && Math.abs(wedgeSolid[1] - 198) < 16 && Math.abs(wedgeSolid[2] - 204) < 14, 'frame 0: the wedge is teal (23,198,204) where the GIF has it: ' + wedgeSolid);
    ok(wedgeTail[3] > 25 && wedgeTail[3] < 215, 'frame 0: and it fades out towards its tail: alpha ' + wedgeTail[3]);
    ok(beyondEdge[3] === 0, 'frame 0: nothing in front of its hard edge: ' + beyondEdge);
    ok(dotLit[3] > 235 && dotLit[0] > 170 && dotLit[1] > 185 && dotLit[2] > 225, 'frame 0: a dot of the lit stretch is pale blue-white (197,210,246): ' + dotLit);
    ok(dotOff[3] === 0, 'frame 0: a dot outside the lit stretch is not drawn: ' + dotOff);
    ok(sphereMid[3] === 255, 'frame 0: the sphere is drawn');
    ok(empty[3] === 0, 'frame 0: no wedge or dot where the GIF has none: ' + empty);
    // half a loop later the wedge has turned 180 degrees: the same ring spot that was teal is empty and the opposite one is teal
    const f50 = await probe(50, [polar(345, 110), polar(165, 110)]);
    ok(f50.px[0][3] === 0 && f50.px[1][3] > 235, 'frame 50: the wedge is on the other side of the ring');
    // the burst: a ring of sparkles flies out of the sphere around frame 38 and is gone again soon after. Counted in a quarter of the ring (230 to 300
    // degrees, 97 to 120 px out) that the wedge and its trailing sparkles are not in at frames 10, 38 and 60.
    const sparkles = frame => page.evaluate(({ frame }) => {
      const info = window._smartaiLoaderDraw(frame), cv = document.getElementById('ldCanvas'), c = cv.getContext('2d'), k = info.k, W = cv.width;
      const d = c.getImageData(0, 0, W, W).data; let cnt = 0;
      for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
        const dx = (x + 0.5 - W / 2) / k, dy = (y + 0.5 - W / 2) / k, r = Math.hypot(dx, dy); if (r < 97 || r > 120) continue;
        const ang = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360; if (ang < 230 || ang > 300) continue;
        if (d[(y * W + x) * 4 + 3] > 60) cnt++;
      }
      return cnt;
    }, { frame });
    const s10 = await sparkles(10), s38 = await sparkles(38), s60 = await sparkles(60);
    ok(s10 < 12 && s60 < 12 && s38 > 60, 'the sparkle burst peaks near frame 38 (' + s10 + ' at frame 10, ' + s38 + ' at 38, ' + s60 + ' at 60)');
    // the sphere really plays: frames 0 and 50 of the sheet differ a lot inside the sphere
    const diff = await page.evaluate(() => {
      const grab = f => { const i = window._smartaiLoaderDraw(f), cv = document.getElementById('ldCanvas'), c = cv.getContext('2d'), k = i.k; return c.getImageData(Math.round(cv.width / 2 - 60 * k), Math.round(cv.height / 2 - 60 * k), Math.round(120 * k), Math.round(120 * k)).data; };
      const a = grab(0), b = grab(50); let s = 0; for (let q = 0; q < a.length; q += 4) s += Math.abs(a[q] - b[q]) + Math.abs(a[q + 1] - b[q + 1]) + Math.abs(a[q + 2] - b[q + 2]);
      return s / (a.length / 4) / 3;
    });
    ok(diff > 25, 'the inside of the sphere changes from frame 0 to frame 50 (mean difference ' + Math.round(diff) + ')');
    // on a phone the animation scales to the screen and uses the device's sharpness
    const ctx2 = await browser.newContext({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 3 });
    await ctx2.addInitScript(() => { window._smartaiLoaderMinMs = 1e9; });
    const p2 = await ctx2.newPage(); p2.on('pageerror', e => errs.push(String(e)));
    await p2.goto('http://127.0.0.1:' + srv.address().port + '/', { waitUntil: 'load' });
    await p2.waitForFunction(() => window._smartaiLoaderDraw && window._smartaiLoaderDraw(0).sprite, null, { timeout: 15000 });
    const phone = await p2.evaluate(() => { const c = document.getElementById('ldCanvas'), r = c.getBoundingClientRect(); return { cssW: Math.round(r.width), px: c.width, cx: Math.round(r.left + r.width / 2), cy: Math.round(r.top + r.height / 2) }; });
    ok(phone.cssW >= 240 && phone.cssW <= 330 && phone.px === phone.cssW * 3, 'on a 360 px wide phone the animation fills most of the width and draws at 3x (' + JSON.stringify(phone) + ')');
    ok(Math.abs(phone.cx - 180) <= 1 && Math.abs(phone.cy - 390) <= 1, 'and sits in the middle of the screen');
    // it keeps moving by itself (not only when a test draws a frame)
    await p2.evaluate(() => window._smartaiLoaderRestart()); await p2.waitForTimeout(300);   // (drawing a frame by hand freezes the loop; restarting lets it run)
    const a1 = await p2.evaluate(() => document.getElementById('ldCanvas').toDataURL()); await p2.waitForTimeout(500);
    const a2 = await p2.evaluate(() => document.getElementById('ldCanvas').toDataURL());
    ok(a1 !== a2, 'the animation runs by itself');
    ok(errs.length === 0, 'no script errors: ' + errs.join(' | '));
  } finally { await browser.close(); srv.close(); }
  console.log(`PASS: start-up animation (${n} checks${built ? ', built bundle' : ''})`);
})().catch(e => { console.error('FAIL', e && e.message || e); process.exit(1); });
