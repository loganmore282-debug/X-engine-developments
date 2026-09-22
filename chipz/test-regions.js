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
    networks: ['MTN Mobile Money', 'Airtel Money'],
  });
  ${(src.match(/const REGION_DEFAULT_NETWORKS = Object\.freeze\(\{[\s\S]*?\}\);/) || [''])[0]}
  ${(src.match(/const LANGUAGE_CODES = \[[^\]]*\];/) || [''])[0]}
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
  ${fnSource(src, 'corsHostAllowed')}
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
  ${fnSource(src, 'regionUsesBareLocal')}
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
           hostIsParked, regionHostnames, isInfraHost, setHostPolicy, regionUsesBareLocal,
           corsHostAllowed, setMainAllowed: h => { _mainAllowedHosts = h; refreshCorsSnapshot(); },
           corsHosts: () => _corsExtraHosts.slice() };
`)(new Function('raw', fnSource(src, 'normalizeAllowedHost').replace(/^function [^{]*/, '') + '')
   // normalizeAllowedHost is a plain function; wrap it so the new Function
   // above can take it as an argument instead of re-declaring it.
   );

// The region as the SERVER publishes it (publicRegionView), which is the
// only form the app ever sees. usesBareLocal is computed server-side on
// purpose -- it depends on the founding region's dialling code.
function pubView(region) {
  return Object.assign({}, region, { usesBareLocal: api.regionUsesBareLocal(region) });
}
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
    ${fnSource(client, 'loginAddressFor')}
    ${fnSource(client, 'phoneToEmail')}
    ${fnSource(client, 'loginAddressCandidates')}
    ${fnSource(client, 'cleanPhone')}
    ${fnSource(client, 'fmtUGX')}
    return { localDigits, phoneToEmail, loginAddressCandidates, cleanPhone, fmtUGX };
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
  const app = clientApi(pubView(region)).phoneToEmail(clientApi(pubView(region)).cleanPhone(local) || local);
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

{
  // ── THE LOCKOUT THAT WAS REPORTED FROM A LIVE SUBDOMAIN ──
  // "that is Ugandan subdomain but you can see it is saying wrong password,
  // yet on root domain, everything was working perfectly, and that password
  // is correct."
  //
  // The shape used to be chosen by `isDefault`, which means "key === 'ug'".
  // So a SECOND region configured with Uganda's +256 -- which is what you
  // get if a short address is attached to the wrong country, or a country is
  // re-created under a new id -- moved every deployed Ugandan account's
  // login address from 769968158@ to 256769968158@, and the password that
  // had always worked started being refused. Keyed on the DIALLING CODE
  // instead, any Uganda-configured region keeps the address that exists.
  const ug2 = api.normalizeRegion({ key: 'ug2', name: 'Uganda (second)', currency: 'UGX',
    dialCode: '256', localLength: 9, prefixes: ['7'] }, 'ug2');
  ck(ug2.isDefault === false, 'a second Uganda is not the founding region');
  api.setCurrent(ug2);
  ck(api.phoneToEmail('0769968158') === '769968158@chipz-platform.com',
    'but its members still sign in with the address every deployed account already has');
  const appSide = clientApi(pubView(ug2));
  ck(appSide.phoneToEmail('0769968158') === '769968158@chipz-platform.com',
    'and the app agrees, because the server tells it which shape to use');
  // The flag has to travel, or the app cannot know: it depends on the
  // FOUNDING region's dialling code, which is not in its own region block.
  ck(pubView(ug2).usesBareLocal === true, 'usesBareLocal is published with the region');
  ck(pubView(KE).usesBareLocal === false, 'and is false for a country on its own dialling code');
  ck(/usesBareLocal: regionUsesBareLocal\(reg\)/.test(bare),
    'computed on the server, never guessed in the app');
  // applyRegion copies a WHITELIST of fields, so a field left out of that
  // list is silently dropped. This one decides the login address, and
  // dropping it sent every member of a country that carries its dialling
  // code to the wrong Firebase account -- caught by test-region-currency.py
  // reading the address off the running app, not by any of the checks above.
  const applied = stripComments(fnSource(client, 'applyRegion'));
  const keys = /for \(const k of \[([^\]]*)\]\)/.exec(applied);
  ck(!!keys && /'usesBareLocal'/.test(keys[1]),
    'and the app actually copies it out of the reply instead of dropping it');
}
{
  // A non-founding country gets ONE login namespace only. Trying the
  // founding bare-local shape as a fallback can resolve the same local digits
  // to a different country's Firebase UID when the password happens to match.
  const ke = clientApi(pubView(KE));
  const cands = ke.loginAddressCandidates('0712345678');
  ck(cands.length === 1, 'a dial-code country has exactly one login namespace');
  ck(cands[0] === '254712345678@chipz-platform.com', 'that namespace is this country’s own canonical shape');
  api.setCurrent(UG);
  const ugAddr = api.phoneToEmail('0712345678');
  ck(!cands.includes(ugAddr), 'it never falls back into the founding country’s bare-local namespace');
  const ugCands = clientApi(pubView(UG)).loginAddressCandidates('0742730382');
  ck(ugCands[0] === '742730382@chipz-platform.com', 'Uganda tries the bare address first');
  ck(ugCands.includes('256742730382@chipz-platform.com'),
    'the founding country may keep its own dial-prefixed migration fallback');
  // doLogin is `window.doLogin = async function(){...}`, not a named
  // declaration, so fnSource cannot find it -- sliced by hand.
  const loginAt = client.indexOf('window.doLogin = async function');
  const rot = stripComments(client.slice(loginAt, client.indexOf('\n};', loginAt)));
  ck(/loginAddressCandidates\(phone\)/.test(rot), 'the login screen really uses them');
  ck(/if \(lastErr\) throw lastErr/.test(rot),
    'and a genuinely wrong password still reports as a wrong password');
  ck(/auth\/too-many-requests|code !== 'auth\/invalid-credential'/.test(rot),
    'a throttle or a network failure stops the retry rather than burning the second attempt');
}
{
  // ── THE CHIP THAT LIED ──
  // "why when you tap the other country domain, still returns the 256 on
  // login and register". Both prefix chips were the literal text "+256" in
  // the markup with nothing ever updating them, so every country's address
  // showed Uganda's code -- and the chip is the only thing on that screen
  // naming the country, so an address pointing at the wrong one looked
  // completely normal until a correct password was refused.
  const shell = fs.readFileSync(__dirname + '/user-src/index.html', 'utf8');
  ck(/id="loginDial"/.test(shell) && /id="regDial"/.test(shell),
    'both dialling-code chips can be addressed');
  ck(!/<span class="prefix">\+256<\/span>/.test(shell),
    'and neither is left as un-updatable static text');
  const paint = stripComments(fnSource(client, 'paintRegionChrome'));
  ck(/loginDial/.test(paint) && /regDial/.test(paint) && /dialPlus\(\)/.test(paint),
    'they are painted from the region, not hardcoded');
  // Owner: "why showing the country and currency, that should not be
  // shown." The chips stay live per country; the name and currency do not
  // go in front of members.
  ck(!/regionName\(\)/.test(paint) && !/' · '/.test(paint),
    'and the country and currency are NOT printed on the sign-in screen');
  ck(/el\.style\.display = 'none'/.test(paint),
    'the slot is left hidden rather than removed, so nothing has to move if it is wanted again');
  ck(new RegExp('paintRegionChrome\\(\\);').test(stripComments(fnSource(client, 'applyRegion'))),
    'repainted whenever the region arrives, which is after that screen is already up');
  // regionCount must be set BEFORE applyRegion or the country line paints
  // with the count still undefined and stays hidden on the very load that
  // needed it.
  const bootBody = stripComments(fnSource(client, 'boot'));
  const cAt = bootBody.indexOf('STATE.regionCount = s.regionCount');
  const aAt = bootBody.indexOf('applyRegion(s.region)');
  ck(cAt !== -1 && aAt !== -1 && cAt < aAt,
    'and the country count is known before the repaint runs');
}
{
  // ── SIGNING UP WAS IMPOSSIBLE ON A MIS-MAPPED ADDRESS ──
  // "make sure referrals are working bro". Registration refused any
  // referral code whose region id differed from the hostname's region --
  // and a referral code is REQUIRED to sign up, so an address pointing at
  // the wrong country shut that country completely: every real member's
  // code was rejected as belonging to somewhere else.
  const reg = bare.slice(bare.indexOf('BAD_REFERRAL_REGION') - 4000, bare.indexOf('BAD_REFERRAL_REGION') + 600);
  ck(/String\(a\.currency \|\| ''\) !== String\(b\.currency \|\| ''\)/.test(reg),
    'a referral code is now judged on CURRENCY, not on the region id');
  ck(!/if \(refRegion !== myRegion\)\s*\n?\s*return \{ code: 400/.test(reg),
    'so two countries sharing a currency no longer reject each other’s codes');
  ck(/BAD_REFERRAL_REGION/.test(reg) && /another currency|uses \$\{/.test(reg),
    'and a genuinely different currency is still refused, because commission is a percentage paid into the referrer’s wallet');
}

console.log('\n— one country at a time, on every admin screen —');
{
  // Owner: "make sure dashboards can be categorized so one toggle to see a
  // country settings ie dashboard, analytics, referrals, transactions,
  // settings, admins, deposits, withdrawals etc."
  ck(/function adminRegionFilter\(req\)/.test(bare), 'the panel can ask for one country');
  const f = stripComments(fnSource(src, 'adminRegionFilter'));
  ck(/req\.query && req\.query\.region/.test(f) && /req\.body && req\.body\.region/.test(f),
    'on a GET and on a POST alike');
  ck(/!raw \|\| raw === 'all'/.test(f),
    'and "all" (or an older panel sending nothing) means every country, so a tab that has not been taught the toggle keeps working');
  const rk = stripComments(fnSource(src, 'rowRegionKey'));
  ck(/userRegions.*\.get\(row\.userId\)/.test(rk),
    'a row written before regions existed is placed by its MEMBER’s country');
  ck(/const own = String\(\(row && row\.regionKey\) \|\| ''\)/.test(rk) && rk.indexOf('own') < rk.indexOf('viaUser'),
    'and a row that carries its own country keeps it -- that is where the money actually moved');
  // Every screen that shows money or members, filtered.
  for (const [route, kind] of [["app.get('/admin/stats'", 'the dashboard'],
                               ["app.post('/admin/analytics'", 'analytics'],
                               ["app.get('/admin/users'", 'members'],
                               ["app.post('/admin/deposits/list'", 'recharges'],
                               ["app.post('/admin/withdrawals/list'", 'cash-outs'],
                               ["app.post('/admin/transactions/list'", 'records'],
                               ["app.get('/admin/referrals/list'", 'referrals']]) {
    const at = bare.indexOf(route);
    const body = bare.slice(at, bare.indexOf('\napp.', at + 10));
    ck(at !== -1 && /adminRegionFilter\(req\)/.test(body), `${kind} can be shown for one country`);
    ck(/regionKey: want \|\| 'all'/.test(body), `  and ${kind} says which country it is showing`);
    // Asking for the country is not filtering by it. Each route has to
    // actually drop the other countries' rows -- checked per route, because
    // they each do it in the shape that suits their own data.
    ck(/scopeRowsToRegion\(|\.filter\(u => !want \|\| u\.regionKey === want\)|want \? all\.filter\(r => r\.regionKey === want\) : all|!want \|\| rowRegionKey/.test(body),
      `  and ${kind} really drops the other countries' rows`);
  }
  // ── A TOTAL IS EITHER COMPLETE OR VISIBLY FLAGGED ──
  // The audit removed the row caps from this endpoint because a silent cap
  // turns a total into "first N rows". Right about that -- but unbounded is
  // the wrong other end: M0 is a shared tier, this pulls four whole
  // collections into memory, and the dashboard re-polls every 30 seconds, so
  // "no limit" trades a wrong number for the owner's only admin view timing
  // out. A high ceiling plus an honest flag is the bargain the rest of this
  // file already strikes.
  const statsAt = bare.indexOf("app.get('/admin/stats'");
  const statsBody = bare.slice(statsAt, bare.indexOf('\napp.', statsAt + 10));
  ck(/const STATS_SCAN_LIMIT = \d+;/.test(statsBody),
    'the dashboard scan has a ceiling, so it cannot pull an unbounded collection into memory');
  ck((statsBody.match(/\.limit\(STATS_SCAN_LIMIT\)/g) || []).length === 6,
    'every one of its six reads is capped, not just the first four');
  ck(/const truncated = \[usersSnap, depSnap, witSnap, invSnap, pendDepSnap, pendWitSnap\]/.test(statsBody) &&
     /snap\.docs\.length >= STATS_SCAN_LIMIT/.test(statsBody),
    'and it says so when the ceiling is reached, judged on the raw reads before the country filter');
  ck(/regionKey: want \|\| 'all', truncated,/.test(statsBody),
    'with the flag on the reply');
  {
    const admin2 = fs.readFileSync(__dirname + '/admin-src/index.html', 'utf8');
    ck(/s\.truncated \?/.test(admin2) && /These totals are incomplete/.test(admin2),
      'and the panel shows it, because a capped total that looks authoritative is the same fault one layer up');
  }
  // The totals have to be filtered BEFORE they are added up, or the numbers
  // on screen would describe every country while the rows beneath them
  // describe one.
  const dep = bare.slice(bare.indexOf("app.post('/admin/deposits/list'"));
  const depBody = dep.slice(0, dep.indexOf('\napp.', 10));
  // indexOf returns -1 when a thing is ABSENT, and -1 is less than every
  // real index -- so a bare "a comes before b" check passes when a was
  // deleted outright. Both have to be found first.
  const before = (text, a, b) => {
    const i = text.indexOf(a), j = text.indexOf(b);
    return i !== -1 && j !== -1 && i < j;
  };
  ck(before(depBody, 'scopeRowsToRegion', 'groupProcessedByDay'),
    'the recharge day-totals are built from the filtered rows, not all of them');
  ck(before(depBody, 'scopeRowsToRegion', 'counts[r.status'),
    'and so are the status counts');
  const wit = bare.slice(bare.indexOf("app.post('/admin/withdrawals/list'"));
  const witBody = wit.slice(0, wit.indexOf('\napp.', 10));
  ck(before(witBody, 'scopeRowsToRegion', 'groupProcessedByDay'),
    'the cash-out day-totals likewise');
  // Truncation is a fact about the page that was read, not about one
  // country's share of it.
  const tx = bare.slice(bare.indexOf("app.post('/admin/transactions/list'"));
  const txBody = tx.slice(0, tx.indexOf('\napp.', 10));
  ck(/const truncated = raw\.length >= TX_ADMIN_LIST_LIMIT;/.test(txBody) &&
     txBody.indexOf('const truncated') < txBody.indexOf('scopeRowsToRegion'),
    'and "there is more than this" is judged before the filter, so it cannot claim a partial list is complete');
}
{
  const admin = fs.readFileSync(__dirname + '/admin-src/index.html', 'utf8');
  const readsM = /const REGION_FILTERED_READS = \[([^\]]*)\]/.exec(admin);
  const writesM = /const REGION_FILTERED_WRITES = \[([^\]]*)\]/.exec(admin);
  ck(!!readsM && !!writesM, 'the panel knows which screens take a country');
  // ALWAYS stamped, Uganda included. For a LIST, "no region" means every
  // country -- so not stamping it while Uganda is picked would show a mixed
  // list under a label saying Uganda.
  ck(/if \(REGION_FILTERED_READS\.includes\(path\)\) path \+= '\?region=' \+ encodeURIComponent\(ADMIN_REGION \|\| 'all'\)/.test(admin),
    'and stamps it on every time, not only when the country is not Uganda');
  ck(/REGION_FILTERED_WRITES\.includes\(path\)\) body = Object\.assign\(\{ region: ADMIN_REGION \|\| 'all' \}/.test(admin),
    'on the POST-shaped ones too');
  ck(/ADMIN_REGION !== 'all' && !ADMIN_REGIONS\.some/.test(admin),
    '"All countries" survives a region reload instead of snapping back to Uganda');
  ck(/REGION_SINGLE_TABS = \['settings', 'products'\]/.test(admin),
    'Settings and Products stay one country at a time');
  ck(/const one = \(!ADMIN_REGION \|\| ADMIN_REGION === 'all'\) \? 'ug' : ADMIN_REGION;/.test(admin),
    'so picking "All countries" and opening them shows the founding country rather than editing it under the wrong label');
  ck(/function adminOneRegion\(\)\{ return \(!ADMIN_REGION \|\| ADMIN_REGION === 'all'\) \? 'ug' : ADMIN_REGION; \}/.test(admin),
    'and the panel resolves that same country itself, so what it shows matches what it asks for');
  // Both tabs that got their OWN per-country data this round have to ask for
  // the country they are labelled with, or the label is a lie.
  for (const route of ['/admin/promocodes/list', '/admin/messages/list'])
    ck(readsM[1].includes(`'${route}'`), `${route} is read per country`);
  for (const route of ['/admin/promocodes/generate', '/admin/messages/save'])
    ck(writesM[1].includes(`'${route}'`), `${route} is written with the picked country`);

  // ── THE SWITCH ITSELF, RUN RATHER THAN GREPPED ──
  // The old assertions here matched the text of paintRegionPicker() and its
  // two call sites. They passed on a picker that painted an empty <select>,
  // and they went red the moment the same feature moved to the topbar --
  // which is the wrong way round for a test: it defended an implementation,
  // not a behaviour. This runs the real function over a stub DOM instead.
  function switchFor(regions, region, tab) {
    const hidden = {};
    // Each method has to close over the NODE, not over the factory -- the
    // first version of this stub wrote _onChange onto the factory function
    // itself and reported a perfectly wired switch as unwired.
    const el = (id) => {
      const node = { id, innerHTML: '', textContent: '', value: region };
      node.classList = {
        toggle: (c, on) => { if (c === 'hidden') hidden[id] = !!on; },
        add: (c) => { if (c === 'hidden') hidden[id] = true; },
        remove: (c) => { if (c === 'hidden') hidden[id] = false; },
      };
      node.addEventListener = (ev, fn) => { if (ev === 'change') node._onChange = fn; };
      return node;
    };
    const nodes = { regionSwitch: el('regionSwitch'), regionNote: el('regionNote') };
    // What the handler DID, rather than what its source says -- the two
    // mutations that removed the remembering and the repaint both survived a
    // text match, because other copies of those calls exist elsewhere in the
    // panel.
    const saved = [], repainted = [];
    new Function('$', 'esc', 'ADMIN_REGIONS', 'ADMIN_REGION', '_tab',
      'REGION_SINGLE_TABS', 'REGION_AWARE_TABS', 'regionByKeyAdmin', 'localStorage', 'switchTab', `
      ${fnSource(admin, 'paintRegionSwitch')}
      paintRegionSwitch();
    `)(
      (id) => nodes[id] || null,
      x => String(x == null ? '' : x),
      regions, region, tab,
      ['settings', 'products'],
      ['dashboard', 'analytics', 'users', 'deposits', 'withdrawals', 'transactions', 'referrals', 'settings', 'products', 'promocodes', 'messages'],
      (k) => regions.find(r => r.key === (k || region)) || regions[0],
      { setItem(k, v) { saved.push([k, v]); }, getItem() { return null; } },
      (t) => repainted.push(t)
    );
    // Somebody picking a different country in the switch.
    const pick = (key) => {
      const sel = nodes.regionSwitch;
      sel.value = key;
      if (sel._onChange) sel._onChange();
      return { saved, repainted };
    };
    return { html: nodes.regionSwitch.innerHTML, note: nodes.regionNote.textContent,
             switchHidden: !!hidden.regionSwitch, noteHidden: !!hidden.regionNote,
             wired: !!nodes.regionSwitch._onChange, pick };
  }
  const two = [{ key: 'ug', name: 'Uganda', currency: 'UGX' }, { key: 'ke', name: 'Kenya', currency: 'KES' }];
  const one = [{ key: 'ug', name: 'Uganda', currency: 'UGX' }];

  const onKenya = switchFor(two, 'ke', 'deposits');
  ck(!onKenya.switchHidden, 'the country switch is on screen once there is more than one country');
  ck(/value="ug"/.test(onKenya.html) && /value="ke"/.test(onKenya.html) && /value="all"/.test(onKenya.html),
    'and offers every country plus All countries');
  ck(/value="ke"[^>]*selected/.test(onKenya.html), 'with the picked country selected');

  // The SAME option list on a one-country screen. A switch whose choices
  // change as you move between tabs is not one switch, which is what the
  // per-tab picker did (it dropped "All countries" on Settings).
  const onSettings = switchFor(two, 'ke', 'settings');
  ck(/value="all"/.test(onSettings.html),
    'the options do not change from tab to tab -- All countries is still offered on Settings');

  ck(switchFor(one, 'ug', 'deposits').switchHidden,
    'and the switch is hidden entirely while there is only one country');
  ck(switchFor(one, 'ug', 'deposits').noteHidden,
    'along with its note');

  const allLists = switchFor(two, 'all', 'transactions');
  ck(!allLists.noteHidden && /mix currencies/.test(allLists.note),
    'an "All countries" list says its figures are in more than one currency');
  const allSettings = switchFor(two, 'all', 'settings');
  ck(/Uganda/.test(allSettings.note) && /one country at a time/.test(allSettings.note),
    'and an "All countries" Settings screen says which country it is actually editing');
  ck(switchFor(two, 'ke', 'admins').note === 'This screen is the same for every country.',
    'a screen no country owns says so rather than implying the switch changed it');
  ck(switchFor(two, 'ke', 'deposits').noteHidden,
    'and an ordinary one-country list needs no note at all');

  // Picking a country: remembered on the device, and the open tab repainted
  // against it. Both are RUN -- the panel has other localStorage writes and
  // other switchTab calls, so a text match here passed with the ones inside
  // this handler deleted.
  const picked = switchFor(two, 'ug', 'deposits');
  ck(picked.wired, 'the switch listens for a change at all');
  const after = picked.pick('ke');
  ck(after.saved.some(([k, v]) => k === 'chipz_admin_region' && v === 'ke'),
    'picking a country writes it down, so a reload does not silently snap back to another country\'s figures');
  ck(after.repainted.length === 1 && after.repainted[0] === 'deposits',
    'and repaints the tab that is open, which is the whole of "it changes all contents"');
  ck(/localStorage\.getItem\('chipz_admin_region'\)/.test(admin),
    'and it is read back on the next load');
  ck(/paintRegionSwitch\(\);\n  Promise\.resolve\(fn\(\)\)/.test(admin),
    'the note is repainted on every tab change');
  ck(/switchTab\(_tab\);/.test(admin), 'and changing the country repaints whatever tab is open');
}
{
  // "those subdomain are not working well why" -- answerable in one tap
  // instead of by guessing.
  const at = bare.indexOf("app.post('/admin/regions/check-host'");
  const body = bare.slice(at, bare.indexOf('\napp.', at + 10));
  ck(at !== -1, 'an address can be checked from the panel');
  ck(/claimedBy/.test(body) && /regionForHost\(host\)/.test(body),
    'it says which country actually serves it');
  ck(/loginExample: phoneToEmail/.test(body),
    'and which login address a member there would use -- the thing that was silently wrong');
  ck(/not under the base domain/.test(body),
    'naming the usual cause outright: the address is not under the configured base domain');
  ck(/const reachable = corsHostAllowed\(host\) \|\| isInfraHost\(host\)/.test(body) && /reachable,/.test(body),
    'and whether it is even allowed to reach the backend -- the thing that made every subdomain load nothing');
  ck(/NOT allowed to reach the backend/.test(body),
    'said in words, with what to do about it');
  const admin = fs.readFileSync(__dirname + '/admin-src/index.html', 'utf8');
  // RUN, not described. An early `return ''` bolted into the function
  // leaves every "does this function exist" check passing while the warning
  // never appears -- which is the whole failure being guarded against.
  function warnFor(ownHost, baseDomain, regions) {
    return new Function('deps', `
      const esc = deps.esc, location = deps.location;
      let ADMIN_BASE_DOMAIN = deps.baseDomain;
      let ADMIN_REGIONS = deps.regions;
      const REGION_SINGLE_TABS = ['settings', 'products'];
      ${(admin.match(/const BASE_DOMAIN_PLACEHOLDER = '[^']*';/) || [''])[0]}
      ${fnSource(admin, 'adminOwnDomain')}
      ${fnSource(admin, 'baseDomainWarningHtml')}
      return baseDomainWarningHtml();
    `)({
      esc: x => String(x == null ? '' : x),
      location: { hostname: ownHost },
      baseDomain, regions,
    });
  }
  const withLabel = [{ key: 'ug', name: 'Uganda', currency: 'UGX', labels: ['g26e'] }];
  // NOTE ON THE FIXTURE: these cases now configure a base domain of
  // 'ownersite.example', NOT 'chipz-platform.com'. That string is the value
  // server.js ships as its DEFAULT, and as of the www round it raises a
  // warning of its own -- so using it as the "correctly configured" fixture
  // would have meant asserting that a never-configured platform looks fine.
  const mismatch = warnFor('panel.example.com', 'ownersite.example', withLabel);
  ck(/ownersite\.example/.test(mismatch) && /panel\.example\.com|example\.com/.test(mismatch),
    'the panel warns on its own when the base domain is not the domain it is being used on, naming both');
  ck(/useThisDomainBtn/.test(mismatch), 'and offers a one-tap fix');
  ck(/function useThisDomainAsBase/.test(admin) && /baseDomain: own/.test(admin),
    'which really saves it');
  ck(warnFor('app.ownersite.example', 'ownersite.example', withLabel) === '',
    'and says nothing when the base domain IS the domain in use');
  // A panel hosted on Render or EdgeOne says nothing about where the
  // MEMBERS' site lives, so its own hostname must not trigger the MISMATCH
  // warning. (The placeholder warning below is a different thing and does
  // fire there, deliberately.)
  for (const h of ['chipz-admin.onrender.com', 'chipz.edgeone.app', 'localhost', '127.0.0.1'])
    ck(warnFor(h, 'ownersite.example', withLabel) === '', `  nor when the panel itself is on ${h}`);
  ck(/No base domain is set/.test(warnFor('panel.example.com', '', withLabel)),
    'and an unset base domain is called out on its own terms');

  // ── the base domain never got filled in at all ──
  //
  // THE ASSERTION DIRECTLY ABOVE USED TO COVER THIS CASE AND GOT IT WRONG.
  // It required silence on a Render-hosted panel with the base domain still
  // reading 'chipz-platform.com' -- which is the factory placeholder, so that
  // was the exact state of a platform whose owner had never touched the
  // setting, and the panel was asserted to say nothing about it. Two live
  // symptoms had no warning attached to either: short addresses matched no
  // country, and the root domain and www were not closed, because
  // blockRootDomain can only recognise them once this setting names the real
  // domain. Rewritten rather than dropped, with the history here, because an
  // assertion that pins the current shape defends a bug as loyally as a
  // feature.
  const placeholder = warnFor('chipz-admin.onrender.com', 'chipz-platform.com', withLabel);
  ck(placeholder !== '',
    'the placeholder base domain is called out even on a Render-hosted panel, where the panel\'s own hostname says nothing about the members\' domain');
  ck(/www/.test(placeholder),
    'and it says www is among what stays open, which is the symptom that does not otherwise announce itself');
  ck(/short name/i.test(placeholder) || /Short addresses/.test(placeholder),
    'and that short addresses match no country, which is the other one');
  ck(!/useThisDomainBtn/.test(placeholder),
    'with NO one-tap fix offered there -- the panel is on onrender.com, and filling that in as the members\' domain would be a guess, and a wrong one');
  const placeholderOnOwn = warnFor('panel.ownersite.example', 'chipz-platform.com', withLabel);
  ck(/useThisDomainBtn/.test(placeholderOnOwn),
    'but the one-tap fix IS offered when the panel is on a domain worth suggesting');
  ck(warnFor('chipz-admin.onrender.com', 'ownersite.example', []) === '',
    'and a platform that HAS set its base domain is left alone');
}

