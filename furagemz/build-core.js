#!/usr/bin/env node
/*
 * build-core.js — secure the Furagemz user app (index.html).
 *
 * Pipeline:
 *   - FIRST RUN: extract the inline <script type="module"> app code into
 *     original_module.js and replace it with a placeholder tag.
 *   - guard-src.js  -> obfuscate -> inline <script data-nx-guard> in <head>
 *   - original_module.js -> obfuscate -> deflate -> base64
 *                        -> DecompressionStream loader IIFE
 *                        -> inlined as <script data-nx-core> in index.html
 *
 * Everything ends up in a single index.html — no separate core.*.js file.
 * Deploy: index.html + manifest.json + sw.js + icon-192.png + icon-512.png
 *
 * Usage:  node build-core.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execSync } = require('child_process');
const JavaScriptObfuscator = require('javascript-obfuscator');

const ROOT  = __dirname;
const HTML  = path.join(ROOT, 'index.html');
const SRC   = path.join(ROOT, 'original_module.js');
const GUARD = path.join(ROOT, 'guard-src.js');
const log = (...a) => console.log(...a);

let html = fs.readFileSync(HTML, 'utf8');

// ── 1. FIRST RUN: externalize the inline app module ──────────────────────
if (!fs.existsSync(SRC)) {
  const open = html.indexOf('<script type="module">');
  if (open === -1) { console.error('No <script type="module"> found and no original_module.js'); process.exit(1); }
  const codeStart = open + '<script type="module">'.length;
  const close = html.indexOf('</script>', codeStart);
  if (close === -1) { console.error('Unterminated module script'); process.exit(1); }
  const moduleCode = html.slice(codeStart, close);
  fs.writeFileSync(SRC, moduleCode.replace(/^\n/, '') + '\n');
  html = html.slice(0, open) + '<script data-nx-core></script>' + html.slice(close + '</script>'.length);
  log('extracted module ->', 'original_module.js', moduleCode.length, 'bytes');
}

// ── 2. Read + syntax-check the module source ─────────────────────────────
const source = fs.readFileSync(SRC, 'utf8');
fs.writeFileSync('/tmp/_nx_src.mjs', source);   // .mjs => checked as ES module
execSync('node --check /tmp/_nx_src.mjs');
log('module source :', source.length, 'bytes — syntax OK');

// ── 3. Obfuscate the GUARD and inline it in <head> ───────────────────────
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
if (/<script data-nx-guard>[\s\S]*?<\/script>/.test(html)) {
  html = html.replace(/<script data-nx-guard>[\s\S]*?<\/script>/, guardTag);
} else {
  html = html.replace('<head>', '<head>\n' + guardTag);
}
log('guard         :', guardObf.length, 'bytes — inlined');

// ── 4. Obfuscate the MODULE ──────────────────────────────────────────────
const obf = JavaScriptObfuscator.obfuscate(source, {
  compact: true,
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,            // keep window._* handlers reachable from HTML onclick=""
  stringArray: true,
  stringArrayThreshold: 1,         // encode EVERY string literal (guarantees the server URL & all endpoints are never a plain, grep-able string in the shipped file)
  stringArrayEncoding: ['base64'],
  selfDefending: false,            // breaks when wrapped/injected
  disableConsoleOutput: true,
}).getObfuscatedCode();
fs.writeFileSync('/tmp/_nx_obf.mjs', obf);
execSync('node --check /tmp/_nx_obf.mjs');
log('obfuscated    :', obf.length, 'bytes — syntax OK');

// ── 5. Deflate -> base64 ─────────────────────────────────────────────────
const b64 = zlib.deflateSync(Buffer.from(obf, 'utf8')).toString('base64');
log('deflate+b64   :', b64.length, 'bytes');

// ── 6. Loader IIFE (native DecompressionStream, injects as module) ───────
const iife =
`(function(){
const _d=atob("${b64}");
const _b=new Uint8Array(_d.length);
for(let i=0;i<_d.length;i++)_b[i]=_d.charCodeAt(i);
const _ds=new DecompressionStream('deflate');
const _w=_ds.writable.getWriter();
_w.write(_b);_w.close();
new Response(_ds.readable).text().then(code=>{
const s=document.createElement('script');
s.type='module';s.textContent=code;
document.head.appendChild(s);
});
})();`;

// round-trip verify
const check = zlib.inflateSync(Buffer.from(b64, 'base64')).toString('utf8');
if (check !== obf) { console.error('ROUND-TRIP MISMATCH'); process.exit(1); }
log('round-trip    : OK');

// ── 7. Inline IIFE into index.html (no separate core.*.js file) ──────────
// Remove any stale core.*.js files from the old approach
for (const f of fs.readdirSync(ROOT)) {
  if (/^core\.[0-9a-f]{12}\.js$/.test(f)) { fs.unlinkSync(path.join(ROOT, f)); log('removed stale :', f); }
}

const coreTag = `<script data-nx-core>${iife}</script>`;

// Replace existing inline core tag OR old <script src="core.*.js"> loader tag
if (/<script data-nx-core>[\s\S]*?<\/script>/.test(html)) {
  html = html.replace(/<script data-nx-core>[\s\S]*?<\/script>/, coreTag);
} else if (/<script src="core\.(?:__HASH__|[0-9a-f]{12})\.js"[^>]*><\/script>/.test(html)) {
  html = html.replace(/<script src="core\.(?:__HASH__|[0-9a-f]{12})\.js"[^>]*><\/script>/, coreTag);
} else {
  console.error('Could not find loader placeholder in index.html'); process.exit(1);
}

fs.writeFileSync(HTML, html);
log('index.html    :', fs.statSync(HTML).size, 'bytes — IIFE inlined');

// ── Sync the clean deploy folder (dist/) — ONLY shippable files land here so
//    EdgeOne's git auto-deploy never exposes source (original_module.js/server.js/etc.)
const DIST = __dirname + '/dist';
if (!fs.existsSync(DIST)) fs.mkdirSync(DIST);
['index.html', 'manifest.json', 'sw.js', 'icon-192.png', 'icon-512.png']
  .forEach((f) => fs.copyFileSync(__dirname + '/' + f, DIST + '/' + f));
log('dist/         : synced (index.html, manifest.json, sw.js, icon-192.png, icon-512.png)');

log('\nDone. EdgeOne auto-deploys the dist/ folder from git — no manual upload needed.');
