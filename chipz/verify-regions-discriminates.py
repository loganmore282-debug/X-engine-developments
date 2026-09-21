#!/usr/bin/env python3
"""
Proves test-regions.js actually discriminates.

A test that passes is worth nothing until you have watched it fail for the
right reason. This re-breaks the region feature one way at a time -- each
mutation is a real bug somebody could plausibly introduce -- and requires
test-regions.js to EXIT NON-ZERO every time. Judged on the exit code only,
never on counting FAIL lines: a mutation that makes the harness crash before
it prints anything is still a detection, and a harness that prints "FAIL"
while exiting 0 is not.

Every file is restored after every mutation, and the suite refuses to run at
all unless the test passes on the untouched tree first.
"""
import subprocess, sys, os
from chipz_test_api import API  # anchors must name the CURRENT backend

ROOT = os.path.dirname(os.path.abspath(__file__))
SERVER = os.path.join(ROOT, 'server.js')
CLIENT = os.path.join(ROOT, 'user-src', 'original_module.js')
ADMIN = os.path.join(ROOT, 'admin-src', 'index.html')
# The built artifact, because test-brand-assets.js asserts on what SHIPS.
USERBUILT = os.path.join(ROOT, 'user', 'index.html')
SHELL = os.path.join(ROOT, 'user-src', 'index.html')


def read(p):
    with open(p, encoding='utf-8') as f:
        return f.read()


def write(p, s):
    with open(p, 'w', encoding='utf-8') as f:
        f.write(s)


def run_test():
    # Three harnesses, because the mutations below span all of them: the
    # region/country work is pinned by test-regions.js, the check-in money
    # path by test-checkin-idempotency.js, and the share card by
    # test-brand-assets.js. A mutation is detected if ANY of them fails.
    out = ''
    worst = 0
    for f in ('test-regions.js', 'test-checkin-idempotency.js', 'test-brand-assets.js',
              'test-languages.js'):
        r = subprocess.run(['node', f], cwd=ROOT, capture_output=True, text=True)
        out += r.stdout + r.stderr
        worst = worst or r.returncode
    return worst, out


