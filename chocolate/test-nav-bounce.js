'use strict';
// Owner: only the selector box (the tan bubble) bounces when a nav tab is tapped, like a tapped product card; the icon and the label stay still.
const fs = require('node:fs'), assert = require('node:assert/strict');
const css = fs.readFileSync(__dirname + '/user-src/index.html', 'utf8'), js = fs.readFileSync(__dirname + '/user-src/original_module.js', 'utf8');
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); };
ok(/\.navitem\.nav-tap::before\{animation:navBubbleBounce [^}]*\}/.test(css), 'the selector box (::before) bounces on a tap');
ok(/@keyframes navBubbleBounce\{0%\{transform:scale\(1\);\}30%\{transform:scale\(\.86\);\}65%\{transform:scale\(1\.07\);\}100%\{transform:scale\(1\);\}\}/.test(css), 'it squeezes in, springs past its size and settles');
ok(!/\.navitem\.nav-tap[^{,]*(\.nav-ic|svg|\.lbl|supplied-icon)[^{]*\{[^}]*animation:/.test(css), 'no tap animation is left on the icon or the label');
ok(!/navTapSignal|mgLbl/.test(css + js), 'the old icon / label bounce keyframes are gone');
ok(/animationName === 'navBubbleBounce'/.test(js), 'the tap class is cleaned off when the box has finished');
ok(/prefers-reduced-motion:reduce\)\{\.navitem\.nav-tap::before\{animation:none;\}\}/.test(css), 'and it stays still for people who ask for reduced motion');
console.log('test-nav-bounce: ' + n + ' checks passed');
