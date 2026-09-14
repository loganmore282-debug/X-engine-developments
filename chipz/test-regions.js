/**
 * Multi-country regions: one subdomain per country, with its own currency,
 * dialling code, number shape, settings and product prices.
 *
 * Owner: "l wanted other subdomain to fetch other country code and currency,
 * ie fgdr.chipz-platform.com in ugx, and country code changeable to other
 * country or created, and another can be sfhd.chipz-platform in KES shs, or
 * any country created, also make when l can edit prices of each product and
 * all settings as these of ugx."
 *
 * Everything here runs the REAL functions lifted out of server.js and
 * user-src/original_module.js -- nothing is restated. Two things it checks
 * that nothing else can:
 *
 *   1. The SYNTHETIC LOGIN EMAIL the app builds and the one the server
 *      builds are the same string, for every region. They are two separate
 *      implementations in two files; if they ever disagree, a member creates
 *      one Firebase account and then signs in looking for another.
 *   2. A second region cannot collide with Uganda's existing logins. Uganda
 *      keeps the bare local digits every deployed account already uses;
 *      every other country carries its dialling code.
 */
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/server.js', 'utf8');
const client = fs.readFileSync(__dirname + '/user-src/original_module.js', 'utf8');

let failed = 0;
const ck = (ok, label) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); };

