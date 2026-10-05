// The admin-uploadable app icon.
//
// Owner: "make when l can upload app icon which will be appearing when
// downloaded".
//
// This is unlike every other image slot in the panel, and that is the whole
// reason this file exists. Every other one is fetched by the app's own
// JavaScript, so a mistake shows up the moment you open the app. This one is
// read by software we cannot see and cannot test from inside the app: Chrome,
// reading manifest.json at install time. That consumer fails SILENTLY -- the
// icon just doesn't appear -- and leaves no trace in the app.
//
// So what has to be pinned here is the wiring BETWEEN the files, which is
// exactly what no amount of clicking around the app would reveal:
//   * the URL in manifest.json is a route server.js actually registers;
//   * the admin panel posts the field names the server reads;
//   * the size/format gate is real, not just a comment.
//
// Used to also cover an admin-uploadable link-preview (og:image) card --
// owner: "remove stuffs of link preview, here there will be no link
// preview." Every link-preview-specific assertion here was removed along
// with the feature itself, not left behind to fail against gone code.
const fs = require('fs');
const src   = fs.readFileSync(__dirname + '/server.js', 'utf8');
const page  = fs.readFileSync(__dirname + '/user/index.html', 'utf8');
const mfst  = JSON.parse(fs.readFileSync(__dirname + '/user/manifest.json', 'utf8'));
const admin = fs.readFileSync(__dirname + '/admin-src/index.html', 'utf8');

const grab = (from, to) => src.slice(src.indexOf(from), src.indexOf(to));
// Pull the REAL implementations out of server.js rather than restating them,
// so this can never drift into testing a copy of the logic.
const BRAND_ASSET_SLOTS = eval(
  grab('const BRAND_ASSET_SLOTS', 'const _brandAssetCache') + '\n(BRAND_ASSET_SLOTS)');
const imageSize = eval('(function(){' +
  grab('function imageSize', 'const BRAND_SLOT_LABEL') + '\nreturn imageSize;})()');
const readBrandUpload = eval('(function(){' +
  grab('const BRAND_SLOT_LABEL', 'async function writeBrandAsset') +
  '\nreturn readBrandUpload;})()');

let bad = 0;
const ck = (o, l) => { if (!o) bad++; console.log((o ? 'PASS  ' : 'FAIL  ') + l); };

// The backend origin is DERIVED, never written down here. It has moved
// before, and a hardcoded copy in this file failed a perfectly correct
// build -- what matters here is that every icon URL AGREES with it. That is
// the real property: a manifest icon on a different host than the API is
// the bug, whatever the host happens to be called.
const BACKEND = (() => {
  const m = /var API_BASE = '([^']+)'/.exec(
    fs.readFileSync(__dirname + '/user-src/original_module.js', 'utf8'));
  if (!m) throw new Error('could not read API_BASE out of user-src/original_module.js');
  return m[1].replace(/\/+$/, '');
})();
const onBackend = u => typeof u === 'string' && u.startsWith(BACKEND + '/');

// ── the size reader ───────────────────────────────────────────────────────
// A wrong-sized icon is not an error anyone would ever be shown; it is just a
// permanently blurry home screen. This is the only thing that catches it.
console.log('— reading image dimensions out of the file header —');

// Real files, not fixtures: the icons that ship in the build.
for (const [f, n] of [['icon-512.png', 512], ['icon-192.png', 192]]) {
  const s = imageSize(fs.readFileSync(__dirname + '/user/' + f));
  ck(s && s.w === n && s.h === n, `${f} reads as ${s ? s.w + '×' + s.h : 'unreadable'}`);
}

function fakePng(w, h) {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8); b.write('IHDR', 12);
  b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  return b;
}
// A real JPEG shape: SOI, an APP0 segment that must be SKIPPED, then the
// SOF0 that actually carries the size. imageSize() is a general reader
// (still used by product/banner uploads elsewhere in server.js), so its
// JPEG path stays covered even though no brand-asset slot is JPEG anymore.
function fakeJpeg(w, h) {
  const app0 = Buffer.concat([Buffer.from([0xff, 0xe0, 0x00, 0x10]), Buffer.alloc(14, 0x41)]);
  const sof = Buffer.alloc(11);
  sof.writeUInt16BE(0xffc0, 0); sof.writeUInt16BE(9, 2); sof[4] = 8;
  sof.writeUInt16BE(h, 5); sof.writeUInt16BE(w, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.alloc(40, 0)]);
}
const j = imageSize(fakeJpeg(1200, 630));
ck(j && j.w === 1200 && j.h === 630,
   'a JPEG reads 1200×630 past its APP0 segment (' + (j ? j.w + '×' + j.h : 'unreadable') + ')');
