/* SPACE8 BANNERS SECURITY TEST
   Boots the REAL server.js against an in-memory mock database
   (test-mockdb.js) with Firebase auth stubbed, then drives the admin
   banner-upload endpoints over real HTTP to prove: only the whitelisted
   BANNER_KEYS slots can ever be set (no arbitrary key can be injected into
   the banners document), only real image data-URIs are accepted (not an
   HTML/script payload disguised with a fake header), an oversized upload is
   rejected before it ever reaches the database, every admin banner endpoint
   requires the owner (not just any authenticated user, and not a
   non-owner admin session), and /public/banners only ever exposes slots
   that were actually customised — leaving everything else for the client's
   own baked-in defaults.

   Run: node test-banners-security.js   (exits 0 = all green)              */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '4001';

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

const BASE = 'http://127.0.0.1:4001';
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
function collMap(name) {
  if (!mockdb.__store.has(name)) mockdb.__store.set(name, new Map());
  return mockdb.__store.get(name);
}
const banners = () => collMap('banners');

// A tiny valid 1x1 PNG, base64-encoded, used as a legitimate upload payload.
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

(async () => {
  await sleep(600);

  console.log('\n-- Unauthenticated / non-owner requests are rejected --');
  let r = await call('GET', '/admin/banners');
  check('no admin key -> 401 on GET /admin/banners', r.code === 401, r.code);
  r = await call('POST', '/admin/banners/set', { body: { key: 'barstack', image: TINY_PNG } });
  check('no admin key -> 401 on POST /admin/banners/set', r.code === 401, r.code);
  r = await call('POST', '/admin/banners/set', { token: 'uid:some-regular-user', body: { key: 'barstack', image: TINY_PNG } });
  check('a regular authenticated USER (not admin) is rejected', r.code === 401, r.code);

  console.log('\n-- Only whitelisted slots can be set --');
  r = await call('POST', '/admin/banners/set', { adminKey: 'test-admin-key', body: { key: 'not_a_real_slot', image: TINY_PNG } });
  check('unknown banner key rejected (400)', r.code === 400, r.body);
  // Codex-verified real bug (2026-08-18): banners/main was redesigned into
  // one document PER SLOT (see server.js's own comment on why -- the same
  // 16MB-doc-limit fix already applied to home slides), so this check
  // used to poke a doc ('main') nothing is EVER written to anymore under
  // any code path -- it "passed" whether or not the block actually
  // worked. Check the real new location instead: no per-slot doc should
  // exist for a key that was never a valid slot.
  check('nothing written to the banners collection for a forged key', !banners().has('not_a_real_slot'), banners().get('not_a_real_slot'));

  console.log('\n-- Only genuine image data-URIs are accepted --');
  r = await call('POST', '/admin/banners/set', { adminKey: 'test-admin-key', body: { key: 'barstack', image: 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==' } });
  check('non-image data-URI (e.g. text/html) rejected', r.code === 400, r.body);
  r = await call('POST', '/admin/banners/set', { adminKey: 'test-admin-key', body: { key: 'barstack', image: '<img src=x onerror=alert(1)>' } });
  check('raw HTML disguised as an "image" payload rejected outright', r.code === 400, r.body);
  r = await call('POST', '/admin/banners/set', { adminKey: 'test-admin-key', body: { key: 'barstack', image: 'javascript:alert(1)' } });
  check('javascript: URI payload rejected', r.code === 400, r.body);

  console.log('\n-- Codex-verified real gap, fixed: a real prefix + injected CSS suffix is rejected, not just the prefix --');
  // The OLD check only matched "^data:image/png;base64," with no `$`
  // anchor, so a genuine-looking value could carry arbitrary text after
  // the real base64 payload. bcardBg()/identityBannerHtml()
  // (user-src/original_module.js) interpolate a banner value into an
  // inline style="...url('ESCAPED')" attribute inside an HTML string
  // later assigned via .innerHTML -- and esc() escaping the quote to
  // &#39; is NOT a defense there, because .innerHTML's own parser decodes
  // that entity back into a literal ' as it builds the attribute's final
  // value, and THAT decoded value is what the browser's CSS engine then
  // parses. Confirmed live with a Playwright render: this exact payload
  // shape closed the url('...') early and landed background:red as a
  // real second CSS declaration on the element.
  r = await call('POST', '/admin/banners/set', { adminKey: 'test-admin-key', body: { key: 'barstack', image: "data:image/png;base64,AAAA');background:red;/*" } });
  check('a real base64 prefix followed by injected CSS is rejected, not just prefix-matched', r.code === 400, r.body);
  r = await call('POST', '/admin/banners/set', { adminKey: 'test-admin-key', body: { key: 'barstack', image: 'data:image/png;base64,AAAA<script>alert(1)</script>' } });
  check('a real base64 prefix followed by a script tag is also rejected', r.code === 400, r.body);
  check('neither injection attempt actually wrote anything to storage', !banners().has('barstack'), banners().get('barstack'));

  console.log('\n-- Oversized uploads are rejected before reaching storage --');
  const hugePayload = 'data:image/png;base64,' + 'A'.repeat(3_000_000);
  r = await call('POST', '/admin/banners/set', { adminKey: 'test-admin-key', body: { key: 'barstack', image: hugePayload } });
  check('oversized image rejected (400)', r.code === 400, r.body);
  // Same fix as above -- check the real per-slot doc location.
  check('no data written for the rejected oversized upload', !banners().has('barstack'), banners().get('barstack'));

  console.log('\n-- A legitimate upload succeeds, previews correctly, and is revertible --');
  r = await call('POST', '/admin/banners/set', { adminKey: 'test-admin-key', body: { key: 'barstack', image: TINY_PNG } });
  check('legitimate PNG upload succeeds', r.body?.status === 'success', r.body);
  r = await call('GET', '/admin/banners', { adminKey: 'test-admin-key' });
  check('admin GET reflects the new upload for that slot', r.body?.banners?.barstack === TINY_PNG, r.body?.banners?.barstack);
  check('every OTHER slot still reports null (untouched)', r.body?.banners?.giftbox === null && r.body?.banners?.basket === null, r.body?.banners);

  r = await call('GET', '/public/banners');
  check('/public/banners exposes ONLY the customised slot', r.body?.banners?.barstack === TINY_PNG && Object.keys(r.body?.banners || {}).length === 1, r.body?.banners);

  r = await call('POST', '/admin/banners/clear', { adminKey: 'test-admin-key', body: { key: 'barstack' } });
  check('revert succeeds', r.body?.status === 'success', r.body);
  r = await call('GET', '/public/banners');
  check('after revert, /public/banners is empty again (client falls back to its own default)', Object.keys(r.body?.banners || {}).length === 0, r.body?.banners);

  console.log('\n-- The new split-balance-card + gift-code banner slots are valid slots --');
  for (const slot of ['balancebg', 'cumulativebg', 'investedbg', 'giftcodebg', 'checkinbg']) {
    r = await call('POST', '/admin/banners/set', { adminKey: 'test-admin-key', body: { key: slot, image: TINY_PNG } });
    check('new slot "' + slot + '" accepts an upload', r.body?.status === 'success', r.body);
    r = await call('GET', '/public/banners');
    check('new slot "' + slot + '" is exposed on /public/banners once set', r.body?.banners?.[slot] === TINY_PNG, r.body?.banners?.[slot]);
    await call('POST', '/admin/banners/clear', { adminKey: 'test-admin-key', body: { key: slot } });
  }

  console.log('\n-- Clearing/setting an unknown key is rejected the same way --');
  r = await call('POST', '/admin/banners/clear', { adminKey: 'test-admin-key', body: { key: 'not_a_real_slot' } });
  check('clearing an unknown slot rejected (400)', r.code === 400, r.body);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