// Pull one named function out by matching its braces. `async` is matched
// first or the extracted body loses it and `await` inside becomes a syntax
// error.
function fnSource(text, name) {
  let start = text.indexOf(`async function ${name}(`);
  if (start === -1) start = text.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`no such function: ${name}`);
  let depth = 0;
  for (let k = text.indexOf('{', start); k < text.length; k++) {
    if (text[k] === '{') depth++;
    else if (text[k] === '}') { depth--; if (depth === 0) return text.slice(start, k + 1); }
  }
  throw new Error(`unbalanced braces in ${name}`);
}
// Comments stripped before any "does the code do X" scan, and LINE comments
// stripped BEFORE block comments -- a `/*` sitting inside a `//` line
// otherwise blanks everything to the next `*/`, hundreds of lines away, and
// the scan then passes because the code it was looking for is invisible.
function stripComments(text) {
  return text.replace(/(^|[^:])\/\/[^\n]*/g, '$1').replace(/\/\*[\s\S]*?\*\//g, '');
}
const bare = stripComments(src);
const bareClient = stripComments(client);

// ── the region model, as pure functions ──────────────────────────────────
const api = new Function('normalizeAllowedHost', `
  const DEFAULT_REGION_KEY = 'ug';
  const DEFAULT_REGION = Object.freeze({
    key: 'ug', name: 'Uganda', currency: 'UGX', dialCode: '256',
    localLength: 9, prefixes: ['7'], utcOffsetMin: 180, hosts: [], active: true, isDefault: true,
  });
  let _regionsSnapshot = [DEFAULT_REGION];
  let _current = DEFAULT_REGION;
  const currentRegion = () => _current;
  const currentRegionKey = () => _current.key;
  const defaultRegion = () => _regionsSnapshot[0] || DEFAULT_REGION;
  const setRegions = list => { _regionsSnapshot = list; };
  const setCurrent = r => { _current = r; };
  ${fnSource(src, 'normalizeRegion')}
  let _baseDomain = 'chipz-platform.com';
  let _blockRootDomain = true;
  let _parkedHosts = [];
  let _strictRegionHosts = false;
  let _regionHosts = [];
  let _corsExtraHosts = [];
  let _mainAllowedHosts = [];
  const CORS_ALLOWED_SUFFIXES = ['.edgeone.app', '.edgeone.site', '.edgeone.dev', '.onrender.com', '.pages.dev'];
  const setHostPolicy = o => { if (o.baseDomain !== undefined) _baseDomain = o.baseDomain;
    if (o.blockRootDomain !== undefined) _blockRootDomain = o.blockRootDomain;
    if (o.parkedHosts !== undefined) _parkedHosts = o.parkedHosts;
    if (o.strictRegionHosts !== undefined) _strictRegionHosts = o.strictRegionHosts;
    rebuildRegionHosts(); };
  ${fnSource(src, 'refreshCorsSnapshot')}
  ${fnSource(src, 'hostOnly')}
  ${fnSource(src, 'regionHostnames')}
  ${fnSource(src, 'rebuildRegionHosts')}
  ${fnSource(src, 'isInfraHost')}
  ${fnSource(src, 'hostIsParked')}
  ${fnSource(src, 'regionForHost')}
  ${fnSource(src, 'settingsDocId')}
  ${fnSource(src, 'applyRegionToProduct')}
  ${fnSource(src, 'localDigits')}
  ${fnSource(src, 'cleanPhone')}
  ${fnSource(src, 'phoneToEmail')}
  ${fnSource(src, 'phoneFormatHint')}
  ${fnSource(src, 'badPhoneMessage')}
  ${fnSource(src, 'looksLikeRegionMobile')}
  ${fnSource(src, 'fmtMoney')}
  ${fnSource(src, 'hhmmToMin')}
  const PRODUCT_REGION_FIELDS = ${JSON.stringify(JSON.parse('[' + (/const PRODUCT_REGION_FIELDS = \[([^\]]*)\]/.exec(bare)[1]).replace(/'/g, '"') + ']'))};
  return { DEFAULT_REGION, normalizeRegion, regionForHost, settingsDocId, applyRegionToProduct,
           localDigits, cleanPhone, phoneToEmail, phoneFormatHint, badPhoneMessage,
           looksLikeRegionMobile, fmtMoney, setRegions, setCurrent, PRODUCT_REGION_FIELDS,
           hostIsParked, regionHostnames, isInfraHost, setHostPolicy,
           corsHosts: () => _corsExtraHosts.slice() };
`)(new Function('raw', fnSource(src, 'normalizeAllowedHost').replace(/^function [^{]*/, '') + '')
   // normalizeAllowedHost is a plain function; wrap it so the new Function
   // above can take it as an argument instead of re-declaring it.
   );

// The client's own copy of the same two functions, with its region hooks.
function clientApi(region) {
  return new Function(`
    var REGION = ${JSON.stringify(region)};
    function cur(){ return (REGION && REGION.currency) || 'UGX'; }
    function dial(){ return (REGION && REGION.dialCode) || '256'; }
    function dialPlus(){ return '+' + dial(); }
    function localLen(){ return Number(REGION && REGION.localLength) || 9; }
    function regionPrefixes(){ return (REGION && Array.isArray(REGION.prefixes) ? REGION.prefixes.filter(Boolean) : []); }
    ${fnSource(client, 'localDigits')}
    ${fnSource(client, 'phoneToEmail')}
    ${fnSource(client, 'cleanPhone')}
    ${fnSource(client, 'fmtUGX')}
    return { localDigits, phoneToEmail, cleanPhone, fmtUGX };
  `)();
}

const UG = api.DEFAULT_REGION;
const KE = api.normalizeRegion({
  key: 'ke', name: 'Kenya', currency: 'KES', dialCode: '254', localLength: 9,
  prefixes: ['7', '1'], utcOffsetMin: 180, hosts: ['sfhd.chipz-platform.com'], active: true,
}, 'ke');

console.log('— a country is stored in the shape the rest of the server relies on —');
ck(KE.key === 'ke' && KE.currency === 'KES' && KE.dialCode === '254', 'a new country keeps its id, currency and dialling code');
ck(KE.isDefault === false, 'and is not the founding region');
ck(UG.isDefault === true && UG.key === 'ug', 'while Uganda is');
{
  const messy = api.normalizeRegion({ key: 'NG', name: '  Nigeria  ', currency: 'ngn', dialCode: '+234 ', localLength: '10', prefixes: '70, 80 81', hosts: 'https://ng.chipz-platform.com/  , NG2.chipz-platform.com' }, 'ng');
  ck(messy.currency === 'NGN', 'a lowercase currency is stored uppercase');
  ck(messy.dialCode === '234', 'a dialling code typed with + and spaces is stored as digits');
  ck(messy.localLength === 10, 'a length typed as text becomes a number');
  ck(JSON.stringify(messy.prefixes) === '["70","80","81"]', 'prefixes split on commas and spaces alike');
  ck(JSON.stringify(messy.hosts) === '["ng.chipz-platform.com","ng2.chipz-platform.com"]', 'hostnames lose their scheme, path and case');
  ck(messy.name === 'Nigeria', 'and the name is trimmed');
}
{
  const off = api.normalizeRegion({ key: 'ke', dialCode: '254', utcOffsetMin: 0 }, 'ke');
  ck(off.utcOffsetMin === 0, 'a zero clock offset survives (it is UTC, not "unset")');
  const noOff = api.normalizeRegion({ key: 'ke', dialCode: '254' }, 'ke');
  ck(noOff.utcOffsetMin === 180, 'and an unset one defaults to +3');
  const offDefault = api.normalizeRegion({ key: 'ug', active: false }, 'ug');
  ck(offDefault.active === true, 'the founding country cannot be switched off');
}

console.log('\n— a hostname resolves to its country —');
api.setRegions([UG, KE]);
ck(api.regionForHost('sfhd.chipz-platform.com').key === 'ke', 'the Kenyan subdomain is Kenya');
ck(api.regionForHost('https://sfhd.chipz-platform.com/app').key === 'ke', 'with a scheme and a path too');
ck(api.regionForHost('SFHD.chipz-platform.com:443').key === 'ke', 'and in any case, with a port');
ck(api.regionForHost('chipz-app.onrender.com').key === 'ug', 'an address no country claims falls back to the founding one');
ck(api.regionForHost('').key === 'ug', 'as does no address at all');
{
  const shut = Object.assign({}, KE, { active: false });
  api.setRegions([UG, shut]);
  ck(api.regionForHost('sfhd.chipz-platform.com').key === 'ug', 'a country switched off stops answering for its own address');
  api.setRegions([UG, KE]);
}

console.log('\n— each country has its own settings document —');
ck(api.settingsDocId('ug') === 'main', 'Uganda keeps settings/main, so nothing migrates');
ck(api.settingsDocId() === 'main', 'and so does an unspecified country');
ck(api.settingsDocId('ke') === 'region-ke', 'Kenya gets its own');

console.log('\n— the number a member types —');
api.setCurrent(UG);
ck(api.cleanPhone('0742730382') === '+256742730382', 'a Ugandan 07 number is accepted');
ck(api.cleanPhone('742730382') === '+256742730382', 'so is the bare 9-digit form');
ck(api.cleanPhone('256742730382') === '+256742730382', 'and the full international one');
ck(api.cleanPhone('0412345678') === null, 'a Ugandan landline is refused (wrong prefix)');
ck(api.cleanPhone('07427303') === null, 'and a short number is refused');
api.setCurrent(KE);
ck(api.cleanPhone('0712345678') === '+254712345678', 'a Kenyan number gets Kenyaʼs code, not Ugandaʼs');
ck(api.cleanPhone('0112345678') === '+254112345678', 'and Kenyaʼs second mobile block is accepted');
ck(api.cleanPhone('0212345678') === null, 'while a prefix Kenya did not list is refused');
ck(api.cleanPhone('256742730382') === null, 'a Ugandan number is not a valid Kenyan one');
{
  const anyPrefix = api.normalizeRegion({ key: 'zz', name: 'Nowhere', currency: 'ZZZ', dialCode: '999', localLength: 8, prefixes: [] }, 'zz');
  api.setCurrent(anyPrefix);
  ck(api.cleanPhone('012345678') === '+99912345678', 'a country with no prefix list takes any number of the right length');
  ck(api.cleanPhone('0123456789') === null, 'but still not the wrong length');
}

console.log('\n— the money label —');
api.setCurrent(UG);
ck(api.fmtMoney(30000) === 'UGX 30,000', 'Uganda reads UGX');
api.setCurrent(KE);
ck(api.fmtMoney(30000) === 'KES 30,000', 'Kenya reads KES');
ck(api.fmtMoney(1234.5) === 'KES 1,234.50', 'and cents still show where they exist');

console.log('\n— the login address, which the app and the server must agree on —');
for (const [region, local] of [[UG, '0742730382'], [UG, '742730382'], [KE, '0712345678'], [KE, '712345678']]) {
  api.setCurrent(region);
  const server = api.phoneToEmail(api.cleanPhone(local) || local);
  const app = clientApi(region).phoneToEmail(clientApi(region).cleanPhone(local) || local);
  ck(server === app, `${region.key}/${local}: app and server build the same address (${server})`);
}
api.setCurrent(UG);
ck(api.phoneToEmail('+256742730382') === '742730382@chipz-platform.com',
  'Uganda keeps the bare local digits every deployed login already uses');
api.setCurrent(KE);
ck(api.phoneToEmail('+254712345678') === '254712345678@chipz-platform.com',
  'Kenya carries its dialling code');
{
  // The collision this exists to prevent: the same local number in two
  // countries must not resolve to one Firebase account.
  api.setCurrent(UG);
  const ug = api.phoneToEmail('+256712345678');
  api.setCurrent(KE);
  const ke = api.phoneToEmail('+254712345678');
  ck(ug !== ke, `0712345678 in Uganda and in Kenya are different accounts (${ug} vs ${ke})`);
}

console.log('\n— the format hint, and picking a payer out of an SMS —');
api.setCurrent(UG);
ck(api.phoneFormatHint().local === '07XXXXXXXX' && api.phoneFormatHint().intl === '+2567XXXXXXXX',
  'Uganda is told to type 07XXXXXXXX or +2567XXXXXXXX');
ck(/Uganda/.test(api.badPhoneMessage()), 'and a rejection names Uganda');
api.setCurrent(KE);
ck(api.phoneFormatHint().intl === '+2547XXXXXXXX', 'Kenya is told its own shape');
ck(/Kenya/.test(api.badPhoneMessage()), 'and a rejection names Kenya');
api.setCurrent(UG);
ck(api.looksLikeRegionMobile('+256742730382') === true, 'a Ugandan mobile looks like one');
ck(api.looksLikeRegionMobile('+256412345678') === false, 'a Ugandan landline does not');
ck(api.looksLikeRegionMobile(null) === false, 'and nothing at all does not');

console.log('\n— a product costs what its own country says —');
const PROD = {
  key: 'product-1', name: 'Product-1', price: 30000, expectedReturn: 900000, cycle: 150,
  image: '/p1.jpg', order: 1,
  regions: { ke: { price: 500, expectedReturn: 15000 } },
};
{
  const ug = api.applyRegionToProduct(PROD, 'ug');
  ck(ug.price === 30000 && ug.expectedReturn === 900000, 'Uganda sells it at the documentʼs own price');
  ck(ug.regions === undefined, 'and the overrides never reach a client');
  const ke = api.applyRegionToProduct(PROD, 'ke');
  ck(ke.price === 500 && ke.expectedReturn === 15000, 'Kenya sells it at Kenyaʼs price');
  ck(ke.name === 'Product-1' && ke.image === '/p1.jpg' && ke.order === 1, 'while the name, photo and order stay shared');
  ck(ke.cycle === 150, 'a field Kenya did not set falls through to the shared value');
  ck(ke.regions === undefined, 'and Kenyaʼs view carries no overrides either');
  const other = api.applyRegionToProduct(PROD, 'ng');
  ck(other.price === 30000, 'a country with no override for this product inherits the shared price');
  const blank = api.applyRegionToProduct({ key: 'p', price: 100, cycle: 7, regions: { ke: { price: 9, cycle: '' } } }, 'ke');
  ck(blank.price === 9 && blank.cycle === 7, 'a field blanked in the editor goes back to inheriting, it does not become 0');
}
ck(api.PRODUCT_REGION_FIELDS.includes('price') && api.PRODUCT_REGION_FIELDS.includes('expectedReturn')
   && api.PRODUCT_REGION_FIELDS.includes('spinMin') && api.PRODUCT_REGION_FIELDS.includes('active'),
  'price, payout, spin band and availability are all per-country');
ck(!api.PRODUCT_REGION_FIELDS.includes('name') && !api.PRODUCT_REGION_FIELDS.includes('image'),
  'and the name and photo are not, so one country cannot rename a product for everyone');

console.log('\n— the money-safety rules, in the code that ships —');
// A member's region comes from THEIR ACCOUNT, not from the request. If it
// came from the request, somebody could register where a product costs
// 30,000 KES and buy it where the same product costs 30,000 UGX.
{
  const mw = bare.slice(bare.indexOf('app.use(async (req, res, next) => {\n  let region = defaultRegion();'));
  const block = mw.slice(0, mw.indexOf('_regionCtx.run({ region }, next);'));
  ck(/region = regionForHost\(host\)/.test(block) && /const host = requestHost\(req\)/.test(block),
    'a visitor gets the region that owns the hostname');
  ck(/req\.headers\.origin \|\| req\.headers\.host/.test(stripComments(fnSource(src, 'requestHost'))),
    'read from Origin, because the app is served from a different origin than this API');
  ck(/userRegionKey\(uid\)/.test(block) && /region = regionByKey\(key\)/.test(block),
    'and a signed-in caller overrides it with their own accountʼs region');
  ck(block.indexOf('regionForHost') < block.indexOf('userRegionKey'),
    'in that order, so the account always wins over the address');
}
ck(/regionKey: String\(regionKey \|\| currentRegionKey\(\)/.test(bare),
  'a new account is stamped with the region it signed up in');
ck(!/regionKey:\s*(req\.body|req\.query)/.test(bare),
  'and no route ever takes a regionKey from the request body');
ck(/BAD_REFERRAL_REGION/.test(bare) && /refRegion !== myRegion/.test(bare),
  'a referral code from another country is refused, so commission is never paid across currencies');
{
  const save = bare.slice(bare.indexOf("app.post('/admin/products/save'"));
  const body = save.slice(0, save.indexOf('catch (e)'));
  ck(/\['regions\.' \+ region\.key\]/.test(body),
    'a countryʼs prices are written at a dotted path, so saving one country cannot wipe another');
  ck(!/regions: \{ \[region\.key\]/.test(body),
    'and not as a nested map, which this Mongo layer would turn into a whole-map replace');
}
{
  const upd = bare.slice(bare.indexOf("app.post('/admin/settings/update'"));
  const body = upd.slice(0, upd.indexOf('logAdminAction'));
  ck(/GLOBAL_ONLY_SETTINGS\.filter\(k => k in updates\)/.test(body),
    'a backend-wide setting typed into a countryʼs screen is refused, not silently dropped');
  ck(/settingsDocId\(targetRegion\.key\)/.test(body), 'and a countryʼs own settings go to its own document');
}
{
  const g = /const GLOBAL_ONLY_SETTINGS = \[([^\]]*)\]/.exec(bare)[1];
  for (const k of ['allowedOrigins', 'maintenanceMode', 'openingCountdownEnabled'])
    ck(g.includes(k), `${k} stays backend-wide`);
  for (const k of ['minWithdraw', 'commL1', 'returnMultiple', 'withdrawWindowEnabled'])
    ck(!g.includes(k), `${k} is per-country`);
}
ck(/for \(const region of await getRegions\(\)\)/.test(bare) && /String\(wit\.regionKey \|\| DEFAULT_REGION_KEY\) !== regionKey/.test(bare),
  'auto-approval runs once per country and only touches that countryʼs cash-outs');
ck(/String\(d\.data\(\)\.regionKey \|\| DEFAULT_REGION_KEY\) === regionKey/.test(bare),
  'a manual payment number is only offered to the country it was added for');
{
  // Inside getRegions(), not merely "somewhere in the file" -- the variable
  // and the function are DECLARED elsewhere, so a file-wide check still
  // passed with the code that actually fills the list deleted, and every new
  // subdomain would then be CORS-refused by a perfectly healthy server.
  const g = stripComments(fnSource(src, 'getRegions'));
  ck(/rebuildRegionHosts\(\)/.test(g), 'loading the regions rebuilds the host list');
  const rb = stripComments(fnSource(src, 'rebuildRegionHosts'));
  ck(/regionHostnames\(r\)/.test(rb) && /_regionHosts\.push\(h\)/.test(rb) && /refreshCorsSnapshot\(\)/.test(rb),
    'and every country address -- short names included -- lands in the CORS allowlist');
}
{
  // Deleting a country takes its rates and its product prices with it. Left
  // behind, they would come back into force the day somebody recreated a
  // region under the same id, with figures nobody remembers setting -- and
  // the panel's own confirm dialog promises they are gone.
  const del = bare.slice(bare.indexOf("app.post('/admin/regions/delete'"));
  const body = del.slice(0, del.indexOf("app.get('/admin/chipz-images'"));
  ck(/collection\('settings'\)\.doc\(settingsDocId\(key\)\)\.delete\(\)/.test(body),
    'deleting a country deletes its settings document');
  ck(/\['regions\.' \+ key\]: FieldValue\.delete\(\)/.test(body),
    'and unsets its price overrides on every product');
  ck(/where\('regionKey', '==', key\)/.test(body) && /members\.empty/.test(body),
    'but is refused while anyone is signed up in it');
}
{
  // Background money jobs have no request, so they must adopt the member's
  // own region -- or a Kenyan's maturity payout would be described in UGX.
  for (const fn of ['settleInvestmentIfDue', 'creditReferralCommission', 'creditDeposit', 'processWithdrawalCore'])
    ck(new RegExp('function ' + fn + '\\([^)]*\\) \\{\\s*(let ownerId[\\s\\S]{0,320})?return withUserRegion').test(bare),
      `${fn}() runs in the memberʼs own region`);
}

console.log('\n— short addresses per country (g26e, shy) —');
{
  const ug = api.normalizeRegion({ key: 'ug', name: 'Uganda', currency: 'UGX', dialCode: '256',
    localLength: 9, prefixes: ['7'], labels: 'g26e, x7k2' }, 'ug');
  const ke2 = api.normalizeRegion({ key: 'ke', name: 'Kenya', currency: 'KES', dialCode: '254',
    localLength: 9, prefixes: ['7'], labels: ['shy'] }, 'ke');
  ck(JSON.stringify(ug.labels) === '["g26e","x7k2"]', 'a country holds several short names');
  api.setRegions([ug, ke2]);
  api.setHostPolicy({ baseDomain: 'chipz-platform.com', blockRootDomain: true, parkedHosts: [], strictRegionHosts: false });
  ck(api.regionHostnames(ug).includes('g26e.chipz-platform.com'),
    'a short name resolves against the base domain: ' + api.regionHostnames(ug).join(', '));
  ck(api.regionForHost('g26e.chipz-platform.com').key === 'ug', 'g26e is Uganda');
  ck(api.regionForHost('shy.chipz-platform.com').key === 'ke', 'shy is Kenya');
  ck(api.corsHosts().includes('shy.chipz-platform.com'),
    'and every short address is allowed to reach the backend without being typed into the allowlist');
  // A parked address must be able to READ its own refusal. CORS-refuse it
  // and the browser drops the 403 before any code sees it, so the app shows
  // its generic "Network error" instead of the notice -- exactly the
  // confusion HOST_PARKED exists to remove.
  ck(api.corsHosts().includes('chipz-platform.com'),
    'and the root domain is allowed through CORS so it can read its own refusal');
  // normalizeRegion() stays PERMISSIVE on purpose: it also runs over
  // whatever is already stored, and refusing there would take a country
  // offline. Whitespace and commas both separate, so "sp ace" is two
  // addresses, which is what that field says it does.
  const messy = api.normalizeRegion({ key: 'zz', dialCode: '1', labels: 'G26E, WWW, -bad, ok-2, sp ace' }, 'zz');
  ck(JSON.stringify(messy.labels) === '["g26e","ok-2","sp","ace"]',
    'stored labels are lowercased, and www / a leading dash are dropped: ' + JSON.stringify(messy.labels));
  // The SAVE route is where a typed one is refused rather than repaired --
  // an admin shown "hello" after typing "he!lo" has been given an address
  // they did not choose.
  const save = bare.slice(bare.indexOf("app.post('/admin/regions/save'"));
  const saveBody = save.slice(0, save.indexOf("app.post('/admin/regions/add-label'"));
  ck(/is not a usable address/.test(saveBody) && /\^\[a-z0-9\]\(\[a-z0-9-\]\*\[a-z0-9\]\)\?\$/.test(saveBody),
    'a typed address with a bad character is refused, not silently repaired');
  ck(/cannot be a country address/.test(saveBody), 'and "www" is refused by name');
}

console.log('\n— the root domain does not serve the app —');
{
  const ug = api.normalizeRegion({ key: 'ug', dialCode: '256', labels: ['g26e'] }, 'ug');
  api.setRegions([ug]);
  api.setHostPolicy({ baseDomain: 'chipz-platform.com', blockRootDomain: true, parkedHosts: [], strictRegionHosts: false });
  ck(api.hostIsParked('chipz-platform.com') === true, 'the bare domain is refused');
  ck(api.hostIsParked('www.chipz-platform.com') === true, 'and so is its www. form');
  ck(api.hostIsParked('https://chipz-platform.com/refCode=ABC') === true, 'however it is written');
  ck(api.hostIsParked('g26e.chipz-platform.com') === false, 'a country’s own short address still works');
  // The owner administers and tests from these. strictRegionHosts would
  // otherwise lock him out of the panel the setting is turned off in.
  for (const h of ['chipz-app.onrender.com', 'chipz-admin.onrender.com', 'x.edgeone.app', 'localhost', '127.0.0.1'])
    ck(api.hostIsParked(h) === false, `the platform’s own host ${h} is never refused`);
  // A gateway webhook and Render's health check arrive with no Origin at
  // all. Money that has already left a payer's account must never be lost
  // to a domain rule.
  ck(api.hostIsParked('') === false, 'a request with no address at all is never refused');
  {
    // Checked again with STRICT mode on, because that is the only setting
    // under which an empty host would otherwise be parked -- with strict
    // off every later rule says "not parked" anyway, so this case cannot
    // tell the early return from its absence. Verified by mutation:
    // deleting `if (!h) return false;` goes undetected without this.
    api.setHostPolicy({ strictRegionHosts: true });
    ck(api.hostIsParked('') === false, 'including in strict mode, so a gateway webhook can never be lost to a domain rule');
    api.setHostPolicy({ strictRegionHosts: false });
  }
  api.setHostPolicy({ blockRootDomain: false });
  ck(api.hostIsParked('chipz-platform.com') === false, 'and the block can be switched off');
  api.setHostPolicy({ blockRootDomain: true, parkedHosts: ['old.chipz-platform.com'] });
  ck(api.hostIsParked('old.chipz-platform.com') === true, 'a retired address is refused too');
  api.setHostPolicy({ parkedHosts: [] });
  ck(api.hostIsParked('zzz.chipz-platform.com') === false, 'an unclaimed name works while strict mode is off');
  api.setHostPolicy({ strictRegionHosts: true });
  ck(api.hostIsParked('zzz.chipz-platform.com') === true, 'and is refused once it is on');
  ck(api.hostIsParked('g26e.chipz-platform.com') === false, 'while a claimed one still works in strict mode');
  ck(api.hostIsParked('chipz-app.onrender.com') === false, 'and the Render address still works in strict mode');
  api.setHostPolicy({ strictRegionHosts: false });
}

console.log('\n— and the refusal is a readable answer, not a dropped request —');
{
  const mw = bare.slice(bare.indexOf("if (GUARD_EXEMPT.has(req.path)) return next();\n  const store = _regionCtx.getStore();"));
  const block = mw.slice(0, mw.indexOf('});'));
  ck(/HOST_PARKED/.test(block) && /status\(403\)/.test(block),
    'a parked address gets 403 HOST_PARKED, so the app can tell it apart from the server being down');
  ck(/GUARD_EXEMPT\.has\(req\.path\)/.test(block),
    'and the payment webhooks are exempt, so a domain rule can never lose a payment');
  ck(/data\.code === 'HOST_PARKED'/.test(bareClient) && /showHostParked/.test(bareClient),
    'the app handles it in api(), so it does not matter which call happens to be first');
  const parked = stripComments(fnSource(client, 'showHostParked'));
  ck(/loadingScreen/.test(parked) && /_hostParkedShown/.test(parked),
    'the notice takes the loading screen down with it, and shows once');
}

console.log('\n— an address can be generated on demand —');
{
  const gen = bare.slice(bare.indexOf("app.post('/admin/regions/add-label'"));
  const body = gen.slice(0, gen.indexOf("app.post('/admin/regions/delete'"));
  ck(/randFromAlphabet\(LABEL_ALPHABET/.test(body), 'the label is minted with the CSPRNG, not Math.random');
  ck(/for \(const r of regions\) for \(const l of \(r\.labels \|\| \[\]\)\) taken\.add\(l\)/.test(body),
    'and checked unique across EVERY country, not just this one');
  ck(/\(region\.labels \|\| \[\]\)\.concat\(\[label\]\)/.test(body),
    'it is ADDED, so an address already shared with members keeps working');
  const alpha = /const LABEL_ALPHABET = '([^']*)'/.exec(bare)[1];
  for (const ch of ['l', 'o', '0', '1'])
    ck(!alpha.includes(ch), `the alphabet leaves out "${ch}", which gets misread off a screen`);
}

console.log('\n— the host rules are backend-wide and validated —');
{
  const g = /const GLOBAL_ONLY_SETTINGS = \[([^\]]*)\]/.exec(bare)[1];
  for (const k of ['baseDomain', 'blockRootDomain', 'parkedHosts', 'strictRegionHosts'])
    ck(g.includes(k), `${k} cannot be set per country`);
  const upd = bare.slice(bare.indexOf("app.post('/admin/settings/update'"));
  const body = upd.slice(0, upd.indexOf('logAdminAction'));
  ck(/if \('baseDomain' in updates\)/.test(body) && /normalizeAllowedHost\(updates\.baseDomain\)/.test(body),
    'a mistyped base domain is refused, not stored');
  ck(/sanitizeAllowedOrigins\(updates\.parkedHosts\)/.test(body), 'and the retired list runs through the same validator');
  ck(/refreshHostPolicy\(await getSettings\(DEFAULT_REGION_KEY\)\)/.test(body),
    'the rules apply immediately on save rather than up to a minute later');
  const b = /const SETTINGS_BOOLEAN_FIELDS = \[([^\]]*)\]/.exec(bare)[1];
  ck(b.includes('blockRootDomain') && b.includes('strictRegionHosts'),
    'and both switches are coerced to real booleans server-side');
}