ck(imageSize(Buffer.from('not an image at all, just text padding it out')) === null,
   'plain bytes are reported unreadable, not guessed at');
ck(imageSize(Buffer.alloc(8)) === null, 'a truncated file is unreadable');

// ── the upload gate ───────────────────────────────────────────────────────
console.log('\n— what the server accepts for each slot —');
const dataUrl = (mime, buf) => `data:${mime};base64,${buf.toString('base64')}`;
const cases = [
  ['app-icon-512', dataUrl('image/png',  fakePng(512, 512)),   true,  'a 512×512 PNG icon'],
  ['app-icon-192', dataUrl('image/png',  fakePng(192, 192)),   true,  'a 192×192 PNG icon'],
  // Wrong size is THE failure this gate exists for.
  ['app-icon-512', dataUrl('image/png',  fakePng(500, 500)),   false, 'a 500×500 icon (nearly right, still refused)'],
  ['app-icon-512', dataUrl('image/png',  fakePng(512, 384)),   false, 'a 512×384 icon (not square)'],
  // Wrong format: a JPEG icon cannot hold transparency, and the manifest
  // declares image/png, so it must not be storable.
  ['app-icon-512', dataUrl('image/jpeg', fakeJpeg(512, 512)),  false, 'a JPEG in the icon slot'],
  ['app-icon-512', 'data:image/svg+xml;base64,PHN2Zy8+',       false, 'an SVG'],
  ['app-icon-512', 'data:text/html;base64,PHNjcmlwdD4=',       false, 'html pretending to be an image'],
  ['app-icon-512', 'https://example.com/icon.png',             false, 'a link instead of a file'],
  ['app-icon-512', '',                                          false, 'an empty body'],
];
for (const [slot, body, ok, label] of cases) {
  const r = readBrandUpload(body, slot);
  ck(!!r.error !== ok, label + (r.error ? ' → "' + r.error + '"' : ' → accepted'));
}
// The refusal has to say what is wrong. "Invalid image" would leave the owner
// re-uploading the same file wondering what the panel wants.
const wrongSize = readBrandUpload(dataUrl('image/png', fakePng(500, 500)), 'app-icon-512');
ck(/500 × 500/.test(wrongSize.error) && /512 × 512/.test(wrongSize.error),
   'and the refusal names both the size given and the size wanted');

console.log('\n— size caps —');
const big = Buffer.concat([fakePng(512, 512), Buffer.alloc(700 * 1024)]);
ck(!!readBrandUpload(dataUrl('image/png', big), 'app-icon-512').error,
   'an oversized icon is refused (' + Math.round(BRAND_ASSET_SLOTS['app-icon-512'].max / 1024) + ' KB cap)');
for (const slot of Object.keys(BRAND_ASSET_SLOTS)) {
  // Base64 inflates by 4/3 and both icons travel in ONE request, so the
  // parser in front of the route has to allow more than the raw caps.
  ck(BRAND_ASSET_SLOTS[slot].max > 0, slot + ' has a byte cap');
}
const iconBodyWorst = (BRAND_ASSET_SLOTS['app-icon-512'].max + BRAND_ASSET_SLOTS['app-icon-192'].max) * 4 / 3;
ck(iconBodyWorst < 4 * 1024 * 1024,
   'both icons at their caps base64 to ' + Math.round(iconBodyWorst / 1048576 * 10) / 10 + ' MB, inside the image parser');
