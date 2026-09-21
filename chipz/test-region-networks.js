#!/usr/bin/env node
/**
 * "What is causing these fuckin things [auto-suspends], moreover still in
 * English, also make sure l can add a withdrawal network to any country to
 * be shown when adding withdrawal wallet, so not every country literally has
 * mtn and airtel."
 *
 * THE CHAIN THAT WAS BROKEN, traced from the screenshot backwards:
 *  1. NETWORK_NAMES was a single global Set(['MTN Mobile Money', 'Airtel
 *     Money']) -- every region, everywhere, forever.
 *  2. A member in Cameroon/Cote d'Ivoire/Benin has no real MTN/Airtel number
 *     to type, so a manual deposit for their real network (Orange, Moov) was
 *     REFUSED before assignManualNumberAndCreateDeposit() ever ran.
 *  3. recordDepositAttempt() runs BEFORE that function, so every one of
 *     those structurally-doomed taps still counted toward the 5-in-a-minute
 *     auto-ban -- a confused, legitimate member (of course they keep
 *     tapping) got silently suspended for a configuration gap that was
 *     never theirs to fix.
 *  4. "Account suspended. Contact customer service." was hardcoded English,
 *     shown to a member on a French-language screen.
 *
 * This file RUNS the real functions -- normalizeRegion(), regionNetworkSet(),
 * publicRegionView(), undoDepositAttempt()/recordDepositAttempt() -- rather
 * than reading the source, and checks each of the 5 real call sites for the
 * property that matters (region-scoped, not NETWORK_NAMES) rather than for a
 * literal string, per this project's own repeatedly-learned lesson: check
 * inside the block that matters, not across the whole file.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const src = fs.readFileSync(path.join(HERE, 'server.js'), 'utf8');
const client = fs.readFileSync(path.join(HERE, 'user-src', 'original_module.js'), 'utf8');
const admin = fs.readFileSync(path.join(HERE, 'admin-src', 'index.html'), 'utf8');

let bad = 0;
const ck = (o, l) => { if (!o) bad++; console.log((o ? 'PASS  ' : 'FAIL  ') + l); };

// NETWORK_NAMES itself must be gone from live code (comments referencing the
// old Snow-inherited name are fine -- only a real declaration/use is a
// regression).
{
  const codeOnly = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
  ck(!/\bNETWORK_NAMES\b/.test(codeOnly), 'NETWORK_NAMES no longer exists as live code');
}

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

// ── regionNetworkSet() ──
console.log('— regionNetworkSet() —');
{
  const api = new Function('CURRENT', `
    const DEFAULT_REGION = ${JSON.stringify({ networks: ['MTN Mobile Money', 'Airtel Money'] })};
    function currentRegion() { return CURRENT; }
    ${fnSource('regionNetworkSet')}
    return { regionNetworkSet };
  `);
  const ug = { key: 'ug', networks: ['MTN Mobile Money', 'Airtel Money'] };
  const cm = { key: 'cm', networks: ['MTN Mobile Money', 'Orange Money'] };
  const noNetworks = { key: 'zz' }; // an old deploy / pre-migration document
  const emptyNetworks = { key: 'yy', networks: [] };

  ck(api(ug).regionNetworkSet().has('MTN Mobile Money'), 'Uganda: MTN recognised');
  ck(api(ug).regionNetworkSet().has('Airtel Money'), 'Uganda: Airtel recognised');
  ck(!api(ug).regionNetworkSet().has('Orange Money'), 'Uganda: Orange is NOT a valid network');
  ck(api(cm).regionNetworkSet().has('Orange Money'), 'Cameroon: Orange recognised');
  ck(!api(cm).regionNetworkSet().has('Airtel Money'), 'Cameroon: Airtel is NOT valid for Cameroon');
  ck(api(noNetworks).regionNetworkSet().has('MTN Mobile Money'), 'a region with no networks field falls back to the default pair, not an empty set');
  ck(api(emptyNetworks).regionNetworkSet().has('MTN Mobile Money'), 'a region with networks:[] falls back too -- an empty array must not mean "no network is ever valid"');
  // Explicit region argument overrides currentRegion()
  const it = api(ug);
  ck(it.regionNetworkSet(cm).has('Orange Money'), 'an explicit region argument is honoured over currentRegion()');
}

// ── normalizeRegion(): the networks field ──
// DEFAULT_REGION, REGION_DEFAULT_NETWORKS and normalizeRegion() are adjacent
// in the file in declaration order, so one contiguous slice covers all three.
console.log('\n— normalizeRegion(): networks —');
{
  const from = src.indexOf('const DEFAULT_REGION_KEY');
  const to = src.indexOf('async function getRegions');
  if (from === -1 || to === -1) throw new Error('could not locate the region-normalisation block');
  const block = src.slice(from, to);
  for (const name of ['DEFAULT_REGION', 'REGION_DEFAULT_NETWORKS', 'normalizeRegion', 'LANGUAGE_CODES']) {
    if (!block.includes(name)) throw new Error(`region block is missing ${name} -- re-anchor the slice`);
  }
  const api = new Function(`
    function normalizeAllowedHost(h){ const s=String(h||'').trim().toLowerCase(); return { host: s || null }; }
    ${block}
    return { normalizeRegion, DEFAULT_REGION, REGION_DEFAULT_NETWORKS };
  `)();

  // Nothing typed: known market -> that market's real networks.
  ck(JSON.stringify(api.normalizeRegion({ dialCode: '237' }, 'cm').networks) === JSON.stringify(['MTN Mobile Money', 'Orange Money']),
     "Cameroon (+237), nothing typed, gets MTN + Orange from REGION_DEFAULT_NETWORKS");
  ck(JSON.stringify(api.normalizeRegion({ dialCode: '225' }, 'ci').networks) === JSON.stringify(['MTN Mobile Money', 'Orange Money']),
     "Cote d'Ivoire (+225), nothing typed, gets MTN + Orange");
  ck(JSON.stringify(api.normalizeRegion({ dialCode: '229' }, 'bj').networks) === JSON.stringify(['MTN Mobile Money', 'Moov Money']),
     'Benin (+229), nothing typed, gets MTN + Moov');
  const documentedDefaults = {
    '256': ['MTN Mobile Money', 'Airtel Money'],
    '254': ['M-Pesa'],
    '250': ['MTN Mobile Money', 'Airtel Money'],
    '243': ['Vodacom M-Pesa', 'Airtel Money', 'Orange Money'],
    '260': ['MTN Mobile Money', 'Airtel Money', 'Zamtel Money'],
    '237': ['MTN Mobile Money', 'Orange Money'],
    '229': ['MTN Mobile Money', 'Moov Money'],
    '225': ['MTN Mobile Money', 'Orange Money'],
    '241': ['Airtel Money'],
    '242': ['MTN Mobile Money', 'Airtel Money'],
    '221': ['Orange Money', 'Free Money'],
    '232': ['Orange Money'],
  };
  for (const [dial, want] of Object.entries(documentedDefaults)) {
    const got = api.normalizeRegion({ dialCode: dial }, 'x' + dial).networks;
    ck(JSON.stringify(got) === JSON.stringify(want),
       `+${dial} gets its documented MarzPay network defaults (${got.join(', ')})`);
  }
  ck(Object.keys(api.REGION_DEFAULT_NETWORKS).length === 12,
     'REGION_DEFAULT_NETWORKS covers all 12 MarzPay markets');
  // Nothing typed, an UNKNOWN dialling code: falls back to the founding
  // region's networks -- never silently invents a market-specific pair.
  ck(JSON.stringify(api.normalizeRegion({ dialCode: '255' }, 'tz').networks) === JSON.stringify(['MTN Mobile Money', 'Airtel Money']),
     'Tanzania (+255, no known default), nothing typed, falls back to the founding region\'s networks');

  // Typed: comma/newline split, NEVER bare whitespace -- a network's own
  // name is multiple words ("MTN Mobile Money"), so splitting on spaces
  // would shred it into three separate, useless tokens.
  const typed = api.normalizeRegion({ dialCode: '237', networks: 'MTN Mobile Money, Orange Money' }, 'cm');
  ck(JSON.stringify(typed.networks) === JSON.stringify(['MTN Mobile Money', 'Orange Money']),
     'a comma-separated string is split into whole multi-word names, not shredded on spaces');
  ck(api.normalizeRegion({ dialCode: '237', networks: 'MTN Mobile Money' }, 'cm').networks[0] === 'MTN Mobile Money',
     'a single multi-word network survives as ONE token, not three');

  // Deduped, capped at 8, each capped at 40 chars.
  const dup = api.normalizeRegion({ networks: 'A, A, B' }, 'xx');
  ck(JSON.stringify(dup.networks) === JSON.stringify(['A', 'B']), 'duplicates are collapsed');
  const many = api.normalizeRegion({ networks: Array.from({ length: 12 }, (_, i) => 'Net' + i) }, 'xx');
  ck(many.networks.length === 8, 'capped at 8 networks');
  const long = api.normalizeRegion({ networks: 'x'.repeat(100) }, 'xx');
  ck(long.networks[0].length === 40, 'a single network name is capped at 40 characters');

  // Case preserved exactly as typed -- never title-cased or otherwise mangled.
  ck(api.normalizeRegion({ networks: 'mtn mobile money' }, 'xx').networks[0] === 'mtn mobile money',
     'case is preserved exactly as typed, not forced to title case');

  // An existing region re-normalised with nothing re-typed keeps its own
  // stored networks (the `base.networks` fallback for the founding region,
  // and the general base/DEFAULT_REGION chain for others).
  const reNormalizedUg = api.normalizeRegion({}, 'ug');
  ck(JSON.stringify(reNormalizedUg.networks) === JSON.stringify(['MTN Mobile Money', 'Airtel Money']),
     "re-normalising Uganda's own stored document with nothing typed keeps MTN + Airtel");
}

// ── publicRegionView() publishes networks ──
console.log('\n— publicRegionView() —');
{
  const at = src.indexOf('function publicRegionView');
  const end = src.indexOf('\n}', at) + 2;
  const block = src.slice(at, end);
  ck(/networks:/.test(block), 'publicRegionView() includes a networks field');
  const api = new Function(`
    const DEFAULT_REGION = { networks: ['MTN Mobile Money', 'Airtel Money'] };
    function currentRegion() { return { key: 'ug' }; }
    function regionUsesBareLocal(){ return true; }
    ${block}
    return { publicRegionView };
  `)();
  ck(JSON.stringify(api.publicRegionView({ key: 'cm', networks: ['MTN Mobile Money', 'Orange Money'] }).networks) === JSON.stringify(['MTN Mobile Money', 'Orange Money']),
     'a region with its own networks publishes exactly those');
  ck(JSON.stringify(api.publicRegionView({ key: 'zz' }).networks) === JSON.stringify(['MTN Mobile Money', 'Airtel Money']),
     'a region with no networks field (old deploy) still publishes a usable default, not undefined/empty');
}

// ── The 5 real call sites: region-scoped, not the old global set ──
console.log('\n— every real call site is region-scoped —');
{
  const checks = [
    ["/deposit/marzpay's network label", "app.post('/deposit/marzpay'", "app.post('/deposit/manual/init'", /regionNetworkSet\(\)\.has\(req\.body\.network\)/],
    ['/deposit/manual/init gates on the region', "app.post('/deposit/manual/init'", "app.post('/deposit/manual/status'", /regionNetworkSet\(\)\.has\(req\.body\.network\)/],
    ['/admin/manual-numbers/save validates against the region BEING SAVED', "app.post('/admin/manual-numbers/save'", "app.post('/admin/manual-numbers/toggle'", /regionNetworkSet\(numRegion\)\.has\(network\)/],
    ['/withdraw/request re-validates the bound wallet network', "app.post('/withdraw/request'", "async function processWithdrawalCore", /regionNetworkSet\(\)\.has\(rawNetwork\)/],
    ['/bank/save -- the withdrawal-wallet screen the owner asked about', "app.post('/bank/save'", "app.post('/bank/", /regionNetworkSet\(\)\.has\(rawNetwork\)/],
  ];
  for (const [label, startAnchor, endAnchor, re] of checks) {
    const at = src.indexOf(startAnchor);
    ck(at > -1, `${label}: route located`);
    let end = src.indexOf(endAnchor, at + 10);
    if (end === -1 || end <= at) end = at + 4000;
    const body = src.slice(at, end);
    ck(re.test(body), `${label}: region-scoped lookup is actually wired in`);
  }
  // /admin/manual-numbers/save must compute numRegion BEFORE validating the
  // network against it -- a network check against the wrong (or no) region
  // is the exact bug this round closes.
  const at = src.indexOf("app.post('/admin/manual-numbers/save'");
  const end = src.indexOf("app.post('/admin/manual-numbers/toggle'", at);
  const body = src.slice(at, end);
  const regionAt = body.indexOf('regionByKey(');
  const checkAt = body.indexOf('regionNetworkSet(numRegion)');
  ck(regionAt > -1 && checkAt > regionAt, 'numRegion is resolved BEFORE the network is validated against it');
}

// ── the deposit-attempts auto-ban is REMOVED, not patched ──
// Owner, a round later: "please make sure that everything is on its own and
// remove auto ban." Round 179's undoDepositAttempt() fix (tested above, in
// git history) treated a symptom; this removes the mechanism entirely --
// nothing bans a member for how many times they tried a deposit, ever.
console.log('\n— the deposit-attempts auto-ban no longer exists —');
{
  const codeOnly = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
  for (const name of ['banUserAutomatically', 'recordDepositAttempt', 'undoDepositAttempt',
                       'markDepositAttemptSucceeded', 'depositSucceededRecently', '_depAttempts']) {
    ck(!new RegExp('\\b' + name + '\\b').test(codeOnly), `${name} no longer exists as live code`);
  }
  // The DIFFERENT automatic ban -- applyDepositReversal(), triggered by a
  // confirmed MTN-side clawback of an already-credited deposit -- is
  // deliberately untouched. That one responds to an external fact (money
  // that WAS credited has since been taken back by the network), not to a
  // member's own retry count, and removing it would reopen a real fraud
  // path. Both directions checked, so a mutation that deletes it is caught
  // by THIS file even though it isn't this round's own change.
  ck(/async function applyDepositReversal/.test(codeOnly), 'the MTN-reversal fraud ban is still there');
  ck(/banReason: `Automatic: MTN deposit reversal detected/.test(codeOnly), '  and still names what it is responding to');
}
{
  // Both deposit routes still debounce a double-tap (429, "already being
  // processed") -- that guard never banned anyone and stays. Neither route
  // still WRITES a ban of its own; the only 'banned' text left in each is
  // reading an EXISTING status (an admin's own manual ban), never setting one.
  for (const [label, startAnchor, endAnchor] of [
    ["/deposit/marzpay", "app.post('/deposit/marzpay'", 'function depositFullyCredited'],
    ['/deposit/manual/init', "app.post('/deposit/manual/init'", "app.post('/deposit/manual/status'"],
  ]) {
    const at = src.indexOf(startAnchor);
    const end = src.indexOf(endAnchor, at + 10);
    const body = src.slice(at, end);
    ck(/A deposit is already being processed/.test(body), `${label}: the debounce (unrelated to banning) is still there`);
    ck(/status === 'banned'/.test(body), `${label}: still reads an EXISTING ban (an admin's own decision)`);
    ck(!/status:\s*'banned'/.test(body), `${label}: never WRITES a ban of its own any more`);
  }
}
{
  // sweepEphemeralState() no longer has anything of the removed feature's
  // to clean up.
  const at = src.indexOf('function sweepEphemeralState');
  const end = src.indexOf('\n}', at) + 2;
  const body = src.slice(at, end);
  ck(!/_depAttempts/.test(body), 'the in-memory sweeper no longer references _depAttempts');
}
{
  // The admin's own manual ban/unban route is UNTOUCHED -- removing the
  // automatic heuristic must not remove an admin's ability to ban someone
  // on purpose.
  ck(/status: isBan \? 'banned' : 'active'/.test(src), "the admin's manual ban/unban toggle still exists");
}

// ── /admin/regions/save: networks validation ──
console.log('\n— /admin/regions/save refuses a bad networks list, by name —');
{
  const at = src.indexOf("app.post('/admin/regions/save'");
  const end = src.indexOf("app.post('/admin/regions/add-label'", at);
  const body = src.slice(at, end);
  ck(/typedNetworks/.test(body), 'the save route inspects the typed networks list');
  ck(/too long for a network name/.test(body), 'a too-long network name is refused by name');
  ck(/at most 8 networks/.test(body), 'more than 8 networks is refused by name');
  ck(/listed twice/.test(body), 'a duplicated network name is refused by name');
  // Ordering: these checks must run before the region is written, same
  // pattern as the existing language checks right above them.
  const networksCheckAt = body.indexOf('typedNetworks');
  const writeAt = body.indexOf("db.collection('regions')");
  ck(networksCheckAt > -1 && writeAt > networksCheckAt, 'the networks checks run before the region is written to the database');
}

// ── "Account suspended. Contact customer service." is translated ──
console.log('\n— the ban message is translated, not hardcoded English —');
{
  const m = /\['Account suspended\. Contact customer service\.',([\s\S]*?)\],/.exec(client);
  ck(!!m, 'LANG_ROWS carries a row for the exact ban sentence');
  if (m) {
    const cells = m[1].split(',').map(s => s.trim()).filter(Boolean);
    ck(cells.length === 5, `all five language cells are present (${cells.length})`);
    for (const c of cells) {
      ck(c !== "''" && c !== '""', '  no cell is blank -- a blank silently means "show the English"');
    }
  }
  // And it is actually the string every BANNED response uses -- if the
  // English literal in server.js ever drifts from the LANG_ROWS key, the
  // row stops matching and members are back to raw English.
  const banLiterals = [...src.matchAll(/code:\s*'BANNED',\s*message:\s*'([^']+)'/g)].map(x => x[1]);
  ck(banLiterals.length >= 3, `found the BANNED literal at its real call sites (${banLiterals.length})`);
  ck(banLiterals.every(s => s === 'Account suspended. Contact customer service.'),
     'every BANNED response uses the EXACT string the LANG_ROWS row is keyed on');
}

// ── client: regionNetworks() and the wallet sheet ──
console.log('\n— client: renderWalletSheet() reads the region\'s own networks —');
{
  ck(!/const providers = \['MTN Mobile Money', 'Airtel Money'\];/.test(client),
     'the hardcoded MTN/Airtel literal is gone from renderWalletSheet()');
  const at = client.indexOf('function renderWalletSheet');
  const end = client.indexOf('\n}', at) + 2;
  const body = client.slice(at, end);
  ck(/const providers = regionNetworks\(\)/.test(body), 'renderWalletSheet() now reads regionNetworks()');

  // 'networks' is in applyRegion()'s whitelist -- Round 155's own recorded
  // hazard: a published field left out of that list is silently dropped.
  const arAt = client.indexOf('function applyRegion');
  const arEnd = client.indexOf('\n}', arAt) + 2;
  const arBody = client.slice(arAt, arEnd);
  ck(/'networks'/.test(arBody), "applyRegion()'s field whitelist includes 'networks'");

  // regionNetworks() itself: falls back sanely when REGION carries nothing.
  const start = client.indexOf('function regionNetworks(');
  const fnEnd = client.indexOf('\n', start);
  const fnBody = client.slice(start, fnEnd);
  const api = new Function(`
    var REGION = null;
    ${fnBody}
    return { regionNetworks, set: (r) => { REGION = r; } };
  `)();
  ck(JSON.stringify(api.regionNetworks()) === JSON.stringify(['MTN Mobile Money', 'Airtel Money']),
     'with no REGION at all (not yet loaded), falls back to MTN/Airtel rather than throwing');
  api.set({ networks: ['MTN Mobile Money', 'Orange Money'] });
  ck(JSON.stringify(api.regionNetworks()) === JSON.stringify(['MTN Mobile Money', 'Orange Money']),
     "with REGION.networks set, returns the member's own country's networks");
  api.set({ networks: [] });
  ck(JSON.stringify(api.regionNetworks()) === JSON.stringify(['MTN Mobile Money', 'Airtel Money']),
     'with REGION.networks explicitly empty, still falls back rather than offering nothing to pick');
}

// ── admin panel: the Countries edit dialog has a Networks field ──
console.log('\n— admin panel: Networks this country offers —');
{
  ck(/id="rgNetworks"/.test(admin), 'the Countries edit dialog has a Networks input');
  ck(/rgNetworks/.test(admin) && /\.split\(\/\[,\\n\]\+\/\)/.test(admin.slice(admin.indexOf('id="rgSave"'))),
     'the save handler splits it the same way the server does -- comma/newline, not bare whitespace');
  const saveAt = admin.indexOf("$('rgSave').addEventListener");
  const saveEnd = admin.indexOf('});', admin.indexOf('/admin/regions/save', saveAt));
  const saveBody = admin.slice(saveAt, saveEnd);
  ck(/networks:\s*\$\('rgNetworks'\)/.test(saveBody), "the save payload actually includes the typed networks");
}

console.log(bad ? `\n${bad} FAILED` : '\nregion networks: all cases pass');
process.exit(bad ? 1 : 0);
