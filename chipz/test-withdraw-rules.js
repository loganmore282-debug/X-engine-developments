#!/usr/bin/env node
/**
 * One cash-out at a time, and only inside the hours the admin sets.
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

// ── the window, as a pure function ───────────────────────────────────────
const winApi = new Function(`
  const tsMillis = t => Number(t) || 0;
  ${fnSource('hhmmToMin')}
  ${fnSource('hhmmLabel')}
  ${fnSource('withdrawWindowState')}
  return { hhmmToMin, hhmmLabel, withdrawWindowState };
`)();

// An EAT wall-clock time as an epoch, so "is 3pm inside the window" is asked
// in the zone the server judges in and not in whatever the test box is set to.
const eatAt = (h, m = 0) => Date.UTC(2026, 0, 15, h - 3, m);

console.log('— times are parsed, not guessed —');
ck(winApi.hhmmToMin('18:00') === 1080, '18:00 is 1080 minutes');
ck(winApi.hhmmToMin('09:05') === 545, '09:05 is 545');
// '9:00' is in this list because hhmmToMin requires a two-digit hour -- the
// save endpoint pads a single-digit one BEFORE parsing, so a hand-typed 9:00
// is still accepted there. Here the parser's own contract is what is checked.
for (const junk of ['', 'abc', '25:00', '12:60', '1200', null, undefined, '12', '9:00']) {
  ck(winApi.hhmmToMin(junk) === null, `${JSON.stringify(junk)} is refused, not coerced to midnight`);
}
console.log('\n— and labelled the way he writes them —');
ck(winApi.hhmmLabel('18:00') === '6:00 PM', `18:00 reads "${winApi.hhmmLabel('18:00')}"`);
ck(winApi.hhmmLabel('17:00') === '5:00 PM', `17:00 reads "${winApi.hhmmLabel('17:00')}"`);
ck(winApi.hhmmLabel('00:30') === '12:30 AM', `00:30 reads "${winApi.hhmmLabel('00:30')}"`);
ck(winApi.hhmmLabel('12:00') === '12:00 PM', `12:00 reads "${winApi.hhmmLabel('12:00')}"`);

console.log('\n— a normal window, 09:00 to 17:00 —');
const normal = { withdrawWindowEnabled: true, withdrawOpenFrom: '09:00', withdrawOpenTo: '17:00' };
for (const [h, want] of [[8, false], [9, true], [12, true], [16, true], [17, false], [23, false], [3, false]]) {
  const st = winApi.withdrawWindowState(normal, eatAt(h));
  ck(st.open === want, `${String(h).padStart(2, '0')}:00 EAT -> ${st.open ? 'open' : 'shut'} (wanted ${want ? 'open' : 'shut'})`);
}

console.log('\n— HIS example, 18:00 to 17:00, which wraps past midnight —');
const wrap = { withdrawWindowEnabled: true, withdrawOpenFrom: '18:00', withdrawOpenTo: '17:00' };
for (const [h, want] of [[18, true], [21, true], [0, true], [3, true], [12, true], [16, true], [17, false], [17.5, false]]) {
  const st = winApi.withdrawWindowState(wrap, eatAt(Math.floor(h), (h % 1) * 60));
  const lbl = `${String(Math.floor(h)).padStart(2, '0')}:${String((h % 1) * 60).padStart(2, '0')}`;
  ck(st.open === want, `${lbl} EAT -> ${st.open ? 'open' : 'shut'} (wanted ${want ? 'open' : 'shut'})`);
}
const wl = winApi.withdrawWindowState(wrap, eatAt(20));
ck(wl.from === '6:00 PM' && wl.to === '5:00 PM',
   `and the member is told "${wl.from} to ${wl.to}"`);

console.log('\n— off, or set to nonsense, means always open —');
ck(winApi.withdrawWindowState({ withdrawWindowEnabled: false, withdrawOpenFrom: '18:00', withdrawOpenTo: '17:00' }, eatAt(17)).open,
   'the toggle off leaves cash-out open at 17:00');
ck(winApi.withdrawWindowState({ withdrawWindowEnabled: true, withdrawOpenFrom: 'x', withdrawOpenTo: '17:00' }, eatAt(3)).open,
   'an unparseable start time does not lock everyone out');
ck(winApi.withdrawWindowState({ withdrawWindowEnabled: true, withdrawOpenFrom: '09:00', withdrawOpenTo: '09:00' }, eatAt(3)).open,
   'equal times are treated as unset, not as closed-all-day');
ck(!winApi.withdrawWindowState({ withdrawWindowEnabled: true, withdrawOpenFrom: 'x', withdrawOpenTo: '17:00' }, eatAt(3)).enabled,
   'and report themselves as not enabled, so the app shows no hours');

// ── the real route, on a stub database ───────────────────────────────────
console.log('\n— the route itself: one unresolved cash-out at a time —');

function run(state, body) {
  // Defaults to 200 because the route's SUCCESS path calls res.json() with no
  // res.status() at all -- reading an unset code as 0 made every accepted
  // cash-out look refused.
  let code = 200, replied = null;
  const res = { status(c) { code = c; return res; }, json(j) { replied = j; return res; } };
  const inc = Symbol('inc');
  const applyInc = (doc, patch) => {
    for (const [k, v] of Object.entries(patch)) {
      if (v && typeof v === 'object' && v[inc] != null) doc[k] = (Number(doc[k]) || 0) + v[inc];
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
    console,
    verifyAuth: async () => 'u1',
    withLock: (_k, fn) => fn(),
    getSettings: async () => state.settings,
    pinCheck: async () => ({ ok: true }),
    cleanPhone: p => String(p || '').replace(/\D/g, '') || '',
    uniqueRef: async () => 'S1',
    nowStr: () => ({ date: '15/01/2026', time: '12:00' }),
    fmtUGX: n => 'UGX ' + Number(n).toLocaleString('en-US'),
    logSecurityEvent: () => {},
    sendAdminPush: async () => {},
    sendWithdrawalSmsAlert: async () => {},
    logAdminAction: () => {},
    NETWORK_NAMES: new Set(['MTN Mobile Money', 'Airtel Money']),
    MAX_MONEY_AMOUNT: 100000000,
    _witRequestInFlight: new Set(),
    _userBeingDeleted: new Set(),
    FieldValue: { increment: n => ({ [inc]: n }), serverTimestamp: () => 1 },
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
      }) };
      if (name === 'bankAccounts') return chain(state.banks);
      if (name === 'withdrawals') return {
        ...chain(state.wits),
        doc: () => { const id = 'w' + (++state.seq); return {
          id, set: async d => { state.wits.push({ id, ...d }); },
          delete: async () => { state.wits = state.wits.filter(w => w.id !== id); } }; },
      };
      return { ...chain([]), add: async d => { state.tx.push(d); return { id: 't1' }; } };
    } },
  };
  const fn = new Function('sandbox', `
    const { console, verifyAuth, withLock, getSettings, pinCheck, cleanPhone,
            uniqueRef, nowStr, fmtUGX, logSecurityEvent, sendAdminPush,
            sendWithdrawalSmsAlert, NETWORK_NAMES, MAX_MONEY_AMOUNT,
            _witRequestInFlight, _userBeingDeleted, FieldValue, db,
            withdrawWindowState } = sandbox;
    let handler;
    const app = { post: (p, h) => { if (p === '/withdraw/request') handler = h; } };
    ${grab("app.post('/withdraw/request'", '// `refunded` MUST be the real')}
    return handler;
  `)(sandbox);
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

  for (const status of ['pending', 'sending', 'processing']) {
    st = fresh({ wits: [{ id: 'w0', userId: 'u1', status, amount: 20000 }] });
    r = await run(st, REQ);
    ck(r.code === 400 && r.replied.code === 'WITHDRAW_PENDING',
       `a ${status} cash-out blocks the next (${r.code} ${r.replied && r.replied.code})`);
    ck(/already have a cash-out/i.test((r.replied || {}).message || ''),
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

  console.log('\n— the hours are enforced on the server, not just drawn in the app —');
  st = fresh({ settings: { withdrawWindowEnabled: true, withdrawOpenFrom: '09:00', withdrawOpenTo: '17:00' } });
  st.now = eatAt(21);
  r = await run(st, REQ);
  ck(r.code === 400 && r.replied.code === 'WINDOW_CLOSED',
     `21:00 EAT is refused (${r.code} ${r.replied && r.replied.code})`);
  ck(/9:00 AM to 5:00 PM/.test((r.replied || {}).message || ''),
     `  naming the hours: ${(r.replied || {}).message}`);
  ck(st.user.walletBalance === 100000, '  and nothing is debited');

  st = fresh({ settings: { withdrawWindowEnabled: true, withdrawOpenFrom: '09:00', withdrawOpenTo: '17:00' } });
  st.now = eatAt(12);
  r = await run(st, REQ);
  ck(r.code === 200, `12:00 EAT goes through (${r.code})`);

  // His own wrap window, through the real route.
  st = fresh({ settings: { withdrawWindowEnabled: true, withdrawOpenFrom: '18:00', withdrawOpenTo: '17:00' } });
  st.now = eatAt(2);
  r = await run(st, REQ);
  ck(r.code === 200, `02:00 EAT goes through on an 18:00-to-17:00 window (${r.code})`);
  st = fresh({ settings: { withdrawWindowEnabled: true, withdrawOpenFrom: '18:00', withdrawOpenTo: '17:00' } });
  st.now = eatAt(17, 30);
  r = await run(st, REQ);
  ck(r.code === 400 && r.replied.code === 'WINDOW_CLOSED',
     `and 17:30, the one shut hour, is refused (${r.code})`);

  console.log('\n— the app no longer promises hours nobody keeps —');
  const mod = fs.readFileSync(__dirname + '/user-src/original_module.js', 'utf8');
  ck(!/Withdrawal time: 06:00:00 - 17:00:00/.test(mod),
     'the hardcoded "Withdrawal time: 06:00:00 - 17:00:00." line is gone');
  ck(!/There is no limit to the number of withdrawals/.test(mod),
     'and so is "There is no limit to the number of withdrawals"');
  ck(/withdrawHoursLine\(/.test(mod), 'the hours line is built from the real setting');
  ck(/One cash-out at a time/.test(mod), 'and the one-at-a-time rule is stated to the member');

  console.log('\n— admin can set it —');
  const adm = fs.readFileSync(__dirname + '/admin-src/index.html', 'utf8');
  ck(/id="sWitWindow"/.test(adm), 'there is a toggle');
  ck(/id="sWitFrom"[^>]*type="time"/.test(adm), 'an opening time input');
  ck(/id="sWitTo"[^>]*type="time"/.test(adm), 'a closing time input');
  ck(/withdrawOpenFrom:\$\('sWitFrom'\)\.value/.test(adm.replace(/\s+/g, '')) ||
     /withdrawOpenFrom:\$\('sWitFrom'\)\.value/.test(adm),
     'and all three are sent on save');
  const boolLine = (/const SETTINGS_BOOLEAN_FIELDS[^\n]*/.exec(src) || [''])[0];
  ck(/withdrawWindowEnabled/.test(boolLine),
     'the toggle is coerced to a real boolean server-side');
  // 400 chars, not 200: the real gap between the loop header and its refusal
  // message is 264, and the first attempt's window was too small to reach it.
  ck(/\['withdrawOpenFrom', 'withdrawOpenTo'\][\s\S]{0,700}must be a 24-hour time/.test(src),
     'and a bad time string is refused rather than quietly repaired');
  ck(/opening and closing times cannot be the same/.test(src),
     'as are two identical times, which would show hours nobody enforces');

  console.log(bad ? `\n${bad} FAILED` : '\nwithdraw rules: all cases pass');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('CRASHED:', e); process.exit(1); });
