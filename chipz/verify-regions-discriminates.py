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

ROOT = os.path.dirname(os.path.abspath(__file__))
SERVER = os.path.join(ROOT, 'server.js')
CLIENT = os.path.join(ROOT, 'user-src', 'original_module.js')
ADMIN = os.path.join(ROOT, 'admin-src', 'index.html')


def read(p):
    with open(p, encoding='utf-8') as f:
        return f.read()


def write(p, s):
    with open(p, 'w', encoding='utf-8') as f:
        f.write(s)


def run_test():
    r = subprocess.run([  'node', 'test-regions.js' ], cwd=ROOT,
                       capture_output=True, text=True)
    return r.returncode, (r.stdout + r.stderr)


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

    ('a referral code from another country is accepted', SERVER,
     """      if (refRegion !== myRegion)
        return { code: 400, body: { status: 'error', code: 'BAD_REFERRAL_REGION', message: 'That referral code belongs to a member in another country. Ask for a code from someone signed up on this site.' } };""",
     """      void refRegion; void myRegion;"""),

    ("one country's prices wipe every other country's", SERVER,
     "        batch.set(db.collection('products').doc(p.key), { key: p.key, ['regions.' + region.key]: over }, { merge: true });",
     "        batch.set(db.collection('products').doc(p.key), { key: p.key, regions: { [region.key]: over } }, { merge: true });"),

    ('a backend-wide setting can be set per country', SERVER,
     """      const offending = GLOBAL_ONLY_SETTINGS.filter(k => k in updates);
      if (offending.length)""",
     """      const offending = [];
      if (offending.length)"""),

    ('maintenance mode becomes a per-country setting', SERVER,
     "const GLOBAL_ONLY_SETTINGS = ['allowedOrigins', 'maintenanceMode', 'maintenanceMsg', 'openingCountdownEnabled', 'openingCountdownAt', 'brandName', 'baseDomain', 'blockRootDomain', 'parkedHosts', 'strictRegionHosts'];",
     "const GLOBAL_ONLY_SETTINGS = ['allowedOrigins', 'brandName'];"),

    ("the minimum cash-out stops being a country's own", SERVER,
     "const GLOBAL_ONLY_SETTINGS = ['allowedOrigins', 'maintenanceMode', 'maintenanceMsg', 'openingCountdownEnabled', 'openingCountdownAt', 'brandName', 'baseDomain', 'blockRootDomain', 'parkedHosts', 'strictRegionHosts'];",
     "const GLOBAL_ONLY_SETTINGS = ['allowedOrigins', 'maintenanceMode', 'maintenanceMsg', 'openingCountdownEnabled', 'openingCountdownAt', 'brandName', 'minWithdraw'];"),

    ('every country shares one settings document', SERVER,
     "  return String(key || DEFAULT_REGION_KEY) === DEFAULT_REGION_KEY ? 'main' : 'region-' + String(key);",
     "  return 'main';"),

    ('the server drops the dialling code from a login address', SERVER,
     "  return (r.isDefault ? local : String(r.dialCode || '') + local) + '@chipz-platform.com';",
     "  return local + '@chipz-platform.com';"),

    ('the server puts a dialling code on Ugandan logins too', SERVER,
     "  return (r.isDefault ? local : String(r.dialCode || '') + local) + '@chipz-platform.com';",
     "  return String(r.dialCode || '') + local + '@chipz-platform.com';"),

    ('the app drops the dialling code from a login address', CLIENT,
     "  return ((REGION && REGION.isDefault === false) ? dial() + local : local) + '@chipz-platform.com';",
     "  return local + '@chipz-platform.com';"),

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

    ('strict mode stops refusing unclaimed addresses', SERVER,
     '  if (_strictRegionHosts && !_regionHosts.includes(h)) return true;',
     '  void _strictRegionHosts;'),

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
     "const GLOBAL_ONLY_SETTINGS = ['allowedOrigins', 'maintenanceMode', 'maintenanceMsg', 'openingCountdownEnabled', 'openingCountdownAt', 'brandName', 'baseDomain', 'blockRootDomain', 'parkedHosts', 'strictRegionHosts'];",
     "const GLOBAL_ONLY_SETTINGS = ['allowedOrigins', 'maintenanceMode', 'maintenanceMsg', 'openingCountdownEnabled', 'openingCountdownAt', 'brandName'];"),

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
     "    const members = await db.collection('users').where('regionKey', '==', key).limit(1).get();",
     "    const members = { empty: true };"),

    ('the panel sends a backend-wide setting with a country’s rates, failing the whole save', ADMIN,
     "        for (const k of ADMIN_GLOBAL_ONLY) delete body.settings[k];",
     "        void ADMIN_GLOBAL_ONLY;"),

    ('the panel and the server disagree about which settings are backend-wide', ADMIN,
     "const ADMIN_GLOBAL_ONLY = ['allowedOrigins', 'maintenanceMode', 'maintenanceMsg', 'openingCountdownEnabled', 'openingCountdownAt', 'brandName', 'baseDomain', 'blockRootDomain', 'parkedHosts', 'strictRegionHosts'];",
     "const ADMIN_GLOBAL_ONLY = ['allowedOrigins', 'brandName'];"),

    ('the picked country is no longer stamped on admin reads', ADMIN,
     "    if (REGION_SCOPED_READS.includes(path)) path += '?region=' + encodeURIComponent(ADMIN_REGION);",
     "    if (false) path += '?region=' + encodeURIComponent(ADMIN_REGION);"),

    ('an admin list labels every row in the panel’s own currency', ADMIN,
     "function ugx(n, regionKey){",
     "function ugx(n, ignoredRegionKey){ const regionKey = undefined;"),

    ('the country picker is shown even with one country', ADMIN,
     "  if (ADMIN_REGIONS.length < 2) return '';",
     "  if (false) return '';"),

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
     "    if (!pool.length) return res.json(stay);\n",
     ""),

    ('the mode is read from the founding country instead of this one', SERVER,
     "    const sett = await getSettings(region.key);",
     "    const sett = await getSettings(DEFAULT_REGION_KEY);"),

    ('the pool is not built from this country own address list', SERVER,
     "    const pool = (region.labels || [])",
     "    const pool = (region.hosts || [])"),

    ('a failed settings read stops the app loading', SERVER,
     "    res.json({ status: 'success', rotate: false, mode: 'off', host: '' });\n  }",
     "    res.status(500).json({ status: 'error', message: 'entry failed' });\n  }"),

    ('a mistyped mode is quietly turned into off instead of refused', SERVER,
     """      if (!ROTATE_ENTRY_MODES.includes(mode))
        return res.status(400).json({ status: 'error', message: 'Moving arrivals to another address must be off, visitors, or always.' });
      updates.rotateEntry = mode;""",
     """      updates.rotateEntry = ROTATE_ENTRY_MODES.includes(mode) ? mode : 'off';"""),

    ('the mode becomes backend-wide, so every country shares one answer', SERVER,
     "'parkedHosts', 'strictRegionHosts'];",
     "'parkedHosts', 'strictRegionHosts', 'rotateEntry'];"),

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
]


def main():
    code, out = run_test()
    if code != 0:
        print('REFUSING TO RUN: test-regions.js does not pass on the untouched tree.')
        print(out[-3000:])
        return 1
    print('baseline: test-regions.js passes on the untouched tree\n')

    originals = {SERVER: read(SERVER), CLIENT: read(CLIENT), ADMIN: read(ADMIN)}
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
