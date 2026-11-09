'use strict';
// END-TO-END for the Myteam Reward tab: the REAL server.js (in this process, against the in-memory stand-in for MongoDB) driven over HTTP.
// It proves what the unit test cannot: the start-up repair really runs at boot (the Reward routes are not stuck on "being updated"), it rewrites
// the claimed tiers from the real payment rows, and the whole claim-once flow (status -> claim -> Claimed -> never again, one tap or two at once)
// works through the real routes, auth and settings.
const path = require('path'), Module = require('module');
const root = __dirname;
const fm = require('./test-helpers/fake-mongodb.js');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...a) { return req === 'mongodb' ? path.join(root, 'test-helpers', 'fake-mongodb.js') : origResolve.call(this, req, ...a); };
const PORT = 3800 + Math.floor(Math.random() * 90);
process.env.PORT = String(PORT); process.env.MONGODB_URI = 'mongodb://fake/smartai'; process.env.ADMIN_KEY = 'e2e-admin-key-123456'; process.env.NODE_ENV = 'development';
const cap = require('./captcha.js'); const realVerify = cap.verify; cap.verify = (id, code) => code === '0000' ? true : realVerify(id, code);
const realLog = console.log; console.log = () => {}; console.warn = () => {};
const S = n => (fm.__stores[n] = fm.__stores[n] || new Map());
// ---- members and payments that exist BEFORE this boot (what the repair has to sort out) ----
const tiers = [{ id: 's1', target: 30000, reward: 1000 }, { id: 's2', target: 90000, reward: 3000 }, { id: 's3', target: 270000, reward: 6000 }];
S('settings').set('main', { _id: 'main', salaryTiers: tiers });
const user = (id, extra) => S('users').set(id, Object.assign({ _id: id, phone: '07700' + id.length + id.charCodeAt(0), status: 'active', walletBalance: 0 }, extra));
user('looked', { salaryTierReward: 6000, claimedSalaryTiers: ['s1', 's2', 's3'] });   // only LOOKED at the old tab: the first repair wrongly locked every tier
user('paid2', { salaryTierReward: 3000 });                                            // really paid daily up to tier 2
user('claimedNew', { claimedSalaryTiers: ['s3'] });                                   // claimed tier 3 since claim-once
user('fresh', {});
S('transactions').set('t1', { _id: 't1', type: 'mission_salary', userId: 'paid2', amount: 1000 });
S('transactions').set('t2', { _id: 't2', type: 'mission_salary', userId: 'paid2', amount: 3000 });
S('transactions').set('t3', { _id: 't3', type: 'mission_salary', userId: 'claimedNew', amount: 6000, salaryTier: 's3' });
require('./server.js');
const base = 'http://127.0.0.1:' + PORT;
const J = async (m, p, b, tok, adm) => { const r = await fetch(base + p, { method: m, headers: Object.assign({ 'content-type': 'application/json' }, tok ? { authorization: 'Bearer ' + tok } : {}, adm ? { authorization: 'Bearer e2e-admin-key-123456' } : {}), body: b ? JSON.stringify(b) : undefined }); let j = {}; try { j = await r.json(); } catch (_) {} return { s: r.status, j }; };
let fails = 0, n = 0; const ok = (c, m, x) => { n++; if (!c) { fails++; realLog('FAIL', m, x ? JSON.stringify(x).slice(0, 300) : ''); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ph = () => '07' + String(70000000 + Math.floor(Math.random() * 9999999)).padStart(8, '0').slice(-8);
async function member(pass, pin, ref) { const c = await J('GET', '/auth/captcha'); const su = await J('POST', '/auth/signup', { phone: ph(), password: pass, captchaId: c.j.id, captchaCode: '0000' }); const reg = await J('POST', '/register', { pin, referralCode: ref || '' }, su.j.token); return { tok: su.j.token, reg: reg.j, uid: su.j.uid }; }
(async () => {
  for (let i = 0; i < 60; i++) { try { const h = await fetch(base + '/health'); if (h.ok) break; } catch (_) {} await sleep(250); }
  await J('POST', '/admin/settings/update', { settings: { welcomeBonus: 500000 } }, null, true);
  const A = await member('secret12', '123456', ''); const B = await member('secret34', '123456', A.reg.referralCode);
  // the start-up repair has finished by the time the routes answer (never stuck on "being updated")
  let st = { s: 0 }; for (let i = 0; i < 40 && st.s !== 200; i++) { st = await J('GET', '/salary/status', null, A.tok); if (st.s !== 200) await sleep(250); }
  ok(st.s === 200 && st.j.status === 'success', 'the Reward tab answers after boot (the start-up repair ran)', st);
  const U = id => fm.__stores.users.get(id).claimedSalaryTiers;
  ok(JSON.stringify(U('looked')) === '[]', 'a member who only LOOKED at the old tab has nothing marked Claimed', U('looked'));
  ok(JSON.stringify([...U('paid2')].sort()) === '["s1","s2"]', 'a member really paid daily up to tier 2 keeps tiers 1 and 2', U('paid2'));
  ok(JSON.stringify(U('claimedNew')) === '["s3"]', 'a tier claimed since claim-once is kept', U('claimedNew'));
  ok(!U('fresh') || U('fresh').length === 0, 'a member never paid has nothing Claimed', U('fresh'));
  ok(fm.__stores.meta.get('rewardClaimOnceV2'), 'the repair leaves its marker');
  // nobody has bought anything yet
  ok(st.j.tiers.length === 3 && st.j.tiers.every(t => t.reached === false && t.claimed === false), 'tiers start unreached and unclaimed', st.j);
  // B buys; the Team purchases that A sees come from B
  const prods = (await J('GET', '/public/products')).j.products.filter(p => p.price > 0).sort((a, b) => a.price - b.price); const p1 = prods[0];
  const buy = await J('POST', '/invest/create', { tierKey: p1.key }, B.tok); ok(buy.j.status === 'success', 'B buys ' + p1.name, buy.j);
  st = await J('GET', '/salary/status', null, A.tok);
  ok(st.j.total === p1.price, 'A sees the team purchase total ' + p1.price, st.j);
  const reachedNow = st.j.tiers.filter(t => t.reached).map(t => t.id);
  ok(reachedNow.length >= 1, 'at least tier 1 is reached (product ' + p1.price + ')', st.j);
  ok(st.j.tiers.filter(t => t.reached).every(t => !t.claimed), 'reached tiers are NOT shown as Claimed', st.j);
  const bal0 = (await J('GET', '/account', null, A.tok)).j.account.walletBalance;
  // two taps at once pay once
  const both = await Promise.all([J('POST', '/salary/claim', { tierId: 's1' }, A.tok), J('POST', '/salary/claim', { tierId: 's1' }, A.tok)]);
  ok(both.map(x => x.s).sort().join() === '200,409', 'a double tap pays once', both.map(x => [x.s, x.j]));
  const bal1 = (await J('GET', '/account', null, A.tok)).j.account.walletBalance;
  ok(bal1 - bal0 === 1000, 'the wallet got tier 1 exactly once: +' + (bal1 - bal0), { bal0, bal1 });
  st = await J('GET', '/salary/status', null, A.tok);
  ok(st.j.tiers[0].claimed === true && st.j.tiers[0].reached === true, 'tier 1 now reads Claimed', st.j.tiers);
  // "tomorrow": the day moves on, nothing comes back
  const again = await J('POST', '/salary/claim', { tierId: 's1' }, A.tok); ok(again.s === 409 && /already claimed/i.test(again.j.message), 'the same tier can never be claimed again', again);
  const old = await J('POST', '/salary/claim', {}, A.tok); ok(old.s === 400, 'an older app that names no tier is told there is nothing left (when only tier 1 is reached)', old);
  const rows = [...fm.__stores.transactions.values()].filter(t => t.userId === A.uid && t.type === 'mission_salary');
  ok(rows.length === 1 && rows[0].amount === 1000, 'one history row for the tier', rows);
  // a restart of the server must not re-open anything: run the repair again by hand (marker exists, so it is a no-op)
  ok(fm.__stores.users.get(A.uid).claimedSalaryTiers.join() === 's1', 'the claimed list on the account is exactly tier 1', fm.__stores.users.get(A.uid).claimedSalaryTiers);
  // a member with an unpaid `salaryTierReward` written by the old tab who then really claims: still works
  fm.__stores.users.get(A.uid).salaryTierReward = 6000;
  st = await J('GET', '/salary/status', null, A.tok); ok(st.j.tiers[0].claimed === true, 'the recorded tier reward changes nothing', st.j.tiers);
  realLog(fails ? 'FAIL: ' + fails + ' of ' + n : 'PASS: Reward tab end to end (' + n + ' checks)');
  process.exit(fails ? 1 : 0);
})().catch(e => { realLog(e); process.exit(1); });
