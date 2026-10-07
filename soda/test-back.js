'use strict';
// The Back button and pop-up dialogs, and every tab opening at its top. Drives source (and --built) in JSDOM, which
// implements history.pushState / history.back and the popstate event. (The same flows were also run in a real browser.)
const fs = require('node:fs'), zlib = require('node:zlib'), assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const built = process.argv.includes('--built');
const html = fs.readFileSync(__dirname + (built ? '/user/index.html' : '/user-src/index.html'), 'utf8');
const source = fs.readFileSync(__dirname + '/user-src/original_module.js', 'utf8');
const dom = new JSDOM(html, { url: 'https://mysoda.p-colasoda.com/', runScripts: 'outside-only', pretendToBeVisual: true });
const w = dom.window, d = w.document;
const scrolls = []; w.scrollTo = (x, y) => scrolls.push([x, y]); w.HTMLElement.prototype.scrollIntoView = () => {}; w.matchMedia = () => ({ matches: true, addListener() {}, removeListener() {} });
w.fetch = async () => ({ json: async () => ({ status: 'success', settings: {}, products: [], messages: [], accounts: [] }) }); w.open = () => null;
for (const s of d.scripts) {
  if (s.type === 'module' || s.src) continue;
  if (s.hasAttribute('data-nx-core')) w.eval(built ? zlib.inflateSync(Buffer.from(s.textContent.match(/atob\("([A-Za-z0-9+/=]+)"\)/)[1], 'base64')).toString() : source);
  else if (s.textContent.trim()) w.eval(s.textContent);
}
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const helpOpen = () => d.getElementById('helpBg').classList.contains('show');
(async () => {
  await wait(50);
  // a dialog owns one history entry while it is open
  const len0 = w.history.length;
  w.openHelpDialog('Help');
  ok(helpOpen() && w.history.state && w.history.state.dlg, 'opening a dialog pushes one history entry');
  ok(w.history.length === len0 + 1, 'exactly one entry');
  // Back closes it (the popstate the browser fires) and does not go further
  w.history.back(); await wait(60);
  ok(!helpOpen(), 'Back closes the dialog');
  ok(!(w.history.state && w.history.state.dlg), 'and the history is back where it began');
  // closing with its own button removes the leftover entry a moment later
  w.openHelpDialog('Help'); w.closeHelpDialog(); ok(!helpOpen(), 'the Close button closes it at once');
  ok(w.history.state && w.history.state.dlg, '(its entry is still there for a moment, so a page opened right after cannot lose its own entry)');
  await wait(520);
  ok(!(w.history.state && w.history.state.dlg), 'after a moment the leftover entry is gone');
  // an entry left under a page is stepped over: open dialog, close it, open a sheet at once, close the sheet with Back
  w.openHelpDialog('Help'); w.closeHelpDialog(); w.openSheet('Wallet', '<p>x</p>');
  ok(d.getElementById('sheetBg').classList.contains('show'), 'a page opened right after a dialog closes opens normally');
  await wait(520);
  ok(w.history.state && w.history.state.sheet, 'the page keeps its own entry on top');
  w.history.back(); await wait(150);
  ok(!d.getElementById('sheetBg').classList.contains('show'), 'Back closes the page');
  await wait(150);
  ok(!(w.history.state && w.history.state.dlg), 'and the leftover dialog entry underneath is stepped over (one Back = one visible step)');
  // every tab opens at its top
  scrolls.length = 0; await w.showPage('network');
  ok(scrolls.some(s => s[0] === 0 && s[1] === 0), 'showPage scrolls to the top');
  ok(/window\.scrollTo\(0, 0\);\s*\/\/ every tab opens at its top/.test(source), 'and says why');
  console.log('test-back: ' + n + ' checks passed' + (built ? ' (built)' : '')); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
