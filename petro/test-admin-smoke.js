#!/usr/bin/env node
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { JSDOM, VirtualConsole } = require('jsdom');

const errors = [];
const consoleBridge = new VirtualConsole();
consoleBridge.on('jsdomError', e => errors.push(e.message));
const dom = new JSDOM(fs.readFileSync(__dirname + '/admin-src/index.html', 'utf8'), {
  url: 'https://petro-platform.com/admin/', runScripts: 'dangerously', virtualConsole: consoleBridge,
  beforeParse(window) {
    window.fetch = async () => ({ status: 200, ok: true, json: async () => ({ status: 'success', settings: {}, users: [], products: [] }) });
    window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
    window.Notification = { permission: 'denied' };
  },
});
setTimeout(async () => {
  try {
    assert.deepEqual(errors, []);
    assert.equal(dom.window.eval('LANGS.length'), 6);
    assert.equal(dom.window.document.getElementById('regionSwitch'), null);
    await dom.window.eval(`
      api = async () => ({status:'success', stats:{totalUsers:1, walletTotal:12345,
        depositAmount:20000, withdrawAmount:5000, investedAmount:15000}});
      _tab = 'dashboard'; renderDashboard();
    `);
    assert.match(dom.window.document.getElementById('content').textContent, /UGX 12,345/);
    console.log('Admin initializes with six translations and no country switch: pass');
  } catch (e) { console.error(e); process.exitCode = 1; }
  finally { dom.window.close(); }
}, 300);
