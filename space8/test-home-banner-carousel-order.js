/* SPACE8 -- HOME BANNER CAROUSEL PLAYS BACK IN UPLOAD ORDER (not reversed)
   Codex-verified real bug (2026-08-18, Low severity) in homeBannerHtml()
   (user-src/original_module.js): the pure-CSS carousel trick phase-shifts
   each <img>'s shared cs-cycle animation with a per-index animation-delay
   so exactly one slide is visible at a time. The first version used a
   NEGATIVE delay of -(i*holdSec) for slide i -- the more commonly-quoted
   form of this trick, but wrong here. Working through the actual CSS
   `steps(1)` semantics: a negative delay of -D makes an animation behave
   as though it already started D seconds ago, i.e. local time
   tau_i(t) = (t + i*holdSec) mod totalSec. Solving for when that lands in
   the visible window [0,holdSec) gives real-time visibility windows in
   REVERSE order after the first slide (0, n-1, n-2, ..., 1), not upload
   order -- confirmed for n=3 below. A POSITIVE delay of +(i*holdSec)
   instead means the animation doesn't start until real time i*holdSec,
   at which point its own local clock begins from frame zero -- giving
   exactly the window [i*holdSec, (i+1)*holdSec) in upload order, with the
   "hasn't started yet" pre-delay state naturally showing the rule's own
   base opacity:0 (CSS's default fill-mode behaviour), no extra fill-mode
   needed.

   This can't be observed through a real browser in this environment (no
   DOM/CSS engine here), so this file does the next most direct thing:
   extracts the REAL animation-delay values homeBannerHtml() actually
   generates for a 3-slide input straight out of the shipped source (not a
   reimplementation that could silently drift from the real function), and
   runs them through a faithful simulation of CSS steps(1) timing (the
   exact semantics hand-derived above and cross-checked against the MDN-
   documented behaviour of steps(1)/jump-end) to compute which slide is
   actually visible across a full cycle. Also reproduces the ORIGINAL bug
   (negative delays) side by side, so the contrast is explicit rather than
   asserted on faith.

   Run: node test-home-banner-carousel-order.js   (exits 0 = all green)  */

const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   - ' + name); }
  else { fail++; console.log('  FAIL - ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}

// Faithful simulation of `animation: cs-cycle {totalSec}s steps(1) infinite;`
// with `animation-delay: {delaySec}s` (positive OR negative), for the exact
// two-keyframe shape homeBannerHtml() generates: 0%{opacity:1}, X%{opacity:0},
// 100%{opacity:0}, where X = 100/n. steps(1)/jump-end holds the START
// keyframe's value for the whole segment, then snaps to the END value
// exactly at the segment boundary. A negative delay of -D means local time
// = (realTime + D) mod totalSec; a positive delay of +D means the
// animation hasn't started (shows the base declared value, opacity:0 here)
// until realTime >= D, after which local time = (realTime - D) mod totalSec.
function isVisibleAt(delaySec, holdSec, totalSec, realTime) {
  if (delaySec > 0 && realTime < delaySec) return false; // not started yet -- base opacity:0
  const localTime = delaySec >= 0
    ? (realTime - delaySec + totalSec * 1000) % totalSec // large multiple keeps it positive
    : (realTime + Math.abs(delaySec) + totalSec * 1000) % totalSec;
  return localTime < holdSec; // steps(1): opacity:1 holds for [0, holdSec), then snaps to 0
}
function visibleOrderOverOneCycle(delays, holdSec, totalSec) {
  const order = [];
  // Sample the midpoint of each holdSec-wide slot -- avoids any boundary-
  // instant ambiguity, same as asking "who's on screen partway through
  // this slide's intended turn."
  for (let slot = 0; slot < delays.length; slot++) {
    const sampleT = slot * holdSec + holdSec / 2;
    const visible = delays.map((d, i) => ({ i, v: isVisibleAt(d, holdSec, totalSec, sampleT) })).filter(x => x.v).map(x => x.i);
    order.push(visible.length === 1 ? visible[0] : visible);
  }
  return order;
}

(async () => {
  console.log('\n== Sanity: the simulation itself reproduces the documented bug for NEGATIVE delays ==');
  // This is the OLD, buggy formula this file exists to guard against ever
  // coming back: delay = -(i*holdSec).
  const n = 3, holdSec = 4, totalSec = holdSec * n;
  const negativeDelays = [0, 1, 2].map(i => -(i * holdSec));
  const buggyOrder = visibleOrderOverOneCycle(negativeDelays, holdSec, totalSec);
  check('negative delays reproduce the reported bug: visible order 0,2,1 (NOT upload order)', JSON.stringify(buggyOrder) === JSON.stringify([0, 2, 1]), buggyOrder);

  console.log('\n== The REAL, shipped homeBannerHtml() now generates POSITIVE delays, and plays back in upload order ==');
  const modPath = path.join(__dirname, 'user-src', 'original_module.js');
  const src = fs.readFileSync(modPath, 'utf8');
  const fnMatch = src.match(/function homeBannerHtml\(\)\{[\s\S]*?\n\}/);
  check('found homeBannerHtml() in the real source', !!fnMatch, modPath);
  const fnSrc = fnMatch[0];
  check('the shipped source no longer contains the buggy NEGATIVE-delay form', !fnSrc.includes('animation-delay:-'), fnSrc);
  check('the shipped source generates the POSITIVE-delay form', fnSrc.includes('animation-delay:\' + (i * holdSec)'), fnSrc);

  // Evaluate the REAL function (plus its two tiny real dependencies) in an
  // isolated context, exactly as the browser would run it, then extract the
  // actual per-image delay values it produced for 3 slides -- not a
  // reimplementation of the formula, the literal shipped code.
  const escMatch = src.match(/function esc\(s\)\{[\s\S]*?\n\}/);
  const bannerHtmlMatch = src.match(/function bannerHtml\(key, fallbackIcon\)\{[\s\S]*?\n\}/);
  check('found esc() and bannerHtml() dependencies in the real source', !!escMatch && !!bannerHtmlMatch);
  const vm = require('vm');
  const sandbox = { STATE: { homeSlides: ['https://x/1.png', 'https://x/2.png', 'https://x/3.png'], banners: {} }, ico: () => '' };
  vm.createContext(sandbox);
  vm.runInContext(escMatch[0] + '\n' + bannerHtmlMatch[0] + '\n' + fnSrc + '\nvar __out = homeBannerHtml();', sandbox);
  const html = sandbox.__out;
  const delayMatches = [...html.matchAll(/animation-delay:(-?\d+)s/g)].map(m => parseInt(m[1], 10));
  check('generated exactly 3 delay values, one per slide', delayMatches.length === 3, delayMatches);
  check('delays are 0, 4, 8 in upload order (positive, increasing)', JSON.stringify(delayMatches) === JSON.stringify([0, 4, 8]), delayMatches);
  // Cross-check the img src order in the output matches upload order too --
  // the delay fix is meaningless if the <img> tags themselves were emitted
  // out of order.
  const srcOrder = [...html.matchAll(/<img src="([^"]+)"/g)].map(m => m[1]);
  check('the <img> tags themselves are in upload order in the markup', JSON.stringify(srcOrder) === JSON.stringify(sandbox.STATE.homeSlides), srcOrder);

  const fixedOrder = visibleOrderOverOneCycle(delayMatches, holdSec, totalSec);
  check('running the REAL generated delays through the same CSS timing simulation gives upload order 0,1,2', JSON.stringify(fixedOrder) === JSON.stringify([0, 1, 2]), fixedOrder);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
