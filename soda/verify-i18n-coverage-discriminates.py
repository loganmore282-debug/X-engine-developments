#!/usr/bin/env python3
"""
Re-breaks the i18n coverage work one way at a time and requires the harness to
exit non-zero every time.

Judged on the EXIT CODE, never on FAIL-line counts: a crash prints no FAIL line
and counting them read a crash as a pass once in this project already.

Each mutation rebuilds user/index.html, because every assertion here runs
against the BUILT bundle. That is also why this must not run alongside a build
or another harness that reads the sources -- see CLAUDE.md's Round 163 note.
"""
import os, shutil, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
JS = os.path.join(HERE, 'user-src', 'original_module.js')

# One language each where possible -- the whole point of the per-language loop
# is that a fault can live in one column only.
CASES = [
    ('the pattern layer is gone: "Fee: 15%" cannot be matched by a whole-string table',
     '  return tPattern(s);', '  return s;', ['sw']),
    ('a pattern drops the figure it was carrying',
     "['Fee: {0}%', \"Ssente z'obuweereza: {0}%\"", "['Fee: {0}%', \"Ssente z'obuweereza:\"", ['lg']),
    ('the About page is chopped back into one span per word',
     'function revealWordsHtml(escapedText){\n  return `<span class="reveal-word">${escapedText}</span>`;\n}',
     'function revealWordsHtml(escapedText){\n  return String(escapedText).split(/(\\s+)/).map(tok => '
     '/^\\s+$/.test(tok) || !tok ? tok : `<span class="reveal-word">${tok}</span>`).join(\'\');\n}', ['sw']),
    ('the observer stops watching attributes, so a placeholder set after render stays English',
     '      attributes: true, attributeFilter: I18N_ATTRS,\n', '', ['sw']),
    ('i18nElementAttrs forgets what it wrote, so it cannot tell its own output from new English',
     '    if (!rec || (cur !== rec.out && cur !== rec.en)) {',
     '    if (!rec) {', ['sw']),
    ('"Failed" -- one of the two words the owner named -- loses its row',
     "  ['Failed', 'Kigaanye',", "  ['FailedXX', 'Kigaanye',", ['sw']),
    ('"Paid" loses its row', "  ['Paid', 'Kisasuddwa',", "  ['PaidXX', 'Kisasuddwa',", ['sw']),
    ('the Account rows lose their sub-line translations',
     "['Transaction history', 'Ebyafaayo by", "['Transaction historyXX', 'Ebyafaayo by", ['sw']),
    ('the founder-account Sign Up wording loses its row',
     "['Referral code (optional)'", "['Referral code (optionalXX)'", ['sw']),
    ('one language loses a cell another still has (Runyankole only)',
     "'Uruziga', 'Ekizengurutsi']", "'Uruziga', '']", ['nyn']),
    ("the '=' sentinel goes back to a blank, so a chosen match is indistinguishable from a gap",
     "['Messages', 'Obubaka', 'Ujumbe', '=',", "['Messages', 'Obubaka', 'Ujumbe', '',", ['fr']),
]


def build():
    r = subprocess.run(['node', 'build-core.js'], cwd=HERE, capture_output=True, text=True)
    return r.returncode == 0 and 'round-trip    : OK' in r.stdout


def main():
    if not build():
        raise SystemExit('ABORT: a clean build failed before any mutation')
    missed = 0
    for desc, old, new, langs in CASES:
        src = open(JS, encoding='utf8').read()
        n = src.count(old)
        if n != 1:
            print(f'SETUP-ERROR ({n} matches)  {desc}')
            missed += 1
            continue
        shutil.copy(JS, JS + '.bak')
        try:
            open(JS, 'w', encoding='utf8').write(src.replace(old, new))
            if not build():
                print(f'CAUGHT (build)  {desc}')
                continue
            # test-languages.js first: a few claims here cannot be seen on a
            # screen at all. A pattern that drops its {0} still renders as the
            # translation, just missing a figure -- indistinguishable from the
            # translation working, unless something compares the template's
            # placeholders with the English's, which that harness does.
            worst = subprocess.run(['node', 'test-languages.js'], cwd=HERE,
                                   capture_output=True).returncode
            for lang in langs:
                r = subprocess.run([sys.executable, os.path.join(HERE, 'find-untranslated.py'),
                                    f'/tmp/verify-i18n/{lang}', lang],
                                   capture_output=True, text=True)
                worst = max(worst, r.returncode)
            print(('CAUGHT   ' if worst else 'MISSED   ') + desc)
            if not worst:
                missed += 1
        finally:
            shutil.move(JS + '.bak', JS)
    build()
    print()
    print(f'{missed} not caught' if missed else f'all {len(CASES)} mutations caught')
    return 1 if missed else 0


if __name__ == '__main__':
    sys.exit(main())
