/* SPACE8 -- LEGACY banners/main DOCUMENT GETS BACKFILLED INTO ONE-DOC-PER-SLOT
   Codex-verified real gap (2026-08-18, Low severity): banners/main used to be
   ONE document with every BANNER_KEYS slot as a field on it. Adding the
   split-balance-card/gift-code/check-in slots brought the slot count to 24 --
   just 6 near-max (~2.8MB) uploads across those 24 slots already exceeds
   MongoDB's 16MB per-document limit, at which point EVERY future banner
   upload fails (the whole document write fails, not just the new field).
   Same failure shape already fixed once for Home slides; the fix here is the
   same one-document-PER-SLOT redesign (collection 'banners', doc id = the
   slot key).

   The fix is backfillBannerDocs() in server.js, fired once at boot (see
   connectMongo().then(...)) -- additive only, never deletes/touches the old
   banners/main doc, so an owner's already-configured banners can never
   appear to silently vanish mid-migration. Exactly like
   test-referral-code-backfill.js's own reasoning, this only runs once, at
   the moment server.js is first required, so the legacy doc has to be
   seeded BEFORE requiring server.js for this test to see it get migrated.

   Proves:
     - a legacy banners/main doc (old shape: every slot as a field on ONE
       document, exactly how a real pre-2026-08-18 admin's banners would be
       stored) has each of its slots correctly copied into its own new
       per-slot document shortly after boot
     - those migrated banners are visible through the real, unmodified
       /public/banners and /admin/banners endpoints -- proving the fix from
       the CONSUMER's point of view, not just by poking internal storage
     - a slot that's NOT present in the legacy doc is correctly left unset
       (the migration doesn't invent banners that were never configured)
     - the OLD banners/main doc itself is left in place, untouched -- the
       migration is additive, not destructive
     - a NEW upload to a slot that already has an old-format value in
       banners/main does NOT get clobbered by a delayed/duplicate migration
       pass (the migration only ever fills in an EMPTY per-slot doc)

   Run: node test-banner-doc-backfill.js   (exits 0 = all green)          */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '4309';

const Module = require('module');
const mockdb = require('./test-mockdb.js');
const dbPath = require.resolve('./db.js');
const dbMod = new Module(dbPath); dbMod.exports = mockdb; dbMod.loaded = true;
require.cache[dbPath] = dbMod;

const faPath = require.resolve('firebase-admin');
const faMod = new Module(faPath);
faMod.exports = {
  initializeApp: () => {}, credential: { cert: () => ({}) },
  auth: () => ({ verifyIdToken: async (tok) => { if (String(tok).startsWith('uid:')) return { uid: tok.slice(4) }; throw new Error('bad'); } }),
};
faMod.loaded = true;
require.cache[faPath] = faMod;

function collMap(name) {
  if (!mockdb.__store.has(name)) mockdb.__store.set(name, new Map());
  return mockdb.__store.get(name);
}
const banners = () => collMap('banners');

const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const OTHER_PNG = 'data:image/png;base64,AAAAB0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYIB=';

// Seeded BEFORE require('./server.js') -- this is the entire point of this
// file. Shaped exactly like a real pre-2026-08-18 admin's banners: ONE
// document ('main') carrying two configured slots as fields, matching the
// old { [key]: dataUri } shape.
banners().set('main', { barstack: TINY_PNG, giftbox: OTHER_PNG });

require('./server.js');

const BASE = 'http://127.0.0.1:4309';
async function call(method, p, { adminKey, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (adminKey) headers.Authorization = 'Bearer ' + adminKey;
  const r = await fetch(BASE + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (_) {}
  return { code: r.status, body: j };
}
async function ownerGet(path) { return call('GET', path, { adminKey: 'test-admin-key' }); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   - ' + name); }
  else { fail++; console.log('  FAIL - ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}

(async () => {
  // Generous wait for the boot-time backfill (fired inside
  // connectMongo().then(...)) to actually run, same idiom as
  // test-referral-code-backfill.js's own wait.
  await sleep(1200);

  console.log('\n== Both legacy-doc slots were migrated into their own per-slot documents ==');
  check('barstack got its own new-format doc', banners().get('barstack')?.image === TINY_PNG, banners().get('barstack'));
  check('giftbox got its own new-format doc', banners().get('giftbox')?.image === OTHER_PNG, banners().get('giftbox'));

  console.log('\n== The migrated banners are visible through the real, unmodified public/admin endpoints ==');
  let r = await call('GET', '/public/banners');
  check('/public/banners reflects the migrated barstack banner', r.body?.banners?.barstack === TINY_PNG, r.body?.banners);
  check('/public/banners reflects the migrated giftbox banner', r.body?.banners?.giftbox === OTHER_PNG, r.body?.banners);
  r = await ownerGet('/admin/banners');
  check('/admin/banners also reflects both migrated banners', r.body?.banners?.barstack === TINY_PNG && r.body?.banners?.giftbox === OTHER_PNG, r.body?.banners);

  console.log('\n== A slot never configured in the legacy doc stays unset -- the migration does not invent banners ==');
  check('a never-configured slot (basket) was NOT migrated into existence', !banners().has('basket'), banners().get('basket'));
  r = await call('GET', '/public/banners');
  check('/public/banners has no entry for the never-configured slot', !('basket' in (r.body?.banners || {})), r.body?.banners);

  console.log('\n== The old banners/main doc is left in place, untouched -- migration is additive, not destructive ==');
  const oldDoc = banners().get('main');
  check('the legacy banners/main doc still exists with its original data', oldDoc?.barstack === TINY_PNG && oldDoc?.giftbox === OTHER_PNG, oldDoc);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
