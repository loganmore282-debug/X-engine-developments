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

const api = new Function('CURRENT', `
  function currentRegion() { return CURRENT; }
  ${fnSource('phoneFormatHint')}
  ${fnSource('badPhoneMessage')}
  ${fnSource('marzUserMsg')}
  const PROVIDER_BUSY_MSG = 'The payment provider is busy right now. Please try again in a moment.';
  ${fnSource('marzIsPhoneFormatError')}
  ${fnSource('marzPhoneFormatMsg')}
  return { phoneFormatHint, badPhoneMessage, marzUserMsg, marzIsPhoneFormatError, marzPhoneFormatMsg };
`);

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
  ck(/marzIsPhoneFormatError\(mpData\)/.test(body),
     '/deposit/marzpay checks for the phone-format family');
  ck(/marzPhoneFormatMsg\(\)/.test(body),
     '  and uses the translated, region-correct message when it matches');
  // Ordering: the check has to run on the SAME mpData the raw fallback would
  // have used, before markDepositFailed is called -- not after. Scoped to
  // the MarzPay branch specifically: this one route handler also contains
  // PesaJet's and LipaPay's own EARLIER markDepositFailed calls (they share
  // this endpoint, branching on `provider`), so a bare indexOf('markDepositFailed')
  // over the whole route finds one of THOSE instead of this round's own --
  // which is exactly what happened the first time this assertion was written.
  const checkAt = body.indexOf('marzIsPhoneFormatError');
  const markAt = body.indexOf('markDepositFailed', checkAt);
  ck(checkAt > -1 && markAt > checkAt,
     '  decided BEFORE the failure is recorded, not after');
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

console.log(bad ? `\n${bad} FAILED` : '\nmarz phone error: all cases pass');
process.exit(bad ? 1 : 0);
