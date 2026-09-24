#!/usr/bin/env node
/**
 * Can one day's check-in credit the wallet twice?
 *
 * Audit finding (CONFIRMED, critical). The handler credited the user document
 * and then wrote the ledger row. But eligibility was reconstructed from the
 * LEDGER -- computeCheckinStreak() reads the transactions collection and
 * returns the newest row's timestamp -- while the claim was written to the
 * USER DOCUMENT. Two different facts. So a ledger write that failed after the
 * money landed returned 500, and the retry saw a ledger with no row for
 * today and credited the wallet again. Once per failed write, repeatable.
 *
 * withLock() never covered this: the retry is a NEW request, arriving long
 * after that lock has been released.
 *
 * So this RUNS the real handler against a stub database and makes the ledger
 * write fail on demand, which is the only way to show the hole is shut. The
 * three things it has to prove:
 *   1. a normal second attempt on the same day credits nothing;
 *   2. an attempt after a FAILED ledger write credits nothing either;
 *   3. and the missing ledger row is repaired rather than left as a hole,
 *      because the streak is still derived from the ledger.
 */
const fs = require('fs');
const crypto = require('crypto');
const src = fs.readFileSync(__dirname + '/server.js', 'utf8');

let bad = 0;
const ck = (o, l) => { if (!o) bad++; console.log((o ? 'PASS  ' : 'FAIL  ') + l); };

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
const grab = (from, to) => {
  const a = src.indexOf(from), b = src.indexOf(to);
  if (a < 0 || b <= a) throw new Error(`grab(): marker missing -- ${a < 0 ? from : to}`);
  return src.slice(a, b);
};

// ── the stub database ─────────────────────────────────────────────────────
// Deliberately models only what /checkin touches, but models it HONESTLY:
// updateIf really is conditional, createIfAbsent really refuses to overwrite,
// and the ledger write can be made to throw.
function makeDb(state) {
  const applyInc = (obj, patch) => {
    for (const [k, v] of Object.entries(patch)) {
      if (v && typeof v === 'object' && v.__inc !== undefined) obj[k] = (Number(obj[k]) || 0) + v.__inc;
      else obj[k] = v;
    }
  };
  const FieldValue = {
    increment: n => ({ __inc: n }),
    serverTimestamp: () => state.clock++,
  };
  const db = {
    collection: name => ({
      where() { return this; },
      orderBy() { return this; },
      limit() { return this; },
      get: async () => {
        const rows = name === 'transactions'
          ? state.tx.filter(t => t.userId === 'u1' && t.type === 'checkin') : [];
        return { docs: rows.map(r => ({ id: r.id, data: () => r })), empty: !rows.length, size: rows.length };
      },
      doc: id => ({
        get: async () => {
          const u = state.users[id];
          // A snapshot is a COPY taken at read time. Returning the live
          // object would let a second reader observe the first's write and
          // bail out on its own, which makes the conditional write look
          // redundant when it is the only thing standing between two
          // processes and a double credit.
          const frozen = { ...u };
          if (state.barrier) await state.barrier();
          return { exists: !!u, data: () => frozen };
        },
        update: async p => { applyInc(state.users[id], p); },
        updateIf: async (cond, p) => {
          const u = state.users[id];
          for (const [k, v] of Object.entries(cond)) {
            const have = u[k] == null ? null : u[k];
            // Only $ne is used by this handler.
            if (v && typeof v === 'object' && '$ne' in v) { if (have === v.$ne) return false; }
            else if (have !== v) return false;
          }
          applyInc(u, p); return true;
        },
        createIfAbsent: async doc => {
          if (state.failLedger) throw new Error('ledger write failed');
          if (state.tx.some(r => r.id === id)) return false;
          state.tx.push({ id, ...doc });
          return true;
        },
      }),
      add: async doc => {
        if (state.failLedger) throw new Error('ledger write failed');
        const id = 'd' + (++state.seq);
        state.tx.push({ id, ...doc });
        return { id };
      },
    }),
  };
  // The handler does `ref.updateIf(...)` on a ref it got from doc(), and the
  // same object must be mutated that get() read from.
  const origColl = db.collection;
  db.collection = name => {
    const c = origColl(name);
    if (name !== 'users') return c;
    const origDoc = c.doc;
    return { ...c, doc: id => origDoc(id) };
  };
  return { db, FieldValue };
}
function makeLock() {
  const chains = new Map();
  return function withLock(key, fn) {
    const prev = chains.get(key) || Promise.resolve();
    const run = prev.then(fn, fn);
    chains.set(key, run.then(() => {}, () => {}));
    return run;
  };
}

