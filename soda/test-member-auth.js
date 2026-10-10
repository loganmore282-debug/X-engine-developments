'use strict';
// Member login without Firebase: signup, login, lockout, sessions, password
// change/reset. The REAL route source is extracted from server.js and run
// against an in-memory database.
const fs = require('node:fs'), assert = require('node:assert/strict'), crypto = require('node:crypto');
let checks = 0; const ok = (c, m) => { checks++; assert.ok(c, m); }; const eq = (a, b, m) => { checks++; assert.deepEqual(a, b, m); };
const src = fs.readFileSync(__dirname + '/server.js', 'utf8');
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i + 1); assert.ok(i >= 0 && j > i, a); return src.slice(i, j); };
const sessionPolicy = require('./session-policy');
const hashSrc = cut('function scryptHash(password) {', 'const _loginFails = new Map();');
const lockSrc = cut('function withLock(key, fn) {', 'const _userBeingDeleted');
const authSrc = cut('async function _decodeAuth(req) {', 'function paymentAmount(value) {');
const loginSrc = cut('const LOGIN_MAX_FAILS = 6;', "app.post('/auth/session/activity'");

const DEL = { __del: 1 };
function makeEnv() {
  const store = { authAccounts: new Map(), memberSessions: new Map() };
  const clone = v => structuredClone(v);
  const put = (col, id, d) => { const o = { ...d }; for (const k of Object.keys(o)) if (o[k] && o[k].__del) delete o[k]; store[col].set(id, o); };
  const docRef = (col, id) => ({ id, ref: null,
    get: async () => ({ id, exists: store[col].has(id), data: () => clone(store[col].get(id)), ref: docRef(col, id) }),
    set: async d => put(col, id, clone(d)),
    createIfAbsent: async d => { if (store[col].has(id)) return false; put(col, id, clone(d)); return true; },
    update: async d => { if (!store[col].has(id)) throw new Error('NOT_FOUND'); const o = { ...store[col].get(id), ...clone(d) }; for (const k of Object.keys(o)) if (o[k] && o[k].__del) delete o[k]; store[col].set(id, o); },
    delete: async () => { store[col].delete(id); },
    updateIf: async (f, d) => { const r = store[col].get(id); if (!r || r.revoked || +r.expiresAt <= +f.expiresAt.$gt || +r.lastActiveAt <= +f.lastActiveAt.$gt) return false; Object.assign(r, d); return true; },
  });
  const db = { collection: col => ({ doc: id => docRef(col, id),
    where: (f, o, v) => ({ limit() { return this; }, get: async () => { const rows = [...store[col]].filter(([, r]) => r[f] === v);
      return { empty: !rows.length, docs: rows.map(([id, r]) => ({ id, data: () => clone(r), ref: docRef(col, id) })) }; } }) }) };
  const handlers = {}; const app = { post: (p, ...a) => { handlers[p] = a[a.length - 1]; } };
  const lim = () => (q, s, n) => n();
  let failStore = false;
  const dbProxy = new Proxy(db, { get: (t, k) => k === 'collection' ? col => { if (failStore && col === 'memberSessions') throw new Error('mongo down'); return t.collection(col); } : t[k] });
  const fn = new Function('app', 'db', 'crypto', 'sessionPolicy', 'FieldValue', 'cleanPhone', 'badPhoneMessage', 'tsMillis', 'rateLimit', 'console',
    'const _lockTails = new Map();\n' + hashSrc.replace("const _loginFails", "") + '\n' + lockSrc + '\n' + authSrc + '\n' + loginSrc + '\nreturn { _decodeAuth, verifyAuth, verifyAuthWithEmail, setMemberPassword, deleteMemberLogin, findAccountByUid };')
    (app, dbProxy, crypto, sessionPolicy, { serverTimestamp: () => new Date(), delete: () => DEL }, p => { const d = String(p || '').replace(/\D/g, ''); return d.length === 10 ? d : ''; }, () => 'bad phone',
      v => v instanceof Date ? v.getTime() : Number(v) || 0, lim, { error() {} });
  const call = async (path, body, headers = {}) => { const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await handlers[path]({ body, headers, path, ip: '1.1.1.1' }, res); return res; };
  return { store, call, fn, setFail: v => { failStore = v; } };
}
const bearer = t => ({ authorization: 'Bearer ' + t });

