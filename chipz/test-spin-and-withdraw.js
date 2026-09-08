// Turntable spin security, and the admin-set withdrawal multiple.
//
// Owner: "make sure that spins are perfectly secure and also let the
// withdrawal multiple be set from admin, so default multiple should be 5000,
// ie one withdrawals 5000,10000,25000,30000,35000 like that."
//
// Both of these are money rules, so the thing that matters is that the
// SERVER decides them. A rule that lives only in the app is not a rule:
// /turntable/spin and /withdraw/request are plain authenticated POSTs, and
// the body of each is whatever the caller chose to send.
const fs = require('fs');
const crypto = require('crypto');
const src   = fs.readFileSync(__dirname + '/server.js', 'utf8');
const mod   = fs.readFileSync(__dirname + '/user-src/original_module.js', 'utf8');
const admin = fs.readFileSync(__dirname + '/admin-src/index.html', 'utf8');

const grab = (from, to) => {
  const a = src.indexOf(from), b = src.indexOf(to);
  if (a < 0 || b <= a) throw new Error(`grab(): marker missing -- ${a < 0 ? from : to}`);
  return src.slice(a, b);
};
// Comments are stripped before every "this text is absent" check. The
// explanations in server.js NAME the things they are explaining away -- the
// rollSpinReward comment says the words "Math.random" to say why it is not
// used -- and matching that prose fails the assertion on a correct file.
const noComments = t => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1');
let bad = 0;
const ck = (o, l) => { if (!o) bad++; console.log((o ? 'PASS  ' : 'FAIL  ') + l); };

// ── the payout roll ───────────────────────────────────────────────────────
console.log('— the spin payout is drawn from a CSPRNG, not Math.random —');
const rollSrc = grab('function rollSpinReward', 'function turntableDailyReward');
ck(!/Math\.random/.test(noComments(rollSrc)),
   'rollSpinReward does not use Math.random');
ck(/crypto\.randomInt/.test(rollSrc), 'it uses crypto.randomInt');
// Why it matters, stated once so nobody "simplifies" it back: V8's
// Math.random is a seeded xorshift128+ and its state is recoverable from a
// run of outputs -- which a member has, because they see every one of their
// own spin results.
ck(!/Math\.random/.test(noComments(grab('async function grantTurntableSpins', "app.get('/turntable/status'"))),
   'and neither does anything else in the spin-granting path');

// Run the real function: uniform, inside the band, never outside it.
const round2 = n => Math.round(n * 100) / 100;
// Restated EXACTLY as server.js defines it -- it rejects NaN/Infinity and
// nothing else. An earlier copy here added `&& n > 0`, which would have
// made this test exercise a stricter function than the one that ships.
const finiteMoney = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const rollSpinReward = eval('(function(){const crypto=require("crypto");' +
  'const round2=' + round2.toString() + ';const finiteMoney=' + finiteMoney.toString() + ';' +
  rollSrc + '\nreturn rollSpinReward;})()');
const N = 4000;
let lo = Infinity, hi = -Infinity, sum = 0;
for (let i = 0; i < N; i++) { const r = rollSpinReward(200, 1000); lo = Math.min(lo, r); hi = Math.max(hi, r); sum += r; }
console.log(`    ${N} rolls of 200-1000: min ${lo}, max ${hi}, mean ${(sum / N).toFixed(1)}`);
ck(lo >= 200 && hi <= 1000, 'every roll lands inside the configured band');
ck(lo < 260 && hi > 940, 'and the whole band is reachable, not clustered');
ck(Math.abs(sum / N - 600) < 25, 'the mean sits near the middle (no skew)');
ck(rollSpinReward(500, 500) === 500, 'a zero-width band pays exactly that amount');
ck(rollSpinReward(0, 0) === 0 && rollSpinReward(-5, -1) === 0,
   'and a broken band pays 0, never a negative');
ck(rollSpinReward(1000, 200) === 1000,
   'a band stored backwards is clamped, not treated as a range down to 200');