ck(/IMAGE_BODY_ROUTES = new Set\(\[[^\]]*'\/admin\/app-icon\/set'/.test(src),
   'the icon route is on the image body parser, not the 64 KB one');

// ── the wiring nothing else would catch ───────────────────────────────────
console.log('\n— manifest.json points at routes that exist —');
const routes = [...src.matchAll(/app\.get\('(\/public\/[a-z0-9\-.]+)', serveBrandAsset\('([a-z0-9-]+)'\)\)/g)]
  .reduce((m, x) => (m[x[1]] = x[2], m), {});
console.log('   ', routes);
ck(Object.keys(routes).length === 2, 'two brand-asset routes are registered (both icon sizes)');
for (const slot of Object.keys(BRAND_ASSET_SLOTS))
  ck(Object.values(routes).includes(slot), slot + ' is actually served');

const icons = mfst.icons || [];
ck(icons.length >= 2, 'the manifest declares at least the 192 and the 512');
for (const ic of icons) {
  const path = ic.src.replace(/^https?:\/\/[^/]+/, '');
  ck(onBackend(ic.src),
     `manifest icon ${ic.sizes} is served by the backend (so it follows an upload)`);
  ck(routes[path] != null, `manifest icon ${ic.sizes} → ${path} is a real route`);
  const spec = BRAND_ASSET_SLOTS[routes[path]] || {};
  ck(ic.sizes === `${spec.w}x${spec.h}`,
     `manifest says ${ic.sizes} and the server enforces ${spec.w}x${spec.h}`);
  ck(ic.type === spec.mime, `manifest says ${ic.type} and the server enforces ${spec.mime}`);
}

console.log('\n— the browser-tab / home-screen icon links —');
ck(!/property="og:image"/.test(page),
   'no og:image tag remains — link preview was removed, not just disabled');
ck(!/name="twitter:image"/.test(page), 'no twitter:image tag remains either');
ck(page.includes(`<link rel="icon" href="${BACKEND}/public/app-icon-192.png">`),
   'the browser-tab icon follows the upload');
ck(page.includes(`<link rel="apple-touch-icon" href="${BACKEND}/public/app-icon-192.png">`),
   'and so does the iPhone home-screen icon');

console.log('\n— the CORP trap that already cost a round on the banner video —');
// helmet sets Cross-Origin-Resource-Policy: same-site globally, and a
// manifest icon is a no-cors subresource load. Without the per-route
// override the browser drops the icon and says nothing.
const serveFn = grab('function serveBrandAsset', "app.get('/public/app-icon-512.png'");
ck(/res\.set\('Cross-Origin-Resource-Policy', 'cross-origin'\)/.test(serveFn),
   'the brand-asset route opts out of the global same-site CORP');
ck(/max-age=300, must-revalidate/.test(serveFn),
   'and is revalidated rather than immutable — its URL can never carry a ?v=');
ck(/if-none-match/.test(serveFn), 'with an ETag so the repeat cost is a 304');

console.log('\n— the icon never 404s, even before anything is uploaded —');
ck(/function bundledBrandAsset/.test(src), 'there is a bundled fallback');
for (const slot of ['app-icon-512', 'app-icon-192']) {
  const f = BRAND_ASSET_SLOTS[slot].file;
  ck(!!f && fs.existsSync(__dirname + '/user/' + f),
     `${slot} falls back to user/${f}, which exists on disk`);
}

console.log('\n— the panel sends what the server reads —');
ck(/api\('\/admin\/app-icon\/set', \{ png512, png192 \}\)/.test(admin),
   'the panel posts png512 + png192');
ck(/req\.body\.png512/.test(src) && /req\.body\.png192/.test(src),
   'and the server reads exactly those two fields');
ck(!/\/admin\/link-preview\/set/.test(admin), 'no link-preview upload wiring remains in the panel');
// One file becomes both renditions, so the launcher icon and the task
// switcher can never end up showing two different logos.
ck(/fileToSquarePng\(f,512\), fileToSquarePng\(f,192\)/.test(admin),
   'both icon sizes are rendered from the SAME chosen file');
// grab() reads server.js; this one has to read the ADMIN source. Getting
// that wrong silently slices an EMPTY string, and an assertion against
// nothing passes while proving nothing -- which is exactly what happened
// when these two were first written.
const squarePngFn = (() => {
  const a = admin.indexOf('function fileToSquarePng');
  const b = admin.indexOf('// Reads the file EXACTLY');
  return a >= 0 && b > a ? admin.slice(a, b) : '';
})();
ck(squarePngFn.length > 200, 'fileToSquarePng was actually found in the admin source');
ck(/toDataURL\('image\/png'\)/.test(squarePngFn),
   'the icon is exported as PNG (a JPEG could not hold transparency)');
// Comments stripped first: the function's own comment explains that it does
// NOT fill the canvas, and a bare /fillRect/ matched that sentence -- the
// assertion failed on prose while the code was already correct.
const squarePngCode = squarePngFn.replace(/^\s*\/\/.*$/gm, '');
ck(!/fillRect/.test(squarePngCode),
   'and onto a transparent canvas, so a transparent logo stays transparent');
ck(/Math\.min\(size\/iw,size\/ih\)/.test(admin),
   'the icon is CONTAINed, not cropped — an icon must not lose its edges');
// Owner: "but l wanted round corners of app icon please". The rounding has
// to be cut into the FILE's alpha -- a launcher is handed the PNG, not our
// stylesheet, so a CSS border-radius on the preview would look right in the
// panel and change nothing on the phone. (test-app-icon-resize.py measures
// the actual radius in the decoded pixels; this only pins the wiring.)
const roundFn = (() => {
  const a = admin.indexOf('function roundIconCorners');
  const b = admin.indexOf('// The app icon, rendered to one exact square size');
  return a >= 0 && b > a ? admin.slice(a, b) : '';
})();
ck(roundFn.length > 200, 'roundIconCorners was found in the admin source');
ck(/roundIconCorners\(ctx,size\)/.test(squarePngFn),
   'the icon renderer actually calls it');
ck(/globalCompositeOperation = 'destination-in'/.test(roundFn),
   'and it CUTS the corners out of the alpha (destination-in), not paints over them');
ck(/const ICON_CORNER_RADIUS = 0\.22/.test(admin),
   'the radius is 22% of the side — the proportion phone icons use');
ck(/Math\.round\(size \* ICON_CORNER_RADIUS\)/.test(roundFn),
   'taken as a SHARE of the size, so the 192 and the 512 match');
// Comments stripped, for the same reason as squarePngCode above: the
// function's own comment explains why it avoids roundRect, and matching that
// sentence would fail the check on prose while the code is already right.
const roundCode = roundFn.replace(/^\s*\/\/.*$/gm, '');
ck(/arcTo\(/.test(roundCode) && !/roundRect/.test(roundCode),
   'drawn with arcTo, not roundRect — an older browser would throw and read as "upload broken"');
// The one thing the owner will otherwise report as a bug.
ck(/already installed the app keep the old icon/i.test(admin),
   'the panel warns that already-installed phones keep the old icon');

console.log('\n— owner-only, like every other destructive admin route —');
for (const r of ['/admin/app-icon/set', '/admin/app-icon/clear']) {
  const body = src.slice(src.indexOf(`app.post('${r}'`), src.indexOf(`app.post('${r}'`) + 260);
  ck(/verifyOwner\(req\)/.test(body), r + ' requires the owner key');
}
ck(/app\.get\('\/admin\/brand-assets'[\s\S]{0,120}verifyAdmin\(req\)/.test(src),
   '/admin/brand-assets requires an admin to read');

// ── the route, actually run ───────────────────────────────────────────────
// Everything above reads source text. This RUNS server.js's real route
// handler against a stub database, because the headers are the part that
// decides whether a browser accepts the icon at all -- and a header you only
// grepped for is a header you have not seen sent.
(async () => {
  console.log('\n— running the real route handler —');
  const path = require('path'), crypto = require('crypto');
  let stored = null;                       // what the "database" holds
  const db = { collection: () => ({ doc: () => ({
    get: async () => ({ exists: !!stored, data: () => stored })
  }) }) };
  const rt = eval('(function(){' +
    grab('const BRAND_ASSET_SLOTS', 'function imageSize') +
    grab('function serveBrandAsset', "app.get('/public/app-icon-512.png'") +
    'return { serveBrandAsset, _cache: _brandAssetCache };})()');

  function call(handler, headers = {}, method = 'GET') {
    return new Promise(resolve => {
      const out = { headers: {}, code: 200, body: null };
      const res = {
        set(k, v) { out.headers[k.toLowerCase()] = v; return res; },
        status(c) { out.code = c; return res; },
        end(b) { out.body = b; resolve(out); return res; },
        json(j) { out.body = j; resolve(out); return res; }
      };
      handler({ headers, method }, res);
    });
  }
  const icon = rt.serveBrandAsset('app-icon-512');

  // Nothing uploaded yet: the icon must still be a real PNG.
  let r = await call(icon);
  ck(r.code === 200 && Buffer.isBuffer(r.body) && r.body.length > 100,
     'with an empty database the icon still serves the bundled PNG (' + (r.body ? r.body.length : 0) + ' bytes)');
  ck(r.headers['content-type'] === 'image/png', 'as image/png');
  ck(r.headers['cross-origin-resource-policy'] === 'cross-origin',
     'with CORP cross-origin, or the browser would drop it silently');
  const s = imageSize(r.body);
  ck(s && s.w === 512 && s.h === 512, 'and it really is 512×512');

  // Now "upload" one and confirm the served bytes change.
  const uploaded = fakePng(512, 512);
  stored = { data: uploaded.toString('base64'), mime: 'image/png', version: 'abc123' };
  delete rt._cache['app-icon-512'];
  r = await call(icon);
  ck(Buffer.compare(r.body, uploaded) === 0, 'after an upload the route serves the uploaded bytes');
  const etag = r.headers.etag;
  ck(/^"ba-app-icon-512-abc123"$/.test(etag || ''), 'tagged with the upload version (' + etag + ')');

  // A phone that already has it revalidates for free.
  const again = await call(icon, { 'if-none-match': etag });
  ck(again.code === 304 && !again.body, 'an unchanged icon comes back 304 with no body');

  // A new upload must break that cache, or the old icon would stick.
  stored = { data: fakePng(512, 512).toString('base64'), mime: 'image/png', version: 'zzz999' };
  delete rt._cache['app-icon-512'];
  const fresh = await call(icon, { 'if-none-match': etag });
  ck(fresh.code === 200, 'a NEW upload ignores the old ETag and sends the new icon');

  // HEAD is what a crawler often sends first.
  const head = await call(icon, {}, 'HEAD');
  ck(head.code === 200 && !head.body && head.headers['content-length'],
     'HEAD answers with the length and no body');

  // ── Who actually POINTS at those routes ──
  // Owner: "why also the app icon of admin never changed?" -- because it
  // didn't point here. The user app was moved onto the server-hosted asset
  // and the admin panel was left reading the PNG that ships in the repo, so
  // an uploaded icon changed one of the two and the owner reasonably read
  // that as the upload not working. Serving the bytes correctly is only half
  // the feature; these check the other half, in every file that names an icon.
  console.log('\n— every surface points at the uploaded icon —');
  const ICON192 = `${BACKEND}/public/app-icon-192.png`;
  const ICON512 = `${BACKEND}/public/app-icon-512.png`;
  const read = (p) => fs.readFileSync(__dirname + '/' + p, 'utf8');
  for (const [file, want] of [
    ['user/manifest.json', [ICON192, ICON512]],
    ['admin/manifest.json', [ICON192, ICON512]],
  ]) {
    const m = JSON.parse(read(file));
    const srcs = (m.icons || []).map(i => i.src);
    ck(want.every(u => srcs.includes(u)),
       `${file} installs with the uploaded icon, not a local file (${srcs.join(', ')})`);
  }
  for (const file of ['user-src/index.html', 'admin-src/index.html']) {
    const html = read(file);
    const links = [...html.matchAll(/<link[^>]*rel="(?:apple-touch-)?icon"[^>]*>/g)].map(m => m[0]);
    ck(links.length > 0, `${file} declares an icon link at all`);
    ck(links.every(l => l.includes(ICON192)),
       `${file}'s icon links all point at the uploaded icon (${links.length} link${links.length === 1 ? '' : 's'})`);
  }
  // The admin service worker shows the icon on background push notifications.
  const asw = read('admin/sw.js');
  ck(asw.includes(ICON192) && !/icon:\s*'\/icon-192\.png'/.test(asw),
     "the admin service worker's push notifications use it too");

  console.log(bad ? `\n${bad} FAILED` : '\nbrand assets: all cases pass');
  process.exit(bad ? 1 : 0);
})();
