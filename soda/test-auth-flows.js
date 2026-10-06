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
    const path = String(url).replace(/^https?:\/\/[^/]+/, '').replace(/^\/api(?=\/)/, '');
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
  // ─── 0. Auth screens use the approved blue frosted-card design ───
  trace('auth design');
  {
    const htmlPath = __dirname + '/user' + (built ? '' : '-src') + '/index.html';
    const html = fs.readFileSync(htmlPath, 'utf8');
    const admin = fs.readFileSync(__dirname + '/admin-src/index.html', 'utf8');
    const server = fs.readFileSync(__dirname + '/server.js', 'utf8');
    ok(/rgba\(255,255,255,calc\(var\(--auth-card-opacity,\.78\)/.test(html), 'auth card tint stays adjustable');
    ok(/backdrop-filter:blur\(var\(--auth-card-blur,18px\)\)/.test(html), 'auth card blur stays adjustable');
    ok(html.includes('id="authHeroBg"') && html.includes('id="loginHeading">Login'), 'login uses the full-screen uploaded image and reference heading');
    ok(html.includes('id="registerHeading">Sign Up'), 'registration uses the reference heading');
    ok(html.includes('id="regTradePin"') && !html.includes('id="regOtpRow"') && !html.includes('id="regOtp"'), 'registration matches screenshot fields and has no OTP field');
    ok(!html.includes('id="lsPercent"') && !html.includes('class="ring-loader"'), 'startup loading animation is removed');
    ok(admin.includes('id="authCardOp"') && admin.includes('id="authCardBlur"'), 'admin exposes card opacity and blur controls');
    ok(!admin.includes('id="sOtpReg"'), 'admin no longer exposes a registration OTP setting');
    const registerRoute = server.slice(server.indexOf("app.post('/register'"), server.indexOf("app.get('/account'", server.indexOf("app.post('/register'")));
    ok(registerRoute && !registerRoute.includes('consumeOtpTicket') && registerRoute.includes('INVALID_TRADE_PIN'), 'server registration accepts no OTP and validates the trade PIN');
    ok(/update\.transactionPinHash\s*=\s*scryptHash\(tradePin\)/.test(server), 'server saves only a hash of the new trade PIN');
    const dom = load(), w = dom.window;
    w.eval("STATE.settings={authHeroOpacity:60,authHeroBlur:8,authCardOpacity:25,authCardBlur:3};STATE.authHeroImage='data:image/png;base64,AA==';applyAuthBackgrounds()");
    eq(w.document.documentElement.style.getPropertyValue('--auth-hero-op'), '0.6', 'background opacity reaches the screen');
    eq(w.document.documentElement.style.getPropertyValue('--auth-hero-blur'), '8px', 'background blur reaches the screen');
    eq(w.document.documentElement.style.getPropertyValue('--auth-card-opacity'), '0.25', 'card opacity reaches the glass layer');
    eq(w.document.documentElement.style.getPropertyValue('--auth-card-blur'), '3px', 'card blur reaches the glass layer');
    ok(w.document.querySelectorAll('.va-card svg').length >= 4, 'auth card icons remain inline SVGs');
    ok(!/Forgot Password\?|forgotPane|togglePw|af-eye|doForgot/.test(html), 'no Forgot Password and no password eye (owner screenshots)');
    ok(html.includes('id="rememberMe"') && html.includes('Remember me'), 'Remember me checkbox is on the login card');
    ok(!/id="[a-z]+BrandFallback"|>P<\/span>/.test(html), 'no placeholder letter on the auth screens');
    await closeSoon(dom);
  }

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
    $(w, 'regPhone').value = '0771234567'; $(w, 'regPassword').value = 'secret1'; $(w, 'regPassword2').value = 'secret1'; $(w, 'regTradePin').value = '123456'; $(w, 'regReferral').value = 'abc';
    w._settings = { otpVerificationEnabled: false, referralRequired: false }; w.eval('STATE.settings={otpVerificationEnabled:false,referralRequired:false}');
    t.length = 0; await w.doRegister();
    ok(t.length === 1 && /not available right now/.test(t[0]), 'sign-up says so too: ' + t[0]);
    eq($(w, 'regBtn').disabled, false); eq($(w, 'regBtn').textContent, 'Sign Up');
    await closeSoon(dom);
  }
  {
    // Firebase arriving LATE (slow network) is waited for, not failed.
    const dom = load(w => { w._FIREBASE_WATCHDOG_MS = 100000; w._FIREBASE_READY_MS = 2000; }), w = dom.window; await sleep(20);
    const t = toasts(w); const accounts = { '771234567@soda-platform.com': { pass: 'secret1', uid: 'u1' } };
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
  const phone = '0771234567', email = '771234567@soda-platform.com';
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
  await ghostScenario({ status: 400, body: { status: 'error', code: 'REFERRAL_REQUIRED', message: 'A referral code is required to sign up. Ask the person who invited you for theirs.' } }, /referral code is required.*Complete your sign-up/, true);
  await ghostScenario({ status: 400, body: { status: 'error', code: 'BAD_REFERRAL', message: 'That referral code does not exist.' } }, /does not exist.*Complete your sign-up/, true);
  await ghostScenario({ status: 500, body: { status: 'error', message: 'Could not complete your registration right now' } }, /Could not complete your registration/, false);

  // ─── 5. Sessions that change under a boot never sign the member out ───
  trace('section 5');
  {
    const dom = load(w => { w._FIREBASE_WATCHDOG_MS = 100000; }), w = dom.window; await sleep(20);
    const t = toasts(w); const log = fakeFirebase(w, {});
    w.eval('STATE.user={uid:"u1",email:"x@soda-platform.com"}');
    w.fbAuth.currentUser = { getIdToken: async () => 'tok' };
    ok(w.eval('_memberSession.begin("u1:1", Date.now(), true)'), 'session started');
    fakeServer(w, async p => p === '/account' ? { status: 200, body: okAccount } : null);
    // the epoch moves while /account is in flight (a second sign-in event)
    const base = w.fetch; w.fetch = async (...a) => { w.eval('STATE.authEpoch++'); return base(...a); };
    await w.bootFromNetwork('u1'); await sleep(20);
    eq(log.signOuts, 0, 'a superseded boot does not sign the member out'); ok(!t.some(m => /Session changed/.test(m)), 'and says nothing: ' + JSON.stringify(t));
    // a different member now owns the session: the old boot leaves quietly
    w.fetch = base; w.eval('STATE.user={uid:"u2",email:"y@soda-platform.com"}');
    await w.bootFromNetwork('u1'); eq(log.signOuts, 0); eq(t.length, 0);
    await closeSoon(dom);
  }
  {
    const dom = load(w => { w._FIREBASE_WATCHDOG_MS = 100000; }), w = dom.window; await sleep(20);
    const t = toasts(w), log = fakeFirebase(w, {});
    w.eval('STATE.settings={otpVerificationEnabled:true,referralRequired:false}');
    $(w, 'regPhone').value = '0771234567'; $(w, 'regPassword').value = 'secret1'; $(w, 'regPassword2').value = 'secret1'; $(w, 'regTradePin').value = '12x';
    await w.doRegister();
    eq(log.creates, 0, 'invalid trade PIN cannot create an account');
    ok(t.some(m => /Trade Password must be exactly 6 digits/.test(m)), 'trade PIN validation is clear');
    await closeSoon(dom);
  }

  // ─── 6. Sign-up: failures leave nothing behind; the recovery path opens the app once ───
  trace('section 6');
  {
    const dom = load(w => { w._FIREBASE_WATCHDOG_MS = 100000; }), w = dom.window; await sleep(20);
    const t = toasts(w); fakeFirebase(w, {});
    w.eval('STATE.settings={otpVerificationEnabled:false,referralRequired:false}');
    $(w, 'regPhone').value = '0771234567'; $(w, 'regPassword').value = 'secret1'; $(w, 'regPassword2').value = 'secret1'; $(w, 'regTradePin').value = '123456';
    w._fbFail = { code: 'auth/network-request-failed', message: 'Firebase: Error (auth/network-request-failed).' };
    await w.doRegister();
    eq(w.eval('window._pendingRegPhone'), '', 'a failed sign-up stages nothing for the next sign-in');
    ok(t.length === 1 && /Check your connection/.test(t[0]) && !/Firebase/.test(t[0]), 'friendly message: ' + t[0]);
    eq($(w, 'regBtn').disabled, false); eq($(w, 'regBtn').textContent, 'Sign Up');
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
    $(w, 'regPhone').value = '0771234567'; $(w, 'regPassword').value = 'secret1'; $(w, 'regPassword2').value = 'secret1'; $(w, 'regTradePin').value = '123456'; $(w, 'regReferral').value = 'WRONG';
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
    w.eval('STATE.settings={otpVerificationEnabled:true,referralRequired:false}');
    let profile = false;
    const calls = fakeServer(w, async (p, b) => p === '/register' ? (profile = true, eq(b.pin, '123456', 'trade PIN is sent for registration'), ok(!Object.hasOwn(b, 'otpTicket'), 'registration sends no OTP ticket'), { status: 200, body: { status: 'success' } }) : p === '/account' ? (profile ? { status: 200, body: okAccount } : { status: 404, body: { status: 'error', code: 'NOT_FOUND' } }) : null);
    $(w, 'regPhone').value = '0771234567'; $(w, 'regPassword').value = 'secret1'; $(w, 'regPassword2').value = 'secret1'; $(w, 'regTradePin').value = '123456';
    await w.doRegister(); await sleep(120);
    eq(shown(w, 'app'), true); eq(shown(w, 'authScreen'), false); eq(shown(w, 'loadingScreen'), false);
    ok(t.some(m => /Registration successful/.test(m)) && !t.some(m => /Login successful/.test(m)), 'sign-up toast, not login toast: ' + JSON.stringify(t));
    eq(log.signOuts, 0);
    ok(!calls.some(p => p.startsWith('/auth/otp/')), 'registration sends no OTP requests even when the setting is enabled');
    await closeSoon(dom);
  }

  // ─── 7. Server: "could not check" is a 503 "try again", never a 401 "logged out" ───
  // (The login itself -- signup, login, lockout, sessions, password change -- is
  // covered end to end by test-member-auth.js.)
  trace('section 7');
  {
    const src = fs.readFileSync(__dirname + '/server.js', 'utf8');
    const hookA = src.indexOf('app.use((req, res, next) => {\n  const send = res.json.bind(res);'), hookB = src.indexOf('app.use(cors({', hookA);
    const logoutA = src.indexOf("app.post('/auth/session/logout'"), logoutB = src.indexOf("app.post('/admin/session/activity'", logoutA);
    ok(hookA > 0 && hookB > hookA && logoutA > 0 && logoutB > logoutA, 'server markers found');
    const hookSrc = src.slice(hookA, hookB), logoutSrc = src.slice(logoutA, logoutB);
    const res = () => { const r = { statusCode: 200, status(c) { r.statusCode = c; return r; }, json(b) { r.body = b; return r; } }; return r; };
    const hook = () => { let installed; const fakeApp = { use: f => { installed = f; } }; new Function('app', hookSrc)(fakeApp); return installed; };
    const through = (h, rq, rs) => new Promise(done => h(rq, rs, done));
    // the session store could not be read: the 401 is rewritten to a 503
    let rq = { headers: {}, path: '/account', _authTransient: true }, rs = res(), h = hook();
    rs.status(401); await through(h, rq, rs); rs.json({ status: 'error', message: 'Unauthorized' });
    eq(rs.statusCode, 503, 'answered 503, so the app does not end the session'); eq(rs.body.code, 'AUTH_UNAVAILABLE');
    ok(!/401|expired|rejected/i.test(rs.body.message), 'message does not say logged out');
    // a genuinely invalid session stays a plain 401, other statuses are left alone
    rs = res(); await through(h, { headers: {}, path: '/x' }, rs); rs.status(401); rs.json({ status: 'error', message: 'Unauthorized' }); eq(rs.statusCode, 401, 'ordinary 401 untouched');
    rs = res(); await through(h, { headers: {}, path: '/x', _authTransient: true }, rs); rs.status(400); rs.json({ status: 'error', message: 'Bad input' }); eq(rs.statusCode, 400); eq(rs.body.message, 'Bad input');
    // logout always answers, whether or not the session record still exists
    for (const noDoc of [false, true]) {
      const db = { collection: () => ({ doc: () => ({ update: async () => { if (noDoc) { const e = new Error('no doc'); e.code = 'NOT_FOUND'; throw e; } } }) }) };
      const handler = new Function('db', '_decodeAuth', 'console', 'return ' + logoutSrc.replace(/^app\.post\('\/auth\/session\/logout', /, '').replace(/\);\s*$/, ''))(db, async () => ({ key: 'k1', uid: 'u1' }), { error() {} });
      rs = res(); await handler({ headers: { authorization: 'Bearer abc' }, path: '/auth/session/logout' }, rs);
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
    offset = 4 * 60 * 60 * 1000 + 60000; eq(w.eval('_memberSession.check()'), false, 'four hours of genuine inactivity still ends it');
    await closeSoon(dom);
  }
  console.log('PASS: login and sign-up wiring (' + checks + ' checks' + (built ? ', built bundle' : ', source') + ')');
  process.exit(0); // the pages' own timers would otherwise keep node alive
})().catch(e => { console.error(e); process.exit(1); });
