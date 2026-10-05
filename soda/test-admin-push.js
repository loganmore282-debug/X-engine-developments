'use strict';
// Admin push notifications, end to end where it can be done offline:
//   1. server.js: how alerts are sent (data-only, per-device owner secret),
//      how a device registers, and the quick-approve route's credential checks
//   2. admin/sw.js: what is shown, the Approve button, what a tap does
//   3. the admin page: foreground alerts, jumping to a tab, enabling, upgrading
// The real source is extracted/evaluated each time -- nothing is re-implemented
// here. Run with --built to test the built admin bundle for part 3.
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const zlib = require('node:zlib');
const { JSDOM, VirtualConsole } = require('jsdom');
const built = process.argv.includes('--built');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let checks = 0;
const ok = (c, m) => { checks++; assert.ok(c, m); };
// Compared by value: objects made inside the sandboxed service worker have a
// different Array/Object prototype, which a strict deep-equal would reject.
const plain = v => JSON.parse(JSON.stringify(v === undefined ? null : v));
const eq = (a, b, m) => { checks++; assert.deepEqual(plain(a), plain(b), m); };
const trace = m => { if (process.env.PUSH_TEST_TRACE) console.error('· ' + m); };

// ───────────────────────── 1. server.js ─────────────────────────
const src = fs.readFileSync(__dirname + '/server.js', 'utf8');
const slice = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i + 1); assert.ok(i > 0 && j > i, 'markers: ' + a.slice(0, 40)); return src.slice(i, j); };

function fakeDb(seed = {}) {
  const store = new Map(Object.entries(seed).map(([k, v]) => [k, new Map(Object.entries(v))]));
  const col = n => { if (!store.has(n)) store.set(n, new Map()); return store.get(n); };
  const snap = (id, v) => ({ id, exists: v !== undefined, data: () => (v === undefined ? undefined : JSON.parse(JSON.stringify(v))) });
  return { store, collection: n => ({
    get: async () => ({ empty: col(n).size === 0, docs: [...col(n)].map(([id, v]) => snap(id, v)) }),
    doc: id => ({ get: async () => snap(id, col(n).get(id)), set: async v => { col(n).set(id, JSON.parse(JSON.stringify(v, (k, x) => (x && x.__sv ? 'SERVER_TS' : x)))); },
      delete: async () => { col(n).delete(id); } }),
  }) };
}
const FieldValue = { serverTimestamp: () => ({ __sv: 1 }) };

