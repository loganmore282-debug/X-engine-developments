#!/usr/bin/env node
/**
 * Can a product spin and the daily spin override each other?
 *
 * Owner: "what if a product spin and a daily spin combine together, can't it
 * override??"
 *
 * The answer has to come from RUNNING the real handler, not from reading it.
 * test-spin-and-withdraw.js already scans this code for the rules it must
 * contain; this file executes /turntable/spin and grantTurntableSpins against
 * a stub database and watches what actually happens to each entitlement --
 * which is the only way to show that spending one does not consume, shrink or
 * reprice the other.
 *
 * Also pinned here, because it is the one real defect the question surfaced:
 * the balance the endpoint hands back is RE-READ after the credit, not the
 * pre-credit snapshot plus the reward. A commission landing mid-spin used to
 * make the win popup count up to a figure lower than the member's real money.
 */
const fs = require('fs');
const crypto = require('crypto');
const src = fs.readFileSync(__dirname + '/server.js', 'utf8');

let bad = 0;
const ck = (o, l) => { if (!o) bad++; console.log((o ? 'PASS  ' : 'FAIL  ') + l); };

// Extracts one named function by matching its braces.
//
// The `async` is part of the name match on purpose. Searching for
// "function <name>(" alone finds the right place in an `async function` too,
// but starts the slice AFTER the async keyword -- so the extracted source is a
// plain function full of `await`, and `new Function` throws "await is only
// valid in async functions" on a file that is perfectly correct. Both
// functions this test needs are async, and that is exactly how it first
// failed.
// Read a constant out of server.js rather than restating it here. A number
// copied into a test is a second source of truth that nobody updates: raising
// MAX_SPINS_PER_PURCHASE once left four hand-written 20s behind in three
// harnesses, one of which went on clamping a fixture at the old cap while the
// shipped code allowed the new one.
function serverConst(name) {
  const m = new RegExp('(?:var|const) ' + name + ' = (\\d+)').exec(src);
  if (!m) throw new Error('no such constant in server.js: ' + name);
  return Number(m[1]);
}
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

