#!/usr/bin/env python3
"""The admin panel, swept once per language.

Owner: "also make when in admin, you can change its language too, everything
there."

find-admin-untranslated.py is the diagnostic; this is the assertion built on
the same walk. It runs that sweep for EVERY language the panel offers, because
every column is a separate claim: the member app's own round had Swahili come
back clean while French still showed five English sentences and Runyankole
three. "Everything there" is only testable by rendering each one.

The sweep exits non-zero on a finding, a page error, OR a screen that would
not open / painted nothing -- that last one matters most here. switchTab()
runs each renderer as Promise.resolve(fn()).catch(() => {}), so a renderer
that throws leaves #content empty, raises no page error, and a sweep with no
blind check would report that tab as perfectly clean. Two tabs -- Deposits and
Withdrawals, the two where money is approved -- were unmeasured for a whole
round exactly that way.

This runs six browser sessions and takes a few minutes. Ports: the sweep binds
8901, so this cannot run beside find-admin-untranslated.py.

Run:  python3 test-admin-i18n-coverage.py [outdir]
"""
import json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/admin-i18n-coverage'
os.makedirs(OUT, exist_ok=True)

# Every language the panel offers a column for, English aside -- read out of
# ADMIN_LANGS rather than listed here, so adding a seventh language cannot
# quietly go unswept.
import re                                                        # noqa: E402
adminSrc = open(os.path.join(HERE, 'admin-src', 'index.html'), encoding='utf8').read()
CODES = [c for c in re.findall(r"code:\s*'([a-z-]+)'",
         re.search(r'const ADMIN_LANGS = \[([\s\S]*?)\n\];', adminSrc).group(1))
         if c != 'en']

fails = []


def ck(ok, label):
    print(("PASS  " if ok else "FAIL  ") + label)
    if not ok:
        fails.append(label)


ck(len(CODES) == 5, f"the panel offers five languages besides English ({CODES})")

for lang in CODES:
    r = subprocess.run([sys.executable, os.path.join(HERE, 'find-admin-untranslated.py'),
                        OUT, lang], capture_output=True, text=True, cwd=HERE)
    report = os.path.join(HERE, f'admin-untranslated-{lang}.json')
    if not os.path.exists(report):
        ck(False, f'{lang}: the sweep produced no report\n' + r.stdout[-2000:])
        continue
    d = json.load(open(report, encoding='utf8'))
    n = len(d['findings'])
    counts = d.get('counts', {})
    ck(n == 0, f'{lang}: no English left on any screen '
               f'({n} finding(s), {counts.get("clean", 0)} strings translated)')
    ck(not d.get('pageErrors'), f'{lang}: no page errors ({d.get("pageErrors", [])[:1]})')
    ck(not d.get('blind'), f'{lang}: every screen actually rendered ({d.get("blind", [])[:2]})')
    # A sweep that walked nothing cannot report a finding. This is the floor
    # that stops "0 findings" meaning "0 screens".
    ck(counts.get('clean', 0) > 150,
       f'{lang}: and the sweep really did read the panel ({counts.get("clean", 0)} '
       'strings accounted for by the table)')
    for f in d['findings'][:12]:
        print(f'      [{f["why"]}] {f["kind"]}: {f["text"][:100]}')

print(("\n%d FAILED" % len(fails)) if fails else "\nall good")
sys.exit(1 if fails else 0)
