#!/usr/bin/env node
/*
 * build-core.js — regenerate the externalized, cacheable app bundle.
 *
 * Pipeline:  original_module.js  ->  obfuscate  ->  deflate  ->  base64
 *            ->  wrap in DecompressionStream loader IIFE
 *            ->  write core.<contenthash>.js  (content hash = cache-busting)
 *            ->  point index.html's <script src> at the new file
 *
 * The hashed filename lets the CDN cache the bundle forever (immutable):
 * when the code changes, the hash changes, so the URL changes and the
 * browser fetches the new file. Unchanged deploys are served from cache.
 *
 * Usage:  node build-core.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { execSync } = require('child_process');
const JavaScriptObfuscator = require('javascript-obfuscator');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'original_module.js');
const HTML = path.join(ROOT, 'index.html');

function log(...a) { console.log(...a); }

// 1. Read source
const source = fs.readFileSync(SRC, 'utf8');
log('source        :', source.length, 'bytes');

// Syntax-check the source before doing anything
fs.writeFileSync('/tmp/_src_check.js', source);
execSync('node --check /tmp/_src_check.js');
log('source syntax : OK');

// 2. Obfuscate (matches the existing hexadecimal identifier style)
const obf = JavaScriptObfuscator.obfuscate(source, {
  compact: true,
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,            // keep window._* handlers reachable from HTML
  stringArray: true,
  stringArrayThreshold: 0.75,
  stringArrayEncoding: ['base64'],  // hide handler-name strings, matches prior build
  selfDefending: false,            // selfDefending breaks when wrapped/injected
  disableConsoleOutput: false,
}).getObfuscatedCode();
log('obfuscated    :', obf.length, 'bytes');

// Syntax-check the obfuscated output
fs.writeFileSync('/tmp/_obf_check.js', obf);
execSync('node --check /tmp/_obf_check.js');
log('obf syntax    : OK');

// 3. Deflate -> base64
const b64 = zlib.deflateSync(Buffer.from(obf, 'utf8')).toString('base64');
log('deflate+b64   :', b64.length, 'bytes');

// 4. Wrap in the loader IIFE (native DecompressionStream, injects as module)
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

// Verify the wrapped blob inflates back to the exact obfuscated code
const check = zlib.inflateSync(Buffer.from(b64, 'base64')).toString('utf8');
if (check !== obf) { console.error('ROUND-TRIP MISMATCH'); process.exit(1); }
log('round-trip    : OK');

// 5. Content-hashed filename
const hash = crypto.createHash('sha256').update(iife).digest('hex').slice(0, 12);
const fname = `core.${hash}.js`;

// Remove stale core.*.js bundles
for (const f of fs.readdirSync(ROOT)) {
  if (/^core\.[0-9a-f]{12}\.js$/.test(f) && f !== fname) {
    fs.unlinkSync(path.join(ROOT, f));
    log('removed stale :', f);
  }
}

fs.writeFileSync(path.join(ROOT, fname), iife + '\n');
log('wrote         :', fname, fs.statSync(path.join(ROOT, fname)).size, 'bytes');

// 6. Update index.html reference
let html = fs.readFileSync(HTML, 'utf8');
const tag = `<script src="${fname}" defer></script>`;
if (/<script src="core\.[0-9a-f]{12}\.js" defer><\/script>/.test(html)) {
  html = html.replace(/<script src="core\.[0-9a-f]{12}\.js" defer><\/script>/, tag);
} else {
  console.error('Could not find existing core script tag in index.html');
  process.exit(1);
}
fs.writeFileSync(HTML, html);
log('index.html    :', fs.statSync(HTML).size, 'bytes ->', tag);
log('\nDone. Deploy index.html +', fname, 'to EdgeOne.');