// ── a stub database, just enough for these two code paths ────────────────
// Deliberately NOT a mock that returns canned answers: it stores documents
// and applies the real updates, so "was the product spin still unused after
// the daily one" is answered by the stored state rather than by an
// expectation someone wrote down.
function makeDb(state) {
  const inc = Symbol('inc');
  const applyInc = (doc, patch) => {
    for (const [k, v] of Object.entries(patch)) {
      if (v && typeof v === 'object' && v[inc] != null) doc[k] = (Number(doc[k]) || 0) + v[inc];
      else doc[k] = v;
    }
  };
  const FieldValue = {
    increment: n => ({ [inc]: n }),
    serverTimestamp: () => state.clock++,
  };
  const spinsOf = () => state.spins;
  const q = (filters, order, lim) => {
    let rows = spinsOf().filter(s => filters.every(([f, op, v]) =>
      op === '==' ? s[f] === v : true));
    if (order) rows = rows.slice().sort((a, b) => (a[order] || 0) - (b[order] || 0));
    if (lim != null) rows = rows.slice(0, lim);
    return rows;
  };
  const snapOf = rows => ({
    empty: rows.length === 0, size: rows.length,
    docs: rows.map(r => ({
      // Frozen data, LIVE ref -- same split as a real snapshot, and the
      // reason updateIf() can tell a stale reader from a fresh one.
      id: r.id, data: (frozen => () => frozen)({ ...r }),
      ref: {
        update: async p => { applyInc(r, p); },
        updateIf: async (cond, p) => {
          for (const [k, v] of Object.entries(cond)) if (r[k] !== v) return false;
          applyInc(r, p); return true;
        },
      },
    })),
  });
  function chain(name, filters = [], order = null, lim = null) {
    return {
      where: (f, op, v) => chain(name, filters.concat([[f, op, v]]), order, lim),
      orderBy: f => chain(name, filters, f, lim),
      limit: n => chain(name, filters, order, n),
      get: async () => snapOf(q(filters, order, lim)),
      count: async () => q(filters, order, lim).length,
    };
  }
  const db = {
    collection: name => ({
      ...chain(name),
      doc: id => ({
        get: async () => {
          // A BARRIER, when one is armed: every arriving read blocks until N
          // of them have arrived, then they all return the same pre-write
          // state. That is the two-process race, made deterministic.
          //
          // Without it the interleaving is left to the event loop, and it did
          // not happen: the second handler's read landed AFTER the first
          // one's write, so removing the conditional write changed nothing
          // and the mutation went unnoticed. A race test that depends on
          // lucky scheduling is not a test.
          if (state.barrier) {
            const bar = state.barrier;
            bar.arrived.push(1);
            if (bar.arrived.length >= bar.n) bar.release();
            await bar.gate;
          }
          const u = state.users[id];
          // A credit landing AFTER the handler has read the user, which is
          // precisely the window the stale-snapshot bug lived in. Fired from
          // here rather than a setTimeout: a timer races the handler's own
          // awaits, and the first version of this test lost the injection
          // altogether and reported a fixed endpoint as broken.
          // A SNAPSHOT IS A COPY, taken now. Returning the live object was
          // the single worst piece of infidelity in this stub: every read
          // then saw writes that happened after it, so a second process
          // reading before the first one's write still observed that write
          // and correctly bailed out -- which made the conditional-write
          // mutations look harmless. Two of them went unnoticed until this
          // was fixed. Real snapshots are immutable point-in-time reads and
          // the whole point of updateIf() is the gap between them.
          const frozen = { ...u };
          if (state.creditAfterRead != null) {
            const amt = state.creditAfterRead; state.creditAfterRead = null;
            u.walletBalance = (Number(u.walletBalance) || 0) + amt;
          }
          return { exists: !!u, data: () => frozen, ref: null };
        },
        update: async p => { applyInc(state.users[id], p); },
        updateIf: async (cond, p) => {
          const u = state.users[id];
          for (const [k, v] of Object.entries(cond)) {
            const have = u[k] == null ? null : u[k];
            if (have !== v) return false;
          }
          applyInc(u, p); return true;
        },
        createIfAbsent: async doc => {
          const rows = name === 'turntableSpins' ? state.spins : state.tx;
          if (rows.some(r => r.id === id)) return false;
          rows.push({ id, ...doc });
          return true;
        },
      }),
      add: async doc => {
        const id = 'd' + (++state.seq);
        if (name === 'turntableSpins') state.spins.push({ id, ...doc, createdAt: state.clock++ });
        else state.tx.push({ id, ...doc });
        return { id };
      },
    }),
  };
  // db.collection('users').doc(id) needs a live ref whose update/updateIf hit
  // the same object the handler already read, so it is wired here rather than
  // inside get().
  const origColl = db.collection;
  db.collection = name => {
    const c = origColl(name);
    if (name !== 'users') return c;
    const origDoc = c.doc;
    return { ...c, doc: id => {
      const d = origDoc(id);
      const ref = { get: d.get, update: d.update, updateIf: d.updateIf };
      return { ...d, get: async () => ({ ...(await d.get()), ref }) };
    } };
  };
  return { db, FieldValue };
}

// One real lock implementation, so concurrency is exercised rather than
// assumed. Same shape as server.js's: a promise chain per key.
function makeLock() {
  const chains = new Map();
  return function withLock(key, fn) {
    const prev = chains.get(key) || Promise.resolve();
    const run = prev.then(fn, fn);
    chains.set(key, run.then(() => {}, () => {}));
    return run;
  };
}

const SETTINGS = {
  turntableEnabled: true, turntableDailyMin: 200, turntableDailyMax: 1000,
};
const PRODUCT = { key: 'p9', name: 'Mega', spinCount: 2, spinMin: 5000, spinMax: 9000 };

function build(state, opts = {}) {
  const { db, FieldValue } = makeDb(state);
  const withLock = makeLock();
  const sandbox = {
    db, FieldValue, crypto, console,
    withLock,
    verifyAuth: async () => 'u1',
    getSettings: async () => ({ ...SETTINGS, ...(opts.settings || {}) }),
    nowStr: () => ({ date: '01/01/2026', time: '00:00' }),
    eatDayKey: d => new Date(d).toISOString().slice(0, 10),
    eatNextMidnight: () => 9999999999999,
    MAX_MONEY_AMOUNT: 100000000,
    // Read out of server.js so the sandbox exercises the bound that actually
    // ships. It was a hand-copied 20; when the real cap moved to 200 that copy
    // would have silently kept clamping this fixture at the old number.
    MAX_SPINS_PER_PURCHASE: Number((/const MAX_SPINS_PER_PURCHASE = (\d+);/.exec(src) || [])[1]),
  };
  const code = `
    const { db, FieldValue, crypto, console, withLock, verifyAuth, getSettings,
            nowStr, eatDayKey, eatNextMidnight, MAX_MONEY_AMOUNT,
            MAX_SPINS_PER_PURCHASE } = sandbox;
    const round2 = n => Math.round(n * 100) / 100;
    const finiteMoney = n => { const x = Number(n); return Number.isFinite(x) ? x : 0; };
    const SPIN_SLICES = ${serverConst('SPIN_SLICES')};
    ${fnSource('spinWheelSlices')}
    ${fnSource('rollSpinSlice')}
    ${fnSource('rollSpinReward')}
    ${fnSource('spinBandOf')}
    ${fnSource('turntableDailyReward')}
    ${fnSource('grantTurntableSpins')}
    ${fnSource('writeTurntableSpinDocs')}
    let spinHandler;
    const app = { post: (p, h) => { if (p === '/turntable/spin') spinHandler = h; },
                  get: () => {} };
    ${grab("app.post('/turntable/spin'", '// INVESTMENTS')}
    return { spinHandler, grantTurntableSpins };
  `;
  return new Function('sandbox', code)(sandbox);
}

