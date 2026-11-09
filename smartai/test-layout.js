'use strict';
// Layout rules that keep full-screen pages from sliding sideways or showing content through their title bar.
// (Measured in a real browser at 320, 360 and 412 px on every screen; these keep the rules from being edited away.)
const fs = require('node:fs'), assert = require('node:assert/strict');
const css = fs.readFileSync(__dirname + '/user-src/index.html', 'utf8');
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); };
const last = sel => { const re = new RegExp('(?:^|\\n|\\})\\s*' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{([^}]*)\\}', 'g'); let m, r = ''; while ((m = re.exec(css))) r += m[1] + ';'; return r; };
ok(/overflow-x:\s*hidden/.test(last('.sheet-bg')), 'a full-screen page can never be dragged sideways (.sheet-bg overflow-x hidden)');
ok(/position:\s*relative/.test(last('.sheet-head')), 'the title bar scrolls away with the page, as in the owner\'s screenshots');
ok(/visibility:\s*hidden/.test(last('.notify-bg')) && !/pointer-events:\s*auto/.test(last('.notify-card')), 'a hidden notice dialog (and its OK button) never covers the page: the phone boxes and buttons under it stay tappable');
const admin = fs.readFileSync(__dirname + '/admin-src/index.html', 'utf8');
ok(admin.indexOf('Each product has its OWN multiplier') < admin.indexOf('<label>VIP level'), 'the product editor explains price / multiplier / payout right under those fields');
{ const m = /input:-webkit-autofill,[^{]*\{[^}]*transition:background-color 600000s 0s/.exec(fs.readFileSync(__dirname + '/user-src/index.html', 'utf8'));
  ok(!!m, 'a field Chrome autofills keeps no pale sheet behind the typed number'); }
{ const mod = fs.readFileSync(__dirname + '/user-src/original_module.js', 'utf8');
  ok(!/toLocaleString\('en-UG'/.test(mod) && /function numGroup\(/.test(mod), 'money commas are written by the app itself (numGroup), not left to the phone locale');
  ok(/const more = false;/.test(mod) || !/statementLoadMore/.test(mod), 'no Load More button under the Balance Detail list'); }
{ const idx = fs.readFileSync(__dirname + '/user-src/index.html', 'utf8');
  const rules = (idx.replace(/\/\*[\s\S]*?\*\//g, '').match(/[^{}]*\.prov-list[^{}]*\{[^}]*\}/g) || []);
  ok(rules.length > 0 && rules.every(r => !/overflow:\s*hidden/.test(r)), 'the wallet provider / bank list never switches scrolling off (a later rule used to set overflow:hidden)');
  ok(/\.prov-list\{[^}]*overflow-y:auto/.test(idx), 'the bank list inside the wallet form scrolls'); }
console.log('test-layout: ' + n + ' checks passed');
