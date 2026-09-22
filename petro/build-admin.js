#!/usr/bin/env node
/*
 * build-admin.js — secure the Petro admin panel.
 * Source: admin-src/index.html
 * Output: admin/index.html
 *
 * EdgeOne runs this file on every deployment. Keep all browser-facing
 * admin hotfixes here deterministic and fail the build if an expected
 * source anchor disappears, rather than silently shipping an old/broken
 * notification bundle.
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

// The old Notify flow could appear to do absolutely nothing when
// navigator.serviceWorker.ready never resolved. The initial registration
// deliberately swallowed its error, then enablePush() waited forever.
// Replace only that function at build time with a bounded flow that gives
// immediate feedback, explicitly registers/updates the worker, times out
// instead of hanging forever, and surfaces the actual browser/Firebase error.
const pushStart = code.indexOf('async function enablePush(){');
const pushEnd = code.indexOf('// Owner-reported:', pushStart);
if (pushStart < 0 || pushEnd < 0 || pushEnd <= pushStart) {
  console.error('Cannot patch admin push setup -- enablePush() anchors are missing.');
  process.exit(1);
}
const robustEnablePush = `async function enablePush(){
  if (!VAPID_KEY) return toast('Push notifications are not configured yet', 'err');
  if (typeof Notification === 'undefined' || !('serviceWorker' in navigator))
    return toast('Push notifications are not supported on this device/browser', 'err');
  if (Notification.permission === 'denied')
    return toast('Notifications are blocked for this site. Allow them in browser Site settings, then tap Notify again.', 'err');
  const messaging = firebaseMessagingReady();
  if (!messaging) return toast('Push notifications are not supported on this device/browser', 'err');

  const btn = $('pushBtn');
  let enabled = false;
  if (btn) { btn.disabled = true; btn.textContent = 'Enabling…'; }
  toast('Enabling notifications…', 'ok');

  const withTimeout = (promise, ms, message) => Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms))
  ]);

  try {
    const perm = Notification.permission === 'granted'
      ? 'granted'
      : await Notification.requestPermission();
    if (perm !== 'granted') {
      toast('Notification permission was not granted', 'err');
      return;
    }

    const reg = await withTimeout(
      navigator.serviceWorker.register('/sw.js', { updateViaCache:'none' }),
      10000,
      'The notification service worker could not start'
    );
    await reg.update().catch(()=>{});
    const readyReg = await withTimeout(
      navigator.serviceWorker.ready,
      10000,
      'The notification service worker did not become ready'
    );

    const token = await withTimeout(
      messaging.getToken({ vapidKey: VAPID_KEY, serviceWorkerRegistration: readyReg }),
      20000,
      'Firebase did not return a push token in time'
    );
    if (!token) throw new Error('Firebase did not return a push token');

    let prevToken = '';
    try { prevToken = localStorage.getItem('snow_admin_push_token') || ''; } catch(_){}
    if (prevToken && prevToken !== token)
      await api('/admin/push/unregister', { token: prevToken }).catch(()=>{});

    const r = await api('/admin/push/register', { token });
    if (r.status !== 'success') throw new Error(r.message || 'The server rejected the push token');

    try {
      localStorage.setItem('snow_admin_push_token', token);
      localStorage.setItem('petro_admin_push_key_version', 'v2');
    } catch(_){}
    setPushUIState(true);
    enabled = true;
    toast('Push notifications enabled', 'ok');
  } catch(e) {
    const detail = e && e.message ? e.message : 'Unknown browser error';
    toast('Could not enable notifications: ' + detail, 'err');
  } finally {
    if (btn) btn.disabled = false;
    if (!enabled) setPushUIState(false);
  }
}
`;
code = code.slice(0, pushStart) + robustEnablePush + code.slice(pushEnd);

// A token produced with the old VAPID key must not make the UI claim that
// notifications are already enabled. Keep the old token available so the
// new enablePush() can unregister it after obtaining the replacement token.
const oldPushState = "try { setPushUIState(!!localStorage.getItem('snow_admin_push_token')); } catch(_){}";
const newPushState = `try {
  const _pushToken = localStorage.getItem('snow_admin_push_token') || '';
  const _pushVersion = localStorage.getItem('petro_admin_push_key_version') || '';
  setPushUIState(_pushVersion === 'v2' && Notification.permission === 'granted' && !!_pushToken);
} catch(_) { setPushUIState(false); }`;
if (!code.includes(oldPushState)) {
  console.error('Cannot patch admin push state -- expected initial state line is missing.');
  process.exit(1);
}
code = code.replace(oldPushState, newPushState);

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
    m.textContent='This browser is too old to run Petro Admin. Please update your browser (or open this link in Chrome) and try again.';
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
