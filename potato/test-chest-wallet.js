'use strict';
// Bank Cards (up to five, the first is active, no bin icon) and the Gift Code page words.
// Server: /bank/save adds a card. Drives source (and --built) in JSDOM.
const fs = require('node:fs'), zlib = require('node:zlib'), assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const built = process.argv.includes('--built');
const html = fs.readFileSync(__dirname + (built ? '/user/index.html' : '/user-src/index.html'), 'utf8');
const source = fs.readFileSync(__dirname + '/user-src/original_module.js', 'utf8');
const server = fs.readFileSync(__dirname + '/server.js', 'utf8');
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
  // Bank Cards: the dark card shows the active card, the others are listed under "Other Cards", and there is no delete control anywhere.
  w.eval('STATE.bankAccounts=[{id:"b1",network:"MTN Mobile Money",phone:"256769968158",holder:"Jane Doe",isDefault:true}]');
  w.eval('openSheet("Bank Cards","");renderWalletSheet()');
  ok(d.querySelectorAll('#walCardBox .pt-bcard').length === 1 && /MTN Mobile Money/.test(d.querySelector('.pt-bcard').textContent) && /JANE DOE/.test(d.querySelector('.pt-bcard').textContent), 'the active card shows the provider and holder');
  ok(/0769 9681 58/.test(d.querySelector('.pt-bcard').textContent), 'the number is shown in groups of four');
  ok(!/deleteWallet|Delete wallet/.test(d.getElementById('sheetBody').innerHTML) && typeof w.deleteWallet === 'undefined', 'no delete / bin control');
  ok(!d.querySelector('.pt-ocard') && d.getElementById('walCount').textContent === '1/5', 'one card: no other cards, the counter says 1/5');
  w.eval('STATE.bankAccounts.push({id:"b2",network:"Airtel Money",phone:"256759968158",holder:"Bogere Med"});paintWalletParts()');
  ok(d.querySelectorAll('.pt-ocard').length === 1 && /0759 \*\*\*\* 8158/.test(d.querySelector('.pt-ocard').textContent) && /BOGERE MED/.test(d.querySelector('.pt-ocard').textContent) && d.getElementById('walCount').textContent === '2/5', 'a second card is listed under Other Cards and the counter says 2/5');
  w.eval('STATE.bankAccounts=[];openSheet("Bank Cards","");renderWalletSheet()');
  ok(/No bank cards yet/.test(d.querySelector('.pt-bcard').textContent) && /Fill the form below to add one/.test(d.querySelector('.pt-bcard').textContent), 'no card yet: the empty message');
  ok(d.getElementById('walProvider').placeholder === 'Type to search bank' && d.getElementById('walPhone').placeholder === 'Enter card number' && d.getElementById('walHolder').placeholder === 'Cardholder name' && d.getElementById('walSaveBtn').textContent === 'Save Card', 'the form words come from the screenshots');
  ok([...d.querySelectorAll('#walProviderList .prov-opt')].map(e => e.textContent).join() === 'MTN,Airtel', 'Bank Name offers MTN and Airtel, nothing else');
  await w.submitWallet();
  ok(/Please fill in all fields/.test(d.getElementById('notifyMsg').textContent), 'an empty form is refused with the screenshot words');
  w.closeNotify();
  // Gift Code page: the owner's words only.
  w.openChestSheet();
  const t = d.getElementById('sheetBody').textContent.replace(/\s+/g, ' ').trim();
  ok(d.getElementById('sheetTitle').textContent === 'Gift Code', 'title');
  ok(/^Mystery Gift Code\s*One free redeem per day Gift Code Key/.test(t) && /Redeem Gift Code/.test(t) && /Reward Records/.test(t) && /No more records/.test(t), 'only the screenshot words: ' + t);
  ok(d.getElementById('chestKey').placeholder === 'Enter gift code', 'key placeholder');
  ok(d.querySelector('.pt-gcbox') || d.querySelector('.pt-gchero'), 'gift picture hero');
  w.submitChestKey();
  ok(/Please enter the gift code/.test(d.getElementById('notifyMsg').textContent), 'empty key message');
  // About page: the admin's HTML is cleaned again before it is shown.
  const cleaned = w.ptCleanHtml('<h2 onclick="x()">Hi</h2><script>alert(1)</script><a href=" JaVa\nScript:alert(1)" target="_self">go</a><img src="x" onerror="y()"><iframe src="//x"></iframe><p style="background:url(javascript:alert(1))">ok</p><p>Fine <b>text</b></p>');
  ok(!/<script|onclick|onerror|javascript|iframe/i.test(cleaned) && /<h2>Hi<\/h2>/.test(cleaned) && /<p>Fine <b>text<\/b><\/p>/.test(cleaned) && /rel="noopener noreferrer"/.test(cleaned), 'the About page HTML loses scripts, frames, handlers and javascript: links but keeps normal markup: ' + cleaned);
  // Server and source wiring.
  ok(/const BANK_CARD_LIMIT = 5;/.test(server) && /app\.post\('\/bank\/select'/.test(server), 'server keeps up to five cards and can change the active one');
  ok(/Wrong treasure chest password/.test(server) && /Please enter the treasure chest key/.test(server), 'server chest messages');
  ok(/window\.ptClaimDialog = /.test(source) && /Claim successful/.test(source) && !/function showChestWin/.test(source), 'claiming a gift code opens the Claim successful card');
  ok(!/notify\('Giftcode redeemed successfully'\)/.test(source), 'the plain toast no longer replaces the card');
  ok(!/id="depPhone"/.test(source), 'the Deposit page has no payment number box (the request goes to the member\'s own number)');
  ok(!/bank-transfer|getSupportedBanks|marzValidateBankAccount/.test(server) && !/supportedBanks/.test(source), 'the bank-transfer rail is gone: Bank Name is MTN or Airtel only');
console.log(`PASS: bank cards and gift code (${n} checks${built ? ', built bundle' : ''})`); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
