'use strict';
// The sign-up captcha: four digits drawn as a small SVG picture (bold serif digits in dark green, green, red and yellow, thin crossing lines, dots and faint
// circles on a pale green card). The answer lives only on the server, in memory, and not even there as the plain code: only a keyed hash (HMAC with a secret
// made fresh each time the server starts) is kept. The digits in the picture are outlined shapes (paths), not text, so the picture holds no readable
// characters. Each picture has a random id, lives 5 minutes, and is used up by the first answer sent for it (right or wrong), so one picture can never
// be tried again and again. A new picture is asked for every time Sign Up is opened.
const crypto = require('node:crypto');
const TTL_MS = 5 * 60 * 1000, MAX_LIVE = 20000;
const COLORS = ['#c98f12', '#d9a21b', '#e5b436', '#b8860b'];       // golds, like the owner's picture
const LINE_COLORS = ['#9db08a', '#b9a37a', '#a6b894'];
const SECRET = crypto.randomBytes(32);                               // lives in memory only, new at every start
const mac = (id, code) => crypto.createHmac('sha256', SECRET).update(id + ':' + code).digest();
// Noto Serif Bold digit outlines, 1000 units to the em: digit -> [svg path, advance width]
const GLYPHS = {0:["M283 -10Q192 -10 138 36Q84 82 60.5 165Q37 248 37 359Q37 470 60.5 552Q84 634 138 679Q192 724 284 724Q371 724 425 679Q479 634 503.5 551.5Q528 469 528 358Q528 247 503 164.5Q478 82 424.5 36Q371 -10 283 -10ZM283 55Q320 55 339 91Q358 127 365 194.5Q372 262 372 358Q372 454 365 521Q358 588 339 623.5Q320 659 284 659Q247 659 226.5 623.5Q206 588 199 521Q192 454 192 358Q192 262 199 194.5Q206 127 226 91Q246 55 283 55Z",565],1:["M88 0V53H170Q189 53 203 59Q217 65 224.5 79Q232 93 232 118V619Q194 573 163.5 544Q133 515 103 515Q79 515 62 535Q45 555 45 589Q75 597 112.5 613Q150 629 199 666L269 718H381V118Q381 98 388 83Q395 68 409 60.5Q423 53 443 53H507V0Z",565],2:["M44 0V97L190 254Q250 318 283.5 365.5Q317 413 330.5 456Q344 499 344 549Q344 589 334.5 614Q325 639 307.5 651Q290 663 266 663Q233 663 212 644.5Q191 626 182 589Q173 552 173 495Q140 495 111.5 502Q83 509 66 528.5Q49 548 49 582Q49 619 72.5 651Q96 683 145 703.5Q194 724 266 724Q341 724 392 702.5Q443 681 469 642.5Q495 604 495 552Q495 521 486.5 490Q478 459 457.5 425.5Q437 392 400.5 352Q364 312 309 261L149 110H370Q401 110 422.5 128Q444 146 453 179L461 210H520L515 0Z",565],3:["M248 -10Q172 -10 125.5 7Q79 24 58 52.5Q37 81 37 116Q37 154 62 174Q87 194 122 194Q122 130 156 95Q190 60 245 60Q278 60 305.5 73Q333 86 350 118Q367 150 367 207Q367 264 327 301Q287 338 213 338H156V400H217Q260 400 288 418.5Q316 437 329.5 470.5Q343 504 343 547Q343 601 322 632Q301 663 261 663Q225 663 205 640.5Q185 618 176.5 582.5Q168 547 168 508Q116 508 82.5 525.5Q49 543 49 589Q49 625 73 655.5Q97 686 145 705Q193 724 265 724Q373 724 435 681.5Q497 639 497 561Q497 516 477 481Q457 446 422.5 420.5Q388 395 344 381Q374 376 405 363.5Q436 351 462.5 330.5Q489 310 505.5 279.5Q522 249 522 206Q522 145 499 103.5Q476 62 436.5 37Q397 12 348 1Q299 -10 248 -10Z",565],4:["M183 0V53H211Q234 53 252.5 58Q271 63 282 78.5Q293 94 293 125V186H16V247L300 714H439V252H543V186H439V125Q439 94 450 78.5Q461 63 480 58Q499 53 521 53H534V0ZM94 252H293V427Q293 456 293.5 489Q294 522 296 555Q298 588 300 619Q295 607 285 586.5Q275 566 262.5 543.5Q250 521 239.5 501.5Q229 482 223 473Z",565],5:["M248 -10Q173 -10 128 7.5Q83 25 63 53Q43 81 43 111Q43 146 65 163Q87 180 123 180Q123 152 133.5 124Q144 96 168 78Q192 60 233 60Q266 60 294 74.5Q322 89 339 123.5Q356 158 356 220Q356 295 320 331.5Q284 368 220 368Q181 368 156.5 362.5Q132 357 109 350L72 368L104 714H473L478 532H421L413 566Q411 578 406 586.5Q401 595 392 599.5Q383 604 367 604H159L143 419Q153 423 171 426.5Q189 430 210.5 432Q232 434 253 434Q331 434 388.5 410.5Q446 387 477.5 339.5Q509 292 509 220Q509 168 493.5 129.5Q478 91 452 64.5Q426 38 392 21.5Q358 5 321 -2.5Q284 -10 248 -10Z",565],6:["M295 -10Q222 -10 166 27Q110 64 78.5 141.5Q47 219 47 342Q47 425 64 494.5Q81 564 115 615.5Q149 667 201 695.5Q253 724 322 724Q387 724 427.5 708.5Q468 693 487 668Q506 643 506 614Q506 581 481 558.5Q456 536 397 536Q397 571 389 600Q381 629 363.5 647Q346 665 319 665Q278 665 251 633Q224 601 209.5 541.5Q195 482 190 397Q208 409 228.5 418Q249 427 273 432.5Q297 438 325 438Q417 438 472 383Q527 328 527 231Q527 160 500.5 105.5Q474 51 422.5 20.5Q371 -10 295 -10ZM299 56Q326 56 345 72Q364 88 374.5 124Q385 160 385 221Q385 304 359.5 339Q334 374 290 374Q273 374 254.5 368Q236 362 219.5 352Q203 342 190 331Q191 184 220.5 120Q250 56 299 56Z",565],7:["M130 0 391 604H176Q149 604 135 591Q121 578 118 553L111 503H51L56 714H520V665L261 0Z",565],8:["M276 -10Q192 -10 138.5 16Q85 42 59 84Q33 126 33 176Q33 227 53 261.5Q73 296 107.5 319.5Q142 343 185 360Q147 382 117.5 407.5Q88 433 72 465.5Q56 498 56 542Q56 591 79.5 632.5Q103 674 154.5 699Q206 724 289 724Q360 724 408 701.5Q456 679 480.5 641.5Q505 604 505 557Q505 492 469 455Q433 418 371 389Q425 363 461 334Q497 305 514.5 270.5Q532 236 532 189Q532 99 464.5 44.5Q397 -10 276 -10ZM281 48Q329 48 359 80.5Q389 113 389 167Q389 200 373 227.5Q357 255 324.5 279Q292 303 243 326Q208 303 188 267.5Q168 232 168 181Q168 116 199 82Q230 48 281 48ZM308 420Q331 434 346 451.5Q361 469 368 494.5Q375 520 375 555Q375 586 365 611Q355 636 335.5 651Q316 666 285 666Q242 666 219.5 637Q197 608 197 560Q197 526 210 500.5Q223 475 248 455.5Q273 436 308 420Z",565],9:["M230 -10Q170 -10 134 5.5Q98 21 82 45.5Q66 70 66 98Q66 120 79.5 139Q93 158 120 164Q131 132 145 107Q159 82 181 67.5Q203 53 237 53Q304 53 337 121.5Q370 190 375 336Q360 320 340.5 305.5Q321 291 295.5 283Q270 275 235 275Q178 275 133.5 298.5Q89 322 63.5 368.5Q38 415 38 482Q38 554 65.5 608.5Q93 663 144.5 693.5Q196 724 267 724Q340 724 396.5 688.5Q453 653 485.5 578.5Q518 504 518 385Q518 301 501.5 229.5Q485 158 450.5 104.5Q416 51 362 20.5Q308 -10 230 -10ZM277 347Q311 347 335 364Q359 381 375 410Q374 500 362 554Q350 608 328 632.5Q306 657 273 657Q244 657 223 639Q202 621 191.5 583.5Q181 546 181 488Q181 419 205 383Q229 347 277 347Z",565]};
const live = new Map();                                              // id -> { h (hash of the code), exp }
const rnd = n => crypto.randomInt(n);
const between = (a, b) => a + (b - a) * (crypto.randomInt(10001) / 10000);
const f1 = n => Math.round(n * 10) / 10;