async function serverTests() {
  trace('server');
  // ── how alerts are sent ──
  const sendSrc = slice('const ADMIN_PUSH_HEADERS', 'function scryptHash(password) {');
  async function send(tokens, title, body, data, opts) {
    const db = fakeDb({ adminPushTokens: tokens }); const sent = []; const failWith = {};
    const admin = { messaging: () => ({ sendEach: async msgs => { sent.push(msgs);
      return { responses: msgs.map(m => failWith[m.token] ? { success: false, error: { code: failWith[m.token] } } : { success: true }) }; } }) };
    const fn = new Function('db', 'admin', 'console', 'tsMillis', sendSrc + '\nreturn sendAdminPush;')(db, admin, { warn() {} }, v => new Date(v).getTime());
    return { run: () => fn(title, body, data, opts), sent, db, failWith };
  }
  let t = await send({
    ownerA: { role: 'owner', quickApproveSecret: 'secret-A', username: 'boss' },
    ownerNoSecret: { role: 'owner' }, staff1: { role: 'staff', username: 'clerk' }, legacy: { token: 'legacy' },
    staffLeak: { role: 'staff', quickApproveSecret: 'leak-secret', username: 'clerk2' },
  }, 'New withdrawal request', 'UGX 5,000 requested via MTN', { type: 'withdrawal', withdrawalId: 'W1' }, { quickApprove: true });
  await t.run();
  const byTok = Object.fromEntries(t.sent.flat().map(m => [m.token, m]));
  eq(Object.keys(byTok).sort(), ['legacy', 'ownerA', 'ownerNoSecret', 'staff1', 'staffLeak'], 'every device is addressed');
  for (const m of Object.values(byTok)) {
    ok(!('notification' in m), 'data-only: no notification block, so the SDK cannot show a second copy');
    eq(m.data.title, 'New withdrawal request'); eq(m.data.body, 'UGX 5,000 requested via MTN');
    eq(m.data.type, 'withdrawal'); eq(m.data.withdrawalId, 'W1');
    eq(m.webpush.headers, { Urgency: 'high', TTL: '7200' }, 'delivered promptly, expires if unseen');
    ok(Object.values(m.data).every(v => typeof v === 'string'), 'FCM data values are all strings');
  }
  eq([byTok.ownerA.data.quickApprove, byTok.ownerA.data.pushToken, byTok.ownerA.data.secret], ['1', 'ownerA', 'secret-A'], 'an owner device gets ITS OWN token and secret');
  for (const k of ['ownerNoSecret', 'staff1', 'legacy', 'staffLeak']) ok(!('quickApprove' in byTok[k].data) && !('secret' in byTok[k].data) && !('pushToken' in byTok[k].data), k + ' never receives an approval credential');
  ok(!JSON.stringify(byTok.staff1).includes('secret-A') && !JSON.stringify(byTok.legacy).includes('secret-A'), "one device's secret never reaches another device");
  // no quickApprove option: nobody gets a credential (deposit alerts)
  t = await send({ ownerA: { role: 'owner', quickApproveSecret: 'secret-A' } }, 'Deposit completed', 'x', { type: 'deposit', depositId: 'D1' });
  await t.run(); ok(!('secret' in t.sent[0][0].data), 'only withdrawal alerts can carry the button');
  // dead tokens are pruned, live ones kept, a failure never throws
  t = await send({ live: { role: 'staff' }, dead: { role: 'staff' }, bad: { role: 'staff' } }, 'T', 'B', {});
  t.failWith.dead = 'messaging/registration-token-not-registered'; t.failWith.bad = 'messaging/invalid-registration-token';
  await t.run(); eq([...t.db.store.get('adminPushTokens').keys()], ['live'], 'unregistered tokens are removed');
  t = await send({}, 'T', 'B', {}); await t.run(); eq(t.sent.length, 0, 'no devices, nothing sent');
  const boom = new Function('db', 'admin', 'console', sendSrc + '\nreturn sendAdminPush;')({ collection: () => ({ get: async () => { throw new Error('mongo'); } }) }, {}, { warn() {} });
  await boom('a', 'b'); ok(true, 'a failure to send never throws into a payment path');
  // more than 500 devices are chunked
  const many = {}; for (let i = 0; i < 1203; i++) many[`t${i}`] = { role: 'staff' };
  t = await send(many, 'T', 'B', {}); await t.run(); eq(t.sent.map(c => c.length), [500, 500, 203], 'sent in batches of 500');

  // ── registration ──
  const regSrc = slice("app.post('/admin/push/register'", "app.post('/admin/push/unregister'");
  async function register({ owner, token, username, db, body }) {
    const handlers = {}; const app = { post: (p, h) => { handlers[p] = h; } };
    const verifyAdmin = () => true, verifyOwner = () => owner;
    new Function('app', 'verifyAdmin', 'verifyOwner', 'db', 'FieldValue', 'crypto', regSrc)(app, verifyAdmin, verifyOwner, db, FieldValue, crypto);
    const res = { code: 200, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await handlers['/admin/push/register']({ body: body || { token }, adminUser: username ? { username, role: owner ? 'owner' : 'staff' } : undefined }, res);
    return res;
  }
  let db = fakeDb(); let r = await register({ owner: true, token: 'devA', username: 'boss', db });
  eq(r.body, { status: 'success', quickApprove: true }); let rec = db.store.get('adminPushTokens').get('devA');
  eq([rec.role, rec.username], ['owner', 'boss']); ok(/^[0-9a-f-]{36}$/.test(rec.quickApproveSecret), 'owner device gets a random secret');
  ok(!JSON.stringify(r.body).includes(rec.quickApproveSecret), 'the secret is never returned to the page');
  const first = rec.quickApproveSecret; await register({ owner: true, token: 'devA', username: 'boss', db });
  eq(db.store.get('adminPushTokens').get('devA').quickApproveSecret, first, 'secret survives re-registration');
  r = await register({ owner: false, token: 'devA', username: 'clerk', db });
  eq(r.body.quickApprove, false); rec = db.store.get('adminPushTokens').get('devA');
  eq(rec.role, 'staff'); ok(!('quickApproveSecret' in rec), 'a device that becomes staff LOSES its secret');
  r = await register({ owner: true, token: 'devB', username: undefined, db }); eq(db.store.get('adminPushTokens').get('devB').username, 'owner-key', 'master-key owner recorded as owner-key');
  r = await register({ owner: true, token: '', db }); eq(r.code, 400); r = await register({ owner: true, token: 'x'.repeat(5000), db }); eq(r.code, 400);

  // retired tokens get no new alerts, expired retired ones are purged
  t = await send({ live: { role: 'owner', quickApproveSecret: 'A' }, retiredNow: { role: 'owner', quickApproveSecret: 'B', retiredAt: new Date().toISOString() },
    retiredOld: { role: 'owner', quickApproveSecret: 'C', retiredAt: new Date(Date.now() - 60 * 3600 * 1000).toISOString() } }, 'New withdrawal request', 'x', { type: 'withdrawal', withdrawalId: 'W5' }, { quickApprove: true });
  await t.run();
  eq(t.sent.flat().map(m => m.token), ['live'], 'a rotated (retired) token gets no alert, so no duplicates');
  await sleep(10); eq([...t.db.store.get('adminPushTokens').keys()].sort(), ['live', 'retiredNow'], 'a retired token past its grace is purged');
  // unregister: rotation retires, switching off deletes
  const unregSrc = slice("app.post('/admin/push/unregister'", '// Real bug fixed: owner reported the SAME push notification');
  async function unreg(body, seedTok) {
    const store = new Map([[seedTok, { role: 'owner' }]]); let handler; const app = { post: (p, h) => { if (p === '/admin/push/unregister') handler = h; } };
    const db = { collection: () => ({ doc: id => ({ get: async () => ({ exists: store.has(id) }), update: async d => { store.set(id, { ...store.get(id), ...d }); }, delete: async () => { store.delete(id); } }) }) };
    new Function('app', 'db', 'verifyAdmin', unregSrc)(app, db, () => true);
    const r = { code: 200, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } }; await handler({ body }, r); return { r, store };
  }
  let u = await unreg({ token: 'T1', rotated: true }, 'T1'); ok(u.store.has('T1') && u.store.get('T1').retiredAt, 'rotation keeps the record, retired');
  u = await unreg({ token: 'T1' }, 'T1'); ok(!u.store.has('T1'), 'switching notifications off deletes it at once');
  // ── quick-approve ──
  const qaSrc = slice('const quickApproveLimiter', "app.post('/admin/withdraw/verify'");
  function quickApprove(dbSeed) {
    const handlers = {}; const calls = { core: [], audit: [] };
    const app = { post: (p, ...a) => { handlers[p] = a[a.length - 1]; } };
    const safeEqual = (a, b) => { const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || '')); return x.length === y.length && crypto.timingSafeEqual(x, y); };
    const db = fakeDb(dbSeed);
    new Function('app', 'rateLimit', 'db', 'safeEqual', 'processWithdrawalCore', 'logAdminAction', 'console', 'pushRetiredExpired', qaSrc)(
      app, () => (q, s, n) => n(), db, safeEqual, async (id, by) => { calls.core.push([id, by]); return { code: 200, body: { status: 'success', message: 'Sending UGX 4,000 to 0771' }, meta: { amount: 4000 } }; },
      (rq, action, meta) => calls.audit.push([rq.adminUser, action, meta]), { error() {} }, t => !!t.retiredAt && Date.now() - new Date(t.retiredAt).getTime() > 48 * 3600 * 1000);
    return { calls, db, call: async body => { const res = { code: 200, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } }; await handlers['/admin/withdraw/quick-approve']({ body, ip: '1.2.3.4' }, res); return res; } };
  }
  const seed = { adminPushTokens: { good: { role: 'owner', quickApproveSecret: 'S3CRET', username: 'boss' }, key: { role: 'owner', quickApproveSecret: 'KS', username: 'owner-key' }, masterSession: { role: 'owner', quickApproveSecret: 'MS', username: 'owner' },
    staff: { role: 'staff', username: 'clerk' }, staffSecret: { role: 'staff', quickApproveSecret: 'SS', username: 'boss' }, demoted: { role: 'owner', quickApproveSecret: 'D', username: 'ex' }, gone: { role: 'owner', quickApproveSecret: 'G', username: 'ghost' }, off: { role: 'owner', quickApproveSecret: 'O', username: 'off' } },
    adminUsers: { boss: { role: 'owner', active: true }, ex: { role: 'staff', active: true }, off: { role: 'owner', active: false } } };
  let q = quickApprove(seed);
  let res = await q.call({ withdrawalId: 'W9', pushToken: 'good', secret: 'S3CRET' });
  eq(res.code, 200); eq(q.calls.core, [['W9', 'boss (notification)']], 'goes through the same processWithdrawalCore as the Send button, named for the person');
  eq([q.calls.audit[0][1], q.calls.audit[0][2].via, q.calls.audit[0][0].username], ['withdrawal_processed', 'push', 'boss'], 'audit-logged as a push approval by that admin');
  q = quickApprove(seed); res = await q.call({ withdrawalId: 'W9', pushToken: 'key', secret: 'KS' }); eq(res.code, 200, 'master-key owner device works without an adminUsers row');
  q = quickApprove(seed); res = await q.call({ withdrawalId: 'W9', pushToken: 'masterSession', secret: 'MS' }); eq(res.code, 200, "the owner signed in with the master key (session name 'owner', no adminUsers row) is accepted");
  const denied = async (body, why) => { const x = quickApprove(seed); const r2 = await x.call(body); eq(r2.code, r2.code === 400 ? 400 : 401, why); eq(x.calls.core.length, 0, why + ': nothing was paid'); return r2; };
  const why = async (body, code, m) => { const r2 = await denied(body, m); eq(r2.body.code, code, m + ' says why'); ok(r2.body.message.length > 40 && !/^Unauthorized$/.test(r2.body.message), m + ': a message the owner can act on'); };
  await why({ withdrawalId: 'W9', pushToken: 'nope', secret: 'S3CRET' }, 'DEVICE_NOT_REGISTERED', 'unknown/rotated device');
  await why({ withdrawalId: 'W9', pushToken: 'staff', secret: 'x' }, 'DEVICE_NOT_OWNER', 'staff device');
  await why({ withdrawalId: 'W9', pushToken: 'good', secret: 'wrong' }, 'ALERT_OUT_OF_DATE', 'wrong secret');
  await why({ withdrawalId: 'W9', pushToken: 'demoted', secret: 'D' }, 'NOT_OWNER_ANYMORE', 'demoted admin');
  await denied({ withdrawalId: 'W9', pushToken: 'good', secret: 'wrong' }, 'wrong secret');
  await denied({ withdrawalId: 'W9', pushToken: 'good', secret: 'S3CRET ' }, 'secret must match exactly');
  await denied({ withdrawalId: 'W9', pushToken: 'nope', secret: 'S3CRET' }, 'unknown device');
  await denied({ withdrawalId: 'W9', pushToken: 'staff', secret: '' }, 'staff device has no secret');
  await denied({ withdrawalId: 'W9', pushToken: 'staff', secret: 'anything' }, 'staff device can never approve');
  await denied({ withdrawalId: 'W9', pushToken: 'staffSecret', secret: 'SS' }, 'even a staff record holding a secret cannot approve');
  await denied({ withdrawalId: 'W9', pushToken: 'demoted', secret: 'D' }, 'admin demoted to staff since registering');
  await denied({ withdrawalId: 'W9', pushToken: 'gone', secret: 'G' }, 'admin account deleted since registering');
  await denied({ withdrawalId: 'W9', pushToken: 'off', secret: 'O' }, 'admin account deactivated since registering');
  await denied({ pushToken: 'good', secret: 'S3CRET' }, 'missing withdrawal id');
  await denied({ withdrawalId: 'W9' }, 'missing credential');
  await denied({ withdrawalId: 'W9', pushToken: { $ne: null }, secret: { $ne: null } }, 'object payloads are coerced to strings, not query operators');
  // a token the browser rotated is retired, not deleted: an alert delivered before the rotation still works for 48h, then it does not
  const hrs = h => new Date(Date.now() - h * 3600 * 1000).toISOString();
  const rseed = { adminPushTokens: { fresh: { role: 'owner', quickApproveSecret: 'F', username: 'owner-key', retiredAt: hrs(2) }, stale: { role: 'owner', quickApproveSecret: 'T', username: 'owner-key', retiredAt: hrs(60) } }, adminUsers: {} };
  q = quickApprove(rseed); res = await q.call({ withdrawalId: 'W9', pushToken: 'fresh', secret: 'F' }); eq(res.code, 200, 'an alert delivered before the token rotated still approves (retired 2h ago)');
  q = quickApprove(rseed); res = await q.call({ withdrawalId: 'W9', pushToken: 'stale', secret: 'T' }); eq([res.code, res.body.code], [401, 'DEVICE_NOT_REGISTERED'], 'but not after the grace period'); eq(q.calls.core.length, 0);
  // an unexpected failure never leaks details
  const bad = quickApprove(seed); bad.db.collection = () => { throw new Error('secret internal detail'); };
  res = await bad.call({ withdrawalId: 'W9', pushToken: 'good', secret: 'S3CRET' }); eq(res.code, 500); ok(!/internal detail/.test(res.body.message), 'no internals in the error');
  // the call site: only a NEW withdrawal asks for the button; deposits do not
  ok(/sendAdminPush\('New withdrawal request'[^\n]*\{ quickApprove: true \}\)/.test(src), 'new-withdrawal alert requests the Approve button');
  ok(!/sendAdminPush\('Deposit completed'[^\n]*quickApprove/.test(src), 'deposit alerts never do');
}

