'use strict';
// Owner: when a nav tab is tapped the selector box (the tan bubble) and the icon bounce TOGETHER, same direction and amount, twice with no gap; the label stays still.
const fs = require('node:fs'), assert = require('node:assert/strict');
const css = fs.readFileSync(__dirname + '/user-src/index.html', 'utf8'), js = fs.readFileSync(__dirname + '/user-src/original_module.js', 'utf8');
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); };
ok(/\.navitem\.nav-tap::before,\.navitem\.nav-tap \.nav-ic svg\{animation:navBubbleBounce \.3s ease-out 0s 2 normal none;\}/.test(css), 'the selector box (::before) and the icon (svg) play the SAME animation: same keyframes, same timing, twice with no gap');
ok(/@keyframes navBubbleBounce\{0%\{transform:scale\(1\);\}30%\{transform:scale\(\.86\);\}65%\{transform:scale\(1\.07\);\}100%\{transform:scale\(1\);\}\}/.test(css), 'they squeeze in, spring past their size and settle: one scale, the same direction and amount for both');
ok(!/\.navitem\.nav-tap[^{,]*\.lbl[^{]*\{[^}]*animation:/.test(css), 'the label stays still');
ok(!/navTapSignal|mgLbl/.test(css + js), 'the old separate icon / label bounce keyframes are gone');
ok(/animationName === 'navBubbleBounce'/.test(js), 'the tap class is cleaned off when the box has finished');
ok(/prefers-reduced-motion:reduce\)\{\.navitem\.nav-tap::before,\.navitem\.nav-tap \.nav-ic svg\{animation:none;\}\}/.test(css), 'and it stays still for people who ask for reduced motion');
console.log('test-nav-bounce: ' + n + ' checks passed');
