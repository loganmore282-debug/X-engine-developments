'use strict';
// Announcement dialog: one admin-uploaded portrait picture with Join Channel + Close.
// Drives the real source in JSDOM (and the built bundle with --built).
const fs = require('node:fs'), zlib = require('node:zlib'), assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const built = process.argv.includes('--built');
const html = fs.readFileSync(__dirname + (built ? '/user/index.html' : '/user-src/index.html'), 'utf8');
const source = fs.readFileSync(__dirname + '/user-src/original_module.js', 'utf8');
const dom = new JSDOM(html, { url: 'https://mycookie.cookie.example.com/', runScripts: 'outside-only', pretendToBeVisual: true });
const w = dom.window, d = w.document;
w.scrollTo = () => {}; w.HTMLElement.prototype.scrollIntoView = () => {}; w.matchMedia = () => ({ matches: true, addListener() {}, removeListener() {} });
w.fetch = async () => ({ json: async () => ({ status: 'success', settings: {}, products: [], messages: [] }) }); w.open = () => null;
for (const s of d.scripts) {
  if (s.type === 'module' || s.src) continue;
  if (s.hasAttribute('data-nx-core')) w.eval(built ? zlib.inflateSync(Buffer.from(s.textContent.match(/atob\("([A-Za-z0-9+/=]+)"\)/)[1], 'base64')).toString() : source.replace('var _entryPromise', 'var _entryPromise'));
  else if (s.textContent.trim()) w.eval(s.textContent);
}
let n = 0; const eq2 = (a, b, m) => { n++; assert.equal(a, b, m); }; const ok = (c, m) => { n++; assert.ok(c, m); };
(async () => {
  await new Promise(r => setTimeout(r, 30));
  w.eval('_artLanded=true;STATE.page="home";STATE.announcementImage="data:image/png;base64,AAAA";STATE.settings={minWithdraw:20000,withdrawFeePct:15,withdrawWindowEnabled:true,withdrawOpenFrom:"07:00",withdrawOpenTo:"17:00",whatsappGroup:"https://chat.whatsapp.com/abc",telegramGroup:"https://t.me/grp",supportTelegram:"https://t.me/agent",supportEmail:"help@x.com",supportHours:"8-5"}');
  w.ckExpectLoad(); w.maybeShowAnnouncement();
  ok(!d.getElementById('annBg').classList.contains('show'), 'the dialog waits for the loading box to finish');
  await new Promise(r => setTimeout(r, 1300));
  const sheet = d.getElementById('annSheet');
  ok(d.getElementById('annBg').classList.contains('show'), 'dialog opens with an admin picture');
  ok(sheet.querySelector('img.ck-ann-img') && sheet.querySelector('img').getAttribute('src') === 'data:image/png;base64,AAAA', 'the banner is the admin upload');
  ok(/^Welcome to the .+ App$/.test(sheet.querySelector('.ck-ann-h').textContent), 'the title welcomes to the app by its name');
  const rowsTxt = [...sheet.querySelectorAll('.ck-ann-t div')].map(x => x.textContent);
  eq2(rowsTxt.join('|'), 'Daily income, daily withdrawal|Earnings at 00:00 AM|Withdrawal hours: 07:00\u201317:00|Minimum withdrawal: UGX 20,000|Taxes and fees: 15%', 'the lines come from the settings (hours, minimum, one fee)');
  ok(/never proactively ask for your password/.test(sheet.querySelector('.ck-ann-p').textContent), 'the closing sentence is there');
  eq2(sheet.querySelector('.ck-ann-join').textContent.trim(), 'Join Group', 'the button says Join Group');
  eq2(sheet.querySelector('.ck-ann-join').getAttribute('href'), 'https://t.me/grp', 'Join Group = Telegram group');
  ok(!!sheet.querySelector('.ck-ann-x'), 'the red close cross is there');
  eq2(sheet.querySelector('a.ck-ann-bn').getAttribute('href'), 'https://t.me/grp', 'tapping the customer service banner opens the Telegram group');
  ok(!/closeAnnouncement/.test(d.getElementById('annBg').getAttribute('onclick') || ''), 'tapping the empty area around the dialog does not close it');
  ok(!/mailto|Email|WhatsApp/i.test(sheet.innerHTML), 'no email or WhatsApp button');
  w.eval('STATE.settings.telegramGroup=""'); w.showAnnouncementNow();
  eq2(d.querySelector('#annSheet .ck-ann-join').getAttribute('href'), 'https://chat.whatsapp.com/abc', 'no Telegram group -> WhatsApp group');
  w.eval('STATE.settings.whatsappGroup=""'); w.showAnnouncementNow();
  ok(!d.querySelector('#annSheet .ck-ann-join'), 'no link -> no Join Group button');
  w.eval('STATE.settings.withdrawWindowEnabled=false;STATE.settings.minWithdraw=30000;STATE.settings.withdrawFeePct=10'); w.showAnnouncementNow();
  eq2([...d.querySelectorAll('#annSheet .ck-ann-t div')].slice(2).map(x => x.textContent).join('|'), 'Withdrawal hours: 24 hours|Minimum withdrawal: UGX 30,000|Taxes and fees: 10%', 'changed settings change the lines');
  w.closeAnnouncement();
  ok(!d.getElementById('annBg').classList.contains('show'), 'the cross hides it');
  ok(typeof w.openSupportSheet === 'undefined', 'the old Support page is gone (Help dialog replaces it)');
  console.log(`PASS: announcement dialog (${n} checks${built ? ', built bundle' : ''})`); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
