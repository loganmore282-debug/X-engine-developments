/* CHRONOVA — MULTI-ADMIN ACCOUNTS / SESSIONS / AUDIT LOG
   Boots the REAL server.js against an in-memory database and drives the new
   per-admin-account auth system end-to-end: owner master key still works,
   staff accounts login with their own username/password, a deactivated or
   password-reset account is locked out immediately (existing sessions die
   too, not just future logins), staff can never reach owner-only endpoints,
   repeated bad logins lock out that one username, and sensitive actions
   land in the audit log with the correct actor attached.
   Run:  node test-admin-accounts.js      (exits 0 = all green)                */

process.env.MONGODB_URI = 'mongodb://mock';
process.env.ADMIN_KEY = 'super-secret-owner-key';
process.env.FIREBASE_API_KEY = 'test';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"t","private_key":"k","client_email":"e"}';
process.env.MARZPAY_KEY = 'dGVzdDp0ZXN0';
process.env.PORT = '3996';

const Module = require('module');
const mockdb = require('./test-mockdb.js');
const dbPath = require.resolve('./db.js');
const dbMod = new Module(dbPath); dbMod.exports = mockdb; dbMod.loaded = true;
require.cache[dbPath] = dbMod;

const faPath = require.resolve('firebase-admin');
const faMod = new Module(faPath);
faMod.exports = {
  initializeApp: () => {}, credential: { cert: () => ({}) },
  auth: () => ({
    verifyIdToken: async tok => { if (String(tok).startsWith('uid:')) return { uid: tok.slice(4) }; throw new Error('invalid token'); },
    updateUser: async () => ({}), createCustomToken: async uid => 'ct:' + uid,
  }),
};
faMod.loaded = true;
require.cache[faPath] = faMod;

require('./server.js');

const BASE = 'http://127.0.0.1:3996';
async function call(method, p, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (_) {}
  return { code: r.status, body: j };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}

