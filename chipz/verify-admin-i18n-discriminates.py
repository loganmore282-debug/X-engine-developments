#!/usr/bin/env python3
"""Re-break the admin panel's language layer, one way at a time, and require
the tests to notice.

A passing test proves nothing on its own -- this project has now found SIX
harnesses that were defending a bug as loyally as they would defend a feature,
and several assertions that passed against demonstrably broken code. So each
mutation below is applied to the real source, the panel is REBUILT, both
standing tests are run, and the WORST exit code is what counts.

Judged on the EXIT CODE, never on FAIL-line counts: a harness that crashes
prints no FAIL line at all, and counting them reads a crash as a pass. That
mistake has been made here before.

A refused BUILD counts as caught. build-admin.js is supposed to refuse rather
than ship a panel that boots fine and silently never translates anything, so
the refusal is the guard doing its job.

The first entry is a deliberate NO-OP asserted to be reported MISSED. If that
one is ever "caught", the harness is failing for some reason unrelated to the
mutation and every other CAUGHT in the run is worthless.

DO NOT run anything else that reads these sources while this is running, and
do not build alongside it: it mutates files in place and restores them in a
finally block. Never SIGTERM it -- that skips the restore and leaves a
mutation applied to the tree.

Run:  python3 verify-admin-i18n-discriminates.py
"""
import os, shutil, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ADMIN = os.path.join(HERE, 'admin-src', 'index.html')
APP = os.path.join(HERE, 'user-src', 'original_module.js')
BUILD = os.path.join(HERE, 'build-admin.js')
ROWS1 = os.path.join(HERE, 'admin-rows-1.py')
TOUCHED = [ADMIN, APP, BUILD, ROWS1,
           os.path.join(HERE, 'admin', 'index.html')]

# (label, file, old, new). `old` must occur EXACTLY ONCE -- a bulk replace
# that hits two places, or substitutes a string for itself, is a no-op
# pretending to be a mutation, and that has happened here twice.
MUTATIONS = [
    ('CONTROL: a variable nobody reads (must be MISSED)', ADMIN,
     'var LANGS = ADMIN_LANGS;',
     'var LANGS = ADMIN_LANGS; var _unusedControlMutation = 1;'),

    ('the shared ENGINE is never injected into the panel', BUILD,
     "code = injectShared(code, 'ENGINE', sharedEngine);",
     "code = injectShared(code, 'ENGINE', '');"),

    ('the shared TABLE is never injected, so the panel loses every word the app already had', BUILD,
     "code = injectShared(code, 'TABLE', sharedTable);",
     "code = injectShared(code, 'TABLE', 'var LANG_ROWS = [];\\nvar LANG_PATTERNS = [];\\n');"),

    ("the panel's own rows are never concatenated onto the app's", ADMIN,
     'LANG_ROWS = LANG_ROWS.concat(ADMIN_LANG_ROWS);',
     '/* mutation */'),

    ("the panel's own TEMPLATES are never concatenated", ADMIN,
     'LANG_PATTERNS = LANG_PATTERNS.concat(ADMIN_LANG_PATTERNS);',
     '/* mutation */'),

    ('the observer is never started, so only the open screen is translated', ADMIN,
     '  try { startI18nObserver(); } catch (_) {}',
     '  /* mutation */'),

    ('the language is never applied at boot', ADMIN,
     'startAdminI18n();\nif(SESSION_TOKEN){ openShell(); }',
     'if(SESSION_TOKEN){ openShell(); }'),

    ('the chosen language is never written down', ADMIN,
     "  try { localStorage.setItem(ADMIN_LANG_KEY, LANG); } catch (_) {}",
     '  /* mutation */'),

    ('the chosen language is never read back', ADMIN,
     "  try { stored = localStorage.getItem(ADMIN_LANG_KEY) || ''; } catch (_) {}",
     '  /* mutation */'),

    ('switching language does not repaint what is on screen', ADMIN,
     '  try { translateTree(document.body); } catch (_) {}\n  paintAdminLangPickers();',
     '  paintAdminLangPickers();'),

    ('the sign-in card loses its picker, so the language cannot be changed before signing in', ADMIN,
     '<select id="langLogin" title="The language this panel is shown in" data-no-i18n></select>',
     ''),

    ("tPattern stops honouring '=', so a deliberately-English template renders as a bare '='", APP,
     "if (typeof tpl !== 'string' || !tpl || tpl === '=' || tpl === p.row[0]) continue;",
     "if (typeof tpl !== 'string' || !tpl || tpl === p.row[0]) continue;"),

    ('a table row is a cell short, silently shifting every language after the gap', ROWS1,
     "    ['Overview', 'Okulabako', 'Muhtasari', 'Aperçu', 'Incamake', 'Okureeberera'],",
     "    ['Overview', 'Okulabako', 'Muhtasari', 'Incamake', 'Okureeberera'],"),

    ('a cell merely repeats its English, which is identical to a blank at runtime', ROWS1,
     "    ['Overview', 'Okulabako', 'Muhtasari', 'Aperçu', 'Incamake', 'Okureeberera'],",
     "    ['Overview', 'Okulabako', 'Muhtasari', 'Overview', 'Incamake', 'Okureeberera'],"),

    ('the build stops refusing an injection that produced no translator', BUILD,
     "    console.error(`i18n injection produced a script with no ${need.trim()} -- refusing to build.`);\n    process.exit(1);",
     '    /* mutation */'),
]


