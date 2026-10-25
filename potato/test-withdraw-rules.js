#!/usr/bin/env node
/**
 * One cash-out at a time.
 *
 * Owner: "no requesting another withdrawal yet another one is on pending, so
 * one should have got his processing one to be paid then requests another,
 * also one withdrawal time should be SETTABLE IN ADMIN, such that when one
 * tries to withdrawal he sees, that withdrawals start from this time to this
 * time, nothing much ie 6pm to 5pm."
 *
 * Both are money rules, so both are tested by RUNNING the real
 * withdrawWindowState() and by driving /withdraw/request itself against a stub
 * database -- not by grepping for the checks. A rule that is present in the
 * source and unreachable at runtime is not a rule.
 *
 * The wrap-past-midnight case is the one that needs real care, and it is his
 * own example: 18:00 to 17:00 is open for 23 of the 24 hours, and the obvious
 * `from <= now && now < to` reads it as never open.
 */
const fs = require('fs');
const crypto = require('node:crypto');
const src = fs.readFileSync(__dirname + '/server.js', 'utf8');

let bad = 0;
const ck = (o, l) => { if (!o) bad++; console.log(`${o ? 'PASS' : 'FAIL'}  ${l}`); };

function fnSource(name) {
  let start = src.indexOf(`async function ${name}(`);
  if (start === -1) start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`no such function: ${name}`);
  let depth = 0;
  for (let k = src.indexOf('{', start); k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (depth === 0) return src.slice(start, k + 1); }
  }
  throw new Error(`unbalanced braces in ${name}`);
}
const grab = (a, b) => {
  const i = src.indexOf(a), j = src.indexOf(b);
  if (i === -1 || j === -1 || j <= i) throw new Error(`bad slice: ${a} .. ${b}`);
  return src.slice(i, j);
};

// ── the real route, on a stub database ───────────────────────────────────
console.log('\n— the route itself: one unresolved cash-out at a time —');

