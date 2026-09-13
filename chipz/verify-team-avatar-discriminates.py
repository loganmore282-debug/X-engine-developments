#!/usr/bin/env python3
"""Prove test-team-member-avatar.py would catch a regression.

Judged on the EXIT CODE -- a crashing test prints no FAIL line and would
otherwise read as a pass.
"""
import subprocess, shutil, sys, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
MOD = os.path.join(HERE, 'user-src', 'original_module.js')
CSS = os.path.join(HERE, 'user-src', 'index.html')
TEST = 'test-team-member-avatar.py'

MUTATIONS = [
    ("the disc goes back to being empty", MOD,
     "style=\"background:${idx % 2 ? 'linear-gradient(135deg,#f4b400,#e21b2a)' : 'var(--chipz-grad)'};\">${avatar}</div>",
     "style=\"background:${idx % 2 ? 'linear-gradient(135deg,#f4b400,#e21b2a)' : 'var(--chipz-grad)'};\"></div>"),

    ("an uploaded logo is ignored and the wordmark always shows", MOD,
     "  const avatar = STATE.brandLogo\n"
     "    ? `<img src=\"${esc(STATE.brandLogo)}\" alt=\"\" onerror=\"this.outerHTML=brandTextMark(44)\">`\n"
     "    : brandTextMark(44);",
     "  const avatar = brandTextMark(44);"),

    ("the wordmark is drawn at the profile card's size and overflows", MOD,
     "    : brandTextMark(44);", "    : brandTextMark();"),

    ("the disc stops centring and clipping its contents", CSS,
     ".team-member .avatar{width:44px;height:44px;border-radius:50%;flex-shrink:0;\n"
     "  display:flex;align-items:center;justify-content:center;overflow:hidden;}",
     ".team-member .avatar{width:44px;height:44px;border-radius:50%;flex-shrink:0;}"),

    ("the logo letterboxes instead of filling the disc", CSS,
     ".team-member .avatar img{width:100%;height:100%;object-fit:cover;display:block;}",
     ".team-member .avatar img{width:100%;height:100%;object-fit:contain;display:block;}"),

    ("\"Joined\" is printed twice again", MOD,
     "<div class=\"joined\">${esc(timeAgo(m.createdAt) || 'Joined recently')}</div>",
     "<div class=\"joined\">Joined ${esc(timeAgo(m.createdAt) || '—')}</div>"),

    ("brandTextMark's default changes, so the Account card moves too", MOD,
     "  const k = (Number(box) || 68) / 68;", "  const k = (Number(box) || 44) / 68;"),
]

FILES = [MOD, CSS]


def build():
    r = subprocess.run(['node', 'build-core.js'], cwd=HERE, capture_output=True, text=True)
    if r.returncode != 0 or not re.search(r'round-trip\s*:?\s*OK', r.stdout + r.stderr):
        print('BUILD BROKE:', (r.stdout + r.stderr)[-400:])
        return False
    return True


def run():
    return subprocess.run([sys.executable, TEST], cwd=HERE,
                          capture_output=True, text=True).returncode


def main():
    for p in FILES:
        shutil.copy(p, p + '.disc-bak')
    bad = []
    try:
        if not build():
            return 1
        if run() != 0:
            print('BASELINE ALREADY FAILING -- fix that first')
            return 1
        print('baseline: green\n')
        for label, path, old, new in MUTATIONS:
            text = open(path, encoding='utf-8').read()
            if text.count(old) != 1:
                print(f'SETUP  {label}: anchor appears {text.count(old)} times, expected 1')
                bad.append(label)
                continue
            open(path, 'w', encoding='utf-8').write(text.replace(old, new))
            ok = build()
            code = run() if ok else 1
            shutil.copy(path + '.disc-bak', path)
            caught = code != 0
            print(('CAUGHT ' if caught else 'MISSED ') + label + f'  (exit {code})')
            if not caught:
                bad.append(label)
        build()
    finally:
        for p in FILES:
            shutil.copy(p + '.disc-bak', p)
            os.remove(p + '.disc-bak')
        build()

    print()
    if bad:
        print(f'{len(bad)} mutation(s) went unnoticed: {bad}')
        return 1
    print('every change is covered by an assertion that discriminates')
    return 0


if __name__ == '__main__':
    sys.exit(main())
