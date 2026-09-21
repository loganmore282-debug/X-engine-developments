#!/usr/bin/env python3
"""Re-break the per-region network configurability fix, one way at a time.

Judged on the EXIT CODE, never on FAIL-line counts -- a mutation that crashes
the harness prints no FAIL line, and counting lines reads that as a pass.

Opens with a deliberate NO-OP asserted MISSED. If the control is ever CAUGHT,
the run is failing for a reason unrelated to the mutation and every other
CAUGHT in it means nothing.
"""
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SERVER = HERE / 'server.js'
CLIENT = HERE / 'user-src' / 'original_module.js'
ADMIN = HERE / 'admin-src' / 'index.html'

# (label, target, old, new, expect_caught)
MUTATIONS = [
    ('CONTROL: a declared-and-unused constant (must be MISSED)', SERVER,
     'function regionNetworkSet(region) {',
     'const _unusedControl = 0;\nfunction regionNetworkSet(region) {',
     False),

    ('regionNetworkSet stops falling back for an empty/missing networks field', SERVER,
     'const list = Array.isArray(r && r.networks) && r.networks.length ? r.networks : DEFAULT_REGION.networks;',
     'const list = r && r.networks;',
     True),

    ("normalizeRegion splits a typed network list on bare whitespace, shredding multi-word names", SERVER,
     "String((raw && raw.networks) || '').split(/[,\\n]+/))",
     "String((raw && raw.networks) || '').split(/[\\s,\\n]+/))",
     True),

    ('the per-market default table is skipped, so a new Cameroon region silently gets MTN/Airtel', SERVER,
     'const networks = networksTyped.length ? networksTyped\n    : (REGION_DEFAULT_NETWORKS[dialCode] || base.networks || DEFAULT_REGION.networks).slice();',
     'const networks = networksTyped.length ? networksTyped : DEFAULT_REGION.networks.slice();',
     True),

    ('publicRegionView stops publishing networks at all', SERVER,
     "networks: (reg.networks && reg.networks.length ? reg.networks : DEFAULT_REGION.networks).slice(),\n  };\n}",
     '  };\n}',
     True),

    ("/deposit/marzpay reverts to the old global network check", SERVER,
     "const network = regionNetworkSet().has(req.body.network) ? req.body.network : null;\n    await depRef.set({",
     "const network = ['MTN Mobile Money', 'Airtel Money'].includes(req.body.network) ? req.body.network : null;\n    await depRef.set({",
     True),

    ("/deposit/manual/init reverts to the old global network check", SERVER,
     "const network = regionNetworkSet().has(req.body.network) ? req.body.network : null;\n  if (!network) return res.status(400)",
     "const network = ['MTN Mobile Money', 'Airtel Money'].includes(req.body.network) ? req.body.network : null;\n  if (!network) return res.status(400)",
     True),

    ('/admin/manual-numbers/save validates the network against the GLOBAL set instead of the region being saved', SERVER,
     "if (!regionNetworkSet(numRegion).has(network)) return res.status(400).json({ status: 'error', message: 'Select a valid network' });",
     "if (!['MTN Mobile Money', 'Airtel Money'].includes(network)) return res.status(400).json({ status: 'error', message: 'Select a valid network' });",
     True),

    ('/withdraw/request reverts to the old global network check', SERVER,
     "if (!regionNetworkSet().has(rawNetwork)) return res.status(400).json({ status: 'error', message: 'Bind a withdrawal account first.' });",
     "if (!['MTN Mobile Money', 'Airtel Money'].includes(rawNetwork)) return res.status(400).json({ status: 'error', message: 'Bind a withdrawal account first.' });",
     True),

    ('/bank/save -- the withdrawal-wallet screen -- reverts to the old global network check', SERVER,
     "if (!holder || !regionNetworkSet().has(rawNetwork)) return res.status(400).json({ status: 'error', message: 'Fill in all fields' });",
     "if (!holder || !['MTN Mobile Money', 'Airtel Money'].includes(rawNetwork)) return res.status(400).json({ status: 'error', message: 'Fill in all fields' });",
     True),

    # The deposit-attempts auto-ban itself is removed (Round 179b), not
    # merely patched -- these mutations re-introduce the removed mechanism
    # piece by piece and require the removal to be noticed.
    ('the deposit-attempts auto-ban mechanism is reintroduced wholesale', SERVER,
     "// ── DEPOSIT / WITHDRAWAL ABUSE GUARDS ──\n// The \"5 deposit attempts in a minute\" AUTOMATIC ban is gone",
     "// ── DEPOSIT / WITHDRAWAL ABUSE GUARDS ──\n"
     "const _depAttempts = new Map();\n"
     "function recordDepositAttempt(userId) { const arr = (_depAttempts.get(userId) || []); arr.push(Date.now()); _depAttempts.set(userId, arr); return arr.length; }\n"
     "async function banUserAutomatically(userId, reason) { await db.collection('users').doc(userId).update({ status: 'banned', banReason: reason }); }\n"
     "// The \"5 deposit attempts in a minute\" AUTOMATIC ban is gone",
     True),

    ('/deposit/manual/init bans a member for repeated deposit attempts again', SERVER,
     "    const lastDep = _depCreateDebounce.get(userId) || 0;\n"
     "    if (Date.now() - lastDep < 7000)\n"
     "      return res.status(429).json({ status: 'error', message: 'A deposit is already being processed. Please wait a moment.' });\n"
     "    _depCreateDebounce.set(userId, Date.now());\n"
     "\n"
     "    // uniqueRef() is a real DB round trip",
     "    const lastDep = _depCreateDebounce.get(userId) || 0;\n"
     "    if (Date.now() - lastDep < 7000)\n"
     "      return res.status(429).json({ status: 'error', message: 'A deposit is already being processed. Please wait a moment.' });\n"
     "    if ((_depCreateDebounce.get('attempts:' + userId) || 0) >= 5) {\n"
     "      await db.collection('users').doc(userId).update({ status: 'banned' });\n"
     "      return res.status(403).json({ status: 'error', code: 'BANNED', message: 'Account suspended. Contact customer service.' });\n"
     "    }\n"
     "    _depCreateDebounce.set(userId, Date.now());\n"
     "\n"
     "    // uniqueRef() is a real DB round trip",
     True),

    ('/admin/regions/save no longer refuses more than 8 networks', SERVER,
     "  if (typedNetworks.length > 8)\n    return res.status(400).json({ status: 'error', message: 'List at most 8 networks for a country.' });\n",
     '',
     True),

    ('/admin/regions/save no longer refuses a duplicated network name', SERVER,
     "  if (typedNetworks.some((n, i) => typedNetworks.indexOf(n) !== i))\n    return res.status(400).json({ status: 'error', message: 'The same network was listed twice.' });\n",
     '',
     True),

    ('the LANG_ROWS row for the ban message is deleted, reverting to raw English', CLIENT,
     "['Account suspended. Contact customer service.',",
     "['SOMETHING_ELSE_ENTIRELY_ACCOUNT_SUSPENDED',",
     True),

    ('the French cell for the ban message is blanked out', CLIENT,
     "'Compte suspendu. Contactez le service client.',",
     "'',",
     True),

    ("applyRegion()'s whitelist drops 'networks', silently losing the field on every response", CLIENT,
     "'usesBareLocal','languages','defaultLang','networks'",
     "'usesBareLocal','languages','defaultLang'",
     True),

    ('renderWalletSheet reverts to the hardcoded MTN/Airtel list', CLIENT,
     "const providers = regionNetworks();",
     "const providers = ['MTN Mobile Money', 'Airtel Money'];",
     True),

    ('regionNetworks() stops falling back for an empty REGION.networks', CLIENT,
     "function regionNetworks(){ return (REGION && Array.isArray(REGION.networks) && REGION.networks.length) ? REGION.networks : ['MTN Mobile Money', 'Airtel Money']; }",
     "function regionNetworks(){ return REGION && REGION.networks; }",
     True),

    ('the admin Countries dialog no longer sends the typed networks to the server', ADMIN,
     "networks: $('rgNetworks').value.split(/[,\\n]+/).map(s => s.trim()).filter(Boolean),\n    } });",
     "    } });",
     True),
]


def run():
    r = subprocess.run(['node', 'test-region-networks.js'], cwd=HERE, capture_output=True, text=True)
    return r.returncode


def main():
    if run() != 0:
        print('REFUSING TO RUN: test-region-networks.js is not green at HEAD')
        return 1
    fails = 0
    for label, target, old, new, expect in MUTATIONS:
        text = target.read_text()
        hits = text.count(old)
        if hits != 1:
            print('ABORT  anchor matches %d times (need exactly 1): %s' % (hits, label))
            return 1
        target.write_text(text.replace(old, new, 1))
        try:
            code = run()
        finally:
            target.write_text(text)
        caught = code != 0
        ok = caught == expect
        if not ok:
            fails += 1
        print('%-7s %s%s' % ('CAUGHT' if caught else 'MISSED', label,
                             '' if ok else '   <-- WRONG, wanted %s' % ('CAUGHT' if expect else 'MISSED')))
    print()
    print('%d mutation(s) behaved wrongly' % fails if fails
          else 'all %d mutations behaved as intended' % len(MUTATIONS))
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main())