function newCode() { let s = ''; for (let i = 0; i < 4; i++) s += String(rnd(10)); return s; }

function renderSvg(code) {
  const W = 226, H = 84, out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#f6ecda"/>`);
  for (let i = 0; i < 3; i++) out.push(`<circle cx="${f1(between(20, W - 20))}" cy="${f1(between(10, H - 10))}" r="${f1(between(22, 44))}" fill="none" stroke="#e4d6b8" stroke-width="1.6"/>`);
  for (let i = 0; i < 26; i++) out.push(`<circle cx="${f1(between(4, W - 4))}" cy="${f1(between(4, H - 4))}" r="${f1(between(1, 2.6))}" fill="${rnd(3) ? '#b7a98f' : '#cfd9c0'}"/>`);
  // the digits: a different colour and a small tilt each, never all one colour
  const pick = []; while (pick.length < 4) pick.push(COLORS[rnd(COLORS.length)]);
  if (new Set(pick).size < 3) { pick[0] = COLORS[0]; pick[1] = COLORS[1]; pick[2] = COLORS[2]; pick[3] = COLORS[rnd(4)]; }
  for (let i = 0; i < 4; i++) {
    const x = 24 + i * 47 + between(-5, 5), y = 60 + between(-6, 6), rot = Math.round(between(-14, 14));
    const [path, w] = GLYPHS[code[i]], sc = Math.round(between(46, 54)) / 1000, sw = Math.round(1.3 / sc);
    out.push(`<path d="${path}" transform="translate(${f1(x)} ${f1(y)}) rotate(${rot} 0 -18) scale(${sc} ${-sc}) translate(${-w / 2} 0)" fill="${pick[i]}" stroke="${pick[i]}" stroke-width="${sw}" stroke-linejoin="round"/>`);
  }
  for (let i = 0; i < 5; i++) out.push(`<line x1="${f1(between(0, W))}" y1="${f1(between(0, H))}" x2="${f1(between(0, W))}" y2="${f1(between(0, H))}" stroke="${LINE_COLORS[rnd(LINE_COLORS.length)]}" stroke-width="${f1(between(1.2, 2.2))}" stroke-linecap="round" opacity=".8"/>`);
  out.push('</svg>');
  return out.join('');
}

function sweep(now) { for (const [id, v] of live) if (v.exp <= now) live.delete(id); }
function issue(now = Date.now()) {
  if (live.size >= MAX_LIVE) { sweep(now); while (live.size >= MAX_LIVE) live.delete(live.keys().next().value); }
  const code = newCode(), id = crypto.randomBytes(16).toString('hex');
  live.set(id, { h: mac(id, code), exp: now + TTL_MS });
  // `code` is handed back only so the tests can answer; the /auth/captcha route sends the id and the picture and nothing else
  return { id, image: 'data:image/svg+xml;base64,' + Buffer.from(renderSvg(code)).toString('base64'), code };
}
// true only for the right code of a live picture; the picture is used up either way
function verify(id, answer, now = Date.now()) {
  const v = live.get(String(id || ''));
  if (!v) return false;
  live.delete(String(id));
  if (v.exp <= now) return false;
  return crypto.timingSafeEqual(mac(String(id), String(answer == null ? '' : answer).trim()), v.h);
}
module.exports = { issue, verify, renderSvg, _live: live, TTL_MS };
