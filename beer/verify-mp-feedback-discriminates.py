#!/usr/bin/env python3
"""Prove test-manual-pay-feedback.py would actually catch a regression.

Each mutation removes exactly ONE of the behaviours the owner asked for, the
app is really rebuilt, and the test is really run. Judged on the EXIT CODE,
not on counting FAIL lines: a test that crashes prints no FAIL line at all and
would otherwise read as a pass.
"""
import subprocess, shutil, sys, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'user-src', 'original_module.js')
CSS = os.path.join(HERE, 'user-src', 'index.html')

MUTATIONS = [
    ("the toasts become the app's OK-button dialog again", SRC,
     "if (!_manDepChosenMethod) { manualPayToast('Please select the operator first'); return; }",
     "if (!_manDepChosenMethod) { notify('Please select the operator first'); return; }"),

    ("Confirm no longer raises the loader while the order is created", SRC,
     "  manualPayLoading(true);\n  let r;\n  // finally, not a line after the await",
     "  let r;\n  // finally, not a line after the await"),

    ("the code screen paints its blank fields with no loader over them", SRC,
     "  manualPayLoading(true);\n  _manDepId = data.depositId;",
     "  _manDepId = data.depositId;"),

    ("the Invitation Reward bar is gone", SRC,
     '<span class="inv-bar"></span>Invitation Reward',
     'Invitation Reward'),

    ("the bar is there but has no gradient", CSS,
     ".inv-bar{width:4px;height:17px;border-radius:var(--r-pill);background:var(--chipz-grad);",
     ".inv-bar{width:4px;height:17px;border-radius:var(--r-pill);background:#888;"),
]


def build():
    r = subprocess.run(['node', 'build-core.js'], cwd=HERE, capture_output=True, text=True)
    if r.returncode != 0 or not re.search(r'round-trip\s*:?\s*OK', r.stdout + r.stderr):
        print('BUILD BROKE:', (r.stdout + r.stderr)[-600:])
        return False
    return True


def run_test():
    return subprocess.run([sys.executable, 'test-manual-pay-feedback.py'],
                          cwd=HERE, capture_output=True, text=True).returncode


def main():
    for path in (SRC, CSS):
        shutil.copy(path, path + '.disc-bak')
    bad = []
    try:
        if not build():
            return 1
        if run_test() != 0:
            print('BASELINE ALREADY FAILING -- fix that first')
            return 1
        print('baseline: green\n')

        for label, path, old, new in MUTATIONS:
            text = open(path).read()
            if text.count(old) != 1:
                print(f'SETUP  {label}: anchor appears {text.count(old)} times, expected 1')
                bad.append(label)
                continue
            open(path, 'w').write(text.replace(old, new))
            ok = build()
            code = run_test() if ok else 1
            shutil.copy(path + '.disc-bak', path)
            caught = (code != 0)
            print(('CAUGHT ' if caught else 'MISSED ') + label + f'  (exit {code})')
            if not caught:
                bad.append(label)

        build()
    finally:
        for path in (SRC, CSS):
            shutil.copy(path + '.disc-bak', path)
            os.remove(path + '.disc-bak')
        build()

    print()
    if bad:
        print(f'{len(bad)} mutation(s) went unnoticed: {bad}')
        return 1
    print('every new assertion discriminates')
    return 0


if __name__ == '__main__':
    sys.exit(main())