# (label, file, old, new) -- `old` must appear exactly once.
MUTATIONS = [
    ('the region comes from the request, not the account', SERVER,
     """    if ((req.headers.authorization || '').startsWith('Bearer ')) {
      const uid = await verifyAuth(req);
      const key = uid ? await userRegionKey(uid) : null;
      if (key) region = regionByKey(key);
    }""",
     """    /* region taken from the hostname only */"""),

    ('the hostname wins over the account', SERVER,
     """    region = regionForHost(host);
    // A signed-in caller overrides the hostname with their own account's
    // region -- see the money-safety rule at the top of this section.
    if ((req.headers.authorization || '').startsWith('Bearer ')) {
      const uid = await verifyAuth(req);
      const key = uid ? await userRegionKey(uid) : null;
      if (key) region = regionByKey(key);
    }""",
     """    if ((req.headers.authorization || '').startsWith('Bearer ')) {
      const uid = await verifyAuth(req);
      const key = uid ? await userRegionKey(uid) : null;
      if (key) region = regionByKey(key);
    }
    region = regionForHost(host);"""),

    ('a new account is not stamped with its region', SERVER,
     "    regionKey: String(regionKey || currentRegionKey() || DEFAULT_REGION_KEY),\n",
     ""),

    ('a route reads the region out of the request body', SERVER,
     "      regionKey: currentRegionKey(),\n      date, time, createdAt: FieldValue.serverTimestamp()",
     "      regionKey: req.body.regionKey,\n      date, time, createdAt: FieldValue.serverTimestamp()"),

    ('a referral code from another currency is accepted', SERVER,
     """      if (refRegion !== myRegion) {
        const a = regionByKey(refRegion), b = regionByKey(myRegion);
        if (String(a.currency || '') !== String(b.currency || ''))""",
     """      if (false) {
        const a = regionByKey(refRegion), b = regionByKey(myRegion);
        if (String(a.currency || '') !== String(b.currency || ''))"""),

    ("one country's prices wipe every other country's", SERVER,
     "        batch.set(db.collection('products').doc(p.key), { key: p.key, ['regions.' + region.key]: over }, { merge: true });",
     "        batch.set(db.collection('products').doc(p.key), { key: p.key, regions: { [region.key]: over } }, { merge: true });"),

    ('a backend-wide setting can be set per country', SERVER,
     """      const offending = GLOBAL_ONLY_SETTINGS.filter(k => k in updates);
      if (offending.length)""",
     """      const offending = [];
      if (offending.length)"""),

    # Round 179b FLIPPED this mutation's direction. Before: maintenance mode
    # was backend-wide and "becomes per-country" was the bug to catch. Owner:
    # "some settings affect whole countries why?, see maintenance mode,
    # countdown, please make sure that everything is on its own" -- now it
    # IS per-country, and the bug to catch is the mutation reverting it.
    ('maintenance mode reverts to being backend-wide again', SERVER,
     "const GLOBAL_ONLY_SETTINGS = ['allowedOrigins', 'brandName', 'baseDomain', 'blockRootDomain', 'parkedHosts', 'strictRegionHosts', 'linkPreviewEnabled'];",
     "const GLOBAL_ONLY_SETTINGS = ['allowedOrigins', 'maintenanceMode', 'maintenanceMsg', 'openingCountdownEnabled', 'openingCountdownAt', 'brandName', 'baseDomain', 'blockRootDomain', 'parkedHosts', 'strictRegionHosts', 'linkPreviewEnabled'];"),

    ("the minimum cash-out stops being a country's own", SERVER,
     "const GLOBAL_ONLY_SETTINGS = ['allowedOrigins', 'brandName', 'baseDomain', 'blockRootDomain', 'parkedHosts', 'strictRegionHosts', 'linkPreviewEnabled'];",
     "const GLOBAL_ONLY_SETTINGS = ['allowedOrigins', 'brandName', 'baseDomain', 'blockRootDomain', 'parkedHosts', 'strictRegionHosts', 'linkPreviewEnabled', 'minWithdraw'];"),

    ('every country shares one settings document', SERVER,
     "  return String(key || DEFAULT_REGION_KEY) === DEFAULT_REGION_KEY ? 'main' : 'region-' + String(key);",
     "  return 'main';"),

    ('the server drops the dialling code from a login address', SERVER,
     "  return (regionUsesBareLocal(r) ? local : String(r.dialCode || '') + local) + '@chipz-platform.com';",
     "  return local + '@chipz-platform.com';"),

    ('the server puts a dialling code on Ugandan logins too', SERVER,
     "  return (regionUsesBareLocal(r) ? local : String(r.dialCode || '') + local) + '@chipz-platform.com';",
     "  return String(r.dialCode || '') + local + '@chipz-platform.com';"),

    ('the app drops the dialling code from a login address', CLIENT,
     "  return (bare ? local : dial() + local) + '@chipz-platform.com';",
     "  return local + '@chipz-platform.com';"),

    ('the app puts a dialling code on Ugandan logins too', CLIENT,
     "  return (bare ? local : dial() + local) + '@chipz-platform.com';",
     "  return dial() + local + '@chipz-platform.com';"),

    ('money is labelled UGX everywhere on the server', SERVER,
     "  return cur + ' ' + v.toLocaleString('en-UG', hasCents ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : {});",
     "  return 'UGX ' + v.toLocaleString('en-UG', hasCents ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : {});"),

    ('money is labelled UGX everywhere in the app', CLIENT,
     "  return cur() + ' ' + v.toLocaleString('en-UG', hasCents ? {minimumFractionDigits:2,maximumFractionDigits:2} : {});",
     "  return 'UGX ' + v.toLocaleString('en-UG', hasCents ? {minimumFractionDigits:2,maximumFractionDigits:2} : {});"),

    ('the cents formatter shaves a digit off a 4-character currency', CLIENT,
     "function fmtUGXCents(n){ return cur() + ' ' + moneyDigits2(n); }",
     "function fmtUGXCents(n){ return cur() + ' ' + fmtUGX2(n).slice(3); }"),

    ('a blank override becomes zero instead of inheriting', SERVER,
     "    if (over[f] === undefined || over[f] === null || over[f] === '') continue;",
     "    if (over[f] === undefined) continue;"),

    ("every country's prices leak to the client", SERVER,
     "  const { regions, ...rest } = p || {};\n  if (!over) return rest;",
     "  const rest = Object.assign({}, p || {});\n  if (!over) return rest;"),

    ('a country can rename a product for everyone', SERVER,
     "const PRODUCT_REGION_FIELDS = ['price', 'expectedReturn', 'multiplier', 'cycle', 'spinMin', 'spinMax', 'spinCount', 'active', 'comingSoon', 'openAt', 'openFrom', 'openTo'];",
     "const PRODUCT_REGION_FIELDS = ['price', 'expectedReturn', 'multiplier', 'cycle', 'spinMin', 'spinMax', 'spinCount', 'active', 'comingSoon', 'openAt', 'openFrom', 'openTo', 'name', 'image'];"),

    ("a country's price stops being its own", SERVER,
     "const PRODUCT_REGION_FIELDS = ['price', 'expectedReturn', 'multiplier', 'cycle', 'spinMin', 'spinMax', 'spinCount', 'active', 'comingSoon', 'openAt', 'openFrom', 'openTo'];",
     "const PRODUCT_REGION_FIELDS = ['multiplier', 'cycle', 'spinCount', 'comingSoon', 'openAt', 'openFrom', 'openTo'];"),

    ('the number prefix rule is ignored', SERVER,
     "  if (prefixes.length && !prefixes.some(p => local.startsWith(p))) return null;",
     "  void prefixes;"),

    ('a number of the wrong length is accepted', SERVER,
     "  if (s.length === len) return s;\n  return null;",
     "  return s;"),

    ('a country switched off still answers for its own address', SERVER,
     "  for (const r of _regionsSnapshot) if (r.active && regionHostnames(r).includes(h)) return r;",
     "  for (const r of _regionsSnapshot) if (regionHostnames(r).includes(h)) return r;"),

    ('the founding country can be switched off', SERVER,
     "    active: isDefault ? true : (raw && raw.active) !== false,",
     "    active: (raw && raw.active) !== false,"),

    ('a dialling code typed with a + is stored with it', SERVER,
     "  const digitsOnly = v => String(v == null ? '' : v).replace(/\\D/g, '');",
     "  const digitsOnly = v => String(v == null ? '' : v).trim();"),

    ('a UTC country is silently moved to +3', SERVER,
     "    utcOffsetMin: Number.isFinite(off) ? Math.round(off) : (base.utcOffsetMin != null ? base.utcOffsetMin : 180),",
     "    utcOffsetMin: Math.round(off) || (base.utcOffsetMin != null ? base.utcOffsetMin : 180),"),

    ('auto-approval applies one country’s rules to every member', SERVER,
     "      if (String(wit.regionKey || DEFAULT_REGION_KEY) !== regionKey) continue; // another region's rules apply\n",
     ""),

    ('a payment number is offered to every country', SERVER,
     "      .filter(d => String(d.data().regionKey || DEFAULT_REGION_KEY) === regionKey)\n",
     ""),

    ("a maturity payout is described in the wrong country's currency", SERVER,
     """async function settleInvestmentIfDue(doc) {
  return withUserRegion(doc && doc.data() && doc.data().userId, () => _settleDueInvestmentNow(doc));
}""",
     """async function settleInvestmentIfDue(doc) {
  return _settleDueInvestmentNow(doc);
}"""),

    ("a deposit is credited with the wrong country's label", SERVER,
     """async function creditDeposit(depDoc) {
  return withUserRegion(depDoc && depDoc.data() && depDoc.data().userId, () => _creditDepositNow(depDoc));
}""",
     """async function creditDeposit(depDoc) {
  return _creditDepositNow(depDoc);
}"""),

    ('the app is never told the region', SERVER,
     "    }, region: publicRegionView(), regionCount: (await getRegions()).filter(r => r.active).length });",
     "    } });"),

    ("the app ignores the member's own region", CLIENT,
     "  applyRegion(r.region);\n",
     ""),

    ('the app decides its own region and tells the server', CLIENT,
     "function post(path, body){ return api(path, { method: 'POST', body: JSON.stringify(body || {}) }); }",
     "function post(path, body){ return api(path, { method: 'POST', body: JSON.stringify(Object.assign({ regionKey: REGION.key }, body || {})) }); }"),

    ('a cold start forgets the region and flashes the wrong currency', CLIENT,
     "  try { localStorage.setItem('chipzRegion', JSON.stringify(REGION)); } catch(_){}",
     "  /* not remembered */"),

    ('a parked address is CORS-refused, so it cannot read its own refusal', SERVER,
     "  const all = _mainAllowedHosts.concat(_regionHosts, _parkedHosts, _baseDomain ? [_baseDomain, 'www.' + _baseDomain] : []);",
     "  const all = _mainAllowedHosts.concat(_regionHosts);"),

    ('the root domain serves the app after all', SERVER,
     "  if (_blockRootDomain && _baseDomain && (h === _baseDomain || h === 'www.' + _baseDomain)) return true;",
     '  void _blockRootDomain;'),

    ('www is left serving the app', SERVER,
     "  if (_blockRootDomain && _baseDomain && (h === _baseDomain || h === 'www.' + _baseDomain)) return true;",
     '  if (_blockRootDomain && _baseDomain && h === _baseDomain) return true;'),

    ("the platform's own Render address gets parked, locking the owner out", SERVER,
     '  if (isInfraHost(h)) return false;',
     '  void isInfraHost;'),

    ('a webhook with no Origin gets refused, losing a payment', SERVER,
     '  if (!h) return false;\n  if (isInfraHost(h)) return false;',
     '  if (isInfraHost(h)) return false;'),

    ('a retired address keeps working', SERVER,
     '  if (_parkedHosts.includes(h)) return true;',
     '  void _parkedHosts;'),

    ('a parked address is refused by CORS instead, so the app cannot say why', SERVER,
     "    status: 'error', code: 'HOST_PARKED',",
     "    status: 'error', code: 'FORBIDDEN',"),

    ('the payment webhooks lose their exemption from the domain rule', SERVER,
     'app.use((req, res, next) => {\n  if (GUARD_EXEMPT.has(req.path)) return next();\n  const store = _regionCtx.getStore();',
     'app.use((req, res, next) => {\n  const store = _regionCtx.getStore();'),

    ('the app ignores the parked answer and shows a broken screen instead', CLIENT,
     "  if (data && data.code === 'HOST_PARKED') { showHostParked(data.message); return data; }",
     '  /* parked answer ignored */'),

    ('the parked notice sits behind a spinner that never stops', CLIENT,
     "    const ls = $('loadingScreen'); if (ls) ls.style.display = 'none';",
     '    /* loading screen left up */'),

    ('a short address stops resolving against the base domain', SERVER,
     "  for (const l of (r.labels || [])) if (_baseDomain) hosts.push(l + '.' + _baseDomain);",
     '  void _baseDomain;'),

    ('short addresses are dropped from the region model', SERVER,
     '    labels: labels.filter((l, i) => labels.indexOf(l) === i),',
     '    labels: [],'),

    ('www becomes a usable country address', SERVER,
     "    .filter(l => l && l.length <= 40 && l !== 'www' && !l.startsWith('-') && !l.endsWith('-'));",
     '    .filter(Boolean);'),

    ('a country address is no longer allowed to reach the backend', SERVER,
     '  for (const r of _regionsSnapshot) for (const h of regionHostnames(r)) _regionHosts.push(h);',
     '  /* region hosts not collected */'),

    ('a generated address can collide with another country', SERVER,
     '    for (const r of regions) for (const l of (r.labels || [])) taken.add(l);',
     '    for (const l of (region.labels || [])) taken.add(l);'),

    ('a generated address replaces the ones already shared with members', SERVER,
     '    const next = normalizeRegion(Object.assign({}, region, { labels: (region.labels || []).concat(made) }), key);',
     '    const next = normalizeRegion(Object.assign({}, region, { labels: made }), key);'),

    ('generated addresses use characters that get misread off a screen', SERVER,
     "const LABEL_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';",
     "const LABEL_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';"),

    ('a generated address is predictable', SERVER,
     '      const cand = randFromAlphabet(LABEL_ALPHABET, len).toLowerCase();',
     "      const cand = Array.from({length: len}, () => LABEL_ALPHABET[Math.floor(Math.random() * LABEL_ALPHABET.length)]).join('');"),

    ('a mistyped base domain is stored instead of refused', SERVER,
     "    if ('baseDomain' in updates) {\n      const r = normalizeAllowedHost(updates.baseDomain);",
     '    if (false) {\n      const r = normalizeAllowedHost(updates.baseDomain);'),

    ('the retired list skips its validator', SERVER,
     '      const r = sanitizeAllowedOrigins(updates.parkedHosts);',
     '      const r = { hosts: updates.parkedHosts };'),

    ('the host rules take up to a minute to apply', SERVER,
     '      try { refreshHostPolicy(await getSettings(DEFAULT_REGION_KEY)); } catch (_) {}',
     '      /* not applied until the cache expires */'),

    ('the host rules become per-country settings', SERVER,
     "const GLOBAL_ONLY_SETTINGS = ['allowedOrigins', 'brandName', 'baseDomain', 'blockRootDomain', 'parkedHosts', 'strictRegionHosts', 'linkPreviewEnabled'];",
     "const GLOBAL_ONLY_SETTINGS = ['allowedOrigins', 'brandName', 'linkPreviewEnabled'];"),

    ('the two host switches stop being coerced to booleans', SERVER,
     "'requireReferralCode', 'withdrawWindowEnabled', 'blockRootDomain', 'strictRegionHosts'];",
     "'requireReferralCode', 'withdrawWindowEnabled'];"),

    ('a typed address with a bad character is silently repaired', SERVER,
     '        return res.status(400).json({ status: \'error\', message: `"${t}" is not a usable address. Use lowercase letters, digits and dashes only, not starting or ending with a dash.` });',
     '        void t;'),

    ('the panel loses its short-address field', ADMIN,
     "      labels: $('rgLabels').value.split(/[\\s,\\n]+/).filter(Boolean),",
     '      labels: (cur.labels || []),'),

    ('the panel cannot generate an address', ADMIN,
     "  const d = await api('/admin/regions/add-label', { key, count: Math.max(1, Number(count) || 1) });",
     "  const d = { status: 'error', message: 'disabled' };"),

    ('the host rules lose their card in Settings', ADMIN,
     "      baseDomain:$('sBaseDomain').value.trim(), blockRootDomain:$('sBlockRoot').checked,\n      strictRegionHosts:$('sStrictHosts').checked, parkedHosts:$('sParkedHosts').value,",
     '      /* host rules not sent */'),

    ("a deleted country's rates are left behind to haunt the next one", SERVER,
     "    try { await db.collection('settings').doc(settingsDocId(key)).delete(); } catch (_) {}",
     "    /* settings document left behind */"),

    ("a deleted country's product prices are left behind", SERVER,
     "          batch.update(d.ref, { ['regions.' + key]: FieldValue.delete() });",
     "          batch.update(d.ref, { key: d.data().key });"),

    ('a country with members signed up in it can be deleted', SERVER,
     "    const members = await db.collection('users').where('regionKey', '==', key).limit(51).get();",
     "    const members = { empty: true };"),

    ('the panel sends a backend-wide setting with a country’s rates, failing the whole save', ADMIN,
     "      for (const k of ADMIN_GLOBAL_ONLY) delete body.settings[k];",
     "      void ADMIN_GLOBAL_ONLY;"),

    ('the panel and the server disagree about which settings are backend-wide', ADMIN,
     "const ADMIN_GLOBAL_ONLY = ['allowedOrigins', 'brandName', 'baseDomain', 'blockRootDomain', 'parkedHosts', 'strictRegionHosts', 'linkPreviewEnabled'];",
     "const ADMIN_GLOBAL_ONLY = ['allowedOrigins', 'brandName'];"),

    ('the picked country is no longer stamped on admin reads', ADMIN,
     "      if (REGION_SCOPED_READS.includes(path)) path += '?region=' + encodeURIComponent(one);",
     "      if (false) path += '?region=' + encodeURIComponent(one);"),

    ('an admin list labels every row in the panel’s own currency', ADMIN,
     "function ugx(n, regionKey){",
     "function ugx(n, ignoredRegionKey){ const regionKey = undefined;"),

    # OBSOLETE, deleted not re-anchored: this was the per-tab picker's own
    # "hide me with one country" guard. The one topbar switch has its own,
    # and its own mutation ("the switch is shown even with only one
    # country") -- which is now PROVED BY RUNNING the switch rather than by
    # matching this line.

    ("a country's own web address is not allowed to reach the backend", SERVER,
     """  _regionHosts = [];
  for (const r of _regionsSnapshot) for (const h of regionHostnames(r)) _regionHosts.push(h);
  refreshCorsSnapshot();""",
     """  /* region hosts not folded into the CORS allowlist */"""),

    # ── moving an arrival onto a different address in his own country ──
    ('a visitor is sent back to the address he is already on', SERVER,
     "      .filter(h => h && h !== from);",
     "      .filter(h => h);"),

    ('the address the app says it is on is ignored', SERVER,
     "    const from = hostOnly(req.query.from || '') || host;",
     "    const from = host;"),

    ('the owner testing on a service host gets bounced onto a live address', SERVER,
     "    if (isInfraHost(host)) return res.json(stay);\n",
     ""),

    ('a signed-in member is moved in visitors mode', SERVER,
     "    if (mode !== 'always' && (req.headers.authorization || '').startsWith('Bearer ')) {",
     "    if (false && (req.headers.authorization || '').startsWith('Bearer ')) {"),

    ('the signed-in test is inverted', SERVER,
     "      if (uid) return res.json(stay);",
     "      if (!uid) return res.json(stay);"),

    ('a country with no other address hands out nothing at all', SERVER,
     "      .filter(h => h && h !== from);\n    if (!pool.length) return res.json(stay);\n",
     "      .filter(h => h && h !== from);\n"),

    ('the mode is read from the founding country instead of this one', SERVER,
     "    const sett = await getSettings(region.key);",
     "    const sett = await getSettings(DEFAULT_REGION_KEY);"),

    ('the pool is not built from this country own address list', SERVER,
     "    const pool = (region.labels || [])\n      .map(l => (_baseDomain ? l + '.' + _baseDomain : ''))\n      .filter(h => h && h !== from);",
     "    const pool = (region.hosts || [])\n      .filter(h => h && h !== from);"),

    ('a failed settings read stops the app loading', SERVER,
     "    res.json({ status: 'success', rotate: false, mode: 'off', host: '' });\n  }",
     "    res.status(500).json({ status: 'error', message: 'entry failed' });\n  }"),

    ('a mistyped mode is quietly turned into off instead of refused', SERVER,
     """      if (!ROTATE_ENTRY_MODES.includes(mode))
        return res.status(400).json({ status: 'error', message: 'Moving arrivals to another address must be off, visitors, or always.' });
      updates.rotateEntry = mode;""",
     """      updates.rotateEntry = ROTATE_ENTRY_MODES.includes(mode) ? mode : 'off';"""),

    ('the mode becomes backend-wide, so every country shares one answer', SERVER,
     "'parkedHosts', 'strictRegionHosts', 'linkPreviewEnabled'];",
     "'parkedHosts', 'strictRegionHosts', 'linkPreviewEnabled', 'rotateEntry'];"),

    ('the mode has no default, so a country never asked is undefined', SERVER,
     "  rotateEntry: 'off',\n",
     ""),

    ('several addresses at once is uncapped', SERVER,
     "    const want = Math.min(24 - held, Math.max(1, Math.round(Number(req.body.count)) || 1));",
     "    const want = Math.max(1, Math.round(Number(req.body.count)) || 1);"),

    ('a batch can mint the same address twice', SERVER,
     "      taken.add(label);\n",
     ""),

    ('only the first of a batch comes back', SERVER,
     "    res.json({ status: 'success', label: made[0], labels: made, host: hostOf(made[0]), hosts: made.map(hostOf), region: next });",
     "    res.json({ status: 'success', label: made[0], host: hostOf(made[0]), region: next });"),

    ('the loop guard is gone, so every landing hops again', CLIENT,
     "  if (entryAlreadyMoved()) return false;\n",
     ""),

    ('the marker is left in the address bar for a member to share', CLIENT,
     "    url.searchParams.delete(ENTRY_MOVE_PARAM);",
     "    /* marker left in the URL */"),

    ('the marker in the URL is never read, so only per-origin storage guards the loop', CLIENT,
     "  if (url.searchParams.get(ENTRY_MOVE_PARAM)) {",
     "  if (false) {"),

    ('the old address stays in the back stack', CLIENT,
     "  try { location.replace(target); } catch (_) { location.href = target; }",
     "  try { location.assign(target); } catch (_) { location.href = target; }"),

    ('the app own signed-in check is gone, so a returning member is moved', CLIENT,
     """  if (r.mode !== 'always') {
    let hasAccountHere = false;
    try { hasAccountHere = !!localStorage.getItem(CACHED_STATE_KEY); } catch (_) {}
    if (hasAccountHere) return false;
  }""",
     """  /* trusting the server own signed-in check */"""),

    ('the path, ref code and hash are dropped on the hop', CLIENT,
     "    url.hostname = r.host;",
     "    url.pathname = '/'; url.hash = ''; url.hostname = r.host;"),

    ('the hop is put in front of the loading screen', CLIENT,
     "var _entryPromise = maybeRotateEntry();\nvar _bootPromise = boot();",
     "var _bootPromise = boot();\nvar _entryPromise = maybeRotateEntry();"),

    ('the panel never sends the mode it shows as saved', ADMIN,
     "      rotateEntry:$('sRotateEntry').value,\n",
     ""),

    ('the panel offers no way to mint a pool in one tap', ADMIN,
     '        <button class="btn sm ghost" data-gen-region="${esc(r.key)}" data-gen-count="5" title="Mint five at once -- what moving arrivals between addresses needs">+ 5</button>\n',
     ""),

    ('the parked notice can be covered by the app a moment later', CLIENT,
     """    const st = document.createElement('style');
    st.textContent = '#loadingScreen,#app,#authScreen{display:none !important}';
    document.head.appendChild(st);""",
     """    /* the one-off inline hide above is all there is */"""),

    ('the sticky rule stops covering the spinner', CLIENT,
     "    st.textContent = '#loadingScreen,#app,#authScreen{display:none !important}';",
     "    st.textContent = '#app,#authScreen{display:none !important}';"),

    ('the sticky rule stops covering the sign-in screen', CLIENT,
     "st.textContent = '#loadingScreen,#app,#authScreen{display:none !important}';",
     "st.textContent = '#loadingScreen,#app{display:none !important}';"),

    # ── the reported login lockout, the lying chip, referrals, per-country admin ──
    ('the login address goes back to depending on the region id', SERVER,
     "  return String(r.dialCode || '') === String(founding.dialCode || '');",
     "  return !!r.isDefault;"),

    ('the app is left to guess the login-address shape', SERVER,
     "    usesBareLocal: regionUsesBareLocal(reg),\n",
     ""),

    ('the founding country loses its migration fallback, locking members out', CLIENT,
     "  if (bare) list.push(loginAddressFor(phone, false));\n",
     ""),

    # THE BUG CODEX FOUND IN MY CODE. A non-founding country trying the bare
    # local address reaches into the FOUNDING country's namespace: the same
    # local digits can resolve to another country's Firebase user whenever the
    # password happens to match. My own assertion had an `|| ugAddr ===
    # cands[1]` escape hatch that exempted exactly this.
    ('a dial-code country reaches into the founding bare-local namespace', CLIENT,
     "  if (bare) list.push(loginAddressFor(phone, false));",
     "  list.push(loginAddressFor(phone, !bare));"),

    ('sign-in reports success after every address failed', CLIENT,
     "    if (lastErr) throw lastErr;\n",
     ""),

    ('a throttled sign-in burns the second address too', CLIENT,
     "        if (code !== 'auth/invalid-credential' && code !== 'auth/wrong-password' && code !== 'auth/user-not-found') break;",
     "        /* keep trying whatever went wrong */"),

    ('the login screen ignores the candidate addresses', CLIENT,
     "    const tries = loginAddressCandidates(phone);",
     "    const tries = [phoneToEmail(phone)];"),

    ('the dialling-code chips go back to static text', SHELL,
     '<span class="prefix" id="loginDial">+256</span>',
     '<span class="prefix">+256</span>'),

    ('the chips are never painted from the region', CLIENT,
     "    for (const id of ['loginDial', 'regDial']) { const el = $(id); if (el) el.textContent = d; }",
     "    /* chips left as they were rendered */"),

    ('the region arrives without repainting the screen', CLIENT,
     # Re-anchored in Round 163: applyRegion now ends with two calls, not
     # one, so the old anchor (paintRegionChrome immediately before the
     # closing brace) no longer exists.
     "  paintRegionChrome();\n  applyRegionLanguages();\n}",
     "  applyRegionLanguages();\n}"),

    ('the country count is set after the repaint, so the line stays hidden', CLIENT,
     "  if (s.status === 'success') { STATE.regionCount = s.regionCount; applyRegion(s.region); }",
     "  if (s.status === 'success') { applyRegion(s.region); STATE.regionCount = s.regionCount; }"),

    ('referral codes are refused across region ids again', SERVER,
     "        if (String(a.currency || '') !== String(b.currency || ''))",
     "        if (true)"),

    ('a referral code from a different currency is accepted', SERVER,
     """      if (refRegion !== myRegion) {
        const a = regionByKey(refRegion), b = regionByKey(myRegion);""",
     """      if (false) {
        const a = regionByKey(refRegion), b = regionByKey(myRegion);"""),

    ('the admin filter ignores the query string', SERVER,
     "  const raw = String((req.query && req.query.region) || (req.body && req.body.region) || '').trim().toLowerCase();",
     "  const raw = String((req.body && req.body.region) || '').trim().toLowerCase();"),

    ('an unfiltered admin call silently narrows to the founding country', SERVER,
     "  if (!raw || raw === 'all') return null;",
     "  if (!raw) return DEFAULT_REGION_KEY;\n  if (raw === 'all') return null;"),

    ('a legacy row with no country is not placed by its member', SERVER,
     "  const viaUser = (userRegions && row && row.userId) ? userRegions.get(row.userId) : null;\n  return viaUser || DEFAULT_REGION_KEY;",
     "  return DEFAULT_REGION_KEY;"),

    ('a row carrying its own country is overridden by the member', SERVER,
     """  const own = String((row && row.regionKey) || '').trim().toLowerCase();
  if (own) return own;
  const viaUser = (userRegions && row && row.userId) ? userRegions.get(row.userId) : null;
  return viaUser || DEFAULT_REGION_KEY;""",
     """  const viaUser = (userRegions && row && row.userId) ? userRegions.get(row.userId) : null;
  if (viaUser) return viaUser;
  return String((row && row.regionKey) || '').trim().toLowerCase() || DEFAULT_REGION_KEY;"""),

    ('the dashboard stops being per-country', SERVER,
     "    const mine = row => !want || rowRegionKey(row, userRegions) === want;\n    const moneyByRegion = new Map();",
     "    const mine = () => true;\n    const moneyByRegion = new Map();"),

    ('the members list stops being per-country', SERVER,
     "    }).filter(u => !want || u.regionKey === want);",
     "    });"),

    ('the referrals list stops being per-country', SERVER,
     "    const rows = want ? all.filter(r => r.regionKey === want) : all;",
     "    const rows = all;"),

    ('the records list stops being per-country', SERVER,
     "    const transactions = scopeRowsToRegion(raw, want, want ? await adminUserRegions() : null);",
     "    const transactions = raw;"),

    ('the recharge totals describe every country while the rows describe one', SERVER,
     """    const scoped = scopeRowsToRegion(rows, want, userRegions);
    rows.length = 0; rows.push(...scoped);
    rows.forEach(r => { r.accountPhone = phones[r.userId] || ''; r.referralCode = refCodes[r.userId] || ''; counts[r.status || 'unknown'] = (counts[r.status || 'unknown'] || 0) + 1; });""",
     """    rows.forEach(r => { r.accountPhone = phones[r.userId] || ''; r.referralCode = refCodes[r.userId] || ''; counts[r.status || 'unknown'] = (counts[r.status || 'unknown'] || 0) + 1; });"""),

    ('a truncated records page is called complete once filtered', SERVER,
     """    const truncated = raw.length >= TX_ADMIN_LIST_LIMIT;
    const want = adminRegionFilter(req);
    const transactions = scopeRowsToRegion(raw, want, want ? await adminUserRegions() : null);
    res.json({ status: 'success', transactions, truncated, regionKey: want || 'all' });""",
     """    const want = adminRegionFilter(req);
    const transactions = scopeRowsToRegion(raw, want, want ? await adminUserRegions() : null);
    res.json({ status: 'success', transactions, truncated: transactions.length >= TX_ADMIN_LIST_LIMIT, regionKey: want || 'all' });"""),

    ('the panel only stamps the country when it is not Uganda', ADMIN,
     "  if (REGION_FILTERED_READS.includes(path)) path += '?region=' + encodeURIComponent(ADMIN_REGION || 'all');",
     "  if (REGION_FILTERED_READS.includes(path) && ADMIN_REGION !== 'ug') path += '?region=' + encodeURIComponent(ADMIN_REGION || 'all');"),

    ('the POST-shaped screens lose their country stamp', ADMIN,
     "  else if (REGION_FILTERED_WRITES.includes(path)) body = Object.assign({ region: ADMIN_REGION || 'all' }, body || {});",
     "  else if (false) body = Object.assign({ region: ADMIN_REGION || 'all' }, body || {});"),

    # OBSOLETE: the switch is no longer injected into a tab after it paints
    # -- it lives in the topbar, outside #content, so a render cannot remove
    # it. "the country switch is gone from the panel" replaces this.

    # OBSOLETE for the same reason: a live refresh rebuilds #content, and
    # the switch is not in it. Nothing observable breaks by removing the
    # repaint on tick, so no honest assertion can fail on it -- and this file
    # already records that a mutation which cannot fail for the right reason
    # should be deleted, not propped up.

    ('All countries snaps back to Uganda on every region reload', ADMIN,
     "    if (ADMIN_REGION !== 'all' && !ADMIN_REGIONS.some(x => x.key === ADMIN_REGION)) {",
     "    if (!ADMIN_REGIONS.some(x => x.key === ADMIN_REGION)) {"),

    ('Settings is edited under an All-countries label', ADMIN,
     "    const one = (!ADMIN_REGION || ADMIN_REGION === 'all') ? 'ug' : ADMIN_REGION;",
     "    const one = ADMIN_REGION;"),

    # DELETED as obsolete, not re-anchored: this described the per-tab
    # picker's own caption, and that picker no longer exists -- the one
    # topbar switch carries the warning now, and its own mutation ("an
    # All-countries view stops warning that its totals mix currencies")
    # replaces this one exactly.

    ('the address checker stops naming the wrong-base-domain cause', SERVER,
     "        reasons.push(`It is not under the base domain, which is set to \"${_baseDomain}\". Short addresses are built as <short name>.${_baseDomain}, so an address on any other domain can never match one.`);",
     "        reasons.push('It does not match a country.');"),

    ('the address checker stops showing the login address it would use', SERVER,
     "      loginExample: phoneToEmail('0700000000', resolved),\n",
     ""),

    ('the panel stops warning that the base domain is not its own domain', ADMIN,
     "function baseDomainWarningHtml(){",
     "function baseDomainWarningHtml(){ if (1) return '';"),

    ('the base-domain warning fires on the platform own hosts', ADMIN,
     "  if (/\\.(onrender\\.com|edgeone\\.app|edgeone\\.site|edgeone\\.dev|pages\\.dev)$/.test(h)) return '';",
     "  /* platform hosts treated as the members' domain */"),

    ('there is no one-tap base-domain fix', ADMIN,
     "    <div style=\"margin-top:10px\"><button class=\"btn sm\" id=\"useThisDomainBtn\">Use ${esc(own)} as the base domain</button></div>",
     ""),

    ('the app drops the published login-address shape on the floor', CLIENT,
     # Re-anchored in Round 163 (languages/defaultLang) and again when the
     # networks field was added -- the whitelist keeps growing.
     "'utcOffsetMin','isDefault','usesBareLocal','languages','defaultLang','networks']",
     "'utcOffsetMin','isDefault','languages','defaultLang','networks']"),

    # ── every subdomain refused by the backend, so nothing loaded at all ──
    ('a generated subdomain is refused by the backend again', SERVER,
     "  return _corsExtraHosts.some(d => h === d || h.endsWith('.' + d));",
     "  return _corsExtraHosts.includes(h);"),

    ('the subdomain rule drops the dot, admitting lookalike domains', SERVER,
     "  return _corsExtraHosts.some(d => h === d || h.endsWith('.' + d));",
     "  return _corsExtraHosts.some(d => h === d || h.endsWith(d));"),

    ('the CORS check goes back to exact hostnames', SERVER,
     "      if (corsHostAllowed(h)) return cb(null, true);",
     "      if (_corsExtraHosts.includes(h)) return cb(null, true);"),

    ('strict mode parks a domain the owner allowed himself', SERVER,
     "  if (_strictRegionHosts && !_regionHosts.includes(h) && !_mainAllowedHosts.includes(h)) return true;",
     "  if (_strictRegionHosts && !_regionHosts.includes(h)) return true;"),

    ('strict mode stops refusing unclaimed addresses at all', SERVER,
     "  if (_strictRegionHosts && !_regionHosts.includes(h) && !_mainAllowedHosts.includes(h)) return true;\n  return false;",
     "  return false;"),

    ('the address checker stops saying whether it can reach the backend', SERVER,
     "    const reachable = corsHostAllowed(host) || isInfraHost(host);",
     "    const reachable = true;"),

    ('the country and currency are put back in front of members', CLIENT,
     "      el.textContent = '';\n      el.style.display = 'none';",
     "      el.textContent = regionName() + ' · ' + cur();\n      el.style.display = '';"),

    # ── the invite link carries a random address of the member's own country ──
    ('the invite link stops rotating and names one address forever', SERVER,
     "    res.json({ status: 'success', host: shuffled[0], hosts: shuffled, count: shuffled.length });",
     "    res.json({ status: 'success', host: pool[0], hosts: [pool[0]], count: 1 });"),

    ('the invite link can carry another country address', SERVER,
     "    const pool = (region.labels || [])\n      .map(l => (_baseDomain ? l + '.' + _baseDomain : ''))\n      .filter(Boolean);\n    if (!pool.length) return res.json(stay);",
     "    const pool = ['other-country.example.test'];\n    if (!pool.length) return res.json(stay);"),

    ('a failed share-host read costs the member his invite link', SERVER,
     "  } catch (e) { res.json(stay); }\n});\n// Members must never be shown a payout",
     "  } catch (e) { res.status(500).json({ status: 'error' }); }\n});\n// Members must never be shown a payout"),

    # OBSOLETE: there is no single "pick" any more -- the handler shuffles
    # the whole pool, and "the pool is shuffled with Math.random instead of
    # the CSPRNG" below replaces this exactly.


    ('the invite link goes back to the address he is browsing on', CLIENT,
     "  const link = code ? `${shareOrigin()}/?ref=${encodeURIComponent(code)}` : '';",
     "  const link = code ? `${location.origin}/?ref=${encodeURIComponent(code)}` : '';"),

    ('the rotated address is never fetched', CLIENT,
     "  const shareReady = refreshShareHost();",
     "  const shareReady = Promise.resolve();"),

    ('the screen does not repaint when the stats call fails, so the new address is never shown', CLIENT,
     "  const [r] = await Promise.all([ api('/team/stats'), shareReady ]);\n  if (r.status === 'success') STATE.teamStats = r;",
     "  const [r] = await Promise.all([ api('/team/stats'), shareReady ]);\n  if (r.status !== 'success') return;\n  STATE.teamStats = r;"),

    ('an empty pick blanks the invite link instead of falling back', CLIENT,
     "  return h ? (location.protocol + '//' + h) : location.origin;",
     "  return location.protocol + '//' + h;"),

    # ── the invite link shape, and the link preview ──
    ('the invite link goes back to a path that 404s unless a rewrite exists', CLIENT,
     "  const link = code ? `${shareOrigin()}/?ref=${encodeURIComponent(code)}` : '';",
     "  const link = code ? `${shareOrigin()}/refCode=${encodeURIComponent(code)}` : '';"),

    ('the app stops reading the older /refCode= links already sent to people', CLIENT,
     "      const m = /\\/refCode=([^/?#]+)/.exec(location.pathname);",
     "      const m = null;"),

    ('the app stops reading the ?ref= links it now hands out', CLIENT,
     "    let ref = search.get('ref');",
     "    let ref = null;"),

    # ── the dashboard totals: complete, or visibly flagged ──
    ('the dashboard pulls unbounded collections into memory again', SERVER,
     "      db.collection('users').limit(STATS_SCAN_LIMIT).get(),",
     "      db.collection('users').get(),"),

    ('the pending counts lose their ceiling', SERVER,
     "      db.collection('pendingDeposits').where('status', 'in', ['pending', 'initiating', 'review']).limit(STATS_SCAN_LIMIT).get(),",
     "      db.collection('pendingDeposits').where('status', 'in', ['pending', 'initiating', 'review']).get(),"),

    ('a capped dashboard total claims to be complete', SERVER,
     "      .some(snap => snap.docs.length >= STATS_SCAN_LIMIT);",
     "      .some(() => false);"),

    # Anchored with the NEXT line too: a second route now ends with the same
    # `truncated,` field, so the bare line matched twice and aborted the run.
    ('the reply stops carrying the truncation flag', SERVER,
     "      status: 'success', regionKey: want || 'all', truncated,\n      moneyByRegion:",
     "      status: 'success', regionKey: want || 'all',\n      moneyByRegion:"),

    ('the panel hides the incomplete-totals warning', ADMIN,
     "  const truncWarn = s.truncated ? `<div style=",
     "  const truncWarn = false ? `<div style="),

    # ── the daily check-in: one day, one credit ──
    # Audit finding, CONFIRMED: eligibility was rebuilt from the LEDGER while
    # the claim was written to the USER DOCUMENT, so a ledger write that
    # failed after the money landed let the retry credit the same day again.
    ('the check-in gate reads only the ledger, not the durable claim', SERVER,
     "      if (claimDay === todayKey || lastKey === todayKey) {",
     "      if (lastKey === todayKey) {"),

    ('the check-in claim is not written with the money', SERVER,
     """      const applied = await withLock('bal:' + uid, () => ref.updateIf(
        { lastCheckinClaimDay: { $ne: todayKey } },
        {
          walletBalance: FieldValue.increment(bonus), totalEarned: FieldValue.increment(bonus),
          lastCheckinAt: now, checkinStreak: streak, lastCheckinClaimDay: todayKey,
        }
      ));""",
     """      const applied = await withLock('bal:' + uid, () => ref.update({
        walletBalance: FieldValue.increment(bonus), totalEarned: FieldValue.increment(bonus),
        lastCheckinAt: now, checkinStreak: streak,
      }).then(() => true));"""),

    ('a concurrent check-in is no longer refused by the conditional write', SERVER,
     "      if (!applied) {\n        result = { code: 400, body: { status: 'error', message: 'Already checked in today. Come back after midnight.', nextCheckinAt: eatNextMidnight(now) } };\n        return;\n      }",
     "      if (!applied) { /* proceed anyway */ }"),

    ('the check-in ledger row gets a random id, so it cannot be repaired', SERVER,
     """        await db.collection('transactions').doc(`checkin:${uid}:${todayKey}`).createIfAbsent({
          userId: uid, type: 'checkin', description: `Daily check-in, day ${streak}`,
          amount: bonus, status: 'success', date, time, createdAt: FieldValue.serverTimestamp()
        });""",
     """        await db.collection('transactions').add({
          userId: uid, type: 'checkin', description: `Daily check-in, day ${streak}`,
          amount: bonus, status: 'success', date, time, createdAt: FieldValue.serverTimestamp()
        });"""),

    ('a failed check-in ledger write rolls the claim back, re-opening the double credit', SERVER,
     """      } catch (ledgerErr) {
        console.error(`MONEY-SAFETY: check-in bonus ${bonus} credited to ${uid} for ${todayKey} but its transaction row failed; the claim stands to prevent a double credit.`, ledgerErr.message);
      }""",
     """      } catch (ledgerErr) {
        await ref.update({ lastCheckinClaimDay: null }).catch(() => {});
        throw ledgerErr;
      }"""),

    ('the missing check-in ledger row is never repaired, so the streak breaks', SERVER,
     """          await db.collection('transactions').doc(`checkin:${uid}:${todayKey}`).createIfAbsent({
            userId: uid, type: 'checkin', description: `Daily check-in, day ${u.checkinStreak || 1}`,""",
     """          await db.collection('transactions').doc(`skip:${uid}:${todayKey}`).createIfAbsent({
            userId: uid, type: 'noop', description: `Daily check-in, day ${u.checkinStreak || 1}`,"""),
    # ── Round 161: the link preview, and one country switch everywhere ──
    ('the link preview goes back to 404ing until something is uploaded', SERVER,
     "'link-preview': { mime: 'image/jpeg', w: 1200, h: 630, max: 900 * 1024, file: 'link-preview.jpg' }",
     "'link-preview': { mime: 'image/jpeg', w: 1200, h: 630, max: 900 * 1024, file: null }"),
    ('the share card is a static file again, so an upload changes nothing', USERBUILT,
     f'<meta property="og:image" content="{API}/public/link-preview.jpg">',
     '<meta property="og:image" content="https://chipz-app.example/link-preview.jpg">'),
    ('twitter keeps pointing at the old static file', USERBUILT,
     f'<meta name="twitter:image" content="{API}/public/link-preview.jpg">',
     '<meta name="twitter:image" content="https://chipz-app.example/link-preview.jpg">'),
    ('a gift code stops being stamped with a country', SERVER,
     "    const regionKey = adminRegionFilter(req) || 'all';\n    const doc = {",
     "    const regionKey = 'all';\n    const doc = {"),
    ('a gift code from another country can be claimed', SERVER,
     'if (!giftCodeInRegion(cd, currentRegionKey())) {',
     'if (false) {'),
    ('a legacy code with no country stops working anywhere', SERVER,
     "  return String((c && c.regionKey) || '').trim().toLowerCase() || 'all';",
     "  return String((c && c.regionKey) || '').trim().toLowerCase() || 'nowhere';"),
    ('the gift code list stops being per country', SERVER,
     'codes: snap.docs.filter(d => giftCodeInRegion(d.data(), want)).map(d => {',
     'codes: snap.docs.map(d => {'),
    ('a code row no longer says which country it is for', SERVER,
     'maxUses: c.maxUses || null, uses, totalClaimed, regionKey: giftCodeRegion(c),',
     'maxUses: c.maxUses || null, uses, totalClaimed,'),
    ("a reward figure is labelled in the panel's currency, not the code's", ADMIN,
     'const rewardCol = c.minReward===c.maxReward ? ugx(c.minReward, cCur) : `${ugx(c.minReward, cCur)} – ${ugx(c.maxReward, cCur)}`;',
     'const rewardCol = c.minReward===c.maxReward ? ugx(c.minReward) : `${ugx(c.minReward)} – ${ugx(c.maxReward)}`;'),
    ("a member is served every country's inbox messages", SERVER,
     'const rows = await listBroadcastMessages(currentRegionKey());',
     'const rows = await listBroadcastMessages();'),
    ('inbox messages stop being filtered by country at all', SERVER,
     "  const rows = all.filter(m => !m.deleted && messageInRegion(m, want));",
     "  const rows = all.filter(m => !m.deleted);"),
    ('a country-specific message is treated as belonging to nobody', SERVER,
     "  return !own || own === 'all' || own === want;",
     "  return own === 'all';"),
    ('a welcome written for one country deletes the built-in row everywhere else', SERVER,
     "  if (!all.some(m => m.id === 'welcome' && messageInRegion(m, want))) {",
     "  if (!all.some(m => m.id === 'welcome')) {"),
    ("the admin previews the welcome in the panel host's wording, not the picked country's", SERVER,
     'rows.push({ ...defaultWelcomeMessage(await getSettings(settingsRegion)), createdAt: 0',
     'rows.push({ ...defaultWelcomeMessage(await getSettings()), createdAt: 0'),
    ('a saved message is not stamped with its country', SERVER,
     '      title, body, regionKey, date: stamp.date,',
     '      title, body, date: stamp.date,'),
    ('the admin messages list stops being per country', SERVER,
     "    const messages = await listBroadcastMessages(want, want || undefined);",
     "    const messages = await listBroadcastMessages();"),
    ('the country switch is gone from the panel', ADMIN,
     'function paintRegionSwitch(){',
     'function paintRegionSwitch(){ if (1) return;'),
    ('the switch is shown even with only one country', ADMIN,
     '    const many = ADMIN_REGIONS.length > 1;',
     '    const many = true;'),
    ('the switch loses its options on a one-country screen', ADMIN,
     "    const single = REGION_SINGLE_TABS.includes(_tab);\n    const aware = REGION_AWARE_TABS.includes(_tab);",
     "    const single = REGION_SINGLE_TABS.includes(_tab);\n    const aware = REGION_AWARE_TABS.includes(_tab);\n    if (single) { sel.innerHTML = ''; return; }"),
    ('an All-countries view stops warning that its totals mix currencies', ADMIN,
     "      else if (ADMIN_REGION === 'all') msg = 'Every country together - each amount is in its own currency, so totals mix currencies. Pick one country for figures that add up.';",
     "      else if (ADMIN_REGION === 'all') msg = '';"),
    ('a one-country screen stops saying which country it is editing', ADMIN,
     "      else if (single && ADMIN_REGION === 'all') msg = 'Showing ' + regionByKeyAdmin('ug').name + ' - this screen is edited one country at a time.';",
     "      else if (single && ADMIN_REGION === 'all') msg = '';"),
    ('a screen no country owns pretends the switch changes it', ADMIN,
     "      if (!aware) msg = 'This screen is the same for every country.';",
     "      if (!aware) msg = '';"),
    ('the picked country is forgotten on reload', ADMIN,
     "try { const _r = localStorage.getItem('chipz_admin_region'); if (_r) ADMIN_REGION = _r; } catch (_) {}",
     ''),
    ('the picked country is never written down', ADMIN,
     "        try { localStorage.setItem('chipz_admin_region', ADMIN_REGION); } catch (_) {}\n        // Repaint whatever is open against the new country. Every tab reads",
     "        // Repaint whatever is open against the new country. Every tab reads"),
    ('switching country no longer repaints the open tab', ADMIN,
     "        switchTab(_tab);\n      });",
     "      });"),
    ('gift codes and messages are read without a country', ADMIN,
     "'/admin/referrals/list', '/admin/promocodes/list', '/admin/messages/list']",
     "'/admin/referrals/list']"),
    ('new gift codes and messages are written without a country', ADMIN,
     "  '/admin/promocodes/generate', '/admin/messages/save'];",
     "  ];"),
    ('the panel resolves a one-country screen differently from the server', ADMIN,
     "function adminOneRegion(){ return (!ADMIN_REGION || ADMIN_REGION === 'all') ? 'ug' : ADMIN_REGION; }",
     "function adminOneRegion(){ return ADMIN_REGION; }"),
    # ── Round 162: faster loading, and instant address rotation ──
    ('the invite pool shrinks back to one address per request', SERVER,
     "res.json({ status: 'success', host: shuffled[0], hosts: shuffled, count: shuffled.length });",
     "res.json({ status: 'success', host: shuffled[0], count: shuffled.length });"),
    ('the pool is shuffled with Math.random instead of the CSPRNG', SERVER,
     "    const shuffled = pool.slice();\n    for (let i = shuffled.length - 1; i > 0; i--) {\n      const j = crypto.randomInt(i + 1);",
     "    const shuffled = pool.slice();\n    for (let i = shuffled.length - 1; i > 0; i--) {\n      const j = Math.floor(Math.random() * (i + 1));"),
    ('the pool is handed out in a fixed order, so one address is everybody’s first', SERVER,
     """    const shuffled = pool.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {""",
     """    const shuffled = pool.slice();
    for (let i = 0; i > 0; i--) {"""),
    ('an older app build loses its invite link', SERVER,
     "res.json({ status: 'success', host: shuffled[0], hosts: shuffled, count: shuffled.length });",
     "res.json({ status: 'success', hosts: shuffled, count: shuffled.length });"),

    ('every open of the Referral screen asks the server again', CLIENT,
     "  if (!force && _shareHosts.length && (Date.now() - _sharePoolAt) < SHARE_POOL_MS) {",
     "  if (false) {"),
    ('the address stops advancing, so every open shows the same one', CLIENT,
     "  _shareIdx = (_shareIdx + 1) % _shareHosts.length;",
     "  _shareIdx = 0;"),
    ('the pool is never re-read, so a newly added address never reaches anyone', CLIENT,
     "  if (!force && _shareHosts.length && (Date.now() - _sharePoolAt) < SHARE_POOL_MS) {",
     "  if (_shareHosts.length) {"),
    ('a backend that sends one host leaves the member with no invite link', CLIENT,
     """  const pool = (Array.isArray(r.hosts) && r.hosts.length) ? r.hosts.slice()
             : (r.host ? [r.host] : []);""",
     "  const pool = (Array.isArray(r.hosts) && r.hosts.length) ? r.hosts.slice() : [];"),
    ('the address is taken after the first paint, so the link changes under him', CLIENT,
     """  const shareReady = refreshShareHost();
  paintReferral();""",
     """  paintReferral();
  const shareReady = refreshShareHost();"""),

    ('every read is preflighted again', CLIENT,
     "  const headers = Object.assign({}, opts.headers || {});\n  if (opts.body != null && !headers['Content-Type']) headers['Content-Type'] = 'application/json';",
     "  const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});"),
    ('a write stops declaring its JSON body', CLIENT,
     "  if (opts.body != null && !headers['Content-Type']) headers['Content-Type'] = 'application/json';",
     ""),
    ('the preflight cache goes back to five seconds', SERVER,
     "  maxAge: 86400\n}));",
     "}));"),

    ('the loading screen waits for the artwork again', CLIENT,
     "  const [s, p, f, b] = await Promise.all([ pSettings, pProducts, pFeed, pBanner ]);",
     "  const [s, p, f, b] = await Promise.all([ pSettings, pProducts, pFeed, pBanner, _artPromise ]);"),
    ('the artwork is fetched lazily instead of at start-up', CLIENT,
     "  _artPromise = Promise.all([ api('/public/announcement-image'), api('/public/manual-pay-images'), api('/public/chipz-images') ])",
     "  _artPromise = Promise.resolve([{}, {}, {}])\n    .then(() => [{}, {}, {}])"),
    ('Home never repaints, so the spin banner and profile GIF never appear', CLIENT,
     "  try { if (STATE.page === 'home' && $('app') && $('app').style.display !== 'none') paintHome(); } catch (_) {}",
     ""),
    ('the announcement opens before its own picture has arrived', CLIENT,
     "    const afterArt = (fn) => (_artPromise ? withTimeout(_artPromise, 4000).then(fn).catch(fn) : fn());",
     "    const afterArt = (fn) => fn();"),

    ('the public reads lose their ETag, so every launch re-downloads them', SERVER,
     "  const etag = 'W/\"' + crypto.createHash('sha1').update(raw).digest('base64').slice(0, 22) + '\"';",
     "  const etag = '';"),
    ('a matching ETag still gets the whole body back', SERVER,
     "  if (req.headers['if-none-match'] === etag) return res.status(304).end();\n  res.set('Content-Type', 'application/json; charset=utf-8');",
     "  res.set('Content-Type', 'application/json; charset=utf-8');"),
    ('the ETag stops depending on the content, so an upload is hidden by the cache', SERVER,
     "crypto.createHash('sha1').update(raw).digest('base64').slice(0, 22)",
     "'fixed'"),
    ('the seven-slot image bundle goes back to no cache headers at all', SERVER,
     "    publicJson(req, res, { status: 'success', referral, logo, spin, profilegif, downloadbg, authhero, authcard }, IMAGE_CACHE);",
     "    res.json({ status: 'success', referral, logo, spin, profilegif, downloadbg, authhero, authcard });"),
    ('settings are cached for a minute, so maintenance mode takes a minute to bite', SERVER,
     "    }, region: publicRegionView(), regionCount: (await getRegions()).filter(r => r.active).length });",
     "    }, region: publicRegionView(), regionCount: (await getRegions()).filter(r => r.active).length }, IMAGE_CACHE);"),

    # ── Round 163: languages ──────────────────────────────────────────────
    ('a country can be given a language the app cannot render', SERVER,
     ".map(c => String(c == null ? '' : c).trim().toLowerCase()).filter(c => LANGUAGE_CODES.includes(c));",
     ".map(c => String(c == null ? '' : c).trim().toLowerCase()).filter(Boolean);"),
    ('a country with nothing ticked ends up offering no language at all', SERVER,
     "  if (!languages.length) languages.push('en');",
     "  /* no fallback */"),
    ('the default language is not forced into the allowed list', SERVER,
     "  if (!languages.includes(defaultLang)) defaultLang = languages[0];",
     "  if (!defaultLang) defaultLang = languages[0];"),
    ('the app is never told which languages its country allows', SERVER,
     "    languages: (reg.languages && reg.languages.length ? reg.languages : ['en']).slice(),\n    defaultLang: reg.defaultLang || 'en',",
     "    defaultLang: reg.defaultLang || 'en',"),
    ('the save route quietly drops an unknown language instead of refusing it', SERVER,
     "  const badLang = typedLangs.find(c => !LANGUAGE_CODES.includes(c));",
     "  const badLang = null;"),
    ('applyRegion drops the language list, the same whitelist slip that once broke the login address', CLIENT,
     "'usesBareLocal','languages','defaultLang','networks']",
     "'usesBareLocal','networks']"),
    # Re-anchored: Round 172's whitespace normalisation rewrote this function,
    # so the old anchor had been dead since then -- applied to nothing, and
    # aborting the run the moment the anchors were actually checked.
    ('the translator rewrites any string that CONTAINS a translated word', CLIENT,
     "  const want = hit === key\n    ? raw\n    : raw.slice(0, raw.length - raw.replace(/^\\s+/, '').length) + hit +\n      raw.slice(raw.replace(/\\s+$/, '').length);",
     "  let want = raw;\n  for (const k of Object.keys(DICT[LANG] || {})) want = String(want).split(k).join(DICT[LANG][k]);"),
    ('the translator reads what is on screen instead of the stored English, so a second switch never lands', CLIENT,
     "  let src;\n  if (_i18nText.has(node)) src = _i18nText.get(node);\n  else { src = node.nodeValue; _i18nText.set(node, src); }",
     "  let src = node.nodeValue;"),
    ('text inside [data-no-i18n] is translated after all', CLIENT,
     "        if (p.closest('[data-no-i18n]')) return NodeFilter.FILTER_REJECT;",
     "        /* no opt-out */"),
    ('a <script> body is put through the translator', CLIENT,
     "        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEXTAREA') return NodeFilter.FILTER_REJECT;",
     "        /* everything is fair game */"),
    ('the language button is shown even where the country offers only one', CLIENT,
     "    const many = LANG_ALLOWED.length > 1;\n    for (const id of ['langBtn', 'langRow']) {",
     "    const many = true;\n    for (const id of ['langBtn', 'langRow']) {"),
    ('a stored language the country has withdrawn is honoured anyway', CLIENT,
     "  if (stored && allowed.includes(stored) && LANG_CODES.includes(stored)) return stored;",
     "  if (stored && LANG_CODES.includes(stored)) return stored;"),
    ('the picker offers a code the app has no dictionary for', CLIENT,
     "    .map(c => String(c || '').toLowerCase()).filter(c => LANG_CODES.includes(c));",
     "    .map(c => String(c || '').toLowerCase());"),
    ('the chosen language is never written down, so it is lost on the next launch', CLIENT,
     "    try { localStorage.setItem(LANG_STORE_KEY, c); } catch(_){}",
     "    /* not remembered */"),
    ('the language picker moves above the bottom bar, where a nav tap can strand it', SHELL,
     ".lang-sheet-bg{position:fixed;inset:0;",
     ".lang-sheet-bg{position:fixed;left:0;right:0;top:0;bottom:var(--nav-h);"),
    ('the button is no longer pinned to the top right of the hero', SHELL,
     ".lang-btn{position:absolute;top:14px;right:14px;",
     ".lang-btn{position:static;"),
    ('the panel stops sending the ticked languages', ADMIN,
     "      languages: Array.from(document.querySelectorAll('.rg-lang')).filter(c => c.checked).map(c => c.value),",
     "      "),
]


