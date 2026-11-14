// Coming soon button must look like the faded Confirm button: beer picture, dimmed like a disabled prompt button.
const fs = require('fs'), assert = require('assert');
const css = fs.readFileSync(__dirname + '/user-src/index.html', 'utf8');
const rule = css.match(/\.v-buy\.v-soon,#pageHost \.v-buy\.v-soon\{([^}]*)\}/);
assert(rule, 'faded Coming soon rule missing');
assert(/opacity:\.55/.test(rule[1]), 'Coming soon must be dimmed to .55');
const dim = css.match(/\.ck-prompt-btns button:disabled\{opacity:([.\d]+);\}/);
assert(dim && rule[1].includes('opacity:' + dim[1]), 'Coming soon dim must match the dimmed Confirm button');
assert(/\.v-buy[^{]*\{[^}]*background:var\(--bt-img\)[^}]*!important/.test(css), 'buy buttons must keep the beer picture');
console.log('PASS test-soon-button');
