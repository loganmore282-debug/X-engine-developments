#!/usr/bin/env node
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

const errors = [];
const consoleBridge = new VirtualConsole();
consoleBridge.on('jsdomError', e => errors.push(e.message));
const dom = new JSDOM(html, {
  url: 'https://petro-platform.com/admin/', runScripts: 'dangerously', virtualConsole: consoleBridge,
  beforeParse(window) {
    window.fetch = async () => ({ status: 200, ok: true, json: async () => ({ status: 'success', token:'test-admin-token', username:'owner', role:'owner', settings: {}, users: [], products: [], stats:{totalUsers:1,walletTotal:12345,depositAmount:20000,withdrawAmount:5000,investedAmount:15000} }) });
    window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
    window.Notification = { permission: 'denied' };
  },
});
setTimeout(async () => {
  try {
    assert.deepEqual(errors, []);
    assert.equal(dom.window.document.querySelectorAll('#langLogin option').length, 6);
    assert.equal(dom.window.document.getElementById('regionSwitch'), null);
    dom.window.document.getElementById('keyInput').value = 'test-key';
    dom.window.document.getElementById('loginBtn').click();
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.match(dom.window.document.getElementById('content').textContent, /UGX 12,345/);
    console.log('Admin initializes with six translations and no country switch: pass');
  } catch (e) { console.error(e); process.exitCode = 1; }
  finally { dom.window.close(); }
}, 300);
