'use strict';
// Announcement dialog: one admin-uploaded portrait picture with Join Channel + Close.
// Drives the real source in JSDOM (and the built bundle with --built).
const fs = require('node:fs'), zlib = require('node:zlib'), assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const built = process.argv.includes('--built');
const html = fs.readFileSync(__dirname + (built ? '/user/index.html' : '/user-src/index.html'), 'utf8');
const source = fs.readFileSync(__dirname + '/user-src/original_module.js', 'utf8');
const dom = new JSDOM(html, { url: 'https://mypotato.potato.example.com/', runScripts: 'outside-only', pretendToBeVisual: true });
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
  w.eval('STATE.page="home";STATE.announcementImage="data:image/png;base64,AAAA";STATE.settings={telegramGroup:"https://t.me/grp",supportTelegram:"https://t.me/agent",supportEmail:"help@x.com",supportHours:"8-5"}');
  w.maybeShowAnnouncement();
  const sheet = d.getElementById('annSheet');
  ok(d.getElementById('annBg').classList.contains('show'), 'dialog opens with an admin picture');
  ok(sheet.querySelector('img.mg-ann-img') && sheet.querySelector('img').getAttribute('src') === 'data:image/png;base64,AAAA', 'the picture is the admin upload');
  ok(sheet.querySelector('.mg-ann-x') && sheet.querySelector('.mg-ann-join').textContent.trim() === 'Join Channel', 'X top right and Join Channel');
  assert.equal(sheet.querySelector('.mg-ann-join').getAttribute('href'), 'https://t.me/grp', 'Join Channel = Telegram group'); n++;
  ok(!/mailto|Email|WhatsApp/i.test(sheet.innerHTML), 'no email or WhatsApp extras');
  w.eval('STATE.settings.telegramGroup=""'); w.maybeShowAnnouncement();
  ok(!d.querySelector('#annSheet .mg-ann-join'), 'no link -> no Join Channel button');
  w.closeAnnouncement();
  ok(!d.getElementById('annBg').classList.contains('show'), 'Close hides it');
  w.eval('STATE.announcementImage=null;STATE.settings.telegramGroup=""'); d.getElementById('annSheet').innerHTML = ''; w.maybeShowAnnouncement();
  ok(!d.getElementById('annBg').classList.contains('show'), 'no picture -> no dialog');
  ok(typeof w.openSupportSheet === 'undefined', 'the old Support page is gone ');
  console.log(`PASS: announcement dialog (${n} checks${built ? ', built bundle' : ''})`); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
