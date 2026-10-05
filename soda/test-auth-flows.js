'use strict';
// Login / registration wiring, end to end, against the REAL member code
// (source, or the built bundle with --built) with a fake Firebase and a fake
// backend. The property defended throughout: whatever goes wrong, a member is
// never left on a dead spinner or an unchanged screen with nothing said --
// every attempt ends with the app open, or the login/sign-up screen showing
// with a message and working buttons.
//
// The server half (token verification, the 401 -> 503 hook, logout) runs the
// real functions extracted from server.js against mocks.
const fs = require('node:fs'), assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const built = process.argv.includes('--built');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let checks = 0;
const trace = m => { if (process.env.AUTH_TEST_TRACE) console.error('· ' + m); };
const ok = (cond, msg) => { checks++; assert.ok(cond, msg); };
const eq = (a, b, msg) => { checks++; assert.equal(a, b, msg); };

function load(pre) {
  const html = fs.readFileSync(__dirname + '/user' + (built ? '' : '-src') + '/index.html', 'utf8');
  const dom = new JSDOM(html, { url: 'https://example.test/user/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.scrollTo = () => {}; w.open = () => null;
  w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
  w.Notification = { permission: 'denied' };
  w.fetch = async () => ({ status: 200, json: async () => ({ status: 'success', settings: {}, products: [] }) });
  if (pre) pre(w);
  for (const tag of w.document.scripts) {
    if (tag.src || tag.type === 'module' || tag.type === 'application/ld+json') continue;
    let code = tag.textContent;
    if (tag.hasAttribute('data-nx-core')) code = (built
      ? require('node:zlib').inflateSync(Buffer.from(tag.textContent.match(/atob\("([A-Za-z0-9+/=]+)"\)/)[1], 'base64')).toString()
      : fs.readFileSync(__dirname + '/user-src/original_module.js', 'utf8'))
      .replace('var _entryPromise = maybeRotateEntry();', 'var _entryPromise = Promise.resolve();')
      .replace('var _bootPromise = boot();', 'var _bootPromise = Promise.resolve();');
    if (code.trim()) w.eval(code);
  }
  return dom;
}
const $ = (w, id) => w.document.getElementById(id);
// Background work (settings fetch after sign-out, etc.) must finish before a
// page is torn down, or it touches a closed window and fails for reasons that
// have nothing to do with the code under test.
const closeSoon = async dom => { await sleep(80); dom.window.close(); };
const shown = (w, id) => $(w, id).style.display !== 'none';

// A fake Firebase: a user store, a currentUser, and onAuthStateChanged-style
// events. Every sign-in builds a NEW user object (as the real SDK does), which
// is what makes the same account's sign-in event arrive twice in the recovery
// path.
function fakeFirebase(w, accounts, initial = true) {
  const log = { signOuts: 0, creates: 0, signIns: 0 };
  const mk = (email, uid) => ({ uid, email, getIdToken: async () => 'tok-' + uid,
    getIdTokenResult: async () => ({ claims: { auth_time: Math.floor(Date.now() / 1000) } }) });
  w.fbAuth = { currentUser: null };
  const announce = u => { w.fbAuth.currentUser = u; w.dispatchEvent(new w.CustomEvent('snow-auth', { detail: u })); };
  w.fbCreateUser = async (email, pass) => {
    log.creates++;
    if (w._fbFail) throw w._fbFail;
    if (accounts[email]) throw { code: 'auth/email-already-in-use' };
    accounts[email] = { pass, uid: 'uid-' + Object.keys(accounts).length };
    const u = mk(email, accounts[email].uid); announce(u); return { user: u };
  };
  w.fbSignIn = async (email, pass) => {
    log.signIns++;
    if (w._fbFail) throw w._fbFail;
    const a = accounts[email];
    if (!a || a.pass !== pass) throw { code: 'auth/invalid-credential' };
    const u = mk(email, a.uid); announce(u); return { user: u };
  };
  w.fbSignOut = async () => { log.signOuts++; announce(null); };
  // The real SDK reports the signed-out state once at startup; that event is
  // what takes the loading screen down on a fresh visit.
  if (initial) announce(null);
  return log;
}

// A fake backend behind fetch(): scripted per path.
function fakeServer(w, handle) {
  const calls = [];
  w.fetch = async (url, opts = {}) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, '');
    const body = opts.body ? JSON.parse(opts.body) : {};
    calls.push(path);
    let out = path.startsWith('/public/')
      ? { status: 200, body: { status: 'success', settings: w._settings || { referralRequired: false, otpVerificationEnabled: false }, products: [], image: null } }
      : await handle(path, body, opts);
    if (!out) out = { status: 200, body: { status: 'success' } };
    if (out.throws) throw new Error('network down');
    return { status: out.status, json: async () => out.body };
  };
  return calls;
}
const okAccount = { status: 'success', account: { phone: '+256771234567', walletBalance: 0, totalDeposited: 0, totalEarned: 0, totalWithdrawn: 0, totalInvested: 0, team: { l1: 0, l2: 0, l3: 0, commission: 0 } }, region: {} };
const toasts = w => { const t = []; w.notify = m => t.push(String(m)); return t; };

