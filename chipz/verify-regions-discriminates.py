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
     """    region = regionForHost(req.headers.origin || req.headers.host);
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
    region = regionForHost(req.headers.origin || req.headers.host);"""),

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
     "const GLOBAL_ONLY_SETTINGS = ['allowedOrigins', 'maintenanceMode', 'maintenanceMsg', 'openingCountdownEnabled', 'openingCountdownAt', 'brandName'];",
     "const GLOBAL_ONLY_SETTINGS = ['allowedOrigins', 'brandName'];"),

    ("the minimum cash-out stops being a country's own", SERVER,
     "const GLOBAL_ONLY_SETTINGS = ['allowedOrigins', 'maintenanceMode', 'maintenanceMsg', 'openingCountdownEnabled', 'openingCountdownAt', 'brandName'];",
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
     "  for (const r of _regionsSnapshot) if (r.active && r.hosts.includes(h)) return r;",
     "  for (const r of _regionsSnapshot) if (r.hosts.includes(h)) return r;"),

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
     "const ADMIN_GLOBAL_ONLY = ['allowedOrigins', 'maintenanceMode', 'maintenanceMsg', 'openingCountdownEnabled', 'openingCountdownAt', 'brandName'];",
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
  for (const r of _regionsSnapshot) for (const h of r.hosts) _regionHosts.push(h);
  refreshCorsSnapshot();""",
     """  /* region hosts not folded into the CORS allowlist */"""),
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
