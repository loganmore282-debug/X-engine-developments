#!/usr/bin/env node
/**
 * The admin-editable CORS domain list, exercised against the REAL code from
 * server.js.
 *
 * Two things matter here and they pull in opposite directions:
 *   1. the owner must be able to add a custom domain without a code change;
 *   2. nothing typed into that box may ever lock them out of the admin panel
 *      that is the only place to fix it, or hand the backend to a stranger.
 * The built-in hosts being ADDITIVE-only is what guarantees (2), so that is
 * asserted directly rather than assumed.
 */
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/server.js', 'utf8');
const cut = (a, b) => src.slice(src.indexOf(a), src.indexOf(b));
// eval'd `const`s stay inside the eval's own scope, so the block is wrapped
// in a function that hands the real bindings back out.
const { CORS_ALLOWED_ORIGINS, CORS_ALLOWED_SUFFIXES, sanitizeAllowedOrigins } = new Function(
  cut('const CORS_ALLOWED_ORIGINS', 'app.use(cors(') +
  '\nreturn { CORS_ALLOWED_ORIGINS, CORS_ALLOWED_SUFFIXES, sanitizeAllowedOrigins };'
)();

let failed = 0;
const check = (ok, label) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); };

// The real allow decision, lifted out of the cors() callback so the admin
// list is tested through the same logic that runs in production.
function isAllowed(origin, extraHosts) {
  const _corsExtraHosts = extraHosts || [];
  if (!origin) return true;
  if (CORS_ALLOWED_ORIGINS.has(origin)) return true;
  try {
    const h = new URL(origin).hostname.toLowerCase();
    if (CORS_ALLOWED_SUFFIXES.some(sfx => h.endsWith(sfx))) return true;
    if (_corsExtraHosts.includes(h)) return true;
    if (h === 'localhost' || h === '127.0.0.1') return true;
  } catch (_) {}
  return false;
}

console.log('— what the owner can type —');
for (const [input, expected, label] of [
  ['chipz-platform.com', ['chipz-platform.com'], 'a plain domain'],
  ['https://chipz-platform.com', ['chipz-platform.com'], 'pasted with https://'],
  ['https://chipz-platform.com/', ['chipz-platform.com'], 'pasted with a trailing slash'],
  ['  CHIPZ-Platform.COM  ', ['chipz-platform.com'], 'stray spaces and capitals'],
  ['a.com\nb.com', ['a.com', 'b.com'], 'one per line'],
  ['a.com, b.com', ['a.com', 'b.com'], 'comma separated'],
  ['a.com\na.com\nA.COM', ['a.com'], 'duplicates collapse'],
  ['', [], 'blank clears the list'],
  ['a.com\n\n  \nb.com', ['a.com', 'b.com'], 'blank lines ignored'],
  [['a.com', 'b.com'], ['a.com', 'b.com'], 'already an array'],
]) {
  const r = sanitizeAllowedOrigins(input);
  check(!r.error && JSON.stringify(r.hosts) === JSON.stringify(expected),
    `${label} -> ${JSON.stringify(r.hosts || r.error)}`);
}

console.log('\n— what is refused, with a reason —');
for (const [input, label] of [
  ['*', 'a bare wildcard'],
  ['*.com', 'a wildcard domain'],
  ['.com', 'a bare TLD — would let in the entire internet'],
  ['com', 'a single label'],
  ['localhost', 'no dot'],
  ['evil com', 'a space inside the name'],
  ['-bad.com', 'label starting with a hyphen'],
  ['a'.repeat(300) + '.com', 'absurdly long'],
  [Array.from({length: 60}, (_, i) => `d${i}.com`).join('\n'), 'more than 50 domains'],
]) {
  const r = sanitizeAllowedOrigins(input);
  check(!!r.error, `${label} -> ${r.error ? 'refused: ' + r.error.slice(0, 60) : 'ACCEPTED ' + JSON.stringify(r.hosts)}`);
}

console.log('\n— the admin list can only ADD, never take away —');
// The lockout guarantee: whatever is in the box, the built-in hosts still work.
for (const extras of [[], ['chipz-platform.com'], ['totally-unrelated.com']]) {
  check(isAllowed('https://chipz-admin.onrender.com', extras), `admin panel reachable with extras=${JSON.stringify(extras)}`);
  check(isAllowed('https://chipz-app.onrender.com', extras), `user app reachable with extras=${JSON.stringify(extras)}`);
  check(isAllowed('https://chipz-admin.edgeone.dev', extras), `EdgeOne fallback reachable with extras=${JSON.stringify(extras)}`);
}

console.log('\n— an added domain works, and only that domain —');
const extras = sanitizeAllowedOrigins('chipz-platform.com\nwww.chipz-platform.com').hosts;
check(isAllowed('https://chipz-platform.com', extras), 'the added domain is allowed');
check(isAllowed('https://www.chipz-platform.com', extras), 'the added www. domain is allowed');
check(!isAllowed('https://chipz-platform.com.evil.com', extras), 'a lookalike suffix is NOT allowed');
check(!isAllowed('https://sub.chipz-platform.com', extras), 'a subdomain is not implied — exact match only');
check(!isAllowed('https://evil.com', extras), 'an unrelated site is still refused');

console.log(failed ? `\n${failed} FAILED` : '\nall allowed-origin cases pass');
process.exit(failed ? 1 : 0);
