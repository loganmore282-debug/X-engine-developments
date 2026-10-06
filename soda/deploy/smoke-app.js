#!/usr/bin/env node
'use strict';
// Live check that the SERVER gives the new screens what they need, against a RUNNING server and its
// real database. Creates one throwaway test member (random 077 number, Trade Password 482913), then
// reads what Home, Income, Team, My, Deposit, Withdraw and Balance Record read, and tries the
// Trade Password and purchase-limit rules. Prints PASS/FAIL per step, never a token or password.
//   node deploy/smoke-app.js [http://127.0.0.1:3001] [REFERRAL_CODE]
// REFERRAL_CODE is any existing member's code (needed once the platform already has members and the
// admin requires a referral code). The test member is left in the database: delete it in the admin
// panel (Users) when done. It gets the normal welcome bonus and has no payout wallet, so it cannot withdraw.
const base = (process.argv[2] || 'http://127.0.0.1:3001').replace(/\/+$/, '');
const ref = process.argv[3] || '';
const phone = '077' + String(Math.floor(Math.random() * 1e7)).padStart(7, '0');
const password = 'Smoke' + Math.random().toString(36).slice(2, 10);
const PIN = '482913';
let bad = 0;
const say = (ok, what, extra) => { if (!ok) bad++; console.log((ok ? 'PASS  ' : 'FAIL  ') + what + (extra ? '   (' + extra + ')' : '')); };
const call = async (method, path, body, token) => {
  try {
    const r = await fetch(base + path, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}), body: method === 'GET' ? undefined : JSON.stringify(body || {}) });
    return { code: r.status, body: await r.json().catch(() => ({})) };
  } catch (e) { return { code: 0, body: { message: e.message } }; }
};
const num = v => typeof v === 'number' && Number.isFinite(v);
(async () => {
  const h = await call('GET', '/health');
  say(h.body.status === 'ok' && h.body.db === true, 'server and database are up');
  const st = await call('GET', '/public/settings');
  const s = (st.body && st.body.settings) || {};
  say(st.code === 200 && num(Number(s.minDeposit)) && num(Number(s.minWithdraw)) && num(Number(s.withdrawFeePct)), 'public settings carry deposit/withdraw rules', 'minDeposit ' + s.minDeposit + ', minWithdraw ' + s.minWithdraw + ', fee ' + s.withdrawFeePct + '%');
  const pr = await call('GET', '/public/products');
  const products = (pr.body && pr.body.products) || [];
  say(pr.code === 200 && Array.isArray(products), 'the asset catalogue answers', products.length + ' asset(s) set up in admin');
  say(products.every(p => p.key && p.name && num(p.price) && num(p.dailyPayout) && num(p.cycle)), 'every asset has name, price, days and daily figure');
  const im = await call('GET', '/public/soda-images');
  say(im.code === 200 && 'profilelogo' in im.body && 'banner2' in im.body, 'banner and profile-logo slots exist', 'profilelogo ' + (im.body.profilelogo ? 'uploaded' : 'not uploaded yet'));

  let r = await call('POST', '/auth/signup', { phone, password });
  const token = r.body.token;
  say(r.code === 200 && token, 'test member signs up', 'HTTP ' + r.code);
  r = await call('POST', '/register', { referralCode: ref, pin: PIN }, token);
  say(r.code === 200 && r.body.status === 'success', 'test member finishes registration with a Trade Password', 'HTTP ' + r.code + (r.body.message ? ' ' + r.body.message : ''));
  if (r.code !== 200) { console.log('\nStopping: registration needs a valid referral code. Run again with:  node deploy/smoke-app.js ' + base + ' <an existing member\'s code>'); process.exit(1); }

  const ac = await call('GET', '/account', null, token);
  const a = (ac.body && ac.body.account) || {};
  say(ac.code === 200 && a.phone && num(a.walletBalance) && num(a.totalEarned) && a.referralCode, 'My / Home: account has phone, balance, earnings, referral code', 'balance ' + a.walletBalance);
  say(a.hasTradePin === true, 'the account says a Trade Password is set');
  const iv = await call('GET', '/investments', null, token);
  say(iv.code === 200 && Array.isArray(iv.body.investments), 'Income: investments list answers', iv.body.investments && iv.body.investments.length + ' owned');
  const ts = await call('GET', '/team/stats', null, token);
  const lc = ts.body.levelCommission || {};
  say(ts.code === 200 && num(lc.l1) && num(lc.l2) && num(lc.l3) && num(ts.body.totalTeam) && ts.body.commRates, 'Team: totals, rates and per-level commission', 'rates ' + JSON.stringify(ts.body.commRates));
  const tm = await call('GET', '/team/members?level=1', null, token);
  say(tm.code === 200 && Array.isArray(tm.body.members), 'Team: member list answers');
  const tx = await call('GET', '/transactions', null, token);
  say(tx.code === 200 && Array.isArray(tx.body.transactions) && tx.body.transactions.length >= 1, 'Balance Record: ledger answers (welcome bonus row)', (tx.body.transactions || []).length + ' row(s)');
  const bk = await call('GET', '/bank/list', null, token);
  say(bk.code === 200 && Array.isArray(bk.body.accounts), 'Withdraw: wallet list answers');
  const ms = await call('GET', '/messages', null, token);
  say(ms.code === 200 && Array.isArray(ms.body.messages), 'Messages answer');

  // Trade Password rules on the real server
  const mult = Number(s.withdrawMultiple) || 0;
  let wAmt = Math.max(Number(s.minWithdraw) || 0, 1000); if (mult > 0) wAmt = Math.ceil(wAmt / mult) * mult;
  r = await call('POST', '/withdraw/request', { amount: wAmt, network: 'MTN Mobile Money', phone }, token);
  if (r.body.code === 'WINDOW_CLOSED') console.log('SKIP  withdraw hours are closed right now, so the Trade Password order cannot be tried (run again inside the hours)');
  else {
    say(r.code === 400 && r.body.code === 'INVALID_PIN', 'withdraw without a Trade Password is refused', 'HTTP ' + r.code + ' ' + (r.body.code || ''));
    r = await call('POST', '/withdraw/request', { amount: wAmt, network: 'MTN Mobile Money', phone, pin: '000000' }, token);
    say(r.code === 400 && r.body.code === 'WRONG_PIN', 'withdraw with a wrong Trade Password is refused', 'HTTP ' + r.code + ' ' + (r.body.code || ''));
  }
  r = await call('POST', '/account/transaction-pin/change', { oldPin: '111222', newPin: '135790' }, token);
  say(r.code === 400, 'changing the Trade Password with a wrong old one is refused', 'HTTP ' + r.code);
  // purchase: only try an asset the test member cannot afford (never spend the welcome bonus)
  const dear = products.filter(p => num(p.price) && p.price > (a.walletBalance || 0) && p.isOpen !== false).sort((x, y) => x.price - y.price)[0];
  if (dear) {
    r = await call('POST', '/invest/create', { tierKey: dear.key }, token);
    say(r.code === 400 && r.body.code === 'INSUFFICIENT_BALANCE', 'buying an asset without enough balance is refused', dear.name + ' ' + dear.price);
  } else console.log('SKIP  no asset dearer than the test balance, purchase refusal not tried');
  console.log(bad ? '\n' + bad + ' step(s) FAILED' : '\nAll steps passed. Delete test member ' + phone + ' in admin (Users) when you are done.');
  process.exit(bad ? 1 : 0);
})();
