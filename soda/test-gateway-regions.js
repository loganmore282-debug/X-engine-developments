#!/usr/bin/env node
/**
 * A gateway may only be used in a country it can actually reach.
 *
 * WHY THIS EXISTS. A new region INHERITS settings/main -- Uganda's document --
 * carrying depositMethod:'marzpay' and depositPayAEnabled:true. So the day a
 * region was created for a country its gateway cannot reach, every deposit
 * there went to that gateway with a foreign number and every payout with it,
 * and nothing anywhere said so: the member saw a provider failure and the
 * admin saw a working configuration.
 *
 * WHICH COUNTRIES EACH GATEWAY REACHES IS PER GATEWAY, and the first version
 * of this file got that wrong. It asserted "no gateway serves Kenya", from
 * MarzPay's own SDK -- which pins currency to UGX independently of `country`
 * and rejects any non-+256 number. All true of the SDK, which is a year behind
 * the platform: MarzPay documents TWELVE markets. A correct test of a wrong
 * premise, and the premise was never worth pinning -- "every automatic gateway
 * is Uganda-only" was a coincidence of which providers happened to be wired
 * in, not a property. The per-gateway shape is what is pinned now.
 *
 * Three directions, and the first matters as much as the others:
 *   1. Uganda is completely unaffected. Every Uganda assertion exists so a fix
 *      for another country cannot quietly change the one that already works --
 *      including the "no depositMethod stored at all" shape every deployed
 *      database holds.
 *   2. A country only SOME gateways reach gets exactly those (Kenya: MarzPay
 *      yes, LipaPay and PesaJet no).
 *   3. A country NO gateway reaches resolves to manual everywhere it is
 *      decided -- PAY A off, payouts left to a human, the admin save refused.
 *
 * These are RUN, not read. Whether a resolver returns 'manual' for +255, or
 * which country code ends up in a request body, is not something a text match
 * on the source can answer.
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
  // Tanzania and Nigeria are in NO provider's market list, which is what makes
  // them the honest fixtures for "nothing automatic can work here". Kenya used
  // to serve that role and no longer can -- MarzPay reaches it.
  tz:  { key: 'tz',  name: 'Tanzania', dialCode: '255', currency: 'TZS' },
  ng:  { key: 'ng',  name: 'Nigeria', dialCode: '234', currency: 'NGN' },
  // Adjacent dialling codes, different countries, different currencies. The
  // MarzPay docs call this trap out by name.
  cd:  { key: 'cd',  name: 'DR Congo', dialCode: '243', currency: 'CDF' },
  cg:  { key: 'cg',  name: 'Congo-Brazzaville', dialCode: '242', currency: 'XAF' },
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

// The market table and the body builder, lifted separately -- they sit in a
// different part of server.js from the resolvers above.
const marketBlock = (() => {
  const a = src.indexOf('const MARZPAY_MARKETS');
  const b = src.indexOf('\n}', src.indexOf('function marzMarket'));
  if (a === -1 || b === -1) throw new Error('could not slice the MarzPay market table');
  return src.slice(a, b + 2);
})();
const bodySrc = (() => {
  const a = src.indexOf('function marzMoneyBody');
  const b = src.indexOf('\n}', src.indexOf('function marzNoMarket'));
  if (a === -1 || b === -1) throw new Error('could not slice marzMoneyBody/marzNoMarket');
  return src.slice(a, b + 2);
})();

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

console.log('\n— a country ONE gateway reaches but the others do not —');
// Kenya is MarzPay's second market. These assertions used to read "no gateway
// serves Kenya", which was a correct test of a WRONG premise: it came from
// MarzPay's SDK, which is a year behind its platform. The per-gateway shape is
// what should have been asserted all along -- "every automatic gateway is
// Uganda-only" was never a property worth pinning, it was a coincidence of
// which providers were wired in.
{
  const r = REGIONS.ke;
  const it = inRegion(r);
  ck(it.gatewayServesRegion('marzpay', r), 'marzpay DOES serve Kenya (+254)');
  ck(!it.gatewayServesRegion('lipapay', r), 'lipapay does not');
  ck(!it.gatewayServesRegion('pesajet', r), 'and neither does pesajet');
  ck(it.payAAvailable({ depositPayAEnabled: true, depositMethod: 'marzpay' }, r) === true,
     'so PAY A on marzpay is available in Kenya');
  ck(it.payAAvailable({ depositPayAEnabled: true, depositMethod: 'pesajet' }, r) === false,
     '  but PAY A on pesajet is not');
  ck(it.withdrawProvider({ withdrawMethod: 'marzpay' }, r) === 'marzpay',
     'a marzpay payout in Kenya goes to marzpay');
  ck(it.withdrawProvider({ withdrawMethod: 'lipapay' }, r) === 'manual',
     '  while a lipapay one falls back to manual');
}

console.log('\n— a country NO gateway reaches —');
// Tanzania is in none of the three providers' markets, so it is the honest
// fixture for "nothing automatic can work here". THE bug this file was written
// for: a brand-new region inherits exactly this settings shape from Uganda's.
for (const r of [REGIONS.tz, REGIONS.ng]) {
  const it = inRegion(r);
  for (const g of AUTOMATIC) {
    ck(!it.gatewayServesRegion(g, r), `${g} does not serve ${r.name} (+${r.dialCode})`);
  }
  ck(it.payAAvailable({ depositPayAEnabled: true, depositMethod: 'marzpay' }, r) === false,
     `PAY A resolves OFF in ${r.name} even though the inherited flag says on`);
  ck(it.withdrawProvider({ withdrawMethod: 'marzpay' }, r) === 'manual',
     `a marzpay payout in ${r.name} falls back to manual`);
  ck(it.withdrawProvider({ withdrawMethod: 'follow', depositMethod: 'pesajet' }, r) === 'manual',
     `  and so does 'follow' onto an unsupported gateway`);
  ck(it.payoutIsManual({ withdrawMethod: 'lipapay' }, r) === true,
     `  so ${r.name} payouts wait for a human instead of a doomed provider call`);
}

console.log("\n— MarzPay's market table, and the two traps its docs name —");
{
  const mk = new Function(marketBlock + '\nreturn { MARZPAY_MARKETS, marzMarket };')();
  // The twelve accepted `country` values, from the integration guide's §5.3
  // field table. Asserted as a SET so a market added to one place and not the
  // other cannot pass.
  const codes = Object.values(mk.MARZPAY_MARKETS).map(m => m.code).sort();
  ck(codes.length === 12, `twelve markets are declared (${codes.length})`);
  ck(codes.join(',') === 'BJ,CD,CG,CI,CM,GA,KE,RW,SL,SN,UG,ZM',
     `and they are exactly the documented set (${codes.join(',')})`);
  // Every gateway dial code must resolve to a market, or gatewayServesRegion
  // would admit a country marzMoneyBody() then refuses -- a deposit created
  // and immediately failed.
  const dials = Object.keys(mk.MARZPAY_MARKETS);
  for (const d of dials) ck(!!mk.MARZPAY_MARKETS[d].code, `+${d} maps to a country code`);
  ck(new Set(codes).size === 12, 'no country code is repeated');
  ck(new Set(dials).size === dials.length, 'and no dialling code is');

  // TRAP 1: Congo-Brazzaville (CG/+242) is not DRC (CD/+243).
  ck(mk.marzMarket(REGIONS.cd).code === 'CD', 'DRC (+243) resolves to CD');
  ck(mk.marzMarket(REGIONS.cg).code === 'CG', 'Congo-Brazzaville (+242) resolves to CG');
  ck(mk.marzMarket(REGIONS.cd).code !== mk.marzMarket(REGIONS.cg).code,
     '  and the two are never the same wallet');
  ck(mk.marzMarket(REGIONS.cd).currency === 'CDF' && mk.marzMarket(REGIONS.cg).currency === 'XAF',
     '  with their own currencies');

  // TRAP 2: XOF covers BJ/CI/SN and XAF covers CM/GA/CG, so currency alone
  // cannot identify a market -- which is why `country` must always be sent.
  const byCur = {};
  for (const m of Object.values(mk.MARZPAY_MARKETS)) (byCur[m.currency] ||= []).push(m.code);
  ck(byCur.XOF && byCur.XOF.length === 3, `XOF is shared by three markets (${byCur.XOF})`);
  ck(byCur.XAF && byCur.XAF.length === 3, `XAF is shared by three markets (${byCur.XAF})`);

  // DRC is the only dual-wallet market, and the only one told to send currency.
  const dual = Object.values(mk.MARZPAY_MARKETS).filter(m => m.currencies);
  ck(dual.length === 1 && dual[0].code === 'CD',
     'DRC is the only market carrying more than one wallet currency');

  ck(mk.marzMarket(REGIONS.tz) === null, 'a country MarzPay does not serve resolves to null');
  ck(mk.marzMarket({ name: 'No dial' }) === null, 'and so does a region with no dialCode');
}

console.log('\n— the request body names the market, and refuses to guess —');
{
  const bodyFns = new Function(
    marketBlock +
    "function currentRegion(){ return " + JSON.stringify(REGIONS.ug) + "; }" +
    bodySrc + '\nreturn { marzMoneyBody, marzNoMarket };')();
  const base = { amount: 5000, phone: '+254712345678', reference: 'uuid-v4-here',
                 description: 'Mobile Money' };

  const ug = bodyFns.marzMoneyBody({ ...base, phone: '+256712345678', region: REGIONS.ug });
  ck(ug.country === 'UG', 'a Ugandan request still says UG (nothing changed for Uganda)');
  ck(ug.currency === undefined,
     '  and sends no currency, because UG has one wallet and the docs ask for it only on DRC');

  const ke = bodyFns.marzMoneyBody({ ...base, region: REGIONS.ke });
  ck(ke.country === 'KE', 'a Kenyan request says KE');
  ck(ke.phone_number === '+254712345678' && ke.amount === 5000 && ke.reference === base.reference,
     '  carrying the phone, amount and UUID reference through untouched');

  const cd = bodyFns.marzMoneyBody({ ...base, region: REGIONS.cd });
  ck(cd.country === 'CD' && cd.currency === 'CDF',
     'a DRC request names the wallet currency, which is the one market that needs it');

  // The belt to gatewayServesRegion's braces. A body with the WRONG country
  // would move real money in the wrong market, so refusing beats defaulting.
  ck(bodyFns.marzMoneyBody({ ...base, region: REGIONS.tz }) === null,
     'and an unserved country yields NO body rather than defaulting to UG');
  const no = bodyFns.marzNoMarket(REGIONS.tz);
  ck(no.status === 'error' && /Tanzania/.test(no.message),
     '  with an error naming the country');
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
  // A gateway that CAN reach the country but settles in a different currency
  // than the country is configured for is money labelled in the wrong unit on
  // every screen -- figures right, unit a lie, and nothing downstream could
  // detect it.
  ck(/marzMarket\(targetRegion\)/.test(setBody) && /market\.currency/.test(setBody),
     'and the save refuses a country whose currency disagrees with the market');

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

// LAST, because marzGetBalance is async and everything above is synchronous.
// The summary moves inside it so the exit code still covers these.
(async () => {
  console.log('\n— the balance is read PER COUNTRY WALLET —');
  // Balances are per country wallet, so an unqualified GET /balance returns
  // whichever wallet the API defaults to: a figure for the wrong country under
  // this one's heading, on the screen used to decide whether there is enough
  // money to pay withdrawals.
  const balSrc = (() => {
    const a = src.indexOf('async function marzGetBalance');
    const b = src.indexOf('\n}', a);
    if (a === -1 || b === -1) throw new Error('could not slice marzGetBalance');
    return src.slice(a, b + 2);
  })();
  const calls = [];
  const markets = new Function(marketBlock + '\nreturn MARZPAY_MARKETS;')();
  const marzGetBalance = new Function('CALLS', 'MARKETS', `
    const MARZPAY_BASE = 'https://marz.test/api/v1', MARZPAY_KEY = 'k', MARZ_TIMEOUT = 1;
    const MARZPAY_MARKETS = MARKETS;
    function marzMarket(r){ return MARKETS[String((r && r.dialCode) || '').replace(/\\D/g,'')] || null; }
    function marzNoMarket(r){ return { status: 'error', message: 'no market for ' + ((r && r.name) || '?') }; }
    async function _marzParse(){ return { status: 'success' }; }
    function _marzExtractBalance(){ return { amount: 1, formatted: '1' }; }
    const AbortSignal = { timeout: () => null };
    const fetch = (url) => { CALLS.push(url); return Promise.resolve({}); };
    ${balSrc}
    return marzGetBalance;
  `)(calls, markets);

  await marzGetBalance(REGIONS.ug);
  ck(/[?&]country=UG(&|$)/.test(calls[0]),
     `the Ugandan balance names its own country wallet (${calls[0]})`);
  ck(!/currency=/.test(calls[0]), '  and sends no currency, since UG has one wallet');

  await marzGetBalance(REGIONS.ke);
  ck(/[?&]country=KE(&|$)/.test(calls[1]), 'the Kenyan balance names KE');

  await marzGetBalance(REGIONS.cd);
  ck(/country=CD/.test(calls[2]) && /currency=CDF/.test(calls[2]),
     `DRC names both its country and its wallet currency (${calls[2]})`);

  const none = await marzGetBalance(REGIONS.tz);
  ck(none && none.status === 'error',
     'a country MarzPay does not serve is an error, not somebody else\'s wallet');
  ck(calls.length === 3, '  and no request is made for it');

  // The admin route must read the COUNTRY SWITCH's region, not the host the
  // panel happens to be open on, or one country's float appears under
  // another's name.
  const at = src.indexOf("app.get('/admin/marzpay/balance'");
  const end = src.indexOf('\napp.', at + 10);
  ck(at > -1 && end > at, 'the admin balance route was located');
  const body = src.slice(at, end);
  ck(/adminRegionFilter\(req\)/.test(body), 'it reads the picked country, not the request host');
  ck(/marzGetBalance\(region\)/.test(body), '  and passes that region through');
  ck(/regionKey: region\.key/.test(body),
     '  and the reply names the region it read, so the card cannot be mislabelled');

  console.log(bad ? `\n${bad} FAILED` : '\ngateway regions: all cases pass');
  process.exit(bad ? 1 : 0);
})();