// ── GIFT CODES AND INBOX MESSAGES BELONG TO A COUNTRY ──
// Owner: "all country changes everything but images are same only edittable
// variables like prices, words like that." A gift code is a bare number that
// pays in the claimer's currency, and an inbox message is words that name
// one, so both had to become per-country when the switch went global.
console.log('\n— a gift code is money, so it belongs to one country —');
{
  const run = (names, body) => new Function(...names, body);
  const giftFns = run([], `
    ${fnSource(src, 'giftCodeRegion')}
    ${fnSource(src, 'giftCodeInRegion')}
    return { giftCodeRegion, giftCodeInRegion };
  `)();
  const { giftCodeRegion, giftCodeInRegion } = giftFns;
  ck(giftCodeRegion({ regionKey: 'KE' }) === 'ke', 'a code names its country, however it was cased');
  ck(giftCodeRegion({}) === 'all' && giftCodeRegion({ regionKey: '' }) === 'all',
    'and a code cut before this existed counts as every country');
  ck(giftCodeInRegion({ regionKey: 'ke' }, 'ke'), 'a Kenyan code is claimable in Kenya');
  ck(!giftCodeInRegion({ regionKey: 'ke' }, 'ug'),
    'and NOT in Uganda -- 5,000 KES and 5,000 UGX are not the same money');
  ck(!giftCodeInRegion({ regionKey: 'ug' }, 'ke'), 'nor the other way round');
  ck(giftCodeInRegion({ regionKey: 'all' }, 'ke') && giftCodeInRegion({}, 'ke'),
    'an all-countries code, and a legacy one, stay claimable anywhere');
  ck(giftCodeInRegion({ regionKey: 'ke' }, null) && giftCodeInRegion({ regionKey: 'ke' }, 'all'),
    'and the admin\'s All-countries view lists every country\'s codes');

  // The refusal has to come BEFORE the money moves, and it has to be a
  // refusal -- not a silent pass to a different branch.
  const rd = bare.slice(bare.indexOf("app.post('/redeem'"));
  const rdBody = rd.slice(0, rd.indexOf('\napp.', 10));
  const before = (text, a, b) => {
    const i = text.indexOf(a), j = text.indexOf(b);
    return i !== -1 && j !== -1 && i < j;
  };
  ck(/giftCodeInRegion\(cd, currentRegionKey\(\)\)/.test(rdBody),
    'redeeming checks the code against the MEMBER\'s own country, not the hostname\'s');
  ck(before(rdBody, 'giftCodeInRegion', 'FieldValue.increment'),
    'and it is checked before a single shilling is credited');
  ck(/different country/.test(rdBody),
    'with its own wording, like the expired and inactive refusals');

  // Generated with the picked country stamped on, and the panel says which.
  const gen = bare.slice(bare.indexOf("app.post('/admin/promocodes/generate'"));
  const genBody = gen.slice(0, gen.indexOf('\napp.', 10));
  ck(/const regionKey = adminRegionFilter\(req\) \|\| 'all';/.test(genBody) && /\bregionKey,/.test(genBody),
    'a new code is stamped with the country that was picked when it was generated');
  const lst = bare.slice(bare.indexOf("app.get('/admin/promocodes/list'"));
  const lstBody = lst.slice(0, lst.indexOf('\napp.', 10));
  ck(/giftCodeInRegion\(d\.data\(\), want\)/.test(lstBody), 'and the list is per country');
  ck(/regionKey: giftCodeRegion\(c\)/.test(lstBody),
    'each row saying which, so a reward figure is never labelled in the wrong currency');
  const panel = fs.readFileSync(__dirname + '/admin-src/index.html', 'utf8');
  ck(/ugx\(c\.minReward, cCur\)/.test(panel) && /const cCur = c\.regionKey/.test(panel),
    'which is what the panel labels it with');
}

