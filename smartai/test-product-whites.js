'use strict';
// Product pictures on a white or very light grey backdrop are lifted to the card's own white, so every white matches (shop card, Home strip, My Products)
// and no grey block shows. A coloured backdrop (the blue default art) keeps a frame of its own corner colour.
//   node test-product-whites.js
const path = require('path'), http = require('http'), fs = require('fs');
process.chdir(__dirname);
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok   - ' + m); } else { fail++; console.log('  FAIL - ' + m); } };
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp' };
const srv = http.createServer((req, res) => {
  let f = req.url.split('?')[0]; if (f === '/' || !/\.[a-z0-9]+$/i.test(f)) f = '/index.html';
  fs.readFile(path.join(__dirname, 'user', path.normalize(f).replace(/^(\.\.[\/\\])+/, '')), (e, b) => { if (e) { res.writeHead(404); res.end('nf'); return; } res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(b); });
});
(async () => {
  const src = fs.readFileSync('user-src/original_module.js', 'utf8');
  ok(/function lightBackdropFilter/.test(src) && /_imgFx/.test(src) && /onload="fitImgBg\(this\)"/.test(src), 'the app lifts a light picture backdrop to white and runs it on every product picture');
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const { chromium } = require('playwright'); const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 390, height: 800 }, serviceWorkers: 'block' })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e.message)));
  await page.goto('http://127.0.0.1:' + srv.address().port + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof fitImgBg === 'function' && typeof imgTag === 'function', null, { timeout: 15000 });
  const run = (bg, cls) => page.evaluate(async ([bg, cls]) => {
    const c = document.createElement('canvas'); c.width = 80; c.height = 80; const x = c.getContext('2d');
    if (bg) { x.fillStyle = bg; x.fillRect(0, 0, 80, 80); }
    x.fillStyle = '#1d4ed8'; x.beginPath(); x.arc(40, 40, 18, 0, 7); x.fill();
    const url = c.toDataURL('image/png');
    const img = new Image(); if (cls) img.className = cls; img.src = url; document.body.appendChild(img);
    await new Promise(r => { img.onload = r; if (img.complete) r(); });
    fitImgBg(img);
    // the corner as it is DRAWN: the picture through its own filter
    const d = document.createElement('canvas'); d.width = 80; d.height = 80; const y = d.getContext('2d'); y.filter = img.style.filter || 'none'; y.drawImage(img, 0, 0);
    const p = y.getImageData(2, 2, 1, 1).data;
    return { filter: img.style.filter, bg: img.style.background, corner: [p[0], p[1], p[2]], cache: (window._imgFx || {})[url] };
  }, [bg, cls]);
  let r = await run('rgb(236,236,238)', 'prod-img');
  ok(/url\(["']?#wf-/.test(r.filter) && r.corner.every(v => v >= 252) && /var\(--card\)/.test(r.bg), 'a light grey backdrop (236) is lifted to white (' + r.corner + ') and framed in the card colour');
  r = await run('rgb(255,255,255)', 'prod-img');
  ok(!r.filter && /var\(--card\)/.test(r.bg), 'a pure white backdrop needs no filter and sits on the card colour');
  r = await run('rgb(246,245,240)', 'choc-img');
  ok(r.corner.every(v => v >= 252) && /var\(--card\)/.test(r.bg), 'an off-white backdrop on the Home strip becomes white too (' + r.corner + ')');
  r = await run('rgb(30,90,200)', 'prod-img');
  ok(!r.filter && /rgb\(30, ?90, ?200\)/.test(r.bg), 'a coloured backdrop keeps no filter and a frame of its own colour');
  r = await run('rgb(120,120,120)', 'prod-img');
  ok(!r.filter && /rgb\(120, ?120, ?120\)/.test(r.bg), 'a dark grey backdrop is not treated as white');
  r = await run(null, 'prod-img');
  ok(!r.filter && !r.bg, 'see-through corners change nothing (the page colour shows)');
  r = await run('rgb(238,238,238)', '');
  ok(/url\(["']?#wf-/.test(r.filter) && !r.bg, 'the small 48 px picture in My Products gets the lift but no frame colour');
  const tag = await page.evaluate(() => { const k = Object.keys(_imgFx)[0]; return imgTag({ image: k }, 'prod-img'); });
  ok(/filter:url\(#wf-/.test(tag) && /background:var\(--card\)/.test(tag), 'a repaint writes the filter and frame at once (no grey flash)');
  ok(errs.length === 0, 'no script errors' + (errs.length ? ': ' + errs[0] : ''));
  await browser.close(); srv.close();
  console.log('\n' + (fail ? 'FAIL' : 'PASS') + ': product picture whites (' + pass + ' ok, ' + fail + ' failed)'); process.exit(fail ? 1 : 0);
})().catch(e => { console.log('CRASH ' + (e && e.stack || e)); process.exit(1); });
