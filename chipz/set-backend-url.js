#!/usr/bin/env node
/**
 * Point the whole project at a different backend, in one command.
 *
 *   node set-backend-url.js https://chipz-server-production.up.railway.app
 *   node set-backend-url.js --check          (show where it points now)
 *
 * WHY THIS EXISTS. The backend origin is written into TEN places across six
 * files, and each one fails differently when it is missed:
 *
 *   user-src/original_module.js   API_BASE          every call 404s silently
 *   admin-src/index.html          SERVER            the panel cannot sign in
 *   user-src/index.html           meta CSP          browser blocks every call
 *   admin-src/index.html          meta CSP          same, for the panel
 *   user-src/index.html           icon + og:image   blurry icon, no share card
 *   admin-src/index.html          icon links        blurry admin icon
 *   user/manifest.json            icon srcs         installed icon breaks
 *   admin/manifest.json           icon srcs         same, for the panel
 *
 * The meta CSP is the one that catches people out: a document has to satisfy
 * BOTH the meta tag and the server header, so leaving the tag on the old
 * origin blocks every API call no matter what the host sends. And the failure
 * is invisible server-side -- the request never leaves the browser.
 *
 * Run `node build-core.js && node build-admin.js` afterwards: API_BASE lives
 * inside the obfuscated bundle, so editing the source is not enough. This
 * script says so on exit rather than trusting anyone to remember.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const arg = (process.argv[2] || '').trim();

// Every file, and the shape the origin takes in it. Matching a bare origin
// string would also hit the prose in the admin panel's own help text, so each
// pattern is anchored on the code or markup around it.
const SITES = [
  ['user-src/original_module.js', o => [[/var API_BASE = '[^']*'/g, `var API_BASE = '${o}'`]]],
  ['admin-src/index.html', o => [
    [/const SERVER = '[^']*'/g, `const SERVER = '${o}'`],
    [/(connect-src 'self' )https?:\/\/[^\s;]+/g, `$1${o}`],
    [/(<link rel="(?:icon|apple-touch-icon)" href=")https?:\/\/[^/]+(\/public\/)/g, `$1${o}$2`],
  ]],
  ['user-src/index.html', o => [
    [/(connect-src 'self' )https?:\/\/[^\s;]+/g, `$1${o}`],
    [/(<link rel="(?:icon|apple-touch-icon)" href=")https?:\/\/[^/]+(\/public\/)/g, `$1${o}$2`],
    [/(<meta (?:property="og:image"|name="twitter:image") content=")https?:\/\/[^/]+(\/public\/)/g, `$1${o}$2`],
  ]],
  ['user/manifest.json', o => [[/(")https?:\/\/[^/]+(\/public\/app-icon-)/g, `$1${o}$2`]]],
  ['admin/manifest.json', o => [[/(")https?:\/\/[^/]+(\/public\/app-icon-)/g, `$1${o}$2`]]],
];

function originsIn(text) {
  // Only the ones that are a backend reference, not every URL in the file.
  const out = new Set();
  for (const re of [/var API_BASE = '([^']*)'/g, /const SERVER = '([^']*)'/g,
                    /connect-src 'self' (https?:\/\/[^\s;]+)/g,
                    /href="(https?:\/\/[^/]+)\/public\//g,
                    /content="(https?:\/\/[^/]+)\/public\//g,
                    /"(https?:\/\/[^/]+)\/public\/app-icon-/g]) {
    let m;
    while ((m = re.exec(text))) out.add(m[1].replace(/\/+$/, ''));
  }
  return out;
}

if (!arg || arg === '--check') {
  const seen = new Map();
  for (const [rel] of SITES) {
    const text = fs.readFileSync(path.join(HERE, rel), 'utf8');
    for (const o of originsIn(text)) seen.set(o, (seen.get(o) || []).concat(rel));
  }
  console.log('backend origin(s) currently referenced:');
  for (const [o, files] of seen) console.log(`  ${o}\n      ${files.join('\n      ')}`);
  if (seen.size > 1) {
    console.log('\nMORE THAN ONE. The frontends and their CSP must agree, or the ' +
                'browser blocks the calls with nothing showing server-side.');
    process.exit(1);
  }
  process.exit(0);
}

let origin;
try {
  const u = new URL(arg);
  if (u.protocol !== 'https:' && u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') {
    throw new Error('must be https (a page served over https cannot call http)');
  }
  origin = u.origin;
} catch (e) {
  console.error(`not a usable origin: ${arg}\n  ${e.message}`);
  console.error('example: node set-backend-url.js https://chipz-server-production.up.railway.app');
  process.exit(1);
}

let changed = 0;
for (const [rel, rules] of SITES) {
  const file = path.join(HERE, rel);
  const before = fs.readFileSync(file, 'utf8');
  let after = before;
  for (const [re, to] of rules(origin)) after = after.replace(re, to);
  if (after !== before) { fs.writeFileSync(file, after); changed++; console.log(`  updated ${rel}`); }
  else console.log(`  unchanged ${rel}`);
}

// Prove it, rather than assume the patterns covered everything.
const leftovers = [];
for (const [rel] of SITES) {
  const text = fs.readFileSync(path.join(HERE, rel), 'utf8');
  for (const o of originsIn(text)) if (o !== origin) leftovers.push(`${rel}: ${o}`);
}
if (leftovers.length) {
  console.error('\nSTILL POINTING SOMEWHERE ELSE:');
  for (const l of leftovers) console.error('  ' + l);
  console.error('Fix those by hand -- a half-moved frontend fails in the browser only.');
  process.exit(1);
}

console.log(`\nbackend is now ${origin} (${changed} file(s) changed)`);
console.log('NOW REBUILD, or the app still calls the old address:');
console.log('  node build-core.js && node build-admin.js');
console.log('And set CHIPZ_API_ORIGIN to the same value on both static services,');
console.log('so the header CSP agrees with the meta tag.');