console.log('\n— the admin panel, which edits one country at a time —');
{
  const admin = stripComments(fs.readFileSync(__dirname + '/admin-src/index.html', 'utf8'));
  ck(/REGION_SCOPED_READS\.includes\(path\)/.test(admin) && /REGION_SCOPED_WRITES\.includes\(path\)/.test(admin),
    'the picked country is stamped on in the panel’s own api() helper, not at a dozen call sites');
  // The Rates card saves ONE payload mixing per-country rates with the
  // backend-wide controls. Without this strip the server refuses the whole
  // save and a second country's rates can never be set at all.
  const g = /const ADMIN_GLOBAL_ONLY = \[([^\]]*)\]/.exec(admin);
  ck(!!g, 'the panel knows which settings are backend-wide');
  if (g) {
    const server = /const GLOBAL_ONLY_SETTINGS = \[([^\]]*)\]/.exec(bare)[1];
    const norm = t => t.split(',').map(x => x.trim().replace(/'/g, '')).filter(Boolean).sort().join('|');
    ck(norm(g[1]) === norm(server), 'and its list is exactly the server’s, so nothing is stripped that should save or sent that will be refused');
  }
  ck(/for \(const k of ADMIN_GLOBAL_ONLY\) delete body\.settings\[k\]/.test(admin),
    'a backend-wide field is dropped from a country’s save rather than failing it');
  ck(/function ugx\(n, regionKey\)/.test(admin) && /curOf\(regionKey\)/.test(admin),
    'an amount in an admin list is labelled in the currency of the row’s own country');
  ck(/ADMIN_REGIONS\.length < 2/.test(admin),
    'and the country picker is hidden while there is only one country');
  ck(/data-gen-region/.test(admin) && /'\/admin\/regions\/add-label'/.test(admin),
    'the panel can ask the server for a new short address');
  ck(/id="rgLabels"/.test(admin) && /labels: \$\('rgLabels'\)\.value/.test(admin),
    'short addresses are editable per country');
  ck(/id="sBaseDomain"/.test(admin) && /id="sBlockRoot"/.test(admin) && /id="sStrictHosts"/.test(admin) && /id="sParkedHosts"/.test(admin),
    'and the four host rules have their own card in Settings');
  ck(/baseDomain:\$\('sBaseDomain'\)\.value/.test(admin) && /blockRootDomain:\$\('sBlockRoot'\)\.checked/.test(admin),
    'which really sends them');
}

