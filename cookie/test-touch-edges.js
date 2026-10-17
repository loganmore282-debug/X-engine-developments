// Pull-down-to-refresh must work: nothing may block the browser's own edge drags.
const fs = require('fs'), assert = require('assert');
const html = fs.readFileSync(__dirname + '/user-src/index.html', 'utf8');
assert(!/Contain document edge drags/.test(html), 'the script that cancelled vertical drags at the page edges is gone');
assert(!/addEventListener\('touchmove'/.test(html), 'no touchmove handler cancels a drag');
assert(!/(^|[;{\s])(html|body|html,body)\s*\{[^}]*overscroll-behavior(-y)?:\s*none/m.test(html.replace(/html:has\([^)]*\),body:has\([^)]*\)\s*\{[^}]*\}/g, '')), 'the page itself no longer switches off pull-down-to-refresh');
console.log('test-touch-edges: pull-down-to-refresh is not blocked');
