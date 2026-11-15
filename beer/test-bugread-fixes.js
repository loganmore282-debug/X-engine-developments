// Fixes from the full line-by-line read of Beer: the admin team report splits commission by the right level, a deleted member's wallet is written in the
// activity log, Bonus claims stop during maintenance, the price error names no other currency, plus static checks on the admin panel and member app.
const path = require('path'), Module = require('module'), fs = require('fs'), assert = require('assert');
const D = process.env.APPDIR || __dirname, D_DIR = D; process.chdir(D);
const fm = require(path.join(D, 'test-helpers', 'fake-mongodb.js'));
const o = Module._resolveFilename;
Module._resolveFilename = function (r, ...a) { return r === 'mongodb' ? path.join(D, 'test-helpers', 'fake-mongodb.js') : o.call(this, r, ...a); };
const BACK = 8200 + Math.floor(Math.random() * 300);
process.env.PORT = String(BACK); process.env.MONGODB_URI = 'mongodb://fake/app'; process.env.ADMIN_KEY = 'bugread-admin-key-1234567890'; process.env.NODE_ENV = 'development';
process.env.COOKIE_SECRETS_DIR = fs.mkdtempSync(path.join(require('os').tmpdir(), 'beer-bugread-'));
const L = console.log; console.log = () => {}; console.warn = () => {}; console.error = () => {};
require(path.join(D, 'server.js'));
const base = 'http://127.0.0.1:' + BACK, sleep = ms => new Promise(r => setTimeout(r, ms));
const J = async (m, p, b, tok, adm) => { const r = await fetch(base + p, { method: m, headers: Object.assign({ 'content-type': 'application/json' }, tok ? { authorization: 'Bearer ' + tok } : {}, adm ? { authorization: 'Bearer ' + process.env.ADMIN_KEY } : {}), body: (b === undefined || m === 'GET') ? undefined : JSON.stringify(b) }); return { s: r.status, j: await r.json().catch(() => ({})) }; };
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); }; const eq = (a, b, m) => { n++; assert.deepStrictEqual(a, b, m); };
(async () => {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/health')).ok) break; } catch (_) {} await sleep(250); }
  await J('POST', '/admin/products/add-starters', {}, null, true);
  const mk = async (phone, ref) => { const su = await J('POST', '/auth/signup', { phone, password: 'secret12' }); await J('POST', '/register', { referralCode: ref || '' }, su.j.token); let uid; for (const [id, u] of fm.__stores.users) if (String(u.phone).endsWith(phone.slice(-9))) uid = id; return { tok: su.j.token, uid, code: fm.__stores.users.get(uid).referralCode }; };
  const A = await mk('0911000001'), B = await mk('0911000002', A.code), C = await mk('0911000003', B.code), D = await mk('0911000004', C.code);
  const U = id => fm.__stores.users.get(id);
  // 1. D's first purchase pays C (Level 1), B (Level 2) and A (Level 3); the admin team report must file each under its own level
  const prods = (await J('GET', '/public/products')).j.products; const p = prods[0]; U(D.uid).walletBalance = p.price;
  let r = await J('POST', '/invest/create', { tierKey: p.key, expectedPrice: p.price }, D.tok); eq(r.s, 200, 'purchase ok'); await sleep(600);
  const sett = (await J('GET', '/admin/settings', undefined, null, true)).j.settings;
  const want = lv => Math.round(p.price * sett['commL' + lv] / 100);
  for (const [who, lv] of [[C, 1], [B, 2], [A, 3]]) {
    const ch = await J('POST', '/admin/user/referral-chain', { userId: who.uid }, null, true); eq(ch.s, 200, 'chain loads');
    const c = ch.j.commission, got = { l1: c.l1, l2: c.l2, l3: c.l3 }, exp = { l1: 0, l2: 0, l3: 0 }; exp['l' + lv] = want(lv);
    eq(got, exp, 'the Level ' + lv + ' earner shows its commission under Level ' + lv); eq(c.total, want(lv), 'and the total is the same amount');
    const ts = await J('GET', '/team/stats', undefined, who.tok); eq(ts.j.levelCommission['l' + lv], want(lv), 'the member app agrees (Level ' + lv + ')');
  }
  // 2. Bonus claims are stopped by maintenance mode like every other money action
  await J('POST', '/admin/bonuses/save', { bonuses: [{ target: 1, reward: 100 }] }, null, true); const bid = (await J('GET', '/admin/bonuses', undefined, null, true)).j.bonuses[0].id;
  U(D.uid).totalDeposited = 5000;
  await J('POST', '/admin/settings/update', { settings: { maintenanceMode: true } }, null, true); const before = U(C.uid).walletBalance;
  r = await J('POST', '/bonus/claim', { id: bid }, C.tok); eq([r.s, r.j.code], [503, 'MAINTENANCE'], 'a Bonus claim is refused during maintenance'); eq(U(C.uid).walletBalance, before, 'and nothing is paid');
  eq((await J('GET', '/bonus/list', undefined, C.tok)).s, 503, 'the Bonus list is closed too');
  await J('POST', '/admin/settings/update', { settings: { maintenanceMode: false } }, null, true);
  r = await J('POST', '/bonus/claim', { id: bid }, C.tok); eq(r.s, 200, 'after maintenance the claim works');
  // 3. product price error wording
  r = await J('POST', '/admin/products/save', { products: [{ key: 'zz1', name: 'Z', price: 10.5, cycle: 8, multiplier: 3, isNew: true }] }, null, true);
  ok(r.s === 400 && /whole number/.test(r.j.message) && !/shilling/i.test(r.j.message), 'a decimal price is refused without naming another currency: ' + r.j.message);
  // 4. deleting a member writes the wallet they had into the activity log
  U(D.uid).walletBalance = 4321;
  r = await J('POST', '/admin/user/delete', { userId: D.uid, confirm: 'DELETE' }, null, true); eq(r.s, 200, 'member deleted'); await sleep(200);
  const log = (await J('GET', '/admin/audit-log', undefined, null, true)).j.log.find(e => e.action === 'user_deleted');
  eq(log && log.meta.walletBalance, 4321, 'the activity log keeps the wallet balance the deleted member had');
  // 5. static checks
  const server = fs.readFileSync(path.join(D_DIR, 'server.js'), 'utf8'), admin = fs.readFileSync(path.join(D_DIR, 'admin-src', 'index.html'), 'utf8'), app = fs.readFileSync(path.join(D_DIR, 'user-src', 'original_module.js'), 'utf8'), dbjs = fs.readFileSync(path.join(D_DIR, 'db.js'), 'utf8');
  ok(/'\/bonus'/.test(server.match(/const MAINTENANCE_BLOCK = \[[^\]]*\]/)[0]), 'maintenance covers /bonus');
  ok(/pendingDeposits', \{ pastedSmsTxId: 1 \}/.test(dbjs), 'the payment-message lookup has its index');
  ok(/\\\+251\[97\]\\d\{8\}/.test(admin) && !/\\\+2567\\d\{8\}/.test(admin), 'the admin phone check is for Ethiopian numbers');
  ok(/id="phoneFix" type="text" placeholder="09XXXXXXXX"/.test(admin), 'the phone box shows an Ethiopian number');
  ok(/n\.startsWith\('251'\)/.test(admin) && !/n\.startsWith\('256'\)/.test(admin), 'admin phone search strips 251');
  ok(/id="dBadge"/.test(admin) && /s\.reviewDeposits>0/.test(admin) && /data-dep-reject/.test(admin), 'Deposits tab has its badge and a Reject button');
  ok(/totalWithdrawn:'Total cashed out'/.test(admin) && /deposit_rejected:'Recharge rejected'/.test(admin), 'admin labels cover cashed-out totals and rejected recharges');
  ok(/Number\(o\.expiresAt\) - ckNow\(\)/.test(app) && /Number\(st\.exp\) > ckNow\(\) \+ 5000/.test(app) && !/Number\(o\.expiresAt\) - Date\.now\(\)/.test(app), 'the payment order countdown runs on the server clock');
  ok(/sendAdminPush\('Recharge to check'/.test(server), 'admins are alerted when a recharge waits for review');
  L(`PASS: fixes from the full read (${n} checks)`); process.exit(0);
})().catch(e => { L('FAIL', e.stack || e); process.exit(1); });
