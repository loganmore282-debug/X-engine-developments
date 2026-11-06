'use strict';
// Owner: when a nav tab is tapped the selector box (the tan bubble) and the icon bounce TOGETHER, same direction and amount, twice, as one continuous spring with no gap; the label stays still.
const fs = require('node:fs'), assert = require('node:assert/strict');
const css = fs.readFileSync(__dirname + '/user-src/index.html', 'utf8'), js = fs.readFileSync(__dirname + '/user-src/original_module.js', 'utf8');
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); };
ok(/\.navitem\.nav-tap::before,\.navitem\.nav-tap \.nav-ic svg\{animation:navBubbleBounce \.66s cubic-bezier\(\.37,0,\.63,1\) 0s 1 normal none;\}/.test(css), 'the selector box (::before) and the icon (svg) play the SAME animation: same keyframes, same timing, one continuous spring');
const kf = css.match(/@keyframes navBubbleBounce\{([^]*?)\}\s*\n/)[1];
const stops = [...kf.matchAll(/(\d+)%\{transform:scale\(([\d.]+)\);\}/g)].map(m => [+m[1], +m[2]]);
ok(stops.length === 6 && stops[0][1] === 1 && stops[5][1] === 1, 'it starts and ends at normal size');
const ex = stops.slice(1, 5).map(x => x[1]);
ok(ex[0] < 1 && ex[1] > 1 && ex[2] < 1 && ex[3] > 1, 'two bounces: in, out, in, out (press in, spring out, twice)');
ok(Math.abs(ex[2] - 1) < Math.abs(ex[0] - 1) && Math.abs(ex[3] - 1) < Math.abs(ex[1] - 1), 'the second bounce is smaller than the first (it dies away)');
ok(stops.every((x, i) => i === 0 || x[0] > stops[i - 1][0]), 'in order, inside one animation: no pause between the bounces');
ok(!/\.navitem\.nav-tap[^{,]*\.lbl[^{]*\{[^}]*animation:/.test(css), 'the label stays still');
ok(!/navTapSignal|mgLbl/.test(css + js), 'the old separate icon / label bounce keyframes are gone');
ok(/animationName === 'navBubbleBounce'/.test(js), 'the tap class is cleaned off when the box has finished');
ok(/prefers-reduced-motion:reduce\)\{\.navitem\.nav-tap::before,\.navitem\.nav-tap \.nav-ic svg\{animation:none;\}\}/.test(css), 'and it stays still for people who ask for reduced motion');
// ── Profile: the cards appear one after another; the balance is written once ──
ok(/#pageHost\.mg-enter \.mg-my \.mg-me,#pageHost\.mg-enter \.mg-my \.mg-me-btns,#pageHost\.mg-enter \.mg-my \.mg-sec,#pageHost\.mg-enter \.mg-my \.mg-set \.mg-row,#pageHost\.mg-enter \.mg-my \.mg-logout\{animation:chCardIn \.55s [^;]*backwards;\}/.test(css), 'the Profile cards share one rise-and-settle animation (backwards only, so taps still work after it), tied to the page-in class so it replays every time');
const delays = [...css.matchAll(/#pageHost\.mg-enter \.mg-my \.mg-set \.mg-row:nth-child\((\d)\)\{animation-delay:\.(\d+)s;\}/g)].map(m => parseFloat('0.' + m[2]));
ok(delays.length === 6 && delays.every((d, i) => i === 0 || d > delays[i - 1]), 'the six settings tiles come in one after another');
ok(/prefers-reduced-motion:reduce\)\{#pageHost\.mg-enter \.mg-my \.mg-me/.test(css), 'and not at all for reduced motion');
ok(/function refreshProfileFigures\(\)/.test(js) && /refreshProfileFigures\(\);/.test(js) && !/countUp|\btween\b(?!\.)|animateNumber/i.test(js.replace(/never a tween/g, "")), 'Profile asks for the current account when it opens and writes the figures in one step (no counting animation anywhere)');
console.log('test-nav-bounce: ' + n + ' checks passed');