// Runs at the end with the other async checks -- see the verdict chain at
// the bottom of this file (this is a CommonJS module, so no top-level await).
async function messageRegionChecks(){
  console.log('\n— an inbox message can be for one country or for all of them —');
  const listSrc = `
    ${fnSource(src, 'messageInRegion')}
    ${fnSource(src, 'listBroadcastMessages')}
    return listBroadcastMessages;
  `;
  const mk = (docs) => {
    const calls = [];
    const db = { collection: () => ({ orderBy: () => ({ limit: () => ({ get: async () => ({
      docs: docs.map(d => ({ id: d.id, data: () => d })),
    }) }) }) }) };
    const list = new Function('db', 'defaultWelcomeMessage', 'getSettings', `
      ${listSrc}
    `)(db,
      (s) => ({ id: 'welcome', title: 'Welcome to ' + s.brandName, body: 'hello' }),
      async (r) => { calls.push(r); return { brandName: r === 'ke' ? 'ChipzKE' : 'Chipz' }; });
    return { list, calls };
  };
  const docs = [
    { id: 'm1', title: 'For Kenya', body: 'x', regionKey: 'ke' },
    { id: 'm2', title: 'For Uganda', body: 'x', regionKey: 'ug' },
    { id: 'm3', title: 'For everybody', body: 'x', regionKey: 'all' },
    { id: 'm4', title: 'Legacy, no country', body: 'x' },
  ];
  const ids = async (want) => (await mk(docs).list(want)).map(m => m.id).sort().join(',');
  ck(await ids('ke') === 'm1,m3,m4,welcome',
    'a Kenyan member sees Kenya\'s messages, the all-countries ones and the legacy ones');
  ck(await ids('ug') === 'm2,m3,m4,welcome', 'and a Ugandan sees Uganda\'s, not Kenya\'s');
  ck(await ids(null) === 'm1,m2,m3,m4,welcome',
    'while the admin\'s All-countries view sees every one of them');

  // The built-in welcome row is per country too: a real 'welcome' doc
  // written for ONE country must not silently delete the built-in row from
  // the others, and a DELETED one (tombstone, no regionKey) must stay gone
  // everywhere.
  const kenyaWelcome = [{ id: 'welcome', title: 'Karibu', body: 'x', regionKey: 'ke' }];
  ck((await mk(kenyaWelcome).list('ke')).filter(m => m.id === 'welcome').length === 1 &&
     (await mk(kenyaWelcome).list('ke'))[0].title === 'Karibu',
    'a welcome written for Kenya is what Kenya gets');
  const ugRows = await mk(kenyaWelcome).list('ug');
  ck(ugRows.length === 1 && /Welcome to/.test(ugRows[0].title),
    'and Uganda still gets the built-in one rather than nothing');
  const tomb = [{ id: 'welcome', deleted: true }];
  ck((await mk(tomb).list('ke')).length === 0 && (await mk(tomb).list('ug')).length === 0,
    'a deleted welcome stays deleted in every country');

  // The built-in row reads SETTINGS, and settings are per country -- so the
  // admin previewing Kenya must be shown Kenya's wording, not the panel
  // hostname's.
  const probe = mk(docs);
  await probe.list('ke', 'ke');
  ck(probe.calls.includes('ke'), 'the built-in welcome is built from the asked-for country\'s settings');

  const ms = bare.slice(bare.indexOf("app.post('/admin/messages/save'"));
  const msBody = ms.slice(0, ms.indexOf('\napp.', 10));
  ck(/const want = adminRegionFilter\(req\);/.test(msBody) && /regionKey,/.test(msBody),
    'a saved message carries the country it was written for');
  // The footgun: with All countries picked the panel is showing messages
  // from several countries at once, so an edit made from that view must not
  // re-stamp the one being edited.
  ck(/if \(explicitId\)/.test(msBody) && /prev\.data\(\)\.regionKey/.test(msBody),
    'and editing one from the All-countries view leaves its country alone instead of broadcasting it everywhere');
  const ml = bare.slice(bare.indexOf("app.get('/admin/messages/list'"));
  const mlBody = ml.slice(0, ml.indexOf('\napp.', 10));
  ck(/adminRegionFilter\(req\)/.test(mlBody) && /listBroadcastMessages\(want, want \|\| undefined\)/.test(mlBody),
    'the admin list shows the picked country\'s messages, in that country\'s own wording');
  const mg = bare.slice(bare.indexOf("app.get('/messages'"));
  ck(/listBroadcastMessages\(currentRegionKey\(\)\)/.test(mg.slice(0, mg.indexOf('\napp.', 10))),
    'and a member is served their own country\'s inbox');
}

