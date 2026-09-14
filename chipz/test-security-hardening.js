#!/usr/bin/env node
/**
 * The hardening round: database-enforced uniqueness, a real Content-Security-
 * Policy, Permissions-Policy, a rate limit on /health, and a CI gate.
 *
 * These assert on the REAL declarations -- the specs array is pulled out of
 * db.js and evaluated, and the CSP is parsed out of render.yaml into
 * directives -- rather than grepping for a phrase. A string match would pass
 * on a policy that mentions connect-src while allowing *, and would pass on a
 * unique index that is missing the partial filter that makes it correct.
 */
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const ROOT = path.resolve(HERE, '..');
const db = fs.readFileSync(path.join(HERE, 'db.js'), 'utf8');
const server = fs.readFileSync(path.join(HERE, 'server.js'), 'utf8');
const render = fs.readFileSync(path.join(HERE, 'render.yaml'), 'utf8');

let failed = 0;
const check = (ok, label) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); };

// ── the index specs, evaluated as real data ──
console.log('— database-enforced uniqueness (db.js) —');
const specsStart = db.indexOf('const specs = [');
const specsEnd = db.indexOf('\n  ];', specsStart);
check(specsStart !== -1 && specsEnd !== -1, 'ensureIndexes still declares a specs array this test can read');
const specs = specsStart === -1 ? [] : new Function(
  db.slice(specsStart, specsEnd + 4) + '\nreturn specs;')();

const uniques = specs.filter(s => s[2] && s[2].unique);
check(uniques.length >= 6, `at least six unique indexes declared (got ${uniques.length})`);

// Each of these is a value server.js generates with a check-then-write loop
// that is not atomic. The index is what actually makes it safe.
for (const [col, field] of [
  ['users', 'referralCodeLower'],
  ['users', 'publicId'],
  ['promoCodes', 'codeLower'],
  ['pendingDeposits', 'marzReference'],
  ['withdrawals', 'marzReference'],
  ['withdrawals', 'lipaOutTradeNo'],
]) {
  const spec = uniques.find(s => s[0] === col && Object.keys(s[1]).length === 1 && s[1][field] === 1);
  check(!!spec, `${col}.${field} is unique`);
  if (!spec) continue;
  const opts = spec[2];
  // Without the partial filter a unique index treats every document MISSING
  // the field as sharing one null value and rejects the second such document
  // -- which would block manual deposits (no marzReference) and pre-publicId
  // accounts outright. The filter is not a nicety; it is what makes the index
  // safe to add to a live collection.
  check(!!opts.partialFilterExpression, `${col}.${field} is partial, so absent values are not treated as duplicates`);
  check(opts.partialFilterExpression && JSON.stringify(opts.partialFilterExpression[field]) === '{"$type":"string"}',
    `${col}.${field} constrains only documents where the field is a real string`);
  // A distinct explicit name is what lets the unique index coexist with the
  // plain index of the same shape already built on the live cluster, instead
  // of failing with IndexOptionsConflict on every deploy.
  check(typeof opts.name === 'string' && /_unique$/.test(opts.name),
    `${col}.${field} carries its own explicit name (${opts.name || 'none'})`);
  const plain = specs.find(s => s[0] === col && !s[2] && s[1][field] === 1 && Object.keys(s[1]).length === 1);
  check(!!plain, `${col}.${field} keeps its original non-unique index alongside the unique one`);
}

check(/createIndex\(keys,\s*opts\s*\|\|\s*\{\}\)/.test(db),
  'the build loop actually passes the options through to createIndex');
check(/opts && opts\.unique/.test(db) && /UNIQUE index NOT built/.test(db),
  'a failed unique build is reported as an error, not a warning lost in startup noise');
check(/UNIQUENESS NOT ENFORCED/.test(db),
  'and is repeated in a summary at the end of the index build');

// ── Content-Security-Policy ──
console.log('\n— Content-Security-Policy (render.yaml) —');
const cspValues = [...render.matchAll(/name: Content-Security-Policy\n\s*value: "([^"]+)"/g)].map(m => m[1]);
check(cspValues.length === 2, `both static sites carry a policy (found ${cspValues.length})`);

for (const [i, raw] of cspValues.entries()) {
  const site = i === 0 ? 'chipz-app' : 'chipz-admin';
  const dir = {};
  raw.split(';').map(s => s.trim()).filter(Boolean).forEach(d => {
    const [name, ...vals] = d.split(/\s+/);
    dir[name] = vals;
  });

  check(!!dir['default-src'], `${site}: has a default-src, so an unlisted type is denied rather than open`);
  // The whole point of the round. Script injected into the page cannot POST a
  // balance, session token or trade password to a host that is not listed.
  check(Array.isArray(dir['connect-src']), `${site}: restricts connect-src`);
  check(dir['connect-src'] && !dir['connect-src'].includes('*') && !dir['connect-src'].includes('https:'),
    `${site}: connect-src is a real allow-list, not a wildcard`);
  check(dir['connect-src'] && dir['connect-src'].includes('https://chipz-server.onrender.com'),
    `${site}: the API origin is reachable`);
  check(dir['connect-src'] && dir['connect-src'].some(v => /googleapis\.com$/.test(v)),
    `${site}: Firebase Auth is reachable`);

  check(dir['script-src'] && !dir['script-src'].includes("'unsafe-eval'"),
    `${site}: no 'unsafe-eval' -- the bundle is injected, never eval()'d`);
  check(dir['script-src'] && !dir['script-src'].includes('*') && !dir['script-src'].includes('https:'),
    `${site}: script-src names its hosts instead of allowing any origin`);
  check(dir['script-src'] && dir['script-src'].includes('https://www.gstatic.com'),
    `${site}: the Firebase SDK can still load`);
  // Required, and worth stating in a test so nobody "fixes" it later without
  // first changing how build-core.js emits the bundle.
  check(dir['script-src'] && dir['script-src'].includes("'unsafe-inline'"),
    `${site}: 'unsafe-inline' present -- build-core.js emits the app as one inline script`);

  check(dir['object-src'] && dir['object-src'].includes("'none'"), `${site}: object-src none`);
  check(dir['base-uri'] && dir['base-uri'].includes("'self'"), `${site}: base-uri self`);
  check(dir['frame-ancestors'] && dir['frame-ancestors'].includes("'none'"), `${site}: cannot be framed`);
  check(!!dir['form-action'], `${site}: form-action set, so a planted form cannot post off-site`);
  check(dir['worker-src'] && dir['worker-src'].includes("'self'"), `${site}: the service worker can register`);
}

