// Dev-only screenshot runner for preview.html. Not shipped.
const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');

// ES modules cannot load over file:// — serve the folder for the run.
const MIME = { '.html':'text/html', '.js':'text/javascript', '.json':'application/json',
               '.png':'image/png', '.jpg':'image/jpeg', '.svg':'image/svg+xml' };
function serve() {
  return new Promise(res => {
    const s = http.createServer((req, rp) => {
      const f = path.join(process.cwd(), decodeURIComponent(req.url.split('?')[0]));
      fs.readFile(f, (e, d) => {
        if (e) { rp.writeHead(404); return rp.end(); }
        rp.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
        rp.end(d);
      });
    }).listen(0, '127.0.0.1', () => res(s));
  });
}

const SHOTS = [
  ['home',     'home',     null],
  ['products', 'products', null],
  ['team',     'team',     null],
  ['account',  'account',  null],
  ['recharge', 'home',     'recharge'],
  ['withdraw', 'home',     'withdraw'],
  ['records',  'home',     'records'],
  ['wrecords', 'home',     'wrecords'],
  ['checkin',  'home',     'checkin'],
  ['contact',  'home',     'contact'],
  ['mine',     'products', 'mine'],
  ['detail',   'products', 'detail'],
  ['bank',     'account',  'bank'],
  ['picker',   'account',  'picker'],
  ['toast',    'home',     'toast'],
  ['gift',     'account',  'gift'],
];

(async () => {
  const srv = await serve();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 420, height: 900 }, deviceScaleFactor: 2 });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

  await page.goto(`http://127.0.0.1:${srv.address().port}/preview.html`);
  await page.waitForFunction(() => !!window.__render, null, { timeout: 15000 });

  const out = process.argv[2] || 'shots';
  require('fs').mkdirSync(out, { recursive: true });

  for (const [name, tab, overlay] of SHOTS) {
    await page.evaluate(t => window.__render(t), tab);
    await page.evaluate(() => { const r = document.getElementById('modalRoot'); if (r) { r.classList.add('hidden'); r.innerHTML = ''; }
      const k = document.getElementById('pickerRoot'); if (k) { k.classList.add('hidden'); k.innerHTML = ''; }
      const t = document.getElementById('toastRoot'); if (t) t.innerHTML = ''; document.body.classList.remove('no-scroll'); });
    if (overlay) { await page.evaluate(o => window.__open(o), overlay); }
    else { await page.evaluate(() => { const r = document.getElementById('modalRoot'); if (r) { r.classList.add('hidden'); r.innerHTML = ''; } document.body.classList.remove('no-scroll'); }); }
    await page.waitForTimeout(450);
    await page.screenshot({ path: `${out}/${name}.png`, fullPage: !overlay });
  }

  console.log(errs.length ? 'PAGE ERRORS:\n' + [...new Set(errs)].join('\n') : 'no page errors');
  await browser.close();
  srv.close();
})();