console.log('\n— the format hint, and picking a payer out of an SMS —');
api.setCurrent(UG);
ck(api.phoneFormatHint().local === '07XXXXXXXX' && api.phoneFormatHint().intl === '+2567XXXXXXXX',
  'Uganda is told to type 07XXXXXXXX or +2567XXXXXXXX');
ck(/Uganda/.test(api.badPhoneMessage()), 'and a rejection names Uganda');
api.setCurrent(KE);
ck(api.phoneFormatHint().intl === '+2547XXXXXXXX', 'Kenya is told its own shape');
ck(/Kenya/.test(api.badPhoneMessage()), 'and a rejection names Kenya');

// Round 183: real live bug, confirmed from an actual admin panel screenshot
// (the "Edit Benin" preview) and a real member's "Payment not completed"
// screen. Benin's own post-2021 numbering plan makes '01' the first two
// digits of the SIGNIFICANT number -- not a separate trunk-access '0' the
// way Uganda's leading '0' is -- so its admin-entered prefix is '01' and its
// Local number length is 10 (01 + 8 digits). phoneFormatHint() unconditionally
// prepended a SECOND '0' on top of that, showing "001XXXXXXXX" (11 digits)
// as the format to type -- one digit too long for the region's own declared
// length, and wrong regardless of what a member actually typed.
const BJ = api.normalizeRegion({
  key: 'bj', name: 'Benin', currency: 'XOF', dialCode: '229', localLength: 10,
  prefixes: ['01'], utcOffsetMin: 60, active: true,
}, 'bj');
api.setCurrent(BJ);
ck(api.phoneFormatHint().local === '01XXXXXXXX',
   'Benin (prefix already starting with 0) is told to type 01XXXXXXXX, not 001XXXXXXXX');
ck(api.phoneFormatHint().local.length === BJ.localLength,
   'the shown local format is exactly the region\'s own declared length (10), not one digit longer');
ck(api.phoneFormatHint().intl === '+22901XXXXXXXX', 'and the international format is unaffected');
ck(/Benin/.test(api.badPhoneMessage()) && !/001X/.test(api.badPhoneMessage()),
   'the rejection sentence names Benin and never shows the doubled leading 0');
// Uganda-shaped countries (a prefix that does NOT itself start with '0')
// must be completely unaffected by this fix -- re-checked here, right next
// to the Benin case, so a future change cannot fix one and break the other.
api.setCurrent(UG);
ck(api.phoneFormatHint().local === '07XXXXXXXX', 'Uganda (prefix not starting with 0) is unaffected by the Benin fix');

