/* SPACE8 HOME BANNER SLIDES TEST
   Owner: "home screen banner, l want the floating screen banner, so they
   will be floating again and again, SETTABLE or customisable in admin
   panel" -- clarified as an auto-cycling carousel of admin-uploaded images
   on the Home screen, replacing the static single 'barstack' banner
   whenever slides are configured.

   Boots the REAL server.js against an in-memory mock database
   (test-mockdb.js) with Firebase auth stubbed, then drives the new
   /admin/banners/home-slides/* endpoints and /public/banners over real
   HTTP to prove: owner-only, only real image data-URIs accepted, an
   oversized upload is rejected, the MAX_HOME_SLIDES cap is enforced,
   removing a slide actually removes it (not some other one), and
   /public/banners exposes the slide images in order without leaking their
   admin-only ids -- same discipline as test-banners-security.js, which
   this deliberately mirrors for the existing single-image banner slots.

   Run: node test-home-banner-slides.js   (exits 0 = all green)          */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '4302';

const Module = require('module');

const mockdb = require('./test-mockdb.js');
const dbPath = require.resolve('./db.js');
const dbMod = new Module(dbPath); dbMod.exports = mockdb; dbMod.loaded = true;
require.cache[dbPath] = dbMod;

const faPath = require.resolve('firebase-admin');
const faMod = new Module(faPath);
faMod.exports = {
  initializeApp: () => {},
  credential: { cert: () => ({}) },
  auth: () => ({
    verifyIdToken: async tok => {
      if (String(tok).startsWith('uid:')) return { uid: tok.slice(4) };
      throw new Error('invalid token');
    },
  }),
};
faMod.loaded = true;
require.cache[faPath] = faMod;

const realFetch = global.fetch;

require('./server.js');

