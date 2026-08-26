#!/usr/bin/env node
/*
 * build-admin.js — secure the Snow admin panel.
 *
 * Source (readable, EDIT THIS)    : admin-src/index.html
 * Output (obfuscated, DEPLOYED)   : admin/index.html
 *
 * Pipeline (mirrors build-core.js, with one deliberate difference — see
 * the IIFE-wrap note below):
 *   - Find the single largest inline <script> in admin-src/index.html (the
 *     real app logic — login, tabs, every render*() function). Small plain
 *     scripts (the head PWA-install snippet, the tail SW auto-update
 *     snippet) are left untouched, same as build-core.js does for
 *     user-src/index.html's own small head script.
 *   - guard-src.js -> obfuscate -> inline <script data-nx-guard> in <head>
 *   - the big inline script -> wrap in an IIFE -> obfuscate -> deflate ->
 *     base64 -> DecompressionStream loader IIFE -> inlined as
 *     <script data-nx-core> in admin/index.html.
 *
 * IIFE-wrap, not var-only: build-core.js's original_module.js follows a
 * strict "every top-level binding must be var, never const/let" rule,
 * because renameGlobals:false routes top-level identifier references
 * through window['name'] — correct for var/function (real window
 * properties in a classic script) but silently wrong for const/let (never
 * become window properties even at top level). admin-src/index.html's main
 * script has dozens of top-level const/let (SERVER, TX_LABELS, VALID_TABS,
 * _tab, _users, ...) that would all need converting to avoid that exact
 * bug. Rewriting all of them was judged higher-risk than the alternative
 * used here: confirmed (grep) that admin-src/index.html has exactly ONE
 * inline onclick="" anywhere in its markup, and it was changed to the
 * file's own existing data-close/addEventListener convention instead — so
 * NOTHING outside this script needs any of its top-level names reachable
 * via window at all. Wrapping the whole script in `(function(){ ... })();`
 * before obfuscating means there IS no top-level scope left for
 * renameGlobals to reason about — every const/let/function becomes a
 * normal function-local binding, safely renamed like anything else, with
 * no window[...] indirection and no risk of this bug class recurring.
 *
 * Usage:  node build-admin.js
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

// ── 1. Find the single largest inline <script> (no src=, no type=module) ──
const scriptRe = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/g;
let m, best = null;
while ((m = scriptRe.exec(html))) {
  const attrs = m[1] || '';
  if (/\bsrc=|\btype=["']module["']/.test(attrs)) continue; // external / firebase module script
  if (!best || m[2].length > best[2].length) best = m;
}
if (!best) { console.error('No plain inline <script> block found in admin-src/index.html'); process.exit(1); }
const fullMatch = best[0], code = best[2], matchIndex = best.index;
log('main script source:', code.length, 'bytes');

// ── 2. Syntax-check the raw source before touching it ─────────────────────
fs.writeFileSync('/tmp/_snow_admin_src_check.js', code);
execSync('node --check /tmp/_snow_admin_src_check.js');
log('module source     : syntax OK');

// ── 3. Obfuscate the GUARD and inline it in <head> ─────────────────────────
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

// ── 4. Wrap in an IIFE, then obfuscate the logic ───────────────────────────
// See the IIFE-wrap note at the top of this file for why this replaces the
// var-only convention build-core.js uses for user-src/original_module.js.
const wrapped = `(function(){\n${code}\n})();`;
const obf = JavaScriptObfuscator.obfuscate(wrapped, {
  compact: true,
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,
  stringArray: true,
  stringArrayThreshold: 1,          // encode every string literal — server URL/endpoints never plain
  stringArrayEncoding: ['base64'],
  controlFlowFlattening: false,     // same tradeoff build-core.js documents for the user app
  selfDefending: false,
  disableConsoleOutput: true,
}).getObfuscatedCode();
fs.writeFileSync('/tmp/_snow_admin_obf_check.js', obf);
execSync('node --check /tmp/_snow_admin_obf_check.js');
log('obfuscated        :', obf.length, 'bytes — syntax OK');

// ── 5. Deflate -> base64 ────────────────────────────────────────────────────
const b64 = zlib.deflateSync(Buffer.from(obf, 'utf8')).toString('base64');
log('deflate+b64       :', b64.length, 'bytes');

const roundTrip = zlib.inflateSync(Buffer.from(b64, 'base64')).toString('utf8');
if (roundTrip !== obf) { console.error('ROUND-TRIP MISMATCH'); process.exit(1); }
log('round-trip        : OK');

const loaderIife =
`(function(){
if (typeof DecompressionStream === 'undefined') {
  var show=function(){
    var m=document.createElement('div');
    m.style.cssText='position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;text-align:center;padding:24px;background:#111111;color:#fff;font-family:sans-serif;font-size:15px;line-height:1.5';
    m.textContent='This browser is too old to run Snow Admin. Please update your browser (or open this link in Chrome) and try again.';
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

// ── 6. Assemble the deployed admin/index.html ──────────────────────────────
let outHtml = html.slice(0, matchIndex) + `<script data-nx-core>${loaderIife}</script>` + html.slice(matchIndex + fullMatch.length);
outHtml = outHtml.replace('<head>', '<head>\n' + guardTag);

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_HTML, outHtml);
log('admin/index.html  :', fs.statSync(OUT_HTML).size, 'bytes — deployed artifact written');

log('\nDone. Commit both admin-src/ (readable) and admin/ (built).');
