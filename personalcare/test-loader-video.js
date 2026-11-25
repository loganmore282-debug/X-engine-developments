'use strict';
// Start-up loader video: the server stores / checks / serves it (Range, versioned caching, owner-only changes), the admin can upload and remove it, and
// the loading screen plays it full page, by itself, un-pausable, and holds the screen until it has finished (with fallbacks).
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const server = fs.readFileSync(__dirname + '/server.js', 'utf8'), idx = fs.readFileSync(__dirname + '/user-src/index.html', 'utf8');
const mod = fs.readFileSync(__dirname + '/user-src/original_module.js', 'utf8'), adm = fs.readFileSync(__dirname + '/admin-src/index.html', 'utf8');
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); };
const a = server.indexOf('// ── START-UP LOADER VIDEO'), b = server.indexOf("// The path nginx puts in front of this server's routes");
assert(a > 0 && b > a);
// ── test videos: boxes built by hand ──
const box = (type, payload) => { const h = Buffer.alloc(8); h.writeUInt32BE(8 + payload.length, 0); h.write(type, 4, 'latin1'); return Buffer.concat([h, payload]); };
const mvhd = (scale, dur) => { const p = Buffer.alloc(100); p.writeUInt32BE(scale, 12); p.writeUInt32BE(dur, 16); return box('mvhd', p); };
const ftyp = box('ftyp', Buffer.concat([Buffer.from('isom'), Buffer.alloc(4), Buffer.from('isomiso2')]));
const mdat = box('mdat', Buffer.alloc(4000, 7)), moov = box('moov', mvhd(1000, 3000));
const mp4Fast = Buffer.concat([ftyp, moov, mdat]), mp4Slow = Buffer.concat([ftyp, mdat, moov]);
const mp4Long = Buffer.concat([ftyp, box('moov', mvhd(1000, 40000)), mdat]);
const webm = Buffer.concat([Buffer.from([0x1A, 0x45, 0xDF, 0xA3]), Buffer.alloc(3000, 1)]);
// ── the server code, run on its own with a fake database ──
const rows = {}, routes = {};
const ctx = { Buffer, crypto, console, express: { raw: () => 'RAW' }, verifyAdmin: r => r.admin === true || r.owner === true, verifyOwner: r => r.owner === true, logAdminAction() {},
  db: { collection: () => ({ doc: id => ({ get: async () => ({ exists: !!rows[id], data: () => rows[id] }), set: async d => { rows[id] = Object.assign({}, rows[id] || {}, d); } }) }) },
  app: { get: (p, h) => { routes['GET ' + p] = h; }, post: (p, ...hs) => { routes['POST ' + p] = hs[hs.length - 1]; routes['POST ' + p + ' parser'] = hs[0]; } } };
vm.createContext(ctx); vm.runInContext(server.slice(a, b), ctx);
const res = () => { const r = { code: 200, headers: {}, body: null, ended: false,
  status(c) { r.code = c; return r; }, set(k, v) { if (typeof k === 'object') Object.assign(r.headers, k); else r.headers[k] = v; return r; },
  json(o) { r.body = o; r.ended = true; return r; }, end(x) { r.body = x === undefined ? r.body : x; r.ended = true; return r; } }; return r; };
