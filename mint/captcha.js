'use strict';
// The sign-up captcha: four digits drawn as a small SVG picture (bold serif digits in dark green, green, red and yellow, thin crossing lines, dots and faint
// circles on a pale green card). The answer lives only on the server, in memory: each picture has a random id, lives 5 minutes, and is used up by the first
// answer sent for it (right or wrong), so one picture can never be tried again and again.
const crypto = require('node:crypto');
const TTL_MS = 5 * 60 * 1000, MAX_LIVE = 20000;
const COLORS = ['#0b6a3b', '#10a95a', '#e1212c', '#f7c41a'];       // dark green, green, red, yellow
const LINE_COLORS = ['#a97d98', '#8fa394', '#b08aa6'];
const live = new Map();                                              // id -> { code, exp }
const rnd = n => crypto.randomInt(n);
const between = (a, b) => a + (b - a) * (crypto.randomInt(10001) / 10000);
const f1 = n => Math.round(n * 10) / 10;

function newCode() { let s = ''; for (let i = 0; i < 4; i++) s += String(rnd(10)); return s; }

function renderSvg(code) {
  const W = 226, H = 84, out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#e9f5ec"/>`);
  for (let i = 0; i < 3; i++) out.push(`<circle cx="${f1(between(20, W - 20))}" cy="${f1(between(10, H - 10))}" r="${f1(between(22, 44))}" fill="none" stroke="#cfe6d6" stroke-width="1.6"/>`);
  for (let i = 0; i < 26; i++) out.push(`<circle cx="${f1(between(4, W - 4))}" cy="${f1(between(4, H - 4))}" r="${f1(between(1, 2.6))}" fill="${rnd(3) ? '#b7a3b8' : '#c9d9cd'}"/>`);
  // the digits: a different colour and a small tilt each, never all one colour
  const pick = []; while (pick.length < 4) pick.push(COLORS[rnd(COLORS.length)]);
  if (new Set(pick).size < 3) { pick[0] = COLORS[0]; pick[1] = COLORS[1]; pick[2] = COLORS[2]; pick[3] = COLORS[rnd(4)]; }
  for (let i = 0; i < 4; i++) {
    const x = 24 + i * 47 + between(-5, 5), y = 60 + between(-6, 6), rot = Math.round(between(-14, 14));
    out.push(`<text x="${f1(x)}" y="${f1(y)}" font-family="'Noto Serif','DejaVu Serif',Georgia,serif" font-size="${Math.round(between(46, 54))}" font-weight="700" fill="${pick[i]}" stroke="${pick[i]}" stroke-width="1.3" stroke-linejoin="round" text-anchor="middle" transform="rotate(${rot} ${f1(x)} ${f1(y - 18)})">${code[i]}</text>`);
  }
  for (let i = 0; i < 5; i++) out.push(`<line x1="${f1(between(0, W))}" y1="${f1(between(0, H))}" x2="${f1(between(0, W))}" y2="${f1(between(0, H))}" stroke="${LINE_COLORS[rnd(LINE_COLORS.length)]}" stroke-width="${f1(between(1.2, 2.2))}" stroke-linecap="round" opacity=".8"/>`);
  out.push('</svg>');
  return out.join('');
}

function sweep(now) { for (const [id, v] of live) if (v.exp <= now) live.delete(id); }
function issue(now = Date.now()) {
  if (live.size >= MAX_LIVE) { sweep(now); while (live.size >= MAX_LIVE) live.delete(live.keys().next().value); }
  const code = newCode(), id = crypto.randomBytes(16).toString('hex');
  live.set(id, { code, exp: now + TTL_MS });
  return { id, image: 'data:image/svg+xml;base64,' + Buffer.from(renderSvg(code)).toString('base64'), code };
}
// true only for the right code of a live picture; the picture is used up either way
function verify(id, answer, now = Date.now()) {
  const v = live.get(String(id || ''));
  if (!v) return false;
  live.delete(String(id));
  if (v.exp <= now) return false;
  const a = Buffer.from(String(answer == null ? '' : answer).trim()), b = Buffer.from(v.code);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
module.exports = { issue, verify, renderSvg, _live: live, TTL_MS };
