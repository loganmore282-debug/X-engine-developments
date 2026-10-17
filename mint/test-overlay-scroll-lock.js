'use strict';
// While a full-page screen (payment status, sheets) is open the document behind it must not scroll, or a phone browser's address bar slides away
// and the fixed screen leaves a strip where the page underneath peeks out (owner: "when I scroll that page down harder it shows that").
// Verified in a real browser by hand (the page behind moved 400 -> 1300 before the fix, stayed at 400 after); this guards the rule itself.
const fs = require('node:fs'), assert = require('node:assert/strict');
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); };
for (const [file, label] of [['user-src/index.html', 'source'], ['user/index.html', 'built page']]) {
  const html = fs.readFileSync(__dirname + '/' + file, 'utf8');
  ok(/html:has\(\.pay-page\.show\),body:has\(\.pay-page\.show\),\s*html:has\(\.sheet-bg\.show\),body:has\(\.sheet-bg\.show\)\{overflow:hidden;overscroll-behavior:none;\}/.test(html), label + ': the document is locked while the payment screen or a sheet is open');
  ok(/\.pay-page\{overscroll-behavior:none;\}/.test(html), label + ': the payment screen passes no overscroll on');
}
console.log(`PASS: document behind a full-page screen cannot scroll (${n} checks)`);