console.log('\n— the app is told its region, and never tells the server —');
{
  // Checked PER ROUTE. One shared "does the file mention publicRegionView"
  // assertion passed happily with the /public/settings one deleted, because
  // /account still had its own -- and the Sign Up screen would then have
  // shown Uganda's currency on every subdomain.
  const pub = bare.slice(bare.indexOf("app.get('/public/settings'"));
  ck(/region: publicRegionView\(\)/.test(pub.slice(0, pub.indexOf('app.get(', 10))),
    '/public/settings tells a visitor which country the address belongs to');
  const acct = bare.slice(bare.indexOf("app.get('/account'"));
  ck(/region: publicRegionView\(\)/.test(acct.slice(0, acct.indexOf("app.post('"))),
    '/account tells a member their own country');
}
ck(/applyRegion\(s\.region\)/.test(bareClient) && /applyRegion\(r\.region\)/.test(bareClient),
  'and the app applies it from both');
ck(!/X-Region|region:\s*REGION\.key|regionKey:\s*REGION/.test(bareClient),
  'the app never sends a region back up -- it is not the appʼs to choose');
ck(/localStorage\.setItem\('chipzRegion'/.test(bareClient),
  'the last known region is remembered, so a cold start does not flash the wrong currency');
{
  // Every money figure in the app funnels through these three.
  const r = clientApi(KE);
  ck(r.fmtUGX(30000) === 'KES 30,000', 'the appʼs own formatter reads the regionʼs currency');
  const one = clientApi(api.normalizeRegion({ key: 'x', name: 'X', currency: 'KSH', dialCode: '111', localLength: 9, prefixes: ['7'] }, 'x'));
  ck(one.fmtUGX(1000) === 'KSH 1,000', 'including a label that is not three letters long');
}
ck(!/'UGX ' \+|"UGX " \+|>UGX</.test(bareClient), 'no screen still prints a hardcoded UGX');
ck(!/\.slice\(3\)/.test(stripComments(fnSource(client, 'fmtUGXCents'))),
  'and the cents formatter no longer assumes the label is exactly three characters');

console.log(failed ? `\n${failed} FAILED` : '\nregions: all cases pass');
process.exit(failed ? 1 : 0);
