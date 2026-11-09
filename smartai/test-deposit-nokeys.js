'use strict';
// A top-up through a gateway whose key is not on the server must say so AT ONCE ("Top-ups are not available right now"), not answer "Payment initiated" and leave the member
// waiting for a prompt that never comes (owner's phone: "Payment initiated", then "the payment provider is busy"). Real server.js, in-memory database, run twice:
//   no keys at all -> refused (503 GATEWAY_NOT_SET), nothing written;  only MarzPay's key -> every button still works, through MarzPay.
const path = require('path'), Module = require('module'), fs = require('fs'), cp = require('child_process');
const mode = process.argv[2];
if (!mode) {
  let bad = 0;
  for (const m of ['none', 'one']) { const r = cp.spawnSync(process.execPath, [__filename, m], { encoding: 'utf8', timeout: 120000 }); process.stdout.write(r.stdout); if (r.status !== 0) { bad++; process.stdout.write(r.stderr.slice(0, 500)); } }
  console.log(bad ? 'FAIL: top-up without keys' : 'PASS: top-up without keys'); process.exit(bad ? 1 : 0);
}
const root = __dirname;
const fm = require('./test-helpers/fake-mongodb.js');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...a) { return req === 'mongodb' ? path.join(root, 'test-helpers', 'fake-mongodb.js') : origResolve.call(this, req, ...a); };
const PORT = 3800 + Math.floor(Math.random() * 90);
for (const k of ['PESAJET_API_KEY', 'TAVUPAY_API_KEY', 'TAVUPAY_API_SECRET', 'LWORXPAY_API_KEY', 'OBPAY_SECRET_KEY', 'MARZPAY_KEY']) delete process.env[k];
if (mode === 'one') process.env.MARZPAY_KEY = 'k-marz';
process.env.PORT = String(PORT); process.env.MONGODB_URI = 'mongodb://fake/smartai'; process.env.ADMIN_KEY = 'nk-admin-key-123456'; process.env.NODE_ENV = 'development';
process.env.POTATO_SECRETS_DIR = fs.mkdtempSync(path.join(require('os').tmpdir(), 'sa-nk-'));
const realLog = console.log; console.log = () => {}; console.warn = () => {}; console.error = () => {};
require('./server.js');
const base = 'http://127.0.0.1:' + PORT;
const J = async (m, p, b, tok) => { const r = await fetch(base + p, { method: m, headers: Object.assign({ 'content-type': 'application/json' }, tok ? { authorization: 'Bearer ' + tok } : {}), body: b ? JSON.stringify(b) : undefined }); let j = null; try { j = await r.json(); } catch (_) {} return { s: r.status, j }; };
let n = 0, fails = 0; const ok = (c, m, x) => { n++; if (!c) { fails++; realLog('FAIL', m, x ? JSON.stringify(x).slice(0, 200) : ''); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/health')).ok) break; } catch (_) {} await sleep(250); }
  let phoneN = 0;
  const newMember = async () => { const su = await J('POST', '/auth/signup', { phone: '07712' + String(34567 + (++phoneN) * 11).padStart(5, '0'), password: 'secret12' }); await J('POST', '/register', { pin: '123456', referralCode: '' }, su.j.token); return su; };
  const deps = () => [...fm.__stores.pendingDeposits.values()];
  for (const slot of [0, 1, 2, 3, undefined]) {
    const su = await newMember();   // a new member each time: five attempts in a minute from one member are slowed down on purpose
    const r = await J('POST', '/deposit/marzpay', slot === undefined ? { amount: 30000 } : { amount: 30000, slot }, su.j.token);
    if (mode === 'none') ok(r.s === 503 && r.j.code === 'GATEWAY_NOT_SET' && /not available right now/.test(r.j.message), 'no keys: button ' + slot + ' is refused at once', r);
    else ok(r.s === 200 && r.j.status === 'success', 'only MarzPay set up: button ' + slot + ' still starts a top-up', r);
  }
  if (mode === 'none') ok(deps().length === 0, 'nothing was written: no pending deposit, no ledger row, no debounce used');
  else ok(deps().length === 5 && deps().every(d => d.provider === 'marzpay'), 'every top-up went through the one gateway that has its key');
  realLog((fails ? 'FAIL' : 'ok') + ' - ' + mode + ' (' + n + ' checks)'); process.exit(fails ? 1 : 0);
})();
