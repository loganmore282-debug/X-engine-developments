/**
 * A deposit with no phone number is refused, on the server.
 *
 * Owner: "why when one didn't put number, it just continues to poll ... l
 * tried to leave not putting number and clicked confirm deposit but it didn't
 * reject it just continued to go to poll page. please make sure no loopholes."
 *
 * Both deposit routes used to resolve the number as
 *
 *     cleanPhone(req.body.phone || uSnap.data().phone || '')
 *
 * and `||` treats an EMPTY STRING as absent. So a blank field did not fail
 * the check below it -- it silently fell through to the account's own
 * registered number, a real deposit was created, the route answered success,
 * and the app moved on to poll a payment prompt the member never asked for.
 *
 * This runs the REAL depositSenderPhone() out of server.js. The client now
 * validates too (test-pay-poll.py drives that), but the client is a courtesy:
 * /deposit/marzpay is a plain authenticated POST and the body is whatever the
 * caller sends, so the rule has to hold here.
 */
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/server.js', 'utf8');
const slice = (a, b) => src.slice(src.indexOf(a), src.indexOf(b));
// cleanPhone is what decides a valid Uganda number; lift it rather than
// restate it, or this tests a stricter/looser rule than the one that ships.
// cleanPhone() now asks the REGION for the dialling code, number length and
// allowed prefixes (see the REGIONS section in server.js), so localDigits()
// and a region come with it. Uganda is pinned here because every case below
// is a Ugandan number -- the region layer itself is covered by
// test-regions.js.
const currentRegion = () => ({ key: 'ug', name: 'Uganda', currency: 'UGX', dialCode: '256', localLength: 9, prefixes: ['7'], utcOffsetMin: 180, isDefault: true });
eval(slice('function localDigits(raw, region)', 'const MAX_MONEY_AMOUNT'));

let failed = 0;
const check = (ok, label) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); };

const ACCOUNT = '0742730382';
const deposit = (body, keys = ['phone']) => depositSenderPhone(body, ACCOUNT, keys);

console.log('— the reported bug: a field that was sent, but left empty —');
for (const [body, why] of [
  [{ amount: 20000, phone: '' }, 'blank, exactly what the form sends when untouched'],
  [{ amount: 20000, phone: '   ' }, 'whitespace only'],
  [{ amount: 20000, phone: '07' }, 'half-typed'],
  [{ amount: 20000, phone: '0712345' }, 'too short'],
  [{ amount: 20000, phone: '0642730382' }, 'not a mobile prefix'],
  [{ amount: 20000, phone: 'abcdefghij' }, 'not a number at all'],
  [{ amount: 20000, phone: 0 }, 'the number zero'],
  [{ amount: 20000, phone: false }, 'a falsy non-string'],
]) {
  const r = deposit(body);
  check(!!r.error && !r.phone,
    `${JSON.stringify(body.phone)} is REFUSED (${why}) -> ${r.error || 'phone ' + r.phone}`);
}

console.log('\n— and must not fall back to the account number —');
// The specific failure the owner saw: refused input silently becoming a real
// charge against whatever number the account was registered with.
for (const v of ['', '   ', '07', 0, null_safe()]) {
  const r = deposit({ phone: v });
  check(r.phone !== cleanPhone(ACCOUNT),
    `${JSON.stringify(v)} does not quietly charge the account's own number`);
}
function null_safe() { return 'xx'; }

console.log('\n— a real number still works —');
for (const [v, want] of [
  ['0742730382', '+256742730382'],
  ['742730382', '+256742730382'],
  ['+256 742 730 382', '+256742730382'],
  ['256742730382', '+256742730382'],
]) {
  const r = deposit({ phone: v });
  check(r.phone === want, `${JSON.stringify(v)} -> ${r.phone}`);
}

console.log('\n— the manual route reads senderPhone, and is just as strict —');
const man = (body) => depositSenderPhone(body, ACCOUNT, ['senderPhone', 'phone']);
check(!!man({ senderPhone: '' }).error, 'an empty senderPhone is refused');
check(man({ senderPhone: '0742730382' }).phone === '+256742730382', 'a real senderPhone is used');
// senderPhone is checked FIRST, so a caller sending both cannot smuggle a
// different number past by leaving the one that is read blank.
check(!!man({ senderPhone: '', phone: '0742730382' }).error,
  'an empty senderPhone is not rescued by a valid phone beside it');

console.log('\n— a field that was never sent at all —');
// Deliberately still allowed: a caller with no phone field never had one to
// send, and the account's own registered number is a sound answer. This is
// what keeps the change from breaking any caller that omits it.
check(deposit({ amount: 20000 }).phone === '+256742730382',
  'falls back to the account number when no phone field is present');
