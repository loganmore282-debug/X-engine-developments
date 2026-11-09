'use strict';
// The built-in blue icon pictures (the owner's icon pack, cut out to transparent WebP in user/icons/) and the blue-and-white colours.
//   node test-icons-builtin.js
const fs = require('fs'), path = require('path'), vm = require('vm');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok   - ' + m); } else { fail++; console.log('  FAIL - ' + m); } };
const src = fs.readFileSync(path.join(__dirname, 'user-src', 'original_module.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, 'user-src', 'index.html'), 'utf8');
const dir = path.join(__dirname, 'user', 'icons');

// ---- which pictures the app asks for ----
const defMatch = src.match(/var SMARTAI_ICON_DEFAULTS = (\{[\s\S]*?\n\});/);
ok(!!defMatch, 'the app has a table of built-in icon pictures (SMARTAI_ICON_DEFAULTS)');
const defaults = defMatch ? vm.runInNewContext('(' + defMatch[1] + ')') : {};
const picMatch = src.match(/var PT_MENU_PIC = (\{[^}]*\});/);
ok(!!picMatch, 'the My page rows have their picture table (PT_MENU_PIC)');
const rowPics = picMatch ? vm.runInNewContext('(' + picMatch[1] + ')') : {};
const slots = (src.match(/var NAV_ICON_SLOT = (\{[^}]*\})/) || [])[1];
const navSlots = slots ? Object.values(vm.runInNewContext('(' + slots + ')')) : [];
ok(navSlots.length === 5 && navSlots.every(s => defaults[s]), 'all five bottom-bar tabs have a built-in picture');
const serverSlots = (fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8').match(/const SMARTAI_ICON_SLOTS = \[([^\]]*)\]/) || [])[1] || '';
const slotNames = serverSlots.split(',').map(s => s.trim().replace(/'/g, '')).filter(Boolean);
ok(['recharge', 'withdraw', 'service', 'channel', 'ordergift', 'downloadapp'].every(s => defaults[s] && slotNames.includes(s)), 'the Home buttons and the two floating pictures have built-in pictures, and are still admin slots');
ok(Object.keys(defaults).every(k => slotNames.includes(k)), 'every built-in picture belongs to an admin icon slot, so an upload still replaces it');

// ---- the files ----
const wanted = new Set([...Object.values(defaults).map(u => u.replace(/^\/icons\//, '')), ...Object.values(rowPics).map(n => n + '.webp')]);
const have = new Set(fs.existsSync(dir) ? fs.readdirSync(dir) : []);
ok([...wanted].every(f => have.has(f)), 'every picture the app asks for is in user/icons/ (' + wanted.size + ' files)');
ok([...have].every(f => wanted.has(f)), 'no unused picture is shipped (the owner: pick the best, not all)');
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
let allAlpha = true, allSquare = true, allSmall = true, allWebp = true, total = 0;
for (const f of have) {
  const buf = fs.readFileSync(path.join(dir, f)); total += buf.length;
  const w = webp(buf);
  if (!w) { allWebp = false; continue; }
  if (!w.alpha) allAlpha = false;
  if (w.w !== 192 || w.h !== 192) allSquare = false;
  if (buf.length > 20000) allSmall = false;
}
ok(allWebp, 'every file is a real WebP picture');
ok(allAlpha, 'every picture has a transparent background (cut out, no baked-in box)');
ok(allSquare, 'every picture is 192 x 192 (centred in a square, sharp up to 64 px on a 3x phone)');
ok(allSmall && total < 260000, 'every picture is under 20 kB (' + Math.round(total / 1024) + ' kB in all)');

// ---- the rule that picks the picture: an admin upload wins, else the built-in one ----
const fn = (src.match(/function ptIconSrc\(key\)\{[\s\S]*?\n\}/) || [''])[0];
ok(!!fn, 'ptIconSrc picks the picture of a slot');
const ctx = { STATE: { icons: {} }, SMARTAI_ICON_DEFAULTS: defaults };
vm.createContext(ctx); vm.runInContext(fn, ctx);
const pick = k => vm.runInContext('ptIconSrc(' + JSON.stringify(k) + ')', ctx);
ok(pick('navhome') === '/icons/navhome.webp', 'nothing uploaded: the built-in Home picture shows');
ctx.STATE.icons = { navhome: 'data:image/png;base64,AAAA', recharge: null, withdraw: '' };
ok(pick('navhome') === 'data:image/png;base64,AAAA', 'an uploaded picture replaces the built-in one');
ok(pick('recharge') === '/icons/recharge.webp' && pick('withdraw') === '/icons/withdraw.webp', 'a slot the admin left empty (null / "") keeps the built-in picture');
ok(pick('payicon') === '' && pick('nothing') === '', 'a slot with no built-in picture (the deposit pay-button logo) stays empty');
ctx.STATE = null;
ok(pick('navmy') === '/icons/navmy.webp', 'before the member data exists the built-in pictures already show (no empty tab bar)');

// ---- every place that draws an icon goes through that rule ----
ok(/const src = ptIconSrc\(NAV_ICON_SLOT\[key\]\);/.test(src), 'the bottom bar uses it');
ok(/ptIconSrc\('ordergift'\)/.test(src) && /ptIconSrc\('downloadapp'\)/.test(src), 'the two floating pictures use it');
ok(/const src = ptIconSrc\(key\);\s*\n\s*if \(!src\) return '';/.test(src), 'the Home buttons (ptIconHtml) use it');
ok(/'<img src="\/icons\/' \+ PT_MENU_PIC\[icon\] \+ '\.webp"/.test(src), 'the My page rows show their picture');
ok(!/STATE\.icons\[/.test(src.replace(/function ptIconSrc[\s\S]*?\n\}/, '')), 'nothing reads the uploaded icons directly any more (all go through ptIconSrc)');

// ---- blue and white: no brand red is left in the member app's CSS ----
function hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2; let h = 0, s = 0;
  if (mx !== mn) { const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; }
  return { h, s, l };
}
const noComments = css.replace(/\/\*[\s\S]*?\*\//g, m => ' '.repeat(m.length)).replace(/<!--[\s\S]*?-->/g, m => ' '.repeat(m.length));
const reds = new Map();
const tok = /#([0-9a-fA-F]{6})\b|#([0-9a-fA-F]{3})\b|rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*[\d.]+\s*)?\)/g;
let m;
while ((m = tok.exec(noComments))) {
  let r, g, b;
  if (m[1] || m[2]) { const x = m[1] || m[2].split('').map(c => c + c).join(''); r = parseInt(x.slice(0, 2), 16); g = parseInt(x.slice(2, 4), 16); b = parseInt(x.slice(4, 6), 16); }
  else { r = +m[3]; g = +m[4]; b = +m[5]; }
  const { h, s, l } = hsl(r, g, b);
  if (s >= 0.22 && (h >= 335 || h <= 22) && l > 0.12 && l < 0.97) {
    const bb = noComments.lastIndexOf('{', m.index); const a = Math.max(noComments.lastIndexOf('}', bb), noComments.lastIndexOf('>', bb), noComments.lastIndexOf(';', bb)) + 1;
    const sel = noComments.slice(a, bb).trim().replace(/\s+/g, ' ');
    reds.set(m[0].toLowerCase() + ' in ' + sel.slice(-48), 1);
  }
}
const ERROR_RULES = ['.notify-ic', '.cp-ic.bad', '.cp-chgerr', '.cp-msg.bad', '.pt-noprod.bad', '.pin-warn', '.pt-rec .m em.bad', '.pt-pwerr', '.pa-err', '.pt-rec .a.out'];
const strays = [...reds.keys()].filter(k => !ERROR_RULES.some(e => k.includes(' in ') && k.slice(k.indexOf(' in ') + 4).includes(e.slice(-Math.min(e.length, 40)))) && !/^#e40613 in :root|--v-bad/.test(k));
ok(strays.length === 0, 'the only reds left in the CSS are error / failure colours (a stray one would be Potato\'s red back again)' + (strays.length ? ' -> ' + strays.slice(0, 5).join(' | ') : ''));
ok(/--mg-green:#137aef/.test(css) && /--snow-wine:#137aef/.test(css), 'the brand colour is the blue of the icons');

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
