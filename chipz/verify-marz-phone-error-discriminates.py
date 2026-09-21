#!/usr/bin/env python3
"""Re-break the MarzPay phone-format wrapping, one way at a time.

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
     'function marzIsPhoneFormatError(mp) {',
     'const _unusedControl = 0;\nfunction marzIsPhoneFormatError(mp) {',
     False),

    ("the documented error_code is no longer recognised", SERVER,
     "if (mp && mp.error_code === 'INVALID_PHONE_FORMAT') return true;",
     "if (false) return true;",
     True),

    ('every MarzPay refusal is treated as a phone problem', SERVER,
     "return /invalid .*phone number format|phone number format/i.test(raw);",
     "return true;",
     True),

    ('the replacement stops naming the ACCOUNT region and reverts to the raw text', SERVER,
     "const failMsg = marzIsPhoneFormatError(mpData)\n        ? marzPhoneFormatMsg()\n        : marzUserMsg(mpData, 'Could not start the payment');",
     "const failMsg = marzUserMsg(mpData, 'Could not start the payment');",
     True),

    # Reverts the WHOLE hunk -- assignment and call together. A first version
    # of this mutation only swapped the final call and left the now-dead
    # `failMsg` assignment (and the literal string the "wired into the
    # route" regex checks for) still sitting in the source above it, so that
    # check kept passing against source text that was genuinely no longer
    # doing anything. Reported MISSED, correctly -- the mutation was the
    # broken part, not the fix.
    ('the check is dropped from the deposit route entirely', SERVER,
     "      const failMsg = marzIsPhoneFormatError(mpData)\n        ? marzPhoneFormatMsg()\n        : marzUserMsg(mpData, 'Could not start the payment');\n      await markDepositFailed(depRef, userId, failMsg);",
     "      await markDepositFailed(depRef, userId, marzUserMsg(mpData, 'Could not start the payment'));",
     True),

    ('marzPhoneFormatMsg stops reusing badPhoneMessage and drifts into a second copy', SERVER,
     "function marzPhoneFormatMsg(region) {\n  return badPhoneMessage(region || currentRegion());\n}",
     "function marzPhoneFormatMsg(region) {\n  return 'Wrong phone number.';\n}",
     True),

    ('the LANG_PATTERNS row is deleted, so the message goes back to untranslated English', CLIENT,
     "['That is not a valid {0} mobile-money number. Use the format {1} or {2}.',",
     "['SOMETHING_ELSE_ENTIRELY {0} {1} {2}',",
     True),

    ('the French translation drops the {2} placeholder, silently dropping a phone number', CLIENT,
     "\"Ce n'est pas un numéro mobile money {0} valide. Utilisez le format {1} ou {2}.\",",
     "\"Ce n'est pas un numéro mobile money {0} valide. Utilisez le format {1}.\",",
     True),
]


def run():
    r = subprocess.run(['node', 'test-marz-phone-error.js'], cwd=HERE, capture_output=True, text=True)
    return r.returncode


def main():
    if run() != 0:
        print('REFUSING TO RUN: test-marz-phone-error.js is not green at HEAD')
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
