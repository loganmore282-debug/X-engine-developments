'use strict';
// Announcement dialog: WhatsApp + Telegram group buttons (no email).
// Support page: WhatsApp, Telegram group, Telegram customer service, email.
// Drives the real source in JSDOM (and the built bundle with --built).
const fs = require('node:fs'), zlib = require('node:zlib'), assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const built = process.argv.includes('--built');
const html = fs.readFileSync(__dirname + (built ? '/user/index.html' : '/user-src/index.html'), 'utf8');
const source = fs.readFileSync(__dirname + '/user-src/original_module.js', 'utf8');
const dom = new JSDOM(html, { url: 'https://app.petro-cchnug.com/', runScripts: 'outside-only', pretendToBeVisual: true });
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
  w.eval('STATE.page="home";STATE.settings={annEnabled:true,annTitle:"Hello",annBody:"Body",whatsappGroup:"https://chat.whatsapp.com/abc",telegramGroup:"https://t.me/grp",supportTelegram:"https://t.me/agent",supportEmail:"help@x.com",supportHours:"8-5"}');
  w.maybeShowAnnouncement();
  const links = [...d.querySelectorAll('#annSheet .ann-cta a')];
  assert.deepEqual(links.map(a => a.className), ['whatsapp', 'telegram'], 'dialog: WhatsApp and Telegram group, nothing else'); n++;
  assert.equal(links[1].getAttribute('href'), 'https://t.me/grp'); n++;
  ok(/Groupe Telegram/.test(links[1].textContent) && links[1].querySelector('svg'), 'Telegram button has its label and icon');
  ok(!/mailto|Email/i.test(d.getElementById('annSheet').innerHTML), 'no email in the dialog');
  w.eval('STATE.settings.telegramGroup=""'); w.maybeShowAnnouncement();
  assert.deepEqual([...d.querySelectorAll('#annSheet .ann-cta a')].map(a => a.className), ['whatsapp'], 'a blank Telegram group hides its button'); n++;
  w.closeAnnouncement();
  w.eval('STATE.settings.telegramGroup="https://t.me/grp"'); w.openSupportSheet();
  const rows = [...d.querySelectorAll('.support-row')];
  assert.deepEqual(rows.map(r => r.querySelector('.t1').textContent), ['Chaîne WhatsApp', 'Groupe Telegram', 'Service client Telegram'], 'support page rows (no email)'); n++;
  assert.deepEqual(rows.map(r => r.getAttribute('href')), ['https://chat.whatsapp.com/abc', 'https://t.me/grp', 'https://t.me/agent']); n++;
  ok(rows[1].querySelector('.support-row-icon.telegram svg') && rows[2].querySelector('.support-row-icon.telegram svg'), 'both Telegram rows carry the Telegram icon');
  ok(rows[1].target === '_blank' && rows[2].target === '_blank', 'Telegram links open outside the app');
  w.closeSheet && w.closeSheet();
  w.eval('STATE.settings.supportTelegram="";STATE.settings.telegramGroup=""'); w.openSupportSheet();
  assert.deepEqual([...d.querySelectorAll('.support-row .t1')].map(e => e.textContent), ['Chaîne WhatsApp'], 'blank links are hidden'); n++;
  // Home Support tile: opens the group; email is gone everywhere
  ok(!/mailto|Email/i.test(String(w.openSupportGroup) + String(w.openSupportSheet) + String(w.paintForgotSupport)) && typeof w.openSupportMail === 'undefined', 'no email in the support code (a saved supportEmail is ignored)');
  const opened = []; w.open = u => { opened.push(u); return {}; };
  w.eval('STATE.settings={telegramGroup:"https://t.me/grp",whatsappGroup:"https://chat.whatsapp.com/abc"}'); w.openSupportGroup();
  w.eval('STATE.settings={whatsappGroup:"https://chat.whatsapp.com/abc"}'); w.openSupportGroup();
  assert.deepEqual(opened, ['https://t.me/grp', 'https://chat.whatsapp.com/abc'], 'Support opens the Telegram group, else the WhatsApp group'); n++;
  const toasts = []; w.notify = m => toasts.push(m); w.eval('STATE.settings={}'); w.openSupportGroup();
  ok(toasts.length === 1 && /groupe d'assistance n'est pas/.test(toasts[0]) && !/e-?mail/i.test(toasts[0]), 'no group set: says the group is not set up (no email wording)');
  console.log(`PASS: announcement and support contact links (${n} checks${built ? ', built bundle' : ''})`); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
