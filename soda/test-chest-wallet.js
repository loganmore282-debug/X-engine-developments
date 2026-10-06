'use strict';
// One payout wallet (edited in place, no bin icon, no second row) and the Treasure Chest page words.
// Server: /bank/save replaces the single wallet. Drives source (and --built) in JSDOM.
const fs = require('node:fs'), zlib = require('node:zlib'), assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const built = process.argv.includes('--built');
const html = fs.readFileSync(__dirname + (built ? '/user/index.html' : '/user-src/index.html'), 'utf8');
const source = fs.readFileSync(__dirname + '/user-src/original_module.js', 'utf8');
const server = fs.readFileSync(__dirname + '/server.js', 'utf8');
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
  // Wallet: one saved row is shown, prefilled, with no delete control anywhere.
  w.eval('STATE.bankAccounts=[{id:"b1",network:"MTN Mobile Money",phone:"256769968158",holder:"Jane Doe"}]');
  w.eval('openSheet("Wallet","");renderWalletSheet()');
  ok(d.querySelectorAll('.v-wal-row').length === 1, 'exactly one wallet row');
  ok(!d.querySelector('.v-wal-row button') && !/deleteWallet|Delete wallet/.test(d.getElementById('sheetBody').innerHTML), 'no delete / bin control');
  ok(d.getElementById('walProvider').value === 'MTN' && d.getElementById('walPhone').value === '0769968158' && d.getElementById('walHolder').value === 'JANE DOE', 'the form edits the saved wallet in place');
  ok(d.getElementById('walEditHead').textContent === 'Edit Wallet', 'heading is Edit Wallet');
  ok(typeof w.deleteWallet === 'undefined', 'deleteWallet is gone');
  w.eval('STATE.bankAccounts=[];openSheet("Wallet","");renderWalletSheet()');
  ok(d.getElementById('walEditHead').textContent === 'Bind Wallet' && !d.querySelector('.v-wal-row'), 'no wallet yet: Bind Wallet, no rows');
  // Treasure Chest: the owner's words only.
  w.openChestSheet();
  const t = d.getElementById('sheetBody').textContent.replace(/\s+/g, ' ').trim();
  ok(d.getElementById('sheetTitle').textContent === 'TREASURE CHEST', 'title');
  ok(t === 'MYSTERY TREASURE Enter your key to unlock the reward UNLOCK TREASURE', 'only the screenshot words: ' + t);
  ok(d.getElementById('chestKey').placeholder === 'Enter treasure chest key', 'key placeholder');
  ok(d.querySelector('.v-chest-keyic svg'), 'key icon');
  w.submitChestKey();
  ok(/Please enter the treasure chest key/.test(d.getElementById('notifyMsg').textContent), 'empty key message');
  // Server: one wallet, edited in place; chest messages.
  ok(/MAX_SAVED_PAYOUT_ACCOUNTS = 1/.test(server), 'server keeps one wallet');
  ok(/Wrong treasure chest password/.test(server) && /Please enter the treasure chest key/.test(server), 'server chest messages');
  ok(/function showChestWin\(reward, balance\)/.test(source) && /Congratulations!/.test(source) && /You won/.test(source) && /New Balance: /.test(source) && />COLLECT</.test(source), 'claiming a gift code opens the Congratulations card (You won, amount, New Balance, COLLECT)');
ok(!/notify\('Giftcode redeemed successfully'\)/.test(source), 'the plain toast no longer replaces the card');
console.log(`PASS: one wallet and treasure chest (${n} checks${built ? ', built bundle' : ''})`); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
