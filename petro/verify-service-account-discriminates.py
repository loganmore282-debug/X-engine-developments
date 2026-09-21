#!/usr/bin/env python3
"""Re-break the FIREBASE_SERVICE_ACCOUNT diagnosis, one way at a time.

Judged on the EXIT CODE, never on FAIL-line counts: a mutation that makes the
harness CRASH prints no FAIL line at all, and counting lines reads that as a
pass. This project has been bitten by exactly that.

Opens with a deliberate NO-OP asserted to be MISSED. If the control is ever
reported CAUGHT, the harness is failing for some reason unrelated to the
mutation and every other CAUGHT in the run means nothing.
"""
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SA = HERE / 'service-account.js'
SERVER = HERE / 'server.js'

# (label, file, old, new, expect_caught)
MUTATIONS = [
    ('CONTROL: a declared-and-unused variable (must be MISSED)', SA,
     'const REQUIRED = [', 'const _unusedControl = 0;\nconst REQUIRED = [', False),

    ("the old `|| '{}'` behaviour: unset and malformed read alike", SA,
     "  if (!text) {\n    return { fatal: 'FIREBASE_SERVICE_ACCOUNT is not set. Paste the whole ' +\n      \"service-account JSON into it (one line) in the host's variables.\" };\n  }",
     "  if (!text) {\n    return { fatal: 'FIREBASE_SERVICE_ACCOUNT invalid: Missing project_id' };\n  }",
     True),

    ('an unset variable is described as "invalid" again', SA,
     "'FIREBASE_SERVICE_ACCOUNT is not set. Paste the whole '",
     "'FIREBASE_SERVICE_ACCOUNT invalid. Paste the whole '",
     True),

    ('a quote-wrapped paste falls through to the generic type message', SA,
     "  if (typeof sa === 'string') {", "  if (false) {", True),

    ('only the first missing field is reported, one per restart', SA,
     "const missing = REQUIRED.filter(k => !sa[k]);",
     "const missing = REQUIRED.filter(k => !sa[k]).slice(0, 1);",
     True),

    ('client_email and private_key stop being required', SA,
     "const REQUIRED = ['project_id', 'client_email', 'private_key'];",
     "const REQUIRED = ['project_id'];",
     True),

    ('the PEM check is dropped, so a hand-edited key fails later in cert()', SA,
     "  if (!/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(String(sa.private_key))) {",
     "  if (false) {",
     True),

    ('a real service account is rejected (the false-positive direction)', SA,
     '  return { sa };\n}', '  return { fatal: 'r"'nope'"' };\n}', True),

    ('the paste hints all collapse into one sentence', SA,
     "    let hint = '';", "    let hint = ''; if (1) return { fatal: 'bad JSON' };", True),

    ('a fatal verdict is logged but the server boots anyway', SERVER,
     "if (serviceAccountFatal) { console.error(serviceAccountFatal); process.exit(1); }",
     "if (serviceAccountFatal) { console.error(serviceAccountFatal); }",
     True),

    ('a cert() rejection becomes an unhandled throw', SERVER,
     "  console.error('Firebase rejected the service account: ' + e.message);\n  process.exit(1);",
     "  console.error('Firebase rejected the service account: ' + e.message);",
     True),
]


def run():
    r = subprocess.run([sys.executable and 'node', 'test-service-account.js'],
                       cwd=HERE, capture_output=True, text=True)
    return r.returncode


def main():
    baseline = run()
    if baseline != 0:
        print('REFUSING TO RUN: the suite is not green at HEAD (exit %d)' % baseline)
        return 1

    fails = 0
    for label, target, old, new, expect_caught in MUTATIONS:
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
        ok = caught == expect_caught
        if not ok:
            fails += 1
        word = 'CAUGHT' if caught else 'MISSED'
        want = '' if ok else '   <-- WRONG, wanted %s' % ('CAUGHT' if expect_caught else 'MISSED')
        print('%-7s %s%s' % (word, label, want))

    print()
    if fails:
        print('%d mutation(s) behaved wrongly' % fails)
    else:
        print('all %d mutations behaved as intended' % len(MUTATIONS))
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main())
