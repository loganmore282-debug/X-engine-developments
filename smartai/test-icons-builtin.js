'use strict';
// The built-in blue icon pictures (the owner's icon pack, cut out to transparent WebP in user/icons/), the admin slots that can replace them, and the
// blue-and-white colours.
//   node test-icons-builtin.js
const fs = require('fs'), path = require('path'), vm = require('vm');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok   - ' + m); } else { fail++; console.log('  FAIL - ' + m); } };
const rd = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
const src = rd('user-src/original_module.js'), css = rd('user-src/index.html'), server = rd('server.js'), admin = rd('admin-src/index.html');
const dir = path.join(__dirname, 'user', 'icons');
const list = (text, re) => (text.match(re) || [, ''])[1].split(',').map(s => s.trim().replace(/['"]/g, '')).filter(Boolean);

// ---- the slots: the server, the admin panel and the files agree ----
const serverSlots = list(server, /const SMARTAI_ICON_SLOTS = \[([^\]]*)\]/);
const adminBuiltin = list(admin, /const SMARTAI_ICON_BUILTIN = \[([^\]]*)\]/);
const labelBlock = (admin.match(/const SMARTAI_ICON_LABELS = \{([\s\S]*?)\};/) || [, ''])[1];
const adminLabels = [...labelBlock.matchAll(/(?:^|[,{\s])([a-z]+):\s*'/g)].map(m => m[1]);
ok(serverSlots.length === 17 && new Set(serverSlots).size === 17, 'the server knows 17 icon slots (' + serverSlots.length + ')');
ok(JSON.stringify(serverSlots) === JSON.stringify(adminBuiltin), 'the admin panel lists the same slots, in the same order, as having a built-in picture');
ok(serverSlots.every(s => adminLabels.includes(s)) && adminLabels.length === serverSlots.length, 'and gives every slot a plain label (' + adminLabels.length + ')');
ok(/Icons must be PNG pictures with a transparent background/.test(server), 'the server takes only PNG pictures for an icon slot');

// ---- the files ----
const have = new Set(fs.existsSync(dir) ? fs.readdirSync(dir) : []);
ok(serverSlots.every(s => have.has(s + '.webp')), 'every slot has its built-in picture in user/icons/');
const refs = new Set([...(css + src).matchAll(/\/icons\/([A-Za-z0-9_-]+\.(?:webp|jpg|png))/g)].map(m => m[1]));
ok([...refs].every(f => have.has(f)), 'every picture the app asks for is in user/icons/ (' + refs.size + ' named in the code)');
const slotFiles = new Set(serverSlots.map(s => s + '.webp'));
ok([...have].every(f => slotFiles.has(f) || refs.has(f)), 'no unused picture is shipped (the owner: pick the best, not all): ' + [...have].filter(f => !slotFiles.has(f) && !refs.has(f)).join(', '));
ok(have.has('ugx-coin.png') && /<img class="ugx-coin" src="\/icons\/ugx-coin\.png"/.test(css) && (css.match(/src="\/icons\/ugx-coin\.png"/g) || []).length === 2, 'ChocoMCC\'s UGX coin picture is shipped and is both coins of the Me page');
ok(have.has('mtn.jpg') && have.has('airtel.jpg') && /<img src="\/icons\/mtn\.jpg"/.test(css) && /<img src="\/icons\/airtel\.jpg"/.test(css), 'the two network logos (MTN, Airtel) are there and used by the network pickers');
function webp(buf) {
  if (buf.length < 30 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') return null;
  let off = 12;
  while (off + 8 <= buf.length) {
    const tag = buf.toString('ascii', off, off + 4), len = buf.readUInt32LE(off + 4);
    if (tag === 'VP8X') return { alpha: !!(buf[off + 8] & 0x10), w: 1 + (buf.readUIntLE(off + 12, 3)), h: 1 + (buf.readUIntLE(off + 15, 3)) };
    off += 8 + len + (len & 1);
  }
  return { alpha: false, w: 0, h: 0 };
}
let allAlpha = true, allSquare = true, allSmall = true, allWebp = true, total = 0, bad = [];
for (const f of serverSlots.map(s => s + '.webp')) {
  if (!have.has(f)) continue;
  const buf = fs.readFileSync(path.join(dir, f)); total += buf.length;
  const w = webp(buf);
  if (!w) { allWebp = false; bad.push(f + ' not WebP'); continue; }
  if (!w.alpha) { allAlpha = false; bad.push(f + ' no alpha'); }
  if (w.w !== 192 || w.h !== 192) { allSquare = false; bad.push(f + ' ' + w.w + 'x' + w.h); }
  if (buf.length > 20000) { allSmall = false; bad.push(f + ' ' + buf.length + ' bytes'); }
}
ok(allWebp, 'every slot picture is a real WebP picture');
ok(allAlpha, 'every picture has a transparent background (cut out, no baked-in box)');
ok(allSquare, 'every picture is 192 x 192 (centred in a square, sharp up to 64 px on a 3x phone)' + (bad.length ? ' -> ' + bad.join('; ') : ''));
ok(allSmall && total < 260000, 'every picture is under 20 kB (' + Math.round(total / 1024) + ' kB in all)');

// ---- the rule that picks the picture: an admin upload wins, else the built-in one ----
const fn = (src.match(/function iconUrl\(name\)\{[^\n]*\}/) || [''])[0];
ok(!!fn, 'iconUrl picks the picture of a slot');
const ctx = { STATE_ICONS: {} };
vm.createContext(ctx); vm.runInContext(fn, ctx);
const pick = k => vm.runInContext('iconUrl(' + JSON.stringify(k) + ')', ctx);
ok(pick('home') === '/icons/home.webp', 'nothing uploaded: the built-in Home picture shows');
ctx.STATE_ICONS = { home: 'data:image/png;base64,AAAA', deposit: null, withdraw: '' };
ok(pick('home') === 'data:image/png;base64,AAAA', 'an uploaded picture replaces the built-in one');
ok(pick('deposit') === '/icons/deposit.webp' && pick('withdraw') === '/icons/withdraw.webp', 'a slot the admin left empty (null / "") keeps the built-in picture');
ctx.STATE_ICONS = null;
ok(pick('my') === '/icons/my.webp', 'before the pictures arrive the built-in ones already show (no empty tab bar)');
ok(/img\.onerror = function\(\)\{ this\.onerror = null; this\.src = '\/icons\/' \+ name \+ '\.webp'; \};/.test(src), 'an uploaded picture that cannot be loaded falls back to the built-in one');
ok(/STATE_ICONS = im\.icons \|\| \{\};/.test(src), 'the uploaded pictures come from /public/smartai-images');

// ---- every place that draws an icon names a real slot ----
const used = new Set([...(css + src).matchAll(/data-icon=\\?["']([a-z]+)\\?["']/g)].map(m => m[1]).concat([...src.matchAll(/artFillHtml\('([a-z]+)'\)|artHtml\([^,]+,\s*'([a-z]+)'\)/g)].map(m => m[1] || m[2])));
ok(used.size >= 14 && [...used].every(u => serverSlots.includes(u)), 'every data-icon in the app names a real slot (' + used.size + ' used)' + ([...used].filter(u => !serverSlots.includes(u)).join(',')));
const mapNames = [...src.matchAll(/\['[A-Za-z]+Banner(?:Art)?', [^,]*, '([a-z]+)'\]/g)].map(m => m[1]);
ok(mapNames.length >= 9 && mapNames.every(u => serverSlots.includes(u)), 'every art banner uses a real slot (' + mapNames.length + ' banners)');
ok(!/STATE_ICONS\[/.test(src.replace(/function iconUrl[^\n]*\n/, '')), 'nothing reads the uploaded icons directly (all go through iconUrl)');
const imgs = [...css.matchAll(/<img[^>]*data-icon="([a-z]+)"[^>]*>/g)];
ok(imgs.length >= 20 && imgs.every(m => !/\ssrc="/.test(m[0]) || new RegExp('src="/icons/' + m[1] + '\\.webp"').test(m[0])), 'each picture in the page starts with its own built-in file, so it shows on the first frame (' + imgs.length + ' pictures)');

// ---- blue and white: the only reds are error / failure colours ----
function hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2; let h = 0, s = 0;
  if (mx !== mn) { const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; }
  return { h, s, l };
}
const noComments = css.replace(/\/\*[\s\S]*?\*\//g, m => ' '.repeat(m.length)).replace(/<!--[\s\S]*?-->/g, m => ' '.repeat(m.length));
const reds = new Set();
const tok = /#([0-9a-fA-F]{6})\b|#([0-9a-fA-F]{3})\b|rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*[\d.]+\s*)?\)/g;
let m;
while ((m = tok.exec(noComments))) {
  let r, g, b;
  if (m[1] || m[2]) { const x = m[1] || m[2].split('').map(c => c + c).join(''); r = parseInt(x.slice(0, 2), 16); g = parseInt(x.slice(2, 4), 16); b = parseInt(x.slice(4, 6), 16); }
  else { r = +m[3]; g = +m[4]; b = +m[5]; }
  const { h, s, l } = hsl(r, g, b);
  if (s >= 0.22 && (h >= 335 || h <= 22) && l > 0.12 && l < 0.97) reds.add(m[0].toLowerCase());
}
const ERROR_REDS = new Set(['#c23b4b', '#f8dee1', '#9c2c3a', 'rgba(194,59,75,.5)']);   // --berry, --berry-pale and the danger button
const strays = [...reds].filter(c => !ERROR_REDS.has(c));
ok(strays.length === 0, 'the only reds in the CSS are the error / failure colours (a stray one would be a pasted ChocoMCC red)' + (strays.length ? ' -> ' + strays.join(' | ') : ''));
ok(/--caramel:#137AEF/i.test(css) && /--cream:#EEF4FF/i.test(css) && /--caramel-deep:#0D5FD2/i.test(css), 'the brand colours are the blues of the icons');
ok(/<meta name="theme-color" content="#(?:EEF4FF|137AEF|0964CD)"/i.test(css), 'the phone\'s address bar is blue or white too');

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
