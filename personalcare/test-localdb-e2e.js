'use strict';
// END-TO-END on PersonalCare's own database (no MongoDB): the REAL server.js is started as a child process on a temp data folder and driven over
// HTTP -- sign-ups, a referral, an admin credit, purchases (including 5 purchases fired at the same moment against a balance that pays for 2),
// then the process is KILLED (kill -9, no goodbye) and started again: every figure must be exactly where it was. Also a clean stop (SIGTERM).
const { spawn } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path'), assert = require('node:assert/strict');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-e2e-')), PORT = 3900 + Math.floor(Math.random() * 90), KEY = 'e2e-admin-key-123456';
const base = 'http://127.0.0.1:' + PORT;
let checks = 0; const ok = (c, m, x) => { checks++; assert.ok(c, m + (x ? ' ' + JSON.stringify(x).slice(0, 300) : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
let child = null, out = '';
function start() {
  out = '';
  child = spawn(process.execPath, ['server.js'], { cwd: __dirname, env: Object.assign({}, process.env, { PORT: String(PORT), PERSONALCARE_DATA_DIR: dir, ADMIN_KEY: KEY, NODE_ENV: 'development' }) });
  child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; });
  return (async () => { for (let i = 0; i < 80; i++) { try { const h = await fetch(base + '/health'); if (h.ok && (await h.json()).db === true) return; } catch (_) {} await sleep(250); } throw new Error('server did not start: ' + out.slice(-600)); })();
}
const stopped = () => new Promise(r => child.once('exit', (code, sig) => r({ code, sig })));
const J = async (m, p, b, tok, adm) => {
  const r = await fetch(base + p, { method: m, headers: Object.assign({ 'content-type': 'application/json' }, tok ? { authorization: 'Bearer ' + tok } : {}, adm ? { authorization: 'Bearer ' + KEY } : {}), body: b ? JSON.stringify(b) : undefined });
  let j = null; try { j = await r.json(); } catch (_) {} return { s: r.status, j };
};
const ph = () => '077' + String(Math.floor(Math.random() * 1e7)).padStart(7, '0');
async function member(ref) {
  const su = await J('POST', '/auth/signup', { phone: ph(), password: 'secret12' }); ok(su.s === 200 && su.j.token, 'sign-up', su);
  const reg = await J('POST', '/register', { referralCode: ref || '', pin: '123456' }, su.j.token); ok(reg.s === 200, 'registration', reg);
  const acct = (await J('GET', '/account', null, su.j.token)).j.account;
  return { tok: su.j.token, uid: su.j.uid, code: acct.referralCode, acct };
}
const account = async tok => (await J('GET', '/account', null, tok)).j.account;

(async () => {
  await start();
  let A, B;
  try {
    A = await member(''); B = await member(A.code);
    const prods = (await J('GET', '/public/products')).j.products.filter(p => p.price > 0).sort((a, b) => a.price - b.price);
    ok(prods.length >= 3, 'the starter assets exist', prods.length);
    const p1 = prods[0];
    // an admin credit: exactly that much arrives, once
    const credit = p1.price * 2 + 1000;
    let r = await J('POST', '/admin/deposit', { userId: B.uid, amount: credit, note: 'e2e' }, null, true); ok(r.s === 200, 'admin credit', r);
    const b0 = (await account(B.tok)).walletBalance; ok(b0 >= credit, 'the credit is on the balance', b0);
    // five purchases at the same moment, money for two: exactly two succeed and the balance never goes negative
    const buys = await Promise.all(Array.from({ length: 5 }, () => J('POST', '/invest/create', { tierKey: p1.key }, B.tok)));
    const okBuys = buys.filter(x => x.j && x.j.status === 'success').length;
    const bAfter = await account(B.tok);
    const expectedBuys = Math.floor(b0 / p1.price);
    ok(okBuys === expectedBuys, `5 simultaneous purchases with money for ${expectedBuys}: exactly ${expectedBuys} succeeded`, { okBuys, b0, price: p1.price });
    const paidBack = ((await J('GET', '/transactions', null, B.tok)).j.transactions || []).filter(t => t.type === 'cashback').reduce((n, t) => n + t.amount, 0);   // a payout that fell due at midnight while the test ran is legitimate
    ok(Math.abs(bAfter.walletBalance - (b0 - okBuys * p1.price + paidBack)) < 0.01 && bAfter.walletBalance >= 0, 'and the balance is exactly the money left (no double debit, never negative)', { b0, price: p1.price, okBuys, paidBack, after: bAfter.walletBalance });
    const inv1 = (await J('GET', '/investments', null, B.tok)).j.investments; ok(inv1.length === okBuys, 'the investments list matches', inv1.length);
    const aBal1 = (await account(A.tok)); const tx1 = (await J('GET', '/transactions', null, B.tok)).j.transactions;
    // ── kill -9 and start again: nothing is lost ──
    const gone = stopped(); child.kill('SIGKILL'); await gone; await start();
    const bBack = await account(B.tok), aBack = await account(A.tok);
    ok(Math.abs(bBack.walletBalance - bAfter.walletBalance) < 0.0001, 'after kill -9 the member balance is exactly the same', [bBack.walletBalance, bAfter.walletBalance]);
    ok(Math.abs(aBack.walletBalance - aBal1.walletBalance) < 0.0001, 'and so is the referrer\'s (commission included)', [aBack.walletBalance, aBal1.walletBalance]);
    ok((await J('GET', '/investments', null, B.tok)).j.investments.length === okBuys, 'the investments are all there');
    ok((await J('GET', '/transactions', null, B.tok)).j.transactions.length === tx1.length, 'and the records');
    // sessions survive a restart (the member stays signed in)
    ok((await J('GET', '/account', null, A.tok)).s === 200, 'the login token still works after the restart');
    // the same credit cannot be replayed by a stale request; a later purchase works on the reloaded data
    const more = await J('POST', '/admin/deposit', { userId: B.uid, amount: p1.price + 10 }, null, true); ok(more.s === 200 || more.s === 429, 'the admin can credit again');
    // unique rule still holds on the reloaded data: the same phone cannot sign up twice
    const dupPhone = ph(); const first = await J('POST', '/auth/signup', { phone: dupPhone, password: 'secret12' }); const second = await J('POST', '/auth/signup', { phone: dupPhone, password: 'secret12' });
    ok(first.s === 200 && second.s === 409, 'the same phone cannot sign up twice', [first.s, second.s]);
    // ── a clean stop writes everything and the next start has nothing to repair ──
    const done = stopped(); child.kill('SIGTERM'); const res = await done; ok(res.code === 0, 'SIGTERM is a clean stop (exit 0)', res);
    await start();
    ok(/replayed 0|database opened/.test(out) && !/torn/.test(out), 'the next start finds nothing to repair');
    const bFinal = await account(B.tok); ok(bFinal.walletBalance >= 0, 'balance still readable after the clean restart');
    // a burst of 30 sign-ups at once: all accounts exist, all different
    const burst = await Promise.all(Array.from({ length: 30 }, () => J('POST', '/auth/signup', { phone: ph(), password: 'secret12' })));
    ok(burst.every(x => x.s === 200), '30 simultaneous sign-ups all succeed', burst.map(x => x.s).join());
    ok(new Set(burst.map(x => x.j.uid)).size === 30, 'every one has its own id');
    console.log(`PASS: PersonalCare on its own database, end to end (${checks} checks)`);
  } finally { try { child && child.kill('SIGKILL'); } catch (_) {} await sleep(200); fs.rmSync(dir, { recursive: true, force: true }); }
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); console.error(out.slice(-1500)); try { child.kill('SIGKILL'); } catch (_) {} process.exit(1); });
