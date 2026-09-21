#!/usr/bin/env node
/**
 * A member's screenshot: "Payment not completed / Uganda only accepts
 * Ugandan numbers (e.g., +256712345678). Kenyan (+254) numbers are not
 * allowed." -- on a screen rendered in FRENCH.
 *
 * That exact wording is not anywhere in this codebase (checked by grep
 * before writing a line of this fix): it is MarzPay's own raw validation
 * text, reaching the member verbatim via marzUserMsg(). Their docs document
 * `error_code: 'INVALID_PHONE_FORMAT'` for this family ("Invalid Airtel
 * phone number format...") and state provider detection happens server-side
 * FROM THE PHONE NUMBER, cross-checked against the declared `country` -- so
 * a mismatch surfaces as their own validation error, in English, with no
 * idea which of Chipz's regions is actually asking.
 *
 * WHAT IS PINNED, and why each matters:
 *
 *  1. marzIsPhoneFormatError() recognises the documented error_code
 *     RELIABLY, and only falls back to text-matching for a shape their docs
 *     do not enumerate -- narrow on purpose, so a frozen-account or
 *     insufficient-float refusal is never mistaken for a phone problem and
 *     swallowed behind an unrelated sentence.
 *  2. marzPhoneFormatMsg() reuses badPhoneMessage() -- the app's one existing
 *     sentence for "wrong country for this account" -- and names the
 *     ACCOUNT'S OWN region, never whatever country MarzPay's raw text
 *     happened to reference.
 *  3. The /deposit/marzpay create-failure branch is WIRED to prefer this
 *     over the raw provider text -- reading the source, not assuming the
 *     helpers exist in isolation and are actually called.
 *  4. The new LANG_PATTERNS row actually matches what badPhoneMessage()
 *     produces, for real regions, so this message is translatable at all --
 *     it is server-composed, so it never existed for the i18n sweep to catch
 *     until this round added the row.
 *  5. Every OTHER MarzPay refusal (busy, insufficient balance, a frozen
 *     account) is UNCHANGED -- this must not swallow refusals that have
 *     nothing to do with phone format.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const src = fs.readFileSync(path.join(HERE, 'server.js'), 'utf8');
const client = fs.readFileSync(path.join(HERE, 'user-src', 'original_module.js'), 'utf8');

let bad = 0;
const ck = (o, l) => { if (!o) bad++; console.log((o ? 'PASS  ' : 'FAIL  ') + l); };

function fnSource(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`no such function: ${name}`);
  const bodyAt = src.indexOf('{', src.indexOf(')', start));
  let depth = 0;
  for (let k = bodyAt; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (depth === 0) return src.slice(start, k + 1); }
  }
  throw new Error(`unbalanced braces in ${name}`);
}

const UG = { key: 'ug', name: 'Uganda', dialCode: '256', localLength: 9, prefixes: ['7'] };
const KE = { key: 'ke', name: 'Kenya', dialCode: '254', localLength: 9, prefixes: ['7'] };
const CM = { key: 'cm', name: 'Cameroon', dialCode: '237', localLength: 9, prefixes: ['6', '2'] };

function constSource(name) {
  const m = new RegExp('^const ' + name + ' = [^;]*;', 'm').exec(src);
  if (!m) throw new Error('no such const: ' + name);
  return m[0];
}

const api = new Function('CURRENT', `
  function currentRegion() { return CURRENT; }
  ${fnSource('phoneFormatHint')}
  ${fnSource('badPhoneMessage')}
  const PROVIDER_BUSY_MSG = 'The payment provider is busy right now. Please try again in a moment.';
  const DEPOSIT_FAILED_MSG = 'Payment was not completed. Please try again.';
  ${fnSource('marzIsBusy')}
  ${fnSource('marzUserMsg')}
  ${constSource('MARZ_PHONE_ERROR_CODES')}
  ${fnSource('marzIsPhoneFormatError')}
  ${fnSource('marzMsgIsSafeForMember')}
  ${fnSource('marzMemberMsg')}
  ${fnSource('marzPhoneFormatMsg')}
  return { phoneFormatHint, badPhoneMessage, marzUserMsg, marzIsPhoneFormatError,
           marzPhoneFormatMsg, marzMemberMsg, marzIsBusy, DEPOSIT_FAILED_MSG };
`);

// ── THE MESSAGE FROM THE SCREENSHOT, WITH NO error_code ──
// This is the case Round 178b got wrong and the owner caught live ("This
// stuff is persistent"). Its own fixture asserted error_code
// INVALID_PHONE_FORMAT alongside this text -- an assumption about MarzPay,
// written by me, then only ever verified against itself. The text carries no
// "phone number format" anywhere, so with the error_code absent the old
// detector returned false and MarzPay's raw English shipped to a member
// reading French. Pinned here WITHOUT the error_code on purpose.
const REPORTED = 'Uganda only accepts Ugandan numbers (e.g., +256712345678). Kenyan (+254) numbers are not allowed.';
console.log('— the reported message, with NO error_code (Round 178b missed this) —');
{
  const it = api(UG);
  ck(it.marzIsPhoneFormatError({ status: 'error', message: REPORTED }) === true,
     'recognised from the text alone, with no error_code at all');
  ck(it.marzMemberMsg({ status: 'error', message: REPORTED }, 'Could not start the payment', UG) === it.badPhoneMessage(UG),
     "and replaced with OUR sentence, naming the account's own country");
  const shown = it.marzMemberMsg({ status: 'error', message: REPORTED }, 'x', UG);
  ck(!/Kenyan|\+254|only accepts/.test(shown),
     "  MarzPay's own wording is gone entirely: " + shown);
  // The structural signal, independent of any phrasing: a message naming a
  // dialling code that is not this member's own cannot be actionable for
  // them, whatever words surround it.
  ck(api(CM).marzIsPhoneFormatError({ message: 'Only +256 numbers work on this account.' }) === true,
     'a foreign dialling code alone is enough, whatever the wording around it');
  ck(api(UG).marzIsPhoneFormatError({ message: 'Collection for +256712345678 could not be queued.' }) === false,
     "  but this member's OWN dialling code is not treated as a mismatch");
  // The WORDING branch, exercised with no dialling code in the text at all.
  // Without these two the structural check above answers every case on its
  // own, and deleting the wording patterns goes unnoticed -- which is
  // exactly what the mutation harness reported the first time it ran.
  for (const worded of ['This account only accepts local numbers.',
                        'Foreign numbers are not allowed on this service.',
                        'That is not a valid mobile money number for this country.']) {
    ck(api(UG).marzIsPhoneFormatError({ message: worded }) === true,
       `recognised from wording alone, with no dialling code in it: "${worded}"`);
  }
}

console.log('\n— a member is never shown raw provider prose, even unforeseen prose —');
{
  const it = api(UG);
  // The whole point: the NEXT sentence MarzPay invents is safe by
  // construction rather than waiting for another screenshot.
  const unforeseen = { status: 'error', message: 'Collection rejected: MSISDN routing table entry absent for this MNO partition.' };
  ck(it.marzMemberMsg(unforeseen, 'Could not start the payment', UG) === 'Could not start the payment',
     'an unrecognised provider sentence is replaced with our own fallback');
  ck(it.marzUserMsg(unforeseen, 'Could not start the payment') === unforeseen.message,
     '  while the ADMIN wrapper still shows it verbatim, which is what a diagnostic needs');
  // ...but the few families that genuinely tell a member something actionable
  // still come through.
  for (const keep of ['Insufficient balance.', 'Account is frozen.', 'Amount is below the minimum.']) {
    ck(it.marzMemberMsg({ message: keep }, 'fallback', UG) === keep,
       `a genuinely useful refusal still reaches the member: "${keep}"`);
  }
  ck(it.marzMemberMsg({ providerDown: true }, 'Could not start the payment', UG) === 'The payment provider is busy right now. Please try again in a moment.',
     'and a transport failure is still the busy sentence, not a phone complaint');
  ck(it.marzMemberMsg({ status: 'error' }, 'Could not start the payment', UG) === 'Could not start the payment',
     'a refusal with no message at all uses the caller\'s own fallback');
}

console.log('— recognising the documented error family —');
{
  const it = api(UG);
  ck(it.marzIsPhoneFormatError({ error_code: 'INVALID_PHONE_FORMAT', message: 'anything' }) === true,
     "MarzPay's documented error_code is recognised regardless of the message text");
  ck(it.marzIsPhoneFormatError({ message: 'Invalid Airtel phone number format. Must be 9 digits (without country code).' }) === true,
     "and the exact wording from MarzPay's own docs is recognised without an error_code");
  ck(it.marzIsPhoneFormatError({ message: 'Invalid MTN phone number format. Something else.' }) === true,
     '  case-insensitively, for the other named provider too');
}

console.log('\n— everything else passes through UNCHANGED —');
{
  const it = api(UG);
  const cases = [
    { error_code: 'DATABASE_ERROR', message: 'boom' },
    { message: 'Reference already exists for API collection. Please use a different reference.', error_code: 'DUPLICATE_REFERENCE' },
    { message: 'Service not found.', error_code: 'SERVICE_NOT_FOUND' },
    { message: 'Account is frozen.' },
    { message: 'Insufficient balance.' },
  ];
  for (const c of cases) {
    ck(it.marzIsPhoneFormatError(c) === false,
       `NOT mistaken for a phone problem: "${c.message}"`);
  }
  // Prove the wiring doesn't just skip these -- marzUserMsg still carries
  // them through exactly as before this round.
  ck(it.marzUserMsg({ message: 'Insufficient balance.' }, 'fallback') === 'Insufficient balance.',
     'and marzUserMsg itself is untouched for a real, unrelated refusal');
}

console.log('\n— the replacement names the ACCOUNT\'S OWN region —');
{
  for (const [region, wantName] of [[UG, 'Uganda'], [KE, 'Kenya'], [CM, 'Cameroon']]) {
    const it = api(region);
    const msg = it.marzPhoneFormatMsg();
    ck(msg.includes(wantName), `${region.name}'s account gets a message naming ${wantName} (${msg})`);
    ck(!/Kenyan|\+254/.test(msg) || region === KE,
       `  never MarzPay's own "+254"/"Kenyan" text bleeding through for ${region.name}`);
    ck(msg === it.badPhoneMessage(region), 'and it is exactly badPhoneMessage() -- one sentence, not a second copy');
  }
  // The reported scenario itself: a Ugandan account, MarzPay's own
  // documented error shape. Expected string built from the SAME
  // phoneFormatHint() the real code uses (an X-masked hint, not real
  // digits) rather than hand-typed, so a future change to that hint's shape
  // cannot silently desync this assertion from what the app actually shows.
  const ug = api(UG);
  const mpData = { status: 'error', error_code: 'INVALID_PHONE_FORMAT',
                   message: 'Uganda only accepts Ugandan numbers (e.g., +256712345678). Kenyan (+254) numbers are not allowed.' };
  const shown = ug.marzIsPhoneFormatError(mpData) ? ug.marzPhoneFormatMsg() : ug.marzUserMsg(mpData, 'x');
  ck(shown === ug.badPhoneMessage(UG),
     `the exact reported case now shows: "${shown}"`);
  ck(!shown.includes('Kenyan') && !shown.includes('+254'),
     '  and MarzPay\'s own wording is gone entirely, not merely reworded');
}

console.log('\n— wired into the route that actually failed —');
{
  const at = src.indexOf("app.post('/deposit/marzpay'");
  const end = src.indexOf("app.post('/deposit/", at + 10);
  ck(at > -1 && end > at, 'the deposit route was located');
  const body = src.slice(at, end);
  // Asserted as the PROPERTY, not the shape. The first version of these
  // three pinned the literal inline `marzIsPhoneFormatError(mpData) ? ... :
  // marzUserMsg(...)` ternary Round 178b wrote, so they failed the moment
  // that was replaced by one member-safe wrapper -- defending an
  // implementation rather than a guarantee, which this project has now done
  // often enough to have a rule about it. What must be true is: the
  // member-facing failure text comes from the member-safe wrapper, the
  // member's OWN region is handed to it explicitly, and the raw
  // admin/diagnostic wrapper is not what reaches the member here.
  ck(/marzMemberMsg\(mpData, [^)]*paymentRegion\)/.test(body),
     "/deposit/marzpay builds the member's message with marzMemberMsg, passing this member's own region");
  ck(!/markDepositFailed\(depRef, userId,\s*marzUserMsg\(/.test(body),
     '  and never records the raw provider text as the failure reason');
  // Ordering: the message has to be decided from the SAME mpData, before
  // markDepositFailed writes it. Scoped to the MarzPay branch: this one
  // handler also holds PesaJet's and LipaPay's own EARLIER markDepositFailed
  // calls (they share this endpoint, branching on `provider`), so a bare
  // indexOf('markDepositFailed') finds one of THOSE -- which is exactly what
  // happened the first time this assertion was written.
  const checkAt = body.indexOf('marzMemberMsg');
  const markAt = body.lastIndexOf('markDepositFailed', checkAt);
  ck(checkAt > -1 && markAt > -1 && markAt < checkAt &&
     /markDepositFailed\(depRef, userId,\s*\n?\s*marzMemberMsg/.test(body),
     '  and it is that call which records the failure, not a separate earlier one');
}

console.log('\n— the message is actually translatable now —');
{
  const m = /\['That is not a valid \{0\} mobile-money number\. Use the format \{1\} or \{2\}\.',([\s\S]*?)\],/.exec(client);
  ck(!!m, 'LANG_PATTERNS carries a row for badPhoneMessage()\'s exact shape');
  if (m) {
    const cells = m[1].split(',').map(s => s.trim()).filter(Boolean);
    ck(cells.length === 5, `all five languages are present (${cells.length})`);
    for (const c of cells) {
      ck(c !== "''" && c !== '""',
         '  no language cell is blank -- a blank in a PATTERN silently means "show the English"');
      for (const ph of ['{0}', '{1}', '{2}']) {
        ck(c.includes(ph), `  every translation keeps the ${ph} placeholder (dropping one drops a real phone digit string)`);
      }
    }
  }

  // Prove the template actually MATCHES real output, the way the app's own
  // tPattern() would -- not just that a row exists with the right shape.
  const it = api(CM);
  const rendered = it.badPhoneMessage();
  const tplRe = /^That is not a valid ([\s\S]+?) mobile-money number\. Use the format ([\s\S]+?) or ([\s\S]+?)\.$/;
  const match = tplRe.exec(rendered);
  ck(!!match, `the English template matches a REAL rendered message: "${rendered}"`);
  if (match) {
    ck(match[1] === 'Cameroon', 'and captures the country name correctly');
    ck(match[2] === '06XXXXXXX' || /^0/.test(match[2]), '  the local format');
    ck(match[3].startsWith('+237'), '  the international format, with the right dial code');
  }
}

// ── markDepositFailed() actually WRITES the raw provider detail ──
// Owner, after the sync finally reached production and a Cameroon deposit
// still failed: "Could not start the payment" -- itself the CORRECT, safe
// answer for a MarzPay refusal that matches none of the known families, but
// unreadable by anyone without Railway log access. This is the fix: the
// provider's own raw response is stored on the deposit document, admin-only,
// alongside the member-facing sentence.
console.log('\n— markDepositFailed() stores the raw provider detail for admins —');
(async () => {
  function asyncFnSource(name) {
    const start = src.indexOf(`async function ${name}(`);
    if (start === -1) throw new Error(`no such async function: ${name}`);
    const bodyAt = src.indexOf('{', src.indexOf(')', start));
    let depth = 0;
    for (let k = bodyAt; k < src.length; k++) {
      if (src[k] === '{') depth++;
      else if (src[k] === '}') { depth--; if (depth === 0) return src.slice(start, k + 1); }
    }
    throw new Error(`unbalanced braces in ${name}`);
  }
  let writes;
  // depRef is already a document reference at every real call site (built by
  // db.collection('pendingDeposits').doc() up in /deposit/marzpay, not
  // re-derived here) -- this stub matches that shape directly rather than
  // routing through a fake db.collection().doc().
  const makeDepRef = id => ({
    id,
    get: async () => ({ exists: true, data: () => ({}) }),
    update: async patch => { writes.push(patch); },
  });
  const db = { collection: () => ({ where: () => ({ limit: () => ({ get: async () => ({ docs: [] }) }) }) }) };
  const sandboxFn = new Function('db', 'withLock', 'depositFullyCredited', 'fmtMoney', `
    ${asyncFnSource('markDepositFailed')}
    return markDepositFailed;
  `);
  const markDepositFailed = sandboxFn(db, (_k, fn) => fn(), () => false, n => 'UGX ' + n);

  writes = [];
  await markDepositFailed(makeDepRef('d1'), 'u1', 'Could not start the payment',
    JSON.stringify({ status: 'error', error_code: 'SERVICE_NOT_FOUND', message: 'Service not found.' }));
  ck(writes.length === 1, 'exactly one update was written');
  ck(writes[0].failureReason === 'Could not start the payment', 'the member-facing sentence is stored as failureReason');
  ck(writes[0].providerDetail === '{"status":"error","error_code":"SERVICE_NOT_FOUND","message":"Service not found."}',
     'and the raw provider response is stored, untranslated, as providerDetail');

  // Every OTHER call site (expiry, admin rejection, a reconciler's own FAILED
  // verdict) has no provider payload -- adminDetail is simply not passed.
  // Those must not gain a stray providerDetail field.
  writes = [];
  await markDepositFailed(makeDepRef('d2'), 'u1', 'Payment window expired.');
  ck(!('providerDetail' in writes[0]), 'a call with no adminDetail writes no providerDetail field at all');

  // A pathological provider response (or a bug upstream JSON.stringify-ing
  // something huge) must not let an unbounded string reach the database.
  writes = [];
  await markDepositFailed(makeDepRef('d3'), 'u1', 'x', 'y'.repeat(5000));
  ck(writes[0].providerDetail.length === 2000, 'providerDetail is capped, not stored unbounded');
})().then(() => {
  // Wired at all three call sites in the route that actually failed, each
  // handing its OWN provider's raw response -- not one hardcoded elsewhere.
  const checks = [
    ['MarzPay', /marzMemberMsg\(mpData,\s*'Could not start the payment',\s*paymentRegion\),\s*\n\s*JSON\.stringify\(mpData\)\)/],
    ['LipaPay', /lipaUserMsg\(lpData,\s*'Could not start the payment'\),\s*JSON\.stringify\(lpData\)\)/],
    ['PesaJet', /pesajetUserMsg\(pj,\s*'Could not start the payment'\),\s*JSON\.stringify\(pj\.data\)/],
  ];
  for (const [label, re] of checks) {
    ck(re.test(src), `${label}'s create-failure branch passes its own raw response as adminDetail`);
  }

  console.log(bad ? `\n${bad} FAILED` : '\nmarz phone error: all cases pass');
  process.exit(bad ? 1 : 0);
}).catch(e => { console.log('FAIL  markDepositFailed checks threw: ' + (e && e.message)); process.exit(1); });
