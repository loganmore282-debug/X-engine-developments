// The uploaded banner video: what the server accepts, and how it serves it.
//
// Owner: "why can't we just upload video to database instead of url ... l
// want it to go or run on its own."
//
// Two things have to hold for the upload path to be worth having:
//   1. only a real, playable, member-sized video gets stored;
//   2. /public/banner-video answers byte-range requests, because iOS Safari
//      simply refuses to play a video from a server that does not -- the
//      banner would work on Android and do nothing at all on iPhone.
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/server.js', 'utf8');

// Pull the real implementations out of server.js rather than restating them.
const grab = (from, to) => src.slice(src.indexOf(from), src.indexOf(to));
// `const` declared inside an eval stays inside that eval's own scope, so the
// values are handed back explicitly rather than leaked into this module.
const { BANNER_VIDEO_MAX_BYTES, BANNER_VIDEO_TYPES } = eval(
  grab('const BANNER_VIDEO_MAX_BYTES', '// Resolves one `Range:` header') +
  '\n({ BANNER_VIDEO_MAX_BYTES, BANNER_VIDEO_TYPES })');
// Wrapped in an IIFE: a bare function declaration in a direct eval hoists
// into this module's scope and collides with the const below it.
const parseByteRange = eval('(function(){' +
  grab('function parseByteRange', '// A YouTube link cannot be a banner video') +
  '\nreturn parseByteRange;})()');

let bad = 0;
const ck = (o, l) => { if (!o) bad++; console.log((o ? 'PASS  ' : 'FAIL  ') + l); };

console.log('— limits —');
ck(BANNER_VIDEO_MAX_BYTES === 4 * 1024 * 1024, 'cap is 4 MB of actual video (' + BANNER_VIDEO_MAX_BYTES + ')');
// Base64 inflates by 4/3, so the parser in front of the route has to allow
// noticeably more than the cap or a legal upload is rejected before the
// route's own, friendlier size message can ever run.
const b64Worst = Math.ceil(BANNER_VIDEO_MAX_BYTES / 3) * 4 + 64;
const hugeLimit = 13 * 1024 * 1024;
ck(/HUGE_JSON_ROUTES = new Set\(\[[^\]]*'\/admin\/banner\/video-upload'/.test(src),
   'the upload route is on the huge JSON parser, not the 4 MB one');
ck(b64Worst < hugeLimit, 'a max-size upload base64s to ' + Math.round(b64Worst / 1048576 * 10) / 10 + ' MB, under the 13 MB parser limit');
ck(BANNER_VIDEO_MAX_BYTES * 1.34 < 16 * 1024 * 1024, 'and stays well under Mongo\'s 16 MB document limit');

console.log('\n— accepted formats —');
ck(BANNER_VIDEO_TYPES['video/mp4'] === 'mp4', 'mp4 accepted (the one format every phone plays)');
ck(BANNER_VIDEO_TYPES['video/webm'] === 'webm', 'webm accepted');
for (const t of ['video/quicktime', 'video/x-matroska', 'video/avi', 'image/gif', 'text/html']) {
  ck(!BANNER_VIDEO_TYPES[t], t + ' refused');
}

// The route's own data-URL gate, restated exactly as the route uses it.
const DATA_URL_RE = /^data:(video\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/i;
console.log('\n— the upload body must be a video data URL —');
for (const [body, ok, label] of [
  ['data:video/mp4;base64,AAAAIGZ0eXBpc29t', true,  'an mp4 data URL'],
  ['data:video/webm;base64,GkXfow==',        true,  'a webm data URL'],
  ['data:image/png;base64,iVBORw0KGgo=',     false, 'an image, not a video'],
  ['data:text/html;base64,PHNjcmlwdD4=',     false, 'html pretending to be an upload'],
  ['https://example.com/a.mp4',              false, 'a link in the upload field'],
  ['data:video/mp4;base64,not base64!',      false, 'malformed base64'],
  ['',                                       false, 'an empty body'],
]) ck(DATA_URL_RE.test(body) === ok, label);

console.log('\n— byte ranges (iOS will not play the video without these) —');
const TOTAL = 1000;
for (const [header, expect, label] of [
  [undefined,          null,                  'no Range header -> whole file'],
  ['',                 null,                  'empty Range header -> whole file'],
  ['bytes=0-',         { start: 0,   end: 999 }, 'bytes=0- (what a player opens with)'],
  ['bytes=0-99',       { start: 0,   end: 99  }, 'an explicit first chunk'],
  ['bytes=500-599',    { start: 500, end: 599 }, 'a seek into the middle'],
  ['bytes=900-5000',   { start: 900, end: 999 }, 'an end past the file is clamped, not refused'],
  ['bytes=-100',       { start: 900, end: 999 }, 'a suffix range is the LAST 100 bytes'],
  ['bytes=-5000',      { start: 0,   end: 999 }, 'a suffix bigger than the file is the whole file'],
  ['bytes=999-999',    { start: 999, end: 999 }, 'the final single byte'],
  ['  bytes=0-9  ',    { start: 0,   end: 9   }, 'whitespace around the header'],
  ['bytes=1000-1100',  'invalid',             'a start past the end -> 416'],
  ['bytes=-',          'invalid',             'no numbers at all -> 416'],
  ['bytes=600-500',    'invalid',             'end before start -> 416'],
  ['bytes=-0',         'invalid',             'a zero-length suffix -> 416'],
  ['items=0-10',       null,                  'a non-byte unit -> whole file'],
  ['bytes=0-10,20-30', null,                  'multi-range -> whole file (legal, and what players accept)'],
]) {
  const got = parseByteRange(header, TOTAL);
  const same = JSON.stringify(got) === JSON.stringify(expect);
  ck(same, label + ' -> ' + JSON.stringify(got) + (same ? '' : ' (wanted ' + JSON.stringify(expect) + ')'));
}

// Every satisfiable range must name a real, non-empty slice -- an off-by-one
// here serves a truncated or over-long body and the player stalls.
console.log('\n— every satisfiable range is a real slice —');
let checked = 0, wrong = 0;
for (let s = 0; s < TOTAL; s += 37) {
  for (let e = s; e < TOTAL + 50; e += 53) {
    const r = parseByteRange(`bytes=${s}-${e}`, TOTAL);
    if (r === 'invalid' || !r) continue;
    checked++;
    const len = r.end - r.start + 1;
    if (r.start !== s || r.end !== Math.min(e, TOTAL - 1) || len <= 0 || r.end >= TOTAL) wrong++;
  }
}
ck(checked > 100 && wrong === 0, `${checked} ranges, ${wrong} wrong`);

console.log('\n— the response headers the route sets —');
ck(/Cache-Control', 'public, max-age=31536000, immutable'/.test(src),
   'the video is cached for a year (a new upload is a new ?v= URL)');
ck(/res\.set\('Accept-Ranges', 'bytes'\)/.test(src), 'Accept-Ranges: bytes is advertised');
ck(/if \(req\.headers\['if-none-match'\] === etag\) return res\.status\(304\)/.test(src),
   'a repeat request with the same ETag gets a 304, not the bytes again');

console.log('\n— the bytes stay OUT of the every-boot JSON —');
const bannerFn = grab('async function getHomeBanner', '// The uploaded banner video itself');
ck(/videoVersion: d\.videoVersion \|\| null/.test(bannerFn), '/public/banner returns only the version marker');
ck(!/\bdata\b/.test(bannerFn.replace(/snap\.data\(\)/g, '')), 'and never the video data itself');

console.log(bad ? `\n${bad} FAILED` : '\nbanner video upload: all cases pass');
process.exit(bad ? 1 : 0);
