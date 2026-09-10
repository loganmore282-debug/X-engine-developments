#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
   SPACE8 ADMIN BUILD
   Source (readable, EDIT THIS)     : admin-src/index.html
   Output (obfuscated, DEPLOYED)    : admin/index.html (Render serves this
                                       folder as-is — never edit it by hand,
                                       it gets overwritten on every build)
   Obfuscates the inline app <script> (renameGlobals:false so inline
   onclick="" handlers keep working) and lightly minifies the HTML/CSS.
   The SPACE8_IMAGES product-thumbnail blob (~270KB of base64, no logic) is
   pulled out before obfuscation and reattached as its own plain script —
   string-array-encoding a quarter-megabyte base64 literal is pointless and
   pathologically slow.
   Run:  node build-admin.js
   ════════════════════════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const JavaScriptObfuscator = require('javascript-obfuscator');

const ROOT     = __dirname;
const SRC      = path.join(ROOT, 'admin-src', 'index.html');
const OUT_DIR  = path.join(ROOT, 'admin');
const OUT      = path.join(OUT_DIR, 'index.html');
const log = (...a) => console.log(...a);

let html = fs.readFileSync(SRC, 'utf8');

// Grab the LARGEST plain <script>…</script> — that's the app logic. (Not
// simply "the last one": this file has a small SW-registration <script>
// after the app script, unlike some sibling projects.)
const re = /<script>([\s\S]*?)<\/script>/g;
let m, best = null;
while ((m = re.exec(html))) {
  if (!best || m[1].length > best[1].length) best = m;
}
if (!best) { console.error('No inline <script> found in admin-src/index.html'); process.exit(1); }
const matchIndex = best.index;
let rawJs = best[1];

// syntax sanity before we transform
try { new Function(rawJs); } catch (e) { console.error('admin-src/index.html script has a syntax error:', e.message); process.exit(1); }

// Pull the image blob out — no business logic in it, and running the string
// array encoder over ~270KB of base64 is both slow and pointless.
const BLOB_NAMES = ['SPACE8_IMAGES'];
let assetsJs = '';
for (const name of BLOB_NAMES) {
  const blobRe = new RegExp('^var ' + name + ' *=' + '[\\s\\S]*?\\};\\n?', 'm');
  const match = rawJs.match(blobRe);
  if (match) { assetsJs += match[0]; rawJs = rawJs.replace(blobRe, ''); }
}
log('assets blob   :', assetsJs.length, 'bytes pulled out (unobfuscated)');
log('logic-only src:', rawJs.length, 'bytes');

const obf = JavaScriptObfuscator.obfuscate(rawJs, {
  compact: true,
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,          // keep top-level fn names for inline onclick=""
  stringArray: true,
  stringArrayThreshold: 1,
  stringArrayEncoding: ['base64'],
  numbersToExpressions: true,
  simplify: true,
  splitStrings: true,
  splitStringsChunkLength: 8,
  transformObjectKeys: false,    // object keys are used as API field names — keep
  deadCodeInjection: false,      // keep size sane for an admin file
  controlFlowFlattening: true,   // owner-only tool, desktop-grade hardware — size matters less than on the user app
  controlFlowFlatteningThreshold: 0.5,
  selfDefending: false,
}).getObfuscatedCode();

// round-trip syntax check on the obfuscated output
try { new Function(assetsJs + obf); } catch (e) { console.error('Obfuscated output is invalid:', e.message); process.exit(1); }
fs.writeFileSync('/tmp/_cm_admin_obf_check.js', assetsJs + obf);
execSync('node --check /tmp/_cm_admin_obf_check.js');

html = html.slice(0, matchIndex) +
       '<script>' + assetsJs + obf + '</script>' +
       html.slice(matchIndex + best[0].length);

// Light HTML/CSS minify: strip HTML comments, collapse blank lines/whitespace
// between tags. Conservative — never touches script contents.
html = html
  .replace(/<!--(?!\[if)[\s\S]*?-->/g, '')
  .replace(/\n\s*\n/g, '\n')
  .replace(/>\s+</g, '><');

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT, html);

const kb = (n) => (n / 1024).toFixed(1) + ' KB';
log('admin source  :', kb(fs.statSync(SRC).size), '(readable — edit this)');
log('app script    :', kb(Buffer.byteLength(rawJs)), '-> obfuscated', kb(Buffer.byteLength(obf)));
log('admin/index   :', kb(fs.statSync(OUT).size), '- deployed artifact written');
log('\nDone. Render deploys straight from admin/ (git-based, autoDeploy) — commit both admin-src/ (readable) and admin/ (built).');