(async () => {
  // ─── 1. Firebase error wording: never developer text, always something to do ───
  trace('section 1');
  {
    const dom = load(), w = dom.window; await sleep(20);
    const f = e => w.fbErrMsg(e);
    eq(f({ code: 'auth/invalid-credential' }), 'Incorrect phone number or password.');
    eq(f({ code: 'auth/wrong-password' }), 'Incorrect phone number or password.');
    eq(f({ code: 'auth/user-not-found' }), 'No account found for that number.');
    eq(f({ code: 'auth/email-already-in-use' }), 'An account with that number already exists.');
    eq(f({ code: 'auth/too-many-requests' }), 'Too many attempts. Try again shortly.');
    ok(/Check your connection/.test(f({ code: 'auth/network-request-failed', message: 'Firebase: Error (auth/network-request-failed).' })), 'network failure is explained');
    ok(/disabled/.test(f({ code: 'auth/user-disabled' })), 'disabled account is explained');
    for (const code of ['auth/internal-error', 'auth/quota-exceeded', 'auth/operation-not-allowed', 'auth/invalid-api-key'])
      ok(/temporarily unavailable/.test(f({ code })), code + ' reads as a temporary outage');
    for (const e of [{ code: 'auth/something-new', message: 'Firebase: Error (auth/something-new).' }, { message: 'Firebase: Error (auth/x).' }])
      ok(!/Firebase|auth\//.test(f(e)), 'raw Firebase text never reaches a member: ' + f(e));
    eq(f({ message: 'Sign-in is not available right now.' }), 'Sign-in is not available right now.', 'our own messages pass through');
    eq(f(null), 'Something went wrong. Try again.');
    await closeSoon(dom);
  }

  // ─── 2. The sign-in service never loads: no dead spinner, no TypeError ───
  trace('section 2');
  {
    const dom = load(w => { w._FIREBASE_WATCHDOG_MS = 60; w._FIREBASE_READY_MS = 120; }), w = dom.window; await sleep(20);
    const t = toasts(w);
    await sleep(200);
    eq(shown(w, 'loadingScreen'), false, 'watchdog takes the spinner down');
    eq(shown(w, 'authScreen'), true, 'watchdog shows the login screen');
    // Timing-proof: whether the watchdog fired before or after toasts() swapped notify for a collector, the message is either recorded or on screen.
    ok(/Could not load the sign-in service/.test($(w, 'notifyMsg').textContent) || t.some(m => /Could not load the sign-in service/.test(m)), 'watchdog says what is wrong');
    $(w, 'loginPhone').value = '0771234567'; $(w, 'loginPassword').value = 'secret1';
    t.length = 0; await w.doLogin();
    eq(t.length, 1); ok(/not available right now/.test(t[0]) && !/not a function/.test(t[0]), 'login says so instead of throwing: ' + t[0]);
    eq($(w, 'loginBtn').disabled, false, 'login button usable again');
    eq($(w, 'loginBtn').textContent, 'Log In');
    $(w, 'regPhone').value = '0771234567'; $(w, 'regPassword').value = 'secret1'; $(w, 'regPassword2').value = 'secret1'; $(w, 'regReferral').value = 'abc';
    w._settings = { otpVerificationEnabled: false, referralRequired: false }; w.eval('STATE.settings={otpVerificationEnabled:false,referralRequired:false}');
    t.length = 0; await w.doRegister();
    ok(t.length === 1 && /not available right now/.test(t[0]), 'sign-up says so too: ' + t[0]);
    eq($(w, 'regBtn').disabled, false); eq($(w, 'regBtn').textContent, 'Register');
    await closeSoon(dom);
  }
  {
    // Firebase arriving LATE (slow network) is waited for, not failed.
    const dom = load(w => { w._FIREBASE_WATCHDOG_MS = 100000; w._FIREBASE_READY_MS = 2000; }), w = dom.window; await sleep(20);
    const t = toasts(w); const accounts = { '771234567@petro-platform.com': { pass: 'secret1', uid: 'u1' } };
    fakeServer(w, async p => p === '/account' ? { status: 200, body: okAccount } : null);
    $(w, 'loginPhone').value = '0771234567'; $(w, 'loginPassword').value = 'secret1';
    setTimeout(() => fakeFirebase(w, accounts, false), 300);
    await w.doLogin(); await sleep(50);
    eq(shown(w, 'app'), true, 'late Firebase: the app opened'); eq(shown(w, 'authScreen'), false);
    ok(!t.some(m => /not available/.test(m)), 'no error shown for a merely slow load');
    await closeSoon(dom);
  }
  {
    // A watchdog must not fire once Firebase is there.
    const dom = load(w => { w._FIREBASE_WATCHDOG_MS = 80; }), w = dom.window; await sleep(20);
    const t = toasts(w); fakeFirebase(w, {}, false);
    await sleep(140);
    ok(!t.some(m => /Could not load the sign-in service/.test(m)), 'no false alarm when Firebase loaded');
    await closeSoon(dom);
  }

  // ─── 3. Login: every outcome ends in "app open" or "login screen + message" ───
  trace('section 3');
  const phone = '0771234567', email = '771234567@petro-platform.com';
  async function loginScenario(setup, { expectOpen, expectMsg, expectSignOut = null }) {
    const dom = load(w => { w._FIREBASE_WATCHDOG_MS = 100000; }), w = dom.window; await sleep(20);
    const t = toasts(w);
    const accounts = { [email]: { pass: 'secret1', uid: 'u1' } };
    const log = fakeFirebase(w, accounts); await sleep(30);
    fakeServer(w, async (p, b) => (setup.server ? setup.server(p, b) : (p === '/account' ? { status: 200, body: okAccount } : null)));
    if (setup.fb) w._fbFail = setup.fb;
    $(w, 'loginPhone').value = phone; $(w, 'loginPassword').value = setup.pass || 'secret1';
    await w.doLogin(); await sleep(60);
    eq($(w, 'loginBtn').disabled, false, 'login button usable again');
    eq($(w, 'loginBtn').textContent, 'Log In');
    eq(shown(w, 'loadingScreen'), false, 'no stuck spinner');
    if (expectOpen) { eq(shown(w, 'app'), true, 'app open'); eq(shown(w, 'authScreen'), false); ok(t.some(m => /Login successful/.test(m)), 'says it worked'); }
    else { eq(shown(w, 'app'), false, 'app not open'); eq(shown(w, 'authScreen'), true, 'login screen showing'); ok(t.some(m => expectMsg.test(m)), 'tells the member why: ' + JSON.stringify(t)); }
    ok(!t.some(m => /Firebase|not a function|undefined|Session changed/.test(m)), 'no developer text: ' + JSON.stringify(t));
    if (expectSignOut !== null) eq(log.signOuts > 0, expectSignOut, 'signed-out state');
    await closeSoon(dom);
  }
  await loginScenario({}, { expectOpen: true });
  await loginScenario({ pass: 'wrong' }, { expectOpen: false, expectMsg: /Incorrect phone number or password/ });
  await loginScenario({ fb: { code: 'auth/network-request-failed' } }, { expectOpen: false, expectMsg: /Check your connection/ });
  await loginScenario({ fb: { code: 'auth/user-disabled' } }, { expectOpen: false, expectMsg: /disabled/ });
  await loginScenario({ fb: { code: 'auth/too-many-requests' } }, { expectOpen: false, expectMsg: /Too many attempts/ });
  await loginScenario({ fb: { code: 'auth/internal-error' } }, { expectOpen: false, expectMsg: /temporarily unavailable/ });
  await loginScenario({ server: async p => p === '/account' ? { status: 403, body: { status: 'error', code: 'BANNED', message: 'Account suspended. Contact customer service.' } } : null },
    { expectOpen: false, expectMsg: /suspended/, expectSignOut: true });
  await loginScenario({ server: async p => p === '/account' ? { throws: true } : null },
    { expectOpen: false, expectMsg: /Could not reach the server/, expectSignOut: true });
  await loginScenario({ server: async p => p === '/account' ? { status: 503, body: { status: 'error', code: 'AUTH_UNAVAILABLE', message: 'We could not check your sign-in just now. Please try again in a moment.' } } : null },
    { expectOpen: false, expectMsg: /try again in a moment/, expectSignOut: true });
  await loginScenario({ server: async p => p === '/account' ? { status: 500, body: { status: 'error', message: 'Could not load your account' } } : null },
    { expectOpen: false, expectMsg: /Could not load your account/, expectSignOut: true });

  // ─── 4. Sign-up that never finished (ghost account) is guided, not stranded ───
  trace('section 4');
  async function ghostScenario(regReply, expectMsg, expectGuided) {
    const dom = load(w => { w._FIREBASE_WATCHDOG_MS = 100000; }), w = dom.window; await sleep(20);
    const t = toasts(w);
    const accounts = { [email]: { pass: 'secret1', uid: 'g1' } };
    const log = fakeFirebase(w, accounts); await sleep(30);
    fakeServer(w, async p => p === '/account' ? { status: 404, body: { status: 'error', code: 'NOT_FOUND', message: 'User not found' } }
      : p === '/register' ? regReply : null);
    $(w, 'loginPhone').value = phone; $(w, 'loginPassword').value = 'secret1';
    await w.doLogin(); await sleep(80);
    eq(shown(w, 'loadingScreen'), false, 'no stuck spinner'); eq(shown(w, 'authScreen'), true, 'auth screen showing');
    eq(shown(w, 'app'), false);
    ok(t.some(m => expectMsg.test(m)), 'explains: ' + JSON.stringify(t));
    eq($(w, 'loginBtn').disabled, false);
    if (expectGuided) {
      eq($(w, 'registerPane').style.display, '', 'Sign Up pane opened'); eq($(w, 'loginPane').style.display, 'none');
      eq($(w, 'regPhone').value, '0771234567', 'number filled in for them');
      ok(log.signOuts > 0, 'signed out cleanly so Sign Up can finish the account');
      eq($(w, 'regBtn').disabled, false);
    }
    await closeSoon(dom);
  }
  await ghostScenario({ status: 400, body: { status: 'error', code: 'OTP_REQUIRED', message: 'Please verify your phone number first.' } }, /sign-up was not finished.*Verify your number/, true);
  await ghostScenario({ status: 400, body: { status: 'error', code: 'REFERRAL_REQUIRED', message: 'A referral code is required to sign up. Ask the person who invited you for theirs.' } }, /referral code is required.*Complete your sign-up/, true);
  await ghostScenario({ status: 400, body: { status: 'error', code: 'BAD_REFERRAL', message: 'That referral code does not exist.' } }, /does not exist.*Complete your sign-up/, true);
  await ghostScenario({ status: 500, body: { status: 'error', message: 'Could not complete your registration right now' } }, /Could not complete your registration/, false);

  // ─── 5. Sessions that change under a boot never sign the member out ───
  trace('section 5');
  {
    const dom = load(w => { w._FIREBASE_WATCHDOG_MS = 100000; }), w = dom.window; await sleep(20);
    const t = toasts(w); const log = fakeFirebase(w, {});
    w.eval('STATE.user={uid:"u1",email:"x@petro-platform.com"}');
    w.fbAuth.currentUser = { getIdToken: async () => 'tok' };
    ok(w.eval('_memberSession.begin("u1:1", Date.now(), true)'), 'session started');
    fakeServer(w, async p => p === '/account' ? { status: 200, body: okAccount } : null);
    // the epoch moves while /account is in flight (a second sign-in event)
    const base = w.fetch; w.fetch = async (...a) => { w.eval('STATE.authEpoch++'); return base(...a); };
    await w.bootFromNetwork('u1'); await sleep(20);
    eq(log.signOuts, 0, 'a superseded boot does not sign the member out'); ok(!t.some(m => /Session changed/.test(m)), 'and says nothing: ' + JSON.stringify(t));
    // a different member now owns the session: the old boot leaves quietly
    w.fetch = base; w.eval('STATE.user={uid:"u2",email:"y@petro-platform.com"}');
    await w.bootFromNetwork('u1'); eq(log.signOuts, 0); eq(t.length, 0);
    await closeSoon(dom);
  }

  // ─── 6. Sign-up: failures leave nothing behind; the recovery path opens the app once ───
  trace('section 6');
  {
    const dom = load(w => { w._FIREBASE_WATCHDOG_MS = 100000; }), w = dom.window; await sleep(20);
    const t = toasts(w); fakeFirebase(w, {});
    w.eval('STATE.settings={otpVerificationEnabled:false,referralRequired:false}');
    $(w, 'regPhone').value = '0771234567'; $(w, 'regPassword').value = 'secret1'; $(w, 'regPassword2').value = 'secret1';
    w._fbFail = { code: 'auth/network-request-failed', message: 'Firebase: Error (auth/network-request-failed).' };
    await w.doRegister();
    eq(w.eval('window._pendingRegPhone'), '', 'a failed sign-up stages nothing for the next sign-in');
    ok(t.length === 1 && /Check your connection/.test(t[0]) && !/Firebase/.test(t[0]), 'friendly message: ' + t[0]);
    eq($(w, 'regBtn').disabled, false); eq($(w, 'regBtn').textContent, 'Register');
    await closeSoon(dom);
  }
  {
    // First attempt fails at /register (bad referral) leaving a signed-in ghost;
    // the second takes the "already in use" recovery and must open the app --
    // with the sign-in event arriving a second time for the same account.
    const dom = load(w => { w._FIREBASE_WATCHDOG_MS = 100000; }), w = dom.window; await sleep(20);
    const t = toasts(w); const accounts = {}; const log = fakeFirebase(w, accounts);
    w._settings = { otpVerificationEnabled: false, referralRequired: true };
    w.eval('STATE.settings={otpVerificationEnabled:false,referralRequired:true}');
    let profile = false, registers = 0;
    fakeServer(w, async (p, b) => {
      if (p === '/register') { registers++; if (b.referralCode !== 'GOODCODE') return { status: 400, body: { status: 'error', code: 'BAD_REFERRAL', message: 'That referral code does not exist.' } }; profile = true; return { status: 200, body: { status: 'success' } }; }
      if (p === '/account') return profile ? { status: 200, body: okAccount } : { status: 404, body: { status: 'error', code: 'NOT_FOUND', message: 'User not found' } };
      return null;
    });
    $(w, 'regPhone').value = '0771234567'; $(w, 'regPassword').value = 'secret1'; $(w, 'regPassword2').value = 'secret1'; $(w, 'regReferral').value = 'WRONG';
    await w.doRegister(); await sleep(80);
    eq(shown(w, 'app'), false); eq(shown(w, 'authScreen'), true, 'bad code: back on the form');
    ok(t.some(m => /does not exist/.test(m)), 'says the code is wrong');
    eq($(w, 'regBtn').disabled, false, 'Register usable again');
    t.length = 0; $(w, 'regReferral').value = 'GOODCODE';
    await w.doRegister(); await sleep(150);
    eq(shown(w, 'app'), true, 'corrected code: app open'); eq(shown(w, 'authScreen'), false); eq(shown(w, 'loadingScreen'), false);
    eq(log.signOuts, 0, 'the recovery never signs the member out');
    ok(!t.some(m => /Session changed|went wrong|not a function/.test(m)), 'no stray errors: ' + JSON.stringify(t));
    ok(t.some(m => /Registration successful/.test(m)), 'says it worked');
    eq(w.eval('window._pendingRegPhone'), '', 'staged state cleared after success');
    await closeSoon(dom);
  }
  {
    // Plain sign-up success end to end.
    const dom = load(w => { w._FIREBASE_WATCHDOG_MS = 100000; }), w = dom.window; await sleep(20);
    const t = toasts(w); const log = fakeFirebase(w, {});
    w.eval('STATE.settings={otpVerificationEnabled:false,referralRequired:false}');
    let profile = false;
    fakeServer(w, async p => p === '/register' ? (profile = true, { status: 200, body: { status: 'success' } }) : p === '/account' ? (profile ? { status: 200, body: okAccount } : { status: 404, body: { status: 'error', code: 'NOT_FOUND' } }) : null);
    $(w, 'regPhone').value = '0771234567'; $(w, 'regPassword').value = 'secret1'; $(w, 'regPassword2').value = 'secret1';
    await w.doRegister(); await sleep(120);
    eq(shown(w, 'app'), true); eq(shown(w, 'authScreen'), false); eq(shown(w, 'loadingScreen'), false);
    ok(t.some(m => /Registration successful/.test(m)) && !t.some(m => /Login successful/.test(m)), 'sign-up toast, not login toast: ' + JSON.stringify(t));
    eq(log.signOuts, 0);
    await closeSoon(dom);
  }

  // ─── 7. Server: token checks distinguish "invalid" from "could not check" ───
  trace('section 7');
  {
    const src = fs.readFileSync(__dirname + '/server.js', 'utf8');
    const a = src.indexOf('const AUTH_CACHE_TTL_MS'), b = src.indexOf('async function verifyAuth(req)');
    const hookA = src.indexOf('app.use((req, res, next) => {\n  const send = res.json.bind(res);'), hookB = src.indexOf('app.use(cors({', hookA);
    const logoutA = src.indexOf("app.post('/auth/session/logout'"), logoutB = src.indexOf("app.post('/admin/session/activity'", logoutA);
    ok(a > 0 && b > a && hookA > 0 && hookB > hookA && logoutA > 0 && logoutB > logoutA, 'server markers found');
    const decodeSrc = src.slice(a, b), hookSrc = src.slice(hookA, hookB), logoutSrc = src.slice(logoutA, logoutB);
    function world(verify, check) {
      const state = { verifyCalls: 0, now: 1000000 };
      const admin = { auth: () => ({ verifyIdToken: async (tok, rev) => { state.verifyCalls++; assert.ok(rev === true, 'revocation is still checked'); return verify(tok, state.verifyCalls); } }) };
      const sessionPolicy = { checkMember: async (...x) => check(...x), memberKey: d => 'k-' + d.uid };
      const db = { collection: () => ({ doc: () => ({ update: async () => { if (state.noDoc) { const e = new Error('no doc'); e.code = 'NOT_FOUND'; throw e; } } }) }) };
      const Date2 = { now: () => state.now };
      const mod = new Function('admin', 'sessionPolicy', 'db', 'Date', 'console', 'setTimeout',
        decodeSrc + '\nconst fn = {_decodeAuth, isTransientAuthError, cache:_authTokenCache, TTL:AUTH_CACHE_TTL_MS, MAX:AUTH_CACHE_MAX};\n' +
        'const logoutHandler = ' + logoutSrc.replace(/^app\.post\('\/auth\/session\/logout', /, '').replace(/\);\s*$/, '') + ';\nreturn {fn, logoutHandler};')(
        admin, sessionPolicy, db, Date2, { error() {} }, f => setTimeout(f, 1));
      return { ...mod, state };
    }
    const req = (tok, path = '/account') => ({ headers: { authorization: 'Bearer ' + tok }, path });
    const res = () => { const r = { statusCode: 200, status(c) { r.statusCode = c; return r; }, json(b) { r.body = b; return r; } }; return r; };
    const hook = () => { let installed; const fakeApp = { use: f => { installed = f; } }; new Function('app', hookSrc)(fakeApp); return installed; };
    const through = (h, rq, rs) => new Promise(done => h(rq, rs, done));

    // valid + cached
    let W = world((t) => ({ uid: 'u1', auth_time: 1, exp: 2000 }), async () => true);
    let d = await W.fn._decodeAuth(req('A')); eq(d.uid, 'u1'); eq(W.state.verifyCalls, 1);
    d = await W.fn._decodeAuth(req('A')); eq(W.state.verifyCalls, 1, 'second request within the TTL reuses the check');
    W.state.now += W.fn.TTL + 1; d = await W.fn._decodeAuth(req('A')); eq(W.state.verifyCalls, 2, 'asks Google again after the TTL');
    await W.fn._decodeAuth(req('B')); eq(W.state.verifyCalls, 3, 'another token is checked on its own');
    // the cache never bypasses our own session store (logout is immediate)
    let live = true; W = world(() => ({ uid: 'u1', auth_time: 1, exp: 99999 }), async () => live);
    ok(await W.fn._decodeAuth(req('A')), 'valid'); live = false;
    eq(await W.fn._decodeAuth(req('A')), null, 'after sign-out the cached token no longer passes'); eq(W.state.verifyCalls, 1);
    // definitive failures: plain 401, no retry
    for (const err of [{ code: 'auth/id-token-expired' }, { code: 'auth/id-token-revoked' }, { code: 'auth/argument-error', message: 'Decoding Firebase ID token failed' }, { message: 'Firebase ID token has invalid signature' }]) {
      W = world(() => { throw Object.assign(new Error(err.message || 'x'), err); }, async () => true);
      const rq = req('A'); eq(await W.fn._decodeAuth(rq), null); eq(W.state.verifyCalls, 1, 'no retry for ' + (err.code || err.message)); ok(!rq._authTransient, 'not flagged transient');
      const rs = res(), h = hook(); rs.status(401); await through(h, rq, rs); rs.json({ status: 'error', message: 'Unauthorized' });
      eq(rs.statusCode, 401, 'stays a 401'); eq(rs.body.message, 'Unauthorized');
    }
    // transient then success: the member never notices
    W = world((t, n) => { if (n === 1) throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }); return { uid: 'u1', auth_time: 1, exp: 99999 }; }, async () => true);
    let rq = req('A'); d = await W.fn._decodeAuth(rq); eq(d.uid, 'u1', 'one retry rescues a dropped connection'); eq(W.state.verifyCalls, 2); ok(!rq._authTransient);
    // transient twice: 503 AUTH_UNAVAILABLE instead of 401
    W = world(() => { throw Object.assign(new Error('network error'), { code: 'app/network-error' }); }, async () => true);
    rq = req('A'); eq(await W.fn._decodeAuth(rq), null); eq(W.state.verifyCalls, 2, 'retried exactly once'); ok(rq._authTransient, 'flagged transient');
    let rs = res(), h = hook(); rs.status(401); await through(h, rq, rs); rs.json({ status: 'error', message: 'Unauthorized' });
    eq(rs.statusCode, 503, 'answered 503, so the app does not end the session'); eq(rs.body.code, 'AUTH_UNAVAILABLE');
    ok(!/401|expired|rejected/i.test(rs.body.message), 'message does not say logged out');
    // the same hook leaves other responses alone
    rs = res(); await through(h, req('A'), rs); rs.status(400); rs.json({ status: 'error', message: 'Bad input' }); eq(rs.statusCode, 400); eq(rs.body.message, 'Bad input');
    rs = res(); await through(h, { headers: {}, path: '/x' }, rs); rs.status(401); rs.json({ status: 'error', message: 'Unauthorized' }); eq(rs.statusCode, 401, 'ordinary 401 untouched');
    // session store unreadable: not "your session is invalid"
    W = world(() => ({ uid: 'u1', auth_time: 1, exp: 99999 }), async () => { throw new Error('mongo down'); });
    rq = req('A'); eq(await W.fn._decodeAuth(rq), null); ok(rq._authTransient, 'store failure is flagged transient');
    // a session the store says is invalid is a real 401
    W = world(() => ({ uid: 'u1', auth_time: 1, exp: 99999 }), async () => false);
    rq = req('A'); eq(await W.fn._decodeAuth(rq), null); ok(!rq._authTransient, 'invalid/expired session is a plain 401');
    // classifier
    for (const e of [{ code: 'ETIMEDOUT' }, { code: 'EAI_AGAIN' }, { code: 'auth/internal-error' }, { message: 'fetch failed' }, { message: 'Request timed out' }, { code: 'auth/quota-exceeded' }])
      ok(W.fn.isTransientAuthError(e), 'transient: ' + JSON.stringify(e));
    for (const e of [{ code: 'auth/id-token-expired' }, { message: 'Firebase ID token has expired. network' }, { message: 'invalid signature' }, null, {}])
      ok(!W.fn.isTransientAuthError(e), 'not transient: ' + JSON.stringify(e));
    // cache is bounded
    W = world((t) => ({ uid: t, auth_time: 1, exp: 99999 }), async () => true);
    for (let i = 0; i < W.fn.MAX + 50; i++) await W.fn._decodeAuth(req('t' + i));
    ok(W.fn.cache.size <= W.fn.MAX, 'token cache cannot grow without bound');
    // logout always answers
    for (const noDoc of [false, true]) {
      W = world(() => ({ uid: 'u1', auth_time: 1, exp: 99999 }), async () => true); W.state.noDoc = noDoc;
      rs = res(); await W.logoutHandler(req('A', '/auth/session/logout'), rs);
      eq(rs.body && rs.body.status, 'success', 'logout answers even when the session record is missing=' + noDoc);
    }
  }
  // ─── 8. A phone clock stepping back a little never signs a member out ───
  trace('section 8');
  {
    const dom = load(w => { w._FIREBASE_WATCHDOG_MS = 100000; }), w = dom.window; await sleep(20);
    const t = toasts(w); fakeFirebase(w, {}, false);
    const real = w.Date.now; let offset = 0; w.Date.now = () => real.call(w.Date) + offset;
    const begin = () => w.eval('_memberSession.begin("u1:1", Date.now(), true)');
    ok(begin(), 'session started');
    for (const back of [1000, 5000, 30000, 59000]) {
      ok(begin(), 'restarted'); offset = -back;
      ok(w.eval('_memberSession.check()'), 'still signed in after the clock steps back ' + back + 'ms');
      offset = 0;
    }
    ok(begin(), 'restarted'); offset = -61 * 1000;
    eq(w.eval('_memberSession.check()'), false, 'a backward jump beyond the 60 second limit still ends the session');
    ok(t.some(m => /session ended/i.test(m)), 'and says so');
    offset = 0; ok(begin(), 'restarted');
    offset = 61 * 60 * 1000; eq(w.eval('_memberSession.check()'), false, 'an hour of genuine inactivity still ends it');
    await closeSoon(dom);
  }
  console.log('PASS: login and sign-up wiring (' + checks + ' checks' + (built ? ', built bundle' : ', source') + ')');
  process.exit(0); // the pages' own timers would otherwise keep node alive
})().catch(e => { console.error(e); process.exit(1); });
