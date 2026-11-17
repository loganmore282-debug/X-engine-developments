'use strict';
// RANDOM CONCURRENT MONEY FUZZ against the real server (in-memory database): seven members in a referral chain, 45 rounds of six random operations run AT THE SAME TIME
// (credits, double-tapped purchases, double-tapped withdrawals, admin approve + reject of the same withdrawal at once, manual recharges credited / rejected twice,
// check-ins, reward claims, plans maturing, plans removed with and without refund, members banned in the middle). Afterwards the server's own integrity check
// (wallet, deposited, earned, invested, withdrawn against the ledger) must find NOTHING, no wallet may be negative, no plan may be paid more than promised.
//   node test-money-fuzz.js
// shared boot for the probes: the real server on the in-memory database
const path = require('path'), Module = require('module'), fs = require('fs');
const root = __dirname; process.chdir(root);
const fm = require(root + '/test-helpers/fake-mongodb.js');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...a) { return req === 'mongodb' ? path.join(root, 'test-helpers', 'fake-mongodb.js') : origResolve.call(this, req, ...a); };
const BACK = 4100 + Math.floor(Math.random() * 500), AK = 'probe-admin-key-123456';
Object.assign(process.env, { PORT: String(BACK), MONGODB_URI: 'mongodb://fake/app', ADMIN_KEY: AK, NODE_ENV: 'development', POTATO_SECRETS_DIR: fs.mkdtempSync(require('os').tmpdir() + '/pr-') });
const realLog = console.log, serverErrors = [];
console.log = () => {}; console.warn = () => {}; console.error = (...a) => { serverErrors.push(a.map(x => (x && x.message) || String(x)).join(' ').slice(0, 300)); };
require(root + '/server.js');
const base = 'http://127.0.0.1:' + BACK, sleep = ms => new Promise(r => setTimeout(r, ms));
const J = async (m, p, b, tok, adm) => { const r = await fetch(base + p, { method: m, headers: Object.assign({ 'content-type': 'application/json' }, tok ? { authorization: 'Bearer ' + tok } : {}, adm ? { authorization: 'Bearer ' + AK } : {}), body: (b !== undefined && b !== null && m !== 'GET') ? JSON.stringify(b) : undefined }); let j = null; try { j = await r.json(); } catch (_) {} return { s: r.status, j }; };
const ready = async () => { for (let i = 0; i < 80; i++) { try { if ((await fetch(base + '/health')).ok) return; } catch (_) {} await sleep(250); } };
let pass = 0, fail = 0;
const chk = (c, m, x) => { if (c) { pass++; realLog('  ok   - ' + m); } else { fail++; realLog('  FAIL - ' + m + (x !== undefined ? ' ' + JSON.stringify(x).slice(0, 260) : '')); } };


