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
  w.eval('STATE.bankAccounts=[{id:"b1",network:"Wave",phone:"2250707070707",holder:"Jane Doe",isDefault:true}]');
  w.eval('openSheet("Bank Cards","");renderWalletSheet()');
  ok(d.querySelectorAll('#walCardBox .pt-bcard').length === 1 && /Wave/.test(d.querySelector('.pt-bcard').textContent) && /JANE DOE/.test(d.querySelector('.pt-bcard').textContent), 'the active card shows the provider and holder');
  ok(/0707 0707 07/.test(d.querySelector('.pt-bcard').textContent), 'the number is shown in groups of four');
  ok(!/deleteWallet|Delete wallet/.test(d.getElementById('sheetBody').innerHTML) && typeof w.deleteWallet === 'undefined', 'no delete / bin control');
  ok(!d.querySelector('.pt-ocard') && d.getElementById('walCount').textContent === '1/5', 'one card: no other cards, the counter says 1/5');
  w.eval('STATE.bankAccounts.push({id:"b2",network:"Wave",phone:"2250505050505",holder:"Bogere Med"});paintWalletParts()');
  ok(d.querySelectorAll('.pt-ocard').length === 1 && /0505 \*\*\*\* 0505/.test(d.querySelector('.pt-ocard').textContent) && /BOGERE MED/.test(d.querySelector('.pt-ocard').textContent) && d.getElementById('walCount').textContent === '2/5', 'a second card is listed under Other Cards and the counter says 2/5');
  w.eval('STATE.bankAccounts=[];openSheet("Bank Cards","");renderWalletSheet()');
  ok(/Aucun compte de retrait pour le moment/.test(d.querySelector('.pt-bcard').textContent) && /Remplissez le formulaire ci-dessous pour en ajouter un/.test(d.querySelector('.pt-bcard').textContent), 'no card yet: the empty message');
  ok(d.getElementById('walProvider').placeholder === 'Wave' && d.getElementById('walPhone').placeholder === 'Saisissez le numéro Wave' && d.getElementById('walHolder').placeholder === 'Nom du titulaire' && d.getElementById('walSaveBtn').textContent === 'Enregistrer le compte', 'the form words are French');
  ok([...d.querySelectorAll('#walProviderList .prov-opt')].map(e => e.textContent).join() === 'Wave', 'the provider list offers Wave and nothing else');
  await w.submitWallet();
  ok(/Veuillez remplir tous les champs/.test(d.getElementById('notifyMsg').textContent), 'an empty form is refused with the screenshot words');
  w.closeNotify();
  // Gift Code page: the owner's words only.
  w.openChestSheet();
  const t = d.getElementById('sheetBody').textContent.replace(/\s+/g, ' ').trim();
  ok(d.getElementById('sheetTitle').textContent === 'Code cadeau', 'title');
  ok(/^\u{1F381}?Code cadeau mystère\s*Un échange gratuit par jour Clé du code cadeau/u.test(t) && /Utiliser un code cadeau/.test(t) && /Historique des récompenses/.test(t) && /Plus d'enregistrements/.test(t), 'the French words: ' + t);
  ok(d.getElementById('chestKey').placeholder === 'Saisissez le code cadeau (T-XXXX)', 'key placeholder');
  ok(d.querySelector('.pt-gcbox') || d.querySelector('.pt-gchero'), 'gift picture hero');
  w.submitChestKey();
  ok(/Veuillez saisir le code cadeau/.test(d.getElementById('notifyMsg').textContent), 'empty key message');
  // About page: the admin's HTML is cleaned again before it is shown.
  const cleaned = w.ptCleanHtml('<h2 onclick="x()">Hi</h2><script>alert(1)</script><a href=" JaVa\nScript:alert(1)" target="_self">go</a><img src="x" onerror="y()"><iframe src="//x"></iframe><p style="background:url(javascript:alert(1))">ok</p><p>Fine <b>text</b></p>');
  ok(!/<script|onclick|onerror|javascript|iframe/i.test(cleaned) && /<h2>Hi<\/h2>/.test(cleaned) && /<p>Fine <b>text<\/b><\/p>/.test(cleaned) && /rel="noopener noreferrer"/.test(cleaned), 'the About page HTML loses scripts, frames, handlers and javascript: links but keeps normal markup: ' + cleaned);
  // Server and source wiring.
  ok(/const BANK_CARD_LIMIT = 5;/.test(server) && /app\.post\('\/bank\/select'/.test(server), 'server keeps up to five cards and can change the active one');
  ok(/Mot de passe du coffre au trésor incorrect/.test(server) && /Veuillez saisir la clé du coffre au trésor/.test(server), 'server chest messages');
  ok(/window\.ptWinDialog = /.test(source) && /Félicitations !/.test(source) && /Nouveau solde : /.test(source) && /ptWinDialog\(reward, after\)/.test(source) && !/function showChestWin/.test(source), 'claiming a gift code opens the Congratulations card (You won, amount, New Balance, Collect)');
  ok(/window\.ptClaimDialog = /.test(source) && /Réclamation réussie/.test(source), 'order gifts keep the Claim successful card');
  ok(!/notify\('Giftcode redeemed successfully'\)/.test(source), 'the plain toast no longer replaces the card');
  ok(!/id="depPhone"/.test(source), 'the Deposit page has no payment number box (the request goes to the member\'s own number)');
  ok(!/bank-transfer|getSupportedBanks|marzValidateBankAccount/.test(server) && !/supportedBanks/.test(source), 'the bank-transfer rail is gone: Bank Name is MTN or Airtel only');
console.log(`PASS: bank cards and gift code (${n} checks${built ? ', built bundle' : ''})`); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
