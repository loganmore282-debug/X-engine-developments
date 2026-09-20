#!/usr/bin/env node
/**
 * A gateway may only be used in a country it can actually reach.
 *
 * WHY THIS EXISTS. Every automatic gateway wired into Chipz -- MarzPay,
 * LipaPay, PesaJet -- is Uganda-only. MarzPay's own SDK settles it: currency
 * is pinned to 'UGX' independently of its `country` field, the amount bounds
 * are stated in UGX, and isValidPhoneNumber() tests /^\+256[0-9]{9}$/ and
 * rejects everything else.
 *
 * Meanwhile a new region INHERITS settings/main -- Uganda's document --
 * carrying depositMethod:'marzpay' and depositPayAEnabled:true. So the day a
 * Kenya region was created, every Kenyan deposit went to a Uganda-only gateway
 * with a +254 number and every payout with it, and nothing anywhere said so:
 * the member saw a provider failure, the admin saw a working configuration.
 *
 * What is pinned here is therefore BOTH directions, and the first matters as
 * much as the second:
 *   1. Uganda is completely unaffected. Every assertion about Uganda exists so
 *      a fix for Kenya cannot quietly change the country that already works.
 *   2. A country no gateway serves resolves to manual, everywhere it is
 *      decided -- PAY A off, payouts left to a human, the admin save refused.
 *
 * These are RUN, not read. Whether a resolver returns 'manual' for +254 is not
 * something a text match on the source can answer.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const src = fs.readFileSync(path.join(HERE, 'server.js'), 'utf8');

let bad = 0;
const ck = (o, l) => { if (!o) bad++; console.log((o ? 'PASS  ' : 'FAIL  ') + l); };

// One contiguous block holds every decision point, so it lifts whole. Only
// currentRegion() is stubbed -- it reads a module-level snapshot refreshed from
// Mongo, and the point of these tests is to drive it region by region.
const from = src.indexOf('function normalizeProviderValue');
const to = src.indexOf('\n', src.indexOf('function payoutIsManual'));
if (from === -1 || to === -1) throw new Error('could not locate the provider-resolution block');
const block = src.slice(from, to);
for (const name of ['GATEWAY_DIAL_CODES', 'gatewayServesDial', 'gatewayServesRegion',
                    'payAAvailable', 'withdrawProvider', 'payoutIsManual']) {
  if (!block.includes(name)) throw new Error('block is missing ' + name + ' -- re-anchor the slice');
}

const REGIONS = {
  ug:  { key: 'ug',  name: 'Uganda',  dialCode: '256', currency: 'UGX' },
  ug2: { key: 'ug2', name: 'Uganda 2', dialCode: '256', currency: 'UGX' },
  ke:  { key: 'ke',  name: 'Kenya',   dialCode: '254', currency: 'KES' },
  tz:  { key: 'tz',  name: 'Tanzania', dialCode: '255', currency: 'TZS' },
};

const api = new Function('CURRENT', `
  function currentRegion() { return CURRENT; }
  ${block}
  return { GATEWAY_DIAL_CODES, gatewayServesDial, gatewayServesRegion,
           payAAvailable, withdrawProvider, payoutIsManual,
           depositProvider, depositAutomaticProvider };
`);
const inRegion = r => api(r);

const AUTOMATIC = ['marzpay', 'lipapay', 'pesajet'];

console.log('— Uganda is untouched, which is half the point —');
{
  const ug = inRegion(REGIONS.ug);
  for (const g of AUTOMATIC) {
    ck(ug.gatewayServesRegion(g, REGIONS.ug), `${g} serves Uganda`);
    ck(ug.withdrawProvider({ withdrawMethod: g }, REGIONS.ug) === g,
       `  and a ${g} payout in Uganda still goes to ${g}`);
    ck(ug.payAAvailable({ depositPayAEnabled: true, depositMethod: g }, REGIONS.ug) === true,
       `  and PAY A stays on for ${g} in Uganda`);
  }
  // The historical default: no depositMethod stored at all resolves to MarzPay
  // and must keep working, because that is what every deployed database holds.
  ck(ug.payAAvailable({ depositPayAEnabled: true }, REGIONS.ug) === true,
     'a settings document with no depositMethod still gets PAY A in Uganda');
  ck(ug.payoutIsManual({ withdrawMethod: 'manual' }, REGIONS.ug) === true,
     'and an explicitly manual payout is still manual');
  ck(ug.payoutIsManual({ withdrawMethod: 'follow', depositMethod: 'marzpay' }, REGIONS.ug) === false,
     "and 'follow' in Uganda is NOT manual");
}

console.log('\n— a country no gateway reaches —');
for (const r of [REGIONS.ke, REGIONS.tz]) {
  const it = inRegion(r);
  for (const g of AUTOMATIC) {
    ck(!it.gatewayServesRegion(g, r), `${g} does not serve ${r.name} (+${r.dialCode})`);
  }
  // THE bug. A brand-new region inherits exactly this settings shape.
  ck(it.payAAvailable({ depositPayAEnabled: true, depositMethod: 'marzpay' }, r) === false,
     `PAY A resolves OFF in ${r.name} even though the inherited flag says on`);
  ck(it.withdrawProvider({ withdrawMethod: 'marzpay' }, r) === 'manual',
     `a marzpay payout in ${r.name} falls back to manual`);
  ck(it.withdrawProvider({ withdrawMethod: 'follow', depositMethod: 'pesajet' }, r) === 'manual',
     `  and so does 'follow' onto an unsupported gateway`);
  ck(it.payoutIsManual({ withdrawMethod: 'lipapay' }, r) === true,
     `  so ${r.name} payouts wait for a human instead of a doomed provider call`);
}

console.log('\n— manual is admin-run, so it works anywhere —');
for (const r of Object.values(REGIONS)) {
  const it = inRegion(r);
  ck(it.gatewayServesRegion('manual', r), `manual serves ${r.name}`);
  ck(it.withdrawProvider({ withdrawMethod: 'manual' }, r) === 'manual',
     `  and stays manual in ${r.name}`);
}

console.log('\n— keyed on the DIALLING CODE, not the region key —');
{
  // A second Ugandan region has its own arbitrary key but the same numbers, so
  // it must keep working. Keying this on region.key would have broken it, and
  // the failure would look like "the gateway is down in that country".
  const ug2 = inRegion(REGIONS.ug2);
  ck(ug2.gatewayServesRegion('marzpay', REGIONS.ug2),
     "a second Ugandan region ('ug2') still reaches MarzPay");
  ck(ug2.payAAvailable({ depositPayAEnabled: true, depositMethod: 'marzpay' }, REGIONS.ug2) === true,
     '  and keeps PAY A');
  const it = inRegion(REGIONS.ug);
  ck(it.gatewayServesDial('marzpay', '+256'), 'a dial code written "+256" is accepted');
  ck(it.gatewayServesDial('marzpay', ' 256 '), 'and one with stray spaces');
  ck(!it.gatewayServesDial('marzpay', '2560'), 'but 2560 is NOT 256');
  ck(!it.gatewayServesDial('marzpay', ''), 'and a blank dial code reaches no gateway');
  ck(!it.gatewayServesRegion('marzpay', { name: 'Nowhere' }),
     'a region with no dialCode at all reaches no gateway');
}

console.log('\n— the admin flag still wins when it says off —');
{
  const ug = inRegion(REGIONS.ug);
  ck(ug.payAAvailable({ depositPayAEnabled: false, depositMethod: 'marzpay' }, REGIONS.ug) === false,
     'PAY A off in Uganda stays off (this check never turns anything ON)');
  ck(ug.payAAvailable(null, REGIONS.ug) === false, 'and no settings at all is not "available"');
}

console.log('\n— every automatic gateway is declared, none silently unrestricted —');
{
  const ug = inRegion(REGIONS.ug);
  // An automatic gateway missing from the map falls through gatewayServesDial's
  // `if (!allowed) return true` and is silently allowed EVERYWHERE -- which is
  // the exact bug this file exists to prevent. So the map has to cover the same
  // set of values normalizeProviderValue can return.
  for (const g of AUTOMATIC) {
    ck(Array.isArray(ug.GATEWAY_DIAL_CODES[g]) && ug.GATEWAY_DIAL_CODES[g].length > 0,
       `${g} has a declared country list`);
  }
  ck(ug.GATEWAY_DIAL_CODES.manual === undefined,
     "and manual is deliberately absent (absent means 'anywhere')");
  // Mined out of normalizeProviderValue itself rather than restated, so a
  // fourth gateway added there without a country list fails here.
  const accepted = [...src.matchAll(/v === '(marzpay|lipapay|pesajet|manual)'/g)].map(m => m[1]);
  const known = new Set(['manual', ...AUTOMATIC]);
  for (const v of accepted) ck(known.has(v), `normalizeProviderValue's '${v}' is accounted for here`);
}

console.log('\n— the guards are wired into the routes that move money —');
{
  // Checked INSIDE each handler, not file-wide: this file has several similar
  // provider lines and a loose match would pass with the guard deleted. That
  // mistake has been made here before.
  const depAt = src.indexOf("app.post('/deposit/marzpay'");
  const depEnd = src.indexOf("app.post('/deposit/", depAt + 10);
  ck(depAt > -1 && depEnd > depAt, 'the automatic deposit route was located');
  const depBody = src.slice(depAt, depEnd);
  ck(/gatewayServesRegion\(/.test(depBody),
     'the deposit route refuses a gateway that cannot reach this country');
  ck(depBody.indexOf('gatewayServesRegion') < depBody.indexOf('pendingDeposits'),
     '  and does so BEFORE any pending deposit row is written');

  const setAt = src.indexOf("app.post('/admin/settings/update'");
  const setEnd = src.indexOf('\napp.', setAt + 10);
  const setBody = src.slice(setAt, setEnd);
  ck(/gatewayServesRegion\(/.test(setBody),
     'the admin save refuses a gateway the picked country cannot use');
  // Matched on the CALL, not on `targetRegion` appearing somewhere in the
  // route: it appears many times there for unrelated reasons, so the loose
  // version passed with the check switched to currentRegion() -- which would
  // judge one country's gateway against whichever host the admin happens to
  // have the panel open on.
  ck(/gatewayServesRegion\(\s*value\s*,\s*targetRegion\s*\)/.test(setBody),
     '  judged against the region being SAVED, not the request host');

  // withdrawProvider() is called without an explicit region in the payout
  // path, so it falls back to currentRegion() -- and that is only correct
  // because processWithdrawalCore wraps the work in the MEMBER's region.
  // Without that wrapper an admin approving a Kenyan payout from a Ugandan
  // panel host would have it judged against Uganda, and MarzPay would be
  // handed a +254 number. Pinned because the wrapper is what makes the
  // default safe, and it is two functions away from where it matters.
  // Stated as the INVARIANT rather than as the shape of one call: every call
  // of _processWithdrawalNow must sit inside a withUserRegion() wrapper. An
  // earlier version matched `withUserRegion(ownerId,` and would have failed
  // the moment that local was renamed -- which it was, to pre.data().userId,
  // in the audit merge -- while the property it cared about was untouched.
  // Pinning a variable name defends a spelling; this defends the rule.
  const calls = [...src.matchAll(/_processWithdrawalNow\(/g)]
    .map(m => m.index)
    .filter(i => !/async function \w*$/.test(src.slice(Math.max(0, i - 40), i)));
  ck(calls.length > 0, 'there is at least one call of _processWithdrawalNow to check');
  for (const i of calls) {
    const before = src.slice(Math.max(0, i - 160), i);
    ck(/withUserRegion\([^;]*$/.test(before),
       'every payout runs inside the MEMBER\'s region, never the admin\'s');
  }

  const pubAt = src.indexOf("app.get('/public/settings'");
  const pubEnd = src.indexOf('\napp.', pubAt + 10);
  const pubBody = src.slice(pubAt, pubEnd);
  ck(/depositPayAEnabled:\s*payAAvailable\(/.test(pubBody),
     'and the app is served the RESOLVED PAY A flag, so it cannot offer a dead method');
}

console.log(bad ? `\n${bad} FAILED` : '\ngateway regions: all cases pass');
process.exit(bad ? 1 : 0);