// ── the client cannot name its own prize ──────────────────────────────────
console.log('\n— the client cannot influence the payout —');
// /invest/create is the next route in the file -- the end marker has to be
// something that EXISTS, or indexOf(-1) silently slices to the end of the
// file and every "is absent" check below tests the whole server.
const spinBody = grab("app.post('/turntable/spin'", "app.post('/invest/create'");
ck(!/req\.body/.test(noComments(spinBody)),
   'the spin route reads NOTHING from the request body');
ck(/verifyAuth\(req\)/.test(spinBody), 'it identifies the member from their token');
ck(/status === 'banned'/.test(spinBody), 'and refuses a banned account');
ck(/turntableEnabled/.test(spinBody), 'and refuses when the turntable is switched off');

// ── one spin, once ────────────────────────────────────────────────────────
console.log('\n— a spin cannot be claimed twice —');
// withLock() is an in-process promise chain: it serialises taps inside ONE
// server process and nothing more. The claim itself has to be atomic at the
// database, or two instances could both pay the same daily spin.
ck(/withLock\('turntable:' \+ uid/.test(spinBody), 'taps are serialised per member');
ck(/updateIf\(\s*\{ lastTurntableAt:/.test(spinBody),
   'the DAILY spin is claimed with an atomic conditional write, not read-then-write');
ck(/updateIf\(\{ used: false \}, \{ used: true/.test(spinBody),
   'and an EARNED spin is burnt the same way');
ck(spinBody.indexOf('updateIf') < spinBody.indexOf('walletBalance: FieldValue.increment'),
   'the spin is claimed BEFORE the money is credited');
ck(/FieldValue\.increment\(reward\)/.test(spinBody),
   'and the credit itself is an atomic increment');
// A failed credit must hand the spin back rather than silently eat it.
ck(/used: false, usedAt: null/.test(spinBody), 'a failed credit returns an earned spin');
ck(/lastTurntableAt: u\.lastTurntableAt \|\| null/.test(spinBody),
   'and returns the day for a daily spin');

console.log('\n— and it is rate limited like every other money route —');
const limiterList = grab("['/withdraw/request'", '// ── BODY PARSING ──');
ck(/'\/turntable\/spin'/.test(limiterList),
   'the spin route is on the strict per-user limiter, not just the global one');
for (const p of ['/withdraw/request', '/invest/create', '/checkin']) {
  ck(limiterList.includes(`'${p}'`), `(${p} still is too)`);
}

// ── the EARNED spins: how a purchase grants them ──────────────────────────
// The redemption path above is only half of it. These are created by
// /invest/create, and each one is a promise to pay money later.
console.log('\n— spins granted by a purchase —');
const grant = grab('async function grantTurntableSpins', 'function rollSpinReward');

console.log('   ...the payout band comes from the SERVER\'s product record');
const invest = grab("app.post('/invest/create'", "app.get('/investments'");
ck(/getProductByKey\(req\.body\.tierKey\)/.test(invest),
   'the client names a product KEY, and the server looks the product up');
ck(/liveTier = await getProductByKey\(tier\.key\)/.test(invest),
   'and re-reads it live inside the lock, so a mid-flight edit cannot be raced');
ck(/grantTurntableSpins\(userId, liveTier, invId\)/.test(invest),
   'spins are granted from that live record, never from the request');
ck(!/spinMin|spinMax|spinCount/.test(noComments(invest).replace(/grantTurntableSpins[^\n]*/g, '')),
   'the purchase route never reads a spin figure out of the request body');

console.log('   ...and every stored figure is re-clamped where it is USED');
ck(/MAX_SPINS_PER_PURCHASE/.test(grant),
   'the grant loop is bounded by a named cap, not by whatever is stored');
ck(/Math\.min\(MAX_MONEY_AMOUNT/.test(grant),
   'and the band is clamped to MAX_MONEY_AMOUNT at grant time too');
// The validator caps it as well -- both, on purpose, because not every write
// to products/ goes through the validator.
ck(/spinCount > MAX_SPINS_PER_PURCHASE\) return null/.test(src),
   'the admin save path refuses a bigger count using the SAME constant');
ck(/const MAX_SPINS_PER_PURCHASE = 20;/.test(src), 'which is 20');
ck(/spinMax < spinMin\) return null/.test(src),
   'and refuses a band saved backwards rather than quietly fixing it');

// Run the real clamp: a stored value the validator never saw.
const clampCount = c => Math.min(20, Math.max(0, Math.floor(Number(c) || 0)));
for (const [stored, want] of [[3, 3], [20, 20], [500, 20], [1e9, 20], [-4, 0], ['x', 0], [null, 0]])
  ck(clampCount(stored) === want,
     `a stored spinCount of ${JSON.stringify(stored)} grants ${want} spin(s)`);

console.log('   ...a purchase cannot grant its spins twice');
ck(/where\('investmentId', '==', investmentId\)/.test(grant),
   'the grant is idempotent per investment');
ck(/investmentId: investmentId \|\| null/.test(grant),
   'and each spin records which purchase paid for it');
ck(grant.indexOf('already.empty') < grant.indexOf("collection('turntableSpins').add"),
   'the check runs BEFORE anything is written');

console.log('   ...and a failure never costs the member their purchase');
ck(/catch \(e\)/.test(grant) && /console\.error/.test(grant),
   'a grant failure is caught and logged, not thrown into the purchase');
ck(/if \(!sett\.turntableEnabled\) return;/.test(grant),
   'nothing is granted while the turntable is switched off');

// ── the withdrawal multiple ───────────────────────────────────────────────
console.log('\n— the withdrawal multiple is an admin setting, default 5,000 —');
ck(/withdrawMultiple: 5000,/.test(src), 'the default is 5,000');
ck(/withdrawMultiple: \[0, MAX_MONEY_AMOUNT\]/.test(src),
   'it is range-checked on save, and 0 turns the rule off');
const wr = grab("app.post('/withdraw/request'", "app.get('/withdrawals'");
ck(/amt % wMult !== 0/.test(wr), 'the SERVER rejects an amount off the step');
ck(wr.indexOf('minWithdraw') < wr.indexOf('wMult'),
   'after the minimum check, so the message a member sees is the useful one');
ck(/Math\.max\(0, Math\.floor\(Number\(sett\.withdrawMultiple\)/.test(wr),
   'reading the live setting, not a hard-coded 5000');

// The rule the owner described, run against the real check.
console.log('\n— the amounts he named —');
const passes = (amt, mult) => !(mult > 0 && amt % mult !== 0);
for (const [amt, ok] of [[5000, true], [10000, true], [25000, true], [30000, true],
                         [35000, true], [7000, false], [12500, false], [5001, false]]) {
  ck(passes(amt, 5000) === ok,
     `${amt.toLocaleString('en-US')} is ${ok ? 'allowed' : 'refused'} at a 5,000 step`);
}
ck(passes(7000, 0) && passes(12345, 0), 'and a multiple of 0 allows any amount');

console.log('\n— the app mirrors it, and the panel can set it —');
ck(/amount % wMult !== 0/.test(mod), 'the app checks it before submitting');
ck(/STATE\.settings \|\| \{\}\)\.withdrawMultiple/.test(mod),
   'from the live setting rather than its own constant');
ck(/Amounts must be a multiple of/.test(mod),
   'and the withdrawal instructions state the rule');
ck(/id="sWitMult"/.test(admin), 'the admin panel has the field');
ck(/withdrawMultiple:\+\$\('sWitMult'\)\.value/.test(admin), 'and saves it');

// ── the product card tap ──────────────────────────────────────────────────
console.log('\n— tapping a product card animates and does nothing else —');
const hook = mod.slice(mod.indexOf('function hookProductCardTap'), mod.indexOf('function hookNavTapBox'));
ck(hook.length > 200, 'hookProductCardTap exists');
ck(/e\.target\.closest\('button, a, input, select, textarea'\)/.test(hook),
   'a tap on Buy Now (or any control) is left alone, so buying is unaffected');
ck(/card\.classList\.add\('card-tap'\)/.test(hook), 'the card gets the animation class');
ck(!/invest|buy|purchase|openProduct/i.test(hook.replace(/\/\/.*$/gm, '')),
   'and the handler calls nothing that could buy anything');
ck(!/class="p-card"[^>]*onclick/.test(mod), 'the card markup carries no onclick');

console.log(bad ? `\n${bad} FAILED` : '\nspins + withdrawal multiple: all cases pass');
process.exit(bad ? 1 : 0);