console.log('\n— the admin panel\'s own live preview agrees with the server, byte for byte —');
{
  // paintPhoneShape() in admin-src/index.html is a hand-kept SECOND COPY of
  // phoneFormatHint()/badPhoneMessage() -- its own comment says so ("Mirrors
  // the server's own phoneFormatHint()/badPhoneMessage() exactly"). The
  // doubled-leading-0 bug lived in BOTH copies at once, because nothing ever
  // ran the admin one and compared its OUTPUT against the server's -- run it
  // for real here, against the exact fields the owner's own screenshot
  // showed for Benin, rather than trusting the comment's claim.
  const adminSrc = fs.readFileSync(__dirname + '/admin-src/index.html', 'utf8');
  const escSrc = (adminSrc.match(/function esc\(s\)\{[^\n]*\}/) || [''])[0];
  if (!escSrc) throw new Error('could not find esc() in admin-src/index.html');
  const start = adminSrc.indexOf('const paintPhoneShape = () => {');
  if (start === -1) throw new Error('could not find paintPhoneShape() in admin-src/index.html');
  let depth = 0, end = -1;
  for (let k = adminSrc.indexOf('{', start); k < adminSrc.length; k++) {
    if (adminSrc[k] === '{') depth++;
    else if (adminSrc[k] === '}') { depth--; if (depth === 0) { end = k + 1; break; } }
  }
  if (end === -1) throw new Error('unbalanced braces in paintPhoneShape()');
  const paintSrc = adminSrc.slice(start, end);

  const fields = { rgDial: '229', rgLen: '10', rgPfx: '01', rgName: 'Benin' };
  const box = { innerHTML: '' };
  const $ = (id) => (id === 'rgPhoneShape' ? box : { value: fields[id] || '' });
  const esc = new Function(escSrc + '; return esc;')();
  new Function('$', 'esc', paintSrc + '\npaintPhoneShape();')($, esc);

  ck(box.innerHTML.includes('01XXXXXXXX'),
     'the admin panel really renders 01XXXXXXXX for Benin -- not just the server function');
  ck(!box.innerHTML.includes('001XXXXXXXX'),
     'and the admin preview never shows the doubled-leading-0 form either');
  api.setCurrent(BJ);
  ck(box.innerHTML.includes(api.badPhoneMessage()),
     'and the refusal sentence shown in the admin panel is EXACTLY what a Benin member actually reads');
}
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
  // Only what is STRUCTURALLY incapable of varying by country -- which
  // hostnames may reach the backend, and the two single-copy static assets
  // (manifest name, the og:/twitter: share tags).
  for (const k of ['allowedOrigins', 'baseDomain', 'blockRootDomain', 'parkedHosts', 'strictRegionHosts', 'brandName', 'linkPreviewEnabled'])
    ck(g.includes(k), `${k} stays backend-wide`);
  // maintenanceMode/maintenanceMsg/openingCountdownEnabled/openingCountdownAt
  // moved OUT of GLOBAL_ONLY_SETTINGS in Round 179b (owner: "some settings
  // affect whole countries why?, see maintenance mode, countdown, please
  // make sure that everything is on its own") -- putting one country into
  // maintenance, or scheduling its opening countdown, was silently taking
  // every OTHER country down with it. They are ordinary per-region settings
  // now, same as every rate and limit.
  for (const k of ['minWithdraw', 'commL1', 'returnMultiple', 'withdrawWindowEnabled',
                    'maintenanceMode', 'maintenanceMsg', 'openingCountdownEnabled', 'openingCountdownAt'])
    ck(!g.includes(k), `${k} is per-country`);
}
// Defined here, RUN at the bottom (in the same after-everything-else spot
// rotationChecks/messageRegionChecks already run from) -- see there for why.
async function maintenanceModeChecks(){
  console.log('\n— maintenance mode and the opening countdown are RUN per country, not asserted —');
  // A static array check proves the field survives the strip; it does not
  // prove getSettings() ever reads that array for the strip rather than a
  // second, hand-copied list. Lift the real function and run it.
  ck(/for \(const k of GLOBAL_ONLY_SETTINGS\) delete overlay\[k\]/.test(bare),
    'getSettings() strips a region overlay using GLOBAL_ONLY_SETTINGS itself, not a second copy of it');
  const globalOnlyLine = /const GLOBAL_ONLY_SETTINGS = \[[^\]]*\];/.exec(bare)[0];
  const block = globalOnlyLine + '\n' + fnSource(bare, 'settingsDocId') + '\n' +
    bare.slice(bare.indexOf('const _settingsByRegion = new Map'), bare.indexOf('async function getSettings') + bare.slice(bare.indexOf('async function getSettings')).indexOf('\n}') + 2);
  for (const name of ['getSettings', 'GLOBAL_ONLY_SETTINGS', 'function settingsDocId'])
    if (!block.includes(name)) throw new Error(`getSettings block is missing ${name} -- re-anchor`);
  const docs = {
    main: { maintenanceMode: true, maintenanceMsg: 'Uganda is closed', openingCountdownEnabled: false, minWithdraw: 8000 },
    // Kenya sets its OWN maintenanceMsg too, deliberately, so this proves
    // message ISOLATION rather than the (correct, separate) inherit-when-
    // unset layering every other setting already has.
    'region-ke': { maintenanceMode: false, maintenanceMsg: 'Kenya says something else', minWithdraw: 500 },
  };
  const api = new Function('db', 'DEFAULT_SETTINGS', 'DEFAULT_REGION_KEY', 'sanitizeAllowedOrigins', 'refreshHostPolicy', 'currentRegionKey', `
    ${block}
    return { getSettings };
  `)(
    { collection: () => ({ doc: id => ({ get: async () => ({ exists: id in docs, data: () => docs[id] }) }) }) },
    { withdrawFeePct: 15, minWithdraw: 8000, minDeposit: 30000, maintenanceMode: false, maintenanceMsg: '', openingCountdownEnabled: false, openingCountdownAt: 0 },
    'ug', () => ({ hosts: [] }), () => {}, () => 'ug'
  );
  const ug = await api.getSettings('ug');
  const ke = await api.getSettings('ke');
  ck(ug.maintenanceMode === true, "Uganda's own maintenance switch is on");
  ck(ke.maintenanceMode === false, "Kenya is NOT put into maintenance by Uganda's switch -- this is the reported bug");
  ck(ug.maintenanceMsg === 'Uganda is closed', "and Uganda's own message is Uganda's");
  ck(ke.maintenanceMsg === 'Kenya says something else', "Kenya's own message is Kenya's, not Uganda's");
  ck(ke.minWithdraw === 500, 'an ordinary per-region rate still overrides correctly (this fix did not touch that path)');
  ck(ug.minWithdraw === 8000, "and Uganda's own is unaffected by Kenya's document existing at all");
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
    ck(/return\s+(?:await\s+)?withUserRegion\(/.test(fnSource(bare, fn)),
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
  // ── THE BUG THAT MADE EVERY SUBDOMAIN LOAD NOTHING ──
  // Owner: "other country domains are not working, no fetching images".
  //
  // The check was an EXACT hostname match. The owner types the domain he
  // REGISTERED into the allowlist; the short addresses are GENERATED and
  // never typed anywhere -- so the root domain worked and every subdomain
  // of it was refused. A refused origin means the browser throws the reply
  // away before any code sees it, so the app reports a plain network error
  // and shows nothing: no prices, and no photos, because every photo
  // travels as a data: URL inside that JSON.
  api.setMainAllowed(['ownersite.example']);
  ck(api.corsHostAllowed('ownersite.example'),
    'the domain the owner listed reaches the backend');
  ck(api.corsHostAllowed('g26e.ownersite.example'),
    'and so does a generated short address under it, which he never typed anywhere');
  ck(api.corsHostAllowed('b5dh.ownersite.example') && api.corsHostAllowed('deep.nested.ownersite.example'),
    'any label under it, however many levels deep');
  // The reason an exact match was used in the first place. A suffix match on
  // '.' + domain cannot be spoofed from outside: the attacker's host ends
  // with THEIR domain, not the owner's.
  ck(!api.corsHostAllowed('ownersite.example.evil.test'),
    'but a lookalike that merely CONTAINS the domain is still refused');
  ck(!api.corsHostAllowed('notownersite.example'),
    'and neither is a domain that merely ends with the same letters');
  ck(!api.corsHostAllowed('ownersite.example.co'), 'nor a different TLD');
  // The middleware has to actually USE it. Every check above calls the
  // function directly, so a CORS block that quietly went back to exact
  // matching would pass all of them.
  // The middleware's own decision, RUN. Every check above calls
  // corsHostAllowed directly, so a CORS block that quietly went back to its
  // own exact-match list would pass all of them.
  const corsAt = bare.indexOf('origin: (origin, cb) => {');
  let depth = 0, corsEnd = -1;
  for (let k = bare.indexOf('{', corsAt); k < bare.length; k++) {
    if (bare[k] === '{') depth++;
    else if (bare[k] === '}') { depth--; if (depth === 0) { corsEnd = k + 1; break; } }
  }
  const decide = new Function('deps', `
    const corsHostAllowed = deps.corsHostAllowed;
    const CORS_ALLOWED_ORIGINS = deps.CORS_ALLOWED_ORIGINS;
    const CORS_ALLOWED_SUFFIXES = deps.CORS_ALLOWED_SUFFIXES;
    const cb = (_e, ok) => { deps.out.ok = ok; };
    const fn = ${bare.slice(corsAt + 'origin: '.length, corsEnd)};
    return origin => { deps.out.ok = null; fn(origin, cb); return deps.out.ok; };
  `)({
    corsHostAllowed: api.corsHostAllowed,
    CORS_ALLOWED_ORIGINS: new Set(['https://chipz-platform.com']),
    CORS_ALLOWED_SUFFIXES: ['.onrender.com', '.edgeone.app'],
    out: {},
  });
  api.setMainAllowed(['ownersite.example']);
  ck(decide('https://g26e.ownersite.example') === true,
    'the CORS middleware itself admits a generated short address');
  ck(decide('https://ownersite.example') === true, 'and the domain it hangs off');
  ck(decide('https://ownersite.example.evil.test') === false,
    'and the middleware itself refuses a lookalike');
  ck(decide('https://chipz-app.onrender.com') === true, 'the platform host still works');
  ck(decide(undefined) === true,
    'and a request with no Origin at all is allowed -- that is the payment webhooks, which must never be blocked by a domain rule');
  api.setMainAllowed([]);
  ck(decide('https://g26e.ownersite.example') === false,
    'while a domain that is not allowed at all is refused');
  // This sandbox carries shared mutable state, so every block puts the host
  // policy back the way it found it -- clearing the allowlist here and
  // leaving it cleared failed the very next assertion.
  api.setMainAllowed(['ownersite.example']);
  // Reaching the backend must NOT depend on the base domain being right --
  // that setting exists to decide which COUNTRY a label belongs to, and
  // getting it wrong should not take the whole platform off the air.
  api.setHostPolicy({ baseDomain: '' });
  ck(api.corsHostAllowed('g26e.ownersite.example'),
    'and it still works with no base domain set at all, because that is a different job');
  api.setHostPolicy({ baseDomain: 'chipz-platform.com' });
  api.setMainAllowed([]);
  // Strict mode must not refuse a domain the owner allowed himself: it
  // depends on the base domain to know what a country's addresses are, and
  // if that is wrong it would otherwise park every address at once.
  api.setMainAllowed(['ownersite.example']);
  api.setHostPolicy({ strictRegionHosts: true });
  ck(api.hostIsParked('unclaimed.chipz-platform.com'),
    'strict mode still refuses an address no country claims');
  ck(!api.hostIsParked('ownersite.example'),
    'but never one the owner typed into the allowlist himself');
  api.setHostPolicy({ strictRegionHosts: false });
  api.setMainAllowed([]);
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
  // Matched on the inline hide SPECIFICALLY, not on the word
  // 'loadingScreen' anywhere in the function: the !important stylesheet
  // added below names it too, so a loose match passes with the inline hide
  // deleted. Both are wanted -- the inline hide is what is in place in the
  // same tick the notice is appended, the stylesheet is what keeps it there.
  ck(/\$\('loadingScreen'\); if \(ls\) ls\.style\.display = 'none'/.test(parked) && /_hostParkedShown/.test(parked),
    'the notice takes the loading screen down with it, and shows once');
  // And it has to STAY down. A Firebase session restore landing a moment
  // later runs enterApp(), which shows #app again -- leaving the member
  // looking at a half-painted app on an address where every request is
  // refused. A stylesheet rule with !important beats the inline style that
  // later code sets; an inline style set from here does not.
  const sticky = /st\.textContent = '([^']*)'/.exec(parked);
  ck(!!sticky && /display:none !important/.test(sticky[1]) && /appendChild/.test(parked) && /createElement\('style'\)/.test(parked),
    'and nothing that runs afterwards can put the app back on screen over it');
  for (const id of ['#loadingScreen', '#app', '#authScreen'])
    ck(!!sticky && sticky[1].includes(id), `  including ${id}`);
}

