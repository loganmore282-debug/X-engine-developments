'use strict';
// The spin wheel's ten sections (owner: "make when l can edit chances, rewards, they will be 10 sections"): what is accepted, that the draw follows the
// chances, that zero chances never win and a zero amount pays nothing, and that members never get the chances. Real server.js source.
(async () => {
const fs = require('node:fs'), crypto = require('node:crypto'), assert = require('node:assert/strict');
let checks = 0; const ok = (c, m) => { checks++; assert.ok(c, m); }; const eq = (a, b, m) => { checks++; assert.deepEqual(a, b, m); };
const src = fs.readFileSync(__dirname + '/server.js', 'utf8');
const a = src.indexOf('// ── SPIN WHEEL: ten sections the owner edits'), b = src.indexOf('var SPIN_SLICES = 8;');
ok(a >= 0 && b > a, 'wheel block found');
const W = new Function('crypto', 'MAX_MONEY_AMOUNT', 'round2', 'rollSpinSlice',
  src.slice(a, b) + '\nreturn { defaultTurntableSlices, normalizeTurntableSlices, rollConfiguredSlice, spinSlicesOf, rollSpinFor, TURNTABLE_SLICE_COUNT };')(
  crypto, 1e9, n => Math.round(n * 100) / 100, (lo, hi) => ({ slices: [lo], index: 0, amount: lo, old: true }));

// ── the default wheel is valid and has ten sections ──
const def = W.defaultTurntableSlices();
eq(def.length, 10, 'ten default sections'); ok(W.normalizeTurntableSlices(def), 'the default wheel is accepted');
// ── what the panel may save ──
const mk = (r, w) => Array.from({ length: 10 }, (_, i) => ({ reward: r(i), weight: w(i) }));
ok(W.normalizeTurntableSlices(mk(i => i * 100, () => 1)), 'ten sections with amounts and chances');
eq(W.normalizeTurntableSlices(mk(i => i * 100, () => 1)).length, 10, 'ten come back');
ok(W.normalizeTurntableSlices(mk(() => 0, i => (i === 3 ? 5 : 0))), 'a zero amount ("try again") is allowed while one chance is above 0');
ok(W.normalizeTurntableSlices(def.slice(0, 9)) === null, 'nine sections are refused');
ok(W.normalizeTurntableSlices(def.concat([{ reward: 1, weight: 1 }])) === null, 'eleven sections are refused');
ok(W.normalizeTurntableSlices('x') === null && W.normalizeTurntableSlices(null) === null && W.normalizeTurntableSlices({}) === null, 'not a list is refused');
ok(W.normalizeTurntableSlices(mk(i => i, () => 0)) === null, 'all chances 0 is refused (nothing could ever win)');
ok(W.normalizeTurntableSlices(mk(i => (i === 2 ? -5 : 10), () => 1)) === null, 'a negative amount is refused');
ok(W.normalizeTurntableSlices(mk(i => (i === 2 ? 'abc' : 10), () => 1)) === null, 'an amount that is not a number is refused');
ok(W.normalizeTurntableSlices(mk(() => 10, i => (i === 4 ? -1 : 1))) === null, 'a negative chance is refused');
ok(W.normalizeTurntableSlices(mk(() => 10, i => (i === 4 ? NaN : 1))) === null, 'a chance that is not a number is refused');
ok(W.normalizeTurntableSlices(mk(() => 2e9, () => 1)) === null, 'an amount above the money limit is refused');
ok(W.normalizeTurntableSlices(def.map((x, i) => (i === 0 ? null : x))) === null, 'an empty row is refused');
eq(W.normalizeTurntableSlices(mk(() => 12.345, () => 1.239))[0], { reward: 12.35, weight: 1.24 }, 'amounts and chances are kept to 2 decimals');
eq(W.normalizeTurntableSlices(mk(() => '300', () => '2'))[0], { reward: 300, weight: 2 }, 'typed numbers (text from the form) are read');

// ── the draw follows the chances ──
{ const wheel = mk(i => (i + 1) * 100, i => (i === 9 ? 1 : 0));
  for (let k = 0; k < 500; k++) { const r = W.rollConfiguredSlice(wheel); if (r.index !== 9 || r.amount !== 1000) { ok(false, 'only the section with a chance can win'); break; } }
  ok(true, 'only the section with a chance wins (500 spins)'); }
{ const wheel = mk(i => (i + 1) * 100, i => (i === 0 ? 1 : i === 1 ? 3 : 0)); const n = [0, 0]; const N = 40000;
  for (let k = 0; k < N; k++) { const r = W.rollConfiguredSlice(wheel); ok(r.index === 0 || r.index === 1, 'index in play'); n[r.index]++; }
  const share = n[1] / N; ok(share > 0.72 && share < 0.78, 'a chance of 3 against 1 wins about 75% (got ' + (share * 100).toFixed(1) + '%)'); }
{ const r = W.rollConfiguredSlice(def); eq(r.slices, def.map(x => x.reward), 'the roll hands back the ten amounts the wheel shows'); ok(r.amount === r.slices[r.index], 'the amount paid is exactly the section it stopped on'); }
{ const wheel = mk(i => (i === 5 ? 0 : 100), i => (i === 5 ? 1 : 0)); const r = W.rollConfiguredSlice(wheel); eq([r.index, r.amount], [5, 0], 'a zero section pays 0'); }
// decimals in the chances still add up
{ const wheel = mk(() => 7, i => (i === 0 ? 0.01 : i === 1 ? 0.01 : 0)); const seen = new Set(); for (let k = 0; k < 400; k++) seen.add(W.rollConfiguredSlice(wheel).index); ok([...seen].every(i => i === 0 || i === 1), 'tiny chances (0.01) work'); }

// ── which wheel is used ──
ok(W.rollSpinFor({ turntableSlices: def }, 5, 9).old !== true, 'with the owner\'s ten sections the old band is not used');
ok(W.rollSpinFor({}, 5, 9).old === true, 'only if the sections are missing or broken the old band is the fallback');
ok(W.rollSpinFor({ turntableSlices: def.slice(0, 3) }, 5, 9).old === true, 'a broken list falls back too');

// ── the server wires it in ──
ok(/turntableSlices: defaultTurntableSlices\(\)/.test(src), 'the default settings carry the ten sections');
ok((src.match(/roll = rollSpinFor\(sett,/g) || []).length === 2, 'both the free daily spin and the earned spin draw from the same wheel');
ok(/if \(reward > 0\) await withLock\('bal:' \+ uid/.test(src) && /if \(reward > 0\) await db\.collection\('transactions'\)/.test(src), 'a zero section moves no money and writes no row');
ok(/const \{ maintenanceMsg, allowedOrigins, turntableSlices, \.\.\.rest \} = s;/.test(src), 'members are never sent the chances through /public/settings');
ok(/slices: spinSlicesOf\(sett\) \? spinSlicesOf\(sett\)\.map\(x => x\.reward\)/.test(src), '/turntable/status gives the amounts only');
ok(/if \('turntableSlices' in updates\) \{[\s\S]{0,400}normalizeTurntableSlices\(updates\.turntableSlices\)[\s\S]{0,300}status\(400\)/.test(src), 'the admin save refuses a bad wheel whole');

// ── one spin per successful recharge ──
{
  const i0 = src.indexOf('async function grantDepositSpin('), i1 = src.indexOf('async function grantTurntableSpins(');
  ok(i0 >= 0 && i1 > i0, 'grantDepositSpin found');
  const tsMillis = v => (v && v.getTime ? v.getTime() : Number(v) || 0);
  const mk2 = sett => { const store = new Map(); const db = { collection: () => ({ doc: id => ({ createIfAbsent: async d => { if (store.has(id)) return false; store.set(id, d); return true; } }) }) };
    const g = new Function('db', 'getSettings', 'tsMillis', 'nowStr', 'FieldValue', 'console', src.slice(i0, i1) + '\nreturn grantDepositSpin;')(db, async () => sett, tsMillis, () => ({ date: 'd', time: 't' }), { serverTimestamp: () => 'ts' }, { error() {} });
    return { g, store }; };
  const dep = (id, extra) => ({ id, data: () => Object.assign({ userId: 'u1', createdAt: new Date() }, extra) });
  let t = mk2({ turntableEnabled: true, turntablePerDeposit: true, turntableDailyMin: 200, turntableDailyMax: 1000 });
  ok(await t.g(dep('d1')) === true && t.store.get('dep:d1').userId === 'u1' && t.store.get('dep:d1').used === false && t.store.get('dep:d1').source === 'deposit', 'a successful recharge earns one unused spin');
  ok(await t.g(dep('d1')) === false && t.store.size === 1, 'the same recharge never earns a second one (retried webhook, poll, force-credit)');
  ok(await t.g(dep('d2')) === true && t.store.size === 2, 'a different recharge earns its own spin');
  ok(await t.g(dep('d3', { createdAt: new Date(Date.now() - 3 * 86400000) })) === false, 'a recharge older than 2 days earns nothing (an old one merely re-read)');
  ok(await t.g({ id: 'd4', data: () => ({ createdAt: new Date() }) }) === false, 'a recharge with no member earns nothing');
  t = mk2({ turntableEnabled: false, turntablePerDeposit: true }); ok(await t.g(dep('d5')) === false, 'wheel switched off: no spin');
  t = mk2({ turntableEnabled: true, turntablePerDeposit: false }); ok(await t.g(dep('d6')) === false, 'per-recharge switch off: no spin');
}
ok(/if \(credited\) await grantDepositSpin\(depDoc\);/.test(src), 'every credited recharge goes through creditDeposit, which grants the spin');
ok(/turntablePerDeposit: true, turntableDailyFree: false, turntablePurchaseSpins: false,/.test(src), 'defaults: spins per recharge ON, free daily OFF, purchase spins OFF');
ok(/sett\.turntableDailyFree === true && lastKey !== eatDayKey/.test(src) && /sett\.turntableDailyFree === true && lastKey !== todayKey/.test(src), 'the free daily spin only exists when the owner switches it on (status and spin)');
ok(/!sett\.turntableEnabled \|\| sett\.turntablePurchaseSpins !== true/.test(src), 'spins for buying a product only when the owner switches them on');
console.log(`PASS: spin wheel, ten sections (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
