#!/usr/bin/env python3
"""
No English left on any screen, in ANY offered language.

Owner: "make sure every language is fixed on anything ... they should change
uniformly in language not missing English and any language."

This is the standing assertion over find-untranslated.py's walk. That script
drives the BUILT app, visits 39 screens/sheets/dialogs/sub-tabs and reads back
every visible text node and every placeholder/aria-label/title, then classifies
each string against the real LANG_ROWS and LANG_PATTERNS tables read out of the
app's own source. Anything it cannot account for is a finding.

It is run once PER LANGUAGE rather than once, because every column is a
separate claim: Swahili came back clean while French still showed five English
sentences and Runyankole three. "Uniformly, not missing any language" is only
testable by rendering each one.

Why the measurement is done this way and not by grepping the sources:
extract-ui-strings.py's regexes found 213 strings and the real number reaching
a screen was far higher -- a regex has to model how each string is built, and
this app builds screens out of template literals, helper calls and ternaries
inside attributes. Reading the rendered screen cannot miss a string because of
how that string happens to be written.

Slow by nature (a real browser boot per language). Run it before a push, not
in a tight loop.
"""
import os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SWEEP = os.path.join(HERE, 'find-untranslated.py')
OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/i18n-coverage'

# Every language the app offers. 'en' is excluded on purpose: in English t()
# returns each string unchanged by design, so a sweep would report the whole
# app as untranslated English and be right.
LANGS = ['lg', 'sw', 'fr', 'rw', 'nyn']

failed = []
for lang in LANGS:
    r = subprocess.run([sys.executable, SWEEP, os.path.join(OUT, lang), lang],
                       capture_output=True, text=True)
    tail = [l for l in r.stdout.splitlines()
            if l.startswith(('language', 'screens walked', 'NOT IN', 'IN THE TABLE',
                             'TRANSLATED BUT', '  ', 'PAGE ERRORS', 'screens that'))]
    status = 'PASS' if r.returncode == 0 else 'FAIL'
    print(f'{status}  {lang}')
    for l in tail:
        print('      ' + l)
    if r.returncode != 0:
        failed.append(lang)
        if r.stderr.strip():
            print('      stderr: ' + r.stderr.strip().splitlines()[-1])

print()
if failed:
    print(f'{len(failed)} language(s) still show English or failed to render: '
          + ', '.join(failed))
    sys.exit(1)
print(f'i18n coverage: {len(LANGS)} languages, no English left on any screen')