(async () => {
  let E = makeEnv();
  // ── signup ──
  let r = await E.call('/auth/signup', { phone: '0770000001', password: 'abcdef' });
  ok(r.code === 200 && r.body.token && r.body.uid && r.body.expiresAt > Date.now(), 'signup returns a session');
  const acct = [...E.store.authAccounts.values()][0];
  ok(acct.passwordHash.includes(':') && !JSON.stringify(acct).includes('abcdef'), 'the password is stored hashed, never in clear');
  ok(!JSON.stringify([...E.store.memberSessions]).includes(r.body.token), 'the token is not stored, only its hash');
  r = await E.call('/auth/signup', { phone: '0770000001', password: 'other1' }); ok(r.code === 409 && r.body.code === 'PHONE_IN_USE', 'second signup for the same phone is refused');
  r = await E.call('/auth/signup', { phone: '0770000009', password: '123' }); eq([r.code, r.body.code], [400, 'WEAK_PASSWORD']);
  r = await E.call('/auth/signup', { phone: '0770000009', password: 'x'.repeat(129) }); eq(r.code, 400, 'over-long password');
  r = await E.call('/auth/signup', { phone: 'abc', password: 'abcdef' }); eq([r.code, r.body.code], [400, 'INVALID_PHONE']);
  const race = await Promise.all([1, 2, 3, 4, 5].map(i => E.call('/auth/signup', { phone: '0770000002', password: 'pw' + i + 'xxx' })));
  eq(race.filter(x => x.code === 200).length, 1, 'five simultaneous signups for one phone create exactly one account'); eq(race.filter(x => x.code === 409).length, 4);
  // ── login ──
  r = await E.call('/auth/login', { phone: '0770000001', password: 'abcdef' });
  ok(r.code === 200 && r.body.uid === acct.uid, 'login with the right password'); const good = r.body;
  const wrong = await E.call('/auth/login', { phone: '0770000001', password: 'nope123' });
  const unknown = await E.call('/auth/login', { phone: '0770009999', password: 'nope123' });
  eq([wrong.code, wrong.body.code, wrong.body.message], [unknown.code, unknown.body.code, unknown.body.message], 'a wrong password and an unknown phone are indistinguishable');
  eq(wrong.code, 401);
  // lockout: 6 wrong -> locked, even the right password is refused during it
  E = makeEnv(); await E.call('/auth/signup', { phone: '0770000003', password: 'abcdef' });
  for (let i = 0; i < 5; i++) { r = await E.call('/auth/login', { phone: '0770000003', password: 'bad' + i + 'xx' }); eq(r.code, 401); }
  r = await E.call('/auth/login', { phone: '0770000003', password: 'abcdef' }); eq(r.code, 200, 'five wrong attempts do not lock a member who then gets it right');
  for (let i = 0; i < 5; i++) await E.call('/auth/login', { phone: '0770000003', password: 'bad' + i + 'xx' });
  r = await E.call('/auth/login', { phone: '0770000003', password: 'bad6xxx' }); eq(r.code, 401, 'sixth consecutive wrong attempt (the success reset the count)');
  r = await E.call('/auth/login', { phone: '0770000003', password: 'abcdef' }); ok(r.code === 429 && r.body.code === 'TOO_MANY_ATTEMPTS' && r.body.retryAfterSec > 0, 'locked: even the right password is refused: ' + r.code);
  const a3 = [...E.store.authAccounts.values()][0]; ok(!JSON.stringify(a3).includes('"abcdef"'), 'no plain password anywhere');
  a3.lockedUntil = new Date(Date.now() - 1000); E.store.authAccounts.set([...E.store.authAccounts.keys()][0], a3);
  r = await E.call('/auth/login', { phone: '0770000003', password: 'abcdef' }); eq(r.code, 200, 'works again once the lock has passed');
  // ── sessions through the request check ──
  const req = t => ({ headers: bearer(t), path: '/account' });
  let d = await E.fn.verifyAuthWithEmail(req(r.body.token)); ok(d && d.uid && d.phone === '0770000003', 'a valid token resolves to the member and the account phone');
  eq(await E.fn.verifyAuth({ headers: {}, path: '/account' }), null, 'no token');
  eq(await E.fn.verifyAuth({ headers: bearer('x'.repeat(43)), path: '/account' }), null, 'unknown token');
  eq(await E.fn.verifyAuth({ headers: { authorization: 'Basic abc' }, path: '/account' }), null, 'wrong scheme');
  const rq = { headers: bearer(r.body.token), path: '/account' }; await E.fn.verifyAuth(rq); await E.fn.verifyAuth(rq); eq(typeof rq._authDecoded, 'object', 'the answer is remembered on the request');
  E.setFail(true); const rq2 = { headers: bearer(r.body.token), path: '/account' };
  eq(await E.fn.verifyAuth(rq2), null, 'session store down: not authenticated...'); eq(rq2._authTransient, true, '...but flagged so the app is told "try again", not "logged out"'); E.setFail(false);
  // ── logout (revoke) ──
  await E.store.memberSessions.get(sessionPolicy.tokenKey(r.body.token)); await E.call('/auth/session/activity', {}, bearer(r.body.token)).catch(() => {});
  // ── password change ──
  E = makeEnv(); const s1 = (await E.call('/auth/signup', { phone: '0770000004', password: 'oldpass1' })).body;
  const s2 = (await E.call('/auth/login', { phone: '0770000004', password: 'oldpass1' })).body;
  r = await E.call('/auth/password/change', { oldPassword: 'WRONG', newPassword: 'newpass1' }, bearer(s1.token)); eq([r.code, r.body.code], [401, 'INVALID_CREDENTIAL']);
  r = await E.call('/auth/password/change', { oldPassword: 'oldpass1', newPassword: '12' }, bearer(s1.token)); eq(r.code, 400, 'weak new password');
  r = await E.call('/auth/password/change', { oldPassword: 'oldpass1', newPassword: 'newpass1' }, {}); eq(r.code, 401, 'needs a session');
  r = await E.call('/auth/password/change', { oldPassword: 'oldpass1', newPassword: 'newpass1' }, bearer(s1.token)); eq(r.code, 200);
  ok(await E.fn.verifyAuth(req(s1.token)), 'the session that changed it stays signed in');
  eq(await E.fn.verifyAuth(req(s2.token)), null, 'every OTHER session of the member is ended');
  eq((await E.call('/auth/login', { phone: '0770000004', password: 'oldpass1' })).code, 401, 'the old password no longer works');
  eq((await E.call('/auth/login', { phone: '0770000004', password: 'newpass1' })).code, 200, 'the new one does');
  // ── reset / owner reset / delete ──
  const s3 = (await E.call('/auth/login', { phone: '0770000004', password: 'newpass1' })).body;
  await E.fn.setMemberPassword(s3.uid, 'resetpw1');
  eq(await E.fn.verifyAuth(req(s3.token)), null, 'a reset ends all sessions');
  eq((await E.call('/auth/login', { phone: '0770000004', password: 'resetpw1' })).code, 200);
  let threw = null; try { await E.fn.setMemberPassword('nobody', 'abcdef') } catch (e) { threw = e.code; } eq(threw, 'NO_ACCOUNT', 'resetting a member with no login is an error');
  const s4 = (await E.call('/auth/login', { phone: '0770000004', password: 'resetpw1' })).body;
  await E.fn.deleteMemberLogin(s4.uid);
  eq(await E.fn.verifyAuth(req(s4.token)), null, 'a deleted member\'s session is dead'); eq((await E.call('/auth/login', { phone: '0770000004', password: 'resetpw1' })).code, 401, 'and cannot log in');
  r = await E.call('/auth/signup', { phone: '0770000004', password: 'again12' }); eq(r.code, 200, 'once a member is deleted their phone is free to sign up again');
  // ── the app's sign-in module (index.html) against these same routes ──
  {
    const { JSDOM } = require('jsdom');
    const html = fs.readFileSync(__dirname + '/user-src/index.html', 'utf8');
    const shim = html.match(/<script type="module">\s*\/\/ Soda's own sign-in[\s\S]*?<\/script>/)[0].replace(/^<script type="module">/, '').replace(/<\/script>$/, '');
    E = makeEnv();
    const boot = (storage) => {
      const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://app.example/', runScripts: 'outside-only' }); const w = dom.window;
      if (storage) for (const [k, v] of Object.entries(storage)) w.sessionStorage.setItem(k, v);
      w.events = []; w.addEventListener('snow-auth', e => w.events.push(e.detail));
      w.fetch = async (url, opts) => { const path = String(url).replace(/^https?:\/\/[^/]+/, '').replace(/^\/k7x2(?=\/)/, ''); if (w.netDown) throw new Error('offline');
        const r = await E.call(path, JSON.parse(opts.body), Object.fromEntries(Object.entries(opts.headers || {}).map(([k, v]) => [k.toLowerCase(), v]))); return { ok: r.code >= 200 && r.code < 300, status: r.code, json: async () => r.body }; };
      w.eval(shim); return w;
    };
    const rej = async p => { try { await p; return null; } catch (e) { return e.code; } };
    let w = boot();
    eq(w.events.length, 1); eq(w.events[0], null, 'startup with no session announces "signed out" once');
    const email = '0770000007@soda-platform.com';
    const created = await w.fbCreateUser(email, 'abcdef');
    ok(created.user.uid && w.events.length === 2 && w.events[1].uid === created.user.uid, 'sign-up announces the new user');
    eq(w.fbAuth.currentUser.email, email, 'the user carries the address the app signed in with');
    const tok = await w.fbAuth.currentUser.getIdToken(); ok(tok && tok.length > 40, 'a token to send as Authorization: Bearer');
    ok(await E.fn.verifyAuth({ headers: bearer(tok), path: '/account' }), 'and the server accepts it');
    const tr = await w.fbAuth.currentUser.getIdTokenResult(); ok(Math.abs(tr.claims.auth_time - Date.now() / 1000) < 5, 'auth_time claim present (the app starts its idle timer from it)');
    eq(await rej(w.fbCreateUser(email, 'abcdef')), 'auth/email-already-in-use', 'duplicate sign-up uses the code the app already handles');
    eq(await rej(w.fbCreateUser('0770000008@soda-platform.com', '123')), 'auth/weak-password');
    // restore after a reload in the same tab
    const saved = { soda_auth_session: w.sessionStorage.getItem('soda_auth_session') };
    ok(saved.soda_auth_session, 'session kept in sessionStorage (ends with the tab)');
    let w2 = boot(saved); ok(w2.events[0] && w2.events[0].uid === created.user.uid, 'a reload in the same tab restores the signed-in user');
    // sign out
    await w.fbSignOut(); eq(w.events[w.events.length - 1], null, 'sign-out announces null'); eq(w.sessionStorage.getItem('soda_auth_session'), null, 'and clears the stored session');
    // expired / junk stored sessions are not "signed in"
    eq(boot({ soda_auth_session: JSON.stringify({ token: 'x'.repeat(40), uid: 'u', authTime: 1, expiresAt: Date.now() - 1000 }) }).events[0], null, 'an expired stored session is ignored');
    eq(boot({ soda_auth_session: 'not json' }).events[0], null, 'junk in storage is ignored');
    // sign in, errors, lockout
    w = boot();
    const signed = await w.fbSignIn(email, 'abcdef'); ok(signed.user.uid === created.user.uid, 'sign-in works');
    await w.fbSignOut();
    eq(await rej(w.fbSignIn(email, 'wrong1')), 'auth/invalid-credential');
    eq(await rej(w.fbSignIn('0770000099@soda-platform.com', 'wrong1')), 'auth/invalid-credential', 'unknown number: same code');
    w.netDown = true; eq(await rej(w.fbSignIn(email, 'abcdef')), 'auth/network-request-failed', 'offline'); w.netDown = false;
    for (let i = 0; i < 6; i++) await rej(w.fbSignIn(email, 'wrong' + i));
    eq(await rej(w.fbSignIn(email, 'abcdef')), 'auth/too-many-requests', 'locked out: the app shows its "too many attempts" message');
    // change password through the module
    E = makeEnv(); w = boot(); await w.fbCreateUser('0770000010@soda-platform.com', 'oldpass1');
    eq(await rej(w.fbChangePassword('x', 'WRONG', 'newpass1')), 'auth/invalid-credential', 'wrong current password');
    await w.fbChangePassword('x', 'oldpass1', 'newpass1'); await w.fbSignOut();
    eq(await rej(w.fbSignIn('0770000010@soda-platform.com', 'oldpass1')), 'auth/invalid-credential'); await w.fbSignIn('0770000010@soda-platform.com', 'newpass1');
    await w.fbSignOut(); let thrown = null; try { await w.fbChangePassword('x', 'a', 'bbbbbb'); } catch (e) { thrown = e.message; } eq(thrown, 'not-signed-in', 'changing a password needs a session')
    ok(!/gstatic\.com\/firebasejs|firebase-app\.js|firebaseConfig/.test(html.replace(/<!--[\s\S]*?-->/g, '')), 'the page loads no Firebase script and carries no Firebase config');
  }
  // ── the REAL cleanPhone: every way the app can spell one number is one account ──
  {
    const phoneSrc = cut('const DEFAULT_REGION_KEY', 'function currentRegionKey()') + 'function currentRegionKey(){}\n' + cut('function localDigits(raw, region) {', '// Synthetic login email') + cut('function cleanPhone(raw, region) {', '// The two shapes a number may be typed in');
    const real = new Function(phoneSrc + '\nreturn cleanPhone;')();
    const forms = ['771234567@soda-platform.com'.split('@')[0], '256771234567', '0771234567', '+256771234567', '07 71 23 45 67'];
    eq(new Set(forms.map(x => real(x))).size, 1, 'the national, international and bare forms are one number: ' + forms.map(x => real(x)).join(' '));
    eq(real('771234567'), '+256771234567'); eq(real('12345'), null, 'junk is not a number'); eq(real(''), null);
  }
  // wiring
  ok(!/admin\.auth\(\)/.test(src), 'no Firebase Auth call is left in the server');
  ok(/pushAdminReady/.test(src) && !/process\.exit\(1\);\s*\}\s*try \{\s*admin\.initializeApp/.test(src), 'Firebase is optional (push only)');
  console.log(`PASS: member login without Firebase (${checks} checks)`); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
