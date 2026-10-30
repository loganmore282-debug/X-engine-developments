'use strict';
// One payout wallet (edited in place, no bin icon, no second row).
// Server: /bank/save replaces the single wallet. Drives source (and --built) in JSDOM.
const fs = require('node:fs'), zlib = require('node:zlib'), assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const built = process.argv.includes('--built');
const html = fs.readFileSync(__dirname + (built ? '/user/index.html' : '/user-src/index.html'), 'utf8');
const source = fs.readFileSync(__dirname + '/user-src/original_module.js', 'utf8');
const server = fs.readFileSync(__dirname + '/server.js', 'utf8');
const dom = new JSDOM(html, { url: 'https://mychocolate.chocolate.example.com/', runScripts: 'outside-only', pretendToBeVisual: true });
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
  // Wallet: one saved row is shown, prefilled, with no delete control anywhere.
  w.eval('STATE.bankAccounts=[{id:"b1",network:"MTN Mobile Money",phone:"256769968158",holder:"Jane Doe"}]');
  w.eval('openSheet("Bank Account","");renderWalletSheet()');
  ok(d.querySelectorAll('#walCardBox .v-wcard').length === 1 && /MTN MOBILE MONEY/.test(d.querySelector('.v-wcard').textContent) && /JANE DOE/.test(d.querySelector('.v-wcard').textContent), 'exactly one wallet card, with the provider and holder');
  ok(!/deleteWallet|Delete wallet/.test(d.getElementById('sheetBody').innerHTML), 'no delete / bin control');
  ok(d.getElementById('walToggleBtn').textContent === 'Edit Bank Account' && d.getElementById('walFormWrap').style.display === 'none', 'the card has an Edit Bank Account button; the form opens on tap');
  w.walShowForm(true);
  ok(d.getElementById('walProvider').value === 'MTN' && d.getElementById('walPhone').value === '0769968158' && d.getElementById('walHolder').value === 'JANE DOE', 'the form edits the saved wallet in place');
  ok(d.getElementById('walEditHead').textContent === 'Edit Bank Account', 'heading is Edit Bank Account');
  ok(typeof w.deleteWallet === 'undefined', 'deleteWallet is gone');
  w.eval('STATE.bankAccounts=[];openSheet("Bank Account","");renderWalletSheet()');
  ok(d.getElementById('walEditHead').textContent === 'Add Bank Account' && d.getElementById('walToggleBtn').textContent === 'Add Bank Account' && /\*\*\*\* \*\*\*\* \*\*\*\* \*\*\*\*/.test(d.querySelector('.v-wcard').textContent), 'no wallet yet: Add Bank Account and an empty card');
  // Server: one wallet, edited in place.
  ok(/MAX_SAVED_PAYOUT_ACCOUNTS = 1/.test(server), 'server keeps one wallet');
ok(/id="depPhone"/.test(source) && /post\('\/deposit\/marzpay', \{ amount, phone \}\)/.test(source), 'the Deposit page has an "Enter Payment Number" box and sends the typed number');
ok(/for="walPhone">Bank Account<\/label>/.test(source) && !/for="walPhone">Phone Number/.test(source), 'the account number field is labelled Bank Account');
ok(/\{4,64\}/.test(server) && !/\{4,34\}/.test(server), 'bank account numbers are not capped at 34 characters');
ok(/STATE\.supportedBanks && STATE\.supportedBanks\.length/.test(source), 'an empty bank list is not kept, so the wallet asks again next time');
console.log(`PASS: one wallet (${n} checks${built ? ', built bundle' : ''})`); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
