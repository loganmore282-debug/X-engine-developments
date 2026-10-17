/**
 * The stylesheet's comments must balance.
 *
 * This exists because of a bug that shipped nothing but nearly did. A round of
 * edits appended a new explanatory paragraph after a comment that had ALREADY
 * closed with its own asterisk-slash, leaving the paragraph as raw text at the
 * top level of the stylesheet with a stray closer after it. CSS error recovery
 * then treated that prose as a selector and swallowed the very next rule as
 * part of it -- `.msg-detail-bg` silently lost its background, its blur and its
 * bottom inset, while every rule after it kept working.
 *
 * That is the nastiest shape a CSS mistake can take: no parse error, no console
 * warning, no build failure, and only ONE rule missing. It was caught by a
 * screenshot assertion noticing the backdrop had no colour; without that it
 * would have gone out looking exactly like the bug the owner had just reported.
 *
 * Comments are not nestable in CSS, so the rule is simple: opens and closes
 * strictly alternate, starting with an open and ending closed.
 *
 * Checked in BOTH stylesheets -- the user app's and the admin panel's -- and in
 * the source files, not the built ones, because that is where the editing that
 * causes this happens.
 */
const fs = require('fs');

let failed = 0;
const check = (ok, label) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); };

function styleBlocks(html) {
  const out = [];
  let i = 0;
  for (;;) {
    const open = html.indexOf('<style', i);
    if (open === -1) break;
    const bodyAt = html.indexOf('>', open);
    const close = html.indexOf('</style>', bodyAt);
    if (bodyAt === -1 || close === -1) break;
    out.push({ at: bodyAt + 1, css: html.slice(bodyAt + 1, close) });
    i = close + 8;
  }
  return out;
}

// Returns the 1-based line of the first unbalanced marker, or null.
function firstImbalance(css, lineBase) {
  let open = false, k = 0;
  for (;;) {
    const o = css.indexOf('/*', k);
    const c = css.indexOf('*/', k);
    if (o === -1 && c === -1) break;
    const openFirst = o !== -1 && (c === -1 || o < c);
    const at = openFirst ? o : c;
    if (openFirst) {
      // A '/*' inside an open comment is just text, so only flag a second
      // open when one is already pending... which cannot happen, since the
      // scan below jumps past the closer. Reaching here with open===true
      // means the comment was never closed.
      if (open) return { kind: 'unclosed comment', line: lineBase + css.slice(0, at).split('\n').length - 1 };
      open = true;
      k = at + 2;
    } else {
      if (!open) return { kind: 'stray */ with no comment open', line: lineBase + css.slice(0, at).split('\n').length - 1 };
      open = false;
      k = at + 2;
    }
  }
  if (open) return { kind: 'comment left open at end of stylesheet', line: null };
  return null;
}

for (const [name, file] of [
  ['user app', __dirname + '/user-src/index.html'],
  ['admin panel', __dirname + '/admin-src/index.html'],
]) {
  if (!fs.existsSync(file)) { check(false, `${name}: ${file} is missing`); continue; }
  const html = fs.readFileSync(file, 'utf8');
  const blocks = styleBlocks(html);
  check(blocks.length > 0, `${name}: found ${blocks.length} <style> block(s)`);
  for (const b of blocks) {
    const lineBase = html.slice(0, b.at).split('\n').length;
    const bad = firstImbalance(b.css, lineBase);
    check(!bad, bad
      ? `${name}: ${bad.kind}${bad.line ? ` near line ${bad.line}` : ''}`
      : `${name}: every /* pairs with a */ (${b.css.split('\n').length} lines)`);
  }
}

// The failure mode itself, reproduced: prose after a closed comment eats the
// rule that follows it. Proves the checker above would actually catch it
// rather than merely being present.
const poisoned = '<style>.a{color:red}\n/* note */\n  more prose here */\n.b{color:blue}</style>';
const bad = firstImbalance(styleBlocks(poisoned)[0].css, 1);
check(bad && bad.kind.indexOf('stray') === 0,
  `the checker catches the exact shape that broke .msg-detail-bg (${bad && bad.kind})`);

console.log(failed ? `\n${failed} FAILED` : '\ncss comments: all cases pass');
process.exit(failed ? 1 : 0);