console.log('\n— an address can be generated on demand —');
{
  const gen = bare.slice(bare.indexOf("app.post('/admin/regions/add-label'"));
  const body = gen.slice(0, gen.indexOf("app.post('/admin/regions/delete'"));
  ck(/randFromAlphabet\(LABEL_ALPHABET/.test(body), 'the label is minted with the CSPRNG, not Math.random');
  ck(/for \(const r of regions\) for \(const l of \(r\.labels \|\| \[\]\)\) taken\.add\(l\)/.test(body),
    'and checked unique across EVERY country, not just this one');
  ck(/\(region\.labels \|\| \[\]\)\.concat\(made\)/.test(body),
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
  // The "hidden with one country" behaviour is proved by RUNNING the switch
  // further up (switchFor(one, ...).switchHidden). This kept matching the old
  // picker's `ADMIN_REGIONS.length < 2` guard, which no longer exists -- so
  // it is the tab labels that are checked here instead, which is the thing
  // this block is about.
  ck(/ADMIN_REGIONS\.length > 1/.test(admin),
    'and single-country installs are spared every country label in the panel');
  ck(/data-gen-region/.test(admin) && /'\/admin\/regions\/add-label'/.test(admin),
    'the panel can ask the server for a new short address');
  ck(/id="rgLabels"/.test(admin) && /labels: \$\('rgLabels'\)\.value/.test(admin),
    'short addresses are editable per country');
  ck(/id="sBaseDomain"/.test(admin) && /id="sBlockRoot"/.test(admin) && /id="sStrictHosts"/.test(admin) && /id="sParkedHosts"/.test(admin),
    'and the four host rules have their own card in Settings');
  ck(/baseDomain:\$\('sBaseDomain'\)\.value/.test(admin) && /blockRootDomain:\$\('sBlockRoot'\)\.checked/.test(admin),
    'which really sends them');
}


async function rotationChecks(){
console.log('\n— moving an arrival onto a different address in his own country —');
// Owner: "if one joined the site or visited the site with a subdomain like
// gfdt so in his session, server changes the subdomain of his session to
// another like b5dh, so in that very country."
//
// The REAL /public/entry handler is lifted out and run here, not described:
// which address it hands out is the whole feature, and every rule it has to
// obey (same country, claimed addresses only, never back to where he is) is
// a rule that only shows up when the thing actually runs.
function handlerSource(text, path) {
  const at = text.indexOf(`app.get('${path}'`);
  if (at === -1) throw new Error(`no such route: ${path}`);
  const fnAt = text.indexOf('=> {', at);
  const open = text.indexOf('{', fnAt);
  let depth = 0;
  for (let k = open; k < text.length; k++) {
    if (text[k] === '{') depth++;
    else if (text[k] === '}') { depth--; if (depth === 0) return text.slice(text.lastIndexOf('async', fnAt), k + 1); }
  }
  throw new Error('unbalanced braces');
}
function entryHandler(opts) {
  return new Function('deps', `
    const { getSettings, requestHost, isInfraHost, hostOnly, verifyAuth, ROTATE_ENTRY_MODES, currentRegion } = deps;
    let _baseDomain = deps.baseDomain;
    return ${handlerSource(bare, '/public/entry')};
  `)(Object.assign({
    isInfraHost: h => ['localhost', '127.0.0.1'].includes(h) || /\.onrender\.com$/.test(h) || /\.edgeone\.app$/.test(h),
    hostOnly: raw => String(raw || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, ''),
    requestHost: req => String((req.headers && (req.headers.origin || req.headers.host)) || '').toLowerCase(),
    ROTATE_ENTRY_MODES: ['off', 'visitors', 'always'],
    baseDomain: 'example.test',
  }, opts));
}
// One call: returns whatever the handler passed to res.json().
async function askEntry(opts, req) {
  let out = null;
  const res = { json: o => { out = o; return res; }, status: () => res };
  await entryHandler(opts)(Object.assign({ headers: {}, query: {} }, req), res);
  return out;
}
{
  const ugPool = api.normalizeRegion({ key: 'ug', name: 'Uganda', currency: 'UGX', dialCode: '256',
    localLength: 9, prefixes: ['7'], labels: ['gfdt', 'b5dh', 'q7rk'] }, 'ug');
  const kePool = api.normalizeRegion({ key: 'ke', name: 'Kenya', currency: 'KES', dialCode: '254',
    localLength: 9, prefixes: ['7'], labels: ['shy', 'm4te'] }, 'ke');
  const base = (region, mode) => ({
    currentRegion: () => region,
    getSettings: async () => ({ rotateEntry: mode }),
    verifyAuth: async () => null,
  });
  const from = { headers: { origin: 'gfdt.example.test' } };

  const off = await askEntry(base(ugPool, 'off'), from);
  ck(off && off.status === 'success' && off.rotate === false, 'off: nobody is moved');

  // Run it enough times to see the whole pool, because which one it picks is
  // deliberately random -- a single call could pass by luck.
  const seen = new Set();
  let everRotated = 0, everWrong = 0;
  for (let i = 0; i < 200; i++) {
    const r = await askEntry(base(ugPool, 'visitors'), from);
    if (r.rotate) { everRotated++; seen.add(r.host); }
    if (r.host === 'gfdt.example.test') everWrong++;
  }
  ck(everRotated === 200, 'visitors: a visitor is moved');
  ck(everWrong === 0, 'and never back onto the address he is already on');
  ck(seen.size === 2 && seen.has('b5dh.example.test') && seen.has('q7rk.example.test'),
    'the pool is this country’s other short addresses, and all of them get used');

  // "so in that very country" -- the one rule the whole feature hangs on.
  const keSeen = new Set();
  for (let i = 0; i < 60; i++) {
    const r = await askEntry(base(kePool, 'visitors'), { headers: { origin: 'shy.example.test' } });
    if (r.rotate) keSeen.add(r.host);
  }
  ck(keSeen.size === 1 && keSeen.has('m4te.example.test'),
    'a Kenyan arrival is only ever moved to another Kenyan address');

  // The region middleware hands a signed-in member his OWN region even on
  // another country's hostname -- so a Kenyan member who opens a Ugandan
  // address must be offered Kenya's, never Uganda's.
  const cross = await askEntry(base(kePool, 'always'), from);
  ck(cross.rotate && cross.host === 'shy.example.test' || cross.host === 'm4te.example.test',
    'a member on another country’s address is offered his own country’s, not that one’s');
  ck(!['gfdt.example.test', 'b5dh.example.test', 'q7rk.example.test'].includes(cross.host),
    'and never one of the other country’s');

  // Signed in.
  const signedIn = { headers: { origin: 'gfdt.example.test', authorization: 'Bearer tok' } };
  const asMember = m => Object.assign(base(ugPool, m), { verifyAuth: async () => 'uid-1' });
  ck((await askEntry(asMember('visitors'), signedIn)).rotate === false,
    'visitors: a signed-in member is left where he is (his saved password, offline app and installed icon all live on that one address)');
  ck((await askEntry(asMember('always'), signedIn)).rotate === true,
    'always: he is moved anyway, which is what that mode means');
  // A Bearer header that Firebase rejects is not a signed-in member.
  ck((await askEntry(base(ugPool, 'visitors'), signedIn)).rotate === true,
    'a token the server cannot verify does not count as signed in');

  // The owner's own testing addresses.
  for (const h of ['chipz-app.onrender.com', 'localhost', 'chipz.edgeone.app']) {
    ck((await askEntry(base(ugPool, 'always'), { headers: { origin: h } })).rotate === false,
      `nobody is moved off ${h} -- that is the owner testing`);
  }

  // Nowhere to send anybody.
  const lone = api.normalizeRegion({ key: 'ug', name: 'Uganda', currency: 'UGX', dialCode: '256',
    localLength: 9, prefixes: ['7'], labels: ['gfdt'] }, 'ug');
  ck((await askEntry(base(lone, 'always'), from)).rotate === false,
    'a country with one short address moves nobody, rather than sending him round to himself');
  const none = api.normalizeRegion({ key: 'ug', name: 'Uganda', currency: 'UGX', dialCode: '256',
    localLength: 9, prefixes: ['7'], labels: [] }, 'ug');
  ck((await askEntry(base(none, 'always'), from)).rotate === false, 'and a country with none moves nobody');

  // ?from= wins over the header, which is how the app names the address it
  // is actually on when the request carries no Origin.
  const byQuery = new Set();
  for (let i = 0; i < 80; i++) {
    const r = await askEntry(base(ugPool, 'always'), { headers: {}, query: { from: 'b5dh.example.test' } });
    if (r.rotate) byQuery.add(r.host);
  }
  ck(!byQuery.has('b5dh.example.test') && byQuery.size === 2,
    'the app can name the address it is on, and is never sent back to it');

  // A broken settings read must not stop the app loading.
  const brokeRes = await askEntry({ currentRegion: () => ugPool,
    getSettings: async () => { throw new Error('db down'); }, verifyAuth: async () => null }, from);
  ck(brokeRes && brokeRes.status === 'success' && brokeRes.rotate === false,
    'a failure answers “stay where you are” -- the address he has works');

  // Only addresses the country claims. A label with no base domain to hang
  // off would produce a bare hostname that resolves nowhere.
  const noBase = await askEntry(Object.assign(base(ugPool, 'always'), { baseDomain: '' }), from);
  ck(noBase.rotate === false, 'with no base domain set, nobody is moved anywhere');
}
{
  // Only the three known modes, refused rather than coerced.
  const m = /const ROTATE_ENTRY_MODES = \[([^\]]*)\]/.exec(bare);
  ck(!!m, 'the modes are named in one place');
  ck(m && m[1].split(',').map(x => x.trim().replace(/'/g, '')).sort().join('|') === 'always|off|visitors',
    'and there are exactly three of them');
  // Two structural guarantees the stubs above cannot see, because the stub
  // getSettings answers whatever key it is handed.
  const entryBody = handlerSource(bare, '/public/entry');
  ck(/getSettings\(region\.key\)/.test(entryBody),
    'the mode is read from this country’s own settings, not the founding country’s');
  ck(/const pool = \(region\.labels \|\| \[\]\)/.test(entryBody),
    'and the pool is built from this country’s own address list and nothing else');
  const upd = bare.slice(bare.indexOf("app.post('/admin/settings/update'"));
  const body = upd.slice(0, upd.indexOf("app.post('", 10));
  ck(/'rotateEntry' in updates/.test(body) && /ROTATE_ENTRY_MODES\.includes\(mode\)/.test(body),
    'a typed mode is checked against them at save time');
  ck(/return res\.status\(400\)[\s\S]{0,200}off, visitors, or always/.test(body),
    'and a bad one is refused, not quietly turned into “off”');
  // Per COUNTRY, not backend-wide: the pool of addresses is per country, and
  // "in that very country" is the point.
  const g = /const GLOBAL_ONLY_SETTINGS = \[([^\]]*)\]/.exec(bare)[1];
  ck(!/rotateEntry/.test(g), 'and it is a per-country setting, so each country can have its own answer');
  ck(/rotateEntry:/.test(bare.slice(bare.indexOf('const DEFAULT_SETTINGS'), bare.indexOf('const DEFAULT_SETTINGS') + 9000)),
    'with a default, so a country that has never been asked is “off”');
}
{
  // Several addresses at once: the pool needs more than one, and one tap per
  // address is a lot of tapping.
  const add = bare.slice(bare.indexOf("app.post('/admin/regions/add-label'"));
  const body = add.slice(0, add.indexOf("app.post('", 10));
  ck(/Number\(req\.body\.count\)/.test(body), 'the panel can ask for several short addresses in one go');
  ck(/Math\.min\(24 - held/.test(body), 'capped at the room left under the 24 a country may hold');
  ck(/taken\.add\(label\)/.test(body),
    'and each one minted is counted as taken, so a batch cannot contain the same address twice');
  // Checked on the REPLY line specifically. A file-wide /labels: made/ passed
  // with the reply stripped back to one address, because the admin-log line
  // right above it says `labels: made.join(', ')`.
  const reply = /res\.json\(\{ status: 'success', label: made\[0\].*$/m.exec(body);
  ck(!!reply && /labels: made,/.test(reply[0]) && /hosts: made\.map\(hostOf\)/.test(reply[0]),
    'all of them come back, not just the first');
}
{
  // The client half. The loop guard is the whole safety of this feature and
  // it CANNOT live in sessionStorage alone -- storage is per origin, so the
  // marker written before the hop does not exist on the address we land on.
  ck(/ENTRY_MOVE_PARAM = '_e'/.test(bareClient), 'the “already moved” marker travels in the URL');
  const moved = stripComments(fnSource(client, 'entryAlreadyMoved'));
  ck(/searchParams\.get\(ENTRY_MOVE_PARAM\)/.test(moved) && /sessionStorage\.setItem\(ENTRY_MOVE_KEY/.test(moved),
    'and is copied into this address’s own storage on arrival');
  ck(/searchParams\.delete\(ENTRY_MOVE_PARAM\)/.test(moved) && /history\.replaceState/.test(moved),
    'then stripped back out of the address bar, so a member cannot share a link that says “already moved”');
  const rot = stripComments(fnSource(client, 'maybeRotateEntry'));
  ck(/if \(entryAlreadyMoved\(\)\) return false/.test(rot), 'a session is only ever moved once');
  ck(/'\/public\/entry\?from=' \+ encodeURIComponent\(location\.hostname\)/.test(rot),
    'the app tells the server which address it is on');
  ck(/r\.host === location\.hostname/.test(rot), 'and refuses a hop to where it already is');
  ck(/r\.mode !== 'always'/.test(rot) && /localStorage\.getItem\(CACHED_STATE_KEY\)/.test(rot),
    'the app makes its own “is anyone signed in here” check, because Firebase has usually not restored the session by the first request');
  // The hop itself, RUN rather than described: which URL the browser is
  // actually sent to is the whole of it. A static "does it assign
  // url.hostname" check passed with a line that blanked the path added right
  // in front of it -- and the invite code lives in the path.
  function runRotate(deps) {
    const moves = [];
    const loc = {
      protocol: 'https:', hostname: 'gfdt.example.test',
      href: deps.href || 'https://gfdt.example.test/refCode=ABC#pages/register/?ref=ABC',
      replace: t => moves.push(['replace', t]),
      assign: t => moves.push(['assign', t]),
    };
    const store = {};
    const fn = new Function('deps', `
      const api = deps.api, location = deps.location;
      const sessionStorage = deps.sessionStorage, localStorage = deps.localStorage;
      const CACHED_STATE_KEY = 'snow_state_cache';
      const ENTRY_MOVE_PARAM = '_e', ENTRY_MOVE_KEY = 'chipzEntryMoved';
      const entryAlreadyMoved = deps.entryAlreadyMoved;
      ${fnSource(client, 'maybeRotateEntry')}
      return maybeRotateEntry;
    `)({
      api: async () => deps.answer,
      location: loc,
      entryAlreadyMoved: () => !!deps.alreadyMoved,
      sessionStorage: { getItem: k => store[k] || null, setItem: (k, v) => { store[k] = v; } },
      localStorage: { getItem: () => (deps.signedInHere ? '{"uid":"u1"}' : null) },
    });
    return fn().then(r => ({ moved: r, moves }));
  }
  const hop = await runRotate({ answer: { status: 'success', rotate: true, mode: 'visitors', host: 'b5dh.example.test' } });
  ck(hop.moved === true && hop.moves.length === 1, 'a visitor really is sent somewhere');
  ck(hop.moves[0][0] === 'replace',
    'with replace(), not assign(), so the phone’s Back button cannot walk him back onto the old address');
  ck(hop.moves[0][1] === 'https://b5dh.example.test/refCode=ABC?_e=1#pages/register/?ref=ABC',
    'only the hostname changes -- the path, the ?ref= code and the #hash all travel with him');
  const held = await runRotate({ signedInHere: true, answer: { status: 'success', rotate: true, mode: 'visitors', host: 'b5dh.example.test' } });
  ck(held.moved === false && held.moves.length === 0,
    'and a browser that already holds a signed-in account on this address is left alone');
  const forced = await runRotate({ signedInHere: true, answer: { status: 'success', rotate: true, mode: 'always', host: 'b5dh.example.test' } });
  ck(forced.moved === true, 'unless the mode is “always”');
  const stay = await runRotate({ answer: { status: 'success', rotate: false, mode: 'visitors', host: '' } });
  ck(stay.moved === false && stay.moves.length === 0, '“stay” moves nobody');
  const again = await runRotate({ alreadyMoved: true, answer: { status: 'success', rotate: true, mode: 'always', host: 'b5dh.example.test' } });
  ck(again.moved === false && again.moves.length === 0, 'and a session already moved once is never moved again');
  ck(/var _entryPromise = maybeRotateEntry\(\);/.test(bareClient),
    'it runs at start-up');
  ck(bareClient.indexOf('maybeRotateEntry();') < bareClient.indexOf('boot();'),
    'alongside boot(), not in front of it -- an extra round trip before the loading screen would slow every arrival down to buy an answer that is usually “stay”');
}
{
  const admin = fs.readFileSync(__dirname + '/admin-src/index.html', 'utf8');
  ck(/id="sRotateEntry"/.test(admin) && /rotateEntry:\$\('sRotateEntry'\)\.value/.test(admin),
    'the mode is set from the panel and really sent');
  ck(/value="off"/.test(admin) && /value="visitors"/.test(admin) && /value="always"/.test(admin),
    'all three modes are offered');
  ck(/Visitors only &mdash; recommended/.test(admin),
    'and the recommended one says so');
  ck(/saved password/.test(admin) && /home-screen icon/.test(admin),
    'with what moving a signed-in member actually costs him spelled out');
  ck(/data-gen-count="5"/.test(admin), 'and five addresses can be minted in one tap');
}

console.log('\n— the invite link carries a random address of the member’s own country —');
// Owner: "when he uses gdfs in the team links, the urls will rotate to any
// of that specific country ie t3gs, randomly ... not login session changes
// rotation of a link but also clicking back there to that section of copying
// referral code, a server looks for another subdomain of that very country
// randomly."
//
// The REAL handler, run -- which address it hands out is the whole feature.
function shareHandler(opts) {
  return new Function('deps', `
    const currentRegion = deps.currentRegion, crypto = deps.crypto;
    let _baseDomain = deps.baseDomain;
    return ${handlerSource(bare, '/public/share-host')};
  `)(Object.assign({ crypto: require('crypto'), baseDomain: 'example.test' }, opts));
}
async function askShare(opts) {
  let out = null;
  const res = { json: o => { out = o; return res; }, status: () => res };
  await shareHandler(opts)({ headers: {}, query: {} }, res);
  return out;
}
{
  const ug = api.normalizeRegion({ key: 'ug', name: 'Uganda', currency: 'UGX', dialCode: '256',
    localLength: 9, prefixes: ['7'], labels: ['gdfs', 't3gs', 'q7rk'] }, 'ug');
  const ke = api.normalizeRegion({ key: 'ke', name: 'Kenya', currency: 'KES', dialCode: '254',
    localLength: 9, prefixes: ['7'], labels: ['shy', 'm4te'] }, 'ke');
  const ugHosts = ['gdfs.example.test', 't3gs.example.test', 'q7rk.example.test'];

  // Over many opens EVERY one of the country's addresses gets used -- the
  // stated goal ("every subdomain is used and randomly"). Run enough times
  // that a uniform pick over three cannot miss one by luck.
  const seen = new Set();
  let offCountry = 0, firstVaried = new Set();
  for (let i = 0; i < 300; i++) {
    const r = await askShare({ currentRegion: () => ug });
    // The reply is the whole POOL now, shuffled, so the app can advance to
    // the next address without another round trip (Round 162). `host` is
    // still the first of them, for a phone running the previous build.
    for (const h of (r.hosts || [])) { if (!ugHosts.includes(h)) offCountry++; seen.add(h); }
    if (!ugHosts.includes(r.host)) offCountry++;
    firstVaried.add(r.host);
  }
  ck(offCountry === 0, 'every address handed out is one of this country’s own');
  ck(seen.size === 3, 'and the pool carries all of them, not just one: ' + [...seen].sort().join(', '));
  ck(firstVaried.size === 3,
    'the order is shuffled per request, so one address is not everybody’s first: ' + firstVaried.size);
  {
    const r = await askShare({ currentRegion: () => ug });
    ck(Array.isArray(r.hosts) && r.hosts.length === 3 && r.host === r.hosts[0],
      'one reply carries the whole pool, and `host` stays as its first entry for an older app build');
    ck(new Set(r.hosts).size === r.hosts.length, 'with no address repeated inside it');
  }

  // "in that very country" -- a Kenyan member's invite can never carry a
  // Ugandan address. Sending one would be worse than cosmetic: the code is
  // refused at sign-up as belonging to another currency.
  const keSeen = new Set();
  for (let i = 0; i < 120; i++) {
    const r = await askShare({ currentRegion: () => ke });
    keSeen.add(r.host);
    for (const h of (r.hosts || [])) keSeen.add(h);
  }
  ck([...keSeen].every(h => ['shy.example.test', 'm4te.example.test'].includes(h)),
    'a Kenyan member’s invite only ever carries a Kenyan address: ' + [...keSeen].sort().join(', '));

  // Nothing to rotate to, and a broken read: both answer "use the address
  // you are already on", which is always a working invite.
  const none = api.normalizeRegion({ key: 'ug', name: 'Uganda', currency: 'UGX', dialCode: '256',
    localLength: 9, prefixes: ['7'], labels: [] }, 'ug');
  const empty = await askShare({ currentRegion: () => none });
  ck(empty.status === 'success' && empty.host === '' && empty.count === 0,
    'a country with no short addresses hands back nothing rather than failing');
  const noBase = await askShare({ currentRegion: () => ug, baseDomain: '' });
  ck(noBase.host === '', 'and so does a platform with no base domain set');
  const broke = await askShare({ currentRegion: () => { throw new Error('down'); } });
  ck(broke && broke.status === 'success' && broke.host === '',
    'a failure never costs the member his invite link');

  // The host is never taken from the request -- a member must not be able to
  // point his own invite link wherever he likes.
  const at = bare.indexOf("app.get('/public/share-host'");
  const body = bare.slice(at, bare.indexOf('\napp.', at + 10));
  ck(!/req\.(body|query)\.host/.test(body),
    'the server picks; no hostname is accepted from the request');
  ck(/const region = currentRegion\(\);/.test(body) && /\(region\.labels \|\| \[\]\)/.test(body),
    'drawn from the member’s own region’s claimed address list and nothing else');
  ck(/crypto\.randomInt\(/.test(body) && !/Math\.random/.test(body),
    'and shuffled with the CSPRNG, not Math.random');
}
{
  // The app half: the link the member copies, and WHEN it is re-picked.
  const paint = stripComments(fnSource(client, 'paintReferral'));
  ck(/\$\{shareOrigin\(\)\}\/\?ref=/.test(paint),
    'the invite link is built from the rotated address');
  ck(!/location\.origin\}\/\?ref=/.test(paint),
    'and not from whichever address he happens to be browsing on');
  // ── THE SHAPE OF THE LINK ITSELF ──
  // "/refCode=CODE" is a URL PATH, so the host looks for a file with that
  // name and answers 404 unless a rewrite rule is configured on it -- which
  // lives in render.yaml, only applies if the service came from that
  // blueprint, and has to be re-added by hand on any other host. When it is
  // missing nothing looks wrong until an invite is tapped, because "/"
  // serves index.html regardless. Reported live:
  // "https://gigs.myapp.com/refCode=RC9J2N ... it returns not found".
  //
  // "/?ref=CODE" is a query string on "/", so it needs no rule anywhere and
  // cannot 404 on any host.
  ck(!/refCode=/.test(paint),
    'and the link is a query string, not a path that needs a rewrite rule on every host');
  // Every shape must still PARSE, or invites already sent to real people
  // stop working. RUN, across all three -- a static "does it mention
  // location.search" check passes with the value thrown away a line later.
  function capture(href) {
    const u = new URL(href);
    const field = { value: '' };
    const state = {};
    new Function('deps', `
      const STATE = deps.state;
      const location = deps.location;
      const $ = () => deps.field;
      const showAuthTab = () => {};
      ${fnSource(client, 'captureReferralFromUrl')}
      captureReferralFromUrl();
    `)({ state, field, location: { search: u.search, hash: u.hash, pathname: u.pathname } });
    return state.refCode || null;
  }
  ck(capture('https://gigs.myapp.com/?ref=RC9J2N') === 'RC9J2N',
    'the ?ref= shape the app now hands out is read');
  ck(capture('https://gigs.myapp.com/#pages/register/?ref=RC9J2N') === 'RC9J2N',
    'the older #...?ref= shape still is');
  ck(capture('https://gigs.myapp.com/refCode=RC9J2N') === 'RC9J2N',
    'and so is /refCode=, so invites already out there keep working');
  ck(capture('https://gigs.myapp.com/') === null, 'and a plain visit captures nothing');
  // RUN, not matched. stripComments() treats the '//' inside the string
  // literal as the start of a line comment and eats the rest of the line,
  // so a static check of this particular function is testing rubble.
  function runShareOrigin(host, origin) {
    return new Function('deps', `
      const STATE = { shareHost: deps.host };
      const location = { protocol: 'https:', origin: deps.origin };
      ${fnSource(client, 'shareOrigin')}
      return shareOrigin();
    `)({ host, origin });
  }
  ck(runShareOrigin('t3gs.example.test', 'https://gdfs.example.test') === 'https://t3gs.example.test',
    'the link is built on the address the server picked, not the one he is on');
  ck(runShareOrigin('', 'https://gdfs.example.test') === 'https://gdfs.example.test',
    'and falls back to this origin when there is no pick, so the link is never broken');
  const rr = stripComments(fnSource(client, 'renderReferral'));
  ck(/refreshShareHost\(\)/.test(rr),
    'and it is re-picked when the Referral screen is opened');
  ck(/Promise\.all\(\[ api\('\/team\/stats'\), shareReady \]\)/.test(rr),
    'alongside the stats, not as a second round trip in front of the screen');
  // Round 162: the address is advanced BEFORE the first paint, so the link is
  // painted once with its final address rather than changing under him a
  // beat later. Order matters, so it is asserted as order.
  {
    const iRef = rr.indexOf('refreshShareHost()'), iPaint = rr.indexOf('paintReferral()');
    ck(iRef !== -1 && iPaint !== -1 && iRef < iPaint,
      'and the next address is taken before the first paint, so the link never changes under him');
  }
  // Re-picked per OPEN, not once per session: boot() must not be the only
  // place it happens, or going back to the screen would keep one address.
  ck(!/refreshShareHost/.test(stripComments(fnSource(client, 'boot'))),
    'per open rather than once at start-up -- going back to the screen picks again');
  // RUN. A static "is the repaint still in the text" check passes just as
  // happily when an early `return` is bolted in above it, which is exactly
  // the failure that matters: the address rotated and the member never sees
  // it because an unrelated call failed.
  function runRenderReferral(statsStatus) {
    const calls = { paint: 0, share: 0 };
    const fn = new Function('deps', `
      const STATE = { page: 'referral' };
      const paintReferral = () => { deps.calls.paint++; };
      const api = async p => (p === '/team/stats'
        ? { status: deps.statsStatus }
        : { status: 'success', host: 't3gs.example.test' });
      const refreshShareHost = async () => { deps.calls.share++; };
      ${fnSource(client, 'renderReferral')}
      return renderReferral;
    `)({ calls, statsStatus });
    return fn().then(() => calls);
  }
  const okRun = await runRenderReferral('success');
  ck(okRun.paint === 2 && okRun.share === 1,
    'the screen paints, fetches the address, and repaints with it');
  const badRun = await runRenderReferral('error');
  ck(badRun.paint === 2,
    'and it repaints even when the stats call fails, because the ADDRESS may still have changed');
  ck(badRun.share === 1, 'the address is still fetched on a failed stats call');
  const rsh = stripComments(fnSource(client, 'refreshShareHost'));
  ck(!/STATE\.settings/.test(rsh),
    'the pick is kept on STATE itself, never written into STATE.settings');

  // ── ROUND 162: CHANGING THE ADDRESS COSTS NO ROUND TRIP ──
  // Owner: "l also need ... faster changing of the subdomain rations."
  // RUN, not grepped: the whole claim is about how many requests it makes
  // and which address comes out, and neither is visible in the text.
  {
    const pool = ['b5dh.x.test', 't3gs.x.test', 'x7k2.x.test', 'g26e.x.test'];
    function build() {
      const calls = { n: 0 };
      const STATE = {};
      const ctx = new Function('deps', `
        const STATE = deps.STATE;
        const api = async () => { deps.calls.n++; return { status: 'success', host: deps.pool[0], hosts: deps.pool.slice() }; };
        ${fnSource(client, 'nextShareHost')}
        ${fnSource(client, 'refreshShareHost')}
        ${fnSource(client, 'shareOrigin')}
        var _shareHosts = [], _shareIdx = -1, _sharePoolAt = 0;
        var SHARE_POOL_MS = ${/SHARE_POOL_MS = ([^;]+);/.exec(client)[1]};
        return { refreshShareHost, nextShareHost, host: () => STATE.shareHost };
      `)({ calls, pool, STATE });
      return { ctx, calls };
    }
    const { ctx, calls } = build();
    const got = [];
    for (let i = 0; i < 4; i++) { await ctx.refreshShareHost(); got.push(ctx.host()); }
    ck(calls.n === 1, `four opens of the screen cost ONE request, not four (${calls.n})`);
    ck(new Set(got).size === 4,
      'and each open shows a different address: ' + got.join(', '));
    ck(got.every(h => pool.includes(h)), 'every one of them from the pool the server sent');
    await ctx.refreshShareHost();
    ck(ctx.host() === got[0],
      'a fifth open wraps back round rather than running out of addresses');
    ck(calls.n === 1, 'still without asking again');
    // The pool is re-read eventually, or an address the owner adds (or
    // retires) would never reach a member who leaves the app open.
    ck(/_sharePoolAt/.test(rsh) && /SHARE_POOL_MS/.test(rsh),
      'the pool is re-read after a while, so a newly added address is picked up');
    await ctx.refreshShareHost(true);
    ck(calls.n === 2, 'and a forced refresh really does ask again');
    // An older backend that only sends one host must still work: one address
    // is a pool of one, not a broken link.
    const one = new Function('deps', `
      const STATE = deps.STATE;
      const api = async () => ({ status: 'success', host: 'only.x.test' });
      ${fnSource(client, 'nextShareHost')}
      ${fnSource(client, 'refreshShareHost')}
      var _shareHosts = [], _shareIdx = -1, _sharePoolAt = 0;
      var SHARE_POOL_MS = 600000;
      return { refreshShareHost, host: () => STATE.shareHost };
    `)({ STATE: {} });
    await one.refreshShareHost();
    ck(one.host() === 'only.x.test',
      'a backend that sends a single host still gives a working invite link');
  }

  // ── ROUND 162: A PLAIN READ IS ONE ROUND TRIP ──
  // Content-Type: application/json is not CORS-safelisted, so sending it on
  // a GET forces an OPTIONS preflight before EVERY read (measured in
  // test-boot-speed.py against a real server). Run api() and read the
  // headers it actually sends.
  {
    async function headersFor(path, opts) {
      let sent = null;
      const fn = new Function('deps', `
        const STATE = { authEpoch: 0 };
        const API_BASE = 'https://api.test';
        const window = { fbAuth: null };
        const showHostParked = () => {};
        const fetch = async (u, o) => { deps.seen(o && o.headers); return { json: async () => ({ status: 'success' }) }; };
        ${fnSource(client, 'api')}
        return api;
      `)({ seen: h => { sent = h; } });
      await fn(path, opts);
      return sent || {};
    }
    const get = await headersFor('/public/settings');
    ck(!('Content-Type' in get),
      'a read sends no Content-Type, so it is never preflighted: ' + JSON.stringify(get));
    const post = await headersFor('/checkin', { method: 'POST', body: '{}' });
    ck(post['Content-Type'] === 'application/json',
      'a write still declares its JSON body');
    ck(/maxAge: 86400/.test(bare),
      'and the preflight a write does need is cached for a day rather than Chromium’s five seconds');
  }

  // ── ROUND 162: THE LOADER WAITS FOR FOUR REPLIES, NOT SEVEN ──
  // The three heavy ones are still FIRED at the same instant (delaying them
  // would only move the wait later) -- they are simply not awaited. Asserted
  // on boot()'s own text because the runtime proof lives in
  // test-boot-speed.py, which is far too slow for the mutation suite.
  {
    const b = stripComments(fnSource(client, 'boot'));
    const awaited = /await Promise\.all\(\[ pSettings, pProducts, pFeed, pBanner \]\)/.test(b);
    ck(awaited, 'the loader awaits settings, products, the feed and the banner');
    for (const heavy of ['announcement-image', 'manual-pay-images', 'chipz-images'])
      ck(new RegExp("api\\('/public/" + heavy + "'\\)").test(b),
        `/public/${heavy} is still fetched at start-up`);
    const iArt = b.indexOf('_artPromise'), iAwait = b.indexOf('await Promise.all([ pSettings');
    ck(iArt !== -1 && iAwait !== -1 && iArt < iAwait,
      'and the heavy three are fired BEFORE the wait, not after it');
    ck(!/await Promise\.all\(\[ api\('\/public\/announcement-image'\)/.test(b),
      'but the loader does not block on them');
    const art = stripComments(fnSource(client, 'applyBootArtwork'));
    ck(/paintHome\(\)/.test(art),
      'and Home repaints when they land, or the spin banner and profile GIF never appear');
    // The announcement dialog is the one thing that must NOT open before its
    // own picture arrives -- it paints once and never repaints.
    // showPage is `window.showPage = async function(name){...}`, so it has no
    // name for fnSource to find -- sliced by its assignment instead, the
    // same way this file already handles doLogin.
    {
      const at = client.indexOf('window.showPage = async function');
      const sp = stripComments(client.slice(at, client.indexOf('\nwindow.', at + 10)));
      ck(/_artPromise/.test(sp),
        'the announcement waits for the artwork it needs rather than opening blank');
    }
  }

  // ── ROUND 162: THE HEAVY REPLIES CARRY AN ETag ──
  {
    const pj = new Function('crypto', `
      ${fnSource(bare, 'publicJson')}
      return publicJson;
    `)(require('crypto'));
    function call(req) {
      const out = { headers: {}, code: 200, body: null, ended: false };
      const res = {
        set: (k, v) => { out.headers[String(k).toLowerCase()] = v; return res; },
        vary: () => res,
        status: c => { out.code = c; return res; },
        end: () => { out.ended = true; return res; },
        send: b => { out.body = b; return res; },
        json: b => { out.body = JSON.stringify(b); return res; },
      };
      pj(req, res, { status: 'success', image: 'x'.repeat(1000) }, 'public, max-age=60');
      return out;
    }
    const first = call({ headers: {} });
    ck(first.code === 200 && first.body && first.body.length > 900, 'a first read sends the body');
    ck(!!first.headers.etag, 'with an ETag: ' + first.headers.etag);
    ck(first.headers['cache-control'] === 'public, max-age=60', 'and the cache policy asked for');
    const again = call({ headers: { 'if-none-match': first.headers.etag } });
    ck(again.code === 304 && again.body === null,
      'and a browser that already has it gets a 304 with NO body -- the whole saving');
    // The tag has to depend on the CONTENT, or an upload would be served
    // from a stale cache forever.
    const other = new Function('crypto', `${fnSource(bare, 'publicJson')} return publicJson;`)(require('crypto'));
    let tag2 = null;
    other({ headers: {} }, { set: (k, v) => { if (String(k).toLowerCase() === 'etag') tag2 = v; }, vary(){}, status(){ return this; }, end(){}, send(){}, json(){} },
      { status: 'success', image: 'DIFFERENT' }, 'no-cache');
    ck(tag2 && tag2 !== first.headers.etag,
      'a different payload gets a different tag, so an upload is never hidden by the cache');

    // WHICH route uses WHICH policy, asserted per route. Proving publicJson
    // behaves correctly says nothing about whether the heavy replies
    // actually go through it -- the mutation that dropped the artwork route
    // back to a bare res.json() went undetected until this was added.
    const routeBody = (path) => {
      const at = bare.indexOf("app.get('" + path + "'");
      return at === -1 ? '' : bare.slice(at, bare.indexOf('\napp.', at + 10));
    };
    for (const path of ['/public/chipz-images', '/public/banner', '/public/announcement-image', '/public/manual-pay-images']) {
      const b2 = routeBody(path);
      ck(/publicJson\(req, res,/.test(b2) && /IMAGE_CACHE/.test(b2),
        `${path} is served with an ETag and a short cache, not as a fresh megabyte every launch`);
      ck(!/\bres\.json\(/.test(b2), `and ${path} has no uncached res.json() left`);
    }
    // Settings and prices deliberately take NO max-age: maintenance mode and
    // a rate change have to bite on the next launch, not a minute later. The
    // ETag still removes the bytes.
    for (const path of ['/public/settings', '/public/products']) {
      const b2 = routeBody(path);
      ck(/publicJson\(req, res,/.test(b2), `${path} still carries an ETag`);
      ck(!/IMAGE_CACHE/.test(b2),
        `but ${path} is revalidated every time -- a stale rate or maintenance flag is not acceptable`);
    }
  }
}
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
  const r = clientApi(pubView(KE));
  ck(r.fmtUGX(30000) === 'KES 30,000', 'the appʼs own formatter reads the regionʼs currency');
  const one = clientApi(pubView(api.normalizeRegion({ key: 'x', name: 'X', currency: 'KSH', dialCode: '111', localLength: 9, prefixes: ['7'] }, 'x')));
  ck(one.fmtUGX(1000) === 'KSH 1,000', 'including a label that is not three letters long');
}
ck(!/'UGX ' \+|"UGX " \+|>UGX</.test(bareClient), 'no screen still prints a hardcoded UGX');
ck(!/\.slice\(3\)/.test(stripComments(fnSource(client, 'fmtUGXCents'))),
  'and the cents formatter no longer assumes the label is exactly three characters');

// The rotation checks run the real async route handler, so they finish
// after everything above; the verdict waits for them.
rotationChecks().then(messageRegionChecks).then(maintenanceModeChecks).then(() => {
  console.log(failed ? `\n${failed} FAILED` : '\nregions: all cases pass');
  process.exit(failed ? 1 : 0);
}).catch(e => { console.log('FAIL  rotation checks threw: ' + (e && e.message)); process.exit(1); });
