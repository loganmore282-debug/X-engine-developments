#!/usr/bin/env node
/*
 * build-admin.js — secure the Soda admin panel.
 * Source: admin-src/index.html
 * Output: admin/index.html
 *
 * Run by hand before every deploy to the VPS (see soda/CLAUDE.md, "Build
 * & deploy pipeline"). Keep all browser-facing admin hotfixes here
 * deterministic and fail the build if an expected source anchor
 * disappears, rather than silently shipping an old/broken notification
 * bundle.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execSync } = require('child_process');
const JavaScriptObfuscator = require('javascript-obfuscator');

const ROOT     = __dirname;
const SRC_HTML = path.join(ROOT, 'admin-src', 'index.html');
const GUARD    = path.join(ROOT, 'guard-src.js');
const OUT_DIR  = path.join(ROOT, 'admin');
const OUT_HTML = path.join(OUT_DIR, 'index.html');
const log = (...a) => console.log(...a);

const html = fs.readFileSync(SRC_HTML, 'utf8');

// Find the single largest classic inline script: that is the admin app.
const scriptRe = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/g;
let m, best = null;
while ((m = scriptRe.exec(html))) {
  const attrs = m[1] || '';
  if (/\bsrc=|\btype=["']module["']/.test(attrs)) continue;
  if (!best || m[2].length > best[2].length) best = m;
}
if (!best) {
  console.error('No plain inline <script> block found in admin-src/index.html');
  process.exit(1);
}
const fullMatch = best[0], matchIndex = best.index;
let code = best[2];

// The Firebase Web Push public key lives in admin-src/index.html and NOWHERE
// ELSE. It is public browser configuration, not a service-account secret.
//
// This step used to hold its own copy and REWRITE the source's value at build
// time. That is a trap rather than a safety net: the two copies had already
// drifted apart, so reading admin-src gave the wrong key and editing it there
// changed nothing -- the build silently put its own value back. Same class as
// every other "constant restated in a second place" this project has had to
// unpick.
//
// So the value is the source's, and this step only VALIDATES it, which is what
// the guard was actually for: fail the build rather than ship a bundle whose
// notifications cannot work. A VAPID P-256 public key is uncompressed-point
// base64url -- 87 or 88 characters, always starting with 'B'.
const vapidLineRe = /const VAPID_KEY\s*=\s*['"]([^'"]*)['"]\s*;/;
const vapidMatch = vapidLineRe.exec(code);
if (!vapidMatch) {
  console.error('const VAPID_KEY was not found in admin-src/index.html -- admin push would silently never work.');
  process.exit(1);
}
if (!/^B[A-Za-z0-9_-]{85,86}$/.test(vapidMatch[1])) {
  console.error(`VAPID_KEY in admin-src/index.html does not look like a Web Push public key ` +
                `(got ${vapidMatch[1].length} chars). Paste the key from Firebase ` +
                `Console -> Cloud Messaging -> Web Push certificates.`);
  process.exit(1);
}

// The bounded Notify flow (enablePush) and the button's initial state used to be
// REWRITTEN into the bundle here, which left admin-src and the shipped panel
// disagreeing -- the same "constant restated in a second place" trap as the
// VAPID key above. They live in admin-src/index.html now, so what is edited and
// tested is exactly what ships; this step only checks they are still there.
for (const need of ['async function enablePush(){', 'const withTimeout = (promise, ms, message)', "PUSH_KEY_VER_KEY) || ''"]) {
  if (!code.includes(need)) {
    console.error(`admin-src/index.html is missing "${need}" -- admin push would not work.`);
    process.exit(1);
  }
}

log('main script source:', code.length, 'bytes');

// Lift the member app's single source of truth for i18n into the admin build.
const APP_JS = path.join(ROOT, 'user-src', 'original_module.js');
const appSrc = fs.readFileSync(APP_JS, 'utf8');
function lift(name) {
  const b = `// ==== I18N ${name}: SHARED WITH THE ADMIN PANEL - BEGIN ====\n`;
  const e = `// ==== I18N ${name}: SHARED WITH THE ADMIN PANEL - END ====\n`;
  const i = appSrc.indexOf(b), j = appSrc.indexOf(e);
  if (i < 0 || j < 0 || j < i) {
    console.error(`Cannot lift the i18n ${name} from user-src/original_module.js.`);
    process.exit(1);
  }
  return appSrc.slice(i + b.length, j);
}
function injectShared(src, name, text) {
  const b = `// ==== SHARED I18N ${name}: REPLACED BY build-admin.js - BEGIN ====\n`;
  const e = `// ==== SHARED I18N ${name}: REPLACED BY build-admin.js - END ====\n`;
  const i = src.indexOf(b), j = src.indexOf(e);
  if (i < 0 || j < 0 || j < i) {
    console.error(`Cannot inject the i18n ${name} into admin-src/index.html.`);
    process.exit(1);
  }
  return src.slice(0, i + b.length) + text + src.slice(j);
}
const sharedTable = lift('TABLE'), sharedEngine = lift('ENGINE');
code = injectShared(code, 'TABLE', sharedTable);
code = injectShared(code, 'ENGINE', sharedEngine);
for (const need of ['var LANG_ROWS = [', 'var LANG_PATTERNS = [', 'var DICT',
                    'function t(', 'function tPattern', 'function translateTree',
                    'function startI18nObserver']) {
  if (!code.includes(need)) {
    console.error(`i18n injection produced a script with no ${need.trim()}.`);
    process.exit(1);
  }
}
log('i18n shared      :', sharedTable.length, 'bytes of table +', sharedEngine.length, 'bytes of engine lifted from the app');

// Syntax-check the exact source that will be obfuscated.
fs.writeFileSync('/tmp/_snow_admin_src_check.js', code);
execSync('node --check /tmp/_snow_admin_src_check.js');
log('module source     : syntax OK');

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

const wrapped = `(function(){\n${code}\n})();`;
const obf = JavaScriptObfuscator.obfuscate(wrapped, {
  compact: true,
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,
  stringArray: true,
  stringArrayThreshold: 1,
  stringArrayEncoding: ['base64'],
  controlFlowFlattening: false,
  selfDefending: false,
  disableConsoleOutput: true,
}).getObfuscatedCode();
fs.writeFileSync('/tmp/_snow_admin_obf_check.js', obf);
execSync('node --check /tmp/_snow_admin_obf_check.js');
log('obfuscated        :', obf.length, 'bytes — syntax OK');

const b64 = zlib.deflateSync(Buffer.from(obf, 'utf8')).toString('base64');
log('deflate+b64       :', b64.length, 'bytes');
const roundTrip = zlib.inflateSync(Buffer.from(b64, 'base64')).toString('utf8');
if (roundTrip !== obf) {
  console.error('ROUND-TRIP MISMATCH');
  process.exit(1);
}
log('round-trip        : OK');

const loaderIife = `(function(){
if (typeof DecompressionStream === 'undefined') {
  var show=function(){
    var m=document.createElement('div');
    m.style.cssText='position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;text-align:center;padding:24px;background:#111111;color:#fff;font-family:sans-serif;font-size:15px;line-height:1.5';
    m.textContent='This browser is too old to run Soda Admin. Please update your browser (or open this link in Chrome) and try again.';
    document.body.appendChild(m);
  };
  if (document.body) show(); else document.addEventListener('DOMContentLoaded', show);
  return;
}
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

let outHtml = html.slice(0, matchIndex) + `<script data-nx-core>${loaderIife}</script>` + html.slice(matchIndex + fullMatch.length);
outHtml = outHtml.replace('<head>', '<head>\n' + guardTag);
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_HTML, outHtml);
log('admin/index.html  :', fs.statSync(OUT_HTML).size, 'bytes — deployed artifact written');
log('\nDone. Deploy the generated admin/ output.');