const DAY = '2026-03-04';
function build(state) {
  const { db, FieldValue } = makeDb(state);
  const sandbox = {
    db, FieldValue, crypto, console,
    withLock: makeLock(),
    verifyAuth: async () => 'u1',
    getSettings: async () => ({ dailyCheckin: 500 }),
    nowStr: () => ({ date: '04/03/2026', time: '09:00' }),
    // A fixed "today" so the test does not depend on when it is run.
    eatDayKey: d => new Date(d).toISOString().slice(0, 10),
    eatNextMidnight: () => 9999999999999,
    tsMillis: v => (typeof v === 'number' ? v : 0),
    logSecurityEvent: () => {},
    Date_now: () => Date.parse(DAY + 'T09:00:00Z'),
  };
  const code = `
    const { db, FieldValue, crypto, console, withLock, verifyAuth, getSettings,
            nowStr, eatDayKey, eatNextMidnight, tsMillis, logSecurityEvent, Date_now } = sandbox;
    const Date = globalThis.Date;
    const tzOffMs = () => 180 * 60000;
    // Pin "now" without touching the real clock.
    const _origNow = Date.now;
    Date.now = Date_now;
    ${fnSource('computeCheckinStreak')}
    ${fnSource('statementStamp')}
    ${fnSource('newStatementId')}
    let checkinHandler;
    const app = { post: (p, h) => { if (p === '/checkin') checkinHandler = h; }, get: () => {} };
    ${grab("app.post('/checkin'", '// TURNTABLE (daily spin wheel)')}
    return { checkinHandler, restore: () => { Date.now = _origNow; } };
  `;
  return new Function('sandbox', code)(sandbox);
}
async function checkin(api) {
  let code = 0, body = null;
  const res = { status(c) { code = c; return res; }, json(j) { body = j; return res; } };
  await api.checkinHandler({ headers: {} }, res);
  return { code, body };
}
const freshState = () => ({
  users: { u1: { walletBalance: 0, totalEarned: 0, checkinStreak: 0, lastCheckinAt: null, lastCheckinClaimDay: null } },
  tx: [], seq: 0, clock: 1, failLedger: false,
});

