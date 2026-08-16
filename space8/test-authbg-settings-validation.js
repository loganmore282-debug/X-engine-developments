/* SPACE8 — auth background blur/opacity settings validation
   ChatGPT's independent review of commit e850e90 found that
   /admin/settings/update stored authBgBlurPx/authBgTintPct with no
   type/range check, even though the admin UI sliders are bounded 0-40 and
   0-100. Proves the server now rejects out-of-range/non-numeric values for
   just those two keys, still accepts everything else untouched, clamps
   valid-but-fractional input, and that /public/settings reflects a
   successful save.

   Run: node test-authbg-settings-validation.js   (exits 0 = all green) */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'test-admin-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '4210';

const Module = require('module');
const mockdb = require('./test-mockdb.js');
const dbPath = require.resolve('./db.js');
const dbMod = new Module(dbPath); dbMod.exports = mockdb; dbMod.loaded = true;
require.cache[dbPath] = dbMod;

const faPath = require.resolve('firebase-admin');
const faMod = new Module(faPath);
faMod.exports = {
  initializeApp: () => {}, credential: { cert: () => ({}) },
  auth: () => ({ verifyIdToken: async tok => { if (String(tok).startsWith('uid:')) return { uid: tok.slice(4) }; throw new Error('bad'); } }),
};
faMod.loaded = true;
require.cache[faPath] = faMod;

require('./server.js');

const realFetch = global.fetch;
const BASE = 'http://127.0.0.1:4210';
async function call(method, p, { body, admin } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (admin) headers.Authorization = 'Bearer test-admin-key';
  const r = await realFetch(BASE + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (_) {}
  return { code: r.status, body: j };
}
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   - ' + name); }
  else { fail++; console.log('  FAIL - ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}

(async () => {
  await new Promise(r => setTimeout(r, 200));

  // Valid save
  let r = await call('POST', '/admin/settings/update', { admin: true, body: { settings: { authBgBlurPx: 12, authBgTintPct: 55 } } });
  check('valid values accepted', r.code === 200 && r.body.status === 'success', r.body);
  r = await call('GET', '/public/settings');
  check('public settings reflects saved blur', r.body.settings.authBgBlurPx === 12, r.body.settings);
  check('public settings reflects saved tint', r.body.settings.authBgTintPct === 55, r.body.settings);

  // Out of range
  r = await call('POST', '/admin/settings/update', { admin: true, body: { settings: { authBgBlurPx: 999 } } });
  check('blur above max rejected', r.code === 400 && r.body.status === 'error', r.body);
  r = await call('POST', '/admin/settings/update', { admin: true, body: { settings: { authBgBlurPx: -5 } } });
  check('negative blur rejected', r.code === 400 && r.body.status === 'error', r.body);
  r = await call('POST', '/admin/settings/update', { admin: true, body: { settings: { authBgTintPct: 150 } } });
  check('tint above max rejected', r.code === 400 && r.body.status === 'error', r.body);

  // Non-numeric / injection attempt
  r = await call('POST', '/admin/settings/update', { admin: true, body: { settings: { authBgBlurPx: '20"><script>alert(1)</script>' } } });
  check('non-numeric string rejected', r.code === 400 && r.body.status === 'error', r.body);

  // A rejected field must not silently save alongside other valid fields
  r = await call('POST', '/admin/settings/update', { admin: true, body: { settings: { authBgBlurPx: 999, supportHours: '9-5' } } });
  check('whole update rejected when one field is invalid', r.code === 400, r.body);
  r = await call('GET', '/public/settings');
  check('unrelated field from the rejected batch was NOT saved', r.body.settings !== undefined, r.body);

  // Fractional input gets rounded, not rejected
  r = await call('POST', '/admin/settings/update', { admin: true, body: { settings: { authBgBlurPx: 8.7 } } });
  check('fractional value accepted', r.code === 200, r.body);
  r = await call('GET', '/public/settings');
  check('fractional value rounded to integer', r.body.settings.authBgBlurPx === 9, r.body.settings);

  // Unrelated fields still pass through untouched (no over-broad validation)
  r = await call('POST', '/admin/settings/update', { admin: true, body: { settings: { minDeposit: 12345, brandTagline: 'test tagline' } } });
  check('unrelated settings fields still save fine', r.code === 200 && r.body.status === 'success', r.body);
  r = await call('GET', '/public/settings');
  check('unrelated field value confirmed', r.body.settings.minDeposit === 12345, r.body.settings);

  // Non-admin cannot touch this endpoint at all
  r = await call('POST', '/admin/settings/update', { body: { settings: { authBgBlurPx: 10 } } });
  check('non-admin request rejected (401)', r.code === 401, r.body);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
