'use strict';
// Orders > Total Earnings = what the PRODUCTS paid (not other sources); Download App picture is a fixed layer; sheets and Records tabs replay the full-page
// appearing animation; the Profile cards replay on every return.
const fs = require('node:fs'), assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync(__dirname + '/user-src/index.html', 'utf8'), source = fs.readFileSync(__dirname + '/user-src/original_module.js', 'utf8');
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); };
const dom = new JSDOM(html, { url: 'https://choc.example.com/', runScripts: 'outside-only', pretendToBeVisual: true });
const w = dom.window, d = w.document;
w.scrollTo = () => {}; w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} }); w.open = () => null;
w.fetch = async () => ({ json: async () => ({ status: 'success', settings: {}, products: [], messages: [], accounts: [] }) });
for (const s of d.scripts) { if (s.type === 'module' || s.src) continue; if (s.hasAttribute('data-nx-core')) w.eval(source); else if (s.textContent.trim()) w.eval(s.textContent); }
(async () => {
  await new Promise(r => setTimeout(r, 30));
  // ── Orders: Total Earnings is the products' own earnings ──
  const inv = [{ id: 'a', status: 'active', tierKey: 'x', amount: 30000, paidOut: 1500 }, { id: 'b', status: 'matured', tierKey: 'x', amount: 90000, paidOut: 270000 }, { id: 'c', status: 'active', tierKey: 'x', amount: 1, paidOut: 0 }];
  w.api = async (p) => p === '/investments' ? { status: 'success', investments: inv } : p === '/account' ? { status: 'success', account: { walletBalance: 5, totalEarned: 999999 } } : p === '/public/products' ? { status: 'success', products: [] } : { status: 'success' };
  w.eval('STATE.account={walletBalance:5,totalEarned:999999}; STATE.investments=null; STATE.page="assets"');
  w.paintAssets(true);
  ok(d.getElementById('incomeTotal').textContent.trim() === '', 'before the products are known the figure is blank, not a wrong number');
  await w.renderAssets();
  const t = d.getElementById('incomeTotal').textContent;
  ok(/271,500/.test(t) && !/999,999/.test(t), 'Total Earnings is the sum of the products\' paid-out amounts (271,500), not the account\'s all-sources total: ' + t);
  w.eval('STATE.account.totalEarned=5000000'); w.patchHomeBalances();
  ok(/271,500/.test(d.getElementById('incomeTotal').textContent), 'a live refresh keeps the products-only figure');
  w.eval('STATE.investments=[]'); w.paintAssets();
  ok(/\b0\.00\b/.test(d.getElementById('incomeTotal').textContent), 'a member with no products has earned nothing from products');
  // ── sheets: the full-page appearing animation is restarted every time a page opens, and on a Records tab switch ──
  const sb = d.getElementById('sheetBg'); const seen = [];
  const desc = Object.getOwnPropertyDescriptor(w.CSSStyleDeclaration.prototype, 'animation');
  const style = sb.style; let log = [];
  const orig = style.setProperty.bind(style);
  const mo = new w.MutationObserver(() => log.push(sb.getAttribute('style') || ''));
  mo.observe(sb, { attributes: true, attributeFilter: ['style'] });
  w.eval('openSheet("Deposit", "<div>x</div>")'); await new Promise(r => setTimeout(r, 10));
  ok(typeof w.replaySheetIn === 'function' || /function replaySheetIn\(\)/.test(source), 'there is a replay helper for the open page');
  ok(/function openSheet\([^)]*\)\{[\s\S]*?replaySheetIn\(\);/.test(source), 'every page opened through openSheet (Deposit, Withdraw, Records, Messages, Bank Account, passwords, Download) replays it');
  ok(/window\.switchStatementCategory = function\(cat\)\{[\s\S]*?replaySheetIn\(\);/.test(source), 'switching the Records tabs (All / Deposit / Withdraw ...) replays it');
  mo.disconnect();
  // ── Download App: the picture is its own layer that sticks while the page scrolls ──
  w.STATE.downloadBg = 'data:image/png;base64,AAAA'; w.openDownloadPage();
  const dl = d.querySelector('#sheetBody .mg-dl'), bg = dl && dl.querySelector('.mg-dl-bg');
  ok(bg && /background-image:url\(/.test(bg.getAttribute('style')) && !/background-image/.test(dl.getAttribute('style') || ''), 'the uploaded picture is on its own layer, not on the scrolling page');
  ok(/\.mg-dl-bg\{position:sticky;top:0;/.test(html), 'that layer sticks to the top of the scroll area');
  ok(/\.mg-dl-btn\{position:sticky;top:318px;z-index:1;\}/.test(html), 'and the Download Now button is held at its resting place too, so it does not float up when the page scrolls');
  // ── Profile cards replay on every return ──
  ok(/#pageHost\.mg-enter \.mg-my \.mg-me,#pageHost\.mg-enter \.mg-my \.mg-me-btns,#pageHost\.mg-enter \.mg-my \.mg-sec,#pageHost\.mg-enter \.mg-my \.mg-set \.mg-row,#pageHost\.mg-enter \.mg-my \.mg-logout\{animation:chCardIn/.test(html), 'the card animation is tied to the page-in class');
  ok(/function replayPageIn\(\)\{[^}]*classList\.remove\('mg-enter'\)[^}]*offsetWidth[^}]*classList\.add\('mg-enter'\)/.test(source), 'which is removed and re-added to restart it');
  ok(/if \(wasOpen && !\(opts && opts\.navigating\)\) replayPageIn\(\)/.test(source), 'and re-added whenever a page opened from Profile is closed (the back arrow, the phone Back button)');
  console.log('test-orders-download-motion: ' + n + ' checks passed');
})().catch(e => { console.error(e); process.exit(1); });