(async () => {
  console.log('— one check-in, one credit —');
  {
    const state = freshState();
    const api = build(state);
    const first = await checkin(api);
    api.restore();
    ck(first.code === 200 && first.body.bonus === 500, `the first check-in pays (${first.code})`);
    ck(state.users.u1.walletBalance === 500, `wallet is 500 (${state.users.u1.walletBalance})`);
    ck(state.users.u1.lastCheckinClaimDay === DAY, `the day is claimed on the user document (${state.users.u1.lastCheckinClaimDay})`);
    ck(state.tx.length === 1, `one ledger row (${state.tx.length})`);
  }
  console.log('\n— a second attempt the same day pays nothing —');
  {
    const state = freshState();
    const api = build(state);
    await checkin(api);
    const second = await checkin(api);
    api.restore();
    ck(second.code === 400, `refused (${second.code})`);
    ck(state.users.u1.walletBalance === 500, `wallet is still 500 (${state.users.u1.walletBalance})`);
    ck(state.tx.length === 1, `still one ledger row (${state.tx.length})`);
  }
  console.log('\n— THE REPORTED DEFECT: the ledger write fails after the credit —');
  {
    const state = freshState();
    const api = build(state);
    state.failLedger = true;
    const first = await checkin(api);
    ck(state.users.u1.walletBalance === 500, `the money landed (${state.users.u1.walletBalance})`);
    ck(state.tx.length === 0, 'and the ledger row did not');
    ck(first.code === 200, 'the endpoint still answers success, because the balance IS correct');
    // The retry. Before the fix this credited a second time, because
    // eligibility was rebuilt from a ledger that has no row for today.
    state.failLedger = false;
    const retry = await checkin(api);
    api.restore();
    ck(state.users.u1.walletBalance === 500,
       `THE RETRY CREDITS NOTHING -- wallet is still 500, not 1000 (${state.users.u1.walletBalance})`);
    ck(retry.code === 400, `and it is refused as already claimed (${retry.code})`);
    // The hole is repaired, or tomorrow's streak would reset because the
    // streak is still derived from the ledger.
    ck(state.tx.length === 1, `the missing ledger row is repaired, not duplicated (${state.tx.length})`);
    ck(state.tx[0].id === `checkin:u1:${DAY}`,
       `under a deterministic id, which is what makes the repair safe (${state.tx[0].id})`);
  }
  console.log('\n— many retries after a failed ledger write still pay once —');
  {
    const state = freshState();
    const api = build(state);
    state.failLedger = true;
    await checkin(api);
    state.failLedger = false;
    for (let i = 0; i < 5; i++) await checkin(api);
    api.restore();
    ck(state.users.u1.walletBalance === 500,
       `five retries, wallet still 500 (${state.users.u1.walletBalance})`);
    ck(state.tx.length === 1, `and exactly one ledger row (${state.tx.length})`);
  }
  console.log('\n— two server processes, same day, same member —');
  {
    // withLock() is an in-process promise chain, so it serialises taps inside
    // ONE process and nothing more. On two Render instances both can read a
    // day that looks unclaimed. The conditional write is the only thing that
    // decides between them -- and the loser must be REFUSED, not told it won
    // a bonus that was never credited.
    const state = freshState();
    let arrived = 0, release;
    const gate = new Promise(r => { release = r; });
    state.barrier = async () => { if (++arrived >= 2) release(); await gate; };
    // Two build()s over one state = two processes with separate locks.
    const a = build(state), b = build(state);
    const [ra, rb] = await Promise.all([checkin(a), checkin(b)]);
    a.restore(); b.restore();
    const codes = [ra.code, rb.code].sort();
    ck(state.users.u1.walletBalance === 500,
       `only one credit landed -- wallet is 500, not 1000 (${state.users.u1.walletBalance})`);
    ck(state.tx.length === 1, `and one ledger row (${state.tx.length})`);
    ck(codes[0] === 200 && codes[1] === 400,
       `one wins and the other is REFUSED, not told it won (${codes.join('/')})`);
  }

  console.log('\n— a member who claimed BEFORE this field existed is not paid again —');
  {
    // Deploy-day migration: no lastCheckinClaimDay, but a ledger row for
    // today. Without the second half of the gate this would hand everyone
    // who had already checked in that day one extra bonus.
    const state = freshState();
    state.tx.push({ id: 'legacy1', userId: 'u1', type: 'checkin', amount: 500,
                    createdAt: Date.parse(DAY + 'T06:00:00Z') });
    state.users.u1.lastCheckinAt = Date.parse(DAY + 'T06:00:00Z');
    state.users.u1.checkinStreak = 3;
    const api = build(state);
    const r = await checkin(api);
    api.restore();
    ck(r.code === 400, `refused on the ledger row alone (${r.code})`);
    ck(state.users.u1.walletBalance === 0, `nothing credited (${state.users.u1.walletBalance})`);
  }
  console.log(bad ? `\n${bad} FAILED` : '\ncheck-in idempotency: all cases pass');
  process.exit(bad ? 1 : 0);
})();