async function spin(api, state, opts = {}) {
  let code = 0, body = null;
  const res = { status(c) { code = c; return res; }, json(j) { body = j; return res; } };
  if (opts.creditDuring) state.creditAfterRead = opts.creditDuring;
  await api.spinHandler({ headers: {} }, res);
  return { code, body };
}

function freshState(extra = {}) {
  return {
    users: { u1: { walletBalance: 10000, totalEarned: 0, status: 'active',
                   lastTurntableAt: null, ...extra } },
    spins: [], tx: [], seq: 0, clock: 1, barrier: null,
  };
}
// Arms a barrier that holds the first `n` user reads until all `n` have
// arrived. Cleared automatically once released, so later reads run normally.
function armBarrier(state, n) {
  let release;
  const gate = new Promise(r => { release = r; });
  state.barrier = { n, arrived: [], gate, release: () => { state.barrier = null; release(); } };
}

(async () => {
  // ── 1. the daily spin does not touch product spins ─────────────────────
  console.log('— the daily spin and product spins are separate stores —');
  let st = freshState();
  let api = build(st);
  await api.grantTurntableSpins('u1', PRODUCT, 'inv1');
  ck(st.spins.length === 2, `a purchase granted its 2 spins (${st.spins.length})`);

  let r = await spin(api, st);
  ck(r.code === 200 && r.body.source === 'daily',
     `the first spin of the day is the DAILY one (${r.body && r.body.source})`);
  ck(r.body.reward >= 200 && r.body.reward <= 1000,
     `paid from the daily band, not the product's (${r.body && r.body.reward})`);
  ck(st.spins.filter(s => !s.used).length === 2,
     `and BOTH product spins are still unused (${st.spins.filter(s => !s.used).length})`);
  ck(r.body.earnedSpins === 2, `the response still reports them (${r.body.earnedSpins})`);

  // ── 2. they queue, they do not collide ─────────────────────────────────
  console.log('\n— all three are spendable, each from its own band —');
  const rewards = [r.body.reward];
  for (let i = 0; i < 2; i++) {
    const n = await spin(api, st);
    ck(n.code === 200 && n.body.source === 'product',
       `spin ${i + 2} falls through to a product spin (${n.body && n.body.source})`);
    ck(n.body.reward >= 5000 && n.body.reward <= 9000,
       `paid from the PRODUCT band, which the daily band cannot shrink (${n.body && n.body.reward})`);
    rewards.push(n.body.reward);
  }
  ck(st.spins.every(s => s.used === true), 'both product spins are now burnt');
  const fourth = await spin(api, st);
  ck(fourth.code === 400, `a fourth spin is refused (${fourth.code})`);
  ck(/no spins left/i.test((fourth.body || {}).message || ''),
     `and says so (${(fourth.body || {}).message})`);
  // Nothing was lost or double-paid: the wallet moved by exactly the sum.
  const expected = 10000 + rewards.reduce((a, b) => a + b, 0);
  ck(Math.abs(st.users.u1.walletBalance - expected) < 0.005,
     `the wallet moved by exactly the three rewards (${st.users.u1.walletBalance} vs ${expected})`);
  ck(st.tx.length === 3, `with one ledger row each, no more (${st.tx.length})`);

  // ── 3. two taps at once cannot both win ────────────────────────────────
  console.log('\n— two taps landing together —');
  st = freshState(); api = build(st);
  let both = await Promise.all([spin(api, st), spin(api, st)]);
  let paid = both.filter(x => x.code === 200);
  ck(paid.length === 1, `exactly one of two simultaneous daily taps pays (${paid.length})`);
  ck(st.tx.length === 1, `and exactly one ledger row exists (${st.tx.length})`);

  st = freshState({ lastTurntableAt: Date.now() });   // daily already used TODAY
  api = build(st);
  await api.grantTurntableSpins('u1', { ...PRODUCT, spinCount: 1 }, 'inv2');
  both = await Promise.all([spin(api, st), spin(api, st)]);
  paid = both.filter(x => x.code === 200);
  ck(paid.length === 1, `and one of two taps on a SINGLE product spin pays (${paid.length})`);
  ck(st.spins.filter(s => !s.used).length === 0, 'the one spin is burnt, not two');

  // ── 3b. two SERVER PROCESSES, one database ─────────────────────────────
  // withLock() is an in-process promise chain: it serialises taps inside ONE
  // node process and nothing more. Render can run more than one instance, and
  // then the only thing standing between two simultaneous taps and two
  // payouts is the conditional write. Two `build()`s share `state` but get
  // their OWN lock, which is exactly that situation -- and without it the
  // earlier concurrency cases could not tell updateIf() from a plain update.
  console.log('\n— two server processes, one database —');
  st = freshState();
  let a1 = build(st), a2 = build(st);
  armBarrier(st, 2);
  both = await Promise.all([spin(a1, st), spin(a2, st)]);
  paid = both.filter(x => x.code === 200);
  ck(paid.length === 1,
     `only one process pays the daily spin (${paid.length} paid: ${both.map(x => x.code).join(',')})`);
  ck(st.tx.length === 1, `one ledger row (${st.tx.length})`);

  st = freshState({ lastTurntableAt: Date.now() });
  a1 = build(st); a2 = build(st);
  await a1.grantTurntableSpins('u1', { ...PRODUCT, spinCount: 1 }, 'invP');
  armBarrier(st, 2);
  both = await Promise.all([spin(a1, st), spin(a2, st)]);
  paid = both.filter(x => x.code === 200);
  ck(paid.length === 1,
     `and only one pays a single product spin (${paid.length} paid: ${both.map(x => x.code).join(',')})`);
  ck(st.spins.filter(s => s.used).length === 1, 'the spin is burnt exactly once');

  // ── 4. the balance handed back is the real one ─────────────────────────
  console.log('\n— the returned balance survives a credit landing mid-spin —');
  st = freshState(); api = build(st);
  r = await spin(api, st, { creditDuring: 7500 });
  ck(r.code === 200, 'the spin still succeeds');
  ck(Math.abs(r.body.walletBalance - st.users.u1.walletBalance) < 0.005,
     `the reported balance equals the stored one (${r.body.walletBalance} vs ${st.users.u1.walletBalance})`);
  ck(r.body.walletBalance > 10000 + r.body.reward,
     `and includes the ${7500} that arrived mid-spin, which the old ` +
     `snapshot arithmetic dropped (${r.body.walletBalance})`);

  // ── 5. granting twice for one purchase grants once ─────────────────────
  console.log('\n— a purchase cannot grant its spins twice —');
  st = freshState(); api = build(st);
  await Promise.all([
    api.grantTurntableSpins('u1', PRODUCT, 'inv9'),
    api.grantTurntableSpins('u1', PRODUCT, 'inv9'),
  ]);
  ck(st.spins.length === 2,
     `two concurrent grants for one investment still give 2 spins, not 4 (${st.spins.length})`);
  await api.grantTurntableSpins('u1', PRODUCT, 'inv10');
  ck(st.spins.length === 4, `a DIFFERENT purchase still grants its own (${st.spins.length})`);

  // ── 6. the band is the one snapshotted at purchase ─────────────────────
  console.log('\n— retuning a product cannot reprice a spin already earned —');
  st = freshState({ lastTurntableAt: Date.now() });
  api = build(st);
  await api.grantTurntableSpins('u1', { ...PRODUCT, spinCount: 1, spinMin: 8000, spinMax: 8000 }, 'invA');
  // The admin now slashes the product's band. The stored spin must not care.
  const after = await spin(api, st);
  ck(after.body.reward === 8000,
     `the spin pays its own snapshot band (${after.body && after.body.reward})`);

  console.log(bad ? `\n${bad} FAILED` : '\nspin sources: all cases pass');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('CRASHED:', e); process.exit(1); });
