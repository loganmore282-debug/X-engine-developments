#!/usr/bin/env node
/**
 * Point the whole project at a different backend, in one command.
 *
 *   node set-backend-url.js https://chipz-server-production.up.railway.app
 *   node set-backend-url.js --check          (show where it points now)
 *
 * WHY THIS EXISTS. The backend origin is written into THIRTEEN places across
 * nine files, and each one fails differently when it is missed:
 *
 *   user-src/original_module.js   API_BASE          every call 404s silently
 *   admin-src/index.html          SERVER            the panel cannot sign in
 *   user-src/index.html           meta CSP          browser blocks every call
 *   admin-src/index.html          meta CSP          same, for the panel
 *   user-src/index.html           icon + og:image   blurry icon, no share card
 *   admin-src/index.html          icon links        blurry admin icon
 *   user/manifest.json            icon srcs         installed icon breaks
 *   admin/manifest.json           icon srcs         same, for the panel
 *   user/sw.js                    API_ORIGIN        installed app name freezes
 *   admin/sw.js                   BRAND_ICON        push notification icon
 *   static-server.js              CSP fallback      every API call blocked
 *
 * The meta CSP is the one that catches people out: a document has to satisfy
 * BOTH the meta tag and the server header, so leaving the tag on the old
 * origin blocks every API call no matter what the host sends. And the failure
 * is invisible server-side -- the request never leaves the browser.
 *
 * The last three were MISSED by the first version of this script and survived
 * the whole Render -> Railway move pointing at a dead host. They were found by
 * test-brand-assets.js failing, not by anyone noticing. Hence the second
 * verification pass at the bottom: the first can only vouch for files SITES
 * already lists, and a list cannot warn you about what is not on it.
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
  // The three below were MISSED by the first version of this script, and were
  // only found because test-brand-assets.js failed on one of them during the
  // Railway move. Each fails quietly in its own way, which is exactly why they
  // have to be in here rather than remembered:
  //   user/sw.js       the branded-manifest rewrite fetches /public/settings
  //                    from this origin. Stale, it hits a dead host, falls back
  //                    to the shipped manifest, and the installed app name
  //                    silently never updates again.
  //   admin/sw.js      the icon on a background push notification.
  //   static-server.js the FALLBACK when CHIPZ_API_ORIGIN is unset. Stale, the
  //                    CSP header names a dead backend and the browser blocks
  //                    every API call with nothing showing server-side -- the
  //                    "Network error over a healthy backend" this file's own
  //                    header warns about.
  // Neither sw.js is generated from a source file; they are edited in place.
  ['user/sw.js', o => [[/const API_ORIGIN = '[^']*'/g, `const API_ORIGIN = '${o}'`]]],
  ['admin/sw.js', o => [[/(const BRAND_ICON = ')https?:\/\/[^/]+(\/public\/)/g, `$1${o}$2`]]],
  ['static-server.js', o => [
    [/(process\.env\.CHIPZ_API_ORIGIN \|\| ')https?:\/\/[^']*(')/g, `$1${o}$2`],
  ]],
];

function originsIn(text) {
  // Only the ones that are a backend reference, not every URL in the file.
  const out = new Set();
  for (const re of [/var API_BASE = '([^']*)'/g, /const SERVER = '([^']*)'/g,
                    /connect-src 'self' (https?:\/\/[^\s;]+)/g,
                    /href="(https?:\/\/[^/]+)\/public\//g,
                    /content="(https?:\/\/[^/]+)\/public\//g,
                    /"(https?:\/\/[^/]+)\/public\/app-icon-/g,
                    /const API_ORIGIN = '([^']*)'/g,
                    /const BRAND_ICON = '(https?:\/\/[^/]+)\/public\//g,
                    /process\.env\.CHIPZ_API_ORIGIN \|\| '([^']*)'/g]) {
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

// AND a sweep over every shipped file, not just the ones listed above. The
// check before this one can only vouch for files SITES already knows about --
// which is precisely the blind spot that let user/sw.js, admin/sw.js and
// static-server.js keep the Render origin through the Railway move. A list
// cannot warn you about what is not on it, so this looks for the shape of a
// backend reference anywhere in the deployable tree.
const SWEEP = ['user', 'admin', 'user-src', 'admin-src', '.'];
const SWEEP_EXT = /\.(js|json|html)$/;
const strays = [];
const seenFiles = new Set(SITES.map(([rel]) => rel));
for (const dir of SWEEP) {
  const abs = path.join(HERE, dir);
  let entries = [];
  try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch (_) { continue; }
  for (const e of entries) {
    if (!e.isFile() || !SWEEP_EXT.test(e.name)) continue;
    const rel = dir === '.' ? e.name : `${dir}/${e.name}`;
    if (seenFiles.has(rel)) continue;
    // A test may legitimately name an old host (asserting it must NOT appear),
    // and this file and the docs quote one by way of explanation.
    if (/^(test-|verify-|find-|dump-|tune-|make-|build-|restore-|set-backend-url)/.test(e.name)) continue;
    const text = fs.readFileSync(path.join(abs, e.name), 'utf8');
    // Comments explain history and are allowed to name a former host; only
    // live references matter. Stripped line-first, as this project's own rule
    // says -- a line comment containing "/*" otherwise swallows real code.
    const code = text.replace(/^\s*(\/\/|#).*$/gm, '')
                     .replace(/\/\*[\s\S]*?\*\//g, '')
                     .replace(/<!--[\s\S]*?-->/g, '');
    for (const o of originsIn(code)) if (o !== origin) strays.push(`${rel}: ${o}`);
  }
}
if (strays.length) {
  console.error('\nA FILE OUTSIDE THE LIST STILL NAMES ANOTHER BACKEND:');
  for (const s of strays) console.error('  ' + s);
  console.error('Add it to SITES above -- being found by this sweep means nothing');
  console.error('rewrites it, so the next move will miss it again.');
  process.exit(1);
}

console.log(`\nbackend is now ${origin} (${changed} file(s) changed)`);
console.log('NOW REBUILD, or the app still calls the old address:');
console.log('  node build-core.js && node build-admin.js');
console.log('And set CHIPZ_API_ORIGIN to the same value on both static services,');
console.log('so the header CSP agrees with the meta tag.');
