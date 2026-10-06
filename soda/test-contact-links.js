'use strict';
// Announcement dialog: one admin-uploaded portrait picture with Join Channel + Close.
// Drives the real source in JSDOM (and the built bundle with --built).
const fs = require('node:fs'), zlib = require('node:zlib'), assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const built = process.argv.includes('--built');
const html = fs.readFileSync(__dirname + (built ? '/user/index.html' : '/user-src/index.html'), 'utf8');
const source = fs.readFileSync(__dirname + '/user-src/original_module.js', 'utf8');
const dom = new JSDOM(html, { url: 'https://mysoda.p-colasoda.com/', runScripts: 'outside-only', pretendToBeVisual: true });
const w = dom.window, d = w.document;
w.scrollTo = () => {}; w.HTMLElement.prototype.scrollIntoView = () => {}; w.matchMedia = () => ({ matches: true, addListener() {}, removeListener() {} });
w.fetch = async () => ({ json: async () => ({ status: 'success', settings: {}, products: [], messages: [] }) }); w.open = () => null;
for (const s of d.scripts) {
  if (s.type === 'module' || s.src) continue;
  if (s.hasAttribute('data-nx-core')) w.eval(built ? zlib.inflateSync(Buffer.from(s.textContent.match(/atob\("([A-Za-z0-9+/=]+)"\)/)[1], 'base64')).toString() : source.replace('var _entryPromise', 'var _entryPromise'));
  else if (s.textContent.trim()) w.eval(s.textContent);
}
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); };
(async () => {
  await new Promise(r => setTimeout(r, 30));
  w.eval('STATE.page="home";STATE.announcementImage="data:image/png;base64,AAAA";STATE.settings={annTitle:"Hello",annBody:"Body",whatsappGroup:"https://chat.whatsapp.com/abc",telegramGroup:"https://t.me/grp",supportTelegram:"https://t.me/agent",supportEmail:"help@x.com",supportHours:"8-5"}');
  w.maybeShowAnnouncement();
  const sheet = d.getElementById('annSheet');
  ok(d.getElementById('annBg').classList.contains('show'), 'dialog opens with an admin picture');
  ok(sheet.querySelector('img.v-ann-img') && sheet.querySelector('img').getAttribute('src') === 'data:image/png;base64,AAAA', 'the picture is the admin upload');
  assert.deepEqual([...sheet.querySelectorAll('.v-ann-btns a, .v-ann-btns button')].map(e => e.textContent.trim()), ['Join Channel', 'Close'], 'buttons: Join Channel, Close, nothing else'); n++;
  assert.equal(sheet.querySelector('.v-ann-join').getAttribute('href'), 'https://t.me/grp', 'Join Channel = Telegram group'); n++;
  ok(!/Hello|Body|mailto|Email|WhatsApp/i.test(sheet.innerHTML), 'only the picture and the two buttons');
  w.eval('STATE.settings.telegramGroup=""'); w.maybeShowAnnouncement();
  assert.equal(d.querySelector('#annSheet .v-ann-join').getAttribute('href'), 'https://chat.whatsapp.com/abc', 'no Telegram group -> WhatsApp group'); n++;
  w.eval('STATE.settings.whatsappGroup=""'); w.maybeShowAnnouncement();
  assert.deepEqual([...d.querySelectorAll('#annSheet .v-ann-btns > *')].map(e => e.textContent.trim()), ['Close'], 'no link -> only Close'); n++;
  w.closeAnnouncement();
  ok(!d.getElementById('annBg').classList.contains('show'), 'Close hides it');
  w.eval('STATE.announcementImage=null'); d.getElementById('annSheet').innerHTML = ''; w.maybeShowAnnouncement();
  ok(!d.getElementById('annBg').classList.contains('show'), 'no picture uploaded -> no dialog');
  ok(typeof w.openSupportSheet === 'undefined', 'the old Support page is gone (Help dialog replaces it)');
  console.log(`PASS: announcement dialog (${n} checks${built ? ', built bundle' : ''})`); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
