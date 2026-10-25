#!/usr/bin/env python3
"""Prove test-logo-cutout.py would catch a regression in the cutter.

Six mutations, each removing exactly one property the owner asked for. The
admin panel is really rebuilt and the test really run each time, judged on the
EXIT CODE -- a crashing test prints no FAIL line and would read as a pass.
"""
import subprocess, shutil, sys, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
ADM = os.path.join(HERE, 'admin-src', 'index.html')
TEST = 'test-logo-cutout.py'

MUTATIONS = [
    ("stored as JPEG again, which cannot hold transparency",
     "try { url = out.toDataURL('image/png'); }",
     "try { url = out.toDataURL('image/jpeg', 0.9); }"),

    ("keys every dark pixel instead of flooding in from the border",
     "  for (let x = 0; x < w; x++){ consider(x, 0); consider(x, h - 1); }",
     "  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) consider(xx, yy);"),

    ("leaves the rim at its composited value, so the logo keeps a black fringe",
     "    p[i]     = Math.min(255, Math.round(p[i] / a));\n"
     "    p[i + 1] = Math.min(255, Math.round(p[i + 1] / a));\n"
     "    p[i + 2] = Math.min(255, Math.round(p[i + 2] / a));\n",
     ""),

    ("stops trimming, so the logo arrives inside its old empty margin",
     "          c = trimTransparentEdges(c);", "          void 0;"),

    ("the cut is off unless he finds the tickbox",
     '<input type="checkbox" id="mpSelectorStrip" checked style="width:auto;margin:0">',
     '<input type="checkbox" id="mpSelectorStrip" style="width:auto;margin:0">'),

    ("claims the background came off even when nothing was cut",
     "    toast(!strip ? 'Saved as it is, live for every user'\n"
     "          : r.cleared ? 'Background removed, live for every user'\n"
     "          : 'Saved, but no dark background was found to cut off', r.cleared || !strip ? 'ok' : 'warn');",
     "    toast('Background removed, live for every user', 'ok');"),
]


def build():
    r = subprocess.run(['node', 'build-admin.js'], cwd=HERE, capture_output=True, text=True)
    if r.returncode != 0 or not re.search(r'round-trip\s*:?\s*OK', r.stdout + r.stderr):
        print('BUILD BROKE:', (r.stdout + r.stderr)[-500:])
        return False
    return True


def run():
    return subprocess.run([sys.executable, TEST], cwd=HERE,
                          capture_output=True, text=True).returncode


def main():
    shutil.copy(ADM, ADM + '.disc-bak')
    bad = []
    try:
        if not build():
            return 1
        if run() != 0:
            print('BASELINE ALREADY FAILING -- fix that first')
            return 1
        print('baseline: green\n')

        for label, old, new in MUTATIONS:
            text = open(ADM, encoding='utf-8').read()
            if text.count(old) != 1:
                print(f'SETUP  {label}: anchor appears {text.count(old)} times, expected 1')
                bad.append(label)
                continue
            open(ADM, 'w', encoding='utf-8').write(text.replace(old, new))
            ok = build()
            code = run() if ok else 1
            shutil.copy(ADM + '.disc-bak', ADM)
            caught = code != 0
            print(('CAUGHT ' if caught else 'MISSED ') + label + f'  (exit {code})')
            if not caught:
                bad.append(label)
        build()
    finally:
        shutil.copy(ADM + '.disc-bak', ADM)
        os.remove(ADM + '.disc-bak')
        build()

    print()
    if bad:
        print(f'{len(bad)} mutation(s) went unnoticed: {bad}')
        return 1
    print('every property of the cutter is covered by an assertion that discriminates')
    return 0


if __name__ == '__main__':
    sys.exit(main())
