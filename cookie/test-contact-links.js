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
  w.eval('STATE.page="home";STATE.announcementImage="data:image/png;base64,AAAA";STATE.settings={annTitle:"Hello",annBody:"Body",whatsappGroup:"https://chat.whatsapp.com/abc",telegramGroup:"https://t.me/grp",supportTelegram:"https://t.me/agent",supportEmail:"help@x.com",supportHours:"8-5"}');
  w.maybeShowAnnouncement();
  ok(!d.getElementById('annBg').classList.contains('show'), 'the dialog does not appear at once: it waits for the loading box and then 1.5 seconds');
  await new Promise(r => setTimeout(r, 1000));
  ok(!d.getElementById('annBg').classList.contains('show'), 'still waiting 1 second in');
  await new Promise(r => setTimeout(r, 1100));
  const sheet = d.getElementById('annSheet');
  ok(d.getElementById('annBg').classList.contains('show'), 'dialog opens with an admin picture');
  ok(sheet.querySelector('img.ck-ann-img') && sheet.querySelector('img').getAttribute('src') === 'data:image/png;base64,AAAA', 'the banner is the admin upload');
  eq2(sheet.querySelector('.ck-ann-h').textContent, 'Hello', 'the title is the one the admin wrote');
  eq2(sheet.querySelector('.ck-ann-join').textContent.trim(), 'Join Group', 'the button says Join Group');
  eq2(sheet.querySelector('.ck-ann-join').getAttribute('href'), 'https://t.me/grp', 'Join Group = Telegram group');
  ok(!!sheet.querySelector('.ck-ann-x'), 'the red close cross is there');
  ok(!/mailto|Email|WhatsApp/i.test(sheet.innerHTML), 'no email or WhatsApp button');
  w.eval('STATE.settings.telegramGroup=""'); w.showAnnouncementNow();
  eq2(d.querySelector('#annSheet .ck-ann-join').getAttribute('href'), 'https://chat.whatsapp.com/abc', 'no Telegram group -> WhatsApp group');
  w.eval('STATE.settings.whatsappGroup=""'); w.showAnnouncementNow();
  ok(!d.querySelector('#annSheet .ck-ann-join'), 'no link -> no Join Group button');
  // the text: lines before the first blank line are the boxed rows, the rest is the paragraph
  w.eval('STATE.settings.annBody="Row one\\nRow two\\n\\nThe paragraph."'); w.showAnnouncementNow();
  ok(d.querySelectorAll('#annSheet .ck-ann-t div').length === 2 && /paragraph/.test(d.querySelector('#annSheet .ck-ann-p').textContent), 'boxed rows, then the paragraph');
  w.closeAnnouncement();
  ok(!d.getElementById('annBg').classList.contains('show'), 'the cross hides it');
  w.eval('STATE.announcementImage=null;STATE.settings.annTitle="";STATE.settings.annBody=""'); d.getElementById('annSheet').innerHTML = ''; w.showAnnouncementNow();
  ok(!d.getElementById('annBg').classList.contains('show'), 'nothing written and no picture -> no dialog');
  ok(typeof w.openSupportSheet === 'undefined', 'the old Support page is gone (Help dialog replaces it)');
  console.log(`PASS: announcement dialog (${n} checks${built ? ', built bundle' : ''})`); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
