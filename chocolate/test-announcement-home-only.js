'use strict';
// The welcome announcement after Back from Deposit / Withdraw belongs on HOME only -- never on Profile, Orders, Promotion or Team.
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
  let shown = 0; w.maybeShowAnnouncement = () => { shown++; };
  const tryBack = async (page, title) => { shown = 0; w.eval('STATE.page=' + JSON.stringify(page)); w.maybeAnnounceAfterSheetBack(title); await new Promise(r => setTimeout(r, 450)); return shown; };
  for (const page of ['account', 'assets', 'promo', 'network']) for (const title of ['Deposit', 'Withdraw'])
    ok(await tryBack(page, title) === 0, `Back from ${title} opened on ${page}: no announcement`);
  for (const title of ['Deposit', 'Withdraw']) ok(await tryBack('home', title) === 1, `Back from ${title} opened on Home: the announcement shows`);
  ok(await tryBack('home', 'Messages') === 0 && await tryBack('home', 'Balance Record') === 0, 'other pages never trigger it');
  // the member leaves Home during the short wait: still nothing
  shown = 0; w.eval('STATE.page="home"'); w.maybeAnnounceAfterSheetBack('Deposit'); w.eval('STATE.page="account"'); await new Promise(r => setTimeout(r, 450));
  ok(shown === 0, 'if the member has moved to another page before it would show, it does not');
  console.log('test-announcement-home-only: ' + n + ' checks passed');
})().catch(e => { console.error(e); process.exit(1); });
