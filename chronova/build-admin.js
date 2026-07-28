/* ════════════════════════════════════════════════════════════════════════
   CHRONOVA ADMIN BUILD
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
  controlFlowFlattening: true,   // owner-only tool, desktop-grade hardware — size matters less than on the user app
  controlFlowFlatteningThreshold: 0.5,
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

// Admin used to also be hidden inside the user-app's dist/ folder under an
// unguessable filename, back before it had its own EdgeOne project. Now that
// admin-dist/ below is deployed as its own site, that copy is pure unnecessary
// exposure on the public domain — stop writing it, and delete any copies a past
// build already left on disk so they don't linger and keep shipping.
const USER_DIST = path.join(__dirname, 'dist');
['chronohq.html', 'panel-9f3k7m2q8x4d.html', 'chronohq-manifest.json', 'chronohq-sw.js']
  .forEach(f => { const p = path.join(USER_DIST, f); if (fs.existsSync(p)) fs.unlinkSync(p); });

// ── DEDICATED ADMIN SITE (its own EdgeOne project → chronoadmin.edgeone.app) ──
// A standalone folder whose index.html IS the admin, so a second EdgeOne project
// pointed at chronova/admin-dist serves the panel at the domain root and
// auto-deploys on every git push — exactly like the user app in dist/.
const ADIST = path.join(__dirname, 'admin-dist');
if (!fs.existsSync(ADIST)) fs.mkdirSync(ADIST);
fs.copyFileSync(OUT, path.join(ADIST, 'index.html'));
['icon-192.png', 'icon-512.png', 'icon-maskable-192.png', 'icon-maskable-512.png'].forEach(ic => {
  const src = path.join(__dirname, ic);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(ADIST, ic));
});
fs.writeFileSync(path.join(ADIST, 'manifest.json'), JSON.stringify({
  id: '/', name: 'Chronova Admin', short_name: 'Chronova Admin',
  start_url: '/', scope: '/', display: 'standalone',
  background_color: '#0c0b0e', theme_color: '#0c0b0e',
  icons: [
    { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
    { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
  ]
}, null, 2));
fs.writeFileSync(path.join(ADIST, 'sw.js'),
  "self.addEventListener('install',function(){self.skipWaiting();});\n" +
  "self.addEventListener('activate',function(e){e.waitUntil(self.clients.claim());});\n" +
  "self.addEventListener('fetch',function(){});\n" +
  // Push notifications (pending withdrawals, completed deposits) still need
  // to show up while the admin panel tab isn't open/focused — this is the
  // only part of the SW that does anything beyond skip-waiting/claim, it
  // adds no caching so the no-stale-data guarantee above is untouched.
  "self.addEventListener('push',function(e){\n" +
  "  var d={}; try{ d=e.data.json(); }catch(_){}\n" +
  "  var n=d.notification||d||{};\n" +
  "  e.waitUntil(self.registration.showNotification(n.title||'Chronova Admin',{body:n.body||'',icon:'/icon-192.png',data:d.data||{}}));\n" +
  "});\n" +
  "self.addEventListener('notificationclick',function(e){\n" +
  "  e.notification.close();\n" +
  "  e.waitUntil(clients.openWindow('/'));\n" +
  "});\n");

const kb = (n) => (n / 1024).toFixed(1) + ' KB';
console.log('admin source :', kb(fs.statSync(SRC).size), '(readable — edit this)');
console.log('app script   :', kb(Buffer.byteLength(rawJs)), '→ obfuscated', kb(Buffer.byteLength(obf)));
console.log('admin.dist   :', kb(fs.statSync(OUT).size), '— single-file admin');
console.log('admin-dist/  : index.html + manifest + sw + icons → EdgeOne project (chronoadmin)');
console.log('\nDeploy: EdgeOne project A → chronova/dist (user app), project B → chronova/admin-dist (admin). Both auto-deploy on push.');
