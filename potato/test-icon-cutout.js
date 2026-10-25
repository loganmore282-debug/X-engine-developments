'use strict';
// The admin panel's icon cut-out (potatoCutout): background removed from the border inward, edges softened, cropped exactly.
const fs = require('node:fs'), assert = require('node:assert/strict');
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); };
const admin = fs.readFileSync(__dirname + '/admin-src/index.html', 'utf8');
const a = admin.indexOf('function potatoCutout'), b = admin.indexOf('// The icon slots (same names');
ok(a > 0 && b > a, 'the cut-out engine is in the admin panel');
const potatoCutout = new Function(admin.slice(a, b) + '\nreturn potatoCutout;')();

function canvas(w, h, bg) { const d = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < w * h; i++) { const c = typeof bg === 'function' ? bg(i % w, (i / w) | 0) : bg; d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2]; d[i * 4 + 3] = c.length > 3 ? c[3] : 255; } return d; }
function disc(d, w, cx, cy, r, col) { for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++) for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) { const dd = Math.hypot(x - cx, y - cy); if (dd <= r) { const o = (y * w + x) * 4; d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = 255; } } }
const alphaAt = (r, x, y) => r.data[(y * r.w + x) * 4 + 3];

// 1. flat white background, red disc: the background goes, the crop is the disc
{ const w = 200, h = 160, d = canvas(w, h, [255, 255, 255]); disc(d, w, 100, 80, 50, [220, 30, 30]);
  const r = potatoCutout(d, w, h);
  ok(!r.empty && Math.abs(r.w - 101) <= 3 && Math.abs(r.h - 101) <= 3, 'cropped to the disc (got ' + r.w + 'x' + r.h + ')');
  ok(alphaAt(r, 0, 0) === 0 && alphaAt(r, r.w - 1, r.h - 1) === 0, 'the corners are transparent');
  ok(alphaAt(r, r.w >> 1, r.h >> 1) === 255, 'the middle stays solid');
  const o = ((r.h >> 1) * r.w + (r.w >> 1)) * 4; ok(r.data[o] > 200 && r.data[o + 1] < 60, 'the colour is unchanged'); }

// 2. a soft gradient background (light grey to white) and a noisy one: still removed
{ const w = 160, h = 160, d = canvas(w, h, (x, y) => { const v = 235 + Math.round(20 * (x + y) / (w + h)) + ((x * 7 + y * 13) % 5 - 2); return [v, v, v]; });
  disc(d, w, 80, 80, 40, [30, 90, 200]);
  const r = potatoCutout(d, w, h);
  ok(Math.abs(r.w - 81) <= 3 && Math.abs(r.h - 81) <= 3, 'a gradient background is followed and removed (got ' + r.w + 'x' + r.h + ')');
  ok(alphaAt(r, 0, 0) === 0 && alphaAt(r, r.w >> 1, r.h >> 1) === 255, 'transparent corner, solid middle'); }

// 3. a coloured flat background
{ const w = 120, h = 120, d = canvas(w, h, [20, 140, 70]); disc(d, w, 60, 60, 30, [250, 200, 20]);
  const r = potatoCutout(d, w, h); ok(Math.abs(r.w - 61) <= 3, 'a green background goes too'); ok(alphaAt(r, 0, 0) === 0, 'corner transparent'); }

// 4. the white inside an icon is kept (it is enclosed, so the fill never reaches it)
{ const w = 160, h = 160, d = canvas(w, h, [255, 255, 255]); disc(d, w, 80, 80, 60, [200, 20, 20]); disc(d, w, 80, 80, 25, [255, 255, 255]);
  const r = potatoCutout(d, w, h); const o = ((r.h >> 1) * r.w + (r.w >> 1)) * 4;
  ok(r.data[o + 3] === 255 && r.data[o] > 240 && r.data[o + 1] > 240, 'a white centre inside the icon stays white and solid'); }

// 5. a picture that already has transparency is only cropped
{ const w = 100, h = 100, d = canvas(w, h, [0, 0, 0, 0]); disc(d, w, 30, 40, 10, [10, 200, 10]);
  const r = potatoCutout(d, w, h); ok(r.w >= 20 && r.w <= 22 && r.h >= 20 && r.h <= 22, 'already-transparent: just cropped'); ok(alphaAt(r, r.w >> 1, r.h >> 1) === 255, 'and untouched inside'); }

// 6. the edge has no white halo: pixels on the rim are the icon colour (de-fringed), not a white-red mix
{ const w = 200, h = 200, d = canvas(w, h, [255, 255, 255]); disc(d, w, 100, 100, 70, [0, 60, 200]);
  // antialias the rim by blending a ring of pixels with white
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const dd = Math.hypot(x - 100, y - 100); if (dd > 69 && dd <= 71) { const t = 71 - dd; const o = (y * w + x) * 4; d[o] = Math.round(255 * (1 - t) + 0 * t); d[o + 1] = Math.round(255 * (1 - t) + 60 * t); d[o + 2] = Math.round(255 * (1 - t) + 200 * t); } }
  const r = potatoCutout(d, w, h); let worst = 0, seen = 0;
  for (let i = 0; i < r.w * r.h; i++) { const al = r.data[i * 4 + 3]; if (al > 20 && al < 235) { seen++; worst = Math.max(worst, r.data[i * 4], r.data[i * 4 + 1] - 60); } }
  ok(seen > 20, 'there is a soft edge'); ok(worst < 90, 'no white halo on the edge (worst red/green excess ' + worst + ')'); }

// 7. nothing but background: reported as empty, never a crash
{ const r = potatoCutout(canvas(50, 50, [255, 255, 255]), 50, 50); ok(r.empty === true, 'a blank picture is reported empty'); }

// 8. a tiny speck away from the icon is dropped
{ const w = 200, h = 200, d = canvas(w, h, [255, 255, 255]); disc(d, w, 100, 100, 50, [200, 30, 30]); disc(d, w, 10, 10, 1.5, [30, 30, 30]);
  const r = potatoCutout(d, w, h); ok(Math.abs(r.w - 101) <= 3, 'a speck far from the icon does not stretch the crop (got ' + r.w + ')'); }

// wiring
ok(/fileToCutoutPng\(f, 640\)/.test(admin) && /iconFile_\$\{k\}/.test(admin) && /POTATO_ICON_LABELS = \{ ordergift/.test(admin), 'the Icons box is on the Banners tab');
const srv = fs.readFileSync(__dirname + '/server.js', 'utf8');
ok(/POTATO_ICON_SLOTS = \['ordergift', 'downloadapp'\]/.test(srv) && /Icons must be PNG pictures/.test(srv), 'the server knows the two icon slots and only takes PNGs for them');
console.log('PASS: icon cut-out (' + n + ' checks)');
