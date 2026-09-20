#!/usr/bin/env python3
"""Re-break the link-preview switch and the delete refusals, one at a time.

Judged on the EXIT CODE, never on FAIL-line counts: a mutation that makes the
harness crash prints no FAIL line, and counting lines reads that as a pass.

Opens with a deliberate NO-OP asserted MISSED. If the control is ever reported
CAUGHT, the run is failing for an unrelated reason and every CAUGHT in it means
nothing.
"""
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SERVER = HERE / 'server.js'
ADMIN = HERE / 'admin-src' / 'index.html'

HARNESSES = ['test-link-preview-and-delete.js', 'test-regions.js']

MUTATIONS = [
    ('CONTROL: a declared-and-unused constant (must be MISSED)', SERVER,
     '  linkPreviewEnabled: true,',
     '  linkPreviewEnabled: true,\n  _unusedControl: 0,',
     False),

    ('the owner-only refusal goes back to a bare "Unauthorized"', SERVER,
     "  if (!verifyOwner(req))\n    return res.status(403).json({ status: 'error', code: 'OWNER_ONLY', message:",
     "  if (!verifyOwner(req))\n    return res.status(401).json({ status: 'error', message: 'Unauthorized' }) || res.json({ code: 'x', message:",
     True),

    ('the member refusal stops saying how many', SERVER,
     "        `${howMany} ${n === 1 ? 'is' : 'are'} signed up in this country, so it cannot be deleted -- ` +",
     "        `There are members signed up in this country, so it cannot be deleted -- ` +",
     True),

    ('the member check scans the whole collection again', SERVER,
     ".where('regionKey', '==', key).limit(51).get()",
     ".where('regionKey', '==', key).get()",
     True),

    ('an already-deleted country is not distinguished', SERVER,
     "      return res.status(404).json({ status: 'error', code: 'NO_SUCH_REGION', message:",
     "      return res.status(400).json({ status: 'error', code: 'REGION_HAS_MEMBERS', message:",
     True),

    ('the link preview can no longer be switched off', SERVER,
     "        if (sett && sett.linkPreviewEnabled === false) {",
     "        if (false) {",
     True),

    ('switching the preview off takes the app icons down with it', SERVER,
     "      if (slot === 'link-preview') {",
     "      if (true) {",
     True),

    ('an unset setting is treated as OFF, so a deploy loses the share card', SERVER,
     "        if (sett && sett.linkPreviewEnabled === false) {",
     "        if (!sett || sett.linkPreviewEnabled !== true) {",
     True),

    ('the 404 is cached, so switching it back on waits for the cache', SERVER,
     "          res.set('Cache-Control', 'no-store');",
     "          res.set('Cache-Control', 'public, max-age=300');",
     True),

    ('the setting stops being backend-wide', SERVER,
     ", 'strictRegionHosts', 'linkPreviewEnabled'];",
     ", 'strictRegionHosts'];",
     True),

    ('the panel strips backend-wide fields from EVERY save again', ADMIN,
     "    if (target !== 'ug' && REGION_SCOPED_WRITES.includes(path)",
     "    if (REGION_SCOPED_WRITES.includes(path)",
     True),

    ('the switch stops naming the founding region, so another country eats it', ADMIN,
     "api('/admin/settings/update', { region: 'ug', settings: { linkPreviewEnabled: on } })",
     "api('/admin/settings/update', { settings: { linkPreviewEnabled: on } })",
     True),

    ('a refused save leaves the switch showing the wrong state', ADMIN,
     "      linkPrevOn.checked = !on;   // put the switch back where the server left it",
     "      ",
     True),

    ('the switch renders unset as OFF', ADMIN,
     "${s.linkPreviewEnabled !== false ? 'checked' : ''}",
     "${s.linkPreviewEnabled === true ? 'checked' : ''}",
     True),
]


def run():
    worst = 0
    for h in HARNESSES:
        r = subprocess.run(['node', h], cwd=HERE, capture_output=True, text=True)
        worst = max(worst, r.returncode)
    return worst


def main():
    if run() != 0:
        print('REFUSING TO RUN: the harnesses are not green at HEAD')
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