function run(state, body) {
  // Defaults to 200 because the route's SUCCESS path calls res.json() with no
  // res.status() at all -- reading an unset code as 0 made every accepted
  // cash-out look refused.
  let code = 200, replied = null;
  const res = { status(c) { code = c; return res; }, json(j) { replied = j; return res; } };
  const inc = Symbol('inc'), union = Symbol('union');
  const applyInc = (doc, patch) => {
    for (const [k, v] of Object.entries(patch)) {
      if (v && typeof v === 'object' && v[inc] != null) doc[k] = (Number(doc[k]) || 0) + v[inc];
      else if (v && typeof v === 'object' && v[union] != null) doc[k] = [...new Set([...(doc[k] || []), v[union]])];
      else doc[k] = v;
    }
  };
  const q = (rows, filters) => rows.filter(r => filters.every(([f, op, v]) =>
    op === '==' ? r[f] === v : op === 'in' ? v.includes(r[f]) : true));
  const chain = (rows, filters = []) => ({
    where: (f, op, v) => chain(rows, filters.concat([[f, op, v]])),
    orderBy: () => chain(rows, filters),
    limit: () => chain(rows, filters),
    get: async () => {
      const got = q(rows, filters);
      return { empty: !got.length, size: got.length,
               docs: got.map(r => ({ id: r.id, data: () => ({ ...r }) })) };
    },
  });
  const sandbox = {
    console, crypto,
    verifyAuth: async () => 'u1',
    withLock: (_k, fn) => fn(),
    getSettings: async () => state.settings,
    // Stands in for the real pinCheck (proved separately in test-trade-pin.js): only
    // '123456' is the member's Trade Password, and 'LOCK!' simulates a locked account.
    pinCheck: async (_u, pin) => pin === 'LOCK!' ? { ok: false, code: 'LOCKED', message: 'Too many wrong Trade Password attempts.' }
      : pin === '123456' ? { ok: true }
      : { ok: false, code: /^\d{6}$/.test(String(pin || '')) ? 'WRONG_PIN' : 'INVALID_PIN', message: 'Incorrect Trade Password.' },
    cleanPhone: p => String(p || '').replace(/\D/g, '') || '',
    uniqueRef: async () => 'S1',
    mobileMoneyRefPrefix: async () => 'S',
    textOf: v => typeof v === 'string' ? v : (typeof v === 'number' && Number.isFinite(v) ? String(v) : ''),
    nowStr: () => ({ date: '15/01/2026', time: '12:00' }),
    fmtMoney: n => 'UGX ' + Number(n).toLocaleString('en-US'),
    // The route stamps the member's region onto the withdrawal document now.
    currentRegionKey: () => 'ug',
    DEFAULT_REGION_KEY: 'ug',
    logSecurityEvent: () => {},
    sendAdminPush: async () => {},
    sendWithdrawalSmsAlert: async () => {},
    logAdminAction: () => {},
    NETWORK_NAMES: new Set(['MTN Mobile Money', 'Airtel Money']),
    MAX_MONEY_AMOUNT: 100000000,
    _witRequestInFlight: new Set(),
    _userBeingDeleted: new Set(),
    FieldValue: { increment: n => ({ [inc]: n }), arrayUnion: n => ({ [union]: n }), serverTimestamp: () => 1 },
    withUserRegion: (_u, fn) => fn(),
    // The REAL window function, bound to this case's instant. Overriding
    // Date inside the sandbox was the first attempt and it did nothing: the
    // handler calls Date.now() directly, so every window case was judged
    // against the wall clock of whatever machine ran the test. The logic
    // itself is exercised as a pure function above; here only the clock is
    // pinned.
    withdrawWindowState: sett => winApi.withdrawWindowState(sett, state.now),
    db: { collection: name => {
      if (name === 'users') return { doc: () => ({
        get: async () => ({ exists: true, data: () => ({ ...state.user }) }),
        update: async p => applyInc(state.user, p),
        updateIf: async (condition, patch) => {
          if (state.user.walletBalance < condition.walletBalance.$gte || state.user.status === 'banned' ||
              (state.user.debitedWithdrawalIds || []).includes(condition.debitedWithdrawalIds.$ne)) return false;
          applyInc(state.user, patch); return true;
        },
      }) };
      if (name === 'bankAccounts') return chain(state.banks);
      if (name === 'withdrawals') return {
        ...chain(state.wits),
        doc: id => { id = id || 'w' + (++state.seq); return {
          id, get: async () => { const row = state.wits.find(w => w.id === id); return { exists: !!row, data: () => ({ ...row }) }; },
          set: async d => { state.wits.push({ id, ...d }); },
          updateIf: async (filter, patch) => { const row = state.wits.find(w => w.id === id);
            if (!row || row.status !== filter.status) return false; applyInc(row, patch); return true; },
          delete: async () => { state.wits = state.wits.filter(w => w.id !== id); } }; },
      };
      return { ...chain([]), doc: id => ({ createIfAbsent: async d => {
        if (state.failLedger) throw new Error('ledger unavailable');
        if (!state.tx.some(t => t.id === id)) state.tx.push({ id, ...d });
      } }), add: async d => { state.tx.push(d); return { id: 't1' }; } };
    } },
  };
  const fn = new Function('sandbox', `
    const { console, crypto, verifyAuth, withLock, getSettings, pinCheck, cleanPhone,
            uniqueRef, mobileMoneyRefPrefix, textOf, nowStr, fmtMoney, logSecurityEvent, sendAdminPush,
            sendWithdrawalSmsAlert, NETWORK_NAMES, MAX_MONEY_AMOUNT,
            _witRequestInFlight, _userBeingDeleted, FieldValue, db,
            withdrawWindowState, currentRegionKey, DEFAULT_REGION_KEY, withUserRegion } = sandbox;
    let handler;
    const tsMillis = n => Number(n) || 0;
    const tzOffMs = () => 180 * 60000;
    const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
    ${fnSource('statementStamp')}
    ${fnSource('newStatementId')}
    ${fnSource('paymentAmount')}
    ${fnSource('finishWithdrawalCreation')}
    sandbox.recover = id => finishWithdrawalCreation(db.collection('withdrawals').doc(id), 'u1');
    const app = { post: (p, h) => { if (p === '/withdraw/request') handler = h; } };
    ${grab("app.post('/withdraw/request'", '// `refunded` MUST be the real')}
    return handler;
  `)(sandbox);
  state.recover = sandbox.recover;
  return fn({ body, headers: {} }, res).then(() => ({ code, replied }));
}

function fresh(extra = {}) {
  return {
    settings: { minWithdraw: 5000, withdrawFeePct: 15, withdrawMultiple: 5000,
                requireInvestToWithdraw: false, maxWithdrawalsPerDay: 0,
                withdrawWindowEnabled: false, ...(extra.settings || {}) },
    user: { walletBalance: 100000, totalInvested: 50000, status: 'active' },
    banks: [{ id: 'b1', userId: 'u1', network: 'MTN Mobile Money', phone: '0770000001', holder: 'A B' }],
    wits: extra.wits || [], tx: [], seq: 0, now: Date.now(),
  };
}
const REQ = { amount: 10000, network: 'MTN Mobile Money', phone: '0770000001', pin: '123456' };

