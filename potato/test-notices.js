'use strict';
// The three dialogs from the owner's screenshots are live: tapping a Coming soon asset, buying without
// enough balance, and finishing the app download. Drives source (and --built) in JSDOM.
const fs = require('node:fs'), zlib = require('node:zlib'), assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const built = process.argv.includes('--built');
const html = fs.readFileSync(__dirname + (built ? '/user/index.html' : '/user-src/index.html'), 'utf8');
const source = fs.readFileSync(__dirname + '/user-src/original_module.js', 'utf8');
const dom = new JSDOM(html, { url: 'https://mypotato.potato.example.com/', runScripts: 'outside-only', pretendToBeVisual: true });
const w = dom.window, d = w.document;
w.scrollTo = () => {}; w.HTMLElement.prototype.scrollIntoView = () => {}; w.matchMedia = () => ({ matches: true, addListener() {}, removeListener() {} });
w.fetch = async () => ({ json: async () => ({ status: 'success', settings: {}, products: [], messages: [], accounts: [] }) }); w.open = () => null;
for (const s of d.scripts) {
  if (s.type === 'module' || s.src) continue;
  if (s.hasAttribute('data-nx-core')) w.eval(built ? zlib.inflateSync(Buffer.from(s.textContent.match(/atob\("([A-Za-z0-9+/=]+)"\)/)[1], 'base64')).toString() : source);
  else if (s.textContent.trim()) w.eval(s.textContent);
}
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); };
(async () => {
  await new Promise(r => setTimeout(r, 30));
  const tapSoon = html => { const box = d.createElement('div'); box.innerHTML = html; d.body.appendChild(box); const b = box.querySelector('button'); w.eval(b.getAttribute('onclick')); box.remove(); return b; };
  // Coming soon: both forms (no clock / with a countdown) answer a tap with the dialog.
  for (const p of [{ key: 'a', comingSoon: true }, { key: 'b', isOpen: false, opensAt: Date.now() + 3600000 }]) {
    w.eval('closeNotify()');
    const b = tapSoon(w.vBuyHtml(p));
    ok(!b.disabled, 'a Coming soon button must not be disabled (a disabled button swallows the tap)');
    ok(d.getElementById('notifyBg').classList.contains('show') && d.getElementById('notifyMsg').textContent === 'Coming soon, please wait', 'tap shows "Coming soon, please wait"');
    ok(d.getElementById('notifyIc').classList.contains('err'), 'with the cross icon');
  }
  ok(/BUY/.test(w.vBuyHtml({ key: 'c', price: 1 })) && /openInvestConfirm/.test(w.vBuyHtml({ key: 'c', price: 1 })), 'an open asset buys straight from the Buy Now button (no confirm sheet)');
  // Insufficient balance: the wording and the redirect are wired to the server's code.
  ok(/result\.code === 'INSUFFICIENT_BALANCE'/.test(source) && /Insufficient balance, redirecting to deposit\.\.\./.test(source) && /notify\('Insufficient balance, redirecting to deposit\.\.\.', \(\) => openDepositSheet\(\)\)/.test(source), 'insufficient balance dialog then Deposit');
  w.eval('closeNotify()'); let went = 0; w.openDepositSheet = () => { went++; };
  w.eval("notify('Insufficient balance, redirecting to deposit...', () => openDepositSheet())");
  ok(d.getElementById('notifyIc').classList.contains('err'), 'insufficient balance uses the cross icon');
  w.eval('closeNotify()'); ok(went === 1, 'closing it goes to Deposit');
  // Download: starting the install shows no pop-up of ours (owner: the "The app has been downloaded..." dialog is removed).
  let prompted = 0; w._installPrompt = { prompt() { prompted++; }, userChoice: Promise.resolve({ outcome: 'accepted' }) };
  await w.promptInstallApp();
  ok(prompted === 1 && !d.getElementById('dlBg') && !/has been downloaded/.test(d.body.innerHTML), 'an accepted install shows no Download dialog');
  ok(typeof w.openDownloadDialog === 'undefined', 'the Download dialog no longer exists');
  // The Buy Now confirm popup blurs its backdrop by exactly the notify dialog's amount.
  const css = html.match(/<style[\s\S]*?<\/style>/g).join('\n');
  const tint = sel => { const rules = [...css.matchAll(new RegExp('(?:^|\\n|\\})\\s*' + sel.replace(/\./g, '\\.') + '\\{([^}]*)\\}', 'g'))].map(x => x[1]).filter(r => /background:rgba/.test(r)); return ((rules.pop() || '').match(/background:(rgba\([^)]*\))/) || ['', ''])[1]; };
  const nb = tint('.notify-bg'), cb = tint('.confirm-bg');
  ok(nb && nb === cb, 'confirm backdrop has the same tint as notify: ' + nb + ' vs ' + cb);
  // The owner's word is "product": the old word must not come back in anything a member reads.
  ok(!/Buy Asset|Review this asset|No assets yet|Browse Assets|Could not load your assets|<span>Asset<\/span>|\|\| 'Asset'/.test(source), 'member text says product, not asset');
  ok(/No products yet/.test(source) && /Buy Now/.test(source), 'and the product wording is there');
  ok(/const stay = 2500;/.test(source) && !/2600|5500/.test(source.slice(source.indexOf('var _notifyTimer'), source.indexOf('var _notifyTimer') + 1500)), 'every notice closes by itself after exactly 2.5 seconds');
  console.log('test-notices: ' + n + ' checks passed' + (built ? ' (built)' : ''));
})().catch(e => { console.error(e); process.exit(1); });