let seed = 6; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296; const pick = a => a[Math.floor(rnd() * a.length)];
(async () => {
  await ready();
  await J('POST', '/admin/settings/update', { settings: { welcomeBonus: 20000, minDeposit: 5000, minWithdraw: 5000, withdrawMethod: 'manual', withdrawWindowEnabled: false, requireInvestToWithdraw: true, maxWithdrawalsPerDay: 0 } }, null, true);
  await J('POST', '/admin/products/number-vips', {}, null, true);
  await J('POST', '/admin/pay-channels/save', { network: 'MTN', accountName: 'Test Co', accountNumber: '0771111111' }, null, true);
  await J('POST', '/admin/pay-channels/save', { network: 'Airtel', accountName: 'Test Co', accountNumber: '0701111111' }, null, true);
  const prods = (await J('GET', '/public/products')).j.products.filter(p => !p.deleted && p.price > 0);
    const M = [];
  // a referral chain so commissions flow: M0 <- M1 <- M2 <- M3, others free
  for (let i = 0; i < 7; i++) {
    const phone = '07712' + String(30100 + i).padStart(5, '0'), su = await J('POST', '/auth/signup', { phone, password: 'secret12' });
    const parent = i >= 1 && i <= 3 ? M[i - 1] : null;
    await J('POST', '/register', { referralCode: parent ? (fm.__stores.users.get(parent.uid) || {}).referralCode || '' : '' }, su.j.token);
    await J('POST', '/bank/save', { holder: 'Member ' + i, network: 'MTN Mobile Money', phone }, su.j.token);
    M.push({ tok: su.j.token, uid: su.j.uid, phone });
  }
  const stat = {}; const count = (k, r) => { const key = k + ':' + (r.s === 200 && r.j && r.j.status === 'success' ? 'ok' : (r.j && (r.j.code || (r.j.status === 'error' ? String(r.j.message || '').slice(0, 60) : r.j.status))) || r.s); stat[key] = (stat[key] || 0) + 1; };
  const ops = {
    credit: async m => { const r = await J('POST', '/admin/deposit', { userId: m.uid, amount: pick([5000, 10000, 30000, 90000, 270000, 123456]), note: 'fuzz' }, null, true); count('credit', r); },
    invest: async m => { const n = 1 + Math.floor(rnd() * 3), p = pick(prods); (await Promise.all(Array.from({ length: n }, () => J('POST', '/invest/create', { tierKey: p.key }, m.tok)))).forEach(r => count('invest', r)); },
    withdraw: async m => { const n = 1 + Math.floor(rnd() * 3), amt = pick([5000, 10000, 20000, 35000, 90000]); (await Promise.all(Array.from({ length: n }, () => J('POST', '/withdraw/request', { amount: amt, network: 'MTN Mobile Money', phone: m.phone }, m.tok)))).forEach(r => count('withdraw', r)); },
    adminWit: async () => {
      const open = [...fm.__stores.withdrawals.entries()].filter(([, w]) => w.status === 'pending'); if (!open.length) return;
      const [id] = pick(open), act = pick(['process', 'reject', 'both', 'both']);
      const calls = act === 'process' ? [['process']] : act === 'reject' ? [['reject']] : [['process'], ['reject'], ['process'], ['reject']];
      (await Promise.all(calls.map(([a]) => J('POST', a === 'process' ? '/admin/withdraw/process' : '/admin/withdraw/reject', { withdrawalId: id }, null, true)))).forEach((r, i) => count('adminWit-' + calls[i][0], r));
    },
    manual: async m => {
      const o = await J('POST', '/deposit/manual/order', { amount: pick([5000, 30000, 90000]), network: pick(['MTN', 'Airtel']), phone: m.phone }, m.tok); count('manualOrder', o);
      if (!o.j || !o.j.depositId) return;
      const ref = 'TX' + Math.floor(rnd() * 1e9);
      const subs = await Promise.all([1, 2].map(() => J('POST', '/deposit/manual/submit', { depositId: o.j.depositId, sms: `Dear customer you have received UGX 30,000 from X. Transaction ID: ${ref}. Fee 0` }, m.tok))); subs.forEach(r => count('manualSubmit', r));
      const acts = pick([['credit'], ['reject'], ['credit', 'credit'], ['credit', 'reject']]);
      (await Promise.all(acts.map(a => J('POST', a === 'credit' ? '/admin/deposit/force-credit' : '/admin/deposit/reject', { depositId: o.j.depositId }, null, true)))).forEach((r, i) => count('manual-' + acts[i], r));
    },
    checkin: async m => { (await Promise.all([1, 2, 3].map(() => J('POST', '/checkin', {}, m.tok)))).forEach(r => count('checkin', r)); },
    salary: async m => { const st = await J('GET', '/salary/status', null, m.tok); const open = ((st.j && st.j.tiers) || []).filter(t => t.reached && !t.claimed); for (const t of open.slice(0, 2)) (await Promise.all([1, 2].map(() => J('POST', '/salary/claim', { tierId: t.id }, m.tok)))).forEach(r => count('salary', r)); },
    agent: async m => { (await Promise.all([1, 2].map(() => J('POST', '/agent/claim', {}, m.tok)))).forEach(r => count('agent', r)); },
    removeProduct: async () => { const act = [...fm.__stores.investments.entries()]; if (!act.length) return; const [id, inv] = pick(act); const rs = await Promise.all([1, 2].map(() => J('POST', '/admin/user/remove-product', { userId: inv.userId, investmentId: id, refund: rnd() < 0.5 }, null, true))); rs.forEach(r => count('removeProduct', r)); },
    banUnban: async m => { await J('POST', '/admin/ban', { userId: m.uid, action: 'ban' }, null, true); await Promise.all([J('POST', '/invest/create', { tierKey: prods[0].key }, m.tok), J('POST', '/withdraw/request', { amount: 5000, network: 'MTN Mobile Money', phone: m.phone }, m.tok)]); await J('POST', '/admin/ban', { userId: m.uid, action: 'unban' }, null, true); await sleep(50);
      // a banned member's old session was ended: sign in again
      const l = await J('POST', '/auth/login', { phone: m.phone, password: 'secret12' }); if (l.j && l.j.token) m.tok = l.j.token; },
    travel: async () => {   // a day or more passes for some plans
      const days = 1 + Math.floor(rnd() * 3);
      for (const [id, inv] of fm.__stores.investments.entries()) if (inv.status === 'active' && rnd() < 0.6) { const c = inv.createdAt instanceof Date ? inv.createdAt.getTime() : Number(inv.createdAt && inv.createdAt.toMillis ? inv.createdAt.toMillis() : inv.createdAt); if (c) { inv.createdAt = new Date(c - days * 86400000); inv.nextPayoutAt = new Date(Math.min(Date.now(), (inv.nextPayoutAt instanceof Date ? inv.nextPayoutAt.getTime() : Date.now()) - days * 86400000)); } }
      await sleep(900);
    },
  };
  const names = Object.keys(ops), weights = { removeProduct: 1, banUnban: 1, credit: 3, invest: 4, withdraw: 4, adminWit: 4, manual: 2, checkin: 1, salary: 1, agent: 1, travel: 2 };
  const bag = names.flatMap(n => Array(weights[n]).fill(n));
  for (let round = 0; round < 45; round++) {
    const jobs = Array.from({ length: 6 }, () => { const n = pick(bag), m = pick(M); return ops[n](m).catch(e => { stat['EXC:' + n + ':' + e.message.slice(0, 40)] = (stat['EXC:' + n + ':' + e.message.slice(0, 40)] || 0) + 1; }); });
    await Promise.all(jobs);
  }
  await ops.travel(); await ops.travel(); await ops.travel(); await sleep(1500);
  const integ = await J('GET', '/admin/integrity', null, null, true);
  chk(integ.j && integ.j.status === 'success' && integ.j.mismatches.length === 0, 'wallet, deposited, earned, invested and withdrawn all agree with the ledger for every member', integ.j && integ.j.mismatches.slice(0, 5));
  chk(integ.j && !integ.j.alerts.some(a => a.kind === 'negative_balance' || a.kind === 'duplicate_credit'), 'no negative balance and no duplicate credit', integ.j && integ.j.alerts.filter(a => a.kind !== 'registration_incomplete').slice(0, 5));
  const invs = [...fm.__stores.investments.values()];
  chk(invs.every(i => (i.payoutsMade || 0) <= i.payoutsTotal), 'no plan was paid more times than its days', invs.filter(i => (i.payoutsMade || 0) > i.payoutsTotal).slice(0, 2).map(i => [i.tierKey, i.payoutsMade, i.payoutsTotal]));
  chk(invs.every(i => (i.paidOut || 0) <= i.expectedReturn + 1), 'no plan paid out more than its promised return', invs.filter(i => (i.paidOut || 0) > i.expectedReturn + 1).slice(0, 2).map(i => [i.tierKey, i.paidOut, i.expectedReturn]));
  const done = invs.filter(i => i.status === 'completed' || i.status === 'matured');
  chk(done.every(i => Math.abs((i.paidOut || 0) - i.expectedReturn) <= 1), 'every finished plan paid out exactly its promised return', done.filter(i => Math.abs((i.paidOut || 0) - i.expectedReturn) > 1).slice(0, 3).map(i => [i.tierKey, i.paidOut, i.expectedReturn, i.payoutsMade, i.payoutsTotal]));
  const wits = [...fm.__stores.withdrawals.values()];
  chk(wits.every(w => ['pending', 'processed', 'declined', 'rejected', 'processing', 'sending', 'creating'].includes(w.status)), 'every withdrawal ends in a known status');
  chk(!wits.some(w => w.status === 'creating'), 'no withdrawal is stuck in "creating"', wits.filter(w => w.status === 'creating').length);
  chk(serverErrors.filter(e => !/MarzPay|PesaJet|fetch failed/.test(e)).length === 0, 'the server logged no error', serverErrors.slice(0, 5));
  realLog(fail ? `FAIL: ${fail} failed` : `PASS: random concurrent money fuzz, the ledger agrees with every wallet (${pass} checks)`); process.exit(fail ? 1 : 0);
})().catch(e => { realLog('CRASH', e.stack); process.exit(1); });
