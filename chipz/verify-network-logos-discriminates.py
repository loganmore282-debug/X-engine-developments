#!/usr/bin/env python3
"""Re-break the network-logo feature (per-name upload, both PAY A and PAY B
sharing the same network-selector screen), one way at a time.

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

# (label, target, old, new, expect_caught)
MUTATIONS = [
    ('CONTROL: a declared-and-unused constant (must be MISSED)', SERVER,
     'function networkLogoKey(name) {',
     'const _unusedControl = 0;\nfunction networkLogoKey(name) {',
     False),

    ('networkLogoKey stops normalizing case, so "MTN" and "mtn" become two different uploads', SERVER,
     "return String(name || '').trim().replace(/\\s+/g, ' ').toLowerCase();",
     "return String(name || '').trim().replace(/\\s+/g, ' ');",
     True),

    ('/admin/network-logo/set no longer requires the owner key', SERVER,
     "app.post('/admin/network-logo/set', async (req, res) => {\n  if (!verifyOwner(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });",
     "app.post('/admin/network-logo/set', async (req, res) => {",
     True),

    ('the name-length cap is dropped, so an unbounded name can be stored', SERVER,
     "if (!name || name.length > NETWORK_LOGO_MAX) return res.status(400).json({ status: 'error', message: `Network name must be 1-${NETWORK_LOGO_MAX} characters` });",
     '',
     True),

    ('the image is stored without validating its shape, admitting non-image data', SERVER,
     "if (!/^data:image\\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(image) || image.length > 2_800_000)\n    return res.status(400).json({ status: 'error', message: 'Invalid image' });\n  try {\n    const key = networkLogoKey(name);",
     "try {\n    const key = networkLogoKey(name);",
     True),

    ('a save no longer invalidates the cache, so a fresh upload is invisible for up to 60s', SERVER,
     "await db.collection('networkLogos').doc(key).set({ name, image });\n    _networkLogoCacheTs = 0;",
     "await db.collection('networkLogos').doc(key).set({ name, image });",
     True),

    ('the RAW typed name is stored as the key instead of the normalized one, so "MTN" and "mtn" split into two uploads', SERVER,
     "await db.collection('networkLogos').doc(key).set({ name, image });",
     "await db.collection('networkLogos').doc(name).set({ name, image });",
     True),

    ('/admin/network-logo/clear resolves a different key than /set does, so Remove can silently miss', SERVER,
     "await db.collection('networkLogos').doc(networkLogoKey(name)).delete();",
     "await db.collection('networkLogos').doc(name).delete();",
     True),

    ('the public map is built from the raw typed name instead of the normalized key, so the client can never find it', SERVER,
     'if (d && d.image) map[doc.id] = d.image;',
     'if (d && d.image) map[d.name] = d.image;',
     True),

    ('/admin/network-logo/set is dropped from IMAGE_BODY_ROUTES, so an upload is refused by the JSON body-size limiter', SERVER,
     "'/admin/manual-pay-image/set', '/admin/network-logo/set', '/admin/chipz-image/set'",
     "'/admin/manual-pay-image/set', '/admin/chipz-image/set'",
     True),

    ('the deposit tiles go back to a fixed 2-network list instead of regionNetworks()', CLIENT,
     "${regionNetworks().map(n => `<button type=\"button\" class=\"mp-method\" data-method=\"${esc(n)}\" onclick=\"manualPayChooseMethod(this)\">\n              ${networkLogoHtml(n)}<span>${esc(n)}</span>\n            </button>`).join('')}",
     "<button type=\"button\" class=\"mp-method\" data-method=\"MTN Mobile Money\" onclick=\"manualPayChooseMethod(this)\">${networkLogoHtml('MTN Mobile Money')}<span>MTN</span></button>",
     True),

    ('a tile with no uploaded logo renders a broken <img> instead of the letter fallback', CLIENT,
     "  return url\n    ? `<img src=\"${esc(url)}\" alt=\"${esc(name)}\" style=\"width:29px;height:23px;object-fit:contain;\">`\n    : networkLogoFallbackHtml(name);",
     "  return `<img src=\"${esc(url)}\" alt=\"${esc(name)}\" style=\"width:29px;height:23px;object-fit:contain;\">`;",
     True),

    ("PAY A's branch is removed, so tapping Confirm on PAY A falls through to the manual /deposit/manual/init path", CLIENT,
     "  if (_depPayChoice === 'A') {\n    let r;\n    try { r = await post('/deposit/marzpay', { amount, phone, network }); }\n    finally { manualPayLoading(false); }\n    if (!r || r.status !== 'success') { manualPayToast((r && r.message) || 'Could not start recharge'); return; }\n    await refreshTransactionsCache();\n    closeManualPayOverlay({ fromAction: true });\n    openDepositStatusModal(amount, phone, network);\n    pollDepositStatus(r.depositId);\n    return;\n  }",
     '',
     True),

    ("PAY A's success path stops closing the network-selector overlay, leaving it on top of the poll screen", CLIENT,
     '    closeManualPayOverlay({ fromAction: true });\n    openDepositStatusModal(amount, phone, network);',
     '    openDepositStatusModal(amount, phone, network);',
     True),

    ('the phone check reverts to the Uganda-only sanity check instead of the region-aware cleanPhone()', CLIENT,
     "  const phone = cleanPhone(raw);\n  if (!phone) { manualPayToast('The mobile phone number format is incorrect'); return; }",
     "  if (!raw) { manualPayToast('The mobile phone number format is incorrect'); return; }\n  const phone = raw;",
     True),

    ('resumeManualPayFlow reintroduces the MTN/Airtel-only remap, mislabeling every third network', CLIENT,
     '  _manDepChosenMethod = p.network;',
     "  _manDepChosenMethod = p.network === 'Airtel Money' ? 'Airtel' : 'MTN';",
     True),

    ('renderManualPayReminder falls back to showing MTN\'s reminder for every non-Airtel network again', CLIENT,
     "  const tpl = data.network === 'Airtel Money' ? (s.manualPayReminderAirtel || '')\n            : data.network === 'MTN Mobile Money' ? (s.manualPayReminderMtn || '')\n            : '';",
     "  const tpl = data.network === 'Airtel Money' ? (s.manualPayReminderAirtel || '') : (s.manualPayReminderMtn || '');",
     True),
]


def run():
    worst = 0
    for f in ('test-network-logos.js', 'test-region-networks.js', 'test-manualpay-matches-snow.js'):
        r = subprocess.run(['node', f], cwd=HERE, capture_output=True, text=True)
        worst = worst or r.returncode
    return worst


def main():
    if run() != 0:
        print('REFUSING TO RUN: the network-logo harnesses are not green at HEAD')
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
