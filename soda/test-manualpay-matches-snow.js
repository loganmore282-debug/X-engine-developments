#!/usr/bin/env node
/**
 * The manual-payment flow's CSS is Snow's, rule for rule.
 *
 * Owner: "you changed the design and font of manual payment land page, check
 * back on snow scripts, it should be same texts and design, you even rounded
 * the network selection design and submit sms stuffs were changed, use exact
 * as it was on snow, only logics change."
 *
 * This DIFFS AGAINST SNOW'S OWN FILE rather than asserting a list of numbers
 * someone typed. A hardcoded expectation is a second copy of the design that
 * drifts on its own; Snow's stylesheet is the thing he is pointing at, so it
 * is the thing to compare with.
 *
 * The markup is checked too, because "same texts" is half the request -- and
 * it was already identical, which is how the fault was narrowed to CSS.
 *
 * Two Chipz-only additions are allowed through, both things he asked for in
 * their own rounds and neither a change to Snow's text, shape or weight:
 * the centred .mp-toast notices, and the app-wide Confirm-button glow sweep.
 */
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const SNOW = path.resolve(HERE, '..', 'snow', 'user-src', 'index.html');
const OURS = path.join(HERE, 'user-src', 'index.html');

let bad = 0;
const ck = (o, l) => { if (!o) bad++; console.log(`${o ? 'PASS' : 'FAIL'}  ${l}`); };

if (!fs.existsSync(SNOW)) {
  console.log('SKIP  snow/user-src/index.html is not in this checkout');
  process.exit(0);
}

// Every rule whose selector mentions #manualPayFlow, normalised so a reflow
// or a reindent cannot read as a design change.
function rules(file) {
  const src = fs.readFileSync(file, 'utf8');
  const out = new Map();
  const re = /(#manualPayFlow[^{}/]*?)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(src))) {
    const sel = m[1].replace(/\s+/g, ' ').trim();
    const body = m[2].split(';').map(x => x.replace(/\s+/g, ' ').trim())
                     .filter(Boolean).sort().join(';');
    if (!out.has(sel)) out.set(sel, []);
    out.get(sel).push(body);
  }
  return out;
}

// Chipz-only, by his own request in earlier rounds.
const ALLOWED_EXTRA = [
  /\.mp-toast/,            // the centred notices
  /\.mp-confirm-btn::after/, // the button glow sweep
  /\.mp-confirm-btn:disabled::after/,
];
const isAllowedExtra = sel => ALLOWED_EXTRA.some(r => r.test(sel));

const snow = rules(SNOW), ours = rules(OURS);
ck(snow.size > 40, `found Snow's manual-pay CSS (${snow.size} rules)`);
ck(ours.size > 40, `and ours (${ours.size} rules)`);

console.log('\n— every rule Snow has, we have with the same values —');
let mismatched = [];
let missing = [];
for (const [sel, bodies] of snow) {
  if (!ours.has(sel)) { missing.push(sel); continue; }
  // A selector can legitimately appear more than once (ours adds a
  // position:relative host rule for the sweep), so Snow's body must be
  // PRESENT among ours, not necessarily the only one.
  if (!ours.get(sel).includes(bodies[0])) {
    mismatched.push(`${sel}\n        snow: ${bodies[0]}\n        ours: ${ours.get(sel).join(' | ')}`);
  }
}
ck(missing.length === 0, `no rule was dropped (${missing.length}${missing.length ? ': ' + missing.slice(0, 3).join(', ') : ''})`);
ck(mismatched.length === 0,
   mismatched.length ? `${mismatched.length} rule(s) differ from Snow:\n      ` + mismatched.slice(0, 6).join('\n      ')
                     : 'every rule matches Snow value for value');

console.log('\n— nothing was added to the design except what he asked for —');
const extras = [...ours.keys()].filter(s => !snow.has(s) && !isAllowedExtra(s));
ck(extras.length === 0,
   extras.length ? `unexpected extra rules: ${extras.join(', ')}` : 'no extra rules beyond the toast and the button sweep');

// The two specific things he named, spelled out so a future retokenising is
// caught by name rather than only by the wholesale diff above.
console.log('\n— the two he named, by name —');
const ourSrc = fs.readFileSync(OURS, 'utf8');
const tile = /#manualPayFlow \.mp-method\{[^}]*\}/.exec(ourSrc);
ck(!!tile && /border-radius:11px/.test(tile[0]),
   `the network tiles are Snow's 11px, not a rounder token (${tile ? (/border-radius:([^;]*)/.exec(tile[0]) || [])[1] : 'rule missing'})`);
const ta = /#manualPayFlow \.mp-sms-fallback textarea\{[^}]*\}/.exec(ourSrc);
ck(!!ta && /border-radius:12px/.test(ta[0]),
   `the submit-SMS box is Snow's 12px (${ta ? (/border-radius:([^;]*)/.exec(ta[0]) || [])[1] : 'rule missing'})`);
// No Chipz radius token may survive anywhere inside this flow.
const flowRules = [...ours.entries()].filter(([s]) => !isAllowedExtra(s));
const tokened = flowRules.filter(([, bodies]) => bodies.some(b => /--r-(card|ctl|pill|sheet|tile)/.test(b)));
ck(tokened.length === 0,
   tokened.length ? `still using Chipz radius tokens: ${tokened.map(([s]) => s).join(', ')}`
                  : 'no Chipz radius token is left anywhere in the flow');

console.log('\n— same texts: the markup was, and stays, identical —');
const snowMod = fs.readFileSync(path.resolve(HERE, '..', 'snow', 'user-src', 'original_module.js'), 'utf8');
const ourMod = fs.readFileSync(path.join(HERE, 'user-src', 'original_module.js'), 'utf8');
for (const text of [
  'Please fill in your payment method and the actual payment account you will use to make the payment.',
  'Please select a payment method',
  'Please enter your actual payment account',
  'Please fill in your payment account accurately, incorrect filling may result in the loss of the transferred funds.',
]) {
  ck(snowMod.includes(text) && ourMod.includes(text),
     `"${text.slice(0, 44)}${text.length > 44 ? '…' : ''}"`);
}

console.log(bad ? `\n${bad} FAILED` : '\nmanual pay vs snow: identical');
process.exit(bad ? 1 : 0);