const BASE = 'http://127.0.0.1:4302';
async function call(method, p, { token, body, adminKey } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (adminKey) headers.Authorization = 'Bearer ' + adminKey;
  const r = await realFetch(BASE + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (_) {}
  return { code: r.status, body: j };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   - ' + name); }
  else { fail++; console.log('  FAIL - ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}

// A tiny valid 1x1 PNG, base64-encoded, used as a legitimate upload payload.
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

(async () => {
  await sleep(600);

  console.log('\n-- Unauthenticated / non-owner requests are rejected --');
  let r = await call('GET', '/admin/banners/home-slides');
  check('no admin key -> 401 on GET /admin/banners/home-slides', r.code === 401, r.code);
  r = await call('POST', '/admin/banners/home-slides/add', { body: { image: TINY_PNG } });
  check('no admin key -> 401 on POST add', r.code === 401, r.code);
  r = await call('POST', '/admin/banners/home-slides/add', { token: 'uid:some-regular-user', body: { image: TINY_PNG } });
  check('a regular authenticated USER (not admin) is rejected', r.code === 401, r.code);
  r = await call('POST', '/admin/banners/home-slides/remove', { body: { id: 'whatever' } });
  check('no admin key -> 401 on POST remove', r.code === 401, r.code);

  console.log('\n-- /public/banners reports an empty slide list when nothing is configured --');
  r = await call('GET', '/public/banners');
  check('homeSlides starts as an empty array', Array.isArray(r.body?.homeSlides) && r.body.homeSlides.length === 0, r.body?.homeSlides);

  console.log('\n-- Only genuine image data-URIs are accepted --');
  r = await call('POST', '/admin/banners/home-slides/add', { adminKey: 'test-admin-key', body: { image: 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==' } });
  check('non-image data-URI rejected', r.code === 400, r.body);
  r = await call('POST', '/admin/banners/home-slides/add', { adminKey: 'test-admin-key', body: { image: '<img src=x onerror=alert(1)>' } });
  check('raw HTML disguised as an "image" payload rejected outright', r.code === 400, r.body);

  console.log('\n-- Oversized uploads are rejected before reaching storage --');
  const hugePayload = 'data:image/png;base64,' + 'A'.repeat(3_000_000);
  r = await call('POST', '/admin/banners/home-slides/add', { adminKey: 'test-admin-key', body: { image: hugePayload } });
  check('oversized image rejected (400)', r.code === 400, r.body);

  console.log('\n-- A legitimate slide can be added, appears in order, and does not leak past what was set --');
  r = await call('POST', '/admin/banners/home-slides/add', { adminKey: 'test-admin-key', body: { image: TINY_PNG } });
  check('first slide add succeeds', r.body?.status === 'success' && !!r.body?.id, r.body);
  const firstId = r.body.id;
  r = await call('GET', '/public/banners');
  check('/public/banners now reports exactly one slide, the image itself (no id leaked)',
    Array.isArray(r.body?.homeSlides) && r.body.homeSlides.length === 1 && r.body.homeSlides[0] === TINY_PNG, r.body?.homeSlides);

  const TINY_PNG_2 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  r = await call('POST', '/admin/banners/home-slides/add', { adminKey: 'test-admin-key', body: { image: TINY_PNG_2 } });
  check('second slide add succeeds', r.body?.status === 'success', r.body);
  const secondId = r.body.id;
  check('the two slides got different ids', firstId !== secondId, { firstId, secondId });
  r = await call('GET', '/public/banners');
  check('/public/banners now reports both slides IN THE ORDER THEY WERE ADDED',
    JSON.stringify(r.body?.homeSlides) === JSON.stringify([TINY_PNG, TINY_PNG_2]), r.body?.homeSlides);

  console.log('\n-- Removing one slide removes exactly that one, not the other --');
  r = await call('POST', '/admin/banners/home-slides/remove', { adminKey: 'test-admin-key', body: { id: firstId } });
  check('remove succeeds', r.body?.status === 'success', r.body);
  r = await call('GET', '/public/banners');
  check('only the second slide remains, and it is still the right image',
    Array.isArray(r.body?.homeSlides) && r.body.homeSlides.length === 1 && r.body.homeSlides[0] === TINY_PNG_2, r.body?.homeSlides);
  r = await call('POST', '/admin/banners/home-slides/remove', { adminKey: 'test-admin-key', body: { id: firstId } });
  check('removing an already-removed id is rejected (404), not a silent no-op success', r.code === 404, r.body);

  console.log('\n-- The MAX_HOME_SLIDES cap is enforced --');
  // One real slide already present (TINY_PNG_2) -- add up to the cap.
  const MAX = 8;
  let currentCount = 1;
  const addedIds = [];
  while (currentCount < MAX) {
    r = await call('POST', '/admin/banners/home-slides/add', { adminKey: 'test-admin-key', body: { image: TINY_PNG } });
    if (r.body?.status === 'success') { addedIds.push(r.body.id); currentCount++; }
    else break;
  }
  check(`filled up to the ${MAX}-slide cap`, currentCount === MAX, currentCount);
  r = await call('POST', '/admin/banners/home-slides/add', { adminKey: 'test-admin-key', body: { image: TINY_PNG } });
  check('adding a 9th slide past the cap is rejected (400)', r.code === 400, r.body);
  r = await call('GET', '/admin/banners/home-slides', { adminKey: 'test-admin-key' });
  check(`admin list still reports exactly ${MAX} slides (the rejected 9th never got written)`, (r.body?.slides || []).length === MAX, r.body?.slides?.length);

  // Clean up back to empty so this file's outcome doesn't depend on order
  // relative to any future test appended after it.
  for (const id of [...addedIds, secondId]) {
    await call('POST', '/admin/banners/home-slides/remove', { adminKey: 'test-admin-key', body: { id } });
  }
  r = await call('GET', '/public/banners');
  check('back to empty after cleanup', Array.isArray(r.body?.homeSlides) && r.body.homeSlides.length === 0, r.body?.homeSlides);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
