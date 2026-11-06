'use strict';
// Profile (My): switching back to it shows the CURRENT balance in ONE jump -- never "UGX 0.00" counting up digit by digit.
const fs = require('node:fs'), assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync(__dirname + '/user-src/index.html', 'utf8'), source = fs.readFileSync(__dirname + '/user-src/original_module.js', 'utf8');
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); };
const dom = new JSDOM(html, { url: 'https://choc.example.com/', runScripts: 'outside-only', pretendToBeVisual: true });
const w = dom.window, d = w.document;
w.scrollTo = () => {}; w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} }); w.open = () => null;
w.fetch = async () => ({ json: async () => ({ status: 'success', settings: {}, products: [], messages: [], accounts: [] }) });
for (const s of d.scripts) { if (s.type === 'module' || s.src) continue; if (s.hasAttribute('data-nx-core')) w.eval(source); else if (s.textContent.trim()) w.eval(s.textContent); }
(async () => {
  await new Promise(r => setTimeout(r, 30));
  const writes = [];
  const watch = () => { const el = d.getElementById('myBalance'); const mo = new w.MutationObserver(() => writes.push(el.textContent)); mo.observe(el, { childList: true, characterData: true, subtree: true }); return mo; };
  let serverBalance = 12345.5, delay = 20; const calls = [];
  w.api = async (p) => { calls.push(p); if (p === '/account') { await new Promise(r => setTimeout(r, delay)); return { status: 'success', account: { phone: '0742730382', publicId: 10012, walletBalance: serverBalance } }; } return { status: 'success', messages: [] }; };
  // 1. the member was last on Profile with 1,000; it moved to 12,345.50 while they were on another tab
  w.eval('STATE.account={phone:"0742730382",publicId:10012,walletBalance:1000}; STATE.page="account"');
  await w.renderAccount();
  let el = d.getElementById('myBalance');
  ok(/1,000/.test(el.textContent) && !/\b0\.00\b/.test(el.textContent), 'it opens with the last known balance, not UGX 0.00: ' + el.textContent);
  const mo = watch(); await new Promise(r => setTimeout(r, 80)); mo.disconnect();
  ok(calls.includes('/account'), 'opening Profile asks for the current account at once');
  ok(/12,345\.50/.test(d.getElementById('myBalance').textContent), 'and shows the current balance: ' + d.getElementById('myBalance').textContent);
  ok(writes.length === 1 && /12,345\.50/.test(writes[0]), 'in ONE write of the final text (writes: ' + JSON.stringify(writes) + ')');
  // 2. nothing changed: no write at all
  writes.length = 0; w.eval('STATE.page="account"'); await w.renderAccount(); const mo2 = watch(); await new Promise(r => setTimeout(r, 80)); mo2.disconnect();
  ok(writes.length === 0, 'an unchanged balance is not rewritten');
  // 3. the balance is not known yet (first visit): hidden, then revealed once with the real figure -- never "UGX 0.00"
  w.eval('STATE.account=null; STATE.page="account"'); delay = 40; serverBalance = 777;
  await w.renderAccount(); el = d.getElementById('myBalance');
  ok(el.classList.contains('wait') && !/0\.00/.test(el.textContent), 'unknown balance: hidden, no "UGX 0.00" flash (class: ' + el.className + ')');
  const mo3 = watch(); writes.length = 0; await new Promise(r => setTimeout(r, 100)); mo3.disconnect();
  ok(!d.getElementById('myBalance').classList.contains('wait') && /777/.test(d.getElementById('myBalance').textContent) && writes.length === 1, 'then the real balance appears in one step: ' + d.getElementById('myBalance').textContent);
  // 4. leaving before the answer lands writes nothing onto another page
  w.eval('STATE.account={walletBalance:1,phone:"0742730382"}; STATE.page="account"'); delay = 60; await w.renderAccount(); w.eval('STATE.page="home"'); serverBalance = 5; await new Promise(r => setTimeout(r, 120));
  ok(!/\b5\b/.test(d.getElementById('myBalance') ? d.getElementById('myBalance').textContent : ''), 'a late answer is ignored once the member has left Profile');
  console.log('test-profile-balance: ' + n + ' checks passed');
})().catch(e => { console.error(e); process.exit(1); });
