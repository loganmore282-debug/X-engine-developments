'use strict';
// The Share page's QR code is drawn by the server: GET /share/qr?text=<link>. Only http(s) links up to 400 characters are drawn.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const src = fs.readFileSync(__dirname + '/server.js', 'utf8');
const mod = fs.readFileSync(__dirname + '/user-src/original_module.js', 'utf8');
const QRCode = require('qrcode');
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); };
ok(/app\.get\('\/share\/qr'/.test(src) && /text\.length > 400/.test(src) && /\^https\?:/.test(src), 'the route exists and only draws http(s) links up to 400 characters');
ok(/Cache-Control', 'public, max-age=86400'/.test(src) && /image\/svg\+xml/.test(src), 'the answer is a cached SVG');
ok(/\$\{API_BASE\}\/share\/qr\?text=\$\{encodeURIComponent\(link\)\}/.test(mod), 'the Share page asks the server for the QR of the invitation link');
ok(/My QR code/.test(mod) && /ck-sc-cut/.test(mod) && /purchase commission/.test(mod) && /Level \$\{n\}/.test(mod), 'the page has the title, the dashed cut, the commission sentence and Level rows');
const svg = QRCode.toString ? true : false; ok(svg, 'the qrcode package is installed');
const pj = JSON.parse(fs.readFileSync(__dirname + '/package.json', 'utf8')); ok(pj.dependencies && pj.dependencies.qrcode, 'qrcode is a dependency, so the VPS installs it on every update');
QRCode.toString('https://example.test/h5/#/pages/login/reset?inviteCode=abc12345', { type: 'svg', margin: 1 }, (e, out) => {
  assert.ok(!e && /^<svg/.test(out) && out.length > 500, 'a real QR drawing is produced');
  console.log('PASS: share QR (' + (n + 1) + ' checks)');
});
