'use strict';
// Layout rules that keep full-screen pages from sliding sideways or showing content through their title bar.
// (Measured in a real browser at 320, 360 and 412 px on every screen; these keep the rules from being edited away.)
const fs = require('node:fs'), assert = require('node:assert/strict');
const css = fs.readFileSync(__dirname + '/user-src/index.html', 'utf8');
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); };
const last = sel => { const re = new RegExp('(?:^|\\n|\\})\\s*' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{([^}]*)\\}', 'g'); let m, r = ''; while ((m = re.exec(css))) r += m[1] + ';'; return r; };
ok(/overflow-x:\s*hidden/.test(last('.sheet-bg')), 'a full-screen page can never be dragged sideways (.sheet-bg overflow-x hidden)');
ok(/overflow:\s*hidden/.test(last('.v-recbal')), 'the soft blobs behind the balance are clipped, so they cannot widen the page');
ok(!/background:\s*transparent/.test(last('.sheet-bg.v-rec-page .sheet-head')) && /background:\s*#f5f6fd/.test(last('.sheet-bg.v-rec-page .sheet-head')), 'the Balance Record title bar is solid, so scrolled content does not show through it');
ok(/position:\s*sticky/.test(last('.v-rectabs')) && /top:\s*66\.5px/.test(last('.v-rectabs')), 'the filter tabs stay pinned under the title bar');
ok(/display:\s*block/.test(last('.msg-row .t2')), 'a message preview line is a block, so a long one is cut with an ellipsis instead of widening the row');
ok(/align-self:\s*stretch/.test(last('.v-pbox input,.v-pin input,.v-amtrow input')), 'a text box is tappable over its whole height (the input fills its box)');
const admin = fs.readFileSync(__dirname + '/admin-src/index.html', 'utf8');
ok(/\.topbar-inner\{[^}]*flex-wrap:\s*wrap/.test(admin) && /\.topbar-inner \.spacer\{flex:1 0 100%/.test(admin), 'the admin header controls wrap onto a second row on a phone instead of widening the page');
ok(/\.content\{padding:18px 14px 70px\}/.test(admin), 'the admin content keeps its side margin on a phone');
ok(admin.indexOf('Each product has its OWN multiplier') < admin.indexOf('<label>VIP level'), 'the product editor explains price / multiplier / payout right under those fields');
console.log('test-layout: ' + n + ' checks passed');
