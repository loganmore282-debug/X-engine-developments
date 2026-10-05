#!/usr/bin/env python3
"""Prove this round's tests would catch a regression in each thing he asked for.

Each mutation reverts exactly ONE change, the app is really rebuilt, and the
test is really run. Judged on the EXIT CODE, never on counting FAIL lines: a
test that crashes prints no FAIL line and would otherwise read as a pass.
"""
import subprocess, shutil, sys, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
MOD = os.path.join(HERE, 'user-src', 'original_module.js')
CSS = os.path.join(HERE, 'user-src', 'index.html')
ADM = os.path.join(HERE, 'admin-src', 'index.html')
SRV = os.path.join(HERE, 'server.js')
ICON = os.path.join(HERE, 'user', 'icon-192.png')

UI = 'test-round-bleed-glow-marks.py'
REVIEW = 'test-manual-review.js'

# (label, file, old, new, which test should go red)
MUTATIONS = [
    ("the banner ends on a hard edge again", MOD,
     "  if (hero) hero.classList.toggle('has-bg', !!STATE.authHeroImage);",
     "  if (hero) hero.classList.remove('has-bg');", UI),

    ("the fade stops short of the card's white", CSS,
     "    var(--snow-surface) 88%,\n    var(--snow-surface) 100%);}",
     "    rgba(255,255,255,.75) 88%,\n    rgba(255,255,255,.75) 100%);}", UI),

    ("the Team glow goes back to red", CSS,
     ":root{--team-glow:rgba(45,170,85,.42);}",
     ":root{--team-glow:rgba(226,27,42,.30);}", UI),

    ("the commission percentage loses its glow", CSS,
     ".team-gcard.comm .pct{font-size:47px;color:var(--snow-wine);line-height:1.1;\n  text-shadow:0 0 18px var(--team-glow);}",
     ".team-gcard.comm .pct{font-size:47px;color:var(--snow-wine);line-height:1.1;}", UI),

    ("the lone manual method calls itself PAY B again", MOD,
     "  const rows = live.map((which, i) => row(which, i === 0 ? 'PAY-A' : 'PAY B')).join('');",
     "  const rows = live.map(which => row(which, which === 'A' ? 'PAY-A' : 'PAY B')).join('');", UI),

    ("the network is flipped again, MTN ordering Airtel", MOD,
     "  const network = _manDepChosenMethod === 'MTN' ? 'MTN Mobile Money' : 'Airtel Money';",
     "  const network = _manDepChosenMethod === 'MTN' ? 'Airtel Money' : 'MTN Mobile Money';", UI),

    ("Snow's slanting-8 swoosh comes back to the login screen", ADM,
     '<div class="mk" id="brandMarkLogin"><img src="/icon-192.png" alt="" width="40" height="40"></div>',
     '<div class="mk" id="brandMarkLogin"><svg viewBox="0 0 36 28" width="24" height="19" fill="none" aria-hidden="true">'
     '<path d="M18 14C10 4 4 6 4 12c0 6 7 8 14 2 7-6 14-4 14 2 0 6-6 8-14-2Z" stroke="#FFFFFF" stroke-width="3.2" '
     'stroke-linecap="round" stroke-linejoin="round"/><circle cx="27" cy="7" r="2.5" fill="#FFFFFF"/></svg></div>', UI),

    ("the ladder grid comes back to the dashboard", ADM,
     '<div class="mk" id="brandMarkTop"><img src="/icon-192.png" alt="" width="34" height="34"></div>',
     '<div class="mk" id="brandMarkTop"><svg viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="2" '
     'stroke-linecap="round" stroke-linejoin="round">\n          <rect x="4" y="4" width="16" height="16" rx="3"/>'
     '<path d="M4 9.3h16M4 14.7h16M9.3 4v16M14.7 4v16"/></svg></div>', UI),

    ("the member's message is collapsed to one line again", SRV,
     "      pastedSms: text,", "      pastedSms: info ? info.raw : text,", REVIEW),

    ("the forwarded message is collapsed to one line again", SRV,
     "        pastedSms: String(text || info.raw).slice(0, 2000),",
     "        pastedSms: info.raw || text,", REVIEW),
]

FILES = [MOD, CSS, ADM, SRV]


def build():
    for script in ('build-core.js', 'build-admin.js'):
        r = subprocess.run(['node', script], cwd=HERE, capture_output=True, text=True)
        if r.returncode != 0 or not re.search(r'round-trip\s*:?\s*OK', r.stdout + r.stderr):
            print(f'BUILD BROKE ({script}):', (r.stdout + r.stderr)[-500:])
            return False
    return True


def run(test):
    cmd = [sys.executable, test] if test.endswith('.py') else ['node', test]
    return subprocess.run(cmd, cwd=HERE, capture_output=True, text=True).returncode


def main():
    for p in FILES:
        shutil.copy(p, p + '.disc-bak')
    shutil.copy(ICON, ICON + '.disc-bak')
    bad = []
    try:
        if not build():
            return 1
        for t in (UI, REVIEW):
            if run(t) != 0:
                print(f'BASELINE ALREADY FAILING: {t}')
                return 1
        print('baseline: both green\n')

        for label, path, old, new, test in MUTATIONS:
            text = open(path, encoding='utf-8').read()
            if text.count(old) != 1:
                print(f'SETUP  {label}: anchor appears {text.count(old)} times, expected 1')
                bad.append(label)
                continue
            open(path, 'w', encoding='utf-8').write(text.replace(old, new))
            ok = build()
            code = run(test) if ok else 1
            shutil.copy(path + '.disc-bak', path)
            caught = code != 0
            print(('CAUGHT ' if caught else 'MISSED ') + label + f'  (exit {code}, {test})')
            if not caught:
                bad.append(label)

        # The icon is a file, not a line of code: put Snow's snowflake back.
        print()
        from PIL import Image, ImageDraw
        snow = Image.new('RGB', (192, 192), (140, 20, 30))
        d = ImageDraw.Draw(snow)
        for a in (0, 60, 120):
            d.line([(96 - 70, 96), (96 + 70, 96)], fill=(120, 210, 240), width=10)
            snow = snow.rotate(a)
            d = ImageDraw.Draw(snow)
        snow.save(ICON)
        ok = build()
        code = run(UI) if ok else 1
        shutil.copy(ICON + '.disc-bak', ICON)
        caught = code != 0
        print(('CAUGHT ' if caught else 'MISSED ')
              + f"Snow's snowflake put back as the app icon  (exit {code}, {UI})")
        if not caught:
            bad.append("snowflake icon")

        build()
    finally:
        for p in FILES + [ICON]:
            shutil.copy(p + '.disc-bak', p)
            os.remove(p + '.disc-bak')
        build()

    print()
    if bad:
        print(f'{len(bad)} mutation(s) went unnoticed: {bad}')
        return 1
    print('every change this round is covered by an assertion that discriminates')
    return 0


if __name__ == '__main__':
    sys.exit(main())
