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
eval(slice('function cleanPhone(raw)', 'const NETWORK_NAMES'));

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

console.log('\n— the routes actually use it —');
check((src.match(/depositSenderPhone\(req\.body/g) || []).length === 2,
  'both deposit routes resolve the number through the one helper');
check(!/cleanPhone\(req\.body\.phone \|\| uSnap/.test(src) &&
      !/cleanPhone\(req\.body\.senderPhone \|\| req\.body\.phone \|\| uSnap/.test(src),
  'and neither still uses the || chain that swallowed an empty field');

console.log(failed ? `\n${failed} FAILED` : '\ndeposit phone: all cases pass');
process.exit(failed ? 1 : 0);