const call = async (key, req) => { const r = res(); await routes[key](Object.assign({ headers: {}, query: {} }, req), r); return r; };
(async () => {
  const sniff = vm.runInContext('sniffLoaderVideo', ctx);
  let s1 = sniff(mp4Fast); ok(s1 && s1.type === 'video/mp4' && s1.fastStart === true && s1.seconds === 3, 'an MP4 with its index first is recognised, with its length (3 s)');
  ok(sniff(mp4Slow).fastStart === false, 'an MP4 with its index at the end is flagged (it cannot start before it has fully arrived)');
  ok(sniff(webm).type === 'video/webm', 'a WebM is recognised');
  ok(sniff(Buffer.from('<html>not a video at all, just text pretending</html>')) === null && sniff(Buffer.alloc(10)) === null, 'anything else is refused');
  // admin routes: owner only, raw upload
  ok(routes['POST /admin/loader-video/set parser'] === 'RAW', 'the upload is a raw file (its own raw parser, not the small JSON one)');
  let r = await call('POST /admin/loader-video/set', { body: mp4Fast }); ok(r.code === 401, 'staff / visitors cannot upload');
  r = await call('POST /admin/loader-video/set', { owner: true, body: Buffer.from('tiny') }); ok(r.code === 400, 'a nearly empty body is refused');
  r = await call('POST /admin/loader-video/set', { owner: true, body: Buffer.concat([mp4Fast, Buffer.alloc(10.5 * 1024 * 1024)]) }); ok(r.code === 400 && /too big/.test(r.body.message), 'over 10 MB is refused');
  r = await call('POST /admin/loader-video/set', { owner: true, body: Buffer.concat([Buffer.from('xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'), Buffer.alloc(3000)]) }); ok(r.code === 400 && /MP4 or WebM/.test(r.body.message), 'a file that is not a video is refused');
  r = await call('POST /admin/loader-video/set', { owner: true, body: mp4Long }); ok(r.code === 400 && /40 seconds/.test(r.body.message), 'a 40 second video is refused (the app would wait for it)');
  ok(!rows['personalcare-loadervideo'], 'nothing was saved by the refusals');
  r = await call('GET /public/loader-video', {}); ok(r.code === 404, 'no video yet: 404, so the app falls back to the usual loader');
  r = await call('GET /public/loader-video-info', {}); ok(r.body.enabled === false && /no-cache/.test(r.headers['Cache-Control']), 'the info says there is none, never cached');
  r = await call('POST /admin/loader-video/set', { owner: true, body: mp4Fast }); ok(r.code === 200 && r.body.enabled && r.body.size === mp4Fast.length && r.body.fastStart === true, 'the owner can upload one');
  const ver = r.body.version; ok(/^\d{10,}$/.test(ver), 'a new upload has a new version');
  r = await call('GET /admin/loader-video', {}); ok(r.code === 401, 'the admin read needs a login');
  r = await call('GET /admin/loader-video', { admin: true }); ok(r.body.enabled && r.body.version === ver, 'the panel can read it');
  // public: plain address always checks, versioned address is cached for a year
  r = await call('GET /public/loader-video', {}); ok(r.code === 200 && Buffer.compare(r.body, mp4Fast) === 0 && r.headers['Content-Type'] === 'video/mp4' && r.headers['Accept-Ranges'] === 'bytes' && /no-cache/.test(r.headers['Cache-Control']), 'the plain address serves the whole file and always revalidates');
  r = await call('GET /public/loader-video', { query: { v: ver } }); ok(/max-age=31536000, immutable/.test(r.headers['Cache-Control']), 'the versioned address is cached for a year');
  r = await call('GET /public/loader-video', { query: { v: 'old' } }); ok(/no-cache/.test(r.headers['Cache-Control']), 'a stale version number gets no long cache');
  r = await call('GET /public/loader-video', { headers: { 'if-none-match': r.headers.ETag } }); ok(r.code === 304, 'an unchanged file answers 304');
  r = await call('GET /public/loader-video', { headers: { range: 'bytes=0-99' } }); ok(r.code === 206 && r.headers['Content-Range'] === 'bytes 0-99/' + mp4Fast.length && r.body.length === 100 && Buffer.compare(r.body, mp4Fast.subarray(0, 100)) === 0, 'a Range request is answered with exactly those bytes (phones need this to start playing)');
  r = await call('GET /public/loader-video', { headers: { range: 'bytes=50-' } }); ok(r.code === 206 && r.body.length === mp4Fast.length - 50, 'an open-ended range works');
  r = await call('GET /public/loader-video', { headers: { range: 'bytes=-40' } }); ok(r.code === 206 && r.body.length === 40, 'a last-bytes range works');
  r = await call('GET /public/loader-video', { headers: { range: 'bytes=99999999-' } }); ok(r.code === 416, 'a range past the end is refused');
  r = await call('GET /public/loader-video-info', {}); ok(r.body.enabled && r.body.version === ver && r.body.type === 'video/mp4', 'the info carries the version the phones remember');
  // replacing makes a new version; removing brings the usual loader back
  await new Promise(x => setTimeout(x, 5));
  r = await call('POST /admin/loader-video/set', { owner: true, body: webm }); ok(r.code === 200 && r.body.version !== ver && r.body.type === 'video/webm', 'a replacement is a new version');
  r = await call('POST /admin/loader-video/clear', {}); ok(r.code === 401, 'removing needs the owner');
  r = await call('POST /admin/loader-video/clear', { owner: true }); ok(r.code === 200, 'the owner can remove it');
  r = await call('GET /public/loader-video', {}); ok(r.code === 404, 'removed: back to the usual loader');
  // the nginx admin limit is above the upload cap
  ok(/client_max_body_size \$\{role === 'member' \? '8m' : '14m'\}/.test(fs.readFileSync(__dirname + '/deploy/make-nginx.js', 'utf8')), 'nginx lets the admin host take a 10 MB upload');

  // ── the loading screen ──
  ok(/<video id="ldVideo" class="ld-vid" muted playsinline webkit-playsinline preload="auto" disablepictureinpicture disableremoteplayback controlslist="nodownload noplaybackrate noremoteplayback"/.test(idx) && !/id="ldVideo"[^>]*\bcontrols\b(?!list)/.test(idx), 'the video is muted, inline, preloaded, with no controls');
  ok(/#loadingScreen \.ld-vid\{position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover[^}]*pointer-events:none/.test(idx), 'it fills the whole screen (cover) and cannot be touched');
  ok(/#loadingScreen\.has-video \.ld-bg,#loadingScreen\.has-video \.ld-bar[^{]*\{display:none !important;\}/.test(idx), 'while it plays the other loader parts are hidden');
  ok(/v\.addEventListener\('pause'[^\n]*v\.play\(\)/.test(idx) && /visibilitychange/.test(idx.slice(idx.indexOf('THE START-UP VIDEO'))), 'a pause (or coming back to the app) makes it play again at once');
  ok(/setTimeout\(function\(\)\{ if \(st\.state === 'pending'\) fail\(\); \}, 2600\)/.test(idx) && /v\.addEventListener\('error', fail\)/.test(idx), 'a video that cannot start in 2.6 s, or errors, is dropped and the usual loader carries on');
  ok(/personalcare_loader_vid/.test(idx) && /if \(ver\) \{ start\(ver\); \}/.test(idx) && /BASE \+ \(ver \? '\?v=' \+ encodeURIComponent\(ver\) : ''\)/.test(idx), 'a remembered version starts the video in the first moments, from the phone\'s own cache');
  ok(/Math\.min\(8, left\)/.test(idx), 'the screen never waits more than 8 seconds for a video');
  // the gate in hideLoadingScreen, run for real with timers
  const ga = mod.indexOf('function hideLoadingScreen(){'), gb = mod.indexOf('function showLoadingScreen(){');
  const mk = (vid) => { const cls = new Set(), el = { style: { display: 'flex' }, classList: { add: x => cls.add(x), remove: x => cls.delete(x), contains: x => cls.has(x) } };
    const c2 = { $: () => el, startArtwork() {}, LOADER_MIN_MS: 0, _ldTimer: null, _ldOutTimer: null, setTimeout, clearTimeout, Date, Math, window: { _ldVid: vid, _personalcareLoaderStart: Date.now() }, console };
    vm.createContext(c2); vm.runInContext('var LOADER_MIN_MS = 0, _ldTimer = null, _ldOutTimer = null;\n' + mod.slice(ga, gb) + '\nthis.hide = hideLoadingScreen;', c2); return { c2, el, cls }; };
  const sleep = ms => new Promise(x => setTimeout(x, ms)); const gone = g => g.cls.has('ld-out') || g.el.style.display === 'none';
  { const g = mk({ state: 'playing', endsAt: Date.now() + 700 }); g.c2.hide(); await sleep(350); ok(!gone(g), 'the screen is NOT taken down while the video still has 0.35 s to play');
    await sleep(700); ok(gone(g), 'and goes as soon as the video has finished'); }
  { const g = mk({ state: 'pending', endsAt: 0 }); g.c2.hide(); await sleep(400); ok(!gone(g), 'while the video is still starting the screen waits');
    g.c2.window._ldVid.state = 'failed'; await sleep(400); ok(gone(g), 'a video that failed lets the screen go at once'); }
  { const g = mk({ state: 'none', endsAt: 0 }); g.c2.hide(); await sleep(60); ok(gone(g), 'with no video the screen goes as before'); }
  { const g = mk(undefined); g.c2.hide(); await sleep(60); ok(gone(g), 'an older page without the video script goes as before'); }
  // showLoadingScreen(): the app asks for the loading screen again about two seconds into a signed-in start; that must NOT swap the video for the ordinary loader
  { const sa = mod.indexOf('function showLoadingScreen(){'), sb = mod.indexOf('// A page\'s blocks (cards, tabs, lists, rows) fade in', sa);
    const show = (vid, hidden) => { const cls = new Set(['has-video', 'vid-on', 'vid-done']); const el = { style: { display: 'none' }, classList: { add: x => cls.add(x), remove: (...xs) => xs.forEach(x => cls.delete(x)), contains: x => cls.has(x) } };
      const c3 = { $: () => el, _ldTimer: null, _ldOutTimer: null, clearTimeout, window: { _ldVid: vid, _ldEverHidden: hidden }, console }; vm.createContext(c3);
      vm.runInContext('var _ldTimer = null, _ldOutTimer = null;\n' + mod.slice(sa, sb) + '\nshowLoadingScreen();', c3); return { cls, el }; };
    for (const st of ['pending', 'playing', 'ended']) { const g = show({ state: st }, false); ok(g.cls.has('has-video') && g.cls.has('vid-on') && g.el.style.display === 'flex', 'at launch, a "show the loading screen" while the video is ' + st + ' keeps the video (this swapped it for the ordinary loader before)'); }
    let g = show({ state: 'failed' }, false); ok(!g.cls.has('has-video') && !g.cls.has('vid-on'), 'a video that failed does not stay');
    g = show(undefined, false); ok(!g.cls.has('has-video'), 'no video: nothing kept');
    g = show({ state: 'ended' }, true); ok(!g.cls.has('has-video') && !g.cls.has('vid-on') && !g.cls.has('vid-done'), 'a loading screen shown after the launch one has gone is the ordinary one'); }
  ok(/window\._ldEverHidden = true;/.test(mod), 'the launch screen being taken down is remembered');
  ok(/#loadingScreen \.ld-vid\{[^}]*visibility:hidden;opacity:0;transition:opacity \.45s ease/.test(idx) && /#loadingScreen\.vid-on \.ld-vid\{visibility:visible;opacity:1;\}/.test(idx) && /ls\.classList\.add\('vid-on'\)/.test(idx), 'the video fades in (no sudden pop)');
  // the admin panel
  ok(/Start-up video/.test(adm) && /id="lvFile" accept="video\/mp4,video\/webm"/.test(adm) && /id="lvClear"/.test(adm) && /\/admin\/loader-video\/set/.test(adm) && /\/admin\/loader-video\/clear/.test(adm), 'Admin > Banners has the Start-up video card (upload, replace, remove)');
  ok(/probe\.duration > 15/.test(adm) && /10\*1024\*1024/.test(adm) && /body: f,/.test(adm), 'the panel checks size and length and plays the file before sending it raw');
  ok(/fastStart\?'':'/.test(adm), 'the panel warns when an MP4 would not start at once');
  console.log(`PASS: start-up loader video (${n} checks)`); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
