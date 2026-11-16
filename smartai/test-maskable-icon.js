'use strict';
// The installed app's icon is ROUND on phones that cut icons to a circle only when the manifest lists a `maskable` icon. The server makes that one from the app icon
// (the owner's upload or the stock one): scaled to 74% and its edges continued outwards, so the robot stays inside the launcher's safe circle.
//   node test-maskable-icon.js
const fs = require('fs'), vm = require('vm'), zlib = require('zlib'), assert = require('assert');
const server = fs.readFileSync(__dirname + '/server.js', 'utf8');
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); };
const a = server.indexOf('function pngDecodeRGBA('), b = server.indexOf('let _maskableCache');
ok(a > 0 && b > a, 'the icon code is in server.js');
const c = vm.createContext({ require, Buffer, Math });
vm.runInContext(server.slice(a, b) + ';this.f={pngDecodeRGBA,pngEncodeRGBA,makeMaskablePng};', c);
const F = c.f;
const icon = fs.readFileSync(__dirname + '/user/icon-512.png');
const src = F.pngDecodeRGBA(icon);
ok(src && src.w === 512 && src.h === 512, 'the stock icon is read (512 x 512)');
const again = F.pngDecodeRGBA(F.pngEncodeRGBA(src.w, src.h, src.px));
ok(again && Buffer.compare(again.px, src.px) === 0, 'encoding then decoding gives the very same pixels');
const mk = F.makeMaskablePng(icon);
const out = F.pngDecodeRGBA(mk);
ok(out && out.w === 512 && out.h === 512 && mk.slice(1, 4).toString() === 'PNG', 'the round-safe icon is a 512 x 512 PNG');
const px = (img, x, y) => [img.px[(y * img.w + x) * 4], img.px[(y * img.w + x) * 4 + 1], img.px[(y * img.w + x) * 4 + 2]];
const near = (p, q, d) => p.every((v, i) => Math.abs(v - q[i]) <= d);
const blk = (img, cx, cy, r) => { const s = [0, 0, 0]; let k = 0; for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) { const p = px(img, x, y); s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; k++; } return s.map(v => v / k); };
ok(near(blk(out, 256, 256, 10), blk(src, 256, 256, 14), 28), 'the middle of the picture is still the middle');
// the robot's width: the picture now spans 74% of the canvas, so a point 0.74 as far from the centre lands where the original point was
ok(near(blk(out, 256 + Math.round(120 * 0.74), 256, 5), blk(src, 256 + 120, 256, 7), 30), 'the picture is shrunk to 74%');
ok(near(px(out, 0, 0), px(out, 40, 40), 10) && near(px(out, 511, 511), px(out, 470, 470), 10), 'the border continues the edge colours (no seam, no white corners)');
ok(out.px[3] === 255 && out.px[(511 * 512 + 511) * 4 + 3] === 255, 'every pixel is opaque');
ok(F.makeMaskablePng(Buffer.from('not a png')) === null, 'an unreadable image gives nothing (the server then serves the icon as it is)');
const man = JSON.parse(fs.readFileSync(__dirname + '/user/manifest.json', 'utf8'));
ok(man.icons.some(i => i.purpose === 'maskable' && /app-icon-maskable-512\.png$/.test(i.src) && i.sizes === '512x512') && man.icons.filter(i => i.purpose === 'any').length === 2, 'the manifest lists the round-safe icon as maskable and keeps the two normal ones');
ok(/app\.get\('\/public\/app-icon-maskable-512\.png'/.test(server) && /getBrandAsset\('app-icon-512'\)/.test(server.slice(server.indexOf('async function getMaskableIcon'), server.indexOf('async function getMaskableIcon') + 300)), 'the route builds it from the current app icon');
fs.writeFileSync(require('os').tmpdir() + '/maskable-preview.png', mk);
console.log('PASS: round-safe (maskable) app icon (' + n + ' checks)');