def main():
    code, out = run_test()
    if code != 0:
        print('REFUSING TO RUN: test-regions.js does not pass on the untouched tree.')
        print(out[-3000:])
        return 1
    print('baseline: test-regions.js passes on the untouched tree\n')

    originals = {SERVER: read(SERVER), CLIENT: read(CLIENT), ADMIN: read(ADMIN), SHELL: read(SHELL),
                 USERBUILT: read(USERBUILT)}
    missed, applied = [], 0
    try:
        for label, path, old, new in MUTATIONS:
            src = originals[path]
            n = src.count(old)
            if n != 1:
                print(f'SKIPPED  {label}  (anchor appears {n} times -- update this harness)')
                missed.append(label + ' [anchor drifted]')
                continue
            write(path, src.replace(old, new))
            applied += 1
            code, out = run_test()
            write(path, src)
            if code == 0:
                print(f'MISSED   {label}')
                missed.append(label)
            else:
                print(f'caught   {label}')
    finally:
        for p, s in originals.items():
            write(p, s)

    print()
    if missed:
        print(f'{len(missed)} of {len(MUTATIONS)} mutations went UNDETECTED:')
        for m in missed:
            print('  - ' + m)
        return 1
    print(f'all {applied} mutations detected -- test-regions.js discriminates')
    code, out = run_test()
    if code != 0:
        print('BUT the tree was not restored cleanly:')
        print(out[-2000:])
        return 1
    print('and the tree is restored (test still passes)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