check(!!depositSenderPhone({ amount: 20000 }, '', ['phone']).error,
  'and refuses when there is no field AND no account number either');

// ── WHAT THE REFUSAL ACTUALLY SAYS ──
// Owner, after a member was shown MarzPay's own raw "Uganda only accepts
// Ugandan numbers (e.g., +256712345678). Kenyan (+254) numbers are not
// allowed": "why don't you put ie inside number areas ie for a country put
// in admin panel ie +2257, or 255, some country l made start differently, so
// why only mention Uganda and Kenya".
//
// Nothing here checked the TEXT before -- only that a bad number was
// refused -- so the refusal could (and did) stay a generic "Enter a valid
// mobile-money phone number." that never told anyone what their own country
// expects. The mutation harness caught that gap: reverting the message
// passed every assertion in this file.
console.log('\n— the refusal names the country and its own format —');
{
  const CI = { key: 'ci', name: "Cote d'Ivoire", dialCode: '225', localLength: 8, prefixes: ['7', '8'], currency: 'XOF' };
  const msg = depositSenderPhone({ phone: '0712' }, '', ['phone'], CI).error;
  check(/Cote d'Ivoire/.test(msg), `it names the member's own country: ${msg}`);
  // The format comes from that region's OWN admin-set dial code + prefix +
  // length. A country saved with 225/7/8 is told "+2257XXXXXXX", which is
  // literally the shape the owner asked to be able to set.
  check(/\+2257XXXXXXX/.test(msg), '  and the international format built from its dial code and prefix');
  check(/07XXXXXXX/.test(msg), '  and the local one');
  check(!/Uganda|Kenya|\+256|\+254/.test(msg),
    '  and never mentions Uganda or Kenya, which have nothing to do with this member');
  // Each region gets its own, from its own settings -- not one hardcoded pair.
  const ug = depositSenderPhone({ phone: '0712' }, '', ['phone'],
    { key: 'ug', name: 'Uganda', dialCode: '256', localLength: 9, prefixes: ['7'] }).error;
  check(/Uganda/.test(ug) && /\+2567XXXXXXXX/.test(ug), `a different country gets its own format: ${ug}`);
  check(msg !== ug, '  and the two are genuinely different sentences');
  // The account-number fallback path has to say the same thing. Without
  // this, reverting only that branch's message went undetected -- the
  // mutation harness reported exactly that.
  const fb = depositSenderPhone({}, '0712', ['phone'], CI).error;
  check(/Cote d'Ivoire/.test(fb) && /\+2257XXXXXXX/.test(fb),
    `the account-number fallback refuses with the same country-specific sentence: ${fb}`);
  // And the region argument governs VALIDATION, not just wording: this
  // number is valid in Cote d'Ivoire (8 local digits, leading 7) and invalid
  // in Uganda (9), so accepting it proves the passed-in region is what was
  // judged against rather than the ambient request context.
  // 8 local digits behind a leading 0 -- valid for Cote d'Ivoire as
  // configured above, and one digit short for Uganda's 9.
  check(depositSenderPhone({ phone: '071234567' }, '', ['phone'], CI).phone === '+22571234567',
    "a number valid in THIS country is accepted on its own country's rule");
  check(!!depositSenderPhone({ phone: '071234567' }, '', ['phone'],
    { key: 'ug', name: 'Uganda', dialCode: '256', localLength: 9, prefixes: ['7'] }).error,
    '  while the same digits are refused for a country whose numbers are longer');
}

console.log('\n— the routes actually use it —');
check((src.match(/depositSenderPhone\(req\.body/g) || []).length === 2,
  'both deposit routes resolve the number through the one helper');
// Both routes hand in the member's own region explicitly (paymentRegion /
// depositRegion, snapshotted once per request) rather than letting the
// helper re-derive it from async-local context on a money path.
// `[^)]*` would stop at the ')' inside `uSnap.data()` -- this project's own
// notes record that exact regex trap already, from `hostOf(made[0])`.
check((src.match(/depositSenderPhone\(req\.body[\s\S]{0,80}?\w+Region\)/g) || []).length === 2,
  'and both pass that member\'s own region in explicitly');
check(!/cleanPhone\(req\.body\.phone \|\| uSnap/.test(src) &&
      !/cleanPhone\(req\.body\.senderPhone \|\| req\.body\.phone \|\| uSnap/.test(src),
  'and neither still uses the || chain that swallowed an empty field');

console.log(failed ? `\n${failed} FAILED` : '\ndeposit phone: all cases pass');
process.exit(failed ? 1 : 0);
