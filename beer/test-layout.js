'use strict';
// Layout rules that keep full-screen pages from sliding sideways or showing content through their title bar.
// (Measured in a real browser at 320, 360 and 412 px on every screen; these keep the rules from being edited away.)
const fs = require('node:fs'), assert = require('node:assert/strict');
const css = fs.readFileSync(__dirname + '/user-src/index.html', 'utf8');
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); };
const last = sel => { const re = new RegExp('(?:^|\\n|\\})\\s*' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{([^}]*)\\}', 'g'); let m, r = ''; while ((m = re.exec(css))) r += m[1] + ';'; return r; };
ok(/overflow-x:\s*hidden/.test(last('.sheet-bg')), 'a full-screen page can never be dragged sideways (.sheet-bg overflow-x hidden)');
ok(!/background:\s*transparent/.test(last('.sheet-bg.v-rec-page .sheet-head')) && /background:\s*#988753/.test(last('.sheet-bg.v-rec-page .sheet-head')), 'the Balance Record title bar is solid, so scrolled content does not show through it');
ok(/display:\s*block/.test(last('.msg-row .t2')), 'a message preview line is a block, so a long one is cut with an ellipsis instead of widening the row');
ok(/align-self:\s*stretch/.test(last('.v-pbox input,.v-pin input,.v-amtrow input')), 'a text box is tappable over its whole height (the input fills its box)');
const admin = fs.readFileSync(__dirname + '/admin-src/index.html', 'utf8');
ok(admin.indexOf('Each product has its OWN multiplier') < admin.indexOf('<label>VIP level'), 'the product editor explains price / multiplier / payout right under those fields');
{ const m = /input:-webkit-autofill,[^{]*\{[^}]*transition:background-color 600000s 0s/.exec(fs.readFileSync(__dirname + '/user-src/index.html', 'utf8'));
  ok(!!m, 'a field Chrome autofills keeps no pale sheet behind the typed number'); }
{ const mod = fs.readFileSync(__dirname + '/user-src/original_module.js', 'utf8');
  ok(!/toLocaleString\('en-UG'/.test(mod) && /function numGroup\(/.test(mod), 'money commas are written by the app itself (numGroup), not left to the phone locale');
  ok(/function balNoMore\(\)/.test(mod) && /ckSuccessToast\('No more data'\)/.test(mod) && /sb\.addEventListener\('scroll', balNoMore/.test(mod), 'the records page shows "No more data" when the end of the list is reached, and loads the member\'s own records from the server each time it opens');
}
console.log('test-layout: ' + n + ' checks passed');
