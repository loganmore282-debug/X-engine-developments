#!/usr/bin/env python3
"""
One-shot edit: make the i18n engine a SHARED block, so the admin panel can run
the identical translator instead of growing a second copy of it.

Owner: "also make when in admin, you can change its language too, everything
there."

The member app's translator is ~150 lines that took a round and eleven
mutations to get right: the pattern fallback, the whole-node rule, the WeakMap
of originals, the attribute observer that recognises its own output. Writing a
second one for the admin panel would mean two implementations of a thing that
is subtle in exactly the places nobody re-reads -- and this project already
keeps ONE such pair in step by hand (phoneToEmail) and needs a dedicated test
to prove they still agree.

So instead: the engine is marked off in original_module.js and build-admin.js
lifts that exact text into the admin bundle at build time. Not a copy in the
repo -- a copy made by the build, from one source, every time. Drift is
impossible rather than merely tested for.

What is IN the engine (host-independent): DICT, langMeta, t, tPattern,
LANG_PATTERN_RE, the WeakMaps, I18N_ATTRS, i18nTextNode, i18nElementAttrs,
translateTree, startI18nObserver.
What is NOT (each host owns its own): LANGS, LANG, LANG_ROWS, LANG_PATTERNS,
and everything that decides WHICH language to be in -- the member app resolves
that from its region, the admin from the operator's own choice.

This also moves LANG_PATTERNS up beside LANG_ROWS so the engine is one
contiguous region. Both are plain data declarations and LANG_PATTERN_RE is
computed after either way, so the move changes nothing at runtime.
"""
import os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
JS = os.path.join(HERE, 'user-src', 'original_module.js')

BEGIN = '// ==== I18N ENGINE: SHARED WITH THE ADMIN PANEL - BEGIN ====\n'
END = '// ==== I18N ENGINE: SHARED WITH THE ADMIN PANEL - END ====\n'

NOTE = '''// build-admin.js lifts everything between these two markers straight into
// the admin bundle, so the panel runs THIS translator rather than a second
// one written to match it. Nothing in here may reference anything the member
// app owns and the admin does not: it depends only on LANG, LANGS,
// LANG_CODES, LANG_ROWS and LANG_PATTERNS, each of which the HOST defines
// above it. Adding a dependency on something app-specific breaks the admin
// panel at build time, which test-admin-i18n.js is there to catch.
'''


def main():
    src = open(JS, encoding='utf8').read()

    # ── move LANG_PATTERNS up, so the engine is contiguous ──
    pat_start = src.index('// ── SENTENCES WITH A FIGURE SPLICED INTO THEM ──')
    pat_end = src.index('\n];\n', src.index('var LANG_PATTERNS = [')) + len('\n];\n')
    patterns = src[pat_start:pat_end]
    src = src[:pat_start] + src[pat_end:]

    dict_note = ('// code -> { english: translated }. Built once; an empty cell is simply not\n'
                 '// stored, so a lookup miss and "deliberately English" are the same thing.\n')
    if src.count(dict_note) != 1:
        raise SystemExit(f'ABORT: DICT anchor occurs {src.count(dict_note)} times')
    src = src.replace(dict_note, patterns + BEGIN + NOTE + dict_note)

    # ── close the engine after startI18nObserver ──
    tail = "  } catch(_){ _i18nObserving = false; }\n}\n"
    if src.count(tail) != 1:
        raise SystemExit(f'ABORT: observer tail occurs {src.count(tail)} times')
    src = src.replace(tail, tail + END)

    open(JS, 'w', encoding='utf8').write(src)
    r = subprocess.run(['node', '--check', JS], capture_output=True, text=True)
    if r.returncode:
        raise SystemExit('ABORT: the edited module does not parse:\n' + r.stderr)

    # Sanity: the marked region must hold every engine name and none of the
    # host-specific ones. A silently wrong region would build an admin panel
    # that half-translates.
    block = src[src.index(BEGIN) + len(BEGIN):src.index(END)]
    for name in ['var DICT', 'function langMeta', 'function t(', 'function tPattern',
                 'var LANG_PATTERN_RE', 'var _i18nText', 'var I18N_ATTRS',
                 'function i18nTextNode', 'function i18nElementAttrs',
                 'function translateTree', 'function startI18nObserver']:
        if name not in block:
            raise SystemExit(f'ABORT: engine region is missing {name!r}')
    for name in ['function applyLanguage', 'function setLang', 'function resolveLang',
                 'function applyRegionLanguages', 'function paintLangButton',
                 'var LANG_ROWS', 'var LANG_PATTERNS', 'var LANGS']:
        if name in block:
            raise SystemExit(f'ABORT: engine region wrongly contains {name!r}')
    print(f'engine region marked: {len(block.splitlines())} lines, '
          f'{len(block)} chars')
    return 0


if __name__ == '__main__':
    sys.exit(main())