// ───────────────────────── 2. admin/sw.js ─────────────────────────
async function swTests() {
  trace('sw');
  const code = fs.readFileSync(__dirname + '/admin/sw.js', 'utf8');
  function boot(fetchImpl) {
    const listeners = {}, shown = [], posted = [], opened = [], focused = []; let bg;
    const clientsList = { list: [] };
    const self = { addEventListener: (t, f) => { listeners[t] = f; }, skipWaiting() {}, clients: { claim() { return Promise.resolve(); }, matchAll: async () => clientsList.list,
        openWindow: async u => { opened.push(u); } },
      registration: { showNotification: async (title, o) => { shown.push({ title, ...o }); } } };
    const ctx = { self, importScripts() {}, URL, fetch: fetchImpl || (async () => { throw new Error('no network'); }), caches: { open: async () => ({ addAll: async () => {}, put: async () => {} }), keys: async () => [], match: async () => undefined }, console, Promise, JSON, Date,
      firebase: { initializeApp() {}, messaging: () => ({ onBackgroundMessage: f => { bg = f; } }) } };
    vm.runInNewContext(code, ctx);
    const mkClient = () => ({ postMessage: m => posted.push(m), focus: async () => { focused.push(1); return {}; } });
    return { listeners, shown, posted, opened, focused, clientsList, mkClient, push: p => bg(p),
      click: async (data, action) => { let closed = false, p; const e = { action, notification: { data, close() { closed = true; } }, waitUntil: x => { p = x; } }; listeners.notificationclick(e); await p; return closed; } };
  }
  let w = boot();
  const ownerPush = { data: { title: 'New withdrawal request', body: 'UGX 5,000 requested via MTN', type: 'withdrawal', withdrawalId: 'W1', quickApprove: '1', pushToken: 'devA', secret: 'S' } };
  await w.push(ownerPush);
  eq(w.shown.length, 1, 'exactly one notification');
  eq([w.shown[0].title, w.shown[0].body, w.shown[0].tag], ['New withdrawal request', 'UGX 5,000 requested via MTN', 'wd-W1']);
  eq(w.shown[0].actions, [{ action: 'approve', title: 'Approve' }], 'owner device: Approve button');
  ok(w.shown[0].requireInteraction, 'stays until acted on'); ok(/app-icon-192\.png$/.test(w.shown[0].icon), 'brand icon');
  w = boot(); await w.push({ data: { title: 'New withdrawal request', body: 'b', type: 'withdrawal', withdrawalId: 'W1' } });
  eq(w.shown.length, 1); ok(!w.shown[0].actions, 'staff device: no button');
  w = boot(); await w.push({ data: { title: 'T', body: 'b', type: 'withdrawal', withdrawalId: 'W1', quickApprove: '1', pushToken: 'devA' } });
  ok(!w.shown[0].actions, 'no secret, no button');
  w = boot(); await w.push({ data: { title: 'Deposit completed', body: 'b', type: 'deposit', depositId: 'D4' } });
  eq(w.shown[0].tag, 'dep-D4');
  w = boot(); await w.push({ notification: { title: 'Old style', body: 'b' }, data: {} });
  eq(w.shown.length, 0, 'a message with a notification block is left to the SDK: no duplicate');
  w = boot(); await w.push({ data: {} }); eq(w.shown[0].title, 'Soda Admin', 'a bare push still shows something (browsers require it)');

  // Approve tap
  let reqs = [];
  w = boot(async (url, o) => { reqs.push([url, o]); return { ok: true, json: async () => ({ status: 'success', message: 'Sending UGX 4,000 to 0771' }) }; });
  w.clientsList.list = [w.mkClient()];
  const closed = await w.click(ownerPush.data, 'approve');
  ok(closed, 'notification dismissed'); eq(reqs.length, 1);
  eq(reqs[0][0], 'https://mysoda.p-colasoda.com/admin/withdraw/quick-approve'); eq(reqs[0][1].method, 'POST');
  eq(JSON.parse(reqs[0][1].body), { withdrawalId: 'W1', pushToken: 'devA', secret: 'S' }, 'sends exactly the three fields');
  ok(!/authorization/i.test(JSON.stringify(reqs[0][1].headers)), 'no login session or master key is sent');
  eq([w.shown[0].title, w.shown[0].body, w.shown[0].tag], ['Withdrawal approved', 'Sending UGX 4,000 to 0771', 'wd-W1'], 'result replaces the alert (same tag)');
  eq(w.posted, [{ type: 'soda-admin-refresh' }], 'an open panel is told to refresh');
  w = boot(async () => ({ ok: false, json: async () => ({ status: 'error', message: 'Cannot send, the status is \'completed\'' }) }));
  await w.click(ownerPush.data, 'approve'); eq([w.shown[0].title, w.shown[0].body], ['Could not approve', "Cannot send, the status is 'completed'"], 'already-handled withdrawal is explained, not paid again');
  w = boot(async () => { throw new Error('offline'); }); await w.click(ownerPush.data, 'approve');
  eq(w.shown[0].title, 'Could not approve'); ok(/No connection/.test(w.shown[0].body), 'offline is explained');
  w = boot(async () => ({ ok: true, json: async () => { throw new Error('bad json'); } })); await w.click(ownerPush.data, 'approve'); eq(w.shown[0].title, 'Could not approve', 'unreadable reply is not read as success');
  // approve action without a full credential does nothing but open the panel
  reqs = []; w = boot(async (...a) => { reqs.push(a); return { ok: true, json: async () => ({}) }; });
  await w.click({ type: 'withdrawal', withdrawalId: 'W1', pushToken: 'devA' }, 'approve'); eq(reqs.length, 0, 'no secret: no request');

  // plain tap opens the right tab
  for (const [type, tab] of [['withdrawal', 'withdrawals'], ['deposit', 'deposits']]) {
    w = boot(); w.clientsList.list = [w.mkClient()]; await w.click({ type }, undefined);
    eq(w.posted, [{ type: 'soda-admin-open', tab }], 'open panel told to show ' + tab); eq(w.focused.length, 1, 'and brought to the front'); eq(w.opened.length, 0);
    w = boot(); await w.click({ type }, undefined); eq(w.opened, ['/?tab=' + tab], 'no panel open: opens straight to ' + tab);
  }
  w = boot(); await w.click({}, undefined); eq(w.opened, ['/'], 'unknown alert opens the panel');
}

