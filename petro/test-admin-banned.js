#!/usr/bin/env node
// Admin: the dashboard's "Banned users" card opens the Users tab filtered to banned accounts,
// and the Users tab has All / Active / Banned buttons with counts.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { JSDOM, VirtualConsole } = require('jsdom');
const zlib = require('node:zlib');
const built = process.argv.includes('--built');
let html = fs.readFileSync(__dirname + (built ? '/admin/index.html' : '/admin-src/index.html'), 'utf8');
if (built) html = html.replace(/<script data-nx-core>([\s\S]*?)<\/script>/, (_, loader) => {
  const code = zlib.inflateSync(Buffer.from(loader.match(/atob\("([A-Za-z0-9+/=]+)"\)/)[1], 'base64')).toString();
  return '<script>' + code + '</script>';
});
const users = [
  { id: 'u1', phone: '0771111111', referralCode: 'A1', walletBalance: 1000, totalInvested: 0, status: 'active', createdAt: '2026-10-01T00:00:00Z' },
  { id: 'u2', phone: '0772222222', referralCode: 'B2', walletBalance: 0, totalInvested: 5000, status: 'banned', createdAt: '2026-10-02T00:00:00Z' },
  { id: 'u3', phone: '0773333333', referralCode: 'C3', walletBalance: 50, totalInvested: 0, status: 'active', createdAt: '2026-10-03T00:00:00Z' },
  { id: 'u4', phone: '0774444444', referralCode: 'D4', walletBalance: 0, totalInvested: 0, status: 'banned', createdAt: '2026-10-04T00:00:00Z' },
];
const errors = [];
const vc = new VirtualConsole(); vc.on('jsdomError', e => errors.push(e.message));
const dom = new JSDOM(html, {
  url: 'https://petro-platform.com/admin/', runScripts: 'dangerously', virtualConsole: vc,
  beforeParse(w) {
    w.fetch = async () => ({ status: 200, ok: true, json: async () => ({ status: 'success', token: 't', username: 'owner', role: 'owner', settings: {}, users, products: [],
      stats: { totalUsers: 4, activeUsers: 2, bannedUsers: 2, walletTotal: 0, depositAmount: 0, withdrawAmount: 0, investedAmount: 0 } }) });
    w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
    w.Notification = { permission: 'denied' };
  },
});
const wait = ms => new Promise(r => setTimeout(r, ms));
setTimeout(async () => {
  const d = dom.window.document;
  try {
    d.getElementById('keyInput').value = 'k'; d.getElementById('loginBtn').click(); await wait(150);
    const card = d.getElementById('bannedCard');
    assert(card, 'the Banned users card is on the dashboard');
    assert.match(card.textContent, /tap to view/i);
    card.click(); await wait(150);
    assert.equal(d.querySelector('.tab.active').dataset.tab, 'users', 'tapping it opens the Users tab');
    const phones = () => [...d.querySelectorAll('#userRows tr[data-uid]')].map(tr => tr.dataset.uid).sort();
    assert.deepEqual(phones(), ['u2', 'u4'], 'only the banned accounts are listed');
    assert.deepEqual([...d.querySelectorAll('#userFilters [data-uf]')].map(b => b.textContent), ['All (4)', 'Active (2)', 'Banned (2)']);
    assert(d.querySelector('#userFilters [data-uf="banned"]').classList.contains('on'));
    d.querySelector('#userFilters [data-uf="active"]').click();
    assert.deepEqual(phones(), ['u1', 'u3'], 'Active shows the others');
    d.querySelector('#userFilters [data-uf="all"]').click();
    assert.equal(phones().length, 4, 'All shows everyone');
    d.querySelector('#userFilters [data-uf="banned"]').click();
    d.getElementById('userSearch').value = '0774'; d.getElementById('userSearch').dispatchEvent(new dom.window.Event('input'));
    assert.deepEqual(phones(), ['u4'], 'search works inside the banned list');
    d.querySelector('.tab[data-tab="dashboard"]').click(); await wait(100);
    d.querySelector('.tab[data-tab="users"]').click(); await wait(150);
    assert.equal(phones().length, 4, 'opening Users from the tab bar starts at All again');
    assert.deepEqual(errors, []);
    console.log('Admin banned-users view: pass');
  } catch (e) { console.error(e); process.exitCode = 1; }
  finally { dom.window.close(); }
}, 300);
