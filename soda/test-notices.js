'use strict';
// The three dialogs from the owner's screenshots are live: tapping a Coming soon asset, buying without
// enough balance, and finishing the app download. Drives source (and --built) in JSDOM.
const fs = require('node:fs'), zlib = require('node:zlib'), assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const built = process.argv.includes('--built');
const html = fs.readFileSync(__dirname + (built ? '/user/index.html' : '/user-src/index.html'), 'utf8');
const source = fs.readFileSync(__dirname + '/user-src/original_module.js', 'utf8');
const dom = new JSDOM(html, { url: 'https://mysoda.p-colasoda.com/', runScripts: 'outside-only', pretendToBeVisual: true });
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
  ok(/BUY NOW/.test(w.vBuyHtml({ key: 'c', price: 1 })) && /openInvestConfirm/.test(w.vBuyHtml({ key: 'c', price: 1 })), 'an open asset still opens the confirm sheet');
  // Insufficient balance: the wording and the redirect are wired to the server's code.
  ok(/result\.code === 'INSUFFICIENT_BALANCE'/.test(source) && /Insufficient balance, redirecting to deposit\.\.\./.test(source) && /notify\('Insufficient balance, redirecting to deposit\.\.\.', \(\) => openDepositSheet\(\)\)/.test(source), 'insufficient balance dialog then Deposit');
  w.eval('closeNotify()'); let went = 0; w.openDepositSheet = () => { went++; };
  w.eval("notify('Insufficient balance, redirecting to deposit...', () => openDepositSheet())");
  ok(d.getElementById('notifyIc').classList.contains('err'), 'insufficient balance uses the cross icon');
  w.eval('closeNotify()'); ok(went === 1, 'closing it goes to Deposit');
  // Download: an accepted install shows the Download dialog; Confirm closes it.
  let prompted = 0; w._installPrompt = { prompt() { prompted++; }, userChoice: Promise.resolve({ outcome: 'accepted' }) };
  await w.promptInstallApp();
  const dl = d.getElementById('dlBg');
  ok(prompted === 1 && dl && dl.classList.contains('show'), 'accepted install shows the Download dialog');
  ok(dl.querySelector('h3').textContent === 'Download' && dl.querySelector('p').textContent === 'The app has been downloaded, please go to the browser to check and install it.' && dl.querySelector('button').textContent === 'Confirm', 'the screenshot words');
  w.eval(dl.querySelector('button').getAttribute('onclick')); ok(!dl.classList.contains('show'), 'Confirm closes it');
  w._installPrompt = { prompt() {}, userChoice: Promise.resolve({ outcome: 'dismissed' }) };
  await w.promptInstallApp(); ok(!dl.classList.contains('show'), 'a dismissed install shows no Download dialog');
  // The Buy Now confirm popup blurs its backdrop by exactly the notify dialog's amount.
  const css = html.match(/<style[\s\S]*?<\/style>/g).join('\n');
  const bgRule = sel => { const m = [...css.matchAll(new RegExp('(?:^|\\n|\\})\\s*' + sel.replace(/\./g, '\\.') + '\\{([^}]*)\\}', 'g'))].map(x => x[1]).filter(r => /backdrop-filter/.test(r)).pop() || ''; return (r => [(r.match(/rgba\([^)]*\)/) || [''])[0], (r.match(/(?<!-webkit-)backdrop-filter:\s*([^;]*)/) || ['', ''])[1]])(m); };
  const nb = bgRule('.notify-bg'), cb = bgRule('.confirm-bg');
  ok(nb[1] && nb[1] === cb[1] && nb[0] === cb[0], 'confirm backdrop has the same blur and tint as notify: ' + nb + ' vs ' + cb);
  console.log('test-notices: ' + n + ' checks passed' + (built ? ' (built)' : ''));
})().catch(e => { console.error(e); process.exit(1); });
