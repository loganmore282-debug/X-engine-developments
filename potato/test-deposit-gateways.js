'use strict';
// Which gateway stands behind each Deposit-page button. Real server.js against the in-memory MongoDB: the button's position (`slot`) picks the
// gateway from the admin's list (Pay-B = TavuPay, Pay-A = PesaJet, Pay-D = LworxPay, Pay-C = OBPay by default); LworxPay and OBPay are refused
// politely until their integration exists and no deposit row is written for them; no slot falls back to the single recharge gateway; the list
// is validated, can be rotated by the admin, and never reaches the app.
const path = require('path'), Module = require('module'), fs = require('fs');
const root = __dirname;
const fm = require('./test-helpers/fake-mongodb.js');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...a) { return req === 'mongodb' ? path.join(root, 'test-helpers', 'fake-mongodb.js') : origResolve.call(this, req, ...a); };
const PORT = 3700 + Math.floor(Math.random() * 90);
process.env.PORT = String(PORT); process.env.MONGODB_URI = 'mongodb://fake/potato'; process.env.ADMIN_KEY = 'e2e-admin-key-123456'; process.env.NODE_ENV = 'development';
const cap = require('./captcha.js'); const realVerify = cap.verify; cap.verify = (id, code) => code === '0000' ? true : realVerify(id, code);
const realLog = console.log; console.log = () => {}; console.warn = () => {}; const realErr = console.error; console.error = () => {};
require('./server.js');
const base = 'http://127.0.0.1:' + PORT;
const J = async (m, p, b, tok, adm) => { const r = await fetch(base + p, { method: m, headers: Object.assign({ 'content-type': 'application/json' }, tok ? { authorization: 'Bearer ' + tok } : {}, adm ? { authorization: 'Bearer e2e-admin-key-123456' } : {}), body: b ? JSON.stringify(b) : undefined }); let j = {}; try { j = await r.json(); } catch (_) {} return { s: r.status, j }; };
let fails = 0, n = 0; const ok = (c, m, x) => { n++; if (!c) { fails++; realLog('FAIL', m, x ? JSON.stringify(x).slice(0, 260) : ''); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ph = () => '07' + String(70000000 + Math.floor(Math.random() * 9999999)).padStart(8, '0').slice(-8);
async function member() { const c = await J('GET', '/auth/captcha'); const su = await J('POST', '/auth/signup', { phone: ph(), password: 'secret12', captchaId: c.j.id, captchaCode: '0000' }); await J('POST', '/register', { pin: '123456', referralCode: '' }, su.j.token); return { tok: su.j.token, uid: su.j.uid }; }
const deps = () => [...fm.__stores.pendingDeposits.values()];
(async () => {
  for (let i = 0; i < 60; i++) { try { const h = await fetch(base + '/health'); if (h.ok) break; } catch (_) {} await sleep(250); }
  const pub = (await J('GET', '/public/settings')).j;
  ok(!JSON.stringify(pub).includes('depositGateways') && !/lworxpay|obpay/.test(JSON.stringify(pub)), 'the gateway list never reaches the app');
  ok((pub.settings || pub).depositMethodNames === 'Pay-B, Pay-A*, Pay-D, Pay-C', 'the buttons are Pay-B, Pay-A, Pay-D, Pay-C');
  const dep = async (m, slot) => { await sleep(7100); const r = await J('POST', '/deposit/marzpay', slot === undefined ? { amount: 30000 } : { amount: 30000, slot }, m.tok); await sleep(150); return r; };
  const m = await member();
  let r = await dep(m, 0); ok(r.j.status === 'success' && deps().at(-1).provider === 'tavupay', 'button 1 (Pay-B) is TavuPay', r.j);
  r = await dep(m, 1); ok(r.j.status === 'success' && deps().at(-1).provider === 'pesajet', 'button 2 (Pay-A) is PesaJet', r.j);
  const before = deps().length;
  r = await dep(m, 2); ok(r.s === 400 && r.j.code === 'GATEWAY_SOON' && deps().length === before, 'button 3 (Pay-D, LworxPay) is refused politely and writes nothing', r.j);
  r = await dep(m, 3); ok(r.s === 400 && r.j.code === 'GATEWAY_SOON' && deps().length === before, 'button 4 (Pay-C, OBPay) is refused politely and writes nothing', r.j);
  r = await dep(m); ok(r.j.status === 'success' && deps().at(-1).provider === 'marzpay', 'no slot falls back to the single recharge gateway', r.j);
  r = await dep(m, 9); ok(r.j.status === 'success' && deps().at(-1).provider === 'marzpay', 'a slot with no entry falls back too', r.j);
  // admin: validation and rotation
  const bad = await J('POST', '/admin/settings/update', { settings: { depositGateways: 'tavupay, nonsense' } }, null, true); ok(bad.s === 400, 'an unknown gateway is refused', bad.j);
  const seven = await J('POST', '/admin/settings/update', { settings: { depositGateways: 'pesajet,pesajet,pesajet,pesajet,pesajet,pesajet,pesajet' } }, null, true); ok(seven.s === 400, 'more than six is refused');
  const rot = await J('POST', '/admin/settings/update', { settings: { depositGateways: 'obpay, tavupay, pesajet, lworxpay' } }, null, true); ok(rot.j.status === 'success', 'the admin can rotate the list', rot.j);
  r = await dep(m, 1); ok(r.j.status === 'success' && deps().at(-1).provider === 'tavupay', 'after the rotate button 2 is TavuPay', r.j);
  r = await dep(m, 2); ok(r.j.status === 'success' && deps().at(-1).provider === 'pesajet', 'and button 3 is PesaJet', r.j);
  r = await dep(m, 0); ok(r.j.code === 'GATEWAY_SOON', 'and button 1 is the unconnected OBPay');
  // admin panel wiring
  const admin = fs.readFileSync(path.join(root, 'admin-src/index.html'), 'utf8'), app = fs.readFileSync(path.join(root, 'user-src/original_module.js'), 'utf8');
  ok(/id="depGwRotate"/.test(admin) && /depositGateways: _depGws\.join/.test(admin) && /lworxpay/.test(admin) && /obpay/.test(admin), 'the admin has a gateway picker per button and a Rotate button');
  ok(/post\('\/deposit\/marzpay', \{ amount, slot \}\)/.test(app), 'the app sends the position of the chosen button');
  realLog(fails ? fails + ' FAILED' : 'PASS: deposit buttons -> gateways (' + n + ' checks)');
  process.exit(fails ? 1 : 0);
})().catch(e => { realErr(e); process.exit(2); });
