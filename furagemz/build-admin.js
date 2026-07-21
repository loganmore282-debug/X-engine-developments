/* ════════════════════════════════════════════════════════════════════════
   FURAGEMZ ADMIN BUILD
   Source (readable, EDIT THIS)   : admin.html
   Output (obfuscated, DEPLOY THIS): admin.dist.html
   Obfuscates the inline app <script> (renameGlobals:false so inline
   onclick="" handlers keep working) and lightly minifies the HTML/CSS.
   Run:  node build-admin.js
   ════════════════════════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');
const JavaScriptObfuscator = require('javascript-obfuscator');

const SRC = path.join(__dirname, 'admin.html');
const OUT = path.join(__dirname, 'admin.dist.html');

let html = fs.readFileSync(SRC, 'utf8');

// Grab the LAST <script>…</script> (the app logic). CSS/markup are left as-is.
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
if (!scripts.length) { console.error('No inline <script> found in admin.html'); process.exit(1); }
const appScript = scripts[scripts.length - 1];
const rawJs = appScript[1];

// syntax sanity before we transform
try { new Function(rawJs); } catch (e) { console.error('admin.html script has a syntax error:', e.message); process.exit(1); }

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
  controlFlowFlattening: false,
  selfDefending: false,
}).getObfuscatedCode();

// round-trip syntax check on the obfuscated output
try { new Function(obf); } catch (e) { console.error('Obfuscated output is invalid:', e.message); process.exit(1); }

html = html.slice(0, appScript.index) +
       '<script>' + obf + '</script>' +
       html.slice(appScript.index + appScript[0].length);

// Light HTML/CSS minify: strip HTML comments (not inside <script>), collapse
// runs of whitespace between tags. Conservative — never touches the script.
html = html
  .replace(/<!--(?!\[if)[\s\S]*?-->/g, '')     // drop HTML comments (keep IE conditionals)
  .replace(/\n\s*\n/g, '\n')                   // collapse blank lines
  .replace(/>\s+</g, '><');                    // trim whitespace between tags

fs.writeFileSync(OUT, html);

// Also publish the obfuscated admin into the EdgeOne-served dist/ folder under a
// long, unguessable filename, so it opens at furagemzplatform.edgeone.app/<name>
// on ANY device with no file transfer. Safe: every action is gated by the
// ADMIN_KEY (checked + rate-limited server-side); the hidden URL is a second layer.
const SECRET = 'furahq.html';
const DIST = path.join(__dirname, 'dist');
if (!fs.existsSync(DIST)) fs.mkdirSync(DIST);
fs.copyFileSync(OUT, path.join(DIST, SECRET));
// keep the old long path working too, so any bookmark already made still opens
fs.copyFileSync(OUT, path.join(DIST, 'panel-9f3k7m2q8x4d.html'));

const kb = (n) => (n / 1024).toFixed(1) + ' KB';
console.log('admin source :', kb(fs.statSync(SRC).size), '(readable — edit this)');
console.log('app script   :', kb(Buffer.byteLength(rawJs)), '→ obfuscated', kb(Buffer.byteLength(obf)));
console.log('admin.dist   :', kb(fs.statSync(OUT).size), '— DEPLOY this file');
console.log('hosted copy  : dist/' + SECRET + '  → auto-deploys to /' + SECRET);
console.log('\nDone. Upload admin.dist.html to your admin host (rename to admin.html there if you like).');