def run(cmd, timeout=900):
    try:
        r = subprocess.run(cmd, cwd=HERE, capture_output=True, text=True, timeout=timeout)
        return r.returncode, (r.stdout or '') + (r.stderr or '')
    except subprocess.TimeoutExpired:
        return 99, 'TIMEOUT'


def build():
    """Rebuild the panel. A refusal is an outcome, not an error."""
    code, out = run([shutil.which('node'), 'build-admin.js'], timeout=600)
    return code, out


def judge():
    """Worst exit code across the two standing tests."""
    worst, why = 0, []
    for cmd in ([shutil.which('node'), 'test-admin-i18n.js'],
                [sys.executable, 'test-admin-i18n.py', tempfile.mkdtemp()]):
        code, out = run(cmd)
        if code:
            why.append(os.path.basename(cmd[1]))
        worst = max(worst, code)
    return worst, why


def main():
    backups = {p: open(p, 'rb').read() for p in TOUCHED if os.path.exists(p)}
    caught, missed, control_ok = [], [], None
    try:
        # A clean tree must PASS first, or every "caught" below is meaningless.
        code, out = build()
        if code:
            raise SystemExit('ABORT: the unmutated panel does not build:\n' + out[-3000:])
        base, why = judge()
        if base:
            raise SystemExit(f'ABORT: the unmutated tests already fail ({why})')
        print('baseline: builds and both tests pass\n')

        for i, (label, path, old, new) in enumerate(MUTATIONS):
            src = open(path, encoding='utf8').read()
            n = src.count(old)
            if n != 1:
                raise SystemExit(f'ABORT: mutation {i} anchor occurs {n} times in '
                                 f'{os.path.basename(path)}: {label}')
            if old == new:
                raise SystemExit(f'ABORT: mutation {i} substitutes a string for itself')
            open(path, 'w', encoding='utf8').write(src.replace(old, new, 1))
            try:
                bcode, bout = build()
                if bcode:
                    verdict = 'CAUGHT (the build refused)'
                    hit = True
                else:
                    code, why = judge()
                    hit = code != 0
                    verdict = f'CAUGHT by {"+".join(why)}' if hit else 'MISSED'
            finally:
                open(path, 'wb').write(backups[path])
            (caught if hit else missed).append(label)
            if i == 0:
                control_ok = not hit
            print(f'{verdict:32} {label}')
    finally:
        for p, b in backups.items():
            open(p, 'wb').write(b)
        # Leave the tree with a build made from the restored sources.
        build()

    print(f'\n{len(caught)} caught, {len(missed)} missed')
    if control_ok is False:
        print('THE CONTROL MUTATION WAS "CAUGHT" -- the harness is failing for some '
              'other reason and every CAUGHT above is worthless.')
    for m in missed:
        if m is not MUTATIONS[0][0]:
            print('  MISSED ' + m)
    bad = [m for m in missed if m != MUTATIONS[0][0]]
    return 1 if (bad or control_ok is False) else 0


if __name__ == '__main__':
    sys.exit(main())