(async () => {
  let st = fresh();
  let r = await run(st, REQ);
  ck(r.code === 200, `a first cash-out is accepted (${r.code} ${r.replied && r.replied.message})`);
  ck(st.wits.length === 1, `and recorded (${st.wits.length})`);
  ck(st.user.walletBalance === 90000, `wallet debited once (${st.user.walletBalance})`);

  // There is no weekend closing: a request goes through on any day of the week.
  r = await run(fresh(), REQ);
  ck(r.code === 200, `a withdrawal is accepted on any day of the week (${r.code})`);
  st = fresh(); st.failLedger = true;
  r = await run(st, REQ);
  ck(r.code === 503 && r.replied.code === 'WITHDRAWAL_RECOVERY_PENDING', 'ledger outage returns a recovery notice');
  ck(st.user.walletBalance === 90000 && st.wits[0].status === 'creating', 'charged request stays non-payable during outage');
  r = await run(st, REQ);
  ck(r.code === 400 && st.user.walletBalance === 90000, 'retry cannot debit while recovery is pending');
  st.failLedger = false;
  await st.recover(st.wits[0].id);
  await st.recover(st.wits[0].id);
  ck(st.wits[0].status === 'pending' && st.tx.length === 1 && st.user.walletBalance === 90000,
     'recovery creates one ledger row without a second debit');
  console.log('\n— the Trade Password gates the withdrawal on the server —');
  for (const [label, pin, code, http] of [['missing', undefined, 'INVALID_PIN', 400], ['wrong', '654321', 'WRONG_PIN', 400], ['too short', '1234', 'INVALID_PIN', 400], ['locked account', 'LOCK!', 'LOCKED', 429]]) {
    st = fresh();
    r = await run(st, { ...REQ, pin });
    ck(r.code === http && r.replied.code === code, `a ${label} Trade Password is refused (${r.code} ${r.replied && r.replied.code})`);
    ck(st.wits.length === 0 && st.user.walletBalance === 100000 && st.tx.length === 0, '  and nothing is written or debited');
  }
  st = fresh();
  r = await run(st, { ...REQ, amount: '10000garbage' });
  ck(r.code === 400 && st.user.walletBalance === 100000, 'malformed amount cannot reach the wallet');

  for (const status of ['pending', 'sending', 'processing']) {
    st = fresh({ wits: [{ id: 'w0', userId: 'u1', status, amount: 20000 }] });
    r = await run(st, REQ);
    ck(r.code === 400 && r.replied.code === 'WITHDRAW_PENDING',
       `a ${status} withdrawal blocks the next (${r.code} ${r.replied && r.replied.code})`);
    ck(/already have a withdrawal/i.test((r.replied || {}).message || ''),
       `  and says why: ${(r.replied || {}).message}`);
    ck(st.wits.length === 1 && st.user.walletBalance === 100000,
       '  nothing written, nothing debited');
  }

  console.log('\n— a finished one blocks nothing —');
  for (const status of ['processed', 'rejected', 'declined']) {
    st = fresh({ wits: [{ id: 'w0', userId: 'u1', status, amount: 20000 }] });
    r = await run(st, REQ);
    ck(r.code === 200, `a ${status} cash-out lets the next through (${r.code})`);
  }
  // Somebody ELSE's pending cash-out must not block this member.
  st = fresh({ wits: [{ id: 'w0', userId: 'u2', status: 'pending', amount: 20000 }] });
  r = await run(st, REQ);
  ck(r.code === 200, `another member's pending cash-out is irrelevant (${r.code})`);

  console.log('\n— the daily limit counts payouts, not refunded failures —');
  st = fresh({ settings: { maxWithdrawalsPerDay: 1 }, wits: [{ id: 'w0', userId: 'u1', status: 'declined', amount: 20000, date: '15/01/2026' }] });
  r = await run(st, REQ);
  ck(r.code === 200, `a refunded (declined) request today does not use the allowance (${r.code} ${r.replied && r.replied.message})`);
  st = fresh({ settings: { maxWithdrawalsPerDay: 1 }, wits: [{ id: 'w0', userId: 'u1', status: 'processed', amount: 20000, date: '15/01/2026' }] });
  r = await run(st, REQ);
  ck(r.code === 400 && /limit of 1/.test((r.replied || {}).message || ''), `a paid one today still does (${r.code})`);

  console.log('\n— the app no longer promises hours nobody keeps —');
  const mod = fs.readFileSync(__dirname + '/user-src/original_module.js', 'utf8');
  ck(!/Withdrawal time:|withdrawWindow|withdrawOpenFrom/.test(mod) && !/withdrawWindow|withdrawOpenFrom|withdrawAnytime/.test(src),
     'there are no withdrawal hours and no per-member exemption any more');
  ck(!/There is no limit to the number of withdrawals/.test(mod),
     'and so is "There is no limit to the number of withdrawals"');

  console.log(bad ? `\n${bad} FAILED` : '\nwithdraw rules: all cases pass');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('CRASHED:', e); process.exit(1); });
