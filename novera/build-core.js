#!/usr/bin/env node
/*
 * build-core.js — secure the Novera user app.
 *
 * Source (readable, EDIT THIS)    : user-src/index.html (+ user-src/original_module.js after first run)
 * Output (obfuscated, DEPLOYED)   : user/index.html (Render serves this folder as-is)
 *
 * Pipeline:
 *   - FIRST RUN: extract the big inline app <script> (the one after the
 *     Firebase <script type="module"> glue block) out of user-src/index.html
 *     into user-src/original_module.js, replacing it with placeholder tags.
 *   - The NOVA_IMAGES / NOVA_BANNERS constants (product/screen photos —
 *     ~700KB of base64, no business logic, nothing worth hiding) are pulled
 *     OUT of the module before obfuscation and shipped as their own plain
 *     <script data-nx-assets> tag — running javascript-obfuscator's string
 *     array encoder over multi-hundred-KB base64 blobs is pathologically
 *     slow/pointless, so they never enter the obfuscator at all.
 *   - guard-src.js -> obfuscate -> inline <script data-nx-guard> in <head>
 *   - original_module.js (logic only) -> obfuscate -> deflate -> base64
 *                        -> DecompressionStream loader IIFE
 *                        -> inlined as <script data-nx-core> in user/index.html
 *     (loaded as a CLASSIC script, not type="module" — top-level function
 *     declarations must land on `window` so every existing onclick="" in
 *     the HTML keeps calling them by name.)
 *
 * Usage:  node build-core.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execSync } = require('child_process');
const JavaScriptObfuscator = require('javascript-obfuscator');

const ROOT     = __dirname;
const SRC_HTML = path.join(ROOT, 'user-src', 'index.html');
const SRC_MOD  = path.join(ROOT, 'user-src', 'original_module.js');
const GUARD    = path.join(ROOT, 'guard-src.js');
const OUT_DIR  = path.join(ROOT, 'user');
const OUT_HTML = path.join(OUT_DIR, 'index.html');
const log = (...a) => console.log(...a);

let html = fs.readFileSync(SRC_HTML, 'utf8');

// ── 1. FIRST RUN: externalize the big inline app <script> ────────────────
if (!fs.existsSync(SRC_MOD)) {
  // Match every plain (non type=module) <script> ... </script> and take the
  // largest one — that's the app logic block, not the tiny SW-registration
  // snippet at the bottom of the file.
  const re = /<script>([\s\S]*?)<\/script>/g;
  let m, best = null;
  while ((m = re.exec(html))) {
    if (!best || m[1].length > best[1].length) best = m;
  }
  if (!best) { console.error('No plain <script> block found in user-src/index.html'); process.exit(1); }
  const fullMatch = best[0], code = best[1];
  const matchIndex = best.index;

  fs.writeFileSync(SRC_MOD, code.replace(/^\n/, '') + '\n');
  html = html.slice(0, matchIndex) + '<script data-nx-assets></script>\n<script data-nx-core></script>' + html.slice(matchIndex + fullMatch.length);
  fs.writeFileSync(SRC_HTML, html);
  log('extracted module ->', 'user-src/original_module.js', code.length, 'bytes');
}

// ── 2. Read the module source, pull the image blobs out ──────────────────
let source = fs.readFileSync(SRC_MOD, 'utf8');
const BLOB_NAMES = ['NOVA_IMAGES', 'NOVA_BANNERS'];
let assetsJs = '';
for (const name of BLOB_NAMES) {
  const re = new RegExp('^var ' + name + ' *= *\\{[\\s\\S]*?\\};\\n?', 'm');
  const match = source.match(re);
  if (match) {
    assetsJs += match[0];
    source = source.replace(re, '');
  }
}
if (!assetsJs) { console.error('Expected to find NOVA_IMAGES/NOVA_BANNERS in original_module.js — none found (already stripped by a previous run?).'); }
log('assets blobs  :', assetsJs.length, 'bytes pulled out (unobfuscated, no logic in them)');
log('logic-only src:', source.length, 'bytes');

// ── 3. Syntax-check the logic-only source ────────────────────────────────
fs.writeFileSync('/tmp/_cm_src_check.js', source);
execSync('node --check /tmp/_cm_src_check.js');
log('module source : syntax OK');

// ── 4. Obfuscate the GUARD and inline it in <head> ───────────────────────
const guardSrc = fs.readFileSync(GUARD, 'utf8');
const guardObf = JavaScriptObfuscator.obfuscate(guardSrc, {
  compact: true,
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,
  stringArray: true,
  stringArrayThreshold: 0.75,
  stringArrayEncoding: ['base64'],
  selfDefending: false,
  disableConsoleOutput: true,
}).getObfuscatedCode();
const guardTag = `<script data-nx-guard>${guardObf}</script>`;

// ── 5. Obfuscate the logic-only MODULE ────────────────────────────────────
const obf = JavaScriptObfuscator.obfuscate(source, {
  compact: true,
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,            // keep top-level fn names reachable from onclick=""
  stringArray: true,
  stringArrayThreshold: 1,         // encode every string literal — server URL/endpoints never plain
  stringArrayEncoding: ['base64'],
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.3, // kept low — flattening everything bloats size/slows low-end phones
  selfDefending: false,
  disableConsoleOutput: true,
}).getObfuscatedCode();
fs.writeFileSync('/tmp/_cm_obf_check.js', obf);
execSync('node --check /tmp/_cm_obf_check.js');
log('obfuscated    :', obf.length, 'bytes — syntax OK');

// ── 6. Deflate -> base64 ─────────────────────────────────────────────────
const b64 = zlib.deflateSync(Buffer.from(obf, 'utf8')).toString('base64');
log('deflate+b64   :', b64.length, 'bytes');

// round-trip verify
const roundTrip = zlib.inflateSync(Buffer.from(b64, 'base64')).toString('utf8');
if (roundTrip !== obf) { console.error('ROUND-TRIP MISMATCH'); process.exit(1); }
log('round-trip    : OK');

// Classic (non-module) script — top-level `function foo(){}` in a script
// inserted this way still becomes `window.foo`, so every onclick="foo()"
// already in the HTML keeps working unchanged.
const loaderIife =
`(function(){
const _d=atob("${b64}");
const _b=new Uint8Array(_d.length);
for(let i=0;i<_d.length;i++)_b[i]=_d.charCodeAt(i);
const _ds=new DecompressionStream('deflate');
const _w=_ds.writable.getWriter();
_w.write(_b);_w.close();
new Response(_ds.readable).text().then(code=>{
const s=document.createElement('script');
s.textContent=code;
document.head.appendChild(s);
});
})();`;

// ── 7. Assemble the deployed user/index.html ──────────────────────────────
let outHtml = html;
outHtml = outHtml.replace('<head>', '<head>\n' + guardTag);
outHtml = outHtml.replace('<script data-nx-assets></script>', `<script data-nx-assets>${assetsJs}</script>`);
outHtml = outHtml.replace('<script data-nx-core></script>', `<script data-nx-core>${loaderIife}</script>`);

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_HTML, outHtml);
log('user/index.html:', fs.statSync(OUT_HTML).size, 'bytes — deployed artifact written');

// ── 8. Static assets (manifest.json/sw.js/icons) already live in user/ —
// they were never moved into user-src/ since there's no code in them to
// hide, so nothing to copy here.

log('\nDone. Render deploys straight from user/ (git-based, autoDeploy) — commit both user-src/ (readable) and user/ (built).');