(async () => {
  await sleep(300);

  console.log('\n── 1. Owner logs in with the master key, gets a session token');
  let r = await call('POST', '/admin/check-key', { body: { key: 'wrong-key' } });
  check('wrong master key rejected', r.code === 401, r.body);
  r = await call('POST', '/admin/check-key', { body: { key: 'super-secret-owner-key' } });
  check('correct master key accepted', r.body?.status === 'success' && !!r.body.token && r.body.role === 'owner', r.body);
  const ownerToken = r.body.token;
  r = await call('POST', '/admin/stats', { token: ownerToken, body: {} });
  check('owner session token works on a normal admin endpoint', r.body?.status === 'success', r.body);

  console.log('\n── 2. Owner creates a staff account; staff cannot yet do owner-only things');
  r = await call('POST', '/admin/admins/create', { token: ownerToken, body: { username: 'alice', password: 'correct horse battery' } });
  check('owner creates staff account "alice"', r.body?.status === 'success', r.body);
  r = await call('POST', '/admin/admins/create', { token: ownerToken, body: { username: 'alice', password: 'whatever12' } });
  check('duplicate username rejected', r.body?.status !== 'success', r.body);

  r = await call('POST', '/admin/login', { body: { username: 'alice', password: 'wrong password here' } });
  check('wrong password rejected', r.code === 401, r.body);
  r = await call('POST', '/admin/login', { body: { username: 'alice', password: 'correct horse battery' } });
  check('correct staff login succeeds', r.body?.status === 'success' && !!r.body.token && r.body.role === 'staff', r.body);
  const aliceToken = r.body.token;

  r = await call('POST', '/admin/stats', { token: aliceToken, body: {} });
  check('staff session works on a normal admin endpoint', r.body?.status === 'success', r.body);
  r = await call('POST', '/admin/admins/create', { token: aliceToken, body: { username: 'mallory', password: 'trytoescalate1' } });
  check('staff CANNOT create more admin accounts (owner-only)', r.code === 401, r.body);
  r = await call('POST', '/admin/admins/list', { token: aliceToken, body: {} });
  check('staff CANNOT list admin accounts (owner-only)', r.code === 401, r.body);

  console.log('\n── 3. Deactivating one account kills it immediately, others untouched');
  r = await call('POST', '/admin/admins/create', { token: ownerToken, body: { username: 'bob', password: 'another-good-pass1' } });
  check('owner creates a second staff account "bob"', r.body?.status === 'success', r.body);
  r = await call('POST', '/admin/login', { body: { username: 'bob', password: 'another-good-pass1' } });
  const bobToken = r.body?.token;
  check('bob logs in fine', r.body?.status === 'success' && !!bobToken, r.body);

  r = await call('POST', '/admin/admins/deactivate', { token: ownerToken, body: { username: 'alice' } });
  check('owner deactivates alice', r.body?.status === 'success', r.body);
  r = await call('POST', '/admin/stats', { token: aliceToken, body: {} });
  check('alice\'s EXISTING session token stops working the instant she is deactivated', r.code === 401, r.body);
  r = await call('POST', '/admin/login', { body: { username: 'alice', password: 'correct horse battery' } });
  check('alice cannot even log back in while deactivated', r.code === 401, r.body);
  r = await call('POST', '/admin/stats', { token: bobToken, body: {} });
  check('bob (never touched) is completely unaffected by alice\'s deactivation', r.body?.status === 'success', r.body);

  console.log('\n── 4. Resetting a password revokes that person\'s old sessions too');
  r = await call('POST', '/admin/admins/reset-password', { token: ownerToken, body: { username: 'bob', password: 'brand-new-password1' } });
  check('owner resets bob\'s password', r.body?.status === 'success', r.body);
  r = await call('POST', '/admin/stats', { token: bobToken, body: {} });
  check('bob\'s OLD session token is dead after the reset', r.code === 401, r.body);
  r = await call('POST', '/admin/login', { body: { username: 'bob', password: 'another-good-pass1' } });
  check('bob\'s OLD password no longer works', r.code === 401, r.body);
  r = await call('POST', '/admin/login', { body: { username: 'bob', password: 'brand-new-password1' } });
  check('bob logs in fine with the NEW password', r.body?.status === 'success', r.body);
  // Kept alive (never logged out) for the codes-attribution check in section 7b,
  // below all the login-attempt-heavy sections — reused there instead of a
  // fresh login, since /admin/login itself is tightly rate-limited and this
  // suite already spends most of that budget on sections 3-6.
  const bobToken3 = r.body?.token;

  console.log('\n── 5. Per-username lockout after repeated failed logins');
  for (let i = 0; i < 5; i++) await call('POST', '/admin/login', { body: { username: 'carol-nobody', password: 'guess' + i } });
  r = await call('POST', '/admin/login', { body: { username: 'carol-nobody', password: 'guess-again' } });
  check('username gets locked out after 5 failed attempts', r.code === 429, r.body);

  console.log('\n── 6. Logout invalidates the session server-side');
  r = await call('POST', '/admin/login', { body: { username: 'bob', password: 'brand-new-password1' } });
  const bobToken2 = r.body?.token;
  r = await call('POST', '/admin/logout', { token: bobToken2, body: {} });
  check('logout call succeeds', r.body?.status === 'success', r.body);
  r = await call('POST', '/admin/stats', { token: bobToken2, body: {} });
  check('the logged-out token is dead — cannot be replayed', r.code === 401, r.body);

  console.log('\n── 7. Sensitive actions land in the audit log with the right actor');
  r = await call('POST', '/admin/settings/update', { token: ownerToken, body: { maintenanceMode: true } });
  check('owner flips maintenance mode on', r.body?.status === 'success', r.body);
  r = await call('POST', '/admin/settings/update', { token: ownerToken, body: { maintenanceMode: false } });
  check('owner flips it back off', r.body?.status === 'success', r.body);
  r = await call('POST', '/admin/audit-log', { token: ownerToken, body: {} });
  const log = r.body?.log || [];
  check('audit log is reachable and has entries', r.body?.status === 'success' && log.length > 0, log.length);
  check('audit log records the owner session actions as actor "owner"',
    log.some(e => e.actor === 'owner' && e.action === 'settings_updated'), log.map(e => e.actor + ':' + e.action));
  check('audit log recorded the admin_created / deactivated / password_reset actions too',
    ['admin_created', 'admin_deactivated', 'admin_password_reset'].every(a => log.some(e => e.action === a)),
    log.map(e => e.action));
  r = await call('POST', '/admin/audit-log', { token: bobToken, body: {} });
  check('staff CANNOT read the audit log (owner-only)', r.code === 401, r.body);

  console.log('\n── 7b. Gift codes are owner-only (a mint-and-redeem-yourself lever, same class as manual crediting) and record WHO generated/deactivated them');
  r = await call('POST', '/admin/codes/generate', { token: ownerToken, body: { minAmount: 1000, maxAmount: 2000, count: 1 } });
  check('owner generates a code', r.body?.status === 'success' && r.body.codes?.length === 1, r.body);
  const ownerCode = r.body.codes[0];
  r = await call('POST', '/admin/codes/generate', { token: bobToken3, body: { minAmount: 700000, maxAmount: 700000, count: 1 } });
  check('staff CANNOT generate a gift code — this was the actual hole a rogue/compromised staff account could mint a high-value code through and redeem it themselves',
    r.code === 401, r.body);
  r = await call('POST', '/admin/codes/list', { token: bobToken3, body: {} });
  check('staff CANNOT list codes either', r.code === 401, r.body);
  r = await call('POST', '/admin/codes/list', { token: ownerToken, body: {} });
  const codeList = r.body?.codes || [];
  const ownerCodeDoc = codeList.find(c => c.code === ownerCode);
  check('the owner-generated code is attributed to "owner" right in the list', ownerCodeDoc?.createdBy === 'owner', ownerCodeDoc);
  check('the rejected staff attempt never actually created a 700,000 code', !codeList.some(c => c.minAmount === 700000), codeList.map(c => c.minAmount));
  r = await call('POST', '/admin/codes/deactivate', { token: bobToken3, body: { codeId: ownerCodeDoc.id } });
  check('staff CANNOT deactivate a code either', r.code === 401, r.body);
  r = await call('POST', '/admin/codes/deactivate', { token: ownerToken, body: { codeId: ownerCodeDoc.id } });
  check('owner deactivates the code', r.body?.status === 'success', r.body);
  r = await call('POST', '/admin/audit-log', { token: ownerToken, body: {} });
  const log2 = r.body?.log || [];
  check('audit log recorded codes_generated for the owner\'s code batch',
    log2.some(e => e.action === 'codes_generated' && e.actor === 'owner'), log2.filter(e => e.action === 'codes_generated'));
  check('audit log recorded code_deactivated with owner as the actor',
    log2.some(e => e.action === 'code_deactivated' && e.actor === 'owner'), log2.filter(e => e.action === 'code_deactivated'));

  console.log('\n── 7c. A transient DB hiccup while checking a session must NEVER look like "your session is invalid"');
  // Regression test: a real Mongo blip resolving the session token used to be
  // swallowed silently, leaving req.adminUser unset — which fell through to a
  // hard 401 "Unauthorized", and admin.html treats ANY 401 as "log the owner
  // out, wipe the stored session, show the login screen". A perfectly valid,
  // unexpired session should never be thrown away just because one DB read
  // hiccuped.
  mockdb.__mockDbFailOnce.add('adminSessions');
  r = await call('POST', '/admin/stats', { token: ownerToken, body: {} });
  check('a DB hiccup during session-check returns 503 (retryable), NOT 401 (logged out)', r.code === 503, r.body);
  r = await call('POST', '/admin/stats', { token: ownerToken, body: {} });
  check('the SAME still-valid session works again right after (it was never actually invalidated)', r.body?.status === 'success', r.body);

  console.log('\n── 8. Settings, Products and Banners are owner-only too');
  r = await call('POST', '/admin/settings', { token: ownerToken, body: {} });
  check('owner CAN read settings', r.body?.status === 'success', r.body);
  r = await call('POST', '/admin/settings', { token: bobToken, body: {} });
  check('staff CANNOT read settings', r.code === 401, r.body);
  r = await call('POST', '/admin/settings/update', { token: bobToken, body: { maintenanceMode: true } });
  check('staff CANNOT write settings', r.code === 401, r.body);
  r = await call('POST', '/admin/banners', { token: bobToken, body: {} });
  check('staff CANNOT read banners', r.code === 401, r.body);
  r = await call('POST', '/admin/banners/set', { token: bobToken, body: { key: 'bannerHero', url: 'https://evil.example/x.png' } });
  check('staff CANNOT write banners', r.code === 401, r.body);
  r = await call('POST', '/admin/products/list', { token: bobToken, body: {} });
  check('staff CANNOT list products', r.code === 401, r.body);
  r = await call('POST', '/admin/products/save', { token: bobToken, body: { label: 'Hijacked', price: 1 } });
  check('staff CANNOT create/edit products', r.code === 401, r.body);
  r = await call('POST', '/admin/products/clear', { token: bobToken, body: {} });
  check('staff CANNOT clear the product catalogue', r.code === 401, r.body);
  r = await call('POST', '/admin/products/list', { token: ownerToken, body: {} });
  check('owner CAN still list products', r.body?.status === 'success', r.body);
  r = await call('POST', '/admin/deposit', { token: bobToken, body: { userId: 'x', amount: 1000 } });
  check('staff CANNOT credit a wallet (owner-only)', r.code === 401, r.body);
  r = await call('POST', '/admin/deposit', { token: ownerToken, body: { userId: 'nonexistent-uid', amount: 1000 } });
  check('owner CAN reach the credit-wallet endpoint (fails on missing user, not auth)', r.code !== 401, r.body);

  console.log('\n── 9. The lightweight badge endpoint (polled every 12s from every open tab) works without the heavy full-stats scan');
  r = await call('POST', '/admin/badges', { token: ownerToken, body: {} });
  check('owner reads the pending-withdrawals badge count', r.body?.status === 'success' && typeof r.body.pendingWithdrawals === 'number', r.body);
  r = await call('POST', '/admin/badges', { token: bobToken3, body: {} });
  check('staff can read it too (not owner-only — staff process withdrawals)', r.body?.status === 'success', r.body);
  r = await call('POST', '/admin/badges', { body: {} });
  check('an unauthenticated call is rejected', r.code === 401, r.body);

  console.log('\n── 10. Deposits tab now shows EVERY deposit (manual + gateway), any status — not just the live manual queue');
  mockdb.__store.get('users') || mockdb.__store.set('users', new Map());
  mockdb.__store.get('users').set('dep-tester-uid', { name: 'Dep Tester', username: 'deptester', phone: '0771000099', registrationDone: true });
  mockdb.__store.get('pendingDeposits') || mockdb.__store.set('pendingDeposits', new Map());
  const deps = mockdb.__store.get('pendingDeposits');
  deps.set('dep-manual-1', { userId: 'dep-tester-uid', provider: 'manual', manual: true, manualPending: true, status: 'claimed', amount: 10000, recipientNumber: '0700111222', recipientName: 'Shop A', createdAt: new Date() });
  deps.set('dep-gw-processing', { userId: 'dep-tester-uid', provider: 'marzpay', status: 'processing', amount: 20000, marzReference: 'ref-abc', createdAt: new Date() });
  deps.set('dep-gw-success', { userId: 'dep-tester-uid', provider: 'marzpay', status: 'matched', amount: 30000, creditedAmount: 30000, createdAt: new Date() });
  deps.set('dep-gw-failed', { userId: 'dep-tester-uid', provider: 'obpay', status: 'failed', amount: 15000, createdAt: new Date() });
  r = await call('POST', '/admin/deposits/list', { token: ownerToken, body: { limit: 300 } });
  check('the list call succeeds', r.body?.status === 'success', r.body);
  const depIds = (r.body?.deposits || []).map(d => d.id);
  check('a PROCESSING gateway deposit is visible (used to be invisible — only manualPending showed before)', depIds.includes('dep-gw-processing'), depIds);
  check('a SUCCESSFUL (matched) gateway deposit is visible', depIds.includes('dep-gw-success'), depIds);
  check('a FAILED gateway deposit is visible', depIds.includes('dep-gw-failed'), depIds);
  check('the manual order is still there too', depIds.includes('dep-manual-1'), depIds);
  check('status counts are tallied across every status, not just the manual queue',
    r.body?.counts?.processing >= 1 && r.body?.counts?.matched >= 1 && r.body?.counts?.failed >= 1 && r.body?.counts?.claimed >= 1, r.body?.counts);
  const gwRow = (r.body?.deposits || []).find(d => d.id === 'dep-gw-success');
  check('the depositor\'s name/phone are resolved onto the row', gwRow?.userName === 'Dep Tester' && gwRow?.userPhone === '0771000099', gwRow);
  r = await call('POST', '/admin/deposits/list', { body: {} });
  check('an unauthenticated call is rejected', r.code === 401, r.body);

  console.log('\n── 11. "Shrink images" actually re-encodes stored product images smaller — the real lever on why Products loads slower than every other tab');
  const sharp = require('sharp');
  // Random noise compresses realistically (unlike a flat color), so this is a
  // meaningful stand-in for a real uploaded photo, not a degenerate best-case.
  const noiseBuf = Buffer.alloc(900 * 900 * 3);
  for (let i = 0; i < noiseBuf.length; i++) noiseBuf[i] = Math.floor(Math.random() * 256);
  const bigJpeg = await sharp(noiseBuf, { raw: { width: 900, height: 900, channels: 3 } }).jpeg({ quality: 90 }).toBuffer();
  const bigDataUri = 'data:image/jpeg;base64,' + bigJpeg.toString('base64');
  mockdb.__store.get('products') || mockdb.__store.set('products', new Map());
  mockdb.__store.get('products').set('prod-big', { key: 'big', label: 'Big Photo Watch', price: 50000, cycle: 120, active: true, image: bigDataUri });
  mockdb.__store.get('products').set('prod-small', { key: 'small', label: 'Already Small', price: 30000, cycle: 120, active: true, image: 'data:image/jpeg;base64,' + 'A'.repeat(500) });
  r = await call('POST', '/admin/products/recompress-images', { token: bobToken3, body: {} });
  check('staff (non-owner) cannot run this — it rewrites live product data', r.code === 401, r.body);
  r = await call('POST', '/admin/products/recompress-images', { token: ownerToken, body: {} });
  check('owner call succeeds', r.body?.status === 'success', r.body);
  check('the big image was processed', r.body?.processed >= 1, r.body);
  check('an already-small image was skipped, not touched', r.body?.skipped >= 1, r.body);
  check('bytesAfter is meaningfully smaller than bytesBefore', r.body?.bytesAfter < r.body?.bytesBefore * 0.5, { before: r.body?.bytesBefore, after: r.body?.bytesAfter });
  const bigAfter = mockdb.__store.get('products').get('prod-big');
  check('the stored image on the actual product doc shrank', bigAfter.image.length < bigDataUri.length * 0.5, { before: bigDataUri.length, after: bigAfter.image.length });
  check('the shrunk image is still a valid, loadable data URI', /^data:image\/jpeg;base64,/.test(bigAfter.image), bigAfter.image.slice(0, 30));
  const smallDoc = mockdb.__store.get('products').get('prod-small');
  check('the already-small image was left byte-for-byte untouched', smallDoc.image === 'data:image/jpeg;base64,' + 'A'.repeat(500), smallDoc.image.length);

  console.log('\n── 12. Gift-code redeem lock is self-healing — never permanently "stuck processing" for a code');
  mockdb.__store.get('users') || mockdb.__store.set('users', new Map());
  for (let i = 0; i < 6; i++) {
    mockdb.__store.get('users').set('redeemer-' + i, { name: 'Redeemer ' + i, walletBalance: 0, totalEarned: 0 });
  }
  mockdb.__store.get('redemptionCodes') || mockdb.__store.set('redemptionCodes', new Map());
  mockdb.__store.get('redemptionCodes').set('lock-code-1', {
    codeKey: 'LOCKTEST', code: 'LOCKTEST', active: true, usedBy: [], minAmount: 100, maxAmount: 100,
  });
  // Fire several genuinely concurrent redemptions of the SAME code by
  // DIFFERENT users — this is exactly the shape of many people redeeming one
  // Telegram-shared code at once. None of them has a maxUsers cap, so every
  // one of them should end up succeeding; the lock only ever serializes the
  // DB write, it never silently drops a legitimate redemption.
  const concurrentResults = await Promise.all(
    [0, 1, 2, 3, 4].map(i => call('POST', '/redeem', { token: 'uid:redeemer-' + i, body: { code: 'LOCKTEST' } }))
  );
  const successes = concurrentResults.filter(r => r.body?.status === 'success');
  check('every concurrent redeemer of an uncapped code is eventually credited, none silently dropped',
    successes.length === 5, concurrentResults.map(r => r.body));
  const lockedCode = mockdb.__store.get('redemptionCodes').get('lock-code-1');
  check('usedBy reflects exactly the 5 distinct redeemers, no duplicates/loss',
    new Set(lockedCode.usedBy).size === 5 && lockedCode.usedBy.length === 5, lockedCode.usedBy);
  for (let i = 0; i < 5; i++) {
    const u = mockdb.__store.get('users').get('redeemer-' + i);
    check(`redeemer-${i} was credited exactly once (100), not zero, not double`, u.walletBalance === 100, u.walletBalance);
  }
  // The lock must never outlive the request that held it: a 6th, later
  // redeemer of the same code must NOT be turned away with "being processed"
  // once the concurrent batch above has actually finished.
  r = await call('POST', '/redeem', { token: 'uid:redeemer-5', body: { code: 'LOCKTEST' } });
  check('a redeemer arriving after the burst is not falsely told the code is still processing',
    r.body?.status === 'success', r.body);
  r = await call('POST', '/redeem', { token: 'uid:redeemer-5', body: { code: 'LOCKTEST' } });
  check('redeeming the same code twice as the same user is still correctly rejected (unrelated to the lock)',
    r.code === 400 && /already redeemed/i.test(r.body?.message || ''), r.body);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