// ── Permissions-Policy ──
console.log('\n— Permissions-Policy —');
const pp = [...render.matchAll(/name: Permissions-Policy\n\s*value: "([^"]+)"/g)].map(m => m[1]);
check(pp.length === 2, `both static sites send it (found ${pp.length})`);
for (const v of pp) {
  check(/camera=\(\)/.test(v) && /microphone=\(\)/.test(v) && /geolocation=\(\)/.test(v) && /payment=\(\)/.test(v),
    'camera, microphone, geolocation and payment are all denied');
}
check(/'Permissions-Policy':/.test(server), 'the API sets it too, so all three origins match');

// ── /health ──
console.log('\n— /health is no longer exempt from everything —');
check(/const healthLimiter = rateLimit\(/.test(server), 'a dedicated limiter exists for it');
check(/req\.path === '\/health' \? healthLimiter\(req, res, next\)/.test(server),
  'and it is what /health gets, instead of a bare next()');
// It calls pingDb() on every hit, which is why an unlimited /health was worth
// closing at all.
check(/app\.get\('\/health'[\s\S]{0,120}pingDb\(\)/.test(server),
  '/health really does hit the database on each request');

// ── CI gate + dependency scanning ──
console.log('\n— supply chain and deploy gate —');
const wf = path.join(ROOT, '.github/workflows/chipz-tests.yml');
check(fs.existsSync(wf), 'a workflow runs the Node suite');
if (fs.existsSync(wf)) {
  const y = fs.readFileSync(wf, 'utf8');
  check(/npm ci/.test(y), 'it installs from the lockfile, not a fresh resolve');
  check(/npm audit --audit-level=high/.test(y), 'it fails on a high-severity advisory');
  check(/for f in test-\*\.js/.test(y), 'it runs every Node test file');
  check(/set -euo pipefail/.test(y) && /exit 1/.test(y), 'and a failing test really fails the job');
}
const dep = path.join(ROOT, '.github/dependabot.yml');
check(fs.existsSync(dep), 'dependabot watches the dependency tree');
if (fs.existsSync(dep)) {
  const d = fs.readFileSync(dep, 'utf8');
  check(/directory:\s*\/chipz/.test(d), 'pointed at chipz');
  check(/package-ecosystem:\s*github-actions/.test(d), 'and at the workflow actions themselves');
}

// ── the tests have to run somewhere other than one laptop ──
// The CI gate's first real run failed for exactly this: test-cors-origins.js
// opened '/home/user/.../chipz/server.js' by absolute path, which exists in
// the directory it was written in and nowhere else. It had passed locally
// forever. 28 files carried the same baked-in prefix.
console.log('\n— tests are portable —');
const testFiles = fs.readdirSync(HERE)
  .filter(f => /^(test-.*|smoke-test)\.(js|py)$/.test(f));
check(testFiles.length > 40, `found the suite to scan (${testFiles.length} files)`);
// Comments are stripped first. Without that this check flags ITSELF -- the
// explanation above quotes an example path, and a plain scan cannot tell an
// offending line of code from a sentence describing one. That is the same
// trap test-no-snow-branding.js documents hitting.
// The LINE passes run before the BLOCK ones -- see the long note on the same
// helper in test-no-snow-branding.js. A line comment holding the characters
// "/*" otherwise opens a block that runs to the next real "*/", blanking
// every line in between and blinding whatever this feeds.
const stripComments = src => src
  .replace(/^\s*\/\/.*$/gm, '')         // JS line
  .replace(/^\s*#.*$/gm, '')            // Python line + shebang
  .replace(/\/\*[\s\S]*?\*\//g, '')     // JS block
  .replace(/"""[\s\S]*?"""/g, '');      // Python docstring
const baked = testFiles.filter(f => {
  const body = stripComments(fs.readFileSync(path.join(HERE, f), 'utf8'));
  // Any absolute path into a home or checkout directory. Deliberately not a
  // search for one specific prefix -- the next one will be someone else's.
  return /['"]\/(home|Users|root)\/[^'"\n]*chipz/.test(body);
});
check(baked.length === 0,
  `no test file hardcodes an absolute checkout path (offenders: ${baked.join(', ') || 'none'})`);

console.log(failed ? `\n${failed} FAILED` : '\nsecurity hardening: all cases pass');
process.exit(failed ? 1 : 0);