// ───────────────────────── 3. the admin page ─────────────────────────
async function pageTests() {
  trace('page');
  let html = fs.readFileSync(__dirname + (built ? '/admin/index.html' : '/admin-src/index.html'), 'utf8');
  if (built) html = html.replace(/<script data-nx-core>([\s\S]*?)<\/script>/, (_, loader) =>
    '<script>' + zlib.inflateSync(Buffer.from(loader.match(/atob\("([A-Za-z0-9+/=]+)"\)/)[1], 'base64')).toString() + '</script>');
  async function page({ url = 'https://soda-platform.com/admin/', permission = 'default', stored = {}, token = 'tok1', role = 'owner', swReady, fastTimers } = {}) {
    const errors = [], vc = new VirtualConsole(); vc.on('jsdomError', e => errors.push(e.message));
    const S = { calls: [], messageHandlers: {}, onMessage: null, perm: permission, registerReply: { status: 'success', quickApprove: role === 'owner' } };
    const dom = new JSDOM(html, { url, runScripts: 'dangerously', virtualConsole: vc, beforeParse(w) {
      w.fetch = async (u, o = {}) => {
        const path = String(u).replace(/^https?:\/\/[^/]+/, ''); const body = o.body ? JSON.parse(o.body) : null; S.calls.push([path, body]);
        const base = { status: 'success', token: 't', username: 'owner', role, settings: {}, users: [], products: [], withdrawals: [], deposits: [], transactions: [], stats: {}, pendingWithdrawals: 0 };
        return { status: 200, ok: true, json: async () => (path === '/admin/push/register' ? S.registerReply : base) };
      };
      w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
      w.Notification = { get permission() { return S.perm; }, requestPermission: async () => { S.asked = true; return S.perm === 'denied' ? 'denied' : (S.perm = 'granted'); } };
      if (fastTimers) { const st = w.setTimeout.bind(w); w.setTimeout = (f, ms, ...a) => st(f, ms >= 10000 ? 150 : ms, ...a); }
      Object.defineProperty(w.navigator, 'serviceWorker', { configurable: true, value: { ready: swReady || Promise.resolve({}), controller: null, register: async () => ({ update: async () => {} }),
        addEventListener: (t, f) => { S.messageHandlers[t] = f; } } });
      w.firebase = { apps: [], initializeApp() { this.apps.push(1); }, messaging: () => ({ getToken: async () => S.token || token, onMessage: f => { S.onMessage = f; } }) };
      for (const [k, v] of Object.entries(stored)) w.localStorage.setItem(k, v);
    } });
    S.dom = dom; S.w = dom.window; S.errors = errors; S.token = token;
    await sleep(250);
    S.login = async () => { dom.window.document.getElementById('keyInput').value = 'k'; dom.window.document.getElementById('loginBtn').click(); await sleep(250); };
    S.toast = () => (dom.window.document.getElementById('adToast') || {}).textContent || '';
    S.pathCalls = p => S.calls.filter(c => c[0] === p);
    // The tab the member of staff is looking at, read from the page itself (the built bundle renames internals).
    S.tab = () => { const el = dom.window.document.querySelector('.tab.active'); return el ? el.dataset.tab : null; };
    return S;
  }
  // enabling: owner is told about Approve; token and version remembered
  let P = await page(); await P.login();
  P.w.document.getElementById('pushBtn').click(); await sleep(250);
  ok(/Approve button/.test(P.toast()), 'owner told New withdrawals show an Approve button: ' + P.toast() + ' ERRORS=' + JSON.stringify(P.errors) + ' CALLS=' + JSON.stringify(P.calls.map(c => c[0])));
  eq(P.pathCalls('/admin/push/register').length, 1); eq(P.pathCalls('/admin/push/register')[0][1], { token: 'tok1' });
  eq([P.w.localStorage.getItem('snow_admin_push_token'), P.w.localStorage.getItem('soda_admin_push_ver'), P.w.localStorage.getItem('soda_admin_push_key_version')], ['tok1', '2', 'v2']);
  ok(/Notify: on/.test(P.w.document.getElementById('pushBtn').textContent), 'button shows on');
  eq(P.errors, [], 'no page errors'); P.w.close();
  // the service worker never becomes ready: Notify must not look dead
  P = await page({ swReady: new Promise(() => {}), fastTimers: true }); await P.login();
  P.w.document.getElementById('pushBtn').click(); await sleep(60);
  ok(/Enabling/.test(P.w.document.getElementById('pushBtn').textContent) && P.w.document.getElementById('pushBtn').disabled, 'immediate feedback while working');
  await sleep(700);
  ok(/did not become ready/.test(P.toast()), 'a hung service worker is reported, not waited on forever: ' + P.toast());
  ok(!P.w.document.getElementById('pushBtn').disabled && /^Notify$/.test(P.w.document.getElementById('pushBtn').textContent), 'button usable again'); eq(P.pathCalls('/admin/push/register').length, 0); P.w.close();
  // staff: plain message
  P = await page({ role: 'staff' }); await P.login(); P.w.document.getElementById('pushBtn').click(); await sleep(250);
  ok(/Push notifications enabled/.test(P.toast()) && !/Approve/.test(P.toast()), 'staff are not promised a button: ' + P.toast()); P.w.close();
  // blocked
  P = await page({ permission: 'denied' }); await P.login(); P.w.document.getElementById('pushBtn').click(); await sleep(150);
  ok(/blocked/.test(P.toast()), 'blocked notifications are explained: ' + P.toast()); eq(P.pathCalls('/admin/push/register').length, 0); ok(!P.asked, 'no pointless permission request'); P.w.close();
  // unsupported
  P = await page(); P.w.firebase = undefined; await P.login(); P.w.document.getElementById('pushBtn').click(); await sleep(150);
  ok(/script did not load/.test(P.toast()), 'missing Google script is named: ' + P.toast()); P.w.close();
  // messaging() itself refusing (private mode / in-app browser) gets its own reason
  P = await page(); { const f = P.w.firebase; P.w.firebase = Object.assign({}, f, { messaging(){ const e = new Error('x'); e.code = 'messaging/unsupported-browser'; throw e; } }); }
  await P.login(); P.w.document.getElementById('pushBtn').click(); await sleep(150);
  ok(/cannot do push/.test(P.toast()), 'unsupported browser is named: ' + P.toast()); P.w.close();
  // a device registered before this version silently registers again, once
  P = await page({ permission: 'granted', stored: { snow_admin_push_token: 'tok1' } }); await P.login(); await sleep(150);
  eq(P.pathCalls('/admin/push/register').length, 1, 'old registration upgraded without a prompt'); eq(P.pathCalls('/admin/push/unregister').length, 0, 'same token is not unregistered');
  eq([P.w.localStorage.getItem('soda_admin_push_ver'), P.w.localStorage.getItem('soda_admin_push_key_version')], ['2', 'v2']); ok(!P.asked && P.toast() === '', 'silent'); P.w.close();
  P = await page({ permission: 'granted', stored: { snow_admin_push_token: 'tok1', soda_admin_push_ver: '2' } }); await P.login(); await sleep(150);
  eq(P.pathCalls('/admin/push/register').length, 0, 'an up-to-date device is left alone'); P.w.close();
  // a rotated token replaces the old one
  P = await page({ permission: 'granted', token: 'tok2', stored: { snow_admin_push_token: 'tok1', soda_admin_push_ver: '2' } }); await P.login(); await sleep(150);
  eq(P.pathCalls('/admin/push/unregister')[0][1], { token: 'tok1', rotated: true }); eq(P.pathCalls('/admin/push/register')[0][1], { token: 'tok2' }); P.w.close();
  // an alert while the panel is in front
  P = await page({ permission: 'granted', stored: { snow_admin_push_token: 'tok1', soda_admin_push_ver: '2' } }); await P.login();
  ok(typeof P.onMessage === 'function' || typeof P.w.firebase.messaging().onMessage === 'function', 'foreground handler registered');
  P.calls.length = 0;
  await P.onMessage({ data: { title: 'New withdrawal request', body: 'UGX 5,000 requested via MTN', type: 'withdrawal' } }); await sleep(150);
  ok(/New withdrawal request: UGX 5,000 requested via MTN/.test(P.toast()), 'data-only alert shown: ' + P.toast());
  ok(P.pathCalls('/admin/badges').length >= 1, 'badges refreshed so the new request is counted');
  await P.onMessage({ notification: { title: 'Old', body: 'older server' } }); ok(/Old: older server/.test(P.toast()), 'older-format alert still readable');
  // taps routed from the service worker
  const msg = P.messageHandlers.message; ok(typeof msg === 'function', 'listening for service worker messages');
  msg({ data: { type: 'soda-admin-open', tab: 'withdrawals' } }); await sleep(100); eq(P.tab(), 'withdrawals', 'jumps to the withdrawals tab');
  msg({ data: { type: 'soda-admin-open', tab: 'deposits' } }); await sleep(100); eq(P.tab(), 'deposits');
  msg({ data: { type: 'soda-admin-open', tab: 'not-a-tab' } }); await sleep(50); eq(P.tab(), 'deposits', 'an unknown tab is ignored');
  P.calls.length = 0; msg({ data: { type: 'soda-admin-refresh' } }); await sleep(100); ok(P.pathCalls('/admin/badges').length >= 1, 'refresh message refreshes');
  eq(P.errors, [], 'no page errors'); P.w.close();
  // signed out: messages do nothing
  P = await page(); const before = P.calls.length; P.messageHandlers.message({ data: { type: 'soda-admin-open', tab: 'withdrawals' } }); await sleep(100);
  eq(P.calls.length, before, 'signed-out panel ignores it'); P.w.close();
  // opened from a tapped notification: straight to the tab, once
  P = await page({ url: 'https://soda-platform.com/admin/?tab=withdrawals' }); await P.login();
  eq(P.tab(), 'withdrawals', 'opens on the tab the alert was about'); eq(P.w.location.search, '', 'and does not repeat on reload'); P.w.close();
  P = await page({ url: 'https://soda-platform.com/admin/?tab=bogus' }); await P.login(); eq(P.tab(), 'dashboard', 'a bad ?tab= is ignored'); P.w.close();
}

(async () => {
  await serverTests(); await swTests(); await pageTests();
  console.log('PASS: admin push (' + checks + ' checks' + (built ? ', built admin' : ', source') + ')');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
